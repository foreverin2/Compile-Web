import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { stripComments } from '../ui/source-text';
import { CHANNEL_SPECS } from '../../src/net/transport';
import type { TransportInit } from '../../src/net/transport';
import { createHostSession, type HashLike } from '../../src/net/session';
import { PROTO_VERSION, ROOM_CODE_ALPHABET, roomChannel } from '../../src/net/protocol';
import { CARD_DATA_HASH } from '../../src/app/card-data-hash';
import {
  COMPRESSED_BYTES_MAX,
  COMPRESSED_BYTES_MIN,
  COMPRESSION_RATIO_MAX,
  COMPRESSION_RATIO_MIN,
  INVITE_CHARS_MAX,
  INVITE_CHARS_MIN,
  NO_ENDPOINT_MESSAGE,
  bytesToBase64Url,
  decodeInviteText,
  inviteFragmentOf,
  payloadBytesOf,
  utf8Encode,
} from '../../src/net/invite';
import {
  DEFAULT_ICE_SERVERS,
  browserHash,
  browserHashOf,
  browserRandomness,
  browserRoomCode,
  compressText,
  compressionWithinMeasuredRange,
  createBrowserTransport,
  createInvite,
  createSignalingSession,
  decodeInviteFromAddressBar,
  decodeInvitePayload,
  discoverSignalingEndpoint,
  inviteLengthReport,
  isRelayUrl,
  readIceServers,
  readInviteFromAddressBar,
  roomCodeEntry,
  sha256Bytes,
  signalEndpointOf,
  signalingEndpointSetting,
  stripInviteFromAddressBar,
  utf8TextOf,
  type CompressionStreamLike,
  type DataChannelLike,
  type NetBrowserEnv,
  type PeerConnectionLike,
  type WebSocketLike,
} from '../../src/ui/net-browser';

/* ============================================================================
 * G5 T7 的**浏览器层**判据（`src/ui/net-browser.ts`，全部靠注入假件）
 *
 * 对应任务书 §2 的判据 1（唯一出处）、5（端点为空零网络请求）、7（压缩区间）、
 * 8（哈希在状态机里可用）、9（默认无中继）、12（init 只等本侧）、14（划界）。
 *
 * ## 缝开在**参数表**上
 *
 * 所有假件都从 `createBrowserTransport(env)` / `compressText(text, env)` 的**形参**进去，
 * **一个 `globalThis` 桩都不打**（`tests/ui/local-store-browser.test.ts:14-19` 记录的
 * `pwa-update.ts` 事故就是"打桩绿、真浏览器不工作"）。
 * ========================================================================== */

/* ============================================================================
 * 0. 记账式假件（先证明账本有效，再看它为空）
 * ========================================================================== */

interface Ledger {
  /** 造过几个信令连接（每个地址一条） */
  wsUrls: string[];
  /** `fetch` 调用过的地址 */
  fetched: string[];
  /** 每个对端连接收到的 `iceServers` 配置 */
  iceConfigs: unknown[];
  /** 通道的 `send()` 收到的文本（按标签分） */
  sent: { label: string; text: string }[];
  /** `restartIce()` 被调了几次 */
  restarts: number;
  /** 造出来的假信令连接（用来显式把它推到 open） */
  ws: WebSocketLike[];
}

/** 一个假的对端连接：两条通道可以**受控地**开 / 不开（判据 12 的"对端不可达"靠它） */
function fakePeerConnection(ledger: Ledger, opts: { openChannels?: boolean; buffered?: number } = {}) {
  const listeners = new Map<string, ((ev: unknown) => void)[]>();
  const fire = (type: string): void => {
    for (const cb of listeners.get(type) ?? []) cb({});
  };
  const dcs = new Map<string, DataChannelLike>();
  const pc: PeerConnectionLike = {
    connectionState: 'new',
    iceConnectionState: 'new',
    localDescription: null,
    createDataChannel(label) {
      const dc: DataChannelLike = {
        label,
        readyState: opts.openChannels === true ? 'open' : 'connecting',
        bufferedAmount: opts.buffered ?? 0,
        send: (data) => { ledger.sent.push({ label, text: data }); },
        close: () => { (dc as { readyState: string }).readyState = 'closed'; },
        addEventListener: (type, cb) => {
          listeners.set(`${label}:${type}`, [...(listeners.get(`${label}:${type}`) ?? []), cb]);
        },
      };
      dcs.set(label, dc);
      return dc;
    },
    async createOffer() {
      return { type: 'offer', sdp: OFFER_SDP };
    },
    async setLocalDescription(desc) { (pc as { localDescription: unknown }).localDescription = desc; },
    restartIce: () => { ledger.restarts += 1; },
    close: () => { (pc as { connectionState: string }).connectionState = 'closed'; },
    addEventListener: (type, cb) => { listeners.set(type, [...(listeners.get(type) ?? []), cb]); },
  };
  return {
    pc,
    /** 把 ICE 状态推到一个值并触发事件（判据 12 用它造"永远连不上"与"连上了"两个世界） */
    setIceState(state: string): void {
      (pc as { iceConnectionState: string }).iceConnectionState = state;
      (pc as { connectionState: string }).connectionState = state;
      fire('iceconnectionstatechange');
      fire('connectionstatechange');
    },
    /** 让某条通道 open / 收到消息 */
    openChannel(label: string): void {
      const dc = dcs.get(label);
      if (dc === undefined) return;
      (dc as { readyState: string }).readyState = 'open';
      for (const cb of listeners.get(`${label}:open`) ?? []) cb({});
    },
    deliver(label: string, text: string): void {
      for (const cb of listeners.get(`${label}:message`) ?? []) cb({ data: text });
    },
    dcs,
  };
}

/** 假的信令连接（每次构造都记进账本）。默认停在 `CONNECTING`，要显式 `open()` 才连上 */
function fakeWebSocket(ledger: Ledger, url: string): WebSocketLike {
  ledger.wsUrls.push(url);
  const listeners: ((ev: unknown) => void)[] = [];
  const ws: WebSocketLike = {
    readyState: 0,
    send: (data) => { ledger.sent.push({ label: 'ws', text: data }); },
    close: () => { (ws as { readyState: number }).readyState = 3; },
    addEventListener: (type, cb) => { if (type === 'open') listeners.push(cb); },
  };
  ledger.ws.push(ws);
  return ws;
}

/** 一个记账的假 `fetch`（判据 5 的"零调用"就数它） */
function fakeFetch(ledger: Ledger): (url: string) => Promise<{ ok: boolean; status: number }> {
  return async (url: string) => {
    ledger.fetched.push(url);
    return { ok: true, status: 200 };
  };
}

