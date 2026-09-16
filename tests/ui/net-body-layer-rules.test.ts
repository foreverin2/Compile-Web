import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { NET_PAGE_CLASS } from '../../src/ui/render-net';
import { makeStubEl, isClass, type StubNode } from './net-dom-stub';
import {
  cssLenOf, cssRules, cssVarOf, resolveCssValue, ruleHitsAsSubject, specificityOf, subjectPropOf,
  type CssRule,
} from './net-css-parse';
import { functionBody, stripComments } from './source-text';

/**
 * **body 级浮层的远程页规则守卫**（G2 修正 **R18**）。
 *
 * ## 一族缺陷（四条，全部同源）
 *
 * 远程页有大量特效层**不挂在 `.net-board` 子树里**，而是 `document.body.appendChild`
 * （`position: fixed`）。**CSS 无法"按后代选祖先"** ⇒ 凡拿 `.net-board` 当祖先的选择器
 * **恒不命中**。本仓已有一条正确范式：`render-net.ts` 给 `document.body` 加页标记类
 * `net-page`（`NET_PAGE_CLASS`，`:265` 定义 / `:1793` 加 / `:935` 摘），于是 body 级浮层的
 * 远程页规则写成 **`body.net-page …`**（见 `styles-net.css` 的 `.net-page .compiled-fx`）。
 *
 * | # | 被守的东西 | 修前 | 机制 |
 * | --- | --- | --- | --- |
 * | **A** | 控制权易主 FX 的三条方向覆盖（`.g3ctrl-link` / `.g3ctrl-link.break` / `.g3ctrl-mini-chip`） | `.net-board …`（恒不命中 ⇒ **静默回落到横版 keyframes**） | CSS 解算腿（两条链各解一次）+ 关键帧消费 `--ty` 的源码腿 + 产出方挂 body 的源码腿 |
 * | **B** | `.net-hands .hand.reversed .card + .card` 死规则 | 已删 | 源码腿（远程页两处硬传 `reversed: false`）+ 解算腿（`styles.css` 仍在原地负责热座） |
 * | **C** | `.scan-overlay.scan-horiz .scan-line` 的**页身份** | 只由运行期**测量**（`r.width > r.height`）保证 | CSS 解算腿（两种链：一个得 keyframe 名、一个得 `null`） |
 * | **D** | 远程页烟雾 puff 的**几何** | 12 个 64px 写死 ⇒ 左右两圆**几何上必然重叠**（算术） | CSS 解算腿 + **算术腿** + "远程规则里无 px"腿 + 热座原值钉住腿 |
 *
 * ## 诚实边界（不许读成"真实布局/观感已验证"）
 *
 * 本仓 **无 jsdom 布局引擎**：`net-css-parse` 只回答"**哪条声明生效**（权重 + 源序）"，
 * 不回答像素。所以本文件
 *  · **能**证明：这三条规则现在解得出方向覆盖的值、页标记在祖先链里、修前那组 px 在
 *    给出的小学算术下**必然重叠**、新值**不再重叠**、新几何**不含任何 px 字面量**；
 *  · **不能**证明：真机上烟/链条/文字标"看起来对"（那是观感，只能由用户在 `localhost:5173`
 *    人眼验收 —— 本文件里出现的每一个 px 都标了是**几何推导**还是**从样式表解出**）。
 *
 * ## 解析器的两条**建模边界**（本文件绕开了它们，而不是假装它们不存在）
 *
 * 1. **`:nth-child(n)` 被当伪类剥掉**（`compoundMatches` 的 `replace(/::?[a-zA-Z-]+…/)`）⇒
 *    12 条 `nth-child` 规则**同权、且都"命中"任意 `.smoke-puff`**，`subjectPropOf` 只会给出
 *    **源序最后一条**（`nth-child(12)`）的值。⇒ D 的逐锚点取值**只能按选择器文本取规则体**。
 * 2. **`%` / `calc(… % / …)` 解不出像素**（`cssLenOf` 的已声明边界）⇒ D 的算术在测试里自己做
 *    （这正是"无 px 字面量"这条腿必要的原因：几何里只有 `%` 与自身变量，缩放关系可机器验算）。
 */

const read = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`../../src/ui/${name}`, import.meta.url)))
    .subarray(0, 8 * 1024 * 1024).toString('utf8');

const NET_SRC = read('styles-net.css');
const HOT_SRC = read('styles.css');
const GEN3_SRC = read('styles-gen3.css');
const GEN3SYNC_SRC = read('styles-gen3-sync.css');
const RENDER_SRC = read('render.ts');
const RENDER_NET_SRC = read('render-net.ts');
const CTRL_SRC = read('gen3-control.ts');

/**
 * 规则表（**剔除关键帧步骤与 `@` 规则**，本仓既有口径：`net-r15.test.ts` 的 `NET_RULES`）。
 * `cssRules` 会把 `@keyframes` 里的 `100% { … }` 解析成一条普通规则，而 `compoundMatches`
 * 对"不含任何类"的选择器**恒真** ⇒ 它会命中任意节点（假红来源）。
 */
const cleanRules = (css: string): CssRule[] => cssRules(css).filter((r) => {
  const sel = r.selector.trim();
  return !sel.startsWith('@') && !/^(?:from|to|\d+(?:\.\d+)?%)$/.test(sel);
});

/**
 * **三个样式表的合并层叠模型**（`main.ts:1-7` 的 import 顺序：styles.css → styles-gen3.css
 * → styles-gen3-sync.css → styles-net.css，本文件最后）。
 * 顺序即源序：同权重时**靠后者**胜 —— 这正是浏览器里发生的事，所以热座/远程两种链可以
 * 用**同一张表**解（远程规则带 `body.net-page`，在热座链上恒不命中 ⇒ 与真实页一致）。
 */
const CASCADE: CssRule[] = [
  ...cleanRules(HOT_SRC),
  ...cleanRules(GEN3_SRC),
  ...cleanRules(GEN3SYNC_SRC),
  ...cleanRules(NET_SRC),
];

/** 只带类名的桩节点（纯 CSS 解算用；不装 DOM、不渲染）。 */
const cssNode = (...classes: string[]): StubNode => {
  const n = makeStubEl('div');
  n.classList.add(...classes);
  return n;
};

