import { describe, it, expect } from 'vitest';
import { createGame } from '../../src/core/state/create';

describe('effect state fields', () => {
  it('initializes effect engine fields', () => {
    const s = createGame();
    expect(s.pendingEffects).toEqual([]);
    expect(s.pendingPlay).toBeNull();
    expect(s.pendingShift).toBeNull();
    expect(s.resolvedTriggerUids).toEqual([]);
    expect(s.pendingStepAdvance).toBe(false);
  });
});
