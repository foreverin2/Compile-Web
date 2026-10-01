/**
 * ★ 2026-10-01（用户要求）：「反馈」功能的前端（表单 + 隐藏页）。
 *
 * ## 用户原话要点（2026-10-01）
 *
 * 1. 「首页左上角加一个「反馈」按钮」——入口在 `src/ui/home.ts` 的 `renderHome`（本文件提供
 *    「点开之后是什么」）。
 * 2. 「点开后有**两种操作**：① 投稿自定义协议 ② bug 反馈」——屏上两个切换按钮。
 * 3. 「两者填写格式一样：简要标题 / 投稿人（反馈人）/ 协议与卡牌的说明文本（具体的 bug 现象
 *    或反馈意见）」——标题 / 作者 / 正文三行；两档只有**标签文案**不同。
 * 4. 「可选附件：常见图片（pdf/jpg/png…）或常见文本（txt/markdown…），每份 ≤10MB，
 *    每个 IP 每天最多 5 份文件」——10MB 与 5 份在本地预检（`feedback-core.ts`），
 *    "每 IP 每天 5 份"由**服务端**强制，前端只把服务端那句中文原因原样显示。
 *    ⚠️ **2026-10-01 当天改口径**：那条限额现在是「**每天最多提交 5 份**」（按提交次数，
 *    不按附件个数）；**单次提交最多 5 个附件**（`FEEDBACK_MAX_FILES`）保持不变，是另一件事。
 * 5. 「首页按 `Ctrl+Shift+O` 打开一个口令输入框（正常情况下界面上不要出现任何提示/入口），
 *    输入正确口令后进入隐藏页」——`initFeedbackShortcut()` + 口令浮层。
 * 6. 「隐藏页样式参考「查看规则文档」那一页（卡片网格 + 点击看详情）」——网格复用既有的
 *    `.rules-grid` / `.rules-item` / `.rules-info` / `.rules-title` / `.rules-desc`
 *    （`styles.css` 里那几条，本文件只加 `feedback-*` 新类做微调，红线一行不动）。
 * 7. 「每条反馈像规则书那样一张卡显示，点击可查看详细信息（含附件列表，能点开看/下载）」
 *    ——卡片 → 详情视图 → 返回列表。
 * 8. ★ 2026-10-01 当天追加：「隐藏页想加删除/标记已读」。
 * 9. ★ 2026-10-01 当天追加（提交成功后的行为）：用户原话「显示「提交成功」，**然后回到首页面**」
 *    ⇒ 状态行先写「提交成功…」，`FEEDBACK_SUCCESS_CLOSE_MS` 之后**自动关闭浮层**
 *    （浮层挂在首页之上 ⇒ 关掉它就等于回到首页；**首页那棵树一个字节都不重画**）。
 *    定时器可取消：见 `FeedbackFormHandle.cancelAutoClose` 与 `openFeedbackOverlay` 的 `close()`。
 *
 * ## 契约（**不许改**，见任务书）
 *
 * `POST /feedback/submit`（multipart）、`POST /feedback/login`（JSON `{password}`，成功后
 * HttpOnly Cookie）、`GET /feedback/list`、`GET /feedback/item?id=`、`GET /feedback/file?id=&name=`。
 * 未登录一律 401 `{ ok:false, error:'未登录' }` ⇒ 退回口令框。
 *
 * ⚠️ 前端**不存也拿不到任何 token**：登录只把用户输入的口令 POST 上去，之后靠
 * `credentials: 'same-origin'` 让浏览器自动带 Cookie。口令一个字节都不留在本文件里
 * （不写 storage、不进模块级变量；用完立刻把输入框清空）。
 *
 * ## 浮层做法（沿用仓库既有那套）
 *
 * 与 `settingsOverlayElement()` / `openRulePages()`（均在 `home.ts`）同款：函数只**造**元素
 * （可单测、不依赖某个宿主），挂到 `document.body` 由本文件的 `openFeedbackOverlay()` /
 * `openHiddenView()` 统一收尾。新版式全部落在 `src/ui/styles-local.css` 的 `feedback-*` 类上。
 */

import {
  FEEDBACK_ACCEPT,
  FEEDBACK_AUTHOR_LABELS,
  FEEDBACK_BODY_LABELS,
  FEEDBACK_BODY_PLACEHOLDERS,
  FEEDBACK_ENDPOINTS,
  FEEDBACK_KIND_BADGES,
  FEEDBACK_KIND_LABELS,
  FEEDBACK_KINDS,
  FEEDBACK_MAX_FILES,
  FEEDBACK_OFFLINE_TEXT,
  FEEDBACK_PASSWORD_FAIL_TEXT,
  FEEDBACK_READ_FAIL_TEXT,
  FEEDBACK_SESSION_EXPIRED_TEXT,
  FEEDBACK_SUBMIT_OK_TEXT,
  FEEDBACK_SUCCESS_CLOSE_MS,
  buildDeleteBody,
  buildLoginBody,
  buildReadBody,
  buildSubmitForm,
  checkFileSelection,
  feedbackCountText,
  feedbackFileHref,
  feedbackItemHref,
  feedbackMissingText,
  formatBytes,
  formatCreatedAt,
  hasMissing,
  missingFields,
  readActionOk,
  readItem,
  readList,
  readLoginOk,
  readSubmit,
  requestJson,
  type FeedbackAttachment,
  type FeedbackDetail,
  type FeedbackFetcher,
  type FeedbackFileMeta,
  type FeedbackKind,
  type FeedbackListItem,
} from './feedback-core';
// 宿主要的那一个抓取层（浏览器自带的 `fetch`；**唯一** import 它的地方是 `src/main.ts`）。
// 从这里再导一次：宿主只认识本模块一个入口，不必知道 core 的存在。
export { browserFeedbackFetcher } from './feedback-core';

/* =====================================================================
 * 最小建节点工具（本文件自带一份，与 `changelog.ts` 同款做法：
 * 不引 `home.ts` 的私有 helper —— 那会把这一屏与首页的改动静默绑在一起）
 * ===================================================================== */

