import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * 批次 E 守卫（交换附加层 + 收尾，2026-09-13）。
 * 锁四件事：
 *  ① 交换事件带 `sourceDefId`（否则分不清"支点/柔性的效果交换"与"玩家行动重排"）；
 *  ② 两个订阅点（协议交换 / 堆叠交换）都已接入；
 *  ③ "被覆盖卡只在可见区域播放"的工具真的被用了（同步层 + 浮层卡两条路径）；
 *  ④ 性能观测（不降级只观测）与实现手册存在。
 */

const root = new URL('../../', import.meta.url);
const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, root))).subarray(0, 4 * 1024 * 1024).toString('utf8');

const swapTs = read('src/ui/fx-gen3-swap.ts');
const syncCss = read('src/ui/styles-gen3-sync.css');
const utilTs = read('src/ui/gen3-util.ts');
const resolveCore = read('src/core/effects/resolve.ts');
const effectsTs = read('src/ui/effects/index.ts');
const mainTs = read('src/main.ts');
const controlTs = read('src/ui/gen3-control.ts');
const cardFxTs = read('src/ui/fx-gen3.ts');
const diagTs = read('src/ui/diag.ts');
const manual = read('docs/3代特效实现手册.md');

describe('批次 E 守卫：交换附加层 + 收尾', () => {
  it('交换事件带来源卡（区分效果交换与玩家行动重排）', () => {
    expect(resolveCore, 'stacks:swapped 缺 sourceDefId').toMatch(/stacks:swapped[\s\S]{0,200}sourceDefId: pe\.sourceDefId/);
    expect(resolveCore, 'protocols:rearranged（reorder）缺 sourceDefId').toMatch(/protocols:rearranged[\s\S]{0,200}sourceDefId: pe\.sourceDefId/);
  });

  it('两个订阅点已接入（协议交换附加 + 堆叠交换附加）', () => {
    expect(effectsTs).toContain('gen3ProtocolSwapFx(');
    expect(effectsTs).toContain('gen3FulcrumSwapFx(');
    expect(effectsTs).toContain('export function initGen3StackSwapFx');
    expect(mainTs, 'initGen3StackSwapFx 未注册').toContain('initGen3StackSwapFx();');
    // 非 fulcrum/flexibility 来源必须放行（玩家行动重排不受影响）
    expect(swapTs).toMatch(/if \(!isFulcrum && !isFlex\) return false;/);
    expect(effectsTs).toMatch(/if \(!\(p\.sourceDefId \?\? ''\)\.startsWith\('fulcrum-'\)\) return;/);
  });

  it('被覆盖卡可见区域：工具存在 + 两条路径都在用', () => {
    expect(utilTs).toContain('export function visibleRectOf');
    expect(utilTs).toContain('export function clipInsetRightPct');
    // 同步层（愤怒0 划除带 / 嫉妒0 源卡标记）
    expect(controlTs).toContain('visibleRectOf(s, c.uid)');
    expect(controlTs).toContain('visibleRectOf(s, best.uid)');
    // 浮层卡（伏击3 被挖出的被盖卡 / 惰性0 翻转被盖牌）
    expect(cardFxTs.match(/clipInsetRightPct\(state, p\.uid\)/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  });

  it('性能：只观测不降级（Q6）+ 手册已落地', () => {
    expect(diagTs).toContain('gen3LayerReport');
    expect(diagTs).toContain('3代特效层（活动）');
    // 观测不得引入"降级/限流"分支（注释里可以说明"不降级"，代码里不能有降级逻辑）
    const diagCode = diagTs.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(diagCode).not.toMatch(/降级|限流/);
    expect(manual.length, '实现手册内容过少').toBeGreaterThan(3000);
    for (const needle of ['文件地图', '三条铁律', '坑清单', '验证与守卫', '品质标准']) {
      expect(manual, `手册缺少章节：${needle}`).toContain(needle);
    }
  });

  it('交换特效的类名都在 styles-gen3-sync.css 有定义', () => {
    const used = new Set<string>();
    for (const m of swapTs.matchAll(/['"`]([^'"`]*g3swap-[a-z0-9-]+[^'"`]*)['"`]/g)) {
      for (const token of m[1].split(/\s+/)) if (/^g3swap-[a-z0-9-]+$/.test(token)) used.add(token);
    }
    const missing = [...used].filter((cls) => !new RegExp(`\\.${cls}(\\s*[,{:. ]|\\s+[a-z])`).test(syncCss));
    expect(missing, `以下类在 JS 中使用但 CSS 未定义：${missing.join(', ')}`).toEqual([]);
  });
});
