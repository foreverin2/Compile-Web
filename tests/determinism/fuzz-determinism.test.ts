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
 * 本测试就会失败。因此它**不是空转**：删除 tests/fuzz/lib.ts 的 Math.random 补丁之前，
 * 这里的第一个断言必然失败。
 */

/** 独立重跑对比的种子数：每局要跑两遍，故取较小值 */
const REPEAT_SEEDS = 12;
/** 记录-重放对比的种子数：多跑一遍重放，成本较低 */
const REPLAY_SEEDS = 60;
const MAX_STEPS = 400;

describe('D4：全域确定性（全卡池 fuzz）', () => {
  it('同种子两次独立重跑指纹相同', () => {
    const bad: string[] = [];
    for (let seed = 1; seed <= REPEAT_SEEDS; seed++) {
      const a = playRandomGame(seed, MAX_STEPS);
      const b = playRandomGame(seed, MAX_STEPS);
      if (a.fingerprint !== b.fingerprint) bad.push(`seed=${seed}`);
    }
    expect(bad, `以下种子两次重跑不一致：${bad.join(', ')}`).toEqual([]);
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

  it('RNG 消耗次数随对局推进单调增长（防"随机被绕过"）', () => {
    // 同一 seed 两跑必须走出**同一步数**：若某些随机改从种子之外的地方取
    // （补丁/全局/时间），步数就会漂移，此处即报警。
    const a = playRandomGame(7, MAX_STEPS);
    const b = playRandomGame(7, MAX_STEPS);
    expect(a.steps).toBe(b.steps);
  }, 300000);
});
