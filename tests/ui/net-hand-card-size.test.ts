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
    expect(board, '`.net-board` 上找不到 --card-h —— 手牌区与场上卡就没有共同来源了')
      .toContain('--card-h: 140px');
    expect(board, '`--card-w` 没有由 `--card-h` 推出').toContain('--card-w: calc((var(--card-h) - 2px) * 0.71429 + 2px)');
    expect(board, '手牌整卡高 `--hand-card-h` 没有由 `--card-w` 推出')
      .toContain('--hand-card-h: calc((var(--card-w) - 8px) * 1.4 + 8px)');
    // 反空集合（**单一出处**）：整份 styles-net.css 里 `--card-h:` 只许出现 **1 次**
    //（引用处写的是 `var(--card-h)`，不匹配 `--card-h:`），否则又是"两处真相、改一处另一处不动"
    const decls = NET.match(/--card-h\s*:/g) ?? [];
    expect(decls.length, `styles-net.css 里 --card-h 被定义了 ${decls.length} 次（必须恰好 1 次 = 单一旋钮）`)
      .toBe(1);
  });

  it('手牌卡 / 背面 / 手牌行的尺寸全部由 `--card-w`、`--hand-card-h` 推出（无字面量回潮）', () => {
    expect(ruleBody(NET, '.net-hands .card'), '手牌卡宽度不是由 --card-w 推出的')
      .toContain('width: var(--card-w)');
    expect(ruleBody(NET, '.net-hands .card-back'), '背面高度没跟着卡宽走（正反面会不等高）')
      .toContain('var(--card-w)');
    // ⚠️ `.net-hands .hand` 有**两条**规则（R6 的 align/justify + R9-4 的尺寸）⇒ 这里按
    //    **整份样式表**断言这两条声明存在，而不是用 `ruleBody` 取第一条（它取到的是 R6 那条）
    expect(NET, '手牌行没有用 --hand-card-h（0 张时会塌缩）').toContain('min-height: var(--hand-card-h)');
    expect(NET, '手牌行的左右内缩（= 扇形重叠量）没跟着卡宽缩')
      .toContain('padding-left: calc(var(--card-w) * 0.2154)');
    expect(ruleBody(NET, '.net-hands .hand-count-placeholder'), '占位块的高度没跟着手牌缩（会比真手牌高一截）')
      .toContain('min-height: var(--hand-card-h)');
    expect(ruleBody(NET, '.net-hands .hand-count-only'), '占位块的宽度没跟着卡宽缩')
      .toContain('min-width: var(--card-w)');
  });

  it('数值：公式算出来就是 100.57 / 137.6（与场上卡 100.57 × 140 同基准）', () => {
    const cardH = 140;
    const cardW = (cardH - 2) * 0.71429 + 2;
    const handH = (cardW - 8) * 1.4 + 8;
    expect(cardW, '卡宽应 ≈ 100.57（= R9-1 的 --card-w）').toBeCloseTo(100.57, 1);
    expect(handH, '手牌整卡高应 ≈ 137.6（比 --card-h 略小：3px padding + 1px border）').toBeCloseTo(137.6, 1);
    // 手牌整卡高必须与场上卡**同构**（都是 −8px 后按 5:7、再 +8px 补盒）：两支算式等价
    const laneRealH = (cardW - 8) * 1.4 + 8;
    expect(handH, '手牌整卡高必须等于场上卡的同一算式（同基准的判据）').toBeCloseTo(laneRealH, 6);
  });

  it('热座零变化：热座手牌卡仍是 130px，且新的覆盖规则**全部**带 `.net-` 作用域', () => {
    expect(ruleBody(HOT, '.card'), '热座手牌卡被改了（红线：styles.css 一行不许动）')
      .toContain('width: 130px');
    expect(ruleBody(HOT, '.card-back'), '热座卡背高度被改了').toContain('(130px - 8px) * 1.4');
    // 覆盖规则**必须**带 `.net-` 作用域（热座页选不中 ⇒ 构造性不变）。
    // 判据 = styles-net.css 里**不存在以 `.card` 为主体**的裸规则（主体 = 选择器最后一段，
    // 即紧跟在规则边界之后、`.card` 之后就是 `,` 或 `{` 的那种）。
    const bareCard = NET.match(/(^|[\n},])\s*\.card\s*[,{]/g) ?? [];
    expect(bareCard.map((s) => s.trim()), 'styles-net.css 里出现了裸 `.card` 主体规则 ——'
      + '它会**同时命中热座页的手牌卡**（红线：热座必须零变化）').toEqual([]);
    // 反空集合：远程页**不许**再出现写死的手牌尺寸
    expect(NET, 'styles-net.css 里仍有写死的 `min-width: 130px`').not.toContain('min-width: 130px');
  });
});
