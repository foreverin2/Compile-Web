import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { L1_DECKS, L1_PROBE_KEY, L1_SETTINGS, readJson, writeJson } from '../../src/app/storage';
import { createLocalStore, readDecks, readNickName, writeDecks, writeNickName } from '../../src/app/local-store';
import { openL1Store, memoryFallback, type StorageLike } from '../../src/ui/local-store-browser';

/* ============================================================================
 * G3 Task 3 修复轮：`src/ui/local-store-browser.ts` 的**行为腿**（此前 45 条腿零覆盖）
 *
 * 评审者实证：把该文件整体清空成 `export {};`（**或**让 `openL1Store` 恒返回 `null`），
 * 提交时的 45 条腿**全部仍然全绿** ⇒ 这个文件当时没有任何机检。
 *
 * ## 为什么缝必须开在**参数表**上（而不是测试里往 `globalThis` 打桩）
 * 本会话刚发生过一次真实事故：`src/ui/pwa-update.ts` 把 `navigator.serviceWorker` 误写成
 * `globalThis.serviceWorker`，**真实浏览器里 PWA 从不注册**，而四道门禁全绿（因为只有
 * "读源码找字符串"的文本腿，替换 `globalThis` 的桩根本证明不了产出代码读的是哪个对象）。
 * ⇒ `openL1Store(env?)` 的参数表里有 `localStorage: () => StorageLike | null` 这个缝，
 * 下面的腿**真把假件喂进去**，断言"写进去的值能从那个假件里读回来"。
 *
 * ## 红线 3 的**记录式账本**
 * 本文件的核心判据不是"看起来没写"，而是一本**逐次记账**的账本：假 `localStorage` 把
 * 每一次 `getItem`/`setItem`/`removeItem`/`key`/`length` 都记下来，于是
 * "授权前 `set`/`remove` 调用数为 0"是一个**可数**的结论。
 * 账本本身也有一条**对照腿**（故意用写探针跑一次 ⇒ 账本非空）—— 否则"账本为空"可能只是
 * 因为账本压根没接上（空洞断言）。
 * ========================================================================== */

/* ---------------- 记录式假 localStorage ---------------- */

interface LedgerEntry { op: 'get' | 'set' | 'remove' | 'key' | 'length'; key: string }

interface FakeStorage extends StorageLike {
  /** 每一次调用（含读）——"记录式账本"就是它 */
  ledger: LedgerEntry[];
  /** 账本里 `set` 的次数（红线 3 的写判据口径之一） */
  setCount(): number;
  /** 账本里 `remove` 的次数 */
  removeCount(): number;
  /** 底层真实存了哪些键（与账本独立的一份：用来证明"值真的进去了"） */
  snapshot(): Record<string, string>;
  /** 让 `getItem` 抛错（模拟"对象在但一用就抛"） */
  breakGet(): void;
}

/**
 * 造一个假的 `localStorage`：真存值 + 逐次记账。
 * 刻意**不**实现任何 `globalThis` 相关的东西 —— 它只从 `openL1Store` 的形参进去。
 */
function fakeStorage(seed: Record<string, string> = {}): FakeStorage {
  const m = new Map<string, string>(Object.entries(seed));
  const ledger: LedgerEntry[] = [];
  let getThrows = false;
  return {
    ledger,
    setCount: () => ledger.filter((e) => e.op === 'set').length,
    removeCount: () => ledger.filter((e) => e.op === 'remove').length,
    snapshot: () => Object.fromEntries(m),
    breakGet: () => { getThrows = true; },
    getItem: (k) => {
      ledger.push({ op: 'get', key: k });
      if (getThrows) throw new Error('SecurityError：读取被拒');
      return m.has(k) ? (m.get(k) as string) : null;
    },
    setItem: (k, v) => { ledger.push({ op: 'set', key: k }); m.set(k, v); },
    removeItem: (k) => { ledger.push({ op: 'remove', key: k }); m.delete(k); },
    get length() { ledger.push({ op: 'length', key: '' }); return m.size; },
    key: (i) => { ledger.push({ op: 'key', key: String(i) }); return [...m.keys()][i] ?? null; },
  };
}

/** 把假 `localStorage` 注入缝里（**不动 `globalThis`**）。 */
const env = (ls: StorageLike | null) => ({ localStorage: () => ls });

/**
 * 把 `globalThis.localStorage` 临时换掉或**定义成会抛的 getter**，返回还原函数。
 *
 * ⚠️ 只在"访问 `globalThis.localStorage` 本身就抛"那条腿里用 —— 它判的**正是**零参调用
 * 形态下 `openL1Store()` 走默认环境的行为，无法用形参表达（形参那条缝的语义是"注入假件"）。
 * 用完立刻还原；两个用例都放在 `try/finally` 里，断言失败也会还原（不留跨用例污染）。
 */
