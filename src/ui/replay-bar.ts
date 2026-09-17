/**
 * 重放控制条（G4 Task 3）。可见形态对应计划 §4 的三条裁决：
 *  - **D3**「重放页只读」⇒ 本文件同时产出**一层真遮罩**（`.replay-shield`，见
 *    `styles-replay.css` 的层叠说明）与一句恒在的只读说明；"不可操作"必须**看得见**。
 *  - **D8**「重放期间关闭自动推进；倍速档 1×/2×/4×，0 = 暂停，单步无视倍速走一步」⇒ `rate === 0`
 *    没有对应的倍速按钮（**暂停由切换控件承担**，`data-active` 只在 1×/2×/4× 里选一个）。
 *  - **D12**「闸门」⇒ 本文件**不判断**哪一步合法：它只把点击转成 `nav` 回调，
 *    合法性在 `ReplayDriver.submit`（T2）。
 *
 * ## 三条纪律（每条都有测试腿，不是风格偏好）
 *
 * 1. **刻意没有模块态**：这里**不设** `mount()` / `unmount()` / `isMounted()` 单例。照 §3.4 的
 *    工具条先例（`render-net.ts` 的 `wrap.appendChild(renderPreviewToolbar(...))`），节点挂在
 *    **每帧重画的容器**里、随页面一起生灭 ⇒ 天然没有 body 级残留（本仓有过浮层残留的惨痛历史）。
 *    机检：`tests/ui/replay-bar.test.ts` 对**两个不同 parent** 各调一次，断言两边各一条、
 *    **且两个返回值不是同一批节点对象**（模块级单例在桩上不会让"每个 parent 各有 1 个"变红，
 *    因为桩的 `appendChild` 不做重父化 —— 所以判据必须钉**节点身份**与**内容互不干扰**，
 *    见那条腿的注释）。
 * 2. **不碰全局 `document`**：元素一律由**调用方给的 `parent`** 所属文档创建
 *    （`parent.ownerDocument.createElement`）。理由不是"洁癖"：`vite.config.ts` 的测试环境是
 *    `node`（没有 jsdom），唯一能在 `node` 下真跑本渲染器的方式就是让调用方把"文档"随 parent
 *    一起交进来（测试传入桩节点 + 桩 `ownerDocument`）。**本文件里没有裸 `document` 记号**
 *    （机检：判据 8 的去注释源码扫描 + 一条真的把全局 `document` 摘掉再渲染的行为腿）。
 * 3. **不引第二份真相**：`data-role` 是这些节点的机器可读出口（`replay-bar` / `replay-shield` /
 *    `replay-progress` / `replay-error`（**仅 error 非空时存在**）/ `replay-readonly-note`（恒存在））。
 *    `replay-error` 的空值形态必须**不存在**，而不是"存在但文本为空" —— 后者在屏上是"一个
 *    看不见的空行"，在判据上是**假绿**（`tests/ui/replay-bar.test.ts` 判据 6 两种都钉）。
 *
 * ## 五个 nav 回调 ↔ 控件的关系（判据 3 的"五个控件"）
 * `nav` 恰好五个方法，**每一个都有唯一控件**：`pause`/`play` 由**同一个切换按钮**按 `paused`
 * 二选一（文案与 `data-role` 一起切换）；`next` 是单步按钮；`setRate` 由 1×/2×/4× **三个**
 * 倍速按钮承担（所以盘面上是 6 个 `<button>`、5 个回调）；`exit` 是退出按钮。
 * 测试腿按"**每个**回调都有控件 + 每次点击**恰好**触发一条回调 + 点遍全部控件覆盖全部回调"
 * 生成式写（比"五个控件"的字面更强，不是放宽）。
 */
export interface ReplayBarNav {
  pause(): void;
  play(): void;
  next(): void;
  setRate(r: 0 | 1 | 2 | 4): void;
  exit(): void;
}

export interface ReplayBarState {
  /** 已执行的档案步数（不含草稿重建） */
  position: number;
  /** 档案总步数 */
  total: number;
  /** `0` = 暂停；`1`/`2`/`4` = 倍速 */
  rate: 0 | 1 | 2 | 4;
  paused: boolean;
  done: boolean;
  /** 引擎抛错时的人类可读文本；空/缺省 ⇒ 屏上**没有**错误节点 */
  error?: string | null;
}

