import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  installStubDom,
  makeStubEl,
  descendants,
  queryAllIn,
  isClass,
  classOf,
  type StubNode,
} from './net-dom-stub';
import { renderLocalData, type LocalDataNav } from '../../src/ui/local-data';
// ★ 2026-10-01（用户要求）：设置从小窗落地 —— 本文件末尾第 9 组钉它的落点与行为
import { settingsOverlayElement } from '../../src/ui/home';
import { FX_SETTINGS, isMetal6StrobeOn, resetFxSettingsForTest, setMetal6Strobe } from '../../src/ui/fx-settings';
// ★ 2026-10-01（P0，i18n）：小窗的 nav 现在带着当前语言，所以这条"真跑一次"的用例要能给出它。
//   `getLang()` 的缺省是中文 ⇒ 下面那些逐字断言（`关闭` / `…（当前：关闭）`）与改动前一致。
import { getLang } from '../../src/i18n';
import {
  createLocalStore,
  readNickName,
  writeDecks,
  writeNickName,
  type DeckRecord,
  type LocalStore,
} from '../../src/app/local-store';
import { L1_DECKS, L1_SETTINGS, createMemoryStore, type KeyValueStore } from '../../src/app/storage';
import { privacyLines } from '../../src/app/privacy';
import { ARCHIVE_MIME, MAX_ARCHIVE_BYTES, importArchive } from '../../src/app/archive-io';
import {
  MATCH_FILE_FORMAT,
  MATCH_FILE_VERSION,
  matchFileFingerprint,
  stringifyMatchFile,
  type MatchFile,
} from '../../src/app/match-file';
import { CARD_DATA_HASH } from '../../src/app/card-data-hash';
import type { FilePicker, FileSink, PickOutcome, SaveOutcome } from '../../src/app/archive-fs';
import { stripComments, functionBody, objectBody } from './source-text';
/**
 * ★ 2026-10-01（线上验收 D1）：第 10 组最后那条"贯通腿"要用**真的** IndexedDB 层 +
 * **假的 IndexedDB 工厂**，所以从 `cardmaker-entry.test.ts` 借那个假件与两个真函数。
 * 那两个具名出口是**一态一义**的（`fakeIdb` 造件、`readCardmakerDeckInfo`/`clearCardmakerDeck`
 * 是产出代码），借过来不会产生"两份会漂移的夹具"。
 */
import { fakeIdb, sampleDeck } from './cardmaker-entry.test';
import { CARDMAKER_DECK_KEY, clearCardmakerDeck, readCardmakerDeckInfo } from '../../src/ui/cardmaker/store-idb';
import { defaultCard } from '../../src/ui/cardmaker/types';

/**
 * G3 Task 7 守卫 + G4 Task 5 的接线守卫：「本地数据与隐私」屏（`src/ui/local-data.ts`）。
 *
 * ## 本文件证明什么 / 不能证明什么（**不要读成"浏览器里已验证"**）
 *  **能**（全部是"真跑一次、拿返回值/调用记录"的行为腿，DOM 用手写桩 `tests/ui/net-dom-stub.ts`）：
 *   1. 屏上**逐条**含 `privacyLines()` 的当前返回值（生成式遍历，本文件不写第二份文案）；
 *   2. "清除本机数据"：屏内确认 → 真清 persistent 里的 L1 键 → `consent()` 回 `unknown`；
 *      取消 ⇒ 一个字节都不清；清除抛错 ⇒ 如实提示（不静默）；**游客模式下 persistent 的
 *      `set`/`remove` 调用数恒 0**（红线 3）；
 *   3. "导出档案"：档案**由宿主给**（`nav.buildArchive()`，G4 D9）⇒ 假 `FileSink` 收到的文本能被
 *      `importArchive` 原样读回，且**同一份 `MatchFile` 两次 `stringify` 逐字节相同**并且等于
 *      "解析后按稳定序列化重排"的字节（后者才是"没把稳定序列化换成 `JSON.stringify`"的判据
 *      —— 见 `导出稳定性` 一组的说明）；**没有记录时拒绝导出**并把宿主的 `reason` 显示出来；
 *   4. "导入档案"：`cancelled` / `unsupported` / `failed` **三态分别**可辨识，`text()` reject
 *      映射到 `read-failed`，损坏档案出错误文案且**不调** `onImported`，超大文件**不读**内容；
 *   5. 导入"永不 settle"时没有任何永久禁用/永久等待的形态（协调者 2026-09-16 裁决）；
 *   6. **G4 Task 5**：「重放这一局」在导入成功之前**不可见且不可点**（点它零回调），导入成功后
 *      解禁并把**刚导入的那一份**档案（按 `matchFileFingerprint` 比对内容）交给 `startReplay`；
 *      导入成功**仍然不自动离开本屏**（G3 那条腿的目的保留）；
 *   7. `src/main.ts` 的 `showLocalData` 接线区（G4 Task 5：五个宿主能力）+ 主页入口；
 *      `cb`/`rerender` 的 byte 级判据已由 G4 Task 4 **retarget**成"改动落点精确"（见第 8 组）。
 *  **不能**：真实浏览器里的观感、真实磁盘到底写没写、真实 `<input type=file>` 的取消语义
 *  （那些属计划 Task 7 Step 6 的无头自查与人眼验收）；也不能证明 `startReplay` 之后重放页真的
 *  能演（那是 `src/main.ts` 的路由 + 第五道门禁 replay 场景的覆盖面）。
 *
 * ⚠️ 桩用**现成的** `tests/ui/net-dom-stub.ts`（不复制第二份）。桩的已知边界：
 * `dispatchEvent` **只向祖先冒泡、不调用派发节点自己的监听器** ⇒ 点按钮必须用
 * `clickRole()` 的"临时挂一个空子节点、在它上面派发、再摘掉"手法（与 Task 4 的 `clickIn` 同源）。
 */

/* ---------------- 桩夹具：一个用例可挂多个根（LIFO 还原，防 document 泄漏） ---------------- */

const restores: Array<() => void> = [];

function mountRoot(): StubNode {
  restores.push(installStubDom());
  return makeStubEl('div');
}

afterEach(() => {
  while (restores.length > 0) restores.pop()?.();
  // ★ 2026-10-01：第 9 组会真的勾掉"金属6 频闪"（那是**模块级内存态**）⇒ 用完必须复位，
  // 否则这条腿会污染同进程里别的文件的默认值（vitest 各文件独立，但同文件内不该留脏）。
  resetFxSettingsForTest();
});

/** 渲染根的纯文本（按 DOM 顺序拼接全部元素节点的文本）。 */
function textOf(n: StubNode): string {
  return descendants(n).map((x) => x.text).join('\n');
}

/** 按 `data-role` 找节点（**生成式定位**：屏上每个可操作点都有唯一 role）。 */
function byRole(root: StubNode, role: string): StubNode[] {
  return queryAllIn(root, `[data-role="${role}"]`);
}

function one(root: StubNode, role: string): StubNode {
  const hits = byRole(root, role);
  expect(hits.length, `屏上应有唯一一个 [data-role="${role}"]，实际 ${hits.length} 个`).toBe(1);
  return hits[0];
}

/** 状态区的**机器可读**出口：`data-code`（人读的那句在 `textContent`）。 */
function statusCode(root: StubNode): unknown {
  return one(root, 'status').dataset.code;
}

function statusText(root: StubNode): string {
  return one(root, 'status').text;
}

/**
 * 在 `[data-role=role]` 的按钮上**真派发一次点击**并返回它的文案。
 *
 * ⚠️ 桩的 `dispatchEvent` 不调用派发节点自己的监听器（见文件头注）⇒ 临时挂一个空 `<span>`，
 * 在它上面派发，让冒泡路径**经过**按钮。派发完把按钮文案原样写回（`textContent = label` 会
 * 同时摘掉那个临时子节点），这样后续判据仍能读按钮文案。
 */
function clickRole(root: StubNode, role: string): string {
  const btn = one(root, role);
  const label = btn.text;
  const clicker = makeStubEl('span');
  btn.appendChild(clicker);
  clicker.dispatchEvent({ type: 'click', target: clicker });
  btn.textContent = label;
  return label;
}

/** 让已排队的 microtask / `await` 链跑完（假件的 Promise 都是立即 resolve 的）。 */
const flush = (): Promise<void> => new Promise<void>((r) => { setTimeout(r, 0); });

/** 读写桩上的 `input.value`（`StubNode` 接口没有声明它，桩上就是一个普通属性）。 */
function setInputValue(node: StubNode, v: string): void {
  (node as unknown as { value: string }).value = v;
}
function inputValue(node: StubNode): string {
  return (node as unknown as { value: string }).value;
}

/* ---------------- 假件 ---------------- */

type PickHandler = (opts: { accept: string[] }) => Promise<PickOutcome>;
type SaveHandler = (opts: { suggestedName: string; text: string }) => Promise<SaveOutcome>;

/** 默认假件 = 用户取消（三态里**最容易被错误地显示成"失败"**的那一态）。 */
const cancelledPick: PickHandler = async () => ({ ok: false, reason: 'cancelled', detail: '用户取消了选择' });
const cancelledSave: SaveHandler = async () => ({ ok: false, reason: 'cancelled', detail: '用户取消了保存' });

/** 记账假 KV（红线 3 的"零写入"判据：`set` + `remove` 次数）。 */
interface SpyStore extends KeyValueStore {
  writes: string[][];
  removals: string[];
  mutations(): number;
}

function spyStore(): SpyStore {
  const m = createMemoryStore();
  const writes: string[][] = [];
  const removals: string[] = [];
  return {
    get: (k) => m.get(k),
    set: (k, v) => { writes.push([k, v]); m.set(k, v); },
    remove: (k) => { removals.push(k); m.remove(k); },
    keys: () => m.keys(),
    writes,
    removals,
    mutations: () => writes.length + removals.length,
  };
}

/**
 * `set` 只对某个键抛错的假 KV（模拟"探针写得进去、真数据写不进去"：配额/隐私模式/只读盘）。
 * ⚠️ 探针键（`compile-l1-probe`）**必须**放行，否则 `grant()` 会把整个后端降级成内存，
 * `writeNickName` 就永远回不到 `false` 了 —— 那样这条腿会变成恒真的假腿。
 */
function setThrowsFor(key: string): KeyValueStore {
  const m = createMemoryStore();
  return {
    get: (k) => m.get(k),
    set: (k, v) => { if (k === key) throw new Error(`写入被拒（${k}）`); m.set(k, v); },
    remove: (k) => { m.remove(k); },
    keys: () => m.keys(),
  };
}

/** `remove` 只对某个键抛错的假 KV（"清除本机数据"失败路径）。 */
function removeThrowsFor(key: string): KeyValueStore {
  const m = createMemoryStore();
  return {
    get: (k) => m.get(k),
    set: (k, v) => { m.set(k, v); },
    remove: (k) => { if (k === key) throw new Error(`删除被拒（${k}：磁盘只读）`); m.remove(k); },
    keys: () => m.keys(),
  };
}

interface Harness {
  nav: LocalDataNav;
  store: LocalStore;
  persistent: KeyValueStore;
  pickCalls: Array<{ accept: string[] }>;
  saveCalls: Array<{ suggestedName: string; text: string }>;
  imported: Array<{ file: MatchFile; warnings: string[] }>;
  /** `startReplay` 收到的档案（G4 Task 5：按**内容**比对，不按引用） */
  replays: MatchFile[];
  /** `back` / `buildArchive()` 的调用计数（导出必须先向宿主取档案，不许自己拼） */
  counters: { back: number; build: number; readCardmaker: number; clearCardmaker: number };
  setPick(h: PickHandler): void;
  setSave(h: SaveHandler): void;
  /** 换掉宿主的档案来源（默认给一份有记录的档案；`{ reason }` 用来测"没有记录"） */
  setBuild(b: BuildHandler): void;
  /** ★ 2026-10-01：换掉"制作器本机数据"的读数 / 清除结论（默认：0 张、真删掉） */
  setCardmakerRead(h: () => Promise<{ count: number | null }>): void;
  setCardmakerClear(h: () => Promise<{ ok: boolean; removed?: boolean; detail?: string }>): void;
}

