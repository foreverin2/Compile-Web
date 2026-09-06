import type { EffectCtx, EffectStep, GameState, Line, PlayerId, StepResult } from '../../models/types';
import { registerCardEffects } from '../registry';

/**
 * 2代 明镜 mirror（关键词：平移、复制）。
 * 权威卡文：src/data/cards2.ts；规格/裁决：docs/批1规格-幸运明镜和平混沌明晰.md §2 + docs/批1裁决结果.md
 * （[Q7]-[Q11]）。引擎能力 G3 swapStacks / G4 copyMiddle / G5 after-opponent-draw（2026-09-05 已实现）。
 */

function opp(p: PlayerId): PlayerId {
  return p === 0 ? 1 : 0;
}

/** mirror-0 顶：此链路中，对手每有1张牌，你的总阈值就加1（own-stack，+对手该线链路张数） */
function mirror0ValueModifier(s: GameState, owner: PlayerId, line: Line, total: number): number {
  return total + s.players[opp(owner)].stacks[line].length;
}

/** mirror-1 底（end 可选）：选择对手的1张牌，复制其中央效果（裁决 [Q7] 未覆盖正面 / [Q8] 复制者执行） */
function* mirror1End(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const cand = ctx
    .candidates({ zone: 'field', owner: opp(ctx.player) })
    .filter((c) => c.faceUp); // 未覆盖（candidates 顶卡）+ 正面
  const ans = yield { kind: 'select', title: 'mirror-1：复制对手1张牌的中央效果', min: 1, max: 1, optional: true, candidates: cand };
  if (ans.selected.length === 0) return; // 可选：跳过
  yield { op: 'copyMiddle', uid: ans.selected[0] };
}

/** mirror-2 中：交换你2个链路的位置（裁决 [Q9] txt 整堆换线） */
function* mirror2Middle(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const aAns = yield { kind: 'select-line', title: 'mirror-2：选择第1个要交换的链路', min: 1, max: 1, optional: false, candidates: [], lines: [0, 1, 2] };
  if (aAns.selected.length === 0) return;
  const a = Number(aAns.selected[0].replace('line:', ''));
  const bAns = yield { kind: 'select-line', title: 'mirror-2：选择第2个要交换的链路', min: 1, max: 1, optional: false, candidates: [], lines: ([0, 1, 2] as Line[]).filter((x) => x !== a) };
  if (bAns.selected.length === 0) return;
  const b = Number(bAns.selected[0].replace('line:', ''));
  yield { op: 'swapStacks', a: a as Line, b: b as Line };
}

/** mirror-3 中：翻转你的1张牌；在同一链路（第一句那张的线）翻转对手的1张牌（裁决 [Q10]） */
function* mirror3Middle(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const mine = ctx.candidates({ zone: 'field', owner: ctx.player });
  const aAns = yield { kind: 'select', title: 'mirror-3：翻转你的1张牌', min: 1, max: 1, optional: false, candidates: mine };
  if (aAns.selected.length === 0) return; // fizzle
  const aUid = aAns.selected[0];
  const cardA = ctx.s.players[ctx.player].stacks.flat().find((c) => c.uid === aUid);
  const lineA: Line = cardA?.line ?? 0;
  yield { op: 'flip', uid: aUid };
  const opps = ctx
    .candidates({ zone: 'field', owner: opp(ctx.player) })
    .filter((c) => c.line === lineA);
  const bAns = yield { kind: 'select', title: 'mirror-3：在同一链路翻转对手的1张牌', min: 1, max: 1, optional: false, candidates: opps };
  if (bAns.selected.length === 0) return; // 对手该线无卡 → 第二句 fizzle（第一句已执行，FAQ 每句独立）
  yield { op: 'flip', uid: bAns.selected[0] };
}

/** mirror-4 底：当对手抽牌时：你抽1张牌（after-opponent-draw，无 top → 仅未覆盖顶卡触发，裁决 [Q11]） */
function* mirror4AfterOppDraw(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  yield { op: 'draw', count: 1 };
}

/** mirror-5 中：你弃置1张牌 */
function* mirror5Middle(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const hand = ctx.candidates({ zone: 'hand', owner: ctx.player });
  const ans = yield { kind: 'select', title: 'mirror-5：你弃置1张牌', min: 1, max: 1, optional: false, candidates: hand };
  if (ans.selected.length === 0) return;
  yield { op: 'discard', uid: ans.selected[0] };
}

registerCardEffects('mirror-0', { valueModifier: { target: 'own-stack', apply: mirror0ValueModifier } });
registerCardEffects('mirror-1', { triggers: { end: { fn: mirror1End, optional: true } } });
registerCardEffects('mirror-2', { middle: mirror2Middle });
registerCardEffects('mirror-3', { middle: mirror3Middle });
registerCardEffects('mirror-4', { triggers: { 'after-opponent-draw': { fn: mirror4AfterOppDraw, optional: false } } });
registerCardEffects('mirror-5', { middle: mirror5Middle });


