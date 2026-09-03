import { describe, it, expect } from 'vitest';
import {
  createGame,
  getDraftPool,
  getCurrentDrafter,
  performDraftPick,
  performDraftBan,
  performDraftUnpick,
  canUnpick,
  draftNextAction,
  DRAFT_BAN_TOTAL,
} from '../../src/core/state/create';
import { DEMO_PROTOCOLS } from '../../src/data/demo';

/**
 * 禁用模式 / 随机池（2026-09-03 模式选择页）：
 * - 禁用模式（ban）：仍先掷硬币定先手；后手先禁 2 → 先手选 1 禁 1 → 后手选 2 禁 1 →
 *   先手选 2 禁 2 → 后手选 1（选 6 禁 6）。draftNextAction 由 (picks, bans) 派生。
 * - 随机池：draftPool 由调用方注入（UI 从全部协议随机抽 12）；草稿/禁用只在本池内。
 */
describe('禁用模式（ban draft）', () => {
  it('draftNextAction 按用户规则展开（starter=0：后手禁2 → 先手选1禁1 → 后手选2禁1 → 先手选2禁2 → 后手选1）', () => {
    const s = createGame({ draftMode: 'ban', draftStarter: 0 });
    const seq: string[] = [];
    // 每步按合法动作执行（ban 选池首、pick 选池首），记录动作
    const seen: Array<[string, number]> = [];
    for (let guard = 0; guard < 20; guard++) {
      const a = draftNextAction(s);
      if (!a) break;
      seen.push([a.kind, a.player]);
      const pool = getDraftPool(s);
      expect(pool.length).toBeGreaterThan(0);
      if (a.kind === 'ban') performDraftBan(s, pool[0].defId);
      else performDraftPick(s, pool[0].defId);
    }
    expect(seen).toEqual([
      ['ban', 1], ['ban', 1],
      ['pick', 0],
      ['ban', 0],
      ['pick', 1], ['pick', 1],
      ['ban', 1],
      ['pick', 0], ['pick', 0],
      ['ban', 0], ['ban', 0],
      ['pick', 1],
    ]);
    expect(draftNextAction(s)).toBeNull();
  });

  it('完整禁用草稿：选 6 禁 6，双方各 3 协议组牌，被禁者不可选', () => {
    const s = createGame({ draftMode: 'ban' });
    for (let guard = 0; guard < 20; guard++) {
      const a = draftNextAction(s);
      if (!a) break;
      const pool = getDraftPool(s);
      if (a.kind === 'ban') performDraftBan(s, pool[0].defId);
      else performDraftPick(s, pool[0].defId);
    }
    expect(s.phase).toBe('turn');
    expect(s.draftPicks).toHaveLength(6);
    expect(s.bannedProtocols).toHaveLength(DRAFT_BAN_TOTAL);
    expect(s.players[0].protocols).toHaveLength(3);
    expect(s.players[1].protocols).toHaveLength(3);
    // 被禁协议不在任何玩家协议中
    const chosen = new Set(s.draftPicks.map((p) => p.defId));
    for (const banned of s.bannedProtocols) expect(chosen.has(banned)).toBe(false);
    // 池内剩余 = 30 - 12
    expect(getDraftPool(s)).toHaveLength(DEMO_PROTOCOLS.length - 12);
  });

  it('守卫：ban 步骤之外不可选协议；非 ban 步骤不可禁用', () => {
    const s = createGame({ draftMode: 'ban' });
    // 首个动作 = 后手禁 2 → pick 应被拒
    expect(() => performDraftPick(s, getDraftPool(s)[0].defId)).toThrow(/not a pick step/);
    // 正常模式禁用应被拒
    const n = createGame();
    expect(() => performDraftBan(n, n.draftPool[0].defId)).toThrow(/no ban step pending/);
  });

  it('负例：重复/已禁协议禁用被拒；ban 中段 pick 被拒', () => {
    const s = createGame({ draftMode: 'ban' });
    const pool0 = getDraftPool(s).map((p) => p.defId);
    performDraftBan(s, pool0[0]); // 后手第一个禁用
    expect(() => performDraftBan(s, pool0[0])).toThrow(/not available/); // 重复禁用
    expect(() => performDraftPick(s, pool0[1])).toThrow(/not a pick step/); // ban 中段禁选
    expect(s.bannedProtocols).toHaveLength(1);
    expect(getDraftPool(s).some((p) => p.defId === pool0[0])).toBe(false);
  });

  it('禁用后不可再选/再禁该协议；随机池 + 禁用组合在 12 套池内完成', () => {
    const pool12 = DEMO_PROTOCOLS.slice(0, 12);
    const s = createGame({ draftMode: 'ban', draftPool: pool12 });
    for (let guard = 0; guard < 20; guard++) {
      const a = draftNextAction(s);
      if (!a) break;
      const pool = getDraftPool(s);
      expect(pool.length).toBeGreaterThan(0);
      if (a.kind === 'ban') performDraftBan(s, pool[0].defId);
      else performDraftPick(s, pool[0].defId);
    }
    expect(s.phase).toBe('turn');
    // 12 套 = 6 选 + 6 禁，全部消耗
    expect(getDraftPool(s)).toHaveLength(0);
  });
});

describe('随机池模式（draftPool 注入）', () => {
  it('普通模式 + 12 套池：正常完成 6 选且池内可选', () => {
    const pool12 = DEMO_PROTOCOLS.slice(0, 12);
    const s = createGame({ draftPool: pool12 });
    expect(getDraftPool(s)).toHaveLength(12);
    for (let i = 0; i < 6; i++) {
      performDraftPick(s, getDraftPool(s)[0].defId);
    }
    expect(s.phase).toBe('turn');
    expect(getDraftPool(s)).toHaveLength(6);
  });

  it('默认池 = 两代全部 30 套（向后兼容）', () => {
    const s = createGame();
    expect(s.draftPool).toHaveLength(30);
    expect(getDraftPool(s)).toHaveLength(30);
  });

  it('禁用模式下 canUnpick 语义不变（同玩家连续双选内可取消）', () => {
    const s = createGame({ draftMode: 'ban' });
    const act = (): { kind: string; player: number } | null => draftNextAction(s);
    // 前两步：后手禁 2（取池首两个不同协议）
    const pool0 = getDraftPool(s).map((p) => p.defId);
    performDraftBan(s, pool0[0]);
    performDraftBan(s, pool0[1]);
    // 先手选 1
    const pool1 = getDraftPool(s).map((p) => p.defId);
    performDraftPick(s, pool1[0]);
    const pickedFirst = s.draftPicks[0].defId;
    // 先手禁 1
    performDraftBan(s, getDraftPool(s)[0].defId);
    // 后手双选：第一张后可取消；第二张完成后双选回合结束（不可再取消首张）
    expect(act()?.kind).toBe('pick');
    const p2 = getDraftPool(s).map((p) => p.defId);
    performDraftPick(s, p2[0]);
    expect(canUnpick(s, s.draftPicks[1].defId)).toBe(true); // 后手第一张（双选回合内）
    performDraftUnpick(s, s.draftPicks[1].defId); // 取消 → 回退 draftRound
    expect(act()?.kind).toBe('pick');
    expect(getCurrentDrafter(s)).toBe(1);
    performDraftPick(s, p2[0]); // 重选后手第一张
    performDraftPick(s, p2[1]); // 后手第二张（双选回合完成）
    expect(canUnpick(s, s.draftPicks[1].defId)).toBe(false); // 回合结束不可取消
    // 首轮（先手）已选始终不可取消
    expect(canUnpick(s, pickedFirst)).toBe(false);
  });
});
