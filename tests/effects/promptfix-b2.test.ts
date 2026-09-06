import { describe, it, expect } from 'vitest';
import type { GameState, Line, PlayerId } from '../../src/core/models/types';
import { createGame } from '../../src/core/state/create';
import { resolveMiddle, runStack, answerEffect } from '../../src/core/effects/resolve';
import { fireRefreshReactives } from '../../src/core/effects/triggers';
import { makeCard, resolveAllChoices, pickFirst } from '../helpers';

/** 修改提示词 19：ice-6 禁抽（手牌>0）/手牌已满时效果指示的「刷新」抽 0 → 无效：
 *  不消耗控制组件、不弹协议重排、不触发刷新连锁。 */

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

describe('修改提示词 19（刷新抽 0 无效）', () => {
  it('love-2 效果刷新被 ice-6 拦截 → 不归还控制权、不弹重排、不发刷新连锁', () => {
    const s = setup();
    placeSrc(s, 'ice-6', 0, 0); // P1 场上 ice-6（顶命令）
    const love2 = placeSrc(s, 'love-2', 0, 1); // love-2 顶卡（中段结算）
    s.control = 0; // P1 持有控制组件
    s.players[0].hand = [makeCard('fire-1', 0, 'hand'), makeCard('light-2', 0, 'hand')]; // 手>0 → ice-6 禁抽
    s.players[0].deck = Array.from({ length: 5 }, () => makeCard('fire-1', 0, 'deck', false));
    s.players[1].deck = Array.from({ length: 3 }, () => makeCard('light-1', 1, 'deck', false));
    resolveMiddle(s, 0, love2); // 对手抽 1 → 刷新被 ice-6 挡
    expect(s.pendingEffects).toHaveLength(0); // 无挂起（无重排菜单）
    expect(s.control).toBe(0); // 未归还控制组件
    expect(s.players[0].hand).toHaveLength(2); // 未抽牌
    expect(s.players[1].hand).toHaveLength(1); // 对手抽 1 照常
  });

  it('war-1 强制刷新时拥有者手牌已满（5 张）→ 刷新无效不归还控制权', () => {
    const s = setup();
    const w1 = placeSrc(s, 'war-1', 0, 0);
    s.control = 0;
    s.players[0].hand = Array.from({ length: 5 }, () => makeCard('fire-1', 0, 'hand'));
    s.players[1].deck = Array.from({ length: 3 }, () => makeCard('light-1', 1, 'deck', false));
    fireRefreshReactives(s, 1); // 对手（P2）刷新 → war-1 触发（拥有者弃任意张 + 刷新自己）
    runStack(s);
    const top = s.pendingEffects[s.pendingEffects.length - 1];
    expect(top?.prompt?.kind).toBe('select'); // 弃任意张（min0 max5）
    answerEffect(s, top.id, []); // 弃 0 张 → 手仍 5 → 刷新无效
    resolveAllChoices(s, pickFirst);
    expect(s.pendingEffects).toHaveLength(0);
    expect(s.control).toBe(0); // 手牌已满刷不了 → 不归还控制权
    expect(s.players[0].hand).toHaveLength(5);
    expect(w1.faceUp).toBe(true);
  });
});
