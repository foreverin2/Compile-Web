import { describe, it, expect } from 'vitest';
import {
  hash32,
  deriveInt,
  nextValue,
  nextInt,
  pickFrom,
  shuffleArr,
  type RngState,
} from '../src/core/rng';

const st = (seed = 'S'): RngState => ({ seed, n: 0 });

describe('rng：确定性随机源', () => {
  it('hash32 同串同值、异串异值', () => {
    expect(hash32('abc')).toBe(hash32('abc'));
    expect(hash32('abc')).not.toBe(hash32('abd'));
    expect(hash32('')).toBe(0x811c9dc5);
  });

  it('deriveInt 与调用顺序无关（先算别的标签不影响它）', () => {
    const before = deriveInt('S', 'coin', 2);
    deriveInt('S', 'pool', 45);
    deriveInt('S', 'pool', 45);
    expect(deriveInt('S', 'coin', 2)).toBe(before);
  });

  it('deriveInt 落在 [0, bound)', () => {
    for (const label of ['a', 'b', 'c', 'd', 'e', 'f', 'g']) {
      const v = deriveInt('S', label, 7);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(7);
    }
  });

  it('deriveInt 对非正 bound 返回 0', () => {
    expect(deriveInt('S', 'x', 0)).toBe(0);
    expect(deriveInt('S', 'x', -3)).toBe(0);
  });

  it('nextValue 推进 n，序列可复现且不重复', () => {
    const a = st();
    const b = st();
    const seqA = [nextValue(a), nextValue(a), nextValue(a)];
    const seqB = [nextValue(b), nextValue(b), nextValue(b)];
    expect(seqA).toEqual(seqB);
    expect(a.n).toBe(3);
    expect(new Set(seqA).size).toBe(3);
  });

  it('nextInt 落在 [0, bound) 且分布大致均匀', () => {
    const r = st('dist');
    const hits = [0, 0, 0, 0];
    for (let i = 0; i < 400; i++) hits[nextInt(r, 4)] += 1;
    expect(hits.every((h) => h > 40)).toBe(true);
  });

  it('pickFrom 空数组返回 undefined 且不推进 n', () => {
    const r = st();
    expect(pickFrom(r, [] as number[])).toBeUndefined();
    expect(r.n).toBe(0);
  });

  it('shuffleArr 确定性排列、不改入参、元素不丢', () => {
    const src = [1, 2, 3, 4, 5, 6, 7, 8];
    const a = shuffleArr(st('sh'), src);
    const b = shuffleArr(st('sh'), src);
    expect(a).toEqual(b);
    expect([...a].sort((x, y) => x - y)).toEqual(src);
    expect(src).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('不同 seed 产生不同序列', () => {
    expect(nextValue(st('A'))).not.toBe(nextValue(st('B')));
  });
});
