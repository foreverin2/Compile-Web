import { describe, it, expect } from 'vitest';
import { createGame, nextUid } from '../../src/core/state/create';

describe('createGame 的种子与 uid 计数器（G0）', () => {
  it('显式 seed 写进状态', () => {
    expect(createGame({ seed: 'S1' }).rng).toEqual({ seed: 'S1', n: 0 });
  });

  it('不传 seed 时每局种子不同（保持"每局不同"旧行为）', () => {
    expect(createGame().rng.seed).not.toBe(createGame().rng.seed);
  });

  it('uid 计数器在状态里：两局都从 c1 开始', () => {
    const s1 = createGame({ seed: 'A' });
    const s2 = createGame({ seed: 'B' });
    expect(nextUid(s1)).toBe('c1');
    expect(nextUid(s2)).toBe('c1');
    expect(nextUid(s1)).toBe('c2');
    expect(s1.nextUid).toBe(3);
  });

  it('uid 计数器随状态序列化一起恢复', () => {
    const s = createGame({ seed: 'A' });
    nextUid(s);
    const restored = JSON.parse(JSON.stringify(s)) as typeof s;
    expect(nextUid(restored)).toBe('c2');
  });

  it('draftStarter 默认仍为 0（不得改成种子派生）', () => {
    expect(createGame({ seed: 'Z' }).draftStarter).toBe(0);
  });
});
