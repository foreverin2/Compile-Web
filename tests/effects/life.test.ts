import { describe, it, expect } from 'vitest';
import type { GameState, Line } from '../../src/core/models/types';
import { executeAction, getLegalActions } from '../../src/core/game';
import { makeCard, pickFirst, resolveAllChoices, draftLifeP1, advanceToStep } from '../helpers';

function lifeLine(s: GameState): Line {
  const idx = s.players[0].protocols.findIndex((p) => p.defId === 'life');
  return idx as Line;
}

describe('life protocol effects', () => {
  it('life-0: plays deck top face-down to each line where you have a card', () => {
    const s = draftLifeP1();
    advanceToStep(s, 0, 'action');
    s.players[0].hand = [makeCard('life-0', 0, 'hand')];
    const other = makeCard('life-5', 0, 'field', true, 1, 0);
    s.players[0].stacks[1] = [other];
    const deckBefore = s.players[0].deck.length; // 13
    const top1 = s.players[0].deck[deckBefore - 1]; // 先打另线 → 先 pop
    const top2 = s.players[0].deck[deckBefore - 2]; // 本线最后打 → 后 pop
    const card = s.players[0].hand[0];
    executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: true, line: lifeLine(s) });
    resolveAllChoices(s, pickFirst); // 无选择请求（全自动）
    const ll = lifeLine(s); // 0
    expect(s.players[0].stacks[1].map((c) => c.uid)).toEqual([other.uid, top1.uid]); // 有牌的另线获得反面牌堆顶
    expect(s.players[0].stacks[1][1].faceUp).toBe(false);
    // 本线（life-0 所在列）也"你有牌"→ 最后打本线：反面卡盖住 life-0（顶指令 FAQ 139 改为
    // 结束阶段删除——被盖后仍留在场上，等 end 触发）
    expect(s.players[0].stacks[ll].map((c) => c.uid)).toEqual([card.uid, top2.uid]);
    expect(s.players[0].stacks[ll][0].faceUp).toBe(true); // life-0 正面（被盖）
    expect(s.players[0].stacks[ll][1].faceUp).toBe(false); // 盖住它的反面卡
    expect(s.players[0].trash).toHaveLength(0); // 不立即删除
    expect(s.players[0].deck).toHaveLength(deckBefore - 2);
    expect(s.pendingEffects).toHaveLength(0);
    expect(s.pendingPlay).toHaveLength(0);
  });

  it('life-0 top (FAQ 139): when covered, deletes itself at the end step', () => {
    const s = draftLifeP1();
    advanceToStep(s, 0, 'action');
    const life0 = makeCard('life-0', 0, 'field', true, 1, 0);
    s.players[0].stacks[1] = [life0];
    const played = makeCard('life-5', 0, 'hand');
    s.players[0].hand = [played];
    executeAction(s, 0, 'play', { cardUid: played.uid, faceUp: false, line: 1 }); // 反面盖住 life-0
    resolveAllChoices(s, pickFirst);
    // 被盖后不立即删（end 触发）；life-0 顶命令被盖仍生效（top 标志）
    expect(s.players[0].trash).toHaveLength(0);
    expect(s.players[0].stacks[1].map((c) => c.uid)).toEqual([life0.uid, played.uid]);
    // 推进到 end 步骤 → 收集被盖 life-0 的 end 触发（顶命令）
    advanceToStep(s, 0, 'end');
    const legal = getLegalActions(s, 0);
    const trig = legal.find((a) => a.kind === 'resolve-trigger');
    expect(trig?.cardUid).toBe(life0.uid);
    executeAction(s, 0, 'resolve-trigger', { cardUid: life0.uid });
    expect(s.players[0].trash.map((c) => c.uid)).toEqual([life0.uid]); // 结束阶段删除自己
    expect(s.players[0].stacks[1].map((c) => c.uid)).toEqual([played.uid]);
    expect(s.pendingEffects).toHaveLength(0);
  });

  it('life-1: flips two cards — second select can re-target the first', () => {
    const s = draftLifeP1();
    advanceToStep(s, 0, 'action');
    s.players[0].hand = [makeCard('life-1', 0, 'hand')];
    const a = makeCard('metal-2', 1, 'field', true, 1, 0); // 未注册协议：翻正不连锁
    const b = makeCard('metal-1', 1, 'field', false, 2, 0);
    s.players[1].stacks[1] = [a];
    s.players[1].stacks[2] = [b];
    const card = s.players[0].hand[0];
    executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: true, line: lifeLine(s) });
    const p1 = s.pendingEffects[s.pendingEffects.length - 1];
    expect(p1.prompt?.kind).toBe('select');
    expect(p1.prompt?.title).toContain('翻转1张牌');
    expect(p1.prompt?.candidates.map((c) => c.uid).sort()).toEqual([a.uid, b.uid].sort());
    executeAction(s, 0, 'effect-choice', { promptId: p1.id, choice: [a.uid] });
    expect(a.faceUp).toBe(false); // 第 1 张翻转
    // 第 2 次选择：同一张卡仍可再选（reference excludeSelf:false，无已选排除）
    const p2 = s.pendingEffects[s.pendingEffects.length - 1];
    expect(p2.prompt?.kind).toBe('select');
    expect(p2.prompt?.title).toContain('再翻转1张牌');
    executeAction(s, 0, 'effect-choice', { promptId: p2.id, choice: [a.uid] });
    expect(a.faceUp).toBe(true); // 第 2 张（同卡）翻回正面
    expect(b.faceUp).toBe(false); // 未选中的卡不受影响
    expect(s.pendingEffects).toHaveLength(0);
  });

  it('life-2: draw 1, then optional flip of a face-down card (flip path)', () => {
    const s = draftLifeP1();
    advanceToStep(s, 0, 'action');
    s.players[0].hand = [makeCard('life-2', 0, 'hand')];
    const fd = makeCard('metal-5', 1, 'field', false, 1, 0); // 未注册协议：翻正不连锁
    s.players[1].stacks[1] = [fd];
    const card = s.players[0].hand[0];
    executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: true, line: lifeLine(s) });
    expect(s.players[0].hand).toHaveLength(1); // 抽 1
    const p = s.pendingEffects[s.pendingEffects.length - 1];
    expect(p.prompt?.kind).toBe('select');
    expect(p.prompt?.optional).toBe(true);
    expect(p.prompt?.candidates.map((c) => c.uid)).toEqual([fd.uid]); // 只列反面未覆盖卡
    executeAction(s, 0, 'effect-choice', { promptId: p.id, choice: [fd.uid] });
    expect(fd.faceUp).toBe(true);
    expect(s.pendingEffects).toHaveLength(0);
  });

  it('life-2: optional flip can be skipped', () => {
    const s = draftLifeP1();
    advanceToStep(s, 0, 'action');
    s.players[0].hand = [makeCard('life-2', 0, 'hand')];
    const fd = makeCard('metal-5', 1, 'field', false, 1, 0);
    s.players[1].stacks[1] = [fd];
    const card = s.players[0].hand[0];
    executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: true, line: lifeLine(s) });
    const p = s.pendingEffects[s.pendingEffects.length - 1];
    executeAction(s, 0, 'effect-choice', { promptId: p.id, choice: [] }); // 跳过
    expect(fd.faceUp).toBe(false);
    expect(s.pendingEffects).toHaveLength(0);
  });

  it('life-2: no face-down card on field → optional flip fizzles, draw still happens', () => {
    const s = draftLifeP1();
    advanceToStep(s, 0, 'action');
    s.players[0].hand = [makeCard('life-2', 0, 'hand')];
    const card = s.players[0].hand[0];
    executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: true, line: lifeLine(s) });
    resolveAllChoices(s, pickFirst);
    expect(s.pendingEffects).toHaveLength(0); // 空候选自动跳过，不挂起
    expect(s.players[0].hand).toHaveLength(1); // 抽 1 仍结算
  });

  it('life-3 bottom: before-covered plays the deck top face-down onto a chosen other line', () => {
    const s = draftLifeP1();
    advanceToStep(s, 0, 'action');
    const life3 = makeCard('life-3', 0, 'field', true, 1, 0);
    s.players[0].stacks[1] = [life3];
    const deckTop = s.players[0].deck[s.players[0].deck.length - 1];
    const played = makeCard('life-5', 0, 'hand');
    s.players[0].hand = [played];
    executeAction(s, 0, 'play', { cardUid: played.uid, faceUp: false, line: 1 }); // 盖住 life-3
    const p = s.pendingEffects[s.pendingEffects.length - 1];
    expect(p.prompt?.kind).toBe('select-line');
    expect(p.prompt?.lines).toEqual([0, 2]); // 排除 life-3 所在线 1
    executeAction(s, 0, 'effect-choice', { promptId: p.id, choice: ['line:2'] });
    expect(deckTop.zone).toBe('field');
    expect(deckTop.line).toBe(2);
    expect(deckTop.faceUp).toBe(false);
    expect(s.players[0].stacks[2].map((c) => c.uid)).toContain(deckTop.uid);
    expect(s.players[0].stacks[1].map((c) => c.uid)).toEqual([life3.uid, played.uid]); // life-3 本身不被删除
    expect(s.pendingEffects).toHaveLength(0);
    expect(s.pendingPlay).toHaveLength(0);
  });

  it('life-4: draws 1 only when it covers a card', () => {
    const s = draftLifeP1();
    advanceToStep(s, 0, 'action');
    s.players[0].hand = [makeCard('life-4', 0, 'hand')];
    const below = makeCard('life-5', 0, 'field', true, 0, 0);
    s.players[0].stacks[0] = [below];
    const card = s.players[0].hand[0];
    executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: true, line: lifeLine(s) }); // 盖住 below
    resolveAllChoices(s, pickFirst);
    expect(s.players[0].hand).toHaveLength(1); // 此牌盖住了某张牌 → 抽 1
    expect(s.players[0].stacks[0].map((c) => c.uid)).toEqual([below.uid, card.uid]);
    expect(s.pendingEffects).toHaveLength(0);
  });

  it('life-4: no card beneath → no draw', () => {
    const s = draftLifeP1();
    advanceToStep(s, 0, 'action');
    s.players[0].hand = [makeCard('life-4', 0, 'hand')];
    const card = s.players[0].hand[0];
    executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: true, line: lifeLine(s) }); // 空线
    resolveAllChoices(s, pickFirst);
    expect(s.players[0].hand).toHaveLength(0); // 未盖住任何牌 → 不抽
    expect(s.pendingEffects).toHaveLength(0);
  });

  it('life-5: discard 1 from hand', () => {
    const s = draftLifeP1();
    advanceToStep(s, 0, 'action');
    s.players[0].hand = [makeCard('life-5', 0, 'hand'), makeCard('life-1', 0, 'hand')];
    const target = s.players[0].hand.find((c) => c.defId === 'life-5')!;
    const other = s.players[0].hand.find((c) => c.defId !== 'life-5')!;
    executeAction(s, 0, 'play', { cardUid: target.uid, faceUp: true, line: lifeLine(s) });
    resolveAllChoices(s, (p) => [other.uid]); // 弃 life-1
    expect(s.players[0].trash.map((c) => c.uid)).toEqual([other.uid]);
    expect(s.players[0].hand).toHaveLength(0);
    expect(s.players[0].stacks[lifeLine(s)].map((c) => c.uid)).toEqual([target.uid]);
  });
});
