import { describe, it, expect } from 'vitest';
import type { GameState, PlayerId, Line } from '../../src/core/models/types';
import { checkControl, resetControlIfHeld } from '../../src/core/rules/control';
import { executeAction } from '../../src/core/game';

/** 按双方每条线的总值构造对局状态：每张 spirit-1 值 1，堆叠内放 total 张凑值 */
function makeState(
  v0: [number, number, number],
  v1: [number, number, number],
  overrides: Partial<GameState> = {},
): GameState {
  const mk = (owner: PlayerId, totals: [number, number, number]): GameState['players'][0]['stacks'] =>
    ([0, 1, 2] as Line[]).map((line) =>
      Array.from({ length: totals[line] }, (_, i) => ({
        uid: `p${owner}-l${line}-${i}`,
        defId: 'spirit-1',
        owner,
        faceUp: true,
        zone: 'field' as const,
        line,
        pos: i,
      })),
    );
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
    step: 'check-control',
    compiledThisTurn: false,
    players: [
      { hand: [], deck: [], trash: [], protocols: [{ defId: 'spirit', compiled: false }, { defId: 'death', compiled: false }, { defId: 'fire', compiled: false }], stacks: mk(0, v0) },
      { hand: [], deck: [], trash: [], protocols: [{ defId: 'spirit', compiled: false }, { defId: 'death', compiled: false }, { defId: 'fire', compiled: false }], stacks: mk(1, v1) },
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
    ...overrides,
  };
}

describe('checkControl', () => {
  it('gains control for P0 with 2+ lines higher', () => {
    const s = makeState([5, 5, 0], [1, 1, 9]); // P0 胜线 0、1，输线 2
    checkControl(s);
    expect(s.control).toBe(0);
  });

  it('does not gain with only 1 line higher', () => {
    const s = makeState([5, 3, 0], [1, 5, 0]); // P0 仅胜线 0，线 1 输、线 2 平
    checkControl(s);
    expect(s.control).toBe(-1);
  });

  it('opponent gains control', () => {
    const s = makeState([1, 1, 9], [5, 5, 0]); // P1 胜线 0、1
    checkControl(s);
    expect(s.control).toBe(1);
  });

  it('tie keeps current state', () => {
    const s = makeState([5, 0, 0], [0, 5, 0]); // 各胜 1 线，线 2 平
    checkControl(s);
    expect(s.control).toBe(-1);
    s.control = 0; // 已有持有者时平局也保持现状
    checkControl(s);
    expect(s.control).toBe(0);
  });

  it('re-evaluates: holder losing majority hands control to opponent', () => {
    const s = makeState([1, 1, 9], [5, 5, 0], { control: 0 });
    checkControl(s);
    expect(s.control).toBe(1);
  });

  it('advance at check-control step triggers gain (integration)', () => {
    const s = makeState([5, 5, 0], [1, 1, 9]);
    executeAction(s, 0, 'advance');
    expect(s.control).toBe(0);
    expect(s.step).toBe('check-compile');
  });
});

describe('resetControlIfHeld', () => {
  it('resets to neutral when holder compiles (integration)', () => {
    const s = makeState([10, 0, 0], [5, 0, 0], { step: 'check-compile', control: 0 });
    executeAction(s, 0, 'compile', { line: 0 });
    expect(s.control).toBe(-1);
    expect(s.players[0].stacks[0]).toHaveLength(0);
    expect(s.players[0].protocols[0].compiled).toBe(true);
  });

  it('resets to neutral when holder refreshes (integration)', () => {
    const s = makeState([0, 0, 0], [0, 0, 0], { step: 'action', control: 0 });
    executeAction(s, 0, 'refresh');
    expect(s.control).toBe(-1);
    expect(s.step).toBe('check-cache');
  });

  it('does not reset when the other player acts', () => {
    const s = makeState([0, 0, 0], [0, 0, 0], { step: 'action', control: 0, turnPlayer: 1 });
    resetControlIfHeld(s, 1);
    expect(s.control).toBe(0);
  });

  it('does not change neutral control', () => {
    const s = makeState([0, 0, 0], [0, 0, 0], { step: 'action', control: -1 });
    resetControlIfHeld(s, 0);
    expect(s.control).toBe(-1);
  });
});

