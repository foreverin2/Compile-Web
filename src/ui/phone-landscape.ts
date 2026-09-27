/* ============================================================================
 * G5/T39：手机竖屏 ⇒ 横屏游玩（平板不进来）
 *
 * ## 为什么要它（用户 2026-09-27 真机反馈第 2 条）
 *
 * "目前只有平板能够适配我们的那个界面尺寸大小。我希望如果识别出某玩家的设备为手机则改为
 * 横置整个操作页面（就和打开一些手机游戏一样，直接横屏游玩）"。
 *
 * ## 检测（一条判据，写在 `detect()` 里，读数也由它出）
 *
 * `(pointer: coarse)` 或 `(any-pointer: coarse)` 或 `navigator.maxTouchPoints > 0`
 * **且 屏幕短边 ≤ 500 CSS px** ⇒ 视为手机。
 * 平板不卷进来：iPad 短边 768（竖）/ 810 起、常见安卓平板 600 起，都 > 500。
 *
 * ## 竖屏时的三种能力，按顺序试（每种都 `try/catch`，各自的结局都留读数）
 *
 * 1. `documentElement.requestFullscreen()` —— 浏览器全屏；
 * 2. `screen.orientation.lock('landscape')` —— 方向锁（**iOS Safari 没有这个 API**）；
 * 3. 两者都不行 ⇒ **CSS 旋转**：给 `<html>` 加 `.t39-rot90`，`#app` 转 90° 并把
 *    `vw`/`vh` 交换成宽高（样式在 `styles-touch.css`）。
 *
 * 旋转之后**命中测试仍然正确**：浏览器做 `elementFromPoint` 时会把祖先的
 * `transform` 算进去（`touch-bridge.ts` 因此不做任何坐标换算，直接把视口坐标转发）。
 *
 * ## 门（gate）
 *
 * 只出现在"手机 + 竖屏 + 还没旋转"这一格；一旦横屏或旋转生效就**从 DOM 里摘掉**
 * （不是盖一层透明遮罩 —— 那会挡后面的正常交互）。
 *
 * ## 修复轮 a + b（用户 2026-09-27 裁决）
 *
 * 第一轮交活后实测出：844×390 那一档远程棋盘的**左栏整体溢出到左边界之外**
 * （`.hand` x -285..142、`.next-btn` x -111..-64），而 `scrollWidth == clientWidth`
 * 既滚不出来也命中不了 ⇒ 手机上打完一张牌**点不到「下一步」**。用户裁决走 a + b：
 *
 * **(a) 整页等比缩放**（`syncFit()`）：量出"必须落进视口"那一族（`.board`/`.net-board` +
 * 自己手牌区）在**布局空间**的包围盒（用 `offsetTop/offsetLeft` 累加，与 `transform` 无关），
 * 取 `k = min(vw / needW, vh / needH, 1)`，再把 `#app` 的 `transform` 写成
 * `translate(tx, ty) scale(k) [rotate(90deg) translateY(-100%)]`（旋转档多带后半截），
 * 并把盒心摆到视口中心。`#app` 在本档改成 `overflow: visible` —— 否则**负方向溢出的内容
 * 被裁掉**（滚不动也点不到，那正是第一轮的根因）。
 * `k` 有**地板** `K_FLOOR`（见那里的说明）；打到地板仍放不下就如实报"勉强/不能用"。
 *
 * **(b) 关键按钮钉在视口角**：`.next-btn` / `.choice-confirm` 被**移到 `document.body`**
 * 并挂 `.t39-pin`（`position: fixed` 到右下/底部中央）。为什么必须移出 `#app`：
 * ① `#app` 带 `transform` ⇒ 它是 `position: fixed` 后代的**包含块**，留在里面"钉"不到视口；
 * ② 缩放把版面缩到 0.5 上下，按钮本来就该保持 1:1 好点。移出后它自然也不再被
 * `.net-board .net-action-bar { position: static }` 那条规则按在左栏里。
 * ========================================================================== */

/** 检测读数（夹具判据 ④ 逐档读它）。 */
export interface PhoneDetect {
  coarse: boolean;
  anyCoarse: boolean;
  maxTouchPoints: number;
  screenW: number;
  screenH: number;
  /** `min(screenW, screenH)` —— "短边" */
  shortSide: number;
  innerW: number;
  innerH: number;
  portrait: boolean;
  isPhone: boolean;
  gateVisible: boolean;
  gateRect: { x: number; y: number; w: number; h: number } | null;
  rotated: boolean;
  rotationClass: string;
}

