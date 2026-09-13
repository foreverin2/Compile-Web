import { describe, it, expect } from 'vitest';
import { playRandomGame, rng, setupGen3Game } from '../fuzz/lib';
import { stateFingerprint } from '../../src/core/fingerprint';
import { applyStep, recordRandomSteps } from './lib';

/**
 * D4：全域确定性 —— 覆盖整个 3 代卡池的 fuzz 驱动（随机草稿、随机合法行动、随机应答）
 * 在**没有任何 Math.random 补丁**的前提下必须可复现。
 *
 * 这组测试的观测力来自"两次独立重跑"：若引擎里还存在任何未进种子的随机源
 * （Math.random / Date / 模块级递增计数器等），两次跑出的对局会分叉、指纹不同 ——
 * 本测试就会失败。
 *
 * 注意第一个断言的**牙齿在什么时候生效**：它只在「补丁已删、而引擎仍在用 Math.random」
 * 时才会咬人。当年 fuzz 库还挂着 Math.random 补丁时，两次运行同样走补丁的种子——断言会
 * 照常通过，因此"删除补丁之后它必然失败"是把证据关系说反了。真正的证据是**负控**：
 * 临时把某条选择流的种子去掉（退回 Math.random），D4 的 12 个种子会 12/12 失败。
 */

/** 独立重跑对比的种子数：每局要跑两遍，故取较小值 */
const REPEAT_SEEDS = 12;
/** 记录-重放对比的种子数：多跑一遍重放，成本较低 */
const REPLAY_SEEDS = 60;
const MAX_STEPS = 400;

describe('D4：全域确定性（全卡池 fuzz）', () => {
  it('同种子两次独立重跑指纹相同', () => {
    const bad: string[] = [];
    // 顺带留下前两个种子的指纹：下面用它做跨种子差异断言，避免再多跑两局
    const fp = new Map<number, string>();
    for (let seed = 1; seed <= REPEAT_SEEDS; seed++) {
      const a = playRandomGame(seed, MAX_STEPS);
      const b = playRandomGame(seed, MAX_STEPS);
      if (a.fingerprint !== b.fingerprint) bad.push(`seed=${seed}`);
      if (seed <= 2) fp.set(seed, a.fingerprint);
    }
    expect(bad, `以下种子两次重跑不一致：${bad.join(', ')}`).toEqual([]);

    // 跨种子必须不同：上面的"两次重跑"检测不到「常量型 / 忽略种子的 RNG」
    // ——那种实现两次运行恒等，D4 会全绿。这条断言补上该盲区。
    // 先把这个前提钉成结构性的：若把 REPEAT_SEEDS 调到 1，fp.get(2) 会变成 undefined、
    // 与 fp.get(1) 天然不等 → 断言会静默失效。故显式断言指纹表里确实有两个种子。
    expect(fp.size).toBe(2);
    expect(fp.get(1)).not.toBe(fp.get(2));
  }, 300000);

  it('录制步骤后重放，指纹与原局相同', () => {
    const bad: string[] = [];
    for (let seed = 1; seed <= REPLAY_SEEDS; seed++) {
      const s = setupGen3Game(seed);
      const steps = recordRandomSteps(s, rng(seed ^ 0x5bf03635), MAX_STEPS);
      const fp = stateFingerprint(s);
      const s2 = setupGen3Game(seed);
      for (const step of steps) applyStep(s2, step);
      if (stateFingerprint(s2) !== fp) bad.push(`seed=${seed}`);
    }
    expect(bad, `以下种子重放后指纹不一致：${bad.join(', ')}`).toEqual([]);
  }, 300000);

  it('同种子两跑的步数相等（防"随机被绕过"）', () => {
    // 同一 seed 两跑必须走出**同一步数**：若某些随机改从种子之外的地方取
    // （补丁/全局/时间），步数就会漂移，此处即报警。
    const a = playRandomGame(7, MAX_STEPS);
    const b = playRandomGame(7, MAX_STEPS);
    expect(a.steps).toBe(b.steps);
    // 步数相等本身在"两跑都撞上 MAX_STEPS 上限"时是空转的——必须同时比 finished：
    // 一跑分出胜负、另一跑没分出来（步数同为上限）才算真正同轨。
    expect(a.finished).toBe(b.finished);
  }, 300000);
});
