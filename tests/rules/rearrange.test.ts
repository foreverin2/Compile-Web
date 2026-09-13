import { describe, it, expect } from 'vitest';
import type { GameState, PlayerId, Line } from '../../src/core/models/types';
import { executeAction } from '../../src/core/game';
import { rearrangeProtocolSlots } from '../../src/core/actions/rearrange';

/** 按双方每条线的总值构造对局状态（协议 defId 双方各不相同，便于断言交换结果） */
function makeState(overrides: Partial<GameState> = {}): GameState {
  const mkStacks = () => [[], [], []] as GameState['players'][0]['stacks'];
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
      {
        hand: [],
        deck: [],
        trash: [],
        protocols: [
          { defId: 'p0a', compiled: false },
          { defId: 'p0b', compiled: true },
          { defId: 'p0c', compiled: false },
        ],
        stacks: mkStacks(),
      },
      {
        hand: [],
        deck: [],
        trash: [],
        protocols: [
          { defId: 'p1a', compiled: false },
          { defId: 'p1b', compiled: false },
          { defId: 'p1c', compiled: true },
        ],
        stacks: mkStacks(),
      },
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

describe('rearrangeProtocolSlots（共享入口：效果栈 op 与 executeAction 同路径）', () => {
  it('swaps two protocol slots with defId+compiled moving as a whole', () => {
    const s = makeState();
    rearrangeProtocolSlots(s, 1, 0, 2);
    // P1 侧 0↔2：p1c（已编译）移到 0、p1a 移到 2；compiled 状态随元素整体移动
    expect(s.players[1].protocols.map((p) => p.defId)).toEqual(['p1c', 'p1b', 'p1a']);
    expect(s.players[1].protocols[0].compiled).toBe(true);
    expect(s.players[1].protocols[2].compiled).toBe(false);
    // 其他侧不受影响
    expect(s.players[0].protocols.map((p) => p.defId)).toEqual(['p0a', 'p0b', 'p0c']);
    expect(s.log.some((l) => l.includes('重排协议'))).toBe(true);
  });

  it('rejects swapping a slot with itself', () => {
    const s = makeState();
    expect(() => rearrangeProtocolSlots(s, 0, 1, 1)).toThrow(/itself/);
  });
});

describe('executeAction rearrange-protocols（控制组件重排：编译/补满前可调任意一方协议顺序）', () => {
  it('exchanges acting player own protocols at check-compile', () => {
    const s = makeState({ step: 'check-compile', control: 0 });
    executeAction(s, 0, 'rearrange-protocols', { target: 0, a: 0, b: 2 });
    expect(s.players[0].protocols.map((p) => p.defId)).toEqual(['p0c', 'p0b', 'p0a']);
    expect(s.step).toBe('check-compile'); // 步骤不变（编译尚未执行）
  });

  it('exchanges opponent protocols at action step (refresh 前重排对手)', () => {
    const s = makeState({ step: 'action', control: 0 });
    executeAction(s, 0, 'rearrange-protocols', { target: 1, a: 1, b: 2 });
    expect(s.players[1].protocols.map((p) => p.defId)).toEqual(['p1a', 'p1c', 'p1b']);
    expect(s.players[1].protocols[1].compiled).toBe(true); // p1c 移入 1
  });

  it('rejects when not at compile/refresh phase (end step)', () => {
    const s = makeState({ step: 'end', control: 0 });
    expect(() => executeAction(s, 0, 'rearrange-protocols', { target: 0, a: 0, b: 1 })).toThrow(
      /only usable before compile\/refresh/
    );
  });

  it('rejects when not the acting player', () => {
    const s = makeState({ step: 'action', turnPlayer: 1 });
    expect(() => executeAction(s, 0, 'rearrange-protocols', { target: 0, a: 0, b: 1 })).toThrow(/not your turn/);
  });
});
