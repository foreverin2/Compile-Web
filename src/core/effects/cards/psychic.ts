import type { EffectCtx, EffectStep, Line, PlayerId, StepResult } from '../../models/types';
import { registerCardEffects } from '../registry';
import { findCard } from '../context';

/** psychic-0 中指令：抽2张牌。对手弃2张牌，然后揭示其手牌。
 *  抽 2（pe.player = 效果属主）→ 对手弃 2：select（chooser: opp，候选=对手手牌；
 *  min = min(2, hand.length)——手牌不足 2 时尽力弃剩余（用户拍板「尽力而为」），手牌空 → 跳过）→
 *  discardMany 批量弃（FAQ 94：单次动作，after-discard 只触发一次；弃的是对手的卡，
 *  discardMany 按被弃卡 owner 弃）→ 揭示：循环对手【当前】手牌每张 reveal
 *  （Case B：揭示对手的卡 → 幽灵给自己（shownTo = 发起者），expiresAtTurn = turnCount + 3）。
 *  对手手牌空 → reveal 循环无目标自然结束。 */
function* psychic0(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const opp: PlayerId = ctx.player === 0 ? 1 : 0;
  yield { op: 'draw', count: 2 };
  const hand = ctx.candidates({ zone: 'hand', owner: opp });
  if (hand.length > 0) {
    const ans = yield { kind: 'select', title: 'psychic-0：对手弃2张牌', min: Math.min(2, hand.length), max: 2, optional: false, candidates: hand, chooser: opp };
    if (ans.selected.length > 0) yield { op: 'discardMany', uids: ans.selected };
  }
  for (const card of [...ctx.s.players[opp].hand]) yield { op: 'reveal', uid: card.uid };
}

/** psychic-1 底指令：开始：翻转此牌。
 *  bottom 触发（不注册 top 标志）：仅未覆盖顶卡生效（collectTriggers 被盖跳过）。
 *  顶「你的对手只能以反面打出牌」由 restrictions.opponentMustPlayFaceDown 接线（A2），
 *  此处不注册效果。翻转自己 → 翻回反面 → 顶命令失效（playerHasTopCommand 要求 faceUp）。 */
function* psychic1Start(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  yield { op: 'flip', uid: ctx.card.uid };
}

/** psychic-2 中指令：对手弃2张牌。你重排对手的协议。
 *  对手弃 2（chooser=opp，同 psychic-0 弃牌部分；min = min(2, hand.length) 尽力弃，手牌空跳过）→
 *  select-line 选位置 a（3 选 1）→ select-line 选位置 b（≠a）→
 *  { op:'rearrangeProtocols', a, b, player: opp }（交换【对手】的协议位，defId 与 compiled 随位置整体交换）。 */
function* psychic2(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const opp: PlayerId = ctx.player === 0 ? 1 : 0;
  const hand = ctx.candidates({ zone: 'hand', owner: opp });
  if (hand.length > 0) {
    const ans = yield { kind: 'select', title: 'psychic-2：对手弃2张牌', min: Math.min(2, hand.length), max: 2, optional: false, candidates: hand, chooser: opp };
    if (ans.selected.length > 0) yield { op: 'discardMany', uids: ans.selected };
  }
  const first = yield { kind: 'select-line', title: 'psychic-2：重排对手协议——选择第1个位置', min: 1, max: 1, optional: false, candidates: [], lines: [0, 1, 2] };
  if (first.selected.length === 0) return; // 守卫空应答
  const a = Number(first.selected[0].replace('line:', '')) as Line;
  const second = yield { kind: 'select-line', title: 'psychic-2：选择要交换的第2个位置', min: 1, max: 1, optional: false, candidates: [], lines: ([0, 1, 2] as Line[]).filter((l) => l !== a) };
  if (second.selected.length === 0) return;
  const b = Number(second.selected[0].replace('line:', '')) as Line;
  yield { op: 'rearrangeProtocols', a, b, player: opp };
}

/** psychic-3 中指令：对手弃1张牌。平移1张对手的牌。
 *  对手弃 1（chooser=opp，min1 max1；手牌空 → 跳过弃牌——拍板：弃牌 fizzle 只跳过弃牌，平移仍执行）
 *  → select 对手 field 顶卡 1 张（打出者选目标——chooser 缺省 = 效果属主）→
 *  select-line 任意线（排除被移卡当前线——shift op 约束）→ shift。无对手顶卡 → 选卡步 fizzle。 */
