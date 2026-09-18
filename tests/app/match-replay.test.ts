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
import { applyRecordedAction, replayDraftFromSetup, stateAfterDraft, stateAtStep } from '../../src/app/match-replay';
import { stripComments, functionBody } from '../ui/source-text';
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

/* ------------------------------------------------------------------ *
 * G 轮（评审回合）补的三条腿
 * ------------------------------------------------------------------ */

describe('T1-G2a：现场侧**不走助手**（真值锚点在引擎侧，不在 test-local）', () => {
  it('现场用 executeAction 直跑（+ 显式模拟 UI 那次归还）；重放侧走 applyRecordedAction ⇒ 指纹相等', () => {
    // 为什么单列一条：判据 7 的现场侧与重放侧**都过助手** ⇒ 它证明的是"助手与自己一致"，
    // 没有任何腿把助手与**真实现场编码**（`main.ts:265-303`）对拍。这条腿的现场侧
    // **完全不碰 `applyRecordedAction`**（连 advance 都用 `executeAction`），
    // 重放侧只走助手 ⇒ 它证明的是"**助手 != 自己**"，即助手复现了真引擎的那条路径。
    const seed = 'g4t1-control-rearrange';
    const s = createGame({ seed });
    draftNontrivial(s, seed);
    const player = s.turnPlayer;
    let guard = 0;
    while (s.step !== 'check-compile' && s.step !== 'action' && guard++ < 8) {
      executeAction(s, player, 'advance');
    }
    expect(['check-compile', 'action'], `推进后的步：${s.step}`).toContain(s.step);
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
    s.players[player].stacks[line] = [mk('unity-5', 'g2a-u5', 0), mk('unity-4', 'g2a-u4', 1), mk('unity-3', 'g2a-u3', 2)];
    s.control = player;
    // 现场（`main.ts:266` 同形）：UI 在打开重排模态**之前**先归还
    expect(resetControlIfHeld(s, player), '这一腿必须真的走到"持控制组件"的分支').toBe(true);
    executeAction(s, player, 'rearrange-protocols', { target: 0, a: 0, b: 1 });
    executeAction(s, player, 'compile', { line });
    const iReturn = s.log.findIndex((l) => l.includes('归还控制组件'));
    const iSwap = s.log.findIndex((l) => l.includes('重排协议'));
    expect(iReturn).toBeLessThan(iSwap);

    // 重放：全新状态 + 草稿序列重建 + 把档案里的动作**逐条走助手**
    const file = createMatchFileRecorder().toMatchFile(metaFor(seed, setupFromState(s)));
    const rp = stateAfterDraft(file);
    guard = 0;
    while (rp.step !== 'check-compile' && rp.step !== 'action' && guard++ < 8) {
      applyRecordedAction(rp, { seq: 0, player, kind: 'advance' });
    }
    rp.players[player].stacks[line] = [
      mk('unity-5', 'g2a-u5', 0),
      mk('unity-4', 'g2a-u4', 1),
      mk('unity-3', 'g2a-u3', 2),
    ];
    rp.control = player;
    applyRecordedAction(rp, { seq: 0, player, kind: 'rearrange-protocols', args: { target: 0, a: 0, b: 1 } });
    applyRecordedAction(rp, { seq: 1, player, kind: 'compile', args: { line } });

    // 反空转：两侧都必须留下**恰好一条**"归还"log，且都在重排之前
    expect(s.log.filter((l) => l.includes('归还控制组件')).length).toBe(1);
    expect(rp.log.filter((l) => l.includes('归还控制组件')).length, `重放 log：${JSON.stringify(rp.log)}`).toBe(1);
    expect(rp.log.findIndex((l) => l.includes('归还控制组件'))).toBeLessThan(
      rp.log.findIndex((l) => l.includes('重排协议')),
    );
    // 真值锚点：**助手复现了真引擎路径** ⇒ 指纹逐字节相等
    expect(rp.log).toEqual(s.log);
    expect(stateFingerprint(rp)).toBe(stateFingerprint(s));
  });
});

