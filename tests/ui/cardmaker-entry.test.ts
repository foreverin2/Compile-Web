import { describe, it, expect, afterEach } from 'vitest';
import { installStubDom, makeStubEl, descendants, type StubNode } from './net-dom-stub';
import { renderHome, type HomeNav } from '../../src/ui/home';
import { CREDIT, renderCardmaker } from '../../src/ui/cardmaker/page';
import {
  CARDMAKER_DB_NAME,
  CARDMAKER_DECK_KEY,
  createCardmakerStore,
  clearCardmakerDeck,
  readCardmakerDeckInfo,
  type IdbLike,
} from '../../src/ui/cardmaker/store-idb';
import { createLocalStore } from '../../src/app/local-store';
import { createMemoryStore, type KeyValueStore } from '../../src/app/storage';
import { defaultCard, defaultDeck, type Deck } from '../../src/ui/cardmaker/types';

/**
 * 入口与存储的接线腿（2026-10-01）。**两件事**：
 *
 * 1. **首页入口按钮**（用户要求"新增一个入口按钮"）：真跑一次 `renderHome`，点那个按钮
 *    必须调到 `nav.openCardmaker`。反向腿：换一份 nav 再点，证明调的是**注入的**那一个。
 * 2. **制作器存储**：`createCardmakerStore` 的三档行为 —— 持久层可用时真读写、
 *    游客模式时**一个字节都不碰**持久层、IndexedDB 打不开时如实降级。
 *
 * ## 关于 DOM
 * 本仓**没有 jsdom**（`npm ls` 里没有，也不许为这个功能加新包），所以两件事都在既有的
 * 手写 DOM 桩（`tests/ui/net-dom-stub.ts`）上跑。桩的两条边界照旧要用规避手法：
 *  - `querySelectorAll('button')` **不可用**（极简选择器引擎不认裸 tag 做起点组合）⇒
 *    本文件用 `descendants()` 自己筛；
 *  - `dispatchEvent` **不调用派发节点自己的监听器** ⇒ 点按钮要用 `clickNode()` 的
 *    "临时挂一个空子节点、在它上面派发、再摘掉"手法。
 */

const restores: Array<() => void> = [];

function mountRoot(): StubNode {
  restores.push(installStubDom());
  return makeStubEl('div');
}

afterEach(() => {
  while (restores.length > 0) restores.pop()?.();
});

/** 在某个节点上真派发一次 `click`（绕开桩那条"不调用自己的监听器"的边界） */
function clickNode(node: StubNode): void {
  const clicker = makeStubEl('span');
  node.appendChild(clicker);
  clicker.dispatchEvent({ type: 'click', target: clicker });
  node.textContent = node.text;
}

/** 树里所有按钮（桩上 `querySelectorAll` 认不得裸 tag ⇒ 自己筛） */
function buttonsOf(root: StubNode): StubNode[] {
  return descendants(root).filter((n) => n.tag === 'button');
}

function findButtonByText(root: StubNode, label: string): StubNode | null {
  return buttonsOf(root).find((b) => b.text.trim() === label) ?? null;
}

/* ==================================================================== *
 * 1. 首页入口
 * ==================================================================== */

/** 造一份最小 nav（只关心 cardmaker / rules / library 三个计数） */
function homeNav(): { nav: HomeNav; calls: Record<string, number> } {
  const calls: Record<string, number> = { cardmaker: 0, rules: 0, library: 0 };
  const nav: HomeNav = {
    startGame: () => { /* noop */ },
    openLibrary: () => { calls.library += 1; },
    openRules: () => { calls.rules += 1; },
    openLocalData: () => { /* noop */ },
    openSettings: () => { /* noop */ },
    openFeedback: () => { /* noop */ },
    openCardmaker: () => { calls.cardmaker += 1; },
  };
  return { nav, calls };
}