/** `body`（可带/不带页标记 `net-page`）—— 本文件所有判据的**根**。 */
const bodyNode = (netPage: boolean): StubNode =>
  (netPage ? cssNode('body', NET_PAGE_CLASS) : cssNode('body'));

/** 取 `@keyframes <name> { … }` 的**花括号配平**块（含头）。找不到/不配平都**抛错**（响亮）。 */
function keyframesBlock(css: string, name: string): string {
  const src = stripComments(css);
  const at = src.indexOf(`@keyframes ${name}`);
  if (at < 0) throw new Error(`样式表里找不到 @keyframes ${name}（被改名/搬走了？）`);
  let i = src.indexOf('{', at);
  let depth = 0;
  for (; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}') { depth -= 1; if (depth === 0) return src.slice(at, i + 1); }
  }
  throw new Error(`@keyframes ${name} 的花括号不配平`);
}

/** 逐字取某条规则的规则体（按**选择器文本**）；找不到**抛错**。 */
function ruleBodyOf(css: string, selector: string): string {
  const src = stripComments(css);
  const i = src.indexOf(`${selector} {`);
  expect(i, `样式表里找不到规则 \`${selector}\``).toBeGreaterThanOrEqual(0);
  const start = src.indexOf('{', i);
  return src.slice(start + 1, src.indexOf('}', start));
}

/* ============================================================================
 * A · 控制权易主 FX 的三条方向覆盖：作用域从 `.net-board` 换到 `body.net-page`
 *
 * 缺陷链（**这是"为什么这三条必须活"的全部理由**，也是本组源码腿要钉的东西）：
 *   1. 层由 `gen3-control.ts` 的 `layer()`（`:37-42`）`document.body.appendChild`
 *      ⇒ `.net-board` **不是**它的祖先；
 *   2. ⇒ `.net-board .g3ctrl-link { animation-name: g3-ctrl-link-fly-y }` **恒不命中**；
 *   3. ⇒ 回落到基础规则 `styles-gen3-sync.css:252` 的 `g3-ctrl-link-fly`，
 *      而**那一条消费 `var(--tx, 0px)`**（`:257`）；
 *   4. 而远程页（竖排）`gen3-control.ts:811-812`（link）与 `:870`（break）写的是 **`--ty`**
 *      （`controlTrackAxis()` 在 `:720-721` 于 `fxViewSeat() !== null` —— 即远程页 —— 返回 `'y'`）；
 *   5. ⇒ **`--tx` 从未被写** ⇒ 牵引链只在原地缩放/旋转/淡出、**完全没有沿轴位移**。
 * ⇒ 修法**只是换作用域**（声明一个字不动）：`styles-net.css:1266/1267/1284`。
 * ========================================================================== */

