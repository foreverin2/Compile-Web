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
import { createGame, performDraftPick, performDraftUnpick, performDraftBan, randomPoolFromSeed, setSeedNonce } from './core/state/create';
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
import { renderHome, renderCoin, renderLibrary, renderRules, renderModeSelect } from './ui/home';
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
// 重放的起跑状态（`createGame(matchFileToCreateOptions(f))` + 草稿序列真重建）
import { stateAfterDraft } from './app/match-replay';
import { setupFromState, type MatchFile, type MatchFileMeta } from './app/match-file';
import { CARD_DATA_HASH } from './app/card-data-hash';
import { renderReplayBar, type ReplayBarNav } from './ui/replay-bar';
import { openArchivePicker, openArchiveSink } from './ui/archive-fs-browser';
import { newMatchSeed } from './ui/match-seed';
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
  type LobbyDraftInput,
  type LobbyErrorKey,
  type LobbyState,
} from './ui/net-lobby';
import {
  browserHash,
  createBrowserTransport,
  createInvite,
  inviteLengthReport,
  readIceServers,
  readInviteFromAddressBar,
  signalingEndpointSetting,
  stripInviteFromAddressBar,
} from './ui/net-browser';
import { PROTO_VERSION } from './net/protocol';

const root = document.getElementById('app')!;
// 启动时注入运行期 nonce（G0）：使任何未显式传 seed 的 createGame() 也不会跨重启重复同一牌序
setSeedNonce(newMatchSeed());
let state = createGame();

/** 非玩家输入步骤之间自动推进的间隔（毫秒） */
const AUTO_ADVANCE_DELAY = 400;
let autoTimer: number | null = null;
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
 *   - **不拿真 SDP / ICE**：非 trickle 的 offer 要等 ICE 收集完成，那是真 `RTCPeerConnection` 的事。
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

/** 大厅要的注入环境：**只读设置**。`signalingEndpointSetting` 在这一层不发任何请求（§8.1） */
function lobbyEnv() {
  return { settings: () => netSettings };
}

/** 大厅要的时钟能力（注入形状；`net-lobby.ts` 里零命中裸 `setTimeout`） */
const lobbyTicker = {
  schedule: (fn: () => void, ms: number): number => window.setTimeout(fn, ms),
  cancel: (h: number): void => { window.clearTimeout(h); },
};

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
  };
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
  if (client !== null) client.sync();
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
    settingsValue: (key) => netSettings[key],
    setSetting: (key, value) => { netSettings[key] = value; renderLobbyFrame(); },
    errorText: (key: LobbyErrorKey) => errorCopy(key),
  });
}

/** 建房 / 加入的入口：**第一次**进大厅时才造客户端（两样状态都只活在这一屏里） */
function startLobby(role: 'host' | 'guest'): void {
  lobbyMode = role;
  if (lobbyClient === null) {
    lobbyClient = createLobbyClient({
      role,
      sessionId: newSessionId(),
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
      // 真解压是异步的（`decompressBase64`），而 `decodeInviteText` 要一个同步口 ⇒
      // `joinLobbyWithInvite` 先把字节 await 出来再喂进去（照 `net-browser.ts:createInvite` 的同一种缝法）。
      decompressBase64: () => null,
      readAddressBar: () => {
        const payload = readInviteFromAddressBar(lobbyEnv());
        if (payload === null) return null;
        // ★ 判据 6 的 ⑤：**只在读到载荷之后**抹地址栏（读不到时抹会把别人的 hash 抹掉）
        return { payload, stripped: stripInviteFromAddressBar(lobbyEnv()) };
      },
    });
  }
  renderLobbyFrame();
  if (role === 'guest') void lobbyClient.readFromAddressBar().then(() => { renderLobbyFrame(); });
}

/** 房主：生成一条邀请码（SDP 是占位串，见本节头注），起一次 8 秒窗口 */
async function makeLobbyInvite(): Promise<void> {
  const client = lobbyClient;
  if (client === null) return;
  const originAndPath = window.location.href.split('#')[0].split('?')[0];
  await client.startHost({
    originAndPath,
    p: PROTO_VERSION,
    // `encodeInvite` 会拒绝空 SDP（那是调用方违约），所以它必须非空；
    // 真的 offer 要等 ICE 收集完成 —— 那是 T9 的真浏览器线。
    sdp: 'v=0\r\no=- 0 0 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\na=group:BUNDLE 0\r\n',
    ice: [],
    hostPromise: 'host-promise-pending',
    guestPromise: 'guest-promise-pending',
  });
  client.startWait();
  renderLobbyFrame();
}

/** 加入方：贴一条邀请码 ⇒ 解载荷 + 明文协议版本比对 */
async function joinLobbyWithInvite(text: string): Promise<void> {
  const client = lobbyClient;
  if (client === null) return;
  await client.joinWithInvite(text);
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
function rerender(): void {
  if (renderMode === 'net' && state.phase !== 'draft') {
    // ── G2 修正 **R12-6**：预览工具条与运行时自查**只在开发者模式解锁后**才启用 ──
    // 用户第五次验收："还有预览工具条，我希望隐藏它，并将它的功能内化给开发者模式"。
    // 工具条的两个功能各自有了去处：
    //  · **视角切换** → 开发者指令 `视角` / `seat 1|2`（`initDevMode` 里的 `netSeat` 回调）；
    //  · **运行时自查行**（`verifyHooks`）→ 解锁后随工具条一起出现（普通对局里结果仍写 console）。
    // ⚠️ 因此**普通玩家/普通对局看到的页面上没有这条工具条**；解锁（Ctrl+Shift+P → 密码）
    //    会触发一次 `rerender()`（见 `devmode.ts` 的解锁分支），工具条当场出现。
    const dev = isDevUnlocked();
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
    return;
  }
  // ── G5/T8：联机大厅分支 ─────────────────────────────────────────────────────
  // 它是一个**独立屏**（没有 `state`），所以在这里早退：下面的 `renderApp(root, state, cb)`
  // （全文件唯一一处）一个字都不动。大厅自己的渲染器负责清 root（`renderNetLobby` 首行）。
  if (renderMode === 'lobby') {
    renderLobbyFrame();
    return;
  }
  renderApp(root, state, cb);
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
  cb.onAction(a);
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
  // ① 上一屏 / 上一局留下的状态（逐项与 resetToMainInterface 对齐：这里只是**不回主页**）
  resetEpoch += 1;
  if (autoTimer !== null) {
    window.clearTimeout(autoTimer);
    autoTimer = null;
  }
  drawAnimBusy = false;
  revealFlyBusy = false;
  transitioning = false;
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
  replayDriver = createReplayDriver(file, { ticker: replayTicker });
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
  onDraftPick(defId) {
    performDraftPick(state, defId);
    if (state.phase === 'turn') {
      // 草案完成：先渲染最终草案（6 张全选）→ 渐进离场 → 全屏加载视频 → 对战界面渐进入场
      renderDraft(root, state, cb);
      playDraftToGameTransition();
    } else {
      rerender();
    }
  },
  onDraftUnpick(defId) {
    performDraftUnpick(state, defId);
    rerender();
  },
  onDraftBan(defId) {
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
    startReplay: (file) => startReplayFile(file),
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

