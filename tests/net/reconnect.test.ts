import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { stripComments, functionBody } from '../ui/source-text';
import {
  createGuestSession,
  createHostSession,
  DEFAULT_RECONNECT_WINDOW_MS,
  RESYNC_NOT_WIRED_MESSAGE,
} from '../../src/net/session';
import type {
  ClockLike,
  GuestSession,
  HelloDecision,
  HostSession,
  SessionDecision,
  SessionInbound,
  SessionOutbound,
  SessionPhase,
  SessionTransportStatus,
} from '../../src/net/session';
import { PROTO_VERSION, decodeMsg, encodeMsg } from '../../src/net/protocol';
import type { HelloAckMsg, HelloMsg } from '../../src/net/protocol';
import { createFakeTransportPair } from '../../src/net/fake-transport';
import type { FakeTransportPair } from '../../src/net/fake-transport';
import { createNetDriver } from '../../src/net/net-driver';
import type { NetDriver } from '../../src/net/net-driver';
import type { NetChannel, TransportStatus } from '../../src/net/transport';
import { CARD_DATA_HASH } from '../../src/app/card-data-hash';
import { createMatchFileRecorder, MATCH_FILE_FORMAT, MATCH_FILE_VERSION, normalizeAction, setupFromState } from '../../src/app/match-file';
import type { ActionRecord, MatchFile, MatchFileRecorder } from '../../src/app/match-file';
import { applyRecordedAction, stateAtStep } from '../../src/app/match-replay';
import { createGame, draftNextAction, getDraftPool, performDraftBan, performDraftPick } from '../../src/core/state/create';
import { getLegalActions } from '../../src/core/game';
import type { LegalAction } from '../../src/core/game';
import { stateFingerprint } from '../../src/core/fingerprint';
import type { GameState, PlayerId } from '../../src/core/models/types';

/**
 * G5 T6 断线重连的行为腿（计划 `docs/2026-09-17-G5-传输层联机-实现计划.md` §5 T6 的七条判据 +
 * 任务书 `.superpowers/g5-plan/tasks/T6.md` 补的那几条；设计稿 §5.5 `:492-507`）。
 *
 * ## 本文件同时扮演两个角色（都要说清，免得把接线当成被测对象）
 *
 *  1. **判据腿**：断言 `src/net/session.ts` 的重连分支（窗口 / `online` / 追平 / 重发 /
 *     队列上限）在行为上真的成立；
 *  2. **最小接线**：T7/T8 的真实接线还没写，所以本文件**扮演调用方**做那几件
 *     会话层不能自己做的事 —— 转发传输状态（`noteTransportStatus`）、在喂 `hello-ack`
 *     **之前**调 `markResuming()`（D21 第四轮收口写实的时机）、拿 `stateAtStep` 追平、
 *     把驱动的入站队列溢出折成会话层的 `needsResync`。每一步都写明了它是"接线的活"。
 *
 * ## 单一路径：`stateAtStep` 是"档案 → 状态"的唯一入口（D9）
 *
 * 本文件里 `stateAtStep(` **只在 `stateFromArchive()` 里出现一次**，`applyRecordedAction(`
 * 也**只在 `playArchive()` 里出现一次**（造档案与"主机自己那份状态"用的）。这两条由
 * 文本腿钉住：多一条追平路径就会红。**能力边界**：文本腿数的是这两个**入口**的出现次数，
 * 抓不住"另写一份完全不调它们的引擎映射"（那由 `src/net/**` 的两条零命中腿
 * 与 T4 判据 3 负责）。
 *
 * ## 哈希用真 SHA-256（照 `tests/net/session.test.ts` 的夹具，理由同源）
 *
 * 那个理由是一句话：判据里出现的 `commit = hash(seed + salt)` 若用玩具哈希就退化成
 * "玩具哈希对自己成立"。本文件把它整段照抄（夹具是**复制**，不是跨测试文件 import ——
 * import 另一个测试文件会把它的 `describe` 也跑一遍）。
 *
 * ## 不写"输入 → 期望字符串"的逐字断言
 *
 * 文案会改，**理由码与相位是契约**。凡是能断言 `reason` / `phase` / `needsResync` 的地方都
 * 不断言整句文案；只在"这句话必须包含某个事实词"时才断 `toContain`。
 */

/* ------------------------------------------------------------------ *
 * 夹具 0：真 SHA-256（纯 JS，零依赖；与 tests/net/session.test.ts:54-133 同源复制）
 * ------------------------------------------------------------------ */

function utf8Bytes(text: string): number[] {
  const out: number[] = [];
  for (const ch of text) {
    const cp = ch.codePointAt(0) as number;
    if (cp < 0x80) out.push(cp);
    else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
    else if (cp < 0x10000) out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    else out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
  }
  return out;
}

const K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

function rotr(x: number, n: number): number {
  return ((x >>> n) | (x << (32 - n))) >>> 0;
}

/** SHA-256（十六进制小写）。本函数是**夹具**，不是被测代码 */
function sha256Hex(text: string): string {
  const bytes = utf8Bytes(text);
  const bitLen = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  bytes.push(0, 0, 0, 0, (bitLen >>> 24) & 0xff, (bitLen >>> 16) & 0xff, (bitLen >>> 8) & 0xff, bitLen & 0xff);
  const h = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ];
  const w = new Array<number>(64).fill(0);
  for (let off = 0; off < bytes.length; off += 64) {
    for (let i = 0; i < 16; i += 1) {
      w[i] = ((bytes[off + i * 4] << 24) | (bytes[off + i * 4 + 1] << 16) | (bytes[off + i * 4 + 2] << 8) | bytes[off + i * 4 + 3]) >>> 0;
    }
    for (let i = 16; i < 64; i += 1) {
      const s0 = (rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3)) >>> 0;
      const s1 = (rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10)) >>> 0;
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i += 1) {
      const S1 = (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) >>> 0;
      const ch = ((e & f) ^ (~e & g)) >>> 0;
      const t1 = (hh + S1 + ch + K[i] + w[i]) >>> 0;
      const S0 = (rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) >>> 0;
      const maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
      const t2 = (S0 + maj) >>> 0;
      hh = g; g = f; f = e;
      e = (d + t1) >>> 0;
      d = c; c = b; b = a;
      a = (t1 + t2) >>> 0;
    }
    h[0] = (h[0] + a) >>> 0; h[1] = (h[1] + b) >>> 0; h[2] = (h[2] + c) >>> 0; h[3] = (h[3] + d) >>> 0;
    h[4] = (h[4] + e) >>> 0; h[5] = (h[5] + f) >>> 0; h[6] = (h[6] + g) >>> 0; h[7] = (h[7] + hh) >>> 0;
  }
  return h.map((x) => x.toString(16).padStart(8, '0')).join('');
}

/** 注入给会话的哈希：按给定顺序拼串再算 sha256（设计稿 `:472` 的 `sha256(seed + salt)`） */
function sha256Concat(...parts: readonly string[]): string {
  return sha256Hex(parts.join(''));
}

/* ------------------------------------------------------------------ *
 * 夹具 1：时钟、会话、线协议
 * ------------------------------------------------------------------ */

/** 可推进的假时钟（D8 补充裁决要求的"注入一个最小时钟能力"；纯层自己不许读时钟） */
interface FakeClock extends ClockLike {
  set(ms: number): void;
}

function fakeClock(start = 0): FakeClock {
  let t = start;
  return {
    now: () => t,
    set: (ms: number) => {
      t = ms;
    },
  };
}

const SESSION_ID = 'sess-T6';
const LOCAL = { localProtoVersion: PROTO_VERSION, localCardDataHash: CARD_DATA_HASH } as const;
const SEED = 'seed-T6-0123456789abcdef';
const SALT = 'salt-T6-fedcba9876543210';

interface SessionOpts {
  readonly clock?: ClockLike;
  readonly windowMs?: number;
  readonly file?: MatchFile | null;
  /**
   * **现取**档案的来源（可选）。用它表示"档案在会话建好之后才产出"那种接线：
   * `file` 是建会话那一刻就固定的一份，而 `source` 每次问一次当前值
   * （队列恢复那条腿就是这种形状：房主先打 6 步，档案才有）。
   */
  readonly source?: () => MatchFile | null;
}

function hostSession(opts: SessionOpts = {}): HostSession {
  return createHostSession({
    ...LOCAL,
    sessionId: SESSION_ID,
    seat: 0,
    hash: sha256Concat,
    ...(opts.clock === undefined ? {} : { clock: opts.clock }),
    ...(opts.windowMs === undefined ? {} : { reconnectWindowMs: opts.windowMs }),
    ...(opts.source !== undefined
      ? { resyncSource: opts.source }
      : opts.file === undefined
        ? {}
        : { resyncSource: () => opts.file ?? null }),
  });
}

function guestSession(opts: SessionOpts = {}): GuestSession {
  return createGuestSession({
    ...LOCAL,
    sessionId: SESSION_ID,
    seat: 1,
    hash: sha256Concat,
    ...(opts.clock === undefined ? {} : { clock: opts.clock }),
    ...(opts.windowMs === undefined ? {} : { reconnectWindowMs: opts.windowMs }),
  });
}

function hello(over: Partial<HelloMsg> = {}): HelloMsg {
  return {
    t: 'hello',
    role: 'player',
    sessionId: SESSION_ID,
    protoVersion: PROTO_VERSION,
    cardDataHash: CARD_DATA_HASH,
    seat: 1,
    nick: 'guest',
    ...over,
  };
}

function helloAck(over: Partial<HelloAckMsg> = {}): HelloAckMsg {
  return { t: 'hello-ack', protoVersion: PROTO_VERSION, seat: 1, peerNick: 'host', sessionId: SESSION_ID, ...over };
}

/** 把一条消息**真的走一遍线协议**（`encodeMsg` → `decodeMsg`）再喂给对端（照 T3 的夹具） */
function overWire(msg: unknown): unknown {
  const enc = encodeMsg(msg);
  expect(enc.ok, `这条消息无法被 encodeMsg 编码：${enc.ok ? '' : enc.message}`).toBe(true);
  if (!enc.ok) throw new Error('unreachable');
  const dec = decodeMsg(enc.text, { protoVersion: PROTO_VERSION });
  expect(dec.ok, `刚编码出来的消息无法被 decodeMsg 解码：${dec.ok ? '' : dec.message}`).toBe(true);
  if (!dec.ok) throw new Error('unreachable');
  return dec.msg;
}

type AnySession = HostSession | GuestSession;
type AnyDecision = HelloDecision | SessionDecision;

function acceptOk(session: AnySession, req: SessionInbound): AnyDecision {
  const d = session.accept(req);
  expect(d.ok, `本该接受的入站消息被拒了：${d.ok ? '' : `${d.reason} / ${d.message}`}`).toBe(true);
  if (!d.ok) throw new Error('unreachable');
  return d;
}

/**
 * 收一条消息并取出它**产出的那条线消息**（`SessionOutbound`）。
 *
 * 为什么要单写一个：`accept()` 的返回类型是 `HelloDecision | SessionDecision`（hello 的成功面
 * 是 `HelloAckMsg`，不是 `SessionOutbound`）。追平那条链上（`resync-req`）要的是后者，
 * 这里把窄化写一次，免得每条腿各写一遍。
 */
function acceptSessionOut(session: AnySession, req: SessionInbound): SessionOutbound {
  const d = acceptOk(session, req);
  // 这个口**只**用于 `resync-req`（它的成功面必然是 `SessionOutbound`）。`accept()` 的返回类型
  // 是 `HelloDecision | SessionDecision`，而 TS 的 `in` 窄化对"失败面也在这个联合里"的情形
  // 不总是收得干净 ⇒ 这里收一次口，并在运行时确认"确实产出了一条消息"。
  const out = (d as { output?: unknown }).output as SessionOutbound | null | undefined;
  if (out === null || out === undefined) throw new Error('unreachable：这一格必须产出一条消息');
  return out;
}

function acceptRejected(session: AnySession, req: SessionInbound): { reason: string; message: string } {
  const d = session.accept(req);
  expect(d.ok, '本该被拒的入站消息被接受了').toBe(false);
  if (d.ok) throw new Error('unreachable');
  return { reason: d.reason, message: d.message };
}

/** 把会话产出的那条消息喂给对端（**接线的那一步**：先过线，再 `accept`） */
function feed(session: AnySession, out: SessionOutbound): AnyDecision {
  return acceptOk(session, { t: out.t as SessionInbound['t'], msg: overWire(out.msg) });
}

/* ------------------------------------------------------------------ *
 * 夹具 2：一局真对局（60 步档案）+ 两端各自的引擎状态
 * ------------------------------------------------------------------ */

/**
 * 本文件用的种子与步数。
 *
 * 与 `tests/net/net-driver.test.ts` 的 60 步夹具**同一个种子**（`g5-t5-gamma`）：
 * 那个种子的可用步数、两个座位都动过、kind 分布都已经被 T5 实测过一遍
 * （`{advance:46, play:9, effect-choice:4, resolve-trigger:1}`）。
 * 本文件不重复做那份覆盖普查（那是 T5 判据 1 的活），只借它保证"60 步真走得完"。
 */
const ARCHIVE_SEED = 'g5-t5-gamma';
const ARCHIVE_STEPS = 60;

/** 草稿策略：每一步在可选池里按步数取一个（照 `net-driver.test.ts:83`，确定性） */
function draftDeterministic(s: GameState): void {
  let guard = 0;
  for (;;) {
    const next = draftNextAction(s);
    if (!next) break;
    if (guard++ > 200) throw new Error('草稿没有收敛');
    const pool = getDraftPool(s).map((p) => p.defId);
    const defId = pool[(guard * 7) % pool.length];
    if (next.kind === 'pick') performDraftPick(s, defId);
    else performDraftBan(s, defId);
  }
}

/** 开局状态：`createGame` + 走完草稿 */
function opening(seed: string): GameState {
  const s = createGame({ seed });
  draftDeterministic(s);
  expect(s.phase, `草稿必须走完：seed=${seed}`).toBe('turn');
  return s;
}

/** 挂起选择的首选答案（照 `net-driver.test.ts:173`） */
function pickFirst(prompt: {
  optional: boolean;
  kind: string;
  lines?: number[];
  actions?: string[];
  candidates: { uid: string }[];
  max: number;
}): string[] {
  if (prompt.optional) return [];
  if (prompt.kind === 'select-line') return [`line:${prompt.lines?.[0] ?? 0}`];
  if (prompt.kind === 'select-action') return [prompt.actions?.[0] ?? ''].filter(Boolean);
  return prompt.candidates.slice(0, prompt.max).map((c) => c.uid);
}

