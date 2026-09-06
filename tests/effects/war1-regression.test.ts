import { describe, it, expect } from 'vitest';
import type { GameState, Line, PlayerId } from '../../src/core/models/types';
import { createGame } from '../../src/core/state/create';
import { runStack, answerEffect } from '../../src/core/effects/resolve';
import { fireRefreshReactives } from '../../src/core/effects/triggers';
import { makeCard, resolveAllChoices, pickFirst } from '../helpers';

/**
 * war-1 底（after-opponent-refresh）回归（2026-09 用户拍板语义修正，见 docs/3代-评审收口.md MINOR#3）：
 * 主体 = war-1 拥有者「你」——对手刷新时触发 → 你弃任意张 + 刷新【自己的手牌】（补至 5）；
 * 自己刷新只触发自身侧 after-refresh，不再次命中本卡 after-opponent-refresh → 无递归。
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

function placeSrc(s: GameState, defId: string, owner: PlayerId, line: Line) {
  const c = makeCard(defId, owner, 'field', true, line, s.players[owner].stacks[line].length);
  s.players[owner].stacks[line].push(c);
  return c;
}

describe('war-1 底（当对手刷新时：你弃任意张，然后刷新自己）', () => {
  it('opponent refreshes → owner discards any, refreshes own hand to 5, no recursion', () => {
    const s = setup();
    const w1 = placeSrc(s, 'war-1', 0, 0); // P1 的 war-1（顶卡）
    // P1 手牌 1 张（可弃 0..1）+ 牌库充足
    const keep = makeCard('fire-1', 0, 'hand');
    s.players[0].hand = [keep];
    s.players[0].deck = Array.from({ length: 6 }, () => makeCard('fire-1', 0, 'deck', false));
    // P2 刷新 → after-opponent-refresh（actor=1 → 遍历其对手 = P1 侧）→ war-1 触发
    fireRefreshReactives(s, 1);
    runStack(s);
    // war-1 gen 第一步：你（P1，拥有者 = 效果属主，chooser 缺省）弃任意张（min0 max1）
    const top = s.pendingEffects[s.pendingEffects.length - 1];
    expect(top?.prompt?.kind).toBe('select');
    answerEffect(s, top.id, []); // 弃 0 张
    resolveAllChoices(s, pickFirst);
    // 刷新自己：弃 0 后手 1 → 补 4 → 手 5
    expect(s.players[0].hand).toHaveLength(5);
    expect(s.players[0].hand.some((c) => c.uid === keep.uid)).toBe(true);
    // 无递归：war-1 不再次入栈（自己的刷新不触发 after-opponent-refresh）
    expect(s.pendingEffects).toHaveLength(0);
    // war-1 仍在场（未被覆盖/移除）
    expect(s.players[0].stacks[0].some((c) => c.uid === w1.uid)).toBe(true);
  });

  it('owner with no hand: discards nothing and still refreshes to 5', () => {
    const s = setup();
    placeSrc(s, 'war-1', 0, 0);
    s.players[0].deck = Array.from({ length: 5 }, () => makeCard('fire-1', 0, 'deck', false));
    fireRefreshReactives(s, 1); // P2 刷新
    runStack(s);
    resolveAllChoices(s, pickFirst); // 空手牌 select 自动 fizzle → 刷新补 5
    expect(s.players[0].hand).toHaveLength(5);
    expect(s.pendingEffects).toHaveLength(0);
  });
});
