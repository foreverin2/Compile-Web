import { describe, it, expect } from 'vitest';
import type { ChoiceRequest, GameState, Line, PlayerId } from '../../src/core/models/types';
import { createGame } from '../../src/core/state/create';
import { resolveMiddle, runStack } from '../../src/core/effects/resolve';
import { collectTriggers, resolveTrigger } from '../../src/core/effects/triggers';
import { shuffleDeck } from '../../src/core/engine/deck';
import { makeCard, resolveAllChoices } from '../helpers';

/**
 * 2代 批3 五套卡效果测试（勇气/时间/多元/同化/统一）——代表性用例。
 * 裁决：docs/批3裁决结果.md；引擎扩展（playFromTrash/deckTopTransfer/takeFromField/after-shuffle）已提交。
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
  if (prompt.kind === 'select-line') return prompt.lines && prompt.lines.length > 0 ? [`line:${prompt.lines[0]}`] : [];
  if (prompt.kind === 'select-action') return prompt.actions && prompt.actions.length > 0 ? [prompt.actions[0]] : [];
  if (prompt.candidates.length === 0) return [];
  return prompt.candidates.slice(0, prompt.max).map((c) => c.uid);
}

// ============ 时间 time ============

describe('time', () => {
  it('time-0 plays a card from own trash (eager = face-up to matching line) then shuffles rest in', () => {
    const s = setup();
    const src = placeSrc(s, 'time-0', 0, 2);
    const t1 = makeCard('fire-1', 0, 'trash', true);
    const t2 = makeCard('death-2', 0, 'trash', true);
    s.players[0].trash = [t1, t2];
    resolveMiddle(s, 0, src);
    resolveAllChoices(s, eagerPick); // 选 t1 → face-up（actions[0]）→ 线0（fire 匹配）
    expect(s.players[0].stacks[0].some((c) => c.uid === t1.uid)).toBe(true); // fire-1 打出
    expect(s.players[0].trash).toHaveLength(0); // t2 洗入牌库
    expect(s.players[0].deck).toHaveLength(1);
  });

  it('time-2 top: when you shuffle your deck, draw 1 (after-shuffle)', () => {
    const s = setup();
    placeSrc(s, 'time-2', 0, 0);
    s.players[0].deck = [makeCard('death-5', 0, 'deck', false), makeCard('death-4', 0, 'deck', false)];
    shuffleDeck(s, 0); // 触发 after-shuffle → time-2 顶抽 1
    runStack(s); // 驱动 fireReactive push 的效果
    resolveAllChoices(s, eagerPick); // time-2 可选偏转（eager 选 → shift 自己到线1）
    expect(s.players[0].hand).toHaveLength(1);
  });

  it('time-1 moves whole deck into trash (face-up public)', () => {
    const s = setup();
    const src = placeSrc(s, 'time-1', 0, 0);
    const buried = makeCard('death-0', 1, 'field', false, 1, 0); // 对手被盖反面卡（可翻）
    const cover = makeCard('fire-5', 1, 'field', true, 1, 1);
    s.players[1].stacks[1] = [buried, cover];
    s.players[0].deck = [makeCard('death-5', 0, 'deck', false), makeCard('death-4', 0, 'deck', false)];
    resolveMiddle(s, 0, src);
    resolveAllChoices(s, eagerPick); // 翻 buried
    expect(buried.faceUp).toBe(true);
    expect(s.players[0].deck).toHaveLength(0);
    expect(s.players[0].trash).toHaveLength(2);
    for (const c of s.players[0].trash) expect(c.faceUp).toBe(true);
  });
});

// ============ 勇气 courage ============

describe('courage', () => {
  it('courage-6 end: flips itself when opponent line total is higher (end check)', () => {
    const s = setup();
    s.turnPlayer = 0;
    s.step = 'end';
    const src = placeSrc(s, 'courage-6', 0, 0); // 值 6 顶卡
    // 对手线0 放高值卡 → 对手总值 > 自己总值
    s.players[1].stacks[0] = [makeCard('fire-5', 1, 'field', true, 0, 0), makeCard('light-5', 1, 'field', true, 0, 0)];
    const trigs = collectTriggers(s, 'end');
    const t = trigs.find((x) => x.cardUid === src.uid);
    expect(t).toBeTruthy();
    resolveTrigger(s, t!);
    runStack(s);
    expect(src.faceUp).toBe(false); // 对手总值更大 → 回合结束翻自己
  });

  it('courage-1 middle: deletes an OPPONENT card in a line where opponent total is higher (txt 修改记录【7】)', () => {
    const s = setup();
    const src = placeSrc(s, 'courage-1', 0, 1);
    s.players[0].stacks[1] = [makeCard('death-1', 0, 'field', true, 1, 0), src]; // 自己线1 = 1+1=2
    const oppTop = makeCard('light-3', 1, 'field', true, 1, 0);
    const oppUnder = makeCard('fire-5', 1, 'field', true, 1, 0);
    s.players[1].stacks[1] = [oppUnder, oppTop]; // 对手线1 = 5+3=8 > 2
    resolveMiddle(s, 0, src);
    resolveAllChoices(s, eagerPick); // 选线1 → 删对手该线顶卡 light-3
    expect(s.players[1].stacks[1].some((c) => c.uid === oppTop.uid)).toBe(false); // 对手卡被删
    expect(s.players[1].stacks[1]).toHaveLength(1);
    expect(s.players[0].stacks[1]).toHaveLength(2); // 自己的卡不受影响
  });
});

// ============ 多元 diversity ============

describe('diversity', () => {
  it('diversity-0 flips own diversity protocol to compiled when ≥6 protocols on field', () => {
    const s = setup();
    s.players[0].protocols[2] = { defId: 'diversity', compiled: false };
    const src = placeSrc(s, 'diversity-0', 0, 2);
    // 场上有 6 种不同协议：火/光/暗 + 生死灵魂重力（对手/自己堆叠各放）
    const fill: [PlayerId, string, Line][] = [
      [0, 'death-0', 0],
      [1, 'spirit-1', 0],
      [0, 'gravity-2', 1],
      [1, 'love-3', 1],
      [1, 'hate-4', 2], // 对手线2（不盖 diversity-0）
      [1, 'apathy-5', 0],
    ];
    for (const [owner, def, line] of fill) {
      const c = makeCard(def, owner, 'field', true, line, s.players[owner].stacks[line].length);
      s.players[owner].stacks[line].push(c);
    }
    resolveMiddle(s, 0, src);
    expect(s.players[0].protocols[2].compiled).toBe(true); // 纯翻面
    void src;
  });

  it('diversity-6 end: deletes itself when fewer than 4 protocols on field (R14-3：阈值 3 → 4，文本与规则同步)', () => {
    const s = setup();
    s.turnPlayer = 0;
    s.step = 'end';
    const src = placeSrc(s, 'diversity-6', 0, 0); // 场上仅 diversity 1 种协议
    const trigs = collectTriggers(s, 'end');
    const t = trigs.find((x) => x.cardUid === src.uid);
    expect(t).toBeTruthy();
    resolveTrigger(s, t!);
    runStack(s);
    expect(s.players[0].stacks[0]).toHaveLength(0); // <4 种 → 自删
  });

  it('diversity-6 end: survives when ≥4 protocols on field (cond false → NOT collected)', () => {
    const s = setup();
    s.turnPlayer = 0;
    s.step = 'end';
    const src = placeSrc(s, 'diversity-6', 0, 0);
    placeSrc(s, 'fire-5', 0, 1); // fire
    placeSrc(s, 'death-0', 1, 1); // death
    placeSrc(s, 'life-0', 1, 2); // life → 场上 4 种（diversity/fire/death/life）
    const trigs = collectTriggers(s, 'end');
    // 场上 ≥4 种协议 → 删除条件不满足 → 收集前自动跳过（不弹结算按钮），卡自然存活
    expect(trigs.find((x) => x.cardUid === src.uid)).toBeUndefined();
    expect(trigs).toHaveLength(0);
    expect(s.players[0].stacks[0].some((c) => c.uid === src.uid)).toBe(true);
  });
});

// ============ 同化 assimilation ============

describe('assimilation', () => {
  it('assimilation-0 takes an opponent face-down field card into own hand (ownership change)', () => {
    const s = setup();
    const src = placeSrc(s, 'assimilation-0', 0, 0);
    const facedown = makeCard('death-0', 1, 'field', false, 1, 0);
    const cover = makeCard('fire-5', 1, 'field', true, 1, 1);
    s.players[1].stacks[1] = [facedown, cover];
    resolveMiddle(s, 0, src);
    resolveAllChoices(s, eagerPick); // 选 facedown
    expect(s.players[0].hand.some((c) => c.uid === facedown.uid)).toBe(true);
    expect(facedown.owner).toBe(0);
    expect(facedown.faceUp).toBe(true); // 入手公开
    expect(s.players[1].stacks[1].map((c) => c.uid)).toEqual([cover.uid]);
  });

  it('assimilation-4 draws from opponent deck and lets opponent draw from yours', () => {
    const s = setup();
    const src = placeSrc(s, 'assimilation-4', 0, 0);
    s.players[1].deck = [makeCard('death-5', 1, 'deck', false)];
    s.players[0].deck = [makeCard('fire-5', 0, 'deck', false)];
    resolveMiddle(s, 0, src);
    expect(s.players[0].hand).toHaveLength(1);
    expect(s.players[1].hand).toHaveLength(1);
    void src;
  });
});

// ============ 统一 unity ============

describe('unity', () => {
  it('unity-1 middle: with ≥5 unity cards on field, compiles the unity line (full compile)', () => {
    const s = setup();
    s.players[0].protocols[0] = { defId: 'unity', compiled: false };
    const src = placeSrc(s, 'unity-1', 0, 0);
    // 场上凑 5 张 unity：自己线0 已有 unity-1 + 4 张其它线 unity
    const extra: [PlayerId, string, Line][] = [
      [0, 'unity-2', 1],
      [0, 'unity-3', 2],
      [1, 'unity-4', 0],
      [1, 'unity-5', 1],
    ];
    for (const [owner, def, line] of extra) {
      const c = makeCard(def, owner, 'field', true, line, s.players[owner].stacks[line].length);
      s.players[owner].stacks[line].push(c);
    }
    s.players[0].stacks[0] = [makeCard('death-0', 0, 'field', true, 0, 0), src]; // 线0 有 death-0 会被删
    resolveMiddle(s, 0, src);
    expect(s.players[0].protocols[0].compiled).toBe(true); // unity 编译完成
    expect(s.players[0].stacks[0]).toHaveLength(0); // 该线全删
    void src;
  });

  it('unity-4 top start: empty hand reveals deck, draws all Unity cards, shuffles (txt 修改记录【5】end→start)', () => {
    const s = setup();
    s.turnPlayer = 0;
    s.step = 'start';
    const src = placeSrc(s, 'unity-4', 0, 0);
    s.players[0].hand = [];
    s.players[0].deck = [
      makeCard('unity-5', 0, 'deck', false),
      makeCard('death-5', 0, 'deck', false),
      makeCard('unity-3', 0, 'deck', false),
    ];
    const trigs = collectTriggers(s, 'start');
    const t = trigs.find((x) => x.cardUid === src.uid);
    expect(t).toBeTruthy(); // 回合开始触发（top:true）
    resolveTrigger(s, t!);
    runStack(s);
    expect(s.players[0].hand).toHaveLength(2); // unity-5 + unity-3
    expect(s.players[0].hand.every((c) => c.defId.startsWith('unity-'))).toBe(true);
    expect(s.players[0].deck).toHaveLength(1); // death-5 洗后留在牌库
  });
});

void resolveAllChoices;
void resolveTrigger;
