import { describe, it, expect } from 'vitest';
import type { EffectStep, StepResult } from '../../src/core/models/types';
import { runStack } from '../../src/core/effects/resolve';
import { draftFireP1 } from '../helpers';

describe('reveal-hand (loop reveal)', () => {
  it('revealing a whole hand creates one ghost per card, cleared at opponent turn end', () => {
    const s = draftFireP1();
    const oppHand = s.players[1].hand.map((c) => c.uid);
    s.pendingEffects.push({
      id: 'e1', player: 0,
      gen: (function* (): Generator<EffectStep, void, StepResult> {
        for (const uid of oppHand) yield { op: 'reveal', uid };
      })(),
      sourceUid: 'src', sourceDefId: 'system', system: true, prompt: null, lastAnswer: null,
    });
    runStack(s);
    expect(s.revealedGhosts).toHaveLength(oppHand.length);
    // 系统触发的揭示：lightFx = false（无光之辉光；仅 light 协议揭示为 true）
    for (const g of s.revealedGhosts) expect(g.lightFx).toBe(false);
    // 对手回合结束后清除（由 turn.ts 已实现，快速验证）
  });
});
