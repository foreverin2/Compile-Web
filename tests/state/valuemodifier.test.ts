import { describe, it, expect } from 'vitest';
import { stackValue } from '../../src/core/state/create';
import { makeCard, draftFireP1 } from '../helpers';
// 真实注册：darkness-2 的 valueModifier 在 cards/darkness.ts 注册（Task 9 在该文件补全其余效果）
import '../../src/core/effects/cards/darkness';

describe('valueModifier engine', () => {
  it('own-stack modifier requires the modifier card face-up (face-down grants nothing)', () => {
    const s = draftFireP1();
    // darkness-2 反面：背面朝下没有指令效果/协议属性 → 无修正；fire-5 正面（5）→ 7
    s.players[0].stacks[0] = [
      makeCard('darkness-2', 0, 'field', false, 0, 0),
      makeCard('fire-5', 0, 'field', true, 0, 1),
    ];
    expect(stackValue(s, 0, 0)).toBe(2 + 5); // 反面 2 + 正面 5
  });

  it('own-stack modifier persists while the modifier card is face-up even when covered', () => {
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

  it('own-stack modifier of the opponent does not affect the valuing player', () => {
    const s = draftFireP1();
    s.players[0].stacks[0] = [makeCard('fire-5', 0, 'field', true, 0, 0)];
    // 对手同线的 own-stack 修正只作用于对手总值，我方线总值不受影响（即使对手卡正面朝上）
    s.players[1].stacks[0] = [makeCard('darkness-2', 1, 'field', true, 0, 0)];
    expect(stackValue(s, 0, 0)).toBe(5);
  });
});
