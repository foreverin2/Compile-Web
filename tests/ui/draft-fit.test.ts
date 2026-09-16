import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  assertNoUnmodelableCascade, cssLenOf, cssPropOf, cssRules, cssVarOf, subjectPropOf, type CssRule,
} from './net-css-parse';
import { descendants, installStubDom, isClass, makeStubEl, type StubNode } from './net-dom-stub';
import { renderDraft, type UiCallbacks } from '../../src/ui/render';
import { createGame } from '../../src/core/state/create';
import { DEMO_PROTOCOLS } from '../../src/data/demo';

/**
 * **R20 草案页「一屏预算」守卫**（用户 2026-09-16 原话：
 * 「将协议选择页面中的展示框再缩小些，尽量使双方的协议选择框能够完整露出来，目前如图二中的
 *   第三个协议选择框的部分被遮住了，但是如果我往下滑的话那个被遮住的部分就能漏出来」）
 *
 * ## 症状是什么（为什么"把框改小一点"这种改法不可靠）
 *
 * 已选框（`.draft-picks`，一列 3 格）高 = 侧列宽 ÷ 1.4 × 3 + 文字；两块展示框
 * （`.draft-preview`，`position: fixed; bottom: 14px`）钉在屏幕左下/右下角。
 * 页面在参考视口下比一屏高 ⇒ 已选列**底端落到展示框的纵向区间里**，于是第三格被盖住；
 * 往下滚时 `position: sticky` 把整列往上顶，被盖的部分才露出来 —— 用户描述的现象**逐字**对应
 * 「已选列底 > 展示框顶」这一个不等式。所以本文件的**主判据**就是把这个不等式与
 * 「整页高 ≤ 视口高」解成像素来断言，而不是"看起来小了"。
 *
 * ## 四条腿（各自能红、且红的原因不同）
 *
 * 1. **预算腿**（本文件 §1）：用 `net-css-parse` 把 `src/ui/styles.css` 里草案页的每一条尺寸
 *    **解成像素**，按布局算术推出整页高与展示框位置，断言
 *    `整页 ≤ 视口` 且 `展示框顶 ≥ 已选列底`。**反空集合**：把旋钮代回改动前的 100px
 *    ⇒ 两条断言同时红（复现用户截图那一帧）。
 * 2. **唯一旋钮腿**（§2）：草案页的**每一条**尺寸都必须由 `--draft-u` 驱动
 *    （`calc(<倍率> * var(--draft-u))` 或它的整数倍），且注入改变该变量后解出的
 *    卡高/字号/间距**同比例变**；草案规则里不得出现与卡尺寸无关的裸 px
 *    （`0` / 边框宽 / 阴影模糊半径除外，逐条声明）。
 * 3. **不越界腿**（§3）：对局页（热座棋盘）的关键尺寸**逐字未变** —— 这是"红线只对本项解除"的机检。
 * 4. **结构腿**（§4）：真跑 `renderDraft`（`net-dom-stub` 的桩）断言三栏都在、池子每行 4 列、
 *    两块 `.draft-preview` 都在且**不在池子的 DOM 子树里**（它们是 body 级的）。
 *
 * ## 诚实边界（**读之前必须知道**）
 *
 * - **这不是布局引擎**：数字来自 `styles.css` 的**声明**，几何来自我在 §1 里逐条注明的
 *   布局算术（flex/grid 的行高 = max(子项)、`aspect-ratio` 反推高度、行数 × 行高 + 间距）。
 *   桩不解算 CSS，浏览器也不是本文件能跑的东西 ⇒ **"看起来是否真的好读"仍是人眼项**
 *   （缩小后中文是否可读、有没有溢出/截断 —— 见交付报告的人眼清单）。
 * - **本文件按参考视口 1720×822 断言**（用户截图尺寸，也是 1080p 下更紧的那一档）：
 *   1080p 常见浏览器内容高 ≈960 ⇒ 另有一条断言覆盖它。更矮的视口（≈768 及以下）**会**出现滚动条，
 *   这是"一屏"这个要求在算术上的边界，不是漏测。
 * - 全量池 = 45 套 = 12 行，任何**可读**的卡高下都是 ~1900px —— 12 行全露在 822px 里
 *   **算术上不可能**。所以池子被限高在自身滚动区内（`max-height` + `overflow-y:auto`），
 *   本文件把这件事**断言出来**（`§1` 的 poolBox 腿），而不是假装它不存在：
 *   整页永不滚动 = 用户要的"一屏"；池高 ≥ 3 行 = 随机池（12 套 = 3 行）整池可见、无内部滚动条。
 */

/* ══════════════════════ 读取与解析前提 ══════════════════════ */

const cssUrl = new URL('../../src/ui/styles.css', import.meta.url);
const uiUrl = new URL('../../src/ui/', import.meta.url);

/** ⚠️ 必须走"无参 `readFileSync` + `subarray` + `toString('utf8')`"这个形状：本仓库没有
 *  `@types/node`，`node:fs` 的 `readFileSync` 只有一条最小声明（返回 `{ subarray(…) }`），
 *  传 `'utf8'` 第二参会 `tsc` 报错（全仓 `tests/ui/*.test.ts` 同款）。 */
const readText = (u: URL): string =>
  readFileSync(fileURLToPath(u)).subarray(0, 8 * 1024 * 1024).toString('utf8');

const CSS = readText(cssUrl);
const RENDER_TS = readText(new URL('render.ts', uiUrl));

/** 草案页（含 body 级浮层）的规则族：`--draft-u` 只许被这一族引用。 */
const DRAFT_SELECTOR_RE = /\.draft-|\.turn-badge|\.turn-verb/;
const ALL_RULES: readonly CssRule[] = cssRules(CSS);

/**
 * 求解用的规则子集：草案族 + `:root`（旋钮声明在 `:root`）。
 *
 * **为什么必须筛掉其余规则**（这是本解析器已声明的诚实边界，不是取巧）：
 * `#app { padding: 12px 100px 110px; max-width: 2000px }` 是 **ID 选择器**，而
 * `compoundMatches` 只解析类 / 属性选择器 ⇒ `#app` 的简单选择器集合是**空集** ⇒ 它命中
 * **任何**节点；`specificityOf` 又给 `#` 记 1e6 ⇒ 任何 `padding` / `max-width` 解算都会被它吃掉
 * （`subjectPropOf` 更会直接抛错）。`#app` 的这两个值本身是**预算的边界**，由本文件
 * `readAppBox()` 从它的规则体里**逐字**读（并在 §3 冻结：本项不得改动它们）。
 */
const DRAFT_RULES: CssRule[] = ALL_RULES.filter(
  (r) => r.selector === ':root' || DRAFT_SELECTOR_RE.test(r.selector),
);

/** 解析器前提：筛完的表里不得有 `!important` / ID / 内联属性选择器，否则解算结果不可信。 */
assertNoUnmodelableCascade(DRAFT_RULES);

