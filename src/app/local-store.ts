/**
 * L1 数据模型与**授权状态机**（G3；见 §3.5、§3.6）。
 *
 * 关键不变式（红线的机检形态）：
 *  1. `consent === 'denied'`（游客模式）⇒ 任何写入都不碰 persistent（走内存 KV）；
 *  2. **"允许"这个选择会落盘**（键 `L1_CONSENT`，值只有 `allowed`）—— 2026-09-29 用户口径：
 *     弹窗文案写着"你随时可以…改变这个选择"，那就该记住。原来"只活内存、刷新即重问"的代价是
 *     **每次整页加载都重问一次**（刷新页面、或从「设备体检」那种独立页返回都会弹；用户实测报的
 *     就是这个）。`deny` **不落盘**（那个按钮写的是"不用，本次不保存"）⇒ 下次仍然问。
 *     时机不变：标记与写探针都**只在 `grant()` 里写**（授权之前零写入这条红线不碰）。
 *  3. persistent 不可用（null）时**功能仍可用**，只是全部退化到内存；
 *  4. `grant()` 之后**真的写得进去**才算持久（写探针结论）—— 只读探测发现不了的
 *     Safari 隐私模式在这里被挡在"任何用户数据落盘之前"（见 `src/app/storage.ts` 头注）。
 *
 * 状态流转（`src/main.ts` 的启动逻辑据此接线）：
 * ```
 *  unknown ──ask()──> ask ──grant()──> allowed   （allowed 才允许落盘；grant 里跑一次写探针）
 *     │                 │
 *     └────deny()───────┴────────────> denied    （denied = 游客模式 = 零写入）
 *  reset() （"清除本机数据"后）→ 回到 unknown（并把 `L1_CONSENT` 标记一起删掉 ⇒ 下次重新问）
 * ```
 * `ask` 存在的唯一理由：**弹窗已显示、等用户点**。`unknown` 与 `ask` 下都不得有任何落盘写入。
 */
import {
  L1_CONSENT,
  L1_DECKS,
  L1_SETTINGS,
  clearAllLocalData,
  createMemoryStore,
  probeWritable,
  readJson,
  writeJson,
  type KeyValueStore,
} from './storage';
// ★ 2026-10-01（P0）：语言这个**值的类型**住在零依赖叶子 `src/i18n/lang.ts`（不是
// `src/i18n/index.ts`）—— 那一层含文案表与 `import.meta.env`，纯层不许依赖它。理由写在那个文件里。
import type { Lang } from '../i18n/lang';

export type ConsentState = 'unknown' | 'ask' | 'allowed' | 'denied';

/** `L1_CONSENT` 里存的**唯一**值（只记"允许"；`deny` 不落盘） */
const CONSENT_GRANTED = 'allowed';

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
   * ★ 2026-09-29：这个 store 有没有把"已允许"标记**真的落到磁盘上**。
   *
   * 它只为 `reset()` 服务：只有"标记确实存在过"时才去删它 —— `deny`（游客模式）下**一个字节都
   * 不许碰 persistent**（红线 3：denied ⇒ 任何写入都不碰 persistent），那种情况下这里恒 false。
   */
  let consentMarkerOnDisk = false;
  /**
   * ★ 2026-09-29：**上一轮点过「允许」就直接视为已允许**（标记键 `L1_CONSENT`）。
   *
   * 这里只读一次 `get`（授权之前零写入的红线不碰）。标记存在 ⇒ 后端上一轮已经证明过写得进去
   * （标记就是它写下去的、写探针通过才写）⇒ **不再跑写探针**：`probeWritable` 的全仓唯一落点
   * 必须留在 `grant()` 里（两处按源码位置钉住它：本文件的头注与 `tests/app/local-store.test.ts`）。
   */
  if (opts.persistent !== null && opts.persistent.get(L1_CONSENT) === CONSENT_GRANTED) {
    consent = 'allowed';
    persistentWritable = true;
    consentMarkerOnDisk = true;
  }
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
      if (opts.persistent !== null) {
        persistentWritable = probeWritable(opts.persistent);
        // ★ 2026-09-29：探针通过才落"已允许"这个标记（写不进去就不落 —— 下一轮照旧会问，
        // 而那正是 Safari 隐私模式该有的表现）。写失败不抛：本次会话照旧可用。
        if (persistentWritable === true) {
          try {
            opts.persistent.set(L1_CONSENT, CONSENT_GRANTED);
            consentMarkerOnDisk = true;
          } catch { /* 忽略：标记没落下而已 */ }
        }
      }
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
    reset: () => {
      consent = 'unknown';
      persistentWritable = null;
      // ★ 2026-09-29：把"已允许"标记一起删掉 ⇒「清除本机数据」之后下次启动重新问（"改变这个选择"）。
      // ⚠️ 只在标记**确实在磁盘上**时才碰 persistent —— 游客模式（deny）下必须零写入（红线 3）。
      if (consentMarkerOnDisk && opts.persistent !== null) {
        try { opts.persistent.remove(L1_CONSENT); } catch { /* 删不掉就当没这个标记 */ }
      }
      consentMarkerOnDisk = false;
    },
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
  /**
   * ★ 2026-10-01（用户拍板"UI 全量双语"，方案 `docs/2026-10-01-新手引导与教学-方案.md` §2.2）：
   * **界面语言**。它是 L1 设置对象里的一个**字段**，不是一个新键 —— 于是它与昵称同一份存储、
   * 同一套授权门控、同一次「清除本机数据」（`clearAllLocalData` 清的就是 `L1_SETTINGS` 这个键）。
   *
   * ⚠️ **卡牌文本不在这里**：`src/data/cards*.ts` 的中文是**数据**，被 `npm run texts:check`
   * 与联机卡文哈希逐字钉住；英文卡面走以后 P4 的显示层翻译表（按 `defId` 映射）。
   *
   * 可选（`lang?`）：老的存储里没有这个字段，读出来是 `undefined` ⇒ 用默认中文。
   */
  lang?: Lang;
}

