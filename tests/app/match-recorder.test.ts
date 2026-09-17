import { describe, it, expect } from 'vitest';
import {
  MATCH_FILE_VERSION,
  createMatchFileRecorder,
  matchFileFingerprint,
  matchFileToCreateOptions,
  parseMatchFile,
  setupFromState,
  stringifyMatchFile,
  type ActionRecord,
  type MatchFileMeta,
} from '../../src/app/match-file';
import { createGame, getDraftPool, performDraftPick } from '../../src/core/state/create';
import { executeAction, getLegalActions } from '../../src/core/game';
import { applyRecordedAction, stateAfterDraft } from '../../src/app/match-replay';
import { resetControlIfHeld } from '../../src/core/rules/control';
import { stateFingerprint } from '../../src/core/fingerprint';
import type { GameState, Line, PlayerId } from '../../src/core/models/types';
import { pickFirst, resolveAllChoices } from '../helpers';
import { CARD_DATA_HASH } from '../../src/app/card-data-hash';

const meta: MatchFileMeta = {
  seed: 's',
  setup: {
    draftMode: 'normal',
    draftStarter: 0,
    firstToPlay: 1,
    draftPool: ['water'],
    draftPicks: ['water'],
    bannedProtocols: [],
  },
  players: [{ nick: '甲' }, { nick: '乙' }],
  cardDataHash: CARD_DATA_HASH,
  createdAt: '2026-09-16T00:00:00.000Z',
};

