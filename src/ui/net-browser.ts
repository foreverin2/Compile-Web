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
import type { NetMsgType } from '../net/protocol';
import type { HashLike } from '../net/session';
import {
  DEFAULT_TURN_CRED_SETTINGS,
  describeTurnCredentialFailure,
  type TurnCredential,
  type TurnCredentialFailure,
  type TurnCredentialRead,
} from './turn-cred';
import {
  COMPACT_INVITE_CHARS_MAX,
  COMPACT_INVITE_CHARS_MIN,
  COMPACT_PAYLOAD_VERSION,
  COMPRESSED_BYTES_MAX,
  COMPRESSED_BYTES_MIN,
  COMPRESSION_RATIO_MAX as COMPRESSION_RATIO_MAX_K,
  COMPRESSION_RATIO_MIN as COMPRESSION_RATIO_MIN_K,
  INVITE_CHARS_MAX,
  INVITE_CHARS_MAX_UNCOMPRESSED,
  INVITE_CHARS_MIN,
  NO_ENDPOINT_MESSAGE,
  base64UrlToBytes,
  bytesToBase64Url,
  decodeInvite,
  decodeInviteText,
  encodeInvite,
  icePwdOfSessionId,
  iceUfragOfSessionId,
  inviteFragmentOf,
  inviteLinkOf,
  kindOfMarker,
  markerOfKind,
  payloadBytesOf,
  rawBytesForInvite,
  readInviteSegment,
  roomCodeEntryReachability,
  utf8Decode,
  utf8Encode,
  type CompressionKind,
  type InviteDecodeResult,
  type InviteFields,
  type InvitePayloadMode,
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
  /** 退订（真件恒有；假件可以不实现 —— 可选 ⇒ 两边同形，不会逼测试伪造一个用不上的方法） */
  removeEventListener?(type: 'open' | 'close' | 'error' | 'message', cb: (ev: unknown) => void): void;
}

/**
 * 真实 `RTCStatsReport` 的最小结构面（G6/T46）。
 *
 * 真件是 `Map<string, 条目>`（`forEach` / `get` / `values` 都有）。本文件只用到
 * `forEach`（遍历一遍、自己挑出"被提名且已成功的那一对"）—— 结构面越小，假件越容易与真件同形
 * （理由与 `DataChannelLike` 逐字相同）。
 *
 * 条目一律当**开放的记录**读（`Record<string, unknown>`）：`RTCStatsReport` 里每种条目的字段
 * 由 `type` 决定（`candidate-pair` 有 `localCandidateId`、`local-candidate` 有 `candidateType`），
 * 而本文件**只读它真的会用到的那几个字段**，并把"字段不在/类型不对"当成"读不出来"
 * （⇒ 如实回"建立中…"，不许猜）。
 */
export interface RTCStatsReportLike {
  forEach(cb: (entry: Record<string, unknown>) => void): void;
}

