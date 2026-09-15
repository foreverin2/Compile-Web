import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { stripComments } from './source-text';

/**
 * G2 修正 **R8-1** 的守卫：协议选择页两侧的「协议预览框」（`.draft-preview`）必须
 * **比改动前更小**，且**定位语义一个都不能变**。
 *
 * ## 为什么要有这个文件（为什么不能只靠"人眼看过一次"）
 *
 * 用户 2026-09-15 的原话是「**缩小**协议选择页面双方的协议预览框的大小」——
 * 这是一条**方向性**要求（更小），不是一组具体数字。源码文本守卫的常规形态
 * （"断言某字符串存在"）对它是**盲**的：把 `min(400px, 33vw)` 改回 `min(560px, 46vw)`
 * 甚至改成 `min(900px, 90vw)`，任何"存在性"断言都照样绿。
 * 所以这里断言的是**与旧值的大小关系**（旧值作为常量写在断言里），而不是新值的字面量。
 *
 * ## 另一半同样重要：**不能靠动定位去"缩小"**
 *
 * `.draft-preview` 是 body 级 `position: fixed` 浮层，两块（P1 左下 / P2 右下）。
 * G2 Task 4 曾因为「两块 `.draft-preview` 整局残留在预览页并拦截点击」出过 Critical（I-1）。
 * 因此本文件同时钉住 `position: fixed` / `bottom` / `left`·`right` / `z-index: 400` ——
 * 防止下一轮有人为了"让框更小"把它们改成流内元素或挪走。
 *
 * ## 诚实边界
 *
 * 本文件**只**读 CSS 声明，不做任何布局计算（`vitest` 的 environment 是 `node`，没有 jsdom）。
 * "看起来是否真的变小了、好不好看"仍然只能由用户在 5173 上人眼确认（见规格 §6 第 1 条）。
 */

const css = stripComments(
  // ⚠️ 必须走"无参 readFileSync + subarray + toString('utf8')"这个形状：本仓库**没有**
  // `@types/node`，`node:fs` 的 `readFileSync` 只有一条最小声明（返回 `{ subarray(…) }`），
  // 传 `'utf8'` 第二参会直接 `tsc` 报错（`Expected 1 arguments, but got 2`）——
  // 这正是 R8-1 第一版踩过的坑（被 R8-2 的实现者发现）。全仓 `tests/ui/*.test.ts` 同款。
  readFileSync(fileURLToPath(new URL('../../src/ui/styles.css', import.meta.url)))
    .subarray(0, 8 * 1024 * 1024).toString('utf8'),
);

interface CssRule { selector: string; body: string }

/** 去注释后的 `选择器 { 体 }` 列表（`stripComments` 会留下注释起止的 `/*`…`*​/`，
 *  这里当作空白清掉 —— 与 `tests/ui/net-lane-tree.test.ts` 的解析器同一套口径）。 */
