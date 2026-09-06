import type { ChoiceCard, EffectCtx, EffectStep, GameState, Line, PlayerId, StepResult } from '../../models/types';
import { registerCardEffects } from '../registry';
import { getCardDef } from '../../../data/demo';

/**
 * 3代 伏击 ambush（关键词：翻转/抽牌/平移；座右铭：潜形晦迹）。
 * 权威卡文：src/data/cards3.ts（compile3文本.txt）；裁决：docs/3代-批2-规格与裁决清单.md
 * （B4 伏击1 含被盖：己方所有印刷值 0/1 的牌任意朝向/层；B5 阈值并列拥有者任选；
 *  「翻转1张你的反面朝下的牌」= 自己未覆盖 faceDown 顶卡，惯例）。
 */

function opp(p: PlayerId): PlayerId {
  return p === 0 ? 1 : 0;
}

/** 印刷值 */
function pv(defId: string): number {
  return getCardDef(defId).value;
}

/** 自己场上印刷值 ∈ {0,1} 的卡（含被盖、含 faceDown；排除源卡）——B4 */
function ownLowCards(s: GameState, player: PlayerId, excludeUid?: string): ChoiceCard[] {
  const out: ChoiceCard[] = [];
  const stacks = s.players[player].stacks;
  for (let line = 0; line < 3; line++) {
    const stack = stacks[line as Line];
    for (let i = 0; i < stack.length; i++) {
      const c = stack[i];
      const v = pv(c.defId);
      if ((v === 0 || v === 1) && c.uid !== excludeUid) {
        out.push({
          uid: c.uid, defId: c.defId, faceUp: c.faceUp, owner: player, zone: 'field' as const,
          line: line as Line, pos: c.pos, label: String(v),
        });
      }
    }
  }
  return out;
}

/** ambush-0 中：抽3张牌。翻转1张你的反面朝下的牌。 */
function* ambush0Middle(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  yield { op: 'draw', count: 3 };
  const cand = ctx.candidates({ zone: 'field', owner: ctx.player }).filter((c) => !c.faceUp);
  const ans = yield { kind: 'select', title: 'ambush-0：翻转1张你的反面朝下的牌', min: 1, max: 1, optional: false, candidates: cand };
  if (ans.selected.length > 0) yield { op: 'flip', uid: ans.selected[0] };
}

/** ambush-1 中：翻转你所有其他阈值为0和1的牌。每翻转1张牌抽1张牌。
 *  快照（己方全场印刷值 0/1，含被盖任意朝向，除自身）逐张 flip（被盖 allowCovered；faceDown 翻正照引擎
 *  惯例连锁中指令），每张成功 flip 后 draw 1。 */
function* ambush1Middle(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const targets = ownLowCards(ctx.s, ctx.player, ctx.card.uid);
  for (const t of targets) {
    const card = ctx.s.players[ctx.player].stacks[t.line as Line].find((c) => c.uid === t.uid);
    if (!card) continue;
    const uncovered = ctx.s.players[ctx.player].stacks[t.line as Line][ctx.s.players[ctx.player].stacks[t.line as Line].length - 1]?.uid === t.uid;
    yield { op: 'flip', uid: t.uid, allowCovered: !uncovered };
    yield { op: 'draw', count: 1 };
  }
}

/** ambush-2 中：平移你阈值最低的被覆盖的牌。（自己被盖中印刷值最低；并列拥有者选 → 目标线自选 ≠ 原线） */
function* ambush2Middle(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const covered = ctx.candidates({ zone: 'field', owner: ctx.player, covered: true });
  if (covered.length === 0) return;
  const minV = Math.min(...covered.map((c) => pv(c.defId)));
  const cand = covered.filter((c) => pv(c.defId) === minV);
  const cAns = yield { kind: 'select', title: 'ambush-2：平移你阈值最低的被覆盖的牌', min: 1, max: 1, optional: false, candidates: cand };
  if (cAns.selected.length === 0) return;
  const picked = cand.find((c) => c.uid === cAns.selected[0]);
  const srcLine = picked?.line ?? ctx.card.line;
  if (srcLine === null) return;
  const lAns = yield {
    kind: 'select-line', title: 'ambush-2：平移到哪条链路', min: 1, max: 1, optional: false, candidates: [],
    lines: ([0, 1, 2] as Line[]).filter((l) => l !== srcLine),
  };
  if (lAns.selected.length === 0) return;
  yield { op: 'shift', uid: cAns.selected[0], targetLine: Number(lAns.selected[0].replace('line:', '')) as Line, allowCovered: true };
}

/** ambush-3 中：翻转对手阈值最高的正面朝上的被覆盖的牌。（对手被盖 faceUp 中印刷值最高，并列选 → 翻面） */
function* ambush3Middle(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const foe = opp(ctx.player);
  const covered = ctx.candidates({ zone: 'field', owner: foe, covered: true }).filter((c) => c.faceUp);
  if (covered.length === 0) return;
  const maxV = Math.max(...covered.map((c) => pv(c.defId)));
  const cand = covered.filter((c) => pv(c.defId) === maxV);
  const ans = yield { kind: 'select', title: 'ambush-3：翻转对手阈值最高的被覆盖的牌', min: 1, max: 1, optional: false, candidates: cand };
  if (ans.selected.length > 0) yield { op: 'flip', uid: ans.selected[0], allowCovered: true };
}

/** ambush-4 中：若你有1张未被覆盖的反面朝下的牌，抽1张牌。 */
function* ambush4Middle(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const has = ctx.s.players[ctx.player].stacks.some(
    (stack) => stack.length > 0 && !stack[stack.length - 1].faceUp,
  );
  if (has) yield { op: 'draw', count: 1 };
}

/** ambush-5 中：弃1张牌。 */
function* ambush5Middle(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const hand = ctx.candidates({ zone: 'hand', owner: ctx.player });
  const ans = yield { kind: 'select', title: 'ambush-5：弃1张牌', min: 1, max: 1, optional: false, candidates: hand };
  if (ans.selected.length > 0) yield { op: 'discard', uid: ans.selected[0] };
}

registerCardEffects('ambush-0', { middle: ambush0Middle });
registerCardEffects('ambush-1', { middle: ambush1Middle });
registerCardEffects('ambush-2', { middle: ambush2Middle });
registerCardEffects('ambush-3', { middle: ambush3Middle });
registerCardEffects('ambush-4', { middle: ambush4Middle });
registerCardEffects('ambush-5', { middle: ambush5Middle });