function el(tag: string, cls: string, text?: string): HTMLElement {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function button(cls: string, label: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button') as HTMLButtonElement;
  b.className = cls;
  b.setAttribute('type', 'button');
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}

/**
 * 卡片**内部**那些小按钮（标记已读 / 删除 / 确认 / 取消）的点击处理。
 *
 * ⚠️ 为什么必须 `stopPropagation`：卡片本身挂着一个"点开详情"的 `click` 监听器
 * （用户要求"点击可查看详细信息"），而卡片里的按钮是它的**后代** —— 点按钮时事件会
 * 一路冒到卡片上，于是"点『标记已读』"会顺手把用户送进详情页（实测：详情请求真的发了）。
 * 真浏览器里就是这个语义（冒泡），所以要在按钮这一层把冒泡掐断。
 *
 * ⚠️ 用 `typeof ev.stopPropagation === 'function'` 而不是直接调：本仓的 DOM 桩
 * （`tests/ui/net-dom-stub.ts`）派发的事件对象**没有**这个方法，直接调会在桩上抛
 * `TypeError`（那是桩的缺口，不该由产出代码的形状来背）。浏览器里它必然存在、必然被调到。
 */
function actionButton(cls: string, label: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button') as HTMLButtonElement;
  b.className = cls;
  b.setAttribute('type', 'button');
  b.textContent = label;
  b.addEventListener('click', (ev) => {
    const stop = (ev as unknown as { stopPropagation?: unknown }).stopPropagation;
    if (typeof stop === 'function') {
      (stop as () => void).call(ev);
    }
    onClick();
  });
  return b;
}

/** `data-role` 是屏上每个可操作点的**机器可读**出口（测试按它定位，不按文案） */
function role(e: HTMLElement, name: string): HTMLElement {
  e.dataset.role = name;
  return e;
}

/* =====================================================================
 * 表单浮层（两种操作 + 附件）
 * ===================================================================== */

/**
 * 「反馈」表单浮层的**返回值（句柄）**。
 *
 * 为什么不是直接返回 `HTMLElement`（★ 2026-10-01 改口径时改的）：提交成功后浮层会**自动关闭**，
 * 那意味着本层手里有一个**待执行的定时器**——而"关掉浮层"这件事由宿主做（`openFeedbackOverlay`
 * 里那个 `close()`）⇒ 宿主必须能把这个定时器**取消**掉。光给一个 `HTMLElement` 的话，
 * 宿主没有取消的入口，"用户在一秒内自己点了关闭"就会留下一个到点还会跑的悬挂定时器
 * （用户 2026-10-01 明确要求"定时器要能被清理，不要留下会报错的悬挂定时器"）。
 */
export interface FeedbackFormHandle {
  /** 浮层本体（宿主挂到 `document.body`） */
  readonly element: HTMLElement;
  /**
   * 取消"成功后自动关闭"那个**待执行的**定时器。
   *
   * 幂等、可以随便调：没排过 / 已经跑完 / 已经取消过 ⇒ 都是 no-op（不会误关浮层）。
   */
  cancelAutoClose(): void;
}

/**
 * 「反馈」表单浮层（用户点首页那个按钮之后看到的那一层）。
 *
 * 三件事都在这里：两种类型的切换、三行必填的校验、提交中/成功/失败三种状态。
 * 服务端那句中文原因（尤其 429 的"今天已达上限"那句）**原样**进状态行。
 *
 * ## 提交成功之后（★ 2026-10-01 用户改口径）
 *
 * 用户原话：「显示「提交成功」，然后回到首页面」⇒ 状态行先写
 * `${FEEDBACK_SUBMIT_OK_TEXT}。编号：…`，**再等 `FEEDBACK_SUCCESS_CLOSE_MS` 毫秒自动关闭**浮层
 * （浮层是挂在首页之上的 ⇒ 关掉它就等于回到首页，首页那棵树一个字节都不重画）。
 * 关掉浮层的路径有两条，**两条都会先把定时器取消**：
 *  - 自动（到点）：定时器自己跑一次，跑之前把它自己从"待执行"里摘掉；
 *  - 手动（关掉按钮 / 点遮罩空白处 / 宿主按 Esc / 宿主换页）：走 `requestClose()`，它先取消再关。
 */
export function feedbackFormElement(nav: {
  readonly onClose: () => void;
  /**
   * 提交成功之后的**通知**（缺省什么都不做）。
   *
   * 为什么留这个口子：用户要的是"提交后内容汇总进服务器上的隐藏页"，
   * 而"提交完要不要顺手刷新隐藏页"只有宿主知道（它知道隐藏页此刻开着没有）。
   * ⚠️ 它**不改变**"随后自动关闭"这件事 —— 那条是用户点的行为，不论有没有这个回调都发生。
   */
  readonly onSubmitted?: (id: string) => void;
  readonly fetcher: FeedbackFetcher;
  /**
   * 排一个"延迟后执行"的定时器，返回**取消函数**（缺省用 `globalThis.setTimeout`）。
   *
   * 为什么做成可注入：这条行为有一个"到点才发生"的部分（自动关闭），而不注入的话测试只能
   * 真的等 1.2 秒或者去戳全局定时器。注入之后"延迟值是多少 / 到点调的是哪条路径 / 提前关掉
   * 之后有没有被取消"这三件事都能**当场**断言（同 `fetcher` / `FilePicker` 的注入理由）。
   */
  readonly scheduleClose?: (fn: () => void, delayMs: number) => () => void;
}): FeedbackFormHandle {
  let kind: FeedbackKind = 'protocol';
  let files: FeedbackAttachment[] = [];
  let busy = false;
  /** 默认的调度器：`globalThis.setTimeout`（浏览器里就是 `window.setTimeout`） */
  const schedule: (fn: () => void, delayMs: number) => () => void = nav.scheduleClose
    ?? ((fn, delayMs) => {
      const id = globalThis.setTimeout(fn, delayMs);
      return () => { globalThis.clearTimeout(id); };
    });
  /** 待执行的"成功后自动关闭"（`null` = 没有；非 null 时**唯一**，连点两次提交不会叠） */
  let autoCloseCancel: (() => void) | null = null;

  /** 取消待执行的自动关闭（幂等；跑完/取消过之后再调是 no-op） */
  function cancelAutoClose(): void {
    const cancel = autoCloseCancel;
    autoCloseCancel = null;
    if (cancel !== null) cancel();
  }

  /**
   * 关闭浮层（**唯一**的内部出口）：先取消自动关闭定时器，再交给宿主 `nav.onClose()`。
   * 三条手动路径（右上角「关闭」/ 点遮罩空白处 / 宿主 Esc）全走它。
   */
  function requestClose(): void {
    cancelAutoClose();
    nav.onClose();
  }

  /** 提交成功之后：先让「提交成功」留在屏上，再排一个到点关闭 */
  function scheduleAutoClose(): void {
    cancelAutoClose(); // 幂等：万一已经有排着的，先撤掉再排（连点两次提交不会叠出两个定时器）
    let fired = false;
    const cancel = schedule(() => {
      fired = true;
      autoCloseCancel = null; // 已经跑过了 ⇒ 再调 cancelAutoClose 不该再做什么
      nav.onClose();
    }, FEEDBACK_SUCCESS_CLOSE_MS);
    autoCloseCancel = () => {
      if (fired) return;
      fired = true;
      cancel();
    };
  }

  const overlay = el('div', 'feedback-overlay');
  const dialog = el('div', 'feedback-panel');
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-label', '反馈');

  const head = el('div', 'feedback-head');
  head.appendChild(el('div', 'feedback-title', '反馈'));
  head.appendChild(button('btn feedback-close', '关闭', () => { requestClose(); }));
  dialog.appendChild(head);

  /* ── 两种操作（用户原话：① 投稿自定义协议 ② bug 反馈）── */
  const chips = el('div', 'feedback-kind-chips');
  const chipButtons = new Map<FeedbackKind, HTMLButtonElement>();
  for (const k of FEEDBACK_KINDS) {
    const chip = button('draft-filter-chip feedback-chip', FEEDBACK_KIND_LABELS[k], () => { applyKind(k); });
    role(chip, `kind-${k}`);
    chip.dataset.feedbackKind = k;
    chipButtons.set(k, chip);
    chips.appendChild(chip);
  }
  dialog.appendChild(chips);
  const kindHint = el('div', 'feedback-hint', '');
  dialog.appendChild(kindHint);

  const titleLabel = el('div', 'feedback-label', '简要标题');
  const titleInput = document.createElement('input');
  titleInput.className = 'feedback-input';
  role(titleInput, 'title');
  titleInput.setAttribute('type', 'text');
  titleInput.setAttribute('maxlength', '120');
  titleInput.placeholder = '一句话说清这次反馈是关于什么的';
  const titleRow = el('div', 'feedback-field');
  titleRow.appendChild(titleLabel);
  titleRow.appendChild(titleInput);

  const authorLabel = el('div', 'feedback-label', '投稿人');
  authorLabel.dataset.feedbackAuthorLabel = '1';
  const authorInput = document.createElement('input');
  authorInput.className = 'feedback-input';
  role(authorInput, 'author');
  authorInput.setAttribute('type', 'text');
  authorInput.setAttribute('maxlength', '60');
  const authorRow = el('div', 'feedback-field');
  authorRow.appendChild(authorLabel);
  authorRow.appendChild(authorInput);

  const bodyLabel = el('div', 'feedback-label', '协议与卡牌的说明文本');
  bodyLabel.dataset.feedbackBodyLabel = '1';
  const bodyInput = document.createElement('textarea');
  bodyInput.className = 'feedback-textarea';
  role(bodyInput, 'body');
  bodyInput.rows = 8;
  const bodyRow = el('div', 'feedback-field');
  bodyRow.appendChild(bodyLabel);
  bodyRow.appendChild(bodyInput);

  /** 切换两档：按钮高亮 + 三处标签文案（标题那行两档同字，不动） */
  function applyKind(next: FeedbackKind): void {
    kind = next;
    for (const [k, b] of chipButtons) {
      b.classList.toggle('feedback-chip-on', k === kind);
      b.setAttribute('aria-pressed', k === kind ? 'true' : 'false');
    }
    kindHint.textContent = kind === 'protocol'
      ? '投稿自定义协议：写清协议名、卡牌与效果结算方式。'
      : 'bug 反馈：写清在哪一屏、点了什么、期望与实际分别是什么。';
    authorLabel.textContent = FEEDBACK_AUTHOR_LABELS[kind];
    bodyLabel.textContent = FEEDBACK_BODY_LABELS[kind];
    authorInput.placeholder = kind === 'protocol' ? '投稿人署名（必填）' : '反馈人署名（必填）';
    bodyInput.placeholder = FEEDBACK_BODY_PLACEHOLDERS[kind];
  }

  /* ── 附件（可选；本地预检）── */
  const fileField = el('div', 'feedback-field');
  fileField.appendChild(el('div', 'feedback-label', '附件（可选）'));
  const fileInput = document.createElement('input');
  fileInput.className = 'feedback-file';
  role(fileInput, 'files');
  fileInput.setAttribute('type', 'file');
  fileInput.setAttribute('multiple', 'multiple');
  fileInput.setAttribute('accept', FEEDBACK_ACCEPT.join(','));
  fileField.appendChild(fileInput);
  fileField.appendChild(
    el(
      'div',
      'feedback-hint',
      `常见图片（pdf/jpg/png…）或常见文本（txt/markdown…）；每份 ≤10MB，一次最多 ${FEEDBACK_MAX_FILES} 份。`,
    ),
  );
  const fileList = el('div', 'feedback-files');
  role(fileList, 'file-list');
  fileField.appendChild(fileList);
  const removeAll = button('btn feedback-remove', '清空附件', () => { files = []; refreshFiles(); });
  role(removeAll, 'file-clear');
  fileField.appendChild(removeAll);

  function refreshFiles(): void {
    fileList.replaceChildren();
    removeAll.hidden = files.length === 0;
    if (files.length === 0) {
      fileList.appendChild(el('div', 'feedback-hint', '还没有选择附件。'));
      return;
    }
    files.forEach((f, index) => {
      const row = el('div', 'feedback-file-row');
      row.appendChild(el('span', 'feedback-file-name', f.name));
      row.appendChild(el('span', 'feedback-file-size', formatBytes(f.size)));
      const del = button('btn feedback-remove', '移除', () => {
        files = files.filter((_, i) => i !== index);
        refreshFiles();
      });
      role(del, 'file-remove');
      row.appendChild(del);
      fileList.appendChild(row);
    });
  }

  /* ── 状态行（这一屏唯一的提示通道）── */
  const status = el('div', 'feedback-status');
  role(status, 'status');
  status.dataset.kind = 'none';
  const say = (text: string, level: 'info' | 'ok' | 'warn' | 'error' | 'none'): void => {
    status.textContent = text;
    status.dataset.kind = level;
  };

  const submit = button('btn feedback-primary', '提交', () => { void doSubmit(); });
  role(submit, 'submit');
  const submitRow = el('div', 'feedback-actions');
  submitRow.appendChild(submit);
  dialog.appendChild(titleRow);
  dialog.appendChild(authorRow);
  dialog.appendChild(bodyRow);
  dialog.appendChild(fileField);
  dialog.appendChild(submitRow);
  dialog.appendChild(status);
  overlay.appendChild(dialog);

  fileInput.addEventListener('change', () => {
    const picked = readInputFiles(fileInput);
    if (picked.length === 0) return;
    const check = checkFileSelection(picked);
    files = check.kept.map((f) => ({ name: f.name, size: f.size, file: f.file }));
    refreshFiles();
    // 预检的话**原样**说给用户（可能同时有"超过 10MB 已跳过"与"超过 5 份"两句）
    if (check.notice !== '') say(check.notice, 'warn');
    else say(`已选择 ${files.length} 份附件。`, 'info');
  });

  const setBusy = (on: boolean): void => {
    busy = on;
    submit.disabled = on;
    submit.textContent = on ? '正在提交…' : '提交';
  };

  async function doSubmit(): Promise<void> {
    if (busy) return;
    const title = titleInput.value;
    const author = authorInput.value;
    const body = bodyInput.value;
    const missing = missingFields({ title, author, body });
    if (hasMissing(missing)) {
      // 必填校验：只标红缺的那几行（不重画整屏，用户已经写的字一个不丢）
      titleRow.classList.toggle('feedback-field-bad', missing.title);
      authorRow.classList.toggle('feedback-field-bad', missing.author);
      bodyRow.classList.toggle('feedback-field-bad', missing.body);
      say(feedbackMissingText(missing), 'error');
      return;
    }
    titleRow.classList.remove('feedback-field-bad');
    authorRow.classList.remove('feedback-field-bad');
    bodyRow.classList.remove('feedback-field-bad');
    setBusy(true);
    say('正在提交…', 'info');
    const outcome = await requestJson(
      nav.fetcher,
      'POST',
      FEEDBACK_ENDPOINTS.submit,
      buildSubmitForm({ kind, title, author, body, files }),
      { kind, title, author, body, files: files.map((f) => ({ name: f.name, size: f.size })) },
    );
    setBusy(false);
    if (!outcome.ok) {
      // 服务端的中文原因**原样**显示（尤其 429 的"今天已达上限"那句）
      say(outcome.text, 'error');
      return;
    }
    const reading = readSubmit(outcome.json, FEEDBACK_READ_FAIL_TEXT);
    if (!reading.ok) {
      say(reading.error, 'error');
      return;
    }
    // ★ 2026-10-01 用户改口径：状态行先出现「提交成功」（必须含这四个字），随后自动关闭浮层
    say(`${FEEDBACK_SUBMIT_OK_TEXT}。编号：${reading.id}`, 'ok');
    // 成功后清掉正文与附件（避免连点两次把同一份内容提交两遍），标题与署名留着
    bodyInput.value = '';
    files = [];
    refreshFiles();
    // 排"到点自动关闭"。**先排它、再通知宿主**：`onSubmitted` 是宿主的接缝，万一它抛错，
    // 也不该把"浮层永远不关、用户被卡在这一层上"这个后果留给用户 ——
    // "提交成功之后要回到首页"这件事必须已经排上（抛错仍旧照抛，由宿主那一侧去处理）。
    scheduleAutoClose();
    if (nav.onSubmitted !== undefined) nav.onSubmitted(reading.id);
  }

  overlay.addEventListener('click', (e) => {
    // 点遮罩空白处关闭（与 `settingsOverlayElement` 同款：`e.target` 只有点在遮罩本身时才等于它）
    if (e.target === overlay) requestClose();
  });

  applyKind('protocol');
  refreshFiles();
  return { element: overlay, cancelAutoClose };
}

/**
 * 读 `<input type="file">` 当前选中的文件。
 *
 * `FileList` 在有些环境里不可迭代 ⇒ 按 `length` + 下标取（浏览器与测试桩都满足这个形状）。
 * 每一项都要求带 `name`/`size`，否则**丢掉它**（宁可少一份，也不要把 `undefined` 塞进
 * `FormData` —— 那会变成字符串 "undefined" 发给服务端）。
 */
function readInputFiles(input: HTMLInputElement): FeedbackAttachment[] {
  const list = input.files as unknown as { length?: number; [i: number]: unknown } | null;
  if (list === null || list === undefined || typeof list.length !== 'number') return [];
  const out: FeedbackAttachment[] = [];
  for (let i = 0; i < list.length; i += 1) {
    const f = list[i] as { name?: unknown; size?: unknown } | null;
    if (f === null || f === undefined) continue;
    if (typeof f.name !== 'string' || typeof f.size !== 'number') continue;
    out.push({ name: f.name, size: f.size, file: f as unknown as Blob });
  }
  return out;
}

/* =====================================================================
 * 口令输入框（Ctrl+Shift+O 之后那一层）
 * ===================================================================== */

/**
 * 口令输入框的**面板**（不含外层遮罩）。
 *
 * 拆成"面板"与"浮层"两件，是为了让它能被两处复用而**不复制一份逻辑**：
 *  - `feedbackPasswordElement()` 把它包成独立浮层（直接按 `Ctrl+Shift+O` 时那一层）；
 *  - 隐藏页控制器把它嵌进自己的内容区（同一个口令框，同一个失败文案）。
 *
 * 行为（用户原话 + 任务书要求）：`type=password`、回车提交、失败显示「密码不对」。
 * 口令**只**沿着 `fetcher` POST 出去一次，用完立刻把输入框清空。
 *
 * `notice` 是"进来之前发生了一件事"的那句话（会话过期被踢回来时用它，默认空）。
 * 它走的是**同一行状态区**：口令框只需要一条提示通道，加第二条很容易出现两句话打架。
 */
export function feedbackPasswordPanel(nav: {
  readonly onClose: () => void;
  readonly onOk: () => void;
  readonly fetcher: FeedbackFetcher;
  readonly notice?: string;
}): HTMLElement {
  let busy = false;
  const panel = el('div', 'feedback-prompt');
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-label', '口令');

  const head = el('div', 'feedback-head');
  head.appendChild(el('div', 'feedback-title', '口令'));
  head.appendChild(button('btn feedback-close', '关闭', () => { nav.onClose(); }));
  panel.appendChild(head);

  const input = document.createElement('input');
  input.className = 'feedback-input';
  role(input, 'password');
  input.setAttribute('type', 'password');
  input.setAttribute('autocomplete', 'off');
  input.placeholder = '输入口令后回车';
  panel.appendChild(input);

  const status = el('div', 'feedback-status');
  role(status, 'password-status');
  status.dataset.kind = 'none';
  if (nav.notice !== undefined && nav.notice !== '') {
    status.textContent = nav.notice;
    status.dataset.kind = 'info';
  }
  panel.appendChild(status);

  const ok = button('btn feedback-primary', '进入', () => { void submit(); });
  role(ok, 'password-ok');
  const row = el('div', 'feedback-actions');
  row.appendChild(ok);
  panel.appendChild(row);

  const setBusy = (on: boolean): void => {
    busy = on;
    ok.disabled = on;
    ok.textContent = on ? '正在验证…' : '进入';
  };

  async function submit(): Promise<void> {
    if (busy) return;
    const password = input.value;
    if (password === '') {
      status.textContent = '请先输入口令。';
      status.dataset.kind = 'error';
      return;
    }
    setBusy(true);
    status.textContent = '正在验证…';
    status.dataset.kind = 'info';
    const outcome = await requestJson(
      nav.fetcher,
      'POST',
      FEEDBACK_ENDPOINTS.login,
      jsonBody(buildLoginBody(password)),
      null,
    );
    setBusy(false);
    if (!outcome.ok) {
      // 401 的「密码不对」原样显示（服务端给了别的话就用它）；连不上服务时是"没有反馈服务"那句
      status.textContent = outcome.status === 401 && outcome.text === FEEDBACK_READ_FAIL_TEXT
        ? FEEDBACK_PASSWORD_FAIL_TEXT
        : outcome.text;
      status.dataset.kind = 'error';
      return;
    }
    if (!readLoginOk(outcome.json)) {
      status.textContent = FEEDBACK_PASSWORD_FAIL_TEXT;
      status.dataset.kind = 'error';
      return;
    }
    input.value = ''; // 口令用完即弃（不在 DOM 里留着）
    nav.onOk();
  }

  input.addEventListener('keydown', (e) => {
    // IME 组合中的回车（确认候选）不算提交；Esc 关掉这一层
    if ((e as unknown as { isComposing?: boolean }).isComposing === true) return;
    if (e.key === 'Escape') { nav.onClose(); return; }
    if (e.key !== 'Enter') return;
    e.preventDefault(); // 清空默认行为：回车只用来提交一次口令
    void submit();
  });
  return panel;
}

/** 口令**浮层**（面板 + 遮罩）；独立使用时按 `Ctrl+Shift+O` 看到的就是它 */
export function feedbackPasswordElement(nav: {
  readonly onClose: () => void;
  readonly onOk: () => void;
  readonly fetcher: FeedbackFetcher;
}): HTMLElement {
  const overlay = el('div', 'feedback-overlay feedback-overlay-prompt');
  overlay.appendChild(feedbackPasswordPanel(nav));
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) nav.onClose();
  });
  return overlay;
}