/** 倍速按钮的档位（`0` 不在这里：暂停由切换控件承担，见文件头注的 D8 那一条）。 */
const RATES = [1, 2, 4] as const;

const LABEL_PAUSE = '暂停';
const LABEL_PLAY = '继续';
const LABEL_NEXT = '单步';
const LABEL_EXIT = '退出重放';
/** 恒在的只读说明（D3：重放页"不可操作"必须**看得见**）。 */
const READONLY_NOTE = '重放中不可操作（只读）';

/** 建一个带类名的元素（文档由调用方的 parent 提供，见文件头注第 2 条）。 */
function el(doc: Document, tag: string, cls: string): HTMLElement {
  const node = doc.createElement(tag);
  node.className = cls;
  return node;
}

/** 建一个控件按钮：类名 + `data-role` + 文案 + 一条点击回调（`type` 显式写 `button`）。 */
function ctrl(
  doc: Document, cls: string, role: string, label: string, onClick: () => void,
): HTMLButtonElement {
  const b = doc.createElement('button');
  b.type = 'button';
  b.className = cls;
  b.dataset.role = role;
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}

/**
 * 在 `parent` 里建一条控制条 + 一层遮罩，返回这两个节点（调用方通常不用它们，只用于测试与
 * 将来的定位；**本函数不持有它们**）。
 *
 * ⚠️ **不清空 `parent`**：调用点是 `renderApp(root, state, cb)` **之后**（T4 的第 7 条），
 * 此刻 `root` 里已经画好了这一帧的棋盘 —— 清空它就是清掉棋盘。
 */
export function renderReplayBar(
  parent: HTMLElement,
  state: ReplayBarState,
  nav: ReplayBarNav,
): { bar: HTMLElement; shield: HTMLElement } {
  const doc = parent.ownerDocument;

  /* ── 遮罩：先挂（DOM 序在前），层叠由 CSS 的 z-index 决定（`.replay-shield` < `.replay-bar`） ── */
  const shield = el(doc, 'div', 'replay-shield');
  shield.dataset.role = 'replay-shield';
  parent.appendChild(shield);

  /* ── 控制条 ── */
  const bar = el(doc, 'div', 'replay-bar');
  bar.dataset.role = 'replay-bar';
  parent.appendChild(bar);

  const progress = el(doc, 'div', 'replay-progress');
  progress.dataset.role = 'replay-progress';
  progress.textContent = `${state.position} / ${state.total}`;
  bar.appendChild(progress);

  if (typeof state.error === 'string' && state.error !== '') {
    const err = el(doc, 'div', 'replay-error');
    err.dataset.role = 'replay-error';
    err.textContent = state.error;
    bar.appendChild(err);
  }

  const controls = el(doc, 'div', 'replay-controls');
  bar.appendChild(controls);

  // 暂停 / 继续：**同一个**按钮，按 `paused` 同时切换文案与 `data-role`；`done` 后禁用。
  const toggle = ctrl(
    doc,
    state.paused ? 'replay-btn replay-play' : 'replay-btn replay-pause',
    state.paused ? 'replay-play' : 'replay-pause',
    state.paused ? LABEL_PLAY : LABEL_PAUSE,
    () => { if (state.paused) nav.play(); else nav.pause(); },
  );
  toggle.disabled = state.done;
  controls.appendChild(toggle);

  // 单步：无视倍速走一步（D8）；`done` 后禁用。
  const next = ctrl(doc, 'replay-btn replay-next', 'replay-next', LABEL_NEXT, () => nav.next());
  next.disabled = state.done;
  controls.appendChild(next);

  // 倍速档 1×/2×/4×：当前档带 `data-active="1"`（`rate === 0` 时三档都没有 active）。
  for (const r of RATES) {
    const b = ctrl(doc, 'replay-btn replay-rate', 'replay-rate', `${r}×`, () => nav.setRate(r));
    b.dataset.rate = String(r);
    if (state.rate === r) b.dataset.active = '1';
    controls.appendChild(b);
  }

  controls.appendChild(ctrl(doc, 'replay-btn replay-exit', 'replay-exit', LABEL_EXIT, () => nav.exit()));

  // 恒在的只读说明（判据 7 的"恒"字由测试在 运行/暂停/结束/错误 四种状态上都断言）。
  const note = el(doc, 'div', 'replay-readonly-note');
  note.dataset.role = 'replay-readonly-note';
  note.textContent = READONLY_NOTE;
  bar.appendChild(note);

  return { bar, shield };
}
