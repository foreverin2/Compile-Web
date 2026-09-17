/**
 * T1 行为腿：`src/app/match-replay.ts`（G4 计划 §5 T1 的 7 条验收判据）。
 *
 * **全部是行为腿**：真跑引擎、比 `stateFingerprint`。本文件**不读 `src` 源码找字符串**
 * （唯一例外是判据 5 从 `src/core/game.ts` 的 `ActionKind` union **派生**取值清单 ——
 * 那是"生成式清单 > 手写清单"的落地，不是为了证明某个字符串存在）。
 *
 * 本文件的每条腿都必须在隔离镜像里被 M1-M4 打红（见任务报告的变异实测表）。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  createMatchFileRecorder,
  setupFromState,
  type ActionRecord,
  type MatchFile,
  type MatchFileSetup,
} from '../../src/app/match-file';
import { applyRecordedAction, replayDraftFromSetup, stateAfterDraft } from '../../src/app/match-replay';
import { CARD_DATA_HASH } from '../../src/app/card-data-hash';
import { DEMO_PROTOCOLS } from '../../src/data/demo';
import {
  canUnpick,
  createGame,
  draftNextAction,
  getDraftPool,
  performDraftBan,
  performDraftPick,
  performDraftUnpick,
} from '../../src/core/state/create';
import { executeAction, getLegalActions, type ActionKind } from '../../src/core/game';
import { getCompilableLines } from '../../src/core/rules/compile';
import { resetControlIfHeld } from '../../src/core/rules/control';
import { stateFingerprint } from '../../src/core/fingerprint';
import type { Card, GameState, Line, PlayerId } from '../../src/core/models/types';
import { makeCard, pickFirst, resolveAllChoices } from '../helpers';

/* ------------------------------------------------------------------ *
 * 助手
 * ------------------------------------------------------------------ */

/** 种子派生的小整数（纯、确定性；**不用 Math.random** —— 那是 src/app 的禁项，测试也保持同风格） */
function deriveIndex(seed: string, tag: string, n: number): number {
  let h = 0x811c9dc5;
  const text = `${seed}|${tag}`;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return n > 0 ? h % n : 0;
}

/**
 * 判据 1/2 的**非平凡**选牌策略：索引由种子 + (kind, 序号) 派生 ⇒ 既不恒取 `avail[0]`
 * （那正是要区分的"重选"形态），也不依赖调用历史。
 */
function nontrivialStrategy(seed: string, avail: string[], tag: string): string {
  return avail[deriveIndex(seed, tag, avail.length)];
}

/** 按 `draftNextAction` 的 kind 分流，用非平凡策略走完草稿并记录两条序列 */
function draftNontrivial(s: GameState, seed: string): { picks: string[]; bans: string[] } {
  const picks: string[] = [];
  const bans: string[] = [];
  let guard = 0;
  for (;;) {
    const next = draftNextAction(s);
    if (!next) break;
    if (guard++ > 200) throw new Error('草稿没有收敛');
    const avail = getDraftPool(s).map((p) => p.defId);
    expect(avail.length, `草稿第 ${picks.length + bans.length} 步没有可选协议`).toBeGreaterThan(0);
    const defId = nontrivialStrategy(seed, avail, `${next.kind}:${picks.length + bans.length}`);
    if (next.kind === 'pick') {
      performDraftPick(s, defId);
      picks.push(defId);
    } else {
      performDraftBan(s, defId);
      bans.push(defId);
    }
  }
  return { picks, bans };
}

function metaFor(seed: string, setup: MatchFileSetup) {
  return {
    seed,
    setup,
    players: [{ nick: '甲' }, { nick: '乙' }] as [{ nick: string }, { nick: string }],
    cardDataHash: CARD_DATA_HASH,
    createdAt: '2026-09-17T00:00:00.000Z',
  };
}

/** 现场：草稿用非平凡策略走完，再按固定启发式（池首可选动作）走 `maxSteps` 步真实对局 */
function playArchive(seed: string, opts: { draftMode: 'normal' | 'ban'; maxSteps: number }) {
  const s = createGame({ seed, draftMode: opts.draftMode });
  const draft = draftNontrivial(s, seed);
  const rec = createMatchFileRecorder();
  expect(s.phase).toBe('turn');

  for (let step = 0; step < opts.maxSteps; step += 1) {
    if (s.phase !== 'turn' || s.winner !== null) break;
    if (s.pendingEffects.length > 0) {
      const top = s.pendingEffects[s.pendingEffects.length - 1];
      if (!top.prompt) {
        resolveAllChoices(s, pickFirst);
        continue;
      }
      const choice = pickFirst(top.prompt);
      const chooser = (top.prompt.chooser ?? top.player ?? s.turnPlayer) as PlayerId;
      rec.record({ player: chooser, kind: 'effect-choice', args: { promptId: top.id, choice }, via: 'user' });
      applyRecordedAction(s, { seq: rec.nextSeq() - 1, player: chooser, kind: 'effect-choice', args: { promptId: top.id, choice } });
      resolveAllChoices(s, pickFirst);
      continue;
    }
    const player = s.turnPlayer;
    const acts = getLegalActions(s, player);
    if (acts.length === 0) break;
    const a = acts[0];
    const args: Record<string, unknown> = {};
    if (a.cardUid !== undefined) args.cardUid = a.cardUid;
    if (a.faceUp !== undefined) args.faceUp = a.faceUp;
    if (a.line !== undefined) args.line = a.line;
    if (a.target !== undefined) args.target = a.target;
    if (a.promptId !== undefined) args.promptId = a.promptId;
    if (a.choice !== undefined) args.choice = a.choice;
    const hasArgs = Object.keys(args).length > 0;
    rec.record({ player, kind: a.kind, ...(hasArgs ? { args } : {}), via: 'user' });
    applyRecordedAction(s, { seq: rec.nextSeq() - 1, player, kind: a.kind, ...(hasArgs ? { args } : {}) });
    resolveAllChoices(s, pickFirst);
  }
  return { s, rec, draft };
}

