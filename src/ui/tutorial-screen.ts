/**
 * ★ 2026-10-02（P2，用户口径）：**教学屏**（教练浮层 + 真引擎棋盘 + 关卡流程）。
 *
 * 方案：`docs/2026-10-01-新手引导与教学-方案.md` §5.1（形态）、§5.2（关卡表）、§7 的 P2 行。
 *
 * ## 这一屏怎么"再驱动一局"（探路结论的落点，见方案 §7.8）
 *
 * 棋盘**不重画一遍**：本屏直接调 `renderApp(root, state, cb)`（`src/ui/render.ts` 的既有出口），
 * 只是 `state` 与 `cb` 都是**教学自己的**：
 *  - `state` = `buildLevelState(id)`（`createGame()` 之后摆成的受控局面，`src/tutorial/setup.ts`）；
 *  - `cb` = 本文件的 `tutorialCallbacks()`：**拦白名单**（不在本关 `allowKinds` 里的动作不提交，
 *    只给一句走偏提示）、转调 `applyRecordedAction`（全仓唯一的"操作 → 引擎"映射）、
 *    每次动作后判定关卡、必要时进下一关。
 *
 * ⇒ **零红线改动**：`render.ts` / `core/**` 一个字不动，它们只是被**调用**。
 * 代价（如实登记）：`render.ts` 里那些"可点/可拖"的判断是按 `getLegalActions` 算的，
 * 教学**没法阻止玩家去拖一张不该拖的牌** —— 只能在 `cb` 里**拒收**并提示。
 * 所以本关的"只放行"是**事后退回 + 提示**，不是"按钮变灰"。
 *
 * ## 教练浮层
 *
 * 照 `settingsOverlayElement` / `onboarding` 那一套：**`document.body` 级浮层** + 新类名
 * （`.tutorial-*`，落在 `src/ui/styles-local.css`），不进 `#app`、不碰 `styles.css`。
 * T0 的四个热点也是浮层上的元素：它们**盖在真棋盘对应的区域上**（浮层自己算位置），
 * 点了算"看过这个区域"——这样 T0 不用让玩家去点引擎里的东西（T0 本来也没有引擎动作）。
 */
import { createLocalDriver, type MatchDriver } from '../app/match-driver';
import type { LocalStore } from '../app/local-store';
import type { GameState, Line, PlayerId } from '../core/models/types';
import { findCard } from '../core/effects/context';
import { getLineValue } from '../core/state/create';
import { renderApp, resetUiState, setDraftSelfSeat, type UiCallbacks } from './render';
// ★ 2026-10-06（**用户当天报的缺陷**）：「教程里的死板7在移动过页面后的场上持续特效会消失，
// 而特效并没有继续持续跟随卡牌而显示」。
// 常驻层（3代那一族，`rigidity-7` 的护壁就在里面）的"跟随"由 `main.ts` 的滚动/缩放 rAF 驱动，
// 而那一路原来永远拿**主循环自己那一份 state** 去同步；教学屏画的是**它自己那份受控局面**
// ⇒ 一滚动，教学屏的层就被按一份不相干的局面 prune 掉（层当场淡出、320ms 后移除）。
//
// 修法两半（2026-10-06 第二轮起走**同一个出口**，不再各造一套）：
//  1. `setBoardState(state)` 声明"这一屏的棋盘是这个局面"⇒ 滚动/缩放那一趟自己就会拿它去同步
//     （`main.ts` 的 `syncPersistentFx` 里每条 sync 都喂 `boardStateOf(state)`）；
//  2. 本屏自己那两个滚动/缩放监听（`onViewportMove`）复用 `main.ts` 导出的**同一个** `syncPersistentFx`
//     —— 同一份清单、同一个判据，`render.ts` 那一族（冰1 的线冻结就在里面）也一并跟上。
import { setBoardState } from './board-scope';
// ⚠️ 常驻 FX 的滚动/缩放同步清单**只能有一份**（两份清单必然漂），那一份住在
// `./fx-persistent-sync`（`main.ts` 的滚动 rAF 调的也是它）。本屏不再自己列清单 ——
// 上一版只同步 3 代那一族，`render.ts` 那一族（冰1 的线冻结就在里面）因此没人替它重定位。
import { syncPersistentFx } from './fx-persistent-sync';
// ★ 2026-10-06（同一族查漏）：2代那一批**瞬态** body 级 FX 的清扫口（`main.ts` 的两处整局复位
// 已经在用它）。换关同样是"换局面"，上一关那个播到一半的层不该悬在下一关上 —— 见 `openLevel()`。
import { clearGen2Fx } from './fx-gen2';
import { TUT_LEVELS, levelAt, levelById, levelIndex, TUT_SPOTS, type TutLevel } from '../tutorial/levels';
import { buildLevelState } from '../tutorial/setup';
import { isLevelComplete, offTrackKeyFor, observedOps, ownCardCovered, revealSeen, secretFromDeckPlayed, snapshot, type TutSnap } from '../tutorial/judge';
import { advance, readProgress, restart } from '../tutorial/progress';
import type { TutChoiceSeen, TutLevelId, TutOp, TutSpot, TutUiSeen } from '../tutorial/types';
import { TUT_UI_NONE, triggersSeen } from '../tutorial/types';
import { onLangChange, t } from '../i18n';
// ★ 2026-10-02（用户当天报的缺陷）：T0 的四个热点改走本仓既有的**跟随注册表**
// （`render.ts` 每帧 + `main.ts` 的滚动/缩放 rAF 各调一次 `syncFollowers()`）。
// 与 `gen3-control.ts` 的 C4 对比条同一套做法，不新造第二套定时/重定位管线。
import { registerFollow } from './fx-follow';
// ★ 2026-10-06（**用户当天报的缺陷**：「第六关（= T4）里打出『精神1』的抽牌特效没有了」）：
// 抽牌飞入特效的**唯一出处**（累加器 + `.draw-ghost` 动画）搬到了 `./main-draw-fx`。
// 本屏原先**没有**这一段收尾代码 —— `tutorialCallbacks().onAction` 只做 `driver.submit` +
// `judgeAndAdvance()`，而累加器原先只被 `main.ts` 的 `cb.onAction` 读 ⇒ 教学这条路上牌抽到了、
// 动画一次都不播（详见 `main-draw-fx.ts` 的文件头注）。
import { subscribeDraws, drainDraws, resetDraws, playDrawSequence } from './main-draw-fx';

/**
 * ★ 2026-10-06（**用户当天要求**）：**每一关**判定通过之后，在**屏幕中间**显示这个毫秒数的
 * 倒计时，到点再自动进下一关。
 *
 * 用户原话：「每一关完成后中间都要有5秒倒计时自动进入下一关的效果，而不是直接进入下一关，
 * 第三关的10秒等待改为5秒」。
 *
 * ## 这一条把原来那两处"延后换关"合并了
 *
 *  - S0 的 `S0_WIN_HOLD_MS`（2200ms，为的是看清胜利横幅）；
 *  - T1 的 `T1_READ_HOLD_MS`（10000ms，为的是读完那张卡；用户这次把它点名改成 5 秒）。
 *
 * 现在**所有关卡**（最后一关除外，它没有下一关）走的是同一条路：过关 ⇒ 中间数 5 秒 ⇒ 换关。
 * 那两个常量已删除 —— 5 这个数**只在本行定义一处**，浮层初值、每秒递减、到点换关全读它。
 *
 * ⚠️ **只排一个定时器**（`startLevelCountdown()` 里那个 `nextLevelTimer === null` 的 guard）：
 * `judgeAndAdvance()` 会被**重复**调用（倒计时里玩家再双击一张卡、或再动一下棋盘都会走它），
 * 不设 guard 的话两条链都会到点，第二次 `gotoNextLevel()` 会**再往下跳一关**。
 */
export const LEVEL_CLEAR_COUNTDOWN_MS = 5000;

/** 倒计时**每秒跳一格**（屏上那几个数就是 `LEVEL_CLEAR_COUNTDOWN_MS` 除以它） */
export const COUNTDOWN_TICK_MS = 1000;

/**
 * 倒计时浮层上的秒数：剩余毫秒 ⇒ 那个整数（5 → 4 → 3 → 2 → 1）。
 *
 * 导出是为了让"5 秒、一秒一格"这件事有**真跑的行为腿**（`tests/tutorial/screen.test.ts`
 * 从 `LEVEL_CLEAR_COUNTDOWN_MS` 一路减下去，断言 5/4/3/2/1）—— 本仓没有 jsdom，
 * `mountTutorial` 那一层跑不起来（见那个测试文件的头注），而这一段是纯算术，能真跑。
 */
export function countdownSecondsOf(msLeft: number): number {
  // `max(1, …)` 只为兜住"剩余不足一格"的最后一帧（到点那一帧由 `gotoNextLevel()` 接手，不显示 0）
  return Math.max(1, Math.ceil(msLeft / COUNTDOWN_TICK_MS));
}

/** 倒计时那条文案（浮层上明写的那句）。键 `tutorial.countdown`：中英各一条，占位符 `{n}` */
export function countdownLabel(msLeft: number): string {
  return t('tutorial.countdown', { n: String(countdownSecondsOf(msLeft)) });
}

/**
 * 造那个**屏幕中间**的倒计时浮层（body 级，样式在 `src/ui/styles-local.css` 的 `.tutorial-countdown`）。
 *
 * 一开始是 `hidden`：只有过关之后那 5 秒里才显示（`startLevelCountdown()`）。
 * 导出同 `placeSpotBoxes` / `applyNextButtonVisibility`：只为让"浮层真的造出来了、类名是这一族、
 * 初始是藏着的"这几条有**真跑的行为腿**（桩 DOM），不是给别的调用方用的。
 */
export function countdownOverlayElement(): { box: HTMLElement; text: HTMLElement } {
  const box = el('div', 'tutorial-countdown');
  const text = el('div', 'tutorial-countdown-text');
  box.hidden = true;
  box.appendChild(text);
  return { box, text };
}

/** 退出教程（回首页）；由宿主注入 —— 屏自己不认识首页 */
export interface TutorialNav {
  /** 点「退出教程」 */
  exit(): void;
  /** 进度写盘的结果（写失败时屏上如实提示；由宿主按 `applyWriteResult` 同一套口径转文案） */
  saveProgress(progress: { readonly done: readonly TutLevelId[]; readonly current: TutLevelId }): void;
}

/** 屏的返回值：卸载（撤监听 + 摘浮层 + 清 render.ts 的模块态） */
export interface TutorialHandle {
  close(): void;
}

/* ─────────────────── T0 的四个热点：几何（量出来，不是猜出来） ─────────────────── */