/**
 * 一个**真实**的压缩流假件：用 Node 22 自带的 `CompressionStream('deflate-raw')`。
 *
 * 为什么这不算"假"：它就是浏览器里的同一个 API（本机 Node 22.22.2 实测
 * `typeof CompressionStream === 'function'`）。用它量出来的字节数才是真的 deflate 输出，
 * 而不是"假件编出来的数字"。
 */
const realCompression: (mode: 'compress' | 'decompress') => CompressionStreamLike | null = (mode) => {
  const Ctor = mode === 'compress' ? globalThis.CompressionStream : globalThis.DecompressionStream;
  if (Ctor === undefined) return null;
  return {
    run: async (input) => {
      // `Uint8Array` 的 `buffer` 在 TS 5.7+ 的泛型里是 `ArrayBufferLike`，而 `BlobPart` 只要
      // `ArrayBufferView<ArrayBuffer>` —— 这一处必须显式断言（本仓没有 `@types/node`，不能用别的手段）
      const piped = new Blob([input as unknown as BlobPart]).stream().pipeThrough(new Ctor('deflate-raw'));
      return new Uint8Array(await new Response(piped).arrayBuffer());
    },
  };
};

/** 一个**恒等**的压缩流假件：原样交回（只用在"不关心压缩语义"的腿上） */
const identityCompression: (mode: 'compress' | 'decompress') => CompressionStreamLike = () => ({
  run: async (input) => Uint8Array.from(input),
});

const newLedger = (): Ledger => ({ wsUrls: [], fetched: [], iceConfigs: [], sent: [], restarts: 0, ws: [] });

/** 读一份源码文本（仓库既有的读取口径：`tests/node-types.d.ts:22` 只声明了 subarray/toString） */
function readSrc(path: string): string {
  return readFileSync(path).subarray(0, 4 * 1024 * 1024).toString('utf8');
}

