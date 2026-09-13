import type { ChoiceCard, EffectCtx, EffectStep, GameState, Line, PlayerId, StepResult } from '../../models/types';
import { registerCardEffects } from '../registry';
import { deckTopAvailable, findCard, nextEffectId } from '../context';
import { shuffleDeck, shuffleTrashIntoDeck } from '../../engine/deck';
import { getCardDef } from '../../../data/demo';

/**
 * 2代 明晰 clarity（关键词：抽取、揭示）。
 * 权威卡文：src/data/cards2.ts；规格/裁决：docs/批1规格-幸运明镜和平混沌明晰.md §5 + docs/批1裁决结果.md
 * （[Q16]-[Q17]）。引擎能力 G1 discardDeckTop / G8 drawFromDeck+shuffleDeck+shuffleTrashIntoDeck+deckReveals
 * （2026-09-05 已实现）。
 */

function opp(p: PlayerId): PlayerId {
  return p === 0 ? 1 : 0;
}

/** clarity-0 顶：此链路中，你每有1张牌，总阈值就加1（own-stack，+自己该线链路张数；裁决 [Q16]） */
function clarity0ValueModifier(s: GameState, owner: PlayerId, line: Line, total: number): number {
  return total + s.players[owner].stacks[line].length;
}

/** clarity-1 顶（start，top:true）：揭示你的牌库顶端的卡牌。你可以弃置牌库顶端的卡牌。
 *  呈现：deckReveals 标记（whole:false=库顶，双方展示浮层由 UI 排期）+ reveal 幽灵（对手侧） */
function* clarity1Start(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  if (!deckTopAvailable(ctx.s, ctx.player)) return; // FAQ 107
  const p = ctx.s.players[ctx.player];
  const topUid = p.deck[p.deck.length - 1].uid;
  // 牌库揭示标记（与揭示幽灵同过期口径：Case A = 对手回合结束清除）
  ctx.s.deckReveals.push({ id: nextEffectId(ctx.s), player: ctx.player, whole: false, expiresAtTurn: ctx.s.turnCount + 2 });
  yield { op: 'reveal', uid: topUid }; // 幽灵给对手（Case A：自己的牌）
  const actAns = yield {
    kind: 'select-action', title: 'clarity-1：你可以弃置牌库顶端的卡牌', min: 1, max: 1, optional: false,
    candidates: [], actions: ['action:discard', 'action:skip'],
  };
  if (actAns.selected.length === 0 || actAns.selected[0] === 'action:skip') return;
  yield { op: 'discardDeckTop' };
}

/** clarity-1 中：对手揭示其手牌（逐张 reveal 幽灵给自己，Case B；不改状态） */
function* clarity1Middle(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const oppHand = ctx.s.players[opp(ctx.player)].hand.map((c) => c.uid);
  for (const uid of oppHand) yield { op: 'reveal', uid };
}

/** clarity-1 底（before-covered）：当此牌被覆盖时：抽3张牌（被盖前触发，FAQ 47-48 先结算再落地） */
function* clarity1BeforeCovered(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  yield { op: 'draw', count: 3 };
}

/** 牌库中印刷值 === n 的卡（选择抽取；修改提示词 3：向玩家展示牌面以供选择——候选 faceUp=true
 *  由 UI 正面渲染，不再依赖 deckReveals 浮层；其余卡随后放回牌库重洗） */
function deckValueCandidates(s: GameState, player: PlayerId, n: number): ChoiceCard[] {
  const out: ChoiceCard[] = [];
  for (const c of s.players[player].deck) {
    if (getCardDef(c.defId).value !== n) continue;
    out.push({
      uid: c.uid, defId: c.defId, faceUp: true, // 揭示展示：候选以正面呈现
      owner: c.owner, zone: c.zone, line: c.line, pos: c.pos,
      label: String(n),
    });
  }
  return out;
}

/** 正面可落线（目标卡在手牌，defId 已知） */
function faceUpLines(ctx: EffectCtx, uid: string): (0 | 1 | 2)[] {
  const card = findCard(ctx.s, uid);
  if (!card) return [];
  const def = getCardDef(card.defId);
  const foe = opp(ctx.player);
  const out: (0 | 1 | 2)[] = [];
  for (const line of [0, 1, 2] as const) {
    const own = ctx.s.players[ctx.player].protocols[line]?.defId;
    const op = ctx.s.players[foe].protocols[line]?.defId;
    if (def.protocol === own || def.protocol === op) out.push(line);
  }
  return out;
}

