/**
 * 远程对战页渲染器（**G2 修正 R1：三列纵向布局**）。
 * 设计依据：docs/2026-09-14-G2修正-竖向布局与朝向分离-设计说明.md §1/§2/§8（**权威**）；
 * 原版（三条横带）见 docs/2026-09-13-联机与多端-设计稿.md §6；施工依据 `.superpowers/sdd/R1-brief.md`。
 *
 * ## 布局（G2 修正 R1 —— 用户验收时指出"三条横带"是理解错误后重做）
 * **三条线 = 三个纵向的列，并排。** 每列自上而下严格是：
 *   ① 对手能量槽 → ② 对手链路（卡 180°，越新越**上**）→ ③ 对手协议（顺时针 90°）
 *   → ④ 自己协议（逆时针 90°）→ ⑤ 自己链路（卡 0°，越新越**下**）→ ⑥ 自己能量槽
 * （能量槽由 `renderBattery` 产出，**不在**链路槽里（G2 修正 **R8-2**）—— 由 `renderSide`
 * 自己挂到 `.net-side` 的外端（对手在上/自己在下，横置、双方都从右往左点亮），
 * 见 `styles-net.css` 第 4 节；`order` 已彻底退役，"哪一层在哪"只剩 DOM 兄弟顺序一个出处。
 * 中线两侧**都是协议**，故 `renderSide` 的挂载顺序**按侧镜像**（对手 = 能量槽→链路→协议、
 * 自己 = 协议→链路→能量槽）。
 *
 * 推导依据（规格 §1 的复核）：这套规格**等价于把热座页的"每条线一行"整体旋转 −90°** ——
 * 热座自己卡 +90° → 0°；对手卡 −90° → 180°；自己协议 0° → −90°；对手协议 180° → +90°；
 * 能量槽在链路外侧端（左/右）→ 旋转后变成下/上；4 列的行 → 4 层的列，故**整体更窄更高**。
 * `viewSeat = 1`（我是 P2）= **垂直镜像**：我的链路在下半部、对手在上半部，与 P1 视角完全对称
 * —— 本文件用 `foe = 1 - viewSeat` 换算，`data-player` 永远写**绝对值**。
 *
 * ## 停靠栏 + 三行排布（G2 修正 **R6** → **R8-5/R8-7** → **R9-3 并盒** → **R11-2/3 停靠栏**）
 * **顶部信息条已取消**（用户裁决）。R6~R7 期间信息块与手牌区是**同一行**的左右三列；
 * R8-5 换成五行、上下镜像；R9-3 把手牌并进信息块那一行；
 * **R11-2/3 再把对手那一块从最上面搬进自己这一行、整行钉在屏幕底部**（用户第四次验收）：
 *   ① 三条链路 + 控制轨（**视口内的滚动区**）· ② 日志 / 工具条 · ③ **停靠栏**：
 *   自己信息块（左列）· 自己手牌（整行中置）· 对手信息块 · 对手手牌张数（单行小字，压进对手那一块）。
 * 每侧的信息块 = `renderPlayerInfo`（昵称 / 座位 · 牌库 n · 弃牌堆 n · 手牌 n）+ `renderPiles`
 * （该玩家自己的 `.deck[data-player]` / `.trash-pile.pN`）。
 * **按钮只在轮到自己的那一侧**（R11-3）：行动区挂 `isSelf && player === s.turnPlayer` 那一块、
 * 选择条只挂 `chooser === viewSeat` 时 —— 对手那一侧**只显示信息**。
 *
 * ⚠️ **DOM 一个字都没改**（这是硬约束）：`.net-bottom` 与 `.net-hands` 在 `styles-net.css` 里是
 * `display: contents`，子节点**直接成为 `.net-board` 的 grid item**，行/列号由 CSS 按侧指派。
 * 为什么不能靠"把节点挂到 DOM 更靠前的位置"来换视觉顺序：`.hand` 的 DOM 顺序恒为
 * `[P0, P1]`（FX 用 `querySelectorAll('.hand')[player]` **按下标**读手牌）。
 *
 * **`NET_BOTTOM_SIDES`（**唯一一处**）** 仍然只决定"两块信息块以什么顺序**插进 DOM**"——
 * 视觉行/列号由 CSS 按 `data-net-seat` 决定，两条腿都在 `tests/ui/net-board-grid.test.ts` 的 G-7
 * 与 `tests/ui/net-dock.test.ts` 的 G-13 里被钉住。
 * ⚠️ **R11-4**：这个常量**同时**决定了"手牌区在 DOM 里的位置"——`['self','foe']` ⇒
 * `[自己信息块, 手牌区, 对手信息块]`。旧代码用 `bottom.lastElementChild` 取手牌区，
 * 于是拿到的是**对手信息块**（`.choice-mode` 一直加错节点）；现在由 `buildBottomRow` 直接返回。
 *
 * ## 为什么**不**复用 render.ts 的盘本体（设计稿 §6.1，R1 后仍然成立）
 * 热座页的盘是「左右分栏」（P1 槽 | P1 协议 | P2 协议 | P2 槽），两位玩家坐在**同一块屏幕前**、
 * 各自看自己那半边的 ±90° 旋转；远程页是「三条竖列、列内上下分层」，双方隔桌对坐。
 * 两者的 DOM 骨架与朝向语义都不同，硬套会把热座页的布局假设带进来。**本体另写**，
 * 但**全部叶子助手原样复用**（卡片 / 协议 / 电池 / 牌库 / 弃牌 / 信息条 / 控制轨 / 选择条 /
 * 选择浮层 / 拖拽 / 手牌区 / 选择态）。
 *
 * ## 八条硬约束（违反 → 静默退化；逐条对应本文件的实现）
 * 1. **21 条 A 类钩子全部产出，且产出方拼写与热座页一致** —— 靠复用 render.ts 的叶子助手保证
 *    （`.stack-slot p${player + 1}` / `trash-pile p${player + 1}` 都在助手内，`data-player` /
 *    `data-line` 走 `dataset`）。`.pN` 拼写是**承重的**，不要改成复合类名（计划附录 A.4-2）。
 *    **本页的产出证据是「助手调用链」，不是本文件的 token**：拼写由 `render.ts` 的钩子产出表达式
 *    负责（`tests/ui/fx-dom-contract.test.ts` 会对它逐条查），本页只负责**把这些助手挂进链路**。
 *    下方 `NET_PAGE_HOOKS` 是**人读 + 防漂移的契约镜像**（`call` 一列逐条对应真实调用，
 *    且任一 token 扫描前都会先 `stripArrayDecl` 剔除表体）—— **表本身不是证据**
 *    （G2 Task 3 的教训：物化进本文件的 hook 字符串会让"必须提供"断言自我满足）。
 * 2. **`.rot-cw` / `.rot-ccw` 一律不产出** —— 本文件里连带引号的字面量都不出现
 *    （`tests/ui/fx-orient.test.ts` 会对每个**已登记的非热座渲染器**逐个扫）。
 *    **卡面**朝向只有 0°（自己）与 180°（对手）：本页把 `orient: isSelfSeat ? 0 : 180` **作为实参**
 *    交给 `renderStackSlot` / `renderProtocolCell`，类名映射只有一处 —— `render.ts` 的分支链
 *    （`:252-254` 的 ±90°/180° 与 `:130` 的协议图），**不在本文件重复映射**。
 *    **协议**的 ∓90° 用**自己的**类 `.net-rot-ccw`（自己）/ `.net-rot-cw`（对手）走 `extraClass`
 *    参数（理由：`.rot-cw/.rot-ccw` 是热座专属的"**卡牌横置**"语义，且 `orientOf` 把它们当作
 *    **卡面**朝向读；协议用同名类会让 FX 把它误读成卡面朝向 —— 规格 §8.2 第 3 行）。
 *    这两个类名从本文件交给 `render.ts` 的**通用** `extraClass` 参数，**不是**写死在 `render.ts` 里
 *    （写死会让热座页的源码依赖远程页的类名，热座零变化就不再是构造性的）。
 * 3. **「能量槽在链路外侧端」的旧假设改了，方向模型也一并改成了"按座位"（G2 修正 R3）**：
 *    竖排后能量槽在**上/下**（对手在上、自己在下）—— **R8-2 之后由 DOM 兄弟顺序决定**
 *    （`order` 已退役；见 `renderSide`），生长方向由 `vGrow` 决定（自己 `.grow-down` /
 *    对手 `.grow-up`，纯 CSS 语义；R8-3 的 `min-height` 让 `justify-content` 也变成承重杠杆）。
 *    **FX 侧的方向判断**从"按绝对玩家左右"改成"按座位上下"：本页每次渲染调用一次
 *    `setFxViewSeat(viewSeat)`（**幂等**；规格 §8.1：切换视角是开发/测试功能，不为它造任何机制），
 *    于是 `effects/index.ts` 的 `stackEndPos`、`fx-gen2.ts` 的 `iceStackEnd`/`smokeStackEnd`/
 *    `playFearShiftExtra`/`playCourageShiftExtra`、`gen3-util.ts` 的覆盖条带、`fx-seat.ts` 的
 *    一切方向判断都走**竖向**分支（自己向下 / 对手向上）。
 *    热座页**从不**调用 `setFxViewSeat` ⇒ 模块态恒为 `null` ⇒ 那些地方走**逐字未改**的左右分支。
 *    **控制轨也改成了竖向**（G2 修正 R3 第二批 · 用户裁决："自己端在下、对手端在上"）：
 *    轴向由 `renderControlModule(s, { axis: 'y' })` 给（缺省 `'x'` 逐字保留热座语义）、
 *    归属传**绝对玩家号** `s.control`、贴**哪一端**由本页按座位算（`netControlEnd`，R16 起
 *    位置与归属是两个参数）—— A 类钩子的产出方拼写一字未改，
 *    竖向布局在 `styles-net.css` 第 9 节；`gen3-control.ts` 的落点也按座位选轴（`fxTrackEndPos`）。
 * 3b. **手牌方向不跟座位走**：规格 §1 只要求"手牌区在页面底部水平中置"，手牌容器仍是**横向**的
 *    （本页给两个座位都传 `reversed: false`），所以"手牌末尾在哪一侧"由 `.hand` 自身的排列方向
 *    决定，与"我是 P0 还是 P1"无关（见 `fx-seat.ts` 的 `fxHandEndPoint`）。
 * 4. **within-slot 覆盖方向在**竖排后**从"左右"变成"上下"**（`.stack .card + .card` 的负 margin
 *    在本页由 `styles-net.css` 覆盖为 `margin-top`）。G2 修正 R3 已把 `gen3-util.ts` 的覆盖几何
 *    改成**按座位**：热座仍走"覆盖者在**右**"（原逻辑一行未改），远程页按**覆盖卡自己的
 *    `data-fx-rot`** 判"覆盖者在**上**（对手）/ **下**（自己）"（`coveredOuterOf` /
 *    `vVisibleStripRect` / `vClipInsetPct` / `vClipInsetCss`）。
 *    ⚠️ 仍然成立的一条：**对手那一列不得整块 `rotate(180deg)`** —— 列级 180° 会把该列**水平镜像**
 *    （屏幕左右翻转）且与卡自身的 `.rot-180` 叠加成 0°（卡其实正立）。
 *    所以对手侧只由**卡/协议自身**的 `.rot-180` / `.net-rot-cw` 承担（styles-net.css 第 3 节）。
 * 5. **对手手牌只渲染数量，但 `.hand[data-player]` 占位节点必须产出**（带 `data-hand-count`）——
 *    否则 `querySelectorAll('.hand')[player]` 会取到 `undefined`。FX 里**按下标**读手牌的是
 *    **8 处**（fx-gen2.ts:693/1316/1786 静默跳过；effects/index.ts:849/942/1541/1590/1650 飞到错误
 *    坐标），另有 effects/index.ts:1703（playRevealFly）**一次取两手**。由 `renderHand` 的
 *    `handVisibility: 'count'` 分支保证（`data-hand-count` 写在**手牌节点本身**上，见 render.ts:1610）。
 * 6. **座位来源是 `opts.viewSeat`**，不是 `s.turnPlayer`（后者是**回合**概念，当"我是谁"会让视角
 *    每回合翻面）。本文件**不出现** `s.turnPlayer ===`。
 * 7. **两条 `.hand` 以「绝对玩家顺序」出现在 DOM 中**（P0 在前、P1 在后，见 `buildHands`），
 *    「谁显示在上」由父容器的 `.net-view-N` 用 **CSS `order`** 决定（styles-net.css 第 6 节）。
 *    比约束 5 更危险：FX 读手牌是**按下标**的，`viewSeat = 0` 时若按视觉顺序挂载会得到 `[P1, P0]`，
 *    下标 0 拿到**对手**的手牌 → 卡飞到对手手牌区，不报错、不跳过。
 *    ⚠️ **R6 之后这条红线扩到"底部行"**：信息条的左右归属**也**不许改变两条 `.hand` 的 DOM 顺序
 *    ——`buildP0Hand` 仍先于 `buildP1Hand`，且 `buildHands` 里仍是"先 append P0、再 append P1"
 *    紧随相邻的两条语句。左右摆放**只能**由 CSS 决定（信息块用 `grid-column`、手牌用 `order`）。
 *    这与"信息条在左/右"是**两件独立的事**：底部行的三块里，手牌区的 DOM 位置**恒在中间**。
 * 8. **特效朝向标记 `data-fx-rot`（R1 只负责产出，读侧是 R2）** —— 远程页场上卡带
 *    `data-fx-rot="ccw"`（自己）/ `"cw"`（对手），由 `renderStackSlot` 的 `fxRot` 参数逐卡写。
 *    **它与卡面朝向是两套**（规格 §2 的朝向表）：自己卡面 0° 而特效 −90°、对手卡面 180° 而特效 +90°。
 *    热座页不传 `fxRot` ⇒ DOM 上不存在这条属性 ⇒ R2 的 `fxOrientOf` 回退到 `orientOf`
 *    ⇒ 热座零变化是**构造性**的。契约里 `[data-fx-rot]` 是**新 A 类钩子**、只由本页产出
 *    （`RENDERERS` 给 render.ts 一条 `exempt`）—— 那一步在 R2 落地（本页只产出标记）。
 *
 *
 * ## 构建顺序（C-1：远程页曾经在这里死锁）
 * `renderChoiceUi(...)` **必须在 `wrap.appendChild(grid)` 之后**调用（与热座 `renderBoard`
 * `:4800` 挂 grid、`:4835` 跑选择分支同序）。它内部三处 `wrap.querySelectorAll(...)` 都是
 * 「按已在 DOM 里的节点加类/挂点击」—— grid 未挂载时它们全部空转，`select-line` 因此找不到
 * 任何 `.net-lane-band`（没有可点目标，而 `choiceBar` 对 select-line 没有确认按钮）→
 * **非 optional 的 select-line 永久无法应答、对局卡死**。几何型 FX（透彻牌库眼睛 / 幸运宣告骰子）
 * 同理必须在 `root.appendChild(wrap)` 之后执行（此前 `getBoundingClientRect()` 全 0）。
 *
 * ## 入口职责（与 `renderApp` 对齐，**逐件**；漏一件就是一个时序/残留 bug）
 *
 * ⚠️ **G2 Task 4F 的教训（终审 I-1）**：本节原来自称"入口**四件**副作用与 `renderApp` 对齐"，
 * 而 `renderApp` 实际有**六件**（外加"清空 root"共七件事）—— 于是漏掉了 `removeDraftPreviews()`
 * 与 `activeDragCancel()`，两块 body 级草稿面板整局残留在预览页上并拦截点击。
 * 根因不是"忘了某一件"，而是**清单本身就是手写的**：手写清单必然漏项。
 * 因此本节的清单由 `tests/ui/net-preview-wiring.test.ts` 的**入口职责对齐守卫**机检 ——
 * 它从 `renderApp` 的函数体**生成**要求（`ENTRY_DUTIES` 表 + `root.classList.*` 的实际出现），
 * 再逐条断言本页也满足；往 `renderApp` 里加一件新职责时，守卫会**立刻要求本页也加**
 * （未登记的新职责会被"未分类的 `root.classList` 操作"或"表内新增项"两条路之一抓到）。
 *
 * 逐件（顺序与 `renderApp` 一致）：
 *  1. `cancelActiveDrag()` —— 拖拽安全网（重渲染若发生在拖拽中，先清理幽灵卡与高亮；
 *     `renderApp` 里写的是等价的 `if (activeDragCancel) activeDragCancel();`）；
 *  2. `removeDraftPreviews()` —— 清 body 级草稿展示框（**不是**本页 root 的子节点）；
 *  3. `root.textContent = ''` —— 渲染器自己清空并重建 root（F-1）；
 *  4. `root.classList.add('no-anim')` —— 重渲染动画抑制（双 rAF 后移除）；
 *  5. `syncCheckCacheChains(s)` —— FX-5 check-cache 锁链；
 *  6. `syncChainLayerPosition()` —— FX-R2 锁链层重定位；
 *  7. `cb.onRendered?.()` —— 宿主每帧钩子（自动推进 / 效果内重排窗口同步）。
 *
 * ## 已知边界 / 延后（G2 记 Minor，**不在本轮实现**）
 * 1. **信息遮蔽的一条边界**：选择浮层把 prompt 候选按**真卡面**渲染，而 `corruption-2` 顶
 *    （`core/rules/corruption.ts:69-71`）与 `courage-0` 底（`core/rules/courage.ts:36-37`）的候选
 *    **就是对手手牌**（`chooser: foe`）⇒ 遮蔽模式下对手手牌内容会进 DOM。本机预览无第三方受害，
 *    故 G2 只记 Minor；**G5 必须在会话/传输层按 seat 过滤 prompt 与候选**（渲染层挡不住）。
 * 2. **预览页翻面无动画**：热座的翻面动画长在 `renderBoard` 的内联回调里，本页复用叶子助手不带它
 *    → 观感差异，非缺陷。
 * 3. **`playRearrangeProtocolsFx` 按绝对玩家取 180°**（`effects/index.ts:2233`）：`viewSeat = 1` 时
 *    协议重排的幽灵卡朝向与本页的座位相对朝向不一致（**仅观感**；它符合硬约束 3 的"按绝对玩家"精神）。
 *
 * ## 明确不做
 * 不调用挡板（设计稿 §6.1 已删：对手手牌不在本机屏幕上）；不写会话层 / 信令；不改任何 `sync*`。
 */

