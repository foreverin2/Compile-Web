import type { EffectCtx, EffectStep, GameState, Line, PlayerId, StepResult } from '../../models/types';
import { findCard } from '../context';
import { registerCardEffects } from '../registry';

/** darkness-0：抽 3 张牌，然后平移 1 张你对手的被盖住的牌（到本卡所在列；无覆盖卡则 fizzle） */
function* darkness0(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  yield { op: 'draw', count: 3 };
  // 目标线固定为本卡所在列 → 已在本列的覆盖卡平移不了（同线 shift 非法），从候选排除；全被排除则 fizzle
  const covered = ctx
    .candidates({ zone: 'field', owner: ctx.player === 0 ? 1 : 0, covered: true })
    .filter((c) => c.line !== ctx.card.line);
  const ans = yield { kind: 'select', title: 'darkness-0：平移1张你对手的被盖住的牌', min: 1, max: 1, optional: false, candidates: covered };
  if (ans.selected.length === 0) return; // 无覆盖卡：fizzle（runStack 已跳过空候选，双保险）
  yield { op: 'shift', uid: ans.selected[0], targetLine: ctx.card.line!, allowCovered: true };
}

/** darkness-1：翻转 1 张你对手的牌，然后可选平移那张牌（跳过 = 留在原线） */
function* darkness1(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const targets = ctx.candidates({ zone: 'field' }).filter((c) => c.owner !== ctx.player);
  const ans = yield { kind: 'select', title: 'darkness-1：翻转1张你对手的牌', min: 1, max: 1, optional: false, candidates: targets };
  if (ans.selected.length === 0) return;
  yield { op: 'flip', uid: ans.selected[0] };
  // 目标线排除源卡所在列 + 被翻卡当前列（平移必须到不同列，避免 shift 抛错）
  const picked = targets.find((c) => c.uid === ans.selected[0]);
  const cardLine = picked?.line ?? ctx.card.line;
  const line = yield { kind: 'select-line', title: 'darkness-1：你可以平移那张牌', min: 1, max: 1, optional: true, candidates: [], lines: [0, 1, 2].filter((l) => l !== ctx.card.line && l !== cardLine) as Line[] };
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

/** darkness-3：在另一列反面打出牌堆顶（牌库空则 fizzle） */
function* darkness3(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const line = yield { kind: 'select-line', title: 'darkness-3：在另一列反面打出', min: 1, max: 1, optional: false, candidates: [], lines: [0, 1, 2].filter((l) => l !== ctx.card.line) as Line[] };
  if (line.selected.length === 0) return;
  if (ctx.s.players[ctx.player].deck.length === 0) return; // 空牌库：fizzle
  yield { op: 'playTopDeck', line: Number(line.selected[0].replace('line:', '')) as Line, faceUp: false };
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
