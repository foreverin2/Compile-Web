import type { EffectCtx, EffectStep, Line, PlayerId, StepResult } from '../../models/types';
import { registerCardEffects } from '../registry';
import { executeCompileBody } from '../../rules/compile-body';
import { getLineValue } from '../../state/create';
import { controlRearrangeFlow } from '../control-rearrange-flow';

/**
 * 3代 贪婪 greed（关键词：弃牌/删除/抽牌/回手/编译；座右铭：贪得无厌）。
 * 权威卡文：src/data/cards3.ts（compile3文本.txt）；裁决：docs/3代-批1-规格与裁决清单.md
 * （RQ3-A 贪婪1 结束编译强制+自选+不受次数限 / RQ5-A 贪婪0 底 after-own-delete 执行者侧 /
 *  RQ7-A 回手任意场牌回其主）。
 */

function opp(p: PlayerId): PlayerId {
  return p === 0 ? 1 : 0;
}

/** greed-0 中：弃置你的手牌。删除1张牌。 */
function* greed0Middle(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const hand = ctx.s.players[ctx.player].hand.map((c) => c.uid);
  if (hand.length > 0) yield { op: 'discardMany', uids: hand };
  const cand = ctx.candidates({ zone: 'field' });
  const dAns = yield { kind: 'select', title: 'greed-0：删除1张牌', min: 1, max: 1, optional: false, candidates: cand };
  if (dAns.selected.length > 0) yield { op: 'delete', uid: dAns.selected[0] };
}

/** greed-0 底（after-own-delete，无 top 仅顶卡）：当你删除牌后：抽1张牌。
 *  触发点 = 删除【执行者】自己侧（裁决 RQ5-A；resolve.ts delete op 已补 after-own-delete 事件）。 */
function* greed0AfterOwnDelete(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  yield { op: 'draw', count: 1 };
}

/** greed-1 底（end，无 top 仅顶卡）：结束：在1条你有至少10点阈值且总阈值高于对手的链路中编译。
 *  裁决 RQ3-A：存在满足链则必须编译；多条由拥有者选 1 条；已编译线 = 重编译照常；不受「每回合最多
 *  编译 1 条」限制；不查 lust-0/compileBlocked（卡牌效果编译打破规则，RQ4-A）；完整编译（删卡/翻面/
 *  重编译抽牌/胜利/after-compile 连锁）→ executeCompileBody；效果编译同样先走控制组件归还+重排。 */
function* greed1End(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const me = ctx.player;
  const lines = ([0, 1, 2] as Line[]).filter(
    (l) => getLineValue(ctx.s, me, l) >= 10 && getLineValue(ctx.s, me, l) > getLineValue(ctx.s, opp(me), l),
  );
  if (lines.length === 0) return;
  yield* controlRearrangeFlow(ctx.s, me, 'greed-1 编译');
  // 重排可能改变协议槽但线值不变；重新计算（防御：期间线值可能被连锁改变 → 以当前为准）
  const now = ([0, 1, 2] as Line[]).filter(
    (l) => getLineValue(ctx.s, me, l) >= 10 && getLineValue(ctx.s, me, l) > getLineValue(ctx.s, opp(me), l),
  );
  if (now.length === 0) return;
  const lAns = yield {
    kind: 'select-line', title: 'greed-1（结束）：选择要编译的链路', min: 1, max: 1, optional: false,
    candidates: [], lines: now,
  };
  if (lAns.selected.length === 0) return;
  const line = Number(lAns.selected[0].replace('line:', '')) as Line;
  executeCompileBody(ctx.s, me, line, { sourceDefId: 'greed-1' });
}

/** greed-2 中：对手弃1张牌（对手自选）。 */
function* greed2Middle(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const foe = opp(ctx.player);
  const hand = ctx.candidates({ zone: 'hand', owner: foe });
  if (hand.length === 0) return;
  const ans = yield { kind: 'select', title: 'greed-2：对手弃1张牌', min: 1, max: 1, optional: false, candidates: hand, chooser: foe };
  if (ans.selected.length > 0) yield { op: 'discard', uid: ans.selected[0] };
}

/** greed-2 底（start，无 top 仅顶卡）：开始：你可以回手1张你的牌（自己场上未覆盖顶卡——含正面/反面）。
 *  2026-09-13（用户清单 #15 同类审计）：文本「你的1张牌」无「其他」→ 与 flexible-1 同构，
 *  按用户裁定**含此牌自身**（可以把自己回手）。 */
