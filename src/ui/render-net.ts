/**
 * 远程对战页渲染器（G2 Task 3）—— 「甲读法 + 座位相对 + 单视角预览」。
 * 设计依据：docs/2026-09-13-联机与多端-设计稿.md §6；施工依据：.superpowers/sdd/task-G2T3-brief.md。
 *
 * ## 布局（甲读法，用户已拍板）
 * 3 条横带；**每条带内 上 = 对手 / 下 = 自己**；**自己的卡正立 0°、对手的卡 180° 倒置**（像隔桌对坐）。
 * 顶部对手信息条（昵称/座位 · 手牌 ×n · 牌库 · 弃牌 · 连接状态）→ 3 条线 → 控制轨 → 自己信息条 + 手牌。
 *
 * ## 为什么**不**复用 render.ts 的盘本体（设计稿 §6.1）
 * 热座页的盘是「左右分栏」（P1 槽 | P1 协议 | P2 协议 | P2 槽，见 styles.css:57），两位玩家坐在
 * **同一块屏幕前**、各自看自己那半边的 ±90° 旋转；远程页是「上下分带」，双方隔桌对坐。
 * 两者的 DOM 骨架与朝向语义都不同，硬套会把热座页的布局假设带进来。**本体另写**，
 * 但**全部叶子助手原样复用**（卡片 / 协议 / 电池 / 牌库 / 弃牌 / 信息条 / 控制轨 / 选择条 /
 * 选择浮层 / 拖拽 / 手牌区 / 选择态）。
 *
 * ## 七条硬约束（违反 → 静默退化；逐条对应本文件的实现）
 * 1. **20 条 A 类钩子全部产出，且产出方拼写与热座页一致** —— 靠复用 render.ts 的叶子助手保证
 *    （`.stack-slot p${player + 1}` / `trash-pile p${player + 1}` 都在助手内，`data-player` /
 *    `data-line` 走 `dataset`）。`.pN` 拼写是**承重的**，不要改成复合类名（计划附录 A.4-2）。
 *    **本页的产出证据是「助手调用链」，不是本文件的 token**：拼写由 `render.ts` 的钩子产出表达式
 *    负责（`tests/ui/fx-dom-contract.test.ts` 会对它逐条查），本页只负责**把这些助手挂进链路**。
 *    下方 `NET_PAGE_HOOKS` 是**人读 + 防漂移的契约镜像**（`call` 一列逐条对应真实调用，
 *    且任一 token 扫描前都会先 `stripArrayDecl` 剔除表体）—— **表本身不是证据**
 *    （G2 Task 3 的教训：物化进本文件的 hook 字符串会让"必须提供"断言自我满足）。
 * 2. **`.rot-cw` / `.rot-ccw` 一律不产出** —— 本文件里连带引号的字面量都不出现
 *    （`tests/ui/fx-orient.test.ts` 会对每个**已登记的非热座渲染器**逐个扫）。
 *    朝向只有 0°（自己）与 180°（对手）：本页把 `orient: isSelfSeat ? 0 : 180` **作为实参**交给
 *    `renderStackSlot` / `renderProtocolCell`，类名映射只有一处 —— `render.ts` 的分支链
 *    （`:252-254` 的 ±90°/180° 与 `:130` 的协议图），**不在本文件重复映射**。
 * 3. **「P0 向左长 / P1 向右长」按绝对玩家** —— 由 `renderStackSlot` 内部按 `player` 决定的
 *    `.stack.grow-left` / `.grow-right` 与渲染顺序保证；控制轨 slider 也仍按绝对玩家映射（4%/96%）。
 *    **不得**改成「上 = 向左」：effects/index.ts:191-193、fx-gen2.ts:779/878/957、gen3-control.ts:654
 *    都按绝对玩家算方向，改了会静默错位。
 * 4. **within-slot 覆盖方向不变** —— `gen3-util.ts:51/66` 假设覆盖者在右；本文件不碰覆盖方向
 *    （仍由 `renderStackSlot` + `.stack .card + .card` 的负 margin 决定）。
 *    ⚠️ 推论：对手那一行**不得**整块 `rotate(180deg)` —— 行级 180° 会把该行**水平镜像**
 *    （屏幕左右翻转，"覆盖者在右"随之失真），且与卡自身的 `.rot-180` 叠加成 0°（卡其实正立）。
 *    所以对手侧只由**卡/协议自身**的 `.rot-180` 倒置（styles-net.css 第 3 节的说明）。
 * 5. **对手手牌只渲染数量，但 `.hand[data-player]` 占位节点必须产出**（带 `data-hand-count`）——
 *    否则 `querySelectorAll('.hand')[player]` 会取到 `undefined`。FX 里**按下标**读手牌的是
 *    **8 处**（fx-gen2.ts:693/1316/1786 静默跳过；effects/index.ts:849/942/1541/1590/1650 飞到错误
 *    坐标），另有 effects/index.ts:1703（playRevealFly）**一次取两手**。由 `renderHand` 的
 *    `handVisibility: 'count'` 分支保证（`data-hand-count` 写在**手牌节点本身**上，见 render.ts:1610）。
 * 6. **座位来源是 `opts.viewSeat`**，不是 `s.turnPlayer`（后者是**回合**概念，当"我是谁"会让视角
 *    每回合翻面）。本文件**不出现** `s.turnPlayer ===`。
 * 7. **两条 `.hand` 以「绝对玩家顺序」出现在 DOM 中**（P0 在前、P1 在后，见 `buildHands`），
 *    「谁显示在上带」由父容器的 `.net-view-N` 用 **CSS `order`** 决定（styles-net.css 第 6 节）。
 *    比约束 5 更危险：FX 读手牌是**按下标**的，`viewSeat = 0` 时若按视觉顺序挂载会得到 `[P1, P0]`，
 *    下标 0 拿到**对手**的手牌 → 卡飞到对手手牌区，不报错、不跳过。
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
import {
  el,
  renderStackSlot,
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
 * 20 条 A 类钩子的**逐条登记**（docs/4代-FX DOM 契约.md §3 的验收基准）
 *
 * ⚠️ **这张表不是"已提供"的证据**（G2 Task 3 的 Critical C-3 就是它曾经充当证据）：
 *   表里逐字写着 19 条 hook 的选择器字符串（Task 4 补 `.rot-180` 后为 20 条），而契约守卫的判据是"本文件的（去注释）源码里
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
  { hook: '.battery', call: ['renderStackSlot('], probeSelector: '.battery', expected: 6 },
  { hook: '.hand', call: ['renderHand(s, 0', 'renderHand(s, 1'], probeSelector: '.hand', expected: 2 },
  { hook: '.hand[data-player]', call: ['renderHand(s, 0', 'renderHand(s, 1'], probeSelector: '.hand[data-player]', expected: 2 },
  {
    hook: '.card',
    call: ['renderStackSlot(', 'renderHand(s, 0', 'renderHand(s, 1'],
    probeSelector: '.card',
    stateDependent: '场上无卡且手牌为空（同上）',
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
 * **运行时**核对：`NET_PAGE_HOOKS` 里每条非豁免钩子是否真的能在页面上查到节点（**数量确定的结构钩子
 * 连数量一起查**），外加两条**源码守卫永远证明不了**的断言（硬约束 7 的 DOM 顺序、
 * 硬约束 2 / C-4 的对手卡朝向）。
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
export function verifyPageHooks(scope: HTMLElement): string {
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

  if (soft.length > 0) console.info('[render-net] 状态相关钩子当前为空（合法局面）：\n' + soft.join('\n'));
  if (fatal.length === 0) {
    return soft.length === 0
      ? '自查 ✓ A 类钩子齐 / 手牌顺序 [P0,P1] / 对手卡与协议 180°'
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
}

/* ============================================================================
 * 顶部 / 中线 / 带
 * ========================================================================== */

