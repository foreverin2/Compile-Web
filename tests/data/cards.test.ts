import { describe, it, expect } from 'vitest';
import {
  ALL_PROTOCOLS,
  ALL_CARD_DEFS,
  ALL_PROTOCOLS_2,
  ALL_CARD_DEFS_2,
  DEMO_PROTOCOLS,
  DEMO_CARD_DEFS,
  getCardDef,
  getProtocolDef,
  cardImgSrc,
  protocolImgSrc,
} from '../../src/data/demo';

describe('card data', () => {
  it('数据分代：ALL=1代 15 套；ALL_2=2代 15 套；DEMO=两代并池 30 套（2026-09-03 用户拍板并入协议选择池）', () => {
    expect(ALL_PROTOCOLS).toHaveLength(15);
    expect(ALL_CARD_DEFS).toHaveLength(90);
    expect(ALL_PROTOCOLS_2).toHaveLength(15);
    expect(ALL_CARD_DEFS_2).toHaveLength(90);
    expect(DEMO_PROTOCOLS).toHaveLength(30);
    expect(DEMO_CARD_DEFS).toHaveLength(180);
  });

  it('并池后每套协议仍恰有 6 张指令卡', () => {
    for (const p of DEMO_PROTOCOLS) {
      const cards = DEMO_CARD_DEFS.filter((c) => c.protocol === p.defId);
      expect(cards.length).toBe(6);
    }
  });

  it('两代 defId / 协议 defId 并池无冲突', () => {
    const ids = DEMO_CARD_DEFS.map((c) => c.defId);
    expect(new Set(ids).size).toBe(ids.length);
    const pids = DEMO_PROTOCOLS.map((p) => p.defId);
    expect(new Set(pids).size).toBe(pids.length);
  });

  it('getCardDef/getProtocolDef 覆盖两代', () => {
    expect(getCardDef('fire-1').protocol).toBe('fire');
    expect(getCardDef('ice-1').protocol).toBe('ice'); // 2代
    expect(getProtocolDef('water').name).toBe('水');
    expect(getProtocolDef('unity').name).toBe('统一'); // 2代
  });

  it('fire 使用真实卡文（1代 文本未变）', () => {
    const f0 = getCardDef('fire-0');
    expect(f0.middle).toContain('翻转另1张牌');
  });

  it('资源 src 随世代扩展名：1代 .png / 2代 .jpg', () => {
    expect(cardImgSrc('water', 0)).toBe('/assets/protocols/water/card-0.png');
    expect(cardImgSrc('ice', 1)).toBe('/assets/protocols/ice/card-1.jpg');
    expect(cardImgSrc('unity', 5)).toBe('/assets/protocols/unity/card-5.jpg');
    expect(protocolImgSrc('water', false)).toBe('/assets/protocols/water/protocol-loading.png');
    expect(protocolImgSrc('ice', true)).toBe('/assets/protocols/ice/protocol-compiled.jpg');
    expect(protocolImgSrc('ice', false)).toBe('/assets/protocols/ice/protocol-loading.jpg');
  });
});
