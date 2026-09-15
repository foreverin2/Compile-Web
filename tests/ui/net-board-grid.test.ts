import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createGame } from '../../src/core/state/create';
import { renderNetBoard } from '../../src/ui/render-net';
import { setFxViewSeat } from '../../src/ui/fx-seat';
import {
  assertNoUnmodelableCascade, compoundMatches, cssRules, MODELED_PROPS, selectorMatches,
  specificityOf, type CssRule,
} from './net-css-parse';
import { descendants, drainRaf, installStubDom, isClass, makeStubEl, walk, type StubNode } from './net-dom-stub';

/**
 * **R8-5 / R8-6 / R8-8 的守卫**（规格 `docs/2026-09-15-G2修正R8-能量槽外移与协议特效跟随.md` §8.6 的
 * G-7 / G-8 / G-9）—— 用户第二次验收反馈的最后四项落地后的机检腿：
 *
 * | 守卫 | 守什么 | 机制 |
 * | --- | --- | --- |
 * | **G-7** | 五行的**视觉行序**（对手信息块 → 对手手牌 → 链路+控制轨 → 自己手牌 → 自己信息块） | 真跑 `renderNetBoard` + 把 `display: contents` 的盒树**展平** + 从样式表解出每条 grid item 的 `grid-row` |
 * | **G-8** | 控制轨竖直**归中**（`align-self: center`，不是 `start`） | 级联解算 |
 * | **G-9** | 操作按钮只在**操作方**那一侧的信息块里 | 真跑两个局面（回合归属 / chooser 归属）× 两个席位 |
 *
 * ## 为什么 G-7 必须"展平盒树"而不是直接看 `children`
 *
 * R8-5 的全部机制是两条 `display: contents`（`.net-bottom` / `.net-hands`）+ 按侧的 `grid-row`。
 * `display: contents` 的元素**不生成盒子**，它的子节点**直接成为爷爷的 grid item** ——
 * 这正是"少写一条 `contents`，视觉顺序就**静默**退回 DOM 顺序（而 `grid-row` 声明还在、
 * 看着像生效了）"的成因。所以模型必须真的按 `display` 展平：只看 `children` 的话，
 * 两块手牌区会被算成"缩在 `.net-hands` 里的一个 item"，而 `.net-hands` 自己又没有行号 ⇒
 * 断言会以"**找不到手牌区这个 grid item**"的形式报红（而不是碰巧通过）。
 *
 * ## 这个桩**能**证明什么 / **不能**证明什么（诚实边界）
 *
 * 能：元素树（顺序/归属/类名/dataset）、从真实样式表解出的"哪条声明生效"（含选择器权重与源序）、
 * 盒树展平后的 grid item 列表与 `grid-row` 数值。
 * **不能**：真实布局（行高、gap、像素位置）、`display: contents` 在浏览器里的最终观感、
 * 控制轨"看起来是不是正好在中线上"（那需要布局引擎）—— 这三条都在报告的人眼清单里。
 */

/* ============================================================================
 * 样式表（**与 `net-lane-tree.test.ts` 同一套解析器** —— 见 ./net-css-parse 的头注：
 * 复制一份就会漂移出第二条真相，而漂移的表现是"一个文件绿、另一个红"）
 * ========================================================================== */

const cssPath = new URL('../../src/ui/styles-net.css', import.meta.url);
const netCss = readFileSync(fileURLToPath(cssPath)).subarray(0, 4 * 1024 * 1024).toString('utf8');
const RULES = cssRules(netCss);

/**
 * 一条规则是否把 `node` 当作**选择器主体**（最后一段复合选择器）命中 —— 与
 * `net-lane-tree.test.ts` 的 `ruleHitsAsSubject` **同一语义**（选择器组逐段判）。
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
 * **主体绑定解算**：与 `net-lane-tree.test.ts` 的 `cssPropOfSubject` 同语义（权重优先、
 * 同权重取源序靠后），但只认"把 `node` 当**选择器主体**"的规则。
 *
 * ⚠️⚠️ 为什么本文件**必须**用它（而不是共享的 `cssPropOf`）：后者的 `selectorMatches` 允许主体
 * 绑到链上的**任意祖先**。对这个任务的判据这是**致命**的 —— `.net-bottom { display: contents }`
 * 会被解成 `.net-info-block`（**孙子**）的 `display`，于是展平器把信息块的子节点当成 grid item，
 * G-7 会以"信息块不是顶层 item"的形式**误报**（本文件第一版实测就是这样红的）。
 * `net-lane-tree.test.ts` 里那条同名注释（"`cssPropOf` 没有这层保护"）说的正是这个坑。
 *
 * ## 等价条件（不满足就会算错，必须显式禁掉而不是猜）
 * 只建模"**纯类/属性选择器 + 权重 + 源序**"。命中规则里出现 `!important` / ID(`#`) /
 * `[style…]` 时**直接抛错**（浏览器里它们会压过普通声明、或与桩没有的 id 相关，
 * 本模型无法表达）。本组解算的属性（`display` / `grid-row` / `grid-column` / `align-self` /
 * `position` / `transform` / `grid-template-columns`）**全部非继承**，故不需要回溯父级计算值。
 */
