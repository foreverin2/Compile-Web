/**
 * i18n 基建（★ 2026-10-01，P0 —— 用户当天拍板"UI 全量双语"，方案见
 * `docs/2026-10-01-新手引导与教学-方案.md` §6.5 与 §7 的 P0 行）。
 *
 * ## 这一层是什么 / 不是什么
 *
 * **是**：语言这一个开关的唯一出处。`zh.ts` / `en.ts` 两张平表 + `t()` + `getLang()` /
 * `setLang()`；语言值落 L1 本机设置（与昵称同一份存储、同一套授权门控与守卫）。
 * **不是**：不是翻译进度表（哪些屏抽了、哪些没抽，见
 * `docs/2026-10-01-i18n-尚未抽取的屏.md`）；不是卡牌文本的家（卡文是**数据**，
 * 被 `npm run texts:check` 与联机卡文哈希逐字钉住，英文卡面走以后 P4 的显示层翻译表）。
 *
 * ## 三条不变量
 *
 * 1. **默认中文，且中文文案与现状逐字一致**。这是"既有那几十条逐字钉住中文按钮的测试
 *    零改动"的前提，也是 P0 的验收判据之一：`tests/i18n/tables.test.ts` 有一条腿拿
 *    `zh` 表里的值反过来与既有的中文字面量比对，任何"顺手润色"都会被抓住。
 * 2. **缺键回退中文**（`t()` 的键在 `en` 里没有、`zh` 里有 ⇒ 回中文值）。
 *    **两表都没有**这个键时回退成 `⟪键名⟫`：它不是空串、不是 `undefined`，屏上看得见，
 *    开发态往控制台报一次（每个键一次，不刷屏）。生产态只进 `missingKeys()`，不抛不崩 ——
 *    缺一条文案不该让玩家看到一个白屏。
 * 3. **语言值与昵称同一条路径落盘**：`writeLang()` / `readLang()` 住在
 *    `src/app/local-store.ts`（与 `readNickName` / `writeNickName` 同款守卫、同一层）。
 *    本文件**不直接碰** `LocalStore`，只在 `initI18n()` 里读一次 —— 于是这一层能在
 *    node 下无存储真跑（本仓没有 jsdom）。
 *
 * ## 与"授权门控"的关系（口径照 `readNickName` / `writeNickName` 那套）
 *
 * `LocalStore.kv()` 在游客模式（`deny`）下给的是**内存 KV** ⇒ `writeLang()` 会成功写进
 * 内存：本次会话切语言立刻生效，**刷新即丢**，且磁盘上零写入（红线 3）。
 * 这与"写失败时只进内存、刷新即丢"是**两个不同的原因**，别在文案里混成一句话。
 * 宿主那一侧（`src/main.ts` 的 `applyLangChange`）据此选 `too-large` 的提示措辞。
 *
 * ## 谁负责重画
 *
 * `setLang()` 只改内存态并通知订阅者；**重画当前屏是宿主的活**
 * （`src/main.ts` 的 `rerender()` 接缝）。设置小窗自己那点就地改写不算重画：
 * 它由 `settingsOverlayElement()` 的 `applyLang` 做，见那里的注释。
 */
import { EN } from './en';
import { ZH } from './zh';
// ★ 2026-10-02（P5）：引擎 `prompt.title` 的**显示层**替换表（红线不动，只在渲染时换句子）。
// 这一层只认两张表与语言值，不认识本模块的内存态 ⇒ 语言由下面的 `enginePromptTitle()` 注入，不成环。
import { ENGINE_ACTION_KEYS, ENGINE_PROMPT_KEYS, engineActionText, enginePromptText } from './engine-prompt';
// 语言这个值本身的类型与清单住在纯叶子 `lang.ts` 里（理由见那个文件）：`src/app/local-store.ts`
// 也要用它，而纯层不许依赖这一层。这里**转出去**，让消费者只用 import 一个模块。
import { DEFAULT_LANG, isLang, type Lang } from './lang';
export { DEFAULT_LANG, LANGS, isLang, type Lang } from './lang';
// 两张表文件的**源码文本**（`?raw`）。表自检要数"同一个键写了几次" —— 重复键在对象上看不出来
// （后写的静默覆盖先写的），只能数源码。`?raw` 由 Vite 在构建期内联成字符串，因此
// `src/i18n/**` 里不出现 `node:fs`（这一层是产出代码，要进浏览器包）。
import zhRaw from './zh.ts?raw';
import enRaw from './en.ts?raw';

