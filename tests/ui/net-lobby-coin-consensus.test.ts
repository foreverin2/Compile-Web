/**
 * G5 T11-B（修复轮）· **各向异性**的两条腿：
 *
 *  1. **跨端共识不变量**（判据 3/4 的 node 面）：两端算先选协议者用的那几样东西必须同源 ——
 *     `callerSeat()`（两端同一个数）、`chosenSide()` / `peerChosenSide()`（同一面）、
 *     `landedSide()`（同一落点），于是 `draftStarterFor` 在两端给出**同一个座位**。
 *     这一条是修复轮点名要补的：真浏览器门实测过"两端落点相同、先选者相反"（房主那一侧
 *     曾经拿**落点**当"对端叫的面"去算，见 `src/main.ts` 的说明）。
 *  2. **负控的确定性**（工具 ④ 的 node 面）：同一种篡改必须让**每一条**邀请码都解不开、
 *     且给出可读原因 —— 这样 ④ 就不再靠"多跑浏览器碰运气"（旧口诀：改中段那一位可能
 *     落在 deflate 字面量上、流照样解得开）。
 *
 * ## 能力边界
 *
 * 走真客户端 + 真会话 + 成对假传输（同 `net-lobby-coin.test.ts`）；邀请码那部分用
 * **真的 deflate-raw**（`globalThis.CompressionStream`，node 18+ 自带，与产出代码同一个实现）。
 */
import { describe, it, expect } from 'vitest';
import { createLobbyClient, lobbyCoinViewOf, type LobbyClient, type LobbyTicker } from '../../src/ui/net-lobby';
import { createFakeTransportPair } from '../../src/net/fake-transport';
import { decodeMsg, PROTO_VERSION, type NetMsg } from '../../src/net/protocol';
import { browserHashOf, createInvite, decodeBase64Url, decompressBytes, inviteLengthReport } from '../../src/ui/net-browser';
import type { NetBrowserEnv } from '../../src/ui/net-browser';
import { CARD_DATA_HASH } from '../../src/app/card-data-hash';
import type { NetTransport } from '../../src/net/transport';
import type { PlayerId } from '../../src/core/models/types';
import { coinLanding, draftStarterFor, type CoinSide } from '../../src/app/coin';
import { decodeInviteText, protocolVersionCheck } from '../../src/net/invite';
import type { InviteFields } from '../../src/net/invite';

/* ------------------------------------------------------------------ *
 * 夹具
 * ------------------------------------------------------------------ */

function fakeTicker(): LobbyTicker {
  let next = 1;
  return { schedule: (): number => next++, cancel: (): void => { /* 本文件用不到 8 秒窗口 */ } };
}

function tokenQueue(...values: readonly string[]): () => string {
  let i = 0;
  return () => {
    const v = values[Math.min(i, values.length - 1)];
    i += 1;
    return v ?? '';
  };
}

function messagesOf(pair: ReturnType<typeof createFakeTransportPair>): NetMsg[] {
  const out: NetMsg[] = [];
  for (const s of pair.steps()) {
    const dec = decodeMsg(s.text, { protoVersion: PROTO_VERSION });
    if (dec.ok) out.push(dec.msg);
  }
  return out;
}

interface Rig {
  readonly pair: ReturnType<typeof createFakeTransportPair>;
  readonly host: LobbyClient;
  readonly guest: LobbyClient;
  connect(): Promise<void>;
  run(rounds: number): Promise<void>;
}