/** 宿主的档案来源（G4 Task 5 的 `LocalDataNav.buildArchive`）。 */
type BuildHandler = () => { file: MatchFile } | { reason: string };
/** ★ 2026-10-01：制作器本机数据的两个宿主接缝。 */
type CardmakerReadHandler = () => Promise<{ count: number | null }>;
type CardmakerClearHandler = () => Promise<{ ok: boolean; removed?: boolean; detail?: string }>;

function harness(opts: {
  persistent?: KeyValueStore;
  granted?: boolean;
  pick?: PickHandler;
  save?: SaveHandler;
  build?: BuildHandler;
  cardmakerRead?: CardmakerReadHandler;
  cardmakerClear?: CardmakerClearHandler;
} = {}): Harness {
  const persistent = opts.persistent ?? createMemoryStore();
  const store = createLocalStore({ persistent });
  if (opts.granted !== false) store.grant();
  let pickHandler: PickHandler = opts.pick ?? cancelledPick;
  let saveHandler: SaveHandler = opts.save ?? cancelledSave;
  // 缺省：宿主手里**有**一份档案（= `sampleFile()` 的内容）。每次调用**返回一份新的对象**
  // （逐字段新造，不共享引用）—— 这样"两次导出逐字节相同"证明的是**序列化确定性**，
  // 而不是"同一个对象被字符串化两次"。
  let buildHandler: BuildHandler = opts.build ?? (() => ({ file: sampleFile() }));
  /**
   * ★ 2026-10-01：制作器那两条的缺省值。
   *
   * ⚠️ **桩口径必须与真宿主一致**（线上验收 D1 的另一半就是这里错了）：
   *  - `readCardmaker` 的缺省 = `{ count: 0 }`：那是**空态**（库开得了、没写过），
   *    也正是 `src/main.ts` 的 `readCardmaker` 在全新访客下会给的值；
   *  - `clearCardmaker` 的缺省 = `{ ok: true, removed: true }`。
   *
   * 第一版缺省也是 `{ count: 0 }`，但**真宿主**那时把空态回成 `null`（读不到）——
   * 于是"缺省 0 张"那条断言在桩上恒真、真实现却走的是另一支（桩与实现口径分叉 = 假绿）。
   * 现在两侧都是三态：`0` = 空、`null` = 读不到、`> 0` = 有东西。
   */
  let cardmakerRead: CardmakerReadHandler = opts.cardmakerRead ?? (async () => ({ count: 0 }));
  let cardmakerClear: CardmakerClearHandler = opts.cardmakerClear ?? (async () => ({ ok: true, removed: true }));
  const pickCalls: Array<{ accept: string[] }> = [];
  const saveCalls: Array<{ suggestedName: string; text: string }> = [];
  const imported: Array<{ file: MatchFile; warnings: string[] }> = [];
  const replays: MatchFile[] = [];
  const counters = { back: 0, build: 0, readCardmaker: 0, clearCardmaker: 0 };
  const pickFile: FilePicker = {
    open: async (o) => { pickCalls.push(o); return await pickHandler(o); },
  };
  const saveFile: FileSink = {
    save: async (o) => { saveCalls.push(o); return await saveHandler(o); },
  };
  return {
    pickCalls,
    saveCalls,
    imported,
    replays,
    counters,
    persistent,
    store,
    nav: {
      back: () => { counters.back += 1; },
      store,
      pickFile,
      saveFile,
      onImported: (file, warnings) => { imported.push({ file, warnings }); },
      startReplay: (file) => { replays.push(file); },
      buildArchive: () => { counters.build += 1; return buildHandler(); },
      readCardmaker: async () => { counters.readCardmaker += 1; return await cardmakerRead(); },
      clearCardmaker: async () => { counters.clearCardmaker += 1; return await cardmakerClear(); },
    },
    setPick: (h) => { pickHandler = h; },
    setSave: (h) => { saveHandler = h; },
    setBuild: (h) => { buildHandler = h; },
    setCardmakerRead: (h) => { cardmakerRead = h; },
    setCardmakerClear: (h) => { cardmakerClear = h; },
  };
}

/** 渲染一次（本文件唯一的渲染入口：所有腿都从"屏上的树 + 调用记录"下判据）。 */
function render(h: Harness): StubNode {
  const root = mountRoot();
  renderLocalData(root as unknown as HTMLElement, h.nav);
  return root;
}

/** 一份最小的合法档案（形状与 `src/app/match-file.ts` 的 `MatchFile` 逐字对齐）。 */
const sampleFile = (over: Partial<MatchFile> = {}): MatchFile => ({
  format: MATCH_FILE_FORMAT,
  version: MATCH_FILE_VERSION,
  cardDataHash: CARD_DATA_HASH,
  seed: 'abcdef0123456789',
  setup: {
    draftMode: 'normal',
    draftStarter: 0,
    firstToPlay: 1,
    draftPool: ['water'],
    draftPicks: ['water'],
    bannedProtocols: [],
  },
  players: [{ nick: '甲' }, { nick: '乙' }],
  actions: [{ seq: 0, player: 0, kind: 'advance', via: 'user' }],
  createdAt: '2026-09-16T12:34:56.000Z',
  ...over,
});

const deck = (over: Partial<DeckRecord> = {}): DeckRecord => ({
  id: 'd1',
  name: '我的卡组',
  seed: 'abcdef0123456789',
  defIds: ['water'],
  updatedAt: '2026-09-16T10:00:00.000Z',
  ...over,
});

/**
 * 一份**可辨识**的导入档案（种子与操作序列都与 `sampleFile()` 不同）。
 *
 * 用途：证明「重放这一局」交出去的**就是刚导入的那一份** —— 若实现里"重新拼一份"或
 * "交错了对象"，指纹当场不等（M4 变异就是这么打红的）。
 */
const importedFile = (): MatchFile => sampleFile({
  seed: 'deadbeefdeadbeef',
  setup: {
    draftMode: 'normal',
    draftStarter: 1,
    firstToPlay: 0,
    draftPool: ['water'],
    draftPicks: ['water'],
    bannedProtocols: [],
  },
  actions: [
    { seq: 0, player: 0, kind: 'advance', via: 'user' },
    { seq: 1, player: 1, kind: 'advance', via: 'user' },
  ],
});

/** 假的选择结果：一个"选中的文件"（`text()` 由调用方给，便于注入 reject）。 */
function picked(over: { name?: string; size?: number; text?: () => Promise<string> } = {}): PickOutcome {
  return {
    ok: true,
    file: {
      name: over.name ?? 'a.compile-match.json',
      size: over.size ?? 100,
      text: over.text ?? (async () => stringifyMatchFile(sampleFile())),
    },
  };
}

/** 选中「`importedFile()` 那一份」的假选择结果（G4 Task 5 的重放腿用它）。 */
function pickedImported(): PickOutcome {
  return picked({ name: 'imported.compile-match.json', text: async () => stringifyMatchFile(importedFile()) });
}

/* ==================================================================== *
 * 1. 渲染：三块内容 + 生成式隐私全文
 * ==================================================================== */

describe('渲染（DOM 桩真跑一次）', () => {
  it('屏上逐条含 privacyLines() 的每一条（生成式遍历，不手写清单）', () => {
    const root = render(harness());
    const lines = privacyLines();
    expect(lines.length, 'privacyLines() 为空 ⇒ 本判据在空数组上恒真').toBeGreaterThan(3);
    const shown = descendants(one(root, 'privacy'))
      .filter((n) => isClass(n, 'local-data-privacy-line'))
      .map((n) => n.text);
    expect(shown, '屏上的隐私说明与 privacyLines() 不一致（条数/顺序/内容）').toEqual(lines);
    for (const l of lines) expect(textOf(root), `屏上缺少隐私行：${l}`).toContain(l);
  });

  it('三块内容都有落点：授权状态（含两个按钮）/ 可编辑昵称 / 导出导入（含「重放这一局」）', () => {
    const root = render(harness());
    const roles = [
      'status', 'consent', 'consent-state', 'change-consent', 'clear',
      'nick-input', 'nick-save', 'stored', 'privacy', 'archive', 'export', 'import', 'replay', 'back',
      // ★ 2026-10-01：制作器那两块（本机可见 + 可清除）—— 用户口径要求它必须在这屏上
      'cardmaker', 'cardmaker-state', 'clear-cardmaker',
    ];
    for (const role of roles) {
      expect(byRole(root, role).length, `屏上缺少 [data-role="${role}"]`).toBe(1);
    }
    expect(one(root, 'nick-input').tag, '昵称输入不是一个 <input>').toBe('input');
  });

  it('渲染是整屏屏：重渲染后只有一份树（root 先被清空）', () => {
    const h = harness();
    const root = mountRoot();
    renderLocalData(root as unknown as HTMLElement, h.nav);
    renderLocalData(root as unknown as HTMLElement, h.nav);
    expect(queryAllIn(root, 'div.local-data-screen').length, '重渲染出现两份屏（不是整屏屏）').toBe(1);
  });

  it('刚渲染时状态区是空的（不是"早就写好只是藏着"）', () => {
    const root = render(harness());
    expect(statusText(root)).toBe('');
    expect(statusCode(root)).toBe('none');
  });

  it('授权状态文案跟着 store 走：allowed ⇒ 「允许」；deny 后重渲染 ⇒ 「游客」', () => {
    const h = harness();
    const root = mountRoot();
    renderLocalData(root as unknown as HTMLElement, h.nav);
    expect(textOf(one(root, 'consent-state'))).toMatch(/允许/);
    h.store.deny();
    renderLocalData(root as unknown as HTMLElement, h.nav);
    expect(textOf(one(root, 'consent-state'))).toMatch(/游客/);
    expect(textOf(one(root, 'consent-state'))).not.toMatch(/允许保存/);
  });

  it('「改变选择」= 把授权打回 unknown 并回主界面（否则下次启动不会重新问 = 死按钮）', () => {
    const h = harness();
    const root = render(h);
    expect(h.store.consent()).toBe('allowed');
    clickRole(root, 'change-consent');
    expect(h.store.consent(), '「改变选择」没有把授权打回 unknown').toBe('unknown');
    expect(h.counters.back, '「改变选择」没有回主界面').toBe(1);
  });
});

/* ==================================================================== *
 * 2. 清除本机数据（红线 3 + 计划判据 2）
 * ==================================================================== */

