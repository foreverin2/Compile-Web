/**
 * ★★ **G6/T46：选协议那一屏上的"当前连接：直连 / 经中继 / 建立中…"**。
 *
 * ## 为什么要有这一行（成本可见性，不是装饰）
 *
 * TURN 中继只在直连打不通时用；一旦用上，**整局的每个包都穿过服务器**（玩家的带宽成本）。
 * 而在 T46 之前，界面上**完全看不出**这一局是直连还是经中继（`src/ui/net-browser.ts` 里
 * `getStats()` 一处都没有）⇒ 用户 2026-09-28 的原话就是"加一行显示『当前连接：直连 / 中继』
 * 到选择协议的页面中的合适位置，只占一点空间，不要影响到其他组件了"。
 *
 * ## 为什么住在这里（而不是 `src/main.ts` 或 `src/ui/render.ts`）
 *
 * 那一屏是**红线文件** `src/ui/render.ts` 的 `renderDraft()` 建的，不许动；而 `src/main.ts`
 * 在 node 里 import 不了（应用入口要真 `document`）⇒ 文案与产 DOM 住在**本模块**，
 * 由 `src/main.ts` 在那一帧之后补画。做法与 `src/ui/net-lobby.ts` 的 `appendNetTurnLine()`
 * （G5/T14 那一行"轮到谁"）**逐字同族**，理由相同。
 *
 * ## 为什么它一点地方都不占（用户那句"不要影响到其他组件"）
 *
 * 那一行是 `position: fixed` 的浮层、自带**行内样式**（不新增样式表：`src/ui` 的样式表全集
 * 与 `tests/ui/net-body-layer-rules.test.ts` 的层叠模型是一一对应的，多加一张表会让那条腿红，
 * 而它不在本任务的边界内），并且：
 *  - 脱离文档流 ⇒ 它**不可能**把别的组件挤下去（判据 3 的前后矩形对照就是这条的机检）；
 *  - `pointer-events: none` ⇒ 它**不可能**抢走关键控件的点击（拖拽协议卡那条路尤其重要）；
 *  - 一行、小字号、`white-space: nowrap` ⇒ 它自己不换行。
 *
 * ⚠️ **不挂 `document.body`**（本仓已有一族"body 级 fixed"的坑：`#app` 带 `transform`
 * 时它是 `position: fixed` 后代的包含块，见 `src/ui/phone-landscape.ts` 的说明）：
 * 本行挂在**渲染器自己那个 root** 上、第一帧就 `display: none`、只在 `start()` 之后才显示
 * ⇒ 每一屏由本模块自己收口（`dispose()` 挂在 `renderApp` 调用点），不跨屏残留、
 * 也不会在大厅/主页上冒出来。
 *
 * ## 数据面（三条口径，**不许**在这里另算一套）
 *
 * `update()` 每次都**重新**走一遍 `readRelayStatsOf(pc)` ⇒ `getStats()`（真值）⇒
 * `relayKindOf()`（分类）⇒ `netConnText()`（文案）。重连换了链路之后，下一次轮询就会
 * 把新那一对的 `candidateType` 读出来 ⇒ 这一行**跟着变**（判据 4）。
 */

import { readRelayStatsOf, type PeerConnectionLike, type RelayStatsKind } from './net-browser';

/** 这一行在 DOM 上的类名（唯一的产出点与读取口径；真浏览器门按它取屏上原文） */
export const NET_CONN_LINE_CLASS = 'net-conn-line';

/**
 * 三值 → 屏上那一句**字面**（唯一出处；判据 6 的字符串腿钉的就是这三个）。
 *
 * 口径（任务书 §1）：
 *  - `'direct'`：选中的候选对里两边都不是 `relay` ⇒ `当前连接：直连`；
 *  - `'relay'`：任一侧是 `relay` ⇒ `当前连接：经中继`；
 *  - `'pending'`：还没有 `succeeded` 的候选对（或 `pc` 还没建）⇒ `当前连接：建立中…`
 *    —— **拿不到就如实说"建立中"**，不许猜成"直连"。
 */
export function netConnText(kind: RelayStatsKind): string {
  if (kind === 'relay') return '当前连接：经中继';
  if (kind === 'direct') return '当前连接：直连';
  return '当前连接：建立中…';
}

/** 这一行的行内样式（**不新增样式表**；理由见文件头）。 */
const LINE_STYLE = [
  'position: fixed',
  'left: 50%',
  'bottom: 6px',
  'transform: translateX(-50%)',
  'z-index: 9000',
  'pointer-events: none',
  'white-space: nowrap',
  'font-size: 12px',
  'line-height: 1.2',
  'color: #9fd8ff',
  'background: rgba(8, 12, 22, 0.72)',
  'padding: 2px 10px',
  'border-radius: 10px',
  'display: none',
].join('; ');

