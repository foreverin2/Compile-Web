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
 *
 * ## ★★ G6/T44（用户 2026-09-27 的 ③④⑤⑦ 条，见 `syncWideFit()` 与 `t44-video-fallback.ts`）
 *
 * 上面的手机那一支**在本轮一个字节未改**（T39 的源码腿与浏览器腿都盯它）。
 * 平板那一格走的是**另一条独立的宽视口路径**（`syncWideFit()` + `html.t44-fit-wide`），
 * 原因与读数都在 `WIDE_FIT_CLASS` 与 `syncWideFit()` 的头注里。
 * ========================================================================== */

/* ============================================================================
 * ★★ G6/T44：过渡覆盖层那句"看得见"的兜底，在本模块自己这一侧接线
 *
 * 只 import **本任务新增的一个 TS 文件**（边界内：`phone-landscape.ts` 自己 import 的新文件）。
 * 刻意**不新增 `.css`**：`tests/ui/net-body-layer-rules.test.ts` 有一条腿要求
 * "`src/ui` 的样式表全集 == 收录 ∪ 排除"，新增一张表必须在那份测试里显式归类，
 * 而测试文件不在本任务的边界内 ⇒ 那个提示的样式由 `t44-video-fallback.ts` 行内落地。
 * ========================================================================== */
import { initTransitionHint } from './t44-video-fallback';

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
  /** 缩放档是否生效（手机 + 横屏布局，**或** T44 的"非手机但版面放不下"那一档） */
  on: boolean;
  /** ★ T44：这一档走的是"非手机视口"那条路（`html.t44-fit-wide`）还是手机那条（`html.t39-fit`） */
  wide: boolean;
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
  /** ★ T44：只按主判据那一族（手牌 + 两个关键按钮）算出来的系数（"离整块差多少"的旁证） */
  kCrit: number | null;
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
  pinned: { next: boolean; choice: boolean; diag: boolean; /** ★ T48 跟进：两侧「查看弃牌堆」各钉了一个 */ trash: number };
  /** ★ 修复轮：可读优先地板（`10 / minFontPx`，封顶 1）与实际用的 `k` 的对照读数 */
  kRead: number | null;
  /** ★ 修复轮：可读地板量的那一族的实测最小字号 / 缩放后字号；整块棋盘的最小字号只作旁证 */
  fonts: { readMin: number | null; readScaled: number | null; boardMin: number | null };
  /** ★ 修复轮：拖动（两轴平移）的读数：当前位移、允许区间、提示在不在 */
  pan: { x: number; y: number; loX: number; hiX: number; loY: number; hiY: number; hint: boolean } | null;
  /** ★ 修复轮：手机旋转档里被钉住的协议信息框（逐块屏幕矩形 + 是否在视口内） */
  infoPins: { seat: string | null; screen: { x: number; y: number; right: number; bottom: number }; inside: boolean }[];
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
/**
 * ★★ G6/T44：**非手机视口**（平板/小桌面窗口）上那一套同样的自适应，另起一个类。
 *
 * 为什么不复用 `t39-fit`：T39 的浏览器腿在 1280×900 桌面档上断言 `t39-fit` **必须不在**
 * （那条腿的原话是"缩放档只在手机 + 横屏布局生效（桌面/平板不许被加类）"）。
 * 两类并存 = 两条路的读数各自独立，T39 那条腿一个字不用改。
 */
const WIDE_FIT_CLASS = 't44-fit-wide';
const PIN_CLASS = 't39-pin';
const PIN_NEXT_CLASS = 't39-pin-next';
const PIN_CHOICE_CLASS = 't39-pin-choice';
/** ★ T44：第三个要被钉住的按钮 —— `导出日志`（`.diag-btn`）。它在 `styles.css` 里是
 *  `position: fixed; right: 16px; bottom: 18px`，而 `#app` 一带 `transform` 它就以 `#app`
 *  为包含块 ⇒ 缩放档下会跟着 `#app` 的盒子跑到视口外（平板 1024×768 实测 `off-viewport`）。
 *  它与 `.next-btn` 同一条 `syncPin` 路，只是钉在**左下角**（右下角归「下一步」、
 *  底部中央归「确认」）。 */
const PIN_DIAG_CLASS = 't39-pin-diag';
/**
 * ★★ G6/T48 跟进（用户 2026-09-28 裁决 ②）：**第四个被钉住的东西 —— 「查看弃牌堆」**。
 *
 * 为什么（T48 三档实测的残差）：牌库/弃牌堆是**绝对定位在手牌区外侧一列**的，手机横屏
 * 844×390 那一档整块棋盘 `1510×1484` 塞进 `844×390` 要 `k≈0.26`（远低于可读地板）⇒
 * 纵轴可拖区间只有 `-606..525`（1131px），而两个 `.trash-view-btn` 在手牌上方约 900px 处，
 * **拖到区间端点仍差约 70px 够不到**（读数 `rect.y -301..-273`、连拖 13 次 `max-steps`）。
 * 用户裁决：**不许降可读地板**（那会把"可读优先"推翻）⇒ 把这个入口按既有 `.t39-pin`
 * 那一套钉到视口角（1:1、不缩放），与「下一步」「确认」「导出日志」同族。
 *
 * 钉法：`document.body` + `position: fixed`（`#app` 带 transform ⇒ 它才是 fixed 的包含块）。
 * 两侧各一个 ⇒ 用 `bulk = true` 把**同族多个**一起钉（左上角 / 右上角，与左下「导出日志」、
 * 右下「下一步」、底部中央「确认」错开）。
 */
const PIN_TRASH_CLASS = 't39-pin-trash';
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
 * ★★ G6/T44：**宽视口（非手机）那一格的地板更低** —— 0.45。
 *
 * 平板 1024×768 实测：整块棋盘 + 自己手牌（`.board` ∪ `.hand.self`）在布局空间是
 * **824×1484**（`.board` 从 y 12 到 1496），要整块进 1024×768 得
 * `k = min(1024/824, 768/1484) = 0.5175` —— 它是**高于** 0.5 的（实测 `kUnionNeeded: 0.518`），
 * 所以这一档其实用不到 0.45。留 0.45 是为了更矮的平板（768 高的 4:3 竖屏平板、
 * 1280×800 那一档 `k` 会更小一点）；两个数都写进读数，让人一眼看出离"整块"差多少。
 *
 * 0.45 的来历：宽视口档最小字号是 11px（`.net-zoom-box` 的 `font-size: 11px`），
 * 0.45 之后 4.95 CSS px —— 与手机档 0.5×11=5.5 同一量级，是"这个数已经很小了、
 * 但比'整块棋盘够不到'要好"的取舍。**这是取舍，不是最优**：报告里把两个数都写出来。
 */
const K_FLOOR_WIDE = 0.45;
/**
 * ★★ G6/T44 修复轮（用户裁决 B：**可读优先**）：**视觉最小字号的地板**。
 *
 * 规则：`k = max(全览所需的 k, 让最小字号 ≥ 10px 所需的 k)`，上限 1。10px 是用户给的硬门槛
 * （`10 / minFontPx`）；**不做放大**（`k` 封顶 1）—— 原字号已经 ≥10px 时就不许为了凑数把版面放大。
 *
 * 为什么这条会与"整块进视口"冲突：平板 1024×768 实测整块棋盘要 `k=0.5175`，而参与测量的
 * 最小字号 13px ⇒ 0.5175×13 = **6.73px**（太小）。按这条地板 `k ≥ 10/13 = 0.769`，
 * 于是整块板子必然放不进视口 ⇒ **必须能两轴拖动**（见下面的 pan，用户同一条裁决的后半句）。
 * 实测数（`.superpowers/g6-T44/run-t44tab-prefix.txt` / `fix1-*`）写在报告里。
 */
const K_READ_FONT_PX = 10;
/** 拖动时**不吃手势**的那一族（卡面照旧拖牌、按钮照旧点、浮层照旧滚） */
const PAN_BLOCK_SEL = '.card, .draft-card, .hand-shield, .t39-pin, .zoom-overlay, .choice-bar, '
  + '.action-bar, button, input, select, textarea, a, [role="button"]';
