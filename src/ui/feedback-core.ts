/**
 * ★ 2026-10-01（用户要求）：「反馈」功能的**纯逻辑核**（无 DOM、无网络）。
 *
 * ## 用户原话要点（2026-10-01，逐条落地到本文件）
 *
 * 1. 「首页左上角加一个「反馈」按钮」⇒ 入口在 `src/ui/home.ts` 的 `renderHome`（本文件不含 UI）。
 * 2. 「点开后有**两种操作**：① 投稿自定义协议 ② bug 反馈」⇒ `FEEDBACK_KINDS` 两档。
 * 3. 两者填写格式一样：简要标题 / 投稿人（反馈人）/ 说明文本（bug 现象或反馈意见）。
 * 4. 「可选附件：常见图片（pdf/jpg/png…）或常见文本（txt/markdown…）」⇒ `FEEDBACK_ACCEPT`。
 * 5. 「每份 ≤10MB」⇒ `FEEDBACK_MAX_FILE_BYTES`。
 * 6. 「每个 IP 每天最多 5 份文件（这一条由服务端强制，前端只做提示与本地预检）」
 *    ——⚠️ 这句是**用户 2026-10-01 最初的原话**，当天稍后他改了口径（见下一节第 1 条）：
 *    现在是"**每天最多提交 5 份**"（按提交次数，不按附件个数）。
 *    ⇒ `FEEDBACK_MAX_FILES` 只做**本地预检**，真正的上限仍由服务端的 429 兜底
 *    （那句中文原因必须原样显示，见 `src/ui/feedback-screen.ts`）。
 *
 * ## ★ 2026-10-01 用户改口径（追加，两条）
 *
 *  1. **限额口径**：从"**每天最多 5 个文件**"改成"**每天最多提交 5 份**"（按**提交次数**算，
 *     不按附件个数）。这条限额**由服务端强制**，前端从不自己写这句话 —— 前端只把服务端 429
 *     里那句中文原因**原样**显示（`tests/ui/feedback-screen.test.ts` 有一条腿钉着"一个字符都不改"）。
 *     ⇒ 前端要改的只有"提到它的注释/夹具措辞"；**每次提交最多几个附件（`FEEDBACK_MAX_FILES`）
 *     是另一件事，用户明确要求保持不变**（那是单次提交的附件上限，不是每天的提交次数）。
 *  2. **提交成功后的行为**：状态行先出现「提交成功」，**随后自动关闭浮层**（＝回到首页，因为
 *     浮层挂在首页之上）⇒ `FEEDBACK_SUBMIT_OK_TEXT` / `FEEDBACK_SUCCESS_CLOSE_MS`。
 *
 * ## 为什么把它单独放一个文件
 *
 * 这些判断（大小 / 份数 / 必填 / 徽章文案）是**唯一出处**：DOM 那一层（`feedback-screen.ts`）
 * 与测试都读同一份常量与同一个函数。写在 DOM 层里的话，"10MB"这个数字会在
 * 「预检」「提示文案」「测试」三处各出现一次，改一处就漂。
 *
 * 本文件**不引任何浏览器 API**，因此能在 vitest（node 环境）里直接 import。
 *
 * ★ 2026-10-02（i18n 逐屏抽取）：本文件里**玩家可见的那几句**搬进 `src/i18n/`（键 `feedback.*`），
 * 中文值**逐字等于改动前**的字面量。形态上分了两种，都是有意的：
 *
 *  1. **两档切换的标签**（`FEEDBACK_KIND_LABELS` / `..._BADGES` / `..._AUTHOR_LABELS` /
 *     `..._BODY_LABELS` / `..._BODY_PLACEHOLDERS`）：由**导出的常量表**改成**现调 `t()` 的函数**
 *     （`feedbackKindLabels()` …）。常量表在模块加载时就把语言钉死了，而屏上那两档必须跟着
 *     当前语言走；函数形态同时让"值只有一个家"这条纪律成立（表里没有第二份中文）。
 *  2. **纯函数里拼出来的句子**（必填提示 / 附件预检 / 读数）：本来就在函数体里，直接把字面量
 *     换成 `t('…')` 即可。
 *
 * ⚠️ **服务端给的中文原因不进表**（`serverErrorText()` 只负责"读出来"）：那是服务端的读数，
 * 用户明确要求**原样显示**（`tests/ui/feedback-screen.test.ts` 有一条腿钉着"一个字符都不改"）。
 */
