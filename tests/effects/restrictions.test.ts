import { describe, it, expect } from 'vitest';
import type { Card, GameState, Line, PlayerId, Step } from '../../src/core/models/types';
import { createGame } from '../../src/core/state/create';
import { getCompilableLines } from '../../src/core/rules/compile';
import { runStack } from '../../src/core/effects/resolve';
import { executeAction, getLegalActions } from '../../src/core/game';
import {
  playerHasActiveBottom,
  playerHasTopCommand,
} from '../../src/core/rules/restrictions';
import { makeCard } from '../helpers';

/** 回合场景：phase=turn、指定回合玩家与步骤；双方协议不含 fire（fire-0 默认作"不匹配"手牌卡） */
function setupTurn(turnPlayer: PlayerId = 0, step: Step = 'action'): GameState {
  const s = createGame();
  s.phase = 'turn';
  s.turnPlayer = turnPlayer;
  s.step = step;
  s.players[0].protocols = [
    { defId: 'death', compiled: false },
    { defId: 'spirit', compiled: false },
    { defId: 'gravity', compiled: false },
  ];
  s.players[1].protocols = [
    { defId: 'water', compiled: false },
    { defId: 'light', compiled: false },
    { defId: 'darkness', compiled: false },
  ];
  return s;
}

/** 原始放卡（不触发任何事件/效果），faceUp=true */
function place(s: GameState, card: Card, owner: PlayerId, line: Line): void {
  card.zone = 'field';
  card.faceUp = true;
  card.line = line;
  card.pos = s.players[owner].stacks[line].length;
  s.players[owner].stacks[line].push(card);
}

/** 原始放卡（faceUp=false） */
function placeFaceDown(s: GameState, card: Card, owner: PlayerId, line: Line): void {
  place(s, card, owner, line);
  card.faceUp = false;
}

/** 当前玩家在该线是否有（faceUp 指定的）play 合法行动 */
function hasPlay(s: GameState, player: PlayerId, line: Line, faceUp: boolean): boolean {
  return getLegalActions(s, player).some(
    (a) => a.kind === 'play' && a.line === line && a.faceUp === faceUp,
  );
}

/** 手动推一个 system 效果（跳过 sourceValid 源卡校验）执行单个 op */
function pushOpGen(s: GameState, player: PlayerId, gen: () => Generator<unknown, void, unknown>): void {
  s.pendingEffects.push({
    id: `t-${s.pendingEffects.length}-${Math.random().toString(36).slice(2)}`,
    player,
    gen: gen() as never,
    sourceUid: 't-source',
    sourceDefId: 't-system',
    system: true,
    prompt: null,
    lastAnswer: null,
  });
}

// ============ 查询原语 ============

describe('restriction query primitives', () => {
  it('playerHasTopCommand detects any face-up card in any stack, incl. covered; face-down not counted', () => {
    const s = createGame();
    place(s, makeCard('spirit-1', 0, 'field', true, 0, 0), 0, 0);
    place(s, makeCard('death-0', 0, 'field', true, 0, 1), 0, 0); // 盖住 spirit-1
    expect(playerHasTopCommand(s, 0, 'spirit-1')).toBe(true); // 被盖仍计数
    expect(playerHasTopCommand(s, 1, 'spirit-1')).toBe(false);
    placeFaceDown(s, makeCard('psychic-1', 1, 'field', false, 2, 0), 1, 2);
    expect(playerHasTopCommand(s, 1, 'psychic-1')).toBe(false); // 反面不生效
  });

  it('playerHasActiveBottom requires the card to be the stack top (uncovered)', () => {
    const s = createGame();
    place(s, makeCard('spirit-0', 0, 'field', true, 0, 0), 0, 0);
    place(s, makeCard('death-0', 0, 'field', true, 0, 1), 0, 0); // 盖住 → 非顶卡
    expect(playerHasActiveBottom(s, 0, 'spirit-0')).toBe(false);
    const s2 = createGame();
    place(s2, makeCard('spirit-0', 0, 'field', true, 0, 0), 0, 0); // 顶卡
    expect(playerHasActiveBottom(s2, 0, 'spirit-0')).toBe(true);
  });
});

// ============ spirit-1 顶：任意列正面打 ============

