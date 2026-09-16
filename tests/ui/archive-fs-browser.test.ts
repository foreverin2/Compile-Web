/**
 * G3 Task 6：`src/ui/archive-fs-browser.ts` 的**运行时行为腿**（不是文本腿）。
 *
 * ## 为什么这个文件必须存在（一次真实事故的产物）
 * 上一轮 `src/ui/pwa-update.ts` 把正确的 API 写错了（读 `globalThis.serviceWorker` 而不是
 * `navigator.serviceWorker`）：**真实浏览器里 PWA 从不注册**，承诺的离线/更新全部没达成，
 * 而四道门禁**全绿** —— 因为它只有"读源码找字符串"的文本腿。用户据此裁决：
 * **浏览器实现不许只靠文本腿。**
 *
 * 于是本文件的每一条都**真跑一次** `open()` / `save()`，断言的是**返回值与调用记录**
 * （`File.text()` 读回了什么、`write()` 收到的字节是什么、`click()` / `revokeObjectURL()`
 * 有没有被调用、取消时返回的 `reason` 是 `cancelled` 还是 `failed`），而不是"源码里有某个字符串"。
 *
 * ## 注入缝在**参数表**上，不是给 `globalThis` 打桩
 * `buildArchiveFilePicker({ showOpenFilePicker })` / `buildArchiveFileSink({ document, … })`
 * —— node 下没有 `document`/`URL`/FSA，所以全部浏览器调用都从参数表进（默认值才读真全局）。
 * 这样做还顺带证明了一件事：`src/ui/archive-fs-browser.ts` **真的**可注入（否则本文件连
 * 一条腿都跑不起来）。**时钟与定时器也在这张表上**（修复轮 F7）：`now` / `setTimeout` /
 * `clearTimeout` 都能注入，h) 段就是靠注入的定时器把超时窗口跑成**确定性**的。
 *
 * ## G3 Task 6 修复轮新增的判据（逐条都有对应的变异实测）
 *  - **F15**：`open()` 返回三态可辨识的 `PickOutcome`（`cancelled` / `unsupported` / `failed`），
 *    而不再把三者折叠成一个 `null`；
 *  - **F1**：监听必须先于 `click()`（b5 用"在 click 内同步派发 change"的宿主钉住）；
 *  - **F2**：`save()` / `open()` **永不 reject**（g4~g7）；
 *  - **F3**：MIME 与扩展名来自 `archive-io.ts` 的**唯一出处**（e2~e4 生成式断言）；
 *  - **F7**：定时器走参数表 + 超时窗口两条腿（h1/h2）；
 *  - **F9/F10**：零参工厂的 overrides 真被转发（i1/i2），`c3` 从 `typeof` 断言改成真跑。
 *
 * ## 诚实边界（**不要读成"真实浏览器已验证"**）
 * 能：降级顺序、FSA 的调用序列与写入内容、取消 vs 不支持 vs 失败的区分、blob URL 的成对撤销、
 *     失败时的 `reason`/`detail`、超时窗口的**逻辑**（用注入的假定时器）。
 * 不能：真实磁盘上到底有没有出现那个文件、Safari/Firefox 的 FSA 行为、8 MiB 文件的真实内存
 *     占用、真实 `setTimeout` 的调度精度 —— 那些属**用户验收**。本文件不替代它。
 */
import { describe, it, expect, afterEach } from 'vitest';
import {
  archiveFileCapabilities,
  buildArchiveFilePicker,
  buildArchiveFileSink,
  openArchivePicker,
  openArchiveSink,
} from '../../src/ui/archive-fs-browser';
import { ARCHIVE_EXT, ARCHIVE_MIME } from '../../src/app/archive-io';
import {
  installStubDom,
  makeStubEl,
  queryAllIn,
  type StubNode,
} from './net-dom-stub';

/* ── 假件 ─────────────────────────────────────────────────────────────────── */

interface FakeFile {
  name: string;
  size: number;
  payload: string;
  /** 每一次 `text()` 调用都记一笔：腿要断言"真的读了"，不是"有这个方法" */
  reads: number;
  text(): Promise<string>;
}

function fakeFile(name: string, payload: string, size = payload.length): FakeFile {
  const f: FakeFile = {
    name,
    size,
    payload,
    reads: 0,
    text: async () => {
      f.reads += 1;
      return f.payload;
    },
  };
  return f;
}

/** 假的 `showOpenFilePicker`：记录入参，返回句柄数组（`getFile()` 返回传入的那个文件） */
function fakeOpen(init: { file?: unknown; error?: unknown; getFileError?: unknown } = {}): {
  fn: (o: unknown) => Promise<unknown[]>;
  calls: unknown[];
} {
  const calls: unknown[] = [];
  const fn = async (o: unknown): Promise<unknown[]> => {
    calls.push(o);
    if (init.error !== undefined) throw init.error;
    return [
      {
        name: (init.file as { name?: string } | undefined)?.name ?? 'x.json',
        getFile: async () => {
          if (init.getFileError !== undefined) throw init.getFileError;
          return init.file;
        },
      },
    ];
  };
  return { fn, calls };
}

/** 假的 `showSaveFilePicker`：可指定抛错或写入抛错 */
function fakeSave(init: { error?: unknown; writeError?: unknown; name?: string } = {}): {
  fn: (o: unknown) => Promise<unknown>;
  calls: unknown[];
  writes: string[];
  closes: number;
} {
  const calls: unknown[] = [];
  const writes: string[] = [];
  let closes = 0;
  const fn = async (o: unknown): Promise<unknown> => {
    calls.push(o);
    if (init.error !== undefined) throw init.error;
    return {
      name: init.name ?? 'a.json',
      createWritable: async () => ({
        write: async (d: unknown) => {
          if (init.writeError !== undefined) throw init.writeError;
          writes.push(d as string);
        },
        close: async () => { closes += 1; },
      }),
    };
  };
  return { fn, calls, writes, get closes() { return closes; } };
}

/** 浏览器的 `AbortError`（真实里是 `DOMException`；只用到 `name`，故不需要 `DOMException`） */
const abortError = (): { name: string } => ({ name: 'AbortError' });

/* ── DOM 夹具（现成的手写桩 `tests/ui/net-dom-stub.ts`） ───────────────────── */

const restores: Array<() => void> = [];

afterEach(() => {
  while (restores.length > 0) restores.pop()?.();
});

function stubDom(): StubNode {
  const restore = installStubDom();
  restores.push(restore);
  return (globalThis as unknown as { document: { body: StubNode } }).document.body;
}

/** 极简事件派发：桩的 `dispatchEvent` 只向上冒泡，而断言要的是"在**那个**节点上触发" */
function fire(el: StubNode, type: string, ev: unknown = {}): void {
  const arr = (el as unknown as { __listeners?: Record<string, Array<(e: unknown) => void>> }).__listeners;
  for (const cb of arr?.[type] ?? []) cb(ev);
}

/**
 * 等到 `cond()` 为真（上限 ~1s）。
 *
 * 用途：有些腿要先**走完异步的 FSA 降级**才会建出 `<input>`（`open()` 在 `await pick(…)`
 * 处会让出），因此不能在调用 `open()` 之后**同步**去 `fire(els[0], …)` —— 那时 `els` 还是空的
 * （实测报 `Cannot read properties of undefined (reading '__listeners')`）。
 * `setTimeout(0)` 是宏任务 ⇒ 一定会先把挂起的微任务链跑完。
 */