function cssRules(src: string): CssRule[] {
  const out: CssRule[] = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  for (let m = re.exec(src); m !== null; m = re.exec(src)) {
    out.push({ selector: m[1].replace(/\/\*|\*\//g, ' ').trim().replace(/\s+/g, ' '), body: m[2] });
  }
  return out;
}

const RULES = cssRules(css);

/** 取一条规则体；找不到直接报红（"规则被改名/删掉"必须响亮）。 */
function ruleBody(selector: string): string {
  const hits = RULES.filter((r) => r.selector === selector);
  expect(hits.length, `styles.css 里 ${selector} 恰好一条规则，实际 ${hits.length} 条`).toBe(1);
  return hits[0].body;
}

/** 取 `prop` 的**第一个**数值（用于 `min(a, b)` 形式的尺寸 —— 只读第一个操作数）。 */
function firstNumber(body: string, prop: string): number {
  const m = new RegExp(`(?:^|;|\\s)${prop}\\s*:\\s*(?:min\\()?\\s*([0-9.]+)`).exec(body);
  expect(m, `${prop} 没找到可解析的数值：${body}`).toBeTruthy();
  return Number(m![1]);
}

/** 修改前的值（R8-1 之前，即 `8a9e308` 的 styles.css）。断言的是"比它小"。 */
const BEFORE = {
  previewWidthPx: 560,
  previewWidthVw: 46,
  previewHeightVh: 42,
  previewHeightPx: 420,
  figWidthPx: 300,
  nameFontPx: 20,
  mottoFontPx: 14,
  bodyFontPx: 13.5,
} as const;

describe('R8-1 协议预览框缩小', () => {
  it('面板尺寸三项都比改动前小（宽度 / 高度 的两条轴都收）', () => {
    const body = ruleBody('.draft-preview');
    expect(firstNumber(body, 'width'), '.draft-preview 宽度（px 项）没变小').toBeLessThan(BEFORE.previewWidthPx);
    expect(firstNumber(body, 'height'), '.draft-preview 高度（vh 项）没变小').toBeLessThan(BEFORE.previewHeightVh);

    // 第二条轴：width 的 vw 项与 height 的 px 项（min() 的第二个操作数）
    const w = /width\s*:\s*min\(\s*[0-9.]+px\s*,\s*([0-9.]+)vw/.exec(body);
    const h = /height\s*:\s*min\(\s*[0-9.]+vh\s*,\s*([0-9.]+)px/.exec(body);
    expect(w, 'width 不再是 `min(<px>, <vw>)` 形式 —— 若是有意重构，请同步改本守卫').toBeTruthy();
    expect(h, 'height 不再是 `min(<vh>, <px>)` 形式 —— 同上').toBeTruthy();
    expect(Number(w![1]), 'width 的 vw 项没变小').toBeLessThan(BEFORE.previewWidthVw);
    expect(Number(h![1]), 'height 的 px 项没变小').toBeLessThan(BEFORE.previewHeightPx);
  });

  it('协议图展示盒（.draft-preview-fig）比改动前小', () => {
    const body = ruleBody('.draft-preview-fig');
    expect(firstNumber(body, 'width'), '.draft-preview-fig 宽度没变小')
      .toBeLessThan(BEFORE.figWidthPx);
  });

  it('面板内字号随面板一起收（名字 / 座右铭 / 正文）', () => {
    expect(firstNumber(ruleBody('.draft-preview-name'), 'font-size'), '协议名没变小')
      .toBeLessThan(BEFORE.nameFontPx);
    expect(firstNumber(ruleBody('.draft-preview-motto'), 'font-size'), '座右铭没变小')
      .toBeLessThan(BEFORE.mottoFontPx);
    expect(firstNumber(ruleBody('.draft-preview-body'), 'font-size'), '详情正文没变小')
      .toBeLessThan(BEFORE.bodyFontPx);
  });

  it('定位语义一个字都没动（fixed / bottom / 左下·右下 / z-index 400）', () => {
    const body = ruleBody('.draft-preview');
    expect(body, '.draft-preview 不再是 position: fixed（I-1 的形态：body 级浮层被改成流内）')
      .toMatch(/position\s*:\s*fixed/);
    expect(body, '.draft-preview 的 bottom 被动了（贴底定位是它的语义）')
      .toMatch(/bottom\s*:\s*14px/);
    expect(firstNumber(body, 'z-index'), '.draft-preview 的 z-index 不再是 400（层级变了）').toBe(400);
    expect(ruleBody('.draft-preview.p1'), '.draft-preview.p1 不再贴左').toMatch(/left\s*:\s*16px/);
    expect(ruleBody('.draft-preview.p2'), '.draft-preview.p2 不再贴右').toMatch(/right\s*:\s*16px/);
  });

  it('没有顺手把面板改成不可点（那也是"缩小挡板"的歪路）', () => {
    // `pointer-events: none` 会让面板永远不挡点击，但那等于**放弃**了它作为可交互展示框的语义
    // （详情里的链接/滚动也一并失效）——用户要的是"更小"，不是"穿透"。
    const body = ruleBody('.draft-preview');
    expect(body, '.draft-preview 被加了 pointer-events: none —— 缩小不等于穿透').not.toMatch(/pointer-events\s*:\s*none/);
  });
});
