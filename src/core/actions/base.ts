import type { GameState, PlayerId, Line, Card } from '../models/types';
import { drawCards } from '../engine/deck';
import { getCardDef } from '../../data/demo';

/** 卡牌 defId 的协议是否与该线协议匹配（正面打入条件） */
export function isPlayableFaceUp(s: GameState, player: PlayerId, cardUid: string, line: Line): boolean {
  const card = s.players[player].hand.find((c) => c.uid === cardUid);
  if (!card) return false;
  const def = getCardDef(card.defId);
  return def.protocol === s.players[player].protocols[line].defId;
}

/** 打出卡牌：正面须匹配协议线；背面任意线；置于堆叠顶部 */
export function playCard(s: GameState, player: PlayerId, cardUid: string, faceUp: boolean, line: Line): Card {
  const p = s.players[player];
  const idx = p.hand.findIndex((c) => c.uid === cardUid);
  if (idx === -1) throw new Error(`card ${cardUid} not in hand`);
  if (faceUp && !isPlayableFaceUp(s, player, cardUid, line)) {
    throw new Error(`cannot play face-up into line ${line}`);
  }
  const [card] = p.hand.splice(idx, 1);
  card.zone = 'field';
  card.faceUp = faceUp;
  card.line = line;
  card.pos = p.stacks[line].length;
  p.stacks[line].push(card);
  s.log.push(`P${player + 1} plays ${card.defId} ${faceUp ? 'face-up' : 'face-down'} to line ${line + 1}`);
  return card;
}

/** 刷新手牌：手牌 <5 时抽至 5；否则抛错 */
export function refreshHand(s: GameState, player: PlayerId): Card[] {
  const p = s.players[player];
  if (p.hand.length >= 5) throw new Error('cannot refresh with 5+ cards in hand');
  return drawCards(s, player, 5 - p.hand.length);
}
