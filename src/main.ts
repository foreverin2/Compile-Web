import './ui/styles.css';
import './ui/styles-gen3.css'; // 3代（MN03/AX03）协议特效样式（批次 A：15 套已编译常驻特效）
import './ui/styles-gen3-cards.css'; // 3代卡牌效果附加层样式（批次 B/C：四类动作 + 抽牌/反打/编译后）
import './ui/styles-gen3-sync.css'; // 3代常驻层与控制权族样式（批次 D）
// G2 Task 3：远程对战页布局（甲读法：3 横带 / 上对手下自己 / 自己 0°·对手 180°）。
// 只服务 src/ui/render-net.ts；styles.css 一行未改，热座页规则原样生效。
import './ui/styles-net.css';
// G3 Task 4：授权弹窗与「本地数据与隐私」屏的样式（新文件，只服务 G3 新屏）
import './ui/styles-local.css';
// G4 Task 4：重放页控制条 + 只读遮罩的样式（新文件，只服务重放页）。
// ⚠️ `tests/ui/net-body-layer-rules.test.ts` 的层叠模型是**手写副本**（它从不读本文件）⇒
// 新增样式表时必须按那条腿里写下的「收录准则」处理（本表只带 `.replay-*` 前缀类、永不命中
// 棋盘节点 ⇒ **不收**进那份模型，但要在它的排除清单里显式登记）。
import './ui/styles-replay.css';
// G5/T8：联机大厅那一屏的样式（新文件）。
// ⚠️ **必须排在 `styles-net.css`（上面第 7 行）之后**：同权重时靠后者胜 —— 那正是浏览器里
// 发生的事，也是 `tests/ui/net-body-layer-rules.test.ts` 的层叠模型建模的东西。
// 本表只带 `net-lobby-*` 前缀类、且大厅是独立屏 ⇒ 已在那条腿的 `EXCLUDED_SOURCES` 里显式登记
// （登记处写着"为什么不可能命中棋盘节点"的两条理由）。
import './ui/styles-net-lobby.css';
import { createGame, getCurrentDrafter, performDraftPick, performDraftUnpick, performDraftBan, randomPoolFromSeed, setSeedNonce, getDraftPool } from './core/state/create';
import { getCompilableLines } from './core/rules/compile';
import { collectTriggers } from './core/effects/triggers';
import { renderApp, renderDraft, resetUiState, syncCompiledFxLayers, syncSmokeOverlays, syncScanOverlays, syncPsychicParticles, syncPlagueMists, syncApathyMists, syncApathyMosaics, syncSpirit0Glows, syncSpirit1Cards, syncMetal0Glows, syncMetalPlates, syncMetal6Mans, syncMetal1LineGlows, syncMirror0BatteryGlows, syncClarity0BatteryGlows, syncIceFx, syncSmoke2LineGlows, syncFear0TriGlows, syncWarBlades, syncChainLayerPosition, syncDiversity3Fx, type UiCallbacks } from './ui/render';
// G2 Task 4：远程对战页（单视角预览）。**本 import 是 render-net.ts 第一次进入 JS 产物** ——
// 在此之前它没有任何生产代码引用它（Task 3/3F/3F2 改了 700+ 行而产物哈希一字未动），
// 也就是说 build 那道门此前对整个远程页是瞎的。
import { renderNetBoard, resetNetUiState } from './ui/render-net';
// G2 修正 R-F · I-1：离开远程页时要复位 **FX 视角座位**（`fx-seat.ts` 的模块态）。
// 它是本模块唯一需要知道的 FX 层状态 —— 与 `renderMode`/`netViewSeat` 一样属于"页面级开关"。
import { setFxViewSeat } from './ui/fx-seat';
// G2 修正 R15-A：抽牌幽灵的盒尺寸/扇形步距按**页**取值（热座 130×178.8 / 102；
// 远程页 100.572×137.601 / 78.909），方向按**容器排列方向**取值。出处见 `./ui/fx-card-size`。
import { handCardBox, handFanLead, handFanStep } from './ui/fx-card-size';
import { handOuterFor } from './ui/fx-seat';
import { openControlRearrangeModal, closeControlRearrangeModal, refreshControlRearrangeModal, isControlRearrangeOpen, orderChanged, orderToAction } from './ui/control-rearrange';
import { renderHome, renderCoin, renderLibrary, renderRules, renderModeSelect, COIN_TOSS_MS } from './ui/home';
import { linkRecoveryNotice, lobbyCoinViewOf, lobbyLinkText, appendNetTurnLine } from './ui/net-lobby';
import type { CoinNetView } from './ui/home';
// ★ T11-B：硬币屏要的"面"（屏上口径 `1 | 2`）
import type { CoinSide } from './app/coin';
// G3 Task 4：L1 授权状态机（纯层）+ 其浏览器后端 + 授权弹窗屏
import { createLocalStore, readNickName } from './app/local-store';
import { openL1Store } from './ui/local-store-browser';
import { renderLocalConsent, nextConsentStep } from './ui/local-consent';
// G3 Task 7：「本地数据与隐私」屏 + 档案的选择/落盘口（浏览器实现只在 `showLocalData` 里注入）
import { renderLocalData } from './ui/local-data';
// G4 Task 4：会话层驱动（热座 = 执行 + 记录；重放 = 只读闸门）与档案重放的接线。
// ⚠️ 收口后本文件**不再** import `executeAction`：唯一的「操作 → 引擎」映射住
// `src/app/match-replay.ts`，唯一的触发入口是 `driver.submit(...)`（腿见
// `tests/ui/main-driver-wiring.test.ts` 第 1/6 条 —— 那是设计稿 §4.5 验收项 1 的源码守卫）。
import { createLocalDriver, createReplayDriver, type MatchDriver, type ReplayDriver, type Ticker } from './app/match-driver';
// ★ G5 T11-C：联机对局的驱动（锁步：两端同一条操作序列，见 `src/net/net-driver.ts`）。
//   ⚠️ 它**不是**第二个 `main.ts` 的动作入口：造好之后交给同一个 `driver` 变量，全文件的
//   `driver.submit(` 提交点数一个不变（T11-C 判据 2 的源码腿钉着这个数）。
import { createNetDriver, type NetDriver } from './net/net-driver';
import type { NetSession } from './net/session';
// ★ G5 T11-C：跨端状态指纹（真浏览器门读的那个口）。`stableStringify` 是 `stateFingerprint`
//   的序列化那一半 —— 用它而不是另写一份，是为了"工具比的那个串"与"node 腿比的那个指纹"
//   同口径（`src/core/fingerprint.ts` 的注释写着它是"指纹与联机校验"共用的那一个）。
import { stableStringify } from './core/fingerprint';
// 重放的起跑状态（`createGame(matchFileToCreateOptions(f))` + 草稿序列真重建）
import { assertDraftPreludeMatchesSetup, draftPreludeCount, stateAfterDraft, stateAtStep } from './app/match-replay';
import { DRAFT_PICK_KIND, createMatchFileRecorder, setupFromState, type MatchFile, type MatchFileMeta, type MatchFileRecorder } from './app/match-file';
import { CARD_DATA_HASH } from './app/card-data-hash';
import { renderReplayBar, type ReplayBarNav } from './ui/replay-bar';
import { openArchivePicker, openArchiveSink } from './ui/archive-fs-browser';
import { newMatchSeed, newRandomToken } from './ui/match-seed';
import { resetControlIfHeld } from './core/rules/control';
import { initEffects, initCompileFx, initRearrangeFx, initGen3StackSwapFx, initShuffleFx, playRevealFly, buildLoveHeart, playSpeedDrawExtra, SPEED_TOTAL_MS } from './ui/effects';
import { gen3ClearCacheFx, gen3ControlChangedFx, gen3ControlCheckFx, syncGen3Persistent } from './ui/gen3-control';
import { gen3FulcrumSwapFx, gen3ProtocolSwapFx } from './ui/fx-gen3-swap';
import { syncFollowers } from './ui/fx-follow';
import { initGen2Fx, clearGen2Fx } from './ui/fx-gen2';
import { initDiag } from './ui/diag';
import { initDevMode, isDevUnlocked } from './ui/devmode';
import { gameBus } from './core/events/bus';
import { pushLog } from './core/log';
import { trace, stateDigest, initEventTracing } from './core/trace';
import type { GameState, PlayerId, Line } from './core/models/types';
// ★ G5 T12：重放页把档案记录交给 `cb.onAction` 时那一句收口需要它（见 `replayStep` 的注释）。
//   注意它**只是类型**：本文件里 `executeAction(` 仍然零命中（收口的源码腿钉着这一条）。
import { getLegalActions, type LegalAction } from './core/game';
// G3 Task 8：PWA（manifest + service worker + 自动提示更新 + 一键更新）。零依赖、手写。
import { initPwaUpdate } from './ui/pwa-update';
// ── G5/T8：联机大厅的接线（本任务的**唯一**新入口）──────────────────────────────
// 这个屏的渲染、状态、以及"入站消息喂进 accept"那条路由**全住** `src/ui/net-lobby.ts`；
// 本文件只做三件事：把**能力**注入进去（D6：浏览器 API 的唯一出处是 `./ui/net-browser`）、
// 给它一条 `renderMode` 分支、在复位时收拾它。
import {
  createLobbyClient,
  errorCopy,
  inviteLengthText,
  qrNote,
  renderNetLobby,
  type LobbyClient,
  type AnswerCodeResult,
  type LobbyDraftInput,
  type LobbyErrorKey,
  type LobbyHandoff,
  type LobbyState,
} from './ui/net-lobby';
import {
  acceptOffer,
  applyAnswer,
  browserHash,
  createBrowserTransport,
  createInvite,
  decodeBase64Url,
  decompressBytes,
  peerConnectionOf,
  candidatesOf,
  inviteLengthReport,
  readIceServers,
  readInviteFromAddressBar,
  signalingEndpointSetting,
  stripInviteFromAddressBar,
  type IceServerLike,
  type NetBrowserEnv,
  type PeerConnectionLike,
} from './ui/net-browser';
import { PROTO_VERSION } from './net/protocol';
// ★ G5 T15：「生成邀请码」等链路就绪那一步要读传输自己的类型（`transport()` 的返回面）
import type { NetTransport } from './net/transport';
import { answerPayloadFields } from './net/invite';

const root = document.getElementById('app')!;
// 启动时注入运行期 nonce（G0）：使任何未显式传 seed 的 createGame() 也不会跨重启重复同一牌序
setSeedNonce(newMatchSeed());
let state = createGame();

/** 非玩家输入步骤之间自动推进的间隔（毫秒） */
const AUTO_ADVANCE_DELAY = 400;
let autoTimer: number | null = null;
/**
 * ★ G5 T11-C：门禁专用的"关掉本机自动推进"开关（默认 `false` = 正常行为）。
 *
 * 为什么它存在（评审阻断项 3 的第二条）：③.9 要证的"一端的动作让另一端的状态变了"，
 * 而两端**各自**每 400ms 会自行推进一格 ⇒ 即使那一帧根本没送到，对端的指纹也会自己走到
 * 同一个地方（评审实测 M2-wiring 在旧判据下 **33/33 全绿**）。关掉它之后，
 * "对端的状态变了"就只可能来自收到的那一帧。
 *
 * 它**只**关掉本地这一条时序（`scheduleAutoAdvance`），不动驱动、不动玩家输入。
 */
let autoAdvanceOff = false;
/** 抽牌飞入动画进行中标志：防止动画期间再次触发刷新导致并发动画/双重渲染 */
let drawAnimBusy = false;
/** 抽牌幽灵卡尺寸与扇形步进。**G2 修正 R15-A：改成"按页取值"的函数出口** ——
 *  远程页手牌卡是 100.572 × 137.601（由 `.net-board` 的 `--card-h: 140` 派生，
 *  `styles-net.css:91-97`），比热座小 29%；抽牌幽灵与扇形步进必须跟着它，
 *  否则幽灵比真卡大一圈、抽 2 张以上每张多偏 23.09px（102 vs 78.909）。
 *  ⚠️ 值本身仍是热座的 130 / 178.8 / 102（`fx-card-size.ts` 的出口在热座页**构造性**
 *  返回这三个数：探针选择器都带 `.net-board` 前缀，热座页没有该类 ⇒ 永不命中）。 */
const ghostCardBox = (): { w: number; h: number } => handCardBox();
const handFanSpacing = (): number => handFanStep();
/** 效果触发的抽牌累计（card:drawn 事件 → 本次行动结算完成后统一播抽牌特效）。
 *  love 标志：该次抽牌是否由 love 协议触发（love-1/2/6 及 love 刷新——含对手抽），
 *  播放抽牌飞入动画时给 draw-ghost 卡背挂粉红爱心 + 边框粉红光（FX-4）。
 *  speed 标志：该次抽牌是否由 speed 协议触发（speed-1 顶「清理缓存后抽1张」）——
 *  播放抽牌动画时【先播 speed 专属飓风】（牌库区 → 手牌末尾），基础 draw-ghost 飞入
 *  顺延到专属完成后（FX-R1 时序修复：不再基础先播、专属后播）。
 *  fromOpp：从【对手】牌库抽（同化1/爱1 效果 fromOpponentDeck）——起点 = 对手牌库侧
 *  （修改提示词 31：该抽牌要有基础动画，来源视觉上是对手牌库而非自己牌库）。 */
let pendingDraws: { player: PlayerId; count: number; love: boolean; speed: boolean; fromOpp: boolean }[] = [];
/** 效果触发的揭示累计（card:revealed 事件 → 本次行动结算完成后按序播揭示飞行：
 *  幽灵从被揭示方手牌末尾逐张飞入接收方手牌末尾，全部落地后再重渲染） */
let pendingReveals: { owner: PlayerId; shownTo: PlayerId; defId: string; triggerProtocol: string }[] = [];
/** 揭示飞行进行中标志：防止动画期间再次触发刷新/渲染导致并发动画/双重渲染（同 drawAnimBusy） */
let revealFlyBusy = false;
/** 草案 → 游玩过渡进行中：暂停自动推进，避免视频期间后台渲染/推进对战界面 */
let transitioning = false;
/** 应用内重置世代号：胜利 → 返回主界面（resetToMainInterface）时 +1。进行中的抽牌/
 *  揭示动画完成回调据此放弃后续渲染——防止旧动画把新草案状态路由进渲染/飞行流程
 *  （可达路径：刷新抽牌动画进行中 → 立即胜利 → 动画结束前点「返回主界面」）。 */
let resetEpoch = 0;

/**
 * G2 Task 4：**当前页面模式** —— 热座棋盘（默认）或远程页单视角预览。
 * 这是"整帧重渲染该画哪一页"的唯一开关，只由三个入口改写：
 *   - `showModeSelect` 的 `startNetPreview` → `'net'`（单视角预览）；
 *   - `showModeSelect` 的 `startHotseat` → `'hotseat'`（显式复位，幂等）；
 *   - `resetToMainInterface` → `'hotseat'`（**必须**，否则"打完一局预览 → 返回主页面 → 开热座"
 *     会渲染成远程页 —— 那是最难自查的一类串味）。
 *
 * ## G5/T8 补的第四个值：`'lobby'`（联机大厅）
 *
 * **不复用 `'net'`**：那个值已经是**远程页单视角预览**（零联机、从草稿流程进来），而大厅没有
 * `state`（对局还没开始）。让一个字段同时承担"大厅"与"预览"两种语义，正是 D16 那条教训的形态。
 * 大厅也**不写** `renderMode = 'hotseat'`（那两个字面量点各有腿在数）—— 它只写 `'lobby'`。
 */
let renderMode: 'hotseat' | 'net' | 'replay' | 'lobby' = 'hotseat';
/** 预览视角座位（**绝对玩家号**；仅 `renderMode === 'net'` 时有意义）。页内工具条可切换。 */
let netViewSeat: PlayerId = 0;
/* G2 Task 4F（终审 I-2 + N4）：**这里原先还有一个 `netHandVisibility` 常量，现已删除。**
 * 它承载的"信息遮蔽档位"不是一个用户可选项，因此不该有"量"：本页恒为"自己正面、对手只手牌数量"。
 * 原先工具条上的"对手手牌：全部可见 ⇄ 只显示数量"按钮**只等于**"去掉数量占位、改画最多 15 张
 * **卡背**、仍不可点"（`render.ts` 的 `faceUp` 与点击绑定都以 `isSelf` 为条件；`styles-net.css`
 * 对非 self 手牌 `pointer-events:none`）—— 既不"可见"也不"可操作"，比没有更误导，故删掉。
 * **推进对手回合的正确做法是切「视角」**（切过去后对手变 self ⇒ 手牌正面 + 可点）。
 * 相应地 `NetViewOpts.handVisibility` 字段也已删除（留着只会让人以为传 `'all'` 有用 →
 * 终审 N4：那是**静默无效**的死参数）。要真正支持"可见且可点"得给 `renderHand` 解耦 `isSelf`
 * （共享助手，超出 G2 范围）→ 记入遗留。 */

/* ──────────────────────────────────────────────────────────────────────────── *
 * G4 Task 4：会话层驱动（**收口**）
 *
 * `main.ts` 从这一版起**不再直呼 `executeAction`**：所有状态迁移都走 `driver.submit(state, a)`。
 * 两个实现各管一件事，且都住 `src/app/`（纯层，受 `tests/app-purity.test.ts` 约束）：
 *   · `LocalDriver`（热座）＝**执行**（走 `applyRecordedAction` —— 全仓唯一的"档案操作 → 引擎调用"
 *     映射）**并**把同一条操作记进内存记录器 ⇒ "档案 = 真实发生过的操作序列"不靠调用方自觉；
 *   · `ReplayDriver`（重放页）＝**只读闸门**（D12）：只有档案里的**下一条**能通过，且应用的是
 *     **记录里那一条**（不是调用方给的那条）；`acceptsInput()` 恒 false（控制条据此画
 *     "重放中不可操作" + 遮罩）。
 * 这条分界就是裁决 **D2**：驱动**不持有** `GameState`，状态仍住本模块的 `state`
 * （它被 `rerender`/`cb`/`runAutoAdvance`/`syncPersistentFx`/`initDevMode`/`initDiag` 六处闭包读，
 * 因此只换绑定、不改类型与名字）。
 * ──────────────────────────────────────────────────────────────────────────── */

/** 热座驱动（模块级单例）：本地对局的唯一动作入口；记录器是**内存**数组（D13：不落盘）。 */
const localDriver: MatchDriver = createLocalDriver();
/**
 * 重放驱动：**进入重放页时创建、退出时 `dispose()` 并置 null**。
 * 它是**第四份跨页状态**（与 `resetUiState`/`resetNetUiState`/`setFxViewSeat` 并排）——
 * 漏掉退出侧的 `dispose()` 会让在飞时钟与 `onTick` 订阅活着指向已离开的页（与 G2 的串味同族）。
 */
let replayDriver: ReplayDriver | null = null;
/**
 * **当前动作入口**：热座 = `localDriver`；重放页 = `replayDriver`（只读闸门）。
 * 收口后 `cb` / `applyRearrangeSwap` 里的每一处状态迁移都只写 `driver.submit(...)` ⇒
 * "重放复用同一条编排"（D3）不是靠复制一份代码，而是靠这一个绑定。
 */
let driver: MatchDriver = localDriver;
/**
 * 注入给重放驱动的**宿主时钟**（Global Constraints：`src/app` 内不许有裸定时器 ⇒ 由宿主注入）。
 * `main.ts` 是 UI 层，用 `window.setTimeout` 构造它是允许的，也是本仓唯一的重放时钟。
 *
 * ⚠️ 驱动的原语**不做任何假设**（不读时钟、不比较句柄）⇒ 这里逐字转调 `window` 的两个函数即可。
 */
const replayTicker: Ticker = {
  schedule: (fn: () => void, ms: number): number => window.setTimeout(fn, ms),
  cancel: (h: number): void => { window.clearTimeout(h); },
};
/**
 * 宿主侧的重放诊断（`cursor().error` 之外的补充）：闸门拒绝了这一步 / 状态与档案错位时，
 * **停在这一步**并如实显示 —— 不静默重试（每 900ms 重试一次会把追踪日志刷满且永不前进）。
 * 一旦后续某一步真的推进了，它会被 `replayStep` 清掉（T4 一审 N5）。
 */
let replayHostError: string | null = null;
/**
 * 「用户在本步 FX 播放中按了**继续**」的待办（T4 一审 S4）：趁 FX 还在播时直接 `play()` 会
 * 让下一个 tick 在 FX 中间到点 ⇒ 提前走下一步。⇒ 记在这里，等 FX 播完的那次 `rerender()`
 * 再真正开播（见 `replayNav.play` 的注释）。
 */
let replayResumePending = false;
/**
 * 「用户在本步 FX 播放中按了**单步**」的待办（与上一条同族，本轮一并收口）：立刻走一步会让
 * 两套动画并发飞；若下一条档案操作是 `refresh`，它还会被 `drawAnimBusy` 挡回 ⇒ 游标不动
 * ⇒ **误报停机诊断**。⇒ 忙时只记待办，等 FX 播完再走（见 `replayNav.next` 的注释）。
 */
let replayStepPending = false;
/**
 * 会话内**最近一局**的档案（D9）：返回主界面后仍保留（否则"打完一局回主页就导不出来"），
 * 新对局开始时被覆盖。**只在内存**（D13：不落盘、不新增任何存储写入点）。
 */
let lastArchive: MatchFile | null = null;

/* ──────────────────────────────────────────────────────────────────────────── *
 * G5/T8：联机大厅的**宿主侧**接线（本任务唯一的新入口那一支）
 *
 * 分工写死：**渲染、状态、"入站消息喂进 accept"那条路由全住 `src/ui/net-lobby.ts`**；
 * 本文件只做三件事 —— 把能力注入进去（D6：浏览器 API 的唯一出处是 `./ui/net-browser`）、
 * 给它一条 `renderMode` 分支、在复位时收拾它。
 *
 * ⚠️ **本任务不做的事，如实写在代码里**（免得被读成"已经能联机了"）：
 *   - **不构造信令客户端**：`createSignalingSession` / `discoverSignalingEndpoint` 属 T9 的真浏览器线。
 *     所以"输 6 位码"这条路今天只到"端点判定 + 归一化 + 频道名"为止（那正是不发任何请求的那一段）；
 *   - **真 SDP / ICE 的取法**见 `makeLobbyInvite`（等 ICE 收集完成再取本侧描述，B2）。
 *     邀请码的**形状**（`<协议版本>.<压缩段>`、载荷只在 fragment）是真的，里面的 SDP 是占位串；
 *   - **不落盘**连接设置：`netSettings` 只活在内存里（本任务不动存储面）。
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * 大厅客户端与它的角色。
 *
 * 为什么这两样住本文件而不是 `net-lobby.ts` 的模块态：大厅的渲染是"读状态画一帧"
 * （照 `local-consent.ts` / `local-data.ts` 的形状），而模块态会跨页残留 —— 本仓已经栽过三次
 * 同族的坑（`resetUiState` / `resetNetUiState` / `setFxViewSeat`）。⇒ 复位点只有一个，
 * 就是 `resetToMainInterface()`。
 */
let lobbyClient: LobbyClient | null = null;
let lobbyMode: 'host' | 'guest' | null = null;

/* ── ★ T11-B：联机硬币屏（D27 把这块屏插在握手中间）──────────────────────────── */

/**
 * 硬币屏上"叫哪一面"这个未决问题的 resolve（`null` = 这一刻没有人在等叫面）。
 *
 * ## 为什么它必须活在 `main.ts`
 *
 * 两个接口在这里对上：大厅那头是 `LobbyClientOptions.chooseFace(): Promise<CoinSide>`
 * （"这一局叫哪一面"），屏这头是 `CoinNav.net.choose(side)`（玩家按下了那一枚芯片）。
 * 库那头**不认识屏**、屏那头**不认识库**，所以"把点击变成那次 resolve"这件事只能住在宿主。
 *
 * ## 为什么只有一个槽位（而不是一个队列）
 *
 * 叫面**一局只有一次**（D3：只有加入方叫，相位机只认一条 `commit-face`）。多出来的那次 resolve
 * 要么是重复点击、要么是上一局的残留 —— 两种都不该被"排队等着"，所以这里只留最新的那一个。
 */
let chooseFaceResolve: ((side: CoinSide) => void) | null = null;

/**
 * 这一局的硬币屏上是否**已经叫过面**（一局只叫一次）。
 *
 * 为什么它必须存在，而不是靠"屏上已经点了"这件事自己保证：相位机只认一条 `commit-face`
 * （`session.ts:292` 的 `mayCommitFace`），第二次 resolve 会落到一个**已经没人听**的 Promise 上；
 * 而重复点击在真浏览器里是很容易发生的（禁用态要等下一次整帧重画才生效）。
 */
let faceChosen = false;

/**
 * 上一帧硬币屏画的**是哪一份读数**（`null` = 这一帧没有硬币屏）。
 *
 * 为什么是"读数指纹"而不是一个布尔闩：硬币屏会**变**（叫完面 ⇒ 相位变、落点到手 ⇒ 屏上出现落点），
 * 而它只能从 `renderLobbyFrame` 那个入口画出去。用一个一次性布尔闩会让屏**冻在第一次那一帧**上
 * —— 实测症状（2026-09-19）：落点已经算出来、相位也走到 `complete` 了，屏上却永远停在
 * "等对方叫面"那一格，看起来像握手没继续。指纹只在**读数真的变了**的时候重画，于是
 * "每条入站都重画一帧"这件事不会变成"每条入站都整屏重建"。
 */
let lobbyCoinShown: string | null = null;

/**
 * 本端这一刻在硬币屏上的读数（`null` = 还没有硬币屏，照旧画大厅那一屏）。
 *
 * ★★ **读数怎么算的搬去了 `src/ui/net-lobby.ts` 的 `lobbyCoinViewOf()`**（修复轮）：
 * 那个文件能在 node 里用真客户端跑（`tests/ui/net-lobby-coin-consensus.test.ts` 拿它钉"两端
 * 算出的先选协议者必须相同"），而本文件一 import 就把整个游戏跑起来、node 里测不了。
 * 这里只剩宿主的两件事：把点击接到"要面"那个 Promise 上，以及叫完之后驱动一次。
 */
function lobbyCoinView(): CoinNetView | null {
  const client = lobbyClient;
  if (client === null) return null;
  return lobbyCoinViewOf(client, {
    choose: (side) => {
      // 一局只叫一次面（相位机也只认一条 `commit-face`）：多出来的那次 resolve 无处可去
      if (faceChosen) return;
      faceChosen = true;
      chooseFaceResolve?.(side);
    },
    /**
     * ★ **叫完面就驱动一次**（与 `onInbound` 里那一句同源）。
     *
     * 为什么非要这一句：面是**异步**到的（`chooseFace` 是个 Promise），而驱动循环是**同步**的
     * —— `driveOnce` 在面到手之前只会返回"这一格没东西发"。等面 resolve 时，那个驱动循环
     * 早就走完了；而这一格**不会有**下一次入站把它叫醒（它在等玩家按芯片）。
     * 没有这一句，屏上看着一切正常（芯片选中、相位停在等面），而握手**永远不会继续**
     * —— 真浏览器门实测就是这个形状（2026-09-19）。
     *
     * 放在微任务里跑（`queueMicrotask`）而不是当场同步调：`resolve` 的反应也是微任务，
     * 排在它后面才能保证 `chosenFace` 已经写好 —— 当场调会驱动一个面还是 null 的相位
     * （那一格只能返回 false，白跑一次）。
     */
    onChosen: () => { queueMicrotask(() => { lobbyClient?.drive(); }); },
  });
}

/* ── ★★ T11-C：握手完 ⇒ 进牌桌（任务书 §6 那一格的落点）────────────────────────── */

/**
 * 这一局联机对局（`null` = 还没进 / 已经复位）。
 *
 * ## 为什么 `handoff` 要留一份
 *
 * 它携带的那条**传输**是握手用的那一条（`link.transport`）——`createNetDriver` 吃的就是它，
 * 本文件**不另造第二条**（另造一条 = 两条各说各话的连接，`net-lobby.ts` 的 C1 缺陷同形）。
 * 会话对象与传输的寿命都在这里：复位时由 `netSession.detach()` + `netDriver.dispose()` 收拾。
 *
 * ## 为什么这里只存一份最小读数（而不是整份 `LobbyHandoff`）
 *
 * 宿主需要的只有"这一局是怎么开的"（种子 / 先选者 / 叫出去的面 / 落点 / 各自的座位）——
 * 它们是排查跨端分歧时唯一能指明"两边算的是不是同一局"的东西。把一整份握手对象长期留在这里
 * 会让它看起来像"第二个真相源"，而它对局中一次都不会被读。
 */
type NetMatch = {
  readonly driver: NetDriver;
  readonly session: NetSession;
  /**
   * ★★ **G5 T13-B：本局主机侧的档案记录器**（D8："重连凭据 = 主机内存里的当前 `MatchFile`"）。
   *
   * 它是 `resyncSource` 的唯一内容来源（`netFileOf()`），也是"追平之后两端规范串逐字相等"
   * 这条判据能成立的前提：没有它，房主手里根本没有可发的档案 ⇒ 会话层只能回
   * `'resync-not-wired'`（fail-closed），而加入方永远追不平。
   */
  readonly recorder: MatchFileRecorder;
  readonly seed: string;
  readonly draftStarter: PlayerId;
  readonly caller: PlayerId;
  readonly chosen: CoinSide;
  readonly landed: CoinSide;
  readonly selfSeat: PlayerId;
};
let netGame: NetMatch | null = null;

/**
 * ★★ **把握手走出来的那一组数变成一局真的对局**（T11-C；任务书 §6 的实现面）。
 *
 * ## 顺序写死，而且每一条都有理由（这是本段最容易被"顺手调一下"弄坏的地方）
 *
 *  1. `handoff.ready === false` ⇒ **什么都不做**（屏那边还停在硬币屏上等）；
 *  2. `createGame({ seed, draftStarter, firstToPlay: 1 - draftStarter, draftMode, draftPool })`
 *     —— 种子与先选者**都来自握手**（两端同一个种子 ⇒ 同一副牌、同一个池子；同一个
 *     `draftStarter` ⇒ 同一个轮选顺序）；
 *  3. `createNetDriver({ transport, seat })` —— 传输是**握手那一条**（`handoff.transport`）；
 *  4. **`driver.arm(state)` 先于任何入站帧**（任务书 §8 第 4 条）：驱动的入站是推送的、
 *     而它不持有 `GameState`（G4 D2）⇒ 入站帧先入队，`arm` 才让它们落地。放在
 *     `state = createGame(...)` **之后**、`rerender()` **之前**：这一刻到下一帧之间没有
 *     任何页面代码能跑，所以"第一帧被当成宿主从没递过状态"在结构上不可能发生；
 *  5. 换 `driver` / `renderMode`，最后 `rerender()` 画草稿屏。
 *
 * ## 为什么 `renderMode` 换成 `'net'` 而不是留在 `'lobby'`
 *
 * 草稿期两条分支都画热座那套草稿页（`rerender` 的 `net` 分支带 `state.phase !== 'draft'` 守卫）。
 * 而草稿**打完**那一刻相位变 `'turn'`：留在 `'lobby'` 会让 `rerender()` 去画**联机大厅**
 * （把大厅盖在牌桌上），换成 `'net'` 才是"远程页单视角"那一套。座位口径（哪一侧是自己）
 * 归后续任务：本段只到"进草稿 + 真的选一步"。
 *
 * ## `draftMode` / `draftPool` 两端怎么做到逐字一致（判据：两端状态指纹相等）
 *
 * **协议里没有传设置的消息**（`src/net/protocol.ts` 本阶段冻结），所以设置只能是两端都能
 * **构造性**得到的那一份值：
 *  - `draftMode` 取**常量** `'normal'`（热座那个勾选框是本地偏好，联机下没有传它的路，
 *    取"假设两端勾的一样"就是判据 3 会红的那种"大概一样"）；
 *  - `draftPool` **不传**（`undefined`）⇒ `createGame` 落回 `opts.draftPool ?? [...DEMO_PROTOCOLS]`
 *    （`src/core/state/create.ts:77`）—— 两端读的是**同一份常量协议全集**，与种子、
 *    与任何本地读数都无关 ⇒ 逐字一致。**G5 T21 起**这条从"同种子派生的 12 套随机池"
 *    换成"全部协议"（用户真机反馈：联机只给了 12 套，而热座默认是全部）——
 *    一致性的**理由换了，判据没换**（两端仍必然相等，且这次连"房主离线磨种子"都不相关）。
 *
 * ## 视角座位（G5 T21 加；用户真机反馈 2）
 *
 * `netViewSeat` 必须等于**本端座位**（喂给 `createNetDriver` 的那个 `hand.seat`），否则
 * 两端都渲染座位 0 的视角、加入方看到的"我"是对手。赋值点就在 `createNetDriver(...)` 之后、
 * 那条重连分支**之前**（一处覆盖新开一局与重连换驱动两条路）。
 *
 * ## 返回值（T12 加）
 *
 * 返回**它造出来的那个驱动**（没造出来 / 已经造过 ⇒ `null`）。加这个返回值的理由只有一个、
 * 但是硬的：`rebootDraft()`（排查用）需要在 `enterNetGame()` 之后读**新驱动**的座位，而
 * TypeScript 的控制流分析不追被调函数里的赋值 —— `netGame = null; enterNetGame();` 之后
 * 它仍把 `netGame` 当成 `null` ⇒ 那句 `netGame.driver.seat` 会被判成"在 `never` 上取属性"。
 * 交回驱动比在调用点写一句类型断言更诚实：那个数**就是**这一刻造出来的那一个。
 */
