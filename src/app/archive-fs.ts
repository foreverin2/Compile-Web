/**
 * 档案文件读写的**接口层**（G3 Task 6；设计稿 §3.7 的两列表格）。
 *
 * 本文件**只有类型，零实现、零浏览器 API** —— 它是 `src/app/`（纯层）与
 * `src/ui/archive-fs-browser.ts`（浏览器实现）之间那条单向缝。
 *
 * 为什么接口住 `src/app/`：Task 9 的 `tests/app-purity.test.ts` 会扫 `src/app/**` 的代码位，
 * `showOpenFilePicker` / `document` / `window` / `URL.createObjectURL` 一律零命中。浏览器 API
 * 只能在 `src/ui/` 里被**调用**（注释里提到名字没关系）。于是"档案怎么落到磁盘上"这件事在
 * 纯层只能以这几个接口的形态出现，`tests/app/archive-io.test.ts` 与 Task 7 的屏都注入假件。
 *
 * ## 契约（消费方按这个理解，实现方按这个实现）
 *
 * | 场景 | `open()` 必须返回 | `save()` 必须返回 |
 * |---|---|---|
 * | 用户选中/写入了 | `{ ok: true, file }` | `{ ok: true, name, mode }` |
 * | 用户**取消**了对话框 | `{ ok: false, reason: 'cancelled' }` | `{ ok: false, reason: 'cancelled' }` |
 * | 本机**没有**实现该能力（例如某些 WebView） | `{ ok: false, reason: 'unsupported' }` | `{ ok: false, reason: 'unsupported' }` |
 * | 真出错了（权限被撤、写盘失败、设备满、宿主抛错） | `{ ok: false, reason: 'failed' }` + **非空** `detail` | 同左 |
 *
 * ⚠️ **`open()` 与 `save()` 永不 reject**：两条路的失败（含宿主 `createElement` / `Blob` /
 * `click()` / `text()` 直接抛错）都以**返回值**表达。理由：调用方是 UI 的 `click` 处理器，
 * 一个 reject 会变成未捕获的 Promise 拒绝（控制台红字 + 可能整屏不更新），而"用户取消"这种
 * **正常**路径也会被 `catch` 当成异常 —— 于是正常路径被写进 `catch` 分支、异常路径被写进
 * 成功分支，正是本仓已经栽过的形态。
 *
 * ⚠️ **`cancelled` 与 `failed` 必须分开**（这也是为什么 `open()` 的返回值**不能**是一个
 * `PickedFile | null`）：UI 对 `cancelled` 不能弹任何对话框 —— 用户是自己点的取消，弹
 * "这台设备不支持导入档案"就是**假警报**（计划 Task 6 的设计要点 3 对**保存**侧明令禁止
 * 把"取消/不支持/失败"折叠成一个值，理由是"否则 UI 会弹假警报"；同一条理由对 `open()` 逐字
 * 成立，所以两侧用的是**同一个**判别式联合）。`unsupported` 同理：它是"这台设备**没有**这条路"，
 * 要让 UI 说"这台设备的浏览器不支持导入档案"（而不是"你取消了"）。
 *
 * `detail` 在 `failed` 时是给人看的诊断文本（不是给机器分支用的）：它不是判别键，机器分支只
 * 看 `reason`；失败却给空串等于把"为什么失败"丢掉。`cancelled` / `unsupported` 也带 `detail`，
 * 是为了让 UI 能直接展示一句人话（两条的文案各不同，不能共用）。
 */

/**
 * 用户选中的一个文件。
 *
 * ⚠️ **刻意不写 `type` / `lastModified` / `arrayBuffer()`**：本阶段只读文本，写宽接口等于让
 * 实现方与假件都要多维护几个用不到的成员（YAGNI）。将来真要用再加，且加的时候要同步
 * `src/ui/archive-fs-browser.ts` 与测试假件。
 *
 * ⚠️ `size` 存在**唯一**目的：让调用方在 `text()` **之前**挡掉超大文件（大文件读进来会把
 * 内存打满）。因此 `size` 必须是**字节数**（与浏览器的 `File.size` 同义，不是字符数）。
 */
export interface PickedFile {
  name: string;
  /** 字节数（不是字符串长度） */
  size: number;
  text(): Promise<string>;
}

/**
 * 读/写失败的三种**可辨识**原因。`open()` 与 `save()` **共用同一个**联合 ——
 * 不是为了省一行，而是为了让"两侧对称"变成类型层面的事实：谁把 `open()` 的 return 改回
 * `PickedFile | null`，就不再满足本文件里 `FilePicker` 的签名（`tsc` 当场红）。
 */
export type IoFailureReason = 'cancelled' | 'unsupported' | 'failed';

/** 失败形态：`reason` 是判别键，`detail` 是给人看的一句真因（**不参与分支**）。 */
export interface IoFailure {
  ok: false;
  reason: IoFailureReason;
  detail: string;
}

/** `open()` 的结果：三态可辨识，**永不 reject**（见文件头的契约表）。 */
export type PickOutcome = { ok: true; file: PickedFile } | IoFailure;

/**
 * 档案的**选择**入口。降级顺序由实现决定（FSA → `<input type="file">` → `unsupported`）。
 *
 * ⚠️ 用户取消是**终态、不降级**：FSA 对话框里的"取消"与"这台设备没有 FSA"是两件事。
 */
export interface FilePicker {
  open(opts: { accept: string[] }): Promise<PickOutcome>;
}

/** `save()` 成功时的结果（`mode` 让 UI 知道要不要提示"下次仍要手动导"）。 */
export type SaveOutcome = { ok: true; name: string; mode: 'fsa' | 'download' } | IoFailure;

/** 档案的**落盘**入口。降级顺序由实现决定（FSA → `<a download>` → `unsupported`）。 */
export interface FileSink {
  save(opts: { suggestedName: string; text: string }): Promise<SaveOutcome>;
}

/**
 * 本机**文件系统能力**的自述。
 *
 * 唯一成员 `silentWriteBack` = "能不能把内容静默写回**同一个**文件（不弹任何对话框）"。
 * 它要求持久化 FSA 句柄（`FileSystemFileHandle` 只能存 IndexedDB），**用户已裁决不做**
 * （计划「待用户裁决 #4」选 A）⇒ 本阶段所有实现的取值恒为 `false`。
 *
 * 它保留在接口里的理由：Task 4/7 的 UI 要据它决定"导出后要不要提示用户下一次仍要手动导"
 * —— 那条文案分支不该依赖"猜实现"；而将来真做静默写回时，改的只是实现里的这个布尔值。
 */
export interface FileIoCapabilities {
  /** 本阶段恒 `false`（不做 FSA 静默写回：不存句柄、不碰 IndexedDB） */
  silentWriteBack: boolean;
}
