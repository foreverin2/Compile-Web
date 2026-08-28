import type { EffectCtx, EffectGen, EffectStep, StepResult } from '../../models/types';
import { registerCardEffects } from '../registry';

function* fire0Middle(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const targets = ctx.candidates({ zone: 'field' });
  const ans = yield { kind: 'select', title: 'fire-0：翻转另1张牌', min: 1, max: 1, optional: false, candidates: targets };
  const [t] = ans.selected;
  yield { op: 'flip', uid: t };
  yield { op: 'draw', count: 2 };
}

function* fire0BeforeCovered(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  yield { op: 'draw', count: 1 };
  const targets = ctx.candidates({ zone: 'field' });
  const ans = yield { kind: 'select', title: 'fire-0（被盖住前）：翻转另1张牌', min: 1, max: 1, optional: false, candidates: targets };
  const [t] = ans.selected;
  yield { op: 'flip', uid: t };
}

function* fire1(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const hand = ctx.candidates({ zone: 'hand', owner: ctx.player });
  const ans = yield { kind: 'select', title: 'fire-1：弃1张牌', min: 1, max: 1, optional: false, candidates: hand };
  const [d] = ans.selected;
  yield { op: 'discard', uid: d };
  const targets = ctx.candidates({ zone: 'field' });
  const ans2 = yield { kind: 'select', title: 'fire-1：删除1张牌', min: 1, max: 1, optional: false, candidates: targets };
  const [t] = ans2.selected;
  yield { op: 'delete', uid: t };
}

function* fire2(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const hand = ctx.candidates({ zone: 'hand', owner: ctx.player });
  const ans = yield { kind: 'select', title: 'fire-2：弃1张牌', min: 1, max: 1, optional: false, candidates: hand };
  const [d] = ans.selected;
  yield { op: 'discard', uid: d };
  const targets = ctx.candidates({ zone: 'field' });
  const ans2 = yield { kind: 'select', title: 'fire-2：回手1张牌', min: 1, max: 1, optional: false, candidates: targets };
  const [t] = ans2.selected;
  yield { op: 'return', uid: t };
}

function* fire3End(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const hand = ctx.candidates({ zone: 'hand', owner: ctx.player });
  const ans = yield { kind: 'select', title: 'fire-3：你可以弃1张牌', min: 1, max: 1, optional: true, candidates: hand };
  if (ans.selected.length === 0) return; // 跳过
  yield { op: 'discard', uid: ans.selected[0] };
  const targets = ctx.candidates({ zone: 'field' });
  const ans2 = yield { kind: 'select', title: 'fire-3：翻转1张牌', min: 1, max: 1, optional: false, candidates: targets };
  const [t] = ans2.selected;
  yield { op: 'flip', uid: t };
}

function* fire4(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const hand = ctx.candidates({ zone: 'hand', owner: ctx.player });
  const ans = yield { kind: 'select', title: 'fire-4：弃1张或更多张牌', min: 1, max: hand.length, optional: false, candidates: hand };
  for (const uid of ans.selected) yield { op: 'discard', uid };
  yield { op: 'draw', count: ans.selected.length + 1 };
}

function* fire5(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const hand = ctx.candidates({ zone: 'hand', owner: ctx.player });
  const ans = yield { kind: 'select', title: 'fire-5：弃1张牌', min: 1, max: 1, optional: false, candidates: hand };
  const [d] = ans.selected;
  yield { op: 'discard', uid: d };
}

registerCardEffects('fire-0', {
  middle: fire0Middle,
  triggers: { 'before-covered': { fn: fire0BeforeCovered, optional: false } },
});
registerCardEffects('fire-1', { middle: fire1 });
registerCardEffects('fire-2', { middle: fire2 });
registerCardEffects('fire-3', { triggers: { end: { fn: fire3End, optional: true } } });
registerCardEffects('fire-4', { middle: fire4 });
registerCardEffects('fire-5', { middle: fire5 });
