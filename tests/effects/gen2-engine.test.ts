import { describe, it, expect } from 'vitest';
import type { Card, GameState, Line, PlayerId } from '../../src/core/models/types';
import { createGame } from '../../src/core/state/create';
import { registerCardEffects } from '../../src/core/effects/registry';
import { resolveMiddle, runStack } from '../../src/core/effects/resolve';
import { advanceStep } from '../../src/core/engine/turn';
import { shuffleTrashIntoDeck } from '../../src/core/engine/deck';
import { isPlayableFaceUp } from '../../src/core/actions/base';
import { makeCard } from '../helpers';

/**
 * 2代 批1 引擎扩展（2026-09-05）单元测试：G1 discardDeckTop / G2 flip noMiddle /
 * G3 swapStacks / G4 copyMiddle / G7 reorderProtocols / G8 drawFromDeck+shuffleTrashIntoDeck /
 * G5 fireReactive 新 kind 与 top 尊重 / G6 chaos-3 任意线放行 / deckReveals 过期。
 * 设计源：docs/批1规格-幸运明镜和平混沌明晰.md §7 + docs/批1裁决结果.md。
 */

/** 测试桩注册（本文件 worker 独立，与 engine-ext.test.ts 的桩互不可见） */

// 中指令：抽 1（判别 noMiddle / copyMiddle / FAQ 127 类连锁）
registerCardEffects('g2-mid-draw', {
  middle: function* (ctx) {
    yield { op: 'draw', count: 1 };
  },
});

// 弃牌者【对手】侧 after-discard（1代 plague-1 方向语义）
registerCardEffects('g2-disc-opp', {
  triggers: { 'after-discard': { fn: draw1, optional: false, top: true } },
});

// 弃牌者【自身】侧 after-self-discard（2代 peace-4 方向，底命令：无 top）
registerCardEffects('g2-self-discard', {
  triggers: { 'after-self-discard': { fn: draw1, optional: false } },
});

// 抽牌者【对手】侧 after-opponent-draw（2代 mirror-4 方向，底命令：无 top）
registerCardEffects('g2-opp-draw', {
  triggers: { 'after-opponent-draw': { fn: draw1, optional: false } },
});

// 自身侧 after-draw 底命令（无 top：被盖不触发；对照 spirit-3 顶命令 top:true）。
// 桩动作 = 翻转场上 death-0（非抽牌——避免 after-draw 抽牌自循环）
registerCardEffects('g2-bottom-draw', {
  triggers: {
    'after-draw': {
      fn: function* (ctx) {
        const card = ctx.s.players[0].stacks[0].find((c) => c.defId === 'death-0');
        if (card) yield { op: 'flip', uid: card.uid, allowCovered: true };
      },
      optional: false,
    },
  },
});

function* draw1(): Generator<{ op: 'draw'; count: number }, void, unknown> {
  yield { op: 'draw', count: 1 };
}

/** 本地 place：直接推入堆叠顶（不置 faceUp，保持调用方设定） */
function placeRaw(s: GameState, card: Card, owner: PlayerId, line: Line): void {
  card.zone = 'field';
  card.line = line;
  card.pos = s.players[owner].stacks[line].length;
  s.players[owner].stacks[line].push(card);
}

/** 手动推 system 效果执行单个 op */
function pushOpGen(s: GameState, player: PlayerId, gen: () => Generator<unknown, void, unknown>): void {
  s.pendingEffects.push({
    id: `t-${s.pendingEffects.length}-${Math.random().toString(36).slice(2)}`,
    player,
    gen: gen() as never,
    sourceUid: 't-source',
    sourceDefId: 't-system',
    system: true,
    prompt: null,
    lastAnswer: null,
  });
}

function opp(p: PlayerId): PlayerId {
  return p === 0 ? 1 : 0;
}

// ============ G1 discardDeckTop ============

