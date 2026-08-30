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
  it('darkness-0: draw 3, then shift a covered opponent card to a chosen line', () => {
    const s = draftDarknessP1();
    advanceToStep(s, 0, 'action');
    const covered = makeCard('water-1', 1, 'field', true, 1, 0);
    const top = makeCard('water-2', 1, 'field', true, 1, 1);
    s.players[1].stacks[1] = [covered, top];
    s.players[0].hand = [makeCard('darkness-0', 0, 'hand')];
    const handBefore = s.players[0].hand.length;
    const card = s.players[0].hand[0];
    executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: true, line: darknessLine(s) });
    resolveAllChoices(s, (p) => {
      if (p.kind === 'select') return [covered.uid];
      if (p.kind === 'select-line') return ['line:2']; // 目标线由玩家选择（≠ covered 所在线 1）
      return pickFirst(p);
    });
    expect(s.players[0].hand).toHaveLength(handBefore - 1 + 3); // 打出 1 张 + 抽 3
    expect(covered.zone).toBe('field');
    expect(covered.line).toBe(2); // 移到所选目标线（对手侧同线号）
    expect(covered.faceUp).toBe(true); // 被盖住的牌保持原状（未翻面）
    expect(s.players[1].stacks[1].map((c) => c.uid)).toEqual([top.uid]); // 源堆叠只剩顶卡
    expect(s.players[1].stacks[2].map((c) => c.uid)).toContain(covered.uid);
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

  it('darkness-0: same-column covered card is selectable; target-line choice excludes its line', () => {
    const s = draftDarknessP1();
    advanceToStep(s, 0, 'action');
    // 对手线 0（= 效果所在列）：被盖住的覆盖卡 —— 目标线改为玩家选择后同列卡平移合法，候选不再排除
    const sameLine = makeCard('water-1', 1, 'field', true, 0, 0);
    const sameTop = makeCard('water-2', 1, 'field', true, 0, 1);
    s.players[1].stacks[0] = [sameLine, sameTop];
    // 对手线 1：另一张被覆盖卡（同样可选）
    const other = makeCard('water-3', 1, 'field', true, 1, 0);
    const otherTop = makeCard('water-4', 1, 'field', true, 1, 1);
    s.players[1].stacks[1] = [other, otherTop];
    s.players[0].hand = [makeCard('darkness-0', 0, 'hand')];
    const card = s.players[0].hand[0];
    executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: true, line: darknessLine(s) });
    const p = s.pendingEffects[s.pendingEffects.length - 1];
    expect(p.prompt?.kind).toBe('select');
    expect(p.prompt?.candidates.map((c) => c.uid).sort()).toEqual([sameLine.uid, other.uid].sort()); // 同列卡可选
    executeAction(s, 0, 'effect-choice', { promptId: p.id, choice: [sameLine.uid] });
    // 目标线排除所选卡所在线（0）→ 可选 [1, 2]
    const p2 = s.pendingEffects[s.pendingEffects.length - 1];
    expect(p2.prompt?.kind).toBe('select-line');
    expect(p2.prompt?.lines).toEqual([1, 2]);
    executeAction(s, 0, 'effect-choice', { promptId: p2.id, choice: ['line:1'] });
    expect(sameLine.line).toBe(1); // 同列覆盖卡成功平移到玩家选择的线
    expect(s.pendingEffects).toHaveLength(0);
  });

  it('darkness-0: covered cards all on one column still work — no fizzle, target line excludes that column', () => {
    const s = draftDarknessP1();
    advanceToStep(s, 0, 'action');
    const covered = makeCard('water-1', 1, 'field', true, 0, 0);
    const top = makeCard('water-2', 1, 'field', true, 0, 1);
    s.players[1].stacks[0] = [covered, top];
    s.players[0].hand = [makeCard('darkness-0', 0, 'hand')];
    const handBefore = s.players[0].hand.length;
    const card = s.players[0].hand[0];
    executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: true, line: darknessLine(s) });
    // 存在覆盖卡 → 不 fizzle：出现手牌选择（候选 = covered）
    const p = s.pendingEffects[s.pendingEffects.length - 1];
    expect(p.prompt?.kind).toBe('select');
    expect(p.prompt?.candidates.map((c) => c.uid)).toEqual([covered.uid]);
    executeAction(s, 0, 'effect-choice', { promptId: p.id, choice: [covered.uid] });
    const p2 = s.pendingEffects[s.pendingEffects.length - 1];
    expect(p2.prompt?.kind).toBe('select-line');
    expect(p2.prompt?.lines).toEqual([1, 2]); // 排除覆盖卡所在线 0
    executeAction(s, 0, 'effect-choice', { promptId: p2.id, choice: ['line:2'] });
    expect(covered.line).toBe(2); // 平移成功（不再 fizzle）
    expect(s.players[0].hand).toHaveLength(handBefore - 1 + 3); // 抽 3 仍结算
    expect(s.pendingEffects).toHaveLength(0);
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
    // 目标线选择（≠ covered 所在线 1）
    const p2 = s.pendingEffects[s.pendingEffects.length - 1];
    expect(p2.prompt?.kind).toBe('select-line');
    executeAction(s, 0, 'effect-choice', { promptId: p2.id, choice: ['line:2'] });
    expect(s.pendingEffects).toHaveLength(0); // fire-0 中指令未被重新触发（无新挂起选择）
    expect(s.pendingShift).toHaveLength(0);
    expect(s.players[0].hand).toHaveLength(handBefore - 1 + 3); // 仅 darkness-0 抽 3，fire-0 中指令未跑（无额外抽 2）
    expect(s.players[1].stacks[1].map((c) => c.uid)).toEqual([fire0.uid]); // 顶卡原样保留
    expect(covered.line).toBe(2); // 覆盖卡平移落地到所选线
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

  it('darkness-1: shift options include its own row (only exclude the flipped card line)', () => {
    const s = draftDarknessP1();
    advanceToStep(s, 0, 'action');
    // 被翻卡在对手线 1（≠ darkness-1 所在线 0）→ darkness-1 自己的线（0）是合法平移目标
    const target = makeCard('water-1', 1, 'field', false, 1, 0);
    s.players[1].stacks[1] = [target];
    s.players[0].hand = [makeCard('darkness-1', 0, 'hand')];
    const card = s.players[0].hand[0];
    executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: true, line: darknessLine(s) });
    const p1 = s.pendingEffects[s.pendingEffects.length - 1];
    executeAction(s, 0, 'effect-choice', { promptId: p1.id, choice: [target.uid] });
    const p2 = s.pendingEffects[s.pendingEffects.length - 1];
    expect(p2.prompt?.kind).toBe('select-line');
    // 仅排除被翻卡当前线（1）；darkness-1 所在线（0）仍可选（平移到自己的线合法）
    expect(p2.prompt?.lines).toEqual([0, 2]);
    executeAction(s, 0, 'effect-choice', { promptId: p2.id, choice: ['line:0'] });
    expect(target.line).toBe(0); // 平移到 darkness-1 自己的线（对手侧同线号）
    expect(s.players[1].stacks[0].map((c) => c.uid)).toEqual([target.uid]);
    expect(s.pendingEffects).toHaveLength(0);
  });

  it('darkness-1: when the flipped card is on its own line, that line is still excluded (shift-to-same-line throws)', () => {
    const s = draftDarknessP1();
    advanceToStep(s, 0, 'action');
    // 被翻卡在对手线 0（= darkness-1 所在线）→ 该线仍被排除
    const target = makeCard('water-1', 1, 'field', false, 0, 0);
    s.players[1].stacks[0] = [target];
    s.players[0].hand = [makeCard('darkness-1', 0, 'hand')];
    const card = s.players[0].hand[0];
    executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: true, line: darknessLine(s) });
    const p1 = s.pendingEffects[s.pendingEffects.length - 1];
    executeAction(s, 0, 'effect-choice', { promptId: p1.id, choice: [target.uid] });
    const p2 = s.pendingEffects[s.pendingEffects.length - 1];
    expect(p2.prompt?.kind).toBe('select-line');
    expect(p2.prompt?.lines).toEqual([1, 2]);
    // 平移校验：目标线 = 被翻卡当前线 0 → 抛错（引擎防线）
    expect(() => executeAction(s, 0, 'effect-choice', { promptId: p2.id, choice: ['line:0'] })).toThrow(/invalid line selection/);
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

  it('darkness-3: plays a chosen hand card face-down onto a chosen different line (deck untouched)', () => {
    const s = draftDarknessP1();
    advanceToStep(s, 0, 'action');
    const deckLen = s.players[0].deck.length;
    s.players[0].hand = [makeCard('darkness-3', 0, 'hand'), makeCard('water-1', 0, 'hand')];
    const chosen = s.players[0].hand.find((c) => c.defId === 'water-1')!;
    const card = s.players[0].hand.find((c) => c.defId === 'darkness-3')!;
    executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: true, line: darknessLine(s) });
    resolveAllChoices(s, (p) => {
      if (p.kind === 'select') return [chosen.uid]; // 选手牌（候选只剩 water-1）
      if (p.kind === 'select-line') return ['line:2'];
      return pickFirst(p);
    });
    expect(s.players[0].hand.map((c) => c.uid)).not.toContain(chosen.uid); // 手牌被取走
    expect(chosen.zone).toBe('field');
    expect(chosen.line).toBe(2);
    expect(chosen.faceUp).toBe(false); // 反面落地
    expect(s.players[0].stacks[2].map((c) => c.uid)).toContain(chosen.uid);
    expect(s.players[0].deck).toHaveLength(deckLen); // 牌库不变（不再打牌堆顶）
    expect(s.pendingEffects).toHaveLength(0);
    expect(s.pendingPlay).toHaveLength(0);
  });

  it('darkness-3: empty hand fizzles (no playFromHand, no deadlock)', () => {
    const s = draftDarknessP1();
    advanceToStep(s, 0, 'action');
    const deckLen = s.players[0].deck.length;
    s.players[0].hand = [makeCard('darkness-3', 0, 'hand')];
    const card = s.players[0].hand[0];
    executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: true, line: darknessLine(s) });
    resolveAllChoices(s, (p) => (p.kind === 'select-line' ? ['line:2'] : pickFirst(p)));
    // 手牌已空（darkness-3 打出后）→ 无手牌候选 → 选择步骤自动跳过 → fizzle
    expect(s.players[0].stacks[2]).toHaveLength(0); // 未打出任何牌
    expect(s.players[0].deck).toHaveLength(deckLen); // 牌库不变
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
