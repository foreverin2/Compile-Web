import { describe, it, expect, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  installStubDom,
  makeStubEl,
  descendants,
  queryAllIn,
  type StubNode,
} from './net-dom-stub';
import {
  FEEDBACK_ACCEPT,
  FEEDBACK_ENDPOINTS,
  FEEDBACK_MAX_FILE_BYTES,
  FEEDBACK_MAX_FILES,
  FEEDBACK_SUCCESS_CLOSE_MS,
  buildDeleteBody,
  buildReadBody,
  buildSubmitForm,
  checkFileSelection,
  feedbackCountText,
  feedbackMissingText,
  formatBytes,
  formatCreatedAt,
  missingFields,
  readActionOk,
  readItem,
  readList,
  serverErrorText,
  type FeedbackFetcher,
  type FeedbackRequestInfo,
} from '../../src/ui/feedback-core';
import {
  FeedbackHiddenView,
  closeFeedbackOverlay,
  closeHiddenView,
  feedbackFormElement,
  feedbackPasswordPanel,
  initFeedbackShortcut,
  isFeedbackShortcut,
  isHomeScreenActive,
  isTypingTarget,
  openFeedbackOverlay,
} from '../../src/ui/feedback-screen';

/**
 * ★ 2026-10-01（用户要求）：「反馈」功能前端（表单 + `Ctrl+Shift+O` 的隐藏页）。
 *
 * ## 用户原话要点（2026-10-01）
 *
 * 「首页左上角加一个「反馈」按钮」「点开后有**两种操作**：① 投稿自定义协议 ② bug 反馈」
 * 「简要标题 / 投稿人（反馈人）/ 说明文本」「可选附件（pdf/jpg/png…、txt/markdown…，
 * 每份 ≤10MB，每个 IP 每天最多提交 5 份）」「首页按 `Ctrl+Shift+O` 打开一个口令输入框
 * （正常情况下界面上不要出现任何提示/入口），输入正确口令后进入隐藏页」「隐藏页样式参考
 * 「查看规则文档」那一页」「隐藏页想加删除/标记已读」「显示「提交成功」，然后回到首页面」。
 *
 * ⚠️ **2026-10-01 当天两次改口径**（都落在这个文件的腿上）：
 *  1. 每天的限额从"5 个文件"改成"**每天最多提交 5 份**"（按**提交次数**）——
 *     前端从来只**原样显示服务端那句中文原因**（429 那条腿），所以这里改的是夹具措辞；
 *     **单次提交最多 5 个附件**（`FEEDBACK_MAX_FILES`）用户明确要求保留，另有一条腿钉着；
 *  2. 提交成功后：状态行先出现「提交成功」，`FEEDBACK_SUCCESS_CLOSE_MS` 之后**自动关闭浮层**
 *     （＝回到首页）——见"提交成功后…"那一组四条腿。
 *
 * ## 本文件证明什么 / 不能证明什么（**不要读成"浏览器里已验证"**）
 *
 * **能**（全部是"真跑一次、读返回值/调用记录"的行为腿，DOM 用手写桩 `tests/ui/net-dom-stub.ts`，
 * 网络用假抓取层 —— 路径与请求体都按**契约**逐字断言）：
 *  - 纯逻辑核：必填校验、10MB/5 份预检、字节与时间读数、三段响应读数；
 *  - 表单：两种操作切换、必填校验（含标红的行）、超 10MB 当场拒绝、超过 5 份的提示、
 *    成功路径（multipart 的字段与附件）、服务端中文原因**原样**显示、连不上服务时的人话；
 *  - 隐藏页：口令框 → 列表 → 详情 → 返回；顶部读数；未读标记；标记已读**就地更新**；
 *    标回未读；删除二次确认（未确认**零请求**）；删除成功后卡消失且计数更新；删除失败原样显示；
 *    `read` / `delete` 两条 401 都退回口令框；打开详情**不自动**标已读；
 *  - `Ctrl+Shift+O`：只在首页 + 不在输入框里 + 不 preventDefault（本文件自己捕获 window 的
 *    keydown 监听器 —— 桩的 `window.addEventListener` 是 noop，见文件末尾那一段说明）。
 *
 * **不能**：真实浏览器里的观感与层叠、真实 `<input type=file>` 的取消语义、真实 Cookie
 * （`credentials: 'same-origin'` 那一行只断言"传了它"）、以及"服务端到底怎么回"。
 */

/* ==================== 夹具：桩 DOM + 假 window + 假抓取层 ==================== */

interface WinWithListeners {
  keydown: Array<(e: unknown) => void>;
  addEventListener?: (t: string, fn: (e: unknown) => void) => void;
  removeEventListener?: (t: string, fn: (e: unknown) => void) => void;
}

const restores: Array<() => void> = [];
/** 本用例造出来的隐藏页视图（`afterEach` 里逐个关掉；理由见那里的注释） */
const views: FeedbackHiddenView[] = [];

/** 一次请求的记录（方法 / 地址 / 请求体 / 凭据 / 元信息） */
interface Recorded {
  method: string;
  url: string;
  body: unknown;
  credentials: string;
  info: FeedbackRequestInfo | null;
}

/** 假服务端：按 URL 子串挂响应，并按顺序记账 */
class FakeServer implements FeedbackFetcher {
  readonly reqs: Recorded[] = [];
  private routes = new Map<string, { status: number; body: unknown }>();

  /** 给某个地址（子串匹配）挂一个响应 */
  on(urlPart: string, status: number, body: unknown): this {
    this.routes.set(urlPart, { status, body });
    return this;
  }

  /** 默认：列表空、条目为空、两条动作成功 */
  static empty(): FakeServer {
    return new FakeServer()
      .on(FEEDBACK_ENDPOINTS.list, 200, { ok: true, items: [], unread: 0, total: 0 })
      .on(FEEDBACK_ENDPOINTS.read, 200, { ok: true })
      .on(FEEDBACK_ENDPOINTS.delete, 200, { ok: true });
  }

  async fetch(
    method: 'GET' | 'POST',
    url: string,
    body: BodyInit | null,
    credentials: 'same-origin',
    info: FeedbackRequestInfo | null,
  ): Promise<Response> {
    this.reqs.push({ method, url, body, credentials, info });
    const hit = [...this.routes.entries()].find(([part]) => url.includes(part));
    const status = hit === undefined ? 404 : hit[1].status;
    const payload = hit === undefined ? { ok: false, error: `假服务端没有配这条路由：${url}` } : hit[1].body;
    return {
      status,
      ok: status >= 200 && status < 300,
      json: async () => payload,
    } as unknown as Response;
  }

  /** 打到某条路径上的请求 */
  to(urlPart: string): Recorded[] {
    return this.reqs.filter((r) => r.url.includes(urlPart));
  }
}

/**
 * 挂桩 DOM + 可派发的 window，并给 `#app` 配上首页那个类。
 *
 * ⚠️ 另外把 `document.createElement` 包一层：**表单控件的 `value` 默认给空串**。
 * 真浏览器里 `<input>`/`<textarea>`/`<select>` 的 `value` 一开始就是 `''`（不是 `undefined`），
 * 而桩造出来的节点没有这个属性 —— 不补的话，产出代码里那句 `title.trim()` 会在桩上抛
 * `TypeError`（**桩的缺口**，不是产出代码的缺陷）。补的只有这一个默认值，不改别的语义。
 */
function setup(opts: { home?: boolean } = {}): WinWithListeners {
  restores.push(installStubDom());
  const win: WinWithListeners = { keydown: [] };
  win.addEventListener = (t, fn) => { if (t === 'keydown') win.keydown.push(fn); };
  win.removeEventListener = (t, fn) => {
    if (t !== 'keydown') return;
    const i = win.keydown.indexOf(fn);
    if (i >= 0) win.keydown.splice(i, 1);
  };
  const g = globalThis as unknown as { window: unknown };
  g.window = win;
  const doc = (globalThis as unknown as { document: { body: StubNode } }).document;
  const create = (doc as unknown as { createElement: (tag: string) => StubNode }).createElement;
  (doc as unknown as { createElement: (tag: string) => StubNode }).createElement = (tag: string) => {
    const node = create(tag);
    if (tag === 'input' || tag === 'textarea' || tag === 'select') {
      (node as unknown as { value: string }).value = '';
    }
    return node;
  };
  const app = makeStubEl('div');
  if (opts.home !== false) app.classList.add('screen-home');
  (doc as unknown as { getElementById?: (id: string) => unknown }).getElementById = (id: string) =>
    (id === 'app' ? app : null);
  return win;
}

afterEach(() => {
  /**
   * 收尾（2026-10-01）：
   *
   *  1. 让隐藏页控制器**自己**关一次 —— 产出代码里那个模块级单例（`liveShortcutView`）会跨用例
   *     留着上一次那一个视图，不关的话下一条用例的 `makeView` 会拿到**旧的**那一棵树
   *     （实测：几条列表腿在整套跑时全红、单跑时全绿，就是这个原因）；
   *  2. 把 `document.body` 上所有浮层摘干净（`installStubDom` 的 `restore()` 只还原全局指针，
   *     不会清节点；而 `document.body` 是**上一个**桩的那个对象，下一条用例换了新的）。
   */
  while (views.length > 0) {
    const v = views.pop();
    if (v !== undefined && v.isMounted) v.close();
  }
  closeHiddenView();
  // 宿主那一层的单例（`liveFormOverlay` / `liveFormClose`）也跨用例留着 ⇒ 一并收掉
  closeFeedbackOverlay();
  const g = globalThis as unknown as { document?: { body?: StubNode } };
  const body = g.document?.body;
  if (body !== undefined) {
    for (const n of [...descendants(body)]) {
      if (n.cls.includes('feedback-overlay')) (n.remove as () => void)();
    }
  }
  while (restores.length > 0) restores.pop()?.();
});

/* ==================== 桩上的小助手 ==================== */

/** 产出代码吐出来的 `HTMLElement` 当桩节点读（本仓既有写法：`asStub`） */
const asStub = (n: unknown): StubNode => n as StubNode;

/** 全树文本（按 DOM 顺序拼元素节点的文本） */
const textOf = (n: StubNode): string => descendants(n).map((x) => x.text).join('\n');

/** 按 `data-role` 找全部（生成式定位：屏上每个可操作点都有唯一 role） */
const byRole = (root: StubNode, role: string): StubNode[] => queryAllIn(root, `[data-role="${role}"]`);

/** 按 `data-role` 找唯一一个（找不到 / 多于一个都响亮报错） */
function one(root: StubNode, role: string): StubNode {
  const hits = byRole(root, role);
  expect(hits.length, `树上应有唯一一个 [data-role="${role}"]，实际 ${hits.length} 个`).toBe(1);
  return hits[0];
}

/**
 * 在某个节点上"真派发一次事件"。
 *
 * ⚠️ 桩的 `dispatchEvent` **不调用派发节点自己的监听器**（只沿 `parentElement` 向上冒泡）
 * ⇒ 临时挂一个空子节点，在**它**上面派发，让冒泡路径经过目标节点
 * （与本仓 `local-data-screen.test.ts` 的 `fireIn` 同源）。
 */
function fireIn(target: StubNode, type: string, evTarget: StubNode = target, extra: Record<string, unknown> = {}): void {
  const stem = makeStubEl('span');
  target.appendChild(stem);
  // ⚠️ 桩的监听器只收到 `{ type, target }`（见 net-dom-stub 的 dispatchEvent）⇒ 这里补的字段
  //    走不通；需要额外字段的用例（键盘）自己直接把事件对象交给捕获到的监听器。
  void extra;
  stem.dispatchEvent({ type, target: evTarget });
}

/** 派发一次 `click` */
const clickIn = (target: StubNode): void => { fireIn(target, 'click'); };

/** 节点是不是当前可见（自己或任一祖先 `hidden` 就不可见） */
function visible(n: StubNode): boolean {
  for (let p: StubNode | null = n; p !== null; p = p.parentElement) {
    if ((p as unknown as { hidden?: boolean }).hidden === true) return false;
  }
  return true;
}

/** 读/写桩上的 `value`（`StubNode` 接口没声明它，桩上就是一个普通属性） */
function setValue(n: StubNode, v: string): void {
  (n as unknown as { value: string }).value = v;
}

/**
 * 附件夹具的一项：`name` + **可选的** `size` 覆盖（缺省 = 真 `File` 自己的字节数）。
 *
 * `size` 覆盖是给预检那几条腿用的（要造 `>10MB` 的读数，不能真分配 10MB 内存）——
 * 靠 `Object.defineProperty` 在**真 `File` 实例**上盖一个 own `size`，
 * 于是"真字节"与"任意读数"两者都要得到（2026-10-01 实测可行）。
 */
