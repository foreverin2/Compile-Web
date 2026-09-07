import { pushLog } from '../../log';
import type { ChoiceCard, EffectCtx, EffectStep, GameState, Line, PlayerId, StepResult } from '../../models/types';
import { registerCardEffects } from '../registry';
import { shuffleDeck, shuffleTrashIntoDeck } from '../../engine/deck';
import { gameBus } from '../../events/bus';

/**
 * 2代 时间 time（关键词：强行弃置、使用弃牌堆）。
 * 权威卡文：src/data/cards2.ts；裁决：docs/批3裁决结果.md（time-0 弃牌堆自选打出触发中指令 /
 * time-1 任意被盖卡 / time-3 随机揭示弃牌堆 1 张后反面打其它线）。引擎扩展 playFromTrash/after-shuffle 已提交。
 */

function opp(p: PlayerId): PlayerId {
  return p === 0 ? 1 : 0;
}

/** 自己弃牌堆 → ChoiceCard 候选（弃牌堆公开：faceUp 卡） */
function trashCandidates(s: GameState, player: PlayerId): ChoiceCard[] {
  return s.players[player].trash.map((c) => ({
    uid: c.uid, defId: c.defId, faceUp: c.faceUp, owner: c.owner, zone: c.zone, line: c.line, pos: c.pos,
    label: '',
  }));
}

/** time-0 中：从弃牌堆中打出1张牌（自选、朝向自选、触发中指令）。将你的弃牌堆洗入牌库（剩余部分） */
function* time0Middle(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const trash = trashCandidates(ctx.s, ctx.player);
  if (trash.length === 0) return; // 无可打
  const tAns = yield { kind: 'select', title: 'time-0：从弃牌堆打出1张牌', min: 1, max: 1, optional: false, candidates: trash };
  if (tAns.selected.length === 0) return;
  const uid = tAns.selected[0];
  const faceAns = yield {
    kind: 'select-action', title: 'time-0：打出朝向', min: 1, max: 1, optional: false, candidates: [],
    actions: ['action:face-up', 'action:face-down'],
  };
  if (faceAns.selected.length === 0) return;
  const faceUp = faceAns.selected[0] === 'action:face-up';
  const card = ctx.s.players[ctx.player].trash.find((c) => c.uid === uid)!;
  const def = card.defId;
  const lines = faceUp ? faceUpProtocolLines(ctx, def) : ([0, 1, 2] as Line[]);
  if (lines.length === 0) return;
  const lAns = yield {
    kind: 'select-line', title: faceUp ? 'time-0：正面打出（须匹配协议线）' : 'time-0：反面打出到任意线',
    min: 1, max: 1, optional: false, candidates: [], lines,
  };
  if (lAns.selected.length === 0) return;
  const line = Number(lAns.selected[0].replace('line:', '')) as Line;
  yield { op: 'playFromTrash', uid, line, faceUp };
  if (ctx.s.players[ctx.player].trash.length > 0) shuffleTrashIntoDeck(ctx.s, ctx.player); // 剩余洗入
}

/** 正面可落线（defId 协议匹配本侧或对手该线协议） */
function faceUpProtocolLines(ctx: EffectCtx, defId: string): (0 | 1 | 2)[] {
  const proto = defId.split('-')[0];
  const foe = opp(ctx.player);
  const out: (0 | 1 | 2)[] = [];
  for (const line of [0, 1, 2] as const) {
    const own = ctx.s.players[ctx.player].protocols[line]?.defId;
    const op = ctx.s.players[foe].protocols[line]?.defId;
    if (proto === own || proto === op) out.push(line);
  }
  return out;
}

/** time-1 中：翻转1张被覆盖的卡牌（裁决 Q3：任意被盖卡）。将牌库所有牌放入弃牌堆（自己牌库清空公开） */
function* time1Middle(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const cand = ctx.candidates({ zone: 'field', covered: true }); // 被盖卡（任意朝向，源卡排除惯例）
  if (cand.length > 0) {
    const tAns = yield { kind: 'select', title: 'time-1：翻转1张被覆盖的卡牌', min: 1, max: 1, optional: false, candidates: cand };
    if (tAns.selected.length > 0) yield { op: 'flip', uid: tAns.selected[0], allowCovered: true };
  }
  // 自己牌库全部 → 弃牌堆（公开 faceUp；直接状态操作——deck.ts 无此 helper，效果内直改）
  const p = ctx.s.players[ctx.player];
  for (const c of p.deck) {
    c.zone = 'trash';
    c.faceUp = true;
    c.secret = false;
    c.line = null;
    c.pos = null;
  }
  p.trash.push(...p.deck);
  p.deck = [];
  pushLog(ctx.s, `P${ctx.player + 1}：牌库全部放入弃牌堆`);
  // time-1 FX：弃牌堆上方时钟 + 牌库卡化作旋转光流汇入弃牌堆（fx-gen2 订阅）
  gameBus.emit({ type: 'time:deck-to-trash', state: ctx.s, payload: { player: ctx.player } });
}