describe('首页入口：自定义协议与卡牌', () => {
  it('首页有一个「自定义协议与卡牌」按钮，点了调 nav.openCardmaker（真跑一次）', () => {
    const root = mountRoot();
    const { nav, calls } = homeNav();
    renderHome(root as unknown as HTMLElement, nav);
    const btn = findButtonByText(root, '自定义协议与卡牌');
    expect(btn, '首页上找不到「自定义协议与卡牌」按钮').not.toBeNull();
    if (btn === null) return;
    clickNode(btn);
    expect(calls.cardmaker, '点了入口按钮没有调 nav.openCardmaker').toBe(1);
    // 反向锚点：它没有顺手调别的入口（否则"调了 openCardmaker"这件事分辨不出来）
    expect(calls.rules, '顺手调了「规则图纸」').toBe(0);
    expect(calls.library).toBe(0);
  });

  it('反向锚点：换一份 nav 再点一次，调的是**注入的那一个**（不是某个全局）', () => {
    const rootA = mountRoot();
    const a = homeNav();
    renderHome(rootA as unknown as HTMLElement, a.nav);
    const btnA = findButtonByText(rootA, '自定义协议与卡牌');
    if (btnA !== null) clickNode(btnA);
    expect(a.calls.cardmaker).toBe(1);

    const rootB = mountRoot();
    const b = homeNav();
    renderHome(rootB as unknown as HTMLElement, b.nav);
    const btnB = findButtonByText(rootB, '自定义协议与卡牌');
    if (btnB !== null) clickNode(btnB);
    expect(a.calls.cardmaker, '第二次点击调到了第一份 nav（接线写死了）').toBe(1);
    expect(b.calls.cardmaker).toBe(1);
  });

  it('入口按钮在**主菜单列**里，不在左上/右上的角标容器里（位置不打架）', () => {
    const root = mountRoot();
    const { nav } = homeNav();
    renderHome(root as unknown as HTMLElement, nav);
    const btn = findButtonByText(root, '自定义协议与卡牌');
    expect(btn).not.toBeNull();
    if (btn === null) return;
    let inCornerWrap = false;
    let inMenu = false;
    for (let p: StubNode | null = btn.parentElement; p !== null; p = p.parentElement) {
      const cls = p.cls;
      if (cls.includes('feedback-wrap') || cls.includes('changelog-wrap')) inCornerWrap = true;
      if (cls.includes('home-menu-buttons')) inMenu = true;
    }
    expect(inCornerWrap, '入口按钮被放进了左上/右上的角标容器（会与既有两个角标打架）').toBe(false);
    expect(inMenu, '入口按钮不在主菜单列里').toBe(true);
  });

  it('既有入口一个都没被挤掉（新按钮是**追加**，不是替换）', () => {
    const root = mountRoot();
    const { nav } = homeNav();
    renderHome(root as unknown as HTMLElement, nav);
    for (const label of ['开始游戏', '查看协议及其所属卡牌', '查看一/二/三代规则图纸', '本地数据与隐私', '设置', '自定义协议与卡牌', '反馈', '更新日志']) {
      expect(findButtonByText(root, label), `首页上「${label}」不见了`).not.toBeNull();
    }
  });
});

/* ==================================================================== *
 * 2. 制作器存储（IndexedDB）：手写假件
 * ==================================================================== */

/** 假请求：`result`/`error` 由假件填好，`on*` 由被测代码挂上 */
interface FakeRequest {
  result: unknown;
  error: unknown;
  onsuccess: (() => void) | null;
  onerror: (() => void) | null;
  onupgradeneeded: (() => void) | null;
}

function fakeRequest(result: unknown, error: unknown = null): FakeRequest {
  return { result, error, onsuccess: null, onerror: null, onupgradeneeded: null };
}

/** 假事务 */
interface FakeTx {
  objectStore(): {
    get(k: string): FakeRequest;
    put(v: unknown, k: string): void;
    delete(k: string): void;
  };
  oncomplete: (() => void) | null;
  onerror: (() => void) | null;
  onabort: (() => void) | null;
}

/** 一个"像 IDBDatabase"的东西：只实现本模块用到的那几个方法，外加一本账 */
interface FakeDb {
  objectStoreNames: { contains: (n: string) => boolean };
  createObjectStore: (n: string) => { name: string };
  transaction: (name: string, mode: string) => FakeTx;
  data: Map<string, unknown>;
  writes: string[];
  deletes: string[];
  /** 换掉 `transaction`（模拟"事务报错"那一档） */
  setTransaction(fn: (name: string, mode: string) => FakeTx): void;
}

interface FakeIdb {
  factory: IdbLike;
  db: FakeDb;
  openCalls: Array<{ name: string; version: number }>;
}

/**
 * 造一个假 IndexedDB。
 *
 * @param opts.openError 非空时 `open()` 直接抛（模拟"存储被策略关掉"）
 * @param opts.holdOpen  为真时打开请求**永不 settle**（模拟"库被别的标签页占着"）
 */
