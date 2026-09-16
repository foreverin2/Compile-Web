import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  conditionalBlocks, cssLenOf, cssPropOf, cssRules, subjectPropOf, type CssRule,
} from './net-css-parse';
import { makeStubEl, type StubNode } from './net-dom-stub';
import { stripComments } from './source-text';

/**
 * **R25 · 热座放牌区窄屏降级**的守卫（用户裁决 A：`协议列最小宽 + 允许链路列收缩 + 窄屏缩一档`）。
 *
 * ## 这一轮修的是什么（全部来自浏览器实测，见报告 §1/§2）
 *
 * `.lane-row` 是 `grid-template-columns: minmax(660px, 1fr) auto auto minmax(660px, 1fr)`，
 * 两条链路列的 660px 是**硬下限** ⇒ 窗口一窄，被牺牲的**只有中间两条 `auto` 轨道**（协议）：
 *   视口 2000（内容 1800）→ 协议列 210 / 协议图 **200**（设计宽）
 *   视口 1904（内容 1704）→ 177 / 167
 *   视口 1584（内容 1384）→  17 /   7
 *   视口 1484（内容 1284）→  10 / **0**（协议整块不可见）
 * 修法（三条，与本文件的四段判据一一对应）：
 *  1. `.protocol-cell { min-width: calc(200px + 2*4px + 2*1px) }`（= 210）—— **协议永不为 0**；
 *  2. `@media (max-width: 1969px / 1855px / 1614px)` 三档：把链路列换成可收缩的 `minmax(0, 1fr)`
 *     并**只**通过 `--card-h` 这个既有旋钮缩卡（没有第二组魔数）；
 *  3. `minmax(660px, 1fr)` 与 `--card-h: 175px` 这些**无条件**声明**一个字不改** ⇒
 *     设计宽（视口 2000 / 内容 1800）下的渲染**逐字不变**。
 *
 * ## 这个文件能证明什么 / 不能证明什么（诚实边界）
 *  **能**：声明层面的四件事 —— 最小宽确实 ≥ "协议图 + 内边距 + 边框"、媒体查询的断点与档位
 *  满足"该档在它的断点处装得下"、媒体块里**只有**那两类声明（单旋钮）、以及设计宽下
 *  **没有任何媒体查询能生效**。
 *  **不能**：真实像素。`min-width` 到底让协议图拿到多少、断点处到底装不装得下、
 *  设计宽是否逐字不变 —— 这三条只有浏览器说了算，由
 *  `node tools/browser-truth-check.mjs --win …`（矩阵见报告 §2）承担。
 *  ⚠️ 本文件的"能不能装下"用的是**从 4 个实测点拟合出来的线性模型**（见 `SPAN`），
 *  它是**记录基线**，出处写在注释里；模型误差实测 ≤0.5px，判据留 5px 余量。
 */

const cssPath = new URL('../../src/ui/styles.css', import.meta.url);
const CSS = readFileSync(fileURLToPath(cssPath)).subarray(0, 8 * 1024 * 1024).toString('utf8');
const RULES = cssRules(CSS);
const BLOCKS = conditionalBlocks(CSS);

const node = (...classes: string[]): StubNode => {
  const n = makeStubEl('div');
  n.classList.add(...classes);
  return n;
};

/** 声明的长度值（`cssLenOf` 解 `px`/`calc`/`var`；`border`/`padding` 这类简写取前导 px）。
 *  ⚠️ **不用 `subjectPropOf` 解这几个值**：它的主体匹配对 `#app` 这类 **ID 选择器**会把
 *  "需要哪些类" 算成空集 ⇒ **匹配一切**（解析器头注写明的"ID 被算成 0 权重"那族的另一面），
 *  于是 `.protocol { padding }` 会解到 `#app { padding }` 上去（第一版实测就撞在这里）。
 *  这里改成**按选择器精确匹配规则体**：读的就是样式表里那一条写的东西，不做级联推断。 */
function lenOf(selector: string, prop: string): number | null {
  const raw = declOf(selector, prop);
  if (raw === null) return null;
  const n = node(selector.replace(/^\./, '').split(/\s+/).pop()!);
  const lead = /^\s*([\d.]+)px/.exec(raw);
  return lead ? Number.parseFloat(lead[1]) : cssLenOf([n], RULES, raw);
}

