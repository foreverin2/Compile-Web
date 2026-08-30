import { describe, it, expect } from 'vitest';
import { gameBus } from '../../src/core/events/bus';
import { executeAction } from '../../src/core/game';
import { makeCard, draftDarknessP1, advanceToStep, resolveAllChoices } from '../helpers';
import type { GameState, Line } from '../../src/core/models/types';

/** P1 的 darkness 协议线（草案首选 darkness → 线 0） */
function darknessLine(s: GameState): Line {
  const idx = s.players[0].protocols.findIndex((p) => p.defId === 'darkness');
  return idx as Line;
}

/** 捕获 card:shifted 事件载荷（FX 层据此播烟桥：triggerProtocol === 'darkness'） */
function captureShift(seen: { uid: string; fromLine?: number; triggerProtocol?: string; triggerDefId?: string }[]): () => void {
  return gameBus.subscribe((e) => {
    if (e.type !== 'card:shifted') return;
    const p = e.payload as { uid: string; fromLine?: number; triggerProtocol?: string; triggerDefId?: string };
    seen.push(p);
  });
}

describe('card:shifted payload — darkness smoke-bridge trigger', () => {
  it('darkness-4 shift carries triggerProtocol=darkness + triggerDefId + fromLine', () => {
    const s = draftDarknessP1();
    advanceToStep(s, 0, 'action');
    const fd = makeCard('water-1', 1, 'field', false, 1, 0);
    s.players[1].stacks[1] = [fd];
    s.players[0].hand = [makeCard('darkness-4', 0, 'hand')];
    const card = s.players[0].hand[0];
    const seen: { uid: string; fromLine?: number; triggerProtocol?: string; triggerDefId?: string }[] = [];
    const off = captureShift(seen);
    executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: true, line: darknessLine(s) });
    resolveAllChoices(s, (p) => (p.kind === 'select-line' ? ['line:2'] : [fd.uid]));
    off();
    expect(seen).toHaveLength(1);
    expect(seen[0].uid).toBe(fd.uid);
    expect(seen[0].fromLine).toBe(1); // 平移源线（fd 原在线 1）
    expect(seen[0].triggerProtocol).toBe('darkness'); // 触发卡协议（darkness-4 中指令）
    expect(seen[0].triggerDefId).toBe('darkness-4');
  });

  it('darkness-0 covered-card shift carries triggerProtocol=darkness', () => {
    const s = draftDarknessP1();
    advanceToStep(s, 0, 'action');
    const covered = makeCard('water-1', 1, 'field', true, 1, 0);
    const top = makeCard('water-2', 1, 'field', true, 1, 1);
    s.players[1].stacks[1] = [covered, top];
    s.players[0].hand = [makeCard('darkness-0', 0, 'hand')];
    const card = s.players[0].hand[0];
    const seen: { uid: string; fromLine?: number; triggerProtocol?: string; triggerDefId?: string }[] = [];
    const off = captureShift(seen);
    executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: true, line: darknessLine(s) });
    resolveAllChoices(s, (p) => {
      if (p.kind === 'select') return [covered.uid];
      if (p.kind === 'select-line') return ['line:2'];
      return [];
    });
    off();
    expect(seen).toHaveLength(1);
    expect(seen[0].uid).toBe(covered.uid);
    expect(seen[0].fromLine).toBe(1);
    expect(seen[0].triggerProtocol).toBe('darkness');
    expect(seen[0].triggerDefId).toBe('darkness-0');
  });
});
