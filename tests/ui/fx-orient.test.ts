import { describe, it, expect } from 'vitest';
import { orientOf, orientToCwCcw, cloneTransformOf, cloneBoxSwaps, type CardOrient } from '../../src/ui/fx-orient';

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
