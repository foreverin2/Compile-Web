import { describe, it, expect } from 'vitest';
import type { ChoiceRequest, GameState, Line, PlayerId } from '../../src/core/models/types';
import { createGame, getLineValue } from '../../src/core/state/create';
import { resolveMiddle, runStack, answerEffect } from '../../src/core/effects/resolve';
import { collectTriggers, resolveTrigger, fireReactive, collectTriggerFor } from '../../src/core/effects/triggers';
import { executeAction } from '../../src/core/game';
import { makeCard, pickFirst, resolveAllChoices } from '../helpers';

/**
 * 3代 批3（动量/新星/惰性/僵化/灵活）效果测试——代表性用例。
 * 卡文：src/data/cards3.ts（compile3文本.txt）；裁决：docs/3代-批3-规格与裁决清单.md。
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

// ============ 动量 momentum ============

describe('momentum（动量）', () => {
  it('momentum-0 middle: plays deck top face-down into each line with any compiled protocol', () => {
    const s = setup();
    const src = placeSrc(s, 'momentum-0', 0, 0);
    s.players[1].protocols[1].compiled = true; // 对手线 1 已编译（C1：任一玩家算）
    s.players[0].protocols[2].compiled = true; // 己方线 2 已编译
    s.players[0].deck = [makeCard('fire-1', 0, 'deck', false), makeCard('light-2', 0, 'deck', false)];
    resolveMiddle(s, 0, src); // 线 1、2 反打
    expect(s.players[0].stacks[1]).toHaveLength(1);
    expect(s.players[0].stacks[2]).toHaveLength(1);
    expect(s.players[0].deck).toHaveLength(0);
  });

  it('momentum-1 top after-any-compile: plays deck top onto own stack; momentum-6 top deletes itself', () => {
    const s = setup();
    s.turnPlayer = 0;
    placeSrc(s, 'momentum-1', 0, 1);
    s.players[0].deck = [makeCard('fire-1', 0, 'deck', false)];
    for (let i = 0; i < 10; i++) placeSrc(s, 'fire-1', 0, 0);
    for (let i = 0; i < 3; i++) placeSrc(s, 'light-1', 1, 0);
    executeAction(s, 0, 'compile', { line: 0 });
    resolveAllChoices(s, pickFirst);
    expect(s.players[0].stacks[1]).toHaveLength(2); // momentum-1 + 牌库顶
    // momentum-6：任意编译后删自己
    const s2 = setup();
    s2.turnPlayer = 0;
    const m6 = placeSrc(s2, 'momentum-6', 0, 1);
    for (let i = 0; i < 10; i++) placeSrc(s2, 'fire-1', 0, 0);
    for (let i = 0; i < 3; i++) placeSrc(s2, 'light-1', 1, 0);
    executeAction(s2, 0, 'compile', { line: 0 });
    resolveAllChoices(s2, pickFirst);
    expect(s2.players[0].stacks[1].some((c) => c.uid === m6.uid)).toBe(false); // 被删
  });

  it('momentum-4 middle reorders protocols and fires after-any-rearrange (momentum-1 bottom)', () => {
    const s = setup();
    const src = placeSrc(s, 'momentum-4', 0, 0);
    const m1 = placeSrc(s, 'momentum-1', 0, 2); // momentum-1 顶卡（底命令）在线 2
    s.players[0].deck = [makeCard('fire-1', 0, 'deck', false)];
    s.players[0].hand = [makeCard('light-2', 0, 'hand')];
    const before = s.players[0].protocols.map((p) => p.defId);
    resolveMiddle(s, 0, src);
    // 弹布局选择（eager 取 'action:order:021'）
    let top = s.pendingEffects[s.pendingEffects.length - 1];
    expect(top?.prompt?.kind).toBe('select-action');
    // 2026-09-13（用户清单 #10）：该请求标记 rearrangeSide → UI 由重排窗口承接（不再弹 5 个布局按钮）；
    // 引擎侧仍是同一条 action:order:XYZ（窗口完成后回填），所以下面这条应答路径保持不变。
    expect(top?.prompt?.rearrangeSide).toBe(0);
    expect(top?.prompt?.actions?.length).toBe(5);
    answerEffect(s, top.id, ['action:order:210']);
    // after-any-rearrange → momentum-1 底弃 1 抽 1
    resolveAllChoices(s, pickFirst);
    const after = s.players[0].protocols.map((p) => p.defId);
    expect(after[0]).toBe(before[2]); // order 210：新 0 = 原 2
    expect(s.players[0].hand.some((c) => c.defId === 'light-2')).toBe(false); // 弃 1
    expect(s.players[0].hand).toHaveLength(1); // 抽 1（deck 1 张）
    expect(m1.faceUp).toBe(true);
  });
});

// ============ 新星 nova ============

describe('nova（新星）', () => {
  it('nova-2 middle: covers a nova card → optional reorder; else gains control (must)', () => {
    // else 分支：下方非 nova → 必得控制权
    const s = setup();
    const src = placeSrc(s, 'nova-2', 0, 0); // 无下方卡
    resolveMiddle(s, 0, src);
    expect(s.control).toBe(0);
    // 覆盖 nova：下方垫 nova-1 → 弹布局（可选）
    const s2 = setup();
    placeSrc(s2, 'nova-1', 0, 0);
    const src2 = placeSrc(s2, 'nova-2', 0, 0); // nova-2 盖在 nova-1 上
    resolveMiddle(s2, 0, src2);
    const top = s2.pendingEffects[s2.pendingEffects.length - 1];
    expect(top?.prompt?.kind).toBe('select-action'); // 可重排（optional）
    s2.pendingEffects.length = 0; // 跳过重排
    expect(s2.control).toBe(-1); // 未获得控制权
  });

  it('nova-2 middle：下方是**反面**新星牌不算「覆盖着1张新星牌」（用户 2026-09-13 裁决：必须正面）', () => {
    const s = setup();
    const below = placeSrc(s, 'nova-1', 0, 0);
    below.faceUp = false; // 反面：身份未公开，不能算新星牌
    const src2 = placeSrc(s, 'nova-2', 0, 0);
    resolveMiddle(s, 0, src2);
    expect(s.pendingEffects.filter((e) => e.prompt).length, '反面下方卡不应走"可重排"分支').toBe(0);
    expect(s.control).toBe(0); // else 分支：必得控制权
  });

  it('nova-0 bottom end: deck top face-down under a chosen uncovered nova card (belowUid)', () => {
    const s = setup();
    s.turnPlayer = 0;
    s.step = 'end';
    const target = placeSrc(s, 'nova-1', 0, 2); // 己方线 2 的未覆盖 nova
    placeSrc(s, 'nova-0', 0, 0); // nova-0 顶卡（底命令触发）
    s.players[0].deck = [makeCard('fire-1', 0, 'deck', false)];
    const t = collectTriggers(s, 'end').find((x) => x.defId === 'nova-0')!;
    resolveTrigger(s, t);
    runStack(s);
    const top = s.pendingEffects[s.pendingEffects.length - 1];
    expect(top?.prompt?.kind).toBe('select');
    answerEffect(s, top.id, [target.uid]);
    resolveAllChoices(s, pickFirst);
    const stack = s.players[0].stacks[2];
    expect(stack).toHaveLength(2);
    expect(stack[stack.length - 1].uid).toBe(target.uid); // nova-1 仍未被覆盖（新卡垫其下）
    expect(stack[0].defId).toBe('fire-1'); // 垫在正下方
    expect(stack[0].faceUp).toBe(false);
  });

  it('nova-0 middle: control holder swaps nova player two protocol positions (chooser=holder)', () => {
    const s = setup();
    const src = placeSrc(s, 'nova-0', 0, 1);
    s.control = 1; // 对手持有控制权 → 对手选 nova 方协议位
    const before = s.players[0].protocols.map((p) => p.defId);
    resolveMiddle(s, 0, src);
    let top = s.pendingEffects[s.pendingEffects.length - 1];
    expect(top?.prompt?.kind).toBe('select-line');
    expect(top?.prompt?.chooser).toBe(1);
    answerEffect(s, top.id, ['line:0']);
    top = s.pendingEffects[s.pendingEffects.length - 1];
    answerEffect(s, top.id, ['line:2']);
    resolveAllChoices(s, pickFirst);
    const after = s.players[0].protocols.map((p) => p.defId);
    expect(after[0]).toBe(before[2]);
    expect(after[2]).toBe(before[0]);
  });
});

// ============ 惰性 inertia ============

describe('inertia（惰性）', () => {
  it('inertia-0 top disables top-command value modifiers on this line (other cards)', () => {
    const s = setup();
    placeSrc(s, 'inertia-0', 0, 0); // 线 0 禁顶
    placeSrc(s, 'envy-0', 1, 0); // 对手线 0 的 envy-0（顶命令值修正）——被禁
    placeSrc(s, 'light-4', 1, 0); // 对手线 0 最高 4
    expect(getLineValue(s, 1, 0)).toBe(4); // envy-0 修正失效（C7：顶命令被禁）
    // 无 inertia-0 时 envy-0 修正生效（对照组）
    const s2 = setup();
    placeSrc(s2, 'envy-0', 1, 0);
    placeSrc(s2, 'light-4', 1, 0);
    expect(getLineValue(s2, 1, 0)).toBe(4 + 0); // 己方无卡 → 对手最高 0？envy-0 修正看估值方对手堆叠（0 方空）
    const s3 = setup();
    placeSrc(s3, 'envy-0', 1, 0);
    placeSrc(s3, 'light-4', 1, 0);
    placeSrc(s3, 'fire-3', 0, 0); // 己方线 0 有卡 → envy-0 生效（own-stack：**只加持有者自己**）
    expect(getLineValue(s3, 1, 0)).toBe(4 + 3); // P2（嫉妒0 持有者）：light-4(4) + 对手（P1）最高 fire-3
    expect(getLineValue(s3, 0, 0)).toBe(3); // P1：**不吃** P2 的嫉妒0 加成（2026-09-13 修正 line→own-stack）
  });

  it('inertia-1 bottom disables lust-0 compile-block guard on that line', () => {
    const s = setup();
    s.control = 0;
    placeSrc(s, 'inertia-1', 0, 0); // 线 0 禁底（inertia-1 顶卡）
    placeSrc(s, 'lust-0', 1, 0); // 对手线 0 顶卡 lust-0（底命令禁编译守卫）——底被禁 → 失效
    for (let i = 0; i < 10; i++) placeSrc(s, 'light-1', 1, 0); // 对手线 0 己 10
    s.turnPlayer = 1;
    s.step = 'check-compile';
    // lust-0 底失效 → P2 可编译（executeCompile 不再抛）
    expect(() => executeAction(s, 1, 'compile', { line: 0 })).not.toThrow();
  });

  it('inertia-2 middle: flips all highest-printed-value face-up cards (incl. covered) in chosen line', () => {
    const s = setup();
    const src = placeSrc(s, 'inertia-2', 0, 1);
    const buried = placeSrc(s, 'light-4', 1, 0); // 被盖 faceUp 值 4（最高）
    const low = placeSrc(s, 'fire-1', 1, 0); // 值 1
    placeSrc(s, 'darkness-2', 1, 0); // 盖住
    resolveMiddle(s, 0, src);
    resolveAllChoices(s, eagerPick); // 选线 0 → 翻值 4 那张
    expect(buried.faceUp).toBe(false);
    expect(low.faceUp).toBe(true);
  });

  it('inertia-2 middle：目标含【自身】（卡文"所有正面朝上的牌"）——2026-09-13 用户实测', () => {
    const s = setup();
    // 线 0：先放己方 fire-1（值 1），再放 inertia-2（印刷值 2）使其为**顶卡**（未被盖 → 中部指令可结算）
    const low = placeSrc(s, 'fire-1', 0, 0);
    const src = placeSrc(s, 'inertia-2', 0, 0);
    resolveMiddle(s, 0, src);
    resolveAllChoices(s, eagerPick); // 选线 0
    expect(src.faceUp, 'inertia-2 自身未被翻（旧实现排除了源卡）').toBe(false);
    expect(low.faceUp, '低值卡不应被翻').toBe(true);
  });

  it('inertia-4 middle: discards whole decks (both) in one batch', () => {
    const s = setup();
    const src = placeSrc(s, 'inertia-4', 0, 0);
    s.players[0].deck = [makeCard('fire-1', 0, 'deck', false), makeCard('light-2', 0, 'deck', false)];
    s.players[1].deck = [makeCard('darkness-3', 1, 'deck', false)];
    resolveMiddle(s, 0, src);
    expect(s.players[0].deck).toHaveLength(0);
    expect(s.players[0].trash).toHaveLength(2);
    expect(s.players[1].deck).toHaveLength(0);
    expect(s.players[1].trash).toHaveLength(1);
    for (const c of [...s.players[0].trash, ...s.players[1].trash]) expect(c.faceUp).toBe(true); // 公开
  });
});

// ============ 僵化 rigidity ============

describe('rigidity（僵化）', () => {
  it('rigidity-7 bottom: cannot be flipped or shifted while uncovered; can after covered', () => {
    const s = setup();
    const r7 = placeSrc(s, 'rigidity-7', 0, 0); // 顶卡（值 7）
    resolveMiddle(s, 0, r7); // rigidity-7 中段弃1 → 手牌空 fizzle 无碍
    // 借【对手】的 rigidity-1 中段（翻 P1 的 faceUp 卡）选中 r7 → flip 守卫应跳过
    const r1 = placeSrc(s, 'rigidity-1', 1, 1); // 对手场上的 rigidity-1（顶卡）
    resolveMiddle(s, 1, r1);
    const top = s.pendingEffects[s.pendingEffects.length - 1];
    expect(top?.prompt?.kind).toBe('select');
    expect(top?.prompt?.candidates?.some((c) => c.uid === r7.uid)).toBe(true); // 候选出现（UI 可点）
    answerEffect(s, top.id, [r7.uid]); // 选 r7 → flip 守卫跳过
    expect(r7.faceUp).toBe(true); // 未被翻转
    expect(s.log.some((l) => l.includes('不可被翻转'))).toBe(true);
  });

  it('rigidity-3 middle: plays chosen hand card face-down directly under itself (belowUid)', () => {
    const s = setup();
    const r3 = placeSrc(s, 'rigidity-3', 0, 0);
    const hand = makeCard('light-2', 0, 'hand');
    s.players[0].hand = [hand];
    resolveMiddle(s, 0, r3);
    const top = s.pendingEffects[s.pendingEffects.length - 1];
    expect(top?.prompt?.kind).toBe('select');
    answerEffect(s, top.id, [hand.uid]);
    resolveAllChoices(s, pickFirst);
    const stack = s.players[0].stacks[0];
    expect(stack).toHaveLength(2);
    expect(stack[0].uid).toBe(hand.uid); // 垫在 rigidity-3 正下方
    expect(stack[1].uid).toBe(r3.uid); // rigidity-3 仍未被覆盖
    expect(hand.faceUp).toBe(false);
  });

  it('rigidity-2 bottom after-action-face-down-play: deck top onto the same stack', () => {
    const s = setup();
    s.turnPlayer = 0;
    s.step = 'action';
    placeSrc(s, 'rigidity-2', 0, 1); // rigidity-2 顶卡在己方线 1
    s.players[0].deck = [makeCard('fire-1', 0, 'deck', false)];
    s.players[0].hand = [makeCard('light-3', 0, 'hand')];
    const card = s.players[0].hand[0];
    executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: false, line: 0 }); // 行动反打线 0
    resolveAllChoices(s, pickFirst);
    // 线 0：light-3 + 牌库顶 fire-1
    const stack = s.players[0].stacks[0];
    expect(stack).toHaveLength(2);
    expect(stack[stack.length - 1].defId).toBe('fire-1');
  });

  it('rigidity-4 bottom before-covered: draws only when covered by a face-down card', () => {
    const s = setup();
    const r4 = placeSrc(s, 'rigidity-4', 0, 0);
    s.players[0].deck = [makeCard('fire-1', 0, 'deck', false)];
    // P1 自己行动反面打出线 0 → 盖住 r4（faceDown incoming）→ before-covered 触发 → 抽 1
    s.turnPlayer = 0;
    s.step = 'action';
    s.players[0].hand = [makeCard('darkness-3', 0, 'hand')];
    const c2 = s.players[0].hand[0];
    executeAction(s, 0, 'play', { cardUid: c2.uid, faceUp: false, line: 0 });
    resolveAllChoices(s, pickFirst);
    expect(s.players[0].hand).toHaveLength(1); // 先抽 1（rigidity-4 底）
    expect(r4.faceUp).toBe(true); // r4 仍在（被盖）
  });
});

// ============ 灵活 flexibility ============

describe('flexibility（灵活）', () => {
  it('flexibility-0 middle: return or shift a card (select-action first)', () => {
    const s = setup();
    const src = placeSrc(s, 'flexibility-0', 0, 0);
    const foeTop = placeSrc(s, 'light-2', 1, 1);
    resolveMiddle(s, 0, src);
    let top = s.pendingEffects[s.pendingEffects.length - 1];
    expect(top?.prompt?.kind).toBe('select-action');
    answerEffect(s, top.id, ['action:return']);
    top = s.pendingEffects[s.pendingEffects.length - 1];
    answerEffect(s, top.id, [foeTop.uid]);
    resolveAllChoices(s, pickFirst);
    expect(s.players[1].hand.some((c) => c.uid === foeTop.uid)).toBe(true); // 回其主
  });

  it('flexibility-3 middle: shift opponent card or swap own 2 protocols', () => {
    const s = setup();
    const src = placeSrc(s, 'flexibility-3', 0, 0);
    const foeTop = placeSrc(s, 'light-2', 1, 1);
    const before = s.players[0].protocols.map((p) => p.defId);
    resolveMiddle(s, 0, src);
    let top = s.pendingEffects[s.pendingEffects.length - 1];
    expect(top?.prompt?.kind).toBe('select-action');
    answerEffect(s, top.id, ['action:swap']); // 选交换协议
    top = s.pendingEffects[s.pendingEffects.length - 1];
    answerEffect(s, top.id, ['line:0']);
    top = s.pendingEffects[s.pendingEffects.length - 1];
    answerEffect(s, top.id, ['line:2']);
    resolveAllChoices(s, pickFirst);
    const after = s.players[0].protocols.map((p) => p.defId);
    expect(after[0]).toBe(before[2]);
    expect(after[2]).toBe(before[0]);
    expect(s.players[1].stacks[1].some((c) => c.uid === foeTop.uid)).toBe(true); // 对手卡未动
  });

  it('flexibility-4 bottom end: optional draw 2 then flip self', () => {
    const s = setup();
    s.turnPlayer = 0;
    s.step = 'end';
    const f4 = placeSrc(s, 'flexibility-4', 0, 0);
    s.players[0].deck = [makeCard('fire-1', 0, 'deck', false), makeCard('light-2', 0, 'deck', false)];
    const t = collectTriggers(s, 'end').find((x) => x.defId === 'flexibility-4')!;
    resolveTrigger(s, t);
    runStack(s);
    // 显式选择「抽 2 并翻转」（eagerPick 对 optional 会跳过）
    let top = s.pendingEffects[s.pendingEffects.length - 1];
    expect(top?.prompt?.kind).toBe('select-action');
    answerEffect(s, top.id, ['action:draw']);
    resolveAllChoices(s, pickFirst);
    expect(s.players[0].hand).toHaveLength(2);
    expect(f4.faceUp).toBe(false); // 翻转此牌
  });

  it('flexibility-1 middle：候选含【自身】（卡文"翻转或偏转你的1张牌"）——2026-09-13 用户实测', () => {
    const s = setup();
    const src = placeSrc(s, 'flexibility-1', 0, 0); // 己方唯一场牌 = 此牌自身（顶卡）
    resolveMiddle(s, 0, src);
    runStack(s);
    const act = s.pendingEffects[s.pendingEffects.length - 1];
    expect(act?.prompt?.kind).toBe('select-action');
    answerEffect(s, act!.id, ['action:flip']);
    runStack(s);
    const sel = s.pendingEffects[s.pendingEffects.length - 1];
    expect(sel?.prompt?.kind).toBe('select');
    const uids = (sel?.prompt?.candidates ?? []).map((c) => c.uid);
    expect(uids, 'flexibility-1 的候选未包含自身（旧实现排除源卡）').toContain(src.uid);
  });

  // ——— 2026-09-13 全协议同类审计（用户要求"看看别的卡有没有同样的没修的 bug"）———

  it('greed-2 底：回手候选含【自身】（卡文"回手1张你的牌"无"其他"，与 flexibility-1 同构）', () => {
    const s = setup();
    s.turnPlayer = 0;
    s.step = 'start';
    const src = placeSrc(s, 'greed-2', 0, 0);
    placeSrc(s, 'fire-1', 0, 1); // 另一条线有顶卡 → 触发 cond 成立（自身仍是合法候选）
    const t = collectTriggers(s, 'start').find((x) => x.defId === 'greed-2')!;
    resolveTrigger(s, t);
    runStack(s);
    const sel = s.pendingEffects[s.pendingEffects.length - 1];
    expect(sel?.prompt?.kind).toBe('select');
    const uids = (sel?.prompt?.candidates ?? []).map((c) => c.uid);
    expect(uids, 'greed-2 的候选未包含自身').toContain(src.uid);
  });

  it('pride-0 中（无控制权分支）：偏转候选含【自身】（持控制权分支文本写"其他牌"→ 排除自身）', () => {
    const s = setup();
    const src = placeSrc(s, 'pride-0', 0, 0);
    s.control = -1; // 无控制权 → 「偏转1张你的牌」
    resolveMiddle(s, 0, src);
    runStack(s);
    const sel = s.pendingEffects[s.pendingEffects.length - 1];
    expect(sel?.prompt?.kind).toBe('select');
    const uids = (sel?.prompt?.candidates ?? []).map((c) => c.uid);
    expect(uids, 'pride-0（无控制权）的候选未包含自身').toContain(src.uid);
  });

  it('rigidity-4 底：覆盖者来自【偏转】（pendingShift）也应触发抽1（与 unity-0 同类，旧版只查 pendingPlay）', () => {    const s = setup();
    s.turnPlayer = 0;
    const src = placeSrc(s, 'rigidity-4', 0, 0);
    s.players[0].deck = [makeCard('fire-1', 0, 'deck', false)];
    // 一张反面牌被"偏转"到本线（浮空中、line 已指向目标线，尚未落地）
    const incoming = makeCard('light-2', 1, 'float', false, 0, 0);
    s.pendingShift.push({ card: incoming, beforeCoveredDone: false });
    // 走引擎真实路径：偏转落地前收集 before-covered 触发（completeShift 同款调用）
    const t = collectTriggerFor(s, src, 'before-covered');
    expect(t, 'rigidity-4 的 before-covered 触发未被收集').toBeTruthy();
    resolveTrigger(s, t!);
    runStack(s);
    expect(s.players[0].hand).toHaveLength(1); // 抽了 1 张（旧实现：pendingPlay 为空 → 不抽）
  });
});