/** 点一次门按钮的结局（全屏 / 方向锁 / 旋转各自走到哪一步）。 */
export interface PhonePressRecord {
  /** `ok` | `threw` | `unsupported` | `timeout` | `not-attempted` */
  fullscreen: string;
  fullscreenErr: string | null;
  fullscreenElement: boolean;
  /** 同上四态 + `not-attempted` */
  orientationLock: string;
  orientationLockErr: string | null;
  waitMs: number;
  after: PhoneDetect;
}

/** 整页等比缩放（a）的读数（夹具判据 1/2/4 读它）。 */
export interface PhoneFitRecord {
  /** 缩放档是否生效（手机 + 横屏布局） */
  on: boolean;
  /** 量出来的"必须落进视口"那一族的布局空间包围盒（整块棋盘 + 手牌，未缩放） */
  box: { minX: number; minY: number; maxX: number; maxY: number; w: number; h: number } | null;
  /** 主判据那一族（手牌 + 两个关键按钮）的布局空间包围盒 */
  critBox: { minX: number; minY: number; maxX: number; maxY: number; w: number; h: number } | null;
  /**
   * 这一档实际摆放的是"整块棋盘"还是退化成"主判据那一族"。
   * `false` = 整块棋盘要在**地板之下**（`kUnionNeeded`）才放得下 ⇒ 不许缩那么小，
   * 于是只按主判据那一族摆，棋盘其余部分仍溢出（如实报）。
   */
  boardFit: boolean;
  /** 整块棋盘要多少 k 才放得下（没量到就是 null） */
  kUnionNeeded: number | null;
  /** 矫正平移量（一级：主判据那一族的出界量） */
  corrected?: { dx: number; dy: number };
  /** 二级（链路槽）的夹取结果与最终可见性 */
  slotNudge?: { dx: number; dy: number; wanted: { dx: number; dy: number } };
  slotsInside?: boolean;
  slotsRect?: { x: number; y: number; right: number; bottom: number } | null;
  /** 屏幕空间需要的宽高（旋转档 = 交换两轴） */
  need: { w: number; h: number } | null;
  /** 未夹地板的原始系数 */
  kRaw: number | null;
  /** 实际用的系数（夹了地板与 1） */
  k: number | null;
  /** 地板值（见 `K_FLOOR` 的说明） */
  kFloor: number;
  /** 打到地板了没有（`kRaw < K_FLOOR` ⇒ true；此时**放不下就得如实说**） */
  floored: boolean;
  tx: number;
  ty: number;
  /** 按 k 缩放之后，这一族是否真的落进视口 */
  fits: boolean | null;
  /** 参与测量的选择器（逐条） */
  measured: { sel: string; count: number }[];
  /** 缩放后那一族里最小的字号（`minFontPx * k`）—— 判断"还能不能看" */
  minFontPx: number | null;
  minFontPxScaled: number | null;
  /** 被钉到视口角的按钮 */
  pinned: { next: boolean; choice: boolean };
  /** `#app` 的 `overflow` / `transform`（读数用） */
  appOverflow: string | null;
  appTransform: string | null;
}

export interface PhoneLandscapeProbe {
  detect(): PhoneDetect;
  /** 与点按钮**同一条路**（探针自己调它时没有用户手势 ⇒ 全屏那条必然被拒，这也是一条读数） */
  press(): Promise<PhonePressRecord>;
  lastPress(): PhonePressRecord | null;
  /** 判据 ⑤ 用：摘掉旋转类、把门重新装回去（模拟"刚打开页面的那一格"） */
  reset(): void;
  /** 修复轮 a + b 的读数（只读） */
  fit(): PhoneFitRecord;
  /** 强制重算一次缩放（夹具在改视口/改状态之后要立刻读，不等 observer） */
  resync(): PhoneFitRecord;
}

const ROT_CLASS = 't39-rot90';
const GATE_CLASS = 't39-gate';
const GATE_BTN_CLASS = 't39-gate-btn';
const FIT_CLASS = 't39-fit';
const PIN_CLASS = 't39-pin';
const PIN_NEXT_CLASS = 't39-pin-next';
const PIN_CHOICE_CLASS = 't39-pin-choice';
/** 手机判定的短边上界（CSS px）。平板短边 ≥ 600 ⇒ 不进这一格。 */
const PHONE_SHORT_SIDE_MAX = 500;
/**
 * ★ 缩放系数的**地板**：`k` 不许低于它。
 *
 * 为什么是 0.5：远程棋盘上最小的**常规**字号是 11px（卡面小字/协议格标签，见
 * `styles-net.css` 的 `--card-*` 一族；实测那一族最小 `font-size` 就在 10~11px）。
 * 手机上 DPR 普遍 ≥ 2，0.5 之后 11px → 5.5 CSS px（≈ 11 物理像素），是"还认得出字形、
 * 但已经费劲"的下限；再往下（比如铺满所需的 0.35）就是**不可读**，宁可按地板放、
 * 把"放不下"如实写出来，也不许为了指标好看把地板调到不可读。
 */
