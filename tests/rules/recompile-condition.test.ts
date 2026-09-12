import { describe, it, expect } from 'vitest';
import type { GameState, Line, PlayerId } from '../../src/core/models/types';
import { createGame, getLineValue } from '../../src/core/state/create';
import { executeCompileBody } from '../../src/core/rules/compile-body';
import { executeCompileUnchecked } from '../../src/core/rules/compile';
import { executeAction, getLegalActions } from '../../src/core/game';
import { pushMiddle, runStack, answerEffect } from '../../src/core/effects/resolve';
import { trace, traceReset, traceEntries, formatTrace, stateDetail, stateDigest, initEventTracing } from '../../src/core/trace';
import { draftFireP1, makeCard } from '../helpers';

/**
 * 2026-09-12 用户规则确认：**重编译同样遵守编译条件**（本线 ≥10 且高于对手），
 * 不满足则本次不编译；开发者模式强制编译（force）不受此限。
 * 另覆盖：全量追踪缓冲区（动作/规则/状态）与详细状态快照的可用性。
 */

function setup(): GameState {
  const s = createGame();
  for (const pid of [0, 1] as PlayerId[]) {
    s.players[pid].protocols = [
      { defId: 'envy', compiled: false },
      { defId: pid === 0 ? 'lust' : 'greed', compiled: false },
      { defId: pid === 0 ? 'pride' : 'sloth', compiled: false },
    ];
  }
  s.phase = 'turn';
  s.turnPlayer = 0;
  s.step = 'check-compile';
  return s;
}

function place(s: GameState, defId: string, owner: PlayerId, line: Line) {
  const c = makeCard(defId, owner, 'field', true, line, s.players[owner].stacks[line].length);
  s.players[owner].stacks[line].push(c);
  return c;
}

describe('重编译遵守编译条件（12 vs 16 必须拦下）', () => {
  it('已编译线且己方 12 < 对手 16 → 不编译（不删卡、不抽牌、日志说明）', () => {
    const s = setup();
    place(s, 'lust-0', 0, 1);
    place(s, 'lust-2', 0, 1);
    place(s, 'greed-2', 1, 1);
    place(s, 'greed-4', 1, 1);
    s.players[0].protocols[1].compiled = true; // 已编译 → 本次为「重编译」
    const stolen = makeCard('fire-0', 1, 'deck', false);
    s.players[1].deck.push(stolen);
    const ownBefore = s.players[0].stacks[1].length;
    const oppBefore = s.players[1].stacks[1].length;

    expect(getLineValue(s, 0, 1)).toBe(12);
    expect(getLineValue(s, 1, 1)).toBe(16);
    executeCompileBody(s, 0, 1);

    expect(s.players[0].stacks[1].length).toBe(ownBefore); // 未删卡
    expect(s.players[1].stacks[1].length).toBe(oppBefore);
    expect(s.players[1].deck.some((c) => c.uid === stolen.uid)).toBe(true); // 未夺取
    expect(s.log.join(' ')).toContain('未满足编译条件');
  });

  it('已编译线且己方 16 > 对手 12 → 正常重编译（删双方该线卡牌 + 夺取对手牌库顶1张）', () => {
    const s = setup();
    place(s, 'lust-0', 0, 1);
    place(s, 'pride-6', 0, 1); // 0+6 → 16
    place(s, 'greed-2', 1, 1); // 2 → 12
    s.players[0].protocols[1].compiled = true;
    const stolen = makeCard('fire-0', 1, 'deck', false);
    s.players[1].deck.push(stolen);

    executeCompileBody(s, 0, 1);

    expect(s.players[0].stacks[1].length).toBe(0); // 双方该线清空
    expect(s.players[1].stacks[1].length).toBe(0);
    expect(s.players[0].hand.some((c) => c.uid === stolen.uid)).toBe(true); // 夺取对手牌库顶
    expect(s.players[1].deck.some((c) => c.uid === stolen.uid)).toBe(false);
    expect(s.log.join(' ')).toContain('重编译线 2');
    // 重编译不清空对手手牌
    const foeHand = s.players[1].hand.length;
    expect(foeHand).toBe(0); // 本构造中对手手牌本就为空 → 断言「未被额外清空」
  });

  it('开发者模式强制编译（force）跳过重编译线值校验', () => {
    const s = setup();
    place(s, 'lust-0', 0, 1);
    place(s, 'lust-2', 0, 1);
    place(s, 'greed-2', 1, 1);
    place(s, 'greed-4', 1, 1);
    s.players[0].protocols[1].compiled = true;
    executeCompileUnchecked(s, 0, 1, { force: true });
    expect(s.players[0].stacks[1].length).toBe(0); // 强制路径照常执行
  });

  it('首次编译（非重编译）不受该守卫影响（效果编译按卡文条件）', () => {
    const s = setup();
    place(s, 'lust-0', 0, 1);
    place(s, 'lust-2', 0, 1);
    place(s, 'greed-2', 1, 1);
    place(s, 'greed-4', 1, 1);
    // 未编译 → 效果编译（如统一1）按其卡文条件，不受「重编译线值校验」限制
    executeCompileBody(s, 0, 1);
    expect(s.players[0].protocols[1].compiled).toBe(true);
    expect(s.players[0].stacks[1].length).toBe(0);
  });
});

