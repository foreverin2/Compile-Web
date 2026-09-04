import { describe, it, expect } from 'vitest';
import type { ChoiceRequest, GameState, Line, PlayerId } from '../../src/core/models/types';
import { createGame, stackValue } from '../../src/core/state/create';
import { pushMiddle, resolveMiddle, runStack } from '../../src/core/effects/resolve';
import { refreshHand } from '../../src/core/actions/base';
import { drawCards } from '../../src/core/engine/deck';
import { isPlayableFaceUp } from '../../src/core/actions/base';
import { makeCard, resolveAllChoices } from '../helpers';

/**
 * 2代 批2 五套卡效果测试（寒冰/烟雾/恐惧/腐化/战争）——代表性用例。
 * 裁决：docs/批2裁决结果.md；引擎扩展 00e0f4b。
 */

function setup(): GameState {
  const s = createGame();
  for (const pid of [0, 1] as PlayerId[]) {
    s.players[pid].protocols = [
      { defId: 'fire', compiled: false },
      { defId: 'light', compiled: false },
      { defId: 'darkness', compiled: false },
    ];
  }
  s.phase = 'turn';
  return s;
}

/** 放置 faceUp 顶卡到 owner 的 line 并返回该卡 */
function placeSrc(s: GameState, defId: string, owner: PlayerId, line: Line) {
  const c = makeCard(defId, owner, 'field', true, line, s.players[owner].stacks[line].length);
  s.players[owner].stacks[line].push(c);
  return c;
}

function eagerPick(prompt: ChoiceRequest): string[] {
  if (prompt.kind === 'select-line') return prompt.lines && prompt.lines.length > 0 ? [`line:${prompt.lines[0]}`] : [];
  if (prompt.kind === 'select-action') return prompt.actions && prompt.actions.length > 0 ? [prompt.actions[0]] : [];
  if (prompt.candidates.length === 0) return [];
  return prompt.candidates.slice(0, prompt.max).map((c) => c.uid);
}

function pushOp(s: GameState, player: PlayerId, op: unknown): void {
  s.pendingEffects.push({
    id: `t-${s.pendingEffects.length}`,
    player,
    gen: (function* (): Generator<unknown, void, unknown> {
      yield op;
    })() as never,
    sourceUid: 't-src',
    sourceDefId: 't-sys',
    system: true,
    prompt: null,
    lastAnswer: null,
  });
}

// ============ 寒冰 ice ============

describe('ice', () => {
  it('ice-6 blocks draw while holder has hand cards; draw allowed at 0 hand', () => {
    const s = setup();
    placeSrc(s, 'ice-6', 0, 0);
    s.players[0].hand = [makeCard('fire-0', 0, 'hand')];
    s.players[0].deck = [makeCard('death-5', 0, 'deck', false)];
    expect(drawCards(s, 0, 1)).toHaveLength(0); // 有手牌 → 禁抽
    expect(s.players[0].deck).toHaveLength(1);
    s.players[0].hand = [];
    expect(drawCards(s, 0, 1)).toHaveLength(1); // 无手牌 → 放行
  });

  it('ice-4 cannot be flipped while uncovered top', () => {
    const s = setup();
    const c = placeSrc(s, 'ice-4', 0, 0);
    pushOp(s, 0, { op: 'flip', uid: c.uid });
    runStack(s);
    expect(c.faceUp).toBe(true); // 翻转被跳过
  });
});

// ============ 烟雾 smoke ============

describe('smoke', () => {
  it('smoke-0 plays deck top face-down into each line that has a face-down card', () => {
    const s = setup();
    const src = placeSrc(s, 'smoke-0', 0, 2);
    s.players[0].stacks[0] = [makeCard('death-0', 0, 'field', false, 0, 0)]; // 线0 有反面
    s.players[0].stacks[1] = []; // 线1 无
    s.players[0].deck = [makeCard('death-1', 0, 'deck', false), makeCard('death-2', 0, 'deck', false)];
    resolveMiddle(s, 0, src);
    expect(s.players[0].stacks[0]).toHaveLength(2); // 线0 打入 1 张
    expect(s.players[0].stacks[0][1].faceUp).toBe(false);
    expect(s.players[0].deck).toHaveLength(1);
  });

  it('smoke-2 top adds both-sides face-down count of its line to own total', () => {
    const s = setup();
    const c = placeSrc(s, 'smoke-2', 0, 0); // 值 2
    s.players[0].stacks[0] = [makeCard('death-0', 0, 'field', false, 0, 0), c];
    s.players[1].stacks[0] = [makeCard('fire-0', 1, 'field', false, 0, 0)]; // 对手反面
    // own total = 2(自己牌面) + 2(自己反面) + 修正(双方反面 2) = 6
    expect(stackValue(s, 0, 0)).toBe(6);
  });
});

