/**
 * 档案的导出 / 导入**纯逻辑**（G3 Task 6；设计稿 §3.3、§3.7）。
 *
 * 本文件零浏览器 API、零 IO：它只做"把 `MatchFile` 变成 (文件名, 文本)"与"把文本变成
 * `ImportOutcome`"两件纯事。真正的对话框与磁盘读写住在 `src/ui/archive-fs-browser.ts`
 * （接口见 `src/app/archive-fs.ts`），Task 7 的屏把它们与这里的纯函数接起来。
 *
 * ## 四条前置判据 + 一条**只警告不拒绝**的检查（全部是纯逻辑，因此可以机检）
 * 1. 空（或纯空白）→ `empty`；
 * 2. **字节数**超过 `MAX_ARCHIVE_BYTES` → `too-large`，且**不做 `JSON.parse`**
 *    ——这一点很重要：超大文件的解析本身就是内存/CPU 炸弹，"先 parse 再判大小"等于没挡；
 * 3. 读文件失败 → `read-failed`（由调用方在 `FileSink`/`FilePicker` 那一层产生，
 *    本模块只把它写进 `ImportOutcome` 的码集，便于 UI 走同一条错误分支；
 *    ⚠️ 本模块**永不产出**这个码，它是给调用方合成的，见 `ImportOutcome` 的注）；
 * 4. 解析失败 → **原样透传** `parseMatchFile` 的 `code`（含 `too-new` 与 `bad-action`）；
 * 5. `createdAt` 不是合法 ISO 形态 → **只往 `warnings` 里加一条**，**照常 `ok: true`**
 *    （G3 Task 6 修复轮 · F5）。理由见 `ISO_INSTANT_SHAPE`：`createdAt` 不影响重放，
 *    而它唯一的下游用途是导出文件名 —— 为本就不影响语义的字段拒绝整份档案是错的方向。
 *
 * ⚠️ 第 2 条的度量单位是**字节**（`TextEncoder`），不是 UTF-16 码元数：`'中'.length === 1`
 * 但它是 3 字节。用 `.length` 判大小会让"3 倍上限的中文档案"整批溜过去，
 * `tests/app/archive-io.test.ts` 有一条专门的多字节腿钉这件事。
 *
 * ## 冲突策略（§3.7 第 4 行；红线 1 的精神：用户数据只增不减）
 * 默认 **`keep-both`**：同名已存在时**自动**给出 `名字-2.json` / `名字-3.json`，
 * **永不覆盖**。`overwrite` 必须由用户显式选择（UI 侧的一次确认），`skip` 用于"我就要这一份"。
 */
import { parseMatchFile, stringifyMatchFile, type MatchFile, type MatchFileErrorCode } from './match-file';

/**
 * 单份档案的**字节**上限 = 8 MiB。
 *
 * 取值理由：一局完整对局的 `actions` 是几百条小对象（每条约 60–120 字节），8 MiB 对应的
 * 规模远超任何真实对局；它挡的是"手滑选了一个几百 MB 的文件"与"被塞进来的巨型文件"，
 * 而不是正常档案。**调大它 = 调大解析炸弹的当量**，改之前先想清楚。
 */
export const MAX_ARCHIVE_BYTES = 8 * 1024 * 1024;

/**
 * `FilePicker.open` 的 `accept` 建议值（**唯一出处**：UI 与浏览器实现都从这里取，
 * 谁都不许再写一份字面量）。
 */
export const ARCHIVE_MIME = 'application/json';
/**
 * 档案扩展名（**唯一出处**：文件名、`accept` 与 FSA 的 `types` 描述都由它派生）。
 *
 * ⚠️ G3 Task 6 修复轮 · F3：上一版浏览器实现里**又**写死了 `'application/json'` 与 `'.json'`
 * 两个副本（评审者把 MIME 改成 `text/plain` 后 19/19 仍全绿 ⇒ 这条"唯一出处"当时**没有牙**）。
 * 现在实现从本文件 `import`，且有一条**生成式**腿断言 blob 的 MIME 与退化文件名后缀
 * **逐字等于**这两个常量。
 */
export const ARCHIVE_EXT = '.json';

