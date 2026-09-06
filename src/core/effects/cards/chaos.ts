import type { ChoiceCard, EffectCtx, EffectStep, GameState, Line, PlayerId, StepResult } from '../../models/types';
import { registerCardEffects } from '../registry';
import { getCardDef } from '../../../data/demo';

/**
 * 2代 混乱 chaos（关键词：抽取、重新排列协议、被覆盖）。
 * 权威卡文：src/data/cards2.ts；规格/裁决：docs/批1规格-幸运明镜和平混沌明晰.md §4 + docs/批1裁决结果.md
 * （[Q13]-[Q15]）。引擎能力 G6 chaos-3 任意线放行 / G7 reorderProtocols（2026-09-05 已实现）。
 * chaos-3 底「此牌可以无视协议限制打在任意链路中」由引擎 restrictions.cardAllowsFaceUpAnyLine 放行，
 * 本文件无需注册效果（见裁决 [Q15]）。
 */

function opp(p: PlayerId): PlayerId {
  return p === 0 ? 1 : 0;
}

/** 某线【双方链路】中被覆盖（非顶卡）的卡（任意朝向——2026-09-05 用户修正：混沌0 翻任意被盖卡，
 *  不只反面；flip allowCovered 翻正/翻回皆可） */
function coveredCandidates(s: GameState, line: Line): ChoiceCard[] {
  const out: ChoiceCard[] = [];
  for (const owner of [0, 1] as PlayerId[]) {
    const stack = s.players[owner].stacks[line];
    for (let i = 0; i < stack.length - 1; i++) {
      const c = stack[i];
      out.push({
        uid: c.uid, defId: c.defId, faceUp: c.faceUp, owner, zone: c.zone, line: c.line ?? line, pos: c.pos,
        label: String(getCardDef(c.defId).value),
      });
    }
  }
  return out;
}

/** chaos-0 中：在每条链路中，各翻转1张被覆盖的牌（用户 2026-09-05 修正：任意被盖卡——含被盖正面卡
 *  翻成反面与被盖反面卡翻正；被盖翻正不连锁中指令——FAQ 127 引擎已保证） */
function* chaos0Middle(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  // 快照可翻行（含 ≥1 张被盖卡），逐行处理（FAQ：标记每行 → 依次选行 → 翻一张 → 处理后果）
  let rows = ([0, 1, 2] as Line[]).filter((l) => coveredCandidates(ctx.s, l).length > 0);
  while (rows.length > 0) {
    const rAns = yield { kind: 'select-line', title: 'chaos-0：选择1条要翻开盖牌的链路', min: 1, max: 1, optional: true, candidates: [], lines: [...rows] };
    if (rAns.selected.length === 0) break; // 玩家主动停止（optional）
    const line = Number(rAns.selected[0].replace('line:', '')) as Line;
    rows = rows.filter((x) => x !== line);
    const cand = coveredCandidates(ctx.s, line); // 当前时点（连锁可能已清空该行）
    const cAns = yield { kind: 'select', title: 'chaos-0：翻转这张被覆盖的卡牌', min: 1, max: 1, optional: false, candidates: cand };
    if (cAns.selected.length === 0) continue; // 行内目标已被连锁翻走 → 跳过此行
    yield { op: 'flip', uid: cAns.selected[0], allowCovered: true };
  }
}

/** chaos-0 底（start，无 top 仅顶卡触发）：回合开始：你从对手的牌库中抽取1张牌。对手从你的牌库中
 *  抽取1张牌（txt 修改记录 2026-09-05【4】：回合结束→回合开始；英文 Start: Draw the top card of
 *  your opponent's deck. Your opponent draws the top card of your deck.） */
function* chaos0Start(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const me = ctx.player;
  const foe = opp(me);
  const foeP = ctx.s.players[foe];
  const meP = ctx.s.players[me];
  if (foeP.deck.length + foeP.trash.length > 0) {
    yield { op: 'draw', count: 1, fromOpponentDeck: true }; // 自己从对手牌库抽（空则洗对手弃牌堆）
  }
  if (meP.deck.length + meP.trash.length > 0) {
    yield { op: 'draw', count: 1, player: foe, fromOpponentDeck: true }; // 对手从自己牌库抽
  }
}

/** chaos-1 中：重新排列你的协议。重新排列对手的协议（FAQ 混沌1：必须对双方都修改；裁决 [Q14] 任意顺序） */
const PERMS = ['021', '102', '120', '201', '210']; // 0..2 非恒等排列（新位置 i 放原 order[i]）

function* chooseAndReorder(ctx: EffectCtx, target: PlayerId, label: string): Generator<EffectStep, void, StepResult> {
  const aAns = yield {
    kind: 'select-action', title: `chaos-1：重新排列${label}的协议（选择新布局）`, min: 1, max: 1, optional: false, candidates: [],
    actions: PERMS.map((p) => `action:order:${p}`),
  };
  if (aAns.selected.length === 0) return;
  const order = aAns.selected[0].split(':')[2].split('').map(Number) as Line[];
  yield { op: 'reorderProtocols', order, player: target };
}

function* chaos1Middle(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  yield* chooseAndReorder(ctx, ctx.player, '你');
  yield* chooseAndReorder(ctx, opp(ctx.player), '对手');
}

/** chaos-2 中：偏转1张你的被覆盖的卡牌 */
function* chaos2Middle(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const cand = ctx.candidates({ zone: 'field', owner: ctx.player, covered: true });
  const tAns = yield { kind: 'select', title: 'chaos-2：偏转1张你的被覆盖的卡牌', min: 1, max: 1, optional: false, candidates: cand };
  if (tAns.selected.length === 0) return; // 无被盖卡 → fizzle
  const card = ctx.s.players[ctx.player].stacks.flat().find((c) => c.uid === tAns.selected[0]);
  const fromLine = card?.line ?? 0;
  const lAns = yield {
    kind: 'select-line', title: 'chaos-2：偏转到哪条链路', min: 1, max: 1, optional: false,
    candidates: [], lines: ([0, 1, 2] as Line[]).filter((x) => x !== fromLine),
  };
  if (lAns.selected.length === 0) return;
  const toLine = Number(lAns.selected[0].replace('line:', '')) as Line;
  yield { op: 'shift', uid: tAns.selected[0], targetLine: toLine, allowCovered: true };
}

/** chaos-4 底（end）：回合结束：弃置所有手牌，抽取相同数目的卡牌 */
function* chaos4End(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const hand = ctx.s.players[ctx.player].hand.map((c) => c.uid);
  if (hand.length > 0) yield { op: 'discardMany', uids: hand };
  yield { op: 'draw', count: hand.length }; // 弃 0 → draw 0 no-op
}

/** chaos-5 中：你弃置1张牌 */
function* chaos5Middle(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const hand = ctx.candidates({ zone: 'hand', owner: ctx.player });
  const ans = yield { kind: 'select', title: 'chaos-5：你弃置1张牌', min: 1, max: 1, optional: false, candidates: hand };
  if (ans.selected.length === 0) return;
  yield { op: 'discard', uid: ans.selected[0] };
}

registerCardEffects('chaos-0', {
  middle: chaos0Middle,
  triggers: { start: { fn: chaos0Start, optional: false } },
});
registerCardEffects('chaos-1', { middle: chaos1Middle });
registerCardEffects('chaos-2', { middle: chaos2Middle });
// chaos-3：引擎放行（restrictions.cardAllowsFaceUpAnyLine('chaos-3')），无注册
registerCardEffects('chaos-4', { triggers: { end: { fn: chaos4End, optional: false } } });
registerCardEffects('chaos-5', { middle: chaos5Middle });