function enterNetGame(): NetDriver | null {
  const client = lobbyClient;
  if (client === null) return null;
  /**
   * ★★ **G5 T13-A：已经进过牌桌时，这个口只做一件事 —— 把驱动换到重连后的新传输上。**
   *
   * 为什么归这里（而不是另开一个 `reattachNetDriver()`）：`createNetDriver(` 在 `src/main.ts`
   * 里**只许有一处**（`tests/ui/coin-screen-net.test.ts` 的计数腿），而"造驱动"这件事本来就
   * 只有这一格；两个入口会让"驱动是拿哪条传输造的"分叉（T11-B 的 I-1/I-2 那一族缺陷）。
   *
   * 顺带把开局读数**不重算**这件事写死：`existing !== null` 时这一局的 seed / 先选者 /
   * 座位都在 `existing` 里，重连之后权威是**追平回来的档案**，不是又一次握手（用户裁决
   * 2026-09-20："别让玩家以为又掷了一次"）。
   */
  const existing = netGame;
  const raw = client.handoff();
  /**
   * ★★ **G5 T13-C：换驱动（或第一次进牌桌）的唯一前提是"这一局的读数齐了"**
   * （`handoff().ready`：相位 `complete` + 胜负依据齐 + 种子落点都在）。
   *
   * ## 为什么这一条要提到最前面（它对两条路都成立）
   *
   * 第一次进牌桌本来就要求它（下面那句 `!hand.ready && existing === null`）。而**重连那条路**
   * 原来**不要求** —— 只要新链路造出来了（`client.transport()` 非空）就当场换驱动。T13-C 把
   * "从屏上重新贴码回来"做成生产路径之后，这个宽口径会立刻变成缺陷：玩家点「生成邀请码」
   * 那一刻新传输就建出来了，而**握手还没开始** ⇒ 换驱动会把屏切回牌桌、把刚拿到的大厅屏
   * 盖掉（玩家再没有入口贴码回示码）。⇒ 判据统一成一句：**没握手完就不进牌桌**。
   */
  if (!raw.ready) return null;
  /**
   * ★★ **G5 T19：读数齐了还不够 —— 硬币阶段三格必须都走完。**
   *
   * ## 它修的是什么（用户真机提的第 1 件事）
   *
   * T11-C 起，进牌桌的触发点是**这一句**（硬币屏上没有"开始对局"按钮），于是"读数齐了"
   * 就直接进草稿 —— 硬币阶段是"叫完面 ⇒ 立刻看到结果"，中间**没有抛的动作**。
   *
   * ## 判据：`coinPhase === 'settled'` 且那一格也到期
   *
   * ⚠️ **不许只看时刻**（第一版的阻断项）：`coinPhaseAt` 为空有两种意思 ——"还没起头"与
   * "已经落定"，只按时刻判会把"停在中途"当成"可以进"。相位那一半由
   * `advanceCoinPhaseIfReady()`（**本函数之前**、`renderLobbyFrame` 每帧的第一件事）负责推进。
   *
   * ⚠️ **兜底：如果这一帧没推过阶段**（例如硬币屏那一支被 `lobbyRestartNeeded` 挡住、
   * 或这条调用来自 `rebootDraft()` 这类排查路径），就在这里起一次并**返回 null** ——
   * 起完那一帧还不该进，要等三格走完。
   *
   * ## 为什么判据是一段时间而不是"等一个动画事件"
   *
   * 动画是屏那一层的东西（`src/ui/home.ts`），而进牌桌是应用层的事 —— 让应用层去读屏的事件
   * 会把两层耦在一起，且"动画被取消/元素被换掉"这类情形会让事件永远不来（不报错的死挂）。
   * 三段都是**有界**的（900 + 1620 + 1200 = 3720ms；动态偏好下动画那一段压到 120ms）。
   *
   * ⚠️ **两端各自本地等**（各自的 `performance.now()`），但判据（`landed` / `winner`）是
   * 同一份握手读数 ⇒ "谁先选协议"在两端不会分叉。
   */
  if (coinPhase !== 'settled') {
    // 没起头（或停在中途）⇒ 交给推格子那条路（它幂等），这一帧无论如何不进牌桌
    if (coinPhase === null && coinVerdict !== null) {
      coinPhaseSeed = coinVerdict.seed;
      coinPhase = 'call';
      coinCallStartedAt = performance.now();
      coinPhaseAt = coinCallStartedAt + COIN_CALL_HOLD_MS;
      // ★ 走唯一包装（它自带"必须还没到点"的判断；这里虽然是刚算出来的未来时刻，也不留第二个入口）
      armCoinPhaseWake(coinPhaseAt, coinVerdict.seed);
    }
    return null;
  }
  // 落定了、但结论行那一格还没停够 ⇒ 再等（结果行必须在屏上真的停留 COIN_SETTLED_HOLD_MS）
  if (!coinPhaseElapsedAt(coinPhaseAt)) return null;
  /**
   * `handoff()` 在重连中间态里把 `transport` / `session` 置成 `null`（`ready` 为假：
   * 相位还没回到 `complete`）⇒ 这一格里"新链路那条传输"要从 `client.transport()` 补上，
   * 否则换驱动这一步拿不到东西、而旧驱动手里那条传输已经死了（症状是静默停摆）。
   */
  const hand = existing === null
    ? raw
    : { ...raw, transport: client.transport(), session: existing.session };
  const alreadyOnThisTransport = existing !== null && hand.transport === existing.driver.transport;
  if (existing !== null && (hand.transport === null || alreadyOnThisTransport)) return null;
  // 上面两条已经挡掉了两种 null；这一句把 `hand.transport` 收窄成非空（下面那句要用它）
  if (hand.transport === null) return null;
  /**
   * ★★ **G5 T13-B：重连凭据的记录器**（D8："重连凭据 = 主机内存里的当前 MatchFile"）。
   *
   * 两端都挂 —— 加入方那一份不进 `resync-res`（凭据只在房主手里），但它是"本端手里有一份与线上
   * 同序的记录"的唯一载体，也是追平之后 `realign` 的对账面。**座位与传输仍是握手交出来的那两个**
   * （`createNetDriver({ transport: hand.transport, seat: hand.seat, … })` 那一条判据的口径没变）。
   *
   * 重连换驱动时**沿用同一个记录器**：它是这一局的档案，不能因为换了驱动就断代。
   */
  const recorder = existing === null ? createMatchFileRecorder() : existing.recorder;
  // ★ `createNetDriver(` 在 `src/main.ts` 里**只此一处**（计数腿）：两条路（第一次进牌桌 /
  //   重连换传输）共用这一句，免得"驱动是拿哪条传输造的"分叉。
  const netDriver = createNetDriver({ transport: hand.transport, seat: hand.seat, recorder });
  /**
   * ★★ **G5 T21：本端视角座位 = 喂给驱动的那个本端座位**（用户真机反馈 2）。
   *
   * ## 它修的是什么
   *
   * `netViewSeat`（`:193`）在本次改动之前只在**开发者的预览切换器**里被改过
   * （`:3010` 的 `onPreviewChange`、devmode 的 `netSeat`）⇒ 生产路径上它的初值 `0` 一路带进
   * 对局，`rerender()` 那句 `viewSeat: netViewSeat`（`:3007`）于是**两端都画座位 0 的视角**：
   * 房主（座位 0）看着对，加入方（座位 1）看到的"我"是**对手**。
   *
   * ## 为什么赋在这里（一处覆盖两条路）
   *
   * 这一句紧跟在 `createNetDriver({ …, seat: hand.seat, … })` 之后，而那一个 `seat` 正是
   * `handoff()` 交出来的本端座位（`__g5Match.seat()` 读驱动的那个数）⇒ "驱动认为我是谁"与
   * "渲染器认为我是谁"**同源、无加工**。两条路都经过这一格：
   *  - **新开一局**：下面的 `createGame` + `arm(state)`；
   *  - **重连换驱动**（`existing !== null` 那一支，`hand.seat` 来自新链路那次握手）——
   *    "只在新开一局那条路上赋一次"会漏掉这一支，所以赋在**分支之前**。
   *
   * ## 为什么不会踩掉开发者那条路
   *
   * 预览切换器（`视角` / `seat 1|2` 指令）写的是**同一个** `netViewSeat`，而它只在 dev 解锁后
   * 才在屏上/指令里可达（`isDevUnlocked()`）—— 本函数只在**进牌桌那一刻**跑，之后开发者再切
   * 依旧生效（下一次进牌桌才回正）。这正是"dev 预览切换器仍要能用"那条要求。
   *
   * ## FX 层的视角座位
   *
   * 不在本文件重复设：`renderNetBoard(root, state, cb, { viewSeat })` 内部就写
   * `applyFxViewSeat(opts.viewSeat)`（`render-net.ts`；`tests/ui/render-net.test.ts` 的 R3-2
   * 与 `tests/ui/fx-seat.test.ts` 钉着"必须来自 `opts.viewSeat`、不得直调 `setFxViewSeat`"）
   * ⇒ 只要上面那个 `viewSeat` 对了，FX 那一侧跟着对。本文件剩下的两处 `setFxViewSeat(null)`
   * 是**复位**（回主页 / 进重放），不是设视角。
   */
  netViewSeat = hand.seat;
  // ★ `probeOn` 下这一段有个只读读数：`__g5Match.diag().netViewSeat`。
  // ★ G5 T12：给这条传输挂一个**只读**的入站 `act` 帧计数（判定集 ③.7 用它证"变化来自线"）。
  //   默认路径（没带 `#g5probe=1`）也挂得上，但只有探针会去读它 ⇒ 开销是一个闭包与一个整数。
  watchInboundFrames(netDriver);
  // ★★ G5 T13-B：**入站队列溢出 ⇒ 走一次追平**（`queue-overflow` 那条 cause 的动作）。
  //   T5 的驱动会把溢出报成一条 `'inbound-overflow'` 失败（`net-driver.ts:177`），
  //   而"承认本端跟不上了"这件事要由宿主转成会话层的 `needsResync` 并去要档案 ——
  //   没有这条接线，溢出会被标出来但**永远恢复不了**（`net-driver.ts:103-108` 的登记）。
  netDriver.onFailure((f) => { noteNetOverflow(f.reason, f.message); });
  if (existing !== null) {
    /** ── ★ G5 T13-A：重连换了传输 ⇒ 换驱动，**不重建这一局**（开局读数一律不重算）────── */
    const carried = existing.driver.appliedSteps();
    existing.driver.dispose();
    /**
     * ★ 新驱动的 `applied` 从 0 起，而这一局已经走了 `carried` 步 ⇒ "下一条该是几"必须接上，
     * 否则之后每一条入站 `act` 都 `seq-mismatch`（`net-driver.ts:263-270` 的原话就是这个形状）。
     */
    netDriver.realign(carried);
    netDriver.arm(state);
    if (probeOn) armedState = state;
    netGame = { ...existing, driver: netDriver };
    driver = netDriver;
    renderMode = 'net';
    // ★ G5 T13-C：真的回到牌桌了 ⇒ "屏该画大厅那一屏"那个读数复位（同族的复位点见它的声明）
    linkRecoveryNeeded = false;
    /**
     * ★★ **G5 T19：重连换驱动时把"草稿转场演过没有"按这一刻的相位定**。
     *
     * 这一支**不重建这一局**（`existing` 里那一局的相位早已跨过 `draft`：它在断线之前就打完
     * 草稿了）⇒ 置 `true`，于是"重连回到牌桌"**不会**补播一次转场（同"别让玩家以为又重新
     * 开了一局"那条纪律）。反过来，万一重连发生在草稿还没打完时，相位仍是 `'draft'` ⇒ 置
     * `false`，那一局剩下的那一步跨过去时照样会播。
     */
    draftTransitionPlayed = state.phase !== 'draft';
    /**
     * ⚠️ **这一句的语义**（评审登记：原来写成 `= 0` 与闩的语义不符）：`transitionPlayed` 是
     * "**这一局的草稿转场播过几次**"。重连时那一局多半已经播过 1 次（相位早已跨过 `draft`）
     * ⇒ 跟着闩写 1；万一重连发生在草稿还没打完时，闩是 `false` ⇒ 写 0，那一步跨过去时照数。
     */
    transitionPlayed = draftTransitionPlayed ? 1 : 0;
    rerender();
    return netDriver;
  }
  if (hand.seed === null || hand.draftStarter === null || hand.session === null) return null;
  const seed = hand.seed;
  const draftStarter = hand.draftStarter;
  state = createGame({
    seed,
    draftStarter,
    firstToPlay: (1 - draftStarter) as PlayerId,
    draftMode: 'normal',
    // ★★ G5 T21：**不传池 = 全部协议**（用户真机反馈 1）。原来是 `randomPoolFromSeed(seed, 12)`
    //   ⇒ 联机草稿被限成 12 套，而热座默认（`showCoin` 那条 `gameOptions.randomPool ? … : undefined`）
    //   是全部 ⇒ 联机与热座"池子大小不一样"。两端一致这条判据一个字都没变：池的**来源**从
    //   "同一粒种子派生的随机池"换成"同一份常量协议全集"（`create.ts:77` 的
    //   `opts.draftPool ?? [...DEMO_PROTOCOLS]`），两端都不依赖任何本地读数 ⇒ 仍逐字一致。
    draftPool: undefined,
  });
  /**
   * ★★ **G5 T19：新开一局 ⇒ 这一局的草稿 → 对局转场还没演过**（`createGame` 之后相位必是
   * `'draft'`，所以这一句是"这一局从草稿开始"的**事实**，不是一个猜的初值）。
   *
   * 复位点只有这一处与 `resetToMainInterface()`：漏了前者会让第二局的转场永远不播
   * （上一局的闩还在），漏了后者会让"打完一局回主页再开"带着上一局的闩。
   */
  draftTransitionPlayed = false;
  transitionPlayed = 0;
  // ★ 递状态必须排在 `rerender()` 之前（见上面第 4 条）：这一刻到下一帧之间没有页面代码能跑
  netDriver.arm(state);
  if (probeOn) armedState = state;
  netGame = {
    driver: netDriver,
    session: hand.session,
    recorder: netDriver.recorder() as MatchFileRecorder,
    seed,
    draftStarter,
    caller: hand.caller,
    chosen: hand.chosen,
    landed: hand.landed,
    selfSeat: hand.seat,
  };
  driver = netDriver;
  renderMode = 'net';
  // ★ G5 T13-C：进牌桌 ⇒ "屏该画大厅那一屏"那个读数复位（与上面重连那一支同源）
  linkRecoveryNeeded = false;
  /**
   * ★★ **进牌桌之前，先把"硬币落地"这一帧补画出来**（评审 R2 §8 遗留 1 的连带发现）。
   *
   * ## 为什么必须有这一句
   *
   * 走进 `enterNetGame()` 说明**这一刻读数已经齐了**（`handoff().ready`）—— 而读数是由
   * `lobbyCoinView()` 在同一帧算出来的，算完这一帧就 `return` 去画牌桌了 ⇒ 硬币屏上那句
   * "掷出 X —— 玩家 N 先选协议"**在房主那一侧一次都没出现过**。
   * 实测（2026-09-19，工具装了 `MutationObserver` 才看得见）：房主 `frames: 0 / text: null`，
   * 加入方 `frames: 1 / text: "掷出 反面 —— 玩家 1 先选协议 · 玩家 2 先出牌"`。
   * ⇒ 两端**看到的屏不一样**（一端看过落地、一端没看过），而"两端文案说的是同一个座位号"
   * 这条判据在房主那侧**无从判起**。
   *
   * ## 为什么画这一帧不会多留一帧
   *
   * 它是**同步**画完就走的：这一句之后紧接 `rerender()` 把牌桌画上去。玩家看不到中间态
   * （同一帧内两次 `root` 重写，只有最后一次进合成）—— 不能改的只是"它到底有没有被画过"。
   *
   * ## 与 `lobbyCoinShown` 的关系
   *
   * 只在这一帧确实是"刚落地的硬币屏"时补画（`coinVerdict !== null && !coinSettledShown`）；
   * 画过就置位，`resetToMainInterface` 复位 —— 与那三份模块态同族。
   */
  if (coinVerdict !== null && !coinSettledShown) {
    coinSettledShown = true;
    renderCoin(root, {
      backHome: () => { showModeSelect(); },
      beginGame: () => { /* 联机进牌桌由 enterNetGame() 触发，不是这个按钮 */ },
      net: {
        role: hand.role === 'host' ? 'waiter' : 'caller',
        phase: hand.phase,
        choose: () => { /* 面已经叫过了（读数齐了才走到这一格） */ },
        chosen: hand.chosen,
        landed: hand.landed,
        winner: draftStarter,
        caller: hand.caller,
        // ★ G5 T19：走到这一格说明硬币阶段**已经到落定**（上面那道闸），所以这一帧是结论行那一格。
        //   它几乎是多余的（屏上早就在这一格停够 1200ms 了），留着是同一条链路的兜底。
        coinPhase: 'settled',
      },
    });
  }
  lobbyCoinShown = null;
  // ★ 把"这段读数 → 喂进 createGame 的那两个数"留一份（**只跟着 `#g5probe=1` 走**，
  //   见 `exposeMatchProbe` 的说明）。存在的理由是**判据 3 需要对照物**：门禁能比
  //   "两端是否一致"，却比不出"两端**一致地**算错"（镜像实测 2026-09-19：把喂进去的
  //   `draftStarter` 取反，跨端那几条全绿）。
  const probeHolder = globalThis as { __g5Handoff?: unknown; __coinVerdict?: unknown };
  if (probeHolder.__g5Handoff !== undefined) {
    probeHolder.__g5Handoff = {
      seed,
      draftStarter,
      caller: hand.caller,
      chosen: hand.chosen,
      landed: hand.landed,
      /**
       * ⚠️ **两个座位字段有意义地分开**（评审 M2-seat 的落点）：
       *  - `seat` = **喂进 `createNetDriver` 的那一个**（门禁据此判"驱动吃到的座位对不对"）；
       *  - `handSeat` = `handoff()` 交出来的那一个（**不经任何加工**）；
       *  - `driverSeat` = **驱动自己那个只读字段**（`NetDriver.seat`，`net-driver.ts:208`
       *    在构造时直接存下来的那一个）—— 不是 `netGame.selfSeat`（那是本文件自己赋的副本，
       *    与 `handSeat` 同源 ⇒ 拿它比是自证；评审 R2 §7 点出过这条）。
       * 三者不相等就说明主代码把座位加工过（取反 / 写死）—— 那是跨端比指纹**看不见**的缺陷。
       */
      seat: hand.seat,
      handSeat: hand.seat,
      driverSeat: netDriver.seat,
      role: hand.role,
    };
    /**
     * ★ 兜底再写一遍硬币那帧的读数（`coinVerdict` 的说明里有全部理由）。
     * 这一句是**为了那一帧与这一帧重叠**的情形：真到了这一格说明读数是齐的，
     * 那就没有理由让上层那个读数继续是 `null`。幂等，写同一个值。
     */
    if (probeHolder.__coinVerdict === null || probeHolder.__coinVerdict === undefined) {
      probeHolder.__coinVerdict = {
        role: hand.role, caller: hand.caller, chosen: hand.chosen,
        landed: hand.landed, winner: draftStarter, seed, phase: hand.phase,
        /**
         * ★★ **G5 T19 修复轮：硬币三段各自的实测停留**（见 `turn().coinTiming` 的说明）。
         *
         * 挂在这里（而不是只挂 `turn()`）的理由：这一格是 `enterNetGame()` 里、**硬币阶段
         * 已经走完**的那一刻，而 `__coinVerdict` 是门禁（`coinVerdictOf`）**已经在读**的读数口
         * ⇒ 报告里的"三段各停了多少毫秒"是可复核的实测值，不是源码自洽。
         */
        timing: {
          callHoldMs: coinCallStartedAt === null || coinTossStartedAt === null
            ? null : Math.round(coinTossStartedAt - coinCallStartedAt),
          tossHoldMs: coinTossStartedAt === null || coinSettledStartedAt === null
            ? null : Math.round(coinSettledStartedAt - coinTossStartedAt),
          settledHoldMs: coinSettledStartedAt === null
            ? null : Math.round(performance.now() - coinSettledStartedAt),
          reducedMotion: reducedMotion(),
        },
      };
    }
  }
  rerender();
  return netDriver;
}

/* ══════════════════════════════════════════════════════════════════════ *
 * ★★ G5 T13-A/B：重连接线的四处宿主动作
 * ══════════════════════════════════════════════════════════════════════ */

/**
 * ★★ **入站队列溢出 ⇒ 走一次追平**（`queue-overflow` 那条 cause 的宿主动作）。
 *
 * ## 为什么必须有这一格（`net-driver.ts:103-108` 登记的那个"标出来但永远恢复不了"）
 *
 * 溢出的语义是"**本端跟不上了，本地状态不可信**"（`net-driver.ts:171-177`），而唯一的诚实
 * 出路是拿房主的档案重建。T5 那一侧已经把它报成一条真失败（`'inbound-overflow'` +
 * `inboundOverflowCount()`），但"承认落后 ⇒ 去要档案"这一步在**宿主**这一层 ——
 * 没有它，溢出只会留在 `lastFailure()` 里，屏上照旧能操作，而本端的状态已经不可信。
 *
 * ## 两条 cause 各走各的入口（判据 2）
 *
 *  - `resuming-handshake`：重连握手（`createLobbySessionLink().receive()` 收到 `hello-ack`）；
 *  - `queue-overflow`：**这里**。溢出可能发生在任何相位（`session.ts:1244-1247`），
 *    所以它不能挂在"握手"那个触发点上，而要由驱动的失败事件驱动。
 *
 * ⚠️ 房主那一侧的溢出**没有出路**（协议里只有加入方能发 `resync-req`，而档案只在房主手里）
 * —— 那一条如实登记在 `net-driver.ts:107-108`，本函数只把"本端落后了"如实标出来（屏上有行），
 * 不假装它能被追平。
 */
function noteNetOverflow(reason: string, message: string): void {
  if (reason !== 'inbound-overflow') return;
  const client = lobbyClient;
  const g = netGame;
  if (client === null || g === null) return;
  client.noteResyncNeeded('queue-overflow', message);
  client.requestResync(); // 加入方：要档案；房主侧这条返回 false（会话层/角色会挡）
  client.sync();
  rerender();
}

/**
 * ★★ **房主侧的重连凭据**（D8：主机内存里的当前 `MatchFile`）—— `resyncSource` 的唯一内容来源。
 *
 * 返回 `null` = 本端此刻没有可发的档案（还没有联机对局 ⇒ 会话层回 `'resync-not-wired'`，
 * **fail-closed**，绝不编一份空档案出去）。
 *
 * 档案里的 `setup` 用 `setupFromState(state)`（草稿两条顺序快照的唯一抽取点，T4 第 11 条），
 * `seed` 用本局的种子；`createdAt` 由 UI 层读时钟（`src/app` 不许读时钟）。
 */
function netFileOf(): MatchFile | null {
  const g = netGame;
  if (g === null) return null;
  return g.recorder.toMatchFile(matchFileMeta(state));
}

/**
 * ★★ **把档案真的应用出来**（`onResyncRes` 的唯一实现；T13-B 判据 1 与 3 的落点）。
 *
 * ## 三步，顺序写死
 *
 *  1. **先判"这是落后还是分叉"**：本端已经应用了 `local` 步、而档案只有 `n` 步。
 *     `local > n` ⇒ 本端比权威档案**还多走了** —— 那是**分叉**（D1 的代价：信任制下不能修），
 *     不许拿档案把本端已有的进度**静默覆盖**（判据 3）。给可读失败并**不动任何状态**。
 *  2. **重建**：`stateAtStep(file, file.actions.length)`（D9 的单一出处；起点是
 *     `stateAfterDraft(file)`，与重放页/生产起点逐字一致 —— §9 第 19 条那条教训）。
 *  3. **对齐驱动的进度事实**：`realign(n)` + `arm(state)`。少了这一步就是
 *     `net-driver.ts:263-270` 写的那个形状："会话层把 `needsResync` 清成 false、相位也放回去了，
 *     但驱动这一侧之后每一条入站 `act` 都继续 `seq-mismatch`"。
 *
 * 返回**应用了几步**（= 档案长度），会话层拿它与档案长度核对（那一步才是 `applyResyncFile`）；
 * 返回 `null` = 拒绝（原因已经写进屏上的可读提示）。
 */
function applyResyncToGame(file: MatchFile): number | null {
  const client = lobbyClient;
  const g = netGame;
  if (g === null) return null;
  const n = file.actions.length;
  const local = g.driver.appliedSteps();
  if (local > n) {
    // 两端都动过、而且本端比档案还多 ⇒ 分叉，不是落后（判据 3：给可读失败，不许静默覆盖）
    client?.showNotice(
      `追平失败：本端已经走到第 ${local} 步，而对方的档案只有 ${n} 步 —— `
      + '这说明两端各自走过不同的操作（分叉）。本端状态一个字都没动：'
      + '覆盖它只会把分叉藏起来，而这一局已经不可能与对方一致了，请结束这一局并如实记录。',
    );
    return null;
  }
  let rebuilt: GameState;
  try {
    rebuilt = stateAtStep(file, n);
  } catch (e) {
    client?.showNotice(`追平失败：用对方的档案重放不出状态（${e instanceof Error ? e.message : String(e)}）；本端状态没动。`);
    return null;
  }
  state = rebuilt;
  g.driver.realign(n);
  g.driver.arm(state);
  if (probeOn) armedState = state;
  client?.showNotice(null);
  return n;
}

/**
 * ★★ **重连之后把驱动换到新传输上**（G5 T13-A/B）—— 实现已经并进 `enterNetGame()`
 * （见那里 `existing !== null` 那一支：`createNetDriver(` 在 `src/main.ts` 里只许有一处，
 * 两个入口会让"驱动是拿哪条传输造的"分叉）。
 */

/**
 * ★★ **牌桌上那一行可读的连接状态**（本轮必需：掉线/追平的观感不许只有"对面好像卡住了"）。
 *
 * 文案本体**只有一处**：`lobbyLinkText(peerStatus)`（`src/ui/net-lobby.ts` 那张映射表 +
 * `needsResyncDetail`）。这里不写第二句、也不自己判"超窗了没有"—— 三值判定归会话层，
 * 播放哪一句归映射表。掉线期间玩家看到的因此是"对端现在不在线（链路断了）…"，
 * 追平时是"对端带着同一个会话回来了…"。
 */
function netLinkLine(): string | null {
  const g = netGame;
  /**
   * 两个来源，一个读数：进了牌桌读**本局会话**的 `peerStatus()`，还没进牌桌（握手/硬币屏）
   * 读**大厅客户端**那一份（`state().peer`）—— 后者正是"掉线那一刻玩家看到的那一行"的来源。
   */
  const st = g !== null ? g.session.peerStatus() : (lobbyClient?.state().peer ?? null);
  if (st === null || st.online) return null; // 一切正常 ⇒ 不占屏
  return lobbyLinkText(st);
}

/**
 * ★★ **G5 T14：联机对局里"轮到谁"的那一行**（本阶段第 2 件事）。
 *
 * ## 为什么必须有它（`render.ts` 那条横幅今天不够）
 *
 * `renderDraft` 的醒目横幅写的是**座位号**（`玩家 ${activePlayer + 1}`，`render.ts:4925-4936`），
 * 而联机下玩家在自己那一页永远读到"玩家 1 / 玩家 2"，对不上"我 / 对方"。`render.ts` 是红线
 * 文件（G5 §2 第 10 条）⇒ 这一行由**应用层**在渲染之后补画（与 `netLinkLine()` 那一行同族）。
 *
 * ## 取值**同源**（端上没有第二套"谁该动"）
 *
 *  - "轮到谁"：草稿相读 `getCurrentDrafter(state)`、对局相读 `state.turnPlayer`
 *    —— 正是 T12 的 `cb.onDraftPick` 与 `net-driver` 的 `liveTurn` 用的那两个读数；
 *  - "我是谁"：`netGame.selfSeat`（喂给 `createNetDriver` 的同一个数，`__g5Match.seat()` 也读它）。
 *
 * 文案与产 DOM 都在 `src/ui/net-lobby.ts` 的 `netTurnText()` / `appendNetTurnLine()`
 * （住那边是为了能上真渲染器腿：`tests/**` import 不了本文件）。
 */
function appendTurnLine(root: HTMLElement): void {
  const g = netGame;
  if (g === null) return; // 不是联机局 ⇒ 不画（热座/重放页一个字都不变）
  appendNetTurnLine(
    root, state.phase, state.turnPlayer, g.selfSeat, getCurrentDrafter(state), state.draftRound,
  );
}

/**
 * ★ 跨端状态指纹的**读取口**（真浏览器门 `tools/browser-truth-lobby-cdp.mjs` 用它）。
 *
 * ## 为什么要有它，以及为什么它只能是"只读的一根函数"
 *
 * 判据 1/3 要比的是**两端的对局状态**，而 `main.ts` 是应用入口、node 里跑不起来
 * （见 `tests/ui/main-lobby-wiring.test.ts` 头注）⇒ 唯一能读到它的是真浏览器里的 CDP。
 * 所以这里挂一个**只读**的全局口：`state()` 返回 `stableStringify(state)`（与
 * `stateFingerprint` 的序列化那一半**同一份实现**）、再加三个派生读数
 * （种子 / 先选者 / 选到第几个）。
 *
 * ## 为什么跟着 `#g5probe=1` 走（而 `data-net-phase` / `__coinInputs` 是无条件的）
 *
 * 那两样是**小读数**（一个短语 / 四个数），挂上去不花钱；这一样是**整份状态的规范串**
 * （含整局 log，几万字符）。每次重画都序列化一遍是纯开销，而它只服务门禁与排查
 * ⇒ 用一个显式的查询片段把它打开，默认路径一个字节都不多算。工具在驱动到界面之前
 * 用 `Page.navigate` 加上这一段即可。
 *
 * 三条纪律：
 *  1. **只读**：它不改任何状态、不驱动任何流程（工具拿到串之后自己比）；
 *  2. **不是第二个真相源**：串就是 `state` 本身，没有"另算一份摘要"；
 *  3. **不参与屏上任何一格**：与 `data-net-phase` 同族（排查与门禁用）。
 */
/**
 * ★ 门禁探针的两个计数器（只给 `advanceOnce()` 的读数用，默认路径零开销）：
 * `advanceProbeCalled` = 门禁调了几次 `advanceOnce()`；`advanceProbeActions` = 其中真的
 * 走到了 `cb.onAction` 的有几次。两者分开是为了分辨"编排早退"与"提交被拒"。
 */
let advanceProbeCalled = 0;
let advanceProbeActions = 0;

/**
 * ★★ **T12 门禁的"变化来自线上"计数器**（判定集 ③.7 用；默认路径零开销）。
 *
 * ## 为什么必须是**真的收到帧**的计数（不能拿 `appliedSteps` 代替）
 *
 * ③.7 要证的是"B 端的盘面变化**来自线上的那一帧**，不是它自己算的"。`drive().applied`
 * 在这个场景里**几乎等价**，但它证明不了"线"：任何一条能让本端应用一步的路径（自动推进、
 * 本地提交、重放闸门）都会让它涨。而这个计数只挂在
 * `netGame.driver.transport.onMessage` 上 —— **只有真的从传输收到帧**才会 +1。
 * 两个一起看才有牙：`applied` 涨 + `act` 帧计数涨 + 对端没被任何人点过。
 *
 * ## 它记的是什么（三条边界，别读多）
 *
 *  - 记的是**本端驱动所订阅的那条传输**上交来的帧（`NetDriver.transport`），不区分通道；
 *  - `act` 那一格只数**操作帧**（`t === 'act'`），握手/心跳/承诺那些不算 —— 否则"硬币屏
 *    那几帧"会把读数提前推高，这一格就分不清"草稿那一帧到底来没来"；
 *  - `last` 存**原文**（截断到 400 字，够看清 `kind` 与 `seq`），给排查用，不参与判定。
 *
 * 它与 `advanceProbe*` 同族：只在 `#g5probe=1` 时才有读数（`exposeMatchProbe` 会把它挂到
 * `__g5Match.netFrames()`），平时一个字节都不多算。
 */
interface NetFrameCounter {
  act: number;
  last: string | null;
  /** `transport.onMessage` 的退订函数（`enterNetGame` 每次接线时覆盖） */
  off: (() => void) | null;
}
let netFrameCounterIn: NetFrameCounter = { act: 0, last: null, off: null };

/**
 * ★ **最近一次草稿提交的结果**（`#g5probe=1` 才挂出去，见 `exposeMatchProbe` 的
 * `lastDraftSubmit()`）。它只服务排查：`cb.onDraftPick` 每次提交都写一遍，包括被拒的那几次。
 */
let lastDraftSubmit: {
  ok: boolean;
  refusal: string | null;
  player: number;
  phase: string;
  round: number;
  turn: number;
} | null = null;

/**
 * `#g5probe=1` 开过没有（`exposeMatchProbe()` 会置真）。
 *
 * 存在的理由只有一个：让"门禁专用"的那几个记账位在**默认路径上一次都不写**
 * （`lastDraftSubmit` 是每步草稿都写的一个小对象 —— 不贵，但默认路径本就不该为门禁付钱，
 * 这与 `state()` 那个"整份规范串只跟着查询片段走"的取舍同族）。
 */
let probeOn = false;

/**
 * 给驱动**刚拿到的那条传输**挂一个只读的入站帧计数（幂等：先退订旧的）。
 *
 * ⚠️ 订阅顺序（`enterNetGame` 里调用的位置）：排在 `createNetDriver(...)` **之后**。
 * 驱动自己也在构造时订阅了同一条传输，而"谁先被回调"**不影响本计数器的正确性** ——
 * 它数的是"帧到过本端"，不是"帧到过驱动之后"。
 */
function watchInboundFrames(d: NetDriver): void {
  netFrameCounterIn.off?.();
  netFrameCounterIn = { act: 0, last: null, off: null };
  const counter = netFrameCounterIn;
  counter.off = d.transport.onMessage((text) => {
    let kind: unknown = null;
    try {
      kind = (JSON.parse(text) as { t?: unknown }).t;
    } catch {
      kind = 'undecodable';
    }
    if (kind !== 'act') return;
    counter.act += 1;
    counter.last = text.length > 400 ? `${text.slice(0, 400)}…（共 ${text.length} 字）` : text;
  });
}

