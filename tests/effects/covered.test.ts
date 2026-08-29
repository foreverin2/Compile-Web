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
    expect(all.some((c) => c.pos === 1)).toBe(false); // 顶卡不列出（covered 仅覆盖卡）
  });

  it('shift with allowCovered moves a covered card', () => {
    const s = draftFireP1();
    s.players[1].stacks[0] = [makeCard('water-1', 1, 'field', true, 0, 0), makeCard('water-2', 1, 'field', true, 0, 1)];
    const covered = s.players[1].stacks[0][0];
    const top = s.players[1].stacks[0][1];
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
    // 源堆叠剩下的是顶卡（未被误移除）
    expect(s.players[1].stacks[0][0].uid).toBe(top.uid);
    // 被平移卡不再出现在源堆叠（无重复对象）
    expect(s.players[1].stacks[0].some((c) => c.uid === covered.uid)).toBe(false);
  });

  it('delete with allowCovered removes a covered card, top stays on field', () => {
    const s = draftFireP1();
    s.players[1].stacks[0] = [makeCard('water-1', 1, 'field', true, 0, 0), makeCard('water-2', 1, 'field', true, 0, 1)];
    const covered = s.players[1].stacks[0][0];
    const top = s.players[1].stacks[0][1];
    s.pendingEffects.push({
      id: 'e1', player: 0,
      gen: (function* (): Generator<EffectStep, void, StepResult> {
        yield { op: 'delete', uid: covered.uid, allowCovered: true };
      })(),
      sourceUid: 'src', sourceDefId: 'system', system: true, prompt: null, lastAnswer: null,
    });
    runStack(s);
    expect(covered.zone).toBe('trash'); // 目标卡进墓地
    expect(s.players[1].stacks[0]).toHaveLength(1);
    expect(s.players[1].stacks[0][0].uid).toBe(top.uid); // 顶卡仍在源堆叠
    expect(s.players[1].trash.some((c) => c.uid === covered.uid)).toBe(true);
  });

  it('return with allowCovered returns a covered card, top stays on field', () => {
    const s = draftFireP1();
    s.players[1].stacks[0] = [makeCard('water-1', 1, 'field', true, 0, 0), makeCard('water-2', 1, 'field', true, 0, 1)];
    const covered = s.players[1].stacks[0][0];
    const top = s.players[1].stacks[0][1];
    s.pendingEffects.push({
      id: 'e1', player: 0,
      gen: (function* (): Generator<EffectStep, void, StepResult> {
        yield { op: 'return', uid: covered.uid, allowCovered: true };
      })(),
      sourceUid: 'src', sourceDefId: 'system', system: true, prompt: null, lastAnswer: null,
    });
    runStack(s);
    expect(covered.zone).toBe('hand'); // 目标卡回手
    expect(s.players[1].stacks[0]).toHaveLength(1);
    expect(s.players[1].stacks[0][0].uid).toBe(top.uid); // 顶卡仍在源堆叠
    expect(s.players[1].hand.some((c) => c.uid === covered.uid)).toBe(true);
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
