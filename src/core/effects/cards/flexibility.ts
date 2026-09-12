import type { EffectCtx, EffectStep, Line, PlayerId, StepResult } from '../../models/types';
import { registerCardEffects } from '../registry';
import { findCard } from '../context';

/**
 * 3代 柔性 flexibility（关键词：回手/偏转/翻转/抽牌/交换；座右铭：随机应变）。
 * 权威卡文：src/data/cards3.ts（compile3文本.txt）；裁决：docs/3代-批3-规格与裁决清单.md
 * （RQ7-A 回手任意场牌回其主；「回手或偏转」= select-action 二选一）。
 */

function opp(p: PlayerId): PlayerId {
  return p === 0 ? 1 : 0;
}

/** flexibility-0 中：回手或偏转1张牌。 */
function* flexibility0Middle(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const act = yield {
    kind: 'select-action', title: 'flexibility-0：回手或偏转1张牌', min: 1, max: 1, optional: false, candidates: [],
    actions: ['action:return', 'action:shift'],
  };
  if (act.selected.length === 0) return;
  const cand = ctx.candidates({ zone: 'field' });
  const tAns = yield { kind: 'select', title: act.selected[0] === 'action:return' ? 'flexibility-0：回手这张牌' : 'flexibility-0：偏转这张牌', min: 1, max: 1, optional: false, candidates: cand };
  if (tAns.selected.length === 0) return;
  if (act.selected[0] === 'action:return') {
    yield { op: 'return', uid: tAns.selected[0] };
    return;
  }
  const card = findCard(ctx.s, tAns.selected[0]);
  const srcLine = card?.line ?? ctx.card.line;
  if (srcLine === null) return;
  const lAns = yield {
    kind: 'select-line', title: 'flexibility-0：偏转到哪条链路', min: 1, max: 1, optional: false, candidates: [],
    lines: ([0, 1, 2] as Line[]).filter((l) => l !== srcLine),
  };
  if (lAns.selected.length > 0) yield { op: 'shift', uid: tAns.selected[0], targetLine: Number(lAns.selected[0].replace('line:', '')) as Line };
}

/** flexibility-1 中：翻转或偏转你的1张牌。 */
function* flexibility1Middle(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const act = yield {
    kind: 'select-action', title: 'flexibility-1：翻转或偏转你的1张牌', min: 1, max: 1, optional: false, candidates: [],
    actions: ['action:flip', 'action:shift'],
  };
  if (act.selected.length === 0) return;
  const cand = ctx.candidates({ zone: 'field', owner: ctx.player });
  const tAns = yield { kind: 'select', title: 'flexibility-1：选择你的1张牌', min: 1, max: 1, optional: false, candidates: cand };
  if (tAns.selected.length === 0) return;
  if (act.selected[0] === 'action:flip') {
    yield { op: 'flip', uid: tAns.selected[0] };
    return;
  }
  const card = findCard(ctx.s, tAns.selected[0]);
  const srcLine = card?.line ?? ctx.card.line;
  if (srcLine === null) return;
  const lAns = yield {
    kind: 'select-line', title: 'flexibility-1：偏转到哪条链路', min: 1, max: 1, optional: false, candidates: [],
    lines: ([0, 1, 2] as Line[]).filter((l) => l !== srcLine),
  };
  if (lAns.selected.length > 0) yield { op: 'shift', uid: tAns.selected[0], targetLine: Number(lAns.selected[0].replace('line:', '')) as Line };
}

/** flexibility-2 顶（end，top 命令被盖仍生效）：结束：若此牌被1张反面朝下的牌覆盖，你可以偏转那张牌。
 *  上方相邻覆盖者为 faceDown → 可选把那张 faceDown 偏转到别线（覆盖者当前线 → 目标线自选）。 */
function* flexibility2End(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const line = ctx.card.line;
  if (line === null) return;
  const stack = ctx.s.players[ctx.player].stacks[line];
  const idx = stack.findIndex((c) => c.uid === ctx.card.uid);
  if (idx === -1) return;
  const cover = stack[idx + 1];
  if (!cover || cover.faceUp) return; // 覆盖者非反面 → 条件不满足
  const act = yield {
    kind: 'select-action', title: 'flexibility-2（结束）：此牌被反面牌覆盖——你可以偏转那张牌', min: 1, max: 1, optional: true,
    candidates: [], actions: ['action:shift'],
  };
  if (act.selected.length === 0) return;
  const lAns = yield {
    kind: 'select-line', title: 'flexibility-2：把覆盖者偏转到哪条链路', min: 1, max: 1, optional: false, candidates: [],
    lines: ([0, 1, 2] as Line[]).filter((l) => l !== line),
  };
  // 覆盖者本身可能还压着别的卡（idx+2 存在）→ 它自己是"被覆盖卡"，偏转必须带 allowCovered
  if (lAns.selected.length > 0) yield { op: 'shift', uid: cover.uid, targetLine: Number(lAns.selected[0].replace('line:', '')) as Line, allowCovered: true };
}