/**
 * `POST /feedback/login` 要发 JSON（契约：JSON `{ password }`）。
 *
 * 包成 `Blob` 并在创建时带上 `application/json` —— 比手拼字符串干净，也是
 * `fetch` 的合法 body（`FeedbackFetcher.fetch` 的 body 形参是 `BodyInit | null`）。
 */
function jsonBody(text: string): BodyInit {
  return new Blob([text], { type: 'application/json' });
}

/* =====================================================================
 * 隐藏页（口令 → 卡片网格 → 详情）
 * ===================================================================== */

/** 隐藏页此刻画的是哪一格（`data-feedback-screen` 是同一个读数的 DOM 出口） */
export type FeedbackScreen = 'password' | 'list' | 'detail';

/**
 * 隐藏页控制器（`Ctrl+Shift+O` → 口令 → 列表 → 详情）。
 *
 * 状态机只有三格，而且每一格都是**重画这一层的内容区**（不是整屏重画：首页在浮层底下
 * 原样留着）。401（会话过期 / 未登录）从任何一格退回口令框。
 *
 * ⚠️ `generation` 那个计数器管"在途的异步回调":关掉（或换格）之后，晚到的响应
 * **一个字都不许写屏** —— 否则会往已经摘掉的树上写，或者把用户从口令框又拽回详情。
 */