describe('G1 discardDeckTop', () => {
  it('discards own deck top face-up into trash and fires both discard chains', () => {
    const s = createGame();
    const top = makeCard('death-0', 0, 'deck', false);
    const rest = makeCard('death-1', 0, 'deck', false);
    s.players[0].deck = [rest, top]; // 牌库顶 = 数组末位
    s.players[1].deck = [makeCard('death-2', 1, 'deck', false), makeCard('death-3', 1, 'deck', false)];
    // after-discard（对手侧）桩放 P1 顶卡；after-self-discard（自身侧）桩放 P0 顶卡
    const trigOpp = makeCard('g2-disc-opp', 1, 'field', true, 0, 0);
    const trigSelf = makeCard('g2-self-discard', 0, 'field', true, 0, 0);
    placeRaw(s, trigSelf, 0, 0);
    placeRaw(s, trigOpp, 1, 0);
    pushOpGen(s, 0, function* () {
      yield { op: 'discardDeckTop' };
    });
    runStack(s);
    expect(s.players[0].trash.map((c) => c.uid)).toEqual([top.uid]);
    expect(top.zone).toBe('trash');
    expect(top.faceUp).toBe(true); // 弃牌堆公开
    expect(top.secret).toBe(false); // 清 secret
    expect(s.players[0].deck).toHaveLength(0); // rest 被 after-self-discard 连锁抽走
    expect(s.players[0].hand).toHaveLength(1); // after-self-discard → P0 抽 1
    expect(s.players[1].hand).toHaveLength(1); // after-discard 对手侧 → P1 抽 1
  });

  it('supports player=opponent (luck-3 discard opponent deck top)', () => {
    const s = createGame();
    const top = makeCard('death-1', 1, 'deck', false);
    s.players[1].deck = [top];
    pushOpGen(s, 0, function* () {
      yield { op: 'discardDeckTop', player: 1 };
    });
    runStack(s);
    expect(s.players[1].trash).toHaveLength(1);
    expect(s.players[1].deck).toHaveLength(0);
  });

  it('throws when deck is empty (no reshuffle, FAQ 107)', () => {
    const s = createGame();
    s.players[0].deck = [];
    pushOpGen(s, 0, function* () {
      yield { op: 'discardDeckTop' };
    });
    expect(() => runStack(s)).toThrow('deck is empty');
  });
});

// ============ G2 flip noMiddle ============

describe('G2 flip noMiddle', () => {
  function faceDownTop(s: GameState, defId: string): Card {
    const c = makeCard(defId, 0, 'field', false, 0, 0);
    c.zone = 'field';
    c.line = 0;
    c.pos = 0;
    s.players[0].stacks[0] = [c];
    return c;
  }

  it('flipping face-up normally chains the middle command', () => {
    const s = createGame();
    s.players[0].deck = [makeCard('death-5', 0, 'deck', false)];
    const c = faceDownTop(s, 'g2-mid-draw');
    pushOpGen(s, 0, function* () {
      yield { op: 'flip', uid: c.uid };
    });
    runStack(s);
    expect(c.faceUp).toBe(true);
    expect(s.players[0].hand).toHaveLength(1); // middle 触发抽 1
  });

  it('noMiddle:true flips face-up WITHOUT chaining the middle command (luck-1)', () => {
    const s = createGame();
    const c = faceDownTop(s, 'g2-mid-draw');
    pushOpGen(s, 0, function* () {
      yield { op: 'flip', uid: c.uid, noMiddle: true };
    });
    runStack(s);
    expect(c.faceUp).toBe(true);
    expect(s.players[0].hand).toHaveLength(0); // 无视中央效果
  });
});

// ============ G3 swapStacks ============

describe('G3 swapStacks', () => {
  it('swaps two stacks entirely (order kept, line/pos rewritten, no chains)', () => {
    const s = createGame();
    const a0 = makeCard('death-0', 0, 'field', false, 0, 0);
    const a1 = makeCard('death-1', 0, 'field', true, 0, 1);
    const b0 = makeCard('fire-0', 0, 'field', false, 1, 0);
    s.players[0].stacks[0] = [a0, a1];
    s.players[0].stacks[1] = [b0];
    pushOpGen(s, 0, function* () {
      yield { op: 'swapStacks', a: 0, b: 1 };
    });
    runStack(s);
    expect(s.players[0].stacks[0].map((c) => c.uid)).toEqual([b0.uid]);
    expect(s.players[0].stacks[1].map((c) => c.uid)).toEqual([a0.uid, a1.uid]);
    expect(a1.line).toBe(1);
    expect(a1.pos).toBe(1);
    expect(b0.line).toBe(0);
    expect(b0.pos).toBe(0);
    expect(s.pendingEffects).toHaveLength(0);
    expect(s.players[0].hand).toHaveLength(0);
  });

  it('rejects swapping a stack with itself', () => {
    const s = createGame();
    pushOpGen(s, 0, function* () {
      yield { op: 'swapStacks', a: 0, b: 0 };
    });
    expect(() => runStack(s)).toThrow();
  });
});

// ============ G4 copyMiddle ============

