import { describe, it, expect } from 'vitest';
import type { ChoiceRequest, GameState, Line, PlayerId } from '../../src/core/models/types';
import { createGame, stackValue } from '../../src/core/state/create';
import { pushMiddle, resolveMiddle, runStack, answerEffect } from '../../src/core/effects/resolve';
import { collectTriggers, resolveTrigger } from '../../src/core/effects/triggers';
import { refreshHand } from '../../src/core/actions/base';
import { drawCards } from '../../src/core/engine/deck';
import { isPlayableFaceUp } from '../../src/core/actions/base';
import { executeAction } from '../../src/core/game';
import { getLegalActions } from '../../src/core/game';
import { makeCard, resolveAllChoices } from '../helpers';

/**
 * 2代 批2 五套卡效果测试（寒冰/烟雾/恐惧/腐化/战争）——代表性用例。
 * 裁决：docs/批2裁决结果.md；引擎扩展 00e0f4b。
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

/** 放置 faceUp 顶卡到 owner 的 line 并返回该卡 */
function placeSrc(s: GameState, defId: string, owner: PlayerId, line: Line) {
  const c = makeCard(defId, owner, 'field', true, line, s.players[owner].stacks[line].length);
  s.players[owner].stacks[line].push(c);
  return c;
}

function eagerPick(prompt: ChoiceRequest): string[] {
  if (prompt.kind === 'select-line') return prompt.lines && prompt.lines.length > 0 ? [`line:${prompt.lines[0]}`] : [];
  if (prompt.kind === 'select-action') return prompt.actions && prompt.actions.length > 0 ? [prompt.actions[0]] : [];
  if (prompt.candidates.length === 0) return [];
  return prompt.candidates.slice(0, prompt.max).map((c) => c.uid);
}

function pushOp(s: GameState, player: PlayerId, op: unknown): void {
  s.pendingEffects.push({
    id: `t-${s.pendingEffects.length}`,
    player,
    gen: (function* (): Generator<unknown, void, unknown> {
      yield op;
    })() as never,
    sourceUid: 't-src',
    sourceDefId: 't-sys',
    system: true,
    prompt: null,
    lastAnswer: null,
  });
}

// ============ 寒冰 ice ============

describe('ice', () => {
  it('ice-6 blocks draw while holder has hand cards; draw allowed at 0 hand', () => {
    const s = setup();
    placeSrc(s, 'ice-6', 0, 0);
    s.players[0].hand = [makeCard('fire-0', 0, 'hand')];
    s.players[0].deck = [makeCard('death-5', 0, 'deck', false)];
    expect(drawCards(s, 0, 1)).toHaveLength(0); // 有手牌 → 禁抽
    expect(s.players[0].deck).toHaveLength(1);
    s.players[0].hand = [];
    expect(drawCards(s, 0, 1)).toHaveLength(1); // 无手牌 → 放行
  });

  it('ice-4 cannot be flipped while uncovered top', () => {
    const s = setup();
    const c = placeSrc(s, 'ice-4', 0, 0);
    pushOp(s, 0, { op: 'flip', uid: c.uid });
    runStack(s);
    expect(c.faceUp).toBe(true); // 翻转被跳过
  });
});

// ============ 烟雾 smoke ============

describe('smoke', () => {
  it('smoke-0 plays deck top face-down into each line that has a face-down card', () => {
    const s = setup();
    const src = placeSrc(s, 'smoke-0', 0, 2);
    s.players[0].stacks[0] = [makeCard('death-0', 0, 'field', false, 0, 0)]; // 线0 有反面
    s.players[0].stacks[1] = []; // 线1 无
    s.players[0].deck = [makeCard('death-1', 0, 'deck', false), makeCard('death-2', 0, 'deck', false)];
    resolveMiddle(s, 0, src);
    expect(s.players[0].stacks[0]).toHaveLength(2); // 线0 打入 1 张
    expect(s.players[0].stacks[0][1].faceUp).toBe(false);
    expect(s.players[0].deck).toHaveLength(1);
  });

  it('smoke-2 top adds both-sides face-down count of its line to own total', () => {
    const s = setup();
    const c = placeSrc(s, 'smoke-2', 0, 0); // 值 2
    s.players[0].stacks[0] = [makeCard('death-0', 0, 'field', false, 0, 0), c];
    s.players[1].stacks[0] = [makeCard('fire-0', 1, 'field', false, 0, 0)]; // 对手反面
    // own total = 2(自己牌面) + 2(自己反面) + 修正(双方反面 2) = 6
    expect(stackValue(s, 0, 0)).toBe(6);
  });
});