function argsOf(a: LegalAction): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  if (a.cardUid !== undefined) args.cardUid = a.cardUid;
  if (a.faceUp !== undefined) args.faceUp = a.faceUp;
  if (a.line !== undefined) args.line = a.line;
  if (a.target !== undefined) args.target = a.target;
  return args;
}

/** 确定性策略：给出当前状态上的下一条操作（与 `net-driver.test.ts:204` 同一套判断顺序） */
function nextAction(s: GameState, step: number): Omit<ActionRecord, 'seq'> | null {
  if (s.phase !== 'turn' || s.winner !== null) return null;
  const top = s.pendingEffects[s.pendingEffects.length - 1];
  if (top !== undefined && top.prompt !== null && top.prompt !== undefined) {
    const choice = pickFirst(top.prompt);
    const chooser: PlayerId = top.prompt.chooser ?? top.player;
    return { player: chooser, kind: 'effect-choice', args: { promptId: top.id, choice } };
  }
  const player = s.turnPlayer;
  const legal = getLegalActions(s, player);
  if (legal.length === 0) return null;
  const a = legal[step % Math.min(legal.length, 3)];
  if (a.kind === 'play') return { player, kind: 'play', args: argsOf(a) };
  if (a.kind === 'compile') return { player, kind: 'compile', args: { line: a.line } };
  if (a.kind === 'resolve-trigger') return { player, kind: 'resolve-trigger', args: { cardUid: a.cardUid } };
  if (a.kind === 'effect-choice') return { player, kind: 'effect-choice', args: { promptId: a.promptId, choice: a.choice } };
  return { player, kind: a.kind };
}

/**
 * ★ **唯一一处**"档案 → 状态"（D9 的单一出处）。
 *
 * 本文件里所有"追平"的腿都从这里拿状态；`stateAtStep(` 在**本文件里只出现这一次**，
 * 由文本腿钉住（多一条追平路径 ⇒ 那条腿红）。会话层自己**不**调 `stateAtStep`
 * （`src/net/**` 里零命中，另一条文本腿钉住）。
 */
function stateFromArchive(file: MatchFile): GameState {
  return stateAtStep(file, file.actions.length);
}

/** `playArchive()` 的产物（具名类型：见 `braceBodyOf` 头注里那条"签名不带裸对象字面量"的前提） */
interface ArchiveFixture {
  file: MatchFile;
  state: GameState;
  recorder: MatchFileRecorder;
}

/**
 * ★ **唯一一处**引擎入口（把一局真打出来，用于造 60 步档案）。
 *
 * 它也是"主机自己那份状态"的来源：判据 3 要比的是
 * "`stateAtStep(档案, 60)` 的指纹" 与 "主机**逐步重放**出来的指纹"，
 * 后者就是这里的 `state`。
 */
function playArchive(steps: number): ArchiveFixture {
  const s = opening(ARCHIVE_SEED);
  const recorder = createMatchFileRecorder();
  for (let i = 0; i < steps; i += 1) {
    const a = nextAction(s, i);
    if (a === null) throw new Error(`第 ${i} 步没有可用操作（换种子/步数必须重测）`);
    applyRecordedAction(s, normalizeAction({ ...a, seq: i }));
    recorder.record(a);
  }
  const file = recorder.toMatchFile({
    seed: ARCHIVE_SEED,
    setup: setupFromState(s),
    players: [{ nick: '甲' }, { nick: '乙' }],
    cardDataHash: CARD_DATA_HASH,
    createdAt: '2026-09-18T00:00:00.000Z',
  });
  return { file, state: s, recorder };
}

/* ------------------------------------------------------------------ *
 * 夹具 3：承诺流程（会话层，不需要引擎状态）
 * ------------------------------------------------------------------ */

/** 走到"两端都 complete"：全程用**真实产出**（每一步都过线协议） */
function runCommitmentFull(host: HostSession, guest: GuestSession, face: 0 | 1 = 1, nonce = 'nonce-T6'): void {
  const hd = host.accept({ t: 'hello', msg: overWire(hello()) });
  expect(hd.ok, `房主拒绝了合法握手：${hd.ok ? '' : hd.message}`).toBe(true);
  if (!hd.ok) throw new Error('unreachable');
  acceptOk(guest, { t: 'hello-ack', msg: overWire(hd.output) });

  const c = host.sendCommit(SEED, SALT);
  expect(c.ok, '房主发不出 commit').toBe(true);
  if (!c.ok) throw new Error('unreachable');
  feed(guest, c.output);

  const ack = guest.sendCommitAck();
  expect(ack.ok, '加入方发不出 commit-ack').toBe(true);
  if (!ack.ok) throw new Error('unreachable');
  feed(host, ack.output);

  const cf = guest.commitFace(face, nonce);
  expect(cf.ok, '加入方发不出 commit-face').toBe(true);
  if (!cf.ok) throw new Error('unreachable');
  feed(host, cf.output);

  const rs = host.sendRevealSeed();
  expect(rs.ok, '承诺成立之后房主发不出 reveal-seed').toBe(true);
  if (!rs.ok) throw new Error('unreachable');
  feed(guest, rs.output);

  const rf = guest.sendRevealFace();
  expect(rf.ok, '加入方发不出 reveal-face').toBe(true);
  if (!rf.ok) throw new Error('unreachable');
  feed(host, rf.output);

  const rv = host.sendRevealSalt();
  expect(rv.ok, '收完 reveal-face 之后房主发不出 reveal-salt').toBe(true);
  if (!rv.ok) throw new Error('unreachable');
  feed(guest, rv.output);

  expect(host.phase(), '夹具问题：房主没走到 complete').toBe('complete');
  expect(guest.phase(), '夹具问题：加入方没走到 complete').toBe('complete');
}

/** 把加入方推到某个相位（用真实产出走上去；只支持本文件用到的几格） */
function guestAt(
  target: 'seed-committed' | 'awaiting-commit-ack' | 'face-committed' | 'seed-revealed' | 'complete',
): GuestSession {
  const g = guestSession();
  acceptOk(g, { t: 'hello-ack', msg: overWire(helloAck()) });
  acceptOk(g, { t: 'commit', msg: overWire({ t: 'commit', hash: sha256Concat(SEED, SALT) }) });
  // 收到 `commit` 之后的那一格：`seedHash` 已记下、相位由**这条消息**推到这里
  // ——那正是 D23 ① 收窄后允许幂等的那一格。
  if (target === 'seed-committed') return g;
  expect(g.sendCommitAck().ok).toBe(true); // ⇒ awaiting-commit-ack
  if (target === 'awaiting-commit-ack') return g;
  expect(g.commitFace(1, 'nonce-x').ok).toBe(true);
  if (target === 'face-committed') return g;
  acceptOk(g, { t: 'reveal-seed', msg: overWire({ t: 'reveal-seed', seed: SEED }) });
  if (target === 'seed-revealed') return g;
  expect(g.sendRevealFace().ok).toBe(true);
  acceptOk(g, { t: 'reveal-salt', msg: overWire({ t: 'reveal-salt', salt: SALT }) });
  return g;
}

/**
 * **接线的活（第一段）**：加入方重连到"档案到手、还没追平"。
 *
 * 顺序就是 D21 第四轮收口写实的那个：`markResuming()` **必须在喂 `hello-ack` 之前**
 * （`acceptHelloAck` 在 `handshaking` 时会推进相位，此后 `markResuming()` 一律被拒）。
 *
 * 返回**两份**东西，区别很重要：
 *  - `resyncRes`：房主真实产出的那条消息（`SessionOutbound`）；
 *  - `receivedFile`：**过完线之后**加入方实际收到的那份档案 —— 接线要拿**它**去 `stateAtStep`，
 *    不是拿本地那份。这条区别是 M4（房主裁剪档案）能被抓住的前提：本地那份永远是完整的。
 */
function guestReconnectsToPending(
  host: HostSession,
  guest: GuestSession,
  appliedSteps = 0,
): { resyncRes: SessionOutbound; receivedFile: MatchFile } {
  expect(guest.markResuming().ok, '加入方进不了 resuming').toBe(true);
  const hd = host.accept({ t: 'hello', msg: overWire(hello({ resuming: true })) });
  expect(hd.ok, `房主没接住重连握手：${hd.ok ? '' : hd.message}`).toBe(true);
  if (!hd.ok) throw new Error('unreachable');
  acceptOk(guest, { t: 'hello-ack', msg: overWire(hd.output) });
  const resyncRes = acceptSessionOut(host, {
    t: 'resync-req',
    msg: overWire({ t: 'resync-req', sessionId: SESSION_ID, appliedSteps }),
  });
  const decoded = overWire(resyncRes.msg) as { file: MatchFile };
  acceptOk(guest, { t: 'resync-res', msg: decoded });
  return { resyncRes, receivedFile: decoded.file };
}

/* ------------------------------------------------------------------ *
 * 夹具 4：两个端点（会话 + 驱动 + 链路），用于"断线后不推进"与队列那两条
 * ------------------------------------------------------------------ */

const ACT_LATENCY_TICKS = 2; // 与 net-driver.test.ts:114 同口径：第 0 步发出的帧在一个 pump(2) 内到达

interface Endpoint {
  driver: NetDriver;
  state: GameState;
}

/** 建一对已经 init 的 fake 链路（D18：`init().ok` 只保证本侧，不当"对端在线"用） */
async function makeLink(): Promise<FakeTransportPair> {
  const pair = createFakeTransportPair();
  await pair.A.transport.init({ selfId: 'A', peerId: 'B' });
  await pair.B.transport.init({ selfId: 'B', peerId: 'A' });
  return pair;
}

/** 走 `n` 步真操作（每步：本端 submit ⇒ pump ⇒ 对端 arm），并逐步断言两端指纹相等 */
function playSteps(pair: FakeTransportPair, host: Endpoint, guest: Endpoint, steps: number): void {
  host.driver.arm(host.state);
  guest.driver.arm(guest.state);
  for (let i = 0; i < steps; i += 1) {
    const a = nextAction(host.state, i);
    expect(a, `第 ${i} 步没有可用操作`).not.toBeNull();
    if (a === null) throw new Error('unreachable');
    const ep = a.player === 0 ? host : guest;
    const peer = a.player === 0 ? guest : host;
    const r = ep.driver.submit(ep.state, a);
    expect(r.ok, `第 ${i} 步的 submit 必须成功（${a.player}:${a.kind}）`).toBe(true);
    pair.pump(ACT_LATENCY_TICKS);
    peer.driver.arm(peer.state);
    expect(stateFingerprint(host.state), `第 ${i} 步之后两端指纹必须相等`).toBe(stateFingerprint(guest.state));
  }
}

/* ------------------------------------------------------------------ *
 * 断线后那条（计划判据 1）：主机 online=false、回合不推进、从机不收输入
 * ------------------------------------------------------------------ */

describe('断线后那条：主机 online=false、回合不推进（指纹冻结）、从机不收输入', () => {
  it('★ 断线之后：两端 online=false、加入方不再收输入、两端都不再产出操作（记录器与步数都冻住）', async () => {
    const clock = fakeClock(0);
    const pair = await makeLink();
    const hostRecorder = createMatchFileRecorder();
    const host = hostSession({ clock });
    const guest = guestSession({ clock });
    // 接线的活：把传输状态转发进会话层（会话层不自己订阅 onStatus）
    pair.A.transport.onStatus((ch) => host.noteTransportStatus(ch.to));
    pair.B.transport.onStatus((ch) => guest.noteTransportStatus(ch.to));
    host.noteTransportStatus(pair.A.transport.status());
    guest.noteTransportStatus(pair.B.transport.status());

    // 会话层：走完承诺流程到两端 complete（断线前它们是"能收输入"的）
    runCommitmentFull(host, guest);

    const hostEp: Endpoint = { driver: createNetDriver({ transport: pair.A.transport, seat: 0, recorder: hostRecorder }), state: opening(ARCHIVE_SEED) };
    const guestEp: Endpoint = { driver: createNetDriver({ transport: pair.B.transport, seat: 1, recorder: null }), state: opening(ARCHIVE_SEED) };
    playSteps(pair, hostEp, guestEp, 6);

    // ★ 反空转（这三句是这条腿的牙）：断线**之前**必须真的是"在线 + 能收输入 + 在推进"
    expect(host.peerStatus().online, '断线前：传输 online + 窗口内 ⇒ 必须报在线').toBe(true);
    expect(guest.peerStatus().acceptsInput, '断线前：加入方走完承诺流程 ⇒ 必须报可以收输入').toBe(true);
    expect(hostRecorder.actions().length, '断线前应该真的推进过几步').toBe(6);

    const lenBefore = hostRecorder.actions().length;
    const stepsBefore = hostEp.driver.appliedSteps();
    const fpBefore = stateFingerprint(hostEp.state);

    // 拔线：fake 的 `deactivate()` 会把**两端**都转 offline 并通知订阅者
    pair.A.deactivate();

    expect(host.peerStatus().online, '断线后主机仍报在线').toBe(false);
    expect(guest.peerStatus().online, '传输状态没有转发到加入方那一侧').toBe(false);
    expect(guest.peerStatus().acceptsInput, '断线后加入方还敢收输入').toBe(false);
    expect(guest.peerStatus().windowExpired, '窗口内（没超窗）').toBe(false);

    // 回合不推进：本端的提交被拒，且**两端都不再产出操作、指纹也不动**
    const a = nextAction(hostEp.state, 6);
    expect(a, '第 6 步没有可用操作（这条腿要构造"断线期间还想推进"）').not.toBeNull();
    if (a === null) throw new Error('unreachable');
    const refused = hostEp.driver.submit(hostEp.state, a);
    expect(refused.ok, '断线期间提交成功了（那正是判据 1 要堵的）').toBe(false);
    expect(refused.ok ? null : refused.refusal, '断线时的拒绝码该是 offline（D16）').toBe('offline');

    expect(stateFingerprint(hostEp.state), '被拒的提交改动了主机状态（指纹冻结）').toBe(fpBefore);
    expect(stateFingerprint(guestEp.state), '两端指纹不再相等').toBe(stateFingerprint(hostEp.state));
    expect(hostRecorder.actions().length, '断线期间记录器还在长（凭据被改脏）').toBe(lenBefore);
    expect(hostEp.driver.appliedSteps(), '断线期间主机步数变了').toBe(stepsBefore);
    expect(guestEp.driver.appliedSteps(), '断线期间加入方步数变了').toBe(stepsBefore);
  });

  it('反控：同一条提交在**在线**时是可以成功的（否则上面那条"被拒"证明不了断线）', async () => {
    const clock = fakeClock(0);
    const pair = await makeLink();
    const host = hostSession({ clock });
    const guest = guestSession({ clock });
    pair.A.transport.onStatus((ch) => host.noteTransportStatus(ch.to));
    pair.B.transport.onStatus((ch) => guest.noteTransportStatus(ch.to));
    host.noteTransportStatus(pair.A.transport.status());
    guest.noteTransportStatus(pair.B.transport.status());
    runCommitmentFull(host, guest);

    const hostEp: Endpoint = { driver: createNetDriver({ transport: pair.A.transport, seat: 0, recorder: createMatchFileRecorder() }), state: opening(ARCHIVE_SEED) };
    const guestEp: Endpoint = { driver: createNetDriver({ transport: pair.B.transport, seat: 1, recorder: null }), state: opening(ARCHIVE_SEED) };
    playSteps(pair, hostEp, guestEp, 1);
    expect(host.peerStatus().online).toBe(true);
  });
});

