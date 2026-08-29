import { describe, it, expect, beforeEach } from 'vitest';
import type { GameState } from '../../src/core/models/types';
import { drawCards, discardFromHand, clearCache } from '../../src/core/engine/deck';

function makeState(handSize: number, deckSize: number, trashSize: number): GameState {
  const mk = (n: number, zone: 'hand' | 'deck' | 'trash') =>
    Array.from({ length: n }, (_, i) => ({
      uid: `${zone}-${i}`,
      defId: 'spirit-1',
      owner: 0 as const,
      faceUp: true,
      zone,
      line: null,
      pos: null,
    }));
  return {
    phase: 'turn',
    draftRound: 6,
    draftPicks: [],
    turnPlayer: 0,
    step: 'action',
    compiledThisTurn: false,
    players: [
      { hand: mk(handSize, 'hand'), deck: mk(deckSize, 'deck'), trash: mk(trashSize, 'trash'), protocols: [], stacks: [[], [], []] },
      { hand: [], deck: [], trash: [], protocols: [], stacks: [[], [], []] },
    ],
    control: -1,
    winner: null,
    log: [],
    pendingEffects: [],
    pendingPlay: [],
    pendingShift: [],
    resolvedTriggerUids: [],
    pendingStepAdvance: false,
    revealedGhosts: [],
  };
}

describe('deck ops', () => {
  let s: GameState;

  beforeEach(() => {
    s = makeState(0, 5, 0);
  });

  it('draws from deck into hand', () => {
    const drawn = drawCards(s, 0, 2);
    expect(drawn).toHaveLength(2);
    expect(s.players[0].hand).toHaveLength(2);
    expect(s.players[0].deck).toHaveLength(3);
    expect(drawn.every((c) => c.zone === 'hand')).toBe(true);
  });

  it('reshuffles trash into deck when deck empties during draw', () => {
    s = makeState(0, 2, 3);
    const drawn = drawCards(s, 0, 5);
    expect(drawn).toHaveLength(5);
    expect(s.players[0].deck).toHaveLength(0);
    expect(s.players[0].trash).toHaveLength(0);
    expect(s.players[0].hand).toHaveLength(5);
  });

  it('discardFromHand moves card face-up to trash', () => {
    s = makeState(2, 0, 0);
    const card = discardFromHand(s, 0, 'hand-0');
    expect(card.zone).toBe('trash');
    expect(card.faceUp).toBe(true);
    expect(s.players[0].hand).toHaveLength(1);
    expect(s.players[0].trash).toHaveLength(1);
  });

  it('clearCache discards down to 5', () => {
    s = makeState(7, 0, 0);
    const discarded = clearCache(s, 0);
    expect(discarded).toHaveLength(2);
    expect(s.players[0].hand).toHaveLength(5);
  });
});

