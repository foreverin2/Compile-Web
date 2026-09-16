import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { NET_PAGE_CLASS } from '../../src/ui/render-net';
import { makeStubEl, type StubNode } from './net-dom-stub';
// ⚠️ 用 `subjectPropOf`（**主体绑定**解算），不是 `cssPropOf`：本文件的判据问的是
// "这条规则说的是**这个节点**吗"。`cssPropOf` 允许主体绑到链上任意祖先，会把别人的声明算进来。
import { cssRules, specificityOf, subjectPropOf } from './net-css-parse';

/**
 * **停靠栏：对手张数块的 `justify-self` 层叠守卫**（G2 修正 R17）。
 *
 * ## 被守的缺陷（修前真实存在，本轮修掉）
 *
 * `styles-net.css` 第 1 节原来写 `.net-board .net-hand-area-foe { … justify-self: end }` =
 * **(0,2,0)**，而第 6 节的基类 `.net-board .net-hand-area { justify-self: center }` **同为 (0,2,0)**
 * 且源序更靠后 ⇒ `end` 被 `center` **静默吃掉**：R12-7 要的"对手手牌张数块压在对手信息块**右下角**"
 * 自落地起从未生效（它其实被**水平居中**在轨道里）。`align-self`/`grid-row`/`grid-column` 没有竞争者，
 * **只有 `justify-self` 这一条被吃**。
 *
 * ## 修法与为什么不是"靠源序"
 *
 * 第 1 节的选择器提权到 **(0,3,0)**：`.net-board .net-hand-area.net-hand-area-foe`（只加一段类名，
 * 声明一个不改）。这符合本仓 R15-2 的同款纪律：**给选择器补足权重，拒绝"靠本文件是最后一个 import"**
 * 这类隐性依赖（源序会随任何一次 CSS 挪位而翻转）。
 * ⚠️ 修法**不允许**改成"把基类的 `justify-self: center` 删掉"：自己那一侧
 * （`.net-hand-area-self`，`grid-column: 2`）**正是靠它**居中 —— 所以下面第二条腿是**反空集合**
 * （自己那侧必须仍解出 `center`）。
 *
 * ## 腿的性质（能证明什么 / 不能证明什么）
 *
 * **CSS 解算腿**：只从 `styles-net.css` 解"哪条声明生效"（权重 + 源序），**不模拟布局**
 * ⇒ 能证明"对手侧现在解出 `end`、自己侧仍解出 `center`、两侧的'去框'四条仍是基类规则的值"，
 * **不能**证明"真机上张数块看起来真的贴住了右下角"（那是像素观感，需要人眼验收）。
 * 本轮**未**起任何浏览器/服务：文件里出现的旧实测数字都标了出处，其余是 CSS 推导/估算。
 *
 * ## 前提腿
 *
 * 本文件只解 `styles-net.css`（`net-r15.test.ts` 同款口径）。这条模型前提由最后一条腿机检：
 * `styles.css` 里**不许**出现 `net-hand-area`（这些类只属于远程页；一旦热座样式表也声明它们，
 * "只解一份样式表"就不再等价于真实层叠）。
 */

const read = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`../../src/ui/${name}`, import.meta.url)))
    .subarray(0, 8 * 1024 * 1024).toString('utf8');

const NET_SRC = read('styles-net.css');
/**
 * 剔除**关键帧步骤**与 `@` 规则后的规则表（本仓既有口径，见 `net-r15.test.ts` 的 `NET_RULES`）：
 * `cssRules` 会把 `@keyframes` 里的 `100% { … }` 解析成"没有类选择器"的普通规则，
 * 而解算器的 `compoundMatches` 对空类集合**恒真** ⇒ 它会命中任意节点。
 */
const NET_RULES = cssRules(NET_SRC).filter((r) => {
  const sel = r.selector.trim();
  return !sel.startsWith('@') && !/^(?:from|to|\d+(?:\.\d+)?%)$/.test(sel);
});

/** 只带类名的桩节点（纯 CSS 解算用；不装 DOM、不渲染）。 */
const cssNode = (...classes: string[]): StubNode => {
  const n = makeStubEl('div');
  n.classList.add(...classes);
  return n;
};

/** 停靠栏那一行的链条：`body.net-page` → `.net-board` → 手牌区（侧别由 `side` 决定）。 */
const chain = (side: 'self' | 'foe'): { nodes: StubNode[]; area: StubNode } => {
  const area = cssNode('net-hand-area', `net-hand-area-${side}`);
  const nodes = [cssNode('body', NET_PAGE_CLASS), cssNode('net-board', 'net-view-0'), area];
  return { nodes, area };
};

/** 该侧元素上某个属性**生效**的声明（权重优先、同权重取源序靠后）。 */
const resolved = (side: 'self' | 'foe', prop: string): string | null => {
  const { nodes, area } = chain(side);
  return subjectPropOf(area, nodes, NET_RULES, prop);
};

