import type { EffectCtx, EffectStep, PlayerId, StepResult } from '../../models/types';
import { registerCardEffects } from '../registry';
import { deckTopAvailable, findCard } from '../context';
import { cardPointValue } from '../../state/create';
import { getCardDef } from '../../../data/demo';
import { gameBus } from '../../events/bus';

/**
 * 幸运宣告结果事件（UI FX 层订阅：骰子停止 → 成功烟花/失败爆炸）：
 * 在 luck-0/luck-3 宣告数字/协议后、成败判定处发出；success = 宣告命中。
 * payload: { defId, uid（宣告卡源卡）, player, success }。
 */
function emitLuckRoll(ctx: EffectCtx, defId: string, success: boolean): void {
  gameBus.emit({
    type: 'luck:roll',
    state: ctx.s,
    payload: { defId, uid: ctx.card.uid, player: ctx.player, success },
  });
}

/**
 * 2代 幸运 luck（关键词：随机、删除、打出）。
 * 权威卡文：src/data/cards2.ts（与 compile2文本.txt 同步）；规格/裁决：docs/批1规格-幸运明镜和平混沌明晰.md
 * §1 + docs/批1裁决结果.md（[Q1]-[Q6]）。引擎能力 G1 discardDeckTop / G2 flip noMiddle（2026-09-05 已实现）。
 */

/** luck-0：宣告数字 → 抽3 → 自选1张阈值=数字的揭示可打出（裁决 [Q1]/[Q2]） */
function* luck0Middle(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const declAns = yield {
    kind: 'select-action', title: 'luck-0：宣告1个数字（0-6）', min: 1, max: 1, optional: false,
    candidates: [], actions: ['action:num:0', 'action:num:1', 'action:num:2', 'action:num:3', 'action:num:4', 'action:num:5', 'action:num:6'],
  };
  if (declAns.selected.length === 0) return; // fizzle（理论不发生——action 恒可选）
  const n = Number(declAns.selected[0].split(':')[2]);
  const before = new Set(ctx.s.players[ctx.player].hand.map((c) => c.uid));
  yield { op: 'draw', count: 3 };
  // 「从中」= 本效果抽到的 3 张（抽前快照差集近似；抽牌连锁罕见改动手牌构成）
  const matching = ctx.s.players[ctx.player].hand.filter(
    (c) => !before.has(c.uid) && getCardDef(c.defId).value === n,
  );
  // FX 宣告结果：抽 3 后有匹配 = 成功（揭示可打出）；无匹配 = 失败
  emitLuckRoll(ctx, 'luck-0', matching.length > 0);
  if (matching.length === 0) return; // 无命中：牌留手牌，效果结束
  const pickAns = yield {
    kind: 'select', title: `luck-0：揭示1张阈值=${n}的牌`, min: 1, max: 1, optional: false,
    candidates: matching.map((c) => ({
      uid: c.uid, defId: c.defId, faceUp: c.faceUp, owner: c.owner, zone: c.zone, line: c.line, pos: c.pos,
      label: String(getCardDef(c.defId).value),
    })),
  };
  if (pickAns.selected.length === 0) return;
  const uid = pickAns.selected[0];
  yield { op: 'reveal', uid }; // 公开给对手（Case A 幽灵）
  // 「你可以打出它」：可选正/反面
  const faceAns = yield {
    kind: 'select-action', title: 'luck-0：你可以打出这张牌', min: 0, max: 1, optional: true,
    candidates: [], actions: ['action:face-up', 'action:face-down'],
  };
  if (faceAns.selected.length === 0) return; // 不打：留手牌
  const faceUp = faceAns.selected[0] === 'action:face-up';
  const lines = faceUp ? faceUpLines(ctx, uid) : ([0, 1, 2] as const);
  if (lines.length === 0) return; // 正面无处可落（理论罕见）
  const lineAns = yield {
    kind: 'select-line', title: faceUp ? 'luck-0：正面打出（须匹配协议线）' : 'luck-0：反面打出到任意线',
    min: 1, max: 1, optional: false, candidates: [], lines: [...lines],
  };
  if (lineAns.selected.length === 0) return;
  const line = Number(lineAns.selected[0].replace('line:', ''));
  yield { op: 'playFromHand', uid, line: line as 0 | 1 | 2, faceUp };
}

/** 正面可落线：目标卡协议匹配本侧或对手该线协议 */
function faceUpLines(ctx: EffectCtx, uid: string): (0 | 1 | 2)[] {
  const card = findCard(ctx.s, uid);
  if (!card) return [];
  const def = getCardDef(card.defId);
  const opp: PlayerId = ctx.player === 0 ? 1 : 0;
  const out: (0 | 1 | 2)[] = [];
  for (const line of [0, 1, 2] as const) {
    const own = ctx.s.players[ctx.player].protocols[line]?.defId;
    const op = ctx.s.players[opp].protocols[line]?.defId;
    if (def.protocol === own || def.protocol === op) out.push(line);
  }
  return out;
}