import { t } from '../i18n';

/** 两种操作的机器值（与服务端契约 `kind` 字段逐字对齐：`protocol` | `bug`） */
export type FeedbackKind = 'protocol' | 'bug';

/** `kind` 的两档（顺序 = 屏上两个切换按钮的顺序，也是测试遍历的来源） */
export const FEEDBACK_KINDS: readonly FeedbackKind[] = ['protocol', 'bug'];

/**
 * 两档在屏上的名字（用户原话：「投稿自定义协议」「bug 反馈」）。
 *
 * ★ 2026-10-02（i18n）：**现调 `t()` 的函数**（原来是导出的常量表）—— 理由见文件头注第 1 条。
 * 中文值在 `zh.ts` 里**逐字等于改动前**的 `投稿自定义协议` / `bug 反馈`。
 */
export function feedbackKindLabels(): Readonly<Record<FeedbackKind, string>> {
  return { protocol: t('feedback.kind.protocol'), bug: t('feedback.kind.bug') };
}

/** 卡片上那个小徽章的文案（比按钮文案短一档，卡里放得下）。★ 2026-10-02：现调 `t()` */
export function feedbackKindBadges(): Readonly<Record<FeedbackKind, string>> {
  return { protocol: t('feedback.badge.protocol'), bug: t('feedback.badge.bug') };
}

/**
 * 「投稿人」这个字段在两档下的**标题**（用户原话：投稿自定义协议叫"投稿人"，bug 反馈叫"反馈人"）。
 * 字段名在契约里是同一个 `author`，只有屏上那行标签换字。★ 2026-10-02：现调 `t()`
 */
export function feedbackAuthorLabels(): Readonly<Record<FeedbackKind, string>> {
  return { protocol: t('feedback.author.protocol'), bug: t('feedback.author.bug') };
}

/** 「说明文本」那个多行框在两档下的标题（用户原话：协议与卡牌的说明文本 / 具体的 bug 现象或反馈意见）。★ 现调 `t()` */
export function feedbackBodyLabels(): Readonly<Record<FeedbackKind, string>> {
  return { protocol: t('feedback.body.protocol'), bug: t('feedback.body.bug') };
}

/** 多行框里的灰字提示（与上面那行标签配套）。★ 2026-10-02：现调 `t()` */
export function feedbackBodyPlaceholders(): Readonly<Record<FeedbackKind, string>> {
  return { protocol: t('feedback.body-placeholder.protocol'), bug: t('feedback.body-placeholder.bug') };
}

/**
 * 附件选择框的 `accept`：常见图片（含 pdf）+ 常见文本。
 *
 * 用户原话：「常见图片（pdf/jpg/png…）或常见文本（txt/markdown…）」。
 * 它只是给浏览器的**过滤提示**（用户可以选"所有文件"绕开），所以服务端仍要自己校验类型
 * （415 那条就是它）。
 */
export const FEEDBACK_ACCEPT: readonly string[] = [
  '.pdf', '.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp',
  '.txt', '.md', '.markdown', '.log', '.csv', '.json',
];

/** 单份附件的上限：10MB（用户原话「每份 ≤10MB」；10 * 1024 * 1024） */
export const FEEDBACK_MAX_FILE_BYTES = 10 * 1024 * 1024;

/**
 * **一次提交**最多带几份附件（契约：`files` 0..5）。
 *
 * ⚠️ 这与"每天最多提交几份"（服务端按 IP 强制的那条）**是两件事**：
 *  - 本常量 = **单次提交的附件个数上限**，由前端做本地预检（用户 2026-10-01 明确要求**保留不变**）；
 *  - 每天那条 = **提交次数**上限（服务端强制，前端从不自己写这句话、只原样显示服务端的中文原因）。
 * 用户当天把后者的口径从"每天最多 5 个文件"改成了"**每天最多提交 5 份**"——改的是后者那个数字
 * 的含义，不是本常量。两件事混起来读会让这条预检被误删/误改，所以并排写在这里。
 */
export const FEEDBACK_MAX_FILES = 5;

/**
 * 提交成功后状态行里那句结论的**前四个字**（用户 2026-10-01 改口径时的原话：「显示「提交成功」」）。
 *
 * ★ 2026-10-02（i18n）：改成**现调 `t()` 的函数**（原来是导出常量）。
 * 屏上的整句是 `${FEEDBACK_SUBMIT_OK_TEXT}。编号：${id}` —— 那个句号与"编号："也进表了
 * （键 `feedback.submit.ok-tail`），所以屏上那句话现在是两段拼的，**没有第二份中文**。
 */