/** 整张表也自查一遍（草案族若被写成 `#id` 选择器，上面的筛选会把它筛掉 ⇒ 必须在此报红）。 */
assertNoUnmodelableCascade(ALL_RULES.filter((r) => DRAFT_SELECTOR_RE.test(r.selector)));

/** 解算用的祖先链（`var()` 只看自定义属性，`--draft-u` 声明在 `:root` ⇒ 任一链都能取到；
 *  这里仍给出真实形状，避免"链是空数组"这类假解算）。 */
function node(tag: string, cls = ''): StubNode {
  const n = makeStubEl(tag);
  if (cls !== '') n.classList.add(...cls.split(' '));
  return n;
}
const N_HTML = node('html');
const N_BODY = node('body');
const N_SCREEN = node('div', 'draft-screen');
const KNOB_CHAIN: StubNode[] = [N_HTML, N_BODY, N_SCREEN];

/* ══════════════════════ 取值原语 ══════════════════════ */

/** 一条规则的规则体（找不到 / 有多条都报红 —— "规则被改名/删掉"必须响亮）。 */
function bodyOf(rules: readonly CssRule[], selector: string): string {
  const hits = rules.filter((r) => r.selector === selector);
  expect(hits.length, `styles.css 里 ${selector} 恰好一条规则，实际 ${hits.length} 条`).toBe(1);
  return hits[0].body;
}

/** 规则体里某条声明的原文（与 `net-css-parse` 的 `cssPropOf` 同一套"属性名边界"口径）。
 *  找不到返回 `null`（调用方决定是报红还是"这条规则没有它"）。 */
function tryRawProp(body: string, prop: string): string | null {
  const m = new RegExp(`(?:^|;|\\s)${prop}\\s*:\\s*([^;]+)`).exec(body);
  return m === null ? null : m[1].trim();
}

function rawProp(body: string, prop: string): string {
  const v = tryRawProp(body, prop);
  expect(v, `规则体里没有可解析的 ${prop}：${body}`).not.toBeNull();
  return v as string;
}

/** 取"命中该选择器**且声明了 prop**"的那条规则体。
 *  同一选择器允许多条规则（`.turn-badge` 有一条基类 + 一条 `--pcol` 分色覆写）——
 *  用不到 prop 的那条不该参与，也不该让"恰好一条"的断言假红。 */
function bodyDeclaring(rules: readonly CssRule[], selector: string, prop: string): string {
  const hits = rules.filter((r) => r.selector === selector && tryRawProp(r.body, prop) !== null);
  expect(hits.length, `${selector} 里声明 ${prop} 的规则恰好一条，实际 ${hits.length} 条`).toBe(1);
  return hits[0].body;
}

/** `fn(...)` 的第一个参数（括号配平；`calc()` 里面有括号 ⇒ 不能用 `[^)]*` 抓）。 */
function parenArg(s: string, fn: string): string {
  const at = s.indexOf(`${fn}(`);
  expect(at, `${s} 里找不到 ${fn}(`).toBeGreaterThan(-1);
  let depth = 0;
  let out = '';
  for (let i = at + fn.length + 1; i < s.length; i += 1) {
    const ch = s[i];
    if (ch === '(') depth += 1;
    if (ch === ')') {
      if (depth === 0) break;
      depth -= 1;
    }
    out += ch;
  }
  return out;
}

/** 简写值按**顶层空格**切分（`calc(0.18 * var(--draft-u))` 里也有空格 ⇒ 不能 `split(' ')`）。 */
function splitValues(v: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of v.trim()) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
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

/** CSS 长度字面量 → 像素（解不出**直接报红**，不许当 0：那是"把量错了"伪装成"量到 0"）。 */
function px(rules: readonly CssRule[], value: string, chain: StubNode[] = KNOB_CHAIN): number {
  const n = cssLenOf(chain, [...rules], value);
  expect(n, `解不出像素（本文件的预算里每一项都必须是可解算的长度）：${value}`).not.toBeNull();
  return n as number;
}

/** 简写多值 → 像素数组。 */
function pxList(rules: readonly CssRule[], value: string): number[] {
  return splitValues(value).map((v) => px(rules, v));
}

/** `border` / `border-width` / `outline` 这类简写里第一个 `<n>px`（没有 = 0）。
 *  ⚠️ 边框宽**刻意不随旋钮缩放**（1px 边框在任何档位都该是 1px）⇒ 它是"唯一旋钮腿"里
 *  白名单允许的裸 px。 */
function borderPx(body: string, prop = 'border'): number {
  const m = rawProp(body, prop);
  const hit = /(\d+(?:\.\d+)?)px/.exec(m);
  return hit === null ? 0 : Number(hit[1]);
}

/** 规则里被钉住的 `line-height`（行盒高 = 字号 × 它；不钉死就没法把"行高"解成像素）。 */
function lineHeightOf(body: string, expected = 1.2): number {
  const v = rawProp(body, 'line-height');
  expect(v, '行高被钉成确定值，预算才解得出像素').toBe(String(expected));
  return expected;
}

/* ══════════════════════ 参考量（视口 / #app） ══════════════════════ */

/**
 * 参考视口 = 用户 2026-09-16 截图的窗口内容区（约 1720×822）。
 * 为什么取 822 而不是 1080：1080p 屏扣掉浏览器 chrome 的内容高约 900–960，
 * **822 是更紧的那一档** —— 预算必须在更紧的一档上成立。
 */
const VIEWPORT_W = 1720;
const VIEWPORT_H = 822;
/** 1080p 常见内容高（另跑一条，证明预算不是"只对 822 成立"）。 */
const VIEWPORT_H_1080 = 960;

/** `#app` 的盒：预算的上下边界（顶 padding + 底 padding）。**逐字读**，不写第二组魔数。 */
function readAppBox(): { padT: number; padX: number; padB: number; maxW: number; contentW: number } {
  const body = bodyOf(ALL_RULES, '#app');
  const p = splitValues(rawProp(body, 'padding')).map((v) => {
    const m = /^(\d+(?:\.\d+)?)px$/.exec(v);
    expect(m, `#app 的 padding 只允许 px 字面量（本文件按字面量读它）：${v}`).toBeTruthy();
    return Number(m![1]);
  });
  expect(p.length, '#app 的 padding 允许 3 值（顶 / 左右 / 底）').toBe(3);
  const maxW = /^(\d+(?:\.\d+)?)px$/.exec(rawProp(body, 'max-width'));
  expect(maxW, '#app 的 max-width 只允许 px 字面量').toBeTruthy();
  const contentW = Math.min(VIEWPORT_W, Number(maxW![1])) - 2 * p[1];
  return { padT: p[0], padX: p[1], padB: p[2], maxW: Number(maxW![1]), contentW };
}

const APP = readAppBox();

/* ══════════════════════ 结构常量（单源于 CSS / 渲染源） ══════════════════════ */

/** 池子每行几列：`.draft-pool { grid-template-columns: repeat(N, minmax(0, 1fr)) }`。 */
const POOL_COLS = ((): number => {
  const v = rawProp(bodyOf(DRAFT_RULES, '.draft-pool'), 'grid-template-columns');
  const m = /^repeat\(\s*(\d+)\s*,\s*minmax\(0,\s*1fr\)\s*\)$/.exec(v);
  expect(m, `.draft-pool 的列模板必须是 repeat(N, minmax(0, 1fr))，实际：${v}`).toBeTruthy();
  return Number(m![1]);
})();