/** 真实 `RTCPeerConnection` 的最小结构面（含 `restartIce`：计划 §5 T7 的交付物之一） */
export interface PeerConnectionLike {
  readonly connectionState?: string;
  readonly iceConnectionState?: string;
  /**
   * ICE 收集状态（`'new' | 'gathering' | 'complete'`）。
   *
   * ★ **G5/T8 修复轮 B1/B2 加的**：它是"能不能取 `localDescription` 当一份**非 trickle** 的
   * offer/answer"的**唯一判据**。真件上 `setLocalDescription()` 返回之后 ICE 收集**才刚开始**，
   * 此刻 `localDescription.sdp` 里**没有候选**——直接发出去会得到一条需要 trickle 的 offer，
   * 而邀请码那条路是**一次性**的（没有第二条通道补候选，D17/§8.3）。
   */
  readonly iceGatheringState?: string;
  readonly localDescription?: { readonly sdp: string; readonly type: string } | null;
  createDataChannel(label: string, init?: { ordered?: boolean; maxRetransmits?: number }): DataChannelLike;
  createOffer(): Promise<{ readonly sdp?: string; readonly type: string }>;
  /**
   * 产一条 answer（**收方**用）。
   *
   * ★ G5/T8 修复轮 B1：它在此之前**根本不存在**——整份文件里只有 `createOffer`，
   * 所以"收方那一侧产一条 answer"这件事在产出代码里**没有能力表达**（评审 1.2 实测的那一条）。
   * 可选（与 `setRemoteDescription?` 同款）：假件可以不实现，两边同形。
   */
  createAnswer?(): Promise<{ readonly sdp?: string; readonly type: string }>;
  setLocalDescription(desc: { readonly type: string; readonly sdp?: string }): Promise<void>;
  /** 对端描述（answer / offer）。收方把它喂进来 */
  setRemoteDescription?(desc: { readonly type: string; readonly sdp?: string }): Promise<void>;
  restartIce?(): void;
  /**
   * ★ **G6/T46：`RTCPeerConnection.getStats()`**（"这一局到底走没走中继"的**唯一**真值来源）。
   *
   * 真件返回一棵 `RTCStatsReport`（`Map<id, 条目>`）。本仓的产出代码在此之前**一处都没有**
   * 读过它 ⇒ "现在是不是经中继"这件事在界面上无从判断（`candidate-pair` 的
   * `nominated === true && state === 'succeeded'` 那一对里，两端的 `candidateType`
   * 有没有 `relay`，只有它答得了）。
   *
   * 可选（与 `setRemoteDescription?` / `restartIce?` 同款）：假件可以不实现，两边同形；
   * 拿不到就**如实**回"建立中…"，**不许猜成"直连"**（判据本体见 `readRelayStats`）。
   */
  getStats?(): Promise<RTCStatsReportLike>;
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

/** 玩家设置里与传输层有关的那几项。**全部可缺省**，缺省即"用产品默认值"（D14；T38 起默认带中继） */
export interface NetSettingsLike {
  /**
   * 信令端点（`wss://…` / `ws://…`）。**默认没有**：没配它就走"邀请码 / 回示码"那条手递路，
   * 短码那条路不可用（见 `NO_ENDPOINT_MESSAGE`）。
   *
   * ⚠️ 它**不等于**"本程序不向任何服务器发请求"：ICE 默认就要联系 STUN/TURN
   * （`DEFAULT_ICE_SERVERS` 第一项就是 8.130.97.243）。
   */
  readonly signalingEndpoint?: string;
  /**
   * TURN 中继的 URL（三项之一）。**留空 = 用产品默认值那台**（`DEFAULT_ICE_SERVERS` 里的
   * `turn:8.130.97.243:3478`）；三项填齐则**追加**为玩家自己那台（覆盖默认地址）。
   *
   * ★★ **G6/T50 起，"谁提供凭据"分成了两条路**（方案 B1）：
   *  - **玩家自己那台**：仍然走下面这三项（三项齐全 ⇒ 按玩家给的写，来源 `player`）；
   *  - **产品那台**：凭据**不再内联在前端**，而是开局前向签发服务换一份短时凭据，
   *    由宿主经 `TurnCredentialRead` 交进来（见 `IceCredentialSources`）。
   */
  readonly turnUrl?: string;
  readonly turnUsername?: string;
  readonly turnCredential?: string;
  /**
   * ★★ **G6/T50**：刚换到手的**产品凭据**（`<expiry>:<scope>` / `base64(HMAC-SHA1(...))`）。
   *
   * 为什么用设置里"额外两个字段"来表达它、而不是再加一个注入成员：`readIceServers` 的入参
   * 就是**一份设置**，宿主在这里合成"玩家三项 + 产品凭据"这一份，判定仍然只有一处；
   * `waitForIceGathering` 也因此看得见"这一轮到底有没有中继"（它读的是同一个函数）。
   *
   * 三项为空（= 玩家没指定）而这两个字段在 ⇒ 用产品那台地址 + 这份凭据，来源 `builtin`。
   */
  readonly appTurnUsername?: string;
  readonly appTurnCredential?: string;
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
   * 造一个对端连接。入参是 `iceServers`（D14：从设置读；没填就用 `DEFAULT_ICE_SERVERS`，
   * 那份默认值自带一台中继）——
   * 传**动作**而不是现成对象，理由照 `L1StoreEnv.localStorage`：读 `globalThis.X`
   * 这件事本身就可能抛，而"抛"正是最该被兜住的一种环境。
   */
  readonly peerConnection?: (config: { readonly iceServers: readonly IceServerLike[] }) => PeerConnectionLike | null;
  /** 造一个信令连接（WebSocket）的动作。**只有端点非空时才会被调用**（§8.1） */
  readonly webSocket?: (url: string) => WebSocketLike | null;
  /**
   * 造一个**压缩流**的动作。
   *
   * 入参是**压缩格式名**（`'deflate-raw'` / `'deflate'` / `'gzip'`），或者老口径那两个字
   * `'compress'` / `'decompress'`（含义分别是"压 `deflate-raw`"与"解 `deflate-raw`"）。
   *
   * ★ **G5/T40 的兼容口径**：老代码 / 老假件按 `'compress' | 'decompress'` 两档写
   * （那时格式名写死在实现里，只有一个 `deflate-raw`）。为了让那些调用点**一字不改**，
   * 本参数收下这五种字符串 —— 老假件在收到格式名时按"自己那一套恒等/记账语义"回答即可。
   *
   * 真实实现走 `CompressionStream` / `DecompressionStream` + `Blob` + `Response`。
   */
  readonly compressionStream?: (mode: CompressionStreamMode) => CompressionStreamLike | null;
  readonly crypto?: () => CryptoLike | null;
  readonly location?: () => LocationLike | null;
  readonly history?: () => HistoryLike | null;
  /** 读设置的**动作**（不是值本身）。缺省 = 没有任何设置 ⇒ 端点为空、无中继 */
  readonly settings?: () => NetSettingsLike | null;
  /** HTTP 探针（"这个信令端点通不通"）。**只有端点非空时**才会被调用 */
  readonly fetch?: (url: string) => Promise<{ readonly ok: boolean; readonly status: number }>;
  /** 挂 `visibilitychange` 的订阅动作，返回退订函数（切回前台 ⇒ `restartIce()`） */
  readonly onVisibilityChange?: (cb: () => void) => () => void;
  /**
   * ★ **对端连接造出来时的回执**（G5/T8 修复轮 B 档加）。
   *
   * 为什么需要它：房主"把对方回示的 answer 喂回**同一条**连接"（`applyAnswer`）要用到那个对象，
   * 而它住在 `createBrowserTransport` 里面、外面拿不到。宿主**不能**自己去 `new` 一个
   * ——那样会拿到**第二条**连接，而 `setRemoteDescription(answer)` 在一条没出过 offer 的连接上
   * 只会失败。⇒ 用这个回执把**刚造出来的那一条**交出来（`src/main.ts` 只记引用，不碰构造器）。
   *
   * 它是**只读通知**：本文件不读它的返回值，宿主拿它做什么与本层无关。
   */
  readonly onPeerConnection?: (pc: PeerConnectionLike) => void;
  /**
   * ★★ **G5 T13-A：探针专用的"掐线/恢复"能力开关**（缺省 `false` ⇒ 默认路径一个字节都不多走）。
   *
   * 打开时本文件会挂两个全局函数（`__g5LinkCut()` / `__g5LinkRestore()`）：前者**真的**关掉本端
   * 的两条数据通道（于是 `send` 如实失败、`readyState === 'closed'`），后者由出 offer 的一方
   * **真的重建**那两条通道（认领侧靠 `datachannel` 事件接上）—— 实测可行（SCTP/DCEP 允许在已
   * 建立的连接上换通道，不需要重新协商 SDP）。状态也**如实**转 `offline`/`online`。
   *
   * 为什么必须做成开关而不是无条件：它是测试钩子（`#g5probe=1` 才开），生产路径不该有
   * "把自己掐线"的能力。理由与代价见 `.superpowers/g5-T13/T13AB-REPORT.md` §5。
   */
  readonly probeLinkCut?: boolean;
  /**
   * ★ **计时能力**（G5/T8 修复轮 B2 加）。
   *
   * 为什么需要它：等 ICE 收集完成**必须有一个上界**——"无上界的 `await` 就是一次静默挂起"，
   * 那正是 D23 要消灭的形态。而本仓的纪律是**计时一律注入**（不裸 `setTimeout`）⇒
   * 上界走这个能力。
   *
   * 形状与 `src/app/match-driver.ts:152` 的 `Ticker` **逐字同形**（结构兼容 ⇒ `window.setTimeout`
   * 那一族直接就能塞进来），但在这里**另立一个名字**：本文件是 T7 的交付物，不该为了一个
   * 两方法的形状去 import T2 的文件（分层上 `ui → app` 是允许的，但零收益的耦合不加）。
   */
  readonly ticker?: GatherTicker;
  /**
   * 等 ICE 收集的上界（毫秒）。缺省 `DEFAULT_ICE_GATHER_TIMEOUT_MS`。
   *
   * 可注入的理由与 `net-driver.ts` 的 `inboundCapacity` 同款：**上界必须是"能在测试里非零地
   * 构造出超时"的东西**，否则"超时之后会怎样"这条判据只能靠读代码相信。
   */
  readonly iceGatherTimeoutMs?: number;
  /**
   * ★★ **G6/T50（B1）：这一刻手上有没有中继凭据**（`turn-cred.ts` 的读数）。
   *
   * 它是**同步的只读动作**（不建连接、不发请求）：
   *  - 拿得到 ⇒ 默认那台 coturn 配上这份短时凭据（`relaySource: 'builtin'`、`relayConfigured: true`）；
   *  - 拿不到 ⇒ **降级成不含中继的 ICE 列表**（直连），并把"为什么没有"如实带给屏上；
   *  - 宿主不给它 ⇒ 与"拿不到"同一条路（测试与老调用点因此天然走降级那一档）。
   *
   * 为什么"取"这一步不在这里做：取凭据是**异步**的（有 2 秒上界），而 `readIceServers`
   * 与 `waitForIceGathering` 都是同步的。取/续/降级的责任归 `turn-cred.ts`，宿主在开局前
   * 先 `refresh()` 一次（见 `src/main.ts` 的大厅环境）。
   */
  /**
   * ★★ **G6/T50：这一刻手上有没有中继凭据**（`turn-cred.ts` 的读数）。
   *
   * ★ **返回值的三态**（B1 上线前后语义不同，别照旧文档理解）：
   *  - `undefined` ⇒ **这个宿主没接签发服务**（端点没配）⇒ **没有中继**（`'not-configured'`）；
   *  - `{available: true, …}` ⇒ 用服务端给的那一份（REST 那条路）；
   *  - `{available: false, …}` ⇒ **真的降级**成直连（ICE 列表里没有 `turn:`）。
   *
   * 为什么把"没接"表达成 `undefined` 而不是一份 `available: false` 的读数：宿主那一侧
   * （`src/main.ts` 的 `turnCredentialRead()`）要能区分"压根没接"与"接了却没换到"，
   * 屏上那两句话也因此不一样。
   */
  readonly credentialRead?: () => TurnCredentialRead | undefined;
  /**
   * ★★ **G6/T50：等"这一轮取凭据"这件事结算完**（可缺省；缺省 = 不等，直接读缓存）。
   *
   * 为什么 `init()` 需要它：`waitForIceGathering` 在**同一次 `init()` 里**读
   * `readIceServers().relayConfigured`，而那个读数决定"够用"的口径（有中继 ⇒ 必须等 relay 到手）。
   * 如果取凭据还在飞，这一刻读到的是 `false` ⇒ 产品会按"没有中继"去排 1.5 秒宽限
   * ⇒ 中继那一档**永远不会生效**（实测症状：`relayConfigured` 在邀请码产出的那一刻已经是 `true`，
   * 可邀请码里一条 relay 都没有 —— `.superpowers/g6-T50/run/gate9-ice.txt` 那次）。
   *
   * 它**必须有上界**：那个承诺由取凭据那一侧（`turn-cred.ts` 的 `timeoutMs`，2 秒）保证，
   * 所以这里的 `await` 不会把"生成邀请码"卡住。
   */
  readonly ensureCredential?: () => Promise<unknown>;
}

/** 等 ICE 用的计时能力（形状与 `match-driver.ts` 的 `Ticker` 同形，见 `NetBrowserEnv.ticker`） */
export interface GatherTicker {
  schedule(fn: () => void, ms: number): number;
  cancel(h: number): void;
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

/**
 * ★★ **G5/T40**：`CompressionStream` / `DecompressionStream` 认得的**格式名**。
 *
 * 顺序就是**降级链的顺序**（`COMPRESSION_FALLBACK`）：`deflate-raw` → `deflate` → `gzip`。
 * 三档都不成 ⇒ **不压缩**（那个"档"没有格式名 —— 它就是原文，见 `CompressionKind` 的 `'none'`）。
 */
export type CompressionFormat = 'deflate-raw' | 'deflate' | 'gzip';

/**
 * **解压**方向的格式名：在压缩格式名后面加一个 `+`（`'deflate-raw+'` / `'deflate+'` / `'gzip+'`）。
 *
 * ## 为什么方向要写进这个字符串（而不是另开一个注入成员）
 *
 * 真件里"压"和"解"是**两个不同的构造函数**（`CompressionStream` / `DecompressionStream`），
 * 而注入缝只有一个 `compressionStream(mode)`。老口径用 `'compress' | 'decompress'` 表达方向，
 * 那时格式名写死（只有 `deflate-raw`）所以够用；T40 起格式名也进了这个参数，
 * 于是"方向 + 格式"两件事必须都在同一个字符串里 —— **`+` 就是那个方向位**。
 *
 * 这样做的直接好处：**假件不可能把两个方向搞混**（老口径只有 `'deflate'` 一个词，
 * 假件分不清"压 gzip"与"解 gzip"）。判据 ④ 要逐档读两个方向，这一点必须是可判的。
 */
export type DecompressFormat = 'deflate-raw+' | 'deflate+' | 'gzip+';

/** 解压格式名（按降级链顺序；判据 ④ 逐档读它） */
export const DECOMPRESS_FORMATS: readonly DecompressFormat[] = ['deflate-raw+', 'deflate+', 'gzip+'];

/** 解压格式名 → 纯层的档名 */
const KIND_OF_DECOMPRESS_FORMAT: Readonly<Record<DecompressFormat, 'raw' | 'deflate' | 'gzip'>> = {
  'deflate-raw+': 'raw',
  'deflate+': 'deflate',
  'gzip+': 'gzip',
};

/** 解压格式名 → 纯层的档名（**判据 ④ 的读数面**：把"这一档解压能力试过没有"读成档名） */
export function kindOfDecompressFormat(format: DecompressFormat): CompressionKind {
  return KIND_OF_DECOMPRESS_FORMAT[format];
}

/**
 * 解压格式名 → 压缩格式名（**去掉方向位**）。
 *
 * ⚠️ 只有真的带 `+` 时才切：`'deflate-raw'` 这类**压缩**格式名直接原样返回。
 * 曾经写成无条件 `slice(0, -1)`，于是 `'deflate-raw'` 被切成 `'deflate-ra'`
 * ⇒ 降级链每一档的构造都抛 `TypeError` ⇒ 一路退到"不压缩"（**实测抓到的坑**：
 * 那次真机上一条 600 字符的码会变成 1600 字符，而屏上还显示成功）。
 */
export function compressFormatOf(format: CompressionFormat | DecompressFormat): CompressionFormat {
  return (format.endsWith('+') ? format.slice(0, -1) : format) as CompressionFormat;
}

/**
 * ★ **一个模式串的完整解读**（判据 ④ 与所有假件共用这一处，别各写一份）。
 *
 * 把 `CompressionStreamMode` 拆成三件事：**方向**（压 / 解）、**格式名**、**这一档的纯层名字**。
 * 老口径两个字也在这里折成"`deflate-raw` + 方向" ⇒ 老调用点与新调用点走**同一套**解读，
 * 假件不可能把两个方向搞混。
 */
export interface CompressionModeRead {
  /** `true` = 解压（用 `DecompressionStream`），`false` = 压缩 */
  readonly decompress: boolean;
  /** 格式名（不含方向位） */
  readonly format: CompressionFormat;
  /** 纯层的档名（`raw` / `deflate` / `gzip`） */
  readonly kind: CompressionKind;
}

export function readCompressionMode(mode: CompressionStreamMode): CompressionModeRead {
  if (mode === 'compress') return { decompress: false, format: 'deflate-raw', kind: 'raw' };
  if (mode === 'decompress') return { decompress: true, format: 'deflate-raw', kind: 'raw' };
  const decompress = mode.endsWith('+');
  const format = compressFormatOf(mode as DecompressFormat);
  return { decompress, format, kind: KIND_OF_FORMAT[format] };
}

/**
 * 注入缝 `NetBrowserEnv.compressionStream` 的入参。
 *
 *  - `'compress'`：压缩，格式 `deflate-raw`（**老调用点的语义，逐字不变**）；
 *  - `'decompress'`：解压 `deflate-raw`（**老调用点的语义，逐字不变**）；
 *  - `'deflate-raw' | 'deflate' | 'gzip'`：**压缩**成这一档；
 *  - `'deflate-raw+' | 'deflate+' | 'gzip+'`：**解压**这一档（`+` 是方向位，见 `DecompressFormat`）。
 *
 * ⚠️ **故意只有这一个成员、而不是加一个 `decompressionStream`**：判据 1（唯一出处）那条腿
 * 扫的是"浏览器 API 出现在哪个文件"，多一个成员不会更安全，只会让两处的默认实现漂移。
 */
export type CompressionStreamMode = 'compress' | 'decompress' | CompressionFormat | DecompressFormat;

/**
 * 格式名 → `CompressionKind`（纯层的名字）。**一一对应**，只有这一处。
 *
 * 两套名字的存在理由：格式名是浏览器 API 的字符串（`new CompressionStream('gzip')`），
 * 而 `CompressionKind` 是载荷标记与解压器表用的名字（纯层不认识浏览器 API）。
 */
const KIND_OF_FORMAT: Readonly<Record<CompressionFormat, 'raw' | 'deflate' | 'gzip'>> = {
  'deflate-raw': 'raw',
  deflate: 'deflate',
  gzip: 'gzip',
};

/** `kind → 格式名`（解压侧按标记选格式用；`'none'` 没有格式名） */
const FORMAT_OF_KIND: Readonly<Record<'raw' | 'deflate' | 'gzip', CompressionFormat>> = {
  raw: 'deflate-raw',
  deflate: 'deflate',
  gzip: 'gzip',
};

/** 压缩格式名 → 解压格式名（`+` 是方向位） */
const DECOMPRESS_OF_FORMAT: Readonly<Record<CompressionFormat, DecompressFormat>> = {
  'deflate-raw': 'deflate-raw+',
  deflate: 'deflate+',
  gzip: 'gzip+',
};

/** ★★ **G5/T40 的降级链顺序**（判据 ④ 逐档读的就是它）：先 deflate-raw，再一次退，最后不压缩 */
export const COMPRESSION_FALLBACK: readonly CompressionFormat[] = ['deflate-raw', 'deflate', 'gzip'];

type EnvGlobal = {
  RTCPeerConnection?: new (config: unknown) => PeerConnectionLike;
  WebSocket?: new (url: string) => WebSocketLike;
  /**
   * 压缩 / 解压流的构造函数。
   *
   * ⚠️ 返回类型写成 `unknown`（而不是某个具体结构）：本文件只需要"构造它、把它交给
   * `pipeThrough`"这两件事，`pipeThrough` 那一步本来就在 `as` 之外（类型面够用就行）。
   * **构造会抛**（不支持的格式抛 `TypeError`），这正是降级链要真去试的原因。
   */
  CompressionStream?: CompressionStreamCtor;
  DecompressionStream?: CompressionStreamCtor;
  Blob?: new (parts: readonly Uint8Array[]) => { stream(): unknown };
  Response?: new (body: unknown) => { arrayBuffer(): Promise<ArrayBuffer> };
  crypto?: CryptoLike;
  location?: LocationLike;
  history?: HistoryLike;
};

/** `CompressionStream` / `DecompressionStream` 的构造面（两个构造函数的形状逐字相同） */
export type CompressionStreamCtor = new (format: string) => unknown;

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
    /**
     * ★★ **G5/T40：格式名在这里落地**。
     *
     * 默认实现只做一件事：**真去 `new CompressionStream(format)` / `new DecompressionStream(format)`**
     * （构造成功才算这台设备支持这一档）。"支持不支持"的判据**不许靠 UA 猜** ——
     * 用户真机事故就是一台设备对 `deflate-raw` 直接抛
     * `TypeError: Failed to construct 'CompressionStream': Unsupported compression format: 'deflate-raw'`，
     * 而 UA 上看不出任何区别。
     *
     * ⚠️ 构造**可能抛**（不支持的格式就是抛 `TypeError`）。这里**故意不吞**：
     * 探测（`probeCompressionFormat`）与降级链（`compressBytesWithFormat`）都在各自的
     * `try` 里接住它，并把它翻成**人话**（判据 ⑤：原始异常字符串永远到不了界面）。
     */
    compressionStream: (mode) => {
      return {
        run: async (input) => {
          // ★ 模式串的解读只有一处（`readCompressionMode`）：压 / 解两个构造函数 + 格式名
          const read = readCompressionMode(mode);
          const ctor = read.decompress ? g().DecompressionStream : g().CompressionStream;
          if (ctor === undefined) {
            // 这台设备连这两个构造函数都没有（老浏览器 / 非安全上下文）
            throw new Error(`这台设备没有压缩流能力（缺少 CompressionStream，格式 ${read.format}）。`);
          }
          const BlobCtor = g().Blob;
          const ResponseCtor = g().Response;
          if (BlobCtor === undefined || ResponseCtor === undefined) {
            throw new Error('这台设备缺少把字节喂进压缩流所需的两个内置对象。');
          }
          // ★ 构造放在这里：不支持的格式**当场抛**，由调用方的 try 接住（见上面的说明）
          const stream = new ctor(read.format);
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
 * ★★ **G5/T38 起，这里的裁决变了**：默认不再是"一个中继都没有"，而是**默认就带一台中继**。
 *
 * ## 新的事实
 *
 * 用户 2026-09-25 的裁决（原话）："如果两人使用开发的连接方式连接不上时，就走这个服务器
 * 通过这个服务器去实现我的要求"、"记得尽量不要让玩家手动填各种参数啥的，尽量自动通过
 * 已预先设置好的去连接懂我意思吗"。服务器侧由协调者带起并**从外网实测通过**：`8.130.97.243`
 * 上的 coturn 同时当 STUN 与 TURN 用（`:3478`，UDP/TCP 都通，中继端口段 `49152-49200`），
 * 实测收到过 `relay 8.130.97.243:49171`（udp）与 `relay 8.130.97.243:49195`（tcp 档），
 * 原文 `.superpowers/g5-server/turn-probe.json`。
 *
 * ⇒ 默认第一项是这台 coturn 的 TURN（带长期凭据）。
 * **直连打不通时（比如两边都在管得很严的网络里）会自动经这台中继转发**，玩家零填写。
 *
 * ## ★★ G5/T40：这里**删掉了**那条 `stun:8.130.97.243:3478`（多余且报错）
 *
 * 用户真机体检（2026-09-27，Chromium 97 平板，协调侧 `probe.html`）的读数：
 * `stun:8.130.97.243:3478` 回 `code=701 STUN server address is incompatible`，
 * 而**同一个 `:3478`** 的 `turn:` 那项**正常**产出了 `relay udp 8.130.97.243:49181`。
 *
 * 为什么这条 STUN 是多余的（机制，不是猜测）：TURN 的分配流程本身就包含一次 Binding 请求，
 * WebRTC 的实现会在 `turn:` 这一项上**照样**产 `srflx` 候选 —— 也就是说这台服务器能给的
 * 公网映射，`turn:` 那一项**已经给全了**，`stun:` 那一项一个字节的额外能力都没有。
 * 而它每次协商都会多打一行 701（那台服务器在 NAT 后，返回的映射地址与配置地址不一致，
 * 规范要求客户端把它判为"地址不兼容"并拒绝）。
 *
 * ⇒ 删掉它只有好处：少一条服务器错误、少一次无用的 `:3478` 请求。
 * **这不影响"中继仍然在默认路径上"** —— 判据 9 的 ①/② 钉的是那一项 `turn:`，
 * 而 `readIceServers()` 的 `relayConfigured` / `relaySource: 'builtin'` 一个字都没动
 * （`tests/ui/net-browser.test.ts` 判据 9 那组腿当场自证）。
 *
 * ⚠️ **T38 那条老断言的更正**：T38 时这里写着"实测 srflx 就是它给的"并据此要求它必须在。
 * 真机读数说明那句话**归因错了**：给 srflx/relay 的是 `turn:` 那一项。
 * 老断言已在同一次改动里改成"**不许**再有一条指向这台服务器的 `stun:`"（带日期与出处）。
 *
 * ## ★★ G6/T50：**凭据不再内联在这里**（B1 的落地）
 *
 * 下面那一格（T38 写的"默认值必须自带一套能用的凭据"）当时的代价是把**永久有效**的
 * 用户名/密码打进了前端 JS ⇒ 白嫖中继的成本 = 0。B1 把它换成"**开局前向签发服务换一份
 * 短时凭据**"：
 *  - 这一份数组里**只剩地址**（`turn:8.130.97.243:3478`，没有 `username` / `credential`）；
 *  - 凭据由 `readIceServers` 在**运行时**从 `settings.appTurnUsername` / `appTurnCredential`
 *    合上（宿主先经 `turn-cred.ts` 取好再放进来，见那里的说明）；
 *  - **拿不到凭据 ⇒ 这一项整个不进 `iceServers`**（降级成直连），屏上如实说
 *    "这一轮没有中继可用"（`relayUnavailableNoteOf`）。
 *
 * ⇒ 判据 9 的意图一个字没变（"默认那台是这台已实测通过的服务器、而且只有一台"），
 * 变的是"凭据从哪来"：**从签发服务来，不再从仓库来**（T50 判据 5：全仓与前端产物 grep 0 命中）。
 *
 * ## 判据 9 为什么是这三条（**不许**为了让它绿而把中继删掉）
 *
 * 原判据 9 钉的是"默认 `iceServers` 每一项都不是 `turn:` / `turns:`"，当时是对的
 * （中继只能由玩家自配）。它现在与新事实**直接冲突** ⇒ 改成钉这三条：
 *  ① 默认里**必须有一项**中继，且主机就是这台服务器（"连不上时走服务器"在默认路径上存在）；
 *  ② 中继那一项**必须带凭据**（没凭据的默认中继在真实网络里必然 401，等于没有）；
 *  ③ 玩家自己配的中继仍然由 `readIceServers` 追加，本数组里不出现玩家那一项。
 * 判据 9 的**意图没变**（"默认值不许偷偷替玩家接一台来路不明的中继"），变的是事实。
 *
 * ## 为什么留着那两个 Google STUN
 *
 * 它们是后备（T16 加 Cloudflare 是同一个理由：厂商冗余）。**实测从这里发不出去**
 * （`stun:stun.l.google.com:19302` 回 `errorCode 701`，见上面那份探测原文）。
 * 它们与本机那台 **不同**：它们是**独立的一台服务器**，在别的网络环境下可能真给到公网映射
 * （那是"多一条路"），而这台本机的 `stun:` 是"同一台服务器上的第二次问话"（重复而不是冗余）
 * —— 差别就在这里：前者留，后者删。
 * 不通也不会拖慢：ICE 自己会挑，`waitForIceGathering` 的上界到点就用已经拿到的候选。
 */
export const DEFAULT_ICE_SERVERS: readonly IceServerLike[] = [
  // ★ 主力：这台 coturn 的 TURN（`:3478`）。**只有地址**，凭据在运行时合上（见上面那段）。
  //   **不再单列一条同址的 `stun:`**（见上面那段）
  { urls: ['turn:8.130.97.243:3478'] },
  // 后备：公共 STUN（实测从这里不通，只为别的网络环境留着；不通不会拖慢）
  { urls: ['stun:stun.l.google.com:19302'] },
  { urls: ['stun:stun1.l.google.com:19302'] },
  { urls: ['stun:stun.cloudflare.com:3478'] },
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
  /**
   * 这份 `iceServers` 里有一项**能用的**中继（默认内置的那台，或玩家自己配齐的那台）。
   *
   * ⚠️ T38 起语义从"玩家配了中继"收紧成"这份配置里有能用的中继"：默认值现在自带一台，
   * 而大厅那条中继隐私说明由它触发 —— 那句话本来就该在屏上（见 `net-lobby.ts` 的 `relayNoticeOf`）。
   */
  readonly relayConfigured: boolean;
  /** 填了 URL 但用户名 / 凭据不齐 —— 玩家那一项**没有**被换上，但这件事要能被说出来 */
  readonly relayIncomplete: boolean;
  /**
   * 这一份 `iceServers` 里的那一项中继**是怎么来的**：
   *  - `'player'` = 三项齐全，那一项是按玩家给的地址/凭据写进去的
   *    （内容可能**恰好等于**产品默认值 —— 那是 T38 把三项预填成默认值的结果，
   *    要分辨"没动过"和"玩家改过"请看 `settingsAreDefault`，不要看这个字段）；
   *  - `'builtin'` = 三项不齐（含"只填了一半"）⇒ 用的是 `DEFAULT_ICE_SERVERS` 里那台；
   *  - `'none'` = 这一份里没有能用的中继。
   */
  readonly relaySource: 'player' | 'builtin' | 'none';
  /**
   * ★★ **这三项设置是不是"没被玩家动过"**（= 与产品默认预填值逐字相同）。
   *
   * ## 为什么必须与 `relaySource` 分开（T38 实测推出来的）
   *
   * T38 把大厅那三项**预填成默认值**了 ⇒ "设置里有内容"不再等于"玩家改过"，
   * 而 `readIceServers` 的"三项齐全就按玩家给的写"那一支**只看内容形状**
   * ⇒ `relaySource` 在默认状态下也报 `'player'`。两个后果：
   *  1. **判据 3 的证据读不出区别**（默认与玩家覆盖长得一样）—— 所以有本字段；
   *  2. `waitForIceGathering` 的**严格档**（"中继没到手就不算够用、必须等满上界"）
   *     若按 `relaySource === 'player'` 二分，**每一次出邀请码都会等满 15 秒上界**
   *     （宽限档也被跳过）。严格档的语义前提是"**玩家指定了一台中继，早退不许把它砍掉**"
   *     ⇒ 只有本字段为 `false` 时才该生效（见 `waitForIceGathering` 里的取法）。
   */
  readonly settingsAreDefault: boolean;
  /**
   * ★★ **G6/T50（B1）：这份列表里**没有**可用中继时的原因**（`null` = 有中继，或玩家自己
   * 配了一半那种另有说法的情形）。
   *
   * 为什么要有它：降级是一条**要对玩家说清楚**的决定 —— "这一轮只能试直连"必须带上
   * "为什么"（凭据服务没回应 / 拒绝了 / 回的格式读不懂 / 连不上）。屏上那行由
   * `relayUnavailableNoteOf` 从它拼出来，**不是**在渲染层另写一句。
   */
  readonly relayUnavailableReason?: RelayUnavailableReason;
  /**
   * ★★ **G6/T50**：`relayUnavailableReason === 'credential-unavailable'` 时，
   * **为什么没换到**（`turn-cred.ts` 的那四种；屏上那句话里会带上它）。
   */
  readonly relayCredentialFailure?: TurnCredentialFailure;
  /**
   * ★★ **G6/T50**：这一刻手上有**哪一份**凭据（`'app'` = 从签发服务换来的短时凭据；
   * `'player'` = 玩家自己在高级设置里填的那一组）。
   *
   * 它是**给屏上与探针看的读数**，不参与任何判定（判定只看 `relayConfigured`）。
   */
  readonly relayCredentialSource?: 'app' | 'player' | 'builtin-fallback';
}

/**
 * ★★ **G6/T50**：没有可用中继的两条来路。
 *
 *  - `'credential-unavailable'`：产品那台中继**要凭据**，而这一轮**没换到**（签发服务
 *    超时 / 拒绝 / 回的格式读不懂 / 连不上）⇒ 降级成直连；
 *  - `'not-configured'`：既没有产品凭据、玩家也没配自己的中继 ⇒ 这一份里本来就没有中继。
 */
export type RelayUnavailableReason = 'credential-unavailable' | 'not-configured';

/**
 * ★★ **2026-09-29：内置的"B1 上线前兜底静态凭据"已经删掉了，别再往回加。**
 *
 * 它存在的那段时间（T50 到 B1 上线之间）是有理由的：线上 coturn 还是 `lt-cred-mech`、
 * `/turn-cred` 还不存在，把端点缺省成 `'/turn-cred'` 会把线上中继当场弄没。所以当时的缺省是
 * "端点没配 ⇒ 用内置那台 coturn + 一对临时静态凭据"，并在代码里显式标了"上线时与端点一起删"。
 *
 * 2026-09-29 这一步做完了：签发服务在线上跑着、端点缺省就是同源 `'/turn-cred'`、coturn 换成了
 * `use-auth-secret`。**一对长期凭据内联在客户端里、而仓库是公开的** —— 那对密码等于公开的，
 * 轮换也没有意义（旧值还在 git 历史里）。所以现在的口径是：
 *
 *  - 换到服务端签发的凭据（600 秒有效期）⇒ 用产品那台中继（`relayCredentialSource: 'app'`）；
 *  - 没配端点 / 配了却取不到 ⇒ **真的没有中继**，降级直连并把原因说出来。
 *
 * 见 `server/turn-cred/RUNBOOK.md` 与 `docs/2026-09-28-账号体系与中继凭据-待开发方案.md`。
 */

/**
 * ★★ **G6/T50：把"为什么没有中继"说成玩家能懂的一句**（屏上那行用；**唯一**措辞出处）。
 *
 * 措辞纪律（照 `privacy.ts` 那条）：说事实、给出下一步，不用内部标识符。中继那句隐私说明的
 * 唯一出处仍是 `src/app/privacy.ts`（这一句只在**没有中继**时说，与它不冲突）。
 */
export function relayUnavailableNoteOf(read: IceServersRead): string | null {
  if (read.relayUnavailableReason === undefined) return null;
  if (read.relayUnavailableReason === 'credential-unavailable') {
    const why = read.relayCredentialFailure === undefined
      ? '' : `（${describeTurnCredentialFailure(read.relayCredentialFailure)}）`;
    return `这一轮没有中继可用${why}，只能试直连：同一个局域网里一般能直接连上，`
      + '跨网络就不一定了。过一会儿再点一次试试。';
  }
  return '这一轮没有中继可用，只能试直连：同一个局域网里一般能直接连上，跨网络就不一定了。';
}

/** 三项连接设置长什么样（`settingsAreDefault` 要与它逐字比） */
type TurnSettingsShape = { readonly turnUrl?: string; readonly turnUsername?: string; readonly turnCredential?: string };

/**
 * ★ **这三项是不是"就是产品默认值"**（逐字比：`turnUrl` 去过首尾空白，凭据原样比）。
 *
 * 单独一个函数（而不是写在 `readIceServers` 里）是为了让调用方与它**共用同一处判定**：
 * 门禁要回答"玩家到底改没改过"，而这份判定不许有两个家。
 *
 * ## 调用者（T38 收尾时核过，不是死代码）
 *
 *  - `src/main.ts` 的 `__g5Match.ice()`（`#g5probe=1` 的只读探针）—— 判据 3 的"改前/改后"证据靠它；
 *  - `tests/ui/net-browser.test.ts` 的 T38 腿（正向 + 反证）；
 *  - ⚠️ **`waitForIceGathering` 现在不调它**：那条口径在 T38 被真浏览器读数推翻
 *    （默认档也必须等 relay 到手），它只读 `readIceServers(settings).relayConfigured`。
 *    所以浏览器层里 `defaultTurnShape()` 暂时没有调用者（见那个函数的说明）。
 */
export function turnSettingsAreDefault(
  settings: NetSettingsLike | null | undefined,
  defaults: TurnSettingsShape,
): boolean {
  // 先说清"这一份空到什么程度"：**三项都没有**是"没给设置"（题设里到处都有这种调用：
  // `readIceServers(undefined)` / `waitForIceGathering(pc, { ticker })`），它既不是
  // "就是默认值"、也不是"玩家改过"。
  const raw = [settings?.turnUrl, settings?.turnUsername, settings?.turnCredential];
  if (raw.every((v) => typeof v !== 'string' || v.trim().length === 0)) return false;
  const url = typeof settings?.turnUrl === 'string' ? settings.turnUrl.trim() : '';
  const user = typeof settings?.turnUsername === 'string' ? settings.turnUsername : '';
  const cred = typeof settings?.turnCredential === 'string' ? settings.turnCredential : '';
  return url === (defaults.turnUrl ?? '')
    && user === (defaults.turnUsername ?? '')
    && cred === (defaults.turnCredential ?? '');
}

/**
 * 产品默认预填的 TURN 三项（= `DEFAULT_ICE_SERVERS` 里那一项中继）。
 *
 * ## 谁在用（T38 收尾时核过）
 *
 *  - **导出面**：判据 3 的证据面与测试都用它当"默认长什么样"的**对照物**，
 *    不自己手写一份同形状的字面量（那会让"默认值改了、对照物没跟着改"变成假绿）；
 *  - `src/main.ts` 的 `__g5Match.ice()` 也用它（它自己那份 `defaultTurnSetting()` 是
 *    从同一处 `DEFAULT_ICE_SERVERS` 取的，两个函数是同源的两个投影）；
 *  - ⚠️ **`waitForIceGathering` 不调它**：那条口径在 T38 被真浏览器读数推翻
 *    （默认档也必须等 relay 到手，见那里的注释），它只读 `readIceServers(settings).relayConfigured`。
 */
export function defaultTurnShape(): { turnUrl: string; turnUsername: string; turnCredential: string } {
  const relay = DEFAULT_ICE_SERVERS.find((s) => s.urls.some(isRelayUrl));
  return {
    turnUrl: relay?.urls.find(isRelayUrl) ?? '',
    turnUsername: typeof relay?.username === 'string' ? relay.username : '',
    turnCredential: typeof relay?.credential === 'string' ? relay.credential : '',
  };
}

/**
 * ★ 读 `iceServers`（D14；T38 起默认那台在，**T50 起凭据是运行时换来的**）。
 *
 * 四种形态（`settingsAreDefault` 由调用方给：它说的是"玩家那三项与产品默认预填值一样吗"，
 * 那个判定住在 `turnSettingsAreDefault` 一处，本函数不重复实现 —— 它只认内容形状）：
 *  - **玩家三项填齐** ⇒ 卡片与 STUN 照默认值给，但**中继那一项按玩家给的写**
 *    （不是"两台都留着"）：改完以玩家的为准 —— 他要是把地址写错了，用不上的就是他写的那台，
 *    而不是我们悄悄把他接回默认那台。`relaySource: 'player'`、`relayCredentialSource: 'player'`；
 *  - **玩家三项为空 + 有产品凭据** ⇒ 默认那台地址 + 这一轮换到的短时凭据。
 *    `relaySource: 'builtin'`、`relayConfigured: true`、`relayCredentialSource: 'app'`；
 *  - **只填了一半**（有 URL 没凭据）⇒ 玩家那项不换上，也不报"配好了"；
 *    "配了一半"这件事必须让玩家看见（`relayIncomplete: true`），不静默忽略；
 *  - ★★ **没有可用凭据**（没给 / 取失败）⇒ **中继那一项整个不进 `iceServers`**（降级成直连），
 *    并把原因写进 `relayUnavailableReason`（屏上如实说"这一轮没有中继可用，只能试直连"）。
 *
 * ⚠️ **降级不是"用一份旧的硬编码凭据顶着"**：那样等于把 T38 的白嫖问题原样留下，
 * 而且屏上那句"没有中继可用"会变成假话（T50 判据 3/5 的变异正是这条错路）。
 */
/**
 * ★★ **G6/T50：把"有一份产品凭据"合进设置里**（`readIceServers` 的第三处输入）。
 *
 * 为什么合成**设置里的两个字段**、而不是给 `readIceServers` 再加一个参数：判定必须只有一处，
 * 而 `readIceServers` 的入参本来就是"一份设置"。合成之后：
 *  - `readIceServers(settings)` 与 `waitForIceGathering`（它也读同一份设置）看到的是**同一件事**；
 *  - 玩家自己的三项与产品凭据的**优先级**写在 `readIceServers` 一处（玩家齐全 ⇒ 玩家的赢）。
 *
 * 返回 `null` = 这一轮没有产品凭据（`read` 为空，或它报的是"没有"）。
 */
export function appCredentialOf(
  read: TurnCredentialRead | null | undefined,
): { readonly appTurnUsername: string; readonly appTurnCredential: string } | null {
  if (read === null || read === undefined || !read.available) return null;
  const c: TurnCredential = read.credential;
  if (c.username.length === 0 || c.credential.length === 0) return null;
  return { appTurnUsername: c.username, appTurnCredential: c.credential };
}

/** ★★ **G6/T50：这个 `turn:` URL 是不是产品默认那台**（凭据要合在它身上，不能合到玩家那台） */
function isDefaultRelayUrl(url: string): boolean {
  return DEFAULT_ICE_SERVERS.some((s) => s.urls.includes(url));
}

export function readIceServers(
  settings?: NetSettingsLike | null,
  settingsAreDefault = false,
  /** 这一刻的凭据读数（缺省 = 没有：老调用点与测试因此天然走"降级成直连"那一档） */
  credentialRead?: TurnCredentialRead | null,
): IceServersRead {
  /**
   * 打开默认值：这份数组里**最多一项中继**（就是默认那台），打开的人可以在它身上做覆盖。
   * 逐字段拷（不整对象展开）：`IceServerLike` 的可选字段在 `exactOptionalPropertyTypes`
   * 下不许被显式写成 `undefined`，这里只把**真的存在**的那些键带过去。
   */
  const openDefaults = (): IceServerLike[] => DEFAULT_ICE_SERVERS.map((s) => ({
    urls: [...s.urls],
    ...(typeof s.username === 'string' ? { username: s.username } : {}),
    ...(typeof s.credential === 'string' ? { credential: s.credential } : {}),
  }));
  /** 默认那台的中继 URL（认它只认 `isRelayUrl` 这一个出处） */
  const defaultRelayUrl = (): string =>
    DEFAULT_ICE_SERVERS.flatMap((s) => [...s.urls]).find(isRelayUrl) ?? '';

  const url = typeof settings?.turnUrl === 'string' ? settings.turnUrl.trim() : '';
  const username = typeof settings?.turnUsername === 'string' ? settings.turnUsername : '';
  const credential = typeof settings?.turnCredential === 'string' ? settings.turnCredential : '';
  // ★ T50：默认那台**只有地址**（凭据运行时合上）⇒ 这一句是"默认那台地址"的唯一读取点，
  //   下面每一支都从它取（"把默认那台摘掉"也就有了一个可读的锚）。
  const defaultRelay = defaultRelayUrl();

  /** ① 玩家三项齐全 ⇒ 按玩家的写（**优先**，与 T38 同口径） */
  if (url.length > 0 && username.length > 0 && credential.length > 0) {
    const cover = isRelayUrl(url) ? url : `turn:${url}`;
    const replaced = openDefaults().filter((s) => !s.urls.some(isRelayUrl));
    replaced.push({ urls: [cover], username, credential });
    return {
      servers: replaced,
      relayConfigured: true,
      relayIncomplete: false,
      relaySource: 'player',
      settingsAreDefault,
      relayCredentialSource: 'player',
    };
  }

  /** 玩家那一项配了一半：这件事要能被说出来（下面各支都带着它） */
  const halfConfigured = url.length > 0 && (username.length === 0 || credential.length === 0);

  /** 产品那一份：设置里带了"服务端换来的"两个字段 ⇒ 用默认那台地址 + 这份凭据 */
  const appUser = typeof settings?.appTurnUsername === 'string' ? settings.appTurnUsername : '';
  const appCred = typeof settings?.appTurnCredential === 'string' ? settings.appTurnCredential : '';
  const appRelay = appUser.length > 0 && appCred.length > 0 ? { username: appUser, credential: appCred } : null;

  /**
   * ★★ **G6/T50 + B1（2026-09-29 上线）**：有中继 ⇔ **这一轮真的拿到了服务端换来的凭据**。
   *
   * 上线前这里还有一条"端点没配 ⇒ 用内置那对临时静态凭据"的兜底支路（T50 到 B1 之间的
   * 部署安全窗口），已随 B1 一起删掉：现在"没配端点"与"配了却取不到"都归到下面那条降级路 ——
   * 只是原因不同（`'not-configured'` 与 `'credential-unavailable'`），屏上那两句话也不一样。
   */
  if (appRelay !== null) {
    const servers = openDefaults().map((s) => (s.urls.includes(defaultRelay)
      ? { urls: [...s.urls], username: appRelay.username, credential: appRelay.credential }
      : s));
    /**
     * ⚠️ `relayConfigured` 读的是**列表里真的有一项能用的中继**（= 产品这一份在不在），
     * **不是**"玩家那一项被采纳了"：玩家"配了一半"时产品那一份仍然带着有效凭据在列表里，
     * 于是它照样为真 —— 而"玩家那一项没被用上"由 `relayIncomplete` 单独说。
     * （旧口径把这两件事合成一个布尔，会让"玩家配了一半"顺带把产品的中继也一起否掉。）
     */
    return {
      servers,
      relayConfigured: servers.some((s) => s.urls.some(isRelayUrl)),
      /**
       * ★ **判据 9 的既有语义一字不改**：`relayIncomplete` 说的是"**玩家那一项**没被用上"
       * （他填了 URL 却没填用户名/凭据）。这一格**不许**因为"产品那台还能用"就把它抹成 `false`
       * —— 那条判据钉的是"配了一半这件事必须被报出来"。
       *
       * 于是它与 `relayConfigured` 是两个读数、各说各的事（屏上那句该不该说，由
       * `net-lobby.ts` 的 `relayStateOf` 按 `relayConfigured` **优先**判，见那里的说明）。
       */
      relayIncomplete: halfConfigured,
      relaySource: 'builtin',
      settingsAreDefault,
      relayCredentialSource: 'app',
    };
  }

  /**
   * ★★ **降级**：这一轮**没有可用的产品凭据** ⇒ 默认那台**整个摘掉**（只剩 STUN），并把原因如实报出来。
   *
   * B1（2026-09-29）之后两种原因都走这条路，分得清清楚楚：
   * `'not-configured'` = 这个宿主压根没接签发服务；`'credential-unavailable'` = 配了却没换到。
   */
  const noRelay = openDefaults().filter((s) => !s.urls.some(isRelayUrl));
  const unavailable = credentialRead !== null && credentialRead !== undefined && !credentialRead.available;
  return {
    servers: noRelay,
    relayConfigured: false,
    relayIncomplete: halfConfigured,
    relaySource: 'none',
    settingsAreDefault,
    relayUnavailableReason: unavailable ? 'credential-unavailable' : 'not-configured',
    ...(unavailable && credentialRead !== null && credentialRead !== undefined
      ? { relayCredentialFailure: credentialRead.reason } : {}),
  };
}

/* ================================================================== *
 * 5. 压缩 / 解压：★ G5/T40 的**降级链**（判据 7 + 判据 ④）
 *
 * 事故形状（用户 2026-09-27 截图）：某台设备上 `new CompressionStream('deflate-raw')`
 * 直接抛 `TypeError: Failed to construct 'CompressionStream': Unsupported compression
 * format: 'deflate-raw'` ⇒ 邀请码**根本生成不出来**（屏上一句 `压缩没有完成: TypeError: …`）；
 * 另一端粘码得到"压缩段解不开"。两台设备**都**失败。
 *
 * 处置两条：
 *  ① 压缩能力改成**降级链**：`deflate-raw` → `deflate` → `gzip` → **不压缩**，
 *     用第一档**真能构造**的（判据不许猜 UA：真去 `new CompressionStream(format)` 试一次）；
 *  ② 玩家可见的失败必须是**人话**（原始异常字符串永远到不了界面）。
 * ================================================================== */

/** 压缩的读数（判据 7 断言的就是这些数；★ T40 多一个 `format` 与逐档 `probes`） */
export interface CompressResult {
  readonly ok: true;
  readonly bytes: Uint8Array;
  /** ★ T40：这一份字节是用哪一档压出来的（`'none'` = 没压） */
  readonly format: CompressionKind;
  readonly rawBytes: number;
  readonly compressedBytes: number;
  readonly ratio: number;
  readonly withinMeasuredRange: boolean;
  /**
   * ★ T40：走到这一档之前，降级链上试过的那几档（成功的这一档也在里面）。
   * 判据 ④ 的"每一档都被真的试过"读的就是它。
   */
  readonly probes?: readonly CompressionProbe[];
}

/**
 * 压缩 / 解压的失败形态（**不抛**：浏览器能力缺失是常态，不是异常）。
 *
 * ★ T40：多一个 `probes` —— "这台设备逐档试过什么"的读数。玩家看到的那句话由它拼出来，
 * **不是**原始异常串（判据 ⑤ 的落点）。
 */
export interface CompressFailure {
  readonly ok: false;
  readonly reason: 'unsupported' | 'failed';
  readonly message: string;
  readonly probes?: readonly CompressionProbe[];
}

/** 某一档压缩能力的**探测读数**（真构造过一次 `CompressionStream(format)` 的结果） */
export interface CompressionProbe {
  readonly format: CompressionFormat;
  /** 真构造成功了吗（**不许**靠 UA 猜：这条就是判据本身） */
  readonly supported: boolean;
  /** 失败时那句**原始**异常串（只在诊断读数里，**不许**进界面） */
  readonly note?: string;
}

/** 格式名 → 纯层的档名（降级链与探测读数共用这一处映射） */
export function kindOfFormat(format: CompressionFormat): CompressionKind {
  return KIND_OF_FORMAT[format];
}

/** 解压侧按标记选格式（`'none'` 没有格式名 ⇒ 返回 `null`，它不需要任何设备能力） */
export function formatOfKind(kind: CompressionKind): CompressionFormat | null {
  return kind === 'none' ? null : FORMAT_OF_KIND[kind];
}

/**
 * ★ 探测某一档压缩能力：**真去构造一次** `CompressionStream(format)`。
 *
 * 判据不许猜 UA —— 用户那台设备的 UA 与能用的设备**没有区别**，区别只在构造抛不抛。
 *
 * ## ★★ 为什么必须**穿过注入缝让它干一次活**（评审实测抓到的"诊断口在说谎"）
 *
 * 缺省实现（`defaultEnv().compressionStream`）把真构造**推迟到 `run()` 里**（那是它的形状：
 * 工厂只返回一个惰性流，构造发生在真正要压那一刻）。⇒ 只调工厂**探不到"不支持"**：
 * 把全局构造器换成"`deflate-raw` 构造即抛"之后，只调工厂的探测口**照样报 `supported: true`**
 * （评审复跑实测）。一个恒报 true 的诊断口比没有更坏 —— 它会给"这台设备到底支持哪几档"一个假答案。
 *
 * ⇒ 这里给一小段字节**真跑一遍**（`run()` 那条路），构造失败/运行失败都算"这一档不可用"。
 *
 * ⚠️ 只对**压缩档**（`CompressionFormat`）有意义：对某一档的**解压**探不了（拿一小段明文当
 * 压缩流喂进去必然 reject，那说明的是"输入不是压缩流"，不是"这一档不支持"）。
 * 解压侧的支持面由 `decompressBytes(bytes, env, kind)` 在真数据上如实回答。
 */
export async function probeCompressionFormat(format: CompressionFormat, env?: NetBrowserEnv): Promise<CompressionProbe> {
  const resolved: NetBrowserEnv = { ...defaultEnv(), ...env };
  try {
    const s = resolved.compressionStream?.(format) ?? null;
    if (s === null) {
      return { format, supported: false, note: '这台设备的浏览器没有压缩流能力（CompressionStream 缺失）。' };
    }
    // ★ 真构造一次（缺省实现在这一句里才 `new Ctor(format)`）
    await s.run(PROBE_INPUT);
    return { format, supported: true };
  } catch (e) {
    return { format, supported: false, note: rawErrorText(e) };
  }
}

/** 探测用的那一小段字节（几个字符，压/解都无副作用） */
const PROBE_INPUT = utf8Encode('t40-probe');

/**
 * ★★ **把一次真探测的结果，翻成给玩家看的人话**（判据 ⑤ 的唯一出口）。
 *
 * 规则：**原始异常字符串一个字符都不进界面**。下面每一句都只说"哪一档不行、这台设备还能怎么办"。
 * 界面上出现 `TypeError` 或 `Unsupported compression format` 就算这条判据红 ——
 * 那正是用户截图里那两串东西。
 *
 * ## 为什么要逐档说（而不是一句"这台设备不支持压缩"）
 *
 * 逐档说是**能指导下一步**的真因：三档都失败 ⇒ 走不压缩（这条路仍然能出码，只是一条长码），
 * 所以玩家该看到的不是"生成失败"，而是"会给你一条更长的码"。四档全废才谈得上失败，
 * 而那种设备是"连 Blob / Response 都没有"的老浏览器，那句话里要让他换浏览器。
 */
export function readableCompressionFailureText(probes: readonly CompressionProbe[]): string {
  const failed = probes.filter((p) => !p.supported).map((p) => p.format);
  const ok = probes.filter((p) => p.supported).map((p) => p.format);
  if (failed.length === 0) {
    return '这台设备的压缩能力探测没有给出结果，邀请码没能生成。请刷新页面再试一次。';
  }
  if (ok.length === 0 && failed.length === COMPRESSION_FALLBACK.length) {
    return `这台设备的浏览器不支持本程序用到的任何一种压缩方式（${failed.join('、')}），`
      + '连"不压缩"那条兜底路也没走通。请换一个较新的浏览器打开本页再试。';
  }
  return `这台设备编不出邀请码：可用的压缩方式里，${failed.join('、')} 这一档用不了，`
    + `而不压缩那条兜底路也没走通（${ok.join('、')} 虽然探测通过，但没有产出可用的字节）。`
    + '请刷新页面再试一次；如果一直这样，换一个较新的浏览器打开本页。';
}

/** 原始异常 → 诊断用的一行字（**只进读数、不进界面**） */
function rawErrorText(e: unknown): string {
  const s = String(e);
  return s.length > 200 ? `${s.slice(0, 200)}…` : s;
}

/**
 * 把字节压成指定格式（`compressBytesWithFormat` 的单档口）。
 *
 * ⚠️ 构造**可能抛**（不支持的格式就抛 `TypeError`）—— 这里**故意接住并翻成人话**，
 * 因为这是"某几档不可用"的**正常情形**（正是降级链存在的理由），不是异常。
 */
export async function compressBytesWithFormat(
  raw: Uint8Array,
  format: CompressionFormat,
  env?: NetBrowserEnv,
): Promise<CompressResult | CompressFailure> {
  const resolved: NetBrowserEnv = { ...defaultEnv(), ...env };
  let stream: CompressionStreamLike | null;
  try {
    stream = resolved.compressionStream?.(format) ?? null;
  } catch (e) {
    return {
      ok: false,
      reason: 'unsupported',
      message: `这一档压缩方式（${format}）在这台设备上不可用，改用下一档。`,
      probes: [{ format, supported: false, note: rawErrorText(e) }],
    };
  }
  if (stream === null) {
    return {
      ok: false,
      reason: 'unsupported',
      message: '这台设备的浏览器没有压缩流能力，邀请码生成不了（对端仍可用"输 6 位码"那条路）。',
      probes: [{ format, supported: false, note: '压缩流能力缺失（CompressionStream / DecompressionStream 不存在）。' }],
    };
  }
  let out: Uint8Array;
  try {
    out = await stream.run(raw);
  } catch (e) {
    // ★ 用户截图里那串 `TypeError: …` 就是从这里冒出去的。现在它只进 `probes`（读数），
    //   玩家看到的是 `readableCompressionFailureText()` 拼的那句人话。
    //
    // ⚠️ `supported: false`（不是 true）：缺省实现的**构造发生在 `run()` 里** ⇒ 走到这一句
    //   说明"这一档在这台设备上产不出可用的字节"。标成 true 会让诊断读数与玩家看到的那句话
    //   互相矛盾（评审点名的"诊断口在说谎"同族）。
    return {
      ok: false,
      reason: 'failed',
      message: `这一档压缩方式（${format}）没有产出可用的字节，改用下一档。`,
      probes: [{ format, supported: false, note: rawErrorText(e) }],
    };
  }
  const ratio = raw.length === 0 ? 0 : out.length / raw.length;
  return {
    ok: true,
    bytes: out,
    format: kindOfFormat(format),
    rawBytes: raw.length,
    compressedBytes: out.length,
    ratio,
    withinMeasuredRange: out.length >= COMPRESSED_BYTES_MIN && out.length <= COMPRESSED_BYTES_MAX,
  };
}

/**
 * ★★ **G5/T40：按降级链压一次**（`deflate-raw` → `deflate` → `gzip` → 不压缩）。
 *
 * ## 每一档都要**真能往回解**才算这一档可用
 *
 * 只"压得出来"不够：`encodeInvite` 的自洽检查要求"压出来的解得动、且解出来还是那份载荷"。
 * 一台设备可能"压得出 gzip 但解不开 gzip"（两台构造函数的支持面本来就不同）⇒
 * 那样产出的邀请码发出去，**对端与它自己都解不回来**。所以这里对每一档多做一次真解压
 * （`decompressBytes(bytes, env, kind)`），解不回来就**继续降级**。
 *
 * ## 全都不成 ⇒ `'none'`
 *
 * 不压缩那一档是**兜底**：载荷就是 `payloadBytesOf()` 的 UTF-8 JSON 直接 base64url，
 * 对端只要有 base64url 就能解开（`decodeInviteText` 里 `'none'` 那一支不走任何设备能力）。
 * 它的代价是**长**（实测 1250 字符，同语料压缩档 631），不是"不能用"。
 *
 * ★★ **`preferKind`：先试这一档，成了就用它**。
 *
 * 为什么需要它（真浏览器门实测抓到的**跨机**缺陷）：两端**各按自己的**能力选档时，
 * 房主那台 `deflate-raw` 坏掉 ⇒ 它出 `-d` 码；而加入方那台好着 ⇒ 它产的回示码落在 `-r`
 * ⇒ **房主解不开自己那一局的回示码**（屏上"压缩段解不开"、两端停在 `handshaking`）。
 * ⇒ 回示码要**跟着邀请码那一档**走（那是唯一"两端都解得开"的选择：房主能产出那一档，
 * 就说明它能解那一档）。这一档在这台设备上不可用时**照旧降级**（宁可换档，也不要产不出来）。
 */
export async function compressBytesWithFallback(
  raw: Uint8Array,
  env?: NetBrowserEnv,
  preferKind?: CompressionKind,
): Promise<CompressResult | CompressFailure> {
  const resolved: NetBrowserEnv = { ...defaultEnv(), ...env };
  const probes: CompressionProbe[] = [];
  if (preferKind !== undefined) {
    const c = await compressOrNull(raw, preferKind, resolved);
    if (c !== null) {
      probes.push({
        format: formatOfKind(preferKind) as CompressionFormat,
        supported: true,
        note: `按调用方指定的档位（${preferKind}）产出（不再走降级链）。`,
      });
      return { ...c, probes };
    }
    probes.push({
      format: (formatOfKind(preferKind) ?? 'deflate-raw') as CompressionFormat,
      supported: false,
      note: `调用方指定的档位（${preferKind}）在这台设备上用不了，回退到降级链。`,
    });
  }
  for (const format of COMPRESSION_FALLBACK) {
    const c = await compressBytesWithFormat(raw, format, resolved);
    if (c.ok) {
      const back = await decompressBytes(c.bytes, resolved, kindOfFormat(format));
      if (back.ok) {
        // ★ 这一档可用：把它的读数记上，并给一句"它为什么是这一档"（前面跳过了哪些档）
        const skipped = probes.filter((p) => !p.supported).map((p) => p.format);
        probes.push({
          format,
          supported: true,
          ...(skipped.length === 0
            ? {}
            : { note: `降级链从这里开始可用（前面跳过了 ${skipped.join('、')}）。` }),
        });
        return { ...c, probes };
      }
      probes.push({ format, supported: true, note: `压得出但解不回来（${back.reason}），继续降级。` });
      continue;
    }
    // ★ 这一档不可用：把 `compressBytesWithFormat` 交回的**原始异常串**留在读数里
    //   （判据 ⑤ 要断言的正是"它只在这里、不在界面上"）
    probes.push(c.probes?.[0] ?? { format, supported: false });
  }
  // ★ 最后一档：**不压缩**。它不需要任何设备能力，所以永远不会"探测失败" ——
  //   它只需要"有那份字节"，而那份字节本来就在手上。
  const ratio = raw.length === 0 ? 0 : raw.length / raw.length;
  return {
    ok: true,
    bytes: raw,
    format: 'none',
    rawBytes: raw.length,
    compressedBytes: raw.length,
    ratio,
    withinMeasuredRange: false,
    probes,
  };
}

/**
 * 压成**指定那一档**并**验证解得回来**；任何一步不成就返回 `null`（**不抛**）。
 *
 * 它是"指定档位"那条路（`compressBytesWithFallback(..., preferKind)`）用的口径：
 * 与降级链里"压得出 + 解回来"两道检查**同一套**，只是不往下试别的档。
 */
async function compressOrNull(
  raw: Uint8Array,
  kind: CompressionKind,
  env: NetBrowserEnv,
): Promise<CompressResult | null> {
  if (kind === 'none') {
    return {
      ok: true,
      bytes: raw,
      format: 'none',
      rawBytes: raw.length,
      compressedBytes: raw.length,
      ratio: 1,
      withinMeasuredRange: false,
    };
  }
  const format = formatOfKind(kind);
  if (format === null) return null;
  const c = await compressBytesWithFormat(raw, format, env);
  if (!c.ok) return null;
  const back = await decompressBytes(c.bytes, env, kind);
  return back.ok ? c : null;
}

/**
 * 把字节压成 `deflate-raw`（**老口径**：`compressBytes` 的兼容面）。
 *
 * ⚠️ T40 起"邀请码的压缩"走 `compressBytesWithFallback`（带降级链）；本函数留着是因为
 * 它的老调用点（判据 7 的语料腿）钉的正是"deflate-raw 这一档本身压出多少字节"。
 * 它在 deflate-raw 不支持时**不再**给玩家抛原始异常，而是给人话。
 */
export function compressBytes(raw: Uint8Array, env?: NetBrowserEnv): Promise<CompressResult | CompressFailure> {
  return compressBytesWithFormat(raw, 'deflate-raw', env);
}

/** 把一段文本压成 `deflate-raw`（`compressBytes` 的文本口，判据 7 的语料走它） */
export function compressText(text: string, env?: NetBrowserEnv): Promise<CompressResult | CompressFailure> {
  return compressBytes(utf8Encode(text), env);
}

/** 解压的读数（`decompressBytes` 的失败**不抛**，与 `decodeInvite` 的结果对象同族） */
export type DecompressResult = { ok: true; bytes: Uint8Array } | { ok: false; reason: string; message: string };

/**
 * 把压缩段解回原文。`kind` 缺省 = `'raw'`（`deflate-raw`，**老口径逐字不变**）。
 *
 * `'none'` 是**恒等**：不压缩那一段没有可解的东西 ⇒ 原样交回（它不会失败）。
 *
 * **异步**（同 `compressText`）。这条是"纯层的解码入口为什么在浏览器侧"的答案：
 * `src/net/invite.ts` 的 `decodeInviteText` 需要一个**同步**的解压函数，
 * 而真实解压是异步的 ⇒ 调用方先 `await` 本函数，再把字节喂给 `decodeInvite`。
 *
 * ⚠️ **不许**把本函数（或它的 `Promise`）喂给 `src/net/session.ts` 的状态机 —— 那是 M7 那条错路。
 */
export async function decompressBytes(
  compressed: Uint8Array,
  env?: NetBrowserEnv,
  kind: CompressionKind = 'raw',
): Promise<DecompressResult> {
  if (kind === 'none') return { ok: true, bytes: compressed };
  const resolved: NetBrowserEnv = { ...defaultEnv(), ...env };
  const format = FORMAT_OF_KIND[kind];
  let stream: CompressionStreamLike | null;
  try {
    // ★ `'deflate-raw+' | 'deflate+' | 'gzip+'`：**解压**这一档（`+` 是方向位，见 `DecompressFormat`）
    stream = resolved.compressionStream?.(DECOMPRESS_OF_FORMAT[format]) ?? null;
  } catch (e) {
    // 这台设备没有这一档的解压能力（构造就抛）—— **不**把原始异常交给玩家
    return {
      ok: false,
      reason: 'unsupported',
      message: `这台设备的浏览器解不开这一档压缩（${format}）：${readableCompressionFailureText([{ format, supported: false, note: rawErrorText(e) }])}`,
    };
  }
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
  /**
   * ★★ **G5/T40：优先用这一档压**（回示码要跟邀请码同一档 —— 见
   * `compressBytesWithFallback` 的 `preferKind` 说明）。缺省 = 走完整降级链。
   * 这一档在这台设备上用不了时**照旧降级**（宁可换档，也不要产不出来）。
   */
  readonly preferKind?: CompressionKind;
  /**
   * ★★ **G6/T49**：这条码带什么进载荷。
   *  - 缺省 / `'compact'`：v3，**最小必要集**（没有整段 SDP）；
   *  - `'full'`：v2，整段 SDP 进载荷（缺凭据时的兜底，或"就是要老格式"的显式选择）。
   *
   * 紧凑档缺任一必要项时**自动退回** `'full'`（结果里的 `fallbackReason` 说的是为什么）。
   */
  readonly payloadFormat?: 'compact' | 'full';
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
  /** ★ G5/T40：这条码用的是哪一档编码（`raw` / `deflate` / `gzip` / `none`） */
  readonly format: CompressionKind;
  /** ★ G5/T40：压缩段的明文标记（`raw` 是空串 ⇒ 老格式 `N.<base64>`） */
  readonly marker: string;
  /**
   * ★ G5/T40：**当这一条是"不压缩"那一档时**，长度是否落在未压缩变体的实测上界内。
   * 压缩档恒为 `true`（`withinMeasuredRange` 才是它的判据）。
   */
  readonly withinUncompressedRange: boolean;
  /**
   * ★ G5/T40：这台设备逐档试过的**原始读数**（界面上不许出现里面的 `note` 原文；
   * 它是给人核对的诊断面，判据 ④ 读的就是它）。
   */
  readonly probes: readonly CompressionProbe[];
  /**
   * ★ G6/T49：紧凑档**没能用**、退回整段 SDP（v2）那一档时的**真因**（人话）；
   * 一直走紧凑档时为 `null`。这不是失败 —— 是那条兜底路真的走过一次的证据。
   */
  readonly fallbackReason: string | null;
  /**
   * ★ G6/T49：这一条码最终带的是哪一档载荷（`'compact'` = v3 最小必要集 / `'full'` = v2 整段 SDP）。
   * 调用方（大厅那句长度读数）拿它去选**这一档**的实测区间 —— 版本号住在压缩段里，
   * 只看字符判不出来。
   */
  readonly payloadFormat: 'compact' | 'full';
}

/** `createInvite` 的失败形态：压缩那条链的失败（带逐档读数）或纯层的编码拒绝 */
export type CreateInviteFailure =
  | CompressFailure
  | { readonly ok: false; readonly reason: string; readonly message: string; readonly probes?: readonly CompressionProbe[] };

/**
 * ★ 生成一条邀请码（链接形态 + 二维码形态的**同一条**载荷）。
 *
 * 载荷的形状（纯层的 `encodeInvite` 定的）是 `<协议版本>.<标记><压缩段>`：
 *  - 压缩段 = 按**降级链**压出来的字节的 base64url（T40：`deflate-raw` → `deflate` → `gzip`
 *    → 不压缩，用第一档真能构造的；压缩的对象是那份位置数组）；
 *  - 协议版本是明文十进制（握手第一步就比对它，D13）；标记说明用的是哪一档（`COMPRESSION_MARKERS`）。
 *
 * 压缩是**异步**的、而 `encodeInvite` 要一个**同步**的压缩函数：这里先 `await` 出字节，
 * 再把它当作"已经算好的结果"交给纯层（D15 那条"状态机不 await"的同一种缝法）。
 * **解压也一样**：先 `await decompressBytes()` 真解一遍，纯层拿到的才是"真的解得动"这个事实，
 * 而不是一个恒真的同一性检查。
 * **载荷只进 fragment**（判据 6）。
 *
 * ★★ **G6/T49：紧凑档（v3）是新的缺省**。`payloadFormat` 缺省 = `'compact'`：
 * 载荷里不再放整段 SDP，只放最小必要集（`ice-ufrag` / `ice-pwd` / DTLS 指纹 / 候选的
 * `type·地址·端口` / `a=setup` / 承诺位），对端本地重建一份最小可用 SDP。
 *
 * **兜底**（任务书 A4/A5）：缺 ICE 凭据 / DTLS 指纹 / 候选中的任何一项 ⇒ 这一档**不可用**，
 * 当场退回 `'full'`（v2，整段 SDP 进载荷），**不许**为了变小而少带那几样。
 * `fallbackReason` 记的就是"为什么退了"（探针与报告读它）。
 */
export async function createInvite(
  input: CreateInviteInput,
  env?: NetBrowserEnv,
): Promise<CreatedInvite | CreateInviteFailure> {
  const fields: InviteFields = {
    p: input.p,
    // ★ D 轮（I-3 甲）：房主这一局的会话号也进载荷（加入方照它建会话，两端才配得上对）
    sessionId: input.sessionId,
    sdp: input.sdp,
    ice: input.ice,
    hostPromise: input.hostPromise,
    guestPromise: input.guestPromise,
  };
  /**
   * ★★ **G6/T49：紧凑档那一半**。
   *
   * ## ICE 凭据只从 SDP 里取（**不许本地推**；第一版本地推，真机当场红）
   *
   * `a=ice-ufrag` / `a=ice-pwd` 是**这一条连接真正在用的那一对**：浏览器收下我们 advertised
   * 的 offer 之后，就按它校验对端发来的 STUN 请求。把它们换成"本端按 `sessionId` 推出来的
   * 另一串"会让两端的凭据对不上 —— `setRemoteDescription(offer)` 当场报
   * `InvalidAccessError: … Failed to apply the description for m= section with mid='0': Invalid ICE …`
   * （2026-09-28 真浏览器实测，见 `.superpowers/g6-T49/run-t49.txt`）。
   *
   * ⇒ SDP 里没有那两行（等 ICE 收集的上界档）时**退回 v2**（整段 SDP）：码会长一点，
   * 但那样至少是对的。`iceUfragOfSessionId()` / `icePwdOfSessionId()` 这对纯层工具因此
   * **产品路径不再使用**（留着只给"知道自己在做什么"的调用点）。
   */
  const mode: InvitePayloadMode = input.payloadFormat === 'full'
    ? { mode: 'full' }
    : { mode: 'compact' };
  let prefer: InvitePayloadMode = mode;
  let prepared = rawBytesForInvite(fields, prefer);
  /**
   * ★ 兜底那条路：紧凑档不可用（缺凭据 / 缺指纹 / 缺候选 / 认不出的候选行）⇒ **当场改走 v2**。
   * 只在这一个原因上回退；压缩那几条失败照旧往上抛（那是设备能力问题，不是格式问题）。
   */
  let fallbackReason: string | null = null;
  if (!prepared.ok) {
    if (prepared.reason !== 'compact-unavailable') return prepared;
    fallbackReason = prepared.message;
    prefer = { mode: 'full' };
    prepared = rawBytesForInvite(fields, prefer);
    if (!prepared.ok) return prepared;
  }
  let raw = prepared.bytes;
  /**
   * ★★ **G5/T40：降级链那一整段也必须被兜住**（判据 ⑤ 的另一半）。
   *
   * 为什么要在**这里**再包一层：`compressBytesWithFallback` 内部把"每一档的构造与 run"都
   * 收进了结果对象，但**调用注入缝本身**（`resolved.compressionStream?.(...)`）仍然可能由
   * 一个坏的假件抛出（返回的不是"像流的东西"、getter 抛、等等）。那种抛出如果冒到调用方，
   * 屏上就会出现原始异常串 —— 而"原始异常串不进界面"正是本任务要钉的判据 ⑤。
   */
  let c: CompressResult | CompressFailure;
  try {
    // ★ `input.preferKind` 给"回示码跟邀请码同一档"那条路用（缺省 = 完整降级链）
    c = await compressBytesWithFallback(raw, env, input.preferKind);
  } catch (e) {
    // ⚠️ 那句话里**不写** `rawErrorText(e)`：判据 ⑤ 钉的是"界面上没有原始异常字样"，
    //   而这条路唯一的去处就是界面。原始串留在返回值里（`probes` 的诊断面），不进文案。
    return {
      ok: false,
      reason: 'compress-failed',
      message: '邀请码没能生成：这台设备在准备压缩能力时出错了。请刷新页面再试一次；'
        + '如果一直这样，换一个较新的浏览器打开本页。',
      probes: [{ format: 'deflate-raw', supported: false, note: rawErrorText(e) }],
    };
  }
  if (!c.ok) {
    /**
     * ★ 判据 ⑤ 的收口：失败面上**交给玩家的那句话**由读数拼出来
     * （`readableCompressionFailureText`），而 `c.message` 里那句是"内部路标"（"改用下一档"），
     * 不是给玩家看的。`c.probes` 里的 `note` **只在诊断面**，一个字符都不进这一句。
     */
    return { ...c, message: readableCompressionFailureText(c.probes ?? []) };
  }
  /**
   * ★★ **G5/T40：编码侧的自洽检查仍然必须用"真的解压结果"**。
   *
   * 评审（`.superpowers/g5-T7-review/REVIEW.md` 评审 D）实测：这里原来写的是
   * `(compressed) => (compressed === c.bytes ? raw : null)` —— 那是"同一性检查"，
   * 不是解压：一份**真解不开**的 40 字节当"压缩件"喂进去，纯层那条
   * "压出来的必须解得动"的检查**照样放行**（恒定真）。评审用真解压口喂同一份字节 ⇒ 当场拒。
   *
   * ⇒ 这里先 `await decompressBytes(c.bytes, env, c.format)` **按同一档真解一遍**，
   * 只把**真解出来的字节**交给同步口（`'none'` 那一档，`decompressBytes` 在纯层与这里都是恒等，
   * 于是这道检查在"没压缩"时退化成"解出来还是同一份字节" —— 仍然是真检查，不是恒真）。
   */
  const roundTrip = await decompressBytes(c.bytes, env, c.format);
  let encoded = encodeInvite(
    fields,
    // 同步压缩口：这里交出的**就是**上面那次 await 的结果（不重压一次，也不换内容）
    () => c.bytes,
    // 同步解压口：反映的是**上面那次真解压**的结果（不是同一性检查）
    (compressed) => (compressed === c.bytes && roundTrip.ok ? roundTrip.bytes : null),
    c.format,
    // ★ G6/T49：这一条码带的是紧凑载荷（v3）还是整段 SDP（v2）
    prefer,
  );
  /**
   * ★ G6/T49：紧凑档的**第二道兜底** —— 纯层那道"重建出来的 SDP 必须带齐 ICE 凭据与
   * DTLS 指纹"的自洽检查没过时，**当场退回 v2**（而不是把"生成不了邀请码"丢给玩家）。
   * 这与 `compact-unavailable` 是同一族的两条路：一条在压之前判、一条在重建之后判。
   */
  if (!encoded.ok && prefer.mode === 'compact' && encoded.reason === 'compact-rebuild-incomplete') {
    fallbackReason = encoded.message;
    prefer = { mode: 'full' };
    const fullRaw = rawBytesForInvite(fields, prefer);
    if (!fullRaw.ok) return fullRaw;
    raw = fullRaw.bytes;
    encoded = encodeInvite(
      fields,
      () => c.bytes,
      (compressed) => (compressed === c.bytes && roundTrip.ok ? roundTrip.bytes : null),
      c.format,
      prefer,
    );
  }
  if (!encoded.ok) return encoded;
  const payload = encoded.payload;
  const report = inviteLengthReportOf(payload, prefer.mode === 'compact');
  return {
    ok: true,
    payload,
    link: inviteLinkOf(input.originAndPath, payload),
    chars: payload.length,
    withinMeasuredRange: report.withinMeasuredRange,
    compressedBytes: c.compressedBytes,
    rawBytes: c.rawBytes,
    ratio: c.ratio,
    /** ★ T40：这一条码用的是哪一档（判据 ① 的界面读数从这里取） */
    format: c.format,
    marker: markerOfKind(c.format),
    /** ★ T40：未压缩变体的**实测上界**（压缩档的 600-900 一个字不动） */
    withinUncompressedRange: c.format === 'none' ? payload.length <= INVITE_CHARS_MAX_UNCOMPRESSED : true,
    probes: c.probes ?? [],
    fallbackReason,
    payloadFormat: prefer.mode === 'compact' ? 'compact' : 'full',
  };
}

/**
 * ★★ **G5/T40：解一条裸载荷（按压缩段的明文标记挑解压器）**。
 *
 * 顺序：切明文协议版本 → **读压缩段的标记**（`u` / `d` / `g`，空 = 老格式 deflate-raw）
 * → 按那一档 `await` 真解压 → 把**已经解好的字节**当同步口交给纯层的 `decodeInviteText`。
 *
 * ## 为什么"缺某一档解压能力"要单独给人话
 *
 * 一台设备可能"压得出 gzip、解不开 gzip"（两个构造函数的支持面本来就不同）。
 * 那不是"这条码坏了"（`decompress-failed`），而是"本机没有这一档能力"
 * （`decompress-unsupported`）—— 玩家要做的下一步完全不同（换浏览器 / 让对方重发），
 * 所以两句话必须分开。
 *
 * ⚠️ `'none'` 那一档**不进解压器表**：它自己就是 base64url，纯层直接还原（任何设备都解得开）。
 */
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
  const body = payload.slice(dot + 1);
  // ★ 切段只有 `readInviteSegment` 一处（手写 `slice(1)` 会咬掉老格式的第一个字符）
  const seg = readInviteSegment(body);
  const kind = seg.kind;
  if (kind === null) {
    return {
      ok: false,
      reason: 'bad-base64url',
      message: `邀请码的压缩段带了一个本程序不认得的编码标记（"${seg.marker}"）：这不是本程序产出的邀请码。`,
    };
  }
  /**
   * 解出这一档的字节（`'none'` 交给纯层自己还原 —— 那里不需要任何设备能力）。
   * `bytes` 为 `null` 只表示"这一档没解出来"，"这一档本机没有"由下面那句人话区分。
   */
  let bytes: Uint8Array | null = null;
  if (kind === 'none') {
    // ★ 未压缩那一档：**这里**就把 base64url 解开（纯层在 'none' 那一支也会自己解，
    //   两边都行；这里先解开是为了让同步口回答的是"真的解开的那份字节"）。
    bytes = decodeBase64Url(seg.body);
  } else {
    const d = await decompressBase64(seg.body, env, kind);
    if (!d.ok) {
      // 解压侧分得开"字符集不对"与"压缩流解不开"；纯层那条路只拿到字节，分不了，所以在这里收口。
      // ⚠️ `'unsupported'` 原样传上去（那是"本机没有这一档能力"，不是"这条码坏了"）
      return { ok: false, reason: d.reason === 'unsupported' ? 'decompress-unsupported' : 'decompress-failed', message: d.message };
    }
    bytes = d.bytes;
  }
  // 同步口要回答的那一段：**去掉标记之后**的正文（纯层按同一口径切段）
  return decodeInviteText(payload, (b64) => (b64 === seg.body ? bytes : null), { marker: seg.marker });
}

/**
 * 把 base64url 的压缩段解回字节（先判字符集再解压，好让判据 4 的 ①② 分得开）。
 *
 * ★ G5/T40：`kind` 缺省是 `'raw'`（**老口径逐字不变**）；`'none'` 是恒等（不压缩那一段
 * 没有可解的东西，base64url 解出来就是原文）。
 */
export async function decompressBase64(
  b64: string,
  env?: NetBrowserEnv,
  kind: CompressionKind = 'raw',
): Promise<DecompressResult> {
  const pre = decodeBase64Url(b64);
  if (pre === null) {
    return { ok: false, reason: 'bad-base64url', message: '压缩段不是 base64url，解不出字节。' };
  }
  return decompressBytes(pre, env, kind);
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
    message: '这些信令端点一个都没连上。可以改用邀请码（邀请码这条路不需要信令端点，'
      + '两端直接把连接描述交给对方；在默认配置下，直连打不通时会经那台默认中继转发），或换一个端点再试。',
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
 * 8b. ★ ICE 收集与 offer/answer 的**序列**（G5/T8 修复轮 B1/B2）
 *
 * ## 为什么这一节存在（评审 1.2 的实测）
 *
 * 邀请码那条路**不需要信令服务器**（载荷走 fragment），但它**需要真 offer/answer**：
 * 房主出一条 offer，收方要 `setRemoteDescription` 再产一条 answer 回示。
 * 而修复轮之前：`setRemoteDescription` 在**整份文件里只有一行接口声明、一次都没被调用**，
 * 接口上**也没有 `createAnswer`** ⇒ "收方产一条 answer"这件事在产出代码里**没有能力表达**。
 *
 * ## 面上能验到什么、验不到什么（**写死在这里，别让读者高估**）
 *
 *  - ✅ **能在 node 里验**：这一节全部是**序列**——先 `setRemoteDescription(offer)`、
 *    再 `createAnswer()`、再 `setLocalDescription(answer)`、再等 ICE 收集到 `complete`、
 *    最后读 `localDescription`。序列在**假 peer connection**（注入缝 `NetBrowserEnv.peerConnection`）
 *    上能逐格断言，而且顺序写错会当场红。
 *  - ❌ **不能在 node 里验**：真 `RTCPeerConnection` 的行为——SDP 的真实格式、ICE 候选能不能
 *    真的打通、连不上的真实原因、NAT 穿透。**这一段真浏览器未验证，由 T9 的 CDP 场景覆盖。**
 * ================================================================== */

/**
 * 等 ICE 收集的上界（毫秒）。缺省值。
 *
 * ## ★ 它是**上界**这件事，比它等于多少更重要
 *
 * 没有上界的 `await` 就是一次静默挂起（D23 要消灭的形态）⇒ 这个数**必须存在**。
 * 而"存在"这件事只有配腿才可观测（`tests/ui/net-lobby.test.ts` 里那条"缺省上界仍然是
 * 缺省值"的腿；评审指出的正是"缺省值今天没有腿"）。
 *
 * ## 15 秒的**实测依据**（2026-09-18，本机 Chrome 143.0.7499.194 / `--headless=new`）
 *
 * 5 秒那个旧值**挡在本机实测值以下**：`tools/browser-truth-cdp.mjs` 量到本机 host 侧
 * 收集要约 **4.8–5.2 秒**；`tools/browser-truth-lobby-cdp.mjs` 连跑四次，房主侧四次都贴着
 * 上界过（邀请码 736–741 字符），而**加入方产 answer 那条收集四次全超**
 * （屏上那句可读失败见下）⇒ 5 秒对真人就是"邀请码那条路会失败"。
 * 抬到 **15 秒（约 3 倍余量）**。
 *
 * ⚠️ 这是**经验选择，不是测量结论**：上面量到的是"本机这一天的网络",
 * 真值（不同 NAT / 移动网 / 差网）只能在真浏览器里继续量（T9/用户验收的活）。
 *
 * ★★ **G5 T18：这个数现在是"最坏情况"的上界，不再是"每次都要等满"的时间。**
 * 那个曾经登记为"不是本次做的事"的更聪明的策略**已经做了**（见 `enoughCandidatesForInvite`）：
 * 一旦手上已经有**本机（host / mDNS）候选 + 至少一个公网映射（srflx）**，就**立刻**返回，
 * 不再等满 15 秒；只有"本机候选到手、但一个 srflx 都没有"时才走满这个上界（**故意的**：
 * 那种描述只能同机 / 同局域网用，提前收工等于把"跨网也许能连"的可能性一起砍掉）。
 * 上界的**含义一字未变**：`timedOut: true` 仍然是"到点时还没收完"。
 */
export const DEFAULT_ICE_GATHER_TIMEOUT_MS = 15_000;

/** `waitForIceGathering` 的结论（**失败有可读原因**，不是 `null`） */
export type IceGatherResult =
  | {
      readonly ok: true;
      readonly sdp: string;
      readonly ice: readonly string[];
      /** 上界（或宽限）到点时还没收完（但已经拿到了 ≥1 个候选，于是按现状放行，见 `waitForIceGathering`） */
      readonly timedOut: boolean;
      /**
       * ★ **T18：这一份是"**够用就收工**"提前返回的**（收集还没结束、也没到上界）。
       *
       * 与 `timedOut: false, note: null`（**正常收完**）**不是**同一件事 ⇒ 这里显式分开，
       * 不许让下游按"没有 `note` 就是收完了"去推断。
       */
      readonly stoppedEarly: boolean;
      /** 放行那一刻要**如实**写给人看的那一句；正常收完时为 `null` */
      readonly note: string | null;
    }
  | {
      readonly ok: false;
      readonly reason: 'ice-timeout' | 'unsupported' | 'no-description' | 'no-candidates';
      readonly message: string;
    };

/** 从一条 SDP 里把候选串抠出来（`a=candidate:` 那几行）——**非 trickle** 的载荷要它们 */
export function candidatesOf(sdp: string): string[] {
  return sdp
    .split(/\r?\n/)
    .filter((l) => l.startsWith('a=candidate:'))
    .map((l) => l.slice('a='.length));
}

/**
 * ★★ **G5 T16：候选的种类与数量**（屏上那句"只收集到本机候选"就是从这里来的）。
 *
 * 为什么要有它：上界到点之后**不能**把"候选不全"写成"能用"，也**不能**一律写成"连不上"
 * ——要么如实说清拿到了哪几种，要么硬失败。判据只能是 SDP 里那几行 `a=candidate:` 的 `typ`，
 * 所以把它抠出来计数（**不猜**：认不出的类型进 `other`，不假装它是 host）。
 */
export interface CandidateKinds {
  readonly host: number;
  readonly srflx: number;
  readonly prflx: number;
  readonly relay: number;
  readonly other: number;
}

/** 一条候选的 `typ`（`a=candidate:… typ host …` 里那个词）。认不出就是 `'other'` */
export function candidateTypeOf(candidate: string): keyof CandidateKinds {
  const m = /\btyp\s+([A-Za-z]+)/.exec(candidate);
  const t = m === null ? '' : m[1].toLowerCase();
  if (t === 'host' || t === 'srflx' || t === 'prflx' || t === 'relay') return t;
  return 'other';
}

/** 候选按种类计数（`candidateTypeOf` 的汇总） */
export function candidateKindsOf(ice: readonly string[]): CandidateKinds {
  const out = { host: 0, srflx: 0, prflx: 0, relay: 0, other: 0 };
  for (const c of ice) out[candidateTypeOf(c)] += 1;
  return out;
}

/**
 * ★★ **G5 T18：候选"已经够用了"没有** —— "够用就收工"那条判据的**唯一出处**。
 *
 * ## 判据
 *
 *  - **有中继可用**（`relayConfigured === true`：默认那台内置中继也算）：**中继（relay）≥ 1**
 *    （光有 srflx 不算够）。★ T38 实测修正：默认路径也必须走这一档 —— 否则"够用就收工"会把
 *    relay 候选砍掉，邀请码里只剩 host + srflx，**跨网直连一失败就没有中继可走**
 *    （而默认带上中继的全部意义就是"打不通时经它转发"）；
 *  - **没有中继**（`relayConfigured === false`）：公网映射（srflx）≥ 1 **或** 中继（relay）≥ 1。
 *
 * ## 为什么
 *
 *  - 一条 host 候选只能让**同一台机器 / 同一个局域网**连上（T16 用户实测那条路的价值就在这）；
 *  - srflx 是"STUN 服务器看到了我的公网地址"的**证据**：有它，跨网直连才有得谈；
 *  - **玩家自己指定了 TURN 的人，跨网那一档靠的就是 relay**，而 TURN 分配要走一趟服务器往返
 *    ⇒ relay 是收集顺序里的**最后一段**。早退会把 relay 砍掉 ⇒ 那条邀请码 / 回示码里没有中继，
 *    直连一失败就真的失败，而屏上还不会说为什么（T18 评审判据 1 的那条）。
 *    ⇒ **玩家指定了中继就必须等 relay 到手或到上界**。
 *
 * ⚠️ 它**不是**"跨网一定能连"的证明 —— 那件事本次没有断言（也不该由这几个候选断言）。
 * 它只回答一个更小的问题："现在这条描述值不值得写进邀请码"。
 *
 * ★★ **T38：调用侧传进来的那个布尔值 = "这一份 `iceServers` 里有没有可用的中继"**
 * （`readIceServers().relayConfigured`），**默认那台内置中继也算**。
 *
 * 我一度把它改成"只有玩家自己改过才算"（理由是默认档早退更快），真浏览器读数把它否掉了：
 * 默认路径 **77ms** 就收工，邀请码里只有 `host + srflx`、**一条 relay 都没有** ⇒
 * "直连打不通时经中继转发"在默认路径上等于不存在。现在的口径要付一点时间代价
 * （生成邀请码 **77ms → 180-203ms**，其中 relay 到手 **155-164ms**，见
 * `.superpowers/g5-T38/t38-ice-probe.json`），换来的是**邀请码里真的带上中继**。
 * 参数名保留 `relayConfigured`（它是本仓既有测试用的名字，语义由上面这几句钉住）。
 *
 * ⚠️ 只有 host（没有 srflx / relay）时**故意不**立刻收工，但也不等满 15 秒：给一段**宽限**
 * （`ICE_HOST_ONLY_GRACE_MS`，1.5 秒）让 STUN 把公网映射拿回来；到点按现状放行 + 一句如实的
 * `note`。15 秒那个上界只留给"一个候选都没有 ⇒ 硬失败"那一档。
 */
export function enoughCandidatesForInvite(ice: readonly string[], relayConfigured = false): boolean {
  const kinds = candidateKindsOf(ice);
  if (kinds.host === 0) return false;
  // 配了中继：中继没到手就不算够（那一档跨网靠的就是它）
  if (relayConfigured) return kinds.relay > 0;
  return kinds.srflx > 0 || kinds.relay > 0;
}

/**
 * ★★ **G5 T18 修复轮：只有 host 时那段"宽限"**（毫秒）。
 *
 * ## 为什么有它
 *
 * 只有 host 意味着 STUN 还没回应（或者那张网把它挡了）。早先这里是"等到 15 秒上界"，
 * 但 15 秒是留给"**一个候选都没有 ⇒ 硬失败**"那一档的预算，跟玩家手上这条**已经能用**的描述
 * 没关系 —— 白白干等十几秒（真机实测 15152 / 15166ms）。
 *
 * 宽限给的是"再等一会儿公网映射"的那点时间：
 *  - 公网 STUN 通常几百毫秒就回（本机实测 Google 229ms / Cloudflare 324ms，
 *    见 `.superpowers/g5-T18/measure-run1.txt` 与 `gate-ice-run1.txt`），1.5 秒够用；
 *  - 到点就走 T16 那条"放行 + 如实 `note`"的路（`timedOut: true`，note 说清只拿到本机候选）。
 *
 * ⚠️ 它**不**替上界：一个候选都没有时**不**排它（那一档照旧走满 `iceGatherTimeoutMs`）；
 * 玩家配了中继时也**不**排它（那一档必须等 relay 到手或到上界）。
 */
export const ICE_HOST_ONLY_GRACE_MS = 1_500;

/** 种类的中文名（只写在这一处：屏上与报告都从它取，免得两处各说各话） */
const KIND_LABELS: Readonly<Record<keyof CandidateKinds, string>> = {
  host: '本机（host）',
  srflx: '公网映射（srflx）',
  prflx: '对端映射（prflx）',
  relay: '中继（relay）',
  other: '类型认不出的',
};

/** 把一份候选清单说成一句人话（例：`本机（host）2 个、公网映射（srflx）1 个`） */
export function describeCandidates(ice: readonly string[]): string {
  if (ice.length === 0) return '一个都没有';
  const kinds = candidateKindsOf(ice);
  const parts: string[] = [];
  for (const k of ['host', 'srflx', 'prflx', 'relay', 'other'] as const) {
    if (kinds[k] > 0) parts.push(`${KIND_LABELS[k]} ${String(kinds[k])} 个`);
  }
  return parts.join('、');
}

/**
 * ★★ **G5 T16：上界到点（或宽限到点）、但手上已经有候选** ⇒ 这就是要写到屏上的那一句。
 *
 * 两条纪律：
 *  1. **只说事实**：拿到几种、各几个，来自 SDP 本身（`describeCandidates`）；
 *  2. **跨网能不能连是未知的，就写"还不知道"** —— 不许写成"能用"，也不许写成"连不上"。
 *     "同机 / 同一局域网通常能用"是有依据的那一半（host 候选就是给这两种场景用的）。
 *
 * ★ T18 修复轮：玩家**配了中继却一个 relay 都没到手**时补一句（那种情况下"跨网靠 relay"这条
 * 路这一轮没走成，屏上必须说出来，而不是只报 srflx 的账）。
 */
function partialGatherNote(ice: readonly string[], timeoutMs: number, relayConfigured = false): string {
  const sec = timeoutMs / 1000;
  const kinds = candidateKindsOf(ice);
  const onlyHost = kinds.srflx === 0 && kinds.prflx === 0 && kinds.relay === 0 && kinds.other === 0;
  const head = onlyHost
    ? `等了 ${String(sec)} 秒，公网映射（srflx）一个都没收到，只收集到本机候选：${describeCandidates(ice)}。`
    : `等了 ${String(sec)} 秒，ICE 候选没有收集完；已经拿到的：${describeCandidates(ice)}。`;
  return head
    + (relayConfigured && kinds.relay === 0 ? '你配了中继，但这一轮中继地址也没收到。' : '')
    + '这些候选已经写进这条邀请码里了。同一台机器上的两个窗口、同一个局域网里的两台设备，'
    + '用它们通常能直接连上；跨网络（两边不在同一个局域网）能不能连上，现在还不知道'
    + ' —— 那要拿到公网映射或者中继地址才行，这一次没拿全。';
}

/**
 * ★★ **G5 T18：早退那一刻的如实读数**。
 *
 * 三种收工方式在 `note` 上必须**互相区分**（别让下游按"没有 note 就是收完了"去推断 ——
 * 真浏览器门 `.superpowers/g5-T18/` 的冰门 §④ 原来就是这么推的，早退带话之后那句就不成立了）：
 *  - 正常收完（`complete`）⇒ `stoppedEarly: false`、`note: null`；
 *  - 宽限 / 上界到点放行 ⇒ `timedOut: true`、`note: partialGatherNote(…)`（含"等了 N 秒"）；
 *  - **够用就收工** ⇒ `stoppedEarly: true`、`note:` 就是这一句（短、说人话，不带术语）。
 */
function earlyEnoughNote(kinds: CandidateKinds): string {
  const head = kinds.relay > 0 ? '本机候选和中继地址都拿到了' : '本机候选和公网映射都拿到了';
  return `${head}，够用，不再等剩下的候选。`;
}

/** ★★ **G5 T16：上界到点时一个候选都没有** ⇒ 硬失败。理由只说本侧的事实，不猜对端 */
function noCandidateTimeoutMessage(timeoutMs: number): string {
  return `等了 ${String(timeoutMs / 1000)} 秒，这台设备这一次一个 ICE 候选都没有收集到（本机候选也没有）。`
    + '一个候选都没有的连接描述发出去也连不上，所以这条邀请码不生成。'
    + '下一步：确认浏览器没有被扩展 / 企业策略关掉 WebRTC（本程序只用它做直连），然后重试一次；'
    + '若还是一个候选都没有，请把这一行原样记下来。';
}

/** ★★ **G5 T16：收集已经"结束"了却一个候选都没有** ⇒ 同样硬失败（发出去也连不上） */
function noCandidateNowMessage(): string {
  return 'ICE 收集已经结束，但这台设备这一次一个候选都没有（本机候选也没有），'
    + '这样的连接描述发出去也连不上，所以这条邀请码不生成。'
    + '下一步：确认浏览器没有被扩展 / 企业策略关掉 WebRTC（本程序只用它做直连），然后重试一次；'
    + '若还是一个候选都没有，请把这一行原样记下来。';
}

/**
 * ★ **等 ICE 收集完成，然后把 `localDescription` 取出来**（B2）。
 *
 * ## 为什么必须等（这是"占位 SDP"那件事的正解）
 *
 * `setLocalDescription()` 返回之后 ICE 收集**才刚开始**，此刻 `localDescription.sdp` 里
 * **一条候选都没有**。邀请码那条路是**一次性**的（没有第二条通道补候选），
 * 所以必须等到 `iceGatheringState === 'complete'` 再取 —— 否则收方拿到的是一条
 * **需要 trickle 的 offer**，而它没有任何地方可以 trickle。
 *
 * ## ★★ G5 T16：上界到点**不再整条放弃**——手上有候选就按现状放行
 *
 * 用户真机实测（2026-09-22）：他所在的那张网到 Google 的公共 STUN 不可达 ⇒
 * `iceGatheringState` **永远**到不了 `complete`（而**本机 / mDNS 候选早就有了**）⇒
 * 上面那条规则让邀请码**根本不生成**。他真正要的只是**同一台机器 / 同一个局域网**两个窗口对打，
 * 本机候选完全够用。
 *
 * ⇒ 现在的规则是"**候选数决定过不过**"，三种结局各自可读：
 *  - **0 个候选** ⇒ 硬失败（`'ice-timeout'` 或 `'no-candidates'`）。理由只说**本侧**的事实
 *    （"这台设备这一次一个候选都没收集到"），**不猜**对端的网络 —— 一个候选都没有的描述
 *    发出去也连不上，这才是真因；
 *  - **≥1 个候选 + 上界到点** ⇒ `ok: true`，并把"只拿到这些、跨网能不能连是未知的"
 *    写进 `note`（`partialGatherNote`：候选种类与个数都来自 SDP 本身，不是猜的）；
 *  - **正常收完（`complete`）且有候选** ⇒ `ok: true`，`note` 为 `null`。
 *
 * ⚠️ **换句话说：`timedOut: true` 不是"能用"的证明。** 它只证明"这条码按现状产出、
 * 同机 / 同局域网有得打"；跨网能不能连，屏上写的是"还不知道"。**不许**把这一段读成
 * "超时也没关系"。
 *
 * ## ★★ G5 T18：够用就收工（真机点「生成邀请码」要干等十几秒那件事）
 *
 * 用户真机实测（2026-09-22 之后那一局）：网络正常时（本机候选 + srflx 都有），
 * 这里仍然**死等** `iceGatheringState === 'complete'`，而收尾那一段（relay 试探、超时收口）
 * 常常要十几秒 ⇒ 玩家对着一个没有任何反馈的按钮干等。
 *
 * ⇒ 现在的规则是"**够用就收工**"：四条路各自可读（`note` 上互相区分，见 `earlyEnoughNote`）
 *  - **已经够用**（`enoughCandidatesForInvite`）⇒ **立刻** `ok`、`stoppedEarly: true`、
 *    一句短 `note`（"…够用，不再等剩下的候选。"）。两个触发点：`icecandidate`
 *    （真件每收到一条候选派发一次）与 `icegatheringstatechange`；函数入口也先查一次
 *    （调用方不一定"刚 `setLocalDescription` 完"就进来）。
 *    ⚠️ **配了中继的玩家要等 relay 到手**才算够用（T18 修复轮：早退不许砍掉 relay）。
 *  - **正常收完**（`complete`）⇒ 照旧 `ok`、`timedOut: false`、`stoppedEarly: false`、`note: null`；
 *  - **只有 host** ⇒ 起一段**宽限**（`ICE_HOST_ONLY_GRACE_MS` = 1.5 秒）等公网映射；
 *    宽限到点 ⇒ T16 那条"放行 + 如实 `note`"（`timedOut: true`）；
 *  - **到点还没收完** ⇒ T16 那条规则一字未动（0 候选硬失败；≥1 候选放行 + `note`）。
 *
 * **一个候选都没有是唯一还等满上界的那一档**（15 秒是它的预算）。配了中继而 relay 一直没到，
 * 也走满上界 —— 那一档宁可等，也不许把中继砍掉。
 *
 * ## 上界怎么排
 *
 * 走注入的 `env.ticker`（本仓纪律：计时一律注入）+ `env.iceGatherTimeoutMs`。
 * **没有"沉默地一直等"这条路**：没有 `ticker` 时直接回 `'unsupported'`（**响亮地拒绝**）。
 *
 * ## 真浏览器读数
 *
 * `iceGatheringState` 的真实时序（尤其"候选一个都没收集到"时它会不会走到 `'complete'`）
 * 在 node 里验不了 —— 夹具与实测读数见 `.superpowers/g5-T16/T16-REPORT.md`
 * 与 `tools/browser-truth-ice-fallback-cdp.mjs`。
 */
export function waitForIceGathering(
  pc: PeerConnectionLike,
  env?: NetBrowserEnv,
): Promise<IceGatherResult> {
  const resolved: NetBrowserEnv = { ...defaultEnv(), ...env };
  /** 读此刻的 `localDescription` 的 SDP（**唯一的读取点**：三条路共用） */
  const readSdp = (): string | null => {
    const desc = pc.localDescription ?? null;
    return typeof desc?.sdp === 'string' && desc.sdp.length > 0 ? desc.sdp : null;
  };
  const noDescription = (): IceGatherResult => ({
    ok: false,
    reason: 'no-description',
    message: '本侧还没有连接描述可发（`setLocalDescription` 没成功，或实现没把它暴露出来）。',
  });
  /**
   * ★★ 取结论（**候选数在这里定生死**，见上面那段）：
   *  - 拿不到描述 ⇒ `no-description`（与 T8 同口径）；
   *  - 0 个候选 ⇒ 硬失败（到点那条路是 `'ice-timeout'`，收完了却空的是 `'no-candidates'`）；
   *  - ≥1 个候选 ⇒ `ok`：`timedOut` / `stoppedEarly` 如实标记，`note` 按三种收工方式各写各的。
   */
  const take = (
    timedOut: boolean, timeoutMs: number, stoppedEarly: boolean, relayConfigured: boolean,
  ): IceGatherResult => {
    const sdp = readSdp();
    if (sdp === null) return noDescription();
    const ice = candidatesOf(sdp);
    if (ice.length === 0) {
      return timedOut
        ? { ok: false, reason: 'ice-timeout', message: noCandidateTimeoutMessage(timeoutMs) }
        : { ok: false, reason: 'no-candidates', message: noCandidateNowMessage() };
    }
    const note = timedOut
      ? partialGatherNote(ice, timeoutMs, relayConfigured)
      : (stoppedEarly ? earlyEnoughNote(candidateKindsOf(ice)) : null);
    return { ok: true, sdp, ice, timedOut, stoppedEarly, note };
  };
  const timeoutMs = resolved.iceGatherTimeoutMs ?? DEFAULT_ICE_GATHER_TIMEOUT_MS;
  /**
   * ★★ **T18 修复轮起：这份配置里"有没有可用中继"决定"够用"的口径** ——
   * 从**同一个读数**取（`readIceServers()`），不另造一份判据。有中继时条件收紧成
   * "relay 到手"（见 `enoughCandidatesForInvite`）。
   *
   * ★★ **T38 的实测修正（这条是本轮真浏览器读数逼出来的，不是措辞偏好）**
   *
   * T38 给默认值加了一台内置中继之后，我先把这里改成"**只有玩家自己改过**才算有中继"
   * （理由是"否则每次出邀请码都要等 relay"）。**真浏览器读数把它否掉了**：
   * 默认路径上"够用就收工"在 77ms 就返回，邀请码里只有 `host + srflx`，
   * **一条 relay 都没有** —— 于是"直连打不通时经中继转发"这件事在默认路径上**不存在**
   * （用户 2026-09-25 的原话就是"连接不上时走这个服务器"）。
   *
   * ⇒ 口径改回"这一份 `iceServers` 里有中继就等 relay"，**默认那台内置中继也算**。
   * 代价是默认路径要等 relay 到手（**生成邀请码 77ms → 180-203ms**，其中 relay 到手
   * **155-164ms**，gather 总耗时 253-530ms；中继不可达时才走满上界），换来的是邀请码里
   * **真的带上中继** —— 这一档值得。读数原文 `.superpowers/g5-T38/t38-ice-probe.json`。
   *
   * `settingsAreDefault`（`turnSettingsAreDefault` 算出来的那个"三项没被玩家动过"）**不参与**
   * 这里的判定，它只给 `readIceServers()` 标注来源；判据 3 的证据面在 `__g5Match.ice()`（`main.ts`）。
   */
  const settings = resolved.settings?.() ?? null;
  const relayConfigured = readIceServers(settings, false, resolved.credentialRead?.() ?? null).relayConfigured;
  // 已经收集完了：同步返回（**不要**在这种情况下也去排一个计时器）
  if (pc.iceGatheringState === 'complete') return Promise.resolve(take(false, timeoutMs, false, relayConfigured));
  const ticker = resolved.ticker;
  if (ticker === undefined) {
    // ★ **响亮地拒绝**，而不是挂住：没有计时能力就判不了"等多久算超时"
    return Promise.resolve({
      ok: false,
      reason: 'unsupported',
      message: '这台设备没有可用的计时能力，所以判不了"ICE 收集等多久算超时"；'
        + '为了不静默挂住，这一轮不生成邀请码（请重试）。',
    });
  }
  return new Promise<IceGatherResult>((resolve) => {
    let settled = false;
    /** 上界那个计时器的句柄（"够用就收工"那一支**不排**计时器 ⇒ 它可以一直是 `null`） */
    let handle: number | null = null;
    /**
     * ★ T18 修复轮：只有 host 时那段**宽限**的句柄（"配了中继"与"一个候选都没有"时不排它）。
     */
    let graceHandle: number | null = null;
    const finish = (r: IceGatherResult): void => {
      if (settled) return;
      settled = true;
      if (handle !== null) ticker.cancel(handle);
      if (graceHandle !== null) ticker.cancel(graceHandle);
      resolve(r);
    };
    /**
     * ★ T18：读一次此刻的描述，**够用就收工**（`stoppedEarly: true` + 一句如实的 `note`）。
     * 不够用（或读不到描述）⇒ `null`，交给下面那几条路。
     */
    const takeIfEnough = (): IceGatherResult | null => {
      const sdp = readSdp();
      return sdp !== null && enoughCandidatesForInvite(candidatesOf(sdp), relayConfigured)
        ? take(false, timeoutMs, true, relayConfigured)
        : null;
    };
    /**
     * ★ T18 修复轮：**只有 host** 时起一段宽限（只起一次）。
     *
     *  - 玩家**配了中继** ⇒ 不排它：那一档必须等 relay 到手或到上界（不能把 relay 砍掉）；
     *  - **一个候选都没有** ⇒ 也不排它：那一档照旧走满上界（`ice-timeout` 的预算没变）。
     *
     * ⚠️ 宽限从"**看到候选到手**那一刻"起算：产出路径上 `gather` 是在 `setLocalDescription()`
     * 之后**立刻**排下的（`createBrowserTransport` / `acceptOffer`），进函数时一条候选都还没有
     * ⇒ 那一格到不了。真到了（比如 `localDescription()` 被很晚才 `await`）也不排它，照旧走上界。
     */
    const armGraceIfOnlyHost = (): void => {
      if (settled || graceHandle !== null || relayConfigured) return;
      const sdp = readSdp();
      if (sdp === null) return;
      const kinds = candidateKindsOf(candidatesOf(sdp));
      if (kinds.host === 0 || kinds.srflx > 0 || kinds.relay > 0) return;
      graceHandle = ticker.schedule(
        () => { finish(take(true, ICE_HOST_ONLY_GRACE_MS, false, relayConfigured)); },
        ICE_HOST_ONLY_GRACE_MS,
      );
    };
    // 入口先查一次：调用方可能不是"刚 `setLocalDescription` 完"就进来的（比如 `localDescription()` 被晚调）
    const already = takeIfEnough();
    if (already !== null) { finish(already); return; }
    // ★ T16：到点先看**手上已经有几个候选** —— 有就按现状放行，没有才是硬失败
    handle = ticker.schedule(() => { finish(take(true, timeoutMs, false, relayConfigured)); }, timeoutMs);
    // 真件会在 `icegatheringstatechange` 上回调；**假件也可以直接改状态再调它**
    pc.addEventListener('icegatheringstatechange', () => {
      if (pc.iceGatheringState === 'complete') { finish(take(false, timeoutMs, false, relayConfigured)); return; }
      // ★ T18：还没 `complete`，但手上已经够用了 ⇒ 不必等收尾那一段
      const enough = takeIfEnough();
      if (enough !== null) { finish(enough); return; }
      armGraceIfOnlyHost();
    });
    /**
     * ★ T18：真件每收到一条候选就派发一次 `icecandidate`（收尾那一条的 `candidate` 是 `null`）
     * ⇒ 这是"srflx / relay 到手了没有"最及时的观测点。**假件可以不派发它**
     * （不派发就退回上面两条路）。
     */
    pc.addEventListener('icecandidate', () => {
      if (settled) return;
      const enough = takeIfEnough();
      if (enough !== null) { finish(enough); return; }
      armGraceIfOnlyHost();
    });
  });
}

/* ================================================================== *
 * 4.5 ★★ G6/T46：这一局到底走没走中继（`getStats()` 是真值来源）
 *
 * ## 为什么值得单独一段
 *
 * TURN 中继只在直连打不通时用；一旦用上，**整局的每个包都穿过服务器**（带宽是玩家的成本）。
 * 而在此之前本仓产出代码**一处都没有**读过 `getStats()` ⇒ 界面上完全看不出这一局是直连
 * 还是经中继。选协议那一屏上那一行（`src/ui/net-conn-line.ts`）读的就是本段。
 *
 * ## 判据
 *
 * 规范里"这一对候选正在被用来传数据"的标志是 `candidate-pair` 条目上的两个字段一起成立：
 * `nominated === true` **且** `state === 'succeeded'`。只有这一对的两个端点的
 * `candidateType` 才决定"走没走中继"（`relay` = 中继，`host` / `srflx` / `prflx` = 直连）。
 *
 * ## 拿不到就如实说"还不知道"
 *
 * 没有 `succeeded` 的候选对（`pc` 刚建 / 还在收集）、没有 `getStats`（假件）、
 * `stats` 里有 `type: 'local-candidate'` 条目缺失 —— 一律回 `kind: 'pending'`。
 * **不许**回落到"直连"：猜一次"直连"会让玩家看到一条假读数。
 * ================================================================== */

/** "这一局走没走中继"的三值（`'pending'` = 还没有可用读数，屏上写"建立中…"） */
export type RelayStatsKind = 'direct' | 'relay' | 'pending';

/** 读 `getStats()` 这一个动作的结论（屏上那一行与测试腿读的都是它） */
export interface RelayStatsRead {
  readonly kind: RelayStatsKind;
  /** 被提名且已成功的那一对的 id（`kind === 'pending'` 时为 `null`） */
  readonly pairId: string | null;
  /** 那一对两端的候选 id（读数证据：跨重连会比它变没变） */
  readonly localCandidateId: string | null;
  readonly remoteCandidateId: string | null;
  /** 两端各自的 `candidateType` 原文（`relay` / `host` / `srflx` / `prflx`；读不到为 `null`） */
  readonly localCandidateType: string | null;
  readonly remoteCandidateType: string | null;
}

/** `kind: 'pending'` 的那一份读数（**唯一出处**：别在别处手写第二份同形状的字面量） */
export function pendingRelayRead(): RelayStatsRead {
  return {
    kind: 'pending',
    pairId: null,
    localCandidateId: null,
    remoteCandidateId: null,
    localCandidateType: null,
    remoteCandidateType: null,
  };
}

/** 中继那一类的名字（`RTCIceCandidateType` 里只有它是"服务器替两端转发"） */
export const RELAY_CANDIDATE_TYPE = 'relay';

/** 从一条 stats 条目里按字段名取字符串（不在 / 不是字符串 ⇒ `null`，**不抛**） */
function statsString(entry: Record<string, unknown> | undefined, field: string): string | null {
  const v = entry?.[field];
  return typeof v === 'string' && v.length > 0 ? v : null;
}

/**
 * ★★ **这一份 `RTCStatsReport` 说的是直连还是经中继**（本段的**唯一**分类函数）。
 *
 * 逐条按 `type` 归到三张表里（`candidate-pair` / `local-candidate` / `remote-candidate`），
 * 再挑出"被提名且已成功"的那一对。**不做任何猜测**：缺哪一块就读不出来。
 *
 * ⚠️ 多个 `succeeded` 的候选对时取**最后一条被提名**的（`getStats()` 的遍历顺序里，
 * 被提名的那一对是此刻真在用的那一条；这一条不参与判据，只是"两份都读得到时取哪一份"的口径）。
 */
export function readRelayStats(report: RTCStatsReportLike): RelayStatsRead {
  const candidates = new Map<string, string>();
  let pairId: string | null = null;
  let localId: string | null = null;
  let remoteId: string | null = null;
  report.forEach((entry) => {
    const type = statsString(entry, 'type');
    if (type === 'local-candidate' || type === 'remote-candidate') {
      const id = statsString(entry, 'id');
      const kind = statsString(entry, 'candidateType');
      if (id !== null && kind !== null) candidates.set(id, kind);
      return;
    }
    if (type !== 'candidate-pair') return;
    if (entry.nominated !== true || statsString(entry, 'state') !== 'succeeded') return;
    pairId = statsString(entry, 'id');
    localId = statsString(entry, 'localCandidateId');
    remoteId = statsString(entry, 'remoteCandidateId');
  });
  const local = localId === null ? null : (candidates.get(localId) ?? null);
  const remote = remoteId === null ? null : (candidates.get(remoteId) ?? null);
  const base = {
    pairId,
    localCandidateId: localId,
    remoteCandidateId: remoteId,
    localCandidateType: local,
    remoteCandidateType: remote,
  };
  if (pairId === null || local === null || remote === null) return { kind: 'pending', ...base };
  // ★ 判据本体：**任一侧**是 `relay` ⇒ 这一对经中继（两侧都是 relay 也仍然是 relay）
  const relay = local === RELAY_CANDIDATE_TYPE || remote === RELAY_CANDIDATE_TYPE;
  return { kind: relay ? 'relay' : 'direct', ...base };
}

/**
 * ★ 从一条真连接上读这一刻的结论（`getStats()` 是**异步**的，真件在下一轮微/宏任务里回答）。
 *
 * 三种"读不出来"各自如实收口，**都不抛**：
 *  - 这条连接**没有** `getStats`（假件 / 老实现）⇒ `pending`，`note` 说明原因；
 *  - `getStats()` **抛了**（连接已经关掉）⇒ `pending` + `note`；界面那一行只显示三值里的一个，
 *    所以 `note` 只进诊断读数（不改变屏上那一行的判定）。
 *  - `getStats()` 回的东西不是一份报告（没有 `forEach`）⇒ `pending`。
 *
 * 为什么返回 `{ read, note }` 而不是只返回 `RelayStatsRead`：`note` 是"为什么读不出来"的
 * **人话**，它让"屏上写建立中"这件事可排查（与 `IceGatherResult.note` 同一个用途）。
 */
export async function readRelayStatsOf(
  pc: PeerConnectionLike | null | undefined,
): Promise<{ readonly read: RelayStatsRead; readonly note: string | null }> {
  if (pc === null || pc === undefined) {
    return { read: pendingRelayRead(), note: '这条连接还不存在（`pc` 还没建）。' };
  }
  if (typeof pc.getStats !== 'function') {
    return { read: pendingRelayRead(), note: '这条连接不提供 `getStats()`，读不出走没走中继。' };
  }
  let raw: RTCStatsReportLike;
  try {
    raw = await pc.getStats();
  } catch (e) {
    return { read: pendingRelayRead(), note: `读连接统计失败：${rawErrorText(e)}` };
  }
  if (typeof (raw as { forEach?: unknown } | null)?.forEach !== 'function') {
    return { read: pendingRelayRead(), note: '`getStats()` 没有回一份可遍历的报告。' };
  }
  const read = readRelayStats(raw);
  return {
    read,
    note: read.kind === 'pending'
      ? '还没有"被提名且已成功"的候选对（链路还在建立），所以这一刻读不出直连还是经中继。'
      : null,
  };
}

/** `acceptOffer` 的结论（成功面是"一条可以回示的 answer 描述"） */
export type AcceptOfferResult =
  | {
      readonly ok: true;
      readonly sdp: string;
      readonly ice: readonly string[];
      /** ★ T16：等 ICE 的上界到点、但拿到了 ≥1 个候选 ⇒ 按现状放行（与 `IceGatherResult` 同口径） */
      readonly timedOut: boolean;
      /** ★ T18：这一份是"够用就收工"提前返回的（与"正常收完"不是一件事，见 `IceGatherResult`） */
      readonly stoppedEarly: boolean;
      /** ★ T16/T18：放行（宽限 / 上界 / 早退）时要如实写给人看的那一句；正常收完为 `null` */
      readonly note: string | null;
    }
  | {
      readonly ok: false;
      readonly reason:
        | 'unsupported'
        | 'set-remote-failed'
        | 'answer-failed'
        | 'ice-timeout'
        | 'no-description'
        | 'no-candidates';
      readonly message: string;
    };

/**
 * ★ **收方那一侧：把对方的 offer 吃进来，产一条可以回示的 answer**（B1）。
 *
 * 序列**写死**在这一个函数里（顺序错就没有第二条路可走）：
 *   1. `setRemoteDescription(offer)` —— 这一步在修复轮之前**从未被调用过**；
 *   2. `createAnswer()`；
 *   3. `setLocalDescription(answer)`；
 *   4. `waitForIceGathering()`（带上界，见它）。
 *
 * ## ★★ C 轮修复：`pc` 必须**传进来**（"两条连接"那个结构缺口）
 *
 * 本函数原来**自己造一条新连接**（`resolved.peerConnection?.(...)`）。那是错的：
 * 承载 `hello` / `act` 的那条连接住在 `createBrowserTransport` 内部，
 * 于是 answer 在**第二条**连接上完成、消息通道在**第一条**上 ⇒
 * **两端从来没有为"传消息"连上**（T9 任务书作者核对代码时挖出的结构缺口 ①）。
 *
 * ⇒ 现在 `pc` 是**第一个必填参数**：调用方必须把"**已经建好、并且正在用来传消息**"的那条连接
 * 交进来。这比"少一个默认值"更重要 —— 它把"两条连接"这个错误在**类型上**变成写不出来的东西。
 *
 * ## 真浏览器未验证（写死）
 *
 * `setRemoteDescription` / `createAnswer` 的**真实**行为（SDP 协商、ICE 角色、
 * 两端能不能真的协商成功）在 node 里验不了 —— 这里验的是**序列与失败处置**。
 * 那段真值由 **T9 的 CDP 真浏览器场景**覆盖。
 */
export async function acceptOffer(
  pc: PeerConnectionLike,
  offer: { readonly sdp: string },
  env?: NetBrowserEnv,
): Promise<AcceptOfferResult> {
  if (pc.setRemoteDescription === undefined) {
    return {
      ok: false,
      reason: 'unsupported',
      message: '这台设备的连接实现不接受"对端描述"（`setRemoteDescription` 缺失），所以产不出 answer。',
    };
  }
  if (pc.createAnswer === undefined) {
    return {
      ok: false,
      reason: 'unsupported',
      message: '这台设备的连接实现不会产 answer（`createAnswer` 缺失），所以这条邀请码答不回去。',
    };
  }
  if (typeof offer.sdp !== 'string' || offer.sdp.length === 0) {
    return { ok: false, reason: 'set-remote-failed', message: '这条邀请码里没有可用的连接描述（sdp 是空的）。' };
  }
  try {
    // ① 对端描述（修复轮之前从未被调用的那一步）
    await pc.setRemoteDescription({ type: 'offer', sdp: offer.sdp });
  } catch (e) {
    return { ok: false, reason: 'set-remote-failed', message: `收不下对端的连接描述：${String(e)}` };
  }
  let answer: { readonly sdp?: string; readonly type: string };
  try {
    // ② 产 answer
    answer = await pc.createAnswer();
  } catch (e) {
    return { ok: false, reason: 'answer-failed', message: `本侧没能产出 answer：${String(e)}` };
  }
  try {
    // ③ 把它落在本侧
    await pc.setLocalDescription({ type: 'answer', sdp: answer.sdp });
  } catch (e) {
    return { ok: false, reason: 'answer-failed', message: `本侧的 answer 没能落到连接上：${String(e)}` };
  }
  // ④ 等 ICE 收集（非 trickle：候选必须已经在 SDP 里）
  //    ★ T16：上界到点时手上已经有候选 ⇒ 也在这里放行（`note` 由调用方写到屏上）
  //    ★ T18：够用就收工（`stoppedEarly`）、只有 host 时走 1.5 秒宽限 —— 都由 `waitForIceGathering` 判
  const gathered = await waitForIceGathering(pc, env);
  return gathered.ok
    ? {
        ok: true, sdp: gathered.sdp, ice: gathered.ice,
        timedOut: gathered.timedOut, stoppedEarly: gathered.stoppedEarly, note: gathered.note,
      }
    : { ok: false, reason: gathered.reason, message: gathered.message };
}

/**
 * ★ **房主那一侧：把对方回示的 answer 吃进来**（B3 的第二半）。
 *
 * 它的入参是一个 `PeerConnectionLike` —— 因为**必须**是**同一条**连接：房主先出 offer
 * （`init()` 里 `createOffer` + `setLocalDescription`），收方据此产 answer，房主再把那条
 * answer 喂回**刚才那一条**连接。拿一条新连接去 `setRemoteDescription` 只会得到
 * "answer 与 offer 不是同一次协商"这类失败。
 *
 * ⇒ 所以"造连接"是调用方（`createBrowserTransport`）的事，本函数只做"喂远端描述"这一步。
 *
 * ⚠️ 真浏览器未验证：`setRemoteDescription(answer)` 的真实协商结果（ICE 能不能打通）
 * 在 node 里验不了，由 **T9 的 CDP 场景**覆盖。
 */
export async function applyAnswer(
  pc: PeerConnectionLike,
  answer: { readonly sdp: string },
): Promise<TransportActionResult> {
  if (pc.setRemoteDescription === undefined) {
    return { ok: false, reason: 'unsupported', message: '这台设备的连接实现不接受"对端描述"（`setRemoteDescription` 缺失）。' };
  }
  if (typeof answer.sdp !== 'string' || answer.sdp.length === 0) {
    return { ok: false, reason: 'bad-answer', message: '这条回示码里没有可用的连接描述（sdp 是空的）。' };
  }
  try {
    await pc.setRemoteDescription({ type: 'answer', sdp: answer.sdp });
  } catch (e) {
    return { ok: false, reason: 'set-remote-failed', message: `收不下对端的 answer：${String(e)}` };
  }
  return { ok: true };
}

/* ================================================================== *
 * 9. `NetTransport` 的浏览器实现（D18：init 只等本侧）
 * ================================================================== */

/** 本端待发队列的字节上限（真 WebRTC 上就是 `bufferedAmount`，超了报 `'queue-full'`） */
const MAX_BUFFERED_BYTES = 1 << 20;

/**
 * ★ **每条浏览器传输自己那条对端连接**（C 轮加）。
 *
 * 为什么要一个 `WeakMap` 而不是往 `NetTransport` 上挂一个字段：连接身份是**这条实现内部**的事
 * （接口上不该长出"把连接交出来"的成员 —— 假传输没有连接，而 `transport.ts` 是 T2 的交付物）。
 * `WeakMap` 的键是传输对象本身 ⇒ 传输被回收时条目跟着走，不跨局泄漏。
 */
const TRANSPORT_PC = new WeakMap<NetTransport, PeerConnectionLike>();

/**
 * ★ **取一条浏览器传输正在用的那条对端连接**（C 轮加；结构缺口 ① 的出口）。
 *
 * ## 它解决的是什么
 *
 * 承载 `hello` / `act` 的那条连接住在 `createBrowserTransport` 内部。而收方"产 answer"
 * 必须落在**同一条**连接上 —— 否则 offer/answer 在第二条上完成、消息通道在第一条上，
 * **两端从来没有为"传消息"连上**（T9 任务书作者核对代码时挖出的结构缺口 ①）。
 *
 * ⇒ 调用方用它拿到那条**已经在传消息**的连接，再交给 `acceptOffer(pc, offer)`。
 * 非本文件造的传输（`src/net/fake-transport.ts`）不在表里 ⇒ 返回 `null`
 * （**响亮**地表示"拿不到"，而不是给一条新的连接）。
 */
export function peerConnectionOf(t: NetTransport): PeerConnectionLike | null {
  return TRANSPORT_PC.get(t) ?? null;
}

/** 两条通道的 `RTCDataChannelInit`（特性从 `CHANNEL_SPECS` 的**唯一出处**取，别自己写一份） */
function dataChannelInit(channel: NetChannel): { ordered: boolean; maxRetransmits?: number } {
  const spec = channelSpec(channel);
  return spec.reliable ? { ordered: true } : { ordered: false, maxRetransmits: 0 };
}

/**
 * ★★ **一张显式的「消息 → 通道」表**（T8-E 收口）。
 *
 * 口径照 `protocol.ts` 的 `MSG_TYPES` 与 `transport.ts` 的 `CHANNEL_SPECS`：一行一条，
 * 而且**用 `Record<NetMsgType, NetChannel>` 声明** —— 给 `NetMsg` 加一条消息却忘了登记时
 * tsc 当场报"缺属性"（与 `MSG_TYPES` 的同一条纪律，别改成 `as const` 数组）。
 *
 * ## 为什么必须**显式**（真机实测，不是风格问题）
 *
 * 原先这条判定是 `net-lobby.ts` 里的一句 `msg.t === 'act' ? 'act' : 'beat'` ⇒ **整条握手**
 * （`hello` / `hello-ack` / `commit*` / `reveal-*` / `resync*` / `bye`）全被塞进了 `beat`，
 * 而 `beat` 按 `CHANNEL_SPECS` 是 `{reliable:false, ordered:false}`（`maxRetransmits: 0`）
 * 的**不可靠、可乱序**通道。真机实测（`.superpowers/g5-T8/ice-diag-afterleg.txt`）：加入方那条
 * `hello` 真的上了线，而**房主侧 `send()` 一次都没被调用**（没有 `hello-ack`）⇒ 两端永远停在
 * `handshaking`。**假传输两条通道都不丢包/不重排** ⇒ 这个缺陷在 node 面**永远看不见**。
 *
 * ## 口径（计划 §3 的通道表 + D11）
 *
 *  - `act` = **reliable + ordered**：操作记录、**握手**、重连、档案传输；
 *  - `beat` = **unreliable + unordered**：**心跳、在线状态**（G5 的 `beat` 只做这两样）。
 *
 * ⚠️ 今天 `NetMsg` 里**没有任何心跳/在线消息类型**（`MSG_TYPES` 那 14 条全是协议/档案那一族）
 * ⇒ 表里每条都是 `'act'`；`beat` 是**为心跳预留**的通道（T6 的心跳发送方还没有消息类型）。
 * 这张表把"哪条消息走哪条通道"从一句三元表达式变成**可核对的一处**：将来加心跳消息时，
 * 在这里写 `'beat'` 并写清理由，而不是让下一个人再去猜。
 */
export const MESSAGE_CHANNEL: Readonly<Record<NetMsgType, NetChannel>> = {
  // ── 握手（丢一条就永远握不上：这正是真机实测卡住的那一族）──────────────
  hello: 'act',          // 加入方的第一条；不可靠通道上会静默丢（实测的正是这一格）
  'hello-ack': 'act',    // 握手的一半，与 hello 同族
  busy: 'act',           // 拒绝入局：玩家必须看得到，不许丢
  // ── 承诺-揭示（顺序错就得出错判：必须保序）──────────────────────────
  commit: 'act',
  'commit-ack': 'act',
  'commit-face': 'act',
  'reveal-seed': 'act',
  'reveal-face': 'act',
  'reveal-salt': 'act',
  // ── 重连 / 追平（档案那一族：必须可靠且保序）──────────────────────────
  'resync-req': 'act',
  'resync-res': 'act',
  // ── 对局数据与收尾 ───────────────────────────────────────────────────
  act: 'act',            // 操作记录：`act` 通道的本来用途（D11）
  bye: 'act',            // 道别必须到得了，否则对端要等宽限期
  forfeit: 'act',        // 投降是对局状态的改变，不许丢
};

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
  /**
   * ★ T13 探针：本侧此刻处在"被探针掐线"的状态（只有 `resolved.probeLinkCut === true` 时才可能为真）。
   * 它唯一的用处是"认领侧认领齐两条通道之后如实报回 `online`"（见 `datachannel` 那一格）。
   */
  let probeCut = false;
  let detachVisibility: (() => void) | null = null;
  /**
   * ★ **本侧 ICE 收集的等待**（B2）。
   *
   * `init()` 里 `setLocalDescription(offer)` 之后**立刻**排下这个等待，但**不 `await` 它**
   * ——`init()` 的契约是"只等本侧、不等对端"（D18），而 ICE 收集是**本地**的事却要**时间**。
   * ⇒ 把"等"这件事留给 `localDescription()` 那个口：要发一条**非 trickle** 的 offer 的调用方
   * （邀请码那条路）去 `await` 它，普通路径（切前台/局域网直连）不必等。
   */
  let gather: Promise<IceGatherResult> | null = null;
  /**
   * ★ **"某条通道可以发了"的订阅者**（T8-E）。
   *
   * 为什么是一个**集合**而不是"订阅时快照一遍通道"：加入方的通道是**认领**来的
   * （`datachannel` 事件），订阅那一刻可能**一条都还没有**（D26）；若按快照挂 `open` 监听，
   * 认领来的那两条永远报不出来 ⇒ 那条等通道的握手消息永远发不出去。
   */
  const channelOpenListeners = new Set<() => void>();
  const notifyChannelOpen = (): void => { for (const cb of [...channelOpenListeners]) cb(); };

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
      // ★ T50：**先**等这一轮取凭据结算（有上界，见 `ensureCredential` 的说明），再读设置 ——
      //   否则 `waitForIceGathering` 会在"凭据还在飞"的那一刻读到"没有中继"，把严格档关掉。
      if (resolved.ensureCredential !== undefined) {
        try { await resolved.ensureCredential(); } catch { /* 取不到不是错误：降级那一条路接着走 */ }
      }
      const settings = resolved.settings?.() ?? null;
      const ice = readIceServers(settings, false, resolved.credentialRead?.() ?? null);
      const conn = resolved.peerConnection?.({ iceServers: ice.servers }) ?? null;
      if (conn === null) {
        return {
          ok: false,
          reason: 'unsupported',
          message: '这台设备没有可用的对端连接能力（需要安全上下文），联机这条路走不了。',
        };
      }
      pc = conn;
      // ★ B 档：把"刚造出来的这一条连接"交给宿主（它转头要用它接 answer，见 `onPeerConnection`）
      resolved.onPeerConnection?.(conn);
      // ★ C 轮：把这条连接登记进"这条传输的连接"表 —— 收方产 answer 时要拿回**同一条**
      //   （结构缺口 ①：answer 落在第二条连接上就等于消息通道从来没连上）
      TRANSPORT_PC.set(transport, conn);
      conn.addEventListener('iceconnectionstatechange', () => onPeerState(String(conn.iceConnectionState ?? '')));
      conn.addEventListener('connectionstatechange', () => onPeerState(String(conn.connectionState ?? '')));
      emitStatus('connecting', `正在建立本侧链路（本端 ${init.selfId}，对端 ${init.peerId}）。`);
      /** 通道登记 / 认领的**唯一一处**：出 offer 方建、加入方认领，两边共用这一份接线 */
      const registerChannel = (label: NetChannel, dc: DataChannelLike): void => {
        channels.set(label, dc);
        dc.addEventListener('message', (ev) => {
          const data = (ev as { data?: unknown }).data;
          if (typeof data === 'string') for (const cb of listeners.message) cb(data, label);
        });
        // 通道一 open 就把"可以发了"报给订阅者（订阅者里可能正等着这条握手消息）
        dc.addEventListener('open', () => { notifyChannelOpen(); });
      };
      /**
       * ★★ **D26：只有出 offer 的一方 `createDataChannel`，另一方在 `datachannel` 里认领**。
       *
       * 真机实测（`.superpowers/g5-T8/ice-diag-chanmap.txt`）：加入方那条 `hello` 在**它自己的**
       * `act` 上 `send` 成功（`readyState === 'open'`），而房主侧 `routedIn() === 0` —— 一帧都没
       * 收到、会话层**一次都没拒**。机制：过去**两边各自**建 `act`/`beat`，同一个 label 的两条通道
       * 在 SCTP 上是**两条不同的流**；应用把 `message` 监听挂在**本地建的那一条**上，而对端发来的
       * 帧落在**对端建的那一条**（只有 `datachannel` 事件认得它）⇒ 谁都没收到。
       * 假传输按 **label** 对接（`fake-transport` 的 `theirs.get(label)`）、**没有双流问题**
       * ⇒ 这个缺陷在 node 面永远看不见。
       *
       * 与 D25 同一个方向：**出 offer 方建，另一方认领**。认领来的通道那一刻通常还没 `open`
       * （`send` 会按 `readyState` 拒），所以"能发了"仍由**通道自己的 `open` 事件**驱动。
       */
      const asGuest = init.role === 'guest';
      if (!asGuest) {
        for (const spec of CHANNEL_SPECS) {
          registerChannel(spec.channel, conn.createDataChannel(spec.channel, dataChannelInit(spec.channel)));
        }
      } else {
        conn.addEventListener('datachannel', (ev) => {
          const dc = (ev as { channel?: DataChannelLike }).channel;
          // 只认两条已知通道（label 是唯一的口径来源 `CHANNEL_SPECS`）
          if (dc === undefined || !CHANNEL_SPECS.some((sp) => sp.channel === dc.label)) return;
          registerChannel(dc.label as NetChannel, dc);
          // 认领那一刻它可能已经 open（那时 `open` 事件不会再响）⇒ 认领后补报一次
          if (dc.readyState === 'open') notifyChannelOpen();
          // ★ T13 探针：掐线之后对手重建通道 ⇒ 本侧认领齐了两条 ⇒ 如实报 online（见 installProbeCut）
          if (probeCut) {
            const all = CHANNEL_SPECS.every((sp) => channels.get(sp.channel)?.readyState === 'open');
            if (all) { probeCut = false; emitStatus('online', '探针恢复：对手重建了通道。'); }
          }
        });
      }
      /**
       * ★★ **G5 T13-A：探针专用的"掐线/恢复"钩子**（`#g5probe=1` 门控，默认路径不装）。
       *
       * ## 为什么需要它（三次只读实验的结论，见 `.superpowers/g5-T13/T13AB-REPORT.md` §5）
       *
       * 浏览器里**没有**由外部施加、可逆的包级断线手段：CDP 的
       * `Network.emulateNetworkConditions(offline)` 实测**完全不影响** WebRTC（两端一直 `connected`）；
       * 杀 NetworkService 进程能真断，但那条连接**回不来**（转 `failed`、零新候选）；
       * 关卡端进程更不用说。⇒ "同链路恢复 ⇒ 重发"这条腿要在真浏览器里做，只能由页面自己
       * **真把通道关掉再重建**（实测可行：SCTP/DCEP 允许在已建立的连接上换通道，不需要重新协商
       * SDP）+ **如实报状态**（通道关了就是发不出去，报 `offline` 不是假话）。
       *
       * ## 代价（如实登记）
       *
       * 这是**测试钩子进了生产文件**：多两个全局函数与一个布尔，只在 `#g5probe=1` 时可达
       * （与 `main.ts` 的 `exposeMatchProbe` 同族的既成做法，§9 第 15 条为那一族登记过一次）。
       * 它**不改任何生产行为**：默认路径连这段代码都不会执行（`resolved.probeLinkCut !== true`）。
       */
      if (resolved.probeLinkCut === true) {
        const g = globalThis as { __g5LinkCut?: () => string; __g5LinkRestore?: () => string };
        g.__g5LinkCut = () => {
          for (const dc of channels.values()) dc.close();
          probeCut = true;
          emitStatus('offline', '探针掐线：数据通道被关掉（这一侧真的发不出去了）。');
          return 'cut';
        };
        g.__g5LinkRestore = () => {
          // 只有出 offer 的一方建通道（D26）；认领那一侧由 `datachannel` 事件接上（见上面那一格）
          if (!asGuest) {
            for (const spec of CHANNEL_SPECS) {
              registerChannel(spec.channel, conn.createDataChannel(spec.channel, dataChannelInit(spec.channel)));
            }
            probeCut = false;
            emitStatus('online', '探针恢复：通道已重建。');
          }
          return 'restore';
        };
      }
      /**
       * ★★ **D25：按角色分流 —— 加入方在收到对端 offer 之前不许建自己的 offer**。
       *
       * 过去两边都在 `init` 里 `createOffer` + `setLocalDescription`。加入方那条连接随后
       * 又要 `setRemoteDescription(对端 offer)` + `createAnswer` ⇒ 真浏览器实测（只读探针）：
       * 那条连接的 ICE 收集被回滚成 `gathering -> new`，重新 `gathering` 之后**再没产出任何
       * 候选**（40 秒零候选、零 `icecandidateerror`、`iceConnectionState` 一直 `new`），
       * 于是 `waitForIceGathering` 到点给可读失败、握手永远推进不了。
       *
       * 分流之后：
       *  - **房主/缺省**（`role !== 'guest'`）：照旧 `createOffer` + `setLocalDescription`，
       *    并把"等 ICE"排下来供 `localDescription()` 用；
       *  - **加入方**（`role === 'guest'`）：不 createOffer、不 setLocalDescription ⇒ 它那条连接的
       *    第一次描述就是 `acceptOffer` 里的 `setLocalDescription(answer)`（那条路自己在
       *    `acceptOffer` 里等 ICE，不走 `gather`）。
       *
       * ⚠️ 缺省语义是 **`undefined` = `'host'`**（`transport.ts` 的 `TransportInit.role` 写了
       * 理由）：既有调用点一个字都不用改，而这个分流只由**注入的角色**决定，不靠猜。
       */
      if (!asGuest) {
        try {
          const offer = await conn.createOffer();
          await conn.setLocalDescription(offer);
        } catch (e) {
          return { ok: false, reason: 'offer-failed', message: `本侧连接描述没有建起来：${String(e)}` };
        }
        // ★ **B2**：`setLocalDescription` 之后 ICE 收集才刚开始 ⇒ 此刻 `localDescription.sdp` 里
        //   还没有候选。这里把"等它收完"排下来（带上界），但**不 await**（`init()` 只等本侧，D18）。
        //   要发一条非 trickle 的 offer 的调用方去 `await transport.localDescription()`。
        //
        //   ⚠️ **D 轮 I-2**：这里曾经传的是**原始的** `env`（不是上面那份 `resolved`）——
        //   `waitForIceGathering` 自己会与缺省环境合并，但**缺省环境里没有 `ticker`**
        //   （那是注入能力，`defaultEnv()` 拿不到 `window`）。于是"宿主给了 ticker、这一句却看不见"
        //   ⇒ `iceGatheringState !== 'complete'` 时它回 `'unsupported'` ⇒ 房主永远取不到连接描述。
        //   结算：传 `resolved`（就是本函数这一路上读的那个合并结果），不再有第二处合并。
        gather = waitForIceGathering(conn, resolved);
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

    /**
     * ★ **取一份非 trickle 的本侧描述**（B2）：等 ICE 收集完成再读 `localDescription`。
     *
     * 三种失败都**可读**，而且都**不会挂住**：没 `init` 过 / 没有等的能力 / 等到上界却
     * 一个候选都没有。
     *
     * ★★ **G5 T16**：上界（或宽限）到点、但已经拿到了 ≥1 个候选时**不再整条失败** —— 返回 `ok: true`
     * 加上 `timedOut: true` 与一句 `note`（调用方把它写到屏上，如实说明"只拿到这些、
     * 跨网能不能连还不知道"）。
     *
     * ★★ **G5 T18**：`note` 现在有**三种**来路，别按"没有 `note` = 收完了"推断 ——
     * 正常收完（`stoppedEarly: false` + `note` 空）/ 够用就收工（`stoppedEarly: true` + 一句短话）/
     * 宽限或上界放行（`timedOut: true` + `partialGatherNote`）。
     */
    async localDescription(): Promise<
      TransportActionResult & {
        readonly sdp?: string;
        readonly timedOut?: boolean;
        readonly stoppedEarly?: boolean;
        readonly note?: string;
      }
    > {
      if (!initDone) {
        return { ok: false, reason: 'not-initialized', message: '本侧链路还没建立（init 还没成功），现在没有连接描述。' };
      }
      if (gather === null) {
        return { ok: false, reason: 'unsupported', message: '本侧没有在等 ICE 收集（这条实现不给连接描述）。' };
      }
      const g = await gather;
      if (!g.ok) return { ok: false, reason: g.reason, message: g.message };
      return {
        ok: true, sdp: g.sdp, timedOut: g.timedOut, stoppedEarly: g.stoppedEarly, note: g.note ?? undefined,
      };
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

    /**
     * ★★ **"通道真的可以发了"**（`transport.ts` 的 `onChannelOpen` 契约，T8-E）。
     *
     * 为什么它与 `onStatus('online')` **不是**同一件事（真机实测，`.superpowers/g5-T8/ice-chan-probe.txt`）：
     * `connectionstatechange -> connected` 与两条 DataChannel 的 `open` 在真 Chrome 里差
     * **约 3 毫秒**（11521ms vs 11524ms）⇒ 在 `online` 那一刻 `send()` 看到
     * `readyState === 'connecting'`、直接丢掉那条消息。加入方的第一条 `hello` 正是这么丢的。
     *
     * 实现：对**每一条**已建出来的通道各挂一个 `open` 监听，**每条 open 各叫一次**（不是"第一次
     * open 就叫一次就完"）；若订阅时某条通道**已经** open，那条**立刻**叫一次。
     *
     * ⚠️ **为什么必须"每条各叫一次"**（真机实测，`.superpowers/g5-T8/ice-diag-read.txt`）：
     * 两条通道的 `open` 不同时到（先 `act` 后 `beat`），而 `hello` 走的是 **`beat`**
     * （`net-lobby` 的 `send()`：`msg.t === 'act' ? 'act' : 'beat'`）⇒ 只在第一条 open 时叫一次，
     * 那次重试仍会撞上 `beat` 还没 open、报 `offline`，而**再没有第二次机会** —— 症状就是
     * 诊断读数里那串 `flush:挂通道open | channelOpen回调 | flush:失败(offline)` 之后彻底停住。
     * 返回把所有监听摘掉的退订函数。
     */
    onChannelOpen(cb: () => void): () => void {
      channelOpenListeners.add(cb);
      // 订阅时**已经**有通道 open ⇒ 立刻叫一次（别让调用方漏掉这个时机）
      for (const dc of channels.values()) {
        if (dc.readyState === 'open') { cb(); break; }
      }
      return () => { channelOpenListeners.delete(cb); };
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

/**
 * 量一条载荷的长度并给出区间判定（判据 7 与 T8 的提示共用这一处）。
 *
 * ## ★★ G5/T40：区间按**这条码实际用的档位**选（评审点名的那一处）
 *
 * 未压缩变体（`-u`）本来就比压缩档长得多（实测 1823-1826 字符），拿 600-900 去判它 ⇒
 * 一条**完全正常**的 `-u` 码会被判成"不在实测区间内…可能被截断" —— 而那正是**最老内核
 * 唯一能用**的那一档，最不该在屏上吓人。所以这里先读压缩段的明文标记：
 *  - `'none'` ⇒ 用 `INVITE_CHARS_MAX_UNCOMPRESSED`（它自己的实测上界）；
 *  - 其余（raw / deflate / gzip） ⇒ 600-900（压缩档的实测区间，一个字没动）。
 *
 * ⚠️ 字段名仍是 `withinMeasuredRange`（调用方 `src/main.ts` 读的就是它）⇒
 * 它的含义收紧成"落在**这一档的**实测区间内"，`min` / `max` 也回**这一档**的区间。
 * 这样屏上那句长度读数不需要知道档位就已经是对的（`inviteLengthText(chars, within)`）。
 *
 * ## ★★ G6/T49：紧凑档（v3）用它自己那一组区间（`createInvite` 走精确路径）
 *
 * v3 的载荷里没有整段 SDP ⇒ 长度掉到三分之一上下。它要是继续按 600-900 判，**产品自己刚
 * 产出的**正常码会被屏上说成"不在这一档的实测区间内"（那句话本身按字面仍然是真的，
 * 但它对玩家是噪音）。
 *
 * ⚠️ **本函数只看这一个字符串**：v3 与 v2 的版本号都住在**压缩段里面**（不解压读不到），
 * 所以它**不能**从这个字符串可靠地判出版本。⇒ 产品路径由 `createInvite()` 走**精确**路径
 * （它手里有 `prefer.mode`，直接调 `inviteLengthReportOf(payload, compact)`），
 * 而本函数（缺省 = 不假定紧凑）服务"手上只有一串字符"的调用点。**不猜**。
 */
export function inviteLengthReport(payload: string): InviteLengthReport {
  return inviteLengthReportOf(payload, false);
}

/**
 * ★ G6/T49：**知道这条码是哪一档**时的长度读数（`createInvite` 与大厅那句长度提示用它）。
 *
 * ## ★★ 档位判定的优先级：**先载荷版本（v3/v2），再压缩档（none/其余）**
 *
 * 评审（2026-09-28 定向复验 P0）在真屏上读到：一条 **476 字符的 v3 `-u` 码**被判成
 * 「不在这一档的实测区间内…可能被某些聊天工具截断」—— 而 476 正落在 v3 `-u` 自己的实测区间里。
 * 原因就是这里原来写的是"`none` 优先"：`kindOfPayloadText(payload) === 'none'` 直接选
 * `INVITE_CHARS_MAX_UNCOMPRESSED`（v2 未压缩档的 2000 上界），紧凑档那一组**根本没被看到**。
 *
 * ⇒ 顺序改成：
 *  1. `compact === true`（v3）⇒ `COMPACT_INVITE_CHARS_MIN/MAX`（不管它压没压：v3 `-u` 实测
 *     **476**、v3 压缩档实测 **348**，都在这一组里）；
 *  2. 否则（v2）看压缩档：`'none'` ⇒ `INVITE_CHARS_MIN`-`INVITE_CHARS_MAX_UNCOMPRESSED`；
 *  3. 其余（v2 压缩档）⇒ 600-900。
 *
 * ⚠️ 不传 `compact` 的调用点（`inviteLengthReport()`）仍然只按"压缩档"判 —— 那是**只为旧调用
 * 保留**的口径：v3 码走它会被归到 v2 那一组区间（v3 的版本号住在压缩段里，不解压读不出来）。
 * 产品路径两处都传了准确值（`createInvite` 与 `src/main.ts` 那段接线）。
 */
export function inviteLengthReportOf(payload: string, compact: boolean): InviteLengthReport {
  const none = kindOfPayloadText(payload) === 'none';
  const min = compact ? COMPACT_INVITE_CHARS_MIN : INVITE_CHARS_MIN;
  const max = compact ? COMPACT_INVITE_CHARS_MAX
    : (none ? INVITE_CHARS_MAX_UNCOMPRESSED : INVITE_CHARS_MAX);
  return {
    chars: payload.length,
    withinMeasuredRange: payload.length >= min && payload.length <= max,
    min,
    max,
  };
}

/**
 * 一条**裸载荷**用的是哪一档（读压缩段的明文标记；读不出来按 `'raw'` 算）。
 *
 * 它只服务"区间判定"这一件事 —— 真解码那条路在 `decodeInvitePayload` 里，那里对
 * 认不出的标记给的是**可读拒绝**，这里给的是一个保守的默认档（长度读数不该因为一条坏码就报错）。
 */
function kindOfPayloadText(payload: string): CompressionKind {
  const dot = payload.indexOf('.');
  if (dot <= 0 || dot === payload.length - 1) return 'raw';
  return readInviteSegment(payload.slice(dot + 1)).kind ?? 'raw';
}

/** `inviteLengthReport` 的区间读数（**不含**任何"这条码好不好用"的结论） */
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
