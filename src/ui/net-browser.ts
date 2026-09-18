/**
 * `NetTransport` 的**浏览器实现**（G5 T7）。
 *
 * ## 为什么这个文件存在
 *
 * 计划 §2 第 3 条与裁决 D6：**传输层的浏览器 API 只许出现在这一个文件里**。
 * `src/net/**` 是纯层（分层 `ui → net → app → core`），它只能收"已经算好的不透明串"
 * （D15）。所以本文件同时住着：对端连接 + 两条数据通道、信令客户端、压缩 / 解压、
 * 哈希、房间码随机源、地址栏 fragment 的读与抹。
 *
 * ## 缝开在**参数表**上，默认才去读 `globalThis`（§0 第 5 条）
 *
 * 形状照 `src/ui/local-store-browser.ts`（`L1StoreEnv` / `defaultEnv()` / `openL1Store(env?)`）。
 * **为什么不往 `globalThis` 上打桩**：本会话栽过一次 —— `src/ui/pwa-update.ts` 把
 * `navigator.serviceWorker` 误写成 `globalThis.serviceWorker`，真实浏览器里 PWA 从不注册，
 * 而四道门禁全绿。凡是"测试里替换 `globalThis`"的做法，都证明不了产出代码读的是哪个对象。
 * ⇒ `createBrowserTransport(env?)` 的零参调用形态**必须永远可用**，可选参数只为注入假件。
 *
 * ## ★ 哈希是**同步**的（D15 的落地，判据 8）
 *
 * `crypto.subtle.digest` 是**异步**的，而 `src/net/session.ts` 的状态机**在任何地方都不 `await`**
 * （它的 `requireHash` 拿到 `Promise` 会当场抛错，见 `session.ts:412-418`）。
 * 所以"把异步摘要直接透传"是一条**必然踩中**的错路 —— 变异 M7 就是它。
 * 本文件因此自带一份**同步的 SHA-256**（纯位运算，零依赖）。
 *
 * ## 这里不做什么
 *
 *  - **不动 `src/main.ts`**（§2 第 11 条的结构敏感文件）：本文件只出工厂，接线是 T8；
 *  - **不建页面**：短码入口那句可读提示的**文案本体**在 `src/net/invite.ts`（唯一出处），
 *    本文件只负责"端点为空时把它返回出来、并且一个网络请求都不发"；
 *  - **不实现二维码**（D17）；
 *  - **不写 TURN 隐私文案**：那句已经存在于 `src/app/privacy.ts:111`（D22），本文件一个字都不写。
 */

import {
  CHANNEL_SPECS,
  channelSpec,
  type NetChannel,
  type NetChannelSpec,
  type NetTransport,
  type SendFailure,
  type SendResult,
  type StatusChange,
  type TransportActionResult,
  type TransportInit,
  type TransportStatus,
} from '../net/transport';
import { roomCodeFromRandom } from '../net/protocol';
import type { HashLike } from '../net/session';
import {
  COMPRESSED_BYTES_MAX,
  COMPRESSED_BYTES_MIN,
  COMPRESSION_RATIO_MAX as COMPRESSION_RATIO_MAX_K,
  COMPRESSION_RATIO_MIN as COMPRESSION_RATIO_MIN_K,
  INVITE_CHARS_MAX,
  INVITE_CHARS_MIN,
  NO_ENDPOINT_MESSAGE,
  base64UrlToBytes,
  bytesToBase64Url,
  decodeInvite,
  decodeInviteText,
  encodeInvite,
  inviteFragmentOf,
  inviteLinkOf,
  payloadBytesOf,
  roomCodeEntryReachability,
  utf8Decode,
  utf8Encode,
  type InviteDecodeResult,
  type InviteFields,
} from '../net/invite';

/* ================================================================== *
 * 1. 环境的结构面（最小：只用得着的那几个成员）
 * ================================================================== */

/**
 * 真实 `RTCDataChannel` 的**最小结构面**。
 *
 * 为什么不用 TS 内置的 DOM 类型：与本仓既有的 `StorageLike`（`local-store-browser.ts:49`）
 * 同一条理由 —— 结构面越小，假件越容易与真件同形。本仓 `tsconfig` 的 `lib` 里有没有 DOM
 * 是另一回事，**不要**让产出代码依赖它一定能用。
 */
export interface DataChannelLike {
  readonly label: string;
  readonly readyState: string;
  /** 真件上恒有；假件可以不实现（可选 ⇒ 两边同形，不会逼测试伪造一个用不上的字段） */
  readonly bufferedAmount?: number;
  send(data: string): void;
  close(): void;
  addEventListener(type: 'open' | 'close' | 'error' | 'message', cb: (ev: unknown) => void): void;
}

/** 真实 `RTCPeerConnection` 的最小结构面（含 `restartIce`：计划 §5 T7 的交付物之一） */
export interface PeerConnectionLike {
  readonly connectionState?: string;
  readonly iceConnectionState?: string;
  readonly localDescription?: { readonly sdp: string; readonly type: string } | null;
  createDataChannel(label: string, init?: { ordered?: boolean; maxRetransmits?: number }): DataChannelLike;
  createOffer(): Promise<{ readonly sdp?: string; readonly type: string }>;
  setLocalDescription(desc: { readonly type: string; readonly sdp?: string }): Promise<void>;
  /** 对端描述（answer / offer）。收方把它喂进来 */
  setRemoteDescription?(desc: { readonly type: string; readonly sdp?: string }): Promise<void>;
  restartIce?(): void;
  close(): void;
  addEventListener(type: string, cb: (ev: unknown) => void): void;
}

/** 真实 `WebSocket` 的最小结构面（信令客户端用） */
export interface WebSocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(): void;
  addEventListener(type: 'open' | 'close' | 'error' | 'message', cb: (ev: unknown) => void): void;
}

/** `WebSocket.readyState` 的两个取值（DOM 规范的固定值；不引内置常量对象，避免依赖 DOM 类型） */
const WS_CONNECTING = 0;
const WS_OPEN = 1;

/** `Crypto.getRandomValues` 的最小结构面 */
export interface CryptoLike {
  getRandomValues<T extends Uint8Array>(array: T): T;
}

/** `location` 的最小结构面（fragment 的**读**） */
export interface LocationLike {
  readonly href: string;
  hash: string;
}

