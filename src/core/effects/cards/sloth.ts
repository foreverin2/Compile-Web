import type { EffectCtx, EffectStep, GameState, Line, PlayerId, StepResult } from '../../models/types';
import { registerCardEffects } from '../registry';
import { deckTopAvailable } from '../context';
import { getLineValue } from '../../state/create';
import { fireRefreshReactives } from '../triggers';
import { canRefreshDraw } from '../../engine/deck';
import { controlRearrangeFlow } from '../control-rearrange-flow';

/**
 * 3代 怠惰 sloth（关键词：回手/刷新/翻转/弃牌/对比总阈值；座右铭：迁延因循）。
 * 权威卡文：src/data/cards3.ts（compile3文本.txt）；裁决：docs/3代-批2-规格与裁决清单.md
 * （B8 怠惰0 按相邻上方那张怠惰牌 +5；回手任意场牌回其主 RQ7-A；效果内刷新 = 完整刷新
 *  含控制组件归还+可重排；E6 toDeckBottom 放回牌库底）。
 */

function opp(p: PlayerId): PlayerId {
  return p === 0 ? 1 : 0;
}

/** 该线链路中某卡上方相邻那张（找 idx+1）是否 sloth 协议卡 */
function coveredBySloth(s: GameState, owner: PlayerId, line: Line, uid: string): boolean {
  const stack = s.players[owner].stacks[line];
  const idx = stack.findIndex((c) => c.uid === uid);
  if (idx === -1) return false;
  const above = stack[idx + 1];
  return !!above && above.defId.startsWith('sloth-');
}

/** sloth-0 顶（valueModifier own-stack）：若此牌被1张怠惰牌覆盖，你在此链路的总阈值增加5。
 *  判定 = 相邻上方那张是怠惰协议牌（B8）；被盖后 faceUp 仍常驻生效（引擎自动）；每张 sloth-0 +5。 */
function sloth0Modifier(s: GameState, owner: PlayerId, line: Line, total: number): number {
  let bonus = 0;
  const stack = s.players[owner].stacks[line];
  for (let i = 0; i < stack.length; i++) {
    const c = stack[i];
    if (c.defId === 'sloth-0' && c.faceUp && coveredBySloth(s, owner, line, c.uid)) bonus += 5;
  }
  return total + bonus;
}

/** sloth-0 中：在每条你总阈值低于对手的链路中抽1张牌。（快照低于线逐线 draw 1） */
function* sloth0Middle(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const me = ctx.player;
  const lines = ([0, 1, 2] as Line[]).filter((l) => getLineValue(ctx.s, me, l) < getLineValue(ctx.s, opp(me), l));
  for (const l of lines) yield { op: 'draw', count: 1 };
}

/** sloth-1 中：回手1张其他牌。若回手的是你的牌，刷新。
 *  回手任意场顶卡回其主（RQ7-A）；被回手卡 owner === 己 → 完整刷新（控制组件归还+可重排 → 抽至 5 → 连锁）。 */
function* sloth1Middle(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const cand = ctx.candidates({ zone: 'field' }); // 源卡自动排除 → 「其他牌」
  const rAns = yield { kind: 'select', title: 'sloth-1：回手1张其他牌', min: 1, max: 1, optional: false, candidates: cand };
  if (rAns.selected.length === 0) return;
  const uid = rAns.selected[0];
  // 记录被回手卡 owner（回手后该卡已入其主手牌；用操作前 owner 判断「你的牌」）
  const card = ctx.s.players.flatMap((p) => p.stacks).flat().find((c) => c.uid === uid);
  const returnedMine = !!card && card.owner === ctx.player;
  yield { op: 'return', uid };
  if (returnedMine && canRefreshDraw(ctx.s, ctx.player)) {
    // 完整刷新（效果指示刷新语义，同 love-2/spirit-0：含控制组件消耗与重排选择；
    // 修改提示词 19：抽不了牌时刷新无效——不耗控制权/不重排/不连锁）
    yield* controlRearrangeFlow(ctx.s, ctx.player, 'sloth-1 刷新');
    const need = 5 - ctx.s.players[ctx.player].hand.length;
    if (need > 0) yield { op: 'draw', count: need };
    fireRefreshReactives(ctx.s, ctx.player);
  }
}