/** 每个键的取值表：键名 -> 语言 -> 值 */
const TABLES: Readonly<Record<Lang, Readonly<Record<string, string>>>> = { zh: ZH, en: EN };

/**
 * 缺键时回退出来的形态。刻意**不是空串**：空串在屏上等于"这里什么都没有"，
 * 而缺键要一眼看得出来是缺键（`⟪settings.title⟫` 比一片空白可诊断得多）。
 */
const MISSING = (key: string): string => `⟪${key}⟫`;

/* ─────────────────────────── 当前语言（模块级内存态） ─────────────────────────── */

let current: Lang = DEFAULT_LANG;

/**
 * 订阅者（`setLang` 之后按注册顺序通知一遍）。
 *
 * 用途只有一个：**让经典脚本（非模块）也能跟着切语言**。本仓的结构里 UI 全部由宿主重画
 * （`rerender()` 接缝），所以现在**没有生产订阅者** —— 这条能力保留着是因为它便宜，
 * 且"切了语言却没人知道"这种缺陷一旦出现很难查。测试会用它断言通知真的发生。
 */
type LangListener = (lang: Lang) => void;
const listeners: LangListener[] = [];

/** 当前语言 */
export function getLang(): Lang {
  return current;
}

/**
 * 切语言（**只改内存态**）。落盘是 `src/app/local-store.ts` 的 `writeLang`，
 * 由宿主决定什么时候写 —— 本函数不认识存储，于是能在 node 下真跑。
 *
 * 顺序是刻意的：先换 `current`，再通知订阅者 —— 订阅者回调里读 `getLang()` 必须已经是新值。
 */
export function setLang(lang: Lang): void {
  if (lang === current) return;
  current = lang;
  for (const fn of [...listeners]) {
    try {
      fn(lang);
    } catch {
      // 订阅者自己炸不该连累别的订阅者与调用方（切语言不是关键路径）
    }
  }
}

/** 订阅语言变化，返回取消订阅的函数 */
export function onLangChange(fn: LangListener): () => void {
  listeners.push(fn);
  return () => {
    const i = listeners.indexOf(fn);
    if (i >= 0) listeners.splice(i, 1);
  };
}

/* ───────────────────────────── 取文案 ───────────────────────────── */

/**
 * 缺键的记录（每个键一次）。**开发态还会往控制台报一遍**；生产态只记在这里，
 * 不抛错、不空串 —— 缺一条标语不该让屏白掉。
 */
const missing = new Set<string>();

/** 已经缺过的键（测试与开发排查用；生产态不消费它） */
export function missingKeys(): string[] {
  return [...missing].sort();
}

/** 测试用：清掉缺键记录（生产路径不会用到，与 `resetFxSettingsForTest` 同款） */
export function resetMissingKeysForTest(): void {
  missing.clear();
}

/**
 * 开发态吗？
 *
 * Vite 会在构建期把 `import.meta.env.DEV` 折成常量（dev=true / build=false）；
 * 测试（vitest）下它也是 `true`。外面套 `try/catch` 只是为了让"这个文件被别的方式加载
 * （没有 `import.meta.env`）"也能跑 —— 那种环境下按生产态处理（安静降级）。
 */
function isDev(): boolean {
  try {
    return import.meta.env.DEV === true;
  } catch {
    return false;
  }
}

function warnMissing(key: string): void {
  missing.add(key);
  if (!isDev()) return;
  // 一个键只报一次（逐屏抽取期间可能一屏里十几个键都缺，不刷屏）
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(`[i18n] 缺文案键：${key}（已回退成 ${MISSING(key)}）；请同时补 src/i18n/zh.ts 与 src/i18n/en.ts`);
}

/** 已经往控制台报过的键（与 `missing` 分开：`missing` 是"缺了哪些"，这里是"报过哪些"） */
const warned = new Set<string>();

/**
 * 取当前语言的文案。
 *
 * @param key 点分键（`'settings.title'`）；键集必须同时存在于两张表里
 * @param params 占位替换：`t('settings.fx.state', { desc, state })` 把 `{desc}` / `{state}`
 *   换成对应值。**只替换出现的占位**，值里的 `{` 不会被再解释一遍（不做递归替换）。
 *   缺的参数保留占位原文 —— 屏上看得见，比悄悄变成空串好查。
 */
