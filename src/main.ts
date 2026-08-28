import './ui/styles.css';
import { createGame, performDraftPick } from './core/state/create';
import { executeAction } from './core/game';
import { getCompilableLines } from './core/rules/compile';
import { collectTriggers } from './core/effects/triggers';
import { renderApp, type UiCallbacks } from './ui/render';
import { initEffects } from './ui/effects';
import { initDiag } from './ui/diag';
import { gameBus } from './core/events/bus';
import type { PlayerId } from './core/models/types';

const root = document.getElementById('app')!;
const state = createGame();

/** 非玩家输入步骤之间自动推进的间隔（毫秒） */
const AUTO_ADVANCE_DELAY = 400;
let autoTimer: number | null = null;
/** 抽牌飞入动画进行中标志：防止动画期间再次触发刷新导致并发动画/双重渲染 */
let drawAnimBusy = false;
/** 抽牌幽灵卡尺寸与扇形步进（与 styles.css 的 .hand 负 margin 与 .draw-ghost 一致） */
const GHOST_W = 130;
const GHOST_H = 178.8;
const HAND_CARD_SPACING = 102; // 卡宽 130 − 重叠 28
/** 效果触发的抽牌累计（card:drawn 事件 → 本次行动结算完成后统一播抽牌特效） */
let pendingDraws: { player: PlayerId; count: number }[] = [];

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
    } else if (a.kind === 'clear-cache') {
      executeAction(state, player, a.kind);
    } else if (a.kind === 'resolve-trigger') {
      executeAction(state, player, 'resolve-trigger', { cardUid: a.cardUid! });
    }
    // effect-choice：getLegalActions 不产生，由 UI 选择栏应答后经 onAction 分发（chooser 可能是对手）
    // 效果触发的抽牌（card:drawn 事件，如 fire-0/fire-4）在本次行动结算期间累计，统一播新抽牌特效
    const effectDraws = pendingDraws;
    pendingDraws = [];
    if (drawAnimCount > 0) {
      drawAnimBusy = true;
      playDrawAnimation(player, drawAnimCount, () => {
        drawAnimBusy = false;
        renderApp(root, state, cb);
      });
    } else if (effectDraws.length > 0 && !drawAnimBusy) {
      drawAnimBusy = true;
      playDrawSequence(effectDraws, () => {
        drawAnimBusy = false;
        renderApp(root, state, cb);
      });
    } else {
      renderApp(root, state, cb);
    }
  },
};

/**
 * 效果触发的抽牌序列：按玩家合并计数后逐人播放抽牌飞入动画（同一玩家多次抽牌合并为一次，
 * 幽灵卡依次落到手牌末尾），全部播完调用 done()。
 */
function playDrawSequence(draws: { player: PlayerId; count: number }[], done: () => void): void {
  const merged: { player: PlayerId; count: number }[] = [];
  for (const d of draws) {
    const found = merged.find((m) => m.player === d.player);
    if (found) found.count += d.count;
    else merged.push({ ...d });
  }
  const first = merged[0];
  if (!first) {
    done();
    return;
  }
  playDrawAnimation(first.player, first.count, () => {
    const rest = merged.slice(1);
    if (rest.length === 0) done();
    else playDrawSequence(rest, done);
  });
}

/**
 * 刷新手牌抽牌飞入动画：drawn 张卡背幽灵卡从手牌区外侧（P1 从左侧、P2 从右侧，
 * 与手牌生长方向一致）依次飞入，每张间隔 120ms。
 * - 终点 = 当前手牌末尾（现有末卡之后逐张按扇形步进延伸），而非固定点
 * - 幽灵卡尺寸与正常手牌卡一致（130×178.8，见 .draw-ghost）
 * 全部落地后移除幽灵卡并调用 done()（由调用方触发重渲染）。
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
  const fromLeft = player === 0;
  const startX = fromLeft ? rect.left - 90 : rect.right + 90;
  // 现有末卡（P1 手牌最右 / P2 row-reverse 最左）；空手牌时回退到手牌区起点
  const cards = hand.querySelectorAll<HTMLElement>('.card');
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
  if (state.pendingEffects.length > 0) return; // 有挂起选择：等对应玩家应答
  if (state.pendingPlay !== null || state.pendingShift !== null) return; // 落牌/偏转进行中
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
// 诊断日志：全量记录 console + 捕获未捕获异常（出错自动提示导出）
initDiag(() => state);
// 效果触发的抽牌：累计 card:drawn 事件，行动结算后统一播新抽牌特效
gameBus.subscribe((e) => {
  if (e.type !== 'card:drawn') return;
  const p = e.payload as { player: PlayerId; count: number };
  pendingDraws.push({ player: p.player, count: p.count });
});
renderApp(root, state, cb);