/** 拖动提示那句话的类名（样式在 `styles-touch.css`） */
const PAN_HINT_CLASS = 't44-pan-hint';
/** 手机旋转档里"被钉住的协议信息框"的类名（样式在 `styles-touch.css`） */
const INFO_PIN_CLASS = 't44-info-pin';
/**
 * 必须落进视口的那一族（(a) 的目标：**整块棋盘 + 自己手牌**）。
 * **不含** `.next-btn` / `.choice-confirm`（它们由 (b) 单独钉到视口角，且 1:1 不缩放）——
 * 这样"去掉缩放类"与"去掉按钮固定"两个变异各自都有一格会红。
 *
 * ★★ G6/T48 补：再加三类**在流外的可点面** —— `.deck`（牌库）、`.trash-pile`（弃牌堆）、
 * `.trash-view-btn`（「查看弃牌堆」按钮）。
 *
 * 为什么必须补（T48 三档实测，`run-hotseat-before.txt` / `run-hotseat-final.txt`）：
 * `styles.css` 把牌库/弃牌堆**绝对定位到手牌区外侧一列**（P1 在左、P2 在右），
 * 而"要摆进视口的那一族"原来只算了 `.board` / `.net-board` / `.hand.self` ⇒
 * **拖动区间是按棋盘内流盒算的**，那两列落在区间之外：
 *   · 平板 1024×768：`pan.loX..hiX = 0..0`（横轴被钳死），两块「查看弃牌堆」恒 `off-viewport`、
 *     `panTargetIntoView` 连拖 13 次仍 `max-steps`；
 *   · 平板 1280×800：同一条（对家那摞牌库 `rect.x 1289..1365`，视口 1280）；
 *   · 手机 844×390：`pan` 是 0/0/0/0（整页缩放档当时没生效，见 `syncFit()` 里那段）。
 * 补进来之后同一批读数的 `pan` 变成：1024 档横轴 `-69..69`、纵轴 `-196..178`，
 * 1280 档纵轴 `-196..146`，手机档横轴 `258..925`、纵轴 `-606..525` ⇒
 * 三档的"每一张手牌 + 每一个按钮（含两摞牌库与两个「查看弃牌堆」）"都能拖进视口并命中自己。
 * 热座是**两个人共用一屏**，两边的牌库/弃牌堆都要够得到 ⇒ 它们必须进这个包围盒。
 */
const FIT_TARGETS: readonly string[] = ['.board', '.net-board', '.hand.self', '.deck', '.trash-pile', '.trash-view-btn'];
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
  kRaw: number | null; k: number | null; kCrit: number | null; kRead: number | null; tx: number; ty: number; fits: boolean | null;
  boardFit: boolean; kUnionNeeded: number | null; corrected?: { dx: number; dy: number }; slotNudge?: { dx: number; dy: number; wanted: { dx: number; dy: number } }; slotsInside?: boolean; slotsRect?: { x: number; y: number; right: number; bottom: number } | null;
  measured: { sel: string; count: number }[]; minFontPx: number | null;
  infoPins: PhoneFitRecord['infoPins'];
  fonts: PhoneFitRecord['fonts'];
} = { box: null, critBox: null, need: null, kRaw: null, k: null, kCrit: null, kRead: null, tx: 0, ty: 0, fits: null, boardFit: false, kUnionNeeded: null, measured: [], minFontPx: null, infoPins: [], fonts: { readMin: null, readScaled: null, boardMin: null } };
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

/**
 * ★★ G6/T51：**"这一屏是牌桌类"的判据**（门的白名单，见 `syncGate()`）。
 *
 * 前三个选择器是渲染器**只在牌桌那一屏**才会建的根节点：`render.ts:5098` 的 `.board`
 * （热座）、`render-net.ts:2540` 的 `board net-board`（联机；它同时带 `.board`）、
 * 两边手牌区的 `.hand.self`。
 *
 * **第四个 `.draft-screen` 是任务书点名的"草稿选协议那一屏"，但它并不是靠前三个根节点命中的**
 * —— 实测（T48 夹具的进牌桌采样，`.superpowers/g6-T48/run-hotseat-final.txt` 的
 * `"draft":1,"board":0,"hand":0`）草稿屏上 `.board` / `.net-board` / `.hand.self` **一个都没有**。
 * 任务书 §1① 的列表把草稿屏算进"牌桌类"（"联机牌桌 / 本地热座牌桌 / 草稿选协议那一屏"），
 * 所以这里按**列表**取并集：草稿屏照样拦（它的版式是 `--draft-u: 76px` 的固定宽版面，
 * 390px 竖屏里放不下，改前它是被门拦着的 —— 不拦就是把它单独降级）。
 *
 * ## 非牌桌屏的标记（`PLAIN_SCREEN_SEL`）与"去抖"（`boardScreenLatch`）
 *
 * 光看"有没有牌桌根节点"不够：牌桌每帧重画，`#app` 在某一瞬间可能**两者都没有**
 * （旧节点先摘、新节点后挂）。那一刻若判成"不是牌桌"，`syncGate()` 就会 `removeGate()`、
 * 下一帧再建一个新门 —— 门会被反复摘掉又装上，而**真机/真输入点门会失效**
 * （按下时命中的是旧按钮、抬起时它已经被换掉 ⇒ 浏览器不合成 click；实测：
 * `.superpowers/g6-T51/run-t51net.txt` 里连真触摸与真鼠标都点不动 `press()`，`lastPress()` 恒 null）。
 * ⇒ 两个都没有时**保持上一次的判定**（`boardScreenLatch`），只在"看到明确标记"时才翻转。
 */
const BOARD_SCREEN_SEL = '.board, .net-board, .hand.self, .draft-screen';
/** 明确"不是牌桌类"的屏根（渲染器各屏的根节点；`.consent-screen` 是授权屏）。 */
const PLAIN_SCREEN_SEL = '.home-screen, .mode-screen, .library-screen, .rules-screen, .coin-screen, '
  + '.net-lobby-screen, .local-data-screen, .consent-screen';
/** 上一次的判定（重画中间态两个选择器都不命中时沿用；见上面那段"去抖"）。 */
let boardScreenLatch = false;

