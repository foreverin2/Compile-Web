import { describe, it, expect } from 'vitest';
import type { GameState, Line, PlayerId } from '../../src/core/models/types';
import { createGame } from '../../src/core/state/create';
import { resolveMiddle, answerEffect } from '../../src/core/effects/resolve';
import { executeAction } from '../../src/core/game';
import { makeCard, resolveAllChoices, pickFirst } from '../helpers';

/** 修改提示词批 B1 回归：war-0（当对手抽牌时）在对手刷新抽牌后触发一次；
 *  重编译对手牌库空 → 先洗弃牌堆再抽顶；ice-4 被盖仍免疫翻转。 */

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

describe('修改提示词 B1', () => {
  it('war-0 bottom（当对手抽牌时）在对手刷新抽牌后触发一次', () => {
    const s = setup();
    s.turnPlayer = 1; // 对手回合
    s.step = 'action';
    placeSrc(s, 'war-0', 0, 1); // P1 的 war-0（底命令，P1 侧顶卡）
    s.players[1].deck = Array.from({ length: 6 }, () => makeCard('light-1', 1, 'deck', false));
    s.players[1].hand = [makeCard('light-2', 1, 'hand')]; // 手牌 1 → 刷新补 4
    executeAction(s, 1, 'refresh');
    resolveAllChoices(s, pickFirst); // war-0 可选删除 → 跳过
    expect(s.players[1].hand).toHaveLength(5);
    // 刷新抽触发了 P1 war-0 的 after-opponent-draw（日志树含 war-0 连锁行）
    expect(s.log.join(' ')).toContain('war-0');
  });

  it('重编译：对手牌库为空时先将其弃牌堆洗入牌库再抽顶', () => {
    const s = setup();
    s.turnPlayer = 0;
    s.step = 'check-compile';
    s.players[0].protocols[0].compiled = true; // 已编译 → 重编译
    s.players[1].deck = [];
    s.players[1].trash = [makeCard('darkness-5', 1, 'trash', true)];
    for (let i = 0; i < 10; i++) placeSrc(s, 'fire-1', 0, 0);
    for (let i = 0; i < 3; i++) placeSrc(s, 'light-1', 1, 0);
    executeAction(s, 0, 'compile', { line: 0 });
    resolveAllChoices(s, pickFirst);
    expect(s.players[1].trash).toHaveLength(0); // 弃牌堆已洗入牌库
    expect(s.players[0].hand).toHaveLength(1); // 抽到（原弃牌堆）牌库顶入己手
    expect(s.players[0].hand[0].owner).toBe(0);
  });

  it('ice-4 被覆盖（非顶卡）后仍不可被翻转', () => {
    const s = setup();
    const ice4 = placeSrc(s, 'ice-4', 0, 0); // faceUp 底卡
    placeSrc(s, 'fire-2', 0, 0); // 盖住 ice-4（不再是顶卡）
    // 用 chaos-0 中段（翻被盖卡）尝试翻 ice-4
    const chaos0 = makeCard('chaos-0', 0, 'field', true, 1, 0);
    s.players[0].stacks[1] = [chaos0];
    resolveMiddle(s, 0, chaos0);
    let top = s.pendingEffects[s.pendingEffects.length - 1];
    expect(top?.prompt?.kind).toBe('select-line'); // chaos-0 先选行
    answerEffect(s, top.id, ['line:0']);
    top = s.pendingEffects[s.pendingEffects.length - 1];
    expect(top?.prompt?.kind).toBe('select');
    const iceInCand = top?.prompt?.candidates?.some((c) => c.uid === ice4.uid) ?? false;
    if (iceInCand) {
      answerEffect(s, top.id, [ice4.uid]);
      resolveAllChoices(s, pickFirst);
      expect(ice4.faceUp).toBe(true); // 免疫：未被翻转
      expect(s.log.join(' ')).toContain('ice-4 不可被翻转');
    } else {
      s.pendingEffects.length = 0; // 候选未含（守卫已排除场景分支）——防御
    }
  });
});