/** 已选列每列几格：`renderPickColumn` 里的 `for (let i = 0; i < N; i++)`。 */
const PICK_SLOTS = ((): number => {
  const start = RENDER_TS.indexOf('function renderPickColumn(');
  expect(start, 'render.ts 里找不到 renderPickColumn').toBeGreaterThan(-1);
  const end = RENDER_TS.indexOf('\nfunction ', start + 1);
  const fn = RENDER_TS.slice(start, end < 0 ? undefined : end);
  const m = /for \(let i = 0; i < (\d+); i\+\+\)/.exec(fn);
  expect(m, 'renderPickColumn 里找不到"已选格子数"的循环').toBeTruthy();
  return Number(m![1]);
})();

/** 协议图容器的宽高比（`.draft-card-img-wrap` 与 `.draft-pick-card .pick-img-wrap` 必须同值）。 */
const ASPECT = ((): number => {
  const of = (sel: string): number => {
    const v = rawProp(bodyOf(DRAFT_RULES, sel), 'aspect-ratio');
    const m = /^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/.exec(v);
    expect(m, `${sel} 的 aspect-ratio 形状变了：${v}`).toBeTruthy();
    return Number(m![1]) / Number(m![2]);
  };
  const a = of('.draft-card-img-wrap');
  const b = of('.draft-pick-card .pick-img-wrap');
  expect(a, '池卡与已选卡的协议图比例必须相同（否则预算的两条链不是同一个几何）').toBe(b);
  return a;
})();

/** 全量池行数（DEMO_PROTOCOLS = 1/2/3 代全量）。 */
const POOL_ROWS_ALL = Math.ceil(DEMO_PROTOCOLS.length / POOL_COLS);

/** 随机池「整池可见」的参考行数：`main.ts` 的 `randomPoolFromSeed(seed, 12)`（**从源码读**，不写第二份）。 */
const POOL_ROWS_REF = ((): number => {
  const m = /randomPoolFromSeed\(seed,\s*(\d+)\)/.exec(readText(new URL('../main.ts', uiUrl)));
  expect(m, 'main.ts 里的随机池大小变了（本文件按它推"整池可见"的行数）').toBeTruthy();
  return Math.ceil(Number(m![1]) / POOL_COLS);
})();

/** 顶部提示条的最坏行数：随机池说明 + 禁用模式说明可以**同时**出现（`renderDraft` 里两段独立追加）。 */
const NOTE_LINES = 2;

/* ══════════════════════ §1 预算的布局算术 ══════════════════════ */

interface Fit {
  u: number;
  top: number;            // 从视口顶到「布局区顶」的距离（#app 顶 padding + 提示条 + 筛选条 + 说明行）
  header: number; filter: number; note: number;
  picks: number; pickCard: number; emptySlot: number; picksBottom: number;
  cell: number; rowH: number; cardImgH: number;
  nat3: number; natAll: number; poolCap: number; poolBox: number;
  layoutH: number; page: number;
  previewW: number; previewH: number; previewTop: number; previewBottom: number;
  poolLeft: number; layoutW: number; layoutMaxW: number;
}

/**
 * 把一张规则表**解成预算**。几何逐条注明出处（每一步的输入都来自 CSS 的某一条声明）：
 *
 * ```
 * 行盒高      = 字号 × line-height（行高在 CSS 里被钉成 1.2）
 * header     = 横幅(内边距×2 + max(横幅字号, 徽标字号+徽标内边距×2) + 边框×2) + 横幅 margin-bottom
 *              + header gap + max(进度字号×lh, 步点直径) + header margin-bottom
 * filter     = 上边距 + (chip 内边距×2 + chip 字号×lh + chip 边框×2) + 下边距
 * note       = 说明字号×lh + 上边距 + 下边距
 * 已选列     = 边框×2 + 内边距×2 + 标题行 + 列内 gap + Σ(3×满卡) + 2×列表 gap
 *   满卡     = 边框×2 + 内边距×2 + 图高 + 卡内 gap + 名字行 ，图高 = (列宽−边框×2−内边距×2−卡边框×2−卡内边距×2)/1.4
 *   空槽     = 列宽 / 1.4（aspect-ratio 1.4/1 撑满）
 * 三栏宽     = min(13.6u, #app 内容宽)；中列 = 总宽 − 2×侧列 − 2×列距
 * 池格宽     = (中列 − 池内边距×2 − (4−1)×池间距) / 4
 * 池卡高     = 边框×2 + 内边距×2 + 图高 + gap + 名字行 + gap + max(指令 min-height, 指令字号×1.5)
 * 池盒高     = min(全池自然高, max-height)      ← 限高 = 内部滚动，整页不滚
 * 布局高     = max(已选列高, 池盒高)
 * 整页高     = #app 顶 padding + header + filter + 说明行 + 布局高 + #app 底 padding
 * 展示框顶   = 视口高 − bottom − 展示框高
 * 池左缘     = #app 左 padding + (#app 内容宽 − 三栏宽)/2 + 侧列宽 + 列距
 * ```
 */
