import type { EffectCtx, EffectStep, GameState, Line, PlayerId, StepResult } from '../../models/types';
import { registerCardEffects } from '../registry';
import { findCard } from '../context';

/** 该线【双方堆叠】全部反面牌数（含被盖——「此列」=整条线双方，口径同 gravity-0/darkness-2） */
function countFaceDownInLine(s: GameState, line: Line): number {
  let count = 0;
  for (const owner of [0, 1] as PlayerId[]) {
    for (const card of s.players[owner].stacks[line]) {
      if (!card.faceUp) count++;
    }
  }
  return count;
}

/** apathy-0 顶指令数值修正：此列每张反面牌给你此列总分加1。
 *  target 'own-stack'：只作用于拥有者总值（stackValue 已 gate faceUp——正面即生效含被盖；
 *  每张正面 apathy-0 各自加 countFaceDownInLine——顶命令按卡计，不做每线去重）。 */
function apathy0ValueModifier(s: GameState, _owner: PlayerId, line: Line, total: number): number {
  return total + countFaceDownInLine(s, line);
}

/** apathy-1 中指令：翻转此列所有其他正面牌。
 *  「此列」= apathy-1 所在列（**用户拍板：双方堆叠**——与 apathy-0/gravity-0/darkness-2 惯例及
 *  参考实现 owner:any 一致）；「其他」排除自己；「所有」= 该列双方堆叠全部 faceUp 卡（含被盖）。
 *  快照 uid 后逐个 {op:'flip', allowCovered}（FAQ 116/157：先标记再逐张处理，每张翻转后处理后果
 *  再下一张——逐张前复查卡仍在场，连锁可能已移走/删除）。空 → 无 yield 天然 fizzle。 */
function* apathy1(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const line = ctx.card.line!;
  const targets: string[] = [];
  for (const pid of [ctx.player, ctx.player === 0 ? 1 : 0] as PlayerId[]) {
    for (const c of ctx.s.players[pid].stacks[line]) {
      if (c.uid !== ctx.card.uid && c.faceUp) targets.push(c.uid);
    }
  }
  for (const uid of targets) {
    const card = findCard(ctx.s, uid);
    if (!card || card.zone !== 'field') continue; // 连锁中已被移走/删除 → 跳过
    yield { op: 'flip', uid, allowCovered: true };
  }
}

/** apathy-2 底指令：被盖住前：先翻转此牌。
 *  before-covered 触发（此时本卡必为顶卡未覆盖，plain flip 足够；翻转自己 → 反面）。
 *  不注册 top 标志——before-covered 只查顶卡；翻成反面后其顶命令（无效化中指令）随即失效，
 *  落地卡的中指令正常结算（apathy-2 无 middle，翻转连锁无害）。 */
function* apathy2BeforeCovered(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  yield { op: 'flip', uid: ctx.card.uid };
}

/** apathy-3 中指令：翻转1张对手的正面牌。
 *  select 对手 field 顶卡中 faceUp 的 1 张（被盖卡不在候选——listCandidates 只列顶卡）→ flip。
 *  空 → fizzle。 */
function* apathy3(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const opp: PlayerId = ctx.player === 0 ? 1 : 0;
  const targets = ctx.candidates({ zone: 'field', owner: opp }).filter((c) => c.faceUp);
  const ans = yield { kind: 'select', title: 'apathy-3：翻转1张对手的正面牌', min: 1, max: 1, optional: false, candidates: targets };
  if (ans.selected.length === 0) return; // fizzle：对手无正面顶卡
  yield { op: 'flip', uid: ans.selected[0] };
}

/** apathy-4 中指令：你可以翻转1张你的被盖住的正面牌。
 *  可选：候选 = 自己【被盖】（covered:true 列非顶卡）且 faceUp 的卡（任意线）→ flip allowCovered。
 *  空 → fizzle（可选自动跳过）。 */
function* apathy4(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const targets = ctx.candidates({ zone: 'field', owner: ctx.player, covered: true }).filter((c) => c.faceUp);
  const ans = yield { kind: 'select', title: 'apathy-4：你可以翻转1张你的被盖住的正面牌', min: 1, max: 1, optional: true, candidates: targets };
  if (ans.selected.length === 0) return; // 可选：跳过（无目标时 fizzle 自动跳过）
  yield { op: 'flip', uid: ans.selected[0], allowCovered: true };
}

/** apathy-5 中指令：弃1张牌 */
function* apathy5(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const hand = ctx.candidates({ zone: 'hand', owner: ctx.player });
  const ans = yield { kind: 'select', title: 'apathy-5：弃1张牌', min: 1, max: 1, optional: false, candidates: hand };
  if (ans.selected.length === 0) return; // fizzle：无牌可弃
  yield { op: 'discard', uid: ans.selected[0] };
}

registerCardEffects('apathy-0', {
  valueModifier: { target: 'own-stack', apply: apathy0ValueModifier },
});
registerCardEffects('apathy-1', { middle: apathy1 });
// apathy-2 顶「无效化此列所有牌的中部命令」：A2 lineMiddleCommandsNullified 已接线
// （pushMiddle 查 EFFECTS 前早退；该线双方全部牌含被盖——见 restrictions.ts），不注册效果
registerCardEffects('apathy-2', {
  triggers: { 'before-covered': { fn: apathy2BeforeCovered, optional: false } }, // 底命令：仅未覆盖顶卡触发
});
registerCardEffects('apathy-3', { middle: apathy3 });
registerCardEffects('apathy-4', { middle: apathy4 });
registerCardEffects('apathy-5', { middle: apathy5 });
