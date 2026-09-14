/**
 * **FX 视角座位**与由此决定的**方向模型**（G2 修正 R3）。
 *
 * 设计依据：docs/2026-09-14-G2修正-竖向布局与朝向分离-设计说明.md §3.2（机制，用户裁决**接受**）
 * 与 §8.1（落地口径：切换视角是开发者/测试用的便利功能，不为"运行时反复切换"造任何机制）、
 * §8.2（命名表）。
 *
 * ## 两套方向模型（这是本文件存在的全部理由）
 *
 * | 页面 | 视角座位 | 链路生长 | 端点落在 | 被盖卡的露出带 | 手牌扇形 |
 * |---|---|---|---|---|---|
 * | **热座页**（`render.ts`，两位玩家同屏） | `null`（默认） | 绝对玩家左右（P0 向左 / P1 向右） | 末卡左/右缘外侧 | **右侧**竖条 | 与绝对玩家绑定（P1 左起 / P2 右起） |
 * | **远程页**（`render-net.ts`，隔桌对坐） | 本页 `viewSeat` | **自己向下 / 对手向上** | 末卡下/上缘外侧 | **上/下**横带 | 仍按"手牌容器自己的排列方向"（仍横向） |
 *
 * ## `null` 分支为什么让"热座零变化"是**构造性**的
 *
 * 本文件对左右两套的划分是"**热座分支一字不改**"：
 *  - `fxStackEndPoint(slot, seat, lift)` 的 `seat === null` 分支**就是**改动前 `stackEndPos` 里那两行
 *    表达式的原样搬运（`seat === 0` ↔ 绝对玩家 0、`r.left - lift` ↔ `slotRect.right - lift`…），
 *    连 `?? 0` 都照抄（原表达式里 `slot.querySelectorAll('.card')` 可能给出 undefined）；
 *  - 热座路径**永远**带着 `setFxViewSeat(null)` 的默认值进入 `seat === null` 分支 ⇒ 它拿到的
 *    x/y 与改动前**逐字段相等**；`y` 在两边都是"槽/行的垂直中心"。
 *  - 竖向分支（`seat !== null`）只在远程页可达：`render-net.ts` 每次渲染把座位设一次
 *    （幂等；规格 §8.1），热座渲染器**从不**调用 `setFxViewSeat` ⇒ 模块态在热座页恒为 `null`。
 *
 * ⚠️ **不要**把本模块的状态当成"产品功能"：它是"页面渲染前设一次的几何参数"，不是可交互状态。
 * 规格 §8.1 明确要求**不为运行时反复切换造任何机制**（不做过渡、不做状态迁移、不做双向同步）。
 *
 * ## 诚实边界（无 jsdom）
 *
 * 本文件里的轴向几何（`vOuterEdgeOf` / `vVisibleStripRect` / `vClipInsetPct` / `vStackEndPoint` /
 * `vHandEndPoint`）都是**纯函数**，可以用普通对象在 vitest 里逐字段断言 —— 这是本任务**能**机检的
 * 那一半。**证不了**的那一半：真实 DOM 里 `getBoundingClientRect()` 的实测值、flex 求解出的
 * 实际卡位、以及"越新越往外"的观感 —— 那些只能靠 `opts.verifyHooks` 的运行时自查 + 人眼验收。
 */

import type { PlayerId } from '../core/models/types';

/**
 * 当前的**视角座位**：`0` = 我是 P1（自己在下半部）、`1` = 我是 P2、
 * `null` = **热座**（默认；两位玩家同屏、方向按绝对玩家左右）。
 *
 * 规格 §8.1：`null` 是"热座 ⇒ 走原逻辑"的开关，也是"热座零变化可证明"的机制本身。
 */
export type FxViewSeat = PlayerId | null;

/** 热座默认值（`setFxViewSeat(null)` 与"从未调用过"完全等价）。 */
export const FX_VIEW_SEAT_HOTSEAT: FxViewSeat = null;

let currentSeat: FxViewSeat = FX_VIEW_SEAT_HOTSEAT;

/**
 * 设置**当前视角座位**（幂等；远程页每次渲染设一次 —— 规格 §8.1）。
 *
 * 唯一的调用点是 `src/ui/render-net.ts` 的 `renderNetBoard`；热座路径永不调用它，
 * 于是热座页读到 `null`、两个"方向"助手全部走**逐字搬运**的旧左右分支。
 */