/** 重放：整局（createGame + 草稿 + 逐条 applyRecordedAction）。
 *  每步之后排空挂起选择 —— 现场 `main.ts` 的编排在每步终止点也会做这件事，
 *  不排空的话 `executeAction` 的 `pendingEffects` 守卫会把下一条动作拦下
 *  （`game.ts:126`）。 */
function fullReplay(f: MatchFile): GameState {
  const s = stateAfterDraft(f);
  for (const a of f.actions) {
    applyRecordedAction(s, a);
    resolveAllChoices(s, pickFirst);
  }
  return s;
}

/** 把 `log` 之后的字段全部保留、只把 log 置空后取指纹（**仅用于定位差异来源**，见判据 4 / D5） */
function fingerprintIgnoringLog(s: GameState): string {
  return stateFingerprint({ ...s, log: [] });
}

/**
 * 构造一个"真的挂起选择"的现场（判据 5 的 `effect-choice` 腿需要它）。
 *
 * 为什么不能用真实起始手牌去"试打"：**反面打出的卡不结算中指令**（`completePlay` 只对正面卡
 * 跑 `resolveMiddle`）⇒ 反面扫描一张也找不到挂起的 prompt（本腿第一版就栽在这）。
 * 这里改成写死一条**已知会挂起必选选择**的路径：`fire-5` 的中指令是"弃1张牌"
 * （`src/core/effects/cards/fire.ts:63`，`min:1,max:1,optional:false`，候选 = 手牌）
 * ⇒ 正面打入 fire 线后必然挂起一个 select。
 */
function stateWithSuspendedPrompt(): {
  s: GameState;
  promptId: string;
  chooser: PlayerId;
  choice: string[];
} {
  const s = createGame({ seed: 't1-kind-effect-choice' });
  while (s.phase === 'draft') performDraftPick(s, getDraftPool(s)[0].defId);
  const player = s.turnPlayer;
  // 保证 fire 在行动玩家线 0（否则 fire-5 无法正面打入）
  s.players[player].protocols[0] = { defId: 'fire', compiled: false };
  s.players[player].hand = [
    makeCard('fire-5', player, 'hand', true, null),
    ...s.players[player].hand.slice(0, 2),
  ];
  executeAction(s, player, 'play', { cardUid: s.players[player].hand[0].uid, faceUp: true, line: 0 });
  const top = s.pendingEffects[s.pendingEffects.length - 1];
  expect(top?.prompt, 'fire-5 正面打入后必须挂起选择').toBeTruthy();
  // 反空转：候选不能为空（否则"应答"没有可选项，这条腿就没有真的走完一次应答）
  expect(top.prompt!.candidates.length).toBeGreaterThan(0);
  const chooser = (top.prompt!.chooser ?? top.player) as PlayerId;
  return { s, promptId: top.id, chooser, choice: pickFirst(top.prompt!) };
}

/* ------------------------------------------------------------------ *
 * 判据 1 / 2：草稿真重放（normal + ban）
 * ------------------------------------------------------------------ */

