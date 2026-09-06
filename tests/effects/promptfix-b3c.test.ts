import { describe, it, expect } from 'vitest';
import type { GameState, Line, PlayerId } from '../../src/core/models/types';
import { createGame, getLineValue } from '../../src/core/state/create';
import { collectTriggers } from '../../src/core/effects/triggers';
import { makeCard } from '../helpers';

/** 修改提示词 23/16/27：勇气6/腐化0/联合1 无对象触发在收集前自动跳过（不弹结算按钮）。 */

function setup(): GameState {
  const s = createGame();
  for (const pid of [0, 1] as PlayerId[]) {
    s.players[pid].protocols = [
      { defId: 'fire', compiled: false },
      { defId: 'light', compiled: false },
      { defId: 'darkness', compiled: false },
    ];
  }
  s.phase = 'turn';
  return s;
}

function placeSrc(s: GameState, defId: string, owner: PlayerId, line: Line) {
  const c = makeCard(defId, owner, 'field', true, line, s.players[owner].stacks[line].length);
  s.players[owner].stacks[line].push(c);
  return c;
}

describe('修改提示词 B3c（无对象触发自动跳过）', () => {
  it('勇气6：对手总阈值未更大 → end 不收集（无按钮）；更大 → 收集', () => {
    const s = setup();
    s.turnPlayer = 0;
    s.step = 'end';
    const c6 = placeSrc(s, 'courage-6', 0, 0); // 己线 0 顶卡（值 6）
    // 对手线 0 为空 → 己 6 > 对 0 → 不触发
    let ts = collectTriggers(s, 'end');
    expect(ts.some((x) => x.defId === 'courage-6')).toBe(false);
    // 对手线 0 更大（12 > 6）→ 收集
    for (let i = 0; i < 12; i++) placeSrc(s, 'light-1', 1, 0);
    ts = collectTriggers(s, 'end');
    expect(ts.some((x) => x.defId === 'courage-6')).toBe(true);
    expect(c6.faceUp).toBe(true);
  });

  it('腐化0：此链路无其它正面卡 → start 不收集；有则收集', () => {
    const s = setup();
    s.turnPlayer = 0;
    s.step = 'start';
    const c0 = placeSrc(s, 'corruption-0', 0, 0);
    let ts = collectTriggers(s, 'start');
    expect(ts.some((x) => x.defId === 'corruption-0')).toBe(false); // 堆中仅自己
    placeSrc(s, 'fire-3', 0, 0); // 其它正面卡（被盖在下层也 faceUp）
    ts = collectTriggers(s, 'start');
    expect(ts.some((x) => x.defId === 'corruption-0')).toBe(true);
    expect(c0.faceUp).toBe(true);
  });

  it('联合1：未被覆盖（无可偏转对象）→ start 不收集；被覆盖才收集', () => {
    const s = setup();
    s.turnPlayer = 0;
    s.step = 'start';
    const u1 = placeSrc(s, 'unity-1', 0, 0); // 顶卡（未被覆盖）
    let ts = collectTriggers(s, 'start');
    expect(ts.some((x) => x.defId === 'unity-1')).toBe(false);
    placeSrc(s, 'fire-2', 0, 0); // 盖住 unity-1
    ts = collectTriggers(s, 'start');
    expect(ts.some((x) => x.defId === 'unity-1')).toBe(true); // top 顶命令被盖仍收集
    expect(u1.faceUp).toBe(true);
    void getLineValue;
  });
});
