import type { EffectCtx, EffectStep, GameState, Line, PlayerId, StepResult } from '../../models/types';
import { findCard } from '../context';
import { registerCardEffects } from '../registry';

/** darkness-0：抽 3 张牌，然后玩家选择 1 张对手被盖住的牌 + 平移目标线（无覆盖卡则 fizzle） */
function* darkness0(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  yield { op: 'draw', count: 3 };
  // 目标线由玩家选择 → 同列覆盖卡平移合法，候选不再排除（C2 时代同列排除规则移除）
  const covered = ctx.candidates({ zone: 'field', owner: ctx.player === 0 ? 1 : 0, covered: true });
  const ans = yield { kind: 'select', title: 'darkness-0：平移1张你对手的被盖住的牌', min: 1, max: 1, optional: false, candidates: covered };
  if (ans.selected.length === 0) return; // 无覆盖卡：fizzle（runStack 已跳过空候选，双保险）
  const srcLine = findCard(ctx.s, ans.selected[0])?.line ?? ctx.card.line;
  const line = yield { kind: 'select-line', title: 'darkness-0：选择平移目标线', min: 1, max: 1, optional: false, candidates: [], lines: [0, 1, 2].filter((l) => l !== srcLine) as Line[] };
  if (line.selected.length > 0) {
    yield { op: 'shift', uid: ans.selected[0], targetLine: Number(line.selected[0].replace('line:', '')) as Line, allowCovered: true };
  }
}

/** darkness-1：翻转 1 张你对手的牌，然后可选平移那张牌（跳过 = 留在原线） */
function* darkness1(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const targets = ctx.candidates({ zone: 'field' }).filter((c) => c.owner !== ctx.player);
  const ans = yield { kind: 'select', title: 'darkness-1：翻转1张你对手的牌', min: 1, max: 1, optional: false, candidates: targets };
  if (ans.selected.length === 0) return;
  yield { op: 'flip', uid: ans.selected[0] };
  // 目标线仅排除被翻卡当前列（平移必须到不同列，避免 shift 抛错）；
  // darkness-1 自己所在列是合法目标（被翻卡在别的列时，可平移到本卡所在列）
  const picked = targets.find((c) => c.uid === ans.selected[0]);
  const cardLine = picked?.line ?? ctx.card.line;
  const line = yield { kind: 'select-line', title: 'darkness-1：你可以平移那张牌', min: 1, max: 1, optional: true, candidates: [], lines: [0, 1, 2].filter((l) => l !== cardLine) as Line[] };
  if (line.selected.length > 0) {
    yield { op: 'shift', uid: ans.selected[0], targetLine: Number(line.selected[0].replace('line:', '')) as Line };
  }
}

/** darkness-2 中指令：可选翻转 1 张此列的反面牌（含被覆盖的——本卡正面打出盖住的反面牌可翻正）。
 *  源卡正面在顶时才结算中指令，故本列的反面牌必在其下（covered 候选列出全部非顶卡）。 */
function* darkness2Middle(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const facedown = ctx.candidates({ zone: 'field', covered: true }).filter((c) => c.line === ctx.card.line && !c.faceUp);
  const ans = yield { kind: 'select', title: 'darkness-2：你可以翻转1张此列的反面牌', min: 1, max: 1, optional: true, candidates: facedown };
  if (ans.selected.length > 0) yield { op: 'flip', uid: ans.selected[0], allowCovered: true };
}

/** darkness-2 顶命令数值修正：本线双方估值时，估值方堆叠中每张反面牌分值 4（而非 2）。
 *  target 'line'：线上任一玩家正面 darkness-2 即对双方估值生效；apply 的 owner 参数 = 估值方（stackValue 传入）。 */
function darkness2ValueModifier(s: GameState, owner: PlayerId, line: Line, total: number): number {
  const stack = s.players[owner].stacks[line];
  const faceDown = stack.filter((c) => !c.faceUp).length;
  return total + faceDown * 2; // 反面 2 → 4
}

/** darkness-3：选择 1 张手牌反面打出到另一列（无手牌则 fizzle；牌库不受影响） */
function* darkness3(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const hand = ctx.candidates({ zone: 'hand', owner: ctx.player });
  const ans = yield { kind: 'select', title: 'darkness-3：选择1张手牌反面打出', min: 1, max: 1, optional: false, candidates: hand };
  if (ans.selected.length === 0) return; // fizzle：无手牌
  const line = yield { kind: 'select-line', title: 'darkness-3：选择目标线路', min: 1, max: 1, optional: false, candidates: [], lines: [0, 1, 2].filter((l) => l !== ctx.card.line) as Line[] };
  if (line.selected.length === 0) return;
  yield { op: 'playFromHand', uid: ans.selected[0], line: Number(line.selected[0].replace('line:', '')) as Line, faceUp: false };
}

/** darkness-4：平移 1 张反面牌到选定的另一列（源线 = 目标卡当前线，经 findCard 全状态查找） */
function* darkness4(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const facedown = ctx.candidates({ zone: 'field' }).filter((c) => !c.faceUp);
  const ans = yield { kind: 'select', title: 'darkness-4：平移1张反面牌', min: 1, max: 1, optional: false, candidates: facedown };
  if (ans.selected.length === 0) return;
  const srcLine = findCard(ctx.s, ans.selected[0])?.line ?? ctx.card.line;
  const line = yield { kind: 'select-line', title: 'darkness-4：平移目标线', min: 1, max: 1, optional: false, candidates: [], lines: [0, 1, 2].filter((l) => l !== srcLine) as Line[] };
  if (line.selected.length > 0) {
    yield { op: 'shift', uid: ans.selected[0], targetLine: Number(line.selected[0].replace('line:', '')) as Line };
  }
}

/** darkness-5：弃 1 张牌 */
function* darkness5(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const hand = ctx.candidates({ zone: 'hand', owner: ctx.player });
  const ans = yield { kind: 'select', title: 'darkness-5：弃1张牌', min: 1, max: 1, optional: false, candidates: hand };
  if (ans.selected.length === 0) return;
  yield { op: 'discard', uid: ans.selected[0] };
}

registerCardEffects('darkness-0', { middle: darkness0 });
registerCardEffects('darkness-1', { middle: darkness1 });
registerCardEffects('darkness-2', { middle: darkness2Middle, valueModifier: { target: 'line', apply: darkness2ValueModifier } });
registerCardEffects('darkness-3', { middle: darkness3 });
registerCardEffects('darkness-4', { middle: darkness4 });
registerCardEffects('darkness-5', { middle: darkness5 });
