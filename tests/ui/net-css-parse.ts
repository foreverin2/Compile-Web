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
 */
export function cssRules(css: string): CssRule[] {
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