// ============ 恐惧 fear ============

describe('fear', () => {
  it('fear-0 top blocks opponent middle commands during its owner turn', () => {
    const s = setup();
    s.turnPlayer = 0; // fear-0 拥有者回合
    const c = placeSrc(s, 'fear-0', 0, 0);
    const p1card = makeCard('fire-1', 1, 'field', false, 1, 0); // fire-1 middle 弃1（挂起）
    s.players[1].stacks[1] = [p1card];
    pushMiddle(s, 1, p1card);
    expect(s.pendingEffects).toHaveLength(0); // 禁
    c.faceUp = false; // fear-0 失效
    pushMiddle(s, 1, p1card);
    expect(s.pendingEffects.length).toBeGreaterThan(0); // 放行挂起
  });

  it('fear-1 middle: opponent discards all hand then draws hand-before-1', () => {
    const s = setup();
    const src = placeSrc(s, 'fear-1', 0, 0);
    s.players[1].hand = [makeCard('fire-1', 1, 'hand'), makeCard('fire-2', 1, 'hand'), makeCard('fire-3', 1, 'hand')]; // 弃前 3
    s.players[1].deck = [makeCard('death-5', 1, 'deck', false), makeCard('death-4', 1, 'deck', false), makeCard('death-3', 1, 'deck', false)];
    s.players[0].deck = [makeCard('death-2', 0, 'deck', false), makeCard('death-1', 0, 'deck', false)];
    resolveMiddle(s, 0, src);
    expect(s.players[1].hand).toHaveLength(2); // 弃 3 → 抽 3-1=2
    expect(s.players[1].trash).toHaveLength(3);
    expect(s.players[0].hand).toHaveLength(2); // 自己抽 2
  });

  it('fear-4 middle: opponent randomly discards 1 own hand card into their trash (txt 修改记录【3】)', () => {
    const s = setup();
    const src = placeSrc(s, 'fear-4', 0, 0);
    s.players[1].hand = [makeCard('fire-1', 1, 'hand'), makeCard('death-2', 1, 'hand')];
    s.players[0].hand = [makeCard('fire-0', 0, 'hand')];
    resolveMiddle(s, 0, src);
    expect(s.players[1].hand).toHaveLength(1); // 对手随机弃 1
    expect(s.players[1].trash).toHaveLength(1); // 落对手弃牌堆（按 owner）
    expect(s.players[1].trash[0].owner).toBe(1);
    expect(s.players[0].hand).toHaveLength(1); // 自己不取走（非 takeRandom）
    expect(s.players[0].trash).toHaveLength(0);
  });
});

// ============ 腐化 corruption ============

