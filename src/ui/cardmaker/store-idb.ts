/**
 * 制作器牌组的**本机存储**：IndexedDB。
 *
 * ## 为什么是 IndexedDB 而不是 localStorage（用户要求"选一个并说明理由"）
 *
 * 牌组 JSON 要把**自定背景以 base64 内嵌**（这是用户 2026-10-01 拍板的格式），一张 2000px
 * 的 JPEG 照片 base64 之后是 0.5–2MB。localStorage 的配额在主流浏览器里是**每源约 5MB**
 * 且是**同步写**（写一个 2MB 的字符串会卡一帧），两三张卡就写不进去了；IndexedDB 的配额
 * 是"磁盘可用空间的一个比例"（通常几百 MB 起），而且是异步的。参考项目
 * COMPILER · Card Builder（作者 Albert Blanco，MIT 许可，https://github.com/albrtbc/compiler）
 * 的 `src/storage/idb.js` 头注里给的是同一条理由（"localStorage caps at ~5MB, which a few
 * cards with custom images blow past"），这里沿用它的判断。
 *
 * ## 与授权门控的关系（本仓的红线，必须与 `src/app/local-store.ts` 一致）
 *
 * **只有"用户点了允许，且后端真的写得进去"时才碰持久层。** 否则整个存储退化成内存 ——
 * 于是游客模式（授权弹窗里选"不允许"）下刷新即丢，而屏幕上会如实这么说
 * （`page.ts` 的 `nav.store.isPersistent() === false` 那一档）。
 *
 * `isPersistent()` 的判定**走的是 `LocalStore.isPersistent()`**，不自己探测 ——
 * 授权状态机只有一份真相。
 *
 * ★ 2026-10-02（i18n 逐屏抽取）：本文件里那几句玩家可见的失败/降级说明搬进 `src/i18n/`
 * （键 `cardmaker.store.*`），中文值**逐字等于改动前**的字面量。
 * ⚠️ 存进 `detail` 的**系统原样消息**（`e.message` / `tx.error.message`）照旧不翻译。
 */
import { t } from '../../i18n';
import type { LocalStore } from '../../app/local-store';
import { hydrateDeck } from './model';
import type { Deck } from './types';
import type { CardmakerSaveResult, CardmakerStore } from './page';

/** IndexedDB 的库名与键。改名等于让老用户的牌组读不回来，所以这两个字面量只在这里出现。 */
export const CARDMAKER_DB_NAME = 'compile-cardmaker';
export const CARDMAKER_DB_STORE = 'decks';
export const CARDMAKER_DECK_KEY = 'deck';

/**
 * 只用到 IndexedDB 的这几样东西。
 *
 * 声明成接口（而不是直接写 `IDBFactory`）是为了让**单测能喂一个假件** ——
 * 本仓没有 jsdom，也不装 `fake-indexeddb`（零运行时依赖，也不加开发依赖）。
 * 假件只要实现 `open()`，返回一个自己造的"像 IDBOpenDBRequest 的对象"即可；
 * 测试那一侧用一次 `as unknown as IdbLike` 把它交进来。
 */
export interface IdbLike {
  open(name: string, version: number): IDBOpenDBRequest;
}

/**
 * 打开库并拿到连接。每一步都用 `onsuccess`/`onerror` 转成 Promise。
 *
 * `onupgradeneeded` 里建 store：老库没有它的时候（第一次升级）也能补上。
 */
function openCardmakerDB(factory: IdbLike): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let req: IDBOpenDBRequest;
    try {
      req = factory.open(CARDMAKER_DB_NAME, 1);
    } catch (e) {
      reject(e instanceof Error ? e : new Error(String(e)));
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      // 只建一次：反复升级时不能重复建同名 store（会抛）
      if (!db.objectStoreNames.contains(CARDMAKER_DB_STORE)) db.createObjectStore(CARDMAKER_DB_STORE);
    };
    req.onsuccess = () => { resolve(req.result); };
    req.onerror = () => { reject(req.error ?? new Error(t('cardmaker.store.open-failed'))); };
  });
}

