import { describe, it, expect } from 'vitest';
import { stackValue } from '../../src/core/state/create';
import { makeCard, draftFireP1 } from '../helpers';
// 真实注册：darkness-2 的 valueModifier 在 cards/darkness.ts 注册（Task 9 在该文件补全其余效果）
import '../../src/core/effects/cards/darkness';

describe('valueModifier engine', () => {
  it('applies own-stack modifier (darkness-2: face-down cards count 4)', () => {
    const s = draftFireP1();
    // darkness-2 反面（基准 2，修正后 4）+ fire-5 正面（5）→ 9
    s.players[0].stacks[0] = [
      makeCard('darkness-2', 0, 'field', false, 0, 0),
      makeCard('fire-5', 0, 'field', true, 0, 1),
    ];
    expect(stackValue(s, 0, 0)).toBe(4 + 5); // 反面 4 + 正面 5
  });

  it('own-stack modifier of the opponent does not affect the valuing player', () => {
    const s = draftFireP1();
    s.players[0].stacks[0] = [makeCard('fire-5', 0, 'field', true, 0, 0)];
    // 对手同线的 own-stack 修正只作用于对手总值，我方线总值不受影响
    s.players[1].stacks[0] = [makeCard('darkness-2', 1, 'field', false, 0, 0)];
    expect(stackValue(s, 0, 0)).toBe(5);
  });
});
