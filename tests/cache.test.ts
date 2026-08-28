import { describe, it, expect } from 'vitest';
import { getLegalActions, executeAction } from '../src/core/game';
import { makeCard, draftFireP1, advanceToStep, resolveAllChoices } from './helpers';

describe('check-cache player choice', () => {
  it('offers clear-cache (no advance) when hand exceeds 5 at check-cache', () => {
    const s = draftFireP1();
    advanceToStep(s, 0, 'action');
    s.players[0].hand.push(makeCard('fire-1', 0, 'hand'), makeCard('fire-2', 0, 'hand'));
    advanceToStep(s, 0, 'check-cache');
    expect(s.players[0].hand.length).toBe(7);
    const legal = getLegalActions(s, 0);
    expect(legal.some((a) => a.kind === 'clear-cache')).toBe(true);
    expect(legal.some((a) => a.kind === 'advance')).toBe(false);
    expect(() => executeAction(s, 0, 'advance')).toThrow(/cache/i);
  });

  it('player selects which cards to discard down to 5, then advances', () => {
    const s = draftFireP1();
    advanceToStep(s, 0, 'action');
    const extra1 = makeCard('fire-1', 0, 'hand');
    const extra2 = makeCard('fire-2', 0, 'hand');
    s.players[0].hand.push(extra1, extra2);
    advanceToStep(s, 0, 'check-cache');
    executeAction(s, 0, 'clear-cache');
    const top = s.pendingEffects[s.pendingEffects.length - 1];
    expect(top).toBeDefined();
    expect(top!.prompt?.title).toContain('清理缓存');
    expect(top!.prompt?.min).toBe(2);
    expect(top!.prompt?.max).toBe(2);
    // 玩家自选弃哪两张（弃 extra1 + extra2，保留起手 5 张）
    resolveAllChoices(s, () => [extra1.uid, extra2.uid]);
    expect(s.players[0].hand).toHaveLength(5);
    expect(s.players[0].trash.map((c) => c.uid)).toEqual([extra1.uid, extra2.uid]);
    expect(s.step).toBe('end'); // 清完缓存自动推进到结束阶段
  });

  it('advance passes through check-cache without prompt when hand <= 5', () => {
    const s = draftFireP1();
    advanceToStep(s, 0, 'action');
    advanceToStep(s, 0, 'check-cache');
    expect(s.players[0].hand.length).toBeLessThanOrEqual(5);
    const legal = getLegalActions(s, 0);
    expect(legal.some((a) => a.kind === 'clear-cache')).toBe(false);
    executeAction(s, 0, 'advance');
    expect(s.step).toBe('end');
  });
});
