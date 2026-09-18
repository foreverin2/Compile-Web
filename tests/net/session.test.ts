import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { stripComments, codePositions } from '../ui/source-text';
import {
  createGuestSession,
  createHostSession,
  REVEAL_SEED_BEFORE_FACE_MESSAGE,
  RESYNC_NOT_WIRED_MESSAGE,
  SPECTATOR_UNSUPPORTED_MESSAGE,
} from '../../src/net/session';
import type { GuestSession, HostSession, SessionInbound, SessionRejectReason } from '../../src/net/session';
import { CARD_DATA_HASH } from '../../src/app/card-data-hash';
import { MATCH_FILE_FORMAT, MATCH_FILE_VERSION } from '../../src/app/match-file';
import type { MatchFile } from '../../src/app/match-file';
import { PROTO_VERSION, decodeMsg, encodeMsg, validateHello } from '../../src/net/protocol';
import type { HelloAckMsg, HelloMsg } from '../../src/net/protocol';

/**
 * G5 T3 行为腿（计划 `docs/2026-09-17-G5-传输层联机-实现计划.md` §5 T3 的六条验收判据；
 * 设计稿 §5.2 握手 `:445-465`、§5.3 种子承诺 `:467-483`）。
 *
 * ## 判据 1 为什么配得上一个 `describe` 单独一段
 *
 * 它是全阶段**唯一**能被机器判定的安全属性：`seed` 不得早于 `commit-face` 被揭示。
 * 硬币是种子的纯函数（`src/ui/home.ts:394` 的 `deriveInt(seed, 'coin', 2)`），
 * 先拿到种子的一方可以先算出结果、再挑必胜的那一面。这条判据**必须有专门一条腿**，
 * 而不是"顺带被别的用例碰到"。
 *
 * ## 哈希：这里用的是**真的 SHA-256**（纯 JS，零依赖）
 *
 * `session.ts` 不算哈希（D15），哈希由调用方注入。本文件注入一个**自己实现的 SHA-256**
 * （FIPS 180-4，纯函数、同步、无浏览器 API），理由有两条：
 *
 *  1. 判据 2 的原文是"`reveal-salt` 能验 `hash(seed + salt) === commit`"。若注入一个
 *     玩具哈希（比如"把串拼起来取长度"），那条腿就退化成"玩具哈希对自己成立"，
 *     **验不出任何真事**。用真 SHA-256 之后，commit 里那个串就是一个真实的 sha256 十六进制值，
 *     判据 2 才是它字面上说的那件事。
 *  2. 它同时钉住 `HashLike` 的关键契约：**必须同步**。`crypto.subtle.digest()` 返回
 *     `Promise`，本模块会把它当成"不可用的哈希串"当场抛错（见下面的"调用方违约"腿）——
 *     那正是 D15 把哈希做成注入能力的目的（状态机保持同步，判据 1 不锁进异步时序）。
 *
 * ## 不写"输入 → 期望字符串"的逐字断言（判据 3 的形态）
 *
 * 文案会随改动优化，**理由码是契约**。所以断言的是：（a）`reason` 逐条正确、
 * （b）所有拒绝文案**互不相同** —— 判据 3 的原文是"两句不是同一句"，
 * 只断言 `reason` 不同会漏掉"两条的文案串了"这个形态（那正是变异 M2 干的事）。
 */

/* ------------------------------------------------------------------ *
 * 夹具 0：真 SHA-256（纯 JS）
 * ------------------------------------------------------------------ */

/** UTF-8 编码（不用 `TextEncoder`：那是浏览器 API，本仓 `tests/**` 的既有写法是手写） */
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
  // 长度按 64 位大端写（本仓的输入远小于 2^32 位，高位恒 0，但照样按 64 位写全）
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

/**
 * 注入给会话的哈希：**按给定顺序把段拼起来**再算 sha256 —— 即设计稿 `:472` 的
 * `sha256(seed + salt)`。
 *
 * 这里**不加分隔符**，是刻意的：设计稿写的就是 `seed + salt` 的拼接。加一个分隔符
 * （比如 `\u001f`）会让"`seed='ab'`,`salt='c'`"与"`seed='a'`,`salt='bc'`"不再相撞；
 * 那是一个**更好**的写法，但它不是设计稿写的那条式子。本夹具要钉的是设计稿那条式子本身，
 * 所以照抄拼接。将来若要改成分隔符写法，改的是 `HashLike` 的**实现**（`src/ui/net-browser.ts`）
 * 与这里，两处同轮改即可 —— 本模块不关心拼接细节（`HashLike` 的注释已写明）。
 */
function sha256Concat(...parts: readonly string[]): string {
  return sha256Hex(parts.join(''));
}

/* ------------------------------------------------------------------ *
 * 夹具 1：两个会话与一条"线"
 * ------------------------------------------------------------------ */

const SESSION_ID = 'sess-T3';
const LOCAL = { localProtoVersion: PROTO_VERSION, localCardDataHash: CARD_DATA_HASH } as const;

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

function hostSession(seat: 0 | 1 = 0): HostSession {
  return createHostSession({ ...LOCAL, sessionId: SESSION_ID, seat, hash: sha256Concat });
}

/**
 * 加入方：**已经握手成功**（收到 `hello-ack`）的那种，供大多腿直接用。
 *
 * N-7 之前加入方是靠"收一条入站 `hello`"进相位的 —— 那是**方向错**的用法（`hello` 的
 * 发送方是加入方自己）。现在由 `hello-ack` 驱动，所以这个夹具替调用方把那一步做掉。
 * 需要"还没握手"的加入方，用下面的 `rawGuestSession()`。
 */
function guestSession(seat: 0 | 1 = 1): GuestSession {
  const g = createGuestSession({ ...LOCAL, sessionId: SESSION_ID, seat, hash: sha256Concat });
  acceptHelloAck(g);
  return g;
}

/** **还没握手**的加入方（原样建出来，一条消息都没喂）—— 给那些要测"握手前"的腿用 */
function rawGuestSession(seat: 0 | 1 = 1): GuestSession {
  return createGuestSession({ ...LOCAL, sessionId: SESSION_ID, seat, hash: sha256Concat });
}

/** 加入方侧"握手成功"的唯一夹具：它收到的是 **hello-ack**（N-7 之后 hello 只归房主收） */
function acceptHelloAck(g: GuestSession): void {
  acceptOk(g, { t: 'hello-ack', msg: overWire(helloAck()) });
}

/** 房主会回的那条 `hello-ack`（座位由房主定：D7）；走一遍线协议再喂给加入方 */
function helloAck(over: Partial<HelloAckMsg> = {}): HelloAckMsg {
  return { t: 'hello-ack', protoVersion: PROTO_VERSION, seat: 1, peerNick: 'host', sessionId: SESSION_ID, ...over };
}

/**
 * 把一条消息**真的走一遍线协议**（`encodeMsg` → `decodeMsg`）再喂给对端。
 *
 * 为什么不让测试直接把对象递过去：那样"会话产出的消息能不能被 `protocol.ts` 编码/解码"
 * 就没被验过，而 `SessionOutbound` 的形状正是为这个存在的（`{ t, msg }` 直接喂 `encodeMsg`）。
 * 这条腿顺带把 T1 的编解码面接上（判据 2 的"合法顺序全程通过"要真的能过线）。
 */
function overWire(msg: unknown): unknown {
  const enc = encodeMsg(msg);
  expect(enc.ok, `会话产出的消息无法被 encodeMsg 编码：${enc.ok ? '' : enc.message}`).toBe(true);
  if (!enc.ok) throw new Error('unreachable');
  const dec = decodeMsg(enc.text, { protoVersion: PROTO_VERSION });
  expect(dec.ok, `刚编码出来的消息无法被 decodeMsg 解码：${dec.ok ? '' : dec.message}`).toBe(true);
  if (!dec.ok) throw new Error('unreachable');
  return dec.msg;
}

/** 收一条入站消息并断言它被接受（成功面），返回输出（可能为 `null`） */
function acceptOk(session: HostSession | GuestSession, req: SessionInbound) {
  const d = session.accept(req);
  expect(d.ok, `本该接受的入站消息被拒了：${d.ok ? '' : `${d.reason} / ${d.message}`}`).toBe(true);
  if (!d.ok) throw new Error('unreachable');
  return d;
}

/** 收一条入站消息并断言它被拒绝，返回理由码与文案 */
function acceptRejected(session: HostSession | GuestSession, req: SessionInbound) {
  const d = session.accept(req);
  expect(d.ok, '本该被拒的入站消息被接受了').toBe(false);
  if (d.ok) throw new Error('unreachable');
  return { reason: d.reason as string, message: d.message, phase: d.phase };
}

const SEED = 'seed-T3-0123456789abcdef';
const SALT = 'salt-T3-fedcba9876543210';

/** 握手：房主收 hello、回 hello-ack（**走线协议**）。房主侧的相位推进到这里 */
function handshakeHost(h: HostSession): void {
  const d = h.accept({ t: 'hello', msg: overWire(hello()) });
  expect(d.ok, `房主拒绝了合法握手：${d.ok ? '' : d.message}`).toBe(true);
  if (!d.ok) throw new Error('unreachable');
}

/**
 * 走完"承诺 → 确认 → 选面 → 揭示种子 → 揭示面 → 揭示盐"，返回两个会话。
 *
 * **收尾两条消息全部用真实产出**（第三阶段复验的阻断项 B-1 就是在这里藏的）：
 * 早先第 6 步是**手工构造** `overWire({t:'reveal-salt', salt: SALT})` 直接喂给加入方，
 * 于是这条腿只证明"加入方验得动"，**没有**证明"房主在那个时刻发得出"。两条腿各自绿、
 * 合起来矛盾（房主先收 `reveal-face` 就到 `complete`，而当时的守卫不许在 `complete` 发盐）。
 * 现在两步都走真实产出：`g.sendRevealFace()` 与 `h.sendRevealSalt()`。
 *
 * 顺序取的是**设计稿的字面顺序**（`:475`："结束后房主发 `reveal-salt`"）：先 `reveal-face`
 * （"结束"那一步），再发盐。反过来的顺序由 N-13/B-1 的另一条腿单独钉住。
 */
function runCommitRevealFull(): { h: HostSession; g: GuestSession } {
  const h = hostSession();
  const g = rawGuestSession();
  acceptHelloAck(g);
  handshakeHost(h);

  // 1. 房主 commit
  const c = h.sendCommit(SEED, SALT);
  expect(c.ok, '房主发不出 commit').toBe(true);
  if (!c.ok) throw new Error('unreachable');
  acceptOk(g, { t: 'commit', msg: overWire(c.output.msg) });

  // 2. 加入方 commit-ack
  const a = g.sendCommitAck();
  expect(a.ok, '加入方发不出 commit-ack').toBe(true);
  if (!a.ok) throw new Error('unreachable');
  acceptOk(h, { t: 'commit-ack', msg: overWire(a.output.msg) });

  // 3. 加入方 commit-face（**必须先于 reveal-seed**）
  const f = g.commitFace(1, 'nonce-A');
  expect(f.ok, '加入方发不出 commit-face').toBe(true);
  if (!f.ok) throw new Error('unreachable');
  acceptOk(h, { t: 'commit-face', msg: overWire(f.output.msg) });

  // 4. 房主 reveal-seed
  const rs = h.sendRevealSeed();
  expect(rs.ok, '承诺成立之后房主仍发不出 reveal-seed').toBe(true);
  if (!rs.ok) throw new Error('unreachable');
  acceptOk(g, { t: 'reveal-seed', msg: overWire(rs.output.msg) });

  // 5. 加入方 reveal-face（"对局结束"那一步）⇒ 房主据此拿到面
  const rf = g.sendRevealFace();
  expect(rf.ok, '加入方发不出 reveal-face').toBe(true);
  if (!rf.ok) throw new Error('unreachable');
  acceptOk(h, { t: 'reveal-face', msg: overWire(rf.output.msg) });
  expect(h.phase(), '房主收下合法的 reveal-face 之后应该到 complete').toBe('complete');
  expect(h.face(), '房主没从 reveal-face 里拿到面').toBe(1);

  // 6. 房主 reveal-salt（**真实产出**）：加入方据此验 `hash(seed + salt) === commit`
  const rv = h.sendRevealSalt();
  expect(rv.ok, `房主在收完 reveal-face 之后发不出 reveal-salt：${rv.ok ? '' : `${rv.reason} / ${rv.message}`}`).toBe(
    true,
  );
  if (!rv.ok) throw new Error('unreachable');
  acceptOk(g, { t: 'reveal-salt', msg: overWire(rv.output.msg) });

  return { h, g };
}

function guestAwaitingSalt(): GuestSession {
  const g = guestSession();
  acceptOk(g, { t: 'commit', msg: overWire({ t: 'commit', hash: sha256Concat(SEED, SALT) }) });
  expect(g.sendCommitAck().ok).toBe(true);
  expect(g.commitFace(0, 'n').ok).toBe(true);
  acceptOk(g, { t: 'reveal-seed', msg: overWire({ t: 'reveal-seed', seed: SEED }) });
  expect(g.sendRevealFace().ok, '夹具问题：加入方发不出 reveal-face').toBe(true);
  expect(g.phase(), '夹具问题：这个夹具该停在 reveal-salt-sent').toBe('reveal-salt-sent');
  return g;
}

/**
 * 一份**形状可归一化、但零步**的重连档案（T6 加的两处要用它）。
 *
 * 为什么不从 `createGame()` 造一份真的：本节需要的是"`canonicalMatchFile` 能读得动"这件事，
 * 而 `stateAtStep` 的重放语义由 T4 的腿负责；这里手写一份最小档案，是为了让
 * T3 的这条闭合腿不去依赖 `src/core` 的引擎状态。真正带 60 步、两端指纹比对的追平腿
 * 在 `tests/net/reconnect.test.ts`（那里走的是完整的档案）。
 *
 * `actions: []` 是**刻意的**：`resync-step-mismatch` 那一格要构造"自报 1 步、档案 0 步"，
 * 差异是非零的（不是"少零步"那种掷硬币）。
 */
const RESYNC_PROBE_FILE: MatchFile = {
  format: MATCH_FILE_FORMAT,
  version: MATCH_FILE_VERSION,
  cardDataHash: CARD_DATA_HASH,
  seed: 'probe-seed',
  setup: { draftMode: 'normal', draftStarter: 0, firstToPlay: 1, draftPool: [], draftPicks: [], bannedProtocols: [] },
  players: [{ nick: 'a' }, { nick: 'b' }],
  actions: [],
  createdAt: '2026-01-01T00:00:00.000Z',
};

/* ------------------------------------------------------------------ *
 * 判据 1（★ 全阶段唯一可机器判定的安全属性）
 * ------------------------------------------------------------------ */