/**
 * ★ 2026-10-02（**用户当天报的视觉缺陷**，原话：「你看看教程页面的这个特效，是不是搞错了，
 * 另外这个特效也是**粘在上面**的」）：四个热点改成**按目标元素的实测矩形**摆。
 *
 * ## 原实现错在哪
 *
 * 原来是一张 `SPOT_BOX` 表：`left/top/width/height` 四个**写死的视口百分比**，挂在
 * `.tutorial-overlay`（`position: fixed; inset: 0`）上。两个后果，正是用户说的那两句：
 *  1. **"是不是搞错了"**：百分比是照某一次窗口尺寸目测的，与协议卡 / 链路槽 / 能量槽（总值）/
 *     控制组件的真实矩形**没有任何关系**。实测（T0，1584×1305，无缩放）：
 *      · 链路槽实测 (0,145)–(567,1035)，而"链路"热点在 (601.9,339.3) 380.2×522 —— 罩的是
 *        协议格那一列的中段；
 *      · 协议格实测 (577,145)–(1007,1035)，而"协议卡"热点只有 117.4 高，只压住第一行的下半截；
 *      · 控制组件实测 (569.6,2)–(1350.3,129)，而"控制权"热点在 (997.9,522) —— 棋盘右下角；
 *      · 能量槽（"这条线的总值"）实测在 x=−118 与 x=1611（都在视口外），而"总值"热点在 (997.9,339.3)。
 *  2. **"粘在上面"**：fixed 浮层里的百分比点位**不跟棋盘走**。棋盘一动就错位，最狠的一档是
 *     `#app` 被整块缩放（触屏设备上 `phone-landscape.ts` 的 `t44-fit-wide` 会给 `#app` 挂
 *     `transform: translate(tx,ty) scale(k)`）—— 实测 1520×752 粗指针下 k≈0.769、ty≈−194，
 *     棋盘整块缩到中间，而热点仍按视口百分比钉在原处（用户截图里那几个"罩住 SPIRIT 卡 /
 *     向右延展到 WATER 两列"的框，就是这么来的）。
 *
 * ## 现在怎么算
 *
 * 每个热点给出它**要罩住的真元素**（选择器按顺序取第一组非空的命中），`placeSpotBoxes()`
 * 每次重画 / 滚动 / 缩放都重量一遍 `getBoundingClientRect()`、取并集包围盒写内联 px，
 * 并经 `registerFollow` 挂进既有跟随管线。
 */
const SPOT_TARGETS: Readonly<Record<TutSpot, readonly string[]>> = {
  /** 链路：牌打出来叠的那一块（亮着框的链路槽；拿不到 `.self` 就退回全部槽） */
  link: ['.stack-slot.self', '.stack-slot'],
  /** 协议卡：每条链路挂着的那两张 */
  protocol: ['.protocol-cell'],
  /** 总值：这条线的能量槽（10 格 = 10 分） */
  threshold: ['.battery'],
  /** 控制权：顶部那条控制轨/控制组件 */
  control: ['.control-module', '.control-track'],
};

/**
 * 某个热点当前要罩住的元素：`SPOT_TARGETS` 里**第一组非空**的选择器命中集。
 *
 * ⚠️ `threshold` 多一道筛：只取**亮着框那一侧**的能量槽（与 `link` 同一侧）。
 * 双方六个能量槽的并集**横跨整块棋盘**（实测 x=−118…2039），那样画出来的框会把
 * `link` / `protocol` 两个热点整块压住 —— 两个都点不到，T0 直接卡死。
 */
function spotNodes(spot: TutSpot): HTMLElement[] {
  const pick = (...selectors: readonly string[]): HTMLElement[] => {
    for (const sel of selectors) {
      const hit = [...document.querySelectorAll<HTMLElement>(sel)];
      if (hit.length > 0) return hit;
    }
    return [];
  };
  if (spot !== 'threshold') return pick(...SPOT_TARGETS[spot]);
  const all = pick(...SPOT_TARGETS.threshold);
  const side = document.querySelector<HTMLElement>('.stack-slot.self')?.dataset.player;
  const mine = side === undefined ? [] : all.filter((node) => node.dataset.player === side);
  return mine.length > 0 ? mine : all;
}

