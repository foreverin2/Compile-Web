import { describe, it, expect } from 'vitest';
import type { GameState, PlayerState, Card, PlayerId, Line } from '../../src/core/models/types';

// Note: `import type` is erased at runtime, so these tests exercise the types
// at compile time (tsc --noEmit) and use real fixtures at runtime. The
// fixtures are minimal but shape-complete, so tsc fails if the types drift.

describe('types', () => {
  it('declares the shape of GameState', () => {
    const s: GameState = {
      phase: 'turn',
      draftRound: 0,
      draftPicks: [],
      turnPlayer: 0,
      step: 'start',
      compiledThisTurn: false,
      players: [
        { hand: [], deck: [], trash: [], protocols: [], stacks: [[], [], []] },
        { hand: [], deck: [], trash: [], protocols: [], stacks: [[], [], []] },
      ],
      control: -1,
      winner: null,
      log: [],
    };
    expect(typeof s.turnPlayer).toBe('number');
    expect(Array.isArray(s.players)).toBe(true);
  });

  it('PlayerId and Line are narrow numbers', () => {
    const p: PlayerId = 0;
    const l: Line = 2;
    expect(p).toBe(0);
    expect(l).toBe(2);
  });

  it('Card has zone and faceUp', () => {
    const c: Card = {
      uid: 'c1',
      defId: 'd1',
      owner: 0,
      faceUp: true,
      zone: 'hand',
      line: null,
      pos: null,
    };
    expect(typeof c.faceUp).toBe('boolean');
  });
});
