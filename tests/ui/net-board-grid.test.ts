import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createGame } from '../../src/core/state/create';
import { renderNetBoard } from '../../src/ui/render-net';
import { setFxViewSeat } from '../../src/ui/fx-seat';
import {
  assertNoUnmodelableCascade, cssRules, MODELED_PROPS, subjectPropOf, type CssRule,
} from './net-css-parse';
import { descendants, drainRaf, installStubDom, isClass, makeStubEl, walk, type StubNode } from './net-dom-stub';

/**
 * **R8-5 / R8-6 / R8-8 的守卫**（规格 `docs/2026-09-15-G2修正R8-能量槽外移与协议特效跟随.md` §8.6 的
 * G-7 / G-8 / G-9）—— 用户第二次验收反馈的最后四项落地后的机检腿：
 *
 * | 守卫 | 守什么 | 机制 |
 * | --- | --- | --- |
 * | **G-7** | 链路行 + **停靠栏**那一行的**行/列序**（链路 → 自己信息块 · 自己手牌 · 对手信息块 · 对手手牌张数） | 真跑 `renderNetBoard` + 把 `display: contents` 的盒树**展平** + 从样式表解出每条 grid item 的 `grid-row` / `grid-column` |
 * | **G-8** | 控制轨竖直**归中**（`align-self: center`，不是 `start`） | 级联解算 |
 * | **G-9** | 操作按钮只在**轮到自己的那一侧**（R11-3；R8-8 的"挂到行动方那一侧"已被用户否掉） | 真跑两个局面（回合归属 / chooser 归属）× 两个席位 |
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
 *
 * ⚠️ **R11-2**：`subjectPropOf` 与 `ruleHitsAsSubject` 原先在本文件里各有一份**局部拷贝**
 * （`net-r9.test.ts` 也有一份），已上提到 `./net-css-parse`（**一份实现**）。语义**一字未改**：
 * 只认"把被查节点当**选择器主体**"的规则（`cssPropOf` 允许主体绑到任意祖先，对"谁在第几行"
 * 这类判据是致命的 —— 见该函数的头注）。
 * ========================================================================== */

const cssPath = new URL('../../src/ui/styles-net.css', import.meta.url);
const netCss = readFileSync(fileURLToPath(cssPath)).subarray(0, 4 * 1024 * 1024).toString('utf8');
const RULES = cssRules(netCss);

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
 * **停靠栏那一行的四块**（R11-2/3）：它们**共用同一个 `grid-row`**，左右次序由**列**决定。
 * 这张表取代 R9-3 的 `ROW_GROUPS`（那张表按"每侧信息块 + 该侧手牌同一行"分组，共两组；
 * R11-2 之后对手那一块也搬进来 ⇒ 只剩**一组**四块）。
 */
const DOCK = ['信息块:self', '手牌区:self', '信息块:foe', '手牌区:foe'] as const;

/**
 * **视觉（行, 列）序**（R11-2；与 `DESIGNATED` 分开，因为两者用途不同）：
 * `DESIGNATED` 是"这五块必须都是顶层 grid item"的**集合**（顺序无关），
 * 这张表是**读序**：先按 `grid-row`，同一行内再按 `grid-column` 的**起始列**。
 *
 * ⚠️ **判据从"DOM 顺序"升级成"（行, 列）序"**：R9-3 时并盒的两块共用一行、列区间重叠
 * （手牌整行），同行的先后**只能**由 DOM 决定（当时那条注释就说清了这一点）。
 * R11-2 之后四块各有自己的列（自己信息块 1 / 自己手牌 1·-1 / 对手信息块 3 / 对手手牌 4）
 * ⇒ 同行的先后**由列决定**，与 DOM 顺序无关 —— 于是这张表在两个席位下**同值**，
 * 而且它顺带把"谁在左、谁在右"（用户第四次验收的字面要求）钉了进来。
 * 它比旧表**多查一件事**：旧表在同行内不查任何东西（DOM 顺序恰好就是期望值）。
 */
const VISUAL = ['链路+控制轨', '信息块:self', '手牌区:self', '信息块:foe', '手牌区:foe'];

afterEach(() => { setFxViewSeat(null); });

