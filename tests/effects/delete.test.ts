import { describe, it, expect } from 'vitest';
import type { GameState, EffectStep, StepResult } from '../../src/core/models/types';
import { registerCardEffects } from '../../src/core/effects/registry';
import { runStack } from '../../src/core/effects/resolve';
import { makeCard } from '../helpers';
import { createGame } from '../../src/core/state/create';

registerCardEffects('test-reveal', {
  middle: function* (): Generator<EffectStep, void, StepResult> {
    yield { op: 'draw', count: 1 };
  },
});

function base(): GameState {
  const s = createGame();
  s.phase = 'turn';
  s.players[0].stacks[0] = [
    makeCard('test-reveal', 0, 'field', true, 0, 0), // 底层：被揭开 → 中指令
    makeCard('fire-1', 0, 'field', true, 0, 1),      // 顶层：被删除
  ];
  // 效果源卡 'src'（sourceValid 要求在场且未覆盖；放独立线）
  s.players[0].stacks[1] = [{ uid: 'src', defId: 'test-reveal', owner: 0, faceUp: true, zone: 'field', line: 1, pos: 0 }];
  // 露出卡中指令 draw 需要牌库有牌
  s.players[0].deck = [makeCard('test-reveal', 0, 'deck'), makeCard('test-reveal', 0, 'deck')];
  return s;
}

describe('delete/return ops with reveal', () => {
  it('delete removes top card and reveals the card below (middle resolves)', () => {
    const s = base();
    function* gen(): Generator<EffectStep, void, StepResult> {
      yield { op: 'delete', uid: s.players[0].stacks[0][1].uid };
    }
    s.pendingEffects.push({ id: 'e1', player: 0, gen: gen(), sourceUid: 'src', sourceDefId: 'test', prompt: null, lastAnswer: null });
    runStack(s);
    expect(s.players[0].stacks[0]).toHaveLength(1);
    expect(s.players[0].trash.map((c) => c.defId)).toEqual(['fire-1']);
    expect(s.players[0].hand).toHaveLength(1); // 露出卡中指令 draw 1
  });

  it('return moves top card to owner hand (reveals below)', () => {
    const s = base();
    function* gen(): Generator<EffectStep, void, StepResult> {
      yield { op: 'return', uid: s.players[0].stacks[0][1].uid };
    }
    s.pendingEffects.push({ id: 'e1', player: 0, gen: gen(), sourceUid: 'src', sourceDefId: 'test', prompt: null, lastAnswer: null });
    runStack(s);
    expect(s.players[0].hand).toHaveLength(2); // 回手 1 + 露出卡 draw 1
    expect(s.players[0].stacks[0]).toHaveLength(1);
  });

  it('reveal does not trigger when the card below is face-down', () => {
    const s = createGame();
    s.phase = 'turn';
    s.players[0].stacks[0] = [
      makeCard('test-reveal', 0, 'field', false, 0, 0), // 反面：不触发
      makeCard('fire-1', 0, 'field', true, 0, 1),
    ];
    // 效果源卡 'src'
    s.players[0].stacks[1] = [{ uid: 'src', defId: 'test-reveal', owner: 0, faceUp: true, zone: 'field', line: 1, pos: 0 }];
    function* gen(): Generator<EffectStep, void, StepResult> {
      yield { op: 'delete', uid: s.players[0].stacks[0][1].uid };
    }
    s.pendingEffects.push({ id: 'e1', player: 0, gen: gen(), sourceUid: 'src', sourceDefId: 'test', prompt: null, lastAnswer: null });
    runStack(s);
    expect(s.players[0].hand).toHaveLength(0);
  });
});
