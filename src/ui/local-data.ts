/**
 * 「本地数据与隐私」屏（G3 Task 7；设计稿 `§3.5` / `§3.6` / `§3.7` 的可见化）。
 *
 * 三块内容（计划 Task 7 设计要点 1）：
 *  ① **授权状态**：当前是"允许"还是"游客" + 「改变选择」+ 「清除本机数据」；
 *  ② **昵称 / 设置 / 卡组**：昵称可编辑（写失败如实提示，不假装成功）；
 *  ③ **隐私说明全文**（唯一出处 = `src/app/privacy.ts` 的 `privacyLines()`，**生成式**渲染，
 *     本文件不写第二份措辞）+ 档案「导出 / 导入」两个按钮。
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
  readNickName,
  writeNickName,
  type ConsentState,
  type LocalStore,
} from '../app/local-store';
import { MATCH_FILE_FORMAT, MATCH_FILE_VERSION, type MatchFile } from '../app/match-file';
import { privacyLines } from '../app/privacy';

export interface LocalDataNav {
  /** 回主界面（授权若被重置，会重新问） */
  back(): void;
  store: LocalStore;
  pickFile: FilePicker;
  saveFile: FileSink;
  /**
   * 档案导入成功后的接缝（**只报告，不重放** —— `ReplayDriver` 属 G4）。
   * 用户可见的报告落在本屏的状态区；宿主拿到 `file` / `warnings` 去做 G4 的事。
   */
  onImported(file: MatchFile, warnings: string[]): void;
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
    case 'allowed': return '当前：允许保存到本机（昵称与卡组会写进你自己的浏览器存储）';
    case 'denied': return '当前：游客模式（本次会话不写入你的数据，刷新或关闭即丢失）';
    case 'ask': return '当前：正在等你选择是否保存到本机';
    default: return '当前：尚未选择（下次启动会先问你）';
  }
}

/**
 * 宿主的任意异常 → 一句**非空**的诊断文本（与 `src/ui/archive-fs-browser.ts` 的
 * `describeError` 同形：`Error` / 字符串 / 任意对象三种形状都认，**永不抛**）。
 */
function describeError(e: unknown): string {
  if (typeof e === 'string') return e.trim() === '' ? '未知错误（宿主没有给出描述）' : e;
  if (e instanceof Error) return e.message !== '' ? e.message : e.name;
  try {
    const s = String(e);
    return s.trim() === '' ? '未知错误（宿主没有给出描述）' : s;
  } catch {
    return '宿主抛出了一个无法描述的对象';
  }
}

/**
 * 失败码 → 给玩家看的一句话。四条判据共用**同一个**出口：
 *  - `read-failed` 的文案由**本层**定（`archive-io.ts` 的注里写明：这个码永不从纯逻辑产出，
 *    就是留给这一层合成的）；其余码统一加"导入失败："前缀，`message` 原样透传真因。
 */
function failureText(o: { code: string; message: string }): string {
  return o.code === 'read-failed' ? `读取档案失败：${o.message}` : `导入失败：${o.message}`;
}

/* ── 本机数据快照档案（导出按钮的唯一内容来源） ─────────────────────────────── */

/** 本机还没有任何卡组时，快照档案用的固定种子（**常量**：两次导出必须逐字节相同） */
const SNAPSHOT_SEED = 'local-data-snapshot';
/** 本机没有任何可用的卡组时间戳时的固定 `createdAt`（同上：不许读时钟） */
const SNAPSHOT_CREATED_AT = '1970-01-01T00:00:00.000Z';

/**
 * 把本机 L1 数据包装成一份**档案**（`MatchFile`）。
 *
 * ⚠️ **为什么是"本机数据快照"而不是"导出当前对局"**（如实说明本阶段的边界）：
 *  - G3 的对局记录器（`createMatchFileRecorder`，Task 1）**还没有接进引擎**，重放属 G4；
 *  - `LocalDataNav`（计划 Task 7 定死的接口）**不携带任何对局来源** ⇒ 本屏拿不到"当前对局"；
 *  - 于是本屏能导出的只有它真有的东西：昵称（`players[0].nick`）与第一份卡组绑定的种子/时刻，
 *    `actions` 为空数组（"还没有记录任何操作"）。屏上的文案把这件事**明说**给用户，
 *    且导入成功后仍然会报告"本阶段还不能直接重放"（G3/G4 边界的可见化）。
 *
 * 确定性：`createdAt` **不读时钟**（`src/app` 连 `Date.now` 都是禁的，且"两次导出逐字节相同"
 * 要求它只依赖本机数据）⇒ 有卡组时取它的 `updatedAt`，否则用固定常量。
 */
