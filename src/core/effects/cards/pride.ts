import type { EffectCtx, EffectStep, GameState, Line, PlayerId, StepResult } from '../../models/types';
import { registerCardEffects } from '../registry';
import { getLineValue } from '../../state/create';
import { fireRefreshReactives } from '../triggers';
import { canRefreshDraw } from '../../engine/deck';

/**
 * 3代 傲慢 pride（关键词：编译/刷新/偏转/翻转/对比总阈值；座右铭：矜己自崇）。
 * 权威卡文：src/data/cards3.ts（compile3文本.txt）；裁决：docs/3代-批1-规格与裁决清单.md
 * （RQ8 after-self-compile 方向；刷新 = 完整刷新语义（FAQ 161 含控制组件消耗——编译时已归还，
 * 不重复弹重排）；「若你拥有控制权」条件分支；控制权变更统一 setControl）。
 */

function opp(p: PlayerId): PlayerId {
  return p === 0 ? 1 : 0;
}

/** pride-0 顶（after-self-compile，top 命令被盖仍生效）：当你编译后：刷新。
 *  完整刷新（效果指示刷新语义，love-2/spirit-0 同款：抽至 5 + fireRefreshReactives；
 *  ice-6 禁抽守卫在 draw op 内）。编译动作已归还控制权 → 无需控制组件重排。
 *  修改提示词 19：抽不了牌时刷新无效（不发刷新连锁）。 */
function* pride0AfterSelfCompile(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  if (!canRefreshDraw(ctx.s, ctx.player)) return;
  const need = 5 - ctx.s.players[ctx.player].hand.length;
  if (need > 0) yield { op: 'draw', count: need };
  fireRefreshReactives(ctx.s, ctx.player);
}

/** pride-0 中：若你拥有控制权，偏转1张其他牌。否则，偏转1张你的牌。
 *  （无「可以」→ 条件分支必移；无目标 fizzle。源卡 pride-0 自动排除于候选） */
function* pride0Middle(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const hasControl = ctx.s.control === ctx.player;
  const cand = hasControl
    ? ctx.candidates({ zone: 'field' }) // 任意方未覆盖顶卡
    : ctx.candidates({ zone: 'field', owner: ctx.player }); // 仅自己的
  const tAns = yield {
    kind: 'select', title: hasControl ? 'pride-0：你拥有控制权——偏转1张其他牌' : 'pride-0：偏转1张你的牌',
    min: 1, max: 1, optional: false, candidates: cand,
  };
  if (tAns.selected.length === 0) return;
  const uid = tAns.selected[0];
  const srcLine = findCardLine(ctx.s, uid);
  const lAns = yield {
    kind: 'select-line', title: 'pride-0：偏转到哪条链路', min: 1, max: 1, optional: false, candidates: [],
    lines: ([0, 1, 2] as Line[]).filter((l) => l !== srcLine),
  };
  if (lAns.selected.length === 0) return;
  yield { op: 'shift', uid, targetLine: Number(lAns.selected[0].replace('line:', '')) as Line };
}

/** pride-2 中：在每条你总阈值高于对手的链路中抽1张牌。（快照满足线后逐线 draw 1） */
function* pride2Middle(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const me = ctx.player;
  const lines = ([0, 1, 2] as Line[]).filter((l) => getLineValue(ctx.s, me, l) > getLineValue(ctx.s, opp(me), l));
  for (const l of lines) yield { op: 'draw', count: 1 };
}

/** pride-2 底（start，无 top 仅顶卡）：开始：若你在此链路总阈值高于对手，抽1张牌。 */
function* pride2Start(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const line = ctx.card.line;
  if (line === null) return;
  if (getLineValue(ctx.s, ctx.player, line) > getLineValue(ctx.s, opp(ctx.player), line)) {
    yield { op: 'draw', count: 1 };
  }
}

/** pride-3 中：翻转1张你的反面朝下的牌。（自己的场上未覆盖 faceDown 顶卡；翻正触发其中指令按引擎惯例） */
function* pride3Middle(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const cand = ctx.candidates({ zone: 'field', owner: ctx.player }).filter((c) => !c.faceUp);
  const ans = yield { kind: 'select', title: 'pride-3：翻转1张你的反面朝下的牌', min: 1, max: 1, optional: false, candidates: cand };
  if (ans.selected.length > 0) yield { op: 'flip', uid: ans.selected[0] };
}

/** pride-4 中：若你拥有控制权，你可以将对手1张牌偏转到此链路。
 *  2026-09-13 修复（同 lust-2 的 fuzz 崩溃类）：**排除已经在该线的对手牌**（偏转到原线非法）。 */
function* pride4Middle(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const line = ctx.card.line;
  if (line === null || ctx.s.control !== ctx.player) return;
  const cand = ctx
    .candidates({ zone: 'field', owner: opp(ctx.player) })
    .filter((c) => c.line !== line);
  if (cand.length === 0) return;
  const ans = yield { kind: 'select', title: 'pride-4：你拥有控制权——你可以将对手1张牌偏转到此链路', min: 1, max: 1, optional: true, candidates: cand };
  if (ans.selected.length > 0) yield { op: 'shift', uid: ans.selected[0], targetLine: line };
}

/** pride-5 中：弃1张牌。 */
function* pride5Middle(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const hand = ctx.candidates({ zone: 'hand', owner: ctx.player });
  const ans = yield { kind: 'select', title: 'pride-5：弃1张牌', min: 1, max: 1, optional: false, candidates: hand };
  if (ans.selected.length > 0) yield { op: 'discard', uid: ans.selected[0] };
}

/** pride-6 顶（after-opponent-gain-control，top 命令被盖仍生效）：当对手获得控制权后：翻转此牌。
 *  顶命令被盖也触发 → flip 自己带 allowCovered。 */
function* pride6AfterOppGain(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  yield { op: 'flip', uid: ctx.card.uid, allowCovered: true };
}

/** pride-6 中：若对手拥有控制权，翻转此牌。（无「可以」→ 条件成立必翻自己） */
function* pride6Middle(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  if (ctx.s.control === opp(ctx.player)) yield { op: 'flip', uid: ctx.card.uid };
}

/** 场上卡所在线（选目标后偏转到其它线用） */
function findCardLine(s: GameState, uid: string): Line | null {
  for (const p of s.players) {
    for (const line of [0, 1, 2] as Line[]) {
      const stack = p.stacks[line];
      for (const c of stack) if (c.uid === uid) return line;
    }
  }
  return null;
}

registerCardEffects('pride-0', {
  middle: pride0Middle,
  triggers: { 'after-self-compile': { fn: pride0AfterSelfCompile, optional: false, top: true } },
});
registerCardEffects('pride-2', {
  middle: pride2Middle,
  triggers: {
    start: {
      fn: pride2Start,
      optional: false,
      // 自动判定：本线己方总阈值未高于对手 → 效果整体无动作（不抽）→ 收集前自动跳过不出按钮
      cond: (s, card) =>
        card.line !== null &&
        getLineValue(s, card.owner, card.line) > getLineValue(s, opp(card.owner), card.line),
    },
  },
});
registerCardEffects('pride-3', { middle: pride3Middle });
registerCardEffects('pride-4', { middle: pride4Middle });
registerCardEffects('pride-5', { middle: pride5Middle });
registerCardEffects('pride-6', {
  middle: pride6Middle,
  triggers: { 'after-opponent-gain-control': { fn: pride6AfterOppGain, optional: false, top: true } },
});
