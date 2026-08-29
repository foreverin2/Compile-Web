import { describe, it, expect } from 'vitest';
import type { EffectStep, StepResult } from '../../src/core/models/types';
import { runStack } from '../../src/core/effects/resolve';
import { makeCard, draftFireP1, advanceToStep } from '../helpers';

describe('playTopDeck op', () => {
  it('takes the deck top and lands it face-down in the line', () => {
    const s = draftFireP1();
    const top = s.players[0].deck[s.players[0].deck.length - 1];
    s.pendingEffects.push({
      id: 'e1', player: 0,
      gen: (function* (): Generator<EffectStep, void, StepResult> {
        yield { op: 'playTopDeck', line: 1, faceUp: false };
      })(),
      sourceUid: 'src', sourceDefId: 'system', system: true, prompt: null, lastAnswer: null,
    });
    runStack(s);
    expect(top.zone).toBe('field');
    expect(top.line).toBe(1);
    expect(top.faceUp).toBe(false);
    expect(s.players[0].stacks[1].map((c) => c.uid)).toContain(top.uid);
    expect(s.players[0].deck.length).toBe(12);
  });
});