describe('A · 控制权易主 FX 的方向覆盖必须挂在 `body.net-page` 上（层是 body 级浮层）', () => {
  /**
   * **真实远程页的链**：`body.net-page` → `.g3ctrl-layer`（`layer()` 的产出）→ 主体。
   * ⚠️ 链里**没有** `.net-board` —— 这正是缺陷的成因（层是 body 的子节点、不是 `.net-board`
   * 的后代）。所以"反空集合"不能用"自造一条带 `.net-board` 的祖先链"来做（那样 `body.net-page`
   * 仍在链上、新规则照样命中，判据会被混淆）。改用下面这条**等价**且更强的做法。
   */
  const ctrlChain = (...subject: string[]): StubNode[] => [
    bodyNode(true),
    cssNode('g3ctrl-layer', 'g3fx-layer'),
    cssNode(...subject),
  ];

  /** 按**选择器文本**取那条方向覆盖规则（找不到**抛错**）。 */
  const overrideRule = (selector: string): CssRule => {
    const hit = CASCADE.filter((r) => r.selector.trim() === selector);
    expect(hit.length, `规则表里找不到 \`${selector}\`（${hit.length} 条）`).toBe(1);
    return hit[0];
  };

  /**
   * **"不命中 ⇔ 该规则从规则表里消失"** —— 浏览器里没命中的规则**一条声明都不贡献**，
   * 所以在解算器里把它整条拿掉，解出来的就是"修前"那个值。用它替代"自造带 `.net-board`
   * 的祖先链"：后者会把 `body.net-page` 也放进链里，于是新规则照样命中，判据失去区分力
   * （第一版就是这样假绿的）。
   *
   * ⚠️ 修前那一次，**三条**选择器全部是 `.net-board …` ⇒ 三条**一起**不命中。
   * 所以"修前表"要**同时**拿掉三条，不能只拿掉被查的那一条：`.g3ctrl-link` 的规则**也会**
   * 命中带 `.break` 的那个节点（`compoundMatches` 只要求类集合包含），只拿掉断链那一条的话
   * 解出来的仍是 `g3-ctrl-link-fly-y`（第一版实测踩到）。
   */
  const PRE_FIX_SELECTORS = [
    `body.${NET_PAGE_CLASS} .g3ctrl-link`,
    `body.${NET_PAGE_CLASS} .g3ctrl-link.break`,
    `body.${NET_PAGE_CLASS} .g3ctrl-mini-chip`,
  ];
  const preFix = (): CssRule[] =>
    CASCADE.filter((r) => !PRE_FIX_SELECTORS.includes(r.selector.trim()));

  it('死规则复原：`body.net-page` 链解出 `-y` 版；把三条覆盖拿掉（⇔ 修前的不命中）解出基础/`null`', () => {
    // ── ① `.g3ctrl-link` ──
    const selLink = `body.${NET_PAGE_CLASS} .g3ctrl-link`;
    const link = ctrlChain('g3ctrl-link');
    expect(subjectPropOf(link[2], link, CASCADE, 'animation-name'),
      '远程页链上解不出 `g3-ctrl-link-fly-y` ⇒ 链子还是没有轴向位移（恒不命中的老形态）')
      .toBe('g3-ctrl-link-fly-y');
    // 修前表（三条覆盖全不命中）：基础规则用的是 `animation:` 简写（`styles-gen3-sync.css:252`）
    // ⇒ 长写解不出 ⇒ 浏览器回落到那条读 `--tx` 的动画（= 零轴向位移）。
    expect(subjectPropOf(link[2], link, preFix(), 'animation-name'),
      '把三条覆盖拿掉后仍解得出方向覆盖 ⇒ 本腿没有区分力').toBe(null);
    // 更强的反空集合：把这条规则的**选择器退回 `.net-board`**（修前的写法），它在真实链上**不命中**
    expect(ruleHitsAsSubject(overrideRule(selLink), link[2], link),
      '新规则在真实远程页链上不命中').toBe(true);
    expect(ruleHitsAsSubject({ ...overrideRule(selLink), selector: '.net-board .g3ctrl-link' }, link[2], link),
      '把选择器退回 `.net-board …` 后居然还能命中真实链 ⇒ 真实链里混进了 `.net-board`（前提描述有误）')
      .toBe(false);
    expect(link.some((n) => isClass(n, 'net-board')),
      '真实远程页链里出现了 `.net-board` 祖先 ⇒ 本组前提需重审').toBe(false);

    // ── ② `.g3ctrl-link.break`（断链） ──
    const selBrk = `body.${NET_PAGE_CLASS} .g3ctrl-link.break`;
    const brk = ctrlChain('g3ctrl-link', 'break');
    expect(subjectPropOf(brk[2], brk, CASCADE, 'animation-name'), '断链没有换成 -y 版')
      .toBe('g3-ctrl-link-break-y');
    expect(subjectPropOf(brk[2], brk, preFix(), 'animation-name'),
      '修前表下断链仍解得出方向覆盖').toBe(null);
    expect(ruleHitsAsSubject({ ...overrideRule(selBrk), selector: '.net-board .g3ctrl-link.break' }, brk[2], brk),
      '断链的旧写法 `.net-board …` 在真实链上居然命中').toBe(false);

    // ── ③ `.g3ctrl-mini-chip`（文字标） ──
    const selChip = `body.${NET_PAGE_CLASS} .g3ctrl-mini-chip`;
    const chip = ctrlChain('g3ctrl-mini-chip');
    expect(subjectPropOf(chip[2], chip, CASCADE, 'animation-name'), '文字标没有换成 -y 版')
      .toBe('g3-ctrl-mini-chip-y');
    // 竖排下文字标要落在锚点**左侧**（JS 已按 axis==='y' 偏过 −54px）：修前表下解到的是
    // `styles-gen3-sync.css:475` 的"落在上方"（translate(-50%, -100%)）⇒ 会压在滑块上。
    expect(subjectPropOf(chip[2], chip, CASCADE, 'transform'),
      '文字标的横向落位覆盖丢了（仍是"落在上方"）').toBe('translate(-115%, -50%)');
    expect(subjectPropOf(chip[2], chip, preFix(), 'transform'),
      '修前表下解出的不是基础规则"落在上方"的那个值 ⇒ 反空集合失效（这条腿没有区分力）')
      .toBe('translate(-50%, -100%)');
    expect(ruleHitsAsSubject({ ...overrideRule(selChip), selector: '.net-board .g3ctrl-mini-chip' }, chip[2], chip),
      '文字标的旧写法 `.net-board …` 在真实链上居然命中').toBe(false);
  });

  it('反空集合（选择器面）：这三条规则**不再**以 `.net-board` 为祖先，且权重严格压过基础版', () => {
    const heads: Array<{ subject: string; prop: string }> = [
      { subject: '.g3ctrl-link', prop: 'animation-name' },
      { subject: '.g3ctrl-link.break', prop: 'animation-name' },
      { subject: '.g3ctrl-mini-chip', prop: 'animation-name' },
    ];
    for (const { subject, prop } of heads) {
      // 本表里**声明了该属性、且把该主体当主体**（选择器以它结尾）的规则，逐条查它们的作用域
      const mine = cleanRules(NET_SRC).filter((r) => {
        const re = new RegExp(`(?:^|;|\\s)${prop}\\s*:`);
        return re.test(r.body) && r.selector.trim().endsWith(subject);
      });
      expect(mine.length, `styles-net.css 里找不到 \`${prop}\` 的 ${subject} 覆盖规则（被删了？）`)
        .toBeGreaterThan(0);
      for (const r of mine) {
        expect(r.selector, `\`${r.selector}\` 仍以 \`.net-board\` 为祖先 ⇒ 层挂在 body 上，这条恒不命中`)
          .not.toContain('.net-board');
        expect(r.selector, `\`${r.selector}\` 没有 \`body.net-page\` 页标记 ⇒ 会串到热座页`)
          .toContain(`body.${NET_PAGE_CLASS}`);
        // 基础规则的权重：`.g3ctrl-link` / `.g3ctrl-mini-chip` = 1 个类，`.break` = 2 个类
        const baseSpec = subject === '.g3ctrl-link.break' ? 2 : 1;
        expect(specificityOf(r.selector), `\`${r.selector}\`（${specificityOf(r.selector)}）没有**严格**压过基础规则（${baseSpec}）`)
          .toBeGreaterThan(baseSpec);
      }
    }
  });

  it('"为什么"腿（keyframes 消费哪个轴）：`-y` 三条住在 styles-net.css 且消费 `--ty`；基础版消费 `--tx`', () => {
    // ⚠️ 这条腿是**反空集合**：下一个人把 keyframes 搬走、或把 `var(--ty)` 改成 `var(--tx)`
    //    （让"写了没人读"再发生一次）时，必须有人红。
    const flyY = keyframesBlock(NET_SRC, 'g3-ctrl-link-fly-y');
    expect(flyY, '`g3-ctrl-link-fly-y` 不消费 `var(--ty…)` ⇒ 远程页写了 `--ty` 也没人读（无轴向位移）')
      .toContain('var(--ty');
    expect(flyY, '`g3-ctrl-link-fly-y` 里出现了 `--tx` ⇒ 又变成"写了 `--ty` 却读 `--tx`"').not.toContain('var(--tx');
    const breakY = keyframesBlock(NET_SRC, 'g3-ctrl-link-break-y');
    expect(breakY, '`g3-ctrl-link-break-y` 不消费 `var(--ty…)`').toContain('var(--ty');
    expect(breakY, '`g3-ctrl-link-break-y` 里出现了 `--tx`').not.toContain('var(--tx');
    expect(keyframesBlock(NET_SRC, 'g3-ctrl-mini-chip-y'), '文字标的竖版 keyframes 被搬走了')
      .toContain('translate(-108%');

    // 基础（横版）版本**必须**仍是 `--tx` —— 它是"为什么只换作用域还不够用"的另一半：
    // 恒不命中时浏览器回落到这一条，而它读的是没人写的 `--tx`。
    const flyX = keyframesBlock(GEN3SYNC_SRC, 'g3-ctrl-link-fly');
    expect(flyX, '横版 `g3-ctrl-link-fly` 不再消费 `var(--tx…)`（前提面变了，本组结论需重审）')
      .toContain('var(--tx');
    expect(keyframesBlock(GEN3SYNC_SRC, 'g3-ctrl-link-break'), '横版断链 keyframes 不再消费 `var(--tx…)`')
      .toContain('var(--tx');

    // 产出方腿：层确实挂在 `document.body`（`.net-board` 不可能是它的祖先）
    const layerFn = functionBody(stripComments(CTRL_SRC), 'layer');
    expect(layerFn, '`layer()` 不再把层挂到 `document.body` ⇒ 本组的整条前提需要重审')
      .toContain('document.body.appendChild');
    // 写入方腿：`axis === 'y'`（远程页）时写的是 `--ty`
    const ctrl = stripComments(CTRL_SRC);
    expect(ctrl, '`gen3-control.ts` 的 link 不再按轴写 `--ty`/`--tx`')
      .toContain("link.style.setProperty(axis === 'y' ? '--ty' : '--tx'");
    expect(ctrl, '断链分支不再给 `--ty` 赋值').toContain("link.style.setProperty('--ty',");
    // 轴向判据腿：'y' ⟺ 远程页（fxViewSeat() !== null）
    const axisFn = functionBody(ctrl, 'controlTrackAxis');
    expect(axisFn, '`controlTrackAxis()` 的判据变了（不再是"远程页 ⇔ y 轴"）')
      .toContain("fxViewSeat() === null ? 'x' : 'y'");
  });
});