describe('T1 判据 1/2：草稿从档案序列真重放（normal / ban，非平凡策略）', () => {
  it('判据 1（normal）：非平凡选牌策略下"现场 → 档案 → 重放"指纹相等，且**不同于"按策略重选"**', () => {
    const seed = 'g4t1-draft-normal';
    const { s, rec, draft } = playArchive(seed, { draftMode: 'normal', maxSteps: 120 });

    // 反空转：这一局的草稿必须真的选满了 6 个，而且这一局必须真的走了若干步
    expect(draft.picks).toHaveLength(6);
    expect(draft.bans).toEqual([]);
    expect(rec.actions().length).toBeGreaterThan(20);
    // 非平凡策略的正控：它**不是**"总取池里第一个"（否则判据 1 区分不出"重选"）
    const trivialWouldBe = getDraftPool(createGame({ seed, draftMode: 'normal' })).slice(0, 6).map((p) => p.defId);
    expect(draft.picks).not.toEqual(trivialWouldBe);

    const file = rec.toMatchFile(metaFor(seed, setupFromState(s)));
    expect(file.setup.draftPicks).toEqual(draft.picks);

    // ① 消费档案序列 ⇒ 指纹与原件相等
    const replayed = fullReplay(file);
    expect(stateFingerprint(replayed)).toBe(stateFingerprint(s));
    expect(replayed.phase).toBe(s.phase);

    // ② 负控：换成"按同一个非平凡策略重新选一遍"（= G3 那份 replay() 的形态）⇒ 指纹必须不同。
    //    这一条是判据 1 判别力的来源：它证明上面那条相等**不是**"两条路都重选"。
    const s2 = createGame({ seed, draftMode: 'normal' });
    draftNontrivial(s2, seed);
    expect(s2.draftPicks.map((p) => p.defId)).toEqual(s.draftPicks.map((p) => p.defId));
    // 但"重选"的判别力必须体现在**非平凡**策略上：把它换成恒定取池首 ⇒ 序列不同
    const s3 = createGame({ seed, draftMode: 'normal' });
    while (s3.phase === 'draft') performDraftPick(s3, getDraftPool(s3)[0].defId);
    expect(s3.draftPicks.map((p) => p.defId)).not.toEqual(s.draftPicks.map((p) => p.defId));
  });

  it('判据 2（ban）：6 禁 + 6 选交错，按 draftNextAction 的 kind 从两条序列分别取 ⇒ 指纹相等', () => {
    const seed = 'g4t1-draft-ban';
    const { s, rec, draft } = playArchive(seed, { draftMode: 'ban', maxSteps: 120 });

    // 反空转：ban 模式必须真的产生 6 禁 + 6 选（否则"交错分流"没被走到）
    expect(draft.picks).toHaveLength(6);
    expect(draft.bans).toHaveLength(6);
    expect(new Set([...draft.picks, ...draft.bans]).size).toBe(12);
    expect(rec.actions().length).toBeGreaterThan(10);

    const file = rec.toMatchFile(metaFor(seed, setupFromState(s)));
    expect(file.setup.draftMode).toBe('ban');
    expect(file.setup.bannedProtocols).toEqual(draft.bans);

    const replayed = fullReplay(file);
    expect(stateFingerprint(replayed)).toBe(stateFingerprint(s));
    // 逐项反空转：草稿本体（协议线位 + 禁用名单）必须真的重建出来，不是"两边都空"
    expect(replayed.bannedProtocols).toEqual(s.bannedProtocols);
    expect(replayed.players[0].protocols.map((p) => p.defId)).toEqual(s.players[0].protocols.map((p) => p.defId));
    expect(replayed.players[1].protocols.map((p) => p.defId)).toEqual(s.players[1].protocols.map((p) => p.defId));
  });

  it('判据 2 负控：ban 模式下"按策略重选"与档案序列不同（证明上面的相等是序列带来的）', () => {
    const seed = 'g4t1-draft-ban';
    const { s } = playArchive(seed, { draftMode: 'ban', maxSteps: 60 });
    const s2 = createGame({ seed, draftMode: 'ban' });
    while (s2.phase === 'draft') {
      const next = draftNextAction(s2)!;
      const avail = getDraftPool(s2)[0].defId;
      if (next.kind === 'pick') performDraftPick(s2, avail);
      else performDraftBan(s2, avail);
    }
    expect(s2.draftPicks.map((p) => p.defId)).not.toEqual(s.draftPicks.map((p) => p.defId));
  });
});

/* ------------------------------------------------------------------ *
 * 判据 3：序列不足 / 多余 / 含池外 defId ⇒ 抛错且消息带 defId
 * ------------------------------------------------------------------ */

describe('T1 判据 3：草稿序列不足 / 多余 / 池外 defId 一律抛错（消息带 defId）', () => {
  /** 真协议 defId（`draftPool` 里的 defId 必须在本机 `getProtocolDef` 里存在，
   *  否则 `createGame` 之前的 `matchFileToCreateOptions` 就先抛了 —— 那样测不到本判据） */
  const POOL = DEMO_PROTOCOLS.map((p) => p.defId);
  /** ⚠️ picks 与 bans 必须从池里取**不相交**的两半：`getDraftPool` 会把"已选"和"已禁"
   *  一起排除，重叠的 defId 会在第二轮取到时被判成"池外/重复"（本腿第一版就栽在这）。 */
  const PICKS = POOL.slice(0, 6);
  const BANS = POOL.slice(6, 12);

  /** 只建到"进 turn 之前"的状态：不经过 `matchFileToCreateOptions`（它固定读档案的 draftPool） */
  function freshState(over: Partial<MatchFileSetup> = {}): { s: GameState; setup: MatchFileSetup } {
    const s = createGame({ seed: 't1-crit3', draftMode: over.draftMode ?? 'normal' });
    const setup: MatchFileSetup = {
      draftMode: over.draftMode ?? 'normal',
      draftStarter: s.draftStarter,
      firstToPlay: s.firstToPlay,
      draftPool: POOL,
      draftPicks: PICKS,
      bannedProtocols: [],
      ...over,
    };
    return { s, setup };
  }

  it('序列不足：normal 下 draftPicks 少一项 ⇒ 抛错', () => {
    const { s, setup } = freshState({ draftPicks: PICKS.slice(0, 5) });
    expect(() => replayDraftFromSetup(s, setup)).toThrow(/replayDraftFromSetup/);
    // ⚠️ 每次都要用**全新**状态：`replayDraftFromSetup` 会推进状态，
    // 第二次调用会在"已被推完的状态"上抛别的错（本腿第一版就栽在这）。
    const b = freshState({ draftPicks: PICKS.slice(0, 5) });
    expect(() => replayDraftFromSetup(b.s, b.setup)).toThrow(/不足/);
  });

  it('序列多余（normal）：draftPicks 多一项 ⇒ 抛错且消息带那个多余的 defId', () => {
    const { s, setup } = freshState({ draftPicks: [...PICKS, POOL[7]] });
    expect(() => replayDraftFromSetup(s, setup)).toThrow(new RegExp(POOL[7]));
  });

  it('序列多余（normal）：bannedProtocols 非空 ⇒ 抛错（normal 模式永远不消费该序列，不许静默吞）', () => {
    const { s, setup } = freshState({ bannedProtocols: [POOL[7]] });
    expect(() => replayDraftFromSetup(s, setup)).toThrow(new RegExp(POOL[7]));
  });

  it('含池外 defId（pick）⇒ 抛错且消息带 defId', () => {
    const { s, setup } = freshState({ draftPicks: [...PICKS.slice(0, 5), 'zz-out-of-pool'] });
    expect(() => replayDraftFromSetup(s, setup)).toThrow(/zz-out-of-pool/);
  });

  it('含池外 defId（ban）⇒ 抛错且消息带 defId', () => {
    const { s, setup } = freshState({
      draftMode: 'ban',
      // ban 模式第一动作就是"后手禁 2" ⇒ 第一条 ban 就是池外值
      bannedProtocols: ['zz-out-of-pool', ...BANS.slice(1)],
    });
    expect(() => replayDraftFromSetup(s, setup)).toThrow(/zz-out-of-pool/);
  });

  it('正控（normal）：合法序列不会误抛，且真的把草稿推完', () => {
    const { s, setup } = freshState();
    expect(replayDraftFromSetup(s, setup)).toEqual({ picks: 6, bans: 0 });
    expect(s.phase).toBe('turn');
    expect(s.draftPicks.map((p) => p.defId)).toEqual(PICKS);
  });

  it('正控（ban）：合法交错序列不会误抛（证明上面的红不是"什么都抛"）', () => {
    const { s, setup } = freshState({ draftMode: 'ban', bannedProtocols: BANS });
    expect(replayDraftFromSetup(s, setup)).toEqual({ picks: 6, bans: 6 });
    expect(s.phase).toBe('turn');
    expect(s.draftPicks.map((p) => p.defId)).toEqual(PICKS);
    expect(s.bannedProtocols).toEqual(BANS);
  });
});

