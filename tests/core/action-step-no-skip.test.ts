/**
 * G6 T45 判据 1-4（node 层）：**行动回合不许随手跳过**（用户 2026-09-27 ⑥）。
 *
 * 规则：`step === 'action'` 时，**只要存在 `play` 或 `refresh` 任一合法动作，就不产出 `advance`**；
 * 两者都不存在时才产出（例：手牌 ≥5 张且一条线都打不出、也刷不了牌）。
 * `executeAction(s, player, 'advance')` 同步加守卫：同一条件下抛
 * `MUST_ACT_BEFORE_ADVANCE`（否则会变成"UI 不给按钮、引擎照样放行"）。
 * 其它步骤（`end` / `start` / `check-cache` / `check-compile`）语义**逐条不变**。
 *
 * 这里四条腿全部走**真引擎**（`getLegalActions` + `executeAction`），不读源码找字符串：
 * 判据是"能不能跳过"，只有真跑一遍才算数。
 */
import { describe, it, expect } from 'vitest';
import { createGame, getDraftPool, performDraftPick } from '../../src/core/state/create';
import {
  executeAction,
  executeDevSkip,
  getLegalActions,
  MUST_ACT_BEFORE_ADVANCE,
} from '../../src/core/game';
import type { GameState, Line, Step } from '../../src/core/models/types';
import { makeCard } from '../helpers';

/** 打完草稿、停在 `start` 步（P1 先行动）；与 game.test.ts 的 `draftToTurn` 同口径 */
function draftToTurn(): GameState {
  const s = createGame({ seed: 'g6t45-action-step' });
  while (s.phase === 'draft') performDraftPick(s, getDraftPool(s)[0].defId);
  return s;
}

/** 走到指定步骤：只在"行动步还能出牌/刷新"这一格用**显式旁路**（与本腿要测的东西无关的过路步） */
function skipTo(s: GameState, player: 0 | 1, step: Step): GameState {
  let guard = 0;
  while (s.phase === 'turn' && s.step !== step) {
    if (guard++ > 24) throw new Error(`skipTo(${step}) 没有收敛（现在 ${s.step}）`);
    executeDevSkip(s, player);
  }
  return s;
}

/** P2 三条线全部顶着一张正面 plague-0 ⇒ P1 一条线都打不出（正反都禁，见 restrictions.ts:58） */
function blockAllLinesForP1(s: GameState): void {
  for (const line of [0, 1, 2] as Line[]) {
    s.players[1].stacks[line] = [makeCard('plague-0', 1, 'field', true, line, 0)];
  }
}

const kinds = (s: GameState, player: 0 | 1): string[] => getLegalActions(s, player).map((a) => a.kind);