export function setFxViewSeat(seat: FxViewSeat): void {
  currentSeat = seat;
}

/** 读当前视角座位（`null` = 热座）。 */
export function fxViewSeat(): FxViewSeat {
  return currentSeat;
}

/**
 * 渲染期**写入座位**并把**写进去的那个值**交回来（幂等）。
 *
 * 为什么要有这个出口（而不是让渲染器直接调 `setFxViewSeat` 再自己 `return viewSeat`）：
 * 1. 渲染器可以**只**用它 —— "设了一次"这件事在源码里恰好一处、且**它的返回值必然等于
 *    模块态**（同一个 `seat` 变量），于是任何"调用被删掉 / 被换成 `setFxViewSeat(null)` /
 *    参数传错"的实现都会在 `renderNetBoard` 的返回值上**立刻**失去可读性，而不会静默；
 * 2. `verifyPageHooks` 的断言 4（约束 9）把它与"当前模块态"对比 —— 两者在正确实现下必然相等，
 *    所以那条断言**不是**几何检查（它证明不了渲染期真的按这个座位算），而是一条
 *    **契约链检查**：渲染器那次写入**真的到达了**模块态（`null` / 别的值都会报红）。
 */
export function applyFxViewSeat(seat: PlayerId): PlayerId {
  setFxViewSeat(seat);
  return seat;
}

/* ⚠️ **R-F · Minor M-1：这里原有两个导出 `seatIndexFor(player)` / `isSelfViewOf(player)`，
 * 现已删除** —— 全仓（含测试）零调用。它们的存在只有一个害处：让下一个读代码的人以为
 * "方向模型的入口"是它们，而真正的入口是 `fxOuterForSeat` / `fxIsSelfSide` / `fxTrackEndFor`
 * 这几个**纯函数**（不读模块态）。真正的判据（哪一端是自己、外端在哪）都在下面，
 * 且都有单测；留着的死代码只会让"到底该调哪个"再多一种错误答案。 */

/** "端"的语义：`0` = **自己端**（视觉小端：下半 / 向下 / 轨道下端），`1` = **对手端**（大端）。 */
export type FxEndSide = PlayerId;

/**
 * 把**按视角座位**表述的"哪一端"翻成**绝对玩家号**（供共享助手消费）。
 *
 * 例（控制轨，G2 修正 R3 的用户裁决"自己端在下、对手端在上"）：
 *  - `viewSeat = 0`（我是 P1）⇒ 自己端 = P0、对手端 = P1；
 *  - `viewSeat = 1`（我是 P2）⇒ 自己端 = **P1**、对手端 = **P0**（座位一换，绝对号就对调）。
 *
 * ⚠️ **只在渲染层调用**（`render-net.ts`）：热座页不许出现任何座位换算（那是"热座零变化构造性"的一部分）。
 * 反过来，共享助手 `render.ts` 也不该读座位 —— 把视角概念写进热座页源码会破坏那条构造性证明。
 */
export function fxSeatEndToPlayer(side: FxEndSide, seat: PlayerId): PlayerId {
  return (side === 0 ? seat : 1 - seat) as PlayerId;
}

/**
 * **哪一端是"自己"**的单一判据（G2 修正 R-F · Minor M-5）。
 *
 * - 热座（`seat === null`）：自己 = **绝对 P0**（与改动前的左右逻辑同源）；
 * - 远程页（座位非 null）：自己 = **视角座位那一号**（`viewSeat = 1` 时 P1 才是自己）。
 *
 * 为什么值得一个独立出口：这是"方向模型单一出处"的**最后一条就地判断** ——
 * `gen3-control.ts` 的 `viewportFallback` 原来自己写着
 * `fxViewSeat() === null ? to === 0 : to === fxViewSeat()`（评审 §D 普查的漏网处，且**无单测**）。
 * 收进来之后，"哪一端是自己"只有这一处：控制轨的**端归属**（`fxTrackEndFor`）与
 * **视口兜底**（`fxTrackFallbackPct`）都从它派生，换视角时不会"改一处忘另一处"。
 */
