import type { EffectCtx, EffectStep, PlayerId, StepResult } from '../../models/types';
import { registerCardEffects } from '../registry';
import { findCard, isUncovered } from '../context';

/**
 * 3代 支点 fulcrum（关键词：翻转/交换/删除/抽牌；座右铭：扭转乾坤）。
 * 权威卡文：src/data/cards3.ts（compile3文本.txt）；裁决：docs/3代-批2-规格与裁决清单.md
 * （B1 左/右 = 固定线 0↔线 2（swapStacks/rearrangeProtocols a=0 b=2）。
 *  B2 于 2026-09-18 按用户实测拆分：fulcrum-1 = 只翻【未被覆盖】的正面牌——英文卡面
 *  "Flip each other face-up card." 用的是 "each"，FAQ 116/155/156 明示 "each/彼此" 不允许与被覆盖的卡
 *  交互（规则书 L88/L89/L93：默认只有未被覆盖的牌可被效果作用，"全部"才含被盖）；2代瘟疫3 同句式同口径。
 *  wrath-2 卡面为 "Flip all face-up cards in a line with the most cards."，用 "all" → 含被盖不变。）
 */

function opp(p: PlayerId): PlayerId {
  return p === 0 ? 1 : 0;
}

/** fulcrum-0 顶（start，top 命令被盖仍触发）：开始：若你手牌恰好为0张，对手弃2张牌。 */
function* fulcrum0Start(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  if (ctx.s.players[ctx.player].hand.length !== 0) return;
  const foe = opp(ctx.player);
  const hand = ctx.candidates({ zone: 'hand', owner: foe });
  if (hand.length === 0) return;
  const n = Math.min(2, hand.length);
  const ans = yield { kind: 'select', title: `fulcrum-0（开始）：手牌为0——对手弃${n}张牌`, min: n, max: n, optional: false, candidates: hand, chooser: foe };
  if (ans.selected.length > 0) yield { op: 'discardMany', uids: ans.selected };
}

/** fulcrum-0 中：若你手牌恰好为0张，对手弃1张牌。 */
function* fulcrum0Middle(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  if (ctx.s.players[ctx.player].hand.length !== 0) return;
  const foe = opp(ctx.player);
  const hand = ctx.candidates({ zone: 'hand', owner: foe });
  if (hand.length === 0) return;
  const ans = yield { kind: 'select', title: 'fulcrum-0：手牌为0——对手弃1张牌', min: 1, max: 1, optional: false, candidates: hand, chooser: foe };
  if (ans.selected.length > 0) yield { op: 'discard', uid: ans.selected[0] };
}

/** fulcrum-1 中：翻转其他所有未被覆盖的正面朝上的牌。交换你的左链路与右链路。
 *  范围 = 双方 3 条链路的【未被覆盖顶卡】中 faceUp 且非源卡者（zone:'field' 候选即双方未覆盖顶卡，
 *  同 2代 瘟疫3，见 plague.ts：FAQ 51/116/155/156——"each/彼此" 不与被覆盖的卡交互）。
 *  快照后逐张 flip，每张前复查仍在场/仍正面/仍未被覆盖（连锁中可能被移除或被盖住——被盖即不再
 *  满足卡面文本，跳过）→ swapStacks 线 0 ↔ 线 2（B1，己方两堆整堆换线，不触发文本）。 */
function* fulcrum1Middle(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const targets = ctx.candidates({ zone: 'field' }).filter((c) => c.faceUp && c.uid !== ctx.card.uid);
  for (const t of targets) {
    const card = findCard(ctx.s, t.uid);
    if (!card || !card.faceUp || !isUncovered(ctx.s, card)) continue;
    yield { op: 'flip', uid: t.uid };
  }
  yield { op: 'swapStacks', a: 0, b: 2 };
}

/** fulcrum-2 中：若你手牌恰好为2张，删除对手1张牌。 */
function* fulcrum2Middle(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  if (ctx.s.players[ctx.player].hand.length !== 2) return;
  const foe = opp(ctx.player);
  const cand = ctx.candidates({ zone: 'field', owner: foe });
  const ans = yield { kind: 'select', title: 'fulcrum-2：手牌恰好2张——删除对手1张牌', min: 1, max: 1, optional: false, candidates: cand };
  if (ans.selected.length > 0) yield { op: 'delete', uid: ans.selected[0] };
}

/** fulcrum-3 中：抽1张牌。交换你的左协议与右协议的位置。（B1：协议位 0 ↔ 2） */
function* fulcrum3Middle(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  yield { op: 'draw', count: 1 };
  yield { op: 'rearrangeProtocols', a: 0, b: 2 };
}

/** fulcrum-4 中：若你手牌恰好为4张，抽1张牌。 */
function* fulcrum4Middle(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  if (ctx.s.players[ctx.player].hand.length === 4) yield { op: 'draw', count: 1 };
}

/** fulcrum-5 中：弃1张牌。 */
function* fulcrum5Middle(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const hand = ctx.candidates({ zone: 'hand', owner: ctx.player });
  const ans = yield { kind: 'select', title: 'fulcrum-5：弃1张牌', min: 1, max: 1, optional: false, candidates: hand };
  if (ans.selected.length > 0) yield { op: 'discard', uid: ans.selected[0] };
}

registerCardEffects('fulcrum-0', {
  middle: fulcrum0Middle,
  triggers: {
    start: {
      fn: fulcrum0Start,
      optional: false,
      top: true,
      // 自动判定：手牌非空 或 对手手牌空 → 无对象（无法让对手弃牌）→ 不收集
      cond: (s, card) =>
        s.players[card.owner].hand.length === 0 &&
        s.players[opp(card.owner)].hand.length > 0,
    },
  },
});
registerCardEffects('fulcrum-1', { middle: fulcrum1Middle });
registerCardEffects('fulcrum-2', { middle: fulcrum2Middle });
registerCardEffects('fulcrum-3', { middle: fulcrum3Middle });
registerCardEffects('fulcrum-4', { middle: fulcrum4Middle });
registerCardEffects('fulcrum-5', { middle: fulcrum5Middle });