import type { ChoiceRequest, ChoiceCard, GameState, Line, PendingEffect, PlayerId } from '../core/models/types';
import { getLegalActions, type LegalAction } from '../core/game';
import { getLineValue } from '../core/state/create';
import { actionCn } from '../core/log';
import { downloadLog } from './diag';
// 几何型（依赖 getBoundingClientRect）点名特效：与热座 renderBoard 的 deferredFx 同源同调用形态
// （render.ts:4849 透彻牌库眼睛 / :4945 幸运宣告骰子）。二者都用**契约钩子**定位：
// `startClarityDeckEye` 查 `.deck[data-player="N"]`、`startLuckDiceFx` 查源卡的 `[data-uid]` ——
// 远程页两处节点都在（牌库在信息条内、源卡在链路槽或手牌里），所以可以直接复用，不需要改 export。
import { startClarityDeckEye, startLuckDiceFx } from './fx-gen2';
// G2 修正 **R13-4**：这两条不在 `render.ts` 里（各自模块导出），热座页也是从各自模块 import 的
// —— 常驻层同步清单必须**逐字对齐**热座页（见入口那段注释）。
import { syncGen3Persistent } from './gen3-control';
import { syncFollowers } from './fx-follow';
// G2 修正 R3：**方向模型**的视角座位。本页是它**唯一**的调用点（幂等，每次渲染设一次）——
// 规格 §8.1：切换视角是开发者/测试功能，不为"运行时反复切换"造任何机制（无过渡、无迁移、无双向同步）。
import { applyFxViewSeat, fxIsSelfSide, fxViewSeat } from './fx-seat';
import {
  el,
  renderStackSlot,
  // G2 修正 R8-2：能量槽**不在**链路槽里（用户裁决：移到链路框外、底部横置），本页自己调它
  // 并挂到 `.net-side` 的对应端；`renderStackSlot` 传 `withBattery: false`（见 `renderSide`）。
  renderBattery,
  renderProtocolCell,
  renderDeck,
  renderTrash,
  renderRefreshButton,
  renderPlayerInfo,
  renderControlModule,
  renderHand,
  playToLine,
  bindClickOrDouble,
  openZoom,
  choiceBar,
  buildChoicePickOverlay,
  getHandSelection,
  setHandSelection,
  getChoiceSelection,
  setChoiceSelection,
  pruneSelection,
  syncCheckCacheChains,
  syncChainLayerPosition,
  // G2 修正 **R8-4b**：已编译协议持久 FX 层（body 级 `.compiled-fx`）的**每帧**同步。
  // 热座页的这两句在 `renderBoard` 里（开头复位 + 末尾同步）；本页此前**两句都没有** ⇒
  // 层只在 `img.load` 那一次落位，之后任何移动协议位置的重渲染都会让它停在旧坐标上飘走。
  resetCompiledFxCells,
  syncCompiledFxLayers,
  // ── G2 修正 **R13-4**（独立审计 A4）：热座页在 `renderBoard` 末尾调用的**全部常驻层同步函数**。
  // 本页此前只调了 3 条 ⇒ 19 类常驻特效在远程页**整类不出现**（详见入口那段注释）。
  // 它们都是幂等的"按选择器定位 + 写矩形"，随 R1/R3 的选择器迁移一起适配好了，本页只需原样调用。
  syncSmokeOverlays,
  syncScanOverlays,
  syncPsychicParticles,
  syncPlagueMists,
  syncApathyMists,
  syncApathyMosaics,
  syncSpirit0Glows,
  syncSpirit1Cards,
  syncMetal0Glows,
  syncMetalPlates,
  syncMetal6Mans,
  syncMetal1LineGlows,
  syncMirror0BatteryGlows,
  syncClarity0BatteryGlows,
  syncIceFx,
  syncSmoke2LineGlows,
  syncFear0TriGlows,
  syncWarBlades,
  syncDiversityColors,
  syncDiversity3Fx,
  // G2 Task 4F：入口职责的两条（`render.ts` 只加了 `export` 关键字，实现未动；
  // `cancelActiveDrag` 见该文件里的"只读包装"说明）。
  //  · `removeDraftPreviews`：草稿页把两块 `.draft-preview` append 到 **document.body**（不是本
  //    渲染器的 root）→ 本页清 root 清不掉它们；漏调则 `fixed; z-index:400` 的面板压住底部两角
  //    且**拦截点击**整局（终审 I-1）。
  //  · `showWinOverlay`：本页必须自己产出胜利横幅，否则打完一局**无法退出**（只能刷新浏览器，终审 C-1）。
  //  · `cancelActiveDrag`：拖拽安全网（本页若在拖拽中被重渲染，会残留一块跟手的幽灵卡）。
  removeDraftPreviews,
  showWinOverlay,
  cancelActiveDrag,
  type UiCallbacks,
} from './render';

/* ============================================================================
 * 接口
 * ========================================================================== */

/**
 * **页面级标记**（G2 修正 **R15-2**）：`renderNetBoard` 渲染时挂在 `document.body` 上的类，
 * `resetNetUiState()`（离开远程页）时摘掉。
 *
 * **为什么必须有它**：远程页有几条**观感**修正只能落在"这一页独有的盒子"上，而那些盒子
 * **不在** `renderNetBoard` 的 root 子树里 —— 已编译协议的持久 FX 层 `.compiled-fx` 由
 * `render.ts` 的 `buildCompiledFx` 挂在 **`document.body`**（`position: fixed`）。
 * CSS 无法"按后代选祖先"（`body:has(.net-board)` 这一类不在本仓的解析器与目标浏览器面上），
 * 所以页面身份必须由**一个祖先上的类**表达：`body.net-page …`。
 * 目前唯一的消费方是 `styles-net.css` 第 6b 节（已编译协议的发光改挂在**已旋转**的持久层上）。
 *
 * ⚠️ **热座页零变化是构造性的**：本类**只**由本文件写（`renderNetBoard` 加 / `resetNetUiState` 摘），
 * 热座渲染路径（`renderApp` / `renderBoard`）从不写它 ⇒ 所有 `body.net-page …` 规则在热座页
 * **恒不命中**，不依赖"我记得把每一处都改对"。
 */
export const NET_PAGE_CLASS = 'net-page';

export interface NetViewOpts {
  /** 我的座位（**绝对玩家号**）。绝不可用 `s.turnPlayer` 冒充 —— 那是回合概念，视角会每回合翻面。 */
  viewSeat: 0 | 1;
  /** 预览工具条的**视角**开关回调。**真实联机时不传** → 工具条不渲染（零联机预览专用）。
   *
   *  ⚠️ **信息遮蔽没有开关**：本页恒为"只有自己正面、对手只手牌数量"（设计稿 §6.4）。
   *  **G2 Task 4F（终审 I-2）删掉了原先的 `handVisibility: 'all' | 'viewSeat'` 字段** ——
   *  `'all'` 那一档实测**等价于**"对手手牌改画最多 15 张**卡背**、且仍不可点"（`render.ts` 的 `faceUp`
   *  与单击/拖拽绑定都以 `isSelf` 为条件，`styles-net.css` 又对非 self 手牌 `pointer-events:none`）。
   *  既然"全部可见"既不"可见"也不"可操作"，就不该暴露成选项（**半成品比没有更误导**），
   *  留着字段只会让人以为传 `'all'` 有用。**推进对手回合的正确做法：切 `viewSeat`**
   *  （切过去后对手变 self ⇒ 正面 + 可点）。字段删除记录见 `.superpowers/sdd/G2-final-review-2.md`（N4）。 */
  onPreviewChange?(next: { viewSeat?: 0 | 1 }): void;
  /** 诊断：渲染后**真的去 DOM 里查**一遍 `NET_PAGE_HOOKS`（真实产出力的运行时证据）。
   *  默认关（真实联机零开销）；预览入口可在开发时打开。不通过时只 warning，不改变渲染结果。 */
  verifyHooks?: boolean;
}

/** **对手**一侧手牌传给 `renderHand` 的可见性：`'count'` = 只产出数量占位（设计稿 §6.4 信息遮蔽）。
 *
 *  ⚠️ 关键区分（G2 Task 4F 的 Critical C-2 就是踩在这里）：`renderHand` 的 `'count'` 分支是
 *  **与 `isSelf` 无关的无条件提前返回**（`render.ts` 里 `if (opts.handVisibility === 'count') { … return hand; }`），
 *  它**早于**决定正反面的 `const faceUp = opts.isSelf && …` 与绑定单击/拖拽的 `if (opts.isSelf) {`。
 *  所以**给自己一侧传 `'count'` 会把自己的手牌也变成「手牌 ×n」占位 —— 一张 `.card` 都不产出**：
 *  看不了牌、点不了、拖不了 → 预览不可玩、特效抽查做不了；而**运行时自查照样 ✓**（`.card` 登记为
 *  stateDependent），所以这条只能靠"自己一侧必须传 `'all'`"的源码守卫钉住。
 *  两处调用点都写作 `isSelf ? 'all' : NET_HAND_VIS`，由 `tests/ui/render-net.test.ts` 钉住（改成常量即红）。 */
const NET_HAND_VIS: 'all' | 'count' = 'count';

/* ============================================================================
 * 21 条 A 类钩子的**逐条登记**（docs/4代-FX DOM 契约.md §3 的验收基准）
 *
 * ⚠️ **这张表不是"已提供"的证据**（G2 Task 3 的 Critical C-3 就是它曾经充当证据）：
 *   表里逐字写着 19 条 hook 的选择器字符串（Task 4 补 `.rot-180` 后为 20 条，G2 修正 R2 补
 *   `[data-fx-rot]` 后为 21 条），而契约守卫的判据是"本文件的（去注释）源码里
 *   出现该 token" —— 于是**表本身**就满足了「本页提供全部 A 类钩子」。评审变异实测：
 *   把 `renderStackSlot(` / `renderProtocolCell(` 的真实挂载删掉（页面上因此没有链路槽与协议格）
 *   后，契约测试 20 + 本文件守卫 11 **全绿（31/31）**。
 *
 * 现在这张表的**职责**只有四条，都不构成证据：
 *   1. `hook`：与契约 A 类清单**逐字镜像**（守卫断言两边集合相等 → 表不可能漂移）；
 *   2. `call`：该钩子由哪条**共享助手调用**产出（守卫在**剔除表体后**的源码里逐条查这个调用
 *      字面量真的存在 —— 证据来自真实代码，表只提供"要查哪个字面量"的需求）；
 *   3. `probeSelector`：`opts.verifyHooks` 的**运行时**自查用的合法 CSS 选择器。
 *      `hook` 是**展示形式**（如 `.trash-pile.p1/.p2` 的复合写法），**不是**合法选择器 ——
 *      直接交给 `querySelector` 会抛 `SyntaxError`（这正是 C-2：`verifyHooks` 一开就崩）。
 *      `probeSelector` 与 `hook` 分离后，"每条都是合法 CSS"由 `tests/ui/render-net.test.ts`
 *      用仓库已装的 **lightningcss**（真正的 CSS 解析器）逐条机检。
 *   4. `expected`：该钩子在**一帧完整远程页**里的确定数量（F-2）。只对**结构钩子**给值；
 *      状态相关钩子（`.card` / `[data-uid]` / `img`）**不给**——它们空局面合法为 0。
 *      ⚠️ 这些数字不是"拍脑袋"：`tests/ui/render-net.test.ts` 第 17 条把每一个都**从源码结构推出来**
 *      （`3 线 × 2 侧 = 6`；牌库/弃牌/手牌来自各自的唯一挂载点 = 2；控制轨 1），
 *      并用第 18/19 条把"缺了对手侧的合成树"喂给 `verifyPageHooks` 真跑一遍（必须报 ✗）。
 *      没有那两条腿，这张表就只是"声明"——无 jsdom 时谁也证明不了它被用上了。
 *
 * `stateDependent`：该钩子在某些合法局面下**本就可能查不到**（场上无卡 / 手牌打空），
 * 自查时降级为 info 而不是失败 —— 否则诊断会稳定误报。
 * `exempt`：有意不产出（与 `src/ui/fx-dom-contract.ts` 的 `RENDERERS[].exempt` 必须一致）。
 * ========================================================================== */

interface NetPageHook {
  /** 契约里的稳定选择器（与 FX_DOM_CONTRACT 的 `hook` 逐字一致，便于人工对照 + 防漂移机检） */
  hook: string;
  /** 产出这条钩子的**共享助手调用字面量**（每个都要在剔除表体后的本文件源码里真实出现） */
  call: readonly string[];
  /** 运行时自查用的**合法** CSS 选择器（豁免项不需要：自查会跳过它们） */
  probeSelector?: string;
  /** 一帧完整远程页里的**确定数量**（结构钩子）。省略 = 只查存在性、不查个数 */
  expected?: number;
  /** 该钩子在某些合法局面下可能为空（只报 info，不算失败） */
  stateDependent?: string;
  /** 有意不产出时的理由（与 fx-dom-contract.ts 的 `RENDERERS[].exempt` 对应） */
  exempt?: string;
}

export const NET_PAGE_HOOKS: readonly NetPageHook[] = [
  // 甲读法 3 条线 × 双方 = 6；牌库/弃牌/手牌各 2；控制轨 1（与第 17 条的源码推导逐条对应）
  { hook: '.stack-slot[data-player][data-line]', call: ['renderStackSlot('], probeSelector: '.stack-slot[data-player][data-line]', expected: 6 },
  { hook: '.protocol-cell[data-player][data-line]', call: ['renderProtocolCell('], probeSelector: '.protocol-cell[data-player][data-line]', expected: 6 },
  { hook: '.protocol-img', call: ['renderProtocolCell('], probeSelector: '.protocol-img', expected: 6 },
  { hook: '.protocol', call: ['renderProtocolCell('], probeSelector: '.protocol', expected: 6 },
  { hook: '.protocol-holder', call: ['renderProtocolCell('], probeSelector: '.protocol-holder', expected: 6 },
  {
    hook: '[data-uid]',
    call: ['renderStackSlot(', 'renderHand(s, 0', 'renderHand(s, 1'],
    probeSelector: '[data-uid]',
    stateDependent: '场上无卡且手牌为空（开局即有；"手牌打空 + 场上空"是合法局面）',
  },
  { hook: '.trash-pile[data-player]', call: ['renderTrash('], probeSelector: '.trash-pile[data-player]', expected: 2 },
  { hook: '.trash-pile.p1/.p2', call: ['renderTrash('], probeSelector: '.trash-pile.p1, .trash-pile.p2', expected: 2 },
  { hook: '.deck[data-player]', call: ['renderDeck('], probeSelector: '.deck[data-player]', expected: 2 },
  {
    hook: '.battery',
    // G2 修正 **R8-2**：产出方从 `renderStackSlot(` 改成 `renderBattery(`。
    // 判据的**真实语义**是"本页把产出该钩子的助手挂进了渲染链路"，而 R8-2 之后
    // `renderSide` 传 `withBattery: false`（能量槽**不在**链路槽里）⇒ 本页唯一的产出点
    // 就是那一处 `const batteryNode = renderBattery(s, player, line)` + 按侧 appendChild。
    // ⚠️ 仍写 `renderStackSlot(` 会变成**假绿**：那个调用还在（链路槽当然还在），
    // 而能量槽一旦被摘掉它也照样绿 —— 正是"表充当证据"那一族的失效形态。
    // `expected: 6` 不变（3 线 × 2 侧 = 6，能量槽只是换了落点、没换个数）。
    call: ['renderBattery('], probeSelector: '.battery', expected: 6,
  },
  { hook: '.hand', call: ['renderHand(s, 0', 'renderHand(s, 1'], probeSelector: '.hand', expected: 2 },
  { hook: '.hand[data-player]', call: ['renderHand(s, 0', 'renderHand(s, 1'], probeSelector: '.hand[data-player]', expected: 2 },
  {
    hook: '.card',
    call: ['renderStackSlot(', 'renderHand(s, 0', 'renderHand(s, 1'],
    probeSelector: '.card',
    stateDependent: '场上无卡且手牌为空（同上）',
  },
  {
    hook: '[data-fx-rot]',
    // 产出链（**R8-4 起有两腿**）：
    //  ① **场上卡**：`renderStackSlot` 的 `fxRot` 参数 ⇒ `render.ts` 的 `node.dataset.fxRot = opts.fxRot`；
    //  ② **协议 holder**（G2 修正 R8-4）：`renderProtocolCell(` 的第 6 实参 ⇒ `renderProtocol` 的
    //     `holder.dataset.fxRot = fxRot` —— 协议 FX（持久层/翻面浮层/重排幽灵）靠它知道"协议是横躺的"。
    // 本页只负责把**按座位的两个值**交给那两个参数
    // （`renderSide` 里 `fxRot: isSelfSeat ? 'ccw' : 'cw'` 与同处 renderProtocolCell 的第 6 实参）。
    // ⚠️ 少登记那一腿 = 协议特效跟随那条链**没有任何机检面**（R8-4 的原始缺陷形态）。
    call: ['renderStackSlot(', 'renderProtocolCell('],
    probeSelector: '[data-fx-rot]',
    // 数量：**逐节点**挂载（场上卡逐卡 + 每个协议 holder 一个）⇒ 数量随场面变化，
    // 这里只做存在性/状态相关；**逐节点计数与取值**由 `verifyPageHooks` 的断言 3（约束 8，场上卡）
    // 与断言 6（约束 10，协议 holder + 已编译层的内联 transform）承担 ——
    // 与 `.rot-180` 走 "stateDependent + 逐节点断言" 同形。
    stateDependent: '场上无卡时（开局即有；"场上空"是合法局面）至少协议 holder 仍会带标记；'
      + '逐节点覆盖与两种取值由断言 3（约束 8）与断言 6（约束 10）另行核对',
  },
  {
    hook: '.rot-cw',
    exempt: '热座专属朝向：两位玩家同屏各看自己半边时用 ±90°；远程页隔桌对坐用 0°/180°。'
      + '且 ±90° 会**交换布局盒宽高**、0°/180° 不会 —— 拿 ±90° 冒充 180° 会得到"朝向对但尺寸错"的假正确。',
    call: [],
  },
  {
    hook: '.rot-ccw',
    exempt: '与 .rot-cw 同一条理由（成对读取：src/ui/fx-orient.ts 的 orientOf）。',
    call: [],
  },
  {
    hook: '.rot-180',
    // 非豁免：远程页**正是**它的产出方（对手侧每张卡/协议各自带它），而热座页也有产出点
    // （render.ts:130 的 `.protocol-img.rot-180`）→ 两个渲染器都提供，无需豁免。
    // 运行时自查只做"存在性 + 状态相关降级"：对手侧场上卡与协议各自的 **.rot-180 计数**
    // 由 verifyPageHooks 的断言 2（硬约束 2）承担（数量随场面变化，故这里不给定 expected）。
    call: ['renderStackSlot(', 'renderProtocolCell('],
    probeSelector: '.rot-180',
    stateDependent: '场上无卡时合法为 0（开局即有；"场上空"是合法局面）——'
      + '对手侧的逐卡倒置计数由断言 2（硬约束 2）另行核对',
  },
  {
    hook: 'img',
    call: ['renderProtocolCell(', 'renderControlModule('],
    probeSelector: 'img',
    // 结构上"本页至少 13 个 img"（6 张协议图 + 6 张卡面/cardback + 1 个滑块图），但**不给数量**：
    // 这条 probe 是**标签名**（契约自己已披露它退化 —— 任何 img 都算命中），数量还随卡面朝向、
    // 手牌张数、选择浮层变化。定了数量只会在合法局面下误报。与 `.card`/`[data-uid]` 同走 info 通道。
    stateDependent: '标签钩子：probe 退化为"存在任一 img"，且数量随卡面/手牌/浮层变化 → 不计数，只报 info',
  },
  { hook: '.control-module', call: ['renderControlModule('], probeSelector: '.control-module', expected: 1 },
  { hook: '.control-slider-img', call: ['renderControlModule('], probeSelector: '.control-slider-img', expected: 1 },
  { hook: '.control-track', call: ['renderControlModule('], probeSelector: '.control-track', expected: 1 },
];

