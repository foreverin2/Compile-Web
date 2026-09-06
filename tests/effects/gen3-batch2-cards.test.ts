import { describe, it, expect } from 'vitest';
import type { ChoiceRequest, GameState, Line, PlayerId } from '../../src/core/models/types';
import { createGame, getLineValue } from '../../src/core/state/create';
import { resolveMiddle, runStack, answerEffect } from '../../src/core/effects/resolve';
import { collectTriggers, resolveTrigger } from '../../src/core/effects/triggers';
import { executeAction } from '../../src/core/game';
import { makeCard, pickFirst, resolveAllChoices } from '../helpers';

/**
 * 3代 批2（怠惰/愤怒/伏击/支点/压制）效果测试——代表性用例。
 * 卡文：src/data/cards3.ts（compile3文本.txt）；裁决：docs/3代-批2-规格与裁决清单.md。
 */

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

function eagerPick(prompt: ChoiceRequest): string[] {
  if (prompt.optional) return [];
  if (prompt.kind === 'select-line') return prompt.lines && prompt.lines.length > 0 ? [`line:${prompt.lines[0]}`] : [];
  if (prompt.kind === 'select-action') return prompt.actions && prompt.actions.length > 0 ? [prompt.actions[0]] : [];
  if (prompt.candidates.length === 0) return [];
  return prompt.candidates.slice(0, prompt.max).map((c) => c.uid);
}

// ============ 怠惰 sloth ============

describe('sloth（怠惰）', () => {
  it('sloth-0 top: +5 when directly covered by a sloth card (adjacent above)', () => {
    const s = setup();
    placeSrc(s, 'sloth-0', 0, 0);
    expect(getLineValue(s, 0, 0)).toBe(0); // 未覆盖 → 无加成
    placeSrc(s, 'sloth-1', 0, 0); // sloth-1（值 1）盖在 sloth-0 上 → 相邻上方是怠惰牌
    expect(getLineValue(s, 0, 0)).toBe(1 + 5); // 1（sloth-1）+ 5（sloth-0 加成）
    // 再盖非怠惰牌：盖的是 sloth-1 —— sloth-0 的覆盖者（相邻上方）仍是 sloth-1 → 加成保留
    placeSrc(s, 'fire-2', 0, 0);
    expect(getLineValue(s, 0, 0)).toBe(1 + 2 + 5);
  });

  it('sloth-1 middle: returning own card refreshes to 5; opponent card does not', () => {
    const s = setup();
    s.players[0].deck = Array.from({ length: 8 }, () => makeCard('fire-1', 0, 'deck', false));
    const myTop = placeSrc(s, 'light-2', 0, 1);
    const src = placeSrc(s, 'sloth-1', 0, 0);
    // 回手自己的牌 → 刷新补至 5（sloth-1 打出前手牌 0？构造手牌少）
    s.players[0].hand = [makeCard('fire-1', 0, 'hand')];
    resolveMiddle(s, 0, src);
    let top = s.pendingEffects[s.pendingEffects.length - 1];
    expect(top?.prompt?.kind).toBe('select');
    answerEffect(s, top.id, [myTop.uid]);
    resolveAllChoices(s, pickFirst); // 自己的牌 → 刷新（抽 4 → 手 5）
    expect(s.players[0].hand).toHaveLength(5);
    expect(s.players[0].stacks[1]).toHaveLength(0); // 己方场牌已回手
  });

  it('sloth-2 bottom start: puts one hand card to the bottom of own deck', () => {
    const s = setup();
    s.turnPlayer = 0;
    s.step = 'start';
    placeSrc(s, 'sloth-2', 0, 0); // 顶卡（底命令）
    const bottom = makeCard('fire-5', 0, 'hand');
    const top1 = makeCard('light-1', 0, 'hand');
    s.players[0].hand = [bottom, top1];
    s.players[0].deck = [makeCard('fire-1', 0, 'deck', false), makeCard('fire-2', 0, 'deck', false)];
    const t = collectTriggers(s, 'start').find((x) => x.defId === 'sloth-2')!;
    resolveTrigger(s, t);
    runStack(s);
    let top = s.pendingEffects[s.pendingEffects.length - 1];
    expect(top?.prompt?.kind).toBe('select');
    answerEffect(s, top.id, [bottom.uid]); // 放回牌库底端
    resolveAllChoices(s, pickFirst);
    expect(s.players[0].hand.some((c) => c.uid === bottom.uid)).toBe(false);
    expect(s.players[0].deck[0].uid).toBe(bottom.uid); // deck[0] = 底部
    expect(s.players[0].deck[0].faceUp).toBe(false);
    expect(s.players[0].deck[0].secret).toBe(true);
  });

  it('sloth-2 middle: flips one own covered card', () => {
    const s = setup();
    const buried = placeSrc(s, 'fire-3', 0, 0); // 被盖 faceUp
    placeSrc(s, 'light-2', 0, 0); // 盖住 fire-3
    const src = placeSrc(s, 'sloth-2', 0, 1);
    resolveMiddle(s, 0, src);
    let top = s.pendingEffects[s.pendingEffects.length - 1];
    expect(top?.prompt?.kind).toBe('select');
    answerEffect(s, top.id, [buried.uid]);
    resolveAllChoices(s, pickFirst);
    expect(buried.faceUp).toBe(false); // 被盖 faceUp → 翻面
  });

  it('sloth-3 middle: opponent discards 2 (up to available)', () => {
    const s = setup();
    const src = placeSrc(s, 'sloth-3', 0, 0);
    const h = [makeCard('fire-1', 1, 'hand'), makeCard('light-2', 1, 'hand')];
    s.players[1].hand = [...h];
    resolveMiddle(s, 0, src);
    resolveAllChoices(s, eagerPick);
    expect(s.players[1].hand).toHaveLength(0);
    expect(s.players[1].trash).toHaveLength(2);
  });
});