describe('判据 1：seed 不得早于 commit-face 被揭示（设计稿 :479-483）', () => {
  it('★ 房主侧：承诺成立之前 `sendRevealSeed()` 一律被拒，理由码是 seed-before-face', () => {
    const h = hostSession();
    // (a) 握手之前
    expect(h.phase()).toBe('handshaking');
    const a = h.sendRevealSeed();
    expect(a.ok, '握手都没做就揭示了种子').toBe(false);
    expect(a.ok ? null : a.reason).toBe('seed-before-face');

    // (b) 握手之后、commit 之前
    handshakeHost(h);
    expect(h.phase()).toBe('awaiting-commit-face');
    const b = h.sendRevealSeed();
    expect(b.ok, '还没发 commit 就揭示了种子').toBe(false);
    expect(b.ok ? null : b.reason).toBe('seed-before-face');

    // (c) commit 之后、收到 commit-face 之前  ← 这正是"加入方还没选面"的那一刻
    expect(h.sendCommit(SEED, SALT).ok).toBe(true);
    expect(h.phase(), '发过 commit 的房主相位不该变（它等的还是同一样东西）').toBe('awaiting-commit-face');
    const c = h.sendRevealSeed();
    expect(c.ok, '加入方还没提交 commit-face 就揭示了种子（这就是要堵的洞）').toBe(false);
    expect(c.ok ? null : c.reason).toBe('seed-before-face');

    // (d) 收到一条**形状为空**的 commit-face**不算承诺成立**
    const empty = acceptRejected(h, { t: 'commit-face', msg: { t: 'commit-face', hash: '' } });
    expect(empty.reason).toBe('bad-hash');
    expect(h.phase(), '形状不合法的 commit-face 把相位推进了').toBe('awaiting-commit-face');
    const d = h.sendRevealSeed();
    expect(d.ok, '一条空哈希的 commit-face 就换来了种子').toBe(false);
    expect(d.ok ? null : d.reason).toBe('seed-before-face');

    // 正控：真的收到合法 commit-face 之后，同一次调用就成功 —— 否则上面四条可能只是"永远失败"
    acceptOk(h, { t: 'commit-face', msg: overWire({ t: 'commit-face', hash: sha256Concat('1', 'nonce-A') }) });
    expect(h.phase()).toBe('face-committed');
    const good = h.sendRevealSeed();
    expect(good.ok, '承诺成立之后仍然发不出 reveal-seed（上面那几条就不是在测顺序了）').toBe(true);
    expect(good.ok ? good.seed : null).toBe(SEED);
  });

  it('★ 加入方侧：承诺之前收到的 reveal-seed 一律被拒，且不落进任何状态', () => {
    const g = rawGuestSession();
    const seedMsg = overWire({ t: 'reveal-seed', seed: SEED });

    // (a) 握手都还没做
    const a = acceptRejected(g, { t: 'reveal-seed', msg: seedMsg });
    expect(a.reason).toBe('seed-before-face');
    expect(g.seed(), '被拒的种子进了状态').toBeNull();
    expect(g.phase()).toBe('handshaking');

    // 握手（加入方这一侧：它自己收 hello-ack，用 `accept` 走同一条路）
    acceptHelloAck(g);

    // (b) 收到房主的 commit 之后、还没回 ack / 还没提交面
    acceptOk(g, { t: 'commit', msg: overWire({ t: 'commit', hash: sha256Concat(SEED, SALT) }) });
    expect(g.phase()).toBe('seed-committed');
    const b = acceptRejected(g, { t: 'reveal-seed', msg: seedMsg });
    expect(b.reason).toBe('seed-before-face');
    expect(g.seed()).toBeNull();

    // (c) 回了 ack、但**还没提交 commit-face** ← 攻击者会卡在这一步等种子
    expect(g.sendCommitAck().ok).toBe(true);
    expect(g.phase()).toBe('awaiting-commit-ack');
    const c = acceptRejected(g, { t: 'reveal-seed', msg: seedMsg });
    expect(c.reason).toBe('seed-before-face');
    expect(
      g.seed(),
      '在提交面之前就拿到了种子 —— 选面者可以先算出硬币结果再挑面（判据 1 要堵的正是这个）',
    ).toBeNull();

    // 正控：提交面之后同一条消息被接受
    expect(g.commitFace(1, 'nonce-A').ok).toBe(true);
    expect(g.phase()).toBe('face-committed');
    const good = acceptOk(g, { t: 'reveal-seed', msg: seedMsg });
    expect(good.phase).toBe('seed-revealed');
    expect(g.seed()).toBe(SEED);
  });

  it('★ 反过来也堵住：加入方没有收到房主的 commit 时不能提交面（否则面的承诺会抢在种子承诺之前）', () => {
    const g = rawGuestSession();
    const r = g.commitFace(1, 'nonce-A');
    expect(r.ok, '还没收到房主的 commit 就提交了面').toBe(false);
    expect(r.ok ? null : r.reason).toBe('unexpected-message');
    expect(g.phase()).toBe('handshaking');
    expect(g.faceHashOfCommit()).toBeNull();
  });

  it('空 seed 的 reveal-seed 也不算"揭示"（形状失败与顺序失败分开报）', () => {
    const g = guestSession();
    acceptOk(g, { t: 'commit', msg: overWire({ t: 'commit', hash: sha256Concat(SEED, SALT) }) });
    expect(g.sendCommitAck().ok).toBe(true);
    // 形状失败先判：`bad-seed`（它说的是"这条消息本身不可用"），而不是 `seed-before-face`
    expect(acceptRejected(g, { t: 'reveal-seed', msg: { t: 'reveal-seed', seed: '' } }).reason).toBe('bad-seed');
    expect(acceptRejected(g, { t: 'reveal-seed', msg: {} }).reason).toBe('bad-seed');
    expect(g.seed()).toBeNull();
  });

  it('重复的 reveal-seed 报 seed-duplicate（**不是** seed-before-face：重发不是安全事件）', () => {
    // 加入方那一侧：`runCommitRevealFull` 已把它推到 `reveal-salt-sent`
    const full = runCommitRevealFull();
    // 加入方此时已走到 `reveal-salt-sent`（它已经发出了 reveal-face）⇒ 再来的种子属于"流程重放"
    const again = acceptRejected(full.g, { t: 'reveal-seed', msg: overWire({ t: 'reveal-seed', seed: SEED }) });
    expect(again.reason).toBe('seed-not-expected');
    // 加入方还没发 reveal-face 时再来一条种子 ⇒ 那才是"重复"（`seed-duplicate`）
    const g2 = guestSession();
    acceptOk(g2, { t: 'commit', msg: overWire({ t: 'commit', hash: sha256Concat(SEED, SALT) }) });
    expect(g2.sendCommitAck().ok).toBe(true);
    expect(g2.commitFace(1, 'nonce-A').ok).toBe(true);
    acceptOk(g2, { t: 'reveal-seed', msg: overWire({ t: 'reveal-seed', seed: SEED }) });
    expect(acceptRejected(g2, { t: 'reveal-seed', msg: overWire({ t: 'reveal-seed', seed: SEED }) }).reason).toBe(
      'seed-duplicate',
    );
    // 房主侧：自己揭示过之后再揭示（相位 `seed-revealed`）⇒ `seed-duplicate`
    const h = hostSession();
    handshakeHost(h);
    expect(h.sendCommit(SEED, SALT).ok).toBe(true);
    acceptOk(h, { t: 'commit-face', msg: overWire({ t: 'commit-face', hash: sha256Concat('1', 'nonce-A') }) });
    expect(h.sendRevealSeed().ok).toBe(true);
    const hAgain = h.sendRevealSeed();
    expect(hAgain.ok).toBe(false);
    expect(hAgain.ok ? null : hAgain.reason).toBe('seed-duplicate');
    // 再往后（走完流程、相位 `complete`）⇒ `seed-not-expected`（流程重放，与"重复"分开报）
    acceptOk(h, { t: 'reveal-face', msg: overWire({ t: 'reveal-face', face: 1, faceNonce: 'nonce-A' }) });
    expect(h.phase()).toBe('complete');
    const hLate = h.sendRevealSeed();
    expect(hLate.ok).toBe(false);
    expect(hLate.ok ? null : hLate.reason).toBe('seed-not-expected');
  });
});

/* ------------------------------------------------------------------ *
 * 判据 2：合法顺序全程通过，且承诺真的能验
 * ------------------------------------------------------------------ */