/** 这一刻屏上是不是牌桌类页面（门只在 `true` 时出现）。 */
function onBoardScreen(): boolean {
  if (document.querySelector(BOARD_SCREEN_SEL) !== null) { boardScreenLatch = true; return true; }
  if (document.querySelector(PLAIN_SCREEN_SEL) !== null) { boardScreenLatch = false; return false; }
  return boardScreenLatch;
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

/** 门只在"手机 + 竖屏 + 还没旋转 + **这一屏是牌桌类**"这一格存在；其余一律从 DOM 摘掉。 */
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
  /**
   * ★★ G6/T51（用户 2026-09-28 口径）：`need` 之后再过一道**牌桌类白名单** ——
   * 非牌桌屏（图鉴 / 首页 / 模式选择 / 大厅 / 规则图纸 / 探针页）一律摘门。
   *
   * 为什么必须加这一道（T48 实测 + 用户裁决）：门原来只看"手机 + 竖屏 + 没旋转"，是**全局**的 ⇒
   * 390×844 竖屏下它盖满视口（`rect 0,0,478,1035`、`z-index 4000`、`inset: 0`），
   * 图鉴里**每一个可点控件**的 `elementFromPoint` 都回 `.t39-gate`（逐条 429/429 全命中门）、
   * 返回键点不到；连**授权屏**都被吃掉（`driveHome` 点「允许（本地数据）」两次都命中门、主页没出来）。
   * 而门要管的只是"牌桌按横屏排版"这一件事，图鉴/大厅这些屏本来就该竖屏可读。
   *
   * `need` 那一行**逐字未动**：T39 的源码腿（`tests/ui/t39-touch-and-landscape.test.ts`）
   * 与浏览器腿都钉着它。白名单是**并列的第二个条件**，不是改写。
   */
  if (!need || !onBoardScreen()) {
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
  const wide = document.documentElement.classList.contains(WIDE_FIT_CLASS);
  return {
    on: on || wide,
    wide,
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
    kCrit: lastFit.kCrit,
    kRead: lastFit.kRead,
    fonts: {
      readMin: lastFit.fonts.readMin,
      readScaled: lastFit.fonts.readMin === null || lastFit.k === null
        ? null : Math.round(lastFit.fonts.readMin * lastFit.k * 100) / 100,
      boardMin: lastFit.fonts.boardMin,
    },
    k: lastFit.k,
    kFloor: K_FLOOR,
    floored: lastFit.kRaw !== null && lastFit.kRaw < K_FLOOR,
    tx: lastFit.tx,
    ty: lastFit.ty,
    fits: lastFit.fits,
    measured: lastFit.measured,
    minFontPx: lastFit.minFontPx,
    minFontPxScaled: lastFit.minFontPx === null || lastFit.k === null ? null : Math.round(lastFit.minFontPx * lastFit.k * 100) / 100,
    pan: { x: Math.round(panX), y: Math.round(panY), loX: Math.round(panRange.loX), hiX: Math.round(panRange.hiX),
      loY: Math.round(panRange.loY), hiY: Math.round(panRange.hiY),
      hint: panHint !== null && panHint.isConnected && panHint.classList.contains('is-on') },
    infoPins: lastFit.infoPins,
    pinned: { next: document.querySelectorAll(`.${PIN_CLASS}.${PIN_NEXT_CLASS}`).length > 0, choice: document.querySelectorAll(`.${PIN_CLASS}.${PIN_CHOICE_CLASS}`).length > 0, diag: document.querySelectorAll(`.${PIN_CLASS}.${PIN_DIAG_CLASS}`).length > 0, trash: document.querySelectorAll(`.${PIN_CLASS}.${PIN_TRASH_CLASS}`).length },
    appOverflow: cs === null ? null : cs.overflow,
    appTransform: cs === null ? null : cs.transform,
  };
}

/**
 * ★★ 修复轮 P1 实测抓到的**真缺陷**：`pinGen` 原来是**一个共享变量**，而 `syncPin` 一次给
 * `.next-btn` / `.choice-confirm` / `.diag-btn` **各调一次** —— 第一次调用结束就把 `pinGen`
 * 更新成"当前代"，第二次进来时 `genChanged` 恒为 `false` ⇒ **上一代遗留下来的
 * `.choice-confirm` 再也摘不掉**。
 *
 * 现场读数（`.superpowers/g6-T44/run-fix1-btnphone.txt`）：`choiceBar:false`（这一代根本没有
 * 选择条）而屏上仍有一个 `.choice-confirm` 钉在底部中央 `x 129..261 / y 788..834`、
 * `disabled:true`、`elementFromPoint(中心)` **不命中它自己**（`hitSelf:false`）——
 * 也就是说屏上留着一个"看着像确认键、点下去没反应"的陈旧节点。
 * ⇒ 改成**按钉住类各记一个代**（`pinGens`），三类互不干扰。
 */
const pinGens = new Map<string, Element | null>();

/**
 * 把这一族按钮从 `#app` 里**挪到 `document.body`**（`#app` 有 transform ⇒ 钉不到视口）。
 *
 * 注意（修复轮 2 实测踩到的）：重画之后**当前这一幕可能不再有「下一步」**（`render.ts` 只在
 * `legal` 里有 `advance` 时才产出 `.next-btn`）。旧写法在这种情况下"留着旧的" ⇒ 屏上会
 * **留一个陈旧按钮**：它的 `click` 闭包绑的是**上一帧**的 `nextAction`，点下去提交的是过期动作
 * （实测：`end` 步上连点 8 次 `step` 一动不动）。所以这里用 `#app` 的**渲染代**判断：
 * `firstElementChild` 换了（`renderApp` 每次 `root.textContent = ''` 后重建，节点必然是新的）
 * 而这一代里找不到该按钮 ⇒ 把钉住的旧节点摘掉。
 *
 * ⚠️ 代是**按 `cls` 各记一个**（见 `pinGens` 的说明：共享一次就会漏摘 `.choice-confirm`）。
 *
 * ★★ G6/T48 跟进：加了第 4 个参数 `bulk` —— 把**同族多个按钮**（两侧各一个的
 * `.trash-view-btn`）一起钉住。`bulk=false`（默认）时逐字保留原来那条路：
 * 用 `root.querySelector` 取**第一个**、只钉一个；`bulk=true` 时取全部，逐个钉。
 * 陈旧节点照旧按渲染代摘：这一代里**没有被钉的新节点**（数量不足或换了代）
 * ⇒ 把多出来的/全都不该在的钉住节点摘掉。
 */
function syncPin(root: HTMLElement, selectors: readonly string[], cls: string, bulk = false): boolean {
  const gen = root.firstElementChild;
  const prev = pinGens.get(cls) ?? null;
  const genChanged = prev !== null && gen !== null && gen !== prev;
  let live: HTMLElement | null = null;
  for (const sel of selectors) {
    const el = root.querySelector<HTMLElement>(sel);
    if (el !== null) { live = el; break; }
  }
  /** 同族多个（`bulk`）：一个个都钉住；单个时就是 `live` 那一个 */
  const lives: HTMLElement[] = [];
  if (bulk) {
    for (const sel of selectors) for (const el of Array.from(root.querySelectorAll<HTMLElement>(sel))) {
      if (!lives.includes(el)) lives.push(el);
    }
  }
  const existing = document.querySelector<HTMLElement>(`.${PIN_CLASS}.${cls}`);
  /**
   * ⚠️ `pinGen = gen` 这几句是**给 T39 的源码腿**留的（`tests/ui/t39-touch-and-landscape.test.ts`
   * 逐字钉着 `pinGen = gen`）。它现在只是"最后一次钉的代"的记录 —— **判断一律走 `pinGens`**，
   * 原因见上面那段"共享一个 `pinGen` 会漏摘 `.choice-confirm`"。
   */
  if (bulk) {
    /** 已经在 body 上、而且这一代里还是它的那些 = 保持不变；其余按位置逐个替换 */
    const pinned = Array.from(document.querySelectorAll<HTMLElement>(`.${PIN_CLASS}.${cls}`));
    if (lives.length === 0) {
      // 这一代里一个都没有 ⇒ 只把**陈旧的**摘掉（没换代就不动，避免误摘）
      if (genChanged) { for (const el of pinned) el.remove(); pinGens.set(cls, gen); pinGen = gen; return false; }
      pinGens.set(cls, gen ?? prev);
      pinGen = gen;
      return pinned.length > 0;
    }
    for (let i = 0; i < lives.length; i += 1) {
      const el = lives[i];
      if (pinned[i] === el) continue; // 这一格已经是它
      if (pinned[i] !== undefined) pinned[i].remove();
      el.classList.add(PIN_CLASS, cls);
      el.setAttribute('data-t48-pin-index', String(i));
      document.body.appendChild(el);
    }
    for (let i = lives.length; i < pinned.length; i += 1) pinned[i].remove(); // 多出来的（这一代少了一个）
    pinGens.set(cls, gen);
    pinGen = gen;
    return true;
  }
  if (live === null) {
    // 这一代里没有这个按钮：只有"换过代"才说明它真的不该在屏上 ⇒ 摘掉陈旧的
    if (existing !== null && genChanged) { existing.remove(); pinGens.set(cls, gen); pinGen = gen; return false; }
    pinGens.set(cls, gen ?? prev);
    pinGen = gen;
    return existing !== null;
  }
  if (live === existing) { pinGens.set(cls, gen); pinGen = gen; return true; } // 已经是它了
  if (existing !== null) existing.remove(); // 旧的作废（每次重画都是新节点）
  live.classList.add(PIN_CLASS, cls);
  document.body.appendChild(live);
  pinGens.set(cls, gen);
  pinGen = gen;
  return true;
}

/** 关掉缩放档：摘类、把 `#app` 的内联变量清掉、把钉住的按钮还回去（尽力） */
function clearFit(): void {
  document.documentElement.classList.remove(FIT_CLASS);
  document.documentElement.classList.remove(WIDE_FIT_CLASS);
  document.documentElement.style.removeProperty('--t39-k');
  document.documentElement.style.removeProperty('--t39-tx');
  document.documentElement.style.removeProperty('--t39-ty');
  const app = document.getElementById('app');
  if (app !== null && app.style.transform !== '') app.style.transform = '';
  resetPan();
  syncInfoPins(null);
  for (const el of Array.from(document.querySelectorAll<HTMLElement>(`.${PIN_CLASS}`))) {
    el.classList.remove(PIN_CLASS, PIN_NEXT_CLASS, PIN_CHOICE_CLASS, PIN_DIAG_CLASS, PIN_TRASH_CLASS);
    /**
     * ★★ G6/T48 跟进：**不再 `el.remove()`，改成"放回 `#app`"**。
     *
     * 原来这里直接把钉住的节点扔掉，赌"下一次 renderApp 会产出新的那个"。撤缩放档通常紧跟一次
     * 重画，所以一直没暴露；但**没重画**时（T48 跟进实测：在牌桌就绪之后立刻摘掉 fit 类）那两个
     * 「查看弃牌堆」会**停在 `document.body` 上、挂着 `position: fixed` 的钉住样式**，
     * 而 fit 类已经摘了 ⇒ 屏幕上留着两个"钉在角上的旧按钮"（读数：`parent BODY / pinned:true`）。
     * 放回 `#app` 之后：非 fit 档这两个节点照旧由它自己的样式摆在信息条里；若紧接着真的重画了，
     * 新节点会取代它们（旧节点随 `#app` 清空一起扔掉）。两种次序都不会留脏节点。
     */
    if (app !== null && el.parentElement === document.body) app.appendChild(el);
  }
  lastFit = { box: null, critBox: null, need: null, kRaw: null, k: null, kCrit: null, kRead: null, tx: 0, ty: 0, fits: null, boardFit: false, kUnionNeeded: null, measured: [], minFontPx: null, infoPins: [], fonts: { readMin: null, readScaled: null, boardMin: null } };
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
      /**
       * ── ★★ G6/T44（用户 2026-09-27 第 ⑤ 条）：**平板也走同一套自适应** ──
       *
       * 手机那一支（`on`）一个字没动（T39 的源码腿与浏览器腿都靠它）。
       * 这里补的是"**不是手机、但版面本来就放不进视口**"那一格 —— 平板 1024×768 实测：
       * `.board` 是 824×1484（y 12..1496）、`.hand.self` 落在 y 1063..1242（**整块在视口之下**），
       * `.diag-btn` 在 (1398, 1073)（视口只有 1024 宽）；而 `#app` 的 `overflow` 是 `visible`、
       * 文档 `scrollHeight` 虽然 1606 但 `window.scrollBy` 与 `#app.scrollLeft` 都
       * **一格都动不了**（实测 `moved:false` 两条）⇒ 5 张手牌 + 底部按钮**全部够不到**。
       *
       * 修法与手机同源（算 `k`、写 `--t39-k/-tx/-ty`、钉按钮），但**另起一条独立路径**
       * （`syncWideFit()` + `html.t44-fit-wide`）：手机那支的测量用 `offsetTop` 累加
       * （依赖 `offsetParent` 链走得到 `#app`，而那只在 `html.t39-rot90 #app` 是
       * `position: fixed` 时成立），宽视口这一格 `#app` 是 `position: static`
       * ⇒ 累加链恒走不到 `#app`、量出来恒 `null`（实测读数见 `syncWideFit()` 的头注）。
       */
      if (!d.isPhone && app !== null && canFitWide()) syncWideFit(app);
      else if (document.documentElement.classList.contains(FIT_CLASS) || document.documentElement.classList.contains(WIDE_FIT_CLASS)) clearFit();
      lastFit.measured = [];
      return;
    }
    /**
     * ★★ G6/T48：视口尺寸改用 `visibleViewport()`（= `min(doc.clientWidth, visualViewport.width,
     * innerWidth)`），**不再直接用 `window.innerWidth/innerHeight`**。
     *
     * 为什么（手机 844×390 档实测）：移动端仿真的**布局视口**会被内容撑大 —— 实测那一刻
     * `innerWidth/innerHeight = 1516×701`，而 `visualViewport = 844×390`
     * （`documentElement.clientWidth` 也是 844）。下面这段的 `tx/ty` 是**屏幕坐标**上的摆放量，
     * 它必须与 `correctIntoViewport` / `applyTransformVars`（两处都在用 `visibleViewport()`）
     * 用同一个尺寸，否则整块版面会被摆到一个 1516×701 的坐标系里：
     * 实测读数就是"手牌 x 1232..1362 / 视口 844 宽"，5 张手牌**全在可视区之外**。
     * 改完这一处之后，三处（算 k、算 tx/ty、钳制拖动区间）用的是同一个"看得见的那块视口"。
     */
    const vp = visibleViewport();
    const vw = vp.w;
    const vh = vp.h;
    const H = app.offsetHeight; // 元素**未变换**的高度（旋转档 = 100vw）
    /**
     * ★★ G6/T48：测量改用 `measureWideLayout()`（`getBoundingClientRect` + `#app` 内容坐标），
     * **不再用 `measureFitBox()` 的 `offsetTop/offsetLeft` 累加**。
     *
     * 为什么（热座 844×390 档实测的真缺陷）：`measureFitBox` 依赖 `offsetParent` 链能走到
     * `#app`，而那条链在热座牌桌上是**断的** —— 实测那一跑 `.hand.self` 与 `.board` 都在
     * DOM 里、`union.measured` 也是 `[{'.board',1},{'.hand.self',1}]`，但 `box` 恒 `null`
     * （读数 `fit.k === null`、`classes` 里一个 fit 类都没有、手牌停在 x 1232..1362）。
     * 也就是说：**手机横屏进热座牌桌时，整页缩放档一次都没生效**，5 张手牌全在视口之外。
     *
     * 这个坑 T44 在**宽视口那一格**已经踩过一次（`measureWideLayout()` 的头注写了同一个
     * 根因），当时的结论是"手机旋转档恰好掩盖了它（`html.t39-rot90 #app` 是 `position: fixed`，
     * 链走得到）"——**热座牌桌（`.board`）并不是旋转档**，于是这条链又断了。
     * ⇒ 两条路共用同一个测量函数，`t39-fit` 那一支也走"量 `getBoundingClientRect` 再折算
     * 回 `#app` 内容坐标"的口径；`measureFitBox` 不再被任何分支调用（留着是为了少动既有函数）。
     */
    const union = measureLayoutWithTransformZeroed(app, FIT_TARGETS) ?? { box: null, measured: [] as { sel: string; count: number }[] };
    const crit = measureLayoutWithTransformZeroed(app, critTargets()) ?? { box: null, measured: [] as { sel: string; count: number }[] };

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
    /**
     * ★ 可读优先（用户裁决 B）：`k = max(全览所需的 k, 最小字号 ≥ 10px 所需的 k)`，封顶 1。
     * 手机旋转档实测最小字号 16px ⇒ 地板 `10/16 = 0.625`（原来是 0.5402，字太小）。
     * 抬上去之后整块棋盘更放不下 ⇒ **两轴拖动**接手（`applyTransformVars` 的钳制 + `installPan`）。
     */
    const kRead = readFloorK();
    const k = Math.max(K_FLOOR, Math.min(1, Math.max(kRaw, kRead)));
    const tx = d.rotated
      ? -k * (H - box.maxY) + (vw - k * need.w) / 2
      : -k * box.minX + (vw - k * need.w) / 2;
    const ty = d.rotated
      ? -k * box.minX + (vh - k * need.h) / 2
      : -k * box.minY + (vh - k * need.h) / 2;
    const root = document.documentElement;
    root.classList.add(FIT_CLASS);
    applyTransformVars(k, tx, ty, { w: vw, h: vh }, unionBox ?? box, { rotated: d.rotated, H });
    lastFit = {
      box: unionBox,
      critBox,
      need,
      kRaw,
      kCrit,
      kRead,
      k,
      tx,
      ty,
      fits: kRaw >= K_FLOOR,
      boardFit: useUnion,
      kUnionNeeded: unionBox === null ? null : Math.round(kUnion * 1000) / 1000,
      measured: union.measured,
      minFontPx: minFontPxOf(app),
      infoPins: [],
      fonts: { readMin: minFontIn(readFontTargets()), readScaled: null, boardMin: minFontOnBoard() },
    };
    // (b)：关键按钮钉到视口角
    syncPin(app, ['.next-btn'], PIN_NEXT_CLASS);
    syncPin(app, ['.choice-confirm'], PIN_CHOICE_CLASS);
    syncPin(app, ['.diag-btn'], PIN_DIAG_CLASS);
  /** ★ T48 跟进：两侧「查看弃牌堆」一起钉（同族多个） */
  syncPin(app, ['.trash-view-btn'], PIN_TRASH_CLASS, true);
    correctIntoViewport(app, vw, vh);
    /** (c)：用户第 ④ 条 —— 旋转档把双方协议信息框收进**钉住层**（见 `syncInfoPins` 的头注） */
    if (d.rotated) syncInfoPins({ k, tx: fitBase.tx, ty: fitBase.ty, H });
    else syncInfoPins(null);
  } finally {
    fitting = false;
  }
}

