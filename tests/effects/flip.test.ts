import { describe, it, expect } from 'vitest';
import type { GameState, EffectStep, StepResult } from '../../src/core/models/types';
import { registerCardEffects } from '../../src/core/effects/registry';
import { runStack, answerEffect } from '../../src/core/effects/resolve';
import { makeCard, pickFirst, resolveAllChoices } from '../helpers';
import { createGame } from '../../src/core/state/create';

// 注册合成卡：翻正后中指令抽 1 张
registerCardEffects('test-flip', {
  middle: function* (): Generator<EffectStep, void, StepResult> {
    yield { op: 'draw', count: 1 };
  },
});

function base(): GameState {
  const s = createGame();
  s.phase = 'turn';
  // 效果源卡：sourceValid 要求源卡在场正面未覆盖（runner.test.ts 同款约定）
  s.players[0].stacks[1] = [{
    uid: 'src', defId: 'test-flip', owner: 0, faceUp: true, zone: 'field', line: 1, pos: 0,
  }];
  s.players[0].stacks[0] = [
    makeCard('test-flip', 0, 'field', true, 0, 0),
    makeCard('test-flip', 0, 'field', false, 0, 1),
  ];
  // 中指令 draw 需要牌库有牌
  s.players[0].deck = [makeCard('test-flip', 0, 'deck'), makeCard('test-flip', 0, 'deck')];
  return s;
}

describe('flip op', () => {
  it('flips a face-down card face-up and resolves its middle (LIFO before outer effect)', () => {
    const s = base();
    const order: string[] = [];
    function* outer(): Generator<EffectStep, void, StepResult> {
      yield { op: 'flip', uid: s.players[0].stacks[0][1].uid };
      order.push('outer-after-flip');
    }
    s.pendingEffects.push({ id: 'e1', player: 0, gen: outer(), sourceUid: 'src', sourceDefId: 'test', prompt: null, lastAnswer: null });
    runStack(s);
    // flip 翻正 → test-flip 中指令入栈 → 先结算（draw 1）→ 外层继续
    expect(order).toEqual(['outer-after-flip']);
    expect(s.players[0].hand).toHaveLength(1);
    expect(s.players[0].stacks[0][1].faceUp).toBe(true);
  });

  it('rejects flipping a covered card', () => {
    const s = base();
    function* outer(): Generator<EffectStep, void, StepResult> {
      yield { op: 'flip', uid: s.players[0].stacks[0][0].uid }; // 底层被覆盖
    }
    s.pendingEffects.push({ id: 'e1', player: 0, gen: outer(), sourceUid: 'src', sourceDefId: 'test', prompt: null, lastAnswer: null });
    expect(() => runStack(s)).toThrow(/covered/);
  });

  it('flipping a secret face-down card face-up clears secret (翻开即解禁)', () => {
    const s = createGame();
    s.phase = 'turn';
    s.players[0].stacks[1] = [{
      uid: 'src', defId: 'test-flip', owner: 0, faceUp: true, zone: 'field', line: 1, pos: 0,
    }];
    const secretCard = makeCard('test-flip', 0, 'field', false, 0, 1);
    secretCard.secret = true; // 牌堆来源的反面打出卡
    s.players[0].stacks[0] = [makeCard('test-flip', 0, 'field', true, 0, 0), secretCard];
    s.players[0].deck = [makeCard('test-flip', 0, 'deck'), makeCard('test-flip', 0, 'deck')]; // 中指令 draw 用
    function* outer(): Generator<EffectStep, void, StepResult> {
      yield { op: 'flip', uid: secretCard.uid };
    }
    s.pendingEffects.push({ id: 'e1', player: 0, gen: outer(), sourceUid: 'src', sourceDefId: 'test', prompt: null, lastAnswer: null });
    runStack(s);
    expect(secretCard.faceUp).toBe(true);
    expect(secretCard.secret).toBeFalsy();
  });

  it('flipping a secret card face-down on the field keeps secret (field card: only a face-up flip declassifies; hand entry declassifies too)', () => {
    const s = createGame();
    s.phase = 'turn';
    s.players[0].stacks[1] = [{
      uid: 'src', defId: 'test-flip', owner: 0, faceUp: true, zone: 'field', line: 1, pos: 0,
    }];
    const secretCard = makeCard('test-flip', 0, 'field', true, 0, 1);
    secretCard.secret = true;
    s.players[0].stacks[0] = [makeCard('test-flip', 0, 'field', true, 0, 0), secretCard];
    s.players[0].deck = [makeCard('test-flip', 0, 'deck')];
    function* outer(): Generator<EffectStep, void, StepResult> {
      yield { op: 'flip', uid: secretCard.uid };
    }
    s.pendingEffects.push({ id: 'e1', player: 0, gen: outer(), sourceUid: 'src', sourceDefId: 'test', prompt: null, lastAnswer: null });
    runStack(s);
    expect(secretCard.faceUp).toBe(false);
    expect(secretCard.secret).toBe(true); // 翻回反面：仍为秘密
  });
});
