import { describe, it, expect } from 'vitest';
import type { ChoiceRequest, GameState, Line, PlayerId } from '../../src/core/models/types';
import { createGame } from '../../src/core/state/create';
import { resolveMiddle, runStack, answerEffect } from '../../src/core/effects/resolve';
import { fireRefreshReactives } from '../../src/core/effects/triggers';
import { executeAction } from '../../src/core/game';
import { makeCard, pickFirst, resolveAllChoices, draftLoveP1, advanceToStep } from '../helpers';

/**
 * 控制组件重排流程（卡牌效果触发的刷新/编译）——core/effects/control-rearrange-flow：
 * 执行者（或 war-1 的被强制刷新方）持有控制组件时，刷新/编译本体执行前挂起选择：
 * 可跳过（仍归还中立，FAQ 114）或选择重排任意一方协议（可多次交换）。
 */

function loveLine(s: GameState): Line {
  const idx = s.players[0].protocols.findIndex((p) => p.defId === 'love');
  return idx as Line;
}

/** 2代 风格最小状态（双方 fire/light/darkness 协议） */
function setupGen2(): GameState {
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

describe('控制组件重排流程（效果触发的刷新/编译）', () => {
  it('love-2 效果刷新：持有 → 重排玩家1协议 0↔2 → 回菜单跳过 → 归还并补至 5', () => {
    const s = draftLoveP1();
    advanceToStep(s, 0, 'action');
    const ll = loveLine(s);
    s.players[0].hand = [makeCard('love-2', 0, 'hand')];
    s.control = 0; // 打出者 P1 持有
    const before = s.players[0].protocols.map((p) => p.defId);
    const card = s.players[0].hand[0];
    executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: true, line: ll });
    // love-2：对手抽 1 后 → 挂起重排菜单（select-action）
    let top = s.pendingEffects[s.pendingEffects.length - 1];
    expect(top?.prompt?.kind).toBe('select-action');
    expect(top?.prompt?.chooser).toBe(0);
    // 选「重排玩家1的协议」→ 依次选位置 0、2
    answerEffect(s, top.id, ['action:重排玩家1的协议']);
    top = s.pendingEffects[s.pendingEffects.length - 1];
    expect(top?.prompt?.kind).toBe('select-line');
    answerEffect(s, top.id, ['line:0']);
    top = s.pendingEffects[s.pendingEffects.length - 1];
    expect(top?.prompt?.kind).toBe('select-line');
    answerEffect(s, top.id, ['line:2']);
    // 交换完成 → 回到菜单（可继续换）→ 修改提示词 6：锁侧——菜单只剩「不重排」与已锁定玩家
    top = s.pendingEffects[s.pendingEffects.length - 1];
    expect(top?.prompt?.kind).toBe('select-action');
    expect(top?.prompt?.actions).toEqual(['action:不重排，继续', 'action:重排玩家1的协议（已锁定）']);
    answerEffect(s, top.id, ['action:不重排，继续']);
    resolveAllChoices(s, pickFirst); // 尾保险
    // 归还中立 + 协议 0↔2 交换（defId 随槽位整体移动）+ 补至 5
    expect(s.control).toBe(-1);
    const after = s.players[0].protocols.map((p) => p.defId);
    expect(after[0]).toBe(before[2]);
    expect(after[2]).toBe(before[0]);
    expect(s.players[0].hand).toHaveLength(5); // 打出 love-2 后手牌 0 → need 5
    expect(s.pendingEffects).toHaveLength(0);
  });

  it('love-2 未持有控制权 → 无重排菜单（原流程直接刷新）', () => {
    const s = draftLoveP1();
    advanceToStep(s, 0, 'action');
    s.players[0].hand = [makeCard('love-2', 0, 'hand')];
    const card = s.players[0].hand[0];
    executeAction(s, 0, 'play', { cardUid: card.uid, faceUp: true, line: loveLine(s) });
    resolveAllChoices(s, pickFirst);
    expect(s.pendingEffects).toHaveLength(0); // 无挂起（未持有 → 不弹菜单）
    expect(s.players[0].hand).toHaveLength(5);
  });

  it('war-1 强制对手刷新：拥有者自己弃任意张并刷新自己的手牌（持有 → 菜单 chooser=拥有者，无递归）', () => {
    const s = setupGen2();
    placeSrc(s, 'war-1', 0, 0); // P1 场上的 war-1（底：当对手刷新时）
    s.control = 0; // war-1 拥有者 P1（执行刷新者）持有
    s.players[0].deck = Array.from({ length: 8 }, () => makeCard('fire-1', 0, 'deck', false));
    s.players[0].hand = [];
    fireRefreshReactives(s, 1); // 对手（P2）刷新 → 触发 P1 的 war-1
    runStack(s);
    // war-1 gen：拥有者（0）弃任意张（空手牌自动跳过）→ 重排菜单挂起（chooser=效果属主 0）
    let top = s.pendingEffects[s.pendingEffects.length - 1];
    expect(top?.prompt?.kind).toBe('select-action');
    expect(top?.prompt?.chooser).toBe(0);
    answerEffect(s, top.id, ['action:不重排，继续']);
    resolveAllChoices(s, pickFirst);
    expect(s.control).toBe(-1); // 拥有者（执行刷新者）归还中立
    expect(s.players[0].hand).toHaveLength(5); // 拥有者补自己的手牌至 5
    expect(s.pendingEffects).toHaveLength(0); // 无递归：自己刷新不再触发本卡 after-opponent-refresh
  });

  it('assimilation-1 效果刷新：持有 → 弃牌后菜单跳过 → 归还并补至 5', () => {
    const s = setupGen2();
    const src = placeSrc(s, 'assimilation-1', 0, 0);
    s.control = 0;
    const discard = makeCard('fire-2', 0, 'hand');
    s.players[0].hand = [discard];
    s.players[0].deck = Array.from({ length: 8 }, () => makeCard('fire-1', 0, 'deck', false));
    resolveMiddle(s, 0, src);
    // 第一步挂起：弃 1 张（select）
    let top = s.pendingEffects[s.pendingEffects.length - 1];
    expect(top?.prompt?.kind).toBe('select');
    answerEffect(s, top.id, [discard.uid]);
    // 弃牌后 → 重排菜单挂起
    top = s.pendingEffects[s.pendingEffects.length - 1];
    expect(top?.prompt?.kind).toBe('select-action');
    answerEffect(s, top.id, ['action:不重排，继续']);
    resolveAllChoices(s, pickFirst);
    expect(s.control).toBe(-1);
    expect(s.players[0].hand).toHaveLength(5); // 弃 1 后补至 5
    expect(s.pendingEffects).toHaveLength(0);
  });

  it('unity-1 效果编译：持有 → 菜单跳过 → 归还并完整编译 unity 线', () => {
    const s = setupGen2();
    s.players[0].protocols[0] = { defId: 'unity', compiled: false }; // 编译目标线 0
    // 场上凑 5 张 unity（含 unity-1 自身）：unity-1 须为该堆叠【顶卡】（sourceValid）
    placeSrc(s, 'unity-0', 0, 0);
    placeSrc(s, 'unity-2', 0, 0);
    const src = placeSrc(s, 'unity-1', 0, 0);
    placeSrc(s, 'unity-3', 1, 1);
    placeSrc(s, 'unity-5', 1, 1);
    s.control = 0; // 编译执行者 P1 持有
    resolveMiddle(s, 0, src);
    // unity-1 中：≥5 张 unity → 编译前重排菜单挂起
    let top = s.pendingEffects[s.pendingEffects.length - 1];
    expect(top?.prompt?.kind).toBe('select-action');
    answerEffect(s, top.id, ['action:不重排，继续']);
    resolveAllChoices(s, pickFirst);
    expect(s.control).toBe(-1); // 归还中立
    expect(s.players[0].protocols[0].compiled).toBe(true); // unity 线完成编译
    expect(s.players[0].stacks[0]).toHaveLength(0); // 编译删除双方该线全部卡
    expect(s.players[1].stacks[1]).toHaveLength(2); // 其它线不受影响
    expect(s.pendingEffects).toHaveLength(0);
  });
});
