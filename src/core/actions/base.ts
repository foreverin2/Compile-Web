import type { GameState, PlayerId, Line, Card } from '../models/types';
import { drawCards } from '../engine/deck';
import { getCardDef } from '../../data/demo';
import { runStack } from '../effects/resolve';

/** 卡牌 defId 的协议是否与该线协议匹配（正面打入条件）。行线上同时携带双方协议
 *  （P1 协议 | P2 协议）：卡牌协议匹配本侧或对手同线协议任一即可正面打入。
 *  对手协议缺失（如测试中的空 protocols 数组）时按不匹配处理。 */
export function isPlayableFaceUp(s: GameState, player: PlayerId, cardUid: string, line: Line): boolean {
  const card = s.players[player].hand.find((c) => c.uid === cardUid);
  if (!card) return false;
  const def = getCardDef(card.defId);
  const opp: PlayerId = player === 0 ? 1 : 0;
  return (
    def.protocol === s.players[player].protocols[line].defId ||
    def.protocol === s.players[opp].protocols[line]?.defId
  );
}

/** 打出卡牌：正面须匹配协议线；背面任意线。先浮空（pendingPlay），completePlay 结算目标顶卡
 *  "被盖住前"触发后落地；正面卡落地后结算中指令（可连锁/挂起）。 */
export function playCard(s: GameState, player: PlayerId, cardUid: string, faceUp: boolean, line: Line): Card {
  const p = s.players[player];
  const idx = p.hand.findIndex((c) => c.uid === cardUid);
  if (idx === -1) throw new Error(`card ${cardUid} not in hand`);
  if (faceUp && !isPlayableFaceUp(s, player, cardUid, line)) {
    throw new Error(`cannot play face-up into line ${line}`);
  }
  const [card] = p.hand.splice(idx, 1);
  card.zone = 'float';
  card.faceUp = faceUp;
  card.line = line;
  card.pos = null;
  s.pendingPlay.push({ card, beforeCoveredDone: false });
  s.log.push(`P${player + 1} plays ${card.defId} ${faceUp ? 'face-up' : 'face-down'} to line ${line + 1}`);
  runStack(s); // 结算 before-covered（若有）→ 栈空时 completePlay 落地 + 中指令
  return card;
}

/** 刷新手牌：手牌 <5 时抽至 5；否则抛错 */
export function refreshHand(s: GameState, player: PlayerId): Card[] {
  const p = s.players[player];
  if (p.hand.length >= 5) throw new Error('cannot refresh with 5+ cards in hand');
  return drawCards(s, player, 5 - p.hand.length);
}