const K_FLOOR = 0.5;
/**
 * 必须落进视口的那一族（(a) 的目标：**整块棋盘 + 自己手牌**）。
 * **不含** `.next-btn` / `.choice-confirm`（它们由 (b) 单独钉到视口角，且 1:1 不缩放）——
 * 这样"去掉缩放类"与"去掉按钮固定"两个变异各自都有一格会红。
 */
const FIT_TARGETS: readonly string[] = ['.board', '.net-board', '.hand.self'];
/**
 * **主判据那一族**（§5 判据 1 逐个判的就是它们）：自己手牌区的每一张卡（在 `.hand.self` 里）
 * 与两个关键按钮。缩放档算 `k` 的第一目标是 `FIT_TARGETS`（整块棋盘），但那一族要的 `k`
 * 低于地板时退化成只摆这一族（见 `syncFit()` 的两级目标）。
 *
 * ★ 修复轮补：它与"自己那三条链路槽"（`slotTargets()`）是**两级优先级** —— 主判据那一族
 * **必须**在视口内（矫正阶段硬保证），链路槽是"尽力也摆进来、但不许把主判据挤出去"。
 * 实测：两族在物理横屏 844×390 上相距 887px，一起算要 `k = 0.44`（地板之下）；旋转档更极端。
 * 若把两族合成一个盒子算 `k`，结果是地板生效、只对了一边、手牌反而被挤出视口（实测过一次）。
 */
function critTargets(): string[] {
  return ['.hand.self', '.next-btn', '.choice-confirm'];
}

/** 自己那三条链路槽（落点；`data-player` 取自 `.hand.self`）—— 二级目标，见上方说明。 */
function slotTargets(): string[] {
  const hand = document.querySelector<HTMLElement>('.hand.self');
  const p = hand?.dataset.player;
  return p === undefined ? [] : [`.stack-slot[data-player="${p}"]`];
}

let installed = false;
let gate: HTMLElement | null = null;
let lastPressRecord: PhonePressRecord | null = null;
/** 最近一次 `syncFit()` 算出来的数（`readFit()` 只读它，不重算） */
let lastFit: {
  box: FitBox | null; critBox: FitBox | null; need: { w: number; h: number } | null;
  kRaw: number | null; k: number | null; tx: number; ty: number; fits: boolean | null;
  boardFit: boolean; kUnionNeeded: number | null; corrected?: { dx: number; dy: number }; slotNudge?: { dx: number; dy: number; wanted: { dx: number; dy: number } }; slotsInside?: boolean; slotsRect?: { x: number; y: number; right: number; bottom: number } | null;
  measured: { sel: string; count: number }[]; minFontPx: number | null;
} = { box: null, critBox: null, need: null, kRaw: null, k: null, tx: 0, ty: 0, fits: null, boardFit: false, kUnionNeeded: null, measured: [], minFontPx: null };
let fitting = false;
let fitScheduled = false;
/** 上一次钉按钮时 `#app` 的渲染代（`firstElementChild`）—— 用来识别"这一代还要不要这个按钮" */
let pinGen: Element | null = null;

const sleep = (ms: number): Promise<void> => new Promise((r) => window.setTimeout(r, ms));

function errText(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  return String(err);
}

function detect(): PhoneDetect {
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  const anyCoarse = window.matchMedia('(any-pointer: coarse)').matches;
  const maxTouchPoints = navigator.maxTouchPoints ?? 0;
  const screenW = Math.round(window.screen?.width ?? window.innerWidth);
  const screenH = Math.round(window.screen?.height ?? window.innerHeight);
  const shortSide = Math.min(screenW, screenH);
  const portrait = window.innerHeight > window.innerWidth;
  const isPhone = (coarse || anyCoarse || maxTouchPoints > 0) && shortSide <= PHONE_SHORT_SIDE_MAX;
  const rotated = document.documentElement.classList.contains(ROT_CLASS);
  const g = gate !== null && gate.isConnected ? gate : null;
  const r = g === null ? null : g.getBoundingClientRect();
  return {
    coarse,
    anyCoarse,
    maxTouchPoints,
    screenW,
    screenH,
    shortSide,
    innerW: window.innerWidth,
    innerH: window.innerHeight,
    portrait,
    isPhone,
    gateVisible: g !== null,
    gateRect: r === null ? null : { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) },
    rotated,
    rotationClass: ROT_CLASS,
  };
}

function applyRotation(): void {
  document.documentElement.classList.add(ROT_CLASS);
  removeGate();
}

