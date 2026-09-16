import { describe, it, expect, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  applyFxViewSeat, domRectOf, fxHandEndPoint, fxIsSelfSide, fxOuterFor, fxOuterForSeat,
  fxStackEndPoint, fxTrackEndFor, fxTrackEndPos, fxTrackFallbackPct, fxViewSeat, FX_TRACK_EDGE_PCT,
  FX_TRACK_EDGE_PCT_Y, handOuterFor, handReversed, setFxViewSeat, vClipInsetCss, vClipInsetPct,
  vOuterEdgeOf, vStackEndPoint, vVisibleStripRect,
} from '../../src/ui/fx-seat';
import { renderControlModule } from '../../src/ui/render';
import { installStubDom, type StubNode } from './net-dom-stub';
import { fxOrientOf, fxRotMarkerOf } from '../../src/ui/fx-orient';
import { clipInsetCss, clipInsetRightPct, coverUidOf, coveredOuterOf, visibleRectOf } from '../../src/ui/gen3-util';
import { stripComments } from './source-text';

/**
 * G2 修正 R3 守卫：**方向模型从"按绝对玩家左右"改成"按座位上下"**。
 *
 * 权威规格：`docs/2026-09-14-G2修正-竖向布局与朝向分离-设计说明.md` §3.2（机制，用户裁决**接受**）
 * 与 §8.1（落地口径：切换视角是开发/测试功能，不为运行时反复切换造任何机制）。
 *
 * ## 这些断言**能**证明什么 / **不能**证明什么
 *
 * 能（本文件的主体）：
 *  - `fx-seat.ts` 的轴向几何是**纯函数** ⇒ 逐字段断言"自己向下 / 对手向上""覆盖者在
 *    下 / 上"真的成立（`vStackEndPoint` / `vVisibleStripRect` / `vClipInsetPct` / `vClipInsetCss`）；
 *  - `seat === null`（热座）时**逐字段**等于改动前的左右算式（`fxStackEndPoint` / `fxHandEndPoint`）
 *    ⇒ "热座零变化"不是口号，而是一组可复算的等式；
 *  - `gen3-util` 的 DOM 读取路径的**调用与取值**（用窄桩喂合成 DOM，断言它真的读到了
 *    `data-fx-rot` 并按它选方向）。
 *
 * **不能**：真实浏览器里 `getBoundingClientRect()` 的实际值、flex 求解出的真实卡位、
 * "看起来越新越往外"的观感。那只能靠 `opts.verifyHooks` 的运行时自查（render-net 的约束 9）
 * 与用户人眼验收 —— 本文件里任何一条**都不是**几何验证。
 */

/**
 * 造一个轴对齐的矩形。
 *
 * ⚠️ **不能用 `new DOMRect(...)`**：本仓测试环境是 `environment: 'node'`（无 jsdom），Node 里没有
 * `DOMRect` 构造器 —— 我第一版就是那么写的，整个测试文件在收集阶段就 `ReferenceError`（0 test）；
 * 而"合成 DOM 桩真的走到 `visibleRectOf`"时又在**被测源码**里撞到同一个坑（`gen3-util.ts` 里
 * 那句 `new DOMRect(...)`）—— 那一处已改成 `fx-seat.ts` 的 `domRectOf` 工厂（见其注释）。
 * 这个坑与本仓"无 jsdom"的纪律同源，记在这里免得下一个人重踩。
 */
function rect(left: number, top: number, width: number, height: number): DOMRect {
  return domRectOf(left, top, width, height);
}

/** 从被测函数返回的 DOMRect 里取字段（可能是普通对象，不能用 `instanceof`）。 */
function box(r: DOMRect): { left: number; top: number; width: number; height: number } {
  return { left: r.left, top: r.top, width: r.width, height: r.height };
}

/**
 * 合成"链路槽"桩：只有 `getBoundingClientRect` 与 `querySelectorAll('.card')`。
 *
 * ⚠️ 它证明的是**被测函数真的按"末卡的外缘"算**（因为它喂的是我们写死的 rect），
 * 证明不了真实布局 —— 与文件头的能力边界一致。
 */
function slotStub(slotRect: DOMRect, cards: DOMRect[]): HTMLElement {
  return {
    getBoundingClientRect: () => slotRect,
    querySelectorAll: (sel: string) => (sel === '.card'
      ? cards.map((r) => ({ getBoundingClientRect: () => r }))
      : []),
  } as unknown as HTMLElement;
}

/** 合成"手牌"桩：`getBoundingClientRect` + `querySelectorAll('.card:not(.reveal-ghost)')` + `classList.contains`。 */
function handStub(handRect: DOMRect, cards: DOMRect[], reversed: boolean): HTMLElement {
  return {
    getBoundingClientRect: () => handRect,
    classList: { contains: (c: string) => c === 'reversed' && reversed },
    querySelectorAll: (sel: string) => (sel === '.card:not(.reveal-ghost)'
      ? cards.map((r) => ({ getBoundingClientRect: () => r }))
      : []),
  } as unknown as HTMLElement;
}

afterEach(() => {
  // 每个用例都必须**还原热座默认值**：本模块是进程级模块态，泄漏会让后面的用例（与时序相关
  // 的其他测试文件）读到错误座位 —— 这正是"模块态"这种设计必须付的纪律成本。
  setFxViewSeat(null);
});

describe('R3 · 视角座位的机制（fx-seat.ts）', () => {
  it('默认是热座（null），setFxViewSeat / applyFxViewSeat 幂等', () => {
    expect(fxViewSeat(), '模块默认必须是热座（否则热座页会读到竖向语义）').toBe(null);
    setFxViewSeat(1);
    expect(fxViewSeat()).toBe(1);
    setFxViewSeat(1); // 幂等：重复设同一个值不得有任何副作用
    expect(fxViewSeat()).toBe(1);
    setFxViewSeat(null);
    expect(fxViewSeat()).toBe(null);
    // applyFxViewSeat 交回"写进去的那个值" —— verifyPageHooks 的断言 4 靠它判断写入是否到达
    expect(applyFxViewSeat(0)).toBe(0);
    expect(fxViewSeat()).toBe(0);
    expect(applyFxViewSeat(1)).toBe(1);
  });

  it('外侧语义（**屏幕坐标**语义）：热座按绝对玩家左右，远程页"自己向下 / 对手向上"', () => {
    // 热座：与"P0 向左 / P1 向右"同源 —— `'start'` = 小坐标端（左）、`'end'` = 大坐标端（右）
    setFxViewSeat(null);
    expect(fxOuterFor(0)).toBe('start');
    expect(fxOuterFor(1)).toBe('end');
    // 远程页：我是 P1（viewSeat 0）→ 自己 = P0 在**下半**、向下生长 ⇒ 屏幕坐标**增大** = 'end'
    setFxViewSeat(0);
    expect(fxOuterFor(0), 'viewSeat=0 时 P0 是自己：向下生长 ⇒ 大坐标端').toBe('end');
    expect(fxOuterFor(1), 'viewSeat=0 时 P1 是对手：向上生长 ⇒ 小坐标端').toBe('start');
    // 远程页：我是 P2（viewSeat 1）→ **绝对号反了**，但"自己向下 / 对手向上"不变
    setFxViewSeat(1);
    expect(fxOuterFor(1), 'viewSeat=1 时 P1 是**自己**：向下生长 ⇒ 大坐标端').toBe('end');
    expect(fxOuterFor(0), 'viewSeat=1 时 P0 是**对手**：向上生长 ⇒ 小坐标端').toBe('start');
    // ⚠️ 这条是"上下对调"类 bug 的唯一入口：`FxOuter` 是**屏幕方向**，不是座位号。
    //    两种视角下"自己"的取值必须相同（都是 'end'），而绝对号必须相反。
    expect(fxOuterFor(0)).not.toBe(fxOuterFor(1));
  });

  it('轴向边/中心：vOuterEdgeOf 在 y 轴取 下/上、x 轴取 左/右（变异"上下对调"必红）', () => {
    const r = rect(10, 100, 130, 180);
    expect(vOuterEdgeOf(r, 'start', 'y'), 'start 在 y 轴 = 上缘（top）').toBe(100);
    expect(vOuterEdgeOf(r, 'end', 'y'), 'end 在 y 轴 = 下缘（bottom）').toBe(280);
    expect(vOuterEdgeOf(r, 'start', 'x')).toBe(10);
    expect(vOuterEdgeOf(r, 'end', 'x')).toBe(140);
    // 反向：两种语义不得互换（把实现里的 lo/hi 对调就会被这一句抓到）
    expect(vOuterEdgeOf(r, 'start', 'y')).not.toBe(vOuterEdgeOf(r, 'end', 'y'));
  });
});

