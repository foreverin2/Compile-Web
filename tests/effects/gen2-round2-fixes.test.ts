import { describe, it, expect } from 'vitest';
import type { ChoiceRequest, GameState, Line, PlayerId } from '../../src/core/models/types';
import { createGame, stackValue } from '../../src/core/state/create';
import { pushMiddle, runStack, answerEffect } from '../../src/core/effects/resolve';
import { collectTriggers, collectTriggerFor, resolveTrigger } from '../../src/core/effects/triggers';
import { makeCard, resolveAllChoices } from '../helpers';

/**
 * 二代特效二次修复（2026-09-12）附带的引擎回归测试：
 *  1. courage-3 底：可选偏转的候选线必须排除此牌当前所在线（否则 resolve 抛
 *     "must shift to a different line" → 整局卡死，见 log/break_log/compile-log-2026-09-11）
 *  2. unity-0 底（before-covered）：覆盖者可能来自【偏转】队列（pendingShift），不只看 pendingPlay
 *  3. unity-1 中：5 张门槛只算【正面朝上】的联合卡（含被覆盖）
 *  4. diversity-6 顶：协议种类计数只算【正面朝上】的卡（含被覆盖）
 *  5. drawFromDeck：目标卡已不在牌库时不再抛错中断整局（联合4 同类风险的稳健性）
 */

function setup(): GameState {
  const s = createGame();
  for (const pid of [0, 1] as PlayerId[]) {
    s.players[pid].protocols = [
      { defId: 'courage', compiled: false },
      { defId: 'unity', compiled: false },
      { defId: 'diversity', compiled: false },
    ];
  }
  s.phase = 'turn';
  s.turnPlayer = 0;
  return s;
}

function place(s: GameState, defId: string, owner: PlayerId, line: Line, faceUp = true) {
  const c = makeCard(defId, owner, 'field', faceUp, line, s.players[owner].stacks[line].length);
  s.players[owner].stacks[line].push(c);
  return c;
}

function promptOf(s: GameState): ChoiceRequest | undefined {
  return s.pendingEffects[s.pendingEffects.length - 1]?.prompt ?? undefined;
}

function endTriggerOf(s: GameState, uid: string) {
  return collectTriggers(s, 'end').find((x) => x.cardUid === uid);
}

// ============ 1. courage-3 ============
describe('courage-3 end (2026-09-12 崩溃修复)', () => {
  it('唯一最大线 = 此牌所在线 → 无候选、不挂起、不抛错', () => {
    const s = setup();
    const c3 = place(s, 'courage-3', 0, 1); // P1 线2（3 值）
    place(s, 'courage-6', 1, 1); // P2 线2（6 值）→ 对手唯一最大线 = 线2 = 自己所在线
    const t = endTriggerOf(s, c3.uid);
    expect(t).toBeTruthy();
    resolveTrigger(s, t!);
    expect(() => runStack(s)).not.toThrow();
    expect(s.pendingEffects.length).toBe(0); // select-line 无候选 → fizzle
    expect(s.players[0].stacks[1].some((c) => c.uid === c3.uid)).toBe(true);
  });

  it('对手多条最大线时可选，且候选中永不含当前线，选线不抛错', () => {
    const s = setup();
    const c3 = place(s, 'courage-3', 0, 1);
    place(s, 'courage-3', 1, 0); // P2 线1 = 3
    place(s, 'courage-3', 1, 2); // P2 线3 = 3
    const t = endTriggerOf(s, c3.uid);
    resolveTrigger(s, t!);
    runStack(s);
    const p = promptOf(s);
    expect(p?.kind).toBe('select-line');
    expect(p?.lines ?? []).not.toContain(1);
    const line = (p!.lines ?? [])[0]!;
    const pe = s.pendingEffects[s.pendingEffects.length - 1];
    expect(() => answerEffect(s, pe.id, [`line:${line}`])).not.toThrow();
    expect(() => runStack(s)).not.toThrow();
  });
});

// ============ 2. unity-0 底 ============
describe('unity-0 bottom before-covered (2026-09-12 偏转覆盖修复)', () => {
  it('联合1 偏转（pendingShift）盖住联合0 → 联合0 底部效果照常触发', () => {
    const s = setup();
    const u0 = place(s, 'unity-0', 0, 0);
    const u1 = makeCard('unity-1', 0, 'float', true, 0);
    s.pendingShift.push({ card: u1, beforeCoveredDone: false }); // 模拟 shift op 已入队
    const t = collectTriggerFor(s, u0, 'before-covered');
    expect(t).toBeTruthy();
    resolveTrigger(s, t!);
    runStack(s);
    const p = promptOf(s);
    expect(p?.kind).toBe('select-action'); // 翻转或抽取1张
    expect(p?.actions).toContain('action:flip');
  });

  it('反例：覆盖者不是联合牌（pendingShift 中为 courage-0）→ 不触发', () => {
    const s = setup();
    const u0 = place(s, 'unity-0', 0, 0);
    const other = makeCard('courage-0', 0, 'float', true, 0);
    s.pendingShift.push({ card: other, beforeCoveredDone: false });
    // 触发收集本身存在（unity-0 底无 cond），但 gen 内守卫应直接结束（无挂起）
    const t = collectTriggerFor(s, u0, 'before-covered');
    resolveTrigger(s, t!);
    runStack(s);
    expect(s.pendingEffects.length).toBe(0);
  });
});