/** 取**某条规则**（按选择器精确匹配、取**最后**一条 = 无条件表里最靠后的那条）的声明值。 */
function declOf(selector: string, prop: string, rules: CssRule[] = RULES): string | null {
  const hits = rules.filter((r) => r.selector === selector);
  for (let i = hits.length - 1; i >= 0; i -= 1) {
    const m = new RegExp(`(?:^|;|\\s)${prop}\\s*:\\s*([^;]+)`).exec(hits[i].body);
    if (m) return m[1].trim();
  }
  return null;
}

/**
 * **7 张卡的视觉跨度模型**（`--card-h` → 跨度 px）——**记录基线**，出处是报告 §2 的四组实测：
 *   `h=175 → 660.1` / `h=150 → 565.8` / `h=118 → 445.1` / `h=100 → 377.2`
 * 拟合 `span(h) = 3.7721·h + 0.4`，四点误差 ≤0.5px。为什么是线性的：场上的卡是 ±90° **横躺**的，
 * 跨度 = `卡宽 + 6 × 步距` 再补上旋转把视觉盒撑出的那一截，两者都是 `--card-h` 的线性函数。
 * ⚠️ 这是**基线**不是单源：真实跨度只能浏览器量（工具每轮都会重新量并打印，见报告 §2）。
 */
const SPAN = (cardH: number): number => 3.7721 * cardH + 0.4;
/** `.stack-slot` 给链路的两侧 padding+border（实测 6 + 25 + 2 + 2 = 35px，与档位无关）。 */
const SLOT_CHROME = 35;
/** 协议两列（给定最小宽之后）与三条 gap：2×210 + 3×10 = 450。 */
const MIDDLE = 450;