function exposeMatchProbe(): void {
  if (!window.location.hash.includes('g5probe=1')) return;
  probeOn = true;
  /**
   * ★ `__g5Handoff` 只是一个**存在性标志**（值之后由 `enterNetGame()` 覆盖）：
   * 它让 `enterNetGame()` 能在**不 import 任何调试模块**的前提下知道"这个页面开了探针"。
   * 值本身是那一段读数（`handoff()` 的结果 + 真正喂进 `createGame` 的 `seed` / `draftStarter`），
   * 供门禁比"先选者对不对"（跨端相等比不出"两端一致地算错"）。
   */
  (globalThis as { __g5Handoff?: unknown }).__g5Handoff = null;
  const g = globalThis as {
    __g5Match?: {
      state(): string;
      seed(): string;
      draftStarter(): number;
      draftRound(): number;
      seat(): number;
      /** 本机从**线上**收到过几帧 `act`、最后一帧原文是什么（G5 T12；判定集 ③.7 用它证"变化来自线"） */
      netFrames(): { act: number; last: string | null };
      /** 最近一次**草稿**提交的结果（只给门禁排查用：`ok` / 拒码 + 当时的几个读数） */
      lastDraftSubmit(): { ok: boolean; refusal: string | null; player: number; phase: string; round: number; turn: number } | null;
      finishDraft(): { steps: number; state: string };
      rebootDraft(): { steps: number; state: string };
      /** 对局相那一小撮读数（`main.ts` 的自动推进只碰这几样；门禁读它不必解析整串） */
      turn(): { phase: string; step: string; turnPlayer: number; winner: number | null; transitioning: boolean };
      /** 驱动侧读数（只给门禁排查用）：应用步数 / 队列里还压着几帧 / 最近一次失败 */
      drive(): { applied: number; pending: number; failure: string | null };
      /** 关掉本机自动推进（见 `autoAdvanceOff`）；返回关掉之前的状态 */
      noAutoAdvance(): boolean;
      /** 设/读自动推进开关（门禁要在"等它推进"与"关掉它"之间来回切） */
      setAutoAdvance(on: boolean): boolean;
      autoAdvanceOff(): boolean;
      /** 走一步本机的非玩家输入步骤（门禁专用；走的是**真的**那条编排） */
      advanceOnce(): { ok: boolean; why: string; op: number; seat: number; turnPlayer: number; failure?: string | null; actions: number; submit: string; called: number };
      /**
       * ★★ **G5 T13-A：重发链的只读读数**（门禁的"卡在半路的那条消息真的被重发"靠它）。
       *
       *  - `redriven`：本端链路上"按相位重发在途消息"**真的发出去了**几次（`LobbyClient.redrivenCount()`）；
       *  - `phase`：会话层此刻的相位（没有链路时 `'idle'`）；
       *  - `link`：传输状态；`needsResync` / `suppressCoin`：重连链路的两个读数。
       */
      netLink(): { redriven: number; phase: string; link: string; needsResync: boolean; suppressCoin: boolean };
      /**
       * ★★ **G5 T14 修复轮：入站帧四环的只读读数**（定位"收到帧却不重画"用；见实现上的说明）。
       */
      diag(): {
        linkIn: number;
        driverAct: number;
        linkIsDriverTransport: boolean;
        hasLinkTransport: boolean;
        hasDriverTransport: boolean;
        linkPhase: string;
        driverSeat: number;
        /** ★★ G5 T21：渲染器吃到的视角座位（`renderNetBoard` 的 `opts.viewSeat`，即 `netViewSeat`） */
        netViewSeat: number;
        rerenderIn: number;
        rerenderPainted: number;
        onInboundCalls: number;
        netGameNullAtInbound: number;
        lastRerenderBranch: string;
        enqueuedCount: number;
        inboundSeq: number;
        inboundProbe: {
          pendingBefore: number | null;
          pendingAfter: number | null;
          pendingLater: number | null;
          enqueuedBefore: number | null;
          enqueuedLater: number | null;
          landed: number | null;
          at: number;
        };
        legalKinds: { total: number; counts: Record<string, number> };
        handCounts: number[];
        renderAppCalls: number;
        renderNetBoardCalls: number;
        renderNetPainted: number;
        stateRead: { draftRound: number; step: string; turnPlayer: number };
        armedRead: { draftRound: number; step: string; turnPlayer: number } | null;
        inboundStaleDropped: number;
        /** ★★ G5 T19：硬币阶段这一刻在哪一格（`null` = 读数还没齐 / 没起头） */
        coinPhase: 'call' | 'toss' | 'settled' | null;
        /** ★★ G5 T19：`'call'`（告知"谁叫了哪一面"）那一格的起跑时刻 */
        coinCallStartedAt: number | null;
        /** ★★ G5 T19：`'toss'`（抛硬币动画）那一格的起跑时刻；与上一格之差 = 告知停了多久 */
        coinTossStartedAt: number | null;
        /** ★★ G5 T19：`'settled'`（结论行）那一格的起跑时刻；这一格必须停够才进牌桌 */
        coinSettledStartedAt: number | null;
        /** ★★ G5 T19：到点叫醒的回调抛过几次异常（见 `wakeCoinPhase` 的兜底） */
        coinWakeThrew: number;
        /** ★★ G5 T19 修复轮 2：排过几次**已经到点**的唤醒（正常路径恒 0；> 0 = 自唤醒链回来了） */
        coinWakeStaleScheduled: number;
        /** ★★ G5 T19 修复轮 2：排过的唤醒总数（含重试） */
        coinWakeScheduled: number;
        /** ★★ G5 T19：这一局的草稿 → 对局转场播过几次（两端各自数自己那一个） */
        transitionPlayed: number;
        renderMode: string;
        phase: string;
      };
    };
  };
  g.__g5Match = {
    state: () => stableStringify(state),
    seed: () => state.rng.seed,
    draftStarter: () => state.draftStarter,
    draftRound: () => state.draftRound,
    /** 本端座位：**驱动自己那个只读字段**（`NetDriver.seat`）；没有驱动时 `-1` */
    seat: () => (netGame === null ? -1 : netGame.driver.seat),
    /**
     * ★ **本机从线上收到过几帧 `act` / 最后一帧原文**（G5 T12 加；判定集 ③.7 的"变化来自线"）。
     *
     * 它只读上面那个 `netFrameCounterIn`（挂在 `netGame.driver.transport.onMessage` 上），
     * 不改任何状态、不驱动任何流程。没有联机局时给 `{ act: 0, last: null }`。
     */
    netFrames: () => ({ act: netFrameCounterIn.act, last: netFrameCounterIn.last }),
    /**
     * ★★ **G5 T13-A：重发链的只读读数**（真浏览器门用；不驱动任何流程）。
     * 见 `__g5Match` 类型上那一段：`redriven` 是"真的重发出去过几次"，不是"恢复过几次"。
     */
    netLink: () => ({
      redriven: lobbyClient?.redrivenCount() ?? -1,
      phase: lobbyClient?.phase() ?? 'idle',
      link: lobbyClient?.state().transport ?? 'idle',
      needsResync: lobbyClient?.state().peer?.needsResync ?? false,
      suppressCoin: lobbyClient?.suppressesCoinScreen() ?? false,
    }),
    /**
     * ★★ **G5 T14 修复轮：把"入站帧到没到、会话链接没接到"这四环各自数出来**（只读）。
     *
     * ## 为什么必须有它（本轮实测的形态）
     *
     * 真鼠标场景里，**收到帧的那一页此后不再重画**（`#app` 清空后 5 秒仍是空的），
     * 而两端盘面却逐字相同。四种"看起来一样"的原因必须分开：
     *  1. 帧根本没到那一页（传输层）；
     *  2. 帧到了、但**大厅那条会话链**没接到（`LobbySessionLink.receive`）⇒ `onInbound` 不会被调；
     *  3. 接到了、`onInbound` 也调了，但宿主那一句没跑；
     *  4. 跑了 `rerender()`，而重画本身失败。
     *
     * `linkIsDriver` 就是为第 2 条准备的：`true` 表示**大厅那条链用的传输**与
     * **驱动用的传输是同一个对象**（`identical` 是同一个判断的布尔形式，便于工具直接比）。
     * 两者不同 = "帧到了驱动、会话链却挂在另一条传输上"这个形态。
     */
    diag: () => {
      const linkT = lobbyClient === null ? null : lobbyClient.transport();
      const drvT = netGame === null ? null : netGame.driver.transport;
      return {
        /** 大厅会话链收到的帧数（`LobbySessionLink` 的 `inCount`，唯一来源） */
        linkIn: lobbyClient?.state().routedIn ?? -1,
        /** 驱动那条传输上收到的 `act` 帧数 */
        driverAct: netFrameCounterIn.act,
        /**
         * 大厅链的传输与驱动的传输**是不是同一个对象**（第 2 条的那个判据）。
         * `false` = "帧到了驱动、会话链却挂在另一条传输上"。
         */
        linkIsDriverTransport: linkT !== null && drvT !== null && linkT === drvT,
        /** 两个传输各自的就绪情况（`null` = 那一侧还没有传输） */
        hasLinkTransport: linkT !== null,
        hasDriverTransport: drvT !== null,
        linkPhase: lobbyClient?.state().phase ?? 'idle',
        driverSeat: netGame === null ? -1 : netGame.driver.seat,
        netViewSeat,
        /** `rerender()` 被进入过几次 / 真的走到"去画"那一步几次 / `onInbound` 通知过几次 */
        rerenderIn,
        rerenderPainted,
        onInboundCalls,
        netGameNullAtInbound,
        lastRerenderBranch,
        enqueuedCount: netGame === null ? -1 : netGame.driver.enqueuedCount(),
        inboundSeq,
        inboundProbe: { ...inboundProbe },
        /**
         * ★ G5 T14 只读实验（"对局相拖牌不亮落点"责任方判定）：本回合到底能做什么。
         *
         * 它答的是"产品给不给得出 `play`"这一半 —— 与屏上 `.stack-slot.interactable`
         * （渲染器按 `getLegalActions` + 选中卡算出来的可交互面）一起读，就能把
         * "产品不给合法 play"（引擎侧）与"给了但屏不亮"（渲染侧）分开。
         */
        legalKinds: (() => {
          const ls = state.phase === 'gameover' ? [] : getLegalActions(state, state.turnPlayer);
          const counts: Record<string, number> = {};
          for (const a of ls) counts[String(a.kind)] = (counts[String(a.kind)] ?? 0) + 1;
          return { total: ls.length, counts };
        })(),
        handCounts: [state.players[0].hand.length, state.players[1].hand.length],
        renderAppCalls,
        renderNetBoardCalls,
        renderNetPainted,
        /**
         * ★★ **G5 T14：两枚状态对象各自的读数**。
         *
         * `stateRead` = 模块级 `state`（渲染器与探针读的那一枚）的三个读数；
         * `armedRead` = 驱动 `arm()` 那一枚的三个读数（`null` = 还没 arm 过）。
         * 两者**值不同**就说明"屏与驱动不是同一个时刻"。
         *
         * ⚠️ 评审两次点名删掉的四格**没牙**读数（`stateGen` 只声明从不自增、
         * `renderedIsAppState` 恒真、`appStateMismatch` 近乎恒 0、`sameObject` **恒真**）——
         * 它们没有腿、只会在下一次误导读者，**已全部删除**（模块态那一段也同步改了口径）。
         */
        stateRead: { draftRound: state.draftRound, step: String(state.step), turnPlayer: state.turnPlayer },
        armedRead: armedState === null ? null : {
          draftRound: armedState.draftRound, step: String(armedState.step), turnPlayer: armedState.turnPlayer,
        },
        /** ★ 判据 1 的护栏读数：微任务里"捕获的那一枚已经不是当前 state"丢掉过几次 */
        inboundStaleDropped,
        /**
         * ★★ **G5 T19 的只读读数**（硬币阶段的顺序 / 转场两端各播一次）。
         *
         * 五个数分开答四件事，缺一个就分不清"没播"与"播了但看不出来"：
         *  - `coinPhase`：这一端硬币阶段此刻在哪一格（`null`/`call`/`toss`/`settled`）；
         *  - `coinCallStartedAt` / `coinTossStartedAt`：两格的起跑时刻（`performance.now()`；
         *    `null` = 还没到过）。两者之差就是"告知那一格"停了多久，而
         *    `COIN_TOSS_MS` 是动画本身的长度 ⇒ 门禁不必去读屏就能判"动画真的走了那么久"；
         *  - `transitionPlayed`：这一局的草稿 → 对局转场**播过几次**（两端各自数自己的；
         *    同一次转变只该 +1 —— 收到对端帧不会让它变成 2）。
         */
        coinPhase,
        coinCallStartedAt,
        coinTossStartedAt,
        coinSettledStartedAt,
        /** ★ G5 T19 修复轮：到点叫醒时回调抛过异常几次（> 0 = 那条腿真的兜过一次底） */
        coinWakeThrew,
        /**
         * ★★ **G5 T19 修复轮 2：自唤醒链的证伪位**（正常路径必须恒 0）。
         *
         * `coinWakeStaleScheduled > 0` = "排了一个已经到点的唤醒" ⇒ 那条 0ms 自唤醒链回来了
         * （修复轮 1 的缺陷形态）；`coinWakeScheduled` 是分母（排过多少次），两个一起读才分得清
         * "没在排"与"排了但都没过期"。
         */
        coinWakeStaleScheduled,
        coinWakeScheduled,
        transitionPlayed,
        /** 这一刻的路由读数（两个 early return 分支要配它读） */
        renderMode,
        phase: state.phase,
      };
    },
    /**
     * ★ **最近一次草稿提交的结果**（G5 T12 门禁排查用；只读，不参与任何流程）。
     *
     * 为什么需要一个"记账位"而不是只看状态：拖拽没生效可能是**四种**原因（拖拽没到回调 /
     * 回调到了但 `driver.submit` 拒了 / 引擎的草稿原语抛了 / 提交成功但帧没出去），
     * 而这四种在状态指纹上**长得一模一样**（都是一动不动）。记下"提交过没有 + 拒码 +
     * 提交那一刻的三个读数"，现场就能一眼分开它们。
     */
    lastDraftSubmit: () => lastDraftSubmit,
    /**
     * ★ **把本机的草稿按规则走完**（排查与门禁用；走的是**真的那个回调**）。
     *
     * 与 `rebootDraft()` 的差别很要紧：本方法**不重开对局、不动驱动、不碰传输** ——
     * 它只是在当前这一局上把剩下的草稿选完（每一轮取"当前可选池里第一个还没被选的"）。
     *
     * ## ★★ T12 起它**只走本端的回合**（这条改动是必须的，不是收紧）
     *
     * 草稿选牌从 T12 起走驱动（`cb.onDraftPick` → `driver.submit` → `act` 帧）。而驱动的
     * 轮次闸只认"当前轮选者是本端座位"（`net-driver.ts` 的 `liveTurn` 草稿分支）⇒ 在
     * **不是**本端回合的那些轮次上提交会被拒（`'not-the-next-action'`，状态一字不动）。
     * 旧版本这里会因此**空转一圈就退**（`state.phase` 仍是 `'draft'`、`n` 只涨了本端那几步），
     * 于是"两端各自走完草稿"变成"谁也没走完"。
     *
     * 现在的语义：**逐轮只由轮选者那一侧提交**，另一侧靠**收到的那一帧**往前走
     * （那正是 T12 要证的事）。所以调用方（门禁 ③.8）要在两端**交替**调本方法、直到两端都
     * 到 `draftRound >= 6` —— 每一轮谁是轮选者由 `draftRoundOwner` 决定，两端一致。
     *
     * 为什么不用 `rebootDraft()` 来"回到起点"（实测踩过，值得写下来）：那个方法会
     * `driver.dispose()`，而 `dispose()` 会 **`transport.close()`**（`src/net/net-driver.ts:784`）
     * ⇒ 握手那条链路被关掉 ⇒ 之后**所有** `submit` 都拿到 `'offline'`
     * （实测：`submit ok=false refusal=offline`，而 `lastFailure()` 是 `null` —— 那条路
     * **不上报失败**，看起来像"驱动坏了"）。
     */
    finishDraft: () => {
      let n = 0;
      while (state.phase === 'draft') {
        // 不是本端回合就**停手**（那一轮由对端提交、本端等帧）。判据与驱动用的是同一个
        // `getCurrentDrafter`（同一个 `draftRoundOwner`）⇒ 不存在"两边都以为轮到自己"。
        if (netGame !== null && getCurrentDrafter(state) !== netGame.driver.seat) break;
        const avail = getDraftPool(state);
        if (avail.length === 0) break;
        cb.onDraftPick(avail[0].defId);
        n += 1;
      }
      return { steps: n, state: stableStringify(state) };
    },
    /**
     * ★ **重开同一局，再把草稿走完**（**只给排查用**）。
     *
     * ⚠️⚠️ **它会关掉握手那条传输**（`driver.dispose()` → `transport.close()`，
     * `src/net/net-driver.ts:784`）⇒ 调用之后这一局**再也没有线上通道**（所有 `submit`
     * 返回 `'offline'`，而 `lastFailure()` 是 `null` ⇒ 不报错的失效）。
     * ⇒ 需要"重来一局再走线上"时请用 `finishDraft()`。
     *
     * 这一条是评审登记的实现缺陷"漏 dispose"的修法带来的**新认识**：补上 dispose 是对的
     * （不补会泄漏订阅），但补上之后它就不再是"无副作用的重开"了。
     */
    rebootDraft: () => {
      if (netGame === null) return { steps: -1, state: '' };
      netGame.driver.dispose(); // ★ 先退旧驱动的两条订阅（它同时会关掉传输，见上）
      netGame = null; // 置空之后 `enterNetGame()` 就是"第一次进牌桌"那条路（幂等闸放行）
      const d = enterNetGame();
      // ★ 座位在**这里**读一次并留在局部：`enterNetGame()` 之后 TS 的控制流分析仍把 `netGame`
      //   当成 `null`（它不追被调函数里的赋值）⇒ 循环里再读 `netGame.driver` 会被判成 `never`。
      //   而这个数在整段循环里确实不变（本方法刚重建的那个驱动就是这一局的驱动）。
      const seatAfterReboot = d === null ? -1 : d.seat;
      let n = 0;
      while (state.phase === 'draft') {
        // ★ T12：与 `finishDraft()` 同款守卫 —— 只走本端回合那一格（否则驱动会拒掉
        //   非本端的提交，而这一圈会**永远转下去**：状态不动、循环条件恒真）。
        //   它在本方法里其实**必然早退**（上面那句 `dispose()` 关掉了传输 ⇒ 所有 submit 都是
        //   `'offline'`）—— 留着是为了"万一哪天传输又活了"，也不想让这条排查路径变成死循环。
        if (seatAfterReboot >= 0 && getCurrentDrafter(state) !== seatAfterReboot) break;
        const avail = getDraftPool(state);
        if (avail.length === 0) break;
        cb.onDraftPick(avail[0].defId);
        n += 1;
      }
      return { steps: n, state: stableStringify(state) };
    },
    /**
     * ★ **对局相那一小撮读数**（`phase` / `step` / `turnPlayer` / `winner`）。
     *
     * 为什么单开一个口而不是让工具去 `JSON.parse(state())`：那份规范串有几万字符，
     * 为了读四个数解析一遍既慢又脆（`state()` 里含整局 `log`，还有挂起效果的
     * `gen` 会被序列化成 `{}`）。这四个数是门禁判"该谁动 / 到哪一步了"唯一的输入。
     */
    turn: () => ({
      phase: state.phase, step: state.step, turnPlayer: state.turnPlayer, winner: state.winner,
      /**
       * ★ **草稿→对局的过渡还在不在飞**（`transitioning`）。自动推进在过渡期间**不排**
       * （`runAutoAdvance` / `scheduleAutoAdvance` 的守卫），而 `advanceOnce()` 走的是同一条
       * 编排 ⇒ 门禁必须能看见它 —— 实测踩过：`rebootDraft()` 会重新触发一次过渡，
       * 门禁抢在那 4.5s+ 窗口里调 `advanceOnce()`，`applied` 一直是 0、看起来像"驱动坏了"。
       */
      transitioning,
      /**
       * ★★ **G5 T19 修复轮：硬币阶段三段各自的停留毫秒 + 结果行在屏上停了多久**（只读）。
       *
       * ## 为什么把这三个数挂进 `turn()`（一个既有读数口）而不是新开一个
       *
       * 硬币阶段没有自己的探针口，而"三段真的各停够"这件事**在门禁侧原来无读数可核**
       * （评审 §6：`transitionPlayed` 与三个常量"只在源码里可核"）。挂进 `turn()` 之后，
       * 门禁已经会打印 `turn()`（③.9 的 `stepOf`）⇒ 报告里能贴**实测**数字，
       * 而不是"源码自洽"。数值都在本端算（`performance.now()` 差值），没有跨端可比性要求。
       *
       * 字段名与语义：
       *  - `callHoldMs` / `tossHoldMs` / `settledHoldMs`：三段各自的实测停留（`null` = 还没走到）；
       *  - `settledAgoMs`：**结论行还在屏上多久了**（这证实"结果行看得见"—— 第一版它是
       *    同步一帧就被草稿屏盖掉，这个数根本量不到）；
       *  - `holdsOk`：三段是否都达到设计下限（`COIN_CALL_HOLD_MS` / 动画时长 / `COIN_SETTLED_HOLD_MS`）；
       *  - `reducedMotion`：这一局动画那一格有没有被动态偏好压缩。
       */
      coinTiming: (() => {
        const d = (a: number | null, b: number | null): number | null =>
          a === null || b === null ? null : Math.round(b - a);
        const callHoldMs = d(coinCallStartedAt, coinTossStartedAt);
        const tossHoldMs = d(coinTossStartedAt, coinSettledStartedAt);
        const settledHoldMs = coinSettledStartedAt === null || coinPhase !== 'settled'
          ? null
          : Math.round(performance.now() - coinSettledStartedAt);
        return {
          coinPhase,
          callHoldMs,
          tossHoldMs,
          settledHoldMs,
          settledAgoMs: settledHoldMs,
          holdsOk: callHoldMs !== null && tossHoldMs !== null
            && callHoldMs >= COIN_CALL_HOLD_MS - 5
            && tossHoldMs >= coinTossHoldMs() - 5
            && settledHoldMs !== null && settledHoldMs >= COIN_SETTLED_HOLD_MS - 5,
          reducedMotion: reducedMotion(),
          /**
           * ★★ **G5 T19 修复轮 2：自唤醒链的证伪位**（见 `coinWakeStaleScheduled` 的说明）。
           * 进牌桌之后这一位必须恒 0；`wakes` 是分母。
           */
          staleWakes: coinWakeStaleScheduled,
          wakes: coinWakeScheduled,
        };
      })(),
    }),
    /**
     * ★ **驱动侧读数**（`appliedSteps` / `pendingCount` / `lastFailure`）。
     *
     * 为什么要有它：判"这一步真的走驱动了吗"不能只看状态指纹变没变 —— 状态也可能被
     * **本机的自动推进**（`runAutoAdvance` → `cb.onAction` → `submit`）改动。
     * 有了这三个数，门禁能分清"对端那一帧落了地"（`applied` 加一）与"两端各自本地推了一格"。
     */
    drive: () => {
      const d = netGame?.driver ?? null;
      if (d === null) return { applied: -1, pending: -1, failure: null };
      const f = d.lastFailure();
      return { applied: d.appliedSteps(), pending: d.pendingCount(), failure: f === null ? null : `${f.reason}: ${f.message}` };
    },
    /**
     * ★★ **关掉本机的自动推进**（门禁专用；评审要求"把等价性判据改成不靠自动推进"）。
     *
     * 为什么必须有它：③.9 原来只在"对端跟上了"这一层比指纹，而两端**各自**每 400ms 会
     * `cb.onAction({kind:'advance'})` 自行推进一格 ⇒ 即使一端的动作根本没送到对端，
     * 对端的指纹也会自己走到同一个地方（评审实测 M2-wiring：**33/33 全绿**）。
     * 关掉它之后，"对端的状态变了"就**只可能**来自收到的那一帧。
     *
     * 语义：只关掉 `scheduleAutoAdvance` 这一条本地时序（`autoAdvanceOff` 一个布尔），
     * **不动**驱动、不动玩家输入（点牌仍然会 `submit`）；它是门禁的开关，不是游戏规则。
     */
    noAutoAdvance: () => {
      const before = autoAdvanceOff;
      autoAdvanceOff = true;
      // 与 `setAutoAdvance(false)` 同一件事（那里有全部理由）：**已排上的那一次也要取消**。
      if (autoTimer !== null) {
        window.clearTimeout(autoTimer);
        autoTimer = null;
      }
      return before;
    },
    /**
     * ★ **设/读自动推进开关**（门禁要来回切：③.9 先靠它把"轮到的那一位"推到行动步、再关掉它
     * 让"对端跟上"承重）。返回**设置之前**的状态（与 `noAutoAdvance()` 同款，便于门禁记账）。
     *
     * ## 关闭时必须**连带清掉已经排上的那个定时器**（评审 R2 §8 遗留 3）
     *
     * `scheduleAutoAdvance()` 只在**排程时**看这个开关 —— 它拦的是"之后不再排"，而**已经挂上**的
     * 那个 400ms 定时器照样会到点、照样会调 `runAutoAdvance()`。于是"关了"并不等于"真不跑了"：
     * ③.9 判"对端有没有自己动"时，那一次残留的自动推进就是一个**自证窗口**（8 跑没观察到污染，
     * 但窗口在）。两道一起上：
     *  1. 这里 `clearTimeout(autoTimer)` —— 把**已经排上的那一次**取消；
     *  2. `runAutoAdvance()` 自己也读这个开关（见那里的第一句）—— 兜住"回调已经在飞 / 别处还会
     *     调它"的边角。两条都是必要的：只有 1 挡不住"其它路径直呼 runAutoAdvance"，
     *     只有 2 挡不住"定时器白跑一次再早退"（虽然无害，但那不是"关了就不跑"）。
     */
    setAutoAdvance: (on: boolean) => {
      const before = autoAdvanceOff;
      autoAdvanceOff = !on;
      if (autoAdvanceOff && autoTimer !== null) {
        window.clearTimeout(autoTimer);
        autoTimer = null;
      }
      return before;
    },
    /**
     * ★★ **走一步本机的非玩家输入步骤**（门禁专用）。
     *
     * 为什么需要它（评审阻断项 3 的第二条）：③.9 要证的是"一端的动作**靠那一帧**到达另一端"，
     * 而自动推进（400ms）会自己把两端的状态推到同一个地方 ⇒ 那一格原来**不承重**
     * （评审实测 M2-wiring 在旧判据下 33/33 全绿）。把它关掉之后，门禁就没有"把这一局往前推"
     * 的手段了 —— 本方法补上这一步，而且**走的是同一条真编排**：
     * `runAutoAdvance()`（与自动推进调的**同一个函数**）→ `cb.onAction` → `driver.submit`。
     * 于是"提交"这件事仍然经过驱动（座位与轮次的闸门都在），只是由门禁按步调、而不是计时器。
     */
    advanceOnce: () => {
      advanceProbeCalled += 1;
      const why = (): string => {
        if (state.phase !== 'turn') return `not-turn(${state.phase})`;
        if (state.step === 'action') return 'at-action';
        if (transitioning) return 'transitioning';
        if (state.pendingEffects.length > 0) return 'pending-effects';
        if (state.pendingPlay.length > 0) return 'pending-play';
        if (state.pendingShift.length > 0) return 'pending-shift';
        if (netGame === null) return 'no-net-game';
        if (state.turnPlayer !== netGame.selfSeat) return `not-my-turn(${state.turnPlayer}!=${netGame.selfSeat})`;
        return 'ran';
      };
      const w = why();
      if (w !== 'ran') {
        return {
          ok: false, why: w, op: 0, seat: netGame?.selfSeat ?? -1, turnPlayer: state.turnPlayer,
          actions: advanceProbeActions, submit: 'not-attempted', called: advanceProbeCalled,
        };
      }
      const before = `${state.step}|${state.turnPlayer}|${state.log.length}|${state.draftRound}`;
      /**
       * ★ **走 `cb.onAction`（与自动推进的落点同一个调用），不直呼 `driver.submit`。**
       *
       * 为什么必须这样（两条都是既有守卫）：
       *  - `driver.submit(` 在 `src/main.ts` 里**恰好 8 处**、且必须落在 `cb.onAction` /
       *    `applyRearrangeSwap` 里（`main-driver-wiring.test.ts` / `main-lobby-wiring.test.ts` /
       *    `g4-closure-guard.test.ts` 三条腿都钉着）—— 探针自己再调一次就会变成第 9 处
       *    （实测踩过：全绿变 6 红）；
       *  - `cb.onAction` 那条路**本来就更真**：它就是自动推进与玩家点击共用的那一个落点，
       *    引擎抛错守卫、FX 排空、`rerender()` 都在里面。
       */
      cb.onAction({ kind: 'advance' });
      const after = `${state.step}|${state.turnPlayer}|${state.log.length}|${state.draftRound}`;
      const d = netGame?.driver.lastFailure() ?? null;
      return {
        ok: after !== before,
        why: after !== before ? `moved ${before} -> ${after}` : `ran-but-no-change ${before}`,
        op: netGame?.driver.appliedSteps() ?? -1,
        seat: netGame?.selfSeat ?? -1,
        turnPlayer: state.turnPlayer,
        failure: d === null ? null : `${d.reason}: ${d.message}`,
        actions: advanceProbeActions,
        submit: 'via-cb.onAction',
        called: advanceProbeCalled,
      };
    },
    autoAdvanceOff: () => autoAdvanceOff,
  };
}

/** 本机 `sessionId`（16 字节 → 十六进制）。**只住会话层、不进档案**（D2） */
function newSessionId(): string {
  const c = (globalThis as { crypto?: { getRandomValues<T extends Uint8Array>(a: T): T } }).crypto;
  if (c === undefined) {
    // 没有随机源时**不能**悄悄退化成一个可预测的 id（两台设备会撞进同一个会话）
    throw new Error('这台设备拿不到随机源（安全上下文才提供它），联机会话开不起来。');
  }
  const bytes = new Uint8Array(16);
  c.getRandomValues(bytes);
  return 'sid-' + [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** 连接设置的**内存**副本（今天不落盘） */
const netSettings: { turnUrl: string; turnUsername: string; turnCredential: string } = {
  turnUrl: '',
  turnUsername: '',
  turnCredential: '',
};

/**
 * **这一局的房主会话号**（D 轮 I-3 甲）。
 *
 * 两个来源，按角色取：房主用它自己那串（`client.state().sessionId`），
 * 加入方用**邀请码里带过来的**那一串（`state().joined.payload.sessionId`）——
 * 会话层按会话号配对，"这一局叫什么"只有房主说了算。
 *
 * 没解出邀请码时回 `''`：那时它只被用来填**回示码**，而产回示码的前提就是"已经解出邀请码"
 * （`canMakeAnswer()` 卡这一条），所以空串走不到编码那一步；真走到了，
 * `encodeInvite` 会当场抛"空 sessionId"这个调用方违约，而不是发一条对不上的码出去。
 */
function sessionIdOfJoinedInvite(): string {
  const st = lobbyClient?.state() ?? null;
  if (st === null) return '';
  const joined = st.joined;
  return joined !== null && joined.ok ? joined.payload.sessionId : st.sessionId;
}

/**
 * 大厅要的注入环境（**承载大厅能力的那一份**）。
 *
 * ## ★ D 轮 I-1 / I-2：这三样必须住**这里**，因为 `createTransport` 用的就是它
 *
 * 原先这里只有 `settings`，而真正被 `createTransport` / `buildInvite` / `decompressBase64` 用的
 * 就是这一份 —— 于是两处断点同时存在，而且都**不会报错**：
 *
 *  - **I-1**：`onPeerConnection` 只注进了"另一份"环境（既有 ticker 又记连接的那个对象），
 *    而 `createTransport` 用的**不是**它 ⇒ 那个回执永远不响 ⇒ `hostPeerConnection`
 *    **永远是 `null`** ⇒ 房主"把回示码喂回同一条连接"（`applyAnswer`）每次都返回
 *    "本机还没有建起对端连接"；
 *  - **I-2**：这一份里**没有 `ticker`** ⇒ `createBrowserTransport` 排下的那个
 *    `waitForIceGathering` 在 `iceGatheringState !== 'complete'` 时回 `'unsupported'`
 *    ⇒ 房主**永远取不到非 trickle 的连接描述** ⇒ **永远产不出邀请码**。
 *    （假件缺省 `iceGatheringState: 'complete'` 会让这条缺陷同步早退成"看着是好的"。）
 *
 * 两样的语义与"为什么不是本文件自己 new 一条连接"见下面那段注释。
 */
function lobbyEnv(): NetBrowserEnv {
  return {
    settings: () => netSettings,
    // ★ I-2：等 ICE 收集必须有上界，而计时在本仓一律注入
    ticker: lobbyTicker,
    // ★ I-1：真传输在 `init()` 里把"刚造出来的那条连接"交回来，房主那格才拿得到它
    onPeerConnection: (pc) => { hostPeerConnection = pc; },
    /**
     * ★★ **G5 T13-A：探针专用的掐线钩子**（只在 `#g5probe=1` 时打开）。
     *
     * 浏览器里没有可逆的包级断线手段（三次实测见报告 §5）⇒ "同链路恢复 ⇒ `redrive()` 重发"
     * 这条真浏览器腿只能由页面**真关通道 + 真重建 + 如实报状态**来造。默认路径（不带那个查询
     * 片段）一个字节都不多走：`probeLinkCut` 缺省 `false`。
     */
    ...(window.location.hash.includes('g5probe=1') ? { probeLinkCut: true } : {}),
  };
}

/** 大厅要的时钟能力（注入形状；`net-lobby.ts` 里零命中裸 `setTimeout`） */
const lobbyTicker = {
  schedule: (fn: () => void, ms: number): number => window.setTimeout(fn, ms),
  cancel: (h: number): void => { window.clearTimeout(h); },
};

/**
 * ★ **承载"等 ICE 上界"能力的同一份大厅环境**（B2）—— D 轮起它就是 `lobbyEnv()`。
 *
 * ## 这两样各是为什么
 *
 *  - `ticker` —— 等 ICE 收集**必须有上界**，而计时在本仓一律注入；
 *    `net-browser.ts` 的 `waitForIceGathering` 在**没有** `ticker` 时会**响亮地拒绝**
 *    （`'unsupported'`），所以这一步不给就等于把那条路关掉；
 *  - `onPeerConnection` —— 房主"把回示的 answer 喂回**同一条**连接"要用到那个对象，
 *    而它住在 `createBrowserTransport` 里面。**本文件不自己 new 一条**：那会拿到第二条连接，
 *    而 `setRemoteDescription(answer)` 在一条没出过 offer 的连接上只会失败。
 *
 * ## ★ D 轮：那一份**已经撤掉**（原先它是与 `lobbyEnv()` 并列的第二份环境）
 *
 * 撤掉的理由是 I-1 / I-2 的共同根因：两份环境形状一样、**用途不同** ——
 * `createTransport` 那一份（原来的 `lobbyEnv()`）**缺了这两样**，而注入 `acceptOffer` 的
 * 那一份有。于是"有能力的那个只用在不需要它的地方"（收方产 answer 只需要 `ticker`），
 * 而"需要它的两个地方"（`init` 回执 / 等 ICE）都拿不到。合成一份（`lobbyEnv()`）之后，
 * 这个错位在结构上**不可能再出现**：没有第二份可挑。
 */

/**
 * 房主那一条连接（`lobbyEnv()` 的 `onPeerConnection` 回执记下来的）。
 *
 * ⚠️ 它是**单槽位**：一局只有一条本侧连接（D2：主机关页面即这一局结束）。
 * 跨局由大厅自己的生命周期收拾（`resetToMainInterface` 里 `lobbyClient?.dispose()`）。
 */
let hostPeerConnection: PeerConnectionLike | null = null;
/** 当前页面的 origin + 路径（邀请码的 `originAndPath`；纯层不知道自己在哪个地址上） */
function currentOriginAndPath(): string {
  return window.location.href.split('#')[0].split('?')[0];
}

/**
 * 入口那一屏的状态（还没建房也没加入）。
 *
 * ⚠️ 它**不是**"第二份状态"：这一格只有两个按钮，没有任何读数需要从会话层取。
 * 一旦玩家建房或加入，屏上的每一格都由 `LobbyClient.state()` 给（见 `renderLobbyFrame`）。
 */
function lobbyEntryState(): LobbyState {
  return {
    role: null,
    sessionId: '',
    invite: null,
    joined: null,
    roomCodeInput: '',
    roomCodeGate: null,
    transport: 'idle',
    peer: null,
    endpoint: signalingEndpointSetting(lobbyEnv()),
    ice: readIceServers(netSettings),
    advancedOpen: false,
    waitExpired: null,
    error: null,
    notice: null,
    routedIn: 0,
    routedOut: 0,
    helloSent: false,
    answerCode: null,
    answerApplied: null,
  };
}

/**
 * ★★ **硬币那一帧的结算读数**（模块态；`null` = 还没算出来）。
 *
 * ## 为什么必须持久（评审阻断项：门不确定，实测 9 跑 3 红）
 *
 * 这一帧的读数由 `lobbyCoinViewOf()` 写进 `globalThis.__coinInputs` —— 而那个函数**只在
 * "这一帧画硬币屏"时才跑**。T11-C 之后多了一个出口：`renderLobbyFrame` 的帧首
 * `enterNetGame()` 一旦成功进牌桌就 `return`，那一帧**不再画硬币屏** ⇒ 如果房主的
 * "读数齐了"那一帧与我进牌桌的那一帧**重叠**（相位 `complete` 与 `winnerReady()` 在同一帧
 * 一起变真，实测就是这个形状），`__coinInputs` 在房主那一侧**永远没被写过**。
 *
 * 症状（评审的 `DIAG HOST ready=false coinScreen=0 inputs=null`）：工具 ③.5 的跨端读数比对
 * 读到房主 `null` ⇒ **固红**，而且红不红取决于"那一帧有没有抢到"⇒ 门**不确定**
 * （镜像实测：4 跑 1 红，红在 `两端读数不同：房主 null / 加入方 {...}`）。
 *
 * 修法：把那一帧的读数**在 `enterNetGame()` 之前**也写一遍，并留在模块态里 ——
 * 读数一旦算出来就不再依赖"屏还在不在"。它不是第二个真相源：值与 `lobbyCoinViewOf()`
 * 算出来的是同一组（都由 `handoff()` 交出来的那一组数派生）。
 */
let coinVerdict: {
  role: string; caller: PlayerId; chosen: CoinSide; landed: CoinSide;
  winner: PlayerId; seed: string; phase: string;
} | null = null;

/**
 * ★ "硬币落地"那一帧已经补画过了（见 `enterNetGame()` 里那句 `renderCoin`）。
 * 一局只画一次；复位点与 `coinVerdict` 同族（`resetToMainInterface`）。
 */
let coinSettledShown = false;

/**
 * ★ G5 T19 **只读读数**：这一局的草稿 → 对局转场**播过几次**（`#g5probe=1` 时经 `diag()` 读）。
 *
 * 它与 `draftTransitionPlayed` 是**两件事**：闩位只答"这一局演过没有"（布尔，流程用它），
 * 这个计数器答"到底播了几次"（诊断用）。分成两个而不是"拿计数当闩"，是因为"变成 2"这件事
 * 本身要能被读到 —— 那正是"收到对端帧又补播一次"这个缺陷在读数上的形状。
 */
let transitionPlayed = 0;

/* ── ★★ G5 T19：硬币阶段的**顺序**（叫面读数 ⇒ 抛硬币动画 ⇒ 落定 ⇒ 才进牌桌）──────────── */

/**
 * 硬币阶段各格在屏上停多久（毫秒）。
 *
 * ## 为什么是这三个数（评审 2026-09-21 的裁决）
 *
 *  - `COIN_CALL_HOLD_MS = 900`：**"玩家 N 叫了「某面」"那一格**。420ms 人眼看不完（第一版就是
 *    420，评审实测屏上根本留不住）⇒ 900ms 是"读得完一句短句 + 认得出一枚芯片被选中"的量级；
 *  - `COIN_TOSS_MS`（`src/ui/home.ts` 的出口）= 1620：**动画**本身，保持第一版的长度；
 *  - `COIN_SETTLED_HOLD_MS = 1200`：**结论行那一格**（"掷出 X —— 玩家 N 先选协议"）。它必须
 *    独立存在：结论行是用户要的"最终结果"，一个同步任务里画完就被草稿屏盖掉等于没做。
 *
 * 三段合计 ≈ 3720ms（+ 一帧），全部走完才进草稿屏。代价是每局开局多花 3.7s；真浏览器门
 * （`tools/browser-truth-lobby-cdp.mjs`）从"点芯片"到"两端进草稿"等的是 `--wait` 那个每步预算
 * （收尾跑 30s）⇒ 占比 12% 量级，不是贴着上限。
 *
 * ## 为什么"告知"那一格必须先停一下（用户要的第一步就是它）
 *
 * "叫了哪一面"与"落点"在**同一帧**到手（真机实测形状：加入方按下芯片 ⇒ 面揭示与种子公开
 * 在一次入站里接连落地；房主那边同一族）⇒ 只按读数分支的话，这一步在屏上**一帧都留不住**，
 * 而那正是用户说的"而不是先给双方告知选的是哪一面"。
 *
 * ⚠️ **动态偏好（`prefers-reduced-motion`）只压动画那一格**：`'call'` 与 `'settled'` 两格的停留
 * 是"把话说完"，不是动画，一个字都不减（见 `coinTossHoldMs`）。
 */
const COIN_CALL_HOLD_MS = 900;
const COIN_SETTLED_HOLD_MS = 1_200;

/** 动态偏好下动画那一格压缩到多长（毫秒）；正常路径下它等于 `COIN_TOSS_MS` */
const COIN_TOSS_REDUCED_MS = 120;

/**
 * 读完 `prefers-reduced-motion` 那种动态偏好并折算成**动画那一格**的长度。
 *
 * 为什么它对屏那一层也要生效（`renderCoinNet` 收到的 `reducedMotion`）：动画是屏自己起的
 * （`playCoinTossAnimation`），应用层只能告诉它"这一局别演"。
 * 判据只问一次（每局开头），不做 `change` 订阅 —— 硬币阶段一共 1.6s，中途改偏好不是一条值得
 * 花钱去追的路。
 */
function reducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false; // 没有这个能力 ⇒ 按"不压缩"走（宁可演动画，不要静默变成另一套行为）
  }
}

