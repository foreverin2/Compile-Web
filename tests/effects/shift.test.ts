import { describe, it, expect } from 'vitest';
import type { GameState, EffectStep, StepResult } from '../../src/core/models/types';
import { registerCardEffects } from '../../src/core/effects/registry';
import { runStack } from '../../src/core/effects/resolve';
import { makeCard, pickFirst, resolveAllChoices } from '../helpers';
import { createGame } from '../../src/core/state/create';

registerCardEffects('test-reveal', {
  middle: function* (): Generator<EffectStep, void, StepResult> {
    yield { op: 'draw', count: 1 };
  },
});

describe('shift op (float state machine)', () => {
  it('shifts top card to target line: float -> reveal below -> land on target', () => {
    const s = createGame();
    s.phase = 'turn';
    s.players[0].stacks[0] = [
      makeCard('test-reveal', 0, 'field', true, 0, 0), // 露出 → 中指令 draw 1
      makeCard('fire-1', 0, 'field', true, 0, 1),      // 被偏转
    ];
    // 效果源卡 'src'（放独立线，不被偏转影响；目标线 1 必须为空才能按断言落地）
    s.players[0].stacks[2] = [{ uid: 'src', defId: 'test-reveal', owner: 0, faceUp: true, zone: 'field', line: 2, pos: 0 }];
    // 露出卡中指令 draw 需要牌库有牌
    s.players[0].deck = [makeCard('test-reveal', 0, 'deck'), makeCard('test-reveal', 0, 'deck')];
    const shifted = s.players[0].stacks[0][1];
    function* gen(): Generator<EffectStep, void, StepResult> {
      yield { op: 'shift', uid: shifted.uid, targetLine: 1 };
    }
    s.pendingEffects.push({ id: 'e1', player: 0, gen: gen(), sourceUid: 'src', sourceDefId: 'test', prompt: null, lastAnswer: null });
    runStack(s);
    expect(s.pendingShift).toHaveLength(0);
    expect(shifted.zone).toBe('field');
    expect(s.players[0].stacks[1].map((c) => c.uid)).toEqual([shifted.uid]);
    expect(s.players[0].stacks[0]).toHaveLength(1);
    expect(s.players[0].hand).toHaveLength(1); // 露出卡中指令已结算
  });

  it('rejects shift to the same line and shift of a covered card', () => {
    const s = createGame();
    s.phase = 'turn';
    s.players[0].stacks[0] = [
      makeCard('test-reveal', 0, 'field', true, 0, 0),
      makeCard('fire-1', 0, 'field', true, 0, 1),
    ];
    // 效果源卡 'src'
    s.players[0].stacks[1] = [{ uid: 'src', defId: 'test-reveal', owner: 0, faceUp: true, zone: 'field', line: 1, pos: 0 }];
    const covered = s.players[0].stacks[0][0];
    function* gen1(): Generator<EffectStep, void, StepResult> {
      yield { op: 'shift', uid: covered.uid, targetLine: 1 }; // 被覆盖卡不可偏转
    }
    s.pendingEffects.push({ id: 'e1', player: 0, gen: gen1(), sourceUid: 'src', sourceDefId: 'test', prompt: null, lastAnswer: null });
    expect(() => runStack(s)).toThrow(/covered/);
  });

  it('deferred shift is queued: a shift during the before-covered window does not strand the first card', () => {
    const s = createGame();
    s.phase = 'turn';
    // X 平移到目标线 1（顶卡 fire-0 有"被盖住前"→ 落地挂起窗口）；Y 在窗口内平移到线 0（X 移走后为空）
    const fire0 = makeCard('fire-0', 0, 'field', true, 1, 0);
    s.players[0].stacks[1] = [fire0];
    const x = makeCard('light-1', 0, 'field', true, 0, 0);
    s.players[0].stacks[0] = [x];
    const y = makeCard('light-2', 0, 'field', true, 2, 0);
    s.players[0].stacks[2] = [y];
    function* gx(): Generator<EffectStep, void, StepResult> {
      yield { op: 'shift', uid: x.uid, targetLine: 1 };
    }
    function* gy(): Generator<EffectStep, void, StepResult> {
      yield { op: 'shift', uid: y.uid, targetLine: 0 };
    }
    // 先入 gy、后入 gx → gx（触发挂起的平移）先结算；gy 在挂起窗口内执行（旧实现覆盖槽位 → X 丢失）
    s.pendingEffects.push(
      { id: 'e1', player: 0, gen: gy(), sourceUid: 'src1', sourceDefId: 'system', system: true, prompt: null, lastAnswer: null },
      { id: 'e2', player: 0, gen: gx(), sourceUid: 'src2', sourceDefId: 'system', system: true, prompt: null, lastAnswer: null },
    );
    runStack(s);
    resolveAllChoices(s, pickFirst); // fire-0 触发（抽1+翻转选择）应答；翻转候选只剩 Y
    expect(x.zone).toBe('field'); // 未被挂起窗口内的后续 shift 覆盖丢失
    expect(x.line).toBe(1);
    expect(y.zone).toBe('field');
    expect(y.line).toBe(0);
    expect(s.players[0].stacks[1].map((c) => c.uid)).toEqual([fire0.uid, x.uid]);
    expect(s.players[0].stacks[0].map((c) => c.uid)).toEqual([y.uid]);
    expect(s.pendingShift).toHaveLength(0);
    const onField = s.players[0].stacks.flat();
    expect(onField.map((c) => c.uid).sort()).toEqual([fire0.uid, x.uid, y.uid].sort());
  });
});