describe('R3 · 链路落点（自己向下 / 对手向上）', () => {
  it('vStackEndPoint：x = 槽水平中心；y = 末卡外缘外侧（自己 +65 向下、对手 −65 向上）', () => {
    const slot = rect(200, 400, 140, 500);
    const last = rect(205, 800, 130, 180);   // 末卡（最新）落在槽的**下端**（自己侧）
    const stub = slotStub(slot, [last]);
    // ⚠️ 每个 `it` 都必须**自己设座位**（不依赖上一条的 afterEach 还原）：本模块是进程级状态，
    //    "靠前一条清理干净"这种隐含依赖会让**单跑与全跑结果不同** —— 我第一版就是那样，
    //    单跑绿、全跑红（`-t` 只跑这题时 seat 恰好是 null）。
    setFxViewSeat(0);
    const self = vStackEndPoint(stub, 0);
    expect(self.x, '竖排列里卡的水平中心 = 槽的水平中心').toBe(270);
    expect(self.y, '自己向下生长 ⇒ 落点在末卡**下缘外侧**（bottom(980) + 65）').toBe(1045);
    // 同一张末卡、另一个座位：对手向上 ⇒ 落点在末卡**上缘上方**
    const foe = vStackEndPoint(stub, 1);
    expect(foe.x).toBe(270);
    expect(foe.y, '对手向上生长 ⇒ 落点在末卡**上缘外侧**（top(800) − 65）').toBe(735);
    // 变异"上下对调"的直接判据
    expect(self.y, '自己与对手的落点必须在末卡的**不同一侧**').not.toBe(foe.y);
    expect(self.y).toBeGreaterThan(foe.y);
  });

  it('vStackEndPoint（R-F2 · I-3 第二处）：卡序按侧给之后，"最外端"取**极值卡**而不是"DOM 末位"', () => {
    const slot = rect(200, 400, 140, 500);
    // DOM 顺序按侧（与 `render.ts` 的 `order` 同源），负 margin-top ⇒ 后一个兄弟低 60.3px：
    //  · 自己侧（向下长）：[最旧 top=700, 最新 top=760.3] ⇒ 最外端 = **末位**（最新）的下缘；
    //  · 对手侧（向上长）：[最新 top=400, 最旧 top=460.3] ⇒ 最外端 = **首位**（最新）的上缘。
    const selfCards = [rect(205, 700, 130, 182), rect(205, 760.3, 130, 182)];
    const foeCards = [rect(205, 400, 130, 182), rect(205, 460.3, 130, 182)];
    setFxViewSeat(0);
    expect(vStackEndPoint(slotStub(slot, selfCards), 0).y,
      '自己侧（向下长）落点 = **末位**（最新）那卡的下缘外侧')
      .toBe(760.3 + 182 + 65);
    expect(vStackEndPoint(slotStub(slot, foeCards), 1).y,
      '对手侧（向上长）落点 = **首位**（最新）那卡的上缘外侧 —— 若取"DOM 末位"，'
      + '拿到的会是**最旧**那张（贴在协议一侧 = 内端），落点被算到链路**内部**')
      .toBe(400 - 65);
    // 反向留痕：对手侧若沿用"取末位"，期望值是 460.3 − 65（差一整张卡的步进），必须不是这个值
    expect(vStackEndPoint(slotStub(slot, foeCards), 1).y).not.toBe(460.3 - 65);
    // 单卡时两种取法等价（既有用例的形态 —— 这也是这条缺口一直没被看见的原因）
    expect(vStackEndPoint(slotStub(slot, [foeCards[0]]), 1).y).toBe(vStackEndPoint(slotStub(slot, [foeCards[0], foeCards[1]]), 1).y);
  });

  it('vStackEndPoint：空槽退化到槽的**内端**（自己 top(400) + 90 / 对手 bottom(900) − 90）', () => {
    // ⚠️ **判据修正（R15-3）**：本用例原来是 `990 / 310`（= 锚在槽的**外端**：自己 bottom(900) + 90、
    //    对手 top(400) − 90）。**旧期望是错的**：空链路时第一张卡真实落在**内端**（贴协议那一侧，
    //    由 `.grow-down` 的 `flex-start` / `.grow-up` 的 `flex-end` 与 `.stack` 的 `min-height`
    //    共同决定），所以落点必须锚内端 —— 新期望 `490 / 810`。旧句把"锚在外端"这个错误
    //    **固化成了绝对断言**，于是一整类特效（空链路打出 `playHandPlay` / 偏转 / 冰桥）把幽灵卡
    //    打在链路框外面（差一整跨 ≈419px）时，全套 1114 项仍然全绿。
    //    判据对象**确实变了**（`vStackEndPoint` 的空槽分支从 `vOuterEdgeOf(slotRect, outer, 'y')`
    //    改成翻转一转），所以这条断言必须改 —— 推导见 `src/ui/fx-seat.ts` 里那一段。
    const slot = rect(200, 400, 140, 500);
    const stub = slotStub(slot, []);
    setFxViewSeat(0);
    expect(vStackEndPoint(stub, 0).y, '自己侧（向下长、flex-start）⇒ 第一张贴**顶端**').toBe(490);
    expect(vStackEndPoint(stub, 1).y, '对手侧（向上长、flex-end）⇒ 第一张贴**底端**').toBe(810);
    // ⚠️ **这里不能沿用"自己更靠下"那条相对断言**（R15-3）：空槽的两支锚在**各自的槽**上，而
    //    远程页两侧的槽是**关于中线镜像**的两块矩形（对手列在上半、自己列在下半）——
    //    自己槽的内端是它的**顶**（490）、对手槽的内端是它的**底**（810）。"自己更靠下"只对
    //    "同一块矩形里的两个锚点"成立（即末卡那一支），跨两块镜像矩形时它本来就是错的命题。
    //    真正的不变式是：**空槽锚内端、末卡锚外端**（下面用绝对值和"两者不同"两条来钉）。
    // 绝对值判据：必须落在槽**内**（不是框外那一整跨），且距内端恰为 lift = 90
    const self = vStackEndPoint(stub, 0);
    const foe = vStackEndPoint(stub, 1);
    expect(self.y, '自己侧落点跑到槽框外了（旧缺陷：锚在外端 ⇒ 990，比槽下缘 900 还低 90）')
      .toBeLessThanOrEqual(slot.bottom);
    expect(self.y).toBeGreaterThanOrEqual(slot.top);
    expect(foe.y, '对手侧落点跑到槽框外了（旧缺陷：锚在外端 ⇒ 310，比槽上缘 400 还高 90）')
      .toBeGreaterThanOrEqual(slot.top);
    expect(foe.y).toBeLessThanOrEqual(slot.bottom);
    expect(slot.top + 90).toBe(self.y);
    expect(slot.bottom - 90).toBe(foe.y);
    // 内端的**方向**也跟着侧别镜像：自己是槽的顶、对手是槽的底
    expect(self.y, '自己侧的内端 = 槽顶（贴协议那一侧在上半）').toBeLessThan(slot.top + slot.height / 2);
    expect(foe.y, '对手侧的内端 = 槽底（贴协议那一侧在下半）').toBeGreaterThan(slot.top + slot.height / 2);
    // 反空集合：**末卡**那一支不许被这次改动带偏（它本来就锚外端、是对的）
    const last = rect(205, 800, 130, 180);
    const withCard = slotStub(slot, [last]);
    expect(vStackEndPoint(withCard, 0).y, '自己侧有卡时仍锚**末卡下缘外侧**（+65）').toBe(980 + 65);
    expect(vStackEndPoint(withCard, 1).y, '对手侧有卡时仍锚**末卡上缘外侧**（−65）').toBe(800 - 65);
    // 空槽 ⇄ 有卡 必须落在**不同**的锚点（同值会让"空槽分支根本没被走到"看不出来）
    expect(self.y).not.toBe(vStackEndPoint(withCard, 0).y);
    expect(foe.y).not.toBe(vStackEndPoint(withCard, 1).y);
  });

  it('**热座零变化（构造性）**：seat === null 时逐字段等于改动前的左右算式', () => {
    const slot = rect(200, 400, 140, 500);
    const last = rect(205, 800, 130, 180);
    const withCard = slotStub(slot, [last]);
    // ⚠️ **契约要点**：`fxStackEndPoint(slot, seat)` 里 `seat` 是"**没有视角座位时的绝对玩家号**"。
    //    热座页因此按 `fxViewSeat()` 的返回值（恒为 `null` ⇒ 非 0）走**大端那一支** —— 这**正是**
    //    "热座零变化"的含义：改动前的 `stackEndPos(slot, owner)` 在热座页调用时 owner 也**从不**是 0
    //    （热座的 P0 槽在左半边、由 `grow-left` 自己承担方向，落点助手服务的是 P1 那一侧）。
    expect(fxStackEndPoint(withCard, null), '热座落点与改动前（大端那一支）不一致')
      .toEqual({ x: 205 + 130 + 65, y: 400 + 500 / 2 });
    // 热座空槽：`owner === 0 ? slotRect.right - 90 : slotRect.left + 90` 的**大端支** = 左缘 + 90
    const empty = slotStub(slot, []);
    expect(fxStackEndPoint(empty, null, 1, 65, 90), '热座空槽落点与改动前不一致')
      .toEqual({ x: 200 + 90, y: 400 + 250 });
    // 对照：**远程页**同一入参必须给出竖向结果（否则"改了但没生效"），且**按该卡属主分侧**（C-1）
    setFxViewSeat(0);
    expect(fxStackEndPoint(withCard, fxViewSeat(), 0), '远程页（我是 P1）时 owner=P0 是**自己** ⇒ 末卡下缘外侧')
      .toEqual({ x: 270, y: 980 + 65 });
    // ⚠️ **C-1 的核心断言**：同一张末卡、同一个座位，只换"这张卡属于谁"，落点必须换到另一端。
    //    旧实现的 `outer = fxOuterFor(seat)` 让 `owner` 被吞掉 ⇒ 两侧给出**同一个点**。
    //    原守卫（本行）**故意不传 owner**，于是把"远程页恒 'end'"固化成了期望值 —— 已改成传属主。
    expect(fxStackEndPoint(withCard, fxViewSeat(), 1), '远程页（我是 P1）时 owner=P1 是**对手** ⇒ 末卡上缘外侧')
      .toEqual({ x: 270, y: 800 - 65 });
    expect(fxStackEndPoint(withCard, fxViewSeat(), 1), '自己列与对手列的落点必须落在**不同**的一端（C-1 的探针）')
      .not.toEqual(fxStackEndPoint(withCard, fxViewSeat(), 0));
    expect(fxStackEndPoint(withCard, fxViewSeat())).not.toEqual(fxStackEndPoint(withCard, null));
  });

  it('fxStackEndPoint 对 slot === null 返回 null（与改动前 `if (!slot) return null;` 等价）', () => {
    expect(fxStackEndPoint(null, null)).toBe(null);
    expect(fxStackEndPoint(null, 0)).toBe(null);
    expect(fxStackEndPoint(null, 1)).toBe(null);
    expect(fxStackEndPoint(null, null, 0)).toBe(null);
  });

  it('**热座按绝对玩家号**：owner 0 ⇒ 末卡左缘外侧、owner 1 ⇒ 右缘外侧（两个 owner 都被用到）', () => {
    const slot = rect(200, 400, 140, 500);
    const last = rect(205, 800, 130, 180);
    const stub = slotStub(slot, [last]);
    // 热座（seat === null）：方向由**调用方给的 owner**定 —— 改动前 `stackEndPos(slot, owner)` 的语义
    expect(fxStackEndPoint(stub, null, 0), 'owner 0 ⇒ 末卡左缘外侧').toEqual({ x: 205 - 65, y: 650 });
    expect(fxStackEndPoint(stub, null, 1), 'owner 1 ⇒ 末卡右缘外侧').toEqual({ x: 205 + 130 + 65, y: 650 });
    // 空槽的两支与"末卡"那支**不对称**（改动前就是如此：空槽锚在槽的**内侧**）
    const empty = slotStub(slot, []);
    expect(fxStackEndPoint(empty, null, 0), 'owner 0 空槽 ⇒ 槽右缘 − 90（内侧）').toEqual({ x: 340 - 90, y: 650 });
    expect(fxStackEndPoint(empty, null, 1), 'owner 1 空槽 ⇒ 槽左缘 + 90（内侧）').toEqual({ x: 200 + 90, y: 650 });
    // 省略 owner 时的兜底 = 大端（与改动前"默认非 0 ⇒ 右"一致）
    expect(fxStackEndPoint(stub, null)).toEqual(fxStackEndPoint(stub, null, 1));
  });

  /**
   * **C-1（G2 修正 R-F）**：远程页的落点必须由「**这张卡所属的绝对玩家** + 当前座位」共同决定。
   *
   * 旧实现 `const outer = seat !== null ? fxOuterFor(seat) : …` 把 `owner` 整个吞掉
   * （`fxOuterFor(currentSeat)` 的比较恒真 ⇒ 恒 `'end'`）⇒ 远程页**所有**落点都算在下端。
   * 评审探针实测"自己列与对手列给出同一个点"；可达路径见 `fxStackEndPoint` 的注释。
   *
   * 这里把**两个席位 × 自己/对手 = 四个组合**都写成**绝对断言**（不是"两者不同"这种相对断言
   * —— 一起写反时相对断言会互相抵消，本仓为此栽过两次）。
   */
  it('C-1：远程页按**该卡所属的绝对玩家**分侧（两个席位 × 自己/对手，四个绝对断言）', () => {
    const slot = rect(200, 400, 140, 500);
    const last = rect(205, 800, 130, 180);
    const withCard = slotStub(slot, [last]);
    const empty = slotStub(slot, []);
    // [座位, 这张卡的属主, 期望的末卡落点 y]
    const CASES: Array<[0 | 1, 0 | 1, string, number]> = [
      [0, 0, 'viewSeat=0：P0 是**自己** ⇒ 末卡**下缘**外侧（bottom 980 + 65）', 1045],
      [0, 1, 'viewSeat=0：P1 是**对手** ⇒ 末卡**上缘**外侧（top 800 − 65）', 735],
      [1, 1, 'viewSeat=1：P1 是**自己** ⇒ 末卡**下缘**外侧（bottom 980 + 65）', 1045],
      [1, 0, 'viewSeat=1：P0 是**对手** ⇒ 末卡**上缘**外侧（top 800 − 65）', 735],
    ];
    for (const [seat, owner, msg, want] of CASES) {
      setFxViewSeat(seat);
      expect(fxStackEndPoint(withCard, fxViewSeat(), owner), msg).toEqual({ x: 270, y: want });
      // 空槽同源：**锚在槽的内端**（自己 = 槽顶 + 90、对手 = 槽底 − 90；两种席位都查）。
      // ⚠️ **判据修正（R15-3）**：旧句是 `owner === seat ? slot.bottom + 90 : slot.top - 90`
      //    （= 锚在槽的**外端**）。**旧期望是错的** —— 空链路时第一张卡落在贴协议的**内端**
      //    （见 `src/ui/fx-seat.ts` 的空槽分支推导），落点必须随之锚内端。旧句把这个错误
      //    写成了绝对断言，正是它让"空链路特效落在框外一整跨（≈419px）"一直没被发现。
      const wantEmpty = owner === seat ? slot.top + 90 : slot.bottom - 90;
      expect(fxStackEndPoint(empty, fxViewSeat(), owner), `${msg}（空槽）`)
        .toEqual({ x: 270, y: wantEmpty });
      // 同一张卡：自己与对手必须落在**不同**的一端
      expect(fxStackEndPoint(withCard, fxViewSeat(), owner)).not.toEqual(
        fxStackEndPoint(withCard, fxViewSeat(), (1 - owner) as 0 | 1),
      );
    }
  });

  it('fxOuterForSeat（纯函数版）：座位由实参给（不读模块态）—— 模块态为 null 时也能按远程座位算', () => {
    // 模块态故意留成热座：纯函数版必须**不受影响**（这是 C-1 能"指名道姓"的前提）
    setFxViewSeat(null);
    expect(fxOuterForSeat(0, 0), 'viewSeat=0：P0 是自己 ⇒ 大坐标端（下）').toBe('end');
    expect(fxOuterForSeat(1, 0), 'viewSeat=0：P1 是对手 ⇒ 小坐标端（上）').toBe('start');
    expect(fxOuterForSeat(1, 1), 'viewSeat=1：P1 是自己 ⇒ 大坐标端（下）').toBe('end');
    expect(fxOuterForSeat(0, 1), 'viewSeat=1：P0 是对手 ⇒ 小坐标端（上）').toBe('start');
    // 热座（null）：与改动前的左右规则同源
    expect(fxOuterForSeat(0, null)).toBe('start');
    expect(fxOuterForSeat(1, null)).toBe('end');
    // `fxOuterFor` 是它的模块态版本：座位设成同一个值时两者必须逐字段相等
    for (const seat of [null, 0, 1] as const) {
      setFxViewSeat(seat);
      for (const p of [0, 1] as const) expect(fxOuterFor(p)).toBe(fxOuterForSeat(p, seat));
    }
  });
});