function withGlobalLocalStorage(desc: () => PropertyDescriptor): () => void {
  const before = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', desc());
  return () => {
    if (before === undefined) delete (globalThis as { localStorage?: unknown }).localStorage;
    else Object.defineProperty(globalThis, 'localStorage', before);
  };
}

/* ============================================================================
 * 0. 账本自检：证明这本账**记得住东西**（否则后面"账本为空"全是空洞断言）
 * ========================================================================== */

describe('假 localStorage 的账本自检（先证明账本有效，再看它为空）', () => {
  it('对照腿：真做一次 set/remove 时账本**非空**（账本不是空转的）', () => {
    const ls = fakeStorage();
    ls.setItem('x', '1');
    ls.removeItem('x');
    ls.getItem('x');
    expect(ls.ledger.length).toBeGreaterThan(0);
    expect(ls.setCount()).toBe(1);
    expect(ls.removeCount()).toBe(1);
  });

  it('对照腿：用**旧写探针**（set→get→remove）跑一次 ⇒ 账本非空（正是本轮要消灭的形态）', () => {
    const ls = fakeStorage();
    // 这是修复前 `pickNamedStore` 干的事，逐字复刻
    ls.setItem(L1_PROBE_KEY, '1');
    ls.getItem(L1_PROBE_KEY);
    ls.removeItem(L1_PROBE_KEY);
    expect(ls.setCount(), '写探针会让账本记到 set').toBe(1);
    expect(ls.removeCount()).toBe(1);
  });
});

/* ============================================================================
 * 1. 只读探测（授权之前：`main.ts` 的模块级 openL1Store() 就在这条路上）
 * ========================================================================== */

describe('openL1Store：授权之前**只读**（红线 3 的时机判据）', () => {
  it('① 有 localStorage 且可用 ⇒ 返回非 null，且 get/set/remove 真的落到那个假件上', () => {
    const ls = fakeStorage();
    const kv = openL1Store(env(ls));
    expect(kv, '可用的后端不该被判成 null').not.toBeNull();
    const store = kv as NonNullable<typeof kv>;
    // 读回你写进去的值（证明"缝接上了"：产出代码操作的就是这个假件）
    store.set(L1_SETTINGS, '{"nick":"甲"}');
    expect(ls.snapshot()[L1_SETTINGS], '值得真的落在假件里').toBe('{"nick":"甲"}');
    expect(store.get(L1_SETTINGS)).toBe('{"nick":"甲"}');
    store.remove(L1_SETTINGS);
    expect(ls.snapshot()[L1_SETTINGS]).toBeUndefined();
    expect(store.get(L1_SETTINGS)).toBeNull();
  });

  it('①b `keys()` 反映假件的真实键集合（length/key 两条路都通）', () => {
    const ls = fakeStorage({ a: '1', b: '2' });
    const store = openL1Store(env(ls));
    expect(store?.keys().sort()).toEqual(['a', 'b']);
    store?.set('c', '3');
    expect(store?.keys().sort()).toEqual(['a', 'b', 'c']);
  });

  it('② `openL1Store()`（零参，走默认环境）在 `globalThis.localStorage` **访问就抛**时返回 null 且不抛', () => {
    const restore = withGlobalLocalStorage(() => ({
      configurable: true,
      get() { throw new Error('SecurityError：沙箱 iframe 里访问 localStorage 即抛'); },
    }));
    try {
      expect(() => openL1Store(), '访问抛错必须被吞成 null').not.toThrow();
      expect(openL1Store()).toBeNull();
    } finally {
      restore();
    }
  });

  it('②b 同理：`globalThis.localStorage` 是 null（file:// 等）⇒ null，不抛', () => {
    const restore = withGlobalLocalStorage(() => ({ configurable: true, value: null }));
    try {
      expect(openL1Store()).toBeNull();
    } finally {
      restore();
    }
  });

  it('③ 假件的 `getItem` 抛 ⇒ 返回 null 且不抛', () => {
    const ls = fakeStorage();
    ls.breakGet();
    expect(() => openL1Store(env(ls)), 'getItem 抛错不许外抛').not.toThrow();
    expect(openL1Store(env(ls))).toBeNull();
  });

  it('③b 形参显式给 null（注入缝说"这个环境没有 localStorage"）⇒ null，不抛', () => {
    expect(() => openL1Store(env(null))).not.toThrow();
    expect(openL1Store(env(null))).toBeNull();
  });

  it('🔴 红线 3 账本腿：`openL1Store(假件)` 的 **set 数 0、remove 数 0**（探测是只读的）', () => {
    const ls = fakeStorage({ '别人的键': '别人的值' });
    const kv = openL1Store(env(ls));
    expect(kv).not.toBeNull();
    expect(ls.setCount(), '授权之前的探测出现了一次 set —— 违反红线 3').toBe(0);
    expect(ls.removeCount(), '授权之前的探测出现了一次 remove —— 违反红线 3').toBe(0);
    expect(ls.snapshot(), '探测不许改动任何既有数据').toEqual({ '别人的键': '别人的值' });
    // 账本**确实**记得东西（有读发生）—— 否则上面三条可能只是"缝没接上"
    expect(ls.ledger.filter((e) => e.op === 'get').length, '探测必须真的读了（账本有效性）').toBeGreaterThan(0);
  });

  it('🔴 对照腿：把同一条路径换成**旧写探针**跑一次 ⇒ set/remove 账本**非空**', () => {
    const ls = fakeStorage();
    openL1Store(env(ls));
    expect(ls.setCount(), '只读路径账本为空（正控）').toBe(0);
    // 反证：在同一个假件上做一次写探针，账本立刻记到 —— 证明上面那个 0 不是"账本坏了"
    ls.setItem(L1_PROBE_KEY, '1');
    ls.removeItem(L1_PROBE_KEY);
    expect(ls.setCount()).toBe(1);
    expect(ls.removeCount()).toBe(1);
  });
});