// ============ 愤怒 wrath ============

describe('wrath（愤怒）', () => {
  it('wrath-0 top: highest-value cards in the line count for nothing (both sides)', () => {
    const s = setup();
    placeSrc(s, 'wrath-0', 0, 0); // 值 0
    placeSrc(s, 'fire-5', 0, 0); // 值 5 —— 全链最高
    placeSrc(s, 'fire-3', 0, 0); // 值 3 计入
    placeSrc(s, 'light-4', 1, 0); // 对手值 4（非最高，计入）
    // 全链 max = 5 → 己方 fire-5 不计入 → 己 = wrath-0(0) + fire-3(3) = 3
    expect(getLineValue(s, 0, 0)).toBe(3);
    // 对方 = light-4(4)（其堆叠无 max 卡）
    expect(getLineValue(s, 1, 0)).toBe(4);
  });

  it('wrath-1 bottom end: loses control (must) then deletes 1 face-up; skips when not holding', () => {
    const s = setup();
    s.turnPlayer = 0;
    s.step = 'end';
    placeSrc(s, 'wrath-1', 0, 0);
    s.control = 0; // 持有
    const victim = placeSrc(s, 'light-3', 1, 1); // 可删目标（对手 faceUp）
    const t = collectTriggers(s, 'end').find((x) => x.defId === 'wrath-1')!;
    resolveTrigger(s, t);
    runStack(s);
    resolveAllChoices(s, eagerPick); // 选 victim 删除
    expect(s.control).toBe(-1); // 必失
    expect(s.players[1].stacks[1].some((c) => c.uid === victim.uid)).toBe(false);

    // 未持有 → 自动判定无对象：end 收集不含 wrath-1（不弹结算按钮；效果不执行）
    const s2 = setup();
    s2.turnPlayer = 0;
    s2.step = 'end';
    placeSrc(s2, 'wrath-1', 0, 0);
    const keep = placeSrc(s2, 'light-3', 1, 1);
    expect(collectTriggers(s2, 'end').some((x) => x.defId === 'wrath-1')).toBe(false);
    expect(s2.players[1].stacks[1].some((c) => c.uid === keep.uid)).toBe(true);
    expect(s2.control).toBe(-1);
  });

  it('wrath-2 middle: flips all face-up cards (incl. covered) in the line with most cards', () => {
    const s = setup();
    const src = placeSrc(s, 'wrath-2', 0, 1);
    // 线 1（源卡线）1 张 vs 线 2 双方 3 张 → 线 2 最多
    const buried = placeSrc(s, 'light-4', 0, 2); // 被盖 faceUp
    placeSrc(s, 'darkness-1', 0, 2); // 盖 light-4（faceUp 顶）
    const foeTop = placeSrc(s, 'fire-3', 1, 2); // 对手 faceUp 顶
    resolveMiddle(s, 0, src);
    resolveAllChoices(s, pickFirst); // 无并列 → 直接翻线 2
    expect(buried.faceUp).toBe(false); // 被盖 faceUp 也翻面
    expect(foeTop.faceUp).toBe(false);
  });

  it('wrath-4 middle: loses control (must) then opponent discards 2', () => {
    const s = setup();
    const src = placeSrc(s, 'wrath-4', 0, 0);
    s.control = 0;
    s.players[1].hand = [makeCard('fire-1', 1, 'hand'), makeCard('light-2', 1, 'hand')];
    resolveMiddle(s, 0, src);
    resolveAllChoices(s, pickFirst); // 对手弃 2（eager 全选）
    expect(s.control).toBe(-1);
    expect(s.players[1].hand).toHaveLength(0);
  });
});

