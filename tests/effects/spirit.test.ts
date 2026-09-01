import { describe, it, expect } from 'vitest';
import type { EffectStep, GameState, Line, StepResult } from '../../src/core/models/types';
import { executeAction } from '../../src/core/game';
import { collectTriggers, resolveTrigger } from '../../src/core/effects/triggers';
import { runStack } from '../../src/core/effects/resolve';
import { makeCard, pickFirst, resolveAllChoices, draftSpiritP1, advanceToStep } from '../helpers';

function spiritLine(s: GameState): Line {
  const idx = s.players[0].protocols.findIndex((p) => p.defId === 'spirit');
  return idx as Line;
}

/** 推一个系统效果（无源卡，跳过 sourceValid）执行 draw op——触发 spirit-3「你抽牌后」连锁 */
function pushDrawGen(s: GameState, player: 0 | 1, count = 1): void {
  s.pendingEffects.push({
    id: `e-draw-${s.pendingEffects.length}`,
    player,
    gen: (function* (): Generator<EffectStep, void, StepResult> {
      yield { op: 'draw', count };
    })(),
    sourceUid: 'sys-draw',
    sourceDefId: 'system',
    system: true,
    prompt: null,
    lastAnswer: null,
  });
}

describe('spirit protocol effects', () => {
  describe('spirit-0 middle: refresh, draw 1', () => {
    it('refresh draws up to 5, then draws 1 (hand 3 → 6)', () => {
      const s = draftSpiritP1();
      advanceToStep(s, 0, 'action');
      const keep1 = makeCard('spirit-1', 0, 'hand');
      const keep2 = makeCard('spirit-2', 0, 'hand');
      s.players[0].hand = [makeCard('spirit-0', 0, 'hand'), keep1, keep2]; // 3 张
      const deckBefore = s.players[0].deck.length;
      const card = s.players[0].hand[0];
      executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: true, line: spiritLine(s) });
      resolveAllChoices(s, pickFirst); // 无选择请求（纯自动）
      // 打出 1 张后手牌剩 2 → 刷新抽至 5（+3），再抽 1 → 共 6 张
      expect(s.players[0].hand).toHaveLength(6);
      expect(s.players[0].deck).toHaveLength(deckBefore - 4);
      expect(s.pendingEffects).toHaveLength(0);
    });

    it('refresh consumes the control component when held (FAQ 161), opponent-held control stays', () => {
      const s = draftSpiritP1();
      advanceToStep(s, 0, 'action');
      s.players[0].hand = [makeCard('spirit-0', 0, 'hand')];
      s.control = 0; // P1 持有控制组件
      const card = s.players[0].hand[0];
      executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: true, line: spiritLine(s) });
      resolveAllChoices(s, pickFirst);
      expect(s.control).toBe(-1); // 刷新 → 控制回中立

      const s2 = draftSpiritP1();
      advanceToStep(s2, 0, 'action');
      s2.players[0].hand = [makeCard('spirit-0', 0, 'hand')];
      s2.control = 1; // 对手（P2）持有 → 不属于刷新者
      const card2 = s2.players[0].hand[0];
      executeAction(s2, 0, 'play', { cardUid: card2.uid, faceUp: true, line: spiritLine(s2) });
      resolveAllChoices(s2, pickFirst);
      expect(s2.control).toBe(1); // 不重置对手持有的控制
    });

    it('hand >= 5 after playing → refresh skipped, only the +1 draw happens', () => {
      const s = draftSpiritP1();
      advanceToStep(s, 0, 'action');
      const extras = [makeCard('spirit-1', 0, 'hand'), makeCard('spirit-2', 0, 'hand'), makeCard('spirit-3', 0, 'hand'), makeCard('spirit-4', 0, 'hand'), makeCard('spirit-5', 0, 'hand')];
      s.players[0].hand = [makeCard('spirit-0', 0, 'hand'), ...extras]; // 6 张
      const deckBefore = s.players[0].deck.length;
      const card = s.players[0].hand[0];
      executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: true, line: spiritLine(s) });
      resolveAllChoices(s, pickFirst);
      // 打出 1 张后手牌仍 5 张 → 刷新不抽（need = 0），只抽 1 → 共 6 张
      expect(s.players[0].hand).toHaveLength(6);
      expect(s.players[0].deck).toHaveLength(deckBefore - 1);
    });
  });

  describe('spirit-1 middle: draw 2', () => {
    it('draws 2 cards', () => {
      const s = draftSpiritP1();
      advanceToStep(s, 0, 'action');
      s.players[0].hand = [makeCard('spirit-1', 0, 'hand')];
      const deckBefore = s.players[0].deck.length;
      const card = s.players[0].hand[0];
      executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: true, line: spiritLine(s) });
      resolveAllChoices(s, pickFirst);
      expect(s.players[0].hand).toHaveLength(2); // 打出 1 → 抽 2
      expect(s.players[0].deck).toHaveLength(deckBefore - 2);
      expect(s.players[0].stacks[spiritLine(s)].map((c) => c.uid)).toEqual([card.uid]);
      expect(s.pendingEffects).toHaveLength(0);
    });
  });

  describe('spirit-1 bottom: start — discard 1 or flip this card', () => {
    it('discard choice discards 1 card from hand; the card stays', () => {
      const s = draftSpiritP1(); // 草案结束即 P1 的 start 步骤
      expect(s.step).toBe('start');
      const sl = spiritLine(s);
      const spirit1 = makeCard('spirit-1', 0, 'field', true, sl, 0);
      s.players[0].stacks[sl] = [spirit1];
      const victim = s.players[0].hand[0];
      const t = collectTriggers(s, 'start').find((x) => x.cardUid === spirit1.uid);
      expect(t).toBeDefined();
      expect(t?.top).toBeUndefined(); // 底命令：非顶命令触发（不注册 top 标志）
      resolveTrigger(s, t!);
      runStack(s);
      const p = s.pendingEffects[s.pendingEffects.length - 1];
      expect(p.prompt?.kind).toBe('select-action');
      expect(p.prompt?.actions).toEqual(['action:discard', 'action:flip']);
      expect(p.prompt?.optional).toBe(false); // 要么弃要么翻：非可选
      executeAction(s, 0, 'effect-choice', { promptId: p.id, choice: ['action:discard'] });
      const p2 = s.pendingEffects[s.pendingEffects.length - 1];
      expect(p2.prompt?.kind).toBe('select');
      expect(p2.prompt?.candidates.map((c) => c.uid).sort()).toEqual(s.players[0].hand.map((c) => c.uid).sort());
      executeAction(s, 0, 'effect-choice', { promptId: p2.id, choice: [victim.uid] });
      expect(s.players[0].trash.map((c) => c.uid)).toEqual([victim.uid]);
      expect(s.players[0].stacks[sl].map((c) => c.uid)).toEqual([spirit1.uid]); // 此牌不动
      expect(s.pendingEffects).toHaveLength(0);
    });

    it('flip choice flips this card face-down; it stays on the line', () => {
      const s = draftSpiritP1();
      const sl = spiritLine(s);
      const spirit1 = makeCard('spirit-1', 0, 'field', true, sl, 0);
      s.players[0].stacks[sl] = [spirit1];
      const t = collectTriggers(s, 'start').find((x) => x.cardUid === spirit1.uid)!;
      resolveTrigger(s, t);
      runStack(s);
      const p = s.pendingEffects[s.pendingEffects.length - 1];
      executeAction(s, 0, 'effect-choice', { promptId: p.id, choice: ['action:flip'] });
      expect(spirit1.faceUp).toBe(false); // 翻转此牌
      expect(s.players[0].stacks[sl].map((c) => c.uid)).toEqual([spirit1.uid]);
      expect(s.pendingEffects).toHaveLength(0);
    });

    it('covered spirit-1 is NOT collected at start (bottom command: uncovered only)', () => {
      const s = draftSpiritP1();
      const sl = spiritLine(s);
      const spirit1 = makeCard('spirit-1', 0, 'field', true, sl, 0);
      const cover = makeCard('spirit-2', 0, 'field', true, sl, 1); // 无 start 触发的盖卡
      s.players[0].stacks[sl] = [spirit1, cover];
      const ts = collectTriggers(s, 'start');
      expect(ts.find((x) => x.cardUid === spirit1.uid)).toBeUndefined(); // 被盖 → 底命令不收集
      expect(ts).toHaveLength(0);
    });

    it('discard choice with empty hand fizzles (no discard, card stays)', () => {
      const s = draftSpiritP1();
      const sl = spiritLine(s);
      const spirit1 = makeCard('spirit-1', 0, 'field', true, sl, 0);
      s.players[0].stacks[sl] = [spirit1];
      s.players[0].hand = [];
      const t = collectTriggers(s, 'start').find((x) => x.cardUid === spirit1.uid)!;
      resolveTrigger(s, t);
      runStack(s);
      const p = s.pendingEffects[s.pendingEffects.length - 1];
      executeAction(s, 0, 'effect-choice', { promptId: p.id, choice: ['action:discard'] });
      expect(s.pendingEffects).toHaveLength(0); // 无牌可弃 → 弃牌步骤 fizzle
      expect(s.players[0].trash).toHaveLength(0);
      expect(s.players[0].stacks[sl].map((c) => c.uid)).toEqual([spirit1.uid]);
    });
  });

  describe('spirit-2 middle: you may flip 1 card', () => {
    it('optional: flip a field top card of either player', () => {
      const s = draftSpiritP1();
      advanceToStep(s, 0, 'action');
      const target = makeCard('spirit-1', 1, 'field', true, 1, 0); // 对手正面顶卡
      s.players[1].stacks[1] = [target];
      s.players[0].hand = [makeCard('spirit-2', 0, 'hand')];
      const card = s.players[0].hand[0];
      executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: true, line: spiritLine(s) });
      const p = s.pendingEffects[s.pendingEffects.length - 1];
      expect(p.prompt?.kind).toBe('select');
      expect(p.prompt?.optional).toBe(true);
      expect(p.prompt?.candidates.map((c) => c.uid)).toEqual([target.uid]);
      executeAction(s, 0, 'effect-choice', { promptId: p.id, choice: [target.uid] });
      expect(target.faceUp).toBe(false);
      expect(s.pendingEffects).toHaveLength(0);
    });

    it('optional: skipping flips nothing', () => {
      const s = draftSpiritP1();
      advanceToStep(s, 0, 'action');
      const target = makeCard('spirit-1', 1, 'field', true, 1, 0);
      s.players[1].stacks[1] = [target];
      s.players[0].hand = [makeCard('spirit-2', 0, 'hand')];
      const card = s.players[0].hand[0];
      executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: true, line: spiritLine(s) });
      resolveAllChoices(s, pickFirst); // 可选 → 空应答跳过
      expect(target.faceUp).toBe(true);
      expect(s.pendingEffects).toHaveLength(0);
    });
  });

  describe('spirit-3 top: after you draw — you may shift this card (even if covered)', () => {
    it('fires after a draw and optionally shifts the card to another line', () => {
      const s = draftSpiritP1();
      advanceToStep(s, 0, 'action');
      const sl = spiritLine(s);
      const sp3 = makeCard('spirit-3', 0, 'field', true, sl, 0);
      s.players[0].stacks[sl] = [sp3];
      s.players[0].hand = [];
      pushDrawGen(s, 0, 1);
      runStack(s);
      expect(s.players[0].hand).toHaveLength(1); // 抽牌完成
      const p = s.pendingEffects[s.pendingEffects.length - 1];
      expect(p.sourceDefId).toBe('spirit-3'); // after-draw 触发入栈
      expect(p.prompt?.kind).toBe('select-line');
      expect(p.prompt?.optional).toBe(true);
      const target = ([0, 1, 2] as Line[]).find((l) => l !== sl)!;
      expect(p.prompt?.lines).toEqual(([0, 1, 2] as Line[]).filter((l) => l !== sl));
      executeAction(s, 0, 'effect-choice', { promptId: p.id, choice: [`line:${target}`] });
      expect(sp3.line).toBe(target); // 平移成功
      expect(s.players[0].stacks[sl]).toHaveLength(0);
      expect(s.players[0].stacks[target].map((c) => c.uid)).toEqual([sp3.uid]);
      expect(s.pendingEffects).toHaveLength(0);
    });

    it('optional: skipping keeps the card in place', () => {
      const s = draftSpiritP1();
      advanceToStep(s, 0, 'action');
      const sl = spiritLine(s);
      const sp3 = makeCard('spirit-3', 0, 'field', true, sl, 0);
      s.players[0].stacks[sl] = [sp3];
      pushDrawGen(s, 0, 1);
      runStack(s);
      const p = s.pendingEffects[s.pendingEffects.length - 1];
      executeAction(s, 0, 'effect-choice', { promptId: p.id, choice: [] }); // 跳过
      expect(sp3.line).toBe(sl);
      expect(s.players[0].stacks[sl].map((c) => c.uid)).toEqual([sp3.uid]);
      expect(s.pendingEffects).toHaveLength(0);
    });

    it('fires even when covered (top command) and shifts the covered card', () => {
      const s = draftSpiritP1();
      advanceToStep(s, 0, 'action');
      const sl = spiritLine(s);
      const sp3 = makeCard('spirit-3', 0, 'field', true, sl, 0);
      const cover = makeCard('spirit-2', 0, 'field', true, sl, 1);
      s.players[0].stacks[sl] = [sp3, cover];
      pushDrawGen(s, 0, 1);
      runStack(s);
      const p = s.pendingEffects[s.pendingEffects.length - 1];
      expect(p.sourceDefId).toBe('spirit-3'); // 被盖仍触发
      const target = ([0, 1, 2] as Line[]).find((l) => l !== sl)!;
      executeAction(s, 0, 'effect-choice', { promptId: p.id, choice: [`line:${target}`] });
      expect(sp3.line).toBe(target); // 被盖卡也能平移（allowCovered）
      expect(s.players[0].stacks[sl].map((c) => c.uid)).toEqual([cover.uid]); // 盖卡留在原线
      expect(s.players[0].stacks[target].map((c) => c.uid)).toEqual([sp3.uid]);
      expect(s.pendingEffects).toHaveLength(0);
    });

    it('fires on the refresh draw path too', () => {
      const s = draftSpiritP1();
      advanceToStep(s, 0, 'action');
      const sl = spiritLine(s);
      const sp3 = makeCard('spirit-3', 0, 'field', true, sl, 0);
      s.players[0].stacks[sl] = [sp3];
      s.players[0].hand = [makeCard('spirit-1', 0, 'hand')]; // 1 张 → refresh 抽 4
      executeAction(s, 0, 'refresh'); // refreshHand → drawCards → after-draw 触发
      const p = s.pendingEffects[s.pendingEffects.length - 1];
      expect(p.sourceDefId).toBe('spirit-3');
      expect(p.prompt?.kind).toBe('select-line');
      const target = ([0, 1, 2] as Line[]).find((l) => l !== sl)!;
      executeAction(s, 0, 'effect-choice', { promptId: p.id, choice: [`line:${target}`] });
      expect(sp3.line).toBe(target);
      expect(s.players[0].hand).toHaveLength(5);
      expect(s.pendingEffects).toHaveLength(0);
    });
  });

  describe('spirit-4 middle: swap 2 of your protocol positions', () => {
    it('swaps positions a and b (player defaults to the effect owner)', () => {
      const s = draftSpiritP1();
      advanceToStep(s, 0, 'action');
      s.players[0].hand = [makeCard('spirit-4', 0, 'hand')];
      s.players[0].protocols[0].compiled = true;
      const before = s.players[0].protocols.map((p) => ({ defId: p.defId, compiled: p.compiled }));
      const card = s.players[0].hand[0];
      executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: true, line: spiritLine(s) });
      const p1 = s.pendingEffects[s.pendingEffects.length - 1];
      expect(p1.prompt?.kind).toBe('select-line');
      expect(p1.prompt?.lines).toEqual([0, 1, 2]); // 第 1 个位置 3 选 1
      executeAction(s, 0, 'effect-choice', { promptId: p1.id, choice: ['line:0'] });
      const p2 = s.pendingEffects[s.pendingEffects.length - 1];
      expect(p2.prompt?.kind).toBe('select-line');
      expect(p2.prompt?.lines).toEqual([1, 2]); // 第 2 个位置 ≠ 第 1 个
      executeAction(s, 0, 'effect-choice', { promptId: p2.id, choice: ['line:2'] });
      expect(s.players[0].protocols[0].defId).toBe(before[2].defId);
      expect(s.players[0].protocols[2].defId).toBe(before[0].defId);
      expect(s.players[0].protocols[0].compiled).toBe(before[2].compiled);
      expect(s.players[0].protocols[2].compiled).toBe(before[0].compiled);
      expect(s.players[0].protocols[1].defId).toBe(before[1].defId);
      expect(s.pendingEffects).toHaveLength(0);
    });
  });

  describe('spirit-5 middle: discard 1', () => {
    it('discards 1 from hand', () => {
      const s = draftSpiritP1();
      advanceToStep(s, 0, 'action');
      s.players[0].hand = [makeCard('spirit-5', 0, 'hand'), makeCard('spirit-1', 0, 'hand')];
      const target = s.players[0].hand.find((c) => c.defId === 'spirit-5')!;
      const other = s.players[0].hand.find((c) => c.defId !== 'spirit-5')!;
      executeAction(s, 0, 'play', { cardUid: target.uid, faceUp: true, line: spiritLine(s) });
      resolveAllChoices(s, (p) => [other.uid]); // 弃 spirit-1
      expect(s.players[0].trash.map((c) => c.uid)).toEqual([other.uid]);
      expect(s.players[0].hand).toHaveLength(0);
      expect(s.players[0].stacks[spiritLine(s)].map((c) => c.uid)).toEqual([target.uid]);
    });

    it('empty hand → fizzles without hanging', () => {
      const s = draftSpiritP1();
      advanceToStep(s, 0, 'action');
      s.players[0].hand = [makeCard('spirit-5', 0, 'hand')];
      const card = s.players[0].hand[0];
      executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: true, line: spiritLine(s) });
      resolveAllChoices(s, pickFirst);
      expect(s.pendingEffects).toHaveLength(0);
      expect(s.players[0].trash).toHaveLength(0); // 无牌可弃
    });
  });
});
