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
  type StubNode,
} from './net-dom-stub';
import { renderLocalData, type LocalDataNav } from '../../src/ui/local-data';
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
  stringifyMatchFile,
  type MatchFile,
} from '../../src/app/match-file';
import { CARD_DATA_HASH } from '../../src/app/card-data-hash';
import type { FilePicker, FileSink, PickOutcome, SaveOutcome } from '../../src/app/archive-fs';
import { stripComments, functionBody } from './source-text';

/**
 * G3 Task 7 守卫：「本地数据与隐私」屏（`src/ui/local-data.ts`）。
 *
 * ## 本文件证明什么 / 不能证明什么（**不要读成"浏览器里已验证"**）
 *  **能**（全部是"真跑一次、拿返回值/调用记录"的行为腿，DOM 用手写桩 `tests/ui/net-dom-stub.ts`）：
 *   1. 屏上**逐条**含 `privacyLines()` 的当前返回值（生成式遍历，本文件不写第二份文案）；
 *   2. "清除本机数据"：屏内确认 → 真清 persistent 里的 L1 键 → `consent()` 回 `unknown`；
 *      取消 ⇒ 一个字节都不清；清除抛错 ⇒ 如实提示（不静默）；**游客模式下 persistent 的
 *      `set`/`remove` 调用数恒 0**（红线 3）；
 *   3. "导出档案"：假 `FileSink` 收到的文本能被 `importArchive` 原样读回，且两次导出逐字节
 *      相同**并且**等于"解析后按稳定序列化重排"的字节（后者才是"没把稳定序列化换成
 *      `JSON.stringify`"的判据 —— 见 `导出稳定性` 一组的说明）；
 *   4. "导入档案"：`cancelled` / `unsupported` / `failed` **三态分别**可辨识，`text()` reject
 *      映射到 `read-failed`，损坏档案出错误文案且**不调** `onImported`，超大文件**不读**内容；
 *   5. 导入"永不 settle"时没有任何永久禁用/永久等待的形态（协调者 2026-09-16 裁决）；
 *   6. `src/main.ts` 的 Task 7 行区（`showLocalData` 接线 + 主页入口）与 `cb`/`rerender`
 *      逐字节未动。
 *  **不能**：真实浏览器里的观感、真实磁盘到底写没写、真实 `<input type=file>` 的取消语义
 *  （那些属计划 Task 7 Step 6 的无头自查与人眼验收）。
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
  counters: { back: number };
  setPick(h: PickHandler): void;
  setSave(h: SaveHandler): void;
}

function harness(opts: {
  persistent?: KeyValueStore;
  granted?: boolean;
  pick?: PickHandler;
  save?: SaveHandler;
} = {}): Harness {
  const persistent = opts.persistent ?? createMemoryStore();
  const store = createLocalStore({ persistent });
  if (opts.granted !== false) store.grant();
  let pickHandler: PickHandler = opts.pick ?? cancelledPick;
  let saveHandler: SaveHandler = opts.save ?? cancelledSave;
  const pickCalls: Array<{ accept: string[] }> = [];
  const saveCalls: Array<{ suggestedName: string; text: string }> = [];
  const imported: Array<{ file: MatchFile; warnings: string[] }> = [];
  const counters = { back: 0 };
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
    counters,
    persistent,
    store,
    nav: {
      back: () => { counters.back += 1; },
      store,
      pickFile,
      saveFile,
      onImported: (file, warnings) => { imported.push({ file, warnings }); },
    },
    setPick: (h) => { pickHandler = h; },
    setSave: (h) => { saveHandler = h; },
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

  it('三块内容都有落点：授权状态（含两个按钮）/ 可编辑昵称 / 导出导入按钮', () => {
    const root = render(harness());
    const roles = [
      'status', 'consent', 'consent-state', 'change-consent', 'clear',
      'nick-input', 'nick-save', 'stored', 'privacy', 'archive', 'export', 'import', 'back',
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
  it('点「导出档案」⇒ 假 saveFile 收到一份能被 importArchive 原样读回的文本（判据 3）', async () => {
    const h = harness({
      save: async (o) => ({ ok: true, name: o.suggestedName, mode: 'download' }),
    });
    writeNickName(h.store, '甲');
    writeDecks(h.store, [deck()]);
    const root = render(h);
    clickRole(root, 'export');
    await flush();

    expect(h.saveCalls, 'saveFile.save 没有被调用').toHaveLength(1);
    const { suggestedName, text } = h.saveCalls[0];
    const parsed = importArchive(text, { currentHash: CARD_DATA_HASH });
    expect(parsed.ok, '导出的文本连自家 importArchive 都读不回来').toBe(true);
    if (!parsed.ok) return;
    expect(parsed.warnings, '导出的档案自带警告 ⇒ 往返不干净').toEqual([]);
    expect(parsed.file.players[0].nick, '档案里没有本机昵称').toBe('甲');
    expect(suggestedName.endsWith('.compile-match.json'), `文件名不对：${suggestedName}`).toBe(true);
    expect(suggestedName, '文件名里没有 seed 前 8 位').toContain(parsed.file.seed.slice(0, 8));
    expect(statusCode(root)).toBe('export-ok');
  });

  it('导出的文本是**稳定序列化**：两次导出逐字节相同，且等于"解析后稳定重排"的字节（变异 #4 的牙）', async () => {
    const h = harness({ save: async (o) => ({ ok: true, name: o.suggestedName, mode: 'download' }) });
    writeNickName(h.store, '甲');
    writeDecks(h.store, [deck()]);
    const root = render(h);

    clickRole(root, 'export');
    await flush();
    clickRole(root, 'export');
    await flush();
    expect(h.saveCalls).toHaveLength(2);

    const [first, second] = h.saveCalls.map((s) => s.text);
    // ① 两次导出逐字节相同（同一个进程里，稳定序列化的直接后果）
    expect(first, '两次导出的字节不同 ⇒ 序列化不稳定').toBe(second);
    // ② ⚠️ ① 单独**抓不住**"把 stringifyMatchFile 换成 JSON.stringify" —— 对同一个**新建字面量**，
    //    `JSON.stringify` 同样是确定的（计划里"JSON.stringify 不稳定"的推理对新建对象不成立）。
    //    真正的判据是这一条：字节必须是"键排序后"的形态 ⇒ 先用自己的解析器读回来，再按
    //    稳定序列化重排，两者必须**逐字节**相等。换成 JSON.stringify（保留字面量的键序）时，
    //    这两串字节的键序不同 ⇒ 当场红。
    const parsed = importArchive(first, { currentHash: CARD_DATA_HASH });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(first, '导出文本不是稳定序列化（键未排序）').toBe(stringifyMatchFile(parsed.file));
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
    // 只报告、不自动进对局：屏上必须明说 G3/G4 的边界
    expect(statusText(root)).toContain('本阶段还不能直接重放');
    expect(h.counters.back, '导入成功后不该自动离开本屏').toBe(0);
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
 * 8. 接线腿：main.ts 的 Task 7 行区 + cb/rerender 逐字节未动
 * ==================================================================== */