/**
 * 这一帧的**行动方 / 操作方**（G2 修正 **R11-3** 的运行时自查输入；两个都是**绝对玩家号**）。
 * 由 `renderNetBoard` 从它本来就有的两个值里取（不额外查询）：`s.turnPlayer` 与
 * `topEffect.prompt.chooser ?? topEffect.player`（后者没有挂起选择时为 `null`）。
 */
export interface NetActingSide {
  /** 当前回合玩家（绝对号）—— 行动按钮（刷新/下一步/编译线N…）的归属依据 */
  turnPlayer: PlayerId;
  /** 挂起选择的**应答方**（绝对号）；没有挂起选择时为 `null` */
  operator: PlayerId | null;
}

/**
 * **运行时**核对：`NET_PAGE_HOOKS` 里每条非豁免钩子是否真的能在页面上查到节点（**数量确定的结构钩子
 * 连数量一起查**），外加四条**源码守卫永远证明不了**的断言（硬约束 7 的 DOM 顺序、
 * 硬约束 2 / C-4 的对手卡朝向、R11-3 的"按钮只在轮到自己的那一侧"）。
 *
 * `acting`（G2 修正 **R11-3**）：这一帧的**行动方 / 操作方**（绝对玩家号）。给了它才会多跑
 * 约束 11 的**正向**那半边（"自己那一侧有按钮 ⇒ 自己就是行动方"）。省略 = 只查"对手那一侧
 * 一个操作按钮都没有"（那半边不需要 `acting`）。
 *
 * 为什么值得写在生产代码里：源码守卫（含契约测试）对"产出方"的判据是**源码文本**，
 * 而本页的产出方在 `render.ts` 里 —— 文本判据在这种情况下证明力最弱（计划附录 A.4-3 已披露）。
 * 这个函数把它变成可执行的检查：`opts.verifyHooks === true` 时渲染完立刻去 DOM 里查。
 *
 * **F-2（3F 复评）：只问"存在"不问"个数"是半个盲区** —— 评审变异 R4 删掉**整条对手侧行**
 * （对手的 6 个 `.stack-slot` / 6 个 `.protocol-cell` / 6 个 `.battery` 全没）时，自己侧每类仍有
 * 一个 → 存在性自查报 `自查 ✓`，而页面上少了**半个棋盘**。所以 `expected` 不为空的钩子改成
 * **计数断言**（`数量 N，期望 M`）；`.card` / `[data-uid]` / `img` 等**状态相关**钩子仍然只报
 * info（空局面下合法为 0），不给定数量 —— 否则诊断会稳定误报。
 *
 * **绝不抛异常**（C-2）：每一条都在 `try/catch` 里 —— 将来有人往表里写一个非法选择器（例如
 * 契约的展示写法 `.trash-pile.p1/.p2`），它只应当成为**一条具名失败**，绝不能从 `renderNetBoard`
 * 逃逸出去把整页渲染搞崩（`querySelector` 对非法选择器按 DOM 规范抛 `SyntaxError`）。
 *
 * 返回一段**给用户看**的摘要；同时把失败明细 `console.warn` 一次（不逐条抛）。
 *
 * **为什么 `export`**：无 jsdom 的环境里，只有把它导出、用一份**合成 scope 桩**在 vitest 里真跑
 * 一遍，才能证明"计数逻辑本身有牙齿"（`tests/ui/render-net.test.ts` 第 19 条：缺了对手侧的合成树
 * 必须报 ✗ 并说出 `数量 … / 期望 …`）。它**不是**公开 API 的一部分 —— 真实入口只有
 * `renderNetBoard` 的 `opts.verifyHooks`。
 */
export function verifyPageHooks(
  scope: HTMLElement, appliedSeat: 0 | 1 | null = null, acting: NetActingSide | null = null,
): string {
  const fatal: string[] = [];
  const soft: string[] = [];
  for (const h of NET_PAGE_HOOKS) {
    if (h.exempt !== undefined) continue;
    const sel = h.probeSelector;
    if (sel === undefined) {
      fatal.push(`${h.hook}：登记表缺 probeSelector（运行时自查无法进行）`);
      continue;
    }
    let found: number;
    try {
      // 统一用 querySelectorAll：存在性 = `count > 0`。为什么不用两次 API：
      // 一次遍历就能同时支撑"存在性"与"计数"两种判据，也不会出现两处口径不一致。
      found = scope.querySelectorAll<HTMLElement>(sel).length;
    } catch (err) {
      fatal.push(`${h.hook}：探测选择器 ${JSON.stringify(sel)} 非法（${String(err)}）`);
      continue;
    }
    const want = h.expected;
    if (want !== undefined) {
      // 结构钩子：数量是确定的（甲读法 3 线 × 双方；牌库/弃牌/手牌各 2；控制轨 1）
      if (found !== want) fatal.push(`${h.hook}：数量 ${found}，期望 ${want}（探测 ${sel}）`);
      continue;
    }
    if (found > 0) continue;
    const line = `${h.hook}（探测 ${sel}）`;
    if (h.stateDependent !== undefined) soft.push(`${line} —— ${h.stateDependent}`);
    else fatal.push(line);
  }

  // ── 断言 1（硬约束 7）：两条 .hand 的 DOM 顺序恒为 [P0, P1] ──
  // 为什么只能在这里查：FX 用 `querySelectorAll('.hand')[player]` **按下标**读手牌，
  // 而这个顺序是"构建顺序 + 挂载顺序"的运行时结果，源码文本守卫只能给出**代理**证据。
  // 失败的后果不是报错而是**静默错位**：下标 0 拿到对手的手牌区，卡飞到对手那边。
  try {
    const hands = scope.querySelectorAll<HTMLElement>('.hand');
    const order = [hands[0]?.dataset.player, hands[1]?.dataset.player];
    if (hands.length !== 2 || order[0] !== '0' || order[1] !== '1') {
      fatal.push(`约束 7：.hand 的 DOM 顺序必须是 [P0, P1]（FX 按下标读手牌），`
        + `实际 ${hands.length} 条 → [${order.map((x) => String(x)).join(', ')}]`);
    }
  } catch (err) {
    fatal.push(`约束 7 的 .hand 顺序自查抛异常（${String(err)}）`);
  }

  // ── 断言 2（硬约束 2 + C-4）：对手的**场上卡与协议**各自带 .rot-180；自己侧一个朝向类都不带 ──
  // C-4 的教训：对手那一行曾经整块 `rotate(180deg)`，与卡自身的 `.rot-180` 叠加成 0°
  // （卡其实正立），同时把整行水平镜像（"覆盖者在右"的屏幕假设被翻转）。
  // 所以这里钉的是"**每张**对手卡自己带 rot-180"——行级旋转会让这个计数归零。
  try {
    const foeCards = scope.querySelectorAll<HTMLElement>('.net-side-foe .card').length;
    const foeInverted = scope.querySelectorAll<HTMLElement>('.net-side-foe .card.rot-180').length;
    if (foeInverted !== foeCards) {
      fatal.push(`硬约束 2：对手侧场上卡必须**各自**带 .rot-180，实际 ${foeInverted}/${foeCards} 张`
        + `（行级 rotate 与本类叠加会得 0°）`);
    }
    const foeProto = scope.querySelectorAll<HTMLElement>('.net-side-foe .protocol-img').length;
    const foeProtoInverted = scope.querySelectorAll<HTMLElement>('.net-side-foe .protocol-img.rot-180').length;
    if (foeProtoInverted !== foeProto) {
      fatal.push(`硬约束 2：对手侧协议图必须**各自**带 .rot-180，实际 ${foeProtoInverted}/${foeProto} 张`);
    }
    const selfOriented = scope.querySelectorAll<HTMLElement>(
      '.net-side-self .card.rot-180, .net-side-self .card.rot-cw, .net-side-self .card.rot-ccw',
    ).length;
    if (selfOriented !== 0) fatal.push(`硬约束 2：自己侧场上卡不得带任何朝向类，实际 ${selfOriented} 张带了`);
  } catch (err) {
    fatal.push(`硬约束 2 的朝向自查抛异常（${String(err)}）`);
  }

  // ── 断言 3（G2 修正 R2 · 约束 8）：**特效朝向标记**逐卡挂在场上卡上，且两种取值按座位 ──
  // 为什么必须在运行时查：`fxOrientOf` 读不到标记就**回退** `orientOf` —— 那是"热座零变化"的
  // 机制，同时也意味着**远程页忘了产出标记时不会有任何报错**，只会静默退回卡面朝向
  // （自己卡 0°、对手 180° 被当成特效朝向 ⇒ 整类特效差 90°）。A 类钩子的存在性自查
  // （`.card` 状态相关）也证明不了这件事：它只查 `.card` 在不在。
  // 判据取"**每一张**场上卡都带标记"（按侧分别计数）——与断言 2 的 rot-180 逐卡计数同形。
  try {
    for (const side of ['foe', 'self'] as const) {
      const cards = scope.querySelectorAll<HTMLElement>(`.net-side-${side} .card`).length;
      const marked = scope.querySelectorAll<HTMLElement>(`.net-side-${side} .card[data-fx-rot]`).length;
      if (marked !== cards) {
        fatal.push(`约束 8：.net-side-${side} 的场上卡必须**各自**带 [data-fx-rot]（特效朝向标记），`
          + `实际 ${marked}/${cards} 张（缺标记 ⇒ fxOrientOf 回退卡面朝向 ⇒ 特效差 90°）`);
      }
    }
    // 取值断言**只在确实有标记时**才有意义：一张卡都没有（合法空局面）时"没有任何一张的取值不对"
    // 是真命题，但读起来像"查过了"。所以先要求"两张卡**都**带标记且**都**等于座位值"，
    // 再用长度相等排除"空集合恒真"（否则 `selfFxRot=[]` 会让这条断言恒绿）。
    const selfVals = scope.querySelectorAll<HTMLElement>('.net-side-self .card[data-fx-rot]');
    const selfFxRot = [...selfVals].map((c) => c.getAttribute('data-fx-rot'));
    const selfCardsN = scope.querySelectorAll<HTMLElement>('.net-side-self .card').length;
    const badSelf = selfFxRot.filter((v) => v !== 'ccw').length;
    if (selfFxRot.length !== selfCardsN || badSelf > 0) {
      fatal.push(`约束 8：自己侧卡的 data-fx-rot 必须是 'ccw'（−90°），`
        + `实际 ${selfFxRot.length}/${selfCardsN} 张带标记、其中 ${badSelf} 张取值不是 'ccw'`);
    }
    const foeVals = scope.querySelectorAll<HTMLElement>('.net-side-foe .card[data-fx-rot]');
    const foeFxRot = [...foeVals].map((c) => c.getAttribute('data-fx-rot'));
    const foeCardsN = scope.querySelectorAll<HTMLElement>('.net-side-foe .card').length;
    const badFoe = foeFxRot.filter((v) => v !== 'cw').length;
    if (foeFxRot.length !== foeCardsN || badFoe > 0) {
      fatal.push(`约束 8：对手侧卡的 data-fx-rot 必须是 'cw'（+90°），`
        + `实际 ${foeFxRot.length}/${foeCardsN} 张带标记、其中 ${badFoe} 张取值不是 'cw'`);
    }
  } catch (err) {
    fatal.push(`约束 8 的特效朝向标记自查抛异常（${String(err)}）`);
  }

  // ── 断言 4（G2 修正 R3 · 约束 9）：**方向性**在两个座位下都成立（源码守卫证不了的那一半）──
  // 为什么必须在运行时查：R3 把方向模型从"按绝对玩家左右"改成"按座位上下"，而**唯一**的座位来源
  // 是 `renderNetBoard` 里那一次 `applyFxViewSeat(opts.viewSeat)`。源码文本守卫能钉住"调用写了"，
  // 钉不住"运行期真的写成了那个值"——删掉调用 / 改成 `setFxViewSeat(null)` / 传错参数，
  // 页面会退回热座语义（远程页的落点与覆盖条带全按左右算）而不报任何错。
  //
  // ⚠️ **能力边界（不许读成"几何已验证"）**：本函数没有浏览器布局引擎，量不到
  // `getBoundingClientRect()`，所以这里**只**做"标记 / 类名层面的存在性 + 逐卡朝向"：
  //   ① 座位**真的进了模块态**（`fxViewSeat()` 必须等于渲染期写进去的 `appliedSeat`）；
  //   ② 两侧每一张场上卡各自带 `[data-fx-rot]`，且取值按侧（自己 `ccw` / 对手 `cw`）
  //      —— 这正是覆盖方向（`gen3-util.ts` 的 `coveredOuterOf`）与落点轴（`fx-seat.ts` 的
  //      `fxOuterFor`）的**共同输入**：标记在、值对，方向判据的输入就是对的；
  //   ③ 对手侧每张卡/协议各自带 `.rot-180`、自己侧一个朝向类都不带（硬约束 2 的复述）。
  // 它**证明不了**"卡真的向下/向上排开""覆盖条带真的在上/下"—— 那只能人眼看（见报告 §8）。
  try {
    if (fxViewSeat() !== appliedSeat) {
      fatal.push(`约束 9：FX 视角座位没写进模块态 —— renderNetBoard 渲染了 seat=${String(appliedSeat)}，`
        + `但 fxViewSeat() 读到 ${String(fxViewSeat())}（方向判断会退回热座的左右语义）`);
    }
    for (const [side, want] of [['self', 'ccw'], ['foe', 'cw']] as const) {
      const cards = scope.querySelectorAll<HTMLElement>(`.net-side-${side} .card`).length;
      const marked = [...scope.querySelectorAll<HTMLElement>(`.net-side-${side} .card[data-fx-rot]`)];
      const bad = marked.filter((c) => c.getAttribute('data-fx-rot') !== want).length;
      if (marked.length !== cards || bad > 0) {
        fatal.push(`约束 9：.net-side-${side} 的每张场上卡都必须带 data-fx-rot="${want}"`
          + `（方向判据的输入），实际 ${marked.length}/${cards} 张带标记、其中 ${bad} 张取值不对`);
      }
    }
    if (fxViewSeat() !== null) {
      // 远程页（座位已设）：座位类必须落在 wrap 上，且**与 FX 座位同值** —— `.net-view-N` 是
      // CSS 侧"哪一半在上面"的锚点，`data-view-seat` 是同一件事的机读形式。两者与 FX 座位不一致
      // ⇒ "布局按 A 座位、方向按 B 座位"这种静默错配（最危险的形态：页面看着正常、特效全反）。
      //
      // ⚠️ **R7 修正（这条自查曾在实机上稳定误报）**：`scope` 就是 `renderNetBoard` 的 `wrap`，
      //    而 `wrap` **自己就是** `.net-board.net-view-N`；`querySelectorAll` **只搜后代、不搜自身**，
      //    于是旧写法恒命中 0 个 ⇒ 预览工具条上永远写着
      //    「自查 ✗ 1 项：约束 9：座位类/CSS 锚点与 FX 座位不一致（.net-board.net-view-* 命中 0 个…）」，
      //    而页面其实是对的 —— 它已经浪费过一轮人眼排查。修法：**把 scope 自己算进来**
      //    （scope 也可能是 `#app` 这类"棋盘是后代"的宿主，所以两条都要留）。
      //    判据用 `classList.contains` 而不是 `matches()`：与桩的能力面一致（`net-dom-stub` 只实现
      //    `classList`），且这条检查因此可以在**真跑渲染器**的测试里被执行到。
      const want = String(fxViewSeat());
      const viewBoards: HTMLElement[] = [
        ...(scope.classList?.contains('net-board') === true ? [scope] : []),
        ...scope.querySelectorAll<HTMLElement>('.net-board[class*="net-view-"]'),
      ];
      if (viewBoards.length !== 1 || !viewBoards[0].classList.contains(`net-view-${want}`)) {
        fatal.push(`约束 9：视图座位锚点（.net-view-N 类）与 FX 座位不一致`
          + `（.net-board.net-view-* 命中 ${viewBoards.length} 个，FX 座位=${want}`
          + '；渲染根自己也算一个 —— 只按后代查会恒得 0）');
      }
      const handsSeat = [...scope.querySelectorAll<HTMLElement>('.net-hands')].map((h) => h.dataset.viewSeat);
      // ⚠️ **R7 修正（同一族误报的第二处）**：这里原来要求 `.net-hands` **恰好 2 个** —— 但一帧远程页
      //    只有**一个** `.net-hands` 容器（`buildHands` 把两条 `.hand` 放进同一个容器，见它的头注；
      //    元素树里的"恰好一块 .net-hands"由 `tests/ui/net-lane-tree.test.ts` 的 R6-1 钉住）。
      //    于是这条与上面那条一样恒红，并挤在**同一条** fatal 里（消息只看 fatal[0] 时看不出是两处）。
      //    正确的判据是"页面上**每一个** `.net-hands` 的 data-view-seat 都等于 FX 座位"，
      //    而个数判据应当是 1（多一个就是两份手牌 ⇒ FX 按下标取手牌静默错位）。
      if (handsSeat.length !== 1 || handsSeat.some((v) => v !== want)) {
        fatal.push(`约束 9：.net-hands 必须恰好一个、且它的 data-view-seat 与 FX 座位一致`
          + `（实际 ${handsSeat.length} 个 → [${handsSeat.join(',') || '无'}]，FX 座位=${want}）`);
      }
    }
  } catch (err) {
    fatal.push(`约束 9 的方向性自查抛异常（${String(err)}）`);
  }

  // ── 断言 5（G2 修正 R6 · 底部行重排）：信息块**恰好两块**、座位互补、且**没有顶部条** ──
  // 为什么必须在运行时查（源码守卫证不了的那一半）：R6 把顶部信息条取消、两块信息块移进底部行。
  // 源码文本能钉住"某个函数里有一处 `NET_BOTTOM_SIDES` 的循环"，钉不住**运行期真的产出两块**、
  // 两块**座位互补**（不是同一侧画两遍 —— 那会让对手的牌库/弃牌堆消失而页面看着仍有两条信息）、
  // 以及"顶部条节点确实不再存在"。R6 的关键红线是 `.hand` DOM 顺序不变，但**信息块复制/缺失**
  // 同样是静默错位族（FX 取首个 `.deck[data-player]`）—— 所以这一条与断言 1 并列。
  try {
    const blocks = [...scope.querySelectorAll<HTMLElement>('.net-info-block')];
    const seats = blocks.map((b) => b.dataset.netSeat);
    const rows = [...scope.querySelectorAll<HTMLElement>('.net-bottom')];
    if (blocks.length !== 2 || seats.slice().sort().join(',') !== 'foe,self' || rows.length !== 1) {
      fatal.push(`R6：底部行必须恰好一块 .net-bottom、两块 .net-info-block（座位互补 self/foe），`
        + `实际 .net-bottom=${rows.length}，信息块=${blocks.length} → 座位 [${seats.join(', ')}]`);
    }
    if (blocks.length === 2 && !blocks.every((b) => b.parentElement === rows[0])) {
      fatal.push('R6：两块信息块必须都挂在底部行 .net-bottom 下（顶部条已取消，别处不该再有信息条）');
    }
  } catch (err) {
    fatal.push(`R6 的底部行自查抛异常（${String(err)}）`);
  }

  // ── 断言 6（G2 修正 R8-4 · 约束 10）：**协议 holder 的特效朝向标记按侧** + **已编译协议 FX 层
  //    的内联 transform 真的跟着协议转了 ∓90°**（用户第 4 条反馈"所有协议的特效都没有跟着协议
  //    转过来"的机检腿）──
  // 为什么必须在运行时查：协议 FX 的几何跟随**完全**依赖 holder 上的 `data-fx-rot`
  // （`fxRotDegOf` 读不到 ⇒ 0° ⇒ 层不旋转 ⇒ 环/角光/藤蔓/裂纹继续按竖版盒错位 90°），
  // 而这条链由**三个文件**接力（`render-net.ts` 传参 → `render.ts` 写 holder 属性 →
  // `positionCompiledFxLayer` / `playProtocolFlip` 读角度）。源码文本守卫最多钉住"某处调了某助手"，
  // 钉不住"运行期标记真的挂在 holder 上、值真的按侧"—— 与断言 3（场上卡）同形，对象换成
  // `.protocol-cell .protocol-holder`（⚠️ 它**不是** `.card`，与约束 8/9 的选择器不冲突）。
  try {
    for (const [side, want, deg] of [['self', 'ccw', '-90'], ['foe', 'cw', '90']] as const) {
      const holders = [...scope.querySelectorAll<HTMLElement>(`.net-side-${side} .protocol-cell .protocol-holder`)];
      const marked = holders.filter((h) => h.getAttribute('data-fx-rot') === want);
      if (holders.length === 0 || marked.length !== holders.length) {
        fatal.push(`约束 10：.net-side-${side} 的每个协议 holder 都必须带 data-fx-rot="${want}"`
          + '（协议特效的 ∓90° 跟随靠 fxRotDegOf 读它；缺标记 ⇒ 层不旋转 ⇒ 协议特效竖版错位 90°），'
          + `实际 ${marked.length}/${holders.length} 个`);
        continue;
      }
      // 条件断言：**只有已编译协议**才有 body 级持久 FX 层 ⇒ 有对象时才查（无编译协议时合法跳过）。
      // 查的是**层自己的内联 transform**（层盒 = holder 盒、绕自身中心转 ⇒ 与协议视觉盒重合）。
      //
      // ⚠️ **严格相等**（G2 修正 **R8-4b** 起）：必须**恰好**是该侧标记对应的 `rotate(∓90deg)`。
      // 为什么现在能严格（此前只能写成容忍集合 —— 实现者 §2 已披露过）：
      //  · 本页在 `root.appendChild(wrap)` **之后**补上了 `syncCompiledFxLayers()`（见入口注释），
      //    且 `compiledFxCells` 改成**每帧复位** ⇒ 自查这一刻层**一定**已被按当前 holder 矩形写过
      //    （本页协议 holder 有固定 CSS 100×140 ⇒ 矩形非 0，不会被 0×0 早退挡掉）；
      //  · "切视角后层带着另一侧陈旧角度"这个中间态也随之消失（同一帧内必然重写）。
      // ⇒ 空串 / 另一侧角度 / 180° / 任何第三个值都是**真缺陷**：层没跟着协议横躺，
      //    或者根本没被重新定位 —— 后者更严重：环/角光会**飘在旧坐标上**。
      for (const box of [...scope.querySelectorAll<HTMLElement>(`.net-side-${side} .protocol.compiled`)]) {
        const defId = /(?:^|\s)compiled-fx-([\w-]+)/.exec(String(box.className))?.[1];
        if (defId === undefined) continue;   // 没有 defId 类 ⇒ 不是本页产出的已编译协议盒
        const layers = typeof document === 'undefined'
          ? []
          : [...document.querySelectorAll<HTMLElement>('.compiled-fx')]
            .filter((n) => String(n.className).split(/\s+/).includes(`compiled-fx-${defId}`));
        // R13-1：层的内联 transform 现在是 **rotate(∓90deg) scale(k)** 两段（k = 实测 holder 宽 / 200，
        // 见 positionCompiledFxLayer）—— 判据因此从"严格等于一个字符串"改成"**严格匹配两段形态**"：
        // 角度必须恰好是该侧的 ∓90°，缩放必须是一段 > 0 的数（空串 / 180° / 另一侧角度 / 缺 scale 全报红）。
        const want = new RegExp(`^rotate\\(${deg}deg\\) scale\\(\\d+(?:\\.\\d+)?\\)$`);
        const bad = layers
          .map((n) => String(n.style?.transform ?? ''))
          .filter((t) => !want.test(t));
        if (bad.length > 0) {
          fatal.push(`约束 10：已编译协议 ${defId}（${side} 侧）的持久 FX 层内联 transform 必须恰好是 `
            + `rotate(${deg}deg) scale(k)（k = 实测 holder 宽 / 200），实际 ${bad.map((t) => JSON.stringify(t)).join('、')}`
            + '（空串/其它值 ⇒ 层没被按当前协议矩形同步 —— 环/角光会飘在旧坐标上、或没跟着协议横躺；'
            + '180° 是"误用会回退卡面朝向的 fxOrientOf"的形态；缺 scale 是 R13-1 的缺陷形态 —— 协议缩了而层内 px 装饰没缩）');
        }
      }
    }
  } catch (err) {
    fatal.push(`约束 10 的协议特效朝向自查抛异常（${String(err)}）`);
  }

  // ── 断言 7（G2 修正 R11-3 · 约束 11）：**操作按钮只在轮到自己的那一侧** ──
  // 用户第四次验收原话："操作按钮（刷新/下一步/选择条）**只在轮到自己时出现在自己这一侧** ——
  // 对手那一侧**只显示信息**，不再有按钮"。
  // 为什么必须在**运行时**查：按钮的归属由 `renderInfoBlock` 的 `isSelf && player === s.turnPlayer`
  // 与 `renderChoiceUi` 的 `mountIfMine` **两处**共同决定，而"两处是否都改对了"这件事在源码文本上
  // 只能靠"某函数里有某个条件"这种代理证据 —— R8-8 期间正是**这一族**判据（源码腿）全绿，
  // 而页面上的按钮在那半边的形态只在真跑一帧时才看得见。
  // 判据两条：
  //   ① **对手那一侧永远零操作控件**（用户点名的字面要求；也是真联机的防"替对手走棋"）；
  //   ② 给了 `acting` 时：**自己那一侧有控件 ⇒ 自己就是行动方或操作方**（这条是"只在轮到自己时"
  //      的正向那半边；不给 `acting` 时自动跳过 —— 合成 scope 的判定里没有游戏状态）。
  try {
    const blocks = [...scope.querySelectorAll<HTMLElement>('.net-info-block')];
    // 每一类**单独**查（不写逗号选择器组）：契约的探针在同一份选择器能力面上跑过，
    // 逗号组在简易实现里会被判成"非法/不命中"⇒ 那样这条自查会**恒绿**。
    const CONTROL_SELECTORS = [
      '.next-btn', '.choice-bar', '.choice-skip', '.choice-confirm', '.choice-action-btn',
    ] as const;
    const controlsIn = (block: HTMLElement): number => CONTROL_SELECTORS
      .reduce((n, sel) => n + block.querySelectorAll(sel).length, 0);
    const selfBlock = blocks.find((b) => b.dataset.netSeat === 'self');
    const foeBlock = blocks.find((b) => b.dataset.netSeat === 'foe');
    if (blocks.length !== 2 || selfBlock === undefined || foeBlock === undefined) {
      fatal.push(`约束 11：找不到两块信息块（self/foe 各一块）—— 实际 ${blocks.length} 块`
        + `（[${blocks.map((b) => String(b.dataset.netSeat)).join(', ')}]），按钮归属无从核对`);
    } else {
      const foe = controlsIn(foeBlock);
      if (foe > 0) {
        fatal.push(`约束 11：对手那一侧不得出现任何操作控件（刷新/下一步/选择条），实际 ${foe} 个`
          + ' —— 用户原话："对手那一侧只显示信息，不再有按钮"');
      }
      const self = controlsIn(selfBlock);
      if (acting !== null && self > 0) {
        const mine = appliedSeat !== null
          && (acting.turnPlayer === appliedSeat || acting.operator === appliedSeat);
        if (!mine) {
          fatal.push(`约束 11：自己那一侧出现了 ${self} 个操作控件，但这一帧的行动方是 P`
            + `${acting.turnPlayer + 1}、操作方是 `
            + `${acting.operator === null ? '（无挂起选择）' : `P${acting.operator + 1}`}`
            + `，而我是 P${(appliedSeat ?? 0) + 1} —— 用户原话："只在轮到自己时出现在自己这一侧"`);
        }
      }
    }
  } catch (err) {
    fatal.push(`约束 11 的操作按钮归属自查抛异常（${String(err)}）`);
  }

  if (soft.length > 0) console.info('[render-net] 状态相关钩子当前为空（合法局面）：\n' + soft.join('\n'));
  if (fatal.length === 0) {
    return soft.length === 0
      ? '自查 ✓ A 类钩子齐 / 手牌顺序 [P0,P1] / 对手卡与协议 180° / 特效朝向标记齐（卡 + 协议）/ 方向座位一致'
      : `自查 ✓（${soft.length} 条状态相关钩子当前为空）`;
  }
  console.warn('[render-net] 运行时自查发现失败项（源码守卫之外的运行时证据）：\n' + fatal.join('\n'));
  return `自查 ✗ ${fatal.length} 项：${fatal[0]}`;
}

