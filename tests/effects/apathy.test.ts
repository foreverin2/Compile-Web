import { describe, it, expect } from 'vitest';
import type { EffectStep, GameState, Line, StepResult } from '../../src/core/models/types';
import { executeAction } from '../../src/core/game';
import { collectTriggers } from '../../src/core/effects/triggers';
import { runStack } from '../../src/core/effects/resolve';
import { stackValue } from '../../src/core/state/create';
import { makeCard, pickFirst, resolveAllChoices, draftApathyP1, advanceToStep } from '../helpers';

function apathyLine(s: GameState): Line {
  const idx = s.players[0].protocols.findIndex((p) => p.defId === 'apathy');
  return idx as Line;
}

describe('apathy protocol effects', () => {
  describe('apathy-0 top: each face-down card in the line adds +1 to your line total (valueModifier own-stack)', () => {
    it('counts face-down cards on BOTH sides of the line (covered included) and adds to the owner total', () => {
      const s = draftApathyP1();
      // P1 线0：apathy-0（0 分正面）+ water-1（反面）；P2 线0：water-1（反面）
      s.players[0].stacks[0] = [
        makeCard('apathy-0', 0, 'field', true, 0, 0),
        makeCard('water-1', 0, 'field', false, 0, 1),
      ];
      s.players[1].stacks[0] = [makeCard('water-1', 1, 'field', false, 0, 0)];
      expect(stackValue(s, 0, 0)).toBe(4); // 底值 0+2=2；此列反面牌 2 张 → +2 = 4
      expect(stackValue(s, 1, 0)).toBe(2); // 对手估值不受 own-stack 修正影响
    });

    it('face-up covered apathy-0 still applies (top command: faceUp gate, not uncovered)', () => {
      const s = draftApathyP1();
      s.players[0].stacks[0] = [
        makeCard('apathy-0', 0, 'field', true, 0, 0),
        makeCard('water-1', 0, 'field', false, 0, 1), // 盖住 apathy-0
      ];
      expect(stackValue(s, 0, 0)).toBe(3); // 底值 0+2=2；此列反面牌 1 张 → +1 = 3
    });

    it('face-down apathy-0 grants nothing (背面卡无任何效果)', () => {
      const s = draftApathyP1();
      s.players[0].stacks[0] = [makeCard('apathy-0', 0, 'field', false, 0, 0)];
      expect(stackValue(s, 0, 0)).toBe(2);
    });

    it('each face-up apathy-0 applies its own bonus (per-card top command)', () => {
      const s = draftApathyP1();
      s.players[0].stacks[0] = [
        makeCard('apathy-0', 0, 'field', true, 0, 0),
        makeCard('apathy-0', 0, 'field', true, 0, 1),
        makeCard('water-1', 0, 'field', false, 0, 2),
      ];
      s.players[1].stacks[0] = [makeCard('water-1', 1, 'field', false, 0, 0)];
      expect(stackValue(s, 0, 0)).toBe(6); // 底值 0+0+2=2；两张 apathy-0 × 2 张反面 = +4 → 6
    });
  });

  describe('apathy-1 middle: flip all other face-up cards in your stack on this line', () => {
    it('flips every other face-up card in the own line stack (covered included), self stays face-up', () => {
      const s = draftApathyP1();
      advanceToStep(s, 0, 'action');
      const al = apathyLine(s);
      const coveredUp = makeCard('water-0', 0, 'field', true, al, 0);
      const topUp = makeCard('water-1', 0, 'field', true, al, 1);
      s.players[0].stacks[al] = [coveredUp, topUp];
      s.players[0].hand = [makeCard('apathy-1', 0, 'hand')];
      const card = s.players[0].hand[0];
      executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: true, line: al });
      resolveAllChoices(s, pickFirst); // 无选择请求（逐张自动 flip）
      expect(coveredUp.faceUp).toBe(false); // 被盖的正面卡也翻（allowCovered）
      expect(topUp.faceUp).toBe(false); // 正面卡（落地后也被盖）翻转
      expect(card.faceUp).toBe(true); // 自己不翻
      expect(s.players[0].stacks[al].map((c) => c.uid)).toEqual([coveredUp.uid, topUp.uid, card.uid]);
      expect(s.pendingEffects).toHaveLength(0);
    });

    it('face-down cards are untouched; only face-up covered cards flip', () => {
      const s = draftApathyP1();
      advanceToStep(s, 0, 'action');
      const al = apathyLine(s);
      const coveredUp = makeCard('water-0', 0, 'field', true, al, 0);
      const faceDownTop = makeCard('water-2', 0, 'field', false, al, 1);
      s.players[0].stacks[al] = [coveredUp, faceDownTop];
      s.players[0].hand = [makeCard('apathy-1', 0, 'hand')];
      const card = s.players[0].hand[0];
      executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: true, line: al });
      resolveAllChoices(s, pickFirst);
      expect(coveredUp.faceUp).toBe(false); // 唯一正面目标被翻
      expect(faceDownTop.faceUp).toBe(false); // 反面不动
      expect(card.faceUp).toBe(true);
      expect(s.pendingEffects).toHaveLength(0);
    });

    it('opponent face-up cards on the same line are NOT flipped (此列 = own stack)', () => {
      const s = draftApathyP1();
      advanceToStep(s, 0, 'action');
      const al = apathyLine(s);
      const oppUp = makeCard('water-5', 1, 'field', true, al, 0);
      s.players[1].stacks[al] = [oppUp];
      s.players[0].hand = [makeCard('apathy-1', 0, 'hand')];
      const card = s.players[0].hand[0];
      executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: true, line: al });
      resolveAllChoices(s, pickFirst);
      expect(oppUp.faceUp).toBe(true); // 对手卡不动
      expect(card.faceUp).toBe(true);
      expect(s.pendingEffects).toHaveLength(0);
    });

    it('no other face-up card on the line → fizzles without hanging', () => {
      const s = draftApathyP1();
      advanceToStep(s, 0, 'action');
      const al = apathyLine(s);
      s.players[0].stacks[al] = [makeCard('water-1', 0, 'field', false, al, 0)];
      s.players[0].hand = [makeCard('apathy-1', 0, 'hand')];
      const card = s.players[0].hand[0];
      executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: true, line: al });
      resolveAllChoices(s, pickFirst);
      expect(s.pendingEffects).toHaveLength(0);
      expect(card.faceUp).toBe(true);
    });

    it('integration: a face-up (covered) apathy-2 on the line nullifies the apathy-1 middle (A2)', () => {
      const s = draftApathyP1();
      advanceToStep(s, 0, 'action');
      const al = apathyLine(s);
      s.players[0].stacks[al] = [
        makeCard('apathy-2', 0, 'field', true, al, 0), // 被盖但正面的 apathy-2 顶命令常驻
        makeCard('water-1', 0, 'field', false, al, 1),
      ];
      const target = makeCard('water-0', 0, 'field', true, 1, 0);
      s.players[0].stacks[1] = [target];
      s.players[0].hand = [makeCard('apathy-1', 0, 'hand')];
      const card = s.players[0].hand[0];
      executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: true, line: al });
      resolveAllChoices(s, pickFirst);
      expect(target.faceUp).toBe(true); // 中指令被无效化 → 未翻转
      expect(s.pendingEffects).toHaveLength(0);
    });
  });

  describe('apathy-2 bottom: before being covered, flip this card', () => {
    it('playing onto a face-up apathy-2 flips it face-down before the card lands', () => {
      const s = draftApathyP1();
      advanceToStep(s, 0, 'action');
      const al = apathyLine(s);
      const a2 = makeCard('apathy-2', 0, 'field', true, al, 0);
      s.players[0].stacks[al] = [a2];
      s.players[0].hand = [makeCard('water-1', 0, 'hand')];
      const cover = s.players[0].hand[0];
      executeAction(s, 0, 'play', { cardUid: cover.uid, faceUp: false, line: al });
      resolveAllChoices(s, pickFirst);
      expect(a2.faceUp).toBe(false); // 被盖住前：先翻转此牌
      expect(a2.zone).toBe('field'); // 仍被盖在下面
      expect(s.players[0].stacks[al].map((c) => c.uid)).toEqual([a2.uid, cover.uid]);
      expect(s.pendingEffects).toHaveLength(0);
    });

    it('the flip deactivates the top command → the covering card middle fires after landing', () => {
      const s = draftApathyP1();
      advanceToStep(s, 0, 'action');
      const al = apathyLine(s);
      const a2 = makeCard('apathy-2', 0, 'field', true, al, 0);
      s.players[0].stacks[al] = [a2];
      const target = makeCard('water-5', 1, 'field', true, 2, 0);
      s.players[1].stacks[2] = [target];
      s.players[0].hand = [makeCard('apathy-3', 0, 'hand')]; // 中指令：翻转1张对手的正面牌
      const cover = s.players[0].hand[0];
      executeAction(s, 0, 'play', { cardUid: cover.uid, faceUp: true, line: al });
      const p = s.pendingEffects[s.pendingEffects.length - 1];
      expect(a2.faceUp).toBe(false); // 先翻转自己
      expect(p.prompt?.kind).toBe('select'); // apathy-3 中指令未被无效化 → 挂起选择
      expect(p.prompt?.title).toContain('apathy-3');
      executeAction(s, 0, 'effect-choice', { promptId: p.id, choice: [target.uid] });
      expect(target.faceUp).toBe(false); // 翻转生效
      expect(s.pendingEffects).toHaveLength(0);
    });

    it('before-covered also fires on a shift landing onto the apathy-2 top (completeShift path)', () => {
      const s = draftApathyP1();
      advanceToStep(s, 0, 'action');
      const al = apathyLine(s);
      const a2 = makeCard('apathy-2', 0, 'field', true, al, 0);
      s.players[0].stacks[al] = [a2];
      const mover = makeCard('water-1', 0, 'field', false, 1, 0);
      s.players[0].stacks[1] = [mover];
      s.pendingEffects.push({
        id: 'e-shift-a2',
        player: 0,
        gen: (function* (): Generator<EffectStep, void, StepResult> {
          yield { op: 'shift', uid: mover.uid, targetLine: al };
        })(),
        sourceUid: 'sys-shift',
        sourceDefId: 'system',
        system: true,
        prompt: null,
        lastAnswer: null,
      });
      runStack(s);
      expect(a2.faceUp).toBe(false); // 偏转落地前也触发被盖住前
      expect(s.players[0].stacks[al].map((c) => c.uid)).toEqual([a2.uid, mover.uid]);
      expect(s.pendingEffects).toHaveLength(0);
      expect(s.pendingShift).toHaveLength(0);
    });

    it('registers no end/start trigger (only before-covered hook)', () => {
      const s = draftApathyP1();
      advanceToStep(s, 0, 'end');
      const al = apathyLine(s);
      s.players[0].stacks[al] = [makeCard('apathy-2', 0, 'field', true, al, 0)];
      expect(collectTriggers(s, 'end')).toHaveLength(0);
    });
  });

  describe('apathy-3 middle: flip 1 opponent face-up card', () => {
    it('selects among the opponent top face-up cards and flips the chosen one', () => {
      const s = draftApathyP1();
      advanceToStep(s, 0, 'action');
      const al = apathyLine(s);
      const oppUp = makeCard('water-5', 1, 'field', true, 1, 0);
      const oppDown = makeCard('water-4', 1, 'field', false, 2, 0);
      s.players[1].stacks[1] = [oppUp];
      s.players[1].stacks[2] = [oppDown];
      s.players[0].hand = [makeCard('apathy-3', 0, 'hand')];
      const card = s.players[0].hand[0];
      executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: true, line: al });
      const p = s.pendingEffects[s.pendingEffects.length - 1];
      expect(p.prompt?.kind).toBe('select');
      expect(p.prompt?.min).toBe(1);
      expect(p.prompt?.max).toBe(1);
      expect(p.prompt?.candidates.map((c) => c.uid)).toEqual([oppUp.uid]); // 只列对手正面顶卡
      executeAction(s, 0, 'effect-choice', { promptId: p.id, choice: [oppUp.uid] });
      expect(oppUp.faceUp).toBe(false); // 翻转
      expect(card.faceUp).toBe(true); // 自身不翻
      expect(s.pendingEffects).toHaveLength(0);
    });

    it('opponent has no face-up top card → fizzles without hanging', () => {
      const s = draftApathyP1();
      advanceToStep(s, 0, 'action');
      const al = apathyLine(s);
      s.players[1].stacks[1] = [makeCard('water-4', 1, 'field', false, 1, 0)];
      s.players[0].hand = [makeCard('apathy-3', 0, 'hand')];
      const card = s.players[0].hand[0];
      executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: true, line: al });
      resolveAllChoices(s, pickFirst);
      expect(s.pendingEffects).toHaveLength(0);
      expect(s.players[1].stacks[1][0].faceUp).toBe(false);
      expect(card.faceUp).toBe(true);
    });
  });

  describe('apathy-4 middle: you may flip 1 of your covered face-up cards', () => {
    it('offers only your covered face-up cards; flipping one works (allowCovered)', () => {
      const s = draftApathyP1();
      advanceToStep(s, 0, 'action');
      const al = apathyLine(s);
      const coveredUp = makeCard('water-0', 0, 'field', true, 1, 0);
      const top = makeCard('water-1', 0, 'field', true, 1, 1);
      s.players[0].stacks[1] = [coveredUp, top];
      s.players[0].hand = [makeCard('apathy-4', 0, 'hand')];
      const card = s.players[0].hand[0];
      executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: true, line: al });
      const p = s.pendingEffects[s.pendingEffects.length - 1];
      expect(p.prompt?.kind).toBe('select');
      expect(p.prompt?.optional).toBe(true); // 可选
      expect(p.prompt?.min).toBe(1);
      expect(p.prompt?.max).toBe(1);
      expect(p.prompt?.candidates.map((c) => c.uid)).toEqual([coveredUp.uid]); // 顶卡与被盖反面牌排除
      executeAction(s, 0, 'effect-choice', { promptId: p.id, choice: [coveredUp.uid] });
      expect(coveredUp.faceUp).toBe(false); // 被盖卡翻转（allowCovered）
      expect(top.faceUp).toBe(true);
      expect(s.pendingEffects).toHaveLength(0);
    });

    it('optional skip → nothing flips', () => {
      const s = draftApathyP1();
      advanceToStep(s, 0, 'action');
      const al = apathyLine(s);
      const coveredUp = makeCard('water-0', 0, 'field', true, 1, 0);
      const top = makeCard('water-1', 0, 'field', true, 1, 1);
      s.players[0].stacks[1] = [coveredUp, top];
      s.players[0].hand = [makeCard('apathy-4', 0, 'hand')];
      const card = s.players[0].hand[0];
      executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: true, line: al });
      const p = s.pendingEffects[s.pendingEffects.length - 1];
      executeAction(s, 0, 'effect-choice', { promptId: p.id, choice: [] });
      expect(coveredUp.faceUp).toBe(true); // 未翻转
      expect(top.faceUp).toBe(true);
      expect(s.pendingEffects).toHaveLength(0);
    });

    it('no covered face-up card → fizzles without hanging (optional auto-skip)', () => {
      const s = draftApathyP1();
      advanceToStep(s, 0, 'action');
      const al = apathyLine(s);
      s.players[0].stacks[1] = [
        makeCard('water-1', 0, 'field', false, 1, 0),
        makeCard('water-2', 0, 'field', false, 1, 1),
      ];
      s.players[0].hand = [makeCard('apathy-4', 0, 'hand')];
      const card = s.players[0].hand[0];
      executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: true, line: al });
      resolveAllChoices(s, pickFirst);
      expect(s.pendingEffects).toHaveLength(0);
      expect(card.faceUp).toBe(true);
    });
  });

  describe('apathy-5 middle: discard 1', () => {
    it('discards 1 from hand', () => {
      const s = draftApathyP1();
      advanceToStep(s, 0, 'action');
      s.players[0].hand = [makeCard('apathy-5', 0, 'hand'), makeCard('apathy-0', 0, 'hand')];
      const target = s.players[0].hand.find((c) => c.defId === 'apathy-5')!;
      const other = s.players[0].hand.find((c) => c.defId !== 'apathy-5')!;
      executeAction(s, 0, 'play', { cardUid: target.uid, faceUp: true, line: apathyLine(s) });
      resolveAllChoices(s, (p) => [other.uid]); // 弃 apathy-0
      expect(s.players[0].trash.map((c) => c.uid)).toEqual([other.uid]);
      expect(s.players[0].hand).toHaveLength(0);
      expect(s.players[0].stacks[apathyLine(s)].map((c) => c.uid)).toEqual([target.uid]);
    });

    it('empty hand → fizzles without hanging', () => {
      const s = draftApathyP1();
      advanceToStep(s, 0, 'action');
      s.players[0].hand = [makeCard('apathy-5', 0, 'hand')];
      const card = s.players[0].hand[0];
      executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: true, line: apathyLine(s) });
      resolveAllChoices(s, pickFirst);
      expect(s.pendingEffects).toHaveLength(0);
      expect(s.players[0].trash).toHaveLength(0); // 无牌可弃
    });
  });
});