describe('T1-G4：还原规则跑在引擎守卫之前 ⇒ 抛错前状态可能已被改动（**如实登记并钉住**）', () => {
  it('篡改档案（在 end 步重排）⇒ 抛错，但 control 与 log 已被还原规则改动', () => {
    // 事实：`applyRecordedAction` 的还原规则在 `executeAction` 的合法性守卫
    // （`game.ts:122-128` / `game.ts:171`）**之前**执行 ⇒ 引擎抛错时状态**已经不是调用前的状态**。
    // 选择"登记 + 配腿"而不是"复制一份引擎守卫"：复制守卫就是**第二份真相**
    // （引擎改了它会静默漂移）。T2 据此知道 `cursor().error` 之后的状态是**可疑的**。
    const s = createGame({ seed: 'g4t1-g4-guard' });
    while (s.phase === 'draft') performDraftPick(s, getDraftPool(s)[0].defId);
    const player = s.turnPlayer;
    s.step = 'end'; // 引擎守卫：重排只在编译/补满前可用
    s.control = player;
    const logBefore = s.log.length;
    expect(() =>
      applyRecordedAction(s, { seq: 0, player, kind: 'rearrange-protocols', args: { target: 0, a: 0, b: 1 } }),
    ).toThrow(/only usable before compile\/refresh/);
    // 钉住副作用：控制权已被归还、log 已多出一条 —— 这就是"抛错前状态已被改动"的形态
    expect(s.control, '抛错前还原规则已经改动了 control（T2 必须知道这一点）').toBe(-1);
    expect(s.log.length, '抛错前还原规则已经 push 了一条 log').toBe(logBefore + 1);
    expect(s.log[s.log.length - 1]).toContain('归还控制组件');
  });

  it('对照：同一个非法动作在**不持控制组件**时不产生任何改动（证明上面那条的因是"持控制组件"）', () => {
    const s = createGame({ seed: 'g4t1-g4-guard' });
    while (s.phase === 'draft') performDraftPick(s, getDraftPool(s)[0].defId);
    const player = s.turnPlayer;
    s.step = 'end';
    s.control = -1;
    const before = stateFingerprint(s);
    expect(() =>
      applyRecordedAction(s, { seq: 0, player, kind: 'rearrange-protocols', args: { target: 0, a: 0, b: 1 } }),
    ).toThrow(/only usable before compile\/refresh/);
    expect(stateFingerprint(s), '不持控制组件 ⇒ 抛错前状态一字不动').toBe(before);
  });
});

describe('T1-G6：`effect-choice` 必须用**档案里的 player**（chooser），不是 `s.turnPlayer`', () => {
  it('chooser = 对手 的挂起选择：用 turnPlayer 应答被引擎拒，用档案 player 应答成功出栈', () => {
    // 为什么单列：判据 5 的 `fire-5` 场景里 `chooser === turnPlayer` ⇒ 现有腿**区分不出**
    // "用档案 player" 与 "用 `s.turnPlayer`"；"真跑一局"的档案里 `effect-choice` 条数 = 0
    // ⇒ 这条路径此前**完全没有判别力**。`greed-2` 的中指令是"对手弃1张牌"，
    // 其 prompt 带 `chooser: foe`（`src/core/effects/cards/greed.ts:64`）⇒ 可区分
    // （⚠️ 别写成 `:73`：那是 `greed2Start` 的**可选回手** prompt，**没有** `chooser`）。
    const build = (): { s: GameState; promptId: string; chooser: PlayerId; choice: string[] } => {
      const s = createGame({ seed: 'g4t1-g6-chooser' });
      while (s.phase === 'draft') performDraftPick(s, getDraftPool(s)[0].defId);
      const turn = s.turnPlayer;
      s.players[turn].protocols[0] = { defId: 'greed', compiled: false };
      s.players[turn].hand = [makeCard('greed-2', turn, 'hand', true, null), ...s.players[turn].hand];
      executeAction(s, turn, 'play', { cardUid: s.players[turn].hand[0].uid, faceUp: true, line: 0 });
      const top = s.pendingEffects[s.pendingEffects.length - 1];
      expect(top?.prompt, 'greed-2 必须挂起选择').toBeTruthy();
      const chooser = (top.prompt!.chooser ?? top.player) as PlayerId;
      expect(chooser, '这一腿要求 chooser 与 turnPlayer **不同**（否则没有判别力）').not.toBe(turn);
      expect(top.prompt!.candidates.length).toBeGreaterThan(0);
      return { s, promptId: top.id, chooser, choice: pickFirst(top.prompt!) };
    };

    // ① 负控：按 `s.turnPlayer` 应答 ⇒ 引擎必须拒绝（证明"用 turnPlayer"是错的）
    {
      const { s, promptId, choice } = build();
      expect(() =>
        executeAction(s, s.turnPlayer, 'effect-choice', { promptId, choice }),
      ).toThrow(/not your choice/);
    }
    // ② 正控：按**档案里的 player**（= chooser）走生产助手 ⇒ 成功出栈
    {
      const { s, promptId, chooser, choice } = build();
      applyRecordedAction(s, { seq: 0, player: chooser, kind: 'effect-choice', args: { promptId, choice } });
      expect(s.pendingEffects.length, '应答后该效果必须出栈').toBe(0);
    }
  });
});

