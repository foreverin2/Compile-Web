import { describe, it, expect } from 'vitest';
import type { EffectStep, StepResult } from '../../src/core/models/types';
import { runStack } from '../../src/core/effects/resolve';
import { draftFireP1 } from '../helpers';

// rearrangeProtocols 系统级测试：生成器直接 yield 该 op，交换两名协议位（defId 与 compiled 一起走）
describe('rearrangeProtocols op', () => {
  it('swaps two protocol positions (defId and compiled status travel together)', () => {
    const s = draftFireP1();
    // P1 协议线：0=fire（已编译）、1/2=未编译 —— 交换 0 与 2
    s.players[0].protocols[0].compiled = true;
    const before = s.players[0].protocols.map((p) => ({ defId: p.defId, compiled: p.compiled }));
    s.pendingEffects.push({
      id: 'e1', player: 0,
      gen: (function* (): Generator<EffectStep, void, StepResult> {
        yield { op: 'rearrangeProtocols', a: 0, b: 2 };
      })(),
      sourceUid: 'src', sourceDefId: 'system', system: true, prompt: null, lastAnswer: null,
    });
    runStack(s);
    expect(s.players[0].protocols[0].defId).toBe(before[2].defId);
    expect(s.players[0].protocols[2].defId).toBe(before[0].defId);
    expect(s.players[0].protocols[0].compiled).toBe(before[2].compiled);
    expect(s.players[0].protocols[2].compiled).toBe(before[0].compiled);
    expect(s.players[0].protocols[1].defId).toBe(before[1].defId);
    expect(s.pendingEffects).toHaveLength(0);
  });

  it('rejects swapping a position with itself', () => {
    const s = draftFireP1();
    s.pendingEffects.push({
      id: 'e1', player: 0,
      gen: (function* (): Generator<EffectStep, void, StepResult> {
        yield { op: 'rearrangeProtocols', a: 1, b: 1 };
      })(),
      sourceUid: 'src', sourceDefId: 'system', system: true, prompt: null, lastAnswer: null,
    });
    expect(() => runStack(s)).toThrow(/cannot swap/);
  });
});
