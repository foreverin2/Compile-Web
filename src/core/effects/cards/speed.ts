import type { EffectCtx, EffectStep, Line, PlayerId, StepResult } from '../../models/types';
import { registerCardEffects } from '../registry';
import { findCard, isUncovered } from '../context';
import { getCardDef } from '../../../data/demo';
import { isPlayableFaceUp } from '../../actions/base';

/** speed-0 中指令：打出1张牌。
 *  select 自己手牌 1 张（空 → fizzle）→ select-action 正/反面 → 正面：select-line 仅限匹配协议线
 *  （isPlayableFaceUp：卡协议 == 己方或对方该线协议；spirit-1「任意列」优先）→ 反面：任意线 →
 *  {op:'playFromHand'}。效果授予的打出不走 playCard → 不受 A2 限制（plague-0/psychic-1/metal-2）
 *  约束——卡牌文本优先。选线守卫空应答。 */
function* speed0(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const hand = ctx.candidates({ zone: 'hand', owner: ctx.player });
  const ans = yield { kind: 'select', title: 'speed-0：打出1张牌', min: 1, max: 1, optional: false, candidates: hand };
  if (ans.selected.length === 0) return; // fizzle：手牌空
  const uid = ans.selected[0];
  const act = yield {
    kind: 'select-action',
    title: 'speed-0：以正面还是反面打出',
    min: 1,
    max: 1,
    optional: false,
    candidates: [],
    actions: ['action:face-up', 'action:face-down'],
  };
  if (act.selected.length === 0) return; // 守卫空应答
  const faceUp = act.selected[0] === 'action:face-up';
  const lines = faceUp
    ? ([0, 1, 2] as Line[]).filter((l) => isPlayableFaceUp(ctx.s, ctx.player, uid, l))
    : ([0, 1, 2] as Line[]);
  const line = yield {
    kind: 'select-line',
    title: 'speed-0：选择要打出的列',
    min: 1,
    max: 1,
    optional: false,
    candidates: [],
    lines,
  };
  if (line.selected.length === 0) return; // fizzle：正面无匹配线
  yield { op: 'playFromHand', uid, line: Number(line.selected[0].replace('line:', '')) as Line, faceUp };
}

/** speed-1 顶指令：清理缓存后：抽1张牌。
 *  注册 triggers['after-clear-cache']——fireReactive 自动收集（系统缓存清理完成后触发：含玩家
 *  自选弃牌与防御路径）；top: true——顶命令被盖仍生效（fireReactive 推入的效果恒带 topCommand）。 */
function* speed1AfterClearCache(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  yield { op: 'draw', count: 1 };
}

/** speed-1 中指令：抽2张牌。 */
function* speed1Middle(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  yield { op: 'draw', count: 2 };
}

/** speed-2 顶指令：通过编译删除此牌前：平移此牌，不论是否被盖住。
 *  由 A1 的 executeCompileUnchecked 收集驱动（该线双方正面 speed-2 → 设 pendingCompile →
 *  resolveTrigger 已传 topCommand → runStack 挂起选线 → 应答 → shift allowCovered 落地 →
 *  runStack 消费 pendingCompile 执行编译本体）。持有者决定选线（resolveTrigger player=card.owner）。
 *  select-line 排除当前线；守卫空应答。 */
function* speed2BeforeCompile(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const line = yield {
    kind: 'select-line',
    title: 'speed-2（编译前）：平移此牌到另一列',
    min: 1,
    max: 1,
    optional: false,
    candidates: [],
    lines: ([0, 1, 2] as Line[]).filter((l) => l !== ctx.card.line),
  };
  if (line.selected.length === 0) return; // 守卫空应答
  yield { op: 'shift', uid: ctx.card.uid, targetLine: Number(line.selected[0].replace('line:', '')) as Line, allowCovered: true };
}

/** speed-3 中指令：平移另1张你的牌。—— 选自己 field 顶卡 1 张（排除自己——「另1张」；
 *  listCandidates 已排除结算中源卡，显式过滤兜底）→ select-line（排除被移卡当前线）→ shift。 */
function* speed3Middle(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const targets = ctx.candidates({ zone: 'field', owner: ctx.player }).filter((c) => c.uid !== ctx.card.uid);
  const ans = yield { kind: 'select', title: 'speed-3：平移另1张你的牌', min: 1, max: 1, optional: false, candidates: targets };
  if (ans.selected.length === 0) return; // fizzle：无其他自己的顶卡
  const uid = ans.selected[0];
  const target = findCard(ctx.s, uid);
  const line = yield {
    kind: 'select-line',
    title: 'speed-3：选择目标列',
    min: 1,
    max: 1,
    optional: false,
    candidates: [],
    lines: ([0, 1, 2] as Line[]).filter((l) => l !== target?.line),
  };
  if (line.selected.length === 0) return; // 守卫空应答
  yield { op: 'shift', uid, targetLine: Number(line.selected[0].replace('line:', '')) as Line };
}