/* ------------------------------------------------------------------ *
 * 判据 4：带撤销的对局（D5 已知缺口）—— 差异**只在 log**
 * ------------------------------------------------------------------ */

describe('T1 判据 4：带 performDraftUnpick 的对局（D5 已有意登记的缺口）', () => {
  function archiveWithUnpick(): { s: GameState; file: MatchFile } {
    const seed = 'g4t1-unpick';
    const s = createGame({ seed });
    // 撤销必须落在 `draftTurnRange` 的当前回合区间内（`create.ts:226-233`）。
    // 1-2-2-1 模式：**只能**撤销"当前连续轮次块"里的选择 —— 单选回合（round 0）完成后
    // 它的选择就不可撤销了（`tests/state/unpick.test.ts:27-32` 钉着这条）。
    // 这里"选进第二块的第一张再撤销它"：撤销把它放回池里 ⇒ 之后重选会拿回同一张，
    // 最终序列与"从没撤销过"完全相同 ⇒ 与重放的 log 长度差**恰好 1**（只有撤销那一条）。
    // ⚠️ 若只选 1 张就撤销，撤销的是 round 0 那张，它**不会**回到池首 ⇒ 后续自动选择
    // 多推出一张不同的卡，log 差会变成 2（本腿第一版就栽在这）。
    performDraftPick(s, getDraftPool(s)[0].defId);
    performDraftPick(s, getDraftPool(s)[0].defId);
    const undone = s.draftPicks[1].defId;
    expect(canUnpick(s, undone), '撤销的前提必须成立（否则这条腿测不到 D5）').toBe(true);
    performDraftUnpick(s, undone);
    while (s.phase === 'draft') performDraftPick(s, getDraftPool(s)[0].defId);
    expect(s.draftPicks.length, '反空转：撤销之后仍要选满 6 个').toBe(6);
    expect(s.log.filter((l) => l.includes('取消选择')).length, '反空转：现场必须真的留了撤销那条 log').toBe(1);

    const rec = createMatchFileRecorder();
    for (let i = 0; i < 40; i += 1) {
      if (s.phase !== 'turn' || s.winner !== null) break;
      if (s.pendingEffects.length > 0) {
        resolveAllChoices(s, pickFirst);
        continue;
      }
      const player = s.turnPlayer;
      const acts = getLegalActions(s, player);
      if (acts.length === 0) break;
      const a = acts[0];
      const args: Record<string, unknown> = {};
      if (a.cardUid !== undefined) args.cardUid = a.cardUid;
      if (a.faceUp !== undefined) args.faceUp = a.faceUp;
      if (a.line !== undefined) args.line = a.line;
      if (a.target !== undefined) args.target = a.target;
      const hasArgs = Object.keys(args).length > 0;
      rec.record({ player, kind: a.kind, ...(hasArgs ? { args } : {}), via: 'user' });
      applyRecordedAction(s, { seq: rec.nextSeq() - 1, player, kind: a.kind, ...(hasArgs ? { args } : {}) });
      resolveAllChoices(s, pickFirst);
    }
    const file = rec.toMatchFile(metaFor(seed, setupFromState(s)));
    return { s, file };
  }

  it('重放后 log 比原件短（撤销那条日志不在档案里），**其余字段全等**；含 log 时指纹不等', () => {
    const { s, file } = archiveWithUnpick();
    const replayed = fullReplay(file);
    // 承重断言①：现场有撤销、重放重建不出撤销（用**日志内容**判，不用"恰好差 1 条"的过精确计数：
    // 缺口大小取决于 fixture —— 现场【选 A → 撤销 A → 改选 B】= 差 2，
    // 只有"撤销后又选回同一张"才是差 1。计数换成"更短 + 缺的正是那一条"）。
    expect(s.log.some((l) => l.includes('取消选择')), '这一局必须真的走过一次撤销').toBe(true);
    expect(replayed.log.some((l) => l.includes('取消选择')), '重放重建不出撤销那条 log').toBe(false);
    expect(replayed.log.length).toBeLessThan(s.log.length);
    // D5：**只**用"剔除 log 后的指纹"来**定位**差异来源 —— 它证明差异没有别处
    expect(fingerprintIgnoringLog(replayed)).toBe(fingerprintIgnoringLog(s));
    // 而含 log 的指纹**如实不等**（不许用上面那条当通过判据来掩盖缺口）
    expect(stateFingerprint(replayed)).not.toBe(stateFingerprint(s));
  });

  it('对照组：无撤销的对局 ⇒ **含 log 也相等**（证明差异确实来自撤销，不是别的东西）', () => {
    const seed = 'g4t1-unpick-control';
    const s = createGame({ seed });
    draftNontrivial(s, seed);
    const rec = createMatchFileRecorder();
    for (let i = 0; i < 30; i += 1) {
      if (s.phase !== 'turn' || s.winner !== null) break;
      if (s.pendingEffects.length > 0) {
        resolveAllChoices(s, pickFirst);
        continue;
      }
      const player = s.turnPlayer;
      const acts = getLegalActions(s, player);
      if (acts.length === 0) break;
      const a = acts[0];
      const args: Record<string, unknown> = {};
      if (a.cardUid !== undefined) args.cardUid = a.cardUid;
      if (a.faceUp !== undefined) args.faceUp = a.faceUp;
      if (a.line !== undefined) args.line = a.line;
      if (a.target !== undefined) args.target = a.target;
      const hasArgs = Object.keys(args).length > 0;
      rec.record({ player, kind: a.kind, ...(hasArgs ? { args } : {}), via: 'user' });
      applyRecordedAction(s, { seq: rec.nextSeq() - 1, player, kind: a.kind, ...(hasArgs ? { args } : {}) });
      resolveAllChoices(s, pickFirst);
    }
    const file = rec.toMatchFile(metaFor(seed, setupFromState(s)));
    const replayed = fullReplay(file);
    expect(replayed.log.length).toBe(s.log.length);
    expect(stateFingerprint(replayed)).toBe(stateFingerprint(s));
  });
});

