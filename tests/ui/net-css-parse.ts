/**
 * **样式表的最小级联解析器**（G2 修正 **R8-5** 从 `net-lane-tree.test.ts` 抽出，**一份实现**）。
 *
 * 为什么必须抽出（而不是在新测试里再写一份）：项目的**既有教训**写在本文件旁边 ——
 * `./net-dom-stub` 的头注说得很清楚："桩一旦被复制成两份，**两份就会漂移** —— 而漂移的表现恰好是
 * '一个文件里的行为断言绿、另一个红'（或更糟：两边都用同一份**错的**桩，于是谁都不红）"。
 * R8-5 的 G-7 要按**同一套**解析器把"视觉行序"解出来；复制一份解析器就会立刻制造第二条真相
 * （两边的 `specificityOf` / `selectorMatches` 语义一旦分叉，同一个样式表在两个文件里会解出
 * 不同的结果，而两边都"绿"）。⇒ 抽出成共享模块，两边 import 同一份实现。
 *
 * ⚠️ 本文件**不是** `*.test.ts`，不会被 vitest 当测试收集（`vite.config.ts` 的 include 是
 * `tests/**\/*.test.ts`）；它只被测试 import。
 *
 * ## 能力与边界（诚实声明 —— 下面每个函数都只做它字面说的事）
 *
 * - **解析**：`选择器 { 体 }` 的平铺列表（`cssRules`）。**不递归** `@media` 之类的条件块 ——
 *   实际效果是：`@media` 的**前导**被当成无效文本跳过，而它**内部**的规则会被当成**无条件规则**
 *   混进规则表（⚠️ 这一点与 `net-lane-tree.test.ts` 里"整块被跳过"的旧说法**不符**，实测见该文件
 *   R6-4 的更正说明）。因此**样式表里不许再出现任何条件块**（R8-5 已把唯一的 `@media` 删掉）。
 * - **匹配**：`compoundMatches` 支持类 / 属性选择器（`data-*` 映射到 `dataset` 驼峰键）；
 *   `selectorMatches` 把后代组合器与 `>` 一视同仁（本组选择器的类集合下等价）。
 * - **权重**：类数 + 属性数 + ID 数 × 1e6。**不建模** `!important` / 内联样式 ——
 *   需要它们的场合必须由调用方**先声明不可建模**（见 `net-lane-tree.test.ts` 的
 *   `assertModelableCascade` / `cssPropOfSubject`），而不是让它们悄悄按普通声明参与排序。
 * - **不模拟布局**：解出来的是"哪条声明生效"，不是像素。观感仍只能人眼。
 */

import type { StubNode } from './net-dom-stub';
import { stripComments } from './source-text';

export interface CssRule { selector: string; body: string; no: number }

/**
 * 去注释后的 `选择器 { 体 }` 列表。
 *
 * ⚠️ `stripComments` **保留注释起止的两个字符**（`/*`…`*​/` 只把中间内容换成空白，见
 * `./source-text` 的说明）—— 于是紧跟在一条规则**行尾注释**之后的规则，选择器会带上
 * `/* *​/` 前缀。这里必须把它当空白清掉，否则 `.net-lane-band .stack-slot.p2 .battery`
 * 会匹配不上（`net-lane-tree.test.ts` 第一版就是这样漏掉一条规则的）。
 *
 * ## ⚠️⚠️ R25 修正：条件块（`@media`）的**体**必须**整块跳过**
 *
 * **旧行为为什么必须改**：旧实现是"选择器 = 第一个 `{` 之前的全部文本"，于是 `@media (max-width: …)`
 * 的**前导**被当成无效文本跳掉、而它**内部**的规则被当成**无条件规则**混进这张平铺表
 * （本文件头注原来就写着这件事，并靠"样式表里不许有条件块"来回避）。
 * `styles.css` 里**本来就有**两个 `@media (max-width: 1100px)`（图鉴页的 `.library-*`，
 * 与棋盘无关，所以一直没出事）；**R25 在 `styles.css` 里新增了三个窄屏媒体查询**
 * （`.stack { --card-h }` / `.lane-row { grid-template-columns }`）—— 它们内部声明的
 * `--card-h: 150px` 一旦被当成无条件规则，`cssPropOf(.stack, '--card-h')` 就会解出 **150**，
 * 于是**所有**在无条件表上解 `.stack` 旋钮的断言都会静默变成"窄屏档"的值（假绿/假红都来了）。
 *
 * **新行为**：按**花括号配对**扫描；遇到 `@media` / `@supports` / `@container` / `@layer`
 * 这类条件块时，**跳过整块**（连同它的体），只把**顶层**的 `选择器 { 体 }` 收进表里。
 * ⚠️ 这是**收窄输入面**的改动，不是放宽判据：对"本来就没有条件块"的样式表逐字节等价
 * （`styles-net.css` 由 R6-4 正面守卫保证没有条件块；实测它的规则数与新旧实现一致），
 * 对新增的条件块则从"污染规则表"变成"**看不见**"—— 需要读媒体块内部声明的守卫必须
 * **自己把块体抠出来单独解**（见 `conditionalBlocks`，`tests/ui/hotseat-narrow-fallback.test.ts` 用它）。
 *
 * ⚠️ 能力边界（没变）：**不递归**条件块的**嵌套**内容（对 `@media` 里的 `@media`/`@keyframes`
 * 只会把整块跳掉）；也不模拟布局。 */
