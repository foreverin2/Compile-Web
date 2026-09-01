import type { Card, GameState, Line, PlayerId, TriggerEntry, TriggerKind } from '../models/types';
import { EFFECTS } from './registry';
import { createCtx, findCard, nextEffectId } from './context';

/** 即时连锁触发种类：抽牌后 / 弃牌后 / 删除后 / 清理缓存后 */
export type ReactiveKind = 'after-draw' | 'after-discard' | 'after-delete' | 'after-clear-cache';

/** 即时连锁触发（只 push 不 runStack——由外层 runStack 循环 LIFO 处理；非 runStack 上下文由调用方负责 runStack）。
 *  收集注册了该 kind 触发的场上正面卡并 push 触发效果（topCommand 标志：sourceValid 跳过未覆盖检查——
 *  after-* 全是顶命令，被覆盖仍生效，规则 90 行）：
 *  - after-discard：遍历 actor 的**对手**（plague-1「对手弃牌后：你抽1张」）
 *  - 其余：遍历 actor 自己（spirit-3「你抽牌后」/ hate-3「你的牌被删除后」/ speed-1「清理缓存后」）
 *  遍历全部三条线堆叠的所有卡（不只顶卡） */
export function fireReactive(s: GameState, kind: ReactiveKind, actor: PlayerId): void {
  const players: PlayerId[] = kind === 'after-discard' ? [actor === 0 ? 1 : 0] : [actor];
  for (const pid of players) {
    for (const line of [0, 1, 2] as Line[]) {
      for (const card of s.players[pid].stacks[line]) {
        if (!card.faceUp) continue;
        const def = EFFECTS[card.defId]?.triggers?.[kind];
        if (!def) continue;
        s.pendingEffects.push({
          id: nextEffectId(),
          player: card.owner,
          gen: def.fn(createCtx(s, card.owner, card)),
          sourceUid: card.uid,
          sourceDefId: card.defId,
          topCommand: true,
          prompt: null,
          lastAnswer: null,
        });
      }
    }
  }
}

/** 单卡触发查找（被盖住前 / 落地检查用）；未注册 → null */
export function collectTriggerFor(s: GameState, card: Card, kind: TriggerKind): TriggerEntry | null {
  const def = EFFECTS[card.defId]?.triggers?.[kind];
  if (!def) return null;
  return { cardUid: card.uid, defId: card.defId, kind, optional: def.optional, top: def.top };
}

/** 触发效果入栈（调用方需 runStack；本函数只 push）
 *  opts.topCommand：顶命令触发（被覆盖仍生效，sourceValid 跳过未覆盖检查）——before-compile
 *  （speed-2 顶「通过编译删除此牌前：平移此牌，不论是否被盖住」）等使用 */
export function resolveTrigger(s: GameState, t: TriggerEntry, opts?: { topCommand?: boolean }): void {
  const card = findCard(s, t.cardUid);
  const def = EFFECTS[t.defId]?.triggers?.[t.kind];
  if (!card || !def) return;
  const ctx = createCtx(s, card.owner, card);
  s.pendingEffects.push({
    id: nextEffectId(), player: card.owner,
    gen: def.fn(ctx), sourceUid: card.uid, sourceDefId: card.defId,
    topCommand: opts?.topCommand,
    prompt: null, lastAnswer: null,
  });
}

/** 收集某类触发：end/start 只收集回合玩家场地侧（规则书"结算你场地侧所有'结束'触发"）；
 *  其他种类（after 等，机制预留）收集双方。取场上正面卡中注册了该触发的卡（跳过已结算 uid）：
 *  - 顶卡（未覆盖）：top/bottom 触发都收集（bottom 仅未覆盖生效，规则 79 行）
 *  - 被盖卡：仅收集注册了 top 标志的顶命令触发（FAQ 98/99：顶命令被盖仍生效，如 death-1/life-0）
 *  每次调用重新收集（resolvedTriggerUids 仅在当次 end/start 步骤内去重——步骤内结算中新
 *  暴露的触发会出现在后续收集中，由玩家逐个 resolve；FAQ 68 的记录时点快照差异不构成
 *  当前任何已注册卡的行为差异） */
export function collectTriggers(s: GameState, kind: TriggerKind): TriggerEntry[] {
  const out: TriggerEntry[] = [];
  const seen = new Set(s.resolvedTriggerUids);
  const players: PlayerId[] = kind === 'end' || kind === 'start' ? [s.turnPlayer] : [0, 1];
  for (const pid of players) {
    const p = s.players[pid];
    for (const line of [0, 1, 2] as Line[]) {
      const stack = p.stacks[line];
      for (let i = 0; i < stack.length; i++) {
        const card = stack[i];
        if (!card.faceUp || seen.has(card.uid)) continue;
        const def = EFFECTS[card.defId]?.triggers?.[kind];
        if (!def) continue;
        const isTop = i === stack.length - 1;
        if (!isTop && !def.top) continue; // 被盖卡仅顶命令（top 标志）触发
        out.push({ cardUid: card.uid, defId: card.defId, kind, optional: def.optional, top: def.top });
      }
    }
  }
  return out;
}