async function until(cond: () => boolean, label: string): Promise<void> {
  for (let i = 0; i < 200; i += 1) {
    if (cond()) return;
    await new Promise<void>((r) => { setTimeout(r, 0); });
  }
  throw new Error(`等待超时：${label}`);
}

/**
 * 给桩节点接上"能触发"的能力（`click` / `addEventListener` / `remove` 都记一笔）。
 *
 * `onClick`（修复轮 F1 新增）：让**宿主在 `click()` 内部**做点什么 —— b5 用它模拟
 * "同步派发 change"的 WebView，b6/g6 用它模拟 `click()` 抛错。
 */
function instrument(el: StubNode, log?: { clicks: number }, onClick?: (el: StubNode) => void): void {
  const listeners: Record<string, Array<(e: unknown) => void>> = {};
  el.addEventListener = ((t: string, cb: (e: unknown) => void) => {
    (listeners[t] ??= []).push(cb);
  }) as unknown as StubNode['addEventListener'];
  el.removeEventListener = ((t: string, cb: (e: unknown) => void) => {
    listeners[t] = (listeners[t] ?? []).filter((f) => f !== cb);
  }) as unknown as StubNode['removeEventListener'];
  el.click = (() => { if (log) log.clicks += 1; onClick?.(el); }) as unknown as StubNode['click'];
  el.remove = (() => { el.parentElement = null; }) as unknown as StubNode['remove'];
  (el as unknown as { __listeners: typeof listeners }).__listeners = listeners;
}

/**
 * 造一个**桩 document**：`createElement` 真的记账（每个元素都带可触发的 click/change），
 * `body` 有真实的 `appendChild`/`removeChild`。
 */
function instrumentedDoc(
  log: { clicks: number; created: string[] },
  onClick?: (el: StubNode) => void,
): {
  doc: { createElement(t: string): unknown; body: { appendChild(n: unknown): unknown; removeChild(n: unknown): unknown } };
  els: StubNode[];
} {
  const els: StubNode[] = [];
  const children: unknown[] = [];
  return {
    doc: {
      createElement: (t: string) => {
        log.created.push(t);
        const el = makeStubEl(t);
        instrument(el, log, onClick);
        els.push(el);
        return el as unknown as Element;
      },
      body: {
        appendChild: (n: unknown) => {
          const node = n as StubNode;
          node.parentElement = node.parentElement ?? null;
          children.push(node);
          (node as unknown as { __mounted?: boolean }).__mounted = true;
          return n;
        },
        removeChild: (n: unknown) => {
          const i = children.indexOf(n);
          if (i >= 0) children.splice(i, 1);
          return n;
        },
      },
    },
    els,
  };
}

/**
 * **可注入的假时钟 + 假定时器**（修复轮 F7）。
 *
 * 为什么必须有它：`<input>` 那条路的"用户取消判定窗口"是**真时间**行为，用 `sleep` 去测会
 * 又慢又飘；而这条分支在修复前**零覆盖**。注入之后，"到点 ⇒ cancelled"与"窗口内来 change
 * ⇒ 不再等"都变成**确定性**断言，且顺带证明了一件事：实现用的是**参数表里的**定时器，
 * 不是 `globalThis.setTimeout`（后者会让 `scheduleCalls()` 恒 0 ⇒ 当场红）。
 */
function fakeClock(): {
  now: () => number;
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (id: unknown) => void;
  scheduleCalls: () => number;
  clearCalls: () => number;
  pendingCount: () => number;
  advanceTo: (t: number) => void;
  fireDue: () => void;
} {
  let t = 0;
  let seq = 1;
  let pending: { id: number; fn: () => void; at: number } | null = null;
  let scheduleCalls = 0;
  let clearCalls = 0;
  return {
    now: () => t,
    setTimeout: (fn: () => void, ms: number) => {
      scheduleCalls += 1;
      const id = seq;
      seq += 1;
      pending = { id, fn, at: t + ms };
      return id;
    },
    clearTimeout: () => { clearCalls += 1; pending = null; },
    scheduleCalls: () => scheduleCalls,
    clearCalls: () => clearCalls,
    pendingCount: () => (pending === null ? 0 : 1),
    advanceTo: (next: number) => { t = next; },
    fireDue: () => {
      // 连续触发到点回调（实现里下一次 setTimeout 会重新填 pending）
      for (let guard = 0; pending !== null && pending.at <= t && guard < 50; guard += 1) {
        const p = pending;
        pending = null;
        p.fn();
      }
    },
  };
}

/** 断言的收窄助手：腿里统一用它断言"这不是成功"，并读出 `reason` / `detail` */
function reasonOf(r: { ok: boolean; reason?: unknown; detail?: unknown }): { reason: string; detail: string } {
  expect(r.ok).toBe(false);
  return { reason: String(r.reason), detail: String(r.detail) };
}

/* ============================================================================
 * a) 有 showOpenFilePicker ⇒ 走 FSA
 * ========================================================================== */

describe('a) 有 showOpenFilePicker ⇒ 走 FSA（name/size/text 全部来自 FSA 返回的文件）', () => {
  it('open() 返回 { ok:true, file } 且读得到真实内容；FSA 之后**不该**再碰 <input type="file">', async () => {
    const body = stubDom();
    const log = { clicks: 0, created: [] as string[] };
    const { doc } = instrumentedDoc(log);
    const file = fakeFile('compile-abcdef01-20260916-123456.compile-match.json', '{"format":"compile-match"}');
    const { fn, calls } = fakeOpen({ file });
    const picker = buildArchiveFilePicker({ showOpenFilePicker: fn as never, document: doc as never });

    const picked = await picker.open({ accept: [ARCHIVE_MIME] });

    expect(picked.ok).toBe(true);
    if (!picked.ok) return;
    expect(picked.file.name).toBe(file.name);
    expect(picked.file.size).toBe(file.size);
    expect(await picked.file.text()).toBe('{"format":"compile-match"}');
    // 调用记录：FSA 真的被调了一次，且是"单文件 + 有类型过滤"
    expect(calls.length).toBe(1);
    expect((calls[0] as { multiple: boolean }).multiple).toBe(false);
    expect(Array.isArray((calls[0] as { types: unknown[] }).types)).toBe(true);
    expect(file.reads).toBe(1);
    // 走了 FSA 就不该再创建/点击 <input>（否则用户会被弹两次框）
    expect(log.created).toEqual([]);
    expect(log.clicks).toBe(0);
    expect(queryAllIn(body, 'input').length).toBe(0);
  });

  it('FSA 与 <input> 同时可用时，FSA 胜出（优先级判据）', async () => {
    stubDom();
    const log = { clicks: 0, created: [] as string[] };
    const { doc } = instrumentedDoc(log);
    const file = fakeFile('via-fsa.json', 'FSA');
    const { fn } = fakeOpen({ file });
    const picker = buildArchiveFilePicker({ showOpenFilePicker: fn as never, document: doc as never });
    const picked = await picker.open({ accept: [ARCHIVE_MIME] });
    expect(picked.ok).toBe(true);
    if (!picked.ok) return;
    expect(await picked.file.text()).toBe('FSA');
    expect(log.clicks).toBe(0);
    expect(log.created).toEqual([]);
  });

  it('userActivation.isActive === false（Firefox 式手势限制）⇒ 判 FSA 不可用，降级到 <input>', async () => {
    stubDom();
    const log = { clicks: 0, created: [] as string[] };
    const { doc, els } = instrumentedDoc(log);
    const { fn, calls } = fakeOpen({ file: fakeFile('nope.json', 'NOPE') });
    const picker = buildArchiveFilePicker({
      showOpenFilePicker: fn as never,
      userActivation: { isActive: false },
      document: doc as never,
    });
    const p = picker.open({ accept: [ARCHIVE_MIME] });
    fire(els[0], 'change', { target: { files: [fakeFile('via-input.json', 'INPUT')] } });
    const picked = await p;
    expect(calls.length).toBe(0); // FSA 一次都没被调
    expect(picked.ok).toBe(true);
    if (!picked.ok) return;
    expect(picked.file.name).toBe('via-input.json');
    expect(await picked.file.text()).toBe('INPUT');
  });
});