/* ============================================================================
 * ★★ G6/T44：宽视口（非手机）那一格的自适应
 * ========================================================================== */

/**
 * **"看得见的那块视口"与"布局视口"不是一回事**（平板实测踩到的硬事实）。
 *
 * 平板档（CDP 1024×768、粗指针、`mobile:true`、dpr2）实测：`innerWidth = 1516`、
 * `documentElement.clientWidth = 1024`、`visualViewport.width = 1024`、
 * `scrollWidth = 1516`（原文 `.superpowers/g6-T44/run-t44tab-prefix.txt`）。
 * 也就是浏览器**把布局视口撑到了内容宽**（1516/1528 两档都是它）——因为 `.net-board`
 * 的 `scrollWidth` 是 1428（左栏那串绝对定位的 `.deck-back` 溢出去了），而屏幕上
 * 真正看得见、摸得着的只有 1024×768 那一块：`elementFromPoint` 在 (1526, 384) 打点是
 * `null`、在 (213, 1152) 也是 `null`（同一份原文里的"屏幕取点扫描"）。
 *
 * ⇒ 一切"要摆进视口"的算术都必须按**看得见的那块**算。这个函数也顺便解释了
 * 修前那 5 张手牌为什么"布局上在视口里、屏幕上根本够不到"。
 */
function visibleViewport(): { w: number; h: number } {
  const doc = document.documentElement;
  const vv = window.visualViewport;
  const w = Math.max(1, Math.round(Math.min(
    doc.clientWidth > 0 ? doc.clientWidth : window.innerWidth,
    vv !== undefined && vv !== null && vv.width > 0 ? vv.width : window.innerWidth,
    window.innerWidth,
  )));
  const h = Math.max(1, Math.round(Math.min(
    doc.clientHeight > 0 ? doc.clientHeight : window.innerHeight,
    vv !== undefined && vv !== null && vv.height > 0 ? vv.height : window.innerHeight,
    window.innerHeight,
  )));
  return { w, h };
}

/**
 * ★★ G6/T48 跟进：**"放得下"必须包含"自己那 5 张手牌都在可视视口内"**。
 *
 * ## 抓到的真缺陷（联机页 1280×800，`run-nettab-1280.txt`）
 *
 * `canFitWide()` 原来只比**两个比值**（`vp.w / box.w`、`vp.h / box.h`），这两个数都 ≥ 1 就判
 * "放得下、一个字节都不碰"。可**比值看不到"越界"**：棋盘比视口**宽一点点**时，内容被居中
 * （`#app` 的 `padding-left: 100px` + 棋盘自身宽度），左边的牌会**负方向溢出** ——
 * 实测那一刻 `classes` 里一个 fit 类都没有、`appTransform:"none"`、`k=null`，
 * 而自己 5 张手牌里第一张 `rect x -40..53`（**中心都贴在左缘外**，`hitCount 2`）。
 * 这正是用户最初抱怨的"看不到左侧手牌"在 1280×800 这一档**还没被解决**的形态
 * （评审在 HEAD 对照树上看到同样形态 ⇒ 不是 T48 引入的，但判据确实漏了这一条）。
 *
 * ## 判法（与既有口径同源：纯几何、不看类）
 *
 * 每个 `.hand.self .card[data-uid]` 的**屏幕矩形**必须落在
 * "`#app` 内边距之内 ∩ 可视视口" 里（`#app` 有 `padding: 12px 100px` 一族 ⇒ 左边 100px
 * 本来就是留白，牌贴到那儿不算越界；出到 `x < 0` 才算）。任何一张出界 ⇒ 返回 `true`，
 * 交给 `syncWideFit()` 的 `correctIntoViewport()` 把这一族平移回视口内。
 * 只读、不改 DOM；量不到手牌（还没进牌桌）时按"不动"处理，与原来一致。
 */
