import { describe, it, expect } from 'vitest';
import { snapshotState, formatDiagnosticLog, type ConsoleEntry, type ErrorEntry } from '../src/ui/diag';
import { draftFireP1 } from './helpers';

describe('diag log formatting', () => {
  it('snapshotState summarizes phase/step/turn/control and per-player counts', () => {
    const s = draftFireP1();
    s.step = 'action';
    s.turnPlayer = 0;
    s.control = 1;
    s.players[0].hand = [];
    const text = snapshotState(s);
    expect(text).toContain('phase=turn');
    expect(text).toContain('step=action');
    expect(text).toContain('turnPlayer=0');
    expect(text).toContain('control=1');
    expect(text).toContain('P1: 手牌=0');
    expect(text).toContain('牌库=');
    expect(text).toContain('弃牌堆=0');
    expect(text).toContain('协议=[fire,darkness,life]');
  });

  it('snapshotState includes pendingEffects prompt and in-flight play/shift', () => {
    const s = draftFireP1();
    s.pendingEffects.push({
      id: 'e1', player: 0, gen: undefined as never, sourceUid: 'x', sourceDefId: 'fire-1',
      prompt: { kind: 'select', title: 'fire-1：弃1张牌', min: 1, max: 1, optional: false, candidates: [] },
      lastAnswer: null,
    });
    const text = snapshotState(s);
    expect(text).toContain('挂起选择=1');
    expect(text).toContain('fire-1：弃1张牌');
    expect(text).toContain('落牌中=无');
  });

  it('formatDiagnosticLog includes console entries, errors, full s.log, trace and detailed snapshot', () => {
    const s = draftFireP1();
    s.log.push('P1 plays fire-5');
    const entries: ConsoleEntry[] = [
      { time: 't1', level: 'log', text: 'hello' },
      { time: 't2', level: 'error', text: 'boom' },
    ];
    const errors: ErrorEntry[] = [{ time: 't3', type: 'error', message: 'boom', stack: 'at x' }];
    const text = formatDiagnosticLog(s, entries, errors);
    expect(text).toContain('===== Compile 诊断日志 =====');
    expect(text).toContain('---- 环境信息 ----');
    expect(text).toContain('[log] t1 hello');
    expect(text).toContain('[error] t2 boom');
    expect(text).toContain('[error] t3 boom');
    expect(text).toContain('at x');
    // 游戏日志树：全部条目（不再只导尾部）
    expect(text).toContain('---- 游戏日志树（全部');
    expect(text).toContain('P1 plays fire-5');
    // 全量追踪流水段（2026-09-12 新增）
    expect(text).toContain('---- 全量追踪流水');
    // 详细状态快照（含逐张卡牌/效果栈/线值）
    expect(text).toContain('---- 详细状态快照 ----');
    expect(text).toContain('phase=turn');
    expect(text).toContain('线1（总值');
  });

  it('handles empty logs gracefully', () => {
    const s = draftFireP1();
    const text = formatDiagnosticLog(s, [], []);
    expect(text).toContain('（无）');
  });
});
