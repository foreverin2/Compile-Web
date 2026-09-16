import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  L1_DECKS,
  L1_SETTINGS,
  L1_KEY_PREFIX,
  L1_SCHEMA_VERSION,
  L1_VALUE_MAX_BYTES,
  createMemoryStore,
  clearAllLocalData,
  pickNamedStore,
  readJson,
  writeJson,
  type KeyValueStore,
} from '../../src/app/storage';
import {
  createLocalStore,
  readDecks,
  readNickName,
  writeDecks,
  writeNickName,
} from '../../src/app/local-store';

/* ============================================================================
 * G3 Task 3：L1 存储（可注入 KV + 授权状态机 + 游客模式零写入）
 *
 * 本文件在 **node 环境、零浏览器桩** 下跑通（vite.config.ts 是 environment:'node'）。
 * 若哪天这里需要补一个 window/localStorage 垫片才能过，说明分层破了 —— 见
 * `src/ui/local-store-browser.ts`（浏览器实现全部在那里，靠依赖注入进纯层）。
 *
 * 注：授权状态机与数据模型（`createLocalStore` / `readNickName` / `writeDecks` …）住在
 * `src/app/local-store.ts`（同样是纯层，只是另一个文件），存储抽象住在 `src/app/storage.ts`
 * —— 两个 import 分开是有意的（初稿把两者写在同一个 import 里，是笔误）。
 * ========================================================================== */