// ============ 伏击 ambush ============

describe('ambush（伏击）', () => {
  it('ambush-1 middle: flips own printed-value 0/1 cards (incl. covered), draws 1 per flip', () => {
    const s = setup();
    const src = placeSrc(s, 'ambush-1', 0, 0); // 值 1（自身除外）
    const buried0 = placeSrc(s, 'fire-0', 0, 1); // 值 0 被盖
    placeSrc(s, 'light-2', 0, 1); // 盖 fire-0
    const top1 = placeSrc(s, 'darkness-1', 0, 2); // 值 1 顶卡
    const foe1 = placeSrc(s, 'fire-1', 1, 0); // 对手值 1 —— 不翻（只翻自己的）
    s.players[0].deck = Array.from({ length: 6 }, () => makeCard('fire-1', 0, 'deck', false));
    resolveMiddle(s, 0, src);
    resolveAllChoices(s, pickFirst);
    expect(buried0.faceUp).toBe(false); // 值 0 被盖 faceUp → 翻面
    expect(top1.faceUp).toBe(false); // 值 1 顶卡 → 翻面
    expect(foe1.faceUp).toBe(true); // 对手的不翻
    expect(s.players[0].hand).toHaveLength(2); // 翻 2 张 → 抽 2
  });

  it('ambush-3 middle: flips opponent covered face-up card with highest printed value', () => {
    const s = setup();
    const src = placeSrc(s, 'ambush-3', 0, 0);
    const low = placeSrc(s, 'light-1', 1, 1); // 对手被盖值 1
    const high = placeSrc(s, 'fire-4', 1, 1); // 对手被盖值 4（最高）
    placeSrc(s, 'darkness-2', 1, 1); // 盖住两者
    resolveMiddle(s, 0, src);
    const top = s.pendingEffects[s.pendingEffects.length - 1];
    expect(top?.prompt?.kind).toBe('select');
    // 候选只应含值 4 那张（并列无 → 单候选也弹窗）
    expect(top?.prompt?.candidates?.map((c) => c.uid)).toEqual([high.uid]);
    answerEffect(s, top.id, [high.uid]);
    resolveAllChoices(s, pickFirst);
    expect(high.faceUp).toBe(false);
    expect(low.faceUp).toBe(true);
  });

  it('ambush-4 middle: draws 1 only if own uncovered face-down top exists', () => {
    const s = setup();
    const src = placeSrc(s, 'ambush-4', 0, 0);
    s.players[0].deck = [makeCard('fire-1', 0, 'deck', false)];
    resolveMiddle(s, 0, src); // 无反牌 → 不抽
    expect(s.players[0].hand).toHaveLength(0);
    const s2 = setup();
    s2.players[0].deck = [makeCard('fire-1', 0, 'deck', false)];
    const faceDown = makeCard('fire-5', 0, 'field', false, 1, 0);
    s2.players[0].stacks[1] = [faceDown];
    const src2 = placeSrc(s2, 'ambush-4', 0, 0);
    resolveMiddle(s2, 0, src2);
    expect(s2.players[0].hand).toHaveLength(1);
  });
});

