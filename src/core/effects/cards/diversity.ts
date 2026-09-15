import { pushLog } from '../../log';
import type { ChoiceCard, EffectCtx, EffectStep, GameState, Line, PlayerId, StepResult } from '../../models/types';
import { registerCardEffects } from '../registry';
import { findCard } from '../context';
import { cardPointValue } from '../../state/create';
import { gameBus } from '../../events/bus';

/**
 * 2代 多元 diversity（关键词：打出、对比、编译）。
 * 权威卡文：src/data/cards2.ts（diversity 译名 2026-09-04 用户拍板）；裁决：docs/批3裁决结果.md
 * （Q6 纯翻协议 / Q7-9 去重协议数口径）。
 */

function opp(p: PlayerId): PlayerId {
  return p === 0 ? 1 : 0;
}

/** 场上（双方链路）去重协议数 */
function fieldProtocolCount(s: GameState): number {
  const set = new Set<string>();
  for (const owner of [0, 1] as PlayerId[]) {
    for (const line of [0, 1, 2] as Line[]) {
      for (const c of s.players[owner].stacks[line]) set.add(c.defId.split('-')[0]);
    }
  }
  return set.size;
}

/** 场上【正面朝上】卡的去重协议数（含被覆盖的正面卡；2026-09-12 用户澄清：多元6 只算正面卡，
 *  反面朝下的场卡不算——反面卡没有协议属性/公开信息）。 */
function fieldProtocolCountFaceUp(s: GameState): number {
  const set = new Set<string>();
  for (const owner of [0, 1] as PlayerId[]) {
    for (const line of [0, 1, 2] as Line[]) {
      for (const c of s.players[owner].stacks[line]) {
        if (c.faceUp) set.add(c.defId.split('-')[0]);
      }
    }
  }
  return set.size;
}

/** diversity-0 中：若场上有6张不同协议的卡牌，将多元协议翻转至已编译（裁决 Q6：纯翻面不删卡） */
function* diversity0Middle(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  if (fieldProtocolCount(ctx.s) < 6) return;
  const proto = ctx.s.players[ctx.player].protocols.find((p) => p.defId === 'diversity');
  if (proto) {
    proto.compiled = true;
    pushLog(ctx.s, `P${ctx.player + 1}：多元协议翻转至已编译（diversity-0）`);
    // 语义事件（2026-09-12）：多元0 效果翻协议 → UI 播「6 道协议色光柱汇聚到多元0 + 彩光迸发」
    gameBus.emit({
      type: 'protocol:compiled-by-effect',
      state: ctx.s,
      payload: { player: ctx.player, defId: 'diversity', sourceUid: ctx.card.uid },
    });
  }
}

/** diversity-0 底（end，无 top）：回合结束：你可以将1张不是多元协议的卡牌打入此链路
 *  （手牌非 diversity 卡 → 正面打此线——文本放行协议匹配） */
function* diversity0End(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const line = ctx.card.line;
  if (line === null) return;
  const hand = ctx.candidates({ zone: 'hand', owner: ctx.player }).filter((c) => c.defId.split('-')[0] !== 'diversity');
  const hAns = yield { kind: 'select', title: 'diversity-0：你可以打入1张非多元协议的卡牌到此链路', min: 1, max: 1, optional: true, candidates: hand };
  if (hAns.selected.length === 0) return;
  yield { op: 'playFromHand', uid: hAns.selected[0], line, faceUp: true };
}

