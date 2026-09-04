import type { GameState, PlayerId, Line, Card } from '../models/types';
import { drawCards } from '../engine/deck';
import { fireRefreshReactives } from '../effects/triggers';
import { getCardDef } from '../../data/demo';
import { runStack } from '../effects/resolve';
import {
  canPlayFaceUpAnywhere,
  cardAllowsFaceUpAnyLine,
  lineBlocksOpponent,
  lineBlocksOpponentFaceDown,
  opponentMustPlayFaceDown,
} from '../rules/restrictions';

/** 卡牌 defId 的协议是否与该线协议匹配（正面打入条件）。行线上同时携带双方协议
 *  （P1 协议 | P2 协议）：卡牌协议匹配本侧或对手同线协议任一即可正面打入。
 *  对手协议缺失（如测试中的空 protocols 数组）时按不匹配处理。 */
export function isPlayableFaceUp(s: GameState, player: PlayerId, cardUid: string, line: Line): boolean {
  const card = s.players[player].hand.find((c) => c.uid === cardUid);
  if (!card) return false;
  // 2代 chaos-3 底（自引用）：本卡可无视协议匹配正面打任意线（批2 corruption-0 同款）；先于全局豁免与匹配判断
  if (cardAllowsFaceUpAnyLine(card.defId)) return true;
  // spirit-1 顶「你可以在任意列打出牌」：持有者任意线正面打（先于协议匹配判断）
  if (canPlayFaceUpAnywhere(s, player)) return true;
  const def = getCardDef(card.defId);
  const opp: PlayerId = player === 0 ? 1 : 0;
  return (
    def.protocol === s.players[player].protocols[line].defId ||
    def.protocol === s.players[opp].protocols[line]?.defId
  );
}

/** 打出卡牌：正面须匹配协议线；背面任意线。先浮空（pendingPlay），completePlay 结算目标顶卡
 *  "被盖住前"触发后落地；正面卡落地后结算中指令（可连锁/挂起）。
 *  执行层守卫（与 getLegalActions 一致，防直接调引擎绕过）：plague-0 此列禁打（正反）、
 *  psychic-1 禁正面打、metal-2 此列禁反面打——效果授予的打出（playFromHand op）不受限（卡牌文本优先）。 */
export function playCard(s: GameState, player: PlayerId, cardUid: string, faceUp: boolean, line: Line): Card {
  const p = s.players[player];
  const idx = p.hand.findIndex((c) => c.uid === cardUid);
  if (idx === -1) throw new Error(`card ${cardUid} not in hand`);
  if (lineBlocksOpponent(s, line, player)) {
    throw new Error(`cannot play into blocked line ${line}`);
  }
  if (faceUp && opponentMustPlayFaceDown(s, player)) {
    throw new Error('cannot play face-up (psychic-1)');
  }
  if (!faceUp && lineBlocksOpponentFaceDown(s, line, player)) {
    throw new Error(`cannot play face-down into line ${line}`);
  }
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
  const drawn = drawCards(s, player, 5 - p.hand.length);
  // 批2：刷新动作完成 → after-refresh（自身侧）/after-opponent-refresh（对手侧）即时连锁
  // （war-0 顶「当你刷新时」/war-1 底「当对手刷新时」）；1代 效果内刷新同款 fire 见 love-2/spirit-0
  fireRefreshReactives(s, player);
  return drawn;
}