/* ==================================================================== *
 * G5 T4（裁决 D9）：`stateAtStep` —— 差分腿 / 边界 / 唯一出处 / 引用独立
 * ==================================================================== */

/**
 * T4 的 60 步差分档案。
 *
 * **现场侧走 `executeAction` 直跑，不经过 `applyRecordedAction`** —— 与 G4 的 G2a 腿同一个
 * 理由：现场与重放都过助手，证明的只是"助手与自己一致"。所以现场侧另有一份按 kind 逐个
 * 收窄的调用（`liveApply`），它是这条腿的**真值锚点**（不是生产代码的第二份映射：
 * 它只住在测试里，判据 3 的文本腿只读 `src/app/match-replay.ts`）。
 *
 * 三个刻意的设计：
 *  1. **每一步挂起的选择都记成 `effect-choice`**（现场用 `pickFirst` 应答，那条应答进档案）
 *     ⇒ 档案自称一体：重放只需逐条 `applyRecordedAction`，不需要任何测试侧策略补答案。
 *  2. 在**持有控制组件**的窗口里做真重排（形状照 `main.ts:266`：UI 打开重排模态**之前**先
 *     `resetControlIfHeld`，那次归还带一条 `pushLog` 但**不进档案**）⇒ 重放侧唯一的还原来源
 *     就是 `applyRecordedAction` 里「控制权归还」那一半。没有这一步，M1 打不红判据 1。
 *  3. 只走 `getLegalActions(s, player)[0]` 这一条确定性启发式 ⇒ 现场真值可复算。
 */
const STEP_SEED = 'g5t4-diff-first-7';
const STEP_COUNT = 60;
/** 差分腿的分叉点（任务书 §3 判据 1 点名的 24） */
const STEP_SPLIT = 24;

interface StepArchive {
  /** 现场（走 `executeAction`）走到第 steps 条操作之后的真值状态 */
  s: GameState;
  file: MatchFile;
  /** 现场真正走过"持有控制组件时重排"的那几条下标 */
  rearrangeSeqs: number[];
  /** 现场记录 `effect-choice` 的那几条下标 */
  effectChoiceSeqs: number[];
  /** `fpAfter[k]` = 现场走完前 k 条操作之后的指纹（`fpAfter[0]` = 草稿结束） */
  fpAfter: string[];
}

/** 现场侧的引擎调用（按 kind 逐个收窄；档案里出现没覆盖的 kind 会响亮抛错，不静默跳过） */
function liveApply(s: GameState, player: PlayerId, kind: ActionKind, args: Record<string, unknown>): void {
  switch (kind) {
    case 'play':
      executeAction(s, player, 'play', args as unknown as { cardUid: string; faceUp: boolean; line: Line; target?: PlayerId });
      return;
    case 'compile':
      executeAction(s, player, 'compile', args as unknown as { line: Line });
      return;
    case 'refresh':
      executeAction(s, player, 'refresh');
      return;
    case 'advance':
      executeAction(s, player, 'advance');
      return;
    case 'clear-cache':
      executeAction(s, player, 'clear-cache');
      return;
    case 'resolve-trigger':
      executeAction(s, player, 'resolve-trigger', args as unknown as { cardUid: string });
      return;
    case 'effect-choice':
      executeAction(s, player, 'effect-choice', args as unknown as { promptId: string; choice: string[] });
      return;
    case 'rearrange-protocols':
      executeAction(s, player, 'rearrange-protocols', args as unknown as { target: PlayerId; a: Line; b: Line });
      return;
    default:
      throw new Error(`T4 差分夹具的现场侧没有覆盖 kind=${String(kind)}（生成式清单派出了新取值？）`);
  }
}

