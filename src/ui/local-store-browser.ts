/**
 * L1 存储的**浏览器实现**（G3）。放在 `src/ui/` 的原因：它是唯一允许碰 localStorage/IndexedDB
 * 的地方（`src/app/` 保持零浏览器 API）。
 *
 * ⚠️ **时态如实**：全量守卫 `tests/app-purity.test.ts` 由 **Task 9 提供、当前尚不存在**
 * （全仓只有扫 `src/core/` 的 `tests/core-purity.test.ts`）。在那之前，这条分层只有零散的
 * 部分守卫：`tests/ui/local-store-browser.test.ts` 里"`storage.ts` 没有 `localStorage`
 * **调用**"那一条文本腿 —— 它**只覆盖 `storage.ts` 一个文件**，不含 `local-store.ts`，
 * 也不含 `document`/`window`/`fetch`/`indexedDB`/`navigator`。Task 6 的两个新文件用的是
 * 同一处前向引用。
 *
 * ## 探测顺序：**本任务只有 localStorage 一条路**
 * 计划 §3.5 的终态是"IndexedDB 优先，localStorage 兜底"，但**真正的 IndexedDB 后端属于
 * Task 7**（它只在"用户裁决要做静默写回文件句柄"时才需要 —— `FileSystemFileHandle`
 * **只能**存 IndexedDB）。本文件因此**没有** IndexedDB 候选，只有 localStorage；
 * `AsyncKeyValueStore` 接口已在 `src/app/storage.ts` 定型备用。
 * （旧注释写成"IndexedDB 优先，localStorage 兜底"，与实现不符 —— 已按实际改掉。）
 *
 * ## 红线 3：**同意之前零写入**，所以这里的探测是**只读**的
 * 本文件在启动路径上被调用（`main.ts` 的模块级 `openL1Store()`），而那发生在**授权弹窗
 * 渲染之前**。于是"真写一次探针"这个看似更可靠的做法在这里是被**禁止**的：
 * 它会让每个玩家每次打开页面都先写一次磁盘 —— 包括随后点「不允许」的人 —— 而
 * `src/app/privacy.ts` 已经把这句逐字承诺给了玩家（「在此之前，磁盘上不会有任何写入」）。
 *
 * 只读探测发现不了"Safari 隐私模式：对象在、`getItem` 能跑、`setItem` 抛"这类后端；
 * 兜住它的是 `src/app/storage.ts` 的 `probeWritable`，调用点是
 * `createLocalStore.grant()`（**用户点允许那一刻**，任何用户数据落盘之前）。
 * ⇒ 探测能力**一点没丢**，只是搬到了合法时机。
 *
 * ## 注入缝
 * `openL1Store(env?)` 的 `env.localStorage` 是**参数表上的缝**（不是往 `globalThis` 上打桩）：
 * 行为腿必须能真跑，而"测试里替换 `globalThis`"会让产出代码**读的是另一个东西**却照样绿
 * —— 本会话已经栽过一次同款（`src/ui/pwa-update.ts` 把 `navigator.serviceWorker` 误写成
 * `globalThis.serviceWorker`，真实浏览器里 PWA 从不注册，而四道门禁全绿）。因此缝开在形参上：
 * **默认参数**才去读 `globalThis.localStorage`，`openL1Store()` 的零参调用形态保持不变。
 *
 * 纯层与浏览器层的**唯一接口**就是 `src/app/storage.ts` 的 `KeyValueStore`（get/set/remove/keys）；
 * 本文件不导出任何用浏览器对象当参数的 API，因此 `src/app` 不需要认识 `Storage`/`IDBDatabase`。
 */
import { createMemoryStore, selectReadableStore, type KeyValueStore } from '../app/storage';

/**
 * 真实 `localStorage` 的**最小结构面**（只用 get/set/remove/length/key）。
 *
 * ⚠️ 故意**不**用 TS 内置的 `Storage` 类型：本仓的 `lib` 里 DOM 类型是否可用、以及
 * 测试里的假件要不要伪造一整套 `Storage`（含索引签名）都不该由产出代码决定 ——
 * 结构面越小，假件越容易与真件同形（`tests/ui/local-store-browser.test.ts` 的假件就是按它写的）。
 */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  readonly length: number;
  key(index: number): string | null;
}

/** 注入缝的参数表：只放"环境"（`openL1Store` 只读它，不写它）。 */
export interface L1StoreEnv {
  /**
   * 读取 `localStorage` 的**动作**（不是值本身）。
   *
   * 为什么是函数而不是 `StorageLike | null`：`globalThis.localStorage` 的访问**本身**就会抛
   * （沙箱 iframe / `file://` / `SecurityError`），而那正是最需要被兜住的一种环境。
   * 传函数则"访问抛错"与"值为 null"都能在**缝上**表达，不必再往 `globalThis` 上打桩。
   * 缺省 = `() => globalThis.localStorage`。
   */
  localStorage?: () => StorageLike | null;
}

/** 默认的环境：真浏览器里读 `globalThis.localStorage`（读**动作**延迟到调用时求值）。 */
function defaultEnv(): Required<L1StoreEnv> {
  return { localStorage: () => (globalThis as { localStorage?: StorageLike }).localStorage ?? null };
}

/**
 * 把真实 `Storage` 包成 `KeyValueStore`。`ls` 为 `null`（或访问抛错）时返回 `null`。
 *
 * ⚠️ 这里**只包装、不探测**：探测归 `selectReadableStore`（纯层，只读）。
 */
function localStorageBackend(env: Required<L1StoreEnv>): KeyValueStore | null {
  try {
    const ls = env.localStorage();
    if (!ls) return null;
    return {
      get: (k) => ls.getItem(k),
      set: (k, v) => { ls.setItem(k, v); },
      remove: (k) => { ls.removeItem(k); },
      keys: () => {
        const out: string[] = [];
        for (let i = 0; i < ls.length; i += 1) {
          const k = ls.key(i);
          if (k !== null) out.push(k);
        }
        return out;
      },
    };
  } catch {
    return null; // 读 globalThis.localStorage 本身就抛（沙箱 iframe / SecurityError）
  }
}

/**
 * 取本机可用的 L1 后端。**任何异常都不外抛** —— 存储不可用不是致命错误，
 * 只是"本次会话不能保存"（设计稿 §9 的"存储授权被拒 → 游客模式，全部功能可用但刷新即丢"）。
 *
 * ⚠️ **只读**：内部只调 `get`/`keys`（`selectReadableStore`），**不 `set`、不 `remove`**
 * —— 本函数跑在授权弹窗之前，见文件头注的"红线 3"。写能力由 `grant()` 之后的
 * `probeWritable` 判。
 *
 * @param env 可选的注入缝（测试用假件）；**零参调用形态不变**（Task 4 / Task 7 就是这么调的）。
 */
export function openL1Store(env?: L1StoreEnv): KeyValueStore | null {
  const resolved = { ...defaultEnv(), ...env };
  try {
    const backend = localStorageBackend(resolved);
    return backend === null ? null : selectReadableStore(backend);
  } catch {
    return null;
  }
}

/** 显式的内存兜底（测试与无头浏览器自查用；与游客模式**同一份**实现） */
export const memoryFallback = createMemoryStore;
