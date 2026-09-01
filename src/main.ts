import './ui/styles.css';
import { createGame, performDraftPick, performDraftUnpick } from './core/state/create';
import { executeAction } from './core/game';
import { getCompilableLines } from './core/rules/compile';
import { collectTriggers } from './core/effects/triggers';
import { renderApp, renderDraft, resetUiState, syncCompiledFxLayers, syncSmokeOverlays, syncScanOverlays, syncPsychicParticles, syncPlagueMists, syncApathyMists, syncSpirit0Glows, syncSpirit1Cards, type UiCallbacks } from './ui/render';
import { initEffects, initCompileFx, initRearrangeFx, playRevealFly, buildLoveHeart } from './ui/effects';
import { initDiag } from './ui/diag';
import { initDevMode } from './ui/devmode';
import { gameBus } from './core/events/bus';
import type { PlayerId } from './core/models/types';

const root = document.getElementById('app')!;
let state = createGame();

/** 非玩家输入步骤之间自动推进的间隔（毫秒） */
const AUTO_ADVANCE_DELAY = 400;
let autoTimer: number | null = null;
/** 抽牌飞入动画进行中标志：防止动画期间再次触发刷新导致并发动画/双重渲染 */
let drawAnimBusy = false;
/** 抽牌幽灵卡尺寸与扇形步进（与 styles.css 的 .hand 负 margin 与 .draw-ghost 一致） */
const GHOST_W = 130;
const GHOST_H = 178.8;
const HAND_CARD_SPACING = 102; // 卡宽 130 − 重叠 28
/** 效果触发的抽牌累计（card:drawn 事件 → 本次行动结算完成后统一播抽牌特效）。
 *  love 标志：该次抽牌是否由 love 协议触发（love-1/2/6 及 love 刷新——含对手抽），
 *  播放抽牌飞入动画时给 draw-ghost 卡背挂粉红爱心 + 边框粉红光（FX-4） */
let pendingDraws: { player: PlayerId; count: number; love: boolean }[] = [];
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