function subjectPropOf(
  node: StubNode, chain: StubNode[], rules: CssRule[], prop: string,
): string | null {
  let best: { spec: number; no: number; raw: string } | null = null;
  const re = new RegExp(`(?:^|;|\\s)${prop}\\s*:\\s*([^;]+)`);
  for (const r of rules) {
    const m = re.exec(r.body);
    if (!m) continue;
    if (!ruleHitsAsSubject(r, node, chain)) continue;
    if (/!important/i.test(m[1]) || /#[\w-]/.test(r.selector) || /\[style\b/.test(r.selector)) {
      throw new Error(`[R8-5 守卫] 规则 \`${r.selector}\` 用 \`!important\` / ID / 内联属性覆盖 \`${prop}\`，`
        + '而本解析器只建模"类/属性选择器 + 权重 + 源序" —— 这类形态在浏览器里会压过它、'
        + '在守卫里却是隐形的（C-1 那族"守卫全绿、页面照错"）。请改用明确的类选择器。');
    }
    const spec = specificityOf(r.selector);
    if (!best || spec > best.spec || (spec === best.spec && r.no > best.no)) {
      best = { spec, no: r.no, raw: m[1].trim() };
    }
  }
  return best ? best.raw : null;
}

/* ============================================================================
 * 真跑一帧（与 net-lane-tree.test.ts 的 renderFrame 同源；本文件多两个旋钮）
 * ========================================================================== */

/** `renderChoiceUi` 的四个产出路径（见 `renderFrame` 里的说明）。 */
type ChoiceVariant = 'select' | 'select-line' | 'select-action' | 'rearrange';

interface FrameOpts {
  viewSeat: 0 | 1;
  /** **当前回合玩家**（绝对号）。R8-8 的判据就是"行动区挂到 `s.turnPlayer` 那一侧"。 */
  turnPlayer: 0 | 1;
  /** 挂一条**合成的 pending 选择**（`chooser` 是绝对号）—— R8-8 的选择条判据需要它。 */
  chooser?: 0 | 1;
  /** 选择条是否可选（决定有没有 `.choice-skip`「跳过」按钮）。 */
  optional?: boolean;
  /** 选择请求的**分支**（缺省 `select-action`）。 */
  variant?: ChoiceVariant;
}

function renderFrame(o: FrameOpts): StubNode {
  const s = createGame({ seed: 'r8-5-board-grid', draftStarter: 0, firstToPlay: 1 });
  for (const p of [0, 1] as const) {
    s.players[p].protocols = [
      { defId: 'fire-0', compiled: false },
      { defId: 'ice-0', compiled: false },
      { defId: 'light-0', compiled: false },
    ] as never;
  }
  (s as { phase: string }).phase = 'turn';
  // ⚠️ `createGame` 的 `turnPlayer` 恒为 0（`firstToPlay` 要等草稿结束才生效），所以"轮到谁"必须
  // 由本桩**显式**写 —— 这正是 G-9 里"真的构造出对手回合"的那一步（不是"存在即通过"）。
  s.turnPlayer = o.turnPlayer;
  if (o.chooser !== undefined) {
    // ⚠️ **四个变体分别对应 `renderChoiceUi` 的四个产出路径**（评审 I-2 指出：只测 `select-action`
    //    会让另外三处 `mountChoiceBar` 调用点**零覆盖**）：
    //      · `select`        —— `render-net.ts:1018` 附近（候选卡分支，产出 `.choice-confirm`）；
    //      · `select-line`   —— `:1037` 附近（`choiceBar(...)`，只有「跳过」，确认靠点整条带）；
    //      · `select-action` —— `:1073` 附近（有 `actions` ⇒ `.choice-action-btn`）；
    //      · `rearrange`     —— 同一条 `:1073`（`rearrangeSide !== undefined`）⇒ 条里**零按钮**、
    //                            只有 `.choice-note`，应答靠 body 级重排模态（唯一具备"死锁形态"的分支）。
    //    `select` 的候选卡**铺在场上**（而不是让它掉进 `buildChoicePickOverlay`）：既真跑
    //    `.card[data-uid]` 高亮那条路，也不额外依赖浮层所需的桩能力。
    const variant = o.variant ?? 'select-action';
    if (variant === 'select') {
      s.players[0].stacks = [[{
        uid: 'g9-c1', defId: 'fire-0', faceUp: true, owner: 0, zone: 'field', line: 0, pos: 0,
      }], [], []] as never;
    }
    const prompt = variant === 'select-line'
      ? {
        kind: 'select-line', title: 'G-9 合成选择：请选择目标线', min: 1, max: 1,
        optional: o.optional ?? true, candidates: [], lines: [0, 1, 2], chooser: o.chooser,
      }
      : variant === 'select'
        ? {
          kind: 'select', title: 'G-9 合成选择：请选择卡牌', min: 1, max: 1,
          optional: o.optional ?? true, chooser: o.chooser,
          candidates: [{
            uid: 'g9-c1', defId: 'fire-0', faceUp: true, owner: 0, zone: 'field', line: 0, pos: 0,
            label: 'fire-0',
          }],
        }
        : variant === 'rearrange'
          ? {
            kind: 'select-action', title: 'G-9 合成选择：重排协议', min: 1, max: 1, optional: false,
            candidates: [], actions: [], rearrangeSide: 0, chooser: o.chooser,
          }
          : {
            kind: 'select-action', title: 'G-9 合成选择：请选择动作', min: 1, max: 1,
            optional: o.optional ?? true, candidates: [], actions: ['action:flip'], chooser: o.chooser,
          };
    s.pendingEffects.push({
      id: 'g9-choice',
      player: (1 - o.chooser) as 0 | 1,   // 效果属主 = 对手（chooser 是被作用方）
      gen: 1,
      sourceUid: 'g9-src',
      sourceDefId: 'corruption-2',
      prompt,
      lastAnswer: null,
    } as never);
  }
  const root = makeStubEl('div');
  const noop = (): void => { /* noop */ };
  renderNetBoard(root as unknown as HTMLElement, s, {
    onAction: noop, onRendered: noop, rerender: noop, onDraftPick: noop, onDraftUnpick: noop,
    onDraftBan: noop, onWinReset: noop,
  } as never, { viewSeat: o.viewSeat, verifyHooks: false });
  return root;
}