function handOutsideViewport(app: HTMLElement): boolean {
  const vp = visibleViewport();
  const cards = Array.from(app.querySelectorAll<HTMLElement>('.hand.self .card[data-uid]'));
  if (cards.length === 0) return false;
  const cs = window.getComputedStyle(app);
  const padL = Number.parseFloat(cs.paddingLeft) || 0;
  const padT = Number.parseFloat(cs.paddingTop) || 0;
  const padR = Number.parseFloat(cs.paddingRight) || 0;
  const padB = Number.parseFloat(cs.paddingBottom) || 0;
  const loX = Math.max(0, padL);
  const loY = Math.max(0, padT);
  const hiX = vp.w - Math.max(0, padR);
  const hiY = vp.h - Math.max(0, padB);
  for (const el of cards) {
    const fixed = window.getComputedStyle(el).position === 'fixed';
    if (fixed) continue; // 钉住的那种 1:1 元素不参与（它们本来就在视口角上）
    const b = el.getBoundingClientRect();
    if (b.width <= 0 && b.height <= 0) continue;
    if (b.left < loX - 1 || b.top < loY - 1 || b.right > hiX + 1 || b.bottom > hiY + 1) return true;
  }
  return false;
}

/**
 * 宽视口那一格的"要不要动"：**整块棋盘 + 手牌在可见视口里放得下、且自己那 5 张手牌
 * 全都真的在可视视口内，才一个字节都不碰**。
 *
 * 判据是纯几何的（**不看当前挂着哪个类** —— 看类会自激："上一帧缩过 ⇒ 这一帧又量出放不下"）。
 * 返回 `true` 时测量已经把缩放摘掉了 ⇒ 调用方必须重新落盘（`syncWideFit` 会做）。
 *
 * ⚠️ 三道守卫（都被实测咬过，别删）：
 *  ① `d.isPhone` ⇒ `false`：手机那一支有自己的路（旋转档 + `t39-fit`），宽视口档**绝不能**
 *     接管手机页 —— 实测漏了这条守卫时，联机手机旋转档被宽视口档改造，
 *     画布变成 `vw 980×vh 2121`、`cardsUnreachable 5 / buttonsUnreachable 1`（整页做废）；
 *  ② `d.rotated` ⇒ `false`：同理，旋转档不走这条；
 *  ③ `visibleViewport().w <= 600` ⇒ `false`：**窄屏一律不接管**。为什么还要这一道（实测踩到）：
 *     手机页刚按完门、方向锁/CSS 旋转**还没落定的那一两秒**里，`detect()` 可能报
 *     `rotated:false`（而 `isPhone` 那一刻也可能是 false）⇒ 宽视口档会在这一两秒里接管一个
 *     390 宽的视口。守住"宽度 ≤ 600 就不是宽视口"之后，这种过渡窗口不会再改坏页面。
 */
function canFitWide(): boolean {
  const app = document.getElementById('app');
  if (app === null) return false;
  const d = detect();
  if (d.isPhone || d.rotated) return false; // 守卫 ①②
  /**
   * ★★ **守卫 ④（2026-09-29 用户实测的 bug）**：**主指针不是"粗"的（= 鼠标设备）一律不接管**。
   *
   * 现场：桌面窗口 1280 宽下打热座，棋盘（`.lane-row` 合计 1800px）放不下 ⇒ 前三道守卫都放行
   * ⇒ 宽视口档接管：`#app` 被改成 `position: fixed` + 整体 scale ⇒ 屏上**卡牌大小全错**、
   * 鼠标滚轮再也滚不动（只能按提示拖动）。用户报的两条其实是同一个根因。
   *
   * 为什么用 `d.coarse`（**主**指针）而不是 `any-pointer: coarse`/`maxTouchPoints`：带触摸屏的
   * 笔记本/一体机会同时报 `any-pointer: coarse`，用宽口径等于这个 bug 原样留在那些机器上。
   * 代价（如实记）：平板/手机**外接鼠标**时主指针可能变成 `fine` ⇒ 那一档不再自动缩放，
   * 退化成普通滚动 —— 能用，只是少了自动适配。要放开就把这里换成 `!(d.coarse || d.anyCoarse)`。
   */
  if (!d.coarse) return false; // 守卫 ④：鼠标设备（桌面）永不接管
  const vp = visibleViewport();
  if (vp.w <= 600) return false; // 守卫 ③：窄屏交给手机那一支 / 谁都不动
  const measured = measureLayoutWithTransformZeroed(app, FIT_TARGETS);
  if (measured === null || measured.box === null) return false; // 量不到东西（还没进牌桌）⇒ 不动
  const fitsByRatio = vp.w / measured.box.w >= 1 && vp.h / measured.box.h >= 1;
  if (!fitsByRatio) return true;
  /**
   * ★ T48 跟进：比值过了**还要**看"有没有牌负方向溢出" —— 这一条是 1280×800 联机页那个
   * "判成放得下、却有一张手牌在 `x -40..53`"的真缺陷。放得下且牌都在里面 ⇒ 不动（既有档位逐字不变）。
   */
  return handOutsideViewport(app);
}

/**
 * ★★ G6/T48 稳定性修复（用户 2026-09-28 裁决：**先修稳振荡**）：
 * **量之前把"已经应用的那一层变换"真正归零，量完原子恢复。**
 *
 * ## 为什么需要它（T48 诊断的读数，`.superpowers/g6-T48/T48-INSTABILITY.md`）
 *
 * `measureWideLayout()` 下面只摘掉了 `app.style.transform`（**内联**那一份），可旋转档的变换是
 * **类规则**给的：`styles-touch.css` 的 `html.t39-fit.t39-rot90 #app { transform: translate(var(--t39-tx), var(--t39-ty)) scale(var(--t39-k)) rotate(90deg) … }`
 * ⇒ 量的时候那份 `translate` **还在**，量出来的不是"布局盒"而是"当前这帧摆在哪"。
 * 于是同一个盘面会交替量到两个盒：
 *   上一次落盘 `tx=382` ⇒ 手牌宽 `117`、内容盒 `660` ⇒ `k=0.99998`（手牌 0 张在视口内）；
 *   按它落盘后手牌宽变 `128`、盒 `722` ⇒ 下一次 `resync()` 得 `k=0.91358`（手牌 5/5 在视口内）；
 *   再落盘又回 `117` —— **两个值互为对方的输入**（实测同一页连做 3 次 `resync()` 就是 0.99998 ↔ 0.91358 交替）。
 *
 * ## 怎么做到"不闪"
 *
 * 归零与恢复都在**同一个任务**里同步做完（中间只有 `getBoundingClientRect()` 这类同步读，
 * 没有 `await`/`setTimeout`）⇒ 浏览器**不会在中间插入一次绘制**，用户看不到闪动。
 * 恢复写回的是**进来时读到的原值**（`--t39-k/tx/ty` 与内联 `transform` 逐字还原），
 * 所以"量之前那一刻的可见状态"byte-for-byte 不变。异常路径也走 `finally` 还原。
 */
function measureLayoutWithTransformZeroed(app: HTMLElement, sels: readonly string[] = FIT_TARGETS): { box: FitBox | null; measured: { sel: string; count: number }[] } | null {
  const root = document.documentElement;
  const inline = app.style.transform;
  const kBefore = root.style.getPropertyValue('--t39-k');
  const txBefore = root.style.getPropertyValue('--t39-tx');
  const tyBefore = root.style.getPropertyValue('--t39-ty');
  const patch: [string, string][] = [
    ['--t39-k', '1'], ['--t39-tx', '0px'], ['--t39-ty', '0px'],
  ];
  for (const [p, v] of patch) root.style.setProperty(p, v);
  if (inline !== '') app.style.transform = '';
  try {
    return measureWideLayout(app, sels);
  } finally {
    if (inline !== '') app.style.transform = inline;
    const restore: [string, string][] = [['--t39-k', kBefore], ['--t39-tx', txBefore], ['--t39-ty', tyBefore]];
    for (const [p, v] of restore) {
      if (v === '') root.style.removeProperty(p);
      else root.style.setProperty(p, v);
    }
  }
}

