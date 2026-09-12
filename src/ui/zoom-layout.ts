/**
 * 协议放大查看（openZoom）的尺寸计算——纯函数，便于单测。
 *
 * 背景（2026-09-12 用户反馈「中文文本框被协议图片挡住」）：
 * CSS transform 不改变布局盒。协议封面图是竖版（750×1050 等），放大查看时按 -90° 旋转
 * 横置；若直接旋转 img，其视觉盒（1050×750）会溢出布局盒（750×1050）左右各约 150px，
 * 盖住右侧的中文面板（且变换元素形成层叠上下文 → 静态文本被绘制在其下方，文字看不见）。
 *
 * 解决：给 img 套一层「旋转包装层」，包装层宽高 = 旋转后的视觉尺寸（本模块计算），
 * img 绝对居中并按「未旋转布局盒 = 视觉盒转置」设定宽高 → 布局盒 = 视觉盒，旋转不溢出。
 */

export interface RotatedFit {
  /** 旋转后视觉宽（= 原图高方向）→ 包装层宽 */
  frameW: number;
  /** 旋转后视觉高（= 原图宽方向）→ 包装层高 */
  frameH: number;
  /** img 未旋转时的布局宽（= frameH，保证旋转后正好铺满包装层） */
  imgW: number;
  /** img 未旋转时的布局高（= frameW） */
  imgH: number;
}

/** 图像与中文面板并排时的间距（与 styles.css .zoom-body 的 gap 一致） */
export const ZOOM_GAP_PX = 26;

/** 按「原图尺寸 + 视口尺寸」计算协议横向展示所需的包装层/img 布局尺寸。
 *  nw/nh 为原图自然尺寸（缺省兜底 750×1050）；vw/vh 为视口尺寸。 */
export function fitRotatedProtocol(nw: number, nh: number, vw: number, vh: number): RotatedFit {
  const w0 = nw > 0 ? nw : 750;
  const h0 = nh > 0 ? nh : 1050;
  const visW0 = h0; // 旋转 -90° 后视觉宽高互换
  const visH0 = w0;
  const availW = Math.min(vw * 0.64, 1040);
  const availH = Math.max(220, vh * 0.78);
  const k = Math.min(availW / visW0, availH / visH0);
  const frameW = visW0 * k;
  const frameH = visH0 * k;
  return { frameW, frameH, imgW: frameH, imgH: frameW };
}

/** 协议中文面板实际占宽（与 styles.css .zoom-text / .protocol-zoom-text 的
 *  width: min(300px, 30vw) + min-width: 240px 一致） */
export function protocolTextPanelWidth(vw: number): number {
  return Math.max(240, Math.min(300, vw * 0.3));
}

/** 图 + 面板并排所需的最小视口宽（图宽 + 间距 + 面板宽） */
export function zoomSideBySideWidth(fit: RotatedFit, vw: number): number {
  return fit.frameW + ZOOM_GAP_PX + protocolTextPanelWidth(vw);
}