describe('清除本机数据', () => {
  it('点「清除本机数据」先出**屏内确认**；确认后 persistent 的 L1 键真没了、consent 回 unknown', () => {
    const h = harness();
    writeNickName(h.store, '甲');
    writeDecks(h.store, [deck()]);
    expect(h.persistent.get(L1_SETTINGS), '前置：昵称没写进 persistent ⇒ 后面的"已清除"是假绿').not.toBeNull();
    expect(h.persistent.get(L1_DECKS)).not.toBeNull();
    const root = render(h);

    // 点「清除本机数据」：**只出确认**，一个字节都不许当场清
    clickRole(root, 'clear');
    expect(byRole(root, 'clear-yes').length, '没有出现屏内确认按钮').toBe(1);
    expect(h.persistent.get(L1_SETTINGS), '还没确认就把数据清了').not.toBeNull();
    expect(h.store.consent()).toBe('allowed');

    clickRole(root, 'clear-yes');
    expect(h.persistent.get(L1_SETTINGS), 'persistent 里的昵称没被清掉').toBeNull();
    expect(h.persistent.get(L1_DECKS), 'persistent 里的卡组没被清掉').toBeNull();
    expect(h.store.kv().get(L1_SETTINGS), '计划判据 2 的字面要求：store.kv() 读不到').toBeNull();
    expect(h.store.consent(), '清除后必须回 unknown（否则下次启动不会重新问）').toBe('unknown');
    expect(statusCode(root)).toBe('clear-ok');
    expect(one(root, 'clear-confirm').text, '清除后确认区没有收回去').toBe('');
  });

  it('确认框里点「取消」⇒ 一个字节都不清（两向都断言）', () => {
    const h = harness();
    writeNickName(h.store, '甲');
    const root = render(h);
    clickRole(root, 'clear');
    clickRole(root, 'clear-no');
    expect(h.persistent.get(L1_SETTINGS), '点取消居然把数据清了').not.toBeNull();
    expect(h.store.consent()).toBe('allowed');
    expect(one(root, 'clear-confirm').text, '取消后确认区没被收回去').toBe('');
    expect(statusCode(root), '取消不该给出任何"已清除"的结论').toBe('none');
  });

  it('清除失败（remove 抛错）⇒ 屏上如实提示真因（不静默、不崩），consent 不被改掉', () => {
    const h = harness({ persistent: removeThrowsFor(L1_SETTINGS) });
    writeNickName(h.store, '甲');
    expect(h.persistent.get(L1_SETTINGS), '前置：昵称没写进去').not.toBeNull();
    const root = render(h);
    clickRole(root, 'clear');
    clickRole(root, 'clear-yes');
    expect(statusCode(root), '清除失败的结论不是 clear-failed').toBe('clear-failed');
    expect(statusText(root), '屏上没出现真因').toContain('磁盘只读');
    expect(statusText(root), '清除失败却什么都没说').not.toBe('');
    expect(h.store.consent(), '清除失败时不该动授权状态').toBe('allowed');
    expect(h.persistent.get(L1_SETTINGS), '前置被破坏：数据其实被清掉了').not.toBeNull();
  });

  it('游客模式（deny）下点清除：persistent 的 set/remove 调用数恒 0（红线 3）', () => {
    const spy = spyStore();
    const h = harness({ persistent: spy, granted: false });
    h.store.deny();
    const root = render(h);
    expect(textOf(one(root, 'consent-state'))).toMatch(/游客/);
    clickRole(root, 'clear');
    clickRole(root, 'clear-yes');
    expect(spy.mutations(), '游客模式下的"清除"居然碰了 persistent').toBe(0);
    expect(spy.writes, 'persistent 被写过').toEqual([]);
    expect(spy.removals, 'persistent 被删过').toEqual([]);
    expect(statusCode(root)).toBe('clear-ok');
  });

  it('清除后昵称/卡组区随之刷新（不是清完还显示旧值）', () => {
    const h = harness();
    writeNickName(h.store, '甲');
    writeDecks(h.store, [deck()]);
    const root = render(h);
    expect(inputValue(one(root, 'nick-input')), '前置：昵称没显示出来').toBe('甲');
    expect(textOf(one(root, 'stored'))).toContain('我的卡组');
    clickRole(root, 'clear');
    clickRole(root, 'clear-yes');
    expect(inputValue(one(root, 'nick-input')), '清除后昵称输入框还留着旧值').toBe('');
    expect(textOf(one(root, 'stored')), '清除后还显示着卡组').not.toContain('我的卡组');
  });
});

/* ==================================================================== *
 * 3. 昵称可编辑（含写侧失败）
 * ==================================================================== */

describe('昵称（可编辑）', () => {
  it('点「保存昵称」把输入框的值真的写进本机（真跑一次读回返回值）', () => {
    const h = harness();
    const root = render(h);
    setInputValue(one(root, 'nick-input'), '张三');
    clickRole(root, 'nick-save');
    expect(readNickName(h.store)).toBe('张三');
    expect(h.persistent.get(L1_SETTINGS), '写没落到 persistent').toContain('张三');
    expect(statusCode(root)).toBe('nick-ok');
  });

  it('本机保存失败（写侧抛错）⇒ 如实提示"本机保存失败，本次会话仍可正常游玩"，不假装成功', () => {
    const h = harness({ persistent: setThrowsFor(L1_SETTINGS) });
    const root = render(h);
    setInputValue(one(root, 'nick-input'), '张三');
    clickRole(root, 'nick-save');
    expect(statusCode(root), '保存失败的结论不是 nick-write-failed').toBe('nick-write-failed');
    expect(statusText(root), '没按计划 Step 4 的文案如实提示').toContain('本机保存失败');
    expect(statusText(root)).toContain('仍可正常游玩');
    expect(statusText(root), '失败却被说成成功').not.toContain('已保存到本机');
  });
});

/* ==================================================================== *
 * 4. 导出档案（计划判据 3 + 变异 #4）
 * ==================================================================== */

describe('导出档案', () => {
  it('档案区说明文案：说清"导出的是真对局 / 没记录会被拒绝 / 档案要自己留存"（G4 §3.5 的逐条替换）', () => {
    // 这条腿是为 `local-data.ts` 的**档案区说明段**（§3.5 的 `:366-367`）立的：那一段在 G4 前后
    // **三处全假**（不再是快照 / `actions` 不空 / 导入后可重放），所以三个"过时措辞"必须消失、
    // 三件新事实必须出现。旧文案在这条腿上会**三处都红**（见 `.superpowers/g4t5/` 的旧实现对照跑）。
    const root = render(harness());
    const text = textOf(one(root, 'archive'));
    for (const stale of ['还没有对局记录器与重放', '本机数据快照', '重放功能在下一阶段', '不含任何对局操作']) {
      expect(text, `档案区还留着过时措辞「${stale}」`).not.toContain(stale);
    }
    expect(text, '档案区没说"导入后可以重放"').toContain('重放这一局');
    expect(text, '档案区没说"本次会话还没有对局时导出会被拒绝"').toContain('导出会被拒绝');
    expect(text, '档案区没说"档案要自己留存"（D13 的诚实前提）').toContain('需要留存时请自己导出');
  });

  it('点「导出档案」⇒ 先向宿主取档案（buildArchive），假 saveFile 收到的文本能被 importArchive 原样读回', async () => {
    // ⚠️ G4 Task 5 起档案**由宿主给**：本屏不再从 L1 自己拼一份（G3 那份快照已随 D9 删除）。
    //    所以这里刻意**只写 L1 昵称/卡组、不给宿主任何别的东西**，证明"屏不再读它们拼档案"。
    const h = harness({
      save: async (o) => ({ ok: true, name: o.suggestedName, mode: 'download' }),
    });
    writeNickName(h.store, '甲');
    writeDecks(h.store, [deck()]);
    const root = render(h);
    clickRole(root, 'export');
    await flush();

    expect(h.counters.build, '导出前没有向宿主取档案（自己在拼第二份？）').toBe(1);
    expect(h.saveCalls, 'saveFile.save 没有被调用').toHaveLength(1);
    const { suggestedName, text } = h.saveCalls[0];
    const parsed = importArchive(text, { currentHash: CARD_DATA_HASH });
    expect(parsed.ok, '导出的文本连自家 importArchive 都读不回来').toBe(true);
    if (!parsed.ok) return;
    expect(parsed.warnings, '导出的档案自带警告 ⇒ 往返不干净').toEqual([]);
    // 昵称来自**宿主给的那份档案**（`sampleFile()` 里是「甲」），不是本屏从 L1 凑的
    expect(parsed.file.players[0].nick, '档案里没有宿主给的那份内容').toBe('甲');
    expect(parsed.file.actions.length, '导出的档案没有操作序列（不是真对局）').toBe(sampleFile().actions.length);
    expect(suggestedName.endsWith('.compile-match.json'), `文件名不对：${suggestedName}`).toBe(true);
    expect(suggestedName, '文件名里没有 seed 前 8 位').toContain(parsed.file.seed.slice(0, 8));
    expect(statusCode(root)).toBe('export-ok');
    // 文案不再自相矛盾（G4 §3.5：旧文案前半句说"已导出 N 步"、后半句说"不含对局记录"）
    expect(statusText(root), '导出成功的报告还留着"不含对局记录"').not.toContain('不含对局记录');
    expect(statusText(root), '导出成功的报告没说"这份档案能拿去重演"').toContain('逐步重演');
  });

  it('导出的文本是**稳定序列化**：同一份 MatchFile 两次 stringify 逐字节相同，且等于"解析后稳定重排"的字节', async () => {
    // ⚠️ **G4 Task 5 的 retarget**（判据目的保留、锚点换新）：旧腿是"**两次导出**逐字节相同"，
    //    它当时真正钉的是"本屏拼快照时不许读时钟"（那套常量 `SNAPSHOT_*` 已随 D9 删除 ⇒ 前提消失）。
    //    档案改由宿主给之后，同一件事的正确形态是"**同一份 `MatchFile` 两次 `stringify` 逐字节相同**"
    //    —— 归档成 `stringifyMatchFile`（稳定序列化）的性质。宿主每次给的是**新对象**（逐字段新造），
    //    因此这条测的仍是"内容相同 ⇒ 字节相同"，而不是"同一个对象被字符串化两次"。
    const h = harness({ save: async (o) => ({ ok: true, name: o.suggestedName, mode: 'download' }) });
    const root = render(h);

    clickRole(root, 'export');
    await flush();
    clickRole(root, 'export');
    await flush();
    expect(h.saveCalls).toHaveLength(2);
    expect(h.counters.build, '两次导出各自向宿主取了一次档案').toBe(2);

    const [first, second] = h.saveCalls.map((s) => s.text);
    // ① 同一份 MatchFile 两次 stringify 逐字节相同（宿主两次给的是内容相同的新对象）
    expect(first, '同一份档案两次导出的字节不同 ⇒ 序列化不稳定').toBe(second);
    expect(first, '导出的文本不是宿主那份档案的稳定序列化').toBe(stringifyMatchFile(sampleFile()));
    // ② ⚠️ ① 单独**抓不住**"把 stringifyMatchFile 换成 JSON.stringify" —— 对内容相同的对象，
    //    `JSON.stringify` 同样是确定的（计划里"JSON.stringify 不稳定"的推理对新建对象不成立）。
    //    真正的判据是这一条：字节必须是"键排序后"的形态 ⇒ 先用自己的解析器读回来，再按
    //    稳定序列化重排，两者必须**逐字节**相等。换成 JSON.stringify（保留字面量的键序）时，
    //    这两串字节的键序不同 ⇒ 当场红。
    const parsed = importArchive(first, { currentHash: CARD_DATA_HASH });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(first, '导出文本不是稳定序列化（键未排序）').toBe(stringifyMatchFile(parsed.file));
  });

  it('宿主没有记录（只给 reason）⇒ **拒绝导出**并把理由显示出来，且没有任何假成功文案（D9）', async () => {
    // G4 D9 的核心：没有记录时**不许**退化去导一份 `actions: []` 的"本机数据快照"。
    const REASON = '本次会话还没有对局记录：先打完一局再来导出。';
    const h = harness({ save: async (o) => ({ ok: true, name: o.suggestedName, mode: 'download' }) });
    h.setBuild(() => ({ reason: REASON }));
    const root = render(h);

    clickRole(root, 'export');
    await flush();
    expect(h.counters.build, '导出没有先问宿主有没有记录').toBe(1);
    expect(h.saveCalls, '没有记录却还是写了文件（假成功）').toHaveLength(0);
    expect(statusCode(root), '没有记录时的结论不是"拒绝导出"').toBe('export-refused');
    expect(statusText(root), '宿主的 reason 没被显示出来').toContain(REASON);
    expect(textOf(root), '屏上出现了"档案已导出/已保存"这类假成功文案')
      .not.toMatch(/档案已导出|已保存到本机/);
    // 反向：有记录时同样的按钮会真的写文件（证明上一条不是"按钮坏了"）
    const ok = harness({ save: async (o) => ({ ok: true, name: o.suggestedName, mode: 'download' }) });
    const rok = render(ok);
    clickRole(rok, 'export');
    await flush();
    expect(ok.saveCalls, '前置被破坏：有记录时导出也不写文件').toHaveLength(1);
    expect(statusCode(rok)).toBe('export-ok');
  });

  it('导出三态：cancelled 不说"失败"；unsupported 说"不支持"；failed 显示真因', async () => {
    const c = harness({ save: async () => ({ ok: false, reason: 'cancelled', detail: '用户取消了保存' }) });
    const rc = render(c);
    clickRole(rc, 'export');
    await flush();
    expect(statusCode(rc)).toBe('export-cancelled');
    expect(statusText(rc), '用户自己点的取消被说成"失败/不支持"（假警报）').not.toMatch(/失败|不支持/);

    const u = harness({ save: async () => ({ ok: false, reason: 'unsupported', detail: '没有可用的 document/URL' }) });
    const ru = render(u);
    clickRole(ru, 'export');
    await flush();
    expect(statusCode(ru)).toBe('export-unsupported');
    expect(statusText(ru)).toContain('不支持');

    const f = harness({ save: async () => ({ ok: false, reason: 'failed', detail: '设备已满（配额）' }) });
    const rf = render(f);
    clickRole(rf, 'export');
    await flush();
    expect(statusCode(rf)).toBe('export-failed');
    expect(statusText(rf), '失败时没把真因显示出来').toContain('设备已满（配额）');
  });
});

