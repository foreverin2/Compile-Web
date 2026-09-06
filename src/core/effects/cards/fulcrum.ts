import type { ChoiceCard, EffectCtx, EffectStep, GameState, Line, PlayerId, StepResult } from '../../models/types';
import { registerCardEffects } from '../registry';

/**
 * 3代 支点 fulcrum（关键词：翻转/交换/删除/抽牌；座右铭：扭转乾坤）。
 * 权威卡文：src/data/cards3.ts（compile3文本.txt）；裁决：docs/3代-批2-规格与裁决清单.md
 * （B1 左/右 = 固定线 0↔线 2（swapStacks/rearrangeProtocols a=0 b=2）；B2 fulcrum-1「翻转所有其他
 *  正面朝上的牌」= 全场（双方所有线）faceUp 卡【含被盖】快照，除源卡）。
 */

function opp(p: PlayerId): PlayerId {
  return p === 0 ? 1 : 0;
}

/** 全场（双方所有线堆叠）faceUp 卡（含被盖，B2），可排除源卡 */
function allFaceUpCards(s: GameState, excludeUid?: string): ChoiceCard[] {
  const out: ChoiceCard[] = [];
  for (const owner of [0, 1] as PlayerId[]) {
    const stacks = s.players[owner].stacks;
    for (let line = 0; line < 3; line++) {
      const stack = stacks[line as Line];
      for (let i = 0; i < stack.length; i++) {
        const c = stack[i];
        if (c.faceUp && c.uid !== excludeUid) {
          out.push({
            uid: c.uid, defId: c.defId, faceUp: true, owner, zone: 'field' as const,
            line: line as Line, pos: c.pos, label: String(c.defId),
          });
        }
      }
    }
  }
  return out;
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

/** fulcrum-1 中：翻转所有其他正面朝上的牌。交换你的左堆叠与右堆叠。
 *  全场 faceUp（含被盖）除源卡快照逐张翻面（B2）→ swapStacks 线 0 ↔ 线 2（B1，己方两堆整堆换线）。 */
function* fulcrum1Middle(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const targets = allFaceUpCards(ctx.s, ctx.card.uid);
  for (const t of targets) yield { op: 'flip', uid: t.uid, allowCovered: true };
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
  triggers: { start: { fn: fulcrum0Start, optional: false, top: true } },
});
registerCardEffects('fulcrum-1', { middle: fulcrum1Middle });
registerCardEffects('fulcrum-2', { middle: fulcrum2Middle });
registerCardEffects('fulcrum-3', { middle: fulcrum3Middle });
registerCardEffects('fulcrum-4', { middle: fulcrum4Middle });
registerCardEffects('fulcrum-5', { middle: fulcrum5Middle });
