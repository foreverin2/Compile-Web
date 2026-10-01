/**
 * 「本地数据与隐私」屏（G3 Task 7；设计稿 `§3.5` / `§3.6` / `§3.7` 的可见化）。
 *
 * 三块内容（计划 Task 7 设计要点 1）：
 *  ① **授权状态**：当前是"允许"还是"游客" + 「改变选择」+ 「清除本机数据」；
 *  ② **昵称 / 设置 / 卡组**：昵称可编辑（写失败如实提示，不假装成功）；
 *  ③ **隐私说明全文**（唯一出处 = `src/app/privacy.ts` 的 `privacyLines()`，**生成式**渲染，
 *     本文件不写第二份措辞）+ 档案「导出 / 导入」两个按钮；
 *  ④ **「重放这一局」**（G4 Task 5）：**导入成功之前不可见、也不可点**（本屏只渲染一次，
 *     见 `doImport` 附近的注释），点击后把**刚导入的那一份** `MatchFile` 交给宿主
 *     （`nav.startReplay` ⇒ `src/main.ts` 的 `startReplayFile`）。**本屏不自动进入重放** ——
 *     用户要留在本屏看完校验报告（含逐条警告）再自己决定。
 *
 * ## 四条纪律（都是跨任务转达的实测结论，不是风格偏好）
 *
 * 1. **`FilePicker.open()` 是三态**（`PickOutcome`），不是 `PickedFile | null`：
 *    `cancelled` 是**用户自己点的取消** ⇒ 一个字都不许说成"失败/不支持"（假警报）；
 *    `unsupported` ⇒ 说"这台设备不支持导入档案"；`failed` ⇒ 显示 `detail` 真因（不许静默）。
 *    `save()` 同款三态（`SaveOutcome`）。两侧**永不 reject**，但本屏仍给 `try/catch` 兜底：
 *    宿主假件/将来实现 reject 时也走同一条"如实提示"的路，而不是变成未捕获拒绝。
 * 2. **`PickedFile.text()` 的失败形态是 reject** ⇒ 必须 `try/catch` 并映射到 `ImportOutcome`
 *    里早已预留、纯逻辑却**永不产出**的 `read-failed` 码（见 `archive-io.ts` 的注）。
 *    绝不许把 reject 吞成空串假成功。
 * 3. **`clearAllLocalData` 故意不吞 `remove`/`keys`/`get` 的抛错**（`storage.ts` 的能力边界表）
 *    ⇒ 本屏必须自己 `try/catch` 并在失败时如实提示。**并且必须传 `store.kv()`（不是 persistent）**：
 *    游客模式下 `kv()` 是内存 KV，传 persistent 会当场违反红线 3 的"零写入"。
 * 4. **`pickTimeoutMs` 缺省保持 0（不设窗口）** —— 协调者 2026-09-16 裁决：给窗口会把
 *    "用户慢慢挑文件"误判成 `cancelled`（假取消比等待更糟）。代价（点导入后可能一直等）
 *    由本屏的**可见且不阻塞**的等待态兜住：不禁用任何按钮、不挂永不消失的 spinner，
 *    别处的任何操作都会把等待提示替换掉。见 `doImport` 的注释与测试的"永不 settle"腿。
 * 5. **档案不经过本屏，也不落盘（G4 D13）**：导出用的档案由**宿主**给（`nav.buildArchive()` ——
 *    记录器只住在 `src/main.ts`），导入的档案也只在本屏**过一手**（`nav.startReplay(file)`）。
 *    本文件**不写任何浏览器存储**、也不缓存档案；档案只在内存与用户自己选的文件里。
 *    ⇒ 这与 `src/app/privacy.ts` 里那几句被整句哈希钉死的存储类承诺句一致：它们**一句都不用改**
 *      （G4 不新增任何存储写入点）。
 *
 * ## 本文件刻意**不**做的事
 *  - 不 import `home.ts` 的私有 `el`/`button`/`showToast`（它们未导出；改可见性会与 Task 4
 *    争同一个文件）。按计划"8 行重复优于跨任务耦合"的口径，这里各写一份同形局部助手。
 *  - **不挂 toast**：本屏的全部提示走屏内的**状态区**（`[data-role=status]`，人读的一句在
 *    `textContent`，机器可读的结论在 `data-code`）。理由：本仓有过 `document.body` 级浮层
 *    残留的历史，且"屏内状态"是唯一能在无 jsdom 的 DOM 桩上被**真跑**到的提示通道。
 *  - **不直接引用任何浏览器 API**（`showOpenFilePicker` / `localStorage` / `indexedDB`…）：
 *    选择器、落盘口、KV 全部从 `nav` 注入（源码腿守卫扫本文件的代码位）。
 */
