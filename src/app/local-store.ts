/**
 * L1 数据模型与**授权状态机**（G3；见 §3.5、§3.6）。
 *
 * 关键不变式（红线的机检形态）：
 *  1. `consent === 'denied'`（游客模式）⇒ 任何写入都不碰 persistent（走内存 KV）；
 *  2. **授权状态本身从不落盘** —— 它只活在闭包里，刷新即回 'unknown'，于是"下次进入重新问"；
 *     （设计稿 §3.6 的另一条路 `sessionStorage` 被否：它也是磁盘写入，违反红线 3。）
 *  3. persistent 不可用（null）时**功能仍可用**，只是全部退化到内存。
 *
 * 状态流转（`src/main.ts` 的启动逻辑据此接线）：
 * ```
 *  unknown ──ask()──> ask ──grant()──> allowed   （allowed 才允许落盘）
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
  const usingPersistent = (): boolean => consent === 'allowed' && opts.persistent !== null;
  return {
    consent: () => consent,
    ask: () => { if (consent === 'unknown') consent = 'ask'; },
    grant: () => { consent = 'allowed'; },
    deny: () => { consent = 'denied'; },
    reset: () => { consent = 'unknown'; },
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

export function readNickName(store: LocalStore): string {
  const s = readJson<Partial<L1Settings>>(store.kv(), L1_SETTINGS, {});
  return typeof s.nick === 'string' ? s.nick : '';
}

export function writeNickName(store: LocalStore, nick: string): boolean {
  const prev = readJson<Partial<L1Settings>>(store.kv(), L1_SETTINGS, {});
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
