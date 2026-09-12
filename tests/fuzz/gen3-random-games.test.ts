import { describe, it, expect } from 'vitest';
import { ALL_PROTOCOLS_3, ALL_CARD_DEFS_3 } from '../../src/data/cards3';
import { playRandomGame, type GameStats } from './lib';

/**
 * 3代卡牌效果随机对局压力测试（2026-09-13，用户要求「检查3代卡牌效果是否会出现 bug」）。
 *
 * 检查项来自 gen-1/gen-2 踩过的坑：shift 目标线=原线抛错、目标卡已离场抛错、
 * 选择请求候选不足导致卡死、被覆盖卡未 allowCovered、牌库空 playTopDeck 抛错、
 * 卡牌在区域间丢失/重复/pos 错位、线值 NaN 等。
 *
 * 覆盖：协议池强制为 3代 15 套 → 90 张 3代卡全部有机会入场；随机草稿 → 随机合法行动 /
 * 随机应答（含跳过）→ 直至分出胜负或步数上限。失败时打印种子便于复现（lib.ts 同一随机数）。
 */

describe('3代卡牌效果随机对局压力测试（fuzz）', () => {
  it('3代卡数据完整（15 套协议、卡 defId 唯一）', () => {
    expect(ALL_PROTOCOLS_3).toHaveLength(15);
    expect(ALL_CARD_DEFS_3.length).toBeGreaterThanOrEqual(78); // 部分协议缺 0/6 分（依卡图）
    const ids = new Set(ALL_CARD_DEFS_3.map((c) => c.defId));
    expect(ids.size).toBe(ALL_CARD_DEFS_3.length);
  });

  it('随机对局 150 局（每局至多 400 步）不抛错、状态不变量成立、3代卡全覆盖', () => {
    const failures: string[] = [];
    const stats: GameStats = { played: new Set<string>() };
    let finished = 0;
    for (let seed = 1; seed <= 150; seed++) {
      try {
        const { finished: f } = playRandomGame(seed, 400, stats);
        if (f) finished += 1;
      } catch (err) {
        failures.push(`seed=${seed}：${err instanceof Error ? err.message : String(err)}`);
      }
    }
    expect(failures, `出现 ${failures.length} 局异常：\n${failures.join('\n')}`).toEqual([]);
    expect(finished).toBeGreaterThan(0); // 随机对局应能正常推进/分出胜负
    // 覆盖率护栏：150 局须让 3代 90 张卡全部进过场（否则本测试的"无异常"结论不成立）
    const missing = ALL_CARD_DEFS_3.map((c) => c.defId).filter((d) => !stats.played.has(d));
    expect(missing, `以下 3代卡未进过场，fuzz 覆盖不足：${missing.join(', ')}`).toEqual([]);
  }, 300000); // 150 局 × 400 步属重负载测试：默认 5s 不够（并行跑时更慢）
});
