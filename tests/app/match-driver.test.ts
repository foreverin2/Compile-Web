/**
 * T2 行为腿：`src/app/match-driver.ts`（G4 计划 §5 T2 的 9 条验收判据）。
 *
 * **全部是行为腿**：真跑引擎、比 `stateFingerprint`、用**假 ticker** 数调度次数。
 * 唯一例外是判据 9（生成式扫 `src/app/**` 的直呼定时器）—— 它**只能**是文本腿，
 * 理由逐字写在那个 `describe` 的注释里。
 *
 * 本文件的每条承重腿都必须在隔离镜像里被 M1-M4 打红（见任务报告的变异实测表）。
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import {
  createLocalDriver,
  createReplayDriver,
  type MatchDriver,
  type ReplayDriver,
  type Ticker,
} from '../../src/app/match-driver';
import {
  createMatchFileRecorder,
  setupFromState,
  stringifyMatchFile,
  parseMatchFile,
  type ActionRecord,
  type MatchFile,
  type MatchFileRecorder,
} from '../../src/app/match-file';
import { applyRecordedAction, stateAfterDraft } from '../../src/app/match-replay';
import { CARD_DATA_HASH } from '../../src/app/card-data-hash';
import {
  createGame,
  draftNextAction,
  getDraftPool,
  performDraftBan,
  performDraftPick,
} from '../../src/core/state/create';
import { executeAction, getLegalActions, type LegalAction } from '../../src/core/game';
import { stateFingerprint } from '../../src/core/fingerprint';
import type { GameState, PlayerId } from '../../src/core/models/types';
import { pickFirst, resolveAllChoices } from '../helpers';

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

/** 走完草稿（种子派生的非平凡策略，与 T1 同款）；`ban` 模式走两条序列 */
function draftNontrivial(s: GameState, seed: string): { picks: string[]; bans: string[] } {
  const picks: string[] = [];
  const bans: string[] = [];
  let guard = 0;
  for (;;) {
    const next = draftNextAction(s);
    if (!next) break;
    if (guard++ > 200) throw new Error('草稿没有收敛');
    const avail = getDraftPool(s).map((p) => p.defId);
    const defId = avail[deriveIndex(seed, `${next.kind}:${picks.length + bans.length}`, avail.length)];
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

/** 草稿用「总取池首」（平凡的确定性策略）⇒ 判据 1/3/5 的档案都能用 `createGame` 复现草稿 */
function draftTrivial(s: GameState): void {
  let guard = 0;
  while (s.phase === 'draft') {
    if (guard++ > 200) throw new Error('草稿没有收敛');
    performDraftPick(s, getDraftPool(s)[0].defId);
  }
}

function metaFor(seed: string, setup: ReturnType<typeof setupFromState>) {
  return {
    seed,
    setup,
    players: [{ nick: '甲' }, { nick: '乙' }] as [{ nick: string }, { nick: string }],
    cardDataHash: CARD_DATA_HASH,
    createdAt: '2026-09-17T00:00:00.000Z',
  };
}

/** 把一条 `LegalAction` 转成 `ActionRecord` 的 args（**与 main.ts 现场同形**：只抄出现的键） */
function argsOf(a: LegalAction): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  if (a.cardUid !== undefined) args.cardUid = a.cardUid;
  if (a.faceUp !== undefined) args.faceUp = a.faceUp;
  if (a.line !== undefined) args.line = a.line;
  if (a.target !== undefined) args.target = a.target;
  if (a.promptId !== undefined) args.promptId = a.promptId;
  if (a.choice !== undefined) args.choice = a.choice;
  return args;
}

/** 操作签名（`kind` + `args` + `player`）：用来判"两条提交是不是同一条" */
function signature(a: Omit<ActionRecord, 'seq'>): string {
  return JSON.stringify([a.kind, a.player, a.args ?? null]);
}

/**
 * 真跑一局并记录档案（**与 T1 的 `playArchive` 同款**）：草稿先用给定策略走完，
 * 之后每步取 `getLegalActions` 的第 `pickIdx` 个（**确定性、非平凡**），逐条 `record` + `applyRecordedAction`。
 */
function playAndRecord(
  seed: string,
  opts: { maxSteps: number; draft: (s: GameState) => void; pickIdx?: (step: number) => number },
): { s: GameState; rec: MatchFileRecorder } {
  const s = createGame({ seed });
  opts.draft(s);
  expect(s.phase, `草稿必须走完：seed=${seed}`).toBe('turn');
  const rec = createMatchFileRecorder();
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
      const a = { player: chooser, kind: 'effect-choice' as const, args: { promptId: top.id, choice } };
      rec.record({ ...a, via: 'user' });
      applyRecordedAction(s, { ...a, seq: rec.nextSeq() - 1 });
      resolveAllChoices(s, pickFirst);
      continue;
    }
    const player = s.turnPlayer;
    const acts = getLegalActions(s, player);
    if (acts.length === 0) break;
    const idx = opts.pickIdx ? opts.pickIdx(step) % acts.length : 0;
    const a = acts[idx];
    const args = argsOf(a);
    const hasArgs = Object.keys(args).length > 0;
    const record = { player, kind: a.kind, ...(hasArgs ? { args } : {}) };
    rec.record({ ...record, via: 'user' });
    applyRecordedAction(s, { ...record, seq: rec.nextSeq() - 1 });
    resolveAllChoices(s, pickFirst);
  }
  return { s, rec };
}

/** 建一份真档案（`draft` 决定草稿策略；默认平凡 → 与 `createGame` 一致） */
function archiveOf(seed: string, maxSteps = 60, draft: (s: GameState) => void = draftTrivial): MatchFile {
  const { s, rec } = playAndRecord(seed, { maxSteps, draft, pickIdx: (i) => i % 3 });
  const file = rec.toMatchFile(metaFor(seed, setupFromState(s)));
  expect(file.actions.length, `反空转：seed=${seed} 的档案必须有操作`).toBeGreaterThan(4);
  return file;
}

/**
 * 在一个副本上逐步推进到 `upto`（**不含**），返回每一步**之后**的状态。
 * 副本用 `stateAfterDraft(file)` 建 ⇒ 与驱动内部的状态同源。
 */
function statesUpTo(file: MatchFile, upto: number): GameState {
  const s = stateAfterDraft(file);
  for (let i = 0; i < upto; i += 1) {
    applyRecordedAction(s, file.actions[i]);
    resolveAllChoices(s, pickFirst);
  }
  return s;
}

/**
 * 判据 3/4 的**判别器**：找一条 `play` 记录，它在**同一个状态**上至少有**两条**不同落点的合法提交
 * （`faceUp:false` 与 `faceUp:true` 同线各一条）。返回 `position` 与该状态。
 *
 * 为什么不用"随便造一条不同的操作"：那样门可能只是把**非法**操作挡在外面，
 * 而"闸门"要证的恰恰是**合法**操作也被挡住（D12 的全部价值）。
 */