/** 动画那一格该停多久（正常 `COIN_TOSS_MS`；动态偏好下 `COIN_TOSS_REDUCED_MS`） */
function coinTossHoldMs(): number {
  return reducedMotion() ? COIN_TOSS_REDUCED_MS : COIN_TOSS_MS;
}

/**
 * 硬币阶段此刻在哪一格（模块态；`null` = 这一局还没到最后那一格）。
 *
 * 四格与屏上的对应（`renderCoin` 的 `net.coinPhase` 就是从这里来的）：
 *  - `null`：读数没齐 ⇒ 屏上是"叫了哪一面 / 等对方叫面"，**没有落点**；
 *  - `'call'`：读数齐了 ⇒ 屏上**只**说"玩家 N 叫了「某面」"，**不播动画、不给结论**；
 *  - `'toss'`：动画**正在演**（屏上 `net.coinPhase === 'toss'`）；
 *  - `'settled'`：动画演完 ⇒ **结论行出现**，停 `COIN_SETTLED_HOLD_MS` 之后
 *    `enterNetGame()` 那道闸才放行 ⇒ 硬币阶段结束。
 *
 * ⚠️ **屏上那一格由这个相位决定，不许由"落点有没有到手"反推**（第一版就是反推的：`'call'`
 * 那一格在屏上已经当成动画在播 —— 评审实测的"告知停留不存在"）。
 */
let coinPhase: 'call' | 'toss' | 'settled' | null = null;
/** `coinPhase` 那几格属于**哪一枚结算**（`coinVerdict.seed`；`null` = 还没绑定） */
let coinPhaseSeed: string | null = null;
/** 当前这一格的到期时刻（`performance.now()` 毫秒；`null` = 没有在走） */
let coinPhaseAt: number | null = null;
/** ★ 只读读数：`'call'` 那一格的起跑时刻（`null` = 还没到过；见 `diag()`） */
let coinCallStartedAt: number | null = null;
/** ★ 只读读数：`'toss'` 那一格的起跑时刻（与上一格之差 = 告知那一格实际停了多久；见 `diag()`） */
let coinTossStartedAt: number | null = null;
/** ★ 只读读数：`'settled'` 那一格的起跑时刻（= 结论行出现那一刻；见 `diag()`） */
let coinSettledStartedAt: number | null = null;
/** 推进硬币阶段的那一个定时器句柄（`null` = 没有在等） */
let coinPhaseTimer: number | null = null;
/** ★ 只读读数：定时器到点叫醒时**回调里抛过异常**几次（只读；见 `wakeCoinPhase` 的兜底） */
let coinWakeThrew = 0;
/**
 * ★★ **只读读数（G5 T19 修复轮 2）：`wakeCoinPhase` 真的排过一次【已经到点】的唤醒几次**。
 *
 * ## 它为什么必须存在（评审实测的"机器卡"缺陷）
 *
 * 修复轮 1 的兜底写成"`coinPhaseAt` 非空而 `coinPhaseTimer` 为空 ⇒ 重排一次"，而 `'settled'`
 * 那一格**没有清空 `coinPhaseAt`** ⇒ 进牌桌那一帧 `coinPhaseAt` 已是过去时刻、定时器刚被回调
 * 置空 ⇒ **排一个 0ms 唤醒**；此后**每次 `renderLobbyFrame()` 都在同一处再排一个** ⇒ 从进桌到
 * `resetToMainInterface` 一直挂着一条 0ms 自唤醒链（每轮都跑一遍 `lobbyCoinView()` + `handoff()`
 * + 进门早退）。屏上完全看不出来，所以只能靠计数抓。
 *
 * 现在两处都堵了：`'settled'` 到期就 `coinPhaseAt = null`（见 `advanceCoinPhaseIfReady`），且
 * 这一位只在 `due <= now`（= 真的已经到点）时才 +1。**正常路径上它必须恒为 0** ——
 * `turn().coinTiming.staleWakes` 与 `diag().coinWakeStaleScheduled` 都读它。
 */
let coinWakeStaleScheduled = 0;
/** ★ 只读读数：`wakeCoinPhase` 排过的唤醒总数（含重试）；与上面那位对照"有没有在排" */
let coinWakeScheduled = 0;

/** 硬币阶段这一刻到点了没有（`at` 为空 ⇒ 没在等 ⇒ 不挡任何事） */
function coinPhaseElapsedAt(at: number | null): boolean {
  return at === null || performance.now() >= at;
}

/** 取消那条"到点叫醒"的定时器（任何一次换格都要走它，免得留下第二条腿） */
function clearCoinPhaseTimer(): void {
  if (coinPhaseTimer !== null) {
    window.clearTimeout(coinPhaseTimer);
    coinPhaseTimer = null;
  }
}

/**
 * 叫醒一次 `renderLobbyFrame`（到点那一帧会把格子推过去）。
 *
 * ## 兜底（评审登记的缺口 A，能顺手补的就补）
 *
 * 回调里 `renderLobbyFrame()` 抛异常时**重新排一次**（下一个到期时刻 = 现在 + 250ms），
 * 而不是让这一格从此只能等下一条入站帧（读数齐之后握手通常已经 `complete`，没有下一条）。
 * 只重排固定次数（`COIN_WAKE_RETRY_MAX`）—— 真正的病（渲染器抛）不该被无限重试掩盖成"卡住"。
 *
 * ⚠️ **`due` 必须是未来时刻**（两处调用都先判 `!coinPhaseElapsedAt(...)`）。这一位计数
 * （`coinWakeStaleScheduled`）就是为"万一有人绕过那个前提"留的证伪点。
 */
const COIN_WAKE_RETRY_MS = 250;
const COIN_WAKE_RETRY_MAX = 8;
function wakeCoinPhase(due: number, seed: string): void {
  clearCoinPhaseTimer();
  coinWakeScheduled += 1;
  if (due <= performance.now()) coinWakeStaleScheduled += 1;
  coinPhaseTimer = window.setTimeout(() => {
    coinPhaseTimer = null;
    if (coinPhaseSeed !== seed) return; // 中途换局/复位 ⇒ 那一边自己会画
    try {
      renderLobbyFrame();
    } catch (e) {
      coinWakeThrew += 1;
      if (coinWakeThrew > COIN_WAKE_RETRY_MAX) throw e;
      wakeCoinPhase(performance.now() + COIN_WAKE_RETRY_MS, seed);
    }
  }, Math.max(0, due - performance.now()));
}

/**
 * ★★ **G5 T19 修复轮：页面重新可见时补推一次硬币阶段**（评审登记的缺口 A 的兜底之一）。
 *
 * 为什么需要它：三段是靠 `window.setTimeout` 走到点的，而**后台标签页的定时器会被浏览器节流
 * 甚至合并**（Chrome 对隐藏页的定时器最粗可到每分钟一次；本机 headless 门里没踩到，但玩家把页面
 * 切走再切回来是很常见的动作）。那一段被节流之后，屏会停在某一格上等到定时器被放行 ——
 * 玩家看到的是"卡在抛硬币/结果那里"。
 *
 * 这里只补一次"重新看一眼相位"的调用（`renderLobbyFrame` 里那句 `advanceCoinPhaseIfReady`
 * 是幂等的：时刻到了就推格子、没到就什么都不做）；**不引入第二条时间轴**，
 * 也不改变任何判据 —— 它只是把"该推了没有"这个问题再问一遍。
 *
 * ⚠️ 监听器是**模块级、一次性**的（本模块在整页生命周期里只求值一次）⇒ 不会随局数累积。
 *
 * ⚠️ **如实登记（评审 2 点名，不改）**：闸是那个模块位 `coinPhase !== null`，而进牌桌之后它**永久
 * 停在 `'settled'`** ⇒ 玩家在大厅那几屏上切标签页回来会**多调一次** `renderLobbyFrame()`
 * （那一次会走 `lobbyCoinView()` + `enterNetGame()` 早退）。它与 `onInbound` 早有的同类触发同源
 * （早就存在"大厅屏上收到帧也重画一帧"的路径），代价是有界的、屏上无副作用，所以留着。
 */
window.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  if (coinPhase === null) return; // 没有在走硬币阶段 ⇒ 什么都不做
  renderLobbyFrame();
});

/**
 * ★★ **推一次硬币阶段的格子**（`renderLobbyFrame` **每一帧的第一件事**；幂等）。
 *
 * ## 顺序（用户要的那一条，也是评审的阻断项）
 *
 * 1. 读数一到手（`landed` 与 `winner` 都有）⇒ 进 `'call'`：屏上**只**出现"玩家 N 叫了「某面」"，
 *    停 `COIN_CALL_HOLD_MS`（900ms），**不播动画**；
 * 2. 到点 ⇒ 进 `'toss'`：屏上开始演抛硬币，停 `COIN_TOSS_MS`（1620ms）；
 * 3. 到点 ⇒ 进 `'settled'`：屏上出**结论行**，停 `COIN_SETTLED_HOLD_MS`（1200ms）；
 * 4. 到点 ⇒ `coinPhase` 已经在 `'settled'` 且到期，`enterNetGame()` 那道闸放行 ⇒ 进草稿屏。
 *
 * ## ⚠️ 它必须排在 `enterNetGame()` **之前**（第一版的阻断项就在这里）
 *
 * 第一版把"进门"排在"推格子"之前，而闸只看**当前这一格**的到期时刻 ⇒ 兜底支把
 * `coinPhaseAt` 设成"告知 + 动画"之和之后，到点那一帧闸先判"到期"并 `return`（`enterNetGame`
 * 成功就 return），**推格子那一步再也跑不到** ⇒ `'toss'`/`'settled'` 永不写入、结论行永不出现。
 * 现在：推格子在一帧的最前面，闸只认"`'settled'` 且到期"。
 *
 * ## 起点只在"换了一枚结算"时重设（`coinPhaseSeed`）
 *
 * 绑定的是**种子**而不是一个"演过没有"的布尔：布尔闩会跨局带过去；也**不是每一帧都重设** ——
 * 那样"读数齐了"期间的连续重画会把起点一直往后推，动画永远起不来。
 */
function advanceCoinPhaseIfReady(): void {
  const coin = lobbyClient === null ? null : lobbyCoinView();
  // 读数没齐 ⇒ 硬币阶段还没到最后一格（屏上是"叫了哪一面 / 等对方叫面"）
  if (coin === null || coin.landed === null || coin.winner === null) return;
  const seed = coinVerdict?.seed;
  if (seed === undefined) return;
  const now = performance.now();
  let changed = false;
  if (coinPhaseSeed !== seed) {
    // 新的一枚结算（新的一局 / 第一次算出来）：从第 1 格起
    coinPhaseSeed = seed;
    coinPhase = 'call';
    coinCallStartedAt = now;
    coinPhaseAt = now + COIN_CALL_HOLD_MS;
    changed = true;
  } else if (coinPhase === 'call' && coinPhaseElapsedAt(coinPhaseAt)) {
    coinPhase = 'toss';
    coinTossStartedAt = now;
    coinPhaseAt = now + coinTossHoldMs();
    changed = true;
  } else if (coinPhase === 'toss' && coinPhaseElapsedAt(coinPhaseAt)) {
    coinPhase = 'settled';
    coinSettledStartedAt = now;
    coinPhaseAt = now + COIN_SETTLED_HOLD_MS;
    changed = true;
  } else if (coinPhase === 'settled' && coinPhaseElapsedAt(coinPhaseAt)) {
    /**
     * ★★ **`'settled'` 那一格到期 ⇒ 清空 `coinPhaseAt`**（G5 T19 修复轮 2 的必改项）。
     *
     * 不清它的后果（评审实测的"机器卡"）：下面那段兜底判的是"`coinPhaseAt` 非空而定时器
     * 为空 ⇒ 重排一次"，而进牌桌那一帧恰好是"`coinPhaseAt` 已过期 + 定时器刚被回调置空"
     * ⇒ 每帧排一个 **0ms** 唤醒，从进桌一直挂到 `resetToMainInterface`（屏上完全看不出来）。
     * 清空之后那段的前提直接不成立（只剩 `'call'`/`'toss'` 两格会走兜底，而它们**确实**
     * 需要一个到点叫醒）。
     */
    coinPhaseAt = null;
    clearCoinPhaseTimer();
    changed = true;
  }
  if (changed) {
    if (coinPhaseAt !== null) armCoinPhaseWake(coinPhaseAt, seed);
    return;
  }
  /**
   * **没有换格、但定时器不在了**（页面在后台被节流时把定时器丢了、或上面那次回调抛过异常）
   * ⇒ 按同一判据重新排一次"到点叫醒"。没有这一条，格子会永远停在 `'call'`/`'toss'` 上：
   * 屏不动、牌桌也进不去（不报错的死挂）。
   *
   * ⚠️ **只在"到期时刻还没到"时重排**（G5 T19 修复轮 2）：已经过期的时刻重排出来就是一个 0ms
   * 定时器 —— 那正是评审抓到的那条自唤醒链。到点之后就**没人**再排了（格子由本函数下一次被调
   * 时按判据推过去；真的推不动时还有 `visibilitychange` 那条腿）。
   */
  if (coinPhaseAt !== null && coinPhaseTimer === null && !coinPhaseElapsedAt(coinPhaseAt)) {
    armCoinPhaseWake(coinPhaseAt, seed);
  }
}

/**
 * ★ **只在"到期时刻还没到"时排一次到点叫醒**（`wakeCoinPhase` 的唯一入口）。
 *
 * 为什么单开一个包装：`wakeCoinPhase` 的语义是"到 `due` 那一刻叫醒一次"，而传一个**已经过去**的
 * 时刻进去的唯一效果就是排一个 0ms 定时器（评审实测的那条自唤醒链）。把"必须还没到点"这条前提
 * 收在**一个**判断里，两个调用点（换格 / 兜底补排）都不可能绕过它。
 */
function armCoinPhaseWake(due: number, seed: string): void {
  if (coinPhaseElapsedAt(due)) return; // 已经到点 ⇒ 不排（到点该由"推格子"处理，不是叫醒）
  wakeCoinPhase(due, seed);
}

/** 复位硬币阶段那几个模块态（与 `coinVerdict` / `coinSettledShown` 同族；`resetToMainInterface` 调） */
function resetCoinPhase(): void {
  clearCoinPhaseTimer();
  coinPhaseSeed = null;
  coinPhase = null;
  coinPhaseAt = null;
  coinCallStartedAt = null;
  coinTossStartedAt = null;
  coinSettledStartedAt = null;
  coinWakeThrew = 0;
  coinWakeScheduled = 0;
  coinWakeStaleScheduled = 0;
}


/**
 * 画出大厅这一帧。
 *
 * ## 为什么 `sync()` 排在这一帧之前
 *
 * `peerStatus()` 是**拉**的读数（会话层不推送，见 `session.ts:768-776`："订阅是一个有生命周期的
 * 副作用，纯状态机不该持有它"）⇒ 每次重渲染前读一次，屏上那句"对端在线 / 断线"才是**这一刻**的
 * 事实，而不是上一次交互留下的快照。
 */
function renderLobbyFrame(): void {
  const client = lobbyClient;
  /**
   * ★★ **T11-C：这一帧先问"是不是该进牌桌了"**（任务书 §7：硬币屏上刻意**没有**
   * "开始对局"按钮 ⇒ 进对局的触发条件只能做在"读数齐了"这一层，不许加按钮）。
   *
   * ⚠️ **顺序写死，而且"先算读数、再推硬币阶段、最后才进牌桌"**：
   *  - `lobbyCoinView()` 里那句 `lobbyCoinViewOf()` 是 `__coinInputs`（硬币屏那一帧的结算读数）
   *    **唯一**的写入点，而进牌桌之后这一帧就 `return` 了、那块屏再也不画 ⇒ 先 `enterNetGame()`
   *    会把读数**吃掉**（T11-C 的评审阻断项就是这么来的；详见 `coinVerdict` 的说明）；
   *  - ★★ **G5 T19 修复轮：推硬币阶段也必须排在 `enterNetGame()` 之前。**
   *    第一版把它排在后面，而 `enterNetGame` 成功就 `return` ⇒ 到点那一帧只放行、不推格子，
   *    `'toss'`/`'settled'` 永不写入、结论行永不出现（评审实测：门里 30s 轮询从未看到结论行）。
   *    现在一帧的顺序是：**算读数 ⇒ 推阶段 ⇒ 画屏 ⇒ 问进门**；进门那道闸只认
   *    "`coinPhase === 'settled'` 且这一格也到期"。
   */
  const coin = client === null ? null : lobbyCoinView();
  if (coin !== null && coin.winner !== null) {
    const hand = client?.handoff() ?? null;
    /**
     * ⚠️ **G5 T19：已经算出来的那一枚不重算**。
     *
     * `coinPhase` 那几格是按 `coinVerdict.seed` 绑定的（见 `advanceCoinPhaseIfReady`），
     * 而这个块每帧都会重算一次 `coinVerdict` —— 重算本身是幂等的（值逐字相同），
     * 但换一个新对象、并把同一枚结算的起点重设一遍是**没有意义**的（那一枚的格子已经在走）。
     * 所以只在"还没有"或"换了一局（种子不同）"时写它。
     */
    const fresh = coinVerdict === null || (hand !== null && hand.ready && hand.seed !== coinVerdict.seed);
    if (hand !== null && hand.ready && hand.seed !== null && hand.draftStarter !== null && fresh) {
      coinVerdict = {
        role: coin.role, caller: coin.caller, chosen: coin.chosen ?? hand.chosen,
        // ⚠️ 相位取 `hand.phase`（= `'complete'`，两端同一个值），**不取** `coin.phase`：
        //   加入方那一帧可能还写着 `reveal-salt-sent`（T11-B 留下的读数），于是两端这一格
        //   不同 —— 而门禁比的是"同一帧的结算读数"，让它们逐字一致才比得动。
        landed: hand.landed, winner: coin.winner, seed: hand.seed, phase: hand.phase,
      };
      (globalThis as { __coinVerdict?: unknown }).__coinVerdict = coinVerdict;
    }
  }
  /**
   * ★★ **G5 T19：推硬币阶段**（闸在那个函数里判，见它的说明）。**必须在 `enterNetGame()` 之前** ——
   * 第一版的阻断项就是在这一行上：进门排在推格子之前，而 `enterNetGame` 成功就 `return`
   * ⇒ 到点那一帧只放行、不推格子，`'toss'`/`'settled'` 永不写入、结论行永不出现。
   */
  advanceCoinPhaseIfReady();
  /**
   * ★★ **这一帧要不要现在进牌桌**。闸只看一件事：**硬币阶段已经到 `'settled'` 且那一格也到期**。
   *
   * `'call'` / `'toss'` / `'settled'` 三格各自的时间由 `advanceCoinPhaseIfReady` 记在
   * `coinPhaseAt` 上，这里不再看"当前格到期没有"那种模糊判据（那正是第一版把 `'call'` 当成
   * "已经全部到期"的原因）。
   */
  if (coinPhase === 'settled' && coinPhaseElapsedAt(coinPhaseAt)) enterNetGame();
  if (netGame !== null) return; // 已经进牌桌：这一帧不该再画大厅/硬币屏（`enterNetGame` 里画过了）
  if (client !== null) client.sync();
  /**
   * ★★ **T11-B：先问"这一刻该不该画硬币屏"**（D27：硬币屏插在握手中间）。
   *
   * 顺序写死：这一帧是**大厅与硬币屏共用的唯一入口**，所以判定必须排在 `renderNetLobby` 之前。
   * 重画的条件是"读数指纹变了"（`lobbyCoinShown`）—— 这一帧会被每条入站重画，
   * 无条件重画就是整屏重建（玩家点下去的那一刻屏会闪、大币会重置）。
   *
   * ★★ **G5 T13-A（修复轮）：开局期那次断线之后不再画硬币屏**（`lobbyRestartNeeded`）。
   * 那一格没有可续的对局，屏该退回到**大厅那一屏** —— 那里才有「生成邀请码」/ 粘贴框 /
   * 「出示回示码」三样控件，玩家点一下就能重来（不必刷新页面）。这一格**不是**"重连可用"：
   * 硬币只是那一局的开头，而那一局已经没了。
   *
   * ★★ **G5 T13-C：对局中掉线超过宽限也走同一条屏路**（`linkRecoveryNeeded`，用户 2026-09-20
   * 第 2 条指示）。区别是那一局**还在**：玩家在大厅上重新交接一次邀请码/回示码之后，
   * 新链路走 `resuming` 追平（T13-A/B 接好的机制），`enterNetGame()` 一进牌桌这一位就复位。
   * 两个位都在时也不画硬币屏 —— 硬币在断线前就定过了。
   */
  if (coin !== null && !lobbyRestartNeeded && !linkRecoveryNeeded) {
    // 只在这一帧的读数**与上一帧不同**时重画（见 `lobbyCoinShown` 的说明）
    /**
     * ⚠️ **G5 T19：指纹里加了 `coinPhase`**（`call` / `toss` / `settled`）。
     *
     * 不加它的话，"动画开始"与"动画结束"这两格会与"读数齐了"那一格**指纹相同** ⇒
     * 屏上永远不会重画到抛硬币/落定（而 `landed`/`winner` 在整段时间里都不变）。
     */
    const sig = `${coin.role}|${coin.phase ?? ''}|${String(coin.chosen)}|${String(coin.landed)}|${String(coin.winner)}|${String(coin.caller)}|${String(coinPhase)}`;
    if (sig !== lobbyCoinShown) {
      lobbyCoinShown = sig;
      renderCoin(root, {
        backHome: () => { showModeSelect(); },
        // ⚠️ 联机那一支**不读种子**（D27：叫面必须早于公开种子）⇒ 这里刻意不给 `seed`
        // ⚠️ T11-C：`beginGame` 仍然**空实现** —— 联机这一支没有"开始对局"按钮（上面 §7），
        //    进对局的触发点是 `renderLobbyFrame` 里那句带闸的 `enterNetGame()`。热座那一支照旧。
        beginGame: () => { /* 联机进牌桌由 enterNetGame() 触发，不是这个按钮 */ },
        /**
         * ★★ **G5 T19 修复轮：屏上画哪一格由 `coinPhase` 决定**（不许按"落点到手没有"反推）。
         *
         * 三个相位与屏上的对应写在 `renderCoinNet` 的开头：`'call'` 只说"谁叫了哪一面"、
         * `'toss'` 才起播动画、`'settled'` 才出结论行。`reducedMotion` 是给动画那一格的动态偏好
         * 开关（`'call'`/`'settled'` 两格的停留不受它影响）。
         */
        net: { ...coin, coinPhase: coinPhase ?? undefined, reducedMotion: reducedMotion() },
      });
    }
    /**
     * ★★ **G5 T13-A：硬币屏上也要有那一行连接状态**（掉线/追平的观感不许只有"对面好像卡住了"）。
     *
     * 为什么必须补在这里：硬币屏是**握手中间**的一站（D27），而掉线恰恰最可能发生在这一刻
     * （玩家还在犹豫叫哪一面）。没有这一行，掉线在两个真浏览器上**一次都看不见**
     * （实测：真浏览器门第一轮就是这么红的 —— 两端都停在硬币屏，`.net-lobby-link` 根本不在 DOM 里）。
     *
     * 文案本体仍然只有一处：`lobbyLinkText(peerStatus)`（`netLinkLine()` 里那句）。
     */
    const coinLinkText = netLinkLine();
    if (coinLinkText !== null) {
      const line = document.createElement('div');
      line.className = 'net-link-line';
      line.textContent = coinLinkText;
      root.appendChild(line);
    }
    return;
  }
  lobbyCoinShown = null;
  const st = client === null ? lobbyEntryState() : client.state();
  renderNetLobby(root, {
    state: st,
    backHome: () => { showModeSelect(); },
    startHost: () => { startLobby('host'); },
    startJoin: () => { startLobby('guest'); },
    makeInvite: () => { void makeLobbyInvite(); },
    inviteLength: (payload: string) => {
      const r = inviteLengthReport(payload);
      return inviteLengthText(r.chars, r.withinMeasuredRange);
    },
    qrNote,
    setRoomCode: (text: string) => { lobbyClient?.setRoomCode(text); },
    submitRoomCode: () => {
      // ★ **端点为空时这一步不发任何请求**：`submitRoomCode()` 只调纯判定
      //   （`roomCodeEntryReachability` / `normalizeRoomCode` / `roomChannel`）。
      //   真正的网络动作（信令客户端）属 T9，见本节头注。
      lobbyClient?.submitRoomCode();
      renderLobbyFrame();
    },
    joinWithInvite: (text: string) => { void joinLobbyWithInvite(text); },
    toggleAdvanced: () => { lobbyClient?.toggleAdvanced(); renderLobbyFrame(); },
    // ★ G5 T15：区里那一小块 TURN（三项输入框默认不渲染，由这个开关展开）
    toggleRelay: () => { lobbyClient?.toggleRelay(); renderLobbyFrame(); },
    settingsValue: (key) => netSettings[key],
    setSetting: (key, value) => { netSettings[key] = value; renderLobbyFrame(); },
    errorText: (key: LobbyErrorKey) => errorCopy(key),
    // ★ C3：回示码的两个入口（产出代码里已经有 makeLobbyAnswerCode / applyLobbyAnswerCode，
    //   C 轮之前它们**零调用者** ⇒ 玩家在界面上看不到这条路）
    makeAnswerCode: () => { void makeLobbyAnswerCode(); },
    applyAnswerCode: (code: string) => { void applyLobbyAnswerCode(code); },
  });
}

/**
 * ★ **断线时重连**（修复轮 A5；G5 T13-A/B/C 逐步改了它的形状）：订阅链路状态，
 * 宽限期内自己回来 ⇒ 什么都不做；超过宽限 ⇒ **把屏交回给玩家**（不再自动重建链路）。
 *
 * 为什么它必须存在（评审 1.1 第 3 点）：计划 §5 T8 写死了"重连必须新建会话对象"，而第一版
 * 产出代码里 `reconnect(` **0 处命中** ⇒ 那条硬约束只在 `net-lobby.ts` 的实现与注释里成立，
 * 没有任何调用者。
 *
 * ★★ **G5 T13-C 改掉了这里最后那件"自动重建"**（用户 2026-09-20 第 2 条指示）：
 * `connect()` 每次都 `createTransport()`，新传输**必须重新交换邀请码/回示码**才可能连上
 * ⇒ 自动重建出来的是一条永远连不上的链路，而玩家已经被换到它上面、屏上又没有回大厅的入口
 * （§9 第 27 条）。现在两种掉线（开局期 / 对局中）都走同一条路：**如实一行话 + 退回大厅那一屏**，
 * 由玩家自己重新交接一次码。三种纪律仍然成立：
 *  1. **新建会话对象**由 `client.connect('resume')` 保证（玩家点「生成邀请码」/ 贴码时）；
 *  2. **并发挡板**：宽限期内那条调度是**一次性的**（`graceHandle` 到点即清、`online` 时取消）
 *     —— 没有异步的自动重建在飞，所以也不需要"正在重连"那种闩；
 *  3. **不在这里做重发**：把"卡在半路的握手/收官消息"重新驱动起来归 **T6 的 `redrive()`**（D23），
 *     不是 UI 的活。这里只负责"把屏与玩家手里的码准备好"。
 *     ★ **G5 T13-A 接线之后**：`redrive()` 的调用点在 `src/ui/net-lobby.ts` 的链路状态订阅里
 *     （`offline -> online` 恢复那一刻）与"房主应答完 `resync-req` 之后"那一格 —— 本函数**不**
 *     调它。
 */

/**
 * ★★ **G5 T13-A：offline 之后等多久才判"这条链路回不来了"**（毫秒；用户裁决 2026-09-20）。
 *
 * ## 两个量不许混（写在常量旁边，免得下一个人把它们合成一个）
 *
 *  - **这个宽限期是秒级的**：短暂断线（网络抖一下 / ICE 自己重协商回来），链路会自己转回
 *    `online` ⇒ 什么都不做（会话对象一个字不丢），由 `redrive()` 把在途消息重发。
 *    它**不是** D8 那个 300 秒窗口；
 *  - **300s 窗口是另一件事**（D8：超窗不许追平、**不自动结束对局**，屏上那句话说"只能重开一局"）。
 *    窗口的判定与可见性都归会话层与大厅文案，本文件一个字都不判（T13-C 只把它的三值读数
 *    接进"带回大厅"那一行话里，见 `linkRecoveryNotice`）。
 *
 * ★ **G5 T13-C：到点之后不再自动重建链路**（本轮改掉的旧行为）——
 * 新传输必须重新交换邀请码/回示码才可能连上，自动重建只会把玩家丢在一个没有出口的死牌桌上
 * （§9 第 27 条）。到点意味着"把屏交回给玩家、让他重新交接一次码"。
 */
const RECONNECT_GRACE_MS = 4_000;

/**
 * ★★ **G5 T13-A（修复轮）：开局期那次断线之后，"这一局该重来"这个事实**（模块态）。
 *
 * 它只有一件作用：**让屏退回大厅那一屏**（跳过硬币屏分支），于是玩家能直接用大厅上本来就有的
 * 三样控件重来（「生成邀请码」/ 粘贴框 /「出示回示码」）——不必刷新页面，也不需要自动重贴码
 * （本轮**没做**自动重贴码，见 `attachLobbyReconnect` 里那一段的理由）。
 *
 * 复位点只有一个方向：**玩家真的重新开始一次尝试**时（生成邀请码 / 贴码 / 回到主页）。
 * 与 `lobbyCoinShown` 同族：它是"屏该画哪一屏"的读数，不是第二份对局状态。
 */
let lobbyRestartNeeded = false;

/**
 * ★★ **G5 T13-C（用户 2026-09-20 第 2 条指示 / §9 第 27 条）：对局中掉线超过宽限之后，
 * "屏该画大厅那一屏、让玩家重新贴码回来"这个事实**（模块态）。
 *
 * ## 它与 `lobbyRestartNeeded` 是两件**不同**的事（别合并成一个布尔）
 *
 *  - `lobbyRestartNeeded`：**开局期**掉线 —— 没有可续的进度，这一局该**重来**；
 *  - `linkRecoveryNeeded`：**对局中**掉线 —— 这一局**还在**（`netGame` 与它的档案一个字没动），
 *    只是链路判死了，玩家要重新交接一次邀请码/回示码把它接回来（可续与否见
 *    `linkRecoveryNotice()` 的三值文案：超窗之后按 D8 只能重开）。
 *
 * 两者对屏的**唯一**影响是同一件：**这一帧不画硬币屏**（硬币在断线前就定过了，
 * 再画一次等于让玩家以为又要掷一次）⇒ `renderLobbyFrame` 那一句同时读这两个位。
 *
 * 复位点：玩家真的重新开始一次交接（生成邀请码 / 贴码）、真的回到牌桌
 * （`enterNetGame()` 换完驱动）、或整局复位（`resetToMainInterface`）。
 */
let linkRecoveryNeeded = false;