describe('R25 · 热座窄屏降级：协议列最小宽 / 媒体查询档位 / 单旋钮 / 设计宽不变', () => {
  it('R25-1 解算腿：兜底 `min-width` > 0，且**第一档**里的完整最小宽**恰好**等于"协议图 + 内边距 + 边框"', () => {
    const floor = lenOf('.protocol-cell', 'min-width');
    const imgW = lenOf('.protocol-img', 'width');
    const pad = lenOf('.protocol', 'padding');
    const border = lenOf('.protocol', 'border');
    expect(floor, '`.protocol-cell` 没有无条件的 `min-width` —— 兜底没了（窄屏下协议可能被压成 0）')
      .not.toBeNull();
    expect(floor!, '兜底的 `min-width` 必须 > 0').toBeGreaterThan(0);
    expect(imgW, '`.protocol-img` 的 width 取不到（协议尺寸的基准没了）').not.toBeNull();
    expect(pad, '`.protocol` 的 padding 取不到').not.toBeNull();
    expect(border, '`.protocol` 的 border 取不到').not.toBeNull();
    const derived = imgW! + 2 * pad! + 2 * border!;
    // 第一档里的"完整最小宽"：必须刚好让协议图拿到它的完整宽度（写成别的数 = 第二套真相）
    const tier1 = conditionalBlocks(CSS)
      .filter((b) => /max-width/.test(b.atRule) && !/1100px/.test(b.atRule))[0];
    const tierRules = cssRules(tier1.body);
    const cellRule = tierRules.find((r) => r.selector === '.protocol-cell');
    expect(cellRule, '第一档里没有 `.protocol-cell { min-width }` —— 进档后协议列没有拿到完整宽'
      + '（它会退回兜底值：协议图虽然 >0 但不是完整的 200px）').toBeTruthy();
    const tierMin = cssLenOf([node('protocol-cell')], RULES, /min-width\s*:\s*([^;]+)/
      .exec(cellRule!.body)![1].trim());
    console.log(`\n===== R25-1 · 协议列最小宽的解算 =====\n`
      + `  兜底 min-width = ${floor}px\n  .protocol-img width = ${imgW}px\n`
      + `  .protocol padding = ${pad}px / border = ${border}px\n`
      + `  ⇒ 推导完整最小宽 = ${derived}px；第一档里写的是 ${tierMin}px`);
    expect(tierMin, `第一档的 \`min-width\` 必须等于"协议图宽 + 2×内边距 + 2×边框"（= ${derived}px）——`
      + '写成别的数就是"协议列与协议图之间多了一个可漂移的数字"').toBe(derived);
    // 兜底**必须小于**完整宽（否则它会在"本来正常"的宽度下也生效，动摇设计宽）
    expect(floor!, `兜底 ${floor}px 不小于完整宽 ${derived}px —— 它会在视口 ≥1710 的宽度下也生效，`
      + '而那正是用户已经验收的观感').toBeLessThan(derived);
  });

  it('R25-2 媒体查询腿：三档递减、每档只缩 `--card-h`、**每档在其覆盖范围的最窄处**装得下、第一档恰在兜底生效处', () => {
    // 只认"带 max-width 的 @media"（styles.css 里另有两个视口 1100 的图鉴页媒体查询，与本修复无关）
    const narrow = BLOCKS
      .map((b) => ({ ...b, m: /@media\s*\(\s*max-width\s*:\s*(\d+)px\s*\)/.exec(b.atRule) }))
      .filter((b) => b.m !== null)
      .map((b) => ({ atRule: b.atRule, body: b.body, maxWidth: Number.parseInt(b.m![1], 10) }))
      .filter((b) => b.maxWidth > 1100);
    console.log(`\n===== R25-2 · 窄屏媒体查询（${narrow.length} 块）=====\n`
      + narrow.map((b) => `  ${b.atRule} ⇒ ${b.body.replace(/\s+/g, ' ').trim().slice(0, 96)}…`).join('\n'));
    expect(narrow.length, 'styles.css 里没有窄屏降级的 @media（R25 的修复本体不见了）').toBe(3);
    // 断点必须**递减**（否则后一档会覆盖前一档的语义）
    const widths = narrow.map((b) => b.maxWidth);
    expect(widths, '三档断点不是递减的（后写的档位会覆盖前面的语义）')
      .toEqual([...widths].sort((a, b) => b - a));
    /**
     * **每一档要在它的"覆盖范围内最窄的那一点"装得下**。
     * 该档覆盖 `[下一档断点 + 1, 本档断点]`（最后一档覆盖到 `MIN_SUPPORTED`）——
     * ⚠️ **不能只查本档断点**（那是区间**最宽**处）：第一版就是按最宽处取的 131，
     * 到区间尾部（视口 1611）又差 49px/侧。这条判据是第一版实测踩坑后加的。
     */
    const MIN_SUPPORTED = 1348;
    const ys: number[] = [];
    for (let i = 0; i < narrow.length; i += 1) {
      const b = narrow[i];
      const cardH = /--card-h\s*:\s*([\d.]+)px/.exec(b.body);
      expect(cardH, `${b.atRule} 里没有 \`--card-h\` —— 这一档没有缩任何尺寸（"窄屏优雅降级"落空）`)
        .not.toBeNull();
      const h = Number.parseFloat(cardH![1]);
      expect(h, `${b.atRule} 的 --card-h (${h}px) 不比无条件值小 —— 这一档没有缩小`).toBeLessThan(175);
      const narrowest = i + 1 < narrow.length ? narrow[i + 1].maxWidth + 1 : MIN_SUPPORTED;
      expect(narrowest, `第 ${i + 1} 档的覆盖区间下界(${narrowest}) 不小于它的断点(${b.maxWidth})`
        + ' —— 区间为空，档位顺序写反了').toBeLessThanOrEqual(b.maxWidth);
      const content = narrowest - 200;                    // #app 左右各 100px padding（不许改）
      const need = 2 * (SPAN(h) + SLOT_CHROME) + MIDDLE;
      console.log(`  ${b.atRule}: --card-h=${h} ⇒ 覆盖区间最窄处视口 ${narrowest}（内容 ${content}）时`
        + `需 ${need.toFixed(1)}px（余量 ${(content - need).toFixed(1)}px）`);
      ys.push(need);
      expect(need, `第 ${i + 1} 档（--card-h=${h}）在它覆盖范围的**最窄处**（视口 ${narrowest}）装不下：`
        + `需要内容宽 ${need.toFixed(1)}px，只有 ${content}px —— 该档要更小（或把断点往上挪）`)
        .toBeLessThanOrEqual(content + 5);
    }
    // 单调性：越窄的档必须越小（否则"缩一档"没有意义）
    const hs = narrow.map((b) => Number.parseFloat(/--card-h\s*:\s*([\d.]+)px/.exec(b.body)![1]));
    expect(hs, '档位值不是随断点递减的（窄档反而更大）').toEqual([...hs].sort((a, b) => b - a));
    expect(hs.length, '档位数不是 3').toBe(3);
    expect(ys.length, '没有逐档核算过（上面的循环没跑）').toBe(3);
    // ③ 第一档还必须把链路列换成可收缩的 minmax(0, 1fr)（用户裁决明说"媒体查询里才允许收缩"）
    const first = narrow[0].body.replace(/\s+/g, ' ');
    expect(first, '第一档没有把 `.lane-row` 的链路列换成 `minmax(0, 1fr)` —— 窄屏下栅格仍会被 660 撑破')
      .toMatch(/\.lane-row\s*\{\s*grid-template-columns:\s*minmax\(0, 1fr\) auto auto minmax\(0, 1fr\)/);
    // ④ **兜底 ↔ 第一档断点的耦合**：兜底一旦生效就不能让栅格溢出 ⇒
    //    第一档断点必须**不晚于**"兜底开始生效"的那一点（内容 = 2×660 + 2×floor + 3×10）。
    const floor = lenOf('.protocol-cell', 'min-width')!;
    const floorBitesAt = 2 * 660 + 2 * floor + 30 + 200;
    console.log(`  兜底 ${floor}px 开始生效于视口 ${floorBitesAt}；第一档断点 = ${narrow[0].maxWidth}`);
    expect(narrow[0].maxWidth, `第一档断点（${narrow[0].maxWidth}）晚于"兜底开始生效"的视口`
      + `（${floorBitesAt}）—— 那中间一段会既用着被压窄的协议列、栅格又装不下（两头不靠）`)
      .toBeLessThanOrEqual(floorBitesAt - 1);
  });

  it('R25-3 单旋钮腿：媒体块里**只允许** `.stack { --card-h }` 与 `.lane-row { grid-template-columns }`', () => {
    // 为什么必须有这条：媒体查询最容易变成"再写一套尺寸"的地方（第二组魔数 →
    // 改主旋钮时窄屏不跟着动，两条真相）。这里把允许写的东西**穷举**出来。
    const narrow = BLOCKS.filter((b) => /max-width/.test(b.atRule) && !/1100px/.test(b.atRule));
    const offenders: string[] = [];
    for (const b of narrow) {
      const inner = cssRules(b.body);
      for (const r of inner) {
        const props = [...r.body.matchAll(/(?:^|;|\s)([a-z-]+)\s*:/g)].map((m) => m[1]);
        if (r.selector === '.stack' && props.every((p) => p === '--card-h')) continue;
        if (r.selector === '.lane-row' && props.every((p) => p === 'grid-template-columns')) continue;
        // 第一档里的"进档后协议列恒为完整宽"那一层（**只允许第一档**有）
        if (r.selector === '.protocol-cell' && props.every((p) => p === 'min-width')
          && b.atRule === narrow[0].atRule) continue;
        offenders.push(`${b.atRule} ⇒ ${r.selector} { ${props.join(' ')} }`);
      }
    }
    expect(offenders, '窄屏媒体块里出现了"第二组尺寸"（只允许 `.stack{--card-h}` 与'
      + ' `.lane-row{grid-template-columns}`）—— 请改成复用 `--card-h` 旋钮').toEqual([]);
    // 反空集合：真的解析到了内容（别让上面那条被"零条规则"满足）
    const innerCount = narrow.reduce((n, b) => n + cssRules(b.body).length, 0);
    expect(innerCount, '窄屏媒体块里一条规则都没解析到 —— 上面的"零违例"是被空集合满足的')
      .toBeGreaterThanOrEqual(4);
  });

  it('R25-4 设计宽不变腿：无条件的列模板/旋钮/协议尺寸逐字未变，且**没有任何媒体查询能在设计宽生效**', () => {
    // 期望值 = **改动前**的实测/声明值（报告 §1 的"改前"列），逐字抄进来当机检
    expect(declOf('.lane-row', 'grid-template-columns'),
      '`.lane-row` 的无条件列模板被改了 —— 设计宽（视口 2000 / 内容 1800）下的栅格会跟着变，'
      + '而那是用户已经验收过的观感（用户原话："我对现在这个页面的布局很满意"）')
      .toBe('minmax(660px, 1fr) auto auto minmax(660px, 1fr)');
    expect(declOf('.stack', '--card-h'), '`.stack` 的无条件 `--card-h` 被改了（设计宽下的卡片尺寸会变）')
      .toBe('175px');
    expect(declOf('.protocol-img', 'width'), '`.protocol-img` 的宽度被改了（设计宽下的协议尺寸会变）')
      .toBe('200px');
    // 最小宽**不许超过**协议列的 max-content（= 210）—— 超了它会在视口 ≥1710 也生效
    const minW = lenOf('.protocol-cell', 'min-width');
    // 内容宽 = min(视口, 2000) − 200；设计宽视口 2000 ⇒ 内容 1800
    const DESIGN_VIEWPORT = 2000;
    const DESIGN_CONTENT = DESIGN_VIEWPORT - 200;
    expect(minW!, '无条件兜底比协议列的 max-content（协议图 200 + 内边距/边框 10 = 210）还大 ——'
      + '那会连"本来正常"的宽度下的栅格分配一起改掉').toBeLessThanOrEqual(210);
    // **兜底不许在视口 ≥1710 生效**：兜底开始生效的内容宽 = 2×660 + 2×floor + 3×10
    const floorBites = 2 * 660 + 2 * minW! + 30;
    console.log(`\n===== R25-4 · 兜底 ${minW}px 从内容宽 ${floorBites} 起才可能生效`
      + `（视口 ${floorBites + 200}）；第一档断点见 R25-2 =====`);
    expect(floorBites, '兜底开始生效的内容宽超过了"设计宽 1800" —— 它会在用户验收过的宽度下生效')
      .toBeLessThanOrEqual(DESIGN_CONTENT);
    expect(2 * 660 + 2 * 210 + 30, '设计宽下的栅格最小需求（2×660 + 2×210 + 30 = 1770）'
      + '必须 ≤ 内容宽 1800，否则设计宽下 `min-width` 就会生效')
      .toBeLessThanOrEqual(DESIGN_CONTENT);
    // **没有媒体查询能在设计宽生效**：styles.css 里所有 `max-width` 断点都必须 < 2000
    const allMax = BLOCKS.map((b) => /max-width\s*:\s*(\d+)px/.exec(b.atRule))
      .filter((m) => m !== null).map((m) => Number.parseInt(m![1], 10));
    console.log(`\n===== R25-4 · styles.css 里所有 max-width 断点 = ${allMax.join(' / ')}`
      + `（设计宽视口 ${DESIGN_VIEWPORT}）=====`);
    expect(allMax.filter((w) => w >= DESIGN_VIEWPORT),
      '有媒体查询的断点 ≥ 设计宽视口 2000 ⇒ 它会在设计宽下生效（"逐字不变"当场失效）').toEqual([]);
  });

  it('R25-5 解析器腿：媒体块里的声明**不得**混进无条件规则表（`cssRules` 的 R25 修正）', () => {
    // 为什么必须有：媒体块里写着 `.stack { --card-h: 150px }`。若 `cssRules` 把块体当无条件规则
    // （旧行为），那么**所有**在无条件表上解 `.stack` 旋钮的断言都会解出 150 —— 假绿/假红一起来。
    const hotStack = RULES.filter((r) => r.selector === '.stack' && /--card-h/.test(r.body));
    expect(hotStack.length, `无条件规则表里声明 \`--card-h\` 的 \`.stack\` 规则有 ${hotStack.length} 条`
      + '（应恰好 1 条 —— 多出来的那条就是媒体块漏进来的）').toBe(1);
    // 反空集合：媒体块**确实**声明了别的 `--card-h`（否则这条判据是被"媒体块不存在"满足的）
    const inMedia = BLOCKS.filter((b) => /--card-h\s*:/.test(b.body)).length;
    expect(inMedia, '窄屏媒体块里没有任何 `--card-h` 声明 —— 上面那条"恰好 1 条"就成了空断言')
      .toBeGreaterThanOrEqual(3);
    // 无条件表里解出来的旋钮必须是 175（而不是 150/118/100 中的任何一个）
    const stack = node('stack');
    expect(cssPropOf(stack, [stack], RULES, '--card-h'),
      '`cssPropOf` 在无条件表上解出的 `--card-h` 是窄屏档的值 —— 媒体块漏进了规则表').toBe('175px');
  });
});

/** 让 `stripComments` 被用到（本文件的注释里有 `@media` 字样，将来若有人改成裸正则扫描会误报）。 */
void stripComments;
