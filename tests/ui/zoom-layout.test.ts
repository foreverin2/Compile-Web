import { describe, it, expect } from 'vitest';
import {
  fitRotatedProtocol,
  protocolTextPanelWidth,
  zoomSideBySideWidth,
  ZOOM_GAP_PX,
} from '../../src/ui/zoom-layout';

/**
 * 协议放大查看布局（2026-09-12 修复「中文文本框被协议图片挡住」）：
 * 包装层宽高 = 旋转后视觉尺寸（视觉盒 = 布局盒）→ 图不再溢出压住右侧文本面板。
 * 这里对常见视口断言：图 + 间距 + 文本面板 能并排放进视口，且图高不超出遮罩高度上限。
 */

const VIEWPORTS: [number, number][] = [
  [1280, 720],
  [1366, 768],
  [1440, 900],
  [1600, 900],
  [1920, 1080],
  [2560, 1440],
];

/** 实际在库的协议封面尺寸：1/2代 PNG 750×1050；2代 英文扫描 1760×2400 */
const IMAGES: [string, number, number][] = [
  ['1/2代 750×1050', 750, 1050],
  ['2代 扫描 1760×2400', 1760, 2400],
];

describe('协议放大查看布局（fitRotatedProtocol）', () => {
  for (const [name, nw, nh] of IMAGES) {
    for (const [vw, vh] of VIEWPORTS) {
      it(`${name} @ ${vw}×${vh}：图与文本面板并排不重叠、且不超遮罩高度`, () => {
        const fit = fitRotatedProtocol(nw, nh, vw, vh);
        // 视觉盒 = 布局盒（旋转不溢出）：包装层宽高 = 旋转后尺寸，img 布局盒 = 转置
        expect(fit.imgW).toBeCloseTo(fit.frameH, 6);
        expect(fit.imgH).toBeCloseTo(fit.frameW, 6);
        // 旋转前后面积一致（未拉伸变形）
        expect(fit.imgW * fit.imgH).toBeCloseTo(fit.frameW * fit.frameH, 6);
        // 保持原始纵横比
        expect(fit.imgW / fit.imgH).toBeCloseTo(nw / nh, 6);
        // 图 + 间距 + 面板 并排放得下（否则文本会被图压住/换行）
        expect(zoomSideBySideWidth(fit, vw)).toBeLessThanOrEqual(vw);
        // 高度不超 .zoom-body 的 92vh 上限
        expect(fit.frameH).toBeLessThanOrEqual(vh * 0.92);
        // 图不低于可读下限
        expect(fit.frameW).toBeGreaterThan(300);
      });
    }
  }

  it('异常输入兜底（naturalWidth=0 用 750×1050）', () => {
    const fit = fitRotatedProtocol(0, 0, 1920, 1080);
    const ref = fitRotatedProtocol(750, 1050, 1920, 1080);
    expect(fit.frameW).toBeCloseTo(ref.frameW, 6);
    expect(fit.frameH).toBeCloseTo(ref.frameH, 6);
  });

  it('面板宽度公式与 CSS 一致（min(300px,30vw) 且不小于 240px）', () => {
    expect(protocolTextPanelWidth(1920)).toBe(300);
    expect(protocolTextPanelWidth(1000)).toBe(300);
    expect(protocolTextPanelWidth(700)).toBe(240); // 30vw=210 → 抬到 min-width 240
    expect(ZOOM_GAP_PX).toBe(26);
  });
});
