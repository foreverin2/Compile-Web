import { describe, it, expect, vi, afterEach } from 'vitest';
import type { GameState, Line, PlayerId } from '../../src/core/models/types';
import { createGame } from '../../src/core/state/create';
import { resolveMiddle, answerEffect } from '../../src/core/effects/resolve';
import { makeCard, resolveAllChoices, pickFirst } from '../helpers';

/** 修改提示词 24/25：时间0 弃牌堆选牌可正常进行；时间3 揭示幽灵给对方 + 被揭示牌解锁翻面查看。 */

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

afterEach(() => {
  vi.restoreAllMocks();
});

describe('修改提示词 B3d（时间0/时间3）', () => {
  it('时间0：从弃牌堆选卡反面打出，剩余弃牌堆洗入牌库', () => {
    const s = setup();
    // 源卡放线 2：反面打出的 eager 首线是 0 —— 若源卡在线 0 会被自己打出的牌覆盖 →
    // sourceValid 终止生成器（引擎已知限制：自盖中断后续句）→ 「洗入」句丢失。
    const src = placeSrc(s, 'time-0', 0, 2);
    const t1 = makeCard('fire-1', 0, 'trash', true);
    const t2 = makeCard('light-2', 0, 'trash', true);
    s.players[0].trash = [t1, t2];
    resolveMiddle(s, 0, src);
    let top = s.pendingEffects[s.pendingEffects.length - 1];
    expect(top?.prompt?.kind).toBe('select'); // 弃牌堆选牌弹出（修复「无法选牌」）
    expect(top?.prompt?.candidates?.map((c) => c.uid)).toEqual([t1.uid, t2.uid]);
    answerEffect(s, top.id, [t2.uid]);
    top = s.pendingEffects[s.pendingEffects.length - 1];
    expect(top?.prompt?.kind).toBe('select-action'); // 朝向
    answerEffect(s, top.id, ['action:face-down']); // 反面打出（无中段干扰，聚焦 选牌→打出→洗入 流程）
    resolveAllChoices(s, pickFirst); // 任意线（eager 首线 = 线 0，不覆盖线 2 的源卡）
    // 打出的卡进入线 0 堆叠（faceDown）；剩余 t1 洗入牌库
    const onField = s.players[0].stacks.some((st) => st.some((c) => c.uid === t2.uid));
    expect(onField).toBe(true);
    expect(s.players[0].trash.some((c) => c.uid === t2.uid)).toBe(false);
    expect(s.players[0].deck.some((c) => c.uid === t1.uid)).toBe(true); // 剩余洗入
  });

  it('时间3：揭示的幽灵给对方查看，被揭示牌打出后解除 secret（可翻面查看）', () => {
    const s = setup();
    const src = placeSrc(s, 'time-3', 0, 0);
    const t1 = makeCard('fire-3', 0, 'trash', true);
    s.players[0].trash = [t1];
    vi.spyOn(Math, 'random').mockReturnValue(0); // 随机取第 1 张
    resolveMiddle(s, 0, src);
    // 幽灵已加入对方手牌区查看（Case A：shownTo = 对手）
    expect(s.revealedGhosts.some((g) => g.defId === 'fire-3' && g.shownTo === 1)).toBe(true);
    const top = s.pendingEffects[s.pendingEffects.length - 1];
    expect(top?.prompt?.kind).toBe('select-line'); // 落其它线
    answerEffect(s, top.id, ['line:1']);
    resolveAllChoices(s, pickFirst);
    // 被揭示牌反面打出到线 1（自己堆叠），secret 已解除
    const placed = s.players[0].stacks[1].find((c) => c.uid === t1.uid);
    expect(placed).toBeTruthy();
    expect(placed!.faceUp).toBe(false);
    expect(placed!.secret).toBe(false); // 揭示后解锁：双击可翻面查看
  });
});