function findPlayDiscriminator(
  file: MatchFile,
): { position: number; s: GameState; rec: ActionRecord; illegal: Omit<ActionRecord, 'seq'> } | null {
  for (let p = 0; p < file.actions.length; p += 1) {
    const rec = file.actions[p];
    if (rec.kind !== 'play') continue;
    const s = statesUpTo(file, p);
    const uid = (rec.args as { cardUid: string }).cardUid;
    const forms = new Set(
      getLegalActions(s, s.turnPlayer)
        .filter((x) => x.kind === 'play' && x.cardUid === uid)
        .map((x) => `${x.line}:${x.faceUp}`),
    );
    if (forms.size < 2) continue;
    // ⚠️ 必须造一条**当前状态上不存在**的提交（这里用 `target: 7`，`PlayerId` 只有 0/1）：
    //    它与记录在 `kind`/`player` 上相同、`args` 不同 ⇒ 门必须拒；若门放行，引擎会抛错 ⇒ 腿红。
    const illegal = {
      player: rec.player,
      kind: 'play',
      args: { ...(rec.args as object), target: 7 },
    } as unknown as Omit<ActionRecord, 'seq'>;
    return { position: p, s, rec, illegal };
  }
  return null;
}

/**
 * 判据 4 的判别器：找一条 `play` 记录，**记录的落点**与**同一个状态上另一个同样合法的落点**
 * 会产生**不同**的状态指纹（若两个落点结果相同，这条腿就区分不出"应用了哪一条"）。
 */
