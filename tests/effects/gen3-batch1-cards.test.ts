import { describe, it, expect } from 'vitest';
import type { ChoiceRequest, GameState, Line, PlayerId } from '../../src/core/models/types';
import { createGame, getLineValue } from '../../src/core/state/create';
import { resolveMiddle, runStack, answerEffect } from '../../src/core/effects/resolve';
import { collectTriggers, resolveTrigger, fireReactive } from '../../src/core/effects/triggers';
import { executeAction } from '../../src/core/game';
import { executeCompileUnchecked } from '../../src/core/rules/compile';
import { isPlayableFaceUp } from '../../src/core/actions/base';
import { setControl } from '../../src/core/rules/control';
import { makeCard, pickFirst, resolveAllChoices, advanceToStep } from '../helpers';

/**
 * 3代 批1（嫉妒/暴食/贪婪/色欲/傲慢）效果测试——代表性用例。
 * 卡文：src/data/cards3.ts（compile3文本.txt）；裁决：docs/3代-批1-规格与裁决清单.md。
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

/** 默认选择器（同 gen2 测试）：可选跳过；select-line/action 取首个 */
function eagerPick(prompt: ChoiceRequest): string[] {
  if (prompt.optional) return [];
  if (prompt.kind === 'select-line') return prompt.lines && prompt.lines.length > 0 ? [`line:${prompt.lines[0]}`] : [];
  if (prompt.kind === 'select-action') return prompt.actions && prompt.actions.length > 0 ? [prompt.actions[0]] : [];
  if (prompt.candidates.length === 0) return [];
  return prompt.candidates.slice(0, prompt.max).map((c) => c.uid);
}

// ============ 嫉妒 envy ============

describe('envy（嫉妒）', () => {
  it('envy-0 top: own line value adds the highest opponent card value in this line', () => {
    const s = setup();
    placeSrc(s, 'envy-0', 0, 0); // 己方线 0（值 0）
    placeSrc(s, 'fire-1', 1, 0); // 对手线 0 值 1（被 light-4 覆盖）
    placeSrc(s, 'light-4', 1, 0); // 对手线 0 值 4（最高，含被盖一并计）
    expect(getLineValue(s, 0, 0)).toBe(4); // 己 = envy-0 0 + 对手最高 4
    expect(getLineValue(s, 1, 0)).toBe(5); // 对手 = 1 + 4（对方估值时最高卡看己方堆叠 = envy-0 值 0 → +0）
  });

  it('envy-0 top 只加【持有者自己】：对手不被加成（2026-09-13 修正 line→own-stack）', () => {
    const s = setup();
    placeSrc(s, 'envy-0', 1, 0); // P2 持有嫉妒0（线 0）
    placeSrc(s, 'light-4', 1, 0); // P2 该线还有一张 4 —— 旧版（target:'line'）会把这张 4 也加给 P1
    placeSrc(s, 'fire-1', 0, 0); // P1 该线 1
    expect(getLineValue(s, 1, 0)).toBe(4 + 1); // 持有者 P2 = 自身 4 + 对手(P1)最高 1
    expect(getLineValue(s, 0, 0)).toBe(1); // 对手 P1 = 1（**不**享受嫉妒0；旧版会错误得到 1+4=5）
  });

  it('envy-1 bottom start: gains control from opponent when opponent holds it', () => {
    const s = setup();
    s.turnPlayer = 0;
    s.step = 'start';
    placeSrc(s, 'envy-1', 0, 0); // 顶卡（底命令生效）
    s.control = 1; // 对手持有
    const t = collectTriggers(s, 'start').find((x) => x.defId === 'envy-1')!;
    expect(t).toBeTruthy();
    resolveTrigger(s, t);
    runStack(s);
    expect(s.control).toBe(0); // 必得（夺对手）
  });

  it('envy-2 middle: draws as many as opponent hand size', () => {
    const s = setup();
    const src = placeSrc(s, 'envy-2', 0, 0);
    s.players[0].deck = Array.from({ length: 6 }, () => makeCard('fire-1', 0, 'deck', false));
    s.players[1].hand = [makeCard('light-1', 1, 'hand'), makeCard('darkness-2', 1, 'hand'), makeCard('fire-3', 1, 'hand')];
    resolveMiddle(s, 0, src);
    expect(s.players[0].hand).toHaveLength(3);
  });

  it('envy-4 middle: flips when opponent compiled more protocols', () => {
    const s = setup();
    const src = placeSrc(s, 'envy-4', 0, 0);
    s.players[1].protocols[0].compiled = true;
    s.players[1].protocols[1].compiled = true; // 对手 2 已编译 > 己 0
    const target = placeSrc(s, 'light-2', 0, 1); // 己方正面卡（可翻目标）
    resolveMiddle(s, 0, src);
    resolveAllChoices(s, eagerPick); // 必翻：选第 1 个候选 = light-2
    expect(target.faceUp).toBe(false);
  });

  it('envy-3 bottom after-play: opponent plays into this line → own deck top face-down here', () => {
    const s = setup();
    s.turnPlayer = 1; // 对手回合
    s.players[1].hand = [makeCard('fire-3', 1, 'hand')];
    s.players[1].deck = [makeCard('fire-1', 1, 'deck', false)];
    s.players[0].deck = [makeCard('light-5', 0, 'deck', false)]; // 己方牌库顶
    placeSrc(s, 'envy-3', 0, 0); // 己方线 0 顶卡
    const card = s.players[1].hand[0];
    executeAction(s, 1, 'play', { cardUid: card.uid, faceUp: false, line: 0 }); // 对手反打线 0 → 触发 envy-3
    resolveAllChoices(s, eagerPick);
    // 己方线 0 堆叠：envy-3 + 新反打牌（light-5 faceDown）
    const stack = s.players[0].stacks[0];
    expect(stack[stack.length - 1].defId).toBe('light-5');
    expect(stack[stack.length - 1].faceUp).toBe(false);
  });
});

