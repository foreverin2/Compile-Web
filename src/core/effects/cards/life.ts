import type { EffectCtx, EffectGen, EffectStep, Line, PlayerId, StepResult } from '../../models/types';
import { registerCardEffects } from '../registry';
import { deckTopAvailable } from '../context';
import { isUncovered } from '../context';

/** life-0 中指令：在你有牌的每一列以反面打出你牌堆顶的牌。
 *  当前列包含在内（life-0 自身即"你有牌"）→ 本列最后打：落地会盖住 life-0，触发其
 *  顶指令（FAQ 139 更正：结束：若此卡被覆盖，则移除此卡）……不——被盖的 life-0 顶命令
 *  结束阶段才删；本列最后打使其余各列先结算，且打完后本列覆盖 life-0（其顶命令被盖仍生效，
 *  等结束阶段删自己）。牌库空 → 剩余列 fizzle（FAQ 142：打牌堆顶不洗牌）。 */
function* life0Middle(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const srcLine = ctx.card.line!;
  const withCards = ([0, 1, 2] as Line[]).filter((l) => ctx.s.players[ctx.player].stacks[l].length > 0);
  const ordered = [
    ...withCards.filter((l) => l !== srcLine),
    ...(withCards.includes(srcLine) ? [srcLine] : []),
  ];
  for (const line of ordered) {
    if (!deckTopAvailable(ctx.s, ctx.player)) break; // 牌库空 → 剩余列 fizzle（不洗弃牌堆）
    yield { op: 'playTopDeck', line, faceUp: false };
  }
}

/** life-0 顶指令（FAQ 139 更正 2024-10）：结束：若此卡被覆盖，则移除此卡。
 *  top: true —— 顶命令被盖仍生效（被盖时 collectTriggers 也会收集它）；未被覆盖则不删。
 *  allowCovered：被盖卡删除自身需跳过未覆盖检查 */
function* life0End(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  if (isUncovered(ctx.s, ctx.card)) return; // 未被覆盖 → 不删
  yield { op: 'delete', uid: ctx.card.uid, allowCovered: true };
}

/** life-1：翻转1张牌。再翻转1张牌。—— 两次各选 1 张未覆盖牌翻转；第二次可再选第一次那张
 *  （reference excludeSelf:false 无已选排除；源卡自身被候选排除 ≈ reference 的 committed-card 排除）。 */
function* life1(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const targets = ctx.candidates({ zone: 'field' });
  const ans1 = yield { kind: 'select', title: 'life-1：翻转1张牌', min: 1, max: 1, optional: false, candidates: targets };
  if (ans1.selected.length > 0) yield { op: 'flip', uid: ans1.selected[0] };
  const ans2 = yield { kind: 'select', title: 'life-1：再翻转1张牌', min: 1, max: 1, optional: false, candidates: ctx.candidates({ zone: 'field' }) };
  if (ans2.selected.length > 0) yield { op: 'flip', uid: ans2.selected[0] };
}

/** life-2：抽1张牌。你可以翻转1张反面牌。—— 可选，无反面卡时 fizzle（自动跳过） */
function* life2(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  yield { op: 'draw', count: 1 };
  const facedown = ctx.candidates({ zone: 'field' }).filter((c) => !c.faceUp);
  const ans = yield { kind: 'select', title: 'life-2：你可以翻转1张反面牌', min: 1, max: 1, optional: true, candidates: facedown };
  if (ans.selected.length > 0) yield { op: 'flip', uid: ans.selected[0] };
}

/** life-3 底指令：被盖住前——先在另一列以反面打出你牌堆顶的牌。
 *  目标列由持有者选择（reference another_line 会先预览再选列 → 用 select-line 适配，排除当前列）。 */
function* life3BeforeCovered(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  if (!deckTopAvailable(ctx.s, ctx.player)) return; // 无牌可打 → fizzle（不挂起选列）
  const line = yield { kind: 'select-line', title: 'life-3（被盖住前）：在另一列反面打出牌堆顶', min: 1, max: 1, optional: false, candidates: [], lines: ([0, 1, 2] as Line[]).filter((l) => l !== ctx.card.line) };
  if (line.selected.length === 0) return;
  yield { op: 'playTopDeck', line: Number(line.selected[0].replace('line:', '')) as Line, faceUp: false };
}

/** life-4：如果此牌盖住了某张牌，抽1张牌。—— 中指令结算时本卡必为所在堆叠顶卡：其下还有牌 = 盖住了牌 */
function* life4(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const stack = ctx.s.players[ctx.card.owner].stacks[ctx.card.line!];
  if (stack.length >= 2) yield { op: 'draw', count: 1 };
}

/** life-5：弃1张牌 */
function* life5(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const hand = ctx.candidates({ zone: 'hand', owner: ctx.player });
  const ans = yield { kind: 'select', title: 'life-5：弃1张牌', min: 1, max: 1, optional: false, candidates: hand };
  if (ans.selected.length === 0) return; // fizzle：无牌可弃
  yield { op: 'discard', uid: ans.selected[0] };
}

registerCardEffects('life-0', {
  middle: life0Middle,
  triggers: { 'end': { fn: life0End, optional: false, top: true } }, // FAQ 139 更正：顶指令（被盖仍生效）
});
registerCardEffects('life-1', { middle: life1 });
registerCardEffects('life-2', { middle: life2 });
registerCardEffects('life-3', { triggers: { 'before-covered': { fn: life3BeforeCovered, optional: false } } });
registerCardEffects('life-4', { middle: life4 });
registerCardEffects('life-5', { middle: life5 });