export function cssRules(css: string): CssRule[] {
  const out: CssRule[] = [];
  const src = stripComments(css);
  let i = 0;
  let no = 0;
  while (i < src.length) {
    const open = src.indexOf('{', i);
    if (open < 0) break;
    const selectorRaw = src.slice(i, open);
    // 花括号配对求本块体的结束位置（体内可能还有 `{}`，例如 @keyframes 的步骤）
    let depth = 1;
    let j = open + 1;
    while (j < src.length && depth > 0) {
      if (src[j] === '{') depth += 1;
      else if (src[j] === '}') depth -= 1;
      j += 1;
    }
    const body = src.slice(open + 1, depth === 0 ? j - 1 : src.length);
    const selector = selectorRaw.replace(/\/\*|\*\//g, ' ').trim().replace(/\s+/g, ' ');
    // 条件块：**整块跳过**（含体）—— 块内的规则不得混进这张无条件表
    const isConditional = /^@(media|supports|container|layer)\b/.test(selector)
      || (selector === '' && /^\s*@/.test(selectorRaw));   // 前导被吞掉时的兜底
    if (!isConditional) out.push({ selector, body, no: no++ });
    i = j;
  }
  return out;
}

/** 一个条件块的**体**（R25 新增）：`{ atRule: '@media (max-width: 1969px)', body: '…' }`。
 *  `cssRules` 会把条件块整块跳过 ⇒ **想解媒体查询里的声明就必须用它**（一份实现，别处不要另写正则）。 */
export interface CssConditionalBlock { atRule: string; body: string }

/** 抠出**顶层**条件块（`@media` / `@supports` / `@container` / `@layer`）及其体，按源序返回。 */
export function conditionalBlocks(css: string): CssConditionalBlock[] {
  const src = stripComments(css);
  const out: CssConditionalBlock[] = [];
  const re = /@(media|supports|container|layer)\b([^{]*)\{/g;
  for (let m = re.exec(src); m !== null; m = re.exec(src)) {
    const open = m.index + m[0].length - 1;
    let depth = 1;
    let j = open + 1;
    while (j < src.length && depth > 0) {
      if (src[j] === '{') depth += 1;
      else if (src[j] === '}') depth -= 1;
      j += 1;
    }
    out.push({ atRule: `@${m[1]}${m[2]}`.replace(/\s+/g, ' ').trim(), body: src.slice(open + 1, j - 1) });
    re.lastIndex = j;
  }
  return out;
}

const classesOf = (n: StubNode): string[] => n.cls.split(/\s+/).filter(Boolean);

/** 一个**复合选择器**（不含空格）是否命中该节点：只支持类与属性选择器（本组规则只用这两类）。 */
export function compoundMatches(part: string, node: StubNode): boolean {
  const simple = part.replace(/::?[a-zA-Z-]+(\([^)]*\))?/g, '');   // 去掉伪类（本组规则没有伪类，稳妥起见）
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

/** `chain` = 祖先链（含自身），后代组合器语义（`>` 一视同仁 —— 本组规则的类集合下等价）。 */
export function selectorMatches(selector: string, chain: StubNode[]): boolean {
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

/** 简易权重：类数 + 属性数 + **ID 数 × 1e6**（本组的选择器只有前两类；ID 那一项只为
 *  "**不让 `#x` 被算成 0**" —— 评审实测：加 `#x .battery-overflow { position: absolute }`
 *  在旧模型下权重 = 0、被当成"没命中"，守卫全绿，而浏览器里它是赢家、C-1 原样复现）。
 *
 *  ## 等价条件（**必须知道它什么时候不等价**）
 *  这套模型等价于浏览器级联的前提是：选择器只由**类与属性**组成、**无 ID**、**无 `!important`**、
 *  **无内联样式**，且被解算的属性**不可继承**。逐条：
 *  · **ID**：CSS 的真实权重是 (ID, 类/属性, 类型)，一个 ID 压过任意多类 —— 这里用 1e6 近似那一条；
 *  · **`!important` / 内联样式**：本模型**不建模**。`cssPropOfSubject` 里的
 *    `assertModelableCascade` 会把这两种形态**直接报错**，而不是让它们悄悄按普通声明参与排序
 *    （悄悄算错的后果正是 C-1 那一族"守卫全绿、浏览器里真的生效"）；
 *  · **可继承属性**：本模型只解"元素**自己**命中的声明"，不回溯父级计算值。本组只用它解
 *    `position` / `transform` / `order` / `flex` / `min-width` / `display` / `flex-direction` /
 *    `animation-name` / `grid-row` / `grid-column` / `align-self` / `justify-items` —— 全是**非继承**
 *    属性，故在本组用法上充分。
 *  ⚠️ 不要拿它判可继承属性（`color` / `font-size` / …），也不要拿它判含 ID/`!important`/内联的样式表。 */
export function specificityOf(selector: string): number {
  const parts = selector.split(/\s+/).filter((p) => p.length > 0 && p !== '>');
  let n = 0;
  for (const p of parts) {
    n += (p.match(/\.[A-Za-z0-9_-]+/g) ?? []).length;
    n += (p.match(/\[[a-z-]+/g) ?? []).length;
    n += 1e6 * (p.match(/#[A-Za-z_-][\w-]*/g) ?? []).length;
  }
  return n;
}

/** 该节点（在 `chain` 这一条祖先链下）生效的**任意属性**值：权重优先、同权重取**源序靠后**者。
 *
 *  `order` 那一份（`cssOrderOf`）是它的前身；R6 需要 `grid-column`、R8-5 需要 `grid-row` ——
 *  与 `order` **完全同一个**解算规则（权重 + 源序），所以它是通用版（一处实现，不会漂移）。
 *  返回 `null` = 没有规则命中（用**声明的缺省值**，不要猜）。 */
export function cssPropOf(
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
export function cssOrderOf(node: StubNode, chain: StubNode[], rules: CssRule[]): number {
  const raw = cssPropOf(node, chain, rules, 'order');
  return raw === null ? 0 : Number.parseInt(raw, 10);
}

/* ============================================================================
 * **主体绑定**解算（G2 修正 **R11-2** 从两个消费方上提到这里，**一份实现**）
 *
 * 为什么必须上提：`cssPropOf` 的 `selectorMatches` 允许主体绑到链上的**任意祖先** ——
 * 它回答"这条规则对这个节点生效吗"，而**不**回答"这条规则说的是**这个节点**吗"。
 * 对"谁在第几行/第几列"这类判据，后者才是要问的：例如 `.net-bottom { display: contents }`
 * 会被解成 `.net-info-block`（孙子）的 `display`，于是展平器把信息块的子节点当成 grid item。
 * ⇒ 这类判据必须用 `subjectPropOf`（只认"把 `node` 当**选择器主体**"的规则）。
 *
 * ⚠️ 上提之前它是**两份拷贝**（`net-board-grid.test.ts` 与 `net-r9.test.ts` 各自的局部函数），
 * 与本文件头注的教训完全同形：拷贝会漂移，而漂移的表现是"一个文件绿、另一个红"。
 *
 * ⚠️ **`net-lane-tree.test.ts` 的 `cssPropOfSubject` 故意不并入这里**：它是**更强**的变体 ——
 * 解算前先对整条祖先链跑一遍 `assertModelableCascade`（连"没声明该属性的规则"也查）。
 * 这里保留的是`subjectPropOf` 的原始形态（只在**命中且声明了该属性**的那条规则上拒绝
 * `!important` / ID / 内联），供两个消费方使用；**全表扫描**那一条由各文件自己的
 * `assertNoUnmodelableCascade` 调用承担（见本文件下半部分）。
 * ========================================================================== */

/**
 * 一条规则是否把 `node` 当作**选择器主体**（最后一段复合选择器）命中 —— 选择器组逐段判。
 *
 * ⚠️ 与 `cssPropOf` 的差别只有这一点：主体必须落在 `node` 上，而不是链上的任意祖先。
 */
export function ruleHitsAsSubject(rule: CssRule, node: StubNode, chain: StubNode[]): boolean {
  return rule.selector.split(',').some((segRaw) => {
    const seg = segRaw.trim();
    if (seg === '') return false;
    const parts = seg.split(/\s+/).filter(Boolean);
    return compoundMatches(parts[parts.length - 1], node) && selectorMatches(seg, chain);
  });
}

/**
 * **主体绑定解算**：权重优先、同权重取源序靠后，但只认"把 `node` 当**选择器主体**"的规则。
 *
 * ## 等价条件（不满足就会算错，必须显式禁掉而不是猜）
 * 只建模"**纯类/属性选择器 + 权重 + 源序**"。命中规则里出现 `!important` / ID(`#`) /
 * `[style…]` 时**直接抛错**（浏览器里它们会压过普通声明、或与桩没有的 id 相关，本模型无法表达）。
 * 本组解算的属性（`display` / `grid-row` / `grid-column` / `align-self` / `position` /
 * `transform` / `grid-template-columns` / `grid-template-rows` / `overflow-y` / `height` …）
 * **全部非继承**，故不需要回溯父级计算值。
 */
export function subjectPropOf(
  node: StubNode, chain: StubNode[], rules: CssRule[], prop: string,
): string | null {
  let best: { spec: number; no: number; raw: string } | null = null;
  const re = new RegExp(`(?:^|;|\\s)${prop}\\s*:\\s*([^;]+)`);
  for (const r of rules) {
    const m = re.exec(r.body);
    if (!m) continue;
    if (!ruleHitsAsSubject(r, node, chain)) continue;
    if (/!important/i.test(m[1]) || /#[\w-]/.test(r.selector) || /\[style\b/.test(r.selector)) {
      throw new Error(`[主体绑定解算] 规则 \`${r.selector}\` 用 \`!important\` / ID / 内联属性覆盖 \`${prop}\`，`
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
 * 解析器**前提**的全局守卫（G2 修正 **R8-5 · I-1** 从 `net-lane-tree.test.ts` 的 G-5c④ 提到这里）
 *
 * 本解析器只建模"**纯类/属性选择器 + 权重 + 源序**"。`!important` / ID 选择器 / 内联样式属性选择器
 * 这三类形态在浏览器里会**压过**普通声明、在本模型里却是**隐形**的 —— 那正是 C-1 那族
 * "守卫全绿、页面照错"的成因。所以任何拿本解析器做承重判据的地方都必须先把这条**前提**钉住。
 *
 * ⚠️ 为什么必须是"**全表扫描**"而不是"解算到某条规则时才检查"（I-1 的实质）：
 * 解算式保护只在**本次真的解算到那条规则**时才会抛错，而漏进来的形态恰恰是**权重更大、
 * 会覆盖掉我们解算结果**的那一类 —— 它与"本次解算的属性"可能**根本不同**。
 * 评审实测的具体后果：`#x .net-board{display:flex}` 在"只解算 `grid-row`"的调用路径上完全隐形
 * （`net-board-grid.test.ts` 第一版 6 条全绿）。⇒ 只有把规则表**整体**扫一遍才对。
 * ========================================================================== */

/**
 * **本仓守卫解算过的属性清单（并集）** —— 两个消费方（`net-lane-tree.test.ts` / `net-board-grid.test.ts`）
 * 实际用 `cssPropOf` / `cssPropOfSubject` / `subjectPropOf` 解算过的属性，加上同族的定位/布局属性：
 *
 *  · 列内层序与底部行：`order` / `display` / `grid-row` / `grid-column` / `grid-template-columns`
 *  · 能量槽与溢出数字：`position` / `transform` / `flex` / `min-width` / `top` / `bottom` / `left` / `right`
 *  · 链路预留与增长：`min-height` / `flex-direction` / `justify-content` / `height`
 *  · 手牌与信息块中置：`justify-items` / `justify-self` / `align-items` / `align-self` / `text-align`
 *  · 尺寸与间距：`width` / `max-width` / `gap`
 *  · 扫描流光：`animation-name`
 *
 * ⚠️ **`z-index` 刻意不在表内**：`styles-net.css` 里有一条**既有且有意**的
 * `.net-lane-band .stack .card:hover { z-index: 60 !important }`（R1 的卡悬停压过邻卡）。
 * 把它列进来会让**当前这棵干净的树**立刻报红，而它并不参与本仓任何解算。
 * 代价（**如实记录**）：一条"用**类选择器**写 `z-index: … !important`"的注入不会被这条腿抓到
 * （但任何带 `#` / `[style]` 的选择器**照抓** —— 选择器那两条腿与属性无关）。
 */
export const MODELED_PROPS: readonly string[] = [
  'position', 'transform', 'top', 'bottom', 'left', 'right',
  'display', 'order', 'flex', 'flex-direction', 'flex-basis', 'gap',
  'min-width', 'min-height', 'max-width', 'width', 'height',
  'grid-row', 'grid-column', 'grid-template-columns', 'grid-template-rows',
  'justify-content', 'justify-items', 'justify-self',
  'align-items', 'align-self', 'text-align', 'animation-name',
];

/**
 * **全表扫描**：命中属性清单上的 `!important` / 选择器里含 ID(`#`) / 选择器读内联样式(`[style…]`)
 * 的规则（**与本次解算的属性无关** —— 见上面 I-1 的说明）。
 *
 * 关键帧步骤（`from` / `to` / `N%`）与 `@` 规则**不是元素级声明**，不参与级联 ⇒ 跳过
 * （否则 `@keyframes` 里的 `from { … }` 会被解析成"空类选择器"从而命中一切，这是
 * `net-lane-tree.test.ts` 的 G-5c① 实测过的假红来源；调用方传 `REAL_RULES` 也好、传裸 `RULES`
 * 也好，本函数自己都跳过它们）。
 */
export function unmodelableCascadeRules(rules: readonly CssRule[], props: readonly string[]): CssRule[] {
  const re = new RegExp(`(?:^|;|\\s)(?:${props.join('|')})\\s*:[^;]*!important`, 'i');
  return rules.filter((r) => {
    const sel = r.selector.trim();
    if (sel.startsWith('@') || /^(?:from|to|\d+(?:\.\d+)?%)$/.test(sel)) return false;
    return re.test(r.body) || /#[\w-]/.test(r.selector) || /\[style\b|\bstyle\s*=/.test(r.selector);
  });
}

/**
 * 同上，但**抛错**（失败信息里逐条点名选择器 + 形态 + 本组解算的属性清单）。
 *
 * 两个消费方都调它（**同一份实现**，避免"两份前提守卫漂移"）：
 * `net-lane-tree.test.ts` 的 G-5c④（传 `REAL_RULES` = 已剔关键帧的规则表）与
 * `net-board-grid.test.ts` 的 G-7c（传裸 `RULES`）。两者都用共享的 `MODELED_PROPS`。
 */
export function assertNoUnmodelableCascade(rules: readonly CssRule[], props: readonly string[] = MODELED_PROPS): void {
  const bad = unmodelableCascadeRules(rules, props);
  if (bad.length === 0) return;
  const why = (r: CssRule): string => {
    const m = new RegExp(`(?:^|;|\\s)(?:${props.join('|')})\\s*:[^;]*!important`, 'i').exec(r.body);
    if (m) return `属性带 \`!important\`（${m[0].trim().replace(/^[;\s]+/, '')}）`;
    if (/#[\w-]/.test(r.selector)) return '选择器含 **ID**（`#…`）';
    return '选择器在读**内联样式**（`[style…]`）';
  };
  throw new Error(`[R8-5 · I-1 解析器前提守卫] 命中：${bad.map((r) => r.selector).join(' | ')}\n`
    + bad.map((r) => `  · ${r.selector} —— ${why(r)}`).join('\n')
    + `\nstyles-net.css 里出现了本解析器**不建模**的层叠形态（\`!important\` / ID / 内联样式）：`
    + `它们会压过类选择器、却在守卫里**隐形**（C-1 那族"守卫全绿、页面照错"）。`
    + `\n必须先人工处理（改成明确的类选择器），而不是让守卫猜。`
    + `\n（本腿是**全表扫描**，属性清单 = ${props.join(' / ')}；`
    + `带 \`#\` / \`[style]\` 的选择器与属性无关，一律报红。）`);
}

/* ============================================================================
 * **CSS 长度字面量的解算器**（G2 修正 **R9-1** 从 `net-lane-tree.test.ts` 上提到这里）
 *
 * 为什么要提上来（而不是在新测试里再写一份）：与 `cssRules` / `subjectPropOf` **同一条理由**
 * （见本文件头注）—— 复制一份就会漂移，而漂移的表现是"一个文件里的解算结果绿、另一个红"。
 * R9-1 的 G-10 要在**另一个文件**（`net-r9.test.ts`）里解 `.stack` 的 `min-height` 与
 * `.protocol-holder` 的宽高，用到的正是 R8-3 的 G-3 在 `net-lane-tree.test.ts` 里已经写过的
 * 那套算式（`calc` 的 `+/-` 与 `*`、`var()` 取值、`px` / 无单位数）—— 两处必须是**同一份**。
 *
 * ## 能力与边界（诚实声明 —— 这是"够用就好"的极简解算，不是 CSS 引擎）
 *  - 支持：`<n>px`、无单位数、`var(--x)`（沿祖先链找**最后一个**声明它的节点，即自定义属性的
 *    继承语义）、`calc(...)`（**只**支持 `+` / `-` 连接的项、每项是 `*` 连接、括号可嵌套）；
 *  - **不支持**：`%`、`em`、`min()/max()/clamp()`、`fr`、`/`、负号开头的项、`calc` 里的乘除混排
 *    （`a * b / c`）。解不出来**返回 `null`**（调用方必须把它当"解不出"处理，不许当成 0）。
 *  - 它只回答"这个声明在**这个祖先链**下算出多少像素"，不模拟布局、不回答观感。
 * ========================================================================== */

/** 该节点（或它任一祖先）声明的**自定义属性**值（`var()` 解算用）。
 *  从链尾往链首找**第一个**有声明的节点（自定义属性是继承的 ⇒ 最近的那个祖先胜出）。 */
export function cssVarOf(chain: StubNode[], rules: CssRule[], name: string): string | null {
  for (let i = chain.length - 1; i >= 0; i -= 1) {
    const raw = cssPropOf(chain[i], chain.slice(0, i + 1), rules, name);
    if (raw === null) continue;
    const v = raw.trim();
    // ⚠️ **R10-2：CSS 全局关键字要按浏览器语义处理，不能当成普通值返回。**
    //    背景：`styles-net.css` 在 `.net-lane-band .stack` 上写 `--card-h: inherit` —— 那是为了用
    //    (0,2,0) 压过 `styles.css` 声明在 `.stack` **元素自己身上**的 `--card-h: 175px`
    //    （自定义属性只在该元素没有声明时才继承 ⇒ 放在祖先上的值赢不了它）。
    //    ⇒ 解算器遇 `inherit` / `unset`（自定义属性默认继承）必须**继续往祖先找**；
    //      `initial` / `revert` ⇒ 保证无效值，链上再也找不到（返回 null）。
    //    不这么写，G-3 / G-10a 会以"min-height 解不出像素值"假红（R10-2 实测踩到）。
    if (v === 'inherit' || v === 'unset') continue;
    if (v === 'initial' || v === 'revert') return null;
    return v;
  }
  return null;
}

/** `var(--x)` / 普通值 → 解算后的字面量；解不出来就**原样返回**（让断言报出真实值，别报 `undefined`）。 */
export function resolveCssValue(chain: StubNode[], rules: CssRule[], raw: string): string {
  const m = /^var\(\s*(--[A-Za-z0-9_-]+)\s*\)$/.exec(raw.trim());
  if (m === null) return raw.trim();
  return cssVarOf(chain, rules, m[1]) ?? raw.trim();
}

/** 解算一个 CSS 长度字面量 → 像素数（只支持上面那几种写法；解不出来返回 null）。
 *  ⚠️ **R9-1 补上"首项带负号"**（`calc(0.462 * var(--card-w) - var(--card-h))` 解出来是**负**的，
 *  而 R8-3 的 `min-height` 恒为正 —— 旧写法把 `-` 当分隔符，首项的负号会**丢掉**，
 *  于是竖排重叠会被解成 **+93.5**（符号反了，而任何"≈ 数值"的断言都会静默通过一半）。
 *  现在首字符是 `-` 时按负项处理。 */
export function cssLenOf(chain: StubNode[], rules: CssRule[], raw: string, depth = 0): number | null {
  if (depth > 8) return null;
  const v = raw.trim();
  const px = /^(\d+(?:\.\d+)?)px$/.exec(v);
  if (px) return Number.parseFloat(px[1]);
  const negPx = /^-(\d+(?:\.\d+)?)px$/.exec(v);
  if (negPx) return -Number.parseFloat(negPx[1]);
  // ⚠️ **裸 `0` 是长度**（`padding-left: 0` / `margin: 0`）—— R9-1 起必须解成 **0**，
  //    否则"把归中量写成 0"这类变异会以"解不出"的形式报错，读起来像解析器崩了而不是像判据红了。
  if (v === '0') return 0;
  const vari = /^var\(\s*(--[A-Za-z0-9_-]+)\s*\)$/.exec(v);
  if (vari) {
    const rawVar = cssVarOf(chain, rules, vari[1]);
    return rawVar === null ? null : cssLenOf(chain, rules, rawVar, depth + 1);
  }
  const calc = /^calc\(([\s\S]*)\)$/.exec(v);
  if (calc) return calcOf(chain, rules, calc[1], depth + 1);
  return null;
}

/** `calc` 体：只支持 `+` / `-` 连接的项（本页的 `--card-w` / 7 张跨度 / 竖排重叠都是这种形状）。 */
function calcOf(chain: StubNode[], rules: CssRule[], body: string, depth: number): number | null {
  const parts: Array<{ sign: number; text: string }> = [];
  let cur = '';
  let sign = 1;
  let depthP = 0;
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    if (ch === '(') depthP += 1;
    if (ch === ')') depthP -= 1;
    // 首项的负号属于**项本身**（`calc(-3px + 2px)`）：cur 还空着时把它收进项里，不当分隔符
    if (depthP === 0 && (ch === '+' || (ch === '-' && cur.trim() !== ''))) {
      parts.push({ sign, text: cur.trim() });
      sign = ch === '-' ? -1 : 1;
      cur = '';
      continue;
    }
    cur += ch;
  }
  if (cur.trim() !== '') parts.push({ sign, text: cur.trim() });
  if (parts.length === 0) return null;
  let total = 0;
  for (const p of parts) {
    const n = productOf(chain, rules, p.text, depth);
    if (n === null) return null;
    total += p.sign * n;
  }
  return total;
}

/** `*` 连接的项（每项可以是 px / var / 无单位的数 / 嵌套括号；**支持首字符负号**）。 */
function productOf(chain: StubNode[], rules: CssRule[], text: string, depth: number): number | null {
  let s = text.trim();
  let sign = 1;
  if (s.startsWith('-')) { sign = -1; s = s.slice(1).trim(); }
  else if (s.startsWith('+')) { s = s.slice(1).trim(); }
  const factors = s.split('*').map((f) => f.trim()).filter((f) => f !== '');
  if (factors.length === 0) return null;
  let acc = 1;
  for (const f of factors) {
    const unitless = /^\d+(?:\.\d+)?$/.exec(f);
    if (unitless) { acc *= Number.parseFloat(unitless[0]); continue; }
    const inner = /^\(([\s\S]*)\)$/.exec(f);
    const n = inner ? calcOf(chain, rules, inner[1], depth + 1) : cssLenOf(chain, rules, f, depth + 1);
    if (n === null) return null;
    acc *= n;
  }
  return sign * acc;
}
