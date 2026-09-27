/* ============================================================================
 * G5/T39：触屏 → 鼠标手势桥
 *
 * ## 为什么要它（用户 2026-09-27 真机反馈）
 *
 * 用户在平板 + 手机上真打了一局（联机本身是通的），反馈"只能点、不能拖"。代码事实：
 * 拖动那套手势**全部**住在红线文件 `src/ui/render.ts` 里，而且只认鼠标事件 ——
 * `mousedown`（`:2112` 掩护板 / `:4621` 草稿选协议 / `:4693` 草稿退选 / `:6053` 拖拽打牌）
 * 与 `document` 上的 `mousemove` / `mouseup`。全仓没有一个 `touchstart` / `pointerdown`。
 * 红线不许动 ⇒ 本模块把触摸指针**桥成**那一套既有鼠标事件，`render.ts` 一个字节不改。
 *
 * ## 三条硬约束（与任务书 §1.1 逐条对应）
 *
 * 1. **只在触摸指针上启用**：入口就判 `pointerType === 'touch'`（分流计数 `pointerDownSeen`
 *    在**这道门之前**记，所以"鼠标指针被看到过几次、其中几条进了桥"是可读的）；一个鼠标指针
 *    都到不了桥里。设备连触摸能力都没有（`navigator.maxTouchPoints === 0` 且
 *    `(pointer: coarse)` / `(any-pointer: coarse)` 都为假）时**一个监听器都不装**。
 *    注意 实测口径（评审 A1 变异）：把启用条件改成"永远启用"之后桌面观感与基线**一字不差** ——
 *    真正扛住"鼠标零影响"的是 `pointerType` **那道门**，不是启用那两行。判据③ 因此改成断言
 *    分流事实（鼠标指针被看到过 + 一条都没进桥），而不是只断言 `enabled === false`。
 * 2. **不许出现"一次点击被当成两次"**：触摸设备上 Chrome 自己还会补一套**兼容鼠标事件**
 *    （`pointerup` → `touchend` → `mousedown` → `mouseup` → `click`）。本模块在**捕获阶段**
 *    拦掉这一根手指会话窗口内的、非本桥产出的 `mousedown`/`mousemove`/`mouseup`
 *    （`click` 一律**不拦** —— "点卡选中 → 点槽打出"那条路靠的就是浏览器原生的 `click`）。
 *
 *    **这道闸门承重多少：修复轮实测（`/run-tapgate-base.txt` 与 `/run-tapgate-mutA3.txt`）**
 *    - 一次**触摸点击**（草稿卡上）：闸门开着 ⇒ 页面上存在 2 条 mousedown（合成 1 + 原生 1），
 *      而**到应用手里恰好 1 条**（document 冒泡层 `all=1`、卡级 `all=1`、`compatBlocked=3`）；
 *    - 把闸门关掉（变异 A3）⇒ **到应用手里变成 2 条**（冒泡 `all=2`、卡级 `all=2/原生 1`）
 *      ⇒ 同一条手势被两个来源各驱动一次，`render.ts` 的 `mousedown` 处理器跑两遍。
 *    - **拖动那条路 Chrome 根本不发兼容鼠标事件**（实测 `compatBlocked=0`、捕获层 `all=1`）
 *      ⇒ 闸门只对"点击"这一路承重。
 *    - 诚实边界："两个幽灵卡 / 两次 `playToLine`"这类**后果**没能造出来 —— 那两条 mousedown
 *      都不越过 `bindCardDrag` 的 8px 阈值，拖拽分支不会启动。本注释按上面实测到的写，
 *      不声称没验过的后果。
 * 3. **`clientX/clientY` 必须是视口坐标**：`render.ts` 松手时用
 *    `document.elementFromPoint(clientX, clientY)` 找 `.stack-slot`。指针事件给的
 *    `clientX/clientY` 本来就是视口坐标 ⇒ 直接转发，**本模块不做任何坐标换算**
 *    （手机横屏那条 CSS 旋转的路子因此也是对的：命中测试由浏览器带着变换算）。
 *
 * ## 与 `render.ts` 既有手势的契约（复核过，见 `bindCardDrag` 的注释）
 *
 * - 起点：`mousedown`（`button === 0`）落在**手指下最深的那个元素**上（不是卡根）——
 *   因为 `bindCardDrag` 要读 `e.target.closest('button')` 来放行"翻面"按钮。
 * - 过程：`document` 上的 `mousemove`；`render.ts` 自己按 8px 阈值决定进不进拖拽。
 * - 结束：`document` 上的 `mouseup`；`render.ts` 用 `elementFromPoint` 判落点。
 * - 取消：`pointercancel` ⇒ 在**起点**补一次 `mouseup`（起点在手牌区 ⇒ 落点判据必不成立
 *   ⇒ 等价于"取消"，幽灵卡与高亮被清掉）。窗口失焦同样处理。
 * - 多指：同一时刻只跟一根手指（第一根按下且落在可拖面上的那根）；第二根进来只计数、
 *   不派发任何东西 —— 至少不打架、不崩。
 * ========================================================================== */

