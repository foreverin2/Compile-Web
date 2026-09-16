import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createGame } from '../../src/core/state/create';
import { renderNetBoard } from '../../src/ui/render-net';
import { setFxViewSeat } from '../../src/ui/fx-seat';
import {
  assertNoUnmodelableCascade, cssLenOf, cssPropOf, cssRules, cssVarOf,
  MODELED_PROPS, subjectPropOf, type CssRule,
} from './net-css-parse';
import { descendants, drainRaf, installStubDom, isClass, makeStubEl, walk, type StubNode } from './net-dom-stub';

/**
 * **G2 修正 R9-1 / R9-2 / R9-3 的守卫**（规格
 * `docs/2026-09-15-G2修正R8-能量槽外移与协议特效跟随.md` §13.7 的 **G-10 / G-11 / G-12**）
 * —— 用户第三次验收反馈的三项落地后的机检腿：
 *
 * | 守卫 | 守什么 | 机制 | 变异（实测见报告） |
 * | --- | --- | --- | --- |
 * | **G-10** | 整条链路等比缩放**由一个数（`--card-h`）驱动** | 解算 `--card-h` / `.stack` 的 `min-height` / 协议 holder 的宽高；**源码腿**：holder 的值必须由 `var(--card-h)` 推出、不得再出现第二组独立字面量 | `--card-h` 改回 182 ⇒ 必红 |
 * | **G-11** | 三列在页面上**精确居中**（控制轨不再把三列挤偏） | 把三条轨道宽 + `padding-left` + `--net-rail-w` 代入，算三列的水平中心 == 网格盒中心 | 删 `padding-left` ⇒ 必红（左偏 80px） |
 * | **G-12** | 手牌并进信息盒（**同一行、同一个盒子**） | 桩上真跑 `renderNetBoard`（**两个席位**）：同一 `grid-row` 里既有该侧 `.net-info-block`、又有该侧 `.net-hand-area`；手牌横跨到右边界 | 行号改回"各自一行" ⇒ 必红 |
 *
 * ## 为什么这三条必须新开一个文件（而不是塞进既有文件）
 *
 * 它们守的是**同一个用户诉求的三个面**（"等比缩 + 别偏 + 别变长"），一起看才读得懂；
 * 而既有文件的名字（`net-lane-tree` = 列内层序 / `net-board-grid` = 行序）都不覆盖 R9 的主题。
 * **判据本体没有另起炉灶**：解析器（`./net-css-parse`，含 R9-1 上提的 CSS 长度解算器）、
 * DOM 桩（`./net-dom-stub`）、以及"真跑一帧"的形态都与既有文件**同源**（下述 `renderFrame`
 * 是从 `net-board-grid.test.ts` 搬过来的**逐字拷贝**，见那里的说明；两处若漂移，
 * 表现就是"一个文件绿、另一个红"—— 所以它只保留**这一个额外的**拷贝，不再复制第三份）。
 *
 * ## 这个桩**能**证明什么 / **不能**证明什么（诚实边界，与既有两个文件同一口径）
 *
 * 能：元素树（顺序/归属/类名/dataset）、由真实样式表**层级解算**出的"哪条声明生效"、
 * 展平 `display: contents` 后的 grid item 列表与 `grid-row`/`grid-column`、
 * 以及"把轨道宽与内边距代入后三列是否居中"这一类**确定性的算术**。
 * **不能**：真实布局（行高、gap、像素）、`fit-content` / `max-content` 在浏览器里的最终取值、
 * 缩放后到底好不好看 —— 那些只能人眼（§13.8 的人眼项）。
 */

/* ============================================================================
 * 样式表（与既有两个文件**同一套**解析器；理由见 ./net-css-parse 头注）
 * ========================================================================== */

const cssPath = new URL('../../src/ui/styles-net.css', import.meta.url);
const netCss = readFileSync(fileURLToPath(cssPath)).subarray(0, 4 * 1024 * 1024).toString('utf8');
const RULES = cssRules(netCss);

/** 造一个只带类名 / `data-*` 的桩节点（纯 CSS 解算用；不装 DOM、不渲染）。 */
function cssNode(...classes: string[]): StubNode {
  const n = makeStubEl('div');
  n.classList.add(...classes);
  return n;
}

/** 一条规则是否把 `node` 当作**选择器主体**命中 —— **R11-2 起用共享实现**（见
 *  `./net-css-parse` 的 `subjectPropOf` 头注：这类判据原先在两个文件里各有一份拷贝）。 */
/* `subjectPropOf` 现从 `./net-css-parse` 导入（语义一字未改：只认"把被查节点当**选择器主体**"
   的规则 —— `cssPropOf` 允许主体绑到链上的任意祖先，会把 `.net-board` 的 `grid-template-columns`
   当成手牌区的 `grid-column`，假红/假绿都会出现）。 */

/* ============================================================================
 * 真跑一帧（与 `net-board-grid.test.ts` 的 `renderFrame` **同源**）
 * ========================================================================== */

const frameOpts = { viewSeat: 0 as 0 | 1, turnPlayer: 0 as 0 | 1 };

function renderFrame(o: { viewSeat: 0 | 1; turnPlayer: 0 | 1 }): StubNode {
  const s = createGame({ seed: 'r9-net-guards', draftStarter: 0, firstToPlay: 1 });
  for (const p of [0, 1] as const) {
    s.players[p].protocols = [
      { defId: 'fire-0', compiled: false },
      { defId: 'ice-0', compiled: false },
      { defId: 'light-0', compiled: false },
    ] as never;
  }
  (s as { phase: string }).phase = 'turn';
  s.turnPlayer = o.turnPlayer;
  const root = makeStubEl('div');
  const noop = (): void => { /* noop */ };
  renderNetBoard(root as unknown as HTMLElement, s, {
    onAction: noop, onRendered: noop, rerender: noop, onDraftPick: noop, onDraftUnpick: noop,
    onDraftBan: noop, onWinReset: noop,
  } as never, { viewSeat: o.viewSeat, verifyHooks: false });
  return root;
}

afterEach(() => { setFxViewSeat(null); });

/** 该节点在 `chain` 下的 `grid-row` / `grid-column` 解算值（`subjectPropOf`，缺省值见调用方）。 */
const propOf = (node: StubNode, chain: StubNode[], prop: string): string | null =>
  subjectPropOf(node, chain, RULES, prop);

/** `chain` 上第一个带某个类名的节点（**断链即抛错** —— 不返回 undefined 让断言在空值上假绿）。 */
function findIn(n: StubNode, cls: string): StubNode {
  const hit = descendants(n).find((x) => isClass(x, cls));
  if (!hit) throw new Error(`元素树里找不到 .${cls}（结构被改动？）`);
  return hit;
}

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

