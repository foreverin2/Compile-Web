import { describe, it, expect } from 'vitest';
import {
  clearAllLocalData,
  createLocalStore,
  readLang,
  readNickName,
  readPoolPreset,
  writeLang,
  writeNickName,
  writePoolPreset,
} from '../../src/app/local-store';
import { DEMO_PROTOCOLS } from '../../src/data/demo';
import { POOL_MIN } from '../../src/app/pool-choice';
import { L1_SETTINGS, createMemoryStore, readJson, type KeyValueStore } from '../../src/app/storage';

/**
 * ★ 2026-10-03（用户要求）：「自定义协议池」预设的**存储口径**。
 *
 * 它住在既有那份设置对象（`L1_SETTINGS`）的一个新字段 `pool` 里 —— 与昵称/语言/特效开关
 * 同一份存储、同一套授权门控、同一次「清除本机数据」（**不新增存储键**）。
 *
 * 这一组钉四件事：
 *  1. **形状守卫**是逐字段的（坏值一律退回"没勾、空列表"，不是整块炸掉）；
 *  2. **读-改-写**：写池子不会抹掉昵称/语言（反过来也一样）；
 *  3. **「清除本机数据」把它一起清掉**（用户口径第 6 条的存储那一半：选择丢了 ⇒ 屏上回落）；
 *  4. **游客模式零写入磁盘**（红线 3：`deny` 之后 persistent 的 set/remove 调用数恒 0）。
 */

const IDS = DEMO_PROTOCOLS.slice(0, POOL_MIN).map((p) => p.defId);

/** 记账假 KV（红线 3 的"零写入"判据：set + remove 次数） */
interface SpyStore extends KeyValueStore {
  readonly writes: string[][];
  readonly removals: string[];
  mutations(): number;
}
function spyStore(): SpyStore {
  const m = createMemoryStore();
  const writes: string[][] = [];
  const removals: string[] = [];
  return {
    get: (k) => m.get(k),
    set: (k, v) => { writes.push([k, v]); m.set(k, v); },
    remove: (k) => { removals.push(k); m.remove(k); },
    keys: () => m.keys(),
    writes,
    removals,
    mutations: () => writes.length + removals.length,
  };
}

/** 只有一个键的 `set` 会抛的假 KV（模拟配额满 / 隐私模式） */
function setThrowsFor(key: string): KeyValueStore {
  const m = createMemoryStore();
  return {
    get: (k) => m.get(k),
    set: (k, v) => { if (k === key) throw new Error(`写入被拒（${k}）`); m.set(k, v); },
    remove: (k) => { m.remove(k); },
    keys: () => m.keys(),
  };
}

function grantedStore(kv: KeyValueStore = createMemoryStore()): ReturnType<typeof createLocalStore> {
  const s = createLocalStore({ persistent: kv });
  s.grant();
  return s;
}