function attachLobbyReconnect(client: LobbyClient): void {
  /** 宽限期内那条待重建的调度（`null` = 没有在等） */
  let graceHandle: number | null = null;
  const cancelGrace = (): void => {
    if (graceHandle !== null) {
      lobbyTicker.cancel(graceHandle);
      graceHandle = null;
    }
  };
  client.onStatus((to) => {
    /**
     * ★ 读数先跟上：屏上那一行与下面"宽限到点时到底回来了没有"那个判断都读 `state()`，
     *   而它是**拉**的读数（`s.transport` 只在 `sync()` 里更新）。
     */
    client.sync();
    /**
     * ★★ **G5 T13-C：对局那条会话（`netGame.session`）也要跟上当前链路的状态** ——
     * 补的是 T13-A/B 留下的一处**接线缺口**（不是 T6 的机制问题）。
     *
     * 事实：牌桌上那一行连接状态读的是 `netGame.session.peerStatus()`（`netLinkLine()`），
     * 而对局中重建链路时 `enterNetGame()` 有意**沿用旧会话对象**（`{ ...raw, session: existing.session }`：
     * 开局读数与承诺进度都不重算）。旧会话的状态是**它的旧链路**喂的，那条链路在
     * `connect()` 里被 `detach()` ⇒ 换链路之后旧会话**再也收不到任何状态** ⇒ 牌桌上会永远
     * 停在上一次那条链路的最后一次状态（实测形状：重连成功、两边都在打，屏上却一直写着
     * "对端现在不在线"）。这里把当前链路的状态原样转给它；没有对局时是空操作。
     */
    if (netGame !== null) netGame.session.noteTransportStatus(to);
    /**
     * ★★ **G5 T13-A：链路自己回来了 ⇒ 不重建**。
     *
     * 会话对象与它的相位进度因此**一个字不丢**，而"卡在半路的那条握手/收官消息"由链路自己的
     * 恢复分支重发（`createLobbySessionLink` 的 `detachStatus`：`offline -> online` ⇒
     * `session.redrive()`，源码里只此一处）。这条分支与下面那条宽限配套，合起来是两条路：
     *  - 宽限期内恢复 ⇒ **同链路**，`redrive()` 重发；
     *  - 超过宽限 ⇒ 重建 + `resync` 追平（下面那一支）。
     */
    if (to === 'online') {
      cancelGrace();
      if (netGame !== null) rerender(); else renderLobbyFrame();
      return;
    }
    if (to !== 'offline') return;
    /**
     * ★ **掉线那一刻要重画一帧**：屏上那一行（"对端现在不在线（链路断了）…"）是从
     * `peerStatus()` 派生的读数，而它是**拉**的（`sync()` 刚更新，屏还没画）。
     * 不重画的话玩家看到的是"对面好像卡住了"——正是本轮判据要消灭的观感。
     */
    if (netGame !== null) rerender(); else renderLobbyFrame();
    /**
     * ★★ **G5 T13-A：offline 不再当场重建 —— 先给一个秒级宽限期**（用户裁决 2026-09-20）。
     *
     * 为什么原来那句"offline 立刻 `reconnect()`"不够（实测读码）：它把**可恢复的短暂断线**
     * 也当成永久掉线 —— 会话对象（相位进度）连同旧传输一起被丢掉，而新传输要**重新交换
     * SDP** 才可能连上（`connect()` 每次都 `createTransport()`）⇒ 一次网络抖动之后两端
     * 都停在"新链路永远连不上"，而"卡在半路的那条消息"没有任何机会被重发（`redrive()` 在新
     * 会话上推不出任何东西）。宽限期把这两件事分开：
     *  - 期间恢复（`to === 'online'`）⇒ 走上面那一支，`redrive()`；
     *  - 期间没恢复 ⇒ 走下面这一支：**把屏交回给玩家**（T13-C 改掉的那条旧行为见下）。
     *
     * 时间来源是本仓既有的注入计时能力（`lobbyTicker`）—— 本文件不直呼 `setTimeout` 之外的
     * 东西，也没有裸定时器散在页面里。
     */
    cancelGrace();
    graceHandle = lobbyTicker.schedule(() => {
      graceHandle = null;
      client.sync();
      if (client.state().transport === 'online') return; // 期间真的回来了 ⇒ 不重建
      /**
       * ★★ **开局期（还没有可续的对局）掉线 ⇒ 不假装续上，也不自动重贴码**（修复轮，2026-09-20；
       * 评审判上一版"两端重新走到 complete"在生产路径上不成立）。
       *
       * ## 为什么"自动重建"在这一格是错的（两道墙，都是读码可核的事实）
       *
       *  1. **房主会拒那条新 hello**：`acceptHello`（`src/net/session.ts:1515-1517`）在"相位不是
       *     `handshaking` 且 hello 不带 `resuming`"时走 `refuseLateHello`（不回 ack）。开局期房主
       *     的会话**还活着**、相位正是 `awaiting-commit-face` ⇒ 加入方那条"新的一次握手"的普通
       *     hello 当场被拒，加入方停在 `handshaking`（`helloDone` 已烧掉，不会再补发）；
       *  2. **新传输不再连得上**：`connect()` 每次都 `createTransport()`（`src/ui/net-lobby.ts`
       *     的 `connect`）⇒ 新链路要**重新交换邀请码/回示码**才可能通，而自动分支里没有任何
       *     "重贴码"这一动作。
       *
       * ⇒ 这一格唯一诚实的做法是：**如实说清"这一局还没开始、请重新生成邀请码 / 重新加入"**，
       * 并把屏**退回大厅那一屏**（那里本来就有「生成邀请码」/ 粘贴框 /「出示回示码」三样控件）
       * —— 玩家不必刷新页面，点一下就能重来。**本轮只做到"可读 + 可重来"，没有做自动重贴码。**
       *
       * ⚠️ 不许把它写成"重连可用"：这一局没有任何可续的进度。
       *
       * ★ T13-C 补的一句：那三样控件要真的**可用**，得先把上一次交接的产物作废 ——
       * 房主那一支**只在 `invite === null` 时**才画「生成邀请码」按钮，而断线那一刻
       * `s.invite` 里还留着那条**属于死链路**的旧码（`invalidateHandshakeArtifacts()`）。
       */
      if (netGame === null) {
        lobbyRestartNeeded = true;
        client.invalidateHandshakeArtifacts();
        client.showNotice(
          '连接断了，这一局还没开始：请重新生成邀请码 / 重新加入。'
          + '（这一次断线没有可续的对局进度 —— 不是"接上了"，也不是"续上了"。）',
        );
        renderLobbyFrame();
      } else {
        /**
         * ★★ **G5 T13-C（用户 2026-09-20 第 2 条指示 / §9 第 27 条）：对局中掉线超过宽限 ⇒
         * 把玩家带回"双人远程模式 -> 建房 / 加入房"那一屏。**
         *
         * ## 为什么不再在这里自动重建链路（本轮改掉的旧行为）
         *
         * `connect()` 每次都 `createTransport()`，而新传输要**重新交换邀请码/回示码**才可能连上
         * ⇒ 自动重建出来的那条链路永远连不上，而驱动已经被换到它上面（`enterNetGame()` 的
         * `existing !== null` 那一支）⇒ 玩家面对的是一个**没有任何按钮能救**的死牌桌：
         * 牌桌那一支先 `return`，大厅那三样控件进不了 DOM（§9 第 27 条就是这条缺口）。
         *
         * ## 现在的处置：把屏交回给玩家，可续与否如实说
         *
         *  - `linkRecoveryNeeded = true` + `renderMode = 'lobby'`：屏退回大厅那一屏；
         *  - `invalidateHandshakeArtifacts()`：旧邀请码/回示码的 SDP 属于那条死链路 ⇒ 作废，
         *    于是「生成邀请码」/ 粘贴框 /「出示回示码」三样控件**都回到可用状态**；
         *  - `showNotice(linkRecoveryNotice(...))`：三种窗口读数各一句（超窗说"只能重开"、
         *    窗口内说"接上能追平"、判不了就说判不了），文案本体只有一个出处；
         *  - **这一局一个字都没丢**：`netGame`（驱动、档案、种子、座位）原地不动。玩家重新交接
         *    一次码之后走 `resuming` 追平（T13-A/B 接好的机制），`handoff().ready` 那一刻
         *    `enterNetGame()` 把驱动换到新传输上并回到牌桌。
         */
        linkRecoveryNeeded = true;
        client.invalidateHandshakeArtifacts();
        client.showNotice(linkRecoveryNotice(client.state().peer));
        renderMode = 'lobby';
        renderLobbyFrame();
      }
    }, RECONNECT_GRACE_MS);
  });
}

/**
 * 建房 / 加入的入口：**第一次**进大厅时才造客户端（两样状态都只活在这一屏里）。
 *
 * ## 三个注入项为什么是这三样（修复轮；评审 1.1 的断点就在这三处）
 *
 *  - `decompressBase64`：**真解压**。第一版传的是 `() => null` ⇒ `decodeInviteText` 必走
 *    `decompress-failed` 那一支（`invite.ts:581-590`）⇒ **对方发来的每条邀请码都解不开**。
 *    解压是异步的，所以宿主先 `await` 出字节、再把它当"已经算好的结果"交给纯层
 *    （`decompressBase64` 就是 `net-browser.ts` 的那个真解压口）。
 *  - `onInbound`：**入站帧到了就重画一帧**。没有它，`createLobbySessionLink` 里那条
 *    `transport.onMessage` 只更新它自己的记账数 ⇒ 屏上停在上一帧的读数上（评审 1.3 的 A4）。
 *  - `localNick`：`hello.nick` 的唯一来源（`session.ts:2438` 说"`hello` 里还有 `nick`"）。
 */
function startLobby(role: 'host' | 'guest'): void {
  lobbyMode = role;
  // ★ T11-B：这一局的硬币屏还没画过（`renderLobbyFrame` 只画一次，见那里的说明）
  lobbyCoinShown = null;
  // ★ 修复轮：进大厅这一屏 ⇒ "这一局该重来"那个读数归零
  lobbyRestartNeeded = false;
  // ★ G5 T13-C：对局中掉线留下的"屏该画大厅那一屏"那个读数也归零（同族：漏了下一局会带着上一局的屏）
  linkRecoveryNeeded = false;
  chooseFaceResolve = null;
  faceChosen = false;
  if (lobbyClient === null) {
    lobbyClient = createLobbyClient({
      role,
      sessionId: newSessionId(),
      // ★ T11-A（I-5 的修正）：这一局的种子与"再要一条随机串"的动作都**在这里注入**。
      //   修正前大厅把两者写成 `seed-${sessionId}` / `nonce-${sessionId}`（模板串），而
      //   `sessionId` 明文写在邀请码里 ⇒ 加入方能在叫面之前算出种子（I-5）。
      //   `newMatchSeed()` 与 `newRandomToken` 都只从 `src/ui/match-seed.ts` 出熵（全项目唯一口子）。
      matchSeed: newMatchSeed(),
      randomToken: () => newRandomToken(),
      /**
       * ★★ **T11-B：要面**（唯一的那一个入口，D27 把硬币屏插在握手中间）。
       *
       * 这个 Promise 由**硬币屏上的一次点击** resolve（`lobbyCoinView()` 里的 `choose`）：
       * 大厅那头在 `seed-committed` 那一格等它（等的时候相位不动、种子不揭示），
       * 玩家按下「正面/反面」之后流程才继续。两端都不按，这条路就停在那块屏上
       * （超时语义归 T10）。
       */
      chooseFace: () => new Promise<CoinSide>((resolve) => {
        /**
         * ★★ **G5 T13-C 判据 2：这里是"新链路又一次要面"的落点，两个模块态必须在这里复位。**
         *
         * 事实：`askFaceOnce()` 是**每条链路一次**（`faceAsked` 在链路对象里）⇒ 每建一条
         * 需要叫面的链路，`chooseFace` 都会被调用一次。而 `faceChosen` / `chooseFaceResolve`
         * 是**本文件**的模块态、寿命比链路长 ⇒ 不复位它们，上一条链路留下的两样会一起挡掉新链路：
         *  - `faceChosen === true` ⇒ 屏上点芯片被 `lobbyCoinView()` 里那句直接吞掉；
         *  - `chooseFaceResolve` 还指着**上一条链路**那个已经 resolve 过的 Promise
         *    ⇒ 就算点下去，面也落不到新链路那一次 resolve 上。
         * 症状（实测形状）：开局期掉线之后玩家重新贴码回来，新硬币屏画得出来、点下去没反应，
         * 握手永远停在"等玩家叫面"那一格 —— 而屏上看起来完全正常。
         *
         * 复位点选在这里（而不是只在 `startLobby`）的理由：这一句正是"新链路"的**事件**，
         * 复位与它同源；`startLobby` 那一处只覆盖"第一次进大厅"。
         */
        faceChosen = false;
        chooseFaceResolve = resolve;
      }),
      localProtoVersion: PROTO_VERSION,
      localCardDataHash: CARD_DATA_HASH,
      hash: browserHash(),
      ticker: lobbyTicker,
      createTransport: () => createBrowserTransport(lobbyEnv()),
      signalingEndpoint: signalingEndpointSetting(lobbyEnv()),
      readSettings: () => netSettings,
      buildInvite: async (draft: LobbyDraftInput) => {
        const r = await createInvite({ ...draft }, lobbyEnv());
        return r.ok ? { ok: true, payload: r.payload, link: r.link } : { ok: false, message: r.message };
      },
      // ★ **真解压（两步）**（修复轮 A1）：`decodeBase64Url` 只做 base64url 解码，
      //   之后**必须**再走一次 `decompressBytes`（deflate-raw 解压）—— 只做第一步会让纯层
      //   拿到"仍是压缩态"的字节，`decodeInviteText` 会把它当解压结果去 `JSON.parse`，
      //   于是每条邀请码都返回 `bad-json`（实测）。返回 `null` 只表示"这段解不开"。
      decompressBase64: async (b64: string) => {
        const raw = decodeBase64Url(b64);
        if (raw === null) return null;
        const d = await decompressBytes(raw, lobbyEnv());
        return d.ok ? d.bytes : null;
      },
      readAddressBar: () => {
        const payload = readInviteFromAddressBar(lobbyEnv());
        if (payload === null) return null;
        // ★ 判据 6 的 ⑤：**只在读到载荷之后**抹地址栏（读不到时抹会把别人的 hash 抹掉）
        return { payload, stripped: stripInviteFromAddressBar(lobbyEnv()) };
      },
      // ★ **B3 的第二半（收方）**：把对方的 offer 吃进来，产一条可以回示的回示码。
      //   序列在 `acceptOffer`（B1）；承诺位由 `answerPayloadFields` 填**具名占位串**（B4）。
      //   ⚠️ 真对端连接的协商结果（ICE 能不能打通）**真浏览器未验证，由 T9 覆盖**。
      buildAnswer: async (offer: { sdp: string; ice: readonly string[] }): Promise<AnswerCodeResult> => {
        // ★ C1（结构缺口 ①）：answer 必须落在**承载 hello/act 的那条连接**上。
        //   原来这里把环境交给 acceptOffer 而不交出那条连接 ⇒ 它自己造了**第二条**连接
        //   ⇒ offer/answer 在 B 上完成、消息通道在 A 上 ⇒ 两端从来没为"传消息"连上。
        const tr = lobbyClient?.transport() ?? null;
        const pc = tr === null ? null : peerConnectionOf(tr);
        if (pc === null) {
          return { ok: false, message: '本机还没有建起用来传消息的那条对端连接（先让链路起来再产回示码）。' };
        }
        const r = await acceptOffer(pc, { sdp: offer.sdp }, lobbyEnv());
        if (!r.ok) return { ok: false, message: r.message };
        // ★ D 轮（I-3 甲）：回示码与邀请码同形状 ⇒ 也带上这一局的会话号（照抄房主那一串）
        const fields = answerPayloadFields({
          protoVersion: PROTO_VERSION,
          sessionId: sessionIdOfJoinedInvite(),
          sdp: r.sdp,
          ice: r.ice,
        });
        const enc = await createInvite({ ...fields, originAndPath: currentOriginAndPath() }, lobbyEnv());
        if (!enc.ok) return { ok: false, message: enc.message };
        /**
         * ★★ **G5 T16**：收方这条路上界到点、但手上有候选时也放行 —— 那句 `note`
         * 原样交给大厅写进屏（`net-lobby.ts` 的 `makeAnswer`）。理由与房主那一侧逐字相同。
         */
        return typeof r.note === 'string' && r.note.length > 0
          ? { ok: true, code: enc.payload, note: r.note }
          : { ok: true, code: enc.payload };
      },
      // ★ **B3 的第一半（房主侧收口）**：把对方回示的 answer 喂进**同一条**连接（`applyAnswer`）。
      //   为什么必须是同一条：拿一条新连接去 `setRemoteDescription` 会得到
      //   "answer 与 offer 不是同一次协商"这类失败。
      applyAnswer: async (answer: { sdp: string }) => {
        const pc = hostPeerConnection;
        if (pc === null) {
          return { ok: false as const, message: '本机还没有建起对端连接（先「建房」生成邀请码，再把回示码粘回来）。' };
        }
        const r = await applyAnswer(pc, { sdp: answer.sdp });
        return r.ok ? { ok: true as const } : { ok: false as const, message: r.message };
      },
      localNick: () => readNickName(localStore),
      /**
       * ★★ **G5 T13-A/B：重连接线要的三样能力**（全部由本文件注入，`net-lobby.ts` 不自己发明）。
       *
       *  1. `appliedSteps`：`resync-req.appliedSteps` 的自报数 —— 本端驱动的进度事实
       *     （下一条 `seq`），只有本文件手里有它（`netGame.driver.appliedSteps()`）；
       *  2. `resyncSource`：**房主侧**的重连凭据（D8："重连凭据 = 主机内存里的当前 MatchFile"）。
       *     档案来自这一局的记录器（`netGame.recorder`）⇒ `enterNetGame` 造驱动时挂上它；
       *  3. `onResyncRes`：**加入方侧**收到档案之后把状态真的重建出来那一步（`applyResyncToGame`）。
       *     它也是"追平与本端已有进度冲突 ⇒ 给可读失败"那条判据的落点。
       */
      appliedSteps: () => netGame?.driver.appliedSteps() ?? 0,
      resyncSource: () => netFileOf(),
      onResyncRes: (file) => applyResyncToGame(file),
      /**
       * ★★ **G5 T13-A：本端有没有"可续的对局"**（协调者 2026-09-20 第 2 条裁决的注入点）。
       *
       * 事实的唯一主人是这一层（`netGame`）：已经进过牌桌 ⇒ 走 `'resume'`（真重连）；
       * 还没进牌桌 ⇒ 走 `'first'`（重新来一次握手，因为那一格没有任何可续的进度，
       * 而 `resync-res` 在机制上不可能到位 —— 见 `net-lobby.ts` 的 `reconnect`）。
       */
      hasResumableGame: () => netGame !== null,
      /**
       * ★ **入站帧到了就重画一帧**（评审 1.3 的 A4）。
       *
       * ★ T11-C 补的分支：**进了牌桌之后**这一帧该画的是**牌桌**，不是大厅 ——
       * 对局的 `act` 帧也走这条传输（同一份 `transport.onMessage`），而它到达时
       * `renderMode` 已经是 `'net'`。缺这个分支的症状是"对手每动一下，屏上被大厅盖一次"
       * （状态没错、屏错了，且不报任何错）。
       */
      onInbound: () => {
        if (probeOn) onInboundCalls += 1;
        if (netGame !== null) {
          /**
           * ★★ **G5 T14：先落地、再重画**（落地口 = `NetDriver.pump`）。
           *
           * ★ **G5 T14 只读实验（"通知与入队谁先"）**：同一个 `transport.onMessage` 上有两条
           * 订阅（驱动那条把帧推进队列、大厅链那条就是本回调），浏览器按**注册顺序**调。
           * 若本回调先被调，这里的 `pump` 面对的是**空队列**（落地 0 条），帧随后才入队。
           * 四个数记进 `inboundProbe`（经 `__g5Match.diag()` 读），事后判先后。
           */
          if (probeOn) inboundSeq += 1;
          const drv = netGame.driver;
          inboundProbe.pendingBefore = drv.pendingCount();
          inboundProbe.enqueuedBefore = drv.enqueuedCount();
          inboundProbe.landed = drv.pump(state);
          inboundProbe.pendingAfter = drv.pendingCount();
          inboundProbe.at = inboundSeq;
          setTimeout(() => {
            inboundProbe.pendingLater = drv.pendingCount();
            inboundProbe.enqueuedLater = drv.enqueuedCount();
          }, 300);
          /**
           * ★★ **G5 T14 的修法：把 `pump + rerender` 推迟一个微任务**（本轮实测的理由）。
           *
           * ## 为什么"立刻 pump"不够（同轮实测的四个数）
           *
           * 同一个 `transport.onMessage` 上有**两条订阅**，浏览器按**注册顺序**逐个调：
           * 大厅链那条（就是本回调，先注册）**先**、驱动那条（`NetDriverOptions.onMessage`，
           * 后注册）**后**。于是本回调里立刻 `pump(state)` 面对的是**空队列**：
           * `pendingBefore=0 / pendingAfter=0 / landed=0`，而同一刻 `enqueuedCount` 1→2
           * （帧在通知**之后**才入队）。此后再没有任何东西 pump 它（自动推进关着时没有下一次
           * `submit`）⇒ 状态后来靠某次 `submit` 顺手 `drain` 前进，**屏却再没画过**。
           *
           * ## 为什么用微任务（而不是"让驱动入队后回调宿主"）
           *
           * `queueMicrotask` 在当前这个**派发任务**跑完（两条订阅都调过、帧已经入队）之后、
           * 下一次渲染之前执行 ⇒ `pump` 看到的是**已经入队**的那一帧，且**不引入任何定时器**
           * （不是"轮询重画"：它一次入站只跑一次）。它也不需要给驱动加第二个宿主回调
           * （那样会让"谁来重画"出现两条路）。
           *
           * ⚠️ **合并**（`inboundRenderPending`）：同一轮里连到几条帧只重画一次 ——
           * 重画是整帧重建，多画几次只是浪费；而 `pump` 会把队列里能落的都落掉，不漏帧。
           *
           * ★★ **评审判据 1 的护栏：微任务里必须落在"入站那一刻那一枚" state 上。**
           *
           * `applyResyncToGame`（追平那条路）会把模块级 `state` **整体换掉**，而微任务是**之后**
           * 才跑的 ⇒ 直接 `pump(state)` 会落到"新的一枚"上（那一枚由追平那条路自己重画）。
           * 现在：入站那一刻把该落的那一枚**捕获**在 `inboundStateAtArrival`；微任务里
           * 它若不是当前 `state`（中途换过了）就**放弃这一次**并记 `inboundStaleDropped`。
           *
           * ⚠️ **已知边界（登记）**：`rerender()` 之后队列里**又**到了帧、而本轮已经画完 ⇒
           * 那一帧要等**下一次**入站（或下一次 `submit`）才被落地/重画。这一格没有额外轮询
           * （不许用定时器掩盖），也没观测到触发。
           */
          if (!inboundRenderPending) {
            inboundRenderPending = true;
            inboundStateAtArrival = state;
            queueMicrotask(() => {
              inboundRenderPending = false;
              if (netGame === null) return; // 这一格退了大厅/重放：不再画牌桌
              if (inboundStateAtArrival !== state) {
                // 微任务跑之前 state 被换过（追平/复位）⇒ 这一次不做，换的那一方自己会画
                if (probeOn) inboundStaleDropped += 1;
                return;
              }
              netGame.driver.pump(state);
              /**
               * ★★ **G5 T19：对端那一侧也要播草稿 → 对局的转场**（用户真机提的第 3 件事）。
               *
               * 本端的状态是**收到那一帧之后**才跨过 `draft → turn` 的（`pump` 把它落了地），
               * 而转场原来只挂在"本端自己提交成功"那一支上（`cb.onDraftPick`）⇒ 非轮选者
               * 直接从草稿屏跳到牌桌。这里是**同一个判据**（本端状态跨过了那一刻）、
               * 同一个入口（`playDraftToGameTransitionOnce`，含"同一次转变只播一次"的闩）。
               *
               * 位置：`pump` **之后**（相位已经是 `'turn'`）、`rerender()` **之前**
               * ——与轮选者那支的顺序一致（先画最终态/盖上转场，再由转场收尾时重画牌桌）。
               */
              playDraftToGameTransitionOnce();
              rerender();
            });
          }
        } else { if (probeOn) netGameNullAtInbound += 1; renderLobbyFrame(); }
      },
    });
    // ── ★ 修复轮 A5：**断线时重连**（计划 §5 T8 那条硬约束的产出代码调用点）──────────────
    // 为什么订阅放在这里而不是 `net-lobby.ts` 内部：会话层与传输层都**不自己**订阅生命周期
    // （`session.ts:768-776`："订阅是一个有生命周期的副作用，纯状态机不该持有它"）——
    // 那是**调用方**的活，而调用方就是本文件。
    //
    // 为什么"重连"必须是**新建会话对象**：断线之后原对象上那条**已经中断的连接**是死的；
    // 而复用它等于把 D23 那套"只覆盖 2/5 格"的收方幂等假设，用在它**没有覆盖**的另外 3 格上
    // （例如"中途断线、已立承诺的加入方带着同一个 sessionId 回来"）⇒ 会 fail-closed 报
    // `face-hash-mismatch`（T6 的登记缺口 ③）。`client.reconnect()` 每次都新建对象，
    // 并在喂任何入站消息**之前**先 `markResuming()`。
    attachLobbyReconnect(lobbyClient);
  }
  renderLobbyFrame();
  if (role === 'guest') void lobbyClient.readFromAddressBar().then(() => { renderLobbyFrame(); });
}

/**
 * ★★ **G5 T15：「生成邀请码」之前先把链路等就绪**（有界，走注入的 `lobbyTicker`）。
 *
 * ## 它修的是什么（用户实测，2026-09-21）
 *
 * 玩家点「生成邀请码」，屏上出现 `net-browser.ts:1529` 那句
 * 「本侧链路还没建立（init 还没成功），现在没有连接描述。」
 * 而那一句是 `localDescription()` 的**兜底**口径，真因（`init()` 的 `reason + message`）
 * 在同一次调用里被它盖掉了 ⇒ 玩家与排查的人都只看到"没建立"，看不到为什么。
 *
 * ## 为什么不是"轮询重画"
 *
 * 读数只有两个：`client.state().transport`（传输自己的状态）与 `transport()`（链路在不在）。
 * `connect()` 回来之后先**同步**看一次：正常路径那一刻已经是 `connecting`/`online`
 * （`init()` 里 `emitStatus('connecting', …)` 排在 `createOffer` 之前），一次都不用等；
 * 只有"此刻还是 `idle`"这一格才需要等——那是**真 WebRTC 还在 init 的异步里**那一瞬间。
 * 那一格的重画由 `showNotice` 那句 + 本函数**只在状态真的变了时**再画一次驱动，
 * 没有周期性重画（屏不会闪）。上界与 ICE 那一步同一族：`lobbyTicker`。
 *
 * ⚠️ **`init()` 失败之后状态会永远停在 `idle`**（失败那几支在 `emitStatus` 之前就返回了）
 * ⇒ 这一格靠 `linkReady` 判失败、由调用方把真因写出来，而不是硬等满上界。
 *
 * 上界 `LOBBY_LINK_READY_TIMEOUT_MS`：`init()` 在本机实测是几十毫秒级（真 ICE 收集是
 * `localDescription()` 那一步的事，不在这里）；10 秒是"这一格不该轮到玩家来等"的量级，
 * 同时也是"等不到就要说出来"的那条线。
 */
const LOBBY_LINK_READY_TIMEOUT_MS = 10_000;

async function waitLobbyLinkReady(
  client: {
    state: () => LobbyState;
    transport: () => NetTransport | null;
    linkInitDiagnostic: () => { readonly ok: boolean } | null;
  },
  timeoutMs: number,
): Promise<{ ok: true; status: string } | { ok: false; status: string; waitedMs: number }> {
  /**
   * 链路就绪 = **两个读数里任一个**说"本侧连接已经造出来了"：
   *  1. `linkInitDiagnostic()` 非 `null`：**本次** `init()` 已经有结论（成功/失败都算"跑完了"）；
   *  2. 传输状态不是 `idle`/`closed`：`init()` 里 `emitStatus('connecting', …)` 已经报过
   *     （`idle` = 连本侧连接都还没造出来，`closed` = 这一局完了）。
   *
   * ⚠️ 为什么**两个都要**（CDP 实测的理由）：只有 ① 时，"`init()` 在飞、但状态已经是
   * `connecting`"那一格会被判成"没就绪"（那一格里 `createOffer` 还没回来、描述确实取不到）；
   * 只有 ② 时，`init()` 失败后状态永远停在 `idle` ⇒ 会把失败当成"还没跑完"硬等满上界。
   * 两个一起用：**失败那几支由 ① 立刻认出**（诊断说了 `ok:false`），**在飞那一格由 ② 挡住**。
   */
  const linkReady = (): boolean => lobbyLinkReadyNow(client);
  if (linkReady()) return { ok: true, status: client.state().transport };
  const t0 = Date.now();
  const done = await new Promise<boolean>((resolve) => {
    let settled = false;
    let tickerHandle = 0;
    let healthHandle = 0;
    const settle = (v: boolean): void => {
      if (settled) return;
      settled = true;
      lobbyTicker.cancel(tickerHandle);
      lobbyTicker.cancel(healthHandle);
      resolve(v);
    };
    /**
     * ① 上界：到点就判失败（**不许死等**）。
     * ② 健康检查：每 250ms 看一眼，**只在状态真的变了时重画一次**
     *    —— 屏上要有一行"正在建立链路…"，从"还没建"走到"建起来了"那一格要看得见。
     */
    tickerHandle = lobbyTicker.schedule(() => { settle(false); }, timeoutMs);
    let last = client.state().transport;
    const check = (): void => {
      if (settled) return;
      if (linkReady()) { settle(true); return; }
      const now = client.state().transport;
      if (now !== last) { last = now; renderLobbyFrame(); }
      healthHandle = lobbyTicker.schedule(check, 250);
    };
    healthHandle = lobbyTicker.schedule(check, 250);
  });
  const status = client.state().transport;
  return done ? { ok: true, status } : { ok: false, status, waitedMs: Date.now() - t0 };
}

/**
 * 链路现在就可以取连接描述了没有（**同步**读数，不等待）。
 *
 * 与 `waitLobbyLinkReady` 里那把尺子**同源**（就是同一个表达式）——写成函数是为了让调用点
 * 读起来是"先问一句"，而不是把判据复制到两处（复制过的地方迟早会漂移）。
 */
function lobbyLinkReadyNow(client: {
  state: () => LobbyState;
  transport: () => NetTransport | null;
  linkInitDiagnostic: () => { readonly ok: boolean } | null;
}): boolean {
  if (client.linkInitDiagnostic() !== null) return true;
  if (client.transport() === null) return false;
  const st = client.state().transport;
  return st !== 'idle' && st !== 'closed';
}

/**
 * ★★ **G5 T15：链路没建起来时，屏上写"真因 + 此刻的状态"**（不许写成"网络不好"这种猜的话）。
 *
 * 两个来源都是现成的读数，本函数只把它们拼成人话：
 *  - `reason` / `message`：`TransportActionResult`（`localDescription()` 或"`init()` 没成功"那一格给）；
 *  - `status`：传输此刻自己的状态（`NetTransport.status()`）；
 *  - `initMessage`：`init()` 的失败真因。今天有两个回流口（调用方按"更具体优先"取）：
 *    ① `client.linkInitDiagnostic()`（G5 T15 新加的跨 `connect()` 记忆 —— 重试时旧链路已被换掉，
 *    老那个口读不回来了）；② `net-lobby.ts` 的 `connect()` 写进 `s.notice` 的那句。
 *
 * 下一步只给"从真因直接读得出来的那一句"：`not-initialized` 这一族今天只有两个来源
 * （`init()` 没成功 / 失败被吞掉），所以能说的就是"重试一次、并把这行连同失败原因记下来"。
 * **不编**"换个浏览器 / 关掉扩展"这类具体建议 —— 那些要有真因支撑才说。
 */
function lobbyLinkFailureText(
  reason: string,
  message: string,
  status: string,
  initMessage: string | null,
): string {
  const cause = initMessage !== null && initMessage.length > 0
    ? `${message} 失败原因：${initMessage}`
    : message;
  const state = status === 'idle'
    ? '（传输此刻的状态是 idle：它连本侧连接都还没造出来，也就是 init() 没有成功。）'
    : `（传输此刻的状态是 ${status}：本侧连接已经造出来了，但连接描述这一刻还取不到。）`;
  return `${cause}${state}`
    + '下一步：再点一次「生成邀请码」重试；重试仍然失败时，请把这一整行连同"失败原因"里那句话记下来'
    + '（它就是这个问题的真因，不是猜测）。';
}

/**
 * 房主：生成一条邀请码，然后**建链路并接上**。
 *
 * ## ★ B2：SDP 不再是占位串（修复轮 B 档）
 *
 * 顺序：`connect('first')`（造传输 + 建会话 + `init()` 里 `createOffer`）→
 * **`transport.localDescription()`（等 ICE 收集完成，带上界）** → 用**真 SDP** 生成邀请码。
 *
 * 为什么必须等：`setLocalDescription()` 返回时 ICE 收集才刚开始，此刻的描述里**一条候选都没有**
 * ⇒ 直接用会得到一条**需要 trickle** 的 offer，而邀请码那条路是**一次性**的、收方没有第二条
 * 通道可以 trickle（D17/§8.3）。
 *
 * 失败处置（三种都可读，见 `waitForIceGathering`）：拿不到真描述时**不编一条假的**，
 * 而是把真因写到屏上、并**不**生成邀请码（生成一条连不上的邀请码比不生成更坏）。
 *
 * ## ★★ G5 T15：这一格的失败从此**可诊断**（用户实测那一句"本侧链路还没建立"）
 *
 * 两处改动（都在本函数里，改的**不是**判据）：
 *  1. **等链路就绪**：`connect()` 回来之后看**本次** `init()` 的结论（`linkInitDiagnostic`）；
 *     还没有结论（在飞）就**有界地等**（`waitLobbyLinkReady`，上界走注入的 `lobbyTicker`），
 *     等的过程屏上有一行「正在建立链路…」，有结论之后再取连接描述 —— "点早了"不再是玩家的问题；
 *  2. **真因上屏**：`init()` 的失败结果（`reason` + `message`）与传输此刻的状态一起写出来
 *     （`lobbyLinkFailureText`），不再被 `localDescription()` 的兜底句盖掉；
 *     本函数**抛出的任何异常**也被 catch 住如实写出来（原先它是 `void makeLobbyInvite()`
 *     ⇒ 抛出只会变成一条没人看的未捕获拒绝）。
 */
