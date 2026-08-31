import { describe, it, expect } from 'vitest';
import { createGame } from '../../src/core/state/create';
import { gameBus } from '../../src/core/events/bus';
import { runCommand, type DevModeHost } from '../../src/ui/devmode';
import type { Card, GameState } from '../../src/core/models/types';

/**
 * 开发者模式 `clean` 指令（R15）：直接清空当前玩家（state.turnPlayer）全部手牌到弃牌堆。
 * - 纯状态操作：不经 executeAction / discard op → 不触发任何引擎事件（card:discarded 等）
 *   / 卡牌效果 / FX；
 * - 落牌与 discard op 一致：zone='trash'、faceUp=true、line=null、pos=null，并清除 secret；
 * - 大小写不敏感 + trim；执行后调用 host.render() 并写入日志，指令页保持打开。
 */

function makeHost(state: GameState): { host: DevModeHost; renderCalls: () => number } {
  let renders = 0;
  return {
    host: { getState: () => state, render: () => { renders += 1; } },
    renderCalls: () => renders,
  };
}

function handCard(uid: string, defId: string, secret?: boolean): Card {
  return { uid, defId, owner: 0, faceUp: true, zone: 'hand', line: null, pos: null, ...(secret ? { secret: true } : {}) };
}

describe('devmode clean command', () => {
  it('moves the whole current-player hand into trash with discard-op-compatible fields, no effects', () => {
    const state = createGame();
    state.players[0].hand.push(handCard('h1', 'fire-1', true), handCard('h2', 'water-2'), handCard('h3', 'life-0'));
    const { host, renderCalls } = makeHost(state);

    const events: string[] = [];
    const unsub = gameBus.subscribe((e) => events.push(e.type));
    try {
      runCommand(host, 'clean');
    } finally {
      unsub();
    }

    // 手牌清空、弃牌堆收到同一批卡牌对象（引用不变，仅 zone 等字段改写）
    expect(state.players[0].hand).toHaveLength(0);
    expect(state.players[0].trash.map((c) => c.uid)).toEqual(['h1', 'h2', 'h3']);
    for (const card of state.players[0].trash) {
      expect(card.zone).toBe('trash');
      expect(card.faceUp).toBe(true);
      expect(card.line).toBeNull();
      expect(card.pos).toBeNull();
      expect(card.secret).toBeUndefined(); // 手牌/弃牌堆 = 已知信息 → secret 已清除
    }
    // 不触发任何引擎事件（clean 不经 discard op / executeAction）
    expect(events).toEqual([]);
    expect(renderCalls()).toBe(1);
    expect(state.log.join(' ')).toContain('已清空 P1 手牌（clean，3 张）');
  });

  it('is case-insensitive and trims input', () => {
    const state = createGame();
    state.players[0].hand.push(handCard('h1', 'fire-1'));
    const { host } = makeHost(state);
    runCommand(host, '  CLEAN  ');
    expect(state.players[0].hand).toHaveLength(0);
    expect(state.players[0].trash.map((c) => c.uid)).toEqual(['h1']);
  });

  it('only touches the current player (turnPlayer); opponent hand untouched', () => {
    const state = createGame();
    state.turnPlayer = 1;
    state.players[1].hand.push(handCard('p2a', 'darkness-0'), handCard('p2b', 'light-3'));
    state.players[0].hand.push(handCard('p1a', 'fire-1'));
    const { host } = makeHost(state);
    runCommand(host, 'clean');
    // 当前玩家 = P2（turnPlayer=1）→ 只清 P2，P1 手牌原样保留
    expect(state.players[1].hand).toHaveLength(0);
    expect(state.players[1].trash.map((c) => c.uid)).toEqual(['p2a', 'p2b']);
    expect(state.players[0].hand).toHaveLength(1);
    expect(state.players[0].trash).toHaveLength(0);
    expect(state.log.join(' ')).toContain('已清空 P2 手牌（clean，2 张）');
  });

  it('handles an already-empty hand (0 cards, still renders and logs)', () => {
    const state = createGame();
    const { host, renderCalls } = makeHost(state);
    runCommand(host, 'clean');
    expect(state.players[0].hand).toHaveLength(0);
    expect(state.players[0].trash).toHaveLength(0);
    expect(renderCalls()).toBe(1);
    expect(state.log.join(' ')).toContain('已清空 P1 手牌（clean，0 张）');
  });

  it('still routes non-clean input through get / unknown-command handling', () => {
    const state = createGame();
    const { host } = makeHost(state);
    runCommand(host, 'cleanup'); // 不是 clean（锚定整词）→ 未知指令
    expect(state.log.join(' ')).toContain('未知指令: cleanup');
    expect(state.players[0].hand).toHaveLength(0);
  });
});
