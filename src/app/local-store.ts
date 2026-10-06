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
  type WriteResult,
} from './storage';
// ★ 2026-10-01（P0）：语言这个**值的类型**住在零依赖叶子 `src/i18n/lang.ts`（不是
// `src/i18n/index.ts`）—— 那一层含文案表与 `import.meta.env`，纯层不许依赖它。理由写在那个文件里。
import type { Lang } from '../i18n/lang';
// ★ 2026-10-06：「自定义协议池」这份选择的**形状**住在 `src/app/pool-choice.ts`（纯层叶子，
// 零依赖）。这里只转出去一个类型，不重复定义第二份（两份形状一旦漂移，存储与屏就会各说各话）。
import type { PoolChoice } from './pool-choice';

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
  /**
   * ★ 2026-10-01（用户要求"设置里的选项也要持久化，就和玩家名一样"）：
   * **特效开关**的键值表（键 = `FxSettingDef.id`，值 = 开关状态）。
   *
   * 与 `nick` / `lang` 同住一份设置、同一套授权门控、同一次「清除本机数据」（**不新增存储键**）。
   * 形状守卫在 `readFxSettings()` 里逐字段做（坏值一律退回默认）。
   *
   * 可选：老的存储里没有这个字段 ⇒ 用各项的默认值。
   */
  fx?: Record<string, boolean>;
  /**
   * ★ 2026-10-01（P1）：**首启向导走完了吗**（"只出现一次"的标记）。
   *
   * 与 `nick` / `lang` / `fx` 同住一份设置、同一套授权门控、同一次「清除本机数据」
   * （**不新增存储键**）。清除本机数据之后这个字段一起没 ⇒ **向导重新出现一次**（这正是想要的）。
   *
   * ⚠️ **游客模式下它写不进磁盘**（`kv()` 是内存 KV）⇒"只出现一次"在游客模式里**不成立**：
   * 刷新之后向导会再出现。这是**如实的**行为，不是缺陷 —— 用户没同意保存，本机就不该记住任何东西。
   * 文档与屏上的措辞都不许假装它是"永久只出现一次"。
   *
   * 可选：老的存储里没有这个字段 ⇒ 当作"还没走过"。
   */
  onboardingSeen?: boolean;
  /**
   * ★ 2026-10-02（P2）：**教学模式的进度**（已完成关卡 + 当前关）。
   *
   * 与 `nick` / `lang` / `fx` / `onboardingSeen` 同住一份设置、同一套授权门控、
   * 同一次「清除本机数据」（**不新增存储键**）。清除之后进度清空 ⇒ 教学从 T0 重新开始
   * （方案 §6："清除本机数据后…教学进度清空（这正是想要的）"）。
   *
   * 形状守卫在 `readTutorialProgress()` 里**逐字段**做（坏值一律退回"没玩过"）——
   * 与 `readFxSettings()` 同一套口径。存的是 `{ done: string[], current: string }`，
   * 读侧只认**合法关卡 id**（`T0`~`T3`）：别的值一律当没玩过，防止外部手改把教学锁死在一关出不来的地方。
   *
   * ⚠️ 游客模式下写不进磁盘（`kv()` 是内存 KV）⇒ 本次会话有效、刷新即丢。
   * 这是**如实的**行为（与语言/向导标记同一条口径），不是缺陷。
   */
  tutorial?: { done?: readonly string[]; current?: string };
  /**
   * ★ 2026-10-06（用户要求）：**自定义协议池的预设**（勾没勾 + 挑了哪几套）。
   *
   * 与 `nick` / `lang` / `fx` / `onboardingSeen` / `tutorial` 同住一份设置、同一套授权门控、
   * 同一次「清除本机数据」（**不新增存储键**）。清除之后这个字段一起没 ⇒ 模式选择页上
   * 「自定义协议池」回落成未勾选（那正是"本机存的选择丢了"这条兜底要的行为）。
   *
   * 形状守卫在 `readPoolPreset()` 里逐字段做（`ids` 只留字符串、`enabled` 只认 `true`）；
   * "哪些 defId 现在还认、顺序怎么排、够不够 12 套"**不在这里判** —— 那是
   * `src/app/pool-choice.ts` 的事（这一层不认识协议数据集）。
   *
   * ⚠️ 游客模式下写不进磁盘（`kv()` 是内存 KV）⇒ 本次会话有效、刷新即丢。
   * 这是**如实的**行为（与语言/向导标记同一条口径），不是缺陷。
   */
  pool?: { ids?: readonly string[]; enabled?: boolean };
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
 *
 * ★ 2026-10-01（P0，线上验收 D3）：**回 `WriteResult` 而不是布尔** —— 见 `writeLang` 的说明。
 *   昵称那条路仍然只要"成功/失败"两态，所以 `writeNickName` 在它上面取 `.ok`。
 */
