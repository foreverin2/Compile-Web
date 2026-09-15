import { describe, it, expect, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createGame } from '../../src/core/state/create';
import { syncScanOverlays } from '../../src/ui/render';
import { NET_BOTTOM_SIDES, renderNetBoard, verifyPageHooks } from '../../src/ui/render-net';
import { setFxViewSeat } from '../../src/ui/fx-seat';
import { stripComments } from './source-text';
// R8-5：样式表解析器（`cssRules` / `cssPropOf` / `specificityOf` / 选择器匹配）**一份实现、两处共用**
// —— 本文件与 `tests/ui/net-board-grid.test.ts`（G-7 视觉行序）用的是同一套语义，理由与
// `./net-dom-stub` 头注完全相同：复制成两份必然漂移，而漂移的表现是"一边绿、另一边红"。
import {
  assertNoUnmodelableCascade, cssLenOf, cssOrderOf, cssPropOf, cssRules, cssVarOf,
  compoundMatches, MODELED_PROPS, resolveCssValue, selectorMatches, specificityOf, type CssRule,
} from './net-css-parse';
import {
  classListOf, descendants, drainRaf, installStubDom, isClass as isClassShared,
  makeStubEl, setStubRect, walk, type StubNode,
} from './net-dom-stub';

/**
 * G2 修正 R-F · **C-2 的行为守卫**：用最小 DOM 桩**真跑一遍 `renderNetBoard`**，
 * 再按元素树（+ 样式表里真正生效的 `order` / `grid-column` / `grid-row`）算出层序与视觉归属。
 *
 * ## 为什么必须有这个文件（而不是再加几条源码断言）
 *
 * C-2 的两个成因**都不是源码能表达的**：
 *  1. `renderSide` 对两侧挂载顺序相同 ⇒ 自己协议落到整列最外端（**DOM 兄弟顺序**的后果）；
 *  2. 能量槽的落端当时由 **CSS `order`** 决定（`.stack-slot` 是 flex column），
 *     `.p1`/`.p2` 那两个选择器看着"按玩家分得好好的"，实际在默认席位下**两个能量槽都跑到内侧**。
 * 评审正是靠"真跑 + 看元素树"才发现它的；本文件把这件事变成**可重复的机检**。
 *
 * ⚠️ **两代机制迁移（本文件的历史，读判据前先看这两条）**：
 *  · **R8-2**：能量槽移出 `.stack-slot` ⇒ 列内层序**不再有 `order`**（只由 DOM 兄弟顺序表达，
 *    见 G-1/G-1b），本文件那部分解算器因此删掉了；
 *  · **R8-5**：底部三块的**左右列**退役（信息块与手牌区各自一整行、上下镜像）⇒ 手牌**行号**
 *    由 `.net-hand-area-{foe,self}` 的 `grid-row` 承担（本文件 R6-3③④ 解它），
 *    `order` 在样式表里只剩 `.battery-overflow` 的**盒内**顺序。**五行行序**的完整模型在
 *    `tests/ui/net-board-grid.test.ts` 的 G-7（它要展平 `display: contents` 的盒树）。
 *
 * ## 这个桩**能**证明什么 / **不能**证明什么（诚实边界）
 *
 * 能（都是确定性的流式布局语义，不需要浏览器）：
 *  - **元素树的顺序与归属**：一列里 `net-side-foe / net-lane-mid / net-side-self` 的兄弟顺序、
 *    每一侧内部挂了哪些节点、每个节点的 `class` / `data-player` / `data-line`；
 *  - **CSS 解算出的视觉归属**：按 `styles-net.css` 里真实的 `grid-row` / `grid-column` / `order`
 *    声明（含选择器权重与源序）排序（本文件的解析器见 `./net-css-parse`）。
 *
 * **不能**：
 *  - 真实浏览器里的 `getBoundingClientRect()`（本桩一律返回全 0 —— 本文件**不**做任何几何断言）；
 *  - flex/grid 的真实求解（高度/间隙/换行）、缩放、字体导致的换行 —— "到底好不好看"只能人眼；
 *  - `transform` 的效果（协议 ∓90° 是 CSS 的，不在本文件的判据里）。
 *  这三条都在报告的人眼清单里。
 */

/* ============================================================================
 * 样式表：`grid-row` / `grid-column` / `order` 声明的解析 + 最小选择器匹配
 * （解析器本体在 `./net-css-parse`，**两个文件共用一份**）
 * ========================================================================== */

// ⚠️ **R8-5：解析器本体已抽到 `./net-css-parse`**（`tests/ui/net-board-grid.test.ts` 的 G-7
// "视觉行序"求解器必须与本文件用**同一套**解析语义 —— 复制一份就是第二条真相）。
// 下面这段注释是 `cssRules` 的原文，保留作历史依据（它讲的坑都还在）。

/**
 * 去注释后的 `选择器 { 体 }` 列表。
 *
 * ⚠️⚠️ **本页样式表不许有条件块**（`@media` / `@supports` / `@container`）—— 由 **R6-4** 正面守卫钉住。
 * 理由：本解析器**不递归**条件块，一旦出现，块**内部**的规则会被当成**无条件规则混进规则表**
 * （`@media` 的前导被跳过、内容不跳）。旧注释写的"简版解析够用 / 整块被跳过"**是错的**
 * （R8-5 实测更正，见 R6-4 的注释与 `./net-css-parse` 的头注）。
 *
 * ⚠️ `stripComments` **保留注释起止的两个字符**（`/*`…`*​/` 只把中间内容换成空白，见
 * `./source-text` 的说明）—— 于是紧跟在一条规则**行尾注释**之后的规则，选择器会带上
 * `/* *​/` 前缀。这里必须把它当空白清掉，否则 `.net-lane-band .stack-slot.p2 .battery`
 * 会匹配不上（本文件第一版就是这样漏掉一条规则的）。
 */


/* ============================================================================
 * CSS：`grid-template-columns` 的**轨道展开**（G2 修正 R7）
 *
 * 为什么必须"真的解析"而不是拿声明文本做子串匹配：R7 的事故形态是**轨道数 < 子节点数**
 * （模板 3 条、`.net-grid` 挂了 5 个子节点 ⇒ 第 4/5 个成为隐式列 ⇒ 整页"一行五格"）。
 * `repeat(3, …)` 在文本上"看着就是三条"，任何子串断言对"少一条轨道"都零判别力 ——
 * 必须把 `repeat(n, …)` 展开成 n 条轨道再数。
 * ========================================================================== */

/** 按**顶层**空白切分（括号内的空白不是分隔符）：
 *  `repeat(3, minmax(0, 1fr)) var(--net-rail-w)` → `['repeat(3, minmax(0, 1fr))', 'var(--net-rail-w)']`。 */
