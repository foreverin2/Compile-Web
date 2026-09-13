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
    deckReveals: [],
    compileBlocked: null,
    pendingCompile: null,
    rng: { seed: 'test', n: 0 },
    nextUid: 1,
    ...overrides,
  };
}

describe('checkControl（规则单向判定：只检查当前行动玩家）', () => {
  it('gains control for acting P0 with 2+ lines higher', () => {
    const s = makeState([5, 5, 0], [1, 1, 9]); // P0（行动玩家）胜线 0、1，输线 2
    checkControl(s);
    expect(s.control).toBe(0);
  });

  it('does not gain with only 1 line higher', () => {
    const s = makeState([5, 3, 0], [1, 5, 0]); // P0 仅胜线 0，线 1 输、线 2 平
    checkControl(s);
    expect(s.control).toBe(-1);
  });

  it('acting player P1 gains control with 2+ lines higher', () => {
    const s = makeState([1, 1, 9], [5, 5, 0], { turnPlayer: 1 }); // P1（行动玩家）胜线 0、1
    checkControl(s);
    expect(s.control).toBe(1);
  });

  it('neutral stays neutral when only the non-acting player leads', () => {
    // P1 行动、P1 落后（P0 领先）→ 行动玩家不满足 → 保持中立（旧双向实现会给 P0，与规则不符）
    const s = makeState([5, 5, 0], [1, 1, 9], { turnPlayer: 1 });
    checkControl(s);
    expect(s.control).toBe(-1);
  });

  it('acting player steals control from opponent holder', () => {
    const s = makeState([5, 5, 0], [1, 1, 9], { control: 1, turnPlayer: 0 }); // P1 持有，P0 行动且满足
    checkControl(s);
    expect(s.control).toBe(0);
  });

  it('tie keeps current state', () => {
    const s = makeState([5, 0, 0], [0, 5, 0]); // 各胜 1 线，线 2 平
    checkControl(s);
    expect(s.control).toBe(-1);
    s.control = 0; // 已有持有者时平局也保持现状
    checkControl(s);
    expect(s.control).toBe(0);
  });

  it('holder keeps control when own check fails (no auto loss to point gap)', () => {
    // P0 持有控制组件、P0 行动但落后（P1 领先）→ 行动玩家不满足 → 保持持有。
    // 失权只有：自己编译/补满归还、对手在自己回合满足时夺取、卡牌效果。
    const s = makeState([1, 1, 9], [5, 5, 0], { control: 0 });
    checkControl(s);
    expect(s.control).toBe(0);
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


