/**
 * 长寿命 FX 层的「跟随」注册表（2026-09-13 用户裁决：给 2~3.6s 的卡框光/落点光加跟随）。
 *
 * 背景：项目的瞬态约定是"≤1.6s 的 body 级 fixed 层可以停在事件时刻的屏幕坐标"（用户已确认）。
 * 但有几个 2~3.6s 的层（迷雾卡框灰光 2s / 透彻落点眼 3s / 爱意牌库光芒 2s …）超过了这个窗口——
 * 玩家在这段时间里滚动棋盘，就会看到它们**脱离卡面**停在旧位置。
 *
 * 这里不做"统一重定位所有瞬态层"（那会牵动 20+ 个调用点的时序），只提供一个**极小注册表**：
 * 创建这类层时调用 `registerFollow(el, place)`，`place(el)` 在每帧（渲染 + 滚动/缩放 rAF）被调用一次，
 * 由调用方自己重算并写入位置（回调用的是它创建时就拿到的参数，不查引擎状态）。
 * 元素被 `remove()` 后自动从注册表剔除（`isConnected` 检查），无需手动注销、不会泄漏。
 *
 * 接线：`render.ts` 每帧末尾 + `main.ts` 的滚动/缩放 rAF 各调一次 `syncFollowers()`。
 */

type Placer = (el: HTMLElement) => void;

const followers: { el: HTMLElement; place: Placer }[] = [];

/** 注册一个跟随层：place(el) 每次被调用时应把 el 重新摆到它当前该在的位置 */
export function registerFollow(el: HTMLElement, place: Placer): void {
  followers.push({ el, place });
}

/** 每帧同步（渲染后 + 滚动/缩放）：已从 DOM 移除的层自动出栈 */
export function syncFollowers(): void {
  for (let i = followers.length - 1; i >= 0; i--) {
    const f = followers[i];
    if (!f.el.isConnected) {
      followers.splice(i, 1);
      continue;
    }
    f.place(f.el);
  }
}

/** 当前跟随中的层数（供守卫测试/诊断确认接线生效） */
export function followCount(): number {
  return followers.length;
}

/** 只读快照（诊断用：类名列表） */
export function followClasses(): string[] {
  return followers.map((f) => f.el.className);
}