/** 视口坐标下的矩形（`getBoundingClientRect()` 的四边；只取用得到的四个字段） */
export interface SpotRect {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

/**
 * 一组矩形的**并集包围盒**（导出：几何是纯函数，能在 node 下单测 —— 本仓没有 jsdom）。
 *
 * 空数组、或全是零面积（未布局 / `display:none`）⇒ `null`：调用方据此**保持上一次的位置**，
 * 不清零、不跳到 (0,0)（跳到左上角会在棋盘重画的那一帧闪一下）。
 */
export function unionRect(rects: readonly SpotRect[]): SpotRect | null {
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  let n = 0;
  for (const r of rects) {
    if (!(r.right > r.left) || !(r.bottom > r.top)) continue;
    left = Math.min(left, r.left);
    top = Math.min(top, r.top);
    right = Math.max(right, r.right);
    bottom = Math.max(bottom, r.bottom);
    n += 1;
  }
  return n === 0 ? null : { left, top, right, bottom };
}

/**
 * 把并集盒换算成**相对热点层**（`base`）的内联样式（px）。
 *
 * 为什么减去 `base`：热点是热点层里的 `position: absolute` 子元素，`getBoundingClientRect()`
 * 给的是视口坐标。热点层现在恒等于视口（`inset: 0` 的 fixed 浮层），但减去它是**免费的**，
 * 而且浮层一旦有了内边距/边框就不会静默错位。
 */
export function spotBoxStyle(
  box: SpotRect | null,
  base: SpotRect,
): { left: string; top: string; width: string; height: string } | null {
  if (box === null) return null;
  return {
    left: `${(box.left - base.left).toFixed(2)}px`,
    top: `${(box.top - base.top).toFixed(2)}px`,
    width: `${(box.right - box.left).toFixed(2)}px`,
    height: `${(box.bottom - box.top).toFixed(2)}px`,
  };
}

/**
 * 把四个热点摆到各自目标的**实测矩形**上。
 *
 * 调用时机 = 本仓既有的跟随管线（`registerFollow`）：`renderApp` 每帧末尾、以及
 * `main.ts` 的滚动/缩放 rAF 各调一次 `syncFollowers()`。所以滚动、改窗口尺寸、
 * 棋盘重画（换关 / 动作后重画）之后它都会重跑 —— 这正是"不再粘在屏幕上"的那一半。
 *
 * 导出是为了让几何有**真跑的行为腿**（`tests/tutorial/screen.test.ts` 用本仓的 DOM 桩
 * 喂一组矩形，断言写出来的四个 px 值），不是给别的调用方用的。
 */
export function placeSpotBoxes(layer: HTMLElement, spots: ReadonlyMap<TutSpot, HTMLElement>): void {
  // 热点层在非 T0 关卡是 `[hidden]`（`display:none`）：此时量出来的目标矩形没有意义，直接跳过。
  if (layer.hidden) return;
  const base = layer.getBoundingClientRect();
  for (const [spot, node] of spots) {
    const style = spotBoxStyle(unionRect(spotNodes(spot).map((el) => el.getBoundingClientRect())), base);
    // 目标还没渲染出来（重画中途）/ 这一关没有这一族元素 ⇒ 保持上一次的位置
    if (style === null) continue;
    node.style.left = style.left;
    node.style.top = style.top;
    node.style.width = style.width;
    node.style.height = style.height;
  }
}

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

/**
 * ★ 2026-10-06（**用户当天报的缺陷**）：**「下一步」那颗按钮不该露给玩家**。
 *
 * 用户原话：「别总是在每一次阶段中间都显示名为「下一步」的按钮，虽然按不了，但是会让玩家觉得
 * 困惑，由于这个是测试时才会用到的按钮，所以不要暴露给玩家」。
 *
 * 根因（已核源码）：红线上那颗按钮（`render.ts:5416` 的 `el('button', 'btn next-btn', …)`）
 * 在 `getLegalActions` 给出 `advance` 时就渲染，而教学屏的 `allowedBy()` 只放行本关
 * `allowKinds` 里的动作 ⇒ 除 T10/T11 之外的关卡里它**按不动**（点了只给一句走偏提示、
 * 引擎里什么都没发生）。所以：**本关不放行 `advance` ⇒ 画完棋盘就把它藏掉**。
 *
 * 只藏**按钮本身**：同一块 `.next-block` 里那句手牌提示（`.hint`）照旧留着。
 * ⚠️ 改的是教学屏自己这一侧 —— `render.ts` / `styles.css` 是红线，一个字节都不许改。
 *
 * 导出是为了让这条判据有**真跑的行为腿**（`tests/tutorial/screen.test.ts` 用本仓的 DOM 桩
 * 造一棵树、按每一关的白名单真调一遍），不是给别的调用方用的。
 */
export function applyNextButtonVisibility(root: ParentNode, allowAdvance: boolean): void {
  if (allowAdvance) return;
  const btn = root.querySelector<HTMLElement>('.next-btn');
  if (btn !== null) btn.style.display = 'none';
}

/**
 * ★ 2026-10-06（**用户当天要求**）：**点已解锁关卡下面那个小数字，就跳回那一关重玩**。
 *
 * 用户原话：「我希望点击已解锁关卡下方的小数字能够跳到对应的关卡并重新游玩该关卡」。
 * ★★ 2026-10-06 第二轮（**用户当天报的缺陷**）：「当我已经解锁了下一关并自动跳到下一关之后，
 * 我点击下方的数字回到上一关，下一关的跳转按钮会变灰并且无法跳回去，从第一关重来的按钮也会
 * 这样，请修复」——那是这一版的解锁口径写窄了，症状与根因见下面 §解锁口径。
 *
 * ## 解锁口径（这里就是它的唯一出处）
 *
 * **到过的最远处以及它之前的每一关都可点**。"到过的最远处"（下面的 `frontier`，0 起序号）取
 * 两样里较远的那个：
 *  1. **最后过掉的那一关的下一关**（`done` 里序号最大的那一关 + 1）—— 自动跳到下一关之后，
 *     那一关**还没进 `done`**（过完才会写进去），而它正是玩家脚下这一关；
 *  2. **面板上当前这一关**（`current`）。
 *
 * ⚠️ 上一版只认 `done ∪ {当前这一关}`，于是"跳回去"这个动作会把 `current` 变小 ⇒
 * **自动跳过去的那一关当场被锁上**：`done` 里没有它（还没过完）、`current` 也不是它
 * ⇒ chip 变灰（`.tutorial-chip-locked`，`disabled`），点不回去；「从第一关重来」那条路
 * 同理（老进度里 `S0` 不在 `done` 时，第一枚 chip 也会被锁上）。根因不是"哪个控件被禁用"，
 * 而是**解锁面跟着"正在看哪一关"缩水**，而它本该只增不减。
 *
 * ⚠️ 序号一律用 `all.indexOf()` 算（`done` 里可能有本表不认识的 id —— 坏 dataset / 幽灵关，
 * `indexOf` 给 -1，`+1` 之后就是 0，天然无害），不调 `levelIndex()`（它对未知 id 会抛）。
 *
 * ⚠️ 它**只算目标**：不写进度、不改 `done`、不改 `current`。跳回去看一遍不会把没过的标成过，
 * 也不会把过过的退回去（`advance()` 是唯一写进度的口，本函数不碰它）。
 *
 * 导出是为了让"哪几枚能点、点了去哪一关"有**真跑的行为腿**（`tests/tutorial/screen.test.ts`
 * 真调它逐关过一遍），不是给别的调用方用的。
 *
 * @param clicked 被点的那一枚的关卡 id（`chip.dataset.level`）
 * @param current 面板上"当前这一关"（也是可点的那一档）
 * @param done 进度里已完成的那几关
 * @param all 全部关卡（顺序即屏上 chip 的顺序；只有在这张表里的 id 才算数）
 */
export function chipJumpTarget(
  clicked: string,
  current: string,
  done: readonly string[],
  all: readonly string[],
): string | null {
  if (!all.includes(clicked)) return null;
  const unlocked = all.indexOf(clicked) <= chipFrontier(current, done, all);
  return unlocked ? clicked : null;
}

/**
 * 已解锁的最远**序号**（含）：`done` 里序号最大的那一关的**下一关**，与"当前这一关"取较远者。
 *
 * 空 `done` ⇒ `-1 + 1 = 0` ⇒ 只有第一关可点（没玩过的人面前只有第一关 —— 不放开任何跳课）。
 * ⚠️ 与 `chipJumpTarget` 共用一处：`chipA11y()` 也读它，屏上那两处（`disabled` 与 title）
 * 因此不可能各判各的。
 */
function chipFrontier(current: string, done: readonly string[], all: readonly string[]): number {
  let frontier = all.indexOf(current);
  for (const id of done) frontier = Math.max(frontier, all.indexOf(id) + 1);
  return frontier;
}

/** 一枚 chip 的可点状态与无障碍标注（`aria-*` 的取值只有这一处出） */
export interface ChipA11y {
  /** 可点吗（不可点的那些画成 `disabled` 按钮 + `.tutorial-chip-locked`） */
  readonly enabled: boolean;
  /** 当前这一关（`aria-current`，与 `onboarding.ts:417` 同款写法） */
  readonly current: boolean;
  /** 已经过过的关卡（屏上也读得出来：`.on` + 这句 `aria-label`） */
  readonly done: boolean;
}

/**
 * 一枚 chip 的可点状态与无障碍标注（**纯函数**：逐关过一遍就是"解锁口径"的机检形态）。
 *
 * ⚠️ `enabled` 直接复用 `chipJumpTarget()` 的结论 —— 只有一处口径，屏上不会出现
 * "能点但画成灰的 / 画成可点但点不动"这种两份真相。
 */
export function chipA11y(clicked: string, current: string, done: readonly string[], all: readonly string[]): ChipA11y {
  return {
    enabled: chipJumpTarget(clicked, current, done, all) !== null,
    current: clicked === current,
    done: done.includes(clicked),
  };
}
/**
   * 教学自己的 `UiCallbacks`。
   *
   * ⚠️ 这里**只实现**教学用得上的那几个；其余回调留空 —— 它们对应的是草稿/结算/重放那些
   * 教学不走的路径（教学跳过草稿，见 `setup.ts`）。
   *
   * ★ 2026-10-06（本次任务的接线段）：本函数**搬到了模块层**（原来在 `mountTutorial` 内部），
   * 依赖改成显式入参 ⇒ 从"闭包里长出来的一段"变成可以**真跑**的纯接线。
   * `tests/ui/main-draw-fx.test.ts` 用桩 DOM + 假 driver 真调它，钉住本次缺陷的两件事：
   *  ① 没有抽牌时**同步**继续 `judgeAndAdvance()`；
   *  ② 有抽牌时 `playDrawSequence(draws, () => judgeAndAdvance())`（幽灵落地后才判定/换关）。
   * 参数值就是原先闭包里那几个（`state` / `driver` / `hintBox` / `judgeAndAdvance` / `paint` /
   * `currentLevel`），语义一个字没动。
   *
   * ⚠️ **导出只为测试**（与同文件的 `placeSpotBoxes` / `chipJumpTarget` 同款：那些也是
   * "导出 + 由测试真跑"）。生产路径上唯一的调用点是 `paint()`。
   */
export function tutorialCallbacks(deps: TutorialCallbackDeps): UiCallbacks {
  const { state, driver, hintBox, judgeAndAdvance, repaint: paint, currentLevel } = deps;
    return {
      onRendered() { /* 每帧之后什么都不用做（本屏没有动画驱动） */ },
      onWinReset() { /* 教学里不会出现"胜利重置"那条路 */ },
      rerender() { paint(); },
      onDraftPick() { /* 教学跳过草稿：这条不该被调到（调到了也不动，免得改坏局面） */ },
      onDraftUnpick() { /* 同上 */ },
      onDraftBan() { /* 同上 */ },
      onAction(a) {
        const level = currentLevel();
        const key = allowedBy(level, a);
        if (key !== null) {
          // ★ 走偏：**不提交**（引擎里什么都没发生），只给一句提示
          hintBox.textContent = offTrackText(key);
          return;
        }
        if (state.phase === 'gameover') return;
        const player = state.turnPlayer;
        // ⚠️ 走 `driver.submit`（**不是**直接 `applyRecordedAction`）：它是收口后唯一能触发
        //    状态迁移的入口，`seq` 之类的记账由它自己管（手搓 ActionRecord 会漏字段）。
        let ok = false;
        try {
          if (a.kind === 'play') {
            ok = driver.submit(state, {
              player, kind: 'play',
              args: { cardUid: a.cardUid ?? '', faceUp: a.faceUp ?? true, line: (a.line ?? 0) as Line, target: a.target as PlayerId | undefined },
            }).ok;
          } else if (a.kind === 'effect-choice') {
            const top = state.pendingEffects[state.pendingEffects.length - 1];
            const chooser = top?.prompt?.chooser ?? top?.player ?? player;
            ok = driver.submit(state, {
              player: chooser, kind: 'effect-choice',
              args: { promptId: a.promptId ?? '', choice: a.choice ?? [] },
            }).ok;
          } else if (a.kind === 'compile') {
            ok = driver.submit(state, {
              player, kind: 'compile', args: { line: (a.line ?? 0) as Line },
            }).ok;
          } else if (a.kind === 'resolve-trigger') {
            /**
             * ★ 2026-10-02（P7）T11 的第三种触发（「结束」）走这里：结束阶段棋盘上会给出
             * 「结算触发」按钮（`render.ts` 按 `getLegalActions` 的 `resolve-trigger` 画），
             * 玩家点它就是`resolve-trigger` 这个 kind。
             * `cardUid` 就是那张待结算的卡（红线那边传上来的），原样转给引擎。
             */
            ok = driver.submit(state, {
              player, kind: 'resolve-trigger', args: { cardUid: a.cardUid ?? '' },
            }).ok;
          } else if (a.kind === 'advance') {
            /**
             * ★ 2026-10-02（P7）T10 的"亲自动手"就是这一步：`getLegalActions` 在
             * `check-control` 这一步只出 `advance` ⇒ 玩家点「推进」，引擎在
             * `performAdvance` 里调 `checkControl()`（`src/core/game.ts:293`）—— 与真对局同一条路。
             */
            ok = driver.submit(state, { player, kind: 'advance', args: {} }).ok;
          } else {
            // 别的动作种类（本轮的关卡不会走到）：如实拒绝，不给"看起来发生了"的假象
            hintBox.textContent = t('tutorial.off.wrong-kind');
            return;
          }
        } catch {
          // 引擎抛了（例如效果守卫不满足）：状态可能已半改，给一句如实的提示并重画回真状态
          hintBox.textContent = t('tutorial.off.rejected');
          paint();
          return;
        }
        // 引擎拒了（例如正面牌打到不匹配的线）：状态没变 ⇒ 一句如实的提示，不推进判定
        if (!ok) {
          hintBox.textContent = t('tutorial.off.rejected');
          paint();
          return;
        }
        /**
         * ★ 2026-10-06（**用户报的缺陷，本次任务的核心判据**）：效果触发的抽牌飞入动画。
         *
         * 位置是刻意的：**走偏早退（上面那两处 `return`）之后、`judgeAndAdvance()` 之前**。
         *  - 早退那些分支引擎里什么都没发生 ⇒ 累加器是空的，不必（也不该）走到这里；
         *  - 放在 `judgeAndAdvance()` 之前 ⇒ 与热座**同一个时序**（`playDrawSequence` 的
         *    完成回调里才 `afterFx()` → 重渲染）。教学里对应的是"幽灵先飞、落地后
         *    `judgeAndAdvance()` 才换关重画" —— 若反过来，幽灵会飞向已经重画好的新手牌。
         *
         * ⚠️ **没有抽牌时必须仍走原来的同步 `judgeAndAdvance()`**（不许凭空插一帧等待）：
         * 教学绝大多数关卡根本不抽牌，`drainDraws()` 恒空 ⇒ 那条路逐字不变。
         * `playDrawSequence` 对空数组也是同步 `done()`，但这里显式分开，读起来更直白。
         */
        const draws = drainDraws();
        if (draws.length === 0) {
          judgeAndAdvance();
        } else {
          playDrawSequence(draws, () => { judgeAndAdvance(); });
        }
      },
  };
}

/**
 * `tutorialCallbacks` 的依赖面（全是"原先闭包里那几个"：状态、驱动、提示区元素、
 * 判定推进口、重画口、当前关卡口）。显式传进来之后那个函数就能被测试真跑。
 */
interface TutorialCallbackDeps {
  state: GameState;
  driver: MatchDriver;
  hintBox: HTMLElement;
  judgeAndAdvance: () => void;
  repaint: () => void;
  currentLevel: () => TutLevel;
}

/**
 * 走偏提示的**取文案口**（键 → 句子）。
 *
 * ⚠️ 写成 switch（每个 `t()` 的实参都是**字面量**）而不是 `t(key)`：
 * `t()` 的实参一旦是变量就是**动态键** —— 缺键扫描器看不见它（等于漏翻的温床），
 * 而 `tests/i18n/tables.test.ts` 与 `tests/tutorial/screen.test.ts` 都有腿当场判红。
 * 本仓既有同款写法：home.ts 的 setLabel / coinFaceName / ruleTitleText。
 */
function offTrackText(key: string): string {
  switch (key) {
    case 'tutorial.off.wrong-kind': return t('tutorial.off.wrong-kind');
    case 'tutorial.off.face-down': return t('tutorial.off.face-down');
    default: return t('tutorial.off.rejected');
  }
}

/**
 * 这个动作**该不该放行**。
 *
 * 返回 `null` = 放行；返回一个 i18n 键 = 拒收并显示那句话。
 * 规则本身在 `src/tutorial/judge.ts`（纯函数，能在 node 下真跑）。
 */
function allowedBy(level: TutLevel, a: { kind: string; faceUp?: boolean }): string | null {
  if (!level.allowKinds.includes(a.kind)) return offTrackKeyFor(level, a);
  if (level.id === 'T1' && a.kind === 'play' && a.faceUp === false) return offTrackKeyFor(level, a);
  return null;
}


/**
 * 挂载教学屏。
 *
 * @param root 主容器（`#app`；棋盘画在这里）
 * @param store 本机设置（进度读写走它 —— 屏自己只经 `src/tutorial/progress.ts` 那一条口）
 * @param nav 宿主接缝（退出 / 进度落盘）
 */
export function mountTutorial(root: HTMLElement, store: LocalStore, nav: TutorialNav): TutorialHandle {
  /**
   * ★ 2026-10-02（同一次缺陷的连带修复）：**别带着首页那套内边距画棋盘**。
   *
   * 教学屏用的是真对局那一块棋盘（`renderApp`），但本屏是从首页点进来的 —— 那一刻 `#app`
   * 上还留着首页的 `screen-home`（`styles.css` 的 `#app.screen-home { padding: 0 }`）。
   * 内边距一清零，链路槽最外侧的**能量槽**（"这条线的总值"）整块跑到视口之外：实测 1584 宽
   * 时六个 `.battery` 分别在 x=−118 与 x=1611（视口是 0…1584）⇒ **一个都看不见**，
   * 于是"总值"这个热点在屏上根本没有可见目标可罩（真对局里它们是可见的：`#app` 有
   * `padding: 0 100px`，能量槽只探出去 20px）。这一行让教学棋盘与真对局棋盘同一套版面。
   */
  root.classList.remove('screen-home');
  /** 本次进入从哪一关开始（进度里那一关；「从头开始」会就地改它并重开本屏） */
  let levelId: TutLevelId = readProgress(store).current;
  /** 当前这局的引擎状态 */
  let state: GameState = buildLevelState(levelId);
  /** 上一份快照（T3 的动作差分用；每关开局与每次动作后更新） */
  let snap: TutSnap = snapshot(state);
  /** T3 到目前为止观测到的动作签名 */
  let opsSeen: TutOp[] = [];
  /** T0 点过的热点 */
  const spotsDone = new Set<TutSpot>();
  /**
   * ★ 2026-10-02（用户追加两课）：**屏上观察到的**事实（详情放大视图那一路）。
   *
   * T1（卡牌详情）与 T6（反面牌可视规则）教的是**界面行为**：引擎状态一模一样，
   * 所以判据只能看"玩家打开了什么"。观察点是 `render.ts` 造的真元素：
   *  - `.zoom-overlay` 出现一次 = 打开过一次详情；
   *  - 里面有 `.zoom-peek-btn` = 这张反面牌**能看**（`render.ts:418` 的 peek 实参为真）；
   *  - 里面没有那个按钮、且大图是卡背（`Cardback`）= 这张反面牌**不能看**。
   */
  let uiSeen: TutUiSeen = TUT_UI_NONE;

  /** 观察到一次"详情被打开"（由下面的 MutationObserver 调用） */
  function noteZoomOpened(): void {
    const btn = document.querySelector('.zoom-peek-btn');
    const img = document.querySelector('.zoom-img');
    const src = img ? String((img as HTMLImageElement).src) : '';
    const hasPeek = btn !== null;
    const showsBack = src.includes('Cardback');
    uiSeen = {
      ...uiSeen,
      detailsOpened: uiSeen.detailsOpened + 1,
      // 有「查看正面」按钮 ⇒ 这张反面牌能看（正面卡本来就没有这个按钮，所以不置）
      peekAvailable: uiSeen.peekAvailable || hasPeek,
      // 没有按钮**且**大图是卡背 ⇒ 这一次就是"不能看的反面牌"那个对照
      peekBlocked: uiSeen.peekBlocked || (!hasPeek && showsBack),
    };
    // 打开详情不算引擎动作，所以这里也要判一次（否则 T1/T6 永远不会过关）
    judgeAndAdvance();
  }

  /**
   * ★ 2026-10-02（P6 任务 A.1）：把当前挂着的 `select` 请求的**候选集合**记一笔。
   *
   * T7（默认目标规则）教的不是"状态变成了什么"，而是"引擎把哪些牌列成了候选"
   * —— 默认档只列双方场上未被覆盖的顶卡（`listCandidates`，`context.ts:64`），
   * 文本明写「被覆盖的牌」时才走 `covered: true` 那一支（`:86`）。
   * 候选集合只存在于 `PendingEffect.prompt` 上（`ChoiceRequest.candidates`），
   * 所以屏在每次动作之后扫一遍挂起的效果，把 `sourceDefId + 候选 uid` 记下来。
   *
   * ⚠️ 去重按"效果源 + 候选集合"两样一起比：同一次选择被扫到两次不会记两条，
   * 而同一个效果源在不同局面下弹出**不同**的候选集合时会各记一条（那正是要分辨的）。
   */
  function recordChoices(): void {
    const seen: TutChoiceSeen[] = [...(uiSeen.choices ?? [])];
    for (const pe of state.pendingEffects) {
      const prompt = pe.prompt;
      if (prompt === null || prompt.kind !== 'select') continue;
      const uids = prompt.candidates.map((c) => c.uid);
      const dup = seen.some((c) => c.source === pe.sourceDefId && c.uids.join(',') === uids.join(','));
      if (!dup) seen.push({ source: pe.sourceDefId, uids });
    }
    uiSeen = { ...uiSeen, choices: seen };
  }

  /**
   * ★ 2026-10-02（P6 任务 A.1）：玩家点了**不在候选里、被压暗**的那张牌。
   *
   * 红线上那一层（`render.ts:5415-5417`）给非候选卡加 `.choice-dim` 且**不绑任何点击**
   * —— 点下去什么都不会发生，所以"试着点被盖住的牌"这一下只有教学屏自己盯得住。
   * 捕获阶段挂在 `document` 上（棋盘在 `#app` 里，不在本屏的浮层里），
   * 命中就记一笔并把提示区换成那句解释。**不改红线**：只是读了一个既有类名。
   */
  function onDocClickCapture(ev: Event): void {
    const target = ev.target;
    if (!(target instanceof Element)) return;
    if (target.closest('.card.choice-dim') === null) return;
    if (uiSeen.blockedPickTried === true) return;
    uiSeen = { ...uiSeen, blockedPickTried: true };
    renderPanel();
  }
  document.addEventListener('click', onDocClickCapture, true);
  /**
   * ★ 2026-10-06：**接上抽牌飞入特效**（用户报的 "T4 打出精神1 没有抽牌特效"）。
   *
   * 订阅 `gameBus` 的 `card:drawn`（累加器在 `./main-draw-fx`，与热座**同一份实现**），
   * 动作结算完在 `onAction` 里 drain 一次并播飞入。退订在 `close()` 里
   *（`gameBus` 是全仓单例：不退订的话退出教程之后这一屏还会往累加器里塞东西）。
   */
  const offDraws = subscribeDraws();
  /**
   * 盯着 `document.body` 的新增子节点：`.zoom-overlay` 一出现就记一笔。
   *
   * ⚠️ 用 MutationObserver 而不是给卡牌绑 dblclick：放大查看有**多条入口**
   * （场上卡 `render.ts:417`、手牌 `:1979`、对手手牌 `:1990`、协议卡 `:202`、弃牌堆 `:5820`…），
   * 只盯结果（遮罩出现了）才不会漏。这也是本仓处理 body 级浮层的既有做法。
   */
  const zoomWatcher = new MutationObserver((records) => {
    for (const rec of records) {
      for (const node of Array.from(rec.addedNodes)) {
        if (node instanceof HTMLElement && node.classList.contains('zoom-overlay')) { noteZoomOpened(); return; }
      }
    }
  });
  zoomWatcher.observe(document.body, { childList: true });
  /** 讲解逐句进度（数字 = 已看过几句；到 `teachKeys.length` 就不再显示讲解块） */
  let teachAt = 0;
  /** 本关是否已判定通过（通过之后不再重复提示） */
  let cleared = false;
  /**
   * ★ 2026-10-06（统一倒计时）：过关之后那个"5 秒后进下一关"的定时器（见
   * `LEVEL_CLEAR_COUNTDOWN_MS` 与 `startLevelCountdown()`）。
   *
   * 它是**唯一**一个倒计时定时器：每跳一格都把下一格重排给自己（链式 `setTimeout`），
   * 所以"同一时刻只有一个挂着的定时器"这件事是结构性的，不靠自觉。
   * 退出教程 / 重开本关 / 点 chip 跳关 / 到点换关，四处都要清掉它并摘掉浮层（`clearCountdown()`）。
   */
  let nextLevelTimer: ReturnType<typeof setTimeout> | null = null;
  /**
   * 倒计时的**剩余毫秒**（浮层上那个数 = 它除以 `COUNTDOWN_TICK_MS`）。
   * 只被 `startLevelCountdown()` 的链与 `renderCountdown()` 读写 —— 切语言时重画浮层用的就是它。
   */
  let countdownLeft = 0;

  /* ───────────────────────── 教练浮层 ───────────────────────── */

  const overlay = el('div', 'tutorial-overlay');
  const panel = el('div', 'tutorial-panel');
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'false');