/* ============================================================================
 * B · 删掉的死规则：`.net-hands .hand.reversed .card + .card`
 *
 * `.reversed` **只**由 `render.ts:1900` 在 `reversed === true` 时写进 `.hand` 的类名，
 * 而远程页两处 `renderHand(...)` **硬传 `reversed: false`**（`render-net.ts:1582`（P0）/
 * `:1605`（P1）），且 `render-net.ts` 全文没有任何 `classList.add('reversed')`
 * ⇒ 远程页 DOM 里**永远没有** `.hand.reversed` ⇒ 那条规则恒不命中（**状态永不产出**）。
 * 它在热座页的对应物在 `styles.css:875 / :882`，**原地不动**（红线）。
 * ========================================================================== */

describe('B · 远程页的 `.hand.reversed` 是"状态永不产出"的死规则（已删，热座仍由 styles.css 负责）', () => {
  it('前提腿（源码）：两处 `renderHand` 都硬传 `reversed: false`，且没有任何地方补这个类', () => {
    const net = stripComments(RENDER_NET_SRC);
    const reversedFalse = net.match(/reversed:\s*false/g) ?? [];
    expect(reversedFalse.length, `render-net.ts 里 \`reversed: false\` 出现 ${reversedFalse.length} 次（应为 2：P0/P1 两处）`)
      .toBe(2);
    expect(/reversed:\s*(?:true|player)/.test(net), 'render-net.ts 里出现了会让 `.reversed` 真被产出的写法')
      .toBe(false);
    // 反向：也没有别处用 classList 补上这个类（那会让"死规则"复活，本组前提失效）
    expect(net, 'render-net.ts 里有 `classList.add(...reversed...)` ⇒ 本组"永不产出"的前提不成立')
      .not.toMatch(/classList\.(?:add|toggle)\([^)]*reversed/);
    // 产出方腿：类名只在 `reversed` truthy 时写
    expect(stripComments(RENDER_SRC), '`renderHand` 不再按 `reversed` 写类名（前提面变了）')
      .toContain("(reversed ? ' reversed' : '')");
  });

  it('已删：`styles-net.css` 里没有 `.net-hands .hand.reversed` 规则，但原地留了"为什么是死的"注释', () => {
    const net = stripComments(NET_SRC);
    expect(net, '`.net-hands .hand.reversed` 又回到了 styles-net.css（它在远程页恒不命中）')
      .not.toContain('.net-hands .hand.reversed');
    // 反空集合①：注释必须把两件事都写清楚（否则下一个人会以为"只是删掉了没理由"）
    expect(NET_SRC, '原处没有留下"为什么它是死的 / 由谁负责"的说明').toContain('状态永不产出');
    expect(NET_SRC, '原处没有写明热座由 styles.css 负责').toContain('styles.css:875');
    // 反空集合②：热座那两条必须仍在（本波只删远程页的死规则，热座一字未动）
    expect(stripComments(HOT_SRC), 'styles.css 的 `.hand.reversed` 被动了（红线）')
      .toContain('.hand.reversed .card + .card');
  });
});

/* ============================================================================
 * C · 页身份从**测量**挪回**类**上：`.scan-overlay.scan-horiz .scan-line`
 *
 * 层由 `render.ts` 的 `syncScanOverlays` 建（`:501-503`）并 `document.body.appendChild`
 * （`:536`）⇒ 选择器必须**无** `.net-board` 前缀（带前缀恒不命中）。它此前是**全文件唯一**
 * 既无 `.net-*` token、也无 `body.net-page` 守卫的规则 ⇒ "只在远程页横置电池上生效"这件事
 * **只由运行期实测**（`:547` 的 `r.width > r.height`）保证。测量是脆的：热座页一旦出现
 * 任一"宽 > 高"的 `.battery-shell`，这条**远程页专属**的横扫 keyframe 会**静默**套到热座页，
 * 而没有任何源码守卫会红 ⇒ 加 `body.net-page` 把页身份挪回类上（JS 的 toggle 保留）。
 * ========================================================================== */

