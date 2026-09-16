/**
 * L1 轻量配置的**存储抽象**（G3；见 docs/2026-09-13-联机与多端-设计稿.md §3.5、§3.6）。
 *
 * 三层分工，别混：
 *  - 本文件：**接口 + 纯逻辑**（无浏览器 API）。因此可在 node 下直接单测（本仓无 jsdom）。
 *  - `src/ui/local-store-browser.ts`：浏览器实现（localStorage 主 + indexedDB 从 + 能力探测）。
 *  - `src/app/local-store.ts`：授权状态机与数据模型（也是纯逻辑）。
 *
 * 红线 3（§0.4）：**用户未点「允许」之前，磁盘上零写入**。它有两个机检形态，缺一不可：
 *  1. 授权之后（`src/app/local-store.ts`）：`createLocalStore({ persistent })` + `deny()`
 *     ⇒ `persistent.set/remove` 调用次数恒 0；
 *  2. 授权之前（**本文件 + `src/ui/local-store-browser.ts`**）：后端**探测本身**只读
 *     （`selectReadableStore` 只 `get` 探针键，**从不 `set`/`remove`**）⇒ 启动到
 *     "渲染授权弹窗"为止的整条路径上 `set`/`remove` 调用数恒 0 —— 选择发生在授权弹窗
 *     **之前**（`main.ts` 的模块级 `openL1Store()`），所以它一旦写盘，就是"每个玩家每次
 *     打开页面都先写一次磁盘，包括随后点「不允许」的人"，会让 `src/app/privacy.ts` 里
 *     「在此之前，磁盘上不会有任何写入」**逐字变成假承诺**。
 *
 * ## 写探针搬到了「用户点允许」那一刻（不是删掉，是搬家）
 *
 * 纯只读探测有一个真实代价：**Safari 隐私模式下 `localStorage` 对象存在、`getItem` 能跑，
 * 但 `setItem` 抛 `QuotaExceededError`** ⇒ 只看读会把不可写的后端当成可用后端。
 * 修法不是"退回同意前写一次"（那就违反红线 3），而是把**同一个写探针**（`probeWritable`）
 * 搬到**授权之后、任何用户数据落盘之前**：
 *  `src/app/local-store.ts` 的 `grant()` 对**注入进来的 `KeyValueStore`** 跑一次
 *  `set(probeKey,'1') → get → remove`，失败 ⇒ 降级为内存 KV、`isPersistent()` 回 `false`。
 * 于是三方同时成立：① 同意前磁盘零写入；② Safari 隐私模式在"用户点了允许、但还没有任何
 * 用户数据写下去"时就发现（比惰性降级更早、更准确）；③ `isPersistent()` 的语义从
 * "后端对象存在"**变强**成"后端真的写得进去"。
 *
 * ⚠️ 纯层（`src/app/**`）**不碰浏览器 API**：`probeWritable` 收的是一个注入的
 * `KeyValueStore`，读 `globalThis.localStorage` 的事仍然只在
 * `src/ui/local-store-browser.ts` 里发生。
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
 * | 值恰好是 `null`（`JSON.parse('null')` 合法） | `readJson` 归一成 `fallback`（见它上面的说明） | — |
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

/**
 * 探测用的键：`set` 探针写进去、**立刻删掉**（`probeWritable`），探测之前不存在、
 * 探测之后不残留。
 *
 * 带着前缀（而不是 `__probe__` 这种裸名）是因为它真的会短暂出现在用户磁盘上：
 * 前缀让它在开发者工具里一眼能看出是谁写的。
 *
 * ⚠️ **本键只有 `probeWritable` 会写，而 `probeWritable` 只在用户点「允许」之后被调用**
 * （`createLocalStore.grant()`，见本文件头注的「写探针搬到了…」一节）。
 * 授权之前的选择路径（`selectReadableStore`）**只读**，见那里的说明。
 *
 * ## 旧实现的探针键 `__l1_probe__`：**不迁移、不清理**（结论不变，理由已改正）
 *
 * 修复前的 `pickNamedStore` 在**授权之前**写的是裸键 `__l1_probe__`，它可能残留在装过旧
 * 构建的用户磁盘上。本轮的决定是**不为它写清理/迁移代码**。真实理由（按重要性排序）：
 *  1. 旧实现那一路是 `set → get → remove` **自净**的，只有"最后一步抛错"这种病理后端才可能
 *     留下残留（与本文件 `probeWritable` 记录的那种后端同源）；
 *  2. ⚠️ **修复轮自述给的理由不成立、已作废**：那里写的是"为它加清理会在**授权前**引入一次
 *     删除调用，正好违反红线 3"。清理完全可以放在 `grant()`（同意之后），所以这条理由与红线 3
 *     无关 —— 反证：真的在 `grant()` 里加一次旧键删除，**全部"授权前零写入"账本腿仍然全绿**，
 *     只有两条"写探针计数"腿变红（`expected 3 to be 2`；本次修复轮 M11 变异实测）；
 *  3. 于是真实代价是**扰动写探针的计数口径**：授权之后"恰好一次探针（set + 删除 = 2 次变更
 *     调用）"是 `grant()` 契约的一部分，被两条腿逐字钉住。为一个"只有病理后端才可能残留、
 *     且新代码零引用"的旧键再加一次删除，会把这套计数口径与旧键迁移耦在一起 —— 收益低于
 *     成本，所以不做。
 *
 * 另：`__l1_probe__` 在 `src/` 的**代码位**零命中（除本段注释外没有任何出现；新实现既不读也
 * 不写它），因此"不清理"不会让新代码读回任何旧值。
 *
 * **这条决定没有配新腿**：它记录的是"**不做**某件事"的负决定，能钉住它的形态只有"断言清理
 * 不发生"—— 那要么是源码文本腿（本仓已裁定文本腿不充当覆盖），要么是把一个**有意的缺失**
 * 冻成判据。唯一有实际后果的那一面（授权后计数口径被扰动）已由上述两条计数腿覆盖，
 * M11 变异实测证明它们承重，故这里只改注释、不加腿。
 */
