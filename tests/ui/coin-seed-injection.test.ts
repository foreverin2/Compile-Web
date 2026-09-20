import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createLobbyClient, type LobbyClient } from '../../src/ui/net-lobby';
import { createFakeTransportPair } from '../../src/net/fake-transport';
import { decodeMsg, PROTO_VERSION, type NetMsg } from '../../src/net/protocol';
import { browserHashOf } from '../../src/ui/net-browser';
import { CARD_DATA_HASH } from '../../src/app/card-data-hash';
import { faceFromSide, sideFromFace } from '../../src/app/coin';
import { stripComments } from '../ui/source-text';

/**
 * G5 T11-A 守卫：**真随机注入**（I-5 的实质）。
 *
 * ## 缺陷形状（修正前，HEAD 原文）
 *
 * `src/ui/net-lobby.ts` 的 `driveOnce` 原文是
 * ``session.sendCommit(`seed-${opts.sessionId}`, `salt-${opts.sessionId}`)``
 * 与 ``session.commitFace(chosenFace, `nonce-${opts.sessionId}`)``。
 * 而 `sessionId` **明文写在邀请码里**（`InvitePayload.sessionId`）⇒ 加入方在叫面之前
 * 就能把种子算出来 —— "叫面早于公开种子"那条结构约束在**值**上被绕过（I-5）。
 *
 * ## 这个文件怎么钉住它（判据 1 / 2 / 3 / 6）
 *
 * 走**真客户端 + 真会话 + 成对假传输**（照 `tests/ui/net-lobby.test.ts` 的 `pairClients`）：
 * 两端同 `sessionId`、注入 `matchSeed` 与一个**按队列返回**的 `randomToken`，再读**线上真帧的载荷**
 * （不是只读 hash —— 只读 hash 会让 `salt` 那一半没有腿：`hash(seed, salt)` 只要 seed 变就变；
 * 修复轮第一版就是这么写的，评审实测"盐钉成公开常量"在 4 个文件 95 条用例上全绿）。
 *
 *  - 判据 1：载荷级 —— `reveal-seed.seed === 注入的 matchSeed`、
 *    `reveal-salt.salt === 队列里那条盐`、`commit.hash === hash(seed, salt)`（测试哈希重算）；
 *    另有"换 matchSeed ⇒ 报告级不同"与"同注入两次 **逐字相同**（原始 `text`）"两条；
 *  - 判据 2：换 nonce ⇒ `commit-face.hash` 变；
 *  - 判据 3：本文件的夹具**不注入 `chooseFace`**（T11-B 之后"没注入"这条路的语义就是常量面 0）
 *    ⇒ `commit-face.hash === hash('0', nonce)`，
 *    且 `reveal-face.faceNonce` 就是注入的那条；屏上 `2 ⇒ '1'` 那一支见文件末那条腿；
 *  - 判据 6：`net-lobby.ts` 里 `sendCommit(` / `commitFace(` 的参数表里不再出现 `sessionId`
 *    （正控用 HEAD 的真实原文）。
 *
 * ⚠️ **能力边界**：这里读的是**假传输**上的真帧，不是真浏览器（那归 T11-B/T11-C 的 CDP 线）。
 */

/* ------------------------------------------------------------------ *
 * 夹具：一对真客户端 + 显式投递
 * ------------------------------------------------------------------ */

function fakeTicker() {
  let next = 1;
  return {
    schedule: (_fn: () => void, _ms: number): number => next++,
    cancel: (_h: number): void => { /* 这条腿用不到 8 秒窗口 */ },
  };
}

/** 线上帧的**原始文本**（判"逐字相同"与载荷级断言都用它；不经任何摘要） */
function frameTexts(pair: ReturnType<typeof createFakeTransportPair>): string[] {
  return pair.steps().map((s) => s.text);
}

/** 把线上的帧解回消息体（解不开的直接丢掉；判据在下面各自断言"这条消息在不在"） */
function messagesOf(pair: ReturnType<typeof createFakeTransportPair>): NetMsg[] {
  const out: NetMsg[] = [];
  for (const s of pair.steps()) {
    const dec = decodeMsg(s.text, { protoVersion: PROTO_VERSION });
    if (dec.ok) out.push(dec.msg);
  }
  return out;
}

/** 取某类消息里**第一条**（找不到就 null；判据要能看到"没发出去"而不是在 undefined 上假绿） */
function firstOf<T extends NetMsg['t']>(msgs: readonly NetMsg[], t: T): Extract<NetMsg, { t: T }> | null {
  const hit = msgs.find((m) => m.t === t);
  return (hit as Extract<NetMsg, { t: T }> | undefined) ?? null;
}