export function t(key: string, params?: Readonly<Record<string, string>>): string {
  const value = pick(current, key) ?? pick(DEFAULT_LANG, key);
  if (value === undefined) {
    warnMissing(key);
    return MISSING(key);
  }
  return params === undefined ? value : fill(value, params);
}

/**
 * 先查当前语言、再查中文（**回退链只有这两级**：中文是默认语言，也是唯一一张"必须完整"的表）。
 *
 * ⚠️ 空串**不当命中**：一张表里把值写成 `''` 与缺键同罪（屏上都是空白），
 * 表完整性腿已经禁掉空值，这里再兜一次是为了"绕过那条腿手改表"的情况。
 */
function pick(lang: Lang, key: string): string | undefined {
  const v = TABLES[lang][key];
  return v === undefined || v === '' ? undefined : v;
}

/** `{name}` 形式的占位替换（`String.replace` 的回调形态：值里的 `$&` 之类不会被当替换模式） */
function fill(text: string, params: Readonly<Record<string, string>>): string {
  return text.replace(/\{([A-Za-z0-9_]+)\}/g, (whole, name: string) => {
    const v = params[name];
    return v === undefined ? whole : v;
  });
}

/* ───────────────────── 引擎文案的显示层替换（P5，2026-10-02） ───────────────────── */

/**
 * 引擎给的 `prompt.title` → **显示层**文案。
 *
 *  - 中文：**逐字节返回入参**（引擎原文，构造上不可能回归）；
 *  - 英文：命中模式表（键 `engine.prompt.*`）则输出英文，否则**回退引擎原文**。
 *
 * 这就是"红线不许改引擎文案"与"英文界面不该出现中文"之间的那条缝：
 * 只换**屏幕上的来源**，不改 `state`、不改日志、不改联机指纹。
 * 完整口径（为什么键按语义组织、漂移怎么报红）见 `./engine-prompt` 的头注。
 */
export function enginePromptTitle(title: string): string {
  return enginePromptText(title, current);
}

/** 模式表的键（顺序即匹配顺序）—— 给"完整性腿"用；键集与两张表逐条对应 */
export { ENGINE_PROMPT_KEYS } from './engine-prompt';

/**
 * 选择条**动作按钮**的文字（`act` = 引擎给的 `action:<id>`）。
 *
 * 返回 `''` = "这一层没有对应条目，用引擎原文" —— 调用点据此回退 `actionCn(act, defId)`
 * （中文模式下**恒为 `''`**，所以中文屏上那半个字都没变）。键族见 `ENGINE_ACTION_KEYS`。
 */
export function engineActionButtonText(act: string): string {
  return engineActionText(act, current);
}

/** 动作族的键（顺序即匹配顺序）；键集与两张表逐条对应 */
export { ENGINE_ACTION_KEYS } from './engine-prompt';

/* ─────────────── 写盘失败：原因 → 本地化文案（线上验收 D3） ─────────────── */

/**
 * ★ 2026-10-01（P0，线上验收 D3）：写本机设置失败时的**结构化原因** —— 句子归这一层拼。
 *
 * ## 为什么是数值/枚举而不是"拼好的句子"（D3 第二条的口径）
 *
 * 第一版让纯层（`src/app/storage.ts`）拼一句中文 `detail`（`70021 字节 > 上限 65536 字节`），
 * 界面层照原样透出去 ⇒ **英文界面里出现汉字串，看起来就是坏的**。
 * ⇒ 纯层只给**数**（`bytes` / `limit`）与**原因码**，整句在这里按语言拼：
 *   `70023 字节 > 上限 65536 字节` / `70023 bytes > the 65536-byte limit`。
 *
 * ## 三态（多出来的是"宿主没料到地抛了"那一档）
 *
 *  - `too-large`：**两个数**（`bytes` / `limit`）必给 ⇒ 两种语言下都能把数字带出来；
 *  - `write-failed`：`detail` 是**系统/引擎给的原样消息**（`QuotaExceededError: …`）。
 *    它**不是**我们写的文案，也不翻译（翻了反而丢掉可诊断性）；测试里限定的口径是
 *    "它只能是系统语言（英文），界面自己那半句必须本地化"；
 *  - `threw`：`applyLangChange` 里 `writeLang` **自己抛了**（`kv.get` 抛一类）。
 *    它带的是宿主异常的消息（同样是系统串），原因归类上等同于"后端没写成功"。
 *
 * ⚠️ 刻意**不 import** `src/app/storage.ts` 的类型：`src/i18n/**` 不认识存储
 * （`Lang` 那个叶子是唯一的例外，见 `lang.ts` 的说明），否则这一层没法在 node 下裸跑。
 * 两侧的字段口径由 `tests/i18n/tables.test.ts` 的一条**赋值方向腿**在编译期钉住。
 */