/** 仓库根（`git show` 的 cwd；去掉 Windows 路径末尾的分隔符）。 */
const REPO = fileURLToPath(new URL('../../', import.meta.url)).replace(/[\\/]+$/, '');
const MAIN_CODE = stripComments(
  readFileSync(fileURLToPath(new URL('../../src/main.ts', import.meta.url)))
    .subarray(0, 1024 * 1024).toString('utf8'),
);
const CB_HEAD = 'const cb: UiCallbacks = ';

/**
 * 取 `const cb: UiCallbacks = { … }` 这类**对象字面量声明**的整段（花括号配平、字符串感知）。
 * `source-text.ts` 的 `functionBody` 只认 `function name(`，故这里补一个同款纪律的局部助手
 * （找不到就**抛错**，而不是返回空串让上层断言假绿）。
 */
function objectBody(src: string, head: string): string {
  const at = src.indexOf(head);
  if (at < 0) throw new Error(`源码里找不到声明头 ${head}（结构被改动？）`);
  const open = src.indexOf('{', at);
  if (open < 0) throw new Error(`声明头 ${head} 之后没有 {`);
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === "'" || ch === '"' || ch === '`') {
      const q = ch;
      i += 1;
      while (i < src.length) {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === q) break;
        i += 1;
      }
      continue;
    }
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return src.slice(at, i + 1);
    }
  }
  throw new Error(`声明头 ${head} 的花括号不配平`);
}