/** 渲染根（`.net-board`）。 */
const boardOf = (root: StubNode): StubNode => {
  const b = root.children.find((n) => isClass(n, 'net-board'));
  expect(b, 'root 下没有 .net-board（渲染器没挂 wrap？）').toBeTruthy();
  return b!;
};

/** 某一侧的信息块（`data-net-seat`），**按元素树**取（不是按位置猜）。 */
const infoBlockOf = (root: StubNode, seat: 'self' | 'foe'): StubNode => {
  const found = descendants(root).filter((n) => isClass(n, 'net-info-block') && n.dataset.netSeat === seat);
  expect(found.length, `元素树里 ${seat} 侧的信息块不是恰好一块（实际 ${found.length} 块）`).toBe(1);
  return found[0];
};

/** 元素树里所有带这些类名的后代（打印/断言用）。 */
const withClass = (root: StubNode, ...cls: string[]): StubNode[] =>
  descendants(root).filter((n) => cls.every((c) => isClass(n, c)));

/** 从 `root` 到 `target` 的祖先链（含 `target` 自己）。找不到 ⇒ 抛错（响亮，不返回空链）。 */
function ancestorsOf(root: StubNode, target: StubNode): StubNode[] {
  const path: StubNode[] = [];
  const visit = (n: StubNode, chain: StubNode[]): boolean => {
    const next = [...chain, n];
    if (n === target) { path.push(...next); return true; }
    for (const c of n.children) if (visit(c, next)) return true;
    return false;
  };
  if (!visit(root, [])) throw new Error('ancestorsOf：目标节点不在 root 的子树里（结构被改动？）');
  return path;
}

/* ============================================================================
 * G-7：五行的**视觉行序**（盒树展平 + 真解 `grid-row`）
 * ========================================================================== */

/** 一条 grid item：节点、它的**祖先链**（含自身）、解出的 `grid-row`（无声明 = `Infinity`）。 */
interface GridItem { node: StubNode; chain: StubNode[]; row: number }

/**
 * `.net-board` 的 **grid item 列表**（**盒树**语义：`display: contents` 的元素与其子节点合并一层）。
 *
 * ⚠️ 只有 `display: contents` 的元素才会被展平 —— 模型**真的读样式表**解出 `display`
 * （按类名硬编码的话，"删掉那条 contents"的变异不会红：模型自己把容器当成透明的了）。
 */
function gridItemsOf(board: StubNode, rules: CssRule[]): GridItem[] {
  const out: GridItem[] = [];
  const visit = (parent: StubNode, chain: StubNode[]): void => {
    for (const child of parent.children) {
      const c: StubNode[] = [...chain, parent, child];
      if (subjectPropOf(child, c, rules, 'display') === 'contents') {
        visit(child, [...chain, parent]);
        continue;
      }
      const raw = subjectPropOf(child, c, rules, 'grid-row');
      out.push({ node: child, chain: c, row: raw === null ? Number.POSITIVE_INFINITY : Number.parseInt(raw, 10) });
    }
  };
  visit(board, []);
  return out;
}

/** 一条 grid item 的**语义标签**（按**侧**，不按绝对玩家号 —— 与规格 §8.3 的口径一致）。 */
function labelOf(it: GridItem): string {
  const n = it.node;
  if (isClass(n, 'net-info-block')) return `信息块:${String(n.dataset.netSeat)}`;
  if (isClass(n, 'net-hand-area')) {
    const side = isClass(n, 'net-hand-area-foe') ? 'foe' : isClass(n, 'net-hand-area-self') ? 'self' : '?';
    return `手牌区:${side}`;
  }
  if (isClass(n, 'net-grid')) return '链路+控制轨';
  return `其他(${n.cls})`;
}

const DESIGNATED = ['信息块:foe', '手牌区:foe', '链路+控制轨', '手牌区:self', '信息块:self'];

/**
 * **并盒后的视觉顺序**（R9-3；与 `DESIGNATED` 分开，因为两者的用途不同）：
 * `DESIGNATED` 是"这五块必须都是顶层 grid item"的**集合**（顺序无关），
 * 这张表是**读序**：并盒的那两行里，手牌区的**列盒**从第 1 列起（整行）、信息块在第 1 列，
 * 盒树展平后 DOM 顺序是 `.net-hands` 在 `.net-bottom` 的**信息块之后** ⇒ 解出的
 * `gridItemsOf` 序列是 `[grid, infoFoe, handFoe, …]`。
 * ⚠️ 这一点**不影响**用户要的观感（手牌整页中置、信息块在左列），只是"同一行内的先后"在
 * 展平序里由 DOM 决定 —— 把它写成一条**显式**的期望（而不是靠排序稳不稳定），失败时能直接看出。
 */
