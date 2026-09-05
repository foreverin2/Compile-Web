import { describe, it, expect } from 'vitest';
import type { ChoiceRequest, GameState, Line, PlayerId } from '../../src/core/models/types';
import { createGame, stackValue } from '../../src/core/state/create';
import { registerCardEffects } from '../../src/core/effects/registry';
import { resolveMiddle, runStack } from '../../src/core/effects/resolve';
import { collectTriggers, collectTriggerFor, resolveTrigger } from '../../src/core/effects/triggers';
import { executeAction } from '../../src/core/game';
import { makeCard, pickFirst, resolveAllChoices } from '../helpers';

/**
 * 2代 批1 五套卡效果测试（幸运/明镜/和平/混乱/明晰）。
 * 驱动：resolveMiddle 直接结算中指令 + resolveAllChoices 自动应答；end/after-* 用 collectTriggers/resolveTrigger
 * 或 pushOpGen。协议占位 [fire,light,darkness]（resolveMiddle 不打不查协议匹配；仅 play/落线判定用）。
 */

registerCardEffects('g2b-mid-draw', {
  middle: function* () {
    yield { op: 'draw', count: 1 };
  },
});

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

/** 默认选择器：可选事件跳过；必选事件取前 max 个候选（fire-4 会全选，测试可接受）。
 *  kind 感知：select-line / select-action 的 candidates 为空 → 按线/操作编码自动应答（防 flaky）。 */

/** eager 选择器：忽略 optional，尽力选第一个可选项（测试驱动「玩家总是继续」）；
 *  无可选（候选/线/动作空）→ 返回 []（fizzle 语义） */
function eagerPick(prompt: ChoiceRequest): string[] {
  if (prompt.kind === 'select-line') return prompt.lines && prompt.lines.length > 0 ? [`line:${prompt.lines[0]}`] : [];
  if (prompt.kind === 'select-action') return prompt.actions && prompt.actions.length > 0 ? [prompt.actions[0]] : [];
  if (prompt.candidates.length === 0) return [];
  return prompt.candidates.slice(0, prompt.max).map((c) => c.uid);
}

/** 放置被测源卡到 P0 线 0（faceUp 顶卡），返回 resolveMiddle 前状态 */
function placeAndResolve(s: GameState, defId: string, opts?: { hand?: string[]; deck?: string[]; oppDeck?: string[] }): GameState {
  const src = makeCard(defId, 0, 'field', true, 0, 0);
  s.players[0].stacks[0] = [src];
  if (opts?.hand) s.players[0].hand = opts.hand.map((d) => makeCard(d, 0, 'hand'));
  if (opts?.deck) s.players[0].deck = opts.deck.map((d) => makeCard(d, 0, 'deck', false));
  if (opts?.oppDeck) s.players[1].deck = opts.oppDeck.map((d) => makeCard(d, 1, 'deck', false));
  resolveMiddle(s, 0, src);
  resolveAllChoices(s, eagerPick);
  return s;
}

// ============ 幸运 luck ============