export class FeedbackHiddenView {
  private readonly root: HTMLElement;
  private readonly fetcher: FeedbackFetcher;
  private readonly onClose: () => void;
  private mounted = false;
  private generation = 0;
  private screen: FeedbackScreen = 'password';
  /** 详情那一格要读哪一条（点卡片时写它；`detailPane` 读它并立刻清掉，避免"刷新又画回上一条"） */
  private pendingDetail: FeedbackListItem | null = null;
  /**
   * ★ 2026-10-01 追加（用户要求「隐藏页想加删除/标记已读」）：列表这一格的**当前数据**。
   *
   * 留一份在内存里是因为"标记已读 / 删除"之后要**就地更新**那一张卡与顶部读数，
   * 而不是整页重画（用户原话：「成功后**就地更新**该卡样式与顶部未读数，不要整页重画」）。
   */
  private items: readonly FeedbackListItem[] = [];
  private unread = 0;
  private total = 0;
  /** `id -> 那一张卡的元素`（就地重建/移除时按 id 找它） */
  private readonly cardEls = new Map<string, HTMLElement>();
  /** 顶部那句读数（"共 N 条 · 未读 M 条"；它就地在原地改文案） */
  private countEl: HTMLElement | null = null;
  /** 标记已读/删除这类**会改服务端数据**的动作正在飞行中（同一时刻只允许一个） */
  private busyAction = false;
  /** 详情那一格正在看的哪一条（`null` = 没选中） */
  private detailItem: FeedbackListItem | null = null;
  /** 详情那一格正文的容器（就地重画那一小块用；不换屏、不重画整页） */
  private detailBox: HTMLElement | null = null;
  /** 列表那一格的本体（建一次，之后只显隐 —— 见 `goto` 的说明） */
  private listWrap: HTMLElement | null = null;
  /** 详情那一层（每次进详情重建；返回列表时摘掉） */
  private detailWrap: HTMLElement | null = null;
  /** 卡片的网格（`replaceChildren` 就地重画它） */
  private gridEl: HTMLElement | null = null;
  /** 退回口令框时要写在状态行上的那句话（空 = 不写；只有"会话过期"那条路会设置它） */
  private passwordNotice = '';

  constructor(deps: {
    readonly root: HTMLElement;
    readonly fetcher: FeedbackFetcher;
    readonly onClose: () => void;
  }) {
    this.root = deps.root;
    this.fetcher = deps.fetcher;
    this.onClose = deps.onClose;
  }

  /** 当前这一格（测试与宿主读它） */
  get currentScreen(): FeedbackScreen {
    return this.screen;
  }

  get isMounted(): boolean {
    return this.mounted;
  }

  /**
   * 进隐藏页：**起手永远是口令框**（用户原话：「按 Ctrl+Shift+O 打开一个口令输入框，
   * 输入正确口令后进入隐藏页」）—— 不做"上次登录过就直接进列表"那种记忆
   * （Cookie 在不在由服务端说了算，前端猜不准）。
   */
  open(): void {
    if (this.mounted) return;
    this.mounted = true;
    this.generation += 1;
    this.render();
  }

  /** 关掉：摘节点 + 让在途回调失效 + 告诉宿主 */
  close(): void {
    this.generation += 1;
    this.mounted = false;
    this.pendingDetail = null;
    this.items = [];
    this.cardEls.clear();
    this.countEl = null;
    this.detailBox = null;
    this.detailItem = null;
    this.listWrap = null;
    this.detailWrap = null;
    this.gridEl = null;
    this.root.remove();
    this.onClose();
  }

  /** 把这一层挂进 `document`（宿主调它；`#app` 不碰） */
  mount(parent: HTMLElement): void {
    parent.appendChild(this.root);
  }

