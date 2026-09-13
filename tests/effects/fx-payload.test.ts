import { describe, it, expect } from 'vitest';
import { gameBus } from '../../src/core/events/bus';
import { executeAction, getLegalActions } from '../../src/core/game';
import { collectTriggers, resolveTrigger } from '../../src/core/effects/triggers';
import { runStack, answerEffect } from '../../src/core/effects/resolve';
import { makeCard, draftFireP1, draftLightP1, draftWaterP1, draftLifeP1, draftLoveP1, advanceToStep, resolveAllChoices, pickFirst } from '../helpers';
import type { GameState, Line, PlayerId } from '../../src/core/models/types';
import { createGame } from '../../src/core/state/create';

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

  // ——— 2026-09-13（用户清单 #2 / #17a 复查）：3 代"回手 / 反打 / 打出 / 删除"载荷补齐后必须可定位 ———

  /** 3 代协议线（fire/light/darkness 三条，effect 逻辑与协议 defId 无关） */
  function setup3(): GameState {
    const s = createGame();
    for (const pid of [0, 1] as PlayerId[]) {
      s.players[pid].protocols = [
        { defId: 'fire', compiled: false },
        { defId: 'light', compiled: false },
        { defId: 'darkness', compiled: false },
      ];
    }
    s.phase = 'turn';
    return s;
  }

  it('greed-2 start return carries triggerProtocol=greed + triggerDefId（回手 R3 特效钩子）', () => {
    const s = setup3();
    s.turnPlayer = 0;
    s.step = 'start';
    const src = makeCard('greed-2', 0, 'field', true, 0, 0);
    s.players[0].stacks[0] = [src];
    const victim = makeCard('light-3', 0, 'field', true, 1, 0); // 另一条线的顶卡（回手目标）
    s.players[0].stacks[1] = [victim];
    const seen: { triggerProtocol?: string; triggerDefId?: string; triggerUid?: string }[] = [];
    const off = gameBus.subscribe((e) => {
      if (e.type !== 'card:returned') return;
      seen.push(e.payload as { triggerProtocol?: string; triggerDefId?: string; triggerUid?: string });
    });
    const t = collectTriggers(s, 'start').find((x) => x.defId === 'greed-2')!;
    expect(t, 'greed-2 底 start 触发未收集（cond 应满足）').toBeTruthy();
    resolveTrigger(s, t);
    runStack(s); // 先把生成器跑到第一个选择点
    resolveAllChoices(s, (p) => (p.candidates.some((c) => c.uid === victim.uid) ? [victim.uid] : []));
    off();
    expect(seen).toHaveLength(1);
    expect(seen[0].triggerProtocol).toBe('greed'); // 触发卡协议（greed-2）
    expect(seen[0].triggerDefId).toBe('greed-2');
    expect(seen[0].triggerUid).toBe(src.uid); // FX 层靠它定位"青玉抓取爪"贴在源卡上
    expect(s.players[0].hand.some((c) => c.uid === victim.uid)).toBe(true);
  });

  it('envy-3 after-play deck play carries triggerProtocol=envy + faceDown + line（E3 特效钩子）', () => {
    const s = setup3();
    s.turnPlayer = 1;
    s.players[1].hand = [makeCard('fire-3', 1, 'hand')];
    s.players[0].deck = [makeCard('light-5', 0, 'deck', false)]; // 己方（envy-3 持有者）牌库顶
    const src = makeCard('envy-3', 0, 'field', true, 0, 0);
    s.players[0].stacks[0] = [src];
    const seen: { triggerProtocol?: string; triggerDefId?: string; triggerUid?: string; line?: number | null; faceUp?: boolean }[] = [];
    const off = gameBus.subscribe((e) => {
      if (e.type !== 'card:deck-played') return;
      seen.push(e.payload as { triggerProtocol?: string; triggerDefId?: string; triggerUid?: string; line?: number | null; faceUp?: boolean });
    });
    executeAction(s, 1, 'play', { cardUid: s.players[1].hand[0].uid, faceUp: false, line: 0 });
    resolveAllChoices(s, pickFirst);
    off();
    expect(seen).toHaveLength(1);
    expect(seen[0].triggerProtocol).toBe('envy');
    expect(seen[0].triggerDefId).toBe('envy-3');
    expect(seen[0].triggerUid).toBe(src.uid);
    expect(seen[0].faceUp).toBe(false); // 反面打出（E3 是"牌库顶卡背被拉出"）
    expect(seen[0].line).toBe(0); // FX 层按 owner+line 定位落点涟漪
  });

  it('card:deleted 回填 line（新星0「整线删除」按线中心连锁 + 收尾临界环依赖它）', () => {
    const s = draftLifeP1();
    advanceToStep(s, 0, 'action');
    const life0 = makeCard('life-0', 0, 'field', true, 1, 0);
    s.players[0].stacks[1] = [life0];
    const played = makeCard('life-5', 0, 'hand');
    s.players[0].hand = [played];
    executeAction(s, 0, 'play', { cardUid: played.uid, faceUp: false, line: 1 });
    resolveAllChoices(s, pickFirst);
    advanceToStep(s, 0, 'end');
    let payload: { line?: number | null } | undefined;
    const off = gameBus.subscribe((e) => {
      if (e.type === 'card:deleted') payload = e.payload as { line?: number | null };
    });
    const trig = getLegalActions(s, 0).find((a) => a.kind === 'resolve-trigger');
    executeAction(s, 0, 'resolve-trigger', { cardUid: trig!.cardUid! });
    off();
    expect(payload, '未捕获 card:deleted').toBeTruthy();
    // 旧版在 emit 之前清空 card.line → payload.line 恒为 null（3 代删除特效定位/排序全部退化）
    expect(payload!.line).toBe(1);
  });

  it('card:played 打出瞬间载荷带 defId/protocol/line（嫉妒4 E4 计数对比特效钩子）', () => {    const s = setup3();
    s.turnPlayer = 0;
    s.players[0].protocols[2] = { defId: 'envy', compiled: false }; // 正面打入要求协议匹配
    const played = makeCard('envy-4', 0, 'hand');
    s.players[0].hand = [played];
    const seen: { defId?: string; protocol?: string; line?: number | null; faceUp?: boolean }[] = [];
    const off = gameBus.subscribe((e) => {
      if (e.type !== 'card:played') return;
      seen.push(e.payload as { defId?: string; protocol?: string; line?: number | null; faceUp?: boolean });
    });
    executeAction(s, 0, 'play', { cardUid: played.uid, faceUp: true, line: 2 });
    off();
    expect(seen).toHaveLength(1);
    expect(seen[0].defId).toBe('envy-4');
    expect(seen[0].protocol).toBe('envy');
    expect(seen[0].line).toBe(2);
    expect(seen[0].faceUp).toBe(true);
  });

  it('可选选择被跳过 → card:effect-skipped（Q5 空动作反馈：贪婪2 底空抓）', () => {
    const s = setup3();
    s.turnPlayer = 0;
    s.step = 'start';
    const src = makeCard('greed-2', 0, 'field', true, 0, 0);
    s.players[0].stacks[0] = [src];
    s.players[0].stacks[1] = [makeCard('light-3', 0, 'field', true, 1, 0)]; // 让触发 cond 成立
    const seen: { defId?: string; protocol?: string; uid?: string; promptTitle?: string }[] = [];
    const off = gameBus.subscribe((e) => {
      if (e.type !== 'card:effect-skipped') return;
      seen.push(e.payload as { defId?: string; protocol?: string; uid?: string; promptTitle?: string });
    });
    // 触发按钮（greed-2 底注册为必点按钮）→ 效果内的"你可以回手1张你的牌"选「跳过」
    const t = collectTriggers(s, 'start').find((x) => x.defId === 'greed-2')!;
    resolveTrigger(s, t);
    runStack(s);
    const top = s.pendingEffects[s.pendingEffects.length - 1];
    expect(top?.prompt?.optional).toBe(true);
    answerEffect(s, top.id, []); // 跳过
    off();
    expect(seen).toHaveLength(1);
    expect(seen[0].defId).toBe('greed-2');
    expect(seen[0].protocol).toBe('greed');
    expect(seen[0].uid).toBe(src.uid); // FX 层靠它定位"空抓"的源卡
    expect(seen[0].promptTitle).toContain('回手1张你的牌');
    expect(s.players[0].stacks[1]).toHaveLength(1); // 没回手：牌还在场上
  });

  it('可选触发被跳过（未结算直接推进）→ card:trigger-skipped（Q5 空动作反馈）', () => {
    const s = setup3();
    s.turnPlayer = 0;
    s.step = 'end';
    // diversity-0 底注册为 optional:true 的 end 触发 → 玩家可以直接推进（不结算）
    s.players[0].stacks[0] = [makeCard('diversity-0', 0, 'field', true, 0, 0)];
    s.players[0].hand = [makeCard('fire-1', 0, 'hand')];
    const seen: { defId?: string; protocol?: string; step?: string }[] = [];
    const off = gameBus.subscribe((e) => {
      if (e.type !== 'card:trigger-skipped') return;
      seen.push(e.payload as { defId?: string; protocol?: string; step?: string });
    });
    expect(collectTriggers(s, 'end').some((x) => x.defId === 'diversity-0' && x.optional)).toBe(true);
    executeAction(s, 0, 'advance');
    off();
    expect(seen).toHaveLength(1);
    expect(seen[0].defId).toBe('diversity-0');
    expect(seen[0].protocol).toBe('diversity');
    expect(seen[0].step).toBe('end');
  });

  it('必选触发未结算时 advance 仍被拦下（不会误发"被跳过"反馈）', () => {
    const s = setup3();
    s.turnPlayer = 0;
    s.step = 'start';
    const src = makeCard('greed-2', 0, 'field', true, 0, 0);
    s.players[0].stacks[0] = [src];
    s.players[0].stacks[1] = [makeCard('light-3', 0, 'field', true, 1, 0)];
    const seen: string[] = [];
    const off = gameBus.subscribe((e) => {
      if (e.type === 'card:trigger-skipped' || e.type === 'card:effect-skipped') seen.push(e.type);
    });
    expect(() => executeAction(s, 0, 'advance')).toThrow(/mandatory trigger/);
    off();
    expect(seen).toHaveLength(0);
  });
});
