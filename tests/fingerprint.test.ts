import { describe, it, expect } from 'vitest';
import { stableStringify, hash64, stateFingerprint } from '../src/core/fingerprint';
import { createGame, performDraftPick, getDraftPool } from '../src/core/state/create';

describe('状态指纹（G0）', () => {
  it('stableStringify 与对象键顺序无关', () => {
    expect(stableStringify({ b: 1, a: 2 })).toBe(stableStringify({ a: 2, b: 1 }));
  });

  it('stableStringify 数组保序', () => {
    expect(stableStringify([1, 2])).not.toBe(stableStringify([2, 1]));
  });

  it('stableStringify 处理 null / 原始值 / 嵌套', () => {
    expect(stableStringify(null)).toBe('null');
    expect(stableStringify(3)).toBe('3');
    expect(stableStringify('x')).toBe('"x"');
    expect(stableStringify({ a: [1, { b: null }] })).toBe('{"a":[1,{"b":null}]}');
  });

  it('hash64 是 16 位十六进制且同串同值', () => {
    const h = hash64('hello');
    expect(h).toMatch(/^[0-9a-f]{16}$/);
    expect(hash64('hello')).toBe(h);
    expect(hash64('hello')).not.toBe(hash64('hellp'));
  });

  it('同一状态多次指纹相同', () => {
    const s = createGame({ seed: 'F1' });
    expect(stateFingerprint(s)).toBe(stateFingerprint(s));
  });

  it('随机源计数进指纹（证明 rng 被覆盖）', () => {
    const s = createGame({ seed: 'F2' });
    const before = stateFingerprint(s);
    s.rng.n += 1;
    expect(stateFingerprint(s)).not.toBe(before);
  });

  it('uid 计数器进指纹', () => {
    const s = createGame({ seed: 'F3' });
    const before = stateFingerprint(s);
    s.nextUid += 1;
    expect(stateFingerprint(s)).not.toBe(before);
  });

  it('操作会改变指纹，且同种子同操作指纹一致', () => {
    const a = createGame({ seed: 'F4' });
    const b = createGame({ seed: 'F4' });
    const start = stateFingerprint(a);
    performDraftPick(a, getDraftPool(a)[0].defId);
    expect(stateFingerprint(a)).not.toBe(start);
    performDraftPick(b, getDraftPool(b)[0].defId);
    expect(stateFingerprint(b)).toBe(stateFingerprint(a));
  });

  it('undefined 语义与 JSON 一致：值为 undefined 的键被省略', () => {
    expect(stableStringify({ a: undefined })).toBe('{}');
    expect(stableStringify({ a: undefined })).toBe(stableStringify({}));
    expect(stableStringify({ a: undefined, b: 1 })).toBe(stableStringify({ b: 1 }));
  });

  it('序列化对 JSON 往返稳定（D2 的前提）', () => {
    const roundTrip = (v: unknown): unknown => JSON.parse(JSON.stringify(v));
    expect(stableStringify(roundTrip({ a: undefined, b: 1 }))).toBe(stableStringify({ a: undefined, b: 1 }));
    expect(stableStringify(roundTrip({ z: [1, { q: null }] }))).toBe(stableStringify({ z: [1, { q: null }] }));
  });

  it('显式 undefined 的可选字段不破坏往返稳定性（rigidity.ts 的真实赋值形态）', () => {
    const s = createGame({ seed: 'F5' });
    s.pendingActionPlayLine = undefined; // 引擎里真实存在的形态（rigidity.ts:48）
    const before = stateFingerprint(s);
    const restored = JSON.parse(JSON.stringify(s)) as typeof s;
    expect(stateFingerprint(restored)).toBe(before);
  });
});