import {
  ARCHIVE_MIME,
  MAX_ARCHIVE_BYTES,
  exportArchive,
  importArchive,
  type ImportOutcome,
} from '../app/archive-io';
import type { FilePicker, FileSink, PickOutcome, SaveOutcome } from '../app/archive-fs';
import { CARD_DATA_HASH } from '../app/card-data-hash';
import {
  clearAllLocalData,
  readDecks,
  readLang,
  readLangPresence,
  readNickName,
  writeNickName,
  type ConsentState,
  type LocalStore,
} from '../app/local-store';
// ★ 2026-10-01（P0）：语言标签的唯一出处（`src/i18n/lang.ts`）—— 本文件不写第二份语言名清单。
import { DEFAULT_LANG, LANGS, isLang, type Lang } from '../i18n/lang';
// ★ 2026-10-01（P0 线上验收 D4）：**语言那一行**走文案表（它是语言功能自己的读数）。
//   ⚠️ 这一屏的**其它文案没有抽取**，还登记在 `docs/2026-10-01-i18n-尚未抽取的屏.md` 里。
import { t } from '../i18n';
import type { MatchFile } from '../app/match-file';
import { privacyLines } from '../app/privacy';

/**
 * 宿主交给本屏的"本次会话的档案"（G4 D9）。
 *
 * 与 `src/main.ts` 的 `SessionArchive` **同形**：有记录 ⇒ 给档案；没有 ⇒ 给**理由**，屏上如实
 * 显示。刻意写成命名类型而不是就地写 `{ file: … } | { reason: … }`：后者会让
 * `tests/ui/source-text.ts` 的 `functionBody` 把**返回类型标注里的 `{`** 当成函数体起点
 * （那是它写明的已知局限）⇒ 抽出来的"函数体"只有一行，针对它的判据会变成**假绿**。
 */
export type ArchiveBuild = { file: MatchFile } | { reason: string };

export interface LocalDataNav {
  /** 回主界面（授权若被重置，会重新问） */
  back(): void;
  store: LocalStore;
  pickFile: FilePicker;
  saveFile: FileSink;
  /**
   * 档案导入成功后的**通知**接缝 —— 报告已经由本屏写进状态区，宿主拿到 `file` / `warnings`
   * 做自己的事（留一份、统计…）。
   *
   * ⚠️ G4 Task 5 前这里写着"只报告，**不重放**（`ReplayDriver` 属 G4）" —— 那句前提已被
   * G4 消掉：重放的落点是下面那个**独立的** `startReplay`（用户点「重放这一局」才触发，
   * 不是导入即重放）。
   */
  onImported(file: MatchFile, warnings: string[]): void;
  /**
   * 用户点「重放这一局」⇒ 把**刚导入的那一份**档案原样交给宿主去重放。
   *
   * `file` 就是 `onImported` 收到的那一份（同一个对象、同一个内容），本屏不重新拼档案。
   */
  startReplay(file: MatchFile): void;
  /**
   * 宿主交出"本次会话的档案"（G4 D9）：有记录 ⇒ `{ file }`；没有 ⇒ `{ reason }`，
   * 本屏**拒绝导出并把理由显示出来**（绝不退化成导一份 `actions: []` 的"本机数据快照"）。
   *
   * ⚠️ **为什么档案必须由宿主给，而不是本屏自己从 L1 拼**（G3 的原注释自己写着原因：
   * "`LocalDataNav` 不携带任何对局来源 ⇒ 本屏拿不到'当前对局'" —— 那句话正是 G4 要消掉的
   * 前提）：对局记录器（`MatchFileRecorder`）住在 `src/main.ts`，只有它知道本次会话打过什么；
   * 本屏手里只有昵称与卡组（那是 L1 设置，不是对局）。⇒ 宿主能力注入，本屏不再有第二份
   * "拼档案"的实现。
   */
  buildArchive(): ArchiveBuild;
  /**
   * ★ 2026-10-01（用户要求）：**本机保存的卡牌制作器牌组**。
   *
   * 用户原话：「本仓库有个「本地数据与隐私」屏会列出本机存了什么、能清除 ——
   * **新加的存储必须在那屏里可见、可清除**」。制作器的牌组住在 **IndexedDB**
   * （不是 L1 那两个 localStorage 键，理由见 `src/ui/cardmaker/store-idb.ts` 的文件头注：
   * 自定背景 base64 内嵌之后一个牌组就超过 localStorage 的 ~5MB 配额），所以它**不在**
   * `clearAllLocalData` 的键表里 —— 它需要自己这两个接缝。
   *
   * `count === null` = **读不到**（这台设备没有 IndexedDB，或库被别的程序占着）。
   * 那时屏上显示"读不到"，并**仍然**给出清除按钮（读不到不等于没有数据）。
   */
  readCardmaker(): Promise<{ count: number | null }>;
  /**
   * 清掉本机保存的制作器牌组。
   *
   * 三态（与档案那两条同款纪律，**不许折叠**）：
   *  - `{ ok: true, removed: true }`：真删掉了；
   *  - `{ ok: true, removed: false }`：本来就没有（没什么可删，不算失败）；
   *  - `{ ok: false, detail }`：**删失败**，`detail` 是真因，屏上原样显示。
   */
  clearCardmaker(): Promise<{ ok: boolean; removed?: boolean; detail?: string }>;
}

/* ── 与 `home.ts` 同形的局部助手（见文件头注：刻意不 import 那边的私有函数） ── */

