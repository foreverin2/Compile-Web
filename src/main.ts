import './ui/styles.css';
import './ui/styles-gen3.css'; // 3代（MN03/AX03）协议特效样式（批次 A：15 套已编译常驻特效）
import './ui/styles-gen3-cards.css'; // 3代卡牌效果附加层样式（批次 B/C：四类动作 + 抽牌/反打/编译后）
import './ui/styles-gen3-sync.css'; // 3代常驻层与控制权族样式（批次 D）
// G2 Task 3：远程对战页布局（甲读法：3 横带 / 上对手下自己 / 自己 0°·对手 180°）。
// 只服务 src/ui/render-net.ts；styles.css 一行未改，热座页规则原样生效。
import './ui/styles-net.css';
// G3 Task 4：授权弹窗与「本地数据与隐私」屏的样式（新文件，只服务 G3 新屏）
import './ui/styles-local.css';
import { createGame, performDraftPick, performDraftUnpick, performDraftBan, randomPoolFromSeed, setSeedNonce } from './core/state/create';
import { executeAction } from './core/game';
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
import { createLocalStore } from './app/local-store';
import { openL1Store } from './ui/local-store-browser';
import { renderLocalConsent, nextConsentStep } from './ui/local-consent';
// G3 Task 7：「本地数据与隐私」屏 + 档案的选择/落盘口（浏览器实现只在 `showLocalData` 里注入）
import { renderLocalData } from './ui/local-data';
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
import type { PlayerId, Line } from './core/models/types';
// G3 Task 8：PWA（manifest + service worker + 自动提示更新 + 一键更新）。零依赖、手写。
import { initPwaUpdate } from './ui/pwa-update';

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
 */
let renderMode: 'hotseat' | 'net' = 'hotseat';
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
  renderApp(root, state, cb);
}

/**
 * 控制组件重排模态内的一次交换（2026-09 基础规则）：引擎动作 + 重渲染棋盘 + 模态刷新。
 *  交换基础动画由 protocols:rearranged 事件驱动（effects「重排协议基础特效」——
 *  两张协议卡同时平移互换位置，与"交换链路"动画不同）。 */