/* ------------------------------------------------------------------ *
 * 窗口那条（计划判据 3）：300s / 可配置 / 超窗不自动结束
 * ------------------------------------------------------------------ */

describe('窗口那条：300s、可配置、超窗不自动结束', () => {
  it('缺省 300_000ms；边界 `≤` 算窗口内（D8 补充裁决）', () => {
    const clock = fakeClock(0);
    const h = hostSession({ clock });
    expect(h.reconnectWindowMs(), '缺省窗口').toBe(DEFAULT_RECONNECT_WINDOW_MS);
    expect(DEFAULT_RECONNECT_WINDOW_MS, '缺省窗口是 300s（设计稿 :505）').toBe(300_000);
    h.noteTransportStatus('online');
    expect(h.peerStatus().windowExpired).toBe(false);

    clock.set(299_999);
    expect(h.peerStatus().windowExpired, '299.999s 仍在窗口内').toBe(false);
    expect(h.peerStatus().online).toBe(true);
    clock.set(300_000);
    expect(h.peerStatus().windowExpired, '等于窗口算在窗口内（D8 补充裁决的 `>` 口径）').toBe(false);
    expect(h.peerStatus().online).toBe(true);
    clock.set(300_001);
    expect(h.peerStatus().windowExpired, '超窗 1ms（非零偏移）').toBe(true);
    expect(h.peerStatus().online, '超窗之后 online 必须变 false').toBe(false);
  });

  it('窗口可配置：传 1_000 与 600_000 时超窗时刻跟着变（证明 300000 不是硬编码在派生式里）', () => {
    const fast = fakeClock(0);
    const short = hostSession({ clock: fast, windowMs: 1_000 });
    short.noteTransportStatus('online');
    expect(short.reconnectWindowMs()).toBe(1_000);
    fast.set(1_000);
    expect(short.peerStatus().windowExpired, '1_000 边界仍算窗口内').toBe(false);
    fast.set(1_001);
    expect(short.peerStatus().windowExpired, '窗口 1_000 ⇒ 1_001ms 已超窗').toBe(true);

    const slow = fakeClock(0);
    const long = hostSession({ clock: slow, windowMs: 600_000 });
    long.noteTransportStatus('online');
    expect(long.reconnectWindowMs()).toBe(600_000);
    slow.set(300_001);
    expect(long.peerStatus().windowExpired, '窗口 600_000 ⇒ 300_001ms 仍在窗口内').toBe(false);
    expect(long.peerStatus().online, '窗口内的 online 由传输状态决定').toBe(true);
  });

  it('★ 超窗**不结束对局**：resync-req 仍然换得到档案，相位不是 rejected，档案没被标 result', () => {
    const { file } = playArchive(ARCHIVE_STEPS);
    const clock = fakeClock(0);
    const host = hostSession({ clock, file });
    const guest = guestSession({ clock });
    const hd = host.accept({ t: 'hello', msg: overWire(hello({ resuming: true })) });
    expect(hd.ok).toBe(true);
    if (!hd.ok) throw new Error('unreachable');
    expect(host.peerStatus().needsResync).toBe(true);
    // 加入方那一侧：声明重连、收 ack（**超窗不影响握手**：窗口只改读数）
    expect(guest.markResuming().ok).toBe(true);
    acceptOk(guest, { t: 'hello-ack', msg: overWire(hd.output) });

    clock.set(300_001); // 非零的超窗量（§2 第 13 条末：能取零偏移的变异是掷硬币）
    expect(host.peerStatus().online, '前提：这一刻确实超窗').toBe(false);
    expect(host.peerStatus().windowExpired).toBe(true);

    const resyncRes = acceptSessionOut(host, {
      t: 'resync-req',
      msg: overWire({ t: 'resync-req', sessionId: SESSION_ID, appliedSteps: 3 }),
    });
    // 产出的必须是 resync-res，而且**不是**结束类消息（forfeit / bye）
    expect(resyncRes.t, '超窗路上产出了结束类消息').toBe('resync-res');
    const carried = resyncRes.msg as { t: string; file?: MatchFile };
    expect(carried.t).toBe('resync-res');
    expect(carried.file, '档案必须原样带在消息里').toBeDefined();
    expect('result' in (carried.file as MatchFile), '超窗把档案标成了结束').toBe(false);
    expect(host.phase(), '超窗把相位推走了').not.toBe('rejected');
    // 加入方那一侧也照收（它没有"超窗就结束"的分支）
    acceptOk(guest, { t: 'resync-res', msg: overWire(resyncRes.msg) });
    expect(guest.phase()).toBe('resync-pending');
  });
});

/* ------------------------------------------------------------------ *
 * 重连追平那条（计划判据 2）：hello{resuming} → resync-res{MatchFile} → stateAtStep ⇒ 两端指纹相等
 * ------------------------------------------------------------------ */

describe('重连追平那条：hello{resuming} → resync-res{MatchFile} → stateAtStep ⇒ 两端指纹相等', () => {
  it('★ 追平之后两端指纹逐字相等；追平前 needsResync 为真、追平后为假', () => {
    const { file, state: hostState } = playArchive(ARCHIVE_STEPS);
    // 反空转：档案必须真的有 60 步（否则"追平"是在空档案上做的，逐字相同是掷硬币）
    expect(file.actions.length, '档案步数（这条腿的差异幅度必须非零）').toBe(ARCHIVE_STEPS);
    const clock = fakeClock(0);

    const host = hostSession({ clock, file });
    const guest = guestSession({ clock });
    // 断线期间主机档案长度没变（凭据没被改脏）—— 单独一条断言，与下面那条分开写
    const lenBefore = file.actions.length;

    const { receivedFile } = guestReconnectsToPending(host, guest, 40);
    expect(guest.phase(), '收下 resync-res 之后应该停在 resync-pending（档案到了、还没追平）').toBe(
      'resync-pending',
    );
    expect(guest.peerStatus().needsResync, '还没追平时 needsResync 必须仍为真').toBe(true);
    expect(guest.peerStatus().handshakeDone, 'resync-pending 算握手已完成（resuming 不算）').toBe(true);

    // ★ 追平：**用收到的那份档案**（不是本地那份 —— 那正是 M4 能被抓住的前提），
    //    走 stateFromArchive（本文件里 `stateAtStep` 的唯一调用点）
    const applied = guest.applyResyncFile(receivedFile, receivedFile.actions.length);
    expect(applied.ok, `追平被拒了：${applied.ok ? '' : `${applied.reason} / ${applied.message}`}`).toBe(true);
    if (!applied.ok) throw new Error('unreachable');
    const guestState = stateFromArchive(applied.file);

    // 两端指纹：一端来自"主机逐步重放出来的那份状态"，另一端来自"档案一次重建"
    const fpGuest = stateFingerprint(guestState);
    const fpHost = stateFingerprint(hostState);
    // 覆盖类/凭据类读数**打印实测值**（不是只断言下界）：报告里的数字从这一行抄
    console.log(
      `T6-RESYNC steps=${file.actions.length} appliedSteps=${receivedFile.actions.length} ` +
        `kinds=${JSON.stringify([...new Set(file.actions.map((a) => a.kind))].sort())} ` +
        `fpHost=${fpHost} fpGuest=${fpGuest}`,
    );
    expect(fpGuest, '追平之后两端指纹必须逐字相等').toBe(fpHost);
    expect(guest.peerStatus().needsResync, '追平之后 needsResync 必须转 false').toBe(false);
    expect(guest.peerStatus().needsResyncCause).toBeNull();
    expect(file.actions.length, '断线期间主机档案长度变了').toBe(lenBefore);
    expect(applied.file.actions.length, '重连后两端看到的步数必须相等').toBe(lenBefore);
    // 会话层**不**自己重放（D9）：它回的是档案，状态由调用方拿 `stateAtStep` 得到
    expect(applied.phase).toBe(guest.phase());
  });

  it('★ 追平后加入方在 `awaiting-commit`（等房主的 commit），而不是停在 resuming', () => {
    const { file } = playArchive(ARCHIVE_STEPS);
    const clock = fakeClock(0);
    const host = hostSession({ clock, file });
    const guest = guestSession({ clock });
    const { receivedFile } = guestReconnectsToPending(host, guest, 0);
    const applied = guest.applyResyncFile(receivedFile, receivedFile.actions.length);
    expect(applied.ok).toBe(true);
    expect(guest.phase(), '追平之后该回到"等房主的 commit"那一格').toBe('awaiting-commit');
    // 正控：那一格真的能收下一条 commit（否则"回到 awaiting-commit"是个死格子）
    acceptOk(guest, { t: 'commit', msg: overWire({ t: 'commit', hash: sha256Concat(SEED, SALT) }) });
    expect(guest.phase()).toBe('seed-committed');
  });

  it('★ 走线：房主产出的 resync-res 能过 encodeMsg/decodeMsg（不是手工构造的对象字面量）', () => {
    const { file } = playArchive(ARCHIVE_STEPS);
    const host = hostSession({ file });
    const built = host.buildResyncRes(file);
    expect(built.ok, '房主打包不出 resync-res').toBe(true);
    if (!built.ok) throw new Error('unreachable');
    const enc = encodeMsg(built.output.msg);
    expect(enc.ok, `resync-res 编不过线协议：${enc.ok ? '' : enc.message}`).toBe(true);
    if (!enc.ok) throw new Error('unreachable');
    const dec = decodeMsg(enc.text, { protoVersion: PROTO_VERSION });
    expect(dec.ok, `resync-res 解不回来：${dec.ok ? '' : dec.message}`).toBe(true);
    if (!dec.ok) throw new Error('unreachable');
    // 档案经 JSON 往返之后仍在（形状腿：`protocol.ts` 只判 `isObj(m.file)`，所以这里要比步数）
    expect((dec.msg as { file: MatchFile }).file.actions.length).toBe(ARCHIVE_STEPS);
  });

  it('★ 不裁剪：`buildResyncRes` 给的档案步数与调用方给的那一份**逐字相同**（M4 的正面形态）', () => {
    const { file } = playArchive(ARCHIVE_STEPS);
    const host = hostSession({ file });
    const built = host.buildResyncRes(file);
    expect(built.ok).toBe(true);
    if (!built.ok) throw new Error('unreachable');
    const carried = built.output.msg as { file: MatchFile };
    expect(carried.file.actions.length, '档案被裁剪了（appliedSteps 不该参与权威判定）').toBe(file.actions.length);
    expect(carried.file.actions.map((a) => a.kind)).toEqual(file.actions.map((a) => a.kind));
    // 归一化是**复制**：消息里那份与调用方那份不共享数组与元素（改一边不该动到另一边）
    expect(carried.file.actions, '消息里的档案与调用方共享同一个数组').not.toBe(file.actions);
    expect(carried.file.actions[0], '消息里的档案与调用方共享同一条记录').not.toBe(file.actions[0]);
    expect(JSON.stringify(carried.file.actions)).toBe(JSON.stringify(file.actions));
  });
});

/* ------------------------------------------------------------------ *
 * 单一出处那条（判据 2 的文本面）
 * ------------------------------------------------------------------ */

const NET_DIR = fileURLToPath(new URL('../../src/net/', import.meta.url));
const THIS_FILE = fileURLToPath(new URL('./reconnect.test.ts', import.meta.url));

function tsSources(dir: string): { path: string; code: string }[] {
  const out: { path: string; code: string }[] = [];
  const walk = (d: string): void => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (p.endsWith('.ts')) out.push({ path: p, code: stripComments(readFileSync(p).subarray(0, 4 * 1024 * 1024).toString('utf8')) });
    }
  };
  walk(dir);
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