/** 该玩家是否是**当前回合**玩家（`interactable` 用。注意：这是回合归属，**不是**座位归属）。 */
function isTurn(s: GameState, player: PlayerId): boolean {
  const turn = s.turnPlayer;
  return turn === player;
}

/** 连接状态占位（真实联机由 G5 提供；本阶段恒为「本地预览」）。 */
function renderConnectionBadge(): HTMLElement {
  return el('span', 'net-conn net-conn-local', '● 本地预览（未联机）');
}

/** 对手的牌库 / 弃牌堆**重新安放**到信息条内（远程页只有一个手牌区，不能再用 .hand-side 外侧列）。 */
function renderPiles(s: GameState, player: PlayerId): HTMLElement {
  const piles = el('div', 'net-piles');
  piles.appendChild(renderDeck(s, player));
  piles.appendChild(renderTrash(s, player));
  return piles;
}

/** 一条线内的「链路槽 + 协议格」（对手侧 / 自己侧各一份）。 */
function renderSideRow(
  s: GameState,
  player: PlayerId,
  line: Line,
  viewSeat: PlayerId,
  cb: UiCallbacks,
): HTMLElement {
  const isSelfSeat = player === viewSeat;
  const row = el('div', 'net-side' + (isSelfSeat ? ' net-side-self' : ' net-side-foe'));
  row.dataset.player = String(player);
  const { uid } = getHandSelection();
  // 只有当前回合玩家的链路槽可交互（与热座页一致：interactable 由引擎回合归属决定）
  const myTurn = isTurn(s, player);
  row.appendChild(renderStackSlot(
    s, player, line, myTurn ? uid : null,
    (l) => playToLine(s, cb, l, player),
    myTurn,
    // 自己 0°、对手 180°（约束 2）。`isSelfSlot` 必须显式给座位真值：
    // 缺省值用的是 `s.turnPlayer`（那是回合），在远程页会让高亮每回合翻面。
    { isSelfSlot: isSelfSeat, orient: isSelfSeat ? 0 : 180 },
  ));
  // 协议格朝向同样按座位：自己 0°、对手 180°（`renderProtocol` 只在 180° 时追加朝向类）
  row.appendChild(renderProtocolCell(s, player, line, isSelfSeat ? 0 : 180));
  return row;
}