describe('R3 · 手牌落点在竖排下**不跟座位走**（规格 §1：手牌仍是横向的）', () => {
  const handRect = rect(300, 900, 600, 200);

  it('正排（远程页两个座位都传 reversed: false）⇒ 末尾在**右**（末卡右缘 + 37）', () => {
    const h = handStub(handRect, [rect(520, 910, 130, 180)], false);
    expect(handReversed(h)).toBe(false);
    expect(handOuterFor(h)).toBe('end');
    expect(fxHandEndPoint(h)).toEqual({ x: 650 + 37, y: 910 + 90 });
  });

  it('row-reverse（热座 P2）⇒ 末尾在**左**（末卡左缘 − 37）', () => {
    const h = handStub(handRect, [rect(520, 910, 130, 180)], true);
    expect(handReversed(h)).toBe(true);
    expect(handOuterFor(h)).toBe('start');
    expect(fxHandEndPoint(h)).toEqual({ x: 520 - 37, y: 910 + 90 });
  });

  it('**热座零变化**：seat 取何值都不影响手牌落点（判据是容器类名，不是座位/绝对玩家号）', () => {
    const h = handStub(handRect, [rect(520, 910, 130, 180)], false);
    const baseline = fxHandEndPoint(h);
    for (const seat of [null, 0, 1] as const) {
      setFxViewSeat(seat);
      expect(fxHandEndPoint(h), `seat=${String(seat)} 改变了手牌落点（手牌方向不该跟座位走）`).toEqual(baseline);
    }
  });

  it('空手牌退化落点也按容器排列方向（正排 → 右缘 + 93；row-reverse → 左缘 − 93）', () => {
    // ⚠️ 这里的数字看着"飞得远"（+93 / −93 之外还要跨过整个手牌宽带），是因为**合成手牌**
    //    的容器宽带 600px 远大于真实的一排手牌；判据是"**哪一侧**外移 93px"，不是绝对距离。
    expect(fxHandEndPoint(handStub(handRect, [], false)).x, '正排 ⇒ 从容器**右**缘再往外').toBe(900 + 93);
    expect(fxHandEndPoint(handStub(handRect, [], true)).x, 'row-reverse ⇒ 从容器**左**缘再往外').toBe(300 - 93);
    // 两个方向必须相反（写反了就会被这两句抓到）
    expect(fxHandEndPoint(handStub(handRect, [], false)).x).toBeGreaterThan(handRect.right);
    expect(fxHandEndPoint(handStub(handRect, [], true)).x).toBeLessThan(handRect.left);
    // 缺席的手牌容器：返回全 0（与改动前 `hand` 缺省时 `{top:0,height:0,left:0,right:0}` 兜底同义）
    expect(fxHandEndPoint(undefined)).toEqual({ x: 0, y: 0 });
  });
});

describe('R3 · 覆盖条带（自己侧露出上段 / 对手侧露出下段）', () => {
  const card = rect(100, 200, 130, 180);

  it('vVisibleStripRect：覆盖者在下（end）露出**上段**；覆盖者在上（start）露出**下段**', () => {
    // ⚠️ `FxOuter` 是**屏幕坐标方向**（'start' = 小坐标端 = 上，'end' = 大坐标端 = 下）。
    //    链路里"更新更靠外"的卡压住旧卡，而"往外"就是沿 `outer` 方向：
    //      · `'end'`（自己侧，向下生长）⇒ 覆盖者在卡**下**方 ⇒ 露出**上段**（锚点 = 卡顶）；
    //      · `'start'`（对手侧，向上生长）⇒ 覆盖者在卡**上**方 ⇒ 露出**下段**（锚点 = 覆盖者底）。
    //    ⚠️ 期望值必须按这个**推导**写，不能按"感觉"写 —— 我在源码里把这个方向写反过两次，
    //    而只用"start 与 end 必须不同"这类相对断言时**两次都没被发现**（一起写反就互相抵消了）。
    //    所以下面每一行都是把坐标代进公式手算出来的，并且**两侧都写出绝对值**。
    const fullyOver = rect(100, 200, 130, 180);   // 覆盖者与卡完全重合
    const endSide = vVisibleStripRect(card, fullyOver, 'end');      // 覆盖者在**下** ⇒ 露出上段
    expect(box(endSide), 'end：可露 0px ⇒ 抬到 minPx、锚点在卡顶')
      .toEqual({ left: 100, top: 200, width: 130, height: 6 });
    const startSide = vVisibleStripRect(card, fullyOver, 'start');  // 覆盖者在**上** ⇒ 露出下段
    expect(box(startSide), 'start：可露 0px ⇒ 抬到 minPx、锚点在卡底上方 6px')
      .toEqual({ left: 100, top: 380, width: 130, height: 6 });
    // 方向判据（**绝对**断言，不依赖两者互相比较）
    expect(endSide.top).toBeLessThan(startSide.top);
    // 下限：至少 6px（沿用改动前"至少保留 6px 可见"）
    expect(endSide.height, '可见带必须有 6px 下限（否则切割/放大类特效整块消失）').toBe(6);

    // 部分重叠：覆盖者 260..440（与卡 200..380 相交 120px = 卡的下段）
    //  · `'end'`（覆盖者在**下**）：露出上段 = [卡顶(200), 覆盖者顶(260)] ⇒ 60px
    expect(box(vVisibleStripRect(card, rect(100, 260, 130, 180), 'end')))
      .toEqual({ left: 100, top: 200, width: 130, height: 60 });
    //  · `'start'`（覆盖者在**上**）：露出下段 = [交集底(380), 卡底(380)] ⇒ 0 ⇒ 抬到 6px
    expect(box(vVisibleStripRect(card, rect(100, 260, 130, 180), 'start')))
      .toEqual({ left: 100, top: 380, width: 130, height: 6 });
    // 覆盖者 200..380（= 与卡完全重合）：交集 180px
    //  · `'end'`（覆盖者在**下**）⇒ 露出的上段 = [卡顶(200), 交集顶(200)] ⇒ 0 ⇒ 抬到 6px
    expect(box(vVisibleStripRect(card, rect(100, 200, 130, 180), 'end')))
      .toEqual({ left: 100, top: 200, width: 130, height: 6 });
    //  · `'start'`（覆盖者在**上**）⇒ 露出的下段 = [交集底(380), 卡底(380)] ⇒ 0 ⇒ 抬到 6px
    expect(box(vVisibleStripRect(card, rect(100, 200, 130, 180), 'start')))
      .toEqual({ left: 100, top: 380, width: 130, height: 6 });
  });

  it('vVisibleStripRect：可见带宽度 = 整卡宽（竖排的覆盖条带是**横带**，不是竖条）；且有 6px 下限', () => {
    const strip = vVisibleStripRect(card, rect(100, 260, 130, 180), 'end');
    expect(strip.width, '竖排下露出的是**整条宽度**的横带（不是右边那条竖条）').toBe(card.width);
    expect(strip.height).toBeLessThan(card.height);
    // 下限：两个方向都可能在"压满"时算出 ≤ 0，必须抬到 6px
    expect(vVisibleStripRect(card, rect(100, 200, 130, 180), 'end').height).toBe(6);
    expect(vVisibleStripRect(card, rect(100, 200, 130, 180), 'start').height).toBe(6);
  });

  it('vClipInsetPct：裁掉的**比例** = 卡 ∩ 覆盖者 / 卡高（两侧同源），并保住 0.94/0.02 两个夹子', () => {
    const over = rect(100, 260, 130, 180);   // 与卡竖直重叠 120px（卡 200..380、覆盖者 260..440）
    expect(vClipInsetPct(card, over, 'end'), '相交 120/180 ⇒ 裁 120/180').toBeCloseTo(120 / 180, 6);
    expect(vClipInsetPct(card, over, 'start'), '同一段交集 ⇒ 同一比例（比例本身与方向无关）')
      .toBeCloseTo(120 / 180, 6);
    // 覆盖者与卡完全重合（相交 = 整卡）⇒ 夹到 0.94
    expect(vClipInsetPct(card, rect(100, 200, 130, 180), 'end'), '完全覆盖必须夹到 0.94').toBe(0.94);
    // 几乎没覆盖 → 归 0（改动前 `if (!(hidden > 0.02)) return 0;` 的 0.02 下限）
    expect(vClipInsetPct(card, rect(100, 379, 130, 180), 'end'), '几乎没覆盖必须归 0').toBe(0);
    // 覆盖者在卡**外**（上方远处）⇒ 与卡的相交为 0 ⇒ **没有遮住卡** ⇒ 比例 0
    // （不是 0.94 —— "覆盖者在卡外"在真实布局里不可能发生；这里钉的是"按交集算"这条口径）
    expect(vClipInsetPct(card, rect(100, 0, 130, 180), 'end'), '覆盖者在卡外 ⇒ 交 0 ⇒ 0').toBe(0);
    expect(vClipInsetPct(rect(0, 0, 130, 0), rect(0, 0, 130, 180), 'end'), '零高卡不得除零').toBe(0);
    // ⚠️ **比例与方向无关**（两侧同源）—— 有方向的是 `vClipInsetCss` 的 **inset 形态**。
    //    这条断言与下一条成对：把"方向"错放进比例里会被这里抓到，反之由下一条抓。
    expect(vClipInsetPct(card, over, 'end')).toBeCloseTo(vClipInsetPct(card, over, 'start'), 6);
  });

  it('vClipInsetCss：`start`（覆盖者在上）裁上 `inset(X% 0 0 0)`、`end`（覆盖者在下）裁下 `inset(0 0 X% 0)`', () => {
    expect(vClipInsetCss(0.5, 'start')).toBe('inset(50.0% 0 0 0)');
    expect(vClipInsetCss(0.5, 'end')).toBe('inset(0 0 50.0% 0)');
    expect(vClipInsetCss(0.5, 'start')).not.toBe(vClipInsetCss(0.5, 'end'));
  });
});

/**
 * `gen3-util` 的 DOM 读取路径：合成 `document` 桩。
 *
 * 判据面只有 `document.querySelector('[data-uid="…"]')`（`nodeOf`），所以桩非常薄 ——
 * **不是**通用 DOM 桩，因此不会引入"桩与真实 DOM 偏差"那类假信心（见 render-net 的同类说明）。
 */