describe('luck effects', () => {
  it('luck-5 discards one hand card', () => {
    const s = setup();
    const src = makeCard('luck-5', 0, 'field', true, 0, 0);
    s.players[0].stacks[0] = [src];
    s.players[0].hand = [makeCard('death-0', 0, 'hand'), makeCard('fire-1', 0, 'hand')];
    resolveMiddle(s, 0, src);
    resolveAllChoices(s, eagerPick);
    expect(s.players[0].hand).toHaveLength(1);
    expect(s.players[0].trash).toHaveLength(1);
  });

  it('luck-1 plays deck top face-down then flips it ignoring its middle command', () => {
    const s = setup();
    const src = makeCard('luck-1', 0, 'field', true, 2, 0); // 源卡放线 2（避免打出落线 0 覆盖自己）
    s.players[0].stacks[2] = [src];
    s.players[0].deck = [makeCard('death-5', 0, 'deck', false), makeCard('g2b-mid-draw', 0, 'deck', false)]; // 顶 = g2b-mid-draw
    resolveMiddle(s, 0, src);
    resolveAllChoices(s, eagerPick); // 选线 0 → playTopDeck → 翻正 noMiddle
    const top = s.players[0].stacks[0][s.players[0].stacks[0].length - 1];
    expect(top.defId).toBe('g2b-mid-draw');
    expect(top.faceUp).toBe(true);
    expect(s.players[0].hand).toHaveLength(0); // 中指令被忽略：未抽
  });

  it('luck-2 discards deck top and draws its printed value', () => {
    const s = setup();
    const src = makeCard('luck-2', 0, 'field', true, 0, 0);
    s.players[0].stacks[0] = [src];
    // 顶 = death-2（值 2）→ 弃后抽 2（剩余 death-0/death-1）
    s.players[0].deck = [makeCard('death-0', 0, 'deck', false), makeCard('death-1', 0, 'deck', false), makeCard('death-2', 0, 'deck', false)];
    resolveMiddle(s, 0, src);
    expect(s.players[0].trash).toHaveLength(1);
    expect(s.players[0].trash[0].defId).toBe('death-2');
    expect(s.players[0].hand).toHaveLength(2);
    expect(s.players[0].deck).toHaveLength(0);
  });

  it('luck-3 declares protocol, discards opponent deck top, deletes an uncovered card on match', () => {
    const s = setup();
    const src = makeCard('luck-3', 0, 'field', true, 0, 0);
    s.players[0].stacks[0] = [src];
    const target = makeCard('fire-5', 1, 'field', true, 1, 0); // 场上待删卡（对手线1顶）
    s.players[1].stacks[1] = [target];
    s.players[1].deck = [makeCard('death-5', 1, 'deck', false), makeCard('fire-1', 1, 'deck', false)]; // 顶 = fire-1（protocol fire）
    resolveMiddle(s, 0, src);
    resolveAllChoices(s, eagerPick); // 宣告第一个 action（fire）→ 命中 → 删除候选第一张
    expect(s.players[1].deck).toHaveLength(1);
    expect(s.players[1].trash).toHaveLength(2); // fire-1（弃库顶） + fire-5（删除目标）
    expect(s.players[1].trash.map((c) => c.defId)).toEqual(expect.arrayContaining(['fire-1', 'fire-5']));
    expect(s.players[0].stacks[0]).toHaveLength(1); // 源卡仍在
  });

  it('luck-4 discards own deck top and deletes a card of equal current value (covered allowed)', () => {
    const s = setup();
    const src = makeCard('luck-4', 0, 'field', true, 0, 0);
    const coveredTarget = makeCard('death-2', 1, 'field', false, 1, 0); // 被盖反面值卡（现时值 2）
    const cover = makeCard('fire-0', 1, 'field', true, 1, 1);
    s.players[0].stacks[0] = [src];
    s.players[1].stacks[1] = [coveredTarget, cover];
    s.players[0].deck = [makeCard('death-0', 0, 'deck', false), makeCard('death-2', 0, 'deck', false)]; // 弃顶 death-2（值2）
    resolveMiddle(s, 0, src);
    resolveAllChoices(s, eagerPick);
    expect(s.players[0].trash[0].defId).toBe('death-2');
    expect(s.players[1].stacks[1]).toHaveLength(1); // 删了 1 张（covered 或顶）
  });
});

// ============ 明镜 mirror ============

describe('mirror effects', () => {
  it('mirror-2 swaps two stacks entirely', () => {
    const s = setup();
    const a0 = makeCard('death-0', 0, 'field', false, 0, 0); // 线0 被盖底卡
    const src = makeCard('mirror-2', 0, 'field', true, 0, 1); // 线0 顶卡（源卡）
    s.players[0].stacks[0] = [a0, src];
    s.players[0].stacks[1] = [makeCard('fire-0', 0, 'field', false, 1, 0)]; // 线1
    resolveMiddle(s, 0, src);
    resolveAllChoices(s, eagerPick); // 选线0（第一个）→ 选排除后的第一线（线1）
    expect(s.players[0].stacks[0].map((c) => c.defId)).toEqual(['fire-0']);
    expect(s.players[0].stacks[1].map((c) => c.defId)).toEqual(['death-0', 'mirror-2']);
    expect(s.players[0].stacks[1][0].line).toBe(1);
  });

  it('mirror-4 draws when the OPPONENT draws (after-opponent-draw)', () => {
    const s = setup();
    const trig = makeCard('mirror-4', 1, 'field', true, 0, 0); // P1 场上
    s.players[1].stacks[0] = [trig];
    s.players[1].deck = [makeCard('death-5', 1, 'deck', false)];
    s.players[0].deck = [makeCard('death-6', 0, 'deck', false)];
    s.pendingEffects.push({
      id: 't-draw', player: 0, system: true,
      gen: (function* (): Generator<unknown, void, unknown> {
        yield { op: 'draw', count: 1 };
      })() as never,
      sourceUid: 't-src', sourceDefId: 't-sys', prompt: null, lastAnswer: null,
    });
    runStack(s);
    expect(s.players[0].hand).toHaveLength(1); // P0 抽 1
    expect(s.players[1].hand).toHaveLength(1); // mirror-4 连锁 P1 抽 1
  });

  it('mirror-1 end copies an opponent middle command executed by the copier', () => {
    const s = setup();
    s.turnPlayer = 0;
    s.step = 'end';
    const src = makeCard('mirror-1', 0, 'field', true, 0, 0);
    const target = makeCard('luck-2', 1, 'field', true, 1, 0); // 对手卡（middle：弃自己库顶抽对应张）
    s.players[0].stacks[0] = [src];
    s.players[1].stacks[1] = [target];
    s.players[0].deck = [makeCard('death-0', 0, 'deck', false), makeCard('death-2', 0, 'deck', false)]; // 弃顶 death-2 → 抽 2
    const trigs = collectTriggers(s, 'end');
    const t = trigs.find((x) => x.cardUid === src.uid);
    expect(t).toBeTruthy();
    resolveTrigger(s, t!);
    runStack(s);
    resolveAllChoices(s, eagerPick); // 选 target（对手顶卡唯一）→ copyMiddle
    // 「你」= 复制者 P0：弃 P0 牌库顶 death-2 → 抽 2（先抽 death-0，牌库空洗弃牌堆把 death-2 洗回再抽）
    expect(s.players[0].deck).toHaveLength(0);
    expect(s.players[0].hand.map((c) => c.defId).sort()).toEqual(['death-0', 'death-2']);
    expect(s.players[0].trash).toHaveLength(0);
    expect(s.players[1].hand).toHaveLength(0); // 对手不受复制影响
  });
});