const VISUAL = ['手牌区:foe', '信息块:foe', '链路+控制轨', '信息块:self', '手牌区:self'];

/**
 * **R9-3 的行表**：信息块与手牌区**并盒同排** ⇒ 五块只占**四个** `grid-row`
 * （row1 = 对手[信息块 | 手牌区]、row2 = 链路、row3 = 日志/工具条、row4 = 自己[信息块 | 手牌区]）。
 * ⚠️ 这张表是"同排"这件事的**期望**侧；行为侧由下面 ③′ 的"同一行里既要找到该侧信息块、
 * 又要找到该侧手牌区"钉住（**G-12**）。
 */
const ROW_GROUPS: ReadonlyArray<{ rows: number; labels: string[] }> = [
  { rows: 1, labels: ['信息块:foe', '手牌区:foe'] },
  { rows: 1, labels: ['链路+控制轨'] },
  { rows: 1, labels: ['手牌区:self', '信息块:self'] },
];

afterEach(() => { setFxViewSeat(null); });

describe('R8-5 / R8-6 / R9-1 / R9-3：网格行序与列指派 · 控制轨归中（真跑 renderNetBoard + 解样式表）', () => {
  it('G-7 + G-12. 并盒行序 = [对手信息块 · 对手手牌 | 链路+控制轨 | 自己手牌 · 自己信息块]（两个席位都是）', async () => {
    const restore = installStubDom();
    try {
      for (const seat of [0, 1] as const) {
        const root = renderFrame({ viewSeat: seat, turnPlayer: 0 });
        const board = boardOf(root);

        // ── ① 容器必须是**grid**（`grid-row` 在 flex column / block 下完全无效）──
        expect(subjectPropOf(board, [board], RULES, 'display'),
          '.net-board 不是 grid —— 行/列指派在 flex column 下会**静默失效**'
          + '（视觉顺序退回 DOM 顺序）').toBe('grid');

        const items = gridItemsOf(board, RULES);
        const tree: string[] = [];
        walk(board, 0, tree, 4);
        console.log(`\n===== viewSeat=${seat} · .net-board 的盒树（展平 display:contents 后的 grid item）=====\n`
          + items.map((it) => `  row=${it.row === Number.POSITIVE_INFINITY ? 'auto' : it.row}`
            + `  ${labelOf(it)}`).join('\n'));

        // ── ② 五块"点名"的部分必须都是**顶层** grid item（不是缩在某个 contents 容器里）──
        const labels = items.map(labelOf);
        const missing = DESIGNATED.filter((d) => !labels.includes(d));
        expect(missing, `viewSeat=${seat}：这些部分**不是** .net-board 的 grid item：${missing.join('、')}`
          + `\n—— 最可能的原因：少写了一条 \`display: contents\`（.net-bottom / .net-hands），`
          + `于是该容器的子节点缩在里面、跟着 DOM 顺序走（\`grid-row\` 声明还在却静默不生效）。`
          + `\n实测顶层 item：${labels.join(' | ')}`).toEqual([]);

        // ── ③ 行号必须**真的**来自样式表（不是 auto）──
        const designated = items.filter((it) => DESIGNATED.includes(labelOf(it)));
        for (const it of designated) {
          expect(Number.isFinite(it.row), `viewSeat=${seat}：${labelOf(it)} 没有解出 grid-row`
            + '（行号必须由样式表按侧给；靠 DOM 顺序就是 R8-5 之前的旧样）').toBe(true);
        }
        // ── ③′ **R9-3 的行表**：五块占**四行**，且"信息块与手牌区同行"逐侧成立 ──
        //    ⚠️ 判据迁移（**不是放松**）：R8-5/R8-7 要求"五块五行、互不相同"（信息块各占一整行）；
        //    R9-3 的裁决恰恰是"手牌并进信息盒"⇒ 那一句会把本波的裁决判成失败。
        //    新判据**多查了一件事**：R8-5 时"信息块与手牌区同一行"是不可能出现的形态
        //    （同一行只有一个组件），所以旧句根本表达不出这条约束。
        //    行数仍是**精确值**（4），跳行/串行（`grid-row: 3` 与 `4` 对调、某块 `auto`）照样红。
        const rowOf = (l: string): number => designated.find((it) => labelOf(it) === l)!.row;
        const rowsUsed = [...new Set(designated.map((it) => it.row))].sort((a, b) => a - b);
        expect(rowsUsed, `viewSeat=${seat}：并盒后五块应恰好占 4 行（每侧"信息块 + 手牌区"同行），`
          + `实际占 ${rowsUsed.length} 行：`
          + designated.map((it) => `${labelOf(it)}=${it.row}`).join(' / ')).toEqual([1, 2, 4]);
        for (const g of ROW_GROUPS) {
          const got = g.labels.map(rowOf);
          // 每个分组**内部**必须同排（`rows` 是该分组占的行数；并盒的分组 = 1 行装两块）
          expect(new Set(got).size, `viewSeat=${seat}：${g.labels.join(' 与 ')} 必须共用**同一个** grid-row`
            + `（R9-3：手牌并入信息盒），实际 ${g.labels.map((l, i) => `${l}=${got[i]}`).join(' / ')}`)
            .toBe(g.rows);
        }
        // 逐侧点名（失败信息比"集合不等"可读，也防有人把 ROW_GROUPS 一起改错）
        expect(rowOf('信息块:foe'), `viewSeat=${seat}：对手信息块与对手手牌区必须**同一行**（R9-3）`)
          .toBe(rowOf('手牌区:foe'));
        expect(rowOf('信息块:self'), `viewSeat=${seat}：自己信息块与自己手牌区必须**同一行**（R9-3）`)
          .toBe(rowOf('手牌区:self'));
        expect(rowOf('信息块:foe'), `viewSeat=${seat}：并盒的两侧不得落在同一行（上下镜像）`)
          .not.toBe(rowOf('信息块:self'));

        // ── ④ **视觉行序**（本守卫的核心）：按 grid-row 排序后的标签序列 ──
        //    并盒那一行里两块**同号**，先后由展平后的 DOM 顺序决定（见 `VISUAL` 的说明）；
        //    这里同时钉"行号真的来自样式表"（③）与"同一行内的次序稳定可读"。
        const visual = designated.slice().sort((a, b) => a.row - b.row).map(labelOf);
        console.log(`  ----- viewSeat=${seat} · 视觉上→下（grid-row 解算）: ${visual.join(' → ')}`);
        expect(visual, `viewSeat=${seat}：视觉顺序必须是\n  ${VISUAL.join(' → ')}\n`
          + `实际\n  ${visual.join(' → ')}`).toEqual(VISUAL);

        // ── ⑤ **R9-3 的列指派**：信息块占**左列**（不跨列）、手牌区横跨**整行**（到右边界）──
        //    这两条合起来就是"同一个盒子、且手牌仍整页中置"的机制（信息块只在左侧，
        //    不参与手牌的水平居中计算）。
        for (const it of designated) {
          const col = subjectPropOf(it.node, it.chain, RULES, 'grid-column');
          if (labelOf(it).startsWith('信息块')) {
            expect(col, `viewSeat=${seat}：${labelOf(it)} 的 grid-column 必须是**左列**（\`1\` 或 \`1 / 2\`），`
              + `实际 ${String(col)} —— 跨列会把它压在手牌区上面`).toMatch(/^1(\s*\/\s*2)?$/);
          } else if (labelOf(it).startsWith('手牌区')) {
            expect(col, `viewSeat=${seat}：${labelOf(it)} 的 grid-column 必须是**整行**（\`1 / -1\` = 到右边界），`
              + `实际 ${String(col)} —— 被限制到某一列之后手牌就不再整页中置`).toMatch(/^1\s*\/\s*-1$/);
          } else {
            expect(col, `viewSeat=${seat}：${labelOf(it)} 的 grid-column 必须是整行（\`1 / -1\`）`)
              .toMatch(/^1\s*\/\s*-1$/);
          }
        }

        // ── ⑥ **镜像**：两块手牌区/两块信息块分处链路两侧（对手在上、自己在下）——
        //     这正是用户要的"上下镜像对称"；④ 已蕴含，这里显式落一条可读的断言 ──
        expect(rowOf('信息块:foe'), `viewSeat=${seat}：对手信息块必须在**最上**（行号小于链路）`)
          .toBeLessThan(rowOf('链路+控制轨'));
        expect(rowOf('手牌区:foe'), `viewSeat=${seat}：对手手牌必须在**对手链路之上**`
          + '（用户原话："对手手牌要放在对方链路的上方"）').toBeLessThan(rowOf('链路+控制轨'));
        expect(rowOf('信息块:self'), `viewSeat=${seat}：自己信息块必须在**最下**`)
          .toBeGreaterThan(rowOf('链路+控制轨'));
        expect(rowOf('手牌区:self'), `viewSeat=${seat}：自己手牌必须在链路之下`)
          .toBeGreaterThan(rowOf('链路+控制轨'));
      }
    } finally {
      await drainRaf();
      restore();
    }
  });

  /**
   * G-7 的**另一半**（源码腿）：行号指派必须**按侧**（`data-net-seat` / `.net-hand-area-{foe,self}`），
   * **不得**按绝对玩家号（`data-player` / `.p1` / `.p2`）。
   *
   * 为什么单列一条（行为腿已在 G-7 里两个席位都跑过）：R-F · C-2 的两次 Critical 全部出在
   * "按侧的选择器被写成按绝对玩家号"—— 那在**默认席位**下可能仍然正确（`viewSeat=0` 时
   * `self = P0`），只有切到 `viewSeat=1` 才错。这条源码腿的价值是**报错信息直接点名**
   * "写成按玩家号了"，而不是让人去猜为什么席位 1 挂了。
   */
  it('G-7b. 行号指派必须按**侧**（源码腿）：grid-row 规则里不得出现绝对玩家号', () => {
    const rowRules = RULES.filter((r) => /(?:^|;|\s)grid-row\s*:/.test(r.body) && /net-/.test(r.selector));
    console.log(`\n===== G-7b · styles-net.css 里给 net 节点派行号的规则（${rowRules.length} 条）=====\n`
      + rowRules.map((r) => `  ${r.selector} { ${r.body.trim()} }`).join('\n'));
    // 反空集合：一条都没有 ⇒ 五行行号根本不来自样式表（G-7 会红，但这里要能读出原因）
    expect(rowRules.length, 'styles-net.css 里没有任何给 net 节点派 grid-row 的规则').toBeGreaterThanOrEqual(5);
    // ① 两块信息块按 `data-net-seat`、两块手牌区按侧类名
    const sel = rowRules.map((r) => r.selector).join(' | ');
    for (const want of ["[data-net-seat='foe']", "[data-net-seat='self']", '.net-hand-area-foe', '.net-hand-area-self']) {
      expect(sel, `styles-net.css 的行号规则里找不到按侧的写法 ${want}`).toContain(want);
    }
    // ② 反面：不得按绝对玩家号（`data-player` / `.p1` / `.p2`）——那是 C-2 的原始缺陷形态
    const byPlayer = rowRules.filter((r) => /data-player|\.p[12](?![\w-])/.test(r.selector));
    expect(byPlayer.map((r) => r.selector),
      '行号按**绝对玩家号**指派了（`data-player` / `.p1` / `.p2`）—— 席位一切换就会两边对调'
      + '（R-F · C-2 的两次 Critical 都是这个形态：默认席位下看着还对）').toEqual([]);
  });

  /**
   * **G-7c：解析器前提的共享全局腿**（评审 **I-1** 的收口）。
   *
   * `subjectPropOf` 里的 `!important`/ID/内联保护是**解算式**的 —— 它只在"**本次解算到的那条规则**"
   * 命中被查节点时才抛错。而漏进来的形态恰恰是**权重更大、会覆盖掉解算结果**的那一类：它可能与
   * 本次解算的属性**根本不同**（评审实测：`#x .net-board{display:flex}` 在"只解算 `grid-row`"的
   * 路径上完全隐形，本文件第一版 6 条全绿）。
   *
   * ⇒ 这条腿调**共享**的 `assertNoUnmodelableCascade(RULES, MODELED_PROPS)`（与
   * `net-lane-tree.test.ts` 的 G-5c④ **同一份实现、同一个属性清单**）：**全表扫描**，
   * 与"本次解算了什么"无关。属性清单见 `./net-css-parse` 的 `MODELED_PROPS`（并集，
   * 含本文件解算的 `display` / `grid-row` / `grid-column` / `align-self` / `position` / `transform` /
   * `bottom` / `grid-template-columns`）。
   */
  it('G-7c. 解析器前提（共享全局腿）：styles-net.css 不得含 `!important` / ID / 内联覆盖', () => {
    console.log(`\n===== G-7c · 共享前提腿（全表扫描，与 net-lane-tree 的 G-5c④ 同一实现）=====\n`
      + `  规则 ${RULES.length} 条 × 属性清单 ${MODELED_PROPS.length} 个`);
    expect(() => assertNoUnmodelableCascade(RULES, MODELED_PROPS),
      'styles-net.css 里出现了本解析器**不建模**的层叠形态（`!important` / ID / 内联样式）——'
      + '它会压过类选择器、却在守卫里隐形（C-1 那族"守卫全绿、页面照错"）；'
      + '必须先人工处理（改成明确的类选择器），而不是让守卫猜').not.toThrow();
  });

  it('G-8. 控制轨竖直**归中**：.net-grid > .control-module 的 align-self = center（不是 start）', () => {
    const board = makeStubEl('div');
    board.classList.add('board', 'net-board');
    const grid = makeStubEl('div');
    grid.classList.add('board-grid', 'net-grid');
    const rail = makeStubEl('div');
    rail.classList.add('control-module');
    const raw = subjectPropOf(rail, [board, grid, rail], RULES, 'align-self');
    console.log(`\n===== G-8 · .net-grid > .control-module 的 align-self（由 styles-net.css 真实解算）=====\n  ${String(raw)}`);
    expect(raw, '控制轨的 align-self 解不出（规则被删？）').toBeTruthy();
    expect(raw, '控制轨必须 align-self: center —— 两侧链路等高（R8-3 的 7 张预留）时列中点 = 中线，'
      + '控制轨正好落在"双方协议相对的中间"（用户原话）；`start` 会把它贴到对手那一侧的最外端'
      + `（正是用户点名的"位于对方顶部"）。实际 ${String(raw)}`).toBe('center');
    // 反面（防"改回去"）：样式表里**不得**再有 start 版本（并存 = 两套真相）
    const railRules = RULES.filter((r) => /\.control-module/.test(r.selector) && /align-self/.test(r.body));
    expect(railRules.filter((r) => /align-self\s*:\s*start/.test(r.body)).map((r) => r.selector),
      'styles-net.css 里仍有 `align-self: start` 的控制轨规则').toEqual([]);
    // 横向位置（第 4 列）**一个字未动**：用户只提了竖直位置
    const tracks = subjectPropOf(grid, [board, grid], RULES, 'grid-template-columns') ?? '';
    expect(tracks, '控制轨被从第 4 条轨道挪走了？（用户只要求改竖直位置）')
      .toMatch(/repeat\(3,.*\)\s*var\(--net-rail-w\)/);
  });
});

