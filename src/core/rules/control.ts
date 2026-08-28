import type { GameState, PlayerId, Line } from '../models/types';
import { getLineValue } from '../state/create';

/** 控制权判定：在 check-control 步骤调用。
 *  若某玩家在至少 2 条线路上总值高于对手，则获得控制组件（s.control = 该玩家）。
 *  平局或都不满足时保持现状（中立或当前持有者）。 */
export function checkControl(s: GameState): void {
  // 统计双方各自赢得的线路数
  const wins: [number, number] = [0, 0];
  for (const line of [0, 1, 2] as Line[]) {
    const v0 = getLineValue(s, 0, line);
    const v1 = getLineValue(s, 1, line);
    if (v0 > v1) wins[0]++;
    else if (v1 > v0) wins[1]++;
  }
  if (wins[0] >= 2) s.control = 0;
  else if (wins[1] >= 2) s.control = 1;
  // 否则保持现状
}

/** 控制组件重置：编译或刷新时，若持有者执行该动作，控制权回到中立。 */
export function resetControlIfHeld(s: GameState, player: PlayerId): void {
  if (s.control === player) s.control = -1;
}