export function fxIsSelfSide(seat: FxViewSeat, to: PlayerId): boolean {
  return seat === null ? to === 0 : to === seat;
}

/* ============================================================================
 * 外部侧：链路端点的"外侧"（轴向，与水平/垂直无关）
 * ========================================================================== */

/** **外侧**的两种语义：`'start'` = 容器坐标轴的小端（热座 P0 = 左 / 远程自己 = 下），
 *  `'end'` = 大端（热座 P1 = 右 / 远程对手 = 上）。 */
export type FxOuter = 'start' | 'end';

/**
 * 该链路的"外侧"在**屏幕坐标轴**上属于哪一端：`'start'` = 小坐标端（左 / 上）、
 * `'end'` = 大坐标端（右 / 下）。**符号约定只有这一套**：`vOuterEdgeOf` 取该端、落点沿该端再外移。
 *
 *  - **热座**（`null`）：按**绝对玩家**（与改动前的左右逻辑同源）——P0 `.grow-left` ⇒ 左（`'start'`）、
 *    P1 `.grow-right` ⇒ 右（`'end'`）。套在水平轴上与改动前逐字等价（见 `fxStackEndPoint`）。
 *  - **远程页**（座位）：**自己 = 下半部、向下生长** ⇒ 屏幕坐标**增大**方向 = `'end'`；
 *    **对手 = 上半部、向上生长** ⇒ 坐标**减小**方向 = `'start'`。
 *    ⚠️ 注意这与"视觉座位号"（自己=0 / 对手=1）**恰好相反** —— 因为
 *    `PlayerId`/座位号描述的是"上下半部的序号"（0=上半），而 `FxOuter` 描述的是"屏幕坐标方向"。
 *    把这两者混为一谈，就是"上下对调"这类 bug 的唯一入口；故这里显式写出来并配了守卫。
 */
/**
 * `fxOuterFor` 的**纯函数版**：座位由实参给（**不读模块态**）。
 *
 * 为什么必须有一个不读模块态的版本（G2 修正 R-F · **C-1** 的修法）：`fxStackEndPoint(slot, seat, owner)`
 * 的调用方已经把座位当**实参**交给它了，而"外侧"要由"**这张卡所属的绝对玩家**"决定。
 * 只要在判定里改回读模块态，就多出一个"实参座位与模块态座位不一致时静默算错"的窗口
 * （测试里最容易踩：忘了先 `setFxViewSeat` 就调用）。做成纯函数后，
 * `fxStackEndPoint` 的两种输入（**座位** + **该卡属主**）都有唯一、可复算的出口。
 */
export function fxOuterForSeat(player: PlayerId, seat: FxViewSeat): FxOuter {
  if (seat === null) return player === 0 ? 'start' : 'end';
  return player === seat ? 'end' : 'start';
}

export function fxOuterFor(player: PlayerId): FxOuter {
  return fxOuterForSeat(player, currentSeat);
}

/**
 * 造一个 DOMRect **形状**的矩形（纯数据）。
 *
 * ⚠️ **不要用 `new DOMRect(...)`**：那是浏览器构造器，在无 jsdom 的环境（本仓的 vitest 是
 * `environment: 'node'`）里**不存在** ⇒ 一调用就 `ReferenceError`。本仓历史上 `gen3-util.ts`
 * 的 `visibleRectOf` 里就写着 `new DOMRect(...)`（只在浏览器路径可达，所以一直没暴露），
 * R3 的合成 DOM 测试第一次真的走到它时立刻炸了。这里统一走这个工厂：
 * 消费方**只读 `left/top/right/bottom/width/height`**，故纯数据对象满足契约。
 */
export function domRectOf(left: number, top: number, width: number, height: number): DOMRect {
  return {
    left, top, width, height,
    right: left + width, bottom: top + height,
    x: left, y: top,
    toJSON: () => ({}),
  } as unknown as DOMRect;
}

/**
 * 一个矩形的**外侧边坐标**（屏幕像素）。
 *
 * ⚠️ 命名是 `v*`（vertical）是**历史原因**：本函数诞生于 R3 的竖向改造，但它现在同时服务
 * 水平轴（热座，`axis === 'x'`）—— 两种轴向上"start = 小坐标端"的语义是同一个。
 *
 * @param axis `'y'` = 链路/端点走竖向（远程页）；`'x'` = 走横向（热座）。
 */