describe('G4 copyMiddle', () => {
  it('executes the target middle with the copier as player (mirror-1)', () => {
    const s = createGame();
    s.players[0].deck = [makeCard('death-5', 0, 'deck', false), makeCard('death-6', 0, 'deck', false)];
    const target = makeCard('g2-mid-draw', 1, 'field', true, 1, 0); // 对手场上的值卡
    placeRaw(s, target, 1, 1);
    // 模拟真实效果源（在场正面卡）：copyMiddle push 的效果 sourceUid 跟踪源卡（system 源会因无卡被 sourceValid 终止）
    const src = makeCard('death-0', 0, 'field', true, 0, 0);
    placeRaw(s, src, 0, 0);
    s.pendingEffects.push({
      id: 't-copy',
      player: 0,
      gen: (function* (): Generator<unknown, void, unknown> {
        yield { op: 'copyMiddle', uid: target.uid };
      })() as never,
      sourceUid: src.uid,
      sourceDefId: 'death-0',
      prompt: null,
      lastAnswer: null,
    });
    runStack(s);
    expect(s.players[0].hand).toHaveLength(1); // 「你」= 复制者（P0）抽 1
    expect(s.players[1].hand).toHaveLength(0);
  });

  it('no-op (log) when target has no registered middle', () => {
    const s = createGame();
    const target = makeCard('t-none-registered', 1, 'field', true, 1, 0);
    placeRaw(s, target, 1, 1);
    pushOpGen(s, 0, function* () {
      yield { op: 'copyMiddle', uid: target.uid };
    });
    expect(() => runStack(s)).not.toThrow();
    expect(s.players[0].hand).toHaveLength(0);
  });
});

// ============ G7 reorderProtocols ============

describe('G7 reorderProtocols', () => {
  function setup(s: GameState): void {
    s.players[0].protocols = [
      { defId: 'fire', compiled: false },
      { defId: 'light', compiled: false },
      { defId: 'darkness', compiled: false },
    ];
  }

  it('reorders protocols to the given layout (new position i gets old order[i])', () => {
    const s = createGame();
    setup(s);
    pushOpGen(s, 0, function* () {
      yield { op: 'reorderProtocols', order: [2, 0, 1] };
    });
    runStack(s);
    expect(s.players[0].protocols.map((p) => p.defId)).toEqual(['darkness', 'fire', 'light']);
  });

  it('rejects non-permutation or unchanged order', () => {
    const s = createGame();
    setup(s);
    pushOpGen(s, 0, function* () {
      yield { op: 'reorderProtocols', order: [0, 0, 1] };
    });
    expect(() => runStack(s)).toThrow();
    const s2 = createGame();
    setup(s2);
    pushOpGen(s2, 0, function* () {
      yield { op: 'reorderProtocols', order: [0, 1, 2] };
    });
    expect(() => runStack(s2)).toThrow();
  });
});

// ============ G8 drawFromDeck / shuffle helpers ============

describe('G8 drawFromDeck', () => {
  it('draws the chosen card from anywhere in the deck, keeping remaining order', () => {
    const s = createGame();
    const c0 = makeCard('death-0', 0, 'deck', false);
    const c1 = makeCard('death-1', 0, 'deck', false);
    const c2 = makeCard('fire-0', 0, 'deck', false);
    s.players[0].deck = [c0, c1, c2];
    pushOpGen(s, 0, function* () {
      yield { op: 'drawFromDeck', uid: c1.uid };
    });
    runStack(s);
    expect(s.players[0].hand.map((c) => c.uid)).toEqual([c1.uid]);
    expect(c1.faceUp).toBe(true);
    expect(s.players[0].deck.map((c) => c.uid)).toEqual([c0.uid, c2.uid]); // 剩余顺序保持
  });
});

describe('G8 shuffleTrashIntoDeck', () => {
  it('merges trash into deck face-down and clears trash', () => {
    const s = createGame();
    const c0 = makeCard('death-0', 0, 'deck', false);
    const t1 = makeCard('fire-1', 0, 'trash', true);
    s.players[0].deck = [c0];
    s.players[0].trash = [t1];
    shuffleTrashIntoDeck(s, 0);
    expect(s.players[0].trash).toHaveLength(0);
    expect(s.players[0].deck).toHaveLength(2);
    for (const c of s.players[0].deck) expect(c.faceUp).toBe(false);
    expect(t1.zone).toBe('deck');
  });
});

// ============ G5 fireReactive 新方向与 top 尊重 ============

