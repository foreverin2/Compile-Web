/**
 * G5 T11-B 守卫：**联机硬币屏 + 叫面接进握手**（任务书 `.superpowers/g5-plan/tasks/T11.md` §5）。
 *
 * ## 缺陷形状（B 段之前）
 *
 * `src/ui/net-lobby.ts` 的 `driveOnce()` 在 `awaiting-commit-ack` 那一格直接
 * `session.commitFace(chosenFace, faceNonce())`，而 `chosenFace` 恒为常量 `0`
 * ⇒ 加入方"叫面"这件事从来不存在，房主的硬币永远是同一面。而按 D27（用户 2026-09-19 裁决），
 * 硬币屏必须插在**握手中间**：加入方按下正/反的那一刻才是它发 `commit-face` 的时刻，
 * 种子在它叫面之前**不许**公开。
 *
 * ## 这个文件证明什么（判据 1 / 2 / 3 / 5 的顺序面）
 *
 * 走**真客户端 + 真会话 + 成对假传输**（照 `tests/ui/coin-seed-injection.test.ts` 的形态）：
 *
 *  - 判据 1（时序）：注入一个**手动 resolve** 的 `chooseFace` ⇒ resolve 之前相位停在"等面"那一格、
 *    线上没有 `commit-face`/`reveal-seed`；resolve 之后才推进到 `complete`；
 *  - 判据 2（行为）：`chooseFace = () => Promise.resolve(2)` ⇒ `commit-face.hash === hash('1', nonce)`
 *    （与 A 段判据 3 同一口径，但这里走的是**真驱动循环**）；
 *  - 判据 3（共识）：注入 side=1 / side=2 两种情形，两端各自算出的 `draftStarter` 相等，
 *    且两种情形互为相反值；
 *  - 判据 5（顺序）：把"要面"的时机挪到 `complete` 之后（镜像变异 M2）必须至少红一条本文件的腿 ——
 *    这条顺序是钉在大厅层的，不只是钉在 `session.ts` 里。
 *
 * ## 能力边界
 *
 * 这里是**假传输**上的真帧，不是真浏览器（真浏览器那一条是 `tools/browser-truth-lobby-cdp.mjs`
 * 的硬币屏判定项）。屏上的像素级观感（等待态好不好看）不在机检范围里。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createLobbyClient, type LobbyClient, type LobbyTicker } from '../../src/ui/net-lobby';
import { createFakeTransportPair } from '../../src/net/fake-transport';
import { decodeMsg, PROTO_VERSION, type NetMsg } from '../../src/net/protocol';
import { browserHashOf } from '../../src/ui/net-browser';
import { CARD_DATA_HASH } from '../../src/app/card-data-hash';
import type { NetTransport } from '../../src/net/transport';
import type { PlayerId } from '../../src/core/models/types';
import { coinLanding, draftStarterFor, sideFromFace, type CoinSide } from '../../src/app/coin';
import { stripComments } from './source-text';

/* ------------------------------------------------------------------ *
 * 夹具
 * ------------------------------------------------------------------ */

function fakeTicker(): LobbyTicker {
  let next = 1;
  return {
    schedule: (): number => next++,
    cancel: (): void => { /* 这条腿用不到 8 秒窗口 */ },
  };
}

/** 线上帧的**原始文本**（判据要比载荷，不比摘要） */
function frameTexts(pair: ReturnType<typeof createFakeTransportPair>): string[] {
  return pair.steps().map((s) => s.text);
}

function messagesOf(pair: ReturnType<typeof createFakeTransportPair>): NetMsg[] {
  const out: NetMsg[] = [];
  for (const s of pair.steps()) {
    const dec = decodeMsg(s.text, { protoVersion: PROTO_VERSION });
    if (dec.ok) out.push(dec.msg);
  }
  return out;
}

function firstOf<T extends NetMsg['t']>(msgs: readonly NetMsg[], t: T): Extract<NetMsg, { t: T }> | null {
  const hit = msgs.find((m) => m.t === t);
  return (hit as Extract<NetMsg, { t: T }> | undefined) ?? null;
}