/* ============================================================================
 * 模块态（远程页自有；`resetNetUiState` 清的就是这些）
 * ========================================================================== */

/** 上一次生效的选择请求 id：prompt 换了就重开选择（与盘本体同语义）。 */
let netChoicePromptId: string | null = null;

/** 预览工具条的最近一次操作反馈文本（仅 `onPreviewChange` 存在时使用；本地预览的可见反馈）。 */
let netPreviewNote = '';

/** R11-2 的滚动跟随绑定是否已装（**一次性**，见 `bindNetScrollSync`）。 */
let netScrollSyncBound = false;
/** 同一帧内的多次滚动事件合并成一个回调（见 `bindNetScrollSync` 的说明）。 */
let netScrollSyncRaf = 0;

/**
 * 链路滚动区的**最近一次滚动位置**（G2 修正 **R12-5**）。
 * `null` = 还没有记录 ⇒ 本帧用"双方协议的交锋点（中线）"做**默认位置**；
 * 之后一律按这个值恢复（**只在没有记录时才用默认值** —— 每帧都跳回中线比不滚更烦人）。
 * 由 `restoreLaneScroll` 写、由 `bindNetScrollSync` 的滚动回调更新。
 */
let netLaneScroll: number | null = null;

/**
 * **R12-5 的归中算术**（纯函数，单独导出只为让它可被单测 —— 这是本波唯一一处"坐标算术"）：
 * 把中线放到滚动区**正中**所需的 `scrollTop`，并**夹在** `[0, max]` 内
 * （链路顶端/底端附近必须夹住，否则会滚出内容、露出空白）。
 *
 * 反空集合（`tests/ui/net-dock.test.ts` 的 G-17e 逐条验算）：未夹住时
 * `scrollTop + clientH / 2 == midTopInContent + midH / 2`（中线中心 == 可视区中心）。
 */
export function laneScrollDefault(
  midTopInContent: number, midH: number, clientH: number, max: number,
): number {
  return Math.max(0, Math.min(max, midTopInContent - (clientH - midH) / 2));
}

/**
 * **R12-5：链路滚动区的默认位置 = 双方协议的交锋点（中线）。**
 *
 * 用户第五次验收原话："将默认的位置定为双方协议的交锋点，而不是对方链路的顶部"。
 * 竖排布局里"最上面"是对手的能量槽与链路顶端（信息量最低的地方），而**中线**才是双方协议相对的
 * 交锋点 —— 一进页面就该看到它。
 *
 * ⚠️ **必须由 JS 做，CSS 做不到**：`scrollTop` 没有样式属性；而 DOM 顺序（谁在文档里靠前）
 * 是红线（`.hand`/层的顺序、FX 按下标取值），不能靠"把中线排到最前"来实现。
 * ⚠️ **量不到布局时安静退出**：测试的 DOM 桩没有 `scrollHeight`/`clientHeight`（`NaN`）
 * ⇒ 直接返回，不写记录、不做除法（否则会写出 `NaN` 并把它记进模块态）。
 * ⚠️ 调用时机：`root.appendChild(wrap)` **之后**、`deferredFx` **之前**（那些几何型 FX
 * 按矩形定位，必须先滚再量）。
 */
function restoreLaneScroll(grid: HTMLElement): void {
  const max = Number(grid.scrollHeight) - Number(grid.clientHeight);
  if (!Number.isFinite(max) || max <= 0) return;      // 一屏放得下 / 桩环境量不到 ⇒ 不需要滚
  if (netLaneScroll !== null) {
    grid.scrollTop = Math.max(0, Math.min(max, netLaneScroll));
    return;
  }
  const mid = grid.querySelector<HTMLElement>('.net-lane-mid');
  if (mid === null) return;
  const g = grid.getBoundingClientRect();
  const m = mid.getBoundingClientRect();
  if (!Number.isFinite(g.top) || !Number.isFinite(m.top) || m.height === 0) return;
  // 中线在**滚动内容**里的位置（当前 scrollTop 参与换算，虽然新建节点的它恒为 0）
  const midTop = m.top - g.top + grid.scrollTop;
  netLaneScroll = laneScrollDefault(midTop, m.height, grid.clientHeight, max);
  grid.scrollTop = netLaneScroll;
}

/**
 * **R11-2：链路区内部滚动 ⇒ 持久 FX 层必须跟着重新定位。**
 *
 * 为什么必须有：R11-2 把"链路那一行自己滚"作为"停靠栏永远可见且不遮放牌区"的机制
 * （见 `styles-net.css` 第 1 节的推导），而**持久 FX 层不住在链路区里**：
 *   · `.compiled-fx`（已编译协议的环 / 角光 / 藤蔓）由 `buildCompiledFx` 挂到 **document.body**、
 *     `position: fixed`（`styles.css:587-602`）⇒ 它们**不随任何滚动移动**；
 *   · FX-R2 的锁链层（`chainLayer`）同样是 body 级固定层。
 * 两者的"跟随"本来就只发生在**渲染时**（`syncCompiledFxLayers` / `syncChainLayerPosition`），
 * 而"滚动"过去只在**整页**滚动时发生（用户很少滚、且每次操作都会重渲染）。
 * 内部滚动区把这件事变了：**玩家会经常滚链路区**，而不触发任何重渲染 ⇒ 协议特效会**停在旧屏幕坐标**上
 * （正是用户 R8 第 4 条反馈"所有协议的特效都没有跟着协议转过来"的同一族观感缺陷）。
 *
 * ## 为什么绑在 `document` 上、且用**捕获**阶段
 * `scroll` 事件**不冒泡**，但**捕获**阶段会从 window 一路经过 document ⇒ 在 document 上以
 * `capture: true` 监听可以收到**任何**滚动容器（含每帧重建的 `.net-grid`）的事件，
 * 不必每帧往新节点上重绑、也不会漏掉整页滚动。
 * ## 为什么用 rAF 合并
 * 滚动事件频率远高于帧率，而这两个同步函数会**写内联样式再读矩形**（`positionCompiledFxLayer`
 * 里是"读 holder 矩形 + 写层盒"）—— 逐事件执行会在一帧内反复触发布局。
 * ## 为什么是"构造性"的零影响（热座页）
 * 本函数**只在 `renderNetBoard` 里**调用（`render.ts` 一行未改）⇒ 热座页**从不**装这个监听；
 * 而且回调自己还会再确认一次"页面上有 `.net-board`"（同一份 bundle 里两页互斥，属双保险）。
 * ⚠️ 诚实边界：本仓的 DOM 桩里 `addEventListener` 是 noop ⇒ 这条**没有行为腿**，
 * 只有源码腿（`tests/ui/net-dock.test.ts` 的 G-16）+ 人眼（滚链路区时协议环是否跟上）。
 */
function bindNetScrollSync(): void {
  if (netScrollSyncBound) return;
  netScrollSyncBound = true;
  if (typeof document === 'undefined' || typeof document.addEventListener !== 'function') return;
  document.addEventListener('scroll', () => {
    // 同一帧只跑一次（见上面的 rAF 说明）
    if (netScrollSyncRaf !== 0) return;
    netScrollSyncRaf = requestAnimationFrame(() => {
      netScrollSyncRaf = 0;
      // 双保险：只有本页在屏上时才动手（热座页/主页没有 .net-board）
      if (typeof document.querySelector !== 'function' || document.querySelector('.net-board') === null) return;
      syncCompiledFxLayers();
      syncChainLayerPosition();
      // R12-5：顺手把链路滚动区的位置**记下来**（跨重渲染保持；见 `restoreLaneScroll`）
      const lane = document.querySelector<HTMLElement>('.net-grid');
      if (lane !== null && Number.isFinite(Number(lane.scrollHeight))) netLaneScroll = lane.scrollTop;
    });
  }, true);
}

/**
 * **信息遮蔽的边界（G2 Task 4F · §5-1，已知 / 延后 —— 不在本轮实现）**：
 * 本页的席位遮蔽只作用于**手牌区**（`renderHand` 的 `'count'` 分支）。而**选择浮层**
 * （`buildChoicePickOverlay`）：把 prompt 候选按**真卡面**渲染 —— 其中 `corruption-2` 顶
 * （`core/rules/corruption.ts:69-71`）与 `courage-0` 底（`core/rules/courage.ts:36-37`）的候选
 * **就是对手手牌**（`chooser: foe`）⇒ 遮蔽模式下这些卡的内容会进 DOM。
 * 本机单视角预览**没有第三方受害**（同屏只有你一个人），故 G2 只记 Minor；
 * **但 G5 必须在会话/传输层按 seat 过滤 prompt 与候选** —— 渲染层挡不住（信息一旦进 DOM 就能被读）。
 * 另一处同族但更轻的遗留（§5-2）：**预览页翻面无动画** —— 热座的翻面动画长在 `renderBoard` 的
 * 内联回调里，本页复用叶子助手不带它，属观感差异而非缺陷。
 */

/**
 * 清空**远程页自有**的模块态。热座页的模块态（选择态 / 挡板宽度 / 电池动画 / 选择模式 /
 * body 级常驻层）**不在这里清** —— 那是 `render.ts` 的 `resetUiState()` 的职责，
 * Task 4 会在 `main.ts` 的 `resetToMainInterface` 里并排调用两个。
 *
 * 当前只清两项，都是本文件私有的纯 UI 记账：
 *  - `netChoicePromptId`：跨局残留会让新局第一次渲染误判为「prompt 没变」而保留旧勾选；
 *  - `netPreviewNote`：预览工具条的反馈文本。
 * 选择态（手牌选择 / 选择模式已选）**故意不在这里清** —— 两页共用同一份，谁清都会踩到另一页；
 * 它们由 `pruneSelection()` 与「prompt 变化即重开」自适应。
 */
export function resetNetUiState(): void {
  netChoicePromptId = null;
  netPreviewNote = '';
  // ── G2 修正 **R15-2**：页面级标记 `body.net-page` 必须**随离页清掉** ──
  // 它与上面两项**不同类**：那两项是本文件的模块态，这一项是**挂在 body 上的页面标记**
  // （`renderNetBoard` 加，见那里的注释）。放在这里是因为本函数正是"离开远程页"的复位点
  // （`main.ts` 的 `resetToMainInterface` 与 `resetUiState` 并在调用它）——
  // 标记若残留，热座页会给**已编译协议**错套一层远程页专用的发光（`styles-net.css`
  // 第 6b 节的 `body.net-page .compiled-fx`）——不报错、只是一圈不该有的光。
  // ⚠️ 与同文件其它 DOM 访问同款防御（无 document / 无 body / 桩没有 classList 时静默跳过）：
  // 本函数也会在**纯 node 测试**里被调用。
  const b = (globalThis as { document?: { body?: { classList?: { remove(c: string): void } } } })
    .document?.body;
  b?.classList?.remove(NET_PAGE_CLASS);
}