/* ------------------------------------------------------------------ *
 * 判据 5：applyRecordedAction 的 kind 覆盖完备（生成式清单）
 * ------------------------------------------------------------------ */

/** 从 `src/core/game.ts` 的 `ActionKind` union **派生**取值清单（不手写：漏一个就是假绿） */
function actionKindsFromDisk(): string[] {
  const src = readFileSync(fileURLToPath(new URL('../../src/core/game.ts', import.meta.url))).subarray(0, 4 * 1024 * 1024).toString('utf8');
  const m = src.match(/export type ActionKind =([^;]+);/);
  if (!m) throw new Error('没能从 src/core/game.ts 提取 ActionKind union（提取器失效 = 判据恒真）');
  return [...m[1].matchAll(/'([a-z-]+)'/g)].map((x) => x[1]);
}

describe('T1 判据 5：8 个 ActionKind 全覆盖，未覆盖的 kind 抛错（不静默 no-op）', () => {
  it('生成式清单：从 game.ts 派生出的 kind 清单必须是 8 个且与探针能一一对上', () => {
    const kinds = actionKindsFromDisk();
    expect(kinds.length, `派生的 kind 清单：${kinds.join(',')}`).toBe(8);
    expect(new Set(kinds).size).toBe(8);
    // 正控：提取器对合成样本可用（否则上面在空数组上恒真）
    const sample = "export type ActionKind = 'a' | 'b';";
    expect([...sample.match(/export type ActionKind =([^;]+);/)![1].matchAll(/'([a-z-]+)'/g)].map((x) => x[1])).toEqual(['a', 'b']);
  });

  /** 每个 kind 都跑一次真引擎调用：断言不抛且状态确实变了（= 不是空转） */
  function build(kind: string): { s: GameState; record: ActionRecord } {
    const s = createGame({ seed: `t1-kind-${kind}` });
    while (s.phase === 'draft') performDraftPick(s, getDraftPool(s)[0].defId);
    const player = s.turnPlayer;
    const before = stateFingerprint(s);
    switch (kind) {
      case 'play': {
        const uid = s.players[player].hand[0].uid;
        executeAction(s, player, 'play', { cardUid: uid, faceUp: false, line: 0 });
        // 现场：把同一条 play 记下来，再用 applyRecordedAction 跑在**同一状态**上比较
        const s2 = createGame({ seed: `t1-kind-${kind}` });
        while (s2.phase === 'draft') performDraftPick(s2, getDraftPool(s2)[0].defId);
        const rec: ActionRecord = { seq: 0, player, kind: 'play', args: { cardUid: uid, faceUp: false, line: 0 } };
        applyRecordedAction(s2, rec);
        expect(stateFingerprint(s2), 'play 分支必须真的推进状态').not.toBe(before);
        return { s: s2, record: rec };
      }
      case 'compile': {
        s.step = 'check-compile';
        // 可编译线：unity-5 + unity-4 + unity-3 = 12 ≥ 10 且 > 对手 0（`canCompileLine`，compile.ts:8-17）
        s.players[player].stacks[0] = [
          makeCard('unity-5', player, 'field', true, 0, 0),
          makeCard('unity-4', player, 'field', true, 0, 1),
          makeCard('unity-3', player, 'field', true, 0, 2),
        ];
        s.control = player; // 顺带覆盖"持控制组件时编译"（引擎内部自己归还）
        const rec: ActionRecord = { seq: 0, player, kind: 'compile', args: { line: 0 } };
        applyRecordedAction(s, rec);
        expect(s.players[player].protocols[0].compiled).toBe(true);
        expect(s.control, 'compile 分支内部必须归还控制组件').toBe(-1);
        return { s, record: rec };
      }
      case 'refresh': {
        s.step = 'action';
        s.players[player].hand = [];
        const rec: ActionRecord = { seq: 0, player, kind: 'refresh' };
        applyRecordedAction(s, rec);
        expect(s.players[player].hand.length).toBeGreaterThan(0);
        return { s, record: rec };
      }
      case 'advance': {
        const from = s.step;
        const rec: ActionRecord = { seq: 0, player, kind: 'advance' };
        applyRecordedAction(s, rec);
        expect(s.step).not.toBe(from);
        return { s, record: rec };
      }
      case 'clear-cache': {
        s.step = 'check-cache';
        while (s.players[player].hand.length <= 5) {
          const c = s.players[player].deck.shift();
          if (!c) break;
          s.players[player].hand.push(c);
        }
        expect(s.players[player].hand.length).toBeGreaterThan(5);
        const rec: ActionRecord = { seq: 0, player, kind: 'clear-cache' };
        applyRecordedAction(s, rec);
        expect(s.pendingEffects.length, 'clear-cache 必须挂起弃牌选择').toBeGreaterThan(0);
        return { s, record: rec };
      }
      case 'resolve-trigger': {
        // light-1 的 end 触发（**必选**，见 tests/effects/light.test.ts:132-148）：
        // 先走到 action 步摆牌，再把步推到 end（`action → check-cache → end`，
        // 中间可能多一步 check-cache ⇒ 用有界循环，不用"点一次 advance 就到"的假设）。
        while (s.step !== 'action' && s.phase === 'turn') executeAction(s, s.turnPlayer, 'advance');
        const src = makeCard('light-1', player, 'field', true, 0, 0);
        s.players[player].stacks[0] = [src];
        let guard = 0;
        while (s.step !== 'end' && guard++ < 8) executeAction(s, player, 'advance');
        expect(s.step).toBe('end');
        const pending = getLegalActions(s, player).filter((x) => x.kind === 'resolve-trigger');
        expect(pending.length, 'end 步必须有可结算的 light-1 触发').toBeGreaterThan(0);
        const rec: ActionRecord = { seq: 0, player, kind: 'resolve-trigger', args: { cardUid: src.uid } };
        applyRecordedAction(s, rec);
        expect(s.resolvedTriggerUids).toContain(src.uid);
        return { s, record: rec };
      }
      case 'effect-choice': {
        const cand = stateWithSuspendedPrompt();
        const rec: ActionRecord = {
          seq: 0,
          player: cand.chooser,
          kind: 'effect-choice',
          args: { promptId: cand.promptId, choice: cand.choice },
        };
        applyRecordedAction(cand.s, rec);
        expect(cand.s.pendingEffects.length, '应答后该效果必须出栈').toBe(0);
        return { s: cand.s, record: rec };
      }
      case 'rearrange-protocols': {
        s.step = 'action'; // 重排只在编译/补满前可用（game.ts:171）
        s.control = player;
        const before2 = s.players[0].protocols.map((p) => p.defId);
        const rec: ActionRecord = { seq: 0, player, kind: 'rearrange-protocols', args: { target: 0, a: 0, b: 2 } };
        applyRecordedAction(s, rec);
        expect(s.players[0].protocols.map((p) => p.defId)).toEqual([before2[2], before2[1], before2[0]]);
        return { s, record: rec };
      }
      default:
        throw new Error(`判据 5 的构造缺少 kind=${kind} 的分支（生成式清单派出了新取值）`);
    }
  }

  for (const kind of actionKindsFromDisk()) {
    it(`kind=${kind} 有一条真引擎腿（不抛 + 状态真的推进）`, () => {
      const { record } = build(kind);
      expect(record.kind).toBe(kind);
    });
  }

  it('未覆盖的 kind 抛错，而不是静默 no-op', () => {
    const s = createGame({ seed: 't1-unknown-kind' });
    while (s.phase === 'draft') performDraftPick(s, getDraftPool(s)[0].defId);
    const before = stateFingerprint(s);
    const bogus = { seq: 0, player: 0 as PlayerId, kind: 'not-a-kind' as ActionKind, args: {} };
    expect(() => applyRecordedAction(s, bogus)).toThrow(/未覆盖/);
    expect(() => applyRecordedAction(s, bogus)).toThrow(/not-a-kind/);
    expect(stateFingerprint(s), '抛错前不许改动状态').toBe(before);
  });
});