function* psychic3(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const opp: PlayerId = ctx.player === 0 ? 1 : 0;
  const hand = ctx.candidates({ zone: 'hand', owner: opp });
  if (hand.length >= 1) {
    const ans = yield { kind: 'select', title: 'psychic-3：对手弃1张牌', min: 1, max: 1, optional: false, candidates: hand, chooser: opp };
    if (ans.selected.length > 0) yield { op: 'discard', uid: ans.selected[0] };
  }
  const targets = ctx.candidates({ zone: 'field', owner: opp });
  const ans = yield { kind: 'select', title: 'psychic-3：平移1张对手的牌', min: 1, max: 1, optional: false, candidates: targets };
  if (ans.selected.length === 0) return; // fizzle：无对手场上顶卡
  const card = findCard(ctx.s, ans.selected[0]);
  if (!card || card.zone !== 'field' || card.line === null) return; // 防御：卡已离场
  const line = yield { kind: 'select-line', title: 'psychic-3：平移目标线', min: 1, max: 1, optional: false, candidates: [], lines: ([0, 1, 2] as Line[]).filter((l) => l !== card.line) };
  if (line.selected.length === 0) return;
  yield { op: 'shift', uid: card.uid, targetLine: Number(line.selected[0].replace('line:', '')) as Line };
}

/** psychic-4 底指令：结束：你可以回手1张对手的牌。若如此，翻转此牌。
 *  bottom 触发（不注册 top 标志）：仅未覆盖顶卡生效。可选 select 对手 field 顶卡 1 张
 *  （候选空 → fizzle 自动跳过）→ return（默认顶卡，无需 allowCovered）→ 若回手：
 *  { op:'flip', uid: ctx.card.uid } 翻转自己（翻回反面后底指令失效；翻正时无中指令）。 */
function* psychic4End(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const opp: PlayerId = ctx.player === 0 ? 1 : 0;
  const targets = ctx.candidates({ zone: 'field', owner: opp });
  const ans = yield { kind: 'select', title: 'psychic-4（结束）：你可以回手1张对手的牌', min: 1, max: 1, optional: true, candidates: targets };
  if (ans.selected.length === 0) return; // 可选：跳过
  yield { op: 'return', uid: ans.selected[0] };
  yield { op: 'flip', uid: ctx.card.uid };
}

/** psychic-5：弃1张牌 */
function* psychic5(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const hand = ctx.candidates({ zone: 'hand', owner: ctx.player });
  const ans = yield { kind: 'select', title: 'psychic-5：弃1张牌', min: 1, max: 1, optional: false, candidates: hand };
  if (ans.selected.length === 0) return; // fizzle：无牌可弃
  yield { op: 'discard', uid: ans.selected[0] };
}

registerCardEffects('psychic-0', { middle: psychic0 });
registerCardEffects('psychic-1', {
  triggers: {
    start: {
      fn: psychic1Start,
      optional: false, // 底命令：仅未覆盖顶卡生效（无 top 标志）
      // 不加 cond：恒有动作——「开始：翻转此牌」无条件翻自己（收集时必为场上未覆盖 faceUp 顶卡，
      // 翻转恒可行）；顶命令「对手只能反面打」由 restrictions.opponentMustPlayFaceDown 接线（A2），
      // 与 start 触发无关
    },
  },
});
registerCardEffects('psychic-2', { middle: psychic2 });
registerCardEffects('psychic-3', { middle: psychic3 });
registerCardEffects('psychic-4', {
  triggers: {
    end: {
      fn: psychic4End,
      optional: false, // 底命令：仅未覆盖顶卡生效（无 top 标志）
      // 自动判定：对手场上无顶卡可回手 → 「你可以回手」无对象、「若如此，翻转此牌」也随之跳过
      // → 效果整体无动作，收集前自动跳过不出按钮
      cond: (s, card) => {
        const foe: PlayerId = card.owner === 0 ? 1 : 0;
        return ([0, 1, 2] as Line[]).some((l) => s.players[foe].stacks[l].length > 0);
      },
    },
  },
});
registerCardEffects('psychic-5', { middle: psychic5 });