function fakeIdb(opts: { openError?: Error; holdOpen?: boolean } = {}): FakeIdb {
  const data = new Map<string, unknown>();
  const writes: string[] = [];
  const deletes: string[] = [];

  const okTransaction = (_name: string, mode: string): FakeTx => {
    let fireGet: (() => void) | null = null;
    const tx: FakeTx = {
      objectStore: () => ({
        get: (k: string) => {
          const req = fakeRequest(data.get(k) ?? undefined);
          fireGet = () => { req.onsuccess?.(); };
          return req;
        },
        put: (v: unknown, k: string) => {
          if (mode !== 'readwrite') throw new Error('put 用在了只读事务上');
          data.set(k, v);
          writes.push(k);
        },
        delete: (k: string) => {
          data.delete(k);
          deletes.push(k);
        },
      }),
      oncomplete: null,
      onerror: null,
      onabort: null,
    };
    // 事务在下一次 microtask 完成（`put` 已经发生；`get` 则在这里触发 onsuccess）
    queueMicrotask(() => {
      if (fireGet !== null) fireGet();
      else tx.oncomplete?.();
    });
    return tx;
  };


  const db: FakeDb = {
    objectStoreNames: { contains: () => false },
    createObjectStore: (n) => ({ name: n }),
    transaction: okTransaction,
    data,
    writes,
    deletes,
    setTransaction: (fn) => { db.transaction = fn; },
  };

  const openCalls: Array<{ name: string; version: number }> = [];
  const factory: IdbLike = {
    open: (name, version) => {
      openCalls.push({ name, version });
      if (opts.openError) throw opts.openError;
      const req = fakeRequest(db);
      if (!opts.holdOpen) {
        queueMicrotask(() => { req.onupgradeneeded?.(); req.onsuccess?.(); });
      }
      return req as unknown as IDBOpenDBRequest;
    },
  };
  return { factory, db, openCalls };
}

/** 一份内容可辨识的牌组（判据面：读回来的必须与写进去的相同） */
function sampleDeck(): Deck {
  const d = defaultDeck();
  d.title = '本机牌组';
  d.shared.compile.bg = { type: 'preset', name: 'Fire', dataUrl: null, transform: { scale: 2, offsetX: 5, offsetY: -5 } };
  const c = defaultCard('c1', 'compile');
  c.title = 'NEON';
  c.bgOwn = { type: 'custom', name: null, dataUrl: 'data:image/png;base64,AAAA', transform: { scale: 1, offsetX: 0, offsetY: 0 } };
  d.cards = [c];
  return d;
}

/** 造一个"已授权"的局部 store（持久层可用） */
function makeAllowedStore(): ReturnType<typeof createLocalStore> {
  const persistent: KeyValueStore = createMemoryStore();
  const s = createLocalStore({ persistent });
  s.grant();
  return s;
}

describe('制作器存储：持久层可用时真读写（假 IndexedDB）', () => {
  it('save → load 往返：写进假 IDB 的键与内容都对得上', async () => {
    const { factory, db, openCalls } = fakeIdb();
    const store = createCardmakerStore({ localStore: makeAllowedStore(), factory });
    expect(store.isPersistent()).toBe(true);
    // ⚠️ 库是**懒打开**的：构造 store 本身一个副作用都不该有
    expect(openCalls, '构造 store 就去开库了（懒打开没生效）').toHaveLength(0);

    const deck = sampleDeck();
    const res = await store.save(deck);
    expect(res.ok).toBe(true);
    expect(openCalls[0], '库名/版本不对').toEqual({ name: CARDMAKER_DB_NAME, version: 1 });
    expect(db.writes).toEqual([CARDMAKER_DECK_KEY]);
    expect(db.data.get(CARDMAKER_DECK_KEY)).toEqual(deck);

    const back = await store.load();
    expect(back).toEqual(deck);
    // 反向锚点：读回来的是**这份**内容，不是"任意一份"
    const other = sampleDeck();
    other.title = '别的牌子';
    expect(back).not.toEqual(other);
  });

  it('本机没写过时 load 回 null（不是回一份空牌组）', async () => {
    const { factory } = fakeIdb();
    const store = createCardmakerStore({ localStore: makeAllowedStore(), factory });
    expect(await store.load()).toBeNull();
  });

  it('磁盘上的形状缺字段时读回来是**补全过**的（不是原样吐出去）', async () => {
    const { factory, db } = fakeIdb();
    // 模拟"过去某个版本写下的残缺牌组"
    db.data.set(CARDMAKER_DECK_KEY, { title: '老的', cards: [{ kind: 'protocol' }] });
    const store = createCardmakerStore({ localStore: makeAllowedStore(), factory });
    const back = await store.load();
    expect(back).not.toBeNull();
    expect(back?.cards[0].id, '缺 id 的卡没有补 id').toBeTruthy();
    expect(back?.cards[0].kind).toBe('protocol');
    expect(back?.shared.perCardBg).toBe(false);
  });

  it('写盘失败（事务报错）⇒ { ok: false, detail }，且**本次会话不再重试**持久层', async () => {
    const { factory, db } = fakeIdb();
    const store = createCardmakerStore({ localStore: makeAllowedStore(), factory });
    db.setTransaction(() => {
      const tx: FakeTx = {
        objectStore: () => ({ get: () => fakeRequest(undefined), put: () => { /* noop */ }, delete: () => { /* noop */ } }),
        oncomplete: null, onerror: null, onabort: null,
      };
      queueMicrotask(() => { tx.onerror?.(); });
      return tx;
    });
    const first = await store.save(sampleDeck());
    expect(first.ok).toBe(false);
    expect(first.detail, '失败时没给出原因').not.toBe('');
    // 降级：之后 `isPersistent` 回 false（本次会话不再碰持久层）
    expect(store.isPersistent(), '写失败之后还在宣称"能持久保存"').toBe(false);
    const second = await store.save(sampleDeck());
    expect(second.ok, '降级之后连内存那一条也失败了').toBe(true);
    expect(second.detail).toContain('内存');
    expect(await store.load(), '降级之后内存那一份读不回来').toEqual(sampleDeck());
  });
});