// ============ 暴食 gluttony ============

describe('gluttony（暴食）', () => {
  it('gluttony-0 middle: returns any field top card to its owner hand, then draws 1', () => {
    const s = setup();
    const src = placeSrc(s, 'gluttony-0', 0, 0);
    s.players[0].deck = [makeCard('fire-1', 0, 'deck', false), makeCard('fire-2', 0, 'deck', false)];
    const foeTop = placeSrc(s, 'light-3', 1, 1); // 对手场牌
    resolveMiddle(s, 0, src);
    // 弹 select（回手 1 张其他牌）→ 选对手 light-3
    let top = s.pendingEffects[s.pendingEffects.length - 1];
    expect(top?.prompt?.kind).toBe('select');
    answerEffect(s, top.id, [foeTop.uid]);
    resolveAllChoices(s, pickFirst);
    // 回手 = 回其 owner（对手）手牌；然后抽 1
    expect(s.players[1].hand.some((c) => c.uid === foeTop.uid)).toBe(true);
    expect(s.players[1].stacks[1]).toHaveLength(0);
    expect(s.players[0].hand).toHaveLength(1);
  });

  it('gluttony-0 top after-clear-cache: clear-cache → choose line → deck top face-down', () => {
    const s = setup();
    s.turnPlayer = 0;
    s.step = 'check-cache';
    placeSrc(s, 'gluttony-0', 0, 0);
    s.players[0].deck = [makeCard('fire-4', 0, 'deck', false)];
    s.players[0].hand = Array.from({ length: 7 }, (_, i) => makeCard(`fire-${i % 5}`, 0, 'hand'));
    executeAction(s, 0, 'clear-cache'); // 挂起弃 2 张
    resolveAllChoices(s, pickFirst); // 弃 2 → after-clear-cache → gluttony-0 弹选线 → eager 选 line0
    const stack = s.players[0].stacks[0];
    expect(stack[stack.length - 1].defId).toBe('fire-4');
    expect(stack[stack.length - 1].faceUp).toBe(false);
    expect(s.players[0].hand).toHaveLength(5);
  });

  it('gluttony-1 bottom after-any-clear-cache: deletes 1 when any player clears cache', () => {
    const s = setup();
    s.turnPlayer = 0;
    s.step = 'check-cache';
    placeSrc(s, 'gluttony-1', 0, 1); // gluttony-1 顶卡（底命令）
    const victim = placeSrc(s, 'fire-3', 0, 2);
    s.players[0].hand = Array.from({ length: 7 }, (_, i) => makeCard(`light-${i % 5}`, 0, 'hand'));
    executeAction(s, 0, 'clear-cache');
    resolveAllChoices(s, eagerPick); // 弃 2 → after-any-clear-cache → gluttony-1 必删 1 → eager 选候选（顶卡 fire-3? 候选序）
    expect(s.players[0].stacks[2].some((c) => c.uid === victim.uid)).toBe(false);
  });

  it('gluttony-3 top end: covered by a face-up card → delete that cover', () => {
    const s = setup();
    s.turnPlayer = 0;
    s.step = 'end';
    const g3 = placeSrc(s, 'gluttony-3', 0, 0);
    const cover = placeSrc(s, 'fire-2', 0, 0); // faceUp 盖住 gluttony-3
    const t = collectTriggers(s, 'end').find((x) => x.defId === 'gluttony-3')!;
    expect(t).toBeTruthy(); // top 命令被盖仍收集
    resolveTrigger(s, t, { topCommand: t.top });
    runStack(s);
    expect(s.players[0].stacks[0].some((c) => c.uid === cover.uid)).toBe(false); // 覆盖者被删
    expect(s.players[0].stacks[0].some((c) => c.uid === g3.uid)).toBe(true); // gluttony-3 还在
  });
});