describe('判据 2：commit → commit-ack → commit-face → reveal-seed → reveal-face → reveal-salt 全程通过', () => {
  it('★ B-1：两条收尾动作**在同一局里都完成**，且**全程只用真实产出**', () => {
    // 这条腿是第三阶段复验的阻断项 B-1 的正面形态。B-1 的成因是：
    //  - 房主**先收** `reveal-face` ⇒ 相位 `complete` ⇒ 当时的守卫拒掉 `sendRevealSalt()`
    //    ⇒ 加入方永远验不了承诺；
    //  - 房主**先发**盐 ⇒ 相位 `complete` ⇒ 此后的 `reveal-face` 被拒 ⇒ 房主拿不到面。
    // ⇒ 设计稿 §5.3 的两条收尾动作互斥。修法见 `mayRevealSalt`（发盐的窗口包含 `complete`）。
    //
    // 这条腿的要害在"**全程真实产出**"：每一步的消息都来自 `send*()` / `commitFace()` 的返回，
    //    一个手工构造的收尾消息都不许有。旧的"全程通过"腿正是在最后一步手工构造了
    //    `{t:'reveal-salt'}`，于是只证明"加入方验得动"、没证明"房主发得出"（两条腿各自绿、
    //    合起来矛盾）—— 那正是 B-1 能藏这么久的原因。
    const { h, g } = runCommitRevealFull();
    expect(h.phase(), '房主没走到 complete').toBe('complete');
    expect(g.phase(), '加入方没走到 complete').toBe('complete');
    expect(h.face(), '房主没拿到面（reveal-face 那一半没完成）').toBe(1);
    expect(g.commitmentVerified(), '加入方没验通承诺（reveal-salt 那一半没完成）').toBe(true);
    expect(g.salt(), '加入方没收到盐').toBe(SALT);
  });

  it('★ B-1：发盐的合法窗口**只有 `complete`**（其余相位一律拒，包括 `seed-revealed`）', () => {
    // 这条腿把**窗口**钉死，免得将来有人把它放宽成"随便哪个相位"。
    //
    // 窗口**已收成只有 `complete`**（第四阶段复验收口，裁决 D21）：从 `seed-revealed` 发盐
    //    在过去是"窗口允许但走不完"的死路 —— 发完盐相位就是 `complete`，而 `acceptRevealFace`
    //    只认 `seed-revealed` ⇒ **`reveal-face` 永久进不来** ⇒ 房主永远拿不到面
    //    （复验实测 `AUDIT-B1-residual={"phaseAfterSalt":"complete","faceOk":false,...}`）。
    //    收窄之后那条死路**结构上不可能**，不是靠"别那么用"的注释纪律。
    const h = hostSession();
    handshakeHost(h);
    expect(h.sendCommit(SEED, SALT).ok).toBe(true);

    // 窗口外 1：握手刚完（还没揭示种子）
    expect(h.sendRevealSalt().ok, '还没揭示种子就发得出盐').toBe(false);
    expect(h.phase()).toBe('awaiting-commit-face');

    acceptOk(h, { t: 'commit-face', msg: overWire({ t: 'commit-face', hash: sha256Concat('1', 'n') }) });
    // 窗口外 2：承诺成立、但种子还没揭示
    expect(h.sendRevealSalt().ok, '承诺刚成立（种子未揭示）就发得出盐').toBe(false);
    expect(h.phase()).toBe('face-committed');

    // ★ 窗口外 3：**种子已揭示但还没收到 reveal-face**（这一格是第四阶段收窄掉的那个死路）
    expect(h.sendRevealSeed().ok).toBe(true);
    expect(h.phase()).toBe('seed-revealed');
    const deadPath = h.sendRevealSalt();
    expect(deadPath.ok, '从 seed-revealed 发得出盐 ⇒ 那条顺序会把 reveal-face 永久拒掉').toBe(false);
    expect(deadPath.ok ? null : deadPath.reason).toBe('unexpected-message');
    expect(h.phase(), '被拒的发盐把相位推走了').toBe('seed-revealed');
    // 正控：这一格之后**仍然收得下** reveal-face（死路不存在的直接证据）
    acceptOk(h, { t: 'reveal-face', msg: overWire({ t: 'reveal-face', face: 1, faceNonce: 'n' }) });
    expect(h.phase()).toBe('complete');

    // 窗口内（**唯一一格**）：已 `complete`（= 已经收到 reveal-face、"对局结束"）
    expect(h.sendRevealSalt().ok, '收下 reveal-face 之后发不出盐 ⇒ 加入方永远验不了承诺').toBe(true);
    expect(h.phase()).toBe('complete');
  });

  it('★ B-1 的边界：盐只发一次（`complete` 是终态，幂等靠 `saltMadePublic` 而不是相位）', () => {
    const { h } = runCommitRevealFull();
    const again = h.sendRevealSalt();
    expect(again.ok, '同一局里把盐发了两次').toBe(false);
    expect(again.ok ? null : again.reason).toBe('unexpected-message');
    expect(h.salt(), '重复发盐改动了本方的盐').toBe(SALT);
    expect(h.phase()).toBe('complete');
  });

  it('B-1 的窗口边界：种子都没揭示时发不出盐（发盐窗口不是"随便哪个相位"）', () => {
    const h = hostSession();
    handshakeHost(h);
    expect(h.sendCommit(SEED, SALT).ok).toBe(true);
    expect(h.phase()).toBe('awaiting-commit-face');
    const early = h.sendRevealSalt();
    expect(early.ok, '还没揭示种子就把盐发了').toBe(false);
    expect(early.ok ? null : early.reason).toBe('unexpected-message');
    expect(h.phase(), '被拒的早发把相位推走了').toBe('awaiting-commit-face');
  });

  it('全程走完，两端都到 complete，且 hash(seed + salt) === commit 为真', () => {
    const { h, g } = runCommitRevealFull();

    expect(h.phase()).toBe('complete');
    expect(g.phase(), `加入方相位 ${g.phase()}`).toBe('complete');
    expect(g.commitmentVerified(), '加入方没能验通房主的承诺').toBe(true);
    expect(h.seed()).toBe(SEED);
    expect(h.face(), '房主没能从 reveal-face 里拿到面').toBe(1);
    expect(g.face()).toBe(1);

    // 判据 2 的字面形态：那条式子自己再算一遍
    expect(sha256Concat(SEED, SALT)).toBe(h.seedHashOfCommit());
    expect(sha256Concat(SEED, SALT), 'commit 里的不是真 sha256(seed+salt)').toBe(sha256Hex(SEED + SALT));
    // 加入方的承诺也是真的 hash(face + faceNonce)
    expect(g.faceHashOfCommit()).toBe(sha256Concat('1', 'nonce-A'));
  });

  it('夹具自证：上面那个 SHA-256 是真的（否则"承诺能验"可能是玩具哈希对自己成立）', () => {
    // FIPS 180-4 的两个标准向量
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    // 拼接语义：`sha256(seed + salt)` 是**拼起来再哈希**，不是"两段各自哈希再拼"
    expect(sha256Concat('abc', '')).toBe(sha256Hex('abc'));
    expect(sha256Concat('a', 'bc')).toBe(sha256Hex('abc'));
    // 边界语义（写下来是因为它反直觉，不是缺陷）：无分隔符拼接下 ('ab','c') 与 ('a','bc') **同哈希**
    // —— 因为它们拼出来是同一个串。这正是"拼接语义"的含义；要区分就得加分隔符，
    // 而那是 `HashLike` **实现**（T7）的选择，不是本模块能替它定的（见 `sha256Concat` 的头注）。
    expect(sha256Concat('ab', 'c')).toBe(sha256Concat('a', 'bc'));
    // 反过来：不同的串必须不同（防"哈希函数恒返回同一个值"那种假实现）
    expect(sha256Concat('seed-A', 'salt-A')).not.toBe(sha256Concat('seed-A', 'salt-B'));
    expect(sha256Concat('seed-A', 'salt-A')).not.toBe(sha256Concat('seed-B', 'salt-A'));
  });

  it('篡改 salt ⇒ 承诺验不过，理由码是 salt-hash-mismatch 且不冒充成功', () => {
    const h = hostSession();
    const g = rawGuestSession();
    acceptHelloAck(g);
    handshakeHost(h);
    const c = h.sendCommit(SEED, SALT);
    expect(c.ok).toBe(true);
    if (!c.ok) throw new Error('unreachable');
    acceptOk(g, { t: 'commit', msg: overWire(c.output.msg) });
    expect(g.sendCommitAck().ok).toBe(true);
    const f = g.commitFace(0, 'nonce-B');
    expect(f.ok).toBe(true);
    if (!f.ok) throw new Error('unreachable');
    acceptOk(h, { t: 'commit-face', msg: overWire(f.output.msg) });
    const rs = h.sendRevealSeed();
    expect(rs.ok).toBe(true);
    if (!rs.ok) throw new Error('unreachable');
    acceptOk(g, { t: 'reveal-seed', msg: overWire(rs.output.msg) });

    const bad = acceptRejected(g, { t: 'reveal-salt', msg: overWire({ t: 'reveal-salt', salt: '换了一个 salt' }) });
    expect(bad.reason).toBe('salt-hash-mismatch');
    expect(g.commitmentVerified(), '验不过却被记成验过').toBe(false);
  });

  it('篡改 face ⇒ 房主当场发现，理由码是 face-hash-mismatch', () => {
    const h = hostSession();
    const g = guestSession();
    handshakeHost(h);
    const c = h.sendCommit(SEED, SALT);
    expect(c.ok).toBe(true);
    if (!c.ok) throw new Error('unreachable');
    acceptOk(g, { t: 'commit', msg: overWire(c.output.msg) });
    expect(g.sendCommitAck().ok).toBe(true);
    expect(g.commitFace(1, 'nonce-A').ok).toBe(true);
    const f = g.sendRevealFace();
    expect(f.ok).toBe(false); // 还没揭示种子，面还不能揭示
    const rs0 = h.sendRevealSeed();
    expect(rs0.ok).toBe(false); // 房主还没收到 commit-face
    acceptOk(h, { t: 'commit-face', msg: overWire({ t: 'commit-face', hash: sha256Concat('1', 'nonce-A') }) });
    const rs = h.sendRevealSeed();
    expect(rs.ok).toBe(true);
    if (!rs.ok) throw new Error('unreachable');
    acceptOk(g, { t: 'reveal-seed', msg: overWire(rs.output.msg) });
    // 篡改：承诺的是 face=1，揭示 face=0
    const bad = acceptRejected(h, { t: 'reveal-face', msg: overWire({ t: 'reveal-face', face: 0, faceNonce: 'nonce-A' }) });
    expect(bad.reason).toBe('face-hash-mismatch');
    expect(bad.message.length).toBeGreaterThan(0);
    // ★ fail-closed：验不过就**什么都不留** —— 房主手里不能出现一个从未通过校验的面。
    // 这条腿同时钉住判据 5 的一个侧面：房主的 `face` 只能来自"校验通过的对端揭示"，
    // 不可能由房主自己（或一条对不上的揭示）填上。
    expect(h.face(), '校验失败之后房主手里留下了一个面（那等于房主自己定了面）').toBeNull();
    expect(h.phase(), '校验失败之后相位被推进了').toBe('seed-revealed');
  });

  it('★ N-1：握手之前收到的 `reveal-salt` 不许伪造状态（相位/盐/后续 hello 都要原样）', () => {
    // 这条腿对着阶段一评审实测的 C2：第一版没有相位守卫，一条**入站**
    // `{t:'reveal-salt', salt:'peer-salt'}` 就能把房主推到 `complete`，
    // 连带 `handshakeDone` / `acceptsInput` 双双变 true、`salt()` 被对端覆盖，
    // 并且此后**合法的 hello 被"握手已完成"永久拒掉**。
    const h = hostSession();
    const beforePhase = h.phase();
    const beforeSalt = h.salt();
    const beforeStatus = h.peerStatus();

    const forged = acceptRejected(h, { t: 'reveal-salt', msg: overWire({ t: 'reveal-salt', salt: 'peer-salt' }) });
    expect(forged.reason, '相位不对时收到的 reveal-salt 必须按"时机不对"拒绝').toBe('unexpected-message');
    expect(h.phase(), '一条入站消息把相位推走了').toBe(beforePhase);
    expect(h.salt(), '一条入站消息把本方的盐覆盖了').toBe(beforeSalt);
    expect(h.peerStatus(), '一条入站消息改动了状态读数').toEqual(beforeStatus);

    // 最关键的那半：伪造之后**合法握手仍然能成功**（第一版的症状正是这里永久失败）
    const helloDecision = h.accept({ t: 'hello', msg: overWire(hello()) });
    expect(helloDecision.ok, `伪造状态之后合法的 hello 被拒了：${helloDecision.ok ? '' : helloDecision.message}`).toBe(
      true,
    );
  });

  it('★ N-1 的正控 / N-8：房主只**发**盐，不收盐 —— 合法窗口里入站 reveal-salt 也被拒且不覆盖本方', () => {
    // 两条合在一起立在这里，因为它们说的是同一件事的两面：
    //  - N-1 的正控面：`sendRevealSalt()` 必须真的能在这条路径上走通
    //    （否则"入站被拒"可能只是"房主这一支根本不通"）；
    //  - N-8：**方向**。`reveal-salt` 的发送方只能是房主，所以房主侧不存在"合法收下"。
    //    阶段二复验实测 `AUDIT-host-salt-overwrite`：合法窗口里一条入站
    //    `{t:'reveal-salt', salt:'对端塞进来的盐'}` 会被收下并覆盖房主自己的盐。
    const h = hostSession();
    handshakeHost(h);
    expect(h.sendCommit(SEED, SALT).ok).toBe(true);
    acceptOk(h, { t: 'commit-face', msg: overWire({ t: 'commit-face', hash: sha256Concat('1', 'n') }) });
    expect(h.sendRevealSeed().ok, '承诺成立后房主应该能揭示种子').toBe(true);
    expect(h.phase()).toBe('seed-revealed');

    // 入站：被按"方向反了"拒绝，**且不改任何状态**（盐仍是本方的）
    const inbound = acceptRejected(h, { t: 'reveal-salt', msg: overWire({ t: 'reveal-salt', salt: '对端塞进来的盐' }) });
    expect(inbound.reason).toBe('unexpected-message');
    expect(h.salt(), '房主自己的盐被一条入站消息覆盖了').toBe(SALT);
    expect(h.phase()).toBe('seed-revealed');

    // 出站：先收对端的 `reveal-face`（发盐窗口收窄之后这是**必须**的一步），再发自己的盐
    acceptOk(h, { t: 'reveal-face', msg: overWire({ t: 'reveal-face', face: 1, faceNonce: 'n' }) });
    expect(h.phase()).toBe('complete');
    const out = h.sendRevealSalt();
    expect(out.ok, `合法窗口里房主发不出 reveal-salt：${out.ok ? '' : `${out.reason} / ${out.message}`}`).toBe(true);
    expect(out.ok ? out.salt : null, '发出去的不是房主自己的盐').toBe(SALT);
    expect(h.phase()).toBe('complete');
  });

  it('★ N-6：健康会话收到重复/迟到的 hello 不许被打成 rejected（在途的 reveal-face 必须还能进来）', () => {
    // 阶段二复验实测 `AUDIT-duplicate-hello`：旧行为下 15 相位里每一个都会 -hello-> rejected，
    // 后果三条 —— ① `seed-revealed` 之后合法的 `reveal-face` 再也进不来（在途承诺流程被作废）；
    // ② `peerStatus().handshakeDone` 从 true 变回 false；③ `sendRevealSeed()` 报
    // `seed-before-face` 并打印"加入方还没有提交承诺"—— 在 `seed-revealed` 相位下那是**假话**。
    const h = hostSession();
    handshakeHost(h);
    expect(h.sendCommit(SEED, SALT).ok).toBe(true);
    acceptOk(h, { t: 'commit-face', msg: overWire({ t: 'commit-face', hash: sha256Concat('1', 'n') }) });
    expect(h.sendRevealSeed().ok).toBe(true);
    expect(h.phase()).toBe('seed-revealed');
    const beforeStatus = h.peerStatus();
    expect(beforeStatus.handshakeDone).toBe(true);

    // 一条重放的 hello 砸进来
    const late = h.accept({ t: 'hello', msg: overWire(hello()) });
    expect(late.ok, '迟到的 hello 被"接受"了（那等于重开握手）').toBe(false);
    if (late.ok) throw new Error('unreachable');
    expect(late.reason).toBe('unexpected-message');
    // ① 相位不动
    expect(h.phase(), '一条重放消息把相位打走了').toBe('seed-revealed');
    // ② 读数不回退
    expect(h.peerStatus(), '一条重放消息改动了状态读数').toEqual(beforeStatus);
    expect(h.peerStatus().handshakeDone, 'handshakeDone 从 true 变回 false 了').toBe(true);
    // ③ 文案不能说假话：此刻承诺**早就提交过**了
    expect(late.message, '文案说"加入方还没有提交承诺" —— 在这个相位下是假话').not.toContain('还没有提交承诺');
    expect(late.message).toContain('忽略');

    // 最关键的一条：**在途的合法 reveal-face 仍然必须能进来**
    const rf = acceptOk(h, { t: 'reveal-face', msg: overWire({ t: 'reveal-face', face: 1, faceNonce: 'n' }) });
    expect(rf.phase).toBe('complete');
    expect(h.face()).toBe(1);
  });

  it('★ N-6 的正控：`rejected` 相位的迟到 hello 仍然被拒，且不去改那个终态', () => {
    // 拒绝一条迟到 hello 不能把"已经回绝"的会话**复活**（正控方向：两种相位都不动）。
    const h = hostSession();
    expect(h.accept({ t: 'hello', msg: hello({ protoVersion: 2 }) }).ok).toBe(false);
    expect(h.phase()).toBe('rejected');
    const again = h.accept({ t: 'hello', msg: overWire(hello()) });
    expect(again.ok).toBe(false);
    if (again.ok) throw new Error('unreachable');
    expect(again.message, '对已被回绝的会话说"握手已经成功过"是假话').toContain('回绝');
    expect(h.phase(), '迟到的 hello 把 rejected 相位改了').toBe('rejected');
  });

  it('★ N-7：加入方收到入站 `hello` 是方向错误 —— 拒绝、不动任何状态、且不阻断后续 commit', () => {
    // 阶段二复验实测 `AUDIT-guest-hello-resuming`：旧行为下一条 `{t:'hello',resuming:true}` 就能把
    // 加入方推到 `resuming`（**假读数**），此后真正的 `commit` **永久进不来**；
    // 普通 hello 还会改写它的座位读数（`座位 self 1->1 peer 0->1`）。
    const g = rawGuestSession();
    const beforeStatus = g.peerStatus();
    const beforeSelf = g.selfSeat();
    const beforePeer = g.peerSeat();

    const resuming = g.accept({ t: 'hello', msg: overWire(hello({ resuming: true })) });
    expect(resuming.ok, '加入方收下了入站 hello（方向反了）').toBe(false);
    if (resuming.ok) throw new Error('unreachable');
    expect(resuming.reason).toBe('unexpected-message');
    expect(g.phase(), '加入方被推到了 resuming（假读数）').toBe('handshaking');
    expect(g.peerStatus(), '加入方的状态读数被改动了').toEqual(beforeStatus);
    expect(g.selfSeat(), '座位读数被改写了').toBe(beforeSelf);
    expect(g.peerSeat(), '对端座位读数被改写了').toBe(beforePeer);

    // 普通 hello 同样不许改写座位
    expect(g.accept({ t: 'hello', msg: overWire(hello()) }).ok).toBe(false);
    expect(g.selfSeat()).toBe(beforeSelf);
    expect(g.peerSeat()).toBe(beforePeer);

    // 最关键的一条：此后**真正的 commit 必须还能进来**
    acceptHelloAck(g);
    const c = g.accept({ t: 'commit', msg: overWire({ t: 'commit', hash: sha256Concat(SEED, SALT) }) });
    expect(c.ok, `真正的 commit 被永久挡住了：${c.ok ? '' : c.message}`).toBe(true);
    expect(g.phase()).toBe('seed-committed');
  });

  it('★ N-7 的正控：加入方的握手由 `hello-ack` 驱动 —— 它到了才进承诺流程', () => {
    const g = rawGuestSession();
    expect(g.phase()).toBe('handshaking');
    // 还没收到 ack：commit 不该被接受（相位是 handshaking）
    expect(g.accept({ t: 'commit', msg: { t: 'commit', hash: 'h' } }).ok, '握手都没完成就收 commit').toBe(false);
    acceptHelloAck(g);
    expect(g.phase()).toBe('awaiting-commit');
    expect(g.peerStatus().handshakeDone, 'N-4 的"加入方握手已成功"现在有相位表示了').toBe(true);
    expect(g.accept({ t: 'commit', msg: { t: 'commit', hash: 'h' } }).ok).toBe(true);
  });

  it('★ N-7：座位以 `hello-ack` 为准（D7：座位是房主的决定）', () => {
    const g = rawGuestSession(1);
    expect(g.selfSeat()).toBe(1);
    // 房主把它安排在 0 号位
    acceptOk(g, { t: 'hello-ack', msg: overWire(helloAck({ seat: 0 })) });
    expect(g.selfSeat(), '加入方没有采用房主给的座位').toBe(0);
    expect(g.peerSeat()).toBe(1);
  });

  it('★ 加入方拒绝属于另一局的 `hello-ack`（sessionId 不符）', () => {
    const g = rawGuestSession();
    const r = acceptRejected(g, { t: 'hello-ack', msg: overWire(helloAck({ sessionId: '另一局' })) });
    expect(r.reason).toBe('unexpected-message');
    expect(g.phase(), '一条不属于本局的 ack 把相位推走了').toBe('handshaking');
  });

  it('★ `hello-ack` 的 `protoVersion` 必须校（第三阶段复验点名的漏项，已补）', () => {
    // `HelloAckMsg` 带着 `protoVersion`（`protocol.ts` 的形状里有），而 `decodeMsg` 只对
    // `hello` / `hello-ack` 校它（`:503-505`，而且那是"消息自带的值 vs 本机值"）。本模块还需要
    // 自己判一次"该不该**接受**这个 ack"：不校的后果是"房主用的是别的协议版本"会在加入方
    // **静默通过**，直到后面某条消息解析不出形状才炸 —— 那时已经离现场很远了。
    const g = rawGuestSession();
    // 这条**不走 `overWire`**：`decodeMsg` 在那一层就先按"消息自带的值 vs 本机值"拒掉了
    // 版本不符的 ack，于是消息根本到不了本模块。这一条要验的正是"**到了本模块之后**该不该接受"，
    // 所以直接把对象喂进 `accept`（T1 那一层的腿由 `tests/net/protocol.test.ts` 负责）。
    const r = acceptRejected(g, {
      t: 'hello-ack',
      msg: helloAck({ protoVersion: PROTO_VERSION + 1 }),
    });
    expect(r.reason).toBe('unexpected-message');
    expect(r.message, '版本不符的文案与握手第 1 步不是同一句（同一件事两种说法）').toContain('游戏版本不一致');
    expect(r.message).toContain(`对端协议 v${PROTO_VERSION + 1}`);
    expect(g.phase(), '版本不符的 ack 把相位推走了').toBe('handshaking');
    expect(g.peerStatus().handshakeDone).toBe(false);

    // 形状腿：`protoVersion` 整个缺失
    const g2 = rawGuestSession();
    const bad = acceptRejected(g2, {
      t: 'hello-ack',
      msg: { t: 'hello-ack', seat: 1, peerNick: 'host', sessionId: SESSION_ID },
    });
    expect(bad.reason).toBe('unexpected-message');
    expect(g2.phase()).toBe('handshaking');

    // 正控：版本对得上时**必须**接受（否则上面两条对"这一支整个坏了"也成立）
    const g3 = rawGuestSession();
    acceptOk(g3, { t: 'hello-ack', msg: overWire(helloAck()) });
    expect(g3.phase()).toBe('awaiting-commit');
  });

  it('★ N-11：加入方靠 `markResuming()` 显式进 `resuming`（否则它是死相位）', () => {
    // 第三阶段复验实测：N-7 封掉"加入方收入站 hello"之后，加入方**没有任何入站消息**能进
    // `resuming`（8 相位 × 11 入站消息逐格扫，`needsResync` 恒 false）。而 D8/设计稿 `:497`
    // 写的是"从机用 `hello{sessionId, resuming:true}` 回来" —— 那句话当时在相位上没落点。
    const g = rawGuestSession();
    expect(g.peerStatus().needsResync, '刚建出来就报 needResync').toBe(false);
    const r = g.markResuming();
    expect(r.ok, '加入方进不了 resuming').toBe(true);
    // 成功面带 `phase`（第四阶段复验：原先是空成功面 ⇒ 调用方得猜）
    expect(r.ok ? r.phase : null, 'markResuming 的成功面必须告诉调用方"现在在哪一格"').toBe('resuming');
    expect(g.phase()).toBe('resuming');
    expect(g.peerStatus().needsResync, 'N-11：这一位必须有真实的置位路径').toBe(true);
    expect(g.peerStatus().handshakeDone, 'resuming 不算握手完成').toBe(false);

    // 边界：已经进了承诺流程的会话不许"变成重连"
    const g2 = guestSession();
    const late = g2.markResuming();
    expect(late.ok, '已经在承诺流程里的会话被标成了重连').toBe(false);
    expect(late.ok ? null : late.reason).toBe('unexpected-message');
    expect(g2.phase(), '被拒的 markResuming 改了相位').toBe('awaiting-commit');

    // 重连相位下 `hello-ack` 仍然收得下（追平留给 T6，但握手这一格不能死）
    expect(g.accept({ t: 'hello-ack', msg: overWire(helloAck()) }).ok).toBe(true);
    expect(g.phase(), 'resuming 相位下的 hello-ack 该保持 resuming（等 T6 追平）').toBe('resuming');
    expect(g.peerStatus().needsResync).toBe(true);
  });

  it('★ 房主收到 `hello-ack` 是方向错误（那是它自己发出去的）', () => {
    const h = hostSession();
    handshakeHost(h);
    const r = acceptRejected(h, { t: 'hello-ack', msg: overWire(helloAck()) });
    expect(r.reason).toBe('unexpected-message');
    expect(h.phase()).toBe('awaiting-commit-face');
  });

  it('乱序被拒：commit-ack 早于 commit、reveal-face 早于 reveal-seed、reveal-salt 早于 reveal-seed', () => {
    const g = guestSession();
    expect(g.sendCommitAck().ok, '还没收到 commit 就回了 ack').toBe(false);

    const g2 = guestSession();
    acceptOk(g2, { t: 'commit', msg: overWire({ t: 'commit', hash: sha256Concat(SEED, SALT) }) });
    expect(g2.sendCommitAck().ok).toBe(true);
    expect(g2.commitFace(0, 'n').ok).toBe(true);
    expect(g2.sendRevealFace().ok, '还没收到 reveal-seed 就揭示了面').toBe(false);
    expect(
      acceptRejected(g2, { t: 'reveal-salt', msg: overWire({ t: 'reveal-salt', salt: SALT }) }).reason,
    ).toBe('unexpected-message');

    const h = hostSession();
    handshakeHost(h);
    expect(h.sendCommit(SEED, SALT).ok).toBe(true);
    expect(
      acceptRejected(h, { t: 'reveal-face', msg: overWire({ t: 'reveal-face', face: 1, faceNonce: 'n' }) }).reason,
    ).toBe('unexpected-message');
  });
});

/* ------------------------------------------------------------------ *
 * 判据 3：protoVersion / cardDataHash 的文案不是同一句
 * ------------------------------------------------------------------ */