/** `history` 的最小结构面（fragment 的**抹**）。只用到 `replaceState` 一种能力 */
export interface HistoryLike {
  replaceState(data: unknown, title: string, url: string): void;
}

/** 玩家设置里与传输层有关的那几项。**全部可缺省**，缺省即"没配"（D14） */
export interface NetSettingsLike {
  /** 信令端点（`wss://…` / `ws://…`）。**默认没有**：本程序默认不向任何服务器发请求（§8.1） */
  readonly signalingEndpoint?: string;
  /** TURN 中继的 URL。**默认没有**：本程序不内置任何中继（D14） */
  readonly turnUrl?: string;
  readonly turnUsername?: string;
  readonly turnCredential?: string;
}

/**
 * `iceServers` 里一项的形状（`RTCIceServer` 的最小面）。
 *
 * `urls` 是数组（DOM 规范就是 `string | string[]`）：本文件的默认值给每一项**恰好一个** URL，
 * 判据 9 的"每一项都不是 turn:/turns:"因此是逐项可数的。
 */
export interface IceServerLike {
  readonly urls: readonly string[];
  readonly username?: string;
  readonly credential?: string;
}

/** 注入缝的参数表：**只放"环境"**，本文件只读它、不写它 */
export interface NetBrowserEnv {
  /**
   * 造一个对端连接。入参是 `iceServers`（D14：从设置读，默认只给公共 STUN）——
   * 传**动作**而不是现成对象，理由照 `L1StoreEnv.localStorage`：读 `globalThis.X`
   * 这件事本身就可能抛，而"抛"正是最该被兜住的一种环境。
   */
  readonly peerConnection?: (config: { readonly iceServers: readonly IceServerLike[] }) => PeerConnectionLike | null;
  /** 造一个信令连接（WebSocket）的动作。**只有端点非空时才会被调用**（§8.1） */
  readonly webSocket?: (url: string) => WebSocketLike | null;
  /**
   * 造一个**压缩流**的动作（`deflate-raw`）。
   *
   * 入参是"压"还是"解"，由本文件两处实现决定；假件据此返回一个能立刻给出结果的流。
   * 真实实现走 `CompressionStream` / `DecompressionStream` + `Blob` + `Response`。
   */
  readonly compressionStream?: (mode: 'compress' | 'decompress') => CompressionStreamLike | null;
  readonly crypto?: () => CryptoLike | null;
  readonly location?: () => LocationLike | null;
  readonly history?: () => HistoryLike | null;
  /** 读设置的**动作**（不是值本身）。缺省 = 没有任何设置 ⇒ 端点为空、无中继 */
  readonly settings?: () => NetSettingsLike | null;
  /** HTTP 探针（"这个信令端点通不通"）。**只有端点非空时**才会被调用 */
  readonly fetch?: (url: string) => Promise<{ readonly ok: boolean; readonly status: number }>;
  /** 挂 `visibilitychange` 的订阅动作，返回退订函数（切回前台 ⇒ `restartIce()`） */
  readonly onVisibilityChange?: (cb: () => void) => () => void;
}

/**
 * 压缩 / 解压流的最小结构面。
 *
 * 真件是浏览器内置的 `CompressionStream` / `DecompressionStream`；本文件把"把字节喂进去、
 * 把字节收回来"这一段写在一个地方（`runThroughStream`），于是假件只需要给出**结果字节**。
 */
export interface CompressionStreamLike {
  run(input: Uint8Array): Promise<Uint8Array>;
}

type EnvGlobal = {
  RTCPeerConnection?: new (config: unknown) => PeerConnectionLike;
  WebSocket?: new (url: string) => WebSocketLike;
  CompressionStream?: new (format: string) => unknown;
  DecompressionStream?: new (format: string) => unknown;
  Blob?: new (parts: readonly Uint8Array[]) => { stream(): unknown };
  Response?: new (body: unknown) => { arrayBuffer(): Promise<ArrayBuffer> };
  crypto?: CryptoLike;
  location?: LocationLike;
  history?: HistoryLike;
};

function g(): EnvGlobal {
  return globalThis as unknown as EnvGlobal;
}

/**
 * 缺省环境：**真浏览器里才去读 `globalThis`**，且读取延迟到调用时求值
 * （照 `local-store-browser.ts:71-73` 的 `defaultEnv()`）。
 */
function defaultEnv(): NetBrowserEnv {
  return {
    peerConnection: (config) => {
      const Ctor = g().RTCPeerConnection;
      if (Ctor === undefined) return null;
      return new Ctor(config);
    },
    webSocket: (url) => {
      const Ctor = g().WebSocket;
      if (Ctor === undefined) return null;
      return new Ctor(url);
    },
    compressionStream: (mode) => {
      const Ctor = mode === 'compress' ? g().CompressionStream : g().DecompressionStream;
      if (Ctor === undefined) return null;
      return {
        run: async (input) => {
          const stream = new Ctor(mode === 'compress' ? 'deflate-raw' : 'deflate-raw');
          const BlobCtor = g().Blob;
          const ResponseCtor = g().Response;
          if (BlobCtor === undefined || ResponseCtor === undefined) {
            throw new Error('这台设备缺少把字节喂进压缩流所需的两个内置对象。');
          }
          const piped = (new BlobCtor([input]).stream() as { pipeThrough(s: unknown): unknown }).pipeThrough(stream);
          const buf = await new ResponseCtor(piped).arrayBuffer();
          return new Uint8Array(buf);
        },
      };
    },
    crypto: () => g().crypto ?? null,
    location: () => g().location ?? null,
    history: () => g().history ?? null,
    settings: () => null,
  };
}

/* ================================================================== *
 * 2. 摘要：同步 SHA-256（D15 —— 状态机不许 await）
 * ================================================================== */

/** SHA-256 的轮常量（FIPS 180-4）。32 位无符号，逐个数得出来 */
const SHA256_K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
] as const;

function rotr(x: number, n: number): number {
  return ((x >>> n) | (x << (32 - n))) >>> 0;
}

/** 32 位抗溢出的加法（先按位或归零到无符号 32 位，再相加；最多 5 项，远在 2^53 内） */
function add32(...xs: readonly number[]): number {
  let sum = 0;
  for (const x of xs) sum += x >>> 0;
  return sum >>> 0;
}

