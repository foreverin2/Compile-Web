/**
 * 档案读写的**浏览器实现**（G3 Task 6；设计稿 §3.7 的降级表）。
 *
 * ⚠️ 全仓只有本文件允许**调用** `showOpenFilePicker` / `showSaveFilePicker` /
 *    `<input type="file">` / `<a download>` / `URL.createObjectURL`。`src/app/` 保持零浏览器
 *    API（`tests/app-purity.test.ts` 扫代码位），纯层只认识 `src/app/archive-fs.ts` 的接口。
 *
 * ## 降级顺序（§3.7）
 * ```
 * 导入：showOpenFilePicker ──(不存在/不可用/非取消错误)──> <input type="file"> ──(无 document)──> unsupported
 * 导出：showSaveFilePicker ──(不存在/不可用/非取消错误)──> <a download> ────────(无 document)──> unsupported
 * ```
 * **用户取消是终态、不降级**：FSA 对话框里的"取消"与"这台设备没有 FSA"是两件事，
 * 把前者当后者会**再弹一次**对话框（用户点了取消却又跳出选择框 = 闹鬼）。
 * 取消返回 `cancelled` 而**不是** `failed`：UI 对 `failed` 会弹"保存失败"，而用户是自己点的取消。
 *
 * ## `open()` / `save()` **永不 reject**（G3 Task 6 修复轮 · F2 / F15）
 * 两条路的失败（含宿主 `createElement` / `Blob` / `click()` / `getFile()` 直接抛错）全部以
 * **返回值**表达：`{ ok:false, reason, detail }`。调用方是 UI 的 `click` 处理器，一个 reject
 * 会变成未捕获的 Promise 拒绝（控制台红字、可能整屏不更新），而"用户取消"这种**正常**路径
 * 也会被写进 `catch` 分支 —— 正常路径进 catch、异常路径进成功分支，是本仓栽过的形态。
 * ⚠️ 契约表在 `src/app/archive-fs.ts`；两侧用的是**同一个** `IoFailureReason` 联合。
 *
 * ## 注入缝（为什么必须有，而不是"测试时给 globalThis 打桩"）
 * node 下没有 `document` / `URL` / `showSaveFilePicker`，行为腿只能靠**参数注入**。
 * 更要紧的是：本仓刚发生过一次真实事故 —— `src/ui/pwa-update.ts` 把 `navigator.serviceWorker`
 * 写成 `globalThis.serviceWorker`（浏览器里那个属性根本不存在），**真实浏览器里 SW 从不注册**，
 * 而四道门禁全绿，因为它只有"读源码找字符串"的文本腿。
 * ⇒ 本文件的**每一处**浏览器调用都从下面这个参数表里取，默认值才是真全局对象
 * （形态与 `pwa-update.ts` 修复后的 `realEnv()` 同源）。**时钟与定时器也在表里**：
 * 它们是宿主调用，和 `document` 一样必须可注入（修复轮 F7 —— 上一版直接用了 `globalThis.setTimeout`，
 * 那是全文件**唯一**绕过参数表的宿主调用，且它所在的分支零覆盖）。
 *
 * ## 这个模块**不能**证明什么（诚实边界）
 * 真实浏览器里 `<a download>` 到底有没有落盘、FSA 在 Safari 上是否弹窗、8 MiB 文件读取的
 * 真实内存占用 —— 那些要真设备，属**用户验收**。本文件能证明的是：**decision 逻辑与调用序列**
 * （谁被调用、按什么顺序、写入的字节是什么、出错了返回哪个 reason）。
 */
import type {
  FileIoCapabilities,
  FilePicker,
  FileSink,
  IoFailure,
  IoFailureReason,
  PickOutcome,
  PickedFile,
  SaveOutcome,
} from '../app/archive-fs';
import { ARCHIVE_EXT, ARCHIVE_MIME } from '../app/archive-io';

/* ── 最小结构型接口（只声明本模块**用到**的成员，不照抄 DOM 类型） ────────────── */

/** `<input type="file">` 在本模块里用到的部分 */
interface InputLike {
  type: string;
  accept: string;
  multiple: boolean;
  files: ArrayLike<unknown> | null;
  style: { display: string };
  /** 只**调用**它（真实浏览器里打开文件选择框）；桩上是 no-op，因此本模块不读回任何值 */
  click(): void;
  addEventListener(type: string, cb: (ev?: unknown) => void): void;
  removeEventListener(type: string, cb: (ev?: unknown) => void): void;
  /** 摘除自身（真实元素都有；手写桩也提供）—— 收尾时用，缺省也不影响功能 */
  remove?(): void;
}

