import { describe, it, expect } from 'vitest';
import type { GameState, Step } from '../../src/core/models/types';
import { advanceStep, STEP_ORDER } from '../../src/core/engine/turn';

function makeState(step: Step): GameState {
  return {
    phase: 'turn',
    draftRound: 6,
    draftPicks: [],
    turnPlayer: 0,
    step,
    compiledThisTurn: false,
    players: [
      { hand: [], deck: [], trash: [], protocols: [], stacks: [[], [], []] },
      { hand: [], deck: [], trash: [], protocols: [], stacks: [[], [], []] },
    ],
    control: -1,
    winner: null,
    log: [],
    pendingEffects: [],
    pendingPlay: null,
    pendingShift: null,
    resolvedTriggerUids: [],
    pendingStepAdvance: false,
  };
}

describe('turn flow', () => {
  it('advances through all 6 steps in order', () => {
    const s = makeState('start');
    const seen: Step[] = [s.step];
    for (let i = 0; i < 5; i++) {
      advanceStep(s);
      seen.push(s.step);
    }
    expect(seen).toEqual(STEP_ORDER);
  });

  it('switches player after end and resets compiledThisTurn', () => {
    const s = makeState('end');
    s.compiledThisTurn = true;
    advanceStep(s);
    expect(s.turnPlayer).toBe(1);
    expect(s.step).toBe('start');
    expect(s.compiledThisTurn).toBe(false);
  });

  it('skips action when compiledThisTurn is set', () => {
    const s = makeState('check-compile');
    s.compiledThisTurn = true;
    advanceStep(s);
    expect(s.step).toBe('check-cache');
  });
});
