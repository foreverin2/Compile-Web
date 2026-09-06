import type { EffectCtx, EffectStep, GameState, Line, PlayerId, StepResult } from '../../models/types';
import { registerCardEffects } from '../registry';
import { findCard, nextEffectId } from '../context';
import { shuffleDeck } from '../../engine/deck';
import { executeCompileBody } from '../../rules/compile-body';
import { controlRearrangeFlow } from '../control-rearrange-flow';

/**
 * 2代 统一 unity（关键词：覆盖、翻转、编译）。
 * 权威卡文：src/data/cards2.ts；裁决：docs/批3裁决结果.md（Q14 unity-1 走完整编译 /
 * Q15 unity-0 二选一 / Q16 unity-4 揭示抽全部统一卡）。
 * unity-1 底「统一卡牌可以正面朝上打在此链路」：引擎 restrictions.unity1UncoveredLine 放行（已提交）。
 */

function opp(p: PlayerId): PlayerId {
  return p === 0 ? 1 : 0;
}

/** 场上（双方链路）统一卡总数 */
function unityCount(s: GameState): number {
  let n = 0;
  for (const owner of [0, 1] as PlayerId[]) {
    for (const line of [0, 1, 2] as Line[]) {
      for (const c of s.players[owner].stacks[line]) {
        if (c.defId.startsWith('unity-')) n++;
      }
    }
  }
  return n;
}

/** 二选一「翻转或抽取1张牌」（选择权=效果属主） */
function* flipOrDraw(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const actAns = yield {
    kind: 'select-action', title: 'unity：翻转1张牌或抽取1张牌', min: 1, max: 1, optional: false, candidates: [],
    actions: ['action:flip', 'action:draw'],
  };
  if (actAns.selected.length === 0) return;
  if (actAns.selected[0] === 'action:draw') {
    yield { op: 'draw', count: 1 };
    return;
  }
  const cand = ctx.candidates({ zone: 'field' });
  const tAns = yield { kind: 'select', title: 'unity：翻转1张牌', min: 1, max: 1, optional: false, candidates: cand };
  if (tAns.selected.length === 0) return;
  yield { op: 'flip', uid: tAns.selected[0] };
}

/** unity-0 中：若场上有其它统一牌，翻转或抽取1张牌 */
function* unity0Middle(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  if (unityCount(ctx.s) < 2) return; // 至少本卡 + 其它 1 张
  yield* flipOrDraw(ctx);
}

/** unity-0 底（before-covered）：当此牌被统一牌覆盖时：翻转或抽取1张牌（覆盖者=浮空中的 unity 卡） */
function* unity0BeforeCovered(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const incoming = ctx.s.pendingPlay[0]?.card;
  if (!incoming || !incoming.defId.startsWith('unity-')) return; // 覆盖者非统一牌 → 不触发
  yield* flipOrDraw(ctx);
}

/** unity-1 顶（start，top:true）：回合开始：若此牌被覆盖，你可以偏转此牌 */
function* unity1Start(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const card = findCard(ctx.s, ctx.card.uid);
  if (!card || card.line === null) return;
  const stack = ctx.s.players[card.owner].stacks[card.line];
  if (stack[stack.length - 1]?.uid === card.uid) return; // 未覆盖 → 条件不满足
  const lAns = yield {
    kind: 'select-line', title: 'unity-1：此牌被覆盖，你可以偏转它', min: 1, max: 1, optional: true, candidates: [],
    lines: ([0, 1, 2] as Line[]).filter((l) => l !== card.line),
  };
  if (lAns.selected.length === 0) return;
  const to = Number(lAns.selected[0].replace('line:', '')) as Line;
  yield { op: 'shift', uid: card.uid, targetLine: to, allowCovered: true };
}

/** unity-1 中：若场上有5张或以上的统一卡牌，编译统一协议并删除那条链路中所有的卡牌（裁决 Q14：完整编译） */
function* unity1Middle(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  if (unityCount(ctx.s) < 5) return;
  const protos = ctx.s.players[ctx.player].protocols;
  const idx = protos.findIndex((p) => p.defId === 'unity');
  if (idx === -1) return;
  // 效果触发的编译同样走控制组件规则：执行者持有 → 归还中立 + 可重排任意一方协议，
  // 随后执行编译本体（删卡/翻面/重编译抽牌/胜利判定；after-compile 连锁已接线）
  yield* controlRearrangeFlow(ctx.s, ctx.player, 'unity-1 编译');
  executeCompileBody(ctx.s, ctx.player, idx as Line);
}

/** unity-2 中：抽取与场上统一牌数目相等的牌 */
function* unity2Middle(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const n = unityCount(ctx.s);
  if (n > 0) yield { op: 'draw', count: n };
}

/** unity-3 中：如果场上有其它统一牌，你可以翻转1张正面朝上的卡牌 */
function* unity3Middle(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  if (unityCount(ctx.s) < 2) return;
  const cand = ctx.candidates({ zone: 'field' }).filter((c) => c.faceUp);
  const tAns = yield { kind: 'select', title: 'unity-3：你可以翻转1张正面朝上的卡牌', min: 1, max: 1, optional: true, candidates: cand };
  if (tAns.selected.length === 0) return;
  yield { op: 'flip', uid: tAns.selected[0] };
}

/** unity-4 顶（start，top:true）：回合开始：若你没有手牌，揭示你的牌库，抽取其中所有的统一卡牌，然后
 *  切洗（txt 修改记录 2026-09-05【5】：回合结束→回合开始；英文 Start: If you hand is empty, reveal
 *  your deck, draw all Unity cards from it, and shuffle your deck.） */
function* unity4Start(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  if (ctx.s.players[ctx.player].hand.length > 0) return;
  const deck = ctx.s.players[ctx.player].deck;
  if (deck.length === 0) return;
  ctx.s.deckReveals.push({ id: nextEffectId(), player: ctx.player, whole: true, expiresAtTurn: ctx.s.turnCount + 2 });
  const unityUids = deck.filter((c) => c.defId.startsWith('unity-')).map((c) => c.uid);
  for (const uid of unityUids) yield { op: 'drawFromDeck', uid }; // 全部统一卡抽入手
  shuffleDeck(ctx.s, ctx.player);
}

/** unity-5 中：你弃置1张牌 */
function* unity5Middle(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const hand = ctx.candidates({ zone: 'hand', owner: ctx.player });
  const ans = yield { kind: 'select', title: 'unity-5：你弃置1张牌', min: 1, max: 1, optional: false, candidates: hand };
  if (ans.selected.length === 0) return;
  yield { op: 'discard', uid: ans.selected[0] };
}


registerCardEffects('unity-0', {
  middle: unity0Middle,
  triggers: { 'before-covered': { fn: unity0BeforeCovered, optional: false } },
});
registerCardEffects('unity-1', {
  middle: unity1Middle,
  triggers: { start: { fn: unity1Start, optional: true, top: true } },
});
// unity-1 底放行：引擎 restrictions.unity1UncoveredLine
registerCardEffects('unity-2', { middle: unity2Middle });
registerCardEffects('unity-3', { middle: unity3Middle });
registerCardEffects('unity-4', { triggers: { start: { fn: unity4Start, optional: false, top: true } } });
registerCardEffects('unity-5', { middle: unity5Middle });


