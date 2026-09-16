import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  L1_DECKS,
  L1_SETTINGS,
  L1_KEY_PREFIX,
  L1_PROBE_KEY,
  L1_SCHEMA_VERSION,
  L1_VALUE_MAX_BYTES,
  createMemoryStore,
  clearAllLocalData,
  selectReadableStore,
  probeWritable,
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
 *
 * ## G3 Task 3 修复轮（红线 3 的**时机**修正）
 *
 * 「用户未点『允许』之前，磁盘上零写入」有两个机检形态，缺一不可：
 *  - **授权之后**：`deny()` ⇒ `persistent.set/remove` 恒 0（本文件「授权状态机」组）；
 *  - **授权之前**：`openL1Store()`（`main.ts` 的**模块级**调用，发生在授权弹窗**之前**）
 *    只做**只读**探测 ⇒ `set`/`remove` 恒 0（`tests/ui/local-store-browser.test.ts` 的
 *    记录式账本腿；那里才有浏览器缝）。
 *
 * 写探针（"Safari 隐私模式：对象在、读得到、写就抛"）**没有丢**，它搬到了
 * **用户点「允许」那一刻**：`grant()` 调 `probeWritable(注入的 KV)` ⇒ 失败就降级为内存 KV
 * （`isPersistent() === false`）。本文件有一组腿专门钉住"grant 的写探针"。
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

/** 已授权、且后端就是给定 KV 的 store（"读盘里已有的值"这类腿用它） */
function readableStore(kv: KeyValueStore): ReturnType<typeof createLocalStore> {
  const s = createLocalStore({ persistent: kv });
  s.grant();
  return s;
}

/**
 * `set` 抛错的假 KV（模拟 Safari 隐私模式：**读得到、写就抛**）。
 * ⚠️ 本假件的 `set` 不记账（它每次都抛），所以别拿它的 `writes` 做断言。
 */