export function vOuterEdgeOf(rect: DOMRect, outer: FxOuter, axis: 'x' | 'y' = 'y'): number {
  const lo = axis === 'x' ? rect.left : rect.top;
  const hi = axis === 'x' ? rect.right : rect.bottom;
  return outer === 'start' ? lo : hi;
}

/** 沿轴中心（`vOuterEdgeOf` 的垂直配对：端点要落在槽/行的**另一条轴的中间**）。 */
export function vCenterOf(rect: DOMRect, axis: 'x' | 'y' = 'y'): number {
  return axis === 'x' ? rect.left + rect.width / 2 : rect.top + rect.height / 2;
}

/* ============================================================================
 * 链路末端落点：远程页的竖向变体（自己向下 / 对手向上）
 * ========================================================================== */

/** 链路/手牌的落点坐标（与 effects/index.ts 的 `stackEndPos` 同形）。 */
export interface FxEndPoint { x: number; y: number }

/**
 * **竖向**链路末端落点（远程页）：`x` = 槽的水平中心（竖排列里卡自己居中），
 * `y` = **最外端那张卡的下/上缘外侧**（`outer` 那一端，见下面的 `last` 取法 —— G2 修正 R-F2 · I-3 的
 * 第二处：卡序**按侧**给之后，"最外端"不再等于"最后一个 DOM 子节点"）；空槽退化为"槽的下/上缘外侧"。
 *
 * ⚠️ `owner` = **这张卡所属的绝对玩家**，**不是**视角座位（G2 修正 R-F · Minor M-2：
 * 这个参数原来叫 `seat`，而它被直接喂给 `fxOuterFor` —— 命名与语义不符正是 C-1 的入口）。
 * 外端由 **`owner` 与 `seat` 共同**决定（`fxOuterForSeat`）：自己 ⇒ 下端、对手 ⇒ 上端。
 * `seat` 缺省 = 模块态座位（渲染期由 `render-net.ts` 设好）；生产路径由 `fxStackEndPoint` **显式**传，
 * 于是"传进来的座位"与"算外端用的座位"永远是同一个值。
 *
 * `lead` 与 `lift` 沿用改动前 `stackEndPos` 的两个不同偏移（末卡 65 / 空槽 90）——
 * 它们是**观感微调量**，本任务不重新标定（规格没给数）。
 */
export function vStackEndPoint(
  slot: HTMLElement, owner: PlayerId, lead = 65, lift = 90, seat: FxViewSeat = fxViewSeat(),
): FxEndPoint {
  const slotRect = slot.getBoundingClientRect();
  const outer = fxOuterForSeat(owner, seat);
  const x = vCenterOf(slotRect, 'x');
  const cards = slot.querySelectorAll<HTMLElement>('.card');
  // ⚠️ **「末卡」= 生长方向最外端的那一张**（G2 修正 R-F2 · I-3 的第二处）：
  //    竖排的 DOM 顺序是**按侧**给的（`render.ts` 的 `opts.vGrow`）——
  //      · 自己侧（`'end'`，向下长）：DOM [最旧 … 最新] ⇒ 最外端 = **最后**一个 DOM 子节点；
  //      · 对手侧（`'start'`，向上长）：DOM [最新 … 最旧] ⇒ 最外端 = **第一个** DOM 子节点。
  //    R1 的注释把「DOM 最后一张」当作「链路里最新的一张」，那只在"两侧同一个顺序"的旧局面下
  //    对**自己侧**侥幸成立：对手侧取到的是**最旧**那张（它贴在协议一侧 = 内端），
  //    落点于是被算到链路**内部**（2 张卡时偏 ~121px），幽灵卡会盖在链路上而不是链路上方。
  //    负 margin-top ⇒ **后一个 DOM 兄弟更低**，故"上端 = 首个子节点、下端 = 末个子节点"。
  const last = cards.length > 0 ? (outer === 'end' ? cards[cards.length - 1] : cards[0]) : null;
  const step = outer === 'end' ? 1 : -1;   // 沿屏幕坐标的"再往外"方向：大端 +、小端 −
  if (last) {
    return { x, y: vOuterEdgeOf(last.getBoundingClientRect(), outer, 'y') + step * lead };
  }
  return { x, y: vOuterEdgeOf(slotRect, outer, 'y') + step * lift };
}