describe('R3 · 覆盖方向的 DOM 读取路径（gen3-util，合成 document 桩）', () => {
  /** 两张卡的合成局：stack[1] = 覆盖者（在数组更后面 = 更晚打出 = 新牌） */
  const state = {
    players: [
      { stacks: [[{ uid: 'a' }, { uid: 'b' }], [], []], hand: [] },
      { stacks: [[], [], []], hand: [] },
    ],
  } as unknown as Parameters<typeof visibleRectOf>[0];

  const R = { a: rect(100, 200, 130, 180), b: rect(100, 320, 130, 180) };

  /** 装一个只认 `[data-uid="…"]` 的 `document`；`fxRot` 决定两张卡的 `data-fx-rot` */
  function withFakeDocument(rotOf: (uid: string) => string | null): () => void {
    const prev = (globalThis as { document?: unknown }).document;
    const el = (uid: string): HTMLElement => ({
      getBoundingClientRect: () => R[uid as 'a' | 'b'],
      getAttribute: (n: string) => (n === 'data-fx-rot' ? rotOf(uid) : null),
    }) as unknown as HTMLElement;
    (globalThis as { document?: unknown }).document = {
      querySelector: (sel: string) => {
        const m = /\[data-uid="([^"]+)"\]/.exec(sel);
        return m ? el(m[1]) : null;
      },
    };
    return () => { (globalThis as { document?: unknown }).document = prev; };
  }

  it('覆盖方向读**覆盖卡自己的** data-fx-rot：ccw（自己，新牌在下方）⇒ end；cw（对手，新牌在上方）⇒ start', () => {
    // ⚠️ 必须**先**设座位：`coveredOuterOf` 的第一道门就是"热座 ⇒ null"（模块态默认 null）
    setFxViewSeat(0);
    const restore = withFakeDocument((uid) => (uid === 'b' ? 'ccw' : null));
    try {
      expect(coverUidOf(state, 'a'), '合成局的覆盖者必须是后一张（b）').toBe('b');
      expect(coveredOuterOf(state, 'a'), 'ccw = 自己侧：覆盖者在**下** ⇒ 屏幕大坐标端 end').toBe('end');
      expect(coveredOuterOf(state, 'a')).not.toBe('start');
    } finally { restore(); }
    const restore2 = withFakeDocument((uid) => (uid === 'b' ? 'cw' : null));
    try {
      expect(coveredOuterOf(state, 'a'), 'cw = 对手侧：覆盖者在**上** ⇒ 屏幕小坐标端 start').toBe('start');
    } finally { restore2(); }
  });

  it('**热座（座位为 null）时覆盖方向一律返回 null** ⇒ 调用方走原来的"覆盖者在右"', () => {
    const restore = withFakeDocument(() => 'ccw');
    try {
      setFxViewSeat(null);
      expect(coveredOuterOf(state, 'a'), '热座下不得走竖向覆盖逻辑（那是热座零变化的开关）').toBe(null);
      // 竖向判据的输入仍在（证明上一条不是因为"读不到标记"而 null）
      setFxViewSeat(0);
      expect(coveredOuterOf(state, 'a')).toBe('end');
    } finally { restore(); }
  });

  it('visibleRectOf：热座 = 左侧竖条（逐字段等于改动前）、远程页 = 上/下横带', () => {
    // 远程页（我是 P1）：覆盖者 b 带 `cw` ⇒ 'start'（= 覆盖者在卡的**上**方，按标记）。
    // 合成局几何：b 在 a 的**下方**（320..500 vs 200..380）⇒ 与 'start' 的语义**相反**。
    // 这个错配是**刻意**的：它证明方向判据读的是**标记**、而不是几何。
    // 按 'start' 走 = "露出下段" = [交集底(380), 卡底(380)] ⇒ 0 ⇒ 抬到下限 6px。
    const restore = withFakeDocument((uid) => (uid === 'b' ? 'cw' : null));
    try {
      setFxViewSeat(0);
      const v = visibleRectOf(state, 'a')!;
      expect(box(v), 'cw ⇒ start（覆盖者在上）⇒ 露出的下段 = [交集底(380), 卡底(380)] ⇒ 压到下限 6px')
        .toEqual({ left: 100, top: R.a.bottom, width: R.a.width, height: 6 });
      // 热座：露出**左侧竖条**（宽度 = 覆盖者左缘 − 本卡左缘，高度不变）
      setFxViewSeat(null);
      const h = visibleRectOf(state, 'a')!;
      expect(box(h)).toEqual({ left: 100, top: 200, width: Math.max(6, R.b.left - R.a.left), height: 180 });
      // 两种语义必须**不同**（同宽高时的相等会让"没改"与"改了"看起来一样）
      expect(v.width, '竖向必须是横带（整卡宽），不是竖条').not.toBe(h.width);
      expect(v.height, '竖向的高度与热座（整卡高）必须不同').not.toBe(h.height);
    } finally { restore(); }

    // 反面：同一个覆盖者改成 `ccw`（⇒ 'end' = 覆盖者在卡**下**方，按标记）⇒ 露出**上段** 120px
    const restore2 = withFakeDocument((uid) => (uid === 'b' ? 'ccw' : null));
    try {
      setFxViewSeat(0);
      const v2 = visibleRectOf(state, 'a')!;
      expect(box(v2), 'ccw ⇒ end（覆盖者在下）⇒ 露出的上段 = [卡顶, 覆盖者顶]')
        .toEqual({ left: 100, top: R.a.top, width: R.a.width, height: R.b.top - R.a.top });
      expect(v2.height, '两种覆盖方向必须给出不同的可见带').not.toBe(6);
    } finally { restore2(); }
  });

  it('clipInsetRightPct / clipInsetCss：热座裁右缘（逐字段等于改动前）、远程页按覆盖方向裁上/下', () => {
    // 远程页对照：**同一个覆盖者**分别带 ccw（⇒ 'end'）与 cw（⇒ 'start'）—— 比例相同（都是交集
    // 120/180），但 **inset 形态必须相反**（裁下 vs 裁上）。合成局几何是"覆盖者在卡的下方"，
    // 所以 end 与几何自洽、start 是刻意错配的那一半（证明判据真的读**标记**而不是读几何）。
    setFxViewSeat(0);
    for (const [marker, wantOuter, wantInset] of [
      // ccw ⇒ 'end'（覆盖者在下）⇒ 交集 = 卡 ∩ 覆盖者 = 60px（320..380）⇒ 裁 60/180、裁**下**
      ['ccw', 'end', `inset(0 0 ${((60 / 180) * 100).toFixed(1)}% 0)`],
      // cw ⇒ 'start'（覆盖者在上）⇒ 同一段交集 ⇒ 裁 60/180、裁**上**
      ['cw', 'start', `inset(${((60 / 180) * 100).toFixed(1)}% 0 0 0)`],
    ] as const) {
      const restore = withFakeDocument((uid) => (uid === 'b' ? marker : null));
      try {
        expect(coveredOuterOf(state, 'a'), `标记 ${marker} 的方向判据`).toBe(wantOuter);
        const pct = clipInsetRightPct(state, 'a');
        expect(pct, `标记 ${marker} 的裁剪比例（交集 60/180，两侧同源）`).toBeCloseTo(60 / 180, 6);
        expect(clipInsetCss(state, 'a', pct), `标记 ${marker} 的 inset 形态`).toBe(wantInset);
      } finally { restore(); }
    }

    // 热座对照：同一局面下裁**右缘**，与改动前那句算式逐字段相等（且与竖向结果不同）
    const restoreHot = withFakeDocument((uid) => (uid === 'b' ? 'cw' : null));
    try {
      setFxViewSeat(null);
      const hot = clipInsetRightPct(state, 'a');
      // 合成局里两张卡的**左缘对齐** ⇒ 被遮住的是"覆盖者的整个宽度" = 130/130 → 夹到 0.94。
      expect(hot, '热座 = 裁右缘（改动前算式 min(0.94, (r.right − cr.left) / r.width)）').toBe(0.94);
      expect(clipInsetCss(state, 'a', hot)).toBe(`inset(0 ${(hot * 100).toFixed(1)}% 0 0)`);
      setFxViewSeat(0);
      expect(clipInsetRightPct(state, 'a'), '竖向结果不得等于热座的右缘裁剪').not.toBeCloseTo(hot, 6);
    } finally { restoreHot(); }
  });

  it('未被覆盖的卡 / 取不到节点：返回整卡 rect 与 0（与改动前同语义）', () => {
    const restore = withFakeDocument((uid) => (uid === 'b' ? 'cw' : null));
    try {
      setFxViewSeat(0);
      // b 是顶卡（无人覆盖它）
      expect(visibleRectOf(state, 'b')).toBe(R.b);
      expect(clipInsetRightPct(state, 'b')).toBe(0);
      expect(coveredOuterOf(state, 'b')).toBe(null);
      // 状态里不存在的 uid → 取不到封面 → 返回整卡（不是抛异常）
      expect(coveredOuterOf(state, 'nope')).toBe(null);
    } finally { restore(); }
  });

  /**
   * **Minor M-3（G2 修正 R-F）**：`data-fx-rot` **读不到**时必须"显式契约 + 可诊断信号"，
   * 不能静默按常量 `'start'`（= 对手侧）兜底 —— 那会让自己列的被盖卡**静默反向**。
   *
   * 两条腿：
   *  ① `fxRotMarkerOf` 如实交回 `null`（与 `fxOrientOf` 的**回退**区分开："标记是 0°"和
   *     "没有标记"在 `fxOrientOf` 上不可区分）；
   *  ② 覆盖方向在缺失时按"**本卡属主 + 座位**"兜底（与标记同义）并 `console.warn` 一次。
   */
  it('Minor M-3：标记缺失可诊断 —— fxRotMarkerOf 交出 null，覆盖方向按属主兜底并 console.warn', () => {
    // ① 纯函数：合法取值原样、缺失/不认识 ⇒ null；而 fxOrientOf 会**回退**卡面朝向
    const node = (attrs: Record<string, string | null>): HTMLElement => ({
      classList: { contains: (): boolean => false },
      getAttribute: (n: string): string | null => attrs[n] ?? null,
    }) as unknown as HTMLElement;
    expect(fxRotMarkerOf(node({ 'data-fx-rot': 'ccw' }))).toBe('ccw');
    expect(fxRotMarkerOf(node({ 'data-fx-rot': 'cw' }))).toBe('cw');
    expect(fxRotMarkerOf(node({ 'data-fx-rot': 'nope' })), '不认识的值必须如实交回 null').toBe(null);
    expect(fxRotMarkerOf(node({})), '标记缺失必须如实交回 null（不能回退成卡面朝向）').toBe(null);
    expect(fxRotMarkerOf(null)).toBe(null);
    expect(fxOrientOf(node({})), 'fxOrientOf 在无标记时回退卡面朝向（这里无 rot 类 ⇒ 0）').toBe(0);
    expect(fxOrientOf(node({ 'data-fx-rot': 'ccw' })), '有标记时以标记为准（−90°）').toBe(-90);
    expect(fxOrientOf(node({ 'data-fx-rot': 'cw' }))).toBe(90);

    // ② 覆盖方向：标记缺失 ⇒ 按属主兜底（**不是**常量 'start'）
    const mkState = (player: 0 | 1, u1: string, u2: string): Parameters<typeof coveredOuterOf>[0] => ({
      players: [
        { stacks: player === 0 ? [[{ uid: u1 }, { uid: u2 }], [], []] : [[], [], []], hand: [] },
        { stacks: player === 1 ? [[{ uid: u1 }, { uid: u2 }], [], []] : [[], [], []], hand: [] },
      ],
    }) as unknown as Parameters<typeof coveredOuterOf>[0];
    const warned: string[] = [];
    const warn = vi.spyOn(console, 'warn').mockImplementation((...a: unknown[]) => {
      warned.push(a.map((x) => String(x)).join(' '));
    });
    try {
      setFxViewSeat(0);   // 我是 P0：P0 = 自己（下 / end）、P1 = 对手（上 / start）
      // uid 刻意用新值：诊断按 uid 去重，别让前面用例的调用把这条吞掉
      for (const [player, u1, u2, want] of [
        [0, 'm3-self-a', 'm3-self-b', 'end'],
        [1, 'm3-foe-a', 'm3-foe-b', 'start'],
      ] as const) {
        const st = mkState(player, u1, u2);
        const restore = withFakeDocument(() => null);   // 两张卡都**没有**标记
        try {
          expect(coveredOuterOf(st, u1), `属主 P${player + 1} 的兜底方向（旧实现恒 'start'）`).toBe(want);
        } finally { restore(); }
      }
      expect(warned.length, '标记缺失必须留下可诊断的 console.warn（否则这类退化完全无声）')
        .toBeGreaterThan(0);
      expect(warned.join('\n')).toContain('data-fx-rot');
      // 阳性对照：标记在时**不得**报警（否则诊断会变成噪声，没人再看它）
      warned.length = 0;
      const restoreOk = withFakeDocument((uid) => (uid === 'b' ? 'ccw' : null));
      try {
        expect(coveredOuterOf(state, 'a')).toBe('end');
      } finally { restoreOk(); }
      expect(warned, '标记存在时不应产生任何 warn').toEqual([]);
    } finally { warn.mockRestore(); }
  });
});

