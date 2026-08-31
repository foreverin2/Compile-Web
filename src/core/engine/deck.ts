import type { Card, GameState, PlayerId } from '../models/types';

export function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** 从牌库顶抽 count 张；牌库不足则洗弃牌堆重组，再抽满 */
export function drawCards(s: GameState, player: PlayerId, count: number): Card[] {
  const p = s.players[player];
  const drawn: Card[] = [];
  for (let i = 0; i < count; i++) {
    if (p.deck.length === 0) {
      if (p.trash.length === 0) break;
      p.deck = shuffle(p.trash);
      p.trash = [];
      // R11.4：弃牌堆 → 牌库 = 进入秘密信息区：弃牌堆的正面卡回牌库后必须翻回反面
      // （否则 cardPointValue 会误按牌面分值计；牌库卡一律视为反面 2）
      for (const c of p.deck) c.faceUp = false;
    }
    const card = p.deck.pop()!;
    card.zone = 'hand';
    // 手牌 = 已知信息：抽入即解禁——即使该卡带牌堆来源的 secret 标记（曾被弃牌堆洗回牌库），
    // 进入手牌后也可见正面（与 return op 回手即解禁一致）
    card.secret = false;
    card.line = null;
    card.pos = null;
    card.faceUp = true;
    drawn.push(card);
    p.hand.push(card);
  }
  return drawn;
}

/** 手牌 → 弃牌堆（正面朝上） */
export function discardFromHand(s: GameState, player: PlayerId, cardUid: string): Card {
  const p = s.players[player];
  const idx = p.hand.findIndex((c) => c.uid === cardUid);
  if (idx === -1) throw new Error(`card ${cardUid} not in hand of player ${player}`);
  const [card] = p.hand.splice(idx, 1);
  card.zone = 'trash';
  card.faceUp = true;
  card.line = null;
  card.pos = null;
  p.trash.push(card);
  return card;
}

/** 清缓存：手牌 >5 时弃至 5 张（弃最后几张），返回被弃卡 */
export function clearCache(s: GameState, player: PlayerId): Card[] {
  const p = s.players[player];
  const excess = p.hand.length - 5;
  if (excess <= 0) return [];
  const discarded: Card[] = [];
  for (let i = 0; i < excess; i++) {
    const card = p.hand.pop()!;
    card.zone = 'trash';
    card.faceUp = true;
    card.line = null;
    card.pos = null;
    p.trash.push(card);
    discarded.push(card);
  }
  return discarded;
}
