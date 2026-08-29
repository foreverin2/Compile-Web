import { describe, it, expect } from 'vitest';
import { createGame, performDraftPick, performDraftUnpick, canUnpick } from '../../src/core/state/create';

describe('draft unpick (cancel this turn selection)', () => {
  it('can unpick a pick made in the current 2-pick turn, but not earlier turns', () => {
    const s = createGame();
    performDraftPick(s, 'water'); // 轮0 P1 选水
    performDraftPick(s, 'fire'); // 轮1 P2（2 选回合）第一张
    expect(s.draftRound).toBe(2);
    expect(canUnpick(s, 'fire')).toBe(true); // 本回合选的
    expect(canUnpick(s, 'water')).toBe(false); // 前一个回合选的
    performDraftUnpick(s, 'fire');
    expect(s.draftRound).toBe(1);
    expect(s.draftPicks.map((p) => p.defId)).toEqual(['water']);
    // 取消后协议回到池中，可重新选择
    expect(canUnpick(s, 'fire')).toBe(false); // 已不在已选列表
  });

  it('rejects unpick when not picked this turn', () => {
    const s = createGame();
    performDraftPick(s, 'water');
    performDraftPick(s, 'fire');
    expect(() => performDraftUnpick(s, 'water')).toThrow(/not picked this turn/);
    expect(() => performDraftUnpick(s, 'light')).toThrow(/not picked this turn/);
  });

  it('after a 1-pick turn completes, its pick is not un-pickable', () => {
    const s = createGame();
    performDraftPick(s, 'water'); // 轮0（P1 单选回合）完成
    // 轮1 开始：draftTurnRange(1) 的切片不含 index 0
    expect(canUnpick(s, 'water')).toBe(false);
  });
});