function clearRotation(): void {
  document.documentElement.classList.remove(ROT_CLASS);
}

function removeGate(): void {
  if (gate !== null) {
    gate.remove();
    gate = null;
  }
}

function buildGate(): HTMLElement {
  const box = document.createElement('div');
  box.className = GATE_CLASS;
  const title = document.createElement('p');
  title.className = 't39-gate-title';
  title.textContent = '请把设备横过来';
  const hint = document.createElement('p');
  hint.className = 't39-gate-hint';
  hint.textContent = '这个界面按横屏排版。点下面的按钮直接横屏；如果这台设备不支持全屏或方向锁，页面会自己转 90 度。';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = GATE_BTN_CLASS;
  btn.textContent = '横屏游玩';
  btn.addEventListener('click', () => {
    void press();
  });
  box.appendChild(title);
  box.appendChild(hint);
  box.appendChild(btn);
  return box;
}

/** 门只在"手机 + 竖屏 + 还没旋转"这一格存在；其余一律从 DOM 摘掉。 */
function syncGate(): void {
  /**
   * ★ 真的横过来了 ⇒ **立刻把 CSS 旋转撤掉**。
   *
   * 少这一句会双重旋转：`press()` 里那次旋转是按"当时还是竖屏"加的，之后设备真转了
   * （方向锁成功 / 用户自己转 / 平板支架换了方向），`resize` 一响就走到这里 ——
   * 若只摘门不摘旋转类，`#app` 会在已经横屏的视口里**再转 90°**（实测读数：切到
   * 844x390 之后 `rotated` 仍是 true，`.hand` 被顶到 y=-327 那种位置）。
   */
  if (detect().portrait === false && detect().rotated) clearRotation();
  const d = detect();
  const need = d.isPhone && d.portrait && !d.rotated;
  if (!need) {
    removeGate();
    return;
  }
  if (gate === null) {
    gate = buildGate();
    document.body.appendChild(gate);
  }
}

/* ============================================================================
 * 修复轮 a + b：整页等比缩放 + 关键按钮钉在视口内
 * ========================================================================== */

/** 累加 `offsetTop/offsetLeft` 到 `#app`（**布局空间**，与 transform/scale 无关）。 */
function accumToApp(app: HTMLElement, el: HTMLElement): { top: number; left: number; reachedApp: boolean } {
  let top = 0; let left = 0; let n: HTMLElement | null = el; let guard = 0;
  while (n !== null && n !== app && guard < 60) {
    top += n.offsetTop;
    left += n.offsetLeft;
    n = n.offsetParent as HTMLElement | null;
    guard += 1;
  }
  return { top, left, reachedApp: n === app };
}

interface FitBox { minX: number; minY: number; maxX: number; maxY: number; w: number; h: number }

/** 量一组选择器在**布局空间**的包围盒（未缩放）。 */
function measureFitBox(app: HTMLElement, sels: readonly string[]): { box: FitBox | null; measured: { sel: string; count: number }[] } {
  const measured: { sel: string; count: number }[] = [];
  const nodes: HTMLElement[] = [];
  for (const sel of sels) {
    const found = Array.from(document.querySelectorAll<HTMLElement>(sel));
    measured.push({ sel, count: found.length });
    for (const el of found) if (!nodes.includes(el)) nodes.push(el);
  }
  let minX = Number.POSITIVE_INFINITY; let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY; let maxY = Number.NEGATIVE_INFINITY;
  let any = false;
  for (const el of nodes) {
    const a = accumToApp(app, el);
    if (!a.reachedApp) continue;
    any = true;
    minX = Math.min(minX, a.left);
    minY = Math.min(minY, a.top);
    maxX = Math.max(maxX, a.left + el.offsetWidth);
    maxY = Math.max(maxY, a.top + el.offsetHeight);
  }
  if (!any) return { box: null, measured };
  return { box: { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY }, measured };
}

/** 那一族里最小的字号（缩放前）—— 用来算"缩完还能不能看"。 */
function minFontPxOf(app: HTMLElement): number | null {
  const roots: HTMLElement[] = [];
  for (const sel of critTargets()) for (const el of Array.from(document.querySelectorAll<HTMLElement>(sel))) roots.push(el);
  let min: number | null = null;
  let seen = 0;
  for (const root of roots) {
    const all = [root, ...Array.from(root.querySelectorAll<HTMLElement>('*'))];
    for (const el of all) {
      if (seen > 400) break;
      seen += 1;
      if ((el.textContent ?? '').trim().length === 0) continue;
      const fs = Number.parseFloat(window.getComputedStyle(el).fontSize);
      if (!Number.isFinite(fs) || fs <= 0) continue;
      min = min === null ? fs : Math.min(min, fs);
    }
  }
  if (min === null) {
    const appFs = Number.parseFloat(window.getComputedStyle(app).fontSize);
    min = Number.isFinite(appFs) ? appFs : null;
  }
  return min;
}