/* ------------------------------------------------------------------ *
 * 判据 7：带控制组件重排的对局往返指纹相等（★ 还原规则的牙）
 * ------------------------------------------------------------------ */

describe('T1 判据 7：带控制组件重排的对局，现场记录 → 重放指纹相等', () => {
  /**
   * 现场（`main.ts:265-303` 的顺序）：【UI 先 `resetControlIfHeld`（带一条 pushLog，**不进档案**）】
   * →【`rearrange-protocols`（1 条或多条，**进档案**）】→【`compile`（**进档案**，引擎内部再幂等归还一次）】。
   *
   * 构造法 = **只读真值锚点 + 脚本化状态**：
   *  - 起点经**真引擎**跑到"可重排的步"（`check-compile`/`action`），事件全部记进档案 ⇒ 重放侧
   *    重放同一个 `check-control` 判定；
   *  - 之后（可编译线、控制权归属）**脚本化设定**：协调者的止损指令，且 `tests/rules/rearrange.test.ts:84`、
   *    `tests/effects/control-rearrange-flow.test.ts:147` 已有同款构造先例。
   *    ⚠️ "在真实对局里搜到持控制组件的窗口"实测代价 ~500 CPU 秒且**不是这条腿的必要条件** ——
   *    这条腿要证的是"**控制权归还的 pushLog 落在哪个位置**"，不是"控制权怎么来的"。
   */
  function baseAfterAdvance(): { s: GameState; actions: ActionRecord[]; player: PlayerId } {
    const seed = 'g4t1-control-rearrange';
    const s = createGame({ seed });
    draftNontrivial(s, seed);
    const player = s.turnPlayer;
    expect(s.step, '草稿结束时应在 start 步').toBe('start');
    const actions: ActionRecord[] = [];
    let guard = 0;
    while (s.step !== 'check-compile' && s.step !== 'action' && guard++ < 8) {
      const a: ActionRecord = { seq: actions.length, player, kind: 'advance', via: 'user' };
      actions.push(a);
      applyRecordedAction(s, a);
    }
    expect(['check-compile', 'action'], `推进后的步：${s.step}`).toContain(s.step);
    // 反空转：真的推进了至少一步（否则"重放同一个判定"这句话是空的）
    expect(actions.length).toBeGreaterThan(0);
    return { s, actions, player };
  }

  /** 把"可编译线 + 控制权"这套脚本化前置条件施加到给定状态上。
   *  ⚠️ uid **必须写死**：`tests/helpers.ts` 的 `makeCard()` 用**模块级计数器**发 uid
   *  ⇒ 现场侧与重放侧各调一次就会得到 `tc1..tc3` 与 `tc4..tc6`，两边指纹必然不等
   *  （本腿第一版就栽在这，debug 输出把差异指到了 `players`）。 */
  function scriptedFixture(s: GameState, player: PlayerId): { line: Line; swapLine: Line } {
    expect(s.players[player].protocols.every((p) => !p.compiled), '前置：未编译任何协议').toBe(true);
    const line = 0 as Line;
    const mk = (defId: string, uid: string, pos: number): Card => ({
      uid,
      defId,
      owner: player,
      faceUp: true,
      zone: 'field',
      line,
      pos,
    });
    s.players[player].stacks[line] = [
      mk('unity-5', 'fixture-c7-u5', 0),
      mk('unity-4', 'fixture-c7-u4', 1),
      mk('unity-3', 'fixture-c7-u3', 2),
    ];
    expect(s.players[1 - player].stacks[line]).toEqual([]);
    expect(getCompilableLines(s, player), '前置：这条线必须真的可编译（执行器读的正是它）').toContain(line);
    s.control = player; // 现场：P1 持有控制组件
    return { line, swapLine: 1 as Line };
  }

  it('★ 往返指纹相等（删掉还原规则 ⇒ 本条必红）', () => {
    const { s, actions, player } = baseAfterAdvance();
    const { line, swapLine } = scriptedFixture(s, player);
    // 前置状态（= 两个状态在**走重排/编译之前**必须逐字节相同）：
    // 现场侧先算一次，重放侧到达同一处后再比一次 —— 这两次比较才是"同一个局"的证据。
    const beforeActions = stateFingerprint(s);

    // ① 现场与重放**走同一条生产助手**（`applyRecordedAction`），差别只有一处：
    //    现场在应用之前**已经**做过 UI 那次归还（`main.ts:266`），重放**没做过** ——
    //    重放侧唯一的还原来源就是助手内部的「控制权归还」还原规则。
    //    因此两边的 log 顺序都必须落在【归还】【重排】【编译】。
    //    （现场侧这里用 `resetControlIfHeld` 显式复现 UI 那次调用；它**不进档案**。
    //      ⚠️ 不能改成"现场不归还"：那样现场 log 会变成【重排】【归还】【编译】，
    //      与"重放不还原"的形态同形 ⇒ 这条腿会失去判别力。）
    expect(resetControlIfHeld(s, player), '这一腿必须真的走到"持控制组件"的分支').toBe(true);
    // ② 重排（进档案）
    const aSwap: ActionRecord = { seq: actions.length, player, kind: 'rearrange-protocols', args: { target: 0, a: 0, b: swapLine }, via: 'user' };
    actions.push(aSwap);
    applyRecordedAction(s, aSwap);
    // ③ 编译（进档案；助手在这里也会查一次归还规则，但已归还 ⇒ 幂等 no-op）
    const aCompile: ActionRecord = { seq: actions.length, player, kind: 'compile', args: { line }, via: 'user' };
    actions.push(aCompile);
    applyRecordedAction(s, aCompile);

    // 现场 log 顺序必须是【归还】【重排】【编译】——否则这条腿对 M4 无牙。
    // ⚠️ 编译那条锚点必须用 `编译线`（compile-body.ts:67 的实际文案），**不能**用 `编译`：
    // 归还那条自己也含"（编译/补满手牌）"⇒ `includes('编译')` 会命中归还行（本腿第一版就栽在这）。
    const iReturn = s.log.findIndex((l) => l.includes('归还控制组件'));
    const iSwap = s.log.findIndex((l) => l.includes('重排协议'));
    const iCompile = s.log.findIndex((l) => l.includes('编译线'));
    expect(iReturn, `现场必须留下"归还控制组件"那条 log：${JSON.stringify(s.log)}`).toBeGreaterThanOrEqual(0);
    expect(iSwap, '现场必须留下"重排协议"那条 log').toBeGreaterThan(iReturn);
    expect(iCompile, '现场必须留下"编译线"那条 log').toBeGreaterThan(iSwap);

    // 重放：全新状态（createGame + 草稿序列重放），把前置条件**同样**施加，再走同一条助手。
    const seed = 'g4t1-control-rearrange';
    const file: MatchFile = createMatchFileRecorder().toMatchFile(metaFor(seed, setupFromState(s)));
    const replayState = stateAfterDraft(file);
    for (const a of actions.filter((x) => x.kind === 'advance')) applyRecordedAction(replayState, a);
    scriptedFixture(replayState, player);
    // 两边的前置条件必须**逐字节相同**（否则比的是两个不同的局）
    expect(stateFingerprint(replayState), '重放侧到达的前置状态必须与现场相同').toBe(beforeActions);
    // *** 这一段是"重放"：只走生产助手；现场那次 UI 归还**不在 actions 里**，
    //     唯一的还原来源就是 `applyRecordedAction` 里的「控制权归还」还原规则。***
    // 步进断言（每条腿都钉住"规则在该条 action **之前**生效"）：
    //  rearrange 之前控制权**仍在该玩家手里**（现场那次归还还没发生）
    for (const a of actions.filter((x) => x.kind !== 'advance')) {
      if (a.kind === 'rearrange-protocols') {
        expect(replayState.control, '重排前控制权必须仍在持有者手里').toBe(player);
      }
      applyRecordedAction(replayState, a);
    }

    // 反空转：两侧都必须留下**恰好一条**"归还"log（否则"相等"可能来自两边都没有它）
    expect(s.log.filter((l) => l.includes('归还控制组件')).length).toBe(1);
    expect(replayState.log.filter((l) => l.includes('归还控制组件')).length, `重放 log：${JSON.stringify(replayState.log)}`).toBe(1);
    // 判别力就在这里：log **逐条相同**（顺序敏感），进而指纹相等
    expect(replayState.log).toEqual(s.log);
    expect(stateFingerprint(replayState)).toBe(stateFingerprint(s));
    // 棋盘侧也必须真的重排过 + 编译过（不是"两条路都没动"）
    expect(replayState.players[0].protocols.map((p) => p.defId)).toEqual(s.players[0].protocols.map((p) => p.defId));
    expect(replayState.players[player].protocols[line].compiled).toBe(true);
  });

  it('★ 对照（负控）：同一条重排，**不**先归还 ⇒ 归还 log 落到重排之后 ⇒ 指纹不等', () => {
    // 这条给出 M4 的**语义**依据（不是形式）：把"现场那次归还"从重排之前拿掉（= 重放里没有还原规则的
    // 形态），归还的 pushLog 会被 `compile` 分支推迟到重排**之后** ⇒ `log` 顺序不同 ⇒ 指纹不等。
    // 两侧都是**同一个起始状态**，只有"归还在重排前 / 重排后"这一点不同 —— 差异只能来自这一条。
    const { s: a, player } = baseAfterAdvance();
    scriptedFixture(a, player);
    const { s: b } = baseAfterAdvance();
    scriptedFixture(b, player);

    // A（现场形态）：先归还 → 重排 → 编译
    expect(resetControlIfHeld(a, player)).toBe(true);
    executeAction(a, player, 'rearrange-protocols', { target: 0, a: 0, b: 1 });
    executeAction(a, player, 'compile', { line: 0 });
    // B（无还原规则的形态）：重排 → 编译（归还由 compile 分支自己产生）
    executeAction(b, player, 'rearrange-protocols', { target: 0, a: 0, b: 1 });
    executeAction(b, player, 'compile', { line: 0 });

    const aSwap = a.log.findIndex((l) => l.includes('重排协议'));
    const aReturn = a.log.findIndex((l) => l.includes('归还控制组件'));
    const bSwap = b.log.findIndex((l) => l.includes('重排协议'));
    const bReturn = b.log.findIndex((l) => l.includes('归还控制组件'));
    expect(aReturn, `A log：${JSON.stringify(a.log.slice(-3))}`).toBeLessThan(aSwap); // 归还在重排之前
    expect(bReturn, `B log：${JSON.stringify(b.log.slice(-3))}`).toBeGreaterThan(bSwap); // 归还在重排之后
    // 两边 log 长度相同但**顺序不同** ⇒ 指纹必须不等（这正是还原规则的牙）
    expect(a.log.length).toBe(b.log.length);
    expect(stateFingerprint(a)).not.toBe(stateFingerprint(b));
    // 且棋盘侧完全相同（证明差异**只在 log 顺序**，与 §3.1「重排不读改 control」一致）
    expect(fingerprintIgnoringLog(a)).toBe(fingerprintIgnoringLog(b));
  });
});
