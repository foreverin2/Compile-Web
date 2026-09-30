import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_STEP,
  ZOOM_SUGGESTED,
  clampZoom,
  currentPageZoom,
  nextPageZoom,
  pageZoomHintText,
  resetPageZoomForTest,
} from '../../src/ui/page-zoom';

/**
 * ★ 2026-09-30（用户要求）：热座那句"建议 65% 游玩"的提示 + Ctrl+滚轮调整大小。
 * 这里钉的是**算术与口径**（纯函数），DOM 那一半由真浏览器检查覆盖。
 */
describe('画面缩放：Ctrl+滚轮（用户 2026-09-30 要求）', () => {
  it('建议值就是用户说的 65%，且落在可调范围内', () => {
    expect(ZOOM_SUGGESTED).toBe(0.65);
    expect(ZOOM_SUGGESTED).toBeGreaterThanOrEqual(ZOOM_MIN);
    expect(ZOOM_SUGGESTED).toBeLessThanOrEqual(ZOOM_MAX);
  });

  it('滚轮向下 = 变小、向上 = 变大，步长 5%', () => {
    expect(nextPageZoom(1, 100)).toBe(1 - ZOOM_STEP);
    expect(nextPageZoom(1, -100)).toBe(1 + ZOOM_STEP);
    resetPageZoomForTest();
    expect(currentPageZoom(), '测试之间要能复位（否则后面的腿互相污染）').toBe(1);
  });

  it('边界钳制：一次滚很多也只在 40%–130% 之间', () => {
    expect(nextPageZoom(ZOOM_MIN, 500)).toBe(ZOOM_MIN);
    expect(nextPageZoom(ZOOM_MAX, -500)).toBe(ZOOM_MAX);
    expect(clampZoom(9)).toBe(ZOOM_MAX);
    expect(clampZoom(0.01)).toBe(ZOOM_MIN);
  });

  it('两位小数：连滚 10 次不会攒出 0.6500000000000001', () => {
    let z = 1;
    for (let i = 0; i < 7; i += 1) z = nextPageZoom(z, 100); // 1 → 0.65
    expect(z).toBe(0.65);
    expect(String(z)).not.toContain('000000');
  });

  it('提示正文含"65%"与当前百分比（唯一出处，屏上直接用这一句）', () => {
    const t = pageZoomHintText(1);
    expect(t).toContain('65%');
    expect(t).toContain('Ctrl');
    expect(t).toContain('当前 100%');
    expect(pageZoomHintText(0.65)).toContain('当前 65%');
  });

  it('★ 只吃 Ctrl+滚轮：`ctrlKey` 门在 `preventDefault()` 之前（否则页面滚不动了）', () => {
    const src = readFileSync(fileURLToPath(new URL('../../src/ui/page-zoom.ts', import.meta.url)))
      .subarray(0, 4 * 1024 * 1024)
      .toString('utf8');
    const gate = src.indexOf("if (e.ctrlKey !== true) return;");
    const prevented = src.indexOf('e.preventDefault();', gate);
    expect(gate, '找不到 Ctrl 门').toBeGreaterThan(-1);
    expect(prevented, 'ctrlKey 门必须在 preventDefault 之前').toBeGreaterThan(gate);
    expect(src, 'wheel 监听必须 passive: false（否则 preventDefault 无效）').toContain('{ passive: false }');
  });
});