/* ============================================================================
 * 顶部 / 中线 / 带
 * ========================================================================== */

/** 该玩家是否是**当前回合**玩家（`interactable` 用。注意：这是回合归属，**不是**座位归属）。 */
function isTurn(s: GameState, player: PlayerId): boolean {
  const turn = s.turnPlayer;
  return turn === player;
}

/** 连接状态占位（真实联机由 G5 提供；本阶段恒为「本地预览」）。
 *
 *  R6：它原来挂在**顶部**对手条上（那条已取消）→ 移到**对手信息块**里（底部行右块的最下方）。
 *  它是"本页到底是本地预览还是真联机"唯一的页面内反馈，**不是**装饰：删掉它，用户在预览页
 *  就无从判断对局是不是真的联上了（真实联机时 G5 会把这段文本换成会话状态）。 */
function renderConnectionBadge(): HTMLElement {
  return el('span', 'net-conn net-conn-local', '● 本地预览（未联机）');
}

/**
 * 控制轨（G2 修正 R3 · 用户裁决：**改成竖向，自己端在下、对手端在上**）。
 *
 * 三件事分开做，因为它们**不是同一回事**：
 *  1. **轴向** = 组件自己的属性 ⇒ 交给共享助手 `renderControlModule(s, { axis: 'y' })`
 *     （缺省 `'x'` **逐字保留**热座语义）；竖向的视觉规则写在 `styles-net.css`（`styles.css` 一行不改）。
 *  2. **归属**（`held-N` / `控制权: 玩家 N`）= **绝对玩家号** `s.control` ⇒ `holder` 参数，
 *     原样交进去（它就是引擎里那个数，不需要任何座位换算）。
 *  3. **位置端** = **页面的座位**（自己端在下 = 大端 / 对手端在上 = 小端）⇒ 在**本页**用
 *     `fxIsSelfSide` 算成 `0 / 1` 再交给助手的 `end` 参数（见 `netControlEnd`）。
 *
 * ⚠️ **G2 修正 R16（旧行为为什么错）**：R3~R15 期间 2 与 3 是**同一个** `holder`，而本页当时写的是
 * `fxSeatEndToPlayer(s.control, viewSeat)` —— 那是"**端 ⇒ 绝对玩家号**"的换算，被当成
 * "**绝对玩家号 ⇒ 端**"用了（方向反了）。后果（最小 DOM 桩实测）：
 *   - **位置**在两种座位下**全错**：自己持控停在对手端 22%、对手持控停在自己端 78%，
 *     而 FX 侧 `fxTrackEndFor` 按座位算 ⇒ 特效打在自己端 78% —— 差 56%（158px 轨道上 88.5px，
 *     观感就是"特效没打在滑块上"）；
 *   - `viewSeat = 1` 时**归属**也错：P2 自己持控被写成 `held-0` /"玩家 1"。
 * 拆成 `holder`（绝对号）+ `end`（端）之后两条各自只有一个输入（`render.ts` 的
 * `ControlTrackOpts.end` 有完整推导）。
 *
 * ⚠️ A 类钩子 `.control-module` / `.control-track` / `.control-slider-img` 的**产出方拼写一字未改**
 * （仍由 `renderControlModule` 产出 —— 调用点在 `renderNetBoard` 里的 `grid.appendChild(…)`）。
 * ⚠️ **R16 删掉了旧的 `netControlHolder(s, viewSeat)`**：它唯一的职责是那次**方向反了**的换算
 * （见上），而换算修好后 `holder` 就是 `s.control` 本身。留一个"看着像在换算"的包装函数，
 * 正是下一个人把端与绝对号再混起来的入口（与 `fx-seat.ts` 删两个零调用导出的理由同款）。
 */

/**
 * 滑块贴**哪一端**：`0` = 小端（上 = 对手端 22%）、`1` = 大端（下 = 自己端 78%）、`-1` = 中立居中。
 *
 * 判据只有 `fxIsSelfSide`（`fx-seat.ts` 的"哪一端是自己"唯一出处）：自己端恒为大端（下），
 * 与 `fxTrackEndFor(seat, to)` 的竖向分支**同向同源**。"端"的编号约定（0 = 小端 = 上）与
 * `renderControlModule` 的位置算式一致，所以"自己在下"这条用户裁决在两端都只有一处表达。
 */
function netControlEnd(s: GameState, viewSeat: PlayerId): -1 | PlayerId {
  return s.control === -1 ? -1 : (fxIsSelfSide(viewSeat, s.control) ? 1 : 0);
}

// （`renderPiles` 原来在这里；G2 修正 R6 把它随"信息块"一起挪到下方的底部行一节 ——
//   它的两个挂载点现在**对称**了（每侧各一次），注释与不重复产出的论证都写在那里。）

/** 一侧的「能量槽」+「链路槽」+「协议格」三层。
 *
 *  ⚠️ **DOM 顺序 = 视觉顺序（列内自上而下），而两侧是镜像的**（G2 修正 R-F · **C-2**；
 *  **R8-2 把能量槽也纳入这条规则**）：
 *  - **对手侧**（上半）：能量槽（层 1，最外）→ 链路槽（层 2）→ 协议格（层 3，贴中线）；
 *  - **自己侧**（下半）：协议格（层 4，贴中线）→ 链路槽（层 5）→ 能量槽（层 6，最外）。
 *
 *  R1 曾对两侧都挂 `[链路槽, 协议格]`（那只对上半成立），于是**自己协议落到整列最外端**
 *  —— 这正是 C-2，评审用最小 DOM 桩真跑 `renderNetBoard` 查元素树才发现。
 *  现在 `tests/ui/net-lane-tree.test.ts` 把"一列自上而下 = §1 的六层"钉成**行为机检**。
 *
 *  ⚠️ **R8-2：CSS `order` 彻底退役**。R1~R7 期间能量槽是 `.stack-slot` 的子节点、靠
 *  `.net-side-foe/.net-side-self` 的 `order` 摆到外端 —— 而 `order` 一旦被写成**按绝对玩家号**
 *  （`.p1`/`.p2`），默认席位下两个能量槽会一起跑到内侧，且当时的守卫还是绿的（C-2 的第二个成因）。
 *  用户裁决「能量槽要放在链路框**外**」之后，`.net-side` 是 flex column ⇒ **DOM 兄弟顺序 = 视觉
 *  上下顺序**，两侧镜像只由本函数的挂载顺序表达 —— **"哪一层在哪"只剩这一个出处**。
 *
 *  `kind`：`'foe' | 'self'` —— 选类名、朝向、挂载顺序与生长类；`data-player` 仍写**绝对玩家号**。 */
function renderSide(
  s: GameState,
  player: PlayerId,
  line: Line,
  viewSeat: PlayerId,
  kind: 'foe' | 'self',
  cb: UiCallbacks,
): HTMLElement {
  const isSelfSeat = player === viewSeat;
  const side = el('div', 'net-side net-side-' + kind);
  side.dataset.player = String(player);
  const { uid, faceUp } = getHandSelection();
  // 只有当前回合玩家的链路槽可交互（与热座页一致：interactable 由引擎回合归属决定）
  const myTurn = isTurn(s, player);
  // ⚠️ 节点**先建后按侧挂载**：本页守卫第 2 条的判据是 `appendChild(<call>` 或 `= <call>`
  //    （"结果真的流进 DOM"）—— 绑定成局部变量再挂载仍然满足，而顺序由下面的 `kind` 分支决定。
  // ── G2 修正 R14-2：交互权 = 「**我这一侧** + **轮到我**」──
  // 旧的第 4/6 实参是 myTurn（= 那个**玩家**是不是回合玩家）⇒ 对手回合时**对手的槽**也变成
  // interactable（hover / 落点高亮 / 点击/拖拽打牌），而我这台机器上根本没有"往对手槽打牌"这回事。
  // ── G2 修正 R15-2：**合法的他侧落点也要可交互**（用户报："腐化0 打对方场时看不出能放哪"）──
  // 上一行的判据把**对手侧的槽**一律排除 ⇒ 腐化0（`game.ts:65-72` 产出 `target: 对方` 的合法
  // play）只能靠**拖拽**落到对手列，而拖拽期的高亮要求目标槽带 `.interactable`
  // （`render.ts` 的 `beginDrag` 给合法落点加 `.drag-target`，而 `styles.css` 的
  // `.stack-slot.interactable.drag-target` 才画出落点框）⇒ 对手列**永远不会亮** ⇒ 玩家无从
  // 得知能放哪；**点击落点**这条路径也整条不可达（`renderStackSlot` 只在 `interactable` 时
  // 才挂 click 与 hover）。
  //
  // 判据与热座**同源**（`render.ts` 的 `renderBoard` 用 `selectedCanPlayToOpp`），且必须与
  // `playToLine` 的校验**逐字段同构**（否则会出现"高亮了但点了没反应"）：
  //   `playToLine` = `a.kind==='play' && a.cardUid===uid && a.line===line && a.faceUp===selectedFaceUp
  //                   && (a.target ?? s.turnPlayer) === targetPlayer`（`render.ts:4886-4892`）
  // 这里就是它在本槽（`line` / `player`）上的实例化。
  //
  // ⚠️ 只影响「**可交互 / 高亮**」：第 6 实参 `canAct` 与第 4 实参（选中 uid）都由它派生；
  //    往对手槽打牌**没有**因此向"轮到我但目标不合法"的槽放开 —— 不合法时 `canAct` 仍为 false。
  //    点击落点走的回调 `(l) => playToLine(s, cb, l, player)` **本来就是对的**
  //    （`player` 就是"打到谁的场"），一行未改。
  //
  // ⚠️⚠️ **不能**把 `myTurn`（= `isTurn(s, player)`，那个**槽的属主**是不是回合玩家）放进这条
  //    判据：合法落点恰恰是**对手**那一侧，而对手的 `myTurn` 恒为 false ⇒ 判据恒 false
  //    （我第一版就是这样，行为腿实测 `selectedCanPlayHere: false`）。
  //    "能不能行动"属于**我（视角座位）**，与"这个槽是谁的"无关 —— 它由
  //    `getLegalActions(s, s.turnPlayer)` 是否给出 play 表达（引擎在 `game.ts:45-48` 保证：
  //    不是回合玩家 / 非 action 步 / 有挂起时一律返回空数组）。于是"对手回合时我这侧不可交互"
  //    （R14-2）仍然成立：那时 `selectedCanPlayHere` 对任一侧都是 false。
  const legalPlays = getLegalActions(s, s.turnPlayer).filter((a: LegalAction) => a.kind === 'play');
  const selectedCanPlayHere =
    uid !== null && legalPlays.length > 0 &&
    legalPlays.some(
      (a: LegalAction) =>
        a.cardUid === uid && a.line === line && a.faceUp === faceUp &&
        (a.target ?? s.turnPlayer) === player,
    );
  const canAct = (isSelfSeat && myTurn) || selectedCanPlayHere;
  const slotNode = renderStackSlot(
    s, player, line, canAct ? uid : null,
    (l) => playToLine(s, cb, l, player),
    canAct,
    {
      // 自己 0°、对手 180°（约束 2）。`isSelfSlot` 必须显式给座位真值：
      // 缺省值用的是 `s.turnPlayer`（那是回合），在远程页会让高亮每回合翻面。
      isSelfSlot: isSelfSeat,
      orient: isSelfSeat ? 0 : 180,
      // 竖向生长（R1/R-F/R-F2）：自己向下（`.grow-down`）/ 对手向上（`.grow-up`）。
      // ⚠️ 语义必须按**侧**给，且由本页（**唯一知道侧别**的地方）直接给方向：
      //    `vGrow: 'down' | 'up'` 一次说清"挂哪个类"+"DOM 卡序往哪边"（见 `renderStackSlot` 的 opts 说明）。
      //    R-F 曾用 `vGrow: true + selfPlayer: viewSeat`（按座位算配对）—— 那会留下
      //    "传了 vGrow 忘传 selfPlayer ⇒ 静默按 P0 = 自己"的坑（R-F2 采纳的设计建议），
      //    也会让共享助手读到一个它本不该知道的"座位"概念。
      vGrow: kind === 'self' ? 'down' : 'up',
      // 特效朝向标记（约束 8；R1 只产出、R2 才读）：自己 ccw、对手 cw。
      fxRot: isSelfSeat ? 'ccw' : 'cw',
      // ── R8-2：**不在链路槽里**挂能量槽 ──
      // 用户裁决："能量槽目前都被放在了链路框中，这样是不对的，应该要放置在对应链路的底部横置，
      // 如果是对方的就放在顶部"。所以本页传 `false`，由下面那一处自己调 `renderBattery` 并挂到
      // `.net-side` 的**外端**。⚠️ `false` 不是"少挂一个、以后再补"：那是**唯一**一处落点
      // （规格 §4 红线 7：不许留两套真相 / 不许留 display:none 的死 DOM —— 那会让
      // `NET_PAGE_HOOKS` 的 `.battery` 计数与产出链条同时失真）。
      withBattery: false,
    },
  );
  // 协议格朝向同样按座位：自己逆时针 90°（`.net-rot-ccw`）、对手顺时针 90°（`.net-rot-cw`）。
  // ⚠️ `orient`（0 / 180）是**卡面**朝向，`extraClass` 是**协议图**的 ∓90° —— 两套朝向并存，
  // 理由见文件头约束 2（`.rot-cw/.rot-ccw` 会被 `orientOf` 当卡面朝向读，故协议用自己的类）。
  // ── G2 修正 R8-4：第 6 实参 = 同一个 `isSelfSeat` 派生的**特效朝向标记** ──
  // 两处（协议图的类 / holder 的 `data-fx-rot`）都由这一个座位真值派生 ⇒ **不可能脱钩**。
  // 它让协议 FX 能跟着协议横躺（层绕自身中心转同一个 ∓90°：`positionCompiledFxLayer`）。
  const protoNode = renderProtocolCell(
    s, player, line, isSelfSeat ? 0 : 180, isSelfSeat ? 'net-rot-ccw' : 'net-rot-cw',
    isSelfSeat ? 'ccw' : 'cw',
  );
  // 能量槽（横置；点数 >10 的溢出数字也由它自己产出）。`data-player`/`data-line` 由
  // `renderBattery` 写在根节点上 ⇒ 6 处 FX 用**与位置无关**的 `.battery[data-player][data-line]`
  // 定位（见 `renderBattery` 的注释与 `gen3-control.ts` 的 `batteryNode`）。
  const batteryNode = renderBattery(s, player, line);
  // ── 层序（§1 的六层）：中线两侧**都是协议**，所以两侧的挂载顺序必须镜像 ──
  if (kind === 'self') {
    side.appendChild(protoNode);     // 层 4：自己协议（贴中线）
    side.appendChild(slotNode);      // 层 5：自己链路（协议外侧）
    side.appendChild(batteryNode);   // 层 6：自己能量槽（最外端 = 链路**下方**，横置）
  } else {
    side.appendChild(batteryNode);   // 层 1：对手能量槽（最外端 = 链路**上方**，横置）
    side.appendChild(slotNode);      // 层 2：对手链路（协议外侧）
    side.appendChild(protoNode);     // 层 3：对手协议（贴中线）
  }
  return side;
}

/**
 * 列内中线：双方线值 + 线号。**按绝对玩家**标注（P1 在左、P2 在右），
 * 与方向性 FX 的绝对玩家假设一致（约束 3）；数值与电池同源（同一个 `getLineValue`），
 * 避免出现「电池 7 格 / 中线写 6」这种两处不一致。规格 §1 没给它的朝向（只有协议要 ∓90°），
 * 故**不旋转**（多转一个文字块只会让线号/数字变成躺着的，且没有任何依据）。
 */
function renderLaneMid(s: GameState, line: Line): HTMLElement {
  const mid = el('div', 'net-lane-mid');
  mid.dataset.line = String(line);
  for (const p of [0, 1] as PlayerId[]) {
    const side = el('span', 'net-lane-value' + (p === 1 ? ' net-lane-value-p2' : ''));
    side.appendChild(el('i', 'net-lane-who', `P${p + 1}`));
    side.appendChild(el('b', 'net-lane-points', String(getLineValue(s, p, line))));
    mid.appendChild(side);
  }
  mid.appendChild(el('span', 'net-lane-name', `线 ${line + 1}`));
  return mid;
}

/**
 * 一条线 = **一个纵向的列**（G2 修正 R1）。列内自上而下严格是规格 §1 的六层：
 *   对手能量槽 → 对手链路 → 对手协议 → 自己协议 → 自己链路 → 自己能量槽
 *
 * 本函数只负责**三段的挂载顺序**（对手侧 → 中线 → 自己侧）—— 每一侧内部的**三层顺序**
 * （对手：能量槽→链路→协议 / 自己：协议→链路→能量槽）由 `renderSide` 按 `kind` 镜像表达，
 * 而"哪一层在哪"**只**由 DOM 兄弟顺序决定（R8-2 之后 CSS `order` 已彻底退役，见 `renderSide`）。
 * 三个列由 `renderNetBoard` 的 `for (const line of [0, 1, 2])` 并排产出
 * ⇒ **整块棋盘从"三条横带"变成"三个竖列"**。
 *
 * 视觉上的"上/下"按 `viewSeat` 换算成绝对玩家号（`foe = 1 - viewSeat`，故 `viewSeat = 1` 时
 * 整列垂直镜像），但 `data-player` 永远写**绝对值**（设计稿 §6.2）。
 * 「对手侧 180°」由**卡/协议自身**的 `.rot-180` / `.net-rot-cw` 承担 —— **不是**父级 transform：
 * 列级 `rotate(180deg)` 会与卡自身的 `.rot-180` 叠加成 0°（对手的卡其实正立）并把该列水平镜像
 * （G2 Task 3 的 C-4；`styles-net.css` 第 3 节有完整说明）。
 */
function renderLaneColumn(s: GameState, line: Line, viewSeat: PlayerId, cb: UiCallbacks): HTMLElement {
  const foe = (1 - viewSeat) as PlayerId;
  const col = el('div', 'net-lane-band');
  col.dataset.line = String(line);
  col.appendChild(renderSide(s, foe, line, viewSeat, 'foe', cb));
  col.appendChild(renderLaneMid(s, line));
  col.appendChild(renderSide(s, viewSeat, line, viewSeat, 'self', cb));
  return col;
}