describe('★ 自定义协议池的存储口径（住在 L1_SETTINGS 的一个字段里）', () => {
  it('锚点：夹具够 12 套、协议数据集非空（否则下面每条腿在空集上恒真）', () => {
    expect(IDS.length).toBe(POOL_MIN);
    expect(new Set(IDS).size).toBe(POOL_MIN);
  });

  it('没写过 ⇒ 回"没勾、空列表"（默认不勾选这条用户口径的存储那一半）', () => {
    const s = grantedStore();
    expect(readPoolPreset(s)).toEqual({ enabled: false, ids: [] });
  });

  it('写进去再读回来：勾选状态与那几套 defId 逐项一致', () => {
    const kv = createMemoryStore();
    const s = grantedStore(kv);
    expect(writePoolPreset(s, { enabled: true, ids: IDS }).ok).toBe(true);
    expect(readPoolPreset(s)).toEqual({ enabled: true, ids: IDS });
    // 反向：取消勾选（ids 留着）也能读回"没勾"
    expect(writePoolPreset(s, { enabled: false, ids: IDS }).ok).toBe(true);
    expect(readPoolPreset(s)).toEqual({ enabled: false, ids: IDS });
    // 存储里**没有**新键（用户口径：塞进既有设置对象）
    expect(kv.keys().sort(), '池子写出了新键').toEqual(['compile-consent', L1_SETTINGS].sort());
  });

  it('读-改-写：写池子不抹掉昵称/语言，写昵称/语言也不抹掉池子', () => {
    const kv = createMemoryStore();
    const s = grantedStore(kv);
    writeNickName(s, '甲');
    writeLang(s, 'en');
    writePoolPreset(s, { enabled: true, ids: IDS });
    expect(readNickName(s), '写池子把昵称抹掉了').toBe('甲');
    expect(readLang(s), '写池子把语言抹掉了').toBe('en');
    writeNickName(s, '乙');
    writeLang(s, 'zh');
    expect(readPoolPreset(s), '写昵称/语言把池子抹掉了').toEqual({ enabled: true, ids: IDS });
    expect(readJson<Record<string, unknown>>(kv, L1_SETTINGS, {}), '三个字段必须同时留在同一份设置里')
      .toMatchObject({ nick: '乙', lang: 'zh', pool: { enabled: true, ids: IDS } });
  });

  it('形状守卫逐字段：坏值退回"没勾、空列表"，好值保留（不是整块回空）', () => {
    const kv = createMemoryStore();
    const s = grantedStore(kv);
    // ① `enabled` 只认 true
    kv.set(L1_SETTINGS, JSON.stringify({ pool: { enabled: 'yes', ids: IDS } }));
    expect(readPoolPreset(s), '`enabled: "yes"` 被当成了勾上').toEqual({ enabled: false, ids: IDS });
    // ② `ids` 只留字符串（数字 / null / 对象一律丢掉）
    kv.set(L1_SETTINGS, JSON.stringify({ pool: { enabled: true, ids: [IDS[0], 42, null, {}, IDS[1]] } }));
    expect(readPoolPreset(s)).toEqual({ enabled: true, ids: [IDS[0], IDS[1]] });
    // ③ `ids` 不是数组 ⇒ 空列表（`enabled` 仍然读得出来）
    kv.set(L1_SETTINGS, JSON.stringify({ pool: { enabled: true, ids: 'MN01' } }));
    expect(readPoolPreset(s)).toEqual({ enabled: true, ids: [] });
    // ④ 整个 `pool` 不是对象 / 键不存在 / 整份 JSON 坏掉 ⇒ 默认
    for (const bad of ['[]', '"x"', 'null', '42', 'true']) {
      kv.set(L1_SETTINGS, JSON.stringify({ pool: JSON.parse(bad) }));
      expect(() => readPoolPreset(s), `pool = ${bad} 把读取炸了`).not.toThrow();
      expect(readPoolPreset(s), `pool = ${bad} 没被丢掉`).toEqual({ enabled: false, ids: [] });
    }
    kv.set(L1_SETTINGS, '{oops');
    expect(readPoolPreset(s), '整份设置坏掉时该回默认').toEqual({ enabled: false, ids: [] });
    kv.set(L1_SETTINGS, JSON.stringify({ nick: '甲' }));
    expect(readPoolPreset(s), '没有 pool 字段时该回默认（老存储）').toEqual({ enabled: false, ids: [] });
  });

  it('写侧出口归一：非字符串 / 空串的 id 不落盘', () => {
    const kv = createMemoryStore();
    const s = grantedStore(kv);
    const dirty = { enabled: true, ids: [IDS[0], 42, '', null, IDS[1]] } as unknown as { enabled: boolean; ids: string[] };
    expect(writePoolPreset(s, dirty).ok).toBe(true);
    expect(readPoolPreset(s)).toEqual({ enabled: true, ids: [IDS[0], IDS[1]] });
  });

  it('「清除本机数据」把预设一起清掉 ⇒ 读回默认（用户口径第 6 条的存储那一半）', () => {
    const kv = createMemoryStore();
    const s = grantedStore(kv);
    writePoolPreset(s, { enabled: true, ids: IDS });
    expect(readPoolPreset(s).enabled).toBe(true);
    expect(clearAllLocalData(s.kv()), '清除没清掉设置那个键').toBeGreaterThan(0);
    expect(readPoolPreset(s), '清除本机数据之后预设还在（那"选择丢了就回落"这条就不成立）')
      .toEqual({ enabled: false, ids: [] });
  });

  it('游客模式（deny）⇒ 只进内存：本次会话读得回来、刷新即丢、persistent 零写入（红线 3）', () => {
    const spy = spyStore();
    const s = createLocalStore({ persistent: spy });
    s.deny();
    expect(writePoolPreset(s, { enabled: true, ids: IDS }).ok, '游客模式下写内存 KV 应成功').toBe(true);
    expect(readPoolPreset(s)).toEqual({ enabled: true, ids: IDS });
    expect(spy.mutations(), '游客模式下写预设碰了 persistent（红线 3）').toBe(0);
    const again = createLocalStore({ persistent: spy });
    expect(again.consent()).toBe('unknown');
    expect(readPoolPreset(again), '游客模式的预设竟然活过了"刷新"').toEqual({ enabled: false, ids: [] });
  });

  it('写失败按结构化原因回来（与语言同一套 `WriteResult`），不抛', () => {
    const s = createLocalStore({ persistent: setThrowsFor(L1_SETTINGS) });
    s.grant();
    expect(() => writePoolPreset(s, { enabled: true, ids: IDS }), '写失败时抛了').not.toThrow();
    const out = writePoolPreset(s, { enabled: true, ids: IDS });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe('write-failed');
    // 反向：能写的后端回 ok
    const good = grantedStore();
    expect(writePoolPreset(good, { enabled: true, ids: IDS }).ok).toBe(true);
  });
});
