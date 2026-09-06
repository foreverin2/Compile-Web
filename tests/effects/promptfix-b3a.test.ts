import { describe, it, expect } from 'vitest';
import type { GameState, Line, PlayerId } from '../../src/core/models/types';
import { createGame } from '../../src/core/state/create';
import { resolveMiddle, answerEffect, runStack } from '../../src/core/effects/resolve';
import { collectTriggers, resolveTrigger } from '../../src/core/effects/triggers';
import { executeAction } from '../../src/core/game';
import { makeCard, resolveAllChoices, pickFirst } from '../helpers';

/** 修改提示词批 B3a：透彻2/3 从牌库选阈值牌（候选正面可选，其余放回重洗）；
 *  联合4 直接抽所有联合卡并洗牌（不依赖揭示浮层）。 */

function setup(): GameState {
  const s = createGame();
  for (const pid of [0, 1] as PlayerId[]) {
    s.players[pid].protocols = [
      { defId: 'fire', compiled: false },
      { defId: 'light', compiled: false },
      { defId: 'darkness', compiled: false },
    ];
  }
  s.phase = 'turn';
  return s;
}

function placeSrc(s: GameState, defId: string, owner: PlayerId, line: Line) {
  const c = makeCard(defId, owner, 'field', true, line, s.players[owner].stacks[line].length);
  s.players[owner].stacks[line].push(c);
  return c;
}

describe('修改提示词 B3a', () => {
  it('透彻3：牌库中值 5 卡以正面候选供选，抽 1 后其余放回并重洗', () => {
    const s = setup();
    const src = placeSrc(s, 'clarity-3', 0, 0);
    const five = makeCard('fire-5', 0, 'deck', false);
    const other1 = makeCard('light-1', 0, 'deck', false);
    const other2 = makeCard('darkness-2', 0, 'deck', false);
    s.players[0].deck = [other1, other2, five];
    resolveMiddle(s, 0, src);
    const top = s.pendingEffects[s.pendingEffects.length - 1];
    expect(top?.prompt?.kind).toBe('select');
    // 候选 = 仅值 5 那张，且以正面呈现（faceUp true → UI 显示卡面可辨）
    expect(top?.prompt?.candidates?.map((c) => c.uid)).toEqual([five.uid]);
    expect(top?.prompt?.candidates?.[0].faceUp).toBe(true);
    answerEffect(s, top.id, [five.uid]);
    resolveAllChoices(s, pickFirst);
    expect(s.players[0].hand.some((c) => c.uid === five.uid)).toBe(true); // 抽入手
    expect(s.players[0].deck).toHaveLength(2); // 其余放回
    expect(s.players[0].deck.some((c) => c.uid === five.uid)).toBe(false);
  });

  it('透彻3：牌库无值 5 卡 → 整句无对象（不弹窗、无挂起）', () => {
    const s = setup();
    const src = placeSrc(s, 'clarity-3', 0, 0);
    s.players[0].deck = [makeCard('light-1', 0, 'deck', false), makeCard('darkness-2', 0, 'deck', false)];
    resolveMiddle(s, 0, src);
    expect(s.pendingEffects).toHaveLength(0);
    expect(s.players[0].hand).toHaveLength(0);
  });

  it('多元0：被偏转移动暴露为顶卡时中段重新判定（纯翻协议，不删卡）', () => {
    const s = setup();
    s.players[0].protocols[0] = { defId: 'diversity', compiled: false };
    // 场上凑 ≥6 种不同协议卡（场上去重协议数条件）
    const protoIds = ['fire', 'light', 'darkness', 'water', 'life', 'death', 'gravity'];
    for (let i = 0; i < protoIds.length; i++) placeSrc(s, `${protoIds[i]}-1`, i % 2 === 0 ? 0 : 1, i % 3);
    // 多元0 faceUp 放在线 0 底层并被盖住（非顶卡 → 中段本不因「打出」结算）
    const d0 = makeCard('diversity-0', 0, 'field', true, 0, 0);
    s.players[0].stacks[0].unshift(d0);
    placeSrc(s, 'fire-2', 0, 0); // 盖住多元0
    // chaos-2（平移你被覆盖的牌）把多元0 偏转到线 2（空堆 → 成为未覆盖顶卡）
    const c2 = placeSrc(s, 'chaos-2', 0, 1);
    resolveMiddle(s, 0, c2);
    let top = s.pendingEffects[s.pendingEffects.length - 1];
    expect(top?.prompt?.kind).toBe('select');
    answerEffect(s, top.id, [d0.uid]); // 选被盖的多元0
    top = s.pendingEffects[s.pendingEffects.length - 1];
    expect(top?.prompt?.kind).toBe('select-line');
    answerEffect(s, top.id, ['line:2']);
    resolveAllChoices(s, pickFirst);
    // 多元0 成为线 2 顶卡 → 中段（偏转暴露）评估：场上 ≥6 种协议 → 多元协议翻至已编译（不删卡）
    expect(s.players[0].protocols[0].compiled).toBe(true);
    expect(s.players[0].stacks[2].some((c) => c.uid === d0.uid)).toBe(true);
    // 纯翻协议：不删卡——其余场卡原样
    expect(s.players[0].stacks[0].some((c) => c.defId === 'fire-2')).toBe(true);
    expect(s.players[0].hand).toHaveLength(0);
  });

  it('联合4：手牌空时抽牌库中所有联合卡并切洗（无 deckReveals 依赖）', () => {
    const s = setup();
    s.turnPlayer = 0;
    s.step = 'start';
    const u4 = placeSrc(s, 'unity-4', 0, 0);
    s.players[0].hand = []; // 手牌空 → 触发条件满足
    const uni1 = makeCard('unity-1', 0, 'deck', false);
    const uni0 = makeCard('unity-0', 0, 'deck', false);
    const fire = makeCard('fire-3', 0, 'deck', false);
    s.players[0].deck = [uni1, fire, uni0];
    const t = collectTriggers(s, 'start').find((x) => x.defId === 'unity-4')!;
    resolveTrigger(s, t, { topCommand: t.top });
    runStack(s);
    expect(s.deckReveals).toHaveLength(0); // 不再标记揭示浮层
    expect(s.players[0].hand.some((c) => c.uid === uni1.uid)).toBe(true);
    expect(s.players[0].hand.some((c) => c.uid === uni0.uid)).toBe(true);
    expect(s.players[0].deck).toHaveLength(1); // 只剩非联合卡（已切洗）
    expect(s.players[0].deck.some((c) => c.uid === fire.uid)).toBe(true);
    expect(u4.faceUp).toBe(true);
  });
});