/* ============================================================================
 * 选择模式（三个 choice-* 分支）
 *
 * 这里**重写**（不是复用盘本体里的那份）—— 原因只有一个：那份长在盘本体里，
 * 而盘本体在远程页必须另写（设计稿 §6.1）。重写时一律走 `cb.rerender?.()` 回到**当前页**，
 * 绝不直调 renderApp（否则用户在远程页的选择浮层里点一张候选卡，整页会跳回热座棋盘）。
 * `choiceBar` / `buildChoicePickOverlay` / 选择态读写口则**一律复用**。
 *
 * ⚠️ **调用时机是承重的（C-1）**：本函数在 `renderNetBoard` 里必须于 `wrap.appendChild(grid)`
 * **之后**执行 —— 内部三处 `wrap.querySelectorAll(...)` 都是"给已在 DOM 里的节点加类/挂点击"。
 * 曾经它在 grid 之前跑：`select-line` 拿到 0 条 `.net-lane-band` → 没有可点目标，而
 * `choiceBar` 对 select-line 没有确认按钮 → **非 optional 的 select-line 永久无法应答、对局卡死**。
 * ========================================================================== */

/** 「跳过」按钮（可选 prompt 的空应答）。 */
function choiceSkipBtn(promptId: string, cb: UiCallbacks): HTMLElement {
  const skip = el('button', 'btn choice-skip', '跳过');
  skip.addEventListener('click', () => {
    setChoiceSelection([], null);
    cb.onAction({ kind: 'effect-choice', promptId, choice: [] });
  });
  return skip;
}

/**
 * 把选择条挂到**自己那一侧的信息块**里（G2 修正 **R8-8** → **R11-3**）。
 *
 * 用户原话（第三次验收）："没轮到自己的回合或是卡牌触发效果不需要自己进行操作，就不用在己方显示
 * 下一步之类的跳过按钮，只有需要操作的那一方才会显示"；
 * 第四次验收又收紧成："操作按钮（刷新/下一步/选择条）**只在轮到自己时出现在自己这一侧** ——
 * 对手那一侧**只显示信息**，不再有按钮"。
 *
 * 改之前：三个分支都是 `wrap.appendChild(bar)`，而 `.choice-bar` 在 `styles.css` 里是
 * `position: fixed; left: 50%; bottom: 18px`（**视口底部中央**）—— 与"谁在操作"无关，
 * 看上去永远像"挂在我这边"。R8-8 把它挂进 `who` 的信息块、由 `styles-net.css` 的
 * `.net-board .choice-bar { position: static; … }` 改成**流内**元素；
 * **R11-3 再补一刀：只有 `who === viewSeat`（操作方就是自己）时才会调用本函数**
 * （调用点的闸门在 `renderChoiceUi` 里的 `mountIfMine`）——
 * 所以"对手那一侧一个按钮都没有"是**构造性**的，而不是靠"记得别挂"。
 *
 * ⚠️ **找不到那一块时的处理（不许静默丢弃）**：退回挂在 `wrap`（棋盘根）上并 `console.warn`。
 * 为什么不是"找不到就不挂"：`choiceBar` 对 `select-line` **不产出确认按钮**，而 select-line 常常是
 * **非 optional** 的 —— 按钮一丢，这个 prompt 就**永久无法应答、整局卡死**（C-1 踩过的同一形态）。
 * 挂在 `wrap` 上按钮仍然可点（只是位置不好看），是"降级但可玩"；`console.warn` 让这次降级**可见**
 * （页面结构错——例如 `NET_BOTTOM_SIDES` 被改坏、`data-player` 没写——不会变成静默的特效错位族）。
 */
function mountChoiceBar(wrap: HTMLElement, who: PlayerId, bar: HTMLElement): void {
  const host = wrap.querySelector<HTMLElement>(`.net-info-block[data-player="${who}"]`);
  if (host) { host.appendChild(bar); return; }
  console.warn(`[render-net] R8-8：找不到操作方 P${who + 1} 的信息块`
    + `（.net-info-block[data-player="${who}"]）—— 选择条退回挂在棋盘根上：`
    + '按钮不会丢（丢了的话非 optional 的 prompt 会永久卡死），但页面结构已经不对，'
    + '请检查 renderInfoBlock / NET_BOTTOM_SIDES / data-player 的产出。');
  wrap.appendChild(bar);
}

/** 选择条共用的操作者标签（改动提示词 17 的横幅 + 标题）。 */
function appendOperatorHeader(bar: HTMLElement, who: PlayerId, title: string): void {
  bar.appendChild(el('div', 'operator-banner', `请 玩家 ${who + 1} 操作`));
  bar.appendChild(el('div', 'choice-title', `P${who + 1} 操作 — ${title}`));
}

function renderChoiceUi(
  wrap: HTMLElement,
  hands: HTMLElement,
  root: HTMLElement,
  s: GameState,
  cb: UiCallbacks,
  deferredFx: Array<() => void>,
  viewSeat: PlayerId,
): void {
  const top: PendingEffect | undefined = s.pendingEffects[s.pendingEffects.length - 1];
  // `PendingEffect.prompt` 的类型是 `ChoiceRequest | null`（types.ts:240）—— 这里统一成 undefined
  const prompt: ChoiceRequest | undefined = top?.prompt ?? undefined;
  if (!prompt || !top) {
    netChoicePromptId = null;
    // I-4：没有 pending 选择 → **必须清掉**共享选择态里的 promptId。否则 render.ts 的两处守卫
    // （`:5583` 选择模式禁止拖拽打牌、`:1658` 手牌单击选中）会在 prompt 结束后**永久锁死**。
    setChoiceSelection([], null);
    return;
  }
  // 换 prompt → 重开选择（原为盘本体内联；这里是同一语义的单一实现）；
  // prompt 未换 → **每帧重申"有选择挂起"**（I-4：`choicePromptId` 是 render.ts 的全局闸门，
  // 不设置的话候选手牌拿到 .choice-target 后仍可被拖拽打出，与热座页行为不一致）。
  if (netChoicePromptId !== top.id) {
    netChoicePromptId = top.id;
    setChoiceSelection([], top.id);
  } else {
    setChoiceSelection(getChoiceSelection(), top.id);
  }
  // **操作方**（R8-8）：选择条要挂到这一方的信息块里 —— `chooser` 覆盖 `top.player`
  // （规则"被作用卡持有者决定执行"，与 main.ts 的 effect-choice 分发、render.ts 的选择条标签同源）。
  const who = prompt.chooser ?? top.player;
  hands.classList.add('choice-mode');

  /**
   * **R11-3 的闸门**：选择条**只在"操作方就是自己（`who === viewSeat`）"时才挂**。
   * 对手那一侧**只显示信息**（用户第四次验收的字面要求）—— 真联机下对手的选择条画在我的屏幕上
   * 等于把对手的操作面板摊开给我看。
   * ⚠️ 候选高亮 / 点击绑定**不**在这里面：它们只作用于**我这台机器上的节点**，不影响"按钮在哪一侧"，
   * 而且 `deferredFx`（透彻眼睛 / 幸运骰子）的落点也取决于它们所在的这一帧。
   * ⚠️ 本地预览的代价（诚实、已报告用户）：轮到对手应答时预览页上没有确认/跳过按钮 ⇒
   * **切「视角」**（切过去后对手就是 self）即可操作；预览工具条第 2 行会写明这一句。
   */
  const mountIfMine = (bar: HTMLElement): void => {
    if (who !== viewSeat) return;
    mountChoiceBar(wrap, who, bar);
  };

  if (prompt.kind === 'select') {
    const sel = new Set(getChoiceSelection());
    // 2代 clarity-2/3：从牌库选阈值卡 → 效果属主牌库上方浮现古埃及眼睛（M-3：
    // 热座 render.ts:4849 的同款 deferredFx；几何型 FX 必须等 wrap 进 DOM 后执行）
    if (prompt.title.startsWith('透彻：从牌库中选择')) {
      const eyePlayer: PlayerId = who;
      deferredFx.push(() => startClarityDeckEye(eyePlayer));
    }
    // 候选卡高亮 / 其余置灰（本页所有 .card 此时都已入 wrap —— 见 C-1 的调用时机说明）
    for (const node of wrap.querySelectorAll<HTMLElement>('.card[data-uid]')) {
      const uid = node.dataset.uid!;
      const candidate: ChoiceCard | undefined = prompt.candidates.find((c) => c.uid === uid);
      if (!candidate) {
        node.classList.add('choice-dim');
        continue;
      }
      node.classList.add('choice-target');
      if (sel.has(uid)) node.classList.add('choice-selected');
      bindClickOrDouble(
        node,
        () => {
          const next = getChoiceSelection();
          if (next.includes(uid)) setChoiceSelection(next.filter((x) => x !== uid));
          else if (next.length < prompt.max) setChoiceSelection([...next, uid]);
          cb.rerender?.();
        },
        () => openZoom(candidate.defId, candidate.faceUp, false, false),
        true,
      );
    }
    // 棋盘上没有单卡 DOM 的候选（从弃牌堆自选打出 / 从牌库选阈值卡…）→ 复用定向选牌浮层
    const onBoard = new Set<string>();
    for (const node of wrap.querySelectorAll<HTMLElement>('.card[data-uid]')) onBoard.add(node.dataset.uid!);
    const offBoard = prompt.candidates.filter((c) => !onBoard.has(c.uid));
    if (offBoard.length > 0) wrap.appendChild(buildChoicePickOverlay(prompt, offBoard, sel, root, s, cb, top));

    const bar = el('div', 'choice-bar');
    appendOperatorHeader(bar, who, prompt.title);
    const chosen = getChoiceSelection();
    bar.appendChild(el('span', 'choice-count',
      `已选 ${chosen.length}/${prompt.max === Infinity ? prompt.candidates.length : prompt.max}`));
    const canConfirm = chosen.length >= prompt.min && chosen.length <= prompt.max;
    const confirm = el('button', 'btn choice-confirm' + (canConfirm ? '' : ' disabled'), '确认');
    confirm.addEventListener('click', () => {
      if (!canConfirm) return;
      const choice = getChoiceSelection();
      setChoiceSelection([], null);
      cb.onAction({ kind: 'effect-choice', promptId: top.id, choice });
    });
    bar.appendChild(confirm);
    if (prompt.optional) bar.appendChild(choiceSkipBtn(top.id, cb));
    // R11-3：选择条挂到**操作方**（`who`）那一侧的信息块 —— 且**只有操作方是自己时**才挂
    // （非自己那一侧因此一个操作按钮都没有；用户的字面判据）。闸门见 `mountIfMine`。
    mountIfMine(bar);
    return;
  }

  if (prompt.kind === 'select-line') {
    // 线槽高亮：点整条带即答 ['line:N']（带覆盖双方的槽，比热座的单行更符合甲读法）
    for (const band of wrap.querySelectorAll<HTMLElement>('.net-lane-band')) {
      const ln = Number(band.dataset.line);
      if (!prompt.lines?.includes(ln as Line)) continue;
      band.classList.add('choice-target', 'choice-line');
      band.addEventListener('click', () => {
        setChoiceSelection([], null);
        cb.onAction({ kind: 'effect-choice', promptId: top.id, choice: [`line:${ln}`] });
      });
    }
    const bar = choiceBar(top, prompt, cb, '点击高亮的线路选择目标线');
    if (prompt.optional) bar.appendChild(choiceSkipBtn(top.id, cb));
    // R11-3：同上（select-line 的"确认"由整条带的点击承担，但**跳过**按钮在这里，
    // 而它必须落在操作方那一侧 —— 非 optional 的 select-line 只能靠这条带上的点击应答）。
    mountIfMine(bar);
    return;
  }

  // select-action
  const bar = el('div', 'choice-bar');
  appendOperatorHeader(bar, who, prompt.title);
  // 2代 luck 宣告 prompt（luck-0 宣告数字 / luck-3 宣告协议）：宣告卡（效果源卡）中心出现
  // 持续转动的骰子（M-3：热座 render.ts:4945 的同款 deferredFx；startLuckDiceFx 幂等）。
  // 注意：源卡必须是**已在 DOM 里、有非零 rect** 的节点才有骰子 —— 若源卡在对手手里（对手手牌
  // 只剩数量占位、查不到 `[data-uid]`），骰子不出现
  // （函数内部 `cardCenterByUid` 返回 null 即安全跳过，不报错）。这是信息遮蔽的必然取舍。
  if (
    prompt.rearrangeSide === undefined &&
    (prompt.title.startsWith('luck-0：宣告') || prompt.title.startsWith('luck-3：宣告')) &&
    top.sourceUid
  ) {
    const srcUid = top.sourceUid;
    deferredFx.push(() => startLuckDiceFx(srcUid));
  }
  if (prompt.rearrangeSide !== undefined) {
    // 效果内重排（动量4）由 body 级重排窗口承接（main.ts 的 syncRearrangeModalForEffect）
    bar.appendChild(el('div', 'choice-note',
      '请在「重排协议」窗口中点击两张协议交换位置，摆好后点「完成重排」。'));
  } else {
    for (const act of prompt.actions ?? []) {
      const btn = el('button', 'btn choice-action-btn', actionCn(act, top.sourceDefId));
      btn.addEventListener('click', () => {
        setChoiceSelection([], null);
        cb.onAction({ kind: 'effect-choice', promptId: top.id, choice: [act] });
      });
      bar.appendChild(btn);
    }
    if (prompt.optional) bar.appendChild(choiceSkipBtn(top.id, cb));
  }
  // R11-3：挂到操作方那一侧的信息块，且只有操作方是自己时才挂（见 `mountIfMine` 的说明）。
  mountIfMine(bar);
}

/* ============================================================================
 * 底部操作区
 * ========================================================================== */

/**
 * 底部操作区：刷新按钮 + 引擎给的其它行动按钮（编译线/结算触发/清缓存）+「下一步」。
 *
 * 由 `renderInfoBlock` 挂在**当前回合玩家那一侧**的信息块里（R8-8；改之前恒挂自己那侧）——
 * 回合归属由引擎决定，而 `getLegalActions(s, s.turnPlayer)` 本来就只有当前回合玩家有动作，
 * 所以"行动区在哪一侧"必须与它同侧，否则出现"我这边显示对手的下一步"。
 *
 * ⚠️ `s.pendingEffects` 非空时 `getLegalActions` 返回空数组（引擎语义：挂起选择期间没有标准行动）
 * ⇒ 这一帧行动区是**空盒**（`.action-bar:empty { display: none }`），此时"需要操作的那一方"由
 * 选择条（`.choice-bar`，同样挂到操作方那一侧）承担 —— 两条腿合起来才是 R8-8 的完整判据。
 */
function renderNetActionBar(s: GameState, cb: UiCallbacks): HTMLElement {
  const bar = el('div', 'action-bar net-action-bar');
  const legal: LegalAction[] = getLegalActions(s, s.turnPlayer);
  const refreshAction = legal.find((a) => a.kind === 'refresh') ?? null;
  if (refreshAction) bar.appendChild(renderRefreshButton(refreshAction, cb));
  for (const a of legal) {
    if (a.kind === 'play' || a.kind === 'refresh' || a.kind === 'advance') continue;
    const label = a.kind === 'compile'
      ? `编译线 ${(a.line ?? 0) + 1}`
      : a.kind === 'resolve-trigger' ? `结算触发：${a.defId ?? ''}`
      : a.kind === 'clear-cache' ? '清理缓存'
      : a.kind;
    const btn = el('button', 'btn', label);
    btn.addEventListener('click', () => cb.onAction(a));
    bar.appendChild(btn);
  }
  const next = legal.find((a) => a.kind === 'advance');
  if (next) {
    const block = el('div', 'next-block');
    const { uid } = getHandSelection();
    // R12-8：提示语**缩短**（用户第五次验收第 2 条："下方的三大组件过大"）—— 原来那句
    // "点击手牌选择，再点链路槽打出（双击放大查看）"是**不换行的长句**，单靠它就把信息块
    // 撑到 ~270px 宽（比牌堆、按钮都宽）。缩短 + 允许换行（styles-net.css 的 `.hint` 覆盖）。
    block.appendChild(el('span', 'hint', uid
      ? '已选牌 → 点高亮链路槽打出'
      : '点选手牌 → 点链路槽打出（双击放大）'));
    const btn = el('button', 'btn next-btn', '下一步');
    btn.addEventListener('click', () => cb.onAction(next));
    block.appendChild(btn);
    bar.appendChild(block);
  }
  return bar;
}

/* ============================================================================
 * 底部行：**信息块 · 手牌区（中） · 信息块**（G2 修正 R6）
 *
 * 用户裁决（规格 §8.4 第 2 条 / §8.6 的 R6）：**双方信息条与手牌区同一行、一左一右**，
 * **顶部信息条取消**（对手的牌库/弃牌堆随之移进底部那一行）。三块的分工：
 *   · 左块 / 右块：`.net-info-block`（信息条 + **该玩家自己的**牌库/弃牌堆）；
 *   · 中块：`.net-hands`（两条手牌，**DOM 顺序恒 [P0, P1]**，见约束 7）。
 * ========================================================================== */

/** 底部行的**侧**。不是"绝对玩家号"：哪一号是自己由 `opts.viewSeat` 决定（`bottomPlayerOf`）。 */
type NetBottomSide = 'self' | 'foe';

/** 某侧对应的**绝对玩家号**（视图座位 → 绝对号的唯一换算，与 `renderLaneColumn` 的 `foe` 同源）。 */
const bottomPlayerOf = (side: NetBottomSide, viewSeat: PlayerId): PlayerId =>
  (side === 'self' ? viewSeat : (1 - viewSeat) as PlayerId);

/**
 * ⚠️⚠️ **DOM 插入顺序 = 这个数组的顺序**（R6 规格留的"一处常量"）。
 *
 * 本说明取 **`['self', 'foe']`**（信息块按"自己在前、对手在后"插进 DOM）。
 * **R8-5 之后它不再决定"左右"**（左右列已不存在）：视觉位置由 `styles-net.css` 第 6 节的
 * `grid-row` **按侧**决定（对手信息块恒在第 1 行、自己恒在第 5 行），而 `data-net-seat`
 * 就是这个侧别 ⇒ 两条腿永远不会脱钩（改常量只改 DOM 顺序，改 CSS 只改行号；两者不一致时
 * `tests/ui/net-board-grid.test.ts` 的 G-7 会报红）。
 *
 * ⚠️ 它**不**决定、也**不许**影响两条 `.hand` 的 DOM 顺序：手牌区在底部行的 DOM 位置**恒定在中间**
 * （`buildHands` 先 append P0、再 append P1，约束 7）。行号由 `.net-hand-area-{foe,self}` 的
 * `grid-row` 决定。
 */
export const NET_BOTTOM_SIDES: readonly NetBottomSide[] = ['self', 'foe'];

/** 该玩家的牌库 / 弃牌堆（**A 类钩子 `.deck[data-player]` / `.trash-pile.pN` 的唯一产出点**）。
 *
 *  R6 之前它只服务"对手那条顶部信息条 + 自己那一行"两处**不对称**的挂载点；现在两侧对称，
 *  由底部的 `for (const side of NET_BOTTOM_SIDES)` 每侧调一次 ⇒ 每个玩家**恰好一份**。
 *  ⚠️ 这一点是承重的：FX 取牌库/弃牌堆全走 `querySelector`（**取首个**），
 *  同一玩家出现两份 ⇒ 特效飞向用户没在看的那一份，**不报错、不跳过**。 */
function renderPiles(s: GameState, player: PlayerId): HTMLElement {
  const piles = el('div', 'net-piles');
  // `data-player` 写在**容器**上（.deck / .trash-pile 各自也有）：R6 之后两侧对称，
  // "这一堆是谁的"必须能从容器本身读出来（测试与将来任何遍历都不必回读子节点）。
  piles.dataset.player = String(player);
  piles.appendChild(renderDeck(s, player));
  piles.appendChild(renderTrash(s, player));
  return piles;
}