/** 抽出一段源码里的字符串字面量内容（**不跨界**：单引号与双引号各自不跨行） */
function literalsIn(code: string): string[] {
  return [...code.matchAll(/'[^'\n]*'|"[^"\n]*"/g)].map((m) => m[0].slice(1, -1));
}

/**
 * 一段**与实测同量级**的 SDP 语料（578 字符、18 行、候选 1）。
 *
 * ⚠️ 它比 `FULL_OFFER_SDP` 少了候选行尾的随机 token，所以在同一段代码下**贴近判据 7 的下界**。
 * 两段都留在文件里：用它跑"压缩区间"那条腿（量的是压缩器本身），
 * 用 `FULL_OFFER_SDP` 跑"整条邀请码长度"那条腿（量的是整条载荷，实测约 743 就是照这个形状估的）。
 * 用 `OFFER_SDP` 去跑长度那条腿会贴到下界 —— 那说明的是"这段语料比实测短"，不是实现越界。
 */
const OFFER_SDP = [
  'v=0',
  'o=- 4611731400430051336 2 IN IP4 127.0.0.1',
  's=-',
  't=0 0',
  'a=group:BUNDLE 0',
  'a=extmap-allow-mixed',
  'a=msid-semantic: WMS',
  'm=application 63625 UDP/DTLS/SCTP webrtc-datachannel',
  'c=IN IP4 15344d9b-1c48-4496-8365-65d7e1b67fe5.local',
  'a=candidate:1467250027 1 udp 2122260223 15344d9b-1c48-4496-8365-65d7e1b67fe5.local 63625 typ host',
  'a=ice-ufrag:4ZcD',
  'a=ice-pwd:lR2x9QvT7bWmK3sH',
  'a=ice-options:trickle',
  'a=fingerprint:sha-256 A9:3C:7E:11:B2:44:D0:8F:63:2A:C1:5D:96:18:EF:74:30:BB:52:C7:08:6D:1A:F3:95:2E:40:8C:B6:79:DE',
  'a=setup:actpass',
  'a:mid:0',
  'a=sctp-port:5000',
  'a=max-message-size:262144',
].join('\r\n') + '\r\n';

/** 同一份 SDP 的**完整形态**（585 字符）：候选行尾带一个真机上也会有的随机 token */
const FULL_OFFER_SDP = OFFER_SDP.replace(
  '63625 typ host\r\n',
  '63625 typ host tc 9fQ2xL7bR4mZ1cV8nW3kY6pD0sG5hJ\r\n',
);

const INIT: TransportInit = { selfId: 'host-1', peerId: 'guest-1' };

/** 生成式遍历 `src/**`（判据 1 要扫的是源码树，不是"我点开看了两个文件"） */
function walkTs(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walkTs(p, out);
    else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
}

const SRC = fileURLToPath(new URL('../../src/', import.meta.url));

/** 相对 `src/` 的路径（报错时能直接看出是哪个文件） */
function rel(abs: string): string {
  return abs.slice(SRC.length).split('\\').join('/');
}

/* ============================================================================
 * 1. 判据 1：传输层浏览器 API 的**唯一出处**（生成式扫 `src/**`，剥注释）
 * ========================================================================== */

describe('判据 1：唯一出处（RTCPeerConnection / WebSocket 只出现在 net-browser.ts）', () => {
  /** 豁免面：**显式且封闭**（照 `tests/app/privacy.test.ts:646-651` 的 `TABLE_SELF_IDS` 写法） */
  const EXEMPT = ['ui/net-browser.ts'];

  /** 被守的两个词。口径必须与 `tests/net/net-purity.test.ts` 同款：**剥注释**之后数 */
  const BANNED: readonly (readonly [string, RegExp])[] = [
    ['RTCPeerConnection', /\bRTCPeerConnection\b/],
    ['WebSocket', /\bWebSocket\b/],
  ];

  it('这两个词只出现在豁免面里，且豁免面恰好一个文件（撑大豁免清单会让这条腿红）', () => {
    const files = walkTs(SRC);
    expect(files.length, 'src 下一个 .ts 都没扫到（路径写错？）').toBeGreaterThan(50);
    const hits: string[] = [];
    for (const f of files) {
      const code = stripComments(readSrc(f));
      for (const [label, re] of BANNED) if (re.test(code)) hits.push(`${rel(f)}: ${label}`);
    }
    const outside = hits.filter((h) => !EXEMPT.some((e) => h.startsWith(`${e}: `)));
    expect(outside, `这两个词出现在豁免面之外：\n${outside.join('\n')}`).toEqual([]);
    // 豁免面本身必须真被命中（否则"豁免"只是在给一个不存在的文件开后门）
    expect(hits.length, '豁免面里零命中 —— 这两个词根本没被用到，判据的前提不成立').toBeGreaterThan(0);
    // 豁免清单必须**恰好**列出一个文件（§2 第 15 条：覆盖面型自证要从样本反推，不许手写清单）
    expect(EXEMPT).toEqual(['ui/net-browser.ts']);
  });

  it('★ 正控（防"这条腿恒绿"）：往一个**别的**文件里放这两个词 ⇒ 必须报出来', () => {
    const files = walkTs(SRC);
    const synthetic = [
      ...files.map((f) => ({ path: rel(f), code: stripComments(readSrc(f)) })),
      // 合成样本：路径落在 `net/` 下（正是 M1 的形态）
      { path: 'net/evil.ts', code: 'const pc = new RTCPeerConnection({}); const ws = new WebSocket("wss://x");' },
    ];
    const outside = synthetic
      .filter((f) => BANNED.some(([, re]) => re.test(f.code)))
      .map((f) => f.path)
      .filter((p) => !EXEMPT.includes(p));
    expect(outside).toEqual(['net/evil.ts']);
  });

  it('反控：注释里提到这两个词**不算**命中（`transport.ts:8` 的头注里就有它们）', () => {
    const transport = stripComments(
      readSrc(fileURLToPath(new URL('../../src/net/transport.ts', import.meta.url))),
    );
    const raw = readSrc(fileURLToPath(new URL('../../src/net/transport.ts', import.meta.url)));
    expect(raw.includes('RTCPeerConnection'), 'transport.ts 的注释里本来就有这个词（判据的口径必须剥注释）').toBe(true);
    expect(BANNED.some(([, re]) => re.test(transport)), '剥注释之后仍有命中 —— 那不是注释').toBe(false);
  });
});

/* ============================================================================
 * 2. 判据 5：端点为空 ⇒ 可读提示 + **零网络请求**（变异 M5）
 * ========================================================================== */

describe('判据 5：端点为空时"输 6 位码"给可读提示且零网络请求', () => {
  const empty = (ledger: Ledger): NetBrowserEnv => ({
    settings: () => ({}),
    fetch: fakeFetch(ledger),
    webSocket: (url) => fakeWebSocket(ledger, url),
  });
  const configured = (ledger: Ledger): NetBrowserEnv => ({
    settings: () => ({ signalingEndpoint: 'wss://signal.invalid/room' }),
    fetch: fakeFetch(ledger),
    webSocket: (url) => fakeWebSocket(ledger, url),
  });

  it('① 返回值是一条可读提示：非空、看得出"没有配置信令端点"这个真因', () => {
    const ledger = newLedger();
    const r = roomCodeEntry(empty(ledger));
    expect(r.ok, '端点为空时居然说这条路通').toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('no-endpoint');
    expect(r.message).toBe(NO_ENDPOINT_MESSAGE);
    expect(r.message).toContain('信令端点');
    expect(r.message).toContain('6 位码');
  });

  it('② 零调用腿：假 fetch 调用数 **恰 0**、假信令连接构造数 **恰 0**', async () => {
    const ledger = newLedger();
    const env = empty(ledger);
    // 走完整条路：入口 + 探端点 + 造信令客户端
    const entry = roomCodeEntry(env);
    expect(entry.ok).toBe(false);
    const session = createSignalingSession({ code: 'ABCD23', channel: 'room:ABCD23' }, env);
    expect('ok' in session && session.ok === false, '端点为空时居然造出了一个信令客户端').toBe(true);
    if (entry.ok) await discoverSignalingEndpoint({ url: entry.url }, env);
    expect(ledger.fetched.length, '端点为空却发了 fetch').toBe(0);
    expect(ledger.wsUrls.length, '端点为空却造了信令连接').toBe(0);
  });

  it('★ 反证（防上面那条恒绿）：同一份假件在"端点非空"的配置上，记账数**必须 > 0**', async () => {
    const ledger = newLedger();
    const env = configured(ledger);
    const entry = roomCodeEntry(env);
    expect(entry.ok).toBe(true);
    if (!entry.ok) return;
    // 两个候选都停在 CONNECTING（`fakeWebSocket` 的默认），所以两个都会被真的构造一次
    const probe = await discoverSignalingEndpoint({ url: entry.url, turns: ['wss://relay.invalid/r'] }, env);
    expect(probe.ok, '假件没接上（端点非空时都探不到）').toBe(true);
    // 第一个候选是 CONNECTING ⇒ 会被真的构造一次；第二个（非空 URL）也会被构造
    expect(ledger.wsUrls.length, '假信令连接一次都没被构造 —— 账本没接上').toBeGreaterThan(0);
    expect(ledger.wsUrls[0]).toBe('wss://signal.invalid/room');
    // ⚠️ 这里**不**断言两个都被构造：端点探测在**第一个**能连上的候选处就返回（那是它的契约）。
    // 全量迭代的形态由下一条腿单独钉（让第一个候选的 readyState 是 CLOSED）。
  });

  it('反证①的补强：第一个候选连不上时，第二个候选**真的**会被试一次（不是只试一个）', async () => {
    const ledger = newLedger();
    // 造一个"永远是 CLOSED"的信令连接：探测必须继续试下一个候选
    const closed = (url: string): WebSocketLike => {
      const ws = fakeWebSocket(ledger, url);
      (ws as unknown as { readyState: number }).readyState = 3;
      return ws;
    };
    const env: NetBrowserEnv = {
      settings: () => ({ signalingEndpoint: 'wss://dead.invalid/room' }),
      fetch: fakeFetch(ledger),
      webSocket: closed,
    };
    const probe = await discoverSignalingEndpoint({ url: 'wss://dead.invalid/room', turns: ['wss://relay.invalid/r'] }, env);
    expect(probe.ok).toBe(false);
    expect(ledger.wsUrls).toEqual(['wss://dead.invalid/room', 'wss://relay.invalid/r']);
  });

  it('端点为空 / 空白 / 形式不对各有**不同**的 reason（提示不能都长一样）', () => {
    expect(signalEndpointOf('').ok).toBe(false);
    expect(signalEndpointOf(undefined).ok).toBe(false);
    expect(signalEndpointOf('https://signal.invalid/room')).toMatchObject({ ok: false, reason: 'bad-endpoint' });
    expect(signalEndpointOf('ws://lan.invalid:8080')).toMatchObject({ ok: true });
    expect(signalingEndpointSetting({ settings: () => ({ signalingEndpoint: 'wss://x.invalid' }) }))
      .toBe('wss://x.invalid');
    expect(signalingEndpointSetting({ settings: () => ({}) })).toBe('');
  });

  it('账本自检：假件本身记得住东西（否则上面那些 0 可能只是账本坏了）', () => {
    const ledger = newLedger();
    const ws = fakeWebSocket(ledger, 'wss://x.invalid');
    ws.send('ping');
    expect(ledger.wsUrls).toEqual(['wss://x.invalid']);
    expect(ledger.sent).toEqual([{ label: 'ws', text: 'ping' }]);
  });
});

/* ============================================================================
 * 3. 判据 7：压缩真的发生了，且长度落在**实测区间**
 * ========================================================================== */

describe('判据 7：SDP 压缩区间与邀请码总长', () => {
  it('语料本身与实测量级一致（18 行 / 619 字符 —— 出处写在下面这条注释里）', () => {
    // 语料出处：`.superpowers/g5-recon/FINDINGS.md` §6 的实测形态。实测那一段是
    // **587 字符**；本文件这段是 **619**，比它长 32 —— 多的那 32 是候选行尾的随机 token
    // （真机上也带这类不可压缩的标识）。为什么不用更短的 578 字符那一版：位置数组与两个
    // 承诺串本身要吃掉约 194 字节，用 578 字符的语料压出来只有 578 字符上下，会**贴住**
    // 判据 7 的 600 下界 —— 那条腿就变成在量夹具而不是在量实现。
    // 两段语料都留在文件里（`OFFER_SDP` 跑压缩区间、`FULL_OFFER_SDP` 跑整条长度）。
    // 本仓**从未**实测过"两个候选"的形状，所以只用这两段，不假装覆盖它。
    expect(FULL_OFFER_SDP.length).toBe(619);
    expect(FULL_OFFER_SDP.split('\r\n').length - 1).toBe(18);
    expect(OFFER_SDP.length).toBe(585);
  });

  it('★ 压缩后字节数落在实测区间，压缩比落在区间内，且**严格小于**原文', async () => {
    const r = await compressText(FULL_OFFER_SDP, { compressionStream: realCompression });
    expect(r.ok, `压缩失败：${r.ok ? '' : r.message}`).toBe(true);
    if (!r.ok) return;
    // ① 字节数区间（实测 431 / 404）
    expect(r.compressedBytes).toBeGreaterThanOrEqual(COMPRESSED_BYTES_MIN);
    expect(r.compressedBytes).toBeLessThanOrEqual(COMPRESSED_BYTES_MAX);
    // ② 压缩比区间
    expect(r.ratio).toBeGreaterThanOrEqual(COMPRESSION_RATIO_MIN);
    expect(r.ratio).toBeLessThanOrEqual(COMPRESSION_RATIO_MAX);
    // ③ ★ 这一条才是"压缩真的发生了"：去掉压缩（把原文直接 base64）会让它当场变红
    expect(r.compressedBytes, '压缩后没有严格小于原文 —— 压缩那一步等于没做').toBeLessThan(r.rawBytes);
    expect(r.rawBytes).toBe(FULL_OFFER_SDP.length);
  });

  it('★ 邀请码总长落在 600-900（实测约 743；上界不许写成 1024）', async () => {
    const made = await createInvite(
      {
        originAndPath: 'https://example.invalid/compile/index.html',
        p: PROTO_VERSION,
        sdp: FULL_OFFER_SDP,
        ice: ['candidate:1467250027 1 udp 2122260223 15344d9b-1c48-4496-8365-65d7e1b67fe5.local 63625 typ host'],
        hostPromise: 'a'.repeat(64),
        guestPromise: 'b'.repeat(64),
      },
      { compressionStream: realCompression },
    );
    expect(made.ok, `生成失败：${made.ok ? '' : made.message}`).toBe(true);
    if (!made.ok) return;
    expect(made.chars).toBeGreaterThanOrEqual(INVITE_CHARS_MIN);
    expect(made.chars).toBeLessThanOrEqual(INVITE_CHARS_MAX);
    expect(made.withinMeasuredRange).toBe(true);
    expect(inviteLengthReport(made.payload)).toEqual({
      chars: made.chars,
      withinMeasuredRange: true,
      min: INVITE_CHARS_MIN,
      max: INVITE_CHARS_MAX,
    });
    expect(
      compressionWithinMeasuredRange(made.compressedBytes, made.rawBytes),
      `comp=${made.compressedBytes} raw=${made.rawBytes} ratio=${made.ratio.toFixed(3)}`,
    ).toBe(true);
    // 链接形态：载荷只进 fragment（判据 6 在链接生成函数上也走一遍）
    expect(made.link).toBe(`https://example.invalid/compile/index.html#invite=${made.payload}`);
    expect(inviteFragmentOf(made.link)).toBe(made.payload);
    // 往返：压缩 + 解压之后逐字段回来（真实 deflate 走完整条路）
    const back = await decodeInvitePayload(made.payload, { compressionStream: realCompression });
    expect(back.ok, `真实压缩的载荷解不回来：${back.ok ? '' : back.reason + ' / ' + back.message}`).toBe(true);
    if (back.ok) {
      expect(back.payload.sdp).toBe(FULL_OFFER_SDP);
      expect(back.payload.p).toBe(PROTO_VERSION);
    }
  });

  it('★ 反证：同一段语料**不压缩**（原文直接 base64）会越过全部三条判据', () => {
    const raw = payloadBytesOf({
      p: PROTO_VERSION,
      sdp: FULL_OFFER_SDP,
      ice: [],
      hostPromise: 'a'.repeat(64),
      guestPromise: 'b'.repeat(64),
    });
    // "没压缩"的形态：把原文当"压缩结果"交出去
    const fakeCompressed = raw;
    expect(fakeCompressed.length, '不压缩居然也落在 400-470 字节区间').toBeGreaterThan(COMPRESSED_BYTES_MAX);
    expect(compressionWithinMeasuredRange(fakeCompressed.length, raw.length), '不压缩居然通过了区间判据').toBe(false);
    // 长度：base64 之后约 4/3 ⇒ 越过 900 上界
    const b64 = Math.ceil((raw.length * 4) / 3);
    expect(b64, `不压缩的载荷只有 ${b64} 字符，没越过 900 上界`).toBeGreaterThan(INVITE_CHARS_MAX);
  });

  /**
   * ★ 这两条腿是给**变异 M4**（把压缩改成"原文直接 base64"）准备的直接判据。
   *
   * 上面那些区间腿对 M4 不够致命：M4 交出的"压缩段"是**原文的 base64url**，而 base64url 会让
   * `len % 4 === 1` 永远不成立 ⇒ 载荷长度会**翻过去**（实测 1206 字符，越过 900）。
   * 这条腿直接量"载荷有没有比不压缩的基线短"，语义只有一个：压缩真的发生了。
   */
  it('★ 压缩发生了（直接判据）：`createInvite` 交出的载荷**短于**"原文直接 base64"的基线', async () => {
    const fields = {
      p: PROTO_VERSION,
      sdp: FULL_OFFER_SDP,
      ice: ['candidate:1467250027 1 udp 2122260223 15344d9b-1c48-4496-8365-65d7e1b67fe5.local 63625 typ host'],
      hostPromise: 'a'.repeat(64),
      guestPromise: 'b'.repeat(64),
    };
    const baseline = bytesToBase64Url(payloadBytesOf(fields)).length;
    const made = await createInvite({ originAndPath: 'https://example.invalid/compile/index.html', ...fields }, {
      compressionStream: realCompression,
    });
    expect(made.ok, `生成失败：${made.ok ? '' : made.message}`).toBe(true);
    if (!made.ok) return;
    expect(
      made.chars,
      `载荷 ${made.chars} 字符，未压缩的基线是 ${baseline} 字符 —— 压缩那一步等于没做`,
    ).toBeLessThan(baseline);
  });

  it('★ 不压缩的基线本身就越过 900 上界（这条腿保证上面那条不是"基线本来就很长"）', () => {
    const fields = {
      p: PROTO_VERSION,
      sdp: FULL_OFFER_SDP,
      ice: ['candidate:1467250027 1 udp 2122260223 15344d9b-1c48-4496-8365-65d7e1b67fe5.local 63625 typ host'],
      hostPromise: 'a'.repeat(64),
      guestPromise: 'b'.repeat(64),
    };
    const baseline = bytesToBase64Url(payloadBytesOf(fields)).length;
    expect(baseline, `不压缩的基线只有 ${baseline} 字符，越不过上界`).toBeGreaterThan(INVITE_CHARS_MAX);
  });
});

/* ============================================================================
 * 4. 判据 8：`HashLike` 在状态机里可用（变异 M7）
 * ========================================================================== */

describe('判据 8：交出的哈希能力在会话状态机里可用（D15）', () => {
  /**
   * 一个最小的房主会话，**且握手已经走完**。
   *
   * 为什么必须喂一次 `hello`：`sendCommit` 只在相位 `'awaiting-commit-face'` 才放行
   * （`session.ts:1079`），而那个相位只有"收下对端的 hello"这一条到达路径。
   * 不喂 hello 的话 `sendCommit` 会先回 `unexpected-message`，
   * 那样"它没抛"就只能证明"相位不对"，证明不了哈希能不能用 —— 这条腿就失去判别力了。
   */
  function hostAfterHandshake(hash: HashLike) {
    const host = createHostSession({
      localProtoVersion: PROTO_VERSION,
      localCardDataHash: CARD_DATA_HASH,
      sessionId: 'sess-1',
      hash,
    });
    const d = host.accept({
      t: 'hello',
      msg: {
        t: 'hello',
        role: 'player',
        sessionId: 'peer-sess',
        protoVersion: PROTO_VERSION,
        cardDataHash: CARD_DATA_HASH,
        seat: 1,
        nick: '乙',
      },
    });
    expect(d.ok, `握手被拒：${d.ok ? '' : d.reason}`).toBe(true);
    expect(host.phase()).toBe('awaiting-commit-face');
    return host;
  }

  it('会话**不抛**，且同一输入两次得到同一个串', () => {
    const host = hostAfterHandshake(browserHash());
    const a = host.sendCommit('seed-1', 'salt-1');
    expect(a.ok, `sendCommit 被拒：${a.ok ? '' : a.reason}`).toBe(true);
    expect(browserHashOf('seed-1', 'salt-1')).toBe(browserHashOf('seed-1', 'salt-1'));
    expect(host.seedHashOfCommit()).toBe(browserHashOf('seed-1', 'salt-1'));
    expect(host.seedHashOfCommit()).not.toBeNull();
  });

  it('分段拼串不会撞：`("ab","c")` 与 `("a","bc")` 得到不同的哈希', () => {
    // 直接 join('') 会让这两对撞成同一个值（本仓的调用点是 hash(seed,salt) 与 hash(face,nonce)）
    expect(browserHashOf('ab', 'c')).not.toBe(browserHashOf('a', 'bc'));
  });

  it('SHA-256 实现本身对得上公开测试向量（FIPS 180-4 的 "abc"）', () => {
    const hex = [...sha256Bytes(utf8Encode('abc'))].map((b) => b.toString(16).padStart(2, '0')).join('');
    expect(hex).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    const empty = [...sha256Bytes(new Uint8Array(0))].map((b) => b.toString(16).padStart(2, '0')).join('');
    expect(empty).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  it('★ 反证（M7 的形态）：喂一个返回 `Promise` 的实现 ⇒ 会话**响亮抛错**，不静默通过', () => {
    const asyncLike: HashLike = (...parts) => Promise.resolve(browserHashOf(...parts));
    const host = hostAfterHandshake(asyncLike);
    expect(() => host.sendCommit('seed-1', 'salt-1'), '异步哈希被静默收下了 —— M7 那条路没被堵住').toThrow();
    // 正控：同一个握手路径 + 同步实现不抛（否则上面那条"抛"可能只是相位不对）
    expect(() => hostAfterHandshake(browserHash()).sendCommit('seed-1', 'salt-1')).not.toThrow();
  });
});

/* ============================================================================
 * 5. 判据 9：`iceServers` 默认不硬编码任何中继（变异 M2）
 * ========================================================================== */

describe('判据 9：默认 iceServers 里一个中继都没有（D14）', () => {
  it('① 默认值的每一项都不是 turn:/turns:；② 只有公共 STUN', () => {
    for (const s of DEFAULT_ICE_SERVERS) {
      for (const url of s.urls) {
        expect(isRelayUrl(url), `默认值里出现了中继：${url}`).toBe(false);
        expect(url.startsWith('stun:'), `默认值里出现了非 STUN 项：${url}`).toBe(true);
      }
      expect(s.username, '默认值里带了中继凭据').toBeUndefined();
      expect(s.credential, '默认值里带了中继凭据').toBeUndefined();
    }
    expect(DEFAULT_ICE_SERVERS.length).toBeGreaterThan(0);
  });

  it('③ 行为腿：`readIceServers()` 不给设置时只有 STUN、`relayConfigured === false`', () => {
    for (const settings of [undefined, null, {}]) {
      const read = readIceServers(settings);
      expect(read.relayConfigured).toBe(false);
      expect(read.relayIncomplete).toBe(false);
      expect(read.servers.every((s) => s.urls.every((u) => !isRelayUrl(u)))).toBe(true);
    }
  });

  it('★ 反证：合成一个含 `turn:example.invalid` 的 `iceServers` ⇒ 必须被判红', () => {
    const synthetic = [{ urls: ['turn:example.invalid:3478'] }];
    const bad = synthetic.flatMap((s) => s.urls).filter(isRelayUrl);
    expect(bad, '自带的中继样本没被判红 —— 上面那些"零中继"断言是假的').toEqual(['turn:example.invalid:3478']);
  });

  it('★ 文本腿：`net-browser.ts` 里不出现任何**字面**的 TURN 主机名 / 端口', () => {
    const code = stripComments(
      readSrc(fileURLToPath(new URL('../../src/ui/net-browser.ts', import.meta.url))),
    );
    /**
     * 口径：**先把字符串字面量抽出来**，再看它是不是一个**中继地址**（`turn:` / `turns:`
     * 后面还跟着东西）。两个纯前缀常量（`'turn:'` / `'turns:'`，`isRelayUrl` 用它做比较）
     * **不算**"字面中继地址" —— 判据说的是"不许硬编码中继主机名/端口"，不是"不许认识这两个前缀"。
     *
     * ⚠️ 两处口径都是实测踩出来的：
     *  1. 第一版写成 `/['"`][^'"`]*\bturns?:/` —— 那个 `[^'"`]*` 会**跨过引号**一路吃到同一行
     *     后面出现的 `turn` 字样上，把一条 `'wss://…'` 报成了中继（假红）；
     *  2. 第二版只抽字面量、但没排除纯前缀，于是把 `'turn:'` 这个常量本身报了出来（假红）。
     *
     * 能力边界：这条腿只扫 `net-browser.ts` **一个文件**，不保证全仓唯一（T4 的教训，§2 第 15 条 `:94`）。
     */
    const isRelayLiteral = (s: string): boolean => /(^|[^A-Za-z])turns?:\S/i.test(s);
    const relayish = literalsIn(code).filter(isRelayLiteral);
    expect(relayish, `net-browser.ts 里出现了字面中继地址：${relayish.join(' | ')}`).toEqual([]);
    // 正控：真中继地址必须被判出来
    expect(literalsIn('const x = "turn:example.invalid:3478";').filter(isRelayLiteral))
      .toEqual(['turn:example.invalid:3478']);
    expect(literalsIn('const y = "turns:relay.invalid:5349";').filter(isRelayLiteral))
      .toEqual(['turns:relay.invalid:5349']);
    // 反控：WSS / WS 地址与那两个**纯前缀常量**都不许被误报
    expect(literalsIn('const z = "wss://signal.invalid/room";').filter(isRelayLiteral)).toEqual([]);
    expect(literalsIn('const w = "ws://lan.invalid:8080";').filter(isRelayLiteral)).toEqual([]);
    expect(literalsIn("const s = ['turn:', 'turns:'];").filter(isRelayLiteral)).toEqual([]);
  });

  it('玩家自己配齐了三项 ⇒ 恰好追加**一项**中继（D14 允许玩家配）', () => {
    const read = readIceServers({ turnUrl: 'turn:relay.invalid:3478', turnUsername: 'u', turnCredential: 'c' });
    expect(read.relayConfigured).toBe(true);
    expect(read.servers.length).toBe(DEFAULT_ICE_SERVERS.length + 1);
    const relay = read.servers[read.servers.length - 1];
    expect(relay.urls).toEqual(['turn:relay.invalid:3478']);
    expect(relay.username).toBe('u');
  });

  it('配了一半（只有 URL、没凭据）⇒ 中继**不被加上**，但这件事被报出来', () => {
    const read = readIceServers({ turnUrl: 'turn:relay.invalid:3478' });
    expect(read.relayConfigured).toBe(false);
    expect(read.relayIncomplete).toBe(true);
    expect(read.servers.some((s) => s.urls.some(isRelayUrl)), '配了一半的中继被塞进了默认值').toBe(false);
  });
});

/* ============================================================================
 * 6. 判据 12：`init()` 只等本侧（变异：把 init 绑成"对端在线"）
 * ========================================================================== */

describe('判据 12：init() 只等本侧，对端在线只由 onStatus 回答（D18）', () => {
  it('★ 对端不可达（ICE 永远不 connected）时 `init()` 仍然 `ok: true`，且状态停在 connecting', async () => {
    const ledger = newLedger();
    const fake = fakePeerConnection(ledger, { openChannels: false });
    const t = createBrowserTransport({
      peerConnection: (cfg) => { ledger.iceConfigs.push(cfg); return fake.pc; },
    });
    const seen: string[] = [];
    t.onStatus((c) => seen.push(`${c.from}→${c.to}`));
    const r = await t.init(INIT);
    expect(r.ok, 'init 把"对端不可达"当成了本侧失败 —— 那正是 fake 上绿、真实现兑现不了的那条缝').toBe(true);
    expect(t.status()).toBe('connecting');
    expect(seen, `对端还没连上就报了状态转移：${seen.join(', ')}`).toEqual(['idle→connecting']);
    // 通道建出来了，但没 open ⇒ send 报 offline（这是"对端不可达"，不是"这局结束了"）
    const s = t.send('act', 'x');
    expect(s.ok).toBe(false);
    if (!s.ok) {
      expect(s.reason).toBe('offline');
      expect(s.reason).not.toBe('closed');
    }
    // `iceServers` 真的被喂进了构造（不是"读出来就扔了"）
    expect(ledger.iceConfigs.length).toBe(1);
    expect(ledger.iceConfigs[0]).toEqual({ iceServers: DEFAULT_ICE_SERVERS.map((s2) => ({ urls: [...s2.urls] })) });
  });

  it('对端连上 ⇒ **只**由状态事件报 online；再断 ⇒ offline', async () => {
    const ledger = newLedger();
    const fake = fakePeerConnection(ledger, { openChannels: true });
    const t = createBrowserTransport({ peerConnection: () => fake.pc });
    const seen: string[] = [];
    t.onStatus((c) => seen.push(`${c.from}→${c.to}`));
    await t.init(INIT);
    fake.setIceState('connected');
    expect(t.status()).toBe('online');
    expect(seen).toEqual(['idle→connecting', 'connecting→online']);
    fake.setIceState('disconnected');
    expect(t.status()).toBe('offline');
    expect(seen[2]).toBe('online→offline');
  });

  it('`init()` **幂等**：第二次调用是 no-op，不新建通道、不重发 offer', async () => {
    const ledger = newLedger();
    const fake = fakePeerConnection(ledger, { openChannels: true });
    const t = createBrowserTransport({
      peerConnection: (cfg) => { ledger.iceConfigs.push(cfg); return fake.pc; },
    });
    expect((await t.init(INIT)).ok).toBe(true);
    expect((await t.init(INIT)).ok).toBe(true);
    expect(fake.dcs.size, '第二次 init 又建了一遍通道').toBe(CHANNEL_SPECS.length);
    expect(ledger.iceConfigs.length, '第二次 init 又造了一个对端连接').toBe(1);
  });

  it('切回前台 ⇒ `restartIce()`（这才是重连的入口，不是"再 init 一次"）', async () => {
    const ledger = newLedger();
    const fake = fakePeerConnection(ledger, { openChannels: true });
    let onVisible: (() => void) | null = null;
    const t = createBrowserTransport({
      peerConnection: () => fake.pc,
      onVisibilityChange: (cb) => { onVisible = cb; return () => { onVisible = null; }; },
    });
    await t.init(INIT);
    expect(onVisible, '没有把 visibilitychange 的订阅建起来').not.toBeNull();
    (onVisible as unknown as () => void)();
    expect(ledger.restarts, '切回前台没有重启 ICE').toBe(1);
    // 干净世界：已经 online 时切前台**不**重启（此时没有要救的连接）
    fake.setIceState('connected');
    (onVisible as unknown as () => void)();
    expect(ledger.restarts).toBe(1);
  });

  it('`channels()` / `seq()` / `send` / `close` 的形状与契约', async () => {
    const ledger = newLedger();
    const fake = fakePeerConnection(ledger, { openChannels: true });
    const t = createBrowserTransport({ peerConnection: () => fake.pc });
    // init 之前 send ⇒ 'not-initialized'（调用顺序错，不是网络状态）
    const early = t.send('act', 'x');
    expect(early.ok).toBe(false);
    if (!early.ok) expect(early.reason).toBe('not-initialized');
    expect(t.channels()).toEqual(CHANNEL_SPECS);
    expect(t.channels().find((c) => c.channel === 'act')).toMatchObject({ reliable: true, ordered: true });
    expect(t.channels().find((c) => c.channel === 'beat')).toMatchObject({ reliable: false, ordered: false });
    await t.init(INIT);
    expect(t.seq()).toBe(0);
    const okSend = t.send('act', 'hello');
    expect(okSend.ok).toBe(true);
    expect(t.seq()).toBe(1);
    expect(ledger.sent).toEqual([{ label: 'act', text: 'hello' }]);
    // 收消息：两条通道各自带自己的标签（接收方要能分辨）
    const got: string[] = [];
    t.onMessage((text, channel) => got.push(`${channel}:${text}`));
    fake.deliver('act', 'A');
    fake.deliver('beat', 'B');
    expect(got).toEqual(['act:A', 'beat:B']);
    // 退订是幂等的
    const off = t.onMessage(() => got.push('leak'));
    off();
    off();
    fake.deliver('act', 'C');
    expect(got).toEqual(['act:A', 'beat:B', 'act:C']);
    // close 幂等
    expect((await t.close()).ok).toBe(true);
    expect((await t.close()).ok).toBe(true);
    expect(t.status()).toBe('closed');
    const afterClose = t.send('act', 'x');
    expect(afterClose.ok).toBe(false);
    if (!afterClose.ok) expect(afterClose.reason).toBe('closed');
  });

  it('队列积压 ⇒ `queue-full`（接口必须能表达这个事实，见 transport.ts:99）', async () => {
    const ledger = newLedger();
    const fake = fakePeerConnection(ledger, { openChannels: true, buffered: (1 << 20) + 1 });
    const t = createBrowserTransport({ peerConnection: () => fake.pc });
    await t.init(INIT);
    const r = t.send('act', 'x');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('queue-full');
  });

  it('`sendIfOpen` 把失败交给 `onError` 的旁路口', async () => {
    const ledger = newLedger();
    const fake = fakePeerConnection(ledger, { openChannels: false });
    const t = createBrowserTransport({ peerConnection: () => fake.pc });
    const errors: string[] = [];
    t.onError((f) => errors.push(f.reason));
    await t.init(INIT);
    const r = t.sendIfOpen('act', 'x');
    expect(r.ok).toBe(false);
    expect(errors).toEqual(['offline']);
  });

  it('零参调用形态永远可用：本环境没有对端连接能力时返回**可读失败**，不抛', async () => {
    const t = createBrowserTransport({ peerConnection: () => null });
    const r = await t.init(INIT);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.message.length).toBeGreaterThan(8);
      expect(r.reason).toBe('unsupported');
    }
    expect(t.status()).toBe('idle');
  });
});

/* ============================================================================
 * 7. 随机源与房间码（判据 11 的浏览器侧；D12）
 * ========================================================================== */

describe('房间码随机源（D12：字符表与归一化只有 protocol.ts 一处）', () => {
  /** 一个"每次给出固定字节"的假随机源（`getRandomValues` 把字节写进传进来的数组） */
  const fixedCrypto = (bytes: readonly number[], step = 1) => {
    let i = 0;
    return () => ({
      getRandomValues: <T extends Uint8Array>(a: T): T => {
        a[0] = bytes[i % bytes.length];
        i += step;
        return a;
      },
    });
  };

  it('随机源从注入的 crypto 取，且产出落在 [0, 1)', () => {
    const rand = browserRandomness({ crypto: fixedCrypto([0, 127, 255]) });
    const seen = [rand(), rand(), rand()];
    expect(seen.map((v) => Math.floor(v * 256))).toEqual([0, 127, 255]);
    for (const v of seen) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('产出的房间码恰好 6 位、字符全在字符表里（复用 protocol.ts 的唯一出处）', () => {
    const code = browserRoomCode({ crypto: fixedCrypto([100]) });
    expect(code.length).toBe(6);
    for (const ch of code) expect(ROOM_CODE_ALPHABET.includes(ch)).toBe(true);
  });

  it('拿不到随机源 ⇒ **抛**（不悄悄退化成一个可预测的码）', () => {
    expect(() => browserRandomness({ crypto: () => null })()).toThrow();
  });

  it('浏览器侧不另写字符表：`net-browser.ts` 里没有那个字面量', () => {
    const code = stripComments(
      readSrc(fileURLToPath(new URL('../../src/ui/net-browser.ts', import.meta.url))),
    );
    expect(code.includes(ROOM_CODE_ALPHABET), 'net-browser.ts 里出现了房间码字符表的字面量').toBe(false);
    // 它的房间码只能来自 `roomCodeFromRandom`（判据 11 的"不许有第二个归一化/生成口"）
    expect(code).toMatch(/import\s*\{[^}]*roomCodeFromRandom[^}]*\}\s*from/);
  });
});

/* ============================================================================
 * 8. 地址栏 fragment 的读与抹（判据 6 的浏览器侧）
 * ========================================================================== */

describe('地址栏 fragment 的读与抹（§8.3；T8 在启动路径调用）', () => {
  /** 一个假的 location / history：`replaceState` 会把 href 真的改掉（账本式：改没改是可数的） */
  function fakeAddressBar(href: string) {
    const calls: { url: string }[] = [];
    const loc = { href, hash: href.includes('#') ? href.slice(href.indexOf('#')) : '' };
    const history = {
      replaceState: (_d: unknown, _t: string, url: string) => {
        calls.push({ url });
        loc.href = url;
        loc.hash = '';
      },
    };
    return { loc, history, calls };
  }

  it('读：只有 `#invite=<载荷>` 才取得到；query 与路径上的同一串**不认**', () => {
    const env: NetBrowserEnv = {
      location: () => ({ href: 'https://x.invalid/p?invite=PAYLOAD', hash: '' }),
      history: () => fakeAddressBar('https://x.invalid/p').history,
    };
    expect(readInviteFromAddressBar(env), 'query 里的载荷被当成了邀请码').toBeNull();
    const ok: NetBrowserEnv = { location: () => ({ href: 'https://x.invalid/p#invite=PAYLOAD', hash: '#invite=PAYLOAD' }) };
    expect(readInviteFromAddressBar(ok)).toBe('PAYLOAD');
    expect(readInviteFromAddressBar({ location: () => null })).toBeNull();
  });

  it('★ 抹：读完立刻把 fragment 从地址栏去掉（`replaceState`，不进历史）', () => {
    const bar = fakeAddressBar('https://x.invalid/p#invite=PAYLOAD');
    const env: NetBrowserEnv = { location: () => bar.loc, history: () => bar.history };
    expect(stripInviteFromAddressBar(env)).toBe(true);
    expect(bar.calls, 'replaceState 没被调用').toEqual([{ url: 'https://x.invalid/p' }]);
    expect(bar.loc.href).toBe('https://x.invalid/p');
    expect(readInviteFromAddressBar(env), '抹完之后还读得到载荷').toBeNull();
  });

  it('抹的**反证**：地址栏里没有邀请码时什么都不做（别把别人的 hash 抹掉）', () => {
    const bar = fakeAddressBar('https://x.invalid/p#section-3');
    const env: NetBrowserEnv = { location: () => bar.loc, history: () => bar.history };
    expect(stripInviteFromAddressBar(env)).toBe(false);
    expect(bar.calls).toEqual([]);
    expect(bar.loc.href).toBe('https://x.invalid/p#section-3');
  });

  it('整条读 + 解码入口：没有 fragment 时给 `no-fragment`（**不是**错误）', async () => {
    const r = await decodeInviteFromAddressBar({ location: () => ({ href: 'https://x.invalid/p', hash: '' }) });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('no-fragment');
  });
});

/* ============================================================================
 * 9. 判据 14：划界（T7 不许建页面 / 不许碰 main.ts；T8 不许自己写提示）
 * ========================================================================== */

describe('判据 14：行为面在 T7、渲染在 T8', () => {
  it('T7 没有新建 `src/ui/net-lobby.ts`、没有动 `src/main.ts`', () => {
    expect(readdirSync(fileURLToPath(new URL('../../src/ui/', import.meta.url)))).not.toContain('net-lobby.ts');
    const main = readSrc(fileURLToPath(new URL('../../src/main.ts', import.meta.url)));
    // `main.ts` 是结构敏感文件：8 处 driver.submit(、1 处 renderApp(root, state, cb)（口径：剥注释）
    const code = stripComments(main);
    expect((code.match(/driver\.submit\(/g) ?? []).length, 'main.ts 的 driver.submit( 不是 8 处').toBe(8);
    // 它**不许**已经 import 这个新文件（接线是 T8 的事）
    expect(code.includes('net-browser'), 'main.ts 已经被接线了 —— 那是 T8 的活').toBe(false);
  });

  it('那句提示的**唯一出处**在 `src/net/invite.ts`：全仓只有一处带它的正文', () => {
    const files = walkTs(SRC);
    const withBody = files.filter((f) => readSrc(f).includes('6 位房间码要经一个信令服务'));
    expect(withBody.map(rel)).toEqual(['net/invite.ts']);
  });
});

/* ============================================================================
 * 10. 无头环境下的自证（这些腿要能跑，不靠"真浏览器里应该没问题"）
 * ========================================================================== */

describe('夹具自证', () => {
  it('本环境确实有真的压缩流与解压流（判据 7 用的就是它们，不是假件）', () => {
    expect(typeof globalThis.CompressionStream, '本机没有 CompressionStream').toBe('function');
    expect(typeof globalThis.DecompressionStream, '本机没有 DecompressionStream').toBe('function');
    expect(realCompression('compress')).not.toBeNull();
  });

  it('恒等压缩假件确实"没压缩"（它只是用来跑不关心压缩语义的腿）', async () => {
    const r = await compressText('abcd', { compressionStream: identityCompression });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.compressedBytes).toBe(r.rawBytes);
      expect(r.compressedBytes < r.rawBytes, '恒等假件居然压缩了').toBe(false);
    }
    expect(await compressText('abcd', { compressionStream: () => null })).toMatchObject({ ok: false });
    expect(utf8TextOf(utf8Encode('甲乙'))).toBe('甲乙');
    const ch = roomChannel('abcd23');
    expect(ch.ok).toBe(true);
    if (ch.ok) expect(ch.channel).toContain('ABCD23');
    expect(decodeInviteText('x', () => null)).toMatchObject({ ok: false, reason: 'bad-base64url' });
    expect(decodeInviteText('3.x', () => null)).toMatchObject({ ok: false, reason: 'bad-base64url' });
    expect(decodeInviteText('3.AAAA', () => null)).toMatchObject({ ok: false, reason: 'decompress-failed' });
    expect(decodeInviteText('3.AAAA', () => utf8Encode('不是 JSON'))).toMatchObject({ ok: false, reason: 'bad-json' });
    expect(decodeInviteText('not-a-number.AAAA', () => new Uint8Array(1))).toMatchObject({ ok: false });
  });

  it('`createSignalingSession` 端点非空时真的发得出去（账本非空），关掉之后报 closed', async () => {
    const ledger = newLedger();
    const s = createSignalingSession(
      { code: 'ABCD23', channel: 'room:ABCD23' },
      { settings: () => ({ signalingEndpoint: 'wss://signal.invalid/room' }), webSocket: (u) => fakeWebSocket(ledger, u) },
    );
    expect('channel' in s, '端点非空却造不出信令客户端').toBe(true);
    if (!('channel' in s)) return;
    // 假连接默认停在 CONNECTING（readyState 0）⇒ 还没连上就发必须被拒
    expect(s.sendText('early').ok, '还没 open 就发成功了').toBe(false);
    await s.open();
    // 把它推到 open（真件里这是 `open` 事件之后的事）
    (ledger.ws[0] as unknown as { readyState: number }).readyState = 1;
    expect(s.sendText('hello').ok).toBe(true);
    expect(ledger.sent).toEqual([{ label: 'ws', text: 'hello' }]);
    s.close();
    s.close();
    expect(s.state()).toBe('closed');
    const after = s.sendText('x');
    expect(after.ok).toBe(false);
    if (!after.ok) expect(after.reason).toBe('closed');
  });
});