describe('C · 扫描线横置变体的页身份：`body.net-page` 在祖先链里（而不是靠运行期测量）', () => {
  const scanChain = (netPage: boolean, horiz: boolean): StubNode[] => [
    bodyNode(netPage),
    cssNode('scan-overlay', ...(horiz ? ['scan-horiz'] : [])),
    cssNode('scan-line'),
  ];

  it('两种链各解一次：`body.net-page` 链得 keyframe 名；热座链得 `null`', () => {
    const remote = scanChain(true, true);
    expect(subjectPropOf(remote[2], remote, CASCADE, 'animation-name'),
      '远程页横置电池上解不出 `net-battery-scan-sweep` ⇒ 横扫规则没命中（仍在竖扫）')
      .toBe('net-battery-scan-sweep');
    const hot = scanChain(false, true);
    // ⚠️ 这里必须是 **null**：热座链即使带上 `scan-horiz`（= 运行期测量判成"宽>高"），
    //    这条远程页专属的横扫也**不许**生效 —— 这正是"页身份从测量挪回类上"的判据本体。
    expect(subjectPropOf(hot[2], hot, CASCADE, 'animation-name'),
      '热座链 + `scan-horiz` 也能解出远程页的横扫 keyframe ⇒ 页身份还是靠测量，热座会被串到')
      .toBe(null);
    // 反空集合（真值对照）：热座的层在**没有** scan-horiz 时也解不出 animation-name 长写
    //（`styles.css:249` 用的是 `animation:` 简写 ⇒ 解算器看不见长写），说明上面的 null
    // 不是"解算器坏了"，而是"这条规则确实只在 net-page 下才命中"。
    expect(subjectPropOf(scanChain(false, false)[2], scanChain(false, false), CASCADE, 'animation-name'),
      '热座层解出了意料之外的 animation-name').toBe(null);
  });

  it('选择器面：唯一那条 `scan-horiz` 规则带 `body.net-page`，且权重严格压过 styles.css 的基础规则', () => {
    const mine = cleanRules(NET_SRC).filter((r) => r.selector.includes('scan-horiz'));
    expect(mine.length, `styles-net.css 里 scan-horiz 规则有 ${mine.length} 条（应为 1）`).toBe(1);
    expect(mine[0].selector, '这条规则没有 `body.net-page` 页标记 ⇒ 会串到热座页').toContain(`body.${NET_PAGE_CLASS}`);
    expect(mine[0].selector, '这条规则带上了 `.net-board` 祖先 ⇒ 层挂 body，恒不命中').not.toContain('.net-board');
    // 基础规则在 `styles.css:241`，权重 (0,2,0)
    expect(specificityOf(mine[0].selector), '没有严格压过 styles.css 的 `.scan-overlay .scan-line`（2 个类）')
      .toBeGreaterThan(specificityOf('.scan-overlay .scan-line'));
    // JS 的 toggle 保留（页身份与"这一格电池是否横置"是**与**关系，缺一不可）
    expect(stripComments(RENDER_SRC), '`syncScanOverlays` 里的 `scan-horiz` toggle 被删了 —— '
      + '页标记管"这是远程页"、toggle 管"这一格外壳现在横置"，两者都要在')
      .toContain("classList.toggle('scan-horiz', r.width > r.height)");
    // 产出方腿：层挂在 body（所以"不带 .net-board 前缀"不是笔误，是必须）
    expect(stripComments(RENDER_SRC), '`syncScanOverlays` 不再造 `.scan-overlay` 层')
      .toContain("el('div', 'scan-overlay')");
  });
});

/* ============================================================================
 * D · 远程页烟雾 puff 的几何（**算术结论**：修前左右两圆必然重叠）
 *
 * 基础几何在 `styles.css:117-148`：12 个 `.smoke-puff` 宽高**写死 64px**，
 * `nth-child(1) { left: 8px }` / `nth-child(2) { right: 8px }`。热座槽够宽、只是"擦边"；
 * 远程页的槽盒窄得多 ⇒ 圆心距 = 槽盒宽 − 80px，而两半径之和 = 64px。
 *
 * ⚠️ **为什么不能用 `calc(var(--card-w) * …)`**（本波最重要的一条结构性结论）：
 * `--card-h`/`--card-w` **只**声明在 `.net-board` 的规则体里（`styles-net.css:91-92`），
 * 而 `.smoke-overlay` 是 `document.body` 的子节点（`render.ts:436` 建 / `:468` 挂）——
 * **自定义属性只向下继承** ⇒ 读不到；`var()` 无回退值时该声明是"计算值时间失效"
 * （`width` 退化成 `auto`，比现状更坏且**不报错**）。也**不许**在 body 级重复一条
 * `--card-w: calc((140px - 2px) * …)`（= 第二组 `140px`，正是
 * `net-hand-card-size.test.ts:46/:53-55` 与 `net-r15.test.ts:668-671` 钉死的"第二旋钮"）。
 * ⇒ 正解：几何全部写成**相对 `.smoke-overlay` 盒子的百分比**；而那个盒子**就是**
 * `.stack-slot` 的实测矩形（`render.ts:470-474`），槽的内容宽由
 * `.net-lane-band .stack { min-width: var(--card-w) }`（`styles-net.css:480`）驱动
 * ⇒ **px 仍由卡宽隔一跳驱动，且零新增字面量**。
 * ========================================================================== */