/** `<a download>` 在本模块里用到的部分 */
interface AnchorLike {
  href: string;
  download: string;
  rel: string;
  click(): void;
  remove?(): void;
}

/** `document` 在本模块里用到的部分（`createElement` 的返回值按上面的最小结构用） */
interface DomLike {
  createElement(tag: string): unknown;
  /** 挂载点；用来把 `<a>` 真的接进文档树（Firefox 需要可点击的锚点） */
  body: { appendChild(node: unknown): unknown; removeChild?(node: unknown): unknown } | null;
}

/** 浏览器里可能挂着的 FSA 入口（`window.showOpenFilePicker`） */
interface FsaLike {
  showOpenFilePicker?(opts: { multiple?: boolean; types?: unknown[]; excludeAcceptAllOption?: boolean }): Promise<
    Array<{ name: string; size?: number; getFile?(): Promise<{ text(): Promise<string>; size?: number; name?: string }> }>
  >;
  showSaveFilePicker?(opts: { suggestedName?: string; types?: unknown[] }): Promise<{
    name?: string;
    createWritable(): Promise<{ write(data: unknown): Promise<void> | void; close(): Promise<void> | void }>;
  }>;
}

/** 真实 `navigator.userActivation` 的一小块（Firefox 的 FSA 只允许在用户手势里调用） */
interface ActivationLike {
  isActive?: boolean;
}

/**
 * 本模块的**全部对外副作用**，一律可注入。
 *
 * 每个字段的默认值（`realArchiveEnv()`）才去读真全局对象；测试从参数缝里递假件。
 * `now` / `setTimeout` / `clearTimeout` 也在这里：文件输入那条路需要一个"等多长时间算放弃"的
 * 度量与一个延迟回调，而 `src/app/` 禁 `Date.now` —— 浏览器层是唯一允许碰时钟的地方，
 * 故时钟与定时器也走注入（F7：**每一个**宿主调用都必须在参数表上）。
 */
export interface ArchiveBrowserEnv {
  /** `window.showOpenFilePicker`（不存在 = `undefined`） */
  showOpenFilePicker?: FsaLike['showOpenFilePicker'];
  /** `window.showSaveFilePicker`（不存在 = `undefined`） */
  showSaveFilePicker?: FsaLike['showSaveFilePicker'];
  /**
   * 能力探测的"环境信号"（§3.7 要求"**存在且可用**"而不是"存在"）。
   * 缺省 = `{}`（视为可用）；只在**明确**不可用时给 `{ isActive: false }`
   * —— 探测证据不足时应当**试一次**，而不是把能用的浏览器误判成不支持。
   */
  userActivation?: ActivationLike;
  /** `document`（node 下不存在 ⇒ `undefined`） */
  document?: DomLike;
  /** `URL.createObjectURL` / `revokeObjectURL`（node 18+ 其实也有，但注入缝必须留） */
  createObjectURL?: (blob: unknown) => string;
  revokeObjectURL?: (url: string) => void;
  /** `<a>` 的兜底"立刻下载"（工具函数式的环境，例如无 DOM 的测量环境）；返回 true = 已处理 */
  triggerDownload?: (name: string, blob: unknown) => boolean;
  /** Blob 构造器（`<a download>` 那条路要先把文本包成 Blob） */
  makeBlob?: (parts: string[], opts: { type: string }) => unknown;
  /** 时钟（**唯一**允许碰时间的地方；默认 `Date.now`） */
  now?: () => number;
  /**
   * 定时器（F7）。默认 `globalThis.setTimeout`；**注入它就能让超时窗口在 node 下完全确定**
   * —— 不需要真 sleep，也不需要假时钟库。
   */
  setTimeout?: (fn: () => void, ms: number) => unknown;
  /** 配对撤销上面的定时器（收尾时用；缺省 = 不撤销，靠回调里的 `done` 守卫兜底） */
  clearTimeout?: (id: unknown) => void;
  /**
   * `<input type="file">` 的**取消判定窗口**（毫秒）。
   * 该标签页签的"用户取消"没有事件（`change` 不触发、`cancel` 事件各浏览器不一致），
   * 因此只能"等一下没动静就当取消"。默认 0 = **不设窗口**（永远等，由宿主的 DOM 生命周期决定
   * 它何时被丢弃）；只有宿主明确要求超时才给一个正数。
   */
  pickTimeoutMs?: number;
}

