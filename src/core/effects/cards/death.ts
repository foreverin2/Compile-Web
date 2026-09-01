import type { EffectCtx, EffectGen, EffectStep, Line, PlayerId, StepResult } from '../../models/types';
import { registerCardEffects } from '../registry';
import { getCardDef } from '../../../data/demo';
import { cardPointValue } from '../../state/create';

/** death-0：从另两列各删除1张牌。
 *  FAQ 131：拥有者标记要执行的行，逐行处理——先选第一列（排除当前列）→ 选该列 1 张顶卡删除
 *  → 再选第二列（排除当前列与已选列）→ 选卡删除。某列无牌可删 → 该步 fizzle 跳过，另一列照做。 */
function* death0(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const srcLine = ctx.card.line!;
  const line1 = yield { kind: 'select-line', title: 'death-0：选择要删除1张牌的第一列', min: 1, max: 1, optional: false, candidates: [], lines: ([0, 1, 2] as Line[]).filter((l) => l !== srcLine) };
  if (line1.selected.length === 0) return;
  const l1 = Number(line1.selected[0].replace('line:', '')) as Line;
  const ans1 = yield { kind: 'select', title: 'death-0：删除该列1张牌', min: 1, max: 1, optional: false, candidates: ctx.candidates({ zone: 'field' }).filter((c) => c.line === l1) };
  if (ans1.selected.length > 0) yield { op: 'delete', uid: ans1.selected[0] };
  const line2 = yield { kind: 'select-line', title: 'death-0：选择要删除1张牌的第二列', min: 1, max: 1, optional: false, candidates: [], lines: ([0, 1, 2] as Line[]).filter((l) => l !== srcLine && l !== l1) };
  if (line2.selected.length === 0) return;
  const l2 = Number(line2.selected[0].replace('line:', '')) as Line;
  const ans2 = yield { kind: 'select', title: 'death-0：删除该列1张牌', min: 1, max: 1, optional: false, candidates: ctx.candidates({ zone: 'field' }).filter((c) => c.line === l2) };
  if (ans2.selected.length > 0) yield { op: 'delete', uid: ans2.selected[0] };
}

/** death-1 顶指令：开始：你可以抽1张牌。若如此，删除另1张牌，然后删除此牌。
 *  top: true —— 顶命令被盖仍生效（FAQ 98/99）。触发效果内：select-action 抽/跳过 →
 *  若抽：选 1 张 field 顶卡（候选已排除自己）删除 → 删除自己（allowCovered：被盖时自身删除
 *  需跳过未覆盖检查，同 life-0；删后 sourceValid 使剩余效果终止，无碍）。 */
function* death1Start(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const act = yield { kind: 'select-action', title: 'death-1：你可以抽1张牌', min: 1, max: 1, optional: false, candidates: [], actions: ['action:draw', 'action:skip'] };
  if (act.selected.length === 0) return; // fizzle 兜底
  if (act.selected[0] === 'action:skip') return;
  yield { op: 'draw', count: 1 };
  const ans = yield { kind: 'select', title: 'death-1：删除另1张牌', min: 1, max: 1, optional: false, candidates: ctx.candidates({ zone: 'field' }) };
  if (ans.selected.length === 0) return; // 无删除目标 → 不删自己
  yield { op: 'delete', uid: ans.selected[0] };
  yield { op: 'delete', uid: ctx.card.uid, allowCovered: true };
}

/** death-2：选1列删除其中所有1分和2分的牌。
 *  分值按【结算开始时】一次性评估（快照目标 uid 后逐张删除，与 water-3 口径一致）：
 *  cardPointValue ∈ {1,2}（含被盖卡——"所有"含覆盖在下面的牌；正面 1/2 分卡；反面默认 2；
 *  所在线有正面 darkness-2 顶命令时反面 = 4，排除）。
 *  覆盖卡删除必须带 allowCovered。目标含自己（death-2 自身 2 分）时自己放最后删——
 *  源卡被删后 sourceValid 终止剩余效果，故先删其他目标再删自己，保证"所有"都被删。
 *  无 1/2 分卡 → 无 yield，天然 fizzle。 */
function* death2(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const line = yield { kind: 'select-line', title: 'death-2：选1列删除其中所有1分和2分的牌', min: 1, max: 1, optional: false, candidates: [], lines: [0, 1, 2] };
  if (line.selected.length === 0) return;
  const l = Number(line.selected[0].replace('line:', '')) as Line;
  const s = ctx.s;
  const self = ctx.card.uid;
  const targets: string[] = [];
  let selfTarget = false;
  for (const owner of [0, 1] as PlayerId[]) {
    for (const card of s.players[owner].stacks[l]) {
      const v = cardPointValue(s, card);
      if (v !== 1 && v !== 2) continue;
      if (card.uid === self) { selfTarget = true; continue; }
      targets.push(card.uid);
    }
  }
  if (selfTarget) targets.push(self); // 自己最后删（本列含自己且自己分值为 1/2 时）
  for (const uid of targets) yield { op: 'delete', uid, allowCovered: true };
}

/** death-3：删除1张反面牌（未覆盖顶卡中的反面牌；被盖卡不在候选——listCandidates 只列顶卡） */
function* death3(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const facedown = ctx.candidates({ zone: 'field' }).filter((c) => !c.faceUp);
  const ans = yield { kind: 'select', title: 'death-3：删除1张反面牌', min: 1, max: 1, optional: false, candidates: facedown };
  if (ans.selected.length === 0) return; // fizzle：无反面顶卡
  yield { op: 'delete', uid: ans.selected[0] };
}

/** death-4：删除1张0分或1分的牌（未覆盖顶卡中正面且牌面值 ≤1 的；反面/更高分排除） */
function* death4(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const targets = ctx.candidates({ zone: 'field' }).filter((c) => c.faceUp && getCardDef(c.defId).value <= 1);
  const ans = yield { kind: 'select', title: 'death-4：删除1张0分或1分的牌', min: 1, max: 1, optional: false, candidates: targets };
  if (ans.selected.length === 0) return; // fizzle：无 0/1 分正面顶卡
  yield { op: 'delete', uid: ans.selected[0] };
}

/** death-5：弃1张牌 */
function* death5(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const hand = ctx.candidates({ zone: 'hand', owner: ctx.player });
  const ans = yield { kind: 'select', title: 'death-5：弃1张牌', min: 1, max: 1, optional: false, candidates: hand };
  if (ans.selected.length === 0) return; // fizzle：无牌可弃
  yield { op: 'discard', uid: ans.selected[0] };
}

registerCardEffects('death-0', { middle: death0 });
registerCardEffects('death-1', { triggers: { start: { fn: death1Start, optional: false, top: true } } });
registerCardEffects('death-2', { middle: death2 });
registerCardEffects('death-3', { middle: death3 });
registerCardEffects('death-4', { middle: death4 });
registerCardEffects('death-5', { middle: death5 });
