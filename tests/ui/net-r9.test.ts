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

  it('G-10a. `--card-h === 140px`，且卡宽 / 步距 / 竖排重叠 / 7 张跨度**全部**由它推出（解算值 ≈ 100.57 / 46.5 / −93.5 / 418.8）', () => {
    const chain = stackChain();
    const rawH = cssVarOf([cssNode('board', 'net-board'), band()], RULES, '--card-h');
    console.log(`\n===== G-10a · styles-net.css 真实解算（R9-1）=====\n  --card-h = ${String(rawH)}`);
    expect(rawH, 'styles-net.css 里 `.net-lane-band` 没有 --card-h（唯一旋钮丢了 ⇒ 整条链路无从推导）')
      .toBe('140px');

    const cardH = cssLenOf([cssNode('board', 'net-board'), band()], RULES, rawH!);
    const cardW = cssLenOf([cssNode('board', 'net-board'), band()], RULES, cssVarOf([cssNode('board', 'net-board'), band()], RULES, '--card-w') ?? '');
    expect(cardH, '--card-h 解不出像素值').toBe(140);
    expect(cardW, `--card-w 未由 --card-h 推出（源文：${String(cssVarOf([cssNode('board', 'net-board'), band()], RULES, '--card-w'))}）`)
      .not.toBeNull();
    // ⚠️ 逐项复算：这些**不是**手抄的期望值，而是"卡面 5:7 + 46.2% 露出"两条几何约定算出来的
    const cardWWant = (cardH! - 2) * 0.71429 + 2;              // 100.57
    const step = 0.462 * cardW!;                                // 46.5
    const overlap = step - cardH!;                              // −93.5
    const seven = cardH! + 6 * step;                            // 418.8
    console.log(`  --card-w = ${cardW!.toFixed(2)}px（期望 ${cardWWant.toFixed(2)}）`
      + `\n  步距 = ${step.toFixed(1)}px / 竖排重叠 = ${overlap.toFixed(1)}px`
      + `\n  7 张跨度 = ${seven.toFixed(1)}px`);
    expect(cardW!, `--card-w（${cardW!.toFixed(2)}）必须等于卡面 5:7 的推导值（${cardWWant.toFixed(2)}）`)
      .toBeCloseTo(cardWWant, 2);

    // ── ① `.stack` 的 `min-height` = 7 张跨度（G-10 的硬数字：**418.8 ± 1**）──
    const rawMin = cssPropOf(chain[1], chain, RULES, 'min-height');
    expect(rawMin, '`.net-lane-band .stack` 没有 min-height（R8-3 的 7 张预留）').toBeTruthy();
    const gotMin = cssLenOf([cssNode('board', 'net-board'), ...chain], RULES, rawMin!);
    console.log(`  min-height = ${rawMin} → 解算 ${gotMin === null ? 'null' : gotMin.toFixed(1)}px`);
    expect(gotMin, `min-height 解不出像素值：${rawMin}`).not.toBeNull();
    expect(gotMin!, `min-height 解算值必须 ≈ 418.8（7 张跨度；R9-1 的裁决是"7 张牌大小的长度也缩"）`)
      .toBeGreaterThanOrEqual(418.8 - 1);
    expect(gotMin!).toBeLessThanOrEqual(418.8 + 1);
    expect(gotMin!, `min-height 必须等于"7 张跨度"本身（${seven.toFixed(1)}）—— 它是 R9-1 的"长度"面`)
      .toBeCloseTo(seven, 1);

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
    // ③ 数值解算：≈ 76.9 × 107.7（比值 0.5495 = 100/182、0.7692 = 140/182）
    const w = cssLenOf(holderChain(), RULES, widthDecl);
    const h = cssLenOf(holderChain(), RULES, heightDecl);
    console.log(`  解算：width = ${w === null ? 'null' : w.toFixed(1)}px / height = ${h === null ? 'null' : h.toFixed(1)}px`);
    expect(w, `协议 holder 的 width 解不出像素值（源文：${widthDecl}）`).not.toBeNull();
    expect(h, `协议 holder 的 height 解不出像素值（源文：${heightDecl}）`).not.toBeNull();
    expect(w!, '协议 holder 宽必须 ≈ 76.9（= 140 × 0.5495）').toBeCloseTo(76.93, 1);
    expect(h!, '协议 holder 高必须 ≈ 107.7（= 140 × 0.7692）').toBeCloseTo(107.69, 1);
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
   * **归中量的推导**（G-11 的核心算术，写在测试里而不是抄一个 184px）：
   *
   * 设 `M` = 三条轨道占的**内容宽**、`G` = `gap`、`R` = 控制轨宽（`--net-rail-w`）、
   * `P` = `padding-left`。`.net-grid` 是 `width: fit-content` ⇒ 它的盒宽 = `P + M + 2G + R`
   * （左侧只有内边距，右侧是"间隔 + 控制轨 + 间隔"）。
   * 三列占 `[P, P + M]` ⇒ 三列中心 = `P + M/2`；盒中心 = `盒宽/2`。
   * 两者相等 ⟺ `2P + M = P + M + 2G + R` ⟺ **`P = 2G + R`**。
   * 下面**不写死** `2G + R` 的数值，而是从样式表解出这三个量再判 —— 这样"gap 改了但
   * padding-left 没跟着改"也会红（那正是"只差一点点、看不出谁的错"的形态）。
   *
   * ## `laneWidth` 参数为什么必须存在（诚实边界）
   * 三条轨道是 **`max-content`**（R9-1 的裁决本身）—— 那是**浏览器布局引擎**才能算出的值，
   * 本仓的桩与解算器**都不模拟布局**（见 `./net-css-parse` 头注）。所以：
   *  · 结构面（"轨道不是 `1fr`、是内容宽族"）由 `G-11a③` 直接断言**声明原文**；
   *  · 数值面（"三列中心 == 盒中心"）用**一个给定的轨道宽**代入 —— 它在 `P = 2G + R` 下
   *    对**任意** `M` 都成立（推导里 `M` 被消掉了），所以代入具体值**不削弱**判据：
   *    只要 `padding-left` 不是 `2G + R`，无论 `M` 取多少都会偏。
   *    ⚠️ 这条**不能**证明"浏览器里算出来的 max-content 真等于那个值" —— 那需要人眼（§13.8）。
   */
  function centerMath(laneWidth: number): {
    lanes: number; boxCentre: number; boxWidth: number; M: number; P: number; G: number; R: number;
  } {
    const g = grid();
    const chain = [board(), g];
    const rawTracks = cssPropOf(g, chain, RULES, 'grid-template-columns');
    expect(rawTracks, '.net-grid 没有 grid-template-columns（列模板被删？）').toBeTruthy();
    const tracks = gridTracks(rawTracks!);
    expect(tracks.length, `列模板必须恰好 4 条显式轨道（3 条线 + 控制轨），实际 ${tracks.length} 条`)
      .toBe(4);
    // 三条线必须**同宽**（同一份轨迹值）—— 否则"三列中心"这个说法本身不成立
    const laneTracks = tracks.slice(0, 3);
    expect(new Set(laneTracks).size, `三条线的列必须同宽（实际 ${laneTracks.join(' | ')}）`).toBe(1);
    // 结构面：三条轨道必须是**内容宽**族（`max-content` 由布局引擎算 ⇒ 这里解不出像素）
    expect(laneTracks.filter((t) => /\d?fr\b/.test(t)), `前三条轨道不得是 \`1fr\` 族（实际 ${laneTracks.join(' | ')}）`)
      .toEqual([]);
    expect(/content/.test(laneTracks[0]), `前三条轨道必须是内容宽族（实际 \`${laneTracks[0]}\`）——`
      + '否则链路框撑满宿主、比卡片宽得多（用户第三次反馈的第一句）').toBe(true);
    const M = laneTracks[0].trim() === 'max-content'
      ? laneWidth
      : cssLenOf(chain, RULES, laneTracks[0]);
    expect(M, `轨道值 \`${laneTracks[0]}\` 既不是 max-content 也解不出像素宽`).not.toBeNull();

    const rawGap = cssPropOf(g, chain, RULES, 'gap');
    expect(rawGap, '.net-grid 没有 gap（间隔是归中量的输入）').toBeTruthy();
    const G = cssLenOf(chain, RULES, rawGap!);
    expect(G, `gap 解不出像素值：${rawGap}`).not.toBeNull();

    const rawP = cssPropOf(g, chain, RULES, 'padding-left');
    expect(rawP, '`.net-grid` 没有 `padding-left` —— R9-2 的归中量（控制轨挤偏三列 80px 的修法）')
      .toBeTruthy();
    const P0 = cssLenOf(chain, RULES, rawP!);
    expect(P0, `padding-left 解不出像素值：${rawP}`).not.toBeNull();
    const P = P0 ?? 0;

    const rawR = resolveVar(chain, tracks[3]);
    const R0 = cssLenOf(chain, RULES, rawR);
    expect(R0, `第 4 条轨道（控制轨）解不出像素宽：${tracks[3]}`).not.toBeNull();
    const R = R0 ?? 0;

    const Mv = M ?? 0;
    const Gv = G ?? 0;

    const boxWidth = P + Mv + 2 * Gv + R;
    const lanes = P + Mv / 2;
    console.log(`\n===== G-11 · .net-grid 的归中算术（由 styles-net.css 真实解出；轨道宽代入 ${Mv}px）=====\n`
      + `  轨道 = ${tracks.join(' | ')}`
      + `\n  gap G = ${Gv.toFixed(1)}px / padding-left P = ${P.toFixed(1)}px / 控制轨 R = ${R.toFixed(1)}px`
      + `\n  盒宽 = P + M + 2G + R = ${boxWidth.toFixed(1)}px / 三列区间 = [${P.toFixed(1)}, ${(P + Mv).toFixed(1)}]`
      + `\n  三列中心 = ${lanes.toFixed(1)}px / 盒中心 = ${(boxWidth / 2).toFixed(1)}px`);
    // ⚠️ **R9 收口（评审 I-1）**：这里返回的是 **`boxCentre`（已经除过 2 的盒中心）**，
    //    不是"盒宽"。第一版返回 `box: box / 2` 而调用方写 `expect(Math.abs(lanes - box))`，
    //    于是那条断言实际在比"三列中心 ≈ 盒**宽**" —— 一个**恒真式**（任何 `padding-left`
    //    都能过），而它的名字与失败消息（"控制器组件挤压了左边的游玩区…"）在说谎。
    //    现在名字与数值一一对应：比的是 `lanes（三列中心）` vs `boxCentre（盒中心）`。
    return { lanes, boxCentre: boxWidth / 2, boxWidth, M: Mv, P, G: Gv, R };
  }

  /** `var(--x)` / 字面量 → 解算后的字面量（沿 `chain` 找自定义属性）。 */
  function resolveVar(chain: StubNode[], raw: string): string {
    const m = /^var\(\s*(--[A-Za-z0-9_-]+)\s*\)$/.exec(raw.trim());
    if (m === null) return raw.trim();
    return cssVarOf(chain, RULES, m[1]) ?? raw.trim();
  }

  it('G-11a. 三列的水平中心 == `.net-grid` 盒中心（`padding-left == 2 × gap + 控制轨宽`）', () => {
    // ⚠️ **R9 收口（评审 I-1）**：三组代入值（100 / 200 / 1000）**全部**必须过 ——
    //    判据在推导上对**任意** `M` 都成立（`M` 被消掉），所以这里不是"多跑几组碰运气"，
    //    而是**反空集合**：若某条断言其实在比一个与 `M` 无关的恒真式，或把 `M` 算错，
    //    三组里至少一组会露馅。第一版只跑一组、且比的是"盒宽"（恒真），评审探针实测抓出。
    for (const laneWidth of [100, 200, 1000]) {
      const { lanes, boxCentre, boxWidth, M, P, G, R } = centerMath(laneWidth);
      // ① 中心相等（±0.5px：本解算器是浮点算术，判据是"几何上相等"而不是"位相等"）
      //    ⚠️ 左边是**三列中心**、右边是**盒中心**（`centerMath` 直接返回除过 2 的那个值）。
      expect(Math.abs(lanes - boxCentre), `[M=${laneWidth}] 三列中心（${lanes.toFixed(1)}）与网格盒中心`
        + `（${boxCentre.toFixed(1)}，盒宽 ${boxWidth.toFixed(1)}）差 ${(lanes - boxCentre).toFixed(1)}px ——`
        + `用户第三次反馈："控制器组件挤压了左边的游玩区组件的位置了，导致其位置并不是完全位于页面中心的"`)
        .toBeLessThanOrEqual(0.5);
      // ② 归中量本身：P == 2G + R（从样式表解出，不是抄数值）
      expect(P, `[M=${laneWidth}] padding-left（${P}）必须等于 2 × gap + 控制轨宽（${2 * G + R}）——`
        + '这是"三列中心 == 盒中心"的充要条件（推导见 centerMath 的注释）')
        .toBeCloseTo(2 * G + R, 2);
      expect(M, '三条轨道的内容宽必须是正数（解成 0 说明轨道值解错了）').toBeGreaterThan(0);
    }
    // ③ 反空集合：三条轨道是**内容宽**（不是 `1fr`）—— 否则 `fit-content` 会塌成整页宽，
    //    P 再对也没用（三列被拉宽到 1010px，与卡片的比例又脱钩了）
    const laneTracks = gridTracks(cssPropOf(grid(), [board(), grid()], RULES, 'grid-template-columns')!)
      .slice(0, 3);
    expect(laneTracks.filter((t) => /\d?fr\b/.test(t)), `前三条轨道不得是 \`1fr\` 族（实际 ${laneTracks.join(' | ')}）`)
      .toEqual([]);
    // ④ 控制轨仍是**第 4 条轨道、仍在右侧**（用户只要求"别把三列挤偏"，没要求挪走它）
    const tracks = gridTracks(cssPropOf(grid(), [board(), grid()], RULES, 'grid-template-columns')!);
    expect(resolveVar([board(), grid()], tracks[3]), '控制轨（第 4 条轨道）不再是 --net-rail-w 的固定宽')
      .toBe('160px');
  });

  it('G-11b. 三列仍是"三条线 + 控制轨"四个并排轨道，且 `.net-grid` 不再是 `width: 100%`（fit-content 才可能居中）', () => {
    const chain = [board(), grid()];
    const rawW = cssPropOf(grid(), chain, RULES, 'width');
    console.log(`\n===== G-11b · .net-grid 的 width = ${String(rawW)}`);
    // `width: 100%` 会让盒子撑满宿主 ⇒ `margin: 0 auto` 失效、`padding-left` 反而把内容整体右推。
    expect(rawW, '`width` 不是 `fit-content`（R9-1：链路框要贴合卡片、并在页面里居中）')
      .toBe('fit-content');
    // R7 的 `max-width: 1010px` 在内容宽下是死声明（内容恒小于它）—— 留着就是第二套真相
    const maxW = cssPropOf(grid(), chain, RULES, 'max-width');
    expect(maxW, '.net-grid 上仍留着 `max-width`（内容宽下它是死声明；R9-1 已删除）').toBeNull();
  });

  /**
   * **G-11c（R11-2 改写 · 评审 I-3 的收口）：`.net-board` 的**四列**模板是停靠栏的承重几何。**
   *
   * 评审当年实测的缺口：把 `.net-board { grid-template-columns: … }` 改回**单列** ⇒ 全仓全绿，
   * 而信息块会从"左侧紧凑盒子"变成**整行宽的大盒子**（只查 `grid-row` 的判据看不见列模板）。
   * R9-3 之后是双列、**R11-2/3 之后是四列**（对手那一块也搬进停靠栏）：
   *   `[自己信息块 max-content] [弹性 minmax(0,1fr)] [对手信息块 max-content] [对手手牌张数 max-content]`
   * 这条腿把"**恰好 4 条轨道 + 各自是内容宽族/弹性族**"钉住：
   *  · 第 1 / 3 / 4 条必须是**内容宽族**（`max-content` 等）⇒ 三块各自 = 它自己的内容宽
   *    （用户截图里那种紧凑盒子）；写死一个 px 会让宽度与内容脱钩；
   *  · 第 2 条必须是**弹性族**（`minmax(0, 1fr)`）⇒ 它吸收留白，把左右两组各贴一端
   *    （"对手信息块在该行右侧"的机制）。
   *  ⚠️ **不要**在这里断言"手牌从第 2 列起"：那会把整行手牌**右移 `c1/2`**（见 G-12a⑤ 的反例），
   *  与"手牌整页中置"直接冲突 —— R9 修复轮已经在这条上栽过一次。
   */
  it('G-11c. `.net-board` 的三列模板：三条内容宽轨道 + `justify-content: center`（R12-7）', () => {
    const b = board();
    const raw = subjectPropOf(b, [b], RULES, 'grid-template-columns');
    expect(raw, '`.net-board` 没有 grid-template-columns（R11-2 的列几何失去定义）').toBeTruthy();
    const tracks = gridTracks(raw!);
    console.log(`\n===== G-11c · .net-board 的列模板 = ${raw}\n  轨道 = ${tracks.join(' | ')}`);
    expect(tracks.length, `\`.net-board\` 必须恰好 **3 条**轨道（自己信息块 · 手牌 · 对手信息块），`
      + `实际 ${tracks.length} 条：${tracks.join(' | ')}`).toBe(3);
    // R12-7：**三条都必须是内容宽族**（没有留白轨道 —— 它就是"三块被推到两端、隔得太远"的成因）
    for (const i of [0, 1, 2]) {
      expect(/content/.test(tracks[i]), `第 ${i + 1} 条轨道必须是**内容宽族**（\`max-content\` 等），`
        + `实际 \`${tracks[i]}\``).toBe(true);
    }
    expect(tracks.filter((t) => /\d?fr\b/.test(t)), 'R12-7 之后**不许**再有弹性/留白轨道 —— '
      + '它会把左右两块推到页面两端（用户："现在隔着的距离太远了"）').toEqual([]);
    expect(subjectPropOf(b, [b], RULES, 'justify-content'), '停靠栏三块必须**整组居中**').toBe('center');
    // 反空集合：这四条轨道必须**真的**被停靠栏四块用上（否则模板对了也没人吃）
    const parts: ReadonlyArray<[StubNode, RegExp, string]> = [
      [(() => { const n = cssNode('net-info-block'); n.dataset.netSeat = 'self'; return n; })(),
        /^1(\s*\/\s*2)?$/, '自己信息块'],
      [(() => { const n = cssNode('net-info-block'); n.dataset.netSeat = 'foe'; return n; })(),
        /^3(\s*\/\s*4)?$/, '对手信息块'],
      // R12-7：对手手牌张数**与对手信息块同格**（压在块内的右下角），不再有自己的轨道
      [cssNode('net-hand-area', 'net-hand-area-foe'), /^3(\s*\/\s*4)?$/, '对手手牌张数'],
      [cssNode('net-hand-area', 'net-hand-area-self'), /^2(\s*\/\s*3)?$/, '自己手牌区'],
    ];
    for (const [node, want, what] of parts) {
      expect(subjectPropOf(node, [b, node], RULES, 'grid-column'),
        `${what}的 grid-column 与四列模板对不上（模板 ${tracks.join(' | ')}）`).toMatch(want);
    }
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
          // ① **同一行**（本守卫的核心：用户要的"纳入同一个组件"）
          expect(infoRow, `viewSeat=${seat} · ${side} 侧：信息块的 grid-row 没解出来（靠 DOM 顺序 = R8-5 之前的旧样）`)
            .toBeTruthy();
          expect(handRow, `viewSeat=${seat} · ${side} 侧：手牌区的 grid-row 没解出来`).toBeTruthy();
          expect(handRow, `viewSeat=${seat} · ${side} 侧：手牌区与信息块**不在同一行**`
            + `（信息块=${String(infoRow)}，手牌区=${String(handRow)}）—— R9-3 的裁决是"同一行、同一个盒子"；`
            + '各自一行 = 用户点名的"组件突出在外面、页面变得更长"').toBe(infoRow);
          // ② **列指派**（R11-2/3 建立、**R12-7 改写**）：自己信息块第 1 列、自己手牌第 2 列、
          //    对手信息块第 3 列；对手手牌张数与对手信息块**同格**（块内右下角）。
          //    **三块紧挨着**（用户第五次验收："现在隔着的距离太远了"）⇒ 没有留白轨道。
          if (side === 'self') {
            expect(colOf(info), `viewSeat=${seat}：自己信息块必须在**第 1 列**（左列），`
              + `实际 ${String(colOf(info))}`).toMatch(/^1(\s*\/\s*2)?$/);
            // R12-7：手牌在**第 2 列**、**夹在**左右两块之间
            expect(colOf(hand), `viewSeat=${seat}：自己手牌必须在**第 2 列**（自己信息块与对手信息块`
              + `之间 —— R12-7："三块紧挨着"），实际 ${String(colOf(hand))}`).toMatch(/^2(\s*\/\s*3)?$/);
          } else {
            expect(colOf(info), `viewSeat=${seat}：对手信息块必须在**第 3 列**（该行右侧 ——`
              + `用户第四次验收："摆在该行右侧"），实际 ${String(colOf(info))}`).toMatch(/^3(\s*\/\s*4)?$/);
            // R12-7：手牌张数与对手信息块**同格**（块内右下角），不再是独立的一列
            expect(colOf(hand), `viewSeat=${seat}：对手手牌张数必须与对手信息块**同格**（R12-7），`
              + `实际 ${String(colOf(hand))}`).toMatch(/^3(\s*\/\s*4)?$/);
          }
        }
        // ④ 两个座位都跑 + **两侧同一行**（停靠栏；R11-2 的裁决是"对手那一块搬进自己这一行"），
        //    而左右次序由列给出：自己信息块在左、对手信息块在右。
        const colStart = (n: StubNode): number => Number.parseInt(String(colOf(n)).split('/')[0].trim(), 10);
        expect(rowOf(infoOf('foe')), `viewSeat=${seat}：对手那一组与自己那一组必须**在停靠栏的同一行**`
          + '（R11-2："把对手信息块从顶部移进自己那一行"）').toBe(rowOf(infoOf('self')));
        expect(colStart(infoOf('self')), `viewSeat=${seat}：自己信息块必须在对手信息块的**左侧**`)
          .toBeLessThan(colStart(infoOf('foe')));

        /* ── ⑤ **几何腿**（R9-3 收口 · 评审 I-2；**R12-7 按用户第五次验收重写**）──
              旧判据：手牌 `1 / -1` ⇒ 区间 `[0, B]` ⇒ 中心 == 板中心（"整页中置"），
              代价是区间跨过信息块（可能水平重叠）。**R9 修复轮还在这里钉过一个反例**：
              `2 / -1` 的中心是 `(c1 + B)/2`，只在 `c1 == 0` 时才等于板中心
              （把恒等式 `B = c1 + (B − c1)` 当成"两个中心相等"是那轮的血泪）。
              **R12-7 的裁决改了这件事**：用户要"三块紧挨着"（"现在隔着的距离太远了"）⇒
              手牌不再横跨整行，而是**第 2 列**、夹在左右两块之间；**整组**用
              `justify-content: center` 居中。于是"整页中置"变成**近似**：
              手牌中心 = 板中心 + (自己块宽 − 对手块宽)/2 —— 两侧宽度接近时几乎仍在正中。
              ⚠️ 判据因此从"手牌区间 == 整行"换成"**没有留白轨道 + 整组居中 + 手牌夹在中间**"，
              并**保留**那条推导的结论：`2 / -1`（把左块并进手牌区间）会右移 `c1/2`。 */
        {
          const rawT = subjectPropOf(board, [board], RULES, 'grid-template-columns');
          const t = gridTracks(rawT ?? '');
          expect(t.length, `viewSeat=${seat}：.net-board 的列模板不是 3 条轨道（实际 ${String(rawT)}）`)
            .toBe(3);
          // ⑤-1 **没有留白轨道**（R12-7 的成因）：三条都是内容宽族
          for (const [i, track] of t.entries()) {
            expect(/content/.test(track), `第 ${i + 1} 条轨道是 \`${track}\` —— `
              + 'R12-7 之后不许有弹性/留白轨道（它会把左右两块推到页面两端）').toBe(true);
          }
          // ⑤-2 **整组居中**（三块紧挨着、作为一个整体居中）
          expect(subjectPropOf(board, [board], RULES, 'justify-content'),
            '停靠栏三块没有整组居中（`justify-content: center`）').toBe('center');
          // ⑤-3 三块的**列号**必须是 1/2/3（紧挨着；中间那一列就是手牌）
          expect(colOf(infoOf('self')), '自己信息块不在第 1 列').toMatch(/^1(\s*\/\s*2)?$/);
          expect(colOf(handOf('self')), '自己手牌不在第 2 列（它必须夹在左右两块之间）')
            .toMatch(/^2(\s*\/\s*3)?$/);
          expect(colOf(infoOf('foe')), '对手信息块不在第 3 列').toMatch(/^3(\s*\/\s*4)?$/);
          // ⑤-4 **保留下来的那条推导**：`2 / -1` 会把手牌区间扩到 `[c1, B]`、中心右移 `c1/2`
          //      （与"整块居中"冲突）—— 数值反例仍成立，防止有人用"看起来更整齐"的写法把它改回去。
          const B = 1000;
          const c1 = 400;
          expect((c1 + B) / 2, '`2 / -1` 的中心 != 板中心（这条推导仍是 R12-7 不许用它的理由）')
            .not.toBe(B / 2);
          console.log(`  viewSeat=${seat} · R12-7：三条内容宽轨道 [${t.join(' | ')}] + justify-content: center`
            + `（手牌在第 2 列；\`2 / -1\` 的中心 ${(c1 + B) / 2} ≠ 板中心 ${B / 2}）`);
        }
      }
    } finally {
      await drainRaf();
      restore();
    }
  });

  it('G-12c. 三行表完整：链路=1 · 工具条（仅开发者模式）=2 · **停靠栏=3**；日志不渲染（R12-1）', async () => {
    const restore = installStubDom();
    try {
      for (const seat of [0, 1] as const) {
        const root = renderFrame({ viewSeat: seat, turnPlayer: 0 });
        const board = findIn(root, 'net-board');
        const rows: string[] = [];
        for (const n of board.children) {
          const row = subjectPropOf(n, ancestorsOf(root, n), RULES, 'grid-row');
          const kind = isClass(n, 'net-grid') ? 'grid'
            : isClass(n, 'net-bottom') ? 'bottom(contents)'
              : isClass(n, 'log') ? 'log'
                : isClass(n, 'diag-btn') ? 'diag-btn(styles.css 的 fixed)'
                  : isClass(n, 'net-preview-bar') ? 'preview-bar(仅开发者模式)' : `?${n.cls}`;
          rows.push(`${kind}=${String(row)}`);
          // ① **每一个参与 grid 布局的直接子节点都必须有自己的 `grid-row`**（显式指派）
          //    ⚠️ R12-6 之后工具条**只在开发者模式解锁时**才渲染；它同样必须有行号 ——
          //    自动放置会产生"有/无工具条两种行表"（同一份样式表两种布局）。
          //    ⚠️ **导出按钮是例外**：它在 `styles.css` 里就是 `position: fixed`（不参与 grid 布局，
          //    落在 `#app` 的底部内边距里），所以它**没有**行号是正确的 —— 旧代码给它写的
          //    `grid-row: 2` 是死声明，R12-1 已删除。
          //    `display: contents` 的 `.net-bottom` 也不是 grid item（行号由它的子节点各带）。
          if (kind.startsWith('grid') || kind.startsWith('log')
            || kind.startsWith('preview-bar')) {
            expect(row, `viewSeat=${seat}：.${kind} 没有解出 grid-row —— 自动放置会让它随`
              + '"有没有其他自动放置项"漂到别的行上（同一份样式表两种行表）').toBeTruthy();
          }
        }
        console.log(`  viewSeat=${seat} · .net-board 直接子节点的 grid-row: ${rows.join(' | ')}`);
        // ② 行表**逐项**核对（链路 1 / 工具条 2 / 停靠栏由四块子节点占 3）
        const rowOfKind = (k: string): string => rows.find((r) => r.startsWith(`${k}=`))!.split('=')[1];
        expect(rowOfKind('grid'), `viewSeat=${seat}：链路区（.net-grid）必须在**第 1 行**`).toBe('1');
        // ── R12-1：事件日志块**不再渲染**（用户："取消日志的显示"）⇒ 它那 72px 归放牌区 ──
        expect(rows.filter((r) => r.startsWith('log=')).length,
          'viewSeat=' + seat + '：事件日志块又被渲染出来了 —— R12-1 取消了它的显示').toBe(0);
        // ③ 反空集合：这一帧里**真的**有导出按钮（它是"看日志"的唯一去处）
        expect(board.children.filter((n) => isClass(n, 'diag-btn')).length,
          `viewSeat=${seat}：这一帧里没有 .diag-btn`).toBe(1);
        // ④ **停靠栏在最后一行**：两块信息块 + 两块手牌区都解出第 3 行（`.net-bottom` 是
        //    contents ⇒ 它们才是 `.net-board` 的 grid item）。这一条与 G-13（net-dock）同源，
        //    这里只钉"行号真的是 3"，"四块同排 + 列指派"由 G-13 逐块查。
        for (const sel of ['net-info-block', 'net-hand-area'] as const) {
          const nodes = descendants(root).filter((n) => isClass(n, sel));
          expect(nodes.length, `viewSeat=${seat}：${sel} 的个数不是 2`).toBe(2);
          for (const n of nodes) {
            expect(subjectPropOf(n, ancestorsOf(root, n), RULES, 'grid-row'),
              `viewSeat=${seat}：${sel}（${String(n.dataset.netSeat ?? n.dataset.player)}）不在停靠栏那一行`).toBe('3');
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
