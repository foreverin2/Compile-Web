/* ============================================================================
 * G6/T44（用户 2026-09-27 第 ⑦ 条）：草案 → 游玩那段过渡视频的"看得见"兜底
 *
 * ## 那段过渡是什么（定位，不靠猜）
 *
 * `main.ts:4167 playDraftToGameTransition()`：草案屏淡出（`.draft-exit`）→ 450ms 后
 * 往 `document.body` 挂一个 `.loading-overlay`（`position: fixed; inset: 0;
 * background: #060a12` —— **纯深色，就是用户说的黑屏**），里面是一个
 * `<video src="/assets/ui/loading-transition.mp4" autoplay muted playsinline>` →
 * 视频 `ended` 或 **4.5s 兜底**（`main.ts:4202` 的 `safety`）之后淡出、`.board-enter` 进场。
 *
 * ## 平板上实测到哪一步（`.superpowers/g6-T44/run-t44zoom-prefix.txt`）
 *
 * CDP 平板档（1024×768、粗指针、`mobile:true`）里**它是播的**：
 * `videoPaused:false / readyState:4 / currentTime 0.35 → 1.201 → … / duration 3s /
 * videoWidth 1920`、`.loading-overlay` 的 rect 是完整 1024×768、`overlayBg: rgb(6,10,18)`、
 * rAF 5 帧 / 77ms 也正常。⇒ **无头里复现不了"黑屏"**，只能把"哪里会黑"钉清楚。
 *
 * ## 那还修什么（这一段是硬事实，不是推理）
 *
 * 这个覆盖层**没有任何 fallback 内容**：视频一旦不播（readyState 停在 0、`videoWidth` 0、
 * 解码卡住、`/assets/ui/loading-transition.mp4` 在用户那台设备上取不到、浏览器把
 * `autoplay` 拦掉），屏幕上就只剩 `#060a12` 一块**纯色**——撑满 4.5 秒，与"黑屏"逐字同义。
 * 而且用户看到的黑屏**发生在任何东西之上**：`z-index: 4000`。
 *
 * ⇒ 本模块做的事只有一件：**在覆盖层上盖一句看得见的话**（"正在进入对局……"），
 * 视频一旦真的出画（`readyState >= 2 && videoWidth > 0`）就把那句话摘掉。
 * 不改 `main.ts`（它不在这条任务的边界里）、不动视频元素本身的任何属性
 * （`src` / `autoplay` / `muted` / `play()` 一个都不碰 —— 免得把"本来能播"弄成"不能播"）。
 *
 * ## 为什么用 MutationObserver 而不是定时轮询
 *
 * 覆盖层是**临时挂载**的（`main.ts` 挂上、4.5s 后 `overlay.remove()`），没有可挂钩的
 * 导航事件；`MutationObserver` 在它出现的那一刻就能接上，且**它一被摘掉就自动停**。
 *
 * ## 为什么样式是行内写上去的，而不是一张新 CSS 文件（一条边界决定）
 *
 * 本任务的边界只允许改/新增 `src/ui/phone-landscape.ts`、`src/ui/styles-touch.css`，
 * 以及**由 `phone-landscape.ts` 自己 import 的新文件**。新加一张 `src/ui/*.css` 会撞上
 * `tests/ui/net-body-layer-rules.test.ts` 那条"`src/ui` 的样式表全集 == 收录 ∪ 排除"的腿
 * （新增表必须在那份测试里显式归类，而测试文件不在本任务的边界内）⇒ 那句话的样式
 * **写在本模块里用行内 `style` 落地**，一个字节不进任何样式表。
 * ========================================================================== */

/** 兜底那句话的类名（断言与样式各一处） */
export const T44_TRANSITION_HINT_CLASS = 't44-transition-hint';
/** 挂在 `<html>` 上的标记：本模块已经装过（重复 `init` 不重复装 observer） */
const INSTALLED_FLAG = 't44TransitionHint';

let observer: MutationObserver | null = null;

