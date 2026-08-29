import { describe, it, expect } from 'vitest';
import type { GameState, Line, PlayerId } from '../../src/core/models/types';
import { executeAction } from '../../src/core/game';
import { stackValue } from '../../src/core/state/create';
import { EFFECTS, registerCardEffects } from '../../src/core/effects/registry';
import { makeCard, pickFirst, resolveAllChoices, draftDarknessP1, advanceToStep } from '../helpers';

function darknessLine(s: GameState): Line {
  const idx = s.players[0].protocols.findIndex((p) => p.defId === 'darkness');
  return idx as Line;
}

describe('darkness protocol effects', () => {
  it('darkness-0: draw 3, then shift a covered opponent card to own column', () => {
    const s = draftDarknessP1();
    advanceToStep(s, 0, 'action');
    const covered = makeCard('water-1', 1, 'field', true, 1, 0);
    const top = makeCard('water-2', 1, 'field', true, 1, 1);
    s.players[1].stacks[1] = [covered, top];
    s.players[0].hand = [makeCard('darkness-0', 0, 'hand')];
    const handBefore = s.players[0].hand.length;
    const card = s.players[0].hand[0];
    executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: true, line: darknessLine(s) });
    resolveAllChoices(s, (p) => (p.candidates.some((c) => c.uid === covered.uid) ? [covered.uid] : pickFirst(p)));
    expect(s.players[0].hand).toHaveLength(handBefore - 1 + 3); // 打出 1 张 + 抽 3
    expect(covered.zone).toBe('field');
    expect(covered.line).toBe(darknessLine(s)); // 移到本卡所在列（对手侧同列号）
    expect(covered.faceUp).toBe(true); // 被盖住的牌保持原状（未翻面）
    expect(s.players[1].stacks[1].map((c) => c.uid)).toEqual([top.uid]); // 源堆叠只剩顶卡
    expect(s.players[1].stacks[darknessLine(s)].map((c) => c.uid)).toContain(covered.uid);
    expect(s.pendingEffects).toHaveLength(0);
    expect(s.pendingShift).toHaveLength(0);
  });

  it('darkness-0: no covered opponent cards fizzles — draw 3 still happens, no deadlock', () => {
    const s = draftDarknessP1();
    advanceToStep(s, 0, 'action');
    s.players[1].stacks[1] = [makeCard('water-1', 1, 'field', true, 1, 0)]; // 无被覆盖卡
    s.players[0].hand = [makeCard('darkness-0', 0, 'hand')];
    const handBefore = s.players[0].hand.length;
    const card = s.players[0].hand[0];
    executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: true, line: darknessLine(s) });
    resolveAllChoices(s, pickFirst); // 空候选自动 fizzle（不挂起）
    expect(s.players[0].hand).toHaveLength(handBefore - 1 + 3); // 抽 3 仍结算
    expect(s.pendingEffects).toHaveLength(0);
    expect(s.players[0].stacks[darknessLine(s)].map((c) => c.uid)).toEqual([card.uid]);
  });

  it('darkness-0: covered opponent card on the same column is not a shift candidate', () => {
    const s = draftDarknessP1();
    advanceToStep(s, 0, 'action');
    // 对手线 0（= 效果所在列）：被覆盖卡无法平移（目标线固定为本列）→ 从候选排除
    const sameLine = makeCard('water-1', 1, 'field', true, 0, 0);
    const sameTop = makeCard('water-2', 1, 'field', true, 0, 1);
    s.players[1].stacks[0] = [sameLine, sameTop];
    // 对手线 1：另一张被覆盖卡（唯一合法候选）
    const other = makeCard('water-3', 1, 'field', true, 1, 0);
    const otherTop = makeCard('water-4', 1, 'field', true, 1, 1);
    s.players[1].stacks[1] = [other, otherTop];
    s.players[0].hand = [makeCard('darkness-0', 0, 'hand')];
    const card = s.players[0].hand[0];
    executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: true, line: darknessLine(s) });
    const p = s.pendingEffects[s.pendingEffects.length - 1];
    expect(p.prompt?.kind).toBe('select');
    expect(p.prompt?.candidates.map((c) => c.uid)).toEqual([other.uid]); // 同列候选被排除
    executeAction(s, 0, 'effect-choice', { promptId: p.id, choice: [other.uid] });
    expect(other.line).toBe(darknessLine(s)); // 平移成功落地
    expect(s.pendingEffects).toHaveLength(0);
  });

  it('darkness-0: all covered opponent cards same-column → fizzle, no deadlock', () => {
    const s = draftDarknessP1();
    advanceToStep(s, 0, 'action');
    const covered = makeCard('water-1', 1, 'field', true, 0, 0);
    const top = makeCard('water-2', 1, 'field', true, 0, 1);
    s.players[1].stacks[0] = [covered, top];
    s.players[0].hand = [makeCard('darkness-0', 0, 'hand')];
    const handBefore = s.players[0].hand.length;
    const card = s.players[0].hand[0];
    executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: true, line: darknessLine(s) });
    expect(s.players[0].hand).toHaveLength(handBefore - 1 + 3); // 抽 3 仍结算
    expect(s.pendingEffects).toHaveLength(0); // 全部候选被过滤 → fizzle：不挂起、不死锁
    expect(covered.line).toBe(0); // 未被平移
    expect(s.players[1].stacks[0].map((c) => c.uid)).toEqual([covered.uid, top.uid]);
  });

  it('darkness-0: shifting a covered card does not re-run the unchanged top middle (fire-0)', () => {
    const s = draftDarknessP1();
    advanceToStep(s, 0, 'action');
    // 对手线 1：顶层正面 fire-0（有中指令），其下是被盖住的覆盖卡 → 平移覆盖卡时顶卡并未被移除
    const covered = makeCard('water-1', 1, 'field', true, 1, 0);
    const fire0 = makeCard('fire-0', 1, 'field', true, 1, 1);
    s.players[1].stacks[1] = [covered, fire0];
    s.players[0].hand = [makeCard('darkness-0', 0, 'hand')];
    const handBefore = s.players[0].hand.length;
    const card = s.players[0].hand[0];
    executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: true, line: darknessLine(s) });
    const p = s.pendingEffects[s.pendingEffects.length - 1];
    expect(p.prompt?.kind).toBe('select');
    executeAction(s, 0, 'effect-choice', { promptId: p.id, choice: [covered.uid] });
    expect(s.pendingEffects).toHaveLength(0); // fire-0 中指令未被重新触发（无新挂起选择）
    expect(s.pendingShift).toHaveLength(0);
    expect(s.players[0].hand).toHaveLength(handBefore - 1 + 3); // 仅 darkness-0 抽 3，fire-0 中指令未跑（无额外抽 2）
    expect(s.players[1].stacks[1].map((c) => c.uid)).toEqual([fire0.uid]); // 顶卡原样保留
    expect(covered.line).toBe(darknessLine(s)); // 覆盖卡平移落地
  });

  it('darkness-1: flip an opponent card, then optional line shift moves it', () => {
    const s = draftDarknessP1();
    advanceToStep(s, 0, 'action');
    const target = makeCard('water-1', 1, 'field', false, 1, 0);
    s.players[1].stacks[1] = [target];
    s.players[0].hand = [makeCard('darkness-1', 0, 'hand')];
    const card = s.players[0].hand[0];
    executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: true, line: darknessLine(s) });
    resolveAllChoices(s, (p) => (p.kind === 'select-line' ? ['line:2'] : [target.uid]));
    expect(target.faceUp).toBe(true); // 翻转
    expect(target.line).toBe(2); // 平移（目标线 ≠ 源线/本卡线）
    expect(s.players[1].stacks[1]).toHaveLength(0);
    expect(s.players[1].stacks[2].map((c) => c.uid)).toEqual([target.uid]);
    expect(s.pendingEffects).toHaveLength(0);
  });

  it('darkness-1: optional line shift can be skipped — card stays on its original line', () => {
    const s = draftDarknessP1();
    advanceToStep(s, 0, 'action');
    const target = makeCard('water-1', 1, 'field', false, 1, 0);
    s.players[1].stacks[1] = [target];
    s.players[0].hand = [makeCard('darkness-1', 0, 'hand')];
    const card = s.players[0].hand[0];
    executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: true, line: darknessLine(s) });
    // 第一步：选要翻转的对手牌
    const p1 = s.pendingEffects[s.pendingEffects.length - 1];
    expect(p1.prompt?.kind).toBe('select');
    executeAction(s, 0, 'effect-choice', { promptId: p1.id, choice: [target.uid] });
    // 第二步：可选 select-line —— 跳过（空应答）
    const p2 = s.pendingEffects[s.pendingEffects.length - 1];
    expect(p2.prompt?.kind).toBe('select-line');
    expect(p2.prompt?.optional).toBe(true);
    executeAction(s, 0, 'effect-choice', { promptId: p2.id, choice: [] });
    expect(target.faceUp).toBe(true); // 翻转已生效
    expect(target.line).toBe(1); // 未平移
    expect(s.players[1].stacks[1].map((c) => c.uid)).toEqual([target.uid]);
    expect(s.pendingEffects).toHaveLength(0);
  });

  it('darkness-2: optional flip of a facedown card in own column — flip path', () => {
    const s = draftDarknessP1();
    advanceToStep(s, 0, 'action');
    const fd = makeCard('water-1', 0, 'field', false, 0, 0);
    s.players[0].stacks[0] = [fd];
    s.players[0].hand = [makeCard('darkness-2', 0, 'hand')];
    const card = s.players[0].hand[0];
    executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: true, line: darknessLine(s) });
    // darkness-2 正面打出盖住反面卡 → 中指令：可选翻转 1 张此列的反面牌（被盖住的 fd）
    const p = s.pendingEffects[s.pendingEffects.length - 1];
    expect(p.prompt?.kind).toBe('select');
    expect(p.prompt?.optional).toBe(true);
    expect(p.prompt?.candidates.map((c) => c.uid)).toEqual([fd.uid]);
    executeAction(s, 0, 'effect-choice', { promptId: p.id, choice: [fd.uid] });
    expect(fd.faceUp).toBe(true); // 被盖住的反面牌翻正
    expect(s.pendingEffects).toHaveLength(0);
  });

  it('darkness-2: optional flip can be skipped — card stays facedown', () => {
    const s = draftDarknessP1();
    advanceToStep(s, 0, 'action');
    const fd = makeCard('water-1', 0, 'field', false, 0, 0);
    s.players[0].stacks[0] = [fd];
    s.players[0].hand = [makeCard('darkness-2', 0, 'hand')];
    const card = s.players[0].hand[0];
    executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: true, line: darknessLine(s) });
    const p = s.pendingEffects[s.pendingEffects.length - 1];
    expect(p.prompt?.optional).toBe(true);
    executeAction(s, 0, 'effect-choice', { promptId: p.id, choice: [] });
    expect(fd.faceUp).toBe(false); // 未翻转
    expect(s.pendingEffects).toHaveLength(0);
  });

  it('darkness-3: playTopDeck face-down onto a chosen different line', () => {
    const s = draftDarknessP1();
    advanceToStep(s, 0, 'action');
    const deckLen = s.players[0].deck.length;
    const top = s.players[0].deck[deckLen - 1];
    s.players[0].hand = [makeCard('darkness-3', 0, 'hand')];
    const card = s.players[0].hand[0];
    executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: true, line: darknessLine(s) });
    resolveAllChoices(s, (p) => (p.kind === 'select-line' ? ['line:2'] : pickFirst(p)));
    expect(s.players[0].deck).toHaveLength(deckLen - 1); // 牌库顶被取出
    expect(top.zone).toBe('field');
    expect(top.line).toBe(2);
    expect(top.faceUp).toBe(false); // 反面落地
    expect(s.players[0].stacks[2].map((c) => c.uid)).toContain(top.uid);
    expect(s.pendingEffects).toHaveLength(0);
    expect(s.pendingPlay).toHaveLength(0);
  });

  it('darkness-3: empty deck fizzles after line select (no playTopDeck throw)', () => {
    const s = draftDarknessP1();
    advanceToStep(s, 0, 'action');
    s.players[0].deck = [];
    s.players[0].hand = [makeCard('darkness-3', 0, 'hand')];
    const card = s.players[0].hand[0];
    executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: true, line: darknessLine(s) });
    resolveAllChoices(s, (p) => (p.kind === 'select-line' ? ['line:2'] : pickFirst(p)));
    expect(s.players[0].deck).toHaveLength(0);
    expect(s.players[0].stacks[2]).toHaveLength(0); // 未打出
    expect(s.pendingEffects).toHaveLength(0);
  });

  it('darkness-4: shift a facedown card to a chosen line', () => {
    const s = draftDarknessP1();
    advanceToStep(s, 0, 'action');
    const fd = makeCard('water-1', 1, 'field', false, 1, 0);
    s.players[1].stacks[1] = [fd];
    s.players[0].hand = [makeCard('darkness-4', 0, 'hand')];
    const card = s.players[0].hand[0];
    executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: true, line: darknessLine(s) });
    resolveAllChoices(s, (p) => {
      if (p.kind === 'select-line') return ['line:2']; // 排除 fd 当前线 1 → 可选 [0, 2]
      return [fd.uid];
    });
    expect(fd.line).toBe(2);
    expect(fd.faceUp).toBe(false); // 反面平移（不翻面）
    expect(s.players[1].stacks[1]).toHaveLength(0);
    expect(s.players[1].stacks[2].map((c) => c.uid)).toEqual([fd.uid]);
    expect(s.pendingEffects).toHaveLength(0);
  });

  it('darkness-5: discard 1', () => {
    const s = draftDarknessP1();
    advanceToStep(s, 0, 'action');
    s.players[0].hand = [makeCard('darkness-5', 0, 'hand'), makeCard('light-1', 0, 'hand')];
    const target = s.players[0].hand.find((c) => c.defId === 'darkness-5')!;
    const other = s.players[0].hand.find((c) => c.defId !== 'darkness-5')!;
    executeAction(s, 0, 'play', { cardUid: target.uid, faceUp: true, line: darknessLine(s) });
    resolveAllChoices(s, (p) => [other.uid]);
    expect(s.players[0].trash.map((c) => c.uid)).toEqual([other.uid]);
    expect(s.players[0].hand).toHaveLength(0);
    expect(s.players[0].stacks[darknessLine(s)].map((c) => c.uid)).toEqual([target.uid]);
  });

  it('opponent-line valueModifier: an opponent card on the same line adjusts the valuing total', () => {
    const s = draftDarknessP1();
    const defId = 'darkness-opp-line';
    registerCardEffects(defId, {
      valueModifier: {
        target: 'opponent-line',
        apply: (_gs: GameState, _owner: PlayerId, _line: Line, total: number): number => total + 1,
      },
    });
    try {
      s.players[0].stacks[0] = [makeCard('fire-5', 0, 'field', true, 0, 0)]; // 5
      s.players[1].stacks[0] = [makeCard(defId, 1, 'field', true, 0, 0)]; // 对手同线卡
      expect(stackValue(s, 0, 0)).toBe(5 + 1); // 对手卡的 opponent-line 修正作用于我方估值
    } finally {
      delete EFFECTS[defId]; // 清理临时注册
    }
  });
});