// ============ 和平 peace ============

describe('peace effects', () => {
  it('peace-1 middle discards ALL hands (owner first, then opponent)', () => {
    const s = setup();
    const src = makeCard('peace-1', 0, 'field', true, 0, 0);
    s.players[0].stacks[0] = [src];
    s.players[0].hand = [makeCard('death-0', 0, 'hand'), makeCard('death-1', 0, 'hand')];
    s.players[1].hand = [makeCard('fire-0', 1, 'hand')];
    resolveMiddle(s, 0, src);
    resolveAllChoices(s, eagerPick);
    expect(s.players[0].hand).toHaveLength(0);
    expect(s.players[1].hand).toHaveLength(0);
    expect(s.players[0].trash).toHaveLength(2);
    expect(s.players[1].trash).toHaveLength(1);
  });

  it('peace-1 end draws when own hand is empty', () => {
    const s = setup();
    s.turnPlayer = 0;
    s.step = 'end';
    const src = makeCard('peace-1', 0, 'field', true, 0, 0);
    s.players[0].stacks[0] = [src];
    s.players[0].deck = [makeCard('death-5', 0, 'deck', false)];
    const trigs = collectTriggers(s, 'end');
    const t = trigs.find((x) => x.cardUid === src.uid);
    resolveTrigger(s, t!);
    runStack(s);
    expect(s.players[0].hand).toHaveLength(1);
  });

  it('peace-6 flips itself when hand count > 1', () => {
    const s = setup();
    const src = makeCard('peace-6', 0, 'field', true, 0, 0);
    s.players[0].stacks[0] = [src];
    s.players[0].hand = [makeCard('death-0', 0, 'hand'), makeCard('death-1', 0, 'hand')];
    resolveMiddle(s, 0, src);
    expect(src.faceUp).toBe(false); // 已翻回反面
  });
});

// ============ 混乱 chaos ============

describe('chaos effects', () => {
  it('chaos-0 flips one covered face-down card per line', () => {
    const s = setup();
    const src = makeCard('chaos-0', 0, 'field', true, 0, 0);
    const buried = makeCard('death-0', 0, 'field', false, 0, 1); // 被盖反面
    s.players[0].stacks[0] = [buried, src];
    s.players[0].stacks[1] = [makeCard('fire-5', 0, 'field', true, 1, 0)]; // 无线1 无盖牌
    resolveMiddle(s, 0, src);
    resolveAllChoices(s, eagerPick); // 行 0 → 翻 buried（若行1 无可翻则 rows 只剩 0）
    expect(buried.faceUp).toBe(true); // 翻正
    expect(s.players[0].stacks[0]).toHaveLength(2);
    expect(s.players[0].stacks[0][0].uid).toBe(buried.uid); // 仍被盖在下面
  });

  it('chaos-1 reorders BOTH players protocols (first action applies to self, then opponent)', () => {
    const s = setup();
    const src = makeCard('chaos-1', 0, 'field', true, 0, 0);
    s.players[0].stacks[0] = [src];
    resolveMiddle(s, 0, src);
    resolveAllChoices(s, eagerPick); // 自己 order 021 → 再对手 order 021
    expect(s.players[0].protocols.map((p) => p.defId)).toEqual(['fire', 'darkness', 'light']);
    expect(s.players[1].protocols.map((p) => p.defId)).toEqual(['fire', 'darkness', 'light']);
  });

  it('chaos-4 end discards all hand and draws the same count', () => {
    const s = setup();
    s.turnPlayer = 0;
    s.step = 'end';
    const src = makeCard('chaos-4', 0, 'field', true, 0, 0);
    s.players[0].stacks[0] = [src];
    s.players[0].hand = [makeCard('death-0', 0, 'hand'), makeCard('death-1', 0, 'hand')];
    s.players[0].deck = [makeCard('fire-5', 0, 'deck', false), makeCard('fire-4', 0, 'deck', false), makeCard('fire-3', 0, 'deck', false)];
    const trigs = collectTriggers(s, 'end');
    const t = trigs.find((x) => x.cardUid === src.uid);
    resolveTrigger(s, t!);
    runStack(s);
    expect(s.players[0].trash).toHaveLength(2);
    expect(s.players[0].hand).toHaveLength(2);
  });

  it('chaos-0 bottom start: both players draw top of opponent deck at turn START (txt 修改记录【4】end→start)', () => {
    const s = setup();
    s.turnPlayer = 0;
    s.step = 'start';
    const src = makeCard('chaos-0', 0, 'field', true, 0, 0);
    s.players[0].stacks[0] = [src];
    s.players[0].deck = [makeCard('fire-5', 0, 'deck', false)];
    s.players[1].deck = [makeCard('death-5', 1, 'deck', false)];
    const trigs = collectTriggers(s, 'start');
    const t = trigs.find((x) => x.cardUid === src.uid);
    expect(t).toBeTruthy(); // start 收 chaos-0 底指令（顶卡）
    resolveTrigger(s, t!);
    runStack(s);
    expect(s.players[0].hand).toHaveLength(1); // 自己从对手牌库抽
    expect(s.players[1].hand).toHaveLength(1); // 对手从自己牌库抽
    expect(s.players[0].deck).toHaveLength(0);
    expect(s.players[1].deck).toHaveLength(0);
  });
});

