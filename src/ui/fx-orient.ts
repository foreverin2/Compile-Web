/**
 * 卡牌朝向的**单一出处**（G2）。见 docs/2026-09-13-联机与多端-设计稿.md §6。
 *
 * 热座页给场上卡加 rot-cw(+90°) / rot-ccw(−90°)：同一块屏幕前两位玩家各自看得正。
 * 远程页改为**自己正立(0°) / 对手 180° 倒置**（像隔桌对坐）—— 因此新增 180°。
 *
 * ⚠️ **G2 修正 R2 起这里有两套朝向，别混用**（设计说明 §2 的朝向表 / §3.1 的机制）：
 *  - `orientOf` = **卡面**朝向（热座 ±90°；远程页 0°/180°）；
 *  - `fxOrientOf` = **特效**朝向（远程页自己 −90°、对手 +90°，读 `data-fx-rot`；热座无标记 ⇒ 回退 `orientOf`）。
 *  远程页自己卡面 0° 而特效 −90°、对手卡面 180° 而特效 +90° —— 拿卡面朝向去建浮层卡，
 *  整类特效（刀光/光束/粒子/边框光/飓风/闪电…）都会差 90°。
 *
 * ⚠️ ±90° 会**交换布局盒宽高**，0°/180° 不会。浮层卡（飞行中的幽灵卡）的几何必须按此区分，
 * 否则出现"尺寸正确但朝向错"或"朝向对但尺寸错"的假正确。
 */

export type CardOrient = 0 | 90 | -90 | 180;

/** 全部朝向类名。清理方（如 playRiseFade 的克隆）必须三个一起摘 —— 只摘 ±90° 会漏掉 180°。 */
export const ORIENT_CLASSES = ['rot-cw', 'rot-ccw', 'rot-180'] as const;

/** 摘掉节点的全部朝向类（安全：classList/remove 缺失即静默返回）。
 *  这是 FX 模块**唯一**允许触碰朝向类名的地方 —— 源码守卫禁止 FX 模块再写字面量。 */
export function stripOrientClasses(node: Element | null | undefined): void {
  const cl = (node as { classList?: { remove(...c: string[]): void } } | null | undefined)?.classList;
  if (!cl || typeof cl.remove !== 'function') return;
  cl.remove(...ORIENT_CLASSES);
}

/** 从节点类名读朝向。180 优先于 ±90（同时带时按 180 算）。 */
export function orientOf(node: Element | null | undefined): CardOrient {
  const cl = (node as { classList?: { contains(c: string): boolean } } | null | undefined)?.classList;
  if (!cl || typeof cl.contains !== 'function') return 0;
  if (cl.contains('rot-180')) return 180;
  if (cl.contains('rot-cw')) return 90;
  if (cl.contains('rot-ccw')) return -90;
  return 0;
}

/* ============================================================================
 * 特效朝向（G2 修正 R2）：**与卡面朝向不是同一套**
 * ========================================================================== */

/**
 * 特效朝向标记的属性名（远程页场上卡；规格 §8.2 钉死的名字）。
 *
 * ⚠️ 只有 `src/ui/render-net.ts` 产出它（`renderStackSlot` 的 `fxRot` 参数 ⇒ `render.ts` 里
 * `node.dataset.fxRot = opts.fxRot`），**热座页不产出**（`opts.fxRot` 缺省 undefined ⇒ 一条属性都不写）。
 * 正是这个"热座 DOM 上没有这条属性"让 `fxOrientOf` 的**回退**成为「热座零变化」的构造性证明。
 */
export const FX_ROT_ATTR = 'data-fx-rot';

/** `data-fx-rot` 的两种取值 → 特效朝向。规格 §8.2：自己 `ccw`（−90°）、对手 `cw`（+90°）。 */
const FX_ROT_VALUES: Readonly<Record<string, CardOrient>> = { ccw: -90, cw: 90 };

/**
 * 读**特效朝向**：优先 `data-fx-rot`（`"ccw"` → −90°、`"cw"` → +90°），**读不到或值不认识时
 * 回退 `orientOf(node)`**（= 卡面朝向）。
 *
 * 为什么必须有回退（而不是"没有标记就返回 0"）：
 *  - **热座页**（`render.ts`）从不写这条属性 ⇒ 每次调用都走回退 ⇒ 拿到与改动前**逐字相同**的
 *    卡面朝向 ⇒ 浮层卡几何、翻面覆盖层、破碎/切割全部走原分支 ⇒ **热座观感零变化是构造性的**，
 *    不依赖"我记得把每处都改对"。
 *  - 值不认识时（拼错 / 将来第三种取值）同样回退 —— 返回 0 会让热座卡**直立**（远处看不出来、
 *    但整类特效错位），回退至少与改前一致。
 *
 * ⚠️ **不要**把它用在"卡面本身"的读取点上：远程页自己卡面 0° 而特效 −90°（规格 §2 的朝向表），
 * 两者相差 90°。卡面朝向继续走 `orientOf`。
 */
export function fxOrientOf(node: Element | null | undefined): CardOrient {
  const raw = (node as { getAttribute?(name: string): string | null } | null | undefined)
    ?.getAttribute?.(FX_ROT_ATTR);
  const mapped = raw == null ? undefined : FX_ROT_VALUES[raw];
  return mapped ?? orientOf(node);
}

/** 与既有 buildFxCardAt(rect, orient, …) 的参数形状对齐 */
export function orientToCwCcw(o: CardOrient): { cw: boolean; ccw: boolean; flip180: boolean } {
  return { cw: o === 90, ccw: o === -90, flip180: o === 180 };
}

/** `--fx-rot` 用的**裸角度**（`'0deg'|'90deg'|'-90deg'|'180deg'`）。
 *  ⚠️ 与 `cloneTransformOf()`（完整 transform 函数串）**不可混用**，见本文件头部约定注释。 */
export function orientToFxRot(o: CardOrient): string {
  switch (o) {
    case 90: return '90deg';
    case -90: return '-90deg';
    case 180: return '180deg';
    default: return '0deg';
  }
}

/** 该朝向是否交换布局盒宽高 */
export function cloneBoxSwaps(o: CardOrient): boolean {
  return o === 90 || o === -90;
}

/** 浮层卡应施加的 rotate() 值（空字符串 = 不施加）
 *
 * 表示约定：本输出是**完整 transform 函数串**，只用于直接赋 `style.transform`
 * （同 buildProtocolGhost，src/ui/effects/index.ts:2179）。
 * `--fx-rot` 路径要的是**裸角度**（`'90deg'`/`'180deg'`，见 src/ui/effects/index.ts:157-158）；
 * **切勿**把本输出赋给 `--fx-rot` —— 会得到 `rotate(rotate(90deg))`，计算值无效，
 * 整条内联 transform 声明被丢弃（连带组合的 `translate(...)`/`scale(...)`）。
 * `''` 两条路径都安全（移除属性/声明），故 0° 无需特判。
 */
export function cloneTransformOf(o: CardOrient): string {
  switch (o) {
    case 90: return 'rotate(90deg)';
    case -90: return 'rotate(-90deg)';
    case 180: return 'rotate(180deg)';
    default: return '';
  }
}