// ============ 支点 fulcrum ============

describe('fulcrum（支点）', () => {
  it('fulcrum-1 middle: flips all other face-up cards (incl. covered) and swaps left/right stacks (line0↔line2)', () => {
    const s = setup();
    const src = placeSrc(s, 'fulcrum-1', 0, 1);
    const l0a = placeSrc(s, 'fire-1', 0, 0);
    const l0b = placeSrc(s, 'light-2', 0, 0);
    const l2a = placeSrc(s, 'darkness-3', 0, 2);
    const foeUp = placeSrc(s, 'fire-2', 1, 0);
    resolveMiddle(s, 0, src);
    resolveAllChoices(s, pickFirst);
    // 全场 faceUp（除源卡）都翻面：l0a/l0b/l2a/foeUp
    expect(l0a.faceUp).toBe(false);
    expect(l0b.faceUp).toBe(false);
    expect(l2a.faceUp).toBe(false);
    expect(foeUp.faceUp).toBe(false);
    // 线 0 ↔ 线 2 堆叠整换
    expect(s.players[0].stacks[0].map((c) => c.uid)).toEqual([l2a.uid]);
    expect(s.players[0].stacks[2].map((c) => c.uid)).toEqual([l0a.uid, l0b.uid]);
  });

  it('fulcrum-3 middle: draws 1 and swaps left/right protocols (line0↔line2)', () => {
    const s = setup();
    s.players[0].protocols[0].compiled = true; // fire 已编译（随槽位移动）
    const src = placeSrc(s, 'fulcrum-3', 0, 1);
    s.players[0].deck = [makeCard('fire-1', 0, 'deck', false)];
    const before = s.players[0].protocols.map((p) => p.defId);
    resolveMiddle(s, 0, src);
    const after = s.players[0].protocols;
    expect(s.players[0].hand).toHaveLength(1);
    expect(after[0].defId).toBe(before[2]);
    expect(after[2].defId).toBe(before[0]);
    expect(after[2].compiled).toBe(true); // compiled 状态随槽位
  });

  it('fulcrum-0 middle: opponent discards 1 only when hand is exactly 0', () => {
    const s = setup();
    const src = placeSrc(s, 'fulcrum-0', 0, 0);
    s.players[1].hand = [makeCard('fire-1', 1, 'hand')];
    resolveMiddle(s, 0, src); // 手牌非 0 → 不触发
    expect(s.players[1].hand).toHaveLength(1);
    const s2 = setup();
    const src2 = placeSrc(s2, 'fulcrum-0', 0, 0);
    s2.players[1].hand = [makeCard('fire-1', 1, 'hand')];
    s2.players[0].hand = []; // 手牌恰好 0
    resolveMiddle(s2, 0, src2);
    resolveAllChoices(s2, eagerPick);
    expect(s2.players[1].hand).toHaveLength(0);
  });
});

// ============ 压制 overwhelm ============

