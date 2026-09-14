import { describe, it, expect } from 'vitest';
import { orientOf, orientToCwCcw, cloneTransformOf, cloneBoxSwaps, type CardOrient } from '../../src/ui/fx-orient';
import { cloneBoxFrom } from '../../src/ui/fx/clone-orient';

/** 最小桩：只需 classList.contains —— 避免引入 jsdom */
const node = (...cls: string[]) => ({ classList: { contains: (c: string) => cls.includes(c) } }) as unknown as Element;

describe('FX 朝向单一出处（G2）', () => {
  it('从类名读出四种朝向', () => {
    expect(orientOf(node())).toBe(0);
    expect(orientOf(node('rot-cw'))).toBe(90);
    expect(orientOf(node('rot-ccw'))).toBe(-90);
    expect(orientOf(node('rot-180'))).toBe(180);
  });

  it('同时带多个类时按优先级判定，且 180 优先于 90', () => {
    expect(orientOf(node('card', 'rot-180', 'rot-cw'))).toBe(180);
  });

  it('空节点/缺 classList 安全退化为 0', () => {
    expect(orientOf(null)).toBe(0);
    expect(orientOf(undefined)).toBe(0);
    expect(orientOf({} as unknown as Element)).toBe(0);
  });

  it('orientToCwCcw 与旧约定等价（热座页行为不变）', () => {
    expect(orientToCwCcw(0)).toEqual({ cw: false, ccw: false, flip180: false });
    expect(orientToCwCcw(90)).toEqual({ cw: true, ccw: false, flip180: false });
    expect(orientToCwCcw(-90)).toEqual({ cw: false, ccw: true, flip180: false });
    expect(orientToCwCcw(180)).toEqual({ cw: false, ccw: false, flip180: true });
  });

  it('±90 交换布局盒宽高，0/180 不交换', () => {
    for (const o of [90, -90] as CardOrient[]) expect(cloneBoxSwaps(o)).toBe(true);
    for (const o of [0, 180] as CardOrient[]) expect(cloneBoxSwaps(o)).toBe(false);
  });

  it('transform 字符串与 CSS 侧一致', () => {
    expect(cloneTransformOf(0)).toBe('');
    expect(cloneTransformOf(90)).toBe('rotate(90deg)');
    expect(cloneTransformOf(-90)).toBe('rotate(-90deg)');
    expect(cloneTransformOf(180)).toBe('rotate(180deg)');
  });
});

/**
 * `cloneBoxFrom` 的几何契约。
 *
 * 背景：浮层卡（飞行幽灵卡）沿用既有 buildFxCardAt 的约定 —— 元素用**未旋转**的尺寸建盒，
 * 再绕**中心**用 transform 旋到目标朝向。因此 `cloneBoxFrom` 的入参 srcRect 是
 * 「屏幕上看到的足迹盒」（已含旋转），它必须做逆运算、还原出未旋转的布局盒。
 *
 * 关键事实（本块的核心）：180° 的 |cos|/|sin| 与 0° 完全相同 —— 180° 是点对称
 * (x,y) → (−x,−y)，矩形仍映射为同宽同高的轴对齐矩形，只是内容倒置。
 * 所以 180° 与 0° 的**布局盒尺寸一致**，仅 transform 不同；只有 ±90° 才交换宽高。
 * 这正是 180° 不能复用 ±90° 路径的原因。
 */