function writeSettings(store: LocalStore, patch: Record<string, unknown>): WriteResult {
  const prev = readSettings(store);
  return writeJson(store.kv(), L1_SETTINGS, { ...prev, ...patch });
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
 *
 * 返回值**仍然是布尔**（`true` = 真的落盘了）：昵称那一侧的调用方（「本地数据与隐私」屏）
 * 只需要"成功/失败"两态，它把失败提示写成一句既定的文案
 * （"本机保存失败，本次会话仍可正常游玩。"，被既有腿逐字钉住）。
 * 语言那一侧不同 —— 它要按**原因**给不同措辞（见 `writeLang`）。
 */
export function writeNickName(store: LocalStore, nick: string): boolean {
  return writeSettings(store, { nick }).ok;
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
 *
 * ⚠️ ★ 2026-10-01（P0，线上验收 D1）：**`undefined` 有两种来源，调用方必须分开**：
 *  1. **键不存在**（全新访客、刚点完「清除本机数据」、从没切过语言）—— 正常态；
 *  2. **键存在但值不是 `zh`/`en`**（存储被外部手改 / 换了版本）—— 异常态，要如实说出来。
 *  本函数只知道"最终取到的是什么"，分不出来源；要分开就得**直接看那个键**
 *  （`L1_SETTINGS` 的原始 JSON 里有没有 `lang` 这个属性）—— 「本地数据与隐私」屏的
 *  `readLangPresence()` 就是干这个的（见那里的说明与 `tests/i18n/local-data-lang-row.test.ts`
 *  的五形态腿）。
 */
export function readLang(store: LocalStore): unknown {
  return readSettings(store).lang;
}

/**
 * ★ 2026-10-01（P0，线上验收 D1）：`lang` 这个字段在存储里**到底在不在**（四态）。
 *
 * ## 为什么需要它
 *
 * `readLang()` 把下面好几种情形都回成 `undefined`，而它们在屏上必须说不同的话：
 *
 * | 情形 | 例子 | 屏上该说 |
 * |---|---|---|
 * | 键不存在 | 全新访客 / 刚点完清除 / 从没切过语言 | 就一句「界面语言：中文」 |
 * | 键在、但没有 `lang` 字段 | 只存过昵称的 `{"nick":"甲"}` | 同上 —— **本机从来没有存过语言**，说"存的不是一个有效值"是不实陈述 |
 * | 键在、`lang` 是有效值 | `{"lang":"zh"}` | 「界面语言：中文」 |
 * | 键在、`lang` 不是有效值 | `{"lang":"xx"}` | 默认语言 + 「（本机存的不是一个有效值，按默认语言显示）」 |
 * | 键在、整份 JSON 坏了 | `{oops` | 同上那半句 —— 它确实是一段**坏数据**，不是"没设置过" |
 *
 * 第一版没有这个函数，屏上用 `isLang(raw) ? '' : tail` 判 ⇒ **缺键也挂了那句警告**
 * （线上验收 D1：全新访客与刚清除完的人都被告知"本机存的不是一个有效值"）。
 * 第二版按"键在不在"二分 ⇒ `{"nick":"甲"}` 也被挂了那句警告（同一条不实陈述，用户 2026-10-01 裁定改掉）。
 *
 * ## 四态（★ 2026-10-01 按用户裁决收成这个形状）
 *
 *  - `'absent'`：**键根本不存在** ⇒ 正常态；
 *  - `'unset'`：键在、JSON 也解析得出来、但那份设置里**没有 `lang` 字段** ⇒ 正常态（"还没设置过语言"）；
 *  - `'present'`：**`lang` 字段存在**（值可能是 `zh`/`en`，也可能是坏值 —— 那由 `isLang()` 判）
 *    **或**整份 JSON 解析不出来（坏数据）⇒ 屏上按"能不能用"如实说话；
 *  - `'unreadable'`：读存储本身抛错（`kv.get` 抛 / 后端不可用），屏上如实报失败原因。
 *
 * ⚠️ **坏 JSON 落进 `'present'`**（这是线上验收 D1 的形态③要求的）：`readJson` 在解析失败时
 *   回 `{}`（它的注释写着这是**故意的**吞 —— 坏数据不该让游戏打不开）⇒ 只看"解析后的对象里
 *   有没有 `lang`"会把坏 JSON 判成 `'unset'`，于是屏上**不说**"本机存的不是一个有效值"，
 *   而那份设置确实是坏的、语言确实没读出来。
 *   ⇒ 判据：先看键在不在（`kv.get`）；键在就再试着解析一次 ——
 *     解析成功且是对象 ⇒ 看有没有 `lang` 属性（有 = `'present'`，没有 = `'unset'`）；
 *     解析失败 ⇒ `'present'`（坏数据要说实话）。
 */
export function readLangPresence(store: LocalStore): 'absent' | 'unset' | 'present' | 'unreadable' {
  let raw: string | null;
  try {
    raw = store.kv().get(L1_SETTINGS);
  } catch {
    // `kv.get` 抛（存储不可用）—— 与 `readJson` 的"坏 JSON 吞掉"是两件事，别混
    return 'unreadable';
  }
  if (raw === null) return 'absent';
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return 'present'; // 坏 JSON：它是一段坏数据，不是"没设置过"
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    // 合法 JSON 但不是设置对象（`42` / `"x"` / `true` / 数组）：与坏 JSON 同档 —— 数据不可用
    return 'present';
  }
  return Object.prototype.hasOwnProperty.call(parsed, 'lang') ? 'present' : 'unset';
}

/**
 * ★ 2026-10-01（P0）：写界面语言。
 *
 * ## 为什么它回 `WriteResult` 而 `writeNickName` 回布尔（线上验收 D3）
 *
 * 第一版回布尔 ⇒ 宿主只能写一句**猜出来的**兜底文案（"本机存储拒绝写入（隐私模式或配额已满）"），
 * 于是：① 那句对"值超上限"是**错的**（真因是 `70021 字节 > 上限 65536 字节`，被丢掉了）；
 * ② 它是硬编码中文，英文界面下夹着中文（线上验收 D3 的原话）。
 * ⇒ 让写侧把**结构化原因**交出来（`too-large` / `write-failed` + 真因 detail），界面按原因
 *   给**本地化**文案，并把真 detail 原样带上。
 *
 * 返回值语义（与 `storage.ts` 的 `writeJson` **同一套**，不另立一套）：
 *  - `{ ok: true }`：真的落到 `store.kv()` 了；
 *  - `{ ok: false, reason: 'too-large', detail }`：**拼出来的整份设置**超过 `L1_VALUE_MAX_BYTES`
 *    ⇒ 一个字节都没写（`writeJson` 在碰 KV 之前就退回）；
 *  - `{ ok: false, reason: 'write-failed', detail }`：后端拒绝写（隐私模式 / 配额满）。
 *
 * ⚠️ **`ok: false` 不等于"这次切换没生效"**：游客模式（`deny`）下 `store.kv()` 是**内存 KV**，
 * 它会成功（回 `ok: true`），但刷新即丢；只有"后端存在却写不进去"才回 `ok: false`。
 * 两种情形的提示措辞由宿主（`src/main.ts` 的 `applyLangChange`）分开说，别混成一句。
 *
 * ⚠️ 它仍然可能**抛**（`readSettings` 的 `kv.get` 会外抛，与 `writeNickName` 同一条边界）
 * ⇒ 调用方要自己兜 `try/catch`（`applyLangChange` 兜了，并把它归成 `write-failed` 那一档）。
 */
export function writeLang(store: LocalStore, lang: Lang): WriteResult {
  return writeSettings(store, { lang });
}

/**
 * ★ 2026-10-01（用户要求"设置里的选项也要持久化，就和玩家名一样"）：读**特效开关**。
 *
 * ## 形状守卫（逐字段，坏值一律退回默认）
 *
 * 返回值是"存储里**确实**是布尔的那些项"，**不含**默认值 —— 缺项/坏项由调用方
 * （`applyFxSettings`）按各项目己的默认值兜。理由：这一层不认识"有哪些开关、默认是开还是关"
 * （那是 `src/ui/fx-settings.ts` 的知识），在这一层硬编码默认值会让默认值出现**第二份真相**。
 *
 * ⚠️ 读不出来时回**空对象**（不是 `undefined`），调用方按默认值算 —— 与 `readDecks` 回
 * 空数组同一条纪律：缺一个设置项不该让游戏打不开。
 * ⚠️ `kv.get` 抛错**原样外抛**（与 `readLang`/`readNickName` 同一条边界），调用方自己兜。
 */
export function readFxSettings(store: LocalStore): Record<string, boolean> {
  const raw = readSettings(store).fx;
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
  const out: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === 'boolean') out[k] = v;
  }
  return out;
}

