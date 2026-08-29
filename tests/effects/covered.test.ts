import { describe, it, expect } from 'vitest';
import type { EffectStep, StepResult } from '../../src/core/models/types';
import { listCandidates } from '../../src/core/effects/context';
import { runStack } from '../../src/core/effects/resolve';
import { makeCard, draftFireP1 } from '../helpers';

describe('covered targeting', () => {
  it('listCandidates with covered:true includes covered cards', () => {
    const s = draftFireP1();
    s.players[1].stacks[0] = [makeCard('water-1', 1, 'field', true, 0, 0), makeCard('water-2', 1, 'field', true, 0, 1)];
    const all = listCandidates(s, { zone: 'field', covered: true });
    expect(all.some((c) => c.pos === 0)).toBe(true); // 被覆盖的底层也列出
  });

  it('shift with allowCovered moves a covered card (fizzles if none covered)', () => {
    const s = draftFireP1();
    s.players[1].stacks[0] = [makeCard('water-1', 1, 'field', true, 0, 0), makeCard('water-2', 1, 'field', true, 0, 1)];
    const covered = s.players[1].stacks[0][0];
    s.pendingEffects.push({
      id: 'e1', player: 0,
      gen: (function* (): Generator<EffectStep, void, StepResult> {
        yield { op: 'shift', uid: covered.uid, targetLine: 1, allowCovered: true };
      })(),
      sourceUid: 'src', sourceDefId: 'system', system: true, prompt: null, lastAnswer: null,
    });
    runStack(s);
    expect(covered.zone).toBe('field');
    expect(covered.line).toBe(1);
    expect(s.players[1].stacks[0]).toHaveLength(1);
    expect(s.players[1].stacks[1]).toHaveLength(1);
  });

  it('select with covered candidates empty fizzles (no deadlock)', () => {
    const s = draftFireP1();
    s.players[1].stacks[0] = [makeCard('water-1', 1, 'field', true, 0, 0)]; // 无被覆盖卡
    let ran = false;
    s.pendingEffects.push({
      id: 'e1', player: 0,
      gen: (function* (): Generator<EffectStep, void, StepResult> {
        const c = yield { kind: 'select', title: 't', min: 1, max: 1, optional: false, candidates: listCandidates(s, { zone: 'field', covered: true, owner: 1 }) };
        ran = true;
        void c;
      })(),
      sourceUid: 'src', sourceDefId: 'system', system: true, prompt: null, lastAnswer: null,
    });
    runStack(s);
    expect(s.pendingEffects).toHaveLength(0);
    expect(ran).toBe(true); // 空候选被 fizzle 跳过 = runStack 以 {selected:[]} 续接生成器（不挂起）；生成器守卫空应答后自行结束，效果栈排空（无死锁）
  });
});