/** 当前这一刻的缩放读数（不重算，只读已经写进 DOM 的东西） */
function readFit(): PhoneFitRecord {
  const d = detect();
  const app = document.getElementById('app');
  const cs = app === null ? null : window.getComputedStyle(app);
  const on = document.documentElement.classList.contains(FIT_CLASS);
  return {
    on,
    box: lastFit.box,
    critBox: lastFit.critBox,
    boardFit: lastFit.boardFit,
    kUnionNeeded: lastFit.kUnionNeeded,
    corrected: lastFit.corrected,
    slotNudge: lastFit.slotNudge,
    slotsInside: lastFit.slotsInside,
    slotsRect: lastFit.slotsRect,
    need: lastFit.need,
    kRaw: lastFit.kRaw,
    k: lastFit.k,
    kFloor: K_FLOOR,
    floored: lastFit.kRaw !== null && lastFit.kRaw < K_FLOOR,
    tx: lastFit.tx,
    ty: lastFit.ty,
    fits: lastFit.fits,
    measured: lastFit.measured,
    minFontPx: lastFit.minFontPx,
    minFontPxScaled: lastFit.minFontPx === null || lastFit.k === null ? null : Math.round(lastFit.minFontPx * lastFit.k * 100) / 100,
    pinned: { next: document.querySelectorAll(`.${PIN_CLASS}.${PIN_NEXT_CLASS}`).length > 0, choice: document.querySelectorAll(`.${PIN_CLASS}.${PIN_CHOICE_CLASS}`).length > 0 },
    appOverflow: cs === null ? null : cs.overflow,
    appTransform: cs === null ? null : cs.transform,
  };
}

/**
 * 把这一族按钮从 `#app` 里**挪到 `document.body`**（`#app` 有 transform ⇒ 钉不到视口）。
 *
 * 注意（修复轮 2 实测踩到的）：重画之后**当前这一幕可能不再有「下一步」**（`render.ts` 只在
 * `legal` 里有 `advance` 时才产出 `.next-btn`）。旧写法在这种情况下"留着旧的" ⇒ 屏上会
 * **留一个陈旧按钮**：它的 `click` 闭包绑的是**上一帧**的 `nextAction`，点下去提交的是过期动作
 * （实测：`end` 步上连点 8 次 `step` 一动不动）。所以这里用 `#app` 的**渲染代**判断：
 * `firstElementChild` 换了（`renderApp` 每次 `root.textContent = ''` 后重建，节点必然是新的）
 * 而这一代里找不到该按钮 ⇒ 把钉住的旧节点摘掉。
 */
function syncPin(root: HTMLElement, selectors: readonly string[], cls: string): boolean {
  const gen = root.firstElementChild;
  const genChanged = pinGen !== null && gen !== null && gen !== pinGen;
  let live: HTMLElement | null = null;
  for (const sel of selectors) {
    const el = root.querySelector<HTMLElement>(sel);
    if (el !== null) { live = el; break; }
  }
  const existing = document.querySelector<HTMLElement>(`.${PIN_CLASS}.${cls}`);
  if (live === null) {
    // 这一代里没有这个按钮：只有"换过代"才说明它真的不该在屏上 ⇒ 摘掉陈旧的
    if (existing !== null && genChanged) { existing.remove(); pinGen = gen; return false; }
    pinGen = gen ?? pinGen;
    return existing !== null;
  }
  if (live === existing) { pinGen = gen; return true; } // 已经是它了
  if (existing !== null) existing.remove(); // 旧的作废（每次重画都是新节点）
  live.classList.add(PIN_CLASS, cls);
  document.body.appendChild(live);
  pinGen = gen;
  return true;
}

/** 关掉缩放档：摘类、把 `#app` 的内联变量清掉、把钉住的按钮还回去（尽力） */
function clearFit(): void {
  document.documentElement.classList.remove(FIT_CLASS);
  document.documentElement.style.removeProperty('--t39-k');
  document.documentElement.style.removeProperty('--t39-tx');
  document.documentElement.style.removeProperty('--t39-ty');
  const app = document.getElementById('app');
  if (app !== null && app.style.transform !== '') app.style.transform = '';
  for (const el of Array.from(document.querySelectorAll<HTMLElement>(`.${PIN_CLASS}`))) {
    el.classList.remove(PIN_CLASS, PIN_NEXT_CLASS, PIN_CHOICE_CLASS);
    el.remove(); // 它是上一帧的重画产物 ⇒ 下一次 renderApp 会产出新的那个，这里直接扔掉
  }
  lastFit = { box: null, critBox: null, need: null, kRaw: null, k: null, tx: 0, ty: 0, fits: null, boardFit: false, kUnionNeeded: null, measured: [], minFontPx: null };
}

