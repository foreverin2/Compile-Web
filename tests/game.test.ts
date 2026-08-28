import { describe, it, expect } from 'vitest';
import { createGame, getDraftPool, performDraftPick } from '../src/core/state/create';
import { getLegalActions, executeAction } from '../src/core/game';

function draftToTurn(): ReturnType<typeof createGame> {
  const s = createGame();
  while (s.phase === 'draft') {
    performDraftPick(s, getDraftPool(s)[0].defId);
  }
  return s;
}

describe('game facade', () => {
  it('offers compile action in check-compile when forced', () => {
    const s = draftToTurn();
    // 把线 0 堆成 10 点：10 张 spirit-1
    s.players[0].stacks[0] = Array.from({ length: 10 }, (_, i) => ({
      uid: `x${i}`, defId: 'spirit-1', owner: 0 as const, faceUp: true, zone: 'field' as const, line: 0 as const, pos: i,
    }));
    executeAction(s, 0, 'advance'); // start → check-control
    executeAction(s, 0, 'advance'); // check-control → check-compile
    const legal = getLegalActions(s, 0);
    expect(legal.some((a) => a.kind === 'compile' && a.line === 0)).toBe(true);
    // 编译条件满足时编译为唯一行动：不提供 advance，且执行 advance 被拒绝
    expect(legal.some((a) => a.kind === 'advance')).toBe(false);
    expect(() => executeAction(s, 0, 'advance')).toThrow();
  });

  it('plays a card and advances to check-cache', () => {
    const s = draftToTurn();
    executeAction(s, 0, 'advance'); // start → check-control
    executeAction(s, 0, 'advance'); // check-control → check-compile
    executeAction(s, 0, 'advance'); // check-compile → action
    // 从手牌找一张与某条线协议匹配的卡（正面打入的前提）
    const p = s.players[0];
    let target: { cardUid: string; line: 0 | 1 | 2 } | null = null;
    for (const card of p.hand) {
      const proto = card.defId.split('-')[0];
      const line = p.protocols.findIndex((pr) => pr.defId === proto);
      if (line !== -1) {
        target = { cardUid: card.uid, line: line as 0 | 1 | 2 };
        break;
      }
    }
    expect(target).not.toBeNull();
    executeAction(s, 0, 'play', { cardUid: target!.cardUid, faceUp: true, line: target!.line });
    expect(s.players[0].stacks[target!.line]).toHaveLength(1);
    expect(s.step).toBe('check-cache');
  });

  it('advance through full turn cycle returns to start of next player', () => {
    const s = draftToTurn();
    executeAction(s, 0, 'advance'); // start → check-control
    executeAction(s, 0, 'advance'); // check-control → check-compile
    executeAction(s, 0, 'advance'); // check-compile → action
    executeAction(s, 0, 'advance'); // action → check-cache
    executeAction(s, 0, 'advance'); // check-cache → end
    executeAction(s, 0, 'advance'); // end → (P1 结束) start(换人)
    expect(s.turnPlayer).toBe(1);
    expect(s.step).toBe('start');
  });

  it('declares a winner when the third protocol compiles', () => {
    const s = draftToTurn();
    // 预置：P1 前两条协议已编译，第三条线堆满 10 点
    s.players[0].protocols[0].compiled = true;
    s.players[0].protocols[1].compiled = true;
    s.players[0].stacks[2] = Array.from({ length: 10 }, (_, i) => ({
      uid: `w${i}`, defId: 'spirit-1', owner: 0 as const, faceUp: true, zone: 'field' as const, line: 2 as const, pos: i,
    }));
    // 推进到 check-compile
    while (s.step !== 'check-compile') {
      executeAction(s, 0, 'advance');
    }
    executeAction(s, 0, 'compile', { line: 2 });
    expect(s.winner).toBe(0);
    expect(s.phase).toBe('gameover');
  });

  it('forces refresh (no advance) when hand is empty in action step', () => {
    const s = draftToTurn();
    // 推进到 action 步骤
    while (s.step !== 'action') {
      executeAction(s, 0, 'advance');
    }
    // 清空 P1 手牌 → 无牌可打，必须刷新
    const hand = s.players[0].hand;
    while (hand.length > 0) hand.pop();
    const legal = getLegalActions(s, 0);
    expect(legal.some((a) => a.kind === 'refresh')).toBe(true);
    expect(legal.some((a) => a.kind === 'advance')).toBe(false);
    expect(() => executeAction(s, 0, 'advance')).toThrow(/must refresh/);
  });

  it('does not auto-compile: single compilable line still offers compile action and no advance', () => {
    const s = draftToTurn();
    // 线 0 堆满 10 点（spirit-1 值 1 × 10）
    s.players[0].stacks[0] = Array.from({ length: 10 }, (_, i) => ({
      uid: `x${i}`, defId: 'spirit-1', owner: 0 as const, faceUp: true, zone: 'field' as const, line: 0 as const, pos: i,
    }));
    while (s.step !== 'check-compile') {
      executeAction(s, 0, 'advance');
    }
    const legal = getLegalActions(s, 0);
    // 单线可编译：提供 compile，不提供 advance（编译需玩家点击后执行）
    expect(legal.some((a) => a.kind === 'compile' && a.line === 0)).toBe(true);
    expect(legal.some((a) => a.kind === 'advance')).toBe(false);
    // 未执行 compile 前状态不变（不自动编译）
    expect(s.players[0].protocols[0].compiled).toBe(false);
  });
});