describe('单一出处那条：追平只走 stateAtStep（引擎入口在 src/net 里零命中）', () => {
  it('`src/net/**` 里 `stateAtStep` 零命中（会话层不自己重放），`executeAction(` / `resetControlIfHeld` 零命中', () => {
    const files = tsSources(NET_DIR);
    // 下界自证：路径写错会扫到 0 个文件，那样"零命中"恒真（计划 §2 第 13 条）
    expect(files.length, 'src/net 至少要扫到 5 个文件').toBeGreaterThanOrEqual(5);
    const stateAt = 'stateAt' + 'Step(';
    for (const f of files) {
      expect(f.code.includes(stateAt), `${f.path} 里出现了 stateAtStep（那是调用方的活，D9）`).toBe(false);
      expect(f.code.includes('executeAction('), `${f.path} 不许出现引擎调用 executeAction(`).toBe(false);
      expect(f.code.includes('resetControlIfHeld'), `${f.path} 不许出现 resetControlIfHeld`).toBe(false);
    }
  });

  it('★ 本文件（接线）里两个入口各**恰好一次**：追平入口只在 stateFromArchive 里，引擎入口只在 playArchive 里', () => {
    const code = stripComments(readFileSync(THIS_FILE).subarray(0, 4 * 1024 * 1024).toString('utf8'));
    const needleState = 'stateAt' + 'Step(';
    const needleApply = 'apply' + 'RecordedAction(';
    const count = (needle: string): number => code.split(needle).length - 1;
    expect(count(needleState), '接线里出现了第二处追平调用（第二条追平路径）').toBe(1);
    expect(count(needleApply), '接线里出现了第二处引擎入口').toBe(1);
    // 它们各自只住在一个函数里：把函数体切出来单独数一遍（切出来的必须真的是那两个函数体）
    const stateBody = braceBodyOf(code, 'stateFromArchive');
    expect(stateBody.includes(needleState), '切出来的不是 stateFromArchive 的函数体').toBe(true);
    expect(stateBody.split(needleState).length - 1, '追平调用漏到别的函数里了').toBe(1);
    const playBody = braceBodyOf(code, 'playArchive');
    expect(playBody.includes(needleApply), '切出来的不是 playArchive 的函数体').toBe(true);
    expect(playBody.split(needleApply).length - 1, '引擎入口漏到别的函数里了').toBe(1);
  });

  it('文本腿自己能红：同一个判定喂进被禁的字面量必须命中（正控）', () => {
    const sample = 'function f(s) { stateAt' + 'Step(f, 1); apply' + 'RecordedAction(s, r); }';
    expect(sample.includes('stateAt' + 'Step(')).toBe(true);
    expect(sample.includes('apply' + 'RecordedAction(')).toBe(true);
  });
});

/**
 * 从源码里切出一个具名函数的**整段**（含函数头）。
 *
 * 用的是仓库**既有那一份**实现（`tests/ui/source-text.ts` 的 `functionBody`，G2 起被多处共用），
 * 不自己写第二份正则 —— 两份拷贝一旦漂移，其中一边会因为"把注释/类型也算进函数体"而假绿
 * （那个文件头注里记着这条教训）。
 * ⚠️ 它的前提是"签名里不出现裸的对象字面量返回类型"（本仓写法如此）；本文件与本任务新增的
 * 那几个函数都守这条（需要时给返回类型起个名字，例如 `RedriveOk` / `ArchiveFixture`）。
 */
function braceBodyOf(code: string, name: string): string {
  return functionBody(code, name);
}

/* ------------------------------------------------------------------ *
 * markResuming() 边界那条（D20 的 N-11 + D21 第四轮收口）
 * ------------------------------------------------------------------ */

describe('markResuming() 边界那条：握手完成后不许再变成重连 + 时机必须在喂 hello-ack 之前', () => {
  it('(a) `handshaking` 下成功：相位 resuming、needsResync=true、handshakeDone 仍为 false', () => {
    const g = guestSession();
    expect(g.peerStatus().needsResync, '刚建出来就报 needsResync').toBe(false);
    const r = g.markResuming();
    expect(r.ok).toBe(true);
    expect(r.ok ? r.phase : null).toBe('resuming');
    expect(g.phase()).toBe('resuming');
    expect(g.peerStatus().needsResync).toBe(true);
    expect(g.peerStatus().needsResyncCause, '重连握手这条路的起因').toBe('resuming-handshake');
    expect(g.peerStatus().handshakeDone, 'resuming 不算握手完成（T3 的既有读数）').toBe(false);
  });

  it('(b) 收到 hello-ack 之后再调 ⇒ 被拒、相位与 needsResync 一字不动', () => {
    const g = guestSession();
    acceptOk(g, { t: 'hello-ack', msg: overWire(helloAck()) });
    expect(g.phase(), '夹具问题：这一格该是 awaiting-commit').toBe('awaiting-commit');
    const before = g.peerStatus();
    const r = g.markResuming();
    expect(r.ok).toBe(false);
    expect(r.ok ? null : r.reason).toBe('unexpected-message');
    expect(g.phase()).toBe('awaiting-commit');
    expect(g.peerStatus()).toEqual(before);
  });

  it('(c) 已经在承诺流程里的四格逐相位各一次：全部被拒且状态不动', () => {
    const phases: { phase: SessionPhase; g: GuestSession }[] = [
      { phase: 'awaiting-commit-ack', g: guestAt('awaiting-commit-ack') },
      { phase: 'face-committed', g: guestAt('face-committed') },
      { phase: 'seed-revealed', g: guestAt('seed-revealed') },
      { phase: 'complete', g: guestAt('complete') },
    ];
    for (const { phase, g } of phases) {
      expect(g.phase(), '夹具没推到目标相位').toBe(phase);
      const before = g.peerStatus();
      const r = g.markResuming();
      expect(r.ok, `${phase} 相位下的会话被标成了重连`).toBe(false);
      expect(r.ok ? null : r.reason).toBe('unexpected-message');
      expect(g.phase(), `${phase} 相位被改了`).toBe(phase);
      expect(g.peerStatus(), `${phase} 相位的读数被改了`).toEqual(before);
    }
  });

  it('(d) 时序腿：先 ack 后标记 ⇒ 被拒；先标记后 ack ⇒ 成功且相位仍是 resuming', () => {
    // 先 ack
    const late = guestSession();
    acceptOk(late, { t: 'hello-ack', msg: overWire(helloAck()) });
    expect(late.markResuming().ok, '先喂 ack 之后才标记重连 —— 必须被拒（D21 第四轮写实的时机）').toBe(false);
    expect(late.phase()).toBe('awaiting-commit');

    // 先标记
    const early = guestSession();
    expect(early.markResuming().ok).toBe(true);
    acceptOk(early, { t: 'hello-ack', msg: overWire(helloAck()) });
    expect(early.phase(), 'resuming 相位下的 hello-ack 保持 resuming（追平是下一步）').toBe('resuming');
    expect(early.peerStatus().needsResync).toBe(true);
  });

  it('(e) 反向自证：`acceptHelloAck` 里没有任何"从 ack 读 resuming"的地方（文本腿）', () => {
    const code = stripComments(readFileSync(join(NET_DIR, 'session.ts')).subarray(0, 4 * 1024 * 1024).toString('utf8'));
    const body = braceBodyOf(code, 'acceptHelloAck');
    expect(body.length, 'acceptHelloAck 的函数体切出来太短（切错了？）').toBeGreaterThan(200);
    expect(body.includes('isObj'), '切出来的不是 acceptHelloAck 的函数体').toBe(true);
    // 判据是"**从 ack 里读** resuming"（也就是成员访问 `.resuming`），不是"出现 resuming 这个词"：
    // 那个函数体里合法地出现了相位名 `'resuming'`（它就是"重连那一格"，守卫要认得它）。
    const readsAckResuming = /\.\s*resuming\b/;
    expect(readsAckResuming.test(body), 'ack 里没有 resuming 字段，读它就是猜（N-11）').toBe(false);
    // 正控：同一个判定喂进一段真的读 msg.resuming 的代码必须命中
    expect(readsAckResuming.test(braceBodyOf('function acceptHelloAck(msg) { if (msg.resuming) return 1; }', 'acceptHelloAck'))).toBe(true);
    // 反控：`acceptHello`（hello **确实**带 resuming 字段）里必须命中 —— 证明这条判定不是恒假
    expect(readsAckResuming.test(stripComments(readFileSync(join(NET_DIR, 'session.ts')).subarray(0, 4 * 1024 * 1024).toString('utf8')))).toBe(true);
  });
});

/* ------------------------------------------------------------------ *
 * D23 那条（判据 6）：按相位重新驱动 + 收方幂等
 * ------------------------------------------------------------------ */

