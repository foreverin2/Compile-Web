import { describe, it, expect } from 'vitest';
import type { GameState, Line } from '../../src/core/models/types';
import { executeAction } from '../../src/core/game';
import { collectTriggers, resolveTrigger } from '../../src/core/effects/triggers';
import { runStack } from '../../src/core/effects/resolve';
import { makeCard, pickFirst, resolveAllChoices, draftSpeedP1, advanceToStep } from '../helpers';

function speedLine(s: GameState): Line {
  const idx = s.players[0].protocols.findIndex((p) => p.defId === 'speed');
  return idx as Line;
}

describe('speed protocol effects', () => {
  describe('speed-0 middle: 打出1张牌', () => {
    it('face-up: selects a hand card, chooses face-up, then only protocol-matching lines are offered', () => {
      const s = draftSpeedP1();
      advanceToStep(s, 0, 'action');
      const sl = speedLine(s);
      // 固定协议：P1 线 2 = metal；P2 无线匹配 metal → metal-2 只能正面打线 2
      s.players[0].protocols = [
        { defId: 'speed', compiled: false },
        { defId: 'fire', compiled: false },
        { defId: 'metal', compiled: false },
      ];
      s.players[1].protocols = [
        { defId: 'water', compiled: false },
        { defId: 'death', compiled: false },
        { defId: 'light', compiled: false },
      ];
      s.players[0].hand = [makeCard('speed-0', 0, 'hand'), makeCard('metal-2', 0, 'hand')];
      const speed0 = s.players[0].hand.find((c) => c.defId === 'speed-0')!;
      const toPlay = s.players[0].hand.find((c) => c.defId === 'metal-2')!;
      executeAction(s, 0, 'play', { cardUid: speed0.uid, faceUp: true, line: sl });
      // 选要打出的手牌
      const p = s.pendingEffects[s.pendingEffects.length - 1];
      expect(p.prompt?.kind).toBe('select');
      expect(p.prompt?.min).toBe(1);
      expect(p.prompt?.max).toBe(1);
      expect(p.prompt?.candidates.map((c) => c.uid)).toEqual([toPlay.uid]);
      executeAction(s, 0, 'effect-choice', { promptId: p.id, choice: [toPlay.uid] });
      // 选正/反面
      const p2 = s.pendingEffects[s.pendingEffects.length - 1];
      expect(p2.prompt?.kind).toBe('select-action');
      expect(p2.prompt?.actions).toEqual(['action:face-up', 'action:face-down']);
      executeAction(s, 0, 'effect-choice', { promptId: p2.id, choice: ['action:face-up'] });
      // 正面：仅匹配协议线（metal → 线 2）
      const p3 = s.pendingEffects[s.pendingEffects.length - 1];
      expect(p3.prompt?.kind).toBe('select-line');
      expect(p3.prompt?.lines).toEqual([2]);
      executeAction(s, 0, 'effect-choice', { promptId: p3.id, choice: ['line:2'] });
      expect(toPlay.zone).toBe('field');
      expect(toPlay.faceUp).toBe(true);
      expect(toPlay.line).toBe(2);
      expect(s.players[0].stacks[2].map((c) => c.uid)).toEqual([toPlay.uid]);
      expect(s.players[0].stacks[sl].map((c) => c.uid)).toEqual([speed0.uid]);
      expect(s.pendingEffects).toHaveLength(0);
    });

    it('face-down: any line is offered, card lands face-down', () => {
      const s = draftSpeedP1();
      advanceToStep(s, 0, 'action');
      const sl = speedLine(s);
      s.players[0].hand = [makeCard('speed-0', 0, 'hand'), makeCard('metal-2', 0, 'hand')];
      const speed0 = s.players[0].hand.find((c) => c.defId === 'speed-0')!;
      const toPlay = s.players[0].hand.find((c) => c.defId === 'metal-2')!;
      executeAction(s, 0, 'play', { cardUid: speed0.uid, faceUp: true, line: sl });
      const p = s.pendingEffects[s.pendingEffects.length - 1];
      executeAction(s, 0, 'effect-choice', { promptId: p.id, choice: [toPlay.uid] });
      const p2 = s.pendingEffects[s.pendingEffects.length - 1];
      executeAction(s, 0, 'effect-choice', { promptId: p2.id, choice: ['action:face-down'] });
      const p3 = s.pendingEffects[s.pendingEffects.length - 1];
      expect(p3.prompt?.kind).toBe('select-line');
      expect(p3.prompt?.lines).toEqual([0, 1, 2]); // 反面任意线
      executeAction(s, 0, 'effect-choice', { promptId: p3.id, choice: ['line:1'] });
      expect(toPlay.zone).toBe('field');
      expect(toPlay.faceUp).toBe(false);
      expect(toPlay.line).toBe(1);
      expect(s.pendingEffects).toHaveLength(0);
    });

    it('empty hand → fizzles without hanging', () => {
      const s = draftSpeedP1();
      advanceToStep(s, 0, 'action');
      const sl = speedLine(s);
      s.players[0].hand = [makeCard('speed-0', 0, 'hand')];
      const speed0 = s.players[0].hand[0];
      executeAction(s, 0, 'play', { cardUid: speed0.uid, faceUp: true, line: sl });
      resolveAllChoices(s, pickFirst); // 手牌空 → select 无候选自动跳过
      expect(s.pendingEffects).toHaveLength(0);
      expect(s.players[0].stacks[sl].map((c) => c.uid)).toEqual([speed0.uid]); // 只打出 speed-0 自己
      expect(s.players[0].stacks[1]).toHaveLength(0);
      expect(s.players[0].stacks[2]).toHaveLength(0);
    });

    it('face-up with no matching protocol line → fizzles (card stays in hand)', () => {
      const s = draftSpeedP1();
      advanceToStep(s, 0, 'action');
      const sl = speedLine(s);
      // 双方协议都无 metal → metal-2 正面无线可打
      s.players[0].protocols = [
        { defId: 'speed', compiled: false },
        { defId: 'fire', compiled: false },
        { defId: 'water', compiled: false },
      ];
      s.players[1].protocols = [
        { defId: 'death', compiled: false },
        { defId: 'spirit', compiled: false },
        { defId: 'light', compiled: false },
      ];
      s.players[0].hand = [makeCard('speed-0', 0, 'hand'), makeCard('metal-2', 0, 'hand')];
      const speed0 = s.players[0].hand.find((c) => c.defId === 'speed-0')!;
      const toPlay = s.players[0].hand.find((c) => c.defId === 'metal-2')!;
      executeAction(s, 0, 'play', { cardUid: speed0.uid, faceUp: true, line: sl });
      const p = s.pendingEffects[s.pendingEffects.length - 1];
      executeAction(s, 0, 'effect-choice', { promptId: p.id, choice: [toPlay.uid] });
      const p2 = s.pendingEffects[s.pendingEffects.length - 1];
      executeAction(s, 0, 'effect-choice', { promptId: p2.id, choice: ['action:face-up'] });
      resolveAllChoices(s, pickFirst); // select-line 无线 → 自动跳过
      expect(s.pendingEffects).toHaveLength(0);
      expect(toPlay.zone).toBe('hand'); // 未打出
      expect(s.players[0].hand.some((c) => c.uid === toPlay.uid)).toBe(true);
    });

    it('effect-granted play bypasses A2 restrictions (psychic-1 face-up ban + plague-0 line block)', () => {
      const s = draftSpeedP1();
      advanceToStep(s, 0, 'action');
      const sl = speedLine(s);
      s.players[0].protocols = [
        { defId: 'speed', compiled: false },
        { defId: 'metal', compiled: false },
        { defId: 'fire', compiled: false },
      ];
      s.players[1].protocols = [
        { defId: 'water', compiled: false },
        { defId: 'death', compiled: false },
        { defId: 'light', compiled: false },
      ];
      s.players[0].hand = [makeCard('speed-0', 0, 'hand'), makeCard('metal-2', 0, 'hand')];
      const speed0 = s.players[0].hand.find((c) => c.defId === 'speed-0')!;
      const toPlay = s.players[0].hand.find((c) => c.defId === 'metal-2')!;
      // 先正面打出 speed-0（挂起选牌），再放置限制卡——模拟限制已在场（speed-0 效果打出不受限）
      executeAction(s, 0, 'play', { cardUid: speed0.uid, faceUp: true, line: sl });
      s.players[1].stacks[0] = [makeCard('psychic-1', 1, 'field', true, 0, 0)]; // 全局禁对手正面打
      s.players[1].stacks[1] = [makeCard('plague-0', 1, 'field', true, 1, 0)]; // 禁 P1 打线 1（正反）
      const p = s.pendingEffects[s.pendingEffects.length - 1];
      executeAction(s, 0, 'effect-choice', { promptId: p.id, choice: [toPlay.uid] });
      const p2 = s.pendingEffects[s.pendingEffects.length - 1];
      executeAction(s, 0, 'effect-choice', { promptId: p2.id, choice: ['action:face-up'] });
      const p3 = s.pendingEffects[s.pendingEffects.length - 1];
      expect(p3.prompt?.lines).toEqual([1]); // 线 1（P1 metal）——plague-0 禁线仍可选
      executeAction(s, 0, 'effect-choice', { promptId: p3.id, choice: ['line:1'] });
      expect(toPlay.zone).toBe('field'); // psychic-1 + plague-0 均不拦效果打出
      expect(toPlay.faceUp).toBe(true);
      expect(toPlay.line).toBe(1);
      expect(s.pendingEffects).toHaveLength(0);
    });

    it('effect-granted face-down play bypasses metal-2 line block', () => {
      const s = draftSpeedP1();
      advanceToStep(s, 0, 'action');
      const sl = speedLine(s);
      s.players[1].stacks[1] = [makeCard('metal-2', 1, 'field', true, 1, 0)]; // P2 线 1 禁对手反面打
      s.players[0].hand = [makeCard('speed-0', 0, 'hand'), makeCard('metal-2', 0, 'hand')];
      const speed0 = s.players[0].hand.find((c) => c.defId === 'speed-0')!;
      const toPlay = s.players[0].hand.find((c) => c.defId === 'metal-2')!;
      executeAction(s, 0, 'play', { cardUid: speed0.uid, faceUp: true, line: sl });
      const p = s.pendingEffects[s.pendingEffects.length - 1];
      executeAction(s, 0, 'effect-choice', { promptId: p.id, choice: [toPlay.uid] });
      const p2 = s.pendingEffects[s.pendingEffects.length - 1];
      executeAction(s, 0, 'effect-choice', { promptId: p2.id, choice: ['action:face-down'] });
      const p3 = s.pendingEffects[s.pendingEffects.length - 1];
      expect(p3.prompt?.lines).toEqual([0, 1, 2]); // 反面任意线（含 metal-2 禁线）
      executeAction(s, 0, 'effect-choice', { promptId: p3.id, choice: ['line:1'] });
      expect(toPlay.zone).toBe('field');
      expect(toPlay.faceUp).toBe(false);
      expect(toPlay.line).toBe(1);
      expect(s.pendingEffects).toHaveLength(0);
    });
  });

  describe('speed-1 top: 清理缓存后：抽1张牌。 middle: 抽2张牌。', () => {
    it('top: after-clear-cache (player-chosen discard) draws 1', () => {
      const s = draftSpeedP1();
      advanceToStep(s, 0, 'check-cache');
      const sl = speedLine(s);
      const sp1 = makeCard('speed-1', 0, 'field', true, sl, 0);
      s.players[0].stacks[sl] = [sp1];
      s.players[0].hand = Array.from({ length: 6 }, () => makeCard('death-0', 0, 'hand'));
      const deckBefore = s.players[0].deck.length;
      executeAction(s, 0, 'clear-cache');
      const top = s.pendingEffects[s.pendingEffects.length - 1];
      expect(top.prompt?.kind).toBe('select');
      executeAction(s, 0, 'effect-choice', { promptId: top.id, choice: [top.prompt!.candidates[0].uid] });
      expect(s.players[0].hand).toHaveLength(6); // 弃 1 → 5，speed-1 抽 1 → 6
      expect(s.players[0].deck).toHaveLength(deckBefore - 1);
      expect(s.pendingEffects).toHaveLength(0);
    });

    it('top: fires even when covered (top command)', () => {
      const s = draftSpeedP1();
      advanceToStep(s, 0, 'check-cache');
      const sl = speedLine(s);
      const sp1 = makeCard('speed-1', 0, 'field', true, sl, 0);
      const cover = makeCard('death-1', 0, 'field', true, sl, 1); // 盖住 speed-1
      s.players[0].stacks[sl] = [sp1, cover];
      s.players[0].hand = Array.from({ length: 6 }, () => makeCard('death-0', 0, 'hand'));
      executeAction(s, 0, 'clear-cache');
      const top = s.pendingEffects[s.pendingEffects.length - 1];
      executeAction(s, 0, 'effect-choice', { promptId: top.id, choice: [top.prompt!.candidates[0].uid] });
      expect(s.players[0].hand).toHaveLength(6); // 被盖 speed-1 仍抽 1
      expect(sp1.zone).toBe('field');
      expect(s.pendingEffects).toHaveLength(0);
    });

    it('middle: draws 2', () => {
      const s = draftSpeedP1();
      advanceToStep(s, 0, 'action');
      const sl = speedLine(s);
      s.players[0].hand = [makeCard('speed-1', 0, 'hand')];
      const deckBefore = s.players[0].deck.length;
      const card = s.players[0].hand[0];
      executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: true, line: sl });
      resolveAllChoices(s, pickFirst);
      expect(s.players[0].hand).toHaveLength(2); // 打出 1 → 抽 2
      expect(s.players[0].deck).toHaveLength(deckBefore - 2);
      expect(s.players[0].stacks[sl].map((c) => c.uid)).toEqual([card.uid]);
      expect(s.pendingEffects).toHaveLength(0);
    });
  });

  describe('speed-2 top: 通过编译删除此牌前：平移此牌，不论是否被盖住。', () => {
    it('before-compile: uncovered speed-2 shifts to the chosen line, then compile deletes the line', () => {
      const s = draftSpeedP1();
      advanceToStep(s, 0, 'check-compile');
      const sl = speedLine(s);
      for (let i = 0; i < 10; i++) s.players[0].stacks[sl].push(makeCard('death-1', 0, 'field', true, sl, i));
      const sp2 = makeCard('speed-2', 0, 'field', true, sl, 10);
      s.players[0].stacks[sl].push(sp2);
      s.players[1].stacks[sl].push(makeCard('death-0', 1, 'field', true, sl, 0)); // 0 分
      executeAction(s, 0, 'compile', { line: sl });
      const top = s.pendingEffects[s.pendingEffects.length - 1];
      expect(top.prompt?.kind).toBe('select-line');
      expect(top.prompt?.lines).toEqual(([0, 1, 2] as Line[]).filter((l) => l !== sl)); // 排除当前线
      const dest = ([0, 1, 2] as Line[]).find((l) => l !== sl)!;
      executeAction(s, 0, 'effect-choice', { promptId: top.id, choice: [`line:${dest}`] });
      expect(s.players[0].protocols[sl].compiled).toBe(true); // 平移后编译本体执行
      expect(s.players[0].stacks[sl]).toHaveLength(0);
      expect(s.players[1].stacks[sl]).toHaveLength(0);
      const shifted = s.players[0].stacks[dest].find((c) => c.defId === 'speed-2');
      expect(shifted).toBeDefined();
      expect(shifted!.zone).toBe('field');
      expect(sp2.line).toBe(dest);
      expect(s.pendingEffects).toHaveLength(0);
    });

    it('both players face-up speed-2 on the compile line shift (owner decides)', () => {
      const s = draftSpeedP1();
      advanceToStep(s, 0, 'check-compile');
      const sl = speedLine(s);
      for (let i = 0; i < 10; i++) s.players[0].stacks[sl].push(makeCard('death-1', 0, 'field', true, sl, i));
      const p1sp2 = makeCard('speed-2', 0, 'field', true, sl, 10);
      s.players[0].stacks[sl].push(p1sp2);
      const p2sp2 = makeCard('speed-2', 1, 'field', true, sl, 0);
      s.players[1].stacks[sl] = [p2sp2];
      executeAction(s, 0, 'compile', { line: sl });
      expect(s.pendingEffects).toHaveLength(2); // 双方 speed-2 都触发
      // LIFO：P2 的 speed-2 在栈顶（resolveTrigger 按 P1、P2 顺序 push）
      const top = s.pendingEffects[s.pendingEffects.length - 1];
      expect(top.sourceDefId).toBe('speed-2');
      executeAction(s, 1, 'effect-choice', { promptId: top.id, choice: ['line:2'] }); // P2 持有者选线
      const top2 = s.pendingEffects[s.pendingEffects.length - 1];
      executeAction(s, 0, 'effect-choice', { promptId: top2.id, choice: ['line:1'] }); // P1 持有者选线
      expect(s.players[0].protocols[sl].compiled).toBe(true);
      expect(s.players[0].stacks[sl]).toHaveLength(0);
      expect(s.players[1].stacks[sl]).toHaveLength(0);
      expect(p1sp2.line).toBe(1);
      expect(p1sp2.zone).toBe('field');
      expect(p2sp2.line).toBe(2);
      expect(p2sp2.zone).toBe('field');
      expect(s.pendingEffects).toHaveLength(0);
    });

    it('face-down speed-2 grants nothing: compile deletes it directly', () => {
      const s = draftSpeedP1();
      advanceToStep(s, 0, 'check-compile');
      const sl = speedLine(s);
      for (let i = 0; i < 10; i++) s.players[0].stacks[sl].push(makeCard('death-1', 0, 'field', true, sl, i));
      const sp2 = makeCard('speed-2', 0, 'field', false, sl, 10); // 反面
      s.players[0].stacks[sl].push(sp2);
      s.players[1].stacks[sl].push(makeCard('death-0', 1, 'field', true, sl, 0));
      executeAction(s, 0, 'compile', { line: sl });
      expect(s.players[0].protocols[sl].compiled).toBe(true);
      expect(s.players[0].stacks[sl]).toHaveLength(0);
      expect(sp2.zone).toBe('trash'); // 直接随编译删除
      expect(s.pendingEffects).toHaveLength(0);
    });
  });

  describe('speed-3 middle: 平移另1张你的牌。 bottom: 结束：你可以平移1张你的牌。若如此，翻转此牌。', () => {
    it('middle: shifts another own top card (self excluded), line excludes its current line', () => {
      const s = draftSpeedP1();
      advanceToStep(s, 0, 'action');
      const sl = speedLine(s);
      const other = makeCard('metal-1', 0, 'field', true, 1, 0);
      s.players[0].stacks[1] = [other];
      s.players[0].hand = [makeCard('speed-3', 0, 'hand')];
      const card = s.players[0].hand[0];
      executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: true, line: sl });
      const p = s.pendingEffects[s.pendingEffects.length - 1];
      expect(p.prompt?.kind).toBe('select');
      expect(p.prompt?.candidates.map((c) => c.uid)).toEqual([other.uid]); // 源卡被排除
      executeAction(s, 0, 'effect-choice', { promptId: p.id, choice: [other.uid] });
      const p2 = s.pendingEffects[s.pendingEffects.length - 1];
      expect(p2.prompt?.kind).toBe('select-line');
      expect(p2.prompt?.lines).toEqual(([0, 1, 2] as Line[]).filter((l) => l !== 1)); // 排除被移卡当前线
      const dest = ([0, 1, 2] as Line[]).find((l) => l !== 1 && l !== sl)!; // 避开源卡所在列（否则会盖住源卡）
      executeAction(s, 0, 'effect-choice', { promptId: p2.id, choice: [`line:${dest}`] });
      expect(other.line).toBe(dest);
      expect(other.zone).toBe('field');
      expect(s.players[0].stacks[1]).toHaveLength(0);
      expect(s.players[0].stacks[dest].map((c) => c.uid)).toEqual([other.uid]);
      expect(s.players[0].stacks[sl].map((c) => c.uid)).toEqual([card.uid]); // 源卡不动
      expect(s.pendingEffects).toHaveLength(0);
    });

    it('middle: no other own top card → fizzles without hanging', () => {
      const s = draftSpeedP1();
      advanceToStep(s, 0, 'action');
      const sl = speedLine(s);
      s.players[0].hand = [makeCard('speed-3', 0, 'hand')];
      const card = s.players[0].hand[0];
      executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: true, line: sl });
      resolveAllChoices(s, pickFirst); // 无其他自己的顶卡 → select 自动跳过
      expect(s.pendingEffects).toHaveLength(0);
      expect(s.players[0].stacks[sl].map((c) => c.uid)).toEqual([card.uid]);
    });

    it('bottom: end trigger — optional shift of an own top card (self included), then flips itself', () => {
      const s = draftSpeedP1();
      advanceToStep(s, 0, 'end');
      const sl = speedLine(s);
      const sp3 = makeCard('speed-3', 0, 'field', true, sl, 0);
      const other = makeCard('metal-1', 0, 'field', true, 1, 0);
      s.players[0].stacks[sl] = [sp3];
      s.players[0].stacks[1] = [other];
      const t = collectTriggers(s, 'end').find((x) => x.cardUid === sp3.uid);
      expect(t).toBeDefined();
      expect(t?.top).toBeUndefined(); // 底命令：非顶命令触发（不注册 top 标志）
      resolveTrigger(s, t!);
      runStack(s);
      const p = s.pendingEffects[s.pendingEffects.length - 1];
      expect(p.prompt?.kind).toBe('select');
      expect(p.prompt?.optional).toBe(true); // 你可以：可选
      expect(p.prompt?.candidates.map((c) => c.uid).sort()).toEqual([sp3.uid, other.uid].sort()); // 含自己
      executeAction(s, 0, 'effect-choice', { promptId: p.id, choice: [other.uid] });
      const p2 = s.pendingEffects[s.pendingEffects.length - 1];
      const dest = ([0, 1, 2] as Line[]).find((l) => l !== 1 && l !== sl)!; // 避免盖住自己
      executeAction(s, 0, 'effect-choice', { promptId: p2.id, choice: [`line:${dest}`] });
      expect(other.line).toBe(dest);
      expect(sp3.faceUp).toBe(false); // 若如此，翻转此牌
      expect(sp3.zone).toBe('field');
      expect(s.pendingEffects).toHaveLength(0);
    });

    it('bottom: selecting the card itself shifts and flips it', () => {
      const s = draftSpeedP1();
      advanceToStep(s, 0, 'end');
      const sl = speedLine(s);
      const sp3 = makeCard('speed-3', 0, 'field', true, sl, 0);
      s.players[0].stacks[sl] = [sp3];
      const t = collectTriggers(s, 'end').find((x) => x.cardUid === sp3.uid)!;
      resolveTrigger(s, t);
      runStack(s);
      const p = s.pendingEffects[s.pendingEffects.length - 1];
      executeAction(s, 0, 'effect-choice', { promptId: p.id, choice: [sp3.uid] }); // 选自己
      const p2 = s.pendingEffects[s.pendingEffects.length - 1];
      const dest = ([0, 1, 2] as Line[]).find((l) => l !== sl)!;
      executeAction(s, 0, 'effect-choice', { promptId: p2.id, choice: [`line:${dest}`] });
      expect(sp3.line).toBe(dest);
      expect(sp3.faceUp).toBe(false); // 翻自己
      expect(s.players[0].stacks[sl]).toHaveLength(0);
      expect(s.pendingEffects).toHaveLength(0);
    });

    it('bottom: skipping shifts nothing and does NOT flip', () => {
      const s = draftSpeedP1();
      advanceToStep(s, 0, 'end');
      const sl = speedLine(s);
      const sp3 = makeCard('speed-3', 0, 'field', true, sl, 0);
      const other = makeCard('metal-1', 0, 'field', true, 1, 0);
      s.players[0].stacks[sl] = [sp3];
      s.players[0].stacks[1] = [other];
      const t = collectTriggers(s, 'end').find((x) => x.cardUid === sp3.uid)!;
      resolveTrigger(s, t);
      runStack(s);
      const p = s.pendingEffects[s.pendingEffects.length - 1];
      executeAction(s, 0, 'effect-choice', { promptId: p.id, choice: [] }); // 跳过
      expect(other.line).toBe(1); // 未平移
      expect(sp3.faceUp).toBe(true); // 未翻转
      expect(s.pendingEffects).toHaveLength(0);
    });

    it('bottom: covered speed-3 is NOT collected at end (bottom command: uncovered only)', () => {
      const s = draftSpeedP1();
      advanceToStep(s, 0, 'end');
      const sl = speedLine(s);
      const sp3 = makeCard('speed-3', 0, 'field', true, sl, 0);
      const cover = makeCard('death-1', 0, 'field', true, sl, 1); // 无 end 触发的盖卡
      s.players[0].stacks[sl] = [sp3, cover];
      const ts = collectTriggers(s, 'end');
      expect(ts.find((x) => x.cardUid === sp3.uid)).toBeUndefined();
      expect(ts).toHaveLength(0);
    });

    it('bottom: shifting another card onto the speed-3 line covers it → flip skipped (no throw)', () => {
      const s = draftSpeedP1();
      advanceToStep(s, 0, 'end');
      const sl = speedLine(s);
      const sp3 = makeCard('speed-3', 0, 'field', true, sl, 0);
      const other = makeCard('metal-1', 0, 'field', true, 2, 0);
      s.players[0].stacks[sl] = [sp3];
      s.players[0].stacks[2] = [other];
      const t = collectTriggers(s, 'end').find((x) => x.cardUid === sp3.uid)!;
      resolveTrigger(s, t);
      runStack(s);
      const p = s.pendingEffects[s.pendingEffects.length - 1];
      executeAction(s, 0, 'effect-choice', { promptId: p.id, choice: [other.uid] });
      const p2 = s.pendingEffects[s.pendingEffects.length - 1];
      executeAction(s, 0, 'effect-choice', { promptId: p2.id, choice: [`line:${sl}`] }); // 平移盖住自己
      expect(other.line).toBe(sl);
      expect(s.players[0].stacks[sl].map((c) => c.uid)).toEqual([sp3.uid, other.uid]); // other 盖住 sp3
      expect(sp3.faceUp).toBe(true); // 被盖 → 翻转跳过
      expect(s.pendingEffects).toHaveLength(0);
    });
  });

  describe('speed-4 middle: 平移1张对手的反面牌。', () => {
    it('shifts an opponent face-down top card (face-up tops are not candidates)', () => {
      const s = draftSpeedP1();
      advanceToStep(s, 0, 'action');
      const sl = speedLine(s);
      s.players[0].hand = [makeCard('speed-4', 0, 'hand')];
      const fd = makeCard('metal-1', 1, 'field', false, 1, 0); // 对手反面顶卡
      const fu = makeCard('death-0', 1, 'field', true, 2, 0); // 对手正面顶卡（非候选）
      s.players[1].stacks[1] = [fd];
      s.players[1].stacks[2] = [fu];
      const card = s.players[0].hand[0];
      executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: true, line: sl });
      const p = s.pendingEffects[s.pendingEffects.length - 1];
      expect(p.prompt?.kind).toBe('select');
      expect(p.prompt?.candidates.map((c) => c.uid)).toEqual([fd.uid]); // 只列对手反面顶卡
      executeAction(s, 0, 'effect-choice', { promptId: p.id, choice: [fd.uid] });
      const p2 = s.pendingEffects[s.pendingEffects.length - 1];
      expect(p2.prompt?.kind).toBe('select-line');
      expect(p2.prompt?.lines).toEqual(([0, 1, 2] as Line[]).filter((l) => l !== 1));
      const dest = ([0, 1, 2] as Line[]).find((l) => l !== 1)!;
      executeAction(s, 0, 'effect-choice', { promptId: p2.id, choice: [`line:${dest}`] });
      expect(fd.line).toBe(dest);
      expect(fd.faceUp).toBe(false); // 反面平移（不翻面）
      expect(s.players[1].stacks[1]).toHaveLength(0);
      expect(fu.line).toBe(2); // 正面顶卡不动
      expect(s.pendingEffects).toHaveLength(0);
    });

    it('no opponent face-down top card → fizzles without hanging', () => {
      const s = draftSpeedP1();
      advanceToStep(s, 0, 'action');
      const sl = speedLine(s);
      s.players[0].hand = [makeCard('speed-4', 0, 'hand')];
      s.players[1].stacks[1] = [makeCard('death-0', 1, 'field', true, 1, 0)]; // 只有正面顶卡
      const card = s.players[0].hand[0];
      executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: true, line: sl });
      resolveAllChoices(s, pickFirst); // 候选空 → 自动跳过
      expect(s.pendingEffects).toHaveLength(0);
      expect(s.players[1].stacks[1]).toHaveLength(1); // 未平移
    });
  });

  describe('speed-5 middle: 弃1张牌。', () => {
    it('discards 1 from hand', () => {
      const s = draftSpeedP1();
      advanceToStep(s, 0, 'action');
      const sl = speedLine(s);
      s.players[0].hand = [makeCard('speed-5', 0, 'hand'), makeCard('speed-0', 0, 'hand')];
      const target = s.players[0].hand.find((c) => c.defId === 'speed-5')!;
      const other = s.players[0].hand.find((c) => c.defId !== 'speed-5')!;
      executeAction(s, 0, 'play', { cardUid: target.uid, faceUp: true, line: sl });
      resolveAllChoices(s, (p) => [other.uid]); // 弃 speed-0
      expect(s.players[0].trash.map((c) => c.uid)).toEqual([other.uid]);
      expect(s.players[0].hand).toHaveLength(0);
      expect(s.players[0].stacks[sl].map((c) => c.uid)).toEqual([target.uid]);
      expect(s.pendingEffects).toHaveLength(0);
    });

    it('empty hand → fizzles without hanging', () => {
      const s = draftSpeedP1();
      advanceToStep(s, 0, 'action');
      const sl = speedLine(s);
      s.players[0].hand = [makeCard('speed-5', 0, 'hand')];
      const card = s.players[0].hand[0];
      executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: true, line: sl });
      resolveAllChoices(s, pickFirst);
      expect(s.pendingEffects).toHaveLength(0);
      expect(s.players[0].trash).toHaveLength(0); // 无牌可弃
    });
  });
});
