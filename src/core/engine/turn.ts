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
    // metal-1「对手下回合不能编译」只禁一回合：被禁玩家回合结束（end → start 换人）→ 恢复
    if (s.compileBlocked === ending) s.compileBlocked = null;
    // 回合计数：每次回合结束转换（end → start）恰 +1（advanceStep 是唯一换人入口）；
    // 先计数再清除，expiresAtTurn <= 新计数的揭示幽灵自动消失。
    // 揭示发生在当前回合的任意步骤（start/end 触发也算）时，计数基准 = 当次回合内
    // 的当前值；A 用例（自己的牌→对手，第 2 次转换 = 对手回合结束）、B 用例
    // （对手的牌→自己，第 3 次转换 = 发起者下回合结束）的语义不受步骤影响。
    s.turnCount += 1;
    s.revealedGhosts = s.revealedGhosts.filter((g) => g.expiresAtTurn > s.turnCount);
    // 2代 牌库揭示标记（clarity-1/2/3）：与揭示幽灵同点过期（回合结束转换清除）
    s.deckReveals = s.deckReveals.filter((d) => d.expiresAtTurn > s.turnCount);
  }
}
