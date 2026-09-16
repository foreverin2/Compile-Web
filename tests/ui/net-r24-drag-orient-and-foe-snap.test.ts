import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ghostOrientClassFor, ORIENT_CLASSES, orientOf } from '../../src/ui/fx-orient';
import { fxHandEndPoint, handCountPlaceholderOf, handOuterFor } from '../../src/ui/fx-seat';
import { domRectOf } from '../../src/ui/fx-seat';
import { buildTornadoFx, TORNADO_BASE_CARD_H } from '../../src/ui/fx-tornado';
import { installStubDom } from './net-dom-stub';
import { stripComments } from './source-text';

/**
 * **R24 守卫：Z1（拖拽幽灵按落点朝向前瞻） + R16-3（对手落点吸附"张数占位块"足迹）。**
 *
 * ## 两条缺陷的形态（都由无头浏览器实测确认）
 *
 * **Z1**：手牌卡不带朝向类 ⇒ `cloneNode` 出来的拖拽幽灵恒 0°；而落位后那张卡在**对手列**
 * 是 180°（`render-net.ts` 的 `renderSlot` 对对手侧传 `orient: 180` ⇒ `.rot-180`）。
 * 实测：远程自己侧手牌卡朝向类 `[]`、对手侧协议图 `rot-180 net-rot-cw`。
 *
 * **R16-3**：远程页对手手牌是 `handVisibility: 'count'` ⇒ `.hand[data-player="1"]` 里没有
 * `.card`，只有 `.hand-count-placeholder` ⇒ `fxHandEndPoint` 走"空手牌兜底"
 * （`容器外缘 ± HAND_END_LIFT = 93`）。实测：对手 `.hand` rect `397,177 93.42×18`、
 * 占位块 `414.13,177 59.17×18` ⇒ 现状落点 x = `490.42 + 93` = **583.42**，
 * 而吸附到占位块 = `473.3 + 93.42/2` = **519.8**（差 **63.62px**）。
 *
 * ## 两类判据
 *
 * ① 行为腿：`ghostOrientClassFor` / `handCountPlaceholderOf` / `fxHandEndPoint` 真跑（合成桩）。
 * ② 源码腿：接线（谁调谁、热座路径不许读座位）+ **热座构造性不变**的判据。
 */

/* ────────────────── 桩 ────────────────── */

/** 卡桩：只带类名（`orientOf` 读的就是类名）。 */
function cardStub(...classes: string[]): HTMLElement {
  const set = new Set(classes);
  return { classList: { contains: (c: string) => set.has(c) } } as unknown as HTMLElement;
}

/** 落点槽桩：`querySelector('.card')` 返回给定卡（或 null）。 */
function slotStub(card: HTMLElement | null): HTMLElement {
  return { querySelector: (sel: string) => (sel === '.card' ? card : null) } as unknown as HTMLElement;
}

/** 手牌桩：`getBoundingClientRect` + `querySelectorAll('.card:not(.reveal-ghost)')`
 *  + `querySelector('.hand-count-placeholder')` + `classList.contains`。 */
function handStub(
  handRect: ReturnType<typeof domRectOf>,
  cards: Array<ReturnType<typeof domRectOf>>,
  placeholder: ReturnType<typeof domRectOf> | null,
  reversed = false,
): HTMLElement {
  return {
    getBoundingClientRect: () => handRect,
    classList: { contains: (c: string) => c === 'reversed' && reversed },
    querySelectorAll: (sel: string) => (sel === '.card:not(.reveal-ghost)'
      ? cards.map((r) => ({ getBoundingClientRect: () => r }))
      : []),
    querySelector: (sel: string) => (sel === '.hand-count-placeholder' && placeholder
      ? { getBoundingClientRect: () => placeholder }
      : null),
  } as unknown as HTMLElement;
}

const rect = domRectOf;

/* ────────────────── Z1 ────────────────── */