/* ============================================================================
 * G-9：操作按钮只在**操作方**那一侧（R8-8）
 * ========================================================================== */

/** 那一侧信息块里的"操作控件"清单（本轮判据用的四个类名）。 */
function operatorButtonsIn(block: StubNode): string[] {
  const out: string[] = [];
  for (const n of descendants(block)) {
    if (isClass(n, 'next-btn')) out.push('next-btn');
    else if (isClass(n, 'choice-skip')) out.push('choice-skip');
    else if (isClass(n, 'choice-bar')) out.push('choice-bar');
  }
  return out;
}

/**
 * **四个分支**（`ChoiceVariant`）各自"操作方那一侧应当出现的控件" —— 这张表就是评审要的
 * "哪条腿覆盖哪个分支"的机读形式（每条都在 `renderFrame` 里被真的构造出来，不是源码腿）：
 *
 * | 变体 | 期望（操作方信息块内） | 分支特有的正面证据 |
 * | --- | --- | --- |
 * | `select` | `[choice-bar, choice-skip]` | `.choice-confirm`（确认按钮：候选卡的勾选结果） |
 * | `select-line` | `[choice-bar, choice-skip]` | `.choice-lane-band.choice-line`（确认靠点整条带） |
 * | `select-action` | `[choice-bar, choice-skip]` | `.choice-action-btn`（actions 的按钮） |
 * | `rearrange` | `[choice-bar]`（**零按钮**） | `.choice-note`（应答靠 body 级重排模态） |
 */