async function makeLobbyInvite(): Promise<void> {
  const client = lobbyClient;
  if (client === null) return;
  try {
    // ★ 修复轮：玩家真的重新开始一次尝试 ⇒ 清掉"这一局该重来"那个读数（屏回到硬币/大厅的正常分支）
    lobbyRestartNeeded = false;
    /**
     * ★ G5 T13-C：玩家真的重新生成一次邀请码 ⇒ "对局中掉线、屏该画大厅"那个读数也复位。
     * 注意复位的**时机**：链路 `ready` 之前 `enterNetGame()` 不会把人带回牌桌（见那里的
     * `raw.ready` 闸），所以这一刻屏仍然留在大厅 —— 玩家能接着贴回示码。
     */
    linkRecoveryNeeded = false;
    /**
     * ★★ **G5 T13-A：重连时这条新链路走 `'resume'`**（"带着同一局回来"）。
     *
     * 判据与加入方那一侧同源（`knowsSession`：这一局的会话号本端用过）—— 区别是房主**不发**
     * `hello`、也没有 `markResuming()`（那个口只在加入方会话上），所以 `'resume'` 在这里的
     * 实际含义是"新链路知道自己是重连"：**不弹硬币屏**（硬币在断线前就定过了，
     * `createLobbySessionLink` 的 `suppressesCoinScreen()`）、`hello` 那侧的行为一个字不影响。
     *
     * ⚠️ **必须同时要求"已经进过牌桌"**（协调者 2026-09-20 第 2 条）：开局期没有可续的进度，
     * 而房主手里也还没有档案 ⇒ 那一格走 `'resume'` 只会让加入方永远停在"正在追平"。
     */
    const mode = netGame !== null && client.knowsSession(client.state().sessionId) ? 'resume' : 'first';
    /**
     * ★★ **G5 T15：这一次尝试的"链路就绪"判定只按**本次**`connect()` 的结果走。**
     *
     * ## 为什么必须清掉上一次的结论（CDP 实测踩到的假绿灯）
     *
     * 玩家再点一次「生成邀请码」时，`connect()` 会**换一条新链路**（每次都新建）——
     * 旧链路可能是 `connecting`/`online`，于是"链路是不是就绪了"这个问题会被**上一次**的
     * 残留读数回答成"已经就绪"，`localDescription()` 却在新传输上返回 `not-initialized`
     * （实测：连点两次的那一格就是这样）。
     *
     * ⇒ 每次尝试前把读数清回 `null`，之后只认**这一次** `init()` 写进来的那一份。
     * ⚠️ 清的是**诊断读数**，不是链路本身：链路该换还得换（D23 的充分性前提）。
     */
    client.clearLinkInitDiagnostic();
    await client.connect(mode);
    /**
     * ★★ **G5 T15 的"提前点"那一格**：链路还没就绪就先等它（有界）。
     *
     * 判据是**这一次 `init()` 的结论**（`linkInit`）：`null` = 这次还没跑完（在飞）；
     * `ok: false` = 这次真失败了（那就没什么好等的，直接把真因说出来）；
     * `ok: true` = 本侧链路已经落地，可以直接取连接描述。
     *
     * 上界取 10 秒：`init()` 在本机实测是几十毫秒级（真 ICE 收集是 `localDescription()` 那一步
     * 的事，不在这里），而"等不到"这件事本身要被说出来而不是无限等。
     */
    if (!lobbyLinkReadyNow(client)) {
      client.showNotice('正在建立链路…（好了会自动接着生成邀请码，不用再点）');
      renderLobbyFrame();
      const ready = await waitLobbyLinkReady(client, LOBBY_LINK_READY_TIMEOUT_MS);
      if (!ready.ok) {
        const stNow = client.state();
        const diag = client.linkInitDiagnostic();
        client.showNotice(lobbyLinkFailureText(
          diag !== null && !diag.ok ? diag.reason : 'not-initialized',
          `等了 ${String(Math.round(ready.waitedMs / 1000))} 秒，本侧链路还没有建立起来`
            + '（init 至今没有成功，所以没有连接描述可给）。',
          ready.status,
          diag === null ? null : diag.message,
        ));
        renderLobbyFrame();
        return;
      }
      client.showNotice(null);
    }
    // ★ B2：取一份**非 trickle** 的本侧描述（等 ICE 收集；上界走注入的 ticker）
    const transport = client.transport();
    const stBefore = client.state();
    /**
     * ★★ `init()` 的失败真因有**两个**回流口，这里按"更具体优先"取：
     *  1. `client.linkInitDiagnostic()`：**这一次** `connect()` 里 `init()` 的 `message`
     *     （G5 T15 新加的跨 `connect()` 记忆 —— 重试时旧链路早被换掉，`s.notice` 那个口
     *     已经读不回上一次的结论了）；
     *  2. `s.notice`：`connect()` 在 `init()` 失败时写进状态那一句（老口径，仍然是真因）。
     * 两者都没有时**不编**：交给 `lobbyLinkFailureText` 只报"还没建立"。
     */
    const initDiag = client.linkInitDiagnostic();
    const initMessage = initDiag !== null && !initDiag.ok
      ? `init 返回 ${initDiag.reason}：${initDiag.message}`
      : (stBefore.notice !== null && !stBefore.notice.startsWith('正在建立链路') ? stBefore.notice : null);
    if (transport?.localDescription === undefined) {
      client.showNotice('这条实现不给连接描述（没有 `localDescription`），所以生成不了邀请码。');
      renderLobbyFrame();
      return;
    }
    const desc = await transport.localDescription();
    if (!desc.ok || typeof desc.sdp !== 'string' || desc.sdp.length === 0) {
      // **不编一条假的**：把真因（含 `init()` 的失败原因）与"传输此刻的状态"一起写到屏上；
      // 邀请码这一轮不生成
      client.showNotice(lobbyLinkFailureText(
        desc.ok ? 'no-description' : desc.reason,
        desc.ok ? '本侧没有可用的连接描述，生成不了邀请码。' : desc.message,
        client.state().transport,
        initMessage,
      ));
      renderLobbyFrame();
      return;
    }
    await client.startHost({
      originAndPath: currentOriginAndPath(),
      p: PROTO_VERSION,
      // ★ D 轮（I-3 甲）：邀请码里带上**这一局的房主会话号**（与建会话对象用的是同一串）
      sessionId: client.state().sessionId,
      sdp: desc.sdp,
      ice: candidatesOf(desc.sdp),
      hostPromise: 'host-promise-pending',
      guestPromise: 'guest-promise-pending',
    });
    client.startWait();
    /**
     * ★★ **G5 T16：上界到点放行时，屏上必须有一句如实的话。**
     *
     * `localDescription()` 回 `timedOut: true` 时手上已经有 ≥1 个候选（否则它回的是**失败**，
     * 上面那一支已经处理了），邀请码照常产出 —— 但那句 `note` 要说清"只拿到了这些、
     * 跨网能不能连**还不知道**"。**不许**把它省掉：省掉之后屏上就只剩一条邀请码，
     * 玩家会以为它跨网也一定能连。
     */
    if (typeof desc.note === 'string' && desc.note.length > 0) client.showNotice(desc.note);
    renderLobbyFrame();
  } catch (e) {
    /**
     * ★★ **G5 T15：这里原来是空的**（调用点是 `void makeLobbyInvite()`）⇒ `connect()` 若抛，
     * 玩家只得到一条没人看的未捕获拒绝。现在如实写出来，并且**只说发生了什么**。
     */
    client.showNotice(`生成邀请码这一步抛了一个错误，没有生成出邀请码：${e instanceof Error ? e.message : String(e)}`);
    renderLobbyFrame();
  }
}

/**
 * 房主：**把对方回示的回示码粘回来**（B3 的第二半）。
 *
 * `submitAnswerCode` 里会把 answer 喂进**同一条**连接（`applyAnswer`）——
 * 拿一条新连接去 `setRemoteDescription` 只会得到"answer 与 offer 不是同一次协商"这类失败。
 */
async function applyLobbyAnswerCode(code: string): Promise<void> {
  const client = lobbyClient;
  if (client === null) return;
  await client.submitAnswerCode(code);
  renderLobbyFrame();
}

/**
 * 加入方：**产一条回示码**（B3 的第一半），交给玩家发回给房主。
 *
 * 今天没有回程通道（邀请码那条路的既定形态）⇒ 回示码由玩家自己复制回去。
 */
async function makeLobbyAnswerCode(): Promise<void> {
  const client = lobbyClient;
  if (client === null) return;
  await client.makeAnswer();
  renderLobbyFrame();
}

/**
 * 加入方：贴一条邀请码 ⇒ 解载荷 + 明文协议版本比对，然后**建链路并接上**。
 *
 * `connect('first')` 里会**立刻发出第一条 `hello`**（`session.ts:2438-2440` 说的"调用方自己拼"
 * 那一步）—— 这是评审 1.1 第 4 点的那个断点：不发它，加入方的握手在产出路径上永远不会开始。
 */
async function joinLobbyWithInvite(text: string): Promise<void> {
  const client = lobbyClient;
  if (client === null) return;
  // ★ 修复轮：玩家真的重新开始一次尝试（贴了一条新的邀请码）⇒ 清掉"这一局该重来"那个读数
  lobbyRestartNeeded = false;
  // ★ G5 T13-C：同 `makeLobbyInvite()` —— 玩家真的开始了一次交接 ⇒ "屏该画大厅"那个读数复位。
  //   这一次交接走 `'resume'`（这个会话号本端用过）时不弹硬币屏；走 `'first'`（开局期）时
  //   硬币屏**应该**出现（那是一次新握手）。
  linkRecoveryNeeded = false;
  await client.joinWithInvite(text);
  // 邀请码解不开时**不建链路**（建了也没用：连不上对端，而"解不开"这件事已经写在屏上了）
  if (client.state().joined?.ok === true) {
    /**
     * ★★ **G5 T13-A：这次是"带着同一局回来"还是第一次接上**（`first` 与 `resume` 的分界）。
     *
     * 判据只有一条：**这张邀请码里的会话号，本端上一次建链路用的就是它**（`knowsSession`）
     * —— 那意味着同一局在对端手里还在，本端这次是回去续（要先 `markResuming()`、
     * `hello` 带 `resuming: true`，房主才会回 ack 并把档案交出来）；否则就是第一次接上。
     *
     * 反过来会怎样（两个方向都有具体后果）：拿 `first` 去接同一局 ⇒ 房主的 `acceptHello`
     * 把这条 hello 判成迟到的、**不回 ack** ⇒ 加入方永远停在 `handshaking`；
     * 拿 `resume` 去接新的一局 ⇒ `needsResync` 变成假读数（`session.ts:925-935`）。
     */
    const joined = client.state().joined;
    const sid = joined !== null && joined.ok === true ? joined.payload.sessionId : null;
    /**
     * ⚠️ 与 `makeLobbyInvite` 同源：**只有"已经进过牌桌"才谈得上带着同一局回来**
     * （协调者 2026-09-20 第 2 条）。开局期那一格走 `'first'` ⇒ 重新握一次手，不装"续上了"。
     */
    if (sid !== null && netGame !== null && client.knowsSession(sid)) await client.connect('resume');
    else await client.connect('first');
  }
  renderLobbyFrame();
}


/**
 * **整帧重渲染的唯一入口**：按 `renderMode` 路由到当前页面。
 *
 * - `renderMode === 'net' && state.phase !== 'draft'` → `renderNetBoard`（远程页单视角预览）；
 * - 否则 → `renderApp`（热座页；**草稿阶段恒走这里** —— 草稿页在 G2 不分支，预览沿用完整热座流程）。
 *
 * 为什么必须统一入口：远程页要**可玩**（用户验收第 3 项要求把牌真的打出去看特效），
 * 而热座页的每次状态变更都会 `renderApp(root, state, cb)` 整帧重画 —— 只要有一处漏改，
 * 那一处就会把远程页**悄悄换回热座棋盘**（不报错、只是一屏布局突变）。
 *
 * ⚠️ 本函数**不做 DOM 清理**：清空 root 是渲染器自己的契约（`renderNetBoard` 首行
 * `root.textContent = ''`，与 `renderApp`/`renderDraft`/`renderBoard` 同形）。
 */
/**
 * ★★ **G5 T14 的只读计数与探针位**（`__g5Match.diag()` 读它们）。
 *
 * ## 纪律（评审判据 3 的整改）
 *
 * 本文件自己的纪律是 `probeOn`（`probeOn` = 页面带了 `#g5probe=1`）：**默认路径一次都不写**
 * （见 `probeOn` 的声明）。下面每一个计数都**只在 `probeOn` 为真时**才 +1
 * （写法：`if (probeOn) x += 1;`），`armedState` / `lastAppState` 同理 —— 默认路径零开销、
 * 也零"门禁专用状态"。
 *
 * ## 删掉了三格没牙的读数（评审点名）
 *
 * 上一版还有 `stateGen`（**只声明从不自增**，注释说"每次 `state =` 都 +1"是假话）、
 * `renderedIsAppState`（刚写完 `lastAppState = state` 就比，**恒真**）、
 * `appStateMismatch`（`armedState` 每次 `arm` 同步 ⇒ 近乎恒 0）—— 三条都**没有腿**、
 * 只有一次性场景在读，属于"假读数" ⇒ **整组删掉**（连同 `lastAppRead` / `lastAppState`）。
 * 对象同一性那件事由 `armedRead` / `stateRead` 两个**真读数**表达（前者是驱动 arm 的那一枚，
 */
let rerenderIn = 0;
let rerenderPainted = 0;
let renderAppCalls = 0;
let renderNetBoardCalls = 0;
/** `rerender()` 走**对局相那一条分支**并真的画完了几次（与 `renderAppCalls` 互斥的一对） */
let renderNetPainted = 0;
/**
 * ★★ **驱动被 `arm()` 的那一枚状态对象**（对象同一性用）。
 *
 * `main.ts` 里 `netDriver.arm(state)` 出现 3 处（进牌桌 / 重连换驱动 / 追平）—— 三处都把当时
 * 那一枚 `state` 记在这里。它与模块级 `state`（渲染器与探针读的那一枚）**是不是同一个对象引用**，
 * 与后者比较即知"是不是同一个时刻"。
 */
let armedState: GameState | null = null;
/** 最近一次 `rerender()` 实际走的那一支（`renderMode` 的值：`app` / `net` / `lobby` / `replay`） */
let lastRerenderBranch = 'none';
/**
 * ★★ **宿主这一侧"收到帧之后通知重画"那一句被调了几次**（`onInbound` 的注入里 +1）。
 * 它与会话链的 `linkIn`（收到的帧数）之间的差就是"接到了但没通知宿主"。
 */
let onInboundCalls = 0;
/** `onInbound` 被调到时 `netGame === null`（⇒ 走了 `renderLobbyFrame()` 那一支）的次数 */
let netGameNullAtInbound = 0;
/** ★ G5 T14 只读实验：`onInbound` 被调了几次（与驱动的 `enqueuedCount()` 比先后） */
let inboundSeq = 0;
/** ★ G5 T14：已经排了一次"微任务里 pump + 重画"（同一轮的多条帧只画一次） */
let inboundRenderPending = false;
/**
 * ★★ **G5 T14 判据 1 的护栏（评审判据 1 的主缺口）**：微任务里要落地的**那一枚** state。
 *
 * 为什么不能直接 `pump(state)`：微任务是**之后**才跑的，而 `applyResyncToGame`（追平）
 * 会在那之前**整体换掉** `state`；`renderMode` 也可能变（退大厅 / 进重放）。
 * ⇒ 入站那一刻把"该落到哪一枚"捕获下来，微任务里只落它、也只画它；捕获的那一枚
 * 若已经**不是**当前 `state`（说明中途换过了），就**放弃这一次**（新的那一枚会由
 * 它自己的那条路径重画），并把这件事记进 `diag().inboundStaleDropped`。
 */
let inboundStateAtArrival: GameState | null = null;
/** 上面那条护栏丢掉过几次（`> 0` = 真发生过"入站之后换了 state"）。只读读数。 */
let inboundStaleDropped = 0;
/** ★ G5 T14 只读实验：最近一次 `onInbound` 里"通知与入队谁先"的四个读数 */
const inboundProbe: {
  pendingBefore: number | null;
  pendingAfter: number | null;
  pendingLater: number | null;
  enqueuedBefore: number | null;
  enqueuedLater: number | null;
  landed: number | null;
  at: number;
} = {
  pendingBefore: null, pendingAfter: null, pendingLater: null,
  enqueuedBefore: null, enqueuedLater: null, landed: null, at: 0,
};

function rerender(): void {
  if (probeOn) rerenderIn += 1;
  /**
   * ★★ **G5 T14 修复轮：把"这一次 `rerender()` 走了哪一支"记下来**（只读）。
   *
   * ⚠️ **不能**在这里再写一次 `renderMode === 'replay'` —— 有两条结构腿钉着"这串字面量在
   * `rerender` 里恰好 1 处"（`tests/ui/main-lobby-wiring.test.ts` 的 7、
   * `tests/ui/main-driver-wiring.test.ts` 的 4）⇒ 本行只读 `renderMode`，**不**复写那个条件。
   */
  if (probeOn) lastRerenderBranch = renderMode;
  if (renderMode === 'net' && state.phase !== 'draft') {
    // ── G2 修正 **R12-6**：预览工具条与运行时自查**只在开发者模式解锁后**才启用 ──
    // 用户第五次验收："还有预览工具条，我希望隐藏它，并将它的功能内化给开发者模式"。
    // 工具条的两个功能各自有了去处：
    //  · **视角切换** → 开发者指令 `视角` / `seat 1|2`（`initDevMode` 里的 `netSeat` 回调）；
    //  · **运行时自查行**（`verifyHooks`）→ 解锁后随工具条一起出现（普通对局里结果仍写 console）。
    // ⚠️ 因此**普通玩家/普通对局看到的页面上没有这条工具条**；解锁（Ctrl+Shift+P → 密码）
    //    会触发一次 `rerender()`（见 `devmode.ts` 的解锁分支），工具条当场出现。
    const dev = isDevUnlocked();
    if (probeOn) renderNetBoardCalls += 1;
    renderNetBoard(root, state, cb, {
      viewSeat: netViewSeat,
      ...(dev ? {
        onPreviewChange: (next: { viewSeat?: 0 | 1 }) => {
          if (next.viewSeat !== undefined) netViewSeat = next.viewSeat;
          rerender();
        },
      } : {}),
      verifyHooks: dev,
    });
    /**
     * ★★ **G5 T13：牌桌上那一行连接状态**（掉线 / 追平时的玩家可见读数）。
     *
     * 为什么追加在**渲染之后**而不是给 `renderNetBoard` 加参数：本轮的边界是"接线"——
     * 棋盘渲染器（`src/ui/render-net.ts`）一个字都不动；而这一行只读**一个**读数
     * （`netLinkLine()` → 会话层的 `peerStatus()` → `lobbyLinkText` 那张唯一映射表），
     * 对局正常（`online === true`）时**不进 DOM**，所以它不占屏、也不改既有布局纪律。
     *
     * 它答的是本轮必需的那件事：掉线期间玩家的观感不许只是"对面好像卡住了"。
     */
    const linkText = netLinkLine();
    if (linkText !== null) {
      const line = document.createElement('div');
      line.className = 'net-link-line';
      line.textContent = linkText;
      root.appendChild(line);
    }
    if (probeOn) rerenderPainted += 1;
    if (probeOn) renderNetPainted += 1;
    // ★ G5 T14：对局相那一行"轮到谁"（人话，不是座位号；见 `appendTurnLine`）
    appendTurnLine(root);
    return;
  }
  // ── G5/T8：联机大厅分支 ─────────────────────────────────────────────────────
  // 它是一个**独立屏**（没有 `state`），所以在这里早退：下面的 `renderApp(root, state, cb)`
  // （全文件唯一一处）一个字都不动。大厅自己的渲染器负责清 root（`renderNetLobby` 首行）。
  if (renderMode === 'lobby') {
    renderLobbyFrame();
    return;
  }
  if (probeOn) renderAppCalls += 1;
  // ★ G5 T14 修复轮：把"渲染器收到的这一枚"与模块级 `state` 做**对象同一性**比对
  renderApp(root, state, cb);
  if (probeOn) rerenderPainted += 1;
  // ★ G5 T14：草稿相那一行"轮到谁"（联机局才有；`appendTurnLine` 的第一句就是 `netGame === null`
  //   早退 ⇒ 热座页与重放页一个节点都不多画）。
  appendTurnLine(root);
  // ── G4 Task 4：重放页的收尾（**渲染之后**，且只在这里）────────────────────────
  // ① `refreshReplayBar()`：控制条的**唯一**刷新入口。`renderReplayBar` 不清 parent、也不移除
  //    自己上次插入的节点 ⇒ 任何"不以整帧 `renderApp` 为前置"的刷新路径都会在屏上叠出
  //    **第二层遮罩 + 第二条控制条**，且旧监听器仍然活着（T3 一审第 5 条的契约风险）。
  //    放在这里 = 每帧随 root 的整帧重画一起重建，天然没有残留。
  // ② `replayDriver.settle()`：**编排的唯一重排点**。`cb.onAction` 的**每一条**终止路径最终都
  //    汇到这次 `rerender()`（见 `cb.onAction` 里的逐条注释）⇒ "每个终止点都要 settle()"这条
  //    要求由一个 choke point 自动满足，而不是靠 5 处记得写对。
  //    ⚠️ **只在"本步的 FX 已经播完"时才回话**（T4 一审阻断 **B1**，评审探针 S2-S6 实测）：
  //    `settle()` 的幂等只挡得住"下一步**已经排进 ticker**"那一种重复；而在 FX 窗口内
  //    （抽牌 330ms 起 / 揭示每张 ~400ms / speed ≈2.26s）驱动**正欠着这一次握手、ticker 里
  //    没有在飞时钟** ⇒ 此刻任何额外的 `rerender()`（devmode 解锁那一次、或**控制条自己的点击**：
  //    第五道门禁实测 `replay.bar.aboveShield = 7`（控制条在遮罩之上、点得到），而 `4×` 的
  //    225ms 比最短的抽牌动画还短）都会**真的把下一步排出来** ⇒ 两套抽牌/揭示动画并发飞，而
  //    `drawAnimBusy` / `revealFlyBusy` 是**单布尔**、由较早结束的回调清掉 ⇒ 第三条还能叠上
  //    （这两个标志存在的理由被绕过）。更坏的一种：被提前排出的那一步若落在 `refresh` 上，
  //    会被 `drawAnimBusy` 挡回（无提交）⇒ 游标不动 ⇒ 误报停机诊断并停在那一步。
  //    ⇒ 三个 FX 完成回调都是**先清标志、再** `afterFx → rerender → settle` ⇒ 这条守卫在正常
  //      流上一次都不会误挡；"回调丢失"仍由驱动的 8s 看门狗兜（它只广播，由宿主再走一步）。
  if (renderMode === 'replay') {
    refreshReplayBar();
    if (!drawAnimBusy && !revealFlyBusy) {
      // 本步 FX 播完了 ⇒ 才处理控制条的待办 / 回话（握手）。三种形态互斥：
      //  · 待办「单步」→ 走一步（自己保持暂停）；
      //  · 待办「继续」→ 真正开播；
      //  · 都没有 → 这一步的 FX 播完了 ⇒ `settle()`，驱动据此排下一步。
      if (replayStepPending) {
        replayStepPending = false;
        replayResumePending = false; // 单步优先，且它自己把驱动保持在暂停
        replayStep();
      } else if (replayResumePending) {
        replayResumePending = false;
        replayDriver?.play();
      } else {
        replayDriver?.settle();
      }
    }
  }
}

/* ──────────────────────────────────────────────────────────────────────────── *
 * G4 Task 4：重放页（进入 / 一步 / 控制条 / 退出）
 *
 * 执行路径与现场**完全同一条**（D3）：重放的一步 = `cb.onAction(档案里的下一条)`。
 * 为什么不能"直接 executeAction + rerender"：本文件的两个累加器（`pendingDraws` /
 * `pendingReveals`）**只在 `cb.onAction` 内部排空**，绕过编排直呼引擎会把它们灌满且永不排空，
 * 泄漏进下一次真实行动 —— 一个**不报错**的缺陷。
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * 重放的一步：把**档案里的下一条**交给同一条编排（D12 的闸门语义）。
 *
 * 由注入时钟的 tick 触发（`replayDriver.onTick(replayStep)`），**不是**宿主的第二个时钟 ——
 * 步进节奏（`stepMs / rate`）与暂停/倍速都归纯层的 `ReplayDriver`，宿主只负责"走一步"。
 *
 * ⚠️ 走到这里时驱动**已经把这一步的许可发出来了**（`emitTick()`），本函数必须真的让它落地：
 * 判等的闸门会把 `cb.onAction` 算出来的提交与档案里的下一条比对，等价才应用并推进游标。
 * 若一步走完**游标没动**（例如宿主状态与档案错位、或 `cb.onAction` 的早退分支），就在这里
 * 停下并留下诊断 —— 否则注入时钟会每 `stepMs` 重试一次同一个拒绝，永不前进也永不报错。
 */
function replayStep(): void {
  const drv = replayDriver;
  if (renderMode !== 'replay' || !drv) return;
  const a = drv.next();
  // 档案走完 / 引擎报错 ⇒ 让这一帧把"已重放完"或错误显示出来（`settle()` 在 done/error 下不排步）
  if (!a) { rerender(); return; }
  const before = drv.cursor().position;
  /**
   * ★★ **G5 T12：草稿选牌那一条走"本地草稿应用"那条既有路，不经过 `cb.onAction`。**
   *
   * ## 为什么这样分流（而不是把 `UiCallbacks.onAction` 加宽成"也收草稿步"）
   *
   * `cb.onAction` 的入参类型是 `LegalAction`（引擎那 8 个 kind，`src/ui/render.ts`），
   * 而 `'draft-pick'` **不在**那 8 个里。两条路：
   *  - 加宽 `UiCallbacks.onAction` ⇒ 要改 `src/ui/render.ts` —— 那是 T12 任务书 §2 的**红线**
   *    （协调者 2026-09-20 明确否掉）；
   *  - 在这里分流 ⇒ 渲染侧**一行都不用改**：`cb.onDraftPick(defId)` 本来就是草稿屏拖拽落点
   *    调的那**同一个回调**（`src/ui/render.ts:4679`，那是**调用**它，不需要改它的类型）。
   *    ⇒ 取这一条。
   *
   * ## 为什么"走 `cb.onDraftPick`"仍然是**同一条流水线**（不是第二套实现）
   *
   * `cb.onDraftPick` 里做的事只有一件与状态有关的：`driver.submit(state, { player, kind: 'draft-pick', … })`。
   * 而重放页此刻的 `driver` 正是 `ReplayDriver` ⇒ 闸门逐项比 `kind` + `args` + `player`，
   * 放行之后应用的是**记录里那一条**（不是这里算出来的那条）。
   *
   * ⚠️ **但闸门放行的前提是"起跑点已经跳过了草稿前导"**（G5 T12 小修复轮改口的正是这句：
   * 上一版这里写的是"`player` 由 `currentDraftDrafter()` 现算 ⇒ 闸门放行、游标前进"，
   * **那句是错的**，评审实测抓到了它）。事实是：重放页的起跑状态是 `stateAfterDraft(file)`
   * —— **已经**把草稿走完（相位 `'turn'`、`draftRound = 6`），而此刻 `currentDraftDrafter()` 走的是
   * `draftRoundOwner(starter, 6)`，`create.ts:42-45` 对越界轮次回落 `?? 1` ⇒ 它给出的是
   * `1 - draftStarter`，**不是** `f.actions[0].player`（那是第 0 轮的 owner = `draftStarter`）
   * ⇒ 闸门判 `not-the-next-action`；就算把 `player` 换成记录里那个，`performDraftPick` 也会在
   * `'turn'` 相上抛 `not in draft phase` ⇒ 只剩 `engine-error`。**这条路在"游标从 0 起"的形态下结构上无解。**
   *
   * ⇒ 修法是**起跑点**那一半（`startReplayFile` 的 `initialPosition: draftPreludeCount(...)`）：
   * 草稿前导那几条根本不该交给页面编排（重放页不展示草稿）。跳掉它们之后，这条分流的**正常形态**
   * 是"档案里出现了草稿前导之外的 `'draft-pick'`"（被篡改的档案）—— 那时闸门拒绝、重放停机，
   * 由下面那段兜底诊断报出来。
   *
   * ⚠️ 判据是 `kind` 的字面量，而 `AppActionKind` 只有 9 个取值 ⇒ 这个 if/else 是穷尽的。
   */
  if (a.kind === DRAFT_PICK_KIND) {
    cb.onDraftPick((a.args as { defId: string }).defId);
  } else {
    /**
     * 其余 8 个 kind **一定是** `LegalAction`（`ActionKind` 就是那 8 个的字面量联合），
     * 这句收口要说明的是"档案记录多带了 `seq` / `via` / `args` 三个字段，而 `onAction`
     * 只读 `kind` 与那几个参数槽，从不整体透传"。`seq` / `via` 是档案层元数据、不进引擎
     * （`match-file.ts:19-30`），`args` 是**同一条记录**里的参数容器 —— 与 `LegalAction`
     * 的那些槽在值上同源（现场就是照 `LegalAction` 逐字段记的，`main.ts` 的 `cb.onAction`）。
     */
    cb.onAction(a as unknown as LegalAction);
  }
  if (drv.cursor().position === before) {
    // 停机：只在**第一次**留诊断（否则每次都重写，日志与屏上都是噪音）。注意重放到这一步
    // 之前可能已经有 FX 在飞 —— 停机之后 `pause()` 会取消在飞时钟，不会再自动重试。
    if (replayHostError === null) {
      replayHostError = '重放已停在这一步：档案里的下一条没有被接受（重放状态与档案不同步）。';
      drv.pause();
      rerender();
    }
    return;
  }
  // 游标前进了 ⇒ 这一步真的走掉了（T4 一审 N5）：**把上一次的停机诊断清掉** —— 否则一次瞬时
  // 错位（例如用户按了「继续」之后状态已经追平）会让控制条**永久**显示"已停在这一步"，
  // 而重放其实早就在正常前进。清掉之后补画一帧，好让屏上立刻反映"已恢复"。
  // （`rerender()` 里的 `settle()` 有 FX 守卫、且此时下一步通常已经排好 ⇒ 这一帧是幂等安全的。）
  if (replayHostError !== null) {
    replayHostError = null;
    rerender();
  }
}

/**
 * 重放控制条的状态装配（`ReplayBarState`）。**只读** `cursor()` + 宿主诊断，不参与判定。
 * 位置用 `cursor().position`（= 已应用的档案步数，不含草稿重建）。
 */
function refreshReplayBar(): void {
  const drv = replayDriver;
  if (!drv) return;
  const c = drv.cursor();
  renderReplayBar(
    root,
    {
      position: c.position,
      total: c.total,
      rate: c.rate,
      paused: c.paused,
      done: c.done,
      error: c.error ?? replayHostError,
    },
    replayNav(),
  );
}

/**
 * 控制条的五个回调（T3 的 `ReplayBarNav`）。
 *
 * ⚠️ 每一个回调都**只改驱动状态然后整帧 `rerender()`**：控制条自身**不许**调
 * `refreshReplayBar()`（那会叠出第二层遮罩，见 `rerender` 的注释）。
 * `next`（单步）按 D8 **无视倍速走一步**：先暂停（停掉在飞时钟）再直接走一步 ⇒ 走完仍停在暂停态。
 *
 * ★ `play` 为什么不能在本步 FX 播放中直接调 `driver.play()`（T4 一审 S4 / 本轮的补充实测）：
 *   `play()` 会**立刻排下一个 tick**（这是它该做的事 —— 否则第一个 tick 永远不来，见驱动的注释），
 *   而此刻宿主**还欠着这一步的 `settle()`**（FX 没播完）⇒ tick 会在 FX 中间到点 ⇒ 下一步被提前走
 *   （并发动画；若那一步是 `refresh`，它还会被 `drawAnimBusy` 挡回 ⇒ 游标不动 ⇒ 停机诊断）。
 *   ⇒ 忙的时候只**记一个待办**（并把驱动保持暂停），等本步 FX 播完的那一次 `rerender()` 里
 *   再真正 `play()`。**驱动侧的干净修法**（`play()` 也尊重"宿主欠一次 settle"这个闩）属 T2，
 *   本模块的待办是与之等价的本地缓解，两者不冲突。
 */
function replayNav(): ReplayBarNav {
  return {
    pause: () => { replayDriver?.pause(); rerender(); },
    play: () => {
      if (drawAnimBusy || revealFlyBusy) {
        replayResumePending = true;
        replayDriver?.pause(); // 保持暂停：绝不在 FX 窗口里排 tick
      } else {
        replayDriver?.play();
      }
      rerender();
    },
    next: () => {
      replayDriver?.pause();
      // ⚠️ 本步 FX 还在播时不能立刻走（同 `play` 的理由）：两套动画并发飞，且下一条若是
      // `refresh` 会被 `drawAnimBusy` 挡回 ⇒ 游标不动 ⇒ 误报停机诊断。⇒ 记待办，FX 播完再走。
      if (drawAnimBusy || revealFlyBusy) replayStepPending = true;
      else replayStep();
      rerender();
    },
    setRate: (r: 0 | 1 | 2 | 4) => { replayDriver?.setRate(r); rerender(); },
    // 出口与胜利「返回主界面」走**同一条**复位（第四份跨页状态在那里统一收拾）
    exit: () => { resetToMainInterface(); },
  };
}

/**
 * **进入重放页**（D11）：把整帧渲染指向重放状态，并挂上只读闸门驱动。
 *
 * 落点（`file` 的来源）属 **T5** 的行区：`LocalDataNav.startReplay` 由 T5 加在
 * `showLocalData` 的 nav 注入区（G3 计划 `:3229` / G4 附录 A）。T4 只交付这个入口函数 +
 * 路由 + 控制条 + 退出侧复位；**刻意不接** `nav.onImported`（T5 规格第 3 条要求"导入成功后
 * 不自动离开本屏、由「重放这一局」按钮触发"）。
 *
 * 进入时做一次**完整复位**（与 `resetToMainInterface` 同款，但不回主页）：`resetUiState()` 清
 * render.ts 的全部 UI 模块态与 body 级常驻层；`setFxViewSeat(null)` 清 FX 视角座位
 * （`resetUiState` **不碰** `fx-seat`，G2 修正 R-F 实测）；`resetNetUiState()` 清远程页模块态；
 * `resetEpoch += 1` 让在飞动画的完成回调全部失效；本模块自己的动画标志/队列/定时器一并清空
 * （否则上一局的抽牌幽灵会落进重放帧）。
 */
function startReplayFile(file: MatchFile): void {
  /**
   * ★★ **G5 T12 小修复轮：起跑点的一致性先对账**（在任何状态被改写之前抛）。
   *
   * 修的是什么（评审实测的用户可见回归）：T12 之后录的档案，日志**开头**是 6 条 `'draft-pick'`，
   * 而下面 `state = stateAfterDraft(file)` 那一帧**已经**把草稿走完（相位 `'turn'`）⇒ 游标若从 0 起，
   * 第一步就把一条草稿动作交给一个 `'turn'` 相的状态 ⇒ `replayHostError` 写屏、**永久停在第 0 步**。
   * 修法是"游标从草稿前导之后开始"（下面 `initialPosition`），而那条算法的隐含前提就是
   * **日志前导的条数 == `setup.draftPicks` 的条数** ⇒ 前提不成立时必须**可读失败**（协调者交办），
   * 不许静默跳过。这条对账排在**最前**：不成立时这一页根本不该被改写成"正在重放"。
   */
  assertDraftPreludeMatchesSetup(file);
  // ① 上一屏 / 上一局留下的状态（逐项与 resetToMainInterface 对齐：这里只是**不回主页**）
  resetEpoch += 1;
  if (autoTimer !== null) {
    window.clearTimeout(autoTimer);
    autoTimer = null;
  }
  drawAnimBusy = false;
  revealFlyBusy = false;
  transitioning = false;
  // ★ G5 T19：进重放页 ⇒ "草稿转场演过没有"复位（重放页不播那个转场，但这一位是本文件的
  //   每局闩，与 `transitioning` 并排复位 —— 漏了它会让重放之后开的新局不播转场）
  draftTransitionPlayed = false;
  transitionPlayed = 0;
  pendingDraws = [];
  pendingReveals = [];
  clearGen2Fx();
  closeControlRearrangeModal();
  effectRearrangeKey = null;
  resetUiState();
  resetNetUiState();
  setFxViewSeat(null);
  // ② 换驱动与状态：`state` 只换**绑定**（类型与名字不变 —— 见驱动声明块的理由）
  replayDriver?.dispose();
  /**
   * ★★ **游标从"草稿前导"之后开始**（G5 T12 小修复轮；见本函数第一句的说明）。
   *
   * 起跑**状态**不动（仍是下面的 `stateAfterDraft(file)`），只把游标的初始位置往前挪
   * `draftPreludeCount(file.actions)` 条 —— 那个数由 `src/app/match-replay.ts` 的唯一出处给出
   * （不在这里现算，否则"跳几条"就有两个说法）。语义与 T12 之前**逐字相同**：重放页本来就不展示
   * 草稿，用户看到的第一条永远是"对局的第一条"。
   */
  replayDriver = createReplayDriver(file, {
    ticker: replayTicker,
    initialPosition: draftPreludeCount(file.actions),
  });
  // 订阅"该走下一步了"（注入时钟驱动）。退订随 `dispose()`（T2 判据 8）⇒ 退出侧不需要单独记句柄。
  replayDriver.onTick(replayStep);
  driver = replayDriver;
  replayHostError = null;
  replayResumePending = false; // 第四份状态的一部分：进重放时三个宿主侧标志都清干净
  replayStepPending = false;
  state = stateAfterDraft(file);
  renderMode = 'replay';
  // ③ 进入即开播（1× 档，D8）。顺序要紧：**先 `play()` 再 `rerender()`** ——
  //    `play()` 负责把第一次 tick 排进注入时钟，而这一帧末尾的 `settle()` 在"已排程"时是
  //    幂等的 no-op；反过来（先 rerender 再 play）会让 `settle()` 在还没开播时被调用，
  //    那时没有任何"上一步"需要重排。
  replayDriver.play();
  rerender();
}