/**
 * ★ 2026-10-01：写**特效开关**。
 *
 * - `patch` 是"要改的那几项"（读-改-写：不传的项保持存储里的原值）；
 * - 返回值与 `writeLang` **同一套** `WriteResult`（成功 / `too-large` / `write-failed` + 真因）
 *   ⇒ 界面按原因给本地化文案，不新造第二套。
 *
 * ⚠️ 与语言同一条路：游客模式（`deny`）下 `store.kv()` 是内存 KV ⇒ 本次会话有效、刷新即丢、
 * 磁盘零写入。
 */
export function writeFxSettings(store: LocalStore, patch: Record<string, boolean>): WriteResult {
  const prev = readFxSettings(store);
  return writeSettings(store, { fx: { ...prev, ...patch } });
}

/**
 * ★ 2026-10-01（P1）：**首启向导走完了吗**（"只出现一次"的标记）。
 *
 * 形状守卫与 `readNickName` 同款：**只认 `true`**（`typeof !== 'boolean'` 一律 `false`）。
 * 于是"存储被外部手改 / 别的程序写了同键"永远退化成"还没走过" ⇒ 向导**再出现一次**，
 * 而不是"被垃圾值锁住再也看不到"。方向是**安全**的那一边（多问一次 vs 永远不问）。
 *
 * ⚠️ 读不出来（键不存在 / 坏 JSON / `kv.get` 抛）⇒ `false`（与"没走过"同义），不抛。
 */