  /** 重画当前这一格 */
  private render(): void {
    const gen = this.generation;
    this.root.replaceChildren();
    this.root.className = 'feedback-overlay';
    this.root.dataset.feedbackScreen = this.screen;
    // 换格就重置"这一格的定位缓存"（它们指向的是**上一格**的节点）
    this.cardEls.clear();
    this.countEl = null;
    this.detailBox = null;
    this.listWrap = null;
    this.detailWrap = null;
    if (this.screen === 'password') {
      const sheet = el('div', 'feedback-sheet');
      sheet.appendChild(feedbackPasswordPanel({
        onClose: () => { this.close(); },
        onOk: () => { this.goto('list', gen); },
        fetcher: this.fetcher,
        ...(this.passwordNotice === '' ? {} : { notice: this.passwordNotice }),
      }));
      this.root.appendChild(sheet);
      return;
    }
    // 列表那一格**一直留着**（只是显隐切换）：这样"标记已读 / 删除"的**就地更新**在
    // "进详情再返回"之后仍然在（用户要求"不要整页重画"）。详情那一格是临时层。
    this.listWrap = this.buildListPane(gen);
    this.root.appendChild(this.listWrap);
    if (this.screen === 'list') {
      this.showList();
      // 只在"没有列表数据"时拉一次（`goto('list')` 从详情返回时不走这里 —— 见 `goto`）。
      // 点「刷新」是显式的另一条路（`buildListPane` 里那个按钮）。
      void this.loadList(gen);
    } else {
      this.detailWrap = this.buildDetailPane(this.detailItem, gen);
      this.root.appendChild(this.detailWrap);
      this.showDetail();
    }
  }

  /** 只让列表那一格可见（详情那一层移除） */
  private showList(): void {
    this.detailWrap?.remove();
    this.detailWrap = null;
    if (this.listWrap !== null) this.listWrap.hidden = false;
    this.root.dataset.feedbackScreen = 'list';
  }

  /** 只让详情那一格可见（列表留在原地、收起但不重画） */
  private showDetail(): void {
    if (this.listWrap !== null) this.listWrap.hidden = true;
    this.root.dataset.feedbackScreen = 'detail';
  }

  /**
   * ★ 2026-10-01 追加：**会话过期（401）** —— 从任何一格退回口令框，并在状态行上说清原因。
   *
   * 为什么加这一句（原来只是静默回到口令框）：用户看到的是"我正在看列表，突然让我输口令"，
   * 没有任何解释；而口令框那行状态区**本来就有**，零成本。四条 401 通路（列表 / 详情 /
   * 标记已读 / 删除）都汇到这里 —— 一处写，四处一致。
   */
  private expireSession(gen: number): void {
    this.passwordNotice = FEEDBACK_SESSION_EXPIRED_TEXT;
    this.goto('password', gen);
  }

  /**
   * 换格。
   *
   * ⚠️ **不再整页重画**（★ 2026-10-01 追加的要求）：进详情只是把列表那一格收起来、把详情那一层
   * 挂上；返回列表只是把详情那一层摘掉、把列表那一格放出来 —— 于是"刚刚就地改掉的未读标记、
   * 计数、已删除的卡"都还在（早先那版"返回即重画"会把它们抹掉，还会多发一次 `GET /feedback/list`）。
   */
  private goto(next: FeedbackScreen, gen: number): void {
    if (gen !== this.generation || !this.mounted) return;
    if (next === 'password') {
      this.screen = 'password';
      this.pendingDetail = null;
      this.detailItem = null;
      this.render();
      return;
    }
    if (next === 'detail') {
      this.screen = 'detail';
      if (this.listWrap === null) { this.render(); return; }
      this.showDetail();
      this.detailWrap = this.buildDetailPane(this.pendingDetail, gen);
      this.pendingDetail = null;
      this.root.appendChild(this.detailWrap);
      return;
    }
    // 回列表：把详情那一层摘掉，列表那一格原样放出来（不重画、不重发请求）
    this.screen = 'list';
    this.pendingDetail = null;
    this.detailItem = null;
    if (this.listWrap === null) { this.render(); return; }
    this.showList();
  }

  /** 列表那一格（卡片网格，样式参考「查看规则文档」）—— 建一次，后面只显隐 */
  private buildListPane(gen: number): HTMLElement {
    const wrap = el('div', 'feedback-sheet');
    const bar = el('div', 'feedback-head');
    bar.appendChild(el('div', 'feedback-title', '反馈'));
    const refresh = button('btn feedback-refresh', '刷新', () => { void this.loadList(gen); });
    role(refresh, 'refresh');
    bar.appendChild(refresh);
    bar.appendChild(button('btn feedback-close', '关闭', () => { this.close(); }));
    wrap.appendChild(bar);

    // 顶部读数（★ 2026-10-01 追加：'共 N 条 · 未读 M 条'；标记已读/删除后就地改它）
    const count = el('div', 'feedback-count', '正在读取…');
    role(count, 'count');
    this.countEl = count;
    wrap.appendChild(count);

    const status = el('div', 'feedback-status');
    role(status, 'list-status');
    status.dataset.kind = 'none';
    wrap.appendChild(status);

    const grid = el('div', 'rules-grid feedback-grid');
    role(grid, 'grid');
    wrap.appendChild(grid);
    this.gridEl = grid;
    return wrap;
  }

  /** 拉一次列表并重画网格（进入列表与点「刷新」都走它） */
  private async loadList(gen: number): Promise<void> {
    const grid = this.gridEl;
    const status = this.root.querySelector<HTMLElement>('[data-role="list-status"]');
    const count = this.countEl;
    if (grid === null) return;
    const outcome = await requestJson(this.fetcher, 'GET', FEEDBACK_ENDPOINTS.list, null, null);
    if (gen !== this.generation || !this.mounted) return;
    if (!outcome.ok) {
      // 401（会话过期 / 未登录）⇒ 退回口令框（任务书要求）
      if (outcome.status === 401) { this.expireSession(gen); return; }
      if (count !== null) count.textContent = '';
      if (status !== null) {
        status.textContent = outcome.status === 0 ? FEEDBACK_OFFLINE_TEXT : outcome.text;
        status.dataset.kind = 'error';
      }
      return;
    }
    const page = readList(outcome.json);
    if (page === null) {
      if (count !== null) count.textContent = '';
      if (status !== null) {
        status.textContent = FEEDBACK_READ_FAIL_TEXT;
        status.dataset.kind = 'error';
      }
      return;
    }
    this.items = page.items;
    this.unread = page.unread;
    this.total = page.total;
    grid.replaceChildren();
    this.cardEls.clear();
    for (const item of this.items) {
      const card = this.card(item, gen);
      this.cardEls.set(item.id, card);
      grid.appendChild(card);
    }
    this.refreshCounts();
    if (status !== null) {
      status.textContent = this.items.length === 0 ? '还没有收到任何反馈。' : '';
      status.dataset.kind = this.items.length === 0 ? 'info' : 'none';
    }
  }

  /** 顶部读数就地刷新（不重画整页） */
  private refreshCounts(): void {
    if (this.countEl !== null) {
      this.countEl.textContent = feedbackCountText({ total: this.total, unread: this.unread });
    }
  }

  /**
   * 未读那一档的标记（左侧色条 + 「未读」徽章 + 那颗按钮的文案）；已读就把前三样都撤掉。
   *
   * ⚠️ 按钮文案也在这一处：卡片上那颗按钮写着「标记已读 / 标为未读」，它是**读状态的第二种
   * 出口**（数据出口是 `data-feedback-read`）。漏掉它会出现"卡已经变成已读、按钮却还写着
   * 『标记已读』"的自相矛盾（实测踩过）。
   */
  private applyUnread(card: HTMLElement, item: FeedbackListItem): void {
    card.classList.toggle('feedback-card-unread', !item.read);
    card.dataset.feedbackRead = item.read ? 'true' : 'false';
    const readBtn = card.querySelector<HTMLElement>('[data-role="card-read"]');
    if (readBtn !== null) {
      readBtn.textContent = item.read ? '标为未读' : '标记已读';
      readBtn.dataset.feedbackRead = item.read ? 'true' : 'false';
    }
    const found = card.querySelectorAll<HTMLElement>('.feedback-unread-badge');
    if (item.read) {
      for (const b of Array.from(found)) b.remove();
      return;
    }
    // 只留一颗徽章（`querySelectorAll` 是桩与浏览器都支持的那一个查询形态）
    for (let i = 1; i < found.length; i += 1) found[i].remove();
    if (found.length === 0) {
      const badge = el('span', 'feedback-unread-badge', '未读');
      const head = card.querySelector<HTMLElement>('.feedback-card-head');
      if (head === null) card.insertBefore(badge, card.firstChild as Node | null);
      else head.insertBefore(badge, head.firstChild as Node | null);
    }
  }