/**
 * 桥的**只读**读数。夹具拿它证"这一次按下只桥了一次、而且兼容鼠标事件真的被拦下了"。
 *
 * 注意：它挂在 `globalThis.__t39Touch`（无条件，不开 `#g5probe=1` 也有）：本模块在默认路径
 * 上只多一个对象字面量与几个整数自增，没有任何分支行为依赖它。
 */
export interface TouchBridgeProbe {
  /** 是否装了桥（无触摸能力的设备 = false，且一个监听器都没装） */
  enabled: boolean;
  /** 设备侧读数：`(pointer: coarse)` / `(any-pointer: coarse)` / `navigator.maxTouchPoints` */
  coarse: boolean;
  anyCoarse: boolean;
  maxTouchPoints: number;
  /** 收到过几次 `pointerType === 'touch'` 的 `pointerdown` */
  touchDowns: number;
  /**
   * ★ 修复轮（评审 A1）：**按指针类型分流的计数** —— 每个 `pointerdown` 先在这里 +1，
   * 之后才轮到 `pointerType === 'touch'` 那道门。
   *
   * 为什么必须有它：判据③（桌面零影响）原来只断言 `enabled === false`，那条断言挂在
   * **启用算法**上 —— 评审把启用条件改成"永远启用"之后，桌面观感与基线一字不差、13 条守卫
   * 全绿 ⇒ "零影响"真正扛住的是 `pointerType` 那道门。有了这三个数，判据才能改成断言
   * **分流事实**："鼠标指针被看到过（`mouse >= 1`），而它一条都没进桥（`bridges === 0`）"。
   */
  pointerDownSeen: { mouse: number; touch: number; pen: number; other: number };
  /** 同上，`pointermove` 的分流计数 */
  pointerMoveSeen: { mouse: number; touch: number; pen: number; other: number };
  /** 其中落在可拖面上、真的起了桥的次数 */
  bridges: number;
  /** 桥派发出去的合成鼠标事件条数（`mousedown` / `mousemove` / `mouseup` 分开记） */
  syntheticDown: number;
  syntheticMove: number;
  syntheticUp: number;
  /** 被拦下的**浏览器兼容鼠标事件**条数（判据 ③ 的"没有一次点击触发两次"靠它） */
  compatBlocked: number;
  /** `pointercancel` 走的取消次数（在起点补 `mouseup` 那种） */
  cancels: number;
  /** 会话进行中进来的第二根（或非首指）指针数 —— 只计数，不参与 */
  extraPointers: number;
  /** 最近一次见到的 `pointerType`（鼠标档应当停在 `mouse` 或 `null`） */
  lastPointerType: string | null;
}

/** 可拖面：`render.ts` 里挂了 `mousedown` 的那几族节点（`.card` 覆盖手牌/草稿/场上卡）。 */
const BRIDGE_SURFACE = '.hand-shield, .card, .draft-card';

/** 一次触摸会话（一根手指）。 */
interface TouchSession {
  id: number;
  x0: number;
  y0: number;
  lastX: number;
  lastY: number;
  /** 动过没有（超过 4px）—— 只用来决定"要不要把后面那个 click 吃掉" */
  moved: boolean;
}

let installed = false;
let session: TouchSession | null = null;
/**
 * 拦截兼容鼠标事件的截止时刻（`performance.now()` 口径）。
 *
 * 为什么是"截止时刻"而不是"会话是否存在"：Chrome 的兼容鼠标事件排在 `touchend` **之后**
 * （实测顺序 `pointerdown`→`touchstart`→`pointerup`→`touchend`→`mousedown`→`mouseup`→`click`），
 * 而 `pointerup` 一到会话就结束了 ⇒ 若按会话判，后面那三个正好漏过去（双重触发）。
 * 窗口取 1.5s（远大于同一次手势的尾巴），并在原生 `click` 一到就归零 ——
 * 于是"这一根手指刚走完"之后，真鼠标立刻又能用。
 */
let guardUntil = 0;
/** 拖拽后要吃掉的那一个 `click`（避免落在重画后的新 DOM 上误触发一次"点槽打出"） */
let killNextClick: ((ev: Event) => void) | null = null;

