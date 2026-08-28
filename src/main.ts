import './ui/styles.css';
import { createGame, performDraftPick } from './core/state/create';
import { executeAction } from './core/game';
import { getCompilableLines } from './core/rules/compile';
import { renderApp, type UiCallbacks } from './ui/render';

const root = document.getElementById('app')!;
const state = createGame();

/** 非玩家输入步骤之间自动推进的间隔（毫秒） */
const AUTO_ADVANCE_DELAY = 400;
let autoTimer: number | null = null;

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
    // executeAction 使用窄化重载（play/compile 需 args，refresh/advance 无 args），
    // 而 LegalAction.kind 是联合类型，需按 kind 收窄后再分发
    if (a.kind === 'play') {
      executeAction(state, state.turnPlayer, 'play', { cardUid: a.cardUid!, faceUp: a.faceUp!, line: a.line! });
    } else if (a.kind === 'compile') {
      executeAction(state, state.turnPlayer, 'compile', { line: a.line! });
    } else {
      executeAction(state, state.turnPlayer, a.kind);
    }
    renderApp(root, state, cb);
  },
};

/**
 * 非 action 步骤自动推进：
 * - draft / gameover → 停止（不自动推进）
 * - action → 停止（轮到玩家行动）
 * - check-compile：恰 1 条可编译 → 自动编译该线；多条可编译 → 暂停等玩家选择
 * - 其余步骤（start/check-control/check-cache/end）→ 自动 advance
 */
function runAutoAdvance(): void {
  if (state.phase === 'draft') return;
  if (state.phase === 'gameover' || state.winner !== null) return;
  if (state.step === 'action') return;
  const player = state.turnPlayer;
  if (state.step === 'check-compile') {
    const lines = getCompilableLines(state, player);
    if (lines.length === 1) {
      cb.onAction({ kind: 'compile', line: lines[0] });
      return;
    }
    if (lines.length > 1) return; // 多条可编译：暂停，显示编译按钮等玩家选择
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