export interface WriteFailure {
  readonly reason: 'too-large' | 'write-failed' | 'threw';
  /** 值超上限时**实际**的字节数（`reason === 'too-large'` 时必有） */
  readonly bytes?: number;
  /** 值超上限时的单条上限（`reason === 'too-large'` 时必有） */
  readonly limit?: number;
  /** **系统给的原样消息**（不是玩家文案、不翻译）；没有就省略 */
  readonly detail?: string;
}

/** 各语言按自己的习惯给数字分组（`70023` → `70,023`） */
function num(lang: Lang, value: number): string {
  try {
    return new Intl.NumberFormat(lang === 'zh' ? 'zh-CN' : 'en-US').format(value);
  } catch {
    return String(value);
  }
}

/**
 * 写盘失败 → 屏上那一句（**整句本地化**：中文界面零英文字母、英文界面零汉字）。
 *
 * 第一版的两条实测缺陷（线上验收 D3）：
 *  1. 宿主写死一句中文兜底（"本机存储拒绝写入（隐私模式或配额已满）"）⇒ 英文界面夹中文；
 *  2. 那句对"值超上限"是**错的** —— 真因在 `writeLang` 回布尔的过程中被丢掉了。
 *
 * 现在的四条句式（都进两张表）：
 *  - 开头：`语言没能保存到本机（…）。本次会话仍然用这种语言，刷新后会回到上次保存的那种。`
 *  - 超上限的原因句：`{bytes} 字节 > 上限 {limit} 字节` / `{bytes} bytes > the {limit}-byte limit`
 *  - 后端拒绝的原因句：`本机存储拒绝了写入（隐私模式或配额已满）。` / `local storage refused the write (private mode or quota).`
 *  - 系统消息（只有它可能是英文）：`技术细节：{detail}` / `Technical detail: {detail}`
 */
export function saveFailedText(failure: WriteFailure): string {
  return `${t('settings.lang.save-failed-detail')} ${failureReasonText(failure)}${systemDetailText((failure.detail ?? '').trim())}`;
}

/** 失败原因那一句（**本地化**；`too-large` 一定把两个数带出来） */
function failureReasonText(failure: WriteFailure): string {
  if (failure.reason === 'too-large') {
    return t('settings.lang.fail.too-large', {
      bytes: num(current, failure.bytes ?? 0),
      limit: num(current, failure.limit ?? 0),
    });
  }
  return t('settings.lang.fail.write-rejected');
}

/** 系统消息那一段（**两种失败共用**；它只可能是系统语言，标出来才不会被当成我们写错的文案） */
function systemDetailText(detail: string): string {
  return detail === '' ? '' : ` ${t('settings.lang.save-failed-tech', { detail })}`;
}

/**
 * ★ 2026-10-01（用户要求"设置里的选项也要持久化"）：**特效开关**写盘失败 → 屏上那一句。
 *
 * 与 `saveFailedText` **同一套形状**（原因那半句 + 系统消息那一段都共用），只有开头半句不同：
 * 语言失败 ⇒ "刷新后会回到上次保存的**那种**"；开关失败 ⇒ "下次进入时会回到上次保存的**状态**"。
 *
 * 为什么不给 `saveFailedText` 加一个"是语言还是开关"的参数：那会把两个键的选择变成运行期
 * 的字符串拼接，而缺键扫描腿只认**静态字面量**（见 `saveFailedText` 的说明）⇒ 各写一个函数、
 * 各自在开头用字面量取键，是唯一能保持机检的形式。
 */
export function saveFailedSwitchText(failure: WriteFailure): string {
  return `${t('settings.fx.save-failed-detail')} ${failureReasonText(failure)}${systemDetailText((failure.detail ?? '').trim())}`;
}

/* ───────────────────────── 启动时读一次已存的语言 ───────────────────────── */

/**
 * 宿主交给本模块的"读一次已存语言"的接缝。
 *
 * 刻意写成注入的**同步**函数而不是 `import { readLang } from '../app/local-store'`：
 *  - `src/i18n/**` 因此不认识 `LocalStore`，`setLang` / `t` 能在 node 下裸跑；
 *  - 读取失败（存储被污染、后端抛错）由注入方自己兜 —— 缺语言就用默认中文，
 *    **一个字都不能让游戏打不开**。
 */