interface PickedLike { name: string; size?: number }

/**
 * 给 `<input type=file>` 塞一批"选中的文件"并派发 change。
 *
 * ## ★ 2026-10-01 线上验收后**重写**（这是抓出真 bug 的那一处）
 *
 * 旧夹具塞的是 `{ name, size }` 这种**纯对象**，并在注释里写着"桩环境里造不出真 Blob"——
 * **那句话是错的**（真 `File`/`Blob` 在桩环境里好好的：标签正确、`FormData` 照收）。后果是：
 * 产出代码里那条 `isBlobLike` 守卫当时**只认 `[object Blob]`、漏了 `File`**，
 * 而纯对象本来就该被守卫挡掉 ⇒ "守卫恒假"这件事在本文件里**测不出来**，
 * 于是线上的附件被静默丢掉（用户看到"已选择 1 份附件"、服务端 `files: []`）。
 *
 * 现在夹具塞的是**真 `File`**（`input.files[i]` 在浏览器里就是它：`name`/`size`/字节齐全），
 * 产出代码读的 `f.name`/`f.size` 与随请求发出去的**字节**都是同一份对象 ⇒
 * 守卫退回旧写法时，"附件真的进了 FormData"那条腿会**当场变红**。
 */
function pickFiles(input: StubNode, files: ReadonlyArray<PickedLike>): void {
  const list: { length: number } & Record<number, unknown> = { length: files.length };
  files.forEach((f, i) => {
    const file = new File([`内容：${f.name}`], f.name, { type: 'application/octet-stream' });
    if (f.size !== undefined) {
      // own 属性盖住 Blob.prototype 上那个 size getter（真字节仍在，只是读数被改）
      Object.defineProperty(file, 'size', { value: f.size, configurable: true });
    }
    list[i] = file;
  });
  (input as unknown as { files: unknown }).files = list;
  fireIn(input, 'change');
}

/**
 * 塞一批**不是字节**的东西（纯对象）——给"宿主接缝给错了"那条腿用。
 *
 * 它与 `pickFiles` 的差别是刻意的：产出代码的守卫要能在"拿不到字节"时**跳过那一份**
 * 而不是把整次提交弄炸，这一条用一个不带字节的对象来钉。
 */
function pickNonByteEntries(input: StubNode, files: ReadonlyArray<PickedLike>): void {
  const list: { length: number } & Record<number, unknown> = { length: files.length };
  files.forEach((f, i) => { list[i] = { name: f.name, size: f.size ?? 10 }; });
  (input as unknown as { files: unknown }).files = list;
  fireIn(input, 'change');
}

/** 让已排队的 microtask / `await` 链跑完（假抓取层的 Promise 都是立即 resolve 的） */
const flush = (): Promise<void> => new Promise<void>((r) => { setTimeout(r, 0); });

/** `document.body` 那一棵树（挂在上面的浮层都在这儿） */
const bodyStub = (): StubNode => (globalThis as unknown as { document: { body: StubNode } }).document.body;

/** 在 `document.body` 上按 `data-role` 找（隐藏页/表单那些浮层都挂在那里） */
const byRoleBody = (role: string): StubNode[] => queryAllIn(bodyStub(), `[data-role="${role}"]`);

/**
 * 把一次请求的 body 读成 JSON（登录 / 标记已读 / 删除这三条发的是 JSON 的 `Blob`）。
 *
 * 契约里这三条是 JSON ⇒ 判据要断在**内容**上（不是"发了个东西"）：这里按 `Blob.text()`
 * 读回来再 `JSON.parse`。不是 `Blob` 时返回 `null`（调用方据此报"发错形态了"）。
 */
async function readJsonBody(body: unknown): Promise<unknown> {
  if (body === null || body === undefined) return null;
  if (typeof (body as Blob).text !== 'function') return null;
  return JSON.parse(await (body as Blob).text());
}

/* ==================== 夹具：两条反馈 + 详情 ==================== */

const item1 = {
  id: 'f-1',
  kind: 'protocol' as const,
  title: '自创协议「回声」',
  author: '甲',
  createdAt: '2026-10-01T10:00:00.000Z',
  fileCount: 1,
  read: false,
  readAt: '',
};

const item2 = {
  id: 'f-2',
  kind: 'bug' as const,
  title: '点刷新会闪一下',
  author: '乙',
  createdAt: '2026-09-30T08:30:00.000Z',
  fileCount: 0,
  read: true,
  readAt: '2026-09-30T09:00:00.000Z',
};

/** 详情（附件一份） */
const detail1 = {
  ...item1,
  body: '正文第一行。\n正文第二行。',
  files: [{ name: '示意图.png', size: 2048 }],
};

/** 一个已登录的隐藏页（列表两条、详情一条、read/delete 都成功） */
function listServer(): FakeServer {
  return new FakeServer()
    .on(FEEDBACK_ENDPOINTS.item, 200, { ok: true, item: detail1 })
    .on(FEEDBACK_ENDPOINTS.list, 200, { ok: true, items: [item1, item2], unread: 1, total: 2 })
    .on(FEEDBACK_ENDPOINTS.read, 200, { ok: true })
    .on(FEEDBACK_ENDPOINTS.delete, 200, { ok: true });
}

/** 建一个隐藏页视图并挂到 `document.body`（`setup()` 在这里现挂，宿主的接缝与首页那条路同款） */
function makeView(fetcher: FeedbackFetcher): { view: FeedbackHiddenView; root: StubNode } {
  setup({ home: true });
  // ⚠️ 用**被 setup 包过的** `document.createElement`（那一层给表单控件补了 `value` 默认值），
  //    与表单那几条腿走同一条造节点路径。
  const root = (globalThis as unknown as { document: { createElement: (t: string) => StubNode } })
    .document.createElement('div');
  const view = new FeedbackHiddenView({
    root: root as unknown as HTMLElement,
    fetcher,
    onClose: () => { /* 用例自己按需换掉 */ },
  });
  view.open();
  view.mount((globalThis as unknown as { document: { body: StubNode } }).document.body as unknown as HTMLElement);
  views.push(view);
  return { view, root };
}

/**
 * 走完"口令 → 列表"那一格（假服务端缺省回 `{ ok: true }` 的登录）。
 *
 * `expectList` 缺省为真：登录成功之后**当前格应该是列表**。测 401 那条腿时必须传
 * `false` —— 那里列表那一次 GET 会回 401，屏会立刻退回口令框，于是"当前格是列表"这个
 * 前提本来就不成立。
 */
async function enterList(
  view: FeedbackHiddenView,
  root: StubNode,
  fake: FakeServer,
  expectList = true,
): Promise<void> {
  fake.on(FEEDBACK_ENDPOINTS.login, 200, { ok: true });
  setValue(one(root, 'password'), '口令');
  clickIn(one(root, 'password-ok'));
  await flush();
  if (expectList) expect(view.currentScreen, '口令正确之后没有进列表').toBe('list');
}

/* ==================================================================== *
 * 1. 纯逻辑核（无 DOM、无网络）
 * ==================================================================== */

describe('纯逻辑核：必填校验 / 附件预检 / 读数 / 响应读数', () => {
  it('三行必填：全空时三项都点名，缺一项只点名那一项', () => {
    const all = missingFields({ title: '  ', author: '', body: '\n' });
    expect(all).toEqual({ title: true, author: true, body: true });
    expect(feedbackMissingText(all)).toBe('还有必填项没写：标题、投稿人/反馈人、说明文本。');
    const oneMissing = missingFields({ title: '标题', author: '甲', body: '' });
    expect(oneMissing).toEqual({ title: false, author: false, body: true });
    expect(feedbackMissingText(oneMissing)).toBe('还有必填项没写：说明文本。');
    // 都填了 ⇒ 不该有任何提示（空串是"别说"的机器出口）
    expect(feedbackMissingText(missingFields({ title: 'a', author: 'b', body: 'c' }))).toBe('');
  });

  it('★ 附件守卫：真 File 与真 Blob 都必须进 FormData；纯对象 / null 被跳过（线上真 bug 的正反向）', () => {
    // ## 这条腿为什么必须存在（2026-10-01 线上验收抓出的真 bug）
    //
    // 守卫第一版只认 `Object.prototype.toString.call(v) === '[object Blob]'`，**漏了 `File`**；
    // 而真实浏览器里 `<input type=file>` 给的就是 `File`，标签是 **`[object File]`**
    // ⇒ 守卫恒假 ⇒ 附件**一次都没发出去**（用户看到"已选择 1 份附件"、服务端收到 `files: []`）。
    // 旧夹具只造 `{name, size}` 纯对象（本来就该被挡），所以"恒假"测不出来 —— 现在两个方向都钉住：
    // 真 File 必须进、真 Blob 必须进、纯对象/null 必须不进。
    const file = new File(['内容'], 'a.txt', { type: 'text/plain' });
    const blob = new Blob(['内容'], { type: 'text/plain' });
    // 前置锚点（这条腿的立论基础）：真 File 的标签**不是** `[object Blob]`
    expect(Object.prototype.toString.call(file), '前置：File 的标签变了？那这条腿的立论要重写')
      .toBe('[object File]');
    expect(file instanceof Blob, '前置：File 不是 Blob 的子类？').toBe(true);
    expect(Object.prototype.toString.call(blob)).toBe('[object Blob]');

    const fd = buildSubmitForm({
      kind: 'bug',
      title: '标题',
      author: '甲',
      body: '正文',
      files: [
        { name: 'a.txt', size: 2, file },
        { name: 'b.txt', size: 2, file: blob },
        { name: 'c.txt', size: 2, file: { name: 'c.txt' } as unknown as Blob },
        { name: 'd.txt', size: 2, file: null as unknown as Blob },
      ],
    });
    const sent = fd.getAll('files');
    expect(sent.length, '真 File / 真 Blob 没进 FormData —— 守卫漏掉 File 时就是这条红')
      .toBe(2);
    expect(sent.map((f) => (f as File).name)).toEqual(['a.txt', 'b.txt']);
    expect(Object.prototype.toString.call(sent[0]), '发出去的第一份不是 File 语义').toBe('[object File]');
    // 第二份是真 Blob（没有 name）：按**它自己的字节数**比（不写死魔数）
    expect((sent[1] as Blob).size, '发出去的第二份没有字节').toBe(blob.size);
    expect(blob.size).toBeGreaterThan(0);
    // 反向：其余四个字段照旧在
    expect(fd.get('kind')).toBe('bug');
    expect(fd.get('title')).toBe('标题');
  });

  it('单份 >10MB 当场拒绝（不变量：恰好 10MB 放行、10MB+1 拒绝）', () => {
    const ok = checkFileSelection([{ name: '刚好.png', size: FEEDBACK_MAX_FILE_BYTES }]);
    expect(ok.kept.map((f) => f.name)).toEqual(['刚好.png']);
    expect(ok.notice, '恰好 10MB 不该给任何提示').toBe('');

    const over = checkFileSelection([{ name: '太大.png', size: FEEDBACK_MAX_FILE_BYTES + 1 }]);
    expect(over.kept, '超限的文件居然进了表单').toEqual([]);
    expect(over.rejected.map((f) => f.name)).toEqual(['太大.png']);
    expect(over.notice).toContain('10MB');
    expect(over.notice).toContain('太大.png');
  });

  it('超过 5 份只留前 5 份，并说清多出来几份（用户口径：一次最多 5 份）', () => {
    const many = Array.from({ length: 8 }, (_, i) => ({ name: `第${i + 1}.txt`, size: 10 }));
    const r = checkFileSelection(many);
    expect(r.kept.length, `一次留了 ${r.kept.length} 份，超过上限`).toBe(FEEDBACK_MAX_FILES);
    expect(r.kept.map((f) => f.name)).toEqual(['第1.txt', '第2.txt', '第3.txt', '第4.txt', '第5.txt']);
    expect(r.droppedCount).toBe(3);
    expect(r.notice).toContain('一次最多带 5 份附件');
    expect(r.notice).toContain('3');
    // 边界：恰好 5 份 ⇒ 一句提示都不该有
    expect(checkFileSelection(many.slice(0, 5)).notice).toBe('');
  });

  it('超限与超份数同时出现时，两句话都在（不是只报一条）', () => {
    const files = [
      { name: 'a.txt', size: 1 }, { name: 'b.txt', size: 1 }, { name: 'c.txt', size: 1 },
      { name: 'd.txt', size: 1 }, { name: 'e.txt', size: 1 }, { name: 'f.txt', size: 1 },
      { name: '大.png', size: FEEDBACK_MAX_FILE_BYTES * 2 },
    ];
    const r = checkFileSelection(files);
    expect(r.kept.length).toBe(5);
    expect(r.rejected.map((f) => f.name)).toEqual(['大.png']);
    expect(r.notice).toContain('10MB');
    expect(r.notice).toContain('多出来的 1 份');
  });

  it('accept 覆盖用户点名的两类（图片/pdf 与文本/markdown）', () => {
    for (const ext of ['.pdf', '.jpg', '.png', '.txt', '.md']) {
      expect(FEEDBACK_ACCEPT, `accept 里缺 ${ext}`).toContain(ext);
    }
  });

  it('字节读数：B / KB / MB 三档不乱写（10MB 上限那句就是它算出来的）', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1023)).toBe('1023 B');
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(FEEDBACK_MAX_FILE_BYTES)).toBe('10.0 MB');
    expect(formatBytes(Number.NaN)).toBe('未知大小');
  });

  it('时间读数：ISO 串与毫秒数都认，认不出就原样回显（不许出现 Invalid Date）', () => {
    const iso = formatCreatedAt('2026-10-01T10:00:00.000Z');
    expect(iso).toMatch(/^2026-10-0[12] \d\d:\d\d$/); // 本地时区可能落在 10-01 或 10-02
    expect(formatCreatedAt(1759312800000)).toMatch(/^\d{4}-\d\d-\d\d \d\d:\d\d$/);
    expect(formatCreatedAt('看不懂的东西')).toBe('看不懂的东西');
    expect(formatCreatedAt('')).toBe('时间未知');
  });

  it('列表读数：unread/total 由服务端给；缺席时按 items 自己算（不说谎）', () => {
    const withCounts = readList({ ok: true, items: [item1, item2], unread: 1, total: 2 });
    expect(withCounts).not.toBeNull();
    expect(withCounts!.items.length).toBe(2);
    expect(withCounts!.unread).toBe(1);
    expect(withCounts!.total).toBe(2);
    expect(withCounts!.items[0].read, 'item1 是未读').toBe(false);
    expect(withCounts!.items[1].readAt).toBe('2026-09-30T09:00:00.000Z');

    const noCounts = readList({ ok: true, items: [item1, item2] });
    expect(noCounts!.unread, '服务端没给 unread 时该按 items 算').toBe(1);
    expect(noCounts!.total).toBe(2);
    // 不认的形状 ⇒ null（调用方当失败，不猜）
    expect(readList({ ok: false, error: '未登录' })).toBeNull();
    expect(readList({ ok: true })).toBeNull();
    expect(readList(null)).toBeNull();
  });

  it('读/删两条的响应读数：只有 ok===true 才算成功，否则原样带出中文原因', () => {
    expect(readActionOk({ ok: true }, '兜底')).toEqual({ ok: true });
    expect(readActionOk({ ok: false, error: '这条反馈不在回收站里' }, '兜底'))
      .toEqual({ ok: false, error: '这条反馈不在回收站里' });
    expect(readActionOk({}, '兜底')).toEqual({ ok: false, error: '兜底' });
    expect(readActionOk(null, '兜底')).toEqual({ ok: false, error: '兜底' });
  });

  it('详情读数：files 逐条收窄（缺字段补空/0），body 不是串就当空', () => {
    const d = readItem({ ok: true, item: { ...detail1, files: [{ name: 'x.txt' }, { size: 7 }, null] } });
    expect(d).not.toBeNull();
    expect(d!.body).toBe(detail1.body);
    expect(d!.files).toEqual([{ name: 'x.txt', size: 0 }, { name: '', size: 7 }]);
    expect(readItem({ ok: true })).toBeNull();
  });

  it('服务端中文原因原样取用（一个字符都不改）；没有 error 字段才用兜底那句', () => {
    expect(serverErrorText({ ok: false, error: ' 今天已达上限 ' }, '兜底')).toBe(' 今天已达上限 ');
    expect(serverErrorText({ ok: false }, '兜底')).toBe('兜底');
    expect(serverErrorText('不是对象', '兜底')).toBe('兜底');
  });

  it('两条动作的请求体逐字符合契约（read 带 read 布尔，delete 只有 id）', () => {
    expect(JSON.parse(buildReadBody('f-1', true))).toEqual({ id: 'f-1', read: true });
    expect(JSON.parse(buildReadBody('f-1', false))).toEqual({ id: 'f-1', read: false });
    expect(JSON.parse(buildDeleteBody('f-2'))).toEqual({ id: 'f-2' });
  });

  it('顶部读数那句话只有一个出处：共 N 条 · 未读 M 条', () => {
    expect(feedbackCountText({ total: 3, unread: 0 })).toBe('共 3 条 · 未读 0 条');
    expect(feedbackCountText({ total: 0, unread: 0 })).toBe('共 0 条 · 未读 0 条');
  });
});

