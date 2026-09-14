import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createGame } from '../../src/core/state/create';
import { NET_BOTTOM_SIDES, renderNetBoard, verifyPageHooks } from '../../src/ui/render-net';
import { setFxViewSeat } from '../../src/ui/fx-seat';
import { stripComments } from './source-text';
import {
  classListOf, descendants, drainRaf, installStubDom, isClass as isClassShared,
  makeStubEl, walk, type StubNode,
} from './net-dom-stub';

/**
 * G2 修正 R-F · **C-2 的行为守卫**：用最小 DOM 桩**真跑一遍 `renderNetBoard`**，
 * 再按元素树 + 样式表里的 `order` 算出「一列自上而下的六层」。
 *
 * ## 为什么必须有这个文件（而不是再加几条源码断言）
 *
 * C-2 的两个成因**都不是源码能表达的**：
 *  1. `renderSide` 对两侧挂载顺序相同 ⇒ 自己协议落到整列最外端（**DOM 兄弟顺序**的后果）；
 *  2. 能量槽的落端由 **CSS `order`** 决定（`.stack-slot` 是 flex column），
 *     `.p1`/`.p2` 那两个选择器看着"按玩家分得好好的"，实际在默认席位下**两个能量槽都跑到内侧**。
 * 评审正是靠"真跑 + 看元素树"才发现它的；本文件把这件事变成**可重复的机检**。
 *
 * ## 这个桩**能**证明什么 / **不能**证明什么（诚实边界）
 *
 * 能（都是确定性的流式布局语义，不需要浏览器）：
 *  - **元素树的顺序与归属**：一列里 `net-side-foe / net-lane-mid / net-side-self` 的兄弟顺序、
 *    每一侧内部挂了哪些节点、每个节点的 `class` / `data-player` / `data-line`；
 *  - **`order` 求解出的视觉顺序**：按 `styles-net.css` 里真实的 `order:` 声明（含选择器权重与
 *    源序）对 flex column 的子项做**稳定排序**（CSS 规范：`order` 相同则按文档顺序）。
 *
 * **不能**：
 *  - 真实浏览器里的 `getBoundingClientRect()`（本桩一律返回全 0 —— 本文件**不**做任何几何断言）；
 *  - flex 的真实求解（高度/间隙/换行）、缩放、字体导致的换行 —— "到底好不好看"只能人眼；
 *  - `transform` 的效果（协议 ∓90° 是 CSS 的，不在本文件的判据里）。
 *  这三条都在报告的人眼清单里。
 */

/* ============================================================================
 * 样式表：`order:` 声明的解析 + 最小选择器匹配（只为"视觉顺序"服务）
 * ========================================================================== */

interface CssRule { selector: string; body: string; no: number }

/**
 * 去注释后的 `选择器 { 体 }` 列表（本页样式表没有嵌套规则/@media，简版解析够用）。
 *
 * ⚠️ `stripComments` **保留注释起止的两个字符**（`/*`…`*​/` 只把中间内容换成空白，见
 * `./source-text` 的说明）—— 于是紧跟在一条规则**行尾注释**之后的规则，选择器会带上
 * `/* *​/` 前缀。这里必须把它当空白清掉，否则 `.net-lane-band .stack-slot.p2 .battery`
 * 会匹配不上（本文件第一版就是这样漏掉一条规则的）。
 */
function cssRules(css: string): CssRule[] {
  const out: CssRule[] = [];
  const src = stripComments(css);
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let no = 0;
  for (let m = re.exec(src); m !== null; m = re.exec(src)) {
    const selector = m[1].replace(/\/\*|\*\//g, ' ').trim().replace(/\s+/g, ' ');
    out.push({ selector, body: m[2], no: no++ });
  }
  return out;
}

const classesOf = (n: StubNode): string[] => n.cls.split(/\s+/).filter(Boolean);

/** 一个**复合选择器**（不含空格）是否命中该节点：只支持类与属性选择器（本页 `order` 规则只用这两类）。 */
function compoundMatches(part: string, node: StubNode): boolean {
  const simple = part.replace(/::?[a-zA-Z-]+(\([^)]*\))?/g, '');   // 去掉伪类（本页 order 规则没有伪类，稳妥起见）
  const need = [...simple.matchAll(/\.([A-Za-z0-9_-]+)/g)].map((m) => m[1]);
  const have = classesOf(node);
  if (!need.every((c) => have.includes(c))) return false;
  for (const m of simple.matchAll(/\[([a-z-]+)(?:=["']?([^"'\]]*)["']?)?\]/g)) {
    const key = m[1].startsWith('data-')
      ? m[1].slice(5).replace(/-([a-z])/g, (_a, c: string) => c.toUpperCase())
      : m[1];
    if (node.dataset[key] === undefined) return false;
    if (m[2] !== undefined && node.dataset[key] !== m[2]) return false;
  }
  return true;
}

