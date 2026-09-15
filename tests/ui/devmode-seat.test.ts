import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createGame } from '../../src/core/state/create';
import { isDevUnlocked, runCommand, type DevModeHost } from '../../src/ui/devmode';
import { stripComments } from './source-text';

/**
 * **G2 修正 R12-6：视角切换内化进开发者模式**（用户第五次验收：
 * "还有预览工具条，我希望隐藏它，并将它的功能内化给开发者模式"）。
 *
 * 工具条被隐藏之后，它原来的两个功能各自有了去处：
 *  · **视角切换** → 本文件的判据对象（`视角` / `seat 1|2` 指令走 `host.netSeat`）；
 *  · **运行时自查行** → 解锁后随工具条一起出现；普通对局里结果仍写 console
 *    （`main.ts` 的闸门由 `tests/ui/net-preview-wiring.test.ts` 第 6 条钉住）。
 *
 * ⚠️ 为什么必须有机检：把工具条藏起来很容易顺手把"切到对方视角"这条**预览必需**的能力一起
 * 弄丢（对手手牌只手牌数量那一档不可点 ⇒ 不切视角就没法把一局打完、没法做点名特效抽查）。
 * 这里的判据覆盖：命令的三种写法、闸门缺失时的**响亮降级**（不静默）、以及"解锁标记"这个开关本身。
 */

function makeHost(): { host: DevModeHost; renders: () => number; seat: () => 0 | 1 } {
  let renders = 0;
  let seat: 0 | 1 = 0;
  return {
    host: {
      getState: () => createGame(),
      render: () => { renders += 1; },
      netSeat: { get: () => seat, set: (next) => { seat = next; } },
    },
    renders: () => renders,
    seat: () => seat,
  };
}

const read = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`../../src/${name}`, import.meta.url)))
    .subarray(0, 4 * 1024 * 1024).toString('utf8');

describe('R12-6 · 开发者模式 `视角` 指令（从预览工具条内化过来）', () => {
  it('`视角` 无参 = 在当前座位之间切换；每次都会重渲染（页面当场跟着换）', () => {
    const { host, renders, seat } = makeHost();
    expect(seat(), '初始座位不是 0（P1）').toBe(0);
    runCommand(host, '视角');
    expect(seat(), '`视角` 没有把座位切到 P2 —— 工具条隐藏之后就没有别的入口了').toBe(1);
    expect(renders(), '`视角` 没有触发重渲染（页面不会跟着换视角）').toBe(1);
    runCommand(host, '视角');
    expect(seat(), '再输一次 `视角` 没有切回 P1（应该是**切换**语义）').toBe(0);
    expect(renders()).toBe(2);
  });

  it('`seat 1` / `seat 2` 是**绝对**指定（不切换）', () => {
    const { host, seat } = makeHost();
    runCommand(host, 'seat 2');
    expect(seat(), '`seat 2` 应指定 P2').toBe(1);
    runCommand(host, 'seat 2');
    expect(seat(), '`seat 2` 第二次仍是 P2（绝对语义，不是切换）').toBe(1);
    runCommand(host, 'SEAT 1');
    expect(seat(), '`SEAT 1`（大小写不敏感）应指定 P1').toBe(0);
  });

  it('此页没有视角开关时**响亮降级**（写日志，不静默、不抛异常）', () => {
    const state = createGame();
    const host: DevModeHost = { getState: () => state, render: () => { /* noop */ } };
    expect(() => runCommand(host, '视角'), '缺少 netSeat 时抛异常了（开发者指令不该崩）').not.toThrow();
    expect(state.log.join(' '), '缺少 netSeat 时没有留下日志 —— 用户会以为指令坏了')
      .toContain('此页没有视角开关');
  });

  it('`clean` / 未知指令的分流不受影响（新指令没有吃掉旧前缀）', () => {
    const { host } = makeHost();
    runCommand(host, 'viewseat 9');   // 不合法的写法 → 未知指令
    runCommand(host, 'clean');
    // `视角` 的判据是整词锚定，不能把 `viewseat` 之外的东西也吃进来
    expect(read('ui/devmode.ts'), '`视角` 的正则没有整词锚定（会误吃别的指令）')
      .toMatch(/\^\(\?:视角\|seat\|viewseat\)\$/);
  });

  /**
   * 解锁标记（`isDevUnlocked`）是"工具条要不要渲染"的**唯一**开关（`main.ts` 用它做闸门）。
   * ⚠️ 本用例**不**走密码流程（那需要 DOM）：它只钉住"这个函数存在且默认 false"这件事 ——
   * 默认 false = 普通对局里页面上没有工具条（用户要的形态）。
   */
  it('`isDevUnlocked()` 默认 false（没进开发者模式 ⇒ 页面上没有预览工具条）', () => {
    expect(typeof isDevUnlocked, 'devmode 没有导出 isDevUnlocked（main.ts 的闸门无从实现）').toBe('function');
    expect(isDevUnlocked(), '默认就解锁了 —— 预览工具条会常驻在普通对局的页面上').toBe(false);
  });

  it('源码腿：解锁后**立刻重渲染**一次（否则工具条要等下一次操作才出现）', () => {
    const src = stripComments(read('ui/devmode.ts'));
    const unlock = /passwordUnlocked = true;[\s\S]{0,400}?host\.render\(\)/.exec(src);
    expect(unlock, '密码正确的分支里没有 `host.render()` —— 解锁后工具条不会当场出现'
      + '（用户会以为"我进了开发者模式但工具条没出来"）').toBeTruthy();
    expect(src, '指令页提示行（HINT）没有登记 `视角` / `seat` 指令 —— 用户无从知道它存在')
      .toMatch(/视角\s*\/\s*seat/);
  });
});