/** luck-1：牌库顶反面打出 → 翻开，无视中央效果（G2 noMiddle） */
function* luck1Middle(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  if (!deckTopAvailable(ctx.s, ctx.player)) return; // FAQ 107/142：牌库空不洗弃牌堆，直接不生效
  const lineAns = yield {
    kind: 'select-line', title: 'luck-1：反面打出牌库顶到任意线', min: 1, max: 1, optional: false, candidates: [], lines: [0, 1, 2],
  };
  if (lineAns.selected.length === 0) return;
  const line = Number(lineAns.selected[0].replace('line:', ''));
  const p = ctx.s.players[ctx.player];
  const topUid = p.deck[p.deck.length - 1].uid; // 预读（落地前不可窥视其正面——引擎 secret 机制）
  yield { op: 'playTopDeck', line: line as 0 | 1 | 2, faceUp: false };
  // 翻开刚打出的卡（翻正后仍可能被上层？不会——打出即顶卡未覆盖；noMiddle 豁免中指令，FAQ 运气1 勘误）
  yield { op: 'flip', uid: topUid, noMiddle: true };
}

/** luck-2：弃自己牌库顶 → 抽与被弃卡印刷值相同的张数 */
function* luck2Middle(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  if (!deckTopAvailable(ctx.s, ctx.player)) return;
  const p = ctx.s.players[ctx.player];
  const topUid = p.deck[p.deck.length - 1].uid;
  yield { op: 'discardDeckTop' }; // 缺省 = 效果属主
  const card = findCard(ctx.s, topUid); // 现在弃牌堆（正面公开）
  if (!card) return;
  yield { op: 'draw', count: getCardDef(card.defId).value };
}

/** luck-3：宣告协议（本局双方 6 套，裁决 [Q3]）→ 弃对手牌库顶 → 命中则删任意 1 张未覆盖场卡（[Q4]） */
function* luck3Middle(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const opp: PlayerId = ctx.player === 0 ? 1 : 0;
  const protos = new Set<string>();
  for (const pid of [0, 1] as const) {
    for (const ps of ctx.s.players[pid].protocols) protos.add(ps.defId);
  }
  const declAns = yield {
    kind: 'select-action', title: 'luck-3：宣告1个协议', min: 1, max: 1, optional: false,
    candidates: [], actions: [...protos].map((d) => `action:proto:${d}`),
  };
  if (declAns.selected.length === 0) return;
  const proto = declAns.selected[0].replace('action:proto:', '');
  const oppDeck = ctx.s.players[opp].deck;
  if (oppDeck.length === 0) {
    emitLuckRoll(ctx, 'luck-3', false); // 对手牌库空 → 无法弃顶判定 → 失败
    return; // FAQ 107：对手牌库空则不生效
  }
  const topUid = oppDeck[oppDeck.length - 1].uid;
  yield { op: 'discardDeckTop', player: opp };
  const card = findCard(ctx.s, topUid);
  // FX 宣告结果：弃顶后与宣告协议相同 = 成功（删除 1 张）；不同 = 失败
  emitLuckRoll(ctx, 'luck-3', !!card && getCardDef(card.defId).protocol === proto);
  if (!card || getCardDef(card.defId).protocol !== proto) return; // 未命中
  const targets = ctx.candidates({ zone: 'field' }); // 双方未覆盖顶卡
  const tAns = yield { kind: 'select', title: 'luck-3：命中！删除1张牌', min: 1, max: 1, optional: false, candidates: targets };
  if (tAns.selected.length === 0) return;
  yield { op: 'delete', uid: tAns.selected[0] };
}

/** luck-4：弃自己牌库顶 → 删 1 张现时值相同的场卡（含被盖；裁决 [Q5]/[Q6] 现时值口径） */
function* luck4Middle(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  if (!deckTopAvailable(ctx.s, ctx.player)) return;
  const p = ctx.s.players[ctx.player];
  const topUid = p.deck[p.deck.length - 1].uid;
  yield { op: 'discardDeckTop' };
  const top = findCard(ctx.s, topUid);
  if (!top) return;
  const n = cardPointValue(ctx.s, top); // 弃牌堆正面 → 印刷值
  const cand = [
    ...ctx.candidates({ zone: 'field' }),
    ...ctx.candidates({ zone: 'field', covered: true }),
  ].filter((c) => {
    const card = findCard(ctx.s, c.uid);
    return card !== undefined && cardPointValue(ctx.s, card) === n;
  });
  const tAns = yield { kind: 'select', title: `luck-4：删除1张阈值=${n}的卡牌（可含被覆盖）`, min: 1, max: 1, optional: false, candidates: cand };
  if (tAns.selected.length === 0) return;
  yield { op: 'delete', uid: tAns.selected[0], allowCovered: true };
}

/** luck-5 / 各套 5 分：你弃置1张牌 */
function* discardOne(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const hand = ctx.candidates({ zone: 'hand', owner: ctx.player });
  const ans = yield { kind: 'select', title: '你弃置1张牌', min: 1, max: 1, optional: false, candidates: hand };
  if (ans.selected.length === 0) return; // fizzle：无牌可弃
  yield { op: 'discard', uid: ans.selected[0] };
}

registerCardEffects('luck-0', { middle: luck0Middle });
registerCardEffects('luck-1', { middle: luck1Middle });
registerCardEffects('luck-2', { middle: luck2Middle });
registerCardEffects('luck-3', { middle: luck3Middle });
registerCardEffects('luck-4', { middle: luck4Middle });
registerCardEffects('luck-5', { middle: discardOne });