/* ============================================================================
 * b) 无 showOpenFilePicker ⇒ 降级到 <input type="file">
 * ========================================================================== */

describe('b) 降级到 <input type="file">：成功、取消、宿主抛错三条路各自可辨识', () => {
  it('成功：<input> 被创建、被 click()、change 之后 text() 读回内容；收尾时监听与节点都被摘掉', async () => {
    const body = stubDom();
    const log = { clicks: 0, created: [] as string[] };
    const { doc, els } = instrumentedDoc(log);
    const picker = buildArchiveFilePicker({ document: doc as never });
    const p = picker.open({ accept: ['application/json', 'text/json'] });

    expect(log.created).toEqual(['input']);
    expect(log.clicks).toBe(1);
    expect(els[0].accept).toBe('application/json,text/json');
    expect(els[0].multiple).toBe(false);
    expect(els[0].style.display).toBe('none');

    fire(els[0], 'change', { target: { files: [fakeFile('picked.json', '{"a":1}', 7)] } });
    const picked = await p;
    expect(picked.ok).toBe(true);
    if (!picked.ok) return;
    expect(picked.file.name).toBe('picked.json');
    expect(picked.file.size).toBe(7);
    expect(await picked.file.text()).toBe('{"a":1}');

    // 收尾：节点被摘除、监听被解除（否则下次 change 会打到已经 resolve 的 Promise 上）
    expect(els[0].parentElement).toBeNull();
    const listeners = (els[0] as unknown as { __listeners: Record<string, unknown[]> }).__listeners;
    expect(listeners.change.length).toBe(0);
    expect(listeners.cancel.length).toBe(0);
    expect(queryAllIn(body, 'input').length).toBe(0);
  });

  it('**F15** 用户在原生框里取消（派的 cancel 事件）⇒ { ok:false, reason:"cancelled" }（不是 null，也不是 failed）', async () => {
    stubDom();
    const log = { clicks: 0, created: [] as string[] };
    const { doc, els } = instrumentedDoc(log);
    const picker = buildArchiveFilePicker({ document: doc as never });
    const p = picker.open({ accept: [ARCHIVE_MIME] });
    fire(els[0], 'cancel', {});
    const r = await p;
    expect(reasonOf(r).reason).toBe('cancelled');
    expect(reasonOf(r).detail.length).toBeGreaterThan(0);
  });

  it('**F15** change 事件里没有任何文件（用户点了取消但浏览器仍派发了 change）⇒ cancelled', async () => {
    stubDom();
    const log = { clicks: 0, created: [] as string[] };
    const { doc, els } = instrumentedDoc(log);
    const picker = buildArchiveFilePicker({ document: doc as never });
    const p = picker.open({ accept: [ARCHIVE_MIME] });
    fire(els[0], 'change', { target: { files: [] } });
    expect(reasonOf(await p).reason).toBe('cancelled');
  });

  it('**F15** 宿主 createElement 抛错 ⇒ reason:"failed" + 真因（**不是**"这台设备不支持"，也不是 null）', async () => {
    stubDom();
    const throwingDoc = {
      createElement: () => { throw new Error('沙箱 iframe 里不许建元素'); },
      body: null,
    };
    const picker = buildArchiveFilePicker({ document: throwingDoc as never });
    const r = await picker.open({ accept: [ARCHIVE_MIME] });
    expect(reasonOf(r).reason).toBe('failed');
    expect(reasonOf(r).detail).toContain('沙箱 iframe 里不许建元素');
  });

  it('**F1** 宿主在 click() 内**同步**派发 change ⇒ 仍能拿到文件（监听必须先于 click；旧实现 = HANG）', async () => {
    stubDom();
    const log = { clicks: 0, created: [] as string[] };
    const order: string[] = [];
    // 这个 document 的 <input> 在 `click()` 里**同步**派发 `change`（部分 WebView / 自动化环境的行为）
    const syncDoc = {
      createElement: () => {
        const listeners: Record<string, Array<(e: unknown) => void>> = {};
        return {
          type: '', accept: '', multiple: false, style: { display: '' }, files: null,
          addEventListener: (t: string, cb: (e: unknown) => void) => {
            order.push(`listen:${t}`);
            (listeners[t] ??= []).push(cb);
          },
          removeEventListener: (t: string, cb: (e: unknown) => void) => {
            listeners[t] = (listeners[t] ?? []).filter((f) => f !== cb);
          },
          click: () => {
            order.push('click');
            const f = fakeFile('sync.json', 'SYNC');
            for (const cb of listeners.change ?? []) cb({ target: { files: [f] } });
          },
          remove: () => { /* noop */ },
        };
      },
      body: { appendChild: () => { /* noop */ }, removeChild: () => { /* noop */ } },
    };
    const picker = buildArchiveFilePicker({ document: syncDoc as never });
    const r = await picker.open({ accept: [ARCHIVE_MIME] }); // 旧实现在这里**永不 settle**
    expect(order.indexOf('listen:change')).toBeGreaterThanOrEqual(0);
    expect(order.indexOf('listen:change')).toBeLessThan(order.indexOf('click'));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.file.name).toBe('sync.json');
    expect(await r.file.text()).toBe('SYNC');
    expect(log.created).toEqual([]); // 这个手写假件不记账，这里只是防呆
  });

  it('FSA 的 getFile() 抛非取消错 + 有 document ⇒ 降级到 <input> 并成功（不是直接失败）', async () => {
    stubDom();
    const log = { clicks: 0, created: [] as string[] };
    const { doc, els } = instrumentedDoc(log);
    const { fn } = fakeOpen({ getFileError: new Error('句柄已被宿主撤销') });
    const picker = buildArchiveFilePicker({ showOpenFilePicker: fn as never, document: doc as never });
    const p = picker.open({ accept: [ARCHIVE_MIME] });
    // FSA 那条路是**异步**失败的 ⇒ `<input>` 要等微任务链跑完才建出来
    await until(() => els.length === 1, 'FSA 降级后建出 <input>');
    fire(els[0], 'change', { target: { files: [fakeFile('fallback.json', 'FB')] } });
    const r = await p;
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(await r.file.text()).toBe('FB');
  });
});

/* ============================================================================
 * c) 两者都不可用 ⇒ unsupported（三态里的第三态）
 * ========================================================================== */

