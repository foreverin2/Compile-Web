import { describe, it, expect } from 'vitest';
import type { GameState, EffectStep, StepResult } from '../../src/core/models/types';
import { createGame } from '../../src/core/state/create';
import { runStack, answerEffect } from '../../src/core/effects/resolve';
import { resolveAllChoices, pickFirst } from '../helpers';

/** 直接构造一个测试生成器入栈（sourceUid='src' 需先放在场上保证 sourceValid） */
function pushTestEffect(s: GameState, gen: Generator<EffectStep, void, StepResult>): void {
  s.pendingEffects.push({
    id: 'e1', player: 0, gen, sourceUid: 'src', sourceDefId: 'test', prompt: null, lastAnswer: null,
  });
  runStack(s);
}

function base(): GameState {
  const s = createGame();
  s.phase = 'turn';
  s.players[0].stacks[0] = [{
    uid: 'src', defId: 'fire-1', owner: 0, faceUp: true, zone: 'field', line: 0, pos: 0,
  }];
  s.players[0].hand.push({
    uid: 'h1', defId: 'fire-1', owner: 0, faceUp: true, zone: 'hand', line: null, pos: null,
  });
  // 牌库 2 张：draw 从牌库抽，避免空牌库时 drawCards 洗弃牌堆把 h1 抽回（brief 缺陷修正）
  s.players[0].deck.push(
    { uid: 'd1', defId: 'fire-1', owner: 0, faceUp: true, zone: 'deck', line: null, pos: null },
    { uid: 'd2', defId: 'fire-1', owner: 0, faceUp: true, zone: 'deck', line: null, pos: null },
  );
  return s;
}

const handCandidates = () => [
  { uid: 'h1', defId: 'fire-1', faceUp: true, owner: 0 as const, zone: 'hand' as const, line: null, pos: null, label: '1' },
];

describe('effect stack runner', () => {
  it('suspends on a select step and resumes with the answer', () => {
    const s = base();
    let got: string[] = [];
    function* gen(): Generator<EffectStep, void, StepResult> {
      const a = (yield { kind: 'select', title: 't', min: 1, max: 1, optional: false, candidates: handCandidates() }) as { selected: string[] };
      got = a.selected;
      yield { op: 'draw', count: 1 };
    }
    pushTestEffect(s, gen());
    expect(s.pendingEffects).toHaveLength(1);
    expect(s.pendingEffects[0].prompt?.title).toBe('t');
    answerEffect(s, 'e1', ['h1']);
    expect(got).toEqual(['h1']);
    expect(s.pendingEffects).toHaveLength(0);
    expect(s.players[0].hand).toHaveLength(2); // draw 1 已执行
  });

  it('rejects answers outside [min,max] and unknown uids', () => {
    const s = base();
    function* gen(): Generator<EffectStep, void, StepResult> {
      yield { kind: 'select', title: 't', min: 1, max: 1, optional: false, candidates: handCandidates() };
    }
    pushTestEffect(s, gen());
    expect(() => answerEffect(s, 'e1', [])).toThrow(/at least 1/);
    expect(() => answerEffect(s, 'e1', ['nope'])).toThrow(/invalid selection/);
    expect(() => answerEffect(s, 'wrong-id', ['h1'])).toThrow(/mismatch/);
  });

  it('terminates a suspended effect whose source card is covered', () => {
    const s = base();
    let drew = false;
    function* gen(): Generator<EffectStep, void, StepResult> {
      yield { kind: 'select', title: 't', min: 1, max: 1, optional: false, candidates: handCandidates() };
      drew = true;
      yield { op: 'draw', count: 1 };
    }
    pushTestEffect(s, gen());
    expect(s.pendingEffects[0].prompt).not.toBeNull();
    // 挂起期间源卡被覆盖
    s.players[0].stacks[0].push({
      uid: 'cover', defId: 'fire-1', owner: 0, faceUp: true, zone: 'field', line: 0, pos: 1,
    });
    answerEffect(s, 'e1', ['h1']);
    expect(drew).toBe(false); // 剩余效果终止
    expect(s.pendingEffects).toHaveLength(0);
  });

  it('discard op moves hand card to trash face-up; draw op draws', () => {
    const s = base();
    function* gen(): Generator<EffectStep, void, StepResult> {
      yield { op: 'discard', uid: 'h1' };
      yield { op: 'draw', count: 2 };
    }
    pushTestEffect(s, gen());
    // brief 缺陷：原断言 hand 长度 0，与下方 hand 长度 2 矛盾（discard 后 draw 2 手牌为 2）；
    // 意图是"h1 已不在手牌"，改为显式断言
    expect(s.players[0].hand.map((c) => c.uid)).not.toContain('h1');
    expect(s.players[0].trash.map((c) => c.uid)).toEqual(['h1']);
    expect(s.players[0].trash[0].faceUp).toBe(true);
    expect(s.players[0].hand).toHaveLength(2);
  });

  it('drain branch lands a pendingPlay card when the stack empties', () => {
    const s = base();
    const card = s.players[0].hand[0];
    s.players[0].hand.splice(0, 1);
    card.zone = 'float';
    card.line = 0;
    card.pos = null;
    s.pendingPlay.push({ card, beforeCoveredDone: false });
    s.players[0].stacks[0] = []; // 落地到空线（"栈清空"场景；brief 缺陷修正）
    runStack(s);
    expect(s.pendingPlay).toHaveLength(0);
    expect(card.zone).toBe('field');
    expect(s.players[0].stacks[0].map((c) => c.uid)).toEqual([card.uid]);
  });

  it('resolveAllChoices drains a full chain including nested selects', () => {
    const s = base();
    s.players[0].hand.push({ uid: 'h2', defId: 'fire-1', owner: 0, faceUp: true, zone: 'hand', line: null, pos: null });
    function* gen(): Generator<EffectStep, void, StepResult> {
      yield { kind: 'select', title: 'a', min: 1, max: 1, optional: false, candidates: handCandidates() };
      yield { kind: 'select', title: 'b', min: 1, max: 1, optional: false, candidates: handCandidates() };
    }
    pushTestEffect(s, gen());
    resolveAllChoices(s, pickFirst);
    expect(s.pendingEffects).toHaveLength(0);
  });
});
