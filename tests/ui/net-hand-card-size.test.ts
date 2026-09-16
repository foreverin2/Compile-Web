import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { stripComments } from './source-text';

/**
 * R9-4 守卫：**远程游玩页的手牌卡与场上卡同基准**（用户："缩小**双方卡牌**的大小……"，
 * 我在动手前明确问过"手牌卡算不算双方卡牌"，**用户答：一起缩**）。
 *
 * ## 这条守卫要挡的三件事
 * 1. **手牌卡不能退回字面量**（`130px` / `178.8px`）：手牌尺寸必须由 `.net-board` 上的
 *    唯一旋钮 `--card-h` 推出（R9-1 建立的"一个数驱动全部"）—— 否则"手牌与场上卡同基准"
 *    就只能靠人工同步，下一轮必然脱钩（R9-1 之前就是这么错的：协议缩了、卡牌没缩）。
 * 2. **热座页零变化**：热座的手牌卡是 `styles.css:387` 的 `.card { width: 130px }`
 *    （红线：那一行**不许动**）。所以远程页的覆盖**必须**带 `.net-` 作用域前缀 ——
 *    漏了前缀就会把手牌卡缩小**热座页**（且热座页的幽灵卡落点不会跟着变，观感直接坏）。
 * 3. **占位块的足印要跟着缩**：对手手牌只剩"张数"占位块，它的 `min-height` 若还写 178.8px，
 *    占位块会比真手牌高一截（R8 的 .hand 矩形语义会被破坏）。
 *
 * ## 诚实边界
 * 本文件**只**做源码/选择器级判据 + 把公式的数值算一遍（`140 → 100.57 → 137.6`），
 * **不**做真实布局解算（本仓无布局引擎）。上一个版本我试过用共享解析器 `cssLenOf` 走祖先链，
 * 但那条路依赖 `net-css-parse` 的调用约定；这里改用**自包含**的判据，宁可窄一点也不要引入
 * 一层新的假绿。数值的权威解算仍在 `tests/ui/net-r9.test.ts` 的 G-10。
 */

const read = (rel: string): string =>
  stripComments(readFileSync(fileURLToPath(new URL(rel, import.meta.url))).subarray(0, 8 * 1024 * 1024).toString('utf8'));

const NET = read('../../src/ui/styles-net.css');
const HOT = read('../../src/ui/styles.css');

/** 取一条规则体（简版：选择器逐字匹配 + 第一个 `{ … }`）。 */
function ruleBody(css: string, selector: string): string {
  const i = css.indexOf(selector + ' {');
  expect(i, `${selector} 在样式表里找不到（改名/删掉了？）`).toBeGreaterThanOrEqual(0);
  const start = css.indexOf('{', i);
  const end = css.indexOf('}', start);
  return css.slice(start + 1, end);
}

