import { describe, it, expect } from 'vitest';
import type { EffectStep, StepResult } from '../../src/core/models/types';
import { runStack, answerEffect } from '../../src/core/effects/resolve';
import { createGame } from '../../src/core/state/create';

function base(): ReturnType<typeof createGame> {
  const s = createGame();
  s.phase = 'turn';
  return s;
}
function push(s: ReturnType<typeof createGame>, gen: Generator<EffectStep, void, StepResult>): void {
  s.pendingEffects.push({ id: 'e1', player: 0, gen, sourceUid: 'src', sourceDefId: 'system', system: true, prompt: null, lastAnswer: null });
  runStack(s);
}

describe('choice kinds', () => {
  it('select-line accepts a valid line and rejects others', () => {
    const s = base();
    let got = '';
    function* g(): Generator<EffectStep, void, StepResult> {
      const ans = (yield { kind: 'select-line', title: '选目标线', min: 1, max: 1, optional: false, candidates: [], lines: [1, 2] }) as { selected: string[] };
      got = ans.selected[0];
    }
    push(s, g());
    expect(() => answerEffect(s, 'e1', ['line:0'])).toThrow(/invalid line/);
    answerEffect(s, 'e1', ['line:2']);
    expect(got).toBe('line:2');
  });

  it('select-action accepts a listed action and rejects unknown', () => {
    const s = base();
    let got = '';
    function* g(): Generator<EffectStep, void, StepResult> {
      const ans = (yield { kind: 'select-action', title: '选择操作', min: 1, max: 1, optional: true, candidates: [], actions: ['action:flip', 'action:shift'] }) as { selected: string[] };
      got = ans.selected[0] ?? '(skip)';
    }
    push(s, g());
    expect(() => answerEffect(s, 'e1', ['action:delete'])).toThrow(/invalid action/);
    answerEffect(s, 'e1', []); // optional 跳过
    expect(got).toBe('(skip)');
  });
});
