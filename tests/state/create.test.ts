import { describe, it, expect } from 'vitest';
import type { GameState } from '../../src/core/models/types';
import { createGame, getDraftPool, getCurrentDrafter, performDraftPick, getLineValue } from '../../src/core/state/create';
import { DEMO_PROTOCOLS } from '../../src/data/demo';

describe('create & draft', () => {
  it('creates a draft-phase game with the full demo pool', () => {
    const s = createGame();
    expect(s.phase).toBe('draft');
    expect(getDraftPool(s)).toHaveLength(DEMO_PROTOCOLS.length);
    expect(getCurrentDrafter(s)).toBe(0);
  });

  it('follows 1-2-2-1 draft order', () => {
    const s = createGame();
    const order: number[] = [];
    while (s.phase === 'draft') {
      order.push(getCurrentDrafter(s));
      performDraftPick(s, getDraftPool(s)[0].defId);
    }
    expect(order).toEqual([0, 1, 1, 0, 0, 1]);
  });

  it('sets up both players with 3 protocols, 18-card decks, 5-card hands', () => {
    const s = createGame();
    while (s.phase === 'draft') {
      performDraftPick(s, getDraftPool(s)[0].defId);
    }
    expect(s.phase).toBe('turn');
    for (const p of s.players) {
      expect(p.protocols).toHaveLength(3);
      // 18 张牌库（3 协议 × 每协议 6 张真实卡），抽 5 张起始手牌后牌库余 13
      expect(p.deck.length + p.hand.length).toBe(18);
      expect(p.deck).toHaveLength(13);
      expect(p.hand).toHaveLength(5);
    }
  });

  it('shuffles decks so opening hands differ across games', () => {
    const openingHand = (): string[] => {
      const s = createGame();
      while (s.phase === 'draft') {
        performDraftPick(s, getDraftPool(s)[0].defId);
      }
      return s.players[0].hand.map((c) => c.defId);
    };
    const first = openingHand();
    // 洗牌后两局手牌相同的概率极低；为防极端巧合，最多比对 3 局
    let differs = false;
    for (let i = 0; i < 3; i++) {
      if (JSON.stringify(openingHand()) !== JSON.stringify(first)) {
        differs = true;
        break;
      }
    }
    expect(differs).toBe(true);
  });

  it('line value sums the stack', () => {
    const s = createGame();
    while (s.phase === 'draft') {
      performDraftPick(s, getDraftPool(s)[0].defId);
    }
    const p = s.players[0];
    // 手动放两张卡到线 0
    p.stacks[0] = [
      { uid: 'a', defId: 'spirit-1', owner: 0, faceUp: true, zone: 'field', line: 0, pos: 0 },
      { uid: 'b', defId: 'fire-1', owner: 0, faceUp: true, zone: 'field', line: 0, pos: 1 },
    ];
    expect(getLineValue(s, 0, 0)).toBe(2);
  });
});
