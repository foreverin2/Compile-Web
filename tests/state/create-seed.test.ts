import { describe, it, expect } from 'vitest';
import { createGame, nextUid, nextAutoSeed, setSeedNonce } from '../../src/core/state/create';
import { nextEffectId } from '../../src/core/effects/context';

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

  it('效果 id 计数器在状态里：两局都从 e1 开始', () => {
    const a = createGame({ seed: 'A' });
    const b = createGame({ seed: 'B' });
    expect(nextEffectId(a)).toBe('e1');
    expect(nextEffectId(b)).toBe('e1');
    expect(nextEffectId(a)).toBe('e2');
    expect(a.nextEffectId).toBe(3);
  });

  it('效果 id 计数器随状态序列化一起恢复', () => {
    const s = createGame({ seed: 'A' });
    nextEffectId(s);
    const restored = JSON.parse(JSON.stringify(s)) as typeof s;
    expect(nextEffectId(restored)).toBe('e2');
  });

  it('draftStarter 默认仍为 0（不得改成种子派生）', () => {
    expect(createGame({ seed: 'Z' }).draftStarter).toBe(0);
  });

  it('兜底种子格式为 auto-<nonce>-<n>', () => {
    expect(createGame().rng.seed).toMatch(/^auto-.+-\d+$/);
  });

  it('注入运行期 nonce 后，兜底种子跨进程/跨重启也不同', () => {
    setSeedNonce('runA');
    const a = createGame().rng.seed;
    setSeedNonce('runB');
    const b = createGame().rng.seed;
    expect(a).not.toBe(b);
    expect(a).toContain('runA');
    expect(b).toContain('runB');
  });

  it('显式 seed 不消耗兜底计数器', () => {
    setSeedNonce('counter');
    const first = nextAutoSeed();
    createGame({ seed: 'explicit' });
    const second = nextAutoSeed();
    const n1 = Number(first.slice(first.lastIndexOf('-') + 1));
    const n2 = Number(second.slice(second.lastIndexOf('-') + 1));
    expect(n2).toBe(n1 + 1);
  });
});
