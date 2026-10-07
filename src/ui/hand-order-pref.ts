/**
 * ★ 2026-10-06（用户要求）：设置里的新开关 —— **「手牌按抽牌顺序」**（默认关闭）。
 *
 * 起因是玩家反馈「手牌排序故障」：手里 1 2 3 4 5，打出 2 后触发抽一张牌，抽到的新牌
 * 出现在第 2 格（1 新 3 4 5）而不是最右边。查证结论（`.superpowers/2026-10-06-hand-order/REPORT.md`）：
 * **引擎没问题**（`hand` 数组是入手顺序：打出 `splice` 摘掉、抽牌 `push` 追加到末尾），
 * 是**显示层**把一份副本按卡面分值升序排过（`render.ts` 的 `renderHand`，2026-08-28 改进轮 6
 * 加的"手牌按数值升序显示"）⇒ 新牌按它的分值插进了中间。
 *
 * 用户裁决（原话）：「在设置中添加上一个开关，默认关闭，打开后，抽到的牌就不会自动按照顺序
 * 进行排列了」⇒ **默认行为一个字不改**（仍按分值升序），打开后改成**入手顺序**。
 *
 * ## 为什么这不是纯粹的观感开关
 *
 * 引擎的手牌顺序**有规则含义**：`clearCache`（清缓存，手牌 >5 弃到 5 张）弃的是数组**末尾**那几张
 * （`src/core/engine/deck.ts:123-138` 的 `hand.pop()`）= **最近抽进来的**；`diversity-1` 的抽牌光效
 * 也用 `hand.slice(-count)` 认"刚抽到的牌"（`src/ui/fx-gen2.ts:1879`）。
 * 按分值排的那套显示与这个顺序不一致 ⇒ 玩家看不出清缓存会弃哪几张。打开这个开关后，
 * 画面顺序 = 引擎顺序，"最右边那几张就是会被清掉的"变成看得见的事。
 *
 * ## 边界
 *
 * 与 `play-prefs.ts` / `fx-settings.ts` **逐字同构**：这里只持有**内存态**，不碰存储
 * （读写在 `src/app/local-store.ts` 的 `readHandDrawOrder` / `writeHandDrawOrder`，界面在
 * `src/ui/home.ts` 的设置小窗，启动时读一次由 `src/main.ts` 接线）。
 * 判据本身是**纯函数**（`handShownCards`）⇒ 可以在 node 下真跑，不需要 DOM。
 */

/** 这一项的默认值：**关闭**（用户明确要求"默认关闭" ⇒ 保持改动前那套按分值升序） */
export const HAND_DRAW_ORDER_DEFAULT = false;

/** 内存态（生产路径只由 `setHandDrawOrder` / `applyHandDrawOrder` 写） */
let handDrawOrder = HAND_DRAW_ORDER_DEFAULT;

/** 现在开着吗（消费点：`handShownCards` 的缺省参数） */
export function isHandDrawOrderOn(): boolean {
  return handDrawOrder;
}

/** 开/关（**只改内存态**；落盘是宿主的事，与 `setInstantChoice` 同款） */
export function setHandDrawOrder(on: boolean): void {
  handDrawOrder = on;
}

/**
 * 启动时**从本机设置里读回**（由 `src/main.ts` 在 `applyInstantChoice` 旁边调一次）。
 *
 * 入参刻意收宽（`unknown`）：只认 `true`，其余（`undefined` / `null` / `42` / `'true'` / 存储坏掉）
 * 一律退默认（关闭）—— 与 `readHandDrawOrder` 的形状守卫**同一条口径**（两边都只认 `true`），
 * 免得出现"读侧说关、写侧说开"的半个状态。
 */
export function applyHandDrawOrder(stored: unknown): void {
  handDrawOrder = stored === true ? true : HAND_DRAW_ORDER_DEFAULT;
}

/** 测试用：复位成默认（生产路径不会用到） */
export function resetHandDrawOrderForTest(): void {
  handDrawOrder = HAND_DRAW_ORDER_DEFAULT;
}

/** 卡面分值（`'fire-3'` → 3）。与 `render.ts` 原来那段内联排序用的是同一套算法。 */
const valueOf = (defId: string): number => parseInt(defId.slice(defId.indexOf('-') + 1), 10);

/**
 * **手牌画哪几张、按什么顺序画**（唯一的判据，热座页与远程页共用同一个 `renderHand`）。
 *
 * - `on === false`（默认）：按卡面分值**升序**（改动前那套，逐字不变）；
 * - `on === true`：按**入手顺序**（= 引擎 `hand` 数组顺序），新抽到的牌在最右；
 * - `reversed`（P2 那条 `row-reverse` 的手牌容器）：两种模式下都要再翻一次，
 *   这样"视觉最左 = 最小 / 最早"在两个座位上都成立。
 *
 * ⚠️ 只决定**顺序**，不裁长度（`renderHand` 的 `.slice(0, 15)` 是另一件事，留在调用点）。
 * **纯函数**：不读 DOM、不看游戏状态；`on` 缺省读内存态（显式传参是给测试留的口子）。
 */
export function handShownCards<T extends { readonly defId: string }>(
  cards: readonly T[],
  reversed: boolean,
  on: boolean = handDrawOrder,
): T[] {
  const base = on
    ? [...cards]
    : [...cards].sort((a, b) => valueOf(a.defId) - valueOf(b.defId));
  return reversed ? base.reverse() : base;
}