describe('D · 远程页烟雾 puff：几何由卡宽驱动（不再必然重叠），且不含第二组字面量', () => {
  /** 烟雾层的链：`body[.net-page]` → `.smoke-overlay`（body 级 fixed，盒 = 槽位矩形）→ puff。 */
  const smokeChain = (netPage: boolean): StubNode[] => [
    bodyNode(netPage),
    cssNode('smoke-overlay'),
    cssNode('smoke-puff'),
  ];

  /**
   * 按**选择器文本**取 nth 锚点规则（⚠️ 解析器把 `:nth-child(n)` 当伪类剥掉 ⇒ 12 条同权同命中，
   * 通用解算只会给"源序最后一条"的值 —— 见文件头注的建模边界①）。
   */
  const nthRule = (n: number, css: string): CssRule => {
    const hit = cleanRules(css).filter((r) => r.selector.includes(`.smoke-puff:nth-child(${n})`));
    expect(hit.length, `${n === 1 ? 'styles.css/styles-net.css' : '样式表'}里 \`.smoke-puff:nth-child(${n})\` 有 ${hit.length} 条（应为 1）`)
      .toBe(1);
    return hit[0];
  };

  /** 规则体里的某条声明的原始值（找不到**抛错**）。 */
  const declOf = (body: string, prop: string): string => {
    const m = new RegExp(`(?:^|;|\\s)${prop}\\s*:\\s*([^;]+)`).exec(body);
    if (m === null) throw new Error(`规则体里找不到 ${prop}：${body}`);
    return m[1].trim();
  };

  /** `%` → 比例（0.32）。非 `%`（px/em/rem…）**抛错** —— 这就是"无 px 字面量"腿的执行面。 */
  const pctOf = (raw: string): number => {
    const m = /^(-?\d+(?:\.\d+)?)%$/.exec(raw.trim());
    if (m === null) {
      throw new Error(`期望百分比，实得 \`${raw}\` —— 远程页 puff 的几何里出现绝对长度就是"第二组字面量"`);
    }
    return Number.parseFloat(m[1]) / 100;
  };

  /** puff 尺寸（`--smoke-puff`）：沿**远程页**链解自定义属性（声明在 `.smoke-overlay` 上）。 */
  const puffPct = (): number => {
    const chain = smokeChain(true);
    const raw = cssVarOf(chain, CASCADE, '--smoke-puff');
    expect(raw, '`body.net-page .smoke-overlay` 上没有 `--smoke-puff`（远程 puff 的尺寸旋钮丢了）').toBeTruthy();
    return pctOf(raw!);
  };

  /**
   * 槽盒宽（**几何推导**，不是实测）：槽的 border-box 宽 = 内容宽 + 左右 padding + 左右 border。
   *   · 内容宽 = `.net-lane-band .stack { min-width: var(--card-w) }`（`styles-net.css:480`）
   *     —— 解算时把 `--card-h` 的注入值当参数，于是"改一个数 ⇒ 全体跟着变"可机检；
   *   · padding：`styles.css:63` 的 `.stack-slot { padding: 6px }`（四边），`styles-net.css:706-707`
   *     把 p1/p2 的**单侧**覆盖成**同样的 6px**（那条规则本来是为撤掉热座的 25px 而写的）
   *     ⇒ 左右合计 12px（下面**逐条解算**，不抄数字）；
   *   · border：`styles.css:61` 的 `1px dashed #555` ⇒ 左右合计 2px。
   */
  const slotBoxW = (injectCardH?: string): { boxW: number; cardW: number; padL: number; padR: number; border: number } => {
    // `--card-h` 的"注入"：往规则表尾巴追加一条同权重、源序更后的声明
    const rules: CssRule[] = injectCardH === undefined
      ? CASCADE
      : [...CASCADE, { selector: '.net-board', body: `--card-h: ${injectCardH};`, no: 10 ** 6 }];
    const board = cssNode('net-board', 'net-view-0');
    const rawW = cssVarOf([board], rules, '--card-w');
    expect(rawW, '`.net-board` 上解不出 `--card-w`（唯一旋钮丢了）').toBeTruthy();
    const cardW = cssLenOf([board], rules, rawW!);
    expect(cardW, `\`--card-w\` 解不出像素值（源文：${String(rawW)}）`).not.toBeNull();

    const slotP1 = cssNode('net-lane-band', 'net-lane-band-x');
    const slotP2 = cssNode('net-lane-band', 'net-lane-band-x');
    const p1 = cssNode('stack-slot', 'p1');
    const p2 = cssNode('stack-slot', 'p2');
    const chainP1 = [bodyNode(true), board, cssNode('net-grid'), slotP1, p1];
    const chainP2 = [bodyNode(true), board, cssNode('net-grid'), slotP2, p2];
    const rawPadR = subjectPropOf(p1, chainP1, rules, 'padding-right');
    const rawPadL = subjectPropOf(p2, chainP2, rules, 'padding-left');
    expect(rawPadR, '`.stack-slot.p1` 的 padding-right 解不出（远程页的 6px 覆盖丢了？）').toBeTruthy();
    expect(rawPadL, '`.stack-slot.p2` 的 padding-left 解不出').toBeTruthy();
    const padR = cssLenOf(chainP1, rules, rawPadR!);
    const padL = cssLenOf(chainP2, rules, rawPadL!);
    expect(padR, `padding-right 解不出像素（${String(rawPadR)}）`).not.toBeNull();
    expect(padL, `padding-left 解不出像素（${String(rawPadL)}）`).not.toBeNull();
    // 顺带钉住"25px → 6px"这条覆盖确实生效（brief 的前提之一）
    expect(padR, '`.stack-slot.p1` 的 padding-right 不再是远程页的 6px（styles.css 的 25px 赢了）').toBe(6);
    expect(padL, '`.stack-slot.p2` 的 padding-left 不再是远程页的 6px').toBe(6);

    const borderDecl = declOf(ruleBodyOf(HOT_SRC, '.stack-slot'), 'border');
    const bm = /(\d+(?:\.\d+)?)px/.exec(borderDecl);
    expect(bm, `\`.stack-slot { border: ${borderDecl} }\` 里解不出宽度`).not.toBeNull();
    const border = Number.parseFloat(bm![1]);
    return { boxW: cardW! + padL! + padR! + 2 * border, cardW: cardW!, padL: padL!, padR: padR!, border };
  };

  it('前置腿（为什么 body 级规则读不到卡宽）：旋钮在 `.net-board` 规则体里，而层挂在 body', () => {
    // ① 旋钮的唯一定义处（也解释了为什么不能"搬走它"：三条既有守卫钉着这个位置/次数）
    expect(ruleBodyOf(NET_SRC, '.net-board'), '`.net-board` 的规则体里没有 `--card-h: 140px`')
      .toContain('--card-h: 140px');
    // ② 层是 body 的子节点 ⇒ `--card-w` 不可达（自定义属性只向下继承）
    const fn = functionBody(stripComments(RENDER_SRC), 'syncSmokeOverlays');
    expect(fn, '`syncSmokeOverlays` 不再把烟雾层挂到 `document.body` ⇒ 本组前提需重审')
      .toContain('document.body.appendChild(overlay)');
    // ③ 层盒 = 槽位矩形（这正是"百分比仍由卡宽驱动"的那一跳的**另一半**）
    expect(fn, '烟雾层不再复制 `.stack-slot` 的实测矩形（层盒与卡宽脱钩 ⇒ 百分比不再是卡宽的函数）')
      .toContain('overlay.style.width = `${r.width}px`');
    expect(fn, '烟雾层的定位对象不再是 `.stack-slot[...]`').toContain('.stack-slot[data-player=');
    // ④ 槽内容宽由 `--card-w` 驱动（那一跳的这一半）
    const stack = cssNode('net-lane-band', 'net-lane-band-x');
    const st = cssNode('stack', 'grow-down');
    const chain = [bodyNode(true), cssNode('net-board', 'net-view-0'), cssNode('net-grid'), stack, st];
    expect(subjectPropOf(st, chain, CASCADE, 'min-width'), '`.stack` 的 `min-width` 不再由 `--card-w` 推出')
      .toBe('var(--card-w)');
  });

  it('解算腿：远程页的 width/left/right 与热座不同，且远程那一组随 `--card-h` 注入值等比变', () => {
    // ── 远程 vs 热座（同一条链，只差页标记）──
    const remote = smokeChain(true);
    const hot = smokeChain(false);
    const remoteW = subjectPropOf(remote[2], remote, CASCADE, 'width');
    const hotW = subjectPropOf(hot[2], hot, CASCADE, 'width');
    expect(remoteW, '远程链解不出 puff 的 width（新规则没生效）').toBe('var(--smoke-puff)');
    expect(hotW, '热座链解不出 puff 的 width（styles.css 的基础几何丢了）').toBe('64px');
    expect(remoteW, '远程页的 width 与热座相同 ⇒ 没有"随卡宽缩"这件事').not.toBe(hotW);

    // ── "一个旋钮"：改 `--card-h` 的注入值 ⇒ 解出的 px 跟着变 ──
    const a = slotBoxW();
    const b = slotBoxW('182px');
    const w = puffPct();
    const puffA = w * a.boxW;
    const puffB = w * b.boxW;
    // eslint-disable-next-line no-console
    console.log(`\n===== R18 · D 远程页烟雾几何（几何推导 + CSS 解算）=====\n`
      + `  槽盒宽 = 内容宽(--card-w) + padding(${a.padL}+${a.padR}) + border(2×${a.border})\n`
      + `  --card-h=140 ⇒ --card-w=${a.cardW.toFixed(3)} ⇒ 槽盒宽=${a.boxW.toFixed(3)} ⇒ puff 直径=${puffA.toFixed(3)}px\n`
      + `  --card-h=182 ⇒ --card-w=${b.cardW.toFixed(3)} ⇒ 槽盒宽=${b.boxW.toFixed(3)} ⇒ puff 直径=${puffB.toFixed(3)}px\n`);
    expect(a.cardW, '`--card-h: 140px` ⇒ `--card-w` 不是 100.572').toBeCloseTo(100.572, 3);
    expect(b.cardW, '`--card-h: 182px` ⇒ `--card-w` 不是 130.572').toBeCloseTo(130.572, 3);
    expect(puffB, '改 `--card-h`（唯一旋钮）后 puff 的 px 没变 ⇒ 几何与卡宽脱钩了')
      .toBeGreaterThan(puffA);
    expect(puffB / puffA, 'puff 的缩放比不等于槽盒宽的缩放比 ⇒ 它不是"随槽盒等比"')
      .toBeCloseTo(b.boxW / a.boxW, 6);
  });

  it('算术腿：左右 puff 圆心距 ≥ 两半径之和（远程页）；修前那组 8px/64px 在**同一条式子**下不成立', () => {
    const { boxW } = slotBoxW();
    const w = puffPct();
    const left = pctOf(declOf(nthRule(1, NET_SRC).body, 'left'));
    const right = pctOf(declOf(nthRule(2, NET_SRC).body, 'right'));
    // 圆心距（都用槽盒宽的百分比表达 ⇒ 与 boxW 无关；这里乘回 px 便于看数）
    const centerDist = boxW * (1 - left - right - w);
    const diameter = w * boxW;                 // 正圆（aspect-ratio:1）⇒ 高 = 宽
    // eslint-disable-next-line no-console
    console.log(`  修后：left=${(left * 100).toFixed(1)}% right=${(right * 100).toFixed(1)}% w=${(w * 100).toFixed(1)}%`
      + ` ⇒ 圆心距=${centerDist.toFixed(2)}px ≥ 半径和=${diameter.toFixed(2)}px（余量 ${(centerDist - diameter).toFixed(2)}px）\n`);
    // 判据本体：两个**等径**圆不重叠 ⟺ 圆心距 ≥ 半径和
    expect(centerDist, `圆心距 ${centerDist.toFixed(2)}px < 半径和 ${diameter.toFixed(2)}px ⇒ 左右两个 puff 仍然重叠`)
      .toBeGreaterThanOrEqual(diameter);

    // ── 修前的那一组（`styles.css` 的真值：写死 8px / 64px），代进**同一条**式子 ──
    const PRE_INSET = 8;      // styles.css:137-138 的 `left: 8px` / `right: 8px`
    const PRE_PUFF = 64;      // styles.css:119-120 的 `width: 64px; height: 64px`
    const preDist = boxW - PRE_INSET - PRE_INSET - PRE_PUFF;
    // eslint-disable-next-line no-console
    console.log(`  修前：槽盒宽=${boxW.toFixed(2)}px ⇒ 圆心距=${preDist.toFixed(2)}px < 半径和=${PRE_PUFF}px（**必然重叠**）\n`);
    expect(preDist, `修前的圆心距 ${preDist.toFixed(2)}px 居然 ≥ 半径和 ${PRE_PUFF}px ⇒ 本组"缺陷真实存在"的证据不成立`)
      .toBeLessThan(PRE_PUFF);
    // 修复的**功效**：新几何的圆心距必须比修前更大（否则只是换了一种重叠）
    expect(centerDist, '修后的圆心距没有比修前更大').toBeGreaterThan(preDist);
    // 口径无关性：只要槽盒宽 < 144px，"修前必然重叠"就成立（144 = 2×64 + 2×8）
    expect(boxW, `槽盒宽 ${boxW.toFixed(2)}px 不小于 144px ⇒ "必然重叠"的结论依赖口径，需重审`).toBeLessThan(144);
  });

  it('"无 px 字面量"腿：远程那 13 条规则里**只有** `%`、自身变量与 `calc(var(--smoke-puff) / …)`', () => {
    const mine = cleanRules(NET_SRC).filter((r) => r.selector.includes('.smoke-puff') || r.selector.includes('.smoke-overlay'));
    // 反空集合：1 条层上的旋钮声明 + 1 条尺寸/正圆规则 + 12 条锚点规则（共 14）
    expect(mine.length, `styles-net.css 里远程 puff 规则有 ${mine.length} 条（应为 14 = 1 旋钮 + 1 尺寸 + 12 锚点）`)
      .toBe(14);
    const ALLOWED = [
      /^-?\d+(?:\.\d+)?%$/,                                  // 百分比锚点（相对层盒）
      /^var\(--smoke-puff\)$/,                               // 唯一的尺寸旋钮
      /^calc\(var\(--smoke-puff\)\s*\/\s*-?\d+(?:\.\d+)?\)$/, // 半个直径（百分比 margin 相对包含块**宽度**）
      /^auto$/, /^\d+$/,                                      // height:auto / aspect-ratio:1
    ];
    const LENGTHISH = ['left', 'right', 'top', 'bottom', 'width', 'height', 'margin-left', 'margin-top', 'aspect-ratio'];
    for (const r of mine) {
      expect(r.selector, `\`${r.selector}\` 没有页标记 ⇒ 会串到热座页`).toContain(`body.${NET_PAGE_CLASS}`);
      const decls = r.body.split(';').map((s) => s.trim()).filter(Boolean);
      for (const d of decls) {
        const [prop, ...rest] = d.split(':');
        const value = rest.join(':').trim();
        if (!LENGTHISH.includes(prop.trim())) continue;   // 只审几何面
        expect(ALLOWED.some((re) => re.test(value)),
          `\`${r.selector}\` 的 \`${prop}: ${value}\` 不是"百分比 / 自身变量 / 其 calc"之一 `
          + '⇒ 引入了一组与卡尺寸无关的字面量（第二旋钮）').toBe(true);
        expect(value, `\`${r.selector}\` 的 \`${prop}\` 里出现绝对长度（px/em/rem）`).not.toMatch(/\d(?:px|em|rem)\b/);
      }
    }
    // 唯一旋钮确实声明在**层**上（不是每个 puff 各写一份）
    expect(cssVarOf(smokeChain(true), CASCADE, '--smoke-puff'), '`--smoke-puff` 不在 `body.net-page .smoke-overlay` 上')
      .toBe('32%');
    // 正圆腿：高度必须由 aspect-ratio 从宽度推出（写成 `height: …%` 会得到 0.32×432.8≈138px 的竖椭圆）
    expect(subjectPropOf(smokeChain(true)[2], smokeChain(true), CASCADE, 'aspect-ratio'),
      'puff 没有 `aspect-ratio: 1` ⇒ 高度会按层盒**高度**算百分比，变成竖椭圆').toBe('1');
  });

  it('热座腿：`styles.css` 的 12 个 puff 基础几何**一个字节未改**（把修前的真值逐个钉住）', () => {
    const base = ruleBodyOf(HOT_SRC, '.smoke-puff');
    expect(base.replace(/\s+/g, ' '), '`.smoke-puff` 的宽高被改了（红线：styles.css 一行不许动）')
      .toContain('width: 64px; height: 64px;');
    // 12 个锚点的真值（本波**只**在 styles-net.css 里覆盖；这里逐条钉住"没被顺手改掉"）
    const pinned: Array<[number, string]> = [
      [1, 'left: 8px; top: 50%; margin-top: -32px;'],
      [2, 'right: 8px; top: 50%; margin-top: -32px;'],
      [3, 'left: 12%; top: 2px;'],
      [4, 'right: 12%; top: 2px;'],
      [5, 'left: 16%; bottom: 2px;'],
      [6, 'right: 16%; bottom: 2px;'],
      [7, 'left: 25%; top: 2px;'],
      [8, 'left: 50%; top: 2px; margin-left: -32px;'],
      [9, 'left: 75%; top: 2px;'],
      [10, 'left: 25%; bottom: 2px;'],
      [11, 'left: 50%; bottom: 2px; margin-left: -32px;'],
      [12, 'left: 75%; bottom: 2px;'],
    ];
    for (const [n, body] of pinned) {
      expect(nthRule(n, HOT_SRC).body.replace(/\s+/g, ' ').trim(),
        `热座 \`.smoke-puff:nth-child(${n})\` 的几何被改动了`).toBe(body);
    }
    // 顺序/语义腿：远程那 12 条的 nth 序号必须**一一对应**（左/右缘中部、四角、上下的 25/50/75）
    for (const [n] of pinned) {
      const r = nthRule(n, NET_SRC);
      expect(r.selector, `远程 nth-child(${n}) 的锚点语义漂了`).toContain(`.smoke-puff:nth-child(${n})`);
    }
  });
});

/* ============================================================================
 * 共享红线腿：本波的改动**全部**住在 styles-net.css 里
 * ========================================================================== */

describe('R18 · 共享红线腿', () => {
  it('`styles.css` / `styles-gen3.css` 里没有 `net-page`；两份表里的既有数值一字未动', () => {
    expect(HOT_SRC, '`styles.css` 里出现了 `net-page` —— 页标记是远程页专属（红线）').not.toContain('net-page');
    expect(GEN3_SRC, '`styles-gen3.css` 里出现了 `net-page`（红线）').not.toContain('net-page');
    // 红线文件的两个锚点（本波只读，不改）
    expect(HOT_SRC, '`styles.css` 的 `.scan-overlay .scan-line` 基础规则被改了')
      .toContain('.scan-overlay .scan-line {');
    expect(HOT_SRC, '`styles.css` 的 `.stack-slot { padding: 6px }` 被改了')
      .toContain('padding: 6px;');
    expect(GEN3SYNC_SRC, '`styles-gen3-sync.css`（红线）被改了：基础 `.g3ctrl-link` 的 animation 简写不见了')
      .toContain('animation: g3-ctrl-link-fly 0.7s cubic-bezier(0.2, 0.9, 0.3, 1) forwards;');
  });
});
