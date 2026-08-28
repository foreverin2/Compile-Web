import './ui/styles.css';
import { createGame, performDraftPick } from './core/state/create';
import { executeAction } from './core/game';
import { getCompilableLines } from './core/rules/compile';
import { collectTriggers } from './core/effects/triggers';
import { renderApp, type UiCallbacks } from './ui/render';
import type { PlayerId } from './core/models/types';

const root = document.getElementById('app')!;
const state = createGame();

/** 非玩家输入步骤之间自动推进的间隔（毫秒） */
const AUTO_ADVANCE_DELAY = 400;
let autoTimer: number | null = null;
/** 抽牌飞入动画进行中标志：防止动画期间再次触发刷新导致并发动画/双重渲染 */
let drawAnimBusy = false;

const cb: UiCallbacks = {
  onRendered() {
    scheduleAutoAdvance();
  },
  onDraftPick(defId) {
    performDraftPick(state, defId);
    renderApp(root, state, cb);
  },
  onAction(a) {
    if (state.phase === 'gameover') return;
    const player = state.turnPlayer;
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
      // 应答挂起选择：chooser 可能是对手（规则"被作用卡持有者决定执行"）
      const top = state.pendingEffects[state.pendingEffects.length - 1];
      const chooser = top?.player ?? state.turnPlayer;
      executeAction(state, chooser, 'effect-choice', { promptId: a.promptId!, choice: a.choice! });
    } else if (a.kind === 'advance') {
      executeAction(state, player, a.kind);
    } else if (a.kind === 'resolve-trigger') {
      executeAction(state, player, 'resolve-trigger', { cardUid: a.cardUid! });
    }
    // effect-choice：getLegalActions 不产生，由 UI 选择栏应答后经 onAction 分发（chooser 可能是对手）
    if (drawAnimCount > 0) {
      drawAnimBusy = true;
      playDrawAnimation(player, drawAnimCount, () => {
        drawAnimBusy = false;
        renderApp(root, state, cb);
      });
    } else {
      renderApp(root, state, cb);
    }
  },
};

/**
 * 刷新手牌抽牌飞入动画：drawn 张卡背幽灵卡从手牌区外侧（P1 从左侧、P2 从右侧，
 * 与手牌生长方向一致）依次飞入手牌区，每张间隔 120ms；全部落地后移除幽灵卡并
 * 调用 done()（由调用方触发重渲染，此时状态已更新，手牌以正面展示）。
 */
function playDrawAnimation(player: PlayerId, count: number, done: () => void): void {
  const hands = document.querySelectorAll<HTMLElement>('.hand');
  const hand = hands[player];
  if (!hand) {
    done();
    return;
  }
  const rect = hand.getBoundingClientRect();
  const cy = rect.top + rect.height / 2;
  // 起飞点与落点：P1 手牌左起 → 从左侧外飞入左缘；P2 手牌右起 → 从右侧外飞入右缘
  const fromLeft = player === 0;
  const startX = fromLeft ? rect.left - 60 : rect.right + 60;
  const targetX = fromLeft ? rect.left + 24 : rect.right - 24;
  const dx = targetX - startX;
  const ghosts: HTMLElement[] = [];
  for (let i = 0; i < count; i++) {
    const ghost = document.createElement('div');
    ghost.className = 'draw-ghost';
    ghost.style.left = `${startX}px`;
    // 用常量（.draw-ghost 高度 126px 的一半）而非 offsetHeight：
    // 元素尚未 appendChild 时 offsetHeight 恒为 0，读取会导致幽灵卡垂直偏下 63px
    ghost.style.top = `${cy - 63}px`;
    document.body.appendChild(ghost);
    ghosts.push(ghost);
    // 依次起飞：首张 30ms（保证初始位置已被绘制一帧）后每 120ms 起飞下一张，
    // 借助 .draw-ghost 的 transform 过渡从左/右侧滑入手牌区
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
 * 非 action 步骤自动推进：
 * - draft / gameover → 停止（不自动推进）
 * - action → 停止（轮到玩家行动）
 * - 有挂起选择 / 落牌·偏转进行中 → 暂停（等对应玩家应答 / 操作完成）
 * - start/end 有待结算触发 → 暂停（显示触发按钮等玩家点击）
 * - check-compile：有可编译线 → 暂停（编译需玩家点击编译按钮后再执行，不自动编译）
 * - 其余步骤（start/check-control/check-cache/end）→ 自动 advance
 */
function runAutoAdvance(): void {
  if (state.pendingEffects.length > 0) return; // 有挂起选择：等对应玩家应答
  if (state.pendingPlay !== null || state.pendingShift !== null) return; // 落牌/偏转进行中
  if (state.step === 'end' || state.step === 'start') {
    if (collectTriggers(state, state.step).length > 0) return; // 有待结算触发：出按钮
  }
  if (state.phase === 'draft') return;
  if (state.phase === 'gameover' || state.winner !== null) return;
  if (state.step === 'action') return;
  const player = state.turnPlayer;
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

renderApp(root, state, cb);
