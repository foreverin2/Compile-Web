/**
 * ★ 2026-09-30（用户要求）：**热座给一句"建议 65% 游玩"的提示，并支持 Ctrl + 鼠标滚轮调整画面大小**。
 *
 * ## 为什么用 `zoom` 而不是 `transform: scale()`
 *
 * `transform` 会给后代里的 `position: fixed` 元素造一个**新的包含块** —— 那正是今天刚修掉的那类坑
 * （宽视口自适应把 `#app` 一 transform，钉在屏幕上的东西就跟着画面跑了）。`zoom` 是布局级的缩放，
 * 不造包含块，钉住的东西照旧相对视口。
 *
 * ## 口径
 *
 *  - 只有**按住 Ctrl** 的滚轮才被吃掉（其余滚轮照旧滚页面）；
 *  - 步长 5%，范围 40%–130%，两位小数；
 *  - **只在内存里**（不落盘）：缩放是"这一局看着舒服"的事，不值得为它往用户磁盘上写东西。
 */
export const ZOOM_MIN = 0.4;
export const ZOOM_MAX = 1.3;
export const ZOOM_STEP = 0.05;
/** 用户点名的建议值 */
export const ZOOM_SUGGESTED = 0.65;

/** 纯函数：按滚轮方向算下一个缩放（含钳制与两位小数）。`deltaY > 0` = 向下滚 = 变小。 */
export function nextPageZoom(current: number, deltaY: number): number {
  const dir = deltaY > 0 ? -1 : 1;
  return clampZoom(current + dir * ZOOM_STEP);
}

/** 钳制 + 两位小数（浮点累加会攒出 0.6500000000000001 这种值） */
export function clampZoom(z: number): number {
  const rounded = Math.round(z * 100) / 100;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, rounded));
}

/** 那行提示的正文（**唯一出处**：屏上与测试都从这里取） */
export function pageZoomHintText(current: number = currentPageZoom()): string {
  const percent = Math.round(current * 100);
  return `建议把画面调到 ${Math.round(ZOOM_SUGGESTED * 100)}% 左右游玩`
    + `（按住 Ctrl 滚鼠标滚轮可以调整大小，当前 ${percent}%）。`;
}

let zoom = 1;
let installed = false;
const listeners: Array<(z: number) => void> = [];

/** 现在的缩放（内存态） */
export function currentPageZoom(): number {
  return zoom;
}

/** 落盘到 `document.documentElement.style.zoom`，并通知订阅者（提示那行要显示当前百分比） */
export function applyPageZoom(next: number): number {
  zoom = clampZoom(next);
  document.documentElement.style.zoom = String(zoom);
  for (const fn of listeners) fn(zoom);
  return zoom;
}

/** 订阅缩放变化，返回退订函数 */
export function onPageZoomChange(fn: (z: number) => void): () => void {
  listeners.push(fn);
  return () => {
    const at = listeners.indexOf(fn);
    if (at >= 0) listeners.splice(at, 1);
  };
}

/** 装一次（幂等）。只有 Ctrl+滚轮会被吃掉，其余一律放行。 */
export function installPageZoom(): void {
  if (installed) return;
  installed = true;
  window.addEventListener('wheel', (e: WheelEvent) => {
    if (e.ctrlKey !== true) return;   // ★ 不按住 Ctrl 就不管：页面该怎么滚怎么滚
    e.preventDefault();               // 吃掉浏览器自己的"Ctrl+滚轮 = 整页缩放"
    applyPageZoom(nextPageZoom(zoom, e.deltaY));
  }, { passive: false });
}

/** 测试用：把内存态与监听器清干净（生产路径不会用到） */
export function resetPageZoomForTest(): void {
  zoom = 1;
  installed = false;
  listeners.length = 0;
}