export const L1_PROBE_KEY = `${L1_KEY_PREFIX}l1-probe`;

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
 * **只读**选择一个可用的后端：真跑一次 `get` + `keys(…)`，**从不 `set`/`remove`**。
 *
 * 为什么探测只读（而不是"真写一次最可靠"）：这个函数跑在**用户点「允许」之前**的启动路径上
 * （`src/ui/local-store-browser.ts` 的 `openL1Store()` ← `main.ts` 的模块级调用）。
 * 红线 3 的原文是「用户未点"允许"之前，磁盘上零写入」，`src/app/privacy.ts` 也把这句
 * **逐字**承诺给了玩家 ⇒ 同意之前**一次写都不能有**，包括探针。
 *
 * 代价（**明说，不掩盖**）：只读探测发现不了"Safari 隐私模式下 `setItem` 抛
 * `QuotaExceededError`"这一类**不可写但可读**的后端 —— 那些后端会被选中。
 * 兜住它的是两道**授权之后**的防线，见本文件头注：
 *  `probeWritable`（用户点允许那一刻，降级为内存）与 `writeJson` 的 `write-failed`
 *  （万一还是漏过去，也只是"本机保存失败，本次会话仍可正常游玩"，不抛、不崩）。
 *
 * ⚠️ **另一处口径变化（如实记下）**：本函数把 `keys()` 也当成探测项，于是
 * "`get` 能跑、`keys()` 抛"的后端会被拒成 `null`；而修复前的**写**探针不碰 `keys`，
 * 这种后端会被选中。方向上**更严**（宁可降级到内存，也不要一个"列不出键"的后端 ——
 * 那会让"清除本机数据"变成瞎清），且本仓没有任何存储实现是"读得了、列不出来"。
 */
export function selectReadableStore(kv: KeyValueStore): KeyValueStore | null {
  try {
    kv.get(L1_PROBE_KEY);   // 读探针：验证"拿得到值"，且 SecurityError 会在这一步暴露
    kv.keys();              // 枚举探针：`clearAllLocalData` 之外的能力边界，一并在授权前试掉
    return kv;
  } catch {
    return null;            // 探测的语义就是"试一下，不行就降级"，这里的吞是**有意的**
  }
}

