import { describe, it, expect } from 'vitest';
import { EFFECTS } from '../../src/core/effects/registry';
import { ALL_PROTOCOLS_3 } from '../../src/data/cards3';
import '../../src/core/effects/resolve'; // 副作用：触发 cards/*.ts 全部效果注册

/**
 * 3代（MN03/AX03）15 套效果注册完整性（2026-09，批1-3 完成）：
 * 每套 6 张卡都必须在 EFFECTS 注册（middle/triggers/valueModifier 至少其一）。
 * 例外说明：区域禁用（惰性0 顶/惰性1 底）与不可翻移（刚性7 底）等纯引擎守卫卡，
 * 同套内其余卡槽（中部/另一端）仍注册 fn——故 6 张全注册成立。
 */
describe('3代 15 套协议效果注册完整性', () => {
  it('MN03/AX03 90 张卡全部注册（批1+批2+批3 完成）', () => {
    for (const proto of ALL_PROTOCOLS_3) {
      const ids: string[] = [];
      for (const c of Object.keys(EFFECTS)) {
        if (c.startsWith(`${proto.defId}-`)) ids.push(c);
      }
      // 每套恰 6 张且全部注册（分值集合各不相同，直接按前缀计数 = 6）
      expect(ids.length, `${proto.defId} 注册数`).toBe(6);
    }
  });
});