/* ==================================================================== *
 * 夹具：可控时钟（测"提交成功后延迟自动关闭"那几条腿用）
 * ==================================================================== */

/**
 * 一个**可控**的调度器（形状与 `FeedbackFormElement` 的 `nav.scheduleClose` 对齐：
 * 排一个延迟任务、返回取消函数）。
 *
 * 为什么要它（而不是真的等 1.2 秒 / 或者去 `vi.useFakeTimers()` 戳全局）：
 * "延迟到了才关闭"这件事有三半要断言 —— ①延迟值是多少 ②到点调的是哪条路径
 * ③提前手动关掉之后有没有**取消**。可控时钟让这三半都能**当场**读出来，
 * 且不依赖真实时间（用户 2026-10-01 明确要求"定时器要能被清理"，取消那一半必须有腿）。
 */
interface FakeClock {
  /** 排一个任务（返回取消函数）；形状与产出代码要的 `scheduleClose` 逐字一致 */
  schedule(fn: () => void, delayMs: number): () => void;
  /** 推进 `ms` 毫秒（到点的任务按时间顺序跑；被取消的跳过） */
  advance(ms: number): void;
  /** 每个任务的延迟值（按排入顺序） */
  delays(): number[];
  /** 取消函数被调过几次 */
  cancels(): number;
  /** 还没跑、也没被取消的任务数 */
  pending(): number;
}

function fakeClock(): FakeClock {
  let now = 0;
  let seq = 0;
  let cancels = 0;
  const delays: number[] = [];
  const tasks: Array<{ due: number; order: number; fn: () => void; cancelled: boolean }> = [];
  return {
    schedule: (fn, delayMs) => {
      delays.push(delayMs);
      const task = { due: now + delayMs, order: seq++, fn, cancelled: false };
      tasks.push(task);
      return () => {
        cancels += 1;
        task.cancelled = true;
      };
    },
    advance: (ms) => {
      now += ms;
      // 反复扫：到点的任务可能在跑的过程中又排新的（这里没有，但语义上要正确）
      for (;;) {
        const due = tasks
          .filter((t) => !t.cancelled && t.due <= now)
          .sort((a, b) => a.due - b.due || a.order - b.order);
        if (due.length === 0) return;
        for (const t of due) {
          t.cancelled = true; // 摘掉：只跑一次
          t.fn();
        }
      }
    },
    delays: () => [...delays],
    cancels: () => cancels,
    pending: () => tasks.filter((t) => !t.cancelled).length,
  };
}

/* ==================================================================== *
 * 2. 表单浮层：两种操作 / 必填 / 附件预检 / 提交
 * ==================================================================== */

