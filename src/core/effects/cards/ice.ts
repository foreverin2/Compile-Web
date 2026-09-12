import type { EffectCtx, EffectStep, Line, PlayerId, StepResult } from '../../models/types';
import { registerCardEffects } from '../registry';
import { findCard, isUncovered } from '../context';

/**
 * 2代 寒冰 ice（关键词：偏转、守护；2026-09-13 按 txt 同步）。
 * 权威卡文：src/data/cards2.ts；裁决/默认：docs/批2裁决结果.md（ice-1 after-play 定向触发、
 * ice-3 end 被盖可偏转、ice-4 禁翻引擎守卫、ice-6 禁抽引擎守卫）。引擎扩展已提交 00e0f4b。
 */

function opp(p: PlayerId): PlayerId {
  return p === 0 ? 1 : 0;
}

/** ice-1 中：你可以偏转此牌（可选：把自己 shift 到其它线；自己必为顶卡） */
function* ice1Middle(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const fromLine = ctx.card.line;
  if (fromLine === null) return;
  const lineAns = yield {
    kind: 'select-line', title: 'ice-1：你可以偏转此牌', min: 1, max: 1, optional: true, candidates: [],
    lines: ([0, 1, 2] as Line[]).filter((l) => l !== fromLine),
  };
  if (lineAns.selected.length === 0) return; // 可选：跳过
  const to = Number(lineAns.selected[0].replace('line:', '')) as Line;
  yield { op: 'shift', uid: ctx.card.uid, targetLine: to };
}

/** ice-1 底（after-play，无 top 仅顶卡）：对手在此链路出牌后：他要弃置1张牌（打牌者自己选弃） */
function* ice1AfterPlay(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const foe = opp(ctx.player); // 打牌者 = ice-1 拥有者的对手
  const hand = ctx.candidates({ zone: 'hand', owner: foe });
  if (hand.length === 0) return; // 无牌可弃
  const ans = yield {
    kind: 'select', title: 'ice-1：对手在此链路出牌后，他要弃置1张牌', min: 1, max: 1, optional: false, candidates: hand, chooser: foe,
  };
  if (ans.selected.length === 0) return;
  yield { op: 'discard', uid: ans.selected[0] };
}

/** ice-2 中：偏转1张其它牌（未覆盖顶卡，任意方；源卡自动排除） */
function* ice2Middle(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const cand = ctx.candidates({ zone: 'field' });
  const tAns = yield { kind: 'select', title: 'ice-2：偏转1张其它牌', min: 1, max: 1, optional: false, candidates: cand };
  if (tAns.selected.length === 0) return;
  const card = ctx.s.players.flatMap((p) => p.stacks).flat().find((c) => c.uid === tAns.selected[0]);
  const fromLine = card?.line ?? 0;
  const lAns = yield {
    kind: 'select-line', title: 'ice-2：偏转到哪条链路', min: 1, max: 1, optional: false, candidates: [],
    lines: ([0, 1, 2] as Line[]).filter((l) => l !== fromLine),
  };
  if (lAns.selected.length === 0) return;
  const to = Number(lAns.selected[0].replace('line:', '')) as Line;
  yield { op: 'shift', uid: tAns.selected[0], targetLine: to };
}

/** ice-3 顶（end，top:true）：回合结束：当这张牌被覆盖时，你可以偏转此牌（被盖也能被 end 收集——
 *  顶命令；条件=被盖时，可选把自己 shift 到其它线，allowCovered 移走被盖卡） */
function* ice3End(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const card = findCard(ctx.s, ctx.card.uid);
  if (!card || card.line === null) return;
  // 被盖判定：不是其链路顶卡
  const stack = ctx.s.players[card.owner].stacks[card.line];
  if (stack[stack.length - 1]?.uid === card.uid) return; // 未覆盖 → 条件不满足
  const lAns = yield {
    kind: 'select-line', title: 'ice-3：此牌被覆盖，你可以偏转它', min: 1, max: 1, optional: true, candidates: [],
    lines: ([0, 1, 2] as Line[]).filter((l) => l !== card.line),
  };
  if (lAns.selected.length === 0) return;
  const to = Number(lAns.selected[0].replace('line:', '')) as Line;
  yield { op: 'shift', uid: card.uid, targetLine: to, allowCovered: true };
}

// ice-4 底「此牌不可被翻转」：引擎 flip 守卫（resolve.ts），无注册
// ice-5 弃1 见 ice5Middle
function* ice5Middle(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const hand = ctx.candidates({ zone: 'hand', owner: ctx.player });
  const ans = yield { kind: 'select', title: 'ice-5：你弃置1张牌', min: 1, max: 1, optional: false, candidates: hand };
  if (ans.selected.length === 0) return;
  yield { op: 'discard', uid: ans.selected[0] };
}

// ice-6 顶「如果你有手牌，那么你不可以抽牌」：引擎守卫 shouldBlockDraw（context.ts），无注册

registerCardEffects('ice-1', {
  middle: ice1Middle,
  triggers: { 'after-play': { fn: ice1AfterPlay, optional: false } },
});
registerCardEffects('ice-2', { middle: ice2Middle });
registerCardEffects('ice-3', {
  triggers: {
    end: {
      fn: ice3End,
      optional: true,
      top: true,
      // 自动判定：未被覆盖（顶卡）→ 无「被盖才可偏转」前提 → 收集前自动跳过不弹按钮
      cond: (s, card) => !isUncovered(s, card),
    },
  },
});
// ice-4：引擎禁翻（flip 守卫）
registerCardEffects('ice-5', { middle: ice5Middle });
// ice-6：引擎禁抽（shouldBlockDraw）