describe('c) 一点能力都没有（某些 WebView）⇒ open()/save() 都返回 unsupported（可辨识）', () => {
  it('**F15** open() ⇒ { ok:false, reason:"unsupported" }（不是 null、不抛）', async () => {
    const picker = buildArchiveFilePicker({ document: undefined, showOpenFilePicker: undefined });
    const r = await picker.open({ accept: [ARCHIVE_MIME] });
    expect(reasonOf(r).reason).toBe('unsupported');
    expect(reasonOf(r).detail.length).toBeGreaterThan(0);
  });

  it('save() 返回 unsupported，且 detail 非空（UI 要能给一句人话）', async () => {
    const sink = buildArchiveFileSink({ document: undefined, makeBlob: undefined, showSaveFilePicker: undefined });
    const r = await sink.save({ suggestedName: 'a.json', text: '{}' });
    expect(reasonOf(r).reason).toBe('unsupported');
    expect(reasonOf(r).detail.length).toBeGreaterThan(0);
  });

  it('**F10** 零参工厂在 node 里**真跑一遍**（旧版只做 typeof 断言 ⇒ 不算行为腿）', async () => {
    // node 下既没有 FSA 也没有 document ⇒ 两条路都不可用
    const picked = await openArchivePicker().open({ accept: [ARCHIVE_MIME] });
    expect(reasonOf(picked).reason).toBe('unsupported');
    const saved = await openArchiveSink().save({ suggestedName: 'a.json', text: '{}' });
    expect(reasonOf(saved).reason).toBe('unsupported');
    // 能力自述：本阶段**不做**静默写回（用户裁决「待用户裁决 #4」选 A）
    expect(archiveFileCapabilities()).toEqual({ silentWriteBack: false });
  });

  it('FSA 存在但抛非取消错 + 无 document ⇒ failed 且带 **FSA 的真因**（不是笼统的"不支持"）', async () => {
    const picker = buildArchiveFilePicker({
      showOpenFilePicker: fakeOpen({ error: new Error('SecurityError：策略禁用 FSA') }).fn as never,
      document: undefined,
    });
    const r = await picker.open({ accept: [ARCHIVE_MIME] });
    expect(reasonOf(r).reason).toBe('failed');
    expect(reasonOf(r).detail).toContain('SecurityError：策略禁用 FSA');
  });

  it('**第 3 轮 · 建议 ②** 两条路**都有真因**（FSA 抛非取消错 + `<input>` 那条路也 failed）⇒ detail **同时**含两个真因', async () => {
    stubDom();
    // 两个**可辨识**的串：实现里任何一处把它们丢掉，下面两条 `toContain` 里必有一条红。
    const fsaNeedle = 'FSA-真因：策略禁用文件系统访问';
    const inputNeedle = 'INPUT-真因：沙箱 iframe 里不许建元素';
    const picker = buildArchiveFilePicker({
      showOpenFilePicker: fakeOpen({ error: new Error(fsaNeedle) }).fn as never,
      document: {
        createElement: () => { throw new Error(inputNeedle); },
        body: null,
      } as never,
    });
    const r = await picker.open({ accept: [ARCHIVE_MIME] });
    const { reason, detail } = reasonOf(r);
    expect(reason).toBe('failed');
    // 只断言这两个**针**，不断言整句文案（文案可以改，真因不许丢）
    expect(detail).toContain(fsaNeedle);   // 旧实现（只认 unsupported）在这一条上红：FSA 真因被丢掉
    expect(detail).toContain(inputNeedle); // 新实现必须把 `<input>` 那句也留下来
  });

  it('**第 3 轮 · 建议 ②** 同场景经 `<input>` 的 **cancel** 事件回来 ⇒ 仍是 `cancelled`，且 detail **不含** FSA 真因', async () => {
    stubDom();
    const log = { clicks: 0, created: [] as string[] };
    const { doc, els } = instrumentedDoc(log);
    const fsaNeedle = 'FSA-真因：策略禁用文件系统访问';
    const picker = buildArchiveFilePicker({
      showOpenFilePicker: fakeOpen({ error: new Error(fsaNeedle) }).fn as never,
      document: doc as never,
    });
    const p = picker.open({ accept: [ARCHIVE_MIME] });
    await until(() => els.length === 1, 'FSA 降级后建出 <input>');
    fire(els[0], 'cancel', {});
    const { reason, detail } = reasonOf(await p);
    // ⚠️ 取消是**用户意图**、不是错误 ⇒ 三态语义不变，也**不许**被拼成"文件系统选择失败：…"
    expect(reason).toBe('cancelled');
    expect(detail).not.toContain(fsaNeedle);
    expect(detail).not.toContain('文件系统选择失败');
  });

  it('**第 3 轮 · 建议 ②** 同场景**全都不支持**（无 document、无 FSA）⇒ 仍是 `unsupported`（放宽条件不许把三态压平）', async () => {
    const picker = buildArchiveFilePicker({ showOpenFilePicker: undefined, document: undefined });
    const { reason, detail } = reasonOf(await picker.open({ accept: [ARCHIVE_MIME] }));
    expect(reason).toBe('unsupported');
    expect(detail.length).toBeGreaterThan(0);
  });
});

/* ============================================================================
 * d) 用户取消 ⇒ cancelled（**绝不能**是 failed）
 * ========================================================================== */

describe('d) 用户在 FSA 里取消 ⇒ cancelled（不是 failed，否则 UI 弹假警报）', () => {
  it('**F15** open()：FSA 抛 AbortError ⇒ cancelled，且**不再降级**去弹 <input>（否则取消后又被弹一次）', async () => {
    stubDom();
    const log = { clicks: 0, created: [] as string[] };
    const { doc } = instrumentedDoc(log);
    const { fn } = fakeOpen({ error: abortError() });
    const picker = buildArchiveFilePicker({ showOpenFilePicker: fn as never, document: doc as never });
    const r = await picker.open({ accept: [ARCHIVE_MIME] });
    expect(reasonOf(r).reason).toBe('cancelled');
    expect(log.created).toEqual([]); // 取消是终态
    expect(log.clicks).toBe(0);
  });

  it('save()：AbortError ⇒ { ok:false, reason:"cancelled" }（**逐字**不是 failed）', async () => {
    stubDom();
    const log = { clicks: 0, created: [] as string[] };
    const { doc } = instrumentedDoc(log);
    const { fn } = fakeSave({ error: abortError() });
    const sink = buildArchiveFileSink({ showSaveFilePicker: fn as never, document: doc as never });
    const r = await sink.save({ suggestedName: 'a.json', text: '{}' });
    expect(reasonOf(r).reason).toBe('cancelled');
    // 取消之后**不许**偷偷降级到 <a download>：那会下载一份用户刚拒绝的文件
    expect(log.created).toEqual([]);
    expect(log.clicks).toBe(0);
  });

  it('save()：`code === 20` 的老式 AbortError 形状也认（不是只看 name）', async () => {
    stubDom();
    const log = { clicks: 0, created: [] as string[] };
    const { doc } = instrumentedDoc(log);
    const { fn } = fakeSave({ error: { code: 20 } });
    const sink = buildArchiveFileSink({ showSaveFilePicker: fn as never, document: doc as never });
    expect(reasonOf(await sink.save({ suggestedName: 'a.json', text: '{}' })).reason).toBe('cancelled');
  });
});

/* ============================================================================
 * e) 有 showSaveFilePicker ⇒ mode:'fsa' + 唯一出处（MIME / 扩展名）
 * ========================================================================== */