// ============ 恐惧 fear ============

describe('fear', () => {
  it('fear-0 top blocks opponent middle commands during its owner turn', () => {
    const s = setup();
    s.turnPlayer = 0; // fear-0 拥有者回合
    const c = placeSrc(s, 'fear-0', 0, 0);
    const p1card = makeCard('fire-1', 1, 'field', false, 1, 0); // fire-1 middle 弃1（挂起）
    s.players[1].stacks[1] = [p1card];
    pushMiddle(s, 1, p1card);
    expect(s.pendingEffects).toHaveLength(0); // 禁
    c.faceUp = false; // fear-0 失效
    pushMiddle(s, 1, p1card);
    expect(s.pendingEffects.length).toBeGreaterThan(0); // 放行挂起
  });

  it('fear-1 middle: opponent discards all hand then draws hand-before-1', () => {
    const s = setup();
    const src = placeSrc(s, 'fear-1', 0, 0);
    s.players[1].hand = [makeCard('fire-1', 1, 'hand'), makeCard('fire-2', 1, 'hand'), makeCard('fire-3', 1, 'hand')]; // 弃前 3
    s.players[1].deck = [makeCard('death-5', 1, 'deck', false), makeCard('death-4', 1, 'deck', false), makeCard('death-3', 1, 'deck', false)];
    s.players[0].deck = [makeCard('death-2', 0, 'deck', false), makeCard('death-1', 0, 'deck', false)];
    resolveMiddle(s, 0, src);
    expect(s.players[1].hand).toHaveLength(2); // 弃 3 → 抽 3-1=2
    expect(s.players[1].trash).toHaveLength(3);
    expect(s.players[0].hand).toHaveLength(2); // 自己抽 2
  });
});

// ============ 腐化 corruption ============

describe('corruption', () => {
  it('corruption-0 can be played face-up to any line (engine release)', () => {
    const s = setup();
    const c = makeCard('corruption-0', 0, 'hand');
    s.players[0].hand.push(c);
    for (const line of [0, 1, 2] as Line[]) {
      expect(isPlayableFaceUp(s, 0, c.uid, line)).toBe(true);
    }
  });

  it('corruption-1 after-return shuffles recalled opponent card into their deck', () => {
    const s = setup();
    placeSrc(s, 'corruption-1', 0, 0); // P0 场
    const recalled = makeCard('fire-0', 1, 'field', true, 1, 0);
    s.players[1].stacks[1] = [recalled];
    pushOp(s, 0, { op: 'return', uid: recalled.uid });
    runStack(s);
    // 召回 → after-return 触发 corruption-1 → fire-0 洗入 P1 牌库（faceDown）
    expect(s.players[1].hand).toHaveLength(0);
    expect(s.players[1].deck.length).toBeGreaterThan(0);
    const back = s.players[1].deck.find((c) => c.uid === recalled.uid);
    expect(back).toBeTruthy();
    expect(back!.faceUp).toBe(false);
    expect(s.players[1].trash).toHaveLength(0);
  });
});

// ============ 战争 war ============

describe('war', () => {
  it('war-0 top after-refresh: can flip itself when holder refreshes', () => {
    const s = setup();
    const c = placeSrc(s, 'war-0', 0, 0);
    s.players[0].hand = [makeCard('fire-1', 0, 'hand')];
    s.players[0].deck = [
      makeCard('death-5', 0, 'deck', false),
      makeCard('death-4', 0, 'deck', false),
      makeCard('death-3', 0, 'deck', false),
      makeCard('death-2', 0, 'deck', false),
    ];
    refreshHand(s, 0); // 补至 5 → after-refresh push war-0 触发效果
    runStack(s); // 驱动 fireReactive push 的效果（直接调 refreshHand 无 executeAction 包装）
    resolveAllChoices(s, eagerPick);
    expect(c.faceUp).toBe(false); // 翻了自己
  });
});

void resolveAllChoices;
void resolveMiddle;