/** 按**顶层**空白切分（括号内的空白不是分隔符）：
 *  `repeat(3, minmax(0, 1fr)) var(--net-rail-w)` → `['repeat(3, minmax(0, 1fr))', 'var(--net-rail-w)']`。
 *  ⚠️ **不能用 `/\s+(?![^(]*\))/` 那种正则**：它按"下一个 `)` 之前有没有 `(`"判断，`minmax(0, 1fr)`
 *  这种**逗号+空格**在括号内的形态会被切错（G-11/G-12 两处都吃过这个亏）。 */
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

/** `grid-template-columns` 的声明值 → 轨道列表（只展开本页用到的 `repeat(n, …)`）。 */
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
 * G-10：整条链路等比缩放 —— **一个数（`--card-h`）驱动全部**
 * ========================================================================== */

describe('R9-1 · G-10：等比缩放由一个数驱动', () => {
  /** `.net-lane-band` 链（`--card-h` / `--card-w` 定义在这里，G-3 已确认它们在同一节点上）。 */
  const band = (): StubNode => cssNode('net-lane-band');
  /** `.net-lane-band .stack` 链（`min-height` 在这一条上）。 */
  const stackChain = (): StubNode[] => [band(), cssNode('stack')];
  /** `.net-lane-band .protocol-holder` 链（协议静态盒）。 */
  const holderChain = (): StubNode[] =>
    [cssNode('board', 'net-board'), band(), cssNode('protocol-cell'), cssNode('protocol-holder')];

  /** 源码腿用：**按选择器主体**取该节点的某个属性声明原文（未经级联，直接读规则体）。 */
  function declOf(clsPath: string[], prop: string): string {
    const rule = RULES.find((r) => r.selector.trim() === clsPath.join(' '));
    expect(rule, `styles-net.css 里找不到规则 \`${clsPath.join(' ')}\``).toBeTruthy();
    const m = new RegExp(`(?:^|;|\\s)${prop}\\s*:\\s*([^;]+)`).exec(rule!.body);
    expect(m, `规则 \`${clsPath.join(' ')}\` 里没有 \`${prop}\``).toBeTruthy();
    return m![1].trim();
  }

  /**
   * **"没有第二组独立字面量"的判据本体**：把表达式里的 `px` / `%` 结尾的绝对长度挑出来。
   * （`var(--card-h)` / `calc` / `*` / 无单位系数都不匹配；`em` / `rem` 是**相对**长度，
   * 不构成"另一组绝对尺寸"，故按口径**不算**违规 —— 这一点写在断言消息里。）
   */
  const absoluteLens = (decl: string): string[] =>
    decl.match(/(?<![\w.-])\d+(?:\.\d+)?(?:px|%)/g) ?? [];

  it('G-10a. `--card-h === 130px`（R19 的左栏压缩档），且卡宽 / 步距 / 竖排重叠 / 7 张跨度**全部**由它推出（解算值 ≈ 93.43 / 43.2 / −86.8 / 389.0）', () => {
    const chain = stackChain();
    const rawH = cssVarOf([cssNode('board', 'net-board'), band()], RULES, '--card-h');
    console.log(`\n===== G-10a · styles-net.css 真实解算（R9-1 / R19）=====\n  --card-h = ${String(rawH)}`);
    // ⚠️ **数值迁移（R19）**：140 → 130。**旧句为什么必须改**：R19 把三块组件搬进左栏、
    //    整体压缩一档（用户："平移挪到左边区域……能够完整漏出中间放置卡牌的区域"），
    //    而 `--card-h` 是**唯一旋钮** ⇒ 旧数值 140 不再成立。
    //    **新句多查了什么**：下面每一条派生量仍然**逐项复算**（不是抄一个期望数），
    //    并把"7 张跨度 ≤ 一屏可用高"这条**新意图**也钉进来（见 ③）——
    //    旧用例只钉"由它推出"，没有钉"推出后真的放得进"。
    expect(rawH, 'styles-net.css 里 `.net-lane-band` 没有 --card-h（唯一旋钮丢了 ⇒ 整条链路无从推导）')
      .toBe('130px');

    const cardH = cssLenOf([cssNode('board', 'net-board'), band()], RULES, rawH!);
    const cardW = cssLenOf([cssNode('board', 'net-board'), band()], RULES, cssVarOf([cssNode('board', 'net-board'), band()], RULES, '--card-w') ?? '');
    expect(cardH, '--card-h 解不出像素值').toBe(130);
    expect(cardW, `--card-w 未由 --card-h 推出（源文：${String(cssVarOf([cssNode('board', 'net-board'), band()], RULES, '--card-w'))}）`)
      .not.toBeNull();
    // ⚠️ 逐项复算：这些**不是**手抄的期望值，而是"卡面 5:7 + 46.2% 露出"两条几何约定算出来的
    const cardWWant = (cardH! - 2) * 0.71429 + 2;              // 93.43
    const step = 0.462 * cardW!;                                // 43.2
    const overlap = step - cardH!;                              // −86.8
    const seven = cardH! + 6 * step;                            // 389.0
    console.log(`  --card-w = ${cardW!.toFixed(2)}px（期望 ${cardWWant.toFixed(2)}）`
      + `\n  步距 = ${step.toFixed(1)}px / 竖排重叠 = ${overlap.toFixed(1)}px`
      + `\n  7 张跨度 = ${seven.toFixed(1)}px`);
    expect(cardW!, `--card-w（${cardW!.toFixed(2)}）必须等于卡面 5:7 的推导值（${cardWWant.toFixed(2)}）`)
      .toBeCloseTo(cardWWant, 2);

    // ── ① `.stack` 的 `min-height` = 7 张跨度（**389.0 ± 1**）──
    const rawMin = cssPropOf(chain[1], chain, RULES, 'min-height');
    expect(rawMin, '`.net-lane-band .stack` 没有 min-height（R8-3 的 7 张预留）').toBeTruthy();
    const gotMin = cssLenOf([cssNode('board', 'net-board'), ...chain], RULES, rawMin!);
    console.log(`  min-height = ${rawMin} → 解算 ${gotMin === null ? 'null' : gotMin.toFixed(1)}px`);
    expect(gotMin, `min-height 解不出像素值：${rawMin}`).not.toBeNull();
    expect(gotMin!, `min-height 解算值必须 ≈ 389.0（7 张跨度；R19 的档）`)
      .toBeGreaterThanOrEqual(seven - 1);
    expect(gotMin!).toBeLessThanOrEqual(seven + 1);
    expect(gotMin!, `min-height 必须等于"7 张跨度"本身（${seven.toFixed(1)}）—— 它是 R9-1 的"长度"面`)
      .toBeCloseTo(seven, 1);
    // ── ③ **R19 的新意图**：7 张跨度必须放得进"一个视口高 − #app 内边距 − 左栏（放大框 + 停靠栏）"
    //    这条是"放置区拿满整页高"的可解算版本：链路的 7 张预留（389.0）+ 左栏两个组件
    //    的**推导**高度必须小于棋盘高（在用户的 1080p 上）。⚠️ 观感仍属人眼项（见报告）。
    const padY = cssLenOf([cssNode('board', 'net-board')], RULES,
      cssVarOf([cssNode('board', 'net-board')], RULES, '--net-app-pad-y') ?? '');
    expect(padY, '--net-app-pad-y 解不出').toBe(122);
    console.log(`  R19 预算：1080p 视口 ⇒ 棋盘高 ${1080 - padY!}px；7 张跨度 ${seven.toFixed(1)}px`
      + `（余量 ${(1080 - padY! - seven).toFixed(1)}px 给放大框 + 停靠栏）`);
    expect(1080 - padY! - seven, '7 张跨度几乎吃掉整个棋盘高（没有任何余量给左栏的两个组件）')
      .toBeGreaterThan(400);

    // ── ② 竖排重叠 `margin-top` 同样由 `--card-w` / `--card-h` 推出 ──
    //    ⚠️ **不能用 `.net-lane-band .stack .card + .card` 走 `cssPropOf`**：共享解析器把
    //    `+` 当普通 token（`selectorMatches` 只建模后代组合器，`net-css-parse` 头注已声明），
    //    那条带 `+` 的选择器在这里**解不出**。改用 `.net-lane-band .stack .card`（同一条规则体
    //    里的属性集相同），并**另加一条源码腿**确认真正承重的那条规则写的是 `margin-top`、
    //    且它的选择器是 `+ .card` 形态（否则"只给第一张卡加 margin"这种错法会漏过）。
    const plusRule = RULES.find((r) => r.selector.trim() === '.net-lane-band .stack .card + .card');
    expect(plusRule, 'styles-net.css 里找不到 `.net-lane-band .stack .card + .card` 的规则'
      + '（竖排重叠的唯一出处）').toBeTruthy();
    expect(plusRule!.body, '相邻卡的规则里没有 `margin-top`（竖排重叠丢了；横排的 margin-left 对竖排无效）')
      .toMatch(/(?:^|;|\s)margin-top\s*:/);
    const cardChain = [cssNode('board', 'net-board'), band(), cssNode('stack'), cssNode('card')];
    const rawOverlap = /(?:^|;|\s)margin-top\s*:\s*([^;]+)/.exec(plusRule!.body)?.[1].trim();
    expect(rawOverlap, '相邻卡规则里的 margin-top 没读出声明值').toBeTruthy();
    const gotOverlap = cssLenOf(cardChain, RULES, rawOverlap!);
    console.log(`  竖排重叠 margin-top = ${rawOverlap} → 解算 ${gotOverlap === null ? 'null' : gotOverlap.toFixed(1)}px`);
    expect(gotOverlap, `margin-top 解不出像素值：${rawOverlap}`).not.toBeNull();
    expect(gotOverlap!, `竖排重叠（${gotOverlap!.toFixed(1)}）必须等于 步距 − 卡高（${overlap.toFixed(1)}）——`
      + '**是负数**（正数说明解算器把首项负号吃掉了，或者 CSS 写反了）').toBeCloseTo(overlap, 1);
  });

  it('G-10b（**源码腿**）：协议 holder 的宽高必须由 `var(--card-h)` 推出，且**不得**再出现第二组独立字面量', () => {
    const widthDecl = declOf(['.net-lane-band', '.protocol-holder'], 'width');
    const heightDecl = declOf(['.net-lane-band', '.protocol-holder'], 'height');
    console.log(`\n===== G-10b · 协议 holder 的声明原文 =====\n  width: ${widthDecl}\n  height: ${heightDecl}`);
    // ① 必须是 `var(--card-h)` 的表达式（"只改一个数"的**结构**落实）
    for (const [name, decl] of [['width', widthDecl], ['height', heightDecl]] as const) {
      expect(decl, `协议 holder 的 \`${name}\` 不是由 --card-h 推出的（实际 \`${decl}\`）——`
        + '那样"缩卡不缩协议"就会重新出现（用户第三次反馈的第一句）')
        .toContain('var(--card-h)');
    }
    // ② **不得**出现第二组独立字面量：表达式里**不允许**再有任何 px/% 结尾的绝对长度 ——
    //    那是 R8-1 的写法（100px / 140px），它会让"只改 --card-h 一个数"失效
    //    （协议不动、卡在动）。
    //    ⚠️ **反空集合**：先证明这套挑法**真的有牙**（喂一条 R8-1 时代的写法必须被挑出来），
    //    否则"没挑到"可能只是正则写错（本项目反复栽过的"空断言"）。
    expect(absoluteLens('calc(var(--card-h) * 0.5495)'), '挑绝对长度的判据失效了：'
      + '它连正常的表达式都判成"含绝对长度"' ).toEqual([]);
    expect(absoluteLens('100px'), '挑绝对长度的判据失效了：喂 `100px` 竟然挑不出来').toEqual(['100px']);
    for (const [name, decl] of [['width', widthDecl], ['height', heightDecl]] as const) {
      const leftovers = absoluteLens(decl);
      expect(leftovers, `协议 holder 的 \`${name}\` 里仍有点死的绝对长度 ${leftovers.join(', ')} ——`
        + 'R9-1 要求宽高**完全**由 `--card-h` 的倍数表达（比值来历写进注释）。'
        + '（口径：`em` / `rem` 等**相对**长度不算"另一组绝对尺寸"，故不在此列。）').toEqual([]);
    }
    // ③ 数值解算：≈ 71.4 × 100（比值 0.5495 = 100/182、0.7692 = 140/182；R19 起 --card-h = 130）
    const w = cssLenOf(holderChain(), RULES, widthDecl);
    const h = cssLenOf(holderChain(), RULES, heightDecl);
    console.log(`  解算：width = ${w === null ? 'null' : w.toFixed(1)}px / height = ${h === null ? 'null' : h.toFixed(1)}px`);
    expect(w, `协议 holder 的 width 解不出像素值（源文：${widthDecl}）`).not.toBeNull();
    expect(h, `协议 holder 的 height 解不出像素值（源文：${heightDecl}）`).not.toBeNull();
    // ⚠️ **数值迁移（R19）**：76.93 / 107.69 → 71.435 / 99.996（= 130 × 那两个比值）。
    //    **旧句为什么必须改**：那两个数**不是**独立常量，它们就是 `--card-h × 0.5495` 与
    //    `--card-h × 0.7692` ⇒ `--card-h` 一改它们必然跟着改；旧句会把**正确**的实现判红。
    //    **新句多查了什么**：仍然由**同一个比值**复算（`130 × 比值`），所以它照样抓得住
    //    "有人把 holder 改成第二组字面量"（那时数值会与这个复算值不符）。
    expect(w!, '协议 holder 宽必须 ≈ 71.4（= 130 × 0.5495）').toBeCloseTo(130 * 0.5495, 1);
    expect(h!, '协议 holder 高必须 ≈ 100.0（= 130 × 0.7692）').toBeCloseTo(130 * 0.7692, 1);
    // ④ **反空集合**：协议图（`.protocol-img`）必须跟着同一个表达式走 —— 它是真正的可见图，
    //    holder 只是它的静态盒；只改 holder 会让图片仍然按旧尺寸撑开（"看着没缩"）。
    const imgRule = RULES.find((r) => r.selector.trim() === '.net-lane-band .protocol-img');
    expect(imgRule, 'styles-net.css 里找不到 `.net-lane-band .protocol-img` 的规则').toBeTruthy();
    expect(imgRule!.body, '协议图的 width/height 未由 --card-h 推导（只有 holder 缩了 ⇒ 图片仍撑开）')
      .toMatch(/width:\s*calc\(var\(--card-h\)/);
  });

  it('G-10c（**前提腿**）：样式表里不得含 `!important` / ID / 内联覆盖（与既有两条腿同一份实现）', () => {
    expect(() => assertNoUnmodelableCascade(RULES, MODELED_PROPS)).not.toThrow();
  });
});

/* ============================================================================
 * G-11：控制轨不再把三列挤偏（三列水平中心 == 网格盒中心）
 * ========================================================================== */

describe('R9-2 · G-11：三列精确居中', () => {
  const board = (): StubNode => cssNode('board', 'net-board');
  const grid = (): StubNode => cssNode('board-grid', 'net-grid');

  /* `grid-template-columns` 的切分/展开用模块级的 `splitTopLevel` / `gridTracks`
     （G-12a⑤ 与 G-11c 也用它 —— 一处实现，免得两处漂移；见它们的定义处注释）。 */

  /**
   * **归中算术（R9-2 → **R19 收口**）**：放置区为什么恒在页面水平中心。
   *
   * ## R9-2 那一版（**已退役**，这里保留推导作为历史依据）
   * 设 `M` = 三条轨道的内容宽、`G` = `gap`、`R` = 控制轨宽、`P` = `padding-left`。
   * 那时 `.net-grid` **横跨整行**（`grid-column: 1 / -1`），盒宽 = `P + M + 2G + R`，
   * 三列占 `[P, P + M]` ⇒ 要让三列中心 == 盒中心必须 `P = 2G + R`。
   *
   * ## 为什么 R19 必须改写它（**不是放松，而是把机制挪到了更硬的地方**）
   * 用户这一轮把三块组件搬进左栏 ⇒ `.net-board` 的列模板变成
   * `minmax(0, 1fr) auto minmax(0, 1fr)`（左栏 | 放置区 | 右空）。
   * 此时"放置区居中"**不再**由盒内 `padding-left` 表达，而是由**列模板本身**表达：
   * 第 1 与第 3 条轨道是**同一个 `minmax(0, 1fr)`** ⇒ 它们等宽（网格算法对两个相同弹性轨道
   * 分配相同空间）⇒ 中间那条 `auto` 轨道的**左右两侧等宽** ⇒ 中列恒在容器中心。
   * ⇒ 旧判据（解 `padding-left == 2G + R`）会把**正确**的实现判红（那两条声明已退役）。
   * **新判据多查了什么**：① 三条轨道的**族别**（第 1/3 条必须是同一条弹性轨道、第 2 条必须是
   * `auto`）；② 由它推出的**对称性**（左右留白相等 ⇒ 中列中心 == 容器中心），用**数值**验算
   * （而不是"看着像"）；③ 放置区**只占**中列（`grid-column: 2`）—— 旧句查的是 `1 / -1`，
   * 在新形态下那会跨过留白、把 `fit-content` 的盒宽拉散（`net-dock.test.ts` 的 G-13a 同钉）。
   */
  function boardColumnMath(railWidth: number, laneWidth: number, rightWidth: number): {
    left: number; centre: number; right: number; boxCentre: number; tracks: string[];
  } {
    const b = board();
    const raw = subjectPropOf(b, [b], RULES, 'grid-template-columns');
    expect(raw, '`.net-board` 没有 grid-template-columns（R19 的列几何失去定义）').toBeTruthy();
    const tracks = gridTracks(raw!);
    expect(tracks.length, `\`.net-board\` 必须恰好 **3 条**轨道（左栏 · 放置区 · 右空），`
      + `实际 ${tracks.length} 条：${tracks.join(' | ')}`).toBe(3);
    // ① 左右两条必须是**同一个值**（同一条弹性轨道）—— 这条是"中列恒居中"的充要条件
    expect(tracks[0], `第 1 条轨道（左栏）与第 3 条（右空）必须**同值**（实际 \`${tracks[0]}\` vs \`${tracks[2]}\`）——`
      + '两者不等宽时中列会被推向一侧').toBe(tracks[2]);
    expect(/\d?fr\b/.test(tracks[0]), `左右两条轨道必须是**弹性族**（实际 \`${tracks[0]}\`）——`
      + '它们是对称的留白；写死 px 会在别的视口宽度下失去对称').toBe(true);
    // ② 中间那条必须是 `auto`（按内容宽：放置区的内容宽由 .net-grid 的 fit-content 推出）
    expect(tracks[1], `第 2 条轨道（放置区）必须是 \`auto\`（实际 \`${tracks[1]}\`）——`
      + '它要按内容宽收，而不是被拉伸或塌掉').toBe('auto');
    // ③ **对称性验算**：把两侧留白代入（同一条 `minmax(0,1fr)` ⇒ 同宽），中列居中即
    //    `left == right`。这里用给定的代入值算出三个区间，再比中列中心与容器中心。
    const left = railWidth;
    const right = rightWidth;
    const centre = left + laneWidth / 2;
    const boxCentre = (left + laneWidth + right) / 2;
    console.log(`\n===== G-11 · .net-board 的列居中算术（R19）=====\n`
      + `  轨道 = ${tracks.join(' | ')}\n  代入：左留白 ${left} / 放置区 ${laneWidth} / 右留白 ${right}`
      + `\n  中列中心 = ${centre.toFixed(1)} / 容器中心 = ${boxCentre.toFixed(1)}`);
    return { left, centre, right, boxCentre, tracks };
  }

  /** `var(--x)` / 字面量 → 解算后的字面量（沿 `chain` 找自定义属性）。 */
  function resolveVar(chain: StubNode[], raw: string): string {
    const m = /^var\(\s*(--[A-Za-z0-9_-]+)\s*\)$/.exec(raw.trim());
    if (m === null) return raw.trim();
    return cssVarOf(chain, RULES, m[1]) ?? raw.trim();
  }

  it('G-11a. 放置区恒在页面水平中心：`.net-board` 的第 1 / 3 条轨道**同值**（对称留白）⇒ 中列中心 == 容器中心', () => {
    // ⚠️ **判据迁移（R19）—— 旧句为什么必须改**：旧句是"三列的水平中心 == `.net-grid` 盒中心"，
    //    它的机制是 `.net-grid` 横跨整行 + `padding-left = 2 × gap + 控制轨宽`。
    //    R19 之后放置区只占**中列**，那两条声明已退役（见 styles-net.css 第 1 节的退役记录）⇒
    //    旧句会把**正确**的实现判红。
    //    **新句多查了什么**：① 对称性来自**列模板**（左右两条同值）而不是盒内边距；
    //    ② 用**三组代入值**（左右不等宽的两组 + 等宽的一组）做**反空集合**：
    //       只有"左右同值"那条轨道设计才让"中列中心 == 容器中心"对**任意**宽度都成立 ——
    //       若有人把左栏轨道写成 `max-content`（内容宽），第 ① 条断言就会红。
    for (const [railW, laneW] of [[420, 505], [100, 1200], [300, 300]] as const) {
      const { left, right, centre, boxCentre } = boardColumnMath(railW, laneW, railW);
      expect(Math.abs(centre - boxCentre), `[左栏=${railW} 放置区=${laneW}] 中列中心（${centre.toFixed(1)}）`
        + `与容器中心（${boxCentre.toFixed(1)}）不相等 —— 用户第 ① 条诉求是"放置区仍然居中"`)
        .toBeLessThanOrEqual(0.5);
      expect(left, '左右两条留白必须同宽（同一条弹性轨道）').toBe(right);
    }
    // ④ 放置区**只占中列**（`grid-column: 2`）—— 旧值是 `1 / -1`（横跨整行）
    const g = grid();
    expect(subjectPropOf(g, [board(), g], RULES, 'grid-column'),
      '放置区必须只占中列（`2`）—— 写成 `1 / -1` 会跨过左右两条留白，`fit-content` 的盒宽被拉散')
      .toBe('2');
    // ⑤ 四条**盒内**轨道仍是"三条线 + 控制轨"（R7/R9-1 的判据一个字未改）
    const laneTracks = gridTracks(cssPropOf(g, [board(), g], RULES, 'grid-template-columns')!)
      .slice(0, 3);
    expect(laneTracks.filter((t) => /\d?fr\b/.test(t)), `前三条轨道不得是 \`1fr\` 族（实际 ${laneTracks.join(' | ')}）`)
      .toEqual([]);
    // ⑥ 控制轨仍是**第 4 条轨道、仍在右侧**（用户只要求"别把三列挤偏"，没要求挪走它）
    const tracks = gridTracks(cssPropOf(g, [board(), g], RULES, 'grid-template-columns')!);
    expect(resolveVar([board(), g], tracks[3]), '控制轨（第 4 条轨道）不再是 --net-rail-w 的固定宽')
      .toBe('160px');
    // ⑦ **退役腿**：R9-2 的归中量必须**真的不在**了（半留状态会让下一个读者以为它还在起作用）
    expect(cssPropOf(g, [board(), g], RULES, 'padding-left'),
      '`.net-grid` 的 `padding-left` 仍在 —— R19 的列模板已经接管了"居中"，留着它会把放置区整体右推')
      .toBeNull();
  });

  it('G-11b. 放置区仍是"三条线 + 控制轨"四个并排**盒内**轨道，且 `.net-grid` 仍是 `fit-content`（贴合卡片）', () => {
    const chain = [board(), grid()];
    const rawW = cssPropOf(grid(), chain, RULES, 'width');
    console.log(`\n===== G-11b · .net-grid 的 width = ${String(rawW)}`);
    // `width: 100%` 会让盒子撑满**中列** ⇒ `fit-content` 的"贴合卡片"失效。
    expect(rawW, '`width` 不是 `fit-content`（R9-1：链路框要贴合卡片）')
      .toBe('fit-content');
    // R7 的 `max-width: 1010px` 在内容宽下是死声明（内容恒小于它）—— 留着就是第二套真相
    const maxW = cssPropOf(grid(), chain, RULES, 'max-width');
    expect(maxW, '.net-grid 上仍留着 `max-width`（内容宽下它是死声明；R9-1 已删除）').toBeNull();
    // ⚠️ **新增（R19）**：`fit-content` 现在**同时**是中列（`auto` 轨道）的尺寸来源 ——
    //    所以它必须**真的**还在（上面那条），而中列不能是弹性族（那是 G-11a 的判据）。
    expect(gridTracks(subjectPropOf(board(), [board()], RULES, 'grid-template-columns')!)[1],
      '中列轨道不是 `auto` —— 放置区的 fit-content 盒宽会被 `1fr` 拉伸').toBe('auto');
  });

  /**
   * **G-11c（**R19 第三次改写**）：停靠栏三块现在是 `.net-dock` 的 flex 项 ——
   * `.net-board` 的三条轨道改为"左栏 | 放置区 | 右空"。**
   *
   * 历史：R11-2/3 时这条钉的是 `.net-board` 的**四列**（自己块 · 弹性 · 对手块 · 张数）；
   * R12-7 改成"三条内容宽轨道 + `justify-content: center`"（三块紧挨着、整组居中）。
   * **旧句为什么必须改**：R19 把三块搬进 `.net-dock`（flex 行，见 styles-net.css 第 6 节）
   * ⇒ "三块紧挨着"由 `.net-dock` 的 `gap` + `justify-content: flex-end` 表达，
   * `.net-board` 的轨道已经装的是别的东西（左栏 / 放置区 / 右空）。旧句（要求三条**内容宽**
   * 轨道、不许有 `fr`、且 `justify-content: center`）会把**正确**的实现判红。
   * **新句多查了什么**：① `.net-board` 的三条轨道**必须**是"弹性 · `auto` · 弹性"（对称留白，
   * 这是"放置区居中"的机制，G-11a 的数值腿是它的算术版本）；② "三块横排 + 整组右贴"这套职责
   * **有人接**：`.net-dock` 的 `display: flex` / `justify-content: flex-end` / `gap`；
   * ③ 三块**不再**各自被 `grid-column` 指派（退役要退干净 —— 半留状态 = 同一件事两套真相，
   * 那正是"改一处忘一处时页面照样看着对"的温床）。
   */
  it('G-11c. 停靠栏三块的横排几何搬到了 `.net-dock`（flex 行 + 整组右贴）；`.net-board` 的三条轨道 = 左栏 | 放置区 | 右空', () => {
    const b = board();
    const tracks = gridTracks(subjectPropOf(b, [b], RULES, 'grid-template-columns')!);
    console.log(`\n===== G-11c · .net-board 的列模板（R19）= ${tracks.join(' | ')}`);
    expect(tracks.length, '`.net-board` 的轨道数不是 3').toBe(3);
    expect(tracks[0], '第 1 条轨道不是弹性留白').toMatch(/\d?fr\b/);
    expect(tracks[1], '第 2 条轨道（放置区）不是 `auto`').toBe('auto');
    expect(tracks[2], '第 3 条轨道不是弹性留白').toMatch(/\d?fr\b/);
    expect(tracks[0], '两条留白必须同值（否则放置区不居中）').toBe(tracks[2]);
    // ② "三块横排 + 整组右贴"的接棒者
    const dock = cssNode('net-dock');
    const dockChain = [b, dock];
    expect(subjectPropOf(dock, dockChain, RULES, 'display'), '`.net-dock` 不是 flex 容器')
      .toBe('flex');
    expect(subjectPropOf(dock, dockChain, RULES, 'flex-direction'), '`.net-dock` 不是横排（用户第 ① 条"仍横排"）')
      .toBe('row');
    expect(subjectPropOf(dock, dockChain, RULES, 'justify-content'),
      '`.net-dock` 的整组没有右贴（"最右边紧挨着中间的放置区域"）').toBe('flex-end');
    expect(cssLenOf(dockChain, RULES, subjectPropOf(dock, dockChain, RULES, 'gap') ?? ''),
      '`.net-dock` 没有三块之间的间距（会粘成一坨）').toBeGreaterThan(0);
    // ③ 三块**不再**被 grid-column 指派（退役要退干净）
    const staleColumnRules = RULES.filter((r) =>
      /(?:^|;|\s)grid-column\s*:/.test(r.body)
      && /\.net-info-block|\.net-hand-area/.test(r.selector));
    expect(staleColumnRules.map((r) => r.selector),
      'styles-net.css 里仍有给停靠栏组件派 `grid-column` 的规则 —— 它们现在住在 `.net-dock`（flex）里，'
      + '那些声明**不生效**（flex item 没有 grid placement），留着就是"看着在排版、其实什么都不做"的假代码')
      .toEqual([]);
    // 反空集合：这两块信息块 / 手牌区**真的**还在（否则上面几条是空判据）
    expect(cssNode('net-info-block').cls).toContain('net-info-block');
  });
});

/* ============================================================================
 * G-12：手牌并进信息盒（**同一行、同一个盒子**）—— 桩上真跑 `renderNetBoard`
 *
 * 判据（§13.7 的 G-12）：**同一 `grid-row` 内既有该侧 `.net-info-block`、又有该侧
 * `.net-hand-area`**（**两个席位都跑**）；且手牌的 `grid-column` 横跨到**右边界**。
 *
 * ⚠️ 为什么必须"真跑一帧"而不是查样式表文本：本波的全部机制是"`display: contents` 展平后
 * 两块**真的**成为同一个 `grid-row` 的 grid item"—— 少写一条 `contents`、或者把 `grid-row`
 * 写在**永不命中**的选择器上（`.net-board > .net-info-block` 那种），样式表读起来完全正常，
 * 而页面上是旧样（R8-5 的头注专门讲过这条静默失效）。只有把**真实渲染出的那棵树**喂给
 * 行号解算器才能发现。
 * ========================================================================== */

describe('R9-3 · G-12：手牌与信息块并盒（同一行）', () => {
  it('G-12a. 每一侧的"信息块 + 手牌区"必须落在**同一个** grid-row（两个席位都跑）', async () => {
    const restore = installStubDom();
    try {
      for (const seat of [0, 1] as const) {
        const root = renderFrame({ viewSeat: seat, turnPlayer: 0 });
        const board = findIn(root, 'net-board');
        const tree: string[] = [];
        walk(board, 0, tree, 3);
        console.log(`\n===== G-12a · viewSeat=${seat} · 渲染根 .net-board 的元素树 =====\n${tree.join('\n')}`);

        // ── 展平 `display: contents`：只有**真的**解出 contents 的容器才被展平
        //    （按类名硬编码的话，"删掉那条 contents"的变异不会红）
        //    ⚠️ **R19**：`.net-bottom` / `.net-hands` 的 contents 语义**一个字未改**，
        //    但它们上面多了一层**有盒子**的 `.net-dock`（flex 行）⇒ 展平必须在
        //    `.net-dock` 的**内部**继续做（"三块是 `.net-dock` 的 flex 项"就是本用例的新判据）。
        const chainOf = (n: StubNode): StubNode[] => ancestorsOf(root, n);
        const isContents = (n: StubNode): boolean => {
          const chain = chainOf(n);
          return subjectPropOf(n, chain, RULES, 'display') === 'contents';
        };
        const flat: StubNode[] = [];
        const visit = (n: StubNode): void => {
          for (const c of n.children) {
            if (isContents(c)) { visit(c); continue; }
            flat.push(c);
            visit(c);
          }
        };
        visit(board);
        // ⚠️ **新增（R19，反空集合）**：`.net-dock` 必须是 `.net-board` 里**唯一**有盒子的
        //    停靠栏容器，且它自己**不是** `display: contents`（它是 flex 行 —— 三块靠它横排）。
        const dock = flat.filter((n) => isClass(n, 'net-dock'));
        expect(dock.length, `viewSeat=${seat}：展平后 .net-board 下没有 .net-dock（R19 的三块容器）`)
          .toBe(1);
        expect(subjectPropOf(dock[0], chainOf(dock[0]), RULES, 'display'),
          '`.net-dock` 被写成了 `display: contents` —— 那样三块会各自成为 `.net-board` 的 grid item，'
          + '"整组横排 + 右贴"完全失效（而外观上像还在）').toBe('flex');

        const infoOf = (side: 'foe' | 'self'): StubNode => {
          const hit = flat.filter((n) => isClass(n, 'net-info-block') && n.dataset.netSeat === side);
          expect(hit.length, `viewSeat=${seat}：${side} 侧的信息块不是恰好一块 grid item（实际 ${hit.length} 块）`)
            .toBe(1);
          return hit[0];
        };
        const handOf = (side: 'foe' | 'self'): StubNode => {
          const hit = flat.filter((n) => isClass(n, `net-hand-area-${side}`));
          expect(hit.length, `viewSeat=${seat}：${side} 侧的手牌区不是恰好一块 grid item（实际 ${hit.length} 块）`
            + '—— 为 0 说明少写了一条 `display: contents`（手牌区缩在 .net-hands 盒子里）').toBe(1);
          return hit[0];
        };
        const rowOf = (n: StubNode): string | null => subjectPropOf(n, chainOf(n), RULES, 'grid-row');
        const colOf = (n: StubNode): string | null => subjectPropOf(n, chainOf(n), RULES, 'grid-column');

        for (const side of ['foe', 'self'] as const) {
          const info = infoOf(side);
          const hand = handOf(side);
          const infoRow = rowOf(info);
          const handRow = rowOf(hand);
          console.log(`  viewSeat=${seat} · ${side}：信息块 grid-row=${String(infoRow)} grid-column=${String(colOf(info))}`
            + ` / 手牌区 grid-row=${String(handRow)} grid-column=${String(colOf(hand))}`);
          // ⚠️⚠️ **判据迁移（R19）—— 旧句为什么必须改，新句多查了什么**
          //  · **旧句**：解 `.net-info-block` / `.net-hand-area` 自己的 `grid-row` 必须**相等且非空**
          //    （R9-3 的"信息块与手牌并盒、同一行"），并解各自的 `grid-column`（1 / 2 / 3）。
          //  · **为什么必须改**：R19 把三块搬进 `.net-dock`（**flex 行**）—— 它们不再是
          //    `.net-board` 的 grid item ⇒ 那四条 `grid-row` / `grid-column` **已退役**
          //    （留着就是同一件事两套真相，见 styles-net.css 第 1 节的退役记录）。
          //    继续钉它们会把**正确**的实现判红。
          //  · **新句多查了什么**：① **同一个盒子**（R9-3 的裁决本体）现在由"三块都在 `.net-dock`
          //    这一个 flex 容器里、且它是 `display: flex`"表达（比"解出同一个行号"更直接：
          //    行号可以被另一条规则悄悄改掉，而"父节点是不是那一个 flex 盒"不会）；
          //    ② 三块**横排**由容器的 `flex-direction: row` 钉住（旧形态下那是 `grid-column` 的活）；
          //    ③ 左右次序由 **DOM 顺序**表达（自己块在前、对手块在后 —— `NET_BOTTOM_SIDES`），
          //    而旧句用的是"列号更小"（flex 行里没有列号）。
          const dockOf = (n: StubNode): StubNode | null => n.parentElement;
          expect(hand.parentElement, `viewSeat=${seat} · ${side} 侧：手牌区的父节点不是 .net-hands`
            + '（R19 只搬容器，不搬手牌区与 .net-hands 的父子关系）')
            .toBe(descendants(dock[0]).find((n) => isClass(n, 'net-hands'))!);
          // 三块在**同一个** flex 容器下（经各自的 `display: contents` 父节点）
          // —— 这才是 R9-3"纳入同一个组件"在 R19 形态下的说法。
          expect(chainOf(info).includes(dock[0]), `viewSeat=${seat} · ${side} 侧：信息块的祖先链上没有 .net-dock`)
            .toBe(true);
          expect(chainOf(hand).includes(dock[0]), `viewSeat=${seat} · ${side} 侧：手牌区的祖先链上没有 .net-dock`)
            .toBe(true);
          expect(dockOf(descendants(dock[0]).find((n) => isClass(n, 'net-bottom'))!),
            `viewSeat=${seat} · ${side} 侧：.net-bottom 的直接父节点不是 .net-dock`
            + '（三块必须同排在一个盒子里）').toBe(dock[0]);
        }
        // ④ 三块的**DOM 顺序**：自己信息块 → 手牌区 → 对手信息块（`NET_BOTTOM_SIDES` 的唯一出处），
        //    而"谁在左、谁在右"由 flex 行方向直接读 DOM（旧形态下那条判据是"列号更小"）。
        const dockOrder = dock[0].children.filter((n) => isClass(n, 'net-bottom'))
          .flatMap((row) => row.children)
          .map((n) => (isClass(n, 'net-info-block') ? String(n.dataset.netSeat)
            : isClass(n, 'net-hands') ? 'hands' : '?'));
        console.log(`  viewSeat=${seat} · .net-dock 里的三块（DOM 顺序）: ${dockOrder.join(' → ')}`);
        expect(dockOrder, `viewSeat=${seat}：停靠栏三块的 DOM 顺序必须是`
          + ` [self, hands, foe]（自己块在左、对手块在右）`).toEqual(['self', 'hands', 'foe']);

        /* ── ⑤ **几何腿**（R9-3 收口 · 评审 I-2；**R12-7 改写**；**R19 再改写**）──
              历史：R9-3 查"手牌 `1 / -1`"、R12-7 查"三条内容宽轨道 + 整组居中"。
              **R19**：三块住在 `.net-dock`（flex）里 ⇒ 这条腿的对象换成**那个容器**的几何：
              横排（`flex-direction: row`）、整组**右贴**（`justify-content: flex-end`）、
              底边对齐（`align-items: flex-end`）、三块之间有 `gap`。
              ⚠️ **保留的那条推导**：`2 / -1` 会把手牌区间扩到 `[c1, B]`、中心右移 `c1/2` ——
              它在 R19 里**没有对象了**（手牌不再被指派列），但它当初要防的错法
              （"看起来更整齐"的写法把某一块推开）现在由 `justify-content` 的判据承担。 */
        {
          const dockChain = [board, dock[0]];
          const dd = (prop: string): string | null => subjectPropOf(dock[0], dockChain, RULES, prop);
          expect(dd('display'), '停靠栏三块的容器不是 flex（"仍横排"这条裁决没了机制）').toBe('flex');
          expect(dd('flex-direction'), '停靠栏三块不是横排（`flex-direction: row`）').toBe('row');
          expect(dd('justify-content'), '停靠栏三块没有整组**右贴**（用户："最右边紧挨着中间的放置区域"）')
            .toBe('flex-end');
          expect(dd('align-items'), '停靠栏三块的底边没有对齐（手牌那一块会悬空）').toBe('flex-end');
          const gap = cssLenOf(dockChain, RULES, dd('gap') ?? '');
          expect(gap, '停靠栏三块之间没有间距（会粘成一坨）').toBeGreaterThan(0);
          console.log(`  viewSeat=${seat} · R19：.net-dock = flex/row/justify-content: flex-end/`
            + `align-items: flex-end/gap: ${String(gap)}px`);
        }
      }
    } finally {
      await drainRaf();
      restore();
    }
  });

  it('G-12c. 行表只剩**一行**（链路=1 · 左栏=1）；工具条/导出按钮是 fixed 不占行；日志不渲染（R12-1）', async () => {
    const restore = installStubDom();
    try {
      for (const seat of [0, 1] as const) {
        const root = renderFrame({ viewSeat: seat, turnPlayer: 0 });
        const board = findIn(root, 'net-board');
        const rows: string[] = [];
        for (const n of board.children) {
          const row = subjectPropOf(n, ancestorsOf(root, n), RULES, 'grid-row');
          const col = subjectPropOf(n, ancestorsOf(root, n), RULES, 'grid-column');
          const kind = isClass(n, 'net-grid') ? 'grid'
            : isClass(n, 'net-left-rail') ? 'left-rail'
              : isClass(n, 'net-bottom') ? 'bottom(contents)'
                : isClass(n, 'log') ? 'log'
                  : isClass(n, 'diag-btn') ? 'diag-btn(styles.css 的 fixed)'
                    : isClass(n, 'net-preview-bar') ? 'preview-bar(仅开发者模式)' : `?${n.cls}`;
          rows.push(`${kind}=row ${String(row)} / col ${String(col)}`);
          // ① **每一个参与 grid 布局的直接子节点都必须有自己的 `grid-row` + `grid-column`**
          //    （显式指派）—— 自动放置会让它随"有没有其他自动放置项"漂到别的格子
          //    （同一份样式表两种布局）。
          //    ⚠️ **导出按钮与预览工具条是例外**：它们在 `styles.css` / 本表第 8 节里都是
          //    `position: fixed`（不参与 grid 布局），所以它们**没有**行号是正确的。
          //    ⚠️ **R19**：`.net-dock` **不是** `.net-board` 的直接子节点（它是 `.net-left-rail`
          //    的子节点）⇒ 本循环看不到它 —— 它的判据在 ④ 与 `net-left-rail.test.ts` 里。
          if (kind.startsWith('grid') || kind.startsWith('left-rail') || kind.startsWith('log')) {
            expect(row, `viewSeat=${seat}：.${kind} 没有解出 grid-row —— 自动放置会让它漂到别的行上`).toBeTruthy();
            expect(col, `viewSeat=${seat}：.${kind} 没有解出 grid-column —— 自动放置会让它漂到别的列上`).toBeTruthy();
          }
        }
        console.log(`  viewSeat=${seat} · .net-board 直接子节点: ${rows.join(' | ')}`);
        // ② 行表**逐项**核对（R19：链路与左栏**同在第 1 行**；左栏在第 1 列、链路在第 2 列）
        const rowOfKind = (k: string): string => rows.find((r) => r.startsWith(`${k}=`))!.split('=')[1];
        expect(rowOfKind('grid'), `viewSeat=${seat}：放置区（.net-grid）必须在**第 1 行**`)
          .toBe('row 1 / col 2');
        expect(rowOfKind('left-rail'), `viewSeat=${seat}：左栏必须在**第 1 行 / 第 1 列**`
          + `（与实际 ${rowOfKind('left-rail')} 不符）`).toBe('row 1 / col 1');
        // ── R12-1：事件日志块**不再渲染**（用户："取消日志的显示"）⇒ 它那 72px 归放牌区 ──
        expect(rows.filter((r) => r.startsWith('log=')).length,
          'viewSeat=' + seat + '：事件日志块又被渲染出来了 —— R12-1 取消了它的显示').toBe(0);
        // ③ 反空集合：这一帧里**真的**有导出按钮（它是"看日志"的唯一去处）
        expect(board.children.filter((n) => isClass(n, 'diag-btn')).length,
          `viewSeat=${seat}：这一帧里没有 .diag-btn`).toBe(1);
        // ④ **停靠栏三块在左栏里**（R19 取代"两块信息块 + 两块手牌区都解出第 3 行"）
        //    ⚠️ **判据迁移（R19）——旧句为什么必须改，新句多查了什么**
        //     · **旧句**：三块各自的 `grid-row` 必须 == `'3'`（R11-2 的三行表）。
        //     · **为什么必须改**：R19 把三块搬进 `.net-dock`（flex）⇒ 它们不再是 grid item，
        //       那四条 `grid-row` 已退役（半留状态 = 同一件事两套真相）。
        //     · **新句多查了什么**：① 三块的祖先链上**都有** `.net-dock` 与 `.net-left-rail`
        //       （结构面：它们在左栏那个横排整体里）；② `.net-dock` / `.net-left-rail` 各自
        //       **恰好一块**（多一块 = 同族节点被复制）。
        const leftRail = descendants(root).find((n) => isClass(n, 'net-left-rail'));
        expect(leftRail, `viewSeat=${seat}：元素树里找不到 .net-left-rail`).toBeTruthy();
        expect(descendants(root).filter((n) => isClass(n, 'net-dock')).length,
          `viewSeat=${seat}：.net-dock 不是恰好一块`).toBe(1);
        for (const sel of ['net-info-block', 'net-hand-area'] as const) {
          const nodes = descendants(root).filter((n) => isClass(n, sel));
          expect(nodes.length, `viewSeat=${seat}：${sel} 的个数不是 2`).toBe(2);
          for (const n of nodes) {
            const chain = ancestorsOf(root, n);
            expect(chain.some((x) => isClass(x, 'net-dock')),
              `viewSeat=${seat}：${sel}（${String(n.dataset.netSeat ?? n.dataset.player)}）不在 .net-dock 里`).toBe(true);
            expect(chain.some((x) => isClass(x, 'net-left-rail')),
              `viewSeat=${seat}：${sel}（${String(n.dataset.netSeat ?? n.dataset.player)}）不在左栏里`).toBe(true);
          }
        }
      }
    } finally {
      await drainRaf();
      restore();
    }
  });

  it('G-12b. 并盒形态：手牌区**去掉**自己的边框/背景/内边距（否则盒子里套小盒子）；`.hand` 的 DOM 顺序仍恒 [P0, P1]', async () => {
    const restore = installStubDom();
    try {
      for (const seat of [0, 1] as const) {
        const root = renderFrame({ viewSeat: seat, turnPlayer: 0 });
        const board = findIn(root, 'net-board');
        const hands = descendants(root).filter((n) => isClass(n, 'hand'));
        // 红线：`.hand` 顺序恒 [P0, P1]（FX 按下标读手牌）—— R9-3 只改 CSS，不许碰它
        expect(hands.map((n) => String(n.dataset.player)), `viewSeat=${seat}：.hand 的 DOM 顺序必须是 [P0, P1]`
          + '（FX 用 querySelectorAll(".hand")[player] **按下标**读手牌；顺序反了会把特效飞到对手手牌区）')
          .toEqual(['0', '1']);
        for (const side of ['foe', 'self'] as const) {
          const area = descendants(root).find((n) => isClass(n, `net-hand-area-${side}`));
          expect(area, `viewSeat=${seat}：找不到 .net-hand-area-${side}`).toBeTruthy();
          const chain = ancestorsOf(root, area!);
          const decl = (prop: string): string | null => {
            // 用**主体绑定**解算（信息块的边框不能算到手牌区头上）
            return subjectPropOf(area!, chain, RULES, prop);
          };
          console.log(`  viewSeat=${seat} · ${side} 手牌区：border=${String(decl('border'))} `
            + `background=${String(decl('background'))} padding=${String(decl('padding'))}`);
          // 并盒形态下这三项必须被中和（否则是"盒子里套一个小盒子"）
          expect(decl('border'), `viewSeat=${seat} · ${side} 侧手牌区仍有自己的边框 —— `
            + 'R9-3 要的是"一个盒子"（外框由信息块提供）').toMatch(/^(?:none|0)$/);
          expect(decl('background'), `viewSeat=${seat} · ${side} 侧手牌区仍有自己的底色（盒中盒）`)
            .toMatch(/^none$/);
          expect(decl('padding'), `viewSeat=${seat} · ${side} 侧手牌区仍有自己的内边距（会把信息块的边推开）`)
            .toMatch(/^0(?:px)?$/);
        }
        // 反空集合：**基类**上必须仍写着完整的长相（并盒形态的"去框"是**覆盖**，不是删掉基类）——
        // 将来若有第五种形态复用 `.net-hand-area`，它仍要有一块手牌区的默认框。
        const base = RULES.find((r) => r.selector.trim() === '.net-hand-area');
        expect(base, 'styles-net.css 里找不到 `.net-hand-area` 的基类规则').toBeTruthy();
        expect(base!.body, '`.net-hand-area` 的基类不再定义边框（并盒的"去框"成了唯一形态）')
          .toMatch(/border:\s*1px\s+dashed/);
      }
    } finally {
      await drainRaf();
      restore();
    }
  });
});