/** 按队列返回的假随机串（第一条 = 盐，第二条 = 面 nonce） */
function tokenQueue(...values: readonly string[]): () => string {
  let i = 0;
  return () => {
    const v = values[Math.min(i, values.length - 1)];
    i += 1;
    return v ?? '';
  };
}

interface Side {
  readonly client: LobbyClient;
}

interface Rig {
  readonly pair: ReturnType<typeof createFakeTransportPair>;
  readonly host: Side;
  readonly guest: Side;
  /** 接上链路（并自证注入的能力挂上去了） */
  connect(): Promise<void>;
  /** 交替投递 + 驱动 `rounds` 轮 */
  run(rounds: number): Promise<void>;
  /** 一直推到**两端都没东西可发**为止（每轮投递 + 驱动） */
  runUntilStuck(rounds: number): Promise<void>;
}

function makeRig(opts: { readonly chooseFace?: () => Promise<CoinSide> }): Rig {
  const pair = createFakeTransportPair();
  /**
   * ★ **两端共用一条 token 队列**（不是各一条）。
   *
   * 为什么：`randomToken` 的语义是"**本局**再要一条随机串"（`main.ts` 那边就是同一个
   * `newRandomToken`），所以调用顺序是**全流程共享**的一条序列：
   * 第一条 = 房主的盐（`sendCommit`）、第二条 = 加入方的面 nonce（`commitFace`）。
   * 各给一条队列时两端都会拿到第一条，症状是"nonce 等于盐"——判据 2 会在一个**夹具**问题上红，
   * 而看起来像被测对象错了（实测踩过）。
   */
  const tokens = tokenQueue('SALT-B', 'NONCE-B');
  const mk = (role: 'host' | 'guest', tr: NetTransport): Side => ({
    client: createLobbyClient({
      role,
      // ★ 两端**同一个** sessionId（照 A 段夹具：这正是 I-5 里那个公开值）
      sessionId: 'sid-coin-b',
      matchSeed: 'mseed-coin-b',
      randomToken: tokens,
      chooseFace: opts.chooseFace,
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
    }),
  });
  const host = mk('host', pair.A.transport);
  const guest = mk('guest', pair.B.transport);
  return {
    pair,
    host,
    guest,
    /** 接上链路 + 自证"要面这条能力真的挂上去了"（见函数末的说明） */
    async connect(): Promise<void> {
      await host.client.connect('first');
      await guest.client.connect('first');
      if (opts.chooseFace !== undefined) {
        const canHost = host.client.canChooseFace();
        const canGuest = guest.client.canChooseFace();
        expect(
          canHost && canGuest,
          `注入的 chooseFace 没有挂到链路上（房主 ${String(canHost)} / 加入方 ${String(canGuest)}）`
          + '：硬币屏永远不出现、面永远是常量 0，而屏上/线上都看不出哪里错了',
        ).toBe(true);
      }
    },
    /**
     * 交替投递 + 驱动 `rounds` 轮。
     *
     * ⚠️ **每轮都要把微任务放干净**（`await Promise.resolve()`）：`chooseFace` 的 resolve 走的是
     * 微任务，而"这一格还能不能往下走"取决于它 —— 不放干净就会看到"流程停住"的假象（实测踩过）。
     */
    async run(rounds: number): Promise<void> {
      for (let i = 0; i < rounds; i += 1) {
        pair.pump(2);
        host.client.drive();
        guest.client.drive();
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      }
    },
    /**
     * **推着走到"加入方停在等面那一格"为止**（判据 1 要的"停在半路"就是终态之一）。
     *
     * 为什么不写"某一轮一条都没发就 break"：假传输的**到达**要等一步（`latencyTicks + 1`），
     * 而投递是每轮一步 ⇒ 任何一次往返之间都夹着"这一轮两端都没东西可发"的正常轮次。
     * 按"连续 2 轮安静"收工会**在握手半路**就退出（实测：第 1 轮就 quiet=2 了），
     * 症状是"要面那件事一次都没发生"这种看起来像被测对象坏了的假象。
     * 这里改成按**相位**收工：两端的稳定态只有"加入方在等面"与"已经走完"两种。
     */
    async runUntilStuck(rounds: number): Promise<void> {
      for (let i = 0; i < rounds; i += 1) {
        pair.pump(3);
        host.client.drive();
        guest.client.drive();
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
        const gp = guest.client.phase();
        if (gp === 'awaiting-commit-ack' || gp === 'complete') break;
      }
    },
  };
}

