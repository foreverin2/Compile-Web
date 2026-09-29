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
  INVITE_CHARS_MAX_UNCOMPRESSED,
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
  COMPRESSION_FALLBACK,
  createBrowserTransport,
  createInvite,
  createSignalingSession,
  decodeInviteFromAddressBar,
  decodeInvitePayload,
  discoverSignalingEndpoint,
  inviteLengthReport,
  isRelayUrl,
  probeCompressionFormat,
  readableCompressionFailureText,
  readIceServers,
  relayUnavailableNoteOf,
  turnSettingsAreDefault,
  defaultTurnShape,
  readInviteFromAddressBar,
  readCompressionMode,
  roomCodeEntry,
  sha256Bytes,
  signalEndpointOf,
  signalingEndpointSetting,
  stripInviteFromAddressBar,
  utf8TextOf,
  type CompressionStreamLike,
  type CompressionStreamMode,
  type CompressionFormat,
  type DecompressFormat,
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
 * 一个**真实**的压缩流假件：用 Node 22 自带的 `CompressionStream`。
 *
 * 为什么这不算"假"：它就是浏览器里的同一个 API（本机 Node 22.22.2 实测
 * `typeof CompressionStream === 'function'`）。用它量出来的字节数才是真的 deflate 输出，
 * 而不是"假件编出来的数字"。
 *
 * ★ **G5/T40**：**方向由模式串自己带**（`'decompress'` 或 `'gzip+'` 那类带 `+` 的名字），
 * 格式名也由它带。所以本假件只有一个入参 —— 第二个参数只是为了让老调用点那两个字
 * （`'compress'` / `'decompress'`）继续可读，**不参与判定**。
 */
const realCompression: (mode?: CompressionStreamMode) => CompressionStreamLike | null =
  (mode = 'compress') => {
    const read = readCompressionMode(mode);
    const Ctor = read.decompress ? globalThis.DecompressionStream : globalThis.CompressionStream;
    if (Ctor === undefined) return null;
    return {
      run: async (input) => {
        // `Uint8Array` 的 `buffer` 在 TS 5.7+ 的泛型里是 `ArrayBufferLike`，而 `BlobPart` 只要
        // `ArrayBufferView<ArrayBuffer>` —— 这一处必须显式断言（本仓没有 `@types/node`，不能用别的手段）
        const piped = new Blob([input as unknown as BlobPart]).stream().pipeThrough(new Ctor!(read.format));
        return new Uint8Array(await new Response(piped).arrayBuffer());
      },
    };
  };

/**
 * ★★ **G5/T40：一台"照用户真机那样坏掉一半"的压缩流假件**（判据 ①②④ 的锚点）。
 *
 * 形态来自**真机体检原文**（协调侧 `probe.html`，两台平板、Chromium 97）：
 * `deflate-raw` **FAIL**（原文 `Failed to construct 'CompressionStream': Unsupported
 * compression format: 'deflate-raw'`），而 `deflate` / `gzip` **OK**（含解压侧）。
 *
 * 它**真抛**那句原文（不是返回 null）：这正是必须被降级链接住、且**不许**进界面的那种失败。
 */
function chromium97Compression(
  unsupported: readonly CompressionFormat[] = ['deflate-raw'],
): (mode?: CompressionStreamMode) => CompressionStreamLike | null {
  return (mode = 'compress') => {
    const read = readCompressionMode(mode);
    if (unsupported.includes(read.format)) {
      throw new TypeError(`Failed to construct 'CompressionStream': Unsupported compression format: '${read.format}'`);
    }
    return realCompression(mode);
  };
}

/**
 * 一个**恒等**的压缩流假件：压缩原样交回（只用在"不关心压缩语义"的腿上）。
 *
 * ⚠️ **解压那一路必须落到真件**：恒等的"解压"会把"仍是压缩态的字节"当解压结果交出去，
 * 而 `createInvite` 的自洽检查会当场把它判成 `bad-json`（实测踩过）。老代码里
 * `decompressBytes` 写死走 `'decompress'` 所以没暴露；T40 起解压也走这个注入缝。
 */
