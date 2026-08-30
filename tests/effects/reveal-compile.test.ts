import { describe, it, expect } from 'vitest';
import type { EffectStep, StepResult } from '../../src/core/models/types';
import { gameBus } from '../../src/core/events/bus';
import { executeAction } from '../../src/core/game';
import { runStack } from '../../src/core/effects/resolve';
import { makeCard, draftFireP1, advanceToStep } from '../helpers';

/**
 * 揭示幽灵牌的两个用例（turn-count 过期语义）：
 * - Case A —— 把自己的卡/手牌揭示给对手看：ghost shownTo = 对手；
 *   在对手回合结束时清除（= 揭示发生的第 2 次回合结束转换）。
 * - Case B —— 把对手的卡/手牌揭示给自己看（如 light-4）：ghost shownTo = 发起者（caster）；
 *   在发起者【下一个】回合结束时清除（= 第 3 次回合结束转换），而不是对手回合结束。
 */
describe('reveal op + revealed ghosts', () => {
  it('Case A: revealing the caster OWN card shows the ghost to the OPPONENT, expiresAtTurn = count + 2', () => {
    const s = draftFireP1();
    s.phase = 'turn';
    s.turnPlayer = 0;
    s.players[0].hand.push({ uid: 'target-1', defId: 'fire-2', owner: 0, faceUp: true, zone: 'hand', line: null, pos: null });
    const ownCard = s.players[0].hand[s.players[0].hand.length - 1];
    s.pendingEffects.push({
      id: 'e1',
      player: 0,
      gen: (function* (): Generator<EffectStep, void, StepResult> {
        yield { op: 'reveal', uid: ownCard.uid };
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
    expect(s.revealedGhosts[0].shownTo).toBe(1); // 自己的牌 → 幽灵给对手看
    expect(s.revealedGhosts[0].expiresAtTurn).toBe(s.turnCount + 2); // 对手回合结束（第 2 次转换）
    // 原卡不受影响
    expect(s.players[0].hand.some((c) => c.uid === ownCard.uid)).toBe(true);
  });

  it('Case B: revealing the OPPONENT card shows the ghost to the CASTER, expiresAtTurn = count + 3', () => {
    const s = draftFireP1();
    s.phase = 'turn';
    s.turnPlayer = 0;
    const oppCard = s.players[1].hand[0];
    s.pendingEffects.push({
      id: 'e1',
      player: 0,
      gen: (function* (): Generator<EffectStep, void, StepResult> {
        yield { op: 'reveal', uid: oppCard.uid };
      })(),
      sourceUid: 'src',
      sourceDefId: 'system',
      system: true,
      prompt: null,
      lastAnswer: null,
    });
    runStack(s);
    expect(s.revealedGhosts).toHaveLength(1);
    expect(s.revealedGhosts[0].defId).toBe(oppCard.defId);
    expect(s.revealedGhosts[0].shownTo).toBe(0); // 对手的牌 → 幽灵给自己（发起者）看
    expect(s.revealedGhosts[0].expiresAtTurn).toBe(s.turnCount + 3); // 发起者下回合结束（第 3 次转换）
    // 原卡不受影响
    expect(s.players[1].hand.some((c) => c.uid === oppCard.uid)).toBe(true);
  });

  it('Case A ghost survives the caster turn end and is cleared at the OPPONENT turn end', () => {
    const s = draftFireP1();
    s.phase = 'turn';
    // P1 揭示自己的卡 → 幽灵 shownTo=1、expiresAtTurn=2（对手回合结束 = 第 2 次转换）
    s.turnPlayer = 0;
    s.revealedGhosts = [{ id: 'g1', defId: 'fire-2', shownTo: 1, expiresAtTurn: s.turnCount + 2 }];
    // P1 回合进行中
    advanceToStep(s, 0, 'check-cache');
    executeAction(s, 0, 'advance'); // check-cache → end（幽灵仍在）
    executeAction(s, 0, 'advance'); // end → start（换 P2，计数 1）→ P1 回合结束，幽灵存活
    expect(s.turnPlayer).toBe(1);
    expect(s.turnCount).toBe(1);
    expect(s.revealedGhosts).toHaveLength(1);
    // P2（对手）整回合进行中
    advanceToStep(s, 1, 'check-cache');
    executeAction(s, 1, 'advance'); // check-cache → end（幽灵仍在，对手回合期间可见）
    expect(s.revealedGhosts).toHaveLength(1);
    executeAction(s, 1, 'advance'); // end → start（换回 P1，计数 2）→ 对手回合结束 → Case A 清除
    expect(s.turnPlayer).toBe(0);
    expect(s.turnCount).toBe(2);
    expect(s.revealedGhosts).toHaveLength(0);
  });

  it('Case B ghost survives caster turn end + whole opponent turn, cleared at the caster NEXT turn end', () => {
    const s = draftFireP1();
    s.phase = 'turn';
    // P1 揭示对手卡 → 幽灵 shownTo=0、expiresAtTurn=3（发起者下回合结束 = 第 3 次转换）
    s.turnPlayer = 0;
    s.revealedGhosts = [{ id: 'g1', defId: 'fire-2', shownTo: 0, expiresAtTurn: s.turnCount + 3 }];
    // P1 回合进行中
    advanceToStep(s, 0, 'check-cache');
    executeAction(s, 0, 'advance'); // check-cache → end（幽灵仍在）
    executeAction(s, 0, 'advance'); // end → start（换 P2，计数 1）→ P1 回合结束，幽灵存活
    expect(s.turnPlayer).toBe(1);
    expect(s.turnCount).toBe(1);
    expect(s.revealedGhosts).toHaveLength(1);
    // P2（对手）整回合进行中
    advanceToStep(s, 1, 'check-cache');
    executeAction(s, 1, 'advance'); // check-cache → end（幽灵仍在）
    executeAction(s, 1, 'advance'); // end → start（换回 P1，计数 2）→ P2 回合结束，Case B 仍存活
    expect(s.turnPlayer).toBe(0);
    expect(s.turnCount).toBe(2);
    expect(s.revealedGhosts).toHaveLength(1);
    // P1 下一个回合进行中（幽灵仍可见）→ 该回合结束（计数 3）→ Case B 清除
    advanceToStep(s, 0, 'check-cache');
    executeAction(s, 0, 'advance'); // check-cache → end（幽灵仍在 P1 下回合期间可见）
    expect(s.revealedGhosts).toHaveLength(1);
    executeAction(s, 0, 'advance'); // end → start（换 P2，计数 3）→ P1 下回合结束 → 幽灵清除
    expect(s.turnPlayer).toBe(1);
    expect(s.turnCount).toBe(3);
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