export type StoredLangReader = () => unknown;

/**
 * 启动时接一次本机已存的语言。由 `src/main.ts` 在 `localStore` 造好之后调一次。
 *
 * ⚠️ 时机：这**只是读**（`readJson` 的 `get`），跑在授权弹窗之前的启动路径上也合规 ——
 * "授权之前磁盘零写入"这条红线不受影响。写入仍然只发生在用户切语言那一刻。
 */
export function initI18n(readStored: StoredLangReader): Lang {
  let stored: unknown;
  try {
    stored = readStored();
  } catch {
    stored = undefined; // 读不出来就用默认中文（不抛）
  }
  const next: Lang = isLang(stored) ? stored : DEFAULT_LANG;
  /**
   * 这里**不走 `setLang`**：`setLang` 对"值没变"是空操作，而"存储里是坏值、
   * 需要把它当成默认值"这件事要让订阅者知道（将来有订阅者时才不会留一个旧值在屏上）。
   * 也不做任何写入 —— 坏值就留在那儿，下次用户切语言时会被覆盖掉。
   */
  current = next;
  return next;
}

/* ───────────────────── 表自检（给"表完整性腿"用的机械保障） ───────────────────── */

/**
 * 两张表本身也**转出去**（`src/i18n/index.ts` 是这一层的唯一入口）。
 *
 * 消费者（含测试）需要它来回答"切到 en 之后屏上还有没有中文"这类问题 —— 那要用**整张表**
 * 做判据面。表本身住在 `zh.ts` / `en.ts`（那里是唯一出处），这里只做转出。
 */
export { EN } from './en';
export { ZH } from './zh';

export interface TableDiff {
  /** `en` 有、`zh` 没有的键（英文表里多出来的） */
  readonly onlyInEn: string[];
  /** `zh` 有、`en` 没有的键（漏翻） */
  readonly onlyInZh: string[];
  /** 两条重复键（同一张表里同一个键写了两次 —— 后写的会静默覆盖先写的） */
  readonly duplicates: readonly { readonly table: Lang; readonly key: string }[];
  /** 值为空串 / 只有空白的键 */
  readonly empties: readonly { readonly table: Lang; readonly key: string }[];
}

/**
 * 两张表的差异。全绿 = 四个数组都空。
 *
 * ⚠️ **重复键是这里单独要查的东西**：`Record` 字面量里同一个键写两次，JS 不报错、
 * 后写的赢 —— 那正是"改了一句却没生效"这一类最难查的缺陷，而且键集比对看不出来
 * （键只有一个）。所以扫描的是**源码文本**（`countKeys()` 的出处）而不是对象。
 */
export function diffTables(): TableDiff {
  const zh = new Set(Object.keys(ZH));
  const en = new Set(Object.keys(EN));
  return {
    onlyInEn: [...en].filter((k) => !zh.has(k)).sort(),
    onlyInZh: [...zh].filter((k) => !en.has(k)).sort(),
    duplicates: [
      ...Object.entries(countKeys(zhSourceText())).filter(([, n]) => n > 1).map(([key]) => ({ table: 'zh' as Lang, key })),
      ...Object.entries(countKeys(enSourceText())).filter(([, n]) => n > 1).map(([key]) => ({ table: 'en' as Lang, key })),
    ],
    empties: [
      ...Object.keys(ZH).filter((k) => ZH[k].trim() === '').map((key) => ({ table: 'zh' as Lang, key })),
      ...Object.keys(EN).filter((k) => EN[k].trim() === '').map((key) => ({ table: 'en' as Lang, key })),
    ],
  };
}

/**
 * 从**源码文本**里数每个键出现了几次（`'键': '值'` 的形态）。
 *
 * 为什么不用对象：见 `diffTables()` 的说明（对象看不出重复）。
 * 扫描对象字面量的写法，不解析整份 TS —— 表文件里只有这一类声明，正则够用且不会漂。
 */
function countKeys(source: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const m of source.matchAll(/^\s*'([^']+)'\s*:/gm)) {
    out[m[1]] = (out[m[1]] ?? 0) + 1;
  }
  return out;
}

/** `zh.ts` 的源码文本（表自检要读源码，不只是读对象） */
function zhSourceText(): string {
  return zhRaw;
}

/** `en.ts` 的源码文本 */
function enSourceText(): string {
  return enRaw;
}