describe('R3 · 控制轨端归属（用户裁决：竖向，自己端在下 / 对手端在上）', () => {
  const track = rect(200, 400, 460, 120);

  it('**热座**（座位为 null）：横向 —— player 0 贴左端 4%、player 1 贴右端 96%（与 render.ts 同源）', () => {
    expect(fxTrackEndFor(null, 0)).toEqual({ pct: 0.04, axis: 'x' });
    expect(fxTrackEndFor(null, 1)).toEqual({ pct: 0.96, axis: 'x' });
    const p0 = fxTrackEndPos(track, null, 0);
    const p1 = fxTrackEndPos(track, null, 1);
    // 热座：`at` 只落在 x 轴上、y 恒为轨道中心
    expect(p0.x).toBeCloseTo(200 + 460 * 0.04, 6);
    expect(p1.x).toBeCloseTo(200 + 460 * 0.96, 6);
    expect(p0.y).toBe(460);
    expect(p1.y).toBe(460);
    expect(p0.x).toBeLessThan(p1.x);
  });

  it('**远程页**：竖向 —— 自己端在**下**（78%）、对手端在**上**（22%）；两种视角都对', () => {
    // ⚠️ **判据修正（R14-5）**：竖向取值从 96% / 4% 改成 **78% / 22%**。
    //    **旧句为什么必须改**：R14-1 把远程页控制卡改成"中心对齐坐标"并把滑块两端内缩到
    //    `CONTROL_EDGE_PCT_Y = 22`（卡高 70px、轨道 158px，4% 处中心仅 6.3px ⇒ 上半张卡出轨道），
    //    但 FX 落点这条竖向分支仍按旧的 4/96 算 ⇒ 卡片心在 34.76/123.24px、特效落在
    //    6.32/151.68px，**差 28.4px**（`fx-seat.ts` 自己写着"两处必须逐字一致"的不变式）。
    //    旧的 0.96/0.04 就是那个回归本身，所以必须改。
    //    **新句多查了什么**：① 竖向取值由 `FX_TRACK_EDGE_PCT_Y` 派生（不是字面量）；
    //    ② 与 `render.ts` 从**同一个常量**取到的值相等（下面第三条用例是那条可执行同源断言）；
    //    ③ 158px 轨道下的绝对像素落点与"卡片中心对齐 + 22%/78%"逐位相等（挡住"改回 4%"与
    //    "把 22 只改在渲染侧"两种变异）。
    // viewSeat = 0（我是 P1）：自己 = P0 ⇒ 下；对手 = P1 ⇒ 上
    expect(fxTrackEndFor(0, 0)).toEqual({ pct: 0.78, axis: 'y' });
    expect(fxTrackEndFor(0, 1)).toEqual({ pct: 0.22, axis: 'y' });
    // viewSeat = 1（我是 P2）：**绝对号反了**，但"自己在下"不变 ⇒ P1 在下、P0 在上
    expect(fxTrackEndFor(1, 1)).toEqual({ pct: 0.78, axis: 'y' });
    expect(fxTrackEndFor(1, 0)).toEqual({ pct: 0.22, axis: 'y' });
    const self = fxTrackEndPos(track, 0, 0);
    const foe = fxTrackEndPos(track, 0, 1);
    expect(self.at.axis).toBe('y');
    expect(self.x, '竖向的 x 恒为轨道中心').toBe(430);
    expect(foe.x).toBe(430);
    expect(self.y, '自己端 = 下端').toBeCloseTo(400 + 120 * 0.78, 6);
    expect(foe.y, '对手端 = 上端').toBeCloseTo(400 + 120 * 0.22, 6);
    // 变异"上下对调"的直接判据（**绝对**断言，不靠两者互相比较）
    expect(self.y).toBeGreaterThan(track.top + track.height / 2);
    expect(foe.y).toBeLessThan(track.top + track.height / 2);
    // 反向：换视角后"自己"仍在下（绝对号变了、端没变）
    expect(fxTrackEndPos(track, 1, 1).y).toBeCloseTo(self.y, 6);
    expect(fxTrackEndPos(track, 1, 0).y).toBeCloseTo(foe.y, 6);
  });

  /**
   * **R14-5 守卫（本轮新增 · 修复 1 的核心）**：竖向贴端距离与**渲染层的滑块停位**同源。
   *
   * 为什么必须有一条**可执行**的同源断言：`fx-seat.ts` 的 `FX_TRACK_EDGE_PCT` 注释里写着
   * "两处必须逐字一致，否则观感上像特效没打在滑块上" —— 而 R14-1 恰恰在**渲染侧**把竖向
   * 内缩到 22 / 78，FX 侧留在 4 / 96，1114 条测试**没有一条**发现（旧断言把 4/96 钉成了正确值）。
   *
   * 这条用例把两处**各自的取值**拿出来比对（而不是在源码里对字面量）：
   *  - 真跑 `renderControlModule({ axis: 'y' })` 两次（`holder` 0 / 1 = 竖向轨的小端 / 大端），
   *    **读回 DOM 上真正写进去的 `top` 百分比**（双 rAF 之后是终值）—— 那是"卡片实际停位"的
   *    唯一出处，也是 `styles-net.css` 第 9 节那套"中心对齐 + 22/78"真正落到像素上的一步；
   *  - 把 `fxTrackEndFor` 在**两个座位 × 两个玩家**上的竖向取值收成一个集合 —— 它必须与
   *    渲染层的两个停位**逐位相同**（`4/96` 会差 18% = 158px 轨道上 28.4px）。
   *
   * ⚠️ **判据的层级（重要，别把这条读成"逐玩家比对"）**：本用例钉的是**两个端点本身同源**
   *   （"贴在 22% 的那个端"与"FX 算作 22% 的那个端"是同一个数）。**逐玩家**的配对
   *   （"某玩家持有控制权时卡片与特效是否落在同一端"）是**另一个**判据，且它今天**不成立** ——
   *   见下面 ⑤ 的已知缺陷记录（用真实渲染器探针实测）。
   */
  it('R14-5：竖向 FX 的两个端点 == 渲染层写进 DOM 的两个停位（单一出处；158px 轨道下同像素）', () => {
    const restore = installStubDom();
    /** 双 rAF 的**确定性**收尾：`renderControlModule` 用 `rAF(rAF(write))` 做"先落上一帧位置、
     *  下一帧再过渡到目标位置"的动画。桩的 rAF 是 `setTimeout(0)`，靠 `await sleep` 猜时机
     *  在**模块级 `controlSliderPos`**（上一帧位置，跨用例存活）面前不可靠 ——
     *  所以这里把 rAF 回调**同步收集**起来，一个用例跑完它的两层 rAF 再读值。
     *  ⚠️ 必须**逐用例**跑完（不是"四个都渲染完再一起跑"）：四个模块共用同一个 `frameQueue` 时，
     *  外层回调会在执行时把内层回调追加到队尾，FIFO 跑完的顺序是
     *  `外层1,外层2,外层3,外层4,内层1,内层2,…`，而内层调用的 rAF 是在**渲染期**注册的
     *  （比后面的外层更早入队）⇒ 后面的外层会晚于前面的内层执行、**覆盖**前面已经写好的终值
     *  （实测：`78/22/78/22`，看起来像"模块自己算错了"，其实是测试的队列用法错了）。 */
    const frameQueue: Array<() => void> = [];
    (globalThis as { requestAnimationFrame: (fn: () => void) => number }).requestAnimationFrame =
      (fn: () => void) => { frameQueue.push(fn); return frameQueue.length; };
    /** 跑完当前队列里的两层 rAF（FIFO；内层回调会追加到队尾，跑到空为止）。 */
    const settle = (): void => {
      for (let guard = 0; frameQueue.length > 0 && guard < 100; guard++) frameQueue.shift()!();
    };
    try {
      // ── ① 渲染层：竖向轨的**两个停位**（holder 0 = 小端/上、holder 1 = 大端/下） ──
      const domStops: number[] = [];
      for (const holder of [0, 1] as const) {
        const s = { control: holder } as unknown as Parameters<typeof renderControlModule>[0];
        const mod = renderControlModule(s, { axis: 'y' });
        const img = (mod as unknown as { querySelector(sel: string): StubNode | null })
          .querySelector('.control-slider-img');
        expect(img, `holder=${holder}：竖向控制模块里找不到 .control-slider-img`).toBeTruthy();
        settle();   // 双 rAF：终值（不是"上一帧位置"）
        const written = img!.style.top;
        expect(typeof written, `holder=${holder}：滑块没有写内联 top（竖向位置无出处）`).toBe('string');
        domStops.push(Number(String(written).replace('%', '')));
      }
      // ── ② FX 侧：两个座位 × 两个玩家的竖向端点收成集合（必须恰好是两个数） ──
      const fxStops = new Set<number>();
      for (const seat of [0, 1] as const) {
        for (const to of [0, 1] as const) {
          const at = fxTrackEndFor(seat, to);
          expect(at.axis, `seat=${seat} to=${to}：远程页的竖向端点不再落 y 轴`).toBe('y');
          fxStops.add(Number((at.pct * 100).toFixed(6)));
        }
      }
      // ③ 同源判据：两个端点**逐位相同**（R14-1 的回归形态是渲染 22/78 vs FX 4/96）
      expect([...fxStops].sort((a, b) => a - b), 'FX 的竖向端点与渲染层写进 DOM 的停位不同源 ——'
        + '卡片与特效会错开（R14-1 的形态：FX 留在 4/96、卡片内缩到 22/78，差 18% = 28.4px）')
        .toEqual([...domStops].sort((a, b) => a - b));
      // 反空集合：必须就是 fx-seat 导出的那个常量派生的两个数（挡住"两边一起退回 4/96"）
      expect(domStops, '竖向停位不再是 FX_TRACK_EDGE_PCT_Y 派生的 22/78')
        .toEqual([FX_TRACK_EDGE_PCT_Y, 100 - FX_TRACK_EDGE_PCT_Y]);
      // ── ③b 像素：158px 轨道（styles-net.css 实测）上，两边落在**同样的两个像素** ──
      const track158 = rect(100, 200, 40, 158);
      const px = (pct: number): number => track158.top + track158.height * (pct / 100);
      const cardPx = [...domStops].sort((a, b) => a - b).map(px);
      const fxPx = [...fxStops].sort((a, b) => a - b).map(px);
      for (const [i, v] of fxPx.entries()) {
        expect(Math.abs(v - cardPx[i]), `端点 ${i}：卡片停位 ${cardPx[i].toFixed(2)}px 与 FX 落点 `
          + `${v.toFixed(2)}px 相差 ${Math.abs(v - cardPx[i]).toFixed(2)}px（R14-1 的回归是 28.44px）`)
          .toBeLessThan(0.001);
      }
      // 轨道 top = 200 ⇒ 小端 200 + 158×0.22 = 234.76、大端 200 + 158×0.78 = 323.24
      expect(cardPx[0], '小端像素（200 + 22% of 158 = 234.76）').toBeCloseTo(234.76, 6);
      expect(cardPx[1], '大端像素（200 + 78% of 158 = 323.24）').toBeCloseTo(323.24, 6);
      // ── ⑤ **已知缺陷记录（R14-5 探针发现；R16 已修，本条只留 FX 侧的事实）** ──
      //    用**真实渲染器**（`renderNetBoard(root, s, cb, { viewSeat })` + 桩 DOM，探针输出见本轮报告）
      //    核对时发现：`render-net.ts` 的 `netControlHolder` 把 `s.control`（**绝对玩家号**）
      //    当作 `fxSeatEndToPlayer` 的 `side`（**端**）参数用 ⇒ 持有控制权的是**自己**时它回 0，
      //    而渲染层的 `holder === 0` 贴**上**端 ⇒ **自己的控制卡停在对手端**（与"自己端在下、
   //    对手端在上"的用户裁决相反）；`fxTrackEndFor` 按座位算 ⇒ 特效在正确的下端。
      //    两者**端归属相反**，差 56% = 158px 轨道上 88.5px（远大于本条修掉的 28.4px）。
      //    ⚠️ **R16 已修**（本注释原来是"本轮不改"）：`renderControlModule` 的**位置端**与
      //    **归属玩家**拆成两个参数（`ControlTrackOpts.end` 缺省 = `holder` ⇒ 热座逐位不变），
      //    `render-net.ts` 用 `fxIsSelfSide` 按座位算端（`netControlEnd`）；换算函数
      //    `fxSeatEndToPlayer` 与它这次"方向反了"的误用一起删除（零调用）。
      //    下面两条断言**仍只钉 FX 侧**（FX 的 78% 在 R14-5 就是对的、R16 没动它）——
      //    "滑块位置 == FX 落点"的**逐 (座位, 持控者) 配对**判据在
      //    `tests/ui/net-control-end.test.ts`：本条承担不了它（它把 FX 侧两个数收成一个
      //    集合，对"配对是否对调"零判别力）。
      expect(fxTrackEndFor(0, 0).pct * 100, '自己（seat=0 的 P0）在 FX 侧贴大端（下）——'
        + '它是对的（用户裁决"自己端在下"）；渲染侧的滑块停位自 R16 起与它逐配对相等')
        .toBe(100 - FX_TRACK_EDGE_PCT_Y);
      expect(fxTrackEndFor(0, 0).pct, '竖向又变回 96% 了 —— R14-1 的 28.4px 回归')
        .not.toBeCloseTo(1 - FX_TRACK_EDGE_PCT / 100, 6);
    } finally {
      restore();
    }
  });

  it('**热座零变化**：轴向与百分比都不受座位污染（热座那一支必须仍是 4%/96% 的横向）', () => {
    setFxViewSeat(null);
    expect(fxTrackEndFor(fxViewSeat(), 0)).toEqual({ pct: 0.04, axis: 'x' });
    expect(fxTrackEndFor(fxViewSeat(), 1)).toEqual({ pct: 0.96, axis: 'x' });
    // 与竖向的取值**不同轴也不同端**（同值会让"没改"与"改了"看起来一样）
    expect(fxTrackEndFor(fxViewSeat(), 0).axis).not.toBe(fxTrackEndFor(0, 0).axis);
  });

  /**
   * **Minor M-5**：`fxIsSelfSide` —— "哪一端是自己"的**唯一判据**（原来这一句在
   * `gen3-control.ts` 的 `viewportFallback` 里就地写着，且**无单测**：评审 §D 的漏网处）。
   * 六个组合全部写成绝对断言。
   */
  it('Minor M-5：fxIsSelfSide 是"哪一端是自己"的唯一判据（六个组合，绝对断言）', () => {
    // 热座：自己 = 绝对 P0（与改动前的左右逻辑同源）
    expect(fxIsSelfSide(null, 0), '热座：P0 = 自己').toBe(true);
    expect(fxIsSelfSide(null, 1), '热座：P1 = 对手').toBe(false);
    // 远程页：自己 = 视角座位那一号（绝对号随席位翻转）
    expect(fxIsSelfSide(0, 0), 'viewSeat=0：P0 = 自己').toBe(true);
    expect(fxIsSelfSide(0, 1), 'viewSeat=0：P1 = 对手').toBe(false);
    expect(fxIsSelfSide(1, 1), 'viewSeat=1：P1 = 自己（绝对号反了，但"自己"不变）').toBe(true);
    expect(fxIsSelfSide(1, 0), 'viewSeat=1：P0 = 对手').toBe(false);
    // 与端归属**同向**：`fxTrackEndFor` 的"自己是哪一端"必须与它一致（改一处忘另一处就报红）
    for (const seat of [null, 0, 1] as const) {
      for (const p of [0, 1] as const) {
        const isSelf = fxIsSelfSide(seat, p);
        const at = fxTrackEndFor(seat, p);
        // 热座（x）：自己贴**小**端 4%（`FX_TRACK_EDGE_PCT`）；
        // 远程页（y）：自己贴**大**端 78%（`FX_TRACK_EDGE_PCT_Y` —— R14-5 起竖向另有其值）。
        // ⚠️ **判据修正（R14-5）**：旧句在竖向那一格写死 `0.96`（= `1 - 4/100`），
        //    于是"竖向的内缩该不该跟着渲染侧变"这条问题被旧断言**钉成了"不该"**。
        //    新句按轴取**各自的单一出处常量**，两条轴的数字都仍被绝对钉住（不是互相比较）。
        const selfAtSmallEnd = isSelf === (seat === null);
        expect(at.pct, `seat=${String(seat)} p=${p}：端归属与 fxIsSelfSide 不同向`)
          .toBe(seat === null
            ? (selfAtSmallEnd ? FX_TRACK_EDGE_PCT / 100 : 1 - FX_TRACK_EDGE_PCT / 100)
            : (selfAtSmallEnd ? FX_TRACK_EDGE_PCT_Y / 100 : 1 - FX_TRACK_EDGE_PCT_Y / 100));
      }
    }
  });

  /** **Minor M-5**：视口兜底的百分比（原来 0.82/0.18 就地写在 `gen3-control.ts`，无单测）。 */
  it('Minor M-5：fxTrackFallbackPct 自己在下（0.82）、对手在上（0.18），两个席位都对', () => {
    expect(fxTrackFallbackPct(null, 0), '热座：P0 = 自己 ⇒ 下端').toBe(0.82);
    expect(fxTrackFallbackPct(null, 1), '热座：P1 = 对手 ⇒ 上端').toBe(0.18);
    expect(fxTrackFallbackPct(0, 0), 'viewSeat=0：P0 = 自己 ⇒ 0.82').toBe(0.82);
    expect(fxTrackFallbackPct(0, 1), 'viewSeat=0：P1 = 对手 ⇒ 0.18').toBe(0.18);
    expect(fxTrackFallbackPct(1, 1), 'viewSeat=1：P1 = 自己 ⇒ 0.82（绝对号反了、端不变）').toBe(0.82);
    expect(fxTrackFallbackPct(1, 0), 'viewSeat=1：P0 = 对手 ⇒ 0.18').toBe(0.18);
    // 远程页：兜底端与端归属**同向**（自己都在大端/下）—— 改坏一个就会在这里报红
    for (const seat of [0, 1] as const) {
      for (const p of [0, 1] as const) {
        expect(fxTrackFallbackPct(seat, p) > 0.5, `viewSeat=${seat} p=${p}：兜底端与"自己在下"不同向`)
          .toBe(fxIsSelfSide(seat, p));
      }
    }
  });

  /** **Minor M-4**：贴端距离是**单一出处**（`render.ts` 的滑块从同一个常量取）。 */
  it('Minor M-4：FX_TRACK_EDGE_PCT 是贴端距离的单一出处（4% ⇒ 两条分支都派生自它）', () => {
    expect(FX_TRACK_EDGE_PCT, '贴端距离常量必须是 4（改动前的数值）').toBe(4);
    expect(fxTrackEndFor(null, 0).pct).toBe(FX_TRACK_EDGE_PCT / 100);
    expect(fxTrackEndFor(null, 1).pct).toBe(1 - FX_TRACK_EDGE_PCT / 100);
    // ⚠️ **R14-5 修正**：旧句在这里把**竖向**分支也钉成 `FX_TRACK_EDGE_PCT` 派生
    //    （`fxTrackEndFor(0, 0).pct === 1 - FX_TRACK_EDGE_PCT / 100`）—— 而 R14-1 之后竖向
    //    的贴端距离**不再等于横向**（渲染侧内缩到 22/78）。那条旧句正是"把回归钉成正确值"的
    //    原因之一，必须改。
    //    **新句多查了什么**：竖向改用**自己的**单一出处 `FX_TRACK_EDGE_PCT_Y` 派生，
    //    且两个常量必须**互不相等**（同值会让"两条轴各有一个数字"这条要求形同虚设）。
    expect(FX_TRACK_EDGE_PCT_Y, '竖向贴端距离常量必须是 22（R14-1 为"卡片中心对齐"选的数值）').toBe(22);
    expect(fxTrackEndFor(0, 0).pct).toBe(1 - FX_TRACK_EDGE_PCT_Y / 100);
    expect(fxTrackEndFor(0, 1).pct).toBe(FX_TRACK_EDGE_PCT_Y / 100);
    expect(FX_TRACK_EDGE_PCT_Y, '横竖两条轴的贴端距离不能是同一个数（否则总是有一个是错的）')
      .not.toBe(FX_TRACK_EDGE_PCT);
  });
});

