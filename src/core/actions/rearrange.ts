import { pushLog } from '../log';
import type { GameState, Line, PlayerId } from '../models/types';
import { gameBus } from '../events/bus';

/** 重排协议：交换指定玩家侧两个协议位（defId 与 compiled 状态随数组元素整体移动；
 *  该线链路/场上卡牌留在原位不跟随 —— 规则文本「控制组件相关规则」：调整协议卡牌只能
 *  调换同一边内部的位置，不能交换到对手那一侧；对应线路内已经打出的卡牌不会跟随移动）。
 *  共享入口：效果栈 op（resolve.ts rearrangeProtocols：water-2/spirit-4/psychic-2 等）
 *  与 UI 控制组件重排动作（game.ts executeAction 'rearrange-protocols'，编译/补满前
 *  持有控制组件的玩家可重排任意一方）共用——两条路径的状态变更 / log / 动画事件
 *  （protocols:rearranged → 现有重排基础动画）完全一致。 */
export function rearrangeProtocolSlots(s: GameState, target: PlayerId, a: Line, b: Line): void {
  if (a === b) throw new Error('cannot swap a protocol position with itself');
  if (a < 0 || a > 2 || b < 0 || b > 2) throw new Error('protocol position out of range');
  const protos = s.players[target].protocols;
  const tmp = protos[a];
  protos[a] = protos[b];
  protos[b] = tmp;
  pushLog(s, `P${target + 1} 重排协议：交换位置 ${a + 1} 与 ${b + 1}`);
  // FX：重排基础动画（两张协议卡同时平移互换位置；重渲染后无缝衔接，见 effects/index.ts
  // 「重排协议基础特效」——与"交换链路"（stacks:swapped）不同的独立动画）
  gameBus.emit({ type: 'protocols:rearranged', state: s, payload: { player: target, a, b } });
}


