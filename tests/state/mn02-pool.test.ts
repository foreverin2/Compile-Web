import { describe, it, expect } from 'vitest';
import { createGame, getDraftPool, performDraftPick } from '../../src/core/state/create';
import { EFFECTS } from '../../src/core/effects/registry';
import { getCardDef } from '../../src/data/demo';
import type { Card } from '../../src/core/models/types';
import { ALL_PROTOCOLS_2 } from '../../src/data/cards2';
import '../../src/core/effects/resolve'; // 副作用：触发 cards/*.ts 全部效果注册

/**
 * MN02（2代）并入协议选择池后可玩性回归（2026-09-03 用户拍板「直接并入协议池」）：
 * - 草稿池 30 套含 2代 协议，可正常被选中；
 * - 每人 3 套协议按草案分配后，各自 18 张卡入牌库（2代 卡的 defId/数据走统一管线）；
 * - 2026-09-05 起 2代 15 套卡效果全部注册（批1/批2/批3）——本测试校验注册完整性；
 *   引擎对未注册效果的安全空转由可选链保证（resolve/triggers），历史测试已随批 3 完成退役。
 */
describe('MN02 并池后可玩性', () => {
  it('2代 15 套协议效果全部注册（批1+批2+批3 完成；ice-4/ice-6 引擎守卫、chaos-3 引擎放行为有意不注册）', () => {
    for (const proto of ALL_PROTOCOLS_2) {
      let count = 0;
      for (let v = 0; v <= 6; v++) {
        const id = `${proto.defId}-${v}`;
        if (EFFECTS[id]) count++;
      }
      expect(count, proto.defId).toBeGreaterThanOrEqual(4);
    }
  });

  it('草稿池含 45 套（1代+2代+3代），冰(ice) 可被首选', () => {
    const s = createGame();
    const pool = getDraftPool(s);
    expect(pool).toHaveLength(45);
    expect(pool.map((p) => p.defId)).toContain('ice');
    expect(pool[0].defId).toBe('water'); // 1代 顺序在前，2/3代 追加在后
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
});