function readOnlyStore(): KeyValueStore {
  const m = createMemoryStore();
  return {
    get: (k) => m.get(k),
    set: () => { throw new Error('QuotaExceededError: 隐私模式下不可写'); },
    remove: (k) => { m.remove(k); },
    keys: () => m.keys(),
  };
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
    expect(kv.mutations(), 'ask 下连"写探针"都不许发生 —— 探针只在 grant() 里').toBe(0);
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
    // 修复轮后：grant() 自己会先跑一次**写探针**（set 探针键 → remove 探针键），
    // 所以"用户数据的写入"是 writes 的第 2、3 次；探针必须**用完即删**（无残留）。
    expect(kv.writes.length, 'grant 的写探针 + 昵称 + 卡组 = 3 次 set').toBe(3);
    expect(kv.writes[0], '第 1 次 set 必须是探针键（授权后、用户数据前）').toEqual([L1_PROBE_KEY, '1']);
    expect(kv.writes[1][0]).toBe(L1_SETTINGS);
    expect(kv.writes[2][0]).toBe(L1_DECKS);
    expect(kv.keys(), '探针键不许残留（只剩两个真键）').toEqual([L1_SETTINGS, L1_DECKS]);

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
    const afterGrant = kv.mutations();
    s.reset();
    expect(s.consent()).toBe('unknown');
    expect(
      kv.mutations(),
      'reset 只改内存闭包变量，不得有落盘调用（grant 的写探针是它之前发生的，不算）',
    ).toBe(afterGrant);
  });

  it('reset 之后即使探针结论残留也不许回到 persistent（两把锁必须同时复位）', () => {
    // 这条腿的来历（修复轮 F1）：`reset()` 里的 `persistentWritable = null` **单独**不承重
    // —— 单独删掉它（M7 变异）两个测试文件**整份全绿**，因为 `usingPersistent()` 还有
    // `consent === 'allowed'` 兜着、而 reset 已把 consent 置回 'unknown'。
    // 真正会出事的是**两把锁一起被削弱**：M6（把 `consent === 'allowed'` 弱化成
    // `!== 'denied'`）+ M7 ⇒ 下面这条链会把用户数据**真的写进 persistent**，
    // 而那时 consent 已经是 'unknown'（= 授权前零写入被违反）。
    // 所以本腿钉的是"consent 与探针结论必须**同时**复位"这个组合不变式：
    // 单 M7 下它仍绿（第一把锁还在），M6+M7 下它必红。
    const kv = spyStore();
    const s = createLocalStore({ persistent: kv });
    s.grant();
    expect(s.isPersistent(), '前置：grant 之后后端确实可持久（否则本腿不承重）').toBe(true);
    s.reset();
    expect(s.consent()).toBe('unknown');
    const before = kv.mutations();
    expect(writeNickName(s, 'reset 之后'), '写入仍必须成功（落内存），不许抛').toBe(true);
    expect(s.kv(), 'reset 之后即使探针结论残留也不许回到 persistent').not.toBe(kv);
    expect(s.isPersistent(), 'reset 之后 isPersistent() 必须为 false').toBe(false);
    expect(kv.mutations(), 'reset 之后不得有任何新的落盘调用').toBe(before);
    expect(kv.keys(), 'reset 之后 persistent 里不许出现任何键').toEqual([]);
  });

  it('授权状态本身不落盘：grant(写探针) + deny 之后，persistent 里没有授权痕迹、探针键也不残留', () => {
    const kv = spyStore();
    const s = createLocalStore({ persistent: kv });
    s.grant();
    s.deny();
    // (a) 探针键无残留（写探针的唯一副作用必须自净）
    expect(kv.get(L1_PROBE_KEY), '写探针的键必须用完即删').toBeNull();
    expect(kv.keys(), 'persistent 里不许有任何键残留').toEqual([]);
    // (b) **没有任何形如"授权状态"的键** —— 授权只活在内存闭包里（设计稿 §3.6：刷新即重问）。
    //     这条用**生成式**口径：把所有短暂的写/删记录摊平，逐个键名查"是不是状态键"。
    const touched = [...kv.writes.map((w) => w[0]), ...kv.removals];
    expect(touched.length, 'grant 应当恰好跑一次写探针（set + remove）').toBe(2);
    expect(
      touched.filter((k) => /consent|grant|deny|allowed|拒绝|允许/i.test(k)),
      '持久层里出现了疑似"授权状态键" —— 授权状态不许落盘，刷新必须重新问',
    ).toEqual([]);
    expect(new Set(touched)).toEqual(new Set([L1_PROBE_KEY]));
  });
});

/* ============================================================================
 * 修复轮新增：`grant()` 里的**写探针**（把"能否真写"的判定搬到授权之后）
 * ========================================================================== */