export function feedbackSubmitOkText(): string {
  return t('feedback.submit.ok');
}

/**
 * 提交成功后**停留多久再自动关闭浮层**（毫秒）。
 *
 * 用户 2026-10-01 原话：「**随后自动关闭浮层**（短延迟让用户看得见，建议 1.0~1.5 秒）」。
 * 取 **1200ms**：落在那句建议的区间正中，够看清「提交成功」四个字，又不会让人觉得卡住了。
 * ⚠️ 它只负责"多久"，**清理**由调用方那侧保证（见 `feedback-screen.ts` 的
 * `FeedbackFormHandle.cancelAutoClose`）——关掉浮层之后那个定时器绝不能再碰 DOM。
 */
export const FEEDBACK_SUCCESS_CLOSE_MS = 1200;

/** 三行必填（标题 / 投稿人 / 正文）里哪一行是空的 ⇒ 用来在屏上标红（空数组 = 都填了） */
export interface FeedbackMissing {
  readonly title: boolean;
  readonly author: boolean;
  readonly body: boolean;
}

/**
 * 必填校验（纯函数）。返回**缺了哪几行**，而不是一句人话 —— 屏上要按行标红，
 * 而人话那句由屏自己拼（`feedbackMissingText`）。
 */
export function missingFields(input: {
  readonly title: string;
  readonly author: string;
  readonly body: string;
}): FeedbackMissing {
  return {
    title: input.title.trim() === '',
    author: input.author.trim() === '',
    body: input.body.trim() === '',
  };
}

/** 有没有缺项 */
export function hasMissing(m: FeedbackMissing): boolean {
  return m.title || m.author || m.body;
}

/**
 * 「还差什么」那句话（屏上的失败提示）。
 *
 * 三种都缺时**逐个点名**（不说"请填写完整"这种等于没说的话）；一个都不缺 ⇒ 空串
 * （调用方据此知道"不该提示"）。
 */
export function feedbackMissingText(m: FeedbackMissing): string {
  const names: string[] = [];
  if (m.title) names.push(t('feedback.missing.title'));
  if (m.author) names.push(t('feedback.missing.author'));
  if (m.body) names.push(t('feedback.missing.body'));
  if (names.length === 0) return '';
  return t('feedback.missing.line', { names: names.join(t('feedback.missing.sep')) });
}

/** 本地预检要看的最小文件信息（`File` 与测试夹具都满足它） */
export interface FeedbackFileInfo {
  readonly name: string;
  readonly size: number;
}

/** 某一档附件选择的结果（`kept` = 允许提交的，`rejected` = 当场拒掉的） */
export interface FeedbackFileSelection<T extends FeedbackFileInfo> {
  /** 通过预检的（按用户选择的原顺序） */
  readonly kept: readonly T[];
  /** 单份超过 10MB 被当场拒掉的 */
  readonly rejected: readonly T[];
  /** 预检结论，直接显示给用户（空串 = 不用说什么） */
  readonly notice: string;
  /** 被截掉的数量（选了超过 5 份时，多出来的那份数） */
  readonly droppedCount: number;
}

/**
 * 附件预检（纯函数，唯一出处）：
 *  1. 单份 > 10MB ⇒ **当场拒绝**（进 `rejected`，不会进表单）；
 *  2. 通过 ① 之后超过 5 份 ⇒ **只留前 5 份**，多出来的给一句提示
 *     （服务端还会按"**每天最多提交 5 份**"再拦一次 —— 那条按**提交次数**算，与这里的
 *     "单次附件个数"不是同一个数；这里只是先把话说清楚）。
 *
 * 两句话都返回在 `notice` 里（可能两句都有）；没有问题时空串。
 */