/** speed-3 底指令：结束：你可以平移1张你的牌。若如此，翻转此牌。
 *  bottom 触发（不注册 top 标志）：仅未覆盖顶卡生效（collectTriggers 被盖跳过）。
 *  「1张你的牌」任意——含自己（源卡被候选机制排除，手动加回）。若平移：翻自己；平移后
 *  复查自己仍未被覆盖（把另一张牌平移到自己所在列会盖住自己 → 被盖卡不可翻转，物理规则 → 翻转跳过）。 */
function* speed3End(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const targets = ctx.candidates({ zone: 'field', owner: ctx.player });
  const self = findCard(ctx.s, ctx.card.uid);
  if (self && self.zone === 'field' && !targets.some((t) => t.uid === self.uid)) {
    targets.push({
      uid: self.uid,
      defId: self.defId,
      faceUp: self.faceUp,
      owner: self.owner,
      zone: self.zone,
      line: self.line,
      pos: self.pos,
      label: String(getCardDef(self.defId).value),
    });
  }
  const ans = yield {
    kind: 'select',
    title: 'speed-3（结束）：你可以平移1张你的牌',
    min: 1,
    max: 1,
    optional: true,
    candidates: targets,
  };
  if (ans.selected.length === 0) return; // 跳过（可选）
  const uid = ans.selected[0];
  const target = findCard(ctx.s, uid);
  const line = yield {
    kind: 'select-line',
    title: 'speed-3（结束）：选择目标列',
    min: 1,
    max: 1,
    optional: false,
    candidates: [],
    lines: ([0, 1, 2] as Line[]).filter((l) => l !== target?.line),
  };
  if (line.selected.length === 0) return; // 守卫空应答
  yield { op: 'shift', uid, targetLine: Number(line.selected[0].replace('line:', '')) as Line };
  const after = findCard(ctx.s, ctx.card.uid);
  if (after && after.zone === 'field' && isUncovered(ctx.s, after)) {
    yield { op: 'flip', uid: ctx.card.uid }; // 若如此，翻转此牌
  }
}

/** speed-4 中指令：平移1张对手的反面牌。—— 选对手 field 顶卡中 !faceUp 的 1 张（空 → fizzle）→
 *  select-line（排除被移卡当前线）→ shift。 */
function* speed4(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const opp: PlayerId = ctx.player === 0 ? 1 : 0;
  const targets = ctx.candidates({ zone: 'field', owner: opp }).filter((c) => !c.faceUp);
  const ans = yield { kind: 'select', title: 'speed-4：平移1张对手的反面牌', min: 1, max: 1, optional: false, candidates: targets };
  if (ans.selected.length === 0) return; // fizzle：对手无反面顶卡
  const uid = ans.selected[0];
  const target = findCard(ctx.s, uid);
  const line = yield {
    kind: 'select-line',
    title: 'speed-4：选择目标列',
    min: 1,
    max: 1,
    optional: false,
    candidates: [],
    lines: ([0, 1, 2] as Line[]).filter((l) => l !== target?.line),
  };
  if (line.selected.length === 0) return; // 守卫空应答
  yield { op: 'shift', uid, targetLine: Number(line.selected[0].replace('line:', '')) as Line };
}

/** speed-5 中指令：弃1张牌 */
function* speed5(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const hand = ctx.candidates({ zone: 'hand', owner: ctx.player });
  const ans = yield { kind: 'select', title: 'speed-5：弃1张牌', min: 1, max: 1, optional: false, candidates: hand };
  if (ans.selected.length === 0) return; // fizzle：无牌可弃
  yield { op: 'discard', uid: ans.selected[0] };
}

registerCardEffects('speed-0', { middle: speed0 });
registerCardEffects('speed-1', {
  middle: speed1Middle,
  triggers: { 'after-clear-cache': { fn: speed1AfterClearCache, optional: false, top: true } }, // 顶命令：被盖仍生效
});
registerCardEffects('speed-2', {
  triggers: { 'before-compile': { fn: speed2BeforeCompile, optional: false, top: true } }, // 顶命令：被盖仍生效（编译收集已按 faceUp 过滤）
});
registerCardEffects('speed-3', {
  middle: speed3Middle,
  triggers: {
    end: {
      fn: speed3End,
      optional: false, // 底命令：仅未覆盖顶卡生效（无 top 标志）
      // 不加 cond：恒有动作——「1张你的牌」含自己（源卡被候选排除后手动加回，txt 无「其它」），
      // 收集时点（己方场未覆盖正面卡）候选必非空，可选平移恒有对象
    },
  },
});
registerCardEffects('speed-4', { middle: speed4 });
registerCardEffects('speed-5', { middle: speed5 });