/** `<a rel>`：配合 `download` 的老式写法，避免个别浏览器把它当导航 */
const ANCHOR_REL = 'noopener';

/* ── 真环境（**本模块唯一**直接读浏览器全局的地方） ──────────────────────────── */

interface Globalish {
  showOpenFilePicker?: ArchiveBrowserEnv['showOpenFilePicker'];
  showSaveFilePicker?: ArchiveBrowserEnv['showSaveFilePicker'];
  navigator?: { userActivation?: ActivationLike };
  document?: DomLike;
  URL?: { createObjectURL?: (b: unknown) => string; revokeObjectURL?: (u: string) => void };
  Blob?: new (parts: string[], opts: { type: string }) => unknown;
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (id: unknown) => void;
}

/**
 * 从真全局对象取默认副作用。**只在这里**读 `globalThis` 上的宿主对象
 * （与 `pwa-update.ts` 的 `realEnv()` 同一条纪律：缝必须在参数表上，真全局只在工厂里出现一次）。
 *
 * ⚠️ **刻意不导出**（G3 Task 6 修复轮 · F12）：全仓零外部引用（上一版把它 `export` 了，
 * 但连测试都只走 `buildArchive*` 工厂的参数缝）。留一个没人用的导出只会让"谁是唯一入口"
 * 变模糊 —— 未来 Task 7 若真需要它，再加回来是一行的事。
 */
function realArchiveEnv(): ArchiveBrowserEnv {
  const g = globalThis as unknown as Globalish;
  const makeBlob = g.Blob;
  return {
    showOpenFilePicker: g.showOpenFilePicker,
    showSaveFilePicker: g.showSaveFilePicker,
    userActivation: g.navigator?.userActivation,
    document: g.document,
    createObjectURL: g.URL?.createObjectURL ? (b) => (g.URL as { createObjectURL(b: unknown): string }).createObjectURL(b) : undefined,
    revokeObjectURL: g.URL?.revokeObjectURL ? (u) => (g.URL as { revokeObjectURL(u: string): void }).revokeObjectURL(u) : undefined,
    makeBlob: makeBlob ? (parts, opts) => new makeBlob(parts, opts) : undefined,
    now: () => Date.now(),
    setTimeout: g.setTimeout ? (fn, ms) => g.setTimeout?.(fn, ms) : undefined,
    clearTimeout: g.clearTimeout ? (id) => g.clearTimeout?.(id) : undefined,
  };
}

/* ── 失败形态与小工具（纯函数；每条都对应一个真实会咬人的分支） ──────────────── */

/**
 * 造一个失败结果（`detail` **恒非空**：契约要求失败必须带上"为什么"）。
 *
 * 返回类型是 `IoFailure`（而**不是** `PickOutcome`）：`IoFailure` 同时是 `PickOutcome` 与
 * `SaveOutcome` 的联合成员，于是同一个助手在 `open()` 与 `save()` 里都能用 ——
 * 这正是"两侧共用同一个失败联合"在代码上的形态（谁把某一侧的分支改成自己的形状，`tsc` 会红）。
 */
function failure(reason: IoFailureReason, detail: string): IoFailure {
  return { ok: false, reason, detail: detail.trim() === '' ? '未知错误（宿主没有给出描述）' : detail };
}

/**
 * 把宿主抛出的任意东西变成**一句非空**的诊断文本。
 *
 * 三种形状都要认（评审者探针实测过它们真的会出现）：`Error`（正常）、字符串（有些 WebView
 * 直接 `throw '失败'`）、任意对象（`DOMException` 之外的包装层）。**永不抛**：`String(e)` 本身
 * 可能因为对象上有个抛错的 `toString` 而炸，故包在 try 里；`detail` 为空则给一句兜底。
 */
function describeError(e: unknown): string {
  let s: string;
  if (typeof e === 'string') s = e;
  else if (e === null || e === undefined) s = String(e);
  else if (e instanceof Error) s = e.message !== '' ? e.message : e.name;
  else {
    try {
      s = String(e);
    } catch {
      s = '宿主抛出了一个无法描述的对象';
    }
  }
  return s.trim() === '' ? '未知错误（宿主没有给出描述）' : s;
}