export function checkFileSelection<T extends FeedbackFileInfo>(
  files: readonly T[],
): FeedbackFileSelection<T> {
  const kept: T[] = [];
  const rejected: T[] = [];
  for (const f of files) {
    if (f.size > FEEDBACK_MAX_FILE_BYTES) rejected.push(f);
    else kept.push(f);
  }
  const dropped = kept.length > FEEDBACK_MAX_FILES ? kept.slice(FEEDBACK_MAX_FILES) : [];
  const finalKept = dropped.length === 0 ? kept : kept.slice(0, FEEDBACK_MAX_FILES);

  const lines: string[] = [];
  if (rejected.length > 0) {
    const names = rejected.map((f) => f.name).join(t('feedback.attach.sep'));
    lines.push(t('feedback.attach.too-large', {
      names,
      // ⚠️ 这里写的是**玩家读到的那个形态**（`10MB`），与 `formatBytes()` 的 `10.0 MB` 不同：
      //    改动前那句字面量就是 `10MB`（既有测试逐字钉着它），所以它按"文案"住在表里，
      //    而**上限这个数**仍然只有一个出处（`FEEDBACK_MAX_FILE_BYTES`，`formatBytes` 那条腿钉它）。
      size: '10MB',
    }));
  }
  if (dropped.length > 0) {
    lines.push(t('feedback.attach.over-count', {
      max: String(FEEDBACK_MAX_FILES),
      dropped: String(dropped.length),
    }));
  }
  return { kept: finalKept, rejected, notice: lines.join(' '), droppedCount: dropped.length };
}

/**
 * 附件大小的中文读数（详情页与列表用；服务端只给字节数）。
 *
 * 1024 进制，保留一位小数（`10.0 MB` 这种）；小于 1KB 直接给字节数 —— 不写"0.0 KB"。
 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return t('feedback.bytes.unknown');
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(1)} ${units[i]}`;
}

/** 提交用的附件：多带一个 `file` 给 `FormData`（DOM 层用），也满足 `FeedbackFileInfo` */
export interface FeedbackAttachment {
  readonly name: string;
  readonly size: number;
  /** `FormData.append('files', …)` 要的原件（浏览器里的 `File`；测试里给哨兵对象） */
  readonly file: Blob;
}

/**
 * 服务端时间戳 → 屏上那句时间。
 *
 * 契约里是 `createdAt`（服务端给），形状没有钉死（ISO 串或毫秒数都当合法）。
 * 两种都认；都不认就**原样回显**（宁可显示一串看不懂的，也不要显示空白或 "Invalid Date"）。
 */
export function formatCreatedAt(raw: string | number | null | undefined): string {
  if (raw === null || raw === undefined || raw === '') return t('feedback.time.unknown');
  const d = typeof raw === 'number' ? new Date(raw) : new Date(raw);
  if (Number.isNaN(d.getTime())) return String(raw);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} `
    + `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * 请求元信息（`FeedbackFetcher.fetch` 的第五个参数）。
 *
 * ## 为什么把它单独传一遍（而不是让抓取层从 `FormData` 里挖）
 *
 * `FormData` 的条目**不可枚举**（浏览器里只能 `get`/`getAll` 逐个键去取，且取到的是 `File`
 * 或字符串），于是"抓取层/桩"要把表单内容读出来得先知道有哪些键 —— 那就等于把实现细节
 * 复制进测试。把"这次请求带的是什么"显式交出去，测试断言的才是**这次请求的内容本身**，
 * 而不是"我猜它塞进了 FormData 的哪个键"。
 */
export interface FeedbackRequestInfo {
  readonly kind: FeedbackKind;
  readonly title: string;
  readonly author: string;
  readonly body: string;
  readonly files: readonly FeedbackFileInfo[];
}

/**
 * 抓取层（可注入）。
 *
 * 生产实现就是浏览器自带的 `fetch`（`src/main.ts` 注入）。可注入的理由与本仓既有的
 * `FilePicker` / `FileSink`（`src/app/archive-fs.ts`）一致：**屏要能在无 jsdom 的 node 里
 * 真跑**，而"发一次请求"这件事在 node 里没有浏览器实现。
 *
 * ⚠️ 前端**拿不到也存不了 token**（契约：登录成功下发 HttpOnly Cookie）⇒ 这里只有
 * `credentials: 'same-origin'`，浏览器自己带 Cookie，前端不碰任何凭据。
 */
export interface FeedbackFetcher {
  /**
   * 形参 `body` 是 `BodyInit | null`：提交那条发 `FormData`，登录那条发 JSON 的 `Blob`。
   * `null` = GET（不带请求体）。
   */
  fetch(
    method: 'GET' | 'POST',
    url: string,
    body: BodyInit | null,
    credentials: 'same-origin',
    info: FeedbackRequestInfo | null,
  ): Promise<Response>;
}