/**
 * ★ (a) + (b) 的唯一入口：算缩放、写 CSS 变量、钉按钮。幂等，可以随时重算。
 *
 * ## 两级目标（实测逼出来的）
 *
 * 1. **整块棋盘 + 自己手牌**（`.board`/`.net-board` ∪ `.hand.self`）：`k = min(vw/needW, vh/needH, 1)`。
 *    物理横屏 844×390 下这一族要 `k ≈ 0.64`（> 地板 0.5 ⇒ 成立，整块棋盘进视口）。
 * 2. 但**旋转档**（竖屏 390×844 里把 `#app` 转 90°）下，布局盒虽然也是 844×390，棋盘却是按
 *    "竖屏高度"排的 ⇒ 布局 y 方向的跨度可以到 1500+，整块棋盘要 `k ≈ 0.26` —— **地板之下**。
 *    这一格按 §5 判据 4 的规矩：**不许把地板调到不可读**，于是退化成"按主判据那一族
 *    （`.hand.self`）摆放"（通常 `k = 1`，只做平移），并把 `boardFit: false`、
 *    `kUnionNeeded: 0.26` **如实写进读数**（棋盘其余部分仍溢出，报告照写）。
 *
 * 最后再走一遍**矫正**：按算出来的 `k/tx/ty` 落盘之后，量一次主判据那一族的**屏幕**矩形，
 * 出界就按超出量平移（仿射映射一次就够）—— 保证"手牌每一张都在视口内"不靠运气。
 */
function syncFit(): void {
  if (fitting) return; // 重入保护：钉按钮会改 DOM ⇒ 会再触发 observer
  fitting = true;
  try {
    const d = detect();
    const landscapeLayout = d.rotated || !d.portrait;
    const on = d.isPhone && landscapeLayout;
    const app = document.getElementById('app');
    if (!on || app === null) {
      if (document.documentElement.classList.contains(FIT_CLASS)) clearFit();
      lastFit.measured = [];
      return;
    }
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const H = app.offsetHeight; // 元素**未变换**的高度（旋转档 = 100vw）
    const union = measureFitBox(app, FIT_TARGETS);
    const crit = measureFitBox(app, critTargets());
    lastFit.measured = union.measured;
    const needOf = (b: FitBox) => (d.rotated ? { w: b.h, h: b.w } : { w: b.w, h: b.h });
    const kOf = (b: FitBox) => { const n = needOf(b); return Math.min(vw / n.w, vh / n.h, 1); };
    const unionBox = union.box;
    const critBox = crit.box;
    if (critBox === null && unionBox === null) { clearFit(); return; }
    const kUnion = unionBox === null ? 0 : kOf(unionBox);
    const kCrit = critBox === null ? 1 : kOf(critBox);
    const useUnion = unionBox !== null && kUnion >= K_FLOOR;
    const box = useUnion ? (unionBox as FitBox) : (critBox as FitBox);
    const need = needOf(box);
    const kRaw = useUnion ? kUnion : kCrit;
    const k = Math.max(K_FLOOR, Math.min(1, kRaw));
    const tx = d.rotated
      ? -k * (H - box.maxY) + (vw - k * need.w) / 2
      : -k * box.minX + (vw - k * need.w) / 2;
    const ty = d.rotated
      ? -k * box.minX + (vh - k * need.h) / 2
      : -k * box.minY + (vh - k * need.h) / 2;
    const root = document.documentElement;
    root.style.setProperty('--t39-k', String(Math.round(k * 10000) / 10000));
    root.style.setProperty('--t39-tx', `${Math.round(tx * 100) / 100}px`);
    root.style.setProperty('--t39-ty', `${Math.round(ty * 100) / 100}px`);
    root.classList.add(FIT_CLASS);
    lastFit = {
      box: unionBox,
      critBox,
      need,
      kRaw,
      k,
      tx,
      ty,
      fits: kRaw >= K_FLOOR,
      boardFit: useUnion,
      kUnionNeeded: unionBox === null ? null : Math.round(kUnion * 1000) / 1000,
      measured: union.measured,
      minFontPx: minFontPxOf(app),
    };
    // (b)：关键按钮钉到视口角
    syncPin(app, ['.next-btn'], PIN_NEXT_CLASS);
    syncPin(app, ['.choice-confirm'], PIN_CHOICE_CLASS);
    correctIntoViewport(app, vw, vh);
  } finally {
    fitting = false;
  }
}