/**
 * 从 `src/net/session.ts` 的 `SessionRejectReason` 声明里**抽出成员集合**（修复轮 N-2）。
 *
 * 为什么要抽而不是手写：手写清单与真实集合**结构上脱钩**，于是"新增一条理由码却没给它腿"
 * 是**必然漏**。T1 阶段一评审的 N-1 与本地评审的 F3 是同一个形态（两次实测都全绿通过）。
 * 这里从源码抽，于是加/删理由码都会让下面那条"双向闭合"红。
 *
 * 抽取失败必须**响亮抛错**，不能回一个空集 —— 空集会让 `closed == declared == []` 恒成立
 * （本仓记过档的"空扫为绿"）。
 */
function declaredRejectReasons(): string[] {
  const src = String(readFileSync(join(fileURLToPath(new URL('../../src/net/', import.meta.url)), 'session.ts')));
  const decl = /export type SessionRejectReason\s*=([\s\S]*?);/.exec(src);
  if (decl === null) throw new Error('源码里找不到 `export type SessionRejectReason = …;`（结构被改动？）');
  const members = [...decl[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  if (members.length === 0) throw new Error('SessionRejectReason 抽出来是空集 —— 这条判据会在空集上恒真');
  return [...new Set(members)].sort();
}

/** 同理抽出握手理由码（`SessionHelloReason`），**不手写** */
function declaredHelloReasons(): string[] {
  const src = String(readFileSync(join(fileURLToPath(new URL('../../src/net/', import.meta.url)), 'session.ts')));
  const decl = /export type SessionHelloReason\s*=([\s\S]*?);/.exec(src);
  if (decl === null) throw new Error('源码里找不到 `export type SessionHelloReason = …;`（结构被改动？）');
  const body = decl[1];
  // 它的一半成员是**引用**别的类型（`HelloRejectReason | 'bad-shape' | …`），所以两处都要收：
  //  - 字面量成员：`'bad-shape'` 这类直接写着的；
  //  - 引用成员：`HelloRejectReason` → 去 `protocol.ts` 里抽同名声明（`HelloRejectReason` 是
  //    **非导出**的？不是 —— 它由 `protocol.ts` 导出，本文件也 import 了它的类型）。
  const literals = [...body.matchAll(/'([^']+)'/g)].map((m) => m[1]);
  const refs = [...body.matchAll(/\b([A-Z][A-Za-z0-9_]*)\b/g)].map((m) => m[1]);
  const out = new Set(literals);
  if (refs.includes('HelloRejectReason')) {
    const proto = String(readFileSync(join(fileURLToPath(new URL('../../src/net/', import.meta.url)), 'protocol.ts')));
    const p = /export type HelloRejectReason\s*=([\s\S]*?);/.exec(proto);
    if (p === null) throw new Error('protocol.ts 里找不到 `export type HelloRejectReason = …;`');
    for (const m of p[1].matchAll(/'([^']+)'/g)) out.add(m[1]);
  } else {
    throw new Error('SessionHelloReason 的定义里没有引用 HelloRejectReason —— 抽取口径要跟着改');
  }
  if (out.size === 0) throw new Error('SessionHelloReason 抽出来是空集');
  return [...out].sort();
}

/**
 * **豁免清单**：允许"不在上面那张表里构造"的理由码。**必须逐条具名 + 写清理由**，
 * 且与 `REJECT_REASON_WHY` 的键集合相等（空壳豁免会让这条判据退化成下界）。
 *
 * 今天为空：下面那张表把 `SessionRejectReason` 的**每一个**成员都真构造了一遍
 * （这正是要的效果 —— 空清单意味着"没有一条是被豁免掉的"）。
 */
const REJECT_REASON_EXEMPT: readonly string[] = [];

/** 豁免理由（键集合必须等于 `REJECT_REASON_EXEMPT`；今天为空表） */
const REJECT_REASON_WHY: Readonly<Record<string, string>> = {};

/**
 * **握手面**的豁免清单：允许"不在这张表里构造"的握手理由码（具名 + 写清理由）。
 *
 * 两条 `*-slots-full` 是**真豁免**，理由是可核对的：它们的判定属于
 * `validateHello` 的第 3/4 步（T1 的**唯一出处**，`tests/net/protocol.test.ts` 判据 1
 * 有专门四条腿逐条钉它们），而**会话层今天构造不出来**：
 *  - `player-slots-full` 要 `occupied.players >= 2`，而 `occupiedPlayers()` 只塞进主机自己
 *    （`[selfSeat]`，两人局），所以最多是 1 —— 到不了阈值；
 *  - `spectator-slots-full` 要 `occupied.spectators >= 2`，而会话层把观战位**写死为空数组**
 *    （D5：G5 从不放行观战，观战在第 4 步之前就被回绝了）。
 * 这两条不是"忘了写"，是"会话层没有那条路径"；把它们登记成豁免而不是硬凑一条腿，
 * 是为了让这张表继续说真话（凑出来的腿会是一条恒不命中的假腿）。
 */
const HELLO_REASON_EXEMPT: readonly string[] = ['player-slots-full', 'spectator-slots-full'];

const HELLO_REASON_WHY: Readonly<Record<string, string>> = {
  'player-slots-full': '判定在 validateHello 第 3 步（T1 判据 1 有腿）；会话层 occupiedPlayers() 恒为 1 个座位，到不了阈值',
  'spectator-slots-full': '判定在 validateHello 第 4 步（T1 判据 1 有腿）；会话层把观战位写死为空（D5 从不放行观战）',
};

/**
 * 握手面的理由码全集：**从源码抽**（`SessionHelloReason` 的字面量成员 ∪ 它引用的
 * `HelloRejectReason` 的成员）。一个名字都不手写 —— 手写清单与真实集合结构上脱钩
 * （T1 N-1 与本地 F3 两次实测过这个形态：加标签没人提醒，必然漏）。
 */
const declaredHelloReasonList = declaredHelloReasons();

/**
 * **类型绑定**（修复轮 N-2 的整改；阶段二复验 F6 实测第一版是空的）。
 *
 * ## 第一版为什么是空的
 *
 * 它写的是 `Object.fromEntries(...) as Record<SessionRejectReason, true>`：
 * **`as` 断言把"缺键"与"多键"两个检查一起压掉了** —— 编译器不再核对这个对象的键集，
 * 于是它只是"把抽取结果原样包了一层"。而配套那条
 * `expect(Object.keys(...)).toEqual(declaredReasons)` 的两边**同一个来源** ⇒ **恒真**。
 * 决定性实验 F6：把新成员写成**双引号**（抽取正则只认单引号）⇒ `tsc exit 0` 且判据面全绿。
 *
 * ## 现在这一版
 *
 * - **对象字面量 + `satisfies`**：编译器**同时**管缺键与多键 —— 少一个成员 ⇒ 报"缺属性"，
 *   多一个不在类型里的键 ⇒ 报"对象字面量只能指定已知属性"。`satisfies` 不做类型断言，
 *   所以它**不会**像 `as` 那样把检查压掉。
 * - 每个成员**显式列一行**（不用 `fromEntries`）：只有字面量才谈得上"编译器核对键集"。
 * - 下面还有一条腿拿它做**运行期**一致性断言（多键/少键都会红），
 *   与"闭合腿"互补：闭合腿查"有没有腿"，这一层查"抽取口径有没有跟类型脱钩"。
 *
 * 它的**已知边界**（如实登记，不粉饰）：`tsconfig` 没开 `noUnusedLocals`，
 * 所以这个常量"没被用到"不会报错；它承重的是**编译期键集核对**本身 ——
 * 而"编译器真的会红"由 `verify-type-binding.mjs` 的**注入实验**机械证明
 * （往 `SessionRejectReason` 加一个成员 ⇒ 这条 `tsc` 报缺属性；`.superpowers/g5-T3/out/` 里有日志）。
 * 抽取正则只认单引号这件事也由下面那条腿钉住（双引号写法会让抽取集合变小 ⇒ 闭合腿红）。
 */
const REASON_NEEDS_LEG = {
  'seed-before-face': true,
  'seed-duplicate': true,
  'seed-not-expected': true,
  'face-hash-mismatch': true,
  'salt-hash-mismatch': true,
  'bad-hash': true,
  'bad-seed': true,
  'bad-salt': true,
  'bad-face': true,
  'unexpected-message': true,
  'resync-not-wired': true,
  'bad-resync': true,
  'resync-step-mismatch': true,
} satisfies Record<SessionRejectReason, true>;

const declaredRejectReasonList = declaredRejectReasons();

describe('判据 3：版本不符与卡牌指纹不符各给一句设计稿口径的话，且两句不同（D13）', () => {
  it('两条各自的 reason 与文案，且两句不相等', () => {
    const h = hostSession();
    const badVersion = h.accept({ t: 'hello', msg: hello({ protoVersion: PROTO_VERSION + 1 }) });
    expect(badVersion.ok).toBe(false);
    if (badVersion.ok) throw new Error('unreachable');
    expect(badVersion.reason).toBe('proto-version');
    expect(badVersion.message).toContain('游戏版本不一致');
    expect(badVersion.message).toContain('更新到最新版');

    const h2 = hostSession();
    const badHash = h2.accept({ t: 'hello', msg: hello({ cardDataHash: '另一个指纹' }) });
    expect(badHash.ok).toBe(false);
    if (badHash.ok) throw new Error('unreachable');
    expect(badHash.reason).toBe('card-data-hash');
    expect(badHash.message).toContain('卡牌数据版本不一致');
    expect(badHash.message).toContain('无法联机');

    expect(badVersion.message, '两句文案是同一句（把两条串了，对玩家毫无帮助）').not.toBe(badHash.message);
    expect(badVersion.message).not.toContain('无法联机');
    expect(badHash.message).not.toContain('更新到最新版');
  });

  it('文案同源：会话层给的就是 validateHello 那两句（不在第二处各写一份）', () => {
    const expected = validateHello(hello({ protoVersion: 999 }), {
      localProtoVersion: PROTO_VERSION,
      localCardDataHash: CARD_DATA_HASH,
      occupied: { players: [0], spectators: [] },
      seat: 1,
    });
    expect(expected.ok).toBe(false);
    if (expected.ok) throw new Error('unreachable');
    const h = hostSession();
    const actual = h.accept({ t: 'hello', msg: hello({ protoVersion: 999 }) });
    expect(actual.ok).toBe(false);
    if (actual.ok) throw new Error('unreachable');
    expect(actual.message, '会话层自己写了一套文案（两处判定迟早漂移）').toBe(expected.message);
  });

  it('★ 每一句拒绝文案都**必须说出属于它自己的那件事实**（串了文案 ⇒ 当场红）', () => {
    // 为什么单列一条：上面那条"两两不同"只能证明**不同理由码之间**没共用文案。
    // 实测踩过（变异 M2）：把"哈希不可用"那句换成"此刻不该收到它"那句之后，两句话仍然
    // **彼此不同**（它们分别属于两个理由码），于是"两两不同"照样绿 —— 但玩家已经拿到了
    // 一句**假话**（报文说"哈希不可用"，实际是顺序问题）。
    // ⇒ 必须再加一层：每句话里要有**只有它才有**的事实词。
    const h = hostSession();
    handshakeHost(h);

    // 形状失败：必须点出"哈希不可用"，且**不能**说成顺序问题
    const shape = acceptRejected(h, { t: 'commit-face', msg: { t: 'commit-face', hash: '' } });
    expect(shape.reason).toBe('bad-hash');
    expect(shape.message, '形状失败的文案没说清是哈希不可用').toContain('没有可用的 hash');
    expect(shape.message, '形状失败的文案被写成了顺序问题那一句（玩家会去查消息次序）').not.toContain(
      '此时收到 commit-face',
    );

    // 顺序失败：必须点出"当前相位 + 此时收到它"，且**不能**说成哈希不可用
    acceptOk(h, { t: 'commit-face', msg: overWire({ t: 'commit-face', hash: sha256Concat('1', 'n') }) });
    const order = acceptRejected(h, { t: 'commit-face', msg: overWire({ t: 'commit-face', hash: sha256Concat('1', 'n') }) });
    expect(order.reason).toBe('unexpected-message');
    expect(order.message, '顺序失败的文案没说清"此刻不该收到它"').toContain('此时收到 commit-face');
    expect(order.message, '顺序失败的文案被写成了哈希不可用那一句（玩家会去查哈希实现）').not.toContain(
      '没有可用的 hash',
    );
    expect(shape.message).not.toBe(order.message);
  });

  it('★ 全部拒绝理由的文案**两两不同**（加一条新拒绝而不给新文案 ⇒ 当场红）', () => {
    const messages: { label: string; reason: string; message: string; kind: 'hello' | 'wire' }[] = [];
    const collect = (label: string, r: { ok: boolean; reason?: string; message?: string }) => {
      if (r.ok) throw new Error(`${label} 本该被拒却是成功`);
      messages.push({ label, reason: r.reason as string, message: r.message as string, kind: 'wire' });
    };
    /** 握手面的拒绝走这个（理由码属于 `SessionHelloReason`，不参与线理由的闭合断言） */
    const collectHello = (label: string, r: { ok: boolean; reason?: string; message?: string }) => {
      if (r.ok) throw new Error(`${label} 本该被拒却是成功`);
      messages.push({ label, reason: r.reason as string, message: r.message as string, kind: 'hello' });
    };

    // 握手面
    collectHello('proto-version', hostSession().accept({ t: 'hello', msg: hello({ protoVersion: 2 }) }));
    collectHello('card-data-hash', hostSession().accept({ t: 'hello', msg: hello({ cardDataHash: 'x' }) }));
    collectHello('bad-shape', hostSession().accept({ t: 'hello', msg: { t: 'hello' } }));
    collectHello('unsupported-spectator', hostSession().accept({ t: 'hello', msg: hello({ role: 'spectator' }) }));

    // 会话面（每条都真的构造出来）
    const hNoHandshake = hostSession();
    collect('seed-before-face(host)', hNoHandshake.sendRevealSeed());

    const g0 = rawGuestSession();
    collect('seed-before-face(guest)', g0.accept({ t: 'reveal-seed', msg: { t: 'reveal-seed', seed: 's' } }));
    collect('bad-seed', g0.accept({ t: 'reveal-seed', msg: { t: 'reveal-seed', seed: '' } }));
    collect('bad-hash', g0.accept({ t: 'commit', msg: { t: 'commit', hash: '' } }));

    const { h, g } = runCommitRevealFull();
    collect('unexpected-message', g.accept({ t: 'reveal-salt', msg: { t: 'reveal-salt', salt: SALT } }));
    collect('resync-not-wired', h.accept({ t: 'resync-req', msg: { t: 'resync-req', sessionId: SESSION_ID, appliedSteps: 3 } }));
    collect('bad-face', h.accept({ t: 'reveal-face', msg: { t: 'reveal-face', face: 7, faceNonce: 'n' } }));
    // `seed-not-expected`：**加入方**已经走完承诺流程（相位 `complete`）之后再收到 reveal-seed
    // ⇒ 那是对端把整个流程重放了一遍。
    // 这一条**不能**用房主来构造（实测踩过）：`accept()` 的方向分派先判角色，
    //    房主收到 `reveal-seed` 在**到达 `acceptRevealSeed` 之前**就被判成 `unexpected-message`
    //    （方向反了）—— 那是另一条腿。`seed-not-expected` 只长在加入方这一侧。
    const gReplay = guestAwaitingSalt();
    expect(gReplay.accept({ t: 'reveal-salt', msg: { t: 'reveal-salt', salt: SALT } }).ok).toBe(true);
    expect(gReplay.phase()).toBe('complete');
    collect('seed-not-expected', gReplay.accept({ t: 'reveal-seed', msg: { t: 'reveal-seed', seed: SEED } }));

    // `seed-duplicate`：必须在**收过种子、还没发出 reveal-face** 的那个窗口里再收一条
    // （`runCommitRevealFull` 之后加入方已经是 `complete`，那时来的是 `seed-not-expected` ——
    //  实测踩过：拿它去凑 `seed-duplicate` 会让闭合腿报"缺一条"）。
    // 注：`guestAwaitingSalt()` 已经推进到 `reveal-salt-sent`（N-10 的注释修正），
    //     那时再来种子走的是 `seed-not-expected`——所以这里要**它之前**的那一格。
    const gDup = guestSession();
    acceptOk(gDup, { t: 'commit', msg: overWire({ t: 'commit', hash: sha256Concat(SEED, SALT) }) });
    expect(gDup.sendCommitAck().ok).toBe(true);
    expect(gDup.commitFace(1, 'nonce-A').ok).toBe(true); // 承诺要先于种子（§5.3）
    acceptOk(gDup, { t: 'reveal-seed', msg: overWire({ t: 'reveal-seed', seed: SEED }) });
    expect(gDup.phase(), '夹具问题：这一格该是 seed-revealed').toBe('seed-revealed');
    collect('seed-duplicate', gDup.accept({ t: 'reveal-seed', msg: { t: 'reveal-seed', seed: SEED } }));

    // 相位**合法**（`reveal-salt-sent`）但 salt 是空串：形状先判 ⇒ `bad-salt`
    // （与上面那条 `unexpected-message` 是两件事：一条是时机错、一条是报文本身不可用）
    collect('bad-salt', guestAwaitingSalt().accept({ t: 'reveal-salt', msg: { t: 'reveal-salt', salt: '' } }));

    // 相位合法、salt 形状也对，但**兑现不了承诺** ⇒ `salt-hash-mismatch`
    // （走完流程的加入方走不到这里 —— 它的相位已经是 `complete`；必须是"还没收盐"的那个状态）
    collect(
      'salt-hash-mismatch',
      guestAwaitingSalt().accept({ t: 'reveal-salt', msg: { t: 'reveal-salt', salt: '换了 salt' } }),
    );

    // 承诺校验失败面：另起一局各自构造
    const h2 = hostSession();
    handshakeHost(h2);
    expect(h2.sendCommit(SEED, SALT).ok).toBe(true);
    acceptOk(h2, { t: 'commit-face', msg: overWire({ t: 'commit-face', hash: '承诺-A' }) });
    const rs = h2.sendRevealSeed();
    expect(rs.ok).toBe(true);
    collect('face-hash-mismatch', h2.accept({ t: 'reveal-face', msg: { t: 'reveal-face', face: 1, faceNonce: '不一样' } }));

    // T6 新增的两个理由码（**跨文件的必要同步**：闭合腿的口径是"实际构造出的 ∪ 豁免"必须
    // 等于 `SessionRejectReason` 的声明集合，所以新码必须在这里真的构造一次）。
    //  - `bad-resync`：房主收到的 `resync-req` 属于**另一局**（sessionId 不符）⇒ 拒绝且不回档案。
    //    T6 之前这条走的是"追平还没接上"，现在追平接上了，拒绝的理由只能由"请求本身不可用"
    //    来承担（判据 10 的形状腿）。
    collect(
      'bad-resync',
      hostSession().accept({ t: 'resync-req', msg: { t: 'resync-req', sessionId: '另一局', appliedSteps: 0 } }),
    );
    //  - `resync-step-mismatch`：调用方自报的步数与档案长度对不上（**少一步也算**）。
    //    这里故意报 1 而档案是 0 条操作：判据 11 的负向那一半。走的是真实路径
    //    （markResuming → hello-ack → resync-res → applyResyncFile）。
    const gResync = rawGuestSession();
    expect(gResync.markResuming().ok).toBe(true);
    acceptHelloAck(gResync);
    acceptOk(gResync, { t: 'resync-res', msg: overWire({ t: 'resync-res', file: RESYNC_PROBE_FILE }) });
    collect('resync-step-mismatch', gResync.applyResyncFile(RESYNC_PROBE_FILE, 1));

    // ★ 覆盖面**双向闭合**（修复轮 N-2，形态照 T1 阶段一评审 N-1 的处置）。
    //
    // 旧写法是 `reasons.size >= 12` —— 一个**下界**，与理由码集合**结构上脱钩**，
    // 于是"新增一条理由码、不给它一条腿"**必然漏**（不是概率漏）。阶段一评审用 F3 实测过：
    // 加一条 `'zz-uncovered'` 并让"房主收到坏 salt"这条真实路径返回它 ⇒ 判据面 31/31 绿、
    // 探针面 32/32 绿、exit 0。
    //
    // 现在改成：从 `session.ts` 的 `SessionRejectReason` 声明里**抽出成员集合**，
    // 与"实际构造出来的集合 ∪ 显式豁免集（具名 + 写理由）"做**相等**断言。
    //
    // 两个集合要**分开算**（实测踩过，第一版混在一起报了两类假差）：
    //  - "会话线理由"（`SessionRejectReason`）：只有走 `accept()` / `sendRevealSeed()` 那些腿
    //    才产生它 —— 参与闭合；
    //  - "握手理由"（`proto-version` / `card-data-hash` / `bad-shape` / `unsupported-spectator`）：
    //    它们来自 `validateHello` 与会话层的观战回绝，**不属于**上面那个类型，混进来会报"extra"。
    //    它们由 `HELLO_REASONS` 单独覆盖（同一条腿里也断它们一句文案都不重）。
    // 类型绑定（运行期那一半）：`REASON_NEEDS_LEG` 的键集合必须**恰好**等于抽取出来的集合。
    // 这一条与上一层的 `satisfies` **互补**：`satisfies` 管"字面量键集 vs 类型"（编译期），
    // 这一条管"字面量键集 vs 源码抽取"（运行期）—— 少了任何一边，脱钩都会从另一边溜过去。
    // 它**不是**恒真的：两边来源不同（一边是我手写的字面量，一边是从 `session.ts` 抽的）。
    expect(Object.keys(REASON_NEEDS_LEG).sort(), '理由码字面量与源码抽取结果不符（哪一边脱钩了？）').toEqual(
      declaredRejectReasonList,
    );

    const covered = new Set(messages.filter((m) => m.kind === 'wire').map((m) => m.reason));
    const closed = [...new Set([...covered, ...REJECT_REASON_EXEMPT])].sort();
    const missing = declaredRejectReasonList.filter((r) => !closed.includes(r));
    const extra = closed.filter((r) => !declaredRejectReasonList.includes(r));
    expect(
      { missing, extra },
      'SessionRejectReason 的成员集合与"实际构造出的 ∪ 豁免"不一致（新增/删除理由码后忘了同步这条腿或豁免清单？）',
    ).toEqual({ missing: [], extra: [] });
    // 握手面同样**双向闭合**（差集口径：`SessionHelloReason` 与 `SessionRejectReason` 有重叠，
    // 重叠的那些由线理由那一侧负责；实测踩过：不差集的话 `unexpected-message` 会被当成
    // "已经有了"而掩盖别的缺口）。
    const helloOnly = declaredHelloReasonList.filter((r) => !declaredRejectReasonList.includes(r));
    const helloCovered = new Set(messages.filter((m) => m.kind === 'hello').map((m) => m.reason));
    const helloClosed = [...new Set([...helloCovered, ...HELLO_REASON_EXEMPT])].sort();
    const helloMissing = helloOnly.filter((r) => !helloClosed.includes(r));
    const helloExtra = helloClosed.filter((r) => !helloOnly.includes(r));
    expect(
      { helloMissing, helloExtra },
      `握手面理由码的闭合断了：缺腿 ${helloMissing.join(', ') || '(无)'}；多出来的 ${helloExtra.join(', ') || '(无)'}`,
    ).toEqual({ helloMissing: [], helloExtra: [] });
    // 豁免清单必须具名 + 写清理由，且与理由表严格同步（空壳豁免会让上面那条退化成下界）
    expect(Object.keys(HELLO_REASON_WHY).sort(), '握手豁免表与豁免集不同步').toEqual([...HELLO_REASON_EXEMPT].sort());
    for (const [reason, why] of Object.entries(HELLO_REASON_WHY)) {
      expect(why.length, `握手豁免 ${reason} 没写理由`).toBeGreaterThan(10);
    }
    // 豁免集本身必须**具名且写清理由**，不许留空壳
    expect(Object.keys(REJECT_REASON_WHY).sort(), '豁免清单的理由表与豁免集不同步').toEqual(
      [...REJECT_REASON_EXEMPT].sort(),
    );
    for (const [reason, why] of Object.entries(REJECT_REASON_WHY)) {
      expect(why.length, `豁免 ${reason} 没写理由`).toBeGreaterThan(10);
    }

    // ★ 两两不同：判据 3 的"两句不是同一句"在这里被扩到**全部**理由码。
    // 变异 M2（把 busy 与 proto-version 的文案串了）会让这一条红。
    //
    // 表要按 **`reason`** 去重（同一个理由码在房主/加入方两侧会各构造一次 —— 那是**对的**，
    //    两侧共用同一句话是设计：玩家不该因为自己是哪一边而看到不同的解释）。
    //    实测：第一版按"出现次数"判重，当场把 `seed-before-face(host)` 与
    //    `seed-before-face(guest)` 判成"有人串了文案"。要判的是**不同理由码之间**是否共用文案。
    const byReason = new Map<string, string>();
    for (const m of messages) {
      if (!byReason.has(m.reason)) byReason.set(m.reason, m.message);
    }
    const byMessage = new Map<string, string[]>();
    for (const [reason, message] of byReason) {
      byMessage.set(message, [...(byMessage.get(message) ?? []), reason]);
    }
    const dupes = [...byMessage.entries()].filter(([, rs]) => rs.length > 1);
    expect(
      dupes.map(([text, rs]) => `${rs.join(' + ')} => ${JSON.stringify(text.slice(0, 60))}`),
      '有两个**不同的**拒绝理由共用同一句文案（玩家分不清是哪一种）',
    ).toEqual([]);
    // 理由码本身也不许重复登记（防"同一个码被当成两种"这种表写错）
    expect(byReason.size, '理由码表里条目太少').toBeGreaterThanOrEqual(12);
    for (const m of messages) expect(m.message.length, `${m.label} 没有文案`).toBeGreaterThan(0);

    // 安全那一条的文案必须是**专门**的那一句（不是从别的理由借来的）
    const sbf = messages.find((m) => m.reason === 'seed-before-face');
    expect(sbf, '没有构造出 seed-before-face 这一条').toBeDefined();
    expect(sbf!.message).toBe(REVEAL_SEED_BEFORE_FACE_MESSAGE);
  });
});

/* ------------------------------------------------------------------ *
 * 判据 4：观战被明确回绝（D5），且与"观战席已满"分得清
 * ------------------------------------------------------------------ */

describe('判据 4：观战者被明确回绝，原因可读且与 spectator-slots-full 可区分（D5）', () => {
  it('G5 回绝观战：reason 是 unsupported-spectator，文案与"席满"那句不同', () => {
    const h = hostSession();
    const r = h.accept({ t: 'hello', msg: hello({ role: 'spectator' }) });
    expect(r.ok, '观战者被放进了 G5 的两人对局').toBe(false);
    if (r.ok) throw new Error('unreachable');
    // `accept()` 的失败面是 `HelloRejection | SessionDecision 的失败面` 两条并集
    // （`hello` 多了 `emit` 与两条件握手专属理由码）。用 `in` 收窄 —— `if (r.ok)` 只收 narrow 掉
    // 成功面，收不出"这是不是握手回绝"（实测 TS2339：`emit` 不存在于另一支上）。
    expect('emit' in r, '这不是一条握手回绝（测试自己的夹具问题）').toBe(true);
    if (!('emit' in r)) throw new Error('unreachable');
    expect(r.reason).toBe('unsupported-spectator');
    expect(r.message).toBe(SPECTATOR_UNSUPPORTED_MESSAGE);
    expect(r.message).toContain('观战');
    expect(r.phase).toBe('rejected');

    // 要发回去的那条 busy：`reason` 用协议认得的 'unsupported'，而**区分点**在 detail 里
    expect(r.emit, '观战回绝居然不发 busy，对端只会看到超时').toBe(true);
    expect(r.busy.t).toBe('busy');
    expect(r.busy.reason).toBe('unsupported');
    expect(r.busy.detail).toContain('不是"观战席已满"');

    // 对照：真的"观战席已满"走的是 validateHello 的第 4 条，两者必须是**两个值、两句不同的话**
    const full = validateHello(hello({ role: 'spectator' }), {
      localProtoVersion: PROTO_VERSION,
      localCardDataHash: CARD_DATA_HASH,
      occupied: { players: [], spectators: [0, 1] },
      seat: 1,
    });
    expect(full.ok).toBe(false);
    if (full.ok) throw new Error('unreachable');
    expect(full.reason).toBe('spectator-slots-full');
    expect(r.reason).not.toBe(full.reason);
    expect(r.message).not.toBe(full.message);
    expect(r.busy.detail).not.toBe(full.message);
  });

  it('观战回绝发生在 D13 四步**之后**：版本不符时先报版本（那条更该先说）', () => {
    const h = hostSession();
    const r = h.accept({ t: 'hello', msg: hello({ role: 'spectator', protoVersion: PROTO_VERSION + 1 }) });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('unreachable');
    expect(r.reason, '观战的分支抢在版本校验之前报了，玩家会去换房间而版本还是不对').toBe('proto-version');
    expect(r.message).toContain('游戏版本不一致');
  });

  it('观战者拿不到任何会话状态，且回绝之后不再接受第二条 hello', () => {
    const h = hostSession();
    expect(h.accept({ t: 'hello', msg: hello({ role: 'spectator' }) }).ok).toBe(false);
    const again = h.accept({ t: 'hello', msg: hello() });
    expect(again.ok, '回绝过观战之后又接受了玩家的 hello').toBe(false);
    if (again.ok) throw new Error('unreachable');
    expect(again.reason).toBe('unexpected-message');
    expect(h.peerStatus().handshakeDone).toBe(false);
    expect(h.peerStatus().acceptsInput).toBe(false);
  });

  it('形状不合法的 hello 不发 busy（对一个身份不明的对端不确认协议长什么样）', () => {
    const h = hostSession();
    const r = h.accept({ t: 'hello', msg: { t: 'hello', role: 'player' } });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('unreachable');
    expect(r.reason).toBe('bad-shape');
    expect('emit' in r && r.emit, '形状失败居然要发包').toBe(false);
  });
});

/* ------------------------------------------------------------------ *
 * 判据 5：选面者是加入方（D3）
 * ------------------------------------------------------------------ */

describe('判据 5：选面者固定为加入方，房主不能成为选面者（D3）', () => {
  it('★ 房主收到 `commit-face` 之后**自己仍然没有面** —— 收到的是对端的承诺，不是它选的面', () => {
    // 这条腿对着一个真会发生的形态：把"收到承诺"顺手实现成"我也定一个面"（变异 M4）。
    // 干净世界里房主的 `face` 只可能由**校验通过的 reveal-face** 填上（见判据 2 的篡改腿）。
    const h = hostSession();
    handshakeHost(h);
    expect(h.sendCommit(SEED, SALT).ok).toBe(true);
    // 线上这条消息可以多带一个 face 字段（真实 commit-face 不带，但一台被改过的对端可以带）
    const r = h.accept({ t: 'commit-face', msg: { t: 'commit-face', hash: sha256Concat('1', 'n'), face: 1 } });
    expect(r.ok, `形状合法的 commit-face 被拒了：${r.ok ? '' : r.message}`).toBe(true);
    expect(h.face(), '房主把自己收到的面当成了自己选的面（房主不该是选面者）').toBeNull();
    expect(h.peerStatus().faceCommitted, '承诺收到了，这一位该是 true').toBe(true);
  });

  it('房主**收**加入方的面：房主自己给出的面只可能来自对端的 reveal-face', () => {
    const h = hostSession();
    const g = guestSession();
    handshakeHost(h);
    const c = h.sendCommit(SEED, SALT);
    expect(c.ok).toBe(true);
    if (!c.ok) throw new Error('unreachable');
    acceptOk(g, { t: 'commit', msg: overWire(c.output.msg) });
    expect(g.sendCommitAck().ok).toBe(true);

    // 房主侧：还没有收到任何面
    expect(h.face(), '房主在收到 reveal-face 之前就有面了').toBeNull();
    expect(h.peerStatus().faceCommitted).toBe(false);

    // 加入方选面 ⇒ 房主仍然没有面（只是承诺）
    expect(g.commitFace(0, 'nonce-Z').ok).toBe(true);
    expect(h.face()).toBeNull();

    // 只有对端揭示之后，房主才拿到面
    acceptOk(h, { t: 'commit-face', msg: overWire({ t: 'commit-face', hash: sha256Concat('0', 'nonce-Z') }) });
    const rs = h.sendRevealSeed();
    expect(rs.ok).toBe(true);
    if (!rs.ok) throw new Error('unreachable');
    acceptOk(g, { t: 'reveal-seed', msg: overWire(rs.output.msg) });
    const rf = g.sendRevealFace();
    expect(rf.ok).toBe(true);
    if (!rf.ok) throw new Error('unreachable');
    acceptOk(h, { t: 'reveal-face', msg: overWire(rf.output.msg) });
    expect(h.face(), '房主没能从加入方的 reveal-face 里拿到面').toBe(0);
  });

  it('加入方是唯一能发起承诺的一方：它的 commit-face 一定出现在它自己的相位上', () => {
    const g = rawGuestSession();
    // 没收到 `hello-ack` 之前不能选面（相位 `'handshaking'`）
    expect(g.commitFace(0, 'n').ok).toBe(false);
    acceptHelloAck(g); // 握手成功 ⇒ 相位 `'awaiting-commit'`
    expect(g.phase()).toBe('awaiting-commit');
    // 收到 hello-ack、但还没收到 commit 也不能选面
    expect(g.commitFace(0, 'n').ok).toBe(false);
    acceptOk(g, { t: 'commit', msg: overWire({ t: 'commit', hash: 'h' }) });
    // 收到 commit、但还没回 ack 也不能选面（相位 `'seed-committed'`）
    expect(g.commitFace(0, 'n').ok).toBe(false);
    expect(g.sendCommitAck().ok).toBe(true);
    // 到这里才是加入方选面的那一格
    const f = g.commitFace(1, 'n');
    expect(f.ok).toBe(true);
    if (!f.ok) throw new Error('unreachable');
    expect(f.hash).toBe(sha256Concat('1', 'n'));
    expect(g.faceHashOfCommit()).toBe(f.hash);
  });

  it('★ 类型面：房主会话上没有 `commitFace` / `sendRevealFace`，加入方会话上没有 `sendCommit` / `sendRevealSeed`', () => {
    // 运行期只看得到"自己声明的那些键" —— 这条腿证明两个角色的 API 面是**真的分叉**的，
    // 而 D3（"房主不能成为选面者"）因此不只是文档里的一句话。
    const h = hostSession();
    const g = guestSession();
    const hKeys = Object.keys(h).sort();
    const gKeys = Object.keys(g).sort();
    expect(hKeys).not.toContain('commitFace');
    expect(hKeys).not.toContain('sendRevealFace');
    expect(gKeys).not.toContain('sendCommit');
    expect(gKeys).not.toContain('sendRevealSeed');
    // 正控：两边各自该有的方法在（否则"不包含"可能只是"什么都没挂"）
    expect(hKeys).toContain('sendRevealSeed');
    expect(hKeys).toContain('acceptCommitFace');
    expect(gKeys).toContain('commitFace');
    expect(gKeys).toContain('sendRevealFace');
    // 加入方**没有** "收到 commit-face"这个口（那是房主的），房主也没有"收 reveal-seed"的口
    expect(gKeys).not.toContain('acceptCommitFace');
    expect(hKeys).not.toContain('acceptRevealSeed');
    // 公共面两边一致（值不同但键集合相同的那部分）
    for (const k of ['accept', 'peerStatus', 'phase', 'seed', 'face', 'selfSeat', 'peerSeat', 'sessionId', 'role']) {
      expect(hKeys, `房主会话缺 ${k}`).toContain(k);
      expect(gKeys, `加入方会话缺 ${k}`).toContain(k);
    }
  });
});

/* ------------------------------------------------------------------ *
 * 契约腿：「网络来的输入一律不抛」（收口轮补）
 * ------------------------------------------------------------------ */

/** 读 `src/net` 下的生产源码（生成式腿用它反推矩阵维度） */
const NET_SRC_DIR = fileURLToPath(new URL('../../src/net/', import.meta.url));

/** 矩阵里用的不透明哈希（只求过形状；不参与真实验签） */
const PROBE_HASH = 'probe-hash';

/**
 * 矩阵里**加入方**那一侧收到的 `commit.hash`：取房主真承诺的那一个。
 *
 * 为什么不能用常数：加入方在 `acceptRevealSaltFinal` 里要拿 `hash(seed, salt)` 与它比，
 * 常数会让"收下盐"这一步报 `salt-hash-mismatch`（**但相位照样推到 `complete`** ——
 * 那是一条真实的失败路径，`collect` 表里专门有它的腿）。矩阵要的是**正常路径**，
 * 所以这里用配对房主真算出来的那个哈希，让验签通过。
 */
let PROBE_COMMIT_HASH = PROBE_HASH;
{
  const probeHost = hostSession();
  handshakeHost(probeHost);
  const c = probeHost.sendCommit(SEED, SALT);
  if (!c.ok) throw new Error('夹具自证失败：配对房主发不出 commit');
  PROBE_COMMIT_HASH = sha256Concat(SEED, SALT);
}

/**
 * 「**网络输入不抛**」的生成式性质腿（实现者登记的第 1 条，收口轮补）。
 *
 * ## 为什么这条必须存在
 *
 * 会话层在真实对局里 `throw` 一次 = **本机客户端直接崩**，而本项目是"所有逻辑跑在本地"的
 * 无后端形态 —— 崩了没有服务端兜底。这条契约写在 `session.ts` 的文件头与 `accept` 的注释里，
 * 但在这一轮之前它**没有任何一条腿**：它只是被几个相位守卫**顺带保护**着。
 *
 * 反证是复验人的 F13 实测：把**收**盐守卫短路掉之后，加入方在 `handshaking` 收到 `reveal-salt`
 * 就会够到 `throw new Error('…还没拿到种子/承诺就要验盐…')` —— 也就是说"不抛"这件事
 * **依赖守卫先跑**，而守卫哪天被放宽，没有任何一条腿会为此变红。
 * 这正是本仓记过档的"**守卫没有腿等于没有守卫**"形态。
 *
 * ## 矩阵从生产代码**现算**（不手抄清单）
 *
 * 手抄清单必漏（T1 阶段一评审 N-1 的教训：手写的覆盖面清单与真实集合结构上脱钩，
 * 加一项没有机制会提醒）。所以：
 *  - **相位**：解析 `session.ts` 里 `SessionPhase` 联合类型的字符串字面量成员；
 *  - **入站消息**：解析 `session.ts` 里 `SessionInbound` 的 `{ t: '…' }` 成员；
 *  - **每类消息的字段**：解析 `protocol.ts` 里 `SHAPES` 的**形状判定**，按 matcher 反推一个
 *    能过形状检查的取值 —— "新增一个 `SessionInbound` 成员"会让矩阵**自动多一行**，
 *    而"新增一个形状字段"会让模板生成**当场抛错**（不许静默跳过）。
 *
 * ## 两个维度今天取不全的地方（显式登记，撑大即红）
 *
 * 1. **线上有 14 种消息，`SessionInbound` 只声明 9 种**。差额 5 种（`act` / `busy` / `bye` /
 *    `forfeit` / `resync-res`）**本会话层今天不接收** —— 它们是"本模块往线上**发**的"或
 *    "归 T5/T6 消费的"。矩阵按 `SessionInbound` 取维度，并把这条差额**断言**出来
 *    （`WIRE_OUT_OF_SCOPE`）：线上新增一种消息而没人决定它归谁时，这条会红。
 * 2. **豁免白名单** `THROWS_ALLOWED`：今天**为空** —— 没有任何一格允许抛。它必须与实测的
 *    抛错格集合**恰好相等**（空表 ⇒ 只要有一格抛就红）。
 */
function declaredWireTypes(): string[] {
  const src = String(readFileSync(join(NET_SRC_DIR, 'protocol.ts')));
  // 锚在行首；终止用"行首的 `};`"（同一族的抽取踩坑说明见 `declaredInboundTypes`）
  const decl = /^const MSG_TYPES: Record<NetMsgType, true> = \{([\s\S]*?)\n\};/m.exec(src);
  if (decl === null) throw new Error('protocol.ts 里找不到 `MSG_TYPES`（结构被改动？）');
  const keys = [...decl[1].matchAll(/^\s*'?([\w-]+)'?:\s*true/gm)].map((m) => m[1]);
  if (keys.length === 0) throw new Error('MSG_TYPES 抽出来是空集 —— 这条判据会在空集上恒真');
  return [...new Set(keys)].sort();
}

function declaredInboundTypes(): string[] {
  const src = String(readFileSync(join(NET_SRC_DIR, 'session.ts')));
  // 三个坑，全都实测踩过：
  //  1. **注释里不能逐字写出下面那条正则的匹配文本** —— 否则它会先匹配到注释自己（第一版就是这样）。
  //  2. 捕获体不能写成 `([\s\S]*?);`：联合类型**第一个成员的末尾就有一个 `;`**
  //     （`{ t: 'hello'; msg: unknown }`），非贪婪写法会在那里停住、只抽到 1 个成员。
  //  3. 也不能写成"以一个 `;` 结尾"：那个 `;` 不在行首（行首是 `|`），锚不上。
  //  ⇒ 统一口径：**读到下一个空行为止**（本仓顶层声明之间都空一行）。
  //
  // 第四条（第五阶段复验实测）：**引号风格必须不敏感**。第一版只认单引号
  //    （`'([^']+)'`），于是往 `SessionInbound` 加一个**双引号**成员时抽取会**静默缩水**，
  //    而 `expectedCells` 用同一份缩水清单算 ⇒ 自查自洽、全绿。
  //    这是 T1 那条"表里的集合必须与样本实际打中的集合相等"的同族问题。
  //    下面的说明符接受 `'` 与 `"` 两种引号；"写法变化导致漏抽"由**交叉计数**兜住 ——
  //    但那条计数正则必须与这里**容忍同一种写法**（见 `declaredInboundTCount` 的说明）。
  const decl = /^export type SessionInbound =([\s\S]*?)\n\n/m.exec(src);
  if (decl === null) throw new Error('session.ts 里找不到 `SessionInbound`（结构被改动？）');
  const keys = [...decl[1].matchAll(/\{ t: ['"]([^'"]+)['"]/g)].map((m) => m[1]);
  if (keys.length < 2) throw new Error(`SessionInbound 只抽到 ${keys.length} 个成员（抽取口径坏了？）`);
  return [...new Set(keys)].sort();
}

/**
 * `SessionInbound` 里 `t:` 出现的**总次数**（不挑引号风格、**也不挑冒号前的空格**）。
 *
 * 用途：与"抽取到的成员数"做**交叉计数** —— 抽取正则若因为写法变化漏掉成员，那个数会
 * **小于**这个数 ⇒ 当场红。这是"半缩水"能被察觉的关键（只断言"非空"防不住它）。
 *
 * **这条计数正则必须容忍与抽取正则同一种写法**（第六阶段复验实测的教训，我上一轮的登记
 * 说反了）：第一版这里写的是 `/\bt:/g`（不容忍 `t :`），而抽取正则同样不容忍 —— 两边**一起漏**，
 * 于是 `| { t : 'zz-inbound'; msg: unknown };`（冒号前一个空格）**49/49 全绿**。
 * ⇒ 口径是：**计数与抽取要么同时容忍某种写法，要么同时不容忍**；现在两边都容忍空格
 * （抽取是 `\{ t: ` 还是 `\{ t : `？见 `declaredInboundTypes` —— 它按**源码实际写法**收紧，
 * 所以这里用 `\s*` 把"多空格"这种**写法变化**兜住，让计数小于抽取时立刻红）。
 */
function declaredInboundTCount(): number {
  const src = String(readFileSync(join(NET_SRC_DIR, 'session.ts')));
  const decl = /^export type SessionInbound =([\s\S]*?)\n\n/m.exec(src);
  if (decl === null) throw new Error('session.ts 里找不到 `SessionInbound`（结构被改动？）');
  return [...decl[1].matchAll(/\bt\s*:/g)].length;
}

/**
 * `MSG_TYPES` 里条目出现的**总次数**（不挑引号风格，**也不挑冒号前的空格**）；与抽取结果交叉计数。
 *
 * 与上面同一条纪律：**计数正则必须容忍与抽取正则同一种写法**。
 * 这一侧今天是好的：抽取正则 `^ {2}'?([\w-]+)'?:\s*true` 里键名后**没有**要求紧贴冒号，
 * 所以 `'zz-wire' : true`（键前多空格）两边都能认（第六阶段复验实测"世界 D 红 1"）。
 * 这里的 `:\s*true` 也容忍键与冒号之间的空白与冒号后的空白 —— 保持同口径，别改坏。
 */
function declaredWireEntryCount(): number {
  const src = String(readFileSync(join(NET_SRC_DIR, 'protocol.ts')));
  const decl = /^const MSG_TYPES: Record<NetMsgType, true> = \{([\s\S]*?)\n\};/m.exec(src);
  if (decl === null) throw new Error('protocol.ts 里找不到 `MSG_TYPES`（结构被改动？）');
  return [...decl[1].matchAll(/:\s*true\b/g)].length;
}
function declaredPhaseList(): string[] {
  const src = String(readFileSync(join(NET_SRC_DIR, 'session.ts')));
  // 同一口径：读到下一个空行为止（见 `declaredInboundTypes` 的三条踩坑说明）
  const decl = /^export type SessionPhase =([\s\S]*?)\n\n/m.exec(src);
  if (decl === null) throw new Error('session.ts 里找不到 `SessionPhase`（结构被改动？）');
  const keys = [...decl[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  if (keys.length === 0) throw new Error('SessionPhase 抽出来是空集');
  return [...new Set(keys)].sort();
}

/**
 * 按字段名给一个**能过形状检查**的取值。
 *
 * 只认已知字段；遇到不认识的字段就**抛错**（不许静默给 `undefined` —— 那样新字段会让这一格
 * 变成"形状失败"而不是"真的喂了那条消息"，判据就悄悄退化了）。
 */
const FIELD_VALUES: Readonly<Record<string, unknown>> = {
  role: 'player',
  sessionId: SESSION_ID,
  protoVersion: PROTO_VERSION,
  cardDataHash: CARD_DATA_HASH,
  seat: 1,
  nick: 'guest',
  peerNick: 'host',
  reason: 'player',
  detail: 'x',
  hash: PROBE_HASH,
  seed: 'probe-seed',
  salt: 'probe-salt',
  faceNonce: 'probe-nonce',
  face: 1,
  resuming: false,
  file: {},
  seq: 0,
  kind: 'probe-kind',
  player: 0,
  appliedSteps: 0,
};

/**
 * 从 `SHAPES` 的源码里切出 `"<消息类型>"` 列（用**花括号配平**，不用"读到空行"那一招 ——
 * `SHAPES` 内部每个条目之间就有空行，见下面 `fieldsOfShapes` 的说明）。
 *
 * 返回每段的起点下标 + 类型名，供 `fieldsOfShapes` 按区间切字段。
 */
function shapeChunks(src: string): { name: string; body: string }[] {
  const at = src.indexOf('const SHAPES');
  if (at < 0) throw new Error('protocol.ts 里找不到 `SHAPES`（结构被改动？）');
  // 必须从 `= {` 起算，**不能**取"声明头之后的第一个 `{`"：那一个是**类型标注**里的
  //    `{ [K in NetMsgType]: … }`（实测配平到那里就结束了，一个条目都切不出来）。
  const eq = src.indexOf('= {', at);
  if (eq < 0) throw new Error('`SHAPES` 声明头之后找不到 `= {`');
  const open = eq + 2;
  // 花括号配平找对象末尾（`SHAPES` 全是表达式，字符串里不会出现花括号）
  let depth = 0;
  let end = -1;
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}') {
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end < 0) throw new Error('`SHAPES` 的花括号不配平');
  const body = src.slice(open + 1, end);
  // 每个条目以「行首两个空格 + 名字 + :」开头。
  // 参数表**可能是空的**：`'commit-ack': () => true`（没有参数，因为它不读任何字段）。
  //    只认 `(m)` 会静默漏掉它 —— 实测切出 13 个而 `SHAPES` 有 14 个。
  const starts: { name: string; at: number }[] = [];
  for (const m of body.matchAll(/^ {2}'?([\w-]+)'?:\s*\((?:m)?\)/gm)) {
    starts.push({ name: m[1], at: m.index });
  }
  if (starts.length === 0) throw new Error('SHAPES 里一个条目都没切出来');
  return starts.map((s, i) => ({ name: s.name, body: body.slice(s.at, i + 1 < starts.length ? starts[i + 1].at : body.length) }));
}

/** 解析出每类消息的字段名（从 `SHAPES` 的 matcher 反推，不手抄） */
function fieldsOfShapes(): Map<string, string[]> {
  const src = String(readFileSync(join(NET_SRC_DIR, 'protocol.ts')));
  const out = new Map<string, string[]>();
  for (const { name, body } of shapeChunks(src)) {
    const flat = body.replace(/\s+/g, ' ');
    const fields = [...flat.matchAll(/(?:\bm\.|\.)([A-Za-z_]\w*)/g)].map((m) => m[1]);
    out.set(name, [...new Set(fields)]);
  }
  if (out.size === 0) throw new Error('SHAPES 抽出来是空集');
  return out;
}

/** 造一条该类型的入站消息（字段取自 `SHAPES`，值取自 `FIELD_VALUES`） */
function inboundTemplate(t: string, shapes: Map<string, string[]>): SessionInbound {
  const fields = shapes.get(t);
  if (fields === undefined) throw new Error(`SHAPES 里没有 ${t} —— 新消息类型忘了给形状？`);
  const msg: Record<string, unknown> = { t };
  for (const f of fields) {
    if (!(f in FIELD_VALUES)) {
      throw new Error(
        `消息 ${t} 的形状里出现了未登记字段 m.${f} —— 请把它加进 FIELD_VALUES 并想清它的取值（不许静默跳过）`,
      );
    }
    msg[f] = FIELD_VALUES[f];
  }
  // `act.action` 是个嵌套对象（`SHAPES` 里写成 `m.action.seq` 这类），单列出来省得解析嵌套
  if (t === 'act') msg.action = { seq: 0, player: 0, kind: 'probe-kind' };
  // ★ 模板自证：造出来的报文必须**真的过得了 T1 的形状检查**（`encodeMsg` 是它的唯一出口）。
  //   不过就是模板错了 —— 那样这一格会变成"形状失败"而不是"真的喂了那条消息"，判据悄悄退化。
  const enc = encodeMsg(msg);
  if (!enc.ok) throw new Error(`inboundTemplate 造出的 ${t} 过不了 encodeMsg 的形状检查：${enc.message}`);
  return { t, msg } as SessionInbound;
}

/** 快照：相位 + 关键读数（拒绝一格之后这两样都不许变） */
function snapshotOf(session: HostSession | GuestSession): string {
  return JSON.stringify({
    phase: session.phase(),
    selfSeat: session.selfSeat(),
    peerSeat: session.peerSeat(),
    seed: session.seed(),
    face: session.face(),
    salt: session.salt(),
    peerStatus: session.peerStatus(),
  });
}

type PhaseRecipe = (role: 'host' | 'guest') => HostSession | GuestSession;

/**
 * 每个相位**由哪个角色**能到达（矩阵只在这些 (相位, 角色) 组合上跑）。
 *
 * 为什么需要它：`'awaiting-commit'` / `'seed-committed'` / `'reveal-salt-sent'` 是**加入方专有**的相位，
 * 房主根本到不了；硬给房主造一个只会得到"配方没推到目标相位"的断言失败。
 * ⇒ 这张表是**显式**的，并由下面两句断言兜住：
 *  - 表里的相位集合必须**恰好等于** `SessionPhase` 的抽取结果（新增相位而没登记 ⇒ 红）；
 *  - 每个角色都必须出现在至少一个条目里（否则"某一侧整列没跑"不会被发现）。
 */
const PHASE_ROLES: Readonly<Record<string, readonly ('host' | 'guest')[]>> = {
  handshaking: ['host', 'guest'],
  resuming: ['host', 'guest'],
  'resync-pending': ['guest'],
  'awaiting-commit-face': ['host'],
  'awaiting-commit': ['guest'],
  'seed-committed': ['guest'],
  'awaiting-commit-ack': ['guest'],
  'face-committed': ['host', 'guest'],
  'seed-revealed': ['host', 'guest'],
  'reveal-salt-sent': ['guest'],
  complete: ['host', 'guest'],
  rejected: ['host'],
};

/**
 * **相位配方**：从一张白纸把会话推到目标相位。
 *
 * ★ **这几张登记表（`PHASE_RECIPES` / `PHASE_ROLES` / `PHASE_UNREACHABLE`）必须手写，
 *   不许从抽取结果（`declaredPhaseList()` / `declaredInboundTypes()` 等）派生**。
 *   理由（第六阶段复验推理、我在此钉住）：一旦某张表改成从抽取结果派生，比对它的那条断言就
 *   退化成"自己和自己比"——正是本文件里已经被抓到过的"自证恒真"那一族
 *   （`WIRE_OUT_OF_SCOPE` 第一版、`REASON_NEEDS_LEG` 第一版都是这个形态）。
 *   手写在这里是**安全的**，因为闭合腿替它兜着：表里的集合必须恰好等于抽取结果，
 *   于是"新增相位/成员而没登记"会红。
 *
 * 这份表与 `SessionPhase` 抽取结果的相等性由腿里那句断言钉住（新增相位而没给配方 ⇒ 当场红）。
 */
const PHASE_RECIPES: Readonly<Record<string, PhaseRecipe>> = {
  handshaking: (role) => (role === 'host' ? hostSession() : rawGuestSession()),
  resuming: (role) => {
    if (role === 'host') {
      const h = hostSession();
      expect(h.accept({ t: 'hello', msg: overWire(hello({ resuming: true })) }).ok).toBe(true);
      return h;
    }
    const g = rawGuestSession();
    expect(g.markResuming().ok).toBe(true);
    return g;
  },
  'awaiting-commit-face': (role) => {
    expect(role).toBe('host');
    const h = hostSession();
    handshakeHost(h);
    return h;
  },
  /**
   * T6 新增的相位：**档案已经到了本端、还没被追平应用**。
   *
   * 只有加入方到得了（`acceptResyncRes` 是它唯一的入口，而那个口只长在加入方会话上）；
   * 房主那一格登记在 `PHASE_UNREACHABLE` 里。
   */
  'resync-pending': (role) => {
    expect(role).toBe('guest');
    const g = rawGuestSession();
    expect(g.markResuming().ok).toBe(true);
    acceptHelloAck(g);
    acceptOk(g, { t: 'resync-res', msg: overWire({ t: 'resync-res', file: RESYNC_PROBE_FILE }) });
    return g;
  },
  'awaiting-commit': (role) => {
    expect(role).toBe('guest');
    const g = rawGuestSession();
    acceptHelloAck(g);
    return g;
  },
  'seed-committed': (role) => {
    expect(role).toBe('guest');
    const g = rawGuestSession();
    acceptHelloAck(g);
    acceptOk(g, { t: 'commit', msg: { t: 'commit', hash: PROBE_COMMIT_HASH } });
    return g;
  },
  'awaiting-commit-ack': (role) => {
    expect(role).toBe('guest');
    const g = PHASE_RECIPES['seed-committed']('guest') as GuestSession;
    expect(g.sendCommitAck().ok).toBe(true);
    return g;
  },
  'face-committed': (role) => {
    if (role === 'host') {
      const h = PHASE_RECIPES['awaiting-commit-face']('host') as HostSession;
      expect(h.sendCommit(SEED, SALT).ok).toBe(true);
      acceptOk(h, { t: 'commit-face', msg: { t: 'commit-face', hash: sha256Concat('1', 'nonce-x') } });
      return h;
    }
    const g = PHASE_RECIPES['awaiting-commit-ack']('guest') as GuestSession;
    expect(g.commitFace(1, 'nonce-x').ok).toBe(true);
    return g;
  },
  'seed-revealed': (role) => {
    if (role === 'host') {
      const h = PHASE_RECIPES['face-committed']('host') as HostSession;
      expect(h.sendRevealSeed().ok).toBe(true);
      return h;
    }
    const g = PHASE_RECIPES['face-committed']('guest') as GuestSession;
    acceptOk(g, { t: 'reveal-seed', msg: { t: 'reveal-seed', seed: SEED } });
    return g;
  },
  'reveal-salt-sent': (role) => {
    expect(role).toBe('guest');
    const g = PHASE_RECIPES['seed-revealed']('guest') as GuestSession;
    expect(g.sendRevealFace().ok).toBe(true);
    return g;
  },
  complete: (role) => {
    if (role === 'host') {
      const h = PHASE_RECIPES['seed-revealed']('host') as HostSession;
      acceptOk(h, { t: 'reveal-face', msg: { t: 'reveal-face', face: 1, faceNonce: 'nonce-x' } });
      return h;
    }
    const g = PHASE_RECIPES['reveal-salt-sent']('guest') as GuestSession;
    acceptOk(g, { t: 'reveal-salt', msg: { t: 'reveal-salt', salt: SALT } });
    return g;
  },
  rejected: (role) => {
    // 只有房主到得了（加入方没有"把这次握手判死"的路 —— 见 PHASE_UNREACHABLE 的登记）。
    // 这里**不能**写 `expect(role).toBe('host')`：可达性检查会用一个 try/catch 探这一格，
    //    那样断言失败会被静默吞掉、把"不可达"伪装成"正常"（实测踩过）。
    expect(role === 'host', 'rejected 的配方只为房主准备').toBe(true);
    const s = hostSession();
    // 房主这一支**不走 `overWire`**：`decodeMsg` 会先按版本不符拒掉这条报文（T1 那一层），
    // 消息根本到不了会话层 —— 而这里要的是"会话层把它判死"。直接把对象喂进 `accept`。
    const r = s.accept({ t: 'hello', msg: hello({ protoVersion: PROTO_VERSION + 1 }) });
    expect(r.ok, '夹具问题：造不出 rejected').toBe(false);
    expect(s.phase()).toBe('rejected');
    return s;
  },
};

/**
 * **(相位, 角色) 里**取不到**的格子**（显式登记，双向闭合）。
 *
 * 六个"对方那一格"的相位是**角色专有**的，加一个由构造决定取不到的：
 *  - `guest/awaiting-commit-face`：这个相位是**房主**在等加入方的 `commit-face`；加入方对应的是
 *    `awaiting-commit`（等房主的 commit）与 `awaiting-commit-ack`（等自己发承诺）。
 *  - `host/awaiting-commit`：**加入方**在等房主的 `commit`（房主没有"等 commit"这一格）。
 *  - `host/seed-committed`：**加入方**收下 `commit` 之后的那一格。
 *  - `host/awaiting-commit-ack`：**加入方**该发自己 `commit-face` 的那一格。
 *  - `host/reveal-salt-sent`：**加入方**发出 `reveal-face` 之后的那一格。
 *  - `guest/rejected`：**加入方没有"把这次握手判死"的路** —— `hello` 只能由它发出（N-7：它收到
 *    入站 `hello` 是方向错误、当场忽略），而 `hello-ack` 被拒不构成"这次握手失败"
 *    （不调 `rejectHello`，相位不动、不发包）。房主那一侧由 `rejectHello` 判死，到得了。
 *
 * **双向闭合**：下面有一条腿断言"实测取不到的格子集合 == 这份清单"，于是
 * **新增**一个取不到的格子会红（逼你登记 + 写清为什么），**删掉**一格也会红。
 */
const PHASE_UNREACHABLE: readonly string[] = [
  'guest/awaiting-commit-face',
  'guest/rejected',
  'host/awaiting-commit',
  'host/awaiting-commit-ack',
  'host/reveal-salt-sent',
  'host/seed-committed',
  // T6 新增的那一格：`resync-pending` 只由**加入方**的 `acceptResyncRes` 进入（房主没有那个口：
  // 它这一侧发的是 `resync-res`，收档案的是加入方）。登记在这里是**双向闭合**的要求 ——
  // "新增一个取不到的格子要登记 + 写清为什么"。
  'host/resync-pending',
];

/**
 * 线上有、但本会话层今天不接收的消息（显式登记；线上新增消息而没人决定它归谁 ⇒ 上面那条断言会红）。
 *
 * ★ 与 `PHASE_RECIPES` / `PHASE_ROLES` / `PHASE_UNREACHABLE` 同一条纪律：**必须手写，
 *   不许从 `inbounds` / `wire` 这些抽取结果派生**（派生会让比对它的断言退化成本文件里
 *   已经被抓到过的"自证恒真"）。理由与完整说明见 `PHASE_RECIPES` 的头注。
 */
const WIRE_OUT_OF_SCOPE: readonly string[] = ['act', 'busy', 'bye', 'forfeit'];

/**
 * **允许抛错**的格子白名单。今天**为空**：144 格里没有任何一格允许抛。
 * 它必须与实测的抛错格集合**恰好相等**（空表 ⇒ 只要有一格抛就红）。
 */
const THROWS_ALLOWED: readonly string[] = [];

describe('契约：网络来的输入一律不抛（生成式：全部相位 × 全部入站消息）', () => {
  const phases = declaredPhaseList();
  const inbounds = declaredInboundTypes();
  const shapes = fieldsOfShapes();
  const wire = declaredWireTypes();

  it('矩阵的维度确实是从生产代码抽出来的（不是手抄，也不是空集）', () => {
    expect(phases.length, 'SessionPhase 抽空了').toBeGreaterThanOrEqual(10);
    expect(inbounds.length, 'SessionInbound 抽空了').toBeGreaterThanOrEqual(9);
    // ★ **交叉计数**（第五阶段复验要求的"半缩水"防线）：抽取正则若因引号风格或写法变化
    //   漏掉成员，抽到的成员数会**小于**源码里的总数 ⇒ 当场红。
    //   只断言"非空 / >= N"防不住半缩水（评审实测：加一个**双引号**成员 ⇒ 全绿）。
    //   **计数正则必须与抽取正则容忍同一种写法**（第六阶段复验实测的教训）：第一版计数写的是
    //   `\bt:`、抽取也不容忍 `t :` ⇒ 两边**一起漏**，"冒号前多空格"照样全绿。
    //   现在两边都容忍空格（计数用 `\bt\s*:`），世界 C（`t : '…'`）会红。
    expect(
      inbounds.length,
      `SessionInbound 抽到 ${inbounds.length} 个成员，但源码里有 ${declaredInboundTCount()} 个 t: —— 抽取漏了（引号风格？）`,
    ).toBe(declaredInboundTCount());
    expect(
      wire.length,
      `MSG_TYPES 抽到 ${wire.length} 个条目，但源码里有 ${declaredWireEntryCount()} 个 —— 抽取漏了`,
    ).toBe(declaredWireEntryCount());
    // 线上消息 = 本层接收的 ∪ 显式登记为"不在本层"的（差额必须**恰好**由 `WIRE_OUT_OF_SCOPE` 解释）。
    //
    // **这里必须比较两个不同的对象**（第五阶段复验实测的缺陷）：第一版写的是
    //     `expect({ wire, accounted }).toEqual({ wire, accounted })` —— 两边**同一个对象**，
    //     恒真。评审人构造"`MSG_TYPES` 加一个 `'zz-wire'`"的世界 ⇒ 49/49 全绿。
    //     这正是本仓"覆盖面自证"最该防的形态：**自证恒真**。
    const accounted = [...new Set([...inbounds, ...WIRE_OUT_OF_SCOPE])].sort();
    expect(
      accounted,
      '线上消息集合与"本层接收 ∪ 显式豁免"不一致（线上新增消息后没人决定它归谁？）',
    ).toEqual([...wire].sort());
    // 差额本身也要**说清**（不是靠上面那条的副作用）：两个方向的差都要恰好为`WIRE_OUT_OF_SCOPE`/空
    expect(
      wire.filter((t) => !inbounds.includes(t)).sort(),
      '线上有、本层不收、但没登记进 WIRE_OUT_OF_SCOPE 的消息',
    ).toEqual([...WIRE_OUT_OF_SCOPE].sort());
    expect(
      inbounds.filter((t) => !wire.includes(t)),
      '本层声明接收、线上却没有的消息（`SessionInbound` 与 `MSG_TYPES` 脱钩了）',
    ).toEqual([]);
    for (const t of inbounds) expect(shapes.has(t), `SHAPES 里没有 ${t}`).toBe(true);
    // 配方必须覆盖全部相位（**新增相位而没给配方 ⇒ 这里红**）
    expect(Object.keys(PHASE_RECIPES).sort(), '有相位没有配方（或配方里有不存在的相位）').toEqual(phases);
    // (相位 → 角色) 表也必须**恰好**覆盖全部相位
    expect(Object.keys(PHASE_ROLES).sort(), '(相位 → 角色) 表与 SessionPhase 不一致').toEqual(phases);
    // (a) 每个**声明可达**的 (相位, 角色) 都必须真的到得了（否则矩阵在别的相位上跑，假绿）
    const declaredReachable: string[] = [];
    for (const phase of phases) {
      for (const role of ['host', 'guest'] as const) {
        if (!PHASE_ROLES[phase].includes(role)) continue;
        declaredReachable.push(`${role}/${phase}`);
        expect(PHASE_RECIPES[phase](role).phase(), `配方没把 ${role} 推到 ${phase}`).toBe(phase);
      }
    }
    // (b) 没声明的组合必须**确实到不了**，且"到不了的那些"必须**恰好**等于显式登记（双向闭合：
    //     新增一个取不到的格子会红，逼你登记 + 写清为什么；删掉一格也会红）
    const undeclaredReachable: string[] = [];
    for (const phase of phases) {
      for (const role of ['host', 'guest'] as const) {
        if (PHASE_ROLES[phase].includes(role)) continue;
        let reached: string | null = null;
        try {
          reached = PHASE_RECIPES[phase](role).phase();
        } catch {
          reached = null;
        }
        if (reached === phase) undeclaredReachable.push(`${role}/${phase}`);
      }
    }
    expect(
      undeclaredReachable.sort(),
      '有格子实际到得了却没在 PHASE_ROLES 里声明（那它没跑矩阵）',
    ).toEqual([]);
    const allPairs = phases.length * 2;
    const declaredPairSet = [
      ...phases.flatMap((p) => PHASE_ROLES[p].map((r) => `${r}/${p}`)),
    ].sort();
    const actualUnreachable = [...phases.flatMap((p) => (['host', 'guest'] as const).map((r) => `${r}/${p}`))]
      .filter((k) => !declaredPairSet.includes(k))
      .sort();
    expect(
      actualUnreachable,
      '不可达的格子与 PHASE_UNREACHABLE 的登记不一致（新增取不到的格子要登记 + 写清为什么）',
    ).toEqual([...PHASE_UNREACHABLE].sort());
    expect(declaredPairSet.length, '声明可达的格数对不上（矩阵跑的面与登记不一致）').toBe(
      allPairs - PHASE_UNREACHABLE.length,
    );
    const roles = new Set(Object.values(PHASE_ROLES).flat());
    expect([...roles].sort(), '有一侧角色一次都没跑').toEqual(['guest', 'host']);
  });

  it('★ 全部相位 × 全部入站消息：一格都不许抛；被拒的格子里相位与读数不许变', () => {
    const thrown: string[] = [];
    const mutatedOnReject: string[] = [];
    let cells = 0;
    let accepted = 0;
    let rejected = 0;

    for (const phase of phases) {
      for (const role of PHASE_ROLES[phase]) {
        for (const t of inbounds) {
          const label = `${role}/${phase} <- ${t}`;
          const session = PHASE_RECIPES[phase](role);
          // 配方必须真的停在该相位（否则这一格测的是别的相位 —— 假绿）
          expect(session.phase(), `配方没把 ${role} 推到 ${phase}`).toBe(phase);
          const before = snapshotOf(session);
          let decision: { ok: boolean; reason?: string } | null = null;
          try {
            decision = session.accept(inboundTemplate(t, shapes)) as { ok: boolean; reason?: string };
          } catch (e) {
            thrown.push(`${label}: ${String(e)}`);
            continue;
          }
          cells += 1;
          if (decision.ok) {
            accepted += 1;
          } else {
            rejected += 1;
            // 两个**刻意收窄**的地方，写在这里免得下一个人以为它是全称命题：
            //  1. 例外按**理由码**排：`t === 'reveal-salt' && reason === 'salt-hash-mismatch'`。
            //     ⇒ 将来**别的相位/角色**返回同一个理由码并改了状态，也会被这条豁免放过。
            //     它**窄但非零**；要收紧就得连相位一起匹配（今天没必要，只有那一格会走到）。
            //  2. 矩阵里 `reveal-salt` 用的模板盐（`FIELD_VALUES.salt`）与承诺盐（`SALT`）**不同**
            //     ⇒ 那两格**永远走失败分支**（`salt-hash-mismatch`）。"收下盐并验通"的**成功**分支
            //     由判据 2 的 `runCommitRevealFull` / B-1 那几条腿覆盖，不靠矩阵。
            const verifiedThenFailed = t === 'reveal-salt' && decision.reason === 'salt-hash-mismatch';
            if (!verifiedThenFailed && snapshotOf(session) !== before) {
              mutatedOnReject.push(label);
            }
          }
        }
      }
    }

    // ① 不抛（这是这条腿的主断言）
    expect(thrown, `以下格子抛了异常（网络输入绝不许抛）：\n${thrown.join('\n')}`).toEqual([...THROWS_ALLOWED]);
    // ② 被拒的格子状态不变（相位 + 座位 + seed/face/salt + peerStatus 逐字相同）
    expect(mutatedOnReject, `以下格子被拒之后状态却变了：\n${mutatedOnReject.join('\n')}`).toEqual([]);
    // ③ 矩阵非平凡（两面都有"接受"与"拒绝"两类结果）——否则上面两条可能是空转
    const expectedCells = phases.reduce((n, p) => n + PHASE_ROLES[p].length * inbounds.length, 0);
    expect(cells, '矩阵一格都没跑成').toBe(expectedCells);
    expect(accepted, '没有一格被接受（配方或模板坏了？）').toBeGreaterThan(0);
    expect(rejected, '没有一格被拒（那"状态不变"这条恒真）').toBeGreaterThan(0);
  });

  it('★ 这条腿是收盐那一格的**行为钉子**（"守卫是唯一屏障"由 M5 演示）', () => {
    // **这条腿的自述不能写成"在干净世界就能核出那条 `throw`"**（第五阶段复验纠正）：
    //    干净世界里它**够不到**那条 `throw` —— 守卫先拦，走的是结果对象。所以它的真价值是两点：
    //      ① 那条 `throw` 所在格的**行为钉子**（没有种子/承诺时收 `reveal-salt` ⇒ 结果对象 + 相位不动）；
    //      ② **在 M5（短路收盐守卫）下会红** —— 那时才会真的抛
    //         `session.ts 内部不一致：还没拿到种子/承诺就要验盐。`
    //    也就是说"守卫是唯一屏障"这件事由**变异 M5 演示**，不是由这条腿在干净世界自证。
    const g = rawGuestSession();
    expect(g.phase()).toBe('handshaking');
    const r = g.accept({ t: 'reveal-salt', msg: { t: 'reveal-salt', salt: SALT } });
    expect(r.ok, '握手前收到的 reveal-salt 必须走结果对象被拒').toBe(false);
    expect(r.ok ? null : r.reason).toBe('unexpected-message');
    expect(g.phase(), '被拒的那一格改了相位').toBe('handshaking');
    // 正控：同一条路径在**守卫放行**的相位上必须走得通（否则上面的"被拒"对"这一支根本不通"也成立）
    const g2 = guestAwaitingSalt();
    expect(g2.phase()).toBe('reveal-salt-sent');
    const ok2 = g2.accept({ t: 'reveal-salt', msg: { t: 'reveal-salt', salt: SALT } });
    expect(ok2.ok, '守卫放行的相位上也收不下 reveal-salt').toBe(true);
  });
});

/* ------------------------------------------------------------------ *
 * 判据 6：状态机不自己算哈希；HashLike 只此一处定义
 * ------------------------------------------------------------------ */

describe('判据 6：哈希是注入能力（状态机不算哈希、保持同步），HashLike 只有一处定义', () => {
  const NET_DIR = fileURLToPath(new URL('../../src/net/', import.meta.url));

  function tsFiles(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) tsFiles(p, out);
      else if (p.endsWith('.ts')) out.push(p);
    }
    return out;
  }

  /**
   * 去注释用仓库既有的那一份（`tests/ui/source-text.ts`），**不自己写一个正则**。
   *
   * 实测踩过：第一版自己写了一条行注释正则，而 `session.ts` 的注释里有一句
   * 'src/ui/net-browser.ts（T7）的 crypto.subtle.digest' —— 那个双斜线出现在**注释的文本里**，
   * 自写的正则会把注释起点认错、把后面整段当成代码留下，于是"注释里提到的 crypto."反而被
   * 当成代码命中 ⇒ 这条腿**假红**（实测命中 ['crypto.', 'subtle']）。
   * `source-text.ts` 的扫描器是字符串/模板串感知的，正是为这种情形写的
   * （它自己头注里记着同一族教训："两份拷贝一旦漂移，其中一边就会假绿"）。
   */

  /**
   * 判据 6 的文本腿：`session.ts` 的**代码位**里没有算哈希的调用形态。
   *
   * ## 为什么必须按"代码位"扫，而不是"剥注释后扫字符串"
   *
   * 这是本轮实际踩到的一个假红，值得写下来：`net-purity.test.ts` 的浏览器 API 判据是
   * **裸词面**匹配（`/\bcrypto\s*\./`），而它的 `stripComments` **只剥注释、不剥字符串**
   * （`tests/ui/source-text.ts` 的头注自己写着这一点）。于是：
   *  - `session.ts` 的报错文案里若出现那个名字（`'异步的 crypto.subtle 封装…'`），
   *    守卫会把一条**纯字符串**判成"调用了浏览器 API" —— T2 的评审人自建镜像时就是这么红的；
   *  - 我在本文件里给 `session.ts` 写"真实实现是 crypto.subtle.digest"这类**解释性注释**
   *    也是同一族风险（注释被剥掉才算安全，但"注释会不会被正确剥掉"不该是这条判据的前提）。
   *
   * ⇒ `session.ts` 的正文与文案里**一个这样的词都不留**（见那里的注释），本文件的判据改成
   * 用 `codePositions()` 只看代码位。这样两头都不依赖"剥注释剥得对"：
   * 代码位命中才算违规，而解释文字怎么写都不会假红。
   */
  const CALLS_HASH = /\bcrypto\s*[.(]|\bsubtle\s*[.(]|\bdigest\s*\(/g;

  /** 只在**代码位**上找 CALLS_HASH 的命中（照 `tests/ui/source-text.ts` 的既有做法） */
  function hashCallHits(code: string): string[] {
    const isCode = codePositions(code);
    const hits: string[] = [];
    for (const m of code.matchAll(CALLS_HASH)) {
      if (isCode[m.index]) hits.push(m[0]);
    }
    return hits;
  }

  it('session.ts 的**代码位**里没有算哈希的调用（D15：哈希必须由外部算好喂进来）', () => {
    // `readFileSync` 的声明在本仓是 `{ subarray, toString }`（`tests/node-types.d.ts`：只声明了
    // **一个**参数、且没有 `length`）⇒ 不管编码直接归一成字符串，否则 tsc 会报"多传了一个参数"。
    const raw = String(readFileSync(join(NET_DIR, 'session.ts')));
    expect(raw.length, 'session.ts 读成空串（下面的"零命中"会在空串上恒真）').toBeGreaterThan(2000);

    const hits = hashCallHits(stripComments(raw));
    expect(hits, 'session.ts 自己调哈希了（D15：哈希必须由外部算好喂进来）').toEqual([]);

    // 锚点：同一个函数对一段真会调哈希的代码必须命中（否则上面那条恒真）
    expect(
      hashCallHits(stripComments('const d = await crypto.subtle.digest("SHA-256", b);')),
      '算哈希的判据抓不到一段真的调用（上面那条"零命中"是恒真的）',
    ).not.toEqual([]);
    // 反控 1：注释里提到它不算命中
    expect(
      hashCallHits(stripComments('// 真实实现是 crypto.subtle.digest，本模块不碰它\nconst a = 1;')),
      '注释里的调用被判成违规（假红：这条腿会在自己的说明文字上红）',
    ).toEqual([]);
    // 反控 2：**字符串里的**提到也不算（这正是本轮踩到的那条假红的形态）
    expect(
      hashCallHits(stripComments("const why = '异步的 crypto.subtle 封装属于 src/ui/net-browser.ts';")),
      '报错文案里提到那个 API 就被判成违规（本轮实测踩过的假红形态）',
    ).toEqual([]);
    // 反控 3：`HashLike`（它就是要住在这里的东西）与普通代码不许被误判
    expect(
      hashCallHits(stripComments('export interface HashLike { (...p: readonly string[]): string; }')),
    ).toEqual([]);
  });

  it('★ 反过来：session.ts 的正文与**文案**里一个这样的词都不留（连注释里的都清掉了）', () => {
    // 为什么把这条也钉住：共享树上的纯度守卫是**裸词面 + 只剥注释**的，任何一处措辞变化
    // （比如把某个字符串里写上那个 API 的名字）都可能让它红 —— 而它红的时候看起来像
    // "纯层被污染了"，排查方向会被带偏。把它清干净是**成本为零**的保险。
    const raw = String(readFileSync(join(NET_DIR, 'session.ts')));
    for (const word of ['crypto', 'subtle', 'digest']) {
      expect(raw.toLowerCase().includes(word), `session.ts 里还有 "${word}" 这个词（裸词面守卫会红）`).toBe(false);
    }
    // 正控：这条判据有牙（同一段真含该词的文本必须被它抓到）
    const probe = 'const bad = crypto.subtle;';
    expect(['crypto', 'subtle', 'digest'].some((w) => probe.includes(w)), '判据关键词表失效').toBe(true);
  });

  it('HashLike 在 src/net 里只定义一处，就在 session.ts', () => {
    const defs: string[] = [];
    for (const f of tsFiles(NET_DIR)) {
      const src = stripComments(String(readFileSync(f)));
      const n = [...src.matchAll(/export\s+interface\s+HashLike\b/g)].length;
      if (n > 0) defs.push(`${f.slice(NET_DIR.length)}=${n}`);
    }
    expect(defs, 'HashLike 出现了第二处定义（计划 §5.0：只此一处）').toEqual(['session.ts=1']);
    // 正控：session.ts 里确实有它（防"路径写错导致空集相等"）
    expect(String(readFileSync(join(NET_DIR, 'session.ts')))).toContain('export interface HashLike');
  });

  it('注入一个异步哈希（照 crypto.subtle 的形状）时当场抛错，而不是把 Promise 当成哈希用', () => {
    const h = hostSession();
    handshakeHost(h);
    const asyncSession = createHostSession({
      ...LOCAL,
      sessionId: SESSION_ID,
      seat: 0,
      // 这就是 T7 的真实形状：`crypto.subtle.digest` 是异步的
      hash: async (...parts: readonly string[]) => sha256Concat(...parts),
    });
    expect(asyncSession.accept({ t: 'hello', msg: hello() }).ok).toBe(true);
    let threw: unknown = null;
    try {
      asyncSession.sendCommit(SEED, SALT);
    } catch (e) {
      threw = e;
    }
    expect(threw, '把异步哈希的 Promise 当成哈希串收下了（D15 的取舍失效）').not.toBeNull();
    expect(String(threw)).toContain('HashLike');
    expect(asyncSession.seedHashOfCommit(), '抛错之后状态被推进了').toBeNull();
  });

  it('调用方传空 seed / 空 salt / 空 faceNonce 是调用方违约（throw），不是结果对象', () => {
    const h = hostSession();
    handshakeHost(h);
    expect(() => h.sendCommit('', SALT)).toThrow(/调用方违约/);
    expect(() => h.sendCommit(SEED, '')).toThrow(/调用方违约/);
    const g = guestSession();
    acceptOk(g, { t: 'commit', msg: overWire({ t: 'commit', hash: 'h' }) });
    expect(g.sendCommitAck().ok).toBe(true);
    expect(() => g.commitFace(1, '')).toThrow(/调用方违约/);
    // 网络来的空串走结果对象（**不抛**）—— 两条路的区别在这里
    const h2 = hostSession();
    handshakeHost(h2);
    expect(h2.sendCommit(SEED, SALT).ok).toBe(true);
    expect(() => h2.accept({ t: 'commit-face', msg: { t: 'commit-face', hash: '' } })).not.toThrow();
  });
});

/* ------------------------------------------------------------------ *
 * D2 / D8 / 其他职责腿
 * ------------------------------------------------------------------ */

describe('会话身份（D2）与重连（D8/T6 的接口）', () => {
  it('sessionId 只住会话层：`hello-ack.sessionId` 是房主的 id，且它不出现在任何别的形状里', () => {
    const h = hostSession();
    const d = h.accept({ t: 'hello', msg: hello({ sessionId: '对端自报的 id' }) });
    expect(d.ok).toBe(true);
    if (!d.ok) throw new Error('unreachable');
    const ack = d.output as HelloAckMsg;
    expect(ack.sessionId, 'hello-ack.sessionId 必须是房主自己的会话 id').toBe(SESSION_ID);
    expect(ack.seat, 'hello-ack.seat 必须由房主定（对端自报 1，房主定的是对端座位）').toBe(1);
    expect(ack.peerNick).toBe('guest');
    // 会话 id 只从会话层读；`MatchFile` 里没有这个字段（D2 由 `src/app` 那边与守卫保证，
    // 这里只钉"会话层把它当作会话作用域的值，不回写任何档案形状"）
    expect(h.sessionId()).toBe(SESSION_ID);
  });

  it('resuming: true 能通过握手并把相位标成 resuming、needsResync = true（追平留 T6）', () => {
    const h = hostSession();
    const d = h.accept({ t: 'hello', msg: hello({ resuming: true }) });
    expect(d.ok, '重连握手被拒了').toBe(true);
    if (!d.ok) throw new Error('unreachable');
    expect(d.phase).toBe('resuming');
    expect(h.peerStatus().needsResync).toBe(true);
    expect(h.phase()).toBe('resuming');
  });

  it('resync-req 明确回一句"追平还没接上"，不静默吞掉（T6 要接的就是它）', () => {
    const h = hostSession();
    handshakeHost(h);
    const r = h.accept({ t: 'resync-req', msg: { t: 'resync-req', sessionId: SESSION_ID, appliedSteps: 0 } });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('unreachable');
    expect(r.reason).toBe('resync-not-wired');
    expect(r.message).toBe(RESYNC_NOT_WIRED_MESSAGE);
  });

  it('peerStatus 在流程上如实反映"承诺/种子/可收操作"三件事', () => {
    const h = hostSession();
    expect(h.peerStatus()).toMatchObject({
      phase: 'handshaking',
      handshakeDone: false,
      faceCommitted: false,
      seedRevealed: false,
      acceptsInput: false,
      needsResync: false,
    });
    handshakeHost(h);
    expect(h.peerStatus().handshakeDone).toBe(true);
    expect(h.sendCommit(SEED, SALT).ok).toBe(true);
    expect(h.peerStatus().seedRevealed, 'commit 之后就把种子算成"已揭示"了').toBe(false);
    expect(h.peerStatus().faceCommitted).toBe(false);
    expect(h.peerStatus().acceptsInput).toBe(false);
    // 还没收到 commit-face ⇒ 揭示种子必须被拒（这条同时是 peerStatus 与判据 1 的交叉核对）
    expect(h.sendRevealSeed().ok, '还没收到面就揭示了种子').toBe(false);
    acceptOk(h, { t: 'commit-face', msg: overWire({ t: 'commit-face', hash: sha256Concat('1', 'n') }) });
    expect(h.peerStatus().faceCommitted).toBe(true);
    expect(h.peerStatus().seedRevealed, '收到面之后种子还没揭示').toBe(false);
    expect(h.sendRevealSeed().ok).toBe(true);
    expect(h.peerStatus().seedRevealed).toBe(true);
    // `acceptsInput` 今天只在 `complete` 为真（"轮到谁"那层是 T5 的）
    expect(h.peerStatus().acceptsInput).toBe(false);
    acceptOk(h, { t: 'reveal-face', msg: overWire({ t: 'reveal-face', face: 1, faceNonce: 'n' }) });
    expect(h.phase()).toBe('complete');
    expect(h.peerStatus().acceptsInput).toBe(true);
  });
});