/** 把浏览器 `fetch` 包成 `FeedbackFetcher`（唯一一处 `credentials` 的出处） */
export const browserFeedbackFetcher: FeedbackFetcher = {
  fetch: (method, url, body, credentials) =>
    fetch(url, body === null ? { method, credentials } : { method, body, credentials }),
};

/**
 * 契约里的三条 GET 路径与两条 POST 路径（**唯一出处**，屏与测试都读这里）。
 * 同源相对路径 ⇒ 自动带上同源 Cookie。
 */
export const FEEDBACK_ENDPOINTS = {
  submit: '/feedback/submit',
  login: '/feedback/login',
  list: '/feedback/list',
  item: '/feedback/item',
  file: '/feedback/file',
  /** ★ 2026-10-01 追加：标记已读 / 标回未读（`{ id, read }`） */
  read: '/feedback/read',
  /** ★ 2026-10-01 追加：删除（移入回收站；`{ id }`） */
  delete: '/feedback/delete',
} as const;

/** 附件下载 / 打开的地址（`<a href>` 直接用；浏览器会自己带 Cookie） */
export function feedbackFileHref(id: string, name: string): string {
  return `${FEEDBACK_ENDPOINTS.file}?id=${encodeURIComponent(id)}&name=${encodeURIComponent(name)}`;
}

/** 详情地址（`GET /feedback/item?id=<id>`） */
export function feedbackItemHref(id: string): string {
  return `${FEEDBACK_ENDPOINTS.item}?id=${encodeURIComponent(id)}`;
}

/**
 * 服务端错误里的中文原因要**原样显示**（用户明确要求，尤其 429 那句"今天已达上限"）。
 * 这里只做"读出来"，**不改一个字**（不裁剪、不加前缀）。
 */
export function serverErrorText(json: unknown, fallback: string): string {
  if (json !== null && typeof json === 'object') {
    const err = (json as { error?: unknown }).error;
    if (typeof err === 'string') return err;
  }
  return fallback;
}

/**
 * 列表项（`GET /feedback/list` 的 `items` 元素）。
 *
 * ★ 2026-10-01（用户追加需求：「隐藏页想加删除/标记已读」）：契约多返回了 `read` / `readAt`
 * —— 这里补上。**向后兼容**：字段缺席时 `read` 当 `false`（未读）、`readAt` 当空串
 * （服务端还没上这两个字段时，屏上照旧能画，只是全按未读显示）。
 */
export interface FeedbackListItem {
  readonly id: string;
  readonly kind: FeedbackKind;
  readonly title: string;
  readonly author: string;
  readonly createdAt: string;
  readonly fileCount: number;
  /** 是否已读（缺席 = 未读） */
  readonly read: boolean;
  /** 标为已读的时刻（缺席 = 空串；屏上目前不显示它，留着给将来的排序/筛选） */
  readonly readAt: string;
}

/** 详情里的附件（`GET /feedback/item` 的 `files` 元素；只有名字与大小，字节要另开地址取） */
export interface FeedbackFileMeta {
  readonly name: string;
  readonly size: number;
}

/** 详情（`GET /feedback/item` 的 `item`）：契约里的 `...meta` + `files` */
export interface FeedbackDetail extends FeedbackListItem {
  readonly body: string;
  readonly files: readonly FeedbackFileMeta[];
}

/**
 * 列表的读数（`GET /feedback/list` 的整个响应体）。
 *
 * ★ 2026-10-01 追加：契约现在额外返回 `unread`（未读数）与 `total`（总条数）。
 * 两个字段**缺席时按 `items` 自己算**（总条数 = `items.length`、未读 = 其中 `read === false`
 * 的条数）—— 这样服务端那一半还没上这两个字段时，屏上的读数也**不会说谎**。
 */
export interface FeedbackListPage {
  readonly items: readonly FeedbackListItem[];
  /** 未读条数（顶部"共 N 条 · 未读 M 条"里的 M） */
  readonly unread: number;
  /** 总条数（顶部那句话里的 N） */
  readonly total: number;
}

/* ────────────────────── 响应读数（宽松、但不猜） ────────────────────── */

/** `{ ok: true, id }` */
export interface SubmitOk { readonly ok: true; readonly id: string; }
/** `{ ok: false, error: '中文原因' }` */
export interface SubmitFail { readonly ok: false; readonly error: string; }
export type SubmitReading = SubmitOk | SubmitFail;

