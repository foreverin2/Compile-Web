import { describe, it, expect } from 'vitest';
import { gameBus } from '../../src/core/events/bus';
import { executeAction } from '../../src/core/game';
import { makeCard, draftFireP1, draftLightP1, advanceToStep, resolveAllChoices } from '../helpers';
import type { Line } from '../../src/core/models/types';

/** 捕获弃牌/删去事件（含触发卡协议），返回快照 */
function captureDiscardDelete(snapshot: { type: string; triggerProtocol?: string; triggerDefId?: string }[]): () => void {
  return gameBus.subscribe((e) => {
    const p = e.payload as { triggerProtocol?: string; triggerDefId?: string } | undefined;
    if (e.type === 'card:discarded' || e.type === 'card:deleted') {
      snapshot.push({ type: e.type, triggerProtocol: p?.triggerProtocol, triggerDefId: p?.triggerDefId });
    }
  });
}

describe('FX trigger protocol payload', () => {
  it('discard/delete triggered by a fire card carry triggerProtocol=fire (target protocol irrelevant)', () => {
    const s = draftFireP1();
    advanceToStep(s, 0, 'action');
    // fire-1 触发：弃一张水卡（water-3 手牌）、删一张对手水卡（water-1 场上顶卡）
    s.players[0].hand = [makeCard('fire-1', 0, 'hand'), makeCard('water-3', 0, 'hand')];
    s.players[1].stacks[0] = [makeCard('water-1', 1, 'field', true, 0, 0)];
    const victim = s.players[1].stacks[0][0];
    const fire1 = s.players[0].hand.find((c) => c.defId === 'fire-1')!;
    const discardTarget = s.players[0].hand.find((c) => c.defId === 'water-3')!;
    const seen: { type: string; triggerProtocol?: string; triggerDefId?: string }[] = [];
    const off = captureDiscardDelete(seen);
    executeAction(s, 0, 'play', { cardUid: fire1.uid, faceUp: true, line: 0 });
    resolveAllChoices(s, (p) => (p.candidates.some((c) => c.uid === victim.uid) ? [victim.uid] : [discardTarget.uid]));
    off();
    const discarded = seen.find((x) => x.type === 'card:discarded');
    const deleted = seen.find((x) => x.type === 'card:deleted');
    // 触发卡是 fire-1 → triggerProtocol=fire；目标卡是水卡不影响
    expect(discarded?.triggerProtocol).toBe('fire');
    expect(discarded?.triggerDefId).toBe('fire-1');
    expect(deleted?.triggerProtocol).toBe('fire');
  });

  it('cache-clear discard carries triggerProtocol=system (no protocol extra)', () => {
    const s = draftFireP1();
    advanceToStep(s, 0, 'action');
    const extra = makeCard('water-3', 0, 'hand');
    s.players[0].hand.push(extra);
    advanceToStep(s, 0, 'check-cache');
    const seen: { type: string; triggerProtocol?: string; triggerDefId?: string }[] = [];
    const off = captureDiscardDelete(seen);
    executeAction(s, 0, 'clear-cache');
    resolveAllChoices(s, () => [extra.uid]);
    off();
    expect(seen).toHaveLength(1);
    expect(seen[0].triggerProtocol).toBe('system');
    expect(seen[0].triggerDefId).toBe('system');
  });

  it('light-4 reveal payload carries triggerProtocol=light + triggerDefId (FX wings + aura)', () => {
    const s = draftLightP1();
    advanceToStep(s, 0, 'action');
    s.players[0].hand = [makeCard('light-4', 0, 'hand')];
    const card = s.players[0].hand[0];
    const lightLine: Line = s.players[0].protocols.findIndex((p) => p.defId === 'light') as Line;
    const seen: { shownTo?: number; triggerProtocol?: string; triggerDefId?: string }[] = [];
    const off = gameBus.subscribe((e) => {
      if (e.type !== 'card:revealed') return;
      const p = e.payload as { shownTo?: number; triggerProtocol?: string; triggerDefId?: string };
      seen.push(p);
    });
    executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: true, line: lightLine });
    resolveAllChoices(s, () => []); // light-4 无选择步骤，无害
    off();
    expect(seen.length).toBeGreaterThan(0);
    for (const p of seen) {
      expect(p.triggerProtocol).toBe('light'); // 触发卡协议（light-4）
      expect(p.triggerDefId).toBe('light-4');
      expect(p.shownTo).toBe(0); // 对手手牌揭示给自己（发起者）
    }
  });
});