describe('R8-5 / R8-6 / R9-1 / R9-3：网格行序与列指派 · 控制轨归中（真跑 renderNetBoard + 解样式表）', () => {
  it('G-7 + G-12. 停靠栏行/列序 = [链路+控制轨 | 自己信息块 · 自己手牌 · 对手信息块 · 对手手牌张数]（两个席位都是）', async () => {
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
        // ── ③′ **R11-2/3 的行表**：五块占**两行** —— 链路那一行（1）与**停靠栏**那一行（3），
        //    停靠栏的四块**共用同一行**（"对手那一块搬进自己这一行"就是这个意思）。
        //    ⚠️ 判据迁移（**不是放松**）：R8-5/R8-7 要求"五块五行、信息块各占一整行"，
        //    R9-3 要求"每侧信息块与手牌同行"（两组），R11-2 把它们**合成一组**。
        //    新判据**多查了两件事**：① 停靠栏的四块必须在**同一行**（R9-3 时对手那一块在另一行）；
        //    ② 同行内的**左右次序**必须由列决定（旧模型在同行内不查任何东西）。
        //    行数仍是**精确值**（两行），跳行/串行（`grid-row: 2` 与 `3` 对调、某块 `auto`）照样红。
        const rowOf = (l: string): number => designated.find((it) => labelOf(it) === l)!.row;
        const colStartOf = (l: string): number => {
          const it = designated.find((x) => labelOf(x) === l)!;
          const raw = subjectPropOf(it.node, it.chain, RULES, 'grid-column') ?? '1';
          return Number.parseInt(raw.split('/')[0].trim(), 10);
        };
        const rowsUsed = [...new Set(designated.map((it) => it.row))].sort((a, b) => a - b);
        expect(rowsUsed, `viewSeat=${seat}：R11-2 之后五块应占**两行**（链路行 + 停靠栏行），`
          + `实际占 ${rowsUsed.length} 行：`
          + designated.map((it) => `${labelOf(it)}=${it.row}`).join(' / ')).toEqual([1, 3]);
        for (const l of DOCK) {
          expect(rowOf(l), `viewSeat=${seat}：${l} 与停靠栏其他三块不在同一行`
            + `（R11-2 的裁决是"对手那一块搬进自己这一行"）—— 实测 `
            + DOCK.map((x) => `${x}=${rowOf(x)}`).join(' / ')).toBe(rowOf(DOCK[0]));
        }
        expect(rowOf('链路+控制轨'), `viewSeat=${seat}：链路那一行必须在停靠栏**之上**`)
          .toBeLessThan(rowOf('信息块:self'));
        // 逐侧点名（失败信息比"集合不等"可读，也防有人把 DOCK 一起改错）
        expect(rowOf('信息块:self'), `viewSeat=${seat}：自己信息块与自己手牌区必须**同一行**`)
          .toBe(rowOf('手牌区:self'));
        expect(rowOf('信息块:foe'), `viewSeat=${seat}：对手信息块与对手手牌张数必须**同一行**`)
          .toBe(rowOf('手牌区:foe'));
        // ── ③″ **左右次序**（用户第四次验收的字面要求："对手信息块……摆在该行右侧"）──
        //    自己那一块在左、对手那一块在右；对手的手牌张数紧贴对手信息块的**右侧**。
        //    这两条是行为腿（从样式表解出的列号），不是"看着差不多"。
        expect(colStartOf('信息块:self'), `viewSeat=${seat}：自己信息块必须在对手信息块的**左侧**`
          + `（实际列 ${colStartOf('信息块:self')} vs ${colStartOf('信息块:foe')}）`)
          .toBeLessThan(colStartOf('信息块:foe'));
        expect(colStartOf('手牌区:foe'), `viewSeat=${seat}：对手手牌张数必须紧贴对手信息块的**右侧**`
          + `（实际列 ${colStartOf('手牌区:foe')} vs ${colStartOf('信息块:foe')}）`)
          .toBeGreaterThan(colStartOf('信息块:foe'));

        // ── ④ **视觉（行, 列）序**（本守卫的核心）──
        const colOf = (l: string): string => {
          const it = designated.find((x) => labelOf(x) === l)!;
          return subjectPropOf(it.node, it.chain, RULES, 'grid-column') ?? '';
        };
        const visual = designated.slice().sort((a, b) => (a.row - b.row)
          || (colStartOf(labelOf(a)) - colStartOf(labelOf(b)))
          || (items.indexOf(a) - items.indexOf(b))).map(labelOf);
        console.log(`  ----- viewSeat=${seat} · 视觉上→下/左→右（grid-row 优先、同行再按列）: ${visual.join(' → ')}`);
        expect(visual, `viewSeat=${seat}：视觉顺序必须是\n  ${VISUAL.join(' → ')}\n`
          + `实际\n  ${visual.join(' → ')}`).toEqual(VISUAL);

        // ── ⑤ **R11-2/3 的列指派**：四个部件各就各位（自己信息块=左列、自己手牌=整行、
        //    对手信息块=第 3 列、对手手牌张数=第 4 列）──
        const EXPECTED_COL: Record<string, RegExp> = {
          '信息块:self': /^1(\s*\/\s*2)?$/,
          '手牌区:self': /^1\s*\/\s*-1$/,
          '信息块:foe': /^3(\s*\/\s*4)?$/,
          '手牌区:foe': /^4(\s*\/\s*5)?$/,
          '链路+控制轨': /^1\s*\/\s*-1$/,
        };
        for (const it of designated) {
          const want = EXPECTED_COL[labelOf(it)];
          expect(want, `本守卫缺 ${labelOf(it)} 的期望列（白名单表漏项）`).toBeTruthy();
          expect(colOf(labelOf(it)), `viewSeat=${seat}：${labelOf(it)} 的 grid-column 不符`
            + `（实际 ${colOf(labelOf(it))}）`).toMatch(want);
        }

        // ── ⑥ **停靠栏在链路之下**（"不遮链路放牌区"的结构面）：停靠栏四块的行号都大于链路行 ──
        const laneRow = rowOf('链路+控制轨');
        for (const l of DOCK) {
          expect(rowOf(l), `viewSeat=${seat}：${l} 与链路同一行（停放栏会压住放牌区）`)
            .toBeGreaterThan(laneRow);
        }
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
  it('G-9a. 行动区（下一步/编译线N/…）**只在轮到自己是行动方**时挂在自己那一侧（两个席位 × 两个回合方）', async () => {
    const restore = installStubDom();
    try {
      for (const seat of [0, 1] as const) {
        for (const turn of [0, 1] as const) {
          const root = renderFrame({ viewSeat: seat, turnPlayer: turn });
          const selfBlock = infoBlockOf(root, 'self');
          const foeBlock = infoBlockOf(root, 'foe');
          const mine = turn === seat;
          const tag = `viewSeat=${seat} / turnPlayer=${turn}（轮到${mine ? '自' : '对'}己）`;

          console.log(`\n===== G-9a · ${tag} =====\n`
            + `  自己块里的 .next-btn = ${withClass(selfBlock, 'next-btn').length}`
            + ` / 对手块 = ${withClass(foeBlock, 'next-btn').length}`);

          // ── ① **对手那一侧永远零操作控件**（R11-3 的第一条；真联机下也防"替对手走棋"）──
          expect(operatorButtonsIn(foeBlock), `${tag}：对手那一侧不得出现任何操作按钮`
            + '（用户第四次验收原话："对手那一侧只显示信息，不再有按钮"）').toEqual([]);
          expect(withClass(foeBlock, 'net-action-bar').length, `${tag}：对手那一侧不得挂行动区`).toBe(0);
          if (mine) {
            // ── ② 轮到自己 ⇒ 按钮就在**自己这一侧**（正面断言 —— 防"两边都没有"也算过）──
            expect(withClass(selfBlock, 'next-btn').length, `${tag}：轮到自己时，自己那一侧必须有「下一步」`
              + '（`getLegalActions(s, s.turnPlayer)` 在 step=start 且无必选触发时产出 advance）').toBe(1);
            expect(withClass(selfBlock, 'net-action-bar').length, `${tag}：自己那一侧必须有行动区 .net-action-bar`).toBe(1);
          } else {
            // ── ③ 轮到**对手** ⇒ 两侧都没有按钮（R8-8 曾把对手的按钮画在对手那一块里，
            //     等于把对手的操作面板摊在我的屏幕上 —— 用户第四次验收明确否掉了它）──
            //     ⚠️ 这条不能省：只查 ① 的话，"把按钮挪到自己那一侧"（旧判据的反面）也能过，
            //        而那正是用户点名的形态（"没轮到自己的回合就不用在己方显示按钮"）。
            expect(operatorButtonsIn(selfBlock), `${tag}：轮到对手时，自己那一侧不得出现任何操作按钮`
              + '（那是对手的行动，不该由我这台机器提供）').toEqual([]);
            expect(withClass(selfBlock, 'net-action-bar').length, `${tag}：轮到对手时自己那一侧不得挂行动区`).toBe(0);
          }
        }
      }
    } finally {
      await drainRaf();
      restore();
    }
  });

  /**
   * G-9b：**`renderChoiceUi` 的四个分支各自**把选择条挂到**自己那一侧**（R11-3；评审 I-2 的覆盖收口）。
   *
   * ⚠️ 为什么必须**逐个**分支跑：三处 `mountIfMine` 调用点（`render-net.ts` 的三个分支）分属
   * `select` / `select-line` / `select-action`（第四个变体 `rearrange` 走 `select-action` 里
   * `rearrangeSide !== undefined` 的那条腿）。只测其中一个分支时，**另外两处调用点的变异是不红的**。
   *
   * ⚠️ **R11-3 之后这条腿覆盖两种局面**（旧版只有一种）：
   *   · **操作方就是自己** ⇒ 选择条挂在自己那一侧、带着该分支应有的控件；
   *   · **操作方是对手** ⇒ 选择条**根本不该出现**（用户："对手那一侧只显示信息，不再有按钮"）。
   *     这一半的"分支真的跑到了"由 `.net-hands.choice-mode`（R11-4 修好的挂点）证明 ——
   *     `renderChoiceUi` 在**分流之前**就给手牌条加这个类；而"该分支独有的标记类"那一半
   *     只适用于前者（对手应答时按钮与条都不产出，标记类自然也不存在）。
   */
  it('G-9b. 选择条只在**操作方就是自己**时挂在自己那一侧 —— 四个分支 × (自己应答 / 对手应答) 逐个跑', async () => {
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
            const tag = `[${spec.variant}] viewSeat=${seat} / chooser=${chooser}`
              + `（${chooserIsSelf ? '自' : '对'}己应答，${spec.note}）`;

            console.log(`\n===== G-9b · ${tag} =====\n`
              + `  自己块里 = [${operatorButtonsIn(selfBlock).join(', ')}]`
              + ` / 对手块 = [${operatorButtonsIn(foeBlock).join(', ')}]`);

            // ① 反空集合（先证明"真跑到了选择分支"）：`.net-hands` 必须带 `.choice-mode`
            //    （R11-4：它此前一直被加到**对手信息块**上 —— 挂点错了，两个消费方都失效）
            const handsRoot = descendants(root).find((n) => isClass(n, 'net-hands'));
            expect(handsRoot, `${tag}：元素树里找不到 .net-hands`).toBeTruthy();
            expect(isClass(handsRoot!, 'choice-mode'), `${tag}：.net-hands 没有 .choice-mode —— `
              + '要么这一帧没进选择分支（覆盖不成立），要么 R11-4 那个挂点又退回了 lastElementChild').toBe(true);
            // ② 选择条**恰好一条、且在自己那一侧**（对手应答时一条都没有 —— 见 ③）
            expect(withClass(foeBlock, 'choice-bar').length, `${tag}：对手那一侧不得有 .choice-bar`).toBe(0);
            expect(operatorButtonsIn(foeBlock), `${tag}：对手那一侧不得出现任何操作控件`).toEqual([]);
            if (chooserIsSelf) {
              // 该分支独有的标记类必须出现（证明走的是**这个变体**而不是别的分支）
              const markerHost = spec.markerWhere === 'operator' ? selfBlock : root;
              expect(withClass(markerHost, spec.marker).length, `${tag}：没找到该分支独有的 \`${spec.marker}\``
                + '—— 说明这个变体没有真的走到那条产出路径（这条断言就是"覆盖"本身）').toBeGreaterThan(0);
              expect(operatorButtonsIn(selfBlock), `${tag}：自己那一侧的操作控件清单不符`)
                .toEqual(spec.expectButtons);
              expect(withClass(selfBlock, 'choice-bar').length, `${tag}：自己那一侧必须**恰好一条** .choice-bar`).toBe(1);
              // ③ 选择条的位置**是流内的**（`styles-net.css` 覆盖了 `styles.css` 的 fixed）：级联解算钉住
              //    —— 挂对了侧但还是 `fixed` 的话，观感与改之前没有区别。
              const barItem = descendants(selfBlock).find((n) => isClass(n, 'choice-bar'))!;
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
            } else {
              // ④ **对手应答** ⇒ 两侧一条选择条、一个操作控件都没有（R11-3 的核心）
              expect(operatorButtonsIn(selfBlock), `${tag}：对手应答时，自己那一侧不得出现任何操作控件`
                + '（真联机下对手的选择条不该画在我的屏幕上）').toEqual([]);
              expect(withClass(selfBlock, 'choice-bar').length, `${tag}：自己那一侧不得有 .choice-bar`).toBe(0);
            }
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
   * ⚠️ **R11-3 之后这条变得更必要**：新判据是"轮到对手 ⇒ **两侧都没有**按钮"，
   * 而如果桩**根本没造出**那个局面（例如 `getLegalActions` 因 `pendingEffects` 非空而返回空、
   * 或 `turnPlayer` 忘了改），"两侧都没有"会**恒真**（假绿）。
   * ⇒ 判据改成**镜像对照**：同一个局面，把 `viewSeat` 切到行动方那一侧之后**必须**出现按钮。
   * 这比"某一侧存在按钮"更强：它同时证明了"这个局面里真的有一个行动方"与"按钮的归属跟着回合走"。
   */
  it('G-9c. 桩的前提（反空集合）：真的构造出了"对手回合"与"对手是 chooser"（镜像对照）', async () => {
    const restore = installStubDom();
    try {
      // ① 局面 = turnPlayer 1。viewSeat=0（我是 P1）⇒ 两侧都没有按钮；
      //    同一个局面切到 viewSeat=1（我是 P2、就是行动方）⇒ 自己那一侧必须有「下一步」。
      //    两条合起来证明"这一帧的行动方确实是 P2"，而不是"桩没造出回合方"。
      const foeTurnAs0 = renderFrame({ viewSeat: 0, turnPlayer: 1 });
      expect(withClass(infoBlockOf(foeTurnAs0, 'self'), 'next-btn').length,
        '轮到对手时自己那一侧出现了 .next-btn（R11-3 的缺陷形态）').toBe(0);
      expect(withClass(infoBlockOf(foeTurnAs0, 'foe'), 'next-btn').length,
        '轮到对手时对手那一侧出现了 .next-btn（R11-3 的缺陷形态）').toBe(0);
      const foeTurnAs1 = renderFrame({ viewSeat: 1, turnPlayer: 1 });
      expect(withClass(infoBlockOf(foeTurnAs1, 'self'), 'next-btn').length,
        '同一个局面切到自己就是行动方的席位后仍没有 .next-btn —— 桩没造出"对手回合"（上一条是空断言）').toBe(1);
      // ② 局面 = chooser 1。viewSeat=0 ⇒ 两侧都没有选择条；切到 viewSeat=1 ⇒ 自己那一侧有一条。
      const choiceAs0 = renderFrame({ viewSeat: 0, turnPlayer: 0, chooser: 1 });
      expect(withClass(infoBlockOf(choiceAs0, 'self'), 'choice-bar').length,
        '对手应答时自己那一侧出现了 .choice-bar（R11-3 的缺陷形态）').toBe(0);
      expect(withClass(infoBlockOf(choiceAs0, 'foe'), 'choice-bar').length,
        '对手应答时对手那一侧出现了 .choice-bar（"对手那一侧只显示信息"）').toBe(0);
      const choiceAs1 = renderFrame({ viewSeat: 1, turnPlayer: 0, chooser: 1 });
      expect(withClass(infoBlockOf(choiceAs1, 'self'), 'choice-bar').length,
        '同一个局面切到自己就是应答方的席位后仍没有 .choice-bar —— 桩没造出"对手是 chooser"（上一条是空断言）').toBe(1);
    } finally {
      await drainRaf();
      restore();
    }
  });
});