/**
 * 统一入口：热座走**改动前那两行**（左右，按绝对玩家号），远程页走竖向（`vStackEndPoint`）。
 *
 * ## `owner` 参数为什么必须留着（这是"热座零变化"的**构造性**那一环）
 *
 * 改动前的 `stackEndPos(slot, owner)` **在热座页也被两个 owner 用到**（`owner === 0` ⇒ 左、
 * `owner === 1` ⇒ 右）。若只看 `fxViewSeat()`（热座恒 `null`），这两个 owner 会被抹平 ⇒
 * 热座页的 `owner === 0` 那一半落点会**静默翻边** —— 那正是本任务的红线。所以：
 *  - `seat !== null`（远程页）⇒ 外端 = `fxOuterForSeat(owner, seat)`（自己向下 / 对手向上）；
 *  - `seat === null`（热座）⇒ 用**调用方给的绝对玩家号**算方向（`owner ?? 1` 是安全兜底；
 *    `stackEndPos` 的调用方从不省略它，省略时按改动前"非 0 即大端"的默认路径走）。
 *
 * ## ⚠️ C-1（G2 修正 R-F）：远程页**曾经吞掉 `owner`**
 *
 * 原文是 `seat !== null ? fxOuterFor(seat) : (owner ?? 1) === 0 ? 'start' : 'end'` ——
 * 传进去的 `seat` **就是**当前座位，而 `fxOuterFor(currentSeat)` 的 `player === currentSeat`
 * **恒真** ⇒ 远程页的 `outer` **恒为 `'end'`**、`owner` 被完全忽略 ⇒ **所有**链路落点都算在下端
 * （对手列应向上长）。评审探针实测：自己列与对手列给出**同一个点**。
 * 可达路径：同化 2/6 的牌库顶易主（`payload.owner` 是**接收方**，可以是对手）、
 * `shift` 偏转（`owner = card.owner`，可偏转**对手**的场上卡）。
 *
 * 现在两种分支的外端都由**同一个纯函数** `fxOuterForSeat` 给出（只是走哪条轴不同），
 * 所以"上下对调"只可能出现在那一处，可以指名道姓。
 */
export function fxStackEndPoint(
  slot: HTMLElement | null,
  seat: FxViewSeat,
  owner?: PlayerId,
  lead = 65,
  lift = 90,
): FxEndPoint | null {
  if (!slot) return null;
  // ── 远程页：竖向（y 轴）—— 外端 = fxOuterForSeat(**该卡属主**, 座位)（C-1 的修法）──
  //    走 `vStackEndPoint` 本体（不是复制一份算式）：那个函数现在显式吃 `seat`，两者不可能漂移。
  if (seat !== null) return vStackEndPoint(slot, owner ?? seat, lead, lift, seat);
  // ── 热座：横向（x 轴）—— 与改动前 `stackEndPos` 逐字段等价（方向由调用方给的绝对玩家号定）──
  const outer = fxOuterForSeat(owner ?? 1, null);
  const step = outer === 'end' ? 1 : -1;
  const slotRect = slot.getBoundingClientRect();
  const cards = slot.querySelectorAll<HTMLElement>('.card');
  const last = cards.length > 0 ? cards[cards.length - 1] : null;
  const y = slotRect.top + slotRect.height / 2;
  if (last) {
    const r = last.getBoundingClientRect();
    return { x: vOuterEdgeOf(r, outer, 'x') + step * lead, y };
  }
  // ⚠️ 改动前的空槽算式与"末卡"那一支**不对称**（`owner === 0 ? right − lift : left + lift`）：
  //    它锚在**槽的内侧**（P0 槽的空位在槽的右端、P1 槽的空位在左端）。这不是打字错误，
  //    是"空槽时卡会落在靠协议那一侧"的观感选择；R3 按原样保留，只把方向参数化。
  return { x: vOuterEdgeOf(slotRect, outer === 'start' ? 'end' : 'start', 'x') + step * lift, y };
}

