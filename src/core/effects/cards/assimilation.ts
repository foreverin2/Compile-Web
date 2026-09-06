import type { EffectCtx, EffectStep, Line, PlayerId, StepResult } from '../../models/types';
import { registerCardEffects } from '../registry';
import { deckTopAvailable } from '../context';
import { fireReactive, fireRefreshReactives } from '../triggers';
import { canRefreshDraw } from '../../engine/deck';
import { controlRearrangeFlow } from '../control-rearrange-flow';

/**
 * 2代 同化 assimilation（关键词：交换、打出）。
 * 权威卡文：src/data/cards2.ts；裁决：docs/批3裁决结果.md（Q10 场卡取入己手易主 / Q11-12 跨方牌库顶
 * 落对方链路易主 / Q13 按 txt 字面：有人刷新（双向）→ 抽对手库顶 + 弃自己手牌进对手弃牌堆）。
 * 引擎 op：takeFromField / deckTopTransfer（已提交）。
 */

function opp(p: PlayerId): PlayerId {
  return p === 0 ? 1 : 0;
}

/** assimilation-0 中：将对手1张被覆盖或未被覆盖的正面朝下的卡牌加入手牌（易主自己；裁决 Q10） */
function* assimilation0Middle(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const foe = opp(ctx.player);
  // 对手场上全部 faceDown 卡（顶卡 faceDown + 被盖卡）
  const cand = ctx.s.players[foe].stacks
    .flat()
    .filter((c) => c.zone === 'field' && !c.faceUp)
    .map((c) => ({
      uid: c.uid, defId: c.defId, faceUp: c.faceUp, owner: foe, zone: c.zone, line: c.line, pos: c.pos, label: '',
    }))
    .filter((c) => !ctx.s.pendingEffects.some((pe) => pe.sourceUid === c.uid)); // 排除结算中源卡（惯例）
  if (cand.length === 0) return;
  const tAns = yield { kind: 'select', title: 'assimilation-0：将对手的1张正面朝下的卡牌加入手牌', min: 1, max: 1, optional: false, candidates: cand };
  if (tAns.selected.length === 0) return;
  yield { op: 'takeFromField', uid: tAns.selected[0] };
}

/** assimilation-1 中：弃置1张牌。刷新。
 *  刷新 = 完整刷新操作（FAQ 161：含消耗控制组件——执行者持有则归还中立，并可在补满前
 *  选择重排任意一方协议：controlRearrangeFlow），随后抽至 5 张。
 *  修改提示词 19：弃牌后若刷新抽不了牌 → 刷新无效（不耗控制权/不重排/不连锁）。 */
function* assimilation1Middle(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const hand = ctx.candidates({ zone: 'hand', owner: ctx.player });
  const dAns = yield { kind: 'select', title: 'assimilation-1：弃置1张牌', min: 1, max: 1, optional: false, candidates: hand };
  if (dAns.selected.length > 0) yield { op: 'discard', uid: dAns.selected[0] };
  if (!canRefreshDraw(ctx.s, ctx.player)) return;
  yield* controlRearrangeFlow(ctx.s, ctx.player, 'assimilation-1 刷新');
  const need = 5 - ctx.s.players[ctx.player].hand.length;
  if (need > 0) yield { op: 'draw', count: need };
  fireRefreshReactives(ctx.s, ctx.player); // 刷新动作连锁
}

/** assimilation-1 底（after-refresh + after-opponent-refresh 双向，无 top 仅顶卡）：
 *  当有人刷新时（自己或对手刷新都触发）：从对手的牌库中抽取1张牌。弃置1张牌到对手的弃牌堆（txt 字面） */
