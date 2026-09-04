import { describe, it, expect, beforeEach } from 'vitest';
import type { GameState } from '../../src/core/models/types';
import { canCompileLine, getCompilableLines, mustCompile, executeCompile } from '../../src/core/rules/compile';

function makeState(v0: number, v1: number, line: 0 | 1 | 2 = 0): GameState {
  // 用堆叠里重复放 spirit-1（值1）凑总值
  const mk = (owner: 0 | 1, total: number) =>
    Array.from({ length: total }, (_, i) => ({ uid: `${owner}-${i}`, defId: 'spirit-1', owner, faceUp: true, zone: 'field' as const, line, pos: i }));
  const p0Stacks: GameState['players'][0]['stacks'] = [[], [], []];
  const p1Stacks: GameState['players'][0]['stacks'] = [[], [], []];
  p0Stacks[line] = mk(0, v0);
  p1Stacks[line] = mk(1, v1);
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
    step: 'check-compile',
    compiledThisTurn: false,
    players: [
      { hand: [], deck: [], trash: [], protocols: [{ defId: 'spirit', compiled: false }, { defId: 'death', compiled: false }, { defId: 'fire', compiled: false }], stacks: p0Stacks },
      { hand: [], deck: [], trash: [], protocols: [{ defId: 'spirit', compiled: false }, { defId: 'death', compiled: false }, { defId: 'fire', compiled: false }], stacks: p1Stacks },
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
    deckReveals: [],
    compileBlocked: null,
    pendingCompile: null,
  };
}

describe('compile rules', () => {
  let s: GameState;

  beforeEach(() => {
    s = makeState(10, 9);
  });

  it('compiles at exactly 10 when strictly greater', () => {
    expect(canCompileLine(s, 0, 0)).toBe(true);
  });

  it('does not compile when equal to opponent', () => {
    s = makeState(10, 10);
    expect(canCompileLine(s, 0, 0)).toBe(false);
  });

  it('does not compile below 10', () => {
    s = makeState(9, 8);
    expect(canCompileLine(s, 0, 0)).toBe(false);
  });

  it('lists compilable lines', () => {
    s = makeState(10, 9);
    const p = s.players[0];
    // 线1也给 11 点
    p.stacks[1] = Array.from({ length: 11 }, (_, i) => ({ uid: `a${i}`, defId: 'spirit-1', owner: 0 as const, faceUp: true, zone: 'field' as const, line: 1 as const, pos: i }));
    expect(getCompilableLines(s, 0)).toEqual([0, 1]);
    expect(mustCompile(s, 0)).toBe(true);
  });

  it('executeCompile deletes both stacks and flips protocol', () => {
    executeCompile(s, 0, 0);
    expect(s.players[0].stacks[0]).toHaveLength(0);
    expect(s.players[1].stacks[0]).toHaveLength(0);
    expect(s.players[0].trash).toHaveLength(10);
    expect(s.players[1].trash).toHaveLength(9);
    expect(s.players[0].protocols[0].compiled).toBe(true);
    expect(s.compiledThisTurn).toBe(true);
  });

  it('recompile draws opponent top card instead of flipping', () => {
    s.players[0].protocols[0].compiled = true;
    s.players[1].deck = [{ uid: 'd1', defId: 'spirit-1', owner: 1, faceUp: true, zone: 'deck', line: null, pos: null }];
    s.players[1].deck[0].secret = true; // 牌堆来源的 secret 卡（曾被弃牌堆洗回牌库）
    executeCompile(s, 0, 0);
    expect(s.players[0].protocols[0].compiled).toBe(true);
    expect(s.players[0].hand).toHaveLength(1);
    expect(s.players[0].hand[0].owner).toBe(0);
    expect(s.players[0].hand[0].secret).toBeFalsy(); // 夺取进手即解禁（手牌 = 已知信息）
    expect(s.players[1].deck).toHaveLength(0);
  });

  it('declares winner when all 3 protocols compiled', () => {
    s = makeState(10, 9, 2);
    s.players[0].protocols.forEach((p) => (p.compiled = true));
    s.players[0].protocols[2].compiled = false;
    executeCompile(s, 0, 2);
    expect(s.winner).toBe(0);
    expect(s.phase).toBe('gameover');
  });
});


