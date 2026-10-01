/**
 * 背景"铺满卡片"的几何计算（纯函数，不碰 canvas、不碰 DOM）。
 *
 * 2026-10-01：移植自参考项目 COMPILER · Card Builder（作者 Albert Blanco，MIT 许可，
 * https://github.com/albrtbc/compiler）的 `src/core/geometry.js`。原文件里的
 * `cellTransform`（马赛克分割用）本项目不做，故未移植。
 */
import { CARD_W, CARD_H, LOGO_SCALE_MAX, LOGO_SCALE_MIN, SCALE_MIN, SCALE_MAX } from './config';

/** 只要"有宽高"就行 —— `HTMLImageElement` / `ImageBitmap` / `Canvas` 都满足 */
export interface Sized {
  width: number;
  height: number;
}

/**
 * 把用户给的缩放倍数夹到允许区间。**传 0 / null / undefined 时回 1**（不是回下限）：
 * 老牌组 JSON 里缺 `scale` 字段时按"不缩放"处理，而不是把图缩到 25%。
 */
export function clampScale(s: number | null | undefined): number {
  return Math.min(SCALE_MAX, Math.max(SCALE_MIN, s || 1));
}

/**
 * ★ 2026-10-01（用户要求）：**标志缩放的夹取** —— 与背景的 `clampScale()` 是**两条独立的
 * 区间**（背景 25%~1600%，标志 50%~200%），所以必须是两个函数：共用一个的话，
 * "两者互不影响"这件事在上下限上就会串味。
 *
 * 与 `clampScale()` 同一个约定：传 `0 / null / undefined / NaN` 时回 **1（= 100%）** ——
 * 老牌组 JSON 里没有 `zoom` 字段时按"不缩放"处理，而不是把它缩到 50%。
 */
export function clampLogoScale(z: number | null | undefined): number {
  const n = typeof z === 'number' && Number.isFinite(z) && z > 0 ? z : 1;
  return Math.min(LOGO_SCALE_MAX, Math.max(LOGO_SCALE_MIN, n));
}

/**
 * 基准"铺满"倍数：`scale === 1` 时图片**恰好盖住** dw×dh 的盒子。
 *
 * 取两个比值的**较大者**（cover 语义）：宽图进竖版卡时由高度比决定，于是左右会溢出被裁掉 ——
 * 这正是"背景"该有的样子（不是 contain，那会露出底色）。
 */
export function bgBaseScale(img: Sized, dw: number = CARD_W, dh: number = CARD_H): number {
  return Math.max(dw / img.width, dh / img.height);
}

/**
 * 光标锚定的缩放：以画布上 (cx, cy) 这一点为中心把倍数从 `scale` 改到 `scale * factor`，
 * 反解出新的平移量，使该点**在图上对应的位置不动**。
 *
 * 参考项目把这段写在 `app.js` 的 `zoomAtOn()` 里（内联、依赖 DOM 元素与全局图片）；
 * 这里抽成纯函数，是为了让它能被单测直接钉住 —— 滚轮缩放"锚在光标"这件事最容易写反。
 *
 * ## 推导（与参考实现等价，实测两式逐位相同）
 *
 * 设基准 cover 倍数 `base`、用户倍数 `k`，则图上的内容坐标 u 与画布坐标 cx 的关系是
 * `cx = (dw - w)/2 + offsetX + u·base·k`（w = img.width·base·k）。要求 u 不动：
 *
 * ```
 * u·base = (cx - (dw - w0)/2 - offsetX0)/k0
 * offsetX1 = cx - (dw - w1)/2 - u·base·k1
 *          = cx - (dw - w1)/2 - (cx - (dw - w0)/2 - offsetX0)·k1/k0
 * ```
 *
 * 把 `wi = img.width·base·ki` 代进去、并注意 `(dw - w1)/2 - (dw - w0)/2·k1/k0 = (1 - k1/k0)·dw/2`，
 * 化简后就是下面这一行 `offsetX - (cx - dw/2 - offsetX)·(k1/k0 - 1)`：
 * 基准倍数 `base` 与 `img.width` **全部约掉**，于是本函数不需要图片 —— 这正是它比参考
 * 实现更容易单测的原因（那边必须先把图加载出来才能算）。
 */
export function zoomAt(
  t: { scale: number; offsetX: number; offsetY: number },
  dw: number,
  dh: number,
  cx: number,
  cy: number,
  factor: number,
): { scale: number; offsetX: number; offsetY: number } {
  const before = clampScale(t.scale);
  const after = clampScale(before * factor);
  // 缩放被夹住时（已经在上下限）平移不该动 —— 否则光标锚定会让画面"漂"
  if (after === before) return { scale: before, offsetX: t.offsetX, offsetY: t.offsetY };
  const k = after / before;
  // 画布上相对卡中心的那一点；缩放前后它乘以 k 的差就是平移补偿量
  const ax = cx - dw / 2 - t.offsetX;
  const ay = cy - dh / 2 - t.offsetY;
  return { scale: after, offsetX: t.offsetX - ax * (k - 1), offsetY: t.offsetY - ay * (k - 1) };
}