const probe: TouchBridgeProbe = {
  enabled: false,
  coarse: false,
  anyCoarse: false,
  maxTouchPoints: 0,
  touchDowns: 0,
  pointerDownSeen: { mouse: 0, touch: 0, pen: 0, other: 0 },
  pointerMoveSeen: { mouse: 0, touch: 0, pen: 0, other: 0 },
  bridges: 0,
  syntheticDown: 0,
  syntheticMove: 0,
  syntheticUp: 0,
  compatBlocked: 0,
  cancels: 0,
  extraPointers: 0,
  lastPointerType: null,
};

/** 把一个 `pointerType` 记进分流计数（mouse / touch / pen / other）。 */
function notePointerSeen(bucket: { mouse: number; touch: number; pen: number; other: number }, type: string): void {
  if (type === 'mouse') bucket.mouse += 1;
  else if (type === 'touch') bucket.touch += 1;
  else if (type === 'pen') bucket.pen += 1;
  else bucket.other += 1;
}

/** 给合成事件盖章：捕获阶段那三只"兼容鼠标事件"的眼睛靠它区分自己人。 */
const SYNTHETIC = '__t39Synthetic';
type Marked = Event & { [SYNTHETIC]?: boolean };

function mark(ev: Event): void {
  (ev as Marked)[SYNTHETIC] = true;
}
function isMine(ev: Event): boolean {
  return (ev as Marked)[SYNTHETIC] === true;
}

/**
 * 派发一个合成鼠标事件。
 *
 * `button: 0` + `buttons` 是必须的：`bindCardDrag` / `bindDraftDrag` / `bindShieldDrag`
 * 的第一句都是 `if (e.button !== 0) return;`。
 */
function dispatchMouse(
  type: 'mousedown' | 'mousemove' | 'mouseup',
  target: EventTarget,
  x: number,
  y: number,
  buttons: number,
): void {
  const ev = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    composed: true,
    view: window,
    detail: 1,
    button: 0,
    buttons,
    clientX: x,
    clientY: y,
    screenX: x,
    screenY: y,
  });
  mark(ev);
  target.dispatchEvent(ev);
  if (type === 'mousedown') probe.syntheticDown += 1;
  else if (type === 'mousemove') probe.syntheticMove += 1;
  else probe.syntheticUp += 1;
}

/** 把"这一根手指刚走完"的窗口收干净（原生 click 一到就调用）。 */
function clearGuard(): void {
  guardUntil = 0;
  releaseKillClick();
}

function releaseKillClick(): void {
  if (killNextClick !== null) {
    document.removeEventListener('click', killNextClick, true);
    killNextClick = null;
  }
}

/** 结束后要吃掉的那一个 click（只在**真的拖过**时挂，且下一次 pointerdown 立刻摘掉）。 */
function armKillClick(): void {
  releaseKillClick();
  const kill = (ev: Event): void => {
    ev.stopPropagation();
    ev.preventDefault();
  };
  killNextClick = kill;
  document.addEventListener('click', kill, true);
  window.setTimeout(releaseKillClick, 900);
}

function onPointerDown(e: PointerEvent): void {
  probe.lastPointerType = e.pointerType;
  notePointerSeen(probe.pointerDownSeen, e.pointerType); // ★ 分流计数在**门之前**（评审 A1）
  if (e.pointerType !== 'touch') return; // 鼠标/笔：一个字都不动它
  probe.touchDowns += 1;
  releaseKillClick(); // 新的一根手指进来 ⇒ 上一次的 click 通缉令作废（不许吃掉这一次的点击）
  if (session !== null || e.isPrimary === false) {
    probe.extraPointers += 1; // 第二根手指：不打架
    return;
  }
  const at = (document.elementFromPoint(e.clientX, e.clientY) ?? (e.target as Element | null)) as HTMLElement | null;
  const surface = at === null ? null : at.closest(BRIDGE_SURFACE);
  if (at === null || surface === null) return; // 不是可拖面：保持浏览器原生 tap → click
  session = { id: e.pointerId, x0: e.clientX, y0: e.clientY, lastX: e.clientX, lastY: e.clientY, moved: false };
  probe.bridges += 1;
  guardUntil = performance.now() + 1500;
  dispatchMouse('mousedown', at, e.clientX, e.clientY, 1);
}

