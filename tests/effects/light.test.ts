import { describe, it, expect } from 'vitest';
import type { GameState, Line } from '../../src/core/models/types';
import { executeAction, getLegalActions } from '../../src/core/game';
import { collectTriggers } from '../../src/core/effects/triggers';
import { makeCard, pickFirst, resolveAllChoices, draftLightP1, advanceToStep } from '../helpers';

function lightLine(s: GameState): Line {
  const idx = s.players[0].protocols.findIndex((p) => p.defId === 'light');
  return idx as Line;
}

describe('light protocol effects', () => {
  it('light-0: flip a face-down card face-up, draw its face value (3)', () => {
    const s = draftLightP1();
    advanceToStep(s, 0, 'action');
    s.players[0].hand = [makeCard('light-0', 0, 'hand')];
    // 目标：分值 3 的反面牌（light-3）——翻正后其自身中指令会连锁（本线无反面包 → 直接结束）
    const facedown = makeCard('light-3', 1, 'field', false, 1, 0);
    s.players[1].stacks[1] = [facedown];
    const card = s.players[0].hand[0];
    executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: true, line: lightLine(s) });
    resolveAllChoices(s, (p) => {
      if (p.kind === 'select-line') return ['line:0']; // 连锁的 light-3 中指令：选目标线
      if (p.candidates.some((c) => c.uid === facedown.uid)) return [facedown.uid];
      return pickFirst(p);
    });
    expect(facedown.faceUp).toBe(true); // 翻转目标（反面 → 正面）
    expect(s.players[0].hand).toHaveLength(3); // 抽翻转后（正面）分值张（3）
  });

  it('light-0: flip a face-up card face-down, draw 2 (the post-flip face-down value)', () => {
    const s = draftLightP1();
    advanceToStep(s, 0, 'action');
    s.players[0].hand = [makeCard('light-0', 0, 'hand')];
    // 目标：分值 3 的正面牌（light-3）——翻转后成反面 → 抽反面分值 2（不再是 3）
    const faceup = makeCard('light-3', 1, 'field', true, 1, 0);
    s.players[1].stacks[1] = [faceup];
    const card = s.players[0].hand[0];
    executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: true, line: lightLine(s) });
    resolveAllChoices(s, (p) => {
      if (p.candidates.some((c) => c.uid === faceup.uid)) return [faceup.uid];
      return pickFirst(p);
    });
    expect(faceup.faceUp).toBe(false); // 翻转目标（正面 → 反面）
    expect(s.players[0].hand).toHaveLength(2); // 抽反面分值（2）
  });

  it('light-0: face-down draw is 4 when a face-up darkness-2 tops the same line (not hardcoded 2)', () => {
    const s = draftLightP1();
    advanceToStep(s, 0, 'action');
    s.players[0].hand = [makeCard('light-0', 0, 'hand')];
    // 同线（线 1）有一张正面 darkness-2（被 light-3 盖住但正面朝上 → 常驻生效）
    const dark2 = makeCard('darkness-2', 0, 'field', true, 1, 0);
    const faceup = makeCard('light-3', 0, 'field', true, 1, 1);
    s.players[0].stacks[1] = [dark2, faceup];
    const card = s.players[0].hand[0];
    executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: true, line: lightLine(s) });
    resolveAllChoices(s, (p) => {
      if (p.candidates.some((c) => c.uid === faceup.uid)) return [faceup.uid];
      return pickFirst(p);
    });
    expect(faceup.faceUp).toBe(false); // 翻转目标（正面 → 反面）
    expect(s.players[0].hand).toHaveLength(4); // 暗2 顶命令修正：反面分值 4
  });

  it('light-1 end trigger: mandatory draw 1 (no skip)', () => {
    const s = draftLightP1();
    advanceToStep(s, 0, 'action');
    s.players[0].stacks[0] = [makeCard('light-1', 0, 'field', true, 0, 0)];
    const handBefore = s.players[0].hand.length;
    advanceToStep(s, 0, 'end');
    const t = collectTriggers(s, 'end').find((x) => x.cardUid === s.players[0].stacks[0][0].uid);
    expect(t).toBeDefined();
    expect(t!.optional).toBe(false); // 必选：无跳过
    // 必选触发未结算时：不允许 advance 跳过
    expect(getLegalActions(s, 0).some((a) => a.kind === 'advance')).toBe(false);
    expect(() => executeAction(s, 0, 'advance')).toThrow(/mandatory trigger/);
    // 经游戏 resolve-trigger 行动路径结算 → 抽 1
    executeAction(s, 0, 'resolve-trigger', { cardUid: t!.cardUid });
    resolveAllChoices(s, pickFirst); // 无选择步骤（直接抽 1），无害
    expect(s.players[0].hand).toHaveLength(handBefore + 1);
    expect(s.pendingEffects).toHaveLength(0);
  });

  it('light-2: effect player (P1) decides — flip (choice does not follow the revealed card owner)', () => {
    const s = draftLightP1();
    advanceToStep(s, 0, 'action');
    s.players[0].hand = [makeCard('light-2', 0, 'hand')];
    const facedown = makeCard('light-1', 1, 'field', false, 1, 0);
    s.players[1].stacks[1] = [facedown];
    const card = s.players[0].hand[0];
    executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: true, line: lightLine(s) });
    // 第一步：light-2 选要揭示的反面牌（效果属主 P1 应答）
    const p1 = s.pendingEffects[s.pendingEffects.length - 1];
    expect(p1.prompt?.kind).toBe('select');
    executeAction(s, 0, 'effect-choice', { promptId: p1.id, choice: [facedown.uid] });
    // 揭示 → 幽灵牌产生，挂起 select-action，chooser = 打出 light-2 的玩家（P1），
    // 无论被揭示卡持有者是谁（卡牌可能易主）
    expect(s.revealedGhosts).toHaveLength(1);
    const p2 = s.pendingEffects[s.pendingEffects.length - 1];
    expect(p2.prompt?.kind).toBe('select-action');
    expect(p2.prompt?.chooser).toBe(0);
    // 被揭示卡持有者（P2）无选择权
    expect(() => executeAction(s, 1, 'effect-choice', { promptId: p2.id, choice: ['action:flip'] })).toThrow(/not your choice/);
    // 效果属主 P1 决定：翻转
    executeAction(s, 0, 'effect-choice', { promptId: p2.id, choice: ['action:flip'] });
    expect(facedown.faceUp).toBe(true);
    expect(s.pendingEffects).toHaveLength(0);
  });

  it('light-2: effect player (P1) decides — skip (stays facedown)', () => {
    const s = draftLightP1();
    advanceToStep(s, 0, 'action');
    s.players[0].hand = [makeCard('light-2', 0, 'hand')];
    const facedown = makeCard('light-1', 1, 'field', false, 1, 0);
    s.players[1].stacks[1] = [facedown];
    const card = s.players[0].hand[0];
    executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: true, line: lightLine(s) });
    const p1 = s.pendingEffects[s.pendingEffects.length - 1];
    executeAction(s, 0, 'effect-choice', { promptId: p1.id, choice: [facedown.uid] });
    const p2 = s.pendingEffects[s.pendingEffects.length - 1];
    executeAction(s, 0, 'effect-choice', { promptId: p2.id, choice: [] }); // 可选：跳过
    expect(facedown.faceUp).toBe(false); // 未翻转
    expect(s.revealedGhosts).toHaveLength(1); // 揭示本身仍生效
    expect(s.pendingEffects).toHaveLength(0);
  });

  it('light-2: shift target lines exclude both the effect line and the revealed card line', () => {
    const s = draftLightP1();
    advanceToStep(s, 0, 'action');
    s.players[0].hand = [makeCard('light-2', 0, 'hand')];
    const facedown = makeCard('light-1', 1, 'field', false, 1, 0); // 被揭示卡在另一列（线 1）
    s.players[1].stacks[1] = [facedown];
    const card = s.players[0].hand[0];
    executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: true, line: lightLine(s) }); // 效果线 0
    const p1 = s.pendingEffects[s.pendingEffects.length - 1];
    expect(p1.prompt?.kind).toBe('select');
    executeAction(s, 0, 'effect-choice', { promptId: p1.id, choice: [facedown.uid] });
    // 效果属主（P1）选择平移
    const p2 = s.pendingEffects[s.pendingEffects.length - 1];
    expect(p2.prompt?.kind).toBe('select-action');
    executeAction(s, 0, 'effect-choice', { promptId: p2.id, choice: ['action:shift'] });
    const p3 = s.pendingEffects[s.pendingEffects.length - 1];
    expect(p3.prompt?.kind).toBe('select-line');
    expect(p3.prompt?.lines).toEqual([2]); // 同时排除效果线 0 与被揭示卡线 1（平移必须到不同列）
  });

  it('light-3: shift all facedown cards of own line to target line', () => {
    const s = draftLightP1();
    advanceToStep(s, 0, 'action');
    // 本线堆叠：两张反面牌（含被覆盖的底层）→ 打出 light-3 落顶
    const fd1 = makeCard('light-1', 0, 'field', false, 0, 0);
    const fd2 = makeCard('light-2', 0, 'field', false, 0, 1);
    s.players[0].stacks[0] = [fd1, fd2];
    s.players[0].hand = [makeCard('light-3', 0, 'hand')];
    const card = s.players[0].hand[0];
    executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: true, line: lightLine(s) });
    // 每移开一张反面包，顶卡 light-3 重新露出都会连锁一次其中指令（再次 select-line）→ 全部答同一条线
    resolveAllChoices(s, (p) => (p.kind === 'select-line' ? ['line:1'] : pickFirst(p)));
    expect(s.players[0].stacks[0].map((c) => c.uid)).toEqual([card.uid]); // 源线只剩 light-3（无反面包）
    expect(s.players[0].stacks[1].map((c) => c.uid).sort()).toEqual([fd1.uid, fd2.uid].sort()); // 全部反面牌移到目标线
    expect(fd1.zone).toBe('field');
    expect(fd2.zone).toBe('field');
    expect(fd1.line).toBe(1);
    expect(fd2.line).toBe(1);
    expect(s.pendingShift).toHaveLength(0);
    // 状态损坏签名：所有原场卡都在某堆叠中，无卡残留在浮空态
    const onField = [s.players[0], s.players[1]].flatMap((p) => [...p.stacks[0], ...p.stacks[1], ...p.stacks[2]]);
    expect(onField.map((c) => c.uid).sort()).toEqual([fd1.uid, fd2.uid, card.uid].sort());
  });

  it('light-3: chained shift during deferred landing (fire-0 target top) lands all cards', () => {
    const s = draftLightP1();
    advanceToStep(s, 0, 'action');
    // 目标线顶卡为正面 fire-0（"被盖住前"触发 → 落地挂起窗口）；
    // 每次移开反面包后 light-3 重新露出会连锁其中指令 → 在窗口内再发 shift（旧实现覆盖槽位 → fd2 丢失）
    const fd1 = makeCard('light-1', 0, 'field', false, 0, 0);
    const fd2 = makeCard('light-2', 0, 'field', false, 0, 1);
    s.players[0].stacks[0] = [fd1, fd2];
    const fire0 = makeCard('fire-0', 0, 'field', true, 1, 0);
    s.players[0].stacks[1] = [fire0];
    s.players[0].hand = [makeCard('light-3', 0, 'hand')];
    const card = s.players[0].hand[0];
    executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: true, line: lightLine(s) });
    resolveAllChoices(s, (p) => (p.kind === 'select-line' ? ['line:1'] : pickFirst(p)));
    expect(s.players[0].stacks[0].map((c) => c.uid)).toEqual([card.uid]); // 源线只剩 light-3
    expect(s.players[0].stacks[1].map((c) => c.uid).sort()).toEqual([fire0.uid, fd1.uid, fd2.uid].sort());
    expect(fd1.zone).toBe('field');
    expect(fd2.zone).toBe('field');
    expect(s.pendingShift).toHaveLength(0);
    const onField = [s.players[0], s.players[1]].flatMap((p) => [...p.stacks[0], ...p.stacks[1], ...p.stacks[2]]);
    expect(onField.map((c) => c.uid).sort()).toEqual([fd1.uid, fd2.uid, fire0.uid, card.uid].sort()); // 无浮空残留
  });

  it('light-3: exactly one select-line prompt across the whole resolution (no spurious re-triggers)', () => {
    const s = draftLightP1();
    advanceToStep(s, 0, 'action');
    // 本线堆叠：两张反面牌（含被覆盖的底层）→ 打出 light-3 落顶；
    // 移开被覆盖的反面牌时顶卡（light-3 自身）并未被移除 → 不得重触发其中指令（旧实现每次 +1 次 select-line）
    const fd1 = makeCard('light-1', 0, 'field', false, 0, 0);
    const fd2 = makeCard('light-2', 0, 'field', false, 0, 1);
    s.players[0].stacks[0] = [fd1, fd2];
    s.players[0].hand = [makeCard('light-3', 0, 'hand')];
    const card = s.players[0].hand[0];
    executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: true, line: lightLine(s) });
    let selectLineCount = 0;
    resolveAllChoices(s, (p) => {
      if (p.kind === 'select-line') {
        selectLineCount += 1;
        return ['line:1'];
      }
      return pickFirst(p);
    });
    expect(selectLineCount).toBe(1); // 仅目标线选择一次
    expect(s.players[0].stacks[0].map((c) => c.uid)).toEqual([card.uid]); // 源线只剩 light-3
    expect(s.players[0].stacks[1].map((c) => c.uid).sort()).toEqual([fd1.uid, fd2.uid].sort());
    expect(s.pendingEffects).toHaveLength(0);
  });

  it('light-3: shifts face-down cards from both sides of the line (owner-relative targets)', () => {
    const s = draftLightP1();
    advanceToStep(s, 0, 'action');
    // 本线（线 0）：两张反面牌 + light-3 落顶
    const fd1 = makeCard('light-1', 0, 'field', false, 0, 0);
    const fd2 = makeCard('light-2', 0, 'field', false, 0, 1);
    s.players[0].stacks[0] = [fd1, fd2];
    // 对手同列（线 0）：一张反面牌 —— 也应被平移（到对手自己的目标线）
    const ofd = makeCard('water-1', 1, 'field', false, 0, 0);
    s.players[1].stacks[0] = [ofd];
    s.players[0].hand = [makeCard('light-3', 0, 'hand')];
    const card = s.players[0].hand[0];
    executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: true, line: lightLine(s) });
    resolveAllChoices(s, (p) => (p.kind === 'select-line' ? ['line:1'] : pickFirst(p)));
    // 双方各自：线 0 的反面牌 → 各自的线 1（owner-relative）
    expect(s.players[0].stacks[0].map((c) => c.uid)).toEqual([card.uid]); // 本线只剩 light-3
    expect(s.players[0].stacks[1].map((c) => c.uid).sort()).toEqual([fd1.uid, fd2.uid].sort());
    expect(s.players[1].stacks[0]).toHaveLength(0); // 对手线 0 清空
    expect(s.players[1].stacks[1].map((c) => c.uid)).toEqual([ofd.uid]);
    expect(ofd.line).toBe(1);
    expect(ofd.faceUp).toBe(false); // 反面平移（不翻面）
    expect(s.pendingShift).toHaveLength(0);
    // 状态损坏签名：所有原场卡都在某堆叠中，无卡残留在浮空态
    const onField = [s.players[0], s.players[1]].flatMap((p) => [...p.stacks[0], ...p.stacks[1], ...p.stacks[2]]);
    expect(onField.map((c) => c.uid).sort()).toEqual([fd1.uid, fd2.uid, ofd.uid, card.uid].sort());
  });

  it('light-2: can reveal a covered card and an opponent face-down card; effect player flips it', () => {
    const s = draftLightP1();
    advanceToStep(s, 0, 'action');
    s.players[0].hand = [makeCard('light-2', 0, 'hand')];
    // 本线：被盖住的反面卡（底层）+ 正面顶卡
    const covered = makeCard('water-1', 0, 'field', false, 1, 0);
    const top = makeCard('water-2', 0, 'field', true, 1, 1);
    s.players[0].stacks[1] = [covered, top];
    // 对手线：反面顶卡
    const oppFd = makeCard('water-3', 1, 'field', false, 2, 0);
    s.players[1].stacks[2] = [oppFd];
    const card = s.players[0].hand[0];
    executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: true, line: lightLine(s) });
    const p1 = s.pendingEffects[s.pendingEffects.length - 1];
    expect(p1.prompt?.kind).toBe('select');
    const cands = p1.prompt?.candidates.map((c) => c.uid) ?? [];
    expect(cands).toContain(covered.uid); // 被盖住的反面卡可选
    expect(cands).toContain(oppFd.uid); // 对手的反面卡可选
    // 揭示被盖住的反面卡
    executeAction(s, 0, 'effect-choice', { promptId: p1.id, choice: [covered.uid] });
    expect(s.revealedGhosts).toHaveLength(1);
    const p2 = s.pendingEffects[s.pendingEffects.length - 1];
    expect(p2.prompt?.kind).toBe('select-action');
    expect(p2.prompt?.chooser).toBe(0); // 效果属主（P1）决定（无论被揭示卡持有者是谁）
    executeAction(s, 0, 'effect-choice', { promptId: p2.id, choice: ['action:flip'] });
    expect(covered.faceUp).toBe(true); // 被盖住的反面卡可被翻转（allowCovered）
    expect(s.pendingEffects).toHaveLength(0);
  });

  it('light-4: reveal whole opponent hand (one ghost per card)', () => {
    const s = draftLightP1();
    advanceToStep(s, 0, 'action');
    s.players[0].hand = [makeCard('light-4', 0, 'hand')];
    const oppHand = s.players[1].hand;
    const card = s.players[0].hand[0];
    executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: true, line: lightLine(s) });
    resolveAllChoices(s, pickFirst); // 无选择步骤，无害
    expect(s.revealedGhosts).toHaveLength(oppHand.length);
    for (const g of s.revealedGhosts) {
      expect(oppHand.some((c) => c.defId === g.defId)).toBe(true);
      expect(g.lightFx).toBe(true); // light 协议揭示（light-4）：落地幽灵带光之辉光（十字星 + 边框辉光）
    }
  });

  it('light-5: discard 1 mandatory', () => {
    const s = draftLightP1();
    advanceToStep(s, 0, 'action');
    s.players[0].hand = [makeCard('light-5', 0, 'hand'), makeCard('light-1', 0, 'hand')];
    const target = s.players[0].hand.find((c) => c.defId === 'light-5')!;
    const other = s.players[0].hand.find((c) => c.defId !== 'light-5')!;
    executeAction(s, 0, 'play', { cardUid: target.uid, faceUp: true, line: lightLine(s) });
    resolveAllChoices(s, (p) => [other.uid]); // 弃另一张
    expect(s.players[0].trash.map((c) => c.uid)).toEqual([other.uid]);
    expect(s.players[0].hand).toHaveLength(0);
    expect(s.players[0].stacks[0].map((c) => c.uid)).toEqual([target.uid]);
  });
});
