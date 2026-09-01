import { describe, it, expect } from 'vitest';
import type { Card, GameState, Line, PlayerId } from '../../src/core/models/types';
import { createGame } from '../../src/core/state/create';
import { registerCardEffects } from '../../src/core/effects/registry';
import { answerEffect, resolveMiddle, runStack } from '../../src/core/effects/resolve';
import { executeAction } from '../../src/core/game';
import { makeCard } from '../helpers';

/** 测试用 defId：真实游戏不用 't-*' 前缀，注册不会污染正式效果（正式效果由 cards/*.ts 注册） */

function place(s: GameState, card: Card, owner: PlayerId, line: Line): void {
  card.zone = 'field';
  card.faceUp = true;
  card.line = line;
  card.pos = s.players[owner].stacks[line].length;
  s.players[owner].stacks[line].push(card);
}

/** 手动推一个 system 效果（跳过 sourceValid 源卡校验）执行单个 op */
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

// ============ 测试用效果注册 ============

registerCardEffects('t-draw-target', {
  middle: function* (ctx) {
    yield { op: 'draw', count: 2, player: 1 };
  },
});

registerCardEffects('t-draw-oppdeck', {
  middle: function* (ctx) {
    if (ctx.s.players[1].deck.length > 0 || ctx.s.players[1].trash.length > 0) {
      yield { op: 'draw', count: 1, fromOpponentDeck: true };
    }
  },
});

registerCardEffects('t-ptd-opp', {
  middle: function* (ctx) {
    if (ctx.s.players[1].deck.length > 0 || ctx.s.players[1].trash.length > 0) {
      yield { op: 'playTopDeck', line: 0, faceUp: false, player: 1 };
    }
  },
});

registerCardEffects('t-ptd-below', {
  middle: function* (ctx) {
    yield { op: 'playTopDeck', line: ctx.card.line!, faceUp: false, belowUid: ctx.card.uid };
    yield { op: 'playTopDeck', line: ctx.card.line!, faceUp: false, belowUid: ctx.card.uid };
  },
});

registerCardEffects('t-ptd-below-gone', {
  middle: function* (ctx) {
    // 删除另一张卡 X（非效果源，源卡留在场上），随后 playTopDeck belowUid=X → X 已不在 → 回退落顶
    const x = ctx.s.players[0].stacks[0].find((c) => c.defId === 'death-1');
    if (x) yield { op: 'delete', uid: x.uid };
    yield { op: 'playTopDeck', line: 0, faceUp: false, belowUid: x?.uid ?? 'gone' };
  },
});

registerCardEffects('t-before-flip', {
  triggers: {
    'before-flip': {
      fn: function* (ctx) {
        yield { op: 'delete', uid: ctx.card.uid }; // metal-6 语义：翻转前删自己
      },
      optional: false,
    },
  },
});

registerCardEffects('t-flip-src', {
  middle: function* (ctx) {
    // 直接翻另一条线（线 1）场上的 t-before-flip 卡（不列候选，避免 getCardDef 依赖）
    const card = ctx.s.players[0].stacks[1].find((c) => c.defId === 't-before-flip');
    if (card) yield { op: 'flip', uid: card.uid };
  },
});

registerCardEffects('t-after-draw', {
  triggers: {
    'after-draw': {
      // 触发效果为翻转（非抽牌）——避免「抽牌→触发抽牌」无限自循环（真实协议 after-draw
      // 如 spirit-3 是可选平移，不会自循环）
      fn: function* (ctx) {
        const card = ctx.s.players[0].stacks[0].find((c) => c.defId === 'death-0');
        if (card) yield { op: 'flip', uid: card.uid };
      },
      optional: false,
    },
  },
});

registerCardEffects('t-after-discard', {
  triggers: {
    'after-discard': {
      fn: function* (ctx) {
        yield { op: 'draw', count: 1 };
      },
      optional: false,
    },
  },
});

registerCardEffects('t-after-delete', {
  triggers: {
    'after-delete': {
      fn: function* (ctx) {
        yield { op: 'draw', count: 1 };
      },
      optional: false,
    },
  },
});

