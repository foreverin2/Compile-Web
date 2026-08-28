import type { Card, ChoiceCard, EffectCtx, GameState, Line, PlayerId, CandidateFilter } from '../models/types';
import { getCardDef } from '../../data/demo';
import { gameBus } from '../events/bus';

let effectIdCounter = 0;
export function nextEffectId(): string {
  effectIdCounter += 1;
  return `e${effectIdCounter}`;
}

/** 全状态查找卡牌（含浮空中的 pendingPlay/pendingShift 卡） */
export function findCard(s: GameState, uid: string): Card | undefined {
  if (s.pendingPlay?.uid === uid) return s.pendingPlay;
  if (s.pendingShift?.uid === uid) return s.pendingShift;
  for (const p of s.players) {
    for (const zone of ['hand', 'deck', 'trash'] as const) {
      const c = p[zone].find((x) => x.uid === uid);
      if (c) return c;
    }
    for (const line of [0, 1, 2] as Line[]) {
      const c = p.stacks[line].find((x) => x.uid === uid);
      if (c) return c;
    }
  }
  return undefined;
}

/** 是否为其堆叠顶卡（未被覆盖；仅场上卡有意义） */
export function isUncovered(s: GameState, card: Card): boolean {
  if (card.zone !== 'field' || card.line === null) return false;
  const stack = s.players[card.owner].stacks[card.line];
  return stack[stack.length - 1]?.uid === card.uid;
}

function toChoiceCard(c: Card): ChoiceCard {
  const def = getCardDef(c.defId);
  return {
    uid: c.uid, defId: c.defId, faceUp: c.faceUp, owner: c.owner,
    zone: c.zone, line: c.line, pos: c.pos, label: String(def.value),
  };
}

/** 候选列表：手牌（指定 owner）或场上双方所有堆叠顶卡（排除结算中源卡——幽灵状态防护） */
export function listCandidates(s: GameState, filter: CandidateFilter): ChoiceCard[] {
  const resolving = new Set(s.pendingEffects.map((pe) => pe.sourceUid));
  const out: ChoiceCard[] = [];
  if (filter.zone === 'hand') {
    const p = s.players[filter.owner!];
    for (const c of p.hand) out.push(toChoiceCard(c));
    return out;
  }
  for (const p of s.players) {
    for (const line of [0, 1, 2] as Line[]) {
      const stack = p.stacks[line];
      if (stack.length === 0) continue;
      const top = stack[stack.length - 1];
      if (resolving.has(top.uid)) continue;
      out.push(toChoiceCard(top));
    }
  }
  return out;
}

export function createCtx(s: GameState, player: PlayerId, card: Card): EffectCtx {
  return { s, player, card, candidates: (filter) => listCandidates(s, filter) };
}

/** 发语义事件（特效层订阅；payload 含 protocol 供协议命名空间分发） */
export function emitCardEvent(
  s: GameState,
  type: string,
  card: Card,
  extra?: Record<string, unknown>,
): void {
  gameBus.emit({
    type,
    state: s,
    payload: {
      uid: card.uid, defId: card.defId, protocol: card.defId.split('-')[0],
      owner: card.owner, faceUp: card.faceUp, zone: card.zone,
      line: card.line, pos: card.pos, ...extra,
    },
  });
}