/**
 * `createdAt` 不可用（非字符串，或过不了 `ISO_INSTANT_SHAPE`）时的退化时间戳。
 *
 * **可预期**是它唯一的要求：任何输入都给出同一个确定的名字（而不是抛错，也不是让
 * `undefined` 混进文件名）。它只出现在"档案本身已经被写坏"的路上，正常档案走不到这里。
 */
const FALLBACK_STAMP = 'unknown-time';

/**
 * `createdAt` 是不是"看起来像个时刻"的 ISO 形态？
 *
 * 为什么用**形态判据**而不是 `Date.parse`：本模块（`src/app/**`）的纪律是零宿主依赖 ——
 * `Date.parse` 的接受面随宿主实现漂移（`'2026'`、`'Sep 16 2026'`、`'12:34:56'` 都能过），
 * 它还是货真价实的宿主调用，进了纯层就得进 Task 9 的白名单。形态判据是**纯字符串**逻辑：
 * 确定、可机检、跨宿主一致。
 *
 * 判据刻意**不校验日历合法性**（不否掉 `2026-99-99T99:99:99Z`）：这里的目的只是"别让明显
 * 不是时刻的东西静默进文件名"。日历校验属于"拒绝"面，而 `createdAt` **不影响重放**
 * （指纹里它是被替换掉的占位，见 `match-file.ts` 的 `CREATED_AT_OMITTED`），
 * 为一个不影响语义的字段拒绝整份档案是**错的方向**（§3.3 的精神：能警告就警告）。
 */
const ISO_INSTANT_SHAPE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})?$/;

/**
 * 把一段任意输入收敛进**文件名安全字符集** `[A-Za-z0-9_-]`（并按 `maxLen` 截断）。
 *
 * 为什么必须**白名单**而不是"把 `/` 换成 `_`"（黑名单）：本函数的输出会直接进
 * `showSaveFilePicker({ suggestedName })` 与 `<a download>` 的 `download` 属性。黑名单要穷举
 * 的是"宿主认识的分隔符与保留写法"—— `/`、`\`、`..`、Windows 的 `CON`/`NUL`，还有 Unicode 里
 * 的 U+2215 DIVISION SLASH、U+FF0F FULLWIDTH SOLIDUS 这些**规范化变体**；漏一个就产出能穿越
 * 路径的名字。白名单**天然**不含任何分隔符、也不含点号（点被剔除 ⇒ 结构上不可能出现 `..`），
 * 代价只是"空格 / 中文 / emoji 被丢掉"——而那些字符本来就不该由**用户数据**决定。
 */
function safeSegment(v: unknown, maxLen: number): string {
  if (typeof v !== 'string') return '';
  return v.replace(/[^A-Za-z0-9_-]/g, '').slice(0, maxLen);
}

/**
 * 导出文件名：`compile-<seed 前 8 位>-<yyyyMMdd-HHmmss>.compile-match.json`。
 *
 * 时间戳取自 `f.createdAt`（档案自带，**不是 `Date.now()`** —— `src/app` 里连 `Date.now`
 * 都是禁的，见 Task 9 守卫；顺带好处是"同一份档案导出两次同名"，可机检）。
 *
 * ⚠️ `createdAt` 的时区**原样保留**：它是 ISO 串（`...Z`），`replace` 只做字符手术，不换算
 * 本地时区。于是文件名里的时刻与档案里的时刻恒等 —— 跨时区导出同一份档案得到同一个名字。
 * 代价：读名的人要记得它是 UTC（档案本身也是 UTC，两者一致）。
 *
 * ⚠️ **字符手术的真实约束**（G3 Task 6 修复轮 · F11 更正了一句不成立的旧注释）：三步是
 * "先删 `-`/`:`（A）→ 再把 `T` 换成 `-`（T）→ 最后砍掉毫秒（M）"，但**有约束的只有一处**：
 * `T → -` **必须晚于** A —— 否则新插入的那个 `-` 会被 `/[-:]/g` 一起删掉，得到
 * `20260916123456` 而不是 `20260916-123456`。**M 的位置无关紧要**：无论 M 排第几，
 * `2026-09-16T12:34:56.000Z` 都产出 `20260916-123456`（评审者把三步做了全排列实测：
 * 六种排列只产生 **2** 种结果，差别全在 T 是否晚于 A）。旧注释声称"M 必须最后做，否则
 * `.` 会把后面的全吃掉"—— 那句话**不成立**：`\..*$` 只吃首个 `.` 之后，而 `.` 后面本
 * 就只剩毫秒与 `Z`。实现顺序（A→T→M）与计划一致、正确，改的只是注释。
 *
 * ⚠️ **永不抛、永不产出路径分隔符或 `..`**（F5）：`seed` / `createdAt` 都是**档案文本**里的
 * 字段，一份（哪怕只是手写坏的）档案可以把它们填成数字、`'../../etc/passwd'`、`'2026/09/16'`。
 * 零校验的直接后果已由评审者实测：`importArchive(createdAt: 12345)` 之后本函数**抛 TypeError**
 * （数字没有 `.replace`），而 `'2026/09/16 12:34:56'` 会产出**含 `/`** 的文件名 —— FSA 会拒，
 * `<a download>` 的语义则由宿主决定，两种都不能接受。故两个字段都过 `safeSegment`：
 * 非字符串、或整段被剔除时，时间戳退化成 `FALLBACK_STAMP`。
 */
