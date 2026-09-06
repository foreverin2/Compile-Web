import type { Card, GameState, Line, PlayerId, TriggerEntry, TriggerKind } from '../models/types';
import { EFFECTS } from './registry';
import { createCtx, findCard, isUncovered, nextEffectId, cardCommandDisabled } from './context';

/** 即时连锁触发种类：抽牌后 / 弃牌后 / 删除后 / 清理缓存后 / 对手抽牌后（mirror-4/war-0 底）/
 *  自己弃牌后（peace-4 底）/ 刷新后 / 对手刷新后 / 编译后 / 切洗后（time-2 顶）/ 定向 after-play/after-return
 *  —— 3代（2026-09）：对手获得控制权后 / 你编译后（self）/ 任意玩家编译后（both）/ 任意玩家清缓存后（both）/
 *  你删除牌后（执行者侧）/ 你重排协议后（self）/ 任意玩家重排协议后（both）/ 你用行动反面打出后（self） */
export type ReactiveKind =
  | 'after-draw'
  | 'after-discard'
  | 'after-delete'
  | 'after-clear-cache'
  | 'after-opponent-draw'
  | 'after-self-discard'
  | 'after-refresh'
  | 'after-opponent-refresh'
  | 'after-compile'
  | 'after-shuffle'
  | 'after-play'
  | 'after-return'
  | 'after-opponent-gain-control'
  | 'after-self-compile'
  | 'after-any-compile'
  | 'after-any-clear-cache'
  | 'after-own-delete'
  | 'after-self-rearrange'
  | 'after-any-rearrange'
  | 'after-action-face-down-play';

/** Fire direction per kind (actor view): self = actor's own side; opp = actor's opponent side; both = both sides.
 *  - opp kinds (after-discard / after-opponent-* / after-compile / after-opponent-gain-control):
 *    cards registered on the actor's opponent side (plague-1 / war-1 / war-2 / lust-4 + pride-6 "when your
 *    opponent gains control");
 *  - self kinds (after-draw / after-self-* / after-refresh / after-delete / after-clear-cache /
 *    after-own-delete ...): "when you X" cards registered on the actor's own side;
 *  - both kinds (after-any-compile / after-any-clear-cache / after-any-rearrange): "when any player X"
 *    cards on either side (gluttony-1 bottom / momentum-1 + momentum-6 ...).
 *  after-play / after-return are directed triggers (fireDirectedTop), not fireReactive (placeholder self). */
const FIRE_DIR: Record<ReactiveKind, 'self' | 'opp' | 'both'> = {
  'after-draw': 'self',
  'after-discard': 'opp',
  'after-delete': 'self',
  'after-clear-cache': 'self',
  'after-opponent-draw': 'opp',
  'after-self-discard': 'self',
  'after-refresh': 'self',
  'after-opponent-refresh': 'opp',
  'after-compile': 'opp',
  'after-shuffle': 'self',
  'after-play': 'self',
  'after-return': 'self',
  'after-opponent-gain-control': 'opp',
  'after-self-compile': 'self',
  'after-any-compile': 'both',
  'after-any-clear-cache': 'both',
  'after-own-delete': 'self',
  'after-self-rearrange': 'self',
  'after-any-rearrange': 'both',
  'after-action-face-down-play': 'self',
};

/** 刷新动作的即时连锁（war-0 顶「当你刷新时」自身侧 / war-1 底「当对手刷新时」对手侧）；
 *  调用点：动作刷新（refreshHand）、1代 效果刷新（love-2/spirit-0 的补至 5 句）。无注册卡时 no-op。 */
export function fireRefreshReactives(s: GameState, actor: PlayerId): void {
  fireReactive(s, 'after-refresh', actor);
  fireReactive(s, 'after-opponent-refresh', actor);
}

/** 即时连锁触发（只 push 不 runStack——由外层 runStack 循环 LIFO 处理；非 runStack 上下文由调用方负责 runStack）。
 *  收集注册了该 kind 触发的场上正面卡并 push 触发效果；方向（遍历哪一侧）与覆盖敏感（TriggerDef.top）：
 *  - 遍历侧：'after-discard'/'after-opponent-draw'/'after-opponent-refresh'/'after-compile' 遍历 **actor 的对手**
 *    （plague-1「对手弃牌后」、mirror-4/war-0「当对手抽牌时」、war-1「当对手刷新时」、war-2「当对手编译后」）；
 *    其余（after-draw/after-self-discard/after-delete/after-clear-cache/after-refresh）遍历 actor 自己。
 *  - after-play / after-return 为**定向触发**（resolve completePlay/return 直接查目标卡），不走本函数。
 *  - 覆盖敏感（2026-09-05 2代）：TriggerDef.top === true（顶命令，1代 after-* 全带）→ 被盖仍触发，
 *    push 带 topCommand:true；top 缺省/非 true（底命令反应，如 mirror-4/peace-4/war-1/war-2 注册于底部槽）→
 *    仅当该卡 isUncovered（其堆叠顶卡）才触发，push 不带 topCommand（源有效性走常规未覆盖检查）。
 *  遍历全部三条线堆叠的所有卡（不只顶卡；命中条件见上） */
export function fireReactive(s: GameState, kind: ReactiveKind, actor: PlayerId): void {
  const dir = FIRE_DIR[kind];
  const players: PlayerId[] =
    dir === 'self' ? [actor] : dir === 'opp' ? [actor === 0 ? 1 : 0] : [0, 1];
  for (const pid of players) {
    for (const line of [0, 1, 2] as Line[]) {
      for (const card of s.players[pid].stacks[line]) {
        if (!card.faceUp) continue;
        const def = EFFECTS[card.defId]?.triggers?.[kind];
        if (!def) continue;
        // 3代 inertia-0/1 区域禁用（C7 全禁）：顶命令注册（top）被 inertia-0 链禁 → 跳过；
        // 底命令反应（无 top）被 inertia-1 链禁 → 跳过
        if (cardCommandDisabled(s, card, def.top ? 'top' : 'bottom')) continue;
        // 底命令反应（未注册 top）：仅未覆盖顶卡触发（规则 79 行「底命令仅未覆盖生效」）
        if (!def.top && !isUncovered(s, card)) continue;
        s.pendingEffects.push({
          id: nextEffectId(),
          player: card.owner,
          gen: def.fn(createCtx(s, card.owner, card)),
          sourceUid: card.uid,
          sourceDefId: card.defId,
          topCommand: !!def.top,
          prompt: null,
          lastAnswer: null,
        });
      }
    }
  }
}

/** 单卡触发查找（被盖住前 / 落地检查用）；未注册 → null（3代 inertia 区域禁顶/底 → 相应框触发视为未注册） */
export function collectTriggerFor(s: GameState, card: Card, kind: TriggerKind): TriggerEntry | null {
  const def = EFFECTS[card.defId]?.triggers?.[kind];
  if (!def) return null;
  if (cardCommandDisabled(s, card, def.top ? 'top' : 'bottom')) return null;
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
        // 3代 inertia-0/1 区域禁用（C7）：顶命令（top 标志）被禁顶链跳过 / 底命令被禁底链跳过
        if (cardCommandDisabled(s, card, def.top ? 'top' : 'bottom')) continue;
        const isTop = i === stack.length - 1;
        if (!isTop && !def.top) continue; // 被盖卡仅顶命令（top 标志）触发
        out.push({ cardUid: card.uid, defId: card.defId, kind, optional: def.optional, top: def.top });
      }
    }
  }
  return out;
}
