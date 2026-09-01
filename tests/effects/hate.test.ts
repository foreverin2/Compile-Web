import { describe, it, expect } from 'vitest';
import type { GameState, Line } from '../../src/core/models/types';
import { executeAction } from '../../src/core/game';
import { runStack } from '../../src/core/effects/resolve';
import { makeCard, pickFirst, resolveAllChoices, draftHateP1, advanceToStep } from '../helpers';

function hateLine(s: GameState): Line {
  const idx = s.players[0].protocols.findIndex((p) => p.defId === 'hate');
  return idx as Line;
}

/** 测试用 system 效果（无源卡，跳过 sourceValid）执行单个 delete op——模拟任意删除来源 */
function pushDeleteGen(s: GameState, player: 0 | 1, uid: string): void {
  s.pendingEffects.push({
    id: `e-del-${s.pendingEffects.length}`,
    player,
    gen: (function* () {
      yield { op: 'delete', uid };
    })(),
    sourceUid: 'sys-del',
    sourceDefId: 'system',
    system: true,
    prompt: null,
    lastAnswer: null,
  });
}

describe('hate protocol effects', () => {
  describe('hate-0 middle: 删除1张牌。', () => {
    it('selects 1 uncovered field top card (both players; self excluded) and deletes it', () => {
      const s = draftHateP1();
      advanceToStep(s, 0, 'action');
      const hl = hateLine(s);
      s.players[0].hand = [makeCard('hate-0', 0, 'hand')];
      const own = makeCard('death-1', 0, 'field', true, 1, 0);
      const opp = makeCard('death-5', 1, 'field', true, 2, 0);
      s.players[0].stacks[1] = [own];
      s.players[1].stacks[2] = [opp];
      const card = s.players[0].hand[0];
      executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: true, line: hl });
      const p = s.pendingEffects[s.pendingEffects.length - 1];
      expect(p.prompt?.kind).toBe('select');
      expect(p.prompt?.min).toBe(1);
      expect(p.prompt?.max).toBe(1);
      const uids = p.prompt!.candidates.map((c) => c.uid);
      expect(uids).toEqual([own.uid, opp.uid]);
      expect(uids).not.toContain(card.uid); // 结算中源卡（hate-0 自己）不作为候选
      executeAction(s, 0, 'effect-choice', { promptId: p.id, choice: [opp.uid] });
      expect(opp.zone).toBe('trash');
      expect(s.players[1].stacks[2]).toHaveLength(0);
      expect(s.players[1].trash.map((c) => c.uid)).toEqual([opp.uid]);
      expect(card.zone).toBe('field'); // 源卡未被删
      expect(s.pendingEffects).toHaveLength(0);
    });

    it('only self on field → fizzles without hanging (self excluded → no candidate)', () => {
      const s = draftHateP1();
      advanceToStep(s, 0, 'action');
      const hl = hateLine(s);
      s.players[0].hand = [makeCard('hate-0', 0, 'hand')];
      const card = s.players[0].hand[0];
      executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: true, line: hl });
      resolveAllChoices(s, pickFirst);
      expect(card.zone).toBe('field'); // 自己不被删
      expect(s.players[0].trash).toHaveLength(0);
      expect(s.pendingEffects).toHaveLength(0);
    });
  });

  describe('hate-1 middle: 弃3张牌。删除1张牌。再删除1张牌。', () => {
    it('discards 3, deletes a top card, then RE-LISTS candidates and deletes another top card', () => {
      const s = draftHateP1();
      advanceToStep(s, 0, 'action');
      const hl = hateLine(s);
      s.players[0].hand = [makeCard('hate-1', 0, 'hand'), makeCard('death-0', 0, 'hand'), makeCard('death-1', 0, 'hand'), makeCard('death-2', 0, 'hand')];
      const b0 = makeCard('metal-2', 0, 'field', true, 1, 0); // 无中指令/无触发 → 揭开不连锁
      const b1 = makeCard('death-1', 0, 'field', true, 1, 1);
      const c = makeCard('water-5', 0, 'field', true, 2, 0);
      const d = makeCard('death-5', 1, 'field', true, 1, 0);
      s.players[0].stacks[1] = [b0, b1];
      s.players[0].stacks[2] = [c];
      s.players[1].stacks[1] = [d];
      const card = s.players[0].hand[0];
      executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: true, line: hl });
      // 弃 3：min=max=3（手牌恰 3）
      const p1 = s.pendingEffects[s.pendingEffects.length - 1];
      expect(p1.prompt?.kind).toBe('select');
      expect(p1.prompt?.min).toBe(3);
      expect(p1.prompt?.max).toBe(3);
      const discardUids = p1.prompt!.candidates.map((c2) => c2.uid);
      executeAction(s, 0, 'effect-choice', { promptId: p1.id, choice: discardUids });
      expect(s.players[0].hand).toHaveLength(0);
      expect(s.players[0].trash.map((c2) => c2.uid)).toEqual(discardUids);
      // 删 1：field 顶卡候选（源卡 excluded；b1 顶、c、d）
      const p2 = s.pendingEffects[s.pendingEffects.length - 1];
      expect(p2.prompt?.candidates.map((c2) => c2.uid)).toEqual([b1.uid, c.uid, d.uid]);
      executeAction(s, 0, 'effect-choice', { promptId: p2.id, choice: [b1.uid] });
      expect(b1.zone).toBe('trash');
      // 再删 1：候选重新列出——b1 删后新顶卡 b0 出现（上一步删后顶卡变化）
      const p3 = s.pendingEffects[s.pendingEffects.length - 1];
      expect(p3.prompt?.candidates.map((c2) => c2.uid)).toEqual([b0.uid, c.uid, d.uid]);
      executeAction(s, 0, 'effect-choice', { promptId: p3.id, choice: [b0.uid] });
      expect(b0.zone).toBe('trash');
      expect(s.players[0].trash.map((c2) => c2.uid)).toEqual([...discardUids, b1.uid, b0.uid]);
      expect(card.zone).toBe('field');
      expect(s.pendingEffects).toHaveLength(0);
    });

    it('hand < 3 → discard all remaining (尽力而为 user ruling: min = min(3, hand.length))', () => {
      const s = draftHateP1();
      advanceToStep(s, 0, 'action');
      const hl = hateLine(s);
      s.players[0].hand = [makeCard('hate-1', 0, 'hand'), makeCard('death-0', 0, 'hand')];
      const other = s.players[0].hand[1];
      const card = s.players[0].hand[0];
      executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: true, line: hl });
      const p = s.pendingEffects[s.pendingEffects.length - 1];
      expect(p.prompt?.kind).toBe('select');
      expect(p.prompt?.min).toBe(1); // min = min(3, 1) = 1
      expect(p.prompt?.max).toBe(3);
      executeAction(s, 0, 'effect-choice', { promptId: p.id, choice: [other.uid] });
      expect(s.players[0].trash.map((c) => c.uid)).toEqual([other.uid]);
      expect(s.pendingEffects).toHaveLength(0); // 无场上顶卡 → 删除两步 fizzle，无挂起
    });

    it('hand empty → discard step skipped, delete steps still run (每句独立)', () => {
      const s = draftHateP1();
      advanceToStep(s, 0, 'action');
      const hl = hateLine(s);
      s.players[0].hand = [makeCard('hate-1', 0, 'hand')];
      const opp = makeCard('death-5', 1, 'field', true, 1, 0);
      s.players[1].stacks[1] = [opp];
      const card = s.players[0].hand[0];
      executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: true, line: hl });
      const p = s.pendingEffects[s.pendingEffects.length - 1];
      expect(p.prompt?.kind).toBe('select');
      expect(p.prompt?.candidates.map((c) => c.uid)).toEqual([opp.uid]); // 第一个提示直接是删除（弃牌跳过）
      executeAction(s, 0, 'effect-choice', { promptId: p.id, choice: [opp.uid] });
      expect(s.players[0].trash).toHaveLength(0); // 无弃牌
      expect(opp.zone).toBe('trash'); // 删除照常执行
      expect(s.pendingEffects).toHaveLength(0); // 再删 1：无顶卡 → fizzle
    });

    it('no field top card → both delete steps fizzle without hanging', () => {
      const s = draftHateP1();
      advanceToStep(s, 0, 'action');
      const hl = hateLine(s);
      s.players[0].hand = [makeCard('hate-1', 0, 'hand'), makeCard('death-0', 0, 'hand'), makeCard('death-1', 0, 'hand'), makeCard('death-2', 0, 'hand')];
      const card = s.players[0].hand[0];
      executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: true, line: hl });
      const p = s.pendingEffects[s.pendingEffects.length - 1];
      executeAction(s, 0, 'effect-choice', { promptId: p.id, choice: p.prompt!.candidates.map((c) => c.uid) });
      expect(s.players[0].trash).toHaveLength(3); // 只弃了牌
      expect(s.pendingEffects).toHaveLength(0); // 无场上顶卡 → 两步删除均 fizzle
      expect(card.zone).toBe('field');
    });
  });

  describe('hate-2 middle: 删除你分值最高的牌。删除对手分值最高的牌。', () => {
    it('deletes own highest-value face-up top, then opponent highest-value face-up top', () => {
      const s = draftHateP1();
      advanceToStep(s, 0, 'action');
      const hl = hateLine(s);
      s.players[0].hand = [makeCard('hate-2', 0, 'hand')];
      const ownHi = makeCard('death-5', 0, 'field', true, 1, 0); // 5 分
      const ownLo = makeCard('hate-0', 0, 'field', true, 2, 0); // 0 分
      const oppHi = makeCard('death-4', 1, 'field', true, 2, 0); // 4 分
      s.players[0].stacks[1] = [ownHi];
      s.players[0].stacks[2] = [ownLo];
      s.players[1].stacks[2] = [oppHi];
      const card = s.players[0].hand[0];
      executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: true, line: hl });
      // 自己句：自己顶卡 = hate-2(2)/ownHi(5)/ownLo(0) → 最高 5 = [ownHi]
      const p1 = s.pendingEffects[s.pendingEffects.length - 1];
      expect(p1.prompt?.kind).toBe('select');
      expect(p1.prompt?.candidates.map((c) => c.uid)).toEqual([ownHi.uid]);
      executeAction(s, 0, 'effect-choice', { promptId: p1.id, choice: [ownHi.uid] });
      expect(ownHi.zone).toBe('trash');
      // 对手句：对手顶卡 = oppHi(4) → 直接列出最高
      const p2 = s.pendingEffects[s.pendingEffects.length - 1];
      expect(p2.prompt?.candidates.map((c) => c.uid)).toEqual([oppHi.uid]);
      executeAction(s, 0, 'effect-choice', { promptId: p2.id, choice: [oppHi.uid] });
      expect(oppHi.zone).toBe('trash');
      expect(card.zone).toBe('field'); // 源卡未被删
      expect(s.pendingEffects).toHaveLength(0);
    });

    it('tie in own highest → all tied cards listed, player selects one', () => {
      const s = draftHateP1();
      advanceToStep(s, 0, 'action');
      const hl = hateLine(s);
      s.players[0].hand = [makeCard('hate-2', 0, 'hand')];
      const a = makeCard('death-5', 0, 'field', true, 1, 0);
      const b = makeCard('death-5', 0, 'field', true, 2, 0);
      s.players[0].stacks[1] = [a];
      s.players[0].stacks[2] = [b];
      const card = s.players[0].hand[0];
      executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: true, line: hl });
      const p = s.pendingEffects[s.pendingEffects.length - 1];
      expect(p.prompt?.candidates.map((c) => c.uid)).toEqual([a.uid, b.uid]); // 并列全列
      executeAction(s, 0, 'effect-choice', { promptId: p.id, choice: [b.uid] });
      expect(b.zone).toBe('trash');
      expect(a.zone).toBe('field');
      expect(s.pendingEffects).toHaveLength(0); // 对手无顶卡 → 对手句 fizzle
    });

    it('face-down top cards are NOT candidates (FAQ 169 更正：未翻面卡牌)', () => {
      const s = draftHateP1();
      advanceToStep(s, 0, 'action');
      const hl = hateLine(s);
      s.players[0].hand = [makeCard('hate-2', 0, 'hand')];
      const facedown = makeCard('death-4', 0, 'field', false, 1, 0); // 反面（cardPointValue=2，若纳入会与 hate-2 并列）
      const opp = makeCard('death-5', 1, 'field', true, 1, 0);
      s.players[0].stacks[1] = [facedown];
      s.players[1].stacks[1] = [opp];
      const card = s.players[0].hand[0];
      executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: true, line: hl });
      const p = s.pendingEffects[s.pendingEffects.length - 1];
      expect(p.prompt?.candidates.map((c) => c.uid)).toEqual([card.uid]); // 仅正面：只剩自己(2)
      executeAction(s, 0, 'effect-choice', { promptId: p.id, choice: [card.uid] });
      expect(card.zone).toBe('trash'); // 自己是最高 → 删自己
      expect(opp.zone).toBe('field'); // 源卡失效 → 对手句不触发
      expect(s.pendingEffects).toHaveLength(0);
    });

    it('hate-2 deletes itself when it is the highest → second sentence does NOT fire (FAQ 172)', () => {
      const s = draftHateP1();
      advanceToStep(s, 0, 'action');
      const hl = hateLine(s);
      s.players[0].hand = [makeCard('hate-2', 0, 'hand')];
      const ownLo = makeCard('hate-0', 0, 'field', true, 1, 0); // 0 分 < hate-2(2)
      const opp = makeCard('death-5', 1, 'field', true, 2, 0);
      s.players[0].stacks[1] = [ownLo];
      s.players[1].stacks[2] = [opp];
      const card = s.players[0].hand[0];
      executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: true, line: hl });
      const p = s.pendingEffects[s.pendingEffects.length - 1];
      expect(p.prompt?.candidates.map((c) => c.uid)).toEqual([card.uid]); // 自己是最高
      executeAction(s, 0, 'effect-choice', { promptId: p.id, choice: [card.uid] });
      expect(card.zone).toBe('trash'); // 第一句删自己
      expect(opp.zone).toBe('field'); // sourceValid 终止 → 第二句不触发，对手卡幸存
      expect(s.pendingEffects).toHaveLength(0);
    });

    it('opponent has no face-up top card → opponent sentence fizzles (each sentence independent)', () => {
      const s = draftHateP1();
      advanceToStep(s, 0, 'action');
      const hl = hateLine(s);
      s.players[0].hand = [makeCard('hate-2', 0, 'hand')];
      const ownHi = makeCard('death-5', 0, 'field', true, 1, 0);
      const oppDown = makeCard('death-4', 1, 'field', false, 1, 0); // 反面顶卡不计
      s.players[0].stacks[1] = [ownHi];
      s.players[1].stacks[1] = [oppDown];
      const card = s.players[0].hand[0];
      executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: true, line: hl });
      const p = s.pendingEffects[s.pendingEffects.length - 1];
      executeAction(s, 0, 'effect-choice', { promptId: p.id, choice: [ownHi.uid] });
      expect(ownHi.zone).toBe('trash');
      expect(oppDown.zone).toBe('field'); // 对手反面顶卡未被删
      expect(card.zone).toBe('field');
      expect(s.pendingEffects).toHaveLength(0);
    });
  });

  describe('hate-3 top: 你的牌被删除后：抽1张牌。', () => {
    it('fires after own card is deleted (system delete) → draws 1', () => {
      const s = draftHateP1();
      advanceToStep(s, 0, 'action');
      const hl = hateLine(s);
      const h3 = makeCard('hate-3', 0, 'field', true, hl, 0);
      s.players[0].stacks[hl] = [h3];
      const target = makeCard('death-5', 0, 'field', true, 1, 0);
      s.players[0].stacks[1] = [target];
      const handBefore = s.players[0].hand.length;
      const deckBefore = s.players[0].deck.length;
      pushDeleteGen(s, 0, target.uid);
      runStack(s);
      expect(target.zone).toBe('trash');
      expect(s.players[0].hand).toHaveLength(handBefore + 1); // 你的牌被删除后：抽1张牌
      expect(s.players[0].deck).toHaveLength(deckBefore - 1);
      expect(h3.zone).toBe('field');
      expect(s.pendingEffects).toHaveLength(0);
    });

    it('fires even when covered (top command: top flag)', () => {
      const s = draftHateP1();
      advanceToStep(s, 0, 'action');
      const hl = hateLine(s);
      const h3 = makeCard('hate-3', 0, 'field', true, hl, 0);
      const cover = makeCard('water-5', 0, 'field', true, hl, 1);
      s.players[0].stacks[hl] = [h3, cover]; // 被盖
      const target = makeCard('death-5', 0, 'field', true, 1, 0);
      s.players[0].stacks[1] = [target];
      const handBefore = s.players[0].hand.length;
      pushDeleteGen(s, 0, target.uid);
      runStack(s);
      expect(s.players[0].hand).toHaveLength(handBefore + 1); // 被盖仍生效（顶命令）
      expect(h3.zone).toBe('field');
      expect(cover.zone).toBe('field');
      expect(s.pendingEffects).toHaveLength(0);
    });

    it('does NOT fire when an OPPONENT card is deleted (after-delete scans the deleted card owner)', () => {
      const s = draftHateP1();
      advanceToStep(s, 0, 'action');
      const hl = hateLine(s);
      const h3 = makeCard('hate-3', 0, 'field', true, hl, 0);
      s.players[0].stacks[hl] = [h3];
      const oppTarget = makeCard('death-5', 1, 'field', true, 1, 0);
      s.players[1].stacks[1] = [oppTarget];
      const handBefore = s.players[0].hand.length;
      pushDeleteGen(s, 1, oppTarget.uid); // 对手的卡被删
      runStack(s);
      expect(oppTarget.zone).toBe('trash');
      expect(s.players[0].hand).toHaveLength(handBefore); // 无抽牌
      expect(s.pendingEffects).toHaveLength(0);
    });

    it('does NOT fire on compile deletion (compile-body bypasses the delete op — 用户拍板「不含编译删除」)', () => {
      const s = draftHateP1();
      advanceToStep(s, 0, 'check-compile');
      const hl = hateLine(s);
      const other = ([0, 1, 2] as Line[]).find((l) => l !== hl)!;
      const h3 = makeCard('hate-3', 0, 'field', true, other, 0);
      s.players[0].stacks[other] = [h3];
      for (let i = 0; i < 10; i++) s.players[0].stacks[hl].push(makeCard('death-1', 0, 'field', true, hl, i));
      const handBefore = s.players[0].hand.length;
      executeAction(s, 0, 'compile', { line: hl });
      expect(s.players[0].protocols[hl].compiled).toBe(true);
      expect(s.players[0].stacks[hl]).toHaveLength(0); // 编译删除该线全部卡
      expect(s.players[0].hand).toHaveLength(handBefore); // 编译删除不触发 after-delete → 不抽牌
      expect(h3.zone).toBe('field');
      expect(s.pendingEffects).toHaveLength(0);
    });
  });

  describe('hate-4 bottom: 被盖住前：先删除此列分值最低的被盖住的牌。', () => {
    it('before-covered: unique lowest covered card in OWN line is deleted directly (no prompt)', () => {
      const s = draftHateP1();
      advanceToStep(s, 0, 'action');
      const coveredHi = makeCard('death-5', 0, 'field', true, 0, 0); // 5
      const coveredLo = makeCard('death-4', 0, 'field', false, 0, 1); // 反面 → 2
      const h4 = makeCard('hate-4', 0, 'field', true, 0, 2);
      s.players[0].stacks[0] = [coveredHi, coveredLo, h4];
      const played = makeCard('water-1', 0, 'hand');
      s.players[0].hand = [played];
      executeAction(s, 0, 'play', { cardUid: played.uid, faceUp: false, line: 0 });
      expect(coveredLo.zone).toBe('trash'); // 分值最低（2）唯一 → 直接删除
      expect(coveredHi.zone).toBe('field');
      expect(h4.zone).toBe('field'); // hate-4 被盖（played 落地其上方）
      expect(s.players[0].stacks[0].map((c) => c.uid)).toEqual([coveredHi.uid, h4.uid, played.uid]);
      expect(s.pendingEffects).toHaveLength(0); // 无选择挂起
    });

    it('tie for lowest → player selects one of the tied covered cards', () => {
      const s = draftHateP1();
      advanceToStep(s, 0, 'action');
      const a = makeCard('death-4', 0, 'field', false, 0, 0); // 反面 → 2
      const b = makeCard('water-1', 0, 'field', false, 0, 1); // 反面 → 2
      const h4 = makeCard('hate-4', 0, 'field', true, 0, 2);
      s.players[0].stacks[0] = [a, b, h4];
      const played = makeCard('water-1', 0, 'hand');
      s.players[0].hand = [played];
      executeAction(s, 0, 'play', { cardUid: played.uid, faceUp: false, line: 0 });
      const p = s.pendingEffects[s.pendingEffects.length - 1];
      expect(p.prompt?.kind).toBe('select');
      expect(p.prompt?.candidates.map((c) => c.uid)).toEqual([a.uid, b.uid]); // 并列全列，玩家选
      executeAction(s, 0, 'effect-choice', { promptId: p.id, choice: [a.uid] });
      expect(a.zone).toBe('trash');
      expect(b.zone).toBe('field');
      expect(h4.zone).toBe('field');
      expect(s.pendingEffects).toHaveLength(0);
    });

    it('only covered cards in THIS line are candidates (lower-value covered card elsewhere untouched)', () => {
      const s = draftHateP1();
      advanceToStep(s, 0, 'action');
      const coveredLo = makeCard('death-4', 0, 'field', false, 0, 0); // 本线：2
      const h4 = makeCard('hate-4', 0, 'field', true, 0, 1);
      s.players[0].stacks[0] = [coveredLo, h4];
      const otherLo = makeCard('death-1', 0, 'field', true, 1, 0); // 他线被盖：1（更低）
      const otherTop = makeCard('water-5', 0, 'field', true, 1, 1);
      s.players[0].stacks[1] = [otherLo, otherTop];
      const played = makeCard('water-1', 0, 'hand');
      s.players[0].hand = [played];
      executeAction(s, 0, 'play', { cardUid: played.uid, faceUp: false, line: 0 });
      expect(coveredLo.zone).toBe('trash'); // 只删本线最低
      expect(otherLo.zone).toBe('field'); // 他线（更低分）不动
      expect(otherTop.zone).toBe('field');
      expect(s.pendingEffects).toHaveLength(0);
    });

    it('no covered card in the line → fizzles (nothing deleted, card just lands)', () => {
      const s = draftHateP1();
      advanceToStep(s, 0, 'action');
      const h4 = makeCard('hate-4', 0, 'field', true, 0, 0);
      s.players[0].stacks[0] = [h4];
      const played = makeCard('water-1', 0, 'hand');
      s.players[0].hand = [played];
      executeAction(s, 0, 'play', { cardUid: played.uid, faceUp: false, line: 0 });
      expect(s.players[0].trash).toHaveLength(0); // 无被盖卡 → 无删除
      expect(s.players[0].stacks[0].map((c) => c.uid)).toEqual([h4.uid, played.uid]);
      expect(s.pendingEffects).toHaveLength(0);
    });
  });

  describe('hate-5 middle: 弃1张牌。', () => {
    it('discards 1 from hand', () => {
      const s = draftHateP1();
      advanceToStep(s, 0, 'action');
      s.players[0].hand = [makeCard('hate-5', 0, 'hand'), makeCard('death-0', 0, 'hand')];
      const target = s.players[0].hand.find((c) => c.defId === 'hate-5')!;
      const other = s.players[0].hand.find((c) => c.defId !== 'hate-5')!;
      executeAction(s, 0, 'play', { cardUid: target.uid, faceUp: true, line: hateLine(s) });
      resolveAllChoices(s, (p) => [other.uid]); // 弃 death-0
      expect(s.players[0].trash.map((c) => c.uid)).toEqual([other.uid]);
      expect(s.players[0].hand).toHaveLength(0);
      expect(s.players[0].stacks[hateLine(s)].map((c) => c.uid)).toEqual([target.uid]);
      expect(s.pendingEffects).toHaveLength(0);
    });

    it('empty hand → fizzles without hanging', () => {
      const s = draftHateP1();
      advanceToStep(s, 0, 'action');
      s.players[0].hand = [makeCard('hate-5', 0, 'hand')];
      const card = s.players[0].hand[0];
      executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: true, line: hateLine(s) });
      resolveAllChoices(s, pickFirst);
      expect(s.pendingEffects).toHaveLength(0);
      expect(s.players[0].trash).toHaveLength(0); // 无牌可弃
      expect(card.zone).toBe('field');
    });
  });
});
