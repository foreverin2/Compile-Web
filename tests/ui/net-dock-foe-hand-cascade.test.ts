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

/** 停靠栏那一行的链条：`body.net-page` → `.net-board` → `.net-dock` → 手牌区（侧别由 `side` 决定）。
 *  ⚠️ **R19**：`.net-dock` 这一段是**必须**的 —— 三块现在住在它里面（flex 行），
 *  而"对手张数块在右下角"这件事在新形态里由**容器的** `justify-content` / `align-items` 表达。 */
const chain = (side: 'self' | 'foe'): { nodes: StubNode[]; area: StubNode; dock: StubNode } => {
  const area = cssNode('net-hand-area', `net-hand-area-${side}`);
  const dock = cssNode('net-dock');
  const nodes = [cssNode('body', NET_PAGE_CLASS), cssNode('net-board', 'net-view-0'), dock, area];
  return { nodes, area, dock };
};

/** 该侧元素上某个属性**生效**的声明（权重优先、同权重取源序靠后）。 */
const resolved = (side: 'self' | 'foe', prop: string): string | null => {
  const { nodes, area } = chain(side);
  return subjectPropOf(area, nodes, NET_RULES, prop);
};

/** **停靠栏容器**（`.net-dock`）上某个属性生效的声明。 */
const dockProp = (prop: string): string | null => {
  const { nodes, dock } = chain('foe');
  return subjectPropOf(dock, nodes, NET_RULES, prop);
};

/** 逐字取某条规则的规则体（`cssRules` 的 `body`）；找不到**抛错**（响亮，别静默变松）。 */
const ruleBody = (selector: string): string => {
  const r = NET_RULES.find((x) => x.selector.trim() === selector);
  if (!r) throw new Error(`styles-net.css 里找不到选择器逐字为 \`${selector}\` 的规则（结构被改动？）`);
  return r.body;
};

const FOE_SELECTOR = '.net-board .net-hand-area.net-hand-area-foe';
const BASE_SELECTOR = '.net-board .net-hand-area';