describe('corruption', () => {
  it('corruption-0 can be played face-up to any line (engine release)', () => {
    const s = setup();
    const c = makeCard('corruption-0', 0, 'hand');
    s.players[0].hand.push(c);
    for (const line of [0, 1, 2] as Line[]) {
      expect(isPlayableFaceUp(s, 0, c.uid, line)).toBe(true);
    }
  });

  it('corruption-1 after-return shuffles recalled opponent card into their deck', () => {
    const s = setup();
    placeSrc(s, 'corruption-1', 0, 0); // P0 场
    const recalled = makeCard('fire-0', 1, 'field', true, 1, 0);
    s.players[1].stacks[1] = [recalled];
    pushOp(s, 0, { op: 'return', uid: recalled.uid });
    runStack(s);
    // 召回 → after-return 触发 corruption-1 → fire-0 洗入 P1 牌库（faceDown）
    expect(s.players[1].hand).toHaveLength(0);
    expect(s.players[1].deck.length).toBeGreaterThan(0);
    const back = s.players[1].deck.find((c) => c.uid === recalled.uid);
    expect(back).toBeTruthy();
    expect(back!.faceUp).toBe(false);
    expect(s.players[1].trash).toHaveLength(0);
  });

  it('corruption-3 middle: may flip only a COVERED face-up card, never an uncovered top (txt 修改记录【1】)', () => {
    const s = setup();
    const buried = makeCard('death-0', 0, 'field', true, 0, 0); // 被盖正面卡
    const src = makeCard('corruption-3', 0, 'field', true, 0, 1); // 顶卡（源卡）
    s.players[0].stacks[0] = [buried, src];
    const otherTop = makeCard('fire-5', 1, 'field', true, 1, 0); // 他线顶卡（旧实现会误列）
    s.players[1].stacks[1] = [otherTop];
    resolveMiddle(s, 0, src);
    resolveAllChoices(s, eagerPick); // optional 选第一候选 = buried
    expect(buried.faceUp).toBe(false); // 仅被盖正面卡被翻
    expect(src.faceUp).toBe(true); // 源卡自己未被翻
    expect(otherTop.faceUp).toBe(true); // 未覆盖顶卡不是目标
  });

  it('corruption-0 top start: flips another face-up card in its stack, never itself (txt 修改记录【2】除此牌外)', () => {
    const s = setup();
    s.turnPlayer = 0;
    s.step = 'start';
    const buried = makeCard('death-0', 0, 'field', true, 0, 0);
    const src = makeCard('corruption-0', 0, 'field', true, 0, 1); // 顶卡 top:true
    s.players[0].stacks[0] = [buried, src];
    const trigs = collectTriggers(s, 'start');
    const t = trigs.find((x) => x.cardUid === src.uid);
    expect(t).toBeTruthy();
    resolveTrigger(s, t!);
    runStack(s); // 驱动 fireReactive push 的效果至 select 挂起
    resolveAllChoices(s, eagerPick); // 选 buried（唯一候选）
    expect(buried.faceUp).toBe(false); // 同堆叠其它正面卡被翻
    expect(src.faceUp).toBe(true); // 自身被「除此牌外」排除
  });

  it('corruption-0 (修改提示词 15): may be played face-up to ANY opponent line — 易主对方、进对方场地', () => {
    const s = setup();
    s.turnPlayer = 0;
    s.step = 'action';
    const c = makeCard('corruption-0', 0, 'hand');
    s.players[0].hand = [c];
    // getLegalActions 给出落【对方】线的 play action（target=1）
    const actions = getLegalActions(s, 0).filter(
      (a) => a.kind === 'play' && a.cardUid === c.uid && a.target === 1
    );
    expect(actions.map((a) => a.line).sort()).toEqual([0, 1, 2]);
    // 行动打出到对方线 1（正面）→ 真落对方场
    executeAction(s, 0, 'play', { cardUid: c.uid, faceUp: true, line: 1, target: 1 });
    expect(s.players[0].hand).toHaveLength(0);
    expect(s.players[0].stacks.flat().some((x) => x.uid === c.uid)).toBe(false); // 不在自己场
    const placed = s.players[1].stacks[1].find((x) => x.uid === c.uid);
    expect(placed).toBeTruthy();
    expect(placed!.owner).toBe(1); // 易主对方
    expect(placed!.faceUp).toBe(true);
    expect(placed!.zone).toBe('field');
  });

  it('corruption-0 on opponent field: its start trigger fires on OPPONENT turn-start and flips the opponent-stack card (owner 结算)', () => {
    const s = setup();
    // 对方场上：对方正面卡（被翻目标）+ 我方打过去的腐化0（对方场顶卡，易主对方）
    const oppCard = makeCard('fire-3', 1, 'field', true, 0, 0);
    const c = makeCard('corruption-0', 1, 'field', true, 0, 1); // owner=1（易主后）
    s.players[1].stacks[0] = [oppCard, c];
    // 对方回合开始：收集对方场地侧 start → corruption-0（owner=1）触发
    s.turnPlayer = 1;
    s.step = 'start';
    const trigs = collectTriggers(s, 'start');
    const t = trigs.find((x) => x.cardUid === c.uid);
    expect(t).toBeTruthy();
    resolveTrigger(s, t!);
    runStack(s);
    resolveAllChoices(s, eagerPick); // 翻 oppCard（同堆叠唯一候选，除此牌外）
    expect(oppCard.faceUp).toBe(false); // 对方场上对方卡被翻（干扰对方）
    expect(c.faceUp).toBe(true); // 腐化0 自身不被翻
  });
});

