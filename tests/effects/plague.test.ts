import { describe, it, expect } from 'vitest';
import type { GameState, Line } from '../../src/core/models/types';
import { executeAction, getLegalActions } from '../../src/core/game';
import { collectTriggers, resolveTrigger } from '../../src/core/effects/triggers';
import { runStack } from '../../src/core/effects/resolve';
import { makeCard, pickFirst, resolveAllChoices, draftPlagueP1, advanceToStep } from '../helpers';

function plagueLine(s: GameState): Line {
  const idx = s.players[0].protocols.findIndex((p) => p.defId === 'plague');
  return idx as Line;
}

/** 测试用 system 效果（无源卡，跳过 sourceValid）执行单个弃牌 op——模拟任意弃牌来源 */
function pushDiscardGen(s: GameState, player: 0 | 1, uid: string): void {
  s.pendingEffects.push({
    id: `e-disc-${s.pendingEffects.length}`,
    player,
    gen: (function* () {
      yield { op: 'discard', uid };
    })(),
    sourceUid: 'sys-disc',
    sourceDefId: 'system',
    system: true,
    prompt: null,
    lastAnswer: null,
  });
}

describe('plague protocol effects', () => {
  describe('plague-0 middle: opponent discards 1 (bottom = line restriction, no effect)', () => {
    it('opponent (chooser=1) discards 1 card; P1 cannot answer', () => {
      const s = draftPlagueP1();
      advanceToStep(s, 0, 'action');
      const pl = plagueLine(s);
      s.players[0].hand = [makeCard('plague-0', 0, 'hand')];
      const oppCards = [makeCard('death-0', 1, 'hand'), makeCard('death-1', 1, 'hand')];
      s.players[1].hand = oppCards;
      const oppUids = oppCards.map((c) => c.uid); // 快照：弃牌会改写 oppCards 引用数组
      const card = s.players[0].hand[0];
      executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: true, line: pl });
      const p = s.pendingEffects[s.pendingEffects.length - 1];
      expect(p.prompt?.kind).toBe('select');
      expect(p.prompt?.chooser).toBe(1);
      expect(p.prompt?.min).toBe(1);
      expect(p.prompt?.max).toBe(1);
      expect(p.prompt?.candidates.map((c) => c.uid)).toEqual(oppUids);
      // 效果属主（P1）无选择权
      expect(() => executeAction(s, 0, 'effect-choice', { promptId: p.id, choice: [oppUids[0]] })).toThrow(/not your choice/);
      executeAction(s, 1, 'effect-choice', { promptId: p.id, choice: [oppUids[0]] });
      expect(s.players[1].hand.map((c) => c.uid)).toEqual([oppUids[1]]);
      expect(s.players[1].trash.map((c) => c.uid)).toEqual([oppUids[0]]);
      expect(s.pendingEffects).toHaveLength(0);
    });

    it('opponent hand empty → discard skipped, no hang', () => {
      const s = draftPlagueP1();
      advanceToStep(s, 0, 'action');
      const pl = plagueLine(s);
      s.players[0].hand = [makeCard('plague-0', 0, 'hand')];
      s.players[1].hand = [];
      const card = s.players[0].hand[0];
      executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: true, line: pl });
      resolveAllChoices(s, pickFirst);
      expect(s.players[1].trash).toHaveLength(0);
      expect(s.pendingEffects).toHaveLength(0);
    });

    it('bottom is NOT an end/start trigger (lineBlocksOpponent is a standing restriction)', () => {
      const s = draftPlagueP1();
      advanceToStep(s, 0, 'end');
      const pl = plagueLine(s);
      const p0 = makeCard('plague-0', 0, 'field', true, pl, 0);
      s.players[0].stacks[pl] = [p0];
      expect(collectTriggers(s, 'end')).toHaveLength(0); // 未注册 end/start 触发
    });

    it('bottom: opponent cannot play into the line (both orientations) — getLegalActions + playCard guard', () => {
      const s = draftPlagueP1();
      advanceToStep(s, 0, 'action');
      const pl = plagueLine(s);
      const p0 = makeCard('plague-0', 0, 'field', true, pl, 0);
      s.players[0].stacks[pl] = [p0]; // P1 未覆盖 plague-0 底
      s.players[1].hand = [makeCard('death-5', 1, 'hand')];
      s.turnPlayer = 1;
      const legal = getLegalActions(s, 1);
      expect(legal.some((a) => a.kind === 'play' && a.line === pl && a.faceUp === true)).toBe(false);
      expect(legal.some((a) => a.kind === 'play' && a.line === pl && a.faceUp === false)).toBe(false);
      expect(() =>
        executeAction(s, 1, 'play', { cardUid: s.players[1].hand[0].uid, faceUp: true, line: pl }),
      ).toThrow(/blocked line/);
    });
  });

  describe('plague-1 top: after opponent discards — you draw 1', () => {
    it('fires after the opponent discards (system discard) and P1 draws 1', () => {
      const s = draftPlagueP1();
      advanceToStep(s, 0, 'action');
      const pl = plagueLine(s);
      const p1 = makeCard('plague-1', 0, 'field', true, pl, 0);
      s.players[0].stacks[pl] = [p1];
      const oppCard = makeCard('death-5', 1, 'hand');
      s.players[1].hand = [oppCard];
      const handBefore = s.players[0].hand.length;
      const deckBefore = s.players[0].deck.length;
      pushDiscardGen(s, 1, oppCard.uid); // P2 弃牌
      runStack(s);
      expect(oppCard.zone).toBe('trash');
      expect(s.players[1].hand).toHaveLength(0);
      expect(s.players[0].hand).toHaveLength(handBefore + 1); // 对手弃牌后：你抽1张
      expect(s.players[0].deck).toHaveLength(deckBefore - 1);
      expect(s.pendingEffects).toHaveLength(0);
    });

    it('fires even when covered (top command: top flag)', () => {
      const s = draftPlagueP1();
      advanceToStep(s, 0, 'action');
      const pl = plagueLine(s);
      const p1 = makeCard('plague-1', 0, 'field', true, pl, 0);
      const cover = makeCard('plague-5', 0, 'field', true, pl, 1);
      s.players[0].stacks[pl] = [p1, cover]; // 被盖
      const oppCard = makeCard('death-5', 1, 'hand');
      s.players[1].hand = [oppCard];
      const handBefore = s.players[0].hand.length;
      pushDiscardGen(s, 1, oppCard.uid);
      runStack(s);
      expect(s.players[0].hand).toHaveLength(handBefore + 1); // 被盖仍生效（top 标志）
      expect(s.pendingEffects).toHaveLength(0);
    });

    it('does NOT fire on your own discard (after-discard scans the discarder’s OPPONENT)', () => {
      const s = draftPlagueP1();
      advanceToStep(s, 0, 'action');
      const pl = plagueLine(s);
      const p1 = makeCard('plague-1', 0, 'field', true, pl, 0);
      s.players[0].stacks[pl] = [p1];
      const ownCard = makeCard('plague-5', 0, 'hand');
      s.players[0].hand = [ownCard];
      const handBefore = s.players[0].hand.length;
      pushDiscardGen(s, 0, ownCard.uid); // P1 自己弃牌
      runStack(s);
      expect(s.players[0].hand).toHaveLength(handBefore - 1); // 只少弃的那张，无额外抽牌
      expect(s.players[1].hand).toHaveLength(5); // P2 无抽牌（P1 弃牌 → 只扫描 P2 场上）
      expect(s.pendingEffects).toHaveLength(0);
    });

    it('fires on system cache discards too (user ruling: 含系统缓存弃牌)', () => {
      const s = draftPlagueP1();
      const pl = plagueLine(s);
      const p1 = makeCard('plague-1', 0, 'field', true, pl, 0);
      s.players[0].stacks[pl] = [p1];
      // P2 回合 check-cache：手牌 7 张 → 清缓存弃 2（系统 discardMany → after-discard）
      s.turnPlayer = 1;
      s.step = 'check-cache';
      const cacheCards = [makeCard('death-0', 1, 'hand'), makeCard('death-1', 1, 'hand'), makeCard('death-2', 1, 'hand'), makeCard('death-3', 1, 'hand'), makeCard('death-4', 1, 'hand'), makeCard('death-5', 1, 'hand'), makeCard('water-1', 1, 'hand')];
      s.players[1].hand = cacheCards;
      const handBefore = s.players[0].hand.length;
      executeAction(s, 1, 'clear-cache');
      const p = s.pendingEffects[s.pendingEffects.length - 1];
      expect(p.prompt?.kind).toBe('select'); // P2 自选弃 2
      executeAction(s, 1, 'effect-choice', { promptId: p.id, choice: cacheCards.slice(0, 2).map((c) => c.uid) });
      expect(s.players[1].hand).toHaveLength(5); // 缓存清理完成
      expect(s.players[0].hand).toHaveLength(handBefore + 1); // 系统缓存弃牌也触发 plague-1
      expect(s.pendingEffects).toHaveLength(0);
    });
  });

  describe('plague-1 middle: opponent discards 1', () => {
    it('opponent (chooser=1) discards 1, then the played plague-1 top command chains: P1 draws 1', () => {
      const s = draftPlagueP1();
      advanceToStep(s, 0, 'action');
      const pl = plagueLine(s);
      s.players[0].hand = [makeCard('plague-1', 0, 'hand')];
      const oppCards = [makeCard('death-1', 1, 'hand')];
      s.players[1].hand = oppCards;
      const oppUid = oppCards[0].uid;
      const deckBefore = s.players[0].deck.length;
      const card = s.players[0].hand[0];
      executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: true, line: pl });
      const p = s.pendingEffects[s.pendingEffects.length - 1];
      expect(p.prompt?.kind).toBe('select');
      expect(p.prompt?.chooser).toBe(1);
      expect(p.prompt?.min).toBe(1);
      expect(p.prompt?.max).toBe(1);
      executeAction(s, 1, 'effect-choice', { promptId: p.id, choice: [oppUid] });
      expect(s.players[1].hand).toHaveLength(0);
      expect(s.players[1].trash.map((c) => c.uid)).toEqual([oppUid]);
      // 刚打出的 plague-1 顶命令即时连锁：对手弃牌后 → P1 抽 1
      expect(s.players[0].hand).toHaveLength(1);
      expect(s.players[0].deck).toHaveLength(deckBefore - 1);
      expect(s.pendingEffects).toHaveLength(0);
    });

    it('opponent hand empty → discard skipped, no after-discard chain, no hang', () => {
      const s = draftPlagueP1();
      advanceToStep(s, 0, 'action');
      const pl = plagueLine(s);
      s.players[0].hand = [makeCard('plague-1', 0, 'hand')];
      s.players[1].hand = [];
      const card = s.players[0].hand[0];
      executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: true, line: pl });
      resolveAllChoices(s, pickFirst);
      expect(s.players[0].hand).toHaveLength(0); // 未弃牌 → 无连锁抽牌
      expect(s.players[1].trash).toHaveLength(0);
      expect(s.pendingEffects).toHaveLength(0);
    });
  });

  describe('plague-2 middle: discard 1+, opponent discards your count + 1', () => {
    it('P1 discards 2 of 3 → N=2 → opponent (chooser=1) discards 3 via discardMany', () => {
      const s = draftPlagueP1();
      advanceToStep(s, 0, 'action');
      const pl = plagueLine(s);
      s.players[0].hand = [makeCard('plague-2', 0, 'hand'), makeCard('plague-0', 0, 'hand'), makeCard('plague-3', 0, 'hand')];
      const oppCards = [makeCard('death-0', 1, 'hand'), makeCard('death-1', 1, 'hand'), makeCard('death-2', 1, 'hand'), makeCard('death-3', 1, 'hand')];
      s.players[1].hand = oppCards;
      const oppUids = oppCards.map((c) => c.uid); // 快照
      const card = s.players[0].hand[0];
      executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: true, line: pl });
      // 自己弃 1+：min1 max=剩余手牌 2
      const p = s.pendingEffects[s.pendingEffects.length - 1];
      expect(p.prompt?.kind).toBe('select');
      expect(p.prompt?.min).toBe(1);
      expect(p.prompt?.max).toBe(2);
      const mine = p.prompt!.candidates.map((c) => c.uid);
      executeAction(s, 0, 'effect-choice', { promptId: p.id, choice: mine }); // 弃 2
      expect(s.players[0].hand).toHaveLength(0);
      expect(s.players[0].trash).toHaveLength(2);
      // 对手弃 N+1=3：chooser=opp
      const p2 = s.pendingEffects[s.pendingEffects.length - 1];
      expect(p2.prompt?.kind).toBe('select');
      expect(p2.prompt?.chooser).toBe(1);
      expect(p2.prompt?.min).toBe(3);
      expect(p2.prompt?.max).toBe(3);
      expect(p2.prompt?.candidates.map((c) => c.uid)).toEqual(oppUids);
      executeAction(s, 1, 'effect-choice', { promptId: p2.id, choice: oppUids.slice(0, 3) });
      expect(s.players[1].hand.map((c) => c.uid)).toEqual([oppUids[3]]);
      expect(s.players[1].trash).toHaveLength(3);
      expect(s.pendingEffects).toHaveLength(0);
    });

    it('P1 discards 1 → N=1 → opponent discards 2', () => {
      const s = draftPlagueP1();
      advanceToStep(s, 0, 'action');
      const pl = plagueLine(s);
      s.players[0].hand = [makeCard('plague-2', 0, 'hand'), makeCard('plague-0', 0, 'hand')];
      const oppCards = [makeCard('death-0', 1, 'hand'), makeCard('death-1', 1, 'hand'), makeCard('death-2', 1, 'hand')];
      s.players[1].hand = oppCards;
      const oppUids = oppCards.map((c) => c.uid);
      const card = s.players[0].hand[0];
      executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: true, line: pl });
      const p = s.pendingEffects[s.pendingEffects.length - 1];
      executeAction(s, 0, 'effect-choice', { promptId: p.id, choice: [p.prompt!.candidates[0].uid] }); // 弃 1
      expect(s.players[0].trash).toHaveLength(1);
      const p2 = s.pendingEffects[s.pendingEffects.length - 1];
      expect(p2.prompt?.min).toBe(2); // N+1 = 2
      expect(p2.prompt?.max).toBe(2);
      executeAction(s, 1, 'effect-choice', { promptId: p2.id, choice: oppUids.slice(0, 2) });
      expect(s.players[1].hand.map((c) => c.uid)).toEqual([oppUids[2]]);
      expect(s.pendingEffects).toHaveLength(0);
    });

    it('P1 hand empty → no self discard (N=0) → opponent still discards 1 (FAQ 39: sentences independent)', () => {
      const s = draftPlagueP1();
      advanceToStep(s, 0, 'action');
      const pl = plagueLine(s);
      s.players[0].hand = [makeCard('plague-2', 0, 'hand')];
      s.players[1].hand = [makeCard('death-0', 1, 'hand'), makeCard('death-1', 1, 'hand')];
      const oppUids = s.players[1].hand.map((c) => c.uid);
      const card = s.players[0].hand[0];
      executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: true, line: pl });
      // 自己手牌空 → 弃牌步骤跳过，直接是对手弃 0+1=1 张
      const p = s.pendingEffects[s.pendingEffects.length - 1];
      expect(p.prompt?.kind).toBe('select');
      expect(p.prompt?.chooser).toBe(1);
      expect(p.prompt?.min).toBe(1);
      expect(p.prompt?.max).toBe(1);
      executeAction(s, 1, 'effect-choice', { promptId: p.id, choice: [oppUids[0]] });
      expect(s.players[1].hand.map((c) => c.uid)).toEqual([oppUids[1]]);
      expect(s.pendingEffects).toHaveLength(0);
    });

    it('opponent hand insufficient (need 3, has 1) → discards all remaining (尽力而为 user ruling)', () => {
      const s = draftPlagueP1();
      advanceToStep(s, 0, 'action');
      const pl = plagueLine(s);
      s.players[0].hand = [makeCard('plague-2', 0, 'hand'), makeCard('plague-0', 0, 'hand')];
      const only = makeCard('death-5', 1, 'hand');
      s.players[1].hand = [only];
      const card = s.players[0].hand[0];
      executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: true, line: pl });
      const p = s.pendingEffects[s.pendingEffects.length - 1];
      executeAction(s, 0, 'effect-choice', { promptId: p.id, choice: [p.prompt!.candidates[0].uid] }); // 弃 1 → N=1 → 需 2
      const p2 = s.pendingEffects[s.pendingEffects.length - 1];
      expect(p2.prompt?.min).toBe(1); // min = min(2, 1) = 1（尽力弃全部）
      expect(p2.prompt?.max).toBe(2);
      executeAction(s, 1, 'effect-choice', { promptId: p2.id, choice: [only.uid] });
      expect(s.players[1].hand).toHaveLength(0);
      expect(s.players[1].trash.map((c) => c.uid)).toEqual([only.uid]);
      expect(s.pendingEffects).toHaveLength(0);
    });

    it('opponent hand empty → opponent batch skipped', () => {
      const s = draftPlagueP1();
      advanceToStep(s, 0, 'action');
      const pl = plagueLine(s);
      s.players[0].hand = [makeCard('plague-2', 0, 'hand'), makeCard('plague-0', 0, 'hand')];
      s.players[1].hand = [];
      const card = s.players[0].hand[0];
      executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: true, line: pl });
      const p = s.pendingEffects[s.pendingEffects.length - 1];
      executeAction(s, 0, 'effect-choice', { promptId: p.id, choice: [p.prompt!.candidates[0].uid] });
      expect(s.pendingEffects).toHaveLength(0); // 对手手牌空 → 无第二批弃牌
      expect(s.players[0].trash).toHaveLength(1);
    });

    it('integration: P1 face-up plague-1 on field draws 1 after the opponent batch of plague-2', () => {
      const s = draftPlagueP1();
      advanceToStep(s, 0, 'action');
      const pl = plagueLine(s);
      const p1 = makeCard('plague-1', 0, 'field', true, 1, 0);
      s.players[0].stacks[1] = [p1];
      s.players[0].hand = [makeCard('plague-2', 0, 'hand'), makeCard('plague-0', 0, 'hand')];
      const oppCards = [makeCard('death-0', 1, 'hand'), makeCard('death-1', 1, 'hand'), makeCard('death-2', 1, 'hand'), makeCard('death-3', 1, 'hand')];
      s.players[1].hand = oppCards;
      const oppUids = oppCards.map((c) => c.uid);
      const card = s.players[0].hand[0];
      executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: true, line: pl });
      const p = s.pendingEffects[s.pendingEffects.length - 1];
      executeAction(s, 0, 'effect-choice', { promptId: p.id, choice: [p.prompt!.candidates[0].uid] }); // 弃 1 → N=1
      const p2 = s.pendingEffects[s.pendingEffects.length - 1];
      executeAction(s, 1, 'effect-choice', { promptId: p2.id, choice: oppUids.slice(0, 2) }); // 对手弃 2
      expect(s.players[1].hand.map((c) => c.uid)).toEqual([oppUids[2], oppUids[3]]);
      expect(s.players[1].trash).toHaveLength(2);
      // 对手弃牌 → 即时连锁：P1 的 plague-1 顶命令抽 1
      expect(s.players[0].hand).toHaveLength(1); // 弃 1 后 0 张 → 抽 1
      expect(s.pendingEffects).toHaveLength(0);
    });
  });

  describe('plague-3 middle: flip all other uncovered face-up cards', () => {
    it('flips face-up top cards on BOTH fields (not self, not covered, not face-down)', () => {
      const s = draftPlagueP1();
      advanceToStep(s, 0, 'action');
      const pl = plagueLine(s);
      s.players[0].hand = [makeCard('plague-3', 0, 'hand')];
      const p3 = s.players[0].hand[0];
      // P1 场：pl 线 = plague-3；线1 = 底卡(正面,被盖) + 顶卡(正面)；线2 = 顶卡反面
      const covered = makeCard('plague-0', 0, 'field', true, 1, 0);
      const top1 = makeCard('plague-1', 0, 'field', true, 1, 1);
      s.players[0].stacks[1] = [covered, top1];
      const faceDown1 = makeCard('plague-2', 0, 'field', false, 2, 0);
      s.players[0].stacks[2] = [faceDown1];
      // P2 场：线0 = 正面顶卡；线1 = 反面顶卡
      const oppTop = makeCard('plague-5', 1, 'field', true, 0, 0);
      s.players[1].stacks[0] = [oppTop];
      const oppDown = makeCard('plague-4', 1, 'field', false, 1, 0);
      s.players[1].stacks[1] = [oppDown];
      executeAction(s, 0, 'play', { cardUid: p3.uid, faceUp: true, line: pl });
      resolveAllChoices(s, pickFirst); // 无选择请求（逐张自动 flip）
      expect(p3.faceUp).toBe(true); // 自己不被翻
      expect(top1.faceUp).toBe(false); // P1 正面顶卡被翻
      expect(oppTop.faceUp).toBe(false); // P2 正面顶卡被翻
      expect(covered.faceUp).toBe(true); // 被盖卡不受影响
      expect(faceDown1.faceUp).toBe(false); // 反面顶卡仍反面
      expect(oppDown.faceUp).toBe(false);
      expect(s.pendingEffects).toHaveLength(0);
    });

    it('only self on field → fizzles without hanging', () => {
      const s = draftPlagueP1();
      advanceToStep(s, 0, 'action');
      const pl = plagueLine(s);
      s.players[0].hand = [makeCard('plague-3', 0, 'hand')];
      const p3 = s.players[0].hand[0];
      executeAction(s, 0, 'play', { cardUid: p3.uid, faceUp: true, line: pl });
      resolveAllChoices(s, pickFirst);
      expect(p3.faceUp).toBe(true);
      expect(s.pendingEffects).toHaveLength(0);
    });
  });

  describe('plague-4 bottom: end — opponent deletes 1 of their face-down cards; you may flip this card', () => {
    it('end trigger: opponent (chooser=1) deletes own face-down top card; P1 may flip plague-4', () => {
      const s = draftPlagueP1();
      advanceToStep(s, 0, 'end');
      const pl = plagueLine(s);
      const p4 = makeCard('plague-4', 0, 'field', true, pl, 0);
      s.players[0].stacks[pl] = [p4];
      const target = makeCard('death-1', 1, 'field', false, 1, 0);
      s.players[1].stacks[1] = [target];
      const t = collectTriggers(s, 'end').find((x) => x.cardUid === p4.uid);
      expect(t).toBeDefined();
      expect(t?.top).toBeUndefined(); // 底命令：非顶命令触发
      resolveTrigger(s, t!);
      runStack(s);
      // 对手删自己的反面牌：chooser=opp
      const p = s.pendingEffects[s.pendingEffects.length - 1];
      expect(p.prompt?.kind).toBe('select');
      expect(p.prompt?.chooser).toBe(1);
      expect(p.prompt?.min).toBe(1);
      expect(p.prompt?.max).toBe(1);
      expect(p.prompt?.candidates.map((c) => c.uid)).toEqual([target.uid]);
      executeAction(s, 1, 'effect-choice', { promptId: p.id, choice: [target.uid] });
      expect(target.zone).toBe('trash');
      expect(s.players[1].stacks[1]).toHaveLength(0);
      expect(s.players[1].trash.map((c) => c.uid)).toEqual([target.uid]);
      // 你可以翻转这张牌：持有者二选一
      const p2 = s.pendingEffects[s.pendingEffects.length - 1];
      expect(p2.prompt?.kind).toBe('select-action');
      expect(p2.prompt?.actions).toEqual(['action:flip', 'action:skip']);
      expect(p2.prompt?.optional).toBe(false);
      executeAction(s, 0, 'effect-choice', { promptId: p2.id, choice: ['action:flip'] });
      expect(p4.faceUp).toBe(false); // 翻转此牌
      expect(s.pendingEffects).toHaveLength(0);
    });

    it('holder chooses skip → plague-4 stays face-up', () => {
      const s = draftPlagueP1();
      advanceToStep(s, 0, 'end');
      const pl = plagueLine(s);
      const p4 = makeCard('plague-4', 0, 'field', true, pl, 0);
      s.players[0].stacks[pl] = [p4];
      const target = makeCard('death-1', 1, 'field', false, 1, 0);
      s.players[1].stacks[1] = [target];
      const t = collectTriggers(s, 'end').find((x) => x.cardUid === p4.uid)!;
      resolveTrigger(s, t);
      runStack(s);
      const p = s.pendingEffects[s.pendingEffects.length - 1];
      executeAction(s, 1, 'effect-choice', { promptId: p.id, choice: [target.uid] });
      const p2 = s.pendingEffects[s.pendingEffects.length - 1];
      executeAction(s, 0, 'effect-choice', { promptId: p2.id, choice: ['action:skip'] });
      expect(p4.faceUp).toBe(true); // 未翻转
      expect(s.players[1].trash.map((c) => c.uid)).toEqual([target.uid]); // 删除仍执行
      expect(s.pendingEffects).toHaveLength(0);
    });

    it('opponent has no face-down top card → whole segment fizzles (no delete, no flip choice)', () => {
      const s = draftPlagueP1();
      advanceToStep(s, 0, 'end');
      const pl = plagueLine(s);
      const p4 = makeCard('plague-4', 0, 'field', true, pl, 0);
      s.players[0].stacks[pl] = [p4];
      s.players[1].stacks = [[], [], []];
      const t = collectTriggers(s, 'end').find((x) => x.cardUid === p4.uid)!;
      resolveTrigger(s, t);
      runStack(s);
      expect(s.pendingEffects).toHaveLength(0); // 无挂起（整段 fizzle）
      expect(p4.faceUp).toBe(true); // 未翻转
    });

    it('covered plague-4 is NOT collected at end (bottom command: uncovered only)', () => {
      const s = draftPlagueP1();
      advanceToStep(s, 0, 'end');
      const pl = plagueLine(s);
      const p4 = makeCard('plague-4', 0, 'field', true, pl, 0);
      const cover = makeCard('plague-5', 0, 'field', true, pl, 1);
      s.players[0].stacks[pl] = [p4, cover];
      const ts = collectTriggers(s, 'end');
      expect(ts.find((x) => x.cardUid === p4.uid)).toBeUndefined();
      expect(ts).toHaveLength(0);
    });
  });

  describe('plague-5 middle: discard 1', () => {
    it('discards 1 from hand', () => {
      const s = draftPlagueP1();
      advanceToStep(s, 0, 'action');
      s.players[0].hand = [makeCard('plague-5', 0, 'hand'), makeCard('plague-0', 0, 'hand')];
      const target = s.players[0].hand.find((c) => c.defId === 'plague-5')!;
      const other = s.players[0].hand.find((c) => c.defId !== 'plague-5')!;
      executeAction(s, 0, 'play', { cardUid: target.uid, faceUp: true, line: plagueLine(s) });
      resolveAllChoices(s, (p) => [other.uid]); // 弃 plague-0
      expect(s.players[0].trash.map((c) => c.uid)).toEqual([other.uid]);
      expect(s.players[0].hand).toHaveLength(0);
      expect(s.players[0].stacks[plagueLine(s)].map((c) => c.uid)).toEqual([target.uid]);
    });

    it('empty hand → fizzles without hanging', () => {
      const s = draftPlagueP1();
      advanceToStep(s, 0, 'action');
      s.players[0].hand = [makeCard('plague-5', 0, 'hand')];
      const card = s.players[0].hand[0];
      executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: true, line: plagueLine(s) });
      resolveAllChoices(s, pickFirst);
      expect(s.pendingEffects).toHaveLength(0);
      expect(s.players[0].trash).toHaveLength(0); // 无牌可弃
    });
  });
});
