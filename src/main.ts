import './ui/styles.css';
import { createGame, performDraftPick } from './core/state/create';
import { executeAction } from './core/game';
import { renderApp, type UiCallbacks } from './ui/render';

const root = document.getElementById('app')!;
const state = createGame();

const cb: UiCallbacks = {
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

renderApp(root, state, cb);