describe('D23 那条：卡在半路的握手消息被重新驱动 ⇒ 两端走完承诺流程、各自落定面/盐', () => {
  it('★ 主腿：加入方的 `commit-ack` 丢在半路 ⇒ 重连之后房主重发 `commit`，流程走完（不是停住、不是报错结束）', () => {
    const { file } = playArchive(ARCHIVE_STEPS);
    const clock = fakeClock(0);
    const host = hostSession({ clock, file });
    const guest = guestSession({ clock });

    // ① 房主：握手 → 发 commit（相位**不变**：`sendCommit` 的设计）。那条 commit 到了加入方。
    const hd = host.accept({ t: 'hello', msg: overWire(hello()) });
    expect(hd.ok).toBe(true);
    if (!hd.ok) throw new Error('unreachable');
    const c = host.sendCommit(SEED, SALT);
    expect(c.ok).toBe(true);
    if (!c.ok) throw new Error('unreachable');
    expect(host.phase(), 'sendCommit 之后相位不该变').toBe('awaiting-commit-face');
    // ② 老的那条加入方对象：收下 commit 并回了 ack —— **那条 ack 丢在链路里**（没有喂给房主）
    const oldGuest = guestSession({ clock });
    acceptOk(oldGuest, { t: 'hello-ack', msg: overWire(hd.output) });
    feed(oldGuest, c.output);
    expect(oldGuest.sendCommitAck().ok).toBe(true);
    expect(oldGuest.phase(), '夹具问题：老对象该停在 awaiting-commit-ack').toBe('awaiting-commit-ack');
    // 房主仍在 `awaiting-commit-face`（它从没收到那条 ack）—— 这正是"卡在半路"的形状
    expect(host.phase()).toBe('awaiting-commit-face');

    // ③ 断线 + 重连：新的加入方对象（重连握手是"用它自己的 sessionId 重新握手"）。
    //    顺序取"resync-res 先到"（另一条腿取反过来那个顺序）。
    const { receivedFile } = guestReconnectsToPending(host, guest, 0);
    const applied = guest.applyResyncFile(receivedFile, receivedFile.actions.length);
    expect(applied.ok, '追平被拒了').toBe(true);
    expect(guest.phase(), '追平之后加入方在等房主的 commit').toBe('awaiting-commit');

    // ④ ★ D23 ②：房主按相位把"该发而未确认"的那条重发一次
    const redrive = host.redrive();
    expect(redrive.ok).toBe(true);
    if (!redrive.ok) throw new Error('unreachable');
    expect(redrive.output?.t, '房主在 awaiting-commit-face + 已有 seedHash 时必须重发 commit').toBe('commit');
    if (redrive.output === null) throw new Error('unreachable');
    // 重发的必须是**逐字相同**的那一条（相位是唯一依据，不重新算哈希）
    expect(JSON.stringify(redrive.output.msg)).toBe(JSON.stringify(c.output.msg));
    feed(guest, redrive.output);
    expect(guest.phase(), '加入方没收下重发的 commit').toBe('seed-committed');

    // ⑤ 接线的正常反应：收下 commit ⇒ 回 ack；然后一路走完
    const ack = guest.sendCommitAck();
    expect(ack.ok).toBe(true);
    if (!ack.ok) throw new Error('unreachable');
    feed(host, ack.output);
    const cf = guest.commitFace(1, 'nonce-T6');
    expect(cf.ok).toBe(true);
    if (!cf.ok) throw new Error('unreachable');
    feed(host, cf.output);
    const rs = host.sendRevealSeed();
    expect(rs.ok).toBe(true);
    if (!rs.ok) throw new Error('unreachable');
    feed(guest, rs.output);
    const rf = guest.sendRevealFace();
    expect(rf.ok).toBe(true);
    if (!rf.ok) throw new Error('unreachable');
    feed(host, rf.output);
    const rv = host.sendRevealSalt();
    expect(rv.ok, `收完面之后房主发不出盐：${rv.ok ? '' : rv.message}`).toBe(true);
    if (!rv.ok) throw new Error('unreachable');
    feed(guest, rv.output);

    // ⑥ 断言：两端都到 complete，面与盐各自落定，且没有重复发盐
    expect(host.phase(), '房主没走完（流程停住了）').toBe('complete');
    expect(guest.phase(), '加入方没走完（流程停住了）').toBe('complete');
    expect(host.face(), '房主没落定加入方选的那个面').toBe(1);
    expect(guest.commitmentVerified(), '加入方没验通承诺').toBe(true);
    expect(host.salt()).toBe(SALT);
    expect(guest.salt(), '加入方没收到盐').toBe(SALT);
    expect(host.sendRevealSalt().ok, '同一局里重复发了盐').toBe(false);
  });

  it('★ 第二条腿：房主的 `reveal-salt` 丢在半路 ⇒ 重连后房主重发那一条，加入方收下并验通', () => {
    const clock = fakeClock(0);
    const host = hostSession({ clock });
    const guest = guestSession({ clock });
    // 走到"房主拿到了面、盐已经产出但**那条消息丢了**"
    const hd = host.accept({ t: 'hello', msg: overWire(hello()) });
    expect(hd.ok).toBe(true);
    if (!hd.ok) throw new Error('unreachable');
    acceptOk(guest, { t: 'hello-ack', msg: overWire(hd.output) });
    const c = host.sendCommit(SEED, SALT);
    expect(c.ok).toBe(true);
    if (!c.ok) throw new Error('unreachable');
    feed(guest, c.output);
    const ack = guest.sendCommitAck();
    expect(ack.ok).toBe(true);
    if (!ack.ok) throw new Error('unreachable');
    feed(host, ack.output);
    const cf = guest.commitFace(0, 'nonce-lost-salt');
    expect(cf.ok).toBe(true);
    if (!cf.ok) throw new Error('unreachable');
    feed(host, cf.output);
    const rs = host.sendRevealSeed();
    expect(rs.ok).toBe(true);
    if (!rs.ok) throw new Error('unreachable');
    feed(guest, rs.output);
    const rf = guest.sendRevealFace();
    expect(rf.ok).toBe(true);
    if (!rf.ok) throw new Error('unreachable');
    feed(host, rf.output);
    const salt = host.sendRevealSalt();
    expect(salt.ok).toBe(true);
    if (!salt.ok) throw new Error('unreachable');
    // ★ 那条盐**没有**被喂给加入方 —— 它丢在链路里（`act` 的"可靠"只在每条连接之内）
    expect(guest.phase(), '加入方该停在 reveal-salt-sent（它在等盐）').toBe('reveal-salt-sent');
    expect(guest.commitmentVerified(), '还没收到盐就不该有验证结论').toBeNull();

    // 重连（这一轮里加入方那一侧没有丢操作，所以它不需要追平；承重的是房主的按相位重发）
    const redrive = host.redrive();
    expect(redrive.ok).toBe(true);
    if (!redrive.ok) throw new Error('unreachable');
    expect(redrive.output?.t, '房主在 complete + saltMadePublic 时必须重发 reveal-salt').toBe('reveal-salt');
    if (redrive.output === null) throw new Error('unreachable');
    expect(JSON.stringify(redrive.output.msg), '重发的盐必须与第一次逐字相同').toBe(JSON.stringify(salt.output.msg));
    feed(guest, redrive.output);

    expect(guest.phase(), '加入方没走完').toBe('complete');
    expect(guest.commitmentVerified(), '加入方收下重发的盐之后必须验通').toBe(true);
    expect(guest.salt()).toBe(SALT);
    // ★ 第二条盐（同一内容）会被拒 —— 这是 T3 既有腿钉住的出口，D23 没改它；
    //    它发生在**验签已经完成之后**，所以不影响"流程走完"（如实钉在这里，别当缺陷）
    const again = guest.accept({ t: 'reveal-salt', msg: overWire({ t: 'reveal-salt', salt: SALT }) });
    expect(again.ok, '第二条盐被接受了（那会打开"重放改写终态"的口子）').toBe(false);
    expect(again.ok ? null : again.reason).toBe('unexpected-message');
    expect(guest.commitmentVerified(), '被拒的那条盐改动了验证结论').toBe(true);
  });

  it('★ 第三条腿（B1 正控）：**本相位期待的那条**的逐字重复 ⇒ 幂等无操作（ok / output null / 相位与值都不动）', () => {
    // (i) 加入方：`seed-committed` 正是 `commit` 产生的那一格 ⇒ 逐字重复是幂等无操作
    const g = guestAt('seed-committed');
    const beforeCommit = g.peerStatus();
    const dupCommit = g.accept({ t: 'commit', msg: overWire({ t: 'commit', hash: sha256Concat(SEED, SALT) }) });
    expect(dupCommit.ok, '本相位期待的那条的逐字重复被拒了（D23 ① 要的是幂等无操作）').toBe(true);
    expect(dupCommit.ok ? dupCommit.output : 'x', '幂等无操作不许产出发包').toBeNull();
    expect(g.phase(), '幂等无操作改了相位').toBe('seed-committed');
    expect(g.peerStatus(), '幂等无操作改了读数').toEqual(beforeCommit);

    // (ii) 房主：已经验过的面再收到一次（逐字相同）；`complete` 正是 `reveal-face` 产生的那一格
    const h = hostSession();
    const hd = h.accept({ t: 'hello', msg: overWire(hello()) });
    expect(hd.ok).toBe(true);
    const c = h.sendCommit(SEED, SALT);
    expect(c.ok).toBe(true);
    acceptOk(h, { t: 'commit-face', msg: overWire({ t: 'commit-face', hash: sha256Concat('1', 'nonce-x') }) });
    expect(h.sendRevealSeed().ok).toBe(true);
    const faceMsg = overWire({ t: 'reveal-face', face: 1, faceNonce: 'nonce-x' });
    acceptOk(h, { t: 'reveal-face', msg: faceMsg });
    expect(h.phase()).toBe('complete');
    const beforeFace = h.peerStatus();
    const dupFace = h.accept({ t: 'reveal-face', msg: faceMsg });
    expect(dupFace.ok, '逐字相同的重复 reveal-face 被拒了').toBe(true);
    expect(dupFace.ok ? dupFace.output : 'x').toBeNull();
    expect(h.phase()).toBe('complete');
    expect(h.face(), '幂等无操作改写了已记录的面').toBe(1);
    expect(h.peerStatus()).toEqual(beforeFace);
  });

  it('★ 第三条腿（B1 的边界，阶段一评审 K2 的收窄）：**不是**产生当前相位的那条 ⇒ 照旧拒绝', () => {
    // D23 ① 的适用范围是"**本相位期待的那条消息**的逐字重复"，也就是"正是产生当前相位的那条"。
    // `commit` 产生的是 `seed-committed`；在它之后的四格上，逐字相同的 `commit` **不再**是重传，
    // 而是"本相位不期待的消息"（R8 的 B4 那一格）⇒ 必须走 T3 的既有出口。
    //
    // 为什么单列一条：第一版只判"逐字相同"，于是这四格也被报成 `ok` —— **比裁决宽、而且没有腿看着**
    // （评审的 K2 实测：判据面 117 条一条不红）。这一条就是那条缺失的腿。
    for (const phase of ['awaiting-commit-ack', 'face-committed', 'seed-revealed', 'complete'] as const) {
      const g = guestAt(phase);
      const before = g.peerStatus();
      const dup = g.accept({ t: 'commit', msg: overWire({ t: 'commit', hash: sha256Concat(SEED, SALT) }) });
      expect(dup.ok, `${phase} 上一条逐字相同的重复 commit 被当成了重传（它不是产生这一格的那条）`).toBe(false);
      expect(dup.ok ? null : dup.reason, `${phase} 上的拒绝理由码`).toBe('unexpected-message');
      expect(g.phase(), `${phase} 上的拒绝改了相位`).toBe(phase);
      expect(g.peerStatus(), `${phase} 上的拒绝改了读数`).toEqual(before);
    }
    // 反控（证明上面那条不是"这一支整个坏了"）：产生当前相位的那一格**必须**是幂等的
    const ok = guestAt('seed-committed');
    const dup = ok.accept({ t: 'commit', msg: overWire({ t: 'commit', hash: sha256Concat(SEED, SALT) }) });
    expect(dup.ok, 'seed-committed 这一格本该是幂等的那一格').toBe(true);
  });

  it('★ 第三条腿（B2 反控）：类型对但**内容不同** ⇒ 照旧拒绝（D23 不许开这个口子）', () => {
    const g = guestAt('awaiting-commit-ack');
    const diff = acceptRejected(g, { t: 'commit', msg: overWire({ t: 'commit', hash: '另一个哈希' }) });
    expect(diff.reason).toBe('unexpected-message');
    expect(g.phase(), '内容不同的 commit 改动了相位').toBe('awaiting-commit-ack');

    const h = hostSession();
    const hd = h.accept({ t: 'hello', msg: overWire(hello()) });
    expect(hd.ok).toBe(true);
    expect(h.sendCommit(SEED, SALT).ok).toBe(true);
    acceptOk(h, { t: 'commit-face', msg: overWire({ t: 'commit-face', hash: sha256Concat('1', 'nonce-x') }) });
    expect(h.sendRevealSeed().ok).toBe(true);
    acceptOk(h, { t: 'reveal-face', msg: overWire({ t: 'reveal-face', face: 1, faceNonce: 'nonce-x' }) });
    const bad = acceptRejected(h, { t: 'reveal-face', msg: overWire({ t: 'reveal-face', face: 0, faceNonce: 'nonce-x' }) });
    expect(bad.reason, '内容不同的面必须仍被拒（篡改面那一族）').toBe('unexpected-message');
    expect(h.face(), '被拒的面改写了已落定的面').toBe(1);
  });

  it('★ 第三条腿（B3 方向错误仍拒 + B4 既有出口不动）', () => {
    // B3：房主从来不该"收"自己的盐（N-8 的 API 事实），D23 不放行它
    const h = hostSession();
    const hd = h.accept({ t: 'hello', msg: overWire(hello()) });
    expect(hd.ok).toBe(true);
    expect(h.sendCommit(SEED, SALT).ok).toBe(true);
    const b3 = acceptRejected(h, { t: 'reveal-salt', msg: overWire({ t: 'reveal-salt', salt: '对面塞进来的盐' }) });
    expect(b3.reason).toBe('unexpected-message');
    expect(h.salt(), '房主自己的盐被入站消息覆盖了').toBe(SALT);

    // B4：加入方收到的**重复种子**照旧走 T3 的出口（`seed-duplicate`），D23 没把它改成无操作
    const g = guestSession();
    acceptOk(g, { t: 'hello-ack', msg: overWire(helloAck()) });
    acceptOk(g, { t: 'commit', msg: overWire({ t: 'commit', hash: sha256Concat(SEED, SALT) }) });
    expect(g.sendCommitAck().ok).toBe(true);
    expect(g.commitFace(1, 'nonce-x').ok).toBe(true);
    feed(g, { t: 'reveal-seed', msg: { t: 'reveal-seed', seed: SEED } } as SessionOutbound);
    const dupSeed = acceptRejected(g, { t: 'reveal-seed', msg: overWire({ t: 'reveal-seed', seed: SEED }) });
    expect(dupSeed.reason, '重复种子必须仍报 seed-duplicate（既有出口）').toBe('seed-duplicate');
    expect(g.seed()).toBe(SEED);
  });

  it('★ 第四条腿：重发是**一次显式动作**，不是自动重试（文本腿 + 正控）', () => {
    const code = stripComments(readFileSync(join(NET_DIR, 'session.ts')).subarray(0, 4 * 1024 * 1024).toString('utf8'));
    expect(code.length, 'session.ts 读成空串（下面的断言会在空串上恒真）').toBeGreaterThan(2000);
    // 定时器那一半由 T1 的守卫（`tests/net/net-purity.test.ts`）负责；这里补一句本地的，且看的是
    // ★ 唯一可能长出"自动重试"的两个函数体：`redriveOutput` / `redrive`
    for (const name of ['redriveOutput', 'redrive']) {
      const body = braceBodyOf(code, name);
      expect(body.length, `${name} 的函数体太短（切错了？）`).toBeGreaterThan(30);
      // 切出来的必须真的是那个函数体（否则"里面没有循环"是空转）
      expect(
        body.includes(name === 'redrive' ? 'redriveOutput()' : 'outbound('),
        `切出来的不是 ${name} 的函数体`,
      ).toBe(true);
      for (const bad of ['for (', 'while (', 'setTimeout', 'setInterval', 'requestAnimationFrame']) {
        expect(body.includes(bad), `${name} 里出现了 ${bad}（自动重试/定时器，D23 明确禁止）`).toBe(false);
      }
    }
    // 正控：同一个判定喂进一段真有循环的代码必须命中
    expect(braceBodyOf('function redrive() { for (;;) { retry(); } }', 'redrive').includes('for (')).toBe(true);
    expect(code.includes('setTimeout'), 'session.ts 里出现了定时器').toBe(false);
  });
});

/* ------------------------------------------------------------------ *
 * D19 那条（判据 8）：resume 回来后能走完承诺流程（入口问题）
 * ------------------------------------------------------------------ */

