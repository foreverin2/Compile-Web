/**
 * ★ 2026-10-06（用户要求）：设置里的新一项 —— **「选牌即确定」**（默认关闭）。
 *
 * 用户原话：「在设置中加上一个选择项，默认关闭，打开后，玩家在触发需要选择卡牌后按下确定键
 * 才能确定将效果作用于该卡时，其操作会变为无需按下确定键就能确定将效果作用于选择的卡牌，
 * 即点击即触发，但注意，这个设置只会影响到不可选择跳过或是其他效果的卡牌效果，那些具有
 * 可选的卡牌不受其影响」。
 *
 * ## 判据（唯一出处在这里，两个渲染器都读它）
 *
 * 一个选择请求"点一下就确定"当且仅当**四条同时成立**：
 *  1. **设置开着**（默认关闭）；
 *  2. 是**选卡**那一类（`kind === 'select'`）—— `select-line`（点线槽即答）与
 *     `select-action`（点动作按钮即答）本来就"点一下就确定"，不需要这个设置；
 *  3. **没有跳过**（`optional !== true`）—— 这正是用户说的"具有可选的卡牌不受其影响"：
 *     屏上有没有「跳过」按钮就是这一条的判据（`render.ts` / `render-net.ts` 都只在
 *     `prompt.optional` 时才渲染 `.choice-skip`）；
 *  4. **只选 1 张**（`max === 1`）。
 *
 * ⚠️ 第 4 条是**用户 2026-10-06 当场裁决**的范围：`hate-1`（弃3张）、`psychic-0` / `psychic-2`
 * （对手弃2张）、`time-4`（弃2张）这些"固定要选 N 张"的，以及 `fire-4` / `plague-2`
 * （"选 1 张或更多"）一律**不受影响**，仍然要按确定键。理由（裁决时给的选项）：多选没有
 * "点一下就完事"的那一刻，选满就自动提交会让玩家没法反悔。
 *
 * ## 这个模块的边界
 *
 * 与 `src/ui/fx-settings.ts` **逐字同构**：这里只持有**内存态**，不碰存储（读写在
 * `src/app/local-store.ts` 的 `readInstantChoice` / `writeInstantChoice`，界面在
 * `src/ui/home.ts` 的设置小窗，启动时读一次由 `src/main.ts` 接线）。
 * 判据本身是**纯函数**（`instantChoiceApplies`）⇒ 可以在 node 下真跑，不需要 DOM。
 */

/** 这一项的默认值：**关闭**（用户明确要求"默认关闭"） */
export const INSTANT_CHOICE_DEFAULT = false;

/** 内存态（生产路径只由 `setInstantChoice` / `applyInstantChoice` 写） */
let instantChoice = INSTANT_CHOICE_DEFAULT;

/** 现在开着吗（消费点：`instantChoiceApplies`） */
export function isInstantChoiceOn(): boolean {
  return instantChoice;
}

/** 开/关（**只改内存态**；落盘是宿主的事，与 `setFxSetting` 同款） */
export function setInstantChoice(on: boolean): void {
  instantChoice = on;
}

/**
 * 启动时**从本机设置里读回**（由 `src/main.ts` 在 `applyFxSettings` 旁边调一次）。
 *
 * 入参刻意收宽（`unknown`）：只认 `true`，其余（`undefined` / `null` / `42` / `'true'` /
 * 存储坏掉）一律退默认（关闭）—— 与 `readInstantChoice` 的形状守卫**同一条口径**
 * （两边都只认 `true`，所以不会出现"读侧说关、写侧说开"的半个状态）。
 */
export function applyInstantChoice(stored: unknown): void {
  instantChoice = stored === true ? true : INSTANT_CHOICE_DEFAULT;
}

/** 测试用：复位成默认（生产路径不会用到） */
export function resetInstantChoiceForTest(): void {
  instantChoice = INSTANT_CHOICE_DEFAULT;
}

/**
 * 这个选择请求是不是"点一下就确定"。
 *
 * `on` 缺省读内存态（生产路径）；显式传参是给测试留的口子（不必先改全局态就能把四条判据
 * 逐个翻一翻）。**纯函数**：不读 DOM、不看游戏状态。
 */
export function instantChoiceApplies(
  prompt: { readonly kind: string; readonly max: number; readonly optional?: boolean },
  on: boolean = instantChoice,
): boolean {
  return on && prompt.kind === 'select' && prompt.optional !== true && prompt.max === 1;
}
