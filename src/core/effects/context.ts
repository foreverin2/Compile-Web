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
  for (const item of s.pendingPlay) if (item.card.uid === uid) return item.card;
  for (const item of s.pendingShift) if (item.card.uid === uid) return item.card;
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

/** 牌堆顶可打出性：牌库非空（playTopDeck 不洗弃牌堆——FAQ 142/166：从牌堆顶打出不强制洗牌，仅抽牌洗） */
export function deckTopAvailable(s: GameState, player: PlayerId): boolean {
  return s.players[player].deck.length > 0;
}

function toChoiceCard(c: Card): ChoiceCard {
  const def = getCardDef(c.defId);
  return {
    uid: c.uid, defId: c.defId, faceUp: c.faceUp, owner: c.owner,
    zone: c.zone, line: c.line, pos: c.pos, label: String(def.value),
  };
}

/** 候选列表：手牌（指定 owner）或场上堆叠卡（默认双方各堆叠顶卡；covered:true 时列被覆盖的卡）。
 *  只排除【栈顶效果】的源卡——即"当前结算效果不能选自己"（= 卡面文本「另1张/另牌」的排除语义）。
 *  栈内其他效果源卡（如连锁时外层 gravity-2 仍在栈中）【不排除】：规则 97 允许连锁效果选中它们
 *  （选中后它们被翻面/移动 → sourceValid 终止其剩余效果，符合"正在生效的效果被翻面/移除即终止"）。
 *  旧实现排除全部结算中源卡 → 连锁效果在场上只剩源卡时无目标（gravity-2 翻 life-1 → life-1 的
 *  「翻转1张牌」选不了 gravity-2 → 双双 fizzle，用户报"未触发生命1的效果"）。 */
export function listCandidates(s: GameState, filter: CandidateFilter): ChoiceCard[] {
  const top = s.pendingEffects[s.pendingEffects.length - 1];
  const resolving = top ? new Set([top.sourceUid]) : new Set<string>();
  const out: ChoiceCard[] = [];
  if (filter.zone === 'hand') {
    const p = s.players[filter.owner!];
    for (const c of p.hand) out.push(toChoiceCard(c));
    return out;
  }
  for (const p of s.players) {
    if (filter.owner !== undefined && p !== s.players[filter.owner]) continue;
    for (const line of [0, 1, 2] as Line[]) {
      const stack = p.stacks[line];
      if (stack.length === 0) continue;
      if (filter.covered) {
        // covered: 列出该堆叠全部被覆盖的卡（排除顶卡——顶卡未被覆盖；排除结算中源卡）
        for (let i = 0; i < stack.length - 1; i++) {
          const c = stack[i];
          if (resolving.has(c.uid)) continue;
          out.push(toChoiceCard(c));
        }
      } else {
        const top = stack[stack.length - 1];
        if (resolving.has(top.uid)) continue;
        out.push(toChoiceCard(top));
      }
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