/**
 * 读设置对象（**读取侧守卫的唯一出口**，`readNickName` / `readLang` 都走它）。
 *
 * 三条防线，各管一段（`readNickName` 原来的注释**逐字**保留在这里，别把职责说混）：
 *  1. **承重的那条是 `readJson` 的 null 归一**（`JSON.parse('null')` 是合法解析）——
 *     `null.nick` 会抛 `TypeError`，那是 G3 要修的崩溃；去掉归一 ⇒ `readNickName` 的腿
 *     **立刻变红**（C1 变异实测）。
 *  2. `typeof s !== 'object' || s === null` + 非数组 是**形状守卫**：`{nick: 42}` / 数组 /
 *     数字 / 字符串这些"合法 JSON 但不是设置对象"的值一律回空对象（去掉它 ⇒ 变红，C3 变异实测）。
 *  3. 返回值是**浅拷贝**：写入侧要在它上面摊开（`{ ...prev, nick }`），共享引用会让
 *     "读一次、改两处"互相污染（`writeNickName` 那条注释里的"垃圾对象"就是这个形态）。
 */
function readSettings(store: LocalStore): Record<string, unknown> {
  const s = readJson<unknown>(store.kv(), L1_SETTINGS, {});
  // 防御层：在 `readJson` 已归一 `null` 的前提下它**不承重**，但 `readJson` 的契约一旦被
  // 放宽（或这里换成别的读取函数），它就是最后一道拦住 `null` 解引用的墙。
  if (typeof s !== 'object' || s === null || Array.isArray(s)) return {};
  return { ...(s as Record<string, unknown>) };
}

/**
 * 写设置对象：读出旧值（走上面**同一套守卫**）再摊开覆盖 `patch` 里那几个字段。
 *
 * ⚠️ 写成"读旧值走 `readSettings`"而不是裸的 `readJson(...)`：那会在
 * "存储里是 `42`/`[1,2]`"时把 `{...42, nick}`、`{...['a'], nick}` 这种垃圾对象写回去
 * —— 不是崩溃，但是脏数据。
 *
 * ⚠️ **已知的窄口径**（G3 实测出来的，明写在这里而不是假装没有）：本函数把"非对象/数组"
 * 的旧值一律当空对象处理 ⇒ 读取侧回空串、写回后是一个**新对象**（而不是原样保留那个数组）。
 * 这条只会在"存储被外部手改/污染"时被走到，且两个方向都不丢用户数据（旧值本来就不是设置）。
 */
function writeSettings(store: LocalStore, patch: Record<string, unknown>): boolean {
  const prev = readSettings(store);
  return writeJson(store.kv(), L1_SETTINGS, { ...prev, ...patch }).ok;
}

/**
 * 读昵称。**两条防线，各管一段**（别把它们的职责说混）：
 *  1. **承重的那条是 `readJson` 的 null 归一**（`JSON.parse('null')` 是合法解析）——
 *     `null.nick` 会抛 `TypeError`，那是本轮要修的崩溃；去掉归一 ⇒ 本函数的腿**立刻变红**
 *     （C1 变异实测）。
 *  2. `typeof nick === 'string'` 是**形状守卫**：`{nick: 42}` / 数组 / 数字 / 字符串
 *     这些"合法 JSON 但不是设置对象"的值一律回空串（去掉它 ⇒ 变红，C3 变异实测）。
 *  3. 第三层防御（`typeof s !== 'object' || s === null`）已随读取侧收口搬进 `readSettings`，
 *     那里写着它为什么不承重、以及为什么仍然保留。
 */
export function readNickName(store: LocalStore): string {
  const nick = readSettings(store).nick;
  return typeof nick === 'string' ? nick : ''; // 承重的形状守卫（C3）
}

/**
 * 写昵称。读旧值走 `readSettings` 的**同一套守卫**（见 `writeSettings` 的说明）。
 */
export function writeNickName(store: LocalStore, nick: string): boolean {
  return writeSettings(store, { nick });
}

/**
 * ★ 2026-10-01（P0）：读界面语言。
 *
 * **回 `unknown` 而不是 `Lang`**：形状守卫归 `src/i18n/lang.ts` 的 `isLang()` 一处
 * （它同时管"存储里是 `'xx'`"与"存储里是 `42`"两种情形）。本函数只负责把设置对象里那个
 * 字段**原样**取出来 —— 在这一层假装自己认识语言，会让校验出现第二份实现。
 *
 * ⚠️ 存储里是坏值时**回 `undefined`**，不抛：缺一个语言偏好不该让游戏打不开
 * （与 `readNickName` 回空串同一条纪律）。
 */
export function readLang(store: LocalStore): unknown {
  return readSettings(store).lang;
}

/**
 * ★ 2026-10-01（P0）：写界面语言。返回值语义与 `writeNickName` **逐字相同**：
 * `true` = 真的落到 `store.kv()` 了；`false` = 没写进去（配额满 / 隐私模式 / 超上限）。
 *
 * ⚠️ **`false` 不等于"这次切换没生效"**：游客模式（`deny`）下 `store.kv()` 是**内存 KV**，
 * 它会成功（回 `true`），但刷新即丢；只有"后端存在却写不进去"才回 `false`。
 * 两种情形的提示措辞由宿主（`src/main.ts` 的 `applyLangChange`）分开说，别混成一句。
 */
export function writeLang(store: LocalStore, lang: Lang): boolean {
  return writeSettings(store, { lang });
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