/** 逐字取某条规则的规则体（`cssRules` 的 `body`）；找不到**抛错**（响亮，别静默变松）。 */
const ruleBody = (selector: string): string => {
  const r = NET_RULES.find((x) => x.selector.trim() === selector);
  if (!r) throw new Error(`styles-net.css 里找不到选择器逐字为 \`${selector}\` 的规则（结构被改动？）`);
  return r.body;
};

const FOE_SELECTOR = '.net-board .net-hand-area.net-hand-area-foe';
const BASE_SELECTOR = '.net-board .net-hand-area';

describe('R17 · 对手张数块的 justify-self（CSS 解算腿）', () => {
  it('对手侧 `.net-hand-area-foe` 的 `justify-self` 必须解出 **end**（右下角定位真的生效）', () => {
    const got = resolved('foe', 'justify-self');
    expect(got, `对手张数块的 justify-self 解到了 \`${got}\`（修前是 center：被同权重的基类规则按源序吃掉）`)
      .toBe('end');
    // 同格的另外三条（本轮**一个字没动**，一起钉住防误改）
    expect(resolved('foe', 'align-self')).toBe('end');
    expect(resolved('foe', 'grid-row')).toBe('3');
    expect(resolved('foe', 'grid-column')).toBe('3');
    expect(resolved('foe', 'margin')).toBe('0 6px 4px 0');
  });

  it('**自己侧** `.net-hand-area-self` 的 `justify-self` 必须仍是 **center**（反空集合：不许靠删基类那句来"修"）', () => {
    const got = resolved('self', 'justify-self');
    expect(got, `自己那一侧解到了 \`${got}\`：轨道居中靠的就是基类的 justify-self: center（删了会把它弄坏）`)
      .toBe('center');
    // 自己侧既不该拿到对手侧的 end，也不该被那条 (0,3,0) 规则命中（它没有 .net-hand-area-foe 类）
    expect(resolved('self', 'align-self')).toBe('end');
    expect(resolved('self', 'grid-column')).toBe('2');
  });

  it('并盒"去框"四条在**两侧**仍由基类规则赢（border none / background none / padding 0 / max-width none）', () => {
    for (const side of ['self', 'foe'] as const) {
      expect(resolved(side, 'border'), `${side} 侧的 border 被按侧规则拿走了（并盒形态的"去框"坏了）`).toBe('none');
      expect(resolved(side, 'background'), `${side} 侧的 background 被按侧规则拿走了`).toBe('none');
      expect(resolved(side, 'padding'), `${side} 侧的 padding 不再是 0（手牌区会缩进去、与信息块对不齐）`).toBe('0');
      expect(resolved(side, 'max-width'), `${side} 侧的 max-width 不再是 none`).toBe('none');
    }
  });

  it('修复方式 = **提权重**：对手侧规则 (0,3,0) 压过基类 (0,2,0)，且它不声明"去框"那四条', () => {
    expect(specificityOf(FOE_SELECTOR), '对手侧选择器的类数变了（提权的前提没了）').toBe(3);
    expect(specificityOf(BASE_SELECTOR), '基类选择器的类数变了').toBe(2);
    const foeBody = ruleBody(FOE_SELECTOR);
    // 提权的那条**只**声明定位相关属性；"去框"必须继续由基类赢（否则两级规则会互相打架）
    for (const prop of ['border', 'background', 'padding', 'max-width']) {
      expect(foeBody, `对手侧规则里声明了 \`${prop}\`：它现在是 (0,3,0)，会把并盒形态的"去框"压回去`)
        .not.toMatch(new RegExp(`(?:^|;|\\s)${prop}\\s*:`));
    }
    // 机制记录（不是要求，而是把"修前为什么坏"钉成可读事实）：基类规则在源序上**更靠后**。
    const baseNo = NET_RULES.find((r) => r.selector.trim() === BASE_SELECTOR)?.no ?? -1;
    const foeNo = NET_RULES.find((r) => r.selector.trim() === FOE_SELECTOR)?.no ?? -1;
    expect(baseNo, '找不到基类规则').toBeGreaterThanOrEqual(0);
    expect(foeNo, '找不到对手侧规则').toBeGreaterThanOrEqual(0);
    expect(baseNo, '基类规则不再靠后了 —— 请复核"源序"这条记录是否还准（修好之后它已不承重）')
      .toBeGreaterThan(foeNo);
  });

  it('前提腿：`styles.css`（热座样式表）里不出现 `net-hand-area` ⇒ 只解一份样式表就是完整的层叠', () => {
    const hot = read('styles.css');
    expect(hot, '热座样式表也开始声明 .net-hand-area 了：本文件"只解 styles-net.css"的前提失效，'
      + '必须改成把两份规则表按真实 import 顺序合并后再解算').not.toMatch(/net-hand-area/);
  });
});
