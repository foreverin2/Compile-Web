import { describe, it, expect } from 'vitest';
import type { GameState, Line } from '../../src/core/models/types';
import { executeAction, getLegalActions } from '../../src/core/game';
import { collectTriggers, resolveTrigger } from '../../src/core/effects/triggers';
import { runStack } from '../../src/core/effects/resolve';
import { makeCard, pickFirst, resolveAllChoices, draftLoveP1, advanceToStep } from '../helpers';

function loveLine(s: GameState): Line {
  const idx = s.players[0].protocols.findIndex((p) => p.defId === 'love');
  return idx as Line;
}

describe('love protocol effects', () => {
  describe('love-1 middle: 抽对手牌堆顶的牌。', () => {
    it('draws the top card of the opponent deck into own hand (owner changes, face up, not secret)', () => {
      const s = draftLoveP1();
      advanceToStep(s, 0, 'action');
      const ll = loveLine(s);
      s.players[0].hand = [makeCard('love-1', 0, 'hand')];
      const oppTop = makeCard('metal-3', 1, 'deck', false, null);
      const oppBelow = makeCard('water-0', 1, 'deck', false, null);
      s.players[1].deck = [oppBelow, oppTop]; // deck.pop() = oppTop
      const oppDeckBefore = s.players[1].deck.length;
      const card = s.players[0].hand[0];
      executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: true, line: ll });
      resolveAllChoices(s, pickFirst);
      expect(s.players[1].deck).toHaveLength(oppDeckBefore - 1);
      expect(s.players[1].deck.map((c) => c.uid)).toEqual([oppBelow.uid]);
      expect(s.players[0].hand).toHaveLength(1);
      const drawn = s.players[0].hand[0];
      expect(drawn.uid).toBe(oppTop.uid);
      expect(drawn.owner).toBe(0); // 所有权变更到抽牌者
      expect(drawn.zone).toBe('hand');
      expect(drawn.faceUp).toBe(true);
      expect(drawn.secret).toBeFalsy(); // 抽入即解禁
      expect(s.pendingEffects).toHaveLength(0);
    });

    it('opponent deck empty: shuffles their trash into a new deck and draws from it', () => {
      const s = draftLoveP1();
      advanceToStep(s, 0, 'action');
      const ll = loveLine(s);
      s.players[0].hand = [makeCard('love-1', 0, 'hand')];
      const trashCards = [
        makeCard('water-1', 1, 'trash', true, null),
        makeCard('death-2', 1, 'trash', true, null),
        makeCard('fire-3', 1, 'trash', true, null),
      ];
      s.players[1].deck = [];
      s.players[1].trash = trashCards;
      const card = s.players[0].hand[0];
      executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: true, line: ll });
      resolveAllChoices(s, pickFirst);
      expect(s.players[0].hand).toHaveLength(1); // 抽到 1 张
      expect(s.players[1].deck).toHaveLength(2); // 剩余洗回牌库
      expect(s.players[1].trash).toHaveLength(0);
      for (const c of s.players[1].deck) expect(c.faceUp).toBe(false); // R11.4：回牌库翻回反面
      const drawn = s.players[0].hand[0];
      expect(trashCards.some((c) => c.uid === drawn.uid)).toBe(true);
      expect(drawn.owner).toBe(0);
      expect(s.pendingEffects).toHaveLength(0);
    });

    it('opponent deck and trash both empty → fizzles without hanging', () => {
      const s = draftLoveP1();
      advanceToStep(s, 0, 'action');
      const ll = loveLine(s);
      s.players[0].hand = [makeCard('love-1', 0, 'hand')];
      s.players[1].deck = [];
      s.players[1].trash = [];
      const card = s.players[0].hand[0];
      executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: true, line: ll });
      resolveAllChoices(s, pickFirst);
      expect(s.players[0].hand).toHaveLength(0); // 无抽牌
      expect(s.pendingEffects).toHaveLength(0);
    });
  });

  describe('love-1 bottom: 结束：你可以把1张手牌给对手。若如此，抽2张牌。', () => {
    it('end trigger: optional give of 1 hand card to opponent, then draws 2', () => {
      const s = draftLoveP1();
      advanceToStep(s, 0, 'end');
      const ll = loveLine(s);
      const lv1 = makeCard('love-1', 0, 'field', true, ll, 0);
      const giveCard = makeCard('water-2', 0, 'hand');
      const keep = makeCard('death-3', 0, 'hand');
      s.players[0].stacks[ll] = [lv1];
      s.players[0].hand = [giveCard, keep];
      const oppHandBefore = s.players[1].hand.length;
      const deckBefore = s.players[0].deck.length;
      const t = collectTriggers(s, 'end').find((x) => x.cardUid === lv1.uid)!;
      expect(t).toBeDefined();
      expect(t.top).toBeUndefined(); // 底命令：不注册 top 标志
      resolveTrigger(s, t);
      runStack(s);
      const p = s.pendingEffects[s.pendingEffects.length - 1];
      expect(p.prompt?.kind).toBe('select');
      expect(p.prompt?.optional).toBe(true); // 你可以：可选
      expect(p.prompt?.candidates.map((c) => c.uid).sort()).toEqual([giveCard.uid, keep.uid].sort());
      executeAction(s, 0, 'effect-choice', { promptId: p.id, choice: [giveCard.uid] });
      expect(s.players[1].hand).toHaveLength(oppHandBefore + 1);
      expect(giveCard.owner).toBe(1);
      expect(giveCard.zone).toBe('hand');
      expect(s.players[0].hand).toHaveLength(1 + 2); // keep + 抽 2
      expect(s.players[0].deck).toHaveLength(deckBefore - 2);
      expect(s.pendingEffects).toHaveLength(0);
    });

    it('end trigger: skipping gives nothing and draws nothing', () => {
      const s = draftLoveP1();
      advanceToStep(s, 0, 'end');
      const ll = loveLine(s);
      const lv1 = makeCard('love-1', 0, 'field', true, ll, 0);
      const giveCard = makeCard('water-2', 0, 'hand');
      const keep = makeCard('death-3', 0, 'hand');
      s.players[0].stacks[ll] = [lv1];
      s.players[0].hand = [giveCard, keep];
      const oppHandBefore = s.players[1].hand.length;
      const deckBefore = s.players[0].deck.length;
      const t = collectTriggers(s, 'end').find((x) => x.cardUid === lv1.uid)!;
      resolveTrigger(s, t);
      runStack(s);
      const p = s.pendingEffects[s.pendingEffects.length - 1];
      executeAction(s, 0, 'effect-choice', { promptId: p.id, choice: [] }); // 跳过
      expect(s.players[1].hand).toHaveLength(oppHandBefore);
      expect(s.players[0].hand).toHaveLength(2);
      expect(s.players[0].deck).toHaveLength(deckBefore);
      expect(s.pendingEffects).toHaveLength(0);
    });

    it('end trigger: empty hand → auto-judgment cond → NOT collected (no button)', () => {
      const s = draftLoveP1();
      advanceToStep(s, 0, 'end');
      const ll = loveLine(s);
      const lv1 = makeCard('love-1', 0, 'field', true, ll, 0);
      s.players[0].stacks[ll] = [lv1];
      s.players[0].hand = [];
      const oppHandBefore = s.players[1].hand.length;
      const deckBefore = s.players[0].deck.length;
      // 无手牌 = 无可给对象 → 收集前 cond 预检不通过 → 不收集、不弹按钮
      const ts = collectTriggers(s, 'end');
      expect(ts.find((x) => x.cardUid === lv1.uid)).toBeUndefined();
      expect(ts).toHaveLength(0);
      // 无必选触发 → advance 不被拦截（旧行为：必选触发空手 fizzle 需点穿）
      expect(getLegalActions(s, 0).some((a) => a.kind === 'advance')).toBe(true);
      expect(s.players[1].hand).toHaveLength(oppHandBefore);
      expect(s.players[0].hand).toHaveLength(0);
      expect(s.players[0].deck).toHaveLength(deckBefore);
    });

    it('end trigger: covered love-1 is NOT collected (bottom command: uncovered only)', () => {
      const s = draftLoveP1();
      advanceToStep(s, 0, 'end');
      const ll = loveLine(s);
      const lv1 = makeCard('love-1', 0, 'field', true, ll, 0);
      const cover = makeCard('death-1', 0, 'field', true, ll, 1);
      s.players[0].stacks[ll] = [lv1, cover];
      const ts = collectTriggers(s, 'end');
      expect(ts.find((x) => x.cardUid === lv1.uid)).toBeUndefined();
      expect(ts).toHaveLength(0);
    });
  });

  describe('love-2 middle: 对手抽1张牌。刷新。', () => {
    it('opponent draws 1, then refresh draws up to 5 (hand 0 → 5)', () => {
      const s = draftLoveP1();
      advanceToStep(s, 0, 'action');
      const ll = loveLine(s);
      s.players[0].hand = [makeCard('love-2', 0, 'hand')];
      const oppHandBefore = s.players[1].hand.length;
      const oppDeckBefore = s.players[1].deck.length;
      const ownDeckBefore = s.players[0].deck.length;
      const card = s.players[0].hand[0];
      executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: true, line: ll });
      resolveAllChoices(s, pickFirst);
      expect(s.players[1].hand).toHaveLength(oppHandBefore + 1); // 对手抽 1
      expect(s.players[1].deck).toHaveLength(oppDeckBefore - 1);
      expect(s.players[0].hand).toHaveLength(5); // 刷新抽至 5
      expect(s.players[0].deck).toHaveLength(ownDeckBefore - 5);
      expect(s.pendingEffects).toHaveLength(0);
    });

    it('refresh consumes the control component when held (FAQ 161), opponent-held control stays', () => {
      const s = draftLoveP1();
      advanceToStep(s, 0, 'action');
      const ll = loveLine(s);
      s.players[0].hand = [makeCard('love-2', 0, 'hand')];
      s.control = 0; // P1 持有控制组件
      const card = s.players[0].hand[0];
      executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: true, line: ll });
      resolveAllChoices(s, pickFirst);
      expect(s.control).toBe(-1); // 刷新 → 控制回中立

      const s2 = draftLoveP1();
      advanceToStep(s2, 0, 'action');
      s2.players[0].hand = [makeCard('love-2', 0, 'hand')];
      s2.control = 1; // 对手（P2）持有 → 不属于刷新者
      const card2 = s2.players[0].hand[0];
      executeAction(s2, 0, 'play', { cardUid: card2.uid, faceUp: true, line: loveLine(s2) });
      resolveAllChoices(s2, pickFirst);
      expect(s2.control).toBe(1); // 不重置对手持有的控制
    });

    it('hand already at 5 after playing → refresh draws nothing (need = 0)', () => {
      const s = draftLoveP1();
      advanceToStep(s, 0, 'action');
      const ll = loveLine(s);
      const extras = [
        makeCard('love-1', 0, 'hand'),
        makeCard('love-3', 0, 'hand'),
        makeCard('love-4', 0, 'hand'),
        makeCard('love-5', 0, 'hand'),
        makeCard('love-6', 0, 'hand'),
      ];
      s.players[0].hand = [makeCard('love-2', 0, 'hand'), ...extras]; // 6 张
      const ownDeckBefore = s.players[0].deck.length;
      const card = s.players[0].hand[0];
      executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: true, line: ll });
      resolveAllChoices(s, pickFirst);
      expect(s.players[0].hand).toHaveLength(5); // 打出后 5 张 → need=0 → 不抽
      expect(s.players[0].deck).toHaveLength(ownDeckBefore);
      expect(s.pendingEffects).toHaveLength(0);
    });
  });

  describe('love-3 middle: 随机拿走1张对手的手牌。你把1张手牌给对手。', () => {
    it('takes 1 random opponent hand card (owner changes), then gives 1 own hand card', () => {
      const s = draftLoveP1();
      advanceToStep(s, 0, 'action');
      const ll = loveLine(s);
      const oppCards = [makeCard('death-0', 1, 'hand'), makeCard('death-1', 1, 'hand'), makeCard('death-2', 1, 'hand')];
      s.players[1].hand = oppCards;
      s.players[0].hand = [makeCard('love-3', 0, 'hand')];
      // 快照：takeRandom 会 splice 改写 s.players[1].hand（与 oppCards 同引用），后续断言须用快照
      const oppUids = oppCards.map((c) => c.uid);
      const card = s.players[0].hand[0];
      executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: true, line: ll });
      // 随机拿走 1 张：P1 手牌 = 被拿走的卡
      expect(s.players[0].hand).toHaveLength(1);
      const taken = s.players[0].hand[0];
      expect(oppUids.includes(taken.uid)).toBe(true); // 取自对手原手牌
      expect(taken.owner).toBe(0);
      expect(taken.zone).toBe('hand');
      expect(s.players[1].hand).toHaveLength(2);
      // 把 1 张手牌给对手：P1 唯一手牌 = 被拿走的卡
      const p = s.pendingEffects[s.pendingEffects.length - 1];
      expect(p.prompt?.kind).toBe('select');
      expect(p.prompt?.candidates.map((c) => c.uid)).toEqual([taken.uid]);
      executeAction(s, 0, 'effect-choice', { promptId: p.id, choice: [taken.uid] });
      expect(taken.owner).toBe(1);
      expect(s.players[1].hand).toHaveLength(3);
      expect(s.players[0].hand).toHaveLength(0);
      expect(s.pendingEffects).toHaveLength(0);
    });

    it('opponent hand empty → take step fizzles but give still happens (拍板)', () => {
      const s = draftLoveP1();
      advanceToStep(s, 0, 'action');
      const ll = loveLine(s);
      s.players[1].hand = [];
      const giveCard = makeCard('water-4', 0, 'hand');
      s.players[0].hand = [makeCard('love-3', 0, 'hand'), giveCard];
      const card = s.players[0].hand[0];
      executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: true, line: ll });
      // take fizzle（对手无手牌）→ 直接到 give 选择
      const p = s.pendingEffects[s.pendingEffects.length - 1];
      expect(p.prompt?.kind).toBe('select');
      expect(p.prompt?.candidates.map((c) => c.uid)).toEqual([giveCard.uid]);
      executeAction(s, 0, 'effect-choice', { promptId: p.id, choice: [giveCard.uid] });
      expect(giveCard.owner).toBe(1);
      expect(s.players[1].hand.map((c) => c.uid)).toEqual([giveCard.uid]);
      expect(s.players[0].hand).toHaveLength(0);
      expect(s.pendingEffects).toHaveLength(0);
    });

    it('own hand empty and opponent hand empty → both steps fizzle without hanging', () => {
      const s = draftLoveP1();
      advanceToStep(s, 0, 'action');
      const ll = loveLine(s);
      s.players[1].hand = [];
      s.players[0].hand = [makeCard('love-3', 0, 'hand')];
      const card = s.players[0].hand[0];
      executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: true, line: ll });
      resolveAllChoices(s, pickFirst);
      expect(s.players[0].hand).toHaveLength(0);
      expect(s.players[1].hand).toHaveLength(0);
      expect(s.pendingEffects).toHaveLength(0);
    });
  });

  describe('love-4 middle: 揭示1张你的手牌。翻转1张牌。', () => {
    it('reveals 1 own hand card (Case A ghost to opponent), then flips 1 top card', () => {
      const s = draftLoveP1();
      advanceToStep(s, 0, 'action');
      const ll = loveLine(s);
      const secret = makeCard('fire-1', 0, 'hand');
      s.players[0].hand = [makeCard('love-4', 0, 'hand'), secret];
      const target = makeCard('water-0', 1, 'field', true, 1, 0); // 对手正面顶卡
      s.players[1].stacks[1] = [target];
      const card = s.players[0].hand[0];
      const turnCount = s.turnCount;
      executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: true, line: ll });
      // 选要揭示的手牌
      const p = s.pendingEffects[s.pendingEffects.length - 1];
      expect(p.prompt?.kind).toBe('select');
      expect(p.prompt?.candidates.map((c) => c.uid)).toEqual([secret.uid]);
      executeAction(s, 0, 'effect-choice', { promptId: p.id, choice: [secret.uid] });
      // Case A：幽灵给对手，expiresAtTurn = turnCount + 2
      expect(s.revealedGhosts).toHaveLength(1);
      expect(s.revealedGhosts[0].defId).toBe('fire-1');
      expect(s.revealedGhosts[0].shownTo).toBe(1);
      expect(s.revealedGhosts[0].expiresAtTurn).toBe(turnCount + 2);
      expect(s.revealedGhosts[0].lightFx).toBeFalsy(); // 非 light 协议揭示 → 无光之辉光
      // 翻转：选场上顶卡
      const p2 = s.pendingEffects[s.pendingEffects.length - 1];
      expect(p2.prompt?.kind).toBe('select');
      expect(p2.prompt?.candidates.map((c) => c.uid)).toEqual([target.uid]);
      executeAction(s, 0, 'effect-choice', { promptId: p2.id, choice: [target.uid] });
      expect(target.faceUp).toBe(false); // 翻转
      expect(secret.zone).toBe('hand'); // 揭示不改原卡状态
      expect(s.pendingEffects).toHaveLength(0);
    });

    it('empty hand → reveal fizzles but flip still happens (each sentence independent)', () => {
      const s = draftLoveP1();
      advanceToStep(s, 0, 'action');
      const ll = loveLine(s);
      s.players[0].hand = [makeCard('love-4', 0, 'hand')];
      const target = makeCard('metal-0', 0, 'field', true, 1, 0);
      s.players[0].stacks[1] = [target];
      const card = s.players[0].hand[0];
      executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: true, line: ll });
      // 手牌空 → reveal 步直接跳过（生成器不挂起）→ flip 选择已在栈顶
      const p = s.pendingEffects[s.pendingEffects.length - 1];
      expect(p.prompt?.kind).toBe('select');
      expect(p.prompt?.candidates.map((c) => c.uid)).toEqual([target.uid]);
      executeAction(s, 0, 'effect-choice', { promptId: p.id, choice: [target.uid] });
      expect(target.faceUp).toBe(false);
      expect(s.revealedGhosts).toHaveLength(0); // 未揭示
      expect(s.pendingEffects).toHaveLength(0);
    });

    it('no other field top card → flip fizzles without hanging', () => {
      const s = draftLoveP1();
      advanceToStep(s, 0, 'action');
      const ll = loveLine(s);
      const secret = makeCard('fire-1', 0, 'hand');
      s.players[0].hand = [makeCard('love-4', 0, 'hand'), secret];
      const card = s.players[0].hand[0];
      executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: true, line: ll });
      const p = s.pendingEffects[s.pendingEffects.length - 1];
      executeAction(s, 0, 'effect-choice', { promptId: p.id, choice: [secret.uid] });
      resolveAllChoices(s, pickFirst); // 场上只剩 love-4（结算中源卡被排除）→ flip 自动跳过
      expect(s.revealedGhosts).toHaveLength(1);
      expect(s.pendingEffects).toHaveLength(0);
    });
  });

  describe('love-5 middle: 弃1张牌。', () => {
    it('discards 1 from hand', () => {
      const s = draftLoveP1();
      advanceToStep(s, 0, 'action');
      const ll = loveLine(s);
      s.players[0].hand = [makeCard('love-5', 0, 'hand'), makeCard('love-6', 0, 'hand')];
      const target = s.players[0].hand.find((c) => c.defId === 'love-5')!;
      const other = s.players[0].hand.find((c) => c.defId === 'love-6')!;
      executeAction(s, 0, 'play', { cardUid: target.uid, faceUp: true, line: ll });
      resolveAllChoices(s, (p) => [other.uid]); // 弃 love-6
      expect(s.players[0].trash.map((c) => c.uid)).toEqual([other.uid]);
      expect(s.players[0].hand).toHaveLength(0);
      expect(s.players[0].stacks[ll].map((c) => c.uid)).toEqual([target.uid]);
      expect(s.pendingEffects).toHaveLength(0);
    });

    it('empty hand → fizzles without hanging', () => {
      const s = draftLoveP1();
      advanceToStep(s, 0, 'action');
      const ll = loveLine(s);
      s.players[0].hand = [makeCard('love-5', 0, 'hand')];
      const card = s.players[0].hand[0];
      executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: true, line: ll });
      resolveAllChoices(s, pickFirst);
      expect(s.pendingEffects).toHaveLength(0);
      expect(s.players[0].trash).toHaveLength(0); // 无牌可弃
    });
  });

  describe('love-6 middle: 对手抽2张牌。', () => {
    it('opponent draws 2 cards', () => {
      const s = draftLoveP1();
      advanceToStep(s, 0, 'action');
      const ll = loveLine(s);
      s.players[0].hand = [makeCard('love-6', 0, 'hand')];
      const oppHandBefore = s.players[1].hand.length;
      const oppDeckBefore = s.players[1].deck.length;
      const card = s.players[0].hand[0];
      executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: true, line: ll });
      resolveAllChoices(s, pickFirst);
      expect(s.players[1].hand).toHaveLength(oppHandBefore + 2);
      expect(s.players[1].deck).toHaveLength(oppDeckBefore - 2);
      expect(s.players[0].hand).toHaveLength(0);
      expect(s.pendingEffects).toHaveLength(0);
    });
  });
});