/**
 * 基线 `main.ts` = **最早引入 Task 7 符号的那次提交的父提交**（`git show <c>^:src/main.ts`）。
 *
 * ⚠️ **为什么基线不是 HEAD**（实测，不是假想）：本任务开工期间，并行的**路径限定提交**
 * （`git add src/main.ts`）把当时工作树里的 Task 7 hunk 一并带进了别的提交 ⇒
 * `HEAD:src/main.ts` 里**已经**有 `showLocalData()`，拿它当基线会让"逐字节相同"变成**恒真**。
 * 这一点是下面那条 `showHome` **对照组**抓出来的（两边 `showHome` 不再不同 ⇒ 判据报警），
 * 不是我先验就知道的。改用 `git log -S`：与提交顺序/提交信息无关，且父提交里必然
 * **不含** Task 7 的任何符号（有锚点腿钉住这件事）。
 * 返回 `null` = 历史上还没有任何提交引入过 `showLocalData`（本腿跳过并如实报出）。
 */
function baselineMainCode(): string | null {
  const hashes = execFileSync(
    'git',
    // ⚠️ 路径用 `:/src/main.ts`（**仓库根**相对），不是裸 `src/main.ts`（**cwd** 相对）：
    //    变异实测在**隔离镜像**里跑（`.superpowers/task7-mirror/`），那里的 cwd 前缀会让裸
    //    pathspec 命中不到任何历史 ⇒ 这条腿会在镜像里假红。`:/` 前缀让它在任何 cwd 下同义。
    ['log', '--format=%H', '-S', 'showLocalData', '--', ':/src/main.ts'],
    { cwd: REPO, encoding: 'utf8' },
  ).trim().split('\n').filter((x) => x !== '');
  if (hashes.length === 0) return null;
  const raw = execFileSync(
    'git',
    // `<rev>:<path>` 这一形态本就是**树根**相对（要 cwd 相对得写 `./`）⇒ 镜像里同样成立。
    ['show', `${hashes[hashes.length - 1]}^:src/main.ts`],
    { cwd: REPO, encoding: 'utf8' },
  );
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

describe('接线腿：main.ts（Task 7 行区）', () => {
  it('showLocalData 把 nav 的五个落点都接上了（不是空实现）', () => {
    const body = functionBody(MAIN_CODE, 'showLocalData');
    expect(body.length, 'functionBody 抽到空片段 ⇒ 本组判据假绿').toBeGreaterThan(120);
    expect(body).toContain('renderLocalData(root');
    expect(body, '没接选择器').toMatch(/openArchivePicker\s*\(/);
    expect(body, '没接落盘口').toMatch(/openArchiveSink\s*\(/);
    expect(body, 'store 没接 localStore').toMatch(/store:\s*localStore/);
    expect(body, 'back 没接 showStartScreen').toMatch(/back:\s*showStartScreen/);
    expect(body, '没接 onImported 接缝').toMatch(/onImported/);
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

  it.runIf(HAVE_GIT)('cb / rerender 的函数体与"引入 Task 7 之前"的提交逐字节相同（对照组：showHome 必须不同）', () => {
    const before = baselineMainCode();
    expect(before, 'git 里找不到"引入 Task 7 之前"的 main.ts ⇒ 本腿没有基线').not.toBeNull();
    if (before === null) return;
    // 锚点：基线里**没有** Task 7 的任何符号，否则"两边相同"可能是"两边都含 Task 7"= 恒真
    expect(before.includes('showLocalData'), '基线里已经有 showLocalData ⇒ 这不是"之前"的基线').toBe(false);
    expect(before, '基线里没有 rerender ⇒ 后面的比对没意义').toContain('function rerender(): void {');
    expect(before, '基线里没有 cb ⇒ 后面的比对没意义').toContain(CB_HEAD);

    const pairs: Array<[string, string, string]> = [
      ['rerender', functionBody(MAIN_CODE, 'rerender'), functionBody(before, 'rerender')],
      ['cb', objectBody(MAIN_CODE, CB_HEAD), objectBody(before, CB_HEAD)],
    ];
    for (const [name, now, then] of pairs) {
      expect(now.length, `${name} 抽到空片段`).toBeGreaterThan(200);
      expect((now.match(/\r/g) ?? []).length, `${name} 的片段里有 \\r`).toBe(0);
      expect((then.match(/\r/g) ?? []).length, `基线的 ${name} 片段里有 \\r`).toBe(0);
      expect(now, `${name} 的字节被改动了（G4 收口范围内，谁都不许动）`).toBe(then);
    }
    // 对照组：`showHome` 被 Task 4/7 改过（它必须**不同**）—— 否则"相同"这条判据可能是恒真的
    expect(functionBody(MAIN_CODE, 'showHome')).not.toBe(functionBody(before, 'showHome'));
  });
});