function onPointerMove(e: PointerEvent): void {
  notePointerSeen(probe.pointerMoveSeen, e.pointerType);
  if (e.pointerType !== 'touch') return;
  const s = session;
  if (s === null || e.pointerId !== s.id) return;
  s.lastX = e.clientX;
  s.lastY = e.clientY;
  if (!s.moved && Math.hypot(e.clientX - s.x0, e.clientY - s.y0) > 4) s.moved = true;
  dispatchMouse('mousemove', document, e.clientX, e.clientY, 1);
}

function onPointerUp(e: PointerEvent): void {
  if (e.pointerType !== 'touch') return;
  const s = session;
  if (s === null || e.pointerId !== s.id) return;
  session = null;
  /**
   * `pointerup` 的坐标兜底：`touchend` 本身不带触点（`touches` 是空的），实测 CDP
   * `Input.dispatchTouchEvent` 的 `touchEnd` 有时给出 `(0,0)`。而 `render.ts` 的 `onUp`
   * 就是拿 `clientX/clientY` 去 `elementFromPoint` 找落点 ⇒ 丢了坐标等于"拖到屏幕左上角"。
   * 兜底用**这一根手指最后一次已知位置**（没有移动时就是按下点）。
   */
  const upX = e.clientX === 0 && e.clientY === 0 && (s.lastX !== 0 || s.lastY !== 0) ? s.lastX : e.clientX;
  const upY = e.clientX === 0 && e.clientY === 0 && (s.lastX !== 0 || s.lastY !== 0) ? s.lastY : e.clientY;
  guardUntil = performance.now() + 1500; // 兼容鼠标事件还在后面（click 一到就归零）
  if (s.moved) {
    dispatchMouse('mousemove', document, upX, upY, 1);
    armKillClick();
  }
  dispatchMouse('mouseup', document, upX, upY, 0);
}

/** 浏览器把手势收走了（正常路径不该发生：`touch-action: none` 挡着）⇒ 按"取消"处理。 */
function cancelSession(): void {
  const s = session;
  if (s === null) return;
  session = null;
  probe.cancels += 1;
  guardUntil = performance.now() + 1500;
  releaseKillClick();
  dispatchMouse('mouseup', document, s.x0, s.y0, 0);
}

function onPointerCancel(e: PointerEvent): void {
  if (e.pointerType !== 'touch') return;
  if (session !== null && e.pointerId !== session.id) return;
  cancelSession();
}

/**
 * 捕获阶段的"兼容鼠标事件"闸门。
 *
 * 只在**这一根手指刚走完**的窗口内生效（`guardUntil`），而且放行两类：
 *  - 本桥自己派发的（`SYNTHETIC` 章）；
 *  - 窗口过期之后的（真鼠标 / 别的夹具）。
 * `click` 不在拦截名单里 —— 那是"点卡选中 → 点槽打出"唯一的一条路。
 */
function blockCompatMouse(e: MouseEvent): void {
  if (isMine(e)) return;
  if (performance.now() > guardUntil) return;
  probe.compatBlocked += 1;
  e.stopPropagation();
  e.preventDefault();
}

/**
 * 装上桥。幂等（重复调用只有第一次生效）。
 *
 * 返回值是那份只读读数，方便别处（探针）读同一份。
 */
export function initTouchBridge(): TouchBridgeProbe {
  if (installed) return probe;
  installed = true;
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  const anyCoarse = window.matchMedia('(any-pointer: coarse)').matches;
  const maxTouchPoints = navigator.maxTouchPoints ?? 0;
  probe.coarse = coarse;
  probe.anyCoarse = anyCoarse;
  probe.maxTouchPoints = maxTouchPoints;
  probe.enabled = maxTouchPoints > 0 || coarse || anyCoarse;
  (globalThis as { __t39Touch?: TouchBridgeProbe }).__t39Touch = probe;
  if (!probe.enabled) return probe; // 没有触摸能力：一个监听器都不装

  document.addEventListener('pointerdown', onPointerDown, { capture: true, passive: false });
  document.addEventListener('pointermove', onPointerMove, { capture: true, passive: false });
  document.addEventListener('pointerup', onPointerUp, { capture: true, passive: false });
  document.addEventListener('pointercancel', onPointerCancel, { capture: true, passive: false });
  for (const type of ['mousedown', 'mousemove', 'mouseup'] as const) {
    document.addEventListener(type, blockCompatMouse, true);
  }
  // 原生 click（点卡选中那条路）一到 ⇒ 这一根手指的手势彻底结束，闸门立刻放开。
  document.addEventListener('click', clearGuard, true);
  // 与 `render.ts` 的 `window blur` 清理同款：失焦即取消（幽灵卡不许留在屏上）。
  window.addEventListener('blur', cancelSession);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') cancelSession();
  });
  return probe;
}