/** 单键读 / 单键写 / 单键删（各自开一个新事务） */
function idbGet(db: IDBDatabase, key: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CARDMAKER_DB_STORE, 'readonly');
    const r = tx.objectStore(CARDMAKER_DB_STORE).get(key);
    r.onsuccess = () => { resolve(r.result); };
    r.onerror = () => { reject(r.error ?? new Error(t('cardmaker.store.read-failed'))); };
  });
}

function idbPut(db: IDBDatabase, key: string, value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CARDMAKER_DB_STORE, 'readwrite');
    tx.objectStore(CARDMAKER_DB_STORE).put(value, key);
    tx.oncomplete = () => { resolve(); };
    tx.onerror = () => { reject(tx.error ?? new Error(t('cardmaker.store.write-failed'))); };
    tx.onabort = () => { reject(tx.error ?? new Error(t('cardmaker.store.write-aborted'))); };
  });
}

function idbDelete(db: IDBDatabase, key: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CARDMAKER_DB_STORE, 'readwrite');
    tx.objectStore(CARDMAKER_DB_STORE).delete(key);
    tx.oncomplete = () => { resolve(); };
    tx.onerror = () => { reject(tx.error ?? new Error(t('cardmaker.store.delete-failed'))); };
  });
}

/** 内存兜底（游客模式 / IndexedDB 不可用）：与 `src/app/storage.ts` 的 `createMemoryStore` 同义 */
function createMemoryCardmakerStore(): { deck: Deck | null } {
  return { deck: null };
}

/* ── 对外入口 ─────────────────────────────────────────────────────────── */

export interface CardmakerStoreDeps {
  /** 授权状态机（本仓唯一那份）：它说"用不用持久层" */
  localStore: LocalStore;
  /**
   * IndexedDB 工厂。缺省取全局 `indexedDB`；**没有它**（老浏览器 / 单测）时整个存储退化成内存。
   *
   * ⚠️ 显式声明成参数（而不是在模块里读全局）是为了让它可测，也让"这台设备有没有 IndexedDB"
   * 这件事在调用点看得见。
   */
  factory?: IdbLike | null;
}

/**
 * 造一个制作器存储。
 *
 * 三种后端，优先级从高到低：
 *  1. **持久**：`localStore.isPersistent()` 为真 **且** 有 IndexedDB ⇒ 真写盘；
 *  2. **内存**：其余情况 ⇒ 只活在本次会话（`isPersistent()` 回 false，屏上如实提示）。
 *
 * ⚠️ **库是懒打开的**（第一次 `load()` 才开）：不打开就不会有任何磁盘副作用，
 * 于是"授权之前零写入"这条红线在**模块被 import 的那一刻**也不会被碰。
 */
export function createCardmakerStore(deps: CardmakerStoreDeps): CardmakerStore {
  const factory = deps.factory !== undefined
    ? deps.factory
    : ((globalThis as { indexedDB?: IdbLike }).indexedDB ?? null);
  const memory = createMemoryCardmakerStore();
  let dbPromise: Promise<IDBDatabase> | null = null;
  /** 持久层真出过问题之后**本次会话不再重试**（否则每次保存都要等一次失败） */
  let persistentBroken = false;

  /** 这次到底用不用持久层 */
  const persistent = (): boolean => deps.localStore.isPersistent() && factory !== null && !persistentBroken;

  function db(): Promise<IDBDatabase> {
    if (dbPromise === null) dbPromise = openCardmakerDB(factory as IdbLike);
    return dbPromise;
  }

  return {
    isPersistent: persistent,
    async load(): Promise<Deck | null> {
      if (!persistent()) return memory.deck;
      try {
        const raw = await idbGet(await db(), CARDMAKER_DECK_KEY);
        if (raw === null || raw === undefined) return null;
        // 读回来的东西一律过一遍 hydration：磁盘上的形状是**过去**写下的，可能缺字段
        const deck = hydrateDeck(raw as Partial<Deck>);
        memory.deck = deck;
        return deck;
      } catch {
        // 读不出来不等于没有数据，但本屏只能从"空牌组"开始；把这次失败记下来，
        // 下次保存会**先试持久层**（读失败往往只是那一次的问题）
        return memory.deck;
      }
    },
    async save(deck: Deck): Promise<CardmakerSaveResult> {
      memory.deck = deck; // 内存那一份永远更新（这样降级之后仍然活得下去）
      if (!persistent()) {
        return { ok: true, detail: t('cardmaker.store.memory-only') };
      }
      try {
        await idbPut(await db(), CARDMAKER_DECK_KEY, deck);
        return { ok: true, detail: '' };
      } catch (e) {
        persistentBroken = true; // 本次会话不再重试：反复失败只会让每次保存都卡一下
        return { ok: false, detail: `${e instanceof Error ? e.message : String(e)}` };
      }
    },
  };
}