  const head = el('div', 'tutorial-head');
  const title = el('div', 'tutorial-title');
  const step = el('div', 'tutorial-step');
  head.appendChild(title);
  head.appendChild(step);
  const exitBtn = button('btn tutorial-exit', t('tutorial.exit'), () => { nav.exit(); });
  head.appendChild(exitBtn);
  panel.appendChild(head);

  const goalRow = el('div', 'tutorial-goal');
  const goalLabel = el('span', 'tutorial-goal-label');
  const goalText = el('span', 'tutorial-goal-text');
  goalRow.appendChild(goalLabel);
  goalRow.appendChild(goalText);
  panel.appendChild(goalRow);

  const teachBox = el('div', 'tutorial-teach');
  const teachLine = el('p', 'tutorial-teach-line');
  const teachNext = button('btn tutorial-next', t('tutorial.next'), () => {
    teachAt += 1;
    renderPanel();
  });
  teachBox.appendChild(teachLine);
  teachBox.appendChild(teachNext);
  panel.appendChild(teachBox);

  /**
   * ★ 2026-10-02（P6，用户 2026-10-01 追加的硬要求）：**四件套的三段**。
   *
   * 用户原话：「我希望**所有的教程中都要有我举的这种以实战场举例子并引导玩家的教学方式**」
   * ⇒ 每一关都要有 **实战例子 → 引导步骤 → 观察点**，且判据依赖玩家真的动手做过一次。
   * 三段的数据住在 `TutLevel`（`scenario` / `guidedSteps` / `observe`），这里只负责显示；
   * 缺一段的关卡由 `tests/tutorial/levels.test.ts` 的生成式腿当场判红（不是靠自觉）。
   *
   * 为什么放在讲解块**之后**、提示块**之前**：讲解是"为什么"，这三段是"现在做什么"，
   * 玩家的视线从上往下走正好落到第三段末尾的那句提示上。
   */
  const scenarioBox = el('div', 'tutorial-scenario');
  const scenarioLabel = el('div', 'tutorial-section-label');
  const scenarioText = el('p', 'tutorial-scenario-text');
  scenarioBox.appendChild(scenarioLabel);
  scenarioBox.appendChild(scenarioText);
  panel.appendChild(scenarioBox);