/**
 * **一块信息块** = 信息条（昵称 / 座位 · 牌库 n · 弃牌堆 n · 手牌 n）+ 该玩家自己的牌库 / 弃牌堆。
 *
 * `data-net-seat="self" | "foe"` 是**可机检的侧别真值**：`data-player` 随 `viewSeat` 变，而
 * "这一块是谁的"才是布局语义 —— 测试与 `verifyPageHooks` 都按它判左右归属（规格 §8.4 第 2 条）。
 *
 * `align` 总给 `'left'`（两块的内部排版一致；`styles.css:30-31` 的 `.p1/.p2` 右对齐语义会让右侧
 * 那一块的标题/计数/按钮**分散到两头**，在窄列里很难看）。传 `align` 时 `renderPlayerInfo`
 * 用的是**显式**分支，与热座页（不传）逐字无关。
 *
 * 操作区（`renderNetActionBar`）挂在**自己那一侧**的信息块里，且**只在轮到自己是行动方时**渲染
 * （G2 修正 **R11-3**；R8-8 曾把它挂到"当前回合玩家"那一侧 —— 见下面的判据迁移说明）：
 *
 * 用户第四次验收原话："操作按钮（刷新/下一步/选择条）**只在轮到自己时出现在自己这一侧** ——
 * 对手那一侧**只显示信息**，不再有按钮"。⇒ 判据是 `side === 'self' && player === s.turnPlayer`
 * （`side === 'self'` ⟺ `player === viewSeat`）：
 *   · 自己是行动方 ⇒ 按钮在自己那一侧（用户要的"轮到自己时出现在自己这一侧"）；
 *   · 对手是行动方 ⇒ **两侧都没有按钮**（R8-8 的形态是把对手的「下一步/编译线N/结算触发/清理缓存」
 *     画在对手那一块里，在真联机下等于把对手的操作面板摊在自己的屏幕上；用户点名要去掉它）。
 * ⚠️ **真联机**下这条才是对的：每个玩家只在轮到自己时看到自己的按钮。
 * ⚠️ **本地预览**的代价（诚实、已向用户报告）：轮到对手时预览页上没有任何按钮 ⇒ 推进对手回合
 * 必须切预览工具条的「视角」（切过去后对手就是 self，按钮随之出现）。工具条第 2 行会写明这一句。
 */
function renderInfoBlock(
  s: GameState, player: PlayerId, side: NetBottomSide, operator: PlayerId | null,
  cb: UiCallbacks,
): HTMLElement {
  const isSelf = side === 'self';
  const block = el('div', 'net-info-block net-info-' + side);
  block.dataset.player = String(player);
  block.dataset.netSeat = side;
  const info = renderPlayerInfo(s, player, {
    isSelf,
    operator: operator === player,
    label: isSelf ? '自己（你）' : '对手',
    align: 'left',
  });
  info.appendChild(renderPiles(s, player));
  // 连接状态占位只挂在对手那块（R6 之前它在顶部对手条上）：它是"本页是本地预览还是真联机"
  // 唯一的页面内反馈；真实联机由 G5 换成会话状态。
  if (!isSelf) info.appendChild(renderConnectionBadge());
  block.appendChild(info);
  // ── R11-3：行动区**只**挂在自己那一侧，且**只**在自己是行动方时 ──
  // 两处调用（每侧一块）里最多一处命中 ⇒ "对手那一侧一个按钮都没有"是**构造性**的。
  // ⚠️ 判据用 `player === s.turnPlayer`（**绝对玩家号对绝对玩家号**），不是 `isTurn(s, viewSeat)`
  //    —— 两份信息块由同一个函数产出，只有各自的 `player` 不同。
  if (isSelf && player === s.turnPlayer) block.appendChild(renderNetActionBar(s, cb));
  return block;
}

/**
 * 一块**手牌区**（`.net-hands` 的一个子项）：手牌 + 对手那一行的"张数"小标签。
 *
 * 创建顺序恒为 **P0 先、P1 后**（`buildP0Hand` / `buildP1Hand` 的字面量调用顺序，约束 7 的代理证据）；
 * 视觉上谁在上/下由 `.net-hand-area-{foe,self}` 的 **CSS `grid-row`** 决定
 * （R8-5 之前是 `.net-hands` 的 `order`；styles-net.css 第 6 节）。
 *
 * ⚠️ **R6 之后这里不再有信息条与牌库/弃牌堆**（它们搬到 `.net-info-block` 里了）。
 * 两块手牌区**对称**（都只包一层 `.net-hand-area`）—— R6 之前自己那块不对称地多带信息条与操作区，
 * 那种不对称正是"信息条只能挂在手牌行里"这个旧布局假设的残留。
 */
function decorateHand(s: GameState, player: PlayerId, hand: HTMLElement, o: NetHandOpts): HTMLElement {
  const area = el('div', 'net-hand-area' + (o.isSelf ? ' net-hand-area-self' : ' net-hand-area-foe'));
  area.dataset.player = String(player);
  if (!o.isSelf) {
    // 对手手牌只剩数量占位：补一行小标签说明"这块是什么"（信息条在底部行的信息块里，见上）
    area.appendChild(el('div', 'net-hand-label', `对手手牌 ×${s.players[player].hand.length}`));
  }
  area.appendChild(hand);
  return area;
}

/** `renderHand` 的入参（两个玩家只有 `isSelf` 不同，其余共用；**可见性按 `isSelf` 决定**：
 *  自己 = `'all'`（真实卡、可点），对手 = `NET_HAND_VIS`（数量占位）。见 `NET_HAND_VIS` 的警告）。 */
interface NetHandOpts {
  isSelf: boolean;
  /** 该玩家是否正在等待操作（效果挂起）→ 信息块的 operator 高亮 */
  operator: boolean;
  cb: UiCallbacks;
}

/**
 * P0 的手牌区。**必须**保持这个形状（`renderHand(s, 0, {…})` 的字面量调用）：
 * 约束 7 的源码代理断言钉的就是「`renderHand(s, 0 …` 出现在 `renderHand(s, 1 …` 之前」。
 */
function buildP0Hand(s: GameState, viewSeat: PlayerId, cb: UiCallbacks, operator: boolean): HTMLElement {
  const { uid } = getHandSelection();
  const isSelf = viewSeat === 0;
  const hand = renderHand(s, 0, {
    isSelf,
    selected: isTurn(s, 0) ? uid : null,
    // 与热座页同语义：选中新卡时把朝向重置为正面（避免继承上一张的翻面状态）
    onSelect: (nextUid) => { setHandSelection(nextUid, true); cb.rerender?.(); },
    onToggleFaceUp: () => { setHandSelection(getHandSelection().uid, !getHandSelection().faceUp); cb.rerender?.(); },
    cb,
    // 甲读法下**双方手牌都左起**：上下带由 CSS 决定，"左右"与座位无关
    reversed: false,
    // 对手手牌只剩数量占位（§6.4）；但仍产出 .hand[data-player] 节点。
    // ⚠️ **自己一侧必须传 `'all'`**：`'count'` 是无条件提前返回（与 isSelf 无关），给自己传会连自己的手牌
    //    也变成占位 → 没有 .card、打不出牌（C-2）。不要把它简化成常量。
    handVisibility: isSelf ? 'all' : NET_HAND_VIS,
    // 设计稿 §6.1 已删挡板
    shield: false,
  });
  return decorateHand(s, 0, hand, { isSelf, operator, cb });
}

/**
 * P1 的手牌区。**必须**在 `buildP0Hand` **之后**调用（DOM 顺序 = 绝对玩家顺序，约束 7）。
 */
function buildP1Hand(s: GameState, viewSeat: PlayerId, cb: UiCallbacks, operator: boolean): HTMLElement {
  const { uid } = getHandSelection();
  const isSelf = viewSeat === 1;
  const hand = renderHand(s, 1, {
    isSelf,
    selected: isTurn(s, 1) ? uid : null,
    onSelect: (nextUid) => { setHandSelection(nextUid, true); cb.rerender?.(); },
    onToggleFaceUp: () => { setHandSelection(getHandSelection().uid, !getHandSelection().faceUp); cb.rerender?.(); },
    cb,
    reversed: false,
    // 同上：自己一侧 `'all'`，对手一侧数量占位（C-2 的守卫会钉住这两处）
    handVisibility: isSelf ? 'all' : NET_HAND_VIS,
    shield: false,
  });
  return decorateHand(s, 1, hand, { isSelf, operator, cb });
}

/**
 * 手牌区容器：**两条 `.hand` 按绝对玩家顺序**（P0 在前、P1 在后）放进同一个父容器。
 *
 * ⚠️ 这是本页最容易静默出错的地方（约束 7）：FX 用 `querySelectorAll('.hand')[player]`
 * **按下标**读手牌（effects/index.ts:849/942/1541/1590/1650、:1703 一次取两手；
 * fx-gen2.ts:693/1316/1786）。甲读法把对手放在**上带** —— 若按视觉顺序挂载，
 * `viewSeat = 0`（对手 = P1）就会得到 `[P1, P0]`，下标 0 取到**对手**的手牌，
 * 特效把卡飞到对手手牌区，**不报错也不跳过**（比 `undefined` 更难发现 —— 后者至少会被守卫吞掉）。
 * 所以：DOM 顺序**恒定** [P0, P1]，视觉上谁在上带由 `.net-hand-area-{foe,self}` 的
 * **CSS `grid-row`** 决定（R8-5；改之前是父容器的 `.net-view-N` + `order`，见 styles-net.css
 * 第 6 节）。**不得**用 `display:none` 换位：
 * 隐藏节点 `getBoundingClientRect()` 全 0，FX 落点会塌。
 *
 * 两个 appendChild **写成两行字面量**（不用 `for (const p of [0,1])`）是**有意**的：
 * 顺序语义是承重的，循环会把「DOM 顺序 = 绝对玩家顺序」这件事藏进一个不可见的迭代里，
 * 也让源码守卫只能退化成"检查某个循环存在"。
 */
function buildHands(
  s: GameState, viewSeat: PlayerId, cb: UiCallbacks, operator: PlayerId | null,
): HTMLElement {
  const hands = el('div', 'hand-strip net-hands net-view-' + viewSeat);
  hands.dataset.viewSeat = String(viewSeat);
  // P0 的手牌**先**建；P1 的手牌**后**建 → querySelectorAll('.hand') 恒为 [P0, P1]
  hands.appendChild(buildP0Hand(s, viewSeat, cb, operator === 0));
  hands.appendChild(buildP1Hand(s, viewSeat, cb, operator === 1));
  return hands;
}

/**
 * **停靠栏容器**（R6 的"底部行"；**R11-2 起它是钉在视口底部的那一行**）：
 * `[信息块, 手牌区, 信息块]` —— 三块的**DOM 顺序**由 `NET_BOTTOM_SIDES` 的单元素切片决定。
 *
 * ⚠️ **R8-5 起它不再是"一行三列"的盒子**：`styles-net.css` 第 6 节把 `.net-bottom` 设成
 * `display: contents`（盒子消失，子节点成为 `.net-board` 的 grid item），行/列号由第 1 节的
 * R11-2/3 块**按侧**指派。所以这里**没有任何左右语义** —— 这个函数只负责"谁进 DOM、以什么顺序进"。
 *
 * ⚠️ **返回值从 `HTMLElement` 改成 `{ row, hands }`（G2 修正 R11-4）**：`renderChoiceUi` 需要
 * `.net-hands` 这个节点（它给**手牌条**加 `.choice-mode`，那是"选择模式下非候选手牌不可点"的
 * 唯一出处）。旧写法是 `bottom.lastElementChild`，而它的注释写着"手牌区恒是最后一个子节点
 * （两块信息块 → 手牌区）"—— **那个顺序是反的**：`NET_BOTTOM_SIDES` 是 `['self', 'foe']`，
 * 所以 DOM 顺序是 `[自己信息块, 手牌区, 对手信息块]` ⇒ `lastElementChild` 拿到的是**对手信息块**
 * ⇒ `.choice-mode` 一直加在错误节点上（`.net-hands.choice-mode …` 与
 * `styles.css:1786` 的 `.hand-strip.choice-mode …` 两条规则**都失效**）。行为层的后果是
 * "候选外的**手牌**在选择模式下仍可点选"（拖拽打牌另有 promptId 闸门挡着，所以没有规则级后果，
 * 这正是它长期没被发现的原因）。现在把节点**从构建点直接交出去**，不再靠位置猜。
 * `tests/ui/net-dock.test.ts` 的 G-15 是它的行为腿。
 */
function buildBottomRow(
  s: GameState, viewSeat: PlayerId, cb: UiCallbacks, operator: PlayerId | null,
): { row: HTMLElement; hands: HTMLElement } {
  const row = el('div', 'net-bottom');
  row.dataset.viewSeat = String(viewSeat);
  const blockOf = (side: NetBottomSide): HTMLElement =>
    renderInfoBlock(s, bottomPlayerOf(side, viewSeat), side, operator, cb);
  for (const side of NET_BOTTOM_SIDES.slice(0, 1)) row.appendChild(blockOf(side));
  // 手牌区恒在中间（DOM 位置固定；视觉左右是信息块的事，见本函数的头注）
  const hands = buildHands(s, viewSeat, cb, operator);
  row.appendChild(hands);
  for (const side of NET_BOTTOM_SIDES.slice(1)) row.appendChild(blockOf(side));
  return { row, hands };
}

/* ============================================================================
 * 预览工具条（仅 `opts.onPreviewChange` 存在时渲染）
 *
 * 为什么必须有（别当成装饰）：用户验收第 3 项要做「≥20 个点名特效抽查」，而那必须能真的把牌
 * 打出去 —— 但对手手牌只剩数量占位（信息遮蔽），轮到对手就无人可操作、预览会卡死。
 * 预览会卡死。**推进对手回合的正确做法是切「视角」开关**：切过去后对手就是 self（手牌正面 +
 * 可点 + 可打牌），本页两态都会正确渲染布局与朝向。`viewSeat` 固定为 0 又无法检查
 * 「我是 P2 时」的上下带与 180° 是否也对。
 *
 * ⚠️ **G2 Task 4F（终审 I-2）：这里曾经有第二个开关「对手手牌：全部可见 ⇄ 只显示数量」，
 * 已删除。** 实测它只等于"去掉数量占位、改画最多 15 张**卡背**、仍不可点"
 * （`render.ts:1633` 的 `faceUp` 与 `:1651-1677` 的点击绑定都以 `isSelf` 为条件，
 * `styles-net.css:210` 又对非 self 手牌 `pointer-events:none`）—— 一个既不"可见"也不"可操作"
 * 的开关比没有更误导。不要为它给 `renderHand` 加 `asSelf` 参数（共享助手，超出 G2 范围）。
 * **真实联机时不传 `onPreviewChange` → 这条工具条完全不渲染。**
 * ========================================================================== */

/**
 * 本地预览时的**操作提示**（G2 修正 **R11-3** 的可见代价说明）。
 *
 * R11-3 之后"按钮只在轮到自己时出现在自己这一侧"，于是**轮到对手**的那一帧页面上**一个按钮都没有**
 * （这是用户要的形态，也是真联机下唯一正确的形态）。但本地预览是**单人**在看这一屏 ——
 * 没有这句话，用户会以为"页面卡住了、按钮丢了"。
 * ⇒ 明说"切「视角」后即可操作"（切过去后对手就是 self，按钮随之出现）。
 * 真实联机不传 `onPreviewChange` ⇒ 这条工具条**整个不渲染** ⇒ 这条提示也不存在（不会污染真机）。
 */
function previewActingHint(s: GameState, operator: PlayerId | null, viewSeat: PlayerId): string {
  if (operator !== null && operator !== viewSeat) {
    return `轮到对手（P${operator + 1}）应答 —— 本页只显示信息、不显示按钮；切「视角」后可操作`;
  }
  if (s.turnPlayer !== viewSeat) {
    return `轮到对手（P${s.turnPlayer + 1}）行动 —— 本页只显示信息、不显示按钮；切「视角」后可操作`;
  }
  return '';
}

function renderPreviewToolbar(
  opts: NetViewOpts,
  onChange: (next: { viewSeat?: 0 | 1 }) => void,
  hint: string,
): HTMLElement {
  const bar = el('div', 'net-preview-bar');
  bar.appendChild(el('span', 'net-preview-title', '预览工具条'));
  const seatBtn = el('button', 'btn net-preview-btn',
    opts.viewSeat === 0 ? '视角：我 = P1 ⇄ P2' : '视角：我 = P2 ⇄ P1');
  seatBtn.title = '切换到对方视角：切过去后"自己"就是对手（手牌正面且可点），'
    + '这是推进对手回合、把一局打完的正确做法（对手手牌只手牌数量那一档是不可点的）。';
  seatBtn.addEventListener('click', () => onChange({ viewSeat: opts.viewSeat === 0 ? 1 : 0 }));
  bar.appendChild(seatBtn);
  // R11-3 的操作提示（轮到对手时为空串 ⇒ 由 CSS 的 `:empty` 收掉）
  bar.appendChild(el('span', 'net-preview-act-hint', hint));
  bar.appendChild(el('span', 'net-preview-note', netPreviewNote));
  // 运行时自查的**结果行**（`opts.verifyHooks` 时由 verifyPageHooks 写入）。
  // 为什么放在工具条上而不是只 console：这两条断言（.hand 的 DOM 顺序、对手卡的 .rot-180）
  // 是约束 7 / 硬约束 2 唯一的真凭据，用户一进预览页就该**直接看到**它过没过，
  // 而不是被要求去开控制台。
  bar.appendChild(el('span', 'net-verify-note', ''));
  return bar;
}

/* ============================================================================
 * 入口
 * ========================================================================== */

/**
 * 渲染远程对战页（甲读法 + 座位相对 + 单视角）。
 *
 * `opts` 每次渲染都是权威来源：座位、手牌可见性都**只**从这里读，不保留任何"上次的视角"，
 * 因此不存在"内部状态与 opts 不一致"这一类 bug（预览工具条切换后由 `main.ts` 重新传入）。
 *
 * **入口约定（F-1）**：与 `render.ts` 的 `renderDraft`（`:4472`）/ `renderBoard`（`:4637`）与
 * `home.ts:65` 一致 —— 渲染器**自己清空 root 再重建**。少了第一行的 `root.textContent = ''`
 * 会（a）从热座/草稿切进远程预览时把新棋盘**叠在旧那一屏下面**，（b）之后每次 `cb.rerender?.()`
 * 都**线性叠加**一份，而 FX 全走 `querySelector`（取第一个）→ 特效全部打在旧副本上。
 * 复评实测：Task 4 的单行 `rerender()` dispatch 不做清理，所以这里必须自己清。
 */
