import { describe, it, expect } from 'vitest';
import type { EffectStep, StepResult } from '../../src/core/models/types';
import { runStack } from '../../src/core/effects/resolve';
import { registerCardEffects } from '../../src/core/effects/registry';
import { makeCard, draftFireP1, advanceToStep, pickFirst, resolveAllChoices } from '../helpers';

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
    expect(s.pendingPlay).toHaveLength(0);
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
    expect(s.pendingPlay).toHaveLength(0);
  });

  it('deferred playTopDeck is queued: a play during the before-covered window lands both cards', () => {
    const s = draftFireP1();
    const fire0 = makeCard('fire-0', 0, 'field', true, 0, 0);
    s.players[0].stacks[0] = [fire0];
    const deck = s.players[0].deck;
    const c1 = deck[deck.length - 1]; // 先结算的 g1 先 pop → 先落地（盖在 fire-0 上）
    function* g1(): Generator<EffectStep, void, StepResult> {
      yield { op: 'playTopDeck', line: 0, faceUp: false };
    }
    function* g2(): Generator<EffectStep, void, StepResult> {
      yield { op: 'playTopDeck', line: 1, faceUp: false };
    }
    // 先入 g2、后入 g1 → g1（触发挂起）先结算；g2 在挂起窗口内执行（旧实现覆盖槽位 → c1 丢失）
    s.pendingEffects.push(
      { id: 'e1', player: 0, gen: g2(), sourceUid: 'src1', sourceDefId: 'system', system: true, prompt: null, lastAnswer: null },
      { id: 'e2', player: 0, gen: g1(), sourceUid: 'src2', sourceDefId: 'system', system: true, prompt: null, lastAnswer: null },
    );
    runStack(s);
    resolveAllChoices(s, pickFirst); // fire-0 触发（抽1+翻转选择）应答；触发抽 1 消耗了牌库顶
    expect(c1.zone).toBe('field'); // 未被挂起窗口内的后续 playTopDeck 覆盖丢失
    expect(s.players[0].stacks[0].map((c) => c.uid)).toEqual([fire0.uid, c1.uid]);
    expect(s.players[0].stacks[1]).toHaveLength(1); // g2 的牌也落地（身份被触发抽牌改变，只断数量）
    expect(s.players[0].deck).toHaveLength(10); // 13 − 两次 playTopDeck pop − 触发抽 1
    expect(s.pendingPlay).toHaveLength(0);
    expect(s.players[0].stacks.flat()).toHaveLength(3); // fire-0 + 两张落地，无浮空残留
  });
});