interface VariantSpec {
  variant: ChoiceVariant;
  expectButtons: string[];
  /** 该分支独有的类名（在操作方那一侧必须存在 —— 证明"真跑到了那个分支"而不是空条） */
  marker: string;
  markerWhere: 'operator' | 'board';
  note: string;
}

const VARIANT_SPECS: readonly VariantSpec[] = [
  {
    variant: 'select', expectButtons: ['choice-bar', 'choice-skip'], marker: 'choice-confirm',
    markerWhere: 'operator', note: 'select：候选卡分支（确认按钮在条里）',
  },
  {
    variant: 'select-line', expectButtons: ['choice-bar', 'choice-skip'], marker: 'choice-line',
    markerWhere: 'board', note: 'select-line：choiceBar 分支（确认靠点整条高亮带，条里只有跳过）',
  },
  {
    variant: 'select-action', expectButtons: ['choice-bar', 'choice-skip'], marker: 'choice-action-btn',
    markerWhere: 'operator', note: 'select-action：actions 按钮分支',
  },
  {
    variant: 'rearrange', expectButtons: ['choice-bar'], marker: 'choice-note',
    markerWhere: 'operator', note: 'rearrange（rearrangeSide）：条里**零按钮**，只有一行提示',
  },
];

describe('R8-8：操作按钮只在操作方那一侧的信息块里', () => {
  it('G-9a. 行动区（下一步/编译线N/…）挂在**当前回合玩家**那一侧（两个席位 × 两个回合方）', async () => {
    const restore = installStubDom();
    try {
      for (const seat of [0, 1] as const) {
        for (const turn of [0, 1] as const) {
          const root = renderFrame({ viewSeat: seat, turnPlayer: turn });
          const selfBlock = infoBlockOf(root, 'self');
          const foeBlock = infoBlockOf(root, 'foe');
          const turnIsSelf = turn === seat;
          const mine = turnIsSelf ? selfBlock : foeBlock;
          const theirs = turnIsSelf ? foeBlock : selfBlock;
          const tag = `viewSeat=${seat} / turnPlayer=${turn}（轮到${turnIsSelf ? '自' : '对'}己）`;

          console.log(`\n===== G-9a · ${tag} =====\n`
            + `  操作方信息块里的 .next-btn = ${withClass(mine, 'next-btn').length}`
            + ` / 非操作方 = ${withClass(theirs, 'next-btn').length}`);

          // ① 操作方那一侧**有**「下一步」（正面断言 —— 防"两边都没有"也算过）
          expect(withClass(mine, 'next-btn').length, `${tag}：操作方那一侧必须有「下一步」`
            + '（`getLegalActions(s, s.turnPlayer)` 在 step=start 且无必选触发时产出 advance）').toBe(1);
          expect(withClass(mine, 'net-action-bar').length, `${tag}：操作方那一侧必须有行动区 .net-action-bar`).toBe(1);
          // ② 非操作方那一侧**一个操作按钮都没有**（用户的字面判据）
          expect(operatorButtonsIn(theirs), `${tag}：非操作方那一侧不得出现任何操作按钮`
            + '（用户原话："没轮到自己的回合……就不用在己方显示下一步之类的跳过按钮"）').toEqual([]);
          expect(withClass(theirs, 'net-action-bar').length, `${tag}：非操作方那一侧不得挂行动区`).toBe(0);
        }
      }
    } finally {
      await drainRaf();
      restore();
    }
  });

  /**
   * G-9b：**`renderChoiceUi` 的四个分支各自**把选择条挂到操作方那一侧（评审 I-2 的覆盖收口）。
   *
   * ⚠️ 为什么必须**逐个**分支跑：三处 `mountChoiceBar` 调用点（`/render-net.ts:1018/1037/1073`）
   * 分属 `select` / `select-line` / `select-action` 三个分支（第四个变体 `rearrange` 走的是
   * `select-action` 里 `rearrangeSide !== undefined` 的那条腿）。只测其中一个分支时，
   * **另外两处调用点的变异是不红的** —— 覆盖缺口正是这样产生的（评审实测指出）。
   * 这条表驱动腿对**每个变体**都断言：操作方那侧有唯一的 `.choice-bar`、非操作方那侧一个控件都没有、
   * 该分支**独有的标记类**确实出现（反空集合：证明真跑到了那个分支）。
   */
  it('G-9b. 选择条挂**操作方**那一侧 —— 四个分支（select / select-line / select-action / rearrange）逐个跑', async () => {
    const restore = installStubDom();
    try {
      for (const seat of [0, 1] as const) {
        for (const chooser of [0, 1] as const) {
          for (const spec of VARIANT_SPECS) {
            const root = renderFrame({
              viewSeat: seat, turnPlayer: 0, chooser, optional: true, variant: spec.variant,
            });
            const selfBlock = infoBlockOf(root, 'self');
            const foeBlock = infoBlockOf(root, 'foe');
            const chooserIsSelf = chooser === seat;
            const mine = chooserIsSelf ? selfBlock : foeBlock;
            const theirs = chooserIsSelf ? foeBlock : selfBlock;
            const tag = `[${spec.variant}] viewSeat=${seat} / chooser=${chooser}`
              + `（${chooserIsSelf ? '自' : '对'}己应答，${spec.note}）`;

            console.log(`\n===== G-9b · ${tag} =====\n`
              + `  操作方信息块里 = [${operatorButtonsIn(mine).join(', ')}]`
              + ` / 非操作方 = [${operatorButtonsIn(theirs).join(', ')}]`);

            // ① 反空集合（先证明"真跑到了这个分支"）：该分支独有的标记类必须出现
            const markerHost = spec.markerWhere === 'operator' ? mine : root;
            expect(withClass(markerHost, spec.marker).length, `${tag}：没找到该分支独有的 \`${spec.marker}\``
              + '—— 说明这个变体没有真的走到那条产出路径（这条断言就是"覆盖"本身）').toBeGreaterThan(0);
            // ② 操作方那一侧有选择条 + 该分支应有的控件（`rearrange` 分支**零按钮**，只有一行提示）
            expect(operatorButtonsIn(mine), `${tag}：操作方那一侧的操作控件清单不符`)
              .toEqual(spec.expectButtons);
            expect(withClass(mine, 'choice-bar').length, `${tag}：操作方那一侧必须**恰好一条** .choice-bar`).toBe(1);
            // ③ 非操作方那一侧**什么操作控件都没有**（含 `.choice-bar` —— 旧版它 fixed 在视口底部，
            //    看上去永远"挂在我这边"，这正是用户点名要改的观感）
            expect(operatorButtonsIn(theirs), `${tag}：非操作方那一侧不得出现 .choice-bar / .choice-skip / .next-btn`).toEqual([]);
            expect(withClass(theirs, 'choice-bar').length, `${tag}：非操作方那一侧不得有 .choice-bar`).toBe(0);
            // ④ 选择条的位置**是流内的**（`styles-net.css` 覆盖了 `styles.css` 的 fixed）：级联解算钉住
            //    —— 挂对了侧但还是 `fixed` 的话，观感与改之前没有区别。
            const barItem = descendants(mine).find((n) => isClass(n, 'choice-bar'))!;
            const chain = ancestorsOf(root, barItem);
            expect(subjectPropOf(barItem, chain, RULES, 'position'),
              `${tag}：.choice-bar 在远程页必须是 position: static（styles.css 的 fixed + 视口底部居中`
              + '会让它看上去永远挂在自己这边）').toBe('static');
            expect(subjectPropOf(barItem, chain, RULES, 'transform'),
              `${tag}：.choice-bar 的 transform 必须被中和（styles.css 用 translateX(-50%) 做视口居中）`)
              .toMatch(/^none$/);
            expect(subjectPropOf(barItem, chain, RULES, 'bottom'),
              `${tag}：.choice-bar 的 \`bottom: 18px\` 必须被中和（流内元素上的 bottom 虽然无效，`
              + '但留着它就会让"它已经回到流内"这件事在样式表里看不出来）').toMatch(/^auto$/);
          }
        }
      }
    } finally {
      await drainRaf();
      restore();
    }
  });

  /**
   * G-9c（**反空集合**）：桩里**真的**构造出了"轮到对手"与"对手是 chooser"的局面。
   *
   * 为什么必须单列一条：上面两条断言都是"某侧有 / 某侧没有"，而如果桩**根本没造出**那个局面
   * （例如 `getLegalActions` 因 `pendingEffects` 非空而返回空、或 `turnPlayer` 忘了改），
   * "非操作方没有按钮"会**恒真**（假绿）。这条把桩的前提钉住：回合方确实是写进去的那个值、
   * 选择确实挂在 `pendingEffects` 上、且 `chooser` 确实是我们要的那一侧。
   */
  it('G-9c. 桩的前提（反空集合）：真的构造出了"对手回合"与"对手是 chooser"', async () => {
    const restore = installStubDom();
    try {
      const root = renderFrame({ viewSeat: 0, turnPlayer: 1 });
      const selfBlock = infoBlockOf(root, 'self');
      const foeBlock = infoBlockOf(root, 'foe');
      // 回合方那一侧**确实**有按钮（否则上面 G-9a 的"非操作方没有"是空断言）
      expect(withClass(foeBlock, 'next-btn').length, '桩没造出"对手回合"（对手那侧没有 .next-btn）').toBe(1);
      expect(withClass(selfBlock, 'next-btn').length, '桩没造出"对手回合"（自己那侧反而有 .next-btn）').toBe(0);
      // chooser 那一侧**确实**有选择条
      const root2 = renderFrame({ viewSeat: 0, turnPlayer: 1, chooser: 1 });
      expect(withClass(infoBlockOf(root2, 'foe'), 'choice-bar').length, '桩没造出"对手是 chooser"').toBe(1);
      expect(withClass(infoBlockOf(root2, 'self'), 'choice-bar').length,
        '桩没造出"对手是 chooser"（自己那侧反而有选择条）').toBe(0);
    } finally {
      await drainRaf();
      restore();
    }
  });
});