/* ============================================================================
 * 手牌端点：**不跟座位变**，跟"手牌容器自己的排列方向"变
 *
 * 规格 §1 只要求"手牌区在页面底部水平中置"——**手牌仍然是横向的**（远程页给两个座位都传
 * `reversed: false` ⇒ 双方都左起、向右排、最新在 DOM 最后 = 最右）。所以"手牌末尾在哪一侧"
 * 与**座位无关**：它由 `.hand` 自己的 `row-reverse`（热座 P2）决定。判据取"容器类名"而不是
 * "绝对玩家号"，这样它在四个组合（热座 P0/P1、远程自己/对手）下都对。
 * ========================================================================== */

/** `.hand` 是否 `row-reverse`（P2 手牌右起、向左延伸）。热座默认 `player === 1`，远程页传 `false`。 */
export function handReversed(hand: HTMLElement | null | undefined): boolean {
  const cl = (hand as { classList?: { contains(c: string): boolean } } | null | undefined)?.classList;
  return typeof cl?.contains === 'function' ? cl.contains('reversed') : false;
}

/** 手牌起排侧的语义（与 `.hand` 的 `flex-direction` 同向）：
 *  `'end'` = 正排（左→右，新卡在右）；`'start'` = `row-reverse`（右→左，新卡在左）。
 *  ⚠️ 与 `fxOuterFor` 同一套**屏幕坐标**语义（start = 小坐标端 = 左）。 */
export function handOuterFor(hand: HTMLElement | null | undefined): FxOuter {
  return handReversed(hand) ? 'start' : 'end';
}

/**
 * **手牌末尾**落点（新卡会落在哪）：与 `effects/index.ts` 的 `handEndPos` 逐字段等价，
 * 只是"哪一侧"从绝对玩家号改为容器自身排列方向。
 *
 * 反空集合：`hand` 缺席时返回全 0，与改动前 `{ top: 0, height: 0, left: 0, right: 0 }` 兜底同义。
 */
export function fxHandEndPoint(hand: HTMLElement | undefined, lead = 37, lift = 93): FxEndPoint {
  if (!hand) return { x: 0, y: 0 };
  const rect = hand.getBoundingClientRect();
  const y = rect.top + rect.height / 2;
  const outer = handOuterFor(hand);
  const step = outer === 'end' ? 1 : -1;
  const cards = hand.querySelectorAll<HTMLElement>('.card:not(.reveal-ghost)');
  const last = cards && cards.length > 0 ? cards[cards.length - 1] : null;
  if (last) {
    const r = last.getBoundingClientRect();
    return { x: vOuterEdgeOf(r, outer, 'x') + step * lead, y };
  }
  return { x: vOuterEdgeOf(rect, outer, 'x') + step * lift, y };
}

/* ============================================================================
 * 覆盖条带（被盖卡露出的可见区）：热座 = 右侧竖条，远程页 = 上/下横带
 * ========================================================================== */

/**
 * 竖向（远程页）下，被盖卡露出的可见条带矩形。
 *
 * ## `outer` 的语义（**这里最容易写反，写反了单测还可能全绿**）
 *
 * `FxOuter` 是**屏幕坐标方向**：`'start'` = 小坐标端（上 / 左）、`'end'` = 大坐标端（下 / 右）。
 * 链路里"更新更靠外"的那张卡压住旧卡，而"往外"就是沿 `outer` 方向 —— 于是：
 *  - **`'end'`（自己侧：向下生长，新卡在下方）⇒ 覆盖者在卡的**下**方 ⇒ 露出**上段**；
 *  - **`'start'`（对手侧：向上生长，新卡在上方）⇒ 覆盖者在卡的**上**方 ⇒ 露出**下段**。
 *
 * ⚠️ 我在实现时把这两句**写反过两次**（先按"end ⇒ 覆盖者在上"，又改成按交集但方向仍反），
 * 而且当时的期望值是一起写的，于是"start/end 必须给出不同结果"这类断言照样通过 ——
 * 是靠一条把 `outer`/坐标打进日志、逐格手算核对的临时调试用例才定位到。
 * 现在的判据来自上面的**推导**（往外 = 沿 outer 方向 ⇒ 覆盖者在那侧），不是来自记忆，
 * `tests/ui/fx-seat.test.ts` 里也按这个推导逐格列了期望值。
 *
 * `minPx` 沿用改动前 `visibleRectOf` 的"至少保留 6px 可见"下限 —— 它保证覆盖者几乎完全压住
 * 时仍有一小条可见区（否则切割/放大类特效会整块消失）。
 */
