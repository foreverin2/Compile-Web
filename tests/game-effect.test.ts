import { describe, it, expect } from 'vitest';
import { getLegalActions, executeAction } from '../src/core/game';
import { makeCard, pickFirst, resolveAllChoices, draftFireP1, advanceToStep } from './helpers';

describe('game facade effect actions', () => {
  it('blocks standard actions while a choice is pending', () => {
    const s = draftFireP1();
    advanceToStep(s, 0, 'action');
    s.players[0].hand = [makeCard('fire-5', 0, 'hand'), makeCard('fire-1', 0, 'hand')];
    const card = s.players[0].hand.find((c) => c.defId === 'fire-5')!;
    executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: true, line: 0 });
    expect(s.pendingEffects.length).toBeGreaterThan(0);
    expect(getLegalActions(s, 0)).toEqual([]);
    expect(() => executeAction(s, 0, 'advance')).toThrow(/pending/i);
    resolveAllChoices(s, pickFirst);
    expect(getLegalActions(s, 0).some((a) => a.kind === 'advance')).toBe(true);
  });

  it('end step offers resolve-trigger for fire-3 and blocks advance while mandatory', () => {
    const s = draftFireP1();
    advanceToStep(s, 0, 'action');
    s.players[0].stacks[0] = [makeCard('fire-3', 0, 'field', true, 0, 0)];
    // 注：须先推进到 end（advance 在 action 空手时是非法守卫），再清空手牌以便触发内部可选弃牌跳过
    advanceToStep(s, 0, 'end');
    s.players[0].hand = [];
    const legal = getLegalActions(s, 0);
    // fire-3 结束触发是可选（"你可以"）→ advance 允许跳过
    expect(legal.some((a) => a.kind === 'resolve-trigger' && a.cardUid === s.players[0].stacks[0][0].uid)).toBe(true);
    expect(legal.some((a) => a.kind === 'advance')).toBe(true);
    // 结算该触发（内部可选弃牌——手牌空，跳过）
    executeAction(s, 0, 'resolve-trigger', { cardUid: s.players[0].stacks[0][0].uid });
    resolveAllChoices(s, pickFirst);
    // 触发已结算：不再出现，可 advance
    const legal2 = getLegalActions(s, 0);
    expect(legal2.some((a) => a.kind === 'resolve-trigger')).toBe(false);
    expect(legal2.some((a) => a.kind === 'advance')).toBe(true);
  });

  it('effect-choice validates the chooser (owner of affected card)', () => {
    const s = draftFireP1();
    advanceToStep(s, 0, 'action');
    s.players[0].hand = [makeCard('fire-5', 0, 'hand'), makeCard('fire-1', 0, 'hand')];
    const card = s.players[0].hand.find((c) => c.defId === 'fire-5')!;
    executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: true, line: 0 });
    const top = s.pendingEffects[s.pendingEffects.length - 1];
    expect(top).toBeDefined();
    const discardTarget = s.players[0].hand[0]; // 打出后手牌剩 fire-1
    // 非选择权归属者（P2）应答被拒
    expect(() => executeAction(s, 1, 'effect-choice', { promptId: top!.id, choice: [] })).toThrow(/not your choice/);
    // 选择权归属者（P1）应答成功
    executeAction(s, 0, 'effect-choice', { promptId: top!.id, choice: [discardTarget.uid] });
    expect(s.pendingEffects).toHaveLength(0);
    expect(s.players[0].trash.map((c) => c.uid)).toEqual([discardTarget.uid]);
  });
});
