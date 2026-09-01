import { describe, it, expect } from 'vitest';
import type { EffectStep, GameState, Line, StepResult } from '../../src/core/models/types';
import { executeAction, getLegalActions } from '../../src/core/game';
import { getCompilableLines } from '../../src/core/rules/compile';
import { collectTriggers } from '../../src/core/effects/triggers';
import { runStack } from '../../src/core/effects/resolve';
import { stackValue } from '../../src/core/state/create';
import { makeCard, pickFirst, resolveAllChoices, draftMetalP1, advanceToStep } from '../helpers';

function metalLine(s: GameState): Line {
  const idx = s.players[0].protocols.findIndex((p) => p.defId === 'metal');
  return idx as Line;
}

describe('metal protocol effects', () => {
  describe('metal-0 top: opponent line total -2 (valueModifier)', () => {
    it('opponent valuation on the line is reduced by 2; own valuation unaffected', () => {
      const s = draftMetalP1();
      s.players[0].stacks[0] = [makeCard('fire-5', 0, 'field', true, 0, 0)]; // 5
      s.players[1].stacks[0] = [makeCard('metal-0', 1, 'field', true, 0, 0)]; // 0
      expect(stackValue(s, 0, 0)).toBe(3); // 5 + 0 - 2：对手线正面 metal-0 修正我方估值
      expect(stackValue(s, 1, 0)).toBe(0); // 自己的估值不受 opponent-line 修正影响
    });

    it('persists while covered (face-up covered metal-0 still applies -2 to opponent valuation)', () => {
      const s = draftMetalP1();
      s.players[0].stacks[0] = [makeCard('fire-5', 0, 'field', true, 0, 0)]; // 5
      const metal0 = makeCard('metal-0', 1, 'field', true, 0, 0);
      const cover = makeCard('fire-1', 1, 'field', true, 0, 1); // 盖住 metal-0
      s.players[1].stacks[0] = [metal0, cover];
      expect(stackValue(s, 0, 0)).toBe(3); // 5 - 2：被盖但正面朝上的顶命令仍生效
    });

    it('face-down metal-0 grants nothing (背面卡无任何效果)', () => {
      const s = draftMetalP1();
      s.players[0].stacks[0] = [makeCard('fire-5', 0, 'field', true, 0, 0)];
      s.players[1].stacks[0] = [makeCard('metal-0', 1, 'field', false, 0, 0)];
      expect(stackValue(s, 0, 0)).toBe(5);
    });

    it('each face-up metal-0 applies -2 (per-card top command)', () => {
      const s = draftMetalP1();
      s.players[0].stacks[0] = [makeCard('fire-5', 0, 'field', true, 0, 0)];
      s.players[1].stacks[0] = [
        makeCard('metal-0', 1, 'field', true, 0, 0),
        makeCard('metal-0', 1, 'field', true, 0, 1),
      ];
      expect(stackValue(s, 0, 0)).toBe(5 - 4);
    });
  });

  describe('metal-0 middle: flip 1 card', () => {
    it('selects 1 uncovered field top card (self excluded) and flips it', () => {
      const s = draftMetalP1();
      advanceToStep(s, 0, 'action');
      const target = makeCard('fire-5', 1, 'field', true, 1, 0); // 对手另列正面顶卡
      s.players[1].stacks[1] = [target];
      s.players[0].hand = [makeCard('metal-0', 0, 'hand')];
      const card = s.players[0].hand[0];
      executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: true, line: metalLine(s) });
      const p = s.pendingEffects[s.pendingEffects.length - 1];
      expect(p.prompt?.kind).toBe('select');
      expect(p.prompt?.min).toBe(1);
      expect(p.prompt?.max).toBe(1);
      expect(p.prompt?.candidates.map((c) => c.uid)).toEqual([target.uid]); // 源卡被候选排除
      executeAction(s, 0, 'effect-choice', { promptId: p.id, choice: [target.uid] });
      expect(target.faceUp).toBe(false); // 翻转
      expect(card.faceUp).toBe(true); // 自身不翻
      expect(s.pendingEffects).toHaveLength(0);
    });

    it('no other field top card → fizzles without hanging', () => {
      const s = draftMetalP1();
      advanceToStep(s, 0, 'action');
      s.players[0].hand = [makeCard('metal-0', 0, 'hand')];
      const card = s.players[0].hand[0];
      executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: true, line: metalLine(s) });
      resolveAllChoices(s, pickFirst);
      expect(s.pendingEffects).toHaveLength(0);
      expect(card.faceUp).toBe(true); // 源卡不被翻转
    });
  });

  describe('metal-1 middle: draw 2, opponent cannot compile next turn', () => {
    it('draws 2 and sets compileBlocked = opponent (P2)', () => {
      const s = draftMetalP1();
      advanceToStep(s, 0, 'action');
      const ml = metalLine(s);
      s.players[0].hand = [makeCard('metal-1', 0, 'hand')];
      const deckBefore = s.players[0].deck.length;
      const card = s.players[0].hand[0];
      executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: true, line: ml });
      resolveAllChoices(s, pickFirst); // 纯抽牌，无选择
      expect(s.players[0].hand).toHaveLength(2);
      expect(s.players[0].deck).toHaveLength(deckBefore - 2);
      expect(s.compileBlocked).toBe(1); // 对手下回合不能编译
      expect(s.pendingEffects).toHaveLength(0);
    });

    it('blocked player cannot compile even with a winnable line (check-compile guards)', () => {
      const s = draftMetalP1();
      advanceToStep(s, 0, 'action');
      const ml = metalLine(s);
      s.players[0].hand = [makeCard('metal-1', 0, 'hand')];
      executeAction(s, 0, 'play', { cardUid: s.players[0].hand[0].uid, faceUp: true, line: ml });
      resolveAllChoices(s, pickFirst);
      expect(s.compileBlocked).toBe(1);
      // P2 回合 check-compile：线 0 堆满 10 点（water-1 值 1 × 10）仍不可编译
      s.turnPlayer = 1;
      s.step = 'check-compile';
      for (let i = 0; i < 10; i++) s.players[1].stacks[0].push(makeCard('water-1', 1, 'field', true, 0, i));
      expect(getCompilableLines(s, 1)).toEqual([]);
      expect(() => executeAction(s, 1, 'compile', { line: 0 })).toThrow();
    });

    it('cleared when the blocked player turn ends (end → start transition)', () => {
      const s = draftMetalP1();
      advanceToStep(s, 0, 'action');
      const ml = metalLine(s);
      s.players[0].hand = [makeCard('metal-1', 0, 'hand')];
      executeAction(s, 0, 'play', { cardUid: s.players[0].hand[0].uid, faceUp: true, line: ml });
      resolveAllChoices(s, pickFirst);
      expect(s.compileBlocked).toBe(1);
      // P1 回合结束 → P2（被禁）回合开始：仍生效
      advanceToStep(s, 0, 'end');
      executeAction(s, 0, 'advance');
      expect(s.turnPlayer).toBe(1);
      expect(s.compileBlocked).toBe(1);
      // P2 回合结束 → 清除（只禁一回合）
      advanceToStep(s, 1, 'end');
      executeAction(s, 1, 'advance');
      expect(s.turnPlayer).toBe(0);
      expect(s.compileBlocked).toBeNull();
    });
  });

  describe('metal-2 top: no effect registration (lineBlocksOpponentFaceDown wired in A2)', () => {
    it('face-up play of metal-2 produces no pending effect (no middle registered)', () => {
      const s = draftMetalP1();
      advanceToStep(s, 0, 'action');
      const ml = metalLine(s);
      s.players[0].hand = [makeCard('metal-2', 0, 'hand')];
      const card = s.players[0].hand[0];
      executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: true, line: ml });
      resolveAllChoices(s, pickFirst);
      expect(s.players[0].stacks[ml].map((c) => c.defId)).toEqual(['metal-2']);
      expect(s.pendingEffects).toHaveLength(0); // 无中指令 → 无效果入栈
    });

    it('opponent cannot play face-down into the line; face-up play stays legal', () => {
      const s = draftMetalP1();
      advanceToStep(s, 0, 'action');
      const ml = metalLine(s);
      s.players[1].stacks[ml].push(makeCard('metal-2', 1, 'field', true, ml, 0)); // P2 线 ml 顶命令
      s.players[0].hand = [makeCard('metal-1', 0, 'hand')];
      const legal = getLegalActions(s, 0);
      expect(legal.some((a) => a.kind === 'play' && a.faceUp === false && a.line === ml)).toBe(false);
      expect(() =>
        executeAction(s, 0, 'play', { cardUid: s.players[0].hand[0].uid, faceUp: false, line: ml }),
      ).toThrow(/cannot play face-down/);
      expect(() =>
        executeAction(s, 0, 'play', { cardUid: s.players[0].hand[0].uid, faceUp: true, line: ml }),
      ).not.toThrow(); // 反面禁，正面仍可
    });
  });

  describe('metal-3 middle: draw 1, delete all cards of another line with ≥8 cards', () => {
    it('auto-deletes the only qualifying line (both players, covered included)', () => {
      const s = draftMetalP1();
      advanceToStep(s, 0, 'action');
      const ml = metalLine(s);
      const l1: Line = 1;
      // 双方堆叠合计 8 张（含被盖：每堆 4 张中 3 张被盖）→ 唯一符合条件列
      const p1Stack = Array.from({ length: 4 }, (_, i) => makeCard('metal-1', 0, 'field', false, l1, i));
      const p2Stack = Array.from({ length: 4 }, (_, i) => makeCard('water-1', 1, 'field', false, l1, i));
      const p1Uids = p1Stack.map((c) => c.uid).sort(); // 删除会 splice 掉 stacks 数组本身 → 先快照 uid
      const p2Uids = p2Stack.map((c) => c.uid).sort();
      s.players[0].stacks[l1] = p1Stack;
      s.players[1].stacks[l1] = p2Stack;
      s.players[0].hand = [makeCard('metal-3', 0, 'hand')];
      const card = s.players[0].hand[0];
      executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: true, line: ml });
      resolveAllChoices(s, pickFirst); // 单列符合 → 无 select-line
      expect(s.players[0].hand).toHaveLength(1); // −metal-3 +抽 1
      expect(s.players[0].stacks[l1]).toHaveLength(0); // 该列全部清空
      expect(s.players[1].stacks[l1]).toHaveLength(0);
      expect(s.players[0].trash.map((c) => c.uid).sort()).toEqual(p1Uids);
      expect(s.players[1].trash.map((c) => c.uid).sort()).toEqual(p2Uids);
      expect(s.players[0].stacks[ml].map((c) => c.uid)).toEqual([card.uid]); // 源列不受影响
      expect(s.pendingEffects).toHaveLength(0);
    });

    it('two qualifying lines → select-line; only the chosen line is deleted', () => {
      const s = draftMetalP1();
      advanceToStep(s, 0, 'action');
      const ml = metalLine(s);
      for (const line of [1, 2] as Line[]) {
        s.players[0].stacks[line] = Array.from({ length: 4 }, (_, i) => makeCard('metal-1', 0, 'field', false, line, i));
        s.players[1].stacks[line] = Array.from({ length: 4 }, (_, i) => makeCard('water-1', 1, 'field', false, line, i));
      }
      const line2Uids = [...s.players[0].stacks[2], ...s.players[1].stacks[2]].map((c) => c.uid);
      s.players[0].hand = [makeCard('metal-3', 0, 'hand')];
      const card = s.players[0].hand[0];
      executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: true, line: ml });
      const p = s.pendingEffects[s.pendingEffects.length - 1];
      expect(p.prompt?.kind).toBe('select-line');
      expect(p.prompt?.lines).toEqual([1, 2]);
      executeAction(s, 0, 'effect-choice', { promptId: p.id, choice: ['line:2'] });
      expect(s.players[0].stacks[2]).toHaveLength(0);
      expect(s.players[1].stacks[2]).toHaveLength(0);
      expect(s.players[0].stacks[1]).toHaveLength(4); // 未选列不动
      expect(s.players[1].stacks[1]).toHaveLength(4);
      expect([...s.players[0].trash, ...s.players[1].trash].map((c) => c.uid).sort()).toEqual(line2Uids.sort());
      expect(s.pendingEffects).toHaveLength(0);
    });

    it('no qualifying line → fizzle (draw still happens), no hang', () => {
      const s = draftMetalP1();
      advanceToStep(s, 0, 'action');
      const ml = metalLine(s);
      s.players[1].stacks[1] = Array.from({ length: 7 }, (_, i) => makeCard('water-1', 1, 'field', false, 1, i));
      s.players[0].hand = [makeCard('metal-3', 0, 'hand')];
      const card = s.players[0].hand[0];
      executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: true, line: ml });
      resolveAllChoices(s, pickFirst);
      expect(s.players[0].hand).toHaveLength(1); // 抽 1 仍结算
      expect(s.players[1].stacks[1]).toHaveLength(7); // 未删除
      expect(s.pendingEffects).toHaveLength(0);
    });

    it('source line is excluded even with ≥8 cards', () => {
      const s = draftMetalP1();
      advanceToStep(s, 0, 'action');
      const ml = metalLine(s);
      s.players[0].stacks[ml] = Array.from({ length: 8 }, (_, i) => makeCard('metal-1', 0, 'field', false, ml, i));
      s.players[0].hand = [makeCard('metal-3', 0, 'hand')];
      const card = s.players[0].hand[0];
      executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: true, line: ml });
      resolveAllChoices(s, pickFirst);
      expect(s.players[0].stacks[ml]).toHaveLength(9); // 8 + metal-3：源列不被删除
      expect(s.pendingEffects).toHaveLength(0);
    });
  });

  describe('metal-5 middle: discard 1', () => {
    it('discards 1 from hand', () => {
      const s = draftMetalP1();
      advanceToStep(s, 0, 'action');
      s.players[0].hand = [makeCard('metal-5', 0, 'hand'), makeCard('metal-0', 0, 'hand')];
      const target = s.players[0].hand.find((c) => c.defId === 'metal-5')!;
      const other = s.players[0].hand.find((c) => c.defId !== 'metal-5')!;
      executeAction(s, 0, 'play', { cardUid: target.uid, faceUp: true, line: metalLine(s) });
      resolveAllChoices(s, (p) => [other.uid]); // 弃 metal-0
      expect(s.players[0].trash.map((c) => c.uid)).toEqual([other.uid]);
      expect(s.players[0].hand).toHaveLength(0);
      expect(s.players[0].stacks[metalLine(s)].map((c) => c.uid)).toEqual([target.uid]);
    });

    it('empty hand → fizzles without hanging', () => {
      const s = draftMetalP1();
      advanceToStep(s, 0, 'action');
      s.players[0].hand = [makeCard('metal-5', 0, 'hand')];
      const card = s.players[0].hand[0];
      executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: true, line: metalLine(s) });
      resolveAllChoices(s, pickFirst);
      expect(s.pendingEffects).toHaveLength(0);
      expect(s.players[0].trash).toHaveLength(0); // 无牌可弃
    });
  });

  describe('metal-6 top: delete self before covered or flipped', () => {
    it('before-covered: playing a card onto the metal-6 top deletes it first', () => {
      const s = draftMetalP1();
      advanceToStep(s, 0, 'action');
      const below = makeCard('water-1', 1, 'field', false, 1, 0); // 反面底卡（无中指令）
      const m6 = makeCard('metal-6', 1, 'field', true, 1, 1); // 正面顶卡（P2 堆叠）
      s.players[1].stacks[1] = [below, m6];
      // 覆盖必须发生在同一持有者的堆叠内 → P2 打出牌（playFromHand 按卡 owner 落堆叠）
      const played = makeCard('water-1', 1, 'hand');
      s.players[1].hand = [played];
      s.pendingEffects.push({
        id: 'e-cover-m6',
        player: 1,
        gen: (function* (): Generator<EffectStep, void, StepResult> {
          yield { op: 'playFromHand', uid: played.uid, line: 1, faceUp: false };
        })(),
        sourceUid: 'sys-cover',
        sourceDefId: 'system',
        system: true,
        prompt: null,
        lastAnswer: null,
      });
      runStack(s);
      expect(m6.zone).toBe('trash'); // 被盖住前：先删除这张牌
      expect(s.players[1].stacks[1].map((c) => c.uid)).toEqual([below.uid, played.uid]);
      expect(s.pendingEffects).toHaveLength(0);
      expect(s.pendingPlay).toHaveLength(0);
    });

    it('before-flip: flipping the metal-6 deletes it instead (flip does not happen)', () => {
      const s = draftMetalP1();
      advanceToStep(s, 0, 'action');
      const ml = metalLine(s);
      const m6 = makeCard('metal-6', 1, 'field', true, 1, 0);
      s.players[1].stacks[1] = [m6];
      s.players[0].hand = [makeCard('metal-0', 0, 'hand')];
      const card = s.players[0].hand[0];
      executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: true, line: ml });
      const p = s.pendingEffects[s.pendingEffects.length - 1];
      expect(p.prompt?.kind).toBe('select');
      executeAction(s, 0, 'effect-choice', { promptId: p.id, choice: [m6.uid] });
      expect(m6.zone).toBe('trash'); // 翻转前：先删除这张牌
      expect(m6.faceUp).toBe(true); // 未发生翻转（删除置正面）
      expect(s.pendingEffects).toHaveLength(0);
    });

    it('before-flip does NOT fire for a face-down metal-6 (背面卡无任何效果); flip proceeds', () => {
      const s = draftMetalP1();
      advanceToStep(s, 0, 'action');
      const ml = metalLine(s);
      const m6 = makeCard('metal-6', 1, 'field', false, 1, 0); // 反面
      s.players[1].stacks[1] = [m6];
      s.players[0].hand = [makeCard('metal-0', 0, 'hand')];
      const card = s.players[0].hand[0];
      executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: true, line: ml });
      const p = s.pendingEffects[s.pendingEffects.length - 1];
      executeAction(s, 0, 'effect-choice', { promptId: p.id, choice: [m6.uid] });
      expect(m6.faceUp).toBe(true); // 正常翻正
      expect(m6.zone).toBe('field'); // 未被删除
      expect(s.pendingEffects).toHaveLength(0);
    });

    it('covered face-up metal-6 flipped with allowCovered still deletes itself (top command)', () => {
      const s = draftMetalP1();
      advanceToStep(s, 0, 'action');
      const m6 = makeCard('metal-6', 1, 'field', true, 1, 0);
      const cover = makeCard('fire-5', 1, 'field', true, 1, 1); // 顶卡盖住 m6
      s.players[1].stacks[1] = [m6, cover];
      s.pendingEffects.push({
        id: 'e-flip-m6',
        player: 0,
        gen: (function* (): Generator<EffectStep, void, StepResult> {
          yield { op: 'flip', uid: m6.uid, allowCovered: true };
        })(),
        sourceUid: 'sys-flip',
        sourceDefId: 'system',
        system: true,
        prompt: null,
        lastAnswer: null,
      });
      runStack(s);
      expect(m6.zone).toBe('trash'); // 被盖的正面 metal-6 翻转前仍删自己（顶命令被盖仍生效）
      expect(cover.zone).toBe('field'); // 顶卡不动
      expect(cover.faceUp).toBe(true);
      expect(s.pendingEffects).toHaveLength(0);
    });

    it('before-covered also fires on a shift landing onto the metal-6 top (completeShift path)', () => {
      const s = draftMetalP1();
      advanceToStep(s, 0, 'action');
      const m6 = makeCard('metal-6', 1, 'field', true, 1, 0);
      s.players[1].stacks[1] = [m6];
      // 平移落地同样按卡 owner 落堆叠 → mover 必须是 P2 的卡才会盖到 P2 的 metal-6
      const mover = makeCard('water-1', 1, 'field', true, 2, 0);
      s.players[1].stacks[2] = [mover];
      s.pendingEffects.push({
        id: 'e-shift-m6',
        player: 0,
        gen: (function* (): Generator<EffectStep, void, StepResult> {
          yield { op: 'shift', uid: mover.uid, targetLine: 1 };
        })(),
        sourceUid: 'sys-shift',
        sourceDefId: 'system',
        system: true,
        prompt: null,
        lastAnswer: null,
      });
      runStack(s);
      expect(m6.zone).toBe('trash'); // 偏转落地前也触发被盖住前
      expect(s.players[1].stacks[1].map((c) => c.uid)).toEqual([mover.uid]);
      expect(s.pendingEffects).toHaveLength(0);
      expect(s.pendingShift).toHaveLength(0);
    });

    it('registers no end/start trigger (only before-covered / before-flip hooks)', () => {
      const s = draftMetalP1();
      advanceToStep(s, 0, 'end');
      const m6 = makeCard('metal-6', 0, 'field', true, 0, 0);
      s.players[0].stacks[0] = [m6];
      expect(collectTriggers(s, 'end')).toHaveLength(0);
    });
  });
});
