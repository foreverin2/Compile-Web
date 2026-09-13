import type { EffectCtx, EffectStep, Line, PlayerId, StepResult } from '../../models/types';
import { registerCardEffects } from '../registry';
import { traceAt, cardBrief } from '../../trace';
import { randPick } from '../../rng';

/**
 * 2代 恐惧 fear（关键词：偏转、强行弃置）。
 * 权威卡文：src/data/cards2.ts；裁决：docs/批2裁决结果.md（fear-0 顶禁中央效果=引擎 pushMiddle 守卫；
 * fear-1 抽弃前手牌数-1；fear-4 对手随机弃 1 张手牌——2026-09-05 txt 修改记录【3】修订后直接弃
 * 对手手牌随机 1 张（落对手弃牌堆），不再 takeRandom）。
 */

function opp(p: PlayerId): PlayerId {
  return p === 0 ? 1 : 0;
}

/** fear-0 顶「在你的回合内，对手无法触发中央效果」：引擎 pushMiddle 守卫（resolve.ts），无注册。
 *  fear-0 中：偏转或翻转1张卡牌（二选一，未覆盖场卡） */
function* fear0Middle(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const actAns = yield {
    kind: 'select-action', title: 'fear-0：偏转或翻转1张卡牌', min: 1, max: 1, optional: false, candidates: [],
    actions: ['action:shift', 'action:flip'],
  };
  if (actAns.selected.length === 0) return;
  const cand = ctx.candidates({ zone: 'field' });
  const tAns = yield { kind: 'select', title: 'fear-0：选择目标卡牌', min: 1, max: 1, optional: false, candidates: cand };
  if (tAns.selected.length === 0) return;
  const uid = tAns.selected[0];
  if (actAns.selected[0] === 'action:flip') {
    yield { op: 'flip', uid };
    return;
  }
  // shift：选目标线（≠原线）
  const card = ctx.s.players.flatMap((p) => p.stacks).flat().find((c) => c.uid === uid);
  const fromLine = card?.line ?? 0;
  const lAns = yield {
    kind: 'select-line', title: 'fear-0：偏转到哪条链路', min: 1, max: 1, optional: false, candidates: [],
    lines: ([0, 1, 2] as Line[]).filter((l) => l !== fromLine),
  };
  if (lAns.selected.length === 0) return;
  const to = Number(lAns.selected[0].replace('line:', '')) as Line;
  yield { op: 'shift', uid, targetLine: to };
}

/** fear-1 中：抽2张牌。对手弃置所有手牌，然后抽取手牌数-1的卡牌（裁决 Q3：弃前手牌数-1） */
function* fear1Middle(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const foe = opp(ctx.player);
  yield { op: 'draw', count: 2 };
  const foeHand = [...ctx.s.players[foe].hand];
  const before = foeHand.length; // 弃前手牌数（裁决 Q3）
  if (before > 0) yield { op: 'discardMany', uids: foeHand.map((c) => c.uid) };
  const drawN = before - 1; // 弃前 - 1（弃后为 0 时语义仍以弃前计；≤0 不抽）
  if (drawN > 0) yield { op: 'draw', count: drawN, player: foe };
}

/** fear-2 中：召回对手的1张牌（对手未覆盖场卡 → 回对手手牌，return op 按持有者回手） */
function* fear2Middle(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const cand = ctx.candidates({ zone: 'field', owner: opp(ctx.player) });
  const tAns = yield { kind: 'select', title: 'fear-2：召回对手的1张牌', min: 1, max: 1, optional: false, candidates: cand };
  if (tAns.selected.length === 0) return;
  yield { op: 'return', uid: tAns.selected[0] };
}

/** fear-3 中：偏转1张对手在此链路中的被覆盖或未被覆盖的卡牌（对手同线任意位置，含被盖） */
function* fear3Middle(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const foe = opp(ctx.player);
  const line = ctx.card.line;
  if (line === null) return;
  // 对手该线链路任意位置的卡（顶卡 + 被盖）
  const stack = ctx.s.players[foe].stacks[line];
  const cand = stack
    .filter((c) => c.zone === 'field')
    .map((c) => ({
      uid: c.uid, defId: c.defId, faceUp: c.faceUp, owner: foe, zone: c.zone, line: c.line, pos: c.pos,
      label: '',
    }))
    .filter((c) => !ctx.s.pendingEffects.some((pe) => pe.sourceUid === c.uid)); // 排除结算中源卡（惯例）
  if (cand.length === 0) return;
  const tAns = yield { kind: 'select', title: 'fear-3：偏转1张对手在此链路的卡牌', min: 1, max: 1, optional: false, candidates: cand };
  if (tAns.selected.length === 0) return;
  const uid = tAns.selected[0];
  const lAns = yield {
    kind: 'select-line', title: 'fear-3：偏转到哪条链路', min: 1, max: 1, optional: false, candidates: [],
    lines: ([0, 1, 2] as Line[]).filter((l) => l !== line),
  };
  if (lAns.selected.length === 0) return;
  const to = Number(lAns.selected[0].replace('line:', '')) as Line;
  // 被盖卡 shift 需 allowCovered（顶卡也可——allowCovered 兼容）
  yield { op: 'shift', uid, targetLine: to, allowCovered: true };
}

/** fear-4 中：对手随机弃置1张牌（txt 修改记录 2026-09-05【3】：原「抽取对手的1张卡牌，然后将其弃置」
 *  = 操作方式错误；英文 Your opponent discards 1 random card. = 对手自弃 1 张随机手牌 → 落对手弃牌堆
 *  （discard 按卡 owner 落弃牌堆），随机由引擎代选（同 time-3 随机揭示口径）；取代裁决 Q4 的
 *  takeRandom 取走再弃实现） */
function* fear4Middle(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const foe = opp(ctx.player);
  const hand = ctx.s.players[foe].hand;
  if (hand.length === 0) return; // 对手无手牌 → fizzle
  const pick = randPick(ctx.s, hand)!;
  traceAt(ctx.s, '随机', `fear-4 随机选中对手手牌：${cardBrief(pick)}（对手手牌 ${hand.length} 张）`);
  yield { op: 'discard', uid: pick.uid };
}

/** fear-5 中：你弃置1张牌 */
function* fear5Middle(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const hand = ctx.candidates({ zone: 'hand', owner: ctx.player });
  const ans = yield { kind: 'select', title: 'fear-5：你弃置1张牌', min: 1, max: 1, optional: false, candidates: hand };
  if (ans.selected.length === 0) return;
  yield { op: 'discard', uid: ans.selected[0] };
}

registerCardEffects('fear-0', { middle: fear0Middle }); // 顶禁用由引擎守卫处理
registerCardEffects('fear-1', { middle: fear1Middle });
registerCardEffects('fear-2', { middle: fear2Middle });
registerCardEffects('fear-3', { middle: fear3Middle });
registerCardEffects('fear-4', { middle: fear4Middle });
registerCardEffects('fear-5', { middle: fear5Middle });