/* ============================================================================
 * 源码守卫：两个渲染器在方向模型上的**归属**（谁是 null、谁给座位）
 * ========================================================================== */

describe('R3 · 源码守卫（方向模型的接线）', () => {
  const root = new URL('../../src/ui/', import.meta.url);
  const read = (rel: string): string => stripComments(
    readFileSync(fileURLToPath(new URL(rel, root))).subarray(0, 8 * 1024 * 1024).toString('utf8'),
  );

  it('远程页在渲染时**设一次**座位（唯一调用点），且用 applyFxViewSeat 把写入值交回自查', () => {
    const src = read('render-net.ts');
    const calls = src.match(/\bapplyFxViewSeat\s*\(/g) ?? [];
    expect(calls.length, `render-net.ts 必须**恰好**调用一次 applyFxViewSeat（设座位），实际 ${calls.length} 次`)
      .toBe(1);
    expect(src, '座位不是从 opts.viewSeat 取的（凭空写常量 = 视角切换失效）')
      .toMatch(/applyFxViewSeat\(\s*opts\.viewSeat\s*\)/);
    // 设座位必须早于"把棋盘结构挂进 grid"的调用（几何/FX 都要在座位定下来之后才可能对）。
    // ⚠️ 锚点必须选一个**只在真实代码里出现**的调用：裸 `renderStackSlot(` 在文件靠前的
    //    `NET_PAGE_HOOKS` 数据表（`call: ['renderStackSlot(']`）里就命中一次 —— 我第一版就是
    //    那么写的，断言读到的是**表里那个字符串**（index 比设座位还小），判据完全失效。
    //    这与 render-net 的守卫反复强调的"表不是证据"是同一条纪律。
    const iSeat = src.indexOf('applyFxViewSeat(opts.viewSeat)');
    const iFirstMount = src.indexOf('grid.appendChild(renderControlModule(');
    expect(iSeat, '找不到设座位的调用').toBeGreaterThanOrEqual(0);
    expect(iFirstMount, '找不到 renderStackSlot( 的挂载点（结构被改？）').toBeGreaterThanOrEqual(0);
    expect(iSeat, '座位设在挂载之后 ⇒ 本帧前段的方向判断会用上一帧的座位').toBeLessThan(iFirstMount);
    // 自查必须把"写进去的那个值"带上（约束 9 的契约链检查靠它）
    // ⚠️ R11-3：调用形态多了第 3 个实参（行动方 / 操作方）⇒ 判据从"`)` 紧跟 seatApplied"
    //    放宽成"seatApplied 作为第 2 个实参"（仍要求那个值被交进去，只是不再禁止多传参数）。
    expect(src, 'verifyPageHooks 未收到渲染期写进去的座位（约束 9 会失去判据）')
      .toMatch(/verifyPageHooks\(\s*wrap\s*,\s*seatApplied\b/);
  });

  it('**热座页不许碰座位**：render.ts 里不出现 applyFxViewSeat / setFxViewSeat（热座恒 null 的构造性证明）', () => {
    const src = read('render.ts');
    expect(src, 'render.ts 出现了座位写入 —— 热座页会读到非 null 座位，"热座零变化"被破坏')
      .not.toMatch(/\b(apply|set)FxViewSeat\s*\(/);
    // 反向：远程页**必须**有（否则上一条会在"两边都没有"时静默通过）
    expect(read('render-net.ts')).toMatch(/\bapplyFxViewSeat\s*\(/);
    // 座位模块本身必须把默认值定义成热座
    expect(read('fx-seat.ts'), 'fx-seat.ts 的热座默认值不是 null')
      .toMatch(/FX_VIEW_SEAT_HOTSEAT:\s*FxViewSeat\s*=\s*null/);
  });

  it('方向判断**不再**按绝对玩家写死：落点助手必须把绝对玩家号**继续传给** fx-seat（热座那一支靠它）', () => {
    const eff = read('effects/index.ts');
    // ⚠️ 判据的**方向**很重要：R3 **不是**"把 owner 删掉"，而是"把方向判断集中到 fx-seat"。
    //    `owner` 必须继续传 —— 热座下 `fxViewSeat()` 恒 `null`，左右方向就靠这个绝对玩家号定；
    //    删掉它会让热座页 P0 那一半的落点**静默翻边**（本任务的红线）。所以这里钉的是：
    //    ① owner 仍从 payload 取出并传给落点助手；② 那个助手内部只经 fx-seat 判方向。
    expect(eff, 'stackEndPos 未把绝对玩家号继续传下去（热座左右方向会翻边）')
      .toMatch(/function stackEndPos\(slot: HTMLElement \| null, owner: PlayerId\)[\s\S]{0,200}fxStackEndPoint\(slot, fxViewSeat\(\), owner\)/);
    expect(eff, 'stackEndPos 又在函数内部按绝对玩家选边了（方向判断必须集中在 fx-seat）')
      .not.toMatch(/function stackEndPos\([\s\S]{0,400}owner === 0 \?/);
    expect(eff, 'handEndPos 又按绝对玩家选边了（手牌方向由容器排列方向定，不跟座位/绝对玩家走）')
      .not.toMatch(/function handEndPos\([^)]*owner/);
    expect(eff, 'handEndPos 未走 fxHandEndPoint').toMatch(/fxHandEndPoint\(hand\)/);
    // fx-gen2 的两处链路落点助手：不得再自己按 owner 选边，必须经 fxStackEndPoint
    const g2 = read('fx-gen2.ts');
    for (const fn of ['iceStackEnd', 'smokeStackEnd']) {
      expect(g2, `${fn} 又按绝对玩家写死了落点边（远程页会飞到屏幕外）`)
        .not.toMatch(new RegExp(`function ${fn}\\([^)]*\\)[^{]*\\{[\\s\\S]{0,400}owner === 0 \\?`));
      expect(g2, `${fn} 未把 owner 继续传给 fxStackEndPoint（热座左右会翻边）`)
        .toMatch(new RegExp(`function ${fn}\\([^)]*\\)[^{]*\\{[\\s\\S]{0,300}fxStackEndPoint\\(slot, fxViewSeat\\(\\), owner\\)`));
    }
  });

  it('gen3-util 的覆盖方向按**覆盖卡自己的** data-fx-rot 判（而不是按绝对玩家号）', () => {
    const src = read('gen3-util.ts');
    // ⚠️ **R-F（Minor M-3）的判据修正**：读取口由 `fxOrientOf(coverNode)` 改成
    //    `fxRotMarkerOf(coverNode)`。理由：`fxOrientOf` 会把"标记缺失"**回退**成**卡面**朝向
    //    （远程页卡面 0°/180°）⇒ 恒判成"不是 ccw" ⇒ 静默按对手侧兜底（自己列反向）。
    //    **原能抓什么**：覆盖方向不读覆盖卡**自己**的标记（改成按绝对玩家号/按本卡朝向）。
    //    **现在还能抓什么**：同上（仍必须读**覆盖卡节点自己**的标记），并多一条：
    //    必须用"能如实区分缺失"的读取口。
    //    **为什么新的更贴规格**：§8.2 把标记定为承重输入，缺失必须能被发现而不是被回退吃掉。
    expect(src, 'coveredOuterOf 未读覆盖卡**自己**的特效朝向标记').toMatch(/fxRotMarkerOf\(coverNode\)/);
    expect(src, '覆盖方向又按绝对玩家号判了（竖排下"哪一侧在上"取决于座位，不是绝对号）')
      .not.toMatch(/coveredOuterOf[\s\S]{0,300}player === 0 \?/);
    // 热座开关必须在：没有它，"覆盖者在右"的原逻辑就再也走不到了
    expect(src, 'coveredOuterOf 缺"热座 ⇒ null"的开分支（热座会走竖向覆盖）')
      .toMatch(/fxViewSeat\(\)\s*===\s*null\)\s*return null/);
    // **兜底的显式契约**（Minor M-3）：标记缺失 ⇒ 按"该卡属主 + 座位"兜底（`fxOuterFor(loc.player)`，
    // 与标记**同义**），**不能**是常量 'start'（那会让自己列静默反向）；且必须留下可诊断信号。
    expect(src, '覆盖方向在标记缺失时又退化成常量方向了（自己列会静默反向）')
      .toMatch(/warnMissingFxRot\(cover\)[\s\S]{0,500}fxOuterFor\(loc\.player\)/);
    expect(src, '标记缺失没有可诊断信号（console.warn）—— 这类退化在页面上完全无声')
      .toMatch(/console\.warn\(/);
    // 两处旧算式必须真的还在（热座零变化是"搬运"而不是"重写"）
    expect(src, '热座分支的"覆盖者在右"算式被删了').toMatch(/cr\.left - r\.left/);
    expect(src, '热座分支的"裁右缘"算式被删了').toMatch(/\(r\.right - cr\.left\) \/ r\.width/);
  });

  /**
   * **R15-4（源码腿）：`coveredOuterOf` 的文档与实现必须同向**
   *
   * ## 被守的缺陷（纯文档，但**会把人带沟里**）
   *
   * `gen3-util.ts` 的 `@returns` 曾写"`'start'` = 覆盖者在小端（远程自己侧，露出**上段**）；
   * `'end'` = 覆盖者在大端（远程对手侧，露出**下段**）" —— 与**同一文件** `:114-115` 的实现
   * （`ccw`（自己）→ `'end'`、`cw`（对手）→ `'start'`）、文件头 `:12-13` 的"ccw = 覆盖者在下 /
   * cw = 覆盖者在上"，以及消费方 `fx-seat.ts` 的 `vVisibleStripRect`（"`'end'`（自己侧）⇒
   * 覆盖者在下 ⇒ 露出上段"）**全部相反**。这是本仓反复栽的那一类"文档与实现各说一套，
   * 而单测只会跟着实现写"的形态 —— 实现是对的，注释是错的。
   *
   * ## 这条守卫能抓什么、不能抓什么
   *
   * 能：`coveredOuterOf` 的 `@returns` 里两边都说成"自己侧 ⇒ `'end'`"（= 与实现同向）——
   * 把注释改回写反的那一版**必红**（变异实测见报告）。
   * **不能**：注释措辞的其它变化（换词、英文、加句）。它不是"注释正确性"的通用判据，
   * 只钉这一处**曾经真写反过**的方向词。
   */
  it('R15-4：coveredOuterOf 的 @returns 与实现同向（自己侧 = end），且不再留写反的那句', () => {
    // ⚠️ 本用例查的是**注释**，所以不能用上面的 `read`（它对源码跑 `stripComments`，
    //    注释已被替换成空白 —— 我第一版就是这样，锚点找不到、报错信息还指向"片切范围失效"）。
    const raw = readFileSync(fileURLToPath(new URL('gen3-util.ts', root)))
      .subarray(0, 8 * 1024 * 1024).toString('utf8');
    // 取 `coveredOuterOf` 的**文档注释**：从它的 `@returns` 起、到 `export function coveredOuterOf(`
    // 之前为止（实现体里没有 `@returns`，所以这段就是注释）。
    const ret = raw.indexOf('@returns `null` = 热座');
    const fnAt = raw.indexOf('export function coveredOuterOf(');
    expect(ret, 'coveredOuterOf 的 @returns 那句找不到（片切锚点失效 —— 先复核再改判据）')
      .toBeGreaterThan(-1);
    expect(fnAt, '找不到 export function coveredOuterOf(').toBeGreaterThan(ret);
    const doc = raw.slice(ret, fnAt);
    expect(doc, '找不到 coveredOuterOf 的文档注释（片切范围失效 —— 先复核再改判据）')
      .toContain('@returns');
    expect(doc, 'coveredOuterOf 的 @returns 把"自己侧"说成了 start（与实现相反：ccw（自己）⇒ end）')
      .toMatch(/'end'` = 远程\*\*自己侧\*\*/);
    expect(doc, 'coveredOuterOf 的 @returns 把"对手侧"说成了 end（与实现相反：cw（对手）⇒ start）')
      .toMatch(/'start'` = 远程\*\*对手侧\*\*/);
    // 反空集合：写反的那句**文案本身**不许再出现（否则"改回来"会以另一种措辞复活）
    expect(doc, 'written-backwards 的旧文案又出现了（start = 自己侧 / end = 对手侧）')
      .not.toMatch(/'start'` = 覆盖者在小端/);
    expect(doc, 'written-backwards 的旧文案又出现了（end = 对手侧）')
      .not.toMatch(/'end'` = 覆盖者在大端/);
    // 同向的第二处：文件头 `vOuter` 命名表的括号里也必须是自己侧 = end
    expect(raw, '文件头 vOuter 命名表又把自己侧写成 start 了（与 @returns 是同一处错的孪生）')
      .toMatch(/'end'` = 大端 = \*\*自己侧\*\*/);
  });

  it('fx-seat.ts 提供热座与竖向两套分支（把 null 分支删掉 = 热座观感变化）', () => {
    const src = read('fx-seat.ts');
    // 热座那一支必须**仍是横向**（走 x 轴），且必须由 owner 决定左右
    expect(src, 'fxStackEndPoint 缺"热座 ⇒ 横向按 owner"这一支（x 轴的末卡落点算式不见了）')
      .toMatch(/vOuterEdgeOf\(r, outer, 'x'\) \+ step \* lead/);
    // 竖向变体自己的算式（与统一入口共用同一套"外侧边 + 沿轴外移"）
    expect(src, 'vStackEndPoint 缺 lead 的外移算式').toMatch(/vOuterEdgeOf\(last\.getBoundingClientRect\(\), outer, 'y'\) \+ step \* lead/);
    // ⚠️ **判据修正（R15-3）**：旧句逐字钉住了**错的那一半** —— `vOuterEdgeOf(slotRect, outer, 'y') + step * lift`
    //    （锚在槽的**外端**）。改成锚内端之后，判据改为"同一条 `vOuterEdgeOf(slotRect, …, 'y') + step * lift`
    //    算式仍在，只是把 outer 翻转一转" —— 既守住"空槽用 lift 外移"这条不变式，又不再把错误固化成正确值。
    expect(src, 'vStackEndPoint 缺空槽的 lift 算式').toMatch(/vOuterEdgeOf\(slotRect, outer === 'start' \? 'end' : 'start', 'y'\) \+ step \* lift/);
    // ⚠️ **C-1 的判据修正（钉规格，不再钉那句错表达式）**：
    //    原判据逐字钉住 `seat !== null ? fxOuterFor(seat) : (owner ?? 1) === 0 ? 'start' : 'end'`
    //    —— 那正是**吞掉 owner** 的写法：`fxOuterFor(seat)` 里的比较用的是**模块态座位**，
    //    而实参也是当前座位 ⇒ 恒真 ⇒ 远程页恒 `'end'`（对手列落点算在下端）。
    //    把它改对（按 owner 分侧）反而报红，失败信息还误导成"热座 P0 会翻边"。
    //    **现在钉的是规格**：外端一律由**该卡所属的绝对玩家**（owner）与座位共同决定 ——
    //      · 热座分支：`fxOuterForSeat(owner ?? 1, null)`（owner 0 ⇒ 左、1 ⇒ 右，兜底保留）；
    //      · 远程分支：把 **owner**（不是 seat）交给竖向落点助手。
    //    **原能抓什么**：`owner ?? 1` 的兜底被删（热座 P0 翻边）。**现在还能抓什么**：同上，
    //    外加 C-1 本身（远程分支必须用 owner 定外端、且判定只经 `fxOuterForSeat` 这一个纯函数）。
    expect(src, '热座方向未由绝对玩家号决定（owner ?? 1 的兜底没了 ⇒ 热座 P0 会翻边）')
      .toMatch(/fxOuterForSeat\(owner \?\? 1, null\)/);
    expect(src, '远程方向未由**该卡所属的绝对玩家**决定（C-1：owner 被吞掉 ⇒ 远程页所有落点都算在下端）')
      .toMatch(/if \(seat !== null\) return vStackEndPoint\(slot, owner \?\? seat, lead, lift, seat\)/);
    // 竖向落点助手的第一个参数**是属主**（Minor M-2：它曾叫 `seat`，与实参语义不符）
    expect(src, 'vStackEndPoint 的参数名/语义又退回"座位"了（Minor M-2 的命名混乱会复发）')
      .toMatch(/vStackEndPoint\(\s*slot: HTMLElement, owner: PlayerId/);
    expect(src, 'vStackEndPoint 未显式吃座位（实参座位与模块态座位可能不一致 ⇒ 落点静默算错）')
      .toMatch(/seat: FxViewSeat = fxViewSeat\(\)/);
    expect(src, '外端的唯一判据不是 fxOuterForSeat（纯函数版）')
      .toMatch(/export function fxOuterForSeat\(player: PlayerId, seat: FxViewSeat\): FxOuter/);
    expect(src, 'vVisibleStripRect 缺 minPx 下限').toMatch(/Math\.max\(minPx,/);
    expect(src, 'vClipInsetPct 缺 0.94 上限').toMatch(/Math\.min\(maxPct,/);
    expect(src, '热座默认值是 null（热座零变化的开关）').toMatch(/FX_VIEW_SEAT_HOTSEAT: FxViewSeat = null/);
    // Minor M-1：两个零调用的导出已删（留着会让人以为它们是方向模型的入口）
    // ⚠️ **R16 追加**：`fxSeatEndToPlayer` 也在这条纪律下删除了（它的唯一调用点把它当
    //    "绝对号 ⇒ 端"用 —— 方向反了，正是 R16 修的缺陷）。判据一并加进来，防止它被
    //    "看起来有用"地搬回来（"端 ⇒ 绝对号"这条换算今天全仓不需要：位置端由
    //    `render-net.ts` 的 `netControlEnd` 现算，FX 落点由 `fxTrackEndFor` 直接给）。
    expect(src, 'seatIndexFor / isSelfViewOf / fxSeatEndToPlayer 又出现了（零调用死代码，会误导下一个人）')
      .not.toMatch(/export function (seatIndexFor|isSelfViewOf|fxSeatEndToPlayer)\(/);
  });

  it('控制轨端归属走**单一出处**（fx-seat 的 fxTrackEndFor），且 gen3-control 不再自己按绝对玩家选边', () => {
    const ctrl = read('gen3-control.ts');
    expect(ctrl, '控制轨落点未走 fx-seat 的纯函数（方向判据会与 fx-seat 漂移）')
      .toMatch(/fxTrackEndPos\(r, fxViewSeat\(\), to\)/);
    expect(ctrl, 'gen3-control 里又自己写了绝对玩家的 4%/96%（两处口径会打架）')
      .not.toMatch(/const pct = to === 0 \? 0\.04 : 0\.96;/);
    expect(ctrl, '轴向判据未按座位分支').toMatch(/fxViewSeat\(\) === null \? 'x' : 'y'/);
    // Minor M-5：视口兜底的**方向**必须来自 fx-seat（原来就地 `to === fxViewSeat()`，无单测）
    expect(ctrl, '视口兜底又在原地按座位算方向了（评審 §D 的漏网处会复发）')
      .toMatch(/y: window\.innerHeight \* fxTrackFallbackPct\(fxViewSeat\(\), to\)/);
    expect(ctrl, 'viewportFallback 里仍留着就地判方向的表达式')
      .not.toMatch(/fxViewSeat\(\) === null \? to === 0 : to === fxViewSeat\(\)/);
    const seat = read('fx-seat.ts');
    // ⚠️ **判据修正（Minor M-4）**：热座那两个数字（4%/96%）现在由**一个常量**派生，
    //    不再是字面量 `0.04`/`0.96`。原判据逐字钉 `{ pct: to === 0 ? 0.04 : 0.96, axis: 'x' }`
    //    —— 那样"单一出处"这条要求本身（render.ts 也必须从这里取）就永远钉不住。
    //    现在钉的是**语义**：两条分支的取值都必须经 `fxIsSelfSide`（唯一方向判据）、
    //    贴端距离必须来自 `FX_TRACK_EDGE_PCT`，且 `render.ts` 必须引用同一个常量。
    expect(seat, 'fxTrackEndFor 的热座分支被删（热座控制轨会换端）')
      .toMatch(/seat === null\s*\n?\s*\? \{ pct: fxIsSelfSide\(seat, to\) \? FX_TRACK_EDGE : 1 - FX_TRACK_EDGE, axis: 'x' \}/);
    // ⚠️ **判据修正（R14-5）**：竖式分支的贴端距离从 `FX_TRACK_EDGE`（4/96）改成
    //    `FX_TRACK_EDGE_Y`（22/78）。**旧句为什么必须改**：它就是被 R14-1 打破的那一半不变式
    //    （渲染侧内缩了、FX 侧没内缩 ⇒ 差 28.4px），旧句把 4/96 钉成了正确值，所以 1114 条
    //    测试全绿却没人发现。**新句多查了什么**：① 竖向必须用 `FX_TRACK_EDGE_Y`；
    //    ② 那个常量必须是 22；③ `render.ts` 的 `CONTROL_EDGE_PCT_Y` 必须**从同一个常量取**
    //    （下面两条断言）—— 于是"改一处忘另一处"在源码腿上也会报红。
    expect(seat, 'fxTrackEndFor 缺"自己在下、对手在上"的竖向分支')
      .toMatch(/pct: fxIsSelfSide\(seat, to\) \? 1 - FX_TRACK_EDGE_Y : FX_TRACK_EDGE_Y, axis: 'y' \}/);
    expect(seat, '贴端距离不是单一出处常量（Minor M-4）').toMatch(/export const FX_TRACK_EDGE_PCT = 4;/);
    expect(seat, '竖向贴端距离不是单一出处常量（R14-5）').toMatch(/export const FX_TRACK_EDGE_PCT_Y = 22;/);
    // Minor M-4 的另一半：render.ts 必须**从这个常量取值**（两边各写死一个 4 就是原缺陷）
    const renderSrc = read('render.ts');
    expect(renderSrc, 'render.ts 的控制轨贴端距离又写死成字面量了（两处会各自漂移）')
      .toMatch(/const CONTROL_EDGE_PCT = FX_TRACK_EDGE_PCT;/);
    // ⚠️ **判据修正（R14-7）**：旧句把整条 import 逐字钉成
    //    `import { FX_TRACK_EDGE_PCT, FX_TRACK_EDGE_PCT_Y } from './fx-seat';`。
    //    **旧句为什么必须改**：R14-7 让 `render.ts` 从**同一个模块**多取了 `fxViewSeat`
    //    （锁环尺寸的页面判据），导入列表因此变长 —— 旧句要求 `_Y` 后面**紧跟 `}`**，
    //    于是同一行**合法且正确**的 import 被判成"没 import"（假红）。
    //    **新句多查了什么**：先把 `render.ts` 里所有来自 `./fx-seat` 的 import 行解析出**具名
    //    列表**（`{ … }` 里的逗号分隔项，去掉 `type` 前缀），再断言那个集合**同时**含两个贴端
    //    常量 —— 判据从"逐字文本"升级成"这个模块真的从这里导入了这两个名字"，既不受导入顺序
    //    与同一列表里其它符号（`fxViewSeat`）影响，也**没有**退化成"全文出现过某个名字"。
    const seatImports = new Set<string>();
    for (const m of renderSrc.matchAll(/import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*'\.\/fx-seat';/g)) {
      for (const raw of m[1].split(',')) {
        const name = raw.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0].trim();
        if (name) seatImports.add(name);
      }
    }
    expect([...seatImports], 'render.ts 没有从 ./fx-seat 具名导入任何东西').not.toEqual([]);
    expect(seatImports.has('FX_TRACK_EDGE_PCT'), `render.ts 未从 fx-seat 导入横向贴端常量`
      + `（实际导入：${[...seatImports].join(', ')}）`).toBe(true);
    expect(seatImports.has('FX_TRACK_EDGE_PCT_Y'), 'render.ts 未从 fx-seat 导入**竖向**贴端常量 ——'
      + 'R14-5 的"两处同源"就只剩注释（这正是它当初要消灭的缺陷形态）').toBe(true);
    // ⚠️ **R14-5 新增**：竖向的**渲染侧**取值也必须来自同一个常量（去掉注释后逐字钉）。
    //    判据是"渲染侧那个数**等于** fx-seat 导出的那个数"，而不是"渲染侧写了 22" ——
    //    后者在"fx-seat 改成 30、渲染侧留 22"时照样绿（正是 R14-1 的形态）。
    const renderEdgeY = /const CONTROL_EDGE_PCT_Y = FX_TRACK_EDGE_PCT_Y;/.exec(renderSrc);
    expect(renderEdgeY, 'render.ts 的 CONTROL_EDGE_PCT_Y 不再从 fx-seat 的常量取（卡片与特效会再次错开 ~28px）')
      .toBeTruthy();
    // 反向：`render.ts` 里不许再出现"直接把 22 写死"的形态（旧 R14-1 写法）
    expect(renderSrc, 'render.ts 又把竖向贴端距离写回字面量了（单一出处被绕开）')
      .not.toMatch(/const CONTROL_EDGE_PCT_Y = \d+;/);
    // 渲染页必须把"位置端"按座位换算后交给助手（而不是让共享助手读座位）；
    // `holder`（归属/文案）则必须原样传**绝对玩家号** `s.control`。
    // ⚠️ **判据修正（R16）**：旧句逐字钉的是
    //    `renderControlModule(s, { axis: 'y', holder: netControlHolder(s, viewSeat) })`。
    //    **旧句为什么必须改**：R16 修掉了 `netControlHolder` 那次**方向反了**的换算
    //    （把 `fxSeatEndToPlayer` 的"端 ⇒ 绝对号"当"绝对号 ⇒ 端"用），并把"位置端"与
    //    "归属玩家"拆成两个参数 ⇒ 调用形态**必须**变；旧句钉住的正是"两者共用一个
    //    经过座位换算的 holder"这个缺陷形态（它让自己持控时滑块停在对手端，差 56%）。
    //    **新句多查了什么**：① `holder` 是**绝对玩家号**（不再经座位换算）；
    //    ② 位置端 `end` 来自本页按座位算的 `netControlEnd(s, viewSeat)`。
    //    逐配对的**行为**判据（DOM 上真正写进去的 top == `fxTrackEndFor` 的落点）在
    //    `tests/ui/net-control-end.test.ts`。
    expect(read('render-net.ts'), '远程页未按座位换算控制组件的**位置端**')
      .toMatch(/renderControlModule\(s,\s*\{\s*axis: 'y',\s*holder: s\.control,\s*end: netControlEnd\(s, viewSeat\)/);
    expect(read('render.ts'), 'renderControlModule 的缺省分支不再是热座语义')
      .toMatch(/const holder: -1 \| PlayerId = opts\?\.holder \?\? s\.control;/);
  });
});