function snapshotMatchFile(store: LocalStore): MatchFile {
  const decks = readDecks(store);
  const first = decks.length > 0 ? decks[0] : null;
  return {
    format: MATCH_FILE_FORMAT,
    version: MATCH_FILE_VERSION,
    cardDataHash: CARD_DATA_HASH,
    seed: first !== null && first.seed !== '' ? first.seed : SNAPSHOT_SEED,
    setup: {
      draftMode: 'normal',
      draftStarter: 0,
      firstToPlay: 1,
      // 快照档案里没有对局：池与选/禁的**顺序快照**都为空（不是"猜一个"）
      draftPool: [],
      draftPicks: [],
      bannedProtocols: [],
    },
    players: [{ nick: readNickName(store) }, { nick: '' }],
    actions: [],
    createdAt: first !== null && first.updatedAt !== '' ? first.updatedAt : SNAPSHOT_CREATED_AT,
  };
}

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
  screen.appendChild(el('h1', 'local-data-title', '本地数据与隐私'));

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
  const changeBtn = button('btn', '改变选择', () => {
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
      say(`清除本机数据失败：${describeError(e)}。本机数据可能仍有残留，请稍后再试。`, 'clear-failed', 'error');
      return;
    }
    store.reset(); // 回 unknown ⇒ 下次启动会重新问
    refreshConsent();
    refreshStored();
    say(`已清除本机数据（${removed} 项）。下次启动会重新询问是否保存到本机。`, 'clear-ok', 'info');
  };

  const openClearConfirm = (): void => {
    confirmRow.textContent = '';
    confirmRow.appendChild(el(
      'div',
      'local-data-note',
      '清除后，本机保存的昵称与卡组会被删除，并且下次启动会重新询问是否保存到本机。',
    ));
    const acts = el('div', 'local-data-actions');
    const yes = button('btn', '确认清除', doClear);
    yes.dataset.role = 'clear-yes';
    const no = button('btn', '取消', () => { confirmRow.textContent = ''; });
    no.dataset.role = 'clear-no';
    acts.appendChild(yes);
    acts.appendChild(no);
    confirmRow.appendChild(acts);
  };

  const clearBtn = button('btn', '清除本机数据', openClearConfirm);
  clearBtn.dataset.role = 'clear';
  consentActions.appendChild(clearBtn);
  consentRow.appendChild(consentActions);
  screen.appendChild(consentRow);

  /* ── ② 昵称 / 设置 / 卡组 ── */
  const nickRow = el('div', 'local-data-row');
  nickRow.dataset.role = 'nick';
  const nickLine = el('div', 'local-data-nick-line');
  nickLine.appendChild(el('span', 'local-data-note', '昵称'));
  const nickInput = document.createElement('input');
  nickInput.type = 'text';
  nickInput.className = 'local-data-nick-input';
  nickInput.dataset.role = 'nick-input';
  nickInput.placeholder = '给自己起个昵称';
  nickLine.appendChild(nickInput);
  nickRow.appendChild(nickLine);

  const nickActions = el('div', 'local-data-actions');
  const nickBtn = button('btn', '保存昵称', () => {
    let ok = false;
    try {
      // `writeJson` 把 `set` 的抛错翻成返回值，但 `readJson` 的 `get` 仍会外抛 ⇒ 这里也兜一层。
      ok = writeNickName(store, nickInput.value);
    } catch (e) {
      ok = false;
      say(`本机保存失败，本次会话仍可正常游玩。`, 'nick-write-failed', 'error');
      void e;
      return;
    }
    // 计划 Step 4 的口径：写失败**如实**提示，绝不假装成功（`writeNickName` 的返回值就是判据）
    say(
      ok ? '昵称已保存到本机。' : '本机保存失败，本次会话仍可正常游玩。',
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

  /** 刷新"本机已保存"区（昵称输入框 / 卡组列表）；读取失败**如实显示**，不静默成"什么都没有"。 */
  const refreshStored = (): void => {
    storedRow.textContent = '';
    let nick = '';
    let decks: ReturnType<typeof readDecks> = [];
    try {
      nick = readNickName(store);
      decks = readDecks(store);
    } catch (e) {
      storedRow.appendChild(el('div', 'local-data-note', `读取本机数据失败：${describeError(e)}`));
      return;
    }
    nickInput.value = nick;
    storedRow.appendChild(el(
      'div',
      'local-data-note',
      `本机已保存：昵称「${nick === '' ? '未设置' : nick}」· 卡组 ${decks.length} 组`,
    ));
    for (const d of decks) {
      storedRow.appendChild(el(
        'div',
        'local-data-privacy-line',
        `卡组「${d.name}」：${d.defIds.length} 张 · 种子 ${d.seed.slice(0, 8)}`,
      ));
    }
    if (decks.length === 0) {
      storedRow.appendChild(el('div', 'local-data-privacy-line', '本机还没有保存任何卡组。'));
    }
  };
  refreshStored();

  /* ── ③ 隐私说明全文（**生成式**：唯一出处 = privacyLines()） ── */
  const privacyRow = el('div', 'local-data-row');
  privacyRow.dataset.role = 'privacy';
  privacyRow.appendChild(el('div', 'local-data-note', '隐私说明（完整）'));
  for (const line of privacyLines()) {
    privacyRow.appendChild(el('p', 'local-data-privacy-line', line));
  }
  screen.appendChild(privacyRow);

  /* ── ③ 档案：导出 / 导入 ── */
  const archiveRow = el('div', 'local-data-row');
  archiveRow.dataset.role = 'archive';
  archiveRow.appendChild(el('div', 'local-data-note', '对局档案（导出 / 导入）'));
  archiveRow.appendChild(el(
    'div',
    'local-data-privacy-line',
    '导入的档案会当场校验（格式、版本、卡牌数据指纹与每条操作的形状）。'
    + '本阶段还没有对局记录器与重放：导出的是一份本机数据快照档案（昵称 + 卡组种子 + 卡牌数据指纹，'
    + '不含任何对局操作），导入成功后也只能报告校验结果 —— 重放功能在下一阶段。',
  ));
  screen.appendChild(archiveRow);

  const doExport = async (): Promise<void> => {
    let file: MatchFile;
    let pack: { name: string; text: string };
    try {
      file = snapshotMatchFile(store);
      pack = archivePack(file);
    } catch (e) {
      say(`导出档案失败：${describeError(e)}`, 'export-failed', 'error');
      return;
    }
    say(`正在导出档案：${pack.name}`, 'export-waiting', 'info');
    let out: SaveOutcome;
    try {
      out = await nav.saveFile.save({ suggestedName: pack.name, text: pack.text });
    } catch (e) {
      // 契约上 `save()` 永不 reject；这层兜的是宿主假件/将来实现
      say(`导出档案失败：${describeError(e)}`, 'export-threw', 'error');
      return;
    }
    if (!out.ok) {
      // 三态各说各的：**用户自己点的取消**绝不显示成"保存失败"（假警报）
      if (out.reason === 'cancelled') {
        say('已取消导出：档案没有写到任何地方。', 'export-cancelled', 'info');
        return;
      }
      if (out.reason === 'unsupported') {
        say('这台设备不支持保存文件，因此无法导出档案。', 'export-unsupported', 'error');
        return;
      }
      say(`导出档案失败：${out.detail}`, 'export-failed', 'error');
      return;
    }
    say(
      `档案已导出：${out.name}（${file.actions.length} 步操作）。`
      + '本阶段导出的档案不含对局记录（对局记录与重放在下一阶段）。',
      'export-ok',
      'info',
    );
  };

  const doImport = async (): Promise<void> => {
    // ⚠️ 等待态（协调者裁决）：`pickTimeoutMs` **不传**（缺省 0 = 不设窗口）——
    //    给窗口会把"用户慢慢挑文件"误判成取消。代价用"可见且不阻塞"兜住：**不禁用任何按钮**、
    //    不挂永不消失的 spinner；别处的任何操作都会把这条提示替换掉（`say` 是唯一写它的地方）。
    say('等待你选择档案文件…（选择框里可以取消；下面其它操作仍然可用）', 'import-waiting', 'info');

    let picked: PickOutcome;
    try {
      picked = await nav.pickFile.open({ accept: [ARCHIVE_MIME] });
    } catch (e) {
      say(`导入档案失败：${describeError(e)}`, 'import-threw', 'error');
      return;
    }

    if (!picked.ok) {
      // 三态可辨识（`PickOutcome` 的契约）：**不许**把三者折叠成一个值
      if (picked.reason === 'cancelled') {
        // 用户自己点的取消 = 正常路径：屏上不出现任何"失败/不支持"字样
        say('已取消选择档案：屏上没有任何改动。', 'pick-cancelled', 'info');
        return;
      }
      if (picked.reason === 'unsupported') {
        say('这台设备不支持导入档案。', 'pick-unsupported', 'error');
        return;
      }
      say(`导入档案失败：${picked.detail}`, 'pick-failed', 'error');
      return;
    }

    // `PickedFile.size` 存在的**唯一**目的：在 `text()` 之前挡掉超大文件（否则内存会被打满）
    if (picked.file.size > MAX_ARCHIVE_BYTES) {
      say(
        failureText({
          code: 'too-large',
          message: `档案过大（${picked.file.size} 字节 > 上限 ${MAX_ARCHIVE_BYTES} 字节）：本程序不会读取它`,
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
        failureText({ code: 'read-failed', message: `无法读取档案内容：${describeError(e)}` }),
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
    say(
      `档案已导入并校验通过（${outcome.file.actions.length} 步操作）`
      + (warnings.length === 0 ? '，没有任何警告' : `，有 ${warnings.length} 条警告：${warnings.join('；')}`)
      + '。本阶段还不能直接重放对局（重放功能在下一阶段，属 G4）。',
      'import-ok',
      warnings.length === 0 ? 'info' : 'warn',
    );
    nav.onImported(outcome.file, warnings);
  };

  const archiveActions = el('div', 'local-data-actions');
  const exportBtn = button('btn', '导出档案', () => { void doExport(); });
  exportBtn.dataset.role = 'export';
  const importBtn = button('btn', '导入档案', () => { void doImport(); });
  importBtn.dataset.role = 'import';
  const backBtn = button('btn', '← 返回主界面', () => { nav.back(); });
  backBtn.dataset.role = 'back';
  archiveActions.appendChild(exportBtn);
  archiveActions.appendChild(importBtn);
  archiveActions.appendChild(backBtn);
  screen.appendChild(archiveActions);

  root.appendChild(screen);
}
