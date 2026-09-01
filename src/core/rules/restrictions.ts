import type { GameState, Line, PlayerId } from '../models/types';
import { lineTopCommandActive } from '../state/create';
import { isUncovered } from '../effects/context';

function opp(player: PlayerId): PlayerId {
  return player === 0 ? 1 : 0;
}

/** 顶命令常驻（规则 90 行）：player 任一线堆叠有正面该卡即 true（被盖也生效——只查在场+正面，不看是否未覆盖） */
export function playerHasTopCommand(s: GameState, player: PlayerId, defId: string): boolean {
  for (const line of [0, 1, 2] as Line[]) {
    if (s.players[player].stacks[line].some((c) => c.defId === defId && c.faceUp)) return true;
  }
  return false;
}

/** 底命令仅未覆盖生效（规则 79 行）：player 任一线堆叠【顶卡】正面该卡（isUncovered 判定顶卡） */
export function playerHasActiveBottom(s: GameState, player: PlayerId, defId: string): boolean {
  for (const line of [0, 1, 2] as Line[]) {
    const stack = s.players[player].stacks[line];
    const top = stack[stack.length - 1];
    if (top && top.defId === defId && top.faceUp && isUncovered(s, top)) return true;
  }
  return false;
}

/** 对手该线堆叠有正面该卡（含被盖） */
export function opponentLineHasTop(s: GameState, line: Line, player: PlayerId, defId: string): boolean {
  return s.players[opp(player)].stacks[line].some((c) => c.defId === defId && c.faceUp);
}

/** 对手该线堆叠【顶卡】正面该卡 */
export function opponentLineHasActiveBottom(s: GameState, line: Line, player: PlayerId, defId: string): boolean {
  const stack = s.players[opp(player)].stacks[line];
  const top = stack[stack.length - 1];
  return !!top && top.defId === defId && top.faceUp && isUncovered(s, top);
}

// —— 协议语义封装（defId 常量写在函数内，语义注释标明协议）——

/** spirit-1 顶「你可以在任意列打出牌」——拍板：全局 */
export function canPlayFaceUpAnywhere(s: GameState, player: PlayerId): boolean {
  return playerHasTopCommand(s, player, 'spirit-1');
}

/** psychic-1 顶「你的对手只能以反面打出牌」——拍板：全局（对手所有线只能反面打） */
export function opponentMustPlayFaceDown(s: GameState, player: PlayerId): boolean {
  return playerHasTopCommand(s, opp(player), 'psychic-1');
}

/** plague-0 底「对手无法在此列打出牌」（正反都禁，仅未覆盖时） */
export function lineBlocksOpponent(s: GameState, line: Line, player: PlayerId): boolean {
  return opponentLineHasActiveBottom(s, line, player, 'plague-0');
}

/** metal-2 顶「对手不能在此列以反面打出牌」 */
export function lineBlocksOpponentFaceDown(s: GameState, line: Line, player: PlayerId): boolean {
  return opponentLineHasTop(s, line, player, 'metal-2');
}

/** spirit-0 底「跳过检查缓存阶段」 */
export function shouldSkipCacheCheck(s: GameState, player: PlayerId): boolean {
  return playerHasActiveBottom(s, player, 'spirit-0');
}

/** apathy-2 顶「无效化此列所有牌的中部命令」——拍板：该线双方全部牌（含被盖） */
export function lineMiddleCommandsNullified(s: GameState, line: Line): boolean {
  return lineTopCommandActive(s, line, 'apathy-2');
}
