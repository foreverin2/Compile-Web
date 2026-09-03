import { describe, it, expect, beforeEach } from 'vitest';
import type { GameState, Card } from '../../src/core/models/types';
import { playCard, refreshHand, isPlayableFaceUp } from '../../src/core/actions/base';

function makeState(): GameState {
  const card = (uid: string, defId: string): Card => ({
    uid, defId, owner: 0, faceUp: true, zone: 'hand', line: null, pos: null,
  });
  return {
    phase: 'turn',
    draftRound: 6,
    draftPicks: [],
    draftStarter: 0,
    firstToPlay: 0,
    draftMode: 'normal',
    draftPool: [],
    bannedProtocols: [],
    turnPlayer: 0,
    turnCount: 0,
    step: 'action',
    compiledThisTurn: false,
    players: [
      {
        hand: [card('h1', 'spirit-1'), card('h2', 'fire-1')],
        deck: [],
        trash: [],
        protocols: [
          { defId: 'spirit', compiled: false },
          { defId: 'death', compiled: false },
          { defId: 'fire', compiled: false },
        ],
        stacks: [[], [], []],
      },
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
    compileBlocked: null,
    pendingCompile: null,
  };
}

describe('base actions', () => {
  let s: GameState;

  beforeEach(() => {
    s = makeState();
  });

  it('plays face-up only into matching protocol line', () => {
    expect(isPlayableFaceUp(s, 0, 'h1', 0)).toBe(true); // spirit → line 0
    expect(isPlayableFaceUp(s, 0, 'h1', 2)).toBe(false); // spirit → line 2 (fire)
    const card = playCard(s, 0, 'h1', true, 0);
    expect(card.zone).toBe('field');
    expect(s.players[0].stacks[0]).toHaveLength(1);
    expect(s.players[0].stacks[0][0].pos).toBe(0);
    expect(s.players[0].hand).toHaveLength(1);
  });

  it('plays face-down into any line', () => {
    const card = playCard(s, 0, 'h1', false, 2);
    expect(card.zone).toBe('field');
    expect(card.faceUp).toBe(false);
    expect(s.players[0].stacks[2]).toHaveLength(1);
  });

  it('covering a card appends to the top of the stack', () => {
    playCard(s, 0, 'h1', true, 0);
    playCard(s, 0, 'h2', false, 0);
    const stack = s.players[0].stacks[0];
    expect(stack).toHaveLength(2);
    expect(stack[1].pos).toBe(1);
  });

  it('rejects face-up play into wrong line', () => {
    expect(() => playCard(s, 0, 'h1', true, 2)).toThrow();
  });

  it('refresh draws to 5', () => {
    s.players[0].deck = [
      { uid: 'd1', defId: 'spirit-1', owner: 0, faceUp: true, zone: 'deck', line: null, pos: null },
      { uid: 'd2', defId: 'spirit-1', owner: 0, faceUp: true, zone: 'deck', line: null, pos: null },
      { uid: 'd3', defId: 'spirit-1', owner: 0, faceUp: true, zone: 'deck', line: null, pos: null },
      { uid: 'd4', defId: 'spirit-1', owner: 0, faceUp: true, zone: 'deck', line: null, pos: null },
      { uid: 'd5', defId: 'spirit-1', owner: 0, faceUp: true, zone: 'deck', line: null, pos: null },
    ];
    const drawn = refreshHand(s, 0);
    expect(drawn).toHaveLength(3);
    expect(s.players[0].hand).toHaveLength(5);
  });

  it('rejects refresh at 5 or more cards in hand', () => {
    s.players[0].hand.push({ uid: 'h3', defId: 'spirit-1', owner: 0, faceUp: true, zone: 'hand', line: null, pos: null });
    s.players[0].hand.push({ uid: 'h4', defId: 'spirit-1', owner: 0, faceUp: true, zone: 'hand', line: null, pos: null });
    s.players[0].hand.push({ uid: 'h5', defId: 'spirit-1', owner: 0, faceUp: true, zone: 'hand', line: null, pos: null });
    expect(() => refreshHand(s, 0)).toThrow();
  });
});

