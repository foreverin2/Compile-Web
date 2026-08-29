import type { GameState, Line, PlayerId } from '../../models/types';
import { registerCardEffects } from '../registry';

/** darkness-2 顶命令数值修正：此栈每张反面牌分值 4（而非 2）。Task 9 在本文件补全其余 darkness 效果 */
function darkness2ValueModifier(s: GameState, owner: PlayerId, line: Line, total: number): number {
  const stack = s.players[owner].stacks[line];
  const faceDown = stack.filter((c) => !c.faceUp).length;
  return total + faceDown * 2; // 反面 2 → 4
}

registerCardEffects('darkness-2', {
  valueModifier: { target: 'own-stack', apply: darkness2ValueModifier },
});