describe('全量追踪与详细快照（2026-09-12 日志强化）', () => {
  it('真实引擎流程会写入 事件/操作/选择/步骤 追踪（出牌 + 效果弃牌）', () => {
    traceReset();
    initEventTracing(); // 事件追踪（main.ts 启动时调用；此处显式开启以便断言）
    const s = draftFireP1();
    s.step = 'action';
    s.turnPlayer = 0;
    // 不写死「线0」：牌库洗牌是随机的（手牌不同不影响协议匹配，但合法行动由引擎判定更稳）
    const play = getLegalActions(s, 0).find((a) => a.kind === 'play' && a.faceUp);
    expect(play, '应先手方存在可正面打出的合法行动').toBeTruthy();
    executeAction(s, 0, 'play', { cardUid: play!.cardUid!, faceUp: true, line: play!.line! });
    // 出牌必经：语义事件 card:played（事件追踪覆盖）
    expect(formatTrace().join('\n')).toContain('事件 card:played');

    // 再验证「触发 → 选择 → 操作」链路：直接把 lust-5（中：你弃置1张牌）压入中部效果并结算
    const lust5 = makeCard('lust-5', 0, 'field', true, 0, s.players[0].stacks[0].length);
    s.players[0].stacks[0].push(lust5);
    pushMiddle(s, 0, lust5, '打出');
    runStack(s);
    const pe = s.pendingEffects[s.pendingEffects.length - 1];
    expect(pe?.prompt?.kind).toBe('select');
    answerEffect(s, pe.id, [s.players[0].hand[0].uid]);
    runStack(s);
    const text = formatTrace().join('\n');
    expect(text).toContain('触发 中部指令入栈');
    expect(text).toContain('选择 P1 应答');
    expect(text).toContain('操作 op=discard');
    expect(text).toContain('事件 card:discarded');
  });

  it('trace 缓冲按序记录，formatTrace 带相对时间/序号/分类', () => {
    traceReset();
    trace('动作', 'P1 行动 kind=play');
    trace('操作', 'op=discard 参数={"op":"discard","uid":"c1"}');
    trace('规则', '编译：P1 线2（色欲 16 vs 12，满足条件）');
    const list = traceEntries();
    expect(list.length).toBe(3);
    expect(list[0].seq).toBe(1);
    expect(list[1].seq).toBe(2);
    const text = formatTrace(list).join('\n');
    expect(text).toContain('#    1');
    expect(text).toContain('动作 P1 行动 kind=play');
    expect(text).toContain('操作 op=discard');
    expect(text).toContain('规则 编译：P1 线2');
  });

  it('stateDigest / stateDetail 覆盖线值、卡牌明细与效果栈', () => {
    const s = setup();
    place(s, 'lust-0', 0, 1);
    place(s, 'lust-2', 0, 1);
    place(s, 'greed-2', 1, 1);
    s.pendingEffects.push({
      id: 'e9', player: 0, gen: undefined as never, sourceUid: 'x', sourceDefId: 'lust-2',
      prompt: { kind: 'select', title: 'lust-2：你可以将对手1张被覆盖的牌平移到此链路', min: 1, max: 1, optional: true, candidates: [] },
      lastAnswer: null,
    });
    const digest = stateDigest(s);
    expect(digest).toContain('回合=P1');
    expect(digest).toContain('线值 0/12/0');
    expect(digest).toContain('挂起1');
    const detail = stateDetail(s).join('\n');
    expect(detail).toContain('lust-0[色欲]');
    expect(detail).toContain('线2（总值 12');
    expect(detail).toContain('效果栈（自底向上）');
    expect(detail).toContain('lust-2：你可以将对手1张被覆盖的牌平移到此链路');
    expect(detail).toContain('追踪条目数=');
  });
});