/**
 * 清掉本机保存的制作器牌组（「本地数据与隐私」屏的那个按钮调它）。
 *
 * 返回**是否真的清了一次**（没写过、或没有持久层 ⇒ false）。打不开库 / 删不掉时返回
 * `{ ok: false, detail }`，调用方如实提示 —— 绝不静默成"已清除"。
 */
export async function clearCardmakerDeck(factory: IdbLike | null): Promise<{ ok: boolean; detail: string }> {
  if (factory === null) return { ok: false, detail: t('cardmaker.store.no-idb') };
  try {
    const db = await openCardmakerDB(factory);
    await idbDelete(db, CARDMAKER_DECK_KEY);
    return { ok: true, detail: '' };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * 本机保存的制作器牌组**概览**（给「本地数据与隐私」屏看：有几张卡、有没有东西）。
 *
 * ## 三态**不许折叠**（2026-10-01 线上验收 D1 的修法）
 *
 * 只读、绝不写。返回值必须能被调用方分辨成三件**完全不同**的事：
 *
 * | 情况 | 返回 | 屏上该说的话 |
 * |---|---|---|
 * | 库开得了、**只是没有记录**（全新访客 / 刚点完清除） | `{ cards: 0 }` | "本机还没有保存过牌组" |
 * | 库开得了、记录在、形状正常 | `{ cards: n }` | "本机保存了 n 张卡" |
 * | **真读不出来**（没有 IndexedDB 工厂 / `open()` 抛错 / 记录存在但不是对象） | `null` | "读不到本机的数据（…）" |
 *
 * ⚠️ **第一版把前两种都回成 `null`**（"没写过"与"读失败"折叠），于是线上全新访客、
 * 以及**刚点完清除**的用户看到的都是"读不到本机的数据（这台设备可能没有可用的 IndexedDB，
 * 或库被别的程序占着）" —— 用户会以为刚点的清除把东西弄坏了。**"空的"不是"坏了"。**
 *
 * ⚠️ 最后那一档（记录存在、但不是一个对象）**故意算失败、不算空**：它是"磁盘上有个
 * 坏记录"，说成"还没有保存过"同样是不实陈述（与 `src/app/storage.ts` 里
 * `readJson` 对坏 JSON 的处理口径一致：坏数据与不存在的区别要保住）。
 */
export async function readCardmakerDeckInfo(factory: IdbLike | null): Promise<{ cards: number } | null> {
  if (factory === null) return null; // 这台设备没有 IndexedDB：真读不出来
  try {
    const raw = await idbGet(await openCardmakerDB(factory), CARDMAKER_DECK_KEY);
    // 没写过（IndexedDB 的 get 对不存在的键回 undefined，有的实现回 null）⇒ **空态**
    if (raw === null || raw === undefined) return { cards: 0 };
    // 记录在、但形状不对 ⇒ 坏数据，按"读不到"如实报，不伪装成"空"
    if (typeof raw !== 'object') return null;
    const deck = hydrateDeck(raw as Partial<Deck>);
    return { cards: deck.cards.length };
  } catch {
    return null; // open 抛错 / 事务抛错：真读不出来
  }
}
