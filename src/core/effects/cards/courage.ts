import type { EffectCtx, EffectStep, GameState, Line, PlayerId, StepResult } from '../../models/types';
import { registerCardEffects } from '../registry';
import { getLineValue } from '../../state/create';

/**
 * 2代 勇气 courage（关键词：抽取、对比总阈值）。
 * 权威卡文：src/data/cards2.ts；裁决：docs/批3裁决结果.md（courage-6 回合结束检查翻转）。
 * 「对手总阈值更大」= 对手同线 getLineValue > 自己同线（总值含全部修正）。
 */

function opp(p: PlayerId): PlayerId {
  return p === 0 ? 1 : 0;
}

function oppAhead(s: GameState, player: PlayerId, line: Line): boolean {
  return getLineValue(s, opp(player), line) > getLineValue(s, player, line);
}

/** courage-0 顶（start，top:true）：回合开始：若你没有手牌，抽取1张牌 */
function* courage0Start(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  if (ctx.s.players[ctx.player].hand.length === 0) yield { op: 'draw', count: 1 };
}

/** courage-0 中：抽取1张牌 */
function* courage0Middle(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  yield { op: 'draw', count: 1 };
}

/** courage-0 底（end，无 top 仅顶卡）：回合结束：你可以弃置1张牌，若你这么做，对手弃置1张牌 */
function* courage0End(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const hand = ctx.candidates({ zone: 'hand', owner: ctx.player });
  const dAns = yield { kind: 'select', title: 'courage-0：你可以弃置1张牌', min: 1, max: 1, optional: true, candidates: hand };
  if (dAns.selected.length === 0) return;
  yield { op: 'discard', uid: dAns.selected[0] };
  const foe = opp(ctx.player);
  const foeHand = ctx.candidates({ zone: 'hand', owner: foe });
  const fAns = yield { kind: 'select', title: 'courage-0：对手弃置1张牌', min: 1, max: 1, optional: false, candidates: foeHand, chooser: foe };
  if (fAns.selected.length === 0) return;
  yield { op: 'discard', uid: fAns.selected[0] };
}

/** courage-1 中：在1条对手总阈值更大的链路中删除对手的1张牌（txt 修改记录 2026-09-05【7】补「对手的」
 *  ——先选线，再该线删对手 1 张未覆盖顶卡；英文 Delete 1 of your opponent's cards in a line where
 *  they have a higher total value than you do.） */
function* courage1Middle(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const foe = opp(ctx.player);
  const lines = ([0, 1, 2] as Line[]).filter((l) => oppAhead(ctx.s, ctx.player, l));
  if (lines.length === 0) return;
  const lAns = yield { kind: 'select-line', title: 'courage-1：选择1条对手总阈值更大的链路', min: 1, max: 1, optional: false, candidates: [], lines };
  if (lAns.selected.length === 0) return;
  const line = Number(lAns.selected[0].replace('line:', '')) as Line;
  const cand = ctx.candidates({ zone: 'field', owner: foe }).filter((c) => c.line === line);
  const tAns = yield { kind: 'select', title: 'courage-1：删除对手的1张牌', min: 1, max: 1, optional: false, candidates: cand };
  if (tAns.selected.length === 0) return;
  yield { op: 'delete', uid: tAns.selected[0] };
}

/** courage-2 中：抽取1张牌 */
function* courage2Middle(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  yield { op: 'draw', count: 1 };
}

/** courage-2 底（end，无 top）：回合结束：此链路中，若对手总阈值更大，抽取1张牌 */
function* courage2End(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const line = ctx.card.line;
  if (line !== null && oppAhead(ctx.s, ctx.player, line)) yield { op: 'draw', count: 1 };
}

/** courage-3 底（end，无 top 仅顶卡，可选）：回合结束：你可以将此牌偏转进入对手总阈值最大的链路中
 *  （FAQ 勇气3：多条总值最高由玩家自选；shift 自己到该线自己链路） */
function* courage3End(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const foe = opp(ctx.player);
  const totals = ([0, 1, 2] as Line[]).map((l) => getLineValue(ctx.s, foe, l));
  const max = Math.max(...totals);
  const lines = ([0, 1, 2] as Line[]).filter((_, i) => totals[i] === max);
  const lAns = yield { kind: 'select-line', title: 'courage-3：你可以偏转此牌进入对手总阈值最大的链路', min: 1, max: 1, optional: true, candidates: [], lines };
  if (lAns.selected.length === 0) return;
  const line = Number(lAns.selected[0].replace('line:', '')) as Line;
  yield { op: 'shift', uid: ctx.card.uid, targetLine: line };
}

/** courage-5 中：你弃置1张牌 */
function* courage5Middle(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const hand = ctx.candidates({ zone: 'hand', owner: ctx.player });
  const ans = yield { kind: 'select', title: 'courage-5：你弃置1张牌', min: 1, max: 1, optional: false, candidates: hand };
  if (ans.selected.length === 0) return;
  yield { op: 'discard', uid: ans.selected[0] };
}

/** courage-6 底（end，无 top 仅顶卡）：回合结束：若此链路中对手总阈值更大，翻转此牌（修改提示词 39：移至底部槽；裁决 Q1：回合结束检查） */
function* courage6End(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const line = ctx.card.line;
  if (line !== null && oppAhead(ctx.s, ctx.player, line)) {
    yield { op: 'flip', uid: ctx.card.uid, allowCovered: true };
  }
}

registerCardEffects('courage-0', {
  triggers: {
    start: { fn: courage0Start, optional: false, top: true },
    end: { fn: courage0End, optional: true },
  },
  middle: courage0Middle,
});
registerCardEffects('courage-1', { middle: courage1Middle });
registerCardEffects('courage-2', {
  middle: courage2Middle,
  triggers: { end: { fn: courage2End, optional: false } },
});
registerCardEffects('courage-3', { triggers: { end: { fn: courage3End, optional: true } } });
registerCardEffects('courage-5', { middle: courage5Middle });
registerCardEffects('courage-6', { triggers: { end: { fn: courage6End, optional: false } } }); // 2026-09 卡文移至底部槽（回合结束，仅未覆盖顶卡）


