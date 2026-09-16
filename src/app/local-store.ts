/**
 * L1 数据模型与**授权状态机**（G3；见 §3.5、§3.6）。
 *
 * 关键不变式（红线的机检形态）：
 *  1. `consent === 'denied'`（游客模式）⇒ 任何写入都不碰 persistent（走内存 KV）；
 *  2. **授权状态本身从不落盘** —— 它只活在闭包里，刷新即回 'unknown'，于是"下次进入重新问"；
 *     （设计稿 §3.6 的另一条路 `sessionStorage` 被否：它也是磁盘写入，违反红线 3。）
 *     ⚠️ `grant()` 里那次**写探针**（`probeWritable`，键 `L1_PROBE_KEY`，写完即删）是这条
 *     不变式的**唯一例外**，且它写的是**探针键**、不是授权状态：授权状态仍然只活在内存里。
 *     "探针键无残留"与"没有任何 `compile-consent` 之类的状态键"都有腿钉住。
 *  3. persistent 不可用（null）时**功能仍可用**，只是全部退化到内存；
 *  4. `grant()` 之后**真的写得进去**才算持久（写探针结论）—— 只读探测发现不了的
 *     Safari 隐私模式在这里被挡在"任何用户数据落盘之前"（见 `src/app/storage.ts` 头注）。
 *
 * 状态流转（`src/main.ts` 的启动逻辑据此接线）：
 * ```
 *  unknown ──ask()──> ask ──grant()──> allowed   （allowed 才允许落盘；grant 里跑一次写探针）
 *     │                 │
 *     └────deny()───────┴────────────> denied    （denied = 游客模式 = 零写入）
 *  reset() （"清除本机数据"后）→ 回到 unknown
 * ```
 * `ask` 存在的唯一理由：**弹窗已显示、等用户点**。`unknown` 与 `ask` 下都不得有任何落盘写入。
 */
import {
  L1_DECKS,
  L1_SETTINGS,
  clearAllLocalData,
  createMemoryStore,
  probeWritable,
  readJson,
  writeJson,
  type KeyValueStore,
} from './storage';

export type ConsentState = 'unknown' | 'ask' | 'allowed' | 'denied';

export interface LocalStore {
  consent(): ConsentState;
  /** 弹窗已显示，等用户点（`unknown → ask`；其它状态下是空操作） */
  ask(): void;
  grant(): void;
  deny(): void;
  /** 回 unknown（"清除本机数据"后调用；授权状态不落盘，故只改内存） */
  reset(): void;
  /** 当前**实际**使用的 KV：游客模式 = 内存 KV，用户模式 = persistent */
  kv(): KeyValueStore;
  /** 是否有真正的持久化后端（游客模式恒 false） */
  isPersistent(): boolean;
}

export function createLocalStore(opts: { persistent: KeyValueStore | null }): LocalStore {
  const memory = createMemoryStore();
  let consent: ConsentState = 'unknown';
  /**
   * 写探针的结论（`null` = 还没问过）。**只在 `grant()` 里求值一次**，
   * 且只在"用户已经点了允许"之后 —— 这是红线 3 的时机约束，见 `probeWritable` 的说明。
   */
  let persistentWritable: boolean | null = null;
  /**
   * 能用持久后端吗？三个条件缺一不可：
   *  1. 用户点了「允许」（`allowed`）；
   *  2. 注入的后端不是 `null`；
   *  3. **后端真的写得进去**（写探针通过）—— 只读探测发现不了的 Safari 隐私模式
   *     （对象在、`getItem` 能跑、`setItem` 抛）在这里被挡在"任何用户数据落盘之前"。
   */
  const usingPersistent = (): boolean =>
    consent === 'allowed' && opts.persistent !== null && persistentWritable === true;
  return {
    consent: () => consent,
    ask: () => { if (consent === 'unknown') consent = 'ask'; },
    grant: () => {
      consent = 'allowed';
      // ⚠️ **写探针落点**：这是全仓唯一一处"同意之后、用户数据之前"的写。
      // 只对**注入的 KeyValueStore** 跑（纯层不碰浏览器 API）；失败 ⇒ 本次会话退化为
      // 内存 KV（`isPersistent()` 回 false，功能全可用、只是刷新即丢），**不抛错**。
      if (opts.persistent !== null) persistentWritable = probeWritable(opts.persistent);
    },
    deny: () => { consent = 'denied'; },
    // 回 unknown 时把探针结论也清掉。
    //
    // ⚠️ **这一句单独不承重 —— 如实标注，不假装它有腿**（与下面 `readNickName` 的第 3 层
    // 防御同一口径）：`usingPersistent()` 另有 `consent === 'allowed'` 兜着，而 `reset()`
    // 同时把 consent 置回 'unknown' ⇒ **单独删掉** `persistentWritable = null` 这一句，
    // 本文件与浏览器侧两个测试文件**整份全绿**（本次修复轮 M7 变异实测），所以它**没有**
    // "单删一次就变红"的腿。
    //
    // 它承重的是**第二把锁**：与"consent 判定被弱化"这一类改动**组合**时才暴露真违规 ——
    // M6（`consent === 'allowed'` 弱化成 `consent !== 'denied'`）+ M7（删掉这一句）下，
    // `grant() → reset() → writeNickName()` 会把用户数据**真的写进 persistent**，而这时
    // consent 已经是 'unknown' ⇒ 红线 3 的"授权前零写入"被违反。钉住这个组合的是
    // `tests/app/local-store.test.ts` 的「reset 之后即使探针结论残留也不许回到 persistent」
    //（M6+M7 下变红；单 M7 下仍绿 —— 第一把锁还在）。
    //
    // 保留它的**真实**理由（不是"防止残留结论触发写入"这种夸大说法）：`grant()` 无论如何
    // 都会重新探一次（里面无条件调 `probeWritable`），所以清空的真正价值是让"结论"与
    // "consent"两个变量在 reset 之后**一起**复位，不留"半复位"的中间态。
    reset: () => { consent = 'unknown'; persistentWritable = null; },
    kv: () => (usingPersistent() ? (opts.persistent as KeyValueStore) : memory),
    isPersistent: usingPersistent,
  };
}