  /**
   * 一张反馈卡：标题 / 类型徽章 / 投稿人 / 时间 / 附件数 + **标记已读/未读** + **删除**。
   *
   * 整卡可点（进详情）；卡片右下角那两个小按钮是卡**内部**的独立可点区
   * （点它们的事件不会走到"进详情"那一句 —— 它们各自有自己的监听器，桩与浏览器同语义）。
   */
  private card(item: FeedbackListItem, gen: number): HTMLElement {
    const card = el('div', 'rules-item feedback-card');
    card.dataset.feedbackId = item.id;
    card.dataset.role = 'card';
    card.dataset.feedbackRead = item.read ? 'true' : 'false';
    const info = el('div', 'rules-info');
    const top = el('div', 'feedback-card-head');
    if (!item.read) top.appendChild(el('span', 'feedback-unread-badge', '未读'));
    top.appendChild(el('span', `feedback-badge feedback-badge-${item.kind}`, FEEDBACK_KIND_BADGES[item.kind]));
    top.appendChild(el('span', 'feedback-file-count', `附件 ${item.fileCount} 份`));
    info.appendChild(top);
    info.appendChild(el('div', 'rules-title', item.title === '' ? '（无标题）' : item.title));
    info.appendChild(el('div', 'rules-desc', `${item.author} · ${formatCreatedAt(item.createdAt)}`));

    const actions = el('div', 'feedback-card-actions');
    const readBtn = actionButton('btn feedback-mini', item.read ? '标为未读' : '标记已读', () => {
      void this.toggleRead(item, !item.read, gen);
    });
    role(readBtn, 'card-read');
    readBtn.dataset.feedbackId = item.id;
    readBtn.dataset.feedbackRead = item.read ? 'true' : 'false';
    actions.appendChild(readBtn);

    const delBtn = actionButton('btn feedback-mini feedback-danger', '删除', () => {
      if (confirmRow.hidden) {
        confirmRow.hidden = false;
        return;
      }
      void this.deleteItem(item, confirmRow, gen);
    });
    role(delBtn, 'card-delete');
    delBtn.dataset.feedbackId = item.id;
    actions.appendChild(delBtn);
    info.appendChild(actions);

    // 二次确认行（默认收起；点一次「删除」才展开 —— 用户要求"点一次先出确认"）
    const confirmRow = el('div', 'feedback-confirm');
    confirmRow.dataset.role = 'card-confirm';
    confirmRow.dataset.feedbackId = item.id;
    confirmRow.hidden = true;
    confirmRow.appendChild(el('span', 'feedback-confirm-text', '移入回收站后不能在页面上恢复，确定删除？'));
    const yes = actionButton('btn feedback-mini feedback-danger', '确认删除', () => {
      void this.deleteItem(item, confirmRow, gen);
    });
    role(yes, 'card-delete-yes');
    yes.dataset.feedbackId = item.id;
    confirmRow.appendChild(yes);
    const no = actionButton('btn feedback-mini', '取消', () => { confirmRow.hidden = true; });
    role(no, 'card-delete-no');
    no.dataset.feedbackId = item.id;
    confirmRow.appendChild(no);
    info.appendChild(confirmRow);

    card.appendChild(info);
    // 初画就把未读那一档的标记落上去（左侧色条 + 「未读」徽章）—— `applyUnread` 是**唯一**
    // 一处写这两样的地方，"标记已读/标回未读"那条路复用它，两处不会漂。
    this.applyUnread(card, item);
    card.addEventListener('click', () => {
      this.pendingDetail = item;
      this.goto('detail', gen);
    });
    return card;
  }

  /**
   * ★ 2026-10-01 追加：标记已读 / 标回未读（`POST /feedback/read`，JSON `{ id, read }`）。
   *
   * 成功后**就地更新**那一张卡与顶部未读数（不重画整页）。401 ⇒ 退口令框。
   * ⚠️ 打开详情时**不自动**标已读（用户没说自动，保持手动可控）。
   */
  private async toggleRead(item: FeedbackListItem, next: boolean, gen: number): Promise<void> {
    if (this.busyAction) return;
    this.busyAction = true;
    const outcome = await requestJson(
      this.fetcher,
      'POST',
      FEEDBACK_ENDPOINTS.read,
      jsonBody(buildReadBody(item.id, next)),
      null,
    );
    this.busyAction = false;
    if (gen !== this.generation || !this.mounted) return;
    if (!outcome.ok) {
      if (outcome.status === 401) { this.expireSession(gen); return; }
      this.sayListStatus(outcome.status === 0 ? FEEDBACK_OFFLINE_TEXT : outcome.text);
      return;
    }
    const reading = readActionOk(outcome.json, FEEDBACK_READ_FAIL_TEXT);
    if (!reading.ok) { this.sayListStatus(reading.error); return; }
    this.applyRead(item.id, next);
  }

  /** 把"某一条的读状态"落到数据、卡、顶部计数三处（唯一一处改动它们的地方） */
  private applyRead(id: string, next: boolean): void {
    const before = this.items.find((it) => it.id === id);
    if (before === undefined) return;
    const updated: FeedbackListItem = { ...before, read: next };
    this.items = this.items.map((it) => (it.id === id ? updated : it));
    if (next && !before.read) this.unread = Math.max(0, this.unread - 1);
    if (!next && before.read) this.unread += 1;
    // 列表那一张卡就地更新（它可能正收在详情底下 —— 清单节点一直留着，照样能改）
    const card = this.cardEls.get(id);
    if (card !== undefined) this.applyUnread(card, updated);
    this.refreshCounts();
    // 详情那一格开着时：就地重画它那一小块（读数/按钮文案跟着走，不换屏）
    if (this.detailItem !== null && this.detailItem.id === id) {
      this.detailItem = { ...this.detailItem, read: next };
      this.renderDetailBody();
    }
  }

  /**
   * ★ 2026-10-01 追加：删除（`POST /feedback/delete`，JSON `{ id }`）。
   *
   * 调用点**必须**是二次确认之后（卡片上那次点「删除」只是把确认行展开）。
   * 成功后：从列表数据、DOM、卡片表里移除，未读计数在必要时减一；
   * 若当前在详情里 ⇒ 退回列表（用户要求）。失败 ⇒ 原样显示服务端中文原因。
   */
  private async deleteItem(
    item: FeedbackListItem,
    confirmRow: HTMLElement,
    gen: number,
  ): Promise<void> {
    if (this.busyAction) return;
    this.busyAction = true;
    const outcome = await requestJson(
      this.fetcher,
      'POST',
      FEEDBACK_ENDPOINTS.delete,
      jsonBody(buildDeleteBody(item.id)),
      null,
    );
    this.busyAction = false;
    if (gen !== this.generation || !this.mounted) return;
    if (!outcome.ok) {
      if (outcome.status === 401) { this.expireSession(gen); return; }
      confirmRow.hidden = true; // 失败：把确认行收回去，只留状态行那句话
      this.sayListStatus(outcome.status === 0 ? FEEDBACK_OFFLINE_TEXT : outcome.text);
      return;
    }
    const reading = readActionOk(outcome.json, FEEDBACK_READ_FAIL_TEXT);
    if (!reading.ok) {
      confirmRow.hidden = true;
      this.sayListStatus(reading.error);
      return;
    }
    const wasUnread = !item.read;
    this.items = this.items.filter((it) => it.id !== item.id);
    this.total = Math.max(0, this.total - 1);
    if (wasUnread) this.unread = Math.max(0, this.unread - 1);
    const card = this.cardEls.get(item.id);
    card?.remove();
    this.cardEls.delete(item.id);
    // 计数先就地刷新（列表那一格一直留着，即使此刻收在详情底下也照改），再决定回不回列表
    this.refreshCounts();
    if (this.currentScreen === 'detail') {
      // 详情里删掉的这一条：退回列表（列表那一格按刚更新的数据留白，不重画、不重发请求）
      this.goto('list', gen);
    }
    this.sayListStatus(`已删除「${item.title === '' ? '（无标题）' : item.title}」（移入回收站）。`, 'ok');
  }

  /** 列表那一格的状态行（就地写一句话；`kind` 缺省是 error） */
  private sayListStatus(text: string, kind: 'error' | 'ok' | 'info' = 'error'): void {
    const node = this.root.querySelector<HTMLElement>('[data-role="list-status"]');
    if (node === null) return;
    node.textContent = text;
    node.dataset.kind = kind;
  }

