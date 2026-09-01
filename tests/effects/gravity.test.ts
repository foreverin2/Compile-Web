import { describe, it, expect } from 'vitest';
import type { GameState, Line } from '../../src/core/models/types';
import { executeAction } from '../../src/core/game';
import { makeCard, pickFirst, resolveAllChoices, draftGravityP1, advanceToStep } from '../helpers';

function gravityLine(s: GameState): Line {
  const idx = s.players[0].protocols.findIndex((p) => p.defId === 'gravity');
  return idx as Line;
}

describe('gravity protocol effects', () => {
  describe('gravity-0 middle: for every 2 cards in this line, play deck top face-down under this card', () => {
    it('counts both players stacks (incl. self): 4 total → plays 2 face-down under the source', () => {
      const s = draftGravityP1();
      advanceToStep(s, 0, 'action');
      const gl = gravityLine(s);
      // 对手同线 3 张（反面顶卡无中指令）→ 合计 4（含 gravity-0 自己）→ n = floor(4/2) = 2
      const o1 = makeCard('metal-1', 1, 'field', false, gl, 0);
      const o2 = makeCard('metal-2', 1, 'field', false, gl, 1);
      const o3 = makeCard('metal-3', 1, 'field', false, gl, 2);
      s.players[1].stacks[gl] = [o1, o2, o3];
      const a = makeCard('metal-1', 0, 'deck', false);
      const b = makeCard('metal-2', 0, 'deck', false);
      s.players[0].deck = [a, b]; // b 是牌堆顶（先被打出）
      s.players[0].hand = [makeCard('gravity-0', 0, 'hand')];
      const g0 = s.players[0].hand[0];
      executeAction(s, 0, 'play', { cardUid: g0.uid, faceUp: true, line: gl });
      resolveAllChoices(s, pickFirst); // 无选择请求（全自动）
      // 每张都插到 gravity-0 下方 → 先弹出的 b 在最底，a 次之，g0 保持顶卡未被覆盖
      expect(s.players[0].stacks[gl].map((c) => c.uid)).toEqual([b.uid, a.uid, g0.uid]);
      const stack = s.players[0].stacks[gl];
      expect(stack[0].faceUp).toBe(false);
      expect(stack[1].faceUp).toBe(false);
      expect(stack[2].uid).toBe(g0.uid); // gravity-0 自己未被覆盖（堆叠顶）
      expect(stack[2].faceUp).toBe(true);
      expect(stack.map((c) => c.pos)).toEqual([0, 1, 2]); // 插入后重索引
      expect(s.players[0].deck).toHaveLength(0);
      expect(s.players[1].stacks[gl].map((c) => c.uid)).toEqual([o1.uid, o2.uid, o3.uid]); // 对手侧不动
      expect(s.pendingEffects).toHaveLength(0);
      expect(s.pendingPlay).toHaveLength(0);
    });

    it('rounds down: 3 total → plays 1 card', () => {
      const s = draftGravityP1();
      advanceToStep(s, 0, 'action');
      const gl = gravityLine(s);
      const o1 = makeCard('metal-1', 1, 'field', false, gl, 0);
      const o2 = makeCard('metal-2', 1, 'field', false, gl, 1);
      s.players[1].stacks[gl] = [o1, o2];
      const d = makeCard('metal-1', 0, 'deck', false);
      s.players[0].deck = [d];
      s.players[0].hand = [makeCard('gravity-0', 0, 'hand')];
      const g0 = s.players[0].hand[0];
      executeAction(s, 0, 'play', { cardUid: g0.uid, faceUp: true, line: gl });
      resolveAllChoices(s, pickFirst);
      expect(s.players[0].stacks[gl].map((c) => c.uid)).toEqual([d.uid, g0.uid]); // 合计 3 → n = 1
      expect(s.players[0].deck).toHaveLength(0);
      expect(s.pendingEffects).toHaveLength(0);
    });

    it('empty deck → fizzles without playing (no reshuffle of trash)', () => {
      const s = draftGravityP1();
      advanceToStep(s, 0, 'action');
      const gl = gravityLine(s);
      const o1 = makeCard('metal-1', 1, 'field', false, gl, 0);
      const o2 = makeCard('metal-2', 1, 'field', false, gl, 1);
      s.players[1].stacks[gl] = [o1, o2];
      s.players[0].deck = [];
      s.players[0].trash = [makeCard('metal-3', 0, 'trash', true)];
      s.players[0].hand = [makeCard('gravity-0', 0, 'hand')];
      const g0 = s.players[0].hand[0];
      executeAction(s, 0, 'play', { cardUid: g0.uid, faceUp: true, line: gl });
      resolveAllChoices(s, pickFirst);
      expect(s.players[0].stacks[gl].map((c) => c.uid)).toEqual([g0.uid]); // 牌库空 → 不打出（不洗弃牌堆）
      expect(s.players[0].deck).toHaveLength(0);
      expect(s.players[0].trash).toHaveLength(1);
      expect(s.pendingEffects).toHaveLength(0);
    });

    it('partial fizzle: deck runs out mid-loop → remaining plays skipped', () => {
      const s = draftGravityP1();
      advanceToStep(s, 0, 'action');
      const gl = gravityLine(s);
      const o1 = makeCard('metal-1', 1, 'field', false, gl, 0);
      const o2 = makeCard('metal-2', 1, 'field', false, gl, 1);
      const o3 = makeCard('metal-3', 1, 'field', false, gl, 2);
      s.players[1].stacks[gl] = [o1, o2, o3]; // 合计 4 → n = 2，但牌库只有 1 张
      const d = makeCard('metal-1', 0, 'deck', false);
      s.players[0].deck = [d];
      s.players[0].hand = [makeCard('gravity-0', 0, 'hand')];
      const g0 = s.players[0].hand[0];
      executeAction(s, 0, 'play', { cardUid: g0.uid, faceUp: true, line: gl });
      resolveAllChoices(s, pickFirst);
      expect(s.players[0].stacks[gl].map((c) => c.uid)).toEqual([d.uid, g0.uid]); // 只打了 1 张
      expect(s.players[0].deck).toHaveLength(0);
      expect(s.pendingEffects).toHaveLength(0);
    });
  });

  describe('gravity-1 middle: draw 2, shift 1 card into or out of this column', () => {
    it('draws 2, then shifts a card from another line INTO this column', () => {
      const s = draftGravityP1();
      advanceToStep(s, 0, 'action');
      const gl = gravityLine(s);
      const target = makeCard('metal-1', 1, 'field', false, 1, 0); // 对手另列反面顶卡
      s.players[1].stacks[1] = [target];
      s.players[0].hand = [makeCard('gravity-1', 0, 'hand')];
      const deckBefore = s.players[0].deck.length;
      const card = s.players[0].hand[0];
      executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: true, line: gl });
      expect(s.players[0].hand).toHaveLength(2); // 抽 2（打出后手牌 0 → 2）
      expect(s.players[0].deck).toHaveLength(deckBefore - 2);
      const p = s.pendingEffects[s.pendingEffects.length - 1];
      expect(p.prompt?.kind).toBe('select');
      expect(p.prompt?.candidates.map((c) => c.uid)).toEqual([target.uid]);
      executeAction(s, 0, 'effect-choice', { promptId: p.id, choice: [target.uid] });
      const p2 = s.pendingEffects[s.pendingEffects.length - 1];
      expect(p2.prompt?.kind).toBe('select-line');
      expect(p2.prompt?.lines).toEqual([gl]); // 平移进：只能选此列
      executeAction(s, 0, 'effect-choice', { promptId: p2.id, choice: [`line:${gl}`] });
      expect(s.players[1].stacks[1]).toHaveLength(0);
      expect(s.players[1].stacks[gl].map((c) => c.uid)).toEqual([target.uid]); // 平移进此列
      expect(target.faceUp).toBe(false); // 反面卡平移后仍反面
      expect(s.pendingEffects).toHaveLength(0);
    });

    it('shifts a card already in this column OUT (select-line excludes this column)', () => {
      const s = draftGravityP1();
      advanceToStep(s, 0, 'action');
      const gl = gravityLine(s);
      const target = makeCard('metal-1', 1, 'field', false, gl, 0); // 对手此列顶卡（未覆盖）
      s.players[1].stacks[gl] = [target];
      s.players[0].hand = [makeCard('gravity-1', 0, 'hand')];
      const card = s.players[0].hand[0];
      executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: true, line: gl });
      const p = s.pendingEffects[s.pendingEffects.length - 1];
      expect(p.prompt?.kind).toBe('select');
      expect(p.prompt?.candidates.map((c) => c.uid)).toEqual([target.uid]);
      executeAction(s, 0, 'effect-choice', { promptId: p.id, choice: [target.uid] });
      const p2 = s.pendingEffects[s.pendingEffects.length - 1];
      expect(p2.prompt?.kind).toBe('select-line');
      expect(p2.prompt?.lines).toEqual(([0, 1, 2] as Line[]).filter((l) => l !== gl)); // 平移出：排除此列
      const out = ([0, 1, 2] as Line[]).find((l) => l !== gl)!;
      executeAction(s, 0, 'effect-choice', { promptId: p2.id, choice: [`line:${out}`] });
      expect(s.players[1].stacks[gl]).toHaveLength(0);
      expect(s.players[1].stacks[out].map((c) => c.uid)).toEqual([target.uid]);
      expect(s.pendingEffects).toHaveLength(0);
    });

    it('no field top cards → the shift select fizzles (draw still happened)', () => {
      const s = draftGravityP1();
      advanceToStep(s, 0, 'action');
      s.players[0].hand = [makeCard('gravity-1', 0, 'hand')];
      const deckBefore = s.players[0].deck.length;
      const card = s.players[0].hand[0];
      executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: true, line: gravityLine(s) });
      resolveAllChoices(s, pickFirst); // 候选空 → 自动 fizzle，不挂起
      expect(s.players[0].hand).toHaveLength(2); // 抽牌仍结算
      expect(s.players[0].deck).toHaveLength(deckBefore - 2);
      expect(s.pendingEffects).toHaveLength(0);
    });
  });

  describe('gravity-2 middle: flip 1 card, shift that card into this column', () => {
    it('flips a face-down card on another line face-up, then shifts it into this column', () => {
      const s = draftGravityP1();
      advanceToStep(s, 0, 'action');
      const gl = gravityLine(s);
      const target = makeCard('metal-1', 1, 'field', false, 1, 0); // 反面无中指令卡
      s.players[1].stacks[1] = [target];
      s.players[0].hand = [makeCard('gravity-2', 0, 'hand')];
      const card = s.players[0].hand[0];
      executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: true, line: gl });
      const p = s.pendingEffects[s.pendingEffects.length - 1];
      expect(p.prompt?.kind).toBe('select');
      executeAction(s, 0, 'effect-choice', { promptId: p.id, choice: [target.uid] });
      expect(target.faceUp).toBe(true); // 翻转完成
      const p2 = s.pendingEffects[s.pendingEffects.length - 1];
      expect(p2.prompt?.kind).toBe('select-line');
      expect(p2.prompt?.lines).toEqual([gl]); // 只能选此列
      executeAction(s, 0, 'effect-choice', { promptId: p2.id, choice: [`line:${gl}`] });
      expect(s.players[1].stacks[1]).toHaveLength(0);
      expect(s.players[1].stacks[gl].map((c) => c.uid)).toEqual([target.uid]);
      expect(target.faceUp).toBe(true);
      expect(s.pendingEffects).toHaveLength(0);
    });

    it('card already in this column → flip only, no shift', () => {
      const s = draftGravityP1();
      advanceToStep(s, 0, 'action');
      const gl = gravityLine(s);
      const target = makeCard('metal-1', 1, 'field', false, gl, 0);
      s.players[1].stacks[gl] = [target];
      s.players[0].hand = [makeCard('gravity-2', 0, 'hand')];
      const card = s.players[0].hand[0];
      executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: true, line: gl });
      const p = s.pendingEffects[s.pendingEffects.length - 1];
      executeAction(s, 0, 'effect-choice', { promptId: p.id, choice: [target.uid] });
      expect(target.faceUp).toBe(true); // 翻转完成
      expect(s.players[1].stacks[gl].map((c) => c.uid)).toEqual([target.uid]); // 已在此列 → 无平移
      expect(s.pendingEffects).toHaveLength(0);
    });

    it('flipped card covered by its own middle chain still shifts (FAQ 137, allowCovered)', () => {
      const s = draftGravityP1();
      advanceToStep(s, 0, 'action');
      const gl = gravityLine(s);
      // 对手另列反面 life-0：翻正触发其中指令 → 在对手有牌的每一列（仅本列）打出牌堆顶 → 盖住自己
      const life0 = makeCard('life-0', 1, 'field', false, 1, 0);
      s.players[1].stacks[1] = [life0];
      const deckCard = makeCard('metal-1', 1, 'deck', false);
      s.players[1].deck = [deckCard];
      s.players[0].hand = [makeCard('gravity-2', 0, 'hand')];
      const card = s.players[0].hand[0];
      executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: true, line: gl });
      const p = s.pendingEffects[s.pendingEffects.length - 1];
      executeAction(s, 0, 'effect-choice', { promptId: p.id, choice: [life0.uid] });
      // 连锁：life-0 中指令先结算 → 牌堆顶垫到其上方 → life-0 被覆盖
      expect(s.players[1].stacks[1].map((c) => c.uid)).toEqual([life0.uid, deckCard.uid]);
      expect(life0.faceUp).toBe(true);
      const p2 = s.pendingEffects[s.pendingEffects.length - 1];
      expect(p2.prompt?.kind).toBe('select-line');
      executeAction(s, 0, 'effect-choice', { promptId: p2.id, choice: [`line:${gl}`] });
      // FAQ 137：「那张卡牌」优先 → 被翻转的卡即使被覆盖也平移进此列
      expect(s.players[1].stacks[1].map((c) => c.uid)).toEqual([deckCard.uid]);
      expect(s.players[1].stacks[gl].map((c) => c.uid)).toEqual([life0.uid]);
      expect(life0.zone).toBe('field');
      expect(s.pendingEffects).toHaveLength(0);
      expect(s.pendingShift).toHaveLength(0);
    });

    it('flipped card deleted by its own middle chain → shift skipped (findCard guard)', () => {
      const s = draftGravityP1();
      advanceToStep(s, 0, 'action');
      const gl = gravityLine(s);
      // 对手另列反面 death-2：翻正触发其中指令（选列删 1/2 分卡）→ 选自己所在列 → 删除自己
      const d2 = makeCard('death-2', 1, 'field', false, 1, 0);
      s.players[1].stacks[1] = [d2];
      s.players[0].hand = [makeCard('gravity-2', 0, 'hand')];
      const card = s.players[0].hand[0];
      executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: true, line: gl });
      const p = s.pendingEffects[s.pendingEffects.length - 1];
      executeAction(s, 0, 'effect-choice', { promptId: p.id, choice: [d2.uid] });
      const p2 = s.pendingEffects[s.pendingEffects.length - 1];
      expect(p2.sourceDefId).toBe('death-2'); // 连锁：death-2 中指令
      expect(p2.prompt?.kind).toBe('select-line');
      executeAction(s, 1, 'effect-choice', { promptId: p2.id, choice: ['line:1'] }); // 选择权 = 连锁卡持有者
      expect(s.players[1].trash.map((c) => c.uid)).toEqual([d2.uid]); // 自己被删除
      expect(s.players[1].stacks[1]).toHaveLength(0);
      expect(s.players[1].stacks[gl]).toHaveLength(0); // 卡已不在 → 平移跳过
      expect(s.pendingEffects).toHaveLength(0);
    });

    it('no field top cards → select fizzles without hanging', () => {
      const s = draftGravityP1();
      advanceToStep(s, 0, 'action');
      s.players[0].hand = [makeCard('gravity-2', 0, 'hand')];
      const card = s.players[0].hand[0];
      executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: true, line: gravityLine(s) });
      resolveAllChoices(s, pickFirst); // 场上只有源卡 → 候选空 → 自动 fizzle
      expect(s.pendingEffects).toHaveLength(0);
    });
  });

  describe('gravity-4 middle: shift 1 face-down card into this column', () => {
    it('shifts a face-down card from another line into this column', () => {
      const s = draftGravityP1();
      advanceToStep(s, 0, 'action');
      const gl = gravityLine(s);
      const target = makeCard('metal-1', 1, 'field', false, 2, 0);
      s.players[1].stacks[2] = [target];
      s.players[0].hand = [makeCard('gravity-4', 0, 'hand')];
      const card = s.players[0].hand[0];
      executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: true, line: gl });
      const p = s.pendingEffects[s.pendingEffects.length - 1];
      expect(p.prompt?.kind).toBe('select');
      expect(p.prompt?.candidates.map((c) => c.uid)).toEqual([target.uid]); // 只列反面顶卡
      executeAction(s, 0, 'effect-choice', { promptId: p.id, choice: [target.uid] });
      expect(s.players[1].stacks[2]).toHaveLength(0);
      expect(s.players[1].stacks[gl].map((c) => c.uid)).toEqual([target.uid]);
      expect(target.faceUp).toBe(false); // 仍反面
      expect(s.pendingEffects).toHaveLength(0);
    });

    it('face-down card already in this column → no action (user ruling)', () => {
      const s = draftGravityP1();
      advanceToStep(s, 0, 'action');
      const gl = gravityLine(s);
      const target = makeCard('metal-1', 1, 'field', false, gl, 0);
      s.players[1].stacks[gl] = [target];
      s.players[0].hand = [makeCard('gravity-4', 0, 'hand')];
      const card = s.players[0].hand[0];
      executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: true, line: gl });
      const p = s.pendingEffects[s.pendingEffects.length - 1];
      executeAction(s, 0, 'effect-choice', { promptId: p.id, choice: [target.uid] });
      expect(s.players[1].stacks[gl].map((c) => c.uid)).toEqual([target.uid]); // 原样保留
      expect(target.faceUp).toBe(false);
      expect(s.pendingEffects).toHaveLength(0);
    });

    it('no face-down top → select fizzles without hanging', () => {
      const s = draftGravityP1();
      advanceToStep(s, 0, 'action');
      const gl = gravityLine(s);
      const faceUp = makeCard('metal-1', 1, 'field', true, 1, 0);
      s.players[1].stacks[1] = [faceUp]; // 只有正面顶卡 → 反面候选为空
      s.players[0].hand = [makeCard('gravity-4', 0, 'hand')];
      const card = s.players[0].hand[0];
      executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: true, line: gl });
      resolveAllChoices(s, pickFirst);
      expect(s.pendingEffects).toHaveLength(0);
      expect(s.players[1].stacks[1].map((c) => c.uid)).toEqual([faceUp.uid]); // 未移动
    });
  });

  describe('gravity-5 middle: discard 1', () => {
    it('discards 1 from hand', () => {
      const s = draftGravityP1();
      advanceToStep(s, 0, 'action');
      s.players[0].hand = [makeCard('gravity-5', 0, 'hand'), makeCard('gravity-1', 0, 'hand')];
      const target = s.players[0].hand.find((c) => c.defId === 'gravity-5')!;
      const other = s.players[0].hand.find((c) => c.defId !== 'gravity-5')!;
      executeAction(s, 0, 'play', { cardUid: target.uid, faceUp: true, line: gravityLine(s) });
      resolveAllChoices(s, (p) => [other.uid]); // 弃 gravity-1
      expect(s.players[0].trash.map((c) => c.uid)).toEqual([other.uid]);
      expect(s.players[0].hand).toHaveLength(0);
      expect(s.players[0].stacks[gravityLine(s)].map((c) => c.uid)).toEqual([target.uid]);
    });

    it('empty hand → fizzles without hanging', () => {
      const s = draftGravityP1();
      advanceToStep(s, 0, 'action');
      s.players[0].hand = [makeCard('gravity-5', 0, 'hand')];
      const card = s.players[0].hand[0];
      executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: true, line: gravityLine(s) });
      resolveAllChoices(s, pickFirst);
      expect(s.pendingEffects).toHaveLength(0);
      expect(s.players[0].trash).toHaveLength(0); // 无牌可弃
    });
  });

  describe('gravity-6 middle: opponent plays their deck top face-down into this column', () => {
    it('pops the OPPONENT deck top, face-down, into this column', () => {
      const s = draftGravityP1();
      advanceToStep(s, 0, 'action');
      const gl = gravityLine(s);
      const d1 = makeCard('metal-1', 1, 'deck', false);
      const d2 = makeCard('metal-2', 1, 'deck', false);
      s.players[1].deck = [d1, d2]; // d2 是牌堆顶
      s.players[0].hand = [makeCard('gravity-6', 0, 'hand')];
      const card = s.players[0].hand[0];
      executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: true, line: gl });
      resolveAllChoices(s, pickFirst); // 无选择请求（全自动）
      expect(s.players[1].deck.map((c) => c.uid)).toEqual([d1.uid]); // 对手牌库 -1
      expect(s.players[1].stacks[gl].map((c) => c.uid)).toEqual([d2.uid]); // 对手在此列反面打出
      expect(d2.faceUp).toBe(false);
      expect(d2.owner).toBe(1);
      expect(d2.secret).toBe(true); // 牌堆来源的反面 = 非公开信息
      expect(s.players[0].stacks[gl].map((c) => c.uid)).toEqual([card.uid]); // 效果源卡在另一堆叠
      expect(s.pendingEffects).toHaveLength(0);
      expect(s.pendingPlay).toHaveLength(0);
    });

    it('opponent deck empty → fizzles without playing', () => {
      const s = draftGravityP1();
      advanceToStep(s, 0, 'action');
      const gl = gravityLine(s);
      s.players[1].deck = [];
      s.players[1].trash = [makeCard('metal-3', 1, 'trash', true)];
      s.players[0].hand = [makeCard('gravity-6', 0, 'hand')];
      const card = s.players[0].hand[0];
      executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: true, line: gl });
      resolveAllChoices(s, pickFirst);
      expect(s.players[1].stacks[gl]).toHaveLength(0); // 对手牌库空 → fizzle（不洗弃牌堆）
      expect(s.players[1].deck).toHaveLength(0);
      expect(s.players[1].trash).toHaveLength(1);
      expect(s.players[0].stacks[gl].map((c) => c.uid)).toEqual([card.uid]);
      expect(s.pendingEffects).toHaveLength(0);
    });
  });
});