function* assimilation1AfterRefresh(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const foe = opp(ctx.player);
  // 从对手牌库抽 1（洗对手弃牌堆规则照常）
  const foeP = ctx.s.players[foe];
  if (foeP.deck.length + foeP.trash.length > 0) {
    yield { op: 'draw', count: 1, fromOpponentDeck: true };
  }
  // 弃 1 张（自己的手牌）到【对手】的弃牌堆（裁决 Q13 按 txt 字面；直改 + 手动弃牌连锁）
  const hand = ctx.candidates({ zone: 'hand', owner: ctx.player });
  const dAns = yield { kind: 'select', title: 'assimilation-1：弃置1张牌到对手的弃牌堆', min: 1, max: 1, optional: true, candidates: hand };
  if (dAns.selected.length === 0) return;
  const uid = dAns.selected[0];
  const myP = ctx.s.players[ctx.player];
  const idx = myP.hand.findIndex((c) => c.uid === uid);
  if (idx === -1) return;
  const [card] = myP.hand.splice(idx, 1);
  card.owner = foe; // 入对手弃牌堆 → 归对手
  card.zone = 'trash';
  card.faceUp = true;
  card.line = null;
  card.pos = null;
  foeP.trash.push(card);
  fireReactive(ctx.s, 'after-discard', ctx.player); // 弃牌者（自己）侧连锁
  fireReactive(ctx.s, 'after-self-discard', ctx.player);
}

/** assimilation-2 底（end，无 top）：回合结束：将对手牌库顶端的牌反面打在此链路（易主自己，裁决 Q11） */
function* assimilation2End(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const foe = opp(ctx.player);
  const line = ctx.card.line;
  if (line === null || !deckTopAvailable(ctx.s, foe)) return;
  yield { op: 'deckTopTransfer', from: foe, toPlayer: ctx.player, toLine: line };
}

/** assimilation-4 中：从对手牌库顶端抽取1张牌。对手从你的牌库顶端抽取1张牌。 */
function* assimilation4Middle(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const foe = opp(ctx.player);
  const foeP = ctx.s.players[foe];
  const meP = ctx.s.players[ctx.player];
  if (foeP.deck.length + foeP.trash.length > 0) {
    yield { op: 'draw', count: 1, fromOpponentDeck: true };
  }
  if (meP.deck.length + meP.trash.length > 0) {
    yield { op: 'draw', count: 1, player: foe, fromOpponentDeck: true };
  }
}

/** assimilation-5 中：你弃置1张牌 */
function* assimilation5Middle(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const hand = ctx.candidates({ zone: 'hand', owner: ctx.player });
  const ans = yield { kind: 'select', title: 'assimilation-5：你弃置1张牌', min: 1, max: 1, optional: false, candidates: hand };
  if (ans.selected.length === 0) return;
  yield { op: 'discard', uid: ans.selected[0] };
}

/** assimilation-6 底（end，无 top）：回合结束：将牌库顶端的牌反面打在对手的一侧（自己牌库顶 → 易主对手，
 *  自选对手线；裁决 Q12） */
function* assimilation6End(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  if (!deckTopAvailable(ctx.s, ctx.player)) return;
  const lAns = yield { kind: 'select-line', title: 'assimilation-6：将牌库顶的牌反面打在对手的哪一侧', min: 1, max: 1, optional: false, candidates: [], lines: [0, 1, 2] };
  if (lAns.selected.length === 0) return;
  const line = Number(lAns.selected[0].replace('line:', '')) as Line;
  yield { op: 'deckTopTransfer', from: ctx.player, toPlayer: opp(ctx.player), toLine: line };
}

registerCardEffects('assimilation-0', { middle: assimilation0Middle });
registerCardEffects('assimilation-1', {
  middle: assimilation1Middle,
  triggers: {
    'after-refresh': { fn: assimilation1AfterRefresh, optional: true },
    'after-opponent-refresh': { fn: assimilation1AfterRefresh, optional: true },
  },
});
registerCardEffects('assimilation-2', {
  triggers: {
    end: {
      fn: assimilation2End,
      optional: false,
      // 修改提示词 23：对手牌库顶无可打（deckTopAvailable=对手 deck 空，正文首个守卫）→ 无对象 → 收集前自动跳过
      cond: (s, card) => deckTopAvailable(s, opp(card.owner)),
    },
  },
});
registerCardEffects('assimilation-4', { middle: assimilation4Middle });
registerCardEffects('assimilation-5', { middle: assimilation5Middle });
registerCardEffects('assimilation-6', {
  triggers: {
    end: {
      fn: assimilation6End,
      optional: false,
      // 修改提示词 23：自己牌库顶无可打（deckTopAvailable=自己 deck 空，正文首个守卫）→ 无对象 → 收集前自动跳过
      cond: (s, card) => deckTopAvailable(s, card.owner),
    },
  },
});