/** diversity-1 中：偏转1张牌。抽取与此链路中不同协议的卡牌数相同的卡牌（该线双方链路去重协议数） */
function* diversity1Middle(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const cand = ctx.candidates({ zone: 'field' });
  const tAns = yield { kind: 'select', title: 'diversity-1：偏转1张牌', min: 1, max: 1, optional: false, candidates: cand };
  if (tAns.selected.length === 0) return;
  const card = findCard(ctx.s, tAns.selected[0]);
  const fromLine = card?.line ?? 0;
  const lAns = yield {
    kind: 'select-line', title: 'diversity-1：偏转到哪条链路', min: 1, max: 1, optional: false, candidates: [],
    lines: ([0, 1, 2] as Line[]).filter((l) => l !== fromLine),
  };
  if (lAns.selected.length === 0) return;
  const to = Number(lAns.selected[0].replace('line:', '')) as Line;
  yield { op: 'shift', uid: tAns.selected[0], targetLine: to };
  // 「此链路」= diversity-1 所在线（结算时该线双方链路去重协议数）
  const line = ctx.card.line;
  if (line === null) return;
  const set = new Set<string>();
  for (const owner of [0, 1] as PlayerId[]) {
    for (const c of ctx.s.players[owner].stacks[line]) set.add(c.defId.split('-')[0]);
  }
  if (set.size > 0) yield { op: 'draw', count: set.size };
}

/** diversity-3 顶（valueModifier own-stack）：若此链路中有任何非多元的正面朝上的卡牌，你的总阈值加2 */
function diversity3ValueModifier(s: GameState, owner: PlayerId, line: Line, total: number): number {
  const stack = s.players[owner].stacks[line];
  const hasNonDiversity = stack.some((c) => c.faceUp && c.defId.split('-')[0] !== 'diversity');
  return hasNonDiversity ? total + 2 : total;
}

/** diversity-4 中：翻转1张阈值(现时值)小于场上不同协议卡牌数目的牌 */
function* diversity4Middle(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const n = fieldProtocolCount(ctx.s);
  const cand = ctx.candidates({ zone: 'field' }).filter((c) => {
    const card = findCard(ctx.s, c.uid);
    return card !== undefined && cardPointValue(ctx.s, card) < n;
  });
  const tAns = yield { kind: 'select', title: `diversity-4：翻转1张阈值小于${n}的卡牌`, min: 1, max: 1, optional: false, candidates: cand };
  if (tAns.selected.length === 0) return;
  yield { op: 'flip', uid: tAns.selected[0] };
}

/** diversity-5 中：你弃置1张牌 */
function* diversity5Middle(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const hand = ctx.candidates({ zone: 'hand', owner: ctx.player });
  const ans = yield { kind: 'select', title: 'diversity-5：你弃置1张牌', min: 1, max: 1, optional: false, candidates: hand };
  if (ans.selected.length === 0) return;
  yield { op: 'discard', uid: ans.selected[0] };
}

/** diversity-6 顶（end，top:true）：回合结束：若场上的不同协议种类小于4，删除此牌
 *  G2 修正 R14-3（2026-09-16 用户裁决）：阈值 3 → 4（用户："多元6文本改为小于4，而不是至少3个"
 *  + "那算是规则也要改动"）—— 权威文本 compile2文本.txt 与数据、规则三处同步改。
 *  （txt 修改记录 2026-09-05【8】：至少4种→至少3种；英文 End: If there are not at least 3
 *  different protocols on cards in the field, delete this card.
 *  2026-09-12 用户澄清：计数只算【正面朝上】的卡（含被覆盖的正面卡），反面朝下的场卡不计入） */
function* diversity6End(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  if (fieldProtocolCountFaceUp(ctx.s) < 4) yield { op: 'delete', uid: ctx.card.uid };
}


registerCardEffects('diversity-0', {
  middle: diversity0Middle,
  triggers: { end: { fn: diversity0End, optional: true } },
});
registerCardEffects('diversity-1', { middle: diversity1Middle });
registerCardEffects('diversity-3', { valueModifier: { target: 'own-stack', apply: diversity3ValueModifier } });
registerCardEffects('diversity-4', { middle: diversity4Middle });
registerCardEffects('diversity-5', { middle: diversity5Middle });
registerCardEffects('diversity-6', {
  triggers: {
    end: {
      fn: diversity6End,
      optional: false,
      top: true,
      // 自动判定：场上已有 ≥3 种不同协议【正面】卡 → 删除条件不满足（无动作）→ 不收集不弹按钮
      cond: (s) => fieldProtocolCountFaceUp(s) < 3,
    },
  },
});