describe('浮层卡朝向几何（G2）', () => {
  /**
   * 测试自述的浏览器足迹公式：w×h 的盒子绕**中心**旋转 θ 后的轴对齐包围盒尺寸
   *   W(θ) = w·|cos θ| + h·|sin θ|
   *   H(θ) = w·|sin θ| + h·|cos θ|
   * 四个朝向都是四分之一转的整数倍，故把 cos/sin 归整到精确的 0/1 —— 否则 IEEE754 的
   * `sin(90°) = 0.9999999999999999` 会在**测试这一侧**引入浮点噪声（与被测代码无关）。
   */
  const footprint = (w: number, h: number, o: CardOrient) => {
    const t = (o * Math.PI) / 180;
    const c = Math.abs(Math.round(Math.cos(t)));
    const s = Math.abs(Math.round(Math.sin(t)));
    return { width: w * c + h * s, height: w * s + h * c };
  };

  const ORIENTS: CardOrient[] = [0, 90, -90, 180];
  const SWAPPING: CardOrient[] = [90, -90];
  const NON_SWAPPING: CardOrient[] = [0, 180];

  it('足迹公式本身先对：±90° 互换，0°/180° 不互换', () => {
    const w = 100;
    const h = 60;
    // ±90°：W = w·0 + h·1 = h，H = w·1 + h·0 = w —— 宽高互换
    for (const o of SWAPPING) expect(footprint(w, h, o)).toEqual({ width: h, height: w });
    // 0°/180°：|cos|=1、|sin|=0 → W = w，H = h —— 尺寸不变
    for (const o of NON_SWAPPING) expect(footprint(w, h, o)).toEqual({ width: w, height: h });
  });

  it('往返：已知布局盒 → 浏览器足迹 → cloneBoxFrom 必须还原原布局盒（四种朝向）', () => {
    const w = 100;
    const h = 60;
    for (const o of ORIENTS) {
      const layout = { w, h, transform: cloneTransformOf(o), swapped: cloneBoxSwaps(o) };
      // 1) 模拟浏览器：未旋转布局盒 + 朝向 → 屏幕足迹
      const screen = footprint(layout.w, layout.h, o);
      // 2) cloneBoxFrom 做逆运算：屏幕足迹 → 应当构建的未旋转布局盒
      const recovered = cloneBoxFrom(screen, o);
      // 3) 必须逐字段还原原始布局盒（四分之一转下足迹是精确整数，可要求严格相等）
      expect(recovered).toEqual(layout);
      // 4) 再用还原出的盒子重算足迹，必须等于最初那块屏幕足迹（闭环）
      expect(footprint(recovered.w, recovered.h, o)).toEqual(screen);
    }
  });

  it('100×60 源足迹的逐朝向显式期望（回归时会指名道姓地失败）', () => {
    const src = { width: 100, height: 60 };
    const table: Array<[CardOrient, string, number, number, boolean]> = [
      [0, '', 100, 60, false],
      [90, 'rotate(90deg)', 60, 100, true],
      [-90, 'rotate(-90deg)', 60, 100, true],
      [180, 'rotate(180deg)', 100, 60, false],
    ];
    for (const [o, transform, w, h, swapped] of table) {
      expect(cloneBoxFrom(src, o), `${o}°`).toEqual({ w, h, transform, swapped });
    }
  });

  it('决定性对比：180° 与 0° 的盒完全相同，仅 transform 不同（故 180° 不能复用 ±90° 路径）', () => {
    const src = { width: 100, height: 60 };
    const box0 = cloneBoxFrom(src, 0);
    const box180 = cloneBoxFrom(src, 180);
    const box90 = cloneBoxFrom(src, 90);

    // 尺寸与 swapped 完全一致：180° 不改变几何
    expect({ w: box180.w, h: box180.h, swapped: box180.swapped })
      .toEqual({ w: box0.w, h: box0.h, swapped: box0.swapped });
    // 唯一差异是 transform
    expect(box180.transform).toBe('rotate(180deg)');
    expect(box0.transform).toBe('');
    expect(box180).not.toEqual(box0);
    // 反证：若把 180° 当 ±90° 处理，几何会被错误地互换
    expect({ w: box180.w, h: box180.h }).not.toEqual({ w: box90.w, h: box90.h });
    expect(cloneBoxFrom(src, 180)).not.toEqual(cloneBoxFrom(src, 90));
  });
});
