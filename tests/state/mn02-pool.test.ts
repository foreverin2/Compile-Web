import { describe, it, expect } from 'vitest';
import { createGame, getDraftPool, performDraftPick } from '../../src/core/state/create';
import { pushMiddle } from '../../src/core/effects/resolve';
import { getCardDef } from '../../src/data/demo';
import type { Card } from '../../src/core/models/types';

/**
 * MN02（2代）并入协议选择池后可玩性回归（2026-09-03 用户拍板「直接并入协议池」）：
 * - 草稿池 30 套含 2代 协议，可正常被选中；
 * - 每人 3 套协议按草案分配后，各自 18 张卡入牌库（2代 卡的 defId/数据走统一管线）；
 * - 2代 卡效果尚未注册（EFFECTS 无条目）——引擎对未注册效果安全空转，仅此测试验证
 *   数据/组牌/草稿路径不崩；实际打出行为由 resolve/triggers 的可选链保证无效果。
 */
describe('MN02 并池后可玩性（效果未注册期）', () => {
  it('草稿池含 30 套（1代+2代），冰(ice) 可被首选', () => {
    const s = createGame();
    const pool = getDraftPool(s);
    expect(pool).toHaveLength(30);
    expect(pool.map((p) => p.defId)).toContain('ice');
    expect(pool[0].defId).toBe('water'); // 1代 顺序在前，2代 追加在后
    performDraftPick(s, 'ice');
    expect(s.draftPicks[0].defId).toBe('ice');
  });

  it('P1 选冰后组牌：冰 6 张入 P1 牌组，全牌组 18 张无重复', () => {
    const s = createGame();
    performDraftPick(s, 'ice'); // round0: P1
    // 其余 5 轮依次取池首（每轮去重后互不相同）
    for (let i = 1; i < 6; i++) {
      const pool = getDraftPool(s);
      performDraftPick(s, pool[0].defId);
    }
    expect(s.phase).toBe('turn');
    expect(s.players[0].protocols[0].defId).toBe('ice');
    // 开局双方各抽 5 张起手：18 张 = 牌库 13 + 手牌 5
    const p1All = [...s.players[0].deck, ...s.players[0].hand];
    expect(p1All).toHaveLength(18);
    expect(p1All.filter((c) => c.defId.startsWith('ice-'))).toHaveLength(6);
    expect(new Set(p1All.map((c) => c.defId)).size).toBe(18);
    const p2All = [...s.players[1].deck, ...s.players[1].hand];
    expect(p2All).toHaveLength(18);
    expect(new Set(p2All.map((c) => c.defId)).size).toBe(18);
  });

  it('未注册效果的 2代 卡中指令安全空转（pushMiddle 不入栈、不抛错）', () => {
    const s = createGame();
    performDraftPick(s, 'ice'); // round0: P1 选冰
    for (let i = 1; i < 6; i++) {
      performDraftPick(s, getDraftPool(s)[0].defId);
    }
    expect(s.phase).toBe('turn');
    const def = getCardDef('ice-1'); // EFFECTS 未注册（2代 效果未实现期）
    const fieldCard: Card = {
      uid: 'test-field-ice-1', defId: def.defId, owner: 0,
      faceUp: true, zone: 'field', line: 0, pos: 1,
    };
    expect(() => pushMiddle(s, 0, fieldCard)).not.toThrow();
    expect(s.pendingEffects).toHaveLength(0); // 无效果 → 不入效果栈
  });
});