  const stepsBox = el('div', 'tutorial-steps');
  const stepsLabel = el('div', 'tutorial-section-label');
  const stepsList = el('ol', 'tutorial-steps-list');
  stepsBox.appendChild(stepsLabel);
  stepsBox.appendChild(stepsList);
  panel.appendChild(stepsBox);

  const observeBox = el('div', 'tutorial-observe');
  const observeLabel = el('div', 'tutorial-section-label');
  const observeText = el('p', 'tutorial-observe-text');
  observeBox.appendChild(observeLabel);
  observeBox.appendChild(observeText);
  panel.appendChild(observeBox);

  const hintBox = el('p', 'tutorial-hint');
  panel.appendChild(hintBox);

  /**
   * 「重开这一关」（★ 2026-10-02，T3 实测发现的必要性）。
   *
   * 为什么必须有它：T3 的**弃牌**那一步候选是**手牌**（引擎给的），玩家完全可能把后面
   * 还要用的教学卡弃掉 ⇒ 这一关就**做不完了**。教学屏不能改引擎（红线）⇒ 不能过滤候选，
   * 所以给一个"重开本关"的出口：点一下就把这一关的局面重建（进度不动）。
   * 同一枚按钮也兜住"走偏到死胡同"的一切形态（例如把唯一的目标牌打没了）。
   */
  const restartLevelBtn = button('btn tutorial-restart-level', t('tutorial.restart-level'), () => {
    // ★ 2026-10-06：与 chip 那一条路**共用** `restartLevel()`（用户要求"同一条路"）
    restartLevel(levelId);
  });
  panel.appendChild(restartLevelBtn);

  /**
   * 「从第一关重来」（方案 §5.2："从首页再进教学时从上次那一关继续，并给一个『从头开始』按钮"）。
   *
   * 与上面那枚的区别：这枚**清进度**（`restart(store)`：`done` 清空、当前关回 T0），
   * 上面那枚只重开**当前关**的局面（进度不动）。两枚都需要：前者是"我想重学一遍"，
   * 后者是"这一关我做进死胡同了"。
   */
  const restartAllBtn = button('btn tutorial-restart', t('tutorial.restart'), () => {
    restart(store);
    // ⚠️ 不能写死 `'T0'`：2026-10-06 起第一关是 `S0`（序章）—— 从进度里读回来才是唯一出处
    levelId = readProgress(store).current;
    openLevel();
  });
  panel.appendChild(restartAllBtn);

  const progressRow = el('div', 'tutorial-progress');
  panel.appendChild(progressRow);