interface RigOptions {
  readonly matchSeed: string;
  readonly randomToken: () => string;
}

/**
 * 造一对**同 sessionId**的客户端并跑完整条承诺流程。
 *
 * `randomToken` 用**按队列返回**的假件：第一次调用给 `[0]`，第二次给 `[1]`……
 * 队列耗尽后回落到最后一条（免得越界变成 `undefined` 而让"盐是空的"看起来像别的问题）。
 */
async function runPair(o: RigOptions): Promise<{
  frames: string[];
  msgs: NetMsg[];
  hostPhase: string;
  guestPhase: string;
}> {
  const pair = createFakeTransportPair();
  const mk = (role: 'host' | 'guest', tr: (typeof pair)['A']['transport']): LobbyClient => createLobbyClient({
    role,
    sessionId: 'sid-shared', // ★ 两端**同一个** sessionId（正是 I-5 的公开值）
    matchSeed: o.matchSeed,
    randomToken: o.randomToken,
    localProtoVersion: PROTO_VERSION,
    localCardDataHash: CARD_DATA_HASH,
    hash: browserHashOf,
    ticker: fakeTicker(),
    createTransport: () => tr,
    signalingEndpoint: '',
    readSettings: () => ({ turnUrl: '', turnUsername: '', turnCredential: '' }),
    buildInvite: async () => ({ ok: true as const, payload: 'P', link: 'https://x.invalid/l#invite=P' }),
    decompressBase64: async () => null,
    readAddressBar: () => null,
    localNick: () => 'nick',
  });
  const host = mk('host', pair.A.transport);
  const guest = mk('guest', pair.B.transport);
  await host.connect('first');
  await guest.connect('first');
  // 显式投递：8 轮 × 每轮两步，足够走完 hello/hello-ack + 五条承诺消息
  for (let i = 0; i < 8; i += 1) pair.pump(2);
  return {
    frames: frameTexts(pair),
    msgs: messagesOf(pair),
    hostPhase: host.state().peer?.phase ?? '<null>',
    guestPhase: guest.state().peer?.phase ?? '<null>',
  };
}

/** 按队列返回的假随机串（判"盐/nonce 真的来自注入"要靠它把两条值分开） */
function tokenQueue(...values: readonly string[]): () => string {
  let i = 0;
  return () => {
    const v = values[Math.min(i, values.length - 1)];
    i += 1;
    return v ?? '';
  };
}

/* ------------------------------------------------------------------ *
 * 判据 1 / 2 / 3
 * ------------------------------------------------------------------ */