describe('MatchFileRecorder', () => {
  it('seq 从 0 起单调递增，且与数组下标一致', () => {
    const r = createMatchFileRecorder();
    r.record({ player: 0, kind: 'advance', via: 'user' });
    r.record({ player: 1, kind: 'refresh', via: 'user' });
    expect(r.actions().map((a) => a.seq)).toEqual([0, 1]);
    expect(r.nextSeq()).toBe(2);
  });

  it('旁路操作进 noted()，绝不进 actions()', () => {
    const r = createMatchFileRecorder();
    r.note({ player: 0, kind: 'play', args: { cardUid: 'dev-added', faceUp: true, line: 0 }, via: 'user' });
    r.record({ player: 0, kind: 'advance', via: 'user' });
    expect(r.actions().length).toBe(1);
    expect(r.noted().length).toBe(1);
    expect(r.toMatchFile(meta).actions.length).toBe(1);
  });

  it('toMatchFile 产出的档案能被 parseMatchFile 原样读回（往返闭合）', () => {
    const r = createMatchFileRecorder();
    r.record({ player: 0, kind: 'advance', via: 'user' });
    const f = r.toMatchFile(meta);
    const back = parseMatchFile(JSON.stringify(f), { currentHash: CARD_DATA_HASH });
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(back.file.actions).toEqual(f.actions);
  });

  it('记录器产出的 seq 链恒为 0..n-1：解析方向的 §3.1 连续性判据不会误伤真实档案', () => {
    // 这条腿把「记录器」与「解析校验」两端钉在一起：`checkAction` 要求 `seq === 下标`
    // （§3.1「从 0 起单调递增」），若哪天记录器改成别的编号方式，**这里先红**，
    // 而不是等到用户导入一份"自己刚导出的档案"时才发现被拒。
    const r = createMatchFileRecorder();
    for (let i = 0; i < 8; i += 1) r.record({ player: (i % 2) as PlayerId, kind: 'advance', via: 'user' });
    const f = r.toMatchFile(meta);
    expect(f.actions.map((a) => a.seq)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    const back = parseMatchFile(stringifyMatchFile(f), { currentHash: CARD_DATA_HASH });
    expect(back.ok, '自己导出的档案必须能被自己读入').toBe(true);
    if (!back.ok) return;
    expect(back.warnings).toEqual([]);
    expect(back.file.actions.map((a) => a.seq)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it('clear() 之后 seq 从 0 重新开始（新的一局 = 新的档案）', () => {
    const r = createMatchFileRecorder();
    r.record({ player: 0, kind: 'advance' });
    r.clear();
    expect(r.actions()).toEqual([]);
    expect(r.nextSeq()).toBe(0);
  });

  it('迁移链与版本号同步：把 version 改成「当前+1」的档案必须被拒（不猜测）', () => {
    const r = createMatchFileRecorder();
    const f = r.toMatchFile(meta);
    const future = JSON.stringify({ ...f, version: MATCH_FILE_VERSION + 1 });
    const back = parseMatchFile(future, { currentHash: CARD_DATA_HASH });
    expect(back.ok).toBe(false);
    if (back.ok) return;
    expect(back.error.code).toBe('too-new');
  });

  it('clear() 也清掉旁路留痕（否则"为什么复现不出来"会串到新一局）', () => {
    const r = createMatchFileRecorder();
    r.note({ player: 1, kind: 'advance' });
    r.record({ player: 0, kind: 'advance' });
    r.clear();
    expect(r.noted()).toEqual([]);
    // 反空转：clear 之后记录器仍可用且从 0 重新计数（不是把它清成了死对象）
    r.record({ player: 0, kind: 'advance' });
    expect(r.actions()).toEqual([{ seq: 0, player: 0, kind: 'advance' }]);
  });

  it('actions()/noted() 返回快照：外部改动不会污染记录器内部', () => {
    const r = createMatchFileRecorder();
    r.record({ player: 0, kind: 'play', args: { cardUid: 'c1', faceUp: true, line: 0 } });
    const snap = r.actions() as ActionRecord[];
    snap.push({ seq: 99, player: 1, kind: 'advance' });
    snap[0].kind = 'refresh';
    (snap[0].args as { cardUid: string }).cardUid = '被篡改';
    expect(r.actions()).toEqual([{ seq: 0, player: 0, kind: 'play', args: { cardUid: 'c1', faceUp: true, line: 0 } }]);
    expect(r.nextSeq()).toBe(1);

    // 反向：toMatchFile 产出的档案同样不与记录器共享 args 引用
    const f = r.toMatchFile(meta);
    (f.actions[0].args as { cardUid: string }).cardUid = '又被篡改';
    expect((r.actions()[0].args as { cardUid: string }).cardUid).toBe('c1');
  });

  it('toMatchFile 闭卷：之后 record 不会改到已产出的档案', () => {
    const r = createMatchFileRecorder();
    r.record({ player: 0, kind: 'advance' });
    const f = r.toMatchFile(meta);
    r.record({ player: 1, kind: 'refresh' });
    expect(f.actions).toHaveLength(1);
    expect(r.toMatchFile(meta).actions).toHaveLength(2);
  });

  it('toMatchFile 逐项照录 meta（result / cardDataHash / createdAt / setup 顺序快照）', () => {
    const r = createMatchFileRecorder();
    r.record({ player: 0, kind: 'advance', via: 'user' });
    const f = r.toMatchFile({ ...meta, result: { winner: null, reason: '流局' } });
    expect(f.format).toBe('compile-match');
    expect(f.version).toBe(MATCH_FILE_VERSION);
    expect(f.seed).toBe('s');
    expect(f.cardDataHash).toBe(CARD_DATA_HASH);
    expect(f.createdAt).toBe(meta.createdAt);
    expect(f.setup.draftPicks).toEqual(['water']);
    expect(f.setup.bannedProtocols).toEqual([]);
    expect(f.result).toEqual({ winner: null, reason: '流局' });
    // 未传 result → 档案里就没有这个键（不是 `result: undefined` 的假键）
    expect('result' in r.toMatchFile(meta)).toBe(false);
  });

  it('指纹不看 createdAt，但看 actions：同一局两次导出同指纹，多一步则不同指纹', () => {
    const r = createMatchFileRecorder();
    r.record({ player: 0, kind: 'advance', via: 'user' });
    const a = r.toMatchFile(meta);
    const b = r.toMatchFile({ ...meta, createdAt: '2031-12-31T23:59:59.000Z' });
    expect(matchFileFingerprint(a)).toBe(matchFileFingerprint(b));
    r.record({ player: 1, kind: 'refresh', via: 'user' });
    expect(matchFileFingerprint(r.toMatchFile(meta))).not.toBe(matchFileFingerprint(a));
  });
});

/**
 * 行为腿：**真跑一局**，把引擎每一步的实际行动原样喂给记录器，再拿档案重开一局
 * 逐条重放 —— 指纹必须一致（这就是验收判据 1「往返/重放后状态指纹一致」）。
 *
 * 关键点：`play` 的 `args.cardUid` 用的是引擎自己发的 uid（`c${nextUid}`），
 * 记录器只是**照录**；重放时同一个种子会发同一批 uid，链条才闭合。
 */
function nextTurnPlayer(s: GameState): PlayerId {
  const cur = s.turnPlayer;
  return getLegalActions(s, cur).length > 0 ? cur : ((1 - cur) as PlayerId);
}

/** 用固定启发式跑若干步真实对局，同时记录每一步实际下发的行动（含 via） */
function playAndRecord(seed: string, maxSteps: number): { s: GameState; rec: ReturnType<typeof createMatchFileRecorder> } {
  const s = createGame({ seed });
  const rec = createMatchFileRecorder();

  // 草稿：按池顺序选（确定性）
  let guard = 0;
  while (s.phase === 'draft' && guard++ < 200) {
    const avail = getDraftPool(s);
    if (avail.length === 0) break;
    performDraftPick(s, avail[0].defId);
  }

  for (let step = 0; step < maxSteps; step += 1) {
    if (s.phase !== 'turn' || s.winner !== null) break;
    if (s.pendingEffects.length > 0) {
      const top = s.pendingEffects[s.pendingEffects.length - 1];
      if (!top.prompt) {
        resolveAllChoices(s, pickFirst);
        continue;
      }
      const choice = pickFirst(top.prompt);
      // ⚠️ `effect-choice` 的**执行者**必须取 `prompt.chooser`（缺省 = 效果属主 = `top.player`），
      // 与 `main.ts:307-314` 的现场判定逐字一致：
      // 旧写法硬编码 `1 - s.turnPlayer`，在被作用卡持有者（chooser）不是"另一个玩家"时
      // 会与重放（按档案记的 player 调 `executeAction`）走**不同的 chooser** ⇒ 两条路从这一步起
      // 静默分叉（本仓实测：分歧在 `log` 长度 24 处现形，但它不是根因）。
      const chooser = (top.prompt.chooser ?? top.player) as PlayerId;
      rec.record({
        player: chooser,
        kind: 'effect-choice',
        args: { promptId: top.id, choice },
        via: 'user',
      });
      executeAction(s, chooser, 'effect-choice', { promptId: top.id, choice });
      resolveAllChoices(s, pickFirst);
      continue;
    }
    const player = nextTurnPlayer(s);
    const actions = getLegalActions(s, player);
    if (actions.length === 0) break;
    const a = actions[0];
    const args: Record<string, unknown> = {};
    if (a.cardUid !== undefined) args.cardUid = a.cardUid;
    if (a.faceUp !== undefined) args.faceUp = a.faceUp;
    if (a.line !== undefined) args.line = a.line;
    if (a.target !== undefined) args.target = a.target;
    if (a.promptId !== undefined) args.promptId = a.promptId;
    if (a.choice !== undefined) args.choice = a.choice;
    const hasArgs = Object.keys(args).length > 0;
    rec.record({ player, kind: a.kind, ...(hasArgs ? { args } : {}), via: 'user' });
    // ⚠️ **现场侧必须复现 UI 那次"开重排模态前的归还"**（`main.ts:265-303`）：
    // 收口后的生产驱动（`src/app/match-replay.ts` 的 `applyRecordedAction`）在把
    // `rearrange-protocols` / `compile` / `refresh` 交给引擎之前会先
    // `if (s.control === player) resetControlIfHeld(s, player)`。
    // 本腿的"现场"若不做同一件事，比的就不是生产语义：本仓实测 turn 9/10/15 上真的存在
    // "持控制组件时编译/补满"的步骤（control=0 而行动者是 1），重放会多出一条归还 log ⇒ 指纹不等。
    // **条件必须与生产逐字一致（`=== player`）**：用"任意持有者都归还"会在
    // "对手持控制组件时我编译"的步骤上多推一条 log（实测首处分歧就在那一步）。
    if ((a.kind === 'compile' || a.kind === 'refresh' || a.kind === 'rearrange-protocols') && s.control === player) {
      resetControlIfHeld(s, player);
    }
    switch (a.kind) {
      case 'play':
        executeAction(s, player, 'play', args as unknown as { cardUid: string; faceUp: boolean; line: Line });
        break;
      case 'compile':
        executeAction(s, player, 'compile', args as unknown as { line: Line });
        break;
      case 'resolve-trigger':
        executeAction(s, player, 'resolve-trigger', args as unknown as { cardUid: string });
        break;
      case 'effect-choice':
        executeAction(s, player, 'effect-choice', args as unknown as { promptId: string; choice: string[] });
        break;
      case 'rearrange-protocols':
        executeAction(s, player, 'rearrange-protocols', args as unknown as { target: PlayerId; a: Line; b: Line });
        break;
      default:
        executeAction(s, player, a.kind);
        break;
    }
    resolveAllChoices(s, pickFirst);
  }
  return { s, rec };
}

/**
 * 重放一份档案：**草稿从 `setup` 的两条序列真重建**（`stateAfterDraft`），
 * 再逐条走**生产助手** `applyRecordedAction`。
 *
 * ⚠️ 这里曾经抄了一份与生产同形的 `switch (a.kind)` 副本（G3 的写法），
 * 而且草稿是**硬编码策略重选**（`getDraftPool(s)[0]`）—— 那证明的是"同一套策略能算出同一结果"，
 * **不是**"档案能重放"。G4 T1 把它收口到 `src/app/match-replay.ts`：
 * 全仓只有一份"一条档案操作 → 一次引擎调用"的映射。
 */
function replay(file: Parameters<typeof matchFileToCreateOptions>[0]): GameState {
  const s = stateAfterDraft(file);
  for (const a of file.actions) {
    applyRecordedAction(s, a);
    resolveAllChoices(s, pickFirst);
  }
  return s;
}

describe('MatchFileRecorder × 真实引擎：往返与重放', () => {
  it('真跑一局：档案 → matchFileToCreateOptions → 逐条重放，状态指纹与原局一致', () => {
    const { s, rec } = playAndRecord('g3-recorder-seed', 120);
    // 反空转：这一局必须真的走了若干步，否则"指纹一致"是在比两个空局
    expect(rec.actions().length).toBeGreaterThan(20);
    expect(s.phase).toBe('turn');

    const file = rec.toMatchFile({
      ...meta,
      seed: 'g3-recorder-seed',
      setup: setupFromState(s),
    });
    // 档案必须自己是合法档案（重放之前先过校验门）
    const parsed = parseMatchFile(stringifyMatchFile(file), { currentHash: CARD_DATA_HASH });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const replayed = replay(parsed.file);
    expect(stateFingerprint(replayed)).toBe(stateFingerprint(s));
  });

  it('档案同时是"重连凭据"：重放出的状态与原局指纹相同，且操作序列逐条等价', () => {
    const { s, rec } = playAndRecord('g3-recorder-seed-2', 60);
    const file = rec.toMatchFile({ ...meta, seed: 'g3-recorder-seed-2', setup: setupFromState(s) });
    const replayed = replay(file);
    expect(stateFingerprint(replayed)).toBe(stateFingerprint(s));
    // 操作的 args 逐条等价（不是"只有长度相同"）
    expect(file.actions.map((a) => [a.seq, a.player, a.kind])).toEqual(
      rec.actions().map((a) => [a.seq, a.player, a.kind]),
    );
  });

  it('play 的 cardUid 与引擎发的 uid 同源（c 前缀 + nextUid），记录器只是照录', () => {
    const { s, rec } = playAndRecord('g3-recorder-seed-3', 120);
    const plays = rec.actions().filter((a) => a.kind === 'play');
    expect(plays.length).toBeGreaterThan(0);
    for (const p of plays) {
      const uid = (p.args as { cardUid: string }).cardUid;
      expect(typeof uid).toBe('string');
      expect(uid.length).toBeGreaterThan(0);
    }
    // 引擎的 uid 计数器随对局推进，必然大于初始值 1
    expect(s.nextUid).toBeGreaterThan(1);
  });

  it('把档案抄成"被篡改的一步"后重放会抛错（引擎自带非法操作守卫，不静默走偏）', () => {
    const { s, rec } = playAndRecord('g3-recorder-seed-4', 40);
    const file = rec.toMatchFile({ ...meta, seed: 'g3-recorder-seed-4', setup: setupFromState(s) });
    const pick = file.actions.findIndex((a) => a.kind === 'play');
    expect(pick).toBeGreaterThanOrEqual(0);
    const tampered = JSON.parse(JSON.stringify(file)) as typeof file;
    (tampered.actions[pick].args as { cardUid: string }).cardUid = 'c999999';
    expect(() => replay(tampered)).toThrow();
  });
});