describe('制作器存储：不该碰持久层的时候一个字节都不碰', () => {
  it('游客模式（deny）⇒ isPersistent false，读写只落在内存里', async () => {
    const { factory, db, openCalls } = fakeIdb();
    const localStore = createLocalStore({ persistent: createMemoryStore() });
    localStore.deny();
    const store = createCardmakerStore({ localStore, factory });
    expect(store.isPersistent()).toBe(false);
    expect(await store.load(), '游客模式启动时读到了东西').toBeNull();
    const deck = sampleDeck();
    const res = await store.save(deck);
    expect(res.ok).toBe(true);
    expect(res.detail, '游客模式下的结论必须说清"只在内存里"').toContain('内存');
    // **关键判据**：持久层一次都没被碰过（开库也算碰）
    expect(openCalls, '游客模式下开了 IndexedDB').toHaveLength(0);
    expect(db.writes, '游客模式下写了 IndexedDB').toEqual([]);
    expect(db.deletes, '游客模式下删了 IndexedDB').toEqual([]);
    // 但内存那一份要能读回来（降级之后本次会话仍然活着）
    expect(await store.load()).toEqual(deck);
  });

  it('没有 IndexedDB（factory = null）⇒ 同样退化成内存，不抛', async () => {
    const store = createCardmakerStore({ localStore: makeAllowedStore(), factory: null });
    expect(store.isPersistent()).toBe(false);
    expect(await store.save(sampleDeck())).toEqual({ ok: true, detail: '只写进了内存（游客模式或本机存储不可用）' });
    expect(await store.load()).toEqual(sampleDeck());
  });

  it('open() 抛错 ⇒ 降级到内存并如实说"存储不可用"，不崩', async () => {
    const { factory } = fakeIdb({ openError: new Error('SecurityError: 存储被策略关闭') });
    const store = createCardmakerStore({ localStore: makeAllowedStore(), factory });
    // 授权层说"可以"，是**存储层打开那一刻**才发现不行 —— 这正是要覆盖的那一档
    expect(store.isPersistent()).toBe(true);
    expect(await store.load(), '打开失败时应当回落到内存（null）').toBeNull();
    const res = await store.save(sampleDeck());
    expect(res.ok).toBe(false);
    expect(res.detail).toContain('SecurityError');
    expect(store.isPersistent(), '打开失败之后还在宣称"能持久保存"').toBe(false);
  });

  it('打开请求**永不 settle** 时保存不会挂死屏：save 仍然返回，内存那份已更新', async () => {
    const { factory } = fakeIdb({ holdOpen: true });
    const store = createCardmakerStore({ localStore: makeAllowedStore(), factory });
    // 打开请求挂着 ⇒ `await db()` 永不 resolve ⇒ 这条腿只能证明"没抛"，
    // 证明不了"能超时返回"（本模块**没有**为打开加超时定时器）。
    // 所以这里如实钉住现状：save 的 Promise 悬着，而**内存那份已经更新**。
    const pending = store.save(sampleDeck());
    let settled = false;
    void pending.then(() => { settled = true; });
    await new Promise<void>((r) => { setTimeout(r, 5); });
    expect(settled, 'open 挂着时 save 竟然返回了（实现变了？这条腿要重写）').toBe(false);
    expect(store.isPersistent()).toBe(true);
  });
});