describe('D19 那条：resume 回来后承诺流程能继续走完（机制选的是 (A)：acceptCommit 也认 resuming）', () => {
  it('★ 重发的 `commit` **早于** resync-res 到达时，加入方在 `resuming` 相位下必须收下它并继续走完', () => {
    const { file } = playArchive(ARCHIVE_STEPS);
    const clock = fakeClock(0);
    const host = hostSession({ clock, file });
    const guest = guestSession({ clock });

    // 房主：握手 + 发出承诺（此后它在 awaiting-commit-face 等对端的 commit-face）
    const hd = host.accept({ t: 'hello', msg: overWire(hello()) });
    expect(hd.ok).toBe(true);
    const c = host.sendCommit(SEED, SALT);
    expect(c.ok).toBe(true);
    if (!c.ok) throw new Error('unreachable');

    // 加入方重连：markResuming → 房主接住重连握手 → 加入方收 ack（相位保持 resuming）
    expect(guest.markResuming().ok).toBe(true);
    const hd2 = host.accept({ t: 'hello', msg: overWire(hello({ resuming: true })) });
    expect(hd2.ok, '房主在半路没接住重连握手').toBe(true);
    if (!hd2.ok) throw new Error('unreachable');
    acceptOk(guest, { t: 'hello-ack', msg: overWire(hd2.output) });
    expect(guest.phase()).toBe('resuming');

    // 房主应答 resync-req（相位回到"进 resuming 之前那一格"）
    const resyncRes = acceptSessionOut(host, {
      t: 'resync-req',
      msg: overWire({ t: 'resync-req', sessionId: SESSION_ID, appliedSteps: 60 }),
    });
    expect(host.phase(), '房主应答完该回到它原来那一格').toBe('awaiting-commit-face');

    // ★ 接线的另一种合法顺序：房主**先**重发那条 commit，resync-res 还在路上
    const redrive = host.redrive();
    expect(redrive.ok).toBe(true);
    if (!redrive.ok) throw new Error('unreachable');
    expect(redrive.output?.t).toBe('commit');
    if (redrive.output === null) throw new Error('unreachable');
    feed(guest, redrive.output);
    expect(guest.phase(), 'D19：resuming 相位必须能接回承诺流程（否则加入方永远卡在 resuming）').toBe(
      'seed-committed',
    );

    // resync-res 到了：照样收得下（needsResync 还没清），追平落在 seed-committed（进度不丢）
    const decodedRes = overWire(resyncRes.msg) as { file: MatchFile };
    acceptOk(guest, { t: 'resync-res', msg: decodedRes });
    expect(guest.phase()).toBe('resync-pending');
    const applied = guest.applyResyncFile(decodedRes.file, decodedRes.file.actions.length);
    expect(applied.ok).toBe(true);
    expect(guest.phase(), '追平不该把已经收下的承诺打回去').toBe('seed-committed');
    expect(guest.peerStatus().needsResync).toBe(false);

    // 走完剩下的流程
    const ack = guest.sendCommitAck();
    expect(ack.ok, '追平之后加入方发不出 ack（相位被打回去了？）').toBe(true);
    if (!ack.ok) throw new Error('unreachable');
    feed(host, ack.output);
    const cf = guest.commitFace(1, 'nonce-D19');
    expect(cf.ok).toBe(true);
    if (!cf.ok) throw new Error('unreachable');
    feed(host, cf.output);
    const rs = host.sendRevealSeed();
    expect(rs.ok).toBe(true);
    if (!rs.ok) throw new Error('unreachable');
    feed(guest, rs.output);
    const rf = guest.sendRevealFace();
    expect(rf.ok).toBe(true);
    if (!rf.ok) throw new Error('unreachable');
    feed(host, rf.output);
    const rv = host.sendRevealSalt();
    expect(rv.ok).toBe(true);
    if (!rv.ok) throw new Error('unreachable');
    feed(guest, rv.output);

    expect(host.phase()).toBe('complete');
    expect(guest.phase()).toBe('complete');
    expect(host.face(), '房主没落定加入方选的面').toBe(1);
    expect(guest.commitmentVerified()).toBe(true);
  });

  it('★ 第二条（重复的）resuming hello 不许毁掉"原来那一格"（阶段一评审的阻断项）', () => {
    // ## 缺陷的形状（修之前）
    //
    // `acceptHello` 的 resuming 格原来无条件 `phaseBeforeResuming = s.phase; s.phase = 'resuming'`。
    // **第二条**同 `sessionId` + `resuming:true` 的 hello 到达时 `s.phase` 已经是 `'resuming'`
    // ⇒ 基线被写成 `'resuming'`、原来那一格丢了 ⇒ 应答 `resync-req` 时"恢复"回 `resuming`
    // ⇒ 房主**永久停在 resuming**（`sendRevealSeed` 报 `seed-before-face`、`sendRevealSalt` 被拒、
    // `redrive().output === null`）—— 承诺流程静默停住，而判据面 117 条一条不红
    // （评审的 K1/K2 两个变异都实测过这一点）。
    //
    // ## 修法（这一格做成幂等）+ 这条腿的牙
    //
    //  - 第一条：进 `resuming`、基线记成"原来那一格"（`seed-revealed`）；
    //  - 第二条（逐字相同）：照旧回**同一条** ack（逐字相同），但相位/读数**一个都不动**
    //    —— 这里先断言"第一条之后是什么样"，再断言"第二条之后一模一样"，否则这条腿在
    //    "本来就没有原来那一格"的夹具上会恒真；
    //  - 应答 `resync-req` ⇒ 相位必须回到 `'seed-revealed'`，且 `sendRevealSeed` 仍不可用
    //    （那一格本来就不能再揭示）、`redrive()` 必须推得出 `reveal-seed`
    //    —— 后两条是**后果**，比只读相位更难被"改个赋值"糊过去。
    const { file } = playArchive(ARCHIVE_STEPS);
    const host = hostSession({ file });
    const hd = host.accept({ t: 'hello', msg: overWire(hello()) });
    expect(hd.ok).toBe(true);
    expect(host.sendCommit(SEED, SALT).ok).toBe(true);
    acceptOk(host, { t: 'commit-face', msg: overWire({ t: 'commit-face', hash: sha256Concat('1', 'nonce-x') }) });
    expect(host.sendRevealSeed().ok).toBe(true);
    expect(host.phase(), '夹具问题：房主该停在 seed-revealed').toBe('seed-revealed');

    // 第一条 resuming hello
    const first = host.accept({ t: 'hello', msg: overWire(hello({ resuming: true })) });
    expect(first.ok).toBe(true);
    if (!first.ok) throw new Error('unreachable');
    expect(host.phase(), '第一条 resuming hello 之后该进 resuming').toBe('resuming');
    expect(host.peerStatus().needsResync).toBe(true);
    const afterFirst = host.peerStatus();

    // 第二条（逐字相同）
    const second = host.accept({ t: 'hello', msg: overWire(hello({ resuming: true })) });
    expect(second.ok, '第二条 resuming hello 被拒了（这一格该是幂等的）').toBe(true);
    if (!second.ok) throw new Error('unreachable');
    expect(host.phase(), '第二条 resuming hello 把相位搬走了').toBe('resuming');
    expect(host.peerStatus(), '第二条 resuming hello 改了读数').toEqual(afterFirst);
    // ack 必须与第一条逐字相同（"重复的握手 ⇒ 同一条 ack"）
    expect(JSON.stringify(second.output)).toBe(JSON.stringify(first.output));

    // 应答 resync-req ⇒ 回到"原来那一格"（不是 resuming）
    const resyncRes = acceptSessionOut(host, {
      t: 'resync-req',
      msg: overWire({ t: 'resync-req', sessionId: SESSION_ID, appliedSteps: 0 }),
    });
    expect(host.phase(), '两条 resuming hello 之后房主永久卡在 resuming（评审的阻断项）').toBe('seed-revealed');
    expect(resyncRes.t).toBe('resync-res');
    // 后果面：房主的"该发而未确认"那条必须是 reveal-seed（而不是 null）
    const redrive = host.redrive();
    expect(redrive.ok).toBe(true);
    if (!redrive.ok) throw new Error('unreachable');
    expect(redrive.output?.t, '房主推不出该重发的那条消息（流程会静默停住）').toBe('reveal-seed');
    expect(host.sendRevealSalt().ok, 'seed-revealed 本来就不该能发盐').toBe(false);
  });

  it('反控：普通（非 resuming）的迟到 hello 照旧被忽略、状态一动不动（N-6 的腿在这里也成立）', () => {
    const clock = fakeClock(0);
    const host = hostSession({ clock, file: null });
    const hd = host.accept({ t: 'hello', msg: overWire(hello()) });
    expect(hd.ok).toBe(true);
    expect(host.sendCommit(SEED, SALT).ok).toBe(true);
    const before = host.peerStatus();
    const late = host.accept({ t: 'hello', msg: overWire(hello()) });
    expect(late.ok, '普通迟到的 hello 被接受了（那等于重开握手）').toBe(false);
    expect(late.ok ? null : late.reason).toBe('unexpected-message');
    expect(host.phase(), '一条重放消息把相位打走了').toBe('awaiting-commit-face');
    expect(host.peerStatus()).toEqual(before);
    // 而"带着同一个 sessionId 回来"的重连握手是**另**一件事：它被接住，且不推翻本局
    const again = host.accept({ t: 'hello', msg: overWire(hello({ resuming: true })) });
    expect(again.ok, '重连握手被当成迟到的 hello 忽略了').toBe(true);
    expect(host.phase()).toBe('resuming');
    expect(host.peerStatus().needsResync).toBe(true);
  });
});

/* ------------------------------------------------------------------ *
 * D19 那条的入口时序反控 + resync-req 形状那条（判据 10）
 * ------------------------------------------------------------------ */

describe('resync-req 形状那条：sessionId 不符 / appliedSteps 不是非负整数 ⇒ 拒绝且不回档案', () => {
  it('sessionId 属于另一局 ⇒ bad-resync，且不产出任何档案', () => {
    const { file } = playArchive(4);
    const host = hostSession({ file });
    const before = host.peerStatus();
    const r = host.accept({ t: 'resync-req', msg: overWire({ t: 'resync-req', sessionId: '另一局', appliedSteps: 0 }) });
    expect(r.ok, '把本局档案交给了另一局的重连请求').toBe(false);
    expect(r.ok ? null : r.reason).toBe('bad-resync');
    expect(host.peerStatus(), '被拒的重连请求改了读数').toEqual(before);
  });

  it('appliedSteps 不是非负整数 ⇒ bad-resync', () => {
    const { file } = playArchive(4);
    const host = hostSession({ file });
    for (const bad of [-1, 1.5, '3', null, undefined]) {
      const r = host.accept({ t: 'resync-req', msg: { t: 'resync-req', sessionId: SESSION_ID, appliedSteps: bad } });
      expect(r.ok, `appliedSteps=${JSON.stringify(bad)} 被接受了`).toBe(false);
      expect(r.ok ? null : r.reason).toBe('bad-resync');
    }
    // 正控：合法的形状必须接受（否则上面那些"被拒"对"这一支整个坏了"也成立）
    const okReq = host.accept({ t: 'resync-req', msg: { t: 'resync-req', sessionId: SESSION_ID, appliedSteps: 0 } });
    expect(okReq.ok).toBe(true);
  });

  it('反控：房主没有档案来源时回 resync-not-wired（fail-closed，不编一份空档案出去）', () => {
    const host = hostSession();
    const hd = host.accept({ t: 'hello', msg: overWire(hello()) });
    expect(hd.ok).toBe(true);
    const r = host.accept({ t: 'resync-req', msg: overWire({ t: 'resync-req', sessionId: SESSION_ID, appliedSteps: 0 }) });
    expect(r.ok).toBe(false);
    expect(r.ok ? null : r.reason).toBe('resync-not-wired');
    expect(r.ok ? null : r.message).toBe(RESYNC_NOT_WIRED_MESSAGE);
    expect(host.phase(), '被拒的 resync-req 改动了相位').toBe('awaiting-commit-face');
  });
});

/* ------------------------------------------------------------------ *
 * 追平步数比较那条（判据 11）
 * ------------------------------------------------------------------ */

describe('追平步数比较那条：`statesAtStep` 必须恰好等于档案长度（少一步也拒）', () => {
  it('★ 少一步 ⇒ resync-step-mismatch，且相位与 needsResync 都不动（fail-closed）', () => {
    const { file } = playArchive(ARCHIVE_STEPS);
    const host = hostSession({ file });
    const guest = guestSession();
    const { receivedFile } = guestReconnectsToPending(host, guest, ARCHIVE_STEPS - 1);
    expect(guest.phase()).toBe('resync-pending');

    const applied = guest.applyResyncFile(receivedFile, receivedFile.actions.length - 1);
    expect(applied.ok, '少应用一步却被接受了（那会让两端静默不同步）').toBe(false);
    expect(applied.ok ? null : applied.reason).toBe('resync-step-mismatch');
    expect(guest.phase(), '被拒的追平改了相位').toBe('resync-pending');
    expect(guest.peerStatus().needsResync, '被拒的追平把 needsResync 清掉了').toBe(true);

    // 正控：恰好等于档案长度时必须接受
    const good = guest.applyResyncFile(receivedFile, receivedFile.actions.length);
    expect(good.ok, `恰好等于档案长度时仍被拒：${good.ok ? '' : good.message}`).toBe(true);
    expect(guest.peerStatus().needsResync).toBe(false);
  });

  it('多一步 / 非整数也拒；而且**不能碰** `stateAtStep`（会话层不重放）', () => {
    const { file } = playArchive(ARCHIVE_STEPS);
    const host = hostSession({ file });
    const guest = guestSession();
    const { receivedFile } = guestReconnectsToPending(host, guest, 0);
    for (const n of [ARCHIVE_STEPS + 1, 1.5, Number.NaN, -1]) {
      const applied = guest.applyResyncFile(receivedFile, n);
      expect(applied.ok, `statesAtStep=${String(n)} 被接受了`).toBe(false);
      expect(applied.ok ? null : applied.reason).toBe('resync-step-mismatch');
      expect(guest.phase()).toBe('resync-pending');
    }
  });

  it('档案形状不可用 ⇒ bad-resync（网络来的坏档案不抛，走结果对象）', () => {
    const host = hostSession({ file: null });
    const guest = guestSession();
    expect(guest.markResuming().ok).toBe(true);
    const hd = host.accept({ t: 'hello', msg: overWire(hello({ resuming: true })) });
    expect(hd.ok).toBe(true);
    if (!hd.ok) throw new Error('unreachable');
    acceptOk(guest, { t: 'hello-ack', msg: overWire(hd.output) });
    // `acceptResyncRes` 只做**够用的**形状检查（`protocol.ts` 的 `SHAPES['resync-res']` 只判
    // `isObj(m.file)`），所以"深处不成形"的档案要走到 `applyResyncFile` 的归一化那一步才被拒。
    const garbage = { setup: {}, actions: 'not-an-array' } as unknown as MatchFile;
    const accepted = guest.accept({ t: 'resync-res', msg: { t: 'resync-res', file: garbage } });
    expect(accepted.ok, '这一层只判最外层形状').toBe(true);
    expect(guest.phase()).toBe('resync-pending');
    const applied = guest.applyResyncFile(garbage, 0);
    expect(applied.ok, '深处不成形的档案被当成可追平的了').toBe(false);
    expect(applied.ok ? null : applied.reason).toBe('bad-resync');
    expect(guest.phase(), '被拒的追平改了相位').toBe('resync-pending');
    expect(guest.peerStatus().needsResync, '被拒的追平清了 needsResync').toBe(true);

    // 正控：同一份"深处可用"的最小档案必须被接受（否则上面那条对"这一支整个坏了"也成立）
    const minimal: MatchFile = {
      format: MATCH_FILE_FORMAT,
      version: MATCH_FILE_VERSION,
      cardDataHash: CARD_DATA_HASH,
      seed: 'probe',
      setup: { draftMode: 'normal', draftStarter: 0, firstToPlay: 1, draftPool: [], draftPicks: [], bannedProtocols: [] },
      players: [{ nick: 'a' }, { nick: 'b' }],
      actions: [],
      createdAt: '2026-01-01T00:00:00.000Z',
    };
    const okApply = guest.applyResyncFile(minimal, 0);
    expect(okApply.ok, `最小档案被拒了：${okApply.ok ? '' : okApply.message}`).toBe(true);
  });
});

/* ------------------------------------------------------------------ *
 * online 三组合那条（判据 12）+ N-9 交叉核对（判据 13）
 * ------------------------------------------------------------------ */

describe('online 三组合那条：两个输入决定一个读数，且**不由相位决定**', () => {
  it('三个组合：online+窗口内 ⇒ true；online+超窗 ⇒ false；offline+窗口内 ⇒ false', () => {
    const clock = fakeClock(0);
    const s = hostSession({ clock });
    // 还没喂过传输状态 ⇒ 不许报在线（"不知道"不等于"在线"）
    expect(s.peerStatus().online, '没喂过传输状态就报在线').toBe(false);
    s.noteTransportStatus('online');
    expect(s.peerStatus().online).toBe(true);
    clock.set(300_001);
    expect(s.peerStatus().online).toBe(false);
    clock.set(0);
    s.noteTransportStatus('offline');
    expect(s.peerStatus().online).toBe(false);
    s.noteTransportStatus('online');
    expect(s.peerStatus().online).toBe(true);
  });

  it('★ 反假绿：相位 complete 但传输 offline ⇒ online 仍为 false（相位不是输入）', () => {
    const clock = fakeClock(0);
    const host = hostSession({ clock });
    const guest = guestSession({ clock });
    runCommitmentFull(host, guest);
    expect(guest.phase()).toBe('complete');
    guest.noteTransportStatus('online');
    expect(guest.peerStatus().online).toBe(true);
    guest.noteTransportStatus('offline');
    expect(guest.phase(), '前提：相位仍是 complete').toBe('complete');
    expect(guest.peerStatus().online, '相位是 complete 就报在线 —— 那是 D19 点名的假读数').toBe(false);
  });

  it('每个传输状态都被真的投影过（镜像闭合的运行期一半）', () => {
    const clock = fakeClock(0);
    const observed: string[] = [];
    for (const status of Object.keys(TRANSPORT_TO_SESSION) as TransportStatus[]) {
      const s = hostSession({ clock });
      s.noteTransportStatus(status);
      observed.push(`${status}->online=${String(s.peerStatus().online)}`);
      expect(s.peerStatus().online, `status=${status} 的投影`).toBe(status === 'online');
    }
    // 覆盖类断言**打印实测分布**（否则"每个状态都投影过"看不出到底试了哪些）
    console.log(`T6-ONLINE-PROJECTION ${observed.join(' ')}`);
    expect(observed.length, '一个状态都没试到（表是空的？）').toBe(5);
  });

  it('没有注入时钟 ⇒ windowExpired 报 null（判不了），online 只由传输状态决定', () => {
    const s = hostSession();
    expect(s.peerStatus().windowExpired, '没有时钟却报了一个真假值').toBeNull();
    s.noteTransportStatus('online');
    expect(s.peerStatus().online).toBe(true);
    s.noteTransportStatus('offline');
    expect(s.peerStatus().online).toBe(false);
  });
});