describe('G5 reactive directions and bottom-command coverage', () => {
  it('after-opponent-draw fires on the OPPONENT side when I draw (mirror-4)', () => {
    const s = createGame();
    const trig = makeCard('g2-opp-draw', 1, 'field', true, 0, 0); // P1 场上
    placeRaw(s, trig, 1, 0);
    s.players[0].deck = [makeCard('death-5', 0, 'deck', false)];
    s.players[1].deck = [makeCard('death-6', 1, 'deck', false)];
    pushOpGen(s, 0, function* () {
      yield { op: 'draw', count: 1 };
    });
    runStack(s);
    expect(s.players[0].hand).toHaveLength(1); // 抽牌者 P0
    expect(s.players[1].hand).toHaveLength(1); // P1 的 after-opponent-draw 触发抽 1
  });

  it('after-self-discard fires on my own side when I discard (peace-4)', () => {
    const s = createGame();
    const trig = makeCard('g2-self-discard', 0, 'field', true, 0, 0);
    placeRaw(s, trig, 0, 0);
    const h = makeCard('death-0', 0, 'hand');
    s.players[0].hand.push(h);
    s.players[0].deck = [makeCard('death-5', 0, 'deck', false)];
    pushOpGen(s, 0, function* () {
      yield { op: 'discard', uid: h.uid };
    });
    runStack(s);
    expect(s.players[0].hand).toHaveLength(1); // 自身侧 after-self-discard 触发抽 1（弃 1 后）
  });

  it('bottom-command reaction does NOT fire when covered', () => {
    const s = createGame();
    const trig = makeCard('g2-bottom-draw', 0, 'field', true, 0, 0);
    const flipTarget = makeCard('death-0', 0, 'field', true, 0, 1);
    placeRaw(s, trig, 0, 0);
    placeRaw(s, flipTarget, 0, 0); // 盖住 trig（顶卡 death-0，若误触发会被翻）
    s.players[0].deck = [makeCard('death-5', 0, 'deck', false)];
    pushOpGen(s, 0, function* () {
      yield { op: 'draw', count: 1 };
    });
    runStack(s);
    expect(s.players[0].hand).toHaveLength(1); // 只有 draw 的 1 张
    expect(flipTarget.faceUp).toBe(true); // 未被翻转 → 底命令未触发
  });

  it('bottom-command reaction fires when it is the uncovered top card', () => {
    const s = createGame();
    const trig = makeCard('g2-bottom-draw', 0, 'field', true, 0, 0);
    const flipTarget = makeCard('death-0', 0, 'field', true, 0, 1);
    placeRaw(s, flipTarget, 0, 0);
    placeRaw(s, trig, 0, 0); // 顶卡 = trig（未覆盖）
    s.players[0].deck = [makeCard('death-5', 0, 'deck', false)];
    pushOpGen(s, 0, function* () {
      yield { op: 'draw', count: 1 };
    });
    runStack(s);
    expect(s.players[0].hand).toHaveLength(1); // draw 1
    expect(flipTarget.faceUp).toBe(false); // 底命令触发 → 翻转 death-0
  });
});

// ============ G6 chaos-3 任意线放行 ============

describe('G6 cardAllowsFaceUpAnyLine', () => {
  it('chaos-3 can be played face-up to any line regardless of protocol match', () => {
    const s = createGame();
    s.players[0].protocols = [
      { defId: 'fire', compiled: false },
      { defId: 'light', compiled: false },
      { defId: 'darkness', compiled: false },
    ];
    const c = makeCard('chaos-3', 0, 'hand');
    s.players[0].hand.push(c);
    for (const line of [0, 1, 2] as Line[]) {
      expect(isPlayableFaceUp(s, 0, c.uid, line)).toBe(true);
    }
  });

  it('other cards still require a matching protocol line', () => {
    const s = createGame();
    s.players[0].protocols = [
      { defId: 'fire', compiled: false },
      { defId: 'light', compiled: false },
      { defId: 'darkness', compiled: false },
    ];
    const c = makeCard('death-0', 0, 'hand'); // 死 不匹配火/光/暗
    s.players[0].hand.push(c);
    for (const line of [0, 1, 2] as Line[]) {
      expect(isPlayableFaceUp(s, 0, c.uid, line)).toBe(false);
    }
  });
});

// ============ deckReveals 过期 ============

describe('deckReveals lifecycle', () => {
  it('clears expired deck reveals on turn-end transitions', () => {
    const s = createGame();
    s.deckReveals.push({ id: 'd1', player: 0, whole: true, expiresAtTurn: s.turnCount + 2 });
    s.deckReveals.push({ id: 'd2', player: 0, whole: false, expiresAtTurn: s.turnCount + 1 });
    // 推进直到回合结束转换发生 2 次（step 从 start 走一圈回 start = 换人 +1）
    for (let i = 0; i < 12; i++) {
      advanceStep(s);
      if (s.deckReveals.length === 0) break;
    }
    expect(s.deckReveals).toHaveLength(0);
  });
});