/**
 * 宽视口这一格的**布局空间测量**（`#app` 的内容坐标，与 `transform` 无关）。
 *
 * 为什么不用 `accumToApp` 的 `offsetTop` 累加（这是修前那个洞的根因）：
 * `offsetParent` 只认**最近的定位祖先**，而 `#app` 是 `position: static`
 * （`styles.css:18` 只给了 `max-width/margin/padding`）⇒ 那条链**永远走不到 `#app`**，
 * `reachedApp` 恒 `false`、量出来的盒子恒 `null`。手机旋转档恰好掩盖了它
 * （`html.t39-rot90 #app` 是 `position: fixed`，链走得到），所以 T39 的读数是**真的**、
 * 平板是**假的**：实测 `counts=[['.board',1],['.hand.self',1]]` 而 `box: null`。
 *
 * 量法：先摘掉本模块写的 `transform`（继承那份"量未变换布局盒"的既有口径），
 * 用 `getBoundingClientRect` 量，再用 `scrollTop/scrollLeft` 的差值把它折算回
 * **`#app` 内容坐标**（`rect` + 已滚过的距离）。
 *
 * ⚠️ 调用方**一律走上面的 `measureLayoutWithTransformZeroed()`**（它保证"量的时候变换真的是零"）；
 * 直接调本函数在旋转档下量到的不是布局盒（见上面那段读数）。
 */
function measureWideLayout(app: HTMLElement, sels: readonly string[] = FIT_TARGETS): { box: FitBox; measured: { sel: string; count: number }[] } | null {
  const root = document.documentElement;
  const hadFit = root.classList.contains(WIDE_FIT_CLASS);
  root.classList.remove(WIDE_FIT_CLASS);
  if (app.style.transform !== '') app.style.transform = '';
  const beforeTop = app.scrollTop;
  const beforeLeft = app.scrollLeft;
  app.scrollTop = 0;
  app.scrollLeft = 0;
  const appRect = app.getBoundingClientRect();
  const nodes: HTMLElement[] = [];
  const measured: { sel: string; count: number }[] = [];
  for (const sel of sels) {
    const found = Array.from(document.querySelectorAll<HTMLElement>(sel));
    measured.push({ sel, count: found.length });
    for (const el of found) if (!nodes.includes(el)) nodes.push(el);
  }
  let minX = Number.POSITIVE_INFINITY; let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY; let maxY = Number.NEGATIVE_INFINITY;
  let any = false;
  for (const el of nodes) {
    const r = el.getBoundingClientRect();
    if (r.width <= 0 && r.height <= 0) continue;
    any = true;
    minX = Math.min(minX, r.left - appRect.left);
    minY = Math.min(minY, r.top - appRect.top);
    maxX = Math.max(maxX, r.right - appRect.left);
    maxY = Math.max(maxY, r.bottom - appRect.top);
  }
  app.scrollTop = beforeTop;
  app.scrollLeft = beforeLeft;
  if (hadFit) root.classList.add(WIDE_FIT_CLASS);
  if (!any) return null;
  return { box: { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY }, measured };
}

/* ============================================================================
 * ★★ G6/T44 修复轮（用户裁决 B 的后半句）：**两轴拖动平移** + **看得见的提示**
 *
 * 口径（评审给的原话）：**背景（非卡面）单指拖动 ＝ 平移**；卡面上照旧拖牌
 * （`.card` 的 `touch-action: none` 保留、`touch-bridge` 那条路一个字不动）。
 * 三条硬要求：① 卡面/按钮/浮层上的指针**一个都不吃**；② 平移有**边界钳制**（拖不出空白）；
 * ③ 有一个**看得见**的提示（`t44-pan-hint`）。
 *
 * ## 为什么平移不是"滚动"而是"改 `--t39-tx/--t39-ty`"
 *
 * 缩放档里 `#app` 是 `overflow: visible`（负方向溢出的内容必须能画出来，T39 第一轮的根因），
 * 所以没有可滚的滚动区。位移只能由本模块自己拿（与缩放同一个坐标系），也正因如此
 * **钳制**是必须的：没有浏览器帮你兜住"拖到空白"。
 */

/** 当前由手指带来的额外位移（叠加在缩放那一档算出来的基准位移上） */
let panX = 0;
let panY = 0;
/** 允许区间（由 `applyTransformVars` 每次重算；内容比视口小 ⇒ 退化成 0） */
let panRange = { loX: 0, hiX: 0, loY: 0, hiY: 0 };
/** 这一档的基准位移与内容盒（矫正阶段要用它重算区间） */
let fitBase = { tx: 0, ty: 0, k: 1, vp: { w: 0, h: 0 }, box: null as FitBox | null, rotated: false, H: 0 };
let panHint: HTMLElement | null = null;
let panDrag: { id: number; x0: number; y0: number; bx: number; by: number; moved: boolean } | null = null;
let killClick: ((e: Event) => void) | null = null;
let panInstalled = false;

/** 拖动提示（body 级、`pointer-events: none`、样式在 `styles-touch.css`） */
function syncPanHint(on: boolean): void {
  if (panHint === null || !panHint.isConnected) {
    panHint = document.createElement('div');
    panHint.className = PAN_HINT_CLASS;
    panHint.textContent = '在空白处单指拖动，查看画面其余部分';
    document.body.appendChild(panHint);
  }
  panHint.classList.toggle('is-on', on);
  panHint.setAttribute('aria-hidden', on ? 'false' : 'true');
}

/**
 * 把"缩放基准位移 + 手指位移"写进 CSS 变量，并**钳制**手指位移。
 *
 * 钳制口径：内容比视口大时，屏上不许出现空白 —— 左缘 ≤ 0 且右缘 ≥ `vp.w`（两轴同理）；
 * 内容比视口小时不给拖（区间退化成 `0`，宁可居中）。
 *
 * ★★ G6/T48 口径：**"能拖到哪儿"与"摆谁进视口"用同一个盒。**
 * T48 试过把它们拆成两个盒（把牌库/弃牌堆单独算进拖动区间），实测两条读数**逐位相同**
 * —— `union.box` 本来就等于那个"可及范围"盒（`.board` 的 border box 已经把它们包住了）
 * ⇒ 那是死分支，本轮没留在代码里。真正让那两列进拖动区间的改动是把 `.deck` /
 * `.trash-pile` / `.trash-view-btn` 加进 `FIT_TARGETS`（见那里的头注与三档读数）。
 */
function applyTransformVars(k: number, tx: number, ty: number, vp: { w: number; h: number }, box: FitBox | null, rot?: { rotated: boolean; H: number }): void {
  const rotated = rot?.rotated ?? fitBase.rotated;
  const H = rot?.H ?? fitBase.H;
  fitBase = { tx, ty, k, vp, box, rotated, H };
  if (box !== null) {
    /**
     * 内容盒在**屏幕**上的矩形 —— 旋转档两轴是交换的（与 `#app` 那条 transform 同式）：
     * `screen = (tx + k(H − py), ty + k·px)` ⇒ 盒的屏幕左上角 = （`tx + k(H − maxY)`, `ty + k·minX`），
     * 屏幕宽高 = （`k·h`, `k·w`）。用错的轴会让钳制区间整个偏掉（横着拖不动）。
     */
    const sr = rotated
      ? { left: tx + k * (H - box.maxY), top: ty + k * box.minX, w: k * box.h, h: k * box.w }
      : { left: tx + k * box.minX, top: ty + k * box.minY, w: k * box.w, h: k * box.h };
    panRange = {
      loX: sr.w <= vp.w + 1 ? 0 : vp.w - (sr.left + sr.w),
      hiX: sr.w <= vp.w + 1 ? 0 : -sr.left,
      loY: sr.h <= vp.h + 1 ? 0 : vp.h - (sr.top + sr.h),
      hiY: sr.h <= vp.h + 1 ? 0 : -sr.top,
    };
  } else {
    panRange = { loX: 0, hiX: 0, loY: 0, hiY: 0 };
  }
  panX = Math.max(panRange.loX, Math.min(panRange.hiX, panX));
  panY = Math.max(panRange.loY, Math.min(panRange.hiY, panY));
  const root = document.documentElement;
  root.style.setProperty('--t39-k', String(Math.round(k * 10000) / 10000));
  root.style.setProperty('--t39-tx', `${Math.round((tx + panX) * 100) / 100}px`);
  root.style.setProperty('--t39-ty', `${Math.round((ty + panY) * 100) / 100}px`);
  syncPanHint(box !== null && (panRange.loX !== panRange.hiX || panRange.loY !== panRange.hiY));
}

/** 拖动结束后要吃掉的那一个 `click`（拖完松手会补一个 click，别让它点到东西） */
function armKillClick(): void {
  releaseKillClick();
  const kill = (ev: Event): void => { ev.stopPropagation(); ev.preventDefault(); };
  killClick = kill;
  document.addEventListener('click', kill, true);
  /* 窗口只留 400ms：拖动松手后浏览器补的那个 click 在 10ms 级到达，400ms 足够吃掉它；
     再长就会把"拖完马上点一下"（真用户常做）也吃掉 —— 实测踩到过（夹具点卡后 selectedCount=0）。 */
  window.setTimeout(releaseKillClick, 400);
}

function releaseKillClick(): void {
  if (killClick !== null) {
    document.removeEventListener('click', killClick, true);
    killClick = null;
  }
}

/** 这一档要不要吃平移手势（没挂缩放档时一个监听器都不该有行为） */
function panActive(): boolean {
  const root = document.documentElement;
  return root.classList.contains(FIT_CLASS) || root.classList.contains(WIDE_FIT_CLASS);
}

