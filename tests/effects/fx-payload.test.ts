import { describe, it, expect } from 'vitest';
import { gameBus } from '../../src/core/events/bus';
import { executeAction, getLegalActions } from '../../src/core/game';
import { collectTriggers, resolveTrigger } from '../../src/core/effects/triggers';
import { runStack } from '../../src/core/effects/resolve';
import { makeCard, draftFireP1, draftLightP1, draftWaterP1, draftLifeP1, draftLoveP1, advanceToStep, resolveAllChoices, pickFirst } from '../helpers';
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

  it('water-5 discard carries triggerProtocol=water + triggerDefId (FX hook ready)', () => {
    const s = draftWaterP1();
    advanceToStep(s, 0, 'action');
    s.players[0].hand = [makeCard('water-5', 0, 'hand'), makeCard('water-1', 0, 'hand')];
    const water5 = s.players[0].hand.find((c) => c.defId === 'water-5')!;
    const discardTarget = s.players[0].hand.find((c) => c.defId !== 'water-5')!;
    const seen: { type: string; triggerProtocol?: string; triggerDefId?: string }[] = [];
    const off = captureDiscardDelete(seen);
    executeAction(s, 0, 'play', { cardUid: water5.uid, faceUp: true, line: 0 });
    resolveAllChoices(s, () => [discardTarget.uid]);
    off();
    const discarded = seen.find((x) => x.type === 'card:discarded');
    expect(discarded?.triggerProtocol).toBe('water');
    expect(discarded?.triggerDefId).toBe('water-5');
  });

  it('life-0 end self-delete (covered, FAQ 139) carries triggerProtocol=life + triggerDefId (FX hook ready)', () => {
    const s = draftLifeP1();
    advanceToStep(s, 0, 'action');
    const life0 = makeCard('life-0', 0, 'field', true, 1, 0);
    s.players[0].stacks[1] = [life0];
    const played = makeCard('life-5', 0, 'hand');
    s.players[0].hand = [played];
    executeAction(s, 0, 'play', { cardUid: played.uid, faceUp: false, line: 1 }); // 盖住 life-0（end 触发删）
    resolveAllChoices(s, pickFirst);
    advanceToStep(s, 0, 'end');
    const seen: { type: string; triggerProtocol?: string; triggerDefId?: string }[] = [];
    const off = captureDiscardDelete(seen);
    const trig = getLegalActions(s, 0).find((a) => a.kind === 'resolve-trigger');
    executeAction(s, 0, 'resolve-trigger', { cardUid: trig!.cardUid! });
    off();
    const deleted = seen.find((x) => x.type === 'card:deleted');
    expect(deleted?.triggerProtocol).toBe('life');
    expect(deleted?.triggerDefId).toBe('life-0');
  });

  it('water-3 return carries triggerProtocol=water + triggerDefId (blue ripple FX hook)', () => {
    const s = draftWaterP1();
    advanceToStep(s, 0, 'action');
    const waterLine: Line = s.players[0].protocols.findIndex((p) => p.defId === 'water') as Line;
    s.players[1].hand = [];
    s.players[0].hand = [makeCard('water-3', 0, 'hand')];
    const facedown = makeCard('water-5', 1, 'field', false, 0, 0); // 反面 = 2 分 → 同线回手
    s.players[1].stacks[0] = [facedown];
    const water3 = s.players[0].hand[0];
    const seen: { triggerProtocol?: string; triggerDefId?: string }[] = [];
    const off = gameBus.subscribe((e) => {
      if (e.type !== 'card:returned') return;
      const p = e.payload as { triggerProtocol?: string; triggerDefId?: string };
      seen.push(p);
    });
    executeAction(s, 0, 'play', { cardUid: water3.uid, faceUp: true, line: waterLine });
    resolveAllChoices(s, () => []); // water-3 无选择步骤，无害
    off();
    expect(seen.length).toBeGreaterThan(0);
    for (const p of seen) {
      expect(p.triggerProtocol).toBe('water'); // 触发卡协议（water-3）
      expect(p.triggerDefId).toBe('water-3');
    }
  });

  it('water-4 return carries triggerProtocol=water + triggerDefId (FX hook ready)', () => {
    const s = draftWaterP1();
    advanceToStep(s, 0, 'action');
    const waterLine: Line = s.players[0].protocols.findIndex((p) => p.defId === 'water') as Line;
    const own = makeCard('metal-2', 0, 'field', true, 1, 0); // 自己的未覆盖卡
    s.players[0].stacks[1] = [own];
    s.players[0].hand = [makeCard('water-4', 0, 'hand')];
    const water4 = s.players[0].hand[0];
    const seen: { triggerProtocol?: string; triggerDefId?: string }[] = [];
    const off = gameBus.subscribe((e) => {
      if (e.type !== 'card:returned') return;
      const p = e.payload as { triggerProtocol?: string; triggerDefId?: string };
      seen.push(p);
    });
    executeAction(s, 0, 'play', { cardUid: water4.uid, faceUp: true, line: waterLine });
    resolveAllChoices(s, () => [own.uid]); // water-4：回手1张自己的牌
    off();
    expect(seen).toHaveLength(1);
    expect(seen[0].triggerProtocol).toBe('water');
    expect(seen[0].triggerDefId).toBe('water-4');
  });

  it('life-1 flips carry triggerProtocol=life + triggerDefId (vine FX hook)', () => {
    const s = draftLifeP1();
    advanceToStep(s, 0, 'action');
    const lifeLine: Line = s.players[0].protocols.findIndex((p) => p.defId === 'life') as Line;
    s.players[0].hand = [makeCard('life-1', 0, 'hand')];
    const a = makeCard('metal-2', 1, 'field', true, 1, 0); // 未注册协议：翻正不连锁
    s.players[1].stacks[1] = [a];
    const life1 = s.players[0].hand[0];
    const seen: { triggerProtocol?: string; triggerDefId?: string }[] = [];
    const off = gameBus.subscribe((e) => {
      if (e.type !== 'card:flipped') return;
      const p = e.payload as { triggerProtocol?: string; triggerDefId?: string };
      seen.push(p);
    });
    executeAction(s, 0, 'play', { cardUid: life1.uid, faceUp: true, line: lifeLine });
    const p1 = s.pendingEffects[s.pendingEffects.length - 1];
    executeAction(s, 0, 'effect-choice', { promptId: p1.id, choice: [a.uid] }); // 第 1 次翻转
    const p2 = s.pendingEffects[s.pendingEffects.length - 1];
    executeAction(s, 0, 'effect-choice', { promptId: p2.id, choice: [a.uid] }); // 第 2 次可再选同一张（翻回）
    off();
    expect(seen).toHaveLength(2);
    for (const p of seen) {
      expect(p.triggerProtocol).toBe('life'); // 触发卡协议（life-1）
      expect(p.triggerDefId).toBe('life-1');
    }
  });

  it('love-1 end give carries triggerProtocol=love + triggerDefId + to (heart FX hook)', () => {
    const s = draftLoveP1();
    advanceToStep(s, 0, 'end');
    const loveLine: Line = s.players[0].protocols.findIndex((p) => p.defId === 'love') as Line;
    const lv1 = makeCard('love-1', 0, 'field', true, loveLine, 0);
    const giveCard = makeCard('water-2', 0, 'hand');
    s.players[0].stacks[loveLine] = [lv1];
    s.players[0].hand = [giveCard];
    const seen: { to?: number; triggerProtocol?: string; triggerDefId?: string }[] = [];
    const off = gameBus.subscribe((e) => {
      if (e.type !== 'card:given') return;
      seen.push(e.payload as { to?: number; triggerProtocol?: string; triggerDefId?: string });
    });
    const t = collectTriggers(s, 'end').find((x) => x.cardUid === lv1.uid)!;
    resolveTrigger(s, t);
    runStack(s);
    const p = s.pendingEffects[s.pendingEffects.length - 1];
    executeAction(s, 0, 'effect-choice', { promptId: p.id, choice: [giveCard.uid] });
    off();
    expect(seen).toHaveLength(1);
    expect(seen[0].to).toBe(1); // 接收方 = 对手
    expect(seen[0].triggerProtocol).toBe('love'); // 触发卡协议（love-1 底）
    expect(seen[0].triggerDefId).toBe('love-1');
  });

  it('love-3 takeRandom carries triggerProtocol=love + triggerDefId + to (heart FX hook)', () => {
    const s = draftLoveP1();
    advanceToStep(s, 0, 'action');
    const loveLine: Line = s.players[0].protocols.findIndex((p) => p.defId === 'love') as Line;
    s.players[1].hand = [makeCard('death-0', 1, 'hand'), makeCard('death-1', 1, 'hand')];
    s.players[0].hand = [makeCard('love-3', 0, 'hand')];
    const card = s.players[0].hand[0];
    const seen: { to?: number; triggerProtocol?: string; triggerDefId?: string }[] = [];
    const off = gameBus.subscribe((e) => {
      if (e.type !== 'card:given') return;
      seen.push(e.payload as { to?: number; triggerProtocol?: string; triggerDefId?: string });
    });
    executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: true, line: loveLine });
    off(); // takeRandom 即发 card:given（随后的 give 选择仍挂起，不影响断言）
    expect(seen).toHaveLength(1);
    expect(seen[0].to).toBe(0); // 接收方 = 效果属主（P1）
    expect(seen[0].triggerProtocol).toBe('love');
    expect(seen[0].triggerDefId).toBe('love-3');
  });

  it('love-4 reveal sets ghost fx=love + card:revealed triggerProtocol=love (heart ghost)', () => {
    const s = draftLoveP1();
    advanceToStep(s, 0, 'action');
    const loveLine: Line = s.players[0].protocols.findIndex((p) => p.defId === 'love') as Line;
    const secret = makeCard('fire-1', 0, 'hand');
    s.players[0].hand = [makeCard('love-4', 0, 'hand'), secret];
    const target = makeCard('water-0', 1, 'field', true, 1, 0); // 翻转目标
    s.players[1].stacks[1] = [target];
    const card = s.players[0].hand[0];
    const seen: { triggerProtocol?: string; triggerDefId?: string }[] = [];
    const off = gameBus.subscribe((e) => {
      if (e.type !== 'card:revealed') return;
      seen.push(e.payload as { triggerProtocol?: string; triggerDefId?: string });
    });
    executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: true, line: loveLine });
    const p = s.pendingEffects[s.pendingEffects.length - 1];
    executeAction(s, 0, 'effect-choice', { promptId: p.id, choice: [secret.uid] }); // 揭示自己手牌
    off();
    expect(s.revealedGhosts).toHaveLength(1);
    expect(s.revealedGhosts[0].fx).toBe('love'); // love 协议揭示 → 粉红爱心幽灵（FX-4）
    expect(s.revealedGhosts[0].lightFx).toBeFalsy(); // 非 light 协议 → 无光之辉光
    for (const ev of seen) {
      expect(ev.triggerProtocol).toBe('love');
      expect(ev.triggerDefId).toBe('love-4');
    }
  });
});