// ============ 3. unity-1 门槛 ============
describe('unity-1 middle 5-card gate (2026-09-12 只算正面卡)', () => {
  it('3 张正面 + 2 张反面（+ 自身）= 4 张正面 → 不满足 5 张（反面不计）', () => {
    const s = setup();
    for (let i = 0; i < 3; i++) place(s, 'unity-2', 0, (i % 3) as Line, true);
    place(s, 'unity-2', 1, 0, false);
    place(s, 'unity-2', 1, 1, false);
    const u1 = place(s, 'unity-1', 0, 2, true);
    pushMiddle(s, 0, u1, '打出');
    runStack(s);
    expect(s.pendingEffects.length).toBe(0); // 门槛未达成 → 无挂起
    expect(s.players[0].protocols[1].compiled).toBe(false);
  });

  it('5 张正面（含被覆盖）→ 满足门槛并编译联合协议', () => {
    const s = setup();
    const covered = place(s, 'unity-2', 0, 0, true);
    place(s, 'unity-3', 0, 0, true); // 盖住上一张（被覆盖仍算）
    place(s, 'unity-2', 1, 1, true);
    place(s, 'unity-3', 1, 2, true);
    place(s, 'unity-2', 0, 2, true);
    expect(covered.pos).toBe(0);
    const u1 = place(s, 'unity-1', 0, 1, true);
    pushMiddle(s, 0, u1, '打出');
    runStack(s);
    resolveAllChoices(s, (p) => (p.kind === 'select-line' ? [`line:${p.lines?.[0] ?? 0}`] : []));
    runStack(s);
    expect(s.players[0].protocols[1].compiled).toBe(true);
  });
});

// ============ 4. diversity-6 计数 ============
describe('diversity-6 end count (2026-09-12 只算正面卡)', () => {
  it('正面协议种类不足 3（反面牌不计；含自身多元）= 2 种 → 自删', () => {
    const s = setup();
    s.turnPlayer = 1;
    place(s, 'fire-0', 0, 0, true);
    place(s, 'light-0', 0, 1, false); // 反面：不计
    place(s, 'water-0', 0, 2, false); // 反面：不计
    const d6 = place(s, 'diversity-6', 1, 2, true);
    // 正面协议 = {fire, diversity} = 2 < 3 → 触发自删
    const t = endTriggerOf(s, d6.uid);
    expect(t).toBeTruthy();
    resolveTrigger(s, t!);
    runStack(s);
    expect(s.players[1].stacks.flat().some((c) => c.uid === d6.uid)).toBe(false); // 已删除
  });

  it('3 种协议全为正面（含被覆盖）→ 不自删（cond 不收集）', () => {
    const s = setup();
    s.turnPlayer = 1;
    place(s, 'fire-0', 0, 0, true);
    place(s, 'light-0', 0, 0, true); // 盖住 fire-0（被覆盖但正面 → 仍计）
    place(s, 'water-0', 0, 1, true);
    const d6 = place(s, 'diversity-6', 1, 2, true);
    expect(endTriggerOf(s, d6.uid)).toBeUndefined();
    expect(s.players[1].stacks.flat().some((c) => c.uid === d6.uid)).toBe(true);
  });
});

// ============ 5. drawFromDeck 稳健性 ============
describe('drawFromDeck robustness (2026-09-12 不再抛错中断整局)', () => {
  it('目标 uid 不在牌库 → 记录日志并跳过（不抛错）', () => {
    const s = setup();
    s.players[0].deck = [makeCard('fire-0', 0, 'deck', false)];
    s.pendingEffects.push({
      id: 'e-dfd',
      player: 0,
      gen: (function* (): Generator<unknown, void, unknown> {
        yield { op: 'drawFromDeck', uid: 'ghost-uid' };
      })() as never,
      sourceUid: 'system-dfd',
      sourceDefId: 'unity-4',
      system: true,
      prompt: null,
      lastAnswer: null,
    });
    expect(() => runStack(s)).not.toThrow();
    expect(s.players[0].hand).toHaveLength(0);
    expect(s.log.join(' ')).toContain('已不在牌库');
  });

  it('回归：stackValue 仍按正面卡计算（口径改动不影响估值）', () => {
    const s = setup();
    place(s, 'fire-0', 0, 0, true); // 0 值
    place(s, 'light-0', 0, 0, false); // 反面 = 2
    expect(stackValue(s, 0, 0)).toBe(2);
  });
});