/**
 * 那句话的样式（行内）：落在视频**之上**、不挡点击。
 *
 * 一条 @media 是矮屏（手机横屏的物理高只有 390 上下）里字体收一档 —— 由
 * `matchMedia('(max-height: 520px)')` 现判，不依赖任何样式表。
 */
function styleHint(hint: HTMLElement): void {
  const short = window.matchMedia('(max-height: 520px)').matches;
  hint.style.cssText = [
    'position:absolute', 'left:50%', 'top:50%', 'transform:translate(-50%,-50%)',
    'margin:0', `padding:${short ? '7px 14px' : '10px 20px'}`, 'border-radius:10px',
    'border:1px solid rgba(79,240,255,0.45)', 'background:rgba(10,14,26,0.86)',
    'color:#d7f6ff', 'font-family:system-ui,sans-serif',
    `font-size:${short ? '13px' : '16px'}`, `letter-spacing:${short ? '1px' : '2px'}`,
    'pointer-events:none', 'z-index:5',
  ].join(';');
}

/** 给一个覆盖层补上"看得见"的那句话（幂等；视频已经出画就不补）。 */
function decorateOverlay(overlay: Element): void {
  const video = overlay.querySelector('video');
  if (video instanceof HTMLVideoElement && video.readyState >= 2 && video.videoWidth > 0) return;
  if (overlay.querySelector(`.${T44_TRANSITION_HINT_CLASS}`) !== null) return;
  const hint = document.createElement('p');
  hint.className = T44_TRANSITION_HINT_CLASS;
  styleHint(hint);
  hint.textContent = '正在进入对局……';
  overlay.appendChild(hint);
}

/** 视频出画了就把那句话摘掉（每 200ms 看一眼，最多看 10 秒；覆盖层没了就停）。 */
function watchVideo(overlay: Element, video: HTMLVideoElement | null): void {
  let ticks = 0;
  const timer = window.setInterval(() => {
    ticks += 1;
    const hint = overlay.querySelector(`.${T44_TRANSITION_HINT_CLASS}`);
    if (hint === null || !overlay.isConnected) { window.clearInterval(timer); return; }
    if (video !== null && video.readyState >= 2 && video.videoWidth > 0) {
      hint.remove();
      window.clearInterval(timer);
      return;
    }
    if (ticks > 50) { hint.remove(); window.clearInterval(timer); }
  }, 200);
}

/** 在页面里装上"过渡覆盖层看得见"这条兜底。重复调用无副作用。 */
export function initTransitionHint(): void {
  const root = document.documentElement;
  if (root.dataset[INSTALLED_FLAG] === '1') return;
  root.dataset[INSTALLED_FLAG] = '1';
  if (typeof MutationObserver !== 'function') return;
  const attach = (node: Node): void => {
    if (!(node instanceof HTMLElement) || !node.classList.contains('loading-overlay')) return;
    decorateOverlay(node);
    const video = node.querySelector('video');
    watchVideo(node, video instanceof HTMLVideoElement ? video : null);
  };
  for (const ov of Array.from(document.querySelectorAll('.loading-overlay'))) attach(ov);
  observer = new MutationObserver((records) => {
    for (const rec of records) {
      for (const node of Array.from(rec.addedNodes)) attach(node);
    }
  });
  observer.observe(document.body, { childList: true });
  /**
   * ★ 修复轮 P2：**兜底再兜一层**。
   *
   * 评审复现这条时得到过 `hint=0`：`MutationObserver` 的回调是**微任务**，所以在
   * "同一个任务里挂上覆盖层又立刻读 `.t44-transition-hint`"那种读法下，提示还没挂上去。
   * 这条 300ms 的扫描让"没有提示的覆盖层"最多 300ms 内一定被补上 —— 于是判据不再依赖
   * "你什么时候读"，任何人都能复现同一结果（口径写进报告）。
   * 只在页面上真有 `.loading-overlay` 时才有成本，且整表查询很便宜。
   */
  window.setInterval(() => {
    for (const ov of Array.from(document.querySelectorAll('.loading-overlay'))) attach(ov);
  }, 300);
}
