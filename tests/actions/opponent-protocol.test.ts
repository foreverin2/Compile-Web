import { describe, it, expect } from 'vitest';
import { executeAction, getLegalActions } from '../../src/core/game';
import { answerEffect } from '../../src/core/effects/resolve';
import { advanceToStep, draftFireP1, makeCard } from '../helpers';

/**
 * 对手协议卡正面打入：行线上同时携带双方协议（P1 协议 | P2 协议），
 * 只要该行任一协议与卡牌协议匹配即可正面打入（如 dev 模式 get 出对手协议的牌）。
 * draftFireP1 布局：P1 协议 [fire, darkness, life]；P2 协议 [water, light, death]。
 */
describe('face-up play onto the row carrying the opponent protocol', () => {
  it('offers face-up play on the line whose row carries the opponent protocol', () => {
    const s = draftFireP1();
    advanceToStep(s, 0, 'action');
    // light 不在 P1 协议中，但在 P2 线 1（light）→ 该行可正面打入
    const light5 = makeCard('light-5', 0, 'hand');
    s.players[0].hand.push(light5);
    const legal = getLegalActions(s, 0);
    expect(legal).toContainEqual({ kind: 'play', cardUid: light5.uid, faceUp: true, line: 1 });
    // 且只在该行提供正面打入（其它线行上无 light 协议）
    const faceUp = legal.filter((a) => a.kind === 'play' && a.cardUid === light5.uid && a.faceUp);
    expect(faceUp.map((a) => a.line)).toEqual([1]);
  });

  it('executes face-up play with opponent protocol: lands face-up and middle effect triggers', () => {
    const s = draftFireP1();
    advanceToStep(s, 0, 'action');
    const light5 = makeCard('light-5', 0, 'hand');
    const victim = makeCard('fire-1', 0, 'hand');
    s.players[0].hand.push(light5, victim);
    executeAction(s, 0, 'play', { cardUid: light5.uid, faceUp: true, line: 1 });
    // 卡牌正面落在 P1 侧线 1 堆叠（light-5 中指令 = 弃1张牌）
    expect(s.players[0].stacks[1].map((c) => c.uid)).toEqual([light5.uid]);
    expect(s.players[0].stacks[1][0].faceUp).toBe(true);
    const top = s.pendingEffects[s.pendingEffects.length - 1];
    expect(top).toBeDefined();
    expect(top!.prompt).not.toBeNull();
    answerEffect(s, top!.id, [victim.uid]);
    expect(s.players[0].trash.map((c) => c.uid)).toContain(victim.uid);
  });

  it('rejects face-up play for a protocol in neither player line (face-down still fine)', () => {
    const s = draftFireP1();
    advanceToStep(s, 0, 'action');
    // metal 不在 P1（fire/darkness/life）也不在 P2（water/light/death）协议中
    const metal5 = makeCard('metal-5', 0, 'hand');
    s.players[0].hand.push(metal5);
    const legal = getLegalActions(s, 0);
    expect(legal.some((a) => a.kind === 'play' && a.cardUid === metal5.uid && a.faceUp)).toBe(false);
    expect(legal).toContainEqual({ kind: 'play', cardUid: metal5.uid, faceUp: false, line: 0 });
    expect(() => executeAction(s, 0, 'play', { cardUid: metal5.uid, faceUp: true, line: 0 })).toThrow(
      /cannot play face-up/
    );
  });
});