function makeRig(chooseFace: () => Promise<CoinSide>, matchSeed = 'mseed-fix'): Rig {
  const pair = createFakeTransportPair();
  const tokens = tokenQueue('SALT-FIX', 'NONCE-FIX');
  const mk = (role: 'host' | 'guest', tr: NetTransport): LobbyClient => createLobbyClient({
    role,
    sessionId: 'sid-fix-shared',
    matchSeed,
    randomToken: tokens,
    chooseFace,
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
  return {
    pair,
    host,
    guest,
    async connect(): Promise<void> {
      await host.connect('first');
      await guest.connect('first');
    },
    async run(rounds: number): Promise<void> {
      for (let i = 0; i < rounds; i += 1) {
        pair.pump(3);
        host.drive();
        guest.drive();
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      }
    },
  };
}

/* ------------------------------------------------------------------ *
 * 1. 跨端共识不变量（四种 side × 两种落点）
 * ------------------------------------------------------------------ */

describe('G5 T11-B 修复轮 · 判据 3/4 的 node 面：两端四读数同源', () => {
  it('★ 两端的 callerSeat / chosen / landed 逐个相同，`draftStarterFor` 给出同一个座位', async () => {
    /**
     * ★★ **两条种子 × 两种 side**（修复轮的关键夹具决定）。
     *
     * 为什么不能只用一条种子：`coinLanding(种子)` 只由种子定，而真浏览器门里那条邀请码的
     * 种子每次都不同 ⇒ "叫中"与"叫错"两种情形都会出现。只用一条种子 + 四种 side 时，
     * 那四种其实是**同一种**情形（落点恒等于其中一种），于是"房主拿落点当对端叫的面"这条
     * 缺陷在 node 面**照样绿**（实测：第一次改完这条腿，`M-host-chosen` 变异 33 过 0 红）。
     * ⇒ 夹具必须覆盖"落点 = 1"与"落点 = 2"两条种子，保证两种情形都真的跑到。
     */
    const seeds = ['mseed-fix-1', 'mseed-fix-2', 'mseed-fix-3', 'mseed-fix-4', 'mseed-fix-5', 'mseed-fix-6'];
    const landings = seeds.map((s) => coinLanding(s));
    // 反空转：这组种子里必须两种落点都有（否则下面两条"情形"是同一件事）
    expect(
      [1, 2].every((x) => landings.includes(x as CoinSide)),
      `这组种子只给出落点 ${JSON.stringify(landings)} ⇒ "叫中 / 叫错"两种情形没有都跑到`,
    ).toBe(true);

    for (const seed of seeds) {
      const landing = coinLanding(seed);
      for (const side of [1, 2] as const) {
        const rig = makeRig(() => Promise.resolve(side), seed);
        await rig.connect();
        await rig.run(8);

        // ① 叫面者的座位：两端同一个数（房主读 `peerSeat`、加入方读 `selfSeat`）
        expect(rig.host.callerSeat(), `种子 ${seed} side=${side}：两端读到的叫面者座位不同`)
          .toBe(rig.guest.callerSeat());
        // ② 叫出去的那一面：加入方读自己的、房主读揭示进来的 —— 必须同一面
        expect(rig.host.peerChosenSide(), `种子 ${seed} side=${side}：房主读到的"对端叫的面"与加入方叫的不同`)
          .toBe(rig.guest.chosenSide());
        expect(rig.guest.chosenSide(), `种子 ${seed} side=${side}：加入方叫的面不是注入的那一面`).toBe(side);
        // ③ 落点：两端同一条规则（`coinLanding(种子)`）
        const held = rig.guest.seedOfSession();
        expect(held, '加入方没拿到种子').toBe(seed);
        expect(rig.host.landedSide(), `种子 ${seed} side=${side}：房主算的落点与 coinLanding(种子) 不同`)
          .toBe(landing);
        expect(rig.guest.landedSide(), `种子 ${seed} side=${side}：加入方算的落点与 coinLanding(种子) 不同`)
          .toBe(landing);
        // ④ 先选协议者：两端**各自**用同一份规则算，必须给出同一个座位
        const hostWinner: PlayerId = draftStarterFor(rig.host.callerSeat(), rig.host.peerChosenSide()!, held!);
        const guestWinner: PlayerId = draftStarterFor(rig.guest.callerSeat(), rig.guest.chosenSide()!, held!);
        expect(hostWinner, `种子 ${seed} side=${side}：两端算出的先选协议者不同（房主 ${hostWinner} / 加入方 ${guestWinner}）`)
          .toBe(guestWinner);
        /**
         * ★★ **接线腿（修复轮新增，判据 3 的真正承重）**：上面那条算的是**测试自己**的式子，
         * 证明不了"产出代码用的就是这条路"。这里直接调产出代码那一份
         * （`lobbyCoinViewOf()`，屏上画的就是它给的 `winner`），断言它与上面的权威值相同、
         * 且两端的 `winner` 逐字相同。
         *
         * 这一条是唯一能抓住"房主拿落点当对端叫的面"那个缺陷的 node 腿：
         * 修复前 `main.ts` 读的是 `landedSide()`，而它在"叫中"的种子上与正确值**恰好同值** ——
         * 只比"两端相等"的腿会绿（实测：`M-host-chosen` 变异在只有上一条时 33 过 0 红）。
         */
        const hostView = lobbyCoinViewOf(rig.host, { choose: () => { /* 不点 */ }, onChosen: () => { /* 不驱动 */ } });
        const guestView = lobbyCoinViewOf(rig.guest, { choose: () => { /* 不点 */ }, onChosen: () => { /* 不驱动 */ } });
        expect(hostView, `种子 ${seed} side=${side}：房主那一侧没算出硬币屏读数`).not.toBeNull();
        expect(guestView, `种子 ${seed} side=${side}：加入方那一侧没算出硬币屏读数`).not.toBeNull();
        expect(hostView!.winner, `种子 ${seed} side=${side}：产出代码给房主算的先选协议者与权威值不同`
          + `（产出 ${String(hostView!.winner)} / 权威 ${hostWinner}）`).toBe(hostWinner);
        expect(guestView!.winner, `种子 ${seed} side=${side}：产出代码给加入方算的先选协议者与权威值不同`
          + `（产出 ${String(guestView!.winner)} / 权威 ${guestWinner}）`).toBe(guestWinner);
        expect(hostView!.winner, `种子 ${seed} side=${side}：两端屏上的 winner 不是同一个座位`).toBe(guestView!.winner);
        // 屏上那句"玩家 N"就是同一个座位 + 1（全局座位编号；屏那一侧的实现见 home.ts）
        expect(hostView!.caller, `种子 ${seed} side=${side}：两端屏上的 caller 不同`).toBe(guestView!.caller);
        expect(hostView!.landed, `种子 ${seed} side=${side}：两端屏上的落点不同`).toBe(guestView!.landed);
        /**
         * ★★ 反空转（这条是修复轮那次缺陷的**直接**腿）：**"叫错"时必须与"叫中"给出不同座位**。
         *
         * 修复前 `main.ts` 让房主拿落点当"对端叫的面"（`draftStarterFor(caller, landed, seed)`），
         * 于是房主永远算"叫中了" —— 在"叫错"的那些种子上，它必然给出**另一个**座位。
         * 这条断言就是那个形状的探针：`landing !== side` 时两值必须不同。
         */
        if (landing !== side) {
          const wrongWinner: PlayerId = draftStarterFor(rig.host.callerSeat(), landing, held!);
          expect(
            wrongWinner,
            `种子 ${seed} side=${side}：落点是 ${landing}（叫错了），"拿落点当叫的面"这条错路竟然也给出 ${hostWinner}`,
          ).not.toBe(hostWinner);
        }
        // 收线：线上确实揭示过那一面
        const revealFace = messagesOf(rig.pair).find((m) => m.t === 'reveal-face');
        expect(revealFace, '线上没有 reveal-face').not.toBeUndefined();
      }
    }
  });
});

/* ------------------------------------------------------------------ *
 * 1b. `lobbyCoinViewOf()` 的四个提前返回分支（修复轮：评审点名"没有直接腿"）
 * ------------------------------------------------------------------ */

describe('G5 T11-B 修复轮 · `lobbyCoinViewOf()` 的提前返回分支（直接腿）', () => {
  /** 造一个**不接传输**的客户端（只用来问"这一格该不该画硬币屏"） */
  function bareClient(role: 'host' | 'guest', withChooser: boolean): LobbyClient {
    return createLobbyClient({
      role,
      sessionId: 'sid-branch',
      matchSeed: 'mseed-branch',
      randomToken: () => 'tok',
      ...(withChooser ? { chooseFace: () => Promise.resolve(1 as CoinSide) } : {}),
      localProtoVersion: PROTO_VERSION,
      localCardDataHash: CARD_DATA_HASH,
      hash: browserHashOf,
      ticker: fakeTicker(),
      createTransport: () => createFakeTransportPair().A.transport,
      signalingEndpoint: '',
      readSettings: () => ({ turnUrl: '', turnUsername: '', turnCredential: '' }),
      buildInvite: async () => ({ ok: true as const, payload: 'P', link: 'https://x.invalid/l#invite=P' }),
      decompressBase64: async () => null,
      readAddressBar: () => null,
      localNick: () => 'nick',
    });
  }
  const hooks = { choose: () => { /* 不点 */ }, onChosen: () => { /* 不驱动 */ } };

  it('★ 没有注入 `chooseFace` ⇒ 恒 `null`（屏上不出现硬币屏）', async () => {
    /**
     * ⚠️ 这一格必须**接上链路**才测得动：`hasFaceChooser()` / `role()` 都读当前那条链路，
     * 没链路时它们一律报"没有" —— 拿一个裸客户端断言 `null` 是恒真的假腿（实测踩过）。
     */
    const pair = createFakeTransportPair();
    const noChooser = createLobbyClient({
      role: 'guest',
      sessionId: 'sid-no-chooser',
      matchSeed: 'mseed-branch',
      randomToken: () => 'tok',
      localProtoVersion: PROTO_VERSION,
      localCardDataHash: CARD_DATA_HASH,
      hash: browserHashOf,
      ticker: fakeTicker(),
      createTransport: () => pair.B.transport,
      signalingEndpoint: '',
      readSettings: () => ({ turnUrl: '', turnUsername: '', turnCredential: '' }),
      buildInvite: async () => ({ ok: true as const, payload: 'P', link: 'https://x.invalid/l#invite=P' }),
      decompressBase64: async () => null,
      readAddressBar: () => null,
      localNick: () => 'nick',
    });
    await noChooser.connect('first');
    expect(noChooser.role(), '正控：接上链路之后角色仍未定').toBe('guest');
    expect(noChooser.canChooseFace(), '正控：没有注入 chooseFace 却报"能要面"').toBe(false);
    expect(lobbyCoinViewOf(noChooser, hooks), '没有"要面"的能力却算出了硬币屏读数').toBeNull();
  });

  it('★ 还没有链路（`role() === null`）⇒ `null`', () => {
    const c = bareClient('guest', true);
    expect(c.role(), '正控：这个夹具竟然已经有角色了').toBeNull();
    expect(lobbyCoinViewOf(c, hooks), '还没接上链路就给出了硬币屏读数').toBeNull();
  });

  it('★ 相位还没走到那一格 ⇒ `null`（加入方在 `handshaking` / 房主在 `awaiting-commit` 时都没有硬币屏）', async () => {
    // 只走一轮：两端还在握手早期
    const rig = makeRig(() => Promise.resolve(1));
    await rig.connect();
    expect(rig.guest.phase(), '正控：加入方一上来就不在握手早期了（这条腿的前提没成立）').toBe('handshaking');
    expect(lobbyCoinViewOf(rig.guest, hooks), '加入方在 handshaking 就出现了硬币屏').toBeNull();
    // 反空转：推到该出现的那一格之后，同一个调用**必须**给出读数
    await rig.run(8);
    expect(lobbyCoinViewOf(rig.guest, hooks), '走到该出现的那一格了，却仍然没有硬币屏读数').not.toBeNull();
  });

  it('★ 叫面方的 `choose` 真的接到宿主那一对回调上（`choose` 与 `onChosen` 各一次）', async () => {
    const rig = makeRig(() => Promise.resolve(2));
    await rig.connect();
    await rig.run(8);
    const picked: CoinSide[] = [];
    let driven = 0;
    const view = lobbyCoinViewOf(rig.guest, { choose: (s) => picked.push(s), onChosen: () => { driven += 1; } });
    expect(view, '加入方那一侧没有硬币屏读数').not.toBeNull();
    expect(view!.role, '加入方那一侧不是叫面方').toBe('caller');
    view!.choose(1);
    expect(picked, '点芯片没有把面交给宿主').toEqual([1]);
    expect(driven, '叫完面之后没有驱动（握手会停在那一格）').toBe(1);
    // 等待方那一侧没有可点的东西
    const hostView = lobbyCoinViewOf(rig.host, { choose: () => picked.push(9 as CoinSide), onChosen: () => { driven += 1; } });
    expect(hostView!.role, '房主那一侧不是等待方').toBe('waiter');
    hostView!.choose(1);
    expect(picked, '等待方竟然也能叫面').toEqual([1]);
  });
});

/* ------------------------------------------------------------------ *
 * 2. 负控的确定性：同一种篡改 ⇒ 每条码都解不开（工具 ④ 的 node 面）
 * ------------------------------------------------------------------ */

/** 真的 deflate-raw 压缩/解压（与产出代码同一个实现；node 18+ 自带构造器） */
const zlibEnv: NetBrowserEnv = {
  compressionStream: (mode) => {
    const g = globalThis as unknown as {
      CompressionStream?: new (f: string) => unknown;
      DecompressionStream?: new (f: string) => unknown;
      Blob?: new (parts: readonly Uint8Array[]) => { stream(): unknown };
      Response?: new (body: unknown) => { arrayBuffer(): Promise<ArrayBuffer> };
    };
    const Ctor = mode === 'compress' ? g.CompressionStream : g.DecompressionStream;
    const BlobCtor = g.Blob;
    const ResponseCtor = g.Response;
    if (Ctor === undefined || BlobCtor === undefined || ResponseCtor === undefined) return null;
    return {
      run: async (input: Uint8Array): Promise<Uint8Array> => {
        const stream = new Ctor('deflate-raw');
        const piped = (new BlobCtor([input]).stream() as { pipeThrough(s: unknown): unknown }).pipeThrough(stream);
        return new Uint8Array(await new ResponseCtor(piped).arrayBuffer());
      },
    };
  },
};

/** 造一条**真**邀请码（`createInvite` 走真压缩；每个字段都由"第 n 条"派生，50 条互不相同） */
async function realInvite(n: number): Promise<string> {
  /**
   * SDP 的长度要**接近真的**（真浏览器产出的那一条约 1500 字符、压完 650+ 个字符）。
   * 手搓一条太短的会让"邀请码是一条长码"那条腿在空壳上假绿（实测：短 SDP 只压出 150 个字符）。
   */
  const candidates = Array.from({ length: 12 }, (_v, i) => (
    `a=candidate:${String(i)} 1 udp 2122260223 192.168.1.${String(i + 2)} ${String(50000 + i + n)} typ host generation 0`
  )).join('\r\n');
  const fields: InviteFields = {
    p: PROTO_VERSION,
    sessionId: `sid-${String(n).padStart(3, '0')}-${'x'.repeat(24)}`,
    sdp: `v=0\r\no=- ${String(n)} 1 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\n`
      + `a=group:BUNDLE 0 1\r\na=msid-semantic: WMS\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\n`
      + `a=ice-ufrag:${'u'.repeat(4)}${String(n)}\r\na=ice-pwd:${'p'.repeat(22)}\r\n`
      + `a=fingerprint:sha-256 ${'AB:CD:'.repeat(10)}${String(n % 10)}\r\n${candidates}\r\n`,
    ice: [`cand-${String(n)}-a`, `cand-${String(n)}-b`],
    hostPromise: `host-promise-${String(n)}`,
    guestPromise: `guest-promise-${String(n)}`,
  };
  const r = await createInvite({ ...fields, originAndPath: 'https://example.test/compile/' }, zlibEnv);
  if (!r.ok) throw new Error(`夹具造不出邀请码（第 ${String(n)} 条）：${r.message}`);
  return r.payload;
}

/**
 * 大厅里那个"真解压"口（与 `main.ts` 的 `decompressBase64` 同形）。
 *
 * `decodeInviteText` 要的是一个**同步**的"这段 base64 解出来了吗"的回答，而真解压是异步的
 * ⇒ 这里先 `await` 出字节，再把它当"已经算好的结果"交回去（D15 的缝法）。
 */
async function decodeWithRealInflate(payload: string): Promise<{ ok: boolean; reason: string; message: string }> {
  const dot = payload.indexOf('.');
  if (dot < 0) return { ok: false, reason: 'bad-base64url', message: '' };
  const compressed = payload.slice(dot + 1);
  const raw = decodeBase64Url(compressed);
  const inflated = raw === null ? null : await decompressBytes(raw, zlibEnv);
  const bytes = inflated !== null && inflated.ok ? inflated.bytes : null;
  const dec = decodeInviteText(payload, (b64) => (b64 === compressed ? bytes : null));
  return dec.ok ? { ok: true, reason: '', message: '' } : { ok: false, reason: dec.reason, message: dec.message };
}

describe('G5 T11-B 修复轮 · 负控的确定性（工具 ④ 不再靠碰运气）', () => {
  it('★ 50 条现场生成的邀请码：原码解得开；**截断压缩段**后全部解不开且各给一句可读原因', async () => {
    const notDecodable: string[] = [];
    const truncationSurvived: string[] = [];
    const unreadable: string[] = [];
    for (let n = 0; n < 50; n += 1) {
      const payload = await realInvite(n);
      const dot = payload.indexOf('.');
      const compressed = payload.slice(dot + 1);

      // 正控：原码必须解得开（否则下面"全都解不开"可能只是夹具坏了 ⇒ 假绿）
      const good = await decodeWithRealInflate(payload);
      expect(good.ok, `第 ${String(n)} 条原码竟然解不开（${good.reason}：${good.message}）`).toBe(true);

      // 篡改：砍掉压缩段最后 8 个字符（deflate 流被截断）
      const brokenCompressed = compressed.slice(0, Math.max(1, compressed.length - 8));
      const broken = `${payload.slice(0, dot + 1)}${brokenCompressed}`;
      const bad = await decodeWithRealInflate(broken);
      if (bad.ok) truncationSurvived.push(`第 ${String(n)} 条`);
      else if (bad.message.trim().length < 12) unreadable.push(`第 ${String(n)} 条（${JSON.stringify(bad.message)}）`);
      if (bad.reason !== 'decompress-failed') notDecodable.push(`第 ${String(n)} 条：${bad.reason}`);
    }
    expect(
      truncationSurvived,
      `截断之后**仍然解得开**的码（${truncationSurvived.length} 条）：${truncationSurvived.slice(0, 3).join('、')}`
      + ' ⇒ 工具 ④ 那条负控就会间歇性绿（旧口诀的毛病）',
    ).toEqual([]);
    expect(unreadable, `可读原因太短的码：${unreadable.slice(0, 3).join('、')}`).toEqual([]);
    // 原因码也必须是同一类（"解不开"，不是"版本不符"之类）
    expect(notDecodable, `截断给出的原因码不是 decompress-failed：${notDecodable.slice(0, 3).join('、')}`)
      .toEqual([]);
  });

  it('★ 反空转（确定性）：**只改明文版本段**（`p.` → 另一个数）⇒ 50 条全部走"版本不符"那一类，而不是"解不开"', async () => {
    /**
     * 为什么还要这一条：上一条钉的是"截断 ⇒ 一律解不开"。若把篡改换成"只动明文版本段"，
     * 结果就**不是**解不开（压缩段完好、载荷照样解得动），而是 `protocolVersionCheck` 那一步
     * 给出"版本不符"—— 两种篡改给出两类不同的结论，证明上一条不是"什么都红"。
     *
     * 这也正是工具 ④ 选"截断"而不是"改版本段"的理由：④ 要的是一句**可读失败**，
     * 而版本不符那一支的文案需要两端协议版本本来就不同才会在屏上出现（本机同版本时
     * `p` 与 `local` 相等，改一个数就落到"更新/更旧的版本"那两句上，仍然可读）。
     */
    const mismatched = PROTO_VERSION + 7;
    const wrongClass: string[] = [];
    for (let n = 0; n < 50; n += 1) {
      const payload = await realInvite(n);
      const dot = payload.indexOf('.');
      const patched = `${String(mismatched)}.${payload.slice(dot + 1)}`;
      // ① 载荷本身照样解得开（证明"改版本段"不破坏压缩段）
      const dec = await decodeWithRealInflate(patched);
      if (!dec.ok) wrongClass.push(`第 ${String(n)} 条：改版本段之后竟然解不开（${dec.reason}）`);
      // ② 那一类失败由 `protocolVersionCheck` 给出，且必须**不通过**
      const verdict = protocolVersionCheck(mismatched, PROTO_VERSION);
      if (verdict.ok) wrongClass.push(`第 ${String(n)} 条：版本比对竟然通过`);
      else if (verdict.message.trim().length < 12) wrongClass.push(`第 ${String(n)} 条：版本不符的文案太短`);
    }
    expect(wrongClass, `改版本段那一路不对的码：${wrongClass.slice(0, 3).join('、')}`).toEqual([]);
  });

  it('★ 长度读数对真码有牙（现场造的码是一条"长码"，不是空壳）', async () => {
    const payload = await realInvite(0);
    const r = inviteLengthReport(payload);
    expect(r.chars, '长度读数与载荷长度对不上').toBe(payload.length);
    // ⚠️ 这里**不**断言"落在 T7 的实测区间内"：区间是拿真浏览器产出的 SDP 量出来的，
    //    而本夹具的 SDP 是手搓的（比真的短）—— 断言区间会变成"夹具与那条常量对齐"的假腿。
    //    能钉的是"它确实是一条长码"（几百个字符），空壳码混不过去。
    expect(r.chars, `现场造的邀请码太短（${String(r.chars)} 个字符）⇒ 这条腿在空壳上会假绿`).toBeGreaterThan(300);
  });
});