describe('overwhelm（压制）', () => {
  it('overwhelm-2 middle: opponent plays deck top face-down into each line (their stacks)', () => {
    const s = setup();
    const src = placeSrc(s, 'overwhelm-2', 0, 1);
    s.players[1].deck = [makeCard('fire-1', 1, 'deck', false), makeCard('light-2', 1, 'deck', false), makeCard('darkness-3', 1, 'deck', false)];
    resolveMiddle(s, 0, src);
    resolveAllChoices(s, pickFirst);
    expect(s.players[1].stacks[0]).toHaveLength(1);
    expect(s.players[1].stacks[1]).toHaveLength(1);
    expect(s.players[1].stacks[2]).toHaveLength(1);
    expect(s.players[1].deck).toHaveLength(0);
  });

  it('overwhelm-2 top end: plays deck top into every line then flips itself', () => {
    const s = setup();
    s.turnPlayer = 0;
    s.step = 'end';
    const src = placeSrc(s, 'overwhelm-2', 0, 1);
    s.players[0].deck = [makeCard('fire-1', 0, 'deck', false), makeCard('light-2', 0, 'deck', false), makeCard('darkness-3', 0, 'deck', false)];
    const t = collectTriggers(s, 'end').find((x) => x.defId === 'overwhelm-2')!;
    resolveTrigger(s, t, { topCommand: t.top });
    runStack(s);
    resolveAllChoices(s, pickFirst);
    expect(s.players[0].stacks[0]).toHaveLength(1);
    expect(s.players[0].stacks[1]).toHaveLength(2); // overwhelm-2 + 新卡
    expect(s.players[0].stacks[2]).toHaveLength(1);
    expect(src.faceUp).toBe(false); // 翻转此牌（自己被盖也翻）
    expect(s.players[0].deck).toHaveLength(0);
  });

  it('overwhelm-4 middle: deletes opponent lowest covered card when own field count is higher', () => {
    const s = setup();
    placeSrc(s, 'fire-1', 0, 0); // 先放己方线 0 底卡
    const src = placeSrc(s, 'overwhelm-4', 0, 0); // src 须为顶卡（sourceValid）
    const low = placeSrc(s, 'light-1', 1, 1); // 被盖值 1
    const high = placeSrc(s, 'fire-3', 1, 1); // 被盖值 3
    placeSrc(s, 'darkness-2', 1, 1); // 盖住（对手线 1 共 3 张）
    placeSrc(s, 'fire-1', 0, 1);
    placeSrc(s, 'fire-1', 0, 2); // 己方共 4 张（含 src）> 对手 3
    resolveMiddle(s, 0, src);
    const top = s.pendingEffects[s.pendingEffects.length - 1];
    expect(top?.prompt?.kind).toBe('select');
    expect(top?.prompt?.candidates?.map((c) => c.uid)).toEqual([low.uid]); // 只列最低值
    answerEffect(s, top.id, [low.uid]);
    resolveAllChoices(s, pickFirst);
    expect(s.players[1].stacks[1].some((c) => c.uid === low.uid)).toBe(false);
  });

  it('overwhelm-1 middle: deck-top face-down into each line where own total higher', () => {
    const s = setup();
    const src = placeSrc(s, 'overwhelm-1', 0, 0); // 值 1
    s.players[0].deck = [makeCard('fire-1', 0, 'deck', false), makeCard('light-2', 0, 'deck', false), makeCard('darkness-3', 0, 'deck', false)];
    for (let i = 0; i < 2; i++) placeSrc(s, 'light-1', 1, 0); // 对手线 0 = 2 > 己 1 → 不满足
    for (let i = 0; i < 5; i++) placeSrc(s, 'fire-1', 0, 1); // 线 1 己 5
    for (let i = 0; i < 2; i++) placeSrc(s, 'light-1', 1, 1); // 对 2 → 己高于
    for (let i = 0; i < 3; i++) placeSrc(s, 'fire-1', 0, 2); // 线 2 己 3
    for (let i = 0; i < 6; i++) placeSrc(s, 'light-1', 1, 2); // 对 6 → 己低于（不满足）
    resolveMiddle(s, 0, src); // 只有线 1 高于 → 打 1 张
    resolveAllChoices(s, pickFirst);
    expect(s.players[0].stacks[1].length).toBe(5 + 1); // 原 5 + 反打 1
    expect(s.players[0].deck).toHaveLength(2); // 只用 1 张
  });
});