export function vVisibleStripRect(card: DOMRect, cover: DOMRect, outer: FxOuter, minPx = 6): DOMRect {
  const width = card.width;
  // 覆盖者与卡的**交集** = 被遮住的那一段（覆盖者可能伸出卡外，用交集才安全）
  const lo = Math.max(card.top, cover.top);
  const hi = Math.min(card.bottom, cover.bottom);
  // 露出的是**另一段**：`'end'`（覆盖者在**下**）⇒ [卡顶, 覆盖者顶]；`'start'`（覆盖者在**上**）⇒ [覆盖者底, 卡底]
  const from = outer === 'end' ? card.top : hi;
  const to = outer === 'end' ? lo : card.bottom;
  const height = Math.max(minPx, Math.min(card.height, to - from));
  return domRectOf(card.left, from, width, height);
}

/**
 * 竖向（远程页）下，浮层卡应裁掉的比例（0~0.94）——与 `clipInsetRightPct` 同语义，
 * 只是被裁的那一端从"右"变成"上/下"。
 *
 * 算式与热座那套同源：**被遮住的重叠量 / 本卡尺寸**（不是简单顶点相减 —— 覆盖者可能超出卡的
 * 范围，那样会算出 > 1 的假比例；改动前 `(r.right - cr.left) / r.width` 之所以没问题，是因为
 * 横排的覆盖者总在本卡右侧同一行内）。
 */
export function vClipInsetPct(card: DOMRect, cover: DOMRect, outer: FxOuter, maxPct = 0.94, minPct = 0.02): number {
  if (card.height === 0) return 0;
  // 与 `vVisibleStripRect` 同一套"交集"口径（两处必须同源，否则可见带与裁剪会错开）：
  // 可见高度 = 卡高 − |卡 ∩ 覆盖者|。
  const covered = Math.max(0, Math.min(card.bottom, cover.bottom) - Math.max(card.top, cover.top));
  const hidden = covered / card.height;
  if (!(hidden > minPct)) return 0;
  return Math.min(maxPct, hidden);
}

/**
 * 竖向裁剪的 CSS 形态（`inset(...)` 的四个百分比）。
 *
 * 与 `vVisibleStripRect` **同一套方向推导**（两处必须同源，否则可见带与裁剪会错开）：
 *  - `'end'`（覆盖者在卡**下**方）⇒ 露出上段 ⇒ 裁**下**：`inset(0 0 X% 0)`；
 *  - `'start'`（覆盖者在卡**上**方）⇒ 露出下段 ⇒ 裁**上**：`inset(X% 0 0 0)`。
 */
export function vClipInsetCss(pct: number, outer: FxOuter): string {
  const p = `${(pct * 100).toFixed(1)}%`;
  return outer === 'start' ? `inset(${p} 0 0 0)` : `inset(0 0 ${p} 0)`;
}

/* ============================================================================
 * 控制轨的**端归属**（G2 修正 R3 第二批：用户裁决"控制轨改成竖向，自己端在下、对手端在上"）
 *
 * 与"哪一端属于谁"分开的理由：这里只说"某个**端**在轨道轴的哪个百分比"，
 * "哪一端是我"由渲染层按座位换算（`render-net.ts` 的 `netControlHolder`）——
 * 两者混在一起就再也说不清"换了视角到底该动哪一步"。
 * ========================================================================== */

/** 控制轨端点：`pct` = 沿轴的百分比、`axis` = 该百分比作用在哪条轴。 */
export interface FxTrackEnd { pct: number; axis: 'x' | 'y' }

