import { describe, it, expect } from 'vitest';
import type { EffectStep, StepResult } from '../../src/core/models/types';
import { runStack } from '../../src/core/effects/resolve';
import { registerCardEffects } from '../../src/core/effects/registry';
import { makeCard, draftFireP1 } from '../helpers';

// 被盖住前触发：抽 1 张（playFromHand 落地顺序守卫用）
registerCardEffects('ph-bc', {
  triggers: {
    'before-covered': {
      optional: false,
      fn: function* (): Generator<EffectStep, void, StepResult> {
        yield { op: 'draw', count: 1 };
      },
    },
  },
});

describe('playFromHand op', () => {
  it('takes a chosen hand card and lands it face-down in the line', () => {
    const s = draftFireP1();
    const hc = makeCard('water-1', 0, 'hand');
    s.players[0].hand.push(hc);
    s.pendingEffects.push({
      id: 'e1', player: 0,
      gen: (function* (): Generator<EffectStep, void, StepResult> {
        yield { op: 'playFromHand', uid: hc.uid, line: 1, faceUp: false };
      })(),
      sourceUid: 'src', sourceDefId: 'system', system: true, prompt: null, lastAnswer: null,
    });
    runStack(s);
    expect(s.players[0].hand.map((c) => c.uid)).not.toContain(hc.uid); // 离开手牌
    expect(hc.zone).toBe('field');
    expect(hc.line).toBe(1);
    expect(hc.faceUp).toBe(false);
    expect(s.players[0].stacks[1].map((c) => c.uid)).toContain(hc.uid);
    expect(s.pendingPlay).toHaveLength(0);
  });

  it('resolves before-covered trigger of the target top before a face-up hand card lands', () => {
    const s = draftFireP1();
    const top = makeCard('ph-bc', 0, 'field', true, 0, 0);
    s.players[0].stacks[0] = [top];
    const hc = makeCard('water-1', 0, 'hand');
    s.players[0].hand.push(hc);
    const handBefore = s.players[0].hand.length; // 含 hc
    const deckBefore = s.players[0].deck.length;
    s.pendingEffects.push({
      id: 'e1', player: 0,
      gen: (function* (): Generator<EffectStep, void, StepResult> {
        yield { op: 'playFromHand', uid: hc.uid, line: 0, faceUp: true };
      })(),
      sourceUid: 'src', sourceDefId: 'system', system: true, prompt: null, lastAnswer: null,
    });
    runStack(s);
    // "被盖住前"触发在落地前结算（抽 1 生效），随后手牌落地盖在顶卡之上
    expect(s.players[0].hand).toHaveLength(handBefore); // −hc +触发抽 1
    expect(s.players[0].deck).toHaveLength(deckBefore - 1);
    expect(s.players[0].stacks[0].map((c) => c.uid)).toEqual([top.uid, hc.uid]);
    expect(hc.faceUp).toBe(true);
    expect(s.pendingPlay).toHaveLength(0);
  });

  it('two consecutive playFromHand ops both land (no pendingPlay overwrite)', () => {
    const s = draftFireP1();
    const h1 = makeCard('water-1', 0, 'hand');
    const h2 = makeCard('water-2', 0, 'hand');
    s.players[0].hand.push(h1, h2);
    const handBefore = s.players[0].hand.length;
    s.pendingEffects.push(
      {
        id: 'e1', player: 0,
        gen: (function* (): Generator<EffectStep, void, StepResult> {
          yield { op: 'playFromHand', uid: h1.uid, line: 1, faceUp: false };
        })(),
        sourceUid: 'src1', sourceDefId: 'system', system: true, prompt: null, lastAnswer: null,
      },
      {
        id: 'e2', player: 0,
        gen: (function* (): Generator<EffectStep, void, StepResult> {
          yield { op: 'playFromHand', uid: h2.uid, line: 1, faceUp: false };
        })(),
        sourceUid: 'src2', sourceDefId: 'system', system: true, prompt: null, lastAnswer: null,
      },
    );
    runStack(s);
    expect(s.pendingPlay).toHaveLength(0);
    // 效果栈 LIFO：后入栈的 e2 先结算（先移出手牌先落地 → 目标线底层），与 playTopDeck 语义一致
    expect(s.players[0].stacks[1].map((c) => c.uid)).toEqual([h2.uid, h1.uid]);
    expect(s.players[0].hand).toHaveLength(handBefore - 2);
  });
});
