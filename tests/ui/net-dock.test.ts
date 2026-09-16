import { describe, it, expect, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createGame } from '../../src/core/state/create';
import { renderNetBoard, laneScrollDefault, verifyPageHooks } from '../../src/ui/render-net';
import { setFxViewSeat, FX_TRACK_EDGE_PCT_Y } from '../../src/ui/fx-seat';
import {
  assertNoUnmodelableCascade, cssLenOf, cssRules, cssVarOf, MODELED_PROPS, subjectPropOf, type CssRule,
} from './net-css-parse';
import { descendants, drainRaf, installStubDom, isClass, makeStubEl, walk, type StubNode } from './net-dom-stub';
import { stripComments } from './source-text';

/**
 * **G2 修正 R11-2/3 的守卫**（用户第四次验收；规格 §17 的 G-13 ~ G-16）——
 * "对手信息块搬进停靠栏 + 整行钉在屏幕底部 + 按钮只在轮到自己时出现在自己这一侧"落地后的机检腿：
 *
 * | 守卫 | 守什么 | 机制 |
 * | --- | --- | --- |
 * | **G-13** | **停靠栏**：容器恒为一个视口高、链路那一行是**内部滚动区**、停靠栏在它**下面** | 真跑 `renderNetBoard` + 从样式表解出 `height` / `grid-template-rows` / `overflow-y` / 行号 |
 * | **G-13b** | `--net-app-pad-y` 与 `styles.css` 的 `#app` 上下内边距**同源**（否则停靠栏下沿被推出屏幕） | 从 `styles.css` **解出**那两个数再比对（带反空集合） |
 * | **G-13c** | 对手手牌张数**压成单行小字**（且 `.hand` 占位节点保留足印） | 解算三条覆盖规则 + 反空集合（基类仍是完整长相） |
 * | **G-14** | **运行时自查**（约束 11）在真实页面上过；往对手那一侧塞按钮后**必报** | 真跑一帧 + 读 `.net-verify-note` + 直接调 `verifyPageHooks` |
 * | **G-15** | `.choice-mode` 挂在 **`.net-hands`** 上（R11-4 修的挂点） | 真跑一帧 + 源码腿（不许再用 `lastElementChild`） |
 * | **G-16** | 链路区滚动 ⇒ 持久 FX 层跟着重新定位（源码腿 + 诚实边界） | 源码形态腿（桩的 `addEventListener` 是 noop ⇒ 无行为腿） |
 *
 * ## 这个桩**能**证明什么 / **不能**证明什么（与前三个 net 测试文件同一口径）
 *
 * 能：元素树（顺序/归属/类名/dataset）、由真实样式表**层级解算**出的"哪条声明生效"、
 * 展平 `display: contents` 后的 grid item 与行/列号、以及 `verifyPageHooks` 的**真实执行结果**。
 * **不能**：真实布局（`100vh` / `calc(100vh − 122px)` 到底多高、滚动条占多宽、`scrollbar-gutter`
 * 的实际效果）、"停靠栏看起来是不是钉在屏幕底部"、"滚链路区时协议环跟不跟得上" ——
 * 那些只能由用户在 5173 上人眼确认（规格 §17.5 的人眼清单）。
 */

/* ============================================================================
 * 样式表与源码（与另外三个 net 文件**同一套**解析器；理由见 ./net-css-parse 头注）
 * ========================================================================== */

const read = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`../../src/ui/${name}`, import.meta.url)))
    .subarray(0, 4 * 1024 * 1024).toString('utf8');

const RULES = cssRules(read('styles-net.css'));
/** `styles.css`（**热座页**的样式表）：只用来解 `#app` 的内边距 —— 与 `--net-app-pad-y` 比对。 */
const HOT_RULES = cssRules(read('styles.css'));

/** 源码（去注释）：源码腿用。 */
const netSrc = (): string => stripComments(read('render-net.ts'));
const hotSrc = (): string => stripComments(read('render.ts'));

/** 造一个只带类名 / `data-*` 的桩节点（纯 CSS 解算用；不装 DOM、不渲染）。 */
function cssNode(...classes: string[]): StubNode {
  const n = makeStubEl('div');
  n.classList.add(...classes);
  return n;
}

/** 按**顶层**空白切分（括号内的空白不是分隔符）—— 与 `net-r9.test.ts` 的 `splitTopLevel` 同源。 */
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

/** `grid-template-rows/columns` 的声明值 → 轨道列表（只展开本页用到的 `repeat(n, …)`）。 */
function gridTracks(raw: string): string[] {
  const out: string[] = [];
  for (const token of splitTopLevel(raw)) {
    const m = /^repeat\(\s*(\d+)\s*,([\s\S]*)\)$/.exec(token);
    if (m === null) { out.push(token); continue; }
    const inner = splitTopLevel(m[2]);
    for (let i = 0; i < Number.parseInt(m[1], 10); i += 1) out.push(...inner);
  }
  return out;
}

/* ============================================================================
 * 真跑一帧（与另外三个文件**同源**；本文件多两个旋钮：选择请求 / verifyHooks）
 * ========================================================================== */

function renderFrame(o: {
  viewSeat: 0 | 1;
  turnPlayer?: 0 | 1;
  /** 挂一条合成的选择请求（`chooser` 是绝对号）—— G-15 的 `.choice-mode` 判据需要它 */
  chooser?: 0 | 1;
  /** `opts.onPreviewChange`（有工具条 ⇒ 自查结果写进 `.net-verify-note`）+ `verifyHooks` */
  preview?: boolean;
}): StubNode {
  const s = createGame({ seed: 'r11-dock', draftStarter: 0, firstToPlay: 1 });
  for (const p of [0, 1] as const) {
    s.players[p].protocols = [
      { defId: 'fire-0', compiled: false },
      { defId: 'ice-0', compiled: false },
      { defId: 'light-0', compiled: false },
    ] as never;
  }
  (s as { phase: string }).phase = 'turn';
  s.turnPlayer = o.turnPlayer ?? 0;
  if (o.chooser !== undefined) {
    s.pendingEffects.push({
      id: 'r11-choice',
      player: (1 - o.chooser) as 0 | 1,
      gen: 1,
      sourceUid: 'r11-src',
      sourceDefId: 'fire-0',
      prompt: {
        kind: 'select-action', title: 'R11 合成选择：请选择动作', min: 1, max: 1,
        optional: true, candidates: [], actions: ['action:flip'], chooser: o.chooser,
      },
      lastAnswer: null,
    } as never);
  }
  const root = makeStubEl('div');
  const noop = (): void => { /* noop */ };
  renderNetBoard(root as unknown as HTMLElement, s, {
    onAction: noop, onRendered: noop, rerender: noop, onDraftPick: noop, onDraftUnpick: noop,
    onDraftBan: noop, onWinReset: noop,
  } as never, {
    viewSeat: o.viewSeat,
    verifyHooks: o.preview === true,
    ...(o.preview === true ? { onPreviewChange: noop } : {}),
  });
  return root;
}

/** 渲染根（`.net-board`）。 */
const boardOf = (root: StubNode): StubNode => {
  const b = root.children.find((n) => isClass(n, 'net-board'));
  expect(b, 'root 下没有 .net-board（渲染器没挂 wrap？）').toBeTruthy();
  return b!;
};

