import type { EffectCtx, EffectStep, PlayerId, StepResult } from '../../models/types';
import { registerCardEffects } from '../registry';
import { findCard, isUncovered } from '../context';

/** plague-0 中指令：对手弃1张牌。
 *  对手弃 1（chooser=opp，min1 max1；手牌空 → 跳过——FAQ 39 每句独立，弃牌 fizzle 不影响底命令）。
 *  底「对手无法在此列打出牌」由 restrictions.lineBlocksOpponent 接线（A2，getLegalActions +
 *  playCard 执行层守卫），此处不注册效果。 */
function* plague0(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const opp: PlayerId = ctx.player === 0 ? 1 : 0;
  const hand = ctx.candidates({ zone: 'hand', owner: opp });
  if (hand.length >= 1) {
    const ans = yield { kind: 'select', title: 'plague-0：对手弃1张牌', min: 1, max: 1, optional: false, candidates: hand, chooser: opp };
    if (ans.selected.length > 0) yield { op: 'discard', uid: ans.selected[0] };
  }
}

/** plague-1 顶指令：对手弃牌后：你抽1张牌。
 *  after-discard 即时连锁（fireReactive 自动收集弃牌者【对手】场上全部正面注册卡——
 *  含系统缓存弃牌，用户拍板）。top: true —— 顶命令被盖仍生效（fireReactive 推入的效果
 *  恒带 topCommand → sourceValid 跳过未覆盖检查）。 */
function* plague1AfterDiscard(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  yield { op: 'draw', count: 1 };
}

/** plague-1 中指令：对手弃1张牌。（同 plague-0 中；对手弃牌会即时触发自己顶命令的 after-discard 连锁） */
function* plague1Middle(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const opp: PlayerId = ctx.player === 0 ? 1 : 0;
  const hand = ctx.candidates({ zone: 'hand', owner: opp });
  if (hand.length >= 1) {
    const ans = yield { kind: 'select', title: 'plague-1：对手弃1张牌', min: 1, max: 1, optional: false, candidates: hand, chooser: opp };
    if (ans.selected.length > 0) yield { op: 'discard', uid: ans.selected[0] };
  }
}

/** plague-2 中指令：弃1张或更多张牌。对手也弃牌，数量等于你的弃牌数+1。
 *  自己弃 1+：select 自己手牌 min1 max=hand.length（手牌空 → 跳过，N=0 → 对手仍弃 0+1=1 张
 *  ——FAQ 39 每句独立）→ N=selected.length → 对手弃 N+1：
 *  min = min(N+1, 对手手牌数)（用户拍板尽力而为：手牌不足 N+1 弃全部剩余；手牌空 → 跳过）。
 *  两批都用 discardMany（FAQ 94：多张弃牌是单次动作，after-discard 只触发一次）；
 *  对手那批 chooser=opp（选择权归被作用方）。 */
function* plague2(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const opp: PlayerId = ctx.player === 0 ? 1 : 0;
  const ownHand = ctx.candidates({ zone: 'hand', owner: ctx.player });
  let n = 0;
  if (ownHand.length > 0) {
    const mine = yield { kind: 'select', title: 'plague-2：弃1张或更多张牌', min: 1, max: ownHand.length, optional: false, candidates: ownHand };
    if (mine.selected.length > 0) {
      n = mine.selected.length;
      yield { op: 'discardMany', uids: mine.selected };
    }
  }
  const oppHand = ctx.candidates({ zone: 'hand', owner: opp });
  if (oppHand.length > 0) {
    const need = n + 1;
    const ans = yield { kind: 'select', title: `plague-2：对手弃${need}张牌`, min: Math.min(need, oppHand.length), max: need, optional: false, candidates: oppHand, chooser: opp };
    if (ans.selected.length > 0) yield { op: 'discardMany', uids: ans.selected };
  }
}