/**
 * 导出用的档案 meta（T4 第 11 条）。
 *
 * - `seed`：从本局状态来（`state.rng.seed`）—— 重放全靠它；
 * - `setup`：`setupFromState`（草稿两条顺序快照的唯一抽取点）；
 * - `players[0].nick`：L1 里玩家自己的昵称（未设置时是空串，读失败也回空串，见 `readNickName`）；
 *   `players[1].nick`：热座没有"第二个昵称"这个概念（G3 的快照档案同样写空串）；
 * - `cardDataHash`：卡牌数据指纹（另一台设备据此在导入时给警告）；
 * - `createdAt`：**UI 层读时钟**（`src/app` 不许读时钟，`tests/app-purity.test.ts` 有守卫）。
 *   `matchFileFingerprint` 不含它 ⇒ 同一局导出两次指纹仍相同。
 * - `result`：**终局**（`winner !== null`）时写进档案（T4 一审 **N2**：`MatchFile.result` 字段与
 *   `parseMatchFile` 的校验一直都在，但此前**全仓没有一个生产者**）。`reason` 只写引擎真正
 *   给出的东西：引擎只判"谁赢"（`GameState` 上除了 `winner` 没有成败成因字段）⇒ 这里**不编造**
 *   具体成因，只如实说明胜负由引擎判定。对局未结束时**不带** `result`（不是写 `winner: null`）。
 */
function matchFileMeta(s: GameState): MatchFileMeta {
  return {
    seed: s.rng.seed,
    setup: setupFromState(s),
    players: [{ nick: readNickName(localStore) }, { nick: '' }],
    cardDataHash: CARD_DATA_HASH,
    createdAt: new Date().toISOString(),
    ...(s.winner !== null ? { result: { winner: s.winner, reason: '对局结束：胜负由引擎判定' } } : {}),
  };
}

/**
 * `buildSessionArchive()` 的返回形态（与 T5 的 `LocalDataNav.buildArchive` **同形**：
 * 有记录 ⇒ 给档案；没有 ⇒ 给**理由**，屏上如实显示）。
 *
 * ⚠️ 为什么给它起个名字而不是就地写 `{ file: MatchFile } | { reason: string }`：后者会让
 * `tests/ui/source-text.ts` 的 `functionBody` 把**返回类型标注里的 `{`** 当成函数体起点
 * （那是它写明的已知局限：本仓原本的函数返回类型都不含 `{`）⇒ 抽出来的"函数体"只有一行，
 * 任何针对该函数体的判据都会变成**假绿**。命名类型同时让两处同形这件事显式可见。
 */
type SessionArchive = { file: MatchFile } | { reason: string };

/**
 * 本次会话的档案（T5 的 `LocalDataNav.buildArchive` 的落点）。
 *
 * 语义（D9）：**本次会话还没有对局记录时返回 `reason`**，屏上如实显示 —— 不再退化成导一份
 * `actions: []` 的"本机数据快照"。记录器里还有进行中的一局 ⇒ 用它；否则用最近一局的快照
 * （`lastArchive`，打完一局回主页后仍然留着）。
 */
function buildSessionArchive(): SessionArchive {
  const rec = localDriver.recorder();
  if (rec && rec.actions().length > 0) return { file: rec.toMatchFile(matchFileMeta(state)) };
  if (lastArchive) return { file: lastArchive };
  return { reason: '本次会话还没有对局记录：先打完一局再来导出。' };
}

/**
 * 控制组件重排模态内的一次交换（2026-09 基础规则）：引擎动作 + 重渲染棋盘 + 模态刷新。
 *  交换基础动画由 protocols:rearranged 事件驱动（effects「重排协议基础特效」——
 *  两张协议卡同时平移互换位置，与"交换链路"动画不同）。
 *
 * G4 Task 4 收口：它**不是**旁路 —— `rearrange-protocols` 是**真实规则动作**（协议摆放顺序
 * 影响后续所有线值）⇒ 走 `driver.submit`（热座：进档案、可重放；重放页：闸门）。若当成
 * `note()` 只留痕，档案到这一步就与真实对局分叉（T4 第 2 条）。 */
function applyRearrangeSwap(target: PlayerId, a: Line, b: Line): void {
  driver.submit(state, { player: state.turnPlayer, kind: 'rearrange-protocols', args: { target, a, b } });
  rerender();
  refreshControlRearrangeModal();
}

/**
 * 2026-09-13（用户清单 #10）：**效果内重排**（动量4「重排你的协议」）改用编译期同款重排窗口。
 * 卡牌效果的重排发生在效果栈挂起期间——此时 `rearrange-protocols` 会被引擎硬拒
 * （game.ts：pendingEffects 非空 → "resolve pending effect choices first"），所以窗口用
 * **draft 模式**：本地摆好布局，完成时一次性回填 `action:order:XYZ`（引擎行为零改动）。
 * sessionKey = `effect:<pendingId>`：每帧 render 都会 sync 调用，同键只刷新内容、不重置会话。
 */
let effectRearrangeKey: string | null = null;

function commitEffectRearrange(promptId: string, order: Line[]): void {
  const top = state.pendingEffects[state.pendingEffects.length - 1];
  // 栈顶已变（效果被别的路径结算/重置）→ 只关窗口，不提交
  if (!top || top.id !== promptId || !top.prompt) {
    effectRearrangeKey = null;
    closeControlRearrangeModal();
    rerender();
    return;
  }
  effectRearrangeKey = null;
  closeControlRearrangeModal();
  // 走统一的 onAction 分发：错误守卫 + 渲染/FX 时序与其它 effect-choice 完全一致
  cb.onAction({ kind: 'effect-choice', promptId, choice: [orderToAction(order)] });
}

/** 每帧渲染后同步"效果内重排"窗口：栈顶是带 rearrangeSide 的选择请求 → 打开/保持；否则关闭 */
function syncRearrangeModalForEffect(): void {
  const top = state.pendingEffects[state.pendingEffects.length - 1];
  const prompt = top?.prompt;
  const side = prompt?.rearrangeSide;
  if (top && prompt && side !== undefined) {
    effectRearrangeKey = `effect:${top.id}`;
    openControlRearrangeModal({
      getState: () => state,
      title: prompt.title,
      submitLabel: '完成重排',
      mode: 'draft',
      sides: [side],
      sessionKey: effectRearrangeKey,
      canCommit: orderChanged,
      onCommit: (order) => commitEffectRearrange(top.id, order),
    });
    return;
  }
  if (effectRearrangeKey !== null) {
    effectRearrangeKey = null;
    if (isControlRearrangeOpen()) closeControlRearrangeModal();
  }
}

/**
 * ★ **草稿这一刻轮到谁选**（T12）：`draftRoundOwner(draftStarter, draftRound)` 的**唯一出处**。
 *
 * 为什么要有这个具名助手（而不是在 `cb.onDraftPick` 里直接调 `getCurrentDrafter`）：
 * 它是"发送方那一侧的轮次闸"与"写进档案的 `ActionRecord.player`"**同一个数** ——
 * 两处各算一遍就会长出两个可能漂移的说法，而症状是"选牌发到对端被拒/被算到别人头上"
 * （一个不报错的错位）。收在这里之后，改轮次规则只有一处要改。
 *
 * 它在草稿**之外**没有意义（`draftRound` 恒为 `DRAFT_PICK_COUNT`）：`cb.onDraftPick` 只在
 * 草稿屏上被调（`src/ui/render.ts` 的 `bindDraftDrag`），而那条路径在 `phase === 'turn'` 时
 * 已经不存在了。
 */
function currentDraftDrafter(): PlayerId {
  return getCurrentDrafter(state);
}

/* ── ★★ G5 T19：草稿 → 对局的转场，**两端各播一次**（修"只有一端播"那条）────────────── */

/**
 * 这一局的草稿 → 对局转场**演过了没有**（模块态）。
 *
 * ## 它修的是什么（用户真机提的第 3 件事）
 *
 * 转场原来只有**一个**触发点：`cb.onDraftPick` 里"提交成功 && `state.phase === 'turn'`"
 * 那一支（`playDraftToGameTransition()` 的唯一调用点）—— 那是**轮选者那一侧**的路径。
 * 另一端的状态是**收到 `act` 帧之后**才跨过 `draft → turn` 的（走 `onInbound` 的
 * `pump` + `rerender`），那一支里**没有任何转场调用** ⇒ 它直接看到牌桌。
 *
 * ## 为什么用一个"演过没有"的闩，而不是"谁没演过就补一次"
 *
 * 同一端**可能两条路都走到**：轮选者提交之后自己也会因为别的路径再 `rerender()` 一次
 * （自动推进的调度、对端帧、开发模式解锁……），而 `state.phase` 从那以后**恒为 `'turn'`**
 * ⇒ 按"相位是 turn 就播"会**反复播**同一段动画（每帧一次）。所以跨过那一刻时置位，
 * 之后同一局的每一次重画都看得见它（同一次转变只播一次）。
 *
 * 复位点与本文件其它"每局的闩"同族：`enterNetGame()` 起新的一局时清、`resetToMainInterface()`
 * 清、进重放页时清（见 `startReplayFile`）。
 */
let draftTransitionPlayed = false;

/**
 * ★★ **在这一刻跨过 `draft → turn` 时播一次转场**（两个调用点的**唯一**入口）。
 *
 * 判据只有一条：`state.phase !== 'draft'`（跨过去了）且这一局还没演过。
 * `enterNetGame()` 里那两处赋值（新开一局 / 重连换驱动）会按当时的相位把它置位，
 * 所以"重连回到对局中"不会补播一次转场。
 *
 * ## 为什么第二端不需要额外的信号
 *
 * 两端的转场**同源**：都是"本端状态跨过那一刻" ⇒ 各自 `pump`/`submit` 之后判一次就够。
 * 这条与"对端屏要更新"那条路**同一个源**（状态变化 ⇒ 该端自己播），所以不需要协议里加消息。
 */
function playDraftToGameTransitionOnce(): void {
  if (state.phase === 'draft' || draftTransitionPlayed) return;
  draftTransitionPlayed = true;
  transitionPlayed += 1;
  playDraftToGameTransition();
}

const cb: UiCallbacks = {
  onRendered() {
    // 效果内重排窗口（动量4）随每帧渲染同步：栈顶是重排请求 → 打开；结算完毕 → 自动关闭
    if (renderMode !== 'replay') syncRearrangeModalForEffect();
    scheduleAutoAdvance();
  },
  onWinReset() {
    resetToMainInterface();
  },
  /**
   * G2 Task 4：渲染器（`render.ts` 的选择浮层 / 拖拽 / 工具条）触发的"回当前页"回调。
   * 没有它，远程页里选择浮层点候选卡后仍会 `renderApp` 把页面换回热座棋盘。
   * 实现是**转调本模块的 `rerender()`**（唯一入口），因此路由规则只有一处。
   */
  rerender() {
    rerender();
  },
  /**
   * ★★ **G5 T12：草稿选牌走动作流水线**（用户裁决 A + (i)）——不再"只改本端状态"。
   *
   * 改之前（T11-C 的实测缺口）：这里直接 `performDraftPick(state, defId)` ⇒ 一次真选牌只改
   * **本端**状态，两端停在不同的 `draftRound`（工具实测 `房主 picks=1 / 加入方 picks=0`）。
   * 改之后：选牌变成一条 `ActionRecord`（`kind: 'draft-pick'`、`player` = 轮选者），走
   * **与对局动作同一条**流水线 —— `driver.submit` → `act` 帧 → 对端 `applyRecordedAction`
   * → `performDraftPick`（全仓唯一的"档案操作 → 引擎调用"映射，`src/app/match-replay.ts`）。
   *
   * ## 三个细节（都是"不写就静默错"的那种）
   *
   *  1. **`player` 取 `draftRoundOwner(draftStarter, draftRound)`，不取 `state.turnPlayer`**：
   *     草稿期 `turnPlayer` 恒为 `0`（`createGame` 的初值），拿它当提交者会让"座位 1 先选"
   *     的局在座位 0 那一侧被驱动的座位闸拒掉（`liveTurn` 的草稿分支）。轮选者是**同一个
   *     纯函数**算的（`getCurrentDrafter`，`src/core/state/create.ts:120-122`），两端一致。
   *  2. **`driver.submit` 的返回值必须看**：`ok === false` 时**什么都不做**（不前进、不重画）。
   *     非本回合的输入/离线/只读页都从这里被拒（发送方不提交 = 判据 3 的前一半），
   *     而"拒了却照旧重画"会让屏上出现一个**引擎里没发生**的中间态（本仓最恨的那类缺陷）。
   *  3. **只用 `state.phase` 判"草稿打完没有"**，不再拿"重画前它是不是 `'draft'`"当依据：
   *     提交成功之后状态已经是**提交后**那一帧，所以两处 `state.phase` 读的是同一个时刻。
   */
  onDraftPick(defId) {
    const player = currentDraftDrafter();
    const r = driver.submit(state, { player, kind: DRAFT_PICK_KIND, args: { defId } });
    // ★ 记账（只给 `#g5probe=1` 的排查用；默认路径不写 —— 见 `probeOn` 的说明）
    if (probeOn) {
      lastDraftSubmit = {
        ok: r.ok,
        refusal: r.ok ? null : String(r.refusal ?? ''),
        player,
        phase: state.phase,
        round: state.draftRound,
        turn: state.turnPlayer,
      };
    }
    if (!r.ok) return;
    if (state.phase === 'turn') {
      // 草案完成：先渲染最终草案（6 张全选）→ 渐进离场 → 全屏加载视频 → 对战界面渐进入场
      renderDraft(root, state, cb);
      // ★ G5 T19：走唯一的那个入口（本端跨过那一刻 ⇒ 播一次；见 `playDraftToGameTransitionOnce`）
      playDraftToGameTransitionOnce();
    } else {
      rerender();
    }
  },
  /**
   * 取消选择（拖出本回合已选的协议）：**草稿动作里它没有走线上**（T12 不做这条），
   * 所以联机下它会把两端分开 ⇒ **联网时直接拒绝**，不留一条会分叉的路。
   *
   * ## 为什么是"拒绝"而不是"也把它做上线"
   *
   * 用户裁决 A 只批了 `pick` 那一半（`ban` 都登记为不可达）；`unpick` 还要多一条
   * "撤销也进动作日志"的语义（`performDraftUnpick` 会**回退** `draftRound`），
   * 那是下一段的活。而留着它在本端乱改的代价是**两端分叉**（本仓最恨的形态之一），
   * 所以宁可让它在这里明确地不生效。
   *
   * ⚠️ **已知缺口（要进 README 与已知清单）**：联机草稿期"拖出已选协议"没有任何反应，
   * 屏上也不提示为什么（提示要动 `src/ui/render.ts`，那是本任务的红线）。
   */
  onDraftUnpick(defId) {
    if (netGame !== null) return;
    performDraftUnpick(state, defId);
    rerender();
  },
  /**
   * 禁用协议（ban 模式）：**同 unpick，今天不可达也不上线**。
   *
   * 联机的 `draftMode` 在 T11-C 里定为常量 `'normal'`（见 `enterNetGame`）⇒ 联机里永远没有
   * ban 步骤。这条留下是给**热座**的 ban 模式用的（那条路一个字都没变）。
   */
  onDraftBan(defId) {
    if (netGame !== null) return;
    performDraftBan(state, defId);
    rerender();
  },
  onAction(a) {
    if (state.phase === 'gameover') return;
    const player = state.turnPlayer;
    // 本次行动的世代快照：动画完成回调据此判断重置是否已发生（见 resetEpoch）
    const epoch = resetEpoch;
    // ── G4 Task 4：**收口后本模块不再直呼引擎** ──
    // 每一类操作都提交给当前驱动（见驱动声明块的 `driver`）：
    //   · 热座（`LocalDriver`）＝ `applyRecordedAction`（全仓唯一的"档案操作 → 引擎调用"映射）
    //     **并**把同一条操作记进内存记录器；
    //   · 重放页（`ReplayDriver`）＝ 只读闸门（D12）：只有档案里的下一条能过，且应用的是
    //     **记录里那一条**（不是这里算出来的那条）。
    // `applyRecordedAction` 内部已按 kind 收窄到 `executeAction` 的窄化重载 ⇒ 这里不再需要
    // 之前那套"LegalAction.kind 是联合类型、需按 kind 收窄后再分发"的说明。
    let drawAnimCount = 0;
    // 全量追踪（2026-09-12）：玩家动作 + 参数 + 行动前状态摘要
    trace('动作', `P${player + 1} 行动 kind=${a.kind} args=${JSON.stringify(a)} | 前：${stateDigest(state)}`);
    // 引擎抛错守卫（2026-09-12）：效果守卫失败（如 shift 目标线 = 原线）此前会冒泡成
    // Uncaught Error 并把 UI 留在【已失效的选择条】上 → 之后每次点击继续抛
    // "no pending choice" 级联报错（见 log/break_log/compile-log-2026-09-11）。
    // 现捕获后立刻重渲染：界面回到引擎的真实状态，玩家可继续操作。
    try {
    if (a.kind === 'play') {
      driver.submit(state, { player, kind: 'play', args: { cardUid: a.cardUid!, faceUp: a.faceUp!, line: a.line!, target: a.target } });
    } else if (a.kind === 'compile') {
      // 持有控制组件 → 编译前先归还中立并弹「重排协议」模态（FAQ 79：编译时首先归还
      // 中立，可重排一名玩家的协议——自己或对手——随后完成编译；FAQ 114：即使不重排
      // 也归还）。归还后提交 compile 不再重弹。devmode 强制编译走 executeCompileUnchecked
      // 旁路（devmode.ts 内同样归还，但不弹模态）。
      //
      // ⚠️ G4 Task 4：**重放页不走这个模态分支**。理由是可证伪的：档案里那次"UI 归还"
      //    不在 `actions` 里（它只留一条 log），而引擎的 compile 分支**自己**会先
      //    `resetControlIfHeld` 再 pushLog（`game.ts:153-157`）⇒ 重放直接 submit 就复现了
      //    现场那两条 log 的**顺序**（T1 头注的实测口径）。反过来，若重放也进这里，重放会
      //    **永久停在这一步**：模态在等人点，而重放页只读、没有人能点。
      if (renderMode !== 'replay' && state.control === player) {
        resetControlIfHeld(state, player);
        const line = a.line!;
        openControlRearrangeModal({
          getState: () => state,
          title: `P${player + 1} 持有控制组件：编译线 ${line + 1} 前可重排一名玩家的协议（组件已归还中立）`,
          submitLabel: `完成，编译线 ${line + 1}`,
          onSwap: applyRearrangeSwap,
          onCommit: () => {
            closeControlRearrangeModal();
            cb.onAction({ kind: 'compile', line });
          },
        });
        return;
      }
      driver.submit(state, { player, kind: 'compile', args: { line: a.line! } });
    } else if (a.kind === 'refresh') {
      // 抽牌飞入动画：记录刷新前手牌数，执行后按差值（= 本次抽了几张）播放动画，
      // 动画结束后再重渲染展示新手牌；动画进行中忽略再次刷新（防并发）
      if (drawAnimBusy) {
        // 终止路径 ②：抽牌动画进行中，本次 refresh 不执行 —— 仍然重渲染（⇒ 重放页在这一步
        // 也会经 `rerender()` 重排；本分支在重放里理论上不可达，见下面 afterFx 的说明）。
        rerender();
        return;
      }
      // 持有控制组件 → 补满手牌前先归还中立并弹「重排协议」模态（规则文本「控制组件
      // 相关规则」：执行补满手牌时归还中立，可调整任意一名玩家的协议摆放顺序）。
      // ⚠️ 重放页的理由同 compile（引擎 refresh 分支自己会先归还并 pushLog，`game.ts:142-146`）。
      if (renderMode !== 'replay' && state.control === player) {
        resetControlIfHeld(state, player);
        openControlRearrangeModal({
          getState: () => state,
          title: `P${player + 1} 持有控制组件：补满手牌前可重排一名玩家的协议（组件已归还中立）`,
          submitLabel: '完成，补满手牌',
          onSwap: applyRearrangeSwap,
          onCommit: () => {
            closeControlRearrangeModal();
            cb.onAction({ kind: 'refresh' });
          },
        });
        return;
      }
      const handBefore = state.players[player].hand.length;
      driver.submit(state, { player, kind: 'refresh' });
      drawAnimCount = state.players[player].hand.length - handBefore;
    } else if (a.kind === 'effect-choice') {
      // 应答挂起选择：chooser 可能是对手（规则"被作用卡持有者决定执行"）。
      // 必须用 prompt.chooser 覆盖（与 render.ts 选择条标签一致、与 executeAction 内部
      // 的 chooser 判定一致）——旧实现只取 top.player（效果属主），light-2 揭示对手反面牌
      // 时把「被揭示卡持有者（P1）」的选择错误派发给效果属主（P2）→ "not your choice"。
      // ★ 记录进档案的 `player` 也因此是**实际 chooser**（T4 第 4 条）：重放的闸门逐项比对
      //   `kind`+`args`+`player`，退回 `state.turnPlayer` 会让这些记录在重放时被拒。
      const top = state.pendingEffects[state.pendingEffects.length - 1];
      const chooser = top?.prompt?.chooser ?? top?.player ?? state.turnPlayer;
      driver.submit(state, { player: chooser, kind: 'effect-choice', args: { promptId: a.promptId!, choice: a.choice! } });
    } else if (a.kind === 'advance') {
      advanceProbeActions += 1; // 门禁读数用：这一条真的走到了 `submit`（见 `advanceOnce`）
      driver.submit(state, { player, kind: a.kind });
    } else if (a.kind === 'clear-cache') {
      driver.submit(state, { player, kind: a.kind });
    } else if (a.kind === 'resolve-trigger') {
      driver.submit(state, { player, kind: 'resolve-trigger', args: { cardUid: a.cardUid! } });
    }
    } catch (err) {
      // 打印到控制台（诊断日志会一并导出）+ 写入游戏日志树 + 全量追踪，随后重渲染同步 UI
      console.error('[行动结算异常]', err);
      pushLog(state, `行动结算异常：${err instanceof Error ? err.message : String(err)}`);
      trace('错误', `行动结算异常 kind=${a.kind}：${err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err)}`);
      trace('状态', `异常后状态：${stateDigest(state)}`);
      // 终止路径 ④（引擎抛错）：重渲染同步 UI ⇒ 重放页的 `settle()` 由 `rerender()` 统一重排
      rerender();
      return;
    }
    // 全量追踪：行动后状态摘要（含双方线值/手牌/牌库/弃牌/协议/挂起）
    trace('动作', `P${player + 1} 行动结束 kind=${a.kind} | 后：${stateDigest(state)}`);
    // effect-choice：getLegalActions 不产生，由 UI 选择栏应答后经 onAction 分发（chooser 可能是对手）
    // 效果触发的抽牌（card:drawn 事件，如 fire-0/fire-4）与揭示（card:revealed 事件，如
    // light-2/light-4）在本次行动结算期间累计，统一播新抽牌特效 + 揭示飞行序列
    const effectDraws = pendingDraws;
    pendingDraws = [];
    const effectReveals = pendingReveals;
    pendingReveals = [];
    // 揭示飞行在重渲染前完成：幽灵不提前出现在接收方手牌中，飞入后才随重渲染落地显示
    //
    // ⚠️ **重放的"唯一重排点"就靠这一段收口**（T4 第 6 条 / 协调者裁决 3）：下面是
    // `cb.onAction` 的**全部**终止路径，逐条都在 replay 下走到 `rerender()` ——
    //   ① `afterFx()` 的揭示分支：`playRevealFlySequence` 的完成回调 → `rerender()`；
    //   ② `afterFx()` 的同步分支：直接 `rerender()`；
    //   ③ 刷新抽牌动画：完成回调 → `afterFx()` → ①或②（即 CPU 上也是这两条）；
    //   ④ 效果触发的抽牌序列：完成回调 → `afterFx()` → ①或②；
    //   ⑤ `drawAnimBusy` 早退：自己 `rerender()` 后 return（上面那条注释）；
    //   ⑥ 引擎抛错：`catch` 里 `rerender()` 后 return；
    //   ⑦ `state.phase === 'gameover'` 的**顶部早退**：它之前没有任何状态迁移（引擎不会在
    //      gameover 后再动），档案也不会在终局之后还有记录（记录器只在真实动作处写），
    //      因此"停在这一步"在重放里不可达；`replayStep` 另有游标不动即停的诊断兜底。
    //   两条**不进重放**的 return：compile/refresh 的重排模态分支（都带 `renderMode !== 'replay'`）。
    // ⇒ `rerender()` 里那一次 `replayDriver?.settle()` 就是"每个终止点都 settle"的 choke point。
    const afterFx = () => {
      if (effectReveals.length > 0 && !revealFlyBusy) {
        revealFlyBusy = true;
        const revealEpoch = resetEpoch;
        playRevealFlySequence(effectReveals, () => {
          revealFlyBusy = false;
          if (revealEpoch !== resetEpoch) return; // 重置发生：放弃渲染（幽灵由重置清扫）
          rerender();
        });
      } else {
        // 终止路径 ②（同步分支）：无揭示或有揭示飞行进行中 ⇒ 直接重渲染
        rerender();
      }
    };
    if (drawAnimCount > 0) {
      drawAnimBusy = true;
      // 刷新按钮抽牌（非效果触发）：love 协议不参与（refresh 动作不产生 card:drawn 事件）→ love=false
      playDrawAnimation(player, drawAnimCount, false, false, () => {
        drawAnimBusy = false;
        if (epoch !== resetEpoch) return; // 重置发生：放弃后续渲染（幽灵已在动画内清理）
        afterFx();
      });
    } else if (effectDraws.length > 0 && !drawAnimBusy) {
      drawAnimBusy = true;
      playDrawSequence(effectDraws, () => {
        drawAnimBusy = false;
        if (epoch !== resetEpoch) return;
        afterFx();
      });
    } else {
      afterFx();
    }
  },
};

/**
 * 效果触发的抽牌序列：按玩家合并计数后逐人播放抽牌飞入动画（同一玩家多次抽牌合并为一次，
 * 幽灵卡依次落到手牌末尾；任一抽牌由 love 触发 → 合并结果带 love 标志 → draw-ghost 挂爱心；
 * 任一抽牌由 speed 触发 → 合并结果带 speed 标志 → 【先播 speed 专属飓风】（牌库区 → 手牌
 * 末尾，effects.playSpeedDrawExtra），基础 draw-ghost 飞入顺延到专属完成后（SPEED_TOTAL_MS）
 * ——修复"基础抽牌先播、speed 专属后播"的时序错误）。全部播完调用 done()。
 */
function playDrawSequence(
  draws: { player: PlayerId; count: number; love: boolean; speed: boolean; fromOpp: boolean }[],
  done: () => void,
): void {
  const merged: { player: PlayerId; count: number; love: boolean; speed: boolean; fromOpp: boolean }[] = [];
  for (const d of draws) {
    const found = merged.find((m) => m.player === d.player);
    if (found) {
      found.count += d.count;
      found.love = found.love || d.love;
      found.speed = found.speed || d.speed;
      found.fromOpp = found.fromOpp || d.fromOpp; // 混合来源按从对手抽处理（起点视觉不统一时取对手侧）
    } else {
      merged.push({ ...d });
    }
  }
  const first = merged[0];
  if (!first) {
    done();
    return;
  }
  const next = (): void => {
    const rest = merged.slice(1);
    if (rest.length === 0) done();
    else playDrawSequence(rest, done);
  };
  if (first.speed) {
    // speed 抽牌：先播专属飓风（牌库区 → 手牌末尾，SPEED_TOTAL_MS ≈ 2.26s 完成），
    // 基础 draw-ghost 飞入顺延到专属完成后（DOM 在 renderApp 前始终为旧布局，落点仍正确）
    playSpeedDrawExtra({ player: first.player, count: first.count, triggerProtocol: 'speed' });
    window.setTimeout(() => {
      playDrawAnimation(first.player, first.count, first.love, first.fromOpp, next);
    }, SPEED_TOTAL_MS);
  } else {
    playDrawAnimation(first.player, first.count, first.love, first.fromOpp, next);
  }
}

/**
 * 效果触发的揭示飞行序列：逐张播揭示飞行（每张 ~400ms，上一张落地即起飞下一张），
 * 全部落地后调用 done()（由调用方触发重渲染——幽灵飞入接收方手牌后才显示）。
 */
function playRevealFlySequence(
  reveals: { owner: PlayerId; shownTo: PlayerId; defId: string; triggerProtocol: string }[],
  done: () => void,
): void {
  const step = (i: number): void => {
    const r = reveals[i];
    if (!r) {
      done();
      return;
    }
    playRevealFly(
      { source: r.owner, shownTo: r.shownTo, defId: r.defId, triggerProtocol: r.triggerProtocol, index: i },
      () => step(i + 1),
    );
  };
  step(0);
}

/**
 * 刷新手牌抽牌飞入动画：drawn 张卡背幽灵卡从牌库区外侧（P1 从牌库左侧、P2 从牌库右侧，
 * 与手牌生长方向一致）依次飞入，每张间隔 120ms。
 * - 起点 = 牌库区 rect 外侧（牌库元素缺失时回退到手牌区外侧，即原行为）
 * - 终点 = 当前手牌末尾（现有末卡之后逐张按扇形步进延伸），而非固定点
 * - 幽灵卡尺寸与正常手牌卡一致（130×178.8，见 .draw-ghost）
 * - love（FX-4）：抽出的卡边框粉红光芒（.fx-love-cardglow）+ 卡背粉红爱心跳动
 *   （.fx-love-heart 子元素，快速 pulse）——随幽灵飞行，落地后随幽灵清理；
 *   牌库区粉红光芒 / 落点爱心由 effects 层 playLoveDrawExtra 独立播放（持续 2s）
 * 全部落地后移除幽灵卡并调用 done()（由调用方触发重渲染）。
 */
function playDrawAnimation(player: PlayerId, count: number, love: boolean, fromOpp: boolean, done: () => void): void {
  const hands = document.querySelectorAll<HTMLElement>('.hand');
  const hand = hands[player];
  if (!hand) {
    done();
    return;
  }
  const rect = hand.getBoundingClientRect();
  const cy = rect.top + rect.height / 2;
  // 抽牌起点：普通抽 = 自己牌库区外侧；fromOpp（修改提示词 31：从对手牌库抽，同化1/爱1）
  // = 对端牌库区外侧——卡从对手牌库方向飞入自己手牌（来源视觉正确）
  const deckSel = `.deck[data-player="${player}"]`;
  const deck = document.querySelector<HTMLElement>(deckSel);
  const fromDeck = fromOpp
    ? document.querySelector<HTMLElement>(`.deck[data-player="${player === 0 ? 1 : 0}"]`)
    : deck;
  const deckRect = (fromDeck ?? deck) ? (fromDeck ?? deck)!.getBoundingClientRect() : null;
  // G2 修正 R15-A：幽灵盒尺寸与扇形步距改成**按页取值**（远程页 100.572×137.601 / 78.909）。
  // ⚠️ 每帧只取一次（下面所有张共用），避免同一批幽灵量到不同基准（页面正在切页时）。
  const ghostBox = ghostCardBox();
  const fanStep = handFanSpacing();
  // 生长方向：**容器自己的排列方向**，不是绝对玩家号（`handOuterFor` 的判据）。
  // ⚠️ 热座逐字同值：热座 P0 手牌 `reversed:false` ⇒ 'end'（左起右排，与原 `player === 0` 同）；
  //    热座 P1 `reversed:true` ⇒ 'start'（原 `player === 0 ? … : …` 的 else 支同）。
  //    远程页两条手牌**都**是 `reversed:false`（`render-net.ts:1500/1523`）⇒ 两座位都给 'end'，
  //    这正是修 "P1 的幽灵飞到末卡左边而真卡出现在右端" 的那一处（R3 已把落点判据换过，
  //    本函数当时漏改，是同一族里最后一条绝对玩家号判据）。
  const fromLeft = handOuterFor(hand) === 'end';
  const startX = deckRect ? (fromLeft ? deckRect.left - 90 : deckRect.right + 90)
    : (fromLeft ? rect.left - 90 : rect.right + 90);
  // 现有末卡（正排 = 最右 / row-reverse = 最左；排除揭示幽灵牌）；空手牌时回退到手牌区起点
  const cards = hand.querySelectorAll<HTMLElement>('.card:not(.reveal-ghost)');
  const last = cards[cards.length - 1];
  const lastRect = last ? last.getBoundingClientRect() : null;
  const ghosts: HTMLElement[] = [];
  for (let i = 0; i < count; i++) {
    let targetX: number;
    // 扇形重叠量（= 步距与卡宽之差；热座 28）—— **单一出处**：`handFanLead()` 由
    // "卡宽 − 步距"推出，这里与下面的空手牌内缩共用它，不再各写一遍减法。
    const overlap = handFanLead();
    if (lastRect) {
      // 扇形步进：新卡中心距 = 卡宽 − 重叠量（热座 130 − 28 = 102；远程页 100.572 × 0.7846 = 78.909）
      // 正排：新卡 1 左缘 = 末卡右缘 − 重叠（中心 = 右缘 + 卡宽/2 − 重叠）；row-reverse 反向镜像
      // ⚠️ 原句写死 `+ 37`（= 130/2 − 28）—— 37 是**热座卡宽**的一半减重叠，必须跟着卡宽走，
      //    否则远程页中心点偏 5.7px（100.572/2 − 21.66 = 28.63 ≠ 37）。
      // 热座：`handFanLead()` = 130 − 102 = 28 ⇒ 130/2 − 28 = 37 —— 与原句**逐位相等**。
      const lead = ghostBox.w / 2 - overlap;
      targetX = fromLeft ? lastRect.right + lead + fanStep * i : lastRect.left - lead - fanStep * i;
    } else {
      // 空手牌：正排落在左 padding 内、row-reverse 落在右 padding 内，逐张按扇形步进向后延伸
      // （热座 `overlap = 28`，与被替换掉的那个字面量 `28` 逐位相等）
      targetX = fromLeft
        ? rect.left + overlap + ghostBox.w / 2 + fanStep * i
        : rect.right - overlap - ghostBox.w / 2 - fanStep * i;
    }
    const ghost = document.createElement('div');
    ghost.className = 'draw-ghost';
    ghost.style.left = `${startX}px`;
    // 幽灵卡 top 用函数出口的 h（与 .draw-ghost 高度同源）：元素未 appendChild 前 offsetHeight 恒为 0
    ghost.style.top = `${cy - ghostBox.h / 2}px`;
    // G2 修正 R15-A：内联宽高**必须**写 —— `styles.css:1740-1741` 的 `.draw-ghost` 写死
    // `130px / 178.8px`（热座值），而本元素挂在 `document.body` 上（**不在 `.net-board` 里**）
    // ⇒ styles-net.css 的 `.net-hands .card` 那条规则**命不中它**，只能在这里内联覆盖。
    ghost.style.width = `${ghostBox.w}px`;
    ghost.style.height = `${ghostBox.h}px`;
    // FX-4 love 抽牌：卡背粉红爱心（跳动）+ 边框粉红光芒（.fx-love-heart 子元素居中于卡背，
    // 与 .draw-ghost 自身的 transform 平移过渡不冲突——动画在子元素上）
    if (love) {
      ghost.classList.add('fx-love-cardglow');
      ghost.appendChild(buildLoveHeart());
    }
    document.body.appendChild(ghost);
    ghosts.push(ghost);
    // 以幽灵卡中心对准落点
    const dx = targetX - (startX + ghostBox.w / 2);
    // 依次起飞：首张 30ms（保证初始位置已被绘制一帧）后每 120ms 起飞下一张
    window.setTimeout(() => {
      ghost.style.transform = `translateX(${dx}px)`;
    }, 30 + i * 120);
  }
  // 最后一张落地（起飞 30ms + 飞行 250ms）后再留 50ms，清理幽灵并重渲染
  const total = 30 + (count - 1) * 120 + 250 + 50;
  window.setTimeout(() => {
    for (const g of ghosts) g.remove();
    done();
  }, total);
}