function onPanDown(e: PointerEvent): void {
  if (panDrag !== null) return;
  /**
   * ★ 2026-09-29：**触摸才算拖动**（与本仓既有的触屏纪律一致：指针处理器一律先挡非触摸）。
   *
   * 用户实测的 bug 之二：桌面 1280 宽窗口下鼠标左键拖动被当成平移手势（宽视口档误接管所致，
   * 守卫 ④ 已从源头关掉）。这里再加一道：即使某台设备真的进了缩放档，鼠标也**不许**被吃掉 ——
   * 滚轮/选择/点击照旧归浏览器。
   */
  if (e.pointerType !== 'touch') return;
  if (!panActive()) return;
  const t = e.target;
  if (!(t instanceof Element)) return;
  if (t.closest(PAN_BLOCK_SEL) !== null) return; // 卡面/按钮/浮层：一个都不吃
  panDrag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, bx: panX, by: panY, moved: false };
  releaseKillClick();
}

function onPanMove(e: PointerEvent): void {
  const d = panDrag;
  if (d === null || e.pointerId !== d.id) return;
  const dx = e.clientX - d.x0; const dy = e.clientY - d.y0;
  if (!d.moved && Math.abs(dx) + Math.abs(dy) < 6) return; // 6px 以内当点击，不抢
  d.moved = true;
  panX = Math.max(panRange.loX, Math.min(panRange.hiX, d.bx + dx));
  panY = Math.max(panRange.loY, Math.min(panRange.hiY, d.by + dy));
  const root = document.documentElement;
  root.style.setProperty('--t39-tx', `${Math.round((fitBase.tx + panX) * 100) / 100}px`);
  root.style.setProperty('--t39-ty', `${Math.round((fitBase.ty + panY) * 100) / 100}px`);
}

function onPanUp(e: PointerEvent): void {
  const d = panDrag;
  if (d === null || e.pointerId !== d.id) return;
  panDrag = null;
  if (d.moved) armKillClick();
}

/** 装上平移手势（全局只装一次；没挂缩放档时 `panActive()` 直接早退） */
function installPan(): void {
  if (panInstalled) return;
  panInstalled = true;
  window.addEventListener('pointerdown', onPanDown, { capture: true, passive: true });
  window.addEventListener('pointermove', onPanMove, { capture: true, passive: true });
  window.addEventListener('pointerup', onPanUp, { capture: true, passive: true });
  window.addEventListener('pointercancel', onPanUp, { capture: true, passive: true });
}

/** 复位手指位移（换档/退出缩放档时调用） */
function resetPan(): void {
  panX = 0; panY = 0;
  panRange = { loX: 0, hiX: 0, loY: 0, hiY: 0 };
  panDrag = null;
  releaseKillClick();
  syncPanHint(false);
}

/**
 * **可读地板量的那一族**：玩家**要读着才能操作**的那些字（自己手牌、关键按钮、行动条、钉住的按钮）。
 *
 * 为什么不量整块棋盘（实测踩到的口径问题）：棋盘里最小的一处是 `.trash-label`（弃牌堆张数标签）
 * 的 **9px**，它会把可读地板顶到 `10/9 = 1.11` ⇒ 封顶 1 ⇒ 整个缩放档**一次都不缩**
 * （等于放弃"全览"，而那条 9px 的小标签**仍然**是 9px —— 因为 `k` 封顶 1 不许放大）。
 * 用户与评审给的算术（1024 档 13px→0.77、1280 档 16px→0.63）量的就是**这一族**。
 * 棋盘整棵树的实测最小字号仍写进报告的"没验/残差"里，不藏。
 */
function readFontTargets(): string[] {
  return ['.hand.self', '.next-btn', '.choice-confirm', '.action-bar .btn', '.t39-pin'];
}

/**
 * 记忆上一次**量到过**的可读族最小字号（修复轮 2 补）：
 *
 * `readFloorK()` 在"这一族一个节点都没有"时只能返回 0 ⇒ `k` 会退回**老地板**。
 * 实测过这个窗口：手机旋转档在棋盘刚重建、`.hand.self` 还没进 DOM 的那一次 `syncFit` 里
 * `kRead=0 / k=0.5402`，下一帧才回到 `k=0.7692`。只要**量到过一次**就记住它 ⇒
 * 读数不再取决于"你在哪一帧读"。评审那次读到 `k=0.5402` 正是撞上这个窗口。
 */
let lastReadMinFont: number | null = null;

/** 可读优先地板：让这一族的最小字号 ≥ `K_READ_FONT_PX` 所需的 `k`（封顶 1）。 */
function readFloorK(): number {
  const min = minFontIn(readFontTargets());
  if (min !== null && min > 0) lastReadMinFont = min;
  const use = min !== null && min > 0 ? min : lastReadMinFont;
  if (use === null || use <= 0) return 0;
  return Math.min(1, K_READ_FONT_PX / use);
}

/** 一组选择器里最小的字号（有界遍历；只算有文字的元素）。 */
function minFontIn(sels: readonly string[]): number | null {
  const roots: HTMLElement[] = [];
  for (const sel of sels) for (const el of Array.from(document.querySelectorAll<HTMLElement>(sel))) roots.push(el);
  let min: number | null = null;
  let seen = 0;
  for (const root of roots) {
    const all = [root, ...Array.from(root.querySelectorAll<HTMLElement>('*'))];
    for (const el of all) {
      if (seen > 1500) break;
      seen += 1;
      if ((el.textContent ?? '').trim().length === 0) continue;
      const fs = Number.parseFloat(window.getComputedStyle(el).fontSize);
      if (!Number.isFinite(fs) || fs <= 0) continue;
      min = min === null ? fs : Math.min(min, fs);
    }
  }
  return min;
}

/** 整块棋盘（`.board` / `.net-board`）实测最小字号 —— **只进读数**，不参与算 `k`（见 `readFontTargets`）。 */
function minFontOnBoard(): number | null {
  return minFontIn(['.board', '.net-board']);
}

/* ============================================================================
 * ★★ G6/T44 修复轮（用户裁决"先试钉住层"）：手机旋转档把**双方协议信息框**收进钉住层
 *
 * ## 为什么不是"挪到 body"（与 `.next-btn` 那套不同的地方）
 *
 * 用户第 ④ 条要的是"**也要横置**"。挪到 `document.body` 的节点**不在 `#app` 里** ⇒
 * 它不继承 `#app` 那圈 `rotate(90deg)` ⇒ 还得自己再转一次、并且要自己跟着缩放档走。
 * 更省事、也更不容易出错的办法：**留在 `#app` 里**（旋转、缩放、坐标系全都自动继承 ⇒
 * "与棋盘同向"是**结构保证**），只用 `position: absolute` 把它从 `.net-left-rail` 的流里
 * 摘出来，再按**仿射反解**把它摆到屏幕上的目标位置。
 *
 * ## 仿射反解（与 `html.t39-rot90 #app` 的那条 transform 逐字同式）
 *
 * `screen = (tx + k(H − py), ty + k·px)`（`H = #app.offsetHeight`）。元素占 layout
 * `[px, px+w] × [py, py+h]` ⇒ 屏幕矩形左上角 `(tx + k(H − py − h), ty + k·px)`、
 * 屏幕尺寸 `(k·h) × (k·w)`。反解目标屏幕左上角 `(sx, sy)`：
 * `px = (sy − ty)/k`、`py = H − h − (sx − tx)/k`；再减掉 `#app` 的内边距（绝对定位的
 * 包含块是它的 padding box）。
 *
 * ## 摆哪儿
 *
 * 候选格按"上 → 下、左 → 右"扫，取**第一个既不压手牌、也不压关键按钮、还完整在视口内**的格子。
 */
