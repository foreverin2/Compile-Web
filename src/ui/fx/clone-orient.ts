/**
 * 浮层卡（飞行幽灵卡）按朝向的几何（G2）。
 * 与现有 buildFxCard/buildFxCardAt 的「未旋转布局盒 + 中心旋转」约定一致：
 * 元素用**未旋转**的尺寸建盒，再用 transform 旋到目标朝向 —— 这样 ±90° 的宽高互换
 * 由浏览器负责，浮层与源卡的视觉包围盒自然一致。
 */

import { cloneBoxSwaps, cloneTransformOf, type CardOrient } from '../fx-orient';

export interface CloneBox {
  /** 布局盒宽高（未施加旋转） */
  w: number;
  h: number;
  transform: string;
  /** 盒子的宽高是否相对源卡 rect 互换（±90° 为 true） */
  swapped: boolean;
}

/** srcRect 是**屏幕上看到**的包围盒（已含旋转）；返回应当构建的未旋转布局盒。 */
export function cloneBoxFrom(srcRect: { width: number; height: number }, o: CardOrient): CloneBox {
  const swapped = cloneBoxSwaps(o);
  return {
    w: swapped ? srcRect.height : srcRect.width,
    h: swapped ? srcRect.width : srcRect.height,
    transform: cloneTransformOf(o),
    swapped,
  };
}
