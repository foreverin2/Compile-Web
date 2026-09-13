import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { swapOrder, orderChanged, orderToAction } from '../../src/ui/control-rearrange';
import type { Line } from '../../src/core/models/types';

/**
 * 效果内重排（draft 模式）守卫（2026-09-13，用户清单 #10）。
 *
 * 背景：动量4「重排你的协议」原先弹 5 个 `action:order:XYZ` 按钮（布局选择框），用户要求
 * 改成**编译期同款的重排窗口**（点击两张协议交换）。窗口不能在效果栈挂起期间走
 * `rearrange-protocols`（引擎硬拒），所以由 draft 模式在本地摆好布局、完成时回填一条
 * `action:order:XYZ` → 引擎零改动。
 *
 * 本仓库 UI 测试无 jsdom（vite.config environment=node），所以：① 纯函数直接单测；
 * ② 接线/模式用源码文本守卫锁死（防"写了 draft 但没人打开窗口"）。
 */

const root = new URL('../../src/', import.meta.url);
const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, root))).subarray(0, 4 * 1024 * 1024).toString('utf8');
const modalTs = read('ui/control-rearrange.ts');
const mainTs = read('main.ts');
const renderTs = read('ui/render.ts');
const momentumTs = read('core/effects/cards/momentum.ts');
const typesTs = read('core/models/types.ts');

describe('效果内重排（draft 模式）', () => {
  it('swapOrder：交换两个位置，不改动原数组', () => {
    const base: Line[] = [0, 1, 2];
    expect(swapOrder(base, 0, 2)).toEqual([2, 1, 0]);
    expect(swapOrder(base, 1, 2)).toEqual([0, 2, 1]);
    expect(base, 'swapOrder 不得就地修改入参').toEqual([0, 1, 2]);
    // 连续两次同一对交换 → 回到初始布局
    const once = swapOrder(base, 0, 1);
    expect(swapOrder(once, 0, 1)).toEqual([0, 1, 2]);
  });

  it('orderChanged：恒等布局不可提交（引擎 resolve.ts 会拒绝 reorder must change）', () => {
    expect(orderChanged([0, 1, 2])).toBe(false);
    expect(orderChanged([0, 2, 1])).toBe(true);
    expect(orderChanged([2, 1, 0])).toBe(true);
  });

  it('orderToAction：编码与引擎 reorderProtocols 语义一致（order[i] = 摆到第 i 位的原下标）', () => {
    expect(orderToAction([0, 2, 1])).toBe('action:order:021');
    expect(orderToAction([2, 1, 0])).toBe('action:order:210');
    // 引擎消费：protos[i] = copy[order[i]] → 用一次真实重排验证两端一致（见 effects 测试），
    // 这里只锁编码形状（3 位数字）
    expect(orderToAction([1, 0, 2])).toMatch(/^action:order:\d{3}$/);
  });

  it('模态支持 draft 模式（本地布局 + sessionKey 幂等 + 仅变化后可提交）', () => {
    expect(modalTs, '模态未提供 draft 模式').toContain("mode?: 'live' | 'draft'");
    expect(modalTs).toContain('sessionKey?: string');
    expect(modalTs).toContain('canCommit');
    expect(modalTs, 'draft 模式未维护本地布局').toContain('let draftOrder: Line[] = [0, 1, 2];');
    expect(modalTs, 'draft 交换未走本地 swapOrder').toContain('draftOrder = swapOrder(draftOrder, a, line);');
    // 同 sessionKey 重复打开不得重置会话（每帧 sync 调用）
    expect(modalTs, 'open 缺少 sessionKey 幂等早退').toMatch(/o\.sessionKey === opts\.sessionKey[\s\S]{0,120}renderModal\(\);\s*return;/);
    // draft 未改动时提交按钮禁用
    expect(modalTs).toMatch(/\(done as HTMLButtonElement\)\.disabled = !can/);
  });

  it('main.ts：每帧渲染同步窗口，完成时回填一条 action:order（不改引擎）', () => {
    expect(mainTs, '缺少效果内重排同步函数').toContain('function syncRearrangeModalForEffect()');
    expect(mainTs, '同步函数未接进每帧回调').toMatch(/onRendered\(\)\s*\{[\s\S]{0,240}syncRearrangeModalForEffect\(\);/);
    expect(mainTs).toContain('function commitEffectRearrange(');
    expect(mainTs, '提交未走 effect-choice + orderToAction').toMatch(/kind: 'effect-choice', promptId, choice: \[orderToAction\(order\)\]/);
    // 栈顶已变（效果被别的路径结算）时不得盲目提交
    expect(mainTs).toMatch(/if \(!top \|\| top\.id !== promptId \|\| !top\.prompt\)/);
    // 随局清理会话键
    expect(mainTs).toMatch(/closeControlRearrangeModal\(\); \/\/ 控制组件重排模态（body 级）随局清扫[\s\S]{0,80}effectRearrangeKey = null;/);
  });

  it('引擎：选择请求带 rearrangeSide，UI 侧不再渲染布局按钮', () => {
    expect(typesTs, 'ChoiceRequest 缺少 rearrangeSide').toContain('rearrangeSide?: PlayerId');
    expect(momentumTs, '动量4 未标记 rearrangeSide').toMatch(/rearrangeSide: ctx\.player/);
    expect(momentumTs, '动量4 仍带"选择新布局"旧文案').not.toContain('（选择新布局）');
    // 渲染层：有 rearrangeSide 时不渲染 action 按钮，只给提示
    const branch = renderTs.slice(renderTs.indexOf("prompt.kind === 'select-action'"));
    const note = branch.indexOf("prompt.rearrangeSide !== undefined");
    const buttons = branch.indexOf('for (const act of prompt.actions ?? [])');
    expect(note, 'render.ts 未处理 rearrangeSide').toBeGreaterThan(-1);
    expect(note, '提示分支必须在按钮渲染之前').toBeLessThan(buttons);
    expect(branch).toContain("el('div', 'choice-note'");
  });
});