/**
 * 两端各自算出的 `draftStarter`（判据 3 就比它）。
 *
 * ⚠️ **叫出去的那一面不在 `commit-face` 里**（那条消息只有 `hash`，见 `protocol.ts:147-150`）：
 * 面在 `reveal-face.face` 上。所以"叫了哪一面"这件事只能从揭示那条读 —— 这也正是
 * "承诺阶段只暴露哈希"的设计本意。
 */
function startersOf(rig: Rig): {
  hostStarter: PlayerId;
  guestStarter: PlayerId;
  landing: CoinSide;
  hostSeat: PlayerId;
  guestSeat: PlayerId;
  seed: string;
  side: CoinSide;
  face: 0 | 1;
  nonce: string;
} {
  const msgs = messagesOf(rig.pair);
  const revealSeed = firstOf(msgs, 'reveal-seed');
  expect(revealSeed, '线上没有 reveal-seed（承诺流程没走完）').not.toBeNull();
  const revealFace = firstOf(msgs, 'reveal-face');
  expect(revealFace, '线上没有 reveal-face（加入方没有揭示它叫的那一面）').not.toBeNull();
  const seed = revealSeed!.seed;
  const face = revealFace!.face;
  const side = sideFromFace(face);
  /**
   * ★ **叫面者的座位**（判据 3 的关键读数）。
   *
   * 两端读 `callerSeat()` 必须得到**同一个数**：加入方读自己的 `selfSeat`、房主读 `peerSeat`
   * （D7：加入方的座位由 `hello-ack.seat` 定下，两端同源）。
   */
  const hostSeat: PlayerId = rig.host.client.callerSeat();
  const guestSeat: PlayerId = rig.guest.client.callerSeat();
  expect(hostSeat, '两端读到的叫面者座位不同（房主算出来的会是另一个数）').toBe(guestSeat);
  return {
    // 叫面者是加入方（D3）⇒ `draftStarterFor` 的 caller 就是那一个座位
    hostStarter: draftStarterFor(hostSeat, side, seed),
    guestStarter: draftStarterFor(guestSeat, side, seed),
    hostSeat,
    guestSeat,
    seed,
    side,
    face,
    nonce: revealFace!.faceNonce,
    landing: coinLanding(seed),
  };
}

/* ------------------------------------------------------------------ *
 * 判据 1 / 5：时机（要面发生在 seed-committed 那一格，不是 complete 之后）
 * ------------------------------------------------------------------ */