/* ==================================================================== *
 * 5. 导入档案（计划判据 4/5 + 三态 + read-failed + 大小预检）
 * ==================================================================== */

describe('导入档案', () => {
  it('点「导入档案」⇒ pickFile.open 被调用（带 ARCHIVE_MIME）；成功路径 onImported 收到零警告（判据 4）', async () => {
    const h = harness({ pick: async () => picked() });
    const root = render(h);
    clickRole(root, 'import');
    await flush();

    expect(h.pickCalls, 'pickFile.open 没有被调用').toHaveLength(1);
    expect(h.pickCalls[0].accept, 'accept 不是 archive-io 的唯一出处').toEqual([ARCHIVE_MIME]);
    expect(h.imported, '成功路径没有调 onImported').toHaveLength(1);
    expect(h.imported[0].warnings, '成功路径该是零警告').toEqual([]);
    expect(h.imported[0].file.seed).toBe(sampleFile().seed);
    expect(statusCode(root)).toBe('import-ok');
    // G4 Task 5 的 retarget（判据目的保留、锚点换新）：旧腿断言屏上出现
    // "本阶段还不能直接重放"（那句过时文案已删，见 §3.5）。这条腿的**目的**是"导入成功后屏上
    // 必须把'接下来能做什么'说清楚，而且**不自动离开本屏**" ⇒ 新锚点 = 那句"点「重放这一局」"。
    // ⚠️ 改前那条旧断言**真的红过一次**：纯净 HEAD 镜像里删掉旧句子 ⇒ 本腿红（`.superpowers/g4t5/`）。
    expect(statusText(root), '导入成功后屏上没有说"接下来能重放"').toContain('重放这一局');
    expect(statusText(root), '导入成功的报告还留着过时的"不能直接重放"').not.toContain('还不能直接重放');
    expect(h.counters.back, '导入成功后不该自动离开本屏').toBe(0);
    // 同一条腿顺手钉住"不自动进重放"（用户要留在本屏看完校验报告）
    expect(h.replays, '导入成功不该自动进入重放').toHaveLength(0);
  });

  it('导入损坏文件（text() 返回 "{oops"）⇒ 不调 onImported，屏上出现**真因**（判据 5）', async () => {
    const h = harness({ pick: async () => picked({ text: async () => '{oops' }) });
    const root = render(h);
    const bad = importArchive('{oops', { currentHash: CARD_DATA_HASH });
    expect(bad.ok, '前置：{oops 居然被解析成功了').toBe(false);
    if (bad.ok) return;

    clickRole(root, 'import');
    await flush();
    expect(h.imported, '损坏档案居然调了 onImported（假成功）').toHaveLength(0);
    expect(statusCode(root), '错误码不是 importArchive 给的那个').toBe(bad.code);
    expect(statusText(root), '屏上没有出现 archive-io 给的真因').toContain(bad.message);
    expect(statusText(root), '损坏档案被静默吞掉').not.toBe('');
  });

  it('警告**生成式**渲染：卡牌指纹不同的档案 ⇒ warnings 非空且每条都在屏上（不许吞掉）', async () => {
    const mismatched = sampleFile({ cardDataHash: 'ffffffffffffffff' });
    const h = harness({ pick: async () => picked({ text: async () => stringifyMatchFile(mismatched) }) });
    const root = render(h);
    const expected = importArchive(stringifyMatchFile(mismatched), { currentHash: CARD_DATA_HASH });
    expect(expected.ok).toBe(true);
    if (!expected.ok) return;
    expect(expected.warnings.length, '前置：这份档案没产生警告 ⇒ 本腿恒真').toBeGreaterThan(0);

    clickRole(root, 'import');
    await flush();
    expect(h.imported).toHaveLength(1);
    expect(h.imported[0].warnings).toEqual(expected.warnings);
    for (const w of expected.warnings) {
      expect(statusText(root), `警告没渲染到屏上：${w}`).toContain(w);
    }
  });

  it('导入三态：cancelled 不弹假警报；unsupported 说"不支持"；failed 显示 detail', async () => {
    const c = harness({ pick: async () => ({ ok: false, reason: 'cancelled', detail: '用户取消' }) });
    const rc = render(c);
    clickRole(rc, 'import');
    await flush();
    expect(statusCode(rc)).toBe('pick-cancelled');
    expect(statusText(rc), '用户自己点的取消被说成"失败/不支持"').not.toMatch(/失败|不支持/);
    expect(textOf(rc), '屏上出现了"这台设备不支持导入档案"这句假警报').not.toContain('这台设备不支持导入档案');
    expect(c.imported).toHaveLength(0);

    const u = harness({ pick: async () => ({ ok: false, reason: 'unsupported', detail: '没有可用的 document' }) });
    const ru = render(u);
    clickRole(ru, 'import');
    await flush();
    expect(statusCode(ru)).toBe('pick-unsupported');
    expect(statusText(ru), 'unsupported 没说出"不支持"').toContain('不支持');

    const f = harness({ pick: async () => ({ ok: false, reason: 'failed', detail: '权限被撤销（NotAllowedError）' }) });
    const rf = render(f);
    clickRole(rf, 'import');
    await flush();
    expect(statusCode(rf)).toBe('pick-failed');
    expect(statusText(rf), 'failed 没显示 detail 真因').toContain('权限被撤销（NotAllowedError）');
  });

  it('text() reject ⇒ 走 read-failed（不静默、不假成功）', async () => {
    const h = harness({
      pick: async () => picked({ text: async () => { throw new Error('读取被宿主中断'); } }),
    });
    const root = render(h);
    clickRole(root, 'import');
    await flush();
    expect(statusCode(root), 'text() 的 reject 没被映射到 importArchive 联合里的 read-failed').toBe('read-failed');
    expect(statusText(root), 'reject 的真因没显示').toContain('读取被宿主中断');
    expect(h.imported, 'text() 失败却走了成功分支（假成功）').toHaveLength(0);
    expect(statusText(root)).not.toContain('已导入并校验通过');
  });

  it('超大文件在 text() **之前**就被挡掉（`PickedFile.size` 的唯一用途）', async () => {
    let textCalls = 0;
    const h = harness({
      pick: async () => picked({
        size: MAX_ARCHIVE_BYTES + 1,
        text: async () => { textCalls += 1; return stringifyMatchFile(sampleFile()); },
      }),
    });
    const root = render(h);
    clickRole(root, 'import');
    await flush();
    expect(textCalls, '超大文件还是被整个读进来了（内存炸弹）').toBe(0);
    expect(statusCode(root)).toBe('too-large');
    expect(h.imported).toHaveLength(0);
  });

  it('pickFile.open 自己 reject（异常宿主）⇒ 如实提示，不许静默、不许假成功', async () => {
    const h = harness({ pick: async () => { throw new Error('宿主炸了'); } });
    const root = render(h);
    clickRole(root, 'import');
    await flush();
    expect(statusCode(root)).toBe('import-threw');
    expect(statusText(root)).toContain('宿主炸了');
    expect(h.imported).toHaveLength(0);
  });

  it('导入未 settle（永不 resolve）时：等待态可辨识、**没有任何永久禁用**，别的操作能清掉它', async () => {
    const h = harness({ pick: () => new Promise<PickOutcome>(() => { /* 永不 settle */ }) });
    const root = render(h);
    clickRole(root, 'import');
    await flush();

    // ① 不能"点了没反应"：必须有可辨识的等待提示
    expect(statusCode(root), '点了导入却没有任何可见状态').toBe('import-waiting');
    expect(statusText(root)).toContain('等待');

    // ② 也不能"永远等且无法再操作"：**没有任何按钮被禁用**（协调者裁决：缺省不设超时窗口，
    //    代价就用"不阻塞"来兜，而不是把界面锁死）
    const buttons = descendants(root).filter((n) => n.tag === 'button');
    expect(buttons.length, '屏上按钮太少 ⇒ 本判据没覆盖到什么').toBeGreaterThan(3);
    for (const b of buttons) {
      expect(
        (b as unknown as { disabled?: boolean }).disabled,
        `等待期间按钮「${b.text}」被禁用了（永久等待态）`,
      ).not.toBe(true);
    }

    // ③ 别的操作仍然有效，并当场把等待提示替换掉（等待态不是"粘住"的）
    clickRole(root, 'nick-save');
    expect(statusCode(root), '等待提示粘住了（其它操作也清不掉它）').not.toBe('import-waiting');
    expect(statusCode(root)).toBe('nick-ok');
  });
});

/* ==================================================================== *
 * 5b. 「重放这一局」（G4 Task 5）
 * ==================================================================== */

describe('重放这一局（G4 Task 5）', () => {
  it('导入成功之前：按钮**不可见**，且点它**零回调**（本屏只渲染一次 ⇒ 只能靠 hidden + 闸门变量）', () => {
    const h = harness({ pick: async () => pickedImported() });
    const root = render(h);
    // 按钮**在渲染期就已经拼进 DOM**（不许为了让它出现而整屏重渲染：那会抹掉状态区与
    // 用户正在输入的昵称 `nick-input`）⇒ 判据落在 `hidden` 上，而不是"节点不存在"。
    const btn = one(root, 'replay');
    expect(
      (btn as unknown as { hidden?: boolean }).hidden,
      '导入成功之前「重放这一局」就可见了（整屏重渲染之外的另一种错法）',
    ).toBe(true);
    clickRole(root, 'replay');
    expect(h.replays, '导入成功之前点它居然把档案交了出去').toHaveLength(0);
    expect(h.counters.back, '导入成功之前点它不该离开本屏').toBe(0);
  });

  it('导入成功后：按钮解禁，点击把**刚导入的那一份**档案（按指纹比对）交给 startReplay；仍不自动离开本屏', async () => {
    const h = harness({ pick: async () => pickedImported() });
    const root = render(h);
    clickRole(root, 'import');
    await flush();
    expect(statusCode(root)).toBe('import-ok');

    const btn = one(root, 'replay');
    expect(
      (btn as unknown as { hidden?: boolean }).hidden,
      '导入成功后「重放这一局」仍然不可见',
    ).toBe(false);
    expect(h.replays, '导入成功不该**自动**进入重放（用户要看完校验报告）').toHaveLength(0);
    expect(h.counters.back, '导入成功后不该自动离开本屏').toBe(0);

    clickRole(root, 'replay');
    expect(h.replays, '点了「重放这一局」却没把档案交给宿主').toHaveLength(1);
    // 按**内容**比对（不按引用）：交出去的必须就是导入的那一份
    expect(
      matchFileFingerprint(h.replays[0]),
      '交出去的档案与导入的那一份内容不同（自己又拼了一份 / 交错了对象？）',
    ).toBe(matchFileFingerprint(importedFile()));
    // 反向锚点：它**不是**那份默认档案（否则上面的"相等"可能对任何一份都成立 = 恒真）
    expect(
      matchFileFingerprint(h.replays[0]),
      '反向锚点失效：交出去的档案与默认档案同指纹 ⇒ 上面的比对分辨不了"交错档案"',
    ).not.toBe(matchFileFingerprint(sampleFile()));
    expect(statusCode(root), '点「重放这一局」不该改状态区的结论').toBe('import-ok');
  });

  it('游客模式（deny）下：导入 → 重放 与 导出 全部照常可用，且 persistent 零写入（D13 红线 3）', async () => {
    const spy = spyStore();
    const h = harness({
      persistent: spy,
      granted: false,
      pick: async () => pickedImported(),
      save: async (o) => ({ ok: true, name: o.suggestedName, mode: 'download' }),
    });
    h.store.deny();
    const root = render(h);
    expect(textOf(one(root, 'consent-state')), '前置：不是游客模式').toMatch(/游客/);

    clickRole(root, 'import');
    await flush();
    clickRole(root, 'replay');
    expect(h.replays, '游客模式下重放不可用').toHaveLength(1);
    clickRole(root, 'export');
    await flush();
    expect(h.saveCalls, '游客模式下导出不可用').toHaveLength(1);
    expect(statusCode(root), '游客模式下导出的结论不对').toBe('export-ok');
    // D13：档案只在内存与用户自己选的文件里 ⇒ 游客模式（乃至任何模式）下都不写浏览器存储
    expect(spy.mutations(), '游客模式下"导入/重放/导出"碰了 persistent（红线 3）').toBe(0);
  });
});