describe('G6 T45 · 行动步不许跳过（legalActions 与 executeAction 两处同口径）', () => {
  it('① 手牌里有能打的牌 ⇒ 没有 advance，且 executeAction 抛错；出牌后回合照常推进', () => {
    const s = skipTo(draftToTurn(), 0, 'action');
    // 起始手牌 5 张：refresh 不合法（hand < 5 不成立）⇒ 这里的 advance 只可能被"能出牌"挡住
    expect(s.players[0].hand.length, '起始手牌应为 5 张').toBe(5);
    expect(getLegalActions(s, 0).some((a) => a.kind === 'play'), '手牌里必须有能打的牌').toBe(true);
    expect(kinds(s, 0), '能出牌时 legalActions 里不许有 advance').not.toContain('advance');
    expect(() => executeAction(s, 0, 'advance')).toThrow(MUST_ACT_BEFORE_ADVANCE);
    expect(s.step, '被拒的 advance 不许改动状态').toBe('action');

    // 反面打 metal-1（金属协议未注册效果，场上是空的 ⇒ 落子结果确定）→ 回合真的推进
    s.players[0].hand = [makeCard('metal-1', 0, 'hand')];
    const legal = getLegalActions(s, 0);
    expect(kinds(s, 0), '手牌 1 张时 play 与 refresh 都在，advance 仍不在').not.toContain('advance');
    const mv = legal.find((a) => a.kind === 'play');
    expect(mv, 'metal-1 必须至少有一条合法落点').toBeTruthy();
    executeAction(s, 0, 'play', { cardUid: mv!.cardUid!, faceUp: mv!.faceUp!, line: mv!.line! });
    expect(s.step, '出牌后应推进到 check-cache').toBe('check-cache');
  });

  it('② 手牌 <5 且能刷新（一条线都打不出）⇒ 没有 advance，且 executeAction 抛错', () => {
    const s = skipTo(draftToTurn(), 0, 'action');
    blockAllLinesForP1(s);
    s.players[0].hand = s.players[0].hand.slice(0, 3); // 3 张 < 5 ⇒ 能刷新
    expect(kinds(s, 0), 'P2 三线被 plague-0 封死 + 手牌 3 张 ⇒ 只剩 refresh').toEqual(['refresh']);
    expect(() => executeAction(s, 0, 'advance')).toThrow(MUST_ACT_BEFORE_ADVANCE);
    expect(s.step).toBe('action');
    // 刷新是走得通的（这就是"该玩家仍能把回合走完"）
    executeAction(s, 0, 'refresh');
    expect(s.step).toBe('check-cache');
  });

  it('③ 手牌 ≥5 且一张都打不出、也刷不了 ⇒ advance 在且能成功推进', () => {
    const s = skipTo(draftToTurn(), 0, 'action');
    blockAllLinesForP1(s);
    expect(s.players[0].hand.length, '手牌 ≥5 时 refresh 不合法').toBeGreaterThanOrEqual(5);
    expect(kinds(s, 0), '此时 advance 是唯一合法动作').toEqual(['advance']);
    expect(() => executeAction(s, 0, 'advance')).not.toThrow();
    expect(s.step, 'advance 真的推进到 check-cache').toBe('check-cache');
  });

  it('④a 旧语义不变：check-compile 有可编译线 ⇒ 无 advance + 抛错；没有可编译线 ⇒ advance 照旧', () => {
    const s = draftToTurn();
    executeAction(s, 0, 'advance'); // start → check-control
    executeAction(s, 0, 'advance'); // check-control → check-compile
    expect(s.step).toBe('check-compile');
    // metal-1 × 10 = 10 点（金属协议未注册效果 ⇒ 不引入触发干扰）
    s.players[0].stacks[0] = Array.from({ length: 10 }, (_, i) =>
      makeCard('metal-1', 0, 'field', true, 0, i));
    expect(kinds(s, 0)).toContain('compile');
    expect(kinds(s, 0)).not.toContain('advance');
    expect(() => executeAction(s, 0, 'advance')).toThrow(/compile is mandatory/);

    // 对照：可编译线 0 点 ⇒ advance 在且能过（旧语义）
    const s2 = draftToTurn();
    executeAction(s2, 0, 'advance');
    executeAction(s2, 0, 'advance');
    expect(kinds(s2, 0)).toEqual(['advance']);
    executeAction(s2, 0, 'advance');
    expect(s2.step).toBe('action');
  });

  it('④b 旧语义不变：action 手牌为 0 ⇒ 无 advance + 「must refresh」；刷新后推进', () => {
    const s = skipTo(draftToTurn(), 0, 'action');
    s.players[0].hand = [];
    expect(kinds(s, 0), '空手牌时只有刷新').toEqual(['refresh']);
    expect(() => executeAction(s, 0, 'advance')).toThrow(/must refresh/);
    executeAction(s, 0, 'refresh');
    expect(s.step).toBe('check-cache');
  });

  it('④c 旧语义不变：check-cache 手牌 >5 ⇒ 只有 clear-cache + 「must clear cache first」', () => {
    const s = skipTo(draftToTurn(), 0, 'check-cache');
    expect(kinds(s, 0), '手牌 ≤5 时 check-cache 的 advance 照旧在').toEqual(['advance']);
    while (s.players[0].hand.length <= 5) {
      const c = s.players[0].deck.shift();
      if (!c) break;
      s.players[0].hand.push(c);
    }
    expect(s.players[0].hand.length).toBeGreaterThan(5);
    expect(kinds(s, 0), '手牌 >5 时只给 clear-cache').toEqual(['clear-cache']);
    expect(() => executeAction(s, 0, 'advance')).toThrow(/must clear cache first/);
  });

  it('④d 旧语义不变：end 有必选触发 ⇒ 无 advance + 「mandatory trigger」；无触发 ⇒ advance 照旧', () => {
    const s = skipTo(draftToTurn(), 0, 'action');
    const src = makeCard('light-1', 0, 'field', true, 0, 0); // light-1 结束触发为必选
    s.players[0].stacks[0] = [src];
    skipTo(s, 0, 'end');
    expect(s.step).toBe('end');
    expect(getLegalActions(s, 0).some((a) => a.kind === 'resolve-trigger' && a.cardUid === src.uid)).toBe(true);
    expect(kinds(s, 0)).not.toContain('advance');
    expect(() => executeAction(s, 0, 'advance')).toThrow(/mandatory trigger/);

    // 对照：场上没有 end 触发 ⇒ advance 在且能过（旧语义）
    const s2 = skipTo(draftToTurn(), 0, 'end');
    expect(kinds(s2, 0)).toEqual(['advance']);
    executeAction(s2, 0, 'advance');
    expect(s2.turnPlayer, 'end 的 advance 照旧把回合交给对手').toBe(1);
    expect(s2.step).toBe('start');
  });

  it('④e 旧语义不变：start 有必选触发（death-1 顶）⇒ 无 advance + 抛错；无触发 ⇒ start→check-control', () => {
    const s = draftToTurn();
    expect(s.step, '草稿结束停在 start').toBe('start');
    const src = makeCard('death-1', 0, 'field', true, 0, 0); // death-1 开始触发为必选、顶命令
    s.players[0].stacks[0] = [src];
    expect(getLegalActions(s, 0).some((a) => a.kind === 'resolve-trigger' && a.defId === 'death-1')).toBe(true);
    expect(kinds(s, 0)).not.toContain('advance');
    expect(() => executeAction(s, 0, 'advance')).toThrow(/mandatory trigger/);

    // 对照：start 无触发 ⇒ advance 在，且照旧推进到 check-control
    const s2 = draftToTurn();
    expect(kinds(s2, 0)).toEqual(['advance']);
    executeAction(s2, 0, 'advance');
    expect(s2.step).toBe('check-control');
  });
});