function buildStepArchive(seed: string, steps: number): StepArchive {
  const s = createGame({ seed });
  while (s.phase === 'draft') performDraftPick(s, getDraftPool(s)[0].defId);
  const rec = createMatchFileRecorder();
  const rearrangeSeqs: number[] = [];
  const effectChoiceSeqs: number[] = [];
  const fpAfter: string[] = [stateFingerprint(s)];
  let rearrangedThisWindow = false;
  let guard = 0;
  while (rec.nextSeq() < steps) {
    if (guard++ > 4000) throw new Error('T4 差分档案没有收敛');
    if (s.winner !== null || s.phase !== 'turn') break;
    if (s.pendingEffects.length > 0) {
      const top = s.pendingEffects[s.pendingEffects.length - 1];
      // 反空转：现场只会遇到"带 prompt"的挂起效果。不带 prompt 的挂起没法被档案唯一确定
      // （重放侧只能靠测试策略补，那就不是"档案能重放"了）⇒ 直接响亮抛错。
      expect(top.prompt, 'T4 夹具：挂起效果必须带 prompt（否则档案不能唯一确定这一步）').toBeTruthy();
      const chooser = (top.prompt!.chooser ?? top.player ?? s.turnPlayer) as PlayerId;
      const choice = pickFirst(top.prompt!);
      const args = { promptId: top.id, choice };
      rec.record({ player: chooser, kind: 'effect-choice', args, via: 'user' });
      executeAction(s, chooser, 'effect-choice', args);
      effectChoiceSeqs.push(rec.nextSeq() - 1);
      fpAfter.push(stateFingerprint(s));
      continue;
    }
    const player = s.turnPlayer;
    if (s.control === player && (s.step === 'check-compile' || s.step === 'action') && !rearrangedThisWindow) {
      expect(resetControlIfHeld(s, player), 'T4 夹具：重排窗口里必须真的持有控制组件').toBe(true);
      const args = { target: player, a: 0 as Line, b: 2 as Line };
      rec.record({ player, kind: 'rearrange-protocols', args, via: 'user' });
      executeAction(s, player, 'rearrange-protocols', args);
      rearrangeSeqs.push(rec.nextSeq() - 1);
      rearrangedThisWindow = true;
      fpAfter.push(stateFingerprint(s));
      continue;
    }
    if (s.step !== 'check-compile' && s.step !== 'action') rearrangedThisWindow = false;
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
    liveApply(s, player, a.kind, args);
    fpAfter.push(stateFingerprint(s));
  }
  return { s, file: rec.toMatchFile(metaFor(seed, setupFromState(s))), rearrangeSeqs, effectChoiceSeqs, fpAfter };
}

/** 夹具**懒建**：绝不在 `describe`/模块作用域里建（套件级抛错会表现成"0 条失败用例却退 1"） */
const stepArchives = new Map<string, StepArchive>();
function stepArchive(seed = STEP_SEED, steps = STEP_COUNT): StepArchive {
  const key = `${seed}#${steps}`;
  const hit = stepArchives.get(key);
  if (hit) return hit;
  const built = buildStepArchive(seed, steps);
  stepArchives.set(key, built);
  return built;
}

/** 从任意对象图里收集**对象身份**（用来判"返回值与档案共享引用"） */
function collectObjects(root: unknown, into: Set<object>, seen = new Set<object>()): void {
  if (root === null || typeof root !== 'object') return;
  const o = root as object;
  if (seen.has(o)) return;
  seen.add(o);
  into.add(o);
  if (Array.isArray(o)) {
    for (const v of o) collectObjects(v, into, seen);
    return;
  }
  for (const k of Object.keys(o)) collectObjects((o as Record<string, unknown>)[k], into, seen);
}

/** 共享对象个数（0 = 返回值不持有档案里的任何引用） */
function sharedWithArchive(state: GameState, f: MatchFile): number {
  const archiveRefs = new Set<object>();
  collectObjects(f.actions, archiveRefs);
  const stateRefs = new Set<object>();
  collectObjects(state, stateRefs);
  return [...stateRefs].filter((o) => archiveRefs.has(o)).length;
}