/** sloth-1 底（after-refresh，无 top 仅顶卡）：当你刷新后：从你的牌库顶端反面打出1张牌到此链路。 */
function* sloth1AfterRefresh(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const line = ctx.card.line;
  if (line === null || !deckTopAvailable(ctx.s, ctx.player)) return;
  yield { op: 'playTopDeck', line, faceUp: false };
}

/** sloth-2 中：翻转1张你被覆盖的牌。（自己任意链路被盖卡选 1 → flip allowCovered） */
function* sloth2Middle(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const covered = ctx.candidates({ zone: 'field', owner: ctx.player, covered: true });
  if (covered.length === 0) return;
  const ans = yield { kind: 'select', title: 'sloth-2：翻转1张你被覆盖的牌', min: 1, max: 1, optional: false, candidates: covered };
  if (ans.selected.length > 0) yield { op: 'flip', uid: ans.selected[0], allowCovered: true };
}

/** sloth-2 底（start，无 top 仅顶卡）：开始：你可以将手牌中的1张牌放回牌库底端（E6 op）。 */
function* sloth2Start(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const hand = ctx.candidates({ zone: 'hand', owner: ctx.player });
  const ans = yield { kind: 'select', title: 'sloth-2（开始）：你可以将手牌中的1张牌放回牌库底端', min: 1, max: 1, optional: true, candidates: hand };
  if (ans.selected.length > 0) yield { op: 'toDeckBottom', uid: ans.selected[0] };
}

/** sloth-3 中：对手弃2张牌。（尽力而为：不足弃全部、空跳过） */
function* sloth3Middle(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const foe = opp(ctx.player);
  const hand = ctx.candidates({ zone: 'hand', owner: foe });
  if (hand.length === 0) return;
  const n = Math.min(2, hand.length);
  const ans = yield { kind: 'select', title: `sloth-3：对手弃${n}张牌`, min: n, max: n, optional: false, candidates: hand, chooser: foe };
  if (ans.selected.length > 0) yield { op: 'discardMany', uids: ans.selected };
}

/** sloth-4 底（before-covered，仅顶卡）：当此牌将被覆盖时：先翻转1张正面朝上的牌。
 *  无目标可翻 → fizzle、覆盖照常（B9；before-covered 挂起链后落地，引擎现状）。 */
function* sloth4BeforeCovered(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const cand = ctx.candidates({ zone: 'field' }).filter((c) => c.faceUp);
  const ans = yield { kind: 'select', title: 'sloth-4：此牌将被覆盖——先翻转1张正面朝上的牌', min: 1, max: 1, optional: false, candidates: cand };
  if (ans.selected.length > 0) yield { op: 'flip', uid: ans.selected[0] };
}

/** sloth-5 中：弃1张牌。 */
function* sloth5Middle(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const hand = ctx.candidates({ zone: 'hand', owner: ctx.player });
  const ans = yield { kind: 'select', title: 'sloth-5：弃1张牌', min: 1, max: 1, optional: false, candidates: hand };
  if (ans.selected.length > 0) yield { op: 'discard', uid: ans.selected[0] };
}

registerCardEffects('sloth-0', {
  middle: sloth0Middle,
  valueModifier: { target: 'own-stack', apply: sloth0Modifier },
});
registerCardEffects('sloth-1', {
  middle: sloth1Middle,
  triggers: { 'after-refresh': { fn: sloth1AfterRefresh, optional: false } },
});
registerCardEffects('sloth-2', {
  middle: sloth2Middle,
  triggers: {
    start: {
      fn: sloth2Start,
      optional: false,
      // 自动判定：手牌空（无牌可放回牌库底）→ 可选 select 无候选，效果整体无动作 → 收集前自动跳过不出按钮
      cond: (s, card) => s.players[card.owner].hand.length > 0,
    },
  },
});
registerCardEffects('sloth-3', { middle: sloth3Middle });
registerCardEffects('sloth-4', { triggers: { 'before-covered': { fn: sloth4BeforeCovered, optional: false } } });
registerCardEffects('sloth-5', { middle: sloth5Middle });