function fit(rules: readonly CssRule[], viewportH = VIEWPORT_H): Fit {
  const body = (sel: string): string => bodyOf(rules, sel);
  const u = px(rules, 'var(--draft-u)');
  const lh = 1.2;   // 下面每条相关声明的 line-height 都会被断言钉在 1.2

  // —— 顶部提示条 ——
  const banner = body('.draft-turn-banner');
  const bannerPadY = pxList(rules, rawProp(banner, 'padding'))[0];
  const bannerFs = px(rules, rawProp(banner, 'font-size'));
  const bannerLH = lineHeightOf(banner);
  const badge = bodyDeclaring(rules, '.turn-badge', 'padding');
  const badgePadY = pxList(rules, rawProp(badge, 'padding'))[0];
  const badgeFs = px(rules, rawProp(badge, 'font-size'));
  const badgeLH = lineHeightOf(badge);
  const bannerH = bannerPadY * 2
    + Math.max(bannerFs * bannerLH, badgeFs * badgeLH + badgePadY * 2)
    + borderPx(banner) * 2;

  const progress = body('.draft-progress');
  const progressFs = px(rules, rawProp(progress, 'font-size'));
  const progressLH = lineHeightOf(progress);
  const dot = body('.draft-step-dot');
  const dotW = px(rules, rawProp(dot, 'width'));
  const dotH = px(rules, rawProp(dot, 'height'));
  expect(dotW, '.draft-step-dot 不是正圆 ⇒ "步点直径"这个行高项不成立').toBeCloseTo(dotH, 6);

  const headerBody = body('.draft-header');
  const header = bannerH
    + px(rules, rawProp(banner, 'margin-bottom'))
    + px(rules, rawProp(headerBody, 'gap'))
    + Math.max(progressFs * progressLH, dotH)
    + px(rules, rawProp(headerBody, 'margin-bottom'));

  // —— 世代筛选条 ——
  const chip = body('.draft-filter-chip');
  const chipPadY = pxList(rules, rawProp(chip, 'padding'))[0];
  const chipFs = px(rules, rawProp(chip, 'font-size'));
  const chipLH = lineHeightOf(chip);
  const filterBody = body('.draft-filter');
  const filterMargin = pxList(rules, rawProp(filterBody, 'margin'));
  const filter = filterMargin[0] + chipPadY * 2 + chipFs * chipLH + borderPx(chip) * 2 + filterMargin[2];

  // —— 说明行（可选，最多 NOTE_LINES 行）——
  const noteBody = body('.draft-mode-note');
  const noteMargin = pxList(rules, rawProp(noteBody, 'margin'));
  const note = px(rules, rawProp(noteBody, 'font-size')) * lineHeightOf(noteBody)
    + noteMargin[0] + noteMargin[2];

  // —— 三栏几何 ——
  const layoutBody = body('.draft-layout');
  const cols = splitValues(rawProp(layoutBody, 'grid-template-columns'));
  expect(cols.length, '三栏 = 3 条轨道').toBe(3);
  expect(cols[1], '中列必须是可伸缩的 minmax(0, 1fr)').toBe('minmax(0, 1fr)');
  const sideW = px(rules, cols[0]);
  expect(px(rules, cols[2]), '左右两列必须同宽（否则两侧已选列的几何不同）').toBeCloseTo(sideW, 6);
  const layoutGap = px(rules, rawProp(layoutBody, 'gap'));
  const layoutMaxW = px(rules, rawProp(layoutBody, 'max-width'));
  const layoutW = Math.min(layoutMaxW, APP.contentW);

  // —— 已选列（3 格全满 = 最坏；空槽更矮，见 emptySlot）——
  const picksBody = body('.draft-picks');
  const picksBorder = borderPx(picksBody);
  const picksPad = pxList(rules, rawProp(picksBody, 'padding'))[0];
  const picksInner = sideW - picksBorder * 2 - picksPad * 2;
  const pickCardBody = body('.draft-pick-card');
  const pickBorder = borderPx(pickCardBody);
  const pickPad = pxList(rules, rawProp(pickCardBody, 'padding'))[0];
  const pickImgH = (picksInner - pickBorder * 2 - pickPad * 2) / ASPECT;
  const pickCard = pickBorder * 2 + pickPad * 2 + pickImgH
    + px(rules, rawProp(pickCardBody, 'gap'))
    + px(rules, rawProp(body('.draft-pick-name'), 'font-size')) * lineHeightOf(body('.draft-pick-name'));
  const emptySlot = picksInner / ASPECT;
  const picks = picksBorder * 2 + picksPad * 2
    + px(rules, rawProp(body('.draft-picks-title'), 'font-size')) * lineHeightOf(body('.draft-picks-title'))
    + px(rules, rawProp(picksBody, 'gap'))
    + PICK_SLOTS * pickCard
    + (PICK_SLOTS - 1) * px(rules, rawProp(body('.draft-picks-list'), 'gap'));

  // —— 协议池 ——
  const poolBody = body('.draft-pool');
  const poolPad = pxList(rules, rawProp(poolBody, 'padding'));
  expect(poolPad.length, '.draft-pool 的 padding 必须是 2 值（纵 / 横）').toBe(2);
  const [poolPadY, poolPadX] = poolPad;
  const poolGap = px(rules, rawProp(poolBody, 'gap'));
  const poolCap = px(rules, rawProp(poolBody, 'max-height'));
  const mid = layoutW - 2 * sideW - 2 * layoutGap;
  const poolInner = mid - poolPadX * 2;
  const cell = (poolInner - (POOL_COLS - 1) * poolGap) / POOL_COLS;

  const cardBody = body('.draft-card');
  const cardBorder = borderPx(cardBody);
  const cardPad = pxList(rules, rawProp(cardBody, 'padding'))[0];
  const cardGap = px(rules, rawProp(cardBody, 'gap'));
  const cardImgH = (cell - cardBorder * 2 - cardPad * 2) / ASPECT;
  const cmdsBody = body('.draft-card-commands');
  const cmdsLine = Math.max(
    px(rules, rawProp(cmdsBody, 'min-height')),
    px(rules, rawProp(cmdsBody, 'font-size')) * Number(rawProp(cmdsBody, 'line-height')),
  );
  const rowH = cardBorder * 2 + cardPad * 2 + cardImgH + cardGap
    + px(rules, rawProp(body('.draft-card-name'), 'font-size')) * lineHeightOf(body('.draft-card-name'))
    + cardGap + cmdsLine;
  const natural = (rows: number): number => rows * rowH + (rows - 1) * poolGap + poolPadY * 2;
  const poolBox = Math.min(natural(POOL_ROWS_ALL), poolCap);
  const layoutH = Math.max(picks, poolBox);

  const top = APP.padT + header + filter + NOTE_LINES * note;
  const page = top + layoutH + APP.padB;

  // —— 两块展示框（body 级 fixed：宽度 min(px,vw)、高度 min(vh,px)，只能是字面量）——
  const previewBody = body('.draft-preview');
  const pw = /^min\(\s*(\d+(?:\.\d+)?)px\s*,\s*(\d+(?:\.\d+)?)vw\s*\)$/.exec(rawProp(previewBody, 'width'));
  const ph = /^min\(\s*(\d+(?:\.\d+)?)vh\s*,\s*(\d+(?:\.\d+)?)px\s*\)$/.exec(rawProp(previewBody, 'height'));
  expect(pw, '.draft-preview 宽度不再是 `min(<px>, <vw>)`（R8-1 守卫与预算都按这个形状读它）').toBeTruthy();
  expect(ph, '.draft-preview 高度不再是 `min(<vh>, <px>)`（同上）').toBeTruthy();
  const previewW = Math.min(Number(pw![1]), (Number(pw![2]) / 100) * VIEWPORT_W);
  const previewH = Math.min((Number(ph![1]) / 100) * viewportH, Number(ph![2]));
  const previewBottom = px(rules, rawProp(previewBody, 'bottom'));
  const previewTop = viewportH - previewBottom - previewH;
  const poolLeft = APP.padX + (APP.contentW - layoutW) / 2 + (sideW + layoutGap);

  return {
    u, top, header, filter, note,
    picks, pickCard, emptySlot, picksBottom: top + picks,
    cell, rowH, cardImgH, nat3: natural(POOL_ROWS_REF), natAll: natural(POOL_ROWS_ALL),
    poolCap, poolBox, layoutH, page,
    previewW, previewH, previewTop, previewBottom, poolLeft, layoutW, layoutMaxW,
  };
}

const F = fit(DRAFT_RULES);