/** 测试自己写的"逐步重放"（判据 1 的路径 B：循环写在测试里，不经过 `stateAtStep`） */
function replayStepByStep(f: MatchFile, n: number): GameState {
  const s = stateAfterDraft(f);
  for (let i = 0; i < n; i += 1) applyRecordedAction(s, f.actions[i]);
  return s;
}

/**
 * 判据 4 的**判别力测量器**：完全不深拷贝地逐 n 重放，返回"返回值与档案共享对象数"的最大值。
 *
 * 为什么要它（阶段一评审 N-2）：`normalizeAction` 那层拷贝在**值**上是恒等变换，指纹一字不变
 * ⇒ 判据 1/2 在结构上抓不住"到底拷没拷"，判据 4 是唯一能抓它的腿。而这条腿的判别力
 * **不是均匀分布**的：主档案（60 步）每一步都是 0，第二份档案（37 步）才有 1（出现在 n=36）。
 * 所以"主档案本身不含可共享对象"这句必须**写进腿里**（见判据 4 的第二条腿），
 * 否则将来夹具一改（步数 / 策略 / 引擎行为），判据 4 会悄悄退化成红不了也绿得没意义的空转。
 */
function maxSharedWithoutCopy(f: MatchFile): number {
  let max = 0;
  for (let n = 0; n <= f.actions.length; n += 1) {
    const s = stateAfterDraft(f);
    for (let i = 0; i < n; i += 1) applyRecordedAction(s, f.actions[i]); // 故意不深拷贝
    max = Math.max(max, sharedWithArchive(s, f));
  }
  return max;
}

/* ------------------------------------------------------------------ *
 * 判据 1（★ 差分腿）
 * ------------------------------------------------------------------ */

describe('T4 判据 1（★）：stateAtStep 与"逐步重放"逐字相等，且第 24 步之后仍不分叉', () => {
  it('★ 60 步档案：第 24 步两条路径指纹相等（且等于现场），24 之后各自走完仍相等', () => {
    const live = stepArchive();
    const f = live.file;

    // 反空转①：档案真的 60 步；且**分叉点之前**就含"持有控制组件时的重排"
    //   —— 否则 M1（`stateAtStep` 跳过 control 复原那一半）根本打不红这条腿，这条腿就是空的。
    expect(f.actions, '档案必须是 60 步').toHaveLength(STEP_COUNT);
    // 档案形状**写死当锚点**（实测值）：它把"报告里那几个指纹"钉在这份交付的夹具上，
    // 也顺带拦住"档案形状悄悄漂移、两条路径却仍然相等"这种一起漂的假绿。
    const hist: Record<string, number> = {};
    for (const a of f.actions) hist[a.kind] = (hist[a.kind] ?? 0) + 1;
    expect(hist, '档案的 kind 直方图').toEqual({
      advance: 45,
      play: 8,
      'rearrange-protocols': 4,
      'effect-choice': 2,
      compile: 1,
    });
    expect(live.rearrangeSeqs, '控制组件重排的下标').toEqual([14, 28, 42, 55]);
    expect(live.effectChoiceSeqs, 'effect-choice 的下标').toEqual([23, 31]);
    expect(live.rearrangeSeqs.length, '档案里必须真的走过控制组件重排').toBeGreaterThanOrEqual(2);
    const early = live.rearrangeSeqs.filter((q) => q < STEP_SPLIT);
    expect(early, `前 ${STEP_SPLIT} 步里的重排下标（实测：${JSON.stringify(live.rearrangeSeqs)}）`).not.toHaveLength(0);

    // 反空转②：承重前提 —— 那条重排**之前**控制组件确实在发起者手里。
    //   不成立的话"跳过复原"与"不跳过"逐字相同，这条腿的判别力就等于零。
    const firstRearrange = live.rearrangeSeqs[0];
    const beforeRearrange = stateAtStep(f, firstRearrange);
    const ra = f.actions[firstRearrange];
    expect(ra.kind).toBe('rearrange-protocols');
    expect(beforeRearrange.control, '重排前控制组件必须在发起者手里').toBe(ra.player);

    // 路径 A：库（stateAtStep）一步到第 24 步
    const a24 = stateAtStep(f, STEP_SPLIT);
    // 路径 B：测试自己写的逐步重放
    const b24 = replayStepByStep(f, STEP_SPLIT);
    expect(stateFingerprint(a24), '两条路径在第 24 步的指纹').toBe(stateFingerprint(b24));
    // 真值锚点：这一对指纹还等于**现场**（现场侧走 executeAction，不过任何助手）
    expect(stateFingerprint(a24), '第 24 步的指纹还必须等于现场').toBe(live.fpAfter[STEP_SPLIT]);

    // 再把第 24 步之后的行动在两条路径上各自走完（尾部两条路吃的是同一个操作序列，
    // 差别只在**前缀怎么到达第 24 步** —— 一条是库的循环，一条是测试的循环）
    for (let i = STEP_SPLIT; i < f.actions.length; i += 1) {
      applyRecordedAction(a24, f.actions[i]);
      applyRecordedAction(b24, f.actions[i]);
    }
    expect(stateFingerprint(a24), '尾部走完后两条路径仍必须相等').toBe(stateFingerprint(b24));
    expect(stateFingerprint(a24), '终局必须等于现场').toBe(stateFingerprint(live.s));
    expect(stateFingerprint(a24), '终局必须等于 stateAtStep(f, 全部)').toBe(
      stateFingerprint(stateAtStep(f, f.actions.length)),
    );
    // 反空转③：比的是"真走了 60 步"的状态，不是草稿态
    expect(stateFingerprint(a24)).not.toBe(stateFingerprint(stateAfterDraft(f)));
  });

  it('★ 对照：两条路径在**每一个** n 上都相等（只差一个 n 也会红，不是只比 24 这一个点）', () => {
    const f = stepArchive().file;
    for (let n = 0; n <= f.actions.length; n += 1) {
      expect(stateFingerprint(stateAtStep(f, n)), `n=${n}`).toBe(stateFingerprint(replayStepByStep(f, n)));
    }
  });
});