export interface DeckRecord {
  id: string;
  name: string;
  /** 卡组绑定的种子（同一卡组可复用于多局；重放时仍需整份 MatchFile） */
  seed: string;
  defIds: string[];
  updatedAt: string;
}

/* ---------------- L1 数据模型 ---------------- */

export interface L1Settings {
  nick: string;
}

/**
 * 读昵称。**两条防线，各管一段**（别把它们的职责说混）：
 *  1. **承重的那条是 `readJson` 的 null 归一**（`JSON.parse('null')` 是合法解析）——
 *     `null.nick` 会抛 `TypeError`，那是本轮要修的崩溃；去掉归一 ⇒ 本函数的腿**立刻变红**
 *     （C1 变异实测）。
 *  2. `typeof nick === 'string'` 是**形状守卫**：`{nick: 42}` / 数组 / 数字 / 字符串
 *     这些"合法 JSON 但不是设置对象"的值一律回空串（去掉它 ⇒ 变红，C3 变异实测）。
 *  3. `typeof s !== 'object' || s === null` 是**防御性**的第三层：在当前实现下它**不承重**
 *     （C2 变异实测：删掉它 61 条腿仍全绿 —— 因为 `readJson` 已把 `null` 归一，
 *     而 `42.nick` / `'x'.nick` 在 JS 里只是 `undefined`、不抛）。**保留**它的理由是
 *     `readJson` 的契约一旦被放宽（或这里换成别的读取函数），它就是最后一道拦住
 *     `null` 解引用的墙；它**没有**对应的变异腿，本文件如实说明，不假装它有。
 */
export function readNickName(store: LocalStore): string {
  const s = readJson<unknown>(store.kv(), L1_SETTINGS, {});
  if (typeof s !== 'object' || s === null) return ''; // 防御层（不承重，见上面第 3 条）
  const nick = (s as Partial<L1Settings>).nick;
  return typeof nick === 'string' ? nick : '';        // 承重的形状守卫（C3）
}

/**
 * 写昵称。读旧值走的是 `readNickName` 的**同一套守卫**（写成裸的 `readJson(...)` 会在
 * "存储里是 `42`/`[1,2]`"时把 `{...42, nick}`、`{...['a'], nick}` 这种垃圾对象写回去
 * —— 不是崩溃，但是脏数据）。
 *
 * ⚠️ **已知的窄口径**（实测出来的，明写在这里而不是假装没有）：本函数把"非对象/数组"
 * 的旧值一律当空对象处理 ⇒ 读取侧回空串、写回后是一个**新对象**（而不是原样保留那个数组）。
 * 这条只会在"存储被外部手改/污染"时被走到，且两个方向都不丢用户数据（旧值本来就不是设置）。
 */
export function writeNickName(store: LocalStore, nick: string): boolean {
  const raw = readJson<unknown>(store.kv(), L1_SETTINGS, {});
  const prev: Record<string, unknown> =
    typeof raw === 'object' && raw !== null && !Array.isArray(raw)
      ? { ...(raw as Record<string, unknown>) }
      : {};
  return writeJson(store.kv(), L1_SETTINGS, { ...prev, nick }).ok;
}

function isDeckRecord(v: unknown): v is DeckRecord {
  if (typeof v !== 'object' || v === null) return false;
  const d = v as Record<string, unknown>;
  return typeof d.id === 'string'
    && typeof d.name === 'string'
    && typeof d.seed === 'string'
    && Array.isArray(d.defIds) && d.defIds.every((x) => typeof x === 'string')
    && typeof d.updatedAt === 'string';
}

export function readDecks(store: LocalStore): DeckRecord[] {
  const raw = readJson<unknown>(store.kv(), L1_DECKS, []);
  if (!Array.isArray(raw)) return [];
  return raw.filter(isDeckRecord);
}

export function writeDecks(store: LocalStore, decks: readonly DeckRecord[]): boolean {
  return writeJson(store.kv(), L1_DECKS, decks.filter(isDeckRecord)).ok;
}

/**
 * 清掉本机上的全部 L1 数据（"清除本机数据"按钮；Task 7 的 UI 调它）。
 * 只清 L1 自己的键（别的键不动），返回清掉的个数；游客模式下由调用方传内存 KV，
 * 因此**不会**碰 persistent（红线 3 的零写入对"清除"同样成立）。
 */
export { clearAllLocalData };