  /* ── 详情那一格 ── */
  private buildDetailPane(item: FeedbackListItem | null, gen: number): HTMLElement {
    this.detailItem = item;
    const wrap = el('div', 'feedback-sheet');
    const bar = el('div', 'feedback-head');
    const back = button('btn feedback-back', '← 返回列表', () => { this.goto('list', gen); });
    role(back, 'back');
    bar.appendChild(back);
    bar.appendChild(el('div', 'feedback-title', '反馈详情'));
    // ★ 2026-10-01 追加：详情里也放这两个动作（用户说"详情里更顺手"）
    if (item !== null) {
      const readBtn = button('btn feedback-mini', item.read ? '标为未读' : '标记已读', () => {
        void this.toggleRead(item, !item.read, gen);
      });
      role(readBtn, 'detail-read');
      bar.appendChild(readBtn);
      const delBtn = button('btn feedback-mini feedback-danger', '删除', () => {
        if (confirmRow.hidden) { confirmRow.hidden = false; return; }
        void this.deleteItem(item, confirmRow, gen);
      });
      role(delBtn, 'detail-delete');
      bar.appendChild(delBtn);
    }
    bar.appendChild(button('btn feedback-close', '关闭', () => { this.close(); }));
    wrap.appendChild(bar);

    // 二次确认行（详情里的那份；与卡片上那个同款文案）
    const confirmRow = el('div', 'feedback-confirm');
    confirmRow.dataset.role = 'detail-confirm';
    confirmRow.hidden = true;
    confirmRow.appendChild(el('span', 'feedback-confirm-text', '移入回收站后不能在页面上恢复，确定删除？'));
    if (item !== null) {
      const yes = button('btn feedback-mini feedback-danger', '确认删除', () => {
        void this.deleteItem(item, confirmRow, gen);
      });
      role(yes, 'detail-delete-yes');
      confirmRow.appendChild(yes);
    }
    const no = button('btn feedback-mini', '取消', () => { confirmRow.hidden = true; });
    role(no, 'detail-delete-no');
    confirmRow.appendChild(no);
    wrap.appendChild(confirmRow);

    const status = el('div', 'feedback-status');
    role(status, 'detail-status');
    status.dataset.kind = 'none';
    wrap.appendChild(status);

    const box = el('div', 'feedback-detail');
    role(box, 'detail');
    this.detailBox = box;
    wrap.appendChild(box);

    if (item === null) {
      status.textContent = '没有选中任何一条反馈。';
      status.dataset.kind = 'error';
      return wrap;
    }
    void (async (): Promise<void> => {
      const outcome = await requestJson(this.fetcher, 'GET', feedbackItemHref(item.id), null, null);
      if (gen !== this.generation || !this.mounted) return;
      if (!outcome.ok) {
        if (outcome.status === 401) { this.expireSession(gen); return; }
        status.textContent = outcome.status === 0 ? FEEDBACK_OFFLINE_TEXT : outcome.text;
        status.dataset.kind = 'error';
        return;
      }
      const detail = readItem(outcome.json);
      if (detail === null) {
        status.textContent = FEEDBACK_READ_FAIL_TEXT;
        status.dataset.kind = 'error';
        return;
      }
      // 详情里那条的读状态以**列表那一刻的读数**为准（服务端这条 GET 不保证带 read）
      this.detailItem = { ...detail, read: this.isRead(item.id, detail.read) };
      this.renderDetailBody();
    })();
    return wrap;
  }

  /** 某一条此刻的读状态：优先用列表里那份（标记已读之后马上就是新的），否则用详情自己带的 */
  private isRead(id: string, fallback: boolean): boolean {
    const fromList = this.items.find((it) => it.id === id);
    return fromList === undefined ? fallback : fromList.read;
  }

  /** 就地重画详情正文那一小块（标已读/标未读之后走它；不换屏、不重画整页） */
  private renderDetailBody(): void {
    const box = this.detailBox;
    const item = this.detailItem;
    if (box === null || item === null) return;
    box.replaceChildren();
    // 读状态变了 ⇒ 那一格顶栏上的按钮文案也要跟着换（就地换字，不重画整页）
    const readBtn = this.root.querySelector<HTMLElement>('[data-role="detail-read"]');
    if (readBtn !== null) readBtn.textContent = item.read ? '标为未读' : '标记已读';
    box.appendChild(this.detailBody(item as FeedbackDetail));
  }

  /** 详情正文（标题 / 类型 / 投稿人 / 时间 / 全文 / 附件列表） */
  private detailBody(d: FeedbackDetail): HTMLElement {
    const box = el('div', 'feedback-detail-body');
    const top = el('div', 'feedback-card-head');
    if (!d.read) top.appendChild(el('span', 'feedback-unread-badge', '未读'));
    top.appendChild(el('span', `feedback-badge feedback-badge-${d.kind}`, FEEDBACK_KIND_BADGES[d.kind]));
    box.appendChild(top);
    box.appendChild(el('div', 'feedback-detail-title', d.title === '' ? '（无标题）' : d.title));
    box.appendChild(el('div', 'feedback-meta', `${d.author} · ${formatCreatedAt(d.createdAt)}`));
    box.appendChild(el('div', 'feedback-detail-body-text', d.body));
    if (d.files.length === 0) {
      box.appendChild(el('div', 'feedback-hint', '这一条没有附件。'));
      return box;
    }
    box.appendChild(el('div', 'feedback-label', `附件（${d.files.length} 份）`));
    const list = el('div', 'feedback-files');
    role(list, 'detail-files');
    for (const f of d.files) list.appendChild(fileRow(d.id, f));
    box.appendChild(list);
    return box;
  }
}

/**
 * 一条附件：`<a href="GET /feedback/file?id=&name=">`。
 *
 * 为什么用 `<a>`（用户要求「能点开看/下载」）：请求由**浏览器**发出，同源 Cookie 自动带上
 * —— 前端拿不到 token，也就不可能自己拼 `Authorization`。
 *
 * ⚠️ 这一条**不做 401 的同步判定**（那要多发一次请求）：附件打不开时会话过期的退路，由
 * 列表与详情那两次 GET 的 401 分支承担（`listPane` / `detailPane` 里那一行）。
 * 写在这里免得被读成"漏了"。
 */
function fileRow(id: string, f: FeedbackFileMeta): HTMLElement {
  const row = el('div', 'feedback-file-row');
  const a = document.createElement('a') as HTMLAnchorElement;
  a.className = 'feedback-file-link';
  a.setAttribute('href', feedbackFileHref(id, f.name));
  a.setAttribute('target', '_blank');
  a.setAttribute('rel', 'noopener');
  a.textContent = f.name === '' ? '（无名附件）' : f.name;
  row.appendChild(a);
  row.appendChild(el('span', 'feedback-file-size', formatBytes(f.size)));
  return row;
}

/* =====================================================================
 * 宿主接缝：表单浮层单例
 * ===================================================================== */

let liveFormOverlay: HTMLElement | null = null;
/**
 * 关掉表单浮层的**唯一**出口（撤 keydown 监听 + **取消待执行的自动关闭** + 摘节点 + 清单例）。
 *
 * 为什么是"唯一出口"而不是各写一份（2026-10-01 改口径时收的）：这一层手里有**两样需要收尾的
 * 东西**（`document` 级的 Esc 监听、以及提交成功后排下的那个自动关闭定时器），
 * 分散收尾必然漏一样 —— 漏监听器会在每次开关之后留下一个还能跑的闭包，漏定时器会让它在浮层
 * 已经摘掉之后再去关一次。`closeFeedbackOverlay()`（宿主换页时调）也走它，于是两条关法行为一致。
 */
let liveFormClose: (() => void) | null = null;

/**
 * 首页那个「反馈」按钮的动作：把表单浮层挂到 `document.body`。
 *
 * 幂等（连点两次不留第二层，与 `main.ts` 的 `openSettings` 同款）；关掉时走 `liveFormClose`
 * 那一个出口（摘节点 + 撤监听 + 取消定时器 + 清单例）。
 * 返回浮层本体；已经开着时返回**既有那一层**。
 */
