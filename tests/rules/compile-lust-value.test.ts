import { describe, it, expect } from 'vitest';
import type { GameState, Line, PlayerId } from '../../src/core/models/types';
import { createGame, getLineValue } from '../../src/core/state/create';
import { canCompileLine, getCompilableLines } from '../../src/core/rules/compile';
import { getLegalActions } from '../../src/core/game';
import { makeCard } from '../helpers';

/**
 * 编译判定回归（2026-09-12 用户报「12 vs 16 却能编译色欲线」）：
 * 复现 log/bug_log/compile-log-2026-09-12T14-43-11-989Z.txt 的终局态势——
 *   P1 线2（色欲）：lust-0（0，顶「每位玩家在此链路的总阈值增加10」）+ lust-2（2） → 2 + 10 = 12
 *   P2 线2（贪婪）：greed-2（2）+ greed-4（4） → 6 + 10 = 16
 * 规则书原文：「若你在某条线路拥有≥10的总数值，并且该线路你的数值高于对手，则你必须编译」
 * → P1 12 < 16 不可编译；P2 16 > 12 可编译。
 */

function setup(): GameState {
  const s = createGame();
  for (const pid of [0, 1] as PlayerId[]) {
    s.players[pid].protocols = [
      { defId: 'envy', compiled: false },
      { defId: pid === 0 ? 'lust' : 'greed', compiled: false },
      { defId: pid === 0 ? 'pride' : 'sloth', compiled: false },
    ];
  }
  s.phase = 'turn';
  s.turnPlayer = 0;
  s.step = 'check-compile';
  return s;
}

function place(s: GameState, defId: string, owner: PlayerId, line: Line) {
  const c = makeCard(defId, owner, 'field', true, line, s.players[owner].stacks[line].length);
  s.players[owner].stacks[line].push(c);
  return c;
}

describe('编译判定（lust-0 双方+10 的线值口径）', () => {
  it('P1 线2 = 12（2+10）< P2 线2 = 16（6+10）→ P1 不可编译，P2 可编译', () => {
    const s = setup();
    place(s, 'lust-0', 0, 1);
    place(s, 'lust-2', 0, 1);
    place(s, 'greed-2', 1, 1);
    place(s, 'greed-4', 1, 1);

    // 线值口径：lust-0 顶「每位玩家在此链路的总阈值增加10」→ 双方各 +10
    expect(getLineValue(s, 0, 1)).toBe(12);
    expect(getLineValue(s, 1, 1)).toBe(16);

    // 编译判定：own ≥ 10 且 own > opp
    expect(canCompileLine(s, 0, 1)).toBe(false);
    expect(canCompileLine(s, 1, 1)).toBe(true);
    expect(getCompilableLines(s, 0)).not.toContain(1);
    expect(getCompilableLines(s, 1)).toContain(1);
  });

  it('P1 回合的 check-compile：P1 无任何可编译线 → 只提供 advance（不弹编译按钮）', () => {
    const s = setup();
    place(s, 'lust-0', 0, 1);
    place(s, 'lust-2', 0, 1);
    place(s, 'greed-2', 1, 1);
    place(s, 'greed-4', 1, 1);
    const acts = getLegalActions(s, 0);
    expect(acts.some((a) => a.kind === 'compile')).toBe(false);
    expect(acts.some((a) => a.kind === 'advance')).toBe(true);
  });

  it('反向核对：P1 = 16（6+10）> P2 = 12（2+10）→ P1 必编译该线', () => {
    const s = setup();
    place(s, 'lust-0', 0, 1);
    place(s, 'pride-6', 0, 1); // 6
    place(s, 'greed-2', 1, 1); // 2
    expect(getLineValue(s, 0, 1)).toBe(16);
    expect(getLineValue(s, 1, 1)).toBe(12);
    expect(canCompileLine(s, 0, 1)).toBe(true);
    const acts = getLegalActions(s, 0);
    expect(acts.some((a) => a.kind === 'compile' && a.line === 1)).toBe(true);
  });

  it('控组件禁编译（lust-0 底：持有控制权者禁用对手编译）只影响行动编译', () => {
    const s = setup();
    place(s, 'lust-0', 0, 1);
    place(s, 'pride-6', 0, 1);
    place(s, 'greed-2', 1, 1);
    s.control = 0; // P1 持有控制 → P2 无法编译
    expect(canCompileLine(s, 1, 1)).toBe(false);
    expect(canCompileLine(s, 0, 1)).toBe(true);
  });
});