/**
 * 把这一行**建出来**（挂到渲染器那个 root 上）并回一个更新器。
 *
 * ⚠️ 建出来时**先不显示**（`display: none`）：`getStats()` 是异步的，而"第一次读出来"
 * 之前不许在屏上闪一个错的形态（那一下会被读屏的人当成结论）。`update()` 拿到读数之后
 * 才 `display: inline-block`。
 *
 * `root` 每次重画都是同一个 `#app`，而 `root.textContent = ''` 会把上一帧这一行抹掉
 * ⇒ 调用方每一帧都调一次本函数即可（与 `appendNetTurnLine` 同款）。
 */
export function mountNetConnLine(root: HTMLElement, doc: Document): {
  readonly line: HTMLElement;
  setText(text: string): void;
  dispose(): void;
} {
  const line = doc.createElement('div');
  line.className = NET_CONN_LINE_CLASS;
  line.setAttribute('style', LINE_STYLE);
  // `aria-live="polite"`：它是"这一局现在怎么样"的**状态**读数，变的时候读屏该念一次
  line.setAttribute('aria-live', 'polite');
  root.appendChild(line);
  let disposed = false;
  let shown = false;
  return {
    line,
    setText(text: string): void {
      if (disposed) return;
      line.textContent = text;
      // 先只在"真的读到一个形态"时才显示（见上）。`removeProperty('display')` 让那一句回到
      // 行内样式里没有 `display` 的状态（= 按 `.net-conn-line` 的缺省显示）。
      // ⚠️ 特征探测：本仓的 DOM 桩（`tests/ui/net-dom-stub.ts`）只实现了 `setProperty`
      //    —— 桩缺某一条能力时不该让产出代码**抛**（抛在 `void refresh()` 里就是一个
      //    无人接的 rejection，测试看起来"过了"而错误在后台）。
      if (!shown) {
        shown = true;
        const style = line.style as unknown as { removeProperty?(name: string): void };
        if (typeof style.removeProperty === 'function') style.removeProperty('display');
      }
    },
    dispose(): void {
      disposed = true;
      line.remove();
    },
  };
}

/** `startNetConnLine()` 的入参（**全部注入**：计时 / 取连接 / 取 DOM，测试里一个真环境都不需要） */
export interface NetConnLineOptions {
  /** 渲染器那个 root（`#app`）。本行挂在它上面，随每一帧的重画一起被抹掉 */
  readonly root: HTMLElement;
  /** 取"承载消息的那条对端连接"的动作（真件是 `peerConnectionOf(transport)`）；拿不到就回 `null` */
  readonly peerConnection: () => PeerConnectionLike | null;
  /** `document`（缺省 `globalThis.document`；注入只服务测试） */
  readonly doc?: Document;
  /** 计时：`setInterval` 与 `clearInterval` 的形状（缺省用全局那两个；注入只服务测试） */
  readonly timer?: {
    setInterval(fn: () => void, ms: number): number;
    clearInterval(handle: number): void;
  };
  /** 轮询周期（毫秒，缺省 1000）。为什么要有它：这一行必须"**重连之后跟着变**"（判据 4），
   *  而链路换掉这件事**没有**任何回调会通知界面（`pc.onicecandidate` 那一族本仓一处都没绑）
   *  ⇒ 靠有界轮询把新那一对的 `candidateType` 读出来 */
  readonly intervalMs?: number;
  /** 每次读完之后的通知（只给真浏览器门/排查用；**不参与**屏上那一行的判定） */
  readonly onRead?: (info: { readonly text: string; readonly note: string | null }) => void;
}

/** `startNetConnLine()` 回的控制面（宿主只调 `dispose()`） */
export interface NetConnLineHandle {
  /** 立刻读一次（不显示中间态：先建节点、读完才显示） */
  refresh(): Promise<void>;
  /** 停轮询 + 把这一行从屏上摘掉（**幂等**；离开那一屏 / 换局时调） */
  dispose(): void;
}

/** 缺省的计时能力（`globalThis` 上那两个；读它们这件事本身可能抛 ⇒ 兜住） */
function defaultTimer(): NonNullable<NetConnLineOptions['timer']> {
  return {
    setInterval: (fn, ms) => globalThis.setInterval(fn, ms) as unknown as number,
    clearInterval: (h) => { globalThis.clearInterval(h as unknown as ReturnType<typeof setInterval>); },
  };
}

