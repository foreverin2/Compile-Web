import { describe, it, expect } from 'vitest';
import type { EffectStep, StepResult } from '../../src/core/models/types';
import { registerCardEffects } from '../../src/core/effects/registry';
import { playCard } from '../../src/core/actions/base';
import { makeCard, draftFireP1 } from '../helpers';

// 被盖住前触发：抽 1 张
registerCardEffects('test-bc', {
  triggers: {
    'before-covered': {
      optional: false,
      fn: function* (): Generator<EffectStep, void, StepResult> {
        yield { op: 'draw', count: 1 };
      },
    },
  },
});

describe('playCard with pendingPlay', () => {
  it('plays face-up onto empty line: lands (no before-covered, no middle registered yet)', () => {
    const s = draftFireP1(); // P1 协议线 0 = fire
    const card = makeCard('fire-5', 0, 'hand');
    s.players[0].hand = [card];
    const ret = playCard(s, 0, card.uid, true, 0);
    expect(ret.zone).toBe('field');
    expect(s.pendingPlay).toBeNull();
    expect(s.players[0].stacks[0].map((c) => c.uid)).toEqual([card.uid]);
    expect(s.pendingEffects).toHaveLength(0);
  });

  it('resolves before-covered trigger of the target top card before landing', () => {
    const s = draftFireP1();
    const top = makeCard('test-bc', 0, 'field', true, 0, 0);
    s.players[0].stacks[0] = [top];
    const played = makeCard('fire-5', 0, 'hand');
    s.players[0].hand = [played];
    playCard(s, 0, played.uid, true, 0);
    expect(s.pendingPlay).toBeNull();
    expect(s.players[0].stacks[0].map((c) => c.uid)).toEqual([top.uid, played.uid]);
    expect(s.players[0].hand).toHaveLength(1); // before-covered 抽了 1 张
  });
});
