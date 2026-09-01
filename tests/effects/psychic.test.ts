import { describe, it, expect } from 'vitest';
import type { GameState, Line } from '../../src/core/models/types';
import { executeAction } from '../../src/core/game';
import { collectTriggers, resolveTrigger } from '../../src/core/effects/triggers';
import { runStack } from '../../src/core/effects/resolve';
import { registerCardEffects } from '../../src/core/effects/registry';
import { opponentMustPlayFaceDown } from '../../src/core/rules/restrictions';
import { makeCard, pickFirst, resolveAllChoices, draftPsychicP1, advanceToStep } from '../helpers';

function psychicLine(s: GameState): Line {
  const idx = s.players[0].protocols.findIndex((p) => p.defId === 'psychic');
  return idx as Line;
}

/** 测试用 after-discard 触发卡（P1 场上）：对手弃牌后 P1 抽 1 —— 验证 psychic 弃牌只触发一次 */
registerCardEffects('t-psy-after-discard', {
  triggers: {
    'after-discard': {
      fn: function* (ctx) {
        yield { op: 'draw', count: 1 };
      },
      optional: false,
    },
  },
});

describe('psychic protocol effects', () => {
  describe('psychic-0 middle: draw 2, opponent discards 2, then reveal their hand', () => {
    it('draws 2; opponent (chooser=1) discards 2 via discardMany (after-discard once); remaining hand revealed as ghosts', () => {
      const s = draftPsychicP1();
      advanceToStep(s, 0, 'action');
      const pl = psychicLine(s);
      // P1 场上另一线放 after-discard 触发卡（验证批量弃只触发一次）
      const trig = makeCard('t-psy-after-discard', 0, 'field', true, 1, 0);
      s.players[0].stacks[1] = [trig];
      s.players[0].hand = [makeCard('psychic-0', 0, 'hand')];
      const oppCards = [makeCard('death-0', 1, 'hand'), makeCard('death-1', 1, 'hand'), makeCard('death-2', 1, 'hand')];
      s.players[1].hand = oppCards;
      // 快照：弃牌会 splice 改写 s.players[1].hand（与 oppCards 同引用），后续断言须用快照
      const oppUids = oppCards.map((c) => c.uid);
      const oppDefIds = oppCards.map((c) => c.defId);
      const card = s.players[0].hand[0];
      executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: true, line: pl });
      // 抽 2（打出后手牌 0 → 2）
      expect(s.players[0].hand).toHaveLength(2);
      // 对手弃 2：选择权归对手
      const p = s.pendingEffects[s.pendingEffects.length - 1];
      expect(p.prompt?.kind).toBe('select');
      expect(p.prompt?.chooser).toBe(1);
      expect(p.prompt?.min).toBe(2);
      expect(p.prompt?.max).toBe(2);
      expect(p.prompt?.candidates.map((c) => c.uid)).toEqual(oppUids);
      // 效果属主（P1）无选择权
      expect(() => executeAction(s, 0, 'effect-choice', { promptId: p.id, choice: [oppUids[0], oppUids[1]] })).toThrow(/not your choice/);
      executeAction(s, 1, 'effect-choice', { promptId: p.id, choice: [oppUids[0], oppUids[1]] });
      // 批量弃：一次性弃入对手弃牌堆
      expect(s.players[1].hand.map((c) => c.uid)).toEqual([oppUids[2]]);
      expect(s.players[1].trash.map((c) => c.uid).sort()).toEqual([oppUids[0], oppUids[1]].sort());
      // after-discard 只触发一次（逐个 discard 会是 2）：P1 抽 1（手牌 2 → 3）
      expect(s.players[0].hand).toHaveLength(3);
      // 揭示剩余手牌：Case B 幽灵（shownTo = 发起者 P1，expiresAtTurn = turnCount + 3）
      expect(s.revealedGhosts).toHaveLength(1);
      expect(s.revealedGhosts[0].defId).toBe(oppDefIds[2]);
      expect(s.revealedGhosts[0].shownTo).toBe(0);
      expect(s.revealedGhosts[0].expiresAtTurn).toBe(s.turnCount + 3);
      expect(s.revealedGhosts[0].lightFx).toBeFalsy(); // 非 light 协议揭示 → 无光之辉光
      expect(s.pendingEffects).toHaveLength(0);
    });

    it('opponent hand < 2 → discards the only card (尽力而为 user ruling), reveal still happens', () => {
      const s = draftPsychicP1();
      advanceToStep(s, 0, 'action');
      const pl = psychicLine(s);
      s.players[0].hand = [makeCard('psychic-0', 0, 'hand')];
      const only = makeCard('death-5', 1, 'hand');
      s.players[1].hand = [only];
      const card = s.players[0].hand[0];
      executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: true, line: pl });
      resolveAllChoices(s, pickFirst); // min=min(2,1)=1 → 弃 1 张（无挂起）
      expect(s.players[0].hand).toHaveLength(2); // 抽 2 仍结算
      expect(s.players[1].hand).toHaveLength(0); // 尽力弃 1
      expect(s.players[1].trash.map((c) => c.uid)).toEqual([only.uid]);
      expect(s.revealedGhosts).toHaveLength(0); // 手牌已空 → 揭示无目标
      expect(s.pendingEffects).toHaveLength(0);
    });

    it('opponent hand empty → discard skipped, reveal loop has no targets (no ghosts)', () => {
      const s = draftPsychicP1();
      advanceToStep(s, 0, 'action');
      const pl = psychicLine(s);
      s.players[0].hand = [makeCard('psychic-0', 0, 'hand')];
      s.players[1].hand = [];
      const card = s.players[0].hand[0];
      executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: true, line: pl });
      resolveAllChoices(s, pickFirst);
      expect(s.players[0].hand).toHaveLength(2);
      expect(s.revealedGhosts).toHaveLength(0);
      expect(s.pendingEffects).toHaveLength(0);
    });
  });

  describe('psychic-1 bottom: start — flip this card (top command wired in restrictions, no effect)', () => {
    it('start trigger collects the uncovered psychic-1 (bottom: no top flag) and flips it face-down', () => {
      const s = draftPsychicP1(); // 草案结束即 P1 的 start 步骤
      expect(s.step).toBe('start');
      const sl = psychicLine(s);
      const p1 = makeCard('psychic-1', 0, 'field', true, sl, 0);
      s.players[0].stacks[sl] = [p1];
      const t = collectTriggers(s, 'start').find((x) => x.cardUid === p1.uid);
      expect(t).toBeDefined();
      expect(t?.top).toBeUndefined(); // 底命令：非顶命令触发（不注册 top 标志）
      resolveTrigger(s, t!);
      runStack(s);
      expect(p1.faceUp).toBe(false); // 翻转此牌
      expect(s.players[0].stacks[sl].map((c) => c.uid)).toEqual([p1.uid]);
      expect(s.pendingEffects).toHaveLength(0);
    });

    it('covered psychic-1 is NOT collected at start (bottom command: uncovered only)', () => {
      const s = draftPsychicP1();
      const sl = psychicLine(s);
      const p1 = makeCard('psychic-1', 0, 'field', true, sl, 0);
      const cover = makeCard('psychic-5', 0, 'field', true, sl, 1); // 无 start 触发的盖卡
      s.players[0].stacks[sl] = [p1, cover];
      const ts = collectTriggers(s, 'start');
      expect(ts.find((x) => x.cardUid === p1.uid)).toBeUndefined();
      expect(ts).toHaveLength(0);
    });

    it('flipping psychic-1 face-down deactivates the opponent face-up restriction', () => {
      const s = draftPsychicP1();
      const sl = psychicLine(s);
      const p1 = makeCard('psychic-1', 0, 'field', true, sl, 0);
      s.players[0].stacks[sl] = [p1];
      expect(opponentMustPlayFaceDown(s, 1)).toBe(true); // P2 只能反面打（顶命令）
      const t = collectTriggers(s, 'start').find((x) => x.cardUid === p1.uid)!;
      resolveTrigger(s, t);
      runStack(s);
      expect(p1.faceUp).toBe(false);
      expect(opponentMustPlayFaceDown(s, 1)).toBe(false); // 顶命令失效
    });
  });

  describe('psychic-2 middle: opponent discards 2, you rearrange the opponent protocols', () => {
    it('opponent (chooser=1) discards 2, then P1 picks a then b (≠a) and swaps opponent protocols', () => {
      const s = draftPsychicP1();
      advanceToStep(s, 0, 'action');
      const pl = psychicLine(s);
      s.players[0].hand = [makeCard('psychic-2', 0, 'hand')];
      const oppCards = [makeCard('death-0', 1, 'hand'), makeCard('death-1', 1, 'hand'), makeCard('death-2', 1, 'hand')];
      s.players[1].hand = oppCards;
      const oppUids = oppCards.map((c) => c.uid); // 快照：弃牌会改写 oppCards 引用数组
      const before = s.players[1].protocols.map((p) => ({ defId: p.defId, compiled: p.compiled }));
      const card = s.players[0].hand[0];
      executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: true, line: pl });
      // 对手弃 2（chooser=1）
      const p = s.pendingEffects[s.pendingEffects.length - 1];
      expect(p.prompt?.kind).toBe('select');
      expect(p.prompt?.chooser).toBe(1);
      expect(p.prompt?.min).toBe(2);
      expect(p.prompt?.max).toBe(2);
      executeAction(s, 1, 'effect-choice', { promptId: p.id, choice: [oppUids[0], oppUids[1]] });
      expect(s.players[1].hand.map((c) => c.uid)).toEqual([oppUids[2]]);
      expect(s.players[1].trash).toHaveLength(2);
      // 重排对手协议：位置 a（3 选 1）→ 位置 b（≠a）
      const p2 = s.pendingEffects[s.pendingEffects.length - 1];
      expect(p2.prompt?.kind).toBe('select-line');
      expect(p2.prompt?.lines).toEqual([0, 1, 2]);
      executeAction(s, 0, 'effect-choice', { promptId: p2.id, choice: ['line:0'] });
      const p3 = s.pendingEffects[s.pendingEffects.length - 1];
      expect(p3.prompt?.kind).toBe('select-line');
      expect(p3.prompt?.lines).toEqual([1, 2]); // 排除已选位置
      executeAction(s, 0, 'effect-choice', { promptId: p3.id, choice: ['line:2'] });
      // 交换的是【对手】的协议（P1 的协议不动）
      expect(s.players[1].protocols[0].defId).toBe(before[2].defId);
      expect(s.players[1].protocols[2].defId).toBe(before[0].defId);
      expect(s.players[1].protocols[0].compiled).toBe(before[2].compiled);
      expect(s.players[1].protocols[2].compiled).toBe(before[0].compiled);
      expect(s.players[1].protocols[1].defId).toBe(before[1].defId);
      expect(s.players[0].protocols.map((p) => p.defId)).toEqual(['psychic', s.players[0].protocols[1].defId, s.players[0].protocols[2].defId]);
      expect(s.pendingEffects).toHaveLength(0);
    });

    it('opponent hand < 2 → discards the only card (尽力而为 user ruling), rearrange still happens', () => {
      const s = draftPsychicP1();
      advanceToStep(s, 0, 'action');
      const pl = psychicLine(s);
      s.players[0].hand = [makeCard('psychic-2', 0, 'hand')];
      const only = makeCard('death-5', 1, 'hand');
      s.players[1].hand = [only];
      const before = s.players[1].protocols.map((p) => p.defId);
      const card = s.players[0].hand[0];
      executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: true, line: pl });
      // 弃牌（chooser=opp）挂起 → 由对手应答弃 1
      const disc = s.pendingEffects[s.pendingEffects.length - 1];
      expect(disc.prompt?.kind).toBe('select');
      expect(disc.prompt?.min).toBe(1); // min = min(2, hand.length=1) = 1
      executeAction(s, 1, 'effect-choice', { promptId: disc.id, choice: [only.uid] });
      const p = s.pendingEffects[s.pendingEffects.length - 1];
      expect(p.prompt?.kind).toBe('select-line'); // 重排仍执行
      expect(p.prompt?.lines).toEqual([0, 1, 2]);
      executeAction(s, 0, 'effect-choice', { promptId: p.id, choice: ['line:0'] });
      const p2 = s.pendingEffects[s.pendingEffects.length - 1];
      executeAction(s, 0, 'effect-choice', { promptId: p2.id, choice: ['line:1'] });
      expect(s.players[1].protocols.map((p) => p.defId)).toEqual([before[1], before[0], before[2]]);
      expect(s.players[1].hand).toHaveLength(0); // 尽力弃 1
      expect(s.players[1].trash.map((c) => c.uid)).toEqual([only.uid]);
      expect(s.pendingEffects).toHaveLength(0);
    });
  });

  describe('psychic-3 middle: opponent discards 1, shift 1 opponent card', () => {
    it('opponent (chooser=1) discards 1; P1 picks an opponent top card, then a line (≠ its line) and shifts it', () => {
      const s = draftPsychicP1();
      advanceToStep(s, 0, 'action');
      const pl = psychicLine(s);
      s.players[0].hand = [makeCard('psychic-3', 0, 'hand')];
      const oppCards = [makeCard('death-1', 1, 'hand'), makeCard('death-2', 1, 'hand')];
      s.players[1].hand = oppCards;
      const oppUids = oppCards.map((c) => c.uid); // 快照：弃牌会改写 oppCards 引用数组
      const target = makeCard('metal-1', 1, 'field', false, 1, 0); // 对手另列反面顶卡
      s.players[1].stacks[1] = [target];
      const card = s.players[0].hand[0];
      executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: true, line: pl });
      // 对手弃 1（chooser=1，min1 max1）
      const p = s.pendingEffects[s.pendingEffects.length - 1];
      expect(p.prompt?.kind).toBe('select');
      expect(p.prompt?.chooser).toBe(1);
      expect(p.prompt?.min).toBe(1);
      executeAction(s, 1, 'effect-choice', { promptId: p.id, choice: [oppUids[0]] });
      expect(s.players[1].trash.map((c) => c.uid)).toEqual([oppUids[0]]);
      // 选对手场上顶卡（打出者 P1 选目标——chooser 缺省 = 效果属主）
      const p2 = s.pendingEffects[s.pendingEffects.length - 1];
      expect(p2.prompt?.kind).toBe('select');
      expect(p2.prompt?.chooser).toBeUndefined();
      expect(p2.prompt?.candidates.map((c) => c.uid)).toEqual([target.uid]); // 只列对手顶卡
      executeAction(s, 0, 'effect-choice', { promptId: p2.id, choice: [target.uid] });
      // select-line 排除被移卡当前线（shift op 约束）
      const p3 = s.pendingEffects[s.pendingEffects.length - 1];
      expect(p3.prompt?.kind).toBe('select-line');
      expect(p3.prompt?.lines).toEqual(([0, 1, 2] as Line[]).filter((l) => l !== 1));
      const dest = ([0, 1, 2] as Line[]).find((l) => l !== 1)!;
      executeAction(s, 0, 'effect-choice', { promptId: p3.id, choice: [`line:${dest}`] });
      expect(s.players[1].stacks[1]).toHaveLength(0);
      expect(s.players[1].stacks[dest].map((c) => c.uid)).toEqual([target.uid]);
      expect(target.faceUp).toBe(false); // 反面平移（不翻面）
      expect(s.pendingEffects).toHaveLength(0);
      expect(s.pendingShift).toHaveLength(0);
    });

    it('opponent hand empty → discard skipped, shift still happens', () => {
      const s = draftPsychicP1();
      advanceToStep(s, 0, 'action');
      const pl = psychicLine(s);
      s.players[0].hand = [makeCard('psychic-3', 0, 'hand')];
      s.players[1].hand = [];
      const target = makeCard('metal-1', 1, 'field', false, 2, 0);
      s.players[1].stacks[2] = [target];
      const card = s.players[0].hand[0];
      executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: true, line: pl });
      const p = s.pendingEffects[s.pendingEffects.length - 1];
      expect(p.prompt?.kind).toBe('select'); // 直接是选目标卡（弃牌步骤跳过）
      expect(p.prompt?.candidates.map((c) => c.uid)).toEqual([target.uid]);
      executeAction(s, 0, 'effect-choice', { promptId: p.id, choice: [target.uid] });
      const p2 = s.pendingEffects[s.pendingEffects.length - 1];
      const dest = ([0, 1, 2] as Line[]).find((l) => l !== 2)!;
      executeAction(s, 0, 'effect-choice', { promptId: p2.id, choice: [`line:${dest}`] });
      expect(s.players[1].stacks[dest].map((c) => c.uid)).toEqual([target.uid]);
      expect(s.pendingEffects).toHaveLength(0);
    });

    it('no opponent field top cards → shift select fizzles (discard still happens)', () => {
      const s = draftPsychicP1();
      advanceToStep(s, 0, 'action');
      const pl = psychicLine(s);
      s.players[0].hand = [makeCard('psychic-3', 0, 'hand')];
      s.players[1].hand = [makeCard('death-5', 1, 'hand')];
      s.players[1].stacks = [[], [], []];
      const card = s.players[0].hand[0];
      executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: true, line: pl });
      const p = s.pendingEffects[s.pendingEffects.length - 1];
      executeAction(s, 1, 'effect-choice', { promptId: p.id, choice: [s.players[1].hand[0].uid] });
      expect(s.players[1].trash).toHaveLength(1); // 弃牌已发生
      resolveAllChoices(s, pickFirst); // 无对手顶卡 → 平移 select fizzle（自动跳过）
      expect(s.pendingEffects).toHaveLength(0);
    });
  });

  describe('psychic-4 bottom: end — you may return 1 opponent card; if so, flip this card', () => {
    it('optional return of an opponent top card, then flips this card face-down', () => {
      const s = draftPsychicP1();
      advanceToStep(s, 0, 'end');
      const pl = psychicLine(s);
      const p4 = makeCard('psychic-4', 0, 'field', true, pl, 0);
      s.players[0].stacks[pl] = [p4];
      const target = makeCard('metal-1', 1, 'field', false, 1, 0);
      s.players[1].stacks[1] = [target];
      const t = collectTriggers(s, 'end').find((x) => x.cardUid === p4.uid);
      expect(t).toBeDefined();
      expect(t?.top).toBeUndefined(); // 底命令：非顶命令触发
      resolveTrigger(s, t!);
      runStack(s);
      const p = s.pendingEffects[s.pendingEffects.length - 1];
      expect(p.prompt?.kind).toBe('select');
      expect(p.prompt?.optional).toBe(true); // 你可以：可选
      expect(p.prompt?.candidates.map((c) => c.uid)).toEqual([target.uid]); // 对手场上顶卡
      executeAction(s, 0, 'effect-choice', { promptId: p.id, choice: [target.uid] });
      expect(target.zone).toBe('hand'); // 回手
      expect(s.players[1].hand.some((c) => c.uid === target.uid)).toBe(true); // 目标卡进入对手手牌
      expect(s.players[1].stacks[1]).toHaveLength(0);
      expect(p4.faceUp).toBe(false); // 若如此，翻转此牌
      expect(s.pendingEffects).toHaveLength(0);
    });

    it('optional: skipping returns nothing and does NOT flip', () => {
      const s = draftPsychicP1();
      advanceToStep(s, 0, 'end');
      const pl = psychicLine(s);
      const p4 = makeCard('psychic-4', 0, 'field', true, pl, 0);
      s.players[0].stacks[pl] = [p4];
      const target = makeCard('metal-1', 1, 'field', false, 1, 0);
      s.players[1].stacks[1] = [target];
      const t = collectTriggers(s, 'end').find((x) => x.cardUid === p4.uid)!;
      resolveTrigger(s, t);
      runStack(s);
      const p = s.pendingEffects[s.pendingEffects.length - 1];
      executeAction(s, 0, 'effect-choice', { promptId: p.id, choice: [] }); // 跳过
      expect(s.players[1].stacks[1].map((c) => c.uid)).toEqual([target.uid]); // 未回手
      expect(s.players[1].hand.some((c) => c.uid === target.uid)).toBe(false); // 目标卡不在手牌
      expect(p4.faceUp).toBe(true); // 未翻转
      expect(s.pendingEffects).toHaveLength(0);
    });

    it('covered psychic-4 is NOT collected at end (bottom command: uncovered only)', () => {
      const s = draftPsychicP1();
      advanceToStep(s, 0, 'end');
      const pl = psychicLine(s);
      const p4 = makeCard('psychic-4', 0, 'field', true, pl, 0);
      const cover = makeCard('psychic-5', 0, 'field', true, pl, 1);
      s.players[0].stacks[pl] = [p4, cover];
      const ts = collectTriggers(s, 'end');
      expect(ts.find((x) => x.cardUid === p4.uid)).toBeUndefined();
      expect(ts).toHaveLength(0);
    });

    it('no opponent field top cards → optional select fizzles (no return, no flip)', () => {
      const s = draftPsychicP1();
      advanceToStep(s, 0, 'end');
      const pl = psychicLine(s);
      const p4 = makeCard('psychic-4', 0, 'field', true, pl, 0);
      s.players[0].stacks[pl] = [p4];
      s.players[1].stacks = [[], [], []];
      const t = collectTriggers(s, 'end').find((x) => x.cardUid === p4.uid)!;
      resolveTrigger(s, t);
      runStack(s);
      expect(s.pendingEffects).toHaveLength(0); // 候选空 → 自动跳过
      expect(p4.faceUp).toBe(true); // 未翻转
    });
  });

  describe('psychic-5 middle: discard 1', () => {
    it('discards 1 from hand', () => {
      const s = draftPsychicP1();
      advanceToStep(s, 0, 'action');
      s.players[0].hand = [makeCard('psychic-5', 0, 'hand'), makeCard('psychic-0', 0, 'hand')];
      const target = s.players[0].hand.find((c) => c.defId === 'psychic-5')!;
      const other = s.players[0].hand.find((c) => c.defId !== 'psychic-5')!;
      executeAction(s, 0, 'play', { cardUid: target.uid, faceUp: true, line: psychicLine(s) });
      resolveAllChoices(s, (p) => [other.uid]); // 弃 psychic-0
      expect(s.players[0].trash.map((c) => c.uid)).toEqual([other.uid]);
      expect(s.players[0].hand).toHaveLength(0);
      expect(s.players[0].stacks[psychicLine(s)].map((c) => c.uid)).toEqual([target.uid]);
    });

    it('empty hand → fizzles without hanging', () => {
      const s = draftPsychicP1();
      advanceToStep(s, 0, 'action');
      s.players[0].hand = [makeCard('psychic-5', 0, 'hand')];
      const card = s.players[0].hand[0];
      executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: true, line: psychicLine(s) });
      resolveAllChoices(s, pickFirst);
      expect(s.pendingEffects).toHaveLength(0);
      expect(s.players[0].trash).toHaveLength(0); // 无牌可弃
    });
  });
});