/** 打印一行预算（失败信息里也带上，便于"红在哪一项"一眼可见）。 */
const fmt = (f: Fit): string =>
  `u=${f.u} 顶到布局 ${f.top.toFixed(1)} = #app顶 ${APP.padT} + header ${f.header.toFixed(1)} + filter ${f.filter.toFixed(1)} + 说明×${NOTE_LINES} ${(NOTE_LINES * f.note).toFixed(1)}`
  + ` | 已选列 ${f.picks.toFixed(1)}(底 ${f.picksBottom.toFixed(1)}) 池卡 ${f.rowH.toFixed(1)}(格 ${f.cell.toFixed(1)} 图 ${f.cardImgH.toFixed(1)}) 池盒 ${f.poolBox.toFixed(1)}`
  + ` | 布局 ${f.layoutH.toFixed(1)} 整页 ${f.page.toFixed(1)} | 展示框 ${f.previewW.toFixed(0)}×${f.previewH.toFixed(0)} 顶 ${f.previewTop.toFixed(1)} 池左缘 ${f.poolLeft.toFixed(1)}`;

/* ══════════════════════ §1 预算腿（主判据） ══════════════════════ */

describe('R20 草案页一屏预算（CSS 解算）', () => {
  it('§0 前提：草案规则表可解算（无 !important / ID / 内联），且旋钮只有一个出处', () => {
    const declarations = DRAFT_RULES.filter(
      (r) => tryRawProp(r.body, '--draft-u') !== null,
    );
    expect(declarations.length, `--draft-u 必须只有一处声明，实际 ${declarations.length} 处`).toBe(1);
    expect(declarations[0].selector, '唯一旋钮声明在 :root（body 级浮层也要读到它）').toBe(':root');
    expect(cssVarOf(KNOB_CHAIN, [...DRAFT_RULES], '--draft-u')).toBe('76px');
  });

  it('§1a 整页高 ≤ 参考视口（822）：不出现整页滚动条', () => {
    expect(F.page, `${fmt(F)}\n⇒ 整页 ${F.page.toFixed(1)}px 超过参考视口 ${VIEWPORT_H}px`).toBeLessThanOrEqual(VIEWPORT_H);
  });

  it('§1b 两块展示框不遮已选列：展示框顶 ≥ 已选列底（用户报的"第三格被遮住"）', () => {
    expect(
      F.previewTop,
      `${fmt(F)}\n⇒ 展示框顶 ${F.previewTop.toFixed(1)} < 已选列底 ${F.picksBottom.toFixed(1)}：`
      + `第三格又被盖住 ${(F.picksBottom - F.previewTop).toFixed(1)}px`,
    ).toBeGreaterThanOrEqual(F.picksBottom);
  });

  it('§1c 两块展示框也不横向压到协议池：展示框右缘 < 池左缘', () => {
    expect(16 + F.previewW, `${fmt(F)}\n⇒ 展示框右缘 ${16 + F.previewW} ≥ 池左缘 ${F.poolLeft.toFixed(1)}`)
      .toBeLessThan(F.poolLeft);
  });

  it('§1d 池子限高 = 内部滚动（整页不滚的前提），且随机池整池可见', () => {
    // 全量池自然高必须**超过**限高（否则这条限高是装饰品，全量池仍会把整页顶长）
    expect(F.natAll, `${fmt(F)}\n⇒ 全量池自然高 ${F.natAll.toFixed(1)} 没超过限高 ${F.poolCap.toFixed(1)}：限高没起作用`)
      .toBeGreaterThan(F.poolCap);
    expect(F.poolBox, '池盒高 = min(自然高, max-height)').toBeCloseTo(F.poolCap, 6);
    // 限高必须容得下随机池（POOL_ROWS_REF 行）—— 否则"随机池整池可见"就是空话
    expect(F.nat3, `${fmt(F)}\n⇒ 随机池（${POOL_ROWS_REF} 行）自然高 ${F.nat3.toFixed(1)} > 池盒 ${F.poolBox.toFixed(1)}：随机池会被内部滚动条截断`)
      .toBeLessThanOrEqual(F.poolBox);
    // 池盒必须**≥ 已选列高**（即预算里被顶满的是池子）：否则"一屏"约束的不是池子，
    // 而池子会随行数把整页重新顶长（限高就白加了）
    expect(F.poolBox, `池盒 ${F.poolBox.toFixed(1)} < 已选列 ${F.picks.toFixed(1)}：被顶满的不是池子`)
      .toBeGreaterThanOrEqual(F.picks);
    expect(F.layoutH, '布局高 = max(已选列, 池盒)').toBeCloseTo(F.poolBox, 6);
  });

  it('§1e 预算在 1080p 常见内容高（960）下同样成立', () => {
    const hi = fit(DRAFT_RULES, VIEWPORT_H_1080);
    expect(hi.page, `${fmt(hi)}\n⇒ 960px 下整页 ${hi.page.toFixed(1)} 仍然超`).toBeLessThanOrEqual(VIEWPORT_H_1080);
    expect(hi.previewTop, `${fmt(hi)}\n⇒ 960px 下展示框顶 ${hi.previewTop.toFixed(1)} < 已选列底 ${hi.picksBottom.toFixed(1)}`)
      .toBeGreaterThanOrEqual(hi.picksBottom);
  });

  it('§1f 前提：参考视口下三栏真的取 max-width（而不是被 #app 内容宽截断）', () => {
    expect(F.layoutMaxW, `${fmt(F)}\n⇒ 三栏总宽 ${F.layoutMaxW} 被 #app 内容宽 ${APP.contentW} 截断：预算里的池卡高会小于实际值`)
      .toBeLessThanOrEqual(APP.contentW);
    expect(F.layoutW, '三栏宽 = max-width').toBeCloseTo(F.layoutMaxW, 6);
  });

  it('§1g **反空集合**：把旋钮代回改动前的 100px ⇒ 预算腿与展示框腿同时红（复现用户那一帧）', () => {
    const before = CSS.replace(':root { --draft-u: 76px; }', ':root { --draft-u: 100px; }');
    expect(before, '旋钮那一行没被替换到 —— 本腿会变成废断言').not.toBe(CSS);
    const rulesBefore = cssRules(before).filter(
      (r) => r.selector === ':root' || DRAFT_SELECTOR_RE.test(r.selector),
    );
    const b = fit(rulesBefore);
    expect(b.u, '注入后的旋钮值没解出来').toBeCloseTo(100, 6);
    expect(b.page, `改前：整页 ${b.page.toFixed(1)} 竟然没超 ${VIEWPORT_H}？那预算腿在量什么`)
      .toBeGreaterThan(VIEWPORT_H);
    expect(b.previewTop, `改前：展示框顶 ${b.previewTop.toFixed(1)} 竟然没盖住已选列底 ${b.picksBottom.toFixed(1)}？`)
      .toBeLessThan(b.picksBottom);
    // 改动前的字号确实是"改前那一套"（13 / 11 / 12 / 15 …）——证明注入的是一整套旧档位
    expect(px(rulesBefore, rawProp(bodyOf(rulesBefore, '.draft-card-name'), 'font-size'))).toBeCloseTo(13, 6);
    expect(px(rulesBefore, rawProp(bodyOf(rulesBefore, '.draft-hint'), 'font-size'))).toBeCloseTo(15, 6);
  });
});