/**
 * **写探针**：`set` → `get` → `remove` 真跑一遍，返回"这个后端到底写不写得进去"。
 *
 * ⚠️ **调用时机是硬约束**：只允许在用户点「允许」之后调用
 * （当前唯一调用点是 `createLocalStore.grant()`）。写在同意之前 = 违反红线 3。
 *
 * 探针键用完即删 ⇒ 不残留、也不污染 `clearAllLocalData` 的计数（它只数 L1 的两个真键）。
 * 任何一步抛错都返回 `false`（不向外抛：存储不可写不是致命错误，只是"本次会话不能保存"）。
 *
 * ⚠️ **"set 成功但 remove 抛"时探针键会残留**（A3 变异实测）：这种后端等于
 * "写得进、删不掉"，残留一个探针键是它自己的病症，调用方拿到 `false`
 * 之后会整个降级为内存 KV、不再碰它。本轮**没有**为它加"二次清理" —— 理由是
 * `remove` 抛时再调一次 `remove` 还是抛（死代码），加进去只会变成一条无腿的假守卫。
 * 这条行为由 `tests/app/local-store.test.ts` 的一条腿**如实钉住**。
 */
export function probeWritable(kv: KeyValueStore): boolean {
  try {
    kv.set(L1_PROBE_KEY, '1');
    kv.get(L1_PROBE_KEY);
    kv.remove(L1_PROBE_KEY);
    return true;
  } catch {
    return false;
  }
}

function utf8Bytes(v: string): number {
  // TextEncoder 在 node(>=11) 与全部目标浏览器都有；不需要注入。
  // 注意别用 v.length：中文一个字 3 字节，按 UTF-16 码元判会**低估**（放宽上限）。
  return new TextEncoder().encode(v).length;
}

/**
 * 读 JSON。两类**故意的**吞错，都只有"坏数据不该让游戏打不开"这一个理由：
 *  1. JSON 解析失败（含空串） → `fallback`；
 *  2. **值恰好是 `null`**（`JSON.parse('null')` 是**合法解析**） → `fallback`。
 *
 * 第 2 条为什么要归一到 `fallback`（而不是留给调用方守）：
 *  - 本仓**没有任何一处**把 `null` 当作有意义的存储值 —— 写侧只有 `writeJson(…, {…})`
 *    这类对象/数组（`src/app/local-store.ts` 的三个调用点全是对象或数组），
 *    `null` 只可能是**外部手改**、**别的程序写的同键**或**代码回归**的产物；
 *  - `T` 这个返回类型在 `T extends object` 时是**假的**：JS 里 `JSON.parse` 能返回
 *    `null`/数字/字符串，于是签名承诺"给你 T"、运行时给 `null` —— 调用方一旦写
 *    `s.nick`（`readNickName` 的旧写法）就是 `TypeError`，而这条**只在别人手改过
 *    存储之后**才发作，属于最难复现的一类线上崩溃；
 *  - 归一的**代价**是"合法的 `null` 存储再也读不出来"，而上面已论证本仓不存 `null`；
 *    真要有哪一天需要"区分 null 与不存在"，正确做法是**加一个新函数**（`readJsonRaw`），
 *    而不是把这层守卫拆散到每个调用点（那就倒退成"每个消费者各自记得守"）。
 *
 * 边界（**不**吞的）：`kv.get` 自身的异常仍然原样外抛（存储不可用是另一类问题，
 * 调用方要能看见）；解析出来的**数字 / 字符串 / 布尔**（如 `42`、`"x"`）**不**归一，
 * 那是调用方按形状守的事（`readNickName` 回空串 / `readDecks` 回空数组）。
 */
export function readJson<T>(kv: KeyValueStore, key: string, fallback: T): T {
  const raw = kv.get(key);
  if (raw === null) return fallback;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return fallback; // 坏数据不该让游戏打不开
  }
  if (parsed === null) return fallback; // `JSON.parse('null')` 合法，但 `T` 不可能是 null
  return parsed as T;
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