function splitTopLevel(value: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of value) {
    if (ch === '(') depth += 1;
    else if (ch === ')') depth -= 1;
    if (/\s/.test(ch) && depth === 0) {
      if (cur !== '') out.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  if (cur !== '') out.push(cur);
  return out;
}

/** `grid-template-columns` 的声明值 → **轨道列表**（只支持本页用到的 `repeat(n, …)`）。 */
function gridTracks(raw: string): string[] {
  const out: string[] = [];
  for (const token of splitTopLevel(raw)) {
    const m = /^repeat\(\s*(\d+)\s*,([\s\S]*)\)$/.exec(token);
    if (m === null) {
      out.push(token);
      continue;
    }
    const inner = splitTopLevel(m[2]);
    const n = Number.parseInt(m[1], 10);
    for (let i = 0; i < n; i += 1) out.push(...inner);
  }
  return out;
}

/* ⚠️ **R9-1：`cssVarOf` / `resolveCssValue` 已上提到 `./net-css-parse`**（连同 CSS 长度解算器
 *  `cssLenOf`）—— 新增的 R9 守卫在 `tests/ui/net-r9.test.ts` 里要用**同一套**算式解
 *  `.stack` 的 `min-height` 与协议 holder 的宽高。两份拷贝一旦漂移，表现就是"一个文件绿、
 *  另一个红"（与 `cssRules` / `dom-stub` 同一条教训）。本文件的 G-3 继续用同一个实现。 */

/** 造一个只带类名的桩节点（纯 CSS 解算用；不装 DOM、不渲染）。 */
function cssNode(...classes: string[]): StubNode {
  const n = makeStubEl('div');
  n.classList.add(...classes);
  return n;
}

/* ⚠️ **R8-5 删除的两个解算器**（`visualChildren` = 按 `order` 稳定排序；`visualOrderOfBottom`
 *  = 按 `grid-column` 排底部三块）：它们服务的机制**都已退役**（列内层序自 R8-2 起由 DOM 兄弟
 *  顺序表达；底部三块的左右列自 R8-5 起由"各占一整行 + `grid-row` 上下镜像"取代）。
 *  留着它们不只是死代码：`visualOrderOfBottom` 对 `1 / -1` 一律返回 `Infinity`、排序**退化回
 *  DOM 顺序**，而 DOM 顺序恰好等于旧断言期望的值 —— 那会让"左右归属"这条判据变成
 *  **永远为真且什么都不查**（假绿）。新的行序模型在 `tests/ui/net-board-grid.test.ts` 的 G-7。 */

/* ============================================================================
 * 最小 DOM 桩（**与 render-net.test.ts 共用同一份** —— 见 ./net-dom-stub 头注：
 * 复制成两份就会漂移，而漂移的表现恰好是"一个文件绿、另一个红"）
 * ========================================================================== */

const makeEl = makeStubEl;
const installDom = installStubDom;
const isClass = isClassShared;

/** 一帧合成局（与评审探针同）：只要"三列 + 两侧 + 能量槽"的结构都在，够本文件用。
 *
 *  `cardsPerStack`（**R-F2 新增**）：> 0 时给**双方每条线**都铺 n 张卡
 *  （uid 后缀 = 引擎下标：`c0` 最旧 … `c{n-1}` 最新，与 `stacks` 的追加语义一致）。
 *  旧版这一帧**场上无卡**（`createGame` 后 stacks 全空）—— 正因如此，"链路卡序"这件事
 *  在 R1→R2→R3→R-F **四轮**里从未被任何机检覆盖（I-3 的根因）。
 *
 *  `defId`（**R8-2 修正新增**，缺省 `'fire-0'` ⇒ 既有调用逐字等价）：铺牌用的牌面。
 *  它唯一的用途是造出**点数 > 10** 的链路（`fire-0` 的分值是 0，永远造不出来）——
 *  C-1 的溢流数字（`.battery-overflow`）只有那条分支才产出。 */
function renderFrame(viewSeat: 0 | 1, cardsPerStack = 0, defId = 'fire-0'): StubNode {
  const s = createGame({ seed: 'rf-tree-seed', draftStarter: 0, firstToPlay: 1 });
  for (const p of [0, 1] as const) {
    s.players[p].protocols = [
      { defId: 'fire-0', compiled: false },
      { defId: 'ice-0', compiled: false },
      { defId: 'light-0', compiled: false },
    ] as never;
    if (cardsPerStack > 0) {
      s.players[p].stacks = [0, 1, 2].map((line) => Array.from({ length: cardsPerStack }, (_, i) => ({
        uid: `p${p}l${line}c${i}`, defId, faceUp: true, owner: p, zone: 'field', line, pos: i,
      }))) as never;
    }
  }
  (s as { phase: string }).phase = 'turn';
  const root = makeEl('div');
  const noop = (): void => { /* noop */ };
  renderNetBoard(root as unknown as HTMLElement, s, {
    onAction: noop, onRendered: noop, rerender: noop, onDraftPick: noop, onDraftUnpick: noop,
    onDraftBan: noop, onWinReset: noop,
  } as never, { viewSeat, verifyHooks: false });
  return root;
}

/* ============================================================================
 * 层序求解：一列 = 六层（**G2 修正 R8-2：DOM 兄弟顺序即视觉顺序**）
 *
 * ⚠️ **本段在 R8-2 之后变简单了，也变硬了**：R1~R7 期间能量槽在 `.stack-slot` 内、落端由
 * CSS `order` 决定，于是求解器要**解析样式表的 order 声明 + 选择器权重 + 源序**再做稳定排序
 * —— 而"哪一层在哪"因此有了**两个**出处（DOM 顺序 × CSS order），C-2 两次 Critical 都出在这条缝里。
 * R8-2 把能量槽移出链路框、`order` 彻底退役 ⇒ `.net-side` 是 flex column，
 * **DOM 兄弟顺序就是视觉顺序**，"哪一层在哪"只剩一个出处。
 * 本段现在**只读元素树**（`order` 解算器只留给底部行/手牌区那两处仍在用 order 的地方）。
 * ========================================================================== */

type Side = 'foe' | 'self';
type LayerKind = 'battery' | 'stack' | 'protocol';
interface Layer { side: Side; kind: LayerKind }

const label = (l: Layer): string => `${l.side === 'foe' ? '对手' : '自己'}${l.kind === 'battery' ? '能量槽' : l.kind === 'stack' ? '链路' : '协议'}`;

/** 一列的**直接子节点**，按 **DOM 顺序**（= 视觉上下顺序；R8-2 之后不再有 order 介入）。 */
const cellsOf = (col: StubNode): StubNode[] => col.children;

/** 一列的**直接子节点**的种类（打印用）。 */
function colKindOf(n: StubNode): string {
  if (isClass(n, 'net-side-foe')) return '侧·对手(net-side-foe)';
  if (isClass(n, 'net-side-self')) return '侧·自己(net-side-self)';
  if (isClass(n, 'net-lane-mid')) return '中线(net-lane-mid)';
  return n.cls;
}

/** 一侧（`.net-side`）的**直接子节点**的种类（打印用）。 */
function sideKindOf(n: StubNode): string {
  if (isClass(n, 'battery')) return '能量槽(.battery)';
  if (isClass(n, 'stack-slot')) return '链路槽(.stack-slot)';
  if (isClass(n, 'protocol-cell')) return '协议格(.protocol-cell)';
  return n.cls;
}

/**
 * 一列（`.net-lane-band`）里**自上而下的六层** —— **纯 DOM 兄弟顺序**（规格 §2.1 的目标层级）。
 *
 * ⚠️ **这条是 R8-2 的判据本身**：能量槽是 `.net-side` 的**直接子节点**（不再在 `.stack-slot`
 * 里），所以"六层"不再需要下钻一层槽、也不再需要解算 `order`。
 */
function layersOfColumn(col: StubNode): Layer[] {
  const out: Layer[] = [];
  for (const sideNode of cellsOf(col)) {
    const side: Side | null = isClass(sideNode, 'net-side-foe') ? 'foe'
      : isClass(sideNode, 'net-side-self') ? 'self' : null;
    if (!side) continue;   // 中线等
    for (const cell of sideNode.children) {
      if (isClass(cell, 'battery')) { out.push({ side, kind: 'battery' }); continue; }
      if (isClass(cell, 'protocol-cell')) { out.push({ side, kind: 'protocol' }); continue; }
      if (isClass(cell, 'stack-slot')) {
        // 链路槽里应当**只有** `.stack`（R8-2：能量槽已移出）
        for (const inner of cell.children) {
          if (isClass(inner, 'stack')) out.push({ side, kind: 'stack' });
        }
      }
    }
  }
  return out;
}

const SPEC_ORDER: readonly Layer[] = [
  { side: 'foe', kind: 'battery' },   // 1
  { side: 'foe', kind: 'stack' },     // 2
  { side: 'foe', kind: 'protocol' },  // 3
  { side: 'self', kind: 'protocol' }, // 4
  { side: 'self', kind: 'stack' },    // 5
  { side: 'self', kind: 'battery' },  // 6
];

/** 取第一列 + 它**从 root 起的完整祖先链**（三条线同构，第一列足够；
 *  三条列的一致性由 renderNetBoard 的循环与既有计数守卫保证）。
 *
 *  ⚠️ 返回祖先链是**守卫洞 1 的修法**：解算器给子项拼的链是 `[...chain, node, 子项]`，
 *  所以 `chain` 必须是"从根到父节点"的真实祖先序列，`.net-board` 这类**列以上**的选择器片段
 *  才可能匹配上（旧版漏掉 → 覆盖规则隐形）。
 *  R8-2 之后列内层序不再解算 CSS，但**祖先链仍是必需的** —— `grid-row` / `grid-column` 的
 *  解算（R6-1 ④、R6-3 ③）要继续用它，且下面那条"带全祖先"的反空集合断言是**防退化**的
 *  （别让它悄悄退回 `[]`）。 */
function firstColumnWithChain(root: StubNode): { col: StubNode; chain: StubNode[] } {
  const found: Array<{ col: StubNode; chain: StubNode[] }> = [];
  const visit = (n: StubNode, chain: StubNode[]): void => {
    if (isClass(n, 'net-lane-band')) found.push({ col: n, chain });
    for (const c of n.children) visit(c, [...chain, n]);
  };
  visit(root, []);
  expect(found.length, '元素树里找不到 3 条 .net-lane-band（三列结构被改？）').toBe(3);
  // 反空集合：祖先链至少要含 `.net-board` 与 `.net-grid` —— 否则"带全祖先"这件事会静默退化成旧行为
  expect(found[0].chain.some((n) => isClass(n, 'net-board')),
    '第一列的祖先链里没有 .net-board（带全祖先的修法没生效 → 列以上的 CSS 覆盖又会隐形）').toBe(true);
  return found[0];
}

/** 在列内按**DOM 顺序**找某个「侧 + 层」的节点（能量槽/链路/协议都能取到）。 */
function findLayer(col: StubNode, want: Layer): StubNode | null {
  for (const sideNode of cellsOf(col)) {
    const side: Side | null = isClass(sideNode, 'net-side-foe') ? 'foe'
      : isClass(sideNode, 'net-side-self') ? 'self' : null;
    if (side !== want.side) continue;
    for (const cell of sideNode.children) {
      if (want.kind === 'protocol' && isClass(cell, 'protocol-cell')) return cell;
      if (want.kind === 'battery' && isClass(cell, 'battery')) return cell;
      if (want.kind === 'stack' && isClass(cell, 'stack-slot')) {
        for (const inner of cell.children) if (isClass(inner, 'stack')) return inner;
      }
    }
  }
  return null;
}

const cssPath = new URL('../../src/ui/styles-net.css', import.meta.url);
const netCss = readFileSync(fileURLToPath(cssPath)).subarray(0, 4 * 1024 * 1024).toString('utf8');
const RULES = cssRules(netCss);

afterEach(() => { setFxViewSeat(null); });

describe('R-F · C-2 / R8-2：真跑 renderNetBoard 的元素树层序（viewSeat 0/1）', () => {
  it('G-1. 一列自上而下必须是规格 §2.1 的六层；每侧的子节点顺序恰好按侧；能量槽**不在**链路槽里', async () => {
    const restore = installDom();
    try {
      for (const seat of [0, 1] as const) {
        const root = renderFrame(seat);
        const { col } = firstColumnWithChain(root);
        const tree: string[] = [];
        walk(col, 0, tree, 4);
        // 报告里要贴的元素树（真实产出，非手写）
        console.log(`\n===== viewSeat=${seat} · 第一列元素树（DOM 顺序）=====\n${tree.join('\n')}`);

        // ── ① 一列的**直接子节点**顺序 = [foeSide, mid, selfSide]（DOM 顺序即视觉顺序，order 已退役）──
        const cellKinds = cellsOf(col).map(colKindOf);
        console.log(`  ----- viewSeat=${seat} · 一列的直接子节点（DOM 顺序）-----\n  ${cellKinds.join(' → ')}`);
        expect(cellKinds, `viewSeat=${seat}：一列的直接子节点必须是 [对手侧, 中线, 自己侧]`
          + `（R8-2 之后 DOM 兄弟顺序 = 视觉上下顺序，不再有 CSS order 兜底）`).toEqual([
          '侧·对手(net-side-foe)', '中线(net-lane-mid)', '侧·自己(net-side-self)',
        ]);

        // ── ② 每侧的**子节点顺序**恰好按规格 §2.1（这是 R8-2 的核心判据）──
        const innerKinds: Record<Side, string[]> = { foe: [], self: [] };
        for (const sideNode of cellsOf(col)) {
          const s: Side | null = isClass(sideNode, 'net-side-foe') ? 'foe'
            : isClass(sideNode, 'net-side-self') ? 'self' : null;
          if (s) innerKinds[s] = sideNode.children.map(sideKindOf);
        }
        console.log(`  ----- viewSeat=${seat} · 每侧的子节点（DOM 顺序）-----\n`
          + `  对手侧: ${innerKinds.foe.join(' → ')}\n  自己侧: ${innerKinds.self.join(' → ')}`);
        expect(innerKinds.foe, `viewSeat=${seat}：对手侧的子节点必须恰好是`
          + ` [能量槽, 链路槽, 协议格]（能量槽在**链路框外**的最上端 = 层 1）`).toEqual(
          ['能量槽(.battery)', '链路槽(.stack-slot)', '协议格(.protocol-cell)']);
        expect(innerKinds.self, `viewSeat=${seat}：自己侧的子节点必须恰好是`
          + ` [协议格, 链路槽, 能量槽]（能量槽在**链路框外**的最下端 = 层 6）`).toEqual(
          ['协议格(.protocol-cell)', '链路槽(.stack-slot)', '能量槽(.battery)']);

        // ── ③ **`.battery` 不是 `.stack-slot` 的后代**（R8-2 的判据本身）──
        const foeside = cellsOf(col).find((n) => isClass(n, 'net-side-foe'))!;
        const selfside = cellsOf(col).find((n) => isClass(n, 'net-side-self'))!;
        for (const [sideName, sideNode] of [['对手', foeside], ['自己', selfside]] as const) {
          const slots = sideNode.children.filter((n) => isClass(n, 'stack-slot'));
          expect(slots.length, `viewSeat=${seat} · ${sideName}侧：必须恰好一个 .stack-slot`).toBe(1);
          const batteryInsideSlot = descendants(slots[0]).some((n) => isClass(n, 'battery'));
          expect(batteryInsideSlot, `viewSeat=${seat} · ${sideName}侧：.battery 出现在 .stack-slot 的`
            + `**子树**里 —— 用户裁决是"能量槽要放置在链路框**外**"（这也会让 6 处 FX 的`
            + ` ".battery[data-player][data-line]" 定位在远程页静默失配——旧写法正是按 .stack-slot 找它）`).toBe(false);
          // 链路槽里除了 .stack 不应有别的（尤其别再挂回能量槽）
          expect(slots[0].children.map((n) => n.cls.split(/\s+/)[0]), `viewSeat=${seat} · ${sideName}侧：`
            + `链路槽的直接子节点应只有 .stack（能量槽已移出）`).toEqual(['stack']);
        }

        // ── ④ 完整六层（DOM 顺序）：与规格 §2.1 逐条相等 ──
        const layers = layersOfColumn(col);
        console.log(`----- viewSeat=${seat} · 自上而下（纯 DOM 兄弟顺序）-----\n`
          + layers.map((l, i) => `  ${i + 1}. ${label(l)}`).join('\n'));
        expect(layers, `viewSeat=${seat} 的列内层序与规格 §2.1 不符`
          + `（实际：${layers.map(label).join(' → ')}）`).toEqual(SPEC_ORDER);

        // ⑤ 三条腿各自点名（失败信息比"数组不等"可读；也防止将来有人把 SPEC_ORDER 一起改错）
        expect(layers[0], `viewSeat=${seat}：对手能量槽必须在一列的最上端（第 1 层）`)
          .toEqual({ side: 'foe', kind: 'battery' });
        expect(layers[2], `viewSeat=${seat}：对手协议必须紧贴中线（第 3 层，内端）`)
          .toEqual({ side: 'foe', kind: 'protocol' });
        expect(layers[3], `viewSeat=${seat}：自己协议必须紧贴中线（第 4 层，内端）`)
          .toEqual({ side: 'self', kind: 'protocol' });
        expect(layers[5], `viewSeat=${seat}：自己能量槽必须在一列的最下端（第 6 层）`)
          .toEqual({ side: 'self', kind: 'battery' });
        const iFoeStack = layers.findIndex((l) => l.side === 'foe' && l.kind === 'stack');
        const iSelfStack = layers.findIndex((l) => l.side === 'self' && l.kind === 'stack');
        expect(iFoeStack, `viewSeat=${seat}：对手链路必须在中线之上（第 2 层）`).toBe(1);
        expect(iSelfStack, `viewSeat=${seat}：自己链路必须在中线之下（第 5 层）`).toBe(4);

        // ⑥ 归属：能量槽/链路槽各自挂在自己的侧里，**不是**按绝对玩家猜的
        expect(foeside.dataset.player, `viewSeat=${seat}：对手侧的 data-player 应是绝对的 ${1 - seat}`)
          .toBe(String(1 - seat));
        expect(selfside.dataset.player, `viewSeat=${seat}：自己侧的 data-player 应是绝对的 ${seat}`)
          .toBe(String(seat));

        // ── ⑦ **`.battery` 的 data-player / data-line 与所在列一致**（R8-2 的节点自描述）──
        // 为什么这一条是承重的：6 处 FX（扫描流光 / metal-0 / mirror-0 / clarity-0 / diversity / 愤怒0）
        // 全靠 `.battery[data-player="X"][data-line="Y"]` 定位能量槽 —— 属性写错/写漏 ⇒ 特效**静默消失**
        // （那些查询全是 `if (!node) return` 的降级，不报错）。
        // 这里从**元素树**反推（不是查源码文本）：两个能量槽必须各自带"自己那个玩家 + 本列的线号"。
        for (const [sideName, sideNode, wantPlayer] of [
          ['对手', foeside, 1 - seat], ['自己', selfside, seat],
        ] as const) {
          const bat = sideNode.children.find((n) => isClass(n, 'battery'));
          expect(bat, `viewSeat=${seat} · ${sideName}侧：找不到 .battery（能量槽没产出？）`).toBeTruthy();
          expect(bat!.dataset.player, `viewSeat=${seat} · ${sideName}侧：.battery 的 data-player 必须是`
            + ` 绝对玩家号 ${wantPlayer}（否则 6 处 FX 用 .battery[data-player=…] 定位能量槽会静默失配）`)
            .toBe(String(wantPlayer));
          expect(bat!.dataset.line, `viewSeat=${seat} · ${sideName}侧：.battery 的 data-line 必须等于`
            + ` 本列的线号 ${String(col.dataset.line)}`).toBe(String(col.dataset.line));
        }

        // ⑧ 竖向生长类**按侧**（不是按绝对玩家）：自己恒 .grow-down、对手恒 .grow-up
        const selfStack = findLayer(col, { side: 'self', kind: 'stack' })!;
        const foeStack = findLayer(col, { side: 'foe', kind: 'stack' })!;
        expect(classListOf(selfStack), `viewSeat=${seat}：自己链路必须是 .grow-down（最新牌往下长）`)
          .toContain('grow-down');
        expect(classListOf(foeStack), `viewSeat=${seat}：对手链路必须是 .grow-up（最新牌往上长）`)
          .toContain('grow-up');
      }
    } finally {
      await drainRaf();
      restore();
    }
  });

  it('G-1b. 行为腿：`.battery` 与 `.stack-slot` 是**兄弟**（同一父 `.net-side`），且三条线各一份', async () => {
    const restore = installDom();
    try {
      for (const seat of [0, 1] as const) {
        const root = renderFrame(seat);
        const cols = descendants(root).filter((n) => isClass(n, 'net-lane-band'));
        expect(cols.length, `viewSeat=${seat}：必须恰好三条 .net-lane-band`).toBe(3);
        const linesSeen: string[] = [];
        for (const col of cols) {
          const line = String(col.dataset.line);
          linesSeen.push(line);
          for (const sideNode of cellsOf(col)) {
            if (!isClass(sideNode, 'net-side')) continue;
            const bat = sideNode.children.find((n) => isClass(n, 'battery'));
            const slot = sideNode.children.find((n) => isClass(n, 'stack-slot'));
            expect(bat, `viewSeat=${seat} · 线 ${line}：这一侧没有能量槽`).toBeTruthy();
            expect(slot, `viewSeat=${seat} · 线 ${line}：这一侧没有链路槽`).toBeTruthy();
            // **兄弟关系**（不是父子）—— 这是 R8-2 的"移出链路框"在行为层的唯一判据
            expect(bat!.parentElement, `viewSeat=${seat} · 线 ${line}：能量槽的父节点必须是 .net-side`
              + `（挂回 .stack-slot 内部 = 用户否决的"能量槽被放在链路框中"）`).toBe(sideNode);
            expect(slot!.parentElement, `viewSeat=${seat} · 线 ${line}：链路槽的父节点必须是 .net-side`)
              .toBe(sideNode);
            // 同一侧里：对手 = 能量槽在链路槽**之前**（上）、自己 = 在**之后**（下）
            const iBat = sideNode.children.indexOf(bat!);
            const iSlot = sideNode.children.indexOf(slot!);
            const isFoe = isClass(sideNode, 'net-side-foe');
            if (isFoe) {
              expect(iBat, `viewSeat=${seat} · 线 ${line}：对手能量槽必须在链路槽**之前**（视觉在上）`)
                .toBeLessThan(iSlot);
            } else {
              expect(iBat, `viewSeat=${seat} · 线 ${line}：自己能量槽必须在链路槽**之后**（视觉在下）`)
                .toBeGreaterThan(iSlot);
            }
          }
        }
        expect(linesSeen, `viewSeat=${seat}：三条线的 data-line 必须是 0/1/2`).toEqual(['0', '1', '2']);
      }
    } finally {
      await drainRaf();
      restore();
    }
  });

  /* ==========================================================================
   * G-3（**样式腿**）与 G-4（**FX 定位点迁移**）—— G2 修正 R8-2 / R8-3
   *
   * 这两条是**源码腿**（桩没有布局引擎 ⇒ 量不到 min-height / flex 方向的真实效果），
   * 但它们钉的是"承重声明本身"：min-height 的**推导式**、两条 justify-content 的**配对**、
   * 以及 6 处 FX 定位点**不得**再按位置（.stack-slot）找能量槽。
   * ⚠️ 诚实边界：min-height 到底够不够、横条好不好看，只能人眼在 5173 上验。
   * ⚠️ **R9-1**：CSS 长度解算器（`cssLenOf` / `cssVarOf` / `resolveCssValue`）已上提到
   * `./net-css-parse`（新增的 R9 守卫在 `net-r9.test.ts` 里要用**同一份**算式；
   * 复制一份就会漂移成"一个文件绿、另一个红"）。本用例的判据**一个字未改**。
   * ======================================================================== */


  it('G-3. R8-3 样式腿：.stack 的 min-height 由变量推出且 ≥ 7 张跨度；grow-down/up 的 justify-content 是两个不同值', () => {
    const board = cssNode('net-board');   // R9-4 起 --card-h / --card-w 定义在 .net-board 上（手牌同基准）
    const band = cssNode('net-lane-band');
    const stack = cssNode('stack');
    const chain = [board, band, stack];
    const raw = cssPropOf(stack, chain, RULES, 'min-height');
    expect(raw, 'styles-net.css 里 .net-lane-band .stack 没有 min-height ——'
      + '放第 1 张牌时链路框就会变形（用户 R8-3：把牌放上去会导致框的大小发生变化）').toBeTruthy();
    const got = cssLenOf(chain, RULES, raw!);
    expect(got, `min-height 解不出像素值：${raw}`
      + `（必须由 --card-h / --card-w 推出，不许写死 px）`).not.toBeNull();

    // 逐项复算派生量（**从样式表真实解算**，不是手抄数字）
    const varChain = [board, band];
    const cardH = cssLenOf(varChain, RULES, cssVarOf(varChain, RULES, '--card-h') ?? '');
    const cardW = cssLenOf(varChain, RULES, cssVarOf(varChain, RULES, '--card-w') ?? '');
    expect(cardH, `--card-h 在 .net-board / .net-lane-band 上都解不出来（R9-4 起定义在 .net-board 上：`
      + '手牌区也要吃同一基准，故解析必须走祖先链）').not.toBeNull();
    expect(cardW, `--card-w 在 .net-board / .net-lane-band 上都解不出来`).not.toBeNull();
    const seven = cardH! + 6 * 0.462 * cardW!;
    console.log(`\n===== G-3 · min-height 解算（由 styles-net.css 真实解出）=====\n`
      + `  --card-h = ${cardH}px / --card-w = ${cardW!.toFixed(2)}px\n`
      + `  7 张跨度 = ${cardH} + 6 × 0.462 × ${cardW!.toFixed(2)} = ${seven.toFixed(1)}px\n`
      + `  声明的 min-height = ${raw} → 解算 ${got!.toFixed(1)}px`);
    // ① 必须 ≥ 7 张跨度（留出余量可以，**少了不行** —— 那正是用户抱怨的"框会变形"）
    expect(got!, `min-height（${got!.toFixed(1)}px）小于 7 张牌的跨度（${seven.toFixed(1)}px）`
      + ` —— 放第 7 张时框仍会变形`).toBeGreaterThanOrEqual(seven - 0.5);
    // ② 不得**过度**预留（否则纯属浪费纵向空间；上限 = 再多一张牌的高度）
    expect(got!, `min-height 远远超出 7 张跨度（${got!.toFixed(1)}px vs ${seven.toFixed(1)}px）`)
      .toBeLessThanOrEqual(seven + cardH!);

    // ③ .grow-down / .grow-up 的 justify-content 必须是**两个不同的值**且方向正确
    const down = cssPropOf(cssNode('stack', 'grow-down'), [band, cssNode('stack', 'grow-down')], RULES, 'justify-content');
    const up = cssPropOf(cssNode('stack', 'grow-up'), [band, cssNode('stack', 'grow-up')], RULES, 'justify-content');
    console.log(`  .grow-down justify-content = ${down} / .grow-up justify-content = ${up}`);
    expect(down, `.grow-down 没有 justify-content`).toBeTruthy();
    expect(up, `.grow-up 没有 justify-content`).toBeTruthy();
    expect(down, `.grow-down（自己，协议在上端）必须是 flex-start（pos 0 贴顶 = 贴协议）`)
      .toMatch(/flex-start/);
    expect(up, `.grow-up（对手，协议在下端）必须是 flex-end（pos 0 贴底 = 贴协议）`)
      .toMatch(/flex-end/);
    expect(down, `.grow-down / .grow-up 的 justify-content 写成了**同一个值** ——`
      + ` min-height 之后它们是"整组第一张贴哪一端"的承重杠杆，同值会让一侧长反（R-F2 · I-3）`)
      .not.toBe(up);

    // ④ net 作用域下 .battery-cells 是 row-reverse（"从右往左点亮"的唯一出处）
    const cells = cssPropOf(cssNode('battery-cells'), [band, cssNode('battery'), cssNode('battery-cells')],
      RULES, 'flex-direction');
    expect(cells, `.net-lane-band .battery-cells 不是 row-reverse ——`
      + ` 双方都会变成"从左往右"点亮（与用户裁决"统一为向左"相反），且没有任何报错`)
      .toMatch(/row-reverse/);
  });

  it('G-4. FX 定位点迁移：render.ts / gen3-control.ts 不得再按 .stack-slot 找能量槽', () => {
    const uiFile = (rel: string): string =>
      String(readFileSync(fileURLToPath(new URL('../../src/ui/' + rel, import.meta.url))));
    const renderSrc = stripComments(uiFile('render.ts'));
    const ctrlSrc = stripComments(uiFile('gen3-control.ts'));
    // ① 旧写法（按位置找能量槽）必须彻底消失。R8-2 之前有 **6 处**：
    //    render.ts 的扫描流光 / metal-0 / mirror-0 / clarity-0 / diversity + gen3-control.ts 的 batteryNode。
    //    能量槽移出 .stack-slot 后这些查询会**静默**返回 null（全是 `if (!node) return` 的降级）⇒ 特效消失不报错。
    const oldForm = /\.stack-slot\[[^\]]*\]\s*\.battery-shell/g;
    expect(renderSrc.match(oldForm) ?? [], `render.ts 里仍有 ".stack-slot[...] .battery-shell" 形式的`
      + `能量槽定位（能量槽已移出链路槽 ⇒ 这些查询在远程页恒 null、特效静默消失）`).toEqual([]);
    expect(ctrlSrc, `gen3-control.ts 的 batteryNode 仍按 .stack-slot 找能量槽`)
      .not.toMatch(/\.stack-slot\[[^\]]*\]\s*\.battery\b/);
    // ② 新写法必须真的在（反空集合：不许"删掉旧查询"就算完 —— 那同样是特效全灭）
    // ⚠️ 判据用**模板字面量的完整形态**（`".${player}"]["${line}"`），不是裸 `.battery[data-player=`：
    //    裸子串会被**半截写法**满足（只写 `[data-player`、写在表格/字符串里、"删掉一处真查询"
    //    但把同一段选择器文本留在别处都能过）—— 本项目已有两次"文本满足守卫"的假绿事故
    //    （见 source-text.ts 头注）。完整形态下 render.ts 里恰好 **5 处**：
    //    扫描流光（line 477，变量 `player`）/ metal-0（`target`）/ mirror-0（`player`）/
    //    clarity-0（`player`）/ diversity（`owner`）—— **一处缺失就报红**
    //    （变异实测：把任意一处改回旧选择器 → 5 → 4）。
    //    ⚠️ R8-2 修正更正：这里原写"恰好 4 处（diversity 用别的变量名）"是**数错了**
    //    （diversity 的变量名 `owner` 也落在 `[a-z]+` 里，所以是 5 处）—— 断言本来就是 `toBe(5)`，
    //    只有注释错；本行按实际命中数改正（**判据一个字没动**）。
    const newApprox = renderSrc.match(
      /\.battery\[data-player="\$\{[a-z]+\}"\]\[data-line="\$\{[a-z]+\}"\] \.battery-shell/g) ?? [];
    console.log(`\n===== G-4 · render.ts 里按节点自描述定位能量槽的查询 = ${newApprox.length} 处 =====`);
    expect(newApprox.length, `render.ts 里按节点自描述定位能量槽的查询不足（应恰好 5 处：`
      + ` 扫描流光 / metal-0 / mirror-0 / clarity-0 / diversity —— 少一处 = 那条特效在远程页会静默取不到能量槽）`)
      .toBe(5);
    // ⑤ 第二条腿（**不再是裸子串**，R8-2 修正强化）：这 5 处必须是**真的查询调用**
    //    （`document.querySelector<HTMLElement>(` + 完整模板字面量），而不只是 5 段字符串。
    //    为什么换掉旧判据（`/\.battery\[data-player=/g` 的 `>= 4`）：那是**裸子串**，任何半截写法
    //    都能满足它 —— 它唯一能发现的是"总量掉到 3 以下"，而那件事上面 `toBe(5)` 已经覆盖；
    //    换成"调用点"形态后多发现了**一件新事**：把 5 处里的某一处**降级成常量/表格/死字符串**
    //    （查询不再发生）会立刻红，而旧判据对此完全无感。
    //    ⚠️ 它能发现什么 / 不能发现什么：能发现"某个选择器不再是查询调用"；**不能**发现
    //    "查询写在死代码里"（`if (false)`）、也不能发现"查询到的节点没被用"（那是 G-1b 的活）。
    const querySites = renderSrc.match(
      /document\.querySelector<HTMLElement>\(\s*`\.battery\[data-player="\$\{[a-z]+\}"\]\[data-line="\$\{[a-z]+\}"\] \.battery-shell`/g) ?? [];
    console.log(`  其中作为 document.querySelector<HTMLElement>(…) **调用**的 = ${querySites.length} 处`);
    expect(querySites.length, `render.ts 里"按节点自描述定位能量槽"的**查询调用**不是 5 处`
      + `（应恰好 5 处，且每处都得是真的 document.querySelector<HTMLElement>(…) 调用 ——`
      + ` 半截字符串 / 数据表 / 常量都算不合格）`).toBe(5);
    expect(ctrlSrc, `gen3-control.ts 的 batteryNode 未命中 .battery[data-player][data-line]`)
      .toMatch(/document\.querySelector<HTMLElement>\(\s*(?:\/\*[\s\S]*?\*\/\s*)*`\.battery\[data-player="\$\{player\}"\]\[data-line="\$\{line\}"\]`/);
    // ③ 自描述的**写入方**在 renderBattery 里（两个页面都写）
    expect(renderSrc, `renderBattery 未写 data-player / data-line（"与位置解耦"的前提就不成立）`)
      .toMatch(/battery\.dataset\.player\s*=\s*String\(player\)/);
    expect(renderSrc, `renderBattery 未写 data-line`)
      .toMatch(/battery\.dataset\.line\s*=\s*String\(line\)/);
  });


  /* ==========================================================================
   * G2 修正 R6（**R8-5 迁移**）：底部容器 = 信息块 · 手牌区 · 信息块
   *
   * R6 的裁决（规格 §8.4 第 2 条）：双方信息条与手牌区**同一行**、**顶部信息条取消**。
   * **R8-5 把"同一行 + 左右列"改成"各自一整行 + 上下镜像"**（用户第二次反馈的 A 方案），
   * 所以本组的判据随之迁移：
   *  · 三块的**DOM 顺序**仍是 [信息块, 手牌区, 信息块]（由 `NET_BOTTOM_SIDES` 决定）；
   *  · 三块的 `grid-column` 解出来必须都是**整行** `1 / -1`（左右列退役，见 R6-1 ④）；
   *  · **五行行序**（谁在第几行）由新文件 `tests/ui/net-board-grid.test.ts` 的 **G-7** 承担
   *    （那需要"展平 `display: contents` 后的盒树"的模型，与本文件的解算器不是同一件事）。
   *
   * ⚠️ 两条**最容易静默搞坏**的地方（本组各有一条专门断言）：
   *  1. **`.hand` 的 DOM 顺序必须仍是 [P0, P1]**（FX 用 `querySelectorAll('.hand')[player]`
   *     **按下标**读手牌）—— 视觉位置只能由 CSS 决定，**绝不能让 DOM 顺序跟着视觉走**。
   *     这是"看起来只是 CSS、实际会静默搞坏特效"的唯一一处。
   *  2. **信息块进 DOM 的顺序** = `NET_BOTTOM_SIDES`（render-net.ts 的**唯一**一处常量）；
   *     视觉行号由 CSS 按 `data-net-seat` 给 ⇒ 改常量只改 DOM、改 CSS 只改行号，
   *     两条腿由 G-7 一起钉（这里钉 DOM 那一半）。
   * ======================================================================== */

  /** 底部容器（`.net-bottom`）里**类名命中 `cls` 的**直接子节点，按 DOM 顺序。 */
  const blocksIn = (bottom: StubNode, cls: string): StubNode[] =>
    bottom.children.filter((c) => isClass(c, cls));

  /** `NET_BOTTOM_SIDES` 的**座位 → 绝对玩家**（与 render-net.ts 的 `bottomPlayerOf` 同式）。 */
  const playerOfSide = (side: string, seat: 0 | 1): number => (side === 'self' ? seat : 1 - seat);

  it('R6-1. 底部三块：信息块 · 手牌区 · 信息块（DOM 顺序 = NET_BOTTOM_SIDES；**左右列已随 R8-5 退役**）', async () => {
    const restore = installDom();
    try {
      for (const seat of [0, 1] as const) {
        const root = renderFrame(seat);
        const bottom = descendants(root).find((n) => isClass(n, 'net-bottom'));
        expect(bottom, `viewSeat=${seat}：元素树里找不到 .net-bottom（底部行没产出 → 信息条无处安放）`)
          .toBeTruthy();
        // 祖先链：从 `.net-board` 到 `.net-bottom`（CSS 规则的匹配需要它；与 firstColumnWithChain 同理由）
        const chain = descendants(root).filter((n) => isClass(n, 'net-board'));
        const tree: string[] = [];
        walk(bottom!, 0, tree, 3);
        console.log(`\n===== viewSeat=${seat} · 底部行元素树（DOM 顺序）=====\n${tree.join('\n')}`);

        const infoBlocks = blocksIn(bottom!, 'net-info-block');
        const handsBlocks = blocksIn(bottom!, 'net-hands');
        // ① 三块**恰好**各就位：信息块 ×2 + 手牌区 ×1（多一块就是"两份牌库/弃牌堆"那一族）
        expect(infoBlocks.length, `viewSeat=${seat}：底部行必须恰好两块 .net-info-block`).toBe(2);
        expect(handsBlocks.length, `viewSeat=${seat}：底部行必须恰好一块 .net-hands（两条手牌在它里面）`)
          .toBe(1);
        // ② 座位互补（不是同一侧画两遍 —— 那会让对手的牌库/弃牌堆与手牌数整块消失）
        expect(infoBlocks.map((n) => String(n.dataset.netSeat)).sort(),
          `viewSeat=${seat}：两块信息块的座位必须互补（self/foe）`).toEqual(['foe', 'self']);
        // ③ 每块挂的是**该侧**的玩家（data-player 是绝对值：viewSeat=1 时 self = P2）
        for (const block of infoBlocks) {
          const side = String(block.dataset.netSeat);
          expect(block.dataset.player, `viewSeat=${seat}：${side} 信息块的 data-player 应是绝对的 `
            + `${playerOfSide(side, seat)}（实际 ${String(block.dataset.player)}）`)
            .toBe(String(playerOfSide(side, seat)));
        }
        // ④ **列语义的三次迁移（R8-5 → R9-3 → R11-2；判据跟着搬，不是删除）**：
        //    · R6~R7：解的是 `grid-column: 1 / 3`（"谁在左、谁在右"的三列底部行）；
        //    · R8-5：信息块与手牌区**各自一整行** ⇒ 判据换成"三块都是整行 `1 / -1`"；
        //    · R9-3：手牌并进信息块那一行 ⇒ 信息块占**左侧窄列**、手牌区整行；
        //    · **R11-2/3**：对手那一块也搬进同一行（**停靠栏**）⇒ 四块各有自己的列：
        //      自己信息块 `1` · 自己手牌区 `1 / -1`（整行中置）· 对手信息块 `3` · 对手手牌张数 `4`。
        //    现在钉三件事（**覆盖前两版判据的全部对象，没有放松**）：
        //      a) 自己那一块在**第 1 列**、对手那一块在**第 3 列**（对手在右 = 用户第四次验收的字面要求；
        //         两块的列**必须不同**，否则"谁在右"这件事在判据里表达不出来）；
        //      b) 自己手牌区仍是**整行** `1 / -1`（手牌整页中置的机制本身），
        //         对手手牌张数是**第 4 列**的窄块（它被"压进对手那一块"）。
        //      c) 样式表里**不许**再有别的列指派（白名单见下）—— 残留的列指派会把某一块挤到别处。
        //    ⚠️ 为什么不能保留旧判据（"两块信息块都必须是 `1`"）：R11-2 的裁决就是"对手那一块
        //    摆在该行**右侧**" —— 保留旧句会**把本波的裁决判成失败**。强度没降：旧句查"两块同值"，
        //    新句查"两块各等于自己的期望值"（**多查了一件事**：旧句下"两块都在第 3 列"也能过）。
        const colOf = (n: StubNode): string | null => cssPropOf(n, [...chain, bottom!, n], RULES, 'grid-column');
        const dispOf = (n: StubNode): string | null => cssPropOf(n, [...chain, bottom!, n], RULES, 'display');
        console.log(`  ----- viewSeat=${seat} · 停靠栏四块解出的 grid-column / display（R11-2：自己=1、自己手牌=1/-1、对手=3、对手手牌=4）-----\n`
          + `  ${bottom!.children.map((n) => `${isClass(n, 'net-info-block') ? String(n.dataset.netSeat) : 'hands'}:`
            + ` grid-column=${String(colOf(n))} display=${String(dispOf(n))}`).join(' · ')}`);
        /** 只占**一列**的写法（`3` 与 `3 / 4` 同义；`1` 与 `1 / 2` 同义）。 */
        const oneColumn = (want: number): RegExp => new RegExp(`^${want}(\\s*/\\s*${want + 1})?$`);
        for (const block of infoBlocks) {
          const side = String(block.dataset.netSeat);
          const want = side === 'self' ? 1 : 3;
          expect(colOf(block), `viewSeat=${seat}：${side} 侧信息块的 grid-column 必须是**第 ${want} 列**`
            + `（R11-2：自己那块在**左**、对手那块在**右**），实际 ${String(colOf(block))}`
            + ' —— 列值必须**不跨列**（跨列就会把手牌挤到一边）').toMatch(oneColumn(want));
        }
        // b) 自己手牌区整行（`1 / -1`）—— "整页中置"的机制本身；对手手牌张数在第 4 列
        const handAreas = handsBlocks[0].children.filter((n) => isClass(n, 'net-hand-area'));
        expect(handAreas.length, `viewSeat=${seat}：.net-hands 里应有两块 .net-hand-area`).toBe(2);
        for (const a of handAreas) {
          const isFoeArea = isClass(a, 'net-hand-area-foe');
          const col = cssPropOf(a, [...chain, bottom!, handsBlocks[0], a], RULES, 'grid-column');
          if (isFoeArea) {
            expect(col, `viewSeat=${seat}：对手手牌张数块的 grid-column 必须是**第 4 列**（对手信息块右侧、`
              + `用户："压缩进对手信息块内"），实际 ${String(col)}`).toMatch(oneColumn(4));
          } else {
            expect(col, `viewSeat=${seat}：自己手牌区的 grid-column 必须是**整行**（\`1 / -1\`）——`
              + '它被限制到某一列之后，手牌就不再"整页中置"（R9-3 的裁决要求手牌仍整页中置）')
              .toMatch(/^1\s*\/\s*-1$/);
          }
        }
        // `.net-hands` **不是** `.net-board` 的 grid item（它是 `display: contents` 的容器），
        // 所以它没有、也不该有 `grid-column`/`grid-row` —— 它的**子节点**（两块手牌区）才是 grid item。
        // 这里按**级联解算**钉住那个 contents（不是文本匹配：写着 `display: contents` 但被后来的
        // 规则覆盖掉，也会在这条上现形）。
        expect(dispOf(handsBlocks[0]), `viewSeat=${seat}：.net-hands 必须是 display: contents `
          + '（否则两块手牌区不是 .net-board 的 grid item，第 6 节的 grid-row 声明还在却**静默不生效**）')
          .toBe('contents');
        expect(dispOf(bottom!), `viewSeat=${seat}：.net-bottom 必须是 display: contents（同上）`)
          .toBe('contents');
        // c) 样式表里**不许有第四个合法值以外的列指派**：R11-2 之后只有四个合法值 ——
        //    自己信息块 `1`（`1 / 2` 同义）、对手信息块 `3`、对手手牌张数 `4`、手牌区整行 `1 / -1`。
        //    任何别的值（`2` / `2 / -1` / `5` / `auto`）都会把某一块挤到它不该在的列上。
        //    ⚠️ 口径与前两版**同形**（R8-5 时只允许 `1 / -1` 一个值，R9-3 时是两个），
        //    只是白名单跟着裁决扩大了 —— 而"每一块**解析出来的**值 == 它的期望值"这条
        //    （上面 ④ 的逐块断言）比白名单强，两者合起来才是完整判据。
        const staleColumnRules = RULES.filter((r) =>
          /(?:^|;|\s)grid-column\s*:/.test(r.body) && /\.net-info-block|\.net-hand-area|\.net-bottom\s*>/.test(r.selector)
          && !/:\s*(?:1\s*\/\s*-1|1(?:\s*\/\s*2)?|3(?:\s*\/\s*4)?|4(?:\s*\/\s*5)?)\s*(?:;|$)/.test(r.body));
        expect(staleColumnRules.map((r) => `${r.selector} { ${r.body.trim()} }`),
          `viewSeat=${seat}：styles-net.css 里仍有把停靠栏四块按**别的列**摆放的规则`
          + '（R11-2 之后只允许"自己=1 / 自己手牌=1 / -1 / 对手=3 / 对手手牌=4"这四种写法）')
          .toEqual([]);
        // ⑤ 手牌区在 DOM 里也**恒在中间**（DOM 位置不是红线的对象，但两处不一致就是
        //    "DOM 对、看着反"的温床 —— 例如有人把信息块 append 到手牌区**之后**）
        const domOrder = bottom!.children.map((n) => (isClass(n, 'net-info-block') ? 'info' : isClass(n, 'net-hands') ? 'hands' : '?'));
        expect(domOrder, `viewSeat=${seat}：底部容器的 DOM 顺序必须是 [信息块, 手牌区, 信息块]`).toEqual(['info', 'hands', 'info']);
        // ⑥ DOM 顺序里的侧别必须等于 `NET_BOTTOM_SIDES`（**改常量必须同时改这两条腿**）
        expect(infoBlocks.map((n) => String(n.dataset.netSeat)), `viewSeat=${seat}：信息块进 DOM 的顺序`
          + `必须等于 NET_BOTTOM_SIDES（现为 [${NET_BOTTOM_SIDES.join(', ')}]）`)
          .toEqual([...NET_BOTTOM_SIDES]);
      }
    } finally {
      await drainRaf();
      restore();
    }
  });

  it('R6-2. 顶部信息条已取消（元素树里不得再有顶部条；信息条只存在于底部行的两块里）', async () => {
    const restore = installDom();
    try {
      for (const seat of [0, 1] as const) {
        const root = renderFrame(seat);
        const all = descendants(root);
        // ① 顶部条的两个类名（R6 之前的 `net-strip` / `net-strip-foe`）**一个都不许再产出**。
        //    为什么这条必须在**行为层**（而不是只查源码文本）：源码删掉 `renderPlayerInfo` 的
        //    顶部调用之后，旧类名仍可能被别处复制回去；而用户的裁决是"顶部信息条取消"。
        const strips = all.filter((n) => isClass(n, 'net-strip') || isClass(n, 'net-strip-foe'));
        expect(strips.map((n) => n.cls), `viewSeat=${seat}：顶部信息条（.net-strip*）仍在产出 `
          + `—— 用户裁决是"顶部信息条取消"（规格 §8.4 第 2 条）`).toEqual([]);
        // ② 样式表里也不得残留顶部条的**规则**（否则"顶部还有一条"这件事在 CSS 里留着证据，且
        //    将来有人把节点加回来就会**静默生效**）。
        //    ⚠️ 判据必须走**规则选择器**（`cssRules` 去注释后解析），不能拿整份 CSS 文本做子串匹配：
        //    本文件的注释里**故意**留着"`.net-strip` 的规则随之删除"这句话（给读者交代历史），
        //    文本匹配会因此假红（我第一版就踩了）。
        const stripRules = RULES.filter((r) => /\.net-strip\b|\.net-strip-foe\b/.test(r.selector));
        expect(stripRules.map((r) => r.selector), 'styles-net.css 里仍有 .net-strip / .net-strip-foe 的规则'
          + '（顶部条已取消；残留规则会让"加回顶部条"变成静默生效）').toEqual([]);
        // ③ 反空集合：顶部条没了，但**信息条本身必须还在**（在底部行的两块里）——
        //    否则"取消顶部条"会退化成"整页没有任何信息条"
        const infos = all.filter((n) => isClass(n, 'player-info'));
        expect(infos.length, `viewSeat=${seat}：页面上必须仍有两条 .player-info（底部行左/右各一条）`)
          .toBe(2);
        const bottom = all.find((n) => isClass(n, 'net-bottom'))!;
        expect(all.filter((n) => isClass(n, 'player-info') && bottom.children.some((b) => b === n
          || descendants(b).includes(n))).length,
        `viewSeat=${seat}：两条 .player-info 必须都挂在底部行（.net-bottom）下`).toBe(2);
      }
    } finally {
      await drainRaf();
      restore();
    }
  });

  it('R6-3. 红线：`.hand` 的 DOM 顺序恒为 [P0, P1]（左右摆放只能由 CSS 决定）', async () => {
    const restore = installDom();
    try {
      for (const seat of [0, 1] as const) {
        const root = renderFrame(seat);
        // ① 全页 `.hand` 的**DOM 顺序**（前序遍历 = 文档顺序）必须是 [P0, P1]
        const hands = descendants(root).filter((n) => isClass(n, 'hand'));
        expect(hands.length, `viewSeat=${seat}：页面上必须恰好两条 .hand`).toBe(2);
        expect(hands.map((n) => String(n.dataset.player)), `viewSeat=${seat}：.hand 的 DOM 顺序必须是 `
          + `[P0, P1]（FX 用 querySelectorAll('.hand')[player] **按下标**读手牌：顺序反了会把特效`
          + `飞到对手手牌区，不报错也不跳过）`).toEqual(['0', '1']);
        // ② 两条手牌必须在**同一个** `.net-hands` 里（不是各自散落）—— 否则 `[player]` 的下标语义
        //    虽然还对，但"一块手牌区"的布局前提被破坏
        const handsRoot = descendants(root).find((n) => isClass(n, 'net-hands'))!;
        const inside = descendants(handsRoot).filter((n) => isClass(n, 'hand'));
        expect(inside.length, `viewSeat=${seat}：两条 .hand 必须都在同一个 .net-hands 里`).toBe(2);
        // ③ **视觉归属由 CSS 决定**（不是 DOM 顺序）：R11-2 起两块手牌区**同在停靠栏那一行**
        //    （`grid-row: 3`），"谁在哪"改由**列**表达 —— 自己那块横跨整行（`1 / -1` ⇒ 整页中置）、
        //    对手那一块在第 4 列（右侧，紧贴对手信息块）。
        //    ⚠️ **R11-2 的判据迁移（不是削弱）**：R8-5~R9-3 期间两侧是**上下镜像**（对手的行号 <
        //    自己），而 R11-2 的裁决恰恰是"对手那一块搬进自己这一行" ⇒ 旧的"行号必须不同"会把
        //    本波的裁决判成失败。新判据换了**轴**（上下 → 左右）并**多查一件事**：
        //    两块手牌区必须**同一行**、且**列不同**（自己整行、对手第 4 列）。
        const handsChain = descendants(root).filter((n) => isClass(n, 'net-board'));
        const areas = handsRoot.children.filter((n) => isClass(n, 'net-hand-area'));
        expect(areas.length, `viewSeat=${seat}：.net-hands 里应有两块 .net-hand-area`).toBe(2);
        const rowOfArea = (a: StubNode): number => {
          const raw = cssPropOf(a, [...handsChain, handsRoot, a], RULES, 'grid-row');
          return raw === null ? Number.POSITIVE_INFINITY : Number.parseInt(raw, 10);
        };
        const colOfArea = (a: StubNode): string | null =>
          cssPropOf(a, [...handsChain, handsRoot, a], RULES, 'grid-column');
        const describeArea = (a: StubNode): string => `P${Number(a.dataset.player) + 1}`
          + `(grid-row ${rowOfArea(a) === Number.POSITIVE_INFINITY ? '无' : rowOfArea(a)},`
          + ` grid-column ${String(colOfArea(a))})`;
        console.log(`  viewSeat=${seat} · 手牌区（CSS 解算）: ${areas.map(describeArea).join(' 然后 ')}`);
        const selfArea = areas.find((a) => isClass(a, 'net-hand-area-self'))!;
        const foeArea = areas.find((a) => isClass(a, 'net-hand-area-foe'))!;
        expect(selfArea, `viewSeat=${seat}：找不到自己那块手牌区（.net-hand-area-self）`).toBeTruthy();
        expect(foeArea, `viewSeat=${seat}：找不到对手那块手牌区（.net-hand-area-foe）`).toBeTruthy();
        // ③-1 **同一行**（停靠栏）：两块手牌区都落在停靠栏那一行
        expect(rowOfArea(foeArea), `viewSeat=${seat}：对手手牌张数块与自己的手牌区必须在**同一行**`
          + `（R11-2：对手那一块搬进自己这一行），实际 ${describeArea(selfArea)} / ${describeArea(foeArea)}`)
          .toBe(rowOfArea(selfArea));
        // ③-2 **列不同**：自己那块整行（`1 / -1`）、对手那块第 4 列（最右）
        expect(colOfArea(selfArea), `viewSeat=${seat}：自己手牌区的 grid-column 必须是整行（\`1 / -1\`）`
          + '（"整页中置"的机制），实际 ' + String(colOfArea(selfArea))).toMatch(/^1\s*\/\s*-1$/);
        expect(colOfArea(foeArea), `viewSeat=${seat}：对手手牌张数块的 grid-column 必须是**第 4 列**`
          + '（对手信息块右侧），实际 ' + String(colOfArea(foeArea))).toMatch(/^4(\s*\/\s*5)?$/);
        // ④ 反空集合：两个行号必须**真的**来自样式表（若规则没了，两块都是 `Infinity`
        //    ⇒ "同一行"会以"都没行号"的形式**碰巧**成立）
        expect([rowOfArea(selfArea), rowOfArea(foeArea)].every((r) => Number.isFinite(r)),
          'styles-net.css 里没有给 .net-hand-area 的 grid-row（"停靠栏那一行"只剩 DOM 顺序这一条腿，'
          + '而这正是红线不许动的）').toBe(true);
        const rowRules = RULES.filter((r) => /(?:^|;|\s)grid-row\s*:/.test(r.body) && /\.net-hand-area/.test(r.selector));
        expect(rowRules.length, 'styles-net.css 里没有针对 .net-hand-area 的 grid-row 规则'
          + '（行号必须来自样式表，不许靠 DOM 顺序）').toBeGreaterThanOrEqual(2);
      }
    } finally {
      await drainRaf();
      restore();
    }
  });

  /**
   * R6 的**CSS 解析边界**（**R8-5 更正**：旧的说明是错的，这里改成**正面守卫**）。
   *
   * 本文件的解析器是简版（`选择器 { 体 }`，**不递归条件块**）。旧注释写的是"`@media` 里的规则
   * **整块被跳过**" —— ⚠️ **实测更正**：`@media` 的**前导**（`@media (max-width: …) `）确实被跳过，
   * 但它**内部**的规则会被当成**无条件规则**混进规则表。R6 时之所以没出问题纯属**巧合**：
   * 那条媒体查询里唯一会给信息块解出 `grid-column: auto` 的选择器组以 `.net-hands` 结尾，
   * 而 `selectorMatches` 是**从右往左**匹配的 ⇒ 对信息块的祖先链天然不命中（不是设计，是运气）。
   *
   * R8-5 把窄屏那套取舍整个删掉了（信息块与手牌区现在**各自一整行**，堆叠就是默认形态；
   * 媒体查询里那三条规则全部无效），所以这条从"承认解析器会漏掉媒体查询"改成**正面守卫**：
   * 本文件**不许再有任何条件块** —— 于是那条真实缺陷对本文件**结构上不可能**触发。
   */
  it('R6-4. styles-net.css 不得再有任何条件块（@media/@supports/@container）—— 解析器不递归它', () => {
    // 判据必须走**去注释**后的源码：注释里当然可以出现 "@media" 这个词（本文件的说明就写了），
    // 拿裸 `netCss` 做 toContain 会被注释满足 —— 那正是本项目反复栽过的"注释补位假绿"。
    expect(stripComments(netCss), 'styles-net.css 里出现了条件块（@media / @supports / @container）'
      + '：简版解析器会把块**内部**的规则当成**无条件规则**混进规则表（R6 的窄屏取舍已随 R8-5 删除，'
      + '现在没有需要条件块的地方）').not.toMatch(/@(?:media|supports|container)\b/);
    const conditionalRules = RULES.filter((r) =>
      /@(?:media|supports|container)/.test(r.selector) || /@(?:media|supports|container)/.test(r.body));
    expect(conditionalRules.map((r) => r.selector), '条件块的规则漏进了解算器的规则表').toEqual([]);
  });

  /**
   * R6-5：**布局引擎之外的两条承重声明**（桩查不到、但一旦丢了页面就整体走样）。
   *
   * 为什么必须单列一条（诚实边界：本文件的解算器只解"哪条声明生效"，**不模拟 flex/grid 的盒模型**）：
   *  - **`.net-grid` 的 `display: grid`**：R1 的"三个纵向的列"是 grid 语义，但样式表里**没有**
   *    写 `display`（`styles.css:23` 的 `.board-grid` 是 `display: flex; flex-direction: column`）
   *    ⇒ 三条线会被**纵向堆成三行**（"三个纵向的列"退化成"三条横带"，正是 R1 要修的观感）。
   *    本文件的层序解算器**看不见**这个（它只查列内的层序），所以必须有一条源码级判据。
   *  - **R8-5 换掉的那一条**：旧版这里钉的是 `.net-bottom` 的三列模板
   *    （`max-content minmax(max-content, auto) max-content`）。**左右三列已不存在**（信息块与
   *    手牌区现在各自一整行），所以判据换成新机制的两条承重声明：
   *      · `.net-board` 必须是 **grid**（`grid-row` 在 flex column 下**完全无效**）；
   *      · `.net-bottom` 与 `.net-hands` 必须是 **`display: contents`**（它们的子节点才可能成为
   *        `.net-board` 的 grid item）——少了这一条，`grid-row` 声明还在却**静默不生效**。
   *    行为腿（真跑 + 展平盒树解出五行）在 `tests/ui/net-board-grid.test.ts` 的 **G-7**；
   *    这条只是"声明真的写了"的**文本代理**（观感仍属人眼项）。
   */
  it('R6-5. 承重布局声明：.net-grid 三列 grid、.net-board 单列 grid、两块底部容器 display: contents', () => {
    const gridRule = RULES.find((r) => r.selector.trim() === '.net-grid');
    expect(gridRule, 'styles-net.css 里找不到 .net-grid 的规则').toBeTruthy();
    expect(gridRule!.body, '.net-grid 没写 display: grid —— 会继承 .board-grid 的 flex column，'
      + '三条线被纵向堆成三行（"三个纵向的列"失效）').toMatch(/display:\s*grid/);
    expect(gridRule!.body, '.net-grid 没有三列模板（三条线并排靠 grid-auto-flow: column，'
      + '写死模板更稳）').toMatch(/grid-template-columns:\s*repeat\(3,/);
    // ── R8-5：两行容器 ──
    const boardRule = RULES.find((r) => r.selector.trim() === '.net-board');
    expect(boardRule, 'styles-net.css 里找不到 .net-board 的规则（五行网格没有容器）').toBeTruthy();
    expect(boardRule!.body, '.net-board 不是 grid —— R8-5 的五行靠 `grid-row` 指派，'
      + '而它在 flex column / block 下完全无效（视觉顺序会静默退回 DOM 顺序）').toMatch(/display:\s*grid/);
    for (const sel of ['.net-bottom', '.net-hands']) {
      const rule = RULES.find((r) => r.selector.trim() === sel);
      expect(rule, `styles-net.css 里找不到 ${sel} 的规则（R8-5 的 display: contents 写在哪？）`).toBeTruthy();
      expect(rule!.body, `${sel} 必须是 display: contents —— 否则它的子节点不是 .net-board 的 grid item，`
        + '第 6 节的 `grid-row` 声明还在却**静默不生效**（视觉顺序悄悄退回 DOM 顺序）')
        .toMatch(/display:\s*contents/);
    }
  });

  /* ==========================================================================
   * G2 修正 R7：**容器层级**（用户实机截图确认"各种组件位置完全错误"）
   *
   * 事故形态（已确诊，不重排查）：`renderNetBoard` 把 **5 个子节点**都挂进了 `.net-grid`
   * （3 条线的列 + 控制轨 + **底部行**），而 `.net-grid` 的列模板只有 **3 条显式轨道** ⇒
   * 第 4、5 个成为**隐式列**排在同一行右侧 ⇒ 整页"一行五格、下方大片空白、右侧多出滚动条"。
   * 另一处并行成因：`.net-board` **一条子节点布局规则都没有**（纵向堆叠靠 `.board` 的 flex，
   * 所以那次崩塌在样式表里不留痕迹）。
   *
   * 这一组是它的**行为腿**（桩里没有布局引擎，但元素树、父子归属、以及从样式表解出的
   * **列模板轨道数**都是确定性的）：
   *  · R7-1 真跑 `renderNetBoard` 查元素树（4 个子节点 / 兄弟关系 / 顺序 / 手牌红线）；
   *  · R7-2 从 `styles-net.css` **真实解析**列模板（4 条轨道、3 条等宽、控制轨固定宽）；
   *  · R7-3 把两条腿**互钉**：轨道数 == 真实渲染出的 `.net-grid` 子节点数（两个席位）。
   *    ⚠️ 这一条是变异杀手：把 `bottom` 挂回 `grid`（5 ≠ 4）或把控制轨从列模板里去掉
   *    （3 ≠ 4）都立刻红。
   * ⚠️ 诚实边界：桩没有布局引擎 —— "画面到底对不对"仍只能人眼（见报告 §7/§8）。
   * ======================================================================== */

  it('R7-1. 真跑 renderNetBoard：.net-grid 恰好 4 个子节点（3 条线 + 控制轨），底部行是它的**兄弟**', async () => {
    const restore = installDom();
    try {
      for (const seat of [0, 1] as const) {
        const root = renderFrame(seat);
        const wrap = root.children[0];
        expect(wrap, `viewSeat=${seat}：root 下没有渲染根（renderNetBoard 没挂 wrap？）`).toBeTruthy();
        expect(isClass(wrap, 'net-board'), `viewSeat=${seat}：渲染根不是 .net-board`).toBe(true);
        expect(isClass(wrap, `net-view-${seat}`),
          `viewSeat=${seat}：渲染根缺 net-view-${seat} 类（约束 9 的座位锚点）`).toBe(true);

        const tree: string[] = [];
        walk(wrap, 0, tree, 2);
        console.log(`\n===== viewSeat=${seat} · 渲染根 .net-board 的元素树（DOM 顺序，深度 2）=====\n${tree.join('\n')}`);

        const grid = wrap.children.find((n) => isClass(n, 'net-grid'));
        const bottom = wrap.children.find((n) => isClass(n, 'net-bottom'));
        expect(grid, `viewSeat=${seat}：.net-board 下找不到 .net-grid`).toBeTruthy();
        expect(bottom, `viewSeat=${seat}：.net-board 下找不到 .net-bottom（底部行被挂到哪儿去了？）`).toBeTruthy();

        // ── ① `.net-grid` 的子节点**恰好 4 个**：3 条线 + 1 个控制轨（**不得**含底部行）──
        expect(grid!.children.length, `viewSeat=${seat}：.net-grid 必须恰好 4 个子节点（3 条 .net-lane-band `
          + `+ 1 个控制轨），实际 ${grid!.children.length} 个 → ${grid!.children.map((n) => n.cls).join(' | ')}`
          + '（列模板只有 4 条显式轨道，多出来的子节点会变成**隐式列** ⇒ 整页"一行五格"）').toBe(4);
        expect(grid!.children.filter((n) => isClass(n, 'net-lane-band')).length,
          `viewSeat=${seat}：.net-grid 里必须有 3 条 .net-lane-band`).toBe(3);
        expect(grid!.children.filter((n) => isClass(n, 'control-module')).length,
          `viewSeat=${seat}：.net-grid 里必须有 1 个控制轨容器 .control-module（A 类钩子的产出方）`).toBe(1);
        // 反面（R7 的缺陷形态本身）：底部行**不得**出现在 `.net-grid` 的子树里
        expect(descendants(grid!).some((n) => isClass(n, 'net-bottom')),
          `viewSeat=${seat}：.net-bottom 出现在 .net-grid 的**子树**里 —— 它必须是 .net-grid 的兄弟`
          + '（挂回 grid = 第 5 个隐式列，R7 的崩塌形态）').toBe(false);

        // ── ② 底部行是 `.net-grid` 的**兄弟**：父节点就是 `.net-board` ──
        expect(bottom!.parentElement, `viewSeat=${seat}：.net-bottom 的父节点不是 .net-board`)
          .toBe(wrap);
        expect(bottom!.parentElement, `viewSeat=${seat}：.net-bottom 的父节点居然是 .net-grid`)
          .not.toBe(grid);

        // ── ③ `.net-board` 的子节点顺序：[.net-grid, .net-bottom, …]（其余是导出按钮 / 工具条）──
        const kinds = wrap.children.map((n) => (isClass(n, 'net-grid') ? 'grid'
          : isClass(n, 'net-bottom') ? 'bottom'
            : isClass(n, 'log') ? 'log'
              : isClass(n, 'diag-btn') ? 'diag-btn'
                : isClass(n, 'net-preview-bar') ? 'preview-bar' : `?${n.cls}`));
        console.log(`  viewSeat=${seat} · .net-board 子节点顺序（DOM）: ${kinds.join(' → ')}`);
        expect(kinds[0], `viewSeat=${seat}：.net-board 的第一个子节点必须是 .net-grid`).toBe('grid');
        expect(kinds[1], `viewSeat=${seat}：.net-board 的第二个子节点必须是 .net-bottom（纵向堆在网格之下）`)
          .toBe('bottom');
        expect(kinds.slice(2).every((k) => k === 'diag-btn' || k === 'preview-bar'),
          `viewSeat=${seat}：.net-board 下出现了未登记的容器：${kinds.slice(2).join(', ')}`).toBe(true);
        // 反空集合：导出按钮必须仍在渲染根下（"搬到 grid 外面"不许顺手把它弄丢）
        expect(kinds.filter((k) => k === 'diag-btn').length, '导出日志按钮必须仍挂在 .net-board 下').toBe(1);
        // ── R12-1：事件日志块**不再渲染**（用户："取消日志的显示"）──
        //    它曾经占 72px（现在全部还给放牌区）；"看日志"由导出按钮承担（诊断文本里含完整日志）。
        expect(kinds.filter((k) => k === 'log').length,
          '事件日志块（.log）又被渲染出来了 —— R12-1 的裁决是取消它的显示（放牌区需要那 72px）').toBe(0);
        expect([kinds.filter((k) => k === 'grid').length, kinds.filter((k) => k === 'bottom').length],
          `viewSeat=${seat}：.net-grid / .net-bottom 在渲染根下必须各恰好一个`).toEqual([1, 1]);

        // ── ④ 红线：`.net-hands` 仍在底部行里，且 `.hand` 的 DOM 顺序仍恒为 [P0, P1] ──
        const handsRoot = descendants(bottom!).filter((n) => isClass(n, 'net-hands'));
        expect(handsRoot.length, `viewSeat=${seat}：底部行里必须恰好一个 .net-hands`).toBe(1);
        expect(handsRoot[0].parentElement, `viewSeat=${seat}：.net-hands 的直接父节点必须是 .net-bottom`)
          .toBe(bottom);
        const hands = descendants(handsRoot[0]).filter((n) => isClass(n, 'hand'));
        expect(hands.length, `viewSeat=${seat}：页面上必须恰好两条 .hand`).toBe(2);
        expect(hands.map((n) => String(n.dataset.player)),
          `viewSeat=${seat}：.hand 的 DOM 顺序必须是 [P0, P1]（FX 用 querySelectorAll('.hand')[player] `
          + '**按下标**读手牌 —— 搬动容器时不许顺手改这个顺序）').toEqual(['0', '1']);
      }
    } finally {
      await drainRaf();
      restore();
    }
  });

  it('R7-2. CSS：.net-grid 的列模板必须解出**4 条轨道**（3 条等宽 + 控制轨固定宽，且与控制轨同宽）', () => {
    const board = cssNode('board', 'net-board');
    const grid = cssNode('board-grid', 'net-grid');
    const rail = cssNode('control-module');
    const raw = cssPropOf(grid, [board, grid], RULES, 'grid-template-columns');
    expect(raw, 'styles-net.css 里 .net-grid 没有 grid-template-columns（列模板被删？）').toBeTruthy();
    const tracks = gridTracks(raw!);
    console.log(`\n===== .net-grid 的列模板（由 styles-net.css 真实解析）=====\n  ${raw}`
      + `\n  轨道数 = ${tracks.length}：${tracks.join(' | ')}`);

    // ① 轨道数 = 3 条线 + 控制轨（**显式**轨道；隐式列不在这里出现 —— 那正是缺陷）
    expect(tracks.length, `列模板必须恰好 4 条显式轨道（3 条线 + 控制轨），实际 ${tracks.length} 条：`
      + `${tracks.join(' | ')}（少于 .net-grid 的子节点数时，多出来的子节点会成为**隐式列**）`).toBe(4);
    // ②③ 前 3 条 = 三条线，**等宽**，且必须是**内容宽**（R9-1 的判据迁移，**不是放松**）
    //    R7 时这三条是 `minmax(0, 1fr)`（撑满 1010px），判据写的是"含 `1fr`"；
    //    R9-1（用户第三次反馈"链路的宽度……也能够缩小了"）把它们改成 `max-content`：
    //    三条轨道贴合卡片与协议，`width: fit-content` 让整个链路框贴着卡走。
    //    ⚠️ 判据对象从"是不是 1fr"换成"**不是** 1fr 族，且必须是内容宽族"——
    //    它仍然抓得住 R7 原本要防的东西（**三条线不等宽** ⇒ 有一条被拉伸/塌掉），
    //    并**多抓一件事**：把轨道改回 `1fr`（链路框重新撑满宿主、比卡片宽得多）会立刻红。
    //    为什么不能直接删掉这条断言：删了之后"轨道数"之外的唯一约束就只剩 ④ 的固定宽，
    //    三条线各写一个不同值（`max-content minmax(0,1fr) auto`）也能全绿 —— 那正是"看着
    //    像三条等宽的列、实际不是"的形态。
    const laneTracks = tracks.slice(0, 3);
    expect(laneTracks.filter((t) => /\d?fr\b/.test(t)).map((t) => t),
      `前 3 条轨道不得是 \`1fr\` 族（那是 R7 的"撑满 max-width"写法；R9-1 要求链路框**贴合卡片**，`
      + `实际 ${laneTracks.join(' | ')}）`).toEqual([]);
    expect(laneTracks.every((t) => /content/.test(t)),
      `前 3 条轨道必须是**内容宽**族（\`max-content\` / \`min-content\` / \`fit-content\`），`
      + `实际 ${laneTracks.join(' | ')} —— 否则链路框会比卡片宽得多（用户第三次反馈的第一句）`).toBe(true);
    expect(new Set(laneTracks).size, `三条线的列必须**同宽**（同一份轨迹值），实际 ${laneTracks.join(' | ')}`).toBe(1);
    // ④ 第 4 条 = 控制轨的固定宽（px；不能是 1fr/auto —— 那会让控制轨被拉伸或塌掉）
    const railW = resolveCssValue([board, grid], RULES, tracks[3]);
    expect(railW, `第 4 条轨道（控制轨）必须是固定宽，实际 ${tracks[3]}（解算后 ${railW}）`)
      .toMatch(/^\d+(?:\.\d+)?px$/);
    // ⑤ 列宽与**控制轨自己的宽**必须同值（`100%` = 填满轨道，也算同值）——
    //    R6 的遗留 `max-width: 460px` 这种"轨道 160px、内容 460px"就是被这一条抓住的
    const railChain = [board, grid, rail];
    const ctrlW = cssPropOf(rail, railChain, RULES, 'width');
    expect(ctrlW, '控制轨（.control-module）没有 width —— 它会退回 .control-module 的默认宽度')
      .toBeTruthy();
    const ctrlWResolved = resolveCssValue(railChain, RULES, ctrlW!);
    expect([railW, '100%'], `控制轨的宽（${ctrlW} → 解算 ${ctrlWResolved}）既不是第 4 条轨道的宽`
      + `（${railW}）也不是 100%（填满轨道）—— 轨道与内容会错位`).toContain(ctrlWResolved);
  });

  it('R7-3. 两条腿互钉：列模板的**轨道数** == 真实渲染出的 `.net-grid` 子节点数（两个席位）', async () => {
    const board = cssNode('board', 'net-board');
    const grid = cssNode('board-grid', 'net-grid');
    const raw = cssPropOf(grid, [board, grid], RULES, 'grid-template-columns');
    expect(raw, 'styles-net.css 里 .net-grid 没有 grid-template-columns').toBeTruthy();
    const tracks = gridTracks(raw!);
    const restore = installDom();
    try {
      for (const seat of [0, 1] as const) {
        const root = renderFrame(seat);
        const rendered = root.children[0].children.find((n) => isClass(n, 'net-grid'));
        expect(rendered, `viewSeat=${seat}：渲染树里找不到 .net-grid`).toBeTruthy();
        expect(rendered!.children.length, `viewSeat=${seat}：列模板有 ${tracks.length} 条显式轨道，`
          + `而 .net-grid 真实挂了 ${rendered!.children.length} 个子节点`
          + `（${rendered!.children.map((n) => n.cls).join(' | ')}）—— 多出来的会成为**隐式列**`
          + '排在同一行右侧（R7 的崩塌形态）；少一条轨道则会扯掉一个组件').toBe(tracks.length);
      }
    } finally {
      await drainRaf();
      restore();
    }
  });

  /**
   * R7-4：把"座位锚点自查不再误报"钉在**真跑出来的那棵树**上。
   *
   * 为什么 R7-1/2/3 不够：那三条钉的是**容器层级**；而 约束 9 的假红是**自查代码自己**的缺陷
   * （`scope.querySelectorAll` 只搜后代，而 `scope` 就是那个 `.net-board`）。它只能靠"把真实渲染出的
   * 渲染根喂回 `verifyPageHooks`"证明 —— 合成页（`render-net.test.ts` 第 20 条）证明的是同一件事的
   * 另一半：**整份**自查在正常形态下 ✓、且三条反面用例仍会报错。
   *
   * ⚠️ **诚实边界（写在用例里）**：本桩不实现选择器引擎 ⇒ A 类钩子的探针恒 0 ⇒ 整份自查在桩上必然 ✗。
   * ⚠️ **本轮变异实测的教训（第一版这条断言是空的）**：`verifyPageHooks` 的返回值只带 `fatal[0]`
   *    （工具条只有一行），而桩上的 `fatal[0]` 永远是 A 类钩子的"数量 0，期望 6" ⇒ 对**返回值**做
   *    `not.toContain('视图座位锚点')` 是**恒真**的，M3 变异（退回只搜后代）时它照样绿。
   *    所以这里改成读 `console.warn` 的**完整失败清单**（`fatal.join('\n')` 全在里面），
   *    并用"warn 必须真的被调用过"保证`not.toContain` 不是被空输出满足的。
   */
  it('R7-4. 真跑一帧：约束 9 的**座位锚点**自查不得再误报（渲染根自己就是一个 .net-board）', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const restore = installDom();
    try {
      for (const seat of [0, 1] as const) {
        const root = renderFrame(seat);
        const wrap = root.children[0] as unknown as HTMLElement;
        const note = verifyPageHooks(wrap, seat);
        const warned = warn.mock.calls.map((c) => c.map(String).join(' ')).join('\n');
        console.log(`\n===== viewSeat=${seat} · 桩上真跑 verifyPageHooks =====\n  返回值：${note}\n`
          + `  完整失败清单（console.warn）：\n${warned.split('\n').map((l) => '    ' + l).join('\n')}`);
        expect(note, `viewSeat=${seat}：verifyPageHooks 什么都没返回（自查没跑起来？）`).toMatch(/^自查/);
        // 反空集合：桩上必然有失败项（A 类钩子探针恒 0）—— 有失败项，下面那句 not.toContain 才有意义
        expect(warned, `viewSeat=${seat}：桩上居然没有任何失败项？那下面的判据是被"空输出"满足的`)
          .not.toBe('');
        expect(warned, `viewSeat=${seat}：渲染根就是 .net-board.net-view-${seat}，完整失败清单里却仍报`
          + '"座位锚点"不一致 —— 这正是 R7 修掉的那处假红（`querySelectorAll` 只搜后代、不搜自身）')
          .not.toContain('视图座位锚点');
      }
    } finally {
      await drainRaf();
      restore();
      warn.mockRestore();
    }
  });
});

/* ============================================================================
 * G2 修正 R8-2 收尾（独立评审的 C-1 / I-1 / I-4）：**三条"看起来已经实现、
 * 其实没有任何机检"的承重声明**
 *
 *  · **C-1**：点数 >10 的溢流数字被甩到**整块棋盘**上。成因是两条：①它是 `position: absolute`
 *    而 `.battery` 在本页被中和成 `static`（`.net-side`/`.net-lane-band`/`.net-grid` 都没有
 *    position）⇒ 包含块一路退化到 `.net-board`；②`.battery` 与 `.battery-overflow` **共用一条
 *    规则体**、体里 `transform: none` ⇒ 它自己的 `translateY(-50%)` 被覆盖。修法是把它变成
 *    `.battery` 的**流内 flex 项**（`position: static`），从根上取消"依赖 positioned 祖先"这件事。
 *  · **I-1**：整条 `.scan-horiz` 横扫链**零守卫**（评审的 5 条变异全绿）。
 *  · **I-4**：`.net-lane-band .stack-slot .battery` 是死选择器兼"防弹衣"（把"能量槽挂回槽内"
 *    的错误形态中和成好看的样子）—— 删掉后，本组的行为腿与 `render-net.test.ts` 的 CSS 腿
 *    会一起报红。
 *
 * ⚠️ **诚实边界（本组统一）**：桩没有布局引擎 —— "数字到底压在哪个像素上""横条好不好看"
 * 只能人眼在 5173 上验。本组能证明的是**声明层（由样式表真实解算）+ 元素树**：
 * 哪些声明在目标链上生效、节点挂在哪、类被加还是被删。
 * ========================================================================== */

describe('R8-2 收尾 · C-1 溢流数字 / I-1 横扫链 / I-4 防弹衣', () => {
  /** 祖先链（**类名造桩**，不装 DOM）：`.net-board > .net-grid > .net-lane-band > .net-side > …`。 */
  const chainOf = (...classes: string[]): StubNode[] =>
    ['net-board', 'net-grid', 'net-lane-band', 'net-side', ...classes].map((c) => cssNode(c));

  /**
   * **剔掉关键帧/@ 产物**的规则表（本组所有"按选择器语义解算属性"的检查都用它）。
   *
   * ⚠️ 为什么必须：本文件的 `cssRules` 是**简版**解析器，`@keyframes` 的每一步会被切成一条
   * "选择器 = `from` / `to` / `0%` / `100%`"的怪规则 —— 而这类**空类**选择器在
   * `compoundMatches` 下**命中一切**（`need.every(...)` 对空集恒真）。后果是**假绿**：
   * 删掉真正的 `.net-lane-band .battery-overflow { transform: none }` 之后，
   * `@keyframes net-battery-cell-in` 里的 `transform: translateX(8px)` 会顶上来满足断言
   * （我第一版就撞上了这个 —— 必须在这里把它挡掉，否则本组的 C-1 腿是假的）。
   * ⚠️ 这不是"放松判据"：被剔掉的只有**关键帧步骤**与 `@` 规则，真选择器一条不少。
   * ⚠️ **M-1′ 修正**：`%` 那条必须**锚定成"整条选择器就是一个百分比"**（`/^\d+(?:\.\d+)?%$/`）。
   *    旧写法 `sel.includes('%')` 会顺手剔掉**真规则** —— 例如
   *    `.net-lane-band .battery-overflow[data-foo*="%"] { position: absolute }`
   *    （选择器里出现 `%` 的合法形态）会被静默丢弃 ⇒ 一条真的会生效的覆盖在守卫里**隐形**。
   *    `from`/`to` 保持**精确匹配**（`/^(?:from|to)$/`），同理。
   */
  const REAL_RULES: CssRule[] = RULES.filter((r) => {
    const sel = r.selector.trim();
    if (sel === '' || sel.startsWith('@')) return false;
    if (/^(?:from|to|\d+(?:\.\d+)?%)$/.test(sel)) return false;
    return true;
  });

  /**
   * 一条规则是否把 `node` 当作**选择器主体**（最后一段复合选择器）命中。
   *
   * ⚠️ 为什么不能用裸 `selectorMatches`：它允许主体绑到链上的**任意祖先**（对"链尾就是被查的
   * 节点"的 `order` 用法够用），于是 `.net-lane-band .battery` 会被算成"也命中 `.battery-overflow`"
   * （链上有个 `.battery` 祖先）—— C-1 的"共享规则体"判据会被这条**假命中**搞成假红。
   * 选择器组（`.a, .b { }`）**逐段**判：C-1 的原始形态正是"一条体写给两个元素"。
   */
  function ruleHitsAsSubject(rule: CssRule, node: StubNode, chain: StubNode[]): boolean {
    return rule.selector.split(',').some((segRaw) => {
      const seg = segRaw.trim();
      if (seg === '') return false;
      const parts = seg.split(/\s+/).filter(Boolean);
      return compoundMatches(parts[parts.length - 1], node) && selectorMatches(seg, chain);
    });
  }

  /**
   * **本解析器不建模、但浏览器里能压过一切类规则的层叠形态**：命中即**抛错**（响亮）。
   *
   * 评审实测（三条都曾**全绿**，而浏览器里三条都真的生效、C-1 原样复现）：
   *  · `#x .battery-overflow { position: absolute }` —— ID 在旧权重模型里被算成 0，规则被当成"没命中"；
   *  · `.net-lane-band .battery-overflow { position: absolute !important }` —— `!important` 被丢弃；
   *  · `.battery-overflow { transform: translateY(-50%) !important }` —— 低权重的 `!important`
   *    在源序/权重上都该输给 `.net-lane-band .battery-overflow`，浏览器里却赢。
   *
   * **为什么"报错"而不是"支持"**：`!important` 的胜出顺序（important 之间按权重、再按源序，
   * 且与普通声明分层）与 ID 的匹配（桩节点**没有 id**，`#x` 在本模型里根本无法命中）都不是
   * 三行正则能模型化的东西 —— 半吊子"支持"只会把假绿换成更难发现的假绿。**禁掉**才是安全解：
   * 一旦这类形态出现在"管能量槽"的规则里，守卫就拒绝回答（而不是猜一个答案）。
   *
   * ⚠️ 判定"这条规则是否在讲这个元素"时，先把 ID 从选择器里**剥掉**再比主体/祖先链：
   *    `#x .battery-overflow` 剥成 `.battery-overflow` ⇒ 主体确实是溢流数字 ⇒ 报错。
   *    不剥的话 `#x` 会让 `compoundMatches` 直接判"不命中"，于是这条规则被**放过**（旧行为）。
   */
  function assertModelableCascade(
    node: StubNode, chain: StubNode[], rules: CssRule[], prop: string,
  ): void {
    const re = new RegExp(`(?:^|;|\\s)${prop}\\s*:\\s*([^;]+)`);
    for (const r of rules) {
      const m = re.exec(r.body);
      if (!m) continue;
      const important = /!important/i.test(m[1]);
      for (const segRaw of r.selector.split(',')) {
        const seg = segRaw.trim();
        if (seg === '') continue;
        const hasId = /#/.test(seg);
        const readsInline = /\[style\b|\bstyle\s*=/.test(seg);
        if (!important && !hasId && !readsInline) continue;
        const stripped = seg.replace(/#[\w-]+/g, ' ').replace(/\s+/g, ' ').trim();
        const parts = stripped.split(/\s+/).filter(Boolean);
        if (parts.length === 0) continue;
        if (!compoundMatches(parts[parts.length - 1], node)) continue;
        if (!selectorMatches(stripped, chain)) continue;
        const why = important ? `声明带 \`!important\`（${prop}: ${m[1].trim()}）`
          : hasId ? '选择器含 **ID**（`#…`）'
            : '选择器在读**内联样式**（`[style…]`）';
        throw new Error(`[R8-2 C-1 守卫] ${why}，而本解析器只建模"类/属性选择器 + 权重 + 源序"：`
          + `这类形态在浏览器里会压过它、在守卫里却是**隐形**的（C-1 那族"守卫全绿、页面照错"）。`
          + `禁止用 \`${seg}\` 覆盖能量槽的 \`${prop}\` —— 请改用明确的类选择器，`
          + `或把这条规则从 styles-net.css 里删掉。`);
      }
    }
  }

  /**
   * 与 `cssPropOf` **同一套解算规则**（权重优先、同权重取源序靠后），但只认把 `node` 当
   * **选择器主体**的规则。
   *
   * ⚠️ 为什么本组一律用它而不是 `cssPropOf`：后者用的 `selectorMatches` 允许主体绑到链上的
   * **任意祖先** ⇒ `.net-lane-band .battery { position: static }` 会被算成"也管 `.battery-overflow`"
   * （链上有个 `.battery` 祖先）。实测后果：C-1 的变异（把 `position: static` 从溢流数字上挪走、
   * 只留"共享体 + transform:none"）会被这条**假命中**掩盖 —— 只有主体判据能抓到它。
   *
   * ## 等价条件（与 `specificityOf` 的头注同一条，这里再钉一次，因为它才是"用的人会踩的坑"）
   * 本助手**只**在本文件当前的规则形态下等价于浏览器级联：**纯类/属性选择器** + **无 `!important`**
   * + **无 ID** + **无内联样式** + 解算**非继承**属性。前四条由 `assertModelableCascade` **强制**
   * （命中即抛错，不猜）；第五条由本组的属性清单保证（`position`/`transform`/`order`/`flex`/
   * `min-width`/`display`/`flex-direction`/`animation-name` 全非继承）。
   * ⚠️ `cssPropOf`（不带 Subject）**没有**这层保护 —— 它是给 `order`/`grid-column` 等
   * "链尾即被查节点"的老用法用的，别拿它做新的承重判据。
   */
  function cssPropOfSubject(
    node: StubNode, chain: StubNode[], rules: CssRule[], prop: string,
  ): string | null {
    assertModelableCascade(node, chain, rules, prop);
    let best: { spec: number; no: number; raw: string } | null = null;
    const re = new RegExp(`(?:^|;|\\s)${prop}\\s*:\\s*([^;]+)`);
    for (const r of rules) {
      const m = re.exec(r.body);
      if (!m) continue;
      if (!ruleHitsAsSubject(r, node, chain)) continue;
      const spec = specificityOf(r.selector);
      if (!best || spec > best.spec || (spec === best.spec && r.no > best.no)) {
        best = { spec, no: r.no, raw: m[1].trim() };
      }
    }
    return best ? best.raw : null;
  }

  /** `@keyframes <name> { … }` 的整块体（花括号配平）。
   *  ⚠️ **不能用本文件的 `cssRules`**：它按 `选择器 { 体 }` 切，而 keyframe 体里**还有**一对
   *  花括号 —— `100%` 那一步会被切成一条"选择器 = `@keyframes x { 12%`"的怪规则（静默失去判别力）。
   *  这正是不写这个解析器就"看起来验过了"的地方。 */
  function keyframesBody(name: string): string | null {
    const src = stripComments(netCss);
    const at = src.indexOf(`@keyframes ${name}`);
    if (at < 0) return null;
    const open = src.indexOf('{', at);
    if (open < 0) return null;
    let depth = 0;
    for (let i = open; i < src.length; i += 1) {
      if (src[i] === '{') depth += 1;
      else if (src[i] === '}') { depth -= 1; if (depth === 0) return src.slice(open + 1, i); }
    }
    return null;
  }

  /** keyframe 块内 `0% { … }` / `100% { … }` / `from { … }` / `to { … }` 的**体**。 */
  function keyframeStep(body: string, step: string): string | null {
    const m = new RegExp(`(?:^|\\})\\s*${step}\\s*\\{([^}]*)\\}`).exec(body);
    return m === null ? null : m[1];
  }

  it('G-5. C-1 样式腿：溢流数字是**流内 flex 项**（static / transform 未被覆盖 / 盒内左端），且不与 `.battery` 共享规则体', () => {
    const batteryChain = chainOf('battery');
    const battery = batteryChain[batteryChain.length - 1];
    const overflowChain = chainOf('battery', 'battery-overflow');
    const overflow = overflowChain[overflowChain.length - 1];

    const batPos = cssPropOfSubject(battery, batteryChain, REAL_RULES, 'position');
    const ofPos = cssPropOfSubject(overflow, overflowChain, REAL_RULES, 'position');
    const ofTransform = cssPropOfSubject(overflow, overflowChain, REAL_RULES, 'transform');
    console.log(`\n===== C-1 · styles-net.css 里溢流数字的生效声明（由样式表真实解算）=====\n`
      + `  .net-lane-band .battery           position = ${batPos}\n`
      + `  .net-lane-band .battery-overflow  position = ${ofPos} / transform = ${ofTransform}`
      + ` / order = ${cssPropOfSubject(overflow, overflowChain, REAL_RULES, 'order')}`
      + ` / flex = ${cssPropOfSubject(overflow, overflowChain, REAL_RULES, 'flex')}`);

    // ① **不是绝对定位**（C-1 的直接成因）：绝对定位时它的包含块会退化到 `.net-board`
    //    （它与视口之间**唯一**的 positioned 祖先）⇒ 数字落在整块棋盘的竖直中点、水平最左 +4px。
    expect(ofPos, '远程页 `.battery-overflow` 仍是 `position: absolute`（或没有 net 规则中和它）——'
      + '它的包含块会退化到 `.net-board`，数字被甩到**整块棋盘**的竖直中点、水平最左（C-1）')
      .toBe('static');
    // ② `transform` 必须被**它自己的**规则中和：styles.css 的 `translateY(-50%)` 是竖版居中；
    //    "与 `.battery` 共享规则体 + 体里 transform:none"那种写法会让它既丢居中、又保持绝对定位。
    expect(ofTransform, '远程页 `.battery-overflow` 的 `transform` 没有被中和 ——'
      + 'styles.css 的 `translateY(-50%)` 是**竖版**居中；横置后垂直居中应由父级 `align-items: center` 承担')
      .toBe('none');
    // ③ **不存在"共享规则体"形态**：没有任何一条规则**同时**被 `.battery` 链与 `.battery-overflow`
    //    链**当作主体**命中、且体里写了 position/transform。那正是 C-1 的写法（一条体写给两个元素）。
    const shared = REAL_RULES.filter((r) => /(?:^|;|\s)(?:position|transform)\s*:/.test(r.body)
      && ruleHitsAsSubject(r, battery, batteryChain) && ruleHitsAsSubject(r, overflow, overflowChain));
    expect(shared.map((r) => r.selector), 'styles-net.css 里存在一条**同时**命中 `.battery` 与'
      + ' `.battery-overflow` 的规则体（并写了 position/transform）—— 这正是 C-1 的形态：'
      + '数字继承了 `.battery` 的 `transform: none`，自己却仍是绝对定位').toEqual([]);
    // ④ 静态判定"positioned 祖先链里没有 `.net-board`"（两种可静态判定的形态必居其一）：
    //    数字是 `static`（①已钉）**或** `.battery` 是 `relative`（能当包含块）。
    expect(ofPos === 'static' || batPos === 'relative', '`.battery-overflow` 既不是 static、'
      + '`.battery` 也不是 relative ⇒ 它的包含块是 `.net-board`（C-1 的包含块退化路径）').toBe(true);
    // ⑤ 反空集合：`.battery` 自身也不得是绝对定位（否则 styles.css 的绝对定位接管，包含块变成
    //    `.net-board`、`top/bottom: 6px` 把它拉成整板高 —— 与 render-net.test.ts 的 R1-1 同一件事，
    //    这里从**链上**再钉一次。⚠️ 回退形态里那条 `left/right:-120px` 对 **static** 元素不适用
    //    （CSS 2.1 §9.4.3）⇒ 它不产生位移，第二轮 M-2′ 的更正见 styles-net.css 的注释）
    expect(batPos, '`.net-lane-band .battery` 不是 static/relative（styles.css 的绝对定位会生效）')
      .toMatch(/^(?:static|relative)$/);
    // ⑥ **流内项的完整形状**：`order: -1`（落左端）+ `flex: 0 0 auto`（不参与压缩），
    //    外壳让位交给 `min-width: 0`（见下一条 —— R8-2 第二轮 I-2′ 说明）。
    expect(cssPropOfSubject(overflow, overflowChain, REAL_RULES, 'order'),
      '`.battery-overflow` 没有 `order: -1` —— 它在 DOM 里是**外壳之后**的兄弟，'
      + '不加 order 就会落在能量槽**右端**（与"从右往左点亮"的头部不同侧）').toBe('-1');
    expect(cssPropOfSubject(overflow, overflowChain, REAL_RULES, 'flex'),
      '`.battery-overflow` 的 flex 不是 `0 0 auto`（它会被压缩/拉伸，数字变形）').toMatch(/0\s+0\s+auto/);
    const shellChain = chainOf('battery', 'battery-shell');
    const shell = shellChain[shellChain.length - 1];
    // ⚠️ **R8-2 第二轮 · I-2′：这里原本还有一条 `.battery-shell` 的 `flex: 1 1 auto` 断言，已删除。**
    //    为什么删（评审实测 + 复算一致）：`.battery-shell` 有 `width: 100%`，在 row flex 里
    //    `flex-basis: auto` 取的就是那个 `width` —— **单子项**时 `flex-grow` 恒不可见，
    //    有溢流数字时起作用的是 `flex-shrink`（默认值就是 1）⇒ `flex: 1 1 auto` 与 `flex: 0 1 auto`
    //    在这两种形态下**渲染等价**。实测：删掉 `flex: 1 1 auto` ⇒ 本文件 18 passed 全绿（**正确的绿**），
    //    而等价写法 `flex: 0 1 auto` 反而报红 ⇒ 那条断言认的是**写法**、不是行为（假红方向）。
    //    真正**有牙齿**的是下面 `min-width: 0`（改成 `auto` 会红：10 格 `flex: 1 1 0` 的自动最小
    //    尺寸下界会把外壳顶回原宽）。删这一条**不是放松整条 G-5**：本用例其余断言
    //    （`position: static`／不与 `.battery` 共享规则体／`order: -1`／`flex: 0 0 auto`／
    //    `display: flex`／`flex-direction: row`／`min-width: 0`）一条未动，且新增了 G-5c。
    expect(cssPropOfSubject(shell, shellChain, REAL_RULES, 'min-width'), '`.battery-shell` 没有 `min-width: 0`'
      + '（10 格 `flex: 1 1 0` 的内容下界会把外壳顶回原宽，数字仍溢出）').toBe('0');
    // ⑦ 父级必须是**横排 flex**（`order`/`flex` 只在 flex 容器里有意义）
    expect(cssPropOfSubject(battery, batteryChain, REAL_RULES, 'display'), '`.net-lane-band .battery` 不是 flex 容器')
      .toBe('flex');
    expect(cssPropOfSubject(battery, batteryChain, REAL_RULES, 'flex-direction'))
      .toMatch(/^row$/);
  });

  /**
   * **G-5c：C-1 守卫自身的盲区**（R8-2 第二轮 · I-1′ + M-1′ —— "守守卫的那条腿"）。
   *
   * G-5 有多可信，完全取决于两件事：①`REAL_RULES` 没有把**真规则**悄悄剔掉；
   * ②解算器**不建模**的层叠形态（`!important` / ID / 内联样式）没有藏在样式表里。
   * 评审两轮实测证明这两件都能**静默**发生（第一轮：keyframe 产物顶替真声明；第二轮：
   * `%` 过滤过宽会剔掉真规则、`#x` 在旧权重模型里被算成 0）。所以这里把**守卫的输入**也钉住 ——
   * 这是本组唯一一条"不查某个属性值、只查规则集合与解析器前提"的腿。
   */
  it('G-5c. C-1 守卫的前提：REAL_RULES 只剔关键帧步骤 / 以 `.battery-overflow` 为主体的规则必须真命中 / 无 !important·ID·内联', () => {
    const overflowChain = chainOf('battery', 'battery-overflow');
    const overflow = overflowChain[overflowChain.length - 1];

    // ① **REAL_RULES 无损性**：被剔掉的只允许是"关键帧步骤 / `@` 规则"（M-1′ 的根因形态）。
    //    旧写法 `sel.includes('%')` 会把带 `%` 的真选择器一起吃掉 ⇒ 真覆盖在守卫里隐形。
    const dropped = RULES.filter((r) => !REAL_RULES.includes(r)).map((r) => r.selector.trim());
    const badDrops = dropped.filter((s) => !(s.startsWith('@') || /^(?:from|to|\d+(?:\.\d+)?%)$/.test(s)));
    expect(badDrops, '`REAL_RULES` 剔掉了**真规则**（不是关键帧步骤 / `@` 规则）—— 那条规则会在守卫里'
      + '**隐形**：它能覆盖溢流数字的定位，而 C-1 的判据看不见它').toEqual([]);

    // ② **死规则守卫**：凡是**主体**是 `.battery-overflow` 且写定位/朝向的规则，都必须在
    //    `renderNetBoard` 真会产出的链（席位 × 侧别，形态由 G-1 钉住）之一上命中 —— 否则它是
    //    **死规则**：看起来在管 C-1 的元素，实际一条都不命中
    //    （评审的形态：`.battery-to .battery-overflow { position: absolute }` —— 它在浏览器里
    //     也什么都不做，但"看起来已经处理了溢流数字的定位"正是本组要拒绝的读法）。
    //    ⚠️ 诚实边界：这里枚举的是**已知真实形态**；将来若出现别的条件形态（新的座位类 / 媒体查询分支），
    //    这条会**假红** —— 那时把该形态加进 `realOverflowChains` 即可（比"死规则静默存在"可接受）。
    const realOverflowChains: StubNode[][] = [];
    for (const seat of [0, 1]) {
      for (const kind of ['foe', 'self']) {
        realOverflowChains.push([
          cssNode('net-board', `net-view-${seat}`), cssNode('board-grid', 'net-grid'),
          cssNode('net-lane-band'), cssNode('net-side', `net-side-${kind}`),
          cssNode('battery'), cssNode('battery-overflow'),
        ]);
      }
    }
    const allOverflowChains = [overflowChain, ...realOverflowChains];
    const subjectIsOverflow = (sel: string): boolean => sel.split(',').some((segRaw) => {
      const parts = segRaw.trim().split(/\s+/).filter(Boolean);
      return parts.length > 0 && compoundMatches(parts[parts.length - 1], overflow);
    });
    const overflowControlRules = REAL_RULES.filter((r) =>
      /(?:^|;|\s)(?:position|transform|left|right|top|bottom)\s*:/.test(r.body) && subjectIsOverflow(r.selector));
    console.log(`\n===== G-5c · 以 .battery-overflow 为主体、写定位/朝向的规则（${overflowControlRules.length} 条）=====\n`
      + overflowControlRules.map((r) => `  ${r.selector}`).join('\n'));
    expect(overflowControlRules.length, '样式表里没有任何"给溢流数字写定位"的规则'
      + '（连 `.net-lane-band .battery-overflow` 都没了 ⇒ 下面那条判据会退化成空断言）')
      .toBeGreaterThan(0);
    const deadOnes = overflowControlRules.filter((r) => !r.selector.split(',')
      .some((segRaw) => allOverflowChains.some((ch) => selectorMatches(segRaw.trim(), ch))));
    expect(deadOnes.map((r) => r.selector), '以 `.battery-overflow` 为**主体**的规则在真实形态上'
      + '一条都不命中（死规则：写错了祖先/类名）—— 它看起来在管 C-1 的元素，实际什么都不做。'
      + '要么改成能命中的选择器，要么删掉').toEqual([]);

    // ③ **解析器前提的正向钉住**（G2 修正 **R8-5 · I-1：提到共享模块，两个文件同一份实现**）：
    //    本组解算的那些属性上不得出现 `!important` / ID / 内联样式选择器 —— 它们是
    //    `cssPropOfSubject` 等价于浏览器级联的前提（违反时 `assertModelableCascade` 会抛错，
    //    但那条只在"**本次真的解算到那条规则**"时才生效 ⇒ 判据面太窄）。
    //    共享腿 `assertNoUnmodelableCascade` 是**全表扫描**，见 `./net-css-parse` 的说明。
    expect(() => assertNoUnmodelableCascade(REAL_RULES, MODELED_PROPS)).not.toThrow();
  });

  it('G-5b. C-1 行为腿：点数 >10 时真产出溢流数字，且它在 `.battery` 盒内（6 处，文本 = 线值）', async () => {
    const restore = installDom();
    try {
      // 每条线 3 张 `fire-5`（印刷值 5）⇒ 线值 15 > 10 ⇒ 每个能量槽都该产出数字
      const root = renderFrame(0, 3, 'fire-5');
      const overflows = descendants(root).filter((n) => isClass(n, 'battery-overflow'));
      console.log(`\n===== C-1 行为腿 · 线值 15 的一帧里产出的溢流数字 = ${overflows.length} 处 =====`);
      expect(overflows.length, '线值 15 时每个能量槽（3 线 × 2 侧 = 6 个）都应产出 `.battery-overflow`'
        + '（少了 = 那条分支没跑；多了 = 落点重复）').toBe(6);
      for (const num of overflows) {
        const bat = num.parentElement as StubNode;
        // ① **在盒内**：数字必须是 `.battery` 的**直接子项**（"流内 flex 项"的树前提。
        //    ⚠️ 绝对定位时它同样是子项 ⇒ 这一条**单独不足以**证 C-1，承重的是 G-5 的 CSS 腿）
        expect(isClass(bat, 'battery'), '`.battery-overflow` 的父节点不是 `.battery`（落点错了）').toBe(true);
        // ② 祖先链里不得出现链路槽（与 I-4 的防弹衣腿同源）
        const ancestors: StubNode[] = [];
        for (let p = bat.parentElement as StubNode | null; p; p = p.parentElement as StubNode | null) ancestors.push(p);
        expect(ancestors.some((a) => isClass(a, 'stack-slot')),
          '溢流数字的祖先链里有 `.stack-slot`（能量槽被挂回链路框里了？）').toBe(false);
        // ③ 文本 = 引擎写在该能量槽上的点数（防止"数字写死 / 不随线值更新"）
        expect(bat.dataset.points, '能量槽上的 data-points 不是线值 15（3 × fire-5）').toBe('15');
        expect(num.text, '溢流数字的文本必须等于该能量槽的点数').toBe(bat.dataset.points);
      }
    } finally {
      await drainRaf();
      restore();
    }
  });

  it('G-6. I-1 行为腿：真跑 `syncScanOverlays` —— 「宽 > 高」加 `.scan-horiz`、「高 > 宽」去掉（双向同步）', async () => {
    const restore = installDom();
    try {
      const g = globalThis as unknown as { document: { body: StubNode } };
      const body = g.document.body;
      // 造 6 个能量槽（2 玩家 × 3 线），外壳挂进 body —— 只有"实测矩形"决定方向，与形状无关
      for (const player of [0, 1]) {
        for (const line of [0, 1, 2]) {
          const bat = makeStubEl('div');
          bat.classList.add('battery');
          bat.dataset.player = String(player);
          bat.dataset.line = String(line);
          const shell = makeStubEl('div');
          shell.classList.add('battery-shell');
          bat.appendChild(shell);
          body.appendChild(bat);
        }
      }
      const s = createGame({ seed: 'scan-horiz-seed', draftStarter: 0, firstToPlay: 1 });
      (s as { phase: string }).phase = 'turn';
      const overlays = (): StubNode[] => body.children.filter((n) => isClass(n, 'scan-overlay'));

      // ── ① 远程页形状（横置：宽 300 > 高 21）⇒ 6 个层盒都必须**有** `.scan-horiz` ──
      setStubRect({ left: 40, top: 80, width: 300, height: 21 });
      syncScanOverlays(s);
      expect(overlays().length, '6 个 stable 态能量槽 ⇒ 每线每玩家一个扫描层（共 6）').toBe(6);
      for (const ov of overlays()) {
        expect(isClass(ov, 'scan-horiz'), '外壳「宽 300 > 高 21」时扫描层必须有 `.scan-horiz` ——'
          + '没有它就会继续用 `battery-scan-sweep`（走 `top`）在横条上"左右两半各闪一下"。'
          + '⚠️ 这条分支此前**零机检**：桩的 getBoundingClientRect 恒 0 ⇒ `0 > 0` 恒假').toBe(true);
        // 层盒是 **`document.body` 的直接子节点** —— 这正是 `.scan-overlay.scan-horiz .scan-line`
        // 那条选择器**不能**带 `.net-lane-band` 前缀的原因（带了就永不命中、静默退回竖扫）
        expect(ov.parentElement, '扫描层必须是 document.body 的直接子节点'
          + '（挂进列里 ⇒ 带 `.net-lane-band` 前缀的选择器会永不命中）').toBe(body);
        expect(ov.style.left, '层盒没有按实测矩形重定位（left）').toBe('40px');
        expect(ov.style.width, '层盒没有按实测矩形重定位（width）').toBe('300px');
        expect(ov.style.height, '层盒没有按实测矩形重定位（height）').toBe('21px');
      }

      // ── ② 热座形状（竖条：宽 92 < 高 202）⇒ 类必须被**删掉**（双向同步，不留陈旧类）──
      setStubRect({ left: 0, top: 0, width: 92, height: 202 });
      syncScanOverlays(s);
      const again = overlays();
      expect(again.length, '第二次同步后层盒数不应变化（注册表复用，不重建 —— 动画不重启靠它）').toBe(6);
      for (const ov of again) {
        expect(isClass(ov, 'scan-horiz'), '外壳「宽 92 < 高 202」（热座页形状）时**不得**有 `.scan-horiz`'
          + ' —— 类没被删掉就是"陈旧类"：层盒跨重渲染复用，只加不删的实现会把它留给下一个页面')
          .toBe(false);
      }
    } finally {
      await drainRaf();
      restore();
    }
  });

  it('G-7. I-1 CSS 腿：横扫选择器不带"永不命中"前缀 / keyframe 从右往左 / 格渐入在 X 轴', () => {
    // ① 选择器从**解析器**走（不是文本子串）：拿真实祖先链（body ⇒ 层盒 ⇒ 线）解 `animation-name`。
    //    带 `.net-lane-band` 前缀的写法会解出 null —— 那正是"永不命中"的表现（横置电池静默竖扫）。
    const layer = cssNode('scan-overlay', 'scan-horiz');
    const line = cssNode('scan-line');
    const anim = cssPropOfSubject(line, [cssNode('body'), layer, line], REAL_RULES, 'animation-name');
    console.log(`\n===== I-1 · 「.scan-overlay.scan-horiz .scan-line」解出的 animation-name = ${anim}`);
    expect(anim, '`.scan-horiz` 的扫描线拿不到 `net-battery-scan-sweep` —— `styles-net.css` 那条规则的'
      + '选择器带了 `.net-lane-band` 前缀（层是 `document.body` 的直接子节点 ⇒ 规则**永不命中**，'
      + '横置电池会静默退回竖扫）').toBe('net-battery-scan-sweep');

    // ② 方向：`0%` 与 `100%` 都必须用 `right` 定位，且 `0%` 更靠**右**（right 更小）⇒ 从右往左扫
    const kb = keyframesBody('net-battery-scan-sweep');
    expect(kb, 'styles-net.css 里没有 `@keyframes net-battery-scan-sweep`（横扫动画没了）').toBeTruthy();
    const step0 = keyframeStep(kb!, '0%');
    const step100 = keyframeStep(kb!, '100%');
    expect(step0, '`@keyframes net-battery-scan-sweep` 缺 `0%` 一步').toBeTruthy();
    expect(step100, '`@keyframes net-battery-scan-sweep` 缺 `100%` 一步').toBeTruthy();
    const pctOf = (body: string): { prop: string; val: number } | null => {
      const m = /(?:^|;|\s)(left|right)\s*:\s*(-?\d+(?:\.\d+)?)%/.exec(body);
      return m === null ? null : { prop: m[1], val: Number(m[2]) };
    };
    const a = pctOf(step0!);
    const b = pctOf(step100!);
    expect(a, '`0%` 那一步没有 left/right 的百分比定位（写成 `top` = 又变回竖扫）').not.toBeNull();
    expect(b, '`100%` 那一步没有 left/right 的百分比定位').not.toBeNull();
    console.log(`  0% → ${a!.prop}: ${a!.val}%　/　100% → ${b!.prop}: ${b!.val}%`);
    expect([a!.prop, b!.prop], 'keyframe 必须用 `right` 定位（改成 `left` = 扫描线与"从右往左点亮"相反）')
      .toEqual(['right', 'right']);
    expect(a!.val, '`0%` 必须比 `100%` 更靠**右**（`right` 更小）—— 否则扫描方向是从左往右，'
      + '与"从右往左点亮"的裁决相反').toBeLessThan(b!.val);

    // ③ 格渐入：覆盖必须存在，且它引用的 keyframe 位移在 **X 轴**
    //    （styles.css 的 `battery-cell-in` 是 `translateY(6px)` 的**竖版**语义；删掉覆盖就回落它）
    const cell = cssNode('battery-cell', 'filled');
    const cellChain = [cssNode('net-lane-band'), cssNode('battery', 'points-changed'),
      cssNode('battery-cells'), cell];
    expect(cssPropOfSubject(cell, cellChain, REAL_RULES, 'animation-name'), '横置能量槽的格渐入覆盖没了 ——'
      + '会回落到 styles.css 的竖版 `battery-cell-in`（`translateY(6px)` 在横条上读作"从下方飘进来"）')
      .toBe('net-battery-cell-in');
    const cellKb = keyframesBody('net-battery-cell-in');
    expect(cellKb, 'styles-net.css 里没有 `@keyframes net-battery-cell-in`').toBeTruthy();
    const from = keyframeStep(cellKb!, 'from');
    expect(from, '`@keyframes net-battery-cell-in` 缺 `from` 一步').toBeTruthy();
    expect(from!, '`net-battery-cell-in` 的位移必须在 **X 轴**（`translateX`）')
      .toMatch(/translateX\(/);
    expect(from!, '`net-battery-cell-in` 里出现了 `translateY(` —— 那是竖版语义'
      + '（把 X 改回 Y = I-1 的变异 5）').not.toMatch(/translateY\(/);
  });

  it('G-8. I-4 行为腿：防弹衣已拆 —— 每处 `.battery` 的祖先链里都没有 `.stack-slot`，且按链解出 static', async () => {
    const restore = installDom();
    try {
      for (const seat of [0, 1] as const) {
        const root = renderFrame(seat);
        const batteries = descendants(root).filter((n) => isClass(n, 'battery'));
        // ⚠️ "恰好 6 个"放在**最后**：能量槽挂回链路槽时数量会翻倍（两处落点），但那条变异
        //    **首先**该报出的是下面那条**结构**判据（"祖先链里有 `.stack-slot`"）—— 那才是
        //    "防弹衣已拆"要说的话。这里先只保证集合非空（防"0 个电池"让下面的循环变成空判据）。
        expect(batteries.length, `viewSeat=${seat}：页面上一个 .battery 都没有（能量槽没产出？）`)
          .toBeGreaterThan(0);
        const chainUp = (n: StubNode): StubNode[] => {
          const out: StubNode[] = [];
          for (let p = n.parentElement as StubNode | null; p; p = p.parentElement as StubNode | null) out.push(p);
          return out.reverse();
        };
        for (const bat of batteries) {
          const chain = chainUp(bat);
          // ① **防弹衣拆掉的判据**：能量槽不得出现在 `.stack-slot` 的子树里。
          //    旧 CSS 里那条 `.net-lane-band .stack-slot .battery`（同权重、后源序）会把
          //    "挂回槽内"的错误形态中和成好看的样子 ⇒ 结构错了也不报错；删掉它之后，
          //    这条与 G-1/G-1b 会一起报红（变异实测见报告）。
          expect(chain.some((a) => isClass(a, 'stack-slot')), `viewSeat=${seat}：有一个 .battery 挂在`
            + ` .stack-slot 的**子树**里 —— 用户裁决是"能量槽放在链路框外"。挂回去会重新命中`
            + ` styles.css 的 \`.stack-slot.pN .battery { left/right: -120px }\`（⚠️ 那两条对 static`
            + ` 元素**不产生位移** —— CSS 2.1 §9.4.3；可见的错法只是"以一根横条出现在链路框内侧"）`)
            .toBe(false);
          // ② 按**真实祖先链**解出 position（不是拿选择器文本子串比）
          expect(cssPropOfSubject(bat, [...chain, bat], REAL_RULES, 'position'), `viewSeat=${seat}：按真实祖先链`
            + ` 解出的 .battery position 不是 static —— styles.css 的绝对定位会接管`
            + `（包含块变成 .net-board，能量槽被拉成整板高）`)
            .toBe('static');
        }
        // ③ 反空集合：链上必须真的有 `.net-lane-band` / `.net-side`，否则上面的解算会退化成
        //    "没有任何规则命中"（那时 `cssPropOf` 返回 null，断言会以另一种形式假绿/假红）
        const chain0 = chainUp(batteries[0]);
        expect(chain0.some((a) => isClass(a, 'net-lane-band')), `viewSeat=${seat}：祖先链里没有`
          + ' `.net-lane-band`（带全祖先的解算失效）').toBe(true);
        expect(chain0.some((a) => isClass(a, 'net-side')), `viewSeat=${seat}：祖先链里没有 .net-side`)
          .toBe(true);
        // ④ 计数：恰好 6 个（3 线 × 2 侧）。放在最后 —— 挂回链路槽会让这个数翻倍（两处落点），
        //    但那条变异"首先"该报的是上面那条**结构**判据。
        expect(batteries.length, `viewSeat=${seat}：页面上必须恰好 6 个 .battery（3 线 × 2 侧；`
          + ' 能量槽挂回链路槽会让它翻倍 = 两处落点）').toBe(6);
      }
    } finally {
      await drainRaf();
      restore();
    }
  });
});