// ============ 明晰 clarity ============

describe('clarity effects', () => {
  it('clarity-0 adds own stack size to own line total (valueModifier)', () => {
    const s = setup();
    const c0 = makeCard('clarity-0', 0, 'field', true, 0, 0);
    const c5 = makeCard('fire-5', 0, 'field', true, 0, 1); // 值 5
    s.players[0].stacks[0] = [c0, c5];
    expect(stackValue(s, 0, 0)).toBe(7); // fire-5(5) + clarity-0(0) + 修正(自己堆叠 2 张) = 7
  });

  it('clarity-1 before-covered draws 3 when covered', () => {
    const s = setup();
    const c1 = makeCard('clarity-1', 0, 'field', true, 0, 0);
    s.players[0].stacks[0] = [c1];
    s.players[0].deck = [
      makeCard('death-0', 0, 'deck', false),
      makeCard('death-1', 0, 'deck', false),
      makeCard('death-2', 0, 'deck', false),
    ];
    const t = collectTriggerFor(s, c1, 'before-covered'); // clarity-1 顶卡将被盖
    expect(t).toBeTruthy();
    resolveTrigger(s, t!);
    runStack(s);
    expect(s.players[0].hand).toHaveLength(3); // 被盖前抽 3
  });

  it('clarity-2 reveals deck, draws a value-1 card, shuffles and plays it face-up', () => {
    const s = setup();
    const src = makeCard('clarity-2', 0, 'field', true, 0, 0);
    s.players[0].stacks[0] = [src];
    // deck 含 fire-1（值1，protocol fire → 可正面落线0）
    s.players[0].deck = [
      makeCard('death-5', 0, 'deck', false),
      makeCard('fire-1', 0, 'deck', false),
      makeCard('death-3', 0, 'deck', false),
    ];
    resolveMiddle(s, 0, src);
    // 自定义选择器：optional 的朝向选择也要选 face-up（pickFirst 会跳过 optional）
    resolveAllChoices(s, (prompt) => {
      if (prompt.kind === 'select-action' && prompt.optional && prompt.actions?.includes('action:face-up')) {
        return ['action:face-up'];
      }
      return pickFirst(prompt);
    });
    const top = s.players[0].stacks[0][s.players[0].stacks[0].length - 1];
    expect(top.defId).toBe('fire-1'); // 刚抽的那张被正面打出（线0 fire 匹配）
    expect(top.faceUp).toBe(true);
    expect(s.players[0].deck).toHaveLength(2);
  });

  it('clarity-4 optionally shuffles trash into deck', () => {
    const s = setup();
    const src = makeCard('clarity-4', 0, 'field', true, 0, 0);
    s.players[0].stacks[0] = [src];
    s.players[0].deck = [makeCard('death-0', 0, 'deck', false)];
    const t1 = makeCard('fire-1', 0, 'trash', true);
    const t2 = makeCard('fire-2', 0, 'trash', true);
    s.players[0].trash = [t1, t2];
    resolveMiddle(s, 0, src);
    resolveAllChoices(s, eagerPick); // action:shuffle（第一个）
    expect(s.players[0].trash).toHaveLength(0);
    expect(s.players[0].deck).toHaveLength(3);
    for (const c of s.players[0].deck) expect(c.faceUp).toBe(false);
  });
});