export function readOnboardingSeen(store: LocalStore): boolean {
  return readSettings(store).onboardingSeen === true;
}

/**
 * ★ 2026-10-01（P1）：写下"向导走完了"这个标记。
 *
 * 与昵称/语言/开关**同一条路**（同一份设置、同一套授权门控）：游客模式下它写的是内存 KV
 * ⇒ 本次会话有效、刷新即丢、磁盘零写入（红线 3）—— 这正是"游客模式下向导刷新后会再出现"的机制。
 *
 * 返回值与 `writeLang` 同一套 `WriteResult`（成功 / `too-large` / `write-failed` + 真因）。
 */
export function writeOnboardingSeen(store: LocalStore, seen: boolean): WriteResult {
  return writeSettings(store, { onboardingSeen: seen });
}

/**
 * ★ 2026-10-06（用户要求）：读**「选牌即确定」**这一项（设置里的新开关，**默认关闭**）。
 *
 * 用户原话：「在设置中加上一个选择项，默认关闭，打开后，玩家在触发需要选择卡牌后按下确定键
 * 才能确定将效果作用于该卡时，其操作会变为无需按下确定键就能确定将效果作用于选择的卡牌，
 * 即点击即触发，但注意，这个设置只会影响到不可选择跳过或是其他效果的卡牌效果，那些具有
 * 可选的卡牌不受其影响」。范围口径（用户 2026-10-06 当场裁决）：**只有"只选 1 张"的自动确定**，
 * 多选（弃2张/弃3张、"1张或更多"）保持原样仍要按确定键。
 *
 * 形状守卫与 `readOnboardingSeen` 同款：**只认 `true`**（其它一律 `false`）——
 * 存储被外部手改 / 别的程序写了同键 ⇒ 退化成"关闭"（玩家最多重新开一次），
 * 而不是因为一个垃圾值就把"少按一次确定"变成默认行为。
 *
 * ⚠️ 它住在同一个 `L1_SETTINGS`（`compile-settings`）对象里的字段 `instantChoice`，
 * **不新增键**（与 `nick` / `lang` / `fx` / `tutorial` 同住一份设置）。
 */
