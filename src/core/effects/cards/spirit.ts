import type { EffectCtx, EffectStep, Line, StepResult } from '../../models/types';
import { registerCardEffects } from '../registry';
import { fireRefreshReactives } from '../triggers';
import { canRefreshDraw } from '../../engine/deck';
import { controlRearrangeFlow } from '../control-rearrange-flow';

/** spirit-0 中指令：刷新。抽1张牌。
 *  刷新 = 完整刷新操作（FAQ 161：含消耗控制组件——执行者持有则归还中立，并可在补满前
 *  选择重排任意一方协议：controlRearrangeFlow），然后抽至 5 张，再额外抽 1 张。
 *  修改提示词 19：刷新抽不了牌（手牌≥5 / ice-6 禁抽 / 无牌）→ 刷新无效：不耗控制权、不重排、
 *  不发刷新连锁（额外「抽1张牌」句照常尝试——ice-6 禁抽时 draw 自然为空）。
 *  两次 draw 分开 yield（各自触发 after-draw 即时连锁——刷新与抽 1 是两次独立抽牌事件）。 */
function* spirit0(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  if (canRefreshDraw(ctx.s, ctx.player)) {
    yield* controlRearrangeFlow(ctx.s, ctx.player, 'spirit-0 刷新');
    const need = 5 - ctx.s.players[ctx.player].hand.length;
    if (need > 0) yield { op: 'draw', count: need };
    fireRefreshReactives(ctx.s, ctx.player); // 批2：刷新动作完成连锁（war-0/1）
  }
  yield { op: 'draw', count: 1 };
}

/** spirit-1 中指令：抽2张牌。 */
function* spirit1Middle(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  yield { op: 'draw', count: 2 };
}

/** spirit-1 底指令：开始：要么弃1张牌，要么翻转此牌。
 *  bottom 触发（不注册 top 标志）：仅未覆盖顶卡生效（规则 79 行；被盖的 spirit-1 在 start
 *  收集时被 collectTriggers 跳过）。select-action 二选一（min1 max1 非可选）→
 *  弃：选 1 张手牌 discard（无牌可弃 → 该步 fizzle）；翻：翻转自身（此时必为未覆盖顶卡，无需 allowCovered）。 */
function* spirit1Start(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const act = yield { kind: 'select-action', title: 'spirit-1（开始）：要么弃1张牌，要么翻转此牌', min: 1, max: 1, optional: false, candidates: [], actions: ['action:discard', 'action:flip'] };
  if (act.selected.length === 0) return; // fizzle 兜底
  if (act.selected[0] === 'action:discard') {
    const hand = ctx.candidates({ zone: 'hand', owner: ctx.player });
    const ans = yield { kind: 'select', title: 'spirit-1（开始）：弃1张牌', min: 1, max: 1, optional: false, candidates: hand };
    if (ans.selected.length === 0) return; // fizzle：无牌可弃
    yield { op: 'discard', uid: ans.selected[0] };
  } else {
    yield { op: 'flip', uid: ctx.card.uid };
  }
}

/** spirit-2 中指令：你可以翻转1张牌。—— 可选：选 1 张场上未覆盖顶卡（双方）翻转；跳过则无事发生 */
function* spirit2(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const targets = ctx.candidates({ zone: 'field' });
  const ans = yield { kind: 'select', title: 'spirit-2：你可以翻转1张牌', min: 1, max: 1, optional: true, candidates: targets };
  if (ans.selected.length > 0) yield { op: 'flip', uid: ans.selected[0] };
}

/** spirit-3 顶指令：你抽牌后：你可以平移此牌，不论是否被盖住。
 *  top: true —— 顶命令被盖仍生效（fireReactive 自动收集抽牌者场上全部正面注册卡，含被盖；
 *  且其推入的效果恒带 topCommand → sourceValid 跳过未覆盖检查）。
 *  可选 select-line（排除当前线）→ 平移自己（allowCovered：被盖平移需跳过未覆盖检查）。 */
function* spirit3AfterDraw(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const line = yield { kind: 'select-line', title: 'spirit-3（你抽牌后）：你可以平移此牌到另一列', min: 1, max: 1, optional: true, candidates: [], lines: ([0, 1, 2] as Line[]).filter((l) => l !== ctx.card.line) };
  if (line.selected.length === 0) return; // 守卫空应答（跳过）
  yield { op: 'shift', uid: ctx.card.uid, targetLine: Number(line.selected[0].replace('line:', '')) as Line, allowCovered: true };
}

/** spirit-4 中指令：交换你2个协议卡的位置。—— 选位置 a（3 选 1）→ 选位置 b（≠a）→ rearrangeProtocols
 *  （player 缺省 = 效果属主；defId 与 compiled 状态随位置整体交换） */
function* spirit4(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const first = yield { kind: 'select-line', title: 'spirit-4：交换协议位置——选择第1个位置', min: 1, max: 1, optional: false, candidates: [], lines: [0, 1, 2] };
  if (first.selected.length === 0) return;
  const a = Number(first.selected[0].replace('line:', '')) as Line;
  const second = yield { kind: 'select-line', title: 'spirit-4：选择要交换的第2个位置', min: 1, max: 1, optional: false, candidates: [], lines: ([0, 1, 2] as Line[]).filter((l) => l !== a) };
  if (second.selected.length === 0) return;
  const b = Number(second.selected[0].replace('line:', '')) as Line;
  yield { op: 'rearrangeProtocols', a, b };
}

/** spirit-5：弃1张牌 */
function* spirit5(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const hand = ctx.candidates({ zone: 'hand', owner: ctx.player });
  const ans = yield { kind: 'select', title: 'spirit-5：弃1张牌', min: 1, max: 1, optional: false, candidates: hand };
  if (ans.selected.length === 0) return; // fizzle：无牌可弃
  yield { op: 'discard', uid: ans.selected[0] };
}

registerCardEffects('spirit-0', { middle: spirit0 });
registerCardEffects('spirit-1', {
  middle: spirit1Middle,
  triggers: { start: { fn: spirit1Start, optional: false } }, // 底命令：仅未覆盖顶卡生效（无 top 标志）
});
registerCardEffects('spirit-2', { middle: spirit2 });
registerCardEffects('spirit-3', {
  triggers: { 'after-draw': { fn: spirit3AfterDraw, optional: true, top: true } }, // 顶命令：被盖仍生效
});
registerCardEffects('spirit-4', { middle: spirit4 });
registerCardEffects('spirit-5', { middle: spirit5 });