describe('R24 · Z1：拖拽幽灵按落点目标的卡面朝向预览', () => {
  it('**只认 180**：对手列的卡 ⇒ rot-180；自己列 / 热座 ±90 / 空槽 ⇒ null', () => {
    expect(ghostOrientClassFor(slotStub(cardStub('card', 'rot-180'))),
      '对手列（卡面 180°）⇒ 幽灵要转 180°').toBe('rot-180');
    expect(ghostOrientClassFor(slotStub(cardStub('card'))),
      '自己列（卡面 0°）⇒ 不加类（改动前就是这个观感）').toBeNull();
    // 热座：场上卡恒 ±90 —— **必须** null，否则热座拖拽幽灵会凭空横过来（视觉回归）
    expect(ghostOrientClassFor(slotStub(cardStub('card', 'rot-cw'))),
      '热座 P1 侧（+90°）⇒ 必须 null（热座红线：幽灵恒不转）').toBeNull();
    expect(ghostOrientClassFor(slotStub(cardStub('card', 'rot-ccw'))),
      '热座 P2 侧（−90°）⇒ 必须 null').toBeNull();
    // 空槽 / 无槽 / 无 querySelector：都 null（"无从得知"不猜）
    expect(ghostOrientClassFor(slotStub(null)), '空槽 ⇒ null（不许猜一侧）').toBeNull();
    expect(ghostOrientClassFor(null), '没有槽 ⇒ null').toBeNull();
    expect(ghostOrientClassFor({} as HTMLElement), '槽没有 querySelector ⇒ null（不抛）').toBeNull();
  });

  it('180 优先于 ±90（`orientOf` 的既有语义，同时带时按 180 算）', () => {
    expect(orientOf(cardStub('card', 'rot-180', 'rot-cw'))).toBe(180);
    expect(ghostOrientClassFor(slotStub(cardStub('card', 'rot-180', 'rot-ccw')))).toBe('rot-180');
  });

  it('清类用的是 `stripOrientClasses` 的**同一份**类名表（三档一起清）', () => {
    expect([...ORIENT_CLASSES].sort()).toEqual(['rot-180', 'rot-ccw', 'rot-cw']);
  });

  const RENDER = stripComments(readFileSync(
    fileURLToPath(new URL('../../src/ui/render.ts', import.meta.url))).subarray(0, 8 * 1024 * 1024).toString('utf8'));
  const BIND = (() => {
    const i = RENDER.indexOf('export function bindCardDrag');
    return RENDER.slice(i, RENDER.indexOf('export function renderApp(root'));
  })();

  it('源码腿：`onMove` 里真的刷新了幽灵朝向，且按**合法落点**所在槽判', () => {
    expect(BIND, 'onMove 必须调用 syncGhostOrient').toContain('syncGhostOrient(slotUnder(ev));');
    expect(BIND, '命中判据必须走合法落点集合（划在无关区域不该转）')
      .toContain('legalLines.has(`${p}:${line}`)');
    expect(BIND, '命中必须用 elementFromPoint（与 onUp 的放下判据同源）')
      .toContain('document.elementFromPoint(ev.clientX, ev.clientY)');
    expect(BIND, '朝向判据必须来自那个 helper（不许在本文件再写一份角度映射）')
      .toContain('ghostOrientClassFor(slot)');
  });

  it('源码腿（硬约束）：`bindCardDrag` 的朝向判据**不读** `fxViewSeat`（判据只能取自 DOM）', () => {
    // ⚠️ 旧句为什么必须改：第一版写的是 `expect(RENDER).not.toMatch(/fxViewSeat/)` —— **过宽**。
    //    `render.ts` 里**合法地**存在一个 `fxViewSeat()` 调用点（`chainLinkGeom(W, fxViewSeat())`，
    //    文件里 L1587 附近注明"本文件唯一读 fxViewSeat 的地方"；热座下它恒 null ⇒ 只可能加宽
    //    远程页分支）。**新句多查了什么**：把判据**限定在 `bindCardDrag` 函数体**里 ——
    //    那才是"拖拽幽灵的朝向从哪来"这件事的界线（R24 的红线：不许把座位概念写进这条判据）。
    expect(BIND, 'bindCardDrag 里出现了 fxViewSeat —— 拖拽朝向必须取自 DOM（落点槽里的卡）')
      .not.toMatch(/fxViewSeat/);
    expect(BIND, 'bindCardDrag 不许 import/调用任何座位相关入口')
      .not.toMatch(/\b(apply|set)FxViewSeat\s*\(/);
    // 反空集合：本文件确实**有**那个合法的 fxViewSeat 调用点（否则上面那条判据是空断言）
    expect(RENDER, 'render.ts 里连那一个合法调用点都没了 —— 上面那条判据会退化成空断言')
      .toMatch(/chainLinkGeom\(W,\s*fxViewSeat\(\)\)/);
  });

  it('源码腿：幽灵的朝向类必须先清再加（否则连续划过两列会残留上一列的类）', () => {
    const i = BIND.indexOf('const syncGhostOrient');
    const fn = BIND.slice(i, BIND.indexOf('const slotUnder'));
    const order = [fn.indexOf('stripOrientClasses(ghost)'), fn.indexOf('ghost.classList.add(want)')];
    expect(order[0], 'stripOrientClasses 必须在 classList.add 之前').toBeGreaterThanOrEqual(0);
    expect(order[1]).toBeGreaterThan(order[0]);
  });
});

/* ────────────────── R16-3 ────────────────── */

describe('R24 · R16-3：对手落点吸附"张数占位块"足迹', () => {
  it('有占位块 ⇒ 落点 = 占位块外缘 ± 卡宽/2（吸附到那一格的中心）', () => {
    // 用**实测值**：手牌容器 397,177 93.42×18；占位块 414.13,177 59.17×18
    const hand = handStub(rect(397, 177, 93.42, 18), [], rect(414.13, 177, 59.17, 18));
    const p = fxHandEndPoint(hand);
    // 卡宽取 handCardBox()：桩里没有 .net-board ⇒ 回退热座常量 130 ⇒ 半宽 65
    expect(handOuterFor(hand), '远程页两条手牌都 reversed:false ⇒ 外端在右侧').toBe('end');
    expect(p.x, '落点 = 占位块右缘 473.3 + 卡宽/2').toBeCloseTo(473.3 + 65, 6);
    expect(p.y, 'y 仍取手牌容器中心线（与改动前同一个水平带）').toBeCloseTo(177 + 9, 6);
    // 反空集合：**不许**再是"容器外缘 + 93"
    expect(p.x, '不许退回"容器外缘 490.42 + 93 = 583.42"').not.toBeCloseTo(490.42 + 93, 1);
  });

  it('**热座零变化**：没有占位块 ⇒ 逐字走原来的 `容器外缘 ± lift`', () => {
    // 热座夹具：容器 100,100 300×178.8、无卡、无占位块、不 reversed
    const hand = handStub(rect(100, 100, 300, 178.8), [], null);
    const p = fxHandEndPoint(hand);
    expect(p.x, '热座逐字 = 容器右缘 400 + HAND_END_LIFT(93)').toBe(400 + 93);
    expect(p.y, '热座 y = 容器中心').toBeCloseTo(100 + 89.4, 6);
  });

  it('row-reverse（热座 P2）时方向取反，且占位块分支同样遵守', () => {
    const hand = handStub(rect(397, 177, 93.42, 18), [], rect(414.13, 177, 59.17, 18), true);
    expect(handOuterFor(hand)).toBe('start');
    expect(fxHandEndPoint(hand).x, '外端在左 ⇒ 占位块左缘 414.13 − 卡宽/2')
      .toBeCloseTo(414.13 - 65, 6);
  });

  it('有真卡时**不受影响**（末卡分支优先，占位块永远轮不到）', () => {
    const hand = handStub(rect(397, 177, 93.42, 18), [rect(600, 170, 93.42, 127.58)], rect(414.13, 177, 59.17, 18));
    expect(fxHandEndPoint(hand).x, '末卡右缘 693.42 + HAND_END_LEAD(37)')
      .toBeCloseTo(693.42 + 37, 6);
  });

  it('占位块宽度为 0（display:none / 未布局）⇒ 退回原兜底，不产出 0 落点', () => {
    const hand = handStub(rect(100, 100, 300, 178.8), [], rect(200, 100, 0, 0));
    expect(fxHandEndPoint(hand).x, '占位块没布局时不许按它算（会得到 200 + 65）').toBe(400 + 93);
  });

  it('`handCountPlaceholderOf`：读不出 / 无 querySelector ⇒ null（不抛）', () => {
    expect(handCountPlaceholderOf(handStub(rect(0, 0, 1, 1), [], rect(5, 5, 5, 5)))).not.toBeNull();
    expect(handCountPlaceholderOf(handStub(rect(0, 0, 1, 1), [], null))).toBeNull();
    expect(handCountPlaceholderOf(null)).toBeNull();
    expect(handCountPlaceholderOf({} as HTMLElement)).toBeNull();
  });

  it('源码腿：占位块的探针在 `.hand` **子树**里（不是全页查第一个）', () => {
    const SEAT = stripComments(readFileSync(
      fileURLToPath(new URL('../../src/ui/fx-seat.ts', import.meta.url))).subarray(0, 8 * 1024 * 1024).toString('utf8'));
    expect(SEAT, '必须在传入的 hand 里查（按子树），否则两条手牌会互相串')
      .toContain("q.call(hand, '.hand-count-placeholder')");
    expect(SEAT, '不许用 document.querySelector 全页取占位块')
      .not.toMatch(/document\.querySelector.*hand-count-placeholder/);
  });

  it('源码腿：占位块只在"**有**占位块"时生效（热座构造性不变）', () => {
    const SEAT = stripComments(readFileSync(
      fileURLToPath(new URL('../../src/ui/fx-seat.ts', import.meta.url))).subarray(0, 8 * 1024 * 1024).toString('utf8'));
    const fn = SEAT.slice(SEAT.indexOf('export function fxHandEndPoint'));
    const body = fn.slice(0, fn.indexOf('\n}'));
    const iPh = body.indexOf('const ph = handCountPlaceholderOf(hand)');
    const iOld = body.indexOf('return { x: vOuterEdgeOf(rect, outer, \'x\') + step * lift, y };');
    expect(iPh, '必须有"有占位块才吸附"的分支').toBeGreaterThanOrEqual(0);
    expect(iOld, '原兜底 return 必须**保留在最后**（热座/读不到的路）').toBeGreaterThanOrEqual(0);
    expect(iOld, '原兜底必须排在占位块分支**之后**（否则占位块分支永远走不到）').toBeGreaterThan(iPh);
  });
});

/* ────────────────── A11 基准复核（R24：--card-h 已从 140 变 130） ────────────────── */

describe('R24 · A11 复核：飓风基准仍是"热座卡高"，而远程页系数由运行期算出', () => {
  it('**行为腿**：远程页的飓风盒按真卡缩放后**落在卡内**（旧值 118 是卡宽的 126%）', () => {
    // `buildTornadoFx` 要真造 DOM（`document.createElement` / `createElementNS`）⇒ 装桩。
    const restore = installStubDom();
    try {
      // 远程页无头浏览器实测：场上卡 offset 93×128、rect 93.42×127.58
      const scale = 128 / TORNADO_BASE_CARD_H;      // ≈ 0.7314
      const t = buildTornadoFx(scale);
      const w = Number(String(t.style.width).replace('px', ''));
      const h = Number(String(t.style.height).replace('px', ''));
      expect(w, '飓风宽 = TORNADO_W × scale').toBeCloseTo(118 * scale, 6);
      expect(h, '飓风高 = TORNADO_H × scale').toBeCloseTo(170 * scale, 6);
      expect(w, '飓风宽必须 ≤ 远程页真卡宽（93.42）—— 这才是 A11 要修的事').toBeLessThanOrEqual(93.42);
      expect(h, '飓风高必须 ≤ 远程页真卡高（127.58）').toBeLessThanOrEqual(127.58);
      expect(118, '对照：不缩的 118 超出真卡宽 93.42（= 卡宽的 126%，会压相邻列）').toBeGreaterThan(93.42);
      // 反空集合（热座红线）：缺省 scale = 1 ⇒ 逐字等于改动前 CSS 里的 118 / 170
      const hot = buildTornadoFx();
      expect(String(hot.style.width), '热座（缺省 scale=1）必须逐字是 118px').toBe('118px');
      expect(String(hot.style.height), '热座（缺省 scale=1）必须逐字是 170px').toBe('170px');
    } finally { restore(); }
  });

  it('源码腿：基准分母是热座的 175，且注释不再宣称"远程页 140/175 = 0.8"', () => {
    expect(TORNADO_BASE_CARD_H, '基准分母必须仍是热座场上卡高（styles.css:422）').toBe(175);
    const TORN = stripComments(readFileSync(
      fileURLToPath(new URL('../../src/ui/fx-tornado.ts', import.meta.url))).subarray(0, 8 * 1024 * 1024).toString('utf8'));
    // ⚠️ 这条挡"注释里的过期数字"：R20 把远程页 `--card-h` 改成 130 之后，
    //    "远程页按 140/175 = 0.8 缩"就是错的（真值 127.578/175 ≈ 0.729）。
    //    代码里那个 0.8 从不出现（运行期算），所以只有注释会被钉住。
    //    ⚠️ 必须用**原始源码**（不能过 stripComments）：要查的就是注释。
    const raw = readFileSync(fileURLToPath(new URL('../../src/ui/fx-tornado.ts', import.meta.url)))
      .subarray(0, 8 * 1024 * 1024).toString('utf8');
    expect(raw, '注释里仍有"远程页 … 140/175 = 0.8"这类过期说法')
      .not.toMatch(/远程页[^。\n]*140\s*\/\s*175/);
    expect(TORN, '盒尺寸必须仍乘 scale').toContain('const W = TORNADO_W * scale;');
  });
});
