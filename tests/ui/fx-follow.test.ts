import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { registerFollow, syncFollowers, followCount } from '../../src/ui/fx-follow';

/**
 * 长寿命 FX「跟随」注册表守卫（2026-09-13 用户裁决：给 2~3.6s 的卡框光/落点光加跟随）。
 *
 * 背景：瞬态约定"≤1.6s 的 fixed 层可停在事件时刻坐标"覆盖不了 2~3.6s 的层（迷雾卡框灰光 2s /
 * 透彻落点眼 3s / 爱意牌库光芒 2s）——玩家在这段时间滚动棋盘会看到它们脱离卡面。
 * 本仓库 UI 测试无 jsdom（environment=node），所以：① 注册表语义用假元素直接单测；
 * ② 接线（谁注册、谁每帧调用）用源码守卫锁死。
 */

const root = new URL('../../src/', import.meta.url);
const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, root))).subarray(0, 4 * 1024 * 1024).toString('utf8');

/** 假元素：只用到 isConnected + className（注册表只碰这两个） */
function fakeEl(): { isConnected: boolean; className: string } {
  return { isConnected: true, className: 'fx-fake' };
}

describe('长寿命 FX 跟随注册表', () => {
  it('syncFollowers 会调用每个已连接元素的 place（滚动时重定位）', () => {
    const el = fakeEl();
    let calls = 0;
    registerFollow(el as unknown as HTMLElement, () => { calls += 1; });
    const before = followCount();
    expect(before).toBeGreaterThan(0);
    syncFollowers();
    syncFollowers();
    expect(calls).toBe(2); // 每帧都重定位（不是只第一次）
    el.isConnected = false; // 元素已被 remove()
    syncFollowers();
    expect(followCount()).toBe(before - 1); // 自动出栈，不泄漏
  });

  it('已移除的元素不会再被 place（避免对 detached 节点写样式）', () => {
    const el = fakeEl();
    let calls = 0;
    registerFollow(el as unknown as HTMLElement, () => { calls += 1; });
    el.isConnected = false;
    syncFollowers();
    syncFollowers();
    expect(calls).toBe(0);
  });

  it('接线：render.ts 每帧 + main.ts 滚动/缩放都调用 syncFollowers，三处长寿命 FX 都注册了', () => {
    expect(read('ui/render.ts'), 'render.ts 每帧未同步跟随层').toContain('syncFollowers();');
    const mainTs = read('main.ts');
    expect(mainTs, 'main.ts 的滚动/缩放 rAF 未同步跟随层').toMatch(/syncGen3Persistent\(state\);[\s\S]{0,200}syncFollowers\(\);/);
    // 三处 >1.6s 的层必须注册（迷雾卡框灰光 / 透彻落点眼 / 爱意牌库光芒）
    const gen2 = read('ui/fx-gen2.ts');
    expect(gen2, '迷雾卡框灰光（2s）未注册跟随').toMatch(/glow\.className = 'fx-smoke-cardglow'[\s\S]{0,900}registerFollow\(glow/);
    expect(gen2, '透彻落点眼（3s）未注册跟随').toMatch(/fx-clarity-card-eye[\s\S]{0,900}registerFollow\(eye/);
    expect(read('ui/effects/index.ts'), '爱意牌库光芒（2s）未注册跟随').toMatch(/fx-love-deckglow[\s\S]{0,900}registerFollow\(glow/);
  });
});