const cb: UiCallbacks = {
  onRendered() {
    scheduleAutoAdvance();
  },
  onWinReset() {
    resetToMainInterface();
  },
  onDraftPick(defId) {
    performDraftPick(state, defId);
    if (state.phase === 'turn') {
      // 草案完成：先渲染最终草案（6 张全选）→ 渐进离场 → 全屏加载视频 → 对战界面渐进入场
      renderDraft(root, state, cb);
      playDraftToGameTransition();
    } else {
      renderApp(root, state, cb);
    }
  },
  onDraftUnpick(defId) {
    performDraftUnpick(state, defId);
    renderApp(root, state, cb);
  },
  onAction(a) {
    if (state.phase === 'gameover') return;
    const player = state.turnPlayer;
    // 本次行动的世代快照：动画完成回调据此判断重置是否已发生（见 resetEpoch）
    const epoch = resetEpoch;
    // executeAction 使用窄化重载（play/compile 需 args，refresh/advance 无 args），
    // 而 LegalAction.kind 是联合类型，需按 kind 收窄后再分发
    let drawAnimCount = 0;
    if (a.kind === 'play') {
      executeAction(state, player, 'play', { cardUid: a.cardUid!, faceUp: a.faceUp!, line: a.line! });
    } else if (a.kind === 'compile') {
      executeAction(state, player, 'compile', { line: a.line! });
    } else if (a.kind === 'refresh') {
      // 抽牌飞入动画：记录刷新前手牌数，执行后按差值（= 本次抽了几张）播放动画，
      // 动画结束后再重渲染展示新手牌；动画进行中忽略再次刷新（防并发）
      if (drawAnimBusy) {
        renderApp(root, state, cb);
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
          renderApp(root, state, cb);
        });
      } else {
        renderApp(root, state, cb);
      }
    };
    if (drawAnimCount > 0) {
      drawAnimBusy = true;
      // 刷新按钮抽牌（非效果触发）：love 协议不参与（refresh 动作不产生 card:drawn 事件）→ love=false
      playDrawAnimation(player, drawAnimCount, false, () => {
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
 * 幽灵卡依次落到手牌末尾；任一抽牌由 love 触发 → 合并结果带 love 标志 → draw-ghost 挂爱心），
 * 全部播完调用 done()。
 */
function playDrawSequence(draws: { player: PlayerId; count: number; love: boolean }[], done: () => void): void {
  const merged: { player: PlayerId; count: number; love: boolean }[] = [];
  for (const d of draws) {
    const found = merged.find((m) => m.player === d.player);
    if (found) {
      found.count += d.count;
      found.love = found.love || d.love;
    } else {
      merged.push({ ...d });
    }
  }
  const first = merged[0];
  if (!first) {
    done();
    return;
  }
  playDrawAnimation(first.player, first.count, first.love, () => {
    const rest = merged.slice(1);
    if (rest.length === 0) done();
    else playDrawSequence(rest, done);
  });
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
function playDrawAnimation(player: PlayerId, count: number, love: boolean, done: () => void): void {
  const hands = document.querySelectorAll<HTMLElement>('.hand');
  const hand = hands[player];
  if (!hand) {
    done();
    return;
  }
  const rect = hand.getBoundingClientRect();
  const cy = rect.top + rect.height / 2;
  // 抽牌起点 = 牌库区外侧（与手牌生长方向一致）：P1 取牌库左缘再左 90px、P2 取右缘再右 90px；
  // 牌库元素缺失（不应发生）时回退到手牌区外侧（原行为）
  const deck = document.querySelector<HTMLElement>(`.deck[data-player="${player}"]`);
  const deckRect = deck ? deck.getBoundingClientRect() : null;
  const fromLeft = player === 0;
  const startX = deckRect ? (fromLeft ? deckRect.left - 90 : deckRect.right + 90)
    : (fromLeft ? rect.left - 90 : rect.right + 90);
  // 现有末卡（P1 手牌最右 / P2 row-reverse 最左；排除揭示幽灵牌）；空手牌时回退到手牌区起点
  const cards = hand.querySelectorAll<HTMLElement>('.card:not(.reveal-ghost)');
  const last = cards[cards.length - 1];
  const lastRect = last ? last.getBoundingClientRect() : null;
  const ghosts: HTMLElement[] = [];
  for (let i = 0; i < count; i++) {
    let targetX: number;
    if (lastRect) {
      // 扇形步进：新卡中心距 = 卡宽 130 − 重叠 28 = 102px
      // P1：新卡 1 左缘 = 末卡右缘 − 28（中心 = 右缘 + 37）；P2 反向镜像
      targetX = fromLeft ? lastRect.right + 37 + HAND_CARD_SPACING * i : lastRect.left - 37 - HAND_CARD_SPACING * i;
    } else {
      // 空手牌：P1 落在左 padding 内、P2 落在右 padding 内，逐张按扇形步进向后延伸
      targetX = fromLeft
        ? rect.left + 28 + GHOST_W / 2 + HAND_CARD_SPACING * i
        : rect.right - 28 - GHOST_W / 2 - HAND_CARD_SPACING * i;
    }
    const ghost = document.createElement('div');
    ghost.className = 'draw-ghost';
    ghost.style.left = `${startX}px`;
    // 幽灵卡 top 用常量（GHOST_H 与 .draw-ghost 高度一致）：元素未 appendChild 前 offsetHeight 恒为 0
    ghost.style.top = `${cy - GHOST_H / 2}px`;
    // FX-4 love 抽牌：卡背粉红爱心（跳动）+ 边框粉红光芒（.fx-love-heart 子元素居中于卡背，
    // 与 .draw-ghost 自身的 transform 平移过渡不冲突——动画在子元素上）
    if (love) {
      ghost.classList.add('fx-love-cardglow');
      ghost.appendChild(buildLoveHeart());
    }
    document.body.appendChild(ghost);
    ghosts.push(ghost);
    // 以幽灵卡中心对准落点
    const dx = targetX - (startX + GHOST_W / 2);
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
      renderApp(root, state, cb);
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
 * 胜利结算遮罩「返回主界面」→ 应用内重置（无整页刷新/闪烁）：
 * - 清空本模块的动画标志/队列/定时器（自动推进、抽牌/揭示动画、过渡中标志）；
 * - resetUiState()：清空 render.ts 全部 UI 模块态并移除 body 级常驻层/遮罩
 *   （编译环 / 黑烟 / 放大遮罩 / 弃牌堆查看器——旧局残留会悬空）；
 * - 根容器移除过渡类（draft-exit / board-enter / no-anim）；
 * - 重建游戏状态（createGame → 全新草案）并渲染草案主界面。
 * 选择应用内重置而非 location.reload()：无整页闪烁、保留 devmode/诊断常驻，
 * 且全部可重置状态都有明确复位点（resetUiState 覆盖 render.ts 全部模块态）。
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
  resetUiState();
  root.classList.remove('draft-exit', 'board-enter', 'no-anim');
  state = createGame();
  renderDraft(root, state, cb);
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
// 诊断日志：全量记录 console + 捕获未捕获异常（出错自动提示导出）
initDiag(() => state);
// 隐藏开发者模式：Ctrl+Shift+P 密码进入；get <牌名> 把卡加入当前玩家手牌
// （返回的卸载函数当前不使用，保持监听常驻）
initDevMode({ getState: () => state, render: () => renderApp(root, state, cb) });
// 效果触发的抽牌：累计 card:drawn 事件（love 协议触发 → love 标志 → 抽牌动画挂爱心），
// 行动结算后统一播新抽牌特效
gameBus.subscribe((e) => {
  if (e.type !== 'card:drawn') return;
  const p = e.payload as { player: PlayerId; count: number; triggerProtocol?: string };
  pendingDraws.push({ player: p.player, count: p.count, love: p.triggerProtocol === 'love' });
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
renderApp(root, state, cb);
// 常驻特效层随滚动/缩放重新对齐：已编译环（compiledFx）、暗2 黑烟（smokeOverlays）、
// 能量扫描线（scanOverlays）与 FX-3 念能粒子/瘟疫浓雾（psychicParticles/plagueMists）、
// FX-5 冷漠灰雾/灵魂-0 手牌区光芒/灵魂-1 手牌卡护角（apathyMists/spirit0Glows/spirit1Cards）
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
    syncSpirit0Glows(state);
    syncSpirit1Cards(state);
  });
};
window.addEventListener('scroll', syncPersistentFx, { passive: true, capture: true });
window.addEventListener('resize', syncPersistentFx, { passive: true });