export function readInstantChoice(store: LocalStore): boolean {
  return readSettings(store).instantChoice === true;
}

/** 写下「选牌即确定」。与语言/特效开关**同一条路**（同一份设置、同一套授权门控与 `WriteResult`）。 */
export function writeInstantChoice(store: LocalStore, on: boolean): WriteResult {
  return writeSettings(store, { instantChoice: on });
}

/**
 * ★ 2026-10-06（用户要求）：读**自定义协议池的预设**。
 *
 * ## 形状守卫（与 `readOnboardingSeen` / `readTutorialProgress` 同一条口径）
 *
 *  - `enabled` **只认 `true`**（`=== true`）：存储被外部手改 / 别的程序写了同键 ⇒ 退化成
 *    "没勾"，玩家最多重新勾一次（安全的那一边），不会因为一个垃圾值打不开模式页；
 *  - `ids` 只留**字符串**、按输入顺序保留（去重、认不认这个 defId、排成常量顺序都在
 *    `src/app/pool-choice.ts` 里做 —— 那一层才认识协议数据集）；
 *  - 整个字段缺失 / 不是对象（数组、字符串、`42`、`null`）/ `kv.get` 抛错 ⇒ 回
 *    `{ enabled: false, ids: [] }`，**不抛**（缺一个预设不该让游戏打不开）。
 *
 * ⚠️ `kv.get` 抛错**原样外抛**的是 `readSettings` 那条边界（与 `readLang` / `readFxSettings`
 * 一致）；本函数不额外包一层 `try`，调用方（`src/main.ts` 的渲染路径）自己按"读不出来当没勾"处理。
 */
export function readPoolPreset(store: LocalStore): PoolChoice {
  const raw = readSettings(store).pool;
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { enabled: false, ids: [] };
  }
  const rec = raw as Record<string, unknown>;
  const list = Array.isArray(rec.ids) ? rec.ids : [];
  const ids: string[] = [];
  for (const v of list) if (typeof v === 'string' && v !== '') ids.push(v);
  return { enabled: rec.enabled === true, ids };
}

/**
 * ★ 2026-10-06（用户要求）：写**自定义协议池的预设**（勾选框状态 + 挑好的 defId）。
 *
 * 与语言/开关**同一条路**（同一份设置、同一套授权门控、读-改-写）：
 * 写这一项不会抹掉昵称/语言/特效开关/教学进度。
 *
 * ⚠️ 写之前把 `ids` 过滤一遍（只留非空字符串）：出口只有一个，在这里归一，
 * 读侧与挑选屏就不必各自再防一次形状（与 `writeTutorialProgress` 同一做法）。
 *
 * 返回值与 `writeLang` 同一套 `WriteResult`（成功 / `too-large` / `write-failed` + 真因）。
 */
export function writePoolPreset(store: LocalStore, choice: PoolChoice): WriteResult {
  const ids: string[] = [];
  for (const v of choice.ids) if (typeof v === 'string' && v !== '') ids.push(v);
  return writeSettings(store, { pool: { ids, enabled: choice.enabled === true } });
}

