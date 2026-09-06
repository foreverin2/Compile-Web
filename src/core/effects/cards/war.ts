import type { EffectCtx, EffectStep, Line, PlayerId, StepResult } from '../../models/types';
import { registerCardEffects } from '../registry';
import { fireRefreshReactives } from '../triggers';
import { controlRearrangeFlow } from '../control-rearrange-flow';

/**
 * 2代 战争 war（关键词：反击、强行弃置）。
 * 权威卡文：src/data/cards2.ts；裁决/默认：docs/批2裁决结果.md
 * （after-refresh/after-opponent-refresh/after-compile 触发点引擎已建，00e0f4b）。
 */

function opp(p: PlayerId): PlayerId {
  return p === 0 ? 1 : 0;
}

/** war-0 顶（after-refresh，top:true）：当你刷新时：你可以翻转此牌 */
function* war0AfterRefresh(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const card = ctx.s.players[ctx.player].stacks.flat().find((c) => c.uid === ctx.card.uid);
  if (!card || !card.faceUp) return;
  const actAns = yield {
    kind: 'select-action', title: 'war-0：你可以翻转此牌', min: 1, max: 1, optional: true, candidates: [],
    actions: ['action:flip'],
  };
  if (actAns.selected.length === 0) return;
  yield { op: 'flip', uid: card.uid, allowCovered: true };
}

/** war-0 底（after-opponent-draw，无 top 仅顶卡）：当对手抽牌时：你可以删除1张卡牌（可选） */
function* war0AfterOppDraw(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const cand = ctx.candidates({ zone: 'field' });
  const tAns = yield { kind: 'select', title: 'war-0：对手抽牌，你可以删除1张卡牌', min: 1, max: 1, optional: true, candidates: cand };
  if (tAns.selected.length === 0) return;
  yield { op: 'delete', uid: tAns.selected[0] };
}

/** war-1 底（after-opponent-refresh，无 top 仅顶卡）：当对手刷新时：弃置任意数目的卡牌，然后刷新。
 *  主体 = war-1 拥有者「你」（卡文省略主语 = 你；凡作用于对手的句子卡文都会明写「对手」，
 *  如 war-2「对手弃置所有手牌」/war-4「对手弃置1张牌」）。
 *  触发：你的对手刷新（actor = 对手）→ 你弃任意张，然后【你刷新自己的手牌】（补至 5）。
 *  2026-09 用户拍板：war-1 强制出来的刷新属于刷新自己的手牌，而非刷新对方的——
 *  因此执行者 = 拥有者自己（控制组件归还/重排检查拥有者；且自己刷新只触发自身侧
 *  after-refresh（war-0 等），不会再次触发本卡的 after-opponent-refresh，无递归）。 */
function* war1AfterOppRefresh(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const me = ctx.player;
  const hand = ctx.candidates({ zone: 'hand', owner: me });
  const dAns = yield {
    kind: 'select', title: 'war-1：对手刷新——你弃置任意数目的卡牌', min: 0, max: hand.length, optional: false,
    candidates: hand,
  };
  if (dAns.selected.length > 0) yield { op: 'discardMany', uids: dAns.selected };
  yield* controlRearrangeFlow(ctx.s, me, 'war-1 刷新');
  const need = 5 - ctx.s.players[me].hand.length;
  if (need > 0) yield { op: 'draw', count: need };
  fireRefreshReactives(ctx.s, me); // 你的刷新动作连锁（war-0「当你刷新时」同款响应）
}

/** war-2 中：翻转1张牌 */
function* war2Middle(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const cand = ctx.candidates({ zone: 'field' });
  const tAns = yield { kind: 'select', title: 'war-2：翻转1张牌', min: 1, max: 1, optional: false, candidates: cand };
  if (tAns.selected.length === 0) return;
  yield { op: 'flip', uid: tAns.selected[0] };
}

/** war-2 底（after-compile，无 top 仅顶卡）：当对手编译后：对手弃置所有手牌（编译者=war-2 拥有者的对手） */
function* war2AfterCompile(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const foe = opp(ctx.player); // 编译者
  const foeHand = ctx.s.players[foe].hand.map((c) => c.uid);
  if (foeHand.length === 0) return;
  yield { op: 'discardMany', uids: foeHand };
}

/** war-3 中：抽取1张牌 */
function* war3Middle(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  yield { op: 'draw', count: 1 };
}

/** war-3 底（after-discard，无 top 仅顶卡）：当对手弃牌后：你可以反面打出1张卡牌（手牌选卡，任意线） */
function* war3AfterDiscard(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const hand = ctx.candidates({ zone: 'hand', owner: ctx.player });
  const hAns = yield { kind: 'select', title: 'war-3：对手弃牌，你可以反面打出1张卡牌', min: 1, max: 1, optional: true, candidates: hand };
  if (hAns.selected.length === 0) return;
  const lAns = yield { kind: 'select-line', title: 'war-3：反面打出到任意线', min: 1, max: 1, optional: false, candidates: [], lines: [0, 1, 2] };
  if (lAns.selected.length === 0) return;
  const line = Number(lAns.selected[0].replace('line:', '')) as Line;
  yield { op: 'playFromHand', uid: hAns.selected[0], line, faceUp: false };
}

/** war-4 中：对手弃置1张牌（对手自选弃） */
function* war4Middle(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const foe = opp(ctx.player);
  const hand = ctx.candidates({ zone: 'hand', owner: foe });
  if (hand.length === 0) return;
  const ans = yield { kind: 'select', title: 'war-4：对手弃置1张牌', min: 1, max: 1, optional: false, candidates: hand, chooser: foe };
  if (ans.selected.length === 0) return;
  yield { op: 'discard', uid: ans.selected[0] };
}

/** war-5 中：你弃置1张牌 */
function* war5Middle(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const hand = ctx.candidates({ zone: 'hand', owner: ctx.player });
  const ans = yield { kind: 'select', title: 'war-5：你弃置1张牌', min: 1, max: 1, optional: false, candidates: hand };
  if (ans.selected.length === 0) return;
  yield { op: 'discard', uid: ans.selected[0] };
}

registerCardEffects('war-0', {
  triggers: {
    'after-refresh': { fn: war0AfterRefresh, optional: true, top: true },
    'after-opponent-draw': { fn: war0AfterOppDraw, optional: true },
  },
});
registerCardEffects('war-1', { triggers: { 'after-opponent-refresh': { fn: war1AfterOppRefresh, optional: false } } });
registerCardEffects('war-2', {
  middle: war2Middle,
  triggers: { 'after-compile': { fn: war2AfterCompile, optional: false } },
});
registerCardEffects('war-3', {
  middle: war3Middle,
  triggers: { 'after-discard': { fn: war3AfterDiscard, optional: true } },
});
registerCardEffects('war-4', { middle: war4Middle });
registerCardEffects('war-5', { middle: war5Middle });
