/**
 * L1 存储的**浏览器实现**（G3）。放在 `src/ui/` 的原因：它是唯一允许碰 localStorage/IndexedDB
 * 的地方（`src/app/` 保持零浏览器 API，见 Task 9 的 `tests/app-purity.test.ts`）。
 *
 * 探测顺序（§3.5）：IndexedDB 优先，localStorage 兜底。
 * ⚠️ 本文件里的探测**必须真存取一次**：Safari 隐私模式下 localStorage 对象存在但 setItem 抛错
 * （`pickNamedStore` 正是"真跑 set/get/remove 探针"的那个纯函数）。
 *
 * 纯层与浏览器层的**唯一接口**就是 `src/app/storage.ts` 的 `KeyValueStore`（get/set/remove/keys）；
 * 本文件不导出任何用浏览器对象当参数的 API，因此 `src/app` 不需要认识 `Storage`/`IDBDatabase`。
 */
import { createMemoryStore, pickNamedStore, type KeyValueStore, type NamedStore } from '../app/storage';

function localStorageBackend(): NamedStore | null {
  try {
    const ls = globalThis.localStorage;
    if (!ls) return null;
    const kv: KeyValueStore = {
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
    return { name: 'localstorage', kv };
  } catch {
    return null;
  }
}

/**
 * 取本机可用的 L1 后端。**任何异常都不外抛** —— 存储不可用不是致命错误，
 * 只是"本次会话不能保存"（设计稿 §9 的"存储授权被拒 → 游客模式，全部功能可用但刷新即丢"）。
 *
 * ⚠️ IndexedDB 后端留到 Task 7：它只在"用户裁决要做静默写回文件句柄"时才需要
 * （`FileSystemFileHandle` **只能**存 IndexedDB）。本任务只保证 localStorage 与内存两条路，
 * `AsyncKeyValueStore` 接口已在 `src/app/storage.ts` 定型备用。
 */
export function openL1Store(): KeyValueStore | null {
  const candidates = [localStorageBackend()].filter((x): x is NamedStore => x !== null);
  if (candidates.length === 0) return null;
  try {
    return pickNamedStore(candidates).kv;
  } catch {
    return null;
  }
}

/** 显式的内存兜底（测试与无头浏览器自查用；与游客模式**同一份**实现） */
export const memoryFallback = createMemoryStore;
