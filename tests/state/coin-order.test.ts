import { describe, it, expect } from 'vitest';
import {
  createGame,
  getCurrentDrafter,
  getDraftPool,
  performDraftPick,
  draftRoundOwner,
  type CreateGameOptions,
} from '../../src/core/state/create';
import type { PlayerId } from '../../src/core/models/types';

/**
 * 掷硬币先手机制（2026-09-03 用户需求）：开局由玩家一选正/反 → 掷硬币决定谁先手选协议；
 * 用户拍板「后选择协议的人先出牌」→ firstToPlay = 1 - draftStarter。
 * 引擎默认（无硬币、旧流程）仍为 draftStarter=0 / firstToPlay=0（全部既有测试兼容）。
 */
describe('掷硬币先手机制（draftStarter / firstToPlay）', () => {
  it('draftRoundOwner：先手 0 → 0,1,1,0,0,1；先手 1 → 1,0,0,1,1,0（1-2-2-1 相对展开）', () => {
    for (const starter of [0, 1] as PlayerId[]) {
      const seq = [0, 1, 2, 3, 4, 5].map((r) => draftRoundOwner(starter, r));
      expect(seq).toEqual(starter === 0 ? [0, 1, 1, 0, 0, 1] : [1, 0, 0, 1, 1, 0]);
    }
  });

  it('默认 createGame()：玩家一先选、先出牌（旧行为兼容）', () => {
    const s = createGame();
    expect(s.draftStarter).toBe(0);
    expect(s.firstToPlay).toBe(0);
    expect(getCurrentDrafter(s)).toBe(0);
    for (let i = 0; i < 6; i++) performDraftPick(s, getDraftPool(s)[0].defId);
    expect(s.phase).toBe('turn');
    expect(s.turnPlayer).toBe(0);
    expect(s.players[0].protocols).toHaveLength(3);
    expect(s.players[1].protocols).toHaveLength(3);
  });

  it('玩家二掷胜（draftStarter=1）：玩家二先选协议；玩家一先出牌（后选者先出）', () => {
    const opts: CreateGameOptions = { draftStarter: 1, firstToPlay: 0 };
    const s = createGame(opts);
    expect(getCurrentDrafter(s)).toBe(1);
    // 按 1-2-2-1（starter=1）依次选：座位 1,0,0,1,1,0
    for (const defId of ['ice', 'water', 'fire', 'mirror', 'chaos', 'light']) {
      performDraftPick(s, defId);
    }
    expect(s.phase).toBe('turn');
    // 后选协议者（座位 0 玩家一）先出牌
    expect(s.turnPlayer).toBe(0);
    // 先手方 玩家二 三选（ice/mirror/chaos）；玩家一 三选（water/fire/light）按选择顺序
    expect(s.players[1].protocols.map((p) => p.defId)).toEqual(['ice', 'mirror', 'chaos']);
    expect(s.players[0].protocols.map((p) => p.defId)).toEqual(['water', 'fire', 'light']);
  });

  it('玩家一掷胜（draftStarter=0）硬币流程：玩家一先选、玩家二先出牌', () => {
    const s = createGame({ draftStarter: 0, firstToPlay: 1 });
    expect(getCurrentDrafter(s)).toBe(0);
    for (let i = 0; i < 6; i++) performDraftPick(s, getDraftPool(s)[0].defId);
    expect(s.phase).toBe('turn');
    expect(s.turnPlayer).toBe(1);
  });
});