describe('表单浮层（两种操作 + 必填 + 附件 + 提交）', () => {
  /**
   * 装好表单，返回桩节点树、"关掉了几次"的读数、可控时钟与句柄。
   *
   * `clock` 缺省给一个新的可控时钟：**所有**用例都走它 ⇒ 没有一条腿会真的等 1.2 秒，
   * 也没有一条腿会漏掉"定时器去哪了"这件事。
   */
  function form(fake: FakeServer, opts: {
    onClose?: () => void;
    onSubmitted?: (id: string) => void;
    clock?: FakeClock;
  } = {}) {
    setup();
    const closed: number[] = [];
    const clock = opts.clock ?? fakeClock();
    const handle = feedbackFormElement({
      onClose: opts.onClose ?? (() => { closed.push(1); }),
      fetcher: fake,
      scheduleClose: (fn, delayMs) => clock.schedule(fn, delayMs),
      ...(opts.onSubmitted === undefined ? {} : { onSubmitted: opts.onSubmitted }),
    });
    const root = asStub(handle.element);
    (globalThis as unknown as { document: { body: StubNode } }).document.body.appendChild(root);
    return { root, closed, clock, handle };
  }

  /** 填好三行必填 */
  function fill(root: StubNode, title = '投稿一个协议', author = '甲', body = '正文'): void {
    setValue(one(root, 'title'), title);
    setValue(one(root, 'author'), author);
    setValue(one(root, 'body'), body);
  }

  it('结构齐：两种操作的按钮、三行输入、附件框、提交按钮、状态行都在', () => {
    const { root } = form(FakeServer.empty());
    expect(one(root, 'kind-protocol').tag).toBe('button');
    expect(one(root, 'kind-bug').tag).toBe('button');
    expect(one(root, 'title').tag).toBe('input');
    expect(one(root, 'author').tag).toBe('input');
    expect(one(root, 'body').tag).toBe('textarea');
    const filesInput = one(root, 'files');
    expect(filesInput.tag).toBe('input');
    // ⚠️ 桩不反射 `multiple` 这个 IDL 属性（产出代码写的是 `setAttribute`）⇒ 按属性表读
    expect((filesInput.getAttribute as (n: string) => string | null)('multiple'), '附件框不支持多选').not.toBeNull();
    expect((filesInput.getAttribute as (n: string) => string | null)('accept')).toContain('.txt');
    expect(one(root, 'submit').tag).toBe('button');
    expect(one(root, 'status').tag).toBe('div');
  });

  it('默认是「投稿自定义协议」：那一档的标签与说明就在屏上', () => {
    const { root } = form(FakeServer.empty());
    expect(one(root, 'kind-protocol').cls, '默认那一档没有高亮').toContain('feedback-chip-on');
    expect(textOf(root), '屏上没写"投稿自定义协议"').toContain('投稿自定义协议');
    expect(textOf(root), '协议那一档该说"说明文本"').toContain('协议与卡牌的说明文本');
    expect(textOf(root), '协议那一档该叫"投稿人"').toContain('投稿人');
  });

  it('切到 bug 反馈：高亮换人、标签改成"反馈人"与"bug 现象"（两档真的不同）', () => {
    const { root } = form(FakeServer.empty());
    clickIn(one(root, 'kind-bug'));
    expect(one(root, 'kind-bug').cls, '切过去之后 bug 那一档没高亮').toContain('feedback-chip-on');
    expect(one(root, 'kind-protocol').cls, '切过去之后协议那一档还亮着').not.toContain('feedback-chip-on');
    expect(one(root, 'kind-bug').dataset.feedbackKind).toBe('bug');
    expect(textOf(root), 'bug 那一档没把"投稿人"改成"反馈人"').toContain('反馈人');
    expect(textOf(root), 'bug 那一档该说"具体的 bug 现象或反馈意见"').toContain('具体的 bug 现象或反馈意见');
    expect(textOf(root), 'bug 那一档还写着协议那句说明文本').not.toContain('协议与卡牌的说明文本');
    // 切回去也能还原（不是单向的）
    clickIn(one(root, 'kind-protocol'));
    expect(textOf(root)).toContain('协议与卡牌的说明文本');
  });

  it('必填校验：三行空时**一个请求都不发**，状态行点名缺的三项，三个字段行被标红', () => {
    const fake = FakeServer.empty();
    const { root } = form(fake);
    clickIn(one(root, 'submit'));
    expect(fake.reqs, '必填都没填就把请求发出去了').toEqual([]);
    expect(one(root, 'status').text).toContain('标题');
    expect(one(root, 'status').text).toContain('说明文本');
    expect(one(root, 'status').dataset.kind).toBe('error');
    // 标红那一层是 .feedback-field 上的类（只标缺的那几行）
    const bad = descendants(root).filter((n) => n.cls.includes('feedback-field-bad'));
    expect(bad.length, '三行都缺时该有三行被标红').toBe(3);
  });

  it('必填只缺正文时：只标红正文那一行，标题与署名那两行不红', () => {
    const fake = FakeServer.empty();
    const { root } = form(fake);
    fill(root, '标题', '甲', '   ');
    clickIn(one(root, 'submit'));
    expect(fake.reqs).toEqual([]);
    expect(one(root, 'status').text).toBe('还有必填项没写：说明文本。');
    const bad = descendants(root).filter((n) => n.cls.includes('feedback-field-bad'));
    expect(bad.length, '只该标红一行').toBe(1);
    expect(textOf(bad[0]), '标红的不是正文那一行').toContain('说明文本');
  });

  it('附件：>10MB 当场拒绝（不进表单、不提交、状态行说清是哪一份）', async () => {
    const fake = FakeServer.empty().on(FEEDBACK_ENDPOINTS.submit, 200, { ok: true, id: 'f-9' });
    const { root } = form(fake);
    pickFiles(one(root, 'files'), [
      { name: 'ok.txt', size: 100 },
      { name: '巨大.pdf', size: FEEDBACK_MAX_FILE_BYTES + 1 },
    ]);
    expect(one(root, 'status').text, '超限那份没被点名').toContain('巨大.pdf');
    expect(one(root, 'status').text).toContain('10MB');
    // 屏上只剩 ok.txt 一份（超限那份根本没进清单）
    expect(byRole(root, 'file-remove').length, '附件清单里还有超限那份').toBe(1);
    expect(textOf(root)).toContain('ok.txt');

    fill(root);
    clickIn(one(root, 'submit'));
    await flush();
    expect(fake.to(FEEDBACK_ENDPOINTS.submit)).toHaveLength(1);
    const info = fake.to(FEEDBACK_ENDPOINTS.submit)[0].info;
    expect(info!.files.map((f) => f.name), '超限那份居然被提交了').toEqual(['ok.txt']);
  });

  it('附件：一次选 8 份 ⇒ 只留 5 份并提示多出来 3 份（本地预检，服务端另有一层）', async () => {
    const fake = FakeServer.empty().on(FEEDBACK_ENDPOINTS.submit, 200, { ok: true, id: 'f-9' });
    const { root } = form(fake);
    pickFiles(one(root, 'files'), Array.from({ length: 8 }, (_, i) => ({ name: `n${i + 1}.txt`, size: 10 })));
    expect(one(root, 'status').text).toContain('一次最多带 5 份附件');
    expect(one(root, 'status').text).toContain('3');
    expect(byRole(root, 'file-remove').length).toBe(FEEDBACK_MAX_FILES);

    fill(root);
    clickIn(one(root, 'submit'));
    await flush();
    const info = fake.to(FEEDBACK_ENDPOINTS.submit)[0].info;
    expect(info!.files.length).toBe(5);
    expect(info!.files.map((f) => f.name)).toEqual(['n1.txt', 'n2.txt', 'n3.txt', 'n4.txt', 'n5.txt']);
  });

  it('附件可单份移除 / 清空（清空之后提交里零附件）', async () => {
    const fake = FakeServer.empty().on(FEEDBACK_ENDPOINTS.submit, 200, { ok: true, id: 'f-9' });
    const { root } = form(fake);
    pickFiles(one(root, 'files'), [{ name: 'a.txt', size: 10 }, { name: 'b.txt', size: 20 }]);
    expect(byRole(root, 'file-remove').length).toBe(2);
    clickIn(byRole(root, 'file-remove')[0]);
    expect(byRole(root, 'file-remove').length, '点「移除」没摘掉那一份').toBe(1);
    expect(textOf(root)).not.toContain('a.txt');
    clickIn(one(root, 'file-clear'));
    expect(byRole(root, 'file-remove').length).toBe(0);

    fill(root);
    clickIn(one(root, 'submit'));
    await flush();
    expect(fake.to(FEEDBACK_ENDPOINTS.submit)[0].info!.files).toEqual([]);
  });

  it('提交成功：POST /feedback/submit（multipart，字段与契约逐字对齐）+ 清空正文与附件 + 说"提交成功"', async () => {
    const fake = FakeServer.empty().on(FEEDBACK_ENDPOINTS.submit, 200, { ok: true, id: 'f-77' });
    const submitted: string[] = [];
    const { root } = form(fake, { onSubmitted: (id) => { submitted.push(id); } });
    clickIn(one(root, 'kind-protocol'));
    fill(root, '自创协议「回声」', '甲', '效果这样结算……');
    pickFiles(one(root, 'files'), [{ name: '示意图.png', size: 2048 }]);

    clickIn(one(root, 'submit'));
    await flush();

    const reqs = fake.to(FEEDBACK_ENDPOINTS.submit);
    expect(reqs).toHaveLength(1);
    expect(reqs[0].method).toBe('POST');
    expect(reqs[0].credentials, '没有让浏览器自动带 Cookie（前端不存 token）').toBe('same-origin');
    expect(reqs[0].body, 'multipart 那条该发 FormData').toBeInstanceOf(FormData);
    const fd = reqs[0].body as FormData;
    expect(fd.get('kind')).toBe('protocol');
    expect(fd.get('title')).toBe('自创协议「回声」');
    expect(fd.get('author')).toBe('甲');
    expect(fd.get('body')).toBe('效果这样结算……');
    // ★ 2026-10-01 线上验收后**加强**（原来是"断言 `files` 不在 FormData 里"，那是个错期望）：
    //   附件必须**真的**进请求体。这条腿就是抓着"守卫漏掉 `File`"那条真 bug 的那一条 ——
    //   把 `isBlobLike` 退回"只认 `[object Blob]`"的写法，这里当场变红。
    const sent = fd.getAll('files');
    expect(sent.length, '附件没有进 FormData（线上就是这条：服务端收到 files: []）').toBe(1);
    const sentFile = sent[0] as File;
    expect(Object.prototype.toString.call(sentFile), '发出去的不是 File/Blob 语义的东西')
      .toBe('[object File]');
    expect(sentFile.name, '发出去的那一份名字不对').toBe('示意图.png');
    // 反向锚点：其余四个字段一个不少（附件加上去之后没把别的挤掉）
    expect(fd.get('kind')).toBe('protocol');
    expect(fd.get('title')).toBe('自创协议「回声」');
    expect(fd.get('author')).toBe('甲');
    expect(fd.get('body')).toBe('效果这样结算……');
    // 元信息（同一次请求的机器可读副本）
    expect(reqs[0].info).toEqual({
      kind: 'protocol',
      title: '自创协议「回声」',
      author: '甲',
      body: '效果这样结算……',
      files: [{ name: '示意图.png', size: 2048 }],
    });
    // ★ 2026-10-01 改口径：成功那句必须含「提交成功」（用户原话："显示「提交成功」"）
    expect(one(root, 'status').text, '成功那句里没有「提交成功」').toContain('提交成功');
    expect(one(root, 'status').text, '编号没写出来（契约里 `id` 要可见）').toContain('f-77');
    expect(one(root, 'status').dataset.kind).toBe('ok');
    expect(submitted, '提交成功没通知宿主').toEqual(['f-77']);
    expect(byRole(root, 'file-remove'), '提交成功后附件清单没清').toHaveLength(0);
    expect((one(root, 'body') as unknown as { value: string }).value, '提交成功后正文没清').toBe('');
    // 反向锚点：旧口径那句不该再出现（改口径改了一半的形态）
    expect(one(root, 'status').text, '还留着旧口径「已提交，感谢」').not.toContain('已提交，感谢');
  });

  it('提交成功后：**延迟内浮层不关**（让用户看得见「提交成功」），到点才走关闭路径', async () => {
    const fake = FakeServer.empty().on(FEEDBACK_ENDPOINTS.submit, 200, { ok: true, id: 'f-9' });
    const { root, closed, clock } = form(fake);
    fill(root);
    clickIn(one(root, 'submit'));
    await flush();

    // ① 排了一个定时器，延迟就是那个唯一出处（不是写死在两处的魔数）
    expect(clock.delays(), '成功后没有排自动关闭，或者延迟值不是约定的那个').toEqual([FEEDBACK_SUCCESS_CLOSE_MS]);
    expect(FEEDBACK_SUCCESS_CLOSE_MS, '用户要求 1.0~1.5 秒').toBeGreaterThanOrEqual(1000);
    expect(FEEDBACK_SUCCESS_CLOSE_MS, '用户要求 1.0~1.5 秒').toBeLessThanOrEqual(1500);
    // ② 还没到点：浮层**没关**（"先让用户看见"这一半）
    expect(closed, '排上定时器之后立刻就关了（用户看不见「提交成功」）').toEqual([]);
    expect(one(root, 'status').text).toContain('提交成功');

    // ③ 到点：走的是关闭路径，且只关一次
    clock.advance(FEEDBACK_SUCCESS_CLOSE_MS);
    expect(closed, '到点之后没有关闭（＝没回到首页）').toEqual([1]);
    // ④ 再推进也不会有第二次关闭（定时器是一次性的）
    clock.advance(FEEDBACK_SUCCESS_CLOSE_MS * 3);
    expect(closed, '到点关闭之后又关了一次').toEqual([1]);
    expect(clock.pending(), '还有没跑完的定时器').toBe(0);
  });

  it('提交成功后**延迟内手动关闭**：关一次就好，且待执行的定时器真被取消（不再二次关闭）', async () => {
    const fake = FakeServer.empty().on(FEEDBACK_ENDPOINTS.submit, 200, { ok: true, id: 'f-9' });
    const { root, closed, clock } = form(fake);
    fill(root);
    clickIn(one(root, 'submit'));
    await flush();
    expect(clock.pending(), '前置：成功后该有一个待执行的自动关闭').toBe(1);

    // 用户在那一秒里自己点了「关闭」
    const closeBtn = descendants(root).find((n) => n.cls.includes('feedback-close'))!;
    clickIn(closeBtn);
    expect(closed, '手动关闭没生效').toEqual([1]);
    expect(clock.cancels(), '手动关闭时没有取消待执行的定时器（用户要求"定时器要能被清理"）').toBe(1);
    expect(clock.pending(), '取消之后还留着待执行的定时器').toBe(0);

    // 把时间推过延迟：不许再关第二次（否则会对一个已经摘掉的浮层再动手）
    clock.advance(FEEDBACK_SUCCESS_CLOSE_MS * 2);
    expect(closed, '延迟到点之后又关了一次（二次关闭）').toEqual([1]);
  });

  it('提交成功后**延迟内点遮罩空白处**：同样只关一次、定时器同样被取消', async () => {
    const fake = FakeServer.empty().on(FEEDBACK_ENDPOINTS.submit, 200, { ok: true, id: 'f-9' });
    const { root, closed, clock } = form(fake);
    fill(root);
    clickIn(one(root, 'submit'));
    await flush();

    const blank = makeStubEl('span'); // 遮罩空白处：挂在浮层里、不遮任何东西
    root.appendChild(blank);
    blank.dispatchEvent({ type: 'click', target: root });
    expect(closed, '点遮罩空白处没关掉').toEqual([1]);
    expect(clock.cancels(), '点遮罩关闭时没有取消定时器').toBe(1);
    clock.advance(FEEDBACK_SUCCESS_CLOSE_MS * 2);
    expect(closed, '延迟到点之后又关了一次').toEqual([1]);
  });

  it('提交成功（宿主给了 onSubmitted）⇒ 回调照旧 + **仍会**自动关闭（用户口径不是"留给宿主决定"）', async () => {
    const fake = FakeServer.empty().on(FEEDBACK_ENDPOINTS.submit, 200, { ok: true, id: 'f-42' });
    const seen: string[] = [];
    const { root, closed, clock } = form(fake, { onSubmitted: (id) => { seen.push(id); } });
    fill(root);
    clickIn(one(root, 'submit'));
    await flush();
    expect(seen, '宿主通知没收到').toEqual(['f-42']);
    expect(closed, '还没到延迟就把浮层关了').toEqual([]);
    clock.advance(FEEDBACK_SUCCESS_CLOSE_MS);
    expect(closed, '给了 onSubmitted 就不自动关闭了（用户要求是"随后自动关闭"）').toEqual([1]);
  });

  it('失败路径**不排**自动关闭（429 之后把时间推过去也不会自己关掉）', async () => {
    const fake = FakeServer.empty().on(FEEDBACK_ENDPOINTS.submit, 429, { ok: false, error: '今天已达上限。' });
    const { root, closed, clock } = form(fake);
    fill(root);
    clickIn(one(root, 'submit'));
    await flush();
    expect(clock.delays(), '失败也排了自动关闭（用户要能改一改再交）').toEqual([]);
    clock.advance(FEEDBACK_SUCCESS_CLOSE_MS * 3);
    expect(closed, '失败之后浮层自己关掉了').toEqual([]);
  });

  it('默认调度器（不注入）走的是真的 `setTimeout`：延迟到点自己关，且提前关掉会被取消', async () => {
    // 这一条钉的是**产线那条路**（`nav.scheduleClose` 缺省时用 `globalThis.setTimeout`）——
    // 上面几条注入可控时钟的腿只证明"逻辑对"，证明不了"默认实现真的排了一个真的定时器"。
    vi.useFakeTimers();
    try {
      const fake = FakeServer.empty().on(FEEDBACK_ENDPOINTS.submit, 200, { ok: true, id: 'f-1' });
      setup();
      const closed: number[] = [];
      const handle = feedbackFormElement({
        onClose: () => { closed.push(1); },
        fetcher: fake,
      });
      const root = asStub(handle.element);
      (globalThis as unknown as { document: { body: StubNode } }).document.body.appendChild(root);
      setValue(one(root, 'title'), '标题');
      setValue(one(root, 'author'), '甲');
      setValue(one(root, 'body'), '正文');
      clickIn(one(root, 'submit'));
      // 假时钟下不能用 `flush()`（它自己也走 setTimeout）⇒ 用 advanceTimers 把微任务链推完
      await vi.advanceTimersByTimeAsync(0);
      expect(one(root, 'status').text, '默认路径下成功文案没出来').toContain('提交成功');
      expect(closed, '还没到延迟就关了').toEqual([]);

      // ① 提前手动关闭 ⇒ 真定时器被 clearTimeout 掉
      const closeBtn = descendants(root).find((n) => n.cls.includes('feedback-close'))!;
      clickIn(closeBtn);
      expect(closed, '手动关闭没生效').toEqual([1]);
      await vi.advanceTimersByTimeAsync(FEEDBACK_SUCCESS_CLOSE_MS * 2);
      expect(closed, '真定时器没被取消 ⇒ 二次关闭').toEqual([1]);
    } finally {
      vi.useRealTimers();
    }

    // ② 不提前关：真定时器到点自己关
    vi.useFakeTimers();
    try {
      const fake = FakeServer.empty().on(FEEDBACK_ENDPOINTS.submit, 200, { ok: true, id: 'f-2' });
      setup();
      const closed: number[] = [];
      const handle = feedbackFormElement({ onClose: () => { closed.push(1); }, fetcher: fake });
      const root = asStub(handle.element);
      (globalThis as unknown as { document: { body: StubNode } }).document.body.appendChild(root);
      setValue(one(root, 'title'), '标题');
      setValue(one(root, 'author'), '甲');
      setValue(one(root, 'body'), '正文');
      clickIn(one(root, 'submit'));
      await vi.advanceTimersByTimeAsync(0);
      // 差 1ms 还不到点
      await vi.advanceTimersByTimeAsync(FEEDBACK_SUCCESS_CLOSE_MS - 1);
      expect(closed, '还没到点就关了（延迟值没生效？）').toEqual([]);
      await vi.advanceTimersByTimeAsync(1);
      expect(closed, '真定时器到点了却没关').toEqual([1]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('服务端 429 的中文原因**原样**显示（"今天已达上限"那句一个字符都不改）', async () => {
    // ★ 2026-10-01 改口径：服务端那句现在是"**每天最多提交 5 份**"（按提交次数）。
    //    前端一个字都不参与：这句是**服务端给的原文**，怎么显示由 `say(outcome.text)` 原样带出。
    const REASON = '今天已达上限：每个 IP 每天最多提交 5 份，请明天再试。';
    const fake = FakeServer.empty().on(FEEDBACK_ENDPOINTS.submit, 429, { ok: false, error: REASON });
    const { root, closed } = form(fake);
    fill(root);
    clickIn(one(root, 'submit'));
    await flush();
    expect(one(root, 'status').text, '服务端原因没原样显示').toBe(REASON);
    expect(one(root, 'status').dataset.kind).toBe('error');
    expect(closed, '失败时不该把浮层关掉（用户要能改一改再交）').toEqual([]);
    // 反向锚点：屏上不许出现"提交成功"这类假成功
    expect(textOf(root), '失败却说成了成功').not.toContain('提交成功');
  });

  it('服务端 415 的中文原因原样显示；连不上服务时给人话（不抛未捕获异常）', async () => {
    const TYPE_REASON = '不支持的附件类型：只能传图片、pdf 或常见文本。';
    const fake = FakeServer.empty().on(FEEDBACK_ENDPOINTS.submit, 415, { ok: false, error: TYPE_REASON });
    const { root } = form(fake);
    fill(root);
    clickIn(one(root, 'submit'));
    await flush();
    expect(one(root, 'status').text).toBe(TYPE_REASON);

    // 连不上（抓取层自己抛）
    const dead: FeedbackFetcher = {
      fetch: async () => { throw new TypeError('Failed to fetch'); },
    };
    const { root: root2 } = form(dead as unknown as FakeServer);
    fill(root2);
    clickIn(one(root2, 'submit'));
    await flush();
    expect(one(root2, 'status').text, '连不上服务时没有给人话').toContain('当前环境没有反馈服务');
    expect(one(root2, 'status').dataset.kind).toBe('error');
  });

  it('宿主接缝给的附件**不是字节**时，提交照样走得完（正文/署名照发，不抛未捕获异常）', async () => {
    // 真实的浏览器里 `<input type=file>` 给的一定是 `File`（Blob 子类）⇒ 这一条测的是
    // **接缝给错了东西**时的行为：真实 `FormData` 对第二个实参有类型检查，不拦住的话
    // 会在 `fetch` 之前同步抛出，用户看到的是"点了提交没反应"。
    const fake = FakeServer.empty().on(FEEDBACK_ENDPOINTS.submit, 200, { ok: true, id: 'f-1' });
    const { root } = form(fake);
    fill(root, '标题', '甲', '正文');
    // ⚠️ 用 `pickNonByteEntries`（纯对象），**不是** `pickFiles`（真 `File`）：
    //    这一条钉的正是"拿不到字节时跳过那一份"这半边守卫。
    pickNonByteEntries(one(root, 'files'), [{ name: 'a.txt', size: 10 }]);
    clickIn(one(root, 'submit'));
    await flush();
    const reqs = fake.to(FEEDBACK_ENDPOINTS.submit);
    expect(reqs, '不拦的话这一句会在 fetch 之前同步抛，请求根本发不出去').toHaveLength(1);
    const fd = reqs[0].body as FormData;
    expect(fd.get('title'), '正文/标题那一半也跟着丢了').toBe('标题');
    expect(fd.getAll('files'), '给的不是字节 ⇒ 跳过那一份（不硬塞、也不把提交弄炸）').toHaveLength(0);
    expect(reqs[0].info!.files.map((f) => f.name), '元信息里仍要看得到那一份附件').toEqual(['a.txt']);
    expect(one(root, 'status').text).toContain('提交成功');
  });

  it('提交中：按钮禁用且写「正在提交…」；响应回来后恢复可点', async () => {
    let release: (() => void) | null = null;
    const fake: FeedbackFetcher = {
      fetch: async () => {
        await new Promise<void>((r) => { release = r; });
        return { status: 200, ok: true, json: async () => ({ ok: true, id: 'f-1' }) } as unknown as Response;
      },
    };
    const { root } = form(fake as unknown as FakeServer);
    fill(root);
    clickIn(one(root, 'submit'));
    await flush();
    expect(one(root, 'submit').text, '提交中没有"正在提交…"的读数').toBe('正在提交…');
    expect((one(root, 'submit') as unknown as { disabled?: boolean }).disabled, '提交中按钮没禁用（能连点两次）').toBe(true);
    expect(one(root, 'status').text).toBe('正在提交…');
    release!();
    await flush();
    expect(one(root, 'submit').text).toBe('提交');
    expect((one(root, 'submit') as unknown as { disabled?: boolean }).disabled).toBe(false);
    expect(one(root, 'status').text).toContain('提交成功');
  });

  it('点遮罩空白处关一次；点浮层内部不关', () => {
    const { root, closed } = form(FakeServer.empty());
    clickIn(one(root, 'status'));
    expect(closed, '点浮层内部也把它关了').toEqual([]);
    const blank = makeStubEl('span');
    root.appendChild(blank);
    blank.dispatchEvent({ type: 'click', target: root });
    expect(closed, '点遮罩空白处没关掉').toEqual([1]);
    // 右上角那个「关闭」按钮也能关
    const closeBtn = descendants(root).find((n) => n.cls.includes('feedback-close'))!;
    clickIn(closeBtn);
    expect(closed, '「关闭」按钮没关掉').toEqual([1, 1]);
  });
});

/* ==================================================================== *
 * 2b. 宿主那一层（`openFeedbackOverlay`）：自动关闭之后**首页一个字节都不重画**
 * ==================================================================== */

describe('表单浮层（宿主那一层）：成功后自动回到首页，首页那棵树不动', () => {
  /** 挂一个带"记号子节点"的首页根（`#app`），返回那个记号（用它证明首页没被重画） */
  function homeWithMarker(): { app: StubNode; marker: StubNode } {
    setup({ home: true });
    const app = (globalThis as unknown as { document: { getElementById: (id: string) => StubNode | null } })
      .document.getElementById('app')!;
    const marker = makeStubEl('div');
    marker.className = 'home-menu';
    app.appendChild(marker);
    return { app, marker };
  }

  it('成功后自动关闭：浮层没了、首页那棵树逐节点不变（不是"重画一遍首页"）', async () => {
    vi.useFakeTimers();
    try {
      const fake = FakeServer.empty().on(FEEDBACK_ENDPOINTS.submit, 200, { ok: true, id: 'f-1' });
      const { app, marker } = homeWithMarker();
      const before = [...app.children];
      const overlay = openFeedbackOverlay({ fetcher: fake });
      // 挂上浮层这一下**没有**碰 `#app`（浮层挂在 `document.body` 上）
      expect(app.children.length, '开浮层时动了首页的 DOM').toBe(before.length);
      app.children.forEach((n, i) => expect(n, `开浮层时首页第 ${i} 个子节点被换掉了`).toBe(before[i]));

      const root = asStub(overlay);
      setValue(one(root, 'title'), '标题');
      setValue(one(root, 'author'), '甲');
      setValue(one(root, 'body'), '正文');
      clickIn(one(root, 'submit'));
      await vi.advanceTimersByTimeAsync(0);
      expect(one(root, 'status').text).toContain('提交成功');
      expect(overlay.parentElement, '还没到延迟浮层就摘了').not.toBeNull();

      await vi.advanceTimersByTimeAsync(FEEDBACK_SUCCESS_CLOSE_MS);
      // ① 浮层真没了（＝回到首页）
      expect(overlay.parentElement, '到点之后浮层还挂在 document.body 上').toBeNull();
      expect(descendants(bodyStub()).filter((n) => n.cls.includes('feedback-overlay')), '还有浮层残留')
        .toHaveLength(0);
      // ② 首页那棵树**逐节点不变**：还是同一个记号节点、还挂在 `#app` 上、子节点数没变
      expect(app.children.length, '首页的子节点数变了（重画了首页）').toBe(before.length);
      app.children.forEach((n, i) => expect(n, `首页第 ${i} 个子节点不是原来那一个了`).toBe(before[i]));
      expect(app.children[0], '首页那个记号节点不是原来那一个了').toBe(marker);
      expect(marker.parentElement, '记号节点被从首页摘掉了').toBe(app);
      // ③ 关掉之后**再开**是干净的一层（单例清了，不会叠出第二层）
      const again = openFeedbackOverlay({ fetcher: fake });
      expect(again, '关掉之后重开拿到的还是旧节点／或者根本没开').not.toBe(overlay);
      expect(descendants(bodyStub()).filter((n) => n.cls.includes('feedback-overlay'))).toHaveLength(1);
      closeFeedbackOverlay();
    } finally {
      vi.useRealTimers();
    }
  });

  it('宿主换页收尾 `closeFeedbackOverlay()`：真的取消待执行的自动关闭（且不会二次关闭）', async () => {
    vi.useFakeTimers();
    try {
      const fake = FakeServer.empty().on(FEEDBACK_ENDPOINTS.submit, 200, { ok: true, id: 'f-1' });
      const { app } = homeWithMarker();
      const overlay = openFeedbackOverlay({ fetcher: fake });
      const root = asStub(overlay);
      setValue(one(root, 'title'), '标题');
      setValue(one(root, 'author'), '甲');
      setValue(one(root, 'body'), '正文');
      clickIn(one(root, 'submit'));
      await vi.advanceTimersByTimeAsync(0);

      // 还没到延迟，宿主就换页了（`main.ts` 的 `leaveHome()` 走的就是这个函数）
      closeFeedbackOverlay();
      expect(overlay.parentElement, '宿主收尾没把浮层摘掉').toBeNull();
      // 推过延迟：那个定时器**必须**已经被取消（否则会对着已摘掉的浮层再关一次）
      await vi.advanceTimersByTimeAsync(FEEDBACK_SUCCESS_CLOSE_MS * 2);
      expect(app.children.length, '延迟到点之后又动了首页').toBe(1);
      // 收尾之后重开一层是干净的（单例已清）
      const again = openFeedbackOverlay({ fetcher: fake });
      expect(again).not.toBe(overlay);
      closeFeedbackOverlay();
    } finally {
      vi.useRealTimers();
    }
  });
});

/* ==================================================================== *
 * 3. 口令框（独立那一层）
 * ==================================================================== */

/* ==================================================================== *
 * 3. 口令框
 *
 * ★ 2026-10-01 线上验收：这一组原来打的是 `feedbackPasswordElement()` —— 一个**没有任何生产
 * 调用点**的死函数（隐藏页走的一直是 `.feedback-sheet` + `feedbackPasswordPanel()`）。
 * 死函数已整个删掉，三条腿改为直接打 `feedbackPasswordPanel()`：**那才是产线那条路**。
 * 判据一条没少、也没放宽 —— 只是把"被测对象"从死代码换成真代码。
 * ==================================================================== */

describe('口令框（产线那条路：feedbackPasswordPanel）', () => {
  it('输入 type=password、口令正确就回调 onOk（口令用完清空）', async () => {
    setup();
    const fake = FakeServer.empty().on(FEEDBACK_ENDPOINTS.login, 200, { ok: true });
    let okCount = 0;
    const root = asStub(feedbackPasswordPanel({
      onClose: () => { /* 本用例不关心 */ },
      onOk: () => { okCount += 1; },
      fetcher: fake,
    }));
    const input = one(root, 'password');
    expect(input.tag).toBe('input');
    // ⚠️ 桩不反射 `type` 这个 IDL 属性（产出入代码写的是 `setAttribute`）⇒ 按属性表读
    expect((input.getAttribute as (n: string) => string | null)('type'), '口令框不是 type=password').toBe('password');

    setValue(input, '某个口令');
    clickIn(one(root, 'password-ok'));
    await flush();
    const reqs = fake.to(FEEDBACK_ENDPOINTS.login);
    expect(reqs, '口令没发出去').toHaveLength(1);
    expect(reqs[0].method).toBe('POST');
    expect(reqs[0].credentials).toBe('same-origin');
    // 契约：登录那条是 JSON `{ password }`（口令只出现这一次，不落任何地方）
    expect(await readJsonBody(reqs[0].body)).toEqual({ password: '某个口令' });
    expect(okCount, '口令正确没有回调 onOk').toBe(1);
    expect((input as unknown as { value?: string }).value, '口令用完之后还留在输入框里').toBe('');
  });

  it('空口令不发请求（先提示"请先输入口令"）', async () => {
    setup();
    const fake = FakeServer.empty();
    const root = asStub(feedbackPasswordPanel({
      onClose: () => { /* 无关 */ },
      onOk: () => { /* 不该被调 */ },
      fetcher: fake,
    }));
    clickIn(one(root, 'password-ok'));
    await flush();
    expect(fake.reqs, '空口令也发了请求').toEqual([]);
    expect(one(root, 'password-status').text).toBe('请先输入口令。');
  });

  it('401（密码不对）：原样显示服务端那句，不回调 onOk', async () => {
    setup();
    const fake = FakeServer.empty().on(FEEDBACK_ENDPOINTS.login, 401, { ok: false, error: '密码不对' });
    let okCount = 0;
    const root = asStub(feedbackPasswordPanel({
      onClose: () => { /* 无关 */ },
      onOk: () => { okCount += 1; },
      fetcher: fake,
    }));
    setValue(one(root, 'password'), '猜的');
    clickIn(one(root, 'password-ok'));
    await flush();
    expect(one(root, 'password-status').text).toBe('密码不对');
    expect(one(root, 'password-status').dataset.kind).toBe('error');
    expect(okCount, '密码不对却还是放行了').toBe(0);
  });

  it('会话过期退回来时：`notice` 那句话写在状态行上（口令框唯一的提示通道）', async () => {
    setup();
    const root = asStub(feedbackPasswordPanel({
      onClose: () => { /* 无关 */ },
      onOk: () => { /* 无关 */ },
      fetcher: FakeServer.empty(),
      notice: '登录已过期，请重新输入口令。',
    }));
    expect(one(root, 'password-status').text).toBe('登录已过期，请重新输入口令。');
    expect(one(root, 'password-status').dataset.kind).toBe('info');
  });
});

/* ==================================================================== *
 * 4. 隐藏页：列表 / 详情 / 未读 / 已读 / 删除
 * ==================================================================== */

describe('隐藏页：列表 → 详情 → 返回', () => {
  it('起手永远是口令框（不做"上次登录过就直进列表"的记忆）', async () => {
    const fake = listServer();
    const { view, root } = makeView(fake);
    expect(view.currentScreen).toBe('password');
    expect(root.dataset.feedbackScreen).toBe('password');
    expect(byRole(root, 'password').length, '没有口令输入框').toBe(1);
    expect(fake.to(FEEDBACK_ENDPOINTS.list), '起手就去拉列表了（跳过口令）').toHaveLength(0);
  });

  it('口令正确 ⇒ 列表：GET /feedback/list，两张卡各带标题/徽章/作者/时间/附件数，顶部有"共 N 条 · 未读 M 条"', async () => {
    const fake = listServer();
    const { view, root } = makeView(fake);
    await enterList(view, root, fake);

    const req = fake.to(FEEDBACK_ENDPOINTS.list);
    expect(req).toHaveLength(1);
    expect(req[0].method).toBe('GET');
    expect(req[0].credentials).toBe('same-origin');
    expect(byRole(root, 'grid').length, '列表不是那张卡片网格').toBe(1);
    expect(one(root, 'grid').cls, '网格类名不是复用的 rules-grid').toContain('rules-grid');
    expect(byRole(root, 'card').length, '两张卡渲染出来的数量不对').toBe(2);
    const text = textOf(root);
    for (const frag of ['自创协议「回声」', '点刷新会闪一下', '甲', '乙', '附件 1 份', '附件 0 份']) {
      expect(text, `列表里缺「${frag}」`).toContain(frag);
    }
    expect(one(root, 'count').text, '顶部读数不是"共 N 条 · 未读 M 条"').toBe('共 2 条 · 未读 1 条');
  });

  it('未读标识：未读那张卡带 feedback-card-unread 与「未读」徽章；已读那张两样都没有', async () => {
    const fake = listServer();
    const { view, root } = makeView(fake);
    await enterList(view, root, fake);
    const cards = byRole(root, 'card');
    const unread = cards.find((c) => c.dataset.feedbackId === 'f-1')!;
    const read = cards.find((c) => c.dataset.feedbackId === 'f-2')!;
    expect(unread.dataset.feedbackRead).toBe('false');
    expect(unread.cls, '未读那张卡没有左侧色条那个类').toContain('feedback-card-unread');
    // ⚠️ 不能拿"卡里出现过「未读」两个字"当判据：卡上那颗按钮的文案就是「标为未读」。
    //    判据落在**徽章节点**上（唯一那个出口）。
    const unreadBadge = (c: StubNode): StubNode[] =>
      descendants(c).filter((n) => n.cls.includes('feedback-unread-badge'));
    expect(unreadBadge(unread), '未读那张卡没有「未读」徽章').toHaveLength(1);
    expect(read.dataset.feedbackRead).toBe('true');
    expect(read.cls, '已读那张卡也带了未读样式').not.toContain('feedback-card-unread');
    expect(unreadBadge(read), '已读那张卡也带了未读徽章').toHaveLength(0);
  });

  it('点卡进详情：GET /feedback/item?id=…，正文全文/投稿人/时间/附件链接都在；返回能回列表', async () => {
    const fake = listServer();
    const { view, root } = makeView(fake);
    await enterList(view, root, fake);
    clickIn(byRole(root, 'card').find((c) => c.dataset.feedbackId === 'f-1')!);
    await flush();
    expect(view.currentScreen).toBe('detail');
    const req = fake.to(FEEDBACK_ENDPOINTS.item);
    expect(req, '详情没有按 id 拉那一条').toHaveLength(1);
    expect(req[0].url).toContain('id=f-1');
    const text = textOf(root);
    for (const frag of ['自创协议「回声」', '甲', '正文第一行。', '正文第二行。', '示意图.png', '2.0 KB']) {
      expect(text, `详情里缺「${frag}」`).toContain(frag);
    }
    // 附件是一个指向 /feedback/file 的 <a>（浏览器自己带 Cookie）
    const links = queryAllIn(root, 'a.feedback-file-link');
    expect(links, '附件不是可点开的链接').toHaveLength(1);
    const href = String((links[0].getAttribute as (n: string) => string | null)('href') ?? '');
    expect(href).toContain(FEEDBACK_ENDPOINTS.file);
    expect(href).toContain('id=f-1');
    expect(href).toContain(encodeURIComponent('示意图.png'));
    expect(links[0].text).toBe('示意图.png');

    clickIn(one(root, 'back'));
    await flush();
    expect(view.currentScreen).toBe('list');
    expect(byRole(root, 'card').length, '返回列表之后卡片没了').toBe(2);
  });

  it('打开详情**不自动**标已读（用户没说自动；不给服务端发 read 请求）', async () => {
    const fake = listServer();
    const { view, root } = makeView(fake);
    await enterList(view, root, fake);
    clickIn(byRole(root, 'card').find((c) => c.dataset.feedbackId === 'f-1')!);
    await flush();
    expect(view.currentScreen).toBe('detail');
    expect(fake.to(FEEDBACK_ENDPOINTS.read), '打开详情就自动标已读了（用户要求手动可控）').toHaveLength(0);
    const unreadBadge = descendants(one(root, 'detail')).find((n) => n.cls.includes('feedback-unread-badge'));
    expect(unreadBadge, '详情里那条本来是未读，却没有未读标记').toBeDefined();
  });

  it('列表为空时给一句人话（不是一片空白）', async () => {
    const fake = FakeServer.empty().on(FEEDBACK_ENDPOINTS.login, 200, { ok: true });
    const { view, root } = makeView(fake);
    await enterList(view, root, fake);
    expect(one(root, 'count').text).toBe('共 0 条 · 未读 0 条');
    expect(one(root, 'list-status').text).toContain('还没有收到任何反馈');
    expect(byRole(root, 'card')).toHaveLength(0);
  });
});

describe('隐藏页：标记已读 / 标回未读（就地更新，不整页重画）', () => {
  it('卡片上点「标记已读」⇒ POST /feedback/read {id,read:true}；卡**原地**变成已读，顶部未读数减一', async () => {
    const fake = listServer();
    const { view, root } = makeView(fake);
    await enterList(view, root, fake);
    const cardsBefore = byRole(root, 'card');
    const target = cardsBefore.find((c) => c.dataset.feedbackId === 'f-1')!;
    const readBtn = byRole(root, 'card-read').find((b) => b.dataset.feedbackId === 'f-1')!;
    expect(readBtn.text, '未读那条的按钮文案不是「标记已读」').toBe('标记已读');

    clickIn(readBtn);
    await flush();

    const req = fake.to(FEEDBACK_ENDPOINTS.read);
    expect(req, '标记已读没发请求').toHaveLength(1);
    expect(req[0].method).toBe('POST');
    expect(req[0].credentials).toBe('same-origin');
    // 请求体是 JSON `{ id, read }`（契约）—— 抓取层收到的是 Blob，这里按内容读回来
    const sent = await readJsonBody(req[0].body);
    expect(sent).toEqual({ id: 'f-1', read: true });
    // 就地更新：那张卡还是**同一个节点**（不是整页重画换掉一棵树）
    const targetAfter = byRole(root, 'card').find((c) => c.dataset.feedbackId === 'f-1')!;
    expect(targetAfter, '整页被重画了（卡片节点被换掉）').toBe(target);
    expect(targetAfter.cls, '标记已读之后左侧色条还在').not.toContain('feedback-card-unread');
    expect(targetAfter.dataset.feedbackRead).toBe('true');
    // ⚠️ 不能拿"卡里出现过「未读」两个字"当判据：那颗按钮的文案就是「标为未读」。
    expect(
      descendants(targetAfter).filter((n) => n.cls.includes('feedback-unread-badge')),
      '「未读」徽章没摘掉',
    ).toHaveLength(0);
    expect(one(root, 'count').text, '顶部未读数没跟着减').toBe('共 2 条 · 未读 0 条');
    expect(byRole(root, 'card').length, '卡片数量变了').toBe(2);
  });

  it('已读那条点「标为未读」⇒ read:false；卡原地变回未读、未读数加一（两向都能走）', async () => {
    const fake = listServer();
    const { view, root } = makeView(fake);
    await enterList(view, root, fake);
    const unreadBtn = byRole(root, 'card-read').find((b) => b.dataset.feedbackId === 'f-2')!;
    expect(unreadBtn.text, '已读那条的按钮文案不是「标为未读」').toBe('标为未读');
    clickIn(unreadBtn);
    await flush();
    expect(fake.to(FEEDBACK_ENDPOINTS.read)).toHaveLength(1);
    const card = byRole(root, 'card').find((c) => c.dataset.feedbackId === 'f-2')!;
    expect(card.cls).toContain('feedback-card-unread');
    expect(card.dataset.feedbackRead).toBe('false');
    expect(textOf(card), '标回未读之后没有「未读」徽章').toContain('未读');
    expect(one(root, 'count').text).toBe('共 2 条 · 未读 2 条');
    // 按钮文案也翻过来（再点一次会标回去）
    expect(byRole(root, 'card-read').find((b) => b.dataset.feedbackId === 'f-2')!.text).toBe('标记已读');
  });

  it('★ 同一张卡**连续点两次**：第一次 {read:true}、第二次必须 {read:false}（线上"死按钮"的正反向）', async () => {
    // ## 这条腿为什么必须存在（2026-10-01 线上验收抓出的真 bug）
    //
    // 修之前那颗按钮的 `click` 闭包捕获的是**建卡那一刻**的 `item`，而 `applyRead` 是**换一份
    // 新对象**放进 `this.items`（不原地改旧对象）⇒ `!item.read` 永远停在第一次的值
    // ⇒ 第二次点下去服务端**仍然收到 `{read:true}`**（按钮文案已经写着「标为未读」，点了却没反应）。
    // 判据必须落在**第二次请求的请求体**上 —— 只断"按钮文案变了"是抓不住它的（文案一直是好的）。
    const fake = listServer();
    const { view, root } = makeView(fake);
    await enterList(view, root, fake);
    const btn = (): StubNode => byRole(root, 'card-read').find((b) => b.dataset.feedbackId === 'f-1')!;
    expect(btn().text, '前置：这条本来是未读').toBe('标记已读');

    // ① 第一次：未读 → 已读
    clickIn(btn());
    await flush();
    expect(btn().text, '第一次点完之后按钮文案没翻').toBe('标为未读');
    expect(one(root, 'count').text).toBe('共 2 条 · 未读 0 条');

    // ② 第二次：已读 → **未读**（修之前这里会再发一次 `{read:true}`）
    clickIn(btn());
    await flush();
    const reqs = fake.to(FEEDBACK_ENDPOINTS.read);
    expect(reqs, '第二次点击没有发请求').toHaveLength(2);
    expect(await readJsonBody(reqs[0].body), '第一次的请求体').toEqual({ id: 'f-1', read: true });
    expect(await readJsonBody(reqs[1].body), '第二次的请求体 —— 捕获旧 item 时这里会是 {read:true}（死按钮）')
      .toEqual({ id: 'f-1', read: false });
    // ③ 屏上真的转回去了（不是只发了请求）
    expect(btn().text, '第二次点完之后按钮文案没翻回来').toBe('标记已读');
    const card = byRole(root, 'card').find((c) => c.dataset.feedbackId === 'f-1')!;
    expect(card.dataset.feedbackRead).toBe('false');
    expect(card.cls, '徽章/色条没回来').toContain('feedback-card-unread');
    expect(one(root, 'count').text, '未读数没加回来').toBe('共 2 条 · 未读 1 条');

    // ④ 第三次再走一遍（证明"两向都能反复走"，不是只有第一次是好的）
    clickIn(btn());
    await flush();
    const third = fake.to(FEEDBACK_ENDPOINTS.read)[2];
    expect(await readJsonBody(third.body), '第三次又退化成死按钮了').toEqual({ id: 'f-1', read: true });
    expect(one(root, 'count').text).toBe('共 2 条 · 未读 0 条');
  });

  it('★ 详情里连续点两次同理：{read:true} → {read:false}（同一处成因，详情那颗也在修的范围里）', async () => {
    const fake = listServer();
    const { view, root } = makeView(fake);
    await enterList(view, root, fake);
    clickIn(byRole(root, 'card').find((c) => c.dataset.feedbackId === 'f-1')!);
    await flush();

    clickIn(one(root, 'detail-read'));
    await flush();
    expect(one(root, 'detail-read').text).toBe('标为未读');
    clickIn(one(root, 'detail-read'));
    await flush();
    const reqs = fake.to(FEEDBACK_ENDPOINTS.read);
    expect(reqs).toHaveLength(2);
    expect(await readJsonBody(reqs[1].body), '详情里第二次点击的请求体 —— 捕获旧 item 时会是 {read:true}')
      .toEqual({ id: 'f-1', read: false });
    expect(one(root, 'detail-read').text, '详情里的按钮文案没翻回来').toBe('标记已读');
  });

  it('详情里也能标记已读：就地换徽章与按钮文案（不退回列表、不重画整页）', async () => {
    const fake = listServer();
    const { view, root } = makeView(fake);
    await enterList(view, root, fake);
    clickIn(byRole(root, 'card').find((c) => c.dataset.feedbackId === 'f-1')!);
    await flush();
    const detailBox = one(root, 'detail');
    clickIn(one(root, 'detail-read'));
    await flush();
    expect(view.currentScreen, '标记已读把用户踢出了详情').toBe('detail');
    expect(one(root, 'detail'), '详情那一块被整块换掉了').toBe(detailBox);
    expect(textOf(detailBox), '详情里的「未读」徽章没摘掉').not.toContain('未读');
    expect(one(root, 'detail-read').text, '详情里的按钮文案没翻成「标为未读」').toBe('标为未读');
    // 退回列表时列表那张卡也已经是已读（数据是同一份）
    clickIn(one(root, 'back'));
    await flush();
    expect(one(root, 'count').text).toBe('共 2 条 · 未读 0 条');
    expect(byRole(root, 'card').find((c) => c.dataset.feedbackId === 'f-1')!.cls).not.toContain('feedback-card-unread');
  });

  it('标记已读失败（500）⇒ 原样显示服务端中文原因，卡**不动**（不假成功）', async () => {
    const REASON = '这条反馈的状态没写成：稍后再试。';
    const fake = listServer().on(FEEDBACK_ENDPOINTS.read, 500, { ok: false, error: REASON });
    const { view, root } = makeView(fake);
    await enterList(view, root, fake);
    clickIn(byRole(root, 'card-read').find((b) => b.dataset.feedbackId === 'f-1')!);
    await flush();
    expect(one(root, 'list-status').text, '失败原因没原样显示').toBe(REASON);
    const card = byRole(root, 'card').find((c) => c.dataset.feedbackId === 'f-1')!;
    expect(card.cls, '请求失败了卡却变成了已读（假成功）').toContain('feedback-card-unread');
    expect(one(root, 'count').text, '失败却把未读数改了').toBe('共 2 条 · 未读 1 条');
  });
});

describe('隐藏页：删除（二次确认 + 成功后卡消失 + 计数更新）', () => {
  it('点一次「删除」只出确认行：**一个请求都不发**；点「取消」也不发', async () => {
    const fake = listServer();
    const { view, root } = makeView(fake);
    await enterList(view, root, fake);
    const del = byRole(root, 'card-delete').find((b) => b.dataset.feedbackId === 'f-1')!;
    const confirm = byRole(root, 'card-confirm').find((c) => c.dataset.feedbackId === 'f-1')!;
    expect(visible(confirm), '确认行一开始就该是收起的').toBe(false);

    clickIn(del);
    expect(fake.to(FEEDBACK_ENDPOINTS.delete), '还没确认就把删除发出去了').toHaveLength(0);
    expect(visible(confirm), '点「删除」之后确认行没有展开').toBe(true);
    expect(textOf(confirm), '确认行没说清后果（移入回收站不可在页面恢复）').toContain('回收站');
    expect(textOf(confirm)).toContain('确定删除');

    clickIn(byRole(root, 'card-delete-no').find((b) => b.dataset.feedbackId === 'f-1')!);
    expect(visible(confirm), '点「取消」之后确认行没收起来').toBe(false);
    expect(fake.to(FEEDBACK_ENDPOINTS.delete), '点「取消」居然发了删除请求').toHaveLength(0);
    expect(byRole(root, 'card'), '取消之后卡片少了').toHaveLength(2);
  });

  it('确认后 ⇒ POST /feedback/delete {id}；那张卡消失、总数与未读数都更新', async () => {
    const fake = listServer();
    const { view, root } = makeView(fake);
    await enterList(view, root, fake);
    clickIn(byRole(root, 'card-delete').find((b) => b.dataset.feedbackId === 'f-1')!);
    clickIn(byRole(root, 'card-delete-yes').find((b) => b.dataset.feedbackId === 'f-1')!);
    await flush();

    const req = fake.to(FEEDBACK_ENDPOINTS.delete);
    expect(req, '确认之后没发删除请求').toHaveLength(1);
    expect(req[0].method).toBe('POST');
    expect(req[0].info, '删除不该带提交那份元信息').toBeNull();
    const ids = byRole(root, 'card').map((c) => c.dataset.feedbackId);
    expect(ids, '被删的那张卡还在（或删错了别的）').toEqual(['f-2']);
    expect(one(root, 'count').text, '删除之后读数没更新（f-1 是未读，未读要减一）').toBe('共 1 条 · 未读 0 条');
    expect(one(root, 'list-status').text).toContain('已删除');
  });

  it('详情里删除 ⇒ 退回列表，且列表里已经没有那一条', async () => {
    const fake = listServer();
    const { view, root } = makeView(fake);
    await enterList(view, root, fake);
    clickIn(byRole(root, 'card').find((c) => c.dataset.feedbackId === 'f-2')!);
    await flush();
    expect(view.currentScreen).toBe('detail');
    clickIn(one(root, 'detail-delete'));
    expect(fake.to(FEEDBACK_ENDPOINTS.delete), '详情里点一次「删除」就发了请求（没二次确认）').toHaveLength(0);
    clickIn(one(root, 'detail-delete-yes'));
    await flush();
    expect(fake.to(FEEDBACK_ENDPOINTS.delete)).toHaveLength(1);
    expect(view.currentScreen, '详情里删掉之后没退回列表').toBe('list');
    expect(byRole(root, 'card').map((c) => c.dataset.feedbackId)).toEqual(['f-1']);
    expect(one(root, 'count').text, 'f-2 本来是已读，删掉它未读数不该变').toBe('共 1 条 · 未读 1 条');
  });

  it('删除失败（500）⇒ 原样显示中文原因，卡还在、计数不变、确认行收起', async () => {
    const REASON = '回收站写入失败：这条反馈没被删除。';
    const fake = listServer().on(FEEDBACK_ENDPOINTS.delete, 500, { ok: false, error: REASON });
    const { view, root } = makeView(fake);
    await enterList(view, root, fake);
    clickIn(byRole(root, 'card-delete').find((b) => b.dataset.feedbackId === 'f-1')!);
    clickIn(byRole(root, 'card-delete-yes').find((b) => b.dataset.feedbackId === 'f-1')!);
    await flush();
    expect(one(root, 'list-status').text, '失败原因没原样显示').toBe(REASON);
    expect(byRole(root, 'card'), '删除失败却把卡去掉了').toHaveLength(2);
    expect(one(root, 'count').text).toBe('共 2 条 · 未读 1 条');
    const confirm = byRole(root, 'card-confirm').find((c) => c.dataset.feedbackId === 'f-1')!;
    expect(visible(confirm), '失败之后确认行没收起来').toBe(false);
  });
});

describe('隐藏页：401（会话过期）一律退回口令框', () => {
  it('列表 401 ⇒ 退回口令框（并说清"未登录"那句原样显示）', async () => {
    // 口令通过、列表 401：这就是"Cookie 过期"那一刻的真实形态
    const fake = new FakeServer()
      .on(FEEDBACK_ENDPOINTS.login, 200, { ok: true })
      .on(FEEDBACK_ENDPOINTS.list, 401, { ok: false, error: '未登录' });
    const { view, root } = makeView(fake);
    await enterList(view, root, fake, false);
    expect(view.currentScreen, '列表 401 之后没退回口令框').toBe('password');
    expect(root.dataset.feedbackScreen).toBe('password');
    expect(byRole(root, 'password').length, '退回之后没有口令框').toBe(1);
    // 退回口令框时要在状态行上说清"为什么突然让我重新输口令"（不是静默跳回来）
    expect(one(root, 'password-status').text, '会话过期没有任何说明')
      .toContain('登录已过期');
  });

  it('详情 401 ⇒ 退回口令框', async () => {
    const fake = listServer();
    const { view, root } = makeView(fake);
    await enterList(view, root, fake);
    fake.on(FEEDBACK_ENDPOINTS.item, 401, { ok: false, error: '未登录' });
    clickIn(byRole(root, 'card').find((c) => c.dataset.feedbackId === 'f-1')!);
    await flush();
    expect(view.currentScreen, '详情 401 之后没退回口令框').toBe('password');
  });

  it('标记已读 401 ⇒ 退回口令框（与"会话过期"同一条路径）', async () => {
    const fake = listServer();
    const { view, root } = makeView(fake);
    await enterList(view, root, fake);
    fake.on(FEEDBACK_ENDPOINTS.read, 401, { ok: false, error: '未登录' });
    clickIn(byRole(root, 'card-read').find((b) => b.dataset.feedbackId === 'f-1')!);
    await flush();
    expect(view.currentScreen, 'read 401 之后没退回口令框').toBe('password');
    expect(root.dataset.feedbackScreen).toBe('password');
  });

  it('删除 401 ⇒ 退回口令框（与"会话过期"同一条路径）', async () => {
    const fake = listServer();
    const { view, root } = makeView(fake);
    await enterList(view, root, fake);
    fake.on(FEEDBACK_ENDPOINTS.delete, 401, { ok: false, error: '未登录' });
    clickIn(byRole(root, 'card-delete').find((b) => b.dataset.feedbackId === 'f-1')!);
    clickIn(byRole(root, 'card-delete-yes').find((b) => b.dataset.feedbackId === 'f-1')!);
    await flush();
    expect(view.currentScreen, 'delete 401 之后没退回口令框').toBe('password');
    // 退回之后还能重新登录（不是一次性的死态）
    setValue(one(root, 'password'), '口令');
    clickIn(one(root, 'password-ok'));
    await flush();
    expect(view.currentScreen, '退回口令框之后登不回去了').toBe('list');
  });

  it('退回口令框之后，在途的旧响应不会再改屏（generation 闸门）', async () => {
    const fake = listServer();
    const { view, root } = makeView(fake);
    await enterList(view, root, fake);
    fake.on(FEEDBACK_ENDPOINTS.delete, 401, { ok: false, error: '未登录' });
    clickIn(byRole(root, 'card-delete').find((b) => b.dataset.feedbackId === 'f-1')!);
    clickIn(byRole(root, 'card-delete-yes').find((b) => b.dataset.feedbackId === 'f-1')!);
    await flush();
    expect(view.currentScreen).toBe('password');
    // 再等一拍：若旧回调还会写屏，口令框会被"列表"或一句话顶掉
    await flush();
    expect(view.currentScreen, '晚到的旧回调把屏又改了').toBe('password');
    expect(byRole(root, 'password').length).toBe(1);
  });
});

/* ==================================================================== *
 * 5. Ctrl+Shift+O：只在首页 + 不在输入框里 + 不 preventDefault
 * ==================================================================== */

describe('Ctrl+Shift+O：只在首页生效，且不泄漏监听器', () => {
  /** 造一个按键事件（`preventDefault` 是否被调过，用这个读数看） */
  function key(over: Record<string, unknown> = {}): { ev: Record<string, unknown>; prevented: () => number } {
    let prevented = 0;
    const ev: Record<string, unknown> = {
      ctrlKey: true,
      shiftKey: true,
      code: 'KeyO',
      key: 'O',
      target: null,
      preventDefault: () => { prevented += 1; },
      ...over,
    };
    return { ev, prevented: () => prevented };
  }

  it('纯判据：只有 Ctrl+Shift+O 才算（Alt/Meta/长按重复都不算）', () => {
    expect(isFeedbackShortcut({ ctrlKey: true, shiftKey: true, code: 'KeyO' })).toBe(true);
    expect(isFeedbackShortcut({ ctrlKey: true, shiftKey: true, code: 'KeyP' }), 'Ctrl+Shift+P 是开发者模式的').toBe(false);
    expect(isFeedbackShortcut({ ctrlKey: true, code: 'KeyO' })).toBe(false);
    expect(isFeedbackShortcut({ shiftKey: true, code: 'KeyO' })).toBe(false);
    expect(isFeedbackShortcut({ ctrlKey: true, shiftKey: true, altKey: true, code: 'KeyO' })).toBe(false);
    expect(isFeedbackShortcut({ ctrlKey: true, shiftKey: true, metaKey: true, code: 'KeyO' })).toBe(false);
    expect(isFeedbackShortcut({ ctrlKey: true, shiftKey: true, code: 'KeyO', repeat: true })).toBe(false);
  });

  it('纯判据：输入框 / textarea / select / contenteditable 里打字都算"在打字"', () => {
    const input = makeStubEl('input');
    const area = makeStubEl('textarea');
    const sel = makeStubEl('select');
    const span = makeStubEl('span');
    const editable = makeStubEl('div');
    (editable.setAttribute as (n: string, v: string) => void)('contenteditable', 'true');
    expect(isTypingTarget(input)).toBe(true);
    expect(isTypingTarget(area)).toBe(true);
    expect(isTypingTarget(sel)).toBe(true);
    expect(isTypingTarget(editable)).toBe(true);
    expect(isTypingTarget(span)).toBe(false);       // 普通元素不是打字目标
    expect(isTypingTarget(null)).toBe(false);
    // 输入框**里面**那个子节点也要算（事件目标是 input 里的节点时同样不许触发）
    const inner = makeStubEl('span');
    input.appendChild(inner);
    expect(isTypingTarget(inner), '事件目标在输入框内部时没被拦住').toBe(true);
  });

  it('首页判定：`#app` 上有 screen-home 才算首页（`clearRoot` 摘掉它之后就不是）', () => {
    setup({ home: true });
    expect(isHomeScreenActive()).toBe(true);
    const doc = (globalThis as unknown as { document: { getElementById: (id: string) => StubNode | null } }).document;
    doc.getElementById('app')!.classList.remove('screen-home');
    expect(isHomeScreenActive(), '离开首页（类被摘掉）之后还当自己是首页').toBe(false);
  });

  it('首页按 Ctrl+Shift+O ⇒ 打开隐藏页的口令框；**不** preventDefault', async () => {
    const win = setup({ home: true });
    const off = initFeedbackShortcut({ fetcher: listServer() });
    expect(win.keydown.length, '监听器没挂上').toBe(1);
    const { ev, prevented } = key();
    for (const fn of [...win.keydown]) fn(ev);
    await flush();
    expect(byRoleBody('password'), '按了 Ctrl+Shift+O 没出口令框').toHaveLength(1);
    expect(prevented(), 'Ctrl+Shift+O 在浏览器里没有既有用途 ⇒ 不该拦默认行为').toBe(0);
    off();
    closeHiddenView();
  });

  it('别的页面上按同一个组合键：打不开（`screen-home` 不在 `#app` 上）', async () => {
    const win = setup({ home: false });
    const off = initFeedbackShortcut({ fetcher: listServer() });
    const { ev } = key();
    for (const fn of [...win.keydown]) fn(ev);
    await flush();
    expect(byRoleBody('password'), '不在首页也把隐藏页打开了').toHaveLength(0);
    off();
  });

  it('在输入框里按同一个组合键：不触发（用户要求"输入框里打字不要误触发"）', async () => {
    const win = setup({ home: true });
    const off = initFeedbackShortcut({ fetcher: listServer() });
    const box = makeStubEl('input');
    const { ev } = key({ target: box });
    for (const fn of [...win.keydown]) fn(ev);
    await flush();
    expect(byRoleBody('password'), '在输入框里按也触发了').toHaveLength(0);
    off();
  });

  it('不是那个组合键（Ctrl+Shift+P / 只按 Ctrl+O）：打不开', async () => {
    const win = setup({ home: true });
    const off = initFeedbackShortcut({ fetcher: listServer() });
    for (const fn of [...win.keydown]) fn(key({ code: 'KeyP', key: 'P' }).ev);
    // ⚠️ `key()` 的缺省里 `shiftKey: true` ⇒ 这一句必须**显式**把它按下去，否则这条事件
    //    正好就是 `Ctrl+Shift+O`（实测踩过：夹具自己把隐藏页打开了，判据反而变成"它打开了"）。
    for (const fn of [...win.keydown]) fn(key({ ctrlKey: true, shiftKey: false, code: 'KeyO', key: 'o' }).ev);
    await flush();
    expect(byRoleBody('password')).toHaveLength(0);
    off();
  });

  it('卸载之后监听器真的没了（页面切走不该残留），且重复初始化不会叠出两个', async () => {
    const win = setup({ home: true });
    const fake = listServer();
    const off1 = initFeedbackShortcut({ fetcher: fake });
    const off2 = initFeedbackShortcut({ fetcher: fake });
    expect(win.keydown.length, '重复初始化叠出了第二个监听器').toBe(1);
    off1(); // 旧的那个已经不在表里 ⇒ 不该把新那个也撤掉
    expect(win.keydown.length, '撤旧的那次把新的也撤了').toBe(1);
    off2();
    expect(win.keydown.length, '卸载之后监听器还挂着（泄漏）').toBe(0);
    // 卸载之后按也没反应
    const { ev } = key();
    for (const fn of [...win.keydown]) fn(ev);
    await flush();
    expect(byRoleBody('password')).toHaveLength(0);
  });

  it('已经开着浮层时不再叠第二层（口令框只有一个）', async () => {
    const win = setup({ home: true });
    const off = initFeedbackShortcut({ fetcher: listServer() });
    for (const fn of [...win.keydown]) fn(key().ev);
    for (const fn of [...win.keydown]) fn(key().ev);
    await flush();
    expect(byRoleBody('password'), '按两次叠出了两个口令框').toHaveLength(1);
    off();
    closeHiddenView();
  });

  it('隐藏页起手那一层挂在 document.body 上（不是往首页那棵树里塞）', async () => {
    const win = setup({ home: true });
    const off = initFeedbackShortcut({ fetcher: listServer() });
    for (const fn of [...win.keydown]) fn(key().ev);
    await flush();
    const overlays = descendants(bodyStub()).filter((n) => n.cls.includes('feedback-overlay'));
    expect(overlays, '隐藏页那一层不在 document.body 上').toHaveLength(1);
    off();
    closeHiddenView();
  });
});

/* ==================================================================== *
 * 6. 样式腿：`feedback-*` 新类名与 5 张既有 CSS 零同名（生成式自检）
 *
 * 与 `tests/ui/local-data-screen.test.ts` 那条"新类名不冲突"的腿**同款**（那条只扫
 * `local-data-*`，覆盖不到本任务新加的 `feedback-*`）。`styles.css` 是红线：一个字节都没动，
 * 下面这些名字在那 5 张既有 CSS 里必须零命中，否则那道屏的视觉会连带变化。
 * ==================================================================== */

describe('样式腿：feedback-* 新类名不与既有 CSS 冲突', () => {
  const css = readFileSync(fileURLToPath(new URL('../../src/ui/styles-local.css', import.meta.url)))
    .subarray(0, 512 * 1024).toString('utf8');
  /** 本任务新增的类名（**生成式派生**：从 styles-local.css 里采 `feedback-*` 的选择器） */
  const mine = [...new Set([...css.matchAll(/\.(feedback-[A-Za-z0-9_-]+)/g)].map((m) => m[1]))].sort();
  /** 5 张**既有** CSS（本任务一个字节都不许改它们） */
  const EXISTING = [
    'styles.css', 'styles-gen3.css', 'styles-gen3-cards.css', 'styles-gen3-sync.css', 'styles-net.css',
  ];

  it('锚点：styles-local.css 里真的有一批 feedback-* 类（否则下面的判据在空集上恒真）', () => {
    expect(mine.length, 'styles-local.css 里没有 feedback-* 类').toBeGreaterThan(20);
    for (const reserved of ['feedback-overlay', 'feedback-card', 'feedback-wrap']) {
      expect(mine, `少了 .${reserved}`).toContain(reserved);
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

  it('红线 styles.css 与 git HEAD 逐字节相同（取不到 HEAD 时跳过，不假绿）', () => {
    let head: string;
    try {
      const repo = fileURLToPath(new URL('../../', import.meta.url)).replace(/[\\/]+$/, '');
      head = execFileSync('git', ['show', 'HEAD:src/ui/styles.css'], { cwd: repo, encoding: 'utf8' });
    } catch {
      console.log('[样式腿] 取不到 HEAD:src/ui/styles.css（无 git / 浅克隆）⇒ 这条本次跳过');
      return;
    }
    const now = readFileSync(fileURLToPath(new URL('../../src/ui/styles.css', import.meta.url)))
      .subarray(0, 1024 * 1024).toString('utf8');
    expect(now.length, 'styles.css 与 HEAD 长度不同 ⇒ 红线被动过').toBe(head.length);
    expect(now === head, 'styles.css 与 HEAD 内容不同 ⇒ 红线被动过').toBe(true);
  });
});