registerCardEffects('t-after-cache', {
  triggers: {
    'after-clear-cache': {
      fn: function* (ctx) {
        yield { op: 'draw', count: 1 };
      },
      optional: false,
    },
  },
});

// ============ draw op 扩展 ============

describe('draw op extension', () => {
  it('honors player (draws for the specified player)', () => {
    const s = createGame();
    const c = makeCard('t-draw-target', 0, 'field', true, 0, 0);
    place(s, c, 0, 0);
    s.players[1].deck = [makeCard('death-0', 1, 'deck', false), makeCard('death-1', 1, 'deck', false)];
    resolveMiddle(s, 0, c);
    expect(s.players[1].hand).toHaveLength(2);
    expect(s.players[0].hand).toHaveLength(0);
  });

  it('fromOpponentDeck steals opponent top, reshuffling their trash when deck empty', () => {
    const s = createGame();
    const c = makeCard('t-draw-oppdeck', 0, 'field', true, 0, 0);
    place(s, c, 0, 0);
    const trashCard = makeCard('death-2', 1, 'trash', true);
    s.players[1].trash.push(trashCard);
    resolveMiddle(s, 0, c);
    expect(s.players[0].hand).toHaveLength(1);
    expect(s.players[0].hand[0]).toBe(trashCard);
    expect(trashCard.owner).toBe(0);
    expect(trashCard.secret).toBeFalsy();
    expect(s.players[1].deck).toHaveLength(0);
    expect(s.players[1].trash).toHaveLength(0);
  });

  it('fromOpponentDeck fizzles when opponent deck+trash both empty', () => {
    const s = createGame();
    const c = makeCard('t-draw-oppdeck', 0, 'field', true, 0, 0);
    place(s, c, 0, 0);
    expect(() => resolveMiddle(s, 0, c)).not.toThrow();
    expect(s.players[0].hand).toHaveLength(0);
  });
});

// ============ playTopDeck 扩展 ============

describe('playTopDeck extension', () => {
  it('honors player (plays opponent deck top face-down into their line)', () => {
    const s = createGame();
    const c = makeCard('t-ptd-opp', 0, 'field', true, 0, 0);
    place(s, c, 0, 0);
    s.players[1].deck = [makeCard('death-3', 1, 'deck', false)];
    resolveMiddle(s, 0, c);
    expect(s.players[1].stacks[0]).toHaveLength(1);
    expect(s.players[1].stacks[0][0].zone).toBe('field');
    expect(s.players[1].stacks[0][0].faceUp).toBe(false);
    expect(s.players[1].stacks[0][0].secret).toBe(true); // 牌堆来源反面 = secret
  });

  it('belowUid inserts under the source card (source stays uncovered, pos reindexed)', () => {
    const s = createGame();
    const under = makeCard('death-4', 0, 'field', true, 0, 0);
    const src = makeCard('t-ptd-below', 0, 'field', true, 0, 1);
    place(s, under, 0, 0);
    place(s, src, 0, 0);
    s.players[0].deck = [makeCard('death-5', 0, 'deck', false), makeCard('death-0', 0, 'deck', false)];
    resolveMiddle(s, 0, src);
    const stack = s.players[0].stacks[0];
    expect(stack).toHaveLength(4);
    expect(stack[3].uid).toBe(src.uid); // 源卡仍为顶卡（未被覆盖）
    expect(stack[1].defId).toBe('death-0'); // 第一张（deck.pop 取末尾）垫在下方
    expect(stack[2].defId).toBe('death-5'); // 第二张垫在源卡正下方（FIFO 顺序）
    expect(stack.map((c) => c.pos)).toEqual([0, 1, 2, 3]); // pos 重索引
  });

  it('belowUid falls back to the top when the source card is gone', () => {
    const s = createGame();
    // src 在线 1（效果源，不被揭开连锁影响）；X 在线 0（唯一卡，删除后无揭开连锁）
    const src = makeCard('t-ptd-below-gone', 0, 'field', true, 1, 0);
    const x = makeCard('death-1', 0, 'field', true, 0, 0);
    place(s, src, 0, 1);
    place(s, x, 0, 0);
    s.players[0].deck = [makeCard('death-2', 0, 'deck', false)];
    resolveMiddle(s, 0, src);
    const stack = s.players[0].stacks[0];
    expect(x.zone).toBe('trash'); // X 被删除
    expect(stack).toHaveLength(1);
    expect(stack[0].zone).toBe('field'); // 新卡回退落顶（belowUid 的 X 已不在）
    expect(stack[0].defId).toBe('death-2');
    expect(s.players[0].stacks[1][0].uid).toBe(src.uid); // 效果源卡仍在
  });
});