const identityCompression: (mode?: CompressionStreamMode) => CompressionStreamLike = (mode = 'compress') =>
  (readCompressionMode(mode).decompress ? realCompression(mode) : null) ?? {
    run: async (input) => Uint8Array.from(input),
  };

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
        sessionId: 'sid-00000000000000000000000000000000',
        hostPromise: 'a'.repeat(64),
        guestPromise: 'b'.repeat(64),
        // ★ G6/T49：这一条腿钉的是 **600-900 那一档（v2，整段 SDP 进载荷）** 的实测区间。
        //   紧凑档（v3，缺省）另有它自己那一组区间，见 `tests/net/invite-compact.test.ts`。
        payloadFormat: 'full',
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
      sessionId: 'sid-00000000000000000000000000000000',
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
      sessionId: 'sid-00000000000000000000000000000000',
      hostPromise: 'a'.repeat(64),
      guestPromise: 'b'.repeat(64),
    };
    const baseline = bytesToBase64Url(payloadBytesOf(fields)).length;
    const made = await createInvite({ originAndPath: 'https://example.invalid/compile/index.html', ...fields, payloadFormat: 'full' }, {
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
      sessionId: 'sid-00000000000000000000000000000000',
      hostPromise: 'a'.repeat(64),
      guestPromise: 'b'.repeat(64),
    };
    const baseline = bytesToBase64Url(payloadBytesOf(fields)).length;
    expect(baseline, `不压缩的基线只有 ${baseline} 字符，越不过上界`).toBeGreaterThan(INVITE_CHARS_MAX);
  });

  /**
   * ★ 编码侧那条"压出来的必须解得动"的自洽检查必须**有牙**
   * （补的是评审 §7.1 挑出来的那条恒真缝）。
   *
   * 评审实测：原来那个"解压口"写的是 `(c) => (c === c.bytes ? raw : null)` —— 同一性检查，
   * 一份**真解不开**的 40 字节当"压缩件"照样放行。现在 `createInvite` 先
   * `await decompressBytes()` 真解一遍；下面两条腿用一个"压出来的是垃圾"的假压缩流
   * 从**小 `createInvite` 的公开口**打进去，断言它必须响亮失败。
   */
  describe('★ 编码侧的自洽检查有牙（坏的压缩结果不许放行）', () => {
    /**
     * 一个"压出来解不回来"的压缩流：**压缩是真 deflate**（所以降级链会认这一档），
     * 但解压交回 40 字节垃圾（所以"压出来的必须解得动"这条自洽检查必须把它拦下）。
     *
     * ★ T40 起这里必须做成**格式/方向感知**的：压缩那一路收到格式名（`deflate-raw` 等），
     * 解压那一路收到的是带 `+` 的格式名（`deflate-raw+` 等，见 `DecompressFormat`）。
     */
    const garbageCompression = (mode: CompressionStreamMode = 'compress'): CompressionStreamLike | null => {
      if (readCompressionMode(mode).decompress) {
        return { run: async () => Uint8Array.from({ length: 40 }, (_, i) => (i * 37) % 256) };
      }
      // 压缩：真 deflate（用真件），这样"压得出"这一条成立、失败的只能是"解不回来"
      return realCompression(mode);
    };

    it('压缩流交出的字节真解不开 ⇒ `createInvite` 给**可读失败**，不静默产出一条坏邀请码', async () => {
      const made = await createInvite(
        {
          originAndPath: 'https://example.invalid/compile/index.html',
          p: PROTO_VERSION,
          sdp: FULL_OFFER_SDP,
          ice: [],
          sessionId: 'sid-00000000000000000000000000000000',
          hostPromise: 'a'.repeat(64),
          guestPromise: 'b'.repeat(64),
        },
        { compressionStream: garbageCompression },
      );
      expect(made.ok, '解不开的压缩结果被放行了 —— 那条自洽检查是恒真的').toBe(false);
      if (made.ok) return;
      expect(made.reason).toBe('compress-failed');
      expect(made.message.length, '失败信息不可读').toBeGreaterThan(8);
    });

    it('反控：同一条路用**真**压缩流必须成功（否则上面那条只是恒失败）', async () => {
      const made = await createInvite(
        {
          originAndPath: 'https://example.invalid/compile/index.html',
          p: PROTO_VERSION,
          sdp: FULL_OFFER_SDP,
          ice: [],
          sessionId: 'sid-00000000000000000000000000000000',
          hostPromise: 'a'.repeat(64),
          guestPromise: 'b'.repeat(64),
        },
        { compressionStream: realCompression },
      );
      expect(made.ok, `真压缩流被拒了：${made.ok ? '' : made.message}`).toBe(true);
    });
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

  /**
   * ★ 这一条是判据 8 的**牙**（补的是评审 §3.1 挑出来的清单外变异 M9）。
   *
   * 评审实测：把 `browserHashOf` 的前缀去掉、摘要截短到 8 位十六进制，**返回值仍然是字符串**
   * ⇒ 判据 8 原来的两条腿（"是 string 不是 Promise" + "两次一样"）**46/46 全绿、一条不红**。
   * 也就是说这一族缺陷（"动作发生了、语义没发生"：算了点东西，但不是一枚摘要）当时没人看。
   *
   * 下面三条腿钉形状：前缀 + **恰好 64 位**十六进制 + 真摘要（对得上 FIPS 180-4 的公开向量）。
   */
  it('★ 哈希串的**形状**：`browser-sha256:` + 恰好 64 位小写十六进制', () => {
    const out = browserHashOf('seed-1', 'salt-1');
    expect(out, `哈希串的形状不对：${JSON.stringify(out)}`).toMatch(/^browser-sha256:[0-9a-f]{64}$/);
    // 逐段也各查一遍（前缀与位数分开报，红了能一眼看出是哪一处）
    expect(out.startsWith('browser-sha256:'), '前缀丢了').toBe(true);
    expect(out.slice('browser-sha256:'.length)).toHaveLength(64);
    // 反控：这条形状腿**能红**（否则它可能是恒真的）
    expect('abc').not.toMatch(/^browser-sha256:[0-9a-f]{64}$/);
    expect('browser-sha256:00112233').not.toMatch(/^browser-sha256:[0-9a-f]{64}$/);
    expect(`browser-sha256:${'g'.repeat(64)}`).not.toMatch(/^browser-sha256:[0-9a-f]{64}$/);
  });

  it('★ 那 64 位真的是 SHA-256 的摘要（对得上公开向量，不是随手拼的十六进制）', () => {
    // `hash('abc')` 的摘要部分必须等于 FIPS 180-4 的 SHA-256("abc")
    const one = browserHashOf('abc');
    expect(one.slice('browser-sha256:'.length))
      .toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    // 两段拼接用的是 `\u0000` 分隔符：`('ab','c')` 的摘要 != SHA-256("abc")
    expect(browserHashOf('ab', 'c')).not.toBe(browserHashOf('abc'));
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
 * 5. 判据 9：默认 `iceServers` 里**必须**有一项带凭据的中继（G5/T38 裁决变了）
 *
 * ## ★★ 裁决为什么变（不许为了让它绿而把默认里的中继删掉）
 *
 * 原判据 9（判据："默认值的每一项都不是 `turn:` / `turns:`"）在 T38 **之前**是对的：
 * 那时中继只能由玩家自配，所以"默认里不许出现 `turn:`"等价于"程序不偷偷替玩家接一台中继"。
 * 用户 2026-09-25 的裁决与协调者的外网实测把事实改了：默认就要带 `8.130.97.243` 那台
 * coturn（"连不上时走服务器"必须在**默认路径**上存在，玩家零填写）。
 * ⇒ 判据 9 的**意图照旧钉住**（默认值不许偷偷接一台**来路不明**的中继），
 * 钉的形态换成三条：① 默认里必有一项中继、主机就是这台服务器；② 它必须带凭据；
 * ③ 玩家自己配的中继仍然只由 `readIceServers` 追加（默认数组里不出现玩家那一项）。
 * ========================================================================== */

describe('判据 9（T38 重钉）：默认 iceServers 里必须有一台带凭据的服务器中继', () => {
  /** 这一份 `iceServers` 里的中继 URL（判定只认 `isRelayUrl` 这一个出处） */
  const relayUrlsIn = (servers: readonly { readonly urls: readonly string[] }[]): string[] =>
    servers.flatMap((s) => s.urls).filter(isRelayUrl);

  it('① 默认里恰好一项中继，主机就是这台已实测通过的服务器；② 它**不带**凭据（T50：凭据运行时换）', () => {
    const relays = DEFAULT_ICE_SERVERS.filter((s) => s.urls.some(isRelayUrl));
    expect(relays.length, '默认值里应当恰好有一项中继（多一项就要人工复核一次）').toBe(1);
    const relay = relays[0];
    const url = relay.urls.find(isRelayUrl) ?? '';
    expect(url, `默认中继的地址不是这台服务器：${url}`).toContain('8.130.97.243');
    expect(url).toContain(':3478');
    /**
     * ★★ **T50：这一条的裁决翻了**（T38 的原话是"它**必须**带凭据"）。
     *
     * T38 的正确性建立在"凭据可以内联在前端"上；T50（B1）把那个前提**否掉**了：内联的永久
     * 密码就是白嫖的入口。现在的口径是"这一份数组里**只有地址**，凭据由 `readIceServers`
     * 从签发服务换来的那一份合上"。
     *
     * ⇒ 这条腿改成钉**相反**的事（防有人又把静态凭据写回来）；"带凭据"改由下面那条
     * 行为腿（喂一份服务端凭据 ⇒ 中继真的带上它）来钉。
     */
    expect(relay.username, '默认中继里又内联了用户名（T50：凭据不许进前端）').toBeUndefined();
    expect(relay.credential, '默认中继里又内联了凭据（T50：凭据不许进前端）').toBeUndefined();
    // ★★ T40 更正（真机读数）：**不许**再有一条指向这台服务器的 `stun:`。
    //
    // T38 时这里写的是反过来的断言（"默认里应当有一项指向它的 STUN，实测 srflx 就是它给的"）。
    // 用户真机体检（2026-09-27，Chromium 97 平板）实测：`stun:8.130.97.243:3478` 回
    // `code=701 STUN server address is incompatible`，而**同一个 `:3478`** 的 `turn:` 那项
    // 正常产出 `relay udp 8.130.97.243:49181` ⇒ T38 那句归因错了：给 srflx/relay 的是 `turn:`。
    // TURN 的分配流程本身带 Binding 请求 ⇒ 同址的 `stun:` 提供不了任何额外能力，只是每次协商
    // 多打一行 701。所以它被删掉，这条腿改成钉"删掉了"（防有人又把它加回来）。
    const stunToIt = DEFAULT_ICE_SERVERS.some((s) => s.urls.some((u) => u.startsWith('stun:8.130.97.243')));
    expect(
      stunToIt,
      '默认里又出现了一条指向这台服务器的 stun:（真机实测它回 701 且不提供额外能力，'
      + '同一端口上 turn: 那项已经给了 srflx；见 src/ui/net-browser.ts 的 DEFAULT_ICE_SERVERS 注释）',
    ).toBe(false);
  });

  /**
   * ★★ **G6/T50：凭据在运行时换**（判据 3 的正向那一半）。
   *
   * 喂一份"服务端换来了凭据"的读数 ⇒ 默认那台**带上**这份凭据、`relayConfigured: true`、
   * 来源 `builtin`、没有降级原因。这是"取得到凭据 ⇒ 走中继"在纯层上的唯一落点。
   */
  const APP_CRED = {
    available: true as const,
    source: 'app' as const,
    credential: {
      urls: ['turn:8.130.97.243:3478'],
      username: '1800000000:player',
      credential: 'synthetic-credential-value=',
      ttlSeconds: 600,
    },
  };
  const APP_SETTINGS = {
    turnUrl: '', turnUsername: '', turnCredential: '',
    appTurnUsername: APP_CRED.credential.username,
    appTurnCredential: APP_CRED.credential.credential,
  };

  it('③ 行为腿：**有服务端凭据** ⇒ 默认那台带上这份凭据（`relayConfigured: true`、来源 builtin）', () => {
    const read = readIceServers(APP_SETTINGS, false, APP_CRED);
    expect(read.relayConfigured, '换到了凭据却报"没有可用的中继"').toBe(true);
    expect(read.relayIncomplete).toBe(false);
    expect(read.relaySource, '这一份中继的来源应当是 builtin（产品那台）').toBe('builtin');
    expect(read.relayCredentialSource, '没有报"凭据是服务端换来的"').toBe('app');
    expect(read.relayUnavailableReason, '有中继却报了降级原因').toBeUndefined();
    expect(relayUrlsIn(read.servers).length, '这一份 iceServers 里应当恰好一项中继').toBe(1);
    expect(relayUrlsIn(read.servers)[0]).toContain('8.130.97.243');
    const relay = read.servers.find((s) => s.urls.some(isRelayUrl));
    expect(relay?.username, '中继那一项没带上服务端给的 username').toBe(APP_CRED.credential.username);
    expect(relay?.credential, '中继那一项没带上服务端给的 credential').toBe(APP_CRED.credential.credential);
  });

  /**
   * ★★ **G6/T50 判据 3（最重要的一条）：取不到凭据 ⇒ 降级成直连**。
   *
   * 三件事一起钉：中继**不进**列表、原因**如实报**、屏上那句话**带真因**。
   * 反证（同一份夹具换成"有凭据"）也在里面 —— 否则"降级"这件事可能是恒真的。
   */
  it('★ 降级腿：**没有凭据** ⇒ 中继那一项整个不进 iceServers，原因如实报出来', () => {
    for (const down of [
      { available: false as const, source: 'app' as const, reason: 'timeout' as const, detail: '等了 2000 毫秒没有回应' },
      { available: false as const, source: 'app' as const, reason: 'rejected' as const, detail: 'HTTP 429' },
      { available: false as const, source: 'app' as const, reason: 'unreachable' as const, detail: 'TypeError: Failed to fetch' },
      { available: false as const, source: 'app' as const, reason: 'malformed' as const, detail: '回应里缺字段或字段形状不对' },
    ]) {
      const read = readIceServers({ turnUrl: '', turnUsername: '', turnCredential: '' }, false, down);
      expect(read.relayConfigured, `取不到凭据（${down.reason}）却还报"有中继可用"`).toBe(false);
      expect(read.relaySource).toBe('none');
      expect(read.relayUnavailableReason).toBe('credential-unavailable');
      expect(read.relayCredentialFailure).toBe(down.reason);
      expect(relayUrlsIn(read.servers).length, '降级之后中继还在列表里').toBe(0);
      expect(read.servers.length, '降级之后 STUN 那几项应当照旧在').toBe(DEFAULT_ICE_SERVERS.length - 1);
      const note = relayUnavailableNoteOf(read);
      expect(typeof note === 'string' && note.length > 0, '降级了却没有可读的那句话').toBe(true);
      expect(note, '那句里没有"这一轮没有中继可用"').toContain('这一轮没有中继可用');
      expect(note, '那句里没有"只能试直连"').toContain('只能试直连');
    }
    // 反证：有凭据那一档**不许**出现降级原因与那句话（否则它是一句恒真的空话）
    const up = readIceServers(APP_SETTINGS, false, APP_CRED);
    expect(up.relayUnavailableReason, '有中继可用却报了降级原因').toBeUndefined();
    expect(relayUnavailableNoteOf(up), '有中继可用却说了"没有中继可用"').toBeNull();
    /**
     * ★★ **B1 之后（2026-09-29 上线）**：宿主"没接签发服务"（credentialRead 缺省）⇒ **没有中继**，
     * 原因是 `'not-configured'`，屏上那句话照说。
     *
     * 这一格原来是反过来的（缺省走内置静态兜底、保留中继）—— 那是 T50 到 B1 上线之间的部署安全
     * 窗口：那时候线上 coturn 还是 `lt-cred-mech`。B1 上线时那份兜底凭据与支路一起删了。
     */
    const untouched = readIceServers(undefined);
    expect(untouched.relayConfigured, '没接签发服务却没有降级').toBe(false);
    expect(untouched.relayCredentialSource, 'B1 之后不该再有内置兜底这个来源').not.toBe('builtin-fallback');
    expect(untouched.relayUnavailableReason, '没接签发服务时该报"这一份里本来就没有中继"')
      .toBe('not-configured');
    expect(relayUnavailableNoteOf(untouched), '降级了却没有可读的那句话').toContain('这一轮没有中继可用');
    // 反证：**给了**一份"取不到"的读数 ⇒ 必须降级（上面那条 for 循环已经逐条钉过四种原因）
    expect(readIceServers(undefined, false, { available: false, source: 'app', reason: 'unreachable' })
      .relayConfigured, '配了端点却取不到时还保留中继').toBe(false);
  });

  /**
   * ★★ **G6/T50 的部署安全 → B1 上线后的口径（2026-09-29）**：**端点没配 = 没有中继**。
   *
   * 这条腿原来钉的是"缺省必须有兜底，否则一发版就把线上中继弄没"（T50 到 B1 之间的部署安全
   * 窗口）。B1 上线时：签发服务在线上跑着、端点缺省改成同源 `'/turn-cred'`、coturn 换成
   * `use-auth-secret`、内置兜底凭据删掉。于是现在的判据面是三条读数：
   *  ① 端点空（`credentialRead` 缺省）⇒ `relayConfigured=false`、ICE 列表里没有 `turn:`、
   *     原因 `'not-configured'`；
   *  ② 端点指向真服务 ⇒ `relayCredentialSource='app'`（REST 那条路，见上面"有服务端凭据"那条腿）；
   *  ③ 端点指向死端口 ⇒ `relayConfigured=false`、原因 `'credential-unavailable'`。
   */
  it('★ B1 后：端点没配 ⇒ 没有中继（不再有内置兜底），只有真换到凭据才有中继', () => {
    // ① 端点空（宿主没接签发服务）
    const empty = readIceServers({});
    expect(empty.relayConfigured, '端点没配却还报"有中继可用"').toBe(false);
    expect(empty.relayCredentialSource, 'B1 之后不该再有内置兜底这个来源').not.toBe('builtin-fallback');
    expect(relayUrlsIn(empty.servers), '端点没配时 ICE 列表里不该再有那台 turn:').toEqual([]);
    expect(empty.relayUnavailableReason, '端点没配时该报"这一份里本来就没有中继"').toBe('not-configured');
    // ② 端点指向真服务 ⇒ app（REST）；③ 端点指向死端口 ⇒ 降级（原因不同）
    expect(readIceServers(APP_SETTINGS, false, APP_CRED).relayCredentialSource).toBe('app');
    const dead = readIceServers({}, false, { available: false, source: 'app', reason: 'unreachable' });
    expect(dead.relayConfigured, '配了端点却取不到时还保留中继').toBe(false);
    expect(dead.relayUnavailableReason, '取不到凭据与"没配端点"必须是两个原因').toBe('credential-unavailable');
  });

  it('★ 玩家三项齐全**优先于**产品凭据（玩家配的赢，默认那台不再出现）', () => {
    const both = readIceServers(
      { ...APP_SETTINGS, turnUrl: 'turn:mine.invalid:3478', turnUsername: 'u', turnCredential: 'c' },
      false, APP_CRED,
    );
    expect(both.relaySource, '玩家配齐了三项，来源却不是 player').toBe('player');
    expect(both.relayCredentialSource).toBe('player');
    expect(both.relayConfigured).toBe(true);
    expect(both.servers.some((s) => s.urls.some((u) => u.includes('8.130.97.243'))),
      '玩家覆盖之后默认那台还在（判据 3 的"改了就覆盖"不成立）').toBe(false);
  });

  it('★ 反证：合成一个含 `turn:example.invalid` 的 `iceServers` ⇒ 必须被判红', () => {
    const synthetic = [{ urls: ['turn:example.invalid:3478'] }];
    const bad = synthetic.flatMap((s) => s.urls).filter(isRelayUrl);
    expect(bad, '自带的中继样本没被判红 —— 上面那些"零中继"断言是假的').toEqual(['turn:example.invalid:3478']);
  });

  it('★ 文本腿（T38 重钉）：`net-browser.ts` 里的字面中继地址**恰好一个**，就是默认那台', () => {
    const code = stripComments(
      readSrc(fileURLToPath(new URL('../../src/ui/net-browser.ts', import.meta.url))),
    );
    /**
     * ## 口径（T38：这条腿的裁决也翻了——原来是"一个都不许有"）
     *
     * 旧口径（"本文件里不出现任何字面的 TURN 主机名/端口"）当时是对的：默认值里没有中继，
     * 出现字面地址就意味着"有人偷偷接了一台中继"。T38 起默认**必须**是这台服务器
     * ⇒ 口径换成"**恰好一个，且就是这个地址**"：多一个就会红（防有人又塞一台），
     * 少一个也红（防有人把默认中继悄悄删掉换门禁绿）。
     *
     * 抽取方式不变：**先把字符串字面量抽出来**，再看它是不是一个**中继地址**
     * （`turn:` / `turns:` 后面还跟着东西）。两个纯前缀常量（`'turn:'` / `'turns:'`，
     * `isRelayUrl` 用它做比较）**不算**"字面中继地址" —— 判据说的是"硬编码了哪些中继主机"，
     * 不是"不许认识这两个前缀"。
     *
     * ⚠️ 两处口径都是实测踩出来的（保留，免得后人再踩一遍）：
     *  1. 第一版写成 `/['"`][^'"`]*\bturns?:/` —— 那个 `[^'"`]*` 会**跨过引号**一路吃到同一行
     *     后面出现的 `turn` 字样上，把一条 `'wss://…'` 报成了中继（假红）；
     *  2. 第二版只抽字面量、但没排除纯前缀，于是把 `'turn:'` 这个常量本身报了出来（假红）。
     *
     * 能力边界：这条腿只扫 `net-browser.ts` **一个文件**，不保证全仓唯一（T4 的教训，§2 第 15 条 `:94`）。
     */
    const isRelayLiteral = (s: string): boolean => /(^|[^A-Za-z])turns?:\S/i.test(s);
    const relayish = literalsIn(code).filter(isRelayLiteral);
    expect(relayish, `net-browser.ts 里的字面中继地址不是恰好一个：${relayish.join(' | ')}`).toEqual([
      'turn:8.130.97.243:3478',
    ]);
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

  it('玩家自己配齐了三项 ⇒ 中继那一项**换成玩家的**（默认那台不再出现），来源标成 player', () => {
    const read = readIceServers({ turnUrl: 'turn:relay.invalid:3478', turnUsername: 'u', turnCredential: 'c' });
    expect(read.relayConfigured).toBe(true);
    expect(read.relaySource, '玩家配齐了却没标成 player（严格档会失效）').toBe('player');
    // ★ 覆盖而不是追加：条数不变，玩家那一项**顶掉**默认那一项（判据 3 的"改了就覆盖"）
    expect(read.servers.length, '覆盖之后条数变了（说明是追加而不是替换）').toBe(DEFAULT_ICE_SERVERS.length);
    const relay = read.servers[read.servers.length - 1];
    expect(relay.urls).toEqual(['turn:relay.invalid:3478']);
    expect(relay.username).toBe('u');
    expect(
      read.servers.some((s) => s.urls.some((u) => u.includes('8.130.97.243') && isRelayUrl(u))),
      '玩家改了中继地址，默认那台**还在** iceServers 里（判据 3 不成立）',
    ).toBe(false);
  });

  it('★ T38/T50：`settingsAreDefault` 与 `relaySource` 是两件事（T50 起默认预填里**没有凭据**）', () => {
    /**
     * ## 为什么这条腿非有不可
     *
     * T38 把大厅三项**预填**了 ⇒ 设置里"有内容"不再等于"玩家改过"。
     * `readIceServers` 只看内容形状 ⇒ 光看 `relaySource` 分辨不出"默认"与"玩家覆盖"。
     * 要分辨它们的是 `settingsAreDefault`（`__g5Match.ice()` 的证据面就是它）。
     *
     * ## ★★ T50 把"默认预填"的内容改了
     *
     * T38 预填的是 `{地址, 用户名, 凭据}` 三项（那对**长期**凭据就在前端里）；T50（B1）之后
     * `defaultTurnShape()` 只回**地址**，用户名与凭据是空串（凭据改由签发服务在运行时给）。
     * ⇒ 这条腿的读数跟着变：
     *  - `turnSettingsAreDefault(defaults, defaults)` 仍然为真（自己跟自己逐字相同）；
     *  - 而 `defaults` 这一份进 `readIceServers` 时**不再**是"玩家形状"（URL 在、凭据空）
     *    ⇒ `relaySource` 报的是 `'none'`（这一份里没有可用的中继），**不是** `'player'`。
     *
     * ⚠️ 对照物用**导出面**的 `defaultTurnShape()`，**不**在这里手写一份同形状的字面量：
     * 手写的那份不会跟着 `DEFAULT_ICE_SERVERS` 走，默认值一改这条腿就变成拿旧默认去比新默认。
     */
    const defaults = defaultTurnShape();
    // ① T50：默认预填里**只有地址**（凭据不许进前端 —— 判据 5）
    expect(defaults.turnUrl, '默认预填里没有中继地址了（大厅那一格会变成空框）').toContain('turn:8.130.97.243:3478');
    expect(defaults.turnUsername, 'T50 之后默认预填里不该再有用户名').toBe('');
    expect(defaults.turnCredential, 'T50 之后默认预填里不该再有凭据').toBe('');
    // ② 自己跟自己逐字相同 ⇒ "没动过"；改一个字节 ⇒ "动过"
    expect(turnSettingsAreDefault(defaults, defaults), '预填成默认值却没被判成"没动过"').toBe(true);
    expect(turnSettingsAreDefault({ turnUrl: 'turn:other.invalid:3478', turnUsername: 'u', turnCredential: 'c' }, defaults),
      '玩家改了地址却被判成"没动过"（严格档会失效）').toBe(false);
    // ③ 三项全空 / 什么都没给 ⇒ **不算**"就是默认值"（那是"没给设置"那一档，别混进来）
    expect(turnSettingsAreDefault(null, defaults), 'null 被判成了"就是默认值"').toBe(false);
    expect(turnSettingsAreDefault({}, defaults), '空设置被判成了"就是默认值"').toBe(false);
    expect(turnSettingsAreDefault({ turnUrl: '   ' }, defaults), '全空白被判成了"就是默认值"').toBe(false);
    // ④ 读数上两者分开：内容形状（relaySource）与"改没改"（settingsAreDefault）各自可读
    /**
     * ★★ **B1 之后（2026-09-29）**：这一份（URL 在、用户名/凭据空 = 玩家没动过设置的那一档形状）
     * 在**没接签发服务**时**没有中继**（`relaySource: 'none'`、原因 `'not-configured'`）。
     * 判据 9 的"配了一半"那一格另有它的腿（见上面"配了一半"那条：玩家**真的**填了 URL 才算半配）。
     */
    const asDefault = readIceServers(defaults, true);
    expect(asDefault.relaySource, '没换到凭据、玩家也没配 ⇒ 来源该是 none').toBe('none');
    expect(asDefault.relayCredentialSource, 'B1 之后不该再有内置兜底这个来源').not.toBe('builtin-fallback');
    expect(asDefault.relayConfigured, '没接签发服务却还报有中继').toBe(false);
    expect(asDefault.settingsAreDefault, 'settingsAreDefault 没有从入参透传出来').toBe(true);
    const changed = readIceServers({ turnUrl: 'turn:other.invalid:3478', turnUsername: 'u', turnCredential: 'c' }, false);
    expect(changed.relaySource).toBe('player');
    expect(changed.settingsAreDefault).toBe(false);
  });

  it('玩家没写 `turn:` 前缀 ⇒ 补上前缀（否则浏览器认不出它是中继）', () => {
    const read = readIceServers({ turnUrl: 'relay.invalid:3478', turnUsername: 'u', turnCredential: 'c' });
    expect(read.servers[read.servers.length - 1].urls).toEqual(['turn:relay.invalid:3478']);
  });

  it('配了一半（只有 URL、没凭据）⇒ 玩家那一项**不被加上**，但这件事被报出来', () => {
    /**
     * ⚠️ **T50 起这条腿要喂一份凭据读数**：不喂的话"没有中继"有两个原因
     * （玩家配了一半 / 压根没凭据），而这条腿要钉的是**前一个**（`relayIncomplete`）。
     */
    const read = readIceServers(
      { turnUrl: 'turn:relay.invalid:3478', appTurnUsername: APP_SETTINGS.appTurnUsername, appTurnCredential: APP_SETTINGS.appTurnCredential },
      false, APP_CRED,
    );
    expect(read.relayIncomplete, '"配了一半"这件事没有被报出来').toBe(true);
    /**
     * ★★ **T50：这两个读数在这一格里是分开的**（别把它们当成同一件事）：
     *  - `relayIncomplete: true` —— **判据 9 的既有语义，一字不改**："**玩家那一项**没被用上"
     *    （他填了 URL 却没填用户名/凭据），这件事必须被报出来；
     *  - `relayConfigured: true`  —— 说"**这一份 iceServers 里有一项能用的中继**"（= 服务端
     *    给的那一份），`waitForIceGathering` 的严格档读的就是它。
     *
     * 屏上那句该不该说由 `net-lobby.ts` 的 `relayStateOf` 按 `relayConfigured` **优先**判
     * （有能用的中继 ⇒ `on` ⇒ 出隐私说明），不会被 `relayIncomplete` 抢走。
     */
    expect(read.relayIncomplete, '判据 9：玩家那一项被跳过了，这件事必须被报出来').toBe(true);
    expect(read.relayConfigured, '服务端给了凭据 ⇒ 这一份里确实有可用的中继').toBe(true);
    // ★ 判据 9 的意图：不许把玩家配了一半的东西当成能用的中继加进来
    expect(read.servers.some((s) => s.urls.includes('turn:relay.invalid:3478')), '配了一半的中继被当成能用的加进来了')
      .toBe(false);
    /**
     * ★★ **T50：默认那台照旧在**（`APP_CRED` 在手 ⇒ 它带着服务端给的凭据留在列表里）——
     * "配了一半"只否掉**玩家那一项**，不该把产品那一份也一起弄丢。
     */
    expect(read.servers.some((s) => s.urls.some((u) => u.includes('8.130.97.243'))), '配了一半之后连默认中继都没了')
      .toBe(true);
    expect(read.servers.find((s) => s.urls.some(isRelayUrl))?.credential, '默认那台没带上服务端凭据')
      .toBe(APP_CRED.credential.credential);
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
    /**
     * ★★ **T50：这一格里喂进去的是"降级后"的那一份**（没有凭据读数 ⇒ 中继整个不进列表）。
     *
     * 这正是判据 3 在**产出路径**上的形态：`createBrowserTransport` 的 `init()` 里，
     * `readIceServers` 拿不到凭据 ⇒ 只把 STUN 那几项交给 `RTCPeerConnection`。
     * 旧断言逐字比的是 `DEFAULT_ICE_SERVERS`（那时默认那台自带凭据）—— 那个世界没有了。
     */
    /**
     * ★★ **B1 之后（2026-09-29）**：这一格里没有给 credentialRead ⇒ "宿主没接签发服务"
     * ⇒ **没有中继**（旧断言比的是"默认那台带着上线前兜底凭据也在列表里"，那个世界没有了）。
     */
    const cfgSeen = ledger.iceConfigs[0] as { iceServers: readonly { readonly urls: readonly string[]; readonly username?: string; readonly credential?: string }[] };
    expect(cfgSeen.iceServers.some((s2) => s2.urls.some(isRelayUrl)),
      '没接签发服务时还往 RTCPeerConnection 里塞了中继').toBe(false);
    expect(cfgSeen.iceServers.length, '降级后该只剩 STUN 那几项').toBe(DEFAULT_ICE_SERVERS.length - 1);
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
 * 9. 判据 14：划界（行为面在 T7、渲染与接线在 T8）
 *
 * ⚠️ **本轮（G5/T8）改过这一组**（计划 D24 ② 逐条授权的三处之一）。旧文本钉的是**T7 那一刻**的
 * 划界 —— "T7 没建 `net-lobby.ts`、`main.ts` 不含 net-browser"。T8 一接线，那条**必然红**，
 * 而它红得**正确**：它钉的那个"冻结期"已经结束了。
 * ⇒ 处置是按 D24 ② 把划界从"T7 冻结期"换成"T8 接线之后"，**并把结构腿那一半留着**
 *   （`driver.submit(` 的计数：T8 时 8 处，G5 T12 加了草稿选牌那一处之后 9 处）—— 它证明的是
 *   "这轮接线没有溢出到结构腿"。这不是绕过守卫：改的是"哪一刻的划界"与"那个数字跟着
 *   `src/main.ts` 的真实结构走"，不是"要不要查"。
 * ========================================================================== */

describe('判据 14：行为面在 T7、渲染与接线在 T8', () => {
  it('T8 已经接线：`src/ui/net-lobby.ts` 存在且被 `main.ts` 引用；结构腿仍为 9 处', () => {
    // ① 旧文本（T7 冻结期）：「T7 没有新建 src/ui/net-lobby.ts」
    //    新文本（T8 接线后）：这个文件**必须存在** —— 那五件义务的落点就是它
    const uiFiles = readdirSync(fileURLToPath(new URL('../../src/ui/', import.meta.url)));
    expect(uiFiles, 'T8 的落点 src/ui/net-lobby.ts 不存在（那五件义务没有地方落）').toContain('net-lobby.ts');
    const main = readSrc(fileURLToPath(new URL('../../src/main.ts', import.meta.url)));
    // `main.ts` 是结构敏感文件：9 处 driver.submit(（T8 时是 8；G5 T12 加了草稿选牌那一处，
    // 理由写在 `tests/ui/main-lobby-wiring.test.ts` 第 5 条腿上）、1 处 renderApp(root, state, cb)
    // （口径：剥注释）
    // ★ 结构腿这一半**保留着**（D24 ② 明写"保留它的另一半"）—— 变的只是那个数字，
    //   而它必须跟着 `src/main.ts` 的真实结构走，否则这条腿会变成"钉住一个过期的数字"。
    const code = stripComments(main);
    expect((code.match(/driver\.submit\(/g) ?? []).length, 'main.ts 的 driver.submit( 不是 9 处').toBe(9);
    // ② 旧文本（T7 冻结期）：「`expect(code.includes('net-browser')).toBe(false)` —— main.ts 已经被
    //    接线了，那是 T8 的活」。
    //    新文本（T8 接线后）：接线**必须已经发生**，而且必须真的把这两个模块接上 ——
    //    既 import 了浏览器层（能力的唯一出处），也 import 了大厅（渲染与路由的落点）。
    expect(code, 'main.ts 没有 import ./ui/net-browser（T8 的接线没有发生）').toContain("from './ui/net-browser'");
    expect(code, 'main.ts 没有 import ./ui/net-lobby（大厅没有接上）').toContain("from './ui/net-lobby'");
    // 反向（防"文件里出现这个词就算接线"）：第四个 `renderMode` 值必须真的存在并在 `rerender` 里被路由
    expect(code, "renderMode 的联合类型里没有第四个值 'lobby'").toContain("| 'lobby'");
    expect(code, "rerender 里没有 'lobby' 分支（大厅进不去那一帧）").toMatch(/renderMode === 'lobby'/);
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

/* ============================================================================
 * ★★ G5/T40：压缩能力的**降级链**（`deflate-raw` → `deflate` → `gzip` → 不压缩）
 *
 * 事故原文（用户 2026-09-27 截图）：`压缩没有完成: TypeError: Failed to construct
 * 'CompressionStream': Unsupported compression format: 'deflate-raw'` ⇒ 邀请码根本没生成出来。
 * 协调侧的真机体检（两台平板、**Chromium 97**）给出这台设备的三档读数：
 *   `deflate-raw` **FAIL**（就是那句原文）、`deflate` **OK**、`gzip` **OK**（含解压侧）。
 * ⇒ 下面这一组腿就用那个形状的假件（`chromium97Compression`），逐档验：
 *   ① 不许猜 UA（真构造一次才算"支持"）；
 *   ② 坏掉的那一档必须被**跳过**，落到下一档能用的（而不是跳到"不压缩"）；
 *   ③ 三档全废 ⇒ 走"不压缩"，仍然能编能解；
 *   ④ 任何分支的**界面文案里没有原始异常字样**。
 * ========================================================================== */

describe('★★ G5/T40：压缩能力降级链（真机 Chromium 97 的形状）', () => {
  /** 与判据 7 同一份字段（同一段语料） */
  const t40Fields = () => ({
    originAndPath: 'https://example.invalid/compile/index.html',
    p: PROTO_VERSION,
    sdp: FULL_OFFER_SDP,
    ice: ['candidate:1467250027 1 udp 2122260223 15344d9b-1c48-4496-8365-65d7e1b67fe5.local 63625 typ host'],
    sessionId: 'sid-00000000000000000000000000000000',
    hostPromise: 'a'.repeat(64),
    guestPromise: 'b'.repeat(64),
  });

  it('① 探测**真去构造一次**（判据不许猜 UA）：坏掉的那一档报 supported:false，好的报 true', async () => {
    const env = { compressionStream: chromium97Compression(['deflate-raw']) };
    const bad = await probeCompressionFormat('deflate-raw', env);
    expect(bad.supported, 'deflate-raw 明明抛了，却被报成"支持"').toBe(false);
    // ★ 原始异常只进读数（诊断面），文案一个字都不用它
    expect(bad.note ?? '', '探测读数里没留下原始异常串').toContain('Unsupported compression format');
    expect((await probeCompressionFormat('deflate', env)).supported).toBe(true);
    expect((await probeCompressionFormat('gzip', env)).supported).toBe(true);
    // 反控：本机（node 22 自带三个构造器）三档都应当是真的支持
    expect((await probeCompressionFormat('deflate-raw', { compressionStream: realCompression })).supported).toBe(true);
  });

  /**
   * ★★ **评审点名的"诊断口在说谎"**（T40 收尾补的腿）。
   *
   * 缺省实现把真构造**推迟到 `run()` 里** ⇒ 只调工厂的探测口对"全局构造器构造即抛"这种情况
   * **恒报 `supported: true`**（评审复跑实测）。这条腿把**全局构造器**换成用户那台设备的行为，
   * 走**零参**（= 真走 `defaultEnv()`）调探测口 ⇒ 必须报 false。
   * 它才是"这个口到底能不能探到不支持"的判据；上面那条用的是工厂即抛的假件，探不到这一层。
   */
  it('①b 把**全局构造器**打桩成"deflate-raw 构造即抛" ⇒ 探测口必须报 false（缺省 env 那条路）', async () => {
    const original = globalThis.CompressionStream;
    expect(typeof original, '本机没有 CompressionStream，这条腿没有判别力').toBe('function');
    // 用**函数**而不是 class：构造器返回一个对象会替换实例（class 的 `return` 在 TS 里过不去）
    function ThrowingForRaw(this: unknown, format: string): unknown {
      if (format === 'deflate-raw') {
        throw new TypeError("Failed to construct 'CompressionStream': Unsupported compression format: 'deflate-raw'");
      }
      return new original!(format as CompressionFormat);
    }
    (globalThis as { CompressionStream?: unknown }).CompressionStream = ThrowingForRaw;
    try {
      // 零参 ⇒ 走 `defaultEnv()` ⇒ 真构造发生在 `run()` 里（正是"说谎"那一层）
      const bad = await probeCompressionFormat('deflate-raw');
      expect(bad.supported, '全局构造器对 deflate-raw 构造即抛，探测口却报 true —— 诊断口在说谎').toBe(false);
      expect(bad.note ?? '').toContain('Unsupported compression format');
      // 反控：同一次打桩下 `deflate` 照常可用 ⇒ 上面那条不是"什么都报 false"
      expect((await probeCompressionFormat('deflate')).supported, '打桩之后连 deflate 也报不支持').toBe(true);
    } finally {
      (globalThis as { CompressionStream?: unknown }).CompressionStream = original;
    }
    // 收工后本机恢复原样
    expect((await probeCompressionFormat('deflate-raw')).supported).toBe(true);
  });

  it('② 降级链顺序写死在 COMPRESSION_FALLBACK 里（deflate-raw 先，不压缩最后）', () => {
    expect(COMPRESSION_FALLBACK).toEqual(['deflate-raw', 'deflate', 'gzip']);
  });

  it('★ 判据 ①②：`deflate-raw` 抛用户那句原文 ⇒ **仍然出码**，落在 `deflate` 档，另一端解得开', async () => {
    const env = { compressionStream: chromium97Compression(['deflate-raw']) };
    const made = await createInvite({ ...t40Fields(), payloadFormat: 'full' }, env);
    expect(made.ok, `打桩成真机形状之后竟然没出码：${made.ok ? '' : made.message}`).toBe(true);
    if (!made.ok) return;
    // 哪一档：**deflate**（不是跳过一切、也不是不压缩）
    expect(made.format, '没有落到 deflate 档（那台真机 deflate/gzip 都是 OK 的）').toBe('deflate');
    expect(made.marker).toBe('-d');
    expect(made.payload.startsWith(`${PROTO_VERSION}.-d`)).toBe(true);
    // 逐档读数：deflate-raw 那条**不可用**，deflate 那条可用
    const probes = made.probes;
    expect(probes.map((x) => x.format)).toEqual(['deflate-raw', 'deflate']);
    expect(probes[0].supported).toBe(false);
    expect(probes[0].note ?? '').toContain('Unsupported compression format');
    expect(probes[1].supported).toBe(true);
    // 长度仍落在**压缩档**的实测区间（600-900）—— 降级没有把它变成一条长码
    expect(made.withinMeasuredRange, `${made.chars} 字符越出 600-900`).toBe(true);
    // 另一端（能力齐全）解得开，且逐字一致
    const back = await decodeInvitePayload(made.payload, { compressionStream: realCompression });
    expect(back.ok, `另一端解不开这条 deflate 档的码：${back.ok ? '' : back.reason + ' / ' + back.message}`).toBe(true);
    if (back.ok) {
      expect(back.format.kind).toBe('deflate');
      expect(back.payload.sdp).toBe(FULL_OFFER_SDP);
      expect(back.payload.sessionId).toBe(t40Fields().sessionId);
    }
  });

  it('★ 只有 gzip 可用（前两档都抛）⇒ 落在 gzip 档，另一端解得开', async () => {
    const env = { compressionStream: chromium97Compression(['deflate-raw', 'deflate']) };
    const made = await createInvite({ ...t40Fields(), payloadFormat: 'full' }, env);
    expect(made.ok, `只有 gzip 可用时没出码：${made.ok ? '' : made.message}`).toBe(true);
    if (!made.ok) return;
    expect(made.format).toBe('gzip');
    expect(made.payload.startsWith(`${PROTO_VERSION}.-g`)).toBe(true);
    expect(made.probes.filter((x) => !x.supported).map((x) => x.format)).toEqual(['deflate-raw', 'deflate']);
    const back = await decodeInvitePayload(made.payload, { compressionStream: realCompression });
    expect(back.ok).toBe(true);
    if (back.ok) expect(back.format.kind).toBe('gzip');
  });

  it('★ 判据 ④：三档**全抛** ⇒ 走"不压缩"那一档，仍然能编能解，长度落在未压缩上界内', async () => {
    const env = { compressionStream: chromium97Compression(['deflate-raw', 'deflate', 'gzip']) };
    const made = await createInvite({ ...t40Fields(), payloadFormat: 'full' }, env);
    expect(made.ok, `三档全废时没出码：${made.ok ? '' : made.message}`).toBe(true);
    if (!made.ok) return;
    expect(made.format, '三档全废却没有落到"不压缩"').toBe('none');
    expect(made.payload.startsWith(`${PROTO_VERSION}.-u`)).toBe(true);
    // 未压缩变体的长度：比压缩档长得多，但仍在上界内（上界出处见 invite.ts 的常量注释）
    //
    // ★ G6/T49 改动：`withinMeasuredRange` 现在与屏上那句读数**同一口径**（"落在**这一档**的
    //   区间内"，见 `inviteLengthReportOf`）⇒ 一条 `-u` 码在 600-900 之外、在
    //   `INVITE_CHARS_MAX_UNCOMPRESSED` 之内时它是 **true**（T40 那条修复本来就该是这个语义）。
    //   旧断言（恒 false）会把"最老内核唯一能用的那一档"说成越界 —— 屏上那句话跟着一起错。
    expect(made.withinMeasuredRange, `未压缩变体 ${made.chars} 字符应当落在它自己那一档的区间内`).toBe(true);
    expect(made.withinUncompressedRange, `未压缩变体 ${made.chars} 字符越出上界`).toBe(true);
    expect(made.chars).toBeGreaterThan(INVITE_CHARS_MAX);
    // 另一端（能力齐全）必须解得开 —— "不压缩"那一档不需要任何设备能力
    const back = await decodeInvitePayload(made.payload, { compressionStream: realCompression });
    expect(back.ok, `未压缩变体另一端解不开：${back.ok ? '' : back.reason + ' / ' + back.message}`).toBe(true);
    if (back.ok) {
      expect(back.format.kind).toBe('none');
      expect(back.payload.sdp).toBe(FULL_OFFER_SDP);
      expect(back.payload.hostPromise).toBe(t40Fields().hostPromise);
    }
  });

  it('★ 判据 ③（回归）：不打桩时**仍走 deflate-raw**（老格式 `N.<base64>` 的味道没变）', async () => {
    const made = await createInvite({ ...t40Fields(), payloadFormat: 'full' }, { compressionStream: realCompression });
    expect(made.ok).toBe(true);
    if (!made.ok) return;
    expect(made.format).toBe('raw');
    // ★ "仍是 deflate-raw"这条腿：`-r` 就是它的显式标记；老读法（没有标记）也读成 raw
    expect(made.payload.startsWith(`${PROTO_VERSION}.-r`)).toBe(true);
    expect(made.withinMeasuredRange, `${made.chars} 字符越出 600-900`).toBe(true);
    expect(made.compressedBytes).toBeGreaterThanOrEqual(COMPRESSED_BYTES_MIN);
    expect(made.compressedBytes).toBeLessThanOrEqual(COMPRESSED_BYTES_MAX);
  });

  /**
   * ★★ **T40 收尾（评审点名的第 2 处）**：长度读数必须按**这条码实际用的档位**选区间。
   *
   * 修复前 `inviteLengthReport` 恒按 600-900 判 ⇒ 一条**完全正常**的 `-u` 码（1826 字符）
   * 会在屏上被说成"不在实测区间内…可能被截断" —— 而那正是**最老内核唯一能用**的那一档。
   */
  it('★ 收尾：`-u` 码的长度读数按**未压缩档**判（不再报"越出区间"）', async () => {
    const env = { compressionStream: chromium97Compression(['deflate-raw', 'deflate', 'gzip']) };
    const made = await createInvite({ ...t40Fields(), payloadFormat: 'full' }, env);
    expect(made.ok).toBe(true);
    if (!made.ok) return;
    expect(made.format, '这条腿要的是一条未压缩码').toBe('none');
    const report = inviteLengthReport(made.payload);
    expect(report.chars).toBe(made.chars);
    expect(report.chars, `未压缩码只有 ${report.chars} 字符 —— 这条腿的语料太短，失去判别力`)
      .toBeGreaterThan(INVITE_CHARS_MAX);
    expect(report.max, '区间上界不是未压缩档那一个').toBe(INVITE_CHARS_MAX_UNCOMPRESSED);
    expect(report.withinMeasuredRange, `${report.chars} 字符的正常 -u 码被判成"越出区间"`).toBe(true);
  });

  it('★ 收尾：压缩档的长度读数仍按 600-900 判（未压缩上界没有把压缩档放宽）', async () => {
    const made = await createInvite({ ...t40Fields(), payloadFormat: 'full' }, { compressionStream: realCompression });
    expect(made.ok).toBe(true);
    if (!made.ok) return;
    const report = inviteLengthReport(made.payload);
    expect(report.max, '压缩档的上界被未压缩常量顶替了').toBe(INVITE_CHARS_MAX);
    expect(report.withinMeasuredRange).toBe(true);
    // 反证：同一条压缩档的读数**仍然会**拒绝一条超长码（区间没被放宽成"永远 true"）
    const tooLong = `${PROTO_VERSION}.-r${'A'.repeat(1200)}`;
    expect(inviteLengthReport(tooLong).withinMeasuredRange, '压缩档的区间被放宽了').toBe(false);
  });

  it('★ 判据 ⑤：三档全废时那句文案是**人话** —— 没有 TypeError / Unsupported compression format 字样', () => {
    const probes = [
      { format: 'deflate-raw' as const, supported: false, note: "TypeError: Failed to construct 'CompressionStream': Unsupported compression format: 'deflate-raw'" },
      { format: 'deflate' as const, supported: false, note: "TypeError: Failed to construct 'CompressionStream': Unsupported compression format: 'deflate'" },
      { format: 'gzip' as const, supported: false, note: "TypeError: Failed to construct 'CompressionStream': Unsupported compression format: 'gzip'" },
    ];
    const msg = readableCompressionFailureText(probes);
    expect(msg).not.toContain('TypeError');
    expect(msg).not.toContain('Unsupported compression format');
    expect(msg).not.toContain('Failed to construct');
    expect(msg.length, '那句话太短，不像一句能指导下一步的话').toBeGreaterThan(20);
    // 它要能指导下一步：换浏览器
    expect(msg).toContain('浏览器');
    // 反控：读数里**仍然**保留原始异常串（诊断面不许被文案那一层抹掉）
    expect(probes.every((p) => (p.note ?? '').includes('Unsupported compression format'))).toBe(true);
  });

  it('★ 连压缩能力都没有（`compressionStream` 返回 null）⇒ 走"不压缩"那一档，**不是**报错', async () => {
    // 这条腿钉的是 T40 之后"生成失败"这件事的**边界**：降级链的最后一档不需要任何设备能力
    // ⇒ 单靠"没有 CompressionStream"已经构不成一次生成失败（这正是事故的修法想要的结果）。
    const made = await createInvite(t40Fields(), { compressionStream: () => null });
    expect(made.ok, '没有压缩能力时竟然没出码 —— 降级链最后一档没接上').toBe(true);
    if (!made.ok) return;
    expect(made.format).toBe('none');
    expect(made.probes.every((p) => !p.supported), '三档都应当是"探测失败"').toBe(true);
  });

  it('★ 判据 ⑤（失败分支）：真正的生成失败那一支，文案也是人话（界面拿到的不是原始异常）', async () => {
    // 唯一的失败路径：纯层拒绝（这里用"承诺串带空格"⇒ `bad-promise`）。
    // ⚠️ 降级链接上之后，**环境类**失败已经不再是失败（见上一条腿）⇒ 这一条钉的是文案面。
    const made = await createInvite(
      { ...t40Fields(), hostPromise: 'has space', guestPromise: 'b'.repeat(64) },
      { compressionStream: realCompression },
    );
    expect(made.ok, '承诺串带空格竟然被收下了（纯层那道形状校验没了）').toBe(false);
    if (made.ok) return;
    expect(made.message).not.toContain('TypeError');
    expect(made.message).not.toContain('Unsupported compression format');
    expect(made.message).not.toContain('Failed to construct');
    expect(made.message.length, '失败文案太短').toBeGreaterThan(8);
  });

  it('★ 判据 ⑤（兜底）：注入缝**自己抛**时，`createInvite` 收成可读失败，不把异常丢给界面', async () => {
    // 这条腿验的是 `createInvite` 里那个 try/catch（坏假件可能在这里抛）。
    // 用 getter 抛：`{...defaultEnv(), ...env}` 展开时就会炸。
    const boom = {
      get compressionStream(): never {
        throw new TypeError("Failed to construct 'CompressionStream': Unsupported compression format: 'deflate-raw'");
      },
    } as unknown as NetBrowserEnv;
    const made = await createInvite(t40Fields(), boom);
    expect(made.ok, '注入缝抛异常时竟然"成功"了').toBe(false);
    if (made.ok) return;
    expect(made.message).not.toContain('TypeError');
    expect(made.message).not.toContain('Unsupported compression format');
    expect(made.message).not.toContain('Failed to construct');
    // 原始串留在**读数**里（诊断面），不进文案
    expect(made.probes?.[0]?.note ?? '').toContain('Unsupported compression format');
  });
});

/* ============================================================================
 * ★★ G5/T40：回示码必须跟**邀请码那一档**走（`createInvite({ preferKind })`）
 *
 * 真浏览器门实测抓到的**跨机**缺陷：两端各按自己的设备能力选档时，房主那台 `deflate-raw`
 * 坏掉 ⇒ 它出 `-d` 码；而加入方那台好着 ⇒ 它产的回示码落在 `-r`（它那儿 deflate-raw 能用）
 * ⇒ **房主解不开自己那一局的回示码**（屏上"压缩段解不开"、两端停在 `handshaking`）。
 * ⇒ `preferKind` 让"产回示码"这一步照邀请码那一档走。
 * ========================================================================== */

describe('★★ G5/T40：`preferKind`（回示码跟邀请码同一档）', () => {
  const f = () => ({
    originAndPath: 'https://example.invalid/compile/index.html',
    p: PROTO_VERSION,
    sdp: FULL_OFFER_SDP,
    ice: ['candidate:1467250027 1 udp 2122260223 15344d9b-1c48-4496-8365-65d7e1b67fe5.local 63625 typ host'],
    sessionId: 'sid-00000000000000000000000000000000',
    hostPromise: 'a'.repeat(64),
    guestPromise: 'b'.repeat(64),
  });

  it('★ 指定 `deflate` ⇒ 即使这台设备 deflate-raw 可用，也用 deflate（另一端解得开）', async () => {
    const made = await createInvite({ ...f(), preferKind: 'deflate' }, { compressionStream: realCompression });
    expect(made.ok, `指定档位时没出码：${made.ok ? '' : made.message}`).toBe(true);
    if (!made.ok) return;
    expect(made.format, '指定了 deflate 却挑了别的档').toBe('deflate');
    expect(made.payload.startsWith(`${PROTO_VERSION}.-d`)).toBe(true);
    // 逐档读数里说明"这是调用方指定的档位"
    expect(made.probes.some((p) => (p.note ?? '').includes('调用方指定'))).toBe(true);
    const back = await decodeInvitePayload(made.payload, { compressionStream: realCompression });
    expect(back.ok).toBe(true);
    if (back.ok) expect(back.format.kind).toBe('deflate');
  });

  it('★ 指定档位在这台设备上**不可用** ⇒ 照旧降级（宁可换档，也不要产不出来）', async () => {
    // 房主指定的那一档在加入方这台设备上坏了 ⇒ 必须降级出码，而不是报错
    const env = { compressionStream: chromium97Compression(['deflate-raw', 'deflate']) };
    const made = await createInvite({ ...f(), preferKind: 'deflate' }, env);
    expect(made.ok, '指定档位不可用时竟然没出码（应当降级）').toBe(true);
    if (!made.ok) return;
    expect(made.format, '指定档不可用时没有降级到 gzip').toBe('gzip');
    expect(made.probes[0].supported, '第一条读数应当是"指定的档位不可用"').toBe(false);
    expect(made.probes[0].note ?? '').toContain('调用方指定的档位');
  });

  it('★ 不传 `preferKind` ⇒ 走完整降级链（本机落在 raw，回归）', async () => {
    const made = await createInvite(f(), { compressionStream: realCompression });
    expect(made.ok).toBe(true);
    if (made.ok) expect(made.format).toBe('raw');
  });
});