/**
 * 中线：双方线值 + 线号。**按绝对玩家**标注（P1 在左、P2 在右），
 * 与方向性 FX 的绝对玩家假设一致（约束 3）；数值与电池同源（同一个 `getLineValue`），
 * 避免出现「电池 7 格 / 中线写 6」这种两处不一致。
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
 * 一条线 = 一整条横带：**上 = 对手 / 中线 / 下 = 自己**。
 * 视觉上的"上/下"按 `viewSeat` 换算成绝对玩家号，但 `data-player` 永远写**绝对值**（设计稿 §6.2）。
 * 「对手侧 180°」由**卡/协议自身**的 `.rot-180` 承担（本页传 `orient: isSelfSeat ? 0 : 180`，
 * 类名映射在 `render.ts:252-254` 的 180° 分支与 `:130` 的协议图）——**不是**父级 transform：
 * 行级 `rotate(180deg)` 会与卡自身的 `.rot-180` 叠加成 0°（对手的卡其实正立）并把该行水平镜像
 * （G2 Task 3 的 C-4；`styles-net.css` 第 3 节有完整说明）。这里只负责"谁在上带"。
 */
function renderLaneBand(s: GameState, line: Line, viewSeat: PlayerId, cb: UiCallbacks): HTMLElement {
  const foe = (1 - viewSeat) as PlayerId;
  const band = el('div', 'net-lane-band');
  band.dataset.line = String(line);
  band.appendChild(renderSideRow(s, foe, line, viewSeat, cb));
  band.appendChild(renderLaneMid(s, line));
  band.appendChild(renderSideRow(s, viewSeat, line, viewSeat, cb));
  return band;
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
  const who = prompt.chooser ?? top.player;
  hands.classList.add('choice-mode');

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
    wrap.appendChild(bar);
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
    wrap.appendChild(bar);
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
  wrap.appendChild(bar);
}

/* ============================================================================
 * 底部操作区
 * ========================================================================== */

/**
 * 底部操作区：刷新按钮 + 引擎给的其它行动按钮（编译线/结算触发/清缓存）+「下一步」。
 *
 * 挂在**自己那一行**手牌区里（`bottomBar`），不是重写两份 —— 回合归属由引擎决定，
 * 而 `getLegalActions(s, s.turnPlayer)` 本来就只有当前回合玩家有动作。
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
    block.appendChild(el('span', 'hint', uid
      ? '已选择卡牌 — 点高亮的链路槽打出（或拖拽到该槽）'
      : '点击手牌选择，再点链路槽打出（双击放大查看）'));
    const btn = el('button', 'btn next-btn', '下一步');
    btn.addEventListener('click', () => cb.onAction(next));
    block.appendChild(btn);
    bar.appendChild(block);
  }
  return bar;
}

/* ============================================================================
 * 手牌区（约束 5 / 7 的落点）
 * ========================================================================== */