/** 传输状态与会话层那份**镜像**的双向表（见下一条腿） */
const TRANSPORT_TO_SESSION: Record<TransportStatus, SessionTransportStatus> = {
  idle: 'idle',
  connecting: 'connecting',
  online: 'online',
  offline: 'offline',
  closed: 'closed',
};
const SESSION_TO_TRANSPORT: Record<SessionTransportStatus, TransportStatus> = {
  idle: 'idle',
  connecting: 'connecting',
  online: 'online',
  offline: 'offline',
  closed: 'closed',
};

describe('镜像闭合：`TransportStatus` ↔ `SessionTransportStatus` 双向钉死（编译期）', () => {
  it('两张表把两个 union 双向覆盖；任一边加值都会让 tsc 报缺键', () => {
    // 这两张表**故意手写两份**（不是同一个对象的两个名字）：`Record<A, B>` 与 `Record<B, A>`
    // 各管一个方向的"缺键"与"值域"检查，加一边的值而没加另一边 ⇒ `tsc` 当场红。
    expect(Object.keys(SESSION_TO_TRANSPORT).sort()).toEqual(['closed', 'connecting', 'idle', 'offline', 'online']);
    expect(Object.keys(TRANSPORT_TO_SESSION).sort()).toEqual(['closed', 'connecting', 'idle', 'offline', 'online']);
    // 两个方向的**值**必须一致（否则"投影"会把一个状态映射成另一个）
    for (const [from, to] of Object.entries(TRANSPORT_TO_SESSION)) {
      expect(SESSION_TO_TRANSPORT[to as SessionTransportStatus], `${from} 的投影不是一对一`).toBe(from);
    }
    // 反空转：两张表都不许是空的（空表上"相等"恒真）
    expect(Object.keys(TRANSPORT_TO_SESSION).length, '镜像表是空的').toBeGreaterThan(0);
  });
});

/* ------------------------------------------------------------------ *
 * N-9 交叉核对那条（判据 13）
 * ------------------------------------------------------------------ */

describe('N-9 交叉核对那条：`acceptsInput` 不表示"这一局是好的"', () => {
  it('★ 验盐失败的加入方：acceptsInput 为 true，而 commitmentVerified() 为 false', () => {
    const clock = fakeClock(0);
    const host = hostSession({ clock });
    const guest = guestSession({ clock });
    const hd = host.accept({ t: 'hello', msg: overWire(hello()) });
    expect(hd.ok).toBe(true);
    if (!hd.ok) throw new Error('unreachable');
    acceptOk(guest, { t: 'hello-ack', msg: overWire(hd.output) });
    const c = host.sendCommit(SEED, SALT);
    expect(c.ok).toBe(true);
    if (!c.ok) throw new Error('unreachable');
    feed(guest, c.output);
    const ack = guest.sendCommitAck();
    expect(ack.ok).toBe(true);
    if (!ack.ok) throw new Error('unreachable');
    feed(host, ack.output);
    const cf = guest.commitFace(1, 'nonce-n9');
    expect(cf.ok).toBe(true);
    if (!cf.ok) throw new Error('unreachable');
    feed(host, cf.output);
    const rs = host.sendRevealSeed();
    expect(rs.ok).toBe(true);
    if (!rs.ok) throw new Error('unreachable');
    feed(guest, rs.output);
    // 篡改 salt（照 T3 的 N-9 腿）：验不过，但相位照样被推到 complete
    const bad = acceptRejected(guest, { t: 'reveal-salt', msg: overWire({ t: 'reveal-salt', salt: '换了一个 salt' }) });
    expect(bad.reason).toBe('salt-hash-mismatch');
    guest.noteTransportStatus('online');

    // ★ 这一格就是 R4 说的那个代价：两个读数说的是两件事
    expect(guest.phase()).toBe('complete');
    expect(guest.peerStatus().acceptsInput, 'N-9：验盐失败时 acceptsInput 也是 true').toBe(true);
    expect(guest.commitmentVerified(), '验不过却被记成验过').toBe(false);
    expect(guest.peerStatus().online, '对端在线 —— 与"这局好不好"无关').toBe(true);
    expect(guest.peerStatus().needsResync, '这一局坏了不等于"需要追平"').toBe(false);
  });
});

/* ------------------------------------------------------------------ *
 * 队列那条（计划判据 7）：选的是 (a) 加上限 + 溢出转重连
 * ------------------------------------------------------------------ */