/* ------------------------------------------------------------------ *
 * 判据 2：n 的边界（0 / 终局 / 越界一律拒绝）
 * ------------------------------------------------------------------ */

describe('T4 判据 2：n 的边界', () => {
  it('n = 0 等于 stateAfterDraft(f)（逐字节），且真的在 turn 期', () => {
    const f = stepArchive().file;
    const s0 = stateAtStep(f, 0);
    expect(stateFingerprint(s0)).toBe(stateFingerprint(stateAfterDraft(f)));
    expect(s0.phase).toBe('turn');
    // 反空转：这条腿比的状态真的会被后续操作推动（否则"相等"可能来自两边都没动）
    expect(stateFingerprint(s0)).not.toBe(stateFingerprint(stateAtStep(f, 1)));
  });

  it('n = f.actions.length 是终局（等于现场、不等于倒数第二步）', () => {
    const live = stepArchive();
    const len = live.file.actions.length;
    const end = stateAtStep(live.file, len);
    expect(stateFingerprint(end)).toBe(stateFingerprint(live.s));
    expect(stateFingerprint(end)).not.toBe(stateFingerprint(stateAtStep(live.file, len - 1)));
  });

  it('越界一律**拒绝**（负数 / 超长 / 非整数 / NaN），消息可读且带那个 n', () => {
    const f = stepArchive().file;
    const tooLong = f.actions.length + 1;
    expect(() => stateAtStep(f, -1)).toThrow(/stateAtStep/);
    expect(() => stateAtStep(f, -1)).toThrow(/整数/);
    expect(() => stateAtStep(f, tooLong)).toThrow(/stateAtStep/);
    expect(() => stateAtStep(f, tooLong)).toThrow(new RegExp(String(tooLong)));
    expect(() => stateAtStep(f, tooLong)).toThrow(/超出档案长度/);
    expect(() => stateAtStep(f, 1.5)).toThrow(/整数/);
    expect(() => stateAtStep(f, Number.NaN)).toThrow(/整数/);
    // 正控：两个合法边界都不抛（证明上面不是"什么都抛"）
    expect(() => stateAtStep(f, 0)).not.toThrow();
    expect(() => stateAtStep(f, f.actions.length)).not.toThrow();
  });
});

/* ------------------------------------------------------------------ *
 * 判据 3：唯一出处（文本腿）
 * ------------------------------------------------------------------ */

