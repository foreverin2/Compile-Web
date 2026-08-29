import { describe, it, expect } from 'vitest';
import type { EffectStep, StepResult } from '../../src/core/models/types';
import { runStack, answerEffect } from '../../src/core/effects/resolve';
import { createGame } from '../../src/core/state/create';
import { executeAction } from '../../src/core/game';

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

  it('select with max>1 rejects duplicate uids', () => {
    const s = base();
    let got: string[] = [];
    function* g(): Generator<EffectStep, void, StepResult> {
      const ans = (yield { kind: 'select', title: '弃1张或更多张', min: 1, max: 2, optional: false, candidates: [
        { uid: 'h1', defId: 'fire-1', faceUp: true, owner: 0 as const, zone: 'hand' as const, line: null, pos: null, label: '1' },
        { uid: 'h2', defId: 'fire-1', faceUp: true, owner: 0 as const, zone: 'hand' as const, line: null, pos: null, label: '1' },
      ] }) as { selected: string[] };
      got = ans.selected;
    }
    push(s, g());
    expect(() => answerEffect(s, 'e1', ['h1', 'h1'])).toThrow(/duplicate/);
    answerEffect(s, 'e1', ['h1', 'h2']);
    expect(got).toEqual(['h1', 'h2']);
  });

  it('executeAction effect-choice enforces chooser (holder of affected card decides)', () => {
    const s = base();
    let got = '';
    function* g(): Generator<EffectStep, void, StepResult> {
      const ans = (yield { kind: 'select-action', title: '被作用卡持有者决定', min: 1, max: 1, optional: false, candidates: [], actions: ['action:flip'], chooser: 1 }) as { selected: string[] };
      got = ans.selected[0];
    }
    push(s, g());
    // 效果属主（player 0）无选择权：chooser=1 决定权在玩家 1
    expect(() => executeAction(s, 0, 'effect-choice', { promptId: 'e1', choice: ['action:flip'] })).toThrow(/not your choice/);
    executeAction(s, 1, 'effect-choice', { promptId: 'e1', choice: ['action:flip'] });
    expect(got).toBe('action:flip');
    expect(s.pendingEffects).toHaveLength(0);
  });

  it('select-line with no lines and select-action with no actions fizzle (no deadlock)', () => {
    const s = base();
    let ran = false;
    function* g(): Generator<EffectStep, void, StepResult> {
      yield { kind: 'select-line', title: '选目标线', min: 1, max: 1, optional: false, candidates: [], lines: [] };
      ran = true;
    }
    push(s, g());
    expect(s.pendingEffects).toHaveLength(0);
    expect(ran).toBe(true);
    let ran2 = false;
    function* g2(): Generator<EffectStep, void, StepResult> {
      yield { kind: 'select-action', title: '选择操作', min: 1, max: 1, optional: false, candidates: [], actions: [] };
      ran2 = true;
    }
    push(s, g2());
    expect(s.pendingEffects).toHaveLength(0);
    expect(ran2).toBe(true);
  });
});
