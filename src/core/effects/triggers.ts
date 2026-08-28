import type { Card, GameState, Line, TriggerEntry, TriggerKind } from '../models/types';
import { EFFECTS } from './registry';
import { createCtx, findCard, nextEffectId } from './context';

/** 单卡触发查找（被盖住前 / 落地检查用）；未注册 → null */
export function collectTriggerFor(s: GameState, card: Card, kind: TriggerKind): TriggerEntry | null {
  const def = EFFECTS[card.defId]?.triggers?.[kind];
  if (!def) return null;
  return { cardUid: card.uid, defId: card.defId, kind, optional: def.optional };
}

/** 触发效果入栈（调用方需 runStack；本函数只 push） */
export function resolveTrigger(s: GameState, t: TriggerEntry): void {
  const card = findCard(s, t.cardUid);
  const def = EFFECTS[t.defId]?.triggers?.[t.kind];
  if (!card || !def) return;
  const ctx = createCtx(s, card.owner, card);
  s.pendingEffects.push({
    id: nextEffectId(), player: card.owner,
    gen: def.fn(ctx), sourceUid: card.uid, sourceDefId: card.defId,
    prompt: null, lastAnswer: null,
  });
}

/** 收集某类触发：双方场上正面未覆盖顶卡中注册了该触发的卡（跳过已结算 uid） */
export function collectTriggers(s: GameState, kind: TriggerKind): TriggerEntry[] {
  const out: TriggerEntry[] = [];
  const seen = new Set(s.resolvedTriggerUids);
  for (const p of s.players) {
    for (const line of [0, 1, 2] as Line[]) {
      const stack = p.stacks[line];
      const top = stack[stack.length - 1];
      if (!top || !top.faceUp || seen.has(top.uid)) continue;
      const def = EFFECTS[top.defId]?.triggers?.[kind];
      if (!def) continue;
      out.push({ cardUid: top.uid, defId: top.defId, kind, optional: def.optional });
    }
  }
  return out;
}