/**
 * ★ 2026-10-02（P2）：**教学进度**的合法关卡 id（纯层不认识 `src/tutorial/`，所以自己列一份）。
 *
 * ⚠️ 与 `src/tutorial/levels.ts` 的 `TUT_LEVELS` 是**两份**清单，这是分层的代价：
 * `src/app/**` 是纯层，不许 import UI/教学那一层（那条依赖方向反过来会让纯层跑不起来）。
 * 两份"漂了"的风险由 `tests/tutorial/levels.test.ts` 的一条腿兜住（它同时 import 两边比对）。
 *
 * ★ 2026-10-06：`T7a`（牌能盖牌）插在 `T6` 与 `T7` 之间 —— 与 `TUT_LEVELS` 的**顺序**一致；
 * 它是个新 id，所以老进度里的 `current` / `done` 照旧指向原来那几课。
 */
const TUTORIAL_LEVEL_IDS: readonly string[] = [
  'S0', 'T0', 'T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7a', 'T7', 'T8', 'T9', 'T10', 'T11', 'T12', 'T13',
];

/**
 * 教学的第一关 —— **这一份清单的第 0 项**（不另写一个字面量，免得两处漂）。
 *
 * ★ 2026-10-06：`S0`（序章）插到最前面 ⇒ "没玩过 / 坏值 / 从头开始"都回它，
 * 而不是老的 `'T0'`（否则新玩家永远看不到序章，那一关等于死内容）。
 */
const TUTORIAL_FIRST_LEVEL = TUTORIAL_LEVEL_IDS[0];

/** 教学进度的形状（对外只暴露这个） */
export interface StoredTutorialProgress {
  readonly done: readonly string[];
  readonly current: string;
}

/**
 * ★ 2026-10-02（P2）：读教学进度。
 *
 * 形状守卫**逐字段**做（与 `readFxSettings` 同款）：
 *  - `done` 只收**合法关卡 id**、去重、按输入顺序保留；`current` 不是合法 id ⇒ 回第一关
 *    （`TUTORIAL_FIRST_LEVEL`，2026-10-06 起是 `S0`）；
 *  - 整个字段缺失 / 不是对象 / `done` 不是数组 ⇒ 回"没玩过"（`{ done: [], current: TUTORIAL_FIRST_LEVEL }`）。
 *
 * ⇒ 外部手改存储最多让玩家**从第一关重看**（安全的那一边），不会把教学卡在一关出不来。
 * 读不出来（键不存在 / 坏 JSON / `kv.get` 抛）也回"没玩过"，不抛。
 */
export function readTutorialProgress(store: LocalStore): StoredTutorialProgress {
  const raw = readSettings(store).tutorial;
  const fallback: StoredTutorialProgress = { done: [], current: TUTORIAL_FIRST_LEVEL };
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return fallback;
  const rec = raw as Record<string, unknown>;
  const doneRaw = Array.isArray(rec.done) ? rec.done : [];
  const done: string[] = [];
  for (const v of doneRaw) {
    if (typeof v === 'string' && TUTORIAL_LEVEL_IDS.includes(v) && !done.includes(v)) done.push(v);
  }
  const current = typeof rec.current === 'string' && TUTORIAL_LEVEL_IDS.includes(rec.current)
    ? rec.current
    : TUTORIAL_FIRST_LEVEL;
  return { done, current };
}

/**
 * ★ 2026-10-02（P2）：写教学进度（**整份替换**，不是打补丁）。
 *
 * 与语言/昵称/开关/向导标记**同一条路**（同一份设置、同一套授权门控）：游客模式下写进内存 KV
 * ⇒ 本次会话有效、刷新即丢、磁盘零写入（红线 3）。
 *
 * ⚠️ 写之前**把 `done` 过滤一遍**（只留合法 id、去重）：这一层的出口只有这一个，
 * 在这里归一，读侧与「本地数据与隐私」屏就不必各自再防一次。
 *
 * 返回值与 `writeLang` 同一套 `WriteResult`（成功 / `too-large` / `write-failed` + 真因）。
 */
export function writeTutorialProgress(
  store: LocalStore,
  progress: StoredTutorialProgress,
): WriteResult {
  const done: string[] = [];
  for (const v of progress.done) {
    if (typeof v === 'string' && TUTORIAL_LEVEL_IDS.includes(v) && !done.includes(v)) done.push(v);
  }
  const current = TUTORIAL_LEVEL_IDS.includes(progress.current) ? progress.current : TUTORIAL_FIRST_LEVEL;
  return writeSettings(store, { tutorial: { done, current } });
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
