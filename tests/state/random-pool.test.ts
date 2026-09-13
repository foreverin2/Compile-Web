import { describe, it, expect } from 'vitest';
import { randomPoolFromSeed } from '../../src/core/state/create';
import { DEMO_PROTOCOLS } from '../../src/data/demo';
import { newMatchSeed } from '../../src/ui/match-seed';

describe('开局派生由种子决定（G0）', () => {
  it('同种子得到同一个池', () => {
    const a = randomPoolFromSeed('S').map((p) => p.defId);
    const b = randomPoolFromSeed('S').map((p) => p.defId);
    expect(a).toEqual(b);
  });

  it('默认取 12 套且不重复', () => {
    const ids = randomPoolFromSeed('S').map((p) => p.defId);
    expect(ids).toHaveLength(12);
    expect(new Set(ids).size).toBe(12);
  });

  it('池是全部协议的子集', () => {
    const all = new Set(DEMO_PROTOCOLS.map((p) => p.defId));
    for (const id of randomPoolFromSeed('S').map((p) => p.defId)) expect(all.has(id)).toBe(true);
  });

  it('不同种子（通常）得到不同的池', () => {
    const a = randomPoolFromSeed('S1').map((p) => p.defId).join(',');
    const b = randomPoolFromSeed('S2').map((p) => p.defId).join(',');
    expect(a).not.toBe(b);
  });

  it('不修改入参池', () => {
    const src = [...DEMO_PROTOCOLS];
    randomPoolFromSeed('S', 12, src);
    expect(src.map((p) => p.defId)).toEqual(DEMO_PROTOCOLS.map((p) => p.defId));
  });

  it('newMatchSeed 两次调用不同且非空', () => {
    const a = newMatchSeed();
    const b = newMatchSeed();
    expect(a.length).toBeGreaterThan(0);
    expect(a).not.toBe(b);
  });
});