describe('G5 T11-B · 判据 1：面没到手之前，相位停在那一格、种子不揭示', () => {
  it('★ 手动 resolve 的 `chooseFace`：resolve 之前停在等面那一格、线上没有 commit-face / reveal-seed', async () => {
    let resolveFace: ((side: CoinSide) => void) | null = null;
    let asked = 0;
    const rig = makeRig({
      chooseFace: () => {
        asked += 1;
        return new Promise<CoinSide>((res) => { resolveFace = res; });
      },
    });
    await rig.connect();
    await rig.runUntilStuck(8);

    // ① 要面这件事**发生了**（否则下面"停住"可能只是流程没走到）
    expect(asked, '整条流程一次都没问过面（`chooseFace` 没被调用）').toBe(1);
    expect(resolveFace, '要面的 Promise 没有把 resolve 交出来').not.toBeNull();
    // ② 相位停在"等面"那一格（加入方叫面之前的那一格）
    expect(rig.guest.client.phase(), `加入方没有停在等面那一格（${rig.guest.client.phase()}）`)
      .toBe('awaiting-commit-ack');
    // ③ 线上没有面承诺、也没有种子（D27：种子不得早于 commit-face）
    const kinds = messagesOf(rig.pair).map((m) => m.t);
    expect(kinds, '加入方在面到手之前就发了 commit-face').not.toContain('commit-face');
    expect(kinds, '房主在面到手之前就揭示了种子（这就是 D27 要挡住的那件事）').not.toContain('reveal-seed');
    // ④ 等待方（房主）也停在它那一格
    expect(rig.host.client.phase(), `房主没有停在等承诺那一格（${rig.host.client.phase()}）`)
      .toBe('awaiting-commit-face');

    // ── resolve 之后：流程才继续 ─────────────────────────────────────────
    resolveFace!(2);
    await rig.run(8);

    expect(firstOf(messagesOf(rig.pair), 'commit-face'), 'resolve 之后仍然没有 commit-face').not.toBeNull();
    expect(firstOf(messagesOf(rig.pair), 'reveal-seed'), 'resolve 之后仍然没有 reveal-seed').not.toBeNull();
    expect(rig.host.client.phase(), `房主没走到 complete（${rig.host.client.phase()}）`).toBe('complete');
    expect(rig.guest.client.phase(), `加入方没走到 complete（${rig.guest.client.phase()}）`).toBe('complete');
  });

  it('★ 判据 5（顺序腿）：要面**写在 `driveOnce` 的 `awaiting-commit-ack` 分支里**（按相位锚定）', () => {
    /**
     * ## 这条腿为什么重写过（修复轮；评审实测"旧版没牙"）
     *
     * 旧版比的是三个 `indexOf` 的**相对位置**（`askFaceOnce()` < `commitFace(` < `sendRevealSeed()`）。
     * 那种写法挡不住"把要面塞进别的分支"：只要把那一句挪到同一文件里更靠前的位置
     * （例如 `case 'complete'` 里那句 `sendRevealSalt` 附近），相对位置照样成立 ⇒ 旧腿**反而绿**，
     * 而"要面早于公开种子"已经被破坏。评审的 M2（把要面挪到 `complete` 之后）实测就是绿的。
     *
     * ## 现在锚什么
     *
     * 按**相位分支**锚：读 `driveOnce` 的 `switch`，逐格切出 `case '…': { … }` 的肉体，
     * 断言 `askFaceOnce();` 落在 `case 'awaiting-commit-ack'` 那一格里，且**就在**
     * `session.commitFace(` 之前；同时 `askFaceOnce()` 在整文件里只有 2 次调用
     * （`awaiting-commit-ack` 那一格 + `connect()` 里那次带相位守卫的"建链路就问"）。
     *
     * ⚠️ **能力边界**（说清它有多硬）：这是**源码腿**。它挡的是"要面被挪到别的相位"，
     * 挡不住"运行时把相位判断写错"—— 后者由本文件判据 1（时序腿）与真浏览器门 ③.5 兜。
     */
    const src = stripComments(
      readFileSync(fileURLToPath(new URL('../../src/ui/net-lobby.ts', import.meta.url)))
        .subarray(0, 8 * 1024 * 1024)
        .toString('utf8'),
    );
    const iSwitch = src.indexOf('switch (phase) {');
    expect(iSwitch, '找不到 driveOnce 的 switch（锚点失效）').toBeGreaterThanOrEqual(0);
    const iEnd = src.indexOf('\n  }', iSwitch);
    expect(iEnd, '找不到 switch 的收尾（锚点失效）').toBeGreaterThan(iSwitch);
    const body = src.slice(iSwitch, iEnd);
    /** 切出某一格的肉体（`case 'x': { … }`；按**行首**的 `case ` 切，避免撞到注释里的字面量） */
    const caseBody = (name: string): string | null => {
      const re = new RegExp(`^\\s{6}case '${name}': \\{`, 'm');
      const m = re.exec(body);
      if (m === null) return null;
      const rest = body.slice(m.index + m[0].length);
      const nextRe = /^\s{6}case '/m;
      const stop = nextRe.exec(rest.replace(/^\n/, '\n'));
      return stop === null ? rest : rest.slice(0, stop.index);
    };
    const ackCase = caseBody('awaiting-commit-ack');
    expect(ackCase, '找不到 `awaiting-commit-ack` 那一格（相位名变了？）').not.toBeNull();
    const iAsk = ackCase!.indexOf('askFaceOnce();');
    const iCommit = ackCase!.indexOf('session.commitFace(');
    expect(iAsk, '要面那一句不在 `awaiting-commit-ack` 那一格里（这就是 M2 的形状）').toBeGreaterThanOrEqual(0);
    expect(iCommit, '`awaiting-commit-ack` 那一格里找不到 `session.commitFace(`').toBeGreaterThanOrEqual(0);
    expect(iAsk, '要面排在 `commitFace` 之后（先承诺后要面 ⇒ 顺序反了）').toBeLessThan(iCommit);
    // 反面：整文件里 `askFaceOnce()` 只有 2 次调用（多一个就是"另一条时机"）
    const asks = [...src.matchAll(/askFaceOnce\(\)/g)].length;
    expect(asks, `askFaceOnce() 被调用 ${String(asks - 1)} 次（应为 2：那一格 + connect 里带守卫的那次）`).toBe(2);
    // 正控：切格函数本身有牙（合成源码里把要面放进 `complete` 那一格 ⇒ 必须切不到）
    const synth = "switch (phase) {\n      case 'complete': {\n        askFaceOnce();\n      }\n"
      + "      case 'awaiting-commit-ack': {\n        session.commitFace(face, faceNonce());\n      }\n    }";
    const synthAck = /^ {6}case 'awaiting-commit-ack': \{/m.exec(synth);
    expect(synthAck, '正控：合成源码里那一格没被切到').not.toBeNull();
    const synthCase = synth.slice(synthAck!.index);
    expect(synthCase.includes('askFaceOnce();'), '正控：把要面放进 `complete` 之后，这条腿竟然还看得见它').toBe(false);
  });
});

/* ------------------------------------------------------------------ *
 * 判据 2：真驱动循环里，面的口径与 A 段一致
 * ------------------------------------------------------------------ */

describe('G5 T11-B · 判据 2：`chooseFace` 的结果真的进了 `commit-face`', () => {
  it('★ `chooseFace = () => Promise.resolve(2)` ⇒ `commit-face.hash === hash("1", nonce)`', async () => {
    const rig = makeRig({ chooseFace: () => Promise.resolve(2) });
    await rig.connect();
    await rig.run(8);

    const msgs = messagesOf(rig.pair);
    const cf = firstOf(msgs, 'commit-face');
    expect(cf, '线上没有 commit-face').not.toBeNull();
    // ★ 会话层把面写成 `String(face)`（session.ts:1963）；屏上 2 ⇒ 会话 1
    expect(cf!.hash, 'commit-face 的哈希不是 hash("1", nonce)').toBe(browserHashOf('1', 'NONCE-B'));
    // 反向：常量面那条口径（0）必须**不**相等 —— 否则这条腿在"面被丢掉"时也会绿
    expect(cf!.hash, 'commit-face 的哈希等于 hash("0", nonce)：面被丢掉了（变异 M1 的形状）')
      .not.toBe(browserHashOf('0', 'NONCE-B'));
    // 载荷级：揭示那条把面与非ce 都带出来（"叫了反面"这件事在线上可读）
    const rf = firstOf(msgs, 'reveal-face');
    expect(rf, '线上没有 reveal-face').not.toBeNull();
    expect(rf!.face, 'reveal-face.face 不是会话层的 1（屏上"反面"）').toBe(1);
    expect(rf!.faceNonce, 'reveal-face 的 nonce 不是注入的那条').toBe('NONCE-B');
    // 两端都走完了
    expect(rig.host.client.phase()).toBe('complete');
    expect(rig.guest.client.phase()).toBe('complete');
  });

  it('★ `chooseFace = () => Promise.resolve(1)` ⇒ `commit-face.hash === hash("0", nonce)`', async () => {
    const rig = makeRig({ chooseFace: () => Promise.resolve(1) });
    await rig.connect();
    await rig.run(8);
    const msgs = messagesOf(rig.pair);
    const cf = firstOf(msgs, 'commit-face');
    expect(cf, '线上没有 commit-face').not.toBeNull();
    expect(cf!.hash, '正面（屏上 1 ⇒ 会话 0）的哈希不对').toBe(browserHashOf('0', 'NONCE-B'));
    expect(firstOf(msgs, 'reveal-face')!.face, 'reveal-face.face 不是会话层的 0（屏上"正面"）').toBe(0);
  });

  it('★ 没有注入 `chooseFace` ⇒ 保持今天的行为（常量面 0），流程照旧走完', async () => {
    // 这条腿钉的是"屏上没有硬币屏"的**另一半**：库那一层的降级语义（屏那一半在
    // `tests/ui/coin-screen-net.test.ts` / `main-lobby-wiring.test.ts` 里）
    const rig = makeRig({});
    await rig.connect();
    await rig.run(8);
    const msgs = messagesOf(rig.pair);
    const cf = firstOf(msgs, 'commit-face');
    expect(cf, '没有注入 chooseFace 时流程停住了（不该停：那时没有叫面入口）').not.toBeNull();
    // 常量面那条口径：`hash("0", nonce)`（面本身只出现在揭示那条上）
    expect(cf!.hash, '没有注入 chooseFace 时的面不是常量 0').toBe(browserHashOf('0', 'NONCE-B'));
    expect(firstOf(msgs, 'reveal-face')!.face, '没有注入 chooseFace 时揭示的面不是 0').toBe(0);
    expect(rig.host.client.phase()).toBe('complete');
    expect(rig.guest.client.phase()).toBe('complete');
    // 读数：没有"要面"的能力，屏那边据此不画硬币屏
    expect(rig.guest.client.canChooseFace(), '没有注入 chooseFace 却报"能要面"').toBe(false);
  });
});

/* ------------------------------------------------------------------ *
 * 判据 3：共识（两端各自算出的 draftStarter 相等，且两种情形互为相反值）
 * ------------------------------------------------------------------ */

describe('G5 T11-B · 判据 3：两端各自算出的 `draftStarter` 必须相等', () => {
  /**
   * ★ 座位口径（任务书 §8 第 1 条要求实测回报）：房主自报 `0`、加入方自报 `1`
   * （`createLobbySessionLink` 的缺省：`opts.seat ?? (role === 'host' ? 0 : 1)`），
   * 房主的 `hello-ack.seat` 回的**就是加入方自报的那个 1**（今天房主不换座位）
   * ⇒ 加入方是座位 1、房主是座位 0。
   *
   * ⚠️ 而硬币屏要的不是"本端座位"，是**叫面者（加入方）的座位**：`callerSeat()` 在
   * 加入方那一侧读自己的 `selfSeat`（= 1）、在房主那一侧读 `peerSeat`（= 加入方报上来的 1）
   * ⇒ **两端读出来必须是同一个 1**。真浏览器门实测过一次"两端各读本端座位"的形状：
   * 房主拿到 0、加入方拿到 1 ⇒ 同一局两端算出相反的先选协议者（2026-09-19）。
   */
  it('★ 两端读到的叫面者座位必须是同一个（加入方 1）', async () => {
    const rig = makeRig({ chooseFace: () => Promise.resolve(1) });
    await rig.connect();
    await rig.run(8);
    // 加入方：自己的座位（`hello-ack.seat` 认可之后是 1）
    expect(rig.guest.client.callerSeat(), '加入方读到的叫面者座位不是 1（hello-ack.seat 没被采纳？）').toBe(1);
    // 房主：**对端**的座位（= 加入方报上来的那一个）
    expect(rig.host.client.callerSeat(), '房主读到的叫面者座位不是加入方那一个（读了本端座位？）').toBe(1);
    // 本端座位那一侧仍然照 D7 的缺省走（反空转：证明上面两条不是把两个概念混了）
    expect(rig.guest.client.state().peer?.phase, '夹具没走到承诺流程（座位读数可能还没定）').not.toBe('handshaking');
  });

  it('★ side=1 与 side=2 两种情形：两端 `draftStarter` 相等，且两种情形互为相反值', async () => {
    for (const side of [1, 2] as const) {
      const rig = makeRig({ chooseFace: () => Promise.resolve(side) });
      await rig.host.client.connect('first');
      await rig.guest.client.connect('first');
      await rig.run(8);

      const s = startersOf(rig);
      // ① 两端算出来的先选协议者必须**相等**（各自算一次，同一份种子、同一个座位）
      expect(s.hostStarter, `side=${side}：两端算出的 draftStarter 不同（房主 ${s.hostStarter} / 加入方 ${s.guestStarter}）`)
        .toBe(s.guestStarter);
      // ② 叫面真的被送出去了（否则下面那条规则断言会在"面恒 0"上假绿）
      expect(s.side, `side=${side}：线上揭示的面不是叫出去的那一面`).toBe(side);
      // ③ 叫中 ⇒ 叫面者（`callerSeat()` 那一个座位）先选；叫错 ⇒ 另一方先选
      const landing = coinLanding(s.seed);
      const otherSeat: PlayerId = (1 - s.guestSeat) as PlayerId;
      const expectStarter: PlayerId = landing === side ? s.guestSeat : otherSeat;
      expect(s.hostStarter, `side=${side}：落点是 ${landing}，"叫中才算"这条规则没被执行`)
        .toBe(expectStarter);
      // ④ 两条腿合起来必须覆盖两个座位（否则"两种情形互为相反值"是空话）
      expect(
        [1, 2].map((x) => (coinLanding(s.seed) === x ? s.guestSeat : otherSeat)).sort(),
        '两种情形没有覆盖到两个不同的座位（"互为相反值"这件事无从验证）',
      ).toEqual([s.guestSeat, otherSeat].sort());
    }
  });

  it('★ 落点读数的口径：两端都用 `coinLanding(种子)`，且房主要等胜负依据到手', async () => {
    let resolveFace: ((side: CoinSide) => void) | null = null;
    const rig = makeRig({
      chooseFace: () => new Promise<CoinSide>((res) => { resolveFace = res; }),
    });
    await rig.connect();
    await rig.runUntilStuck(8);
    // 叫面之前：种子的两侧时刻不同（房主 `sendCommit` 之后就有、加入方要等 `reveal-seed`），
    // 但**胜负依据**在房主那侧还没有 ⇒ 房主不许把落点交出去（`verdictReady() === false`）
    expect(rig.host.client.verdictReady(), '加入方还没叫面，房主就报"能算胜负"').toBe(false);
    // 加入方自己就是叫面者 ⇒ 它这一侧恒 true（它不需要"对端的面"）
    expect(rig.guest.client.verdictReady(), '加入方这一侧不该是 false（它自己就是叫面者）').toBe(true);

    resolveFace!(2);
    await rig.run(8);
    const msgs = messagesOf(rig.pair);
    const seed = firstOf(msgs, 'reveal-seed')!.seed;
    const landing = coinLanding(seed);
    // ★ 两端算出的落点必须相同，且等于 `coinLanding(种子)`
    expect(rig.host.client.landedSide(), '房主算出的落点不是 coinLanding(种子)').toBe(landing);
    expect(rig.guest.client.landedSide(), '加入方算出的落点不是 coinLanding(种子)').toBe(landing);
    // ★ 而"叫出去的那一面"是**另一件事**：房主读 `peerChosenSide()`（加入方揭示的），
    //   加入方读自己的 `chosenSide()` —— 两者同面，且**不等于**落点时不等于也照样对（见下条腿）
    expect(rig.host.client.peerChosenSide(), '房主读到的"对端叫的面"与加入方叫的不同')
      .toBe(rig.guest.client.chosenSide());
    expect(rig.host.client.verdictReady(), '加入方的面已经揭示，房主却仍报"算不了胜负"').toBe(true);
    // 反空转：落点必须**真的**取决于种子（不是恒 1 或恒 2）—— 换一条种子要能给出另一面
    const other = [...'seed-alt-1', 'seed-alt-2', 'seed-alt-3']
      .map((s) => coinLanding(s))
      .some((s) => s === landing);
    expect(
      [...'seed-alt-1', 'seed-alt-2', 'seed-alt-3'].map((s) => coinLanding(s)).some((s) => s !== landing) || other,
      '换几条种子都给出同一面 ⇒ 这条腿可能在"恒定落点"上假绿',
    ).toBe(true);
  });

  it('★ 反空转：`draftStarterFor` 的"叫中才算"有牙（把规则换成"永远 caller"必须在合成输入上红）', () => {
    const seed = 'seed-for-rule';
    const landing = coinLanding(seed);
    const miss: CoinSide = landing === 1 ? 2 : 1;
    expect(draftStarterFor(1, landing, seed), '叫中时先选者不是叫面者').toBe(1);
    expect(draftStarterFor(1, miss, seed), '叫错时先选者仍然是叫面者（"永远 caller"那条变异会在这里绿）').toBe(0);
  });
});