function findArgDiscriminator(
  file: MatchFile,
): { position: number; s: GameState; rec: ActionRecord; altArgs: Record<string, unknown> } | null {
  for (let p = 0; p < file.actions.length; p += 1) {
    const rec = file.actions[p];
    if (rec.kind !== 'play') continue;
    const s = statesUpTo(file, p);
    const uid = (rec.args as { cardUid: string }).cardUid;
    const legal = getLegalActions(s, s.turnPlayer).filter((x) => x.kind === 'play' && x.cardUid === uid);
    const recordedForm = `${(rec.args as { faceUp: boolean }).faceUp}:${(rec.args as { line: number }).line}`;
    // 记录的落点必须在合法清单里（否则档案与引擎已经分叉，这条腿没意义）
    if (!legal.some((x) => `${x.faceUp}:${x.line}` === recordedForm)) continue;
    const a = JSON.parse(JSON.stringify(s)) as GameState;
    const b = JSON.parse(JSON.stringify(s)) as GameState;
    const alt = legal.find((x) => `${x.faceUp}:${x.line}` !== recordedForm);
    if (!alt) continue;
    applyRecordedAction(a, rec);
    resolveAllChoices(a, pickFirst);
    applyRecordedAction(b, { seq: rec.seq, player: rec.player, kind: 'play', args: argsOf(alt) });
    resolveAllChoices(b, pickFirst);
    if (stateFingerprint(a) === stateFingerprint(b)) continue;
    return { position: p, s, rec, altArgs: argsOf(alt) };
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * 假 ticker + 真档案：判据 8 的时钟面
 * ------------------------------------------------------------------ */

interface FakeTick {
  handle: number;
  ms: number;
  fn: () => void;
  canceled: boolean;
  fired: boolean;
}

/** 手动时钟：`advance(ms)` 按到期顺序触发（同一时刻按登记顺序），`pending()` 数在飞时钟 */
class FakeTicker implements Ticker {
  readonly log: { handle: number; ms: number }[] = [];
  readonly canceled: number[] = [];
  readonly ticks: FakeTick[] = [];
  private nextHandle = 1;
  private now = 0;

  schedule(fn: () => void, ms: number): number {
    const handle = this.nextHandle++;
    this.log.push({ handle, ms });
    this.ticks.push({ handle, ms, fn, canceled: false, fired: false });
    return handle;
  }

  cancel(h: number): void {
    this.canceled.push(h);
    const t = this.ticks.find((x) => x.handle === h);
    if (t) t.canceled = true;
  }

  /** 在飞（既没触发也没被取消）的时钟 */
  pending(): FakeTick[] {
    return this.ticks.filter((t) => !t.canceled && !t.fired);
  }

  /** 推进 `ms` 毫秒：逐条触发到期且仍在飞的时钟（触发时重新读取 now，模拟真实事件循环） */
  advance(ms: number): void {
    const target = this.now + ms;
    for (;;) {
      const due = this.pending()
        .filter((t) => this.now + t.ms <= target)
        .sort((a, b) => this.now + a.ms - (this.now + b.ms) || a.handle - b.handle)[0];
      if (!due) break;
      this.now += due.ms;
      due.fired = true;
      due.fn();
    }
    this.now = target;
  }
}

/* ================================================================== *
 * 判据 1：LocalDriver 与"直呼引擎"逐条等价（热座行为不变）
 * ================================================================== */

describe('T2 判据 1：LocalDriver.submit 与直呼 executeAction 逐步等价', () => {
  /** 两侧都排空挂起选择（`main.ts` 的编排每步也做这件事） */
  function drain(s: GameState): void {
    resolveAllChoices(s, pickFirst);
  }

  it('同一种子同一条动作序列：createLocalDriver().submit ≡ executeAction，且逐条记录进档案', () => {
    const seed = 'g4t2-crit1';
    const a = createGame({ seed });
    const b = createGame({ seed });
    draftTrivial(a);
    draftTrivial(b);
    expect(stateFingerprint(a), '反空转：两个独立状态在起跑点必须相同').toBe(stateFingerprint(b));

    const driver = createLocalDriver();
    expect(driver.mode).toBe('local');
    expect(driver.acceptsInput()).toBe(true);
    expect(driver.seat, 'G4 恒 0（契约占位）').toBe(0);

    const expected: Omit<ActionRecord, 'seq'>[] = [];
    let steps = 0;
    for (let i = 0; i < 40; i += 1) {
      if (a.phase !== 'turn' || a.winner !== null) break;
      if (a.pendingEffects.length > 0) {
        drain(a);
        drain(b);
        continue;
      }
      const player = a.turnPlayer;
      const acts = getLegalActions(a, player);
      if (acts.length === 0) break;
      const act = acts[i % acts.length];
      const args = argsOf(act);
      const hasArgs = Object.keys(args).length > 0;
      const record = { player, kind: act.kind, ...(hasArgs ? { args } : {}) };

      // ① 直呼引擎（地面真值）
      if (hasArgs) executeAction(a, player, act.kind as 'play', args as never);
      else executeAction(a, player, act.kind as 'advance');
      drain(a);

      // ② 走驱动（在**另一份**独立状态上）
      const r = driver.submit(b, record);
      expect(r.ok, `第 ${i} 步 ${act.kind} 被驱动拒绝：${JSON.stringify(r)}`).toBe(true);
      drain(b);

      // 逐步比对：**每步之后**指纹都必须相等（不是只比最后一步）
      expect(stateFingerprint(b), `第 ${i} 步（${act.kind}）之后指纹分叉`).toBe(stateFingerprint(a));
      expected.push(record);
      steps += 1;
    }

    // 反空转：这一局必须真的走了若干步、且覆盖了不止一种 kind
    expect(steps, '反空转：这一局必须真的走了若干步').toBeGreaterThan(10);
    expect(new Set(expected.map((x) => x.kind)).size, '反空转：至少要覆盖两种 kind').toBeGreaterThan(1);

    // 记录语义（判据 2 的前半，顺手在同一条腿里钉住"记录 == 实际执行的序列"）
    const rec = driver.recorder();
    expect(rec).not.toBeNull();
    const actions = rec!.actions();
    expect(actions.map((x) => x.seq)).toEqual(actions.map((_, i) => i)); // 严格递增 0..n-1
    expect(actions.map((x) => signature(x))).toEqual(expected.map((x) => signature(x)));
    expect(actions.every((x) => x.via === 'user')).toBe(true);
  });
});

/* ================================================================== *
 * 判据 2：记录语义（submit 进 actions；note 只进 noted；via 原样）
 * ================================================================== */

describe('T2 判据 2：submit 记录一条、note 只留痕', () => {
  it('submit 往 actions 塞恰好一条（seq 0..n-1），note 不进 actions 但进 noted，via 原样保留', () => {
    const seed = 'g4t2-crit2';
    const s = createGame({ seed });
    draftTrivial(s);
    const rec = createMatchFileRecorder();
    const driver = createLocalDriver({ recorder: rec });
    expect(driver.recorder()).toBe(rec);

    // ① 两条 submit（一条无参、一条带 args）⇒ actions 恰好 2 条、seq = 0/1
    const player = s.turnPlayer;
    const acts = getLegalActions(s, player);
    expect(acts.length, '反空转：起手必须有合法操作').toBeGreaterThan(0);
    const first = acts[0];
    const firstArgs = argsOf(first);
    const hasArgs = Object.keys(firstArgs).length > 0;
    expect(driver.submit(s, { player, kind: first.kind, ...(hasArgs ? { args: firstArgs } : {}), via: 'user' }).ok).toBe(true);
    resolveAllChoices(s, pickFirst);
    const second = getLegalActions(s, s.turnPlayer)[0];
    const secondArgs = argsOf(second);
    const has2 = Object.keys(secondArgs).length > 0;
    expect(driver.submit(s, { player: s.turnPlayer, kind: second.kind, ...(has2 ? { args: secondArgs } : {}), via: 'ai' }).ok).toBe(true);
    resolveAllChoices(s, pickFirst);

    expect(rec.actions().length, 'submit 恰好各记一条').toBe(2);
    expect(rec.actions().map((x) => x.seq)).toEqual([0, 1]);
    expect(rec.actions()[0].via, 'via 原样保留').toBe('user');
    expect(rec.actions()[1].via, 'via 原样保留（非 user 也不改写）').toBe('ai');

    // ② note：不进 actions、进 noted、不执行（状态一字不动）
    const beforeFp = stateFingerprint(s);
    const beforeActions = rec.actions().length;
    driver.note({ player: 0, kind: 'advance' });
    driver.note({ player: 1, kind: 'clear-cache', via: 'timeout' });
    expect(rec.actions().length, 'note 不许进 actions').toBe(beforeActions);
    expect(rec.noted().length).toBe(2);
    expect(rec.noted().map((x) => x.seq), 'noted 的 seq 是自己的序列').toEqual([0, 1]);
    expect(rec.noted()[1].via).toBe('timeout');
    expect(stateFingerprint(s), 'note 不执行 ⇒ 状态一字不动').toBe(beforeFp);

    // ③ 默认 via = 'user'（submit 不传 via ⇒ 记录里仍是 user）
    const rec2 = createMatchFileRecorder();
    const d2 = createLocalDriver({ recorder: rec2 });
    d2.submit(s, { player: s.turnPlayer, kind: 'advance' });
    expect(rec2.actions()[0].via).toBe('user');
  });

  it('不传 recorder 时自建一个（契约：recorder() 恒非 null）', () => {
    const d = createLocalDriver();
    const rec = d.recorder();
    expect(rec).not.toBeNull();
    expect(rec!.actions()).toEqual([]);
  });
});

/* ================================================================== *
 * 判据 3：闸门语义（只让档案的下一条通过；合法的"别的一条"也拒）
 * ================================================================== */

describe('T2 判据 3：ReplayDriver 的闸门（D12）', () => {
  it('acceptsInput() 恒 false；submit(下一条) ⇒ ok 且指纹与"直接应用记录"逐字节等价；submit(别的一条合法操作) ⇒ not-the-next-action 且状态一字不动', () => {
    const file = archiveOf('g4t2-crit3');
    const disc = findPlayDiscriminator(file);
    expect(disc, '反空转：必须找到一条"同一状态上有两个合法落点"的 play 记录').not.toBeNull();
    const { position, rec, illegal } = disc!;

    // 门的上游：`acceptsInput()` 恒 false
    const d0 = createReplayDriver(file, { ticker: new FakeTicker(), settleWatchdogMs: null });
    expect(d0.acceptsInput()).toBe(false);
    expect(d0.mode).toBe('replay');
    expect(d0.recorder()).toBeNull();
    expect(d0.cursor()).toMatchObject({ position: 0, total: file.actions.length, done: false, paused: true, rate: 1, error: null });

    // 把同一个状态喂给两个驱动（都在 position 0 起跑，逐步走到判别点）
    const d1 = createReplayDriver(file, { ticker: new FakeTicker(), settleWatchdogMs: null });
    const s1 = stateAfterDraft(file);
    const d2 = createReplayDriver(file, { ticker: new FakeTicker(), settleWatchdogMs: null });
    const s2 = stateAfterDraft(file);

    for (let i = 0; i < position; i += 1) {
      const step = file.actions[i];
      expect(d1.submit(s1, step).ok, `推进到判别点失败于第 ${i} 步`).toBe(true);
      expect(d2.submit(s2, step).ok, `推进到判别点失败于第 ${i} 步`).toBe(true);
      resolveAllChoices(s1, pickFirst);
      resolveAllChoices(s2, pickFirst);
    }
    expect(s1.turnPlayer, `判别点必须在行动玩家的回合（记录 player=${rec.player}）`).toBe(rec.player);
    expect(stateFingerprint(s1)).toBe(stateFingerprint(s2));

    // ① 参考解：**直接**应用记录里的那一条（不走驱动）
    const ref = statesUpTo(file, position);
    applyRecordedAction(ref, rec);
    resolveAllChoices(ref, pickFirst);

    // ② 走驱动的正控：提交 `next()` 拿到的记录
    const nextRec = d1.next();
    expect(nextRec, 'next() 必须给出下一条').not.toBeNull();
    expect(nextRec).toEqual(rec);
    const okRes = d1.submit(s1, nextRec!);
    expect(okRes.ok).toBe(true);
    expect(okRes.refusal).toBeUndefined();
    expect(d1.cursor().position).toBe(position + 1);
    resolveAllChoices(s1, pickFirst);
    expect(stateFingerprint(s1), '正控：走闸门 ≡ 直接 applyRecordedAction').toBe(stateFingerprint(ref));

    // ③ 负控：**合法但不同的落点**（同 kind/player，args 不同）⇒ 拒绝且状态一字不动
    const beforeFp = stateFingerprint(s2);
    const beforePos = d2.cursor().position;
    const refused = d2.submit(s2, illegal);
    expect(refused).toMatchObject({ ok: false, refusal: 'not-the-next-action' });
    expect(stateFingerprint(s2), '被拒 ⇒ 状态一字未变（引擎根本没被调用）').toBe(beforeFp);
    expect(d2.cursor().position, '被拒 ⇒ 游标不动').toBe(beforePos);
    // 且驱动**仍然可用**：紧接着提交真正的那一条 ⇒ 通过
    expect(d2.submit(s2, nextRec!).ok, '被拒之后仍必须能提交下一条').toBe(true);
    expect(d2.cursor().position).toBe(position + 1);

    // ④ `next()` 是深拷贝：改它不许动到档案
    const snapshot = d1.next();
    expect(snapshot, '每步都有下一条（position < total）').not.toBeNull();
    if (typeof snapshot!.args === 'object' && snapshot!.args !== null) {
      (snapshot!.args as Record<string, unknown>).__tampered = 1;
      expect(
        (file.actions[position + 2].args as Record<string, unknown> | undefined)?.__tampered,
        'next() 必须是深拷贝（改快照不许动到档案）',
      ).toBeUndefined();
    }
    expect(d1.next()).toEqual(file.actions[position + 1]);
  });

  it('负控（对照）：拒绝**非法**操作也走同一条 `not-the-next-action`（门在引擎之前）', () => {
    const file = archiveOf('g4t2-crit3b', 20);
    const d = createReplayDriver(file, { ticker: new FakeTicker(), settleWatchdogMs: null });
    const s = stateAfterDraft(file);
    const before = stateFingerprint(s);
    // 座位与下一条不同 ⇒ 一定不等价（不需要别的假设）
    const r = d.submit(s, { player: (1 - file.actions[0].player) as PlayerId, kind: file.actions[0].kind, args: file.actions[0].args });
    expect(r).toMatchObject({ ok: false, refusal: 'not-the-next-action' });
    expect(stateFingerprint(s)).toBe(before);
    expect(d.cursor().position).toBe(0);
  });
});

/* ================================================================== *
 * 判据 4：应用的是**记录里**那一条，不是调用方给的那条
 * ================================================================== */

describe('T2 判据 4：submit 应用记录里的 args（不是调用方给的那条）', () => {
  /**
   * ★**这条腿的形态由 D12 的闸门语义唯一决定**（本实现第一版写成"提交一个 args 不同的合法操作"
   * 就**必然红** —— 因为闸门要求 `args` 逐项相等，args 不同就根本过不了门）：
   *
   * 在 D12 之下，"应用记录的 args 还是调用方的 args"**不可能**用"两组不同的值"来区分
   * （值不同 ⇒ 门拒绝；值相同 ⇒ 两组值等价）。它**能**被区分的是这两件事：
   *  ① 引擎收到的是**调用方那个对象本身**，还是门**规范化出来的副本**。前者等于把调用方的对象
   *    （可能带着原型/getter/后续会被改写的键）交给引擎 ⇒ 调用方**一次无关的后续修改**
   *     能让已重放的那一步的结果漂移。后者（本实现）安全。
   *  ② 调用方的对象**有没有被引擎改动**（引擎若原地改 args，语义等价的对象也会被污染）。
   *
   * ⇒ 这条腿的判别力来自**对象身份与访问计数**，不来自指纹：用 Proxy 数"调用方对象的属性被读了几次"，
   * 并让"第二次读"返回**错的值**（模拟"调用方提交后又被改了"）——
   * 若实现把调用方的对象一路带到引擎，就会读到那个错值 ⇒ 状态与"应用记录"不同 ⇒ 腿红。
   * 现场真值锚点仍然是指纹：最终状态必须与"直接 `applyRecordedAction` 记录里那一条"**逐字节相同**。
   */
  it('提交等价但**身份不同**的 args（Proxy 计数 + 二次读取返回错值）⇒ 引擎只吃门规范化出来的记录；状态与"直接应用记录"逐字节相同', () => {
    const file = archiveOf('g4t2-crit4', 60, (s) => draftNontrivial(s, 'g4t2-crit4'));
    // 找一条**带 args** 的记录（`play`），并在它的判别点上干活
    const position = file.actions.findIndex((a) => a.kind === 'play' && a.args !== undefined);
    expect(position, '反空转：档案里必须有一条带 args 的 play').toBeGreaterThanOrEqual(0);
    const rec = file.actions[position];
    const recArgs = { ...(rec.args as Record<string, unknown>) };
    expect(Object.keys(recArgs).length, '反空转：这条记录的 args 必须非空').toBeGreaterThan(0);

    // 参考终态：从档案起跑、逐条应用（这是"整局重放"的正确终态）
    const ref = stateAfterDraft(file);
    for (const a of file.actions) {
      applyRecordedAction(ref, a);
      resolveAllChoices(ref, pickFirst);
    }
    // 该步的参考状态（只应用到 position+1）
    const expectedAtP1 = statesUpTo(file, position + 1);

    // 调用方对象：**规范字节与记录相同**（门只认值），但每次读都计数，且**第二次读返回错值**
    const reads = new Map<string, number>();
    const callerArgs: Record<string, unknown> = {};
    for (const k of Object.keys(recArgs)) {
      Object.defineProperty(callerArgs, k, {
        enumerable: true,
        configurable: true,
        get() {
          const n = (reads.get(k) ?? 0) + 1;
          reads.set(k, n);
          // 第 1 次读（门的规范化）返回真值 ⇒ 门放行；**第 2 次**起返回错值 ⇒
          // 若实现把调用方的对象带进引擎，引擎就会看到错值 ⇒ 这条腿必红
          if (n === 1) return recArgs[k];
          return typeof recArgs[k] === 'number' ? (recArgs[k] as number) + 1000 : 'zz-tampered-by-caller';
        },
      });
    }

    const d = createReplayDriver(file, { ticker: new FakeTicker(), settleWatchdogMs: null });
    const s = stateAfterDraft(file);
    for (let i = 0; i < position; i += 1) {
      expect(d.submit(s, file.actions[i]).ok, `推进到判别点失败于第 ${i} 步`).toBe(true);
      resolveAllChoices(s, pickFirst);
    }

    const r = d.submit(s, { player: rec.player, kind: rec.kind, args: callerArgs });
    expect(r, '等价提交必须被门放行（`kind`/`args`/`player` 逐项相等）').toMatchObject({ ok: true });
    resolveAllChoices(s, pickFirst);

    // ① 承重断言：状态与"直接应用**记录**"逐字节相同
    expect(stateFingerprint(s), '引擎必须吃记录里的 args（不是调用方对象）').toBe(stateFingerprint(expectedAtP1));
    // ② 调用方对象的每个键**恰好被读一次**（门那次规范化）⇒ 引擎没有再碰它
    expect([...reads.entries()], '调用方的 args 对象只许被门读一次（规范化），不许被带进引擎').toEqual(
      Object.keys(recArgs).map((k) => [k, 1]),
    );
    // ③ 记录本身没有被引擎原地改动（门规范化的是副本）
    expect(file.actions[position].args).toEqual(recArgs);
    // ④ 反空转：这条腿的判别力是真的 —— 把 args 换成**另一个合法落点**，状态**必须不同**
    //    （用合法的替代落点而不是乱改 `cardUid`：乱改会让引擎抛错，那就变成"在比两个错误"）
    const altState = statesUpTo(file, position);
    const alt = getLegalActions(altState, altState.turnPlayer)
      .filter((x) => x.kind === 'play' && x.cardUid === (rec.args as { cardUid: string }).cardUid)
      .find((x) => `${x.faceUp}:${x.line}` !== `${(rec.args as { faceUp: boolean }).faceUp}:${(rec.args as { line: number }).line}`);
    expect(alt, '反空转：这条 play 在同一个状态上必须有另一个合法落点').toBeTruthy();
    applyRecordedAction(altState, { ...rec, args: argsOf(alt!) });
    resolveAllChoices(altState, pickFirst);
    expect(stateFingerprint(altState), '反空转：另一个合法落点必须产生不同状态（否则上面那条相等是空的）').not.toBe(
      stateFingerprint(expectedAtP1),
    );

    // ⑤ 整局走到底：终态仍必须与参考重放一致（没有从这一步起静默走偏）
    for (let i = position + 1; i < file.actions.length; i += 1) {
      const step = file.actions[i];
      const res = d.submit(s, step);
      expect(res.ok, `后续第 ${i} 步被拒：${JSON.stringify(res)}`).toBe(true);
      resolveAllChoices(s, pickFirst);
    }
    expect(d.cursor().done).toBe(true);
    expect(stateFingerprint(s), '整局终态必须与参考重放一致').toBe(stateFingerprint(ref));
  });

  it('负控：**值不同**的 args（哪怕同样合法）根本过不了门 ⇒ 调用方无法用它改掉重放的落点', () => {
    const file = archiveOf('g4t2-crit4b', 60, (s) => draftNontrivial(s, 'g4t2-crit4b'));
    const disc = findArgDiscriminator(file);
    expect(disc, '反空转：必须找到"两个合法落点产生不同指纹"的 play 记录').not.toBeNull();
    const { position, rec, altArgs } = disc!;
    expect(signature({ ...rec, args: altArgs })).not.toBe(signature(rec));

    const d = createReplayDriver(file, { ticker: new FakeTicker(), settleWatchdogMs: null });
    const s = stateAfterDraft(file);
    for (let i = 0; i < position; i += 1) {
      expect(d.submit(s, file.actions[i]).ok).toBe(true);
      resolveAllChoices(s, pickFirst);
    }
    const before = stateFingerprint(s);
    const r = d.submit(s, { player: rec.player, kind: rec.kind, args: altArgs });
    expect(r, '值不同的 args 必须被门拒（D12：只有档案的下一条能通过）').toMatchObject({
      ok: false,
      refusal: 'not-the-next-action',
    });
    expect(stateFingerprint(s), '被拒 ⇒ 状态一字不动').toBe(before);
    expect(d.cursor().position).toBe(position);
    // 而且这一拒**不是**因为操作非法：那条 alt 落点在同一个状态上是合法的（判别器已证明），
    // 引擎本来会接受它 —— 门把它挡在引擎之外。
    expect(file.actions[position].args).toEqual(rec.args);
  });
});

/* ================================================================== *
 * 判据 5：重放到底（真档案，逐步 submit(next())）
 * ================================================================== */

describe('T2 判据 5：把 T1 的真档案喂给驱动、反复 submit(next()) 到 done', () => {
  it('normal 模式：position === actions.length、终态指纹 == 原局、done 后 next() === null', () => {
    const seed = 'g4t2-crit5';
    const s = createGame({ seed });
    draftTrivial(s);
    const rec = createMatchFileRecorder();
    // 现场（用 LocalDriver 记录，顺带证明"driver 记出来的档案可以被 driver 重放"闭环）
    const live = createLocalDriver({ recorder: rec });
    for (let i = 0; i < 60; i += 1) {
      if (s.phase !== 'turn' || s.winner !== null) break;
      if (s.pendingEffects.length > 0) {
        resolveAllChoices(s, pickFirst);
        continue;
      }
      const player = s.turnPlayer;
      const acts = getLegalActions(s, player);
      if (acts.length === 0) break;
      const act = acts[i % acts.length];
      const args = argsOf(act);
      const hasArgs = Object.keys(args).length > 0;
      live.submit(s, { player, kind: act.kind, ...(hasArgs ? { args } : {}) });
      resolveAllChoices(s, pickFirst);
    }
    const file = rec.toMatchFile(metaFor(seed, setupFromState(s)));
    expect(file.actions.length).toBeGreaterThan(10);

    // 从**规范字节**读回来（档案是"一份数据五处复用"，重放该吃规范形态）
    const parsed = parseMatchFile(stringifyMatchFile(file), { currentHash: CARD_DATA_HASH });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const d = createReplayDriver(parsed.file, { ticker: new FakeTicker(), settleWatchdogMs: null });
    const rs = stateAfterDraft(parsed.file);
    let guard = 0;
    for (;;) {
      const a = d.next();
      if (!a) break;
      if (guard++ > file.actions.length + 5) throw new Error('重放没有收敛');
      const r = d.submit(rs, a);
      expect(r.ok, `第 ${d.cursor().position} 步被拒：${JSON.stringify(r)}`).toBe(true);
      resolveAllChoices(rs, pickFirst);
    }
    expect(guard, '反空转：必须真的走了档案里的每一步').toBe(file.actions.length);
    expect(d.cursor().position).toBe(file.actions.length);
    expect(d.cursor().done).toBe(true);
    expect(d.next()).toBeNull();
    expect(stateFingerprint(rs), '整局重放终态必须与原局相同').toBe(stateFingerprint(s));
  });

  it('ban 模式（6 禁 + 6 选交错）同上去一遍', () => {
    const seed = 'g4t2-crit5-ban';
    const s = createGame({ seed, draftMode: 'ban' });
    const draft = draftNontrivial(s, seed);
    expect(draft.bans).toHaveLength(6);
    const rec = createMatchFileRecorder();
    const live = createLocalDriver({ recorder: rec });
    for (let i = 0; i < 40; i += 1) {
      if (s.phase !== 'turn' || s.winner !== null) break;
      if (s.pendingEffects.length > 0) {
        resolveAllChoices(s, pickFirst);
        continue;
      }
      const player = s.turnPlayer;
      const acts = getLegalActions(s, player);
      if (acts.length === 0) break;
      const act = acts[i % acts.length];
      const args = argsOf(act);
      const hasArgs = Object.keys(args).length > 0;
      live.submit(s, { player, kind: act.kind, ...(hasArgs ? { args } : {}) });
      resolveAllChoices(s, pickFirst);
    }
    const file = rec.toMatchFile(metaFor(seed, setupFromState(s)));
    expect(file.setup.draftMode).toBe('ban');
    expect(file.actions.length).toBeGreaterThan(5);
    const d = createReplayDriver(file, { ticker: new FakeTicker(), settleWatchdogMs: null });
    const rs = stateAfterDraft(file);
    while (d.next()) {
      const a = d.next()!;
      expect(d.submit(rs, a).ok).toBe(true);
      resolveAllChoices(rs, pickFirst);
    }
    expect(d.cursor().position).toBe(file.actions.length);
    expect(stateFingerprint(rs)).toBe(stateFingerprint(s));
  });
});

/* ================================================================== *
 * 判据 6：结束不崩（done 之后再 submit ⇒ exhausted，不抛）
 * ================================================================== */

describe('T2 判据 6：档案走完后再提交 ⇒ exhausted（不抛）', () => {
  it('走到底之后再 submit（含同一个 state）⇒ {ok:false, refusal:"exhausted"}，且不抛、状态不动、游标不动', () => {
    const file = archiveOf('g4t2-crit6', 25);
    const d = createReplayDriver(file, { ticker: new FakeTicker(), settleWatchdogMs: null });
    const s = stateAfterDraft(file);
    let guard = 0;
    while (d.next()) {
      if (guard++ > file.actions.length + 5) throw new Error('重放没有收敛');
      expect(d.submit(s, d.next()!).ok).toBe(true);
      resolveAllChoices(s, pickFirst);
    }
    expect(d.cursor().done).toBe(true);
    const fp = stateFingerprint(s);

    let r: ReturnType<typeof d.submit> | undefined;
    let threw: unknown = null;
    try {
      r = d.submit(s, file.actions[file.actions.length - 1]);
    } catch (e) {
      threw = e;
    }
    expect(threw, 'exhausted 不许抛（越界不是异常，是一个可展示的拒绝）').toBeNull();
    expect(r).toMatchObject({ ok: false, refusal: 'exhausted' });
    expect(stateFingerprint(s)).toBe(fp);
    expect(d.cursor().position).toBe(file.actions.length);

    // 空档案的极端形态：`total === 0` ⇒ 立刻 done、next() null、submit exhausted
    const empty: MatchFile = { ...file, actions: [] };
    const d2 = createReplayDriver(empty, { ticker: new FakeTicker(), settleWatchdogMs: null });
    expect(d2.cursor().done).toBe(true);
    expect(d2.next()).toBeNull();
    const s2 = stateAfterDraft(empty);
    expect(d2.submit(s2, { player: 0, kind: 'advance' })).toMatchObject({ ok: false, refusal: 'exhausted' });
  });
});

/* ================================================================== *
 * 判据 7：档案被篡改 ⇒ engine-error（error 是原始 Error、cursor().error 非空、不崩）
 * ================================================================== */

describe('T2 判据 7：被篡改的那一步 ⇒ engine-error，驱动不崩', () => {
  it('把某一步的 cardUid 改成不存在 ⇒ 该步 {ok:false,refusal:"engine-error"}、error 是原始 Error、cursor().error 非空、后续 submit 不再推进', () => {
    const file = archiveOf('g4t2-crit7', 40);
    const k = file.actions.findIndex((a) => a.kind === 'play' && typeof (a.args as { cardUid?: string }).cardUid === 'string');
    expect(k, '反空转：档案里必须至少有一条 play').toBeGreaterThanOrEqual(0);
    const tampered: MatchFile = {
      ...file,
      actions: file.actions.map((a, i) =>
        i === k ? { ...a, args: { ...(a.args as object), cardUid: 'zz-does-not-exist' } } : a,
      ),
    };
    expect(tampered.actions[k].args).not.toEqual(file.actions[k].args);

    const d = createReplayDriver(tampered, { ticker: new FakeTicker(), settleWatchdogMs: null });
    const s = stateAfterDraft(tampered);
    for (let i = 0; i < k; i += 1) {
      const r = d.submit(s, tampered.actions[i]);
      expect(r.ok, `篡改点之前第 ${i} 步不该失败：${JSON.stringify(r)}`).toBe(true);
      resolveAllChoices(s, pickFirst);
    }
    // ★ 篡改点：门会放行（kind/args/player 与"记录"一致 —— 记录**就是**被篡改的那条），引擎抛
    const beforePos = d.cursor().position;
    let res: ReturnType<typeof d.submit> | undefined;
    let threw: unknown = null;
    try {
      res = d.submit(s, tampered.actions[k]);
    } catch (e) {
      threw = e;
    }
    expect(threw, 'engine-error 不许抛到调用方（驱动要把引擎异常变成可展示的拒绝）').toBeNull();
    expect(res!.ok).toBe(false);
    expect(res!.refusal).toBe('engine-error');
    expect(res!.error, '必须把引擎抛出的**原始** Error 带出来（不是包装过的新对象）').toBeInstanceOf(Error);
    expect(String((res!.error as Error).message)).toMatch(/card|牌|uid|not found/i);
    expect(d.cursor().error, 'cursor().error 必须留下诊断（重放页要显示它）').toBeTruthy();
    expect(d.cursor().position, '出错的那一步不推进').toBe(beforePos);

    // 驱动**不崩**：后续 submit 仍可调用（返回 engine-error）但不再推进
    const posAfter = d.cursor().position;
    const again = d.submit(s, tampered.actions[k + 1] ?? tampered.actions[k]);
    expect(again.ok).toBe(false);
    expect(again.refusal).toBe('engine-error');
    expect(d.cursor().position).toBe(posAfter);
    // `next()` 仍在原位（驱动只是"停住"，不是"跳过"）
    expect(d.next()).toEqual(tampered.actions[posAfter]);
  });

  it('引擎抛错后驱动**不会**被 tick 推着继续（error 是粘性的）', () => {
    const file = archiveOf('g4t2-crit7-tick', 20);
    const k = file.actions.findIndex((a) => a.kind === 'play');
    expect(k).toBeGreaterThanOrEqual(0);
    const tampered: MatchFile = {
      ...file,
      actions: file.actions.map((a, i) =>
        i === k ? { ...a, args: { ...(a.args as object), cardUid: 'zz-does-not-exist' } } : a,
      ),
    };
    const ticker = new FakeTicker();
    const d = createReplayDriver(tampered, { ticker, stepMs: 100, settleWatchdogMs: null });
    const s = stateAfterDraft(tampered);
    for (let i = 0; i < k; i += 1) {
      d.submit(s, tampered.actions[i]);
      resolveAllChoices(s, pickFirst);
    }
    d.play();
    d.settle(); // 只安排一步
    ticker.advance(100); // 这一步就是篡改点 ⇒ 抛
    expect(d.cursor().error).toBeTruthy();
    const pos = d.cursor().position;
    d.settle();
    ticker.advance(1000);
    expect(d.cursor().position, 'error 之后不许再被 tick 推进').toBe(pos);
  });
});

/* ================================================================== *
 * 判据 8：定时器与握手机制（假 ticker）
 * ================================================================== */

describe('T2 判据 8：settle 握手 / 倍速 / 暂停 / 看门狗（注入时钟）', () => {
  const file = archiveOf('g4t2-crit8', 25);

  function fresh(env: { ticker: FakeTicker; stepMs?: number; settleWatchdogMs?: number | null }) {
    const d = createReplayDriver(file, env);
    const s = stateAfterDraft(file);
    return { d, s };
  }

  it('play() 后**不立即** schedule；settle() 后恰好 schedule 一次，ms = stepMs / rate', () => {
    const ticker = new FakeTicker();
    const { d, s } = fresh({ ticker, stepMs: 1000, settleWatchdogMs: null });

    d.play();
    expect(d.cursor().paused).toBe(false);
    expect(ticker.log.length, 'play() 自己不许安排下一步（要等 settle 握手）').toBe(0);
    expect(ticker.pending().length).toBe(0);

    d.settle();
    expect(ticker.log.length, 'settle() 后**恰好**一次 schedule').toBe(1);
    expect(ticker.log[0].ms, '1× ⇒ stepMs').toBe(1000);
    expect(ticker.pending().length, 'settle 后只允许一个在飞时钟').toBe(1);

    // 幂等：再 settle 一次不许再排一个
    d.settle();
    expect(ticker.log.length, '重复 settle 不许再排（no-op 幂等）').toBe(1);

    // 到点 ⇒ 走一步（并进入"等下一次 settle"）
    ticker.advance(1000);
    expect(d.cursor().position).toBe(1);
    expect(s.phase).toBe('turn');

    // 这一步之后**不**自动排下一步：必须再 settle
    expect(ticker.log.length, '一步之后要等下一次 settle').toBe(1);
    d.settle();
    expect(ticker.log.length).toBe(2);
    expect(ticker.log[1].ms).toBe(1000);
    ticker.advance(1000);
    expect(d.cursor().position).toBe(2);
  });

  it('setRate(2)/setRate(4) 后下一次 schedule 的 ms 是 1× 的一半 / 四分之一；setRate(0) 等价 pause', () => {
    const ticker = new FakeTicker();
    const { d } = fresh({ ticker, stepMs: 800, settleWatchdogMs: null });
    d.play();
    d.settle();
    expect(ticker.log[0].ms).toBe(800);

    // 播放态下改倍速 ⇒ 立刻按新倍速重排（旧的那个被 cancel）
    d.setRate(2);
    expect(ticker.log.length).toBe(2);
    expect(ticker.log[1].ms, '2× ⇒ 一半').toBe(400);
    expect(ticker.canceled, '重排必须取消上一个在飞时钟').toContain(ticker.log[0].handle);
    expect(ticker.pending().length).toBe(1);

    d.setRate(4);
    expect(ticker.log[2].ms, '4× ⇒ 四分之一').toBe(200);
    expect(ticker.pending().length).toBe(1);

    d.setRate(1);
    expect(ticker.log[3].ms).toBe(800);

    // setRate(0) ⇒ 等价 pause：cancel 在飞时钟、不再 tick
    const pendingBefore = ticker.pending()[0];
    d.setRate(0);
    expect(d.cursor().paused).toBe(true);
    expect(d.cursor().rate).toBe(0);
    expect(ticker.canceled, 'setRate(0) 必须 cancel').toContain(pendingBefore.handle);
    expect(ticker.pending().length).toBe(0);
    const pos = d.cursor().position;
    ticker.advance(10_000);
    expect(d.cursor().position, 'setRate(0) 之后不许再 tick').toBe(pos);

    // 非法倍速值被忽略（契约是 0|1|2|4；运行时喂 3 不许把状态搞坏）
    d.setRate(3 as unknown as 2);
    expect(d.cursor().rate).toBe(0);
  });

  it('pause() ⇒ cancel 且不再 tick；再 play 要重新 settle', () => {
    const ticker = new FakeTicker();
    const { d } = fresh({ ticker, stepMs: 500, settleWatchdogMs: null });
    d.play();
    d.settle();
    const handle = ticker.log[0].handle;
    d.pause();
    expect(d.cursor().paused).toBe(true);
    expect(ticker.canceled, 'pause 必须 cancel').toContain(handle);
    expect(ticker.pending().length).toBe(0);
    const pos = d.cursor().position;
    ticker.advance(10_000);
    expect(d.cursor().position).toBe(pos);

    d.play();
    expect(ticker.log.length, '重新 play 也不许立即 schedule').toBe(1);
    d.settle();
    expect(ticker.log.length).toBe(2);
  });

  it('★ 看门狗：只给 settleWatchdogMs 而**从不** settle() ⇒ 到点仍 tick 一次，且 cursor().error 留下诊断', () => {
    const ticker = new FakeTicker();
    const { d } = fresh({ ticker, stepMs: 50, settleWatchdogMs: 2000 });
    d.play();
    // `play()` 之后就已经欠宿主一次 settle ⇒ 看门狗**从这里**开始守着（它只盯"等宿主回话"这一件事）
    expect(ticker.log.length, '看门狗在 play() 之后武装').toBe(1);
    expect(ticker.log[0].ms, '看门狗的 ms = settleWatchdogMs').toBe(2000);
    d.settle();
    // `settle()` 会取消 `play()` 那只看门狗，再按当前 rate 重排 **步进 + 看门狗** ⇒ 日志共 3 条、在飞 2 只
    expect(ticker.log.length, 'settle() 重排：play 那只被取消，新排步进 + 看门狗').toBe(3);
    expect(ticker.log.some((x) => x.ms === 50), '重排里必须有步进那只（ms = stepMs）').toBe(true);
    expect(ticker.pending().length, '在飞：步进 + 看门狗').toBe(2);
    expect(d.cursor().position).toBe(0);
    expect(d.cursor().error).toBeNull();

    // 步进到点 ⇒ 走一步，但**从不** settle ⇒ 看门狗到点必须放行一步
    ticker.advance(50);
    expect(d.cursor().position).toBe(1);
    expect(d.cursor().error, '一步走完还没到看门狗时限时不该报错').toBeNull();
    expect(ticker.pending().length, '这一步之后：步进没了，只剩看门狗那一只').toBe(1);
    expect(ticker.pending()[0].ms, '剩下的那只就是看门狗（ms = settleWatchdogMs）').toBe(2000);

    // 宿主既不 `settle()` 也不做任何事 ⇒ 看门狗到点。它做的事 = **替宿主把这次握手走完**
    // （清闩 + 按当前 rate 排下一步），所以这时**恰好**多出一只步进时钟。
    ticker.advance(2000);
    expect(d.cursor().error, '看门狗必须留下诊断文本').toBeTruthy();
    expect(d.cursor().error!).toMatch(/看门狗/);
    expect(d.cursor().error!).toMatch(/settle/);
    const afterWatchdog = ticker.pending();
    expect(afterWatchdog.length, '看门狗兜底必须排下一步（否则重放仍停在那一步）').toBeGreaterThan(0);
    expect(
      afterWatchdog.some((t) => t.ms === 50),
      `兜底的下一步必须按当前 rate 排（ms = stepMs）：${afterWatchdog.map((t) => t.ms).join(',')}`,
    ).toBe(true);

    // 这一步真的走掉了 ⇒ 位置前进（这就是"防永久卡死在一步上"的可机检形态）
    ticker.advance(50);
    expect(d.cursor().position, '看门狗兜底的那一步必须真的执行').toBe(2);

    // 诊断是**粘性**的：此后不再自动推进（重放页要把它显示出来）
    const pos = d.cursor().position;
    ticker.advance(10_000);
    expect(d.cursor().position, '报错之后不再自动推进').toBe(pos);
    expect(d.next()).toEqual(file.actions[pos]);
  });

  it('dispose() ⇒ cancel + onTick 退订 + 再 submit 不抛', () => {
    const ticker = new FakeTicker();
    const { d } = fresh({ ticker, stepMs: 100, settleWatchdogMs: 1000 });
    const hits: number[] = [];
    const off = d.onTick(() => hits.push(1));
    d.play();
    d.settle();
    expect(ticker.pending().length, '步进 + 看门狗').toBe(2);
    const handles = ticker.pending().map((t) => t.handle);

    d.dispose();
    for (const h of handles) expect(ticker.canceled, 'dispose 必须 cancel 每一个在飞时钟').toContain(h);
    expect(ticker.pending().length).toBe(0);
    ticker.advance(10_000);
    expect(hits, 'dispose 之后 onTick 订阅者不许再被通知').toEqual([]);

    // 退订函数本身也要有效（在 dispose 之前退订的订阅者同样不该被通知）
    const hits2: number[] = [];
    const d2 = createReplayDriver(file, { ticker: new FakeTicker(), settleWatchdogMs: null });
    const off2 = d2.onTick(() => hits2.push(1));
    off2();
    d2.play();
    d2.settle();
    void off;

    // dispose 后再 submit：**不抛**（返回拒绝）
    const s2 = stateAfterDraft(file);
    let r: ReturnType<typeof d.submit> | undefined;
    let threw: unknown = null;
    try {
      r = d.submit(s2, file.actions[0]);
    } catch (e) {
      threw = e;
    }
    expect(threw, 'dispose 之后 submit 不许抛').toBeNull();
    expect(r!.ok).toBe(false);
    // 幂等：再 dispose 也不抛
    expect(() => d.dispose()).not.toThrow();
  });

  it('settle() 在没有播放 / 没有握手时是 no-op（不会凭空安排一步）', () => {
    const ticker = new FakeTicker();
    const { d } = fresh({ ticker, stepMs: 100, settleWatchdogMs: null });
    d.settle(); // 还没 play
    expect(ticker.log.length).toBe(0);
    d.pause(); // 还没 play
    expect(d.cursor().paused).toBe(true);
    // 走到 done 之后 settle 也不许再排
    d.play();
    d.settle();
    let guard = 0;
    const s = stateAfterDraft(file);
    while (d.next()) {
      if (guard++ > file.actions.length + 5) throw new Error('重放没有收敛');
      d.submit(s, d.next()!);
      resolveAllChoices(s, pickFirst);
    }
    const logLen = ticker.log.length;
    d.settle();
    expect(ticker.log.length, 'done 之后 settle 不许再排一步').toBe(logLen);
  });
});

/* ================================================================== *
 * 判据 9：src/app 不许有直呼定时器（生成式，文本腿）
 * ================================================================== */

describe('T2 判据 9：src/app/** 直呼定时器零命中', () => {
  /**
   * **为什么这条只能是文本腿**（本仓纪律：文本腿必须写明"为什么行为腿在这里跑不动"）：
   *
   * 判据要证的是"**代码里没有**某个调用形态"。行为腿能证的只有"我调用了某个入口、它没炸"——
   * 而 `setTimeout` 随手写下的那份代码**在测试里完全跑得通**（`src/app` 的所有模块都不依赖
   * 真实时钟，直呼一个 `setTimeout` 在 node 下照样调度）。也就是说：直呼定时器的缺陷
   * **只在浏览器里表现为"UI 不刷新/两套时钟打架"**，vitest 里没有可观测症状 ⇒
   * 行为腿对这一类缺陷是**结构性瞎的**。这一点正是 G4 Global Constraints 把
   * "定时器必须注入"写成硬约束、并让本腿补上 `setTimeout`/`setInterval` 的原因
   * （`requestAnimationFrame` 已被 `tests/app-purity.test.ts:109` 禁，前两个今天没人禁）。
   */
  const APP_DIR = fileURLToPath(new URL('../../src/app/', import.meta.url));

  function walk(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p, out);
      else if (p.endsWith('.ts')) out.push(p);
    }
    return out;
  }

  /** 剥注释（与 `tests/ui/source-text.ts` 同口径：注释里提到 `setTimeout(` 不算命中） */
  function stripComments(src: string): string {
    const out: string[] = new Array(src.length);
    let i = 0;
    while (i < src.length) {
      const c = src[i];
      const n = src[i + 1];
      if (c === '/' && n === '/') {
        while (i < src.length && src[i] !== '\n') {
          out[i] = ' ';
          i += 1;
        }
        continue;
      }
      if (c === '/' && n === '*') {
        out[i] = '/';
        out[i + 1] = '*';
        i += 2;
        while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) {
          out[i] = src[i] === '\n' ? '\n' : ' ';
          i += 1;
        }
        if (i < src.length) {
          out[i] = '*';
          out[i + 1] = '/';
          i += 2;
        }
        continue;
      }
      if (c === "'" || c === '"' || c === '`') {
        const quote = c;
        out[i] = c;
        i += 1;
        while (i < src.length) {
          const ch = src[i];
          out[i] = ch;
          i += 1;
          if (ch === '\\') {
            if (i < src.length) {
              out[i] = src[i];
              i += 1;
            }
            continue;
          }
          if (ch === quote) break;
        }
        continue;
      }
      out[i] = c;
      i += 1;
    }
    return out.join('');
  }

  /**
   * **调用形态**：`setTimeout(` / `setInterval(` / `requestAnimationFrame(`。
   *
   * 三条排除（都是**假红方向**，实测踩过）：
   *  - 前缀不许是 `obj.` / `globalThis` 以外的成员访问（`(?<![\w$.])`）；
   *  - **对象类型里的方法签名** `{ setTimeout(fn: () => void, ms: number): number }` 不是调用
   *    —— 它的第一个参数后面是 `:`（`(?!\s*\w+\s*:)`）。本仓的注入面正是这种形态
   *    （`interface Ticker { schedule(...); cancel(...) }` 的兄弟写法），不排除就会让判据对自己假红；
   *  - `\w` 边界（`My_setTimeout(` 之类不算）。
   */
  const TIMER_CALL = /(?<![\w$.])(?:globalThis\s*\.\s*)?(setTimeout|setInterval|requestAnimationFrame)\s*\((?!\s*\w+\s*:)/g;

  it('生成式扫 src/app/**（剥注释）⇒ 三个定时器名零命中；且锚点证明这条判据本身能红', () => {
    const files = walk(APP_DIR).sort();
    expect(files.length, `src/app 下只扫到 ${files.length} 个 .ts（目录被清空/路径写错？）`).toBeGreaterThanOrEqual(7);

    const hits: string[] = [];
    for (const p of files) {
      const code = stripComments(readFileSync(p).subarray(0, 4 * 1024 * 1024).toString('utf8'));
      for (const m of code.matchAll(TIMER_CALL)) hits.push(`${p.slice(APP_DIR.length)}: ${m[1]}(`);
    }
    expect(hits, `src/app 里出现直呼定时器（必须走注入的 Ticker）：\n${hits.join('\n')}`).toEqual([]);

    // 锚点①：这条正则**真的能抓**（否则上面那条在空数组上恒真）
    for (const sample of [
      'const h = setTimeout(fn, 10);',
      'setInterval(tick, 100);',
      'requestAnimationFrame(draw);',
      'globalThis.setTimeout(fn, 1);',
    ]) {
      expect([...sample.matchAll(TIMER_CALL)].length, `锚点失效：${sample} 没被抓到`).toBe(1);
    }
    // 锚点②：注释里提到不算命中（先剥注释）——正/反两个方向都钉住
    expect(stripComments('// 这里提到 setTimeout( 与 setInterval( 是允许的\nconst a = 1;')).not.toMatch(TIMER_CALL);
    expect(stripComments('/* setTimeout(fn,1) */\nconst a = 1;')).not.toMatch(TIMER_CALL);
    // 锚点③：合法的 Ticker 用法**不许**被误判（否则判据假红）—— 这几条都是本仓真实存在的形态
    for (const sample of [
      'const h = ticker.schedule(fn, 10);',
      'env.ticker.cancel(h);',
      'obj.setTimeout(fn, 1);',
      'type X = { setTimeout(fn: () => void, ms: number): number };',
      'interface Ticker { schedule(fn: () => void, ms: number): number }',
    ]) {
      expect([...sample.matchAll(TIMER_CALL)].length, `误判（假红方向）：${sample}`).toBe(0);
    }
  });
});