/**
 * 读 `POST /feedback/submit` 的响应体。
 *
 * 成功判定**只看 `ok === true` 且 `id` 是字符串**（契约如此）；其余（含 4xx/5xx 的
 * `{ ok:false, error }`、以及不认识的东西）都归到失败，失败时**一定有一句话**给用户看。
 */
export function readSubmit(json: unknown, fallback: string): SubmitReading {
  if (json !== null && typeof json === 'object') {
    const o = json as { ok?: unknown; id?: unknown };
    if (o.ok === true && typeof o.id === 'string') return { ok: true, id: o.id };
  }
  return { ok: false, error: serverErrorText(json, fallback) };
}

/** 读 `POST /feedback/login` 的响应体（只看 `ok === true`） */
export function readLoginOk(json: unknown): boolean {
  return json !== null && typeof json === 'object'
    && (json as { ok?: unknown }).ok === true;
}

/** 读 `{ ok: true, items: [...] }`；不认的形状返回 `null`（调用方当失败处理，不猜） */
export function readList(json: unknown): FeedbackListPage | null {
  if (json === null || typeof json !== 'object') return null;
  const o = json as { ok?: unknown; items?: unknown; unread?: unknown; total?: unknown };
  if (o.ok !== true || !Array.isArray(o.items)) return null;
  const items = o.items.map(normalizeListItem);
  const computedUnread = items.filter((it) => !it.read).length;
  const unread = typeof o.unread === 'number' && Number.isFinite(o.unread) ? o.unread : computedUnread;
  const total = typeof o.total === 'number' && Number.isFinite(o.total) ? o.total : items.length;
  return { items, unread, total };
}

/**
 * 读 `POST /feedback/read` 与 `POST /feedback/delete` 的响应体。
 *
 * 两条都只有两种结果：成功（`ok === true`）或失败（带一句中文原因）。契约里没写这条的
 * 成功体字段 ⇒ **只看 `ok === true`**，不多要求别的字段。
 */
export type ActionReading = { readonly ok: true } | { readonly ok: false; readonly error: string };

export function readActionOk(json: unknown, fallback: string): ActionReading {
  if (json !== null && typeof json === 'object' && (json as { ok?: unknown }).ok === true) {
    return { ok: true };
  }
  return { ok: false, error: serverErrorText(json, fallback) };
}

/** 顶部那句读数："共 N 条 · 未读 M 条"（唯一出处；标记已读/删除后就地改它）。★ 2026-10-02：现调 `t()` */
export function feedbackCountText(page: { readonly total: number; readonly unread: number }): string {
  return t('feedback.count', { total: String(page.total), unread: String(page.unread) });
}

/** 读 `{ ok: true, item: {...} }`；不认的形状返回 `null` */
export function readItem(json: unknown): FeedbackDetail | null {
  if (json === null || typeof json !== 'object') return null;
  const o = json as { ok?: unknown; item?: unknown };
  if (o.ok !== true || o.item === null || typeof o.item !== 'object') return null;
  const raw = o.item as Record<string, unknown>;
  const meta = normalizeListItem(raw);
  const files: FeedbackFileMeta[] = Array.isArray(raw.files)
    ? raw.files
      .filter((f): f is Record<string, unknown> => f !== null && typeof f === 'object')
      .map((f) => ({
        name: typeof f.name === 'string' ? f.name : '',
        size: typeof f.size === 'number' ? f.size : 0,
      }))
    : [];
  return {
    ...meta,
    body: typeof raw.body === 'string' ? raw.body : '',
    files,
  };
}

/**
 * 把一个来路不明的条目**逐字段收窄**成 `FeedbackListItem`。
 *
 * 认不出 `kind` 时归到 `'bug'`（徽章显示为 bug 反馈）是**有意的降级**：宁可徽章不完全准，
 * 也不要因为一个没见过的 kind 让整页列表崩掉（这条不会隐藏数据 —— 标题/作者/时间照显）。
 */
function normalizeListItem(raw: Record<string, unknown>): FeedbackListItem {
  const kind: FeedbackKind = raw.kind === 'protocol' ? 'protocol' : 'bug';
  return {
    id: typeof raw.id === 'string' ? raw.id : '',
    kind,
    title: typeof raw.title === 'string' ? raw.title : '',
    author: typeof raw.author === 'string' ? raw.author : '',
    createdAt: typeof raw.createdAt === 'string' || typeof raw.createdAt === 'number'
      ? String(raw.createdAt)
      : '',
    fileCount: typeof raw.fileCount === 'number' ? raw.fileCount : 0,
    read: raw.read === true,
    readAt: typeof raw.readAt === 'string' || typeof raw.readAt === 'number'
      ? String(raw.readAt)
      : '',
  };
}