/** 某一侧的信息块 / 某一侧的手牌区（**按元素树**取，不是按位置猜）。 */
const infoBlockOf = (root: StubNode, seat: 'self' | 'foe'): StubNode => {
  const found = descendants(root).filter((n) => isClass(n, 'net-info-block') && n.dataset.netSeat === seat);
  expect(found.length, `元素树里 ${seat} 侧的信息块不是恰好一块（实际 ${found.length} 块）`).toBe(1);
  return found[0];
};
const handAreaOf = (root: StubNode, side: 'self' | 'foe'): StubNode => {
  const found = descendants(root).filter((n) => isClass(n, `net-hand-area-${side}`));
  expect(found.length, `元素树里 ${side} 侧的手牌区不是恰好一块（实际 ${found.length} 块）`).toBe(1);
  return found[0];
};

/** 从 `root` 到 `target` 的祖先链（含 `target` 自己）；找不到就抛错。 */
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

afterEach(() => { setFxViewSeat(null); });

/* ============================================================================
 * G-13：停靠栏 = 一个视口高 + 链路区自己滚 + 停靠栏在它下面
 * ========================================================================== */

describe('R11-2 · G-13：停靠栏（一个视口高 · 链路区内部滚动 · 停靠栏在放牌区之下）', () => {
  it('G-13a. 容器恒为一个视口高：3 行（`1fr` + 两个 `auto`）、4 列；链路那一行是**内部滚动区**', async () => {
    const restore = installStubDom();
    try {
      for (const seat of [0, 1] as const) {
        const root = renderFrame({ viewSeat: seat });
        const board = boardOf(root);
        const grid = descendants(root).find((n) => isClass(n, 'net-grid'))!;
        expect(grid, `viewSeat=${seat}：找不到 .net-grid`).toBeTruthy();

        // ── ① 容器是 grid（行/列指派在 flex/block 下静默失效）──
        expect(subjectPropOf(board, [board], RULES, 'display'), '.net-board 不是 grid').toBe('grid');

        // ── ② **高度 = 100vh − `--net-app-pad-y`**（R11-2 的"钉在屏幕上"就靠它）──
        //    为什么不能是裸 `100vh`：`#app` 有 12+110 的内边距 ⇒ 文档会比视口高 122px
        //    ⇒ 停靠栏下沿被推出屏幕（正好压掉用户要的"固定在屏幕上"）。
        const h = subjectPropOf(board, [board], RULES, 'height');
        const padY = cssVarOf([board], RULES, '--net-app-pad-y');
        console.log(`\n===== G-13a · viewSeat=${seat} =====\n  height = ${String(h)}`
          + `\n  --net-app-pad-y = ${String(padY)}（解算 ${String(cssLenOf([board], RULES, padY ?? ''))}px）`);
        expect(h, '.net-board 没有 height —— 它就不是"恒为一个视口高"的容器，\n'
          + '停靠栏只能靠 fixed/sticky 才可能钉住，而两者都不满足"不遮链路放牌区"').toBeTruthy();
        expect(h!.replace(/\s+/g, ''), `height 必须写成 calc(100vh - var(--net-app-pad-y))`
          + `（实际 \`${String(h)}\`）—— 裸 100vh 会让停靠栏下沿落到屏幕外`).toBe('calc(100vh-var(--net-app-pad-y))');
        expect(padY, '`.net-board` 没有定义 --net-app-pad-y（高度基准的第二个乘数丢了）')
          .toBe('122px');
        expect(cssLenOf([board], RULES, padY!), '--net-app-pad-y 解不出像素值').toBe(122);

        // ── ③ 行模板：第 1 行 `1fr`（链路区吃掉剩余高度）、第 2/3 行 `auto`（日志行 + 停靠栏）──
        const rawRows = subjectPropOf(board, [board], RULES, 'grid-template-rows');
        expect(rawRows, '.net-board 没有 grid-template-rows（三行的高度关系失去定义）').toBeTruthy();
        const rows = gridTracks(rawRows!);
        console.log(`  grid-template-rows = ${rawRows} → ${rows.join(' | ')}`);
        expect(rows.length, `行模板必须恰好 3 条轨道（链路区 / 日志行 / 停靠栏），实际 ${rows.length} 条`)
          .toBe(3);
        expect(/fr\b/.test(rows[0]), `第 1 条轨道必须是**弹性**的（链路区吃掉剩余高度），实际 \`${rows[0]}\``)
          .toBe(true);
        for (const i of [1, 2]) {
          expect(rows[i].trim(), `第 ${i + 1} 条轨道必须是 \`auto\`（按内容高；写死高度会让停靠栏被裁）`)
            .toBe('auto');
        }
        // 列模板的**详细判据**在 net-r9 的 G-11c（4 条轨道 + 各自的内容/弹性族），这里只钉条数
        const rawCols = subjectPropOf(board, [board], RULES, 'grid-template-columns');
        expect(gridTracks(rawCols ?? '').length, `列模板必须 3 条轨道（自己 · 手牌 · 对手；R12-7 取消了留白轨道）`
      + `（实际 ${String(rawCols)}）`).toBe(3);

        // ── ④ 链路区 = **视口内的滚动区**，且在**第 1 行**、横跨整行 ──
        const gChain = ancestorsOf(root, grid);
        const gridRow = subjectPropOf(grid, gChain, RULES, 'grid-row');
        const overflowY = subjectPropOf(grid, gChain, RULES, 'overflow-y');
        const minH = subjectPropOf(grid, gChain, RULES, 'min-height');
        const alignC = subjectPropOf(grid, gChain, RULES, 'align-content');
        console.log(`  .net-grid：grid-row=${String(gridRow)} overflow-y=${String(overflowY)}`
          + ` min-height=${String(minH)} align-content=${String(alignC)}`);
        expect(gridRow, '链路区必须在**第 1 行**（停靠栏在它下面）').toBe('1');
        expect(subjectPropOf(grid, gChain, RULES, 'grid-column'), '链路区必须横跨整行').toBe('1 / -1');
        expect(overflowY, '链路区必须自己滚（`overflow-y: auto`）—— 这是"停靠栏永不遮挡放牌区"的机制；'
          + '写成 visible 时链路会**溢出到停靠栏下面**（放牌区被盖住）').toBe('auto');
        expect(minH, '链路区必须有 `min-height: 0` —— grid item 的 `min-height: auto` 会撑破'
          + '第 1 行的 `minmax(0, 1fr)`，把停靠栏顶出屏幕').toBe('0');
        expect(alignC, '链路区必须有 `align-content: start` —— 高屏时隐式行被拉伸会把列内六个层块撑开')
          .toBe('start');

        // ── ⑤ **停靠栏在链路区之下**（结构面：不是浮在它上面）──
        const dockRow = subjectPropOf(infoBlockOf(root, 'self'), ancestorsOf(root, infoBlockOf(root, 'self')),
          RULES, 'grid-row');
        expect(Number.parseInt(String(dockRow), 10),
          `停靠栏那一行（${String(dockRow)}）必须在链路区（第 1 行）**之下**`).toBeGreaterThan(1);
        // 反空集合：这一帧里**真的**有停靠栏四块（否则上面几条是空判据）
        const tree: string[] = [];
        walk(board, 0, tree, 2);
        expect(descendants(root).filter((n) => isClass(n, 'net-info-block')).length,
          '停靠栏里的信息块不是两块').toBe(2);
        expect(descendants(root).filter((n) => isClass(n, 'net-hand-area')).length,
          '停靠栏里的手牌区不是两块').toBe(2);
      }
    } finally {
      await drainRaf();
      restore();
    }
  });

  /**
   * **G-13b：`--net-app-pad-y` 与 `styles.css` 的 `#app` 上下内边距同源。**
   *
   * 这是本波唯一一处"**两处真相**"（那个变量在 `styles-net.css` 里写死 122px，而真值来自
   * `styles.css:18` 的 `padding: 12px 100px 110px`）。与其写一句注释祈祷别人记得同步，
   * 不如让守卫**自己去 styles.css 里解**那两个数再比对 —— 改了 `#app` 而忘改这里 ⇒ 立刻红，
   * 而且报出两个数。
   *
   * ⚠️ **反空集合**：先证明"真的解析到了 `styles.css` 的 `#app` 规则"，否则"比对通过"可能只是
   * 两个空值相等（本项目反复栽的空断言族）。
   */
  it('G-13b. `--net-app-pad-y` == `styles.css` 的 `#app` 上下内边距之和（从热座样式表解出来比对）', () => {
    const appRule = HOT_RULES.find((r) => r.selector.trim() === '#app');
    expect(appRule, '在 `styles.css` 里找不到 `#app` 的规则（选择器被改名？那这条守卫的前提就没了）')
      .toBeTruthy();
    const m = /(?:^|;|\s)padding\s*:\s*([^;]+)/.exec(appRule!.body);
    expect(m, '`#app` 的规则里找不到 `padding` 简写（上下内边距从哪来？）').toBeTruthy();
    const parts = m![1].trim().split(/\s+/).map((x) => Number.parseFloat(x));
    expect(parts.every((n) => Number.isFinite(n)),
      `\`#app\` 的 padding 里有解不出的值：\`${m![1]}\`（本守卫只支持 px 简写）`).toBe(true);
    // CSS 简写：1 值 = 四边；2 值 = 上下/左右；3 值 = 上/左右/下；4 值 = 上/右/下/左
    const top = parts[0];
    const bottom = parts.length === 1 ? parts[0] : parts.length === 2 ? parts[0] : parts[2];
    const want = `${top + bottom}px`;
    const board = cssNode('board', 'net-board');
    const got = cssVarOf([board], RULES, '--net-app-pad-y');
    console.log(`\n===== G-13b · 高度基准的同源比对 =====\n`
      + `  styles.css 的 #app padding = ${m![1]} ⇒ 上 ${top} + 下 ${bottom} = **${want}**\n`
      + `  styles-net.css 的 --net-app-pad-y = ${String(got)}`);
    expect(got, '`--net-app-pad-y` 与 `styles.css` 的 `#app` 上下内边距**不一致** —— '
      + `停靠栏会被推出屏幕（或提前离屏）。改 \`#app\` 的内边距时必须同时改 \`--net-app-pad-y\`（实测 ${want}）`)
      .toBe(want);
  });

  /**
   * **G-13c：对手手牌张数压成单行小字**（用户："对手的手牌张数压缩进对手信息块内"；
   * 已确认裁决 ②：压成单行小字、紧贴对手信息块，`.hand` 占位节点保留足印）。
   *
   * 三条覆盖规则（第 7 节）必须**都**在：
   *  ① `.net-hand-label`（"对手手牌 ×n"那一行标签）隐藏 —— 信息与下面那行小字重复；
   *  ② `.hand` 去掉整卡高与扇形内缩（还原成一行高）；
   *  ③ 占位块去掉虚线框与整卡高（改成一行淡底小字）。
   * ⚠️ **`.hand` 节点一个都不许隐藏**（隐藏后 `getBoundingClientRect()` 全 0 ⇒ 手牌落点特效整类塌掉）。
   */
  it('G-13c. 对手手牌张数压成单行小字（三条覆盖规则），且 `.hand` 占位节点保留足印', async () => {
    const restore = installStubDom();
    try {
      const root = renderFrame({ viewSeat: 0 });
      const board = boardOf(root);
      const foeArea = handAreaOf(root, 'foe');
      const selfArea = handAreaOf(root, 'self');
      // 反空集合：渲染器**真的**产出了那行标签（否则"隐藏它"这条规则没有对象）
      expect(descendants(foeArea).filter((n) => isClass(n, 'net-hand-label')).length,
        '对手手牌区里没有 .net-hand-label —— "隐藏标签"这条规则会退化成死声明').toBe(1);
      expect(descendants(selfArea).filter((n) => isClass(n, 'net-hand-label')).length,
        '自己那一侧不该有 .net-hand-label（它是对手那一块专属的说明行）').toBe(0);

      /** 在**给定的祖先链**下解一个后代节点的属性（真祖先链：`contents` 只改盒树、不改 DOM）。 */
      const declOf = (target: StubNode, prop: string): string | null =>
        subjectPropOf(target, ancestorsOf(root, target), RULES, prop);

      // ① 标签隐藏
      const label = descendants(foeArea).find((n) => isClass(n, 'net-hand-label'))!;
      expect(declOf(label, 'display'), '对手那一侧的"对手手牌 ×n"标签没有被隐藏 —— '
        + '它与占位块里那行小字重复，会把"压缩成一行"变成两行').toBe('none');
      // ② `.hand` 还原成一行高（去掉整卡高与扇形内缩）
      const foeHand = descendants(foeArea).find((n) => isClass(n, 'hand'))!;
      console.log(`\n===== G-13c · 对手手牌块的覆盖解算 =====`
        + `\n  .hand: min-height=${String(declOf(foeHand, 'min-height'))}`
        + ` padding-left=${String(declOf(foeHand, 'padding-left'))}`
        + `\n  占位块: min-height=${String(declOf(descendants(foeHand).find((n) => isClass(n, 'hand-count-placeholder'))!, 'min-height'))}`
        + ` border=${String(declOf(descendants(foeHand).find((n) => isClass(n, 'hand-count-placeholder'))!, 'border'))}`);
      expect(declOf(foeHand, 'min-height'), '对手手牌块仍占**一整张卡的高度** —— 停靠栏会被它撑高，'
        + '"压缩成单行小字"没有落地').toBe('0');
      for (const prop of ['padding-left', 'padding-right'] as const) {
        expect(declOf(foeHand, prop), `对手手牌块仍有扇形内缩（${prop}）—— 它是一行小字，不需要扇形留白`)
          .toBe('0');
      }
      // ③ 占位块压成一行
      const ph = descendants(foeHand).find((n) => isClass(n, 'hand-count-placeholder'))!;
      expect(declOf(ph, 'min-height'), '占位块仍是整卡高（min-height: var(--hand-card-h) 没被覆盖）').toBe('0');
      expect(declOf(ph, 'border'), `占位块的虚线卡框没被撤掉（实际 ${String(declOf(ph, 'border'))}）`)
        .toBe('none');
      // ── 反空集合（两侧都要）：基类必须仍是"一块手牌区的完整长相" ──
      const baseRule = RULES.find((r) => r.selector.trim() === '.net-hands .hand-count-placeholder');
      expect(baseRule, 'styles-net.css 里找不到 `.net-hands .hand-count-placeholder` 的**基类**规则')
        .toBeTruthy();
      expect(baseRule!.body, '占位块的基类被改掉了（R11-2 只允许**覆盖**，不许把基类改成一行小字 —— '
        + '将来若有第五种形态，它仍要有一块占位区默认长相）').toMatch(/min-height:\s*var\(--hand-card-h\)/);
      expect(baseRule!.body, '占位块的基类不再有虚线框').toMatch(/border:\s*1px\s+dashed/);
      // 足印：`.hand-count-only` 仍保留一张卡宽（`fxHandEndPoint` 的 x 落在同一条带上）
      const onlyRule = RULES.find((r) => r.selector.trim() === '.net-hands .hand-count-only');
      expect(onlyRule, '找不到 `.net-hands .hand-count-only` 的规则').toBeTruthy();
      expect(onlyRule!.body, '`.hand-count-only` 的 `min-width: var(--card-w)` 丢了 —— '
        + '对手手牌的**足印**没了，手牌落点特效会落到一个 0 宽的点上').toMatch(/min-width:\s*var\(--card-w\)/);
    } finally {
      await drainRaf();
      restore();
    }
  });

  it('G-19. R14-1/2：控制卡中心对齐 + 竖向两端内缩；"能否翻面查看"改按公开性（源码腿）', () => {
    const css = read('styles-net.css');
    // ① R14-1：控制卡（70px 高的图）在 158px 轨道里必须**中心**对齐坐标，两端内缩
    expect(css, '控制卡仍是 translate(-50%, -100%)（底边对齐 ⇒ 任何位置都整体偏上一个卡高 —— '
      + '用户第七次验收："控制权的那张卡片位置有点不太对，一直偏上"）')
      .toMatch(/\.net-board \.control-slider-img \{[^}]*translate\(-50%, -50%\)/);
    const rs = hotSrc();
    expect(rs, '竖向控制轨的两端没有内缩（4%/96% + 中心对齐 ⇒ 卡片上半/下半出轨道）')
      .toMatch(/const edge = vertical \? CONTROL_EDGE_PCT_Y : CONTROL_EDGE_PCT;/);
    // ⚠️ **判据修正（R14-5）**：旧句是 `toMatch(/const CONTROL_EDGE_PCT_Y = \d+;/)`。
    //    **旧句为什么必须改**：R14-1 之后 `CONTROL_EDGE_PCT_Y` 不再允许是**本文件的字面量** ——
    //    它必须从 `fx-seat.ts` 的 `FX_TRACK_EDGE_PCT_Y` 取，否则 FX 侧的竖向落点
    //    （`fxTrackEndFor`）就会与卡片实际停位错开 28.4px（R14-1 的回归本身）。
    //    旧句恰好只要求"写了个数字"，所以那条回归在它眼皮底下发生。**新句多查了什么**：
    //    ① 取值形态必须是"从 fx-seat 的常量取"；② 数值确实**等于** fx-seat 导出的那个数
    //    （两条腿：一条挡"写回字面量"、一条挡"取了别的常量"）。
    expect(rs, 'CONTROL_EDGE_PCT_Y 不再从 fx-seat 的竖向贴端常量取（卡片与特效会再差 ~28px）')
      .toMatch(/const CONTROL_EDGE_PCT_Y = FX_TRACK_EDGE_PCT_Y;/);
    expect(rs, 'render.ts 又把竖向贴端距离写回字面量了（单一出处被绕开）')
      .not.toMatch(/const CONTROL_EDGE_PCT_Y = \d+;/);
    expect(FX_TRACK_EDGE_PCT_Y, 'fx-seat 的竖向贴端常量必须是 22（卡片高 70px / 轨道 158px 的内缩值）')
      .toBe(22);
    // ② R14-2：翻面查看的判据必须**按信息是否公开**（正面卡永远可看背面），
    //    反面卡用 `isSelfSlot`（按座位）而**不是** `card.owner === s.turnPlayer`（按回合 ⇒ 远程页会在
    //    对手回合放开对手的反面卡）。
    const gate = /openZoom\(card\.defId, card\.faceUp, false, false,\s*\n?\s*card\.faceUp \|\| s\.phase === 'gameover' \|\| \(isSelfSlot && !card\.secret\)\)/.exec(rs);
    expect(gate, '翻面查看的判据没有改成"公开性 + isSelfSlot"（远程页仍会在对手回合放开对手的反面卡）')
      .toBeTruthy();
    expect(rs, '翻面查看的判据里仍有 `card.owner === s.turnPlayer`（按回合 ⇒ 用户报的 bug 形态）')
      .not.toMatch(/openZoom\(card\.defId, card\.faceUp, false, false,[^;]*card\.owner === s\.turnPlayer/);
    // ③ 远程页的槽交互权 = 「我这一侧 + 轮到我」为**必要条件**，并**额外**放行"这个槽是合法落点"
    //    ⚠️ **判据修正（R15-3）**：旧句是 `toMatch(/const canAct = isSelfSeat && myTurn;/)` ——
    //    **旧句为什么必须改**：R15 给 `canAct` 加了第二个放行项（腐化0 打对方场时对手槽也要可交互，
    //    否则点击落点与拖拽高亮两条路径都不可达），判据对象**确实变了**。
    //    **新句多查了什么**：① 必要条件 `(isSelfSeat && myTurn)` **仍在**（R14-2 的语义：
    //    对手回合时对手的槽不得可交互）；② 合法落点项 `selectedCanPlayHere` 必须与它**同一个 OR**；
    //    ③ 反空集合：不许退化成 `myTurn`（丢掉 isSelfSeat ⇒ 对手回合时对手槽又亮了）或恒 `true`。
    //    ⚠️ 这里钉的是**形态**；"合法落点确实把对手槽点亮 / 不合法时不点亮"由**行为腿**钉
    //    （`tests/ui/net-opp-slot-interactable.test.ts` 真跑 `renderNetBoard` 读 DOM 类名）——
    //    两条腿分工见该文件的头注，互不重复也不留空档。
    expect(netSrc(), '远程页的槽交互不再以"我这一侧 + 轮到我"为**必要条件**了（对手回合时对手槽会可交互）')
      .toMatch(/const canAct = \(isSelfSeat && myTurn\) \|\| selectedCanPlayHere;/);
    expect(netSrc(), 'canAct 退化成只看回合了（丢掉 isSelfSeat ⇒ 对手回合时对手的槽又变成可交互）')
      .not.toMatch(/const canAct = myTurn;/);
    expect(netSrc(), 'canAct 出现了"恒 true"的形态（所有槽无条件可交互）')
      .not.toMatch(/const canAct = true;/);
  });

  it('G-13d（前提腿）：styles-net.css 不得含 `!important` / ID / 内联覆盖（与既有三条腿同一份实现）', () => {
    expect(() => assertNoUnmodelableCascade(RULES, MODELED_PROPS)).not.toThrow();
  });

  /**
   * **G-18（R13-4 · 独立审计 A4）：常驻层同步清单必须与热座页对齐 —— 而且是**从源码生成**的要求。**
   *
   * 背景：热座页 `renderBoard` 末尾有一整批 `sync*`（每帧按 A 类钩子的实测矩形重定位 body 级
   * 持久层、条件消失时移除），而本页此前**只调了 3 条** ⇒ 19 类常驻特效在远程页**整类不出现**
   * （暗2 黑烟 / 能量扫描线 / 念能粒子 / 瘟疫浓雾 / 冷漠 / 金属 / 冰霜 / 多元 …）。
   *
   * ⚠️ **为什么是"生成"而不是手写清单**：手写清单必然漏项（G2 Task 4F 的 I-1 就是它 ——
   * 人工清单漏掉两件入口职责，body 级草稿面板残留整局）。所以这里**从 `render.ts` 的
   * `renderBoard` 尾部切出那一段**（锚点 = `syncCompiledFxLayers();` 到 `syncFollowers();`），
   * 提取其中出现的每一个 `sync*(` 名字，再逐条要求在 `render-net.ts` 里也出现。
   * 往热座页加一条新 sync 时，这条守卫会**立刻**要求远程页跟上。
   */
  it('G-18. R13-4：热座页 `renderBoard` 尾部的**每一条**常驻层同步，远程页也必须调用（源码生成）', () => {
    const board = hotSrc();
    const a = board.indexOf('syncCompiledFxLayers();');
    const b = board.indexOf('syncFollowers();');
    expect(a, '热座页找不到 syncCompiledFxLayers(); 锚点').toBeGreaterThanOrEqual(0);
    expect(b, '热座页找不到 syncFollowers(); 锚点').toBeGreaterThan(a);
    const tail = board.slice(a, b + 'syncFollowers();'.length);
    const names = [...new Set([...tail.matchAll(/\b(sync[A-Z][A-Za-z0-9]*)\(/g)].map((m) => m[1]))];
    console.log(`\n===== G-18 · 从 renderBoard 尾部提取到的常驻层同步（${names.length} 条）=====\n  ${names.join(', ')}`);
    // 反空集合：锚点之间必须真的有若干条（否则"生成的要求"是空的）
    expect(names.length, `锚点之间只提取到 ${names.length} 条 sync —— 锚点选错了（判据会空转）`)
      .toBeGreaterThanOrEqual(20);
    const net = netSrc();
    const missing = names.filter((n) => !new RegExp(`\\b${n}\\(`).test(net));
    expect(missing, `远程页没有调用这些常驻层同步函数 ⇒ 对应的一整类特效在远程页**完全不出现**：`
      + `${missing.join(', ')}\n（它们都是幂等的"按选择器定位 + 写矩形"，本页只需在入口职责段原样调用）`)
      .toEqual([]);
  });
});

/* ============================================================================
 * G-14：运行时自查（约束 11）—— 真实页面上过、注入按钮后必报
 * ========================================================================== */

describe('R11-3 · G-14：操作按钮只在轮到自己的那一侧（运行时自查的牙齿）', () => {
  it('G-14a. 真跑一帧（`verifyHooks` + 预览工具条）：自查必须跑起来，且**不报约束 11**', async () => {
    const restore = installStubDom();
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    /** `console.warn` 的**完整**失败清单（返回值只带 `fatal[0]`，见 `verifyPageHooks` 的说明）。 */
    const warned = (): string => (warn.mock.calls as unknown[][])
      .map((c) => c.map((x) => String(x)).join(' ')).join('\n');
    try {
      for (const seat of [0, 1] as const) {
        for (const turn of [0, 1] as const) {
          warn.mockClear();
          const root = renderFrame({ viewSeat: seat, turnPlayer: turn, preview: true });
          const note = descendants(root).find((n) => isClass(n, 'net-verify-note'));
          expect(note, `viewSeat=${seat}/turn=${turn}：没有 .net-verify-note（预览工具条没渲染？）`)
            .toBeTruthy();
          const text = String(note!.text);
          const all = `${text}\n${warned()}`;
          console.log(`\n===== G-14a · viewSeat=${seat} / turnPlayer=${turn} =====\n  自查行：${text}`);
          // ① **自查真的跑了**（不是空字符串 / 没被执行）
          expect(text, `viewSeat=${seat}/turn=${turn}：自查行是空的 —— 自查根本没跑`).toMatch(/^自查 /);
          // ② **约束 11 在正常页面上不误报**（这条是本腿的判据本体）
          //    ⚠️ **为什么不断言整份 `自查 ✓`**：本仓的 DOM 桩**不支持逗号选择器组**，而
          //    `NET_PAGE_HOOKS` 里有一条展示写法 `.trash-pile.p1/.p2`（探针是 `,` 组）⇒ 它在桩上
          //    恒报"数量 0，期望 2"，于是**整份自查在桩上必然 ✗**（与本波的改动无关）。
          //    判据取"**失败清单里没有约束 11**"：它恰好是本腿要证明的那件事，而且不受那条已知
          //    桩限制的干扰（`net-board-grid` 的 G-9a/G-9b 用**元素树**证明同一件事的另一半）。
          expect(all, `viewSeat=${seat}/turn=${turn}：正常页面（按钮在自己那一侧、且自己就是行动方）`
            + '被约束 11 判成违规 —— 那会让预览页常年显示一条假红').not.toContain('约束 11');
        }
      }
      // 反空集合：上面的"没有约束 11"不是因为自查压根没跑（`warned()` 非空 = 它真的报了别的项）
      expect(warned(), '自查在桩上一条失败都没报 —— 那"没有约束 11"就可能是空断言').toContain('.trash-pile');
      expect(info).toBeDefined();
    } finally {
      warn.mockRestore();
      info.mockRestore();
      await drainRaf();
      restore();
    }
  });

  it('G-14b. 往**对手那一侧**注入一个 `.next-btn` ⇒ 自查的失败清单里必出现约束 11', async () => {
    const restore = installStubDom();
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    /** `console.warn` 的**完整**失败清单（返回值只带 `fatal[0]`，而本桩的第一条永远是 `.trash-pile`）。 */
    const warned = (): string => (warn.mock.calls as unknown[][])
      .map((c) => c.map((x) => String(x)).join(' ')).join('\n');
    try {
      const root = renderFrame({ viewSeat: 0, turnPlayer: 0 });
      const wrap = boardOf(root);
      // ① 阳性对照：注入**之前**，失败清单里不得有约束 11
      warn.mockClear();
      verifyPageHooks(wrap as unknown as HTMLElement, 0, { turnPlayer: 0, operator: null });
      expect(warned(), '注入之前就报了约束 11（假红）').not.toContain('约束 11');
      // ② 注入（真实的形态：把对手的「下一步」画在对手那一块里 —— R8-8 曾经就是这样）
      const btn = makeStubEl('button');
      btn.classList.add('btn', 'next-btn');
      infoBlockOf(root, 'foe').appendChild(btn);
      warn.mockClear();
      verifyPageHooks(wrap as unknown as HTMLElement, 0, { turnPlayer: 0, operator: null });
      const out = warned();
      console.log(`\n===== G-14b · 注入对手侧按钮后的失败清单 =====\n${out}`);
      expect(out, '对手那一侧出现操作控件却没报 —— 用户点名的形态（"对手那一侧只显示信息"）'
        + '会静默回归，而页面上的表现是"我的屏幕上出现对手的操作面板"').toContain('约束 11');
      // ③ 反面：自己那一侧注入按钮、且**自己就是行动方** ⇒ 不得报（判据不是"有按钮就报"）
      const root2 = renderFrame({ viewSeat: 0, turnPlayer: 0 });
      const btn2 = makeStubEl('button');
      btn2.classList.add('btn', 'next-btn');
      infoBlockOf(root2, 'self').appendChild(btn2);
      warn.mockClear();
      verifyPageHooks(boardOf(root2) as unknown as HTMLElement, 0, { turnPlayer: 0, operator: null });
      expect(warned(), '自己就是行动方、按钮也在自己那一侧，却被判违规（假红）').not.toContain('约束 11');
    } finally {
      warn.mockRestore();
      info.mockRestore();
      await drainRaf();
      restore();
    }
  });

  it('G-14c（源码腿）：行动区挂 `isSelf && player === s.turnPlayer`；选择条只经 `mountIfMine` 挂出', () => {
    const src = netSrc();
    // ① 行动区的判据必须**同时**要求"是自己那一侧"与"轮到自己"
    expect(src, '行动区的判据里没有 `isSelf` —— 对手回合时按钮会重新出现在对手那一侧（R8-8 的形态）')
      .toMatch(/if\s*\(\s*isSelf\s*&&\s*player\s*===\s*s\.turnPlayer\s*\)/);
    // ② 三处选择条都必须走 `mountIfMine`（它里面才有 `who !== viewSeat` 的闸门）
    expect((src.match(/mountIfMine\(bar\);/g) ?? []).length,
      '选择条的挂载点没有全部走 `mountIfMine`（漏一处 = 那一分支的条会挂到对手那一侧）').toBe(3);
    expect(src, '`mountIfMine` 里没有"操作方就是自己"的闸门').toMatch(/if\s*\(\s*who\s*!==\s*viewSeat\s*\)\s*return;/);
    // ③ 反面：`mountChoiceBar` 只允许"定义 1 次 + 在 `mountIfMine` 里调用 1 次"
    //    （其它调用点会绕过闸门；用带分号的调用形态计数，免得把函数定义也数进去）
    expect((src.match(/mountChoiceBar\(wrap,\s*who,\s*bar\);/g) ?? []).length,
      '`mountChoiceBar(wrap, who, bar);` 的调用点不是恰好一处（它只应在 `mountIfMine` 里被调用 ——'
      + '其余调用点都要经闸门）').toBe(1);
  });
});

/* ============================================================================
 * G-15：`.choice-mode` 的挂点（R11-4 修的潜在缺陷）
 * ========================================================================== */

describe('R11-4 · G-15：`.choice-mode` 挂在 `.net-hands` 上（选择模式下非候选手牌不可点的唯一出处）', () => {
  it('G-15a. 真跑一帧（有挂起选择）：`.net-hands` 带 `.choice-mode`，两块信息块都不带', async () => {
    const restore = installStubDom();
    try {
      for (const seat of [0, 1] as const) {
        for (const chooser of [0, 1] as const) {
          const root = renderFrame({ viewSeat: seat, turnPlayer: 0, chooser });
          const handsRoot = descendants(root).find((n) => isClass(n, 'net-hands'))!;
          const cls = (n: StubNode): string => n.cls;
          console.log(`\n===== G-15a · viewSeat=${seat} / chooser=${chooser} =====`
            + `\n  .net-hands: ${cls(handsRoot)}`
            + `\n  信息块: self=[${cls(infoBlockOf(root, 'self'))}] foe=[${cls(infoBlockOf(root, 'foe'))}]`);
          expect(isClass(handsRoot, 'choice-mode'), '`.net-hands` 没有 `.choice-mode` —— '
            + '选择模式下"非候选手牌不可点"（`.net-hands.choice-mode .card:not(.choice-target)` 与 '
            + '`styles.css:1786` 的 `.hand-strip.choice-mode …`）两条规则会**同时失效**').toBe(true);
          for (const side of ['self', 'foe'] as const) {
            expect(isClass(infoBlockOf(root, side), 'choice-mode'),
              `${side} 侧的信息块被加上了 .choice-mode —— 说明挂点又退回了 \`lastElementChild\`（R11-4 的原始缺陷：`
              + 'DOM 顺序是 [自己信息块, 手牌区, 对手信息块]，最后一个是**对手信息块**）').toBe(false);
          }
        }
      }
    } finally {
      await drainRaf();
      restore();
    }
  });

  it('G-15b（源码腿）：不许再用 `lastElementChild` 取手牌区；`buildBottomRow` 直接交回 `hands`', () => {
    const src = netSrc();
    expect(src, 'render-net.ts 里又出现了 `lastElementChild` —— 那个取法拿到的**不是** `.net-hands`'
      + '（`NET_BOTTOM_SIDES` 是 [\'self\', \'foe\'] ⇒ DOM 顺序 `[自己信息块, 手牌区, 对手信息块]`）')
      .not.toContain('lastElementChild');
    expect(src, '`buildBottomRow` 没有把 `.net-hands` 节点交回来（R11-4 的修法）')
      .toMatch(/\):\s*\{\s*row:\s*HTMLElement;\s*hands:\s*HTMLElement\s*\}/);
    expect(src, '`renderNetBoard` 没有从 `buildBottomRow` 解构出 `hands`')
      .toMatch(/const\s*\{\s*row:\s*bottom,\s*hands\s*\}\s*=\s*buildBottomRow\(/);
  });
});

/* ============================================================================
 * G-16：链路区内部滚动 ⇒ 持久 FX 层跟着重新定位
 * ========================================================================== */

describe('R11-2 · G-16：滚动跟随（持久 FX 层不随滚动移动，必须自己重定位）', () => {
  it('G-16a（源码腿）：注册了捕获阶段的 scroll 监听，回调里同步编译层与锁链层', () => {
    const src = netSrc();
    expect(src, '`bindNetScrollSync` 没有被调用（链路区滚动时协议环/锁链会停在旧屏幕坐标上）')
      .toContain('bindNetScrollSync();');
    const fn = /function bindNetScrollSync\(\)[\s\S]*?\n\}/.exec(src);
    expect(fn, '找不到 `bindNetScrollSync` 的函数体').toBeTruthy();
    const body = fn![0];
    console.log(`\n===== G-16a · bindNetScrollSync 的函数体 =====\n${body}`);
    // ① 一次性绑定（模块级 flag）—— 否则每帧重渲染都会再挂一个监听
    expect(body, '绑定没有一次性闸门（每帧重渲染都会再挂一个 scroll 监听 ⇒ 回调次数线性增长）')
      .toMatch(/if\s*\(\s*netScrollSyncBound\s*\)\s*return;/);
    // ② 捕获阶段（`scroll` 不冒泡：只有捕获才能收**任何**滚动容器的事件）
    expect(body, 'scroll 监听必须是**捕获**阶段（`scroll` 不冒泡；不捕获就收不到内部滚动区的事件）')
      .toMatch(/addEventListener\(\s*'scroll'[\s\S]*?,\s*true\s*\)/);
    // ③ 回调真的重新定位两类持久层
    expect(body, '滚动回调没有同步已编译协议层（`syncCompiledFxLayers`）').toContain('syncCompiledFxLayers()');
    expect(body, '滚动回调没有同步锁链层（`syncChainLayerPosition`）').toContain('syncChainLayerPosition()');
    // ④ 双保险：只有本页在屏上时才动手
    expect(body, "滚动回调没有 '页面上有没有 .net-board' 的确认").toContain("querySelector('.net-board')");
  });

  it('G-16b（源码腿 · 热座红线）：热座页源码不出现本页的滚动绑定（构造性零变化）', () => {
    const src = hotSrc();
    expect(src, '`render.ts`（热座页）里出现了 `bindNetScrollSync` —— 热座页没有内部滚动区，'
      + '这条绑定必须只属于远程页').not.toContain('bindNetScrollSync');
    expect(src, '`render.ts` 里出现了本页的滚动记账变量（`netScrollSync`）').not.toContain('netScrollSync');
  });
});

/* ============================================================================
 * G-17：用户第五次验收的五条布局诉求（R12-1 ~ R12-5）
 *
 * 原始诉求（逐字见规格 §18.0）：
 *  ① "取消日志的显示"           → R12-1（配 net-lane-tree R7-1 / net-r9 G-12c 的行为腿）
 *  ② "不要使用这种丑陋的滑块"    → R12-2（隐藏滚动条，**但保留滚动能力**）
 *  ③ "缩小图二中的这三个组件"    → R12-3（停靠栏三块的盒/字/间距）
 *  ④ "加大双方场上区域的大小"    → R12-4（把 ①②③ 省下来的高度全给第 1 行）
 *  ⑤ "默认位置定为双方协议的交锋点" → R12-5（`restoreLaneScroll` + `laneScrollDefault`）
 * ========================================================================== */

describe('R12 · G-17：日志 / 滚动条 / 停靠栏紧凑 / 放牌区预算 / 默认停在交锋点', () => {
  it('G-17a. R12-2：链路区**不显示滚动条**，但**仍然能滚**（`overflow-y: auto` 未动）', () => {
    const grid = cssNode('net-grid');
    const chain = [cssNode('board', 'net-board'), grid];
    const raw = subjectPropOf(grid, chain, RULES, 'scrollbar-width');
    const over = subjectPropOf(grid, chain, RULES, 'overflow-y');
    const gutter = subjectPropOf(grid, chain, RULES, 'scrollbar-gutter');
    console.log(`\n===== G-17a · 链路滚动区的滚动条声明 =====\n`
      + `  scrollbar-width = ${String(raw)} / overflow-y = ${String(over)}`
      + ` / scrollbar-gutter = ${String(gutter)}`);
    // ① 隐藏（用户："不要使用这种丑陋的滑块"；实机截图里的滚动条带上下箭头 = Firefox 经典样式）
    expect(raw, '链路区没有隐藏滚动条（`scrollbar-width: none`）—— 用户点名的那个"丑陋的滑块"')
      .toBe('none');
    // ② **但滚动能力必须在**（隐藏滚动条 ≠ 不滚；R11-2 的裁决 A 全靠它）
    expect(over, '链路区不再自己滚了 —— 隐藏滚动条时**不许**顺手把 overflow-y 一起改掉'
      + '（那会让链路溢出到停靠栏下面 = 放牌区被盖）').toBe('auto');
    // ③ 旧版 WebKit 忽略 `scrollbar-width` 时的兜底：两侧对称的滚动条槽（三列仍居中）
    expect(gutter, '`scrollbar-gutter: stable both-edges` 被删了 —— 旧版 WebKit 上滚动条会只占右侧'
      + '（内容盒窄 15px ⇒ 三列左移 7.5px，G-11 的归中几何在现实里不再成立）')
      .toBe('stable both-edges');
  });

  it('G-17b. R12-1：事件日志**不再渲染**（元素树腿）+ 样式表里也没有它的行号规则', async () => {
    const restore = installStubDom();
    try {
      for (const seat of [0, 1] as const) {
        const root = renderFrame({ viewSeat: seat });
        const board = boardOf(root);
        console.log(`\n===== G-17b · viewSeat=${seat} · .net-board 直接子节点 =====\n`
          + `  ${board.children.map((n) => n.cls).join(' | ')}`);
        expect(descendants(root).filter((n) => isClass(n, 'log')).length,
          `viewSeat=${seat}：事件日志块（.log）又被渲染出来了 —— R12-1 取消了它的显示`
          + '（那 72px 归放牌区；"看日志"由导出按钮承担，诊断文本里含完整事件日志）').toBe(0);
        // 反空集合：导出按钮**必须还在**（它是"看日志"的唯一去处）
        expect(descendants(root).filter((n) => isClass(n, 'diag-btn')).length,
          `viewSeat=${seat}：导出日志按钮没了 —— 日志块取消之后它是唯一能拿到日志的入口`).toBe(1);
      }
      // 样式表里也不许留下它的行号规则（否则"日志还在"这件事在 CSS 里留着证据）
      const logRules = RULES.filter((r) => /(?:^|\s|>)\.log\b/.test(r.selector));
      expect(logRules.map((r) => r.selector), 'styles-net.css 里仍有 `.log` 的规则（R12-1 已取消日志）')
        .toEqual([]);
      // ⚠️ 导出按钮**没有** grid-row 规则是**正确**的（它在 styles.css 里是 position: fixed，
      //    不参与 grid 布局、落在 #app 的底部内边距里）；旧代码给它写的 `grid-row: 2` 是死声明。
      const diagRules = RULES.filter((r) => /\.diag-btn/.test(r.selector));
      expect(diagRules.filter((r) => /grid-row\s*:/.test(r.body)).map((r) => r.selector),
        'styles-net.css 又给 `.diag-btn` 写了 grid-row —— 它是 fixed 元素，那是**死声明**'
        + '（看着像在排版，其实不参与 grid 布局）').toEqual([]);
    } finally {
      await drainRaf();
      restore();
    }
  });

  it('G-17c. R12-3：停靠栏三块**紧凑化**（牌库/弃牌堆 46×66 · 徽标 26 · 信息块 4/3 · 板间距 2）', () => {
    const board = cssNode('board', 'net-board');
    const p = (node: StubNode, prop: string): string | null =>
      subjectPropOf(node, [board, node], RULES, prop);
    // 牌库 / 弃牌堆：60×86 → 46×66（解算成像素，不认写法）
    for (const [cls, tag] of [['deck', '牌库'], ['trash-pile', '弃牌堆']] as const) {
      const node = cssNode('net-piles', 'net-piles');
      const pile = cssNode(cls, `${cls} p1`);
      pile.dataset.player = '1';      // 规则的判据是 `.net-piles .<cls>[data-player]`（属性选择器）
      const chain = [board, node, pile];
      const w = cssLenOf(chain, RULES, subjectPropOf(pile, chain, RULES, 'width') ?? '');
      const h = cssLenOf(chain, RULES, subjectPropOf(pile, chain, RULES, 'height') ?? '');
      console.log(`\n===== G-17c · ${tag} =====\n  ${String(w)} × ${String(h)}px`);
      expect(w, `${tag}的宽不是 40px（R12-3/R12-8 的紧凑化没生效）`).toBe(40);
      expect(h, `${tag}的高不是 58px（R12-3/R12-8 的紧凑化没生效）`).toBe(58);
    }
    // 计数徽标（styles.css 是 34×34，在 46px 宽的盒子里已占满）
    const badge = cssNode('deck-count');
    const badgeChain = [board, cssNode('net-piles'), cssNode('deck'), badge];
    expect(cssLenOf(badgeChain, RULES, subjectPropOf(badge, badgeChain, RULES, 'width') ?? ''),
      '牌库计数徽标没跟着缩小（40px 的盒子里放 34px 的徽标会顶满）').toBe(22);
    // 信息块的内边距/间距
    const block = cssNode('net-info-block');
    block.dataset.netSeat = 'self';
    expect(cssLenOf([board, block], RULES, subjectPropOf(block, [board, block], RULES, 'gap') ?? ''),
      '信息块的行间距没收到 2px').toBe(2);
    // 板间距（同时管行距与列距）
    expect(cssLenOf([board], RULES, subjectPropOf(board, [board], RULES, 'gap') ?? ''),
      '板间距没收到 2px').toBe(2);
    // 字号：标题 12 / 连接状态 11 / 弃牌堆小标签 8
    expect(subjectPropOf(block, [board, block], RULES, 'padding')).toBe('3px 5px');
    expect(p(cssNode('net-hand-area'), 'justify-self'), '手牌区的水平中置没变（R12-3 只动尺寸/间距）')
      .toBe('center');
    for (const [sel, want, what] of [
      ['net-info-block .area-title', '11px', '信息块标题'],
      ['net-conn', '10px', '连接状态'],
      ['net-piles .trash-label', '8px', '弃牌堆小标签'],
    ] as const) {
      const rule = RULES.find((r) => r.selector.trim() === `.${sel}`);
      expect(rule, `找不到 \`.${sel}\` 的规则`).toBeTruthy();
      expect(rule!.body, `${what}的字号不是 ${want}（R12-3 的紧凑化没生效）`)
        .toMatch(new RegExp(`font-size:\\s*${want}`));
    }
  });

  it('G-17d. R12-4：放牌区的"预算"——三处吃高度的东西都已缩/去（真正的观感是人眼项）', () => {
    // ① 日志块整条去掉（它的 72px 直接回到第 1 行）—— 行号规则也不许留
    expect(RULES.filter((r) => /(?:^|\s|>)\.log\b/.test(r.selector)).length,
      'styles-net.css 里还有 `.log` 的规则（R12-1 取消了日志显示）').toBe(0);
    // ② 停靠栏里最高的那块（牌库/弃牌堆）从 86 降到 66（-20px）—— 由 G-17c 逐项钉住
    // ③ 板间距 4 → 2（四行 × 2px 的间距都收了一半）
    const board = cssNode('board', 'net-board');
    expect(cssLenOf([board], RULES, subjectPropOf(board, [board], RULES, 'gap') ?? ''))
      .toBe(2);
    // ④ 第 1 行仍是**弹性**的（省下来的高度必须真的落在它身上，而不是被别的行吃掉）
    const rows = gridTracks(subjectPropOf(board, [board], RULES, 'grid-template-rows') ?? '');
    expect(/fr\b/.test(rows[0]), '第 1 行不是弹性的 —— 省下来的高度不会给放牌区').toBe(true);
    console.log('\n===== G-17d · 放牌区的预算（R12-4）=====\n'
      + '  日志行：整条去掉（-72px，R12-1）\n'
      + '  停靠栏：牌库/弃牌堆 86 → 66（-20px，R12-3）· 信息块 gap/padding 收紧\n'
      + '  板间距：4 → 2（R12-3）\n'
      + '  ⇒ 全部落在第 1 行（`minmax(0, 1fr)`）。⚠️ 真实高度只能人眼（规格 §18.5）');
  });

  it('G-17e. R12-5：默认停在**交锋点**（中线）—— 归中算术逐条验算 + 桩上不写 NaN', async () => {
    // ── ① 纯算术（`laneScrollDefault`）：未夹住时"中线中心 == 可视区中心" ──
    const cases: ReadonlyArray<[number, number, number, number]> = [
      // [中线在内容里的 top, 中线高, 可视区高, 内容可滚的最大量]
      [580, 20, 400, 700],
      [300, 40, 500, 900],
      [1000, 16, 300, 1200],
    ];
    for (const [midTop, midH, clientH, max] of cases) {
      const got = laneScrollDefault(midTop, midH, clientH, max);
      console.log(`\n===== G-17e · 中线 top=${midTop} 高=${midH} 可视=${clientH} max=${max} ⇒ scrollTop=${got}`);
      expect(got, `[${midTop}/${midH}/${clientH}] 解出的 scrollTop 夹出了 [0, ${max}]`)
        .toBeGreaterThanOrEqual(0);
      expect(got).toBeLessThanOrEqual(max);
      // 中线中心 vs 可视区中心（未夹住时必须相等；夹住时必然偏，故只对未夹住的情形断言）
      const want = midTop - (clientH - midH) / 2;
      if (want > 0 && want < max) {
        expect(got, '未夹住时没有把中线放到正中').toBeCloseTo(want, 6);
        expect(got + clientH / 2, '中线中心 != 可视区中心')
          .toBeCloseTo(midTop + midH / 2, 6);
      }
    }
    // ② 夹住：靠近内容两端时不许滚出内容（否则会露出空白）
    expect(laneScrollDefault(10, 20, 400, 700), '内容顶端附近没有夹到 0').toBe(0);
    expect(laneScrollDefault(1200, 20, 400, 700), '内容底端附近没有夹到 max').toBe(700);
    // ③ 桩环境（量不到布局）不写 NaN、也不动 scrollTop
    const restore = installStubDom();
    try {
      const root = renderFrame({ viewSeat: 0 });
      const grid = descendants(root).find((n) => isClass(n, 'net-grid'))!;
      const st = grid as unknown as { scrollTop?: number };
      console.log(`  桩上 .net-grid.scrollTop = ${String(st.scrollTop)}（应为 undefined：量不到布局就直接退出）`);
      expect(st.scrollTop, '桩环境（没有 scrollHeight/clientHeight）下写了 scrollTop —— '
        + '那会把 NaN 记进模块态，下一页真人打开时会跳到一个非法位置')
        .toBeUndefined();
      // 源码腿：调用必须落在"棋盘入 DOM 之后、deferredFx 之前"
      const src = netSrc();
      const iMount = src.indexOf('root.appendChild(wrap);');
      const iScroll = src.indexOf('restoreLaneScroll(grid);');
      const iFx = src.indexOf('for (const fn of deferredFx) fn();');
      expect(iMount, '找不到 root.appendChild(wrap)').toBeGreaterThanOrEqual(0);
      expect(iScroll, '`restoreLaneScroll(grid)` 没有被调用（默认位置永远是对方链路顶部）')
        .toBeGreaterThan(iMount);
      expect(iScroll, '滚动发生在 deferredFx **之后** —— 那批几何型 FX 会按"没滚过"的坐标落点')
        .toBeLessThan(iFx);
    } finally {
      await drainRaf();
      restore();
    }
  });
});
