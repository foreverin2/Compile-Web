/**
 * L1 轻量配置的**存储抽象**（G3；见 docs/2026-09-13-联机与多端-设计稿.md §3.5、§3.6）。
 *
 * 三层分工，别混：
 *  - 本文件：**接口 + 纯逻辑**（无浏览器 API）。因此可在 node 下直接单测（本仓无 jsdom）。
 *  - `src/ui/local-store-browser.ts`：浏览器实现（localStorage 主 + indexedDB 从 + 能力探测）。
 *  - `src/app/local-store.ts`：授权状态机与数据模型（也是纯逻辑）。
 *
 * 红线 3（§0.4）：游客模式下**零写入磁盘**。它的机检形态在 `src/app/local-store.ts`：
 * `createLocalStore({ persistent })` + `deny()` ⇒ `persistent.set/remove` 调用次数恒 0。
 *
 * ## 能力边界（每个方法"值不存在 / JSON 坏掉 / 后端抛错"三态下的行为，见本文件的注释与
 * ## tests/app/local-store.test.ts 的「KV 接口的能力边界」一节）
 *
 * | 方法 | 值不存在 | 后端抛错（配额/隐私模式） |
 * |---|---|---|
 * | `get`   | 返回 `null`（不是空串、不抛） | **原样向外抛**（不吞；`readJson` 也不吞 `get` 的异常） |
 * | `set`   | — | 原样向外抛；`writeJson` 捕获它并翻译成 `{ ok:false, reason:'write-failed' }` |
 * | `remove`| 无副作用（不抛） | **原样向外抛**（`clearAllLocalData` 不吞） |
 * | `keys`  | 返回 `[]` | **原样向外抛** |
 * | JSON 坏掉 | — | `readJson` 返回 `fallback`（唯一一处**故意的**吞：坏数据不该让游戏打不开） |
 */

export interface KeyValueStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
  keys(): string[];
}

/** 异步 KV：IndexedDB 的形态（仅供 L2 的文件句柄等浏览器对象使用） */
export interface AsyncKeyValueStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
  keys(): Promise<string[]>;
}

/** 带名字的存储后端（"indexeddb 优先，localStorage 兜底"的探测单位） */
export interface NamedStore {
  name: string;
  kv: KeyValueStore;
}

/**
 * 键名前缀 —— **全仓唯一定义处**（tests/app/local-store.test.ts 里有一条腿钉住
 * "本文件里这个前缀字面量恰好出现 1 次"）。两个键都由它拼出来，别处不许再写死。
 */
export const L1_KEY_PREFIX = 'compile-';

/**
 * L1 的键（**键名一旦发布就不能改** —— 改了等于让所有老用户丢配置）。
 *
 * 迁移策略（换前缀 / 升版本时照这个做）：
 *  1. **同前缀内加字段/改形状** → `L1_SCHEMA_VERSION` +1，并在读取处写一次"旧→新"的
 *     显式迁移（先 `readJson` 出旧形状，再转换成新形状），**不换前缀**。旧值就地升级：
 *     迁移成功后回写新形状；迁移失败按坏数据处理（返回默认值，不阻塞游戏）。
 *  2. **换前缀**（等于"隔离命名空间"）→ 只需改 `L1_KEY_PREFIX` 一处；代价是所有老用户的
 *     L1 配置"读不到"（表现为回到默认值），因此**必须**同时给一段"从旧前缀搬迁"的代码，
 *     否则等于静默丢用户配置 —— 这是本前缀被收成常量、且有单处出现腿的原因。
 *  3. 前缀与版本都**不进键名**：键名里再嵌版本号会让"读旧键"变成一串特判，得不偿失。
 */
export const L1_SETTINGS = `${L1_KEY_PREFIX}settings`;
export const L1_DECKS = `${L1_KEY_PREFIX}decks`;

/** L1 值的 schema 版本（键名不含版本；升版本走上面注释的迁移策略 1） */
export const L1_SCHEMA_VERSION = 1;