/* ══════════════════════ §2 唯一旋钮腿 ══════════════════════ */

/** 草案规则里**允许**的裸 px（逐条给理由，而不是"扫到就放行"）。 */
const BARE_PX_ALLOW = {
  props: /^(border|border-[a-z-]+|outline|outline-[a-z-]+|box-shadow|text-shadow|filter|content)$/,
  selectors: /^\.draft-preview|^\.draft-score-chip/,
};

/**
 * 扫草案规则里的"非旋钮裸 px"（返回违规描述；空 = 合格）。
 *
 * 口径（写死在这里，改口径必须改这条注释）：
 *  - `calc(... * var(--draft-u))` 里的东西**不算**裸 px（它就是旋钮驱动的形态）；
 *  - 属性属于**边框 / 轮廓 / 阴影 / 滤镜**的一律放行 —— 它们要么是 1px 边框这类说明性尺寸，
 *    要么完全不参与布局（阴影模糊半径）。**理由**：边框宽不随档位缩放是对的（1px 就是 1px），
 *    而把它们也算进"随旋钮缩放"会把唯一旋钮变成"连阴影都要缩放"的荒谬要求。
 *  - `.draft-preview*` / `.draft-score-chip` 整族放行：展示框是 **body 级浮层**，
 *    且它的 width/height 被 `draft-preview-size.test.ts`（R8-1）**钉成字面量数字形态**
 *    （正则要求 `min(` 后紧跟数字 ⇒ 写成 `calc(var())` 会让 R8-1 假红）。
 *    代价由 §1b 反向承担：框高写大一点，展示框腿就红。
 */
