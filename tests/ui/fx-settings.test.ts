import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  FX_SETTINGS,
  isMetal6StrobeOn,
  resetFxSettingsForTest,
  setMetal6Strobe,
} from '../../src/ui/fx-settings';

/**
 * ★ 2026-09-30（用户要求）：首页「设置」—— 金属6 频闪特效开关（默认开启）；
 * 并且那个特效**只在正面时**才该出现（原来反面也闪）。
 */
const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url))).subarray(0, 4 * 1024 * 1024).toString('utf8');

describe('特效设置：金属6 频闪开关', () => {
  it('★ 默认开启；能关能开（状态只在内存）', () => {
    resetFxSettingsForTest();
    expect(isMetal6StrobeOn(), '默认不是开着的').toBe(true);
    setMetal6Strobe(false);
    expect(isMetal6StrobeOn()).toBe(false);
    setMetal6Strobe(true);
    expect(isMetal6StrobeOn()).toBe(true);
    resetFxSettingsForTest();
  });

  it('设置项清单里有这一项（设置屏按它渲染）', () => {
    const ids = FX_SETTINGS.map((d) => d.id);
    expect(ids).toContain('metal6-strobe');
    for (const d of FX_SETTINGS) {
      expect(d.label.trim().length).toBeGreaterThan(0);
      expect(d.desc.trim().length).toBeGreaterThan(0);
    }
  });
});

describe('金属6 频闪：消费点的两处口径（源码腿）', () => {
  const renderTs = read('../../src/ui/render.ts');

  it('★ 只在正面时挂层（`!card.faceUp` 直接跳过）', () => {
    const fn = renderTs.slice(renderTs.indexOf('export function syncMetal6Mans'));
    expect(fn).toContain("if (card.defId !== 'metal-6' || !card.faceUp) continue;");
  });

  it('★ 关掉开关时把已挂的层清掉并直接返回（只影响这一个特效）', () => {
    const fn = renderTs.slice(renderTs.indexOf('export function syncMetal6Mans'));
    const gate = fn.indexOf('if (!isMetal6StrobeOn()) {');
    expect(gate, '找不到开关门').toBeGreaterThan(-1);
    const body = fn.slice(gate, gate + 200);
    expect(body).toContain('layer.remove()');
    expect(body).toContain('metal6Mans.clear()');
    expect(body, '关掉之后必须直接返回，不许再往下挂层').toContain('return;');
  });
});