// ============ 贪婪 greed ============

describe('greed（贪婪）', () => {
  it('greed-0 middle: discards whole hand, deletes 1, then own bottom after-own-delete draws 1', () => {
    const s = setup();
    const src = placeSrc(s, 'greed-0', 0, 0); // 顶卡 → 底命令（after-own-delete）在场
    s.players[0].hand = [makeCard('fire-1', 0, 'hand'), makeCard('light-2', 0, 'hand')];
    s.players[0].deck = [makeCard('fire-4', 0, 'deck', false)];
    const victim = placeSrc(s, 'light-3', 1, 0); // 删对手的卡
    resolveMiddle(s, 0, src);
    resolveAllChoices(s, eagerPick); // 删 1（选 victim）→ after-own-delete → 自己底抽 1
    // 顺序：弃 2 张手牌 → 删 victim（触发 after-own-delete）→ 底抽 1 → 手 1
    expect(s.players[0].hand).toHaveLength(1);
    expect(s.players[1].stacks[0].some((c) => c.uid === victim.uid)).toBe(false);
    expect(s.players[1].trash.some((c) => c.uid === victim.uid)).toBe(true);
  });

  it('greed-1 bottom end: compiles one line with ≥10 and higher than opponent (owner chooses)', () => {
    const s = setup();
    s.turnPlayer = 0;
    s.step = 'end';
    placeSrc(s, 'greed-1', 0, 1); // 顶卡（底命令）
    // 线 0：己 10 vs 对 5 → 可编译；线 2：己 12 vs 对 3 也可编译 → 弹选线 eager 选 line0
    for (let i = 0; i < 10; i++) placeSrc(s, 'fire-1', 0, 0);
    for (let i = 0; i < 5; i++) placeSrc(s, 'light-1', 1, 0);
    for (let i = 0; i < 12; i++) placeSrc(s, 'darkness-1', 0, 2);
    const t = collectTriggers(s, 'end').find((x) => x.defId === 'greed-1')!;
    expect(t).toBeTruthy();
    resolveTrigger(s, t);
    runStack(s); // 驱动 gen 至挂起（选编译线）
    resolveAllChoices(s, eagerPick); // 控制组件无持有 → 直接选线 line0 → 编译线 0
    expect(s.players[0].protocols[0].compiled).toBe(true);
    expect(s.players[0].stacks[0]).toHaveLength(0); // 编译删双方该线
    expect(s.players[1].stacks[0]).toHaveLength(0);
  });

  it('greed-4 middle: optionally discards hand; if so flips 1', () => {
    const s = setup();
    const src = placeSrc(s, 'greed-4', 0, 0);
    s.players[0].hand = [makeCard('fire-1', 0, 'hand')];
    const target = placeSrc(s, 'light-2', 0, 1);
    resolveMiddle(s, 0, src);
    // 弹 select-action（弃手牌?）→ eager 选 action[0] = 弃置手牌
    let top = s.pendingEffects[s.pendingEffects.length - 1];
    expect(top?.prompt?.kind).toBe('select-action');
    answerEffect(s, top.id, ['action:弃置手牌']);
    resolveAllChoices(s, eagerPick); // 翻 1（选 target）
    expect(s.players[0].hand).toHaveLength(0);
    expect(target.faceUp).toBe(false);
  });
});