describe('e) 有 showSaveFilePicker ⇒ mode:"fsa"，写入逐字节等于入参，且 MIME/扩展名来自唯一出处', () => {
  it('createWritable → write → close 全都被调用，写入内容与入参**完全一致**', async () => {
    stubDom();
    const log = { clicks: 0, created: [] as string[] };
    const { doc } = instrumentedDoc(log);
    const s = fakeSave({ name: 'compile-abcdef01-20260916-123456.compile-match.json' });
    const sink = buildArchiveFileSink({ showSaveFilePicker: s.fn as never, document: doc as never });
    const text = '{"中文键":"值","n":1,"s":"line1\\nline2","emoji":"🎴"}';
    const r = await sink.save({ suggestedName: 'compile-abcdef01-20260916-123456.compile-match.json', text });

    expect(r).toEqual({ ok: true, name: 'compile-abcdef01-20260916-123456.compile-match.json', mode: 'fsa' });
    expect(s.writes.length).toBe(1);
    expect(s.writes[0]).toBe(text); // 逐字节
    expect(new TextEncoder().encode(s.writes[0])).toEqual(new TextEncoder().encode(text));
    expect(s.closes).toBe(1);
    expect((s.calls[0] as { suggestedName: string }).suggestedName).toBe('compile-abcdef01-20260916-123456.compile-match.json');
    // 走了 FSA 就不该再碰 <a download>
    expect(log.created).toEqual([]);
  });

  it('**U5** 写入**逐字节**等于入参：缩进/换行/尾随换行一个都不能被"规范化"（JSON 往返会在这里变红）', async () => {
    stubDom();
    const log = { clicks: 0, created: [] as string[] };
    const { doc } = instrumentedDoc(log);
    const s = fakeSave({ name: 'a.json' });
    const sink = buildArchiveFileSink({ showSaveFilePicker: s.fn as never, document: doc as never });
    // 刻意选一份"JSON.parse → JSON.stringify 之后会面目全非"的文本：
    //   * 缩进与换行会被折叠；`1.0` 会变成 `1`；键序不变但空白全没了。
    // 上一版的 e) 腿喂的是紧凑 JSON，往返重序列化**恰好**得到同一个串 ⇒ 那条变异全绿（评审者 U5）。
    const text = '{\n  "a": 1,\n  "n": 1.0,\n  "s": "line1\\nline2",\n  "u": "🎴中"\n}\n';
    expect(JSON.stringify(JSON.parse(text))).not.toBe(text); // 前提：这份入参**确实**会被规范化
    await sink.save({ suggestedName: 'a.json', text });
    expect(s.writes).toEqual([text]);
    expect(new TextEncoder().encode(s.writes[0])).toEqual(new TextEncoder().encode(text));
  });

  it('**F3** FSA 的 types 描述逐字等于 `ARCHIVE_MIME` / `ARCHIVE_EXT`（生成式，不手写字符串）', async () => {
    stubDom();
    const s = fakeSave({});
    const sink = buildArchiveFileSink({ showSaveFilePicker: s.fn as never, document: undefined, makeBlob: undefined });
    await sink.save({ suggestedName: 'a.json', text: '{}' });
    expect((s.calls[0] as { types: unknown }).types).toEqual([
      { description: 'Compile 对局档案', accept: { [ARCHIVE_MIME]: [ARCHIVE_EXT] } },
    ]);
    // 反证方向：这份断言在"浏览器实现里硬编码另一个字面量"时必须变红
    expect((s.calls[0] as { types: Array<{ accept: Record<string, string[]> }> }).types[0].accept)
      .toHaveProperty(ARCHIVE_MIME);
  });

  it('**F3** <a download> 那条路的 Blob MIME 逐字等于 `ARCHIVE_MIME`', async () => {
    stubDom();
    const log = { clicks: 0, created: [] as string[] };
    const { doc } = instrumentedDoc(log);
    const seen: Array<{ parts: string[]; type: string }> = [];
    const sink = buildArchiveFileSink({
      document: doc as never,
      makeBlob: ((parts: string[], opts: { type: string }) => {
        seen.push({ parts, type: opts.type });
        return {};
      }) as never,
      createObjectURL: (() => 'blob:stub/f3') as never,
      revokeObjectURL: (() => {}) as never,
    });
    await sink.save({ suggestedName: 'a.json', text: 'PAYLOAD' });
    expect(seen.length).toBe(1);
    expect(seen[0].type).toBe(ARCHIVE_MIME);
    expect(seen[0].parts).toEqual(['PAYLOAD']);
  });

  it('**F3** 宿主没给 name 时的退化文件名以 `ARCHIVE_EXT` 结尾（生成式：扩展名只有一个出处）', async () => {
    stubDom();
    const log = { clicks: 0, created: [] as string[] };
    const { doc, els } = instrumentedDoc(log);
    const picker = buildArchiveFilePicker({ document: doc as never });
    const p = picker.open({ accept: [ARCHIVE_MIME] });
    // 宿主的 File 对象没有 name（某些 WebView 的怪形状）
    fire(els[0], 'change', { target: { files: [{ size: 2, text: async () => '{}' }] } });
    const r = await p;
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.file.name.endsWith(ARCHIVE_EXT)).toBe(true);
    expect(r.file.name).toBe(`archive${ARCHIVE_EXT}`);
  });
});

/* ============================================================================
 * f) 无 FSA ⇒ <a download>，且 revokeObjectURL 必须被调用（防 URL 泄漏）
 * ========================================================================== */

describe('f) 无 FSA ⇒ <a download>，且 blob URL 成对创建/撤销', () => {
  it('click() 被触发、href/download 正确、**revokeObjectURL 被调用**（URL 不泄漏）', async () => {
    const body = stubDom();
    const log = { clicks: 0, created: [] as string[] };
    const { doc, els } = instrumentedDoc(log);
    const urls: string[] = [];
    const revoked: string[] = [];
    const sink = buildArchiveFileSink({
      showSaveFilePicker: undefined,
      document: doc as never,
      makeBlob: ((parts: string[]) => ({ parts })) as never,
      createObjectURL: ((b: unknown) => {
        urls.push((b as { parts: string[] }).parts[0]);
        return 'blob:stub/1';
      }) as never,
      revokeObjectURL: ((u: string) => { revoked.push(u); }) as never,
    });

    const r = await sink.save({ suggestedName: 'a.json', text: '{"x":1}' });

    expect(r).toEqual({ ok: true, name: 'a.json', mode: 'download' });
    expect(log.created).toEqual(['a']);
    expect(log.clicks).toBe(1);
    expect(els[0].download).toBe('a.json');
    expect(els[0].href).toBe('blob:stub/1');
    expect(els[0].rel).toBe('noopener');
    // Blob 里包的就是入参文本（HTTP 层拿到的就是它）
    expect(urls).toEqual(['{"x":1}']);
    // ⚠️ 防 URL 泄漏：创建了几个就必须撤销几个
    expect(revoked).toEqual(['blob:stub/1']);
    expect(revoked.length).toBe(urls.length);
    expect(queryAllIn(body, 'a').length).toBe(0);
  });

  it('没有 createObjectURL 时走 triggerDownload 兜底；兜底也没有 ⇒ unsupported + 非空 detail', async () => {
    stubDom();
    const log = { clicks: 0, created: [] as string[] };
    const { doc } = instrumentedDoc(log);
    const tried: string[] = [];
    const sink1 = buildArchiveFileSink({
      showSaveFilePicker: undefined,
      document: doc as never,
      makeBlob: (() => ({})) as never,
      // ⚠️ 必须**显式**清掉 node 内置的 `URL.createObjectURL`（真环境工厂会把它接上），
      //    否则"没有 createObjectURL"这条分支在 node 下根本走不到 —— 那是假腿。
      createObjectURL: undefined,
      revokeObjectURL: undefined,
      triggerDownload: ((name: string) => { tried.push(name); return true; }) as never,
    });
    expect(await sink1.save({ suggestedName: 'a.json', text: '{}' })).toEqual({ ok: true, name: 'a.json', mode: 'download' });
    expect(tried).toEqual(['a.json']);

    const sink2 = buildArchiveFileSink({
      showSaveFilePicker: undefined,
      document: undefined,
      makeBlob: undefined,
      triggerDownload: undefined,
    });
    const r = await sink2.save({ suggestedName: 'a.json', text: '{}' });
    expect(reasonOf(r).reason).toBe('unsupported');
    expect(reasonOf(r).detail.length).toBeGreaterThan(0);
  });
});

