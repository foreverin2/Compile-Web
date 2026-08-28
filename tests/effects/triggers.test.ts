import { describe, it, expect } from 'vitest';
import type { EffectStep, StepResult } from '../../src/core/models/types';
import { registerCardEffects } from '../../src/core/effects/registry';
import { collectTriggers, resolveTrigger } from '../../src/core/effects/triggers';
import { runStack } from '../../src/core/effects/resolve';
import { makeCard } from '../helpers';
import { createGame } from '../../src/core/state/create';
import { advanceStep } from '../../src/core/engine/turn';

// 合成结束触发卡：可选（"你可以"），效果抽 1 张
registerCardEffects('test-end', {
  triggers: {
    end: {
      optional: true,
      fn: function* (): Generator<EffectStep, void, StepResult> {
        yield { op: 'draw', count: 1 };
      },
    },
  },
});
// 合成必选开始触发卡
registerCardEffects('test-start', {
  triggers: {
    start: {
      optional: false,
      fn: function* (): Generator<EffectStep, void, StepResult> {
        yield { op: 'draw', count: 1 };
      },
    },
  },
});

describe('trigger collection', () => {
  it('collects end triggers from face-up uncovered top cards, skipping resolved uids', () => {
    const s = createGame();
    s.phase = 'turn';
    s.players[0].stacks[0] = [makeCard('test-end', 0, 'field', true, 0, 0)];
    s.players[0].stacks[1] = [makeCard('test-end', 0, 'field', true, 1, 0)];
    s.players[1].stacks[0] = [makeCard('test-end', 1, 'field', true, 0, 0)]; // 对手的也算
    s.resolvedTriggerUids = [s.players[0].stacks[1][0].uid];
    const ts = collectTriggers(s, 'end');
    expect(ts).toHaveLength(2);
    expect(ts.map((t) => t.optional)).toEqual([true, true]);
  });

  it('does not collect triggers from face-down or covered cards', () => {
    const s = createGame();
    s.phase = 'turn';
    s.players[0].stacks[0] = [
      makeCard('test-end', 0, 'field', false, 0, 0), // 反面
      makeCard('test-end', 0, 'field', true, 0, 1),  // 顶层正面
    ];
    const ts = collectTriggers(s, 'end');
    expect(ts).toHaveLength(1);
    expect(ts[0].cardUid).toBe(s.players[0].stacks[0][1].uid);
  });

  it('resolveTrigger runs the trigger effect', () => {
    const s = createGame();
    s.phase = 'turn';
    s.players[0].stacks[0] = [makeCard('test-end', 0, 'field', true, 0, 0)];
    // 触发效果 draw 需要牌库有牌
    s.players[0].deck = [makeCard('test-end', 0, 'deck'), makeCard('test-end', 0, 'deck')];
    const t = collectTriggers(s, 'end')[0];
    resolveTrigger(s, t);
    runStack(s);
    expect(s.players[0].hand).toHaveLength(1);
  });

  it('advanceStep resets resolvedTriggerUids when entering end/start', () => {
    const s = createGame();
    s.phase = 'turn';
    s.resolvedTriggerUids = ['x'];
    s.step = 'check-cache';
    advanceStep(s); // → end
    expect(s.resolvedTriggerUids).toEqual([]);
    s.resolvedTriggerUids = ['y'];
    advanceStep(s); // → start（换人）
    expect(s.resolvedTriggerUids).toEqual([]);
  });
});