describe('L1：grant() 的写探针（Safari 隐私模式在授权那一刻被发现）', () => {
  it('set 抛错的后端 ⇒ grant 之后 isPersistent() 为 false，且 kv() 是内存 KV（不抛、不进 persistent）', () => {
    const kv = readOnlyStore();
    const s = createLocalStore({ persistent: kv });
    s.grant();
    expect(s.consent()).toBe('allowed');
    expect(s.isPersistent(), '写得进去才算持久 —— 探针失败必须降级').toBe(false);
    expect(s.kv()).not.toBe(kv);
    expect(writeNickName(s, '隐私模式'), '写入必须仍然成功（落到内存），不许抛').toBe(true);
    expect(readNickName(s)).toBe('隐私模式');
    expect(kv.keys(), 'persistent 里一个字都不许有').toEqual([]);
  });

  it('对照腿：set 正常 ⇒ isPersistent() 为 true，且写进的东西真的进 persistent', () => {
    const kv = spyStore();
    const s = createLocalStore({ persistent: kv });
    s.grant();
    expect(s.isPersistent()).toBe(true);
    expect(s.kv()).toBe(kv);
    expect(writeNickName(s, '正常'), 'set 正常的后端不该被误判').toBe(true);
    expect(readNickName(readableStore(kv))).toBe('正常');
  });

  it('写探针只跑一次：多次调用 kv()/isPersistent() 不再产生任何新写入', () => {
    const kv = spyStore();
    const s = createLocalStore({ persistent: kv });
    s.grant();
    const after = kv.mutations();
    s.kv(); s.kv(); s.isPersistent(); s.consent();
    expect(kv.mutations(), '探针结论必须被记住（否则每次读 kv() 都写一次盘）').toBe(after);
  });

  it('deny 之前不跑写探针；reset 之后再 grant 会**重新**探一次（存储可能变了）', () => {
    const kv = spyStore();
    const s = createLocalStore({ persistent: kv });
    s.deny();
    expect(kv.mutations(), '游客模式连探针都不许有').toBe(0);
    s.reset();
    s.grant();
    expect(kv.mutations(), 'reset → grant 应当重新探一次（set + remove）').toBe(2);
    expect(s.isPersistent()).toBe(true);
  });

  it('probeWritable：探针键用完即删；set 抛 / remove 抛都只回 false，不外抛', () => {
    const good = spyStore();
    expect(probeWritable(good)).toBe(true);
    expect(good.writes).toEqual([[L1_PROBE_KEY, '1']]);
    expect(good.removals).toEqual([L1_PROBE_KEY]);
    expect(good.keys(), '探针不留痕').toEqual([]);

    expect(probeWritable(readOnlyStore()), 'set 抛 ⇒ false，不抛异常').toBe(false);

    const removeThrows: KeyValueStore = {
      get: () => null,
      set: () => { /* set 成 */ },
      remove: () => { throw new Error('不可删除'); },
      keys: () => [],
    };
    expect(() => probeWritable(removeThrows), 'remove 抛也必须被吞成 false').not.toThrow();
    expect(probeWritable(removeThrows), '"写得进但删不掉"的后端必须被判成不可写').toBe(false);
  });

  it('probeWritable：`set` 成、`remove` 抛 ⇒ **探针键会残留**（已记录的残留行为，不是 bug 伪装）', () => {
    // 这条腿的来历：A3 变异（删掉 catch 里的"二次清理 remove"）实测**全绿** ⇒ 那段清理
    // 是死代码（remove 抛时再调 remove 还是抛），已删除。这里把**真实行为**钉住：
    // 这种后端等于"写得进、删不掉"，残留一个探针键是它自己的病症；调用方拿到 false 后
    // 整个降级为内存 KV、不再碰它（所以残留不会被继续放大）。
    const m = new Map<string, string>();
    const ledger: string[] = [];
    const kv: KeyValueStore = {
      get: (k) => (m.has(k) ? (m.get(k) as string) : null),
      set: (k, v) => { ledger.push(`set:${k}`); m.set(k, v); },
      remove: (k) => { ledger.push(`remove:${k}`); throw new Error('不可删除'); },
      keys: () => [...m.keys()],
    };
    expect(probeWritable(kv)).toBe(false);
    expect(ledger, 'set 与 remove 各试了一次（remove 抛）').toEqual([`set:${L1_PROBE_KEY}`, `remove:${L1_PROBE_KEY}`]);
    expect(m.get(L1_PROBE_KEY), '残留已记录在案（没有第二次清理，见测试名）').toBe('1');
    // 端到端：这类后端在 grant 之后被整体降级 ⇒ 不会有更多写入
    const s = createLocalStore({ persistent: kv });
    s.grant();
    expect(s.isPersistent()).toBe(false);
    expect(writeNickName(s, '甲')).toBe(true);
    expect(m.has(L1_SETTINGS), '用户数据一个字都不会写进这个坏后端').toBe(false);
  });

  it('probeWritable：探针键**不影响** clearAllLocalData 的计数（它只数 L1 的两个真键）', () => {
    const kv = createMemoryStore();
    kv.set(L1_PROBE_KEY, '1'); // 模拟"探针恰好残留"（真实实现会 remove 掉）
    kv.set(L1_SETTINGS, '{}');
    const n = clearAllLocalData(kv);
    expect(n, '清掉的是 compile-settings 一个，探针键不算 L1 数据').toBe(1);
    expect(kv.get(L1_PROBE_KEY), '探针键不归"清除本机数据"管（它自己会删）').toBe('1');
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

  it('readJson：`"null"` 是**合法解析** → 归一成 fallback（否则调用方 `s.nick` 抛 TypeError）', () => {
    const kv = createMemoryStore();
    kv.set(L1_SETTINGS, 'null');
    const fallback = { nick: '兜底' };
    const got = readJson(kv, L1_SETTINGS, fallback);
    expect(got, '`JSON.parse(null 字面量)` 的结果不许原样穿出去').toBe(fallback);
    expect(got).not.toBeNull();
  });

  it('readJson：数字 / 字符串 / 布尔**不**归一（那是调用方按形状守的事）', () => {
    const kv = createMemoryStore();
    for (const raw of ['42', '"x"', 'true']) {
      kv.set(L1_SETTINGS, raw);
      expect(readJson<unknown>(kv, L1_SETTINGS, { a: 1 }), `${raw} 不该被吞成 fallback`).toEqual(JSON.parse(raw));
    }
  });

  it('readJson：形状合法但类型不对 → 由调用方守卫兜底（readNickName 回空串）', () => {
    const kv = createMemoryStore();
    kv.set(L1_SETTINGS, JSON.stringify({ nick: 42 }));
    expect(readNickName(createLocalStore({ persistent: kv }))).toBe('');
  });

  it('readNickName：字面量 `null` → 回空串（不抛 TypeError）', () => {
    const kv = createMemoryStore();
    kv.set(L1_SETTINGS, 'null');
    const s = createLocalStore({ persistent: kv });
    s.grant();
    expect(() => readNickName(s), '`typeof null.nick` 就是这一轮要修的崩溃').not.toThrow();
    expect(readNickName(s)).toBe('');
    expect(writeNickName(s, '甲'), '读到 null 之后仍然要能正常写入').toBe(true);
    expect(readNickName(s)).toBe('甲');
  });

  it('readNickName：值是数字 / 字符串 / 布尔 / 数组（合法 JSON 但非设置对象）→ 回空串，且写入不被污染', () => {
    for (const raw of ['42', '"x"', 'true', '[1,2]']) {
      const kv = createMemoryStore();
      kv.set(L1_SETTINGS, raw);
      const s = createLocalStore({ persistent: kv });
      s.grant();
      expect(readNickName(s), `${raw} 该回空串`).toBe('');
      expect(writeNickName(s, '甲'), `${raw} 之后写入应成功`).toBe(true);
      expect(readJson<Record<string, unknown>>(kv, L1_SETTINGS, {}), `${raw} 的垃圾不许被摊进新值`)
        .toEqual({ nick: '甲' });
    }
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

  /* ── 修复轮新增（评审者 §5(f)：这两条守卫此前**无腿**，删掉它们 45 条腿全绿） ── */

  it('JSON.stringify 返回 undefined 的值（undefined / 函数 / Symbol）→ write-failed，且**一次 set 都没有**', () => {
    for (const [label, value] of [
      ['undefined', undefined],
      ['函数', () => 1],
      ['Symbol', Symbol('s')],
    ] as const) {
      const kv = spyStore();
      const r = writeJson(kv, L1_SETTINGS, value);
      expect(r.ok, `${label} 该被判成不可写`).toBe(false);
      if (r.ok) continue;
      expect(r.reason, `${label}`).toBe('write-failed');
      expect(r.detail.length, `${label} 的 detail 不许为空`).toBeGreaterThan(0);
      expect(kv.writes, `${label} 必须在**碰 KV 之前**就被拦下`).toEqual([]);
      expect(kv.mutations(), `${label}：set/remove 调用数必须为 0`).toBe(0);
    }
  });

  it('这些值是"字符串以外"而非"序列化抛错"：JSON.stringify 确实返回 undefined（判据的前提自检）', () => {
    // 自检：如果哪天 `JSON.stringify(undefined)` 变成返回字符串（`'undefined'`？），
    // 上面那条腿就会走"合法字符串"分支而恒绿 —— 这里把前提钉死，让漂移**响亮**。
    expect(JSON.stringify(undefined)).toBe(undefined);
    expect(JSON.stringify(() => 1)).toBe(undefined);
    expect(typeof JSON.stringify(Symbol('s'))).toBe('undefined');
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
});

/* ============================================================================
 * 修复轮重写：只读选择（授权前零写入）+ 写探针（授权后）
 * ========================================================================== */

describe('L1：后端探测 —— 授权前只读、授权后才写', () => {
  it('selectReadableStore：可读的后端被选中，且**一次写都没有**（set 0 / remove 0）', () => {
    const kv = spyStore();
    expect(selectReadableStore(kv)).toBe(kv);
    expect(kv.writes, '授权前的探测不许写').toEqual([]);
    expect(kv.removals, '授权前的探测不许删').toEqual([]);
    expect(kv.mutations(), 'set/remove 调用数必须为 0').toBe(0);
  });

  it('selectReadableStore：`get` 抛错的后端被拒（返回 null）—— 取代旧的"set 抛就跳过"', () => {
    const bad: KeyValueStore = {
      get: () => { throw new Error('SecurityError：存储被禁'); },
      set: () => {},
      remove: () => {},
      keys: () => [],
    };
    expect(selectReadableStore(bad)).toBeNull();
  });

  it('selectReadableStore：`keys` 抛错的后端也被拒（枚举能力是 clearAllLocalData 的前置）', () => {
    const bad: KeyValueStore = {
      get: () => null,
      set: () => {},
      remove: () => {},
      keys: () => { throw new Error('不可枚举'); },
    };
    expect(selectReadableStore(bad)).toBeNull();
  });

  it('selectReadableStore：**set 抛但读得到**的后端**会**被选中 —— 这正是只读探测的代价，由 grant 的写探针兜住', () => {
    // 旧腿（`set 抛 ⇒ 被跳过`）的**意图**是"别把不可用的后端当可用后端"，那个意图现在由
    // `probeWritable` 在授权之后实现（见下面的"授权那一刻"组）。这里把代价**明写成判据**：
    // 只读选择会选它 ⇒ 必须有写探针兜住，否则 Safari 隐私模式会被静默当成可用后端。
    const readOnly = readOnlyStore();
    expect(selectReadableStore(readOnly), '只读探测选不出"写得进不进"').toBe(readOnly);
    expect(probeWritable(readOnly), '写探针必须把它判死').toBe(false);
    // 端到端：授权之后它确实被降级（不是"看起来被选中就算数"）
    const s = createLocalStore({ persistent: readOnly });
    s.grant();
    expect(s.isPersistent()).toBe(false);
  });

  it('selectReadableStore：探针是**读**，键不存在也照样回后端（读探针不写、删）', () => {
    const kv = createMemoryStore();
    expect(selectReadableStore(kv)).toBe(kv);
    expect(kv.keys(), '探测本身不污染用户数据').toEqual([]);
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
    kv.set(L1_DECKS, 'null');
    expect(readDecks(readableStore(kv)), '字面量 null 也必须回空数组').toEqual([]);
  });

  it('readDecks：defIds 里混进非字符串 → 整条被拒（不做半可信的修补）', () => {
    const kv = createMemoryStore();
    kv.set(L1_DECKS, JSON.stringify([
      { id: 'd1', name: 'ok', seed: 's', defIds: ['water', 7], updatedAt: 't' },
      { id: 'd2', name: 'ok', seed: 's', defIds: ['water'], updatedAt: 't' },
    ]));
    expect(readDecks(readableStore(kv)).map((d) => d.id)).toEqual(['d2']);
  });

  it('writeDecks 的过滤是**写侧真判据**：KV 的原始内容里只剩合法项（不许靠 readDecks 的读侧过滤掩盖）', () => {
    // ⚠️ 这条腿的判据**故意**绕过 `readDecks`：旧版本（评审者 M-变异实证）用
    // `readDecks(s)` 读回，而读路径又过滤一次 ⇒ 把 `writeDecks` 里的
    // `decks.filter(isDeckRecord)` 整个删掉，45 条腿**仍然全绿**（写脏盘被读侧掩盖）。
    // 现在直接解析 `kv.get(L1_DECKS)` 的**原始字符串**："脏数据落盘"必红。
    const kv = spyStore();
    const s = createLocalStore({ persistent: kv });
    s.grant();
    /** 故意混进非法项（类型层面强转一次，让"运行时脏数据"这件事能被写进来真跑） */
    const badDecks = (v: unknown[]): Parameters<typeof writeDecks>[1] => v as Parameters<typeof writeDecks>[1];
    const dirty = badDecks([
      { id: 'd1', name: 'ok', seed: 's', defIds: ['water'], updatedAt: 't' },
      { id: 2 },
      null,
      'deck',
      { id: 'd3', name: 'ok', seed: 's', defIds: ['water', 7], updatedAt: 't' },
    ]);
    expect(writeDecks(s, dirty)).toBe(true);

    const raw = kv.get(L1_DECKS);
    expect(raw, 'writeDecks 必须真的写了一次卡组键').not.toBeNull();
    const parsed = JSON.parse(raw as string) as unknown[];
    expect(Array.isArray(parsed), '落盘的是数组').toBe(true);
    expect(parsed, '落盘的原始内容里只允许合法项').toEqual([
      { id: 'd1', name: 'ok', seed: 's', defIds: ['water'], updatedAt: 't' },
    ]);
    expect(parsed.length, '非法项一个都不许落盘').toBe(1);
    // 反向自检（防"判据在空串上恒真"）：写进去的原始串里必须**没有**非法项的痕迹。
    expect(raw as string).not.toContain('"id":2');
    expect(raw as string).not.toContain('"deck"');
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

  it('L1 探针键也由前缀拼出，且**不在** L1 的两个真键里（清除本机数据不会误伤它）', () => {
    expect(L1_PROBE_KEY).toBe(`${L1_KEY_PREFIX}l1-probe`);
    expect([L1_SETTINGS, L1_DECKS]).not.toContain(L1_PROBE_KEY);
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

/* ============================================================================
 * 授权前零写入的**时机**守卫（文本腿，与 tests/ui/local-store-browser.test.ts 的
 * 行为账本腿互补）：授权之前**唯一**允许被探测的写入点必须在 grant() 之后。
 * ========================================================================== */

describe('L1：写探针的时机（纯层源码腿）', () => {
  const src = readFileSync(fileURLToPath(new URL('../../src/app/local-store.ts', import.meta.url)))
    .subarray(0, 1024 * 1024)
    .toString('utf8');
  const storeSrc = readFileSync(fileURLToPath(new URL('../../src/app/storage.ts', import.meta.url)))
    .subarray(0, 1024 * 1024)
    .toString('utf8');

  it('probeWritable 在 storage.ts 里只被定义一次，且**不是**被选择路径调用的', () => {
    expect(storeSrc.match(/export function probeWritable\s*\(/g)?.length, '定义处唯一').toBe(1);
    // 选择路径（selectReadableStore 的函数体）里不许出现 probeWritable：
    // 它是"授权前"跑的函数，一旦在里面调写探针，红线 3 立刻被违反。
    const body = storeSrc.slice(
      storeSrc.indexOf('export function selectReadableStore'),
      storeSrc.indexOf('export function probeWritable'),
    );
    expect(body).not.toContain('probeWritable(');
    expect(body).not.toMatch(/\.set\s*\(/);
    expect(body).not.toMatch(/\.remove\s*\(/);
  });

  it('local-store.ts 里 probeWritable 只出现在 grant() 的文档注释与函数体范围内', () => {
    const callAt = src.indexOf('probeWritable(opts.persistent)');
    expect(callAt, 'grant 里的写探针调用点没了？').toBeGreaterThan(-1);
    const grantAt = src.indexOf('grant: () => {');
    const nextMemberAt = src.indexOf('deny: () => {');
    expect(grantAt).toBeGreaterThan(-1);
    expect(nextMemberAt).toBeGreaterThan(grantAt);
    expect(callAt, '写探针必须在 grant() 的函数体内（授权之后）').toBeGreaterThan(grantAt);
    expect(callAt, '写探针不许跑到 grant() 之外（比如 kv()/isPersistent()）').toBeLessThan(nextMemberAt);
  });
});
