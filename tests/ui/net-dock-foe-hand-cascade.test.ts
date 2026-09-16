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

describe('R17 · 对手张数块的落点（CSS 解算腿）', () => {
  it('R21：对手张数块是**对手信息块内部的一行**（居中 + 宽度不顶破信息块）', () => {
    /* ⚠️⚠️ **判据迁移（R19 → R21）—— 旧句为什么必须改，新句多查了什么**
     *  · **旧句（R11-2/R12-7）**：解 `.net-hand-area-foe` 自己的 `justify-self == end`、
     *    `align-self == end`、`grid-row == '3'`、`grid-column == '3'`（grid 停靠栏的右下角）。
     *  · **R19 改过一次**：三块进 `.net-dock`（flex 行）⇒ 改查容器的 `justify-content` /
     *    `align-items == flex-end`（flex item 没有 `justify-self`，CSS Flexbox §4.2）。
     *  · **R21 必须再改**：用户把这个张数块**嵌进了对手信息组件内部**
     *    （"将图中手牌区右边的那个手牌乘五的对方信息放进对手信息组件中，而不是独立出来显示"）
     *    ⇒ `.net-dock` 退役、"右下角"这个诉求**不存在了** —— 它现在是信息块里的**一行小字**。
     *    旧句查 `.net-dock` 的 flex-end 会红（那个类已经没有了）。
     *  · **新句多查了什么**：
     *    ① 它在**对手信息块里**由信息块的 `align-items: center` 居中（信息块是 flex column
     *       + `align-items: center`）—— 即"按内容宽居中"而不是"贴右下角"；
     *    ② **新增一条承重声明**：`.net-board .net-hand-area.net-hand-area-foe { max-width: 100% }`
     *       —— 它住在 `max-width: 150px` 的信息块里，那个小字块不许顶破块的内容区；
     *    ③ **反空集合**：`.net-dock` 那条规则必须**真的不在**了（退役要退干净）。
     *  ⚠️ 与 `net-left-rail.test.ts` 的 RAIL-5a 是**两条不同的腿**：那条真跑渲染器查**树**
     *  （"它是对手信息块的后代"），这条只解 CSS 的层叠（"它在块里怎么排、宽度受不受约束"）。 */
    const foe = resolved('foe', 'max-width');
    expect(foe, '`.net-board .net-hand-area.net-hand-area-foe` 没有 `max-width: 100%` —— '
      + '它住在 `max-width: 150px` 的信息块里，不给自己上界就会顶破块的内容区（把块撑宽）').toBe('100%');
    // ② 信息块自己那一侧：`align-items: center` 是"嵌进去的那一行按内容宽居中"的机制
    const block = cssNode('net-info-block');
    block.dataset.netSeat = 'foe';
    const blockChain = [cssNode('body', NET_PAGE_CLASS), cssNode('net-board', 'net-view-0'),
      cssNode('net-left-rail'), cssNode('net-info-pair'), cssNode('net-bottom'), block];
    expect(subjectPropOf(block, blockChain, NET_RULES, 'align-items'),
      '`.net-info-block` 不是 `align-items: center` —— 嵌进去的张数块会贴左而不是居中').toBe('center');
    expect(subjectPropOf(block, blockChain, NET_RULES, 'flex-direction'),
      '`.net-info-block` 不是纵向 flex（嵌进去的东西会与计数行横排）').toBe('column');
    // ③ **退役腿**：`.net-dock` 那条规则必须真的不在（半留状态 = "三块还在同排"的假证据）
    expect(NET_RULES.filter((r) => /(?:^|[\s,>])\.net-dock\b/.test(r.selector)).map((r) => r.selector),
      'styles-net.css 里仍有 `.net-dock` 的规则 —— R21 之后三块不再同排'
      + '（两块进 `.net-info-pair`、自己手牌区留左栏、对手手牌区嵌进对手信息块）').toEqual([]);
  });

  it('**自己侧**手牌区的水平中置规则仍在（反空集合：不许靠删基类那句来"修"）', () => {
    // ⚠️ **R19/R21**：这条基类声明（`.net-board .net-hand-area { justify-self: center }`）在
    // flex 容器里**不适用**（不报错、也不生效）—— 但它**不许**被删：
    //  ① 它是"手牌区在它的盒子里按内容宽居中"的唯一出处（将来若换成 grid 就立刻承重）；
    //  ② 删了它会让 R17 那套"提权重"的层叠记录失去对象（那正是 R17 修的缺陷族）。
    expect(resolved('self', 'justify-self'),
      '自己那一侧的基类 `justify-self: center` 被删了（R19/R21 只允许"退役 item 上的按侧覆盖"，'
      + '基类要留着 —— 见 styles-net.css 第 6 节的说明）').toBe('center');
    expect(resolved('foe', 'justify-self'),
      '对手那一侧解到了 `end` —— 那条按侧覆盖已随 R19 退役（flex item 没有 justify-self，'
      + '留着就是一条"看着在管落点、实际什么都不做"的假代码）').toBe('center');
  });

  it('并盒"去框"四条在**两侧**仍由基类规则赢（border none / background none / padding 0）', () => {
    // ⚠️ **R21**：`max-width` 从这一组里**移出去**了 —— 对手那一侧现在有一条**按侧**的
    // `max-width: 100%`（见上一条用例），所以它不再是"两侧都由基类赢"。
    // 其余三条（border / background / padding）的判据**一个字未改**。
    for (const side of ['self', 'foe'] as const) {
      expect(resolved(side, 'border'), `${side} 侧的 border 被按侧规则拿走了（并盒形态的"去框"坏了）`).toBe('none');
      expect(resolved(side, 'background'), `${side} 侧的 background 被按侧规则拿走了`).toBe('none');
      expect(resolved(side, 'padding'), `${side} 侧的 padding 不再是 0（手牌区会缩进去、与信息块对不齐）`).toBe('0');
    }
    // 自己那一侧的 max-width 仍必须是 `none`（基类赢）；对手那一侧必须是 `100%`（按侧规则赢）
    expect(resolved('self', 'max-width'), '自己那一侧的 max-width 不再是 none').toBe('none');
    expect(resolved('foe', 'max-width'), '对手那一侧的 max-width 不是 100%（那条按侧规则丢了）').toBe('100%');
  });

  it('R21：按侧规则的**唯一职责**是"宽度不顶破信息块"，且"去框"三条仍在基类里', () => {
    /* ⚠️ **旧句为什么必须改（R19 → R21 两轮）**
     *  · **旧句**：那条按侧的 (0,3,0) 规则必须**不存在**（R19：`justify-self: end` 在 flex 容器里
     *    无效 ⇒ 退役），职责由 `.net-dock` 的 flex-end 接住。
     *  · **为什么必须再改**：R21 之后对手手牌块**嵌进了信息块**（用户："放进对手信息组件中"）
     *    ⇒ "右下角"这个诉求不存在了；而**那条按侧选择器又回来了** —— 但它的职责**变了**：
     *    现在只声明 `max-width: 100%`（在 `max-width: 150px` 的信息块里给自己上界）。
     *    R19 的"必须不存在"会把 R21 的**正确**实现判红。
     *  **新句多查了什么**：① 那条按侧规则**在**（它是"宽度不顶破信息块"的唯一出处）；
     *  ② 它**只**声明 `max-width`（不许把"去框"三条抢过去 —— 那三条仍由基类赢）；
     *  ③ 它**不再**声明任何定位（`justify-self` / `align-self` / `grid-*`）：那些在 R21 形态下
     *    要么无效、要么已被 `.net-info-block` 的 `align-items: center` 取代。 */
    const foeRule = NET_RULES.find((r) => r.selector.trim() === FOE_SELECTOR);
    expect(foeRule, '找不到 `.net-board .net-hand-area.net-hand-area-foe` 那条按侧规则 —— '
      + '它现在是"嵌进信息块的那一行不许顶破块"的唯一出处').toBeTruthy();
    const foeBody = foeRule!.body;
    expect(foeBody, '按侧规则里没有 `max-width`（那条职责丢了）').toMatch(/(?:^|;|\s)max-width\s*:/);
    for (const prop of ['border', 'background', 'padding']) {
      expect(foeBody, `按侧规则里声明了 \`${prop}\` —— 那是"去框"三件的职责，必须继续由基类赢`)
        .not.toMatch(new RegExp(`(?:^|;|\\s)${prop}\\s*:`));
    }
    for (const prop of ['justify-self', 'align-self', 'grid-row', 'grid-column', 'position']) {
      expect(foeBody, `按侧规则里还声明着 \`${prop}\` —— R21 之后它在信息块内部（flex column）里`
        + '要么无效、要么已被容器的对齐接管，留着就是"看着在管落点、其实什么都不做"的假代码')
        .not.toMatch(new RegExp(`(?:^|;|\\s)${prop}\\s*:`));
    }
    for (const side of ['self', 'foe'] as const) {
      expect(resolved(side, 'border'), `${side} 侧的 border 被拿走了（并盒形态的"去框"坏了）`).toBe('none');
      expect(resolved(side, 'background'), `${side} 侧的 background 被拿走了`).toBe('none');
      expect(resolved(side, 'padding'), `${side} 侧的 padding 不再是 0（手牌区会缩进去、与信息块对不齐）`).toBe('0');
    }
    // 并盒"去框"的三条必须仍写在**某个**以基类选择器为主体的规则体里（反空集合：不许删掉它们）。
    // ⚠️ 同一条选择器在本文件里有**两条**规则（一条只写 `justify-self`，一条写"去框"）
    //    —— 这是 R9-3/R17 的历史分层，`ruleBody` 只取第一条 ⇒ 这里必须扫**全部**同选择器规则。
    const baseBodies = NET_RULES.filter((r) => r.selector.trim() === BASE_SELECTOR).map((r) => r.body);
    expect(baseBodies.length, '找不到基类规则 `.net-board .net-hand-area`').toBeGreaterThan(0);
    for (const prop of ['border', 'background', 'padding']) {
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