/** flexibility-2 中：抽1张牌。 */
function* flexibility2Middle(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  yield { op: 'draw', count: 1 };
}

/** flexibility-3 中：偏转对手的1张牌，或交换你的2个协议。 */
function* flexibility3Middle(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const act = yield {
    kind: 'select-action', title: 'flexibility-3：偏转对手的1张牌，或交换你的2个协议', min: 1, max: 1, optional: false, candidates: [],
    actions: ['action:shift', 'action:swap'],
  };
  if (act.selected.length === 0) return;
  if (act.selected[0] === 'action:swap') {
    const aAns = yield { kind: 'select-line', title: 'flexibility-3：交换你的2个协议——第1个位置', min: 1, max: 1, optional: false, candidates: [], lines: [0, 1, 2] };
    if (aAns.selected.length === 0) return;
    const a = Number(aAns.selected[0].replace('line:', '')) as Line;
    const bAns = yield { kind: 'select-line', title: 'flexibility-3：第2个位置', min: 1, max: 1, optional: false, candidates: [], lines: ([0, 1, 2] as Line[]).filter((l) => l !== a) };
    if (bAns.selected.length === 0) return;
    yield { op: 'rearrangeProtocols', a, b: Number(bAns.selected[0].replace('line:', '')) as Line };
    return;
  }
  const cand = ctx.candidates({ zone: 'field', owner: opp(ctx.player) });
  const tAns = yield { kind: 'select', title: 'flexibility-3：偏转对手的1张牌', min: 1, max: 1, optional: false, candidates: cand };
  if (tAns.selected.length === 0) return;
  const card = findCard(ctx.s, tAns.selected[0]);
  const srcLine = card?.line ?? ctx.card.line;
  if (srcLine === null) return;
  const lAns = yield {
    kind: 'select-line', title: 'flexibility-3：偏转到哪条链路', min: 1, max: 1, optional: false, candidates: [],
    lines: ([0, 1, 2] as Line[]).filter((l) => l !== srcLine),
  };
  if (lAns.selected.length > 0) yield { op: 'shift', uid: tAns.selected[0], targetLine: Number(lAns.selected[0].replace('line:', '')) as Line };
}

/** flexibility-4 底（end，无 top 仅顶卡）：结束：你可以抽2张牌。若你这么做，翻转此牌。 */
function* flexibility4End(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const act = yield {
    kind: 'select-action', title: 'flexibility-4（结束）：你可以抽2张牌（若这么做翻转此牌）', min: 1, max: 1, optional: true,
    candidates: [], actions: ['action:draw'],
  };
  if (act.selected.length === 0) return; // 跳过
  yield { op: 'draw', count: 2 };
  yield { op: 'flip', uid: ctx.card.uid };
}

/** flexibility-5 中：弃1张牌。 */
function* flexibility5Middle(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const hand = ctx.candidates({ zone: 'hand', owner: ctx.player });
  const ans = yield { kind: 'select', title: 'flexibility-5：弃1张牌', min: 1, max: 1, optional: false, candidates: hand };
  if (ans.selected.length > 0) yield { op: 'discard', uid: ans.selected[0] };
}

registerCardEffects('flexibility-0', { middle: flexibility0Middle });
registerCardEffects('flexibility-1', { middle: flexibility1Middle });
registerCardEffects('flexibility-2', {
  middle: flexibility2Middle,
  triggers: {
    end: {
      fn: flexibility2End,
      optional: false,
      top: true,
      // 自动判定：此牌被1张反面朝下的卡覆盖（上方相邻 faceDown 存在）才触发——否则无动作
      cond: (s, card) => {
        if (card.line === null) return false;
        const stack = s.players[card.owner].stacks[card.line];
        const idx = stack.findIndex((c) => c.uid === card.uid);
        const cover = idx === -1 ? undefined : stack[idx + 1];
        return !!cover && !cover.faceUp;
      },
    },
  },
});
registerCardEffects('flexibility-3', { middle: flexibility3Middle });
registerCardEffects('flexibility-4', { triggers: { end: { fn: flexibility4End, optional: false } } });
registerCardEffects('flexibility-5', { middle: flexibility5Middle });