export function openFeedbackOverlay(nav: {
  readonly fetcher: FeedbackFetcher;
  readonly onSubmitted?: (id: string) => void;
}): HTMLElement {
  if (liveFormOverlay !== null) return liveFormOverlay;
  let overlay: HTMLElement | null = null;
  let handle: FeedbackFormHandle | null = null;
  const onKey = (ev: KeyboardEvent): void => {
    if (ev.key === 'Escape') close();
  };
  const close = (): void => {
    document.removeEventListener('keydown', onKey);
    // ① 先取消待执行的自动关闭（用户在这一秒里自己关了 / 换页了 —— 那个定时器不该再跑）
    handle?.cancelAutoClose();
    // ② 再摘节点、清单例（幂等：第二次调进来时 `overlay` 已经是 null）
    overlay?.remove();
    overlay = null;
    liveFormOverlay = null;
    liveFormClose = null;
  };
  handle = feedbackFormElement({
    onClose: close,
    fetcher: nav.fetcher,
    ...(nav.onSubmitted === undefined ? {} : { onSubmitted: nav.onSubmitted }),
  });
  overlay = handle.element;
  document.body.appendChild(overlay);
  document.addEventListener('keydown', onKey);
  liveFormOverlay = overlay;
  liveFormClose = close;
  return overlay;
}

/** 把已经挂上的表单浮层摘掉（宿主在离开首页时收尾；没开时是 no-op） */
export function closeFeedbackOverlay(): void {
  liveFormClose?.();
}

/* =====================================================================
 * Ctrl+Shift+O（只在首页生效）
 * ===================================================================== */

/** 首页那一屏的根类名（`renderHome` 加在 `#app` 上的那个） */
export const HOME_SCREEN_CLASS = 'screen-home';

/**
 * 此刻页面上是不是**首页那一屏**。
 *
 * 判据是 `#app` 上那个 `screen-home` 类（`renderHome` 的唯一落点）；离开首页时
 * `clearRoot` 会把这些类摘掉 ⇒ 这个函数自然变假。拿不到 `document` / `#app` 时按假处理
 * （node 环境直接 import 本模块也不会炸）。
 */
export function isHomeScreenActive(): boolean {
  if (typeof document === 'undefined' || document === null) return false;
  const app = document.getElementById('app');
  if (app === null) return false;
  return app.classList.contains(HOME_SCREEN_CLASS);
}

/**
 * 按键事件的目标是不是一个"正在打字的地方"。
 *
 * 用户要求：「别的页面/输入框里打字不要误触发」。判据是 `input` / `textarea` /
 * `select` / `[contenteditable]` —— 沿 `parentElement` 往上走，用**能力探测**
 * （不用 `instanceof`：node 的 DOM 桩里没有 `HTMLInputElement`，`instanceof` 会当场抛
 * `ReferenceError`，与 `render-net.ts` 里那条注释同一条理由）。
 */
export function isTypingTarget(target: unknown): boolean {
  let node = target as {
    tag?: unknown; tagName?: unknown; getAttribute?: unknown; parentElement?: unknown;
  } | null;
  let hops = 0;
  while (node !== null && node !== undefined && hops < 64) {
    // ⚠️ `tagName` 优先（浏览器里就是它），退到 `tag`：本仓的 DOM 桩（`tests/ui/net-dom-stub.ts`）
    // 只把标签名放在 `tag` 上、**没有** `tagName` —— 只认 `tagName` 会让这条闸门在桩上恒假，
    // 于是"在输入框里打字不误触发"这条判据变成空转（那种假绿正是本仓反复栽过的那一类）。
    const tag = typeof node.tagName === 'string'
      ? node.tagName.toLowerCase()
      : (typeof node.tag === 'string' ? node.tag.toLowerCase() : '');
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
    if (typeof node.getAttribute === 'function'
      && (node.getAttribute as (n: string) => string | null)('contenteditable') !== null) return true;
    node = (node.parentElement ?? null) as typeof node;
    hops += 1;
  }
  return false;
}

/**
 * 这次按键是不是那个隐藏入口（`Ctrl+Shift+O`）。
 *
 * 用 `e.code === 'KeyO'`（与 `devmode.ts` 用 `e.code === 'KeyP'` 同一条理由：非 QWERTY
 * 布局下 `e.key` 可能不是字母）。`Alt` / `Meta` 一起按下时不认（那是别家快捷键的地盘）；
 * 长按重复触发不认（`repeat` 不算新的一次）。
 */
export function isFeedbackShortcut(e: {
  readonly ctrlKey?: boolean;
  readonly shiftKey?: boolean;
  readonly altKey?: boolean;
  readonly metaKey?: boolean;
  readonly code?: string;
  readonly repeat?: boolean;
}): boolean {
  if (e.repeat === true) return false;
  if (e.altKey === true || e.metaKey === true) return false;
  if (e.ctrlKey !== true || e.shiftKey !== true) return false;
  // `code` 认 `KeyO`；完全没有 `code` 字段的事件（老浏览器 / 手工构造的事件）按"是它"处理
  // ——宁可多认一次（外面还有"只在首页"与"不在输入框里"两道闸门），也不要因为一个字段缺席
  // 让隐藏入口彻底打不开。
  return e.code === 'KeyO' || e.code === undefined;
}

/** 此刻挂着的那个 `Ctrl+Shift+O` 监听（模块级单例：重复调用 `initFeedbackShortcut` 不叠） */
let liveShortcut: { handler: (e: KeyboardEvent) => void } | null = null;
/** 隐藏页那一层的单例（同一时刻只允许一层） */
let liveShortcutView: FeedbackHiddenView | null = null;

/**
 * 挂上 `Ctrl+Shift+O`（**只在首页那一屏有效**），返回**卸载函数**。
 *
 * ## 为什么由宿主在进首页时调、离开时撤
 *
 * 用户要求：「`Ctrl+Shift+O` 只在首页生效（别的页面/输入框里打字不要误触发）；
 * 监听器要能撤销/不泄漏（页面切走后不该残留）」。
 * `src/main.ts` 的 `showHome` 每次进首页都调它（幂等：会先撤掉上一次那个），
 * 换页时调返回的卸载函数（见那里的注释）。
 *
 * ## 三重闸门（缺一不可）
 *
 *  1. **只有首页**（`isHomeScreenActive()`）—— 切到别的屏之后 `#app` 上没有 `screen-home`，
 *     这条快捷键自然失效（即使卸载漏了也打不开）；
 *  2. **不在输入框里打字**（`isTypingTarget()`）—— 以后首页上加了输入框也不会被误触发；
 *  3. **不 `preventDefault`**：`Ctrl+Shift+O` 在浏览器里没有既有用途（与 `Ctrl+Shift+P`
 *     会撞打印对话框不同），所以这里**不拦**默认行为（用户明确要求不要拦掉浏览器本来有用的
 *     快捷键，"除非确实需要"）。
 */
export function initFeedbackShortcut(nav: { readonly fetcher: FeedbackFetcher }): () => void {
  // 幂等：先撤掉上一次挂着的那一个（否则多次进首页会叠出一串监听器）
  if (liveShortcut !== null) {
    window.removeEventListener('keydown', liveShortcut.handler);
    liveShortcut = null;
  }
  const handler = (e: KeyboardEvent): void => {
    if (!isFeedbackShortcut(e)) return;
    if (!isHomeScreenActive()) return;
    if (isTypingTarget(e.target)) return;
    // 已经开着的浮层不再叠（设置小窗 / 反馈表单 / 隐藏页都算）
    if (document.querySelector('.settings-overlay') !== null) return;
    if (document.querySelector('.feedback-overlay') !== null) return;
    openHiddenView(nav.fetcher);
  };
  window.addEventListener('keydown', handler);
  liveShortcut = { handler };
  return () => {
    if (liveShortcut !== null && liveShortcut.handler === handler) {
      window.removeEventListener('keydown', handler);
      liveShortcut = null;
    }
    // 页面切走时把隐藏页那一层也收掉（否则它会飘在下一屏上面）
    closeHiddenView();
  };
}

/**
 * 打开隐藏页（口令框那一格），返回控制器。
 *
 * 独立导出：宿主与测试可以在没有键盘事件的情况下直接开它（不必先造一个 `KeyboardEvent`）。
 */
export function openHiddenView(fetcher: FeedbackFetcher): FeedbackHiddenView {
  if (liveShortcutView !== null && liveShortcutView.isMounted) return liveShortcutView;
  const root = el('div', 'feedback-overlay');
  const view = new FeedbackHiddenView({
    root,
    fetcher,
    onClose: () => {
      if (liveShortcutView === view) liveShortcutView = null;
    },
  });
  liveShortcutView = view;
  view.open();
  view.mount(document.body);
  return view;
}

/** 此刻隐藏页开着吗（宿主与测试读它；关掉之后必须是假） */
export function isHiddenViewOpen(): boolean {
  return liveShortcutView !== null && liveShortcutView.isMounted;
}

/** 关掉隐藏页那一层（没开时是 no-op） */
export function closeHiddenView(): void {
  liveShortcutView?.close();
  liveShortcutView = null;
}