// ============ give / takeRandom ============

describe('give / takeRandom', () => {
  it('give moves a hand card to the target player', () => {
    const s = createGame();
    const card = makeCard('death-0', 0, 'hand');
    s.players[0].hand.push(card);
    pushOpGen(s, 0, function* () {
      yield { op: 'give', uid: card.uid, to: 1 };
    });
    runStack(s);
    expect(s.players[0].hand).toHaveLength(0);
    expect(s.players[1].hand).toHaveLength(1);
    expect(card.owner).toBe(1);
  });

  it('give throws for a non-hand card', () => {
    const s = createGame();
    const card = makeCard('death-0', 0, 'field', true, 0, 0);
    place(s, card, 0, 0);
    pushOpGen(s, 0, function* () {
      yield { op: 'give', uid: card.uid, to: 1 };
    });
    expect(() => runStack(s)).toThrow('not in hand');
  });

  it('takeRandom steals one random hand card', () => {
    const s = createGame();
    s.players[1].hand.push(makeCard('death-1', 1, 'hand'), makeCard('death-2', 1, 'hand'));
    pushOpGen(s, 0, function* () {
      yield { op: 'takeRandom', from: 1 };
    });
    runStack(s);
    expect(s.players[0].hand).toHaveLength(1);
    expect(s.players[1].hand).toHaveLength(1);
    expect(s.players[0].hand[0].owner).toBe(0);
  });

  it('takeRandom throws when the source hand is empty (caller guards)', () => {
    const s = createGame();
    pushOpGen(s, 0, function* () {
      yield { op: 'takeRandom', from: 1 };
    });
    expect(() => runStack(s)).toThrow('no cards to take');
  });
});

// ============ rearrangeProtocols 目标玩家 ============

describe('rearrangeProtocols player', () => {
  it('rearranges the opponent protocols when player is specified', () => {
    const s = createGame();
    s.players[0].protocols = [
      { defId: 'fire', compiled: false },
      { defId: 'light', compiled: false },
      { defId: 'darkness', compiled: false },
    ];
    s.players[1].protocols = [
      { defId: 'death', compiled: false },
      { defId: 'spirit', compiled: false },
      { defId: 'gravity', compiled: false },
    ];
    pushOpGen(s, 0, function* () {
      yield { op: 'rearrangeProtocols', a: 0, b: 2, player: 1 };
    });
    runStack(s);
    expect(s.players[1].protocols.map((p) => p.defId)).toEqual(['gravity', 'spirit', 'death']);
    expect(s.players[0].protocols.map((p) => p.defId)).toEqual(['fire', 'light', 'darkness']);
  });
});

// ============ before-flip ============

describe('before-flip trigger', () => {
  it('fires instead of the flip (card deleted, flip does not happen)', () => {
    const s = createGame();
    const src = makeCard('t-flip-src', 0, 'field', true, 0, 0);
    const target = makeCard('t-before-flip', 0, 'field', true, 1, 0);
    place(s, src, 0, 0); // 线 0 顶卡（效果源）
    place(s, target, 0, 1); // 线 1 顶卡（翻转目标）
    resolveMiddle(s, 0, src);
    expect(target.zone).toBe('trash'); // before-flip 删自己
    expect(target.faceUp).toBe(true); // 删除置正面（未发生翻转）
    expect(src.zone).toBe('field'); // 效果源卡仍有效
  });
});

// ============ 即时连锁触发 after-* ============

