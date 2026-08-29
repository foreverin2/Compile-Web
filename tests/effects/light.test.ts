import { describe, it, expect } from 'vitest';
import type { GameState, Line } from '../../src/core/models/types';
import { executeAction, getLegalActions } from '../../src/core/game';
import { collectTriggers } from '../../src/core/effects/triggers';
import { makeCard, pickFirst, resolveAllChoices, draftLightP1, advanceToStep } from '../helpers';

function lightLine(s: GameState): Line {
  const idx = s.players[0].protocols.findIndex((p) => p.defId === 'light');
  return idx as Line;
}

describe('light protocol effects', () => {
  it('light-0: flip a target card, draw its value (3)', () => {
    const s = draftLightP1();
    advanceToStep(s, 0, 'action');
    s.players[0].hand = [makeCard('light-0', 0, 'hand')];
    // 目标：分值 3 的反面牌（light-3）——翻正后其自身中指令会连锁（本线无反面包 → 直接结束）
    const facedown = makeCard('light-3', 1, 'field', false, 1, 0);
    s.players[1].stacks[1] = [facedown];
    const card = s.players[0].hand[0];
    executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: true, line: lightLine(s) });
    resolveAllChoices(s, (p) => {
      if (p.kind === 'select-line') return ['line:0']; // 连锁的 light-3 中指令：选目标线
      if (p.candidates.some((c) => c.uid === facedown.uid)) return [facedown.uid];
      return pickFirst(p);
    });
    expect(facedown.faceUp).toBe(true); // 翻转目标
    expect(s.players[0].hand).toHaveLength(3); // 抽目标分值张（3）
  });

  it('light-1 end trigger: mandatory draw 1 (no skip)', () => {
    const s = draftLightP1();
    advanceToStep(s, 0, 'action');
    s.players[0].stacks[0] = [makeCard('light-1', 0, 'field', true, 0, 0)];
    const handBefore = s.players[0].hand.length;
    advanceToStep(s, 0, 'end');
    const t = collectTriggers(s, 'end').find((x) => x.cardUid === s.players[0].stacks[0][0].uid);
    expect(t).toBeDefined();
    expect(t!.optional).toBe(false); // 必选：无跳过
    // 必选触发未结算时：不允许 advance 跳过
    expect(getLegalActions(s, 0).some((a) => a.kind === 'advance')).toBe(false);
    expect(() => executeAction(s, 0, 'advance')).toThrow(/mandatory trigger/);
    // 经游戏 resolve-trigger 行动路径结算 → 抽 1
    executeAction(s, 0, 'resolve-trigger', { cardUid: t!.cardUid });
    resolveAllChoices(s, pickFirst); // 无选择步骤（直接抽 1），无害
    expect(s.players[0].hand).toHaveLength(handBefore + 1);
    expect(s.pendingEffects).toHaveLength(0);
  });

  it('light-2: revealed card owner (P2) decides — flip', () => {
    const s = draftLightP1();
    advanceToStep(s, 0, 'action');
    s.players[0].hand = [makeCard('light-2', 0, 'hand')];
    const facedown = makeCard('light-1', 1, 'field', false, 1, 0);
    s.players[1].stacks[1] = [facedown];
    const card = s.players[0].hand[0];
    executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: true, line: lightLine(s) });
    // 第一步：light-2 选要揭示的反面牌（效果属主 P1 应答）
    const p1 = s.pendingEffects[s.pendingEffects.length - 1];
    expect(p1.prompt?.kind).toBe('select');
    executeAction(s, 0, 'effect-choice', { promptId: p1.id, choice: [facedown.uid] });
    // 揭示 → 幽灵牌产生，挂起 select-action，chooser = 被揭示卡持有者（P2）
    expect(s.revealedGhosts).toHaveLength(1);
    const p2 = s.pendingEffects[s.pendingEffects.length - 1];
    expect(p2.prompt?.kind).toBe('select-action');
    expect(p2.prompt?.chooser).toBe(1);
    // 效果属主 P1 无选择权
    expect(() => executeAction(s, 0, 'effect-choice', { promptId: p2.id, choice: ['action:flip'] })).toThrow(/not your choice/);
    // P2 决定：翻转
    executeAction(s, 1, 'effect-choice', { promptId: p2.id, choice: ['action:flip'] });
    expect(facedown.faceUp).toBe(true);
    expect(s.pendingEffects).toHaveLength(0);
  });

  it('light-2: revealed card owner (P2) decides — skip (stays facedown)', () => {
    const s = draftLightP1();
    advanceToStep(s, 0, 'action');
    s.players[0].hand = [makeCard('light-2', 0, 'hand')];
    const facedown = makeCard('light-1', 1, 'field', false, 1, 0);
    s.players[1].stacks[1] = [facedown];
    const card = s.players[0].hand[0];
    executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: true, line: lightLine(s) });
    const p1 = s.pendingEffects[s.pendingEffects.length - 1];
    executeAction(s, 0, 'effect-choice', { promptId: p1.id, choice: [facedown.uid] });
    const p2 = s.pendingEffects[s.pendingEffects.length - 1];
    executeAction(s, 1, 'effect-choice', { promptId: p2.id, choice: [] }); // 可选：跳过
    expect(facedown.faceUp).toBe(false); // 未翻转
    expect(s.revealedGhosts).toHaveLength(1); // 揭示本身仍生效
    expect(s.pendingEffects).toHaveLength(0);
  });

  it('light-3: shift all facedown cards of own line to target line', () => {
    const s = draftLightP1();
    advanceToStep(s, 0, 'action');
    // 本线堆叠：两张反面牌（含被覆盖的底层）→ 打出 light-3 落顶
    const fd1 = makeCard('light-1', 0, 'field', false, 0, 0);
    const fd2 = makeCard('light-2', 0, 'field', false, 0, 1);
    s.players[0].stacks[0] = [fd1, fd2];
    s.players[0].hand = [makeCard('light-3', 0, 'hand')];
    const card = s.players[0].hand[0];
    executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: true, line: lightLine(s) });
    // 每移开一张反面包，顶卡 light-3 重新露出都会连锁一次其中指令（再次 select-line）→ 全部答同一条线
    resolveAllChoices(s, (p) => (p.kind === 'select-line' ? ['line:1'] : pickFirst(p)));
    expect(s.players[0].stacks[0].map((c) => c.uid)).toEqual([card.uid]); // 源线只剩 light-3（无反面包）
    expect(s.players[0].stacks[1].map((c) => c.uid).sort()).toEqual([fd1.uid, fd2.uid].sort()); // 全部反面牌移到目标线
    expect(fd1.zone).toBe('field');
    expect(fd2.zone).toBe('field');
    expect(fd1.line).toBe(1);
    expect(fd2.line).toBe(1);
    expect(s.pendingShift).toBeNull();
    // 状态损坏签名：所有原场卡都在某堆叠中，无卡残留在浮空态
    const onField = [s.players[0], s.players[1]].flatMap((p) => [...p.stacks[0], ...p.stacks[1], ...p.stacks[2]]);
    expect(onField.map((c) => c.uid).sort()).toEqual([fd1.uid, fd2.uid, card.uid].sort());
  });

  it('light-4: reveal whole opponent hand (one ghost per card)', () => {
    const s = draftLightP1();
    advanceToStep(s, 0, 'action');
    s.players[0].hand = [makeCard('light-4', 0, 'hand')];
    const oppHand = s.players[1].hand;
    const card = s.players[0].hand[0];
    executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: true, line: lightLine(s) });
    resolveAllChoices(s, pickFirst); // 无选择步骤，无害
    expect(s.revealedGhosts).toHaveLength(oppHand.length);
    for (const g of s.revealedGhosts) {
      expect(oppHand.some((c) => c.defId === g.defId)).toBe(true);
    }
  });

  it('light-5: discard 1 mandatory', () => {
    const s = draftLightP1();
    advanceToStep(s, 0, 'action');
    s.players[0].hand = [makeCard('light-5', 0, 'hand'), makeCard('light-1', 0, 'hand')];
    const target = s.players[0].hand.find((c) => c.defId === 'light-5')!;
    const other = s.players[0].hand.find((c) => c.defId !== 'light-5')!;
    executeAction(s, 0, 'play', { cardUid: target.uid, faceUp: true, line: lightLine(s) });
    resolveAllChoices(s, (p) => [other.uid]); // 弃另一张
    expect(s.players[0].trash.map((c) => c.uid)).toEqual([other.uid]);
    expect(s.players[0].hand).toHaveLength(0);
    expect(s.players[0].stacks[0].map((c) => c.uid)).toEqual([target.uid]);
  });
});