/** 量一组选择器这一刻的**屏幕**包围盒（没量到就是 null）。 */
function screenBoxOf(sels: readonly string[]): { l: number; t: number; r: number; b: number } | null {
  let l = Number.POSITIVE_INFINITY; let t = Number.POSITIVE_INFINITY;
  let r = Number.NEGATIVE_INFINITY; let b = Number.NEGATIVE_INFINITY;
  let any = false;
  for (const sel of sels) {
    for (const el of Array.from(document.querySelectorAll<HTMLElement>(sel))) {
      const q = el.getBoundingClientRect();
      if (q.width <= 0 || q.height <= 0) continue;
      any = true;
      l = Math.min(l, q.left); t = Math.min(t, q.top);
      r = Math.max(r, q.right); b = Math.max(b, q.bottom);
    }
  }
  return any ? { l, t, r, b } : null;
}

/** 把一组选择器的屏幕包围盒摆进视口所需的位移（一侧对齐；整个比视口还大时只能对齐一边）。 */
function needShift(b: { l: number; t: number; r: number; b: number }, vw: number, vh: number): { dx: number; dy: number } {
  let dx = 0; let dy = 0;
  if (b.l < 0) dx = -b.l; else if (b.r > vw) dx = vw - b.r;
  if (b.t < 0) dy = -b.t; else if (b.b > vh) dy = vh - b.b;
  return { dx, dy };
}

const shift = (p: { x: number; y: number }, d: { dx: number; dy: number }) => ({ x: p.x + d.dx, y: p.y + d.dy });

/**
 * 矫正（**两级优先级** —— 见 `critTargets()` 的说明）：
 *  - 一级：主判据那一族（手牌 + 两个关键按钮）**必须**落进视口，位移按它算并**硬落盘**；
 *  - 二级：自己那三条链路槽**尽力**也摆进来，但位移要**夹在"一级仍在视口内"的可行区间里**
 *    （链路槽与手牌相距 887px 时夹完仍是 0 —— 那说明这一档确实摆不下，如实留在读数里）。
 * 只平移、不再改 `k`（`k` 由地板那一档决定）；`getBoundingClientRect` 已经把 transform 算进去。
 */
function correctIntoViewport(app: HTMLElement, vw: number, vh: number): void {
  const critBox = screenBoxOf(critTargets());
  if (critBox === null) return;
  const root = document.documentElement;
  const px = (s: string) => Number.parseFloat(s.replace('px', '')) || 0;
  const first = needShift(critBox, vw, vh);
  let tx = px(root.style.getPropertyValue('--t39-tx') || '0px') + first.dx;
  let ty = px(root.style.getPropertyValue('--t39-ty') || '0px') + first.dy;
  root.style.setProperty('--t39-tx', `${Math.round(tx * 100) / 100}px`);
  root.style.setProperty('--t39-ty', `${Math.round(ty * 100) / 100}px`);
  lastFit.tx = tx; lastFit.ty = ty;
  lastFit.corrected = { dx: Math.round(first.dx), dy: Math.round(first.dy) };
  // 二级：链路槽（夹在一级的可行区间里）
  const slotBox = screenBoxOf(slotTargets());
  if (slotBox === null) return;
  const critAfter = { l: critBox.l + first.dx, t: critBox.t + first.dy, r: critBox.r + first.dx, b: critBox.b + first.dy };
  const slotAfter = { l: slotBox.l + first.dx, t: slotBox.t + first.dy, r: slotBox.r + first.dx, b: slotBox.b + first.dy };
  const want = needShift(slotAfter, vw, vh);
  // 一级的可行区间（保住一级仍在视口内；盒子比视口大时区间退化成单点 0）
  const feasX = { lo: Math.min(-critAfter.l, vw - critAfter.r), hi: Math.max(-critAfter.l, vw - critAfter.r) };
  const feasY = { lo: Math.min(-critAfter.t, vh - critAfter.b), hi: Math.max(-critAfter.t, vh - critAfter.b) };
  const dx2 = Math.max(feasX.lo, Math.min(feasX.hi, want.dx));
  const dy2 = Math.max(feasY.lo, Math.min(feasY.hi, want.dy));
  if (dx2 !== 0 || dy2 !== 0) {
    tx += dx2; ty += dy2;
    root.style.setProperty('--t39-tx', `${Math.round(tx * 100) / 100}px`);
    root.style.setProperty('--t39-ty', `${Math.round(ty * 100) / 100}px`);
    lastFit.tx = tx; lastFit.ty = ty;
  }
  lastFit.slotNudge = { dx: Math.round(dx2), dy: Math.round(dy2), wanted: { dx: Math.round(want.dx), dy: Math.round(want.dy) } };
  const after = screenBoxOf(slotTargets());
  lastFit.slotsInside = after !== null && after.l >= -1 && after.t >= -1 && after.r <= vw + 1 && after.b <= vh + 1;
  lastFit.slotsRect = after === null ? null : { x: Math.round(after.l), y: Math.round(after.t), right: Math.round(after.r), bottom: Math.round(after.b) };
}