/** `renderHand` 的入参（两个玩家只有 `isSelf` 不同，其余共用；**可见性按 `isSelf` 决定**：
 *  自己 = `'all'`（真实卡、可点），对手 = `NET_HAND_VIS`（数量占位）。见 `NET_HAND_VIS` 的警告）。 */
interface NetHandOpts {
  isSelf: boolean;
  /** 该玩家是否正在等待操作（效果挂起）→ 信息条的 operator 高亮 */
  operator: boolean;
  cb: UiCallbacks;
}

/**
 * 建出**一个**玩家的手牌行（自己的行 = 信息条 + 牌库/弃牌 + 手牌 + 操作区；
 * 对手的行 = 一行小标签 + 手牌）。
 *
 * `hand` 由调用方（`buildP0Hand` / `buildP1Hand`）**已经建好**并传入 —— 这样两个玩家的差别
 * 只剩"调 `renderHand` 时写 0 还是写 1"，而**调用顺序**在源码里一眼可读（约束 7 的代理证据）。
 *
 * ⚠️ I-1：对手的**信息条与牌库/弃牌堆只保留一份**，在顶部那条 `net-strip-foe` 里
 * （本页只有一个手牌区，见 §2 布局）。对手这一行如果也建一份，页面上会出现两份
 * `.deck[data-player=<对手>]` / `.trash-pile.pN[data-player=<对手>]` —— 而 FX 全走
 * `querySelector`（**取首个**），于是特效会飞向用户没在看的那一份，**静默错位**。
 * 所以这里对手分支只给一行小标签，不建 info、不建 piles。
 */