/**
 * ★★ **起这一行**：建节点 → 立刻读一次 → 之后每 `intervalMs` 读一次。
 *
 * 只读、无副作用（除了屏上这一个节点）：它**不碰**任何游戏状态、**不碰** `pc`
 * （只有 `getStats()` 这一个只读调用）。
 *
 * 收口纪律（三条，前两条在调用点 `src/main.ts` 的 `rerender()` 里）：
 *  1. 每一帧重画都重起一次（上一帧那个节点已经被 `root.textContent = ''` 抹掉）；
 *  2. **每一次 `rerender()` 一进来就无条件 `dispose()`**（放在所有早退分支**之前**）⇒ 大厅 /
 *     主页 / 热座 / 重放 / 打完那一屏都不留；
 *  3. **本函数自己还会兜一层**（G6/T46 评审扣项）：轮询里发现**自己那个节点已经不在文档里**
 *     （`isConnected === false`，例如别人又加了一条早退分支、或者 `root` 被整帧重画抹掉而
 *     没人收口）就**自己停掉**（清计时器），不再读 `getStats()`。
 *     ⇒ 宿主哪一天漏了一条收口路径，这一层也保证"轮询不会整局跑下去"。
 *  4. `dispose()` 是幂等的 ⇒ 重复调不会把计时器泄漏出去。
 */
export function startNetConnLine(o: NetConnLineOptions): NetConnLineHandle {
  const doc = o.doc ?? globalThis.document;
  // ⚠️ 这一句的**类型**要把 `undefined` 摘掉：`o.timer` 是可选的（`exactOptionalPropertyTypes`
  //    下"没给"就是 `undefined`），而下面每一处调用都要求它一定在
  const timer: NonNullable<NetConnLineOptions['timer']> = o.timer ?? defaultTimer();
  const mounted = mountNetConnLine(o.root, doc);
  let handle: number | null = null;
  let disposed = false;
  /**
   * ★★ **G6/T46 评审扣项的自保那一层**：这一行那个节点**还在文档里吗**。
   *
   * 为什么需要它（评审实测的缺陷形态）：草稿推完进对局相之后，`renderNetBoard()` 的
   * `root.textContent = ''` 把这一行**抹掉了**，而宿主那一条收口路径（当时写在 `rerender()` 的
   * 尾部那个 `else if`）**在那之前就早退 return 了** ⇒ 节点游离、计时器却整局在跑
   * （评审读数：进对局相后 6 秒内产品 `getStats()` 调用 +6，正好 1Hz）。
   * 宿主那一条已经修（收口挪到所有早退之前），**这一层留着**：以后谁再加一条早退分支，
   * 这里也保证"节点没了 ⇒ 轮询自己停"，不需要那个新分支记得收口。
   *
   * 三个判据按可靠度排：`isConnected`（真 DOM 有）→ `ownerDocument.contains` → 桩上退化成
   * `parentElement !== null`（本仓没有 jsdom，`tests/ui/net-dom-stub.ts` 的桩只维护父子指针）。
   */
  const stillMounted = (): boolean => {
    const node = mounted.line as unknown as {
      isConnected?: boolean;
      ownerDocument?: { contains?(n: unknown): boolean } | null;
      parentElement?: unknown;
    };
    if (typeof node.isConnected === 'boolean') return node.isConnected;
    if (typeof node.ownerDocument?.contains === 'function') {
      return node.ownerDocument.contains(mounted.line) === true;
    }
    return node.parentElement !== null && node.parentElement !== undefined;
  };
  const refresh = async (): Promise<void> => {
    if (disposed) return;
    /**
     * ⚠️ 这一句排在**读 `getStats()` 之前**：节点都没了还去读，等于白花一次统计调用
     * （评审那条判据要的正是"进对局相之后一次都不再读"）。
     */
    if (!stillMounted()) { selfDispose(); return; }
    const { read, note } = await readRelayStatsOf(o.peerConnection());
    if (disposed) return;
    const text = netConnText(read.kind);
    mounted.setText(text);
    o.onRead?.({ text, note });
  };
  /** 自己收口（清计时器，**不再**去动那个已经不在文档里的节点） */
  const selfDispose = (): void => {
    if (disposed) return;
    disposed = true;
    if (handle !== null) timer.clearInterval(handle);
    handle = null;
  };
  // 先读一次（异步）；轮询紧接着排下 —— 两次读之间互相独立，谁先回来都不影响口径
  void refresh();
  handle = timer.setInterval(() => { void refresh(); }, o.intervalMs ?? 1000);
  return {
    refresh,
    dispose(): void {
      if (disposed) return;
      selfDispose();
      mounted.dispose();
    },
  };
}
