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
  /** 完整 transform 函数串（`rotate(90deg)` 等；0° 为 `''`），只用于直接赋 `style.transform`
   *  （同 buildProtocolGhost，src/ui/effects/index.ts:2179）。
   *  `--fx-rot` 路径要的是**裸角度**（`'90deg'`/`'180deg'`，见 src/ui/effects/index.ts:157-158）；
   *  **切勿**把它赋给 `--fx-rot` —— 会得到 `rotate(rotate(...))`，计算值无效，整条内联
   *  transform 声明被丢弃（连带组合的 `translate(...)`/`scale(...)`）。
   *  `''` 两条路径都安全（移除属性/声明），故 0° 无需特判。 */
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
