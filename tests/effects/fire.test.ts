import { describe, it, expect } from 'vitest';
import type { GameState, Line } from '../../src/core/models/types';
import { executeAction } from '../../src/core/game';
import { collectTriggers, resolveTrigger } from '../../src/core/effects/triggers';
import { runStack } from '../../src/core/effects/resolve';
import { makeCard, pickFirst, resolveAllChoices, draftFireP1, advanceToStep } from '../helpers';

function fireLine(s: GameState): Line {
  const idx = s.players[0].protocols.findIndex((p) => p.defId === 'fire');
  return idx as Line;
}

describe('fire protocol effects', () => {
  it('fire-5: discard 1 mandatory', () => {
    const s = draftFireP1();
    advanceToStep(s, 0, 'action');
    s.players[0].hand = [makeCard('fire-5', 0, 'hand'), makeCard('fire-1', 0, 'hand')];
    const target = s.players[0].hand.find((c) => c.defId === 'fire-5')!;
    const other = s.players[0].hand.find((c) => c.defId !== 'fire-5')!;
    executeAction(s, 0, 'play', { cardUid: target.uid, faceUp: true, line: fireLine(s) });
    // 中指令挂起：选择弃哪张
    expect(s.pendingEffects).toHaveLength(1);
    resolveAllChoices(s, (p) => [other.uid]); // 弃 fire-1，fire-5 留在场上
    expect(s.players[0].trash.map((c) => c.uid)).toEqual([other.uid]);
    expect(s.players[0].hand).toHaveLength(0);
    expect(s.players[0].stacks[0].map((c) => c.uid)).toEqual([target.uid]);
    expect(s.step).toBe('check-cache'); // 链式结算完毕后自动推进
  });

  it('fire-1: discard then delete (conditional second step)', () => {
    const s = draftFireP1();
    advanceToStep(s, 0, 'action');
    s.players[0].hand = [makeCard('fire-1', 0, 'hand'), makeCard('fire-2', 0, 'hand')];
    s.players[1].stacks[0] = [makeCard('fire-1', 1, 'field', true, 0, 0)];
    const victim = s.players[1].stacks[0][0];
    const card = s.players[0].hand.find((c) => c.defId === 'fire-1')!;
    const discardTarget = s.players[0].hand.find((c) => c.defId === 'fire-2')!;
    executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: true, line: fireLine(s) });
    const prompts: string[] = [];
    resolveAllChoices(s, (p) => {
      prompts.push(p.title);
      return p.candidates.some((c) => c.uid === victim.uid) ? [victim.uid] : [discardTarget.uid];
    });
    expect(prompts).toEqual(['fire-1：你可以弃1张牌', 'fire-1：删除1张牌']);
    expect(s.players[0].trash.map((c) => c.uid)).toEqual([discardTarget.uid]); // 弃掉自己的 fire-2
    expect(s.players[1].trash.map((c) => c.uid)).toEqual([victim.uid]); // 删除对手牌
  });

  it('fire-1: optional discard can be skipped (no delete happens)', () => {
    const s = draftFireP1();
    advanceToStep(s, 0, 'action');
    s.players[0].hand = [makeCard('fire-1', 0, 'hand')];
    s.players[1].stacks[0] = [makeCard('fire-1', 1, 'field', true, 0, 0)];
    const victim = s.players[1].stacks[0][0];
    const card = s.players[0].hand[0];
    executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: true, line: fireLine(s) });
    // 可选弃牌：跳过（空应答）→ 第二步"如果弃了"不触发
    resolveAllChoices(s, () => []);
    expect(s.players[0].trash).toHaveLength(0); // 未弃牌
    expect(s.players[1].stacks[0].map((c) => c.uid)).toEqual([victim.uid]); // 对手牌未被删除
    expect(s.step).toBe('check-cache');
  });

  it('fire-2: discard then return to owner hand', () => {
    const s = draftFireP1();
    advanceToStep(s, 0, 'action');
    s.players[0].hand = [makeCard('fire-2', 0, 'hand'), makeCard('fire-1', 0, 'hand')];
    s.players[1].hand = []; // 清空起始手牌：断言"回持有者手牌"为精确 [victim]
    s.players[1].stacks[0] = [makeCard('fire-2', 1, 'field', true, 0, 0)];
    const victim = s.players[1].stacks[0][0];
    const card = s.players[0].hand.find((c) => c.defId === 'fire-2')!;
    const discardTarget = s.players[0].hand.find((c) => c.defId === 'fire-1')!;
    executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: true, line: fireLine(s) });
    resolveAllChoices(s, (p) => (p.candidates.some((c) => c.uid === victim.uid) ? [victim.uid] : [discardTarget.uid]));
    expect(s.players[1].hand.map((c) => c.uid)).toEqual([victim.uid]); // 回持有者手牌
  });

  it('fire-0 middle: flip another card then draw 2', () => {
    const s = draftFireP1();
    advanceToStep(s, 0, 'action');
    s.players[0].hand = [makeCard('fire-0', 0, 'hand')];
    const facedown = makeCard('fire-3', 1, 'field', false, 1, 0);
    s.players[1].stacks[1] = [facedown];
    const card = s.players[0].hand[0];
    executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: true, line: fireLine(s) });
    resolveAllChoices(s, (p) => (p.candidates.some((c) => c.uid === facedown.uid) ? [facedown.uid] : pickFirst(p)));
    expect(facedown.faceUp).toBe(true);
    expect(s.players[0].hand).toHaveLength(2); // 抽 2
  });

  it('fire-0 before-covered: draw 1 and flip another card before being covered', () => {
    const s = draftFireP1();
    advanceToStep(s, 0, 'action');
    s.players[0].stacks[0] = [makeCard('fire-0', 0, 'field', true, 0, 0)];
    const fire0 = s.players[0].stacks[0][0];
    const facedown = makeCard('fire-3', 1, 'field', false, 1, 0);
    s.players[1].stacks[1] = [facedown];
    const played = makeCard('fire-1', 0, 'hand');
    const discardTarget = makeCard('fire-5', 0, 'hand');
    s.players[0].hand = [played, discardTarget];
    executeAction(s, 0, 'play', { cardUid: played.uid, faceUp: true, line: fireLine(s) });
    // 链：fire-0 被盖住前（抽1 + 翻转选择）→ 落地 fire-1 → fire-1 中指令（弃1）
    resolveAllChoices(s, (p) => {
      if (p.candidates.some((c) => c.uid === facedown.uid)) return [facedown.uid];
      return [discardTarget.uid];
    });
    expect(facedown.faceUp).toBe(true);
    expect(s.players[0].stacks[0].map((c) => c.uid)).toEqual([fire0.uid, played.uid]);
    expect(s.players[0].trash.map((c) => c.uid)).toEqual([discardTarget.uid]);
  });

  it('fire-4: discard 1+ cards, draw discarded+1', () => {
    const s = draftFireP1();
    advanceToStep(s, 0, 'action');
    s.players[0].hand = [
      makeCard('fire-4', 0, 'hand'),
      makeCard('fire-1', 0, 'hand'),
      makeCard('fire-2', 0, 'hand'),
    ];
    const card = s.players[0].hand.find((c) => c.defId === 'fire-4')!;
    const discards = s.players[0].hand.filter((c) => c !== card);
    executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: true, line: fireLine(s) });
    resolveAllChoices(s, (p) => discards.map((c) => c.uid));
    expect(s.players[0].trash).toHaveLength(2);
    expect(s.players[0].hand).toHaveLength(3); // 抽 2+1=3
  });

  it('fire-3 end trigger: optional discard; skipping does nothing', () => {
    const s = draftFireP1();
    advanceToStep(s, 0, 'action');
    s.players[0].stacks[0] = [makeCard('fire-3', 0, 'field', true, 0, 0)];
    const hand1 = makeCard('fire-1', 0, 'hand');
    s.players[0].hand = [hand1];
    advanceToStep(s, 0, 'end');
    const t = collectTriggers(s, 'end').find((x) => x.cardUid === s.players[0].stacks[0][0].uid);
    expect(t).toBeDefined();
    resolveTrigger(s, t!);
    runStack(s);
    resolveAllChoices(s, pickFirst); // 可选 → 跳过
    expect(s.players[0].hand.map((c) => c.uid)).toEqual([hand1.uid]); // 未弃牌
    expect(s.step).toBe('end');
  });

  it('fire-0 first card on empty board: flip select fizzles, draw 2 still happens', () => {
    const s = draftFireP1();
    advanceToStep(s, 0, 'action');
    s.players[0].hand = [makeCard('fire-0', 0, 'hand')];
    const card = s.players[0].hand[0];
    executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: true, line: fireLine(s) });
    // 场上仅有刚打出的 fire-0（结算中源卡被候选排除）→ flip 候选为空 → 该步骤 fizzle
    // （无合法目标跳过，不挂起），后续 draw 2 仍结算
    resolveAllChoices(s, pickFirst);
    expect(s.pendingEffects).toHaveLength(0);
    expect(s.step).toBe('check-cache');
    expect(s.players[0].hand).toHaveLength(2); // 抽 2 仍发生
  });

  it('fire-1 first card on empty board: both selects fizzle, no hang', () => {
    const s = draftFireP1();
    advanceToStep(s, 0, 'action');
    s.players[0].hand = [makeCard('fire-1', 0, 'hand')];
    const card = s.players[0].hand[0];
    executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: true, line: fireLine(s) });
    // 打出后手牌空（弃牌候选空）+ 场上仅源卡（删除候选空）→ 两步都 fizzle，不挂起
    resolveAllChoices(s, pickFirst);
    expect(s.pendingEffects).toHaveLength(0);
    expect(s.step).toBe('check-cache');
    expect(s.players[0].hand).toHaveLength(0);
    expect(s.players[0].trash).toHaveLength(0);
  });

  it('fire-3 end trigger: discard then flip', () => {
    const s = draftFireP1();
    advanceToStep(s, 0, 'action');
    s.players[0].stacks[0] = [makeCard('fire-3', 0, 'field', true, 0, 0)];
    const hand1 = makeCard('fire-1', 0, 'hand');
    s.players[0].hand = [hand1];
    const facedown = makeCard('fire-3', 1, 'field', false, 1, 0);
    s.players[1].stacks[1] = [facedown];
    advanceToStep(s, 0, 'end');
    const t = collectTriggers(s, 'end').find((x) => x.cardUid === s.players[0].stacks[0][0].uid);
    resolveTrigger(s, t!);
    runStack(s);
    // 第一步：可选弃牌（弃 hand1）；第二步：翻转选择（选 facedown）
    resolveAllChoices(s, (p) => {
      if (p.candidates.some((c) => c.uid === facedown.uid)) return [facedown.uid];
      return [hand1.uid];
    });
    expect(s.players[0].trash.map((c) => c.uid)).toEqual([hand1.uid]); // 弃了
    expect(facedown.faceUp).toBe(true); // 翻转
  });
});