/**
 * 这个错误是不是"用户点了取消"？
 *
 * 判据按**宽严两个方向**都考虑过：
 *  - 真实浏览器给的是 `DOMException`，`name === 'AbortError'`（FSA 的 `showOpen/SaveFilePicker`
 *    在用户取消时 reject 的就是它）；
 *  - 某些包装层（旧 Edge / polyfill）给的是 `{ code: 20 }` 或 `{ name: 'AbortError' }` 的普通对象；
 *  - 因此**三条都认**：`name` / `code === 20` / `code === 'ABORT_ERR'`。
 * ⚠️ 只认 `name`/`code`，**不看 `message`**：文案随语言与浏览器变化，拿它当判据等于把
 *    "用户取消了"变成"英文浏览器里才算取消"。
 */
function isAbortError(e: unknown): boolean {
  if (typeof e !== 'object' || e === null) return false;
  const o = e as { name?: unknown; code?: unknown };
  return o.name === 'AbortError' || o.code === 20 || o.code === 'ABORT_ERR';
}

/**
 * FSA 到底能不能**用**（§3.7 的"存在且可用"，不是"存在"）。
 *
 * 只要 `userActivation.isActive === false`（在 Firefox 这类把 FSA 与用户手势绑死的浏览器里
 * 就是"现在调必然抛"），就判不可用并降级 —— 否则用户会在点了"导出"之后收到一个假失败。
 * **缺省（`undefined`）= 可用**：探测不到证据时应当试一次（见 `ArchiveBrowserEnv.userActivation`）。
 */
function fsaUsable(env: ArchiveBrowserEnv): boolean {
  return env.userActivation?.isActive !== false;
}

/**
 * FSA 的 `types` 描述（`accept` 的 MIME 列表 → `accept` 映射）。
 *
 * ⚠️ 扩展名取自 `ARCHIVE_EXT`（F3）：上一版这里写死了 `'.json'`，而 `archive-io.ts` 声称它是
 * **唯一出处** —— 评审者把 MIME 改成 `text/plain` 后 19/19 仍全绿，正说明那条声明当时没有牙。
 * 现在有生成式腿断言这份描述的键值**逐字等于** `ARCHIVE_MIME` / `ARCHIVE_EXT`。
 */
function fsaTypes(accept: readonly string[]): unknown[] {
  const mimes: Record<string, string[]> = {};
  for (const a of accept) mimes[a] = [ARCHIVE_EXT];
  return [{ description: 'Compile 对局档案', accept: mimes }];
}

interface ChangeEventLike {
  target?: { files?: ArrayLike<unknown> | null } | null;
}

/**
 * 把"从宿主拿到的那个文件对象"包成 `PickedFile`。
 *
 * 调用方**必须**先过 `toPickOutcome`（它保证 `raw` 上有可调用的 `text` 且 `size` 是数字）。
 * `text()` 直接转发、**不缓存**（档案最多 8 MiB，缓存一份没有任何好处，反而让"读失败"变成假成功）；
 * 用 `async` 包一层是为了把"宿主 `text()` **同步**抛错"也变成 **rejection** —— 契约里
 * `PickedFile.text(): Promise<string>` 的失败形态是 reject，不是同步 throw。
 */
function toPickedFile(raw: unknown, fallbackName: string, fallbackSize: number): PickedFile {
  const o = raw as { name?: unknown; size?: unknown; text(): Promise<string> };
  const name = typeof o.name === 'string' && o.name !== '' ? o.name : fallbackName;
  const size = typeof o.size === 'number' && Number.isFinite(o.size) && o.size >= 0 ? o.size : fallbackSize;
  return {
    name,
    size,
    text: async () => await o.text.call(raw),
  };
}

/**
 * 把宿主的文件对象包成 `PickOutcome`。
 *
 * ⚠️ **没有可调用的 `text()` ⇒ `failed` 而不是"成功但读不出来"**（F15）：那不是"用户选中了
 * 一个文件"，而是"这条路读不出内容"。在 `open()` 里当场判掉，UI 才能给一句真话；拖到调用方
 * 调 `text()` 时才炸，会让"选择成功"这四个字变成假成功。
 */