/** `#app` 每次重画都会换掉按钮节点 ⇒ 去抖之后再算一次 */
function scheduleFit(): void {
  if (fitScheduled) return;
  fitScheduled = true;
  window.requestAnimationFrame(() => {
    window.setTimeout(() => {
      fitScheduled = false;
      syncFit();
    }, 120);
  });
}

/** 给一个 promise 加硬上界（全屏/方向锁在无头浏览器里可能永不 settle）。 */
async function withTimeout(p: Promise<unknown>, ms: number): Promise<'ok' | 'timeout'> {
  let timer = 0;
  const timeout = new Promise<'timeout'>((res) => {
    timer = window.setTimeout(() => res('timeout'), ms);
  });
  try {
    const r = await Promise.race([p.then(() => 'ok' as const), timeout]);
    return r;
  } finally {
    if (timer !== 0) window.clearTimeout(timer);
  }
}

async function press(): Promise<PhonePressRecord> {
  const t0 = performance.now();
  const rec: PhonePressRecord = {
    fullscreen: 'not-attempted',
    fullscreenErr: null,
    fullscreenElement: false,
    orientationLock: 'not-attempted',
    orientationLockErr: null,
    waitMs: 0,
    after: detect(),
  };
  // 1) 全屏
  try {
    const el = document.documentElement as HTMLElement & { requestFullscreen?: (o?: FullscreenOptions) => Promise<void> };
    if (typeof el.requestFullscreen !== 'function') {
      rec.fullscreen = 'unsupported';
    } else {
      const r = await withTimeout(el.requestFullscreen.call(el, { navigationUI: 'hide' }), 2500);
      rec.fullscreen = r === 'ok' ? 'ok' : 'timeout';
    }
  } catch (err) {
    rec.fullscreen = 'threw';
    rec.fullscreenErr = errText(err);
  }
  rec.fullscreenElement = document.fullscreenElement !== null;
  // 2) 方向锁
  try {
    const o = screen.orientation as (ScreenOrientation & { lock?: (o: string) => Promise<void> }) | undefined;
    if (o === undefined || typeof o.lock !== 'function') {
      rec.orientationLock = 'unsupported';
    } else {
      const r = await withTimeout(o.lock('landscape'), 2500);
      rec.orientationLock = r === 'ok' ? 'ok' : 'timeout';
    }
  } catch (err) {
    rec.orientationLock = 'threw';
    rec.orientationLockErr = errText(err);
  }
  // 3) 还没横过来 ⇒ CSS 旋转兜底（这条永远有；iOS Safari 只有这一条）
  await sleep(350);
  if (window.innerHeight > window.innerWidth) applyRotation();
  else clearRotation();
  syncGate();
  syncFit();
  rec.waitMs = Math.round(performance.now() - t0);
  rec.after = detect();
  lastPressRecord = rec;
  return rec;
}

export function initPhoneLandscape(): void {
  if (installed) return;
  installed = true;
  syncGate();
  syncFit();
  window.addEventListener('resize', () => { syncGate(); syncFit(); }, { passive: true });
  window.addEventListener('orientationchange', () => { syncGate(); syncFit(); }, { passive: true });
  const o = screen.orientation as (ScreenOrientation & { addEventListener?: (t: string, f: () => void) => void }) | undefined;
  if (o !== undefined && typeof o.addEventListener === 'function') o.addEventListener('change', () => { syncGate(); syncFit(); });
  document.addEventListener('fullscreenchange', () => { syncGate(); syncFit(); });
  // `#app` 每次重画都会换掉 `.next-btn` / `.choice-confirm` 节点 ⇒ 去抖之后重算（钉回去）
  const app = document.getElementById('app');
  if (app !== null && typeof MutationObserver === 'function') {
    const mo = new MutationObserver(() => { scheduleFit(); });
    mo.observe(app, { childList: true, subtree: true });
  }
  window.addEventListener('resize', scheduleFit, { passive: true });
  (globalThis as { __t39Phone?: PhoneLandscapeProbe }).__t39Phone = {
    detect,
    press,
    lastPress: () => lastPressRecord,
    fit: readFit,
    resync: () => { syncFit(); return readFit(); },
    reset: () => {
      clearRotation();
      removeGate();
      lastPressRecord = null;
      syncGate();
      syncFit();
    },
  };
}