/** time-2 顶（after-shuffle，top:true）：当你切洗牌库时：抽取1张牌。你可以偏转此牌 */
function* time2AfterShuffle(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  yield { op: 'draw', count: 1 };
  const card = ctx.s.players[ctx.player].stacks.flat().find((c) => c.uid === ctx.card.uid);
  if (!card || card.line === null) return;
  const lAns = yield {
    kind: 'select-line', title: 'time-2：你可以偏转此牌', min: 1, max: 1, optional: true, candidates: [],
    lines: ([0, 1, 2] as Line[]).filter((l) => l !== card.line),
  };
  if (lAns.selected.length === 0) return;
  const to = Number(lAns.selected[0].replace('line:', '')) as Line;
  yield { op: 'shift', uid: card.uid, targetLine: to, allowCovered: true };
}

/** time-2 中：若你的弃牌堆有牌，你可以将弃牌堆洗入牌库（可选） */
function* time2Middle(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  if (ctx.s.players[ctx.player].trash.length === 0) return;
  const actAns = yield {
    kind: 'select-action', title: 'time-2：你可以将弃牌堆洗入牌库', min: 1, max: 1, optional: true, candidates: [],
    actions: ['action:shuffle'],
  };
  if (actAns.selected.length === 0) return;
  shuffleTrashIntoDeck(ctx.s, ctx.player);
}

/** time-3 中：随机揭示1张弃牌堆的牌（裁决 Q5：随机非自选），将其正面朝下打出于（至）其它链路。
 *  修改提示词 25：揭示 = 把那张牌的幽灵加入对方手牌查看（Case A），且被揭示牌解除 secret
 *  （双击查看可翻面——reveal op 已统一清 secret）。 */
function* time3Middle(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const trash = ctx.s.players[ctx.player].trash;
  if (trash.length === 0) return;
  const pick = trash[Math.floor(Math.random() * trash.length)];
  const myLine = ctx.card.line;
  const lines = ([0, 1, 2] as Line[]).filter((l) => l !== myLine); // 「其它」= 非 time-3 所在线
  if (lines.length === 0) return;
  yield { op: 'reveal', uid: pick.uid }; // 幽灵给对方查看（Case A：自己的弃牌堆牌）
  const lAns = yield { kind: 'select-line', title: 'time-3：将其正面朝下打出到其它链路', min: 1, max: 1, optional: false, candidates: [], lines };
  if (lAns.selected.length === 0) return;
  const line = Number(lAns.selected[0].replace('line:', '')) as Line;
  yield { op: 'playFromTrash', uid: pick.uid, line, faceUp: false };
}

/** time-4 中：抽2张牌。弃置2张牌（自己） */
function* time4Middle(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  yield { op: 'draw', count: 2 };
  const hand = ctx.candidates({ zone: 'hand', owner: ctx.player });
  if (hand.length === 0) return;
  const ans = yield { kind: 'select', title: 'time-4：弃置2张牌', min: Math.min(2, hand.length), max: 2, optional: false, candidates: hand };
  if (ans.selected.length === 0) return;
  yield { op: 'discardMany', uids: ans.selected };
}

/** time-5 中：你弃置1张牌 */
function* time5Middle(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const hand = ctx.candidates({ zone: 'hand', owner: ctx.player });
  const ans = yield { kind: 'select', title: 'time-5：你弃置1张牌', min: 1, max: 1, optional: false, candidates: hand };
  if (ans.selected.length === 0) return;
  yield { op: 'discard', uid: ans.selected[0] };
}


registerCardEffects('time-0', { middle: time0Middle });
registerCardEffects('time-1', { middle: time1Middle });
registerCardEffects('time-2', {
  middle: time2Middle,
  triggers: { 'after-shuffle': { fn: time2AfterShuffle, optional: true, top: true } },
});
registerCardEffects('time-3', { middle: time3Middle });
registerCardEffects('time-4', { middle: time4Middle });
registerCardEffects('time-5', { middle: time5Middle });