export function archiveFileName(f: MatchFile): string {
  const raw = typeof f.createdAt === 'string' ? f.createdAt : '';
  const stamp = safeSegment(raw.replace(/[-:]/g, '').replace('T', '-').replace(/\..*$/, ''), 20);
  const seed = safeSegment(f.seed, 8);
  return `compile-${seed}-${stamp || FALLBACK_STAMP}.compile-match${ARCHIVE_EXT}`;
}

/** 档案 → 落盘用的 (文件名, 文本)。文本就是 `stringifyMatchFile`（稳定序列化，键排序）。 */
export function exportArchive(f: MatchFile): { name: string; text: string } {
  return { name: archiveFileName(f), text: stringifyMatchFile(f) };
}

/**
 * 导入结果。**判别式联合**（`ok` 是判别键）：
 *  - 成功时带 `warnings`（**警告并允许打开**：卡牌指纹不一致、`createdAt` 不是 ISO 形态…
 *    §3.3 第 3 条）与 `raw`（**原文**，调用方需要"原样再存回去"时不至于拿到被规范化的版本）；
 *  - 失败时 `code` 是 `MatchFileErrorCode` **加上**本模块自己的三个码
 *    （`too-large` / `empty` / `read-failed`）。UI 对每个码给不同文案，所以码集必须完整。
 *
 * ⚠️ `read-failed` 的出处（G3 Task 6 修复轮 · 评审偏差 #6 的更正）：**本模块永不产出它**。
 * 它留在 union 里是因为计划 `docs/…G3…:2126` 明写它在码集内，且调用方（Task 7 的屏在
 * `FilePicker.text()` / 真实读盘那一层）读到"文件读不出来"时**合成**这个码 —— 于是 UI 的
 * `switch (code)` 只需写一次，不必再有一条独立的"读盘异常"分支。谁把本模块改成在这里
 * 产出 `read-failed`（例如自己 catch 住读盘），那是**重复实现调用方的职责**。
 */
export type ImportOutcome =
  | { ok: true; file: MatchFile; warnings: string[]; raw: string }
  | { ok: false; code: MatchFileErrorCode | 'too-large' | 'empty' | 'read-failed'; message: string };

/**
 * 把一段**档案文本**读成 `ImportOutcome`。
 *
 * 判据顺序（**有意的**，见文件头注）：空白 → `empty`；字节数超限 → `too-large`；
 * 否则交给 `parseMatchFile` 并透传其 `code`。`currentHash` = 本机 `CARD_DATA_HASH`。
 *
 * 本函数**不读盘、不写盘**：调用方负责"读到文本"与"按 `resolveConflict` 的结果写盘"。
 * 失败时**一个字节都不写**（红线 1 的机检形态在 Task 7 的屏上）。
 *
 * ⚠️ `createdAt` 不是合法 ISO 形态时**只警告、不拒绝**（F5）：`createdAt` 不参与重放，
 * 它唯一的下游用途是 `archiveFileName` 里的时间戳；`archiveFileName` 已能对**任何**输入
 * 给出安全名，因此这里没有任何理由拒绝整份档案。
 */