  /** T0 的四个热点（挂在一个铺满棋盘的层上；只有 T0 显示） */
  const spotLayer = el('div', 'tutorial-spots');
  const spotEls = new Map<TutSpot, HTMLElement>();
  for (const spot of TUT_SPOTS) {
    const b = document.createElement('button');
    b.className = 'tutorial-spot';
    b.type = 'button';
    b.dataset.spot = spot;
    // 位置**不在这里写**：由 `placeSpotBoxes()` 按目标的实测矩形每帧摆（见本文件顶部那段说明）
    b.addEventListener('click', () => {
      spotsDone.add(spot);
      // 点过之后提示区显示**这个区域是什么**（四个区域各一句）
      hintBox.textContent = spotText(spot);
      renderPanel();
      judgeAndAdvance();
    });
    spotEls.set(spot, b);
    spotLayer.appendChild(b);
  }
  overlay.appendChild(spotLayer);
  overlay.appendChild(panel);
  document.body.appendChild(overlay);
  /**
   * ★ 2026-10-06（**用户当天要求**）：过关之后那个**屏幕中间**的倒计时浮层。
   *
   * 用户原话：「每一关完成后中间都要有5秒倒计时自动进入下一关的效果，而不是直接进入下一关」。
   *
   * 形态照本屏既有那一套（`settingsOverlayElement` / `.tutorial-overlay`）：
   * **body 级浮层** + 新类名 `.tutorial-countdown`（只落 `src/ui/styles-local.css`，
   * `styles.css` 一行不动）+ `pointer-events: none`（**不吃点击** —— 教学全程要玩家去操作棋盘）。
   * 它**单开一层**、不塞进 `.tutorial-overlay`：那一层里还有 T0 的热点层（`inset: 0`），
   * 两个绝对定位的层放一起，将来谁动一下定位就会互相牵连。
   *
   * 一开始是 `hidden`（`[hidden]` 的兜底 `display: none` 写在 CSS 里 —— 本仓栽过两次
   * "作者样式压掉 hidden"）：只有 `startLevelCountdown()` 到点前的那 5 秒里它才在屏上。
   */
  const { box: countdownBox, text: countdownText } = countdownOverlayElement();
  document.body.appendChild(countdownBox);
  /**
   * 挂进跟随注册表：`renderApp` 每帧末尾与 `main.ts` 的滚动/缩放 rAF 都会调 `syncFollowers()`
   * ⇒ 重画、滚动、改窗口尺寸之后热点都在它目标的**当前位置**上（不再"粘在屏幕上"）。
   * 注册一次即可；层被 `close()` 摘掉之后 `syncFollowers()` 自己会把它剔出注册表。
   */
  registerFollow(spotLayer, (node) => { placeSpotBoxes(node, spotEls); });
  /**
   * ★ 2026-10-02（同一处缺陷的第二个触发条件）：**版面自己变了也要重量一次**。
   *
   * 跟随管线只认"重画 / 滚动 / 缩放"，可是**图片加载**会把棋盘撑高：实测第一次进教学时，
   * 首帧量到的三行行高是 **226.67**（协议卡图还没落地），图一加载完就长到 **290**
   * ⇒ 只在那帧量过的热点会**短 210px**；而 T0 这一屏在整关期间不重画、玩家也没滚动，
   * 于是那个错就一直挂着（实测：不滚一下就一直是 680px 高，滚动一次才补成 890px）。
   *
   * `ResizeObserver` 盯 `#app` 的外框：内容尺寸一变就重新量。窗口尺寸那一路仍由
   * `main.ts` 的滚动/缩放 rAF 管（两条都留着，互不替代）。老浏览器没有这个 API 就退化成
   * 只有跟随管线那一档（进入教学前的那次加载通常已经完成，退化档也能对上）。
   */
  const spotResize = typeof ResizeObserver === 'function'
    ? new ResizeObserver(() => { placeSpotBoxes(spotLayer, spotEls); })
    : null;
  spotResize?.observe(root);
  /**
   * ★ 2026-10-02（同一处缺陷的第三个触发条件）：**整块棋盘被缩放/平移**。
   *
   * 触屏设备上 `phone-landscape.ts` 的 `t44-fit-wide` 会给 `#app` 挂
   * `transform: translate(tx,ty) scale(k)`（写成 `<html>` 上的 `--t39-k/-tx/-ty`
   * 与那个类），把棋盘整块缩到中间。**transform 不改布局盒** ⇒ `ResizeObserver` 看不见它，
   * 而这一刻既没有重画也没有滚动 —— 实测（1520×752 粗指针）：热点会停在未缩放的位置上
   * （偏差最大 444.8px），一直要到玩家滚一下才补正。
   * 所以再盯一眼 `<html>` 的 `style`/`class`：fit 一变就重新量（拖动平移也走这一路）。
   */
  const spotFitWatch = typeof MutationObserver === 'function'
    ? new MutationObserver(() => { placeSpotBoxes(spotLayer, spotEls); })
    : null;
  spotFitWatch?.observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'class'] });

  /**
   * ★★ 2026-10-06（**用户当天报的缺陷**）：「教程里的死板7……持续特效会消失，
   * 而特效并没有继续持续跟随卡牌而显示」——修法的**第二半：跟随**。
   *
   * 常驻层是 `position: fixed` 的 body 级层，坐标只在同步那一刻按实测矩形算一次
   * ⇒ 滚动/缩放必须有人重新算。这一趟原来只喂 3 代那一族（`syncGen3Persistent`），
   * 而 `render.ts` 里那一批注册表（黑烟 / 扫描线 / **寒冰 ice-1·4·6** / 金属 / 恐惧 / 战争…）
   * 的 prune 写在 `render.ts` 里，没人替本屏重定位 —— 用户的「冰1」就在那一批里。
   *
   * 修法（2026-10-06 第二轮）：**不再自己列清单**，改调 `main.ts` 导出的 `syncPersistentFx()`
   * —— 与主循环滚动那一趟**逐条同一个函数、同一个判据**（它内部每条 sync 都喂
   * `boardStateOf(state)`，本屏已经用 `setBoardState(state)` 声明过局面 ⇒ 喂的就是本屏那份）。
   *
   * 形态照本仓既有那一套（`main.ts` 的滚动/缩放 rAF）：rAF 节流 + passive + capture
   * （覆盖任意可滚动容器）。
   * ⚠️ 与主循环那一趟的**先后**：两个监听都在同一个事件里排各自的 rAF，主循环那个先排
   *    ⇒ 它先跑（现在它喂的也是本屏那份局面，与后一趟结论一致）。两侧都不清对方的层。
   */
  let viewportSyncScheduled = false;
  const onViewportMove = (): void => {
    if (viewportSyncScheduled) return;
    viewportSyncScheduled = true;
    requestAnimationFrame(() => {
      viewportSyncScheduled = false;
      syncPersistentFx(state);
    });
  };
  window.addEventListener('scroll', onViewportMove, { passive: true, capture: true });
  window.addEventListener('resize', onViewportMove, { passive: true });

  /** 热点被点之后显示哪一句（四个区域各一句） */
  function spotText(spot: TutSpot): string {
    switch (spot) {
      case 'link': return t('tutorial.spot.link');
      case 'protocol': return t('tutorial.spot.protocol');
      case 'threshold': return t('tutorial.spot.threshold');
      default: return t('tutorial.spot.control');
    }
  }

  /* ───────────────────────── 面板重画 ───────────────────────── */

  /**
   * 按当前关卡 / 语言 / 讲解进度把浮层上的每一条文案写一遍。
   *
   * ⚠️ "新增一条文案就补一行"的地方（与 `settingsOverlayElement` 的 `applyLang` 同款）：
   * 漏了哪一条，切语言之后它就停在旧语言上。
   */
  function renderPanel(): void {
    const level = currentLevel();
    title.textContent = level.title();
    step.textContent = t('tutorial.step', {
      n: String(levelIndex(level.id) + 1),
      total: String(TUT_LEVELS.length),
    });
    exitBtn.textContent = t('tutorial.exit');
    restartLevelBtn.textContent = t('tutorial.restart-level');
    restartAllBtn.textContent = t('tutorial.restart');
    goalLabel.textContent = t('tutorial.goal.label');
    goalText.textContent = level.goal();

    if (teachAt < level.teach.length) {
      teachBox.hidden = false;
      teachLine.textContent = level.teach[teachAt]();
      teachNext.textContent = teachAt === level.teach.length - 1
        ? t('tutorial.skip-teach')
        : t('tutorial.next');
    } else {
      teachBox.hidden = true;
    }

    // ★ P6 四件套的三段：例子 → 步骤 → 观察点（数据全部来自 TutLevel，这里只填字）
    scenarioLabel.textContent = t('tutorial.scenario.label');
    scenarioText.textContent = level.scenario();
    stepsLabel.textContent = t('tutorial.steps.label');
    stepsList.textContent = '';
    for (const stepText of level.guidedSteps) {
      stepsList.appendChild(el('li', 'tutorial-step-item', stepText()));
    }
    observeLabel.textContent = t('tutorial.observe.label');
    observeText.textContent = level.observe();

    // 提示区：按关卡给"下一步做什么"（T0 的四个热点 / T1 双击看卡 / T6 两个对照 / T7 两档候选 /
    // T9 两条露出途径）
    if (level.id === 'T0' && spotsDone.size === 0) {
      hintBox.textContent = t('tutorial.spot.hint');
    }
    if (level.id === 'T1') {
      /**
       * ★ 2026-10-06（用户要求，当天晚些时候又改了口径）：T1 看完卡之后**不再**留 10 秒
       * （那句 `tutorial.zoom.hold` 与 `holdUntilNext` 已随统一倒计时一起删掉）——
       * 现在过关之后跟别关一样，中间数 5 秒再走，屏上那句读数由倒计时浮层自己给。
       */
      hintBox.textContent = uiSeen.detailsOpened === 0 ? t('tutorial.zoom.hint') : t('tutorial.zoom.opened');
    }
    if (level.id === 'T6') {
      /**
       * ★ 2026-10-06（用户口径）：这一关分两步 —— **先造出未公开信息，再讲怎么看**。
       *
       * 所以提示区也分两档：
       *  1. 还没打出那张"生产未公开信息"的牌 ⇒ 只给第一步那一句（`tutorial.peek.make`）；
       *  2. 打出来了 ⇒ 才轮到两个对照那两句（`tutorial.peek.yes` / `tutorial.peek.no`）。
       *
       * ⚠️ 这两档读的是**判据用的同一份读数**（`secretFromDeckPlayed()` 读状态、`uiSeen` 读界面观察）
       * —— 不另算一遍，否则会出现"提示说做到了、判据不给过"的漂移。
       */
      const lines: string[] = [];
      if (!secretFromDeckPlayed(state)) {
        lines.push(t('tutorial.peek.make'));
      } else {
        if (!uiSeen.peekAvailable) lines.push(t('tutorial.peek.yes'));
        if (!uiSeen.peekBlocked) lines.push(t('tutorial.peek.no'));
      }
      hintBox.textContent = lines.length > 0 ? lines.join(' ') : t('tutorial.peek.done');
    }
    /**
     * ★ 2026-10-06（S0 序章）：补完那一分之后，引擎会**强制**要求编译线 3（`check-compile` 那一步）
     * —— 那句话写在这里**复用 T13 那条既有文案**（同一件事：点线 3 的编译，这一局就结束了），
     * 不为这一关新造一句（序章的九条文案是定稿，见 `.superpowers/2026-10-06-S0-序章/S0-copy.md`）。
     * 只在"引擎真的在等这一步"时显示（`state.step`）—— 开局还没打牌时不该让玩家去找编译按钮。
     */
    if (level.id === 'S0' && state.step === 'check-compile') {
      hintBox.textContent = t('tutorial.T13.hint.compile');
    }
    if (level.id === 'T7a') {
      /**
       * ★ 2026-10-06（用户口径）T7a「牌能盖牌」：两档提示，读的是**判据用的同一个函数**
       * （`ownCardCovered()`，`judge.ts`）—— 不另算一遍，免得"提示说盖上了、判据不给过"。
       */
      hintBox.textContent = ownCardCovered(state) ? t('tutorial.T7a.hint.done') : t('tutorial.T7a.hint.go');
    }
    if (level.id === 'T7') {
      /**
       * 三档提示，按"玩家已经做到哪一步"给（三档文案各不相同）：
       *  1. 还没试过点那张被压住的 ⇒ 先按引导步骤去点（`tutorial.T7.hint.try`）；
       *  2. 点过了、而这次选择**还没结束** ⇒ 给出那句**走偏解释**（`tutorial.choice.blocked`：
       *     为什么它不在候选里）。这一档正是任务书要的"尝试选被盖住的牌 ⇒ 不在候选里 ⇒ 走偏提示"；
       *  3. 这次选择结束了 ⇒ 换成"现在用明写「被覆盖」的那张"（`tutorial.T7.hint.pick`）。
       */
      const choosing = state.pendingEffects.some((pe) => pe.sourceDefId === 'spirit-2' && pe.prompt !== null);
      hintBox.textContent = uiSeen.blockedPickTried !== true
        ? t('tutorial.T7.hint.try')
        : choosing ? t('tutorial.choice.blocked') : t('tutorial.T7.hint.pick');
    }
    if (level.id === 'T9') {
      // 两条露出途径各有一条读数（`revealSeen()` 读的是日志差分，与判据同一个来源）
      const seen = revealSeen(state);
      hintBox.textContent = seen.flipped && seen.revealed
        ? t('tutorial.T9.hint.both')
        : seen.flipped ? t('tutorial.T9.hint.reveal') : t('tutorial.T9.hint.flip');
    }
    /**
     * ★ 2026-10-02（P7）后四关的提示：按"这一关观测量到了没有"给一句"下一步干什么"。
     *
     * 每一档都读**判据用的同一份读数**（`triggersSeen` / `getLineValue` / 纯状态），
     * 不另算一遍 —— 「提示说做到了、判据不给过」那种漂移就是第二份真相当场的样子。
     */
    if (level.id === 'T10') {
      hintBox.textContent = state.control === 0 ? t('tutorial.T10.hint.got') : t('tutorial.T10.hint.go');
    }
    if (level.id === 'T11') {
      // 三档读数与判据**同一份来源**：被盖前 / 结束 读日志（`triggersSeen`），
      // "打出后"读状态（对手那张 `t11o2` 进了对手弃牌堆 —— 为什么它不能读日志见 judge.ts）
      const seen = triggersSeen(state.log);
      const lines: string[] = [];
      if (!state.players[1].trash.some((c) => c.uid === 't11o2')) lines.push(t('tutorial.T11.hint.after-play'));
      if (seen['before-covered'] < 1) lines.push(t('tutorial.T11.hint.before-covered'));
      if (seen.end < 1) lines.push(t('tutorial.T11.hint.end'));
      hintBox.textContent = lines.length > 0 ? lines.join(' ') : t('tutorial.T11.hint.done');
    }
    if (level.id === 'T12') {
      const lines: string[] = [];
      if (!state.players[1].trash.some((c) => c.uid === 't12o1')) lines.push(t('tutorial.T12.hint.delete'));
      if (getLineValue(state, 0, 1) === 0) lines.push(t('tutorial.T12.hint.buff'));
      const imm = findCard(state, 't12f-rigid');
      if (imm === undefined || imm.faceUp !== true) lines.push(t('tutorial.T12.hint.immune'));
      hintBox.textContent = lines.length > 0 ? lines.join(' ') : t('tutorial.T12.hint.done');
    }
    if (level.id === 'T13') {
      hintBox.textContent = state.winner !== null ? t('tutorial.T13.hint.done') : t('tutorial.T13.hint.compile');
    }
    /**
     * ★ 2026-10-06（统一倒计时）：过关之后提示区就一句"这一关过了"——
     * "还有几秒进下一关"那个读数在中间那层浮层上（`renderCountdown()`），不在这里重复一遍。
     */
    if (cleared) hintBox.textContent = t('tutorial.cleared');

    // 进度：每一关各一枚 chip，已完成的加 `.on`（关卡数由 TUT_LEVELS 决定，屏上不写死）
    progressRow.textContent = '';
    const progress = readProgress(store);
    for (const l of TUT_LEVELS) {
      /**
       * ★ 2026-10-06：chip 上写的是**1 起的序号**，不再是关卡 id。
       *
       * 为什么改：id 是内部标识（`S0`/`T0`/…/`T13`），2026-10-06 在最前面插了一关 `S0`
       * 之后，照旧写 id 就会在屏上排出「S0 T0 T1 …」这种混排。id 仍留在 `dataset.level`
       * 上（既有探针与测试读的就是它）。抬头那句「第 N 关 / 共 M 关」本来按序号算，
       * 不受影响（`levelIndex()` 是唯一的序号出处）。
       *
       * ★ 2026-10-06（用户要求「点击已解锁关卡下方的小数字能够跳到对应的关卡并重新游玩该关卡」）：
       * chip 从 `<span>` 改成 `<button>` —— 解锁的那些真的能点，点了就**重开那一关**
       * （`restartLevel`，与面板上的「重开这一关」同一条路：换 `levelId` + 清本关判定状态）。
       * 解锁口径与"不碰进度"的保证都写在 `chipJumpTarget()` 上（那里是唯一出处）。
       * 没解锁的用 `disabled`（`<button>` 天然带键盘可达性与禁用语义）+ `.tutorial-chip-locked` 压暗。
       */
      const to = chipJumpTarget(l.id, level.id, progress.done, TUT_LEVELS.map((x) => x.id));
      const a11y = chipA11y(l.id, level.id, progress.done, TUT_LEVELS.map((x) => x.id));
      const chip = button('tutorial-chip', String(levelIndex(l.id) + 1), () => { restartLevel(l.id); });
      chip.dataset.level = l.id;
      if (a11y.done) chip.classList.add('on');
      if (a11y.current) chip.classList.add('now');
      if (!a11y.enabled) {
        chip.disabled = true;
        chip.classList.add('tutorial-chip-locked');
      }
      /**
       * 无障碍：当前这一关与"已经过过"各标一处（`aria-current` 的取值照本仓既有写法
       * `onboarding.ts:417` 用 `'true'`）。可点的那些给一句会说清"点了干什么"的名字。
       */
      if (a11y.current) chip.setAttribute('aria-current', 'true');
      if (a11y.done) chip.setAttribute('aria-label', t('tutorial.chip.title.done', { n: String(levelIndex(l.id) + 1) }));
      if (to !== null) chip.title = t('tutorial.chip.title.replay', { n: String(levelIndex(l.id) + 1) });
      progressRow.appendChild(chip);
    }
    /**
     * ★ 2026-10-06（用户要求「点击已解锁关卡下方的小数字…」）：过关之后给一句说明
     * —— 那一排数字从"只能看"变成了"可以点"，不告诉玩家的话没人会去点它。
     * ⚠️ 只在**过完这一关**时显示（没过完就没有"点回去重玩"这回事）。
     */
    if (cleared) hintBox.textContent = t('tutorial.chip.hint');

    // T0 热点：点过的标成已看
    spotLayer.hidden = level.id !== 'T0';
    for (const [spot, node] of spotEls) {
      node.classList.toggle('on', spotsDone.has(spot));
      // 无障碍名字 = 那个区域的说明（四个区域各一句，不给空标签）
      node.setAttribute('aria-label', spotText(spot));
    }
    panel.setAttribute('aria-label', t('tutorial.aria'));
  }

  function currentLevel(): TutLevel {
    return levelById(levelId);
  }

  /* ───────────────────────── 引擎接线 ───────────────────────── */

  /** 本屏的动作驱动（与热座同一个 `LocalDriver`：`submit` 是全仓唯一的"操作 → 引擎"入口） */
  const driver: MatchDriver = createLocalDriver();

  /**
   * 本屏的 `UiCallbacks`（接线口）。
   *
   * ⚠️ **实现本体在模块层的 `tutorialCallbacks`**（上面那个导出的函数）：它原先就长在这里，
   * 2026-10-06 把它的六个依赖提成显式入参搬到了模块层，为的是让 `tests/ui/main-draw-fx.test.ts`
   * 能真跑它（钉住本次缺陷的接线：抽牌动画的 `done` 回调接 `judgeAndAdvance`、无抽牌时同步继续）。
   * 这里只剩"把闭包里那六个值喂进去"这一句，语义与原先逐字相同。
   */
  function makeTutorialCallbacks(): UiCallbacks {
    return tutorialCallbacks({
      state, driver, hintBox, judgeAndAdvance, repaint: paint, currentLevel,
    });
  }

  /* ───────────────────────── 判定与推进 ───────────────────────── */

  /** 画棋盘（唯一出口：`renderApp` + 本屏的 `cb`） */
  function paint(): void {
    renderApp(root, state, makeTutorialCallbacks());
    // ★ 每次重画都要重做（`renderApp` 每次都重建节点）：把不该露的「下一步」藏掉
    hideNextButton();
  }

  /**
   * ★ 2026-10-06（**用户当天报的缺陷**）：**「下一步」那颗按钮不该露给玩家**。
   *
   * 判据与做法写在导出的 `applyNextButtonVisibility()` 上（那里有用户原话与根因）；
   * 这里只负责"拿本关的白名单调它"。⚠️ 每次 `paint()` 都要重做（`renderApp` 每次都重建节点）。
   */
  function hideNextButton(): void {
    applyNextButtonVisibility(root, currentLevel().allowKinds.includes('advance'));
  }

  /**
   * 每次动作/点击之后：算一次"过了没有"，过了就记进度并进下一关。
   *
   * ⚠️ 顺序是刻意的：**先判、再落进度、最后才进下一关** —— 落进度失败（写盘被拒）
   * 也要让玩家看得见"这一关过了"，只是下次进来可能还在这一关（如实的降级）。
   *
   * ★ **2026-10-02（P2 实测发现）：引擎会在一次动作之后把回合交给对手**，
   * 而 T3 要玩家**连着做五个动作**。所以在判定之前先"把回合交还玩家"：
   * `turnPlayer = 0` + `step = 'action'` + 清 `compiledThisTurn`。
   * 这是**教学自己的沙盒规则**（不是改引擎：改的是本屏自己那份受控 `state`，
   * 它从头到尾都不属于任何真对局）。代价如实登记在方案 §7.8：
   * 教学里**没有回合交替**，所以 T3 不教"回合是什么"（那是 T9 迷你对局的事）。
   */
  function handBackTurn(): void {
    if (state.phase !== 'turn') return;
    /**
     * ★ 2026-10-06（S0「序章」）：**打完那张补分的牌之后，把步交回「检查编译」**。
     *
     * 引擎的真实次序（`STEP_ORDER`，`src/core/engine/turn.ts:4`）是
     * `start → check-control → check-compile → action → check-cache → end` —— 编译判定在
     * **自己回合的开头**，而"把一条链路打到 10 分"发生在 `action` 步：`play` 之后引擎
     * 只推进到 `check-cache`（`src/core/game.ts:162`）。真对局里这两步隔着一整轮，
     * 而 S0 要连着演示"补分 ⇒ 必须编译 ⇒ 赢" ⇒ 这里把 `step` 摆回 `check-compile`
     * （压缩的**只是时序**：编译仍然是引擎自己的 `executeCompile`，见 `TutLevel.toCompileStepAfterPlay`）。
     *
     * 打偏了（那张牌没进第 3 条链路）⇒ 这一步没有可编译的线，`getLegalActions` 只会给
     * 一颗「下一步」——它在教学里被藏掉了（见 `hideNextButton`），玩家点面板上的
     * 「重开这一关」即可（与 T3 那条死胡同同一个出口）。
     */
    if (currentLevel().toCompileStepAfterPlay === true) {
      // ⚠️ 判断里**只认关卡声明**、不认 `state.step`：`judgeAndAdvance()` 不只由动作触发，
      //    双击放大卡牌（`noteZoomOpened`）也会走它 —— 若这里把"非 check-cache"的情况让给下面
      //    那条无条件规则，玩家在补完分之后再双击看一眼卡，`step` 就会被抹回 `action`，
      //    编译按钮当场消失（而这一关的手牌已经打完，只剩一条死路）。所以这一支**一步都不动**。
      if (state.step === 'check-cache') state.step = 'check-compile';
      return;
    }
    /**
     * ★ 2026-10-02（P7）：**T10 例外**（`level.keepStep`）。
     *
     * 控制权只在 `check-control` 这一步判定（`src/core/game.ts:293` 的 `performAdvance`），
     * 而 T10 的开局就摆在那一步 ⇒ 若还是按下面那条沙盒规则"强制回到 action"，
     * 那一次 `advance` 会被就地抹掉、`checkControl()` 永远跑不到 —— 这一关就死在这一步上了。
     * 所以 T10 声明 `keepStep: true`：**让引擎自己的步真的走一格**（与真对局同一条路）。
     */
    if (currentLevel().keepStep === true) return;
    /**
     * ★ 2026-10-06（**本轮实测抓到的缺陷**）：这条沙盒规则必须**无条件**执行，
     * 不能只在"回合易主"时执行。
     *
     * 原实现是 `if (state.turnPlayer !== 0) { turnPlayer = 0; step = 'action'; }` —— 而引擎在
     * 一次 `play` 之后**只推进到 `check-cache` 且回合没换人**（`src/core/game.ts:162` 的
     * `advanceStep`，实测读数：T3 打完第一张 ⇒ `step=check-cache turn=0 legal=[advance]`）。
     * 于是"没有换人"那一支**根本不会执行**，而 render.ts 的落点判定写死了
     * `if (s.step !== 'action') return`（`playToLine`；拖拽那边同一句 `s.step === 'action'`）
     * ⇒ **凡是要连着做两个动作的关卡，玩家做完第一个就再也出不了第二张牌**
     * （实测：T3 只打得出 1 张、T4 只打得出 1 张、T7 打完精神2 就停了、T9/T12 同理）。
     * 这与他打算教的东西直接矛盾（T4 明写"五个动作各做一次"），而 `keepStep` 那两个例外
     * （T10/T11）不受影响 —— 它们本来就要让引擎的步真的走。
     * ⇒ 去掉那个 guard：**每次动作之后都把沙盒交还玩家 0 的 `action` 步**（与这段注释的
     * 原意一致，见下面 `judgeAndAdvance` 的说明）。
     */
    if (state.turnPlayer !== 0) state.compiledThisTurn = false;
    state.turnPlayer = 0;
    state.step = 'action';
  }

  function judgeAndAdvance(): void {
    handBackTurn();
    const level = currentLevel();
    // T3：把这次动作引起的状态变化折进 `opsSeen`（差分只看"真的变了什么"）
    const next = snapshot(state);
    if (level.ops !== undefined) {
      for (const op of observedOps(snap, next)) if (!opsSeen.includes(op)) opsSeen.push(op);
    }
    snap = next;
    // ★ P6：把当前挂着的选择请求的候选集合记一笔（T7 的判据要它）
    recordChoices();

    const done = isLevelComplete(level, state, { spotsDone: [...spotsDone], opsSeen, ui: uiSeen });
    if (!done) { renderPanel(); paint(); return; }

    cleared = true;
    // T0 用自己那句（四个区域都看过了），其余关卡用通用那句
    hintBox.textContent = level.id === 'T0' ? t('tutorial.spot.done') : t('tutorial.cleared');
    const after = advance(store, level.id);
    nav.saveProgress(after);
    renderPanel();
    paint();
    /**
     * ★ 2026-10-06（**用户当天要求**）：最后一关（T13）**没有下一关** ⇒ 不倒计时、不自动跳，
     * 保持原来那句"所有关卡都过了"的收尾。
     */
    if (levelIndex(level.id) >= TUT_LEVELS.length - 1) {
      hintBox.textContent = t('tutorial.cleared-all');
      return;
    }
    /**
     * ★ 2026-10-06（**用户当天要求**）：其余**每一关**都走同一套 —— 屏幕中间数 5 秒 ⇒ 换关。
     *
     * 用户原话：「每一关完成后中间都要有5秒倒计时自动进入下一关的效果，而不是直接进入下一关，
     * 第三关的10秒等待改为5秒」。
     *
     * 原来这里分三支（S0 停 2.2 秒看胜利横幅 / T1 停 10 秒读卡 / 其余同步换关），现在合成一处：
     *  - S0 那次 `paint()` 挂出来的胜利横幅**仍然**要收（`gotoNextLevel()` 里的 `dismissWinBanner()`），
     *    倒计时这 5 秒也正好让玩家看清"赢"；
     *  - T1 那 10 秒取消（`T1_READ_HOLD_MS` 与 `tutorial.zoom.hold` 已删），玩家读卡的工夫由倒计时给。
     *
     * ⚠️ "只排一个定时器"的 guard 在 `startLevelCountdown()` 里（那里是唯一出处）——
     * `judgeAndAdvance()` 会被**重复**调用，没有它就会连跳两关。
     */
    startLevelCountdown();
  }

  /**
   * ★ 2026-10-06（**用户当天要求**）：过关之后那 5 秒倒计时（浮层 + 定时器）。
   *
   * 形态：屏幕中间那个 `.tutorial-countdown` 浮层上先出现 `LEVEL_CLEAR_COUNTDOWN_MS / 1000` = 5，
   * 每秒减一，到点（一共 5 秒）由 `gotoNextLevel()` 摘掉浮层并换关。
   *
   * ⚠️ **只许有一个定时器**：重复进判定（这 5 秒里玩家再双击一张卡 / 再动一下棋盘都会走
   * `judgeAndAdvance()`）时直接返回 —— 否则两条链都会到点，第二次 `gotoNextLevel()` 会再跳一关。
   * 定时器是**链式**的（每跳一格把下一格重排给自己），所以"同一时刻只有一个挂着的"是结构性的。
   */
  function startLevelCountdown(): void {
    if (nextLevelTimer !== null) return;
    countdownLeft = LEVEL_CLEAR_COUNTDOWN_MS;
    countdownBox.hidden = false;
    renderCountdown();
    const step = (): void => {
      countdownLeft -= COUNTDOWN_TICK_MS;
      // 到点：换关那一支自己会清定时器 + 摘浮层（`clearCountdown()`）
      if (countdownLeft <= 0) { gotoNextLevel(); return; }
      renderCountdown();
      nextLevelTimer = setTimeout(step, COUNTDOWN_TICK_MS);
    };
    nextLevelTimer = setTimeout(step, COUNTDOWN_TICK_MS);
  }

  /**
   * 把浮层上的数字刷成当前剩余秒数。文案走 i18n 新键 `tutorial.countdown`（中英各一条，
   * 占位符 `{n}` 两端一致）—— 切语言时重画浮层也走这里（见 `onLangChange` 那一支）。
   */
  function renderCountdown(): void {
    countdownText.textContent = countdownLabel(countdownLeft);
  }

  /**
   * 清掉倒计时：**作废定时器 + 把浮层摘掉**（`hidden` ⇒ CSS 里的 `display: none`）。
   *
   * 四个入口都走它：退出教程（`close()`）/ 重开本关（`openLevel()`，chip 跳关与「重开这一关」
   * 都经它）/ 到点换关（`gotoNextLevel()`）。少一处就会留残影或让后台的定时器把关卡切走。
   */
  function clearCountdown(): void {
    if (nextLevelTimer !== null) { clearTimeout(nextLevelTimer); nextLevelTimer = null; }
    countdownBox.hidden = true;
  }

  /** 换到下一关（倒计时到点那一下的唯一出口） */
  function gotoNextLevel(): void {
    clearCountdown();
    dismissWinBanner();
    levelId = levelAt(levelIndex(levelId) + 1);
    openLevel();
  }

  /**
   * 收起 render.ts 在终局时挂到 body 上的**胜利横幅**。
   *
   * 为什么教学要主动收：S0 打赢之后要换到下一关（`T0`），而那条横幅（`.win-banner`，
   * `z-index: 10000`）会**留在屏上** —— 不收掉的话，下一关一开局就带着上一局的"玩家 1 获胜！"
   * （它画在顶部中央，正好压在 T0 里玩家要点的那一带：控制组件/「控制权」热点）。
   * 层序上教学浮层是 `z-index: 11000`（`.tutorial-overlay`）⇒ 按层序它**不该**吃掉那一下点击，
   * 但这条**没有真机读数**（本轮不许起浏览器）⇒ 直接收掉，把这个可能性一起排除。
   * 走它自己那颗「返回主界面」（`.win-confirm-btn`）而不是 `element.remove()`：
   * 那是 render.ts 设计的收场路径（`banner.remove()` + `onWinReset`，教学里的 `onWinReset` 是空实现）。
   * ⚠️ 只读它的类名，不改 `render.ts`。
   */
  function dismissWinBanner(): void {
    document.querySelector<HTMLElement>('.win-confirm-btn')?.click();
  }

  /** 开（或重开）当前 `levelId` 那一关：新局面 + 清判定状态 + 清上一关的常驻 FX + 重画 */
  function openLevel(): void {
    /**
     * ★ 2026-10-06（统一倒计时）：上一关那个倒计时作废（例如倒计时里玩家抢先点了
     * 「重开这一关」/点了 chip 跳关）—— 不清的话它到点会把关卡再切走，还会留一层残影。
     */
    clearCountdown();
    /**
     * ★★ 2026-10-06（**用户当天报的缺陷**）：「第十四关（= T12）不知道怎么回事突然就显示出了
     * 精神协议的已编译特效……原因是我刚刚从第 15 关重新跳到了第十四关，而这个特效似乎没被清除」。
     *
     * 根因：换关只重建了**引擎局面**（下面那句 `buildLevelState`），而 `render.ts` 里那一大批
     * **body 级常驻注册表是模块态、跨帧存活**，它们的清理口只有 `resetUiState()` 一处。
     * 之前只有 `close()`（退出教程）走过它 ⇒ 关与关之间什么都不清：
     *  - `compiledFx` 以 **defId** 为键，而"某格没编译就删同 defId 的层"只写在
     *    `renderProtocol()` 的 `else` 分支里 ⇒ 新关卡**根本没有**那个 defId 的协议格时，
     *    旧层**没有任何人去删**。实测（桩 DOM 真跑 T13→T12）：T13 我方 `spirit`/`water` 两张
     *    已编译环里，`water` 在 T12 有格子（会走 else 被删）、**`spirit` 一个格子都没有 ⇒
     *    留在屏上** —— 这正是用户截图里那一圈精神已编译特效。
     *
     * 修法：把"清 FX"这一手挪到**每一次换关/跳关/重开**的最前面（重建局面**之前**）——
     * 它就是 `close()` 与 `main.ts` 那两处整局复位用的**同一个口**，不新造第二套。
     *
     * ⚠️ 顺序是承重的：**必须排在 `paint()` 之前**，否则清掉的会是刚画出来的这一关的层。
     * ⚠️ 它**不碰**教学自己要的页级设置：`#app` 上那个 `screen-home` 摘除是**类名**上的事
     * （`resetUiState()` 不动根容器的类名）、座位 `draftSelfSeat` 它自己就写成 `null`
     * （教学没有座位概念，与 `close()` 里那句同一口径）⇒ 换关之后不需要补任何设置。
     * 本关自己的判定状态（`snap` / `opsSeen` / `spotsDone` / `uiSeen` / `teachAt` / `cleared`）
     * 不住在 render.ts 里，下面照旧逐个复位。
     */
    resetUiState();
    /**
     * ★ 2026-10-06（**同一族查漏**）：**胜利横幅也是"上一关的浮层"**。
     *
     * `resetUiState()` 会把 `winOverlayShown` 复位，但**不摘**那面 `.win-banner`
     * （`render.ts:5207` 的 `showWinOverlay` 只有它自己那颗「返回主界面」会 `banner.remove()`）
     * ⇒ S0（序章）打赢之后那 5 秒倒计时里点 chip 跳关 / 点「重开这一关」，横幅会一直压在屏上
     * （"玩家 1 获胜！"），而玩家已经在打下一关了。这里显式收一次 —— 走的就是 `gotoNextLevel()`
     * 已经用的那个口（`dismissWinBanner()`），不新造第二套。
     */
    dismissWinBanner();
    /**
     * ★ 2026-10-06（**同一族查漏**）：2代那一批**瞬态** FX（幸运骰子/烟花/蘑菇云/和平鸽/混沌漩涡…
     * 见 `fx-gen2.ts` 的 `clearGen2Fx()`）也是 body 级层，它们的清理口同样只有 `main.ts` 的
     * `resetToMainInterface` / `startReplayFile` 两处 ⇒ 换关时也没人清。教学屏的每一关都会真的
     * 过一次引擎（打出/覆盖/编译/结算触发），这些层由 `gameBus` 事件驱动（宿主订阅），
     * 在上一关里播到一半就换关的话，它会**悬在下一关上**继续播完。
     * ⚠️ 与上面 `resetUiState()` 的清扫面**不重叠**：那一份只扫 `render.ts` 自己那几个类名。
     */
    clearGen2Fx();
    state = buildLevelState(levelId);
    // ★ 2026-10-06：换的是**新的一份局面对象** ⇒ 声明口跟着换（见 `onViewportMove` 那段说明）
    setBoardState(state);
    snap = snapshot(state);
    opsSeen = [];
    spotsDone.clear();
    uiSeen = TUT_UI_NONE;
    teachAt = 0;
    cleared = false;
    // ★ 2026-10-06：本关开局把抽牌累加器清空（上一条动作若还有没 drain 的残留，
    // 不该飞进这一关）。与 `main.ts` 那两处整局复位调的是同一个 `resetDraws()`。
    resetDraws();
    hintBox.textContent = currentLevel().id === 'T0' ? t('tutorial.spot.hint') : '';
    renderPanel();
    paint();
  }

  /**
   * ★ 2026-10-06（**用户当天要求**）：「重开**指定**那一关」—— 面板上那颗「重开这一关」与
   * chip 那一条路**共用这一处**（用户要求的是"与面板上「重开这一关」同一条路"）。
   *
   * 做两件事，顺序是刻意的：
   *  1. `levelId = id`（跳关。不可点的 id 到不了这里 —— chip 那侧由 `chipJumpTarget()` 拦过）；
   *  2. `openLevel()`（新局面 + 清本关判定状态 + 重画）。
   *
   * ⚠️ **一个字都不写进度**：`done` 与 `current` 保持原样（跳回去看一遍既不把没过的标成过，
   * 也不把过过的退回去）——`advance()` / `restart()` 才是写进度的口，这里不碰它们。
   * ⚠️ 也不是"从头开始"（`restart(store)` 会清 `done`）：那是另一枚按钮的事。
   */
  function restartLevel(id: TutLevelId): void {
    levelId = id;
    openLevel();
  }

  /**
   * 切语言：**就地**重画浮层（棋盘不动 —— 它上面没有文案，卡面是图片）。
   * ★ 2026-10-06（统一倒计时）：倒计时浮层上那句"还有几秒"也是文案 ⇒ 一起重画
   * （只在它真的挂着时；没挂就不用管）。
   */
  const offLang = onLangChange(() => {
    renderPanel();
    if (!countdownBox.hidden) renderCountdown();
  });

  /* ───────────────────────── 收尾 ───────────────────────── */

  openLevel();

  return {
    close() {
      /**
       * ★ 2026-10-06（统一倒计时）：退出教程 = 那个"5 秒后进下一关"的倒计时立刻作废，
       * 浮层也从 body 上摘掉（它挂在 body 上，不摘的话退出之后还在屏上留一层）。
       */
      clearCountdown();
      countdownBox.remove();
      zoomWatcher.disconnect();
      spotResize?.disconnect();
      spotFitWatch?.disconnect();
      /**
       * ★ 2026-10-06：本屏自己挂的那两个滚动/缩放监听随屏一起摘掉（与上面两个观察者同一条纪律：
       * 退出教程之后不该还在替这一屏重定位）。`removeEventListener` 的实参必须与 add 那一侧
       * **同一个函数对象**（`onViewportMove` 是本屏闭包里那一个常量）—— 写第二个箭头函数撤不掉。
       */
      window.removeEventListener('scroll', onViewportMove, { capture: true });
      window.removeEventListener('resize', onViewportMove);
      document.removeEventListener('click', onDocClickCapture, true);
      // ★ 2026-10-06：退订抽牌事件（`gameBus` 是全仓单例；不退订 = 退出教程后这一屏还在收事件）
      offDraws();
      offLang();
      overlay.remove();
      // render.ts 的模块态与 body 级常驻层由它自己的复位口清（本屏不改 render.ts）
      resetUiState();
      setDraftSelfSeat(null);
      /**
       * ★ 2026-10-06：**撤销"这一屏的棋盘"的声明**（放在 `resetUiState()` 之后）。
       * 留着它 = 主循环（热座/远程页那一路）之后所有常驻层同步都被替换成"这一份早已下线的
       * 教学局面"（既不能建也不能删，还会按它重定位）⇒ 退出教程之后热座那些层永远不更新。
       */
      setBoardState(null);
    },
  };
}