describe('fireReactive after-* triggers', () => {
  it('after-draw fires on a draw op even when the trigger card is covered', () => {
    const s = createGame();
    const trig = makeCard('t-after-draw', 0, 'field', true, 0, 0);
    const cover = makeCard('death-0', 0, 'field', true, 0, 1);
    place(s, trig, 0, 0);
    place(s, cover, 0, 0); // 盖住 trig（顶卡 = death-0，触发翻转目标）
    s.players[0].deck = [makeCard('death-1', 0, 'deck', false)];
    pushOpGen(s, 0, function* () {
      yield { op: 'draw', count: 1 };
    });
    runStack(s);
    expect(s.players[0].hand).toHaveLength(1); // draw 1
    expect(cover.faceUp).toBe(false); // 被盖的 t-after-draw 仍触发 → 翻转 death-0
  });

  it('after-draw also fires after a fromOpponentDeck draw', () => {
    const s = createGame();
    const trig = makeCard('t-after-draw', 0, 'field', true, 0, 0);
    const flipTarget = makeCard('death-0', 0, 'field', true, 0, 1);
    place(s, trig, 0, 0);
    place(s, flipTarget, 0, 0);
    s.players[1].deck = [makeCard('death-3', 1, 'deck', false)];
    pushOpGen(s, 0, function* () {
      yield { op: 'draw', count: 1, fromOpponentDeck: true };
    });
    runStack(s);
    expect(s.players[0].hand).toHaveLength(1); // 偷 1
    expect(flipTarget.faceUp).toBe(false); // after-draw 触发 → 翻转
  });

  it('after-discard fires on the OPPONENT of the discarding player', () => {
    const s = createGame();
    const trig = makeCard('t-after-discard', 1, 'field', true, 0, 0);
    place(s, trig, 1, 0);
    s.players[1].deck = [makeCard('death-5', 1, 'deck', false)];
    const d = makeCard('death-0', 0, 'hand');
    s.players[0].hand.push(d);
    pushOpGen(s, 0, function* () {
      yield { op: 'discard', uid: d.uid };
    });
    runStack(s);
    expect(s.players[1].hand).toHaveLength(1); // P2 抽 1
    expect(s.players[0].hand).toHaveLength(0);
  });

  it('own discard does NOT trigger own after-discard card', () => {
    const s = createGame();
    const trig = makeCard('t-after-discard', 0, 'field', true, 0, 0);
    place(s, trig, 0, 0);
    const d = makeCard('death-0', 0, 'hand');
    s.players[0].hand.push(d);
    pushOpGen(s, 0, function* () {
      yield { op: 'discard', uid: d.uid };
    });
    runStack(s);
    expect(s.players[0].hand).toHaveLength(0); // 无触发
  });

  it('system cache-clear discard also fires after-discard on the opponent', () => {
    const s = createGame();
    s.phase = 'turn';
    const trig = makeCard('t-after-discard', 1, 'field', true, 0, 0);
    place(s, trig, 1, 0);
    s.players[1].deck = [makeCard('death-5', 1, 'deck', false)];
    for (let i = 0; i < 6; i++) s.players[0].hand.push(makeCard('death-0', 0, 'hand'));
    s.step = 'check-cache';
    executeAction(s, 0, 'clear-cache');
    const top = s.pendingEffects[s.pendingEffects.length - 1];
    answerEffect(s, top.id, [top.prompt!.candidates[0].uid]);
    expect(s.players[1].hand).toHaveLength(1); // 对手抽 1
    expect(s.players[0].hand).toHaveLength(5);
  });

  it('after-delete fires for the owner of the deleted card (effect delete only)', () => {
    const s = createGame();
    const trig = makeCard('t-after-delete', 0, 'field', true, 0, 0);
    place(s, trig, 0, 0);
    const victim = makeCard('death-1', 0, 'field', true, 0, 1);
    place(s, victim, 0, 0);
    s.players[0].deck = [makeCard('death-2', 0, 'deck', false)];
    pushOpGen(s, 0, function* () {
      yield { op: 'delete', uid: victim.uid };
    });
    runStack(s);
    expect(s.players[0].hand).toHaveLength(1); // 触发抽 1
    expect(victim.zone).toBe('trash');
  });

  it('compile delete does NOT fire after-delete', () => {
    const s = createGame();
    s.phase = 'turn';
    s.players[0].protocols = [{ defId: 'death', compiled: false }, { defId: 'fire', compiled: false }, { defId: 'light', compiled: false }];
    s.players[1].protocols = [{ defId: 'spirit', compiled: false }, { defId: 'water', compiled: false }, { defId: 'life', compiled: false }];
    const trig = makeCard('t-after-delete', 0, 'field', true, 1, 0); // 触发卡放线 1（不参与线 0 估值/编译）
    place(s, trig, 0, 1);
    for (let i = 0; i < 10; i++) place(s, makeCard('death-1', 0, 'field', true, 0, i + 1), 0, 0);
    place(s, makeCard('death-0', 1, 'field', true, 0, 0), 1, 0);
    executeAction(s, 0, 'compile', { line: 0 });
    expect(s.players[0].protocols[0].compiled).toBe(true);
    expect(trig.zone).toBe('field'); // trig 在线 1，编译线 0 不删它（验证编译删除不触发 after-delete）
    expect(s.players[0].hand).toHaveLength(0); // 编译删除不触发 after-delete（场上有 after-delete 卡也不触发）
    expect(s.pendingEffects).toHaveLength(0);
  });

  it('after-clear-cache fires after the cache-clear flow', () => {
    const s = createGame();
    s.phase = 'turn';
    const trig = makeCard('t-after-cache', 0, 'field', true, 0, 0);
    place(s, trig, 0, 0);
    s.players[0].deck = [makeCard('death-5', 0, 'deck', false)];
    for (let i = 0; i < 6; i++) s.players[0].hand.push(makeCard('death-0', 0, 'hand'));
    s.step = 'check-cache';
    executeAction(s, 0, 'clear-cache');
    const top = s.pendingEffects[s.pendingEffects.length - 1];
    answerEffect(s, top.id, [top.prompt!.candidates[0].uid]);
    expect(s.players[0].hand).toHaveLength(6); // 弃 1 后触发抽 1
    expect(s.step).toBe('end'); // 触发完成后步骤推进
  });
});