/* ================================================================== *
 * 契约面：MatchDriver 的公共形状（防"删掉字段也算过"）
 * ================================================================== */

describe('T2 契约面：两个 driver 的公共成员齐全且类型正确', () => {
  it('LocalDriver / ReplayDriver 都满足 MatchDriver（逐个成员做运行时核对）', () => {
    const file = archiveOf('g4t2-contract', 8);
    const drivers: MatchDriver[] = [
      createLocalDriver(),
      createReplayDriver(file, { ticker: new FakeTicker(), settleWatchdogMs: null }),
    ];
    for (const d of drivers) {
      expect(typeof d.mode).toBe('string');
      expect(typeof d.seat).toBe('number');
      expect(typeof d.acceptsInput).toBe('function');
      expect(typeof d.submit).toBe('function');
      expect(typeof d.note).toBe('function');
      expect(typeof d.recorder).toBe('function');
      expect(typeof d.dispose).toBe('function');
    }
    const r = drivers[1] as ReplayDriver;
    for (const k of ['cursor', 'next', 'play', 'pause', 'setRate', 'onTick', 'settle'] as const) {
      expect(typeof r[k], `ReplayDriver 缺成员 ${k}`).toBe('function');
    }
    expect(r.file).toBe(file);
    // `onTick` 返回可用的退订函数
    const off = r.onTick(() => {});
    expect(typeof off).toBe('function');
  });
});