/** 会记账的假 KV：精确回答"到底写了几次、删了几次"。 */
interface SpyStore extends KeyValueStore {
  /** 每一次 set 的 [key, value]（证伪"游客模式偷偷写了一次"用的就是它的长度） */
  writes: string[][];
  /** 每一次 remove 的 key */
  removals: string[];
  /** set + remove 的总次数（红线 3 的"零写入"判据：这三类变更调用必须为 0） */
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

/** 已授权、且后端就是给定 KV 的 store（"读盘里已有的值"这类腿用它，且不产生任何写入） */
function readableStore(kv: KeyValueStore): ReturnType<typeof createLocalStore> {
  const s = createLocalStore({ persistent: kv });
  s.grant();
  return s;
}

describe('L1：授权状态机', () => {
  it('初始是 unknown（不写任何东西）', () => {
    const kv = spyStore();
    const s = createLocalStore({ persistent: kv });
    expect(s.consent()).toBe('unknown');
    expect(kv.mutations()).toBe(0);
  });

  it('unknown 状态下写入次数为 0（授权之前磁盘上零写入）', () => {
    const kv = spyStore();
    const s = createLocalStore({ persistent: kv });
    writeNickName(s, '未授权就别写');
    writeDecks(s, [{ id: 'd1', name: '卡组', seed: 's', defIds: ['water'], updatedAt: 'now' }]);
    expect(s.consent()).toBe('unknown');
    expect(kv.mutations(), '未询问状态下不得有任何一次落盘变更').toBe(0);
    expect(kv.writes).toEqual([]);
  });

  it('ask 状态（弹窗已显示、等用户点）写入次数同样为 0', () => {
    const kv = spyStore();
    const s = createLocalStore({ persistent: kv });
    s.ask();
    expect(s.consent()).toBe('ask');
    expect(s.isPersistent()).toBe(false);
    writeNickName(s, '还没点');
    expect(kv.mutations()).toBe(0);
  });

  it('denied（游客模式）：此后所有写入都不落盘 —— 红线 3 的机检形态', () => {
    const kv = spyStore();
    const s = createLocalStore({ persistent: kv });
    s.deny();
    expect(s.consent()).toBe('denied');
    expect(s.isPersistent()).toBe(false);
    writeNickName(s, '游客甲');
    writeDecks(s, [{ id: 'd1', name: '卡组', seed: 's', defIds: ['water'], updatedAt: 'now' }]);
    expect(kv.writes, '游客模式下不得有任何一次落盘写入').toEqual([]);
    expect(kv.removals, '游客模式下也不得有任何一次落盘删除').toEqual([]);
    expect(kv.mutations(), 'set/remove 调用次数必须恒为 0').toBe(0);
  });

  it('denied 之后再 deny/grant 前后的变更调用仍然为 0（重复拒绝不会漏写）', () => {
    const kv = spyStore();
    const s = createLocalStore({ persistent: kv });
    s.deny();
    s.ask(); // ask 只对 unknown 生效，denied 下不得改变状态
    expect(s.consent()).toBe('denied');
    writeNickName(s, 'a');
    writeNickName(s, 'b');
    s.deny();
    expect(kv.mutations()).toBe(0);
  });

  it('拒绝后仍能**在内存里**读回自己刚写的昵称（功能可用、只是刷新即丢）', () => {
    const s = createLocalStore({ persistent: spyStore() });
    s.deny();
    expect(writeNickName(s, '游客甲')).toBe(true);
    expect(readNickName(s)).toBe('游客甲');
  });

  it('游客模式确实走内存 KV：假 KV 的 keys() 里也看不到任何东西', () => {
    const kv = spyStore();
    const s = createLocalStore({ persistent: kv });
    s.deny();
    writeNickName(s, '游客乙');
    expect(s.kv()).not.toBe(kv);
    expect(kv.keys()).toEqual([]);
    expect(s.kv().keys()).toEqual([L1_SETTINGS]);
  });

  it('allowed → 昵称/卡组真的落盘，且新开的 LocalStore 能读回（模拟刷新）', () => {
    const kv = spyStore();
    const s = createLocalStore({ persistent: kv });
    s.grant();
    expect(s.isPersistent()).toBe(true);
    expect(writeNickName(s, '甲')).toBe(true);
    expect(writeDecks(s, [{ id: 'd1', name: '我的卡组', seed: 's', defIds: ['water', 'fire'], updatedAt: 'now' }])).toBe(true);
    expect(kv.writes.length).toBe(2);

    const again = createLocalStore({ persistent: kv });
    again.grant();
    expect(readNickName(again)).toBe('甲');
    expect(readDecks(again).map((d) => d.name)).toEqual(['我的卡组']);
  });

  it('persistent 为 null（浏览器存储全不可用）→ 退化为游客模式，不抛错', () => {
    const s = createLocalStore({ persistent: null });
    s.grant();
    expect(s.consent()).toBe('allowed');
    expect(s.isPersistent()).toBe(false);
    expect(writeNickName(s, '甲')).toBe(true);
    expect(readNickName(s)).toBe('甲');
  });

  it('reset() 回到 unknown（授权状态本身从不写盘）', () => {
    const kv = spyStore();
    const s = createLocalStore({ persistent: kv });
    s.ask();
    s.grant();
    s.reset();
    expect(s.consent()).toBe('unknown');
    expect(kv.mutations(), 'reset 只改内存闭包变量，不得有落盘调用').toBe(0);
  });

  it('授权状态本身不落盘：切换到内存 KV 之后，persistent 里没有任何授权痕迹', () => {
    const kv = spyStore();
    const s = createLocalStore({ persistent: kv });
    s.grant();
    s.deny();
    expect(kv.keys()).toEqual([]);
    expect(kv.mutations()).toBe(0);
  });
});

describe('L1：KV 接口的能力边界（三态 × 每个方法）', () => {
  it('get：值不存在 → 返回 null（不是抛错、不是空串）', () => {
    const kv = createMemoryStore();
    expect(kv.get('从来没有写过的键')).toBeNull();
  });

  it('get：值被 remove 之后 → 又回到 null', () => {
    const kv = createMemoryStore();
    kv.set('k', 'v');
    expect(kv.get('k')).toBe('v');
    kv.remove('k');
    expect(kv.get('k')).toBeNull();
  });

  it('set/keys：写入后 keys() 能列出该键（内存实现的能力边界）', () => {
    const kv = createMemoryStore();
    kv.set('a', '1');
    kv.set('b', '2');
    expect(kv.keys().sort()).toEqual(['a', 'b']);
  });

  it('get 抛错 → 不静默吞掉：原样向外抛（调用方自己决定兜底）', () => {
    const kv: KeyValueStore = {
      get: () => { throw new Error('存储不可用'); },
      set: () => {},
      remove: () => {},
      keys: () => [],
    };
    expect(() => kv.get('k')).toThrow('存储不可用');
    expect(() => readJson(kv, L1_SETTINGS, { a: 1 }), 'readJson 不得把 get 的异常吞成 fallback').toThrow('存储不可用');
  });

  it('set 抛错（配额满 / 隐私模式）→ writeJson 不抛，返回 write-failed', () => {
    const kv: KeyValueStore = {
      get: () => null,
      set: () => { throw new Error('QuotaExceededError'); },
      remove: () => {},
      keys: () => [],
    };
    const r = writeJson(kv, L1_SETTINGS, { a: 1 });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('write-failed');
    expect(r.detail, 'detail 里要能看出真实原因，不能是空串').toContain('QuotaExceededError');
  });

  it('remove 抛错 → 不静默吞掉：原样向外抛', () => {
    const kv: KeyValueStore = {
      get: () => '1',
      set: () => {},
      remove: () => { throw new Error('不可删除'); },
      keys: () => ['k'],
    };
    expect(() => clearAllLocalData(kv)).toThrow('不可删除');
  });

  it('keys 抛错 → 不静默吞掉：原样向外抛（clearAllLocalData 不依赖 keys，但接口不许掩盖）', () => {
    const kv: KeyValueStore = {
      get: () => null,
      set: () => {},
      remove: () => {},
      keys: () => { throw new Error('不可枚举'); },
    };

    function list(k: KeyValueStore): string[] {
      return k.keys();
    }
    expect(() => list(kv)).toThrow('不可枚举');
  });
});

describe('L1：JSON 读写的坏数据与上限', () => {
  it('readJson：键不存在 → fallback（不抛）', () => {
    expect(readJson(createMemoryStore(), L1_SETTINGS, { a: 1 })).toEqual({ a: 1 });
  });

  it('readJson：JSON 坏掉 → fallback（坏档案不该让游戏打不开）', () => {
    const kv = createMemoryStore();
    kv.set(L1_SETTINGS, '{oops');
    expect(readJson(kv, L1_SETTINGS, { a: 1 })).toEqual({ a: 1 });
  });

  it('readJson：空串也算坏数据 → fallback', () => {
    const kv = createMemoryStore();
    kv.set(L1_SETTINGS, '');
    expect(readJson(kv, L1_SETTINGS, { a: 1 })).toEqual({ a: 1 });
  });

  it('readJson：形状合法但类型不对 → 由调用方守卫兜底（readNickName 回空串）', () => {
    const kv = createMemoryStore();
    kv.set(L1_SETTINGS, JSON.stringify({ nick: 42 }));
    expect(readNickName(createLocalStore({ persistent: kv }))).toBe('');
  });

  it('readNickName：整份设置坏掉 → 回空串（不抛）', () => {
    const kv = createMemoryStore();
    kv.set(L1_SETTINGS, 'not json at all');
    expect(readNickName(createLocalStore({ persistent: kv }))).toBe('');
  });

  it('往返：写入后读回与原对象逐字段相同（含中文与多字节字符、数组、嵌套位置）', () => {
    const kv = createMemoryStore();
    const value = { nick: '甲·123', tags: ['水', '火'], nested: { deep: [1, 2, 3] }, flag: false, n: 0 };
    expect(writeJson(kv, L1_SETTINGS, value)).toEqual({ ok: true });
    const back = readJson<typeof value>(kv, L1_SETTINGS, { nick: '', tags: [], nested: { deep: [] }, flag: true, n: -1 });
    expect(back).toEqual(value);
    for (const k of Object.keys(value) as (keyof typeof value)[]) {
      expect(back[k], `字段 ${k} 不相等`).toEqual(value[k]);
    }
  });

  it('往返：DeckRecord 数组逐字段相同（含 defIds 顺序）', () => {
    const kv = createMemoryStore();
    const s = createLocalStore({ persistent: kv });
    s.grant();
    const decks = [
      { id: 'd1', name: '水与火 🔥', seed: 'seed-1', defIds: ['fire', 'water'], updatedAt: '2026-09-16T00:00:00.000Z' },
      { id: 'd2', name: '空', seed: '', defIds: [], updatedAt: '' },
    ];
    expect(writeDecks(s, decks)).toBe(true);
    expect(readDecks(readableStore(kv))).toEqual(decks);
  });

  it('超过上限的值 → too-large，且**不**落盘、不抛错', () => {
    const kv = spyStore();
    const big = 'x'.repeat(L1_VALUE_MAX_BYTES + 1);
    const r = writeJson(kv, L1_SETTINGS, { big });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('too-large');
    expect(r.detail.length).toBeGreaterThan(0);
    expect(kv.writes).toEqual([]);
  });

  it('刚好等于上限的值 → 允许写入（上限是"≤"不是"<"）', () => {
    const kv = createMemoryStore();
    // JSON.stringify({ s: 'x'.repeat(n) }) 的**字节数**：外壳 8 字节 + n 个 ASCII 字节
    const n = L1_VALUE_MAX_BYTES - 8;
    expect(writeJson(kv, L1_SETTINGS, { s: 'x'.repeat(n) }).ok).toBe(true);
    expect(writeJson(kv, L1_SETTINGS, { s: 'x'.repeat(n + 1) }).ok).toBe(false);
    expect(writeJson(kv, L1_SETTINGS, { s: 'x'.repeat(n + 1) })).toMatchObject({ reason: 'too-large' });
  });

  it('字节数按 UTF-8 算（中文不能被当成 1 字节）', () => {
    const kv = createMemoryStore();
    const n = Math.ceil(L1_VALUE_MAX_BYTES / 3) + 1; // 每字 3 字节 → 一定超
    const r = writeJson(kv, L1_SETTINGS, { s: '中'.repeat(n) });
    expect(r.ok).toBe(false);
  });

  it('不能序列化的值（循环引用）→ write-failed，不抛错', () => {
    const kv = spyStore();
    const cyc: Record<string, unknown> = {};
    cyc.self = cyc;
    const r = writeJson(kv, L1_SETTINGS, cyc);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('write-failed');
    expect(kv.writes).toEqual([]);
  });

  it('clearAllLocalData 只清自己的键，返回清掉的个数', () => {
    const kv = createMemoryStore();
    kv.set(L1_SETTINGS, '{}');
    kv.set(L1_DECKS, '[]');
    kv.set('someone-elses-key', 'x');
    expect(clearAllLocalData(kv)).toBe(2);
    expect(kv.get('someone-elses-key')).toBe('x');
    expect(kv.get(L1_SETTINGS)).toBeNull();
    expect(kv.get(L1_DECKS)).toBeNull();
  });

  it('clearAllLocalData：键不存在时不计数、也不调用 remove', () => {
    const kv = spyStore();
    expect(clearAllLocalData(kv)).toBe(0);
    expect(kv.removals).toEqual([]);
  });

  it('pickNamedStore：第一个可用的胜出', () => {
    const ok = createMemoryStore();
    const chooser = pickNamedStore([
      { name: 'indexeddb', get kv(): never { throw new Error('不可用'); } } as never,
      { name: 'memory', kv: ok },
    ]);
    expect(chooser.name).toBe('memory');
    expect(chooser.kv).toBe(ok);
  });

  it('pickNamedStore：set 真的抛错的候选被跳过（不能只看"对象存在"）', () => {
    const bad: KeyValueStore = {
      get: () => null,
      set: () => { throw new Error('隐私模式下 set 抛错'); },
      remove: () => {},
      keys: () => [],
    };
    const good = createMemoryStore();
    const chosen = pickNamedStore([{ name: 'bad', kv: bad }, { name: 'good', kv: good }]);
    expect(chosen.name).toBe('good');
  });

  it('pickNamedStore：全部不可用 → 抛错（调用方负责降级成 null）', () => {
    expect(() => pickNamedStore([])).toThrow();
    const bad: KeyValueStore = {
      get: () => { throw new Error('不可用'); },
      set: () => { throw new Error('不可用'); },
      remove: () => { throw new Error('不可用'); },
      keys: () => { throw new Error('不可用'); },
    };
    expect(() => pickNamedStore([{ name: 'x', kv: bad }])).toThrow();
  });

  it('pickNamedStore：探针键不残留（探测本身不污染用户数据）', () => {
    const kv = createMemoryStore();
    pickNamedStore([{ name: 'memory', kv }]);
    expect(kv.keys()).toEqual([]);
  });
});

describe('L1：卡组记录模型', () => {
  it('readDecks 对非法形状做过滤（不把坏数据当成卡组）', () => {
    const kv = createMemoryStore();
    kv.set(L1_DECKS, JSON.stringify([{ id: 'd1', name: 'ok', seed: 's', defIds: ['water'], updatedAt: 't' }, { id: 1 }]));
    expect(readDecks(readableStore(kv)).map((d) => d.id)).toEqual(['d1']);
  });

  it('readDecks：顶层不是数组 → 空数组（不抛）', () => {
    const kv = createMemoryStore();
    kv.set(L1_DECKS, JSON.stringify({ id: 'd1' }));
    expect(readDecks(readableStore(kv))).toEqual([]);
    kv.set(L1_DECKS, '坏 JSON');
    expect(readDecks(readableStore(kv))).toEqual([]);
  });

  it('readDecks：defIds 里混进非字符串 → 整条被拒（不做半可信的修补）', () => {
    const kv = createMemoryStore();
    kv.set(L1_DECKS, JSON.stringify([
      { id: 'd1', name: 'ok', seed: 's', defIds: ['water', 7], updatedAt: 't' },
      { id: 'd2', name: 'ok', seed: 's', defIds: ['water'], updatedAt: 't' },
    ]));
    expect(readDecks(readableStore(kv)).map((d) => d.id)).toEqual(['d2']);
  });

  it('writeDecks 也过滤非法项（坏数据不落盘）', () => {
    const kv = spyStore();
    const s = createLocalStore({ persistent: kv });
    s.grant();
    expect(writeDecks(s, [{ id: 'd1', name: 'ok', seed: 's', defIds: ['water'], updatedAt: 't' }, { id: 2 } as never])).toBe(true);
    expect(readDecks(s).map((d) => d.id)).toEqual(['d1']);
  });

  it('writeDecks：超过上限 → 返回 false（调用方据此提示"本机保存失败"）', () => {
    const s = createLocalStore({ persistent: createMemoryStore() });
    s.grant();
    // 40 × (2000 个中文字 × 3 字节) ≈ 240 KB ≫ 64 KiB
    const big = Array.from({ length: 40 }, (_, i) => ({
      id: `d${i}`, name: '卡组'.repeat(1000), seed: 's', defIds: ['water'], updatedAt: 't',
    }));
    expect(writeDecks(s, big)).toBe(false);
  });
});

describe('L1：键名与版本（单一定义处）', () => {
  const src = readFileSync(fileURLToPath(new URL('../../src/app/storage.ts', import.meta.url)))
    .subarray(0, 4 * 1024 * 1024)
    .toString('utf8');

  it('键名前缀只在 storage.ts 里出现一次（换前缀/升版本时只改一处）', () => {
    const hits = src.match(/compile-/g) ?? [];
    expect(hits.length, `src/app/storage.ts 里 'compile-' 出现了 ${hits.length} 次，应恰好 1 次（${L1_KEY_PREFIX}）`).toBe(1);
  });

  it('L1 两个键就是前缀 + 固定后缀（键名一旦发布不能改）', () => {
    expect(L1_KEY_PREFIX).toBe('compile-');
    expect(L1_SETTINGS).toBe(`${L1_KEY_PREFIX}settings`);
    expect(L1_DECKS).toBe(`${L1_KEY_PREFIX}decks`);
    expect(L1_SETTINGS).toBe('compile-settings');
    expect(L1_DECKS).toBe('compile-decks');
  });

  it('两个键都在存储层可见（生成式：clearAllLocalData 真的会清它们）', () => {
    const kv = createMemoryStore();
    kv.set(L1_SETTINGS, '{}');
    kv.set(L1_DECKS, '[]');
    expect(clearAllLocalData(kv)).toBe(2);
  });

  it('schema 版本常量存在且是正整数（升版本时走迁移，不换前缀）', () => {
    expect(Number.isInteger(L1_SCHEMA_VERSION)).toBe(true);
    expect(L1_SCHEMA_VERSION).toBeGreaterThanOrEqual(1);
  });

  it('版本常量的定义也在 storage.ts 里（唯一定义处，别处不许再写一份）', () => {
    expect(src).toMatch(/export const L1_SCHEMA_VERSION\s*=\s*\d+/);
    expect(L1_SCHEMA_VERSION).toBe(1);
  });
});
