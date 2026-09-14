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

/** 从节点类名读朝向。180 优先于 ±90（同时带时按 180 算）。 */
export function orientOf(node: Element | null | undefined): CardOrient {
  const cl = (node as { classList?: { contains(c: string): boolean } } | null | undefined)?.classList;
  if (!cl || typeof cl.contains !== 'function') return 0;
  if (cl.contains('rot-180')) return 180;
  if (cl.contains('rot-cw')) return 90;
  if (cl.contains('rot-ccw')) return -90;
  return 0;
}

/** 与既有 buildFxCardAt(rect, cw, ccw, …) 的参数形状对齐 */
export function orientToCwCcw(o: CardOrient): { cw: boolean; ccw: boolean; flip180: boolean } {
  return { cw: o === 90, ccw: o === -90, flip180: o === 180 };
}

/** 该朝向是否交换布局盒宽高 */
export function cloneBoxSwaps(o: CardOrient): boolean {
  return o === 90 || o === -90;
}

/** 浮层卡应施加的 rotate() 值（空字符串 = 不施加） */
export function cloneTransformOf(o: CardOrient): string {
  switch (o) {
    case 90: return 'rotate(90deg)';
    case -90: return 'rotate(-90deg)';
    case 180: return 'rotate(180deg)';
    default: return '';
  }
}
