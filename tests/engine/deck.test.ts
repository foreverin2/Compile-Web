import { describe, it, expect, beforeEach } from 'vitest';
import type { GameState } from '../../src/core/models/types';
import { drawCards, discardFromHand, clearCache } from '../../src/core/engine/deck';

function makeState(handSize: number, deckSize: number, trashSize: number): GameState {
  const mk = (n: number, zone: 'hand' | 'deck' | 'trash') =>
    Array.from({ length: n }, (_, i) => ({
      uid: `${zone}-${i}`,
      defId: 'spirit-1',
      owner: 0 as const,
      faceUp: true,
      zone,
      line: null,
      pos: null,
    }));
  return {
    phase: 'turn',
    draftRound: 6,
    draftPicks: [],
    draftStarter: 0,
    firstToPlay: 0,
    draftMode: 'normal',
    draftPool: [],
    bannedProtocols: [],
    turnPlayer: 0,
    turnCount: 0,
    step: 'action',
    compiledThisTurn: false,
    players: [
      { hand: mk(handSize, 'hand'), deck: mk(deckSize, 'deck'), trash: mk(trashSize, 'trash'), protocols: [], stacks: [[], [], []] },
      { hand: [], deck: [], trash: [], protocols: [], stacks: [[], [], []] },
    ],
    control: -1,
    winner: null,
    log: [],
    pendingEffects: [],
    pendingPlay: [],
    pendingShift: [],
    resolvedTriggerUids: [],
    pendingStepAdvance: false,
    revealedGhosts: [],
    deckReveals: [],
    compileBlocked: null,
    pendingCompile: null,
  };
}

describe('deck ops', () => {
  let s: GameState;

  beforeEach(() => {
    s = makeState(0, 5, 0);
  });

  it('draws from deck into hand', () => {
    const drawn = drawCards(s, 0, 2);
    expect(drawn).toHaveLength(2);
    expect(s.players[0].hand).toHaveLength(2);
    expect(s.players[0].deck).toHaveLength(3);
    expect(drawn.every((c) => c.zone === 'hand')).toBe(true);
  });

  it('drawCards declassifies a secret card entering the hand (回手即解禁)', () => {
    s = makeState(0, 1, 0);
    const card = s.players[0].deck[0];
    card.secret = true; // 牌堆来源的反面打出卡（曾被回弃牌堆并洗回牌库）
    drawCards(s, 0, 1);
    expect(card.zone).toBe('hand');
    expect(card.secret).toBeFalsy(); // 手牌 = 已知信息：不再以背面渲染
  });

  it('reshuffles trash into deck when deck empties during draw', () => {
    s = makeState(0, 2, 3);
    const drawn = drawCards(s, 0, 5);
    expect(drawn).toHaveLength(5);
    expect(s.players[0].deck).toHaveLength(0);
    expect(s.players[0].trash).toHaveLength(0);
    expect(s.players[0].hand).toHaveLength(5);
  });

  it('discardFromHand moves card face-up to trash', () => {
    s = makeState(2, 0, 0);
    const card = discardFromHand(s, 0, 'hand-0');
    expect(card.zone).toBe('trash');
    expect(card.faceUp).toBe(true);
    expect(s.players[0].hand).toHaveLength(1);
    expect(s.players[0].trash).toHaveLength(1);
  });

  it('clearCache discards down to 5', () => {
    s = makeState(7, 0, 0);
    const discarded = clearCache(s, 0);
    expect(discarded).toHaveLength(2);
    expect(s.players[0].hand).toHaveLength(5);
  });
});