describe('G5 T11-A · 种子、盐、nonce 来自注入（I-5 的实质）', () => {
  it('★ 判据 1（载荷级）：`reveal-seed.seed` / `reveal-salt.salt` / `commit.hash` 三者都对得上注入值', async () => {
    // 队列：第一次要串 = 盐（房主的 `sendCommit`），第二次 = 面 nonce（加入方的 `commitFace`）
    const S = 'SEED-INJECTED-S';
    const SALT = 'SALT-INJECTED-1';
    const NONCE = 'NONCE-INJECTED-1';
    const r = await runPair({ matchSeed: S, randomToken: tokenQueue(SALT, NONCE) });
    const commit = firstOf(r.msgs, 'commit');
    const revealSeed = firstOf(r.msgs, 'reveal-seed');
    const revealSalt = firstOf(r.msgs, 'reveal-salt');
    const commitFace = firstOf(r.msgs, 'commit-face');
    const revealFace = firstOf(r.msgs, 'reveal-face');
    expect(commit, '线上没有 commit').not.toBeNull();
    expect(revealSeed, '线上没有 reveal-seed').not.toBeNull();
    expect(revealSalt, '线上没有 reveal-salt').not.toBeNull();
    expect(commitFace, '线上没有 commit-face').not.toBeNull();
    expect(revealFace, '线上没有 reveal-face').not.toBeNull();

    // ★ 载荷级：种子与盐**逐字**就是注入进去的那两条（这条腿在旧口径下不存在）
    expect(revealSeed!.seed, '`reveal-seed.seed` 不是注入的 matchSeed').toBe(S);
    expect(revealSalt!.salt, '`reveal-salt.salt` 不是注入队列里那条盐（盐被钉成常量就会在这里红）').toBe(SALT);
    // 承诺 = 用**测试哈希**重算的 hash(seed, salt)：不是"两次不同"这种弱口径
    expect(commit!.hash, '`commit.hash` 不等于 hash(seed, salt)').toBe(browserHashOf(S, SALT));
    // 换成另一条盐重算必须**不**相等（证明上面那条不是恒真，也钉住"盐真的进了哈希"）
    expect(commit!.hash, '换一条盐，commit.hash 竟然没变').not.toBe(browserHashOf(S, 'SALT-OTHER'));
    // 面承诺同理：hash(String(face), nonce)
    expect(commitFace!.hash, '`commit-face.hash` 不等于 hash("0", nonce)').toBe(browserHashOf('0', NONCE));
    expect(revealFace!.faceNonce, '`reveal-face.faceNonce` 不是注入的 nonce').toBe(NONCE);
    // 两端都真的走完了
    expect(r.guestPhase, `加入方没走到 complete（${r.guestPhase}）`).toBe('complete');
    expect(r.hostPhase, `房主没走到 complete（${r.hostPhase}）`).toBe('complete');
  });

  it('判据 1：同 sessionId、换 `matchSeed` ⇒ 两次 `commit.hash` 不同（且流程真的走到完）', async () => {
    // ★ 两条腿的盐给**同一个**固定值 ⇒ 唯一变量是 matchSeed
    const a = await runPair({ matchSeed: 'mseed-A', randomToken: () => 'rtok-fixed' });
    const b = await runPair({ matchSeed: 'mseed-B', randomToken: () => 'rtok-fixed' });
    const ca = firstOf(a.msgs, 'commit');
    const cb = firstOf(b.msgs, 'commit');
    expect(ca, '第一条腿没有发出 commit').not.toBeNull();
    expect(cb, '第二条腿没有发出 commit').not.toBeNull();
    expect(ca!.hash, '两次 commit 的 hash 相同 ⇒ 种子不是注入的（I-5 原形）').not.toBe(cb!.hash);
    expect(firstOf(a.msgs, 'reveal-seed')!.seed).toBe('mseed-A');
    expect(firstOf(b.msgs, 'reveal-seed')!.seed).toBe('mseed-B');
    expect(a.guestPhase, `加入方没走到 complete（${a.guestPhase}）`).toBe('complete');
    expect(a.hostPhase, `房主没走到 complete（${a.hostPhase}）`).toBe('complete');
  });

  it('判据 1（反空转）：同 `matchSeed` + 同 `randomToken` ⇒ 两次线上报文**逐字相同**（原始 text）', async () => {
    const q = (): string => 'rtok-fixed';
    const a = await runPair({ matchSeed: 'mseed-A', randomToken: q });
    const b = await runPair({ matchSeed: 'mseed-A', randomToken: q });
    // ★ 比的是**原始线上文本**（含 reveal-seed/reveal-salt 的载荷），不是"类型 + hash"摘要：
    //   若实现自己取熵（或带时间戳），两次就不可能逐字相同
    expect(a.frames, '两次跑出来的线上文本不同 ⇒ 种子/盐/nonce 不是纯粹来自注入').toEqual(b.frames);
    expect(a.frames.length, '线上一条帧都没有（这条腿在空数组上恒真）').toBeGreaterThan(0);
    // 反空转：报文里确实带着那两条载荷（否则"逐字相同"可能因为两边都是空壳）
    expect(a.frames.some((f) => f.includes('"seed":"mseed-A"')), '线上没有带种子的那一条').toBe(true);
    expect(a.frames.some((f) => f.includes('"salt":"rtok-fixed"')), '线上没有带盐的那一条').toBe(true);
  });

  it('判据 2：`randomToken` 两次给不同值 ⇒ 两次 `commit-face.hash` 不同', async () => {
    // 队列第一条是盐（两条腿都给同一个），第二条才是 nonce ⇒ 唯一变量是 nonce
    const a = await runPair({ matchSeed: 'mseed-A', randomToken: tokenQueue('salt-same', 'nonce-1') });
    const b = await runPair({ matchSeed: 'mseed-A', randomToken: tokenQueue('salt-same', 'nonce-2') });
    const fa = firstOf(a.msgs, 'commit-face');
    const fb = firstOf(b.msgs, 'commit-face');
    expect(fa, '第一条腿没有发出 commit-face').not.toBeNull();
    expect(fb, '第二条腿没有发出 commit-face').not.toBeNull();
    expect(fa!.hash, '两次 commit-face 的 hash 相同 ⇒ nonce 不是注入的（还是 sessionId 派生）')
      .not.toBe(fb!.hash);
    // 载荷级：两次的 nonce 就是队列里那两条
    expect(firstOf(a.msgs, 'reveal-face')!.faceNonce).toBe('nonce-1');
    expect(firstOf(b.msgs, 'reveal-face')!.faceNonce).toBe('nonce-2');
  });

  it('判据 3：`commit-face.hash` 等于**用注入 nonce 重算**的哈希（不是"两次不同"）', async () => {
    const r = await runPair({ matchSeed: 'mseed-A', randomToken: tokenQueue('salt-x', 'nonce-X') });
    const cf = firstOf(r.msgs, 'commit-face');
    expect(cf, '没有发出 commit-face').not.toBeNull();
    // 本夹具**不注入 `chooseFace`** ⇒ 走的是"没有叫面入口"那条路（常量面 0，即 T11-B 之前的行为）；
    // 会话层把面写成 `String(face)`（session.ts:1963）
    expect(cf!.hash, 'commit-face 的哈希不是 hash("0", 注入的 nonce)').toBe(browserHashOf('0', 'nonce-X'));
    // 反向：拿另一个 nonce 重算必须**不**相等（否则上面那条恒真）
    expect(cf!.hash).not.toBe(browserHashOf('0', 'nonce-Y'));
    // 同一个注入值再跑一遍必须仍然相等（"来自注入"而不是"来自某次随机"）
    const again = await runPair({ matchSeed: 'mseed-A', randomToken: tokenQueue('salt-x', 'nonce-X') });
    expect(firstOf(again.msgs, 'commit-face')!.hash).toBe(cf!.hash);
  });
});

