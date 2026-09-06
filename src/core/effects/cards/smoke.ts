import type { EffectCtx, EffectStep, GameState, Line, PlayerId, StepResult } from '../../models/types';
import { registerCardEffects } from '../registry';
import { deckTopAvailable, findCard } from '../context';

/**
 * 2代 烟雾 smoke（关键词：反面打出、偏转）。
 * 权威卡文：src/data/cards2.ts；裁决：docs/批2裁决结果.md（smoke-3 从手牌反打、smoke-4 双方）。
 * smoke-1「你可以偏转此牌」的「此牌」= 刚翻转的那张卡（compile-apo smoke json 两段串联核对）。
 */

/** 该线【双方链路】是否有任意正面朝下（反面）的卡（含被盖与反面顶卡） */
function lineHasFaceDown(s: GameState, line: Line): boolean {
  for (const owner of [0, 1] as PlayerId[]) {
    if (s.players[owner].stacks[line].some((c) => !c.faceUp)) return true;
  }
  return false;
}

/** smoke-0 中：从你的牌库顶端向每条有正面朝下的卡牌的链路反面打出1张牌（逐线；牌库空则后续线不打） */
function* smoke0Middle(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const lines = ([0, 1, 2] as Line[]).filter((l) => lineHasFaceDown(ctx.s, l));
  for (const line of lines) {
    if (!deckTopAvailable(ctx.s, ctx.player)) break; // FAQ 142/107：牌库空不再打
    yield { op: 'playTopDeck', line, faceUp: false };
  }
}

/** smoke-1 中：翻转你的1张卡牌。你可以偏转此牌（=刚翻的那张，compile-apo 核对） */
function* smoke1Middle(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const mine = ctx.candidates({ zone: 'field', owner: ctx.player });
  const fAns = yield { kind: 'select', title: 'smoke-1：翻转你的1张卡牌', min: 1, max: 1, optional: false, candidates: mine };
  if (fAns.selected.length === 0) return;
  const uid = fAns.selected[0];
  yield { op: 'flip', uid };
  const card = findCard(ctx.s, uid);
  if (!card || card.line === null) return;
  const lAns = yield {
    kind: 'select-line', title: 'smoke-1：你可以偏转这张牌', min: 1, max: 1, optional: true, candidates: [],
    lines: ([0, 1, 2] as Line[]).filter((l) => l !== card.line),
  };
  if (lAns.selected.length === 0) return;
  const to = Number(lAns.selected[0].replace('line:', '')) as Line;
  yield { op: 'shift', uid, targetLine: to };
}

/** smoke-2 顶：此链路中，每有1张正面朝下的卡牌，总阈值就加1（own-stack，+该线双方链路反面数，
 *  同 apathy-0 countFaceDownInLine 口径） */
function smoke2ValueModifier(s: GameState, _owner: PlayerId, line: Line, total: number): number {
  let faceDown = 0;
  for (const owner of [0, 1] as PlayerId[]) {
    for (const card of s.players[owner].stacks[line]) {
      if (!card.faceUp) faceDown++;
    }
  }
  return total + faceDown;
}

/** smoke-3 中：在1条有正面朝下的卡牌的链路中反面打出1张卡牌（裁决 Q1：从手牌选 1 张） */
function* smoke3Middle(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const lines = ([0, 1, 2] as Line[]).filter((l) => lineHasFaceDown(ctx.s, l));
  if (lines.length === 0) return;
  const lAns = yield { kind: 'select-line', title: 'smoke-3：选择1条有正面朝下卡牌的链路', min: 1, max: 1, optional: false, candidates: [], lines };
  if (lAns.selected.length === 0) return;
  const hand = ctx.candidates({ zone: 'hand', owner: ctx.player });
  if (hand.length === 0) return;
  const hAns = yield { kind: 'select', title: 'smoke-3：反面打出1张卡牌', min: 1, max: 1, optional: false, candidates: hand };
  if (hAns.selected.length === 0) return;
  const line = Number(lAns.selected[0].replace('line:', '')) as Line;
  yield { op: 'playFromHand', uid: hAns.selected[0], line, faceUp: false };
}

/** smoke-4 中：偏转1张被覆盖的、正面朝下的卡牌（裁决 Q2：双方皆可） */
function* smoke4Middle(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const cand = ctx
    .candidates({ zone: 'field', covered: true })
    .filter((c) => !c.faceUp); // 被盖且反面
  if (cand.length === 0) return;
  const tAns = yield { kind: 'select', title: 'smoke-4：偏转1张被覆盖的正面朝下的卡牌', min: 1, max: 1, optional: false, candidates: cand };
  if (tAns.selected.length === 0) return;
  const uid = tAns.selected[0];
  const card = ctx.s.players.flatMap((p) => p.stacks).flat().find((c) => c.uid === uid);
  const fromLine = card?.line ?? 0;
  const lAns = yield {
    kind: 'select-line', title: 'smoke-4：偏转到哪条链路', min: 1, max: 1, optional: false, candidates: [],
    lines: ([0, 1, 2] as Line[]).filter((l) => l !== fromLine),
  };
  if (lAns.selected.length === 0) return;
  const to = Number(lAns.selected[0].replace('line:', '')) as Line;
  yield { op: 'shift', uid, targetLine: to, allowCovered: true };
}

/** smoke-5 中：你弃置1张牌 */
function* smoke5Middle(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const hand = ctx.candidates({ zone: 'hand', owner: ctx.player });
  const ans = yield { kind: 'select', title: 'smoke-5：你弃置1张牌', min: 1, max: 1, optional: false, candidates: hand };
  if (ans.selected.length === 0) return;
  yield { op: 'discard', uid: ans.selected[0] };
}

registerCardEffects('smoke-0', { middle: smoke0Middle });
registerCardEffects('smoke-1', { middle: smoke1Middle });
registerCardEffects('smoke-2', { valueModifier: { target: 'own-stack', apply: smoke2ValueModifier } });
registerCardEffects('smoke-3', { middle: smoke3Middle });
registerCardEffects('smoke-4', { middle: smoke4Middle });
registerCardEffects('smoke-5', { middle: smoke5Middle });

