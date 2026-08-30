import { describe, it, expect } from 'vitest';
import type { EffectStep, StepResult } from '../../src/core/models/types';
import { gameBus } from '../../src/core/events/bus';
import { executeAction } from '../../src/core/game';
import { runStack } from '../../src/core/effects/resolve';
import { makeCard, draftFireP1, advanceToStep } from '../helpers';

describe('reveal op + revealed ghosts', () => {
  it('reveal op adds a ghost shown to the caster, expiring at the END of the NEXT turn (opponent turn end)', () => {
    const s = draftFireP1();
    s.players[0].hand.push({ uid: 'target-1', defId: 'fire-2', owner: 0, faceUp: true, zone: 'hand', line: null, pos: null });
    s.pendingEffects.push({
      id: 'e1',
      player: 0,
      gen: (function* (): Generator<EffectStep, void, StepResult> {
        yield { op: 'reveal', uid: 'target-1' };
      })(),
      sourceUid: 'src',
      sourceDefId: 'system',
      system: true,
      prompt: null,
      lastAnswer: null,
    });
    runStack(s);
    expect(s.revealedGhosts).toHaveLength(1);
    expect(s.revealedGhosts[0].defId).toBe('fire-2');
    expect(s.revealedGhosts[0].shownTo).toBe(0); // 幽灵归揭示发起方（效果属主）手牌区
    expect(s.revealedGhosts[0].expiresAfterTurn).toBe(1); // 下回合回合结束 = 对手（P2）回合结束
    // 原卡不受影响
    expect(s.players[0].hand.some((c) => c.uid === 'target-1')).toBe(true);
  });

  it('revealed ghosts survive the caster turn end and are cleared at the next turn end (opponent turn end)', () => {
    const s = draftFireP1();
    s.phase = 'turn';
    // P1 揭示对手卡 → 幽灵 shownTo=0、expiresAfterTurn=1（下回合回合结束 = P2 回合结束）
    s.revealedGhosts = [{ id: 'g1', defId: 'fire-2', shownTo: 0, expiresAfterTurn: 1 }];
    // P1 回合进行中
    s.turnPlayer = 0;
    advanceToStep(s, 0, 'check-cache');
    executeAction(s, 0, 'advance'); // check-cache → end（幽灵仍在）
    executeAction(s, 0, 'advance'); // end → start（换 P2）→ P1 回合结束，幽灵存活
    expect(s.turnPlayer).toBe(1);
    expect(s.revealedGhosts).toHaveLength(1);
    // P2（对手）整回合进行中
    advanceToStep(s, 1, 'check-cache');
    executeAction(s, 1, 'advance'); // check-cache → end（幽灵仍在）
    executeAction(s, 1, 'advance'); // end → start（换回 P1）→ P2 回合结束 → 幽灵清除
    expect(s.turnPlayer).toBe(0);
    expect(s.revealedGhosts).toHaveLength(0);
  });
});

describe('compile line:compiled event', () => {
  it('emits line:compiled with top-to-bottom uids for both sides and the protocol defId', () => {
    const s = draftFireP1();
    advanceToStep(s, 0, 'check-compile');
    const bottom = makeCard('fire-5', 0, 'field', true, 0, 0);
    const top = makeCard('fire-5', 0, 'field', true, 0, 1);
    s.players[0].stacks[0] = [bottom, top];
    const opp = makeCard('water-5', 1, 'field', true, 0, 0);
    s.players[1].stacks[0] = [opp];
    const seen: { ownUids: string[]; oppUids: string[]; protocolDefId?: string }[] = [];
    const off = gameBus.subscribe((e) => {
      if (e.type !== 'line:compiled') return;
      const p = e.payload as { ownUids: string[]; oppUids: string[]; protocolDefId?: string };
      seen.push({ ownUids: p.ownUids, oppUids: p.oppUids, protocolDefId: p.protocolDefId });
    });
    executeAction(s, 0, 'compile', { line: 0 });
    off();
    expect(seen).toHaveLength(1);
    expect(seen[0].ownUids).toEqual([top.uid, bottom.uid]); // 顶→底
    expect(seen[0].oppUids).toEqual([opp.uid]);
    expect(seen[0].protocolDefId).toBe('fire');
  });
});
