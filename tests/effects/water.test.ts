import { describe, it, expect } from 'vitest';
import type { GameState, Line } from '../../src/core/models/types';
import { executeAction } from '../../src/core/game';
import { makeCard, pickFirst, resolveAllChoices, draftWaterP1, advanceToStep } from '../helpers';

function waterLine(s: GameState): Line {
  const idx = s.players[0].protocols.findIndex((p) => p.defId === 'water');
  return idx as Line;
}

describe('water protocol effects', () => {
  it('water-0: flip another card, then flip this card', () => {
    const s = draftWaterP1();
    advanceToStep(s, 0, 'action');
    const other = makeCard('water-1', 1, 'field', true, 1, 0);
    s.players[1].stacks[1] = [other];
    s.players[0].hand = [makeCard('water-0', 0, 'hand')];
    const card = s.players[0].hand[0];
    executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: true, line: waterLine(s) });
    // 候选：场上未被覆盖的另1张牌（源卡 water-0 被候选排除）
    const p = s.pendingEffects[s.pendingEffects.length - 1];
    expect(p.prompt?.kind).toBe('select');
    expect(p.prompt?.candidates.map((c) => c.uid)).toEqual([other.uid]);
    executeAction(s, 0, 'effect-choice', { promptId: p.id, choice: [other.uid] });
    expect(other.faceUp).toBe(false); // 另1张牌翻转
    expect(card.faceUp).toBe(false); // 此牌（自身）翻转
    expect(s.pendingEffects).toHaveLength(0);
  });

  it('water-0: no other field card fizzles the flip select (self flip still happens)', () => {
    const s = draftWaterP1();
    advanceToStep(s, 0, 'action');
    s.players[0].hand = [makeCard('water-0', 0, 'hand')];
    const card = s.players[0].hand[0];
    executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: true, line: waterLine(s) });
    // 场上只有刚打出的 water-0（结算中源卡）→ 翻转候选为空 → 该步骤 fizzle（不挂起）
    resolveAllChoices(s, pickFirst);
    expect(s.pendingEffects).toHaveLength(0);
    expect(card.faceUp).toBe(false); // 自身翻转仍结算
  });

  it('water-1: plays the deck top face-down onto each of the two other lines (deck -2)', () => {
    const s = draftWaterP1();
    advanceToStep(s, 0, 'action');
    s.players[0].hand = [makeCard('water-1', 0, 'hand')];
    const deckBefore = s.players[0].deck.length; // 13
    const top1 = s.players[0].deck[deckBefore - 1]; // 先结算 → 先 pop → 第 1 条另线
    const top2 = s.players[0].deck[deckBefore - 2];
    const card = s.players[0].hand[0];
    executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: true, line: waterLine(s) });
    resolveAllChoices(s, pickFirst); // 无选择请求（全自动）
    const wl = waterLine(s);
    const others = ([0, 1, 2] as Line[]).filter((l) => l !== wl);
    expect(s.players[0].stacks[others[0]].map((c) => c.uid)).toEqual([top1.uid]);
    expect(s.players[0].stacks[others[1]].map((c) => c.uid)).toEqual([top2.uid]);
    for (const l of others) expect(s.players[0].stacks[l][0].faceUp).toBe(false); // 反面
    expect(s.players[0].deck).toHaveLength(deckBefore - 2);
    expect(s.players[0].stacks[wl].map((c) => c.uid)).toEqual([card.uid]); // 本线不受影响
    expect(s.pendingEffects).toHaveLength(0);
    expect(s.pendingPlay).toHaveLength(0);
  });

  it('water-2: draw 2, then rearrange protocols (swap positions 0 and 2, compiled travels)', () => {
    const s = draftWaterP1();
    advanceToStep(s, 0, 'action');
    s.players[0].hand = [makeCard('water-2', 0, 'hand')];
    s.players[0].protocols[0].compiled = true; // 位置 0 已编译
    const before = s.players[0].protocols.map((p) => ({ defId: p.defId, compiled: p.compiled }));
    const card = s.players[0].hand[0];
    executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: true, line: waterLine(s) });
    expect(s.players[0].hand).toHaveLength(2); // 抽 2
    // 第 1 个位置：可选全部 3 个
    const p1 = s.pendingEffects[s.pendingEffects.length - 1];
    expect(p1.prompt?.kind).toBe('select-line');
    expect(p1.prompt?.lines).toEqual([0, 1, 2]);
    expect(p1.prompt?.title).toContain('第1个位置');
    executeAction(s, 0, 'effect-choice', { promptId: p1.id, choice: ['line:0'] });
    // 第 2 个位置：排除第 1 个
    const p2 = s.pendingEffects[s.pendingEffects.length - 1];
    expect(p2.prompt?.kind).toBe('select-line');
    expect(p2.prompt?.lines).toEqual([1, 2]);
    expect(p2.prompt?.title).toContain('第2个位置');
    executeAction(s, 0, 'effect-choice', { promptId: p2.id, choice: ['line:2'] });
    expect(s.players[0].protocols[0].defId).toBe(before[2].defId);
    expect(s.players[0].protocols[2].defId).toBe(before[0].defId);
    expect(s.players[0].protocols[0].compiled).toBe(before[2].compiled);
    expect(s.players[0].protocols[2].compiled).toBe(before[0].compiled);
    expect(s.players[0].protocols[1].defId).toBe(before[1].defId);
    expect(s.pendingEffects).toHaveLength(0);
  });

  it('water-3: returns all uncovered 2-point cards on its line to their owners; value-3 card stays', () => {
    const s = draftWaterP1();
    advanceToStep(s, 0, 'action');
    s.players[1].hand = []; // 清空起始手牌：断言"回持有者手牌"为精确结果
    s.players[0].hand = [makeCard('water-3', 0, 'hand')];
    // 对手同线（线 0 = 水3 所在列）：底层正面 2 分卡 + 顶层反面卡（反面=2 分）→ 逐张回手
    const facedown = makeCard('water-5', 1, 'field', false, 0, 0);
    const val2 = makeCard('metal-2', 1, 'field', true, 0, 1); // 2 分且无中指令（未注册协议 → 揭开不连锁）
    s.players[1].stacks[0] = [val2, facedown];
    const card = s.players[0].hand[0];
    executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: true, line: waterLine(s) });
    resolveAllChoices(s, pickFirst); // 自动逐张回手（无选择请求）
    expect(s.players[1].hand.map((c) => c.uid).sort()).toEqual([facedown.uid, val2.uid].sort());
    expect(s.players[1].stacks[0]).toHaveLength(0);
    expect(s.players[0].stacks[waterLine(s)].map((c) => c.uid)).toEqual([card.uid]); // 3 分的水3留在场上
    expect(s.pendingEffects).toHaveLength(0);
  });

  it('water-3: a value-3 top on the line is not returned', () => {
    const s = draftWaterP1();
    advanceToStep(s, 0, 'action');
    s.players[1].hand = [];
    s.players[0].hand = [makeCard('water-3', 0, 'hand')];
    const val3 = makeCard('metal-3', 1, 'field', true, 0, 0);
    s.players[1].stacks[0] = [val3];
    const card = s.players[0].hand[0];
    executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: true, line: waterLine(s) });
    resolveAllChoices(s, pickFirst);
    expect(s.players[1].hand).toHaveLength(0); // 未回手
    expect(s.players[1].stacks[0].map((c) => c.uid)).toEqual([val3.uid]);
    expect(s.pendingEffects).toHaveLength(0);
  });

  it('water-4: returns 1 of your own uncovered cards (opponent cards not selectable)', () => {
    const s = draftWaterP1();
    advanceToStep(s, 0, 'action');
    s.players[0].hand = [makeCard('water-4', 0, 'hand')];
    const own = makeCard('water-0', 0, 'field', true, 1, 0);
    const opp = makeCard('water-1', 1, 'field', true, 1, 0);
    s.players[0].stacks[1] = [own];
    s.players[1].stacks[1] = [opp];
    const card = s.players[0].hand[0];
    executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: true, line: waterLine(s) });
    const p = s.pendingEffects[s.pendingEffects.length - 1];
    expect(p.prompt?.kind).toBe('select');
    expect(p.prompt?.candidates.map((c) => c.uid)).toEqual([own.uid]); // 只列自己的未覆盖卡
    executeAction(s, 0, 'effect-choice', { promptId: p.id, choice: [own.uid] });
    expect(own.zone).toBe('hand');
    expect(s.players[0].hand.map((c) => c.uid)).toContain(own.uid);
    expect(s.players[0].stacks[1]).toHaveLength(0);
    expect(opp.zone).toBe('field'); // 对手卡不受影响
    expect(s.pendingEffects).toHaveLength(0);
  });

  it('water-5: discard 1 from hand', () => {
    const s = draftWaterP1();
    advanceToStep(s, 0, 'action');
    s.players[0].hand = [makeCard('water-5', 0, 'hand'), makeCard('water-1', 0, 'hand')];
    const target = s.players[0].hand.find((c) => c.defId === 'water-5')!;
    const other = s.players[0].hand.find((c) => c.defId !== 'water-5')!;
    executeAction(s, 0, 'play', { cardUid: target.uid, faceUp: true, line: waterLine(s) });
    resolveAllChoices(s, (p) => [other.uid]); // 弃 water-1
    expect(s.players[0].trash.map((c) => c.uid)).toEqual([other.uid]);
    expect(s.players[0].hand).toHaveLength(0);
    expect(s.players[0].stacks[waterLine(s)].map((c) => c.uid)).toEqual([target.uid]);
  });
});