/** `chain` = 祖先链（含自身），后代组合器语义（`>` 一视同仁 —— 本页 order 规则的类集合下等价）。 */
function selectorMatches(selector: string, chain: StubNode[]): boolean {
  const parts = selector.split(/\s+/).filter((p) => p.length > 0 && p !== '>');
  let at = chain.length - 1;
  for (let i = parts.length - 1; i >= 0; i -= 1) {
    let found = -1;
    for (let k = at; k >= 0; k -= 1) {
      if (compoundMatches(parts[i], chain[k])) { found = k; break; }
    }
    if (found < 0) return false;
    at = found - 1;
  }
  return true;
}

/** 简易权重：类数 + 属性数（本页 order 规则的选择器只有这两类，够用且与 CSS 的排序一致）。 */
function specificityOf(selector: string): number {
  const parts = selector.split(/\s+/).filter((p) => p.length > 0 && p !== '>');
  let n = 0;
  for (const p of parts) {
    n += (p.match(/\.[A-Za-z0-9_-]+/g) ?? []).length;
    n += (p.match(/\[[a-z-]+/g) ?? []).length;
  }
  return n;
}

/** 该节点（在 `chain` 这一条祖先链下）生效的**任意属性**值：权重优先、同权重取**源序靠后**者。
 *
 *  `order` 那一份（`cssOrderOf`）是它的前身；R6 需要 `grid-column` —— 与 `order` **完全同一个**
 *  解算规则（权重 + 源序），所以这里抽成通用版，`order` 也走它（一处实现，不会漂移）。
 *  返回 `null` = 没有规则命中（用**声明的缺省值**，不要猜）。 */
function cssPropOf(
  node: StubNode, chain: StubNode[], rules: CssRule[], prop: string,
): string | null {
  let best: { spec: number; no: number; raw: string } | null = null;
  const re = new RegExp(`(?:^|;|\\s)${prop}\\s*:\\s*([^;]+)`);
  for (const r of rules) {
    const m = re.exec(r.body);
    if (!m) continue;
    if (!selectorMatches(r.selector, chain)) continue;
    const spec = specificityOf(r.selector);
    if (!best || spec > best.spec || (spec === best.spec && r.no > best.no)) {
      best = { spec, no: r.no, raw: m[1].trim() };
    }
  }
  return best ? best.raw : null;
}

/** 该节点（在 `chain` 这一条祖先链下）生效的 `order` 值（无声明 = 0，CSS 缺省）。 */
function cssOrderOf(node: StubNode, chain: StubNode[], rules: CssRule[]): number {
  const raw = cssPropOf(node, chain, rules, 'order');
  return raw === null ? 0 : Number.parseInt(raw, 10);
}

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

/** 该节点（或它任一祖先）声明的**自定义属性**值（`var()` 解算用；本页只有 `--net-rail-w`）。 */
function cssVarOf(chain: StubNode[], rules: CssRule[], name: string): string | null {
  for (let i = chain.length - 1; i >= 0; i -= 1) {
    const raw = cssPropOf(chain[i], chain.slice(0, i + 1), rules, name);
    if (raw !== null) return raw.trim();
  }
  return null;
}

/** `var(--x)` / 普通值 → 解算后的字面量；解不出来就原样返回（让断言报出真实值，别报 `undefined`）。 */
function resolveCssValue(chain: StubNode[], rules: CssRule[], raw: string): string {
  const m = /^var\(\s*(--[A-Za-z0-9_-]+)\s*\)$/.exec(raw.trim());
  if (m === null) return raw.trim();
  return cssVarOf(chain, rules, m[1]) ?? raw.trim();
}

/** 造一个只带类名的桩节点（纯 CSS 解算用；不装 DOM、不渲染）。 */
function cssNode(...classes: string[]): StubNode {
  const n = makeStubEl('div');
  n.classList.add(...classes);
  return n;
}

/** flex column 的**视觉顺序**：按 `order` 稳定排序（相同 order 保持文档顺序 —— CSS 规范语义）。
 *  ⚠️ `chain` 是**父节点的祖先链**；每个子项自己要追加进链尾再比对选择器
 *  （本文件第一版漏了这一步 ⇒ 所有 `order` 都匹配不上、求解退化成 DOM 顺序 ——
 *  那样"CSS 那一半"就完全没被判到）。 */
function visualChildren(node: StubNode, chain: StubNode[], rules: CssRule[]): StubNode[] {
  return node.children
    .map((c, i) => ({ c, i, o: cssOrderOf(c, [...chain, node, c], rules) }))
    .sort((a, b) => (a.o - b.o) || (a.i - b.i))
    .map((x) => x.c);
}

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
 *  在 R1→R2→R3→R-F **四轮**里从未被任何机检覆盖（I-3 的根因）。 */
function renderFrame(viewSeat: 0 | 1, cardsPerStack = 0): StubNode {
  const s = createGame({ seed: 'rf-tree-seed', draftStarter: 0, firstToPlay: 1 });
  for (const p of [0, 1] as const) {
    s.players[p].protocols = [
      { defId: 'fire-0', compiled: false },
      { defId: 'ice-0', compiled: false },
      { defId: 'light-0', compiled: false },
    ] as never;
    if (cardsPerStack > 0) {
      s.players[p].stacks = [0, 1, 2].map((line) => Array.from({ length: cardsPerStack }, (_, i) => ({
        uid: `p${p}l${line}c${i}`, defId: 'fire-0', faceUp: true, owner: p, zone: 'field', line, pos: i,
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
 * 层序求解：一列 = 六层
 * ========================================================================== */

type Side = 'foe' | 'self';
type LayerKind = 'battery' | 'stack' | 'protocol';
interface Layer { side: Side; kind: LayerKind }

const label = (l: Layer): string => `${l.side === 'foe' ? '对手' : '自己'}${l.kind === 'battery' ? '能量槽' : l.kind === 'stack' ? '链路' : '协议'}`;

/**
 * 一列（`.net-lane-band`）里**自上而下的六层**（DOM 顺序 + CSS `order`）。
 *
 * ⚠️ **R-F2 · 守卫洞 1**：`chain` = 该列的**完整祖先链**（`root → .net-board → .net-grid`，
 * 见 `firstColumnWithChain`）。旧版把它写死成"从列开始"（`[]`），于是**列以上祖先才匹配的规则
 * 对解算器完全不可见** —— 实测往 `styles-net.css` 插一条
 * `.net-board .net-lane-band .stack-slot .battery { order: 1; }`（与按侧那两条**同权重**、
 * 源序靠后 ⇒ 浏览器里它会赢 ⇒ 自己能量槽跑到链路上方）守卫仍然**绿**。
 * 本文件已有 11 条 `.net-board` 前缀规则，这个写法很现实，所以必须把链带全。
 */
function layersOfColumn(col: StubNode, chain: StubNode[], rules: CssRule[]): Layer[] {
  const out: Layer[] = [];
  for (const sideNode of visualChildren(col, chain, rules)) {
    const side: Side | null = isClass(sideNode, 'net-side-foe') ? 'foe'
      : isClass(sideNode, 'net-side-self') ? 'self' : null;
    if (!side) continue;   // 中线等
    for (const cell of visualChildren(sideNode, [...chain, col], rules)) {
      if (isClass(cell, 'protocol-cell')) { out.push({ side, kind: 'protocol' }); continue; }
      if (!isClass(cell, 'stack-slot')) continue;
      for (const inner of visualChildren(cell, [...chain, col, sideNode], rules)) {
        if (isClass(inner, 'battery')) out.push({ side, kind: 'battery' });
        else if (isClass(inner, 'stack')) out.push({ side, kind: 'stack' });
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
 *  ⚠️ 返回祖先链是**守卫洞 1 的修法**：`visualChildren(node, chain, rules)` 给子项拼的链是
 *  `[...chain, node, 子项]`，所以 `chain` 必须是"从根到父节点"的真实祖先序列，
 *  `.net-board` 这类**列以上**的选择器片段才可能匹配上（旧版漏掉 → 覆盖规则隐形）。 */
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

/** 在列内按视觉顺序找某个「侧 + 层」的节点（能量槽/链路/协议都能取到）。`chain` 同 `layersOfColumn`。 */
function findLayer(col: StubNode, chain: StubNode[], rules: CssRule[], want: Layer): StubNode | null {
  for (const sideNode of visualChildren(col, chain, rules)) {
    const side: Side | null = isClass(sideNode, 'net-side-foe') ? 'foe'
      : isClass(sideNode, 'net-side-self') ? 'self' : null;
    if (side !== want.side) continue;
    for (const cell of visualChildren(sideNode, [...chain, col], rules)) {
      if (want.kind === 'protocol' && isClass(cell, 'protocol-cell')) return cell;
      if (want.kind !== 'protocol' && isClass(cell, 'stack-slot')) {
        for (const inner of visualChildren(cell, [...chain, col, sideNode], rules)) {
          if (want.kind === 'battery' && isClass(inner, 'battery')) return inner;
          if (want.kind === 'stack' && isClass(inner, 'stack')) return inner;
        }
      }
    }
  }
  return null;
}

const cssPath = new URL('../../src/ui/styles-net.css', import.meta.url);
const netCss = readFileSync(fileURLToPath(cssPath)).subarray(0, 4 * 1024 * 1024).toString('utf8');
const RULES = cssRules(netCss);

afterEach(() => { setFxViewSeat(null); });

describe('R-F · C-2：真跑 renderNetBoard 的元素树层序（viewSeat 0/1）', () => {
  it('两个席位下，一列自上而下都必须是规格 §1 的六层（对手能量槽→…→自己能量槽）', async () => {
    const restore = installDom();
    try {
      for (const seat of [0, 1] as const) {
        const root = renderFrame(seat);
        const { col, chain } = firstColumnWithChain(root);
        const tree: string[] = [];
        walk(col, 0, tree, 4);
        // 报告里要贴的元素树（真实产出，非手写）
        console.log(`\n===== viewSeat=${seat} · 第一列元素树（DOM 顺序）=====\n${tree.join('\n')}`);
        const layers = layersOfColumn(col, chain, RULES);
        console.log(`----- viewSeat=${seat} · 自上而下（DOM 顺序 + CSS order）-----\n`
          + layers.map((l, i) => `  ${i + 1}. ${label(l)}`).join('\n'));

        // ① **完整六层**：与规格 §1 逐条相等（这是 C-2 的核心判据）
        expect(layers, `viewSeat=${seat} 的列内层序与规格 §1 不符`
          + `（实际：${layers.map(label).join(' → ')}）`).toEqual(SPEC_ORDER);

        // ② 三条腿各自点名（失败信息比"数组不等"可读；也防止将来有人把 SPEC_ORDER 一起改错）
        expect(layers[0], `viewSeat=${seat}：对手能量槽必须在一列的最上端（第 1 层）`)
          .toEqual({ side: 'foe', kind: 'battery' });
        expect(layers[2], `viewSeat=${seat}：对手协议必须紧贴中线（第 3 层，内端）`)
          .toEqual({ side: 'foe', kind: 'protocol' });
        expect(layers[3], `viewSeat=${seat}：自己协议必须紧贴中线（第 4 层，内端）`)
          .toEqual({ side: 'self', kind: 'protocol' });
        expect(layers[5], `viewSeat=${seat}：自己能量槽必须在一列的最下端（第 6 层）`)
          .toEqual({ side: 'self', kind: 'battery' });
        // 自己链路在下半、对手链路在上半（中线把它们分开）
        const iFoeStack = layers.findIndex((l) => l.side === 'foe' && l.kind === 'stack');
        const iSelfStack = layers.findIndex((l) => l.side === 'self' && l.kind === 'stack');
        expect(iFoeStack, `viewSeat=${seat}：对手链路必须在中线之上（第 2 层）`).toBe(1);
        expect(iSelfStack, `viewSeat=${seat}：自己链路必须在中线之下（第 5 层）`).toBe(4);

        // ③ 归属：能量槽/链路槽各自挂在自己的侧里，**不是**按绝对玩家猜的
        const foeSide = visualChildren(col, chain, RULES).find((n) => isClass(n, 'net-side-foe'))!;
        const selfSide = visualChildren(col, chain, RULES).find((n) => isClass(n, 'net-side-self'))!;
        expect(foeSide.dataset.player, `viewSeat=${seat}：对手侧的 data-player 应是绝对的 ${1 - seat}`)
          .toBe(String(1 - seat));
        expect(selfSide.dataset.player, `viewSeat=${seat}：自己侧的 data-player 应是绝对的 ${seat}`)
          .toBe(String(seat));

        // ④ 竖向生长类**按侧**（不是按绝对玩家）：自己恒 .grow-down、对手恒 .grow-up
        const selfStack = findLayer(col, chain, RULES, { side: 'self', kind: 'stack' })!;
        const foeStack = findLayer(col, chain, RULES, { side: 'foe', kind: 'stack' })!;
        expect(classesOf(selfStack), `viewSeat=${seat}：自己链路必须向上端协议生长（.grow-down）`)
          .toContain('grow-down');
        expect(classesOf(foeStack), `viewSeat=${seat}：对手链路必须向下端协议生长（.grow-up）`)
          .toContain('grow-up');
      }
    } finally {
      await drainRaf();
      restore();
    }
  });

  /**
   * **R-F2 · I-3 的行为守卫**：链路里的**卡序**（本文件此前只覆盖**空链路**的六层，
   * 这就是 I-3 躲过 R1→R2→R3→R-F 四轮的**唯一**原因 —— `renderFrame` 用的 `createGame()` 场上无卡）。
   *
   * ## 为什么"卡序"就是"生长方向"（可复算，不依赖浏览器）
   *
   * 1. 引擎里 `stacks[line]` 的顺序恒为「最旧 → 最新」（`pos` = 追加序号）；
   * 2. 竖排的重叠规则是 `.net-lane-band .stack .card + .card { margin-top: calc(0.462*var(--card-w) - var(--card-h)) }`
   *    = 60.3 − 182 = **−121.7px**。flex column 里，`margin-top` 为负 ⇒ **后面那个 DOM 兄弟更靠下**
   *    （第 k 个兄弟顶边 = 第 k−1 个顶边 + 60.3）⇒ **DOM 顺序直接决定谁在上、谁在下**；
   * 3. `z-index = pos`（`render.ts`）⇒ 最新的那张永远盖住更旧的 ⇒ 视觉上"链路从 pos 0 向最新那张延伸"。
   *
   * ⇒ 「pos 0（最旧）贴协议、越新的越往外」这条语义在竖排下**只能**由 DOM 顺序实现：
   *  - **自己侧**（协议在上端、向下长）⇒ DOM 必须是 **[最旧 … 最新]**（最新在**末位** = 最下）；
   *  - **对手侧**（协议在下端、向上长）⇒ DOM 必须是 **[最新 … 最旧]**（最新在**首位** = 最上）。
   *
   * ⚠️ `justify-content: flex-start/flex-end` 那两条声明**救不了方向**：`.stack` 的高度由内容决定、
   * 没有自由空间可分配 ⇒ 它们是**死 CSS**，唯一的杠杆就是上面这条 DOM 顺序（I-3 的成因）。
   *
   * **只查顺序、不查几何**：桩的 `getBoundingClientRect()` 恒 0，本文件不做任何几何断言。
   * 这两条断言加上"负 margin-top + z-index=pos"这两条**可复算**的 CSS/源码事实，就足以确定
   * 最新牌落在链路的哪一端（人眼项仍然保留：见 R-F2 报告清单第 1~3 条）。
   */
  it('两个席位下，链路卡序必须是「pos 0 贴协议、越新越往外」：自己侧最新在**末位**、对手侧最新在**首位**', async () => {
    const restore = installDom();
    try {
      for (const seat of [0, 1] as const) {
        const root = renderFrame(seat, 3);
        const { col, chain } = firstColumnWithChain(root);
        const printed: string[] = [];
        for (const side of ['self', 'foe'] as const) {
          const stack = findLayer(col, chain, RULES, { side, kind: 'stack' })!;
          const cards = stack.children.filter((c) => isClass(c, 'card'));
          expect(cards.length, `viewSeat=${seat} · ${side}：合成局里每条链路应恰好 3 张卡（桩/构造被改？）`)
            .toBe(3);
          const uids = cards.map((c) => String(c.dataset.uid));
          const zs = cards.map((c) => Number(c.style.zIndex));
          const player = side === 'self' ? seat : (1 - seat);
          // 引擎序 = 最旧 → 最新（uid 后缀就是引擎下标）
          const oldestFirst = [0, 1, 2].map((i) => `p${player}l0c${i}`);
          const expected = side === 'self' ? oldestFirst : [...oldestFirst].reverse();
          printed.push(`  ${side === 'self' ? '自己侧' : '对手侧'}（P${player + 1}）`
            + ` class="${stack.cls.split(/\s+/).filter((c) => c === 'stack' || c.startsWith('grow-')).join(' ')}"`
            + ` 卡序: ${cards.map((c, i) => `#${i} ${String(c.dataset.uid)} z=${String(c.style.zIndex)}`).join(' | ')}`);
          // ① 完整 DOM 卡序（含"自己侧最新在末位 / 对手侧最新在首位"）
          expect(uids, `viewSeat=${seat} · ${side === 'self' ? '自己' : '对手'}侧：DOM 卡序与规格 §1 不符`
            + `（自己侧必须 [最旧→最新]、对手侧必须 [最新→最旧]，否则最新的一张会落在链路的**错端** —— I-3）`)
            .toEqual(expected);
          // ② 最新那张的 z-index 最大（保证"最新盖住更旧的"这条视觉语义，横竖排都是它）
          const newest = `p${player}l0c2`;
          const iNewest = uids.indexOf(newest);
          expect(zs[iNewest], `viewSeat=${seat} · ${side === 'self' ? '自己' : '对手'}侧：`
            + `最新那张（${newest}）的 z-index 必须是最大（实际 z=${zs[iNewest]}，全部 z=${zs.join(',')}）`)
            .toBe(Math.max(...zs));
        }
        console.log(`\n===== viewSeat=${seat} · 第 1 条线的链路卡序（DOM 顺序 + z-index）=====\n`
          + printed.join('\n')
          + '\n  （引擎 stacks 数组顺序 = 最旧 → 最新：c0, c1, c2）');
      }
    } finally {
      await drainRaf();
      restore();
    }
  });

  it('CSS 侧腿：能量槽的落端必须**按侧**给 order（不得再按绝对玩家 .p1/.p2）', () => {
    // 元素树求解已经证明"当前样式表算出来的层序是对的"；这一条防的是"靠权重压住了错的旧规则"：
    // 只要还有人按绝对玩家给 order，换一个席位就会翻回来。
    const batteryOrderRules = RULES.filter((r) => /(?:^|;|\s)order\s*:/.test(r.body) && /\.battery/.test(r.selector));
    const byPlayer = batteryOrderRules.filter((r) => /\.p[12]\b/.test(r.selector)).map((r) => r.selector);
    expect(byPlayer, 'styles-net.css 里仍有"按绝对玩家号"给能量槽定 order 的规则'
      + '（默认席位下会让两个能量槽都跑到内侧 —— C-2）').toEqual([]);
    // ⚠️ **R-F2 · 守卫洞 2**：这里原来写 `toBe(2)`（"恰好两条按侧的 order 规则"），是**过度指定** ——
    //    一条语义等价的重构（自己侧改用 `flex-direction: column-reverse`、或"一条基础规则 + 一条对手侧覆盖"
    //    = 只有 1 条 `.net-side-*` 电池规则）会**假红**。真正要防的回归是"**按绝对玩家号给 order**"，
    //    那条已由上面的 `byPlayer === []` 单独钉住；这里只保留**反空集合**（>= 1）：
    //    抓"按侧给 order 这件事整个消失了"，不抓"用几条规则表达它"。
    const bySide = batteryOrderRules.filter((r) => /\.net-side-(foe|self)\b/.test(r.selector));
    expect(bySide.length, 'styles-net.css 未按侧（.net-side-foe/.net-side-self）给能量槽定 order')
      .toBeGreaterThanOrEqual(1);
  });

  /* ==========================================================================
   * G2 修正 R6：**底部行重排**（信息块 · 手牌区（中） · 信息块）
   *
   * 用户裁决（规格 §8.4 第 2 条 / §8.6 的 R6）：双方信息条与手牌区**同一行、一左一右**，
   * **顶部信息条取消**。这一组是它的**行为机检** —— 用同一份最小 DOM 桩真跑，再按元素树 +
   * 样式表里的 `grid-column` / `order` 解出"谁在左、谁在右、`.hand` 的 DOM 顺序是什么"。
   *
   * ⚠️ 两条**最容易静默搞坏**的地方（本组各有一条专门断言）：
   *  1. **`.hand` 的 DOM 顺序必须仍是 [P0, P1]**（FX 用 `querySelectorAll('.hand')[player]`
   *     **按下标**读手牌）—— 左右摆放只能由 CSS 决定，**绝不能让 DOM 顺序跟着视觉左右走**。
   *     这是"看起来只是 CSS、实际会静默搞坏特效"的唯一一处。
   *  2. **左右归属**：`NET_BOTTOM_SIDES`（render-net.ts 的**唯一**一处常量）与样式表的
   *     `grid-column` 必须**同向**。只改一处会出现"DOM 顺序对、看着反"（或反过来）。
   *     下面把两条腿**都从那个常量推导** ⇒ 改常量、改 CSS、改 DOM 挂载顺序，任一处都会红。
   * ======================================================================== */

  /** 底部行（`.net-bottom`）里**类名命中 `cls` 的**直接子节点，按 DOM 顺序。 */
  const blocksIn = (bottom: StubNode, cls: string): StubNode[] =>
    bottom.children.filter((c) => isClass(c, cls));

  /**
   * 底部行里各块的**视觉左右顺序**：按样式表实际生效的 `grid-column` 排序
   * （相同列值 = 同一列，退化为 DOM 顺序；本页三块各占一列，不存在并列）。
   *
   * ⚠️ 为什么必须**解算 CSS**而不是"看 DOM 顺序就算视觉顺序"：R6 的左右归属正是**由 CSS 决定**的
   * （红线：DOM 顺序不得跟着视觉左右走）。只查 DOM 就等于把这条红线当成了实现细节。
   */
  function visualOrderOfBottom(bottom: StubNode, chain: StubNode[], rules: CssRule[]): StubNode[] {
    return bottom.children
      .map((c, i) => ({
        c, i,
        col: (() => {
          const raw = cssPropOf(c, [...chain, bottom, c], rules, 'grid-column');
          // `grid-column: 1` / `3`（本页只写单值）；没声明 = `auto`（本页的 `@media` 单列模式）
          return raw === null || !/^\d+$/.test(raw) ? Number.POSITIVE_INFINITY : Number(raw);
        })(),
      }))
      .sort((a, b) => (a.col - b.col) || (a.i - b.i))
      .map((x) => x.c);
  }

  /** `NET_BOTTOM_SIDES` 的**座位 → 绝对玩家**（与 render-net.ts 的 `bottomPlayerOf` 同式）。 */
  const playerOfSide = (side: string, seat: 0 | 1): number => (side === 'self' ? seat : 1 - seat);

  it('R6-1. 底部行三块：信息块（左）· 手牌区（中）· 信息块（右），左右 = NET_BOTTOM_SIDES', async () => {
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
        // ④ **左右归属**（R6 的核心）：视觉左→右 必须等于 `NET_BOTTOM_SIDES`
        const visual = visualOrderOfBottom(bottom!, chain, RULES);
        const visualSides = visual.map((n) => (isClass(n, 'net-info-block') ? String(n.dataset.netSeat) : 'hands'));
        const expectedVisual = [...NET_BOTTOM_SIDES.slice(0, 1), 'hands', ...NET_BOTTOM_SIDES.slice(1)];
        console.log(`  ----- viewSeat=${seat} · 底部行视觉左→右（grid-column 解算）-----\n`
          + `  ${visualSides.join(' · ')}`);
        expect(visualSides, `viewSeat=${seat}：底部行的视觉左右必须与 NET_BOTTOM_SIDES `
          + `（现为 [${NET_BOTTOM_SIDES.join(', ')}]）一致，且手牌区在**中间**`
          + `（实际：${visualSides.join(' · ')}）`).toEqual(expectedVisual);
        // ⑤ 手牌区在 DOM 里也**恒在中间**（与视觉一致；DOM 位置不是红线的对象，但两处不一致就是
        //    "DOM 对、看着反"的温床 —— 例如有人把信息块 append 到手牌区**之后**又靠 order 挪回来）
        const domOrder = bottom!.children.map((n) => (isClass(n, 'net-info-block') ? 'info' : isClass(n, 'net-hands') ? 'hands' : '?'));
        expect(domOrder, `viewSeat=${seat}：底部行的 DOM 顺序必须是 [信息块, 手牌区, 信息块]`).toEqual(['info', 'hands', 'info']);
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
        // ③ **视觉手序由 CSS `order` 决定**（不是 DOM 顺序）：`.net-hand-area` 上必须有按座位的
        //    order 规则，且解算出的视觉顺序与"对手在上"一致（`viewSeat=0` → P1 在上、P0 在下）
        const handsChain = descendants(root).filter((n) => isClass(n, 'net-board'));
        const areas = handsRoot.children.filter((n) => isClass(n, 'net-hand-area'));
        expect(areas.length, `viewSeat=${seat}：.net-hands 里应有两块 .net-hand-area`).toBe(2);
        const visualAreas = areas
          .map((a, i) => ({ p: String(a.dataset.player), i, o: cssOrderOf(a, [...handsChain, handsRoot, a], RULES) }))
          .sort((x, y) => (x.o - y.o) || (x.i - y.i));
        // 对手的牌在上面（viewSeat=0 时对手 = P1、viewSeat=1 时对手 = P0）
        const foePlayer = String(1 - seat);
        console.log(`  viewSeat=${seat} · 手牌区视觉上→下（CSS order 解算）: P${visualAreas.map((x) => Number(x.p) + 1).join(' 然后 P')}`);
        expect(visualAreas[0].p, `viewSeat=${seat}：视觉**上**带必须是**对手**的手牌（P${Number(foePlayer) + 1}）`
          + `—— 这一条只能由 CSS order 表达，DOM 顺序必须恒 [P0, P1]`)
          .toBe(foePlayer);
        // ④ 反空集合：order 必须**真的**来自样式表（若两条规则都没了，解算会退化成 DOM 顺序，
        //    而 DOM 顺序恰好也是 [P0, P1]，上面那条会**碰巧**绿 —— 所以钉住"按侧/按座位的 order 规则存在"）
        const orderRules = RULES.filter((r) => /(?:^|;|\s)order\s*:/.test(r.body) && /\.net-hand-area/.test(r.selector));
        expect(orderRules.length, 'styles-net.css 里没有针对 .net-hand-area 的 order 规则'
          + '（"谁在上/下"只剩 DOM 顺序这一条腿，而这正是红线不许动的）').toBeGreaterThanOrEqual(2);
      }
    } finally {
      await drainRaf();
      restore();
    }
  });

  /**
   * R6 的**CSS 解析边界**（诚实披露）：本文件的解析器是简版（`选择器 { 体 }`，不递归 `@media`），
   * 于是 `@media` 里的规则**整块被跳过** —— 这里替它把话说清楚，免得有人把"解算结果"读成
   * "所有断点都验过了"。
   *
   * 为什么这是**对的**（不是偷懒）：桩没有布局引擎，判不了"窗口够不够宽"；而媒体查询里的规则若
   * 被当成无条件规则参与解算，会把竖排层序/上下手序判错。所以 R6 的窄屏规则**故意**只写
   * "退回单列 + 清掉 grid-column"，不写任何 `order`（见 styles-net.css 第 6 节末尾）。
   * 窄屏观感只能人眼验 —— 这是本任务明确保留的人眼项。
   */
  it('R6-4. CSS 解析器跳过 @media（窄屏规则不参与解算）—— 边界声明，防"以为验过了"', () => {
    expect(netCss, 'styles-net.css 已不再包含 @media 断点（R6 的窄屏取舍被删？）').toContain('@media');
    const mediaSelectorRules = RULES.filter((r) => /@media/.test(r.selector) || /@media/.test(r.body));
    expect(mediaSelectorRules.map((r) => r.selector), '@media 的规则漏进了解算器的规则表'
      + '（简版解析器应整块跳过它；否则其内部的 order/grid-column 会被当成无条件规则）').toEqual([]);
  });

  /**
   * R6-5：**布局引擎之外的两条承重声明**（桩查不到、但一旦丢了页面就整体走样）。
   *
   * 为什么必须单列一条（诚实边界：桩只解算 `order` / `grid-column`，**不模拟 flex/grid 的盒模型**）：
   *  - **`.net-grid` 的 `display: grid`**：R1 的"三个纵向的列"是 grid 语义，但样式表里**没有**
   *    写 `display`（`styles.css:23` 的 `.board-grid` 是 `display: flex; flex-direction: column`）
   *    ⇒ 三条线会被**纵向堆成三行**（"三个纵向的列"退化成"三条横带"，正是 R1 要修的观感）。
   *    本文件的层序解算器**看不见**这个（它只查列内的 `order`），所以必须有一条源码级判据。
   *  - **`.net-bottom` 的列模板**：`max-content minmax(max-content, auto) max-content`
   *    —— 中列必须是 `max-content` 下界（否则手牌区会被两侧信息块挤窄，R6 的"手牌区居中、
   *    左右留白对称"就不成立）。
   *  这两条都是**文本代理**（证明"声明写了"，证明不了浏览器算出来的观感）—— 观感属于人眼项。
   */
  it('R6-5. 承重布局声明：.net-grid 必须是三列 grid、.net-bottom 的列模板必须让中列按内容定宽', () => {
    const gridRule = RULES.find((r) => r.selector.trim() === '.net-grid');
    expect(gridRule, 'styles-net.css 里找不到 .net-grid 的规则').toBeTruthy();
    expect(gridRule!.body, '.net-grid 没写 display: grid —— 会继承 .board-grid 的 flex column，'
      + '三条线被纵向堆成三行（"三个纵向的列"失效）').toMatch(/display:\s*grid/);
    expect(gridRule!.body, '.net-grid 没有三列模板（三条线并排靠 grid-auto-flow: column，'
      + '写死模板更稳）').toMatch(/grid-template-columns:\s*repeat\(3,/);
    const bottomRule = RULES.find((r) => r.selector.trim() === '.net-bottom');
    expect(bottomRule, 'styles-net.css 里找不到 .net-bottom 的规则（底部行没有布局）').toBeTruthy();
    expect(bottomRule!.body, '.net-bottom 的列模板必须让中列（手牌区）按**内容**定宽：'
      + '`max-content minmax(max-content, auto) max-content`（用 1fr 会把手牌区挤窄）')
      .toMatch(/grid-template-columns:\s*max-content\s+minmax\(max-content,\s*auto\)\s+max-content/);
    // 手牌区不得被两侧信息块挤歪：中列的两侧留白对称 ⇒ 左右列必须**同宽**（同一份 max-content）
    //   —— 这条由列模板的字面量承载（两个 max-content 必须完全一样），上面那条正则已钉死。
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

        // ── ③ `.net-board` 的子节点顺序：[.net-grid, .net-bottom, …]（其余是 log / 导出按钮 / 工具条）──
        const kinds = wrap.children.map((n) => (isClass(n, 'net-grid') ? 'grid'
          : isClass(n, 'net-bottom') ? 'bottom'
            : isClass(n, 'log') ? 'log'
              : isClass(n, 'diag-btn') ? 'diag-btn'
                : isClass(n, 'net-preview-bar') ? 'preview-bar' : `?${n.cls}`));
        console.log(`  viewSeat=${seat} · .net-board 子节点顺序（DOM）: ${kinds.join(' → ')}`);
        expect(kinds[0], `viewSeat=${seat}：.net-board 的第一个子节点必须是 .net-grid`).toBe('grid');
        expect(kinds[1], `viewSeat=${seat}：.net-board 的第二个子节点必须是 .net-bottom（纵向堆在网格之下）`)
          .toBe('bottom');
        expect(kinds.slice(2).every((k) => k === 'log' || k === 'diag-btn' || k === 'preview-bar'),
          `viewSeat=${seat}：.net-board 下出现了未登记的容器：${kinds.slice(2).join(', ')}`).toBe(true);
        // 反空集合：日志块与导出按钮必须仍在渲染根下（"搬到 grid 外面"不许顺手把它们弄丢）
        expect(kinds.filter((k) => k === 'log').length, '日志块必须仍挂在 .net-board 下').toBe(1);
        expect(kinds.filter((k) => k === 'diag-btn').length, '导出日志按钮必须仍挂在 .net-board 下').toBe(1);
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
    // ②③ 前 3 条 = 三条线，**等宽**且是 1fr 族（`minmax(0, 1fr)` 与 `1fr` 都接受 —— 判据不绑定写法）
    const laneTracks = tracks.slice(0, 3);
    expect(laneTracks.every((t) => /1fr/.test(t)),
      `前 3 条轨道必须是三条线的等宽列，实际 ${laneTracks.join(' | ')}`).toBe(true);
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
   * ⚠️ 诚实边界（写在用例里）：本桩不实现选择器引擎 ⇒ A 类钩子的探针恒 0 ⇒ 整份自查在桩上必然 ✗。
   * 所以这里**只**断言"座位锚点那一条不再出现"（它只需要 `scope` 自己的类名，桩完全够用）。
   */
  it('R7-4. 真跑一帧：约束 9 的**座位锚点**自查不得再误报（渲染根自己就是一个 .net-board）', async () => {
    const restore = installDom();
    try {
      for (const seat of [0, 1] as const) {
        const root = renderFrame(seat);
        const wrap = root.children[0] as unknown as HTMLElement;
        const note = verifyPageHooks(wrap, seat);
        console.log(`\n===== viewSeat=${seat} · 桩上真跑 verifyPageHooks 的返回 =====\n  ${note}`);
        expect(note, `viewSeat=${seat}：verifyPageHooks 什么都没返回（自查没跑起来？）`).toMatch(/^自查/);
        expect(note, `viewSeat=${seat}：渲染根就是 .net-board.net-view-${seat}，却仍报"座位锚点"不一致 ——`
          + '这正是 R7 修掉的那处假红（`querySelectorAll` 只搜后代、不搜自身）')
          .not.toContain('视图座位锚点');
      }
    } finally {
      await drainRaf();
      restore();
    }
  });
});
