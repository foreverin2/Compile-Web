import type { EffectCtx, EffectGen, EffectStep, Line, PlayerId, StepResult } from '../../models/types';
import { registerCardEffects } from '../registry';
import { deckTopAvailable } from '../context';
import { cardPointValue } from '../../state/create';

/** water-0：翻转另1张牌，然后翻转此牌（自身）。
 *  候选排除结算中源卡（= "另1张"）；翻转另牌后若其翻正触发中指令连锁，链先结算完再翻自身。 */
function* water0(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const targets = ctx.candidates({ zone: 'field' });
  const ans = yield { kind: 'select', title: 'water-0：翻转另1张牌', min: 1, max: 1, optional: false, candidates: targets };
  if (ans.selected.length > 0) yield { op: 'flip', uid: ans.selected[0] };
  yield { op: 'flip', uid: ctx.card.uid }; // 翻转此牌
}

/** water-1：在另两列各以反面打出你牌堆顶的牌（逐列顺序弹出当时牌堆顶；文本读法 = 每线一张牌堆顶） */
function* water1(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const srcLine = ctx.card.line!;
  for (const line of ([0, 1, 2] as Line[]).filter((l) => l !== srcLine)) {
    if (!deckTopAvailable(ctx.s, ctx.player)) break; // 牌库+弃牌堆皆空 → 剩余线 fizzle
    yield { op: 'playTopDeck', line, faceUp: false };
  }
}

/** water-2：抽2张牌，然后重排你的协议（选两个协议位置交换；defId 与 compiled 随位置整体移动） */
function* water2(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  yield { op: 'draw', count: 2 };
  const first = yield { kind: 'select-line', title: '重排协议：选择要交换的第1个位置', min: 1, max: 1, optional: false, candidates: [], lines: [0, 1, 2] };
  if (first.selected.length === 0) return;
  const a = Number(first.selected[0].replace('line:', '')) as Line;
  const second = yield { kind: 'select-line', title: '重排协议：选择要交换的第2个位置', min: 1, max: 1, optional: false, candidates: [], lines: ([0, 1, 2] as Line[]).filter((l) => l !== a) };
  if (second.selected.length === 0) return;
  const b = Number(second.selected[0].replace('line:', '')) as Line;
  yield { op: 'rearrangeProtocols', a, b };
}

/** water-3：回手此列所有2分的牌（此列 = 效果卡所在列；双方未覆盖顶卡，分值=2 含正面2分卡与反面卡）。
 *  逐张循环回手（每次回手后重新评估——"所有2分的牌"含逐层揭开后新露出的 2 分卡）；
 *  回持有者手牌（return op 按卡牌 owner 归位）。 */
function* water3(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const line = ctx.card.line!;
  for (;;) {
    let target: { uid: string } | undefined;
    for (const owner of [0, 1] as PlayerId[]) {
      const stack = ctx.s.players[owner].stacks[line];
      const top = stack[stack.length - 1];
      if (top && cardPointValue(ctx.s, top) === 2) { target = top; break; }
    }
    if (!target) return; // 无 2 分牌 → 结束
    yield { op: 'return', uid: target.uid };
  }
}

/** water-4：回手1张你的牌（自己的未覆盖场上卡） */
function* water4(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const targets = ctx.candidates({ zone: 'field', owner: ctx.player });
  const ans = yield { kind: 'select', title: 'water-4：回手1张你的牌', min: 1, max: 1, optional: false, candidates: targets };
  if (ans.selected.length === 0) return; // fizzle：无自己的未覆盖卡
  yield { op: 'return', uid: ans.selected[0] };
}

/** water-5：弃1张牌 */
function* water5(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const hand = ctx.candidates({ zone: 'hand', owner: ctx.player });
  const ans = yield { kind: 'select', title: 'water-5：弃1张牌', min: 1, max: 1, optional: false, candidates: hand };
  if (ans.selected.length === 0) return; // fizzle：无牌可弃
  yield { op: 'discard', uid: ans.selected[0] };
}

registerCardEffects('water-0', { middle: water0 });
registerCardEffects('water-1', { middle: water1 });
registerCardEffects('water-2', { middle: water2 });
registerCardEffects('water-3', { middle: water3 });
registerCardEffects('water-4', { middle: water4 });
registerCardEffects('water-5', { middle: water5 });