/* ------------------------------------------------------------------ *
 * 判据 6：源码腿（参数表里不再出现 sessionId）
 * ------------------------------------------------------------------ */

describe('G5 T11-A · 判据 6 源码腿', () => {
  it('`net-lobby.ts` 里 `sendCommit(` / `commitFace(` 的参数表不含 `sessionId`', () => {
    const src = stripComments(
      readFileSync(fileURLToPath(new URL('../../src/ui/net-lobby.ts', import.meta.url)))
        .subarray(0, 4 * 1024 * 1024)
        .toString('utf8'),
    );
    const calls = [...src.matchAll(/\b(?:sendCommit|commitFace)\s*\(([^)]*)\)/g)].map((m) => m[1]);
    expect(calls.length, '一条 `sendCommit(` / `commitFace(` 调用都没扫到（锚点失效）').toBe(2);
    const withSessionId = calls.filter((args) => /sessionId/.test(args));
    expect(
      withSessionId,
      `参数表里还有 sessionId：${withSessionId.join(' | ')}（种子/盐/nonce 必须来自注入，I-5）`,
    ).toEqual([]);
    // ★ 正控：`git show HEAD:src/ui/net-lobby.ts` 的**真实原文**（模板串形态）必须命中 ——
    //    这里第一版写的是 `'seed-' + opts.sessionId`（拼接形态），而 HEAD 上那种写法 0 命中
    //    ⇒ 那条正控证明的是"正则对一种假想拼法有效"，与真实旧文本无关（评审发现 3）。
    const legacy = 'session.sendCommit(`seed-${opts.sessionId}`, `salt-${opts.sessionId}`);';
    const legacyCalls = [...stripComments(legacy).matchAll(/\bsendCommit\s*\(([^)]*)\)/g)].map((m) => m[1]);
    expect(legacyCalls.filter((a) => /sessionId/.test(a)).length, '正控失效').toBe(1);
  });

  it('注入面是**必填**：缺失 `matchSeed` / `randomToken` 时 tsc 会红（类型面自证）', () => {
    const src = stripComments(
      readFileSync(fileURLToPath(new URL('../../src/ui/net-lobby.ts', import.meta.url)))
        .subarray(0, 4 * 1024 * 1024)
        .toString('utf8'),
    );
    // 两条必填声明都在（可选 + 回落 sessionId 会让"忘了注入"退化成 I-5 原形）
    expect(/readonly matchSeed: string;/.test(src), '`matchSeed` 不是必填声明').toBe(true);
    expect(/readonly randomToken: \(\) => string;/.test(src), '`randomToken` 不是必填声明').toBe(true);
  });
});

/* ------------------------------------------------------------------ *
 * 判据 3 的另一个面：屏上 `2` ⇒ 会话 `'1'`（T11-B 的接线口径）
 * ------------------------------------------------------------------ */

