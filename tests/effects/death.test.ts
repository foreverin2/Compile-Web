import { describe, it, expect } from 'vitest';
import type { GameState, Line } from '../../src/core/models/types';
import { executeAction } from '../../src/core/game';
import { collectTriggers, resolveTrigger } from '../../src/core/effects/triggers';
import { runStack } from '../../src/core/effects/resolve';
import { makeCard, pickFirst, resolveAllChoices, draftDeathP1, advanceToStep } from '../helpers';

function deathLine(s: GameState): Line {
  const idx = s.players[0].protocols.findIndex((p) => p.defId === 'death');
  return idx as Line;
}

describe('death protocol effects', () => {
  it('death-0: deletes 1 card from each of the other two lines (line by line, FAQ 131)', () => {
    const s = draftDeathP1();
    advanceToStep(s, 0, 'action');
    s.players[0].hand = [makeCard('death-0', 0, 'hand')];
    // 另两列（1/2 线）各放一张顶卡：线 1 有双方卡，线 2 有对手卡
    const a = makeCard('metal-3', 0, 'field', true, 1, 0);
    const b = makeCard('metal-1', 1, 'field', true, 1, 0);
    s.players[0].stacks[1] = [a];
    s.players[1].stacks[1] = [b];
    const c = makeCard('metal-5', 1, 'field', true, 2, 0);
    s.players[1].stacks[2] = [c];
    const card = s.players[0].hand[0];
    executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: true, line: deathLine(s) });
    // 第一列：排除当前列 0
    const p1 = s.pendingEffects[s.pendingEffects.length - 1];
    expect(p1.prompt?.kind).toBe('select-line');
    expect(p1.prompt?.lines).toEqual([1, 2]);
    executeAction(s, 0, 'effect-choice', { promptId: p1.id, choice: ['line:1'] });
    // 该列双方顶卡为候选
    const p2 = s.pendingEffects[s.pendingEffects.length - 1];
    expect(p2.prompt?.kind).toBe('select');
    expect(p2.prompt?.candidates.map((c) => c.uid).sort()).toEqual([a.uid, b.uid].sort());
    executeAction(s, 0, 'effect-choice', { promptId: p2.id, choice: [b.uid] });
    expect(s.players[1].trash.map((c) => c.uid)).toEqual([b.uid]);
    // 第二列：排除当前列 0 与已选列 1
    const p3 = s.pendingEffects[s.pendingEffects.length - 1];
    expect(p3.prompt?.kind).toBe('select-line');
    expect(p3.prompt?.lines).toEqual([2]);
    executeAction(s, 0, 'effect-choice', { promptId: p3.id, choice: ['line:2'] });
    const p4 = s.pendingEffects[s.pendingEffects.length - 1];
    expect(p4.prompt?.candidates.map((c) => c.uid)).toEqual([c.uid]);
    executeAction(s, 0, 'effect-choice', { promptId: p4.id, choice: [c.uid] });
    expect(s.players[1].trash.map((x) => x.uid).sort()).toEqual([b.uid, c.uid].sort());
    expect(s.players[0].stacks[1].map((x) => x.uid)).toEqual([a.uid]); // 未选中的留下
    expect(s.players[0].stacks[deathLine(s)].map((x) => x.uid)).toEqual([card.uid]); // 源卡留在场上
    expect(s.pendingEffects).toHaveLength(0);
  });

  it('death-0: a line with no cards fizzles that step, the other line is still processed', () => {
    const s = draftDeathP1();
    advanceToStep(s, 0, 'action');
    s.players[0].hand = [makeCard('death-0', 0, 'hand')];
    const c = makeCard('metal-5', 1, 'field', true, 2, 0); // 线 1 空，线 2 有卡
    s.players[1].stacks[2] = [c];
    const card = s.players[0].hand[0];
    executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: true, line: deathLine(s) });
    const p1 = s.pendingEffects[s.pendingEffects.length - 1];
    executeAction(s, 0, 'effect-choice', { promptId: p1.id, choice: ['line:1'] }); // 空线 → 卡选择 fizzle
    expect(s.pendingEffects[s.pendingEffects.length - 1].prompt?.kind).toBe('select-line'); // 不挂起，直接到第二列
    const p2 = s.pendingEffects[s.pendingEffects.length - 1];
    expect(p2.prompt?.lines).toEqual([2]);
    executeAction(s, 0, 'effect-choice', { promptId: p2.id, choice: ['line:2'] });
    const p3 = s.pendingEffects[s.pendingEffects.length - 1];
    executeAction(s, 0, 'effect-choice', { promptId: p3.id, choice: [c.uid] });
    expect(s.players[1].trash.map((x) => x.uid)).toEqual([c.uid]);
    expect(s.pendingEffects).toHaveLength(0);
  });

  it('death-1 start trigger: draw, delete another card, then delete itself', () => {
    const s = draftDeathP1(); // 草案结束即 P1 的 start 步骤（turnPlayer 0）
    expect(s.step).toBe('start');
    const dl = deathLine(s);
    const death1 = makeCard('death-1', 0, 'field', true, dl, 0);
    s.players[0].stacks[dl] = [death1];
    const other = makeCard('metal-1', 1, 'field', true, 1, 0);
    s.players[1].stacks[1] = [other];
    s.players[0].hand = [];
    const deckBefore = s.players[0].deck.length;
    const t = collectTriggers(s, 'start').find((x) => x.cardUid === death1.uid);
    expect(t).toBeDefined();
    expect(t?.top).toBe(true);
    resolveTrigger(s, t!, { topCommand: t!.top });
    runStack(s);
    const p = s.pendingEffects[s.pendingEffects.length - 1];
    expect(p.prompt?.kind).toBe('select-action');
    expect(p.prompt?.actions).toEqual(['action:draw', 'action:skip']);
    executeAction(s, 0, 'effect-choice', { promptId: p.id, choice: ['action:draw'] });
    expect(s.players[0].hand).toHaveLength(1); // 抽 1
    expect(s.players[0].deck).toHaveLength(deckBefore - 1);
    const p2 = s.pendingEffects[s.pendingEffects.length - 1];
    expect(p2.prompt?.kind).toBe('select');
    expect(p2.prompt?.candidates.map((c) => c.uid)).toEqual([other.uid]); // 排除自己（源卡）
    executeAction(s, 0, 'effect-choice', { promptId: p2.id, choice: [other.uid] });
    expect(s.players[1].trash.map((c) => c.uid)).toEqual([other.uid]); // 另 1 张被删除
    expect(s.players[0].trash.map((c) => c.uid)).toEqual([death1.uid]); // 然后删除此牌
    expect(s.players[0].stacks[dl]).toHaveLength(0);
    expect(s.pendingEffects).toHaveLength(0);
  });

  it('death-1 start trigger: skip draws nothing and the card stays', () => {
    const s = draftDeathP1();
    const dl = deathLine(s);
    const death1 = makeCard('death-1', 0, 'field', true, dl, 0);
    s.players[0].stacks[dl] = [death1];
    s.players[0].hand = [];
    const t = collectTriggers(s, 'start').find((x) => x.cardUid === death1.uid)!;
    resolveTrigger(s, t, { topCommand: t.top });
    runStack(s);
    const p = s.pendingEffects[s.pendingEffects.length - 1];
    executeAction(s, 0, 'effect-choice', { promptId: p.id, choice: ['action:skip'] });
    expect(s.players[0].hand).toHaveLength(0); // 不抽
    expect(s.players[0].trash).toHaveLength(0);
    expect(s.players[0].stacks[dl].map((c) => c.uid)).toEqual([death1.uid]); // 不删除自己
    expect(s.pendingEffects).toHaveLength(0);
  });

  it('death-1 top: start trigger still fires when covered (FAQ 98/99), self-delete works', () => {
    const s = draftDeathP1();
    const dl = deathLine(s);
    const death1 = makeCard('death-1', 0, 'field', true, dl, 0);
    const cover = makeCard('metal-5', 0, 'field', true, dl, 1); // 正面盖住 death-1
    s.players[0].stacks[dl] = [death1, cover];
    const other = makeCard('water-1', 1, 'field', true, 1, 0);
    s.players[1].stacks[1] = [other];
    const t = collectTriggers(s, 'start').find((x) => x.cardUid === death1.uid);
    expect(t).toBeDefined(); // 顶命令被盖仍收集
    expect(t?.top).toBe(true);
    resolveTrigger(s, t!, { topCommand: t!.top });
    runStack(s);
    const p = s.pendingEffects[s.pendingEffects.length - 1];
    executeAction(s, 0, 'effect-choice', { promptId: p.id, choice: ['action:draw'] });
    const p2 = s.pendingEffects[s.pendingEffects.length - 1];
    executeAction(s, 0, 'effect-choice', { promptId: p2.id, choice: [other.uid] });
    expect(s.players[1].trash.map((c) => c.uid)).toEqual([other.uid]);
    expect(s.players[0].trash.map((c) => c.uid)).toEqual([death1.uid]); // 被盖的自己也能删除
    expect(s.players[0].stacks[dl].map((c) => c.uid)).toEqual([cover.uid]);
    expect(s.pendingEffects).toHaveLength(0);
  });

  it('death-1 start: drew but NO other uncovered card → whole chain aborts, self NOT deleted (user ruling)', () => {
    const s = draftDeathP1();
    const dl = deathLine(s);
    const death1 = makeCard('death-1', 0, 'field', true, dl, 0);
    s.players[0].stacks[dl] = [death1]; // 场上唯一卡
    s.players[0].hand = [];
    const t = collectTriggers(s, 'start').find((x) => x.cardUid === death1.uid)!;
    resolveTrigger(s, t, { topCommand: t.top });
    runStack(s);
    const p = s.pendingEffects[s.pendingEffects.length - 1];
    executeAction(s, 0, 'effect-choice', { promptId: p.id, choice: ['action:draw'] });
    expect(s.players[0].hand).toHaveLength(1); // 抽了
    // 「删除另1张牌」候选为空 → fizzle 空答案 → 整条不执行（用户拍板：不删自己）
    expect(s.pendingEffects).toHaveLength(0);
    expect(s.players[0].trash).toHaveLength(0);
    expect(s.players[0].stacks[dl].map((c) => c.uid)).toEqual([death1.uid]); // 自己仍在场上
  });

  it('death-2: deletes all 1- and 2-point cards in the chosen line (both players, covered included)', () => {
    const s = draftDeathP1();
    advanceToStep(s, 0, 'action');
    s.players[1].hand = [];
    s.players[0].hand = [makeCard('death-2', 0, 'hand')];
    // 线 1：P1 堆叠 [被盖 2 分, 顶 3 分]；P2 堆叠 [1 分]
    const covered2 = makeCard('metal-2', 0, 'field', true, 1, 0);
    const top3 = makeCard('metal-3', 0, 'field', true, 1, 1);
    s.players[0].stacks[1] = [covered2, top3];
    const val1 = makeCard('metal-1', 1, 'field', true, 1, 0);
    s.players[1].stacks[1] = [val1];
    const card = s.players[0].hand[0];
    executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: true, line: deathLine(s) });
    const p = s.pendingEffects[s.pendingEffects.length - 1];
    expect(p.prompt?.kind).toBe('select-line');
    expect(p.prompt?.lines).toEqual([0, 1, 2]); // 任意列可选
    executeAction(s, 0, 'effect-choice', { promptId: p.id, choice: ['line:1'] });
    resolveAllChoices(s, pickFirst); // 无更多选择（全自动逐张删除）
    expect(s.players[1].trash.map((c) => c.uid)).toEqual([val1.uid]);
    expect(s.players[0].trash.map((c) => c.uid)).toEqual([covered2.uid]); // 被盖 2 分卡也删
    expect(s.players[0].stacks[1].map((c) => c.uid)).toEqual([top3.uid]); // 3 分卡留下
    expect(s.players[0].stacks[deathLine(s)].map((c) => c.uid)).toEqual([card.uid]); // 源卡在别线 → 不删自己
    expect(s.pendingEffects).toHaveLength(0);
  });

  it('death-2: choosing its own line deletes the source card too — but only after all other targets', () => {
    const s = draftDeathP1();
    advanceToStep(s, 0, 'action');
    s.players[1].hand = [];
    s.players[0].hand = [makeCard('death-2', 0, 'hand')];
    const val1 = makeCard('metal-1', 1, 'field', true, 0, 0); // 同线对手 1 分卡
    s.players[1].stacks[0] = [val1];
    const card = s.players[0].hand[0];
    executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: true, line: deathLine(s) });
    const p = s.pendingEffects[s.pendingEffects.length - 1];
    executeAction(s, 0, 'effect-choice', { promptId: p.id, choice: ['line:0'] }); // 选自己所在列
    resolveAllChoices(s, pickFirst);
    // 先删对手 1 分卡，再删自己（源卡最后删，sourceValid 终止前无剩余目标）
    expect(s.players[1].trash.map((c) => c.uid)).toEqual([val1.uid]);
    expect(s.players[0].trash.map((c) => c.uid)).toEqual([card.uid]);
    expect(s.players[1].stacks[0]).toHaveLength(0);
    expect(s.players[0].stacks[deathLine(s)]).toHaveLength(0);
    expect(s.pendingEffects).toHaveLength(0);
  });

  it('death-2: fizzles when the chosen line has no 1- or 2-point cards', () => {
    const s = draftDeathP1();
    advanceToStep(s, 0, 'action');
    s.players[0].hand = [makeCard('death-2', 0, 'hand')];
    const zero = makeCard('metal-0', 1, 'field', true, 1, 0); // 0 分
    const three = makeCard('metal-3', 1, 'field', true, 1, 1); // 3 分
    s.players[1].stacks[1] = [zero, three];
    const card = s.players[0].hand[0];
    executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: true, line: deathLine(s) });
    const p = s.pendingEffects[s.pendingEffects.length - 1];
    executeAction(s, 0, 'effect-choice', { promptId: p.id, choice: ['line:1'] });
    resolveAllChoices(s, pickFirst);
    expect(s.players[1].trash).toHaveLength(0); // 无删除
    expect(s.players[1].stacks[1].map((c) => c.uid)).toEqual([zero.uid, three.uid]);
    expect(s.pendingEffects).toHaveLength(0);
  });

  it('death-2: a face-down card under a darkness-2 top command (value 4) is NOT deleted', () => {
    const s = draftDeathP1();
    advanceToStep(s, 0, 'action');
    s.players[1].hand = [];
    s.players[0].hand = [makeCard('death-2', 0, 'hand')];
    // 线 1：P2 堆叠 [正面 darkness-2（2 分）, 反面卡（darkness-2 顶命令下 = 4 分）]
    const dark2 = makeCard('darkness-2', 1, 'field', true, 1, 0);
    const fd = makeCard('metal-1', 1, 'field', false, 1, 1);
    s.players[1].stacks[1] = [dark2, fd];
    const card = s.players[0].hand[0];
    executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: true, line: deathLine(s) });
    const p = s.pendingEffects[s.pendingEffects.length - 1];
    executeAction(s, 0, 'effect-choice', { promptId: p.id, choice: ['line:1'] });
    resolveAllChoices(s, pickFirst);
    expect(s.players[1].trash.map((c) => c.uid)).toEqual([dark2.uid]); // darkness-2 自己(2 分)删
    expect(s.players[1].stacks[1].map((c) => c.uid)).toEqual([fd.uid]); // 4 分反面卡按结算时点排除
    expect(s.pendingEffects).toHaveLength(0);
  });

  it('death-3: deletes 1 face-down top card (face-up cards not candidates)', () => {
    const s = draftDeathP1();
    advanceToStep(s, 0, 'action');
    s.players[0].hand = [makeCard('death-3', 0, 'hand')];
    const fd = makeCard('metal-1', 1, 'field', false, 1, 0);
    const up = makeCard('metal-5', 1, 'field', true, 2, 0);
    s.players[1].stacks[1] = [fd];
    s.players[1].stacks[2] = [up];
    const card = s.players[0].hand[0];
    executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: true, line: deathLine(s) });
    const p = s.pendingEffects[s.pendingEffects.length - 1];
    expect(p.prompt?.kind).toBe('select');
    expect(p.prompt?.candidates.map((c) => c.uid)).toEqual([fd.uid]); // 只列反面顶卡
    executeAction(s, 0, 'effect-choice', { promptId: p.id, choice: [fd.uid] });
    expect(s.players[1].trash.map((c) => c.uid)).toEqual([fd.uid]);
    expect(s.players[1].stacks[1]).toHaveLength(0);
    expect(s.pendingEffects).toHaveLength(0);
  });

  it('death-3: no face-down top card → fizzles without hanging', () => {
    const s = draftDeathP1();
    advanceToStep(s, 0, 'action');
    s.players[0].hand = [makeCard('death-3', 0, 'hand')];
    const up = makeCard('metal-5', 1, 'field', true, 1, 0);
    s.players[1].stacks[1] = [up];
    const card = s.players[0].hand[0];
    executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: true, line: deathLine(s) });
    resolveAllChoices(s, pickFirst);
    expect(s.pendingEffects).toHaveLength(0); // 空候选自动跳过
    expect(s.players[1].stacks[1].map((c) => c.uid)).toEqual([up.uid]);
  });

  it('death-4: deletes 1 face-up 0- or 1-point card (2+ and face-down excluded)', () => {
    const s = draftDeathP1();
    advanceToStep(s, 0, 'action');
    s.players[0].hand = [makeCard('death-4', 0, 'hand')];
    const zero = makeCard('metal-0', 1, 'field', true, 1, 0);
    const one = makeCard('metal-1', 1, 'field', true, 2, 0);
    const three = makeCard('metal-3', 0, 'field', true, 1, 1); // 3 分 → 排除
    s.players[1].stacks[1] = [zero];
    s.players[1].stacks[2] = [one];
    s.players[0].stacks[1] = [three];
    const card = s.players[0].hand[0];
    executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: true, line: deathLine(s) });
    const p = s.pendingEffects[s.pendingEffects.length - 1];
    expect(p.prompt?.kind).toBe('select');
    expect(p.prompt?.candidates.map((c) => c.uid).sort()).toEqual([zero.uid, one.uid].sort());
    executeAction(s, 0, 'effect-choice', { promptId: p.id, choice: [zero.uid] });
    expect(s.players[1].trash.map((c) => c.uid)).toEqual([zero.uid]);
    expect(s.players[1].stacks[1]).toHaveLength(0);
    expect(s.pendingEffects).toHaveLength(0);
  });

  it('death-4: no face-up 0/1-point top card → fizzles without hanging', () => {
    const s = draftDeathP1();
    advanceToStep(s, 0, 'action');
    s.players[0].hand = [makeCard('death-4', 0, 'hand')];
    const up3 = makeCard('metal-3', 1, 'field', true, 1, 0); // 3 分
    const fd = makeCard('metal-1', 1, 'field', false, 2, 0); // 反面 → 不算
    s.players[1].stacks[1] = [up3];
    s.players[1].stacks[2] = [fd];
    const card = s.players[0].hand[0];
    executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: true, line: deathLine(s) });
    resolveAllChoices(s, pickFirst);
    expect(s.pendingEffects).toHaveLength(0);
    expect(s.players[1].trash).toHaveLength(0);
    expect(s.players[1].stacks[1].map((c) => c.uid)).toEqual([up3.uid]);
  });

  it('death-5: discard 1 from hand', () => {
    const s = draftDeathP1();
    advanceToStep(s, 0, 'action');
    s.players[0].hand = [makeCard('death-5', 0, 'hand'), makeCard('metal-1', 0, 'hand')];
    const target = s.players[0].hand.find((c) => c.defId === 'death-5')!;
    const other = s.players[0].hand.find((c) => c.defId !== 'death-5')!;
    executeAction(s, 0, 'play', { cardUid: target.uid, faceUp: true, line: deathLine(s) });
    resolveAllChoices(s, (p) => [other.uid]); // 弃 metal-1
    expect(s.players[0].trash.map((c) => c.uid)).toEqual([other.uid]);
    expect(s.players[0].hand).toHaveLength(0);
    expect(s.players[0].stacks[deathLine(s)].map((c) => c.uid)).toEqual([target.uid]);
  });

  it('death-5: empty hand → fizzles without hanging', () => {
    const s = draftDeathP1();
    advanceToStep(s, 0, 'action');
    s.players[0].hand = [makeCard('death-5', 0, 'hand')];
    const card = s.players[0].hand[0];
    executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: true, line: deathLine(s) });
    resolveAllChoices(s, pickFirst);
    expect(s.pendingEffects).toHaveLength(0);
    expect(s.players[0].trash).toHaveLength(0); // 无牌可弃
  });
});
