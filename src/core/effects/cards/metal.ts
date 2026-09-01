import type { EffectCtx, EffectStep, GameState, Line, PlayerId, StepResult } from '../../models/types';
import { registerCardEffects } from '../registry';
import { findCard } from '../context';

/** metal-0 顶命令数值修正：对手此列的总分减2。
 *  target 'opponent-line'：只作用于对手同线总值（stackValue 已 gate faceUp——正面即生效含被盖；
 *  每张正面 metal-0 各自减 2——顶命令按卡计，不做每线去重）。apply 的 owner 参数 = 修正卡持有者。 */
function metal0ValueModifier(_s: GameState, _owner: PlayerId, _line: Line, total: number): number {
  return total - 2;
}

/** metal-0 中指令：翻转1张牌。—— 选 1 张场上未覆盖顶卡（双方，源卡被候选排除）翻转。 */
function* metal0Middle(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const targets = ctx.candidates({ zone: 'field' });
  const ans = yield { kind: 'select', title: 'metal-0：翻转1张牌', min: 1, max: 1, optional: false, candidates: targets };
  if (ans.selected.length === 0) return; // fizzle：无其他场上顶卡
  yield { op: 'flip', uid: ans.selected[0] };
}

/** metal-1 中指令：抽2张牌。对手下回合不能编译。
 *  compileBlocked 直接改状态（A2 接线：canCompileLine/getCompilableLines/executeAction 已守卫；
 *  turn.ts 在被禁玩家回合结束转换 end→start 时清除——只禁一回合）。 */
function* metal1(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  yield { op: 'draw', count: 2 };
  ctx.s.compileBlocked = ctx.player === 0 ? 1 : 0;
}

/** metal-3 中指令：抽1张牌。删除有至少8张牌的另一列里的所有牌。
 *  符合条件的列 = 排除当前列后、该列双方堆叠合计 ≥ 8 张的列（数牌数，非分值；正反都算）。
 *  恰好 1 列 → 直接删；>1 列 → select-line 选一；无 → fizzle（抽牌已结算，删除跳过）。
 *  删除：快照该列双方全部卡（含被盖——「所有」）逐张 {op:'delete', allowCovered}；
 *  逐张前复查卡仍在场（连锁可能已移走/删除）。源卡在线外，永不会被删到自己。 */
function* metal3(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  yield { op: 'draw', count: 1 };
  const srcLine = ctx.card.line!;
  const qualifying = ([0, 1, 2] as Line[]).filter(
    (l) =>
      l !== srcLine &&
      ctx.s.players[0].stacks[l].length + ctx.s.players[1].stacks[l].length >= 8,
  );
  if (qualifying.length === 0) return; // fizzle：无符合条件的列
  let line: Line;
  if (qualifying.length === 1) {
    line = qualifying[0];
  } else {
    const ans = yield {
      kind: 'select-line',
      title: 'metal-3：选择要删除所有牌的列（该列双方合计≥8张）',
      min: 1,
      max: 1,
      optional: false,
      candidates: [],
      lines: qualifying,
    };
    if (ans.selected.length === 0) return; // fizzle 兜底
    line = Number(ans.selected[0].replace('line:', '')) as Line;
  }
  const targets: string[] = [];
  for (const owner of [0, 1] as PlayerId[]) {
    for (const card of ctx.s.players[owner].stacks[line]) targets.push(card.uid);
  }
  for (const uid of targets) {
    const card = findCard(ctx.s, uid);
    if (!card || card.zone !== 'field') continue; // 连锁中已被移走/删除 → 跳过
    yield { op: 'delete', uid, allowCovered: true };
  }
}

/** metal-5 中指令：弃1张牌 */
function* metal5(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const hand = ctx.candidates({ zone: 'hand', owner: ctx.player });
  const ans = yield { kind: 'select', title: 'metal-5：弃1张牌', min: 1, max: 1, optional: false, candidates: hand };
  if (ans.selected.length === 0) return; // fizzle：无牌可弃
  yield { op: 'discard', uid: ans.selected[0] };
}

/** metal-6 顶指令：被盖住或翻转前：先删除这张牌。（FAQ 152-153）
 *  同一 fn 注册 before-covered + before-flip：
 *  - before-covered：completePlay/completeShift 的顶卡检查触发（此时 metal-6 是顶卡，未被盖，
 *    删除无需 allowCovered；统一带 allowCovered 无害且安全）；
 *  - before-flip：flip op 前置钩子触发（目标可能是被盖卡 allowCovered 翻转 → 删除自己需
 *    allowCovered；flip op 传 topCommand=bf.top → 被盖的正面 metal-6 触发也能运行）。
 *  top: true —— 顶命令被盖仍生效（before-flip 路径经 topCommand 生效；before-covered 只查顶卡不涉及）。
 *  反面 metal-6 无文本：flip op 对反面卡不收集 before-flip → 反面卡被翻正正常翻转。 */
function* metal6DeleteSelf(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  yield { op: 'delete', uid: ctx.card.uid, allowCovered: true };
}

registerCardEffects('metal-0', {
  middle: metal0Middle,
  valueModifier: { target: 'opponent-line', apply: metal0ValueModifier },
});
registerCardEffects('metal-1', { middle: metal1 });
// metal-2 顶「对手不能在此列以反面打出牌」：A2 lineBlocksOpponentFaceDown 已接线（顶命令，含被盖），不注册效果
registerCardEffects('metal-3', { middle: metal3 });
registerCardEffects('metal-5', { middle: metal5 });
registerCardEffects('metal-6', {
  triggers: {
    'before-covered': { fn: metal6DeleteSelf, optional: false, top: true },
    'before-flip': { fn: metal6DeleteSelf, optional: false, top: true },
  },
});
