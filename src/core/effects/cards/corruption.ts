import type { EffectCtx, EffectStep, PlayerId, StepResult } from '../../models/types';
import { registerCardEffects } from '../registry';
import { findCard } from '../context';
import { shuffleDeck } from '../../engine/deck';

/**
 * 2代 腐化 corruption（关键词：翻转、强行弃置）。
 * 权威卡文：src/data/cards2.ts；裁决：docs/批2裁决结果.md（corruption-0 放行引擎、
 * corruption-1 after-return 洗入牌库 Q6=B、corruption-6 自毁触发所盖卡中指令 = delete 后 revealAfterRemoval 天然满足）。
 */

function opp(p: PlayerId): PlayerId {
  return p === 0 ? 1 : 0;
}

/** corruption-0 顶（start，top:true）：回合开始：在此链路中，翻转1张除此牌外的被覆盖或未被覆盖的
 *  正面朝上的卡牌（txt 修改记录 2026-09-05【2】补「除此牌外」——自己所在链路中的其它 faceUp 卡
 *  翻成反面；源卡自己排除——候选空则 fizzle） */
function* corruption0Start(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const line = ctx.card.line;
  if (line === null) return;
  const stack = ctx.s.players[ctx.player].stacks[line];
  const cand = stack
    .filter((c) => c.zone === 'field' && c.faceUp && c.uid !== ctx.card.uid)
    .map((c) => ({
      uid: c.uid, defId: c.defId, faceUp: c.faceUp, owner: c.owner, zone: c.zone, line: c.line, pos: c.pos,
      label: '',
    }));
  if (cand.length === 0) return;
  const tAns = yield { kind: 'select', title: 'corruption-0：翻转1张此链路中正面朝上的卡牌', min: 1, max: 1, optional: false, candidates: cand };
  if (tAns.selected.length === 0) return;
  yield { op: 'flip', uid: tAns.selected[0], allowCovered: true };
}

// corruption-0 底「此牌可以打在任意一方的任意协议处」：引擎 restrictions.cardAllowsFaceUpAnyLine（批2）

/** corruption-1 中：召回1张卡牌（任意方未覆盖场卡回持有者手牌） */
function* corruption1Middle(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const cand = ctx.candidates({ zone: 'field' });
  const tAns = yield { kind: 'select', title: 'corruption-1：召回1张卡牌', min: 1, max: 1, optional: false, candidates: cand };
  if (tAns.selected.length === 0) return;
  yield { op: 'return', uid: tAns.selected[0] };
}

/** corruption-1 底（after-return，无 top 仅顶卡）：当对手的卡牌被召回时：将那张牌正面朝下放回他的牌库
 *  （裁决 Q6=B：洗入牌库） */
function* corruption1AfterReturn(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const uid = ctx.s.pendingReturnUid;
  if (!uid) return;
  const card = findCard(ctx.s, uid);
  if (!card || card.zone !== 'hand') return; // 已被连锁移走 → 跳过
  const holder = card.owner;
  const hand = ctx.s.players[holder].hand;
  const idx = hand.findIndex((c) => c.uid === uid);
  if (idx === -1) return;
  hand.splice(idx, 1);
  card.zone = 'deck';
  card.faceUp = false;
  card.secret = false;
  card.line = null;
  card.pos = null;
  ctx.s.players[holder].deck.push(card);
  shuffleDeck(ctx.s, holder); // 洗入其持有者牌库（裁决 Q6 B）
}

/** corruption-2 顶（after-self-discard，top:true）：当你弃牌后：对手弃置1张牌（对手自选弃） */
function* corruption2AfterSelfDiscard(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const foe = opp(ctx.player);
  const hand = ctx.candidates({ zone: 'hand', owner: foe });
  if (hand.length === 0) return;
  const ans = yield { kind: 'select', title: 'corruption-2：对手弃置1张牌', min: 1, max: 1, optional: false, candidates: hand, chooser: foe };
  if (ans.selected.length === 0) return;
  yield { op: 'discard', uid: ans.selected[0] };
}

