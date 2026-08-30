import { describe, it, expect } from 'vitest';
import type { GameState } from '../../src/core/models/types';
import { createGame, getDraftPool, getCurrentDrafter, performDraftPick, getLineValue, cardPointValue } from '../../src/core/state/create';
import { makeCard } from '../helpers';
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

  it('cardPointValue: face-up card = printed def value', () => {
    const s = createGame();
    const card = makeCard('light-3', 0, 'field', true, 1, 0);
    s.players[0].stacks[1] = [card];
    expect(cardPointValue(s, card)).toBe(3);
  });

  it('cardPointValue: face-down card on a plain line = 2', () => {
    const s = createGame();
    const card = makeCard('light-3', 0, 'field', false, 1, 0);
    s.players[0].stacks[1] = [card];
    expect(cardPointValue(s, card)).toBe(2);
  });

  it('cardPointValue: face-down card on a darkness-2 line = 4 (not hardcoded 2)', () => {
    const s = createGame();
    // 同线正面 darkness-2（被覆盖但正面朝上 → 常驻生效）
    const dark2 = makeCard('darkness-2', 0, 'field', true, 1, 0);
    const card = makeCard('light-3', 0, 'field', false, 1, 1);
    s.players[0].stacks[1] = [dark2, card];
    expect(cardPointValue(s, card)).toBe(4);
  });

  it('cardPointValue: a trash card is public & face-up → printed value (6)', () => {
    const s = createGame();
    // 删除进弃牌堆：delete op 置 zone=trash、faceUp=true（弃牌堆公开）→ 抽牌面分值
    const card = makeCard('metal-6', 0, 'trash', true, null, 0);
    s.players[0].trash.push(card);
    expect(cardPointValue(s, card)).toBe(6);
  });

  it('cardPointValue: a deck card with faceUp=false is secret → 2', () => {
    const s = createGame();
    const card = makeCard('metal-6', 0, 'deck', false, null, 0);
    s.players[0].deck.push(card);
    expect(cardPointValue(s, card)).toBe(2);
  });

  it('cardPointValue: a deck card is secret regardless of the faceUp flag → 2 (zone guard)', () => {
    const s = createGame();
    // 即使某条入牌库路径漏设 faceUp=false（翻转后正面标志残留）→ 牌库仍是秘密信息 → 2
    const card = makeCard('metal-6', 0, 'deck', true, null, 0);
    s.players[0].deck.push(card);
    expect(cardPointValue(s, card)).toBe(2);
  });
});