// ============ before-compile / pendingCompile ============

describe('before-compile / pendingCompile', () => {
  it('compile with a face-up speed-2 on the line sets pendingCompile and still completes the compile', () => {
    const s = createGame();
    s.phase = 'turn';
    s.step = 'check-compile';
    s.players[0].protocols = [{ defId: 'death', compiled: false }, { defId: 'fire', compiled: false }, { defId: 'light', compiled: false }];
    s.players[1].protocols = [{ defId: 'spirit', compiled: false }, { defId: 'water', compiled: false }, { defId: 'life', compiled: false }];
    for (let i = 0; i < 10; i++) place(s, makeCard('death-1', 0, 'field', true, 0, i), 0, 0);
    place(s, makeCard('death-0', 1, 'field', true, 0, 0), 1, 0);
    place(s, makeCard('speed-2', 0, 'field', true, 0, 10), 0, 0);
    executeAction(s, 0, 'compile', { line: 0 });
    expect(s.players[0].protocols[0].compiled).toBe(true);
    expect(s.pendingCompile).toBeNull(); // 已消费
    expect(s.pendingEffects).toHaveLength(0);
  });

  it('compile without speed-2 keeps the original behavior', () => {
    const s = createGame();
    s.phase = 'turn';
    s.step = 'check-compile';
    s.players[0].protocols = [{ defId: 'death', compiled: false }, { defId: 'fire', compiled: false }, { defId: 'light', compiled: false }];
    s.players[1].protocols = [{ defId: 'spirit', compiled: false }, { defId: 'water', compiled: false }, { defId: 'life', compiled: false }];
    for (let i = 0; i < 10; i++) place(s, makeCard('death-1', 0, 'field', true, 0, i), 0, 0);
    place(s, makeCard('death-0', 1, 'field', true, 0, 0), 1, 0);
    executeAction(s, 0, 'compile', { line: 0 });
    expect(s.players[0].protocols[0].compiled).toBe(true);
    expect(s.players[0].stacks[0]).toHaveLength(0);
    expect(s.players[1].stacks[0]).toHaveLength(0);
    expect(s.compiledThisTurn).toBe(true);
  });
});
