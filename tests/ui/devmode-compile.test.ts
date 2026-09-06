import { describe, it, expect } from 'vitest';
import { createGame } from '../../src/core/state/create';
import { gameBus } from '../../src/core/events/bus';
import { runCommand, resolveProtocolName, type DevModeHost } from '../../src/ui/devmode';
import type { Card, GameState, Line } from '../../src/core/models/types';

/**
 * 开发者模式 `Compile 协议名` 指令（R16）：在当前玩家（state.turnPlayer）回合强制触发
 * 当前场上已存在的该协议的编译效果——无视线值是否 ≥10/是否可编译：
 * - 未编译 → 删双方该线全部卡牌 + 翻协议；已编译 → 重新编译（删牌 + 抽对手牌库顶 1 张
 *   所有权变更），与正式编译同一状态变更/事件路径（line:compiled 照发）；
 * - 协议名解析：defId 前缀（'life'）/ 中文名（'生'）/ 卡牌名回退（'life-1'）；
 * - 协议不在当前玩家场上 / 未知协议 → 记日志、不改变状态、不渲染（指令页保持打开）；
 * - 大小写不敏感 + trim。
 */

function makeHost(state: GameState): { host: DevModeHost; renderCalls: () => number } {
  let renders = 0;
  return {
    host: { getState: () => state, render: () => { renders += 1; } },
    renderCalls: () => renders,
  };
}

/** 构造 turn 阶段状态：P1 协议 line0 = life（可指定已编译），双方 line0 各 2 张
 *  life-1 卡（线值 2，远低于 10 → 正式规则不可编译，验证指令强制编译）。 */
function makeState(opts: { lifeCompiled?: boolean } = {}): GameState {
  const state = createGame();
  state.phase = 'turn';
  state.turnPlayer = 0;
  state.step = 'action';
  state.players[0].protocols = [
    { defId: 'life', compiled: opts.lifeCompiled ?? false },
    { defId: 'fire', compiled: false },
    { defId: 'water', compiled: false },
  ];
  state.players[1].protocols = [
    { defId: 'light', compiled: false },
    { defId: 'darkness', compiled: false },
    { defId: 'spirit', compiled: false },
  ];
  const mk = (owner: 0 | 1, line: Line): Card[] =>
    Array.from({ length: 2 }, (_, i) => ({
      uid: `${owner}-${line}-${i}`,
      defId: 'life-1',
      owner,
      faceUp: true,
      zone: 'field' as const,
      line,
      pos: i,
    }));
  state.players[0].stacks[0] = mk(0, 0);
  state.players[1].stacks[0] = mk(1, 0);
  return state;
}

describe('resolveProtocolName', () => {
  it("resolves 'life' / '生' / 'LIFE' / 'life-1' all to the life protocol", () => {
    for (const input of ['life', '生', 'LIFE', 'life-1', ' 生 ']) {
      expect(resolveProtocolName(input)?.defId).toBe('life');
    }
  });

  it("resolves 'water-0' (card name fallback) to water", () => {
    expect(resolveProtocolName('water-0')?.defId).toBe('water');
  });

  it("returns null for '不存在' and ''", () => {
    expect(resolveProtocolName('不存在')).toBeNull();
    expect(resolveProtocolName('')).toBeNull();
  });
});

describe('devmode Compile command', () => {
  it('forces compile of the current player life protocol on a low-value line (cards deleted, protocol flipped)', () => {
    const state = makeState();
    const { host, renderCalls } = makeHost(state);

    const events: string[] = [];
    const unsub = gameBus.subscribe((e) => events.push(e.type));
    try {
      runCommand(host, 'compile life');
    } finally {
      unsub();
    }

    // 线值 2 < 10 → 正式规则不可编译；指令强制编译成功
    expect(state.players[0].protocols[0].compiled).toBe(true);
    expect(state.players[0].stacks[0]).toHaveLength(0);
    expect(state.players[1].stacks[0]).toHaveLength(0);
    expect(state.players[0].trash).toHaveLength(2);
    expect(state.players[1].trash).toHaveLength(2);
    expect(state.compiledThisTurn).toBe(true);
    // 引擎事件路径一致：line:compiled 照发（编译清牌 FX 正常播放）
    expect(events).toContain('line:compiled');
    expect(renderCalls()).toBe(1);
    expect(state.log.join(' ')).toContain('已强制编译 P1 的 life（line 1）');
  });

  it('is case-insensitive and accepts the Chinese protocol name', () => {
    const state = makeState();
    const { host } = makeHost(state);
    runCommand(host, '  COMPILE 生 ');
    expect(state.players[0].protocols[0].compiled).toBe(true);
    expect(state.players[0].stacks[0]).toHaveLength(0);
    expect(state.log.join(' ')).toContain('已强制编译 P1 的 life（line 1）');
  });

  it('recompiles an already-compiled protocol: deletes line cards and steals opponent deck top', () => {
    const state = makeState({ lifeCompiled: true });
    state.players[1].deck.push({
      uid: 'd1', defId: 'fire-1', owner: 1, faceUp: false, zone: 'deck', line: null, pos: null, secret: true,
    });
    const { host } = makeHost(state);
    runCommand(host, 'compile life');
    expect(state.players[0].protocols[0].compiled).toBe(true);
    expect(state.players[0].stacks[0]).toHaveLength(0);
    expect(state.players[1].stacks[0]).toHaveLength(0);
    expect(state.players[1].deck).toHaveLength(0);
    expect(state.players[0].hand).toHaveLength(1);
    expect(state.players[0].hand[0].uid).toBe('d1');
    expect(state.players[0].hand[0].owner).toBe(0);
    expect(state.players[0].hand[0].secret).toBeFalsy(); // 夺取进手即解禁
    expect(state.log.join(' ')).toContain('已强制编译 P1 的 life（line 1）');
  });

  it('logs an error and keeps the page open for an unknown protocol (no crash, no state change)', () => {
    const state = makeState();
    const { host, renderCalls } = makeHost(state);
    runCommand(host, 'compile 不存在');
    expect(state.players[0].protocols[0].compiled).toBe(false);
    expect(state.players[0].stacks[0]).toHaveLength(2);
    expect(renderCalls()).toBe(0);
    expect(state.log.join(' ')).toContain('未找到协议: 不存在');
  });

  it('logs an error when the protocol is not among the current player protocols', () => {
    const state = makeState();
    const { host, renderCalls } = makeHost(state);
    runCommand(host, 'compile light'); // P1 场上没有 light
    expect(state.log.join(' ')).toContain('P1 场上没有协议 light（明光）');
    expect(state.players[0].protocols[0].compiled).toBe(false);
    expect(state.players[0].stacks[0]).toHaveLength(2);
    expect(renderCalls()).toBe(0);
  });
});