function el(tag: string, cls: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(cls: string, label: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.className = cls;
  b.textContent = label;
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
}

/** 授权状态 → 屏上那句人话（`allowed` / `denied` 的措辞对齐 `local-consent.ts` 的基调）。 */
function consentLabel(state: ConsentState): string {
  switch (state) {
    case 'allowed': return t('local-data.consent.allowed');
    case 'denied': return t('local-data.consent.denied');
    case 'ask': return t('local-data.consent.ask');
    default: return t('local-data.consent.unknown');
  }
}

/**
 * 宿主的任意异常 → 一句**非空**的诊断文本（与 `src/ui/archive-fs-browser.ts` 的
 * `describeError` 同形：`Error` / 字符串 / 任意对象三种形状都认，**永不抛**）。
 */
function describeError(e: unknown): string {
  if (typeof e === 'string') return e.trim() === '' ? t('local-data.error.unknown') : e;
  if (e instanceof Error) return e.message !== '' ? e.message : e.name;
  try {
    const s = String(e);
    return s.trim() === '' ? t('local-data.error.unknown') : s;
  } catch {
    return t('local-data.error.indescribable');
  }
}

/**
 * 失败码 → 给玩家看的一句话。四条判据共用**同一个**出口：
 *  - `read-failed` 的文案由**本层**定（`archive-io.ts` 的注里写明：这个码永不从纯逻辑产出，
 *    就是留给这一层合成的）；其余码统一加"导入失败："前缀，`message` 原样透传真因。
 */
function failureText(o: { code: string; message: string }): string {
  return o.code === 'read-failed'
    ? t('local-data.archive.read-failed', { detail: o.message })
    : t('local-data.archive.import-failed', { detail: o.message });
}

/* ── 档案的来源：**宿主**（G4 D9 / D13），本屏不再自己拼一份 ───────────────────── */

/*
 * G3 这里曾有一整块 `snapshotMatchFile(store)`：它从 L1 读昵称与第一份卡组，拼出一份
 * `actions: []` 的"本机数据快照档案"，并用两个常量（`SNAPSHOT_SEED` / `SNAPSHOT_CREATED_AT`）
 * 保证"两次导出逐字节相同"。那块代码的**唯一存在理由**是"让 G3 的导出按钮有东西可导"，
 * 而它自己的注释就写着本屏拿不到对局来源 —— G4 之后那句话不再成立：
 *
 *  - 档案 = **本次会话的真实对局**（含每一步操作），它的唯一载体是 `main.ts` 里的
 *    `MatchFileRecorder`（内存、零浏览器 API）⇒ 由 `nav.buildArchive()` 交给本屏；
 *  - 本次会话还没有对局时，宿主回 `{ reason }`，本屏**拒绝导出并说明**（D9）——
 *    导出一份空快照会让玩家以为"我导出的就是对局"，那正是要消掉的假象；
 *  - "导出必须可复现"这条性质因此换了归属：它现在是 `exportArchive`/`stringifyMatchFile`
 *    （稳定序列化）的性质，而不是"本屏不许读时钟"的性质（`createdAt` 由 UI 层读时钟，
 *    `matchFileFingerprint` 不含它）。
 */

/**
 * 档案 →「落盘用的 (文件名, 文本)」。**唯一出处** = `archive-io.exportArchive`
 * （文本是 `stringifyMatchFile` 的**稳定序列化**：对象键排序 ⇒ 同一份数据恒得同一串字节）。
 * 单独抽一行的理由：本屏禁止自己拼文本/自己写文件名（`archiveFileName` 做了路径安全，
 * 自己写一份就是第二个真相）。
 */
function archivePack(f: MatchFile): { name: string; text: string } {
  const { name, text } = exportArchive(f);
  return { name, text };
}

/* ── 屏幕 ─────────────────────────────────────────────────────────────────── */

/**
 * 画出「本地数据与隐私」屏（整屏屏；调用方与 `local-consent.ts` 同款：先清空 root）。
 *
 * **本函数不碰任何存储后端**：所有读写都经 `nav.store`（`LocalStore`），所有浏览器调用都经
 * `nav.pickFile` / `nav.saveFile`。因此它可以在无 jsdom 的 node 下用手写假件真跑。
 */
export function renderLocalData(root: HTMLElement, nav: LocalDataNav): void {
  root.textContent = '';
  const store = nav.store;

  const screen = el('div', 'local-data-screen');
  screen.appendChild(el('h1', 'local-data-title', t('local-data.title')));

  /* ── 状态区：本屏**唯一**的提示通道（人读 textContent / 机器读 data-code） ── */
  const status = el('div', 'local-data-status');
  status.dataset.role = 'status';
  status.dataset.code = 'none';
  status.dataset.kind = 'none';
  screen.appendChild(status);
  const say = (msg: string, code: string, kind: 'info' | 'warn' | 'error'): void => {
    status.textContent = msg;
    status.dataset.code = code;
    status.dataset.kind = kind;
  };

  /* ── ① 授权状态 ── */
  const consentRow = el('div', 'local-data-row');
  consentRow.dataset.role = 'consent';
  const consentState = el('div', 'local-data-note', consentLabel(store.consent()));
  consentState.dataset.role = 'consent-state';
  consentRow.appendChild(consentState);

  const consentActions = el('div', 'local-data-actions');

  /**
   * 「改变选择」：把授权打回 `unknown` 再回主界面 ⇒ `showStartScreen()` 会**重新问**一次。
   * 为什么必须 `reset()`（而不是只 `back()`）：授权状态不落盘，`allowed`/`denied` 下
   * `showStartScreen()` 会直接进主页 ⇒ 那个按钮就成了**死按钮**（点了什么都没发生）。
   * ⚠️ 它**不删除**已保存的数据：删数据是「清除本机数据」的职责，且那条路要求显式确认。
   */
  const changeBtn = button('btn', t('local-data.change-consent'), () => {
    store.reset();
    nav.back();
  });
  changeBtn.dataset.role = 'change-consent';
  consentActions.appendChild(changeBtn);

  /* ── 清除本机数据（屏内确认，**不用** `window.confirm` —— 它在 DOM 桩下无法测试） ── */
  const confirmRow = el('div', 'local-data-row');
  confirmRow.dataset.role = 'clear-confirm';
  // 默认**空容器**（不是"渲染好再 display:none"）：空容器让"点之前屏上没有确认"成为可断言的事实
  screen.appendChild(confirmRow);

  const refreshConsent = (): void => {
    consentState.textContent = consentLabel(store.consent());
  };

  const doClear = (): void => {
    confirmRow.textContent = '';
    let removed: number;
    try {
      // ⚠️ 必须传 `store.kv()`：游客模式下它是**内存 KV** ⇒ persistent 的 set/remove 恒 0（红线 3）；
      //    传 persistent 会在游客模式下直接碰盘。
      // ⚠️ `clearAllLocalData` **不吞** get/remove 的抛错（storage.ts 的能力边界表）⇒ 这里自己兜。
      removed = clearAllLocalData(store.kv());
    } catch (e) {
      say(t('local-data.clear-failed', { detail: describeError(e) }), 'clear-failed', 'error');
      return;
    }
    store.reset(); // 回 unknown ⇒ 下次启动会重新问
    refreshConsent();
    refreshStored();
    // ★ 2026-10-01（P0）：语言跟着 `L1_SETTINGS` 整键被清掉了 ⇒ 这一行要重画回默认语言，
    //   否则屏上还显示着清除前那个语言（那会让人以为"语言没被清掉"）。
    refreshLang();
    say(t('local-data.clear-ok', { n: String(removed) }), 'clear-ok', 'info');
  };

  const openClearConfirm = (): void => {
    confirmRow.textContent = '';
    confirmRow.appendChild(el(
      'div',
      'local-data-note',
      t('local-data.clear-note'),
    ));
    const acts = el('div', 'local-data-actions');
    const yes = button('btn', t('local-data.clear-yes'), doClear);
    yes.dataset.role = 'clear-yes';
    const no = button('btn', t('common.cancel'), () => { confirmRow.textContent = ''; });
    no.dataset.role = 'clear-no';
    acts.appendChild(yes);
    acts.appendChild(no);
    confirmRow.appendChild(acts);
  };

  const clearBtn = button('btn', t('local-data.clear'), openClearConfirm);
  clearBtn.dataset.role = 'clear';
  consentActions.appendChild(clearBtn);
  consentRow.appendChild(consentActions);
  screen.appendChild(consentRow);

  /* ── ② 昵称 / 设置 / 卡组 ── */
  const nickRow = el('div', 'local-data-row');
  nickRow.dataset.role = 'nick';
  const nickLine = el('div', 'local-data-nick-line');
  nickLine.appendChild(el('span', 'local-data-note', t('local-data.nick.label')));
  const nickInput = document.createElement('input');
  nickInput.type = 'text';
  nickInput.className = 'local-data-nick-input';
  nickInput.dataset.role = 'nick-input';
  nickInput.placeholder = t('local-data.nick.placeholder');
  nickLine.appendChild(nickInput);
  nickRow.appendChild(nickLine);

  const nickActions = el('div', 'local-data-actions');
  const nickBtn = button('btn', t('local-data.nick.save'), () => {
    let ok = false;
    try {
      // `writeJson` 把 `set` 的抛错翻成返回值，但 `readJson` 的 `get` 仍会外抛 ⇒ 这里也兜一层。
      ok = writeNickName(store, nickInput.value);
    } catch (e) {
      ok = false;
      say(t('local-data.nick.write-failed'), 'nick-write-failed', 'error');
      void e;
      return;
    }
    // 计划 Step 4 的口径：写失败**如实**提示，绝不假装成功（`writeNickName` 的返回值就是判据）
    say(
      ok ? t('local-data.nick.ok') : t('local-data.nick.write-failed'),
      ok ? 'nick-ok' : 'nick-write-failed',
      ok ? 'info' : 'error',
    );
    refreshStored();
  });
  nickBtn.dataset.role = 'nick-save';
  nickActions.appendChild(nickBtn);
  nickRow.appendChild(nickActions);
  screen.appendChild(nickRow);

  const storedRow = el('div', 'local-data-row');
  storedRow.dataset.role = 'stored';
  screen.appendChild(storedRow);

  /* ── ②a ★ 2026-10-01（P0）：**语言** ──
   *
   * 用户口径（方案 §6「存储与隐私」）：新加的存储**必须**在这屏里可见、可清除。
   *
   * ## 核清结论：语言**不在** `clearAllLocalData` 的键表里，但这**不是**漏掉
   *
   * ★ 2026-10-01（P0）核清：`lang` 是**既有 `L1_SETTINGS` 键里新增的一个字段**，
   * 不是一个新的存储键（`L1Settings.lang`，见 `src/app/local-store.ts`）。所以：
   *  - **可见**：就是下面这一行 —— 读数走 `readLang` 的**同一套守卫**，
   *    形状不对（存储里是 `'xx'` / `42`）时回默认中文，与 `t()` 的回退同源；
   *  - **可清除**：`clearAllLocalData` 清的就是 `L1_SETTINGS` 这个整键 ⇒ 语言跟着昵称一起没，
   *    清完这屏重画时这一行会显示回默认中文（下面 `doClear` 里调了 `refreshStored()`）。
   *
   * ⇒ **不需要**动 `clearAllLocalData` 的键表（也没动）；这里补的是"可见"这一半，
   *   以及"读数"这一半 —— 两者都由 `tests/ui/local-data-screen.test.ts` 第 11 组盯着。
   *
   * ## ★ 2026-10-01（P0 线上验收 D1 + D4）
   *
   * **D1（真 bug）**：第一版用 `isLang(raw) ? '' : tail` 判"要不要挂那句警告"，而
   * `readLang()` 把"键不存在"与"值是坏值"**都回成 `undefined`** ⇒ 全新访客与刚点完
   * 「清除本机数据」的人都被告知「本机存的不是一个有效值」（线上实测 5 种形态：
   * 键不存在 / `{"lang":"xx"}` / 坏 JSON 都带那句；`zh` / `en` 正常）。
   * 修法：**分开问"键在不在"** —— `readLangPresence()` 给三态
   * （`'absent'` / `'present'` / `'unreadable'`），只有 `'present'` 且值不是 `zh`/`en`
   * 时才挂那句警告；键不存在 ⇒ 就一句「界面语言：中文」。
   *
   * **D4（口径纠错）**：这一屏**没有做过 i18n**（P0 只抽了设置小窗）—— 所以这一行
   * 现在走 `t()`（它是**语言功能自己的读数**，双语是它自己的需求）。**其余文案仍然留在
   * "尚未抽取的屏"清单里**（`docs/2026-10-01-i18n-尚未抽取的屏.md` 的 A 节，
   * 这一屏继续登记着，不许划掉）。
   *
   * 版式复用本屏既有的 `.local-data-*` 类（不新增 CSS 类 ⇒ 与 5 张既有 CSS 零冲突那条腿不动）。 */
  const langRow = el('div', 'local-data-row');
  langRow.dataset.role = 'lang';
  langRow.appendChild(el('div', 'local-data-note', t('local-data.lang.label')));
  const langLine = el('div', 'local-data-privacy-line');
  langLine.dataset.role = 'lang-state';
  langRow.appendChild(langLine);
  screen.appendChild(langRow);

  /**
   * 读一次语言并写在屏上。
   *
   * ⚠️ 与 `refreshStored` 分开（而不是并进去）的理由：两者的失败形态与刷新时机不同 ——
   * 语言是**单值**、读失败就该显示"读不出来"；而 `stored` 那一块失败要整块报错。
   * 混成一处会让"语言读不出来"看起来像"昵称与卡组都读不出来"。
   *
   * 标签取 `LANGS` 的**唯一出处**（`src/i18n/lang.ts`），本文件不写第二份语言名清单。
   *
   * ★ D1 的四态（这是这条腿的核心，别退回"看 `readLang()` 是不是 undefined"）：
   *  - `'unreadable'`：读存储本身抛错 ⇒ 如实报失败 + 真因；
   *  - `'present'` 且值**不是** `zh`/`en`（含坏 JSON / 非对象）⇒ 用默认语言 + 挂那句"不是一个有效值"；
   *  - `'absent'`（键不存在：全新访客 / 刚清除完）与 `'unset'`（键在但**没有 `lang` 字段**，
   *    例如只存过昵称的 `{"nick":"甲"}`）⇒ **就一句**「界面语言：中文」，**不许**挂警告。
   *    ⚠️ `'unset'` 这一档是用户 2026-10-01 亲自裁定的：那时本机**从来没有**存过语言，
   *    说"存的不是一个有效值"是不实陈述（与"缺键"是同一件事）。
   */
  const refreshLang = (): void => {
    let raw: unknown;
    let presence: ReturnType<typeof readLangPresence>;
    try {
      raw = readLang(store);
      presence = readLangPresence(store);
    } catch (e) {
      langLine.textContent = t('local-data.lang.read-failed', { detail: describeError(e) });
      return;
    }
    const lang: Lang = isLang(raw) ? raw : DEFAULT_LANG;
    const found = LANGS.find((l) => l.id === lang);
    const value = t('local-data.lang.value', { lang: found?.label ?? lang });
    // 只有"`lang` 字段在、但值不是有效语言"（含坏 JSON / 非对象）才挂那句补充
    const badStoredValue = presence === 'present' && !isLang(raw);
    langLine.textContent = badStoredValue ? `${value}${t('local-data.lang.invalid')}` : value;
  };
  refreshLang();

  /* ── ②b ★ 2026-10-01：卡牌制作器存在本机的那一份（可见 + 可清除） ──
   *
   * 用户口径：新加的存储必须在那屏里可见、可清除。制作器的牌组住在 IndexedDB，
   * 所以它不在 `clearAllLocalData` 的键表里，走下面这两个 nav 接缝。
   * 版式复用本屏既有的 `.local-data-*` 类（不新增 CSS 类 ⇒ 与 5 张既有 CSS 零冲突那条腿不动）。 */
  const makerRow = el('div', 'local-data-row');
  makerRow.dataset.role = 'cardmaker';
  makerRow.appendChild(el('div', 'local-data-note', t('local-data.cardmaker.label')));
  const makerLine = el('div', 'local-data-privacy-line', t('local-data.cardmaker.reading'));
  makerLine.dataset.role = 'cardmaker-state';
  makerRow.appendChild(makerLine);
  const makerActions = el('div', 'local-data-actions');
  // 回调先挂一个占位（`button()` 的第三参是必填的），真实处理器在下面定义好之后
  // 用 `addEventListener` 挂上 —— 这样 `clearCardmakerNow` 不必提到使用点之前
  // （本仓的 `button()` 是"三参必填"的既有形状，为它破例会动到别的屏）。
  const makerClear = button('btn', t('local-data.cardmaker.clear'), () => { /* 见下方 addEventListener */ });
  makerClear.dataset.role = 'clear-cardmaker';
  makerActions.appendChild(makerClear);
  makerRow.appendChild(makerActions);
  screen.appendChild(makerRow);

  /**
   * 读一次"制作器存了什么"。
   *
   * ## 三态三句话，**"空的"与"读不到"必须分开说**（线上验收 D1，2026-10-01）
   *
   *  - `count === 0`：库开得了、只是**没有记录** ⇒ "本机还没有保存过牌组"。
   *    这一档覆盖**全新访客**与**刚点完清除的人** —— 两种情况都不该显示成"读不到"。
   *  - `count > 0`：报张数。
   *  - `count === null`：**真读不出来**（没有 IndexedDB / `open()` 抛错 / 坏记录）⇒ 才是"读不到"。
   *  - host 抛错：另一个通道，如实写失败原因。
   *
   * ⚠️ 第一版把前两档折叠成一句"读不到本机的数据（这台设备可能没有可用的 IndexedDB，
   * 或库被别的程序占着）"⇒ 全新访客与刚点完清除的用户都会以为**自己刚点的清除把东西弄坏了**。
   * 判据落在 `nav.readCardmaker()` 的 `count` 上（三态由宿主与
   * `src/ui/cardmaker/store-idb.ts` 的 `readCardmakerDeckInfo` 一起保证）。
   */
  const refreshCardmaker = async (): Promise<void> => {
    let info: { count: number | null };
    try {
      info = await nav.readCardmaker();
    } catch (e) {
      makerLine.textContent = t('local-data.cardmaker.read-failed', { detail: describeError(e) });
      return;
    }
    if (info.count === null) {
      makerLine.textContent = t('local-data.cardmaker.unreadable');
      return;
    }
    makerLine.textContent = info.count === 0
      ? t('local-data.cardmaker.empty')
      : t('local-data.cardmaker.count', { n: String(info.count) });
  };
  void refreshCardmaker();

  /**
   * 「清除卡牌制作器的本机数据」。三态**不许折叠**（与档案那两条同款纪律）：
   *  - 真删掉 ⇒ `clear-cardmaker-ok`；
   *  - 本来就没有（`removed === false`）⇒ `clear-cardmaker-empty`，**不是失败**；
   *  - 删失败 / 宿主抛错 ⇒ `clear-cardmaker-failed` + 真因。
   */
  const clearCardmakerNow = async (): Promise<void> => {
    let out: { ok: boolean; removed?: boolean; detail?: string };
    try {
      out = await nav.clearCardmaker();
    } catch (e) {
      say(t('local-data.cardmaker.clear-failed', { detail: describeError(e) }), 'clear-cardmaker-failed', 'error');
      return;
    }
    if (!out.ok) {
      say(t('local-data.cardmaker.clear-failed', { detail: out.detail ?? t('local-data.error.no-reason') }), 'clear-cardmaker-failed', 'error');
      return;
    }
    if (out.removed === false) {
      say(t('local-data.cardmaker.clear-empty'), 'clear-cardmaker-empty', 'info');
    } else {
      say(t('local-data.cardmaker.clear-ok'), 'clear-cardmaker-ok', 'info');
    }
    void refreshCardmaker();
  };
  makerClear.addEventListener('click', () => { void clearCardmakerNow(); });

  /** 刷新"本机已保存"区（昵称输入框 / 卡组列表）；读取失败**如实显示**，不静默成"什么都没有"。 */
  const refreshStored = (): void => {
    storedRow.textContent = '';
    let nick = '';
    let decks: ReturnType<typeof readDecks> = [];
    try {
      nick = readNickName(store);
      decks = readDecks(store);
    } catch (e) {
      storedRow.appendChild(el('div', 'local-data-note', t('local-data.read-failed', { detail: describeError(e) })));
      return;
    }
    nickInput.value = nick;
    storedRow.appendChild(el(
      'div',
      'local-data-note',
      t('local-data.stored', {
        nick: nick === '' ? t('local-data.nick.unset') : nick,
        n: String(decks.length),
      }),
    ));
    for (const d of decks) {
      storedRow.appendChild(el(
        'div',
        'local-data-privacy-line',
        t('local-data.deck-line', {
          name: d.name,
          n: String(d.defIds.length),
          seed: d.seed.slice(0, 8),
        }),
      ));
    }
    if (decks.length === 0) {
      storedRow.appendChild(el('div', 'local-data-privacy-line', t('local-data.deck-empty')));
    }
  };
  refreshStored();

  /* ── ③ 隐私说明全文（**生成式**：唯一出处 = privacyLines()） ── */
  const privacyRow = el('div', 'local-data-row');
  privacyRow.dataset.role = 'privacy';
  privacyRow.appendChild(el('div', 'local-data-note', t('local-data.privacy.title')));
  for (const line of privacyLines()) {
    privacyRow.appendChild(el('p', 'local-data-privacy-line', line));
  }
  screen.appendChild(privacyRow);

  /* ── ③ 档案：导出 / 导入 ── */
  const archiveRow = el('div', 'local-data-row');
  archiveRow.dataset.role = 'archive';
  archiveRow.appendChild(el('div', 'local-data-note', t('local-data.archive.title')));
  archiveRow.appendChild(el(
    'div',
    'local-data-privacy-line',
    t('local-data.archive.blurb'),
  ));
  screen.appendChild(archiveRow);

  /**
   * 「重放这一局」（G4 Task 5）：**导入成功之前不可见、也不可点**。
   *
   * ⚠️ **为什么必须这样实现**（读本函数的结构得出，不是风格偏好）：本屏是**单次构建** ——
   * `root.appendChild(screen)` 是唯一的出口，进入之后只有状态区那个 `say()`（**本函数内唯一**的
   * 写屏通道，刻意不写行号：行号会漂，锚点用符号名）会改屏，
   * 而这一行按钮是**渲染期一次性拼好**的。若为了让它出现而**整屏重渲染**，会当场抹掉状态区
   * 里那句校验报告**和用户正在输入的昵称**（`nick-input`）。⇒ 两道闸门：
   *   ① `hidden = true`（初始不可见；导入成功后由 `doImport` 翻成 `false`）；
   *   ② 点击回调里的 `lastImported === null` 早退（**即使**有人绕过 `hidden` 直接派发点击，
   *      也零回调 —— 覆盖"不可点"而不只是"看不见"）。
   *
   * 交出去的必须是**刚导入的那一份**（`lastImported`，在 `doImport` 拿到 `outcome.file` 的同一处
   * 赋值），不是"重新拼一份" —— 后者会与校验通过的那份分叉。
   */
  let lastImported: MatchFile | null = null;
  const replayBtn = button('btn', t('local-data.replay'), () => {
    if (lastImported === null) return;
    nav.startReplay(lastImported);
  });
  replayBtn.dataset.role = 'replay';
  replayBtn.hidden = true;

  const doExport = async (): Promise<void> => {
    let file: MatchFile;
    let pack: { name: string; text: string };
    try {
      // G4 D9：档案来自**宿主的内存记录器**（`nav.buildArchive`）。没有记录时它只给 `reason`
      // ⇒ **拒绝导出并说明**。绝不再退化去导一份 `actions: []` 的"本机数据快照"：那会让玩家
      // 以为"我导出的就是对局"，而这正是 D9 要消掉的假象。
      const build = nav.buildArchive();
      if (!('file' in build)) {
        // 码名与其它导出分支并列（`data-code` 是机器可读出口）；`reason` 由宿主给、本屏原样显示
        say(t('local-data.export.refused', { detail: build.reason }), 'export-refused', 'error');
        return;
      }
      file = build.file;
      pack = archivePack(file);
    } catch (e) {
      say(t('local-data.export.failed', { detail: describeError(e) }), 'export-failed', 'error');
      return;
    }
    say(t('local-data.export.waiting', { name: pack.name }), 'export-waiting', 'info');
    let out: SaveOutcome;
    try {
      out = await nav.saveFile.save({ suggestedName: pack.name, text: pack.text });
    } catch (e) {
      // 契约上 `save()` 永不 reject；这层兜的是宿主假件/将来实现
      say(t('local-data.export.failed', { detail: describeError(e) }), 'export-threw', 'error');
      return;
    }
    if (!out.ok) {
      // 三态各说各的：**用户自己点的取消**绝不显示成"保存失败"（假警报）
      if (out.reason === 'cancelled') {
        say(t('local-data.export.cancelled'), 'export-cancelled', 'info');
        return;
      }
      if (out.reason === 'unsupported') {
        say(t('local-data.export.unsupported'), 'export-unsupported', 'error');
        return;
      }
      say(t('local-data.export.failed', { detail: out.detail }), 'export-failed', 'error');
      return;
    }
    say(
      t('local-data.export.ok', { name: out.name, n: String(file.actions.length) }),
      'export-ok',
      'info',
    );
  };

  const doImport = async (): Promise<void> => {
    // ⚠️ 等待态（协调者裁决）：`pickTimeoutMs` **不传**（缺省 0 = 不设窗口）——
    //    给窗口会把"用户慢慢挑文件"误判成取消。代价用"可见且不阻塞"兜住：**不禁用任何按钮**、
    //    不挂永不消失的 spinner；别处的任何操作都会把这条提示替换掉（`say` 是唯一写它的地方）。
    say(t('local-data.import.waiting'), 'import-waiting', 'info');

    let picked: PickOutcome;
    try {
      picked = await nav.pickFile.open({ accept: [ARCHIVE_MIME] });
    } catch (e) {
      say(t('local-data.archive.import-failed', { detail: describeError(e) }), 'import-threw', 'error');
      return;
    }

    if (!picked.ok) {
      // 三态可辨识（`PickOutcome` 的契约）：**不许**把三者折叠成一个值
      if (picked.reason === 'cancelled') {
        // 用户自己点的取消 = 正常路径：屏上不出现任何"失败/不支持"字样
        say(t('local-data.import.cancelled'), 'pick-cancelled', 'info');
        return;
      }
      if (picked.reason === 'unsupported') {
        say(t('local-data.import.unsupported'), 'pick-unsupported', 'error');
        return;
      }
      say(t('local-data.archive.import-failed', { detail: picked.detail }), 'pick-failed', 'error');
      return;
    }

    // `PickedFile.size` 存在的**唯一**目的：在 `text()` 之前挡掉超大文件（否则内存会被打满）
    if (picked.file.size > MAX_ARCHIVE_BYTES) {
      say(
        failureText({
          code: 'too-large',
          message: t('local-data.import.too-large', {
            size: String(picked.file.size),
            max: String(MAX_ARCHIVE_BYTES),
          }),
        }),
        'too-large',
        'error',
      );
      return;
    }

    let text: string;
    try {
      text = await picked.file.text();
    } catch (e) {
      // ⚠️ 契约里 `text()` 的失败形态是 **reject**。它映射到 `ImportOutcome` 早已预留、
      //    纯逻辑却永不产出的 `read-failed`（archive-io.ts 的注）：于是 UI 的错误分支只有一处。
      //    绝不许把 reject 吞成空串（那会变成"导入成功但 0 步"的假成功）。
      say(
        failureText({ code: 'read-failed', message: t('local-data.import.read-failed', { detail: describeError(e) }) }),
        'read-failed',
        'error',
      );
      return;
    }

    const outcome: ImportOutcome = importArchive(text, { currentHash: CARD_DATA_HASH });
    if (!outcome.ok) {
      // `code` 直接落进 `data-code`（UI 的 `switch` 只需写一次）；`message` 是 archive-io 给的真因
      say(failureText(outcome), outcome.code, 'error');
      return;
    }

    // 警告**生成式**渲染（一条都不许吞）：它们说的是"卡牌数据可能不同""createdAt 不是 ISO"…
    const warnings = outcome.warnings;
    // 拼装顺序与改动前**逐字对应**（测试断言的那几句在这三个键里）
    say(
      t('local-data.import.ok', { n: String(outcome.file.actions.length) })
      + (warnings.length === 0
        ? t('local-data.import.no-warnings')
        : t('local-data.import.warnings', { n: String(warnings.length), list: warnings.join('；') }))
      + t('local-data.import.ok-tail'),
      'import-ok',
      warnings.length === 0 ? 'info' : 'warn',
    );
    // ① 留下这一份（「重放这一局」交出去的就是它）；② 解禁按钮 —— 两件事都在**同一处**做，
    //    免得"报告说能重放、按钮却还藏着"这一类不一致。顺序：先留档、再解禁、后通知宿主。
    lastImported = outcome.file;
    replayBtn.hidden = false;
    nav.onImported(outcome.file, warnings);
  };

  const archiveActions = el('div', 'local-data-actions');
  const exportBtn = button('btn', t('local-data.export.btn'), () => { void doExport(); });
  exportBtn.dataset.role = 'export';
  const importBtn = button('btn', t('local-data.import.btn'), () => { void doImport(); });
  importBtn.dataset.role = 'import';
  const backBtn = button('btn', t('local-data.back'), () => { nav.back(); });
  backBtn.dataset.role = 'back';
  archiveActions.appendChild(exportBtn);
  archiveActions.appendChild(importBtn);
  // 按钮在**渲染期**就进 DOM（初始 `hidden` ⇒ 不可见、且点击回调自带闸门 ⇒ 不可点）：
  // 本屏只渲染一次，导入成功时**不能**重渲染来加它（那会抹掉状态区与正在输入的昵称）。
  archiveActions.appendChild(replayBtn);
  archiveActions.appendChild(backBtn);
  screen.appendChild(archiveActions);

  root.appendChild(screen);
}