function applyRearrangeSwap(target: PlayerId, a: Line, b: Line): void {
  executeAction(state, state.turnPlayer, 'rearrange-protocols', { target, a, b });
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
    syncRearrangeModalForEffect();
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
    // executeAction 使用窄化重载（play/compile 需 args，refresh/advance 无 args），
    // 而 LegalAction.kind 是联合类型，需按 kind 收窄后再分发
    let drawAnimCount = 0;
    // 全量追踪（2026-09-12）：玩家动作 + 参数 + 行动前状态摘要
    trace('动作', `P${player + 1} 行动 kind=${a.kind} args=${JSON.stringify(a)} | 前：${stateDigest(state)}`);
    // 引擎抛错守卫（2026-09-12）：效果守卫失败（如 shift 目标线 = 原线）此前会冒泡成
    // Uncaught Error 并把 UI 留在【已失效的选择条】上 → 之后每次点击继续抛
    // "no pending choice" 级联报错（见 log/break_log/compile-log-2026-09-11）。
    // 现捕获后立刻重渲染：界面回到引擎的真实状态，玩家可继续操作。
    try {
    if (a.kind === 'play') {
      executeAction(state, player, 'play', { cardUid: a.cardUid!, faceUp: a.faceUp!, line: a.line!, target: a.target });
    } else if (a.kind === 'compile') {
      // 持有控制组件 → 编译前先归还中立并弹「重排协议」模态（FAQ 79：编译时首先归还
      // 中立，可重排一名玩家的协议——自己或对手——随后完成编译；FAQ 114：即使不重排
      // 也归还）。归还后提交 compile 不再重弹。devmode 强制编译走 executeCompileUnchecked
      // 旁路（devmode.ts 内同样归还，但不弹模态）。
      if (state.control === player) {
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
      executeAction(state, player, 'compile', { line: a.line! });
    } else if (a.kind === 'refresh') {
      // 抽牌飞入动画：记录刷新前手牌数，执行后按差值（= 本次抽了几张）播放动画，
      // 动画结束后再重渲染展示新手牌；动画进行中忽略再次刷新（防并发）
      if (drawAnimBusy) {
        rerender();
        return;
      }
      // 持有控制组件 → 补满手牌前先归还中立并弹「重排协议」模态（规则文本「控制组件
      // 相关规则」：执行补满手牌时归还中立，可调整任意一名玩家的协议摆放顺序）。
      if (state.control === player) {
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
      executeAction(state, player, a.kind);
      drawAnimCount = state.players[player].hand.length - handBefore;
    } else if (a.kind === 'effect-choice') {
      // 应答挂起选择：chooser 可能是对手（规则"被作用卡持有者决定执行"）。
      // 必须用 prompt.chooser 覆盖（与 render.ts 选择条标签一致、与 executeAction 内部
      // 的 chooser 判定一致）——旧实现只取 top.player（效果属主），light-2 揭示对手反面牌
      // 时把「被揭示卡持有者（P1）」的选择错误派发给效果属主（P2）→ "not your choice"。
      const top = state.pendingEffects[state.pendingEffects.length - 1];
      const chooser = top?.prompt?.chooser ?? top?.player ?? state.turnPlayer;
      executeAction(state, chooser, 'effect-choice', { promptId: a.promptId!, choice: a.choice! });
    } else if (a.kind === 'advance') {
      executeAction(state, player, a.kind);
    } else if (a.kind === 'clear-cache') {
      executeAction(state, player, a.kind);
    } else if (a.kind === 'resolve-trigger') {
      executeAction(state, player, 'resolve-trigger', { cardUid: a.cardUid! });
    }
    } catch (err) {
      // 打印到控制台（诊断日志会一并导出）+ 写入游戏日志树 + 全量追踪，随后重渲染同步 UI
      console.error('[行动结算异常]', err);
      pushLog(state, `行动结算异常：${err instanceof Error ? err.message : String(err)}`);
      trace('错误', `行动结算异常 kind=${a.kind}：${err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err)}`);
      trace('状态', `异常后状态：${stateDigest(state)}`);
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
      // ⚠️ 占位：隐私说明**整屏**由 **Task 7**（本地数据与隐私屏）接管，本任务不调 showLocalData()。
      //   阶段一评审后这里**不再是死胡同**：弹窗上的「隐私说明」按钮已就地展开完整隐私说明
      //   （`src/ui/local-consent.ts` 的 renderPrivacyDetail，唯一出处 = privacy.ts 的 privacyLines()），
      //   本回调只是给 Task 7 留的换页接缝，空实现无害。
      openPrivacy: () => { /* G3 Task 7 填充：本地数据与隐私屏 */ },
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
 * G3 Task 7：「本地数据与隐私」屏（附录 A 的 Task 7 行区：`showModeSelect` 之后）。
 *
 * 只做**接线**：三块内容与全部判据都在 `renderLocalData`（`src/ui/local-data.ts`，可在
 * 无 jsdom 的 DOM 桩上真跑）。这里注入三个宿主能力：
 *  - `back: showStartScreen` —— 回主界面；授权若被「改变选择」/「清除本机数据」重置成
 *    `unknown`，`showStartScreen()` 会**重新问**一次（授权状态不落盘，这是唯一的重问路径）；
 *  - `pickFile` / `saveFile` —— 档案的选择与落盘（浏览器实现只在**这一个地方**被构造）；
 *  - `onImported` —— G3 **只报告，不重放**（`ReplayDriver` 属 G4）。用户可见的报告由
 *    `renderLocalData` 写在屏内状态区（含"本阶段还不能直接重放"与逐条警告），所以这里
 *    只留接缝：G4 接上 driver 时把"直接重放这一份"挂在这里，不需要再改本屏。
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
      // G3 只报告，不重放（ReplayDriver 属 G4）：`file` / `warnings` 是给 G4 的接缝。
      void file;
      void warnings;
    },
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