/**
 * 草案 → 游玩过渡：① 草案界面渐进离场（淡出+微缩+模糊）→
 * ② 全屏播放加载视频（loading-transition.mp4，播完或超时兜底）→
 * ③ 对战界面渐进入场（board-enter 淡入）。过渡期间 transitioning 暂停自动推进。
 */
function playDraftToGameTransition(): void {
  transitioning = true;
  root.classList.add('draft-exit');
  // 离场动画时长
  window.setTimeout(() => {
    const overlay = document.createElement('div');
    overlay.className = 'loading-overlay';
    const video = document.createElement('video');
    video.src = '/assets/ui/loading-transition.mp4';
    video.autoplay = true;
    video.muted = true;
    video.playsInline = true;
    video.className = 'loading-video';
    overlay.appendChild(video);
    document.body.appendChild(overlay);

    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      window.clearTimeout(safety);
      video.removeEventListener('ended', finish);
      // 视频淡出，同时渲染对战界面（渐进入场）
      overlay.classList.add('loading-out');
      root.classList.remove('draft-exit');
      root.classList.add('board-enter');
      rerender();
      window.setTimeout(() => {
        overlay.remove();
        root.classList.remove('board-enter');
        transitioning = false;
        scheduleAutoAdvance();
      }, 420);
    };
    // 视频正常播完或 4.5s 兜底（加载失败/静音限制时也能继续）
    const safety = window.setTimeout(finish, 4500);
    video.addEventListener('ended', finish);
  }, 450);
}

/**
 * 主页面 / 模式选择 / 掷硬币 / 图鉴 / 规则图纸 导航（2026-09-03 用户需求）。
 * - 主页是应用入口（不再一载入即进草稿）；
 * - 开始游戏 → 选择游戏模式（热坐可玩；单人/三人开发中）→ 勾选 禁用/随机池 开关
 *   （默认关）→ 掷硬币定先手：掷胜者先选协议（draftStarter），后选择协议的一方
 *   先出牌（firstToPlay = 1 - draftStarter，用户拍板）；
 * - 禁用模式：开局按规则选 6 禁 6（后手先禁 2 → 先手选 1 禁 1 → …）；随机池模式：
 *   开局从全部协议随机抽 12 套作为本局可选池（两种模式内世代筛选仍可用）；
 * - 胜利「返回主界面」→ 回主页（而非直接开新草稿）。
 */
/** 本局游戏选项（模式选择页勾选，掷硬币后随 createGame 生效） */
let gameOptions = { ban: false, randomPool: false };

/**
 * G3 Task 4：L1 授权状态（**唯一实例**，模块级）。
 * 为什么是模块级而不是传参：授权是「整机」性质，跨屏存在；而它**从不落盘**（红线 3），
 * 所以刷新后必然回到 'unknown' → 会重新问（设计稿 §3.6 / 用户裁决 #5：拒绝标记只在内存）。
 * ⚠️ 本行**在授权弹窗之前**执行 ⇒ 它在磁盘上**零写入**（对 `openL1Store()` 而言：
 *    `set`/`remove` 调用数必须为 0）。玩家看到的是"在你允许之前不会写入任何**你的数据**"；
 *    页面与离线所需的**程序文件**缓存不由这里负责（见 service worker 的披露）。
 *    于是这里不许出现任何 set/remove；真正的"能不能写"由 `writeJson` 的惰性降级兜住
 *    （写失败 ⇒ 本次会话退化为内存 + 如实提示）。
 *    ⚠️ 这条腿是**回归守卫**（不是对现状的认证）：`openL1Store()` 的只读探测已由 Task 3 修复轮
 *    落地并先于本提交；本行的纪律由 `tests/ui/local-consent.test.ts` 的接线腿钉住，
 *    防止将来有人把写探针搬回模块级（那会让"每个玩家每次打开页面先写一次磁盘"复活）。
 */
const localStore = createLocalStore({ persistent: openL1Store() });

/**
 * 授权状态机的**唯一落点**：reducer（`nextConsentStep`，纯函数）算下一个状态，这里只把它写回 store。
 * 为什么不让调用方直接 `localStore.grant()`：规则（含「show 不把 allowed 打回 ask」）只有一处，
 * 且这一处能被单测真跑（tests/ui/local-consent.test.ts 的 reducer 组）。
 */
function consentStep(action: 'show' | 'grant' | 'deny' | 'reset'): void {
  const next = nextConsentStep(localStore.consent(), action);
  if (next === 'ask') localStore.ask();
  else if (next === 'allowed') localStore.grant();
  else if (next === 'denied') localStore.deny();
  else localStore.reset();
}

/**
 * 启动门（**全应用最外层的分支**）：没表过态就先问；表过态（allowed/denied）直接进主页。
 * 红线 3：本函数在 `showHome()` 之前**不调用任何** writeNickName / writeDecks —— 同意前零写入。
 */
function showStartScreen(): void {
  if (localStore.consent() === 'unknown') {
    consentStep('show');
    renderLocalConsent(root, {
      onGrant: () => { consentStep('grant'); showHome(); },
      onDeny: () => { consentStep('deny'); showHome(); },
      // ⚠️ 这里**不是**"待填充的占位"：隐私说明的**整屏**早已由「本地数据与隐私」屏接管
      //   （主页的 `openLocalData` → `showLocalData()`，G3 Task 7 落地）。本回调保留为**换页接缝**，
      //   目前空实现无害 —— 弹窗上的「隐私说明」按钮已经就地展开完整说明
      //   （`src/ui/local-consent.ts` 的 renderPrivacyDetail，唯一出处 = privacy.ts 的 privacyLines()），
      //   用户不需要再跳一次屏。若将来要改成直接跳整屏，改这里一处即可。
      openPrivacy: () => { /* 换页接缝：整屏入口见 showLocalData()（G3 Task 7 已落地） */ },
    });
    return;
  }
  showHome();
}

function showHome(): void {
  renderHome(root, {
    startGame: () => showModeSelect(),
    openLibrary: () => renderLibrary(root, showHome),
    openRules: () => renderRules(root, showHome),
    // G3 Task 7：本地数据与隐私屏（授权状态可见 + 清除本机数据 + 档案导入导出入口）
    openLocalData: () => showLocalData(),
  });
}

function showModeSelect(): void {
  renderModeSelect(root, {
    backHome: showHome,
    startHotseat: (ban, randomPool) => {
      // 显式复位（幂等）：从"单人/三人开发中"或任何历史路径过来时，保证是热座模式。
      // 防的是"预览模式泄漏到热座"这一类串味（另一个堵点是 resetToMainInterface）。
      renderMode = 'hotseat';
      // G2 修正 R-F · **I-1 的第二个堵点**：FX 视角座位也必须一并复位（"直接开热座"这条路径）。
      // 它与 `renderMode` 是**两件事**：`renderMode` 决定画哪一页，座位决定 FX 走竖向还是横向分支。
      // 漏掉这一句时，页面画的是热座盘，而 FX 仍按上一页的座位算 —— 落点翻边、覆盖条带变横带、
      // 控制轨特效变竖向，**不报任何错**。
      setFxViewSeat(null);
      gameOptions = { ban, randomPool };
      /**
       * ★★ **G5 T19 修复轮：热座开局前复位"草稿 → 对局转场演过没有"那个闩。**
       *
       * ## 为什么必须补，以及为什么写在这里（不是 `showCoin` 里）
       *
       * 从联机那几屏回到模式选择**不走**整屏复位 —— 硬币屏的"← 返回游戏模式选择"
       * （`renderCoin` 的 `nav.backHome`）与大厅恢复屏都直调 `showModeSelect()`。若那一局联机的
       * 草稿已经打完（闩已置 `true`），接着开热座时闩还留着 ⇒ **热座那局的转场不播**。
       *
       * ⚠️ 写在**模式选择的入口回调**里而不是 `showCoin` 里：`showCoin` 是
       * `tests/ui/local-data-screen.test.ts` 钉住的"G4 不碰的邻居"之一（要求与 G4 之前的提交
       * **逐字节相同**）⇒ 往里加一行等于为了让新功能过审而放松一条既有守卫。这里改的是
       * `showModeSelect`，它本来就已经被移出那一组（T8 的联机入口）。
       */
      draftTransitionPlayed = false;
      transitionPlayed = 0;
      showCoin();
    },
    /**
     * G5/T8：**联机对战（两台设备）** —— 真正的联机入口（建房 / 加入 / 连接设置）。
     *
     * ⚠️ **它必须排在 `startNetPreview` 之前**（计划 §5 T8 的实现顺序约束，D24 补）：
     * `tests/ui/net-preview-wiring.test.ts:210-213` 用 `mode.slice(mode.indexOf('startNetPreview:'))`
     * 切出"预览那一段"再在里面断言 `renderMode = 'net'` 与 `netViewSeat = viewSeat`；
     * 新入口若排在它之后，那段切片会被拉长到含新入口 ⇒ 断言可能被新入口里的字符串满足 ——
     * 它仍然绿，但**测的已经不是原来那件事**（失焦）。所以排在前面是**判据面**的要求，
     * 不是排版偏好。
     *
     * 它**不写** `renderMode = 'hotseat'`（那两个字面量点各有腿在数），也不碰 `showCoin()`：
     * 大厅没有 `state`，它只是把页面模式切成第四值。
     */
    startNetLobby: () => {
      renderMode = 'lobby';
      renderLobbyFrame();
    },
    /**
     * G2 Task 4：**单视角预览（本地、零联机）** —— 远程对战页的视觉验收入口。
     *
     * 设计取舍（为什么不另写一套"直接进对战"的捷径）：预览**沿用完整的热座流程**
     * （掷硬币 → 草稿页 → 过渡视频 → 对战阶段），只在**对战阶段**把布局换成远程页：
     *   - 不需要写"自动选完 6 张草稿"的逻辑（那是另一套要维护的状态机）；
     *   - 不会绕过过渡动画（绕过就等于让"远程页与过渡时序"这条路径永远不被执行）；
     *   - 切换点由 `rerender()` 的 `state.phase !== 'draft'` 守卫单点决定，规则只有一处。
     */
    startNetPreview: (viewSeat, ban, randomPool) => {
      gameOptions = { ban, randomPool };
      renderMode = 'net';
      netViewSeat = viewSeat;
      /**
       * ★★ **G5 T19 修复轮 2：预览这条路也要复位"草稿 → 对局转场演过没有"那个闩。**
       *
       * 它与 `startHotseat` 同源（两条都调 `showCoin()`），而下面那条注释（"不会绕过过渡动画"）
       * 说的正是这件事：联机那局打完草稿之后闩已置 `true`，接着点"单视角预览"时闩还留着 ⇒
       * **预览的草稿 → 对局转场不播**（用户那次抱怨的就是这个观感）。
       */
      draftTransitionPlayed = false;
      transitionPlayed = 0;
      // 手牌可见性不在这里设：本页无该选项（I-2/N4 已把档位字段删掉，恒为信息遮蔽形态）。
      showCoin();
    },
  });
}

/**
 * G3 Task 7 / G4 Task 5：「本地数据与隐私」屏（附录 A 的行区：`showModeSelect` 之后）。
 *
 * 只做**接线**：三块内容与全部判据都在 `renderLocalData`（`src/ui/local-data.ts`，可在
 * 无 jsdom 的 DOM 桩上真跑）。这里注入**五个**宿主能力：
 *  - `back: showStartScreen` —— 回主界面；授权若被「改变选择」/「清除本机数据」重置成
 *    `unknown`，`showStartScreen()` 会**重新问**一次（授权状态不落盘，这是唯一的重问路径）；
 *  - `pickFile` / `saveFile` —— 档案的选择与落盘（浏览器实现只在**这一个地方**被构造）；
 *  - `onImported` —— 导入成功的**通知**接缝（用户可见的报告由 `renderLocalData` 写在屏内状态区）；
 *  - `startReplay`（**G4 Task 5 的落点**）—— 屏上的「重放这一局」按钮（导入成功后才解禁）把
 *    **刚导入的那一份**档案直接交给 `startReplayFile`（进入重放页的唯一入口，D11/D12）。
 *    **刻意不做"导入即重放"**：用户要留在本屏看完校验报告（含逐条警告）再自己决定什么时候进；
 *  - `buildArchive`（**G4 Task 5 的落点**）—— 档案由**宿主**给（`buildSessionArchive`，D9）：
 *    记录器只住在本文件，本屏不再自己从 L1 拼档案。没有记录时宿主回 `{ reason }` ⇒ 屏上拒绝导出。
 *
 * ⚠️ 本函数在 G3 Task 7 落地时写的是"**不需要再改本屏**"（当时的接缝只报告不重放）—— 那句话
 * 在 G4 收口后就**不成立**了：导入成功后要能把同一份档案交回宿主去重放（上一条）。历史留档在
 * G4 计划 §3.5 的清单里。
 *
 * ⚠️ **不给 `pickTimeoutMs`**（缺省 0 = 不设窗口）：协调者 2026-09-16 裁决 —— 给窗口会把
 * "用户慢慢挑文件"误判成 `cancelled`（假取消比等待更糟）。代价（可能一直等）由屏上那条
 * "等待你选择档案文件…"的**不阻塞**提示兜住（本屏不禁用任何按钮）。
 */
function showLocalData(): void {
  renderLocalData(root, {
    back: showStartScreen,
    store: localStore,
    pickFile: openArchivePicker(),
    saveFile: openArchiveSink(),
    onImported: (file, warnings) => {
      // G4 Task 5：这里**不需要**再做什么 —— 用户可见的报告由本屏的状态区写；重放由用户点
      // 「重放这一局」触发（落点是下面的 `startReplay`），**不**在这里自动进重放。
      // 保留这个接缝是为了让"导入成功"这件事对宿主可见（将来要做"最近导入"之类时用它）。
      void file;
      void warnings;
    },
    startReplay: (file) => {
      /**
       * ★ **进重放页前先对账**（G5 T12 小修复轮）：档案自相矛盾时（日志前导草稿条数 !=
       * `setup.draftPicks.length`）`startReplayFile` 会**抛**，而这一句把"屏上留下的东西"
       * 从"重放到一半的页面"换成"**用户还留在档案屏 + 一条可读的失败**"（console 里的是真因）。
       *
       * 为什么不做"在屏上画一条错误行"：那要动 `src/ui/local-data.ts` 的渲染面，而本轮的边界
       * 是"只修评审那一条阻断项"（协调者交办）。**登记为缺口**：失败原因只到 console。
       */
      try {
        startReplayFile(file);
      } catch (e) {
        console.error('[重放] 这份档案不能重放：', e);
      }
    },
    buildArchive: () => buildSessionArchive(),
  });
}

/** 掷硬币页：先生成本局种子，硬币与随机池都由它派生（G0） */
function showCoin(): void {
  // G0：种子在开局前生成一次，硬币与随机池都由它派生 → 可复现、可联机
  const seed = newMatchSeed();
  renderCoin(root, {
    backHome: showModeSelect,
    seed,
    beginGame: (starter) => {
      state = createGame({
        seed,
        draftStarter: starter,
        firstToPlay: (1 - starter) as PlayerId,
        draftMode: gameOptions.ban ? 'ban' : 'normal',
        draftPool: gameOptions.randomPool ? randomPoolFromSeed(seed, 12) : undefined,
      });
      rerender();
    },
  });
}

/**
 * 胜利结算遮罩「返回主界面」→ 应用内重置（无整页刷新/闪烁）：
 * - 清空本模块的动画标志/队列/定时器（自动推进、抽牌/揭示动画、过渡中标志）；
 * - resetUiState()：清空 render.ts 全部 UI 模块态并移除 body 级常驻层/遮罩
 *   （编译环 / 黑烟 / 放大遮罩 / 弃牌堆查看器——旧局残留会悬空）；
 * - resetNetUiState()（G2 Task 4）：清空**远程页自有**的模块态（上次选择请求 id、预览工具条反馈文本）
 *   —— 与 resetUiState() 并排调用：两页的模块态分属两个模块，谁都不清对方的（见 render-net.ts 注释）；
 * - **复位页面模式**（G2 Task 4）：`renderMode` 回 `'hotseat'`、视角与手牌可见性回默认。
 *   不复位就会出现「打完一局**预览** → 返回主界面 → 开**热座**」渲染成**远程页**：
 *   下一局的 `createGame` 之后每次 `rerender()` 都还会走进 net 分支，而热座页期待的是
 *   `renderApp` —— 症状是"明明点的热坐，进去却是远程布局"，且不报任何错。
 * - 回到主页面（下次「开始游戏」重新掷硬币定先手）。
 * 选择应用内重置而非 location.reload()：无整页闪烁、保留 devmode/诊断常驻，
 * 且全部可重置状态都有明确复位点（resetUiState 覆盖 render.ts 全部模块态）。
 *
 * ⚠️ 复位**必须排在 `showHome()` 之前**：`showHome()` 是本函数渲染出的"干净主页面"，
 * 而它与 `renderMode` 无关（直调 `renderHome`）—— 把复位放在它之后虽然当前也能跑通，
 * 却把"主页面已在屏上、模式还没复位"这个中间态留给了将来任何在 `showHome()` 之后
 * 追加的渲染逻辑（例如"返回后自动重开一局"），那会立刻变成同一个 bug。复位在前 = 无中间态。
 */
function resetToMainInterface(): void {
  resetEpoch += 1; // 失效进行中的动画完成回调（epoch 守卫）
  if (autoTimer !== null) {
    window.clearTimeout(autoTimer);
    autoTimer = null;
  }
  drawAnimBusy = false;
  revealFlyBusy = false;
  transitioning = false;
  pendingDraws = [];
  pendingReveals = [];
  clearGen2Fx(); // 2代 瞬态 FX（luck 骰子/烟花/蘑菇云）随局清扫
  closeControlRearrangeModal(); // 控制组件重排模态（body 级）随局清扫
  effectRearrangeKey = null; // 效果内重排窗口的会话键随局清空
  resetUiState();
  resetNetUiState(); // 远程页自有模块态（与上一行并排：两页的状态分属两个模块）
  // ── G2 修正 R-F · I-1：**FX 视角座位也必须复位**（与上面两行并排：三种模块态各归各的模块）──
  // 它是"离开远程页"这条路径上的**第三个**必须清掉的跨页状态：
  //   · `resetUiState()`  清 render.ts（热座页）的 UI 模块态；
  //   · `resetNetUiState()` 清 render-net.ts（远程页）的模块态；
  //   · `setFxViewSeat(null)` 清 **FX 层的视角座位**（`fx-seat.ts`）—— 它由远程页渲染时写入，
  //     热座页从不写；漏掉它就会出现「远程页预览跑过一帧 → 返回主界面 → 开热座」时
  //     热座 FX 仍走**竖向**分支：落点翻边、覆盖条带变横带、控制轨特效变竖向，且**不报任何错**。
  //     （R3 报告当时宣称"热座页观感零变化 ✅"—— 那只在"本次会话从未渲染过远程页"时成立。）
  setFxViewSeat(null);
  // ── G4 Task 4：**重放页**（第四份跨页状态）也要在这里收拾（与上面三份并排：各归各的模块）──
  // `'replay'` 是 `renderMode` 的第三个值，它的伴生状态有两样：
  //   · 驱动本身（在飞时钟 + `onTick` 订阅）⇒ `dispose()` 一次清干净（T2 判据 8 实测）；
  //   · 动作入口 `driver`（否则退出后热座的动作会被重放的只读闸门拒，且**不报任何错**）。
  // `lastArchive` **刻意保留**（D9）：打完一局回主页之后仍要能导出这一局。
  replayDriver?.dispose();
  replayDriver = null;
  driver = localDriver;
  replayHostError = null;
  replayResumePending = false;
  replayStepPending = false;
  // D9：把这一局的档案**快照**进内存（`lastArchive`），并把记录器交还给下一局。
  // 「新对局开始时清空」在正常流程里等价于「上一局离开时清空」——通往主界面的唯一路径是胜利
  // 横幅（`cb.onWinReset` → 本函数），而新对局只能从主界面开始（`showCoin` 不在本任务改动面内：
  // L5 要求 `showCoin`/`showHome`/`showModeSelect` 与基线逐字节相同）。**不落盘**（D13）。
  const archived = buildSessionArchive();
  if ('file' in archived) lastArchive = archived.file;
  localDriver.recorder()?.clear();
  // ── G5/T8：**大厅**（第五份跨页状态）也要在这里收拾（与上面四份并排：各归各的模块）──
  // 大厅的模块态是 `lobbyClient`（客户端 + 它自己那条会话/传输路由）与 `lobbyMode`。
  // `dispose()` 一次清干净：停掉 8 秒窗口、退订传输、把路由丢掉。
  // 漏掉它的症状与上面几份同族：下一局从主页进大厅时会**接着上一局那条会话**跑，
  // 而读数是上一局的（不报任何错）。
  lobbyClient?.dispose();
  lobbyClient = null;
  lobbyMode = null;
  // ★ T11-B：硬币屏那两个模块态也归这里（与上面几份同族：漏了下一局会带着上一局的读数）——
  //   `chooseFaceResolve` 悬着会让新一局的第一次叫面落到一个没人听的 Promise 上；
  //   `lobbyCoinShown` 不重置会让新一局的硬币屏**冻在上一局那一帧的指纹上**（读数一样就不重画）。
  chooseFaceResolve = null;
  faceChosen = false;
  lobbyCoinShown = null;
  // ★ G5 T19：硬币阶段那几格（'call'/'toss'/'settled'）+ 它的定时器也归这里
  //   （同族：漏了下一局会带着上一局的格子 ⇒ 新一局的硬币阶段直接被判成"已经演完"）
  resetCoinPhase();
  // ★ G5 T19：草稿 → 对局那个转场的"演过没有"同族（漏了下一局的转场永远不播）
  draftTransitionPlayed = false;
  transitionPlayed = 0;
  // ★ 修复轮：开局期那次断线留下的"这一局该重来"读数也归这里（同族：漏了下一局会带着上一局的屏）
  lobbyRestartNeeded = false;
  // ★ G5 T13-C：对局中掉线留下的"屏该画大厅那一屏"读数同族，一起归零
  linkRecoveryNeeded = false;
  // ★ T11-C：硬币那帧的读数与"补画过没有"也归这里（同族：漏了下一局会带着上一局的落地）
  coinVerdict = null;
  coinSettledShown = false;
  // ── ★ T11-C：**联机对局**（第六份跨页状态）也要在这里收拾（与上面五份并排：各归各的模块）──
  // 它的订阅有两条、分属两个对象，**两条都要退**：
  //   ① 驱动的 `onMessage` / `onStatus`（`createNetDriver` 里各订阅一次）⇒ `driver.dispose()`；
  //   ② 大厅路由的 `transport.onMessage` / `transport.onStatus`（`createLobbySessionLink` 里
  //      各订阅一次）⇒ 由下面那一行 `lobbyClient.dispose()` → `link.detach()` 退掉。
  //      会话对象**自己没有** detach / dispose（`NetSession` 上零命中，它是纯状态机、
  //      不持有订阅 —— `session.ts:768-776`），所以这一步不许写成 `session.detach()`。
  //  ③ `driver = localDriver` —— **必须**，否则回主页之后热座的动作会被联机驱动接走
  //      （它只在 `turnPlayer === seat` 时收输入 ⇒ 热座会变成"只有一方能动"，不报任何错）。
  // 漏掉①的症状：下一局一进牌桌就接着上一局的对端收帧（序号对不上，报的还是上一局的分叉）。
  netGame?.driver.dispose();
  driver = localDriver;
  netGame = null;
  renderMode = 'hotseat'; // 防"预览模式泄漏到热座"（见本节注释）
  netViewSeat = 0;
  // 手牌可见性无需复位：本页无该选项（档位字段已删，恒为信息遮蔽，I-2/N4）。
  showHome();
}

/**
 * 非 action 步骤自动推进：
 * - draft / gameover → 停止（不自动推进）
 * - action → 停止（轮到玩家行动）
 * - 有挂起选择 / 落牌·偏转进行中 → 暂停（等对应玩家应答 / 操作完成）
 * - start/end 有待结算触发 → 暂停（显示触发按钮等玩家点击）
 * - check-compile：有可编译线 → 暂停（编译需玩家点击编译按钮后再执行，不自动编译）
 * - check-cache：手牌 > 5 → 暂停（玩家自选弃牌至 5 张）
 * - 其余步骤（start/check-control/check-cache 手牌合规/end）→ 自动 advance
 */
function runAutoAdvance(): void {
  /**
   * ★ **门禁关掉自动推进时，这里必须也早退**（评审 R2 §8 遗留 3）。
   *
   * `scheduleAutoAdvance()` 只在排程时看开关，而**已经挂上**的那个定时器照样会到点调到这里；
   * `setAutoAdvance(false)` 会把它 `clearTimeout` 掉，这一句是**第二道**：兜住"回调已经在飞 /
   * 别的路径直呼本函数"的边角。两条一起，"关了"才真的等于"这一局不会再自己往前走一格"。
   */
  if (autoAdvanceOff) return;
  // ── G4 Task 4（D8）：**重放期间不自动推进** ──
  // 自动推进（400ms）与重放的步进时钟（注入的 ticker，900ms/档）是两套独立时钟，同时跑必然
  // 互相踩：`runAutoAdvance` 会替玩家合成 `advance`，而档案里的 `advance` 是**显式记录**的
  // （`match-file.ts:178-187` 的 kind 表）⇒ 重放步数与档案错位、且不会报任何错。
  if (renderMode === 'replay') return;
  if (transitioning) return; // 草案→游玩过渡中：不自动推进
  if (state.pendingEffects.length > 0) return; // 有挂起选择：等对应玩家应答
  if (state.pendingPlay.length > 0 || state.pendingShift.length > 0) return; // 落牌/偏转进行中
  if (state.step === 'end' || state.step === 'start') {
    if (collectTriggers(state, state.step).length > 0) return; // 有待结算触发：出按钮
  }
  if (state.phase === 'draft') return;
  if (state.phase === 'gameover' || state.winner !== null) return;
  if (state.step === 'action') return;
  const player = state.turnPlayer;
  // check-cache：手牌超过 5 张时必须由玩家自选弃牌（不自动跳过）
  if (state.step === 'check-cache' && state.players[player].hand.length > 5) return;
  if (state.step === 'check-compile') {
    const lines = getCompilableLines(state, player);
    if (lines.length > 0) return; // 可编译：暂停，显示编译按钮等玩家点击后执行
  }
  cb.onAction({ kind: 'advance' });
}

/** 每次渲染完成后调用；已有一个待执行的自动推进时不重复排队 */
function scheduleAutoAdvance(): void {
  // G4 Task 4（D8）：重放页**不排**自动推进（它有自己的步进时钟，见 `runAutoAdvance` 的同款守卫）
  if (renderMode === 'replay') return;
  // ★ G5 T11-C：门禁可以把它关掉（见 `noAutoAdvance()` 的说明）。
  //   存在的理由：不关掉的话"对端的指纹变了"分不清是**收到的那一帧**还是**它自己推的**。
  if (autoAdvanceOff) return;
  if (autoTimer !== null) return;
  autoTimer = window.setTimeout(() => {
    autoTimer = null;
    runAutoAdvance();
  }, AUTO_ADVANCE_DELAY);
}

initEffects();
initCompileFx();
initRearrangeFx();
initGen3StackSwapFx(); // 3代（批次 E）：支点1「交换左右堆叠」整堆沿弧线互换
initShuffleFx(); // 修改提示词 4：洗牌/切洗/弃牌堆洗入牌库动画（deck:shuffled 事件）
initGen2Fx(); // 2代 协议专属特效（luck 宣告骰子等；事件驱动订阅）
// 全量追踪（2026-09-12 用户需求「日志要记录所有信息」）：订阅全局事件总线，把每个语义事件 +
// payload + 当时的步骤/回合写入追踪缓冲区（不进 UI 日志面板，由导出日志全文包含）。
initEventTracing();
// 对局阶段变化（草稿/开局/结算）也留痕：每次事件后对比 phase
let lastPhase: string = state.phase;
gameBus.subscribe(() => {
  if (state.phase !== lastPhase) {
    trace('步骤', `阶段变化：${lastPhase} → ${state.phase} | ${stateDigest(state)}`);
    lastPhase = state.phase;
  }
});
// 诊断日志：全量记录 console + 捕获未捕获异常（出错自动提示导出）
initDiag(() => state);
// G3 Task 8：注册 Service Worker 并挂"有新版本可用 → 立即更新"提示条（附录 A 的 Task 8 行区）。
// dev 下 initPwaUpdate 自动不注册（`import.meta.env.DEV`），所以不影响 vite dev 的热更新。
// 位置在 setSeedNonce/createGame 之后、showHome() 之前：不动 G0 的启动语义。
initPwaUpdate();
// 隐藏开发者模式：Ctrl+Shift+P 密码进入；get <牌名> 把卡加入当前玩家手牌
// （返回的卸载函数当前不使用，保持监听常驻）
// G2 Task 4F（终审 D-2）：原先注入的是裸 `renderApp(root, state, cb)` —— 在远程页预览里用
// devmode 加牌会把页面**画回热座棋盘**（状态无损，但界面不一致）。改走唯一入口 `rerender()`：
// 热座下 `rerender()` 逐字执行 `renderApp`（语义等价），远程页下则正确地重画当前页。
initDevMode({
  getState: () => state,
  render: () => rerender(),
  // G2 修正 **R12-6**：远程页的视角切换从"页面上的预览工具条"内化进开发者模式（`视角` 指令）
  netSeat: { get: () => netViewSeat, set: (seat) => { netViewSeat = seat; } },
});
// 效果触发的抽牌：累计 card:drawn 事件（love 协议触发 → love 标志 → 抽牌动画挂爱心），
// 行动结算后统一播新抽牌特效
gameBus.subscribe((e) => {
  if (e.type !== 'card:drawn') return;
  const p = e.payload as { player: PlayerId; count: number; triggerProtocol?: string; fromOpponentDeck?: boolean };
  pendingDraws.push({
    player: p.player,
    count: p.count,
    love: p.triggerProtocol === 'love',
    speed: p.triggerProtocol === 'speed',
    fromOpp: p.fromOpponentDeck === true,
  });
});
// 效果触发的揭示：累计 card:revealed 事件，行动结算后按序播揭示飞行
// （source = 被揭示卡持有者手牌末尾，shownTo = 接收方手牌末尾；triggerProtocol 决定
// 飞行幽灵是否带天使翅膀——light 协议揭示专属）
gameBus.subscribe((e) => {
  if (e.type !== 'card:revealed') return;
  const p = e.payload as { owner?: PlayerId; shownTo?: PlayerId; defId?: string; triggerProtocol?: string } | undefined;
  if (p?.owner !== undefined && p.shownTo !== undefined && p.defId) {
    pendingReveals.push({ owner: p.owner, shownTo: p.shownTo, defId: p.defId, triggerProtocol: p.triggerProtocol ?? 'system' });
  }
});
// 3代（批次 D）控制权族：控制权变更（获得=牵引链拉来 / 失去=链断）/ 判定阶段（三线对比条扫描）/
// 清缓存时刻（暴食0 齿颚咬合）——三条都只加"附加层"，引擎判定与基础 UI 不变
gameBus.subscribe((e) => {
  if (e.type === 'control:changed') {
    gen3ControlChangedFx(e.payload as { from: number; to: number; reason?: string }, e.state);
  } else if (e.type === 'rule:control-check') {
    gen3ControlCheckFx(
      e.payload as { player: 0 | 1; wins: number; leading: (0 | 1 | 2)[]; gained: boolean },
      e.state,
    );
  } else if (e.type === 'rule:clear-cache') {
    gen3ClearCacheFx(e.payload as { player: 0 | 1; count: number }, e.state);
  }
});
// 2026-09-03：应用入口 = 主页面（开始游戏 → 掷硬币 → 草稿 → 对局）
// G3 Task 4：入口改为**启动门** —— 首次进入先过授权弹窗（同意前零写入），表过态则直进主页。
// ★ G5 T11-C：跨端状态指纹的读取口（只跟着 `#g5probe=1` 打开，见那里的说明）
exposeMatchProbe();
showStartScreen();
// 常驻特效层随滚动/缩放重新对齐：已编译环（compiledFx）、暗2 黑烟（smokeOverlays）、
// 能量扫描线（scanOverlays）与 FX-3 念能粒子/瘟疫浓雾（psychicParticles/plagueMists）、
// FX-5 冷漠灰雾/冷漠2 马赛克/灵魂-0 手牌区光芒/灵魂-1 手牌卡护角
// （apathyMists/apathyMosaics/spirit0Glows/spirit1Cards）、
// FX-6 金属0 能量槽边框/金属2 链路铁板/金属6 手牌 man/metal-1 三链边框金属光泽
// （metal0Glows/metalPlates/metal6Mans/metal1LineGlows）
// 与 FX-R2 check-cache 锁链（chainLayer，按 data-chain-player 跟随手牌区）
// 都是 body 级 position:fixed 层，只在渲染时按单元格矩形定位——渲染之间的滚动/缩放
// 会让它们停在陈旧视口坐标（尤其一局胜利后无后续渲染时）。
// rAF 节流（同帧合并多次事件）+ passive + capture（覆盖任意可滚动容器）；sync 函数
// 幂等且廉价（只读 rect 重写坐标）。在初始渲染之后注册（注册表已就绪）。
let fxSyncScheduled = false;
const syncPersistentFx = (): void => {
  if (fxSyncScheduled) return;
  fxSyncScheduled = true;
  requestAnimationFrame(() => {
    fxSyncScheduled = false;
    syncCompiledFxLayers();
    syncSmokeOverlays(state);
    syncScanOverlays(state);
    syncPsychicParticles(state);
    syncPlagueMists(state);
    syncApathyMists(state);
    syncApathyMosaics(state);
    syncSpirit0Glows(state);
    syncSpirit1Cards(state);
    syncMetal0Glows(state);
    syncMetalPlates(state);
    syncMetal6Mans(state);
    syncMetal1LineGlows(state);
    syncMirror0BatteryGlows(state);
    syncClarity0BatteryGlows(state);
    syncIceFx(state);
    syncSmoke2LineGlows(state);
    syncFear0TriGlows(state);
    syncWarBlades(state);
    // 2026-09-13（审计补漏）：多元3 卡面框光/能量槽流光的同步此前**只在 renderApp 里调用**
    // → 滚动/缩放（以及胜利后不再渲染）时这两个 body 级 fixed 层会粘在陈旧视口坐标
    // （与用户实测的"特效粘在屏幕上"同一类 bug）。
    syncDiversity3Fx(state);
    syncGen3Persistent(state); // 3代（批次 D）常驻层随滚动/缩放重定位
    syncFollowers(); // 长寿命 FX（>1.5s 的卡框光/落点光）随滚动/缩放跟随
    syncChainLayerPosition();
  });
};window.addEventListener('scroll', syncPersistentFx, { passive: true, capture: true });
window.addEventListener('resize', syncPersistentFx, { passive: true });







