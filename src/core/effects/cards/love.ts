import type { EffectCtx, EffectStep, PlayerId, StepResult } from '../../models/types';
import { registerCardEffects } from '../registry';
import { resetControlIfHeld } from '../../rules/control';
import { fireRefreshReactives } from '../triggers';

/** love-1 中指令：抽对手牌堆顶的牌。
 *  {op:'draw', count:1, fromOpponentDeck:true}——对手牌库空 → 洗对手弃牌堆重组再抽（用户拍板，
 *  与 drawCards 一致）；对手牌库+弃牌堆皆空 → fizzle 守卫（draw op 会抛错，此处提前返回）。 */
function* love1Middle(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const opp: PlayerId = ctx.player === 0 ? 1 : 0;
  const os = ctx.s.players[opp];
  if (os.deck.length === 0 && os.trash.length === 0) return; // fizzle：对手牌库+弃牌堆皆空
  yield { op: 'draw', count: 1, fromOpponentDeck: true };
}

/** love-1 底指令：结束：你可以把1张手牌给对手。若如此，抽2张牌。
 *  bottom 触发（不注册 top 标志）：仅未覆盖顶卡生效（collectTriggers 被盖跳过）。
 *  可选 select 自己手牌 1 张（手牌空 → fizzle 自动跳过）→ {op:'give', uid, to: opp}
 *  → 若给了：{op:'draw', count:2}（draw 缺省 player = 效果属主）。 */
function* love1End(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const opp: PlayerId = ctx.player === 0 ? 1 : 0;
  const hand = ctx.candidates({ zone: 'hand', owner: ctx.player });
  const ans = yield { kind: 'select', title: 'love-1（结束）：你可以把1张手牌给对手', min: 1, max: 1, optional: true, candidates: hand };
  if (ans.selected.length === 0) return; // 可选：跳过
  yield { op: 'give', uid: ans.selected[0], to: opp };
  yield { op: 'draw', count: 2 };
}

/** love-2 中指令：对手抽1张牌。刷新。
 *  刷新 = 完整刷新操作（FAQ 161 拍板：含消耗控制组件——持有者执行刷新控制回中立）：
 *  先 resetControlIfHeld，再抽至 5 张（need = 5 - hand.length，need > 0 才抽）。
 *  控制组件协议重排 UI 为已知缺口，不实现。 */
function* love2(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const opp: PlayerId = ctx.player === 0 ? 1 : 0;
  yield { op: 'draw', count: 1, player: opp };
  resetControlIfHeld(ctx.s, ctx.player);
  const need = 5 - ctx.s.players[ctx.player].hand.length;
  if (need > 0) yield { op: 'draw', count: need };
  fireRefreshReactives(ctx.s, ctx.player); // 批2：刷新动作完成连锁（war-0/1）
}

/** love-3 中指令：随机拿走1张对手的手牌。你把1张手牌给对手。
 *  对手手牌空 → take 步骤 fizzle（用户拍板：不触发）；否则 {op:'takeRandom', from: opp}
 *  （真随机 Math.random，owner 变更到效果属主）。give 照常（用户拍板：take fizzle 不影响 give）：
 *  select 自己手牌 1 张（自己手牌空 → give fizzle）→ {op:'give', uid, to: opp}。 */
function* love3(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const opp: PlayerId = ctx.player === 0 ? 1 : 0;
  if (ctx.candidates({ zone: 'hand', owner: opp }).length >= 1) {
    yield { op: 'takeRandom', from: opp };
  }
  const hand = ctx.candidates({ zone: 'hand', owner: ctx.player });
  const ans = yield { kind: 'select', title: 'love-3：你把1张手牌给对手', min: 1, max: 1, optional: false, candidates: hand };
  if (ans.selected.length === 0) return; // fizzle：自己无牌可给
  yield { op: 'give', uid: ans.selected[0], to: opp };
}

/** love-4 中指令：揭示1张你的手牌。翻转1张牌。
 *  select 自己手牌 1 张 → {op:'reveal', uid}（Case A：揭示自己的卡 → 幽灵给对手，
 *  expiresAtTurn = turnCount + 2；手牌空 → 该句 fizzle，翻转仍执行——FAQ 39 每句独立）
 *  → select field 顶卡 1 张 → flip。 */
function* love4(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const hand = ctx.candidates({ zone: 'hand', owner: ctx.player });
  if (hand.length >= 1) {
    const ans = yield { kind: 'select', title: 'love-4：揭示1张你的手牌', min: 1, max: 1, optional: false, candidates: hand };
    if (ans.selected.length > 0) yield { op: 'reveal', uid: ans.selected[0] };
  }
  const targets = ctx.candidates({ zone: 'field' });
  const ans = yield { kind: 'select', title: 'love-4：翻转1张牌', min: 1, max: 1, optional: false, candidates: targets };
  if (ans.selected.length === 0) return; // fizzle：无场上顶卡
  yield { op: 'flip', uid: ans.selected[0] };
}

/** love-5：弃1张牌 */
function* love5(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const hand = ctx.candidates({ zone: 'hand', owner: ctx.player });
  const ans = yield { kind: 'select', title: 'love-5：弃1张牌', min: 1, max: 1, optional: false, candidates: hand };
  if (ans.selected.length === 0) return; // fizzle：无牌可弃
  yield { op: 'discard', uid: ans.selected[0] };
}

/** love-6 中指令：对手抽2张牌。 */
function* love6(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const opp: PlayerId = ctx.player === 0 ? 1 : 0;
  yield { op: 'draw', count: 2, player: opp };
}

registerCardEffects('love-1', {
  middle: love1Middle,
  triggers: { end: { fn: love1End, optional: false } }, // 底命令：仅未覆盖顶卡生效（无 top 标志）
});
registerCardEffects('love-2', { middle: love2 });
registerCardEffects('love-3', { middle: love3 });
registerCardEffects('love-4', { middle: love4 });
registerCardEffects('love-5', { middle: love5 });
registerCardEffects('love-6', { middle: love6 });