/** SHA-256 摘要（32 字节）。**同步**、纯位运算、零依赖 */
export function sha256Bytes(bytes: Uint8Array): Uint8Array {
  const len = bytes.length;
  const padded = Math.ceil((len + 9) / 64) * 64;
  const msg = new Uint8Array(padded);
  msg.set(bytes);
  msg[len] = 0x80;
  // 长度以**位**计，写在末 8 字节（本用途里 len*8 远在 2^53 以内）
  const bits = len * 8;
  for (let i = 0; i < 8; i += 1) msg[padded - 1 - i] = Math.floor(bits / 2 ** (8 * i)) % 256;

  const h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const w = new Array<number>(64).fill(0);
  for (let off = 0; off < padded; off += 64) {
    for (let t = 0; t < 16; t += 1) {
      const i = off + t * 4;
      w[t] = ((msg[i] << 24) | (msg[i + 1] << 16) | (msg[i + 2] << 8) | msg[i + 3]) >>> 0;
    }
    for (let t = 16; t < 64; t += 1) {
      const s0 = rotr(w[t - 15], 7) ^ rotr(w[t - 15], 18) ^ (w[t - 15] >>> 3);
      const s1 = rotr(w[t - 2], 17) ^ rotr(w[t - 2], 19) ^ (w[t - 2] >>> 10);
      // ★ 加法一律过 `add32`：JS 的位运算先把操作数转成**有符号 32 位**，而 `+` 的结果
      //   可能超出 2^53 之外的精确保度区间吗？不会 —— 但 `>>> 0` 之前若先做浮点加法，
      //   结果超过 2^32 时 `>>> 0` 仍会取模 2^32，只是**不保证**在 2^53 内的低位精度
      //   （4 个 2^32 量级的数相加最多约 2^34，仍在精确区间内，所以其实安全）。
      //   写成 `add32` 是为了把"这里必须抗溢出"这件事**写在代码里**，而不是靠读者心算。
      w[t] = add32(w[t - 16], s0, w[t - 7], s1);
    }
    let a = h[0]; let b = h[1]; let c = h[2]; let d = h[3];
    let e = h[4]; let f = h[5]; let gg = h[6]; let hh = h[7];
    for (let t = 0; t < 64; t += 1) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & gg);
      const t1 = add32(hh, S1, ch, SHA256_K[t], w[t]);
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = add32(S0, maj);
      hh = gg; gg = f; f = e; e = add32(d, t1);
      d = c; c = b; b = a; a = add32(t1, t2);
    }
    h[0] = add32(h[0], a); h[1] = add32(h[1], b); h[2] = add32(h[2], c); h[3] = add32(h[3], d);
    h[4] = add32(h[4], e); h[5] = add32(h[5], f); h[6] = add32(h[6], gg); h[7] = add32(h[7], hh);
  }
  const out = new Uint8Array(32);
  for (let i = 0; i < 8; i += 1) {
    out[i * 4] = (h[i] >>> 24) & 0xff;
    out[i * 4 + 1] = (h[i] >>> 16) & 0xff;
    out[i * 4 + 2] = (h[i] >>> 8) & 0xff;
    out[i * 4 + 3] = h[i] & 0xff;
  }
  return out;
}