/** 子串计数（不重叠） */
function countOf(hay: string, needle: string): number {
  let n = 0;
  let at = hay.indexOf(needle);
  while (at >= 0) {
    n += 1;
    at = hay.indexOf(needle, at + needle.length);
  }
  return n;
}

describe('T4 判据 3：match-replay.ts 里「ActionRecord → 引擎调用」只有一处', () => {
  /**
   * ★ **这条腿的能力边界，写死在这里**（阶段一评审 N-3 实测）：
   *
   * 它只扫 `src/app/match-replay.ts` **一个文件**（任务书 §3 判据 3 与 T4.md §3 就是这么规定的）。
   * 把同一份映射**搬到**别处（评审的 M7：搬进 `src/core/zz-mapping.ts`，语义逐字相同；
   * M7b：搬走且第二份漏掉「控制权归还」那一半）时实测：
   *  - M7：判据面只红这条腿，**行为腿一次都没红**；
   *  - M7b：判据面红 4 条（判据 1 两条 / 判据 2 一条 / 判据 3），因为语义真的被改坏了。
   *
   * ⇒ 本腿保证的是「**`match-replay.ts` 内**唯一出处」，**不保证全仓唯一**。
   * "别处另开一份语义相同的映射"这件事，今天唯一的拦路石就是这条文本腿，而它看不见别的文件；
   * 全仓口径的守卫不在本任务边界内（越界加全仓行为判据属 T5/T10）。
   * 顺带一条实测：`src/**` 里 `executeAction(` 今天只出现在 `src/core/game.ts`（声明与重载）
   * 与 `src/app/match-replay.ts`（8 处调用，全在 `applyRecordedAction` 体内）。
   */

  /** 正控：提取器与计数器对合成样本可用（否则下面全在空片段上恒真） */
  it('正控：functionBody / countOf 对合成样本给得出东西', () => {
    const sample = 'export function f(a: string): void {\n  if (a) { g(a); }\n}\n';
    expect(functionBody(sample, 'f')).toContain('g(a)');
    expect(countOf(sample, 'g(')).toBe(1);
    expect(() => functionBody(sample, '不存在')).toThrow(/找不到/);
  });

  it('所有 executeAction / 唯一那份 switch / 唯一那处还原规则，都落在 applyRecordedAction 体内', () => {
    const raw = readFileSync(fileURLToPath(new URL('../../src/app/match-replay.ts', import.meta.url)))
      .subarray(0, 4 * 1024 * 1024)
      .toString('utf8');
    const src = stripComments(raw);
    const applyBody = functionBody(src, 'applyRecordedAction');
    const stepBody = functionBody(src, 'stateAtStep');
    // 反空转：抽到的函数体必须真的是那两段（空片段会让下面每条断言恒真）
    expect(applyBody.length, 'applyRecordedAction 的函数体长度').toBeGreaterThan(500);
    expect(stepBody.length, 'stateAtStep 的函数体长度').toBeGreaterThan(200);

    // ① 引擎调用只有一处：全文件的 executeAction( 次数 == applyRecordedAction 体内的次数
    const engineCallsTotal = countOf(src, 'executeAction(');
    const engineCallsInApply = countOf(applyBody, 'executeAction(');
    expect(engineCallsInApply).toBeGreaterThan(0);
    expect(engineCallsTotal, 'match-replay.ts 里除了 applyRecordedAction 体内，别处不许再调引擎').toBe(engineCallsInApply);
    expect(countOf(stepBody, 'executeAction('), 'stateAtStep 里不许出现第二处引擎调用').toBe(0);

    // ② 分支只有一处 switch
    expect(countOf(src, 'switch ('), 'match-replay.ts 里只能有一个 switch').toBe(1);
    expect(countOf(applyBody, 'switch (')).toBe(1);
    expect(countOf(stepBody, 'switch ('), 'stateAtStep 里不许出现第二处 switch').toBe(0);

    // ③ stateAtStep 的映射来源就是那两个既有出口
    expect(countOf(stepBody, 'stateAfterDraft('), 'stateAtStep 必须从 stateAfterDraft 起跑').toBe(1);
    expect(countOf(stepBody, 'applyRecordedAction('), 'stateAtStep 必须逐条走 applyRecordedAction').toBe(1);

    // ④「控制权归还」还原规则也只有一处（M1 的靶子：它就是 applyRecordedAction 里那一半）
    expect(countOf(src, 'resetControlIfHeld(')).toBe(1);
    expect(countOf(applyBody, 'resetControlIfHeld(')).toBe(1);

    // ⑤ 生成式：case 标签集合 == 从 src/core/game.ts 派生的 ActionKind 集合
    //    （加一个 kind 或漏一个分支都会红 —— 手写清单做不到这一点）
    const kinds = actionKindsFromDisk();
    const cases = [...applyBody.matchAll(/case '([a-z-]+)'/g)].map((m) => m[1]);
    expect(new Set(cases), `case 标签：${cases.join(',')}`).toEqual(new Set(kinds));
    expect(cases).toHaveLength(kinds.length);
  });
});

