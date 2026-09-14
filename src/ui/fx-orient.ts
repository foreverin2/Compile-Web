/**
 * 卡牌朝向的**单一出处**（G2）。见 docs/2026-09-13-联机与多端-设计稿.md §6。
 *
 * 热座页给场上卡加 rot-cw(+90°) / rot-ccw(−90°)：同一块屏幕前两位玩家各自看得正。
 * 远程页改为**自己正立(0°) / 对手 180° 倒置**（像隔桌对坐）—— 因此新增 180°。
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