function toPickOutcome(raw: unknown, fallbackName: string, fallbackSize: number): PickOutcome {
  if (typeof raw !== 'object' || raw === null) {
    return failure('failed', '宿主没有给出文件对象（拿到的不是对象）');
  }
  if (typeof (raw as { text?: unknown }).text !== 'function') {
    return failure('failed', '选中的文件对象没有可调用的 text()：本程序无法读取它');
  }
  return { ok: true, file: toPickedFile(raw, fallbackName, fallbackSize) };
}

/* ── 导入 ─────────────────────────────────────────────────────────────────── */

/**
 * FSA 那条路：`showOpenFilePicker` → 第一个句柄 → `getFile()` → 包成 `PickedFile`。
 * 取消 ⇒ `cancelled`（**终态**，不降级）；其它错误 ⇒ 抛给调用方去降级（见 `pickViaInput`）。
 */
async function pickViaFsa(env: ArchiveBrowserEnv, accept: string[]): Promise<PickOutcome> {
  const pick = env.showOpenFilePicker as NonNullable<FsaLike['showOpenFilePicker']>;
  const handles = await pick({ multiple: false, types: fsaTypes(accept), excludeAcceptAllOption: false });
  const h = Array.isArray(handles) ? handles[0] : undefined;
  if (!h) return failure('cancelled', '用户没有选择文件（对话框返回了空列表）');
  const raw = typeof h.getFile === 'function' ? await h.getFile() : h;
  return toPickOutcome(raw, typeof h.name === 'string' && h.name !== '' ? h.name : `archive${ARCHIVE_EXT}`, typeof h.size === 'number' ? h.size : 0);
}

/**
 * 降级那条路：造一个隐藏的 `<input type="file">`、`click()` 它、等 `change`。
 *
 * 三种失败**必须可辨识**（F15，而不是都折成 `null`）：没有 `document` / 没有定时器 ⇒
 * `unsupported`；`createElement` / `appendChild` / `click()` 抛错 ⇒ `failed` + 真因；
 * 等了 `pickTimeoutMs` 仍没有 `change` 或派发了 `cancel` ⇒ `cancelled`。
 * 每个节点的 `removeEventListener` 与 DOM 摘除都在 `finish` 里做一次（不留悬挂监听）。
 *
 * ⚠️ **先注册监听、再 `click()`**（修复轮 F1）：宿主**同步**派发 `change` 时（部分
 * WebView / 自动化环境真的会），先 `click()` 会让那次 `change` 打在没有监听的元素上 ——
 * 文件被丢掉，而 Promise **永不 settle**（评审者探针实测 `P7 结果 = HANG`）。
 */