/* ==================================================================== *
 * 6. 源码腿：本文件不得直接引用浏览器 API（转达 #4）
 * ==================================================================== */

describe('源码腿：浏览器调用只能从 nav 注入', () => {
  const src = readFileSync(fileURLToPath(new URL('../../src/ui/local-data.ts', import.meta.url)))
    .subarray(0, 512 * 1024).toString('utf8');
  const code = stripComments(src);

  it('showOpenFilePicker / showSaveFilePicker / localStorage / indexedDB / sessionStorage 零命中', () => {
    for (const t of ['showOpenFilePicker', 'showSaveFilePicker', 'localStorage', 'indexedDB', 'sessionStorage']) {
      expect(code.includes(t), `local-data.ts 的代码位里出现了 ${t}（浏览器调用必须从 nav 注入）`).toBe(false);
    }
    // 反向：扫描本身有效（本模块必然出现它**该有**的东西）
    expect(code).toContain('renderLocalData');
  });

  it('不 import home.ts 的私有助手（两种 el/button 各写一份，避免与 Task 4 争同一个文件）', () => {
    const imports = [...code.matchAll(/^\s*import[^;]*;/gm)].map((m) => m[0]);
    expect(imports.length, '一个 import 都没有？扫描失效了').toBeGreaterThan(0);
    for (const stmt of imports) {
      expect(/from\s+'\.\/home'/.test(stmt), `local-data.ts 引用了 home.ts：${stmt.trim()}`).toBe(false);
    }
  });
});

/* ==================================================================== *
 * 7. 样式腿：新类名与 5 张既有 CSS 零同名（生成式自检）
 * ==================================================================== */

describe('样式腿：新类名不与既有 CSS 冲突', () => {
  const LOCAL_CSS = fileURLToPath(new URL('../../src/ui/styles-local.css', import.meta.url));
  /** 5 张**既有** CSS（本任务一个字节都不许改它们；新类名与它们零同名） */
  const EXISTING = [
    'styles.css', 'styles-gen3.css', 'styles-gen3-cards.css', 'styles-gen3-sync.css', 'styles-net.css',
  ];
  /** 本屏新增的类名（**生成式派生**：从 styles-local.css 里采 `local-data-*` 的选择器） */
  const css = readFileSync(LOCAL_CSS).subarray(0, 512 * 1024).toString('utf8');
  const mine = [...new Set([...css.matchAll(/\.(local-data-[A-Za-z0-9_-]+)/g)].map((m) => m[1]))].sort();

  it('锚点：styles-local.css 里真的有本屏的类（否则下面的判据在空集上恒真）', () => {
    expect(mine.length, 'styles-local.css 里没有 local-data-* 类').toBeGreaterThan(2);
    for (const reserved of ['local-data-screen', 'local-data-row', 'local-data-actions']) {
      expect(mine, `Task 4 预留的 .${reserved} 不见了`).toContain(reserved);
    }
  });

  it('新增类名在 5 张既有 CSS 里零命中', () => {
    for (const file of EXISTING) {
      const text = readFileSync(fileURLToPath(new URL(`../../src/ui/${file}`, import.meta.url)))
        .subarray(0, 1024 * 1024).toString('utf8');
      const classes = new Set([...text.matchAll(/\.([A-Za-z][A-Za-z0-9_-]*)/g)].map((m) => m[1]));
      expect(classes.size, `${file} 里一个类名都没采到 ⇒ 扫描失效`).toBeGreaterThan(10);
      for (const c of mine) {
        expect(classes.has(c), `${file} 里已有 .${c}（同名会让那道屏的视觉连带变化）`).toBe(false);
      }
    }
  });
});

/* ==================================================================== *
 * 8. 接线腿：main.ts 的 showLocalData 接线区 + G4 的"改动落点精确"
 * ==================================================================== */

/** 仓库根（`git show` 的 cwd；去掉 Windows 路径末尾的分隔符）。 */
const REPO = fileURLToPath(new URL('../../', import.meta.url)).replace(/[\\/]+$/, '');
const MAIN_CODE = stripComments(
  readFileSync(fileURLToPath(new URL('../../src/main.ts', import.meta.url)))
    .subarray(0, 1024 * 1024).toString('utf8'),
);
const CB_HEAD = 'const cb: UiCallbacks = ';

/**
 * 取 `const cb: UiCallbacks = { … }` 这类**对象字面量声明**的整段。
 *
 * **G4 Task 4：本地那份实现已提升到 `./source-text` 共用**（`objectBody`，行为一字不改 ——
 * "找不到声明头就抛错"的纪律连同实现逐字搬过去），因为它同时被 `net-preview-wiring`（L3）、
 * `rearrange-draft`（L6）与本文件（L4/L5）需要，而四份拷贝的漂移方向正是**假绿**。
 */

/**
 * 基线 `main.ts` = **G4 收口（Task 4）之前**的那一版（`git show <c>^:src/main.ts`）。
 *
 * ⚠️ **为什么基线不是 HEAD**（G3 实测，不是假想）：本仓有过**路径限定提交**
 * （`git add src/main.ts`）把当时工作树里的改动一并带进别的提交的先例 ⇒ "拿 HEAD 当基线"
 * 可能落到一个**已经含本次改动**的版本上，于是"逐字节相同"变成**恒真**。
 * ⇒ 沿用 G3 立下的同一套 git 机器（`git log -S <符号>` → 取该提交的**父提交**），只把 `-S`
 * 的符号换成 **G4 Task 4 引入 `main.ts` 的符号**（`createLocalDriver`）。它与提交顺序/提交
 * 信息无关，且父提交里必然**不含** G4 的任何收口符号 —— 下面那条腿有锚点断言钉住这件事。
 *
 * ⚠️ **HEAD 回退分支的现状（T4 已提交之后）**：T4（`0b95c4a`）已把 `createLocalDriver` 提交进历史
 * ⇒ 正常路径走 `-S` 拿父提交。下面的 `HEAD` 回退只在"该符号还没提交"的世界里生效（例如把本文件
 * 单独拿到一棵更早的树上跑）；两条路给出**同一份**基线，而"它确实是改动前的版本"这件事由调用方的
 * 锚点断言（基线里不许有 `createLocalDriver` / `driver.submit(`）当场证明 —— 不是靠假设。
 */
function baselineMainCode(): string | null {
  const hashes = execFileSync(
    'git',
    // ⚠️ 路径用 `:/src/main.ts`（**仓库根**相对），不是裸 `src/main.ts`（**cwd** 相对）：
    //    变异实测在**隔离镜像**里跑，那里的 cwd 前缀会让裸 pathspec 命中不到任何历史 ⇒
    //    这条腿会在镜像里假红。`:/` 前缀让它在任何 cwd 下同义。
    ['log', '--format=%H', '-S', 'createLocalDriver', '--', ':/src/main.ts'],
    { cwd: REPO, encoding: 'utf8' },
  ).trim().split('\n').filter((x) => x !== '');
  // `<rev>:<path>` 这一形态本就是**树根**相对（要 cwd 相对得写 `./`）⇒ 镜像里同样成立。
  const rev = hashes.length === 0 ? 'HEAD' : `${hashes[hashes.length - 1]}^`;
  let raw: string;
  try {
    raw = execFileSync('git', ['show', `${rev}:src/main.ts`], { cwd: REPO, encoding: 'utf8' });
  } catch {
    return null; // 历史里既没有该符号、也取不到 HEAD（裸仓库/浅克隆）⇒ 本腿没有基线
  }
  expect((raw.match(/\r/g) ?? []).length, 'git show 的 stdout 里有 \\r（CRLF 会制造假红）').toBe(0);
  return stripComments(raw);
}

/** git 可用吗？（不可用时下面那组"与历史提交比对"的腿跳过；git-free 的判据仍在。） */
const HAVE_GIT = ((): boolean => {
  try {
    execFileSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: REPO, encoding: 'utf8' });
    return true;
  } catch {
    return false;
  }
})();