describe('spirit-1 top: play face-up anywhere', () => {
  it('holder can face-up play to ANY line (protocol mismatch otherwise blocks)', () => {
    const s = setupTurn(0);
    s.players[0].hand = [makeCard('fire-0', 0, 'hand')]; // fire 不匹配 P0 任何线协议
    expect(hasPlay(s, 0, 0, true)).toBe(false); // 无 spirit-1：不可正面打
    place(s, makeCard('spirit-1', 0, 'field', true, 0, 0), 0, 0);
    for (const line of [0, 1, 2] as Line[]) {
      expect(hasPlay(s, 0, line, true)).toBe(true);
    }
    expect(hasPlay(s, 0, 0, false)).toBe(true); // 反面打不受影响
  });

  it('still works when covered (two cards on top)', () => {
    const s = setupTurn(0);
    s.players[0].hand = [makeCard('fire-0', 0, 'hand')];
    place(s, makeCard('spirit-1', 0, 'field', true, 0, 0), 0, 0);
    place(s, makeCard('death-0', 0, 'field', true, 0, 1), 0, 0);
    place(s, makeCard('death-1', 0, 'field', true, 0, 2), 0, 0); // 两张盖住
    for (const line of [0, 1, 2] as Line[]) {
      expect(hasPlay(s, 0, line, true)).toBe(true);
    }
  });
});

// ============ psychic-1 顶：对手只能反面打 ============

describe('psychic-1 top: opponent plays face-down only', () => {
  it('opponent (non-holder) loses ALL faceUp plays, keeps faceDown; holder unaffected', () => {
    const s = setupTurn(0);
    s.players[0].protocols = [
      { defId: 'fire', compiled: false },
      { defId: 'light', compiled: false },
      { defId: 'darkness', compiled: false },
    ];
    s.players[0].hand = [makeCard('fire-0', 0, 'hand')]; // 匹配线 0（无 psychic-1 时可正面打）
    expect(hasPlay(s, 0, 0, true)).toBe(true);
    place(s, makeCard('psychic-1', 1, 'field', true, 1, 0), 1, 1);
    for (const line of [0, 1, 2] as Line[]) {
      expect(hasPlay(s, 0, line, true)).toBe(false); // 所有线 faceUp 全禁
      expect(hasPlay(s, 0, line, false)).toBe(true); // faceDown 仍在
    }
    // 持有者自己不受限
    const s2 = setupTurn(1);
    s2.players[1].protocols = [
      { defId: 'death', compiled: false },
      { defId: 'spirit', compiled: false },
      { defId: 'gravity', compiled: false },
    ];
    s2.players[1].hand = [makeCard('death-0', 1, 'hand')]; // 匹配线 0
    place(s2, makeCard('psychic-1', 1, 'field', true, 1, 0), 1, 1);
    expect(hasPlay(s2, 1, 0, true)).toBe(true);
  });

  it('still works when covered (top command persists)', () => {
    const s = setupTurn(0);
    s.players[0].protocols = [
      { defId: 'fire', compiled: false },
      { defId: 'light', compiled: false },
      { defId: 'darkness', compiled: false },
    ];
    s.players[0].hand = [makeCard('fire-0', 0, 'hand')];
    place(s, makeCard('psychic-1', 1, 'field', true, 1, 0), 1, 1);
    place(s, makeCard('water-0', 1, 'field', true, 1, 1), 1, 1); // 盖住 psychic-1
    for (const line of [0, 1, 2] as Line[]) {
      expect(hasPlay(s, 0, line, true)).toBe(false);
    }
  });
});

// ============ plague-0 底：对手此列禁打 ============

describe('plague-0 bottom: opponent cannot play into the line', () => {
  it('blocks the line entirely (faceUp AND faceDown); other lines normal; uncovered-only', () => {
    const s = setupTurn(0);
    s.players[0].protocols = [
      { defId: 'fire', compiled: false },
      { defId: 'light', compiled: false },
      { defId: 'darkness', compiled: false },
    ];
    s.players[0].hand = [makeCard('fire-0', 0, 'hand'), makeCard('light-0', 0, 'hand')];
    place(s, makeCard('plague-0', 1, 'field', true, 1, 0), 1, 1); // P1 线 1 顶卡（底命令激活）
    expect(hasPlay(s, 0, 1, true)).toBe(false); // faceUp 禁
    expect(hasPlay(s, 0, 1, false)).toBe(false); // faceDown 也禁
    expect(hasPlay(s, 0, 0, true)).toBe(true); // 其他线正常
    expect(hasPlay(s, 0, 0, false)).toBe(true);
    // 被盖（非顶卡）→ 底命令失效 → 该线解禁
    place(s, makeCard('water-0', 1, 'field', true, 1, 1), 1, 1); // 盖住 plague-0
    expect(hasPlay(s, 0, 1, false)).toBe(true); // faceDown 恢复
  });
});

// ============ metal-2 顶：对手此列不能反面打 ============