export function renderNetBoard(root: HTMLElement, s: GameState, cb: UiCallbacks, opts: NetViewOpts): void {
  // ── 入口职责 1/7：拖拽安全网（与 renderApp 第一行同义）——
  //    重渲染若发生在拖拽中，先清理幽灵卡与高亮，否则本页会残留一块跟手的幽灵卡。
  cancelActiveDrag();
  // ── 入口职责 2/7：清 body 级草稿展示框（与 renderApp 同）——
  //    草稿页把两块 `.draft-preview` 挂在 **document.body** 上（render.ts:4585-4586），
  //    本页清 root **清不掉**它们；漏调则 `fixed; z-index:400` 的两块面板残留整局、
  //    压住底部两角并**拦截点击**（终审 I-1）。net 分支只在 `phase !== 'draft'` 时可达，
  //    与 `renderApp` 的 `if (s.phase !== 'draft')` 条件等价，故这里无条件调用。
  removeDraftPreviews();
  // ── 入口职责 3/7：本渲染器自己清空并重建 root（F-1：少了它会逐帧线性叠加） ──
  root.textContent = '';
  // ── 入口职责 3b/7（G2 修正 **R8-4b**）：**本帧**持久 FX 收集器复位 ──
  // `compiledFxCells` 是 `renderProtocol` 逐格登记、`syncCompiledFxLayers` 遍历的每帧收集器。
  // 热座页在 `renderBoard` 开头复位（`resetCompiledFxCells()`）；本页此前**没有** ⇒ 每帧向数组
  // **追加**一批新 holder ⇒ 表随重渲染线性增长、`syncCompiledFxLayers` 每帧多遍历 N 条历史记录。
  // ⚠️ 准确说：陈旧 holder 是 detached ⇒ `isConnected` 早退、**不会**写几何（所以不是"画面写回旧坐标"），
  //    但它是**泄漏**，而且让"每帧同步的到底是谁"变成随使用时长增长的模糊量 —— 与 R8-4b 修的
  //    "net 页根本没有每帧同步"叠在一起时，缺陷极难分离。
  resetCompiledFxCells();
  // ── R11-2 的配套（**一次性**绑定，见 `bindNetScrollSync`）──
  // 链路区现在是**视口内的滚动区**，而 `.compiled-fx` / 锁链层是 body 级固定层 ⇒
  // 滚动不重渲染 ⇒ 必须自己跟着重定位（否则协议特效会停在旧屏幕坐标上）。
  bindNetScrollSync();
  const viewSeat = opts.viewSeat;
  // （`foe` 的换算原来在这里，供顶部对手条用；R6 取消顶部条后它已无用 —— 对手侧现在由
  //   `renderLaneColumn` 与 `bottomPlayerOf` 各自按座位换算。删掉局部变量以免"看起来还在用"。）
  // ── G2 修正 R3：把**当前视角座位**交给 FX 层（**唯一调用点**，幂等）──
  // 必须在任何几何计算 / 任何 FX 播放之前设好：它决定 `stackEndPos` 的落点轴、`gen3-util` 的
  // 覆盖条带方向、以及 `fx-seat.ts` 里全部"自己在下 / 对手在上"的判断。
  // ⚠️ **热座页（`render.ts` 的 `renderApp`/`renderBoard`）从不调用它** ⇒ 那份模块态恒为 `null`
  // ⇒ 所有方向判断走与改动前**逐字相同**的左右分支 ⇒ "热座零变化"是**构造性**的，不依赖
  // "我记得把每一处都改对"。规格 §8.1：不为运行时反复切换造任何机制 —— 这里只"设一次"。
  // `applyFxViewSeat` 把**写进去的值**交回来：`verifyPageHooks` 的断言 4 读它（见该函数注释 ——
  // 它是一条**契约链**检查，不是几何检查）。
  const seatApplied = applyFxViewSeat(opts.viewSeat);
  // ── G2 修正 **R15-2**：页面级标记 `body.net-page`（`NET_PAGE_CLASS` 的注释有完整理由）──
  // 位置与上面那句同一个"每帧设一次"的页面级开关点：**在构建 wrap 之前**设好，
  // 于是本帧第一次样式解算时 `body.net-page …` 的规则已经命中（不留"第一帧没光"的闪烁）。
  // 摘除在 `resetNetUiState()`（离开远程页的复位点）——加与摘成对，不靠"下次进远程页覆盖"。
  // ⚠️ 与同文件其它 DOM 访问同款防御（无 document / 无 body / 桩没有 classList 时静默跳过）。
  (globalThis as { document?: { body?: { classList?: { add(c: string): void } } } })
    .document?.body?.classList?.add(NET_PAGE_CLASS);
  // 几何型 FX 延迟器（M-3）：与热座 renderBoard:4641 同形的队列。
  // renderChoiceUi 在构建期收集（透彻牌库眼睛 / 幸运宣告骰子），在 `root.appendChild(wrap)`
  // **之后**统一执行 —— 此前棋盘节点尚未入 DOM，`getBoundingClientRect()` 全 0，
  // 依赖矩形定位的特效会**静默失败**（热座页历史上正是这样完全不显示）。
  const deferredFx: Array<() => void> = [];

  // ── 入口职责 4/7：重渲染动画抑制（与 renderApp 同） ──
  root.classList.add('no-anim');

  // 胜利结算横幅（G2 Task 4F · 终审 C-1）：**与 renderBoard:4649-4652 同形同条件**。
  // 漏了这一段，预览页打完一局就**无法退出**（只能刷新浏览器），用户验收 A9/D2/F14 按字面无法执行，
  // 且"返回主界面"那条重置路径（含 Task 4 的三道防泄漏堵点）永远不可达。
  if (s.phase === 'gameover' && s.winner !== null) showWinOverlay(s.winner, cb);

  // 清除失效选择（**单一实现**，与盘本体同一调用；两页共用一份选择态）
  pruneSelection(s);
  const topEffect = s.pendingEffects[s.pendingEffects.length - 1];
  const operator: PlayerId | null = topEffect?.prompt
    ? (topEffect.prompt.chooser ?? topEffect.player)
    : null;

  const wrap = el('div', 'board net-board net-view-' + viewSeat);
  const grid = el('div', 'board-grid net-grid');

  // ── 3 个纵向的列（每个列 = 对手侧 / 中线 / 自己侧，见 renderLaneColumn 的六层顺序） ──
  // ⚠️ R6：**顶部信息条已取消**（用户裁决：双方信息条与手牌区同一行、一左一右）。
  //    对手的信息条与牌库/弃牌堆现在在底部行的那一块里（`buildBottomRow` → `renderInfoBlock`）。
  for (const line of [0, 1, 2] as Line[]) {
    grid.appendChild(renderLaneColumn(s, line, viewSeat, cb));
  }

  // ── 控制轨（**竖向**：自己端在下 / 对手端在上 —— G2 修正 R3 的用户裁决） ──
  // 三个参数的含义见 `netControlEnd` 与 `renderControlModule` 的注释（轴向 / 归属=绝对号 / 位置端）；
  // 视觉规则在 styles-net.css 第 9 节（styles.css 一行未改）。
  // ⚠️ R16：`holder` 与 `end` **必须分开传**（旧写法把"端"当"绝对号"用 ⇒ 滑块与 FX 落点差 56%）。
  // 热座页只传 `holder`（不传 `end`）⇒ `end` 缺省 = `holder` ⇒ 热座逐位不变。
  // ⚠️ 这里**直接**在挂载点调用共享助手（不套一层 `renderNetControlModule(...)` 包装）：
  //    本文件的守卫判据是 `appendChild(<助手调用>` / `= <助手调用>` 的**文本形态**，套包装会让
  //    "结果真的进了 DOM"这条证据从源码里消失（我第一版就是套了包装 → 守卫报"结果被丢掉"）。
  grid.appendChild(renderControlModule(s, {
    axis: 'y',
    holder: s.control,
    end: netControlEnd(s, viewSeat),
  }));

  // ── 停靠栏（R6；**R11-2：它就是钉在视口底部的那一行**）：信息块 · 手牌区 · 信息块 ──
  // 手牌区仍由 `buildHands` 产出，且**两条 `.hand` 的 DOM 顺序恒为绝对玩家顺序 [P0, P1]**（约束 7）；
  //    `hands` 变量要交给 `renderChoiceUi`（给手牌条加 `.choice-mode`），故由 `buildBottomRow`
  //    **直接交出来**（R11-4：旧写法 `bottom.lastElementChild` 拿到的是**对手信息块** —— 见该函数头注）。
  const { row: bottom, hands } = buildBottomRow(s, viewSeat, cb, operator);

  // ⚠️ C-1：grid **必须先挂进 wrap**，选择模式才能找到候选节点 —— `renderChoiceUi` 内部
  // 三处 `wrap.querySelectorAll(...)` 都只对"已经挂在 wrap 下的节点"生效：
  //   · select 分支：`.card[data-uid]`（场上卡在 grid 里、手牌卡在 bottom 里 —— R7 之后
  //     bottom 是 grid 的**兄弟**，两者都在 wrap 下，故查 wrap 仍能同时命中）
  //   · select-line 分支：`.net-lane-band`（`data-line` 写在带节点上）
  // 曾经这一行在 `renderChoiceUi` **之后**：select-line 拿到 0 条带 → 没有可点目标，
  // 而 `choiceBar` 对 select-line 没有确认按钮 → 非 optional 的 select-line 永久卡死。
  // 与热座页同序（renderBoard:4800 挂 grid → :4835 跑 choice 分支）。
  wrap.appendChild(grid);

  // ── R7 修正：底部容器是 `.net-grid` 的**兄弟**（挂 `wrap` = `.net-board`），**不是**它的子节点 ──
  // 为什么这是承重的（用户实机截图确认的容器层级崩塌）：`bottom` 曾经 `grid.appendChild(bottom)`，
  // 于是 `.net-grid` 有了**5 个**子节点，而样式表只给了 **3 条显式轨道** ⇒ 第 4、5 个子节点成为
  // **隐式列**，整页塌成"一行五格、下方大片空白、右侧多出滚动条"。
  // 现在的层级（styles-net.css 第 1 节是它的样式腿，`tests/ui/net-lane-tree.test.ts` 的 R7 条是行为腿）：
  //   .net-board（**grid**，R8-5）
  //     ├─ .net-grid（4 条显式轨道：3 条线 + 控制轨）      → 五行里的第 3 行
  //     ├─ .net-bottom（display: contents；信息块 · 手牌区 · 信息块）
  //     │    ⇒ 子节点直接成为本容器的 grid item：第 1/2/4/5 行由 CSS `grid-row` 按侧指派
  //     └─ .log / .diag-btn / .net-preview-bar（第 6 行起，自动放置）
  // ⚠️ 挂载顺序：[grid, bottom, …] —— 底部容器必须在 grid **之后**（R7 的层级约束；视觉行号由
  //    CSS `grid-row` 决定，与 DOM 顺序无关，但层级崩塌那条红线仍然按 DOM 判）。
  // ⚠️ 必须在 `renderChoiceUi` **之前**：选择模式要按 `wrap.querySelectorAll` 找**已入 DOM** 的
  //    候选卡，而自己的手牌卡就在 `bottom` 里（理由与上面 C-1 的 grid 完全相同）。
  wrap.appendChild(bottom);

  // ── 选择模式（三个 choice-* 分支，重写为回到当前页） ──
  // `viewSeat` 是 R11-3 的闸门输入（选择条只在"操作方就是自己"时才挂出来）。
  renderChoiceUi(wrap, hands, root, s, cb, deferredFx, viewSeat);

  // ── 导出日志按钮（与热座页同款；不占 FX 契约位） ──
  // ⚠️ **R12-1：事件日志那一块（`.log`）不再渲染**（用户第五次验收："取消日志的显示"）——
  //    它的 72px 全部还给放牌区（R12-4），而"看日志"的需求由这个按钮承担（`downloadLog(s)`
  //    导出的诊断文本里本来就含**完整**事件日志，比屏幕上那 60 行更全）。
  // ⚠️ 这个按钮在 `styles.css` 里是 `position: fixed; right: 16px; bottom: 18px`（**照旧**）——
  //    它因此落在 `#app` 的 110px 底部内边距里、**不占**本页任何行；旧代码给它写的
  //    `grid-row: 2` 是**死声明**（fixed 元素不参与 grid 布局），R12-1 已删除以免误导。
  const diagBtn = el('button', 'btn diag-btn', '导出日志');
  diagBtn.title = '导出诊断日志（错误 + 控制台记录 + 事件日志 + 状态快照）';
  diagBtn.addEventListener('click', () => downloadLog(s));
  wrap.appendChild(diagBtn);

  // ── 预览工具条：**只在有 onPreviewChange 时**渲染（真实联机不传 → 完全不存在） ──
  // I-2 之后只有一个开关（视角）；因此这里的反馈文本也只有一种。
  if (opts.onPreviewChange) {
    const onChange = opts.onPreviewChange;
    wrap.appendChild(renderPreviewToolbar(opts, (next) => {
      netPreviewNote = `已切视角：我 = P${(next.viewSeat ?? opts.viewSeat) + 1}`;
      onChange(next);
    }, previewActingHint(s, operator, viewSeat)));
  }

  root.appendChild(wrap);

  // ── G2 修正 **R12-5**：把链路滚动区的**默认位置**定在"双方协议的交锋点"（中线）──
  // 用户第五次验收原话："将默认的位置定为双方协议的交锋点，而不是对方链路的顶部"。
  // ⚠️ **必须在 `deferredFx` 之前**：那批几何型 FX（透彻牌库眼睛 / 幸运宣告骰子）按
  //    `getBoundingClientRect()` 定位，先滚再量才落得准。
  // ⚠️ **跨重渲染保持**：`.net-grid` 每帧重建 ⇒ 它的 `scrollTop` 天然归 0。
  //    若每帧都"回到中线"，玩家一放牌就被拽回中间（比不滚更烦人）；所以只在**没有记录**时
  //    才用中线做默认值，之后按记录恢复（记录由 `bindNetScrollSync` 的滚动回调更新）。
  restoreLaneScroll(grid);

  // 棋盘已入 DOM → 执行本帧收集的几何型 FX（矩形定位有效；透彻牌库眼睛 / 幸运宣告骰子）
  for (const fn of deferredFx) fn();

  // ── G2 修正 **R8-4b**：本页**必须自己**同步已编译协议的持久 FX 层（挂在 body 的 `.compiled-fx`）──
  // **为什么 net 页必须自己同步**：热座页有 `renderBoard` **末尾**那次 `syncCompiledFxLayers()`
  // （每帧都按 holder 矩形重新对齐），而本页此前**只有 `renderProtocol` 里 `img.load` 的那一次回调**
  // ⇒ 编译之后**任何会移动协议位置的重渲染**（选择条/浮层出现把底部行撑高、链路放牌变长、
  // R8-5 的五行网格…）都会让环/角光**停在旧坐标上飘走** —— 这正是用户第 4 条反馈
  // "所有协议的特效都没有跟随"在本页的第二个成因（第一个是 R8-4 的角度）。
  // **位置（两条都是承重的）**：
  //  ① 在 `root.appendChild(wrap)` **之后** —— 树构建期节点 detached，`getBoundingClientRect()`
  //     全 0，`positionCompiledFxLayer` 会（正确地）早退，量了等于没量；
  //  ② 在 `renderChoiceUi(...)` **之后**（它在 `root.appendChild(wrap)` 之前就构建完选择条/浮层，
  //     挂载后才会改变布局）—— 与本行的 `deferredFx` 同一个"最后量"的时刻。
  // 幂等且廉价（≤6 层 + 只读矩形）；`compiledFxCells` 已在本帧入口复位 ⇒ 遍历次数恒 = 本帧协议数。
  syncCompiledFxLayers();

  // —— 入口第 2、3 件副作用（与 renderApp:5591/5593 同） ——
  syncCheckCacheChains(s);
  syncChainLayerPosition();
  // ── G2 修正 **R13-4**（独立审计 A4）：**常驻层同步函数必须与热座页对齐** ──
  // 背景：这些 `sync*` 是"**每一帧**按 A 类钩子（槽位 / 电池 / 手牌 / 卡）的实测矩形把 body 级
  // 持久层重新对齐，并在条件消失时移除"的函数 —— 热座页 `renderBoard` **末尾**有整整一批
  // （`render.ts` 的 5233-5279），而本页此前**只有** `syncCompiledFxLayers` / `syncCheckCacheChains`
  // / `syncChainLayerPosition` 三条 ⇒ **19 类常驻特效在远程页里 100% 不出现**：
  // 暗2 黑烟 / 能量扫描线 / 念能粒子 / 瘟疫浓雾 / 冷漠灰雾与马赛克 / 灵魂0 手牌区光 /
  // 灵魂1 护角 / 金属0·1·2·6 / 镜像0 电池光 / 透彻0 电池光 / 冰霜 / 迷雾2 三链光 /
  // 恐惧0 三链光 / 战争刀刃 / 多元颜色与多元3 / 嫉妒0·暴怒0·怠惰0·惰性0·1·僵化7·色欲·贪婪1。
  // 它们**全部**是"按选择器找节点 + 幂等写矩形"的实现（选择器已随 R1/R3 迁移到自描述的
  // `.battery[data-player][data-line]` 等），所以本页只需要**原样调用**，不需要任何适配。
  // ⚠️ 顺序与热座页**逐字同序**（`tests/ui/net-preview-wiring.test.ts` 有一条清单对齐守卫：
  //    它从 `renderBoard` 的尾部**生成**要求，漏一个函数就红 —— 手写清单必然漏项，这是 G2 的旧教训）。
  syncSmokeOverlays(s);
  syncScanOverlays(s);
  syncPsychicParticles(s);
  syncPlagueMists(s);
  syncApathyMists(s);
  syncApathyMosaics(s);
  syncSpirit0Glows(s);
  syncSpirit1Cards(s);
  syncMetal0Glows(s);
  syncMetalPlates(s);
  syncMetal6Mans(s);
  syncMetal1LineGlows(s);
  syncMirror0BatteryGlows(s);
  syncClarity0BatteryGlows(s);
  syncIceFx(s);
  syncSmoke2LineGlows(s);
  syncFear0TriGlows(s);
  syncWarBlades(s);
  syncDiversityColors(s);
  syncDiversity3Fx(s);
  syncGen3Persistent(s);
  syncFollowers();
  // —— 入口第 4 件副作用 ——
  cb.onRendered?.();
  // —— 双 rAF 后移除 no-anim（与 renderApp:5595-5599 同） ——
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      root.classList.remove('no-anim');
    });
  });

  // —— 诊断（可选）：把"21 条钩子真的在 DOM 里"这件事变成可执行的证据 ——
  // 两道防线：`verifyPageHooks` 内部逐条 try/catch；这里再包一层，保证**任何**未预料的异常
  // 都不会从 `renderNetBoard` 逃逸到宿主（"诊断不得把渲染搞崩"）。C-2 的原始缺陷正是
  // 一个非法选择器抛 `SyntaxError` 直接冲垮整页渲染。
  if (opts.verifyHooks) {
    let note: string;
    try {
      // R11-3：把这一帧的**行动方 / 操作方**交给自查 —— 约束 11 的正向那半边（"自己那侧有按钮
      // ⇒ 自己就是行动方"）需要它；只查"对手那侧零控件"那半边时它是可选的。
      note = verifyPageHooks(wrap, seatApplied, { turnPlayer: s.turnPlayer, operator });
    } catch (err) {
      note = `自查 ✗ 自查本身抛异常：${String(err)}`;
      console.warn('[render-net] 运行时自查抛异常（已吞掉，不影响渲染）：', err);
    }
    const noteEl = wrap.querySelector<HTMLElement>('.net-verify-note');
    if (noteEl) noteEl.textContent = note;
    else console.info('[render-net] ' + note + '（无预览工具条，故只在此处报告）');
  }
}