/** corruption-2 中：抽1张牌。弃置1张牌（自己） */
function* corruption2Middle(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  yield { op: 'draw', count: 1 };
  const hand = ctx.candidates({ zone: 'hand', owner: ctx.player });
  const ans = yield { kind: 'select', title: 'corruption-2：弃置1张牌', min: 1, max: 1, optional: false, candidates: hand };
  if (ans.selected.length === 0) return;
  yield { op: 'discard', uid: ans.selected[0] };
}

/** corruption-3 中：你可以翻转1张被覆盖的正面朝上的卡牌（可选；txt 修改记录 2026-09-05【1】撤销
 *  「或未被覆盖」——仅被盖的 faceUp 卡翻成反面；顶卡 faceUp 不是目标） */
function* corruption3Middle(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const cand = ctx.candidates({ zone: 'field', covered: true }).filter((c) => c.faceUp);
  const tAns = yield { kind: 'select', title: 'corruption-3：你可以翻转1张被覆盖的正面朝上的卡牌', min: 1, max: 1, optional: true, candidates: cand };
  if (tAns.selected.length === 0) return;
  yield { op: 'flip', uid: tAns.selected[0], allowCovered: true };
}

/** corruption-5 中：你弃置1张牌 */
function* corruption5Middle(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const hand = ctx.candidates({ zone: 'hand', owner: ctx.player });
  const ans = yield { kind: 'select', title: 'corruption-5：你弃置1张牌', min: 1, max: 1, optional: false, candidates: hand };
  if (ans.selected.length === 0) return;
  yield { op: 'discard', uid: ans.selected[0] };
}

/** corruption-6 顶（end，top:true）：回合结束：你弃置1张牌或删除此牌（二选一；删除自己=自毁，
 *  其覆盖的卡被揭开连锁中指令——FAQ 腐败6，引擎 delete→revealAfterRemoval 天然满足） */
function* corruption6End(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const actAns = yield {
    kind: 'select-action', title: 'corruption-6：你弃置1张牌或删除此牌', min: 1, max: 1, optional: false, candidates: [],
    actions: ['action:discard', 'action:delete'],
  };
  if (actAns.selected.length === 0) return;
  if (actAns.selected[0] === 'action:delete') {
    // allowCovered（FAQ 腐化6 / 同 death-1 先例）：顶命令被盖仍生效——被盖的腐化6 自毁删自己
    // 也合法，删除后其覆盖的卡被揭开连锁中指令（delete → revealAfterRemoval 天然满足）
    yield { op: 'delete', uid: ctx.card.uid, allowCovered: true };
    return;
  }
  const hand = ctx.candidates({ zone: 'hand', owner: ctx.player });
  const ans = yield { kind: 'select', title: 'corruption-6：弃置1张牌', min: 1, max: 1, optional: false, candidates: hand };
  if (ans.selected.length === 0) return;
  yield { op: 'discard', uid: ans.selected[0] };
}

registerCardEffects('corruption-0', {
  triggers: {
    start: {
      fn: corruption0Start,
      optional: false,
      top: true,
      // 修改提示词 16：此链路无其它正面卡牌可翻（无对象）→ 收集前自动跳过
      cond: (s, card) =>
        card.line !== null && s.players[card.owner].stacks[card.line].some((c) => c.faceUp && c.uid !== card.uid),
    },
  },
});
registerCardEffects('corruption-1', {
  middle: corruption1Middle,
  triggers: { 'after-return': { fn: corruption1AfterReturn, optional: false } },
});
registerCardEffects('corruption-2', {
  middle: corruption2Middle,
  triggers: { 'after-self-discard': { fn: corruption2AfterSelfDiscard, optional: false, top: true } },
});
registerCardEffects('corruption-3', { middle: corruption3Middle });
registerCardEffects('corruption-5', { middle: corruption5Middle });
registerCardEffects('corruption-6', {
  triggers: {
    end: {
      fn: corruption6End,
      optional: false,
      top: true,
      // 无 cond：弃1张或删除此牌二选一——删除自己（allowCovered）恒可行（卡必在场 faceUp），
      // 触发总有合法动作（FAQ 腐化6 被盖自毁合法）
    },
  },
});