/* ============================================================================
 * 2. 端到端：授权状态机 + 浏览器后端（"用户模式"这条链不是死的）
 * ========================================================================== */

describe('端到端：createLocalStore(openL1Store(假件))', () => {
  it('④ `grant()` + `writeNickName` ⇒ 值真的出现在假件的存储里（用户模式这条链是活的）', () => {
    const ls = fakeStorage();
    const s = createLocalStore({ persistent: openL1Store(env(ls)) });
    expect(s.consent()).toBe('unknown');
    s.grant();
    expect(s.isPersistent(), 'grant 的写探针通过 ⇒ 真的用持久后端').toBe(true);
    expect(writeNickName(s, '甲'), '写入应成功').toBe(true);
    expect(readNickName(s)).toBe('甲');
    // ⚠️ 判据落在**假件**上（不是"读回来看着对"）：值必须真的在 localStorage 里
    const stored = ls.snapshot();
    expect(Object.keys(stored), '只有 compile-settings 一个键（探针键已自净）').toEqual([L1_SETTINGS]);
    expect(JSON.parse(stored[L1_SETTINGS]) as unknown).toEqual({ nick: '甲' });
    // 卡组也走同一条链
    expect(writeDecks(s, [{ id: 'd1', name: '我的卡组', seed: 's', defIds: ['water'], updatedAt: 't' }])).toBe(true);
    expect(JSON.parse(ls.snapshot()[L1_DECKS]) as unknown).toEqual([
      { id: 'd1', name: '我的卡组', seed: 's', defIds: ['water'], updatedAt: 't' },
    ]);
    // 新开一个 store（模拟刷新）也能从同一个假件里读回
    const again = createLocalStore({ persistent: openL1Store(env(ls)) });
    again.grant();
    expect(readNickName(again)).toBe('甲');
    expect(readDecks(again).map((d) => d.name)).toEqual(['我的卡组']);
    // grant 的写探针**已经自净**：假件里没有探针键
    expect(ls.snapshot()[L1_PROBE_KEY], '探针键必须用完即删').toBeUndefined();
  });

  it('🔴 端到端账本腿：启动 → 渲染授权弹窗（consent 仍 unknown）→ deny() ⇒ set/remove 账本仍为空', () => {
    const ls = fakeStorage();
    // === 启动路径（main.ts 模块级那一步）===
    const store = createLocalStore({ persistent: openL1Store(env(ls)) });
    // === 弹窗已显示、等用户点（main.ts 的 consentStep('show') → ask()）===
    store.ask();
    expect(store.consent()).toBe('ask');
    // 未表态时即便有人误写也不该落盘（走内存）
    writeNickName(store, '还没点');
    expect(ls.setCount(), '授权弹窗渲染 + ask 期间出现 set').toBe(0);
    expect(ls.removeCount(), '授权弹窗渲染 + ask 期间出现 remove').toBe(0);
    // === 用户点「不允许」===
    store.deny();
    writeNickName(store, '游客甲');
    writeDecks(store, [{ id: 'd1', name: '游客的卡组', seed: 's', defIds: ['water'], updatedAt: 't' }]);
    expect(store.consent()).toBe('denied');
    expect(ls.setCount(), '点「不允许」之后仍然不许有任何 set —— 这是本轮修复的重点').toBe(0);
    expect(ls.removeCount(), '点「不允许」之后也不许有任何 remove').toBe(0);
    expect(ls.snapshot(), '游客模式下磁盘内容一字未改').toEqual({});
    // 游客模式仍可玩：数据在内存里读得回来
    expect(readNickName(store)).toBe('游客甲');
    expect(readDecks(store).map((d) => d.name)).toEqual(['游客的卡组']);
    // 账本有效性：读确实发生了（否则上面的 0 可能是缝没接上）
    expect(ls.ledger.length, '账本非空（读探针真的跑过）').toBeGreaterThan(0);
  });

  it('端到端：假件 `getItem` 抛 ⇒ persistent 为 null ⇒ 全功能退化到内存（不崩）', () => {
    const ls = fakeStorage();
    ls.breakGet();
    const s = createLocalStore({ persistent: openL1Store(env(ls)) });
    s.grant();
    expect(s.isPersistent()).toBe(false);
    expect(writeNickName(s, '甲')).toBe(true);
    expect(readNickName(s)).toBe('甲');
    expect(ls.setCount(), '存储不可用时更不该有写入').toBe(0);
  });

  it('端到端："读得到但写不进"（Safari 隐私模式）⇒ grant 的写探针把它降级成内存，写入仍然成功', () => {
    // 假件：getItem 正常、setItem 抛 QuotaExceededError（真实 Safari 隐私模式的形态）
    const m = new Map<string, string>();
    const ledger: LedgerEntry[] = [];
    const quotaStorage: StorageLike = {
      getItem: (k) => { ledger.push({ op: 'get', key: k }); return m.has(k) ? (m.get(k) as string) : null; },
      setItem: (k) => { ledger.push({ op: 'set', key: k }); throw new Error('QuotaExceededError'); },
      removeItem: (k) => { ledger.push({ op: 'remove', key: k }); m.delete(k); },
      get length() { return m.size; },
      key: (i) => [...m.keys()][i] ?? null,
    };
    const kv = openL1Store(env(quotaStorage));
    expect(kv, '只读探测看不到"写不进" ⇒ 它会被选中（这是只读探测的代价）').not.toBeNull();
    const s = createLocalStore({ persistent: kv });
    s.grant();
    expect(s.isPersistent(), '写探针必须在授权那一刻发现它').toBe(false);
    expect(s.kv()).not.toBe(kv);
    // 玩家侧的表现：**写入照样成功**（落到内存），本次会话能正常游玩、只是刷新即丢
    expect(writeNickName(s, '甲'), '降级之后玩家不该看到失败').toBe(true);
    expect(readNickName(s)).toBe('甲');
    // 而**落盘**这一路（探针没兜住时的最后一道防线）仍然是"响亮地失败、不抛"
    const result = writeJson(kv as NonNullable<typeof kv>, L1_SETTINGS, { nick: '甲' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('write-failed');
    expect(m.size, '一个字都没真的写进去（探针 set 抛、remove 清不到）').toBe(0);
  });

  it('memoryFallback 与游客模式是同一份实现（能存能读能列）', () => {
    const kv = memoryFallback();
    expect(kv.get('k')).toBeNull();
    kv.set('k', 'v');
    expect(kv.get('k')).toBe('v');
    expect(kv.keys()).toEqual(['k']);
    kv.remove('k');
    expect(kv.get('k')).toBeNull();
  });
});

/* ============================================================================
 * 3. 源码腿（**补充**行为腿，不替代）：`src/app/**` 里不许出现 localStorage 的**调用**
 * ========================================================================== */

describe('分层：浏览器 API 只允许出现在 src/ui/local-store-browser.ts', () => {
  const ui = readFileSync(fileURLToPath(new URL('../../src/ui/local-store-browser.ts', import.meta.url)))
    .subarray(0, 1024 * 1024).toString('utf8');
  const appStorage = readFileSync(fileURLToPath(new URL('../../src/app/storage.ts', import.meta.url)))
    .subarray(0, 1024 * 1024).toString('utf8');

  it('src/app/storage.ts 里没有 `localStorage` 的**调用**（注释里提到名字是允许的）', () => {
    const code = appStorage.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toMatch(/\blocalStorage\s*[.[]/);
    expect(code, '反向：扫描本身有效（纯层必需的东西还在）').toContain('KeyValueStore');
  });

  it('本文件（唯一允许碰浏览器存储的地方）默认环境才读 globalThis.localStorage，且缝在形参上', () => {
    expect(ui, '零参调用形态必须保留（Task 4 / Task 7 就是这么调的）').toMatch(/function openL1Store\(\s*env\?/);
    // 缝必须是**参数表**上的（形参里出现 localStorage 的读动作）
    expect(ui).toMatch(/localStorage\?:\s*\(\)\s*=>/);
  });
});
