import type { EffectCtx, EffectStep, GameState, Line, PlayerId, StepResult } from '../../models/types';
import { registerCardEffects } from '../registry';
import { deckTopAvailable } from '../context';
import { getLineValue } from '../../state/create';
import { getCardDef } from '../../../data/demo';

/**
 * 3代 压制 overwhelm（关键词：反面打出/删除/翻转/对比总阈值；座右铭：势压万钧）。
 * 权威卡文：src/data/cards3.ts（compile3文本.txt）；裁决：docs/3代-批2-规格与裁决清单.md
 * （B6 压制2 结束「翻转此牌」= 翻 overwhelm-2 自己（被盖也翻）；B7 压制4 全场全卡计数、删对手被盖中
 *  印刷值最低；牌库顶反打不洗牌（FAQ 142），牌库空后续线 fizzle）。
 */

function opp(p: PlayerId): PlayerId {
  return p === 0 ? 1 : 0;
}

/** 印刷值 */
function pv(defId: string): number {
  return getCardDef(defId).value;
}

/** 某玩家全场（全部线链路，含被盖）卡数 */
function totalFieldCards(s: GameState, player: PlayerId): number {
  return s.players[player].stacks.reduce((acc, st) => acc + st.length, 0);
}

/** overwhelm-1 中：在每条你总阈值高于对手的链路中，从你的牌库顶端反面打出1张牌。
 *  快照高于线逐线反打己方链路；每线前牌库守卫（空 → 该线 fizzle，后续线继续）。
 *  顺序细节：源卡所在线排最后执行——反打会盖住源卡（sourceValid 仅查未覆盖），若先打源卡线会
 *  中断后续线（2026-09 实测）；txt 无顺序要求，「每条链路」均可后打。 */
function* overwhelm1Middle(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const me = ctx.player;
  const mine = ctx.card.line;
  const lines = ([0, 1, 2] as Line[])
    .filter((l) => getLineValue(ctx.s, me, l) > getLineValue(ctx.s, opp(me), l))
    .sort((a, b) => (a === mine ? 1 : b === mine ? -1 : 0));
  for (const l of lines) {
    if (!deckTopAvailable(ctx.s, me)) continue;
    yield { op: 'playTopDeck', line: l, faceUp: false };
  }
}

/** overwhelm-2 顶（end，top 命令被盖仍生效）：结束：在每条链路中从你的牌库顶端反面打出1张牌。翻转此牌。
 *  3 线逐线反打己方链路 → 翻转 overwhelm-2 自己（即使刚被新卡盖住 → allowCovered，B6；faceUp→faceDown 后停用）。 */
function* overwhelm2End(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  for (const l of [0, 1, 2] as Line[]) {
    if (!deckTopAvailable(ctx.s, ctx.player)) continue;
    yield { op: 'playTopDeck', line: l, faceUp: false };
  }
  yield { op: 'flip', uid: ctx.card.uid, allowCovered: true };
}

/** overwhelm-2 中：对手在每条链路中从其牌库顶端反面打出1张牌。 */
function* overwhelm2Middle(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const foe = opp(ctx.player);
  for (const l of [0, 1, 2] as Line[]) {
    if (!deckTopAvailable(ctx.s, foe)) continue;
    yield { op: 'playTopDeck', line: l, faceUp: false, player: foe };
  }
}

/** overwhelm-3 底（end，无 top 仅顶卡）：结束：若你手牌有5张或以上，从你的牌库顶端反面打出1张牌到此链路。 */
function* overwhelm3End(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const line = ctx.card.line;
  if (line === null || ctx.s.players[ctx.player].hand.length < 5) return;
  if (!deckTopAvailable(ctx.s, ctx.player)) return;
  yield { op: 'playTopDeck', line, faceUp: false };
}

/** overwhelm-4 中：若你场上的牌比对手多，删除对手阈值最低的被覆盖的牌。
 *  计数 = 双方全场全卡（含被盖，B7）→ 删对手被盖（非顶卡，任意朝向）中印刷值最低者（并列拥有者任选）。 */
function* overwhelm4Middle(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const me = ctx.player;
  const foe = opp(me);
  if (totalFieldCards(ctx.s, me) <= totalFieldCards(ctx.s, foe)) return;
  const covered = ctx.candidates({ zone: 'field', owner: foe, covered: true });
  if (covered.length === 0) return;
  const minV = Math.min(...covered.map((c) => pv(c.defId)));
  const cand = covered.filter((c) => pv(c.defId) === minV);
  const ans = yield { kind: 'select', title: 'overwhelm-4：删除对手阈值最低的被覆盖的牌', min: 1, max: 1, optional: false, candidates: cand };
  if (ans.selected.length > 0) yield { op: 'delete', uid: ans.selected[0], allowCovered: true };
}

/** overwhelm-5 中：弃1张牌。 */
function* overwhelm5Middle(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const hand = ctx.candidates({ zone: 'hand', owner: ctx.player });
  const ans = yield { kind: 'select', title: 'overwhelm-5：弃1张牌', min: 1, max: 1, optional: false, candidates: hand };
  if (ans.selected.length > 0) yield { op: 'discard', uid: ans.selected[0] };
}

/** overwhelm-6 顶（start，top 命令被盖仍生效）：开始：若对手在此链路总阈值高于你，翻转此牌。 */
function* overwhelm6Start(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const line = ctx.card.line;
  if (line === null) return;
  if (getLineValue(ctx.s, opp(ctx.player), line) > getLineValue(ctx.s, ctx.player, line)) {
    yield { op: 'flip', uid: ctx.card.uid, allowCovered: true };
  }
}

registerCardEffects('overwhelm-1', { middle: overwhelm1Middle });
registerCardEffects('overwhelm-2', {
  middle: overwhelm2Middle,
  triggers: { end: { fn: overwhelm2End, optional: false, top: true } },
});
registerCardEffects('overwhelm-3', {
  triggers: {
    end: {
      fn: overwhelm3End,
      optional: false,
      // 自动判定：手牌不足 5 张 → 无对象自动跳过不出按钮
      cond: (s, card) => s.players[card.owner].hand.length >= 5,
    },
  },
});
registerCardEffects('overwhelm-4', { middle: overwhelm4Middle });
registerCardEffects('overwhelm-5', { middle: overwhelm5Middle });
registerCardEffects('overwhelm-6', {
  triggers: {
    start: {
      fn: overwhelm6Start,
      optional: false,
      top: true,
      // 自动判定：此链路中对手总阈值未更大 → 无对象自动跳过不出按钮
      cond: (s, card) =>
        card.line !== null &&
        getLineValue(s, opp(card.owner), card.line) > getLineValue(s, card.owner, card.line),
    },
  },
});

