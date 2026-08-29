import { describe, it, expect } from 'vitest';
import { stackValue } from '../../src/core/state/create';
import { makeCard, draftFireP1 } from '../helpers';
// 真实注册：darkness-2 的 valueModifier 在 cards/darkness.ts 注册（Task 9 在该文件补全其余效果）
import '../../src/core/effects/cards/darkness';

describe('valueModifier engine', () => {
  it('line modifier requires the modifier card face-up (face-down grants nothing)', () => {
    const s = draftFireP1();
    // darkness-2 反面：背面朝下没有指令效果/协议属性 → 无修正；fire-5 正面（5）→ 7
    s.players[0].stacks[0] = [
      makeCard('darkness-2', 0, 'field', false, 0, 0),
      makeCard('fire-5', 0, 'field', true, 0, 1),
    ];
    expect(stackValue(s, 0, 0)).toBe(2 + 5); // 反面 2 + 正面 5
  });

  it('line modifier persists while the modifier card is face-up even when covered', () => {
    const s = draftFireP1();
    // darkness-2 正面（被 fire-5 覆盖但仍正面朝上 → 顶部指令‑常驻效果不被覆盖遮挡）+ 反面 fire-1（2）+ 顶卡 fire-5（5）
    // 基准 2+2+5=9；本线 1 张反面牌 → +2 → 11
    s.players[0].stacks[0] = [
      makeCard('darkness-2', 0, 'field', true, 0, 0),
      makeCard('fire-1', 0, 'field', false, 0, 1),
      makeCard('fire-5', 0, 'field', true, 0, 2),
    ];
    expect(stackValue(s, 0, 0)).toBe(9 + 2);
  });

  it('line modifier is line-wide: an opponent face-up darkness-2 boosts the valuing player', () => {
    const s = draftFireP1();
    // 旧语义（own-stack 隔离）：P2 的 darkness-2 不影响 P1 的估值。改为 line 目标后，
    // 线上任一玩家正面 darkness-2 即对双方估值生效 → P1 的 1 张反面卡按 4（基准 2 + 1×2）
    s.players[0].stacks[0] = [makeCard('fire-1', 0, 'field', false, 0, 0)];
    s.players[1].stacks[0] = [makeCard('darkness-2', 1, 'field', true, 0, 0)];
    expect(stackValue(s, 0, 0)).toBe(2 + 2);
  });

  it('line modifier extends to the opponent valuation: own face-up darkness-2 counts their face-down cards', () => {
    const s = draftFireP1();
    // P1 线 0 正面 darkness-2；P2 线 0 有 1 张反面卡 → P2 的估值（stackValue(s,1,0)）
    // 把 P2 自己的反面卡按 4 计（基准 2 + 1×2）
    s.players[0].stacks[0] = [makeCard('darkness-2', 0, 'field', true, 0, 0)];
    s.players[1].stacks[0] = [makeCard('fire-1', 1, 'field', false, 0, 0)];
    expect(stackValue(s, 1, 0)).toBe(2 + 2);
  });

  it('line modifier applies once per valuation even with face-up darkness-2 on both sides', () => {
    const s = draftFireP1();
    // 双方同线各有正面 darkness-2：每估值只应用一次（不按修正卡叠加）。P1 估值：
    // 基准 反面 fire-1(2) + 正面 darkness-2(2) = 4；修正 +2（估值方 1 张反面）→ 6；若双重应用则为 8
    s.players[0].stacks[0] = [
      makeCard('fire-1', 0, 'field', false, 0, 0),
      makeCard('darkness-2', 0, 'field', true, 0, 1),
    ];
    s.players[1].stacks[0] = [makeCard('darkness-2', 1, 'field', true, 0, 0)];
    expect(stackValue(s, 0, 0)).toBe(6);
  });
});
