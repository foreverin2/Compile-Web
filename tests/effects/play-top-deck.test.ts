import { describe, it, expect } from 'vitest';
import type { EffectStep, StepResult } from '../../src/core/models/types';
import { runStack } from '../../src/core/effects/resolve';
import { registerCardEffects } from '../../src/core/effects/registry';
import { makeCard, draftFireP1, advanceToStep } from '../helpers';

// 被盖住前触发：抽 1 张（playTopDeck 落地顺序守卫用）
registerCardEffects('pdeck-bc', {
  triggers: {
    'before-covered': {
      optional: false,
      fn: function* (): Generator<EffectStep, void, StepResult> {
        yield { op: 'draw', count: 1 };
      },
    },
  },
});

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

  it('two consecutive playTopDeck ops both land (no pendingPlay overwrite)', () => {
    const s = draftFireP1();
    const deck = s.players[0].deck;
    const first = deck[deck.length - 1]; // 栈顶效果先结算 → 先 pop 先落地（目标线底层）
    const second = deck[deck.length - 2];
    s.pendingEffects.push(
      {
        id: 'e1', player: 0,
        gen: (function* (): Generator<EffectStep, void, StepResult> {
          yield { op: 'playTopDeck', line: 1, faceUp: false };
        })(),
        sourceUid: 'src1', sourceDefId: 'system', system: true, prompt: null, lastAnswer: null,
      },
      {
        id: 'e2', player: 0,
        gen: (function* (): Generator<EffectStep, void, StepResult> {
          yield { op: 'playTopDeck', line: 1, faceUp: false };
        })(),
        sourceUid: 'src2', sourceDefId: 'system', system: true, prompt: null, lastAnswer: null,
      },
    );
    runStack(s);
    expect(s.pendingPlay).toBeNull();
    expect(s.players[0].stacks[1].map((c) => c.uid)).toEqual([first.uid, second.uid]);
    expect(s.players[0].deck.length).toBe(11);
  });

  it('resolves before-covered trigger of the target top before landing', () => {
    const s = draftFireP1();
    const top = makeCard('pdeck-bc', 0, 'field', true, 0, 0);
    s.players[0].stacks[0] = [top];
    const handBefore = s.players[0].hand.length;
    const deckTop = s.players[0].deck[s.players[0].deck.length - 1];
    s.pendingEffects.push({
      id: 'e1', player: 0,
      gen: (function* (): Generator<EffectStep, void, StepResult> {
        yield { op: 'playTopDeck', line: 0, faceUp: false };
      })(),
      sourceUid: 'src', sourceDefId: 'system', system: true, prompt: null, lastAnswer: null,
    });
    runStack(s);
    // "被盖住前"触发在落地前结算（抽 1 生效），随后落地卡盖在顶卡之上
    expect(s.players[0].hand).toHaveLength(handBefore + 1);
    expect(s.players[0].stacks[0].map((c) => c.uid)).toEqual([top.uid, deckTop.uid]);
    expect(s.pendingPlay).toBeNull();
  });
});