// ============ 色欲 lust ============

describe('lust（色欲）', () => {
  it('lust-0 top: both players line values +10; middle: gain control', () => {
    const s = setup();
    placeSrc(s, 'lust-0', 0, 0);
    expect(getLineValue(s, 0, 0)).toBe(10);
    expect(getLineValue(s, 1, 0)).toBe(10);
    const src = s.players[0].stacks[0][0];
    resolveMiddle(s, 0, src); // 中段：获得控制权
    expect(s.control).toBe(0);
  });

  it('lust-0 bottom: holder blocks opponent action compile (lust-0 owner holds)', () => {
    const s = setup();
    s.turnPlayer = 0;
    s.control = 0;
    placeSrc(s, 'lust-0', 0, 0); // P1 的 lust-0 顶卡，P1 持控制权
    for (let i = 0; i < 10; i++) placeSrc(s, 'light-1', 1, 0); // P2 线 0 己 10 vs 对 0 → 本可编译
    expect(getLineValue(s, 1, 0)).toBeGreaterThanOrEqual(10);
    // P2 行动编译被禁：check-compile 无编译项
    s.step = 'check-compile';
    s.turnPlayer = 1;
    expect(() => executeAction(s, 1, 'advance')).not.toThrow(); // 自动过 check-compile（无编译线）
    // 直接编译指令抛错
    expect(() => executeAction(s, 1, 'compile', { line: 0 })).toThrow(/compile/);
  });

  it('lust-2 bottom: player can face-up play any protocol onto this stack; middle shifts opponent covered card here', () => {
    const s = setup();
    const lust2 = placeSrc(s, 'lust-2', 0, 1); // 己方线 1 顶卡
    s.turnPlayer = 0;
    s.step = 'action';
    // 任意协议（fire）可正面打线 1（协议 light，不匹配）
    s.players[0].hand = [makeCard('fire-3', 0, 'hand')];
    expect(isPlayableFaceUp(s, 0, s.players[0].hand[0].uid, 1)).toBe(true);
    // 对手被盖卡可平移到线 1（lust-2 中段）
    const buried = makeCard('darkness-4', 1, 'field', true, 2, 0);
    const top2 = makeCard('fire-1', 1, 'field', true, 2, 1);
    s.players[1].stacks[2] = [buried, top2];
    resolveMiddle(s, 0, lust2);
    let t = s.pendingEffects[s.pendingEffects.length - 1];
    expect(t?.prompt?.kind).toBe('select'); // 可选选对手被盖卡
    answerEffect(s, t.id, [buried.uid]);
    resolveAllChoices(s, pickFirst);
    expect(buried.line).toBe(1); // 平移到线 1（落对手堆叠）
    expect(s.players[1].stacks[1].some((c) => c.uid === buried.uid)).toBe(true);
  });

  it('lust-3 middle: random reveal of opponent hand card then face-down to chosen line (owner side of opponent)', () => {
    const s = setup();
    const src = placeSrc(s, 'lust-3', 0, 0);
    const foeHand = [makeCard('light-5', 1, 'hand'), makeCard('fire-2', 1, 'hand')] as const;
    s.players[1].hand = [...foeHand];
    // 随机取牌必须走**状态随机源**（randPick(ctx.s, …)），而非 Math.random。
    // 把随机源钉成固定状态（seed + n=0）后，"取第几张"完全可预期：
    // 该状态下 randInt(s, 2) === 1 → 必然取到 foeHand[1]（fire-2）。
    // 仅断言"rng.n 被推进 / 取到的牌 ∈ 对手手牌"是近乎恒真的弱断言，钉不住选择，故下面钉到具体那张。
    s.rng.seed = 'lust-3-pin';
    s.rng.n = 0;
    resolveMiddle(s, 0, src);
    expect(s.rng.n).toBe(1); // 恰好消耗一次随机（没消耗/多消耗都算偏离）
    let top = s.pendingEffects[s.pendingEffects.length - 1];
    expect(top?.prompt?.kind).toBe('select-line'); // 拥有者选线
    answerEffect(s, top.id, ['line:2']);
    resolveAllChoices(s, pickFirst);
    const foeStack = s.players[1].stacks[2];
    expect(foeStack.length).toBe(1); // 随机牌反打到对手线 2（对手自己堆叠）
    // 钉死"反打的正是随机取出的那一张"（固定随机源 → 下标 1，而非仅"是手牌之一"）
    expect(foeStack[0].uid).toBe(foeHand[1].uid);
    expect(foeStack[0].defId).toBe('fire-2');
    expect(foeStack[0].faceUp).toBe(false);
    expect(foeStack[0].owner).toBe(1);
    expect(s.players[1].hand).toHaveLength(1);
  });

  it('lust-4 middle: reveals own hand, opponent loses control; bottom triggers when opponent gains control', () => {
    const s = setup();
    const src = placeSrc(s, 'lust-4', 0, 0);
    s.control = 1; // 对手持有
    s.players[0].hand = [makeCard('fire-1', 0, 'hand'), makeCard('light-2', 0, 'hand')];
    s.players[0].deck = [makeCard('fire-4', 0, 'deck', false)];
    resolveMiddle(s, 0, src); // 揭示自己手牌（幽灵）→ 对手失去控制权
    resolveAllChoices(s, pickFirst);
    expect(s.control).toBe(-1); // 对手失去 → 中立
    // 底：当对手（P2）获得控制权后 → 抽 1（原 2 张手牌 + 1 = 3）
    setControl(s, 1);
    runStack(s);
    expect(s.players[0].hand).toHaveLength(3);
  });

  it('lust-6 middle: discard 1, then opponent plays 1 face-down from hand into this line (opponent side)', () => {
    const s = setup();
    const src = placeSrc(s, 'lust-6', 0, 0);
    const myCard = makeCard('fire-1', 0, 'hand');
    s.players[0].hand = [myCard];
    s.players[1].hand = [makeCard('light-3', 1, 'hand')];
    resolveMiddle(s, 0, src);
    // 第一步挂起：自己弃 1（chooser 缺省 = 效果属主）
    let top = s.pendingEffects[s.pendingEffects.length - 1];
    expect(top?.prompt?.kind).toBe('select');
    answerEffect(s, top.id, [myCard.uid]);
    // 第二步挂起：对手（chooser=1）从手牌选 1 张反打
    top = s.pendingEffects[s.pendingEffects.length - 1];
    expect(top?.prompt?.kind).toBe('select');
    expect(top?.prompt?.chooser).toBe(1);
    const foeCard = s.players[1].hand[0];
    answerEffect(s, top.id, [foeCard.uid]);
    resolveAllChoices(s, pickFirst);
    expect(s.players[0].hand).toHaveLength(0);
    const foeStack = s.players[1].stacks[0];
    expect(foeStack.some((c) => c.uid === foeCard.uid)).toBe(true); // 对手自己堆叠线 0
    expect(foeStack[foeStack.length - 1].faceUp).toBe(false);
  });
});