describe('metal-2 top: opponent cannot play face-down into the line', () => {
  it('blocks faceDown only; matching faceUp stays; other lines normal; covered persists', () => {
    const s = setupTurn(0);
    s.players[0].protocols = [
      { defId: 'fire', compiled: false },
      { defId: 'light', compiled: false },
      { defId: 'darkness', compiled: false },
    ];
    s.players[0].hand = [makeCard('fire-0', 0, 'hand'), makeCard('light-0', 0, 'hand')];
    place(s, makeCard('metal-2', 1, 'field', true, 1, 0), 1, 1);
    expect(hasPlay(s, 0, 1, false)).toBe(false); // faceDown 禁
    expect(hasPlay(s, 0, 1, true)).toBe(true); // light-0 匹配线 1 → faceUp 仍在
    expect(hasPlay(s, 0, 0, false)).toBe(true); // 其他线正常
    // 被盖仍生效（顶命令常驻）
    place(s, makeCard('water-0', 1, 'field', true, 1, 1), 1, 1); // 盖住 metal-2
    expect(hasPlay(s, 0, 1, false)).toBe(false);
    expect(hasPlay(s, 0, 1, true)).toBe(true);
  });
});

// ============ apathy-2 顶：无效化该线中指令 ============

describe('apathy-2 top: nullifies middle commands on the line', () => {
  it('flip face-up on the line does NOT push middle (uncovered flip)', () => {
    const s = createGame();
    s.phase = 'turn';
    place(s, makeCard('apathy-2', 0, 'field', true, 0, 0), 0, 0);
    const life1 = makeCard('life-1', 0, 'field', false, 0, 1);
    placeFaceDown(s, life1, 0, 0); // life-1 反面顶卡
    pushOpGen(s, 0, function* () {
      yield { op: 'flip', uid: life1.uid };
    });
    runStack(s);
    expect(s.pendingEffects).toHaveLength(0); // 中指令被跳过
    expect(life1.faceUp).toBe(true);
  });

  it('covered card flipped with allowCovered also does NOT push middle', () => {
    const s = createGame();
    s.phase = 'turn';
    const life1 = makeCard('life-1', 0, 'field', false, 0, 0);
    placeFaceDown(s, life1, 0, 0); // 底层（反面）
    place(s, makeCard('apathy-2', 0, 'field', true, 0, 1), 0, 0); // 顶卡盖住 life-1
    pushOpGen(s, 0, function* () {
      yield { op: 'flip', uid: life1.uid, allowCovered: true };
    });
    runStack(s);
    expect(s.pendingEffects).toHaveLength(0);
    expect(life1.faceUp).toBe(true);
  });

  it('flip on another line still triggers the middle chain (control)', () => {
    const s = createGame();
    s.phase = 'turn';
    place(s, makeCard('apathy-2', 0, 'field', true, 1, 0), 0, 1); // apathy-2 在【线 1】
    const life1 = makeCard('life-1', 0, 'field', false, 0, 0);
    placeFaceDown(s, life1, 0, 0); // life-1 在【线 0】→ 不受影响
    pushOpGen(s, 0, function* () {
      yield { op: 'flip', uid: life1.uid };
    });
    runStack(s);
    const top = s.pendingEffects[s.pendingEffects.length - 1];
    expect(top).toBeDefined();
    expect(top.sourceDefId).toBe('life-1'); // 中指令已入栈
    expect(top.prompt?.kind).toBe('select'); // 挂起选择（life-1 翻转目标）
  });
});

// ============ spirit-0 底：跳过检查缓存阶段 ============

describe('spirit-0 bottom: skip check-cache', () => {
  it('hand > 5 offers advance (not forced clear-cache); advance keeps the hand', () => {
    const s = setupTurn(0, 'check-cache');
    place(s, makeCard('spirit-0', 0, 'field', true, 0, 0), 0, 0); // 顶卡（底命令激活）
    s.players[0].hand = Array.from({ length: 6 }, (_, i) => makeCard('death-0', 0, 'hand'));
    const actions = getLegalActions(s, 0);
    expect(actions.some((a) => a.kind === 'advance')).toBe(true);
    expect(actions.some((a) => a.kind === 'clear-cache')).toBe(false);
    executeAction(s, 0, 'advance');
    expect(s.players[0].hand).toHaveLength(6); // 未强制清缓存
    expect(s.step).toBe('end');
  });

  it('covered spirit-0 restores the forced clear-cache', () => {
    const s = setupTurn(0, 'check-cache');
    place(s, makeCard('spirit-0', 0, 'field', true, 0, 0), 0, 0);
    place(s, makeCard('water-0', 0, 'field', true, 0, 1), 0, 0); // 盖住 → 底命令失效
    s.players[0].hand = Array.from({ length: 6 }, (_, i) => makeCard('death-0', 0, 'hand'));
    const actions = getLegalActions(s, 0);
    expect(actions.some((a) => a.kind === 'clear-cache')).toBe(true);
    expect(actions.some((a) => a.kind === 'advance')).toBe(false);
    expect(() => executeAction(s, 0, 'advance')).toThrow('must clear cache first');
  });
});