function* greed2Start(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const cand = ctx.candidates({ zone: 'field', owner: ctx.player, includeSelf: true });
  const ans = yield { kind: 'select', title: 'greed-2（开始）：你可以回手1张你的牌（含此牌自身）', min: 1, max: 1, optional: true, candidates: cand };
  if (ans.selected.length > 0) yield { op: 'return', uid: ans.selected[0] };
}

/** greed-3 中：偏转你在此链路中1张被覆盖的牌（自己该链路的被盖卡 → 移到其它线自己链路）。 */
function* greed3Middle(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const line = ctx.card.line;
  if (line === null) return;
  const stack = ctx.s.players[ctx.player].stacks[line];
  const resolving = new Set(ctx.s.pendingEffects.map((pe) => pe.sourceUid));
  const covered = stack.slice(0, -1).filter((c) => !resolving.has(c.uid)); // 自己该链路被盖卡
  if (covered.length === 0) return;
  const cAns = yield {
    kind: 'select',
    title: 'greed-3：偏转你在此链路中1张被覆盖的牌',
    min: 1, max: 1, optional: false,
    candidates: covered.map((c) => ({
      uid: c.uid, defId: c.defId, faceUp: c.faceUp, owner: ctx.player, zone: 'field' as const, line, pos: c.pos, label: String(c.defId),
    })),
  };
  if (cAns.selected.length === 0) return;
  const tAns = yield {
    kind: 'select-line', title: 'greed-3：偏转到哪条链路', min: 1, max: 1, optional: false, candidates: [],
    lines: ([0, 1, 2] as Line[]).filter((l) => l !== line),
  };
  if (tAns.selected.length === 0) return;
  const to = Number(tAns.selected[0].replace('line:', '')) as Line;
  yield { op: 'shift', uid: cAns.selected[0], targetLine: to, allowCovered: true };
}

/** greed-4 中：你可以弃置手牌。若你这么做，翻转1张牌。 */
function* greed4Middle(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const act = yield {
    kind: 'select-action', title: 'greed-4：你可以弃置你的手牌', min: 1, max: 1, optional: true, candidates: [],
    actions: ['action:弃置手牌'],
  };
  if (act.selected.length === 0) return; // 跳过
  const hand = ctx.s.players[ctx.player].hand.map((c) => c.uid);
  if (hand.length > 0) yield { op: 'discardMany', uids: hand };
  const cand = ctx.candidates({ zone: 'field' });
  const fAns = yield { kind: 'select', title: 'greed-4：若你这么做，翻转1张牌', min: 1, max: 1, optional: false, candidates: cand };
  if (fAns.selected.length > 0) yield { op: 'flip', uid: fAns.selected[0] };
}

/** greed-5 中：弃1张牌。 */
function* greed5Middle(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const hand = ctx.candidates({ zone: 'hand', owner: ctx.player });
  const ans = yield { kind: 'select', title: 'greed-5：弃1张牌', min: 1, max: 1, optional: false, candidates: hand };
  if (ans.selected.length > 0) yield { op: 'discard', uid: ans.selected[0] };
}

registerCardEffects('greed-0', {
  middle: greed0Middle,
  triggers: { 'after-own-delete': { fn: greed0AfterOwnDelete, optional: false } },
});
registerCardEffects('greed-1', {
  triggers: {
    end: {
      fn: greed1End,
      optional: false,
      // 自动判定：无满足编译条件的链路（≥10 且高于对手）→ 无对象自动跳过不出按钮
      cond: (s, card) => {
        const me = card.owner;
        const foe = opp(me);
        return ([0, 1, 2] as Line[]).some(
          (l) => getLineValue(s, me, l) >= 10 && getLineValue(s, me, l) > getLineValue(s, foe, l),
        );
      },
    },
  },
});
registerCardEffects('greed-2', {
  middle: greed2Middle,
  triggers: {
    start: {
      fn: greed2Start,
      optional: false,
      // 自动判定：自己场上无【其它】可回手的顶卡（各链路顶卡除自己）→ 无对象不收集不弹按钮
      cond: (s, card) =>
        ([0, 1, 2] as Line[]).some((l) => {
          const stack = s.players[card.owner].stacks[l];
          const top = stack[stack.length - 1];
          return !!top && top.uid !== card.uid;
        }),
    },
  },
});
registerCardEffects('greed-3', { middle: greed3Middle });
registerCardEffects('greed-4', { middle: greed4Middle });
registerCardEffects('greed-5', { middle: greed5Middle });