/**
 * 判据 3 的字面分支（`side = 2 ⇒ '1'`）在这里仍是**纯函数 + 源码腿**：
 * 这个文件的夹具不注入 `chooseFace`（走常量面那条路），所以它自己跑不出 `side = 2`。
 *
 * ⇒ 它钉的是"口径 + 接线形状"，**不假装**端到端跑通了 `side = 2`：
 *  1. 映射本身：`sideFromFace` / `faceFromSide` 对两个 side 给出会话层的 `0 | 1`；
 *  2. 会话层的字面口径：`hash(String(face), nonce)` 对两个面给出两个不同值；
 *  3. 接线形状（源码腿）：`chosenFace` 的**每一个赋值点**都必须经过 `faceFromSide` ——
 *     "把 side 直接当 face 用"是这一格最容易顺手写错的地方。
 *
 * ★ **T11-B 之后"端到端跑通 `side = 2`"这件事有腿了**，但不在这个文件里：
 * `tests/ui/net-lobby-coin.test.ts`（真驱动循环 + 注入一个返回 `2` 的 `chooseFace`）。
 */
describe('G5 T11-A · 判据 3 的另一个面（屏上 2 ⇒ 会话 1）', () => {
  it('`faceFromSide` / `sideFromFace`：屏上 1|2 ⇒ 会话 0|1，且两个面进哈希给出两个不同的承诺', () => {
    expect([faceFromSide(1), faceFromSide(2)], '屏上 1|2 没有映射成会话层的 0|1').toEqual([0, 1]);
    // 会话层把面写成 `String(face)`（session.ts:1963）⇒ 屏上 2 那一支必须是字面量 '1'
    expect(String(faceFromSide(2)), '屏上"反面"(2) 没有映射到会话层的 1').toBe('1');
    expect(String(faceFromSide(1)), '屏上"正面"(1) 没有映射到会话层的 0').toBe('0');
    // 往返：两个面各走一圈必须回到自己
    expect(sideFromFace(faceFromSide(2)), '屏上 2 往返变了').toBe(2);
    expect(sideFromFace(faceFromSide(1)), '屏上 1 往返变了').toBe(1);
    expect(
      browserHashOf(String(faceFromSide(1)), 'n'),
      '两个面的 commit-face 哈希相同（面这一维在哈希里被抹平了）',
    ).not.toBe(browserHashOf(String(faceFromSide(2)), 'n'));
  });

  it('接线形状（源码腿）：`chosenFace` 的赋值点必须经过 `faceFromSide`', () => {
    const src = stripComments(
      readFileSync(fileURLToPath(new URL('../../src/ui/net-lobby.ts', import.meta.url)))
        .subarray(0, 4 * 1024 * 1024)
        .toString('utf8'),
    );
    const assignments = [...src.matchAll(/chosenFace\s*=\s*([^;]+);/g)].map((m) => m[1].trim());
    /**
     * ★ **T11-B 接线后是 1 个赋值点**（A 段当时钉的是 0：那时还没有叫面入口）：
     *   `chosenFace = faceFromSide(side)` —— 屏上 `1 | 2` ⇒ 会话层 `0 | 1`。
     * ★ **G5 T13-A 同步成 2 个**（用户裁决 2026-09-20："重连**不重掷硬币**"）：
     *   重连链路上没有可问的玩家（`resumeMode` ⇒ 不弹硬币屏），那一面来自**旧链路记下的那一面**
     *   （`readFaceMemory()`；没有记忆时取面 0，也就是"没有注入 `chooseFace`"那条常量面的同值）
     *   ⇒ `chosenFace = chosenFace ?? opts.readFaceMemory?.() ?? faceFromSide(1);`。
     *   两条赋值的 RHS 都经过 `faceFromSide`（下面那个循环就是这条判据的牙），
     *   而且**只有**这两条 —— 多出第三条（例如把 `side` 直接当 `face` 用）照样红。
     */
    expect(
      assignments.length,
      `chosenFace 的赋值点数变了（现在是 ${assignments.length}：${assignments.join(' | ')}）—— ` +
        'T11-B 接线后 1 个 + T13-A 的重连记忆 1 个 = 2（两侧都必须经过 `faceFromSide`）',
    ).toBe(2);
    // 反空转锚点：同一条正则必须能抓到"直接赋值"（否则上面那条在"正则写坏"时也恒 0）
    const anchor = [...'chosenFace = side;'.matchAll(/chosenFace\s*=\s*([^;]+);/g)].map((m) => m[1].trim());
    expect(anchor, '锚点正则失效：抓不到 `chosenFace = side;`').toEqual(['side']);
    expect(/faceFromSide\s*\(/.test('faceFromSide(2)'), '正控失效').toBe(true);
    for (const rhs of assignments) {
      expect(
        /faceFromSide\s*\(/.test(rhs),
        `chosenFace 被赋成了 ${rhs}：屏上 1|2 与会话 0|1 的映射必须走 faceFromSide`,
      ).toBe(true);
    }
  });
});