function bareDraftPx(cssText: string): string[] {
  const bad: string[] = [];
  for (const r of cssRules(cssText)) {
    if (!DRAFT_SELECTOR_RE.test(r.selector)) continue;
    if (BARE_PX_ALLOW.selectors.test(r.selector)) continue;
    // ⚠️ `stripComments` 保留注释起止的两个字符（`/*`…`*/`）⇒ 规则体开头可能挂着它们，
    //    必须像 `cssRules` 清洗选择器那样先清掉，否则属性名会变成 `/* … */ border` 而漏判。
    for (const decl of r.body.replace(/\/\*|\*\//g, ' ').split(';')) {
      const i = decl.indexOf(':');
      if (i < 0) continue;
      const prop = decl.slice(0, i).trim().toLowerCase();
      if (prop.startsWith('--') || BARE_PX_ALLOW.props.test(prop)) continue;
      const value = decl.slice(i + 1);
      const stripped = value.replace(/calc\((?:[^()]|\([^()]*\))*\)/g, (s) =>
        (s.includes('var(--draft-u)') ? ' KNOB ' : s));
      const hits = [...stripped.matchAll(/-?\d*\.?\d+px/g)].map((m) => m[0]);
      if (hits.length > 0) bad.push(`${r.selector} | ${prop}: ${value.trim()} ⇒ 裸 ${hits.join(',')}`);
    }
  }
  return bad;
}

describe('R20 唯一旋钮腿', () => {
  it('§2a 草案规则里没有"非旋钮裸 px"（0 / 边框 / 阴影 / 展示框族除外）', () => {
    expect(bareDraftPx(CSS), '草案页出现了脱离 --draft-u 的裸 px 尺寸').toEqual([]);
  });

  it('§2b 注入改变旋钮 ⇒ 卡高 / 字号 / 间距**同比例**变', () => {
    // 旋钮 76 → 95（×1.25）。**为什么不直接翻倍**：翻倍后 13.6u = 2067px > #app 内容宽 1520px，
    // 三栏宽会被 `min()` 截断 ⇒ 池格宽不再与 u 成正比（那是视口约束，不是"旋钮没驱动它"）。
    // 下面第一条断言就是这个前提本身（`layoutW === layoutMaxW`），免得日后调大旋钮让本腿静默失真。
    const KN = 95;
    const mutated = CSS.replace(':root { --draft-u: 76px; }', `:root { --draft-u: ${KN}px; }`);
    expect(mutated, '旋钮那一行没被替换到').not.toBe(CSS);
    const rules2 = cssRules(mutated).filter((r) => r.selector === ':root' || DRAFT_SELECTOR_RE.test(r.selector));
    const F2 = fit(rules2, VIEWPORT_H * 2);       // 视口放宽：这条腿只问"尺寸是否等比"，不问"还装不装得下"
    const ratio = F2.u / F.u;
    expect(ratio, '注入的旋钮没生效').toBeCloseTo(KN / 76, 6);
    expect(F2.layoutW, '三栏宽被 #app 内容宽截断了 ⇒ 本腿的"等比"前提不成立')
      .toBeCloseTo(F2.layoutMaxW, 6);

    // (1) **纯旋钮量**（整条链上没有任何 1px 量）：必须**精确**成比例
    const pure: Array<[string, number, number]> = [
      ['池格宽', F.cell, F2.cell],
      ['说明行', F.note, F2.note],
      ['池盒高（=限高）', F.poolBox, F2.poolBox],
      ['三栏总宽', F.layoutMaxW, F2.layoutMaxW],
    ];
    for (const [name, a, b] of pure) {
      expect(b, `${name}：${a.toFixed(2)} → ${b.toFixed(2)}，不是 ×${ratio}`).toBeCloseTo(a * ratio, 6);
    }

    // (2) 含**不随旋钮缩放**的 1px/2px 边框的量：它们是 u 的**仿射**函数（A·u + F）⇒
    //     同比例断言只能留容差。容差有明确上界：列表里最大的固定项是顶部横幅的两条 2px 边框
    //     （F = 4px），比例偏差 = F × (ratio − 1) = 1.0px。**这不是"放水"** ——
    //     第 1 组已经用零容差钉住了"旋钮真的驱动了每一条尺寸"，这一组只是承认边框不缩放。
    const affine: Array<[string, number, number]> = [
      ['池卡高', F.rowH, F2.rowH],
      ['池卡图高', F.cardImgH, F2.cardImgH],
      ['已选列高', F.picks, F2.picks],
      ['已选卡高', F.pickCard, F2.pickCard],
      ['顶部提示条', F.header, F2.header],
      ['筛选条', F.filter, F2.filter],
    ];
    const FIXED_MAX = borderPx(bodyOf(DRAFT_RULES, '.draft-turn-banner')) * 2;
    const tol = FIXED_MAX * (ratio - 1) + 1e-6;
    for (const [name, a, b] of affine) {
      const drift = Math.abs(b - a * ratio);
      expect(drift, `${name}：${a.toFixed(2)} → ${b.toFixed(2)}，偏离 ×${ratio} 达 ${drift.toFixed(3)}px（容差 ${tol.toFixed(3)}）`)
        .toBeLessThanOrEqual(tol);
    }

    // 字号：逐条比对（这些是"缩了卡却忘了缩字"最容易漏的地方）
    const fontSel = ['.draft-card-name', '.draft-card-commands', '.draft-pick-name', '.draft-picks-title', '.draft-hint', '.draft-filter-chip'];
    for (const sel of fontSel) {
      const a = px(DRAFT_RULES, rawProp(bodyOf(DRAFT_RULES, sel), 'font-size'));
      const b = px(rules2, rawProp(bodyOf(rules2, sel), 'font-size'));
      expect(b, `${sel} 的 font-size 没随旋钮变（${a} → ${b}）`).toBeCloseTo(a * ratio, 6);
    }
    // 展示框整族不随旋钮（在 §2a 的注释里声明了原因）——这里把"例外是**有意**的"钉住
    expect(px(rules2, rawProp(bodyOf(rules2, '.draft-preview'), 'bottom')))
      .toBeCloseTo(px(DRAFT_RULES, rawProp(bodyOf(DRAFT_RULES, '.draft-preview'), 'bottom')), 6);
  });

  it('§2c 池子的限高与内部滚动是**独立于行数**的（整页高不随池子内容变长）', () => {
    const poolBody = bodyOf(DRAFT_RULES, '.draft-pool');
    expect(rawProp(poolBody, 'overflow-y'), '池子必须自己滚，否则整页会随 12 行长起来').toBe('auto');
    // `overflow` 一旦不是 visible，悬停上浮就会被自己裁掉 —— 上下内边距必须 > 上浮 + 缩放外溢
    const padY = pxList(DRAFT_RULES, rawProp(poolBody, 'padding'))[0];
    const hover = rawProp(bodyOf(DRAFT_RULES, '.draft-card:not(.picked):hover'), 'transform');
    const hoverUp = -1 * px(DRAFT_RULES, parenArg(hover, 'translateY'));
    const scaleOverflow = F.rowH * 0.05 / 2;
    expect(padY, `池子上下内边距 ${padY.toFixed(1)} 不够容纳悬停上浮 ${hoverUp.toFixed(1)} + 缩放外溢 ${scaleOverflow.toFixed(1)}`)
      .toBeGreaterThan(hoverUp + scaleOverflow);
  });
});

/* ══════════════════════ §3 不越界腿（红线机检） ══════════════════════ */

/**
 * 对局页（热座棋盘）的**冻结尺寸** —— 逐字取自本次改动前的 `styles.css`。
 * 本项只解除"草案相关规则"的红线：任何一条变了都是越界（哪怕看起来"顺手也要缩一下"）。
 */
const BOARD_FROZEN: ReadonlyArray<readonly [string, string, string]> = [
  ['#app', 'padding', '12px 100px 110px'],
  ['#app', 'max-width', '2000px'],
  ['.board', 'gap', '10px'],
  ['.player-strip', 'grid-template-columns', '1fr minmax(380px, 1.4fr) 1fr'],
  ['.lane-row', 'grid-template-columns', 'minmax(660px, 1fr) auto auto minmax(660px, 1fr)'],
  ['.stack-slot', 'min-height', '220px'],
  ['.stack', '--card-h', '175px'],
  ['.stack', '--card-w', 'calc((var(--card-h) - 2px) * 0.71429 + 2px)'],
  ['.card', 'width', '130px'],
  ['.card', 'padding', '3px'],
  ['.hand', 'min-height', '178.8px'],
  ['.hand .card + .card', 'margin-left', '-28px'],
  ['.control-module', 'padding', '10px'],
  ['.control-module', 'gap', '6px'],
  ['.control-track', 'height', '84px'],
  ['.control-track-label', 'font-size', '13px'],
];

/** 冻结表 → 漂移清单（空 = 逐字未变）。
 *  ⚠️ 同一选择器允许多条规则（`.stack` 有一条 `display:flex` + 一条 `--card-h`）；
 *  这里只认"声明了该属性"的那一条，找不到/多条都报红。 */
function boardDrift(cssText: string): string[] {
  const rules = cssRules(cssText);
  const out: string[] = [];
  for (const [sel, prop, want] of BOARD_FROZEN) {
    const hits = rules.filter((r) => r.selector === sel && tryRawProp(r.body, prop) !== null);
    if (hits.length !== 1) { out.push(`${sel} { ${prop} } 的规则数 = ${hits.length}（应当 1）`); continue; }
    const value = rawProp(hits[0].body, prop).replace(/\s+/g, ' ');
    if (value !== want) out.push(`${sel} { ${prop}: ${value} } ≠ 冻结值 ${want}`);
  }
  return out;
}

/** 关键帧步骤（`from` / `to` / `N%`）与 `@` 规则不是元素级声明 —— 与
 *  `net-css-parse` 的 `unmodelableCascadeRules` 同一套跳过口径。 */
const isKeyframeStep = (selector: string): boolean =>
  selector.startsWith('@') || /^(?:from|to|\d+(?:\.\d+)?%)$/.test(selector.trim());

describe('R20 不越界腿：对局页尺寸逐字未变', () => {
  it('§3a 热座棋盘的关键尺寸与改动前逐字相同', () => {
    expect(boardDrift(CSS), '这次改动动到了对局页的尺寸（红线）').toEqual([]);
  });

  it('§3b 草案旋钮没有泄漏到对局页规则里', () => {
    const users = ALL_RULES.filter((r) => r.body.includes('var(--draft-u)'));
    const leaked = users.filter(
      (r) => r.selector !== ':root' && !DRAFT_SELECTOR_RE.test(r.selector) && !isKeyframeStep(r.selector),
    );
    expect(leaked.map((r) => r.selector), '有非草案规则引用了 --draft-u').toEqual([]);
    expect(users.length, '没有任何规则引用旋钮 —— 那 §2 的等比腿在量什么').toBeGreaterThan(10);
  });

  it('§3c 对局页没有被顺手塞进草案的限高/滚动', () => {
    for (const sel of ['.board', '.hand', '.stack', '.lane-row']) {
      const bodies = ALL_RULES.filter((r) => r.selector === sel).map((r) => r.body).join(' ');
      expect(bodies.length, `${sel} 规则找不到`).toBeGreaterThan(0);
      expect(bodies.includes('--draft-u'), `${sel} 引用了草案旋钮`).toBe(false);
      expect(/overflow(-y)?\s*:\s*(auto|scroll)/.test(bodies), `${sel} 被塞进了滚动条`).toBe(false);
    }
  });
});

/* ══════════════════════ §4 结构腿（真跑 renderDraft） ══════════════════════ */

/** 桩 `document.body`（每个用例先装一次 `installStubDom()`）。 */
const stubBody = (): StubNode => (globalThis as unknown as { document: { body: StubNode } }).document.body;

const withClass = (root: StubNode, cls: string): StubNode[] =>
  descendants(root).filter((n) => isClass(n, cls));

const noopCb: UiCallbacks = {
  onAction: () => { /* 桩：本腿只看结构 */ },
  onDraftPick: () => { /* 桩 */ },
  onDraftBan: () => { /* 桩 */ },
  onDraftUnpick: () => { /* 桩 */ },
};

describe('R20 结构腿：草案页 DOM 契约（真跑 renderDraft）', () => {
  it('§4a 三栏都在 · 池子每行 4 列 · 已选列各 3 格', () => {
    const restore = installStubDom();
    try {
      const root = makeStubEl('div');
      renderDraft(root as unknown as HTMLElement, createGame({ seed: 'draft-fit' }), noopCb);
      // 三栏：左已选 / 池 / 右已选
      expect(withClass(root, 'draft-side').length, '左右两块 .draft-side').toBe(2);
      expect(withClass(root, 'draft-picks').length, '左右两条已选列').toBe(2);
      const pool = withClass(root, 'draft-pool');
      expect(pool.length, '中间恰好一个协议池').toBe(1);
      // 每行 4 列：列模板在 CSS 里（POOL_COLS），DOM 侧断言"池子里全是 .draft-card、数量 = 池内协议数"
      const cards = withClass(pool[0], 'draft-card');
      expect(cards.length, '全量池（45 套）应当渲染 45 张池卡').toBe(DEMO_PROTOCOLS.length);
      for (const c of cards) expect(withClass(c, 'draft-card-img-wrap').length).toBe(1);
      expect(POOL_COLS, '池子每行 4 列').toBe(4);
      // 已选列每列 3 格
      for (const col of withClass(root, 'draft-picks')) {
        expect(withClass(col, 'draft-pick-empty').length, `已选列应当有 ${PICK_SLOTS} 个空槽`).toBe(PICK_SLOTS);
      }
      expect(PICK_SLOTS).toBe(3);
    } finally {
      restore();
    }
  });

  it('§4b 两块 .draft-preview 都在、都挂在 body 上、且**不在**池子的 DOM 子树里', () => {
    const restore = installStubDom();
    try {
      const root = makeStubEl('div');
      renderDraft(root as unknown as HTMLElement, createGame({ seed: 'draft-fit' }), noopCb);
      const previews = withClass(stubBody(), 'draft-preview');
      expect(previews.length, 'body 级恰好两块展示框（P1 / P2）').toBe(2);
      expect(previews.filter((p) => isClass(p, 'p1')).length, 'P1 展示框').toBe(1);
      expect(previews.filter((p) => isClass(p, 'p2')).length, 'P2 展示框').toBe(1);
      // ⚠️ 这两条是"它们会不会被池子的 overflow 裁掉 / 被整页滚动带走"的机检：
      //     body 级 fixed 是它们的语义（G2 Task 4 · I-1：改成流内元素会重演"挡点击/被裁"）。
      const pool = withClass(root, 'draft-pool')[0];
      for (const p of previews) {
        expect(descendants(pool).includes(p), '.draft-preview 不许出现在池子的 DOM 子树里').toBe(false);
        expect(withClass(root, 'draft-preview').includes(p), '.draft-preview 不许出现在草案页子树里（它是 body 级）').toBe(false);
      }
      expect(isClass(previews[0].parentElement as StubNode, 'body')
        || previews[0].parentElement === stubBody(), '.draft-preview 的直接父节点是 body').toBe(true);
    } finally {
      restore();
    }
  });

  it('§4c 池子的限高/滚动写在 .draft-pool 自己身上（解算腿，与 DOM 结构互证）', () => {
    const pool = node('div', 'draft-pool');
    const chain = [N_HTML, N_BODY, N_SCREEN, node('div', 'draft-layout'), pool];
    expect(cssPropOf(pool, chain, [...DRAFT_RULES], 'overflow-y')).toBe('auto');
    const capRaw = subjectPropOf(pool, chain, [...DRAFT_RULES], 'max-height');
    expect(capRaw, '.draft-pool 的 max-height 必须是"旋钮的整数倍"形态')
      .toMatch(/^calc\(\d+(?:\.\d+)? \* var\(--draft-u\)\)$/);
    // 主体绑定解算 == 规则体逐字读（两条独立路径解同一个值 ⇒ 谁被改歪都会红）
    expect(capRaw).toBe(rawProp(bodyOf(DRAFT_RULES, '.draft-pool'), 'max-height'));
    expect(px(DRAFT_RULES, capRaw as string)).toBeCloseTo(F.poolCap, 6);
    expect(cssLenOf(chain, [...DRAFT_RULES], 'var(--draft-u)')).toBe(76);
  });
});

/* ══════════════════════ §5 变异实测（证明四条腿真的会红） ══════════════════════ */

describe('R20 变异实测：四条腿各自能红', () => {
  it('§5a 尺寸退回改动前（旋钮 76 → 100）⇒ 预算腿红', () => {
    const mutated = CSS.replace(':root { --draft-u: 76px; }', ':root { --draft-u: 100px; }');
    const m = fit(cssRules(mutated).filter((r) => r.selector === ':root' || DRAFT_SELECTOR_RE.test(r.selector)));
    expect(m.page).toBeGreaterThan(VIEWPORT_H);
    expect(m.previewTop).toBeLessThan(m.picksBottom);
  });

  it('§5b 某条尺寸写成裸 px（脱离旋钮）⇒ 唯一旋钮腿红', () => {
    // 只改一处：池卡名字字号 0.13×u → 10px
    const mutated = CSS.replace('font-size: calc(0.13 * var(--draft-u)); line-height: 1.2; color: #eef;', 'font-size: 10px; line-height: 1.2; color: #eef;');
    expect(mutated, '变异没落到 .draft-card-name 上（那一行被改过？）').not.toBe(CSS);
    const bad = bareDraftPx(mutated);
    expect(bad.length, '裸 px 变异没被抓到').toBeGreaterThan(0);
    expect(bad.join(' ')).toContain('.draft-card-name');
  });

  it('§5c 顺手改到对局页尺寸 ⇒ 不越界腿红', () => {
    const mutated = CSS.replace('.stack { --card-h: 175px;', '.stack { --card-h: 160px;');
    expect(mutated, '变异没落到 .stack 的 --card-h 上').not.toBe(CSS);
    const drift = boardDrift(mutated);
    expect(drift.length, '对局页尺寸漂移没被抓到').toBeGreaterThan(0);
    expect(drift.join(' ')).toContain('--card-h');
  });

  it('§5d 把展示框调大 ⇒ 展示框腿红（"只缩卡不缩框"正是用户报的那一类）', () => {
    // 两条轴一起放大：`min(30vh, 224px)` → `min(34vh, 300px)`（@822 时 30vh=246.6 < 224? 不：
    // min 取小者，30vh=246.6 > 224 ⇒ 生效项是 224；放大到 34vh=279.5 才真正把框撑高）。
    const mutated = CSS.replace('height: min(30vh, 224px);', 'height: min(34vh, 300px);');
    expect(mutated, '变异没落到 .draft-preview 的 height 上').not.toBe(CSS);
    const m = fit(cssRules(mutated).filter((r) => r.selector === ':root' || DRAFT_SELECTOR_RE.test(r.selector)));
    expect(m.previewH, '变异后的框高没变大').toBeGreaterThan(F.previewH);
    expect(m.previewTop, '框调大之后仍然不遮已选列？那展示框腿是废的').toBeLessThan(m.picksBottom);
  });
});