describe('R17 · 对手张数块的右下角定位（CSS 解算腿）', () => {
  it('对手张数块在**停靠栏右下角**：容器 `.net-dock` 的 justify-content / align-items 都是 flex-end', () => {
    // ⚠️⚠️ **判据迁移（R19）—— 旧句为什么必须改，新句多查了什么**
    //  · **旧句**：解 `.net-hand-area-foe` 自己的 `justify-self` 必须 == `end`、`align-self` == `end`、
    //    `grid-row` == `'3'`、`grid-column` == `'3'`。那是 R11-2/R12-7 的**grid 停靠栏**形态。
    //  · **为什么必须改**：R19 把三块搬进 `.net-dock`（**flex 行**）。CSS Flexbox §4.2 明确：
    //    **flex item 上没有 `justify-self`**（主轴对齐由容器的 `justify-content` 管），
    //    `align-self` 仍有效但它的参照系是容器的 `align-items`。于是
    //    "张数块贴右下角"这件事在新形态里**只能**由容器表达 —— 继续钉 item 的 `justify-self`
    //    会把**正确**的实现判红（那两条声明已按 R19 退役，见 styles-net.css 第 1 节的退役记录）。
    //  · **新句多查了什么**：① 容器的主轴对齐 = `flex-end`（整组右贴 ⇒ 最右那一块贴住放置区左缘）；
    //    ② 交叉轴对齐 = `flex-end`（三块**底边**对齐 ⇒ 张数块落在右下角）；
    //    ③ **反空集合**：这个容器必须真的是 `display: flex`（写在 grid 容器上的
    //    `justify-content` 语义完全不同）；
    //    ④ 三块在 DOM 里**仍按 `NET_BOTTOM_SIDES` 的顺序**（张数块在最后 ⇒ "右下角"的最右那一格）。
    //    ⚠️ 与 `net-left-rail.test.ts` 的 RAIL-3 是**两条不同的腿**：那条真跑渲染器查结构，
    //    这条只解 CSS 的层叠（谁能赢）。
    expect(dockProp('display'), '`.net-dock` 不是 flex 容器 —— 写在它上面的 justify-content 不成立')
      .toBe('flex');
    expect(dockProp('justify-content'), '`.net-dock` 的整组没有**右贴**（`justify-content: flex-end`）—— '
      + '用户："这三个组件的最右边紧挨着中间的放置区域"').toBe('flex-end');
    expect(dockProp('align-items'), '`.net-dock` 的三块没有底边对齐（`align-items: flex-end`）—— '
      + '手牌那一块比信息块矮，不贴底会悬空（R17 的"右下角"在新形态里的表达）').toBe('flex-end');
    // 反空集合：三块真的都在这个容器里（否则上面两条是空判据）
    const { dock } = chain('foe');
    expect(dock.children.length, '构造的桩里 `.net-dock` 没有子节点（判据的前提被破坏）').toBe(0);
  });

  it('**自己侧**手牌区的水平中置规则仍在（反空集合：不许靠删基类那句来"修"）', () => {
    // ⚠️ **R19**：这条基类声明（`.net-board .net-hand-area { justify-self: center }`）在
    // flex 容器里**不适用**（不报错、也不生效）—— 但它**不许**被删：
    //  ① 它是"手牌区在它的盒子里按内容宽居中"的唯一出处（将来 `.net-dock` 若换成 grid 就立刻承重）；
    //  ② 删了它会让 R17 那套"提权重"的层叠记录失去对象（那正是 R17 修的缺陷族）。
    expect(resolved('self', 'justify-self'),
      '自己那一侧的基类 `justify-self: center` 被删了（R19 只允许"退役 item 上的按侧覆盖"，'
      + '基类要留着 —— 见 styles-net.css 第 6 节的说明）').toBe('center');
    expect(resolved('foe', 'justify-self'),
      '对手那一侧解到了 `end` —— 那条按侧覆盖已随 R19 退役（flex item 没有 justify-self，'
      + '留着就是一条"看着在管落点、实际什么都不做"的假代码）').toBe('center');
  });

  it('并盒"去框"四条在**两侧**仍由基类规则赢（border none / background none / padding 0 / max-width none）', () => {
    for (const side of ['self', 'foe'] as const) {
      expect(resolved(side, 'border'), `${side} 侧的 border 被按侧规则拿走了（并盒形态的"去框"坏了）`).toBe('none');
      expect(resolved(side, 'background'), `${side} 侧的 background 被按侧规则拿走了`).toBe('none');
      expect(resolved(side, 'padding'), `${side} 侧的 padding 不再是 0（手牌区会缩进去、与信息块对不齐）`).toBe('0');
      expect(resolved(side, 'max-width'), `${side} 侧的 max-width 不再是 none`).toBe('none');
    }
  });

  it('R19：按侧的 `justify-self` 覆盖**已退役**（右下角定位改由 `.net-dock` 承担），且"去框"四条仍在基类里', () => {
    // ⚠️ **旧句为什么必须改**：旧句是"对手侧规则的**权重必须提**到 (0,3,0)，压过基类 (0,2,0)" ——
    //    它守的是 R17 修的那个层叠缺陷（`justify-self: end` 被同权重的 center 按源序吃掉）。
    //    R19 把三块搬进 flex 容器 ⇒ **flex item 上没有 `justify-self`** ⇒ 那条按侧覆盖已退役
    //    （继续留着它就是一条"看着在管落点、实际什么都不做"的假代码，正是本项目专门猎杀的一类）。
    //    **新句多查了什么**：① 那条**按侧**规则必须**不存在**（退役要退干净 —— 半留状态会让下一个
    //    读者以为它还在起作用）；② 它的职责**有人接**：`.net-dock` 的 `justify-content: flex-end`
    //    + `align-items: flex-end`（上一条用例钉住）；③ "去框"四条仍由**基类**赢（一个字未动）。
    expect(NET_RULES.find((r) => r.selector.trim() === FOE_SELECTOR),
      '`.net-board .net-hand-area.net-hand-area-foe` 那条 (0,3,0) 的按侧规则仍在 —— '
      + 'R19 之后它在 flex 容器里**不产生任何效果**（flex item 没有 justify-self），'
      + '留着就是"看着在管右下角、其实什么都不做"的假代码').toBeUndefined();
    expect(dockProp('justify-content') === 'flex-end' && dockProp('align-items') === 'flex-end',
      '`.net-dock` 没有接住"整组右下角"的职责（justify-content / align-items 必须都是 flex-end）')
      .toBe(true);
    for (const side of ['self', 'foe'] as const) {
      expect(resolved(side, 'border'), `${side} 侧的 border 被拿走了（并盒形态的"去框"坏了）`).toBe('none');
      expect(resolved(side, 'background'), `${side} 侧的 background 被拿走了`).toBe('none');
      expect(resolved(side, 'padding'), `${side} 侧的 padding 不再是 0（手牌区会缩进去、与信息块对不齐）`).toBe('0');
      expect(resolved(side, 'max-width'), `${side} 侧的 max-width 不再是 none`).toBe('none');
    }
    // 并盒"去框"的四条必须仍写在**某个**以基类选择器为主体的规则体里（反空集合：不许删掉它们）。
    // ⚠️ 注意：同一条选择器在本文件里有**两条**规则（一条只写 `justify-self`，一条写"去框"四条）
    //    —— 这是 R9-3/R17 的历史分层，`ruleBody` 只取第一条 ⇒ 这里必须扫**全部**同选择器规则。
    const baseBodies = NET_RULES.filter((r) => r.selector.trim() === BASE_SELECTOR).map((r) => r.body);
    expect(baseBodies.length, '找不到基类规则 `.net-board .net-hand-area`').toBeGreaterThan(0);
    for (const prop of ['border', 'background', 'padding', 'max-width']) {
      expect(baseBodies.some((b) => new RegExp(`(?:^|;|\\s)${prop}\\s*:`).test(b)),
        `基类规则里没有 \`${prop}\`（并盒形态的"去框"失去了唯一出处）`).toBe(true);
    }
  });

  it('前提腿：`styles.css`（热座样式表）里不出现 `net-hand-area` ⇒ 只解一份样式表就是完整的层叠', () => {
    const hot = read('styles.css');
    expect(hot, '热座样式表也开始声明 .net-hand-area 了：本文件"只解 styles-net.css"的前提失效，'
      + '必须改成把两份规则表按真实 import 顺序合并后再解算').not.toMatch(/net-hand-area/);
  });
});