function pickViaInput(env: ArchiveBrowserEnv, accept: string[]): Promise<PickOutcome> {
  const doc = env.document;
  if (!doc) {
    return Promise.resolve(
      failure('unsupported', '这台设备的浏览器不支持导入档案（没有 showOpenFilePicker，也没有可用的 document）'),
    );
  }
  let el: InputLike;
  try {
    el = doc.createElement('input') as InputLike;
    el.type = 'file';
    el.accept = accept.join(',');
    el.multiple = false;
    el.style.display = 'none';
    doc.body?.appendChild(el);
  } catch (e) {
    // WebView / 沙箱 iframe 里 `createElement` 或 `appendChild` 可能直接抛
    return Promise.resolve(failure('failed', `无法创建文件选择框：${describeError(e)}`));
  }

  // ⚠️ `el` 在上面的 try 里赋值，TS 无法证明它已初始化 ⇒ 用一个**局部常量**承接（下面的闭包要用）。
  const input = el;
  return new Promise<PickOutcome>((resolve) => {
    let done = false;
    let timer: unknown;
    const finish = (v: PickOutcome): void => {
      if (done) return;
      done = true;
      input.removeEventListener('change', onChange);
      input.removeEventListener('cancel', onCancel);
      try {
        env.clearTimeout?.(timer);
      } catch {
        /* 宿主没有 clearTimeout 或它抛错：定时回调里已有 `done` 守卫，不会重复 settle */
      }
      input.remove?.();
      try {
        env.document?.body?.removeChild?.(input);
      } catch {
        /* 摘除失败无所谓：节点本来就挂在隐藏容器里 */
      }
      resolve(v);
    };
    const onChange = (ev?: unknown): void => {
      let files: ArrayLike<unknown> | null | undefined;
      try {
        files = (ev as ChangeEventLike | undefined)?.target?.files ?? input.files;
      } catch (e) {
        finish(failure('failed', `读取选择结果失败：${describeError(e)}`));
        return;
      }
      const raw = files && files.length > 0 ? files[0] : null;
      // `change` 里没有文件 = 用户点了取消（某些浏览器仍会派发 `change`）
      finish(raw === null ? failure('cancelled', '用户没有选择文件') : toPickOutcome(raw, `archive${ARCHIVE_EXT}`, 0));
    };
    // `cancel` 事件目前只有部分浏览器派发；有它就用它（比超时更快更准），没有就靠超时/等待。
    const onCancel = (): void => finish(failure('cancelled', '用户取消了导入'));
    // ⚠️ **顺序不能换**：监听必须在 `click()` 之前挂上（F1）。
    input.addEventListener('change', onChange);
    input.addEventListener('cancel', onCancel);
    try {
      input.click();
    } catch (e) {
      finish(failure('failed', `无法打开文件选择框：${describeError(e)}`));
      return;
    }
    // 宿主在 `click()` 里**同步**派发了 change/cancel ⇒ 这里已经 settle，别再挂定时器。
    if (done) return;
    const ms = env.pickTimeoutMs;
    if (typeof ms !== 'number' || !(ms > 0)) return;
    const schedule = env.setTimeout;
    if (typeof schedule !== 'function') return; // 没有定时器 ⇒ 只能一直等（与 `pickTimeoutMs = 0` 同义）
    const clock = typeof env.now === 'function' ? env.now : () => Date.now();
    const started = clock();
    const tick = (): void => {
      if (done) return;
      if (clock() - started >= ms) {
        finish(failure('cancelled', `等待用户选择超过 ${ms} 毫秒，按取消处理`));
        return;
      }
      timer = schedule(tick, 10);
    };
    timer = schedule(tick, 10);
  });
}

/** 造一个档案选择器（默认读真全局对象；测试从参数缝里递假件） */
export function buildArchiveFilePicker(overrides: Partial<ArchiveBrowserEnv> = {}): FilePicker {
  return {
    async open(opts: { accept: string[] }): Promise<PickOutcome> {
      let env: ArchiveBrowserEnv;
      try {
        env = { ...realArchiveEnv(), ...overrides };
      } catch (e) {
        return failure('failed', `无法准备文件选择环境：${describeError(e)}`);
      }
      let fsaDetail = '';
      try {
        if (typeof env.showOpenFilePicker === 'function' && fsaUsable(env)) {
          try {
            return await pickViaFsa(env, opts.accept);
          } catch (e) {
            if (isAbortError(e)) return failure('cancelled', '用户取消了选择'); // **终态**，不再弹第二个框
            fsaDetail = describeError(e); // 其它错误（SecurityError / NotAllowedError / 策略禁用…）⇒ 降级
          }
        }
        const viaInput = await pickViaInput(env, opts.accept);
        // 只要 `<input>` 那条路**不是用户取消**，就把 **FSA 的真因**也拼上（与 `save()` 对称，
        // 见下面 `buildArchiveFileSink` 里 `written === false` 的那条腿）：笼统的"不支持"会把
        // "API 被策略禁用"说成"这台设备没这个能力"，而这两件事的下一步动作不同。
        // ⚠️ G3 Task 6 第 3 轮 · 建议 ②：原版写成 `reason === 'unsupported'` ⇒ 当 `<input>` 那条路
        //    是 **`failed`**（例如宿主 `createElement` 抛错，其中就含沙箱/策略这类"和 FSA 同一个
        //    真因"的场景）时，`fsaDetail` 被**整条丢掉**，`detail` 只剩 `<input>` 那一句
        //    （复验者实测：`detail` = `无法创建文件选择框：INPUT-原因…`，FSA 的原因消失）。
        //    放宽到"非 `cancelled`"之后两条路的真因都留下来，诊断信息量与 `save()` 一致。
        // ⚠️ 三态语义**不变**：`cancelled` 仍然只在"用户取消"时出现，且取消的 `detail` 里
        //    **不带**任何 FSA 真因（取消不是错误，不该被写成一句"文件系统选择失败：…"）。
        if (fsaDetail !== '' && viaInput.ok === false && viaInput.reason !== 'cancelled') {
          const inputDetail = viaInput.detail.trim() === '' ? '（输入框那条路没有给出描述）' : viaInput.detail;
          return failure('failed', `文件系统选择失败：${fsaDetail}；文件选择框也失败：${inputDetail}`);
        }
        return viaInput;
      } catch (e) {
        // 兜底：任何漏网的宿主抛错都以返回值表达，**绝不 reject**（契约在 `src/app/archive-fs.ts`）
        return failure('failed', `选择档案失败：${describeError(e)}`);
      }
    },
  };
}