describe('接线腿：main.ts（showLocalData 接线区）', () => {
  it('showLocalData 把 nav 的**七个**落点都接上了（G4 Task 5 加了 startReplay / buildArchive）', () => {
    const body = functionBody(MAIN_CODE, 'showLocalData');
    expect(body.length, 'functionBody 抽到空片段 ⇒ 本组判据假绿').toBeGreaterThan(120);
    expect(body).toContain('renderLocalData(root');
    expect(body, '没接选择器').toMatch(/openArchivePicker\s*\(/);
    expect(body, '没接落盘口').toMatch(/openArchiveSink\s*\(/);
    expect(body, 'store 没接 localStore').toMatch(/store:\s*localStore/);
    expect(body, 'back 没接 showStartScreen').toMatch(/back:\s*showStartScreen/);
    expect(body, '没接 onImported 接缝').toMatch(/onImported/);
    // G4 Task 5：进入重放的唯一入口 = `startReplayFile`（T4 交付的入口函数，此前零调用）
    // ⚠️ G5 T12 小修复轮把这条箭头**包了一层 try/catch**（档案自相矛盾时 `startReplayFile` 会抛，
    //    包起来是为了让用户留在档案屏、失败原因进 console）⇒ 正则从"箭头体直接是 `startReplayFile(`"
    //    放宽成"箭头体内出现 `startReplayFile(`"。**判据本身没放宽**：`startReplayFile(` 在全仓
    //    仍然**只有两处**（定义 + 这一句调用），下面那条反向腿钉着"这一句必须真的在 startReplay 里"。
    expect(body, '「重放这一局」没接到 startReplayFile（进入重放的唯一入口）')
      .toMatch(/startReplay:\s*\([^)]*\)\s*=>\s*\{[\s\S]{0,600}?startReplayFile\s*\(/);
    expect((body.match(/startReplayFile\s*\(/g) ?? []).length, 'showLocalData 里 startReplayFile( 的调用点数').toBe(1);
    expect(body, '导出没有接到宿主的 record 来源（buildSessionArchive）')
      .toMatch(/buildArchive:\s*\(\)\s*=>\s*buildSessionArchive\s*\(\s*\)/);
    // 反向：本函数**不许**再出现第二套"自己拼档案"的调用（G3 的 snapshotMatchFile 已删）
    expect(body, 'showLocalData 里出现了第二份"拼档案"的实现').not.toMatch(/snapshotMatchFile/);
  });

  it('主页入口的占位已替换成 showLocalData()（Task 4 的注释不再说谎）', () => {
    expect(MAIN_CODE, 'openLocalData 还是占位').toMatch(/openLocalData:\s*\(\)\s*=>\s*showLocalData\(\)/);
    expect(MAIN_CODE, 'openLocalData 那一行还留着 Task 7 的占位注释').not.toMatch(/openLocalData:[^,\n]*G3 Task 7 填充/);
  });

  it('cb / rerender 里没有出现任何 Task 7 的符号（我的改动没落进这两个函数）', () => {
    const bodies: Array<[string, string]> = [
      ['rerender', functionBody(MAIN_CODE, 'rerender')],
      ['cb', objectBody(MAIN_CODE, CB_HEAD)],
    ];
    for (const [name, body] of bodies) {
      expect(body.length, `${name} 抽到空片段 ⇒ 本判据假绿`).toBeGreaterThan(200);
      for (const sym of ['showLocalData', 'renderLocalData', 'openArchivePicker', 'openArchiveSink', 'local-data']) {
        expect(body.includes(sym), `${name} 里出现了 Task 7 的符号「${sym}」`).toBe(false);
      }
    }
    // 反向：抽出来的确实是那两个东西（`rerender` 必然画盘、`cb` 必然有回主页回调）
    expect(bodies[0][1]).toContain('renderNetBoard');
    expect(bodies[1][1]).toContain('onWinReset');
  });

  /**
   * ★ **G4 Task 4 · L5 的 retarget**（判据目的保留，锚点换新）：
   *
   * 它原来是"`cb`/`rerender` 与**引入 Task 7 之前**的提交逐字节相同（对照组 `showHome` 必须不同）"
   * —— 那是**冻结期**（G3）的判据：谁都不许动这两个函数。**冻结期已结束**：G3 计划 `:3229`
   * 明确把 `cb` 与 `rerender` 的收口留给 G4 ⇒ G4 就是这个范围的**合法修改者**，
   * 凡是钉"它们没被改过"的判据都必须 retarget，否则会红在一个**已被授权**的改动上。
   *
   * 新判据比旧的**更强**：它不再只证明"某两个函数没被动过"，而是证明
   * **"G4 的改动恰好落在它的收口范围里、没有溢出到别处"** —— 正是 `148fae3` 那次越界事故
   * （改 `main.ts` 时把范围外的 hunk 一并带进提交）的缺陷类。两个方向都钉：
   *   ① **必须不同**（对照组，证明比较不恒真）：`rerender` / `cb` —— G4 的收口范围；
   *   ② **必须逐字节相同**（真正的判据）：G4 **不碰**的四个邻居
   *      `consentStep` / `showCoin` / `showHome` / `showModeSelect`。
   *
   * ⚠️ **两个陷阱（G4 计划 §3.3 的 L5 行逐条记着，第一版写错过）**：
   *   · **`resetToMainInterface` 不能进"不变"那一组** —— T4 第 10 条**就是要改它**（加重放复位）；
   *   · **`showHome` 的对照组语义要反过来** —— 旧腿里它"必须不同"是因为 Task 7 往它里面加了
   *     `openLocalData`；换成 G4 基线后它在两侧相同 ⇒ 照旧写法会红。对照组改用 `rerender`/`cb`。
   */
  it.runIf(HAVE_GIT)('G4 的改动落点精确：rerender/cb 必须不同，consentStep/showCoin/showHome/showModeSelect 必须逐字节相同', () => {
    const before = baselineMainCode();
    expect(before, 'git 里找不到 G4 收口之前的 main.ts ⇒ 本腿没有基线').not.toBeNull();
    if (before === null) return;
    // 锚点：基线里**没有** G4 收口的任何符号，否则"两边相同"可能是"两边都已收口"= 恒真
    // （`createLocalDriver` 是唯一允许出现在基线里的判据符号 —— 它出现在"现在"这一侧）
    expect(before.includes('createLocalDriver'), '基线里已经有 createLocalDriver ⇒ 这不是"G4 之前"的基线').toBe(false);
    expect(before.includes('driver.submit('), '基线里已经有 driver.submit( ⇒ 这不是"G4 之前"的基线').toBe(false);
    expect(before, '基线里没有 rerender ⇒ 后面的比对没意义').toContain('function rerender(): void {');
    expect(before, '基线里没有 cb ⇒ 后面的比对没意义').toContain(CB_HEAD);
    expect(before, '基线里没有 showCoin ⇒ 后面的比对没意义').toContain('function showCoin(');

    // ① 对照组：G4 的收口范围必须**真的变了** —— 没有这一条，下面那些"相同"可能是恒真的
    expect(functionBody(MAIN_CODE, 'rerender'), 'rerender 是 G4 的收口范围，必须与基线不同')
      .not.toBe(functionBody(before, 'rerender'));
    expect(objectBody(MAIN_CODE, CB_HEAD), 'cb 是 G4 的收口范围，必须与基线不同')
      .not.toBe(objectBody(before, CB_HEAD));

    // ② 真正的判据：G4 **不碰**的邻居必须逐字节相同
    //    （原四个：`consentStep` / `showCoin` / `showHome` / `showModeSelect`；后两个按下面
    //     各自的"移出"处理 —— `showModeSelect` 是 G5/T8，`showCoin` 是 2026-09-30 那次）
    //    （`resetToMainInterface` **不在**这一组：第 10 条本来就要改它）
    //
    // ── G5/T8 的豁免：`showModeSelect` 从这一组**移出**（D24 ③）─────────────────
    // 它**不是**放松，而是这条腿**自己那套写法**的第二次应用：被授权的合法修改者会被显式移出。
    // 依据两条：
    //  1. 计划 §5 T8 明写"在 `startNetPreview` 旁边加真正的联机入口"，而那个入口（`startNetLobby`）
    //     就住在 `showModeSelect` 里调 `renderModeSelect(root, {...})` 的那个 `nav` 实参上 ⇒
    //     **本函数体必然变**；
    //  2. 这条腿的注释里**早就有先例**：「`resetToMainInterface` **不在**这一组：第 10 条本来就
    //     要改它」—— 同一形状：G4 的收口范围之外出现了**另一轮被明确授权**的改动，就把它移出。
    //
    // ⚠️ **明确不做的事**：不许把这条腿改成"两边可以不同"—— 那会让 G4 的范围守卫**永久失效**
    // （它对 G4 之后的所有改动都不再有区分能力）。所以下面 `showModeSelect` 只**移出**，不换写法；
    // 而它的"改动确实来自 T8、且没有溢出"由 `tests/ui/main-lobby-wiring.test.ts` 自己那几条腿兜。
    for (const name of ['consentStep']) {
      const now = functionBody(MAIN_CODE, name);
      const then = functionBody(before, name);
      expect(now.length, `${name} 抽到空片段`).toBeGreaterThan(50);
      expect((now.match(/\r/g) ?? []).length, `${name} 的片段里有 \\r`).toBe(0);
      expect((then.match(/\r/g) ?? []).length, `基线的 ${name} 片段里有 \\r`).toBe(0);
      expect(now, `${name} 在 G4 的收口里被改动了（改动溢出到 rerender/cb/applyRearrangeSwap/resetToMainInterface 之外）`)
        .toBe(then);
    }
    // 移出 ≠ 不查：`showModeSelect` 必须真的变过（否则"移出"就成了一次静默放行），
    // 且它的变化**只许**来自 T8 的联机入口（符号面自证：基线里没有它们）。
    const modeNow = functionBody(MAIN_CODE, 'showModeSelect');
    expect(modeNow.length, 'showModeSelect 抽到空片段').toBeGreaterThan(50);
    expect(modeNow, 'showModeSelect 与 G4 基线逐字节相同 ⇒ 它没有理由被移出这一组（那这次移出就是放松）')
      .not.toBe(functionBody(before, 'showModeSelect'));
    expect(modeNow, 'showModeSelect 里没有 T8 的联机入口 ⇒ 移出的理由是假的').toContain('startNetLobby');
    expect(functionBody(before, 'showModeSelect'), '基线里已经有 startNetLobby ⇒ 这不是"G4 之前"的基线')
      .not.toContain('startNetLobby');

    // ── 2026-09-30 的豁免：`showCoin` 从这一组**移出**（用户当天明确要求）────────────────
    // 依据：用户要求"把双人热座的抛硬币动画换成双人联机那种"，而热座与联机共用 `renderCoin`
    // 之后，动态偏好的唯一出处仍是宿主（`main.ts` 的 `reducedMotion()`）⇒ `showCoin` 的
    // `renderCoin(...)` 实参里必然多一行 `reducedMotion: reducedMotion(),`（同一个注入口）。
    // 做法与上面 `showModeSelect` 那次**逐字同形**：只移出、不换写法，并加"确实变过"+锚点两条。
    const coinNow = functionBody(MAIN_CODE, 'showCoin');
    expect(coinNow.length, 'showCoin 抽到空片段').toBeGreaterThan(50);
    expect(coinNow, 'showCoin 与 G4 基线逐字节相同 ⇒ 它没有理由被移出这一组（那这次移出就是放松）')
      .not.toBe(functionBody(before, 'showCoin'));
    expect(coinNow, 'showCoin 里没有那次改动的锚点（动态偏好注入）')
      .toContain('reducedMotion: reducedMotion(),');
    expect(functionBody(before, 'showCoin'), '基线里已经有 reducedMotion 注入 ⇒ 移出的理由要重写')
      .not.toContain('reducedMotion: reducedMotion(),');

    // ── 2026-09-30 的第二次豁免：`showHome` 从这一组**移出**（同一天，用户要求"首页加设置按钮"）──
    // 依据：设置入口就住在 `showHome` 里那个 `renderHome(root, {...})` 的 nav 实参上
    // （`openSettings` 那个键的值就是"打开设置"这件事本身）⇒ 本函数体必然变。
    // 做法与 `showModeSelect`（G5/T8）、`showCoin`（同一天）**逐字同形**：只移出、不换写法。
    //
    // ★ 2026-10-01 追加（用户要求"设置只用小窗"）：那次改的正是 `openSettings` 这个键的**值**
    //   —— 从"`renderSettings(root, showHome)` 切整屏"换成"把 `settingsOverlayElement()` 造的
    //   遮罩挂到 `document.body`"。**移出的理由与范围一字未变**：仍然是"入口住在 `showHome` 的
    //   nav 实参上，本函数体必然变"。所以这一组**不动**（既不新增移出项，也不改判据），
    //   小窗本身由文件末尾第 9 组那三条腿兜（那组 2026-10-01 新增）。
    const homeNow = functionBody(MAIN_CODE, 'showHome');
    expect(homeNow.length, 'showHome 抽到空片段').toBeGreaterThan(50);
    expect(homeNow, 'showHome 与 G4 基线逐字节相同 ⇒ 它没有理由被移出这一组（那这次移出就是放松）')
      .not.toBe(functionBody(before, 'showHome'));
    expect(homeNow, 'showHome 里没有那次改动的锚点（设置入口）').toContain('openSettings');
    expect(functionBody(before, 'showHome'), '基线里已经有 openSettings ⇒ 移出的理由要重写')
      .not.toContain('openSettings');
  });
});

/* ==================================================================== *
 * 9. ★ 2026-10-01（用户要求）：「设置」从小窗落地 —— 落点与行为
 *
 * 用户原话：「我希望设置页面只需要使用小窗即可，而不是目前这样单独放一个页面出来」。
 * 改之前是**整页**：`openSettings` 调 `renderSettings(root, showHome)` —— 那一下 `clearRoot(root)`
 * 把首页整棵换掉，关掉只能"再画一次首页"。
 *
 * 这一组钉三件事（都属于"被授权改动的那两个函数"的**落点**与**行为**）：
 *   ① 旧那套**真的没了**（`renderSettings` 这个名字在 `src/ui/home.ts` 里一次不出现）；
 *   ② 新那套的两个落点：`home.ts` 造元素（一个不调 `clearRoot`、不往 `root` 挂东西的纯构造器），
 *      `main.ts` 的 `openSettings` 负责挂到 `document.body` 并统一收尾（含 Esc）；
 *   ③ 元素**真跑**一次（桩 DOM，`tests/ui/net-dom-stub.ts`）：结构、开关真写状态、
 *      三条关闭路径里能在桩上跑的两条（点遮罩 / 点「关闭」按钮）真的只关一次。
 *
 * **不能**证明的：真实浏览器里的观感与层叠、Esc 那条（要真 `document` 的 keydown 冒泡，
 * 桩的 `document.addEventListener` 是 noop，本文件不断言它）。
 * ==================================================================== */

const HOME_CODE = stripComments(
  readFileSync(fileURLToPath(new URL('../../src/ui/home.ts', import.meta.url)))
    .subarray(0, 1024 * 1024).toString('utf8'),
);

/**
 * 把产出代码吐出来的 `HTMLElement` 当**桩节点**读。
 *
 * 这是本仓既有写法（`tests/ui/library-effect-filter.test.ts:49` 的 `asStub`）：`settingsOverlayElement()`
 * 的静态返回类型是 `HTMLElement`（产出代码要能在真浏览器里跑），而运行时装的是桩的节点 ——
 * 断言用的 `classOf` / `getAttribute` / `dispatchEvent` 都是桩那一侧的能力。
 */
const asStub = (n: unknown): StubNode => n as StubNode;

/**
 * 在某个节点上"真派发一次事件"。
 *
 * ⚠️ 桩的两条边界（都写明了才敢用）：
 *  1. `dispatchEvent` **不调用派发节点自己的监听器**（只沿 `parentElement` 向上冒泡）⇒ 临时挂一个
 *     空子节点，在**它**上面派发，让冒泡路径经过目标节点（与 Task 4 的 `clickRole` 同源）；
 *  2. 按钮的监听器自己不看 `e.target`，而遮罩那条**要看**（`e.target !== overlay` 就不关 ——
 *     这正是"点小窗里面不关"的实现）⇒ 想让遮罩那条判据为真，必须把 `target` 显式写成**遮罩本身**
 *     （真浏览器里点遮罩空白处就是 `e.target === overlay`；桩没有"点在空白处"这回事，
 *     所以这个形状由测试补上，与 `library-effect-filter.test.ts` 补"label 激活"是同一手法）。
 */
function fireIn(target: StubNode, type: string, evTarget: StubNode = target): void {
  const clicker = makeStubEl('span');
  target.appendChild(clicker);
  clicker.dispatchEvent({ type, target: evTarget });
}

/** 派发一次 `click`（最常用的那个 `fireIn`）。 */
function clickIn(target: StubNode, evTarget: StubNode = target): void {
  fireIn(target, 'click', evTarget);
}

/** 找唯一一个带某类名的节点（找不到 / 多于一个都**响亮**报错）。 */
function oneClass(root: StubNode, cls: string): StubNode {
  const hits = classOf(root, cls);
  expect(hits.length, `树里应有唯一一个 .${cls}，实际 ${hits.length} 个`).toBe(1);
  return hits[0];
}

describe('★ 2026-10-01：设置小窗（落点 + 真跑一次）', () => {
  it('① 旧那套整屏真的没了：home.ts 里不再有 renderSettings', () => {
    // 锚点：这次改动**加**的东西先在场（否则下面的"没有 X"可能只是因为抽错了文件）
    expect(HOME_CODE, 'home.ts 里没有 settingsOverlayElement ⇒ 抽错文件或改动没落地')
      .toContain('export function settingsOverlayElement(');
    expect(HOME_CODE, '`renderSettings` 这个名字还在 ⇒ 旧那套整屏没删干净')
      .not.toContain('renderSettings');
  });

  it('② 新那套的两个落点：纯构造器（不 clearRoot / 不碰 root）+ 宿主挂到 document.body 并收尾', () => {
    const fn = functionBody(HOME_CODE, 'settingsOverlayElement');
    expect(fn.length, 'functionBody 抽到空片段 ⇒ 本判据假绿').toBeGreaterThan(400);
    // 判据：这个构造器**只造元素**。`clearRoot` 一次都不能出现 —— 它是那次"整屏被换掉"的元凶
    // （首页背景动画、滚动位置全没）；往 `root` 上挂东西也不能出现（那种写法等于又开了一屏）。
    expect(fn, '小窗构造器里出现了 clearRoot ⇒ 首页会被整棵换掉（用户要的正是"关掉还停在原来的页面"）')
      .not.toContain('clearRoot');
    expect(fn, '小窗构造器往 root 挂东西 ⇒ 又变成一整屏了').not.toMatch(/root\.appendChild/);
    // 锚点：它就是那个挂到 body 上的遮罩，且开关仍是既有那套类（不新造控件样式）
    expect(fn, "小窗不是 settings-overlay（挂到 body 上的是它吗）").toContain("'settings-overlay'");
    expect(fn, '开关控件没复用既有的 .mode-toggle / .mode-check / .mode-toggle-label')
      .toContain("'mode-toggle'");
    expect(fn, '开关控件没复用既有的 .mode-check').toContain("'mode-check'");
    expect(fn, '开关控件没复用既有的 .mode-toggle-label').toContain("'mode-toggle-label'");

    const open = functionBody(MAIN_CODE, 'showHome');
    expect(open, 'openSettings 里没有 settingsOverlayElement ⇒ 没接到小窗上').toContain('settingsOverlayElement');
    expect(open, '小窗没挂到 document.body 上').toMatch(/document\.body\.appendChild\(\s*overlay\s*\)/);
    expect(open, 'openSettings 里还留着旧的整屏调用（renderSettings）').not.toContain('renderSettings');
    expect(open, '小窗没有关掉之后的收尾（移除节点）').toContain('overlay?.remove()');
    expect(open, '小窗没接 Esc（用户列的可选项，实现里接了就必须有）').toMatch(/addEventListener\('keydown'/);
  });

  it('③ 元素真跑一次：结构对、开关真写状态、点遮罩与点「关闭」都只关一次', () => {
    const restore = installStubDom();
    try {
      let closed = 0;
      // ★ 2026-10-01（P0 / B）：小窗的 nav 多了三个必填成员（`lang` / `onLangChange` / `onFxChange`）
      //   —— P0 之后它不再是一个"只会造元素"的构造器：**语言**与**开关落盘**都是它新接的活。
      //   本用例的对象是"结构 + 开关 + 三条关闭路径"，那两项的行为由
      //   `tests/i18n/settings-overlay.test.ts` 自己一组腿兜（不在这条腿里顺手断言，
      //   免得两处判据漂移）。这里给的是**最小合法**实参：当前语言取默认、写盘一律"成功"。
      const overlay = asStub(settingsOverlayElement({
        onClose: () => { closed += 1; },
        lang: getLang(),
        onLangChange: () => ({ ok: true }),
        // ★ B：宿主那一侧照 main.ts 的同一口径改内存态（小窗只报事件，不自己改）
        onFxChange: (id, on) => { setMetal6Strobe(on); return { ok: true }; },
      }));
      // 挂进 `document.body`：桩的 `dispatchEvent` 只沿 `parentElement` 向上冒泡，没挂上去就收不到
      // 遮罩自己的监听器（`document.body` 是桩的节点 ⇒ 这里只能强转，见 `asStub` 的说明）
      document.body.appendChild(overlay as unknown as Node);

      // 结构：role=dialog 的面板 + 右上角「关闭」按钮
      const dialog = oneClass(overlay, 'settings-panel');
      expect(overlay.cls, '遮罩的类名不是 settings-overlay').toBe('settings-overlay');
      // ⚠️ 桩的 `getAttribute` 只存在于 `StubNode` 的**索引签名**里（`unknown`）⇒ 调用点要显式收窄，
      //    否则 `tsc` 报 `TS18046: 'dialog.getAttribute' is of type 'unknown'`
      const readAttr = dialog.getAttribute as unknown as (n: string) => string | null;
      expect(readAttr('role'), '小窗没有 role=dialog（读屏认不出这是个弹窗）').toBe('dialog');
      const closeBtn = oneClass(overlay, 'settings-close');
      expect(closeBtn.text, '右上角那个按钮的文案不是「关闭」').toBe('关闭');

      // 开关：默认按 isMetal6StrobeOn() 落子，并且真的写进了 fx-settings 的内存态
      const boxes = classOf(overlay, 'mode-check');
      expect(boxes.length, '小窗里的开关数 = FX_SETTINGS 的条目数').toBe(FX_SETTINGS.length);
      const box = boxes[0];
      expect(box.tag, '开关不是 <input>').toBe('input');
      expect(box.dataset.fxSetting, '开关没带 data-fx-setting（测试与调试都靠它定位）').toBe('metal6-strobe');
      expect((box as unknown as { checked: boolean }).checked, '默认不是开启（isMetal6StrobeOn 的默认值）').toBe(true);

      // 本地就地反馈（不重画整屏）：勾选一次 ⇒ 状态真的被写进内存态，说明文案跟着变
      const note = oneClass(overlay, 'settings-note');
      const before = note.text;
      (box as unknown as { checked: boolean }).checked = false;
      fireIn(box, 'change');
      expect(isMetal6StrobeOn(), '勾掉开关之后 isMetal6StrobeOn() 还是 true').toBe(false);
      expect(note.text, '说明没跟着改（"当前：关闭"应就地写上去，而不是重画整屏）')
        .toBe(`${before}（当前：关闭）`);

      // 关闭路径 ①：点小窗**里面**不关（遮罩那条看 `e.target`，而这里的 target 是小窗内部）
      clickIn(note);
      expect(closed, '点了小窗内部也把它关掉了（那玩家没法在窗里操作）').toBe(0);
      // 关闭路径 ②：点遮罩空白处关一次（target = 遮罩本身，与真浏览器点空白处同形）
      const backdrop = makeStubEl('span'); // 空白处：挂在遮罩里、不遮任何东西
      overlay.appendChild(backdrop);
      backdrop.dispatchEvent({ type: 'click', target: overlay });
      expect(closed, '点遮罩空白处没关掉').toBe(1);
      // 关闭路径 ③：右上角「关闭」按钮关一次
      clickIn(closeBtn);
      expect(closed, '右上角「关闭」按钮没关掉').toBe(2);
    } finally {
      restore();
    }
  });
});

/* ==================================================================== *
 * 10. ★ 2026-10-01（用户要求）：卡牌制作器的本机数据 —— 可见 + 可清除
 *
 * 用户口径：「本仓库有个「本地数据与隐私」屏会列出本机存了什么、能清除 ——
 * **新加的存储必须在那屏里可见、可清除**，相关测试要跟着更新（按那些测试自带的规程改，
 * 不许删/放宽断言）」。
 *
 * 制作器的牌组住在**独立的 IndexedDB 库**（不是 L1 那两个 localStorage 键：
 * 自定背景 base64 内嵌之后一个牌组就超过 localStorage 的 ~5MB 配额，理由见
 * `src/ui/cardmaker/store-idb.ts` 的文件头注），所以它**不在** `clearAllLocalData`
 * 的键表里 —— 这一组钉的就是"它有自己的读数与自己的清除按钮"。
 *
 * 这一组**不动**第 1 组那条生成式隐私腿（`privacyLines()` 的哈希被钉死，
 * 加一句话要同步两套钉住表 —— 那是另一轮裁决）；这里钉的是**屏上的可见性**。
 * ==================================================================== */

describe('★ 2026-10-01：卡牌制作器的本机数据（可见 + 可清除）', () => {
  it('渲染时就向宿主读一次"制作器存了什么"，并把张数写进那一条状态行', async () => {
    const h = harness({ cardmakerRead: async () => ({ count: 3 }) });
    const root = render(h);
    expect(h.counters.readCardmaker, '渲染时没有读一次制作器的本机数据').toBe(1);
    await flush();
    const line = one(root, 'cardmaker-state');
    expect(line.text, '屏上没写"3 张卡"').toContain('3 张卡');
    // 反向锚点：数字必须来自宿主（缺省读数见下面那条"空态"腿，两句话不同）
    expect(line.text, '有 3 张时却显示了空态那句').not.toContain('还没有保存过');
  });

  /* ── ★ 2026-10-01 线上验收 D1：**"空的"与"读不到"是两件事** ──────────────────

   * 缺陷：全新访客、以及**刚点完清除之后**，这一行都显示"读不到本机的数据（这台设备可能
   * 没有可用的 IndexedDB，或库被别的程序占着）"⇒ 用户会以为刚点的清除把东西弄坏了。
   * 根因：`readCardmakerDeckInfo` 把"没写过"与"读失败"都回成 `null`，屏上一句折叠了两种状态。
   * 修法：上游只在**真失败**时回 `null`，"没写过"回 `{ cards: 0 }`；屏上分成两句。
   *
   * 下面两条腿逐条钉住这一对，并且**互相做反向锚点**（同一句话不可能同时满足它们）：
   *  ① 空态（`count === 0`）⇒ 必须说"还没有保存过"，**不许**出现"读不到"；
   *  ② 读失败（`count === null`）⇒ 必须说"读不到"，**不许**出现"还没有保存过"。
   * 把实现改回"两种都回 null"（或屏上合并成一句）时，① 会当场红。
   */

  it('① 全新（库开得了、只是没写过：count === 0）⇒ 说"还没有保存过"，**不**说"读不到"', async () => {
    const h = harness({ cardmakerRead: async () => ({ count: 0 }) });
    const root = render(h);
    await flush();
    const text = one(root, 'cardmaker-state').text;
    expect(text, '空态没说"本机还没有保存过牌组"').toContain('还没有保存过');
    expect(
      text,
      '空态被说成"读不到本机的数据"（这正是线上验收 D1：全新访客以为东西坏了）',
    ).not.toContain('读不到');
    // 也说清它存在哪（用户要求"可见"这一条的实质）
    expect(text, '空态没说清它单独存在一个 IndexedDB 库里').toContain('IndexedDB');
  });

  it('② 读失败（count === null）⇒ 说"读不到"并给出两个常见原因，**不**说"还没有保存过"', async () => {
    const h = harness({ cardmakerRead: async () => ({ count: null }) });
    const root = render(h);
    await flush();
    const text = one(root, 'cardmaker-state').text;
    expect(text, '读不到时没说"读不到"').toContain('读不到');
    expect(text, '读不到时没给出可排查的原因（没有可用的 IndexedDB / 库被占用）').toContain('IndexedDB');
    expect(text, '读不到被显示成"还没有保存过"（不实陈述：读不到不等于没有）').not.toContain('还没有保存过');
    expect(text, '读不到被显示成"保存了 0 张卡"（不实陈述）').not.toContain('保存了 0 张卡');
    // 读不到**仍然**给得出清除按钮（读不到不等于没有数据）
    expect(byRole(root, 'clear-cardmaker').length).toBe(1);
    expect((one(root, 'clear-cardmaker') as unknown as { disabled?: boolean }).disabled).not.toBe(true);
  });

  it('清除之后回到**空态**那句（而不是"读不到"）—— 这是 D1 里用户最容易被吓到的一格', async () => {
    let cards = 2;
    const h = harness({
      cardmakerRead: async () => ({ count: cards }),
      cardmakerClear: async () => { cards = 0; return { ok: true, removed: true }; },
    });
    const root = render(h);
    await flush();
    expect(one(root, 'cardmaker-state').text).toContain('2 张卡');
    clickRole(root, 'clear-cardmaker');
    await flush();
    const text = one(root, 'cardmaker-state').text;
    expect(text, '清除之后没有回到空态那句').toContain('还没有保存过');
    expect(text, '清除之后显示成"读不到"（用户会以为清除把东西弄坏了）').not.toContain('读不到');
  });

  it('读数抛错（宿主炸了）⇒ 状态行如实写失败原因，不静默', async () => {
    const h = harness({ cardmakerRead: async () => { throw new Error('IndexedDB 被占用'); } });
    const root = render(h);
    await flush();
    expect(one(root, 'cardmaker-state').text, '读数抛错时没把真因写出来').toContain('IndexedDB 被占用');
  });

  it('点「清除卡牌制作器的本机数据」⇒ 调一次宿主的清除接缝、给出 clear-cardmaker-ok、并重新读一次', async () => {
    let cards = 2;
    const h = harness({
      cardmakerRead: async () => ({ count: cards }),
      cardmakerClear: async () => { cards = 0; return { ok: true, removed: true }; },
    });
    const root = render(h);
    await flush();
    expect(one(root, 'cardmaker-state').text).toContain('2 张卡');

    clickRole(root, 'clear-cardmaker');
    await flush();
    expect(h.counters.clearCardmaker, '点清除没调宿主的 clearCardmaker').toBe(1);
    expect(statusCode(root), '清除成功的结论不是 clear-cardmaker-ok').toBe('clear-cardmaker-ok');
    expect(h.counters.readCardmaker, '清除后没有重新读一次（屏上会留着旧数字）').toBe(2);
    // 清除之后是**空态**那句（`{ count: 0 }`），不是"读不到"，也不是还挂着旧张数
    expect(one(root, 'cardmaker-state').text, '清除后没有回到空态那句').toContain('还没有保存过');
    expect(one(root, 'cardmaker-state').text, '屏上还显示着清除前的张数').not.toContain('2 张卡');
  });

  it('本来就没有（removed === false）⇒ 是"没东西可清"，不是失败；删失败才报 failed + 真因', async () => {
    const empty = harness({ cardmakerClear: async () => ({ ok: true, removed: false }) });
    const re = render(empty);
    clickRole(re, 'clear-cardmaker');
    await flush();
    expect(statusCode(re), 'removed === false 被说成了失败').toBe('clear-cardmaker-empty');
    expect(statusText(re), 'removed === false 时出现了"失败"字样').not.toContain('失败');

    const bad = harness({ cardmakerClear: async () => ({ ok: false, detail: '库被别的标签页占着（VersionError）' }) });
    const rb = render(bad);
    clickRole(rb, 'clear-cardmaker');
    await flush();
    expect(statusCode(rb), '删失败的结论不是 clear-cardmaker-failed').toBe('clear-cardmaker-failed');
    expect(statusText(rb), '删失败没把真因显示出来').toContain('库被别的标签页占着（VersionError）');

    // 反向：真删成功时**不**走这两个分支（证明上面两条不是"恒真"）
    const ok = harness();
    const ro = render(ok);
    clickRole(ro, 'clear-cardmaker');
    await flush();
    expect(statusCode(ro)).toBe('clear-cardmaker-ok');
  });

  it('清除抛错（宿主假件 reject）⇒ 如实提示，不崩、不假成功', async () => {
    const h = harness({ cardmakerClear: async () => { throw new Error('删除被系统拒绝'); } });
    const root = render(h);
    clickRole(root, 'clear-cardmaker');
    await flush();
    expect(statusCode(root)).toBe('clear-cardmaker-failed');
    expect(statusText(root), '抛错时没把真因写出来').toContain('删除被系统拒绝');
    expect(textOf(root), '抛错却出现了"已清除"这种假成功').not.toContain('已清除卡牌制作器');
  });

  it('游客模式（deny）下这一块照常可见可点，且 persistent 零写入（红线 3 不受影响）', async () => {
    const spy = spyStore();
    const h = harness({ persistent: spy, granted: false });
    h.store.deny();
    const root = render(h);
    await flush();
    expect(textOf(one(root, 'consent-state'))).toMatch(/游客/);
    expect(byRole(root, 'cardmaker').length, '游客模式下这一块整个不见了').toBe(1);
    clickRole(root, 'clear-cardmaker');
    await flush();
    // 制作器走的是它自己的 IndexedDB 库，与 L1 的 persistent KV 无关
    expect(spy.mutations(), '制作器那一块碰了 L1 的 persistent（红线 3）').toBe(0);
  });

  /**
   * ★★ 2026-10-01 贯通腿（线上验收 D1 的"测试为什么没拦住"那一问的**正面回答**）。
   *
   * ## 为什么必须有它
   * D1 漏网的机制是**夹具口径与真宿主口径分叉**：上面那些腿注入的是桩
   * （`cardmakerRead: async () => ({ count: 0 })`），而**真宿主**那时把"没写过"翻成
   * `null` ⇒ 屏上的断言在桩上**恒真**。把屏与桩绑在一起测，**无论怎么改上游都发现不了**
   * （变异实测：只把上游改回 `null` ⇒ 本文件整套 49 条**全绿**）。
   *
   * ## 这条腿怎么做
   * **不用桩**：拿**真的** `readCardmakerDeckInfo` + **假 IndexedDB**
   * （`fakeIdb` 从 `cardmaker-entry.test.ts` 借，见那里的说明），按
   * `src/main.ts` 的 `showLocalData` 里那两个 nav 成员的**同一口径**驱动**真的**
   * `renderLocalData`：`count: info === null ? null : info.cards`、
   * `removed: before !== null && before.cards > 0`。于是"上游把空态回成 null"这一类改动
   * 会**当场**在这条腿上红（已实测，见报告的变异 M1+M3）。
   *
   * ## 覆盖面（如实声明）
   * **能**：`store-idb` → `count` → 屏上那两句 这条链在"空 / 有 / 读不到"三态下都对，
   * 并且清除之后**真的**回到空态那一句。
   * **不能**：`main.ts` 里那两行与这里的照抄**逐字相同**（那一面由
   * `cardmaker-entry.test.ts` 的源码结构腿覆盖），也不能证明真实设备上 IndexedDB 的行为。
   */
  it('贯通（真 store + 假 IndexedDB + 真屏）：空白 → 有 → 清除回空态；只有真失败才说"读不到"', async () => {
    const { factory, db } = fakeIdb();
    /** 按 `main.ts` 的 showLocalData 那两个成员的口径驱动（见上面那段注释） */
    const realReader = async (): Promise<{ count: number | null }> => {
      const info = await readCardmakerDeckInfo(factory);
      return { count: info === null ? null : info.cards };
    };
    const h = harness({
      cardmakerRead: realReader,
      cardmakerClear: async () => {
        const before = await readCardmakerDeckInfo(factory);
        const out = await clearCardmakerDeck(factory);
        if (!out.ok) return { ok: false, detail: out.detail };
        return { ok: true, removed: before !== null && before.cards > 0 };
      },
    });

    // ① 全新访客：假 IDB 里一个记录都没有 ⇒ **空态**（不是"读不到"）
    const root = render(h);
    await flush();
    expect(one(root, 'cardmaker-state').text, '真 store 口径下"全新"没显示成空态').toContain('还没有保存过');
    expect(one(root, 'cardmaker-state').text, '真 store 口径下"全新"被显示成"读不到"（D1 的现场）')
      .not.toContain('读不到');

    // ② 塞一份真记录进去，**重新渲染一帧**（读是渲染期发起的）⇒ 报出张数
    const deck = sampleDeck();
    deck.cards = [defaultCard('a', 'compile'), defaultCard('b', 'protocol'), defaultCard('c', 'compile')];
    db.data.set(CARDMAKER_DECK_KEY, deck);
    const root2 = render(h);
    await flush();
    expect(one(root2, 'cardmaker-state').text, '真 store 口径下没能报出张数').toContain('3 张卡');

    // ③ 点清除（真删一条记录）⇒ 回到**空态**那句，且屏上不说"读不到"
    clickRole(root2, 'clear-cardmaker');
    await flush();
    expect(db.deletes, '真 store 口径下清除没有真的删那条记录').toEqual([CARDMAKER_DECK_KEY]);
    expect(one(root2, 'cardmaker-state').text, '真 store 口径下清除之后没有回到空态').toContain('还没有保存过');
    expect(one(root2, 'cardmaker-state').text, '真 store 口径下清除之后显示成"读不到"（D1 的现场）')
      .not.toContain('读不到');

    // ④ **真读不出来**（没有 IndexedDB）⇒ 才说"读不到"
    const broken = harness({
      cardmakerRead: async () => {
        const info = await readCardmakerDeckInfo(null);
        return { count: info === null ? null : info.cards };
      },
    });
    const r2 = render(broken);
    await flush();
    expect(one(r2, 'cardmaker-state').text, '真读不出来时没说"读不到"').toContain('读不到');
    expect(one(r2, 'cardmaker-state').text, '真读不出来时反被说成"还没有保存过"').not.toContain('还没有保存过');
  });
});