export function importArchive(text: string, opts: { currentHash: string }): ImportOutcome {
  if (text.trim().length === 0) return { ok: false, code: 'empty', message: '档案文件是空的' };
  const bytes = new TextEncoder().encode(text).length;
  if (bytes > MAX_ARCHIVE_BYTES) {
    return {
      ok: false,
      code: 'too-large',
      message: `档案过大（${bytes} 字节 > 上限 ${MAX_ARCHIVE_BYTES} 字节）：本程序不会读取它`,
    };
  }
  const r = parseMatchFile(text, opts);
  if (!r.ok) return { ok: false, code: r.error.code, message: r.error.message };
  const warnings = r.warnings.slice();
  if (typeof r.file.createdAt !== 'string' || !ISO_INSTANT_SHAPE.test(r.file.createdAt)) {
    warnings.push(
      `档案的 createdAt 不是合法 ISO 时刻（${JSON.stringify(r.file.createdAt)}）：` +
        `导出的文件名会退化成含 "${FALLBACK_STAMP}" 的可预期形式。这不影响重放，档案仍会打开。`,
    );
  }
  return { ok: true, file: r.file, warnings, raw: text };
}

/**
 * 在 `desired` 已被占用时给出第一个可用的 `茎-N.ext`（N 从 **2** 起）。
 *
 * 语义（三条，逐条有机检）：
 *  1. `desired` 空闲 ⇒ **原样返回**（不加后缀 —— 常见的导出不该多一个 `-2`）；
 *  2. 被占用 ⇒ 从 2 **往上**找第一个空闲的（**填空洞**：已有 `a.json` 与 `a-3.json` 时给出
 *     `a-2.json`，而不是跳到 `a-4.json`）；
 *  3. 无扩展名（`lastIndexOf('.') <= 0`）时后缀直接缀在末尾（`a` → `a-2`）；
 *     **开头就是点**的隐藏文件（`.env`）按"无扩展名"处理（`.env` → `.env-2`），
 *     因为把 `.env` 拆成 `'' + '.env'` 会生成 `-2.env` 这种明显不是人想要的名字。
 *
 * 无限循环的安全性：`existing` 是**有限**数组，候选名两两不同 ⇒ 至多 `existing.length + 1`
 * 步必然命中一个空闲名（$`i` 走完所有已占用的序号）。故不存在"名字用光"的死循环。
 */
export function nextArchiveName(existing: readonly string[], desired: string): string {
  if (!existing.includes(desired)) return desired;
  const dot = desired.lastIndexOf('.');
  const stem = dot > 0 ? desired.slice(0, dot) : desired;
  const ext = dot > 0 ? desired.slice(dot) : '';
  for (let i = 2; ; i += 1) {
    const cand = `${stem}-${i}${ext}`;
    if (!existing.includes(cand)) return cand;
  }
}

/** 同名档案已存在时的处置策略。默认 `keep-both`（**不覆盖**是安全默认）。 */
export type ConflictStrategy = 'keep-both' | 'overwrite' | 'skip';

/**
 * 冲突裁决（**纯函数**，不碰磁盘）：给定"已有的名字"与"想要的名字"，返回该做什么。
 *
 * | 情形 | `keep-both`（默认） | `overwrite` | `skip` |
 * |---|---|---|---|
 * | `desired` 空闲 | write `desired` | write `desired` | write `desired` |
 * | `desired` 被占用 | write `nextArchiveName(...)` | write `desired`（**覆盖**） | skip `desired` |
 *
 * ⚠️ 三处都必须先判"空闲"：`skip` 在**没有**冲突时也要写（否则"导入一份新档案"会被静默丢掉
 * —— 那是最糟的假成功）。`resolveConflict` 的返回**永远**是 `write` 或 `skip`，没有第三种动作：
 * 它不做删除、不做重命名已有文件。
 */
export function resolveConflict(
  existing: readonly string[],
  desired: string,
  strategy: ConflictStrategy,
): { action: 'write'; name: string } | { action: 'skip'; name: string } {
  if (!existing.includes(desired)) return { action: 'write' as const, name: desired };
  if (strategy === 'overwrite') return { action: 'write' as const, name: desired };
  if (strategy === 'skip') return { action: 'skip' as const, name: desired };
  return { action: 'write' as const, name: nextArchiveName(existing, desired) };
}