/** plague-3 中指令：翻转其他所有未被盖住的正面牌。
 *  候选 = 全场双方 field **顶卡**（zone:'field' 候选即未覆盖顶卡，listCandidates 已排除结算中
 *  源卡=自己）中 faceUp && uid !== 自己 → 快照后逐张 {op:'flip'}（FAQ 157：先标记再逐张处理，
 *  每张翻转后处理后果再下一张——生成器 yield 之间引擎自动结算连锁）。空 → fizzle（无 yield）。
 *  防御：逐张前复查卡仍在场、仍正面、仍未被覆盖（连锁中可能被移除/盖住——被盖即不再满足
 *  「未被盖住」，按卡面文本跳过）。 */
function* plague3(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const targets = ctx.candidates({ zone: 'field' }).filter((c) => c.faceUp && c.uid !== ctx.card.uid);
  for (const t of targets) {
    const card = findCard(ctx.s, t.uid);
    if (!card || !card.faceUp || !isUncovered(ctx.s, card)) continue;
    yield { op: 'flip', uid: t.uid };
  }
}

/** plague-4 底指令：结束：对手删除1张对手的反面牌。你可以翻转这张牌。
 *  bottom 触发（不注册 top 标志）：仅未覆盖顶卡生效（collectTriggers 被盖跳过）。
 *  两句话独立（**用户拍板按 FAQ 40**）：对手无反面顶卡 → 跳过删除句，「你可以翻转此牌」仍可选。
 *  对手删自己的反面牌：select（chooser=opp，候选=对手 field 顶卡中 !faceUp，min1 max1）→
 *  {op:'delete', uid} → 「你可以翻转这张牌」= 翻 plague-4 自己：select-action
 *  ['action:flip','action:skip'] 二选一（optional:false min1 max1——"你可以"= 可选，
 *  用显式二选一让持有者决定翻/不翻，比空应答跳过更清晰）。 */
function* plague4End(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const opp: PlayerId = ctx.player === 0 ? 1 : 0;
  const targets = ctx.candidates({ zone: 'field', owner: opp }).filter((c) => !c.faceUp);
  if (targets.length > 0) {
    // 删除句（chooser=opp）：有反面顶卡才执行；删除后连锁可能移走/翻面自己——翻自己前防御复查
    const ans = yield { kind: 'select', title: 'plague-4（结束）：对手删除1张对手的反面牌', min: 1, max: 1, optional: false, candidates: targets, chooser: opp };
    if (ans.selected.length > 0) yield { op: 'delete', uid: ans.selected[0] };
  }
  // 翻自己句独立（FAQ 40）：删除句 fizzle 不影响此句；自己已被连锁移走/翻面 → 跳过
  const self = findCard(ctx.s, ctx.card.uid);
  if (!self || self.zone !== 'field') return;
  const act = yield { kind: 'select-action', title: 'plague-4（结束）：你可以翻转此牌', min: 1, max: 1, optional: false, candidates: [], actions: ['action:flip', 'action:skip'] };
  if (act.selected.length === 0) return; // 兜底
  if (act.selected[0] === 'action:flip') yield { op: 'flip', uid: ctx.card.uid };
}

/** plague-5：弃1张牌 */
function* plague5(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const hand = ctx.candidates({ zone: 'hand', owner: ctx.player });
  const ans = yield { kind: 'select', title: 'plague-5：弃1张牌', min: 1, max: 1, optional: false, candidates: hand };
  if (ans.selected.length === 0) return; // fizzle：无牌可弃
  yield { op: 'discard', uid: ans.selected[0] };
}

registerCardEffects('plague-0', { middle: plague0 });
registerCardEffects('plague-1', {
  middle: plague1Middle,
  triggers: { 'after-discard': { fn: plague1AfterDiscard, optional: false, top: true } }, // 顶命令：被盖仍生效
});
registerCardEffects('plague-2', { middle: plague2 });
registerCardEffects('plague-3', { middle: plague3 });
registerCardEffects('plague-4', {
  triggers: {
    end: {
      fn: plague4End,
      optional: false, // 底命令：仅未覆盖顶卡生效（无 top 标志）
      // 不加 cond：恒有动作——删除句（对手无反面顶卡时跳过，FAQ 40）不影响独立句
      // 「你可以翻转这张牌」：flip/skip 二选一在收集时点（己方场未覆盖正面卡）恒可执行
    },
  },
});
registerCardEffects('plague-5', { middle: plague5 });