/* ============================================================================
 * g) 保存真失败 ⇒ failed + 非空 detail，且**永不 reject**（F2）
 * ========================================================================== */

describe('g) 真失败 ⇒ { ok:false, reason:"failed", detail:<非空> }，且**永不 reject**', () => {
  it('FSA 写入抛错且没有降级路径 ⇒ failed（**不是** ok:true）', async () => {
    const sink = buildArchiveFileSink({
      showSaveFilePicker: fakeSave({ writeError: new Error('设备上没有空间') }).fn as never,
      document: undefined,
      makeBlob: undefined,
    });
    const r = await sink.save({ suggestedName: 'a.json', text: '{}' });
    expect(reasonOf(r).reason).toBe('failed');
    expect(reasonOf(r).detail).toContain('设备上没有空间');
  });

  it('FSA 抛非取消错且 <a download> 可用 ⇒ 降级到 download（用户仍拿到文件）', async () => {
    const log = { clicks: 0, created: [] as string[] };
    const { doc } = instrumentedDoc(log);
    const sink = buildArchiveFileSink({
      showSaveFilePicker: fakeSave({ error: new Error('SecurityError：策略禁用 FSA') }).fn as never,
      document: doc as never,
      makeBlob: (() => ({})) as never,
      createObjectURL: (() => 'blob:stub/2') as never,
      revokeObjectURL: (() => {}) as never,
    });
    const r = await sink.save({ suggestedName: 'a.json', text: '{"y":2}' });
    expect(r).toEqual({ ok: true, name: 'a.json', mode: 'download' });
    expect(log.clicks).toBe(1);
  });

  it('失败与取消**必须可区分**（同一实现下两个分支给出不同 reason）', async () => {
    const cancelled = await buildArchiveFileSink({
      showSaveFilePicker: fakeSave({ error: abortError() }).fn as never,
      document: undefined,
      makeBlob: undefined,
    }).save({ suggestedName: 'a.json', text: '{}' });
    const failed = await buildArchiveFileSink({
      showSaveFilePicker: fakeSave({ writeError: new Error('boom') }).fn as never,
      document: undefined,
      makeBlob: undefined,
    }).save({ suggestedName: 'a.json', text: '{}' });
    const c = reasonOf(cancelled);
    const f = reasonOf(failed);
    expect(c.reason).toBe('cancelled');
    expect(f.reason).toBe('failed');
    expect(c.reason).not.toBe(f.reason);
  });

  /** **F2** 三条宿主抛错路径共用的夹具：返回 `{ sink, revoked }` */
  function sinkWithHostThrow(where: 'createElement' | 'makeBlob' | 'click'): {
    sink: ReturnType<typeof buildArchiveFileSink>;
    revoked: string[];
    detailNeedle: string;
  } {
    const revoked: string[] = [];
    const needle = `宿主在 ${where} 处抛错`;
    if (where === 'makeBlob') {
      return {
        sink: buildArchiveFileSink({
          showSaveFilePicker: undefined,
          document: { createElement: () => makeStubEl('a'), body: null } as never,
          makeBlob: (() => { throw new Error(needle); }) as never,
          createObjectURL: (() => 'blob:stub/throw') as never,
          revokeObjectURL: ((u: string) => { revoked.push(u); }) as never,
        }),
        revoked,
        detailNeedle: needle,
      };
    }
    const log = { clicks: 0, created: [] as string[] };
    const { doc } = instrumentedDoc(
      log,
      where === 'click' ? () => { throw new Error(needle); } : undefined,
    );
    if (where === 'createElement') {
      return {
        sink: buildArchiveFileSink({
          showSaveFilePicker: undefined,
          document: { createElement: () => { throw new Error(needle); }, body: null } as never,
          makeBlob: (() => ({})) as never,
          createObjectURL: (() => 'blob:stub/throw') as never,
          revokeObjectURL: ((u: string) => { revoked.push(u); }) as never,
        }),
        revoked,
        detailNeedle: needle,
      };
    }
    return {
      sink: buildArchiveFileSink({
        showSaveFilePicker: undefined,
        document: doc as never,
        makeBlob: (() => ({})) as never,
        createObjectURL: (() => 'blob:stub/throw') as never,
        revokeObjectURL: ((u: string) => { revoked.push(u); }) as never,
      }),
      revoked,
      detailNeedle: needle,
    };
  }

  it('**F2** 宿主 createElement 抛错 ⇒ 返回 { reason:"failed", detail 含真因 }（**不是 reject**）', async () => {
    const { sink, detailNeedle } = sinkWithHostThrow('createElement');
    const r = await sink.save({ suggestedName: 'a.json', text: '{}' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('failed');
    expect(r.detail).toContain(detailNeedle);
  });

  it('**F2** 宿主 makeBlob 抛错 ⇒ 返回 failed（**不是 reject**）', async () => {
    const { sink, detailNeedle } = sinkWithHostThrow('makeBlob');
    const r = await sink.save({ suggestedName: 'a.json', text: '{}' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('failed');
    expect(r.detail).toContain(detailNeedle);
  });

  it('**F2** 宿主 a.click() 抛错 ⇒ 返回 failed，且 blob URL **仍被撤销**（失败的导出不泄漏内存）', async () => {
    const { sink, revoked, detailNeedle } = sinkWithHostThrow('click');
    const r = await sink.save({ suggestedName: 'a.json', text: '{}' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('failed');
    expect(r.detail).toContain(detailNeedle);
    expect(revoked).toEqual(['blob:stub/throw']);
  });

  it('**F2** "永不 reject"本身：三条宿主抛错路径一起跑 ⇒ `allSettled` 全部 fulfilled 且都是 failed', async () => {
    const results = await Promise.allSettled(
      (['createElement', 'makeBlob', 'click'] as const).map((w) =>
        sinkWithHostThrow(w).sink.save({ suggestedName: 'a.json', text: '{}' }),
      ),
    );
    for (const s of results) {
      expect(s.status).toBe('fulfilled');
      if (s.status !== 'fulfilled') continue;
      expect(s.value.ok).toBe(false);
      if (s.value.ok) continue;
      expect(s.value.reason).toBe('failed');
      expect(s.value.detail.length).toBeGreaterThan(0);
    }
  });
});

/* ============================================================================
 * g2) **第 3 轮 · 建议 ①**：`saveViaDownload` 任何抛出路径都不许在 `body` 里留节点
 * ========================================================================== */

/**
 * **会记账的假 `document`**（第 3 轮 · 建议 ① 专用）。
 *
 * 为什么不能复用 `instrumentedDoc`：那个夹具**不暴露 `body` 子节点数**，而本段的判据
 * 恰恰是"抛出前后 body 里少没少一个节点"。这里的 `body.removeChild` 按**同一性**删除
 * （`indexOf` + `splice`，与 `instrumentedDoc` 同款），`appendChild` 真挂上、真计数。
 *
 * `throwAt` 是**抛出点**，`'none'` = 不抛：这是"生成式"的落点 —— 一张表把 5 个宿主抛出点
 * 各跑一次，而不是只挑一条路径手写。
 */
function countingDoc(throwAt: 'createElement' | 'appendChild' | 'click' | 'createObjectURL' | 'makeBlob' | 'none'): {
  doc: { createElement(t: string): unknown; body: { appendChild(n: unknown): unknown; removeChild(n: unknown): unknown } };
  childrenCount: () => number;
  clicks: () => number;
} {
  const children: unknown[] = [];
  let clicks = 0;
  return {
    doc: {
      createElement: (t: string) => {
        if (throwAt === 'createElement') throw new Error('FAKE-抛出点:createElement');
        const el = makeStubEl(t);
        el.click = (() => {
          clicks += 1;
          if (throwAt === 'click') throw new Error('FAKE-抛出点:click');
        }) as unknown as StubNode['click'];
        // ⚠️ **故意不提供 `remove()`**：于是收尾只能靠 `body.removeChild(a)`。
        //    这样"节点收尾挪回 try 内"的变异腿一定会红 —— 如果桩的 `remove` 也摘节点，
        //    两条收尾路径会互相掩盖，缺陷就测不出来了。
        return el;
      },
      body: {
        appendChild: (n: unknown) => {
          if (throwAt === 'appendChild') throw new Error('FAKE-抛出点:appendChild');
          children.push(n);
          return n;
        },
        removeChild: (n: unknown) => {
          const i = children.indexOf(n);
          if (i >= 0) children.splice(i, 1);
          return n;
        },
      },
    },
    childrenCount: () => children.length,
    clicks: () => clicks,
  };
}

describe('g2) **第 3 轮 · 建议 ①** 导出降级：`click()` 等任何抛出之后，`body` 里**不留** `<a>` 节点', () => {
  it('生成式：5 个宿主抛出点各跑一次，每次都断言 body 子节点数回到抛出前的值', async () => {
    // 覆盖矩阵：任务书点名的 **5 个宿主抛出点各一行**，外加一行"都不抛"做反证方向。
    // ⚠️ 诚实标注两列的含义，别把它读成"5 行都测到了残留"：
    //    * `clicks`  = 该行预期 `click()` **被调用**的次数（`click` 之前抛出的点连它都到不了 ⇒ 0）；
    //    * `createsUrl` = 该行是否**已经拿到 blob URL**（没拿到的行本来就无 URL 可撤销）。
    //    真正会让 `<a>` **真的进过** body 的只有 `appendChild` / `click` / `none` 三行；
    //    `makeBlob` / `createElement` / `createObjectURL` 是**前置**抛出（节点还没建出来），
    //    它们的 body 计数天然为 0 —— 留在表里是为了让"**任何**抛出路径都不留残留"这句话是
    //    **生成式跑出来的**，而不是只测了那条已知会漏的。
    const matrix = [
      { at: 'makeBlob', needle: 'FAKE-抛出点:makeBlob', clicks: 0, createsUrl: false },
      { at: 'createElement', needle: 'FAKE-抛出点:createElement', clicks: 0, createsUrl: false },
      { at: 'createObjectURL', needle: 'FAKE-抛出点:createObjectURL', clicks: 0, createsUrl: false },
      { at: 'appendChild', needle: 'FAKE-抛出点:appendChild', clicks: 0, createsUrl: true },
      { at: 'click', needle: 'FAKE-抛出点:click', clicks: 1, createsUrl: true }, // ← 原实现的漏洞就在这一行
      { at: 'none', needle: '', clicks: 1, createsUrl: true },                   // 反证：成功路径也必须收干净
    ] as const;
    const bodies = matrix.map((row) => {
      const { doc, childrenCount, clicks } = countingDoc(row.at);
      const revoked: string[] = [];
      const sink = buildArchiveFileSink({
        showSaveFilePicker: undefined,
        document: doc as never,
        makeBlob: (() => {
          if (row.at === 'makeBlob') throw new Error(row.needle);
          return {};
        }) as never,
        createObjectURL: (() => {
          if (row.at === 'createObjectURL') throw new Error(row.needle);
          return 'blob:stub/cleanup';
        }) as never,
        revokeObjectURL: ((u: string) => { revoked.push(u); }) as never,
        // ⚠️ 必须**显式**清掉 node 内置的 `URL.createObjectURL`（同 f 段那条腿的理由：
        //    真环境工厂会把它接上，否则"注入的 createObjectURL 抛错"这条分支根本走不到）。
        triggerDownload: undefined,
      });
      // `save()` 永不 reject（F2）⇒ 抛出被折成 failed；这里断言的是**副作用**而不是返回值形状。
      const r = sink.save({ suggestedName: 'a.json', text: '{}' });
      return { row, r, childrenCount, clicks, revoked };
    });
    for (const b of bodies) {
      const r = await b.r;
      // 判据：**抛出前后** body 子节点数一样（表里每一行的"抛出前"都是 0：
      // 每次都用全新的 `countingDoc`，body 里本来什么都没有）。
      expect([b.row.at, b.childrenCount()]).toEqual([b.row.at, 0]);
      // 每个宿主调用点都真的被走到了（否则"抛出点没生效"会让这条腿变成假绿）。
      expect([b.row.at, b.clicks()]).toEqual([b.row.at, b.row.clicks]);
      if (b.row.at === 'none') {
        expect(r).toEqual({ ok: true, name: 'a.json', mode: 'download' });
      } else {
        expect(r.ok).toBe(false);
        if (r.ok) continue;
        expect(r.reason).toBe('failed');
        // 真因必须原样带出来（不是被折成一句笼统的"保存失败"）
        expect(r.detail).toContain(b.row.needle);
      }
      // 成对撤销：**已经拿到 URL 的行**一律要撤销（与 f 段的防泄漏判据同源）。
      expect([b.row.at, b.revoked]).toEqual([b.row.at, b.row.createsUrl ? ['blob:stub/cleanup'] : []]);
    }
  });
});

/* ============================================================================
 * h) F7：`<input>` 的取消判定窗口走**参数表里的**定时器
 * ========================================================================== */

describe('h) **F7** 超时窗口：定时器走参数表（可注入），两条窗口腿', () => {
  it('窗口内没有 change ⇒ 到点后 { reason:"cancelled" }；且**用的是注入的定时器**（不是 globalThis.setTimeout）', async () => {
    stubDom();
    const log = { clicks: 0, created: [] as string[] };
    const { doc, els } = instrumentedDoc(log);
    const clock = fakeClock();
    const picker = buildArchiveFilePicker({
      document: doc as never,
      pickTimeoutMs: 20,
      now: clock.now,
      setTimeout: clock.setTimeout,
      clearTimeout: clock.clearTimeout,
    });
    const p = picker.open({ accept: [ARCHIVE_MIME] });
    // ⚠️ 这两条是 F7 的**核心判据**：若实现绕过参数表直接用 globalThis.setTimeout，
    //    `scheduleCalls()` 恒 0（且下面的 await 会挂住）。
    expect(clock.scheduleCalls()).toBe(1);
    expect(clock.pendingCount()).toBe(1);
    clock.advanceTo(25); // 越过 20ms 窗口
    clock.fireDue();
    const r = await p;
    expect(reasonOf(r).reason).toBe('cancelled');
    expect(r.ok === false && r.detail).toContain('20');
    // 收尾：监听与节点都被摘掉
    const listeners = (els[0] as unknown as { __listeners: Record<string, unknown[]> }).__listeners;
    expect(listeners.change.length).toBe(0);
    expect(listeners.cancel.length).toBe(0);
  });

  it('窗口内来了 change ⇒ 立刻返回文件，且定时器被撤销（不再等、不泄漏）', async () => {
    stubDom();
    const log = { clicks: 0, created: [] as string[] };
    const { doc, els } = instrumentedDoc(log);
    const clock = fakeClock();
    const picker = buildArchiveFilePicker({
      document: doc as never,
      pickTimeoutMs: 60_000,
      now: clock.now,
      setTimeout: clock.setTimeout,
      clearTimeout: clock.clearTimeout,
    });
    const p = picker.open({ accept: [ARCHIVE_MIME] });
    expect(clock.scheduleCalls()).toBe(1);
    fire(els[0], 'change', { target: { files: [fakeFile('in-window.json', 'W')] } });
    const r = await p;
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.file.name).toBe('in-window.json');
    expect(clock.pendingCount()).toBe(0);   // 定时器被撤销
    expect(clock.clearCalls()).toBe(1);
    // 就算把假时钟推到很久之后，也不会有第二个结果（Promise 已经 settle）
    clock.advanceTo(10 ** 9);
    clock.fireDue();
    expect(clock.pendingCount()).toBe(0);
  });

  it('没有配窗口（pickTimeoutMs 缺省 / 0）⇒ **不挂定时器**（永远等，由宿主 DOM 生命周期决定）', async () => {
    stubDom();
    const log = { clicks: 0, created: [] as string[] };
    const { doc, els } = instrumentedDoc(log);
    const clock = fakeClock();
    const picker = buildArchiveFilePicker({
      document: doc as never,
      now: clock.now,
      setTimeout: clock.setTimeout,
      clearTimeout: clock.clearTimeout,
    });
    const p = picker.open({ accept: [ARCHIVE_MIME] });
    expect(clock.scheduleCalls()).toBe(0);
    fire(els[0], 'change', { target: { files: [fakeFile('no-window.json', 'N')] } });
    const r = await p;
    expect(r.ok).toBe(true);
  });
});

/* ============================================================================
 * i) 工厂转发、并发、以及"读不出来"的边界
 * ========================================================================== */

describe('i) 工厂 overrides 转发 / 并发不串状态 / 读不出来时的边界', () => {
  it('**F9** `openArchivePicker(overrides)` 真的把假宿主转发进内部实现（不是个空壳包装）', async () => {
    const { fn, calls } = fakeOpen({ file: fakeFile('via-override.json', 'OV') });
    const r = await openArchivePicker({ showOpenFilePicker: fn as never }).open({ accept: [ARCHIVE_MIME] });
    expect(calls.length).toBe(1);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.file.name).toBe('via-override.json');
    expect(await r.file.text()).toBe('OV');
  });

  it('**F9** `openArchiveSink(overrides)` 真的把假宿主转发进内部实现', async () => {
    const s = fakeSave({ name: 'out.json' });
    const r = await openArchiveSink({ showSaveFilePicker: s.fn as never, document: undefined }).save({
      suggestedName: 'a.json',
      text: 'PAYLOAD',
    });
    expect(s.writes).toEqual(['PAYLOAD']);
    expect(r).toEqual({ ok: true, name: 'out.json', mode: 'fsa' });
  });

  it('`buildArchiveFilePicker` 与零参工厂在**同一组 overrides** 下结果一致（防两份实现漂移）', async () => {
    stubDom();
    const file = fakeFile('same.json', 'SAME');
    const a = await openArchivePicker({ showOpenFilePicker: fakeOpen({ file }).fn as never }).open({ accept: [ARCHIVE_MIME] });
    const b = await buildArchiveFilePicker({ showOpenFilePicker: fakeOpen({ file }).fn as never }).open({ accept: [ARCHIVE_MIME] });
    // ⚠️ 不用 `toEqual(a, b)`：`PickedFile.text` 是两个不同的闭包，`toEqual` 会按引用比函数
    //    而误判"形状相同"的两个结果为不等（实测 `Compared values have no visual difference`）。
    //    比**可观测形状**才是这条腿想说的话。
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.file.name).toBe(b.file.name);
    expect(a.file.size).toBe(b.file.size);
    expect(await a.file.text()).toBe(await b.file.text());
  });

  it('**F15** 宿主给的文件对象没有可调用的 text() ⇒ reason:"failed"（不是"成功但读不出来"）', async () => {
    stubDom();
    const log = { clicks: 0, created: [] as string[] };
    const { doc, els } = instrumentedDoc(log);
    const picker = buildArchiveFilePicker({ document: doc as never });
    const p = picker.open({ accept: [ARCHIVE_MIME] });
    fire(els[0], 'change', { target: { files: [{ name: 'no-text.json', size: 2 }] } });
    const r = await p;
    expect(reasonOf(r).reason).toBe('failed');
    expect(r.ok === false && r.detail).toContain('text()');
  });

  it('诚实边界：`open()` **不读文件内容** ⇒ text() 的失败以 **rejection** 交给调用方（UI 映射成 read-failed），不是空串假成功', async () => {
    stubDom();
    const log = { clicks: 0, created: [] as string[] };
    const { doc, els } = instrumentedDoc(log);
    const picker = buildArchiveFilePicker({ document: doc as never });
    const p = picker.open({ accept: [ARCHIVE_MIME] });
    const bad = {
      name: 'bad.json',
      size: 3,
      text: async () => { throw new Error('磁盘读取失败（坏块）'); },
    };
    fire(els[0], 'change', { target: { files: [bad] } });
    const r = await p;
    expect(r.ok).toBe(true); // 选中是成功的：8 MiB 档案不该在 open() 里被提前读进内存
    if (!r.ok) return;
    await expect(r.file.text()).rejects.toThrow('磁盘读取失败（坏块）');
  });

  it('并发两次 open() 互不串状态：各自的 change 只 settle 自己那个 Promise（故意**反序** settle）', async () => {
    stubDom();
    const log = { clicks: 0, created: [] as string[] };
    const { doc, els } = instrumentedDoc(log);
    const picker = buildArchiveFilePicker({ document: doc as never });
    const p1 = picker.open({ accept: [ARCHIVE_MIME] });
    const p2 = picker.open({ accept: [ARCHIVE_MIME] });
    expect(els.length).toBe(2);
    expect(log.clicks).toBe(2);
    expect(els[0]).not.toBe(els[1]);
    // 第二次打开的 input **先**派发 change（反序 ⇒ 串状态会当场暴露）
    fire(els[1], 'change', { target: { files: [fakeFile('2.json', 'TWO')] } });
    const r2 = await p2;
    fire(els[0], 'change', { target: { files: [fakeFile('1.json', 'ONE')] } });
    const r1 = await p1;
    expect(r2.ok).toBe(true);
    expect(r1.ok).toBe(true);
    if (!r1.ok || !r2.ok) return;
    expect(r1.file.name).toBe('1.json');
    expect(r2.file.name).toBe('2.json');
    expect(await r1.file.text()).toBe('ONE');
    expect(await r2.file.text()).toBe('TWO');
  });
});