/**
 * 一句话人话：**本机连不上反馈服务**时给用户看的（本地 dev 上服务本来就不存在）。
 *
 * 用户要求"不依赖服务端也能给出可读的失败信息……提示'当前环境没有反馈服务'这类人话，
 * 不要抛未捕获异常"⇒ 网络层的 `TypeError`（fetch 拒连）与"响应不是 JSON"都归到这一句。
 *
 * ★ 2026-10-02（i18n）：由**导出的常量**改成**现调 `t()` 的函数**（理由见文件头注第 1 条）。
 */
export function feedbackOfflineText(): string {
  return t('feedback.offline');
}

/** `GET` 失败（非 401）时给用户看的那句默认话（服务端给了中文原因时优先用它的）。★ 现调 `t()` */
export function feedbackReadFailText(): string {
  return t('feedback.read-fail');
}

/**
 * **会话过期（401）**时退回口令框、写在口令框状态行上的那句话。
 *
 * ★ 2026-10-01 追加。为什么需要它：`401` 的四条通路（列表 / 详情 / 标记已读 / 删除）都是
 * "正在看列表，突然变成让我输口令"——没有这句的话用户不知道发生了什么。
 * 服务端在 401 上给的是 `未登录`（三个字，太干），屏上另写一句人话更好读。
 * ★ 2026-10-02（i18n）：现调 `t()`。
 */
export function feedbackSessionExpiredText(): string {
  return t('feedback.session-expired');
}

/** 口令不对时的默认话（服务端 401 给的是「密码不对」，原样优先）。★ 2026-10-02：现调 `t()` */
export function feedbackPasswordFailText(): string {
  return t('feedback.password-fail');
}

/**
 * 一次请求的结果：要么拿到 `json`，要么带着一句**给用户看的话**。
 *
 * `status` 留 0 表示"根本没连上"（网络层失败），调用方据此区分"未登录"与"没有服务"。
 */
export type FetchOutcome =
  | { readonly ok: true; readonly status: number; readonly json: unknown }
  | { readonly ok: false; readonly status: number; readonly text: string };

/**
 * 发一次请求并把响应体读成 JSON（**唯一**的 try/catch 所在）。
 *
 * 三种失败都收敛成"一句人话"，屏上不会出现未捕获异常：
 *  1. 抓取层自己抛（fetch 拒连 / 桩炸了）⇒ `FEEDBACK_OFFLINE_TEXT`；
 *  2. 响应体不是 JSON（代理返回 HTML 错误页之类）⇒ 有 HTTP 状态码时用状态码说清，
 *     否则 `FEEDBACK_READ_FAIL_TEXT`；
 *  3. 业务失败（HTTP 非 2xx）⇒ 读 `{ error }` 里的中文原因，**原样**带回（`status` 也带回，
 *     调用方靠 401 判"会话过期"）。
 */
export async function requestJson(
  fetcher: FeedbackFetcher,
  method: 'GET' | 'POST',
  url: string,
  body: BodyInit | null,
  info: FeedbackRequestInfo | null,
): Promise<FetchOutcome> {
  let res: Response;
  try {
    res = await fetcher.fetch(method, url, body, 'same-origin', info);
  } catch {
    return { ok: false, status: 0, text: feedbackOfflineText() };
  }
  let json: unknown = null;
  let parsed = false;
  try {
    json = await res.json();
    parsed = true;
  } catch {
    parsed = false;
  }
  if (!parsed) {
    const status = typeof res.status === 'number' ? res.status : 0;
    const text = status > 0
      ? t('feedback.read-fail-http', { status: String(status) })
      : feedbackReadFailText();
    return { ok: false, status, text };
  }
  if (!res.ok) {
    return { ok: false, status: res.status, text: serverErrorText(json, feedbackReadFailText()) };
  }
  return { ok: true, status: res.status, json };
}

