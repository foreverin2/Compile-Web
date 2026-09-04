import type { EffectCtx, EffectStep, PlayerId, StepResult } from '../../models/types';
import { registerCardEffects } from '../registry';
import { findCard } from '../context';
import { cardPointValue } from '../../state/create';

/**
 * 2代 和平 peace（关键词：相互弃置、抽取）。
 * 权威卡文：src/data/cards2.ts；规格/裁决：docs/批1规格-幸运明镜和平混沌明晰.md §3 + docs/批1裁决结果.md
 * （[Q11]-[Q12]）。引擎能力 G5 after-self-discard（2026-09-05 已实现）。
 */

function opp(p: PlayerId): PlayerId {
  return p === 0 ? 1 : 0;
}

/** peace-1 中：所有玩家弃置所有手牌（裁决 [Q12]：效果属主先弃、对手后弃，两次单次动作） */
function* peace1Middle(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const mine = ctx.s.players[ctx.player].hand.map((c) => c.uid);
  if (mine.length > 0) yield { op: 'discardMany', uids: mine };
  const opps = ctx.s.players[opp(ctx.player)].hand.map((c) => c.uid);
  if (opps.length > 0) yield { op: 'discardMany', uids: opps };
}

/** peace-1 底（end）：回合结束：若你没有手牌，抽取1张牌 */
function* peace1End(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  if (ctx.s.players[ctx.player].hand.length === 0) yield { op: 'draw', count: 1 };
}

/** peace-2 中：抽取1张牌。反面打出1张牌（从手牌选，含刚抽的） */
function* peace2Middle(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  yield { op: 'draw', count: 1 };
  const hand = ctx.candidates({ zone: 'hand', owner: ctx.player });
  const hAns = yield { kind: 'select', title: 'peace-2：反面打出1张牌', min: 1, max: 1, optional: false, candidates: hand };
  if (hAns.selected.length === 0) return; // 无手牌 → fizzle
  const lineAns = yield { kind: 'select-line', title: 'peace-2：反面打出到任意线', min: 1, max: 1, optional: false, candidates: [], lines: [0, 1, 2] };
  if (lineAns.selected.length === 0) return;
  const line = Number(lineAns.selected[0].replace('line:', ''));
  yield { op: 'playFromHand', uid: hAns.selected[0], line: line as 0 | 1 | 2, faceUp: false };
}

/** peace-3 中：你可以弃置1张牌。翻转1张阈值(现时值)大于你手牌数的卡牌（裁决 [Q6]） */
function* peace3Middle(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const hand = ctx.candidates({ zone: 'hand', owner: ctx.player });
  const dAns = yield { kind: 'select', title: 'peace-3：你可以弃置1张牌', min: 1, max: 1, optional: true, candidates: hand };
  if (dAns.selected.length > 0) yield { op: 'discard', uid: dAns.selected[0] };
  const n = ctx.s.players[ctx.player].hand.length; // 弃后手牌数
  const cand = ctx.candidates({ zone: 'field' }).filter((c) => {
    const card = findCard(ctx.s, c.uid);
    return card !== undefined && cardPointValue(ctx.s, card) > n;
  });
  const tAns = yield { kind: 'select', title: `peace-3：翻转1张阈值大于你手牌数(${n})的卡牌`, min: 1, max: 1, optional: false, candidates: cand };
  if (tAns.selected.length === 0) return;
  yield { op: 'flip', uid: tAns.selected[0] };
}

/** peace-4 底：在对手回合中你弃置卡牌时：抽1张牌（after-self-discard；回合门控） */
function* peace4AfterSelfDiscard(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  // 「在对手回合中」：当前回合玩家必须是本卡拥有者的对手
  if (ctx.s.turnPlayer !== opp(ctx.player)) return;
  yield { op: 'draw', count: 1 };
}

/** peace-5 中：你弃置1张牌 */
function* peace5Middle(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const hand = ctx.candidates({ zone: 'hand', owner: ctx.player });
  const ans = yield { kind: 'select', title: 'peace-5：你弃置1张牌', min: 1, max: 1, optional: false, candidates: hand };
  if (ans.selected.length === 0) return;
  yield { op: 'discard', uid: ans.selected[0] };
}

/** peace-6 中：若你手牌数超过1，翻转此牌（结算时点判定；自己必为未覆盖顶卡） */
function* peace6Middle(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  if (ctx.s.players[ctx.player].hand.length > 1) yield { op: 'flip', uid: ctx.card.uid };
}

registerCardEffects('peace-1', {
  middle: peace1Middle,
  triggers: { end: { fn: peace1End, optional: false } },
});
registerCardEffects('peace-2', { middle: peace2Middle });
registerCardEffects('peace-3', { middle: peace3Middle });
registerCardEffects('peace-4', { triggers: { 'after-self-discard': { fn: peace4AfterSelfDiscard, optional: false } } });
registerCardEffects('peace-5', { middle: peace5Middle });
registerCardEffects('peace-6', { middle: peace6Middle });