function toHex(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

/**
 * ★ 交给 `src/net/session.ts` 的哈希能力（`HashLike` 的**唯一**浏览器实现）。
 *
 * **契约**：把若干段文本按**给定顺序**拼起来再摘要。分隔符是 `\u0000`：
 * 直接 `parts.join('')` 会让 `('ab','c')` 与 `('a','bc')` 撞成同一个哈希，
 * 而这两对在本仓的调用点（`hash(seed, salt)` / `hash(face, faceNonce)`）都可能出现。
 *
 * **返回字符串，不是 `Promise`** —— 这是 D15 那一格的全部要点：状态机不 `await`，
 * 它看到 `Promise` 会当场抛错（`session.ts:412-418` 的违约路径）。变异 M7 就是这条错路。
 */
export function browserHashOf(...parts: readonly string[]): string {
  return 'browser-sha256:' + toHex(sha256Bytes(utf8Encode(parts.join('\u0000'))));
}

/** 把 `browserHashOf` 包成 `HashLike` 形状（`NetSessionOptions.hash` 要的就是它） */
export function browserHash(): HashLike {
  return (...parts: readonly string[]) => browserHashOf(...parts);
}

/* ================================================================== *
 * 3. 随机源（房间码）
 * ================================================================== */

/**
 * 房间码的随机源（`roomCodeFromRandom` 要的 `() => number`，契约是 `[0, 1)` 均匀值）。
 *
 * **生产侧的随机源必须住在这里**（`src/net/protocol.ts:282-285` 明写），纯层不许取随机。
 * 一字节除以 256 是**均匀**的（256 是 2 的幂，没有取模偏斜）。
 */
export function browserRandomness(env?: NetBrowserEnv): () => number {
  const resolved: NetBrowserEnv = { ...defaultEnv(), ...env };
  return () => {
    const c = resolved.crypto?.() ?? null;
    if (c === null) {
      // 没有随机源就**抛错**，不悄悄退化成一个可预测的码（那等于让所有人撞进同一个频道）
      throw new Error('这台设备拿不到随机源（安全上下文才提供它），无法生成房间码。');
    }
    const b = new Uint8Array(1);
    c.getRandomValues(b);
    return b[0] / 256;
  };
}

/** 生成一个 6 位房间码（字符表与归一化的**唯一**出处是 `src/net/protocol.ts`，D12） */
export function browserRoomCode(env?: NetBrowserEnv): string {
  return roomCodeFromRandom(browserRandomness(env));
}

/* ================================================================== *
 * 4. `iceServers` 的读取面（判据 9；§8.2 (a) + D14）
 * ================================================================== */

/**
 * ★ **默认**的 `iceServers`：只给公共 STUN，**一个中继都没有**（D14 / §8.2）。
 *
 * 判据 9 的三条钉的就是它：① 默认值的每一项都不是 `turn:` / `turns:` 开头；
 * ② 默认数组里只有公共 STUN；③ 本文件里不出现任何**字面**的 TURN 主机名/端口
 * （所以这里只有 `stun:` 前缀的地址，没有任何中继的样例）。
 *
 * 为什么默认给两个公共 STUN：一个是底线，第二个是厂商冗余。**这不是"内置了服务"**：
 * STUN 只帮两端发现自己的公网地址，不转发任何数据；TURN 才是中继，而中继的地址
 * 只能由玩家自己在设置里填。
 */
export const DEFAULT_ICE_SERVERS: readonly IceServerLike[] = [
  { urls: ['stun:stun.l.google.com:19302'] },
  { urls: ['stun:stun1.l.google.com:19302'] },
];

/** 中继 URL 的两个前缀（`turn` / `turns`）。写成一张表是为了让"判据只认这两个"是一处 */ 
const RELAY_SCHEMES: readonly string[] = ['turn:', 'turns:'];

/** 一个 URL 是不是中继（中继 = 会替两端转发数据的那一类） */
export function isRelayUrl(url: string): boolean {
  const low = url.trim().toLowerCase();
  return RELAY_SCHEMES.some((scheme) => low.startsWith(scheme));
}

/** `readIceServers` 的读数（默认面与"配了一半"都在这里，判据 9 断言的就是它） */
export interface IceServersRead {
  readonly servers: readonly IceServerLike[];
  /** 玩家真的配了一项可用的中继 */
  readonly relayConfigured: boolean;
  /** 填了 URL 但用户名 / 凭据不齐 —— 中继**没有**被加上，但这件事要能被说出来 */
  readonly relayIncomplete: boolean;
}

/**
 * ★ 读 `iceServers`（D14）：默认只给公共 STUN；玩家在设置里把 TURN 三项填齐了才追加**一项**中继。
 *
 * **三项必须齐全**才追加：只填了 URL 而没有凭据的中继在真实环境里必然 401，
 * 而"配了一半"这件事必须让玩家看见（`relayIncomplete: true`），不能静默忽略。
 */
export function readIceServers(settings?: NetSettingsLike | null): IceServersRead {
  const out: IceServerLike[] = DEFAULT_ICE_SERVERS.map((s) => ({ urls: [...s.urls] }));
  const url = typeof settings?.turnUrl === 'string' ? settings.turnUrl.trim() : '';
  if (url.length === 0) {
    return { servers: out, relayConfigured: false, relayIncomplete: false };
  }
  const username = typeof settings?.turnUsername === 'string' ? settings.turnUsername : '';
  const credential = typeof settings?.turnCredential === 'string' ? settings.turnCredential : '';
  if (username.length === 0 || credential.length === 0) {
    // ★ 注意这一支**不动** out：配了一半的中继**不许**被塞进默认值里（否则判据 9 的
    //   "默认值里没有中继"这条腿会在"玩家配了一半"的世界里变成假绿）
    return { servers: out, relayConfigured: false, relayIncomplete: true };
  }
  out.push({ urls: [url], username, credential });
  return { servers: out, relayConfigured: true, relayIncomplete: false };
}

/* ================================================================== *
 * 5. 压缩 / 解压（判据 7）
 * ================================================================== */

/** 压缩的读数（判据 7 断言的就是这些数） */
export interface CompressResult {
  readonly ok: true;
  readonly bytes: Uint8Array;
  readonly rawBytes: number;
  readonly compressedBytes: number;
  readonly ratio: number;
  readonly withinMeasuredRange: boolean;
}

/** 压缩 / 解压的失败形态（**不抛**：浏览器能力缺失是常态，不是异常） */
export interface CompressFailure {
  readonly ok: false;
  readonly reason: 'unsupported' | 'failed';
  readonly message: string;
}

/**
 * ★ 把字节压成 `deflate-raw`。
 *
 * **异步**：`CompressionStream` 是流式的。这不是本文件的自由选择 —— 它决定了
 * "邀请码的压缩住在浏览器层"这条结构（纯层交不出 `Promise`，见 `src/net/invite.ts` 的文件头）。
 *
 * 判据 7 的三条都落在返回值上：
 *  ① 压缩后字节数落在**实测区间**（400-470；出处见 `src/net/invite.ts` 的
 *     `COMPRESSED_BYTES_MIN` 注释：`.superpowers/g5-recon/FINDINGS.md` §6 实测 431 / 404）；
 *  ② 压缩比落在 0.70-0.78；
 *  ③ **`compressedBytes < rawBytes` 必须成立** —— 否则"压缩了"与"忘了压缩"逐字同形。
 *     这一条必须与 ① 同时成立：只钉区间会让"把原文直接 base64 当压缩结果"漏过去（M4）。
 */
export async function compressBytes(raw: Uint8Array, env?: NetBrowserEnv): Promise<CompressResult | CompressFailure> {
  const resolved: NetBrowserEnv = { ...defaultEnv(), ...env };
  const stream = resolved.compressionStream?.('compress') ?? null;
  if (stream === null) {
    return {
      ok: false,
      reason: 'unsupported',
      message: '这台设备的浏览器没有压缩流能力，邀请码生成不了（对端仍可用"输 6 位码"那条路）。',
    };
  }
  let out: Uint8Array;
  try {
    out = await stream.run(raw);
  } catch (e) {
    return { ok: false, reason: 'failed', message: `压缩没有完成：${String(e)}` };
  }
  const ratio = raw.length === 0 ? 0 : out.length / raw.length;
  return {
    ok: true,
    bytes: out,
    rawBytes: raw.length,
    compressedBytes: out.length,
    ratio,
    withinMeasuredRange: out.length >= COMPRESSED_BYTES_MIN && out.length <= COMPRESSED_BYTES_MAX,
  };
}

/** 把一段文本压成 `deflate-raw`（`compressBytes` 的文本口，判据 7 的语料走它） */
export function compressText(text: string, env?: NetBrowserEnv): Promise<CompressResult | CompressFailure> {
  return compressBytes(utf8Encode(text), env);
}

/** 解压的读数（`decompressBytes` 的失败**不抛**，与 `decodeInvite` 的结果对象同族） */
export type DecompressResult = { ok: true; bytes: Uint8Array } | { ok: false; reason: string; message: string };

/**
 * 把 `deflate-raw` 的字节解回原文。
 *
 * **异步**（同 `compressText`）。这条是"纯层的解码入口为什么在浏览器侧"的答案：
 * `src/net/invite.ts` 的 `decodeInviteText` 需要一个**同步**的解压函数，
 * 而真实解压是异步的 ⇒ 调用方先 `await` 本函数，再把字节喂给 `decodeInvite`。
 *
 * ⚠️ **不许**把本函数（或它的 `Promise`）喂给 `src/net/session.ts` 的状态机 —— 那是 M7 那条错路。
 */
export async function decompressBytes(compressed: Uint8Array, env?: NetBrowserEnv): Promise<DecompressResult> {
  const resolved: NetBrowserEnv = { ...defaultEnv(), ...env };
  const stream = resolved.compressionStream?.('decompress') ?? null;
  if (stream === null) {
    return { ok: false, reason: 'unsupported', message: '这台设备的浏览器没有解压流能力，这条邀请码打不开。' };
  }
  if (compressed.length === 0) {
    return { ok: false, reason: 'decompress-failed', message: '这条邀请码的压缩段是空的。' };
  }
  try {
    const bytes = await stream.run(compressed);
    if (bytes.length === 0) {
      return { ok: false, reason: 'decompress-failed', message: '这条邀请码解压之后没有任何内容。' };
    }
    return { ok: true, bytes };
  } catch {
    // 解压器对坏输入是 reject（不是返回空）—— 收成结果对象就是判据 4 的 ② 类
    return { ok: false, reason: 'decompress-failed', message: '这条邀请码的压缩段解不开（内容被改动或截断过）。' };
  }
}

/* ================================================================== *
 * 6. 邀请码：链接形态（判据 6、7）
 * ================================================================== */

/** `createInvite` 的入参（`originAndPath` 由浏览器层给：纯层不知道自己在哪个地址上） */
export interface CreateInviteInput extends InviteFields {
  readonly originAndPath: string;
}

/** `createInvite` 的读数 */
export interface CreatedInvite {
  readonly ok: true;
  readonly payload: string;
  readonly link: string;
  readonly chars: number;
  readonly withinMeasuredRange: boolean;
  readonly compressedBytes: number;
  readonly rawBytes: number;
  readonly ratio: number;
}

/**
 * ★ 生成一条邀请码（链接形态 + 二维码形态的**同一条**载荷）。
 *
 * 载荷的形状（纯层的 `encodeInvite` 定的）是 `<协议版本>.<压缩段>`：
 *  - 压缩段 = `compressBytes(payloadBytesOf(fields))` 的 base64url ——压缩的对象是那份
 *    位置数组（`v` / `sdp` / `ice` / 两个承诺串），**协议版本不在里面**（它要能被明文读到）；
 *  - 协议版本是明文十进制（握手第一步就比对它，D13）。
 *
 * 压缩是**异步**的、而 `encodeInvite` 要一个**同步**的压缩函数：这里先 `await` 出字节，
 * 再把它当作"已经算好的结果"交给纯层（D15 那条"状态机不 await"的同一种缝法）。
 * **载荷只进 fragment**（判据 6）。
 */
export async function createInvite(
  input: CreateInviteInput,
  env?: NetBrowserEnv,
): Promise<CreatedInvite | CompressFailure | { ok: false; reason: string; message: string }> {
  const fields: InviteFields = {
    p: input.p,
    sdp: input.sdp,
    ice: input.ice,
    hostPromise: input.hostPromise,
    guestPromise: input.guestPromise,
  };
  const raw = payloadBytesOf(fields);
  const c = await compressBytes(raw, env);
  if (!c.ok) return c;
  const encoded = encodeInvite(
    fields,
    // 同步压缩口：这里交出的**就是**上面那次 await 的结果（不重压一次，也不换内容）
    () => c.bytes,
    // 同步解压口：编码侧的自洽检查需要一个同步的解压
    (compressed) => (compressed === c.bytes ? raw : null),
  );
  if (!encoded.ok) return encoded;
  const payload = encoded.payload;
  return {
    ok: true,
    payload,
    link: inviteLinkOf(input.originAndPath, payload),
    chars: payload.length,
    withinMeasuredRange: payload.length >= INVITE_CHARS_MIN && payload.length <= INVITE_CHARS_MAX,
    compressedBytes: c.compressedBytes,
    rawBytes: c.rawBytes,
    ratio: c.ratio,
  };
}

/** 解码一条裸载荷（**异步**：先解压压缩段、再交给纯层解析）。链接形态与二维码形态共用它 */
export async function decodeInvitePayload(
  payload: string,
  env?: NetBrowserEnv,
): Promise<InviteDecodeResult> {
  if (payload.length === 0) {
    return { ok: false, reason: 'bad-base64url', message: '邀请码是空的：那一段什么都没有。请重新完整复制一次。' };
  }
  const dot = payload.indexOf('.');
  if (dot <= 0 || dot === payload.length - 1) {
    return {
      ok: false,
      reason: 'bad-base64url',
      message: '这不是一条邀请码：它没有"协议版本.压缩段"这个两段结构（要么少了那一段，要么被截断了）。',
    };
  }
  const compressed = payload.slice(dot + 1);
  const d = await decompressBase64(compressed, env);
  if (!d.ok) {
    // 解压侧分得开"字符集不对"与"压缩流解不开"；纯层那条路只拿到字节，分不了，所以在这里收口
    return { ok: false, reason: 'decompress-failed', message: d.message };
  }
  const bytes = d.bytes;
  return decodeInviteText(payload, (b64) => (b64 === compressed ? bytes : null));
}

/**
 * 把 base64url 的压缩段解回字节（先判字符集再解压，好让判据 4 的 ①② 分得开）。
 */
export async function decompressBase64(b64: string, env?: NetBrowserEnv): Promise<DecompressResult> {
  const pre = decodeBase64Url(b64);
  if (pre === null) {
    return { ok: false, reason: 'bad-base64url', message: '压缩段不是 base64url，解不出字节。' };
  }
  return decompressBytes(pre, env);
}

/**
 * 读地址栏里的邀请码并解码（**异步**）。
 *
 * 返回 `reason: 'no-fragment'` 表示"地址栏里没有邀请码"——那**不是**错误，
 * 绝大多数打开页面的时刻都是这样。
 */
export async function decodeInviteFromAddressBar(
  env?: NetBrowserEnv,
): Promise<InviteDecodeResult | { ok: false; reason: 'no-fragment'; message: string }> {
  const payload = readInviteFromAddressBar(env);
  if (payload === null) {
    return { ok: false, reason: 'no-fragment', message: '地址栏里没有邀请码（这不是错误，只是没有可读的东西）。' };
  }
  return decodeInvitePayload(payload, env);
}

/* ================================================================== *
 * 7. 地址栏 fragment 的**读**与**抹**（§8.3；T8 在启动路径调用）
 * ================================================================== */

/**
 * 从地址栏读邀请码载荷。**只认 fragment**（判据 6 的 ④：`?invite=` 与路径上的同一串不认）。
 *
 * 返回 `null` 表示"地址栏里没有邀请码"，不是错误。
 */
export function readInviteFromAddressBar(env?: NetBrowserEnv): string | null {
  const resolved: NetBrowserEnv = { ...defaultEnv(), ...env };
  const loc = resolved.location?.() ?? null;
  if (loc === null) return null;
  return inviteFragmentOf(loc.href);
}

/**
 * ★ 抹掉地址栏里的 fragment（D17 `:276`："收方读完立刻抹掉地址栏"）。
 *
 * 为什么要抹：不抹的话这条链接会一直留在地址栏里 —— 玩家截图、把地址栏复制给别人，
 * 都会把这次邀请的载荷（含 SDP 与两个承诺串）一起带出去。fragment 本身**不会**发给服务器
 * （那是选它做载体的理由），但"留在地址栏"是另一件事。
 *
 * 用 `replaceState` 而不是赋值 `location.hash = ''`：前者**不进历史记录**
 * （玩家按"后退"不会回到那个带着载荷的地址），后者会多出一条历史项。
 */
export function stripInviteFromAddressBar(env?: NetBrowserEnv): boolean {
  const resolved: NetBrowserEnv = { ...defaultEnv(), ...env };
  const loc = resolved.location?.() ?? null;
  const hist = resolved.history?.() ?? null;
  if (loc === null || hist === null) return false;
  if (inviteFragmentOf(loc.href) === null) return false;
  hist.replaceState(null, '', loc.href.split('#')[0]);
  return true;
}

/* ================================================================== *
 * 8. 信令客户端（§8.1 方案 2：端点为空 ⇒ **一个请求都不发**）
 * ================================================================== */

/** `signalEndpointOf` 的读数 */
export type EndpointShape =
  | { ok: true; url: string }
  | { ok: false; reason: 'no-endpoint' | 'bad-endpoint'; message: string };

/**
 * 端点的形状校验：只收 `wss:` / `ws:`。
 *
 * **为什么收 `ws:`**：局域网里自建一个信令点走明文是有意义的（本程序不替玩家决定），
 * 但 `http:` 或随便一串字必须是**可读的拒绝**。
 */
export function signalEndpointOf(raw: string | null | undefined): EndpointShape {
  const gate = roomCodeEntryReachability(raw);
  if (!gate.ok) return { ok: false, reason: 'no-endpoint', message: gate.message };
  const low = gate.endpoint.toLowerCase();
  if (!low.startsWith('wss://') && !low.startsWith('ws://')) {
    return {
      ok: false,
      reason: 'bad-endpoint',
      message:
        '设置里的信令端点不是一个信令地址：它要以 wss:// 或 ws:// 开头。' +
        '请到「高级 / 连接设置」里改成对端给你的那个地址。',
    };
  }
  return { ok: true, url: gate.endpoint };
}

/** `roomCodeEntry` 的读数："这条路通"或者"一条可读的真因" */
export type RoomCodeEntryResult =
  | { ok: true; url: string }
  | { ok: false; reason: 'no-endpoint' | 'bad-endpoint'; message: string };

/**
 * 读设置里的信令端点（不发任何请求，只读配置）。
 *
 * 分开成两个函数是有意的：**"配没配"是纯配置问题，"通不通"是网络问题**。
 * 判据 5 的两条腿分别落在它们上面。
 */
export function signalingEndpointSetting(env?: NetBrowserEnv): string {
  const resolved: NetBrowserEnv = { ...defaultEnv(), ...env };
  const settings = resolved.settings?.() ?? null;
  const raw = settings?.signalingEndpoint;
  return typeof raw === 'string' ? raw : '';
}

/**
 * ★ "输 6 位码"这条路的**唯一入口**（§8.1 / D17 / 判据 5）。
 *
 * 端点为空 ⇒ 返回一条**可读提示**（文案本体在 `src/net/invite.ts` 的 `NO_ENDPOINT_MESSAGE`，
 * 唯一出处，T8 只渲染不重写），并且**不构造任何网络对象**：
 * 本函数在端点为空的那一支里**没有**任何 `webSocket()` / `fetch()` 调用 —— 这是判据 5 的
 * "零请求"腿。反证腿（防这条恒绿）：同一份假件用在端点非空的配置上时，
 * `discoverSignalingEndpoint()` 会真的调用假件。
 */
export function roomCodeEntry(env?: NetBrowserEnv): RoomCodeEntryResult {
  return signalEndpointOf(signalingEndpointSetting(env));
}

/**
 * 探一次信令端点（**真正的网络动作**）。
 *
 * `turns` 是"还要顺带试的地址"列表（玩家配的中继之类）。它**只在端点非空时**才会被走到 ——
 * "端点为空 ⇒ 记账数 0"这条判据的取证方式是：把同一个记账假件喂进两套配置各跑一次。
 */
export async function discoverSignalingEndpoint(
  entry: { readonly url: string; readonly turns?: readonly string[] },
  env?: NetBrowserEnv,
): Promise<{ ok: true; used: readonly string[] } | { ok: false; reason: 'unreachable'; message: string }> {
  const resolved: NetBrowserEnv = { ...defaultEnv(), ...env };
  const used: string[] = [];
  for (const url of [entry.url, ...(entry.turns ?? [])]) {
    used.push(url);
    if (url.startsWith('http://') || url.startsWith('https://')) {
      const f = resolved.fetch;
      if (f === undefined) continue;
      try {
        const r = await f(url);
        if (r.ok) return { ok: true, used };
      } catch {
        // 一个端点不通就试下一个；全都试完才报不可达
      }
      continue;
    }
    const ws = resolved.webSocket?.(url) ?? null;
    if (ws === null) continue;
    if (ws.readyState === WS_OPEN || ws.readyState === WS_CONNECTING) return { ok: true, used };
  }
  return {
    ok: false,
    reason: 'unreachable',
    message: '这些信令端点一个都没连上。可以改用邀请码（它不需要任何服务器），或换一个端点再试。',
  };
}

/** 信令客户端（一个房间一条）。`open()` 之后才有 `sendText()` 可用 */
export interface SignalingSession {
  readonly channel: string;
  /** 连上信令端点。**只在端点非空时才会被造出来**（工厂挡在前面） */
  open(): Promise<TransportActionResult>;
  sendText(text: string): SendResult;
  close(): void;
  state(): TransportStatus;
}

/** 造信令客户端时的失败形态（端点为空 / 形式不对 / 设备没能力） */
export interface SignalingEntryFailure {
  readonly ok: false;
  readonly reason: 'no-endpoint' | 'bad-endpoint' | 'unsupported';
  readonly message: string;
}

/**
 * 造一个信令客户端。**端点为空时返回失败对象，而不是一个连不上的客户端**
 * （§8.1："端点为空时只出邀请码"）—— 这条返回类型本身就是那条裁决的载体。
 */
export function createSignalingSession(
  args: { readonly code: string; readonly channel: string },
  env?: NetBrowserEnv,
): SignalingSession | SignalingEntryFailure {
  const resolved: NetBrowserEnv = { ...defaultEnv(), ...env };
  const entry = roomCodeEntry(env);
  if (!entry.ok) return entry;
  const ws = resolved.webSocket?.(entry.url) ?? null;
  if (ws === null) {
    return {
      ok: false,
      reason: 'unsupported',
      message: '这台设备没有可用的信令连接能力，短码这条路走不了。请改用邀请码。',
    };
  }
  let status: TransportStatus = 'idle';
  return {
    channel: args.channel,
    open: async () => {
      status = 'connecting';
      ws.addEventListener('close', () => { status = 'offline'; });
      return { ok: true };
    },
    sendText: (text: string): SendResult => {
      if (status === 'closed') return { ok: false, reason: 'closed', message: '信令已经关了。' };
      if (ws.readyState !== WS_OPEN) {
        return { ok: false, reason: 'offline', message: '信令还没连上，这条消息没有发出去。' };
      }
      try {
        ws.send(text);
        return { ok: true };
      } catch (e) {
        return { ok: false, reason: 'offline', message: `信令发送失败：${String(e)}` };
      }
    },
    close: () => {
      if (status !== 'closed') {
        try {
          ws.close();
        } catch {
          // 已经关掉的连接再关一次会抛，吞掉（close 的契约是幂等）
        }
      }
      status = 'closed';
    },
    state: () => status,
  };
}

/* ================================================================== *
 * 9. `NetTransport` 的浏览器实现（D18：init 只等本侧）
 * ================================================================== */

/** 本端待发队列的字节上限（真 WebRTC 上就是 `bufferedAmount`，超了报 `'queue-full'`） */
const MAX_BUFFERED_BYTES = 1 << 20;

/** 两条通道的 `RTCDataChannelInit`（特性从 `CHANNEL_SPECS` 的**唯一出处**取，别自己写一份） */
function dataChannelInit(channel: NetChannel): { ordered: boolean; maxRetransmits?: number } {
  const spec = channelSpec(channel);
  return spec.reliable ? { ordered: true } : { ordered: false, maxRetransmits: 0 };
}

/**
 * 造一个 `NetTransport`（真 WebRTC）。
 *
 * ## ★ `init()` 只等**本侧**（D18 / 判据 12）
 *
 * `init()` 的 `ok` 只表示"本侧的 offer 已经落在 `localDescription` 上、两条通道已经建出来"。
 * **对端在不在，它不作承诺** —— 真 WebRTC 在 `init()` 那一刻原理上不知道对端在不在
 * （要等 ICE / DTLS / 握手回来，可能要几秒）。判据 12 的假件就是"ICE 永远不 connected"那种：
 * `init()` 仍然 `ok: true`，而对端在线与否**只**由 `onStatus` 的 `connecting → online` 回答。
 * **不许**把 `init().ok === false` 读成"对端不在线"。
 *
 * ## 事件绑定
 *
 * `iceconnectionstatechange` / `connectionstatechange` / `visibilitychange` 都在这里绑：
 * 切回前台或 ICE 掉线时 `restartIce()`（计划 §5 T7 的交付物之一）。
 */
export function createBrowserTransport(env?: NetBrowserEnv): NetTransport {
  const resolved: NetBrowserEnv = { ...defaultEnv(), ...env };
  const listeners = {
    message: [] as ((text: string, channel: NetChannel) => void)[],
    status: [] as ((change: StatusChange) => void)[],
    error: [] as ((failure: SendFailure) => void)[],
  };
  const channels = new Map<NetChannel, DataChannelLike>();
  let pc: PeerConnectionLike | null = null;
  let status: TransportStatus = 'idle';
  let sent = 0;
  let initDone = false;
  let peerOnline = false;
  let detachVisibility: (() => void) | null = null;

  const emitStatus = (to: TransportStatus, message: string): void => {
    if (to === status) return; // 契约：回调只报**变化**（transport.ts:232）
    const change: StatusChange = { from: status, to, message };
    status = to;
    for (const cb of listeners.status) cb(change);
  };

  const onPeerState = (raw: string): void => {
    if (raw === 'connected') {
      peerOnline = true;
      emitStatus('online', '对端已连上（这条读数只来自状态事件；init() 的 ok 不代表它）。');
      return;
    }
    if (raw === 'disconnected' || raw === 'failed') {
      if (peerOnline) {
        peerOnline = false;
        emitStatus('offline', '与对端的连接断了（这条读数只来自状态事件，不看 init()）。');
      }
      // 重连：切回前台那条路还会再叫一次 restartIce()
      pc?.restartIce?.();
    }
  };

  const transport: NetTransport = {
    async init(init: TransportInit): Promise<TransportActionResult> {
      // **幂等**：已经起来过就 no-op（重连路上会被反复调用，见 transport.ts:204）
      if (initDone || pc !== null) return { ok: true };
      const settings = resolved.settings?.() ?? null;
      const ice = readIceServers(settings);
      const conn = resolved.peerConnection?.({ iceServers: ice.servers }) ?? null;
      if (conn === null) {
        return {
          ok: false,
          reason: 'unsupported',
          message: '这台设备没有可用的对端连接能力（需要安全上下文），联机这条路走不了。',
        };
      }
      pc = conn;
      conn.addEventListener('iceconnectionstatechange', () => onPeerState(String(conn.iceConnectionState ?? '')));
      conn.addEventListener('connectionstatechange', () => onPeerState(String(conn.connectionState ?? '')));
      emitStatus('connecting', `正在建立本侧链路（本端 ${init.selfId}，对端 ${init.peerId}）。`);
      for (const spec of CHANNEL_SPECS) {
        const dc = conn.createDataChannel(spec.channel, dataChannelInit(spec.channel));
        channels.set(spec.channel, dc);
        dc.addEventListener('message', (ev) => {
          const data = (ev as { data?: unknown }).data;
          if (typeof data === 'string') for (const cb of listeners.message) cb(data, spec.channel);
        });
      }
      try {
        const offer = await conn.createOffer();
        await conn.setLocalDescription(offer);
      } catch (e) {
        return { ok: false, reason: 'offer-failed', message: `本侧连接描述没有建起来：${String(e)}` };
      }
      // 切回前台 / 换网之后重启 ICE。这个订阅是**能力**（`env.onVisibilityChange`）：
      // 纯层不知道"可见性"这个东西，宿主没给就不绑（无头 / 测试环境很常见）
      const onVis = resolved.onVisibilityChange;
      if (onVis !== undefined) {
        detachVisibility = onVis(() => {
          if (status === 'connecting' || status === 'offline') pc?.restartIce?.();
        });
      }
      initDone = true;
      // ★ 到这里就返回：**不等对端**（D18）。此刻 peerOnline 恒 false、status 恒 'connecting'，
      //   对端在不在只能等 onStatus —— 判据 12 的"ICE 永不 connected"那条腿钉的就是这里。
      void ice.relayConfigured;
      return { ok: true };
    },

    channels(): readonly NetChannelSpec[] {
      return CHANNEL_SPECS;
    },

    seq(): number {
      return sent;
    },

    send(channel: NetChannel, text: string): SendResult {
      if (status === 'closed') {
        return { ok: false, reason: 'closed', message: '这一局已经结束了，发不出去。' };
      }
      if (!initDone) {
        return {
          ok: false,
          reason: 'not-initialized',
          message: '本侧链路还没建立（init 还没成功），这条消息没有发出去。',
        };
      }
      const dc = channels.get(channel);
      if (dc === undefined) {
        return { ok: false, reason: 'not-initialized', message: `通道 ${channel} 还没建出来。` };
      }
      if ((dc.bufferedAmount ?? 0) > MAX_BUFFERED_BYTES) {
        return { ok: false, reason: 'queue-full', message: '待发队列积压太多，这一帧先不发了（等它排空再试）。' };
      }
      if (dc.readyState !== 'open') {
        return {
          ok: false,
          reason: 'offline',
          message: '对端不可达，这条消息没有发出去（这是传输层的读数，不是"这局结束了"）。',
        };
      }
      try {
        dc.send(text);
        sent += 1;
        return { ok: true };
      } catch (e) {
        return { ok: false, reason: 'offline', message: `发送失败：${String(e)}` };
      }
    },

    sendIfOpen(channel: NetChannel, text: string): SendResult {
      const r = transport.send(channel, text);
      if (!r.ok) for (const cb of listeners.error) cb(r);
      return r;
    },

    async close(): Promise<TransportActionResult> {
      // 重复调用是 no-op、返回成功（transport.ts:228）
      if (status === 'closed') return { ok: true };
      detachVisibility?.();
      detachVisibility = null;
      for (const dc of channels.values()) {
        try {
          dc.close();
        } catch {
          // 已经关掉的通道再关一次会抛，吞掉（close 幂等）
        }
      }
      channels.clear();
      try {
        pc?.close();
      } catch {
        // 同上
      }
      pc = null;
      initDone = false;
      peerOnline = false;
      emitStatus('closed', '这一局已经结束（closed 不可逆，不能再连）。');
      return { ok: true };
    },

    onMessage(cb: (text: string, channel: NetChannel) => void): () => void {
      listeners.message.push(cb);
      return () => {
        const i = listeners.message.indexOf(cb);
        if (i >= 0) listeners.message.splice(i, 1);
      };
    },

    onStatus(cb: (change: StatusChange) => void): () => void {
      listeners.status.push(cb);
      return () => {
        const i = listeners.status.indexOf(cb);
        if (i >= 0) listeners.status.splice(i, 1);
      };
    },

    onError(cb: (failure: SendFailure) => void): () => void {
      listeners.error.push(cb);
      return () => {
        const i = listeners.error.indexOf(cb);
        if (i >= 0) listeners.error.splice(i, 1);
      };
    },

    status(): TransportStatus {
      return status;
    },
  };
  return transport;
}

/* ================================================================== *
 * 10. 转发出口（T8 取这些，不许自己再写一份）
 * ================================================================== */

/** 纯层给的"没有配置信令端点"那句提示的**转发出口** */
export const NO_SIGNALING_ENDPOINT_MESSAGE = NO_ENDPOINT_MESSAGE;

/** 量一条载荷的长度并给出区间判定（判据 7 与 T8 的提示共用这一处） */
export function inviteLengthReport(payload: string): InviteLengthReport {
  return {
    chars: payload.length,
    withinMeasuredRange: payload.length >= INVITE_CHARS_MIN && payload.length <= INVITE_CHARS_MAX,
    min: INVITE_CHARS_MIN,
    max: INVITE_CHARS_MAX,
  };
}

export interface InviteLengthReport {
  readonly chars: number;
  readonly withinMeasuredRange: boolean;
  readonly min: number;
  readonly max: number;
}

/** 压缩比的区间判定（同上，唯一取值路径） */
export function compressionWithinMeasuredRange(compressedBytes: number, rawBytes: number): boolean {
  if (rawBytes <= 0) return false;
  if (compressedBytes < COMPRESSED_BYTES_MIN || compressedBytes > COMPRESSED_BYTES_MAX) return false;
  const ratio = compressedBytes / rawBytes;
  return ratio >= COMPRESSION_RATIO_MIN && ratio <= COMPRESSION_RATIO_MAX;
}

/** 压缩比的实测区间（转发纯层的唯一出处，别在这里再写一份） */
export const COMPRESSION_RATIO_MIN = COMPRESSION_RATIO_MIN_K;
export const COMPRESSION_RATIO_MAX = COMPRESSION_RATIO_MAX_K;

/** 把 UTF-8 字节解回文本（诊断用；判据 7 的语料核对会用到） */
export const utf8TextOf = utf8Decode;

/** 解 base64url（转发纯层的唯一实现，判据 4 的 ① 类靠它） */
export const decodeBase64Url = (text: string): Uint8Array | null => base64UrlToBytes(text);