// ============ metal-1：compileBlocked ============

describe('metal-1 semantics: compileBlocked', () => {
  it('blocked player cannot compile (empty compilable lines, executeAction throws)', () => {
    const s = setupTurn(1, 'check-compile');
    s.players[1].protocols = [
      { defId: 'death', compiled: false },
      { defId: 'spirit', compiled: false },
      { defId: 'gravity', compiled: false },
    ];
    for (let i = 0; i < 10; i++) place(s, makeCard('spirit-1', 1, 'field', true, 0, i), 1, 0);
    place(s, makeCard('death-0', 0, 'field', true, 0, 0), 0, 0);
    s.compileBlocked = 1;
    expect(getCompilableLines(s, 1)).toEqual([]);
    expect(() => executeAction(s, 1, 'compile', { line: 0 })).toThrow();
    s.compileBlocked = null; // 解除后恢复
    expect(getCompilableLines(s, 1)).toEqual([0]);
  });

  it('non-blocked player is unaffected', () => {
    const s = setupTurn(0, 'check-compile');
    s.players[0].protocols = [
      { defId: 'death', compiled: false },
      { defId: 'spirit', compiled: false },
      { defId: 'gravity', compiled: false },
    ];
    for (let i = 0; i < 10; i++) place(s, makeCard('spirit-1', 0, 'field', true, 0, i), 0, 0);
    place(s, makeCard('death-0', 1, 'field', true, 0, 0), 1, 0);
    s.compileBlocked = 1; // 禁的是 P1
    expect(getCompilableLines(s, 0)).toEqual([0]);
  });

  it('cleared when the BLOCKED player turn ends (end → start transition)', () => {
    const s = setupTurn(1, 'end');
    s.compileBlocked = 1;
    executeAction(s, 1, 'advance');
    expect(s.compileBlocked).toBeNull();
    expect(s.turnPlayer).toBe(0);
  });

  it('persists through the turn transition INTO the blocked player turn', () => {
    // P0 回合结束 → P1（被禁）回合开始：compileBlocked 仍生效
    const s = setupTurn(0, 'end');
    s.compileBlocked = 1;
    executeAction(s, 0, 'advance');
    expect(s.compileBlocked).toBe(1);
    expect(s.turnPlayer).toBe(1);
  });
});

// ============ 组合 ============

describe('combination restrictions', () => {
  it('psychic-1 + spirit-1: opponent faceUp fully banned (psychic-1 wins)', () => {
    const s = setupTurn(0);
    s.players[0].protocols = [
      { defId: 'fire', compiled: false },
      { defId: 'light', compiled: false },
      { defId: 'darkness', compiled: false },
    ];
    s.players[0].hand = [makeCard('fire-0', 0, 'hand')];
    place(s, makeCard('spirit-1', 0, 'field', true, 0, 0), 0, 0); // P0 可任意线正面打
    place(s, makeCard('psychic-1', 1, 'field', true, 1, 0), 1, 1); // P1 禁对手正面打
    for (const line of [0, 1, 2] as Line[]) {
      expect(hasPlay(s, 0, line, true)).toBe(false); // psychic-1 优先
      expect(hasPlay(s, 0, line, false)).toBe(true);
    }
  });

  it('plague-0 + metal-2 stacked: the line is completely unplayable', () => {
    const s = setupTurn(0);
    s.players[0].protocols = [
      { defId: 'fire', compiled: false },
      { defId: 'light', compiled: false },
      { defId: 'darkness', compiled: false },
    ];
    s.players[0].hand = [makeCard('fire-0', 0, 'hand'), makeCard('light-0', 0, 'hand')];
    place(s, makeCard('metal-2', 1, 'field', true, 1, 0), 1, 1); // 顶命令（被盖仍生效）
    place(s, makeCard('plague-0', 1, 'field', true, 1, 1), 1, 1); // 顶卡：底命令激活
    expect(hasPlay(s, 0, 1, true)).toBe(false);
    expect(hasPlay(s, 0, 1, false)).toBe(false);
    expect(hasPlay(s, 0, 0, true)).toBe(true); // 其他线正常
    expect(hasPlay(s, 0, 0, false)).toBe(true);
  });
});