/** clarity-2/3 共用：牌库中找印刷值 n 的卡 → 玩家正面选 1 张抽入 → 其余放回重洗；
 *  clarity-2 再打出刚抽那张（裁决 [Q17]；修改提示词 3：不依赖 deckReveals 浮层，候选正面展示可选）。 */
function* clarityRevealDrawShuffle(ctx: EffectCtx, n: number, playIt: boolean): Generator<EffectStep, void, StepResult> {
  if (ctx.s.players[ctx.player].deck.length === 0) return; // 空牌库无意义（FAQ 107 精神）
  const cand = deckValueCandidates(ctx.s, ctx.player, n);
  if (cand.length === 0) return; // 牌库无值 n 卡 → 整句无对象 fizzle（不切洗）
  const cAns = yield { kind: 'select', title: `透彻：从牌库中选择1张阈值为${n}的卡牌抽取`, min: 1, max: 1, optional: false, candidates: cand };
  if (cAns.selected.length === 0) return;
  const uid = cAns.selected[0];
  yield { op: 'drawFromDeck', uid };
  shuffleDeck(ctx.s, ctx.player); // 其余牌放回牌库并重洗
  if (!playIt) return;
  const faceAns = yield {
    kind: 'select-action', title: 'clarity：打出这张牌（朝向）', min: 1, max: 1, optional: true,
    candidates: [], actions: ['action:face-up', 'action:face-down'],
  };
  if (faceAns.selected.length === 0) return; // 不打（留在手牌）
  const faceUp = faceAns.selected[0] === 'action:face-up';
  const lines = faceUp ? faceUpLines(ctx, uid) : ([0, 1, 2] as const);
  if (lines.length === 0) return;
  const lAns = yield {
    kind: 'select-line', title: faceUp ? 'clarity：正面打出（须匹配协议线）' : 'clarity：反面打出到任意线',
    min: 1, max: 1, optional: false, candidates: [], lines: [...lines],
  };
  if (lAns.selected.length === 0) return;
  const line = Number(lAns.selected[0].replace('line:', ''));
  yield { op: 'playFromHand', uid, line: line as 0 | 1 | 2, faceUp };
}

/** clarity-2 中：揭示牌库 → 抽值1 → 切洗 → 打出刚抽那张 */
function clarity2Middle(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  return clarityRevealDrawShuffle(ctx, 1, true);
}

/** clarity-3 中：揭示牌库 → 抽值5 → 切洗（无打出句） */
function clarity3Middle(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  return clarityRevealDrawShuffle(ctx, 5, false);
}

/** clarity-4 中：你可以将弃牌堆洗入牌库（可选） */
function* clarity4Middle(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  if (ctx.s.players[ctx.player].trash.length === 0) return; // 无可洗
  const actAns = yield {
    kind: 'select-action', title: 'clarity-4：你可以将弃牌堆洗入牌库', min: 1, max: 1, optional: false,
    candidates: [], actions: ['action:shuffle', 'action:skip'],
  };
  if (actAns.selected.length === 0 || actAns.selected[0] === 'action:skip') return;
  shuffleTrashIntoDeck(ctx.s, ctx.player);
}

/** clarity-5 中：你弃置1张牌 */
function* clarity5Middle(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const hand = ctx.candidates({ zone: 'hand', owner: ctx.player });
  const ans = yield { kind: 'select', title: 'clarity-5：你弃置1张牌', min: 1, max: 1, optional: false, candidates: hand };
  if (ans.selected.length === 0) return;
  yield { op: 'discard', uid: ans.selected[0] };
}

registerCardEffects('clarity-0', { valueModifier: { target: 'own-stack', apply: clarity0ValueModifier } });
registerCardEffects('clarity-1', {
  triggers: {
    start: {
      fn: clarity1Start,
      optional: false,
      top: true, // 顶命令：被盖仍触发
      // 修改提示词 23：自己牌库空（正文首个守卫 deckTopAvailable，FAQ 107）→ 无牌可揭示/弃 → 收集前自动跳过
      cond: (s, card) => deckTopAvailable(s, card.owner),
    },
    'before-covered': { fn: clarity1BeforeCovered, optional: false },
  },
  middle: clarity1Middle,
});
registerCardEffects('clarity-2', { middle: clarity2Middle });
registerCardEffects('clarity-3', { middle: clarity3Middle });
registerCardEffects('clarity-4', { middle: clarity4Middle });
registerCardEffects('clarity-5', { middle: clarity5Middle });


