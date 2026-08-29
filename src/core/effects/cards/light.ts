import type { EffectCtx, EffectGen, EffectStep, Line, StepResult } from '../../models/types';
import { registerCardEffects } from '../registry';

function* light0(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const targets = ctx.candidates({ zone: 'field' });
  const ans = yield { kind: 'select', title: 'light-0：翻转1张牌', min: 1, max: 1, optional: false, candidates: targets };
  if (ans.selected.length === 0) return;
  const picked = targets.find((c) => c.uid === ans.selected[0]);
  yield { op: 'flip', uid: ans.selected[0] };
  if (picked) yield { op: 'draw', count: Number(picked.label) };
}

function* light1End(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  yield { op: 'draw', count: 1 };
}

function* light2(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  yield { op: 'draw', count: 2 };
  // 揭示 1 张反面牌（可选目标：场上任意反面顶卡；fizzle 时无候选自动跳过）
  const facedown = ctx.candidates({ zone: 'field' }).filter((c) => !c.faceUp);
  const r = yield { kind: 'select', title: 'light-2：揭示1张反面牌', min: 1, max: 1, optional: false, candidates: facedown };
  if (r.selected.length === 0) return;
  const revealed = facedown.find((c) => c.uid === r.selected[0]);
  yield { op: 'reveal', uid: r.selected[0] };
  // 被揭示卡持有者决定：翻转 / 平移 / 跳过
  const chooser = revealed?.owner ?? ctx.player;
  const act = yield { kind: 'select-action', title: 'light-2：你可以平移或翻转那张牌', min: 1, max: 1, optional: true, candidates: [], actions: ['action:flip', 'action:shift'], chooser };
  if (act.selected.length === 0) return;
  if (act.selected[0] === 'action:flip') yield { op: 'flip', uid: r.selected[0] };
  // action:shift → 平移需选目标线（light-2 平移该牌到任意其他线）
  if (act.selected[0] === 'action:shift') {
    const line = yield { kind: 'select-line', title: 'light-2：平移目标线', min: 1, max: 1, optional: false, candidates: [], lines: [0, 1, 2].filter((l) => l !== ctx.card.line) as Line[], chooser };
    if (line.selected.length > 0) {
      yield { op: 'shift', uid: r.selected[0], targetLine: Number(line.selected[0].replace('line:', '')) as Line };
    }
  }
}

function* light3(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const srcLine = ctx.card.line!;
  const line = yield { kind: 'select-line', title: 'light-3：平移目标线', min: 1, max: 1, optional: false, candidates: [], lines: [0, 1, 2].filter((l) => l !== srcLine) as Line[] };
  if (line.selected.length === 0) return;
  const target = Number(line.selected[0].replace('line:', '')) as Line;
  // 反复平移本线最顶的反面牌（含被覆盖的反面牌——先移开其上的牌? 否：allowCovered 直接移）
  // 简化：循环取本线堆叠中"最靠上的反面牌"平移（allowCovered），直到无反面包
  const s = ctx.s;
  const stack = s.players[ctx.player].stacks[srcLine];
  for (;;) {
    const idx = [...stack].reverse().findIndex((c) => !c.faceUp);
    if (idx === -1) break;
    const card = stack[stack.length - 1 - idx];
    yield { op: 'shift', uid: card.uid, targetLine: target, allowCovered: true };
  }
}

function* light4(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const opp = ctx.s.players[ctx.player === 0 ? 1 : 0];
  for (const card of [...opp.hand]) yield { op: 'reveal', uid: card.uid };
}

function* light5(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const hand = ctx.candidates({ zone: 'hand', owner: ctx.player });
  const ans = yield { kind: 'select', title: 'light-5：弃1张牌', min: 1, max: 1, optional: false, candidates: hand };
  if (ans.selected.length === 0) return;
  yield { op: 'discard', uid: ans.selected[0] };
}

registerCardEffects('light-0', { middle: light0 });
registerCardEffects('light-1', { triggers: { end: { fn: light1End, optional: false } } });
registerCardEffects('light-2', { middle: light2 });
registerCardEffects('light-3', { middle: light3 });
registerCardEffects('light-4', { middle: light4 });
registerCardEffects('light-5', { middle: light5 });
