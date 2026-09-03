import { describe, it, expect } from 'vitest';
import type { GameState, Step } from '../../src/core/models/types';
import { advanceStep, STEP_ORDER } from '../../src/core/engine/turn';

function makeState(step: Step): GameState {
  return {
    phase: 'turn',
    draftRound: 6,
    draftPicks: [],
    draftStarter: 0,
    firstToPlay: 0,
    turnPlayer: 0,
    turnCount: 0,
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
    pendingPlay: [],
    pendingShift: [],
    resolvedTriggerUids: [],
    pendingStepAdvance: false,
    revealedGhosts: [],
    compileBlocked: null,
    pendingCompile: null,
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

  it('increments turnCount exactly once per turn end and clears ghosts at their expiresAtTurn', () => {
    const s = makeState('end');
    s.revealedGhosts = [
      { id: 'a', defId: 'fire-1', shownTo: 0, expiresAtTurn: 1 },
      { id: 'b', defId: 'fire-1', shownTo: 1, expiresAtTurn: 2 },
    ];
    advanceStep(s); // end → start（换 P2）：计数 1，清除 expiresAtTurn <= 1
    expect(s.turnCount).toBe(1);
    expect(s.revealedGhosts.map((g) => g.id)).toEqual(['b']);
    // 同回合内的其余步骤推进不改变计数
    advanceStep(s); // start → check-control
    expect(s.turnCount).toBe(1);
    // 走到下一个 end（start → check-control → check-compile → action → check-cache → end）
    for (let i = 0; i < 4; i++) advanceStep(s);
    expect(s.step).toBe('end');
    advanceStep(s); // end → start：计数 2，清除 expiresAtTurn <= 2
    expect(s.turnCount).toBe(2);
    expect(s.revealedGhosts).toHaveLength(0);
  });
});

