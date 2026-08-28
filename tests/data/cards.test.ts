import { describe, it, expect } from 'vitest';
import {
  ALL_PROTOCOLS,
  ALL_CARD_DEFS,
  DEMO_PROTOCOLS,
  DEMO_CARD_DEFS,
  getCardDef,
  getProtocolDef,
} from '../../src/data/demo';

describe('card data', () => {
  it('has 15 total protocols and 6 demo protocols (draft needs 6 picks)', () => {
    expect(ALL_PROTOCOLS).toHaveLength(15);
    expect(DEMO_PROTOCOLS).toHaveLength(6);
  });

  it('every protocol has 6 command cards', () => {
    for (const p of ALL_PROTOCOLS) {
      const cards = ALL_CARD_DEFS.filter((c) => c.protocol === p.defId);
      expect(cards.length).toBe(6);
    }
  });

  it('demo cards are a subset of all cards', () => {
    for (const c of DEMO_CARD_DEFS) {
      expect(ALL_CARD_DEFS.some((a) => a.defId === c.defId)).toBe(true);
    }
  });

  it('fire uses real card text', () => {
    const f0 = getCardDef('fire-0');
    expect(f0.middle).toContain('翻转另1张牌');
    const f4 = getCardDef('fire-4');
    expect(f4.middle).toContain('弃1张或更多张牌');
  });

  it('getCardDef finds by defId', () => {
    expect(getCardDef('fire-1').protocol).toBe('fire');
  });

  it('getProtocolDef finds by defId', () => {
    expect(getProtocolDef('water').name).toBe('Water');
    expect(getProtocolDef('apathy').set).toBe('AX01');
  });
});