describe('队列那条：入站队列的上限与溢出策略（选 (a)：加上限 + 溢出转重连，不静默丢）', () => {
  /** 一条合法的 `act` 帧（只求过线；驱动不会解码它，因为宿主一直没 arm） */
  function actFrame(seq: number): string {
    const enc = encodeMsg({ t: 'act', seq, action: { seq, player: 0, kind: 'advance' } });
    expect(enc.ok, 'act 帧编不出来（夹具问题）').toBe(true);
    if (!enc.ok) throw new Error('unreachable');
    return enc.text;
  }

  it('★ 上限设成 1、两条 act 真的过线、宿主不 arm ⇒ 溢出被**记成**溢出（不是静默丢）+ needsResync', async () => {
    const pair = await makeLink();
    const clock = fakeClock(0);
    const guest = guestSession({ clock });
    const driver = createNetDriver({
      transport: pair.B.transport,
      seat: 1,
      recorder: null,
      inboundCapacity: 1,
    });
    // ★ 最小接线（T8 的活）：驱动的溢出失败 ⇒ 会话层标 needsResync + 可读提示
    driver.onFailure((f) => {
      if (f.reason === 'inbound-overflow') guest.noteResyncNeeded('queue-overflow', f.message);
    });

    expect(pair.A.transport.send('act', actFrame(0)).ok).toBe(true);
    expect(pair.A.transport.send('act', actFrame(1)).ok).toBe(true);
    pair.pump(ACT_LATENCY_TICKS * 3);
    // 非零扰动自证：两条都**真的到达**了 B 侧（不许停在"发送方 send 成功"那一步）
    const arrived = pair.steps().filter((d) => d.from === 'A' && d.to === 'B');
    expect(arrived.length, '两条 act 必须真的过线（否则溢出根本没被触发）').toBe(2);

    expect(driver.pendingCount(), '上限 1 ⇒ 只收下一条').toBe(1);
    expect(driver.inboundOverflowCount(), '另一条必须被记成溢出（不是"它不存在"）').toBe(1);
    expect(driver.lastFailure()?.reason, '溢出的可读失败').toBe('inbound-overflow');
    expect(driver.lastFailure()?.message, '那条提示要说清"没有被收下"').toContain('没有被收下');
    expect(guest.peerStatus().needsResync, '溢出必须把会话标成"需要一次追平"').toBe(true);
    expect(guest.peerStatus().needsResyncCause).toBe('queue-overflow');
    expect(guest.peerStatus().needsResyncDetail, '可读提示要能转成给玩家的一句话').toContain('追平');
  });

  it('反控：只发一条时**不许**出现溢出或 needsResync（证明上限不是恒真）', async () => {
    const pair = await makeLink();
    const clock = fakeClock(0);
    const guest = guestSession({ clock });
    const driver = createNetDriver({
      transport: pair.B.transport,
      seat: 1,
      recorder: null,
      inboundCapacity: 1,
    });
    driver.onFailure((f) => {
      if (f.reason === 'inbound-overflow') guest.noteResyncNeeded('queue-overflow', f.message);
    });
    expect(pair.A.transport.send('act', actFrame(0)).ok).toBe(true);
    pair.pump(ACT_LATENCY_TICKS * 3);
    expect(driver.pendingCount()).toBe(1);
    expect(driver.inboundOverflowCount(), '一条就溢出了 ⇒ 上限判定写错了').toBe(0);
    expect(driver.lastFailure()).toBeNull();
    expect(guest.peerStatus().needsResync, '没溢出却报了 needsResync').toBe(false);
    expect(guest.peerStatus().needsResyncCause).toBeNull();
  });

  it('缺省上限是 256（可注入的那一位必须有写明的缺省值）', async () => {
    const pair = await makeLink();
    const driver = createNetDriver({ transport: pair.B.transport, seat: 1, recorder: null });
    // 直接断言读数而不是把 256 帧喂进去：缺省值只需要"能被读到"（它的理由写在源码注释里）
    expect(driver.pendingCount()).toBe(0);
    expect(driver.inboundOverflowCount()).toBe(0);
    const src = readFileSync(join(NET_DIR, 'net-driver.ts')).subarray(0, 4 * 1024 * 1024).toString('utf8');
    expect(src.includes('export const DEFAULT_INBOUND_CAPACITY = 256'), '缺省上限的出处').toBe(true);
    // 缺省值是**可注入的缺省、不是承诺**（阶段一评审：256 的依据只有夹具规模 + 内存量级）
    expect(src.includes('不是一句承诺'), '缺省值的定位必须写实').toBe(true);
  });

  it('★ 上限的退化输入（0 / -1 / 非整数）是调用方违约 ⇒ 当场抛，不许"每帧都判溢出"', async () => {
    // 阶段一评审实测的退化：`capacity=0` ⇒ 每一帧都被判溢出 ⇒ 队列恒空、"溢出"这个信号
    // 不再表示"本端跟不上了"而只表示"配置写错了"（判据与文案都会读到假话）。
    const pair = await makeLink();
    for (const bad of [0, -1, 1.5, Number.NaN]) {
      expect(
        () => createNetDriver({ transport: pair.B.transport, seat: 1, recorder: null, inboundCapacity: bad }),
        `inboundCapacity=${String(bad)} 应该当场抛（调用方违约）`,
      ).toThrow(/inboundCapacity/);
    }
    // 正控：合法值不抛（否则上面那条对"这一支整个坏了"也成立）
    expect(() => createNetDriver({ transport: pair.B.transport, seat: 1, recorder: null, inboundCapacity: 1 })).not.toThrow();
  });

  it('★ realign 传了"合法但错一位"的值 ⇒ 有**可读区分**的失败，不与"对端跳号"同形', async () => {
    // 收尾轮按复验人的要求补（D16 的先例：同一个值不许承载两个含义）。
    // 复验人实测的形态：`realign` 传一个**合法但错一位**的值 ⇒ 静默分叉，而唯一信号
    // `seq-mismatch` 与"对端真跳号/丢帧/重放"**同形**，调用方分不出来。
    // ⇒ 现在 `realign` 之后**第一条**不匹配报 `'realign-mismatch'`（message 里带着对齐步数）；
    //    **没有 realign 过**的不匹配照旧 `'seq-mismatch'`（T5 的原语义，一个字不改）。
    //
    // ⚠️ 能力边界（如实写）：第一条 `realign-mismatch` 之后驱动就 `stuck` 了（不再看后面的帧），
    //    所以"第二条会回到 seq-mismatch"这件事在 drain 路径上**不可观测**——
    //    那条区分靠下面 B 组（从没 realign 过的驱动）证明，而不是靠"同一条驱动上的第二条"。
    const pair = await makeLink();
    const state = opening(ARCHIVE_SEED);
    /** 一条真的能过形状检查的 `act` 帧（内容取自确定性策略，保证引擎收得下） */
    const frame = (s: GameState, seq: number): string => {
      const a = nextAction(s, seq);
      expect(a, `第 ${seq} 步没有可用操作`).not.toBeNull();
      if (a === null) throw new Error('unreachable');
      const enc = encodeMsg({ t: 'act', seq, action: { ...a, seq } });
      expect(enc.ok, 'act 编不出来').toBe(true);
      if (!enc.ok) throw new Error('unreachable');
      return enc.text;
    };

    // A 组：realign 传错值 ⇒ 第一条不匹配必须可区分
    const dA = createNetDriver({ transport: pair.B.transport, seat: 1, recorder: null });
    dA.arm(state);
    dA.feedText(frame(state, 0));
    dA.feedText(frame(state, 1));
    expect(dA.appliedSteps()).toBe(2);
    expect(dA.lastFailure(), '夹具问题：这两步不该失败').toBeNull();
    dA.realign(8); // ← 合法但错的值（比真实进度多 6 步）
    dA.feedText(frame(state, 2));
    expect(dA.lastFailure()?.reason, 'realign 之后第一条不匹配必须可区分（不是 seq-mismatch）').toBe(
      'realign-mismatch',
    );
    expect(dA.lastFailure()?.message, '那句可读提示必须带上对齐时的步数').toContain('第 8 步');
    // 后果面：错的对齐值被记成了进度事实（8），而真实进度是 2 ⇒ **唯一的症状就是那条失败**
    //（这正是复验人说的"接口正确性只靠约定"的那个点，现在它有了一条可读的区分信号）
    expect(dA.appliedSteps(), 'realign 会把传进来的值当成进度事实（传错就是错在这）').toBe(8);
    const refused = dA.submit(state, nextAction(state, 2) as Omit<ActionRecord, 'seq'>);
    expect(refused.ok ? null : refused.refusal, '卡住的时候不该放行提交').toBe('not-the-next-action');

    // B 组（区分性的另一半）：**从没 realign 过**的驱动上，同一种不匹配照旧是 seq-mismatch
    const pair2 = await makeLink();
    const state2 = opening(ARCHIVE_SEED);
    const dB = createNetDriver({ transport: pair2.B.transport, seat: 1, recorder: null });
    dB.arm(state2);
    dB.feedText(frame(state2, 0));
    dB.feedText(frame(state2, 1));
    dB.feedText(frame(state2, 4)); // ← 跳号（对端那一族）
    expect(dB.lastFailure()?.reason, '没 realign 过的不匹配必须仍是 seq-mismatch').toBe('seq-mismatch');

    // 正控：realign 传**对的**值时，紧接着那一条必须落地（否则上面那条区分对"这一支整个坏了"也成立）
    const pair3 = await makeLink();
    const state3 = opening(ARCHIVE_SEED);
    const dC = createNetDriver({ transport: pair3.B.transport, seat: 1, recorder: null });
    dC.arm(state3);
    dC.feedText(frame(state3, 0));
    dC.feedText(frame(state3, 1));
    dC.realign(2);
    dC.feedText(frame(state3, 2));
    expect(dC.appliedSteps(), '对齐正确时那一条必须落地').toBe(3);
    expect(dC.lastFailure(), '对齐正确时不该有任何失败').toBeNull();
  });

  it('★ 溢出之后走一次追平：needsResync 能被清掉，且相位回到原来那一格（承诺进度不回退）', () => {
    const { file } = playArchive(ARCHIVE_STEPS);
    const clock = fakeClock(0);
    const host = hostSession({ clock, file });
    const guest = guestSession({ clock });
    runCommitmentFull(host, guest);
    expect(guest.phase()).toBe('complete');
    expect(guest.commitmentVerified()).toBe(true);

    // 接线：队列溢出 ⇒ 标出来（这一步在任何相位上都能做）
    expect(guest.noteResyncNeeded('queue-overflow', '入站队列溢出：本端已落后，需要一次追平').ok).toBe(true);
    expect(guest.peerStatus().needsResync).toBe(true);
    expect(guest.peerStatus().needsResyncCause).toBe('queue-overflow');

    // 房主应答（真实产出）→ 加入方收下 → 追平
    const resyncRes = acceptSessionOut(host, {
      t: 'resync-req',
      msg: overWire({ t: 'resync-req', sessionId: SESSION_ID, appliedSteps: ARCHIVE_STEPS }),
    });
    acceptOk(guest, { t: 'resync-res', msg: overWire(resyncRes.msg) });
    expect(guest.phase()).toBe('resync-pending');
    const applied = guest.applyResyncFile(file, file.actions.length);
    expect(applied.ok).toBe(true);

    expect(guest.phase(), '相位必须回到原来那一格（打回 seed-committed 会让它再也收不下盐）').toBe('complete');
    expect(guest.peerStatus().needsResync).toBe(false);
    expect(guest.commitmentVerified(), '追平不该动承诺进度').toBe(true);
    expect(host.phase(), '房主这一侧不该被重连请求改动').toBe('complete');
  });

  it('★ 溢出 → 追平 → realign → **之后还能继续推进**（两端指纹再次逐字相等）', async () => {
    // ## 为什么单列这一条（阶段一评审判"恢复是假恢复"）
    //
    // 原来只有"标记面"的腿：溢出被记成溢出、`needsResync` 被清掉、相位回原来那一格。
    // 但**驱动那一侧**还留着 `applied = 旧值` 与 `stuck = 那条帧`（`stuck` 全文件只有
    // `dispose()` 会清）⇒ 之后每一条入站 `act` 继续 `seq-mismatch`：**标记清掉了、状态没救回来**。
    // 这一条把"溢出 → 追平 → 两端再次锁步"整条链跑通，`realign()` 就是补上的那一步。
    //
    // 形状：房主真打 6 步（进它的记录器 + 自己的状态）；加入方那个驱动的队列上限设成 1、
    // **宿主一直不 arm**（它的状态停在开局）⇒ 溢出；然后走真实的 resync（房主的档案 →
    // `stateAtStep` 重建 → `realign(6)`）⇒ 再打 4 步，两端指纹必须一直相等。
    //
    // ⚠️ 能力边界（如实登记）：这条腿里的"溢出"是**构造**出来的（加入方从头就没 arm），
    // 它证明的是"溢出之后这条路能走通"，不是"生产环境下溢出会发生"。后者由第一条腿
    // （上限 1 + 两条真帧 + 不 arm）负责。
    const clock = fakeClock(0);
    const pair = await makeLink();
    const hostRecorder = createMatchFileRecorder();
    // 房主的档案**在 6 步之后才有** ⇒ 用 `source`（现取口）而不是建会话时固定的一份
    let archiveForResync: MatchFile | null = null;
    const host = hostSession({ clock, source: () => archiveForResync });
    const guest = guestSession({ clock });
    pair.A.transport.onStatus((ch) => host.noteTransportStatus(ch.to));
    pair.B.transport.onStatus((ch) => guest.noteTransportStatus(ch.to));
    host.noteTransportStatus(pair.A.transport.status());
    guest.noteTransportStatus(pair.B.transport.status());

    const hostState = opening(ARCHIVE_SEED);
    // ★ 加入方那个驱动**从头到尾不 arm**（这正是队列会攒起来的场面：宿主没把状态递进来）
    const guestDriver = createNetDriver({
      transport: pair.B.transport,
      seat: 1,
      recorder: null,
      inboundCapacity: 1,
    });
    // 接线的活：溢出 ⇒ 会话层标 needsResync（读 T6 给的可读读数）
    guestDriver.onFailure((f) => {
      if (f.reason === 'inbound-overflow') guest.noteResyncNeeded('queue-overflow', f.message);
    });
    const hostDriver = createNetDriver({ transport: pair.A.transport, seat: 0, recorder: hostRecorder });
    hostDriver.arm(hostState);

    // 房主真走 6 步：**本端**的操作用 `submit`，**对端**的操作走驱动的入站口
    // （`feedText` 的文档写明它是测试构造入站帧的口）—— 这样房主的状态与记录器都完整，
    // 而加入方那一侧一直停在开局、队列照常溢出。
    for (let i = 0; i < 6; i += 1) {
      const a = nextAction(hostState, i);
      expect(a, `第 ${i} 步没有可用操作`).not.toBeNull();
      if (a === null) throw new Error('unreachable');
      if (a.player === 0) {
        expect(hostDriver.submit(hostState, a).ok, `第 ${i} 步房主提交必须成功`).toBe(true);
        pair.pump(ACT_LATENCY_TICKS);
        // 那一条帧也真的过线（进了加入方的队列）
      } else {
        const enc = encodeMsg({ t: 'act', seq: i, action: { ...a, seq: i } });
        expect(enc.ok, '第 ${i} 步的 act 编不出来').toBe(true);
        if (!enc.ok) throw new Error('unreachable');
        hostDriver.feedText(enc.text);
        hostDriver.arm(hostState);
      }
    }
    expect(hostDriver.appliedSteps()).toBe(6);
    expect(hostRecorder.actions().length, '房主记录器里该有 6 条（追平凭据）').toBe(6);
    expect(hostState.draftPicks.length, '房主这一局真的走起来了').toBeGreaterThan(0);
    // 非零扰动自证：加入方确实收到了帧、队列确实溢出了、它的状态确实停在后面
    pair.pump(ACT_LATENCY_TICKS * 3);
    expect(guestDriver.pendingCount(), '上限 1 ⇒ 队里只该留一条').toBe(1);
    expect(guestDriver.inboundOverflowCount(), '前提：加入方确实溢出了').toBeGreaterThan(0);
    expect(guestDriver.appliedSteps(), '前提：加入方一步都没落地').toBe(0);
    expect(guest.peerStatus().needsResync, '溢出必须把会话标成"需要一次追平"').toBe(true);
    expect(guest.peerStatus().needsResyncCause).toBe('queue-overflow');

    // 追平：拿房主的档案重建加入方的状态（唯一出处 `stateAtStep`）
    const archive = hostRecorder.toMatchFile({
      seed: ARCHIVE_SEED,
      setup: setupFromState(hostState),
      players: [{ nick: '甲' }, { nick: '乙' }],
      cardDataHash: CARD_DATA_HASH,
      createdAt: '2026-09-18T00:00:00.000Z',
    });
    const rebuilt = stateFromArchive(archive);
    expect(stateFingerprint(rebuilt), '追平出来的状态必须与房主一致').toBe(stateFingerprint(hostState));
    archiveForResync = archive; // 现取口：档案到这里才存在

    // ★ 恢复的那一步（`realign`）：把驱动的进度事实对齐到重建后的那一步
    guestDriver.realign(archive.actions.length);
    expect(guestDriver.appliedSteps(), 'realign 之后进度事实必须对齐').toBe(6);
    expect(guestDriver.pendingCount(), 'realign 应该丢掉重建前那段队列').toBe(0);
    // 会话层那一侧：把 needsResync 也清掉（走真实的重连入口）
    expect(guest.markResuming().ok).toBe(true);
    const hd = host.accept({ t: 'hello', msg: overWire(hello({ resuming: true })) });
    expect(hd.ok).toBe(true);
    if (!hd.ok) throw new Error('unreachable');
    acceptOk(guest, { t: 'hello-ack', msg: overWire(hd.output) });
    const resyncRes = acceptSessionOut(host, {
      t: 'resync-req',
      msg: overWire({ t: 'resync-req', sessionId: SESSION_ID, appliedSteps: 6 }),
    });
    const decoded = overWire(resyncRes.msg) as { file: MatchFile };
    acceptOk(guest, { t: 'resync-res', msg: decoded });
    const applied = guest.applyResyncFile(decoded.file, 6);
    expect(applied.ok, '追平被拒了').toBe(true);
    expect(guest.peerStatus().needsResync, '追平之后会话层的标记该清掉').toBe(false);

    // ★ 关键：**继续推进**（第 6 步起），两端必须一直锁步 —— 否则"溢出转重连"只兑现了标记那一半
    const guestStateAfter = rebuilt;
    guestDriver.arm(guestStateAfter);
    const framesBefore = pair.steps().length;
    // 走到"至少有一条房主的 act 真的到过加入方"为止（换手顺序由引擎决定，所以给足步数，
    // 但**每一步都断言指纹相等**；`nextAction` 在 60 步内一定给得出操作 —— 那个种子已被 T5 实测）
    for (let i = 6; i < 22; i += 1) {
      const a = nextAction(hostState, i);
      expect(a, `第 ${i} 步没有可用操作`).not.toBeNull();
      if (a === null) throw new Error('unreachable');
      const actor = a.player === 0 ? hostDriver : guestDriver;
      const actorState = a.player === 0 ? hostState : guestStateAfter;
      const r = actor.submit(actorState, a);
      expect(r.ok, `追平之后第 ${i} 步提交必须成功（seq 必须对上，否则就是"标记清了、状态没救回来"）`).toBe(true);
      pair.pump(ACT_LATENCY_TICKS);
      hostDriver.arm(hostState);
      guestDriver.arm(guestStateAfter);
      expect(stateFingerprint(guestStateAfter), `追平之后第 ${i} 步两端指纹必须相等`).toBe(
        stateFingerprint(hostState),
      );
    }
    expect(guestDriver.appliedSteps(), '两端步数必须相等').toBe(hostDriver.appliedSteps());
    // 反空转：这 4 步里必须真的有过"房主 → 加入方"的帧（否则"加入方收得下"是空转）
    const aToB = pair.steps().slice(framesBefore).filter((d) => d.from === 'A' && d.to === 'B');
    expect(aToB.length, '追平之后没有任何一条房主的 act 到达加入方（这条腿在空转）').toBeGreaterThan(0);
    console.log(
      `T6-OVERFLOW-RECOVERY steps=${hostDriver.appliedSteps()} overflow=${guestDriver.inboundOverflowCount()} ` +
        `aToB=${aToB.length} fp=${stateFingerprint(hostState)}`,
    );
  });
});

/* ------------------------------------------------------------------ *
 * online 与窗口不影响既有承诺流程那条（判据 14）+ 文案不在本任务那条（判据 15）
 * ------------------------------------------------------------------ */

describe('既有流程与读数不互相打坏（判据 14 / 15）', () => {
  it('★ 注入时钟与传输状态之后，既有承诺流程一字不变（两端 complete + 验通）', () => {
    const clock = fakeClock(0);
    const host = hostSession({ clock });
    const guest = guestSession({ clock });
    host.noteTransportStatus('online');
    guest.noteTransportStatus('online');
    runCommitmentFull(host, guest);
    expect(host.peerStatus()).toMatchObject({
      phase: 'complete',
      handshakeDone: true,
      faceCommitted: true,
      seedRevealed: true,
      acceptsInput: true,
      needsResync: false,
      online: true,
      windowExpired: false,
    });
    expect(guest.commitmentVerified()).toBe(true);
    // 时钟推进**不会**把一局正常的对局弄坏（超窗只改读数，不改相位/承诺结论）
    clock.set(300_001);
    expect(guest.phase()).toBe('complete');
    expect(guest.commitmentVerified()).toBe(true);
    expect(guest.peerStatus().online, '超窗之后 online 变 false（读数）').toBe(false);
    expect(guest.peerStatus().acceptsInput, '超窗之后不再收输入').toBe(false);
    expect(host.face()).toBe(1);
  });

  it('T6 给 T8 的四个读数都在 `peerStatus()` 上（文案由 T8 从这里转写，纯层不产玩家文案）', () => {
    const s = hostSession({ clock: fakeClock(0) });
    const st = s.peerStatus();
    // 四个读数 + 一句可读提示：T8 需要它们来写"断线 ≠ 刷新"那句（计划 §5 T8 认领的第三件渲染）
    expect(typeof st.online, 'online 是不是布尔').toBe('boolean');
    expect(st.windowExpired, 'windowExpired（没有时钟时是 null）').toBe(false);
    expect(typeof st.needsResync).toBe('boolean');
    expect(st.needsResyncCause, '没在等追平时成因是 null').toBeNull();
    expect(st.needsResyncDetail).toBeNull();
    expect(s.noteResyncNeeded('queue-overflow', '队列溢出：本端落后了，需要一次追平').ok).toBe(true);
    expect(s.peerStatus().needsResyncDetail, 'T8 要能读到那句可读提示').toContain('追平');
  });

  it('文案不在本任务：`src/net/**` 里 `privacy` 零命中（T6 不新建任何玩家文案）', () => {
    const files = tsSources(NET_DIR);
    expect(files.length).toBeGreaterThanOrEqual(5);
    for (const f of files) {
      expect(f.code.includes('privacy'), `${f.path} 里出现了 privacy（玩家文案归 T8/privacy.ts）`).toBe(false);
      expect(f.code.includes("'../ui/"), `${f.path} 反向依赖了 src/ui`).toBe(false);
    }
  });
});