/** 单值上限（64 KiB）：L1 是"轻量、随时可丢"的偏好层，不是档案层（§3.5） */
export const L1_VALUE_MAX_BYTES = 65536;

/** 内存 KV：游客模式与测试共用同一份实现（**一份实现，不是两份拷贝**） */
export function createMemoryStore(): KeyValueStore {
  const m = new Map<string, string>();
  return {
    get: (k) => (m.has(k) ? (m.get(k) as string) : null),
    set: (k, v) => { m.set(k, v); },
    remove: (k) => { m.delete(k); },
    keys: () => [...m.keys()],
  };
}

/**
 * 按优先级探测可用后端：`get`/`set`/`remove` 各真跑一次探针（不能只看 `'indexedDB' in globalThis`
 * —— Safari 隐私模式下对象存在但一用就抛）。全部不可用 → **抛错**（调用方负责降级成 null）。
 */
export function pickNamedStore(stores: readonly NamedStore[]): NamedStore {
  const probeKey = '__l1_probe__';
  for (const s of stores) {
    try {
      s.kv.set(probeKey, '1');
      s.kv.get(probeKey);
      s.kv.remove(probeKey);
      return s;
    } catch {
      // 试下一个（这里的吞是**有意的**：探测的语义就是"试一下，不行换下一个"）
    }
  }
  throw new Error('没有可用的本地存储后端');
}

function utf8Bytes(v: string): number {
  // TextEncoder 在 node(>=11) 与全部目标浏览器都有；不需要注入。
  // 注意别用 v.length：中文一个字 3 字节，按 UTF-16 码元判会**低估**（放宽上限）。
  return new TextEncoder().encode(v).length;
}

/**
 * 读 JSON。唯一**故意吞错**的地方是 JSON 解析失败（坏数据→fallback）；
 * `kv.get` 自身的异常**不吞**（存储不可用是另一类问题，调用方要能看见）。
 */
export function readJson<T>(kv: KeyValueStore, key: string, fallback: T): T {
  const raw = kv.get(key);
  if (raw === null) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback; // 坏数据不该让游戏打不开
  }
}

export type WriteResult = { ok: true } | { ok: false; reason: 'too-large' | 'write-failed'; detail: string };

/**
 * 写 JSON。**不抛错**（唯一出口是返回值）：
 *  - 序列化失败 / 超过 `L1_VALUE_MAX_BYTES` → `too-large` 或 `write-failed`，**且不碰 KV**；
 *  - `set` 抛错（隐私模式 / 配额满）→ `write-failed`，detail 里保留真实原因。
 * 调用方（Task 7 的 UI）据此显示"本机保存失败，本次会话仍可正常游玩"。
 */
export function writeJson(kv: KeyValueStore, key: string, value: unknown): WriteResult {
  let text: string;
  try {
    text = JSON.stringify(value);
  } catch (e) {
    return { ok: false, reason: 'write-failed', detail: `无法序列化：${String(e)}` };
  }
  if (typeof text !== 'string') {
    return { ok: false, reason: 'write-failed', detail: '无法序列化：JSON.stringify 返回了非字符串' };
  }
  const bytes = utf8Bytes(text);
  if (bytes > L1_VALUE_MAX_BYTES) {
    return { ok: false, reason: 'too-large', detail: `${bytes} 字节 > 上限 ${L1_VALUE_MAX_BYTES} 字节` };
  }
  try {
    kv.set(key, text);
  } catch (e) {
    return { ok: false, reason: 'write-failed', detail: `写入本机存储失败（隐私模式或配额已满）：${String(e)}` };
  }
  return { ok: true };
}

/** 清掉 L1 自己的全部键（**不动别人的键**）；返回清掉的个数。`remove` 的异常不吞。 */
export function clearAllLocalData(kv: KeyValueStore): number {
  const mine = [L1_SETTINGS, L1_DECKS];
  let n = 0;
  for (const k of mine) {
    if (kv.get(k) !== null) {
      kv.remove(k);
      n += 1;
    }
  }
  return n;
}