function decorateHand(s: GameState, player: PlayerId, hand: HTMLElement, o: NetHandOpts): HTMLElement {
  const side = el('div', 'net-hand-side' + (o.isSelf ? ' net-hand-side-self' : ' net-hand-side-foe'));
  side.dataset.player = String(player);
  if (o.isSelf) {
    // 自己的行 = 底部信息条（§2：昵称/座位 · 牌库 n · 弃牌 n · 手牌）
    const info = renderPlayerInfo(s, player, {
      isSelf: true,
      operator: o.operator,
      label: '自己（你）',
      align: 'left',
    });
    info.appendChild(renderPiles(s, player));
    side.appendChild(info);
    side.appendChild(hand);
    // 操作区只挂在**自己**那一行：`getLegalActions` 是回合制的，挂两份会出现重复按钮
    side.appendChild(renderNetActionBar(s, o.cb));
    return side;
  }
  // 对手的行：只有手牌 + 一行小标签（信息条与牌库/弃牌堆在顶部那条里，见上面的 I-1 说明）
  side.appendChild(el('div', 'net-hand-label', `对手手牌 ×${s.players[player].hand.length}`));
  side.appendChild(hand);
  return side;
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
 * 所以：DOM 顺序**恒定** [P0, P1]，视觉上谁在上带由父容器的 `.net-view-N` 用 CSS `order` 决定
 * （见 styles-net.css 第 6 节）。**不得**用 `display:none` 换位：
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

function renderPreviewToolbar(
  opts: NetViewOpts,
  onChange: (next: { viewSeat?: 0 | 1 }) => void,
): HTMLElement {
  const bar = el('div', 'net-preview-bar');
  bar.appendChild(el('span', 'net-preview-title', '预览工具条'));
  const seatBtn = el('button', 'btn net-preview-btn',
    opts.viewSeat === 0 ? '视角：我 = P1 ⇄ P2' : '视角：我 = P2 ⇄ P1');
  seatBtn.title = '切换到对方视角：切过去后"自己"就是对手（手牌正面且可点），'
    + '这是推进对手回合、把一局打完的正确做法（对手手牌只手牌数量那一档是不可点的）。';
  seatBtn.addEventListener('click', () => onChange({ viewSeat: opts.viewSeat === 0 ? 1 : 0 }));
  bar.appendChild(seatBtn);
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
  const viewSeat = opts.viewSeat;
  const foe = (1 - viewSeat) as PlayerId;
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

  // ── 顶部：对手信息条（昵称/座位 · 手牌 ×n · 牌库 · 弃牌 · 连接状态） ──
  const foeStrip = el('div', 'player-strip net-strip net-strip-foe');
  const foeInfo = renderPlayerInfo(s, foe, {
    isSelf: false,
    operator: operator === foe,
    label: '对手',
    align: 'left',
  });
  foeInfo.appendChild(renderPiles(s, foe));
  foeInfo.appendChild(renderConnectionBadge());
  foeStrip.appendChild(foeInfo);
  grid.appendChild(foeStrip);

  // ── 3 条横带（每条：上对手 / 中线 / 下自己） ──
  for (const line of [0, 1, 2] as Line[]) {
    grid.appendChild(renderLaneBand(s, line, viewSeat, cb));
  }

  // ── 控制轨（横向；按**绝对玩家**映射 —— 约束 3，`renderControlModule` 内部 4%/96%） ──
  grid.appendChild(renderControlModule(s));

  // ── 底部：两条手牌区（DOM 顺序恒定为绝对玩家顺序 [P0, P1]） ──
  const hands = buildHands(s, viewSeat, cb, operator);
  grid.appendChild(hands);

  // ⚠️ C-1：grid **必须先挂进 wrap**，选择模式才能找到候选节点 —— `renderChoiceUi` 内部
  // 三处 `wrap.querySelectorAll(...)` 都只对"已经挂在 wrap 下的节点"生效：
  //   · select 分支：`.card[data-uid]`（场上卡 + 手牌卡都在 grid 里）
  //   · select-line 分支：`.net-lane-band`（`data-line` 写在带节点上）
  // 曾经这一行在 `renderChoiceUi` **之后**：select-line 拿到 0 条带 → 没有可点目标，
  // 而 `choiceBar` 对 select-line 没有确认按钮 → 非 optional 的 select-line 永久卡死。
  // 与热座页同序（renderBoard:4800 挂 grid → :4835 跑 choice 分支）。
  wrap.appendChild(grid);

  // ── 选择模式（三个 choice-* 分支，重写为回到当前页） ──
  renderChoiceUi(wrap, hands, root, s, cb, deferredFx);

  // ── 简要日志 + 导出日志（与热座页同款；不占 FX 契约位） ──
  const log = el('div', 'log');
  for (const entry of s.log.slice(-60)) log.appendChild(el('div', 'log-entry', entry));
  wrap.appendChild(log);
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
    }));
  }

  root.appendChild(wrap);

  // 棋盘已入 DOM → 执行本帧收集的几何型 FX（矩形定位有效；透彻牌库眼睛 / 幸运宣告骰子）
  for (const fn of deferredFx) fn();

  // —— 入口第 2、3 件副作用（与 renderApp:5591/5593 同） ——
  syncCheckCacheChains(s);
  syncChainLayerPosition();
  // —— 入口第 4 件副作用 ——
  cb.onRendered?.();
  // —— 双 rAF 后移除 no-anim（与 renderApp:5595-5599 同） ——
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      root.classList.remove('no-anim');
    });
  });

  // —— 诊断（可选）：把"20 条钩子真的在 DOM 里"这件事变成可执行的证据 ——
  // 两道防线：`verifyPageHooks` 内部逐条 try/catch；这里再包一层，保证**任何**未预料的异常
  // 都不会从 `renderNetBoard` 逃逸到宿主（"诊断不得把渲染搞崩"）。C-2 的原始缺陷正是
  // 一个非法选择器抛 `SyntaxError` 直接冲垮整页渲染。
  if (opts.verifyHooks) {
    let note: string;
    try {
      note = verifyPageHooks(wrap);
    } catch (err) {
      note = `自查 ✗ 自查本身抛异常：${String(err)}`;
      console.warn('[render-net] 运行时自查抛异常（已吞掉，不影响渲染）：', err);
    }
    const noteEl = wrap.querySelector<HTMLElement>('.net-verify-note');
    if (noteEl) noteEl.textContent = note;
    else console.info('[render-net] ' + note + '（无预览工具条，故只在此处报告）');
  }
}