function syncInfoPins(ctx: { k: number; tx: number; ty: number; H: number } | null): void {
  const blocks = Array.from(document.querySelectorAll<HTMLElement>('.net-info-block'));
  if (blocks.length === 0) return;
  if (ctx === null) {
    for (const b of blocks) {
      b.classList.remove(INFO_PIN_CLASS);
      b.style.removeProperty('left');
      b.style.removeProperty('top');
    }
    lastFit.infoPins = [];
    return;
  }
  const app = document.getElementById('app');
  if (app === null) return;
  const root = document.documentElement;
  const vp = visibleViewport();
  const k = Math.max(0.01, ctx.k);
  const rectOf = (sel: string): { x: number; y: number; right: number; bottom: number }[] =>
    Array.from(document.querySelectorAll<HTMLElement>(sel)).map((el) => {
      const r = el.getBoundingClientRect();
      return { x: r.left, y: r.top, right: r.right, bottom: r.bottom };
    });
  const avoid: { x: number; y: number; right: number; bottom: number }[] = [
    ...rectOf('.hand.self'),
    ...rectOf('.next-btn'), ...rectOf('.choice-confirm'), ...rectOf('.t39-pin'),
  ];
  const hits = (r: { x: number; y: number; right: number; bottom: number }, q: { x: number; y: number; right: number; bottom: number }): boolean =>
    !(r.right <= q.x + 1 || r.x >= q.right - 1 || r.bottom <= q.y + 1 || r.y >= q.bottom - 1);
  for (const b of blocks) b.classList.add(INFO_PIN_CLASS);
  const out: PhoneFitRecord['infoPins'] = [];
  /**
   * 摆放：**先给个初值，再按实测屏幕误差反解**（3 次就收敛到亚像素）。
   *
   * 为什么不用一次性解析式：布局坐标 → 屏幕坐标之间隔着 `#app` 那圈
   * `translate + scale + rotate(90°) + translateY(-100%)` 以及 `#app` 的 `padding`
   * （绝对定位的包含块是 **padding box**）—— 我照着公式写错过一次（实测把信息框摆到了
   * `x -96..12`，还盖住了手牌）。改成"量误差 → 反解 → 再量"之后不依赖任何一处符号推演：
   * 屏幕 x 对 `top` 的斜率是 `-k`、屏幕 y 对 `left` 的斜率是 `+k`（旋转把两轴换了）。
   */
  const place = (el: HTMLElement, slotX: number, slotY: number): { x: number; y: number; right: number; bottom: number } => {
    el.style.left = '0px';
    el.style.top = '0px';
    let cur = el.getBoundingClientRect();
    for (let i = 0; i < 3; i += 1) {
      const errX = slotX - cur.left;
      const errY = slotY - cur.top;
      if (Math.abs(errX) < 0.6 && Math.abs(errY) < 0.6) break;
      const left = (Number.parseFloat(el.style.left) || 0) + errY / k;
      const top = (Number.parseFloat(el.style.top) || 0) - errX / k;
      el.style.left = `${Math.round(left * 10) / 10}px`;
      el.style.top = `${Math.round(top * 10) / 10}px`;
      cur = el.getBoundingClientRect();
    }
    return { x: cur.left, y: cur.top, right: cur.right, bottom: cur.bottom };
  };
  for (const b of blocks) {
    const h = b.offsetHeight; const w = b.offsetWidth;
    const sw = k * h; const sh = k * w; // 屏幕上的宽/高（两轴交换）
    let chosen: { x: number; y: number } | null = null;
    let rect = { x: 0, y: 0, right: 0, bottom: 0 };
    for (const slot of slotCandidates(sw, sh, vp)) {
      rect = place(b, slot.x, slot.y);
      const cand = { x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom };
      const inside = cand.x >= -1 && cand.y >= -1 && cand.right <= vp.w + 1 && cand.bottom <= vp.h + 1;
      if (!inside) continue;
      if (avoid.some((a) => hits(cand, a))) continue;
      chosen = slot;
      break;
    }
    if (chosen === null) { // 一个空格都没有：摆在左上并如实记（读数里带 overlap/inside=false）
      rect = place(b, 6, 6);
    }
    out.push({
      seat: b.dataset.netSeat ?? null,
      screen: { x: Math.round(rect.x), y: Math.round(rect.y), right: Math.round(rect.right), bottom: Math.round(rect.bottom) },
      inside: rect.x >= -1 && rect.y >= -1 && rect.right <= vp.w + 1 && rect.bottom <= vp.h + 1,
    });
    avoid.push({ x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom });
  }
  lastFit.infoPins = out;
  // 兜底：装完信息框之后把 `#app` 的滚动复位（绝对定位元素不会引入滚动，但保险）
  if (app.scrollLeft !== 0) app.scrollLeft = 0;
  if (app.scrollTop !== 0) app.scrollTop = 0;
  void root;
}

/** 候选格子（屏幕坐标）：上 → 下、左 → 右，步长按元素屏幕尺寸给，保证不重叠。 */
function slotCandidates(sw: number, sh: number, vp: { w: number; h: number }): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  const stepX = Math.max(24, sw + 6);
  const stepY = Math.max(24, sh + 6);
  for (let y = 6; y + sh <= vp.h - 6; y += stepY) {
    for (let x = 6; x + sw <= vp.w - 6; x += stepX) out.push({ x, y });
  }
  if (out.length === 0) out.push({ x: 6, y: 6 });
  return out;
}

/**
 * 宽视口那一格的落盘：`k = max(全览所需 k, 可读所需 k)`（封顶 1），再把主判据那一族
 * （手牌 + 关键按钮）摆到可见视口中心，最后按屏幕矩形做一次硬矫正。整块棋盘放不下时
 * **两轴拖动**接手（见 `applyTransformVars` / `installPan`）。
 */
function syncWideFit(app: HTMLElement): void {
  const vp = visibleViewport();
  const unionRaw = measureLayoutWithTransformZeroed(app, FIT_TARGETS);
  if (unionRaw === null || unionRaw.box === null) { clearFit(); return; }
  const union = { box: unionRaw.box, measured: unionRaw.measured };
  const critRaw = measureLayoutWithTransformZeroed(app, wideCritTargets());
  const crit = critRaw !== null && critRaw.box !== null ? { box: critRaw.box, measured: critRaw.measured } : union;
  const kUnion = Math.min(vp.w / union.box.w, vp.h / union.box.h, 1);
  const kRead = readFloorK();
  const takeUnion = kUnion >= K_FLOOR_WIDE;
  const box = takeUnion ? union.box : crit.box;
  /**
   * ★ 可读优先（用户裁决 B）：`k = max(全览所需的 k, 最小字号 ≥ 10px 所需的 k)`，封顶 1。
   * `K_FLOOR_WIDE` 只是**绝对下界**（比 0.45 还小就没法看了）；真正决定值的是那两个数。
   */
  const k = Math.max(K_FLOOR_WIDE, Math.min(1, Math.max(takeUnion ? kUnion : K_FLOOR_WIDE, kRead)));
  // `#app` 自己有 12px 上 / 100px 左的内边距 ⇒ 内容坐标要减掉它才是"盒在视口里的位置"
  const baseTx = -k * box.minX + (vp.w - k * box.w) / 2;
  const baseTy = -k * box.minY + (vp.h - k * box.h) / 2;
  const root = document.documentElement;
  root.classList.add(WIDE_FIT_CLASS);
  applyTransformVars(k, baseTx, baseTy, vp, union.box);
  syncInfoPins(null); // 宽视口那一格不进钉住层（信息框由 fit + 拖动覆盖）
  lastFit = {
    box: union.box,
    critBox: crit.box,
    need: { w: union.box.w, h: union.box.h },
    kRaw: kUnion,
    kCrit: Math.min(vp.w / crit.box.w, vp.h / crit.box.h, 1),
    kRead,
    k,
    tx: baseTx,
    ty: baseTy,
    fits: kUnion >= K_FLOOR_WIDE,
    boardFit: takeUnion,
    kUnionNeeded: Math.round(kUnion * 1000) / 1000,
    measured: union.measured,
    minFontPx: minFontPxOf(app),
    infoPins: [],
    fonts: { readMin: minFontIn(readFontTargets()), readScaled: null, boardMin: minFontOnBoard() },
  };
  syncPin(app, ['.next-btn'], PIN_NEXT_CLASS);
  syncPin(app, ['.choice-confirm'], PIN_CHOICE_CLASS);
  syncPin(app, ['.diag-btn'], PIN_DIAG_CLASS);
  /** ★ T48 跟进：两侧「查看弃牌堆」一起钉（同族多个） */
  syncPin(app, ['.trash-view-btn'], PIN_TRASH_CLASS, true);
  correctIntoViewport(app, vp.w, vp.h, wideCritTargets());
}

/** 宽视口那一格的主判据族：`critTargets()` 之上多两块协议信息框（用户第 ④ 条）。 */
function wideCritTargets(): string[] {
  return [...critTargets(), '.net-info-block'];
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
function correctIntoViewport(app: HTMLElement, vw: number, vh: number, crit: string[] = critTargets()): void {
  const critBox = screenBoxOf(crit);
  if (critBox === null) return;
  const first = needShift(critBox, vw, vh);
  /**
   * ⚠️ 基准位移从 `fitBase` 取（**不是**读 CSS 变量）—— 变量里带手指平移量，
   * 拿它当基准会把"手指拖到哪里"当成"这一档算出来的位置"，越矫正越偏。
   * 每次写回都走 `applyTransformVars`（它负责钳制、提示、把平移重新叠上去）。
   */
  let tx = fitBase.tx + first.dx;
  let ty = fitBase.ty + first.dy;
  applyTransformVars(fitBase.k, tx, ty, fitBase.vp, fitBase.box);
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
    applyTransformVars(fitBase.k, tx, ty, fitBase.vp, fitBase.box);
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
  /** T44：过渡覆盖层上那句"正在进入对局……"的兜底（视频不播时不要只剩一块纯色） */
  initTransitionHint();
  /** T44 修复轮：两轴拖动平移（背景单指拖；卡面/按钮/浮层不吃） */
  installPan();
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
    /**
     * ★ T51：门的白名单看的是"**当前**这一屏"（`onBoardScreen()` 现查 DOM）⇒ `#app` 一重画
     * 就必须重算门，不能只重算缩放 —— 否则从大厅进牌桌那一刻门永远不会出现（大厅里没有
     * `.board`，进对局之后 `#app` 整棵换掉但没有任何 `resize`/`orientationchange` 事件）。
     * 门挂在 `document.body`（**不在被观察的 `#app` 子树里**）⇒ 这一句不会自激。
     */
    const mo = new MutationObserver(() => { syncGate(); scheduleFit(); });
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