/**
 * 控制轨"贴端距离"的**单一出处**（G2 修正 R-F · Minor M-4）。
 *
 * 它同时被两处消费，而这两处**必须逐字一致**（不一致的后果是"滑块贴 4%、而特效落点算在 5%"
 * —— 落点与组件错开，观感上像"特效没打在滑块上"）：
 *  - `render.ts` 的 `CONTROL_EDGE_PCT`（滑块位置：横 左 4% / 右 96%；竖 上 4% / 下 96%）；
 *  - 本文件的 `fxTrackEndFor`（FX 落点的端百分比）。
 *  R3 之前在两边各写死一个字面量 `4`，靠注释说"同源"，没有任何机检把它们连起来；
 *  现在 `render.ts` **从这个常量取值**（`const CONTROL_EDGE_PCT = FX_TRACK_EDGE_PCT;`），
 *  改一处另一处一定跟着走。
 */
export const FX_TRACK_EDGE_PCT = 4;

/** 贴端距离（比例）。`4 / 100` 与字面量 `0.04`、`1 - 4 / 100` 与 `0.96` 在 IEEE 双精度下**逐位相等**
 *  （已实测），所以下式的取值与 R3 之前的字面量完全一致。 */
const FX_TRACK_EDGE = FX_TRACK_EDGE_PCT / 100;

/**
 * 端归属判据（**方向走的都是 `fxIsSelfSide` 这一处**）：
 *  - `null`（热座）：**横向**（`axis: 'x'`），**自己 = 绝对 P0** 贴小端 4%、对手贴大端 96%
 *    （与改动前的左右算式逐字等价；贴端距离见 `FX_TRACK_EDGE_PCT`）；
 *  - 座位（远程页）：**竖向**（`axis: 'y'`），**自己 = 视角座位那一号** ⇒ 大端（下）96%、
 *    对手 ⇒ 小端（上）4%（§8.4 的用户裁决）。
 *
 * ⚠️ 两类页面里"自己在哪一端"的**映射是相反的**（横排的自己在小端、竖排的自己在大端），
 * 所以这里保留两条分支；但两条分支的**判据**都只经 `fxIsSelfSide` —— 换视角时不可能只改半边。
 */
export function fxTrackEndFor(seat: FxViewSeat, to: PlayerId): FxTrackEnd {
  return seat === null
    ? { pct: fxIsSelfSide(seat, to) ? FX_TRACK_EDGE : 1 - FX_TRACK_EDGE, axis: 'x' }
    : { pct: fxIsSelfSide(seat, to) ? 1 - FX_TRACK_EDGE : FX_TRACK_EDGE, axis: 'y' };
}

/**
 * 竖向轨道**取不到实测矩形**时的视口兜底比例（G2 修正 R-F · Minor M-5）。
 *
 * `gen3-control.ts` 的 `viewportFallback` 原来自己写着
 * `const self = fxViewSeat() === null ? to === 0 : to === fxViewSeat()` 再配 0.82 / 0.18 ——
 * 评审 §D 的"方向是否已全部集中"普查里它是**唯一漏网处**，而且**没有任何单测**。
 * 收进这里之后：判据（`fxIsSelfSide`）与两个量都在同一处，六个组合都有绝对断言（见 fx-seat.test.ts）。
 *
 * 语义：**自己端 = 视口 82%（下）、对手端 = 18%（上）** —— 与 `fxTrackEndFor` 的竖向分支同向
 * （自己在大端 / 下端）。横向的兜底（22% / 78%）**不在这里**：它只服务热座，且横向位置由
 * 绝对玩家号 0/1 直接给，与"哪一端是自己"无关（留在 `gen3-control.ts`）。
 */
export function fxTrackFallbackPct(seat: FxViewSeat, to: PlayerId): number {
  return fxIsSelfSide(seat, to) ? 0.82 : 0.18;
}

/**
 * 轨道上"某端"的落点（屏幕坐标）。两个坐标都返回，调用方按 `axis` 选一个 ——
 * 于是"横向的旧代码路径"不需要任何改写，而"上下对调"这类变异只可能出现在 `fxTrackEndFor` 一处。
 */
export function fxTrackEndPos(track: DOMRect, seat: FxViewSeat, to: PlayerId): { at: FxTrackEnd; x: number; y: number } {
  const at = fxTrackEndFor(seat, to);
  return at.axis === 'x'
    ? { at, x: track.left + track.width * at.pct, y: track.top + track.height / 2 }
    : { at, x: track.left + track.width / 2, y: track.top + track.height * at.pct };
}