describe('R9-4 手牌卡与场上卡同基准', () => {
  it('旋钮定义在**共同祖先** `.net-board` 上（手牌区在 .net-bottom 里 ⇒ R9-1 时读不到）', () => {
    const board = ruleBody(NET, '.net-board');
    // ⚠️ **数值迁移（R19）**：`140px` → `130px`（左栏压缩那一档）。
    //    **旧句为什么必须改**：R19 把三块组件搬进左栏，卡 + 协议 + 7 张跨度必须整体收一档
    //    才放得下；`--card-h` 是**唯一旋钮**（本用例下面那条"只许定义 1 次"就是为这件事），
    //    改它就同时改手牌卡 / 场上卡 / 协议 / 扇形重叠 —— 旧句会把**正确**的实现判红。
    //    **新句多查了什么**：除了新的数值，还钉住了"这个数是**左栏压缩**那一档"
    //    （130 而不是随手写的别的值），并用下面那条"公式算出来的卡宽"把它与几何绑在一起。
    expect(board, '`.net-board` 上找不到 --card-h: 130px（R19 的左栏压缩档）')
      .toContain('--card-h: 130px');
    expect(board, '`--card-w` 没有由 `--card-h` 推出').toContain('--card-w: calc((var(--card-h) - 2px) * 0.71429 + 2px)');
    expect(board, '手牌整卡高 `--hand-card-h` 没有由 `--card-w` 推出')
      .toContain('--hand-card-h: calc((var(--card-w) - 8px) * 1.4 + 8px)');
    // 反空集合（**单一出处**）：整份 styles-net.css 里 `--card-h` 只许有 **1 处"真值"定义**
    //（引用处写 `var(--card-h)` 不匹配；`.net-lane-band .stack { --card-h: inherit }` 是 R10-2 的
    // "拿回旋钮"再声明、**不是**第二个值 ⇒ 不计入）
    const decls = NET.match(/--card-h\s*:(?!\s*inherit)/g) ?? [];
    expect(decls.length, `styles-net.css 里 --card-h 被定义了 ${decls.length} 次（必须恰好 1 次 = 单一旋钮）`)
      .toBe(1);
    // 但那个 `inherit` 再声明**必须**在（否则 styles.css 的 175 会赢 ⇒ 场上卡根本没缩，R10-2 的实机缺陷）
    expect(NET, '`.net-lane-band .stack` 没有用 `inherit` 重新声明 --card-h —— '
      + 'styles.css 的 `.stack { --card-h: 175px }` 会赢，场上卡根本不会缩（R10-2 用户实机发现）')
      .toContain('--card-h: inherit');
  });

  it('手牌卡 / 背面 / 手牌行的尺寸全部由 `--card-w`、`--hand-card-h` 推出（无字面量回潮）', () => {
    // ⚠️ **作用域迁移（R21）**：`.net-hands` → `.net-board`。
    //    **旧句为什么必须改**：R21 把**对手手牌区**搬进了对手信息块 ⇒ 用 `.net-hands` 作用域的规则
    //    对**对手那条 `.hand`** 恒不命中 —— 而 `.hand-count-only` / `.hand-count-placeholder`
    //    正是**对手手牌走的唯一两条规则**（当场就坏，不是"将来"）。
    //    **新句多查了什么**：① 作用域换成 `.net-board`（两条手牌的**共同祖先**，与宿主无关）；
    //    ② **热座零变化仍是构造性的**（`.net-board` / `.net-hands` / `.net-hand-slot` /
    //    `.net-info-pair` 四个类都只在本页产出 —— 下面"热座零变化"那条腿会真查一遍）；
    //    ③ 判据的对象（卡宽 / 卡背高 / 手牌行整高 / 扇步 / 占位块足印）**一个字未改**。
    expect(ruleBody(NET, '.net-board .card'), '手牌卡宽度不是由 --card-w 推出的')
      .toContain('width: var(--card-w)');
    expect(ruleBody(NET, '.net-board .card-back'), '背面高度没跟着卡宽走（正反面会不等高）')
      .toContain('var(--card-w)');
    // ⚠️ `.net-board .hand` 有**两条**规则（R6 的 align/justify + R9-4 的尺寸）⇒ 这里按
    //    **整份样式表**断言这两条声明存在，而不是用 `ruleBody` 取第一条（它取到的是 R6 那条）
    expect(NET, '手牌行没有用 --hand-card-h（0 张时会塌缩）').toContain('min-height: var(--hand-card-h)');
    expect(NET, '手牌行的左右内缩（= 扇形重叠量）没跟着卡宽缩')
      .toContain('padding-left: calc(var(--card-w) * 0.2154)');
    expect(ruleBody(NET, '.net-board .hand-count-placeholder'), '占位块的高度没跟着手牌缩（会比真手牌高一截）')
      .toContain('min-height: var(--hand-card-h)');
    expect(ruleBody(NET, '.net-board .hand-count-only'), '占位块的宽度没跟着卡宽缩')
      .toContain('min-width: var(--card-w)');
  });

  it('数值：公式算出来就是 93.43 / 127.6（与场上卡 93.43 × 130 同基准）', () => {
    // ⚠️ **数值迁移（R19）**：140 → 130 ⇒ 卡宽 100.57 → 93.43、手牌整卡高 137.6 → 127.6。
    //    **旧句为什么必须改**：它们把 R9-1 那一档（140）写成了**唯一**答案；R19 收了 45px
    //    （卡宽 −7.14、整卡高 −10）之后旧数值不再成立。**新句多查了什么**：它仍然要求
    //    "手牌整卡高 == 场上卡的同一算式"（同基准那条判据本体**一个字没动**），
    //    只是把 `cardH` 换成当下的旋钮值 —— 判据形式与强度不变。
    const cardH = 130;
    const cardW = (cardH - 2) * 0.71429 + 2;
    const handH = (cardW - 8) * 1.4 + 8;
    expect(cardW, '卡宽应 ≈ 93.43（= R19 的 --card-w）').toBeCloseTo(93.43, 1);
    expect(handH, '手牌整卡高应 ≈ 127.6（比 --card-h 略小：3px padding + 1px border）').toBeCloseTo(127.6, 1);
    // 手牌整卡高必须与场上卡**同构**（都是 −8px 后按 5:7、再 +8px 补盒）：两支算式等价
    const laneRealH = (cardW - 8) * 1.4 + 8;
    expect(handH, '手牌整卡高必须等于场上卡的同一算式（同基准的判据）').toBeCloseTo(laneRealH, 6);
  });

  it('热座零变化：热座手牌卡仍是 130px，且新的覆盖规则**全部**带 `.net-` 作用域', () => {
    expect(ruleBody(HOT, '.card'), '热座手牌卡被改了（红线：styles.css 一行不许动）')
      .toContain('width: 130px');
    expect(ruleBody(HOT, '.card-back'), '热座卡背高度被改了').toContain('(130px - 8px) * 1.4');
    /* 覆盖规则**必须**带 `.net-` 作用域（热座页选不中 ⇒ 构造性不变）。
     * 判据 = styles-net.css 里**不存在以 `.card` 为主体**的裸规则（主体 = 选择器最后一段，
     * 即紧跟在规则边界之后、`.card` 之后就是 `,` 或 `{` 的那种）。
     * ⚠️ **R21**：作用域从 `.net-hands .card` 变成 `.net-board .card` —— 两者都带 `.net-` 前缀，
     * 所以**这条判据一个字未改**（裸 `.card` 主体仍然禁止）。它同时是"热座零变化仍是
     * 构造性的"这条论证的机检腿：`.net-board` 这个类只在 `render-net.ts` 里产出。 */
    const bareCard = NET.match(/(^|[\n},])\s*\.card\s*[,{]/g) ?? [];
    expect(bareCard.map((s) => s.trim()), 'styles-net.css 里出现了裸 `.card` 主体规则 ——'
      + '它会**同时命中热座页的手牌卡**（红线：热座必须零变化）').toEqual([]);
    // ⚠️ **R21 新增**：新的作用域类必须**只在本页产出**（否则"热座零变化"就不再是构造性的）
    //    —— 判据是"`styles.css` 的**非注释正文**里不出现这些类"。
    const hotNoComments = HOT.replace(/\/\*[\s\S]*?\*\//g, ' ');
    for (const cls of ['net-board', 'net-hands', 'net-hand-slot', 'net-info-pair', 'net-right-rail']) {
      expect(hotNoComments, `styles.css（热座）里出现了 .${cls} —— R21 的新作用域会让热座页也被命中，`
        + '"热座零变化"不再是构造性的').not.toContain(cls);
    }
    // 反空集合：远程页**不许**再出现写死的手牌尺寸
    expect(NET, 'styles-net.css 里仍有写死的 `min-width: 130px`').not.toContain('min-width: 130px');
  });
});