// ============ 傲慢 pride ============

describe('pride（傲慢）', () => {
  it('pride-0 top after-self-compile: refreshes to 5 after own compile', () => {
    const s = setup();
    s.turnPlayer = 0;
    placeSrc(s, 'pride-0', 0, 1); // 放非编译线（编译线 0 的卡会被删除，顶命令卡自身须存活才触发）
    s.players[0].hand = [makeCard('fire-1', 0, 'hand')];
    s.players[0].deck = Array.from({ length: 6 }, () => makeCard('fire-2', 0, 'deck', false));
    for (let i = 0; i < 10; i++) placeSrc(s, 'fire-1', 0, 0); // 线 0 己 10
    for (let i = 0; i < 3; i++) placeSrc(s, 'light-1', 1, 0);
    executeAction(s, 0, 'compile', { line: 0 });
    resolveAllChoices(s, pickFirst); // after-self-compile → 刷新抽至 5（compile 前手 1 → 补 4 → 手 5）
    expect(s.players[0].protocols[0].compiled).toBe(true);
    expect(s.players[0].hand).toHaveLength(5);
  });

  it('pride-0 middle: control held → shift any other card; else own card', () => {
    const s = setup();
    s.control = 0;
    const src = placeSrc(s, 'pride-0', 0, 0);
    const foeTop = placeSrc(s, 'light-2', 1, 1);
    resolveMiddle(s, 0, src);
    let top = s.pendingEffects[s.pendingEffects.length - 1];
    expect(top?.prompt?.kind).toBe('select');
    answerEffect(s, top.id, [foeTop.uid]); // 持控制权 → 可移对手卡
    top = s.pendingEffects[s.pendingEffects.length - 1];
    expect(top?.prompt?.kind).toBe('select-line'); // 选目标线（≠原线 1）→ eager line0
    answerEffect(s, top.id, ['line:0']);
    expect(foeTop.line).toBe(0);
    expect(s.players[1].stacks[0].some((c) => c.uid === foeTop.uid)).toBe(true);
  });

  it('pride-2 middle: draws per line where own total is higher', () => {
    const s = setup();
    const src = placeSrc(s, 'pride-2', 0, 0); // 线 0 己 2（pride-2 值 2）
    s.players[0].deck = Array.from({ length: 6 }, () => makeCard('fire-1', 0, 'deck', false));
    for (let i = 0; i < 5; i++) placeSrc(s, 'fire-1', 1, 0); // 对手线 0 = 5 → 线 0 不高
    for (let i = 0; i < 5; i++) placeSrc(s, 'fire-1', 0, 1); // 线 1 己 5
    for (let i = 0; i < 2; i++) placeSrc(s, 'light-1', 1, 1); // 对 2 → 己高于
    for (let i = 0; i < 4; i++) placeSrc(s, 'fire-1', 0, 2); // 线 2 己 4
    for (let i = 0; i < 1; i++) placeSrc(s, 'light-1', 1, 2); // 对 1 → 己高于
    resolveMiddle(s, 0, src); // 线 1、2 高于 → 抽 2
    resolveAllChoices(s, pickFirst);
    expect(s.players[0].hand).toHaveLength(2);
  });

  it('pride-6 middle flips self when opponent holds control; top flips when opponent gains control', () => {
    const s = setup();
    s.control = 1; // 对手持
    const p6 = placeSrc(s, 'pride-6', 0, 0);
    resolveMiddle(s, 0, p6);
    expect(p6.faceUp).toBe(false); // 翻自己（faceUp → faceDown）
    // 翻回正面（同向再触发中段？直接改状态模拟）→ 测顶命令：对手获得控制权
    p6.faceUp = true;
    setControl(s, 0); // 无变化（control 已 0？）——改由对手视角：p6 owner=0，其对手=1 获得
    setControl(s, 1);
    runStack(s); // after-opponent-gain-control（actor=1 → 遍历 0 侧顶卡）→ pride-6 顶翻转
    expect(p6.faceUp).toBe(false);
  });

  it('check-control gain fires after-opponent-gain-control (pride-6 top flip via advance)', () => {
    const s = setup();
    s.turnPlayer = 1; // P2 回合控制阶段
    s.step = 'check-control';
    const p6 = placeSrc(s, 'pride-6', 0, 2); // P1 的 pride-6（线 2，值 6 不干扰 P2 领先线）
    for (let i = 0; i < 7; i++) placeSrc(s, 'light-1', 1, 0); // P2 线 0 = 7 > P1 0
    for (let i = 0; i < 7; i++) placeSrc(s, 'light-1', 1, 1); // 线 1 也领先 → P2 ≥2 线
    executeAction(s, 1, 'advance'); // check-control → P2 获得 → 触发 P1 傲慢6 顶翻转
    expect(s.control).toBe(1);
    expect(p6.faceUp).toBe(false);
  });
});