/**
 * 判断一份附件是不是"真的能交给 `FormData` 的字节"（`Blob` / **`File`**）。
 *
 * ## ★ 2026-10-01 线上验收抓出的真 bug（这条守卫的第一版是错的）
 *
 * 第一版只认 `Object.prototype.toString.call(v) === '[object Blob]'`，**漏了 `File`** ——
 * 而真实浏览器里 `<input type=file>` 给的就是 `File`，它的标签是 **`[object File]`**
 * （`File` 是 `Blob` 的子类，但它有自己的 `Symbol.toStringTag`）。
 * ⇒ 守卫**恒假** ⇒ `append('files', …)` 那一行**一次都没执行过** ⇒ 用户看到"已选择 1 份附件"、
 * 服务端 `meta.json` 里 `"files": []`，**附件被静默丢掉**（实测：真 `File` ⇒ 0 条、
 * 真 `Blob` ⇒ 1 条、纯对象 ⇒ 0 条）。
 *
 * 当时的单测没能抓住它，是因为夹具只造了 `{name, size}` 这种**纯对象**（当初还错误地以为
 * "桩环境里造不出真 Blob"）⇒ 守卫对纯对象返回假是**预期**的，于是"恒假"这件事测不出来。
 * 现在夹具用**真 `File`**（见 `tests/ui/feedback-screen.test.ts` 的 `pickFiles`），
 * 这条守卫退回旧写法会当场变红。
 *
 * ## 判法（两层，都留着）
 *
 *  1. `instanceof Blob`：同 realm 下最快最准，且**天然认 `File`**（子类关系）；
 *  2. 标签兜底 `[object Blob]` / **`[object File]`**：跨 realm（同源 iframe、测试桩换了全局）
 *     时 `instanceof` 会给出假否定，标签仍然对。
 *
 * ⚠️ `typeof Blob === 'function'` 那一层保护是必要的：`Blob` 缺席的环境里直接写
 * `v instanceof Blob` 会抛 `TypeError`（`instanceof` 的右操作数不是可调用对象）。
 */
function isBlobLike(v: unknown): v is Blob {
  if (typeof v !== 'object' || v === null) return false;
  if (typeof Blob === 'function' && v instanceof Blob) return true;
  const tag = Object.prototype.toString.call(v);
  return tag === '[object Blob]' || tag === '[object File]';
}

/**
 * 提交那条 POST 的**请求本体**（唯一出处）。
 *
 * 键名与契约逐字对齐：`kind` / `title` / `author` / `body` / `files`（同一个键名重复 0..5 次）。
 *
 * ⚠️ 附件那一行**带 `isBlobLike` 守卫**：浏览器里 `<input type=file>` 给的一定是
 * `File` ⇒ 守卫为真、走标准那条 `append('files', 字节, 文件名)`（**这条路上线前是坏的**，
 * 见 `isBlobLike` 的头注）。真实 `FormData` 对第二个实参有类型检查，不是 `Blob`/`File` 就当场抛
 * `TypeError` —— 那个抛点在 `fetch` 之前的同步路径上，会把整次提交打断成"点了没反应"。
 * 所以拿不到字节时**跳过这一份**（标题/正文/署名照发，用户至少能看到服务端对这份提交的回应），
 * 而不是把提交整个弄炸。万一将来 `append` 的形态又变了，`requestJson` 那层还有兜底
 * （句人话，不抛未捕获异常）。
 */
export function buildSubmitForm(input: {
  readonly kind: FeedbackKind;
  readonly title: string;
  readonly author: string;
  readonly body: string;
  readonly files: readonly FeedbackAttachment[];
}): FormData {
  const fd = new FormData();
  fd.append('kind', input.kind);
  fd.append('title', input.title);
  fd.append('author', input.author);
  fd.append('body', input.body);
  for (const f of input.files) {
    if (isBlobLike(f.file)) fd.append('files', f.file, f.name);
  }
  return fd;
}

/** `POST /feedback/login` 的请求体（`{ password }`；口令只在这里出现一次，**不落任何地方**） */
export function buildLoginBody(password: string): string {
  return JSON.stringify({ password });
}

/**
 * `POST /feedback/read` 的请求体（契约：JSON `{ id, read }`；`read: false` = 标回未读）。
 *
 * 与登录那条一样是 JSON（不是 multipart）⇒ 用同一个 `jsonBody` 包成 `Blob`。
 */
export function buildReadBody(id: string, read: boolean): string {
  return JSON.stringify({ id, read });
}

/** `POST /feedback/delete` 的请求体（契约：JSON `{ id }`；服务端是移入回收站，不是真删） */
export function buildDeleteBody(id: string): string {
  return JSON.stringify({ id });
}