/**
 * 零参工厂（`main.ts` / Task 7 的接线写死了 `openArchivePicker()` 这个调用形态）。
 * 可选参数只为测试与无头自查注入假件 —— **零参调用必须永远可用**。
 */
export function openArchivePicker(overrides: Partial<ArchiveBrowserEnv> = {}): FilePicker {
  return buildArchiveFilePicker(overrides);
}

/* ── 导出 ─────────────────────────────────────────────────────────────────── */

/** FSA 那条路：`showSaveFilePicker` → `createWritable` → `write` → `close`。 */
async function saveViaFsa(env: ArchiveBrowserEnv, suggestedName: string, text: string): Promise<SaveOutcome> {
  const pick = env.showSaveFilePicker as NonNullable<FsaLike['showSaveFilePicker']>;
  const handle = await pick({ suggestedName, types: fsaTypes([ARCHIVE_MIME]) });
  const w = await handle.createWritable();
  await w.write(text); // ⚠️ 写的必须是**入参文本本身**（不是 `String(text)` 之外的任何加工）
  await w.close();
  return { ok: true, name: handle.name ?? suggestedName, mode: 'fsa' };
}

/**
 * 降级那条路：Blob → `URL.createObjectURL` → 隐藏 `<a download>` → `click()`。
 *
 * ⚠️ **`revokeObjectURL` 必须在 `click()` 之后调用**：不撤销就是一个进程级的 URL 泄漏
 * （每个 blob URL 都会把整份档案钉在内存里直到页面卸载）。本仓有一条腿专门数
 * `createObjectURL` 与 `revokeObjectURL` 的**配对**次数（漏掉撤销会变红）。
 *
 * 顺序上有意"先 click 再 revoke"：撤销**过早**（例如 click 之前）会让下载拿到空内容 ——
 * 那是比泄漏更糟的静默数据损坏。
 *
 * ⚠️ 撤销放在 `finally` 里（修复轮 F2）：`a.click()` 抛错时若直接冒泡出去，那次导出的
 * blob URL **永远不会被撤销** —— 每一次失败的导出都泄漏一份完整档案的内存。抛错本身由
 * `save()` 的 try 转成 `{ ok:false, reason:'failed' }`（**不 reject**）。
 */
function saveViaDownload(env: ArchiveBrowserEnv, name: string, text: string): boolean {
  const doc = env.document;
  const makeBlob = env.makeBlob;
  if (!doc || typeof makeBlob !== 'function') return false;
  const blob = makeBlob([text], { type: ARCHIVE_MIME });
  const url = env.createObjectURL?.(blob);
  if (typeof url !== 'string' || url === '') {
    // 没有 blob URL 时的最后手段：某些宿主提供"立刻下载"的工具函数
    return env.triggerDownload?.(name, blob) ?? false;
  }
  // ⚠️ `createElement` **刻意留在 `try` 之外**（第 3 轮 · 建议 ①）：`a` 必须在 `finally` 里可见，
  //    否则收尾代码引用不到那个节点（`tsc` 直接报 `TS2304: Cannot find name 'a'`）。
  //    宿主在这里抛错时异常照样冒泡给 `save()` 的 try（行为与放进去完全一致）。
  const a = doc.createElement('a') as AnchorLike;
  try {
    // ⚠️ `rel` 必须先于 `href`/`click`：把锚点约束成"不导航"（个别浏览器把无 rel 的
    //    带 download 锚点当导航处理，会整页跳走 —— 用户会丢当前对局）。
    a.rel = ANCHOR_REL;
    a.href = url;
    a.download = name;
    doc.body?.appendChild(a);
    a.click();
    return true;
  } finally {
    // ⚠️ **节点收尾必须在 `finally` 里**（G3 Task 6 第 3 轮 · 建议 ①）：原版把 `a.remove?.()`
    //    与 `removeChild` 写在 `try` 内、`a.click()` **之后** ⇒ `click()` 抛错时那两行根本不执行，
    //    于是 `<a>` **永久留在 `document.body` 上**（复验者实测「body 里剩余节点数 = 1」）。
    //    本仓在 G2 阶段已经因为 `document.body` 级元素残留栽过多次（浮层遮挡点击、全量重渲染
    //    清不掉）——留一个锚点在 body 里就是这一类残留，故收尾与 `revokeObjectURL` 同放 `finally`：
    //    **任何**抛出路径（`createElement` / `makeBlob` / `createObjectURL` / `appendChild` / `click`）
    //    之后 body 里都不留这个节点。
    try {
      a.remove?.();
    } catch {
      /* 桩/怪宿主没有 remove 或它抛错：下面的 removeChild 还能兜一次 */
    }
    try {
      doc.body?.removeChild?.(a);
    } catch {
      /* 摘除失败不影响已经触发的下载（或已经抛出的那个真因） */
    }
    try {
      env.revokeObjectURL?.(url);
    } catch {
      /* 撤销失败只泄漏一个 URL；不能因此把一个已经写完的结果改判成失败 */
    }
  }
}