/* ------------------------------------------------------------------ *
 * 判据 4：返回的状态不共享档案的引用
 * ------------------------------------------------------------------ */

describe('T4 判据 4：返回的状态是全新的', () => {
  /** 负控：**不深拷贝**就真的会共享 —— 这条证明下面那条断言有牙，而不是恒真 */
  it('负控：stateAtDraft + 裸 applyRecordedAction（不深拷贝）在"选择答到一半"处共享档案数组', () => {
    // 这一份档案的第 36 步落在"一个选择刚答完、另一个还挂着"的中途
    // （实测：该处 pendingEffects 有 2 个，其中一个的 lastAnswer.selected 就是档案里的那个数组）。
    const live = stepArchive('g5t4-diff-first-9', 37);
    const f = live.file;
    expect(f.actions.length).toBe(37);
    // 反空转：这一份档案里真的出现过"挂起效果带 lastAnswer"的中途状态（共享的成因）
    {
      const s = stateAfterDraft(f);
      for (let i = 0; i < 36; i += 1) applyRecordedAction(s, f.actions[i]); // 故意不深拷贝
      expect(s.pendingEffects.length, 'n=36 处必须挂着效果').toBeGreaterThan(1);
    }
    expect(maxSharedWithoutCopy(f), '不深拷贝时共享对象数').toBeGreaterThan(0);
  });

  it('stateAtStep 在**每一个** n 上都不与档案共享对象；改返回值不影响档案，也不影响另一次调用', () => {
    for (const seed of [STEP_SEED, 'g5t4-diff-first-9']) {
      const f = stepArchive(seed, seed === STEP_SEED ? STEP_COUNT : 37).file;
      for (let n = 0; n <= f.actions.length; n += 1) {
        expect(sharedWithArchive(stateAtStep(f, n), f), `${seed} n=${n} 与档案共享的对象数`).toBe(0);
      }
    }

    const f = stepArchive().file;
    // 反空转（阶段一评审 N-2）：**主档案本身不承重** —— 不做深拷贝时它 0..60 每一步都是 0 共享，
    // 判据 4 的判别力全在第二份档案（37 步，n=36）上。把这件事写进腿里：
    // 将来有人改夹具而忘了重估"判据 4 还抓不抓得住"时，这里会红给他看。
    expect(maxSharedWithoutCopy(f), '主档案本身不含可共享对象（maxShared 必须是 0）').toBe(0);
    // 正控：**同一段测量**在含共享的那份档案上必须 > 0 —— 否则上一句是恒真的空断言
    expect(
      maxSharedWithoutCopy(stepArchive('g5t4-diff-first-9', 37).file),
      '正控：含共享的档案上这段测量必须 > 0（证明它不是恒真）',
    ).toBeGreaterThan(0);

    const snapshot = JSON.stringify(f);
    const s1 = stateAtStep(f, STEP_SPLIT);
    const s2 = stateAtStep(f, STEP_SPLIT);
    expect(stateFingerprint(s1)).toBe(stateFingerprint(s2));
    // 深改返回值（含挂起效果与 log 这些最容易被共享的容器）
    s1.log.push('篡改');
    s1.players[0].hand.length = 0;
    s1.players[0].protocols[0] = { defId: 'zz-篡改', compiled: false };
    s1.control = 1;
    s1.pendingEffects.length = 0;
    expect(JSON.stringify(f), '改返回值不能改动档案').toBe(snapshot);
    expect(stateFingerprint(s2), '两次调用的返回值必须互不影响').toBe(stateFingerprint(stateAtStep(f, STEP_SPLIT)));
  });
});