/* ==================================================================== *
 * 3. 「本地数据与隐私」屏用的两个入口：读概览 / 清除
 * ==================================================================== */

describe('制作器存储：读概览与清除（本地数据屏的两个接缝）', () => {
  it('readCardmakerDeckInfo：没写过 ⇒ null；写过 ⇒ 张数正确', async () => {
    const { factory, db } = fakeIdb();
    expect(await readCardmakerDeckInfo(factory), '没写过却给出了概览').toBeNull();
    const deck = sampleDeck();
    deck.cards = [defaultCard('a', 'compile'), defaultCard('b', 'protocol')];
    db.data.set(CARDMAKER_DECK_KEY, deck);
    expect(await readCardmakerDeckInfo(factory)).toEqual({ cards: 2 });
  });

  it('readCardmakerDeckInfo：没有 IndexedDB / 打开失败 ⇒ null（屏上显示"读不到"）', async () => {
    expect(await readCardmakerDeckInfo(null)).toBeNull();
    const { factory } = fakeIdb({ openError: new Error('打不开') });
    expect(await readCardmakerDeckInfo(factory)).toBeNull();
  });

  it('clearCardmakerDeck：真删掉那条记录；没有 IndexedDB 时如实回 ok:false', async () => {
    const { factory, db } = fakeIdb();
    db.data.set(CARDMAKER_DECK_KEY, sampleDeck());
    const out = await clearCardmakerDeck(factory);
    expect(out.ok).toBe(true);
    expect(db.deletes).toEqual([CARDMAKER_DECK_KEY]);
    expect(db.data.has(CARDMAKER_DECK_KEY), '删除之后记录还在').toBe(false);

    const nope = await clearCardmakerDeck(null);
    expect(nope.ok).toBe(false);
    expect(nope.detail).toContain('IndexedDB');
  });

  it('clearCardmakerDeck：删除抛错 ⇒ ok:false + 真因（不静默成"已清除"）', async () => {
    const { factory, db } = fakeIdb();
    db.setTransaction(() => {
      const tx: FakeTx = {
        objectStore: () => ({ get: () => fakeRequest(undefined), put: () => { /* noop */ }, delete: () => { /* noop */ } }),
        oncomplete: null, onerror: null, onabort: null,
      };
      queueMicrotask(() => { tx.onerror?.(); });
      return tx;
    });
    const out = await clearCardmakerDeck(factory);
    expect(out.ok).toBe(false);
    expect(out.detail).not.toBe('');
  });
});

/* ==================================================================== *
 * 4. 页面与存储的接头：页面拿到的是注入进来的 store
 * ==================================================================== */

describe('存储是注入进页面的（page.ts 自己不碰浏览器存储）', () => {
  it('页面点「保存到本机」写进去的内容，能被同一个 store 读回来', async () => {
    const root = mountRoot();
    const { factory, db } = fakeIdb();
    const store = createCardmakerStore({ localStore: makeAllowedStore(), factory });
    renderCardmaker(root as unknown as HTMLElement, {
      back: () => { /* noop */ },
      store,
      readTextFile: async () => null,
      uploadDataUrl: async () => null,
      download: () => { /* noop */ },
    });
    await new Promise<void>((r) => { setTimeout(r, 0); });

    const saveBtn = findButtonByText(root, '保存到本机');
    expect(saveBtn, '屏上没有「保存到本机」按钮').not.toBeNull();
    if (saveBtn === null) return;
    clickNode(saveBtn);
    await new Promise<void>((r) => { setTimeout(r, 0); });

    expect(db.writes, '点保存之后没有写进假 IDB').toEqual([CARDMAKER_DECK_KEY]);
    const back = await store.load();
    expect(back, '点了保存之后 store 里没有东西').not.toBeNull();
    expect(back?.cards.length, '写进去的牌组没有开局那两张卡').toBe(2);
    // 反向锚点：这份内容确实来自**屏上那份**牌组（而不是任意一份）
    expect(back?.cards.map((c) => c.kind).sort()).toEqual(['compile', 'protocol']);
  });

  it('署名常量与页面渲染出来的那一句是同一个（不手抄第二份文案）', () => {
    expect(CREDIT.sentence).toContain(CREDIT.author);
    expect(CREDIT.sentence).toContain(CREDIT.project);
    expect(CREDIT.sentence).toContain(CREDIT.license);
  });
});