/** 造一个档案落盘口（默认读真全局对象；测试从参数缝里递假件） */
export function buildArchiveFileSink(overrides: Partial<ArchiveBrowserEnv> = {}): FileSink {
  return {
    async save(opts: { suggestedName: string; text: string }): Promise<SaveOutcome> {
      let env: ArchiveBrowserEnv;
      try {
        env = { ...realArchiveEnv(), ...overrides };
      } catch (e) {
        return failure('failed', `无法准备保存环境：${describeError(e)}`);
      }
      let fsaDetail = '';
      try {
        if (typeof env.showSaveFilePicker === 'function' && fsaUsable(env)) {
          try {
            return await saveViaFsa(env, opts.suggestedName, opts.text);
          } catch (e) {
            // 用户取消 = **终态**（绝不能落到 `<a download>`：那会再下载一份用户刚拒绝的文件）
            if (isAbortError(e)) return failure('cancelled', '用户取消了保存');
            fsaDetail = describeError(e);
            // 非取消错误 ⇒ 降级（FSA 被策略禁用、权限被撤、跨源 iframe 里不可用…）
          }
        }
        let written: boolean;
        try {
          written = saveViaDownload(env, opts.suggestedName, opts.text);
        } catch (e) {
          const d = describeError(e);
          return failure(
            'failed',
            fsaDetail !== '' ? `文件系统写入失败：${fsaDetail}；下载降级也失败：${d}` : `下载降级失败：${d}`,
          );
        }
        if (written) return { ok: true, name: opts.suggestedName, mode: 'download' };
        if (fsaDetail !== '') {
          // 两条路都不可用：报**真因**（FSA 的错），而不是笼统的"不支持"
          return failure('failed', `文件系统写入失败：${fsaDetail}`);
        }
        return failure(
          'unsupported',
          '这台设备的浏览器不支持保存文件（没有 showSaveFilePicker，也没有可用的 document/URL）',
        );
      } catch (e) {
        // 兜底：**永不 reject**（宿主 `createElement` / `Blob` / `click()` 抛错都走这里或上面的分支）
        return failure('failed', `保存失败：${describeError(e)}`);
      }
    },
  };
}

/**
 * 零参工厂（`main.ts` / Task 7 的接线写死了 `openArchiveSink()` 这个调用形态）。
 * 可选参数只为测试与无头自查注入假件 —— **零参调用必须永远可用**。
 */
export function openArchiveSink(overrides: Partial<ArchiveBrowserEnv> = {}): FileSink {
  return buildArchiveFileSink(overrides);
}

/**
 * 本机文件能力自述（`FileIoCapabilities` 的**唯一**出处）。
 *
 * `silentWriteBack` 恒 `false`：本阶段**不做** FSA 静默写回（用户裁决「待用户裁决 #4」选 A：
 * 不存句柄、不碰 IndexedDB）。`tests/ui/archive-fs-browser.test.ts` 有一条腿钉死这一点 ——
 * 谁把静默写回做成"看起来可用"，那条腿会红。
 */
export function archiveFileCapabilities(): FileIoCapabilities {
  return { silentWriteBack: false };
}