// ============ 战争 war ============

describe('war', () => {
  it('war-0 top after-refresh: can flip itself when holder refreshes', () => {
    const s = setup();
    const c = placeSrc(s, 'war-0', 0, 0);
    s.players[0].hand = [makeCard('fire-1', 0, 'hand')];
    s.players[0].deck = [
      makeCard('death-5', 0, 'deck', false),
      makeCard('death-4', 0, 'deck', false),
      makeCard('death-3', 0, 'deck', false),
      makeCard('death-2', 0, 'deck', false),
    ];
    refreshHand(s, 0); // 补至 5 → after-refresh push war-0 触发效果
    runStack(s); // 驱动 fireReactive push 的效果（直接调 refreshHand 无 executeAction 包装）
    resolveAllChoices(s, eagerPick);
    expect(c.faceUp).toBe(false); // 翻了自己
  });

  it('war-3 (修改提示词 20): 对手【批量】弃牌 = 一次性弃牌动作 → after-discard 只触发 1 次（不随张数多次）', () => {
    const s = setup();
    const w3 = placeSrc(s, 'war-3', 0, 0); // P0 场上 war-3 顶卡（after-discard 注册，无 top 仅顶卡）
    s.players[0].stacks[1] = [makeCard('fire-1', 0, 'field', true, 1, 0)]; // 无关他线顶卡（不应误触发）
    const foeCards = [makeCard('death-0', 1, 'hand'), makeCard('death-1', 1, 'hand'), makeCard('death-2', 1, 'hand')];
    s.players[1].hand = foeCards;
    // P1 手牌备选（war-3 反面打出候选）：war-3 结算由【war-3 拥有者 P0】操作，候选 = P0 手牌
    s.players[0].hand = [makeCard('light-2', 0, 'hand')];
    // 对手（P1）一次性弃 2 张（批量弃牌动作，discardMany）
    pushOp(s, 1, { op: 'discardMany', uids: [foeCards[0].uid, foeCards[1].uid] });
    runStack(s);
    // after-discard 只触发 1 次：仅 1 个 war-3 挂起选择（若随张数多次会是 2 个）
    const war3Pes = s.pendingEffects.filter((pe) => pe.sourceDefId === 'war-3');
    expect(war3Pes).toHaveLength(1);
    const top = s.pendingEffects[s.pendingEffects.length - 1];
    expect(top?.prompt?.kind).toBe('select'); // war-3 挂起：可选反面打出 1 张
    expect(top?.prompt?.optional).toBe(true);
    // 结算 war-3：跳过（不打出）→ 效果结束、无其它 war-3 再次挂起
    answerEffect(s, top.id, []);
    expect(s.pendingEffects.filter((pe) => pe.sourceDefId === 'war-3')).toHaveLength(0);
    // 对手 trash 恰好 2 张（批量弃完整）；hand 剩 1 张（foeCards 与 hand 同引用已被 splice 改写，勿引用原数组）
    expect(s.players[1].trash).toHaveLength(2);
    expect(s.players[1].hand).toHaveLength(1);
    expect(s.players[1].hand[0].defId).toBe('death-2');
    expect(w3.faceUp).toBe(true);
  });
});

void resolveAllChoices;
void resolveMiddle;
