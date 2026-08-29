import type { GameState, Step, PlayerId } from '../models/types';

export const STEP_ORDER: Step[] = [
  'start',
  'check-control',
  'check-compile',
  'action',
  'check-cache',
  'end',
];

export function currentPlayer(s: GameState): PlayerId {
  return s.turnPlayer;
}

/** 推进到下一步；end 后换人；compiledThisTurn 时跳过 action */
export function advanceStep(s: GameState): void {
  const idx = STEP_ORDER.indexOf(s.step);
  let next = STEP_ORDER[(idx + 1) % STEP_ORDER.length];
  if (next === 'action' && s.compiledThisTurn) {
    next = 'check-cache';
  }
  s.step = next;
  if (next === 'end' || next === 'start') {
    s.resolvedTriggerUids = [];
  }
  if (next === 'start') {
    const ending = s.turnPlayer;
    s.turnPlayer = ending === 0 ? 1 : 0;
    s.compiledThisTurn = false;
    // 揭示幽灵牌：expiresAfterTurn 玩家回合结束时自动消失
    s.revealedGhosts = s.revealedGhosts.filter((g) => g.expiresAfterTurn !== ending);
  }
}
