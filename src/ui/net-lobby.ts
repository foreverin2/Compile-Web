/**
 * 联机大厅（G5 T8）—— 建房 / 加入 / 连接设置 / 连接状态，**唯一**的联机页面。
 *
 * ## 五件义务（计划 §5 T8 的四件渲染 + D24 的接线）
 *
 *  1. **短码入口的可读提示**（§8.1 / D17）：端点为空时"输 6 位码"这条路给一句可读提示，
 *     而且**一个网络请求都不发**（文案本体是 `src/net/invite.ts` 的 `NO_ENDPOINT_MESSAGE`，
 *     本文件只**渲染**它）；
 *  2. **「高级 / 连接设置」折叠区**（§8.2 (a) + D22）：默认折叠的 TURN 入口；玩家把 TURN
 *     三项填齐之后，屏上出现 `src/app/privacy.ts:111` 那句（**引用**，不重写、不加第二句）；
 *  3. **"断线 ≠ 刷新"的玩家可见文案**，与 T6 的读数**同源**（`peerStatus()` → 文案的映射
 *     只有 `LOBBY_LINK_COPY` 那一张表）；
 *  4. 第 4 件义务（"中继结论句"的扫描腿）住在 `tests/ui/privacy-consumers.test.ts` 里 ——
 *     它存在的理由正是"这个文件**不** import `privacy.ts` 之外的第二份中继措辞"；
 *  5. **入站消息喂进 `accept`**（**D24** 的裁决 + D19）：`createLobbySessionLink()` 把会话层与
 *     传输层真的接起来 —— 收到一帧就 `decodeMsg` → `session.accept(...)` → 把产出的消息发回去。
 *     没有这一步，加入方的 `handshakeDone` 永远不前进（它等的 `hello-ack` 没人递进去）。
 *
 * ## 为什么它是**独立屏**
 *
 * 大厅没有 `GameState`（对局还没开始），而 `'net'` 那个 `renderMode` 值已经是**远程页单视角预览**
 * （零联机、从草稿流程进来）⇒ `rerender()` 里那个 `state.phase !== 'draft'` 的预览分支不可能同时
 * 承担"大厅"与"预览"两种语义。所以 `renderMode` 取第四个值 `'lobby'`，本文件自己清 root，
 * **不**复用 `render.ts` / `render-net.ts` 的棋盘渲染器（判据 12 的划界腿钉这一点）。
 *
 * ## 红线（写在这里，因为它决定了本文件的写法）
 *
 *  - **不 new 任何网络构造器**：`RTCPeerConnection` / `WebSocket` 只许出现在
 *    `src/ui/net-browser.ts`（D6）。本文件通过 `LobbyClientOptions` 拿到**能力**；
 *  - **不写第二份隐私/信令措辞**：玩家可见的说明一律从 import 进来的那几个**唯一出处**取；
 *  - **不实现重连重发**（D23 是 T6 的活）：这里只把 `needsResync*` 的读数转成可读提示；
 *  - **重连必须新建会话对象**（计划 §5 T8 的硬约束，D23 收方幂等只覆盖 2/5 格的**充分性前提**）：
 *    见 `createLobbySessionLink()` 末尾那段注释。
 *
 * ## 本文件里**故意**没有的东西
 *
 *  - **8 秒窗口只走注入的计时器**（`LobbyTicker`，缺省由宿主给）。裸 `setTimeout` 散在页面里
 *    既不可测，也违反本仓"计时一律注入"的惯例 —— 而"连不上"这条路径的行为腿只能用假时钟跑；
 *  - **不构造 `WebSocket` / `fetch`**：端点判定用 `roomCodeEntryReachability`（**纯配置判定**，
 *    它的函数注释写着"端点非空时本函数什么都不做"）。真正的网络动作住 `src/ui/net-browser.ts`，
 *    由 `src/main.ts` 注入 ⇒ 判据 5 的"端点为空 ⇒ 记账数 0"在这里是**结构上**成立的，
 *    不是靠"我记得别调"。
 */

import {
  INVITE_FRAGMENT_KEY,
  INVITE_PROTO_VERSION,
  NO_ENDPOINT_HEADLINE,
  NO_ENDPOINT_REASON,
  decodeInviteText,
  inviteFragmentOf,
  inviteLinkOf,
  isAnswerPayload,
  protocolVersionCheck,
  qrPlaceholder,
  roomCodeEntryReachability,
} from '../net/invite';
import type { InviteDecodeResult } from '../net/invite';
import { createGuestSession, createHostSession } from '../net/session';
import type {
  ClockLike, HashLike, NetSession, PeerStatus, SessionInbound, SessionOutbound, SessionPhase,
} from '../net/session';
import { decodeMsg, encodeMsg, normalizeRoomCode, roomChannel } from '../net/protocol';
import type { NetMsg } from '../net/protocol';
import type { NetChannel, NetTransport, SendResult, TransportStatus } from '../net/transport';
import { PRIVACY_COPY } from '../app/privacy';
import type { MatchFile } from '../app/match-file';
import { coinLanding, draftStarterFor, faceFromSide, sideFromFace } from '../app/coin';
import type { CoinSide } from '../app/coin';
import type { CoinNetView } from './home';
import type { PlayerId } from '../core/models/types';
// ★ G5 T14：「轮到谁」那一行里的"第 N / 6 步"用的是引擎自己的常量（不在这里另写一个 6）
import { DRAFT_PICK_COUNT } from '../core/state/create';
import { readIceServers, MESSAGE_CHANNEL } from './net-browser';
import type { IceServersRead } from './net-browser';

/* ==================================================================== *
 * 1. 注入面
 * ==================================================================== */

/**
 * 计时能力。形状照 `src/app/match-driver.ts:152` 的 `Ticker`（本仓的既有惯例）——
 * 本文件**不读** `Date.now`、**不直呼** `setTimeout`。
 *
 * 生产实现由 `src/main.ts` 用 `window.setTimeout` / `window.clearTimeout` 包一层；
 * 测试注入假时钟（判据 3 的"8s 超时"那条腿就是这么跑的）。
 */
export interface LobbyTicker {
  schedule(fn: () => void, ms: number): number;
  cancel(h: number): void;
}

/** 一次"读地址栏 invite"的结论（`null` = 地址栏里没有，**不是错误**） */
export interface InviteRead {
  readonly payload: string;
  /** 读完之后是否**已经**抹掉地址栏（判据 6 的 ⑤：只在读到载荷之后抹） */
  readonly stripped: boolean;
}

/**
 * 生成一条邀请链接的输入（`sdp` / 承诺串 / ICE 候选由宿主给：本屏不造这些事实）。
 *
 * 为什么连 `p`（本机协议版本）都在这里显式列出来：它是 `encodeInvite` 的**必填字段**
 * （`InviteFields = Omit<InvitePayload, 'v'>`，而 `p` 在里面）。让它留在这里而不是藏进
 * `createInvite` 的调用里，是为了"邀请码里那个明文版本号取自哪一个常量"在调用点一眼可见 ——
 * 判据 3 第一行（版本不一致）读的就是它。
 *
 * `hostPromise` / `guestPromise` 是**不透明串**（`encodeInvite` 只校验"非空、不含分隔符"）：
 * 它们来自承诺流程，而 T8 不跑真握手 ⇒ 生产侧今天交的是占位串（见 `main.ts` 那一处注释）。
 */
export interface LobbyDraftInput {
  readonly p: number;
  readonly originAndPath: string;
  /**
   * ★ D 轮（I-3 甲）：**这一局的房主会话号**。
   *
   * 它由宿主给（`main.ts` 那边就是 `opts.sessionId` 同一串 —— 建会话对象与写邀请码
   * 必须是**同一个号**，否则加入方照载荷建出来的会话与房主那侧对不上）。
   * 本层不生成它：`sessionId` 的唯一来源是调用方（`src/net` 不许取随机）。
   */
  readonly sessionId: string;
  readonly sdp: string;
  readonly ice: readonly string[];
  readonly hostPromise: string;
  readonly guestPromise: string;
}

/** `makeInvite()` 的结论。**载荷只在 fragment**（判据 6）：`link` 由 `inviteLinkOf` 组装 */
export type MakeInviteResult =
  | { readonly ok: true; readonly payload: string; readonly link: string }
  | { readonly ok: false; readonly message: string };

/**
 * ★ **一条回示码**的产出结论（B3）。
 *
 * 为什么 `code` 与 `payload` 都留着：它们是**同一条**载荷的两个名字 ——
 * `payload` 是它本来的名字（与邀请码同形状），`code` 是"玩家看到的那个东西"的名字。
 * 两个字段装同一个值会让"同一概念两个名字"那条纪律看起来被破坏，所以这里**只留 `code`**
 * （它就是载荷），调用方要什么自己取。
 *
 * ★★ **G5 T16**：`note` 是"上界到点、但手上已经有候选"那一刻要说给人听的那一句
 * （宿主从 `acceptOffer()` 的 `note` 原样带过来，本层只负责写上屏）。
 * ⚠️ 它**不是**失败，也不是成功承诺：跨网能不能连，那句话里写的是"还不知道"。
 */
export type AnswerCodeResult =
  | { readonly ok: true; readonly code: string; readonly note?: string }
  | { readonly ok: false; readonly message: string };

/**
 * 大厅的宿主接缝 —— **能力一律注入**。
 *
 * ## 为什么传输是"造一个"的动作而不是现成对象
 *
 * 判据 14 要求**用可注入的假传输**驱动一次完整握手。如果大厅内部直接
 * `createBrowserTransport()`（真 WebRTC），假件就喂不进来 —— 那**正是那条判据要抓的缺陷**，
 * 不是判据要放宽的理由。
 *
 * ## ★ D 轮 I-3（走甲）：`sessionId` 的**两个来源**，别混
 *
 *  - `opts.sessionId` 是**本端自己**的会话号（真实调用方 `main.ts` 各自 `newSessionId()`）；
 *  - 邀请码里带着**房主的**会话号（`InvitePayload.sessionId`）。
 *
 * 会话层是**按会话号配对**的：房主用它校验加入方发来的 `hello`。所以加入方建会话对象时
 * 用的是**邀请码里那一串**（不是自己那串），否则两端永远是两套号、握手当场被拒
 * （症状：加入方停在 `handshaking`）。房主侧没有这个"别处的号"，就用自己那串。
 *
 * 归属：加入方那串仍然上报（`hello.sessionId` 是它自己的身份），**只有"这一局叫什么"照房主**。
 */
export interface LobbyClientOptions {
  /** 本端角色：房主建房、加入方贴邀请码 */
  readonly role: 'host' | 'guest';
  /** 本局 `sessionId`。**由调用方生成**（`src/net` 不许取随机，§2 第 2 条） */
  readonly sessionId: string;
  /**
   * ★★ **T11-A（I-5 的修正）**：本局的**种子素材**，以及本端要一条真随机串时用的那个口子。
   *
   * ## 为什么必须注入，且必须与 `sessionId` 无关
   *
   * 承诺流程里房主要发 `commit { hash(seed, salt) }`。修正前这里是
   * `sessionId` 派生的常量（`` `seed-${sessionId}` `` / `` `salt-${sessionId}` ``），
   * 而 `sessionId` **明文写在邀请码里**（`InvitePayload.sessionId`）⇒ 加入方在叫面之前
   * 就能把种子算出来，那条"叫面早于公开种子"的结构约束在**值**上被绕过（I-5）。
   *
   * ⇒ 熵只能来自注入：`matchSeed` 是本局的种子（由宿主在 `startLobby()` 那一刻取一次），
   * `randomToken` 是"再要一条随机串"的动作（`src/ui/match-seed.ts` 的 `newRandomToken`）。
   *
   * ## 为什么两个都是**必填**（不是可选 + 兜底）
   *
   * 可选 + 回落 `sessionId` 会让"忘了注入"退化成 I-5 原形，而且在屏上完全看不出来。
   * 必填 ⇒ `main.ts` 与新写的测试都必须显式给；漏了就在 tsc 上红，
   * 而不是在真机上表现成"这局的种子怎么总是同一串"。
   */
  readonly matchSeed: string;
  /** 要一条真随机串（房主的盐、加入方的面 nonce）。调用两次得到两条不同的串，且各只调一次 */
  readonly randomToken: () => string;
  /**
   * ★★ **T11-B：向注入的能力要"这一局叫哪一面"**（加入方的 `commit-face` 用它）。
   *
   * ## 时机是写死的（D27 那条结构约束在代码里的样子）
   *
   * 要面发生在**`seed-committed` 那一格**（加入方收下房主的 `commit` 之后、发 `commit-ack` 之后），
   * **不是**等到 `complete`：等到 `complete` 就意味着种子**先**公开、加入方**后**叫面，
   * 硬币永远归它赢（D27 的两个选项里用户选了"保留顺序约束"）。
   *
   * ## 未注入时保持今天的行为（常量 0），并由测试钉住"屏上没有硬币屏"
   *
   * 缺了这个注入项 ⇒ 相位机照旧往下走、`commit-face` 照旧发面 `0`（`sideFromFace(1)`），
   * 也就是 T11-B 之前那套**常量面**的行为。它**不是**可选兜底意义上的"随便挑一面"，
   * 而是"这条调用方没有接硬币屏"这件事的显式后果：`main.ts` 接了硬币屏，测试夹具可以只走流程。
   *
   * ## 为什么是 Promise
   *
   * 面来自**玩家的点击**（硬币屏上那两枚芯片）：`Promise` 恰好是"这一刻还没定、定了就 resolve"
   * 的形状。`driveOnce` 在它 resolve 之前**不推进那一格**（也就不会先发 `reveal-seed`）。
   */
  readonly chooseFace?: () => Promise<CoinSide>;
  /** 本机协议版本与卡牌指纹（`NetSessionOptions` 的两个必填本地事实） */
  readonly localProtoVersion: number;
  readonly localCardDataHash: string;
  /** 哈希能力（D15 的同步契约） */
  readonly hash: HashLike;
  /** 本机座位（房主缺省 0；加入方的座位由 `hello-ack.seat` 覆盖，D7） */
  readonly seat?: 0 | 1;
  /** 计时能力（8 秒窗口） */
  readonly ticker: LobbyTicker;
  /**
   * ★★ **G5 T13-C：300s 重连窗口的时钟能力**（D8 的 2026-09-18 补充裁决；可选）。
   *
   * ## 为什么它是一个**注入项**，以及不注入时的语义
   *
   * `src/net` 是纯层、不许读时钟（§2 第 2 条）⇒ 窗口的时间来源只能由宿主注入
   * （`NetSessionOptions.clock`）。这里把它**照传**给这一局建出来的会话对象：注入了 ⇒
   * `peerStatus().windowExpired` 是 `false`/`true`（判得了）；不注入 ⇒ 恒 `null`（**判不了**，
   * 屏上走 `'offline-window-unknown'` 那一格，不许说"超窗"）。
   *
   * ⚠️ **生产今天不注入它**（`src/main.ts` 的 `startLobby` 没传；理由写在报告 §判据 1 里：
   * 心跳（D11 的 `beat`）还没接线，注入真时钟会让"两边都在、但 5 分钟没说话"的对局被判成
   * 对端离线）⇒ 玩家今天看到的是"判不了"那一格。这条注入缝是给"要判窗口的宿主"与腿留的。
   */
  readonly clock?: ClockLike;
  /**
   * 造一个传输。**生产实现是 `createBrowserTransport(env)`**；测试传
   * `createFakeTransportPair().A.transport`。
   *
   * ⚠️ **`init()` 由 `connect()` 负责调**（不是这个工厂）：真 WebRTC 的 `init()` 是异步的
   * （`transport.ts:219` 明写"必须异步建立"），而"建好传输"与"链路起来"是两件事 ——
   * 把 `init` 塞进工厂会让工厂变成异步的，也会让"哪一步失败"在读数上分不开。
   */
  readonly createTransport: () => NetTransport;
  /** 读设置里的信令端点（**纯配置读**，不发请求；唯一出处是 `signalingEndpointSetting`） */
  readonly signalingEndpoint: string;
  /** 读 TURN 三项（读设置的动作；唯一判定处是 `net-browser.ts:431` 的 `readIceServers`） */
  readonly readSettings: () => { readonly turnUrl?: string; readonly turnUsername?: string; readonly turnCredential?: string } | null;
  /** 生成邀请链接（真压缩在浏览器层，是异步的） */
  readonly buildInvite: (draft: LobbyDraftInput) => Promise<MakeInviteResult>;
  /**
   * ★ **B3 的第二半（收方）**：把对方的 offer 吃进来，产一条**回示码**。
   *
   * 为什么它是一个**注入能力**而不是大厅自己调 `acceptOffer`：产 answer 要**浏览器 API 的序列**
   * （`setRemoteDescription` → `createAnswer` → `setLocalDescription` → 等 ICE），
   * 而 D6 说浏览器 API 的唯一出处是 `src/ui/net-browser.ts`。大厅只**搬运**。
   * 可选：不注入时"产回示码"这条路在屏上**不出现**（而不是给一个点了没反应的按钮）。
   */
  readonly buildAnswer?: (offer: { readonly sdp: string; readonly ice: readonly string[] }) => Promise<AnswerCodeResult>;
  /**
   * ★ **B3 的第一半（房主侧收口）**：把对方回示的 answer 喂进**同一条**连接。
   *
   * 可选，理由同上（它也是浏览器 API 的序列）。
   */
  readonly applyAnswer?: (answer: { readonly sdp: string }) => Promise<{ readonly ok: true } | { readonly ok: false; readonly message: string }>;
  /**
   * ★ **把邀请码的压缩段解回"已经算好的字节"**（`decodeInviteText` 要的那个**同步**口径）。
   *
   * ## 它是两件事，别只做一半（修复轮 A1 的第一次尝试就栽在这里）
   *
   * 压缩段要解**两步**：**base64url 解码 → deflate-raw 解压**。只做第一步会让
   * `decodeInviteText` 拿到一串**仍是压缩态**的字节，它会把那串当"解压结果"去 `JSON.parse`
   * ⇒ 必然返回 `bad-json`（"解压后的内容不是 JSON 文本"）。**真解压才是这一步的全部内容**。
   *
   * ## 为什么是异步的
   *
   * 真解压走 `DecompressionStream`，流式、**必须 `await`**（`net-browser.ts:526` 的
   * `decompressBytes` 就是它）。而纯层的 `decodeInviteText` 要一个**同步**口 ⇒ 宿主先 `await`
   * 出字节、再把它当"已经算好的结果"交进来（D15 的同一种缝法，`createInvite` 也这么做）。
   *
   * 返回 `null` = "这段解不开"（形状不对 / 压缩流坏了）—— 那是**失败**，不是"没解压"。
   *
   * ⚠️ **修复轮 A1 的历史**：这里曾经被 `main.ts` 传成 `() => null`，于是 `decodeInviteText`
   * 必走 `decompress-failed` 那一支（`invite.ts:581-590`）⇒ **对方发来的每条邀请码都解不开**。
   * 那是"功能上不可能成立"，不是"缺一条腿"。
   */
  readonly decompressBase64: (b64: string) => Promise<Uint8Array | null>;
  /** 读地址栏里的邀请码并**在读到之后**抹掉它（`readInviteFromAddressBar` + `stripInviteFromAddressBar`） */
  readonly readAddressBar: () => InviteRead | null;
  /** 本机昵称（`hello.nick` 的唯一来源；`session.ts:2438` 说"`hello` 里还有 `nick`"） */
  readonly localNick?: () => string;
  /** 可读提示的搬运口（错误路径 / 短码提示）。`null` = 清空 */
  readonly onNotice?: (text: string | null) => void;
  /**
   * ★ **入站帧被处理过之后**的回调（修复轮 A4）。
   *
   * 为什么要它：`createLobbySessionLink` 里那条 `transport.onMessage` 只会更新**它自己的**
   * 记账数与会话状态；屏上要变就必须有人重画一帧。没有这个回调时，"入站到了"这件事
   * 在界面上**看不见**（屏上停在上一帧的读数上）—— 正是评审 1.3 的 A4。
   *
   * 它是**每个入站帧调一次**（包括解不开的坏帧）—— 因为"收到过一帧"本身就是屏上该反映的事实。
   */
  readonly onInbound?: () => void;
  /**
   * ★★ **G5 T13-A/B：重连接线要的三样能力**（全部由宿主注入，本文件不自己发明）。
   *
   * ## 为什么是"能力注入"而不是"本文件自己算"
   *
   *  - `appliedSteps`：`resync-req.appliedSteps` 是**本端驱动**的进度事实（下一条 `seq`），
   *    而驱动住在 `src/main.ts` 手里（`NetDriver.appliedSteps()`）。本文件**不持有**它
   *    （`src/net` 那套"驱动不持有 GameState"的同一条纪律：谁的状态谁报数）；
   *  - `resyncSource`：**房主侧**的重连凭据（D8："重连凭据 = 主机内存里的当前 MatchFile"）。
   *    档案住在 `MatchFileRecorder` 里（`src/app/match-file.ts:551`），本文件既拿不到也不该持有；
   *    返回 `null` = 本端此刻没有可发的档案（会话层会回 `'resync-not-wired'`，**fail-closed**）；
   *  - `onResyncRes`：**加入方侧**收到档案之后"把状态真的重建出来"的那一步。它必须由宿主做，
   *    因为重建要 `stateAtStep`（`src/app/match-replay.ts` 的单一出处）与宿主持有的 `GameState`
   *    ⇒ 本文件只把**档案**交出去，宿主回一个"我应用了几步"；返回 `null` = 宿主拒绝/失败
   *    （可读原因由宿主写到屏上），此时**不许**再走 `applyResyncFile`（否则会把"没重建"记成"追平完成"）。
   */
  readonly appliedSteps?: () => number;
  readonly resyncSource?: () => MatchFile | null;
  readonly onResyncRes?: (file: MatchFile) => number | null;
  /**
   * ★★ **G5 T13-A（协调者 2026-09-20 第 2 条裁决）：本端此刻有没有"可续的对局进度"**。
   *
   * 断线重连的**两条路**由此分开，后果完全不同：
   *  - `true`（已经进过牌桌）：走 `connect('resume')` —— `markResuming()`、`hello` 带
   *    `resuming: true`、要档案追平。**这条才是"重连"**；
   *  - `false`（**还没进牌桌**：握手还没走完 / 硬币还没落地）：**没有可续的进度**，而
   *    `resync-res` 在机制上不可能到位（房主手里还没有档案 ⇒ `acceptResyncReq` 回
   *    `'resync-not-wired'`，`session.ts:2139-2143`）⇒ 若仍走 `'resume'`，加入方会**永久停在
   *    `resuming`**、屏上一直说"正在把这一局追平"（不报错的死挂）。
   *    ⇒ 这一格走 `connect('first')`：**重新来一次握手**，两端各自新建会话对象，谁也不欠谁。
   *
   * ⚠️ 它不是"第二份状态"：语义只有"本端手里有没有一局已经在打的对局"，而那个事实的唯一主人
   * 是宿主（`main.ts` 的 `netGame`）⇒ 由它注入。
   */
  readonly hasResumableGame?: () => boolean;
}

/* ==================================================================== *
 * 2. 五条错误路径的可读文案（判据 3）
 * ==================================================================== */

/**
 * 五条错误路径的**键**。它们是"哪个场景"的名字，不是文案。
 *
 * 为什么做成一张键表 + 一个取值函数（而不是五处内联 `?? '…'`）：
 *  1. 判据 3 要求"五条文案两两不同且非空"—— 表是那个判据唯一能被机器读的形状；
 *  2. 变异 M2（"房间不存在"与"版本不一致"共用同一句）的锚点因此**恰好一处**
 *     （改表里两行的取值），而不是"五处散落分支，改哪一处都得先找到它"。
 */
export type LobbyErrorKey =
  | 'proto-version'
  | 'card-data-hash'
  | 'room-gone'
  | 'busy'
  | 'spectator';

/** 五条错误路径的键（**顺序即屏上的说明顺序**；判据 3 遍历它） */
export const LOBBY_ERROR_KEYS: readonly LobbyErrorKey[] = [
  'proto-version',
  'card-data-hash',
  'room-gone',
  'busy',
  'spectator',
];

/**
 * 默认的"连不上"窗口（毫秒）= 8 秒。
 *
 * 出处：计划 §5 T8 原文写死的 8s（设计稿 `:441`）。它**可注入**（`LobbyTicker`），
 * 因为"8 秒之后给提示"这条行为腿只能用假时钟跑。
 */
export const DEFAULT_ROOM_GONE_MS = 8_000;

/**
 * 四条文案（`'proto-version'` 不在表里 —— 那一格**现调**唯一出处，见 `errorCopy`）。
 *
 * ## 来源可追（判据 3 的第二列）
 *
 *  - `'card-data-hash'` / `'busy'` / `'spectator'` ← 会话层/协议层给的**拒绝原因**
 *    （`validateHello` 的 `HelloRejectReason`）。T8 只**转发**；
 *  - `'room-gone'` ← **大厅自己的 8s 超时读数**。
 */
const ERROR_COPY: Readonly<Record<Exclude<LobbyErrorKey, 'proto-version'>, string>> = {
  'card-data-hash':
    '两端的卡牌数据不是同一份（握手时卡牌指纹对不上）：请确认两台设备装的是同一个版本的卡牌资料，'
    + '其中一方更新过卡牌资料的话，另一方也要跟着更新。',
  'room-gone':
    `等了 ${DEFAULT_ROOM_GONE_MS / 1000} 秒也没连上对端：房间码可能打错了，或者房主已经关掉页面`
    + '（主机关掉页面就是这一局结束）。可以核对房间码重试，或者改用邀请码（它不需要信令服务）。',
  busy:
    '这个房间的玩家位已经满了：G5 一局只有两个玩家位，没有空位可以进来。'
    + '请让房主确认没有别人先进来，或者另开一个房间。',
  spectator:
    '这个版本还不支持观战：观战席还没造出来（**不是**观战席坐满了）。请让对方以玩家身份重新握手。',
};

/**
 * 取一条错误文案。
 *
 * `'proto-version'` 那一格**必须**现调 `protocolVersionCheck`：那是"版本不一致"这句话的
 * 唯一出处（判据 3 的第一行）。把那句话抄进本文件会让同一句话有两个家 —— 正是判据 1 要抓的形态。
 */
export function errorCopy(key: LobbyErrorKey, remoteProto: number = INVITE_PROTO_VERSION): string {
  if (key === 'proto-version') {
    const verdict = protocolVersionCheck(remoteProto);
    if (verdict.ok) {
      // 一致时那个函数**没有**可读真因（它的契约如此）⇒ 这里给一句"这一格今天没被走到"的说明，
      // 而不是返回空串让屏上出现一条没有内容的错误行。
      return '协议版本与本机一致，所以这一格今天不会被渲染出来（它只在版本不一致时由 protocolVersionCheck 给出）';
    }
    return verdict.message;
  }
  return ERROR_COPY[key];
}

/* ------------------------------------------------------------------ *
 * 3b. ★ 判据 3 的"连线"另一半：**读数 → 该格文案**（修复轮补）
 * ------------------------------------------------------------------ */

/**
 * 握手被回绝时，**对方给的那条可读真因**（`HelloRejection.message` / `BusyMsg.detail`）。
 *
 * 它只带**内容**，不带"这属于哪一格" —— 判"属于哪一格"的是 `errorKeyOfRejection`。
 */
export interface LobbyRefusal {
  /** 会话层/协议层给的事实码（`HelloRejectReason` | `'unsupported-spectator'` | …） */
  readonly reason: string;
  /** 给人看的那一句（本文件只**转发**它，不改写） */
  readonly detail: string;
}

const CARD_HASH_REASONS: readonly string[] = ['card-data-hash'];
const BUSY_REASONS: readonly string[] = ['player-slots-full', 'busy', 'full'];
const SPECTATOR_REASONS: readonly string[] = [
  'spectator-slots-full', 'unsupported-spectator', 'spectator', 'unsupported',
];

/**
 * ★ **把一条拒绝**映到**它该显示的那一格**（判据 3 的连线；评审 §6.1 要求补的那一半）。
 *
 * ## 为什么必须有它（自评最薄弱的那条判据的第二半）
 *
 * 原来只有"五句文案两两不同且非空"这一层 ⇒ 即使将来把 `busy.detail` 接到了
 * `card-data-hash` 那一格，只要五句仍两两不同，**判据不会红**（它钉的是**词表**，不是**连线**）。
 * 本函数把"输入读数 → 哪一格"这件事变成**可被机器读的一处**，于是那条连线也能有腿。
 *
 * ## 判定顺序（写死了，不靠读者推）
 *
 * 卡牌指纹 → 观战 → 位满 → 都不是 ⇒ `null`（调用方据此**不臆造**一个格子，
 * 而是把对方那句 `detail` 原样显示 —— 见 `refusalNotice`）。
 *
 * ⚠️ **观战排在位满之前**：G5 把"观战不支持"借 `'unsupported'` 承载，而位满那条也常表现为
 * `player-slots-full`；两者若顺序写反，"不支持观战"会被显示成"位满了"—— 而 `session.ts:657-664`
 * 刻意给了两个**不同**的理由串（`SPECTATOR_UNSUPPORTED_MESSAGE` / `SPECTATOR_UNSUPPORTED_DETAIL`）
 * 就是为了让这两件事分得开。这里按同一口径排序。
 */
export function errorKeyOfRejection(refusal: LobbyRefusal): LobbyErrorKey | null {
  const r = refusal.reason;
  if (CARD_HASH_REASONS.includes(r)) return 'card-data-hash';
  if (SPECTATOR_REASONS.includes(r)) return 'spectator';
  if (BUSY_REASONS.includes(r)) return 'busy';
  return null;
}

/**
 * 握手被回绝时屏上该显示什么：**该格的文案** + 对方那句真因（有就附上）。
 *
 * 两条纪律：
 *  1. 认得出的拒绝 ⇒ 显示**那一格**的文案（`errorCopy` 的唯一出处），**不是**对方的原话
 *     ——否则玩家看到的是内部理由码的措辞，而不是本程序对这件事的说法；
 *  2. 认不出的拒绝 ⇒ **不猜**：把对方那句 `detail` 原样显示（`errorKeyOfRejection` 返回
 *     `null` 就是"我不知道该归哪一格"）。硬塞进某一格会让玩家读到一句**关于别的事**的说明。
 */
export function refusalNotice(refusal: LobbyRefusal): { readonly key: LobbyErrorKey | null; readonly text: string } {
  const key = errorKeyOfRejection(refusal);
  if (key === null) return { key: null, text: refusal.detail };
  const base = errorCopy(key);
  const detail = refusal.detail.trim();
  // 对方的 `detail` 与那一格的文案重复时不重复拼（`spectator` 那条尤其容易两处同义）
  if (detail.length === 0 || base.includes(detail)) return { key, text: base };
  return { key, text: `${base}（对端给的理由：${detail}）` };
}

/**
 * 判据 3 的**能力边界**（写进注释，照计划 §2 第 15 条）：
 *
 * 它钉的是"这五条路径的文案**两两不同、非空、来源可追**"，**不是**"这五条路径在真网络下
 * 都走得通"。逐条说清（**修复轮更新**）：
 *  - `'room-gone'` 有**行为腿**（注入假时钟，走完 8s 窗口）；
 *  - `'proto-version'` 有**行为腿**（喂一条明文版本不一致的载荷，比对 `protocolVersionCheck`）；
 *  - `'card-data-hash'` / `'busy'` / `'spectator'`：修复轮**补上了"读数 → 该格"的连线腿**
 *    （`errorKeyOfRejection` / `refusalNotice`，喂纯层能构造的拒绝理由 ⇒ 断言渲染出的是
 *    **对应那一格**的文案，而不是"五句两两不同"）。真网络下能否触发仍属 T9/人工验收。
 *
 * 这个边界不是"没做到"，是这条判据**声明的范围**：写成"五条都验过了"才是谎报。
 */
export const ERROR_COPY_BOUNDARY =
  '本表钉的是五条文案互不相同、来源可追、且拒绝理由能连到对应那一格；真网络下能否触发属 T9/人工验收。';

/* ==================================================================== *
 * 3. "断线 ≠ 刷新"的文案（判据 8）：读数 → 文案，只有这一张表
 * ==================================================================== */

/**
 * 六种连接状态的**键**（不是文案）。每一格的输入列在 `LOBBY_LINK_COPY` 的注释里。
 */
export type LobbyLink =
  | 'online'
  | 'offline-window-live'
  | 'offline-window-expired'
  | 'offline-window-unknown'
  | 'resync-handshake'
  | 'resync-queue-overflow';

/**
 * 读数 → 连接提示的取值表（判据 8 的**唯一**落点）。
 *
 * 每一格的**输入**（好让"同源"这条判据能逐格核）：
 *  - `'online'` ← `peerStatus().online === true`；
 *  - `'offline-window-live'` ← `online === false && windowExpired === false`；
 *  - `'offline-window-expired'` ← `online === false && windowExpired === true`；
 *  - `'offline-window-unknown'` ← `online === false && windowExpired === null`；
 *  - `'resync-handshake'` ← `needsResync === true && needsResyncCause === 'resuming-handshake'`；
 *  - `'resync-queue-overflow'` ← `needsResync === true && needsResyncCause === 'queue-overflow'`。
 *
 * ## 为什么"断线 ≠ 刷新"不做成字面量
 *
 * 字面写死会让"文案与读数同源"这条判据退化成"屏上出现了这五个字"（T4 的教训：文本腿不是
 * 行为腿的附庸，但也不能只靠文本腿）。这里把它拆成"**刷新不会让对局回来**"这层意思，
 * 落在 `'offline-window-live'` 那一格 —— 那正是"对端不在、但宽限期还没过"这一格的真实后果。
 *
 * ## 两个 `needsResyncCause` 是两件不同的事实（T6 的登记）
 *
 * `'resuming-handshake'` = 对端回来了、正在追平；`'queue-overflow'` = **本端自己**跟不上了。
 * 后者的唯一出路是走一次追平，而**房主侧**入站队列溢出在今天的协议里没有自动出路
 * （只有加入方能发 `resync-req`）⇒ 房主那一格的文案必须把"只能由上层结束这一局"说出来。
 *
 * ## `windowExpired` 是**三值**（T6 的登记）
 *
 * `null` = 本会话没注入时钟、窗口**判不了**。"无法判定"与"还在宽限期内"不是同一句话 ——
 * 把它们合并会让玩家读到一个我们并不知道的结论。
 */
export const LOBBY_LINK_COPY: Readonly<Record<LobbyLink, string>> = {
  online:
    '对端在线，可以开始这一局。',
  'offline-window-live':
    '对端现在不在线（链路断了）。这一局的宽限期还没过：对端若带着同一个会话回来，'
    + '本地会把这一局追平接着打。注意刷新页面不能让对局回来 —— 刷新只是把手里这份会话丢掉。',
  'offline-window-expired':
    '对端离线已经超过了宽限期，这一局不能再接着打了。刷新页面同样不能让对局回来：'
    + '宽限期是从最后一次收到对端消息算起的，而刷新还会把本地这份状态一并丢掉。',
  'offline-window-unknown':
    '对端现在不在线（链路断了）。这一侧判不了宽限期还剩多少（没有可用的时钟读数）——'
    + '这是"无法判定"，不是"还在宽限期内"。刷新页面同样不能让对局回来。',
  'resync-handshake':
    '对端带着同一个会话回来了，正在把这一局追平：等它把缺掉的那几步补齐之后才能继续。',
  'resync-queue-overflow':
    '本地跟不上了（入站队列溢出，落后了一大段操作），需要走一次追平。'
    + '注意：房主这一侧的队列溢出在今天没有自动出路（只有加入方能发追平请求）——'
    + '如果房主就是这一侧，这一局只能由上层结束，不能继续推进回合。',
};

/**
 * 把 T6 的读数折成上面那张表的一个键。**只有这一处**做这个判定。
 *
 * 判定顺序（写死了，不靠读者推）：`needsResync` 优先于 `online`
 * —— "正在追平"比"此刻可达"更具体；两个都在时玩家该看到的是前者。
 */
export function lobbyLinkOf(status: PeerStatus): LobbyLink {
  if (status.needsResync) {
    return status.needsResyncCause === 'queue-overflow' ? 'resync-queue-overflow' : 'resync-handshake';
  }
  if (status.online) return 'online';
  if (status.windowExpired === true) return 'offline-window-expired';
  if (status.windowExpired === false) return 'offline-window-live';
  return 'offline-window-unknown';
}

/**
 * 屏上那条连接提示的完整正文：**映射表的那一句** + `needsResyncDetail`（若有）。
 *
 * `needsResyncDetail` **必须**被渲染出来（判据 8 的硬要求）：丢掉它另写一句就等于把
 * 会话层那句可读真因替换成一句更模糊的话。
 */
export function lobbyLinkText(status: PeerStatus): string {
  const base = LOBBY_LINK_COPY[lobbyLinkOf(status)];
  const detail = status.needsResyncDetail;
  if (!status.needsResync || detail === null || detail.length === 0) return base;
  return `${base}（${detail}）`;
}

/**
 * ★★ **G5 T14：联机对局里"轮到谁"要说人话**（本阶段第 2 件事）。
 *
 * ## 为什么需要它（`src/ui/render.ts:4925-4936` 那条横幅不够）
 *
 * `renderDraft` 的醒目横幅（`draft-turn-banner` / `turn-badge`）写的是**座位号**
 * （`玩家 ${activePlayer + 1}`），而座位号是协议里的 `PlayerId`：联机下玩家在自己那一页
 * 看到的永远是"玩家 1 / 玩家 2"，对不上"我 / 对方"（用户 2026-09-20 的指示）。
 * 而 `render.ts` 是**红线文件**（G5 §2 第 10 条），本轮不许动它 ⇒ 这一行由**应用层**补画（见
 * `appendNetTurnLine()` 的调用点）。
 *
 * ## 取值**同源**（不是另算一套）
 *
 * 轮次归属的两半读的都是**引擎自己那几个读数**：
 *  - 草稿相 → `getCurrentDrafter(s)`（T12 起 `cb.onDraftPick` 与驱动 `liveTurn` 用的同一个）；
 *  - 对局相 → `s.turnPlayer`（`liveTurn` 与 `net-driver` 的座位闸读的同一个）。
 * 而"我是谁"那一半由调用方把**驱动自己的 `seat`**（`netGame.selfSeat`）交进来 ——
 * 与 `__g5Match.seat()` 同一个数。⇒ 端上没有第二套"谁该动"的判定。
 *
 * ## 文案纪律（短、如实、不夸张）
 *
 * 只说这一刻的事实，**不写**"公平 / 防作弊"那一类承诺，也不承诺"网络一定没问题"。
 * 四个格子两两不同，且**不出现座位号**（座位号已经在 render.ts 那条横幅上了，这一行的存在
 * 理由正是把座位号翻成人话）。
 */
export function netTurnText(
  phase: string,
  turnPlayer: 0 | 1,
  selfSeat: 0 | 1,
  draftDrafter: 0 | 1,
  draftRound: number,
): string {
  const mine = phase === 'draft'
    ? draftDrafter === selfSeat
    : turnPlayer === selfSeat;
  if (phase === 'draft') {
    return mine
      ? `轮到你选协议（第 ${draftRound + 1} 步，共 ${DRAFT_STEPS} 步）`
      : `现在轮到对方选协议（第 ${draftRound + 1} 步，共 ${DRAFT_STEPS} 步）—— 等他选`;
  }
  return mine
    ? '轮到你出牌或点「下一步」'
    : '现在轮到对方出牌或点「下一步」—— 等他动';
}

/** 草稿一共几步（屏上那句话里用；`DRAFT_PICK_COUNT = 6` 是引擎的常量，别在这里另写一个数） */
const DRAFT_STEPS = DRAFT_PICK_COUNT;

/**
 * 把"轮到谁"那一行**画到屏上**（唯一产出点；`src/main.ts` 的两个相各调一次）。
 *
 * 为什么渲染住在这里而不是 `main.ts`：这一行是**联机文案**，与 `lobbyLinkText` 同族；
 * 而 `tests/**` import 不了 `src/main.ts`（应用入口要真 `document`）⇒ 住在这里，真渲染器腿
 * 才画得出来（照 `tests/ui/net-link-recovery.test.ts` 的形状）。
 */
export function appendNetTurnLine(
  root: HTMLElement,
  phase: string,
  turnPlayer: 0 | 1,
  selfSeat: 0 | 1,
  draftDrafter: 0 | 1,
  draftRound: number,
): void {
  const line = document.createElement('div');
  line.className = 'net-turn-line';
  line.textContent = netTurnText(phase, turnPlayer, selfSeat, draftDrafter, draftRound);
  root.appendChild(line);
}

/**
 * ★★ **G5 T13-C 判据 5：对局中掉线超过宽限 ⇒ 把玩家带回"建房 / 加入房"那一屏时那一行话。**
 *
 * ## 为什么它必须与 `LOBBY_LINK_COPY` 分开（两句话答的不是同一件事）
 *
 * `lobbyLinkText()` 答"对端现在什么状态"（读数同源的那张表）；这一句答**"你该做什么、
 * 以及这一局还能不能接着打"** —— 它是**动作指引**，只在"链路判死、玩家被带回大厅"那一刻出现。
 * 合成一句会让大厅平时那一行也变成一段操作说明（屏上那三样控件的存在感反而没了）。
 *
 * ## 三值口径与 D8 的裁决写死在这里（判据 1 的同一份三值）
 *
 *  - `windowExpired === true`（超窗）⇒ **不可续**：D8 说超窗只是"不许再追平"，
 *    **不自动结束对局**（`session.ts` 那边一个字都不动）⇒ 文案必须同时说清这两半：
 *    不能再追平、只能重开；而本地这份对局**不会被程序自动结束**。
 *    不许写成"这一局已经结束了"（那是我们没做的事），也不许写成"会自动接回来"（没这回事）。
 *  - `windowExpired === false`（还在宽限期内）⇒ **可续**：请重新贴一次码，接上之后走
 *    `resuming` 追平（机制在 T13-A/B 已接好）。如实说清"要重新交接邀请码"，不承诺后台自动接回。
 *  - `windowExpired === null`（没注入时钟 ⇒ 判不了）⇒ **不许说超窗**，也不许承诺可续：
 *    把两个方向的条件都说出来（5 分钟内回来可以追平；超过之后不允许），让玩家自己判断。
 */
export function linkRecoveryNotice(status: PeerStatus | null): string {
  const expired = status === null ? null : status.windowExpired;
  if (expired === true) {
    return '对端离线已经超过了宽限期：按 D8 的规则这一局不能再追平了，'
      + '但本地这份对局不会被程序自动结束（它只是不再接受追平）。要接着打只能重新开一局：'
      + '请重新生成邀请码 / 重新加入。';
  }
  if (expired === false) {
    return '这一局的宽限期还没过：请重新生成邀请码 / 重新加入。'
      + '对方带着同一个会话接上之后，本地会把这一局追平接着打（追平要把缺掉的那几步补齐）'
      + '—— 这是重新交接一次邀请码，不是后台自己把链路接回来。';
  }
  return '这一侧判不了宽限期还剩多少（没有可用的时钟读数）：'
    + '对端若带着同一个会话回来，可以追平接着打；超过 5 分钟之后再回来就不允许追平、只能重开。'
    + '请重新生成邀请码 / 重新加入。';
}

/* ==================================================================== *
 * 4. 中继（TURN）那一格：第 2 件义务的输入
 * ==================================================================== */

/** TURN 三项的状态。`'partial'` = 填了 URL 但用户名/凭据不全 */
export type RelayState = 'on' | 'partial' | 'off';

/**
 * 三项齐不齐 —— **唯一判定处**是 `src/ui/net-browser.ts:431` 的 `readIceServers()`
 * （它同时给出 `relayConfigured` / `relayIncomplete` 两个读数）。
 *
 * 本函数只把那个读数翻成三值，好让渲染有一个明确的分支。**不**在这里重新判
 * "三个字符串都非空"：那是第二份判定，而"配了一半"这一格正是两份判定最容易漂移的地方。
 */
export function relayStateOf(read: IceServersRead): RelayState {
  if (read.relayConfigured) return 'on';
  if (read.relayIncomplete) return 'partial';
  return 'off';
}

/** 屏上那条与中继有关的状态行（`'off'` 时是 `null`，即"什么都不说"） */
export function relayNoticeOf(read: IceServersRead): string | null {
  const state = relayStateOf(read);
  if (state === 'off') return null;
  if (state === 'partial') {
    return '中继（TURN）只填了一部分，所以这一项没有被用上：URL、用户名、凭据三项必须齐全，'
      + '缺任何一项的中继在真实网络里都会拒绝连接。补齐之后它才会生效。';
  }
  // ★ `'on'`：那句中继说明的**唯一出处**是 `src/app/privacy.ts:111`。
  // D22 写死了两件事：本文件一个字都不许改写它，也**不许**再加第二句 ——
  // 触发"改文案 + 同轮重钉哈希"的条件是**出现新事实**，不是"启用 TURN"这个动作本身。
  return PRIVACY_COPY.signalAndRelay[1];
}

/* ==================================================================== *
 * 5. 大厅状态（宿主可读；渲染的唯一输入）
 * ==================================================================== */

/**
 * ★★ **G5 T15：最近一次 `connect()` 里 `init()` 的结论**（见 `LobbyState.linkInit`）。
 *
 * `reason` / `message` **逐字来自传输层**（`TransportActionResult`），`statusAfter` 是那一刻
 * 传输自己的状态 —— 本层只做搬运，不改写、不翻译。
 */
export interface LobbyLinkInitDiagnostic {
  readonly ok: boolean;
  readonly reason: string;
  readonly message: string;
  readonly statusAfter: TransportStatus;
}

/** 大厅这一屏的**全部**可显示状态 */
export interface LobbyState {
  /** 本端角色（`null` = 还没选"建房/加入"） */
  readonly role: 'host' | 'guest' | null;
  /**
   * ★ **T11-B**：这一刻的握手相位（没有链路时是 `'idle'`）。
   *
   * 它进来的理由：硬币屏（`src/ui/home.ts` 的联机分支）**不画**相位行，而真浏览器门在那块屏上
   * 要读"握手走到哪一格" ⇒ 需要 `data-net-phase` 这个口（见 `renderNetLobby` 里的挂法）。
   */
  readonly phase?: SessionPhase | 'idle';
  /** 本局的 `sessionId`（只住会话层，不进档案，D2） */
  readonly sessionId: string;
  /** 房主生成的邀请码（`null` = 还没生成） */
  readonly invite: MakeInviteResult | null;
  /** 加入方读到的邀请码的结论（`null` = 还没读） */
  readonly joined: InviteDecodeResult | null;
  /** 玩家在短码输入框里敲的东西（**原样**保存；归一化归 `normalizeRoomCode`） */
  readonly roomCodeInput: string;
  /** "输 6 位码"这条路此刻的结论（`null` = 还没提交过） */
  readonly roomCodeGate: string | null;
  /** 传输此刻的状态（`NetTransport.status()` 的镜像；**不代表对端在线**，D18） */
  readonly transport: TransportStatus;
  /** T6 的对端读数（`null` = 还没建会话） */
  readonly peer: PeerStatus | null;
  /** 设置里的信令端点（空串 = 没配） */
  readonly endpoint: string;
  /** `readIceServers()` 的读数（第 2 件义务的输入） */
  readonly ice: IceServersRead;
  /** 高级区是否展开（**默认折叠**：初值 `false`） */
  readonly advancedOpen: boolean;
  /**
   * ★★ **G5 T15：「中继（TURN）」那一小块展开了没有**（**默认收起**：初值 `false`）。
   *
   * 与 `advancedOpen` 是**两层**折叠，不是一条：
   *  - `advancedOpen`：整个「高级 / 连接设置」区（默认不渲染，T8 既有）；
   *  - `relayOpen`：区里的 TURN 三项（默认不渲染 —— 普通玩家不该看见三个空输入框）。
   *
   * 缺省/未给 = `false`（收起）。三项的"要么都不填、要么三项齐全"校验**一个字没放宽**：
   * 它仍然只由 `readIceServers()` 判（`relayNoticeOf` 转发），与展开状态无关。
   */
  readonly relayOpen?: boolean;
  /**
   * ★★ **G5 T15：最近一次 `connect()` 里 `init()` 的结论**（诊断读数；`null` = 还没建过链路）。
   *
   * ## 为什么必须有它（用户实测那一句"本侧链路还没建立"为什么诊断不了）
   *
   * `connect()` 在 `init()` 失败时把失败原因写进 `s.notice` —— 那条路只对**这一次**调用有效：
   * 玩家再点一次「生成邀请码」就会**换一条新链路**（`connect()` 每次都新建），旧的那句被
   * 新的（可能是成功的）调用覆盖 ⇒ 之前那一次为什么失败，屏上再也读不回来。
   *
   * 这一位把"每一次 `init()` 的结论"留下来（`reason` + `message` + 那一刻的传输状态），
   * 于是"链路没建起来"这一类失败**从此可诊断**：屏上那句话里能带上真因。
   *
   * ⚠️ 它**参与"链路就绪了没有"那一问**（宿主 `waitLobbyLinkReady` 的第一条判据就是
   * "本次 `init()` 有没有结论"），也**参与屏上那句失败文案**（真因）。除此之外没有任何判定
   * 按它分支；`message` 逐字来自传输层，本层不改写。
   */
  readonly linkInit?: LobbyLinkInitDiagnostic | null;
  /** 八秒窗口是否已经走完（`null` = 还没开始等） */
  readonly waitExpired: boolean | null;
  /** 此刻该显示哪条**错误路径**的文案（`null` = 没有错误） */
  readonly error: LobbyErrorKey | null;
  /** 屏上那条可读提示（短码提示 / 会话层拒绝原因；`null` = 没有） */
  readonly notice: string | null;
  /** 路由记账：真正经过"入站 → `accept`"这条路的帧数（反空转用） */
  readonly routedIn: number;
  /** 路由记账：会话层产出并已发出的帧数 */
  readonly routedOut: number;
  /**
   * ★ 本端是否已经发过第一条 `hello`（`connect()` 里由加入方发）。
   *
   * 它是屏上的**读数**（也是判据 14 的类型面）：`false` 而链路已经起来了，
   * 就意味着"握手在产出路径上还没开始"—— 那正是评审 1.1 第 4 点的形态。
   */
  readonly helloSent: boolean;
  /** ★ 诊断读数（T8-E，**可选**）：第一条 `hello` 走到哪一步；屏上挂在 `data-hello-diag` */
  readonly helloDiag?: string;
  /**
   * ★ **收方产出的那条回示码**（B3；`null` = 还没产）。
   *
   * 它只对**加入方**有意义：加入方把房主的 offer 吃进来之后，产一条 answer 回示，
   * **由房主粘回来**（今天没有回程通道，这是"邀请码那条路"的既定形态）。
   */
  readonly answerCode: string | null;
  /** 房主**粘回来**的那条回示码的处理结论（`null` = 还没粘） */
  readonly answerApplied: { readonly ok: boolean; readonly message: string } | null;
}

/* ==================================================================== *
 * 5b. ★★ G5/T17：粘贴框里那一串的**形态**（唯一一处）
 * ==================================================================== */

/**
 * fragment 的前缀（`#invite=`）。**不写字面量**：键名只有 `INVITE_FRAGMENT_KEY` 一处。
 *
 * ⚠️ 那个字面量在**本文件的代码位里**也不许出现 —— `tests/ui/net-lobby.test.ts` 有一条腿
 * （判据 6 的"第二处链接组装"）钉着这一点。所以这里**拼**出来，而不是抄一遍。
 */
const FRAGMENT_PREFIX = `#${INVITE_FRAGMENT_KEY}=`;

/**
 * 粘贴框旁边那句短提示（T17 第 4 件）：说清**三种形态都能粘**。
 *
 * 它存在的理由就是用户真机实测的那个事故：房主屏上写的是"把这条**邀请链接**发给对方"，
 * 玩家照做、把整条链接粘进加入方的框里，而那条路当时只吃裸载荷。
 */
export const PASTE_SHAPE_HINT =
  `整条链接、链接里 ${FRAGMENT_PREFIX} 后面那一串、或者只粘邀请码本身，三种都可以。`;

/**
 * 粘进来的**是一条链接，但链接里没有 `#invite=…` 那一段**时给邀请码那一侧的文案。
 *
 * 为什么必须与"开头不是整数"分开：那句话是对着**载荷**说的（"这不是本程序产出的邀请码"），
 * 而玩家手上这条链接**是本程序产出的**，只是他少复制了后半截（或者粘成了别的地址）。
 * 拿前一句回答后一种输入，玩家会以为程序坏了。
 */
const LINK_WITHOUT_FRAGMENT_INVITE_MESSAGE =
  `你粘的是一条链接，但链接里没有 ${FRAGMENT_PREFIX} 后面那一段；`
  + '请确认你复制的是整条链接（井号后面那一截也要一起复制），或者只粘邀请码本身。';

/** 回示码那一侧的同一件事（形状相同、被粘的东西不同 ⇒ 文案里的名字不同） */
const LINK_WITHOUT_FRAGMENT_ANSWER_MESSAGE =
  `你粘的是一条链接，但链接里没有 ${FRAGMENT_PREFIX} 后面那一段；`
  + '请确认你复制的是整条链接（井号后面那一截也要一起复制），或者只粘对方给你的回示码本身。';

/** 粘贴框里那一串的两种形态（`payload` 那一种是**改动前就有的**那条路） */
type PastedShape =
  | { readonly kind: 'payload'; readonly payload: string }
  | { readonly kind: 'link-without-fragment' };

/**
 * "这一串看起来是一条链接吗"—— 只用来挑那句失败文案，不用来接受/拒绝任何东西。
 *
 * 判据就是 T17 给的那两条：含 `http://` / `https://`，或含 `#`。
 * ⚠️ 刻意**不**把裸 `?invite=…` 算进"链接"：它也读不出载荷，但它的失败仍走纯载荷那几类
 * 文案（判据 6 ④ 只要求"拒"，没要求换文案；而它**必须继续被拒**，见 `pasteShapeOf` 的注释）。
 */
function looksLikeLink(text: string): boolean {
  const t = text.toLowerCase();
  return t.includes('http://') || t.includes('https://') || t.includes('#');
}

/**
 * 粘贴框里那一串的形态判定（**唯一一处**：邀请码与回示码两个入口共用它）。
 *
 * ## 三种能用的形态都从这里走
 *
 *  1. **整条链接** `http://x/#invite=<载荷>` ⇒ 取出 `<载荷>`（用户真机实测的那一次）；
 *  2. **只要片段** `#invite=<载荷>` ⇒ 同上；
 *  3. **纯载荷** ⇒ 原样交给 `decodeInviteText`（与改动前**逐字相同**的那条路）。
 *
 * ## 取不到 fragment 时为什么还要分两种
 *
 *  - 看起来像链接 ⇒ `'link-without-fragment'`：调用方给**分形态**的文案（"链接里没有那一段"）；
 *  - 其余 ⇒ 仍当纯载荷 ⇒ 失败由纯层的既有几类给出（池外 / 截断 / 版本不符），文案一个字没动。
 *
 * ## 判据 6 ④ 在这里的位置
 *
 * 本函数**只认 fragment**（`inviteFragmentOf` 就是这么写的：`?invite=` 与路径段一律返回 `null`）
 * ⇒ `?invite=<载荷>` 落进上面第二种情形：**它仍然被拒**。
 * 顺手"认一下查询串"会让载荷出现在服务器看得见的地方，那正是那条判据不许的。
 */
function pasteShapeOf(text: string): PastedShape {
  const payload = inviteFragmentOf(text);
  if (payload !== null) return { kind: 'payload', payload };
  if (looksLikeLink(text)) return { kind: 'link-without-fragment' };
  return { kind: 'payload', payload: text };
}

/* ==================================================================== *
 * 6. 大厅客户端：状态 + 接线（第 5 件义务 = D24 的裁决）
 * ==================================================================== */

/**
 * 一条**入站帧 → 会话层 `accept`** 的路由。
 *
 * ## 为什么它必须是这个形状（D24 的原话）
 *
 * D19 要求"**T5/T8 必须把入站 `hello-ack` 喂给 `accept`**，否则加入方的 `handshakeDone`
 * 永远不前进"。⇒ "接线"的语义就是把 session 与 transport 接起来、**把入站消息路由进 `accept`**。
 * 不做这一步，加入方握手永远走不到头 —— 那不是一个"缺口登记"能交代过去的。
 *
 * 路由的每一步都是**可数的**（`routedIn` / `routedOut`），所以"握手完成了"不可能是两端各自
 * 本地造出来的结论：判据 14 的反空转腿断言 `routedIn > 0`。
 *
 * ## 为什么 `accept` 只出现在这一处
 *
 * 入站路由**故意只有一处** `session.accept(...)`（本函数体内）。于是变异 M8
 * （"把这一行走廊拆掉"）的锚点恰好命中一次，而判据 14 必然红。
 *
 * ## 能力边界
 *
 * 它证明的是"**这条路由存在且被走通**"，**不是**"真 WebRTC / 真信令下能走通"（后者属 T9 的
 * CDP 线）。判据 14 用的传输是**假件**（`src/net/fake-transport.ts` 的 `createFakeTransportPair`）。
 */
export interface LobbySessionLink {
  readonly session: NetSession;
  /** 本端链路（只读；宿主据 localDescription() 取非 trickle 的描述，见 B2） */
  readonly transport: NetTransport;
  /** 把一条入站文本喂进这条路（生产由 `transport.onMessage` 驱动） */
  receive(text: string): boolean;
  /** 真正经过路由进了 `accept` 的入站条数（反空转的记账口） */
  routedIn(): number;
  /** 路由代会话层发出去的条数（含握手应答） */
  routedOut(): number;
  /** 本侧链路此刻的状态（**不代表对端在线**，D18） */
  transportStatus(): TransportStatus;
  /**
   * 订阅链路状态**变化**（转发 `NetTransport.onStatus`）。
   *
   * 会话层不自己订阅（那是调用方的活，见 `session.ts:768-776`）⇒ 本路由转一手：
   * 每次变化都 `noteTransportStatus(to)`，并顺手更新 `peerStatus().online`。
   */
  onStatus(cb: (to: TransportStatus) => void): () => void;
/** 退订传输 */
  detach(): void;
  /**
   * ★ **发出第一条 `hello`**（加入方唯一的那一次）。
   *
   * ## 为什么必须由本层发（`session.ts:2438-2440` 逐字说了这件事）
   *
   * 会话层**不生成也不发送** `hello`："`hello` 里还有 `nick`，而且要经过传输层。它只把
   * `sessionId` 记进会话，调用方据此自己拼 `hello` 并在收到 `hello-ack` 之后以 `hello-ack.seat`
   * 为准"（D7：座位是主机的决定）。⇒ **加入方的握手在产出路径上永远不会开始**，除非调用方
   * 真的拼并发出这一条 —— 这正是评审 1.1 第 4 点指的那个断点。
   *
   * 它是**幂等**的（发过就返回 `false`），因为重连与新链路都会走到它。
   *
   * ★ **J-2：返回值是"这一条此刻真的出去了吗"** —— 传输还没 `online`（加入方那条 `hello`
   * 交下来的时候通道还没 open）时它返回 `false` 并**把这一条攒住**，状态转 `online` 那一刻
   * 由状态订阅补发。所以调用方**不许**把 `false` 读成"这条路不可用"。
   */
  sendHello(): boolean;
  /** 本端那条 `hello` 是否**真的发到了线上**（`sendHello()` 的记账口；攒着还没发时为 `false`） */
  helloSent(): boolean;
  /**
   * ★ **诊断读数（T8-E，可选）**：第一条 `hello` 走到哪一步的一串短句。
   *
   * 只给排查用（屏上挂在 `data-hello-diag`）：加入方"传输 online、通道 open、而 `send()` 一次
   * 都没被调用"这种缺口在屏上是**看不出任何东西**的 —— 有了这串读数，一次 CDP 就能读到
   * "交下没有 / 等什么状态 / 失败的原因 / 有没有挂通道 open"。
   */
  helloDiag?(): string;
  /**
   * ★★ **按当前相位发"这一格该本端发的那条"**（C 轮；结构缺口 ②）。
   *
   * 相位→动作的对照**照抄** session.ts:282-283 那两张表（本函数是那张表的**唯一**消费者）：
   *
   * | 相位 | 谁 | 发什么 |
   * |---|---|---|
   * | `'awaiting-commit-face'` | 房主 | `sendCommit(matchSeed, randomToken())`（**相位不变** ⇒ 靠"发过就返回 false"防重） |
   * | `'awaiting-commit-ack'` | 加入方 | `sendCommitAck()` |
   * | `'seed-committed'` | 加入方 | `commitFace(face, faceNonce())` |
   * | `'face-committed'` | 房主 | `sendRevealSeed()` |
   * | `'seed-revealed'` | 加入方 | `sendRevealFace()` |
   * | `'complete'` | 房主 | `sendRevealSalt()`（这一步**不改相位** ⇒ 同样靠"发过就返回 false"防重） |
   *
   * ★ T11-A：`matchSeed` / `salt` / `nonce` 都来自**注入**（`LobbyClientOptions.matchSeed` 与
   * `randomToken()`），**不是** `sessionId` 的派生串 —— 后者明文写在邀请码里（I-5）。
   * 盐由会话层存下并在揭示那一步原样交回（本层不缓存）；面 nonce 本层按链路记一次，
   * 为的是重连回退后的重发保持幂等（见 `faceNonce()` 那段）。
   *
   * ## 为什么它不存任何"到哪一步了"
   *
   * 唯一的输入是 `session.phase()`；唯一的输出是"发了 / 没发"。**没有计数器、没有清单**。
   * 两格"发了相位也不动"（`sendCommit` 与 `sendRevealSalt`）之所以不会无限重发，
   * 是因为本对象自己有两个**一次性**记账位（`commitSent` / `saltSent`）——
   * 它们是"**本对象**已经发过这一条"的事实，不是"流程到哪一步"的状态（后者归相位机）。
   */
  driveOnce(): boolean;
  /**
   * ★★ **G5 T13-A：这条链路上"按相位重发"**真的发出去了**几次**（只读计数）。
   *
   * ## 口径（修复轮 2026-09-20 改准，评审第 3 条）
   *
   * 它数的是 **`send()` 报成功**的条数 —— 不是"尝试次数"：`send()` 返回失败（通道没 open /
   * 对端不可达 / 队列满）时**不计数**，而是把 `SendResult.message` 记进 `driveRefusal`
   * （屏上/门里读到的因此是"真的重发成功了几条"，与判据 2 要问的那件事一致）。
   * 想区分"试过但失败"就读 `driveRefusal()`（那里有可读原因）与 `helloDiag()`（那里有 `redrive失败` 的痕迹）。
   */
  redrivenCount(): number;
  /**
   * ★★ **G5 T13-B：去要一份档案**（`resync-req` 的**唯一**构造点）。
   *
   * 会话层只有 acceptor（`acceptResyncReq` 在房主侧），**没有**产出 `resync-req` 的口
   * （`src/net/session.ts` 全文件核对过）⇒ 这一条由接线层按 `protocol.ts:171-177` 的形状拼。
   *
   * 两个触发点（两条 cause 各走各的）：
   *  - 重连握手（`resume` 链路收到 `hello-ack`）⇒ 本层内部自动调；
   *  - 入站队列溢出（`queue-overflow`，发生在**任何**相位）⇒ 宿主调（`client.requestResync()`）。
   *
   * 幂等：同一条链路上只发一次（`resyncReqSent`）—— 重复发只会让房主重复打包同一份档案。
   */
  requestResync(): boolean;
  /**
   * ★★ **G5 T13-B：用房主给的档案追平**（`session.applyResyncFile(` 的**唯一**调用点）。
   *
   * 调用链写死：宿主（`onResyncRes`）先按 `stateAtStep` 把状态重建出来、`realign()` 对齐驱动，
   * 再回到这里把"我应用了几步"交给会话层核对（会话层比 `statesAtStep === file.actions.length`，
   * 只此一处）并把相位/`needsResync` 放回去。
   *
   * 返回 `false` = 会话层拒了（步数对不上 / 相位不对），可读原因在 `driveRefusal()` 里。
   */
  applyResync(file: MatchFile, statesAtStep: number): boolean;
  /**
   * ★★ **重连链路上不许再弹硬币屏**（用户裁决，2026-09-20：重连**不重掷硬币**）。
   *
   * 硬币在断线前就定过了：重建/恢复后的那条链路用的是**旧链路记下的那一面**
   * （没有记忆时取面 0，与"没有注入 `chooseFace`"那条常量面同值 + 一条新 nonce）。
   * 屏那边据本读数**不画**硬币屏（`lobbyCoinViewOf` 的第一句）。
   */
  suppressesCoinScreen(): boolean;
  /**
   * ★★ **T11-B：硬币屏要的三个读数**（屏按它们决定画什么，屏自己不记状态）。
   *
   * 为什么是**读数**而不是"屏直接读 `session`"：`LobbySessionLink` 已经把 `session` 暴露出来了，
   * 但"哪些读数构成一帧硬币屏"这件事必须只有一个出处 —— 否则 `main.ts` 会自己拼一套
   * （`role` 从哪来、落点什么时候算得出），而拼错的那一套在屏上看起来完全正常。
   */
  /** 本端角色（房主 = 等对方叫面；加入方 = 叫面的一方，D3） */
  readonly role: 'host' | 'guest';
  /**
   * 加入方**叫出去的那一面**（屏上口径 `1 | 2`；`null` = 还没叫）。
   *
   * 叫面者只有加入方（D3），所以房主侧恒为 `null`。
   */
  chosenSide(): CoinSide | null;
  /**
   * ★★ **对端叫出去的那一面**（房主侧；`null` = 还没揭示，或本端就是叫面者）。
   *
   * 判"叫中 / 叫错"时**房主那一侧**该读的就是它：加入方在 `reveal-face` 里揭示的面就是
   * 它叫出去的那一面（`session.face()` 在校验通过之后才有值）。
   *
   * ⚠️ 它**不是**落点（`landedSide()`）。两者在"叫中"时同值、在"叫错"时**必然相反** ——
   * 真浏览器门实测（2026-09-19）：房主曾经拿落点当"对端叫的面"去算（`main.ts` 读的是
   * `landedSide()`），于是它永远算"叫中了"：加入方没错时两端恰好同值、叫错时两端定格出
   * 相反的先选者（`__coinTrace` 实测：房主 chosen=2 / 加入方 chosen=1、两端 landed 都是 2）。
   */
  peerChosenSide(): CoinSide | null;
  /**
   * ★★ **本端能算出的"落点"**（屏上口径 `1 | 2`；`null` = 还没到手）。
   *
   * ★ 两端用的是**同一条规则**：`coinLanding(种子)`（`src/app/coin.ts`，只此一处）。
   * 种子的到手时刻两侧不同（房主 `sendCommit` 之后就有；加入方要等 `reveal-seed`），
   * 所以两端的 `null → 有值` 会有先后 —— 但**值必然相同**（同一份种子、同一条式子）。
   *
   * ⚠️ 房主那份读数**不许早于**"加入方的面已经揭示"给屏用：种子在房主手里本来就有，
   * 而房主先看到落点没有任何信息优势 —— 问题在于它会让等待方的屏上一个回合更早定格
   * （实测踩过：房主显示"掷出 正面"而加入方显示"掷出 反面"，两端读数不同）。
   * 屏那一侧的闸在 `verdictReady()`（见它）。
   */
  landedSide(): CoinSide | null;
  /**
   * ★★ **等待方（房主）此刻能不能拿这个落点算胜负**。
   *
   * 房主的胜负依据是"加入方叫的那一面 vs 落点"，而那个面只能从 `reveal-face` 得到
   * （`session.face()` 在校验通过之后才有值）—— 在那之前它算不出"叫中 / 叫错"。
   * 加入方自己就是叫面者（不需要这个口），恒 `true`。
   */
  verdictReady(): boolean;
  /**
   * ★★ **本端手里的"胜负依据"齐了没有**（落点 + 叫出去的那一面都在）。
   *
   * 为什么必须与 `landedSide()` 分开：房主比加入方**更早**算得出落点（种子在它手里），
   * 而"叫中还是叫错"要看加入方的面。只看落点就在屏上定格，会定格出一个**胜负装错**的读数
   * —— 真浏览器门实测（2026-09-19）：房主"玩家 2 先选协议"、加入方"玩家 1 先选协议"。
   * 加入方那一侧还多一个条件：它自己叫出去的那一面也得在（`chosenSide() !== null`），
   * 否则会在"面还没写进 `chosenFace`、而 Promise 的反应已经跑过"那个窗口里定格一次错读数。
   */
  winnerReady(): boolean;
  /**
   * 本端这条链路上**有没有"要面"的能力**（`LobbyClientOptions.chooseFace` 注入了没有）。
   *
   * 屏据它决定"要不要画硬币屏"：没有这个能力时那块屏根本不该出现（任务书 §5 的接口要求，
   * 一条测试腿钉住这件事）。
   */
  hasFaceChooser(): boolean;
  /**
   * ★★ T11-B：**叫面者的座位**（= 加入方的座位；D3 说选面者永远是加入方）。
   *
   * ⚠️ **两端都要能读出同一个数**（判据 3 的"两端 `draftStarter` 相等"就靠它）：
   *  - 加入方读**自己**的座位（`selfSeat`，由 `hello-ack.seat` 定下，D7）；
   *  - 房主读**对端**的座位（`peerSeat`，由加入方的 `hello` 带过来）。
   *
   * 两端各读"本端座位"是不行的：那给出的是**两个不同的数**（房主 0 / 加入方 1），
   * 而 `draftStarterFor` 的 `caller` 要的是**叫面者那一个座位** —— 真浏览器门实测
   * （2026-09-19）房主算出"玩家 1 先选"、加入方算出"玩家 2 先选"，就是这一格写错的形状。
   */
  callerSeat(): PlayerId;
  /**
   * ★★ **T11-C：本端自己的座位**（`hello-ack.seat` 定下的那一个，D7）。
   *
   * 为什么它与 `callerSeat()` 是**两个**口而不是一个：它们回答的是两个不同的问题 ——
   *   · `callerSeat()` = "叫面的是谁"（两端都必须是同一个数，`draftStarterFor` 的入参）；
   *   · `selfSeat()`   = "**我**坐在哪"（两端**必须不同**，`createNetDriver` 的 `seat` 入参）。
   *
   * 合成一个口就是 T11-B 踩过的那类错：房主读自己的座位（0）= 错把等待方当成叫面者。
   */
  selfSeat(): PlayerId;
  /**
   * ★★ **本端此刻持有的种子**（`null` = 还没到手）。
   *
   * 语义照会话层那个口（`session.ts:717-742`）：**本方此刻持有**，不是"对端已经看到"——
   * 房主在 `sendCommit` 之后就有，加入方要等 `reveal-seed`。宿主用它算先选协议者
   * （`draftStarterFor(caller, chosen, seed)`）；"时机对不对"那一半由 `winnerReady()` 挡。
   */
  seedOfSession(): string | null;
}

/**
 * 造一条路由并把 `transport.onMessage` 接上它 —— **这就是"接线"那一句**（D24）。
 *
 * ## ★ 重连必须**新建**会话对象（计划 §5 T8 的硬约束）
 *
 * D23 把"重新驱动卡在半路的握手/收官消息"的**收方幂等只覆盖 2/5 格** —— 也就是"同一个
 * `sessionId` 的重复握手"那几条路。另外 3 格（例如"中途断线、已立承诺的加入方带着同一个
 * `sessionId` 回来"）**不在那份幂等的覆盖里**：承诺进度不住在档案里，复用旧的
 * `HostSession` / `GuestSession` 实例就会让那 3 格落在一个**没有被幂等保护**的相位上，
 * 结果是 fail-closed 的 `face-hash-mismatch`（T6 的登记缺口 ③），而不是一次干净的重连。
 *
 * ⇒ 重连的写法是"**丢掉旧对象、调到本函数新建一个、在喂任何入站消息之前先声明重连**"。
 * 本函数**每次都新建**，宿主没有第二个写法：`LobbyClient.reconnect()` 只做后两步。
 */
export function createLobbySessionLink(opts: {
  readonly role: 'host' | 'guest';
  readonly transport: NetTransport;
  readonly sessionId: string;
  readonly hash: HashLike;
  /** ★ T11-A：本局种子（房主的 `commit` 用它；**不再**由 `sessionId` 派生） */
  readonly matchSeed: string;
  /** ★ T11-A：要一条真随机串的动作（salt / nonce） */
  readonly randomToken: () => string;
  /**
   * ★★ T11-B：要面（加入方的 `commit-face` 用它）。见 `LobbyClientOptions.chooseFace`。
   *
   * 未注入 ⇒ 保持今天的行为（常量面 0）并由 `driveOnce` 直接往下走。
   */
  readonly chooseFace?: () => Promise<CoinSide>;
  /** ★ 本链路是**重连**（`connect('resume')`）⇒ `hello` 带 `resuming: true`、不弹硬币屏 */
  readonly resume?: boolean;
  /** 本端驱动已经应用了几步（`resync-req.appliedSteps` 的来源；缺省 0） */
  readonly appliedSteps?: () => number;
  /** 房主侧：当前权威档案（D8 的重连凭据）；返回 `null` = 现在没有可发的档案 */
  readonly resyncSource?: () => MatchFile | null;
  /** 加入方侧：收下档案 ⇒ 宿主重建状态并回"应用了几步"；`null` = 拒绝/失败 */
  readonly onResyncRes?: (file: MatchFile) => number | null;
  /**
   * ★ 旧链路记下的那一面（重连**不重掷硬币**：复用旧链路记下的面；没有就取面 0）。
   * 读写方向分开：`readFaceMemory` 由新链路读、`onFaceChosen` 由旧链路写。
   */
  readonly readFaceMemory?: () => 0 | 1 | null;
  readonly onFaceChosen?: (face: 0 | 1) => void;
  readonly seat?: 0 | 1;
  /** ★ G5 T13-C：300s 窗口的时钟能力（照传 `LobbyClientOptions.clock`；不注入 = 判不了窗口） */
  readonly clock?: ClockLike;
  readonly localProtoVersion: number;
  readonly localCardDataHash: string;
  /** 本机昵称（`hello.nick` 的唯一来源；`session.ts:2438` 说"`hello` 里还有 `nick`"） */
  readonly localNick?: () => string;
  /**
   * 每个入站帧被处理过之后调一次（**含解不开的坏帧**）。
   *
   * 为什么含坏帧："收到过一帧"本身就是屏上该反映的事实（屏上停在上一帧的读数上会更糟）。
   */
  readonly onInbound?: () => void;
}): LobbySessionLink {
  /**
   * ★ **本链路是不是一次重连**（`connect('resume')`）。三处行为由它决定，逐条在下面点名：
   *  1. `hello` 带 `resuming: true`（`helloMsg()`）—— D8 那条"带着同一个 sessionId 回来"的形态；
   *  2. 收到 `hello-ack` 之后**去要档案**（`receive()` 里 `requestResync()`）；
   *  3. **不弹硬币屏**、复用旧链路记下的面（`driveOnce()` 的 `awaiting-commit-ack` 那一格）。
   */
  const resumeMode = opts.resume === true;
  /**
   * ★★ **G5 T13-C：窗口的时钟注入照传两条会话**（D8 补充裁决：`src/net` 只问时间、不取时间）。
   * 不注入时 `clock` 是 `undefined` ⇒ 会话层 `windowExpired` 恒 `null`（**判不了**），
   * 屏上走 `'offline-window-unknown'` 那一格；注入了才有 `false` / `true` 两种真读数。
   */
  const clockOpt = opts.clock === undefined ? {} : { clock: opts.clock };
  const session: NetSession = opts.role === 'host'
    ? createHostSession({
      localProtoVersion: opts.localProtoVersion,
      localCardDataHash: opts.localCardDataHash,
      sessionId: opts.sessionId,
      seat: opts.seat ?? 0,
      hash: opts.hash,
      ...clockOpt,
      // ★ D8 的重连凭据：房主侧把"当前档案"的来源注进去（没有它 ⇒ `resync-not-wired`，fail-closed）
      ...(opts.resyncSource === undefined ? {} : { resyncSource: opts.resyncSource }),
    })
    : createGuestSession({
      localProtoVersion: opts.localProtoVersion,
      localCardDataHash: opts.localCardDataHash,
      sessionId: opts.sessionId,
      seat: opts.seat ?? 1,
      hash: opts.hash,
      ...clockOpt,
    });

  let inCount = 0;
  let outCount = 0;
  /** 最近一次"驱动被会话层拒掉"的可读原因（`null` = 没被拒过） */
  let driveRefusal: string | null = null;
  let helloDone = false;
  /**
   * ★ G5 T13-A：**按相位把卡在半路的那条消息重发出去、并且真的发出去了**的次数
 * （`send()` 报成功才 +1；只读读数，进 `redrivenCount()`）。
   *
   * 为什么要有这个计数：`session.redrive()` 在没有在途消息时**合法地**返回 `null`（空操作），
   * 所以"链路恢复过"与"那条消息真的被重发过"是两件事 —— 判据 2 的计数腿要能分开看见它们。
   */
  let redriven = 0;
  /** ★ G5 T13-B：这条链路上**已经发过** `resync-req`（同一条链路只发一次） */
  let resyncReqSent = false;
  /** ★ 本链路曾经转过 `offline`（"恢复"的判定：`offline -> online` 才算恢复，冷启动不算） */
  let wasOffline = false;
  /**
   * 承诺流程里两条"**发了相位也不动**"的消息各自的记账位（见 `driveOnce` 的说明）。
   *
   * ⚠️ 它们**不是**"流程到哪一步了"（那归相位机）—— 它们是"**本对象**已经发过这一条"的事实。
   * 没有它们，`sendCommit` 与 `sendRevealSalt` 会被`driveOnce`无限重发（那两条不改相位）。
   *
   * ⚠️ 范围：房主那两条（`commit` / `reveal-salt`）**与**加入方的一条（`commit-face`，G5 T13-A
   * 补的第二条 —— §9 第 9 条那条相位回退路径会让 `awaiting-commit-ack` 出现第二次，
   * 见 `driveOnce` 那一格的注释）。三者的语义一样：**本对象已经发过这一条**。
   */
  let commitSent = false;
  let saltSent = false;
  /** ★ G5 T13-A：本链路已经发过 `commit-face`（§9 第 9 条的一次性位；与 `commitSent` 同级） */
  let faceSent = false;
  /**
   * 加入方选的面（`seed-committed` 那一格要用）。
   *
   * ★ **T11-B**：它的**唯一**赋值点就是"注入的能力 resolve 出来的那一面"，
   * 并且必须经过 `faceFromSide`（屏上是 `1 | 2`、会话层是 `0 | 1`）。
   * 没有注入 `chooseFace` 时它保持初值 `0` —— 也就是 T11-B 之前那套常量面的行为。
   *
   * ⚠️ `null` 是"**还没叫**"，不是"叫了正面"：`0 | 1` 里没有能表达"还没叫"的值，
   * 而这两件事的后果完全不同（后者会当场发出 `commit-face`，前者要停在硬币屏上等玩家点）。
   */
  let chosenFace: 0 | 1 | null = null;
  /**
   * 是否已经**向注入的能力要过面**（每条链路一次）。
   *
   * 它防的是重复调 `chooseFace()`：`driveOnce` 会被反复调用（每次入站、每次 `drive()`），
   * 而在面到手之前相位**不动**（这正是判据 1 要的"停在等面那一格"）⇒ 没有这个位，
   * 同一个 `awaiting-commit-ack` 会被问很多次，屏上就会反复重开硬币屏。
   */
  let faceAsked = false;
  /**
   * ★★ **向注入的能力要一次面**（T11-B；唯一的调用点是 `driveOnce` 的 `awaiting-commit-ack`）。
   *
   * 三条纪律：
   *  1. **每条链路只问一次**（`faceAsked`）—— 这一格会被反复驱动，重复问会让屏上反复重开硬币屏；
   *  2. **结果一 resolve 就写进 `chosenFace`，并且必须经过 `faceFromSide`**（屏上 `1 | 2` ⇒
   *     会话层 `0 | 1`；`chosenFace` 的赋值点数由 `tests/ui/coin-seed-injection.test.ts` 钉住）；
   *  3. **不在这里驱动**：resolve 只写值，推进由调用方（屏上的点击 ⇒ `client.drive()`，
   *     或下一次入站）进行 —— 本层不做隐式重入，免得"发一条"变成"发一串"。
   */
  function askFaceOnce(): void {
    if (faceAsked) return;
    const ask = opts.chooseFace;
    if (ask === undefined) return;
    faceAsked = true;
    ask().then(
      (side) => {
        // 唯一的赋值点：屏上的面 → 会话层的面（映射只此一处，`src/app/coin.ts`）
        chosenFace = faceFromSide(side);
        // ★ G5 T13-A：把这一面记到**客户端**那一层（旧链路会被丢掉，而重连不许重掷硬币）
        opts.onFaceChosen?.(chosenFace);
      },
      (e: unknown) => {
        // 面这条路断了（屏抛了 / 玩家没得选）：把真因留在读数里，绝不静默
        driveRefusal = `要面失败：${e instanceof Error ? e.message : String(e)}`;
      },
    );
  }
  /**
   * ★★ **面 nonce 每条链路只取一次**（T11-A 修复轮恢复；盐仍然不缓存）。
   *
   * ## 为什么盐不需要、nonce 需要（这两者的机制不一样，别照抄）
   *
   *  - **盐**：`sendCommit(seed, salt)` 把盐写进会话状态 `s.salt`（`session.ts:1724`），
   *    `sendRevealSalt()` 揭示的就是 `s.salt`（`session.ts:1869`）⇒ 承诺与揭示用的是
   *    会话里那一个值，本层每次现取也不会错位。
   *  - **面 nonce**：为什么这里必须记一次 —— 它防的不是"承诺与揭示错位"（那个同样由
   *    `s.faceNonce` 兜住），而是**重发**：相位机在重连回退路径上**不单调**
   *    （`applyResyncFile`，`session.ts:2263-2269`：`phaseBeforeResyncApply ∈ {null,'resuming',
   *    'handshaking'}` 时把相位写回 `seed-committed`；而 `acceptCommit` 也认 `resuming` /
   *    `resync-pending`，`session.ts:1906-1916`）⇒ 加入方**可以再走一遍**到
   *    `awaiting-commit-ack`，`driveOnce` 于是再发一条 `commit-face`。
   *    重发时若现取一条新 nonce，新承诺的哈希与房主记下的 `faceHash` 不同，
   *    而 `acceptCommitFace`（`session.ts:1738`）对重复一律 `unexpected-message` ⇒
   *    房主最后验 `reveal-face` 失配。旧代码那条 `sessionId` 常量 nonce 恰好让重发**幂等**，
   *    所以这条记忆位是"旧行为里隐式存在的性质"，不能被当成冗余删掉。
   *
   * ⚠️ **今天不可达**：`acceptResyncRes` / `applyResyncFile` 在生产里零调用者
   * （`main.ts:455` 自己写着，任务书 §2 把重连归 T9/T10）。这是潜伏项，不是现行 bug。
   *
   * ⚠️ 它**不是**"流程到哪一步了"的又一个状态位：只有"本链路取过的那条 nonce"这一个事实。
   */
  let faceNonceOnce: string | null = null;
  /** 本链路的面 nonce（只在此处取熵；重发承诺时复用同一条） */
  function faceNonce(): string {
    if (faceNonceOnce === null) faceNonceOnce = opts.randomToken();
    return faceNonceOnce;
  }
  /** 订阅链路状态变化的宿主回调（本路由转发 `NetTransport.onStatus`） */
  const statusListeners = new Set<(to: TransportStatus) => void>();

  /**
   * 发一条会话层产出的消息（通道按消息类型定：只有 `act` 是可靠保序的，D11）。
   *
   * ★ **返回值是传输层那一格的真实读数**（J-2）：`sendIfOpen` 在通道没 open 时**不排队、
   * 直接丢**（`net-browser.ts:1373`）⇒ 调用方必须能看见"这条没出去"。把结果吞掉就等于
   * 让"握手停住"看起来像"没事发生"，而那是本仓最恨的形态。
   */
  function send(msg: NetMsg): SendResult {
    const enc = encodeMsg(msg);
    // 编不出来就不发：形状由会话层定，这里没有能修的余地（`decodeMsg`/`encodeMsg` 都不抛）
    if (!enc.ok) {
      return { ok: false, reason: 'not-initialized', message: '这条消息编不出来，没有发出去。' };
    }
    // ★ **T8-E：通道由唯一一张表定**（`net-browser.ts` 的 `MESSAGE_CHANNEL`）—— 这里原来是
    //   一句 `msg.t === 'act' ? 'act' : 'beat'`，把整条握手全塞进了不可靠通道（真机实测的堵点）。
    const channel: NetChannel = MESSAGE_CHANNEL[msg.t];
    const r = opts.transport.sendIfOpen(channel, enc.text);
    outCount += 1;
    return r;
  }

  /**
   * ★★ **G5 T13-A：把"卡在半路的那条握手/收官消息"按相位重发一次**（D23 ②）。
   *
   * ## ★ 这是本文件里 `session.redrive()` 的**唯一**调用点（计数腿的锚点）
   *
   * 两个触发点都走这一个 helper（`session.redrive()` 在源码里因此只出现一处）：
   *  - **链路恢复**（`offline -> online`）：`detachStatus` 的订阅分支。这正是 D23 那句
   *    "重连后两端谁都不会再发它"的反面 —— 恢复那一刻由本端主动重发；
   *  - **房主应答完 `resync-req`**：`receive()` 里那一格（T6 的接口注释明写这条）。
   *
   * ## 为什么"确有在途消息才发"是硬条件（判据 2 的后半，变异 M2 的锚点）
   *
   * `session.redrive()` 的语义是**推导**（`session.ts:1349-1370`）：按当前相位 + 相位机本来
   * 维护的那些值算"该发而未确认"的那一条。相位上没有在途消息时它**合法地**返回 `null`
   * —— 那不是失败，是"这一格本端没有欠对端的消息"。把它当成"发点什么"（例如无条件发
   * `commit`）会制造重复投递：房主已经收到过的 `commit` / `reveal-seed` / `reveal-salt`
   * 会被再发一遍，而收方对**不是自己那条**的重复一律 `unexpected-message`（D23 ①的收窄口径，
   * `session.ts:1879-1902`）。⇒ 这里**只**在 `output !== null` 时发，并把**真的发出去了的**条数
   * 记进 `redriven`（修复轮，2026-09-20：评审指出原来数的是"发送尝试" —— `send()` 返回失败时
   * `redriven` 照样 +1，而屏幕上/门里读的是"重发成功了吗" ⇒ 现在只有 `send()` 报成功才 +1，
   * 失败那条把 `SendResult.message` 记进 `driveRefusal`，**不静默**）。
   */
  function redriveOnce(): boolean {
    const r = session.redrive();
    if (!r.ok) { driveRefusal = r.message; return false; }
    if (r.output === null) return false; // 相位上没有在途消息 ⇒ 合法的空操作
    const sent = send(r.output.msg);
    if (!sent.ok) { driveRefusal = sent.message; trace(`redrive失败(${r.output.msg.t}:${sent.reason})`); return false; }
    redriven += 1;
    trace(`redrive发出(${r.output.msg.t})`);
    return true;
  }

  /**
   * ★★ **G5 T13-B：去要一份档案**（`resync-req` 的**唯一**构造点）。
   *
   * 会话层只有 acceptor（`acceptResyncReq` 只在房主侧、方向由 `accept()` 分派）⇒ 这条
   * **请求**由接线层按 `protocol.ts:171-177` 的形状拼：`{ t, sessionId, appliedSteps }`。
   *
   * 两条 cause 各走各的触发（判据 2 的"两种 cause 别混成一条"）：
   *  - `resuming-handshake`：`resume` 链路收到 `hello-ack` ⇒ 本层内部调（见 `receive()`）；
   *  - `queue-overflow`：宿主读 `driver.onFailure('inbound-overflow')` ⇒ 宿主调
   *    `client.requestResync()`（溢出可能在任何相位，本层不知道）。
   *
   * `appliedSteps` 是**自报数**（`protocol.ts:175-176`：权威值仍是档案里那一步）⇒ 它只用于诊断，
   * 传 0 也不会让追平出错。
   */
  function requestResync(): boolean {
    if (session.role !== 'guest') return false; // 只有加入方能发（房主没有可要的对象）
    if (resyncReqSent) return false;            // 同一条链路上只发一次
    resyncReqSent = true;
    const applied = opts.appliedSteps?.() ?? 0;
    send({
      t: 'resync-req',
      sessionId: opts.sessionId,
      appliedSteps: Number.isInteger(applied) && applied >= 0 ? applied : 0,
    });
    trace('发出 resync-req');
    return true;
  }

  /**
   * ★★ **G5 T13-B：用房主给的档案追平**（`session.applyResyncFile(` 的**唯一**调用点）。
   *
   * 会话层那一步只做两件事：比"调用方自报的步数 vs 档案长度"（§9 第 9 条那条比较的锚点）、
   * 把相位与 `needsResync` 放回去，并把"追平完成后该重发的那一条"放进返回值（`session.ts:2273`）。
   * 状态的**重建**不在这里（那要 `stateAtStep` 与宿主的 `GameState`）—— 见 `onResyncRes`。
   */
  function applyResync(file: MatchFile, statesAtStep: number): boolean {
    if (session.role !== 'guest') return false;
    const r = session.applyResyncFile(file, statesAtStep);
    if (!r.ok) { driveRefusal = r.message; trace(`applyResync拒绝(${r.message})`); return false; }
    trace(`applyResync成功(phase=${r.phase})`);
    // ★ D23 ② 的加入方那一半：追平完成 ⇒ 按相位把"该发而未确认"的那条发出去
    if (r.output !== null) {
      const sent = send(r.output.msg);
      // ★ 修复轮：这一条也**只有真发出去了**才计数（与 `redriveOnce` 同一口径）
      if (sent.ok) redriven += 1;
      else { driveRefusal = sent.message; trace(`applyResync重发失败(${r.output.msg.t}:${sent.reason})`); }
    }
    return true;
  }

  /**
   * ★ **入站文本 → `accept` 的唯一一处**（变异 M8 的锚点）。
   *
   * 三步：解码（`decodeMsg`，`protocol.ts` 的唯一解码口）→ 喂会话层 → 把产出的消息发回去。
   *
   * ## 两个"什么都不发"的情形（都必须早退，不能当成错误）
   *
   *  1. `decision.ok === false`：会话层拒了这条入站消息（理由与那句话在 `decision` 里，
   *     由调用方决定要不要显示）。**这是正常结果**，不是异常；
   *  2. `decision.output === null`：`SessionDecision` 的**合法成功面**之一 —— 有些入站消息
   *     被收下之后本端不需要回话（`session.ts:370` 明写着这一支）。
   *
   * ⚠️ 第 2 条在实现时踩过一次：只判 `!decision.ok` 就去取 `.msg`，撞上 `output: null` 会当场
   * `TypeError`（而它本该是一条安静的正常路径）。所以这里两个都要判。
   *
   * ## ★ G5 T13：三格重连动作都挂在这里（**入站路由仍然只有一处** `session.accept`）
   *
   *  - `hello-ack` 且本链路是重连 ⇒ **要档案**（`requestResync()`）；
   *  - `resync-req`（房主侧）被收下 ⇒ 按相位重发（`redriveOnce()`，D23 ②的房主那一半）；
   *  - `resync-res`（加入方侧）被收下 ⇒ 把档案交给宿主重建状态，再 `applyResync()`。
   *    宿主回 `null` ⇒ **不**走 `applyResyncFile`（会话层停在 `resync-pending`、`needsResync`
   *    仍为真），并把可读原因留在 `driveRefusal` —— 判据 3 要的"不许静默覆盖"就落在这里。
   */
  function receive(text: string): boolean {
    const dec = decodeMsg(text, { protoVersion: opts.localProtoVersion });
    if (!dec.ok) {
      // 坏帧不是异常：丢掉这一帧，不抛。但"收到过一帧"这件事要让宿主知道（见 `onInbound`）
      opts.onInbound?.();
      return false;
    }
    const decision = session.accept({ t: dec.msg.t, msg: dec.msg } as SessionInbound);
    inCount += 1;
    if (!decision.ok) {
      // ★ 诊断（T8-E）：被会话层拒了 —— 把那条消息的**类型**与**可读拒绝理由**记进读数，
      //   否则"两端停在 handshaking"在屏上完全看不出是被拒还是没收到。
      trace(`accept拒绝(${dec.msg.t}:${decision.message})`);
      opts.onInbound?.();
      return true;
    }
    // ── ★ G5 T13-A：重连握手完成 ⇒ 去要档案（`resuming-handshake` 那条 cause 的动作）──────
    if (resumeMode && dec.msg.t === 'hello-ack') requestResync();
    // ── ★ G5 T13-A：房主应答完 `resync-req` ⇒ 按相位重发（D23 ② 的房主那一半）──────────
    if (dec.msg.t === 'resync-req') redriveOnce();
    // ── ★ G5 T13-B：加入方收下 `resync-res` ⇒ 宿主重建状态，再由本层交给会话层核对 ────────
    if (dec.msg.t === 'resync-res') {
      const file = (dec.msg as { file?: unknown }).file;
      const rebuild = opts.onResyncRes;
      const steps = rebuild === undefined ? null : rebuild(file as MatchFile);
      if (steps === null) {
        driveRefusal = '追平失败：本端没能用这份档案重建状态（原因见屏上那一行提示）；'
          + '本端状态一个字没动，也不假装已经追平。';
        trace('追平失败(宿主拒绝)');
      } else {
        applyResync(file as MatchFile, steps);
      }
      opts.onInbound?.();
      return true;
    }
    if (decision.output === null) { opts.onInbound?.(); return true; } // 情形 2：收下了但不必回话
    if (dec.msg.t === 'hello') {
      // `hello` 的成功面**直接是** `HelloAckMsg`（不是 `SessionOutbound`）
      send(decision.output as unknown as NetMsg);
    } else {
      send((decision.output as SessionOutbound).msg);
    }
    opts.onInbound?.();
    return true;
  }

  /**
   * ★ **加入方发出第一条 `hello`**（`session.ts:2438-2440` 说的"调用方自己拼"那一步）。
   *
   * 幂等：发过一次就返回 `false`（重连与新链路都会走到这里，重复发会让房主看到两条 `hello`）。
   * 房主**不调它** —— 房主是被握手的那一方（`hello` 的方向是加入方 → 房主）。
   *
   * ## ★ J-2：通道还没 open 时**先攒着**，等传输状态转 `online` 再真发（不再是"发完就丢"）
   *
   * 加入方那条 `hello` 在 `connect('first')` 里被发，而那一刻**数据通道还没 open**
   * （它要等房主把回示码贴回来、`applyAnswer` 之后才会通）⇒ 传输层 `sendIfOpen` 不排队、
   * 直接丢（`net-browser.ts:1373`），而本函数过去发完就置 `helloDone` ⇒ **没人补发**
   * ⇒ 真浏览器里两端都停在 `handshaking`（真机实测：房主接得上 answer，握手不动）。
   *
   * 机制：置一个**待发位**，由 `transport.onStatus`（**注入的状态订阅**，没有第二处定时器）
   * 在状态变成 `'online'` 那一刻把这一条真发出去。两条纪律：
   *  1. **只发一条**：`pending` 与 `helloDone` 都是一次性位，`online → offline → online`
   *     不会补发第二条（重复发会让房主看到两条 `hello`）；
   *  2. **失败不静默**：真发失败时把传输层那句可读原因记进 `opts.onNotice`
   *     （吞掉它等于让"没发出去"看起来像"没事发生"）。
   */
  function sendHello(): boolean {
    if (session.role !== 'guest') { trace(`sendHello:拒绝(role=${String(session.role)})`); return false; }
    if (helloDone) { trace('sendHello:拒绝(helloDone)'); return false; }
    trace(`sendHello:交下(status=${opts.transport.status()})`);
    pending = true;
    return flushHello();
  }

  /**
   * 待发的第一条 `hello`（`true` = 攒着还没出去）。
   *
   * ⚠️ 它**不是**"流程到哪一步了"那种第二个真相源：它只记"这条消息还没上线"这**一件事**，
   * 而"发过没有"归 `helloDone`（`helloSent()` 的读数）。
   */
  let pending = false;

  /** 是否已经请传输层"通道一 open 就把这句叫醒"（只请一次；`flushHello` 里那句 `send` 只是重试） */
  let openHooked = false;

  /**
   * ★ **诊断读数（T8-E）**：第一条 `hello` 走到哪一步。**只读、只拼字符串**，不参与任何判定
   * （判定仍是 `pending` / `helloDone` / 传输状态那三样）。
   *
   * 为什么要有它：真浏览器里"两端握手不动"时，屏上什么都看不出来（传输 online、通道 open、
   * 而 `send()` 一次都没被调用）。只靠探针猜了三轮都猜错（`SyntaxError` 的探针、把
   * `getConfiguration` 读在构造器里、`online` 与 `open` 差 3 毫秒）—— 所以把这条路的每一步
   * 记成一串读数，挂到屏上（`data-hello-diag`），下一次 CDP 直接读，不再猜。
   */
  const helloTrace: string[] = [];
  const trace = (s: string): void => {
    helloTrace.push(s);
    if (helloTrace.length > 10) helloTrace.shift();
  };

  /**
   * 把待发的那条 `hello` 真发出去（状态订阅 / 通道 open / `sendHello()` 共用这一份）。
   *
   * 返回 `true` = **这一次真的发出了**。三种 `false` 都是"没发"，且各有各的可读理由：
   * 没有待发位 / 传输还没 `online` / 传输层拒了。
   *
   * ## ★★ 为什么"传输转 `online`"与"通道真的 open"是**两个**时机（真机实测）
   *
   * 只读探针实测（`.superpowers/g5-T8/ice-chan-probe.txt`）：真 Chrome 里
   * `connectionstatechange -> connected` 与 `iceconnectionstatechange -> connected` 都在
   * **t+11521ms**，而两条数据通道的 `open` 事件在 **t+11524ms** —— 传输状态先转 `online`
   * **3 毫秒**，`readyState` 还是 `connecting` ⇒ 那一刻 `sendIfOpen` 把这一条**丢掉**，
   * 而这边又不重试 ⇒ 两端相位永远停在 `handshaking`（`send()` 一次都没被调用过）。
   *
   * ⇒ 本函数在"发失败"这一支上**请传输层在通道真的 open 时再叫一次**
   * （`transport.onChannelOpen`；真实现按 `RTCDataChannel` 的 `open` 事件触发）。
   * 这不是计时器：它是**事件订阅**，与"等 `online`"同一条纪律（本仓计时一律注入）。
   */
  function flushHello(): boolean {
    if (!pending || helloDone) {
      trace(`flush:跳过(pending=${String(pending)},done=${String(helloDone)})`);
      return false;
    }
    if (opts.transport.status() !== 'online') {
      trace(`flush:等状态(status=${opts.transport.status()})`);
      return false;
    }
    // ⚠️ 走 `send()`（= `sendIfOpen` + 记发件数）：把失败广播给 `onError` 订阅者这一点在这里是
    //    可接受的 —— "通道晚 3 毫秒 open"是正常的重试过程，而重试由下面的订阅兜住。
    const r = send(helloMsg());
    if (!r.ok) {
      // 传输报 online 却发不出去（通道还没 open / 队列满 / 已关）：记下可读真因，等下一次机会。
      driveRefusal = r.message;
      trace(`flush:失败(${r.reason})`);
      if (!openHooked) {
        openHooked = true;
        trace('flush:挂通道open');
        opts.transport.onChannelOpen?.(() => { trace('channelOpen回调'); flushHello(); });
      }
      return false;
    }
    trace('flush:成功');
    pending = false;
    helloDone = true;
    return true;
  }

  /** `hello` 的消息体（唯一的组装处；自报座位缺省 1，房主认可后以 `hello-ack.seat` 为准，D7） */
  function helloMsg(): NetMsg {
    return {
      t: 'hello',
      role: 'player',
      sessionId: opts.sessionId,
      protoVersion: opts.localProtoVersion,
      cardDataHash: opts.localCardDataHash,
      seat: (opts.seat ?? 1),
      nick: opts.localNick?.() ?? '',
      /**
       * ★★ **G5 T13-A：重连的 `hello` 必须带 `resuming: true`**（D8 的原始形态）。
       *
       * 不带它会发生什么（实测读码，`session.ts:1515-1518`）：房主那一侧的 `acceptHello` 把
       * "非 `handshaking` 相位收到的 hello"一律判成**迟到/重复的 hello**，走 `refuseLateHello`
       * —— 相位不动、`emit: false`、**不回 `hello-ack`**。而加入方那一侧的整条重连路
       * （`markResuming()` → `resuming` → 等 ack → 要档案）**第一步就是在等 ack** ⇒
       * 少了这个字段，D8 那条"重新握手 → resync-res → 重放 → 继续"在产出路径上发不起来。
       *
       * 方向与时机：只有 `connect('resume')` 那条链路才置它（`resumeMode`）；第一次接上
       * 不带 —— 普通 hello 走的是"握手刚完成"那一支（`awaiting-commit-face`），一字不改。
       */
      ...(resumeMode ? { resuming: true } : {}),
    };
  }

  /**
   * ★★ **按相位发"这一格该本端发的那条"**（C 轮；结构缺口 ② 的落点）。
   *
   * 相位→动作的对照**照抄** `session.ts:282-283` 的两张表。这里是那张表的**唯一**消费者。
   *
   * ## 三条纪律
   *
   *  1. **不存"到哪一步了"**：唯一的输入是 `session.phase()`。没有计数器、没有已发清单。
   *  2. **两条"发了相位也不动"的消息**（`sendCommit` / `sendRevealSalt`）靠一次性记账位防重 ——
   *     那两个位是"本对象发过这一条"的事实，不是流程状态。
   *  3. **失败不抛、不吞**：会话层拒了（例如重复的 `reveal-salt`）就把那句可读原因记下来，
   *     返回 `false`。**绝不静默**（静默会让"流程停住"看起来像"没事发生"，那是本仓最恨的形态）。
   *
   * 返回 `true` = 这一次真的发出了 `output`。
   */
  function driveOnce(): boolean {
    const phase = session.phase();
    switch (phase) {
      case 'awaiting-commit-face': {
        if (session.role !== 'host') return false;
        if (commitSent) return false; // 这一格发了相位也不动 ⇒ 只发一次
        const r = session.sendCommit(opts.matchSeed, opts.randomToken());
        if (!r.ok) { driveRefusal = r.message; return false; }
        send(r.output.msg);
        commitSent = true;
        return true;
      }
      case 'seed-committed': {
        // 加入方**收到房主的 commit** 之后就落在这一格 ⇒ 该发的是 `commit-ack`
        // （发完相位才变 `awaiting-commit-ack`）。
        if (session.role !== 'guest') return false;
        const r = session.sendCommitAck();
        if (!r.ok) { driveRefusal = r.message; return false; }
        send(r.output.msg);
        return true;
      }
      case 'awaiting-commit-ack': {
        // `commitFace()` 的**唯一**合法相位（`session.ts:292`）⇒ 该发的是本方那条承诺。
        if (session.role !== 'guest') return false;
        /**
         * ★★ **T11-B：面必须先到手，才允许往下走**（D27 的顺序约束落在这里）。
         *
         * 这一格是相位机的入口，也**只**是入口：`commitFace()` 一发出去，房主就据此揭示种子。
         * 所以"要面"的时机就是这一刻，**不是** `complete` 之后 —— 后者会让加入方先看到种子，
         * 硬币永远归它赢（D27 的两个选项里用户选了保留顺序约束）。
         *
         * 两种"还没有面"要分开（这条分界就是注入项存不存在）：
         *  - **注入了 `chooseFace`**（`main.ts` 那条真路）：问一次，然后**停在原地等它 resolve**。
         *    返回 `false` = "本端暂时没东西可发"，屏上那块硬币屏因此停在"等玩家点"的状态；
         *  - **没有注入**（测试夹具 / 还没有硬币屏的调用方）：保持 T11-B 之前那套**常量面 0**
         *    的行为，一步不差 —— 不能因为"没人给面"就让整条流程停住。
         *
         * ## ★★ G5 T13-A：**重连链路上不重掷硬币**（用户裁决 2026-09-20）
         *
         * 硬币在断线之前就已经定过了：重建/恢复出来的这条链路用的是**旧链路记下的那一面**
         * （`readFaceMemory`；没有记忆时取面 0，也就是"没有注入 `chooseFace`"那条常量面的同值），
         * nonce 仍然由本链路新取一条（承诺必须是一条新承诺，`faceNonce()` 只保证**本链路内**
         * 幂等）。⇒ 三个后果：① 屏上**不再弹**硬币屏（`suppressesCoinScreen()`）；
         * ② `commit-face` 照常发得出去（这条链路的房主在等它）；③ 两端算出的落点/先选协议者
         * 与断线前**逐字相同**（同一个种子 + 同一面 ⇒ 同一条 `draftStarterFor`）。
         */
        if (resumeMode) {
          chosenFace = chosenFace ?? opts.readFaceMemory?.() ?? faceFromSide(1);
        } else {
          askFaceOnce();
        }
        /**
         * ★★ **G5 T13-A：`commit-face` 的一次性位**（§9 第 9 条相位不单调的处置）。
         *
         * 相位机在重连回退路径上**不单调**（`applyResyncFile`，`session.ts:2263-2269` 在
         * `phaseBeforeResyncApply ∈ {null,'resuming','handshaking'}` 时把相位写回
         * `seed-committed`；而 `acceptCommit` 也认 `resuming` / `resync-pending`）⇒
         * 同一条链路上相位可以**第二次**走到 `awaiting-commit-ack`，于是这一格会再发一条
         * `commit-face`。房主侧 `acceptCommitFace`（`session.ts:1738`）对重复一律
         * `unexpected-message` ⇒ 第二条是**纯粹的多余投递**（判据 2 要抓的形态），
         * 而"再发一条内容不同的承诺"更坏（房主最后验 `reveal-face` 会失配）。
         *
         * ⇒ 每个**链路对象**一条 `commit-face`（与房主的 `commitSent` / `saltSent` 同级、
         * 同一族纪律：那是"本对象已经发过这一条"的事实，不是"流程到哪一步"的第二份状态）。
         * 已经发过就返回 `false`（本格没东西可发），相位机与重发链（`redriveOnce`）继续各自干活。
         */
        if (faceSent) return false;
        // 没有注入 `chooseFace` ⇒ 常量面「正面」（会话层 0），也就是 T11-B 之前那句
        // `session.commitFace(chosenFace, …)` 里 `chosenFace = 0` 的行为。走同一个映射口。
        const legacyFace: 0 | 1 | null = opts.chooseFace === undefined ? faceFromSide(1) : null;
        const face: 0 | 1 | null = chosenFace ?? legacyFace;
        if (face === null) return false;
        const r = session.commitFace(face, faceNonce());
        if (!r.ok) { driveRefusal = r.message; return false; }
        send(r.output.msg);
        faceSent = true;
        return true;
      }
      case 'face-committed': {
        if (session.role !== 'host') return false;
        const r = session.sendRevealSeed();
        if (!r.ok) { driveRefusal = r.message; return false; }
        send(r.output.msg);
        return true;
      }
      case 'seed-revealed': {
        if (session.role !== 'guest') return false;
        const r = session.sendRevealFace();
        if (!r.ok) { driveRefusal = r.message; return false; }
        send(r.output.msg);
        return true;
      }
      case 'complete': {
        if (session.role !== 'host') return false;
        if (saltSent) return false; // 这一步也不改相位 ⇒ 只发一次
        const r = session.sendRevealSalt();
        if (!r.ok) { driveRefusal = r.message; return false; }
        send(r.output.msg);
        saltSent = true;
        return true;
      }
      // 其余相位（handshaking / resuming / resync-pending / awaiting-commit / reveal-salt-sent /
      // rejected / face-committed 之外的）**本端没有要发的东西** —— 等对端。
      default:
        return false;
    }
  }

  const detachMessages = opts.transport.onMessage((text) => { receive(text); });
  // 会话层**不自己**订阅传输状态（`session.ts:768-776`：订阅是有生命周期的副作用，纯状态机
  // 不持有它）⇒ 调用方转一手，这正是"读数同源"那一半的落点。
  //
  // ★ J-2：这里也是"待发的那条 `hello`"唯一的补发时机（状态订阅 = 注入的机制，不用时钟）：
  //   加入方那条 `hello` 是在通道 open **之前**被交下来的，转 `online` 那一刻才算真的发得出去。
  const detachStatus = opts.transport.onStatus((change) => {
    trace(`status:${change.to}`);
    session.noteTransportStatus(change.to);
    /**
     * ★★ **G5 T13-A：链路"自己回来了"那一刻 ⇒ 把卡在半路的那条消息重发一次**（D23 ②）。
     *
     * 判据写死成 `offline -> online`：冷启动的 `idle -> connecting -> online` **不算恢复**
     * （那时相位机本来就在正常推进，重发只会制造重复投递）。`wasOffline` 就是这个事实。
     *
     * 这条分支与 `main.ts` 的 A5（宽限内没回来才重建链路）配套：宽限期内恢复 ⇒ 不重建、
     * 会话对象的相位进度**一个字不丢** ⇒ `redriveOnce()` 推得出那条该重发的消息；
     * 超过宽限 ⇒ 重建，走 `resync` 追平（那条路上相位是新的，`redrive()` 合法地返回 `null`）。
     *
     * ⚠️ 顺序：先 `noteTransportStatus`（读数跟上）、再补发 `hello`、再重发在途消息、
     * 最后才通知宿主重画 —— 屏上那一帧要看到的就是"补发之后"的真值。
     */
    if (change.to === 'offline') wasOffline = true;
    if (change.to === 'online') {
      flushHello();
      if (wasOffline) {
        wasOffline = false;
        redriveOnce();
      }
    }
    for (const cb of statusListeners) cb(change.to);
  });
  return {
    session,
    transport: opts.transport,
    receive,
    sendHello,
    helloSent: () => helloDone,
    helloDiag: () => helloTrace.join(' | '),
    driveOnce,
    redrivenCount: () => redriven,
    requestResync,
    applyResync,
    /**
     * ★ G5 T13-A：重连链路上不弹硬币屏（用户裁决：重连**不重掷硬币**）。
     * 屏那一侧的唯一消费者是 `lobbyCoinViewOf()` 的第一句。
     */
    suppressesCoinScreen: () => resumeMode,
    role: opts.role,
    /**
     * 加入方叫出去的那一面。`chosenFace` 是**会话层口径**（`0 | 1`），屏上要的是 `1 | 2`
     * ⇒ 过 `sideFromFace`（映射只此一处）。房主侧恒 `null`（它不是叫面的一方，D3）。
     */
    chosenSide: (): CoinSide | null => (session.role === 'guest' && chosenFace !== null ? sideFromFace(chosenFace) : null),
    /**
     * 本端能算出的落点：**两端同一条规则**（`coinLanding(种子)`，`src/app/coin.ts` 只此一处）。
     * 房主那份的**可用时机**另由 `verdictReady()` 把关（见接口上的说明）。
     */
    landedSide: (): CoinSide | null => {
      const seed = session.seed();
      return seed === null ? null : coinLanding(seed);
    },
    /**
     * 对端叫出去的那一面（房主侧）。只有房主读得到（加入方自己就是叫面者）；
     * `session.face()` 在 `acceptRevealFace` **校验通过之后**才被写（`session.ts:1828`）。
     */
    peerChosenSide: (): CoinSide | null => {
      if (session.role !== 'host') return null;
      const f = session.face();
      return f === null ? null : sideFromFace(f);
    },
    /** 加入方自己就是叫面者（它读自己的 `chosenSide()`）⇒ 恒 `true`；房主要等面揭示进来 */
    verdictReady: (): boolean => session.role === 'guest' || session.face() !== null,
    /**
     * 胜负依据齐了没有：落点在 + 叫出去的那一面在（各自那一侧能拿到的那一个）。
     */
    winnerReady: (): boolean => {
      if (session.seed() === null) return false;
      if (session.role === 'host') return session.face() !== null;
      return chosenFace !== null;
    },
    hasFaceChooser: () => opts.chooseFace !== undefined,
    /** 叫面者的座位（= 加入方的座位）：加入方读自己、房主读对端（见接口上的说明） */
    callerSeat: () => (session.role === 'guest' ? session.selfSeat() : session.peerSeat()),
    /**
     * ★ T11-C：**本端自己的座位**（`createNetDriver` 的 `seat` 用它）。
     * 与 `callerSeat()` 是两个不同的问题，见接口上的说明。
     */
    selfSeat: () => session.selfSeat(),
    /** 本端此刻持有的种子（语义照会话层：房主 `sendCommit` 之后就有、加入方要等 `reveal-seed`） */
    seedOfSession: () => session.seed(),
    routedIn: () => inCount,
    routedOut: () => outCount,
    transportStatus: () => opts.transport.status(),
    onStatus: (cb) => {
      statusListeners.add(cb);
      return () => { statusListeners.delete(cb); };
    },
    detach: () => { detachMessages(); detachStatus(); },
  };
}

/** 大厅客户端（状态 + 接线）。渲染层只读它的 `state()` */
export interface LobbyClient {
  state(): LobbyState;
  /** 房主：建房 ⇒ 生成邀请码（异步，真压缩在浏览器层） */
  startHost(draft: LobbyDraftInput): Promise<void>;
  /** 加入方：贴一条邀请码 ⇒ 解出载荷并做**明文协议版本**的比对 */
  joinWithInvite(payload: string): Promise<void>;
  /** 加入方：读地址栏里的邀请码（读到才抹；没读到**不抹**） */
  readFromAddressBar(): Promise<void>;
  /** 玩家敲短码（原样记下；归一化在提交时才做） */
  setRoomCode(text: string): void;
  /**
   * 提交短码 ⇒ 端点判定 + 归一化。
   *
   * **零网络请求**：本方法只调纯判定（`roomCodeEntryReachability` / `normalizeRoomCode` /
   * `roomChannel`）。真正的网络动作（信令客户端 / 对端连接）住 `src/ui/net-browser.ts`，
   * 由 `src/main.ts` 注入 —— 所以"端点为空 ⇒ 记账数 0"在这里是**结构上**成立的。
   */
  submitRoomCode(): void;
  /** 展开 / 收起「高级 / 连接设置」（内容**默认不渲染**） */
  toggleAdvanced(): void;
  /**
   * ★★ **G5 T15：展开 / 收起区里的「中继（TURN）」那一小块**（三项输入框**默认不渲染**）。
   *
   * 它**只**管这三项显不显示，不碰任何判定：三项齐不齐仍由 `readIceServers()` 判
   * （`relayNoticeOf` 转发），"配了一半"仍然给那句可读提示。收起时**不抹**已填的值 ——
   * 填过的值仍留在设置里、仍然按原口径生效（`readIceServers` 读的是设置，不是这个开关）。
   */
  toggleRelay(): void;
  /** 读一项连接设置（渲染输入框的初值） */
  settingsValue(key: SettingKey): string;
  /** 写一项连接设置（写完之后重算 `readIceServers` 的读数） */
  setSetting(key: SettingKey, value: string): void;
  /** 连接设置的三项 */
  readonly settingKeys: readonly SettingKey[];
  /** 端点的原始读数（`signalingEndpoint`） */
  endpoint(): string;
  /** 提交失败时记一条错误（宿主在会话层拒绝之后调它） */
  noteError(key: LobbyErrorKey): void;
  /** 把一条可读提示写到屏上（`null` = 清空） */
  /**
   * 把一条可读提示写到屏上（`null` = 清空）。
   *
   * ⚠️ 名字是 **`showNotice`** 而不是 `note`：`tests/ui/g4-closure-guard.test.ts:167` 钉着
   * `src/main.ts` 里 `note(` **零命中**（G4 收口文档 §3 缺口 1 的现状腿）。
   * 大厅的宿主接口若叫 `note`，那句调用就会写进 `main.ts` ⇒ 那条腿当场红（实测踩过）。
   */
  showNotice(text: string | null): void;
  /**
   * ★★ **G5 T13-C 判据 5：把"上一条链路那一次交接的产物"作废**（只清显示屏上的交接产物，
   * 不动对局、不动会话对象）。
   *
   * ## 为什么必须有它（不清的后果是"玩家手里只剩一条过期的码"）
   *
   * 邀请码 / 回示码里的**承载段是那一次协商的 SDP**（`LobbyDraftInput.sdp`）。链路判死之后
   * 那条 SDP 所属的连接已经关了（`transport.close()` 不可逆）⇒ 屏上继续显示它，玩家把它
   * 发给对方只会得到一条**连不上**的码；更要紧的是 `renderNetLobby` 的房主那一支
   * **只在 `invite === null` 时才画「生成邀请码」按钮** ⇒ 不清它，玩家**没有入口**重新生成
   * （这正是 §9 第 27 条那个缺口的另一半）。
   *
   * ## 清的恰好是这四样（每一样都"属于那一次交接"）
   *
   *  - `invite`：房主那一次交接产出的邀请码；
   *  - `joined`：加入方解出来的那一条邀请码（它的 `payload.sdp` 就是那条死连接的 offer）；
   *  - `answerCode` / `answerApplied`：同一次交接里那一来一回的回示码与它的处理结论。
   *
   * **不清** `notice`（调用方紧接着要写那一行如实结论）、不清房间码输入与端点读数
   * （它们与链路无关）。它**不**碰 `sessionId` / `log` / 对局状态 —— 玩家没有被踢出这一局。
   */
  invalidateHandshakeArtifacts(): void;
  /**
   * ★ **建链路并接上**（修复轮 A3/A4/A5）：造传输 → 建会话对象 → `attach` → 加入方发第一条 `hello`。
   *
   * `mode` 是**两件不同的事**，别合并：
   *  - `'first'`：第一次接上（建房 / 加入 / 读地址栏）⇒ 会话对象是**新的**，不调 `markResuming()`；
   *  - `'resume'`：**重连** ⇒ 同样**新建**会话对象（D23 的充分性前提），并且在喂任何入站消息
   *    **之前**先 `markResuming()`（`session.ts:925-935` 写死的时机）。
   *
   * 两种模式都**新建**对象：这是计划 §5 T8 那条硬约束。区别只在"要不要声明这是一次重连"。
   *
   * 传输的 `init()` 是异步的（真 WebRTC 必须异步）⇒ 本方法返回 Promise；调用方 `await` 它
   * 之后再重画一帧。
   */
  connect(mode: LobbyLinkMode): Promise<void>;
  /** 接上一条路由（本方法**只**接线，**不**新建会话对象、不建传输） */
  attach(link: LobbySessionLink): void;
  /**
   * ★ **订阅链路状态变化**（返回退订函数）—— 修复轮 A5：宿主据此决定"要不要重连"。
   *
   * 为什么这个口开在客户端而不是让宿主直接订阅传输：`s.link` 是**私有的**，而且它在每次
   * `connect()` 里被**换成一个新对象**（D23 的充分性前提）⇒ 宿主手里的旧订阅会悬空。
   * 本方法把订阅接到**当前**那条链路上，并在 `connect()` 之后自动重接。
   */
  onStatus(cb: (to: TransportStatus) => void): () => void;
  /**
   * 把链路状态与 T6 的对端读数**重读一遍**（读数同源的那一半）。
   *
   * 为什么要这个口：`peerStatus()` 是**拉**的读数，会话层不推送（`session.ts` 明写"会话层不自己
   * 订阅 `onStatus`"，那是调用方的活）⇒ 宿主在收到帧之后、每次重渲染之前调一次它。
   */
  sync(): void;
  /**
   * ★ **加入方发出第一条 `hello`**（转发到当前链路的 `sendHello()`；没有链路时返回 `false`）。
   *
   * ## 为什么这是一个**产出代码**的动作而不是测试夹具的事
   *
   * `session.ts:2438-2440` 逐字写着"本函数**不**生成也不发送 `hello`…调用方据此自己拼"。
   * ⇒ 不在这里发，加入方的握手**在产出路径上永远不会开始**（评审 1.1 的第 4 点）。
   */
  sendHello(): boolean;
  /** 本端是否已经发过 `hello` */
  helloSent(): boolean;
  /**
   * ★★ **G5 T13-A 的读数口**（判据 2 的计数腿）：
   *  - `redrivenCount()`：这条链路上"按相位重发在途消息"真的发出去了几次；
   *  - `suppressesCoinScreen()`：这条链路是不是重连链路（重连不重掷硬币，屏不画硬币屏）。
   */
  redrivenCount(): number;
  suppressesCoinScreen(): boolean;
  /**
   * ★★ **G5 T13-B：去要一份档案**（`queue-overflow` 那条 cause 的动作）。
   *
   * 宿主在 `driver.onFailure('inbound-overflow')` 之后调它：溢出这件事**可能发生在任何相位**
   * （`session.ts:1244-1247`），所以它不能挂在"重连握手"那个触发点上 —— 两条 cause 各有各的
   * 入口（判据 2）。会话层那一位由 `noteResyncNeeded('queue-overflow', …)` 置起来（宿主调
   * `noteResyncNeeded()`）。
   */
  requestResync(): boolean;
  /**
   * ★★ **G5 T13-B：把"本端需要一次追平"这件事交给会话层**（`queue-overflow` 那条 cause）。
   *
   * 溢出的真因由驱动给（`DriverFailure`），可读提示由宿主转写（纯层不产玩家文案）。
   */
  noteResyncNeeded(cause: 'resuming-handshake' | 'queue-overflow', detail: string): boolean;
  /**
   * ★★ **G5 T13-B：用房主给的档案追平**（转发到当前链路的 `applyResync()`）。
   *
   * 正常路径上宿主**不直接调它**：收下档案那一格在 `createLobbySessionLink().receive()` 里，
   * 它先问宿主 `onResyncRes` 要"应用了几步"，再自己调。这个公开口是给"宿主需要自己走一遍"
   * 的场合（例如重放调试）留的，也是计数腿"追平入口各有且仅有一处"的对照。
   */
  applyResync(file: MatchFile, statesAtStep: number): boolean;
  /**
   * ★★ **这一局本端打过没有**（G5 T13-A：`resume` 还是 `first` 的判定）。
   *
   * 语义只有一件：**本端上一次建链路用的会话号就是它** ⇒ 这次贴的码是"带着同一局回来"，
   * 于是 `connect('resume')`（先 `markResuming()`、`hello` 带 `resuming: true`）；
   * 否则是第一次接上。为什么不让本层自己猜：`'first'` 与 `'resume'` 的后果差一整条
   * 追平路径（`session.ts:925-935` 写死了时机），猜错会让 `needsResync` 变成假读数。
   */
  knowsSession(sessionId: string): boolean;
  /**
   * ★ **收方产出回示码**（B3）：拿当前那条邀请码里的 offer 去产一条 answer 回示码。
   *
   * 它需要三样已经就位：① 本端解出过一条邀请码（`state().joined.ok`）；
   * ② 宿主注入了 `buildAnswer`（没注入时返回 `false` 且**屏上不出现那个按钮**）。
   *
   * 返回 `false` = "这条路今天不可用"（没解出邀请码 / 宿主没给能力）—— **不抛**。
   */
  makeAnswer(): Promise<boolean>;
  /**
   * ★ **房主把回示码粘回来**（B3）：解出 answer 并喂进同一条连接。
   *
   * 返回 `false` = 没解出 / 没注入 `applyAnswer`。
   */
  submitAnswerCode(code: string): Promise<boolean>;
  /**
   * 加入方的**承诺校验结论**（`true` / `false`；`null` = 盐还没到，或本端是房主）。
   *
   * 为什么要暴露它：**N-9 的代价** —— 加入方验盐失败时 `phase === 'complete'` 而且
   * `acceptsInput === true`（`session.ts:434-436` 明写）⇒ 判"这一局好不好"**不许**只看
   * 相位或 `acceptsInput`，必须读这个结论。房主侧返回 `null`（它没有这个口）。
   */
  commitmentVerified(): boolean | null;
  /** 本端是否能产回示码（屏上据此决定那个按钮出不出现） */
  canMakeAnswer(): boolean;
  /**
   * ★★ **T11-B：硬币屏所需的全部读数**（房主/加入方各读哪几个见 `LobbySessionLink`）。
   *
   * `role()` / `phase()` 是"这一刻在哪一格"的事实；`chosenSide()` / `landedSide()` 是
   * "面到手了没有"的两个来源（叫面者读前者、等待方读后者）。**没有链路时**：
   * `role()` 是 `null`（还没接上）、`phase()` 是 `'idle'`、两个 side 都是 `null`。
   */
  role(): 'host' | 'guest' | null;
  /**
   * 会话相位（没有链路时是 `'idle'` —— 那不是 `SessionPhase` 的成员：`SessionPhase` 描述的是
   * "会话建起来之后在哪一格"，而"还没接上"是**大厅这一层**的事实，所以这里是一个更宽的联合）。
   */
  phase(): SessionPhase | 'idle';
  /** 加入方叫出去的那一面（屏上口径 `1 | 2`；`null` = 还没叫 / 本端不是叫面者） */
  chosenSide(): CoinSide | null;
  /** 对端已经揭示的**落点**（房主侧；`null` = 还没到手）—— 屏上那颗大币停在哪一面 */
  landedSide(): CoinSide | null;
  /** 对端叫出去的那一面（房主侧；见 `LobbySessionLink.peerChosenSide` 的说明） */
  peerChosenSide(): CoinSide | null;
  /** 等待方此刻能不能用这个落点算胜负（见 `LobbySessionLink.verdictReady` 的说明） */
  verdictReady(): boolean;
  /** 胜负依据齐了没有（见 `LobbySessionLink.winnerReady` 的说明）—— 屏据它决定定不定格 */
  winnerReady(): boolean;
  /** 这条链路上有没有"要面"的能力（没有 ⇒ 屏上不出现硬币屏） */
  canChooseFace(): boolean;
  /**
   * ★★ **叫面者的座位**（= 加入方的座位；D3）。
   *
   * 两端的这个数**必须相同**：加入方读自己的 `selfSeat`（`hello-ack.seat` 定下的），
   * 房主读 `peerSeat`（加入方 `hello` 里带过来的）—— 两个读数同源，所以判据 3 的
   * "两端 `draftStarter` 相等"是这条事实的直接后果。
   */
  callerSeat(): PlayerId;
  /** ★ T11-C：**本端自己的座位**（`createNetDriver` 的 `seat`）；与 `callerSeat()` 是两个问题 */
  selfSeat(): PlayerId;
  /** 本端此刻持有的种子（见 `LobbySessionLink.seedOfSession` 的语义；`null` = 还没到手） */
  seedOfSession(): string | null;
  /**
   * ★★ **T11-C：握手链路的交接口**（任务书 §6 的接口要求 —— "名字自定，但只能有一个入口"）。
   *
   * 交出的就是那一组 `{ transport, seat, role, seed, draftStarter }`，外加本端读数
   * （`phase` / `caller` / `chosen` / `landed` / `winner`）供宿主重算与排查用。
   *
   * ## 为什么"进对局"这件事的口必须开在**这一层**
   *
   * 造对局要的那五个数里，四个只有本层知道：`transport`（每次 `connect()` 都会换成新对象
   * ⇒ 宿主自己记一份引用副本必然悬空，B2 那条注释同款）、`seat`（`hello-ack.seat` 定下的）、
   * `seed`（房主 `sendCommit` 后就有、加入方要等 `reveal-seed`）、`draftStarter`（要 `callerSeat`
   * 与"叫出去的那一面"两个读数才算得出）。宿主只该拿到**算好的结果**，不该把这条算式抄第二份
   * —— 抄出来的那一份在屏上看起来完全正常（T11-B 的修复轮就是这个形状）。
   *
   * ## `ready` 的判据（写死三条，免得"大概齐了"）
   *
   *  1. 有链路，且**相位是 `'complete'`** —— 两端到这一格都说明：房主已经揭示种子、
   *     加入方已经揭示面、盐已经揭示（`session.ts:1868` / `:2030`）；
   *  2. `winnerReady()`（本端能拿到"叫出去的那一面"）；
   *  3. 种子与落点都在。
   *
   * 相位要求 **恰好 `'complete'`** 而不是"至少走到某处"：早一格（房主 `face-committed`）
   * 时房主手里的 `peerChosenSide()` 还是 `null`（加入方的 `reveal-face` 没进来）⇒ 两端会
   * 各自早一格开局，且房主那端算不出先选者 —— 那是 T11-B 已修缺陷的同一族形态。
   */
  handoff(): LobbyHandoff;
  /**
   * ★★ **按相位驱动承诺-揭示流程**（C 轮；结构缺口 ②）。
   *
   * ## 它解决的是什么
   *
   * `sendCommit` / `sendCommitAck` / `commitFace` / `sendRevealSeed` / `sendRevealSalt` /
   * `sendRevealFace` 在 `src/**` 里**一个调用者都没有**（T9 任务书作者核对代码时挖出的
   * 结构缺口 ②）⇒ 真浏览器里握手完成后房主停在 `'awaiting-commit-face'`、
   * 加入方停在 `'awaiting-commit'`，**承诺-揭示流程根本不会被驱动**。
   *
   * ## ★ 硬约束：**相位机仍是唯一的排序载体**
   *
   * 本驱动者**不许**自己另存一份"我们到哪一步了"（那是第二个真相源，与 D16 那条教训同族）。
   * 它只做一件事：**读一眼相位 → 发那一格该发的那条**。所以：
   *  - 没有计数器、没有"已发清单"、没有本地状态；
   *  - 重复调用的安全性由**会话层自己**保证（它按相位拒重复：`seed-duplicate` /
   *    `seed-not-expected` / `'当前相位是 …'`）⇒ 这里多驱动一次不会造成重复投递，
   *    最多被会话层拒掉（而拒掉这件事是可读的）。
   *
   * 返回"这一次驱动真的发出了几条"（0 = 这一格不需要本端发东西）——它是**读数**，
   * 不是状态：下一次调用照样只读相位。
   */
  drive(): number;
  /**
   * 当前那条链路的传输（`null` = 还没 `connect`）。
   *
   * 为什么开这个口：房主要"等 ICE 收集完再取一份非 trickle 的描述"（B2），
   * 而那个能力在**传输**上（`localDescription()`），不在会话上。宿主不该自己记一份
   * `s.link` 的引用副本 —— 它在每次 `connect()` 里都会被换成新对象。
   */
  transport(): NetTransport | null;
  /**
   * 重连：**新建会话对象 + 先声明重连 + 再接上**（顺序见 `createLobbySessionLink` 的注释）。
   *
   * ⚠️ 它**不**复用旧的 `HostSession` / `GuestSession` 实例（D23 的充分性前提，写死了）。
   * 它就是 `connect('resume')` 的别名 —— 保留这个名字是因为计划 §5 T8 与评审都用它说话。
   */
  reconnect(): Promise<void>;
  /** 起一次"等对端"的窗口（8s 之后置 `waitExpired`） */
  startWait(): void;
  dispose(): void;
  /**
   * ★★ **G5 T15：最近一次 `init()` 的结论**（`null` = 还没建过链路）。
   *
   * 它就是 `state().linkInit` 的那个读数，单独开一个口是因为宿主要**在 `connect()` 之前**
   * 清掉它（"正在建立链路…"那一格不该带着上一次失败的结论）。
   */
  linkInitDiagnostic(): LobbyLinkInitDiagnostic | null;
  /** ★ G5 T15：把那个读数清成 `null`（宿主在"要重新等一次链路"之前调） */
  clearLinkInitDiagnostic(): void;
}

/**
 * 建链路 / 重连 —— **两件不同的事**，所以用两个值而不是一个布尔。
 *
 * 写成一个布尔（`isReconnect?: boolean`）会让"第一次接上"与"重连"在调用点读不出区别，
 * 而两者的区别恰恰是 D23 那条充分性前提要看的东西。
 */
export type LobbyLinkMode = 'first' | 'resume';

/** 连接设置里的三个键 */
export type SettingKey = 'turnUrl' | 'turnUsername' | 'turnCredential';
const SETTING_KEYS: readonly SettingKey[] = ['turnUrl', 'turnUsername', 'turnCredential'];

/**
 * ★★ **握手链路的交接口**（T11-C；任务书 §6：交出 `{ transport, seat, role, seed, draftStarter }`
 * 这一组）。语义与 `ready` 的三条判据写在 `LobbyClient.handoff()` 上，这里只固定形状。
 *
 * `ready === false` 时：`transport`/`seed`/`draftStarter` 允许是 `null`（还没到手），
 * 其余读数是"这一刻的屏上读数"（房主在硬币屏上那一格就靠它画）。
 * `ready === true` 时：四样都必须是真值 —— 宿主据此 `createGame` + `createNetDriver`。
 */
export interface LobbyHandoff {
  /** 四样齐了没有（判据见 `LobbyClient.handoff()`）—— 宿主只在 `true` 时开局 */
  readonly ready: boolean;
  readonly transport: NetTransport | null;
  /**
   * 这一局那条**会话对象**（`ready === false` 时为 `null`）。
   *
   * 交它出去的理由只有一个：驱动与路由的**寿命**在宿主手里 —— 复位时宿主调
   * `session.detach()`（会话层不自己订阅传输状态，`session.ts:768-776`）而路由那边由
   * `LobbyClient.dispose()` 收拾。宿主不需要读它的任何其它方法（读数一律走这个接口）。
   */
  readonly session: NetSession | null;
  /** **本端**座位（`createNetDriver` 的 `seat`；来自 `hello-ack.seat` / `hello.seat`，D7） */
  readonly seat: PlayerId;
  readonly role: 'host' | 'guest';
  readonly phase: SessionPhase;
  /** 这一局的种子（`matchSeed`） */
  readonly seed: string | null;
  /** 先选协议者（`draftStarterFor(caller, chosen, seed)`；两端必须算出同一个数） */
  readonly draftStarter: PlayerId | null;
  /** 叫面者的座位（= 加入方的座位）；两端同值 */
  readonly caller: PlayerId;
  /** 叫出去的那一面（加入方读自己叫的、房主读对端揭示的）；两端同值 */
  readonly chosen: CoinSide;
  /** 落点（`coinLanding(seed)`）；两端同值 */
  readonly landed: CoinSide;
}

/**
 * 造一个大厅客户端。
 *
 * 状态的**唯一持有者**是它：渲染层（`renderNetLobby`）只读 `state()`，从不自己记一份。
 */
export function createLobbyClient(opts: LobbyClientOptions): LobbyClient {
  /** 连接设置（**本端内存里**的一份；落盘由宿主决定，本文件不碰存储） */
  const settings: Record<SettingKey, string> = { turnUrl: '', turnUsername: '', turnCredential: '' };
  for (const k of SETTING_KEYS) settings[k] = opts.readSettings()?.[k] ?? '';

  const iceOf = (): IceServersRead => readIceServers({
    turnUrl: settings.turnUrl,
    turnUsername: settings.turnUsername,
    turnCredential: settings.turnCredential,
  });

  const s: {
    role: 'host' | 'guest' | null;
    invite: MakeInviteResult | null;
    joined: InviteDecodeResult | null;
    roomCodeInput: string;
    roomCodeGate: string | null;
    transport: TransportStatus;
    peer: PeerStatus | null;
    advancedOpen: boolean;
    /** ★ G5 T15：区里那一小块 TURN 是否展开（默认收起，见 `LobbyState.relayOpen`） */
    relayOpen: boolean;
    /**
     * ★★ **G5 T15：最近一次 `init()` 的结论**（`null` = 还没建过链路）。
     *
     * 它是**跨 `connect()` 的记忆**：每次 `connect()` 换一条新链路，而"上一次为什么失败"
     * 必须活得比那条链路久，否则玩家一点重试就再也查不出原因（见 `LobbyState.linkInit`）。
     */
    linkInit: LobbyLinkInitDiagnostic | null;
    waitExpired: boolean | null;
    error: LobbyErrorKey | null;
    notice: string | null;
    link: LobbySessionLink | null;
    /** B3：收方产出的回示码（`null` = 还没产） */
    answerCode: string | null;
    /** B3：房主粘回来的那条回示码的处理结论 */
    answerApplied: { ok: boolean; message: string } | null;
  } = {
    /**
     * ★ **J-1：初值是注入的角色，不是 `null`**。
     *
     * 渲染层按 `role` 分屏（`role === null` 只画「建房 / 加入」两个入口），而屏上那个
     * 「生成邀请码」按钮只在 `role === 'host'` 那一支里、粘贴框只在 `'guest'` 那一支里。
     * 过去这里写 `null` ⇒ 点「建房 / 加入」只**建了客户端**、没有**选定角色**
     * （`startHost` 要等玩家先点到「生成邀请码」、`applyInvite` 要等玩家先能看见粘贴框）
     * ⇒ 两个入口都是**闭环**，环上没有入口能从屏上进入（真浏览器实测：点「建房」之后
     * `#app` 一个字节不变）。初值取 `opts.role` 就把环剪开了：角色是**入口的选择**，
     * 在 `startLobby(role)` 那一刻已经定下来，不需要玩家再点第二下。
     *
     * ⚠️ 它**不是**"第二份状态"：注入面本来就有 `role`（`createLobbySessionLink` 与
     * `connect()` 都读它），这里只是让 `state()` 与它同源。
     */
    role: opts.role,
    invite: null,
    joined: null,
    roomCodeInput: '',
    roomCodeGate: null,
    transport: 'idle',
    peer: null,
    advancedOpen: false,
    relayOpen: false,
    linkInit: null,
    waitExpired: null,
    error: null,
    notice: null,
    link: null,
    answerCode: null,
    answerApplied: null,
  };

  /**
   * ★ **`advancedOpen` 的初值恰好一处**（变异 M5 的锚点）。
   *
   * 折叠区的内容**默认不渲染**，而不是"渲染好再 `display:none`"：后者在没有布局引擎的
   * DOM 桩上与"已展开"不可区分（判据 7 的注意项），行为腿会退化成恒真。
   * 这条纪律与 `src/ui/consent` 的 `renderPrivacyDetail`（`local-consent.ts:111-113`）同款。
   */
  s.advancedOpen = false;
  /**
   * ★★ **G5 T15：`relayOpen` 的初值也恰好一处 —— 收起（`false`）。**
   *
   * 普通玩家看不懂 TURN URL / 用户名 / 凭据，三个空输入框摆在眼前只会让人以为"必须填"。
   * ⇒ 默认**不渲染**它们（同一条"默认不渲染而不是渲染好再藏"的纪律），
   * 只留一句"不用管这一块"；要自建中继的玩家自己点开那个开关。
   */
  s.relayOpen = false;

  let waitHandle: number | null = null;

  /**
   * 宿主的链路状态订阅（修复轮 A5）。
   *
   * 为什么要"转接"而不是让宿主直接订阅链路：`s.link` 在每次 `connect()` 里被**换成新对象**
   * （D23 的充分性前提）⇒ 旧订阅会跟着旧对象一起失效。这里每次接上新链路就重订一次。
   */
  const statusWatchers = new Set<(to: TransportStatus) => void>();
  let detachStatusWatcher: (() => void) | null = null;
  const reattachStatus = (): void => {
    detachStatusWatcher?.();
    detachStatusWatcher = null;
    const link = s.link;
    if (link === null) return;
    detachStatusWatcher = link.onStatus((to) => { for (const cb of statusWatchers) cb(to); });
  };

  const clearWait = (): void => {
    if (waitHandle !== null) {
      opts.ticker.cancel(waitHandle);
      waitHandle = null;
    }
  };

  const linkOf = (): LobbySessionLink | null => s.link;

  /**
   * 等对端的 8 秒窗口（**唯一**的调度点）。
   *
   * 收短码提交时起一次；窗口到点时若本侧链路还没 `online`，就记下 `'room-gone'` 那条错误。
   * 判定用的是 `s.transport`（**本侧链路**）—— 刻意不用 `init().ok` 与 `transport.status()` 里的
   * 任何"对端在线"含义：那两件事都不能当"对端在不在"的证据（D18）。
   */
  const beginWait = (): void => {
    clearWait();
    s.waitExpired = null;
    waitHandle = opts.ticker.schedule(() => {
      waitHandle = null;
      s.waitExpired = true;
      if (s.transport !== 'online') {
        s.error = 'room-gone';
        opts.onNotice?.(errorCopy('room-gone'));
      }
    }, DEFAULT_ROOM_GONE_MS);
  };

  /**
   * 收下一条邀请码（`joinWithInvite` 与 `readFromAddressBar` **共用**这一份：
   * "收下"的判定只有一处，免得两条入口对同一条载荷给出两种结论）。
   *
   * ## ★★ G5/T17：第一步是**判形态**，不是直接解码
   *
   * 玩家粘进来的可能是整条链接（房主屏上那句话就是这么让他发的）、`#invite=…` 片段、
   * 或裸载荷。形态判定只有 `pasteShapeOf` 一处 —— 拿到载荷之后**下面每一句都与改动前逐字相同**。
   */
  const applyInvite = async (payload: string): Promise<void> => {
    s.role = 'guest';
    s.error = null;
    const shape = pasteShapeOf(payload.trim());
    if (shape.kind === 'link-without-fragment') {
      // 看起来是链接却没有那一段 ⇒ 分形态的那句话（**不是**"开头不是整数"，那句是对载荷说的）
      s.joined = { ok: false, reason: 'bad-base64url', message: LINK_WITHOUT_FRAGMENT_INVITE_MESSAGE };
      opts.onNotice?.(null);
      return;
    }
    const text = shape.payload.trim();
    if (text.length === 0) {
      s.joined = { ok: false, reason: 'bad-base64url', message: '邀请码是空的：请把对方发来的整条邀请码完整粘贴进来。' };
      opts.onNotice?.(null);
      return;
    }
    // ★ **先把压缩段真解出来**（异步），再交一个**同步**口给纯层的 `decodeInviteText`。
    //   那个同步口只对"上面那一段 base64"回答，别的一律 `null` —— 于是纯层拿到的
    //   是"真的解得动"这个事实，而不是一个恒真的同一性检查（D15 的同一种缝法）。
    const compressed = text.slice(text.indexOf('.') + 1);
    const bytes = text.includes('.') ? await opts.decompressBase64(compressed) : null;
    const r = decodeInviteText(text, (b64) => (b64 === compressed && bytes !== null ? bytes : null));
    s.joined = r;
    if (r.ok) {
      // ★ 版本比对：`proto` 是明文段的结论（T7 已经算好），T8 只负责**渲染**它。
      // 这一步刻意排在"收下邀请码"之后、建立连接之前 —— 拒绝时机归大厅（`protocolVersionCheck` 的函数注释）。
      const verdict = r.proto;
      if (!verdict.ok) {
        s.error = 'proto-version';
        s.notice = verdict.message;
      } else {
        s.error = null;
        s.notice = null;
      }
    } else {
      s.notice = r.message;
    }
    opts.onNotice?.(s.notice);
  };

  /** 把链路状态与 T6 的对端读数**重读一遍**（`sync()` 与 `onInbound` 共用这一份） */
  const syncNow = (): void => {
    const link = s.link;
    if (link === null) return;
    s.transport = link.transportStatus();
    s.peer = link.session.peerStatus();
    // 会话层不自己订阅传输状态（`session.ts` 的注释）：那是调用方的活 ⇒ 每次重读都转发一次。
    link.session.noteTransportStatus(s.transport);
  };

  /**
   * ★ **建链路并接上**（修复轮 A3/A4/A5）。
   *
   * 每一步都有它非在这里不可的理由：
   *  1. `opts.createTransport()` —— 传输是**注入的能力**（D6：浏览器 API 的唯一出处是
   *     `src/ui/net-browser.ts`）；
   *  2. `await transport.init(...)` —— **由本层调**（不是工厂）：真 WebRTC 的 `init()` 必须异步，
   *     而且它**只保证本侧链路**（D18）⇒ 它的 `ok` 不许被读成"对端在线"；
   *  3. **每次都新建会话对象**（D23 的充分性前提，见 `createLobbySessionLink` 的注释）；
   *  4. `'resume'` 模式在**喂任何入站消息之前**先 `markResuming()`（`session.ts:925-935`）；
   *  5. 加入方**立刻发第一条 `hello`**（`session.ts:2438-2440` 说的"调用方自己拼"那一步）。
   */
  /**
   * 当前那条链路（`connect()` 每次都换新对象 ⇒ 用槽位，不在别处留引用副本）。
   * `onInbound` 要驱动流程，而它在 `connect` 之前就被注入 ⇒ 用这个槽位而不是闭包参数。
   */
  let currentLink: LobbySessionLink | null = null;

  /**
   * ★★ **G5 T13-A：这一局已经叫出去的那一面**（跨链路记忆；`0 | 1`，`null` = 还没叫过）。
   *
   * ## 为什么必须住在**客户端**这一层而不是链路里
   *
   * 重连**必须新建链路对象**（D23 的充分性前提），旧链路连着它那份 `chosenFace` 一起被丢掉
   * ⇒ 新链路重新要面时会**再弹一次硬币屏**，而硬币在断线前就已经定过了（用户裁决
   * 2026-09-20："重连**不重掷硬币**"）。所以那一面必须记在比链路活得久的地方 ——
   * 这一层就是"这一局的大厅客户端"，它的寿命与这一局相同。
   *
   * 两条纪律：① 只有**屏上真的点了**才会被写（`onFaceChosen` 的调用点在 `askFaceOnce` 的
   * resolve 里）；② 重连链路上没有记忆时取面 0（与"没有注入 `chooseFace`"那条常量面同值），
   * 而不是重新问玩家 —— 重新问就等于重掷。
   */
  let rememberedFace: 0 | 1 | null = null;

  /**
   * ★★ **G5 T13-A：上一次建链路用的是哪个会话号**（`knowsSession()` 的唯一输入）。
   *
   * 它答的是"这次贴的码是不是**带着同一局回来**"⇒ 决定 `connect('resume')` 还是 `'first'`。
   * 反过来说错一次的后果很具体：拿 `'first'` 去接同一局 ⇒ 不带 `resuming` ⇒ 房主
   * `refuseLateHello`（不回 ack）⇒ 整条追平路发不起来；拿 `'resume'` 去接新的一局 ⇒
   * `needsResync` 变成假读数（`session.ts:925-935` 明写的那条）。
   */
  let lastLinkSessionId: string | null = null;

  /**
   * ★ **按相位驱动到"本端暂时没东西可发"为止**（C 轮；结构缺口 ②）。
   *
   * 上界 16 是**防御**：正常流程两端合计最多 6 条（commit / commit-ack / commit-face /
   * reveal-seed / reveal-face / reveal-salt），16 足够，同时保证**绝不至于死循环**。
   */
  function driveToFixedPoint(): number {
    const link = currentLink;
    if (link === null) return 0;
    let sent = 0;
    for (let i = 0; i < 16; i += 1) {
      if (!link.driveOnce()) break;
      sent += 1;
    }
    return sent;
  }

  const connect = async (mode: LobbyLinkMode): Promise<void> => {
    const old = s.link;
    if (old !== null) old.detach();
    const transport = opts.createTransport();
    /**
     * ★ **建会话对象用的会话号**（D 轮 I-3 甲）。
     *
     * 加入方用**邀请码里房主那一串**（`s.joined.payload.sessionId`）；其余一律用自己那串。
     * 为什么不能各用各的：会话层按会话号配对，房主拿它校验 `hello` ⇒ 两套号 = 握手当场被拒
     * （实测症状：加入方停在 `handshaking`，房主那侧连相位都不动）。
     *
     * ⚠️ 回落到 `opts.sessionId` 是**刻意**的：没解出邀请码就建链路（重连、或宿主自己接的路）
     * 时仍然要有个号，而不是空串 —— 空串会让房主那侧把每条 `hello` 都判成别人的。
     */
    const linkSessionId = opts.role === 'guest' && s.joined?.ok === true
      ? s.joined.payload.sessionId
      : opts.sessionId;
    // ★ D25：把**角色**交给传输层 —— 加入方在收到对端 offer 之前不许建自己的 offer
    //   （它先出 offer、之后又在同一条连接上当 answerer，会让那条连接的 ICE 收集被回滚成
    //   零候选；真浏览器只读探针实测：40 秒零候选、零 icecandidateerror）。`opts.role` 就是
    //   建会话对象用的那个角色，两侧同源。
    const started = await transport.init({
      selfId: linkSessionId, peerId: `peer-of-${linkSessionId}`, role: opts.role,
    });
    /**
     * ★★ **G5 T15：把这一次 `init()` 的结论留下来**（跨 `connect()` 的记忆）。
     *
     * `statusAfter` 读的是**这一刻**传输自己的状态：`init()` 成功时它恒为 `connecting`
     * （那句 `emitStatus` 排在 `createOffer` 之前），失败时那几支**在 `emitStatus` 之前**就
     * 返回了 ⇒ 它恒为 `idle`。这个差别正是屏上"为什么没有连接描述"要说的那件事。
     *
     * ⚠️ 放在 `createLobbySessionLink` **之前**：那一步会建会话、发 `hello`，与"这次 init
     * 的结论"无关；顺序写在这里是为了让"读到的状态"确定是 `init()` 刚回来的那一刻。
     */
    s.linkInit = {
      ok: started.ok,
      reason: started.ok ? 'ok' : started.reason,
      message: started.ok ? '' : started.message,
      statusAfter: transport.status(),
    };
    const link = createLobbySessionLink({
      // ⚠️ 这里必须是 `opts.role`（**注入的角色**），**不是** `s.role`：`s.role` 要到
      //    `startHost()` / `applyInvite()` 才被赋值，而 `connect()` 会在它**之前**被调
      //    （"建房"那条路就是先 `connect('first')` 再 `startHost(...)`）⇒ 用 `s.role` 会把房主
      //    建成一个**加入方**会话，而加入方那一支还会顺手发出一条 `hello`。
      //    实测症状：那条链在成对假件上**永远握手不完成**（房主收到一条不该有的 hello，
      //    而它期待的是自己那份会话的握手）；诊断探针 `.superpowers/g5-T8/probes/diag-handshake.test.ts` 打的就是它。
      role: opts.role,
      transport,
      // ★ I-3 甲：加入方照邀请码里房主那一串建会话（见上面 `linkSessionId` 的说明）
      sessionId: linkSessionId,
      hash: opts.hash,
      // ★ T11-A：种子的素材与"再要一条随机串"的动作都从宿主注入（**不是** sessionId 派生）
      matchSeed: opts.matchSeed,
      randomToken: opts.randomToken,
      // ★★ T11-B：**"要面"的能力必须跟着走下去**（`createLobbySessionLink` 才是真正消费它的那一层）。
      //   漏了这一行 ⇒ 硬币屏永远不出现、面永远是常量 0，而屏上/线上都看不出哪里错了
      //   （实测踩过：`hasFaceChooser()` 恒 false，`driveOnce` 走的是常量面那一支）。
      ...(opts.chooseFace === undefined ? {} : { chooseFace: opts.chooseFace }),
      // ── ★★ G5 T13-A/B：重连接线要的那几样，一律**照传**（漏任何一样都是静默失效）────────
      //   ① `resume`：本链路是重连 ⇒ `hello` 带 `resuming: true`、不弹硬币屏（见 `helloMsg`）；
      //   ② `appliedSteps`：`resync-req.appliedSteps` 的自报数（宿主的驱动才是那个事实的主人）；
      //   ③ `resyncSource`：房主侧的重连凭据（D8：主机内存里的当前 MatchFile）；
      //   ④ `onResyncRes`：加入方侧"把状态真的重建出来"那一步（宿主做，见它的接口注释）；
      //   ⑤ 面记忆：重连**不重掷硬币**（读旧链路记下的那一面、把本链路选中的面记回去）。
      ...(mode === 'resume' ? { resume: true } : {}),
      ...(opts.appliedSteps === undefined ? {} : { appliedSteps: opts.appliedSteps }),
      ...(opts.resyncSource === undefined ? {} : { resyncSource: opts.resyncSource }),
      ...(opts.onResyncRes === undefined ? {} : { onResyncRes: opts.onResyncRes }),
      readFaceMemory: () => rememberedFace,
      onFaceChosen: (face) => { rememberedFace = face; },
      ...(opts.seat === undefined ? {} : { seat: opts.seat }),
      // ★★ G5 T13-C：300s 窗口的时钟照传（不注入 ⇒ 会话层判不了窗口，屏上那一格不许说"超窗"）
      ...(opts.clock === undefined ? {} : { clock: opts.clock }),
      localProtoVersion: opts.localProtoVersion,
      localCardDataHash: opts.localCardDataHash,
      ...(opts.localNick === undefined ? {} : { localNick: opts.localNick }),
      /**
       * ★ **每一帧入站都先 `sync()` 再通知宿主**（修复轮）。
       *
       * 为什么 `sync()` 必须在这里（而不是留给宿主）：`peerStatus()` 是**拉**的读数
       * （`session.ts:768-776`：会话层不自己订阅），所以"帧到了"与"读数变了"是两件事 ——
       * 只在 `onInbound` 里重画一帧、不先 `sync()`，屏上画的还是**上一帧的快照**。
       * 实测症状：两端会话层已经 `handshakeDone === true`，而 `state().peer` 仍是 `false`
       * （诊断探针 `.superpowers/g5-T8/probes/diag-handshake.test.ts` 打的就是它）。
       *
       * ⚠️ 把 `sync()` 与 `onInbound` 分成两步交给宿主，就会出现"宿主忘了先读一次"这类
       * 不报错的停摆 —— 所以这一步写在库里，不写在调用方。
       */
      onInbound: () => {
        syncNow();
        // ★ C 轮：收到一帧之后**先按相位驱动一次**（对端的消息可能正好解锁了本端的下一步），
        //   再通知宿主重画。顺序写死：先驱动、后重画，屏上画的才是驱动之后的状态。
        driveToFixedPoint();
        syncNow();
        opts.onInbound?.();
      },
    });
    // ★ 顺序写死：`markResuming()` **必须在喂任何入站消息之前**。`'first'` 模式**不调**它 ——
    //   第一次接上不是重连，调了会让 `needsResync` 变成假读数（那正是这个模块一直在防的东西）。
    if (mode === 'resume' && link.session.role === 'guest') link.session.markResuming();
    link.session.noteTransportStatus(link.transportStatus());
    s.link = link;
    currentLink = link;
    // ★ G5 T13-A：记住"这一局用的是哪个会话号"（下一次贴码据此判 first / resume）
    lastLinkSessionId = linkSessionId;
    /**
     * ★ **顺序写死：先把第一条 `hello` 交下去，再重接宿主的订阅。**
     *
     * 为什么：加入方交下这一条时传输通常还没 `online`（真机实测：`online` 比通道 `open` 早
     * 约 3 毫秒）⇒ `sendHello()` 走"发失败"那一支、在那里注册 `onChannelOpen` 重试。
     * 若反过来先 `reattachStatus()`，宿主的订阅会先建起来，而后面的失败重试与它无关 ——
     * 两条路互不依赖，但"先注册重试"在读代码时更不容易被误读成"重试是靠宿主订阅兜的"。
     */
    if (opts.role === 'guest') link.sendHello();
    // ★ **把宿主的订阅重接到这条新链路上**（`statusWatchers` 是宿主的，链路每次都换新对象）。
    //   漏了这一步的后果是**静默**的：`onStatus` 照样收得到订阅、却永远收不到事件
    //   ⇒ `main.ts` 的"断线就重连"（A5）与"通道 open 之后补发 hello"（J-2）一起失效。
    reattachStatus();
    /**
     * ★ T11-B：新链路建好之后，若**已经**落在"等面"那一格就把"要面"那件事当场问下去
     * （重连回来的加入方就是这种）。
     *
     * 为什么要这一句：那一格**不会有**下一次入站（它在等玩家按芯片）⇒ 只在 `driveOnce` 里问，
     * 这条路上就永远没人问。为什么复用 `driveOnce()` 而不是另开一个"只问面"的口：
     * 相位→动作的对照只许有一个消费者，多一个入口就是第二份真相；而这一格上它做的事**只有**
     * 要面这一件（没有别的消息可发）。
     *
     * ⚠️ 条件写死"加入方 + 等面那一格"：不带条件地驱动会在握手各格上顺手发消息
     * （那是 `onInbound` 的活，不是建链路这一步的活）。
     */
    if (link.role === 'guest' && link.session.phase() === 'awaiting-commit-ack') link.driveOnce();
    s.transport = link.transportStatus();
    s.peer = link.session.peerStatus();
    // `init()` 只报**本侧**链路（D18）⇒ 失败时把它的真因显示出来，但**不**据此说"对端不在"
    if (!started.ok) s.notice = started.message;
    // 建链路那一刻就把读数读一次（否则第一帧 peerStatus() 是 'idle' 时的旧值）
    syncNow();
  };

  return {
    state: (): LobbyState => ({
      role: s.role,
      // ★ T11-B：相位从当前链路读（没有链路 = 'idle'），给 `data-net-phase` 用
      phase: s.link?.session.phase() ?? 'idle',
      sessionId: opts.sessionId,
      invite: s.invite,
      joined: s.joined,
      roomCodeInput: s.roomCodeInput,
      roomCodeGate: s.roomCodeGate,
      transport: s.transport,
      peer: s.peer,
      endpoint: opts.signalingEndpoint,
      ice: iceOf(),
      advancedOpen: s.advancedOpen,
      // ★ G5 T15：区里那一小块 TURN 的展开状态（默认收起，见初值那一处）
      relayOpen: s.relayOpen,
      // ★ G5 T15：最近一次 init() 的结论（跨 connect 的记忆，见 LobbyState.linkInit）
      linkInit: s.linkInit,
      waitExpired: s.waitExpired,
      error: s.error,
      notice: s.notice,
      routedIn: linkOf()?.routedIn() ?? 0,
      routedOut: linkOf()?.routedOut() ?? 0,
      helloSent: linkOf()?.helloSent() ?? false,
      helloDiag: `${linkOf()?.helloDiag?.() ?? '（没有链路）'} | in=${String(linkOf()?.routedIn() ?? -1)}`
        + ` out=${String(linkOf()?.routedOut() ?? -1)}`,
      answerCode: s.answerCode,
      answerApplied: s.answerApplied,
    }),

    startHost: async (draft: LobbyDraftInput): Promise<void> => {
      s.role = 'host';
      s.error = null;
      s.invite = await opts.buildInvite(draft);
    },

    joinWithInvite: (payload: string): Promise<void> => applyInvite(payload),

    readFromAddressBar: async (): Promise<void> => {
      const read = opts.readAddressBar();
      if (read === null) return; // 地址栏里没有邀请码：**不抹**（别把别人的 hash 抹掉）
      await applyInvite(read.payload);
      void read.stripped;
    },

    setRoomCode: (text: string): void => { s.roomCodeInput = text; },

    submitRoomCode: (): void => {
      s.role = 'guest';
      const endpoint = opts.signalingEndpoint;
      // ① 端点判定（**纯配置**：`roomCodeEntryReachability` 不发请求、不校验能否连上）
      const gate = roomCodeEntryReachability(endpoint);
      if (!gate.ok) {
        // ★ 这句提示**逐字**来自 `NO_ENDPOINT_MESSAGE`（本文件不写第二份）
        s.roomCodeGate = gate.message;
        s.notice = gate.message;
        s.error = null;
        opts.onNotice?.(s.notice);
        return;
      }
      // ② 归一化（字符表与归一化只有 `src/net/protocol.ts` 那一处，D12）
      const norm = normalizeRoomCode(s.roomCodeInput);
      if (!norm.ok) {
        s.roomCodeGate = norm.message;
        s.notice = norm.message;
        opts.onNotice?.(s.notice);
        return;
      }
      // ③ 频道名（唯一出处 `roomChannel`）⇒ 到这里为止**一个网络对象都没构造**
      const ch = roomChannel(norm.code);
      s.roomCodeGate = ch.ok ? `房间码 ${norm.code} 已规范化；频道 ${String(ch.channel)}。` : ch.message;
      s.notice = null;
      s.error = null;
      beginWait();
      opts.onNotice?.(null);
    },

    toggleAdvanced: (): void => { s.advancedOpen = !s.advancedOpen; },

    /** ★ G5 T15：TURN 三项那一小块的折叠（只管显示；判定仍在 `readIceServers()`） */
    toggleRelay: (): void => { s.relayOpen = !s.relayOpen; },

    settingsValue: (key: SettingKey): string => settings[key],

    setSetting: (key: SettingKey, value: string): void => { settings[key] = value; },

    settingKeys: SETTING_KEYS,

    endpoint: (): string => opts.signalingEndpoint,

    noteError: (key: LobbyErrorKey): void => {
      s.error = key;
      s.notice = null;
    },

    showNotice: (text: string | null): void => { s.notice = text; },

    /**
     * ★★ G5 T13-C：作废上一条链路那一次交接的四样产物（理由与边界写在接口上）。
     * 它是**纯清理**：不建链路、不动会话、不驱动任何流程。
     */
    invalidateHandshakeArtifacts: (): void => {
      s.invite = null;
      s.joined = null;
      s.answerCode = null;
      s.answerApplied = null;
    },

    connect,
    /**
     * ★★ **断线之后重建链路**（A5 的入口）。**模式由"有没有可续的对局"决定**（协调者 2026-09-20
     * 第 2 条裁决）：
     *  - 已经进过牌桌（`hasResumableGame() === true`）⇒ `'resume'`：声明重连、要档案追平；
     *  - **还没进牌桌** ⇒ `'first'`：**重新来一次握手**。
     *    为什么不能也走 `'resume'`：那一格房主手里**没有档案**（还没 `netGame`）⇒
     *    `acceptResyncReq` 回 `'resync-not-wired'` 且不动相位，而 `markResuming` 已经把加入方钉在
     *    `resuming` ⇒ 加入方**永久停在"正在把这一局追平"**（不报错的死挂，报告 §6 第 1 条那个洞）。
     *    开局期本来就没有"进度"可续 ⇒ 重来一次握手是唯一诚实的退路。
     */
    reconnect: (): Promise<void> => connect(opts.hasResumableGame?.() === true ? 'resume' : 'first'),

    attach: (link: LobbySessionLink): void => {
      s.link = link;
      currentLink = link;
      lastLinkSessionId = link.session.sessionId();
      s.transport = link.transportStatus();
      s.peer = link.session.peerStatus();
      reattachStatus();
    },

    onStatus: (cb: (to: TransportStatus) => void): (() => void) => {
      statusWatchers.add(cb);
      return () => { statusWatchers.delete(cb); };
    },

    sendHello: (): boolean => s.link?.sendHello() ?? false,

    helloSent: (): boolean => s.link?.helloSent() ?? false,

    // ── ★★ G5 T13-A/B 的三个转发口（没有链路时一律"没做成"，不假装成功）──────────────
    redrivenCount: (): number => s.link?.redrivenCount() ?? 0,
    suppressesCoinScreen: (): boolean => s.link?.suppressesCoinScreen() ?? false,
    requestResync: (): boolean => s.link?.requestResync() ?? false,
    noteResyncNeeded: (cause, detail): boolean => {
      const link = s.link;
      if (link === null) return false;
      const r = link.session.noteResyncNeeded(cause, detail);
      return r.ok;
    },
    applyResync: (file: MatchFile, statesAtStep: number): boolean =>
      s.link?.applyResync(file, statesAtStep) ?? false,
    knowsSession: (sessionId: string): boolean => lastLinkSessionId !== null && lastLinkSessionId === sessionId,

    commitmentVerified: (): boolean | null => {
      const link = s.link;
      if (link === null || link.session.role !== 'guest') return null;
      return link.session.commitmentVerified();
    },

    canMakeAnswer: (): boolean => opts.buildAnswer !== undefined && s.joined?.ok === true,

    /**
     * ★ T11-B：硬币屏要的读数。**没有链路**那一格：没接上就没有"本端角色"（`null`），
     * 相位是 `'idle'`（`SessionPhase` 的初值），两个 side 都是 `null` —— 屏据这三件事
     * 画出的必然是"还没有硬币屏"，而不是一个假装已经接上的空壳。
     */
    role: (): 'host' | 'guest' | null => s.link?.role ?? null,
    phase: (): SessionPhase | 'idle' => s.link?.session.phase() ?? 'idle',
    chosenSide: (): CoinSide | null => s.link?.chosenSide() ?? null,
    landedSide: (): CoinSide | null => s.link?.landedSide() ?? null,
    peerChosenSide: (): CoinSide | null => s.link?.peerChosenSide() ?? null,
    verdictReady: (): boolean => s.link?.verdictReady() ?? false,
    winnerReady: (): boolean => s.link?.winnerReady() ?? false,
    canChooseFace: (): boolean => s.link?.hasFaceChooser() ?? false,
    callerSeat: (): PlayerId => s.link?.callerSeat() ?? (opts.seat ?? 1),
    selfSeat: (): PlayerId => s.link?.selfSeat() ?? (opts.seat ?? 1),
    seedOfSession: (): string | null => s.link?.seedOfSession() ?? null,

    /**
     * ★★ **T11-C：把握手链路交出去**（`LobbyClient.handoff` 的判据写在接口上）。
     *
     * 实现只有一件事：把**已经算好的**那一组数拼出来。这里**没有**任何"到哪一步了"的第二个
     * 真相源 —— `ready` 是三条读数当场算的（相位 / `winnerReady` / 落点），`draftStarter`
     * 是那一份规则（`src/app/coin.ts`）当场算的。
     *
     * ⚠️ 两条纪律，都写在这里免得下一个人顺手写错：
     *  1. **`chosen` 必须按角色取**（房主读对端揭示的面、加入方读自己叫的面）——
     *     拿 `landedSide()` 代替它会让"叫中/叫错"永远判成叫中（T11-B 修复轮的那个缺陷）；
     *  2. **`seat` 是本端座位、`caller` 是叫面者座位**，两者在两端**恰好相反**
     *     （真浏览器实测：房主 selfSeat=0 / caller=1；加入方 selfSeat=1 / caller=1）。
     */
    handoff: (): LobbyHandoff => {
      const link = s.link;
      if (link === null) {
        return { ready: false, transport: null, session: null, seat: opts.seat ?? 1, role: opts.role, phase: 'handshaking', seed: null, draftStarter: null, caller: opts.seat ?? 1, chosen: 1, landed: 1 };
      }
      const role = link.role;
      const caller: PlayerId = link.callerSeat();
      const chosen: CoinSide = (role === 'host' ? link.peerChosenSide() : link.chosenSide()) ?? 1;
      const seed = link.seedOfSession();
      const phase = link.session.phase();
      const landed: CoinSide = seed === null ? 1 : coinLanding(seed);
      const ready = phase === 'complete' && link.winnerReady() && seed !== null;
      return {
        ready,
        transport: ready ? link.transport : null,
        session: ready ? link.session : null,
        seat: link.selfSeat(),
        role,
        phase,
        seed: ready ? seed : null,
        draftStarter: ready ? draftStarterFor(caller, chosen, seed) : null,
        caller,
        chosen,
        landed,
      };
    },

    /**
     * ★★ **按相位把承诺-揭示流程驱动到"本端暂时没东西可发"为止**（C 轮；结构缺口 ②）。
     *
     * 为什么是循环而不是发一条：`driveOnce()` 一次只发一条（那是"读数→一条动作"的干净形态），
     * 而流程里有几格的**下一步是"发另一条"**（例如加入方收到 `commit` 之后要先回 `commit-ack`、
     * 再发自己的 `commit-face` —— 两步之间不需要等对端）。
     * 其余各格会**自然停住**（"等对端"的相位 `driveOnce()` 返回 `false`）⇒ 循环必然终止。
     *
     * ⚠️ 它**不存任何状态**：循环条件是"这一格还能发出东西吗"，不是"我们走到第几步了"。
     */
    drive: (): number => {
      const sent = driveToFixedPoint();
      // 驱动完把读数重读一遍（相位可能已经变了，屏上那句要跟上）
      syncNow();
      return sent;
    },

    transport: (): NetTransport | null => s.link?.transport ?? null,

    /**
     * ★ **收方产回示码**（B3）：拿邀请码里那条 offer 去产 answer。
     *
     * 三种"这条路今天不可用"都返回 `false`（**不抛**），且屏上不出现那个按钮：
     *  ① 还没解出一条邀请码；② 宿主没注入 `buildAnswer`；③ 产 answer 失败（真因写进 `notice`）。
     */
    makeAnswer: async (): Promise<boolean> => {
      const build = opts.buildAnswer;
      const joined = s.joined;
      if (build === undefined || joined === null || !joined.ok) return false;
      const r = await build({ sdp: joined.payload.sdp, ice: joined.payload.ice });
      if (!r.ok) {
        s.answerCode = null;
        s.notice = r.message;
        opts.onNotice?.(r.message);
        return false;
      }
      s.answerCode = r.code;
      /**
       * ★★ **G5 T16**：收方那条路上界到点放行时，屏上也必须留一句如实的话
       * （"只拿到这些候选、跨网能不能连还不知道"）。正常收完时它是 `undefined` ⇒ 回到 `null`
       * （即"没有额外的话要说"，不是"清掉别的提示"——`notice` 此刻本来就没有别的来源）。
       */
      s.notice = typeof r.note === 'string' && r.note.length > 0 ? r.note : null;
      opts.onNotice?.(s.notice);
      return true;
    },

    /**
     * ★ **房主把回示码粘回来**（B3）：解出 answer，喂进同一条连接。
     *
     * ★ G5/T17：与邀请码**同形状** ⇒ 第一步同样走 `pasteShapeOf`（整条链接也收得下），
     * 失败文案同样分形态。
     *
     * 解不开 / 没注入 `applyAnswer` ⇒ `false`，并把真因写进 `notice`（屏上能看见）。
     */
    submitAnswerCode: async (code: string): Promise<boolean> => {
      const apply = opts.applyAnswer;
      if (apply === undefined) return false;
      const shape = pasteShapeOf(code.trim());
      if (shape.kind === 'link-without-fragment') {
        s.answerApplied = { ok: false, message: LINK_WITHOUT_FRAGMENT_ANSWER_MESSAGE };
        return false;
      }
      const text = shape.payload.trim();
      if (text.length === 0) {
        s.answerApplied = { ok: false, message: '回示码是空的：请把对方发来的整条回示码完整粘贴进来。' };
        return false;
      }
      // 回示码与邀请码**同形状** ⇒ 共用同一套解码（`decodeInviteText` + 真正的两步解压）
      const compressed = text.slice(text.indexOf('.') + 1);
      const bytes = text.includes('.') ? await opts.decompressBase64(compressed) : null;
      const dec = decodeInviteText(text, (b64) => (b64 === compressed && bytes !== null ? bytes : null));
      if (!dec.ok) {
        s.answerApplied = { ok: false, message: dec.message };
        return false;
      }
      // ★ 形状自证：它**应当**是一条回示码（两个承诺位是那个具名占位串）。
      //   不是 ⇒ 说明玩家贴错了东西（把邀请码贴上来了），给一句能读懂的真因。
      if (!isAnswerPayload(dec.payload)) {
        s.answerApplied = {
          ok: false,
          message: '这条不是对方回示的答案，而更像一条邀请码：请确认你贴的是对方在加入之后给你的那条回示码。',
        };
        return false;
      }
      const r = await apply({ sdp: dec.payload.sdp });
      s.answerApplied = r.ok ? { ok: true, message: '已经把对方的答案接上了。' } : { ok: false, message: r.message };
      return r.ok;
    },

    sync: (): void => { syncNow(); },

    startWait: (): void => { beginWait(); },

    dispose: (): void => {
      clearWait();
      s.link?.detach();
      s.link = null;
    },

    /** ★ G5 T15：最近一次 `init()` 的结论（只读；写入点是 `connect()` 里 `init()` 回来的那一刻） */
    linkInitDiagnostic: (): LobbyLinkInitDiagnostic | null => s.linkInit,

    /** ★ G5 T15：清掉那个读数（宿主在"要重新等一次链路"之前调，免得带上一次失败的结论） */
    clearLinkInitDiagnostic: (): void => { s.linkInit = null; },
  };
}

/* ==================================================================== *
 * 6.5 硬币屏的读数（T11-B）
 * ==================================================================== */

/**
 * ★★ **本端这一刻在硬币屏上该看到什么**（`null` = 还没有硬币屏，照旧画大厅那一屏）。
 *
 * ## 为什么它住在这一层（修复轮从 `main.ts` 搬过来的）
 *
 * 它是"从客户端读数算出一帧硬币屏"的**唯一**一处，而它此前长在 `src/main.ts` 里 ——
 * 那个文件一 import 就会把整个游戏跑起来（要真 DOM），**node 里测不了** ⇒ 这条链路上
 * 最要命的那一格（"先选协议者用哪一面算"）只有真浏览器门一条腿，而那条腿是抽样的。
 * 搬到这里之后，`tests/ui/net-lobby-coin-consensus.test.ts` 能用**真客户端 + 假传输**
 * 直接跑它，把"两端算出的先选协议者必须相同"钉成 node 腿。
 *
 * ## 什么时候才该有硬币屏（D27 那条顺序约束在屏上的样子）
 *
 *  - **没有注入 `chooseFace` 的调用方**：恒 `null` —— 没有"要面"这条路，屏上就不该出现硬币屏；
 *  - **房主**（等待方）：从它发完 `commit`（`awaiting-commit-face`）起，到走完 `complete` 为止；
 *  - **加入方**（叫面方）：从 `awaiting-commit-ack`（它该叫面那一格）起。
 *
 * ## 三条判据只在这里算一次
 *
 *  - `caller` = **叫面者的座位**（两端读同一个数：加入方读自己、房主读对端）；
 *  - `landed` = `coinLanding(种子)`（两端同一条规则）；
 *  - `chosen` = **叫出去的那一面**（加入方读自己叫的、房主读对端揭示的）——
 *    ⚠️ 它**不是**落点：拿落点当它会让房主永远算"叫中了"（真浏览器门实测的那个缺陷）。
 *  - `winner` 与 `chosen` 一样只在**胜负依据齐了**（`winnerReady()`）之后才给，否则交 `null`
 *    （屏上不定格），免得两端在各自"更早到手"的那一半上定格出两个相反读数。
 *
 * ## 两个注入的回调（宿主给行为，这一层只给读数）
 *
 *  - `choose`：玩家按了某一枚芯片（只有 `role === 'caller'` 会调）；
 *  - `onChosen`：叫完之后**驱动一次**（面是异步到的，而驱动循环是同步的；缺这一下，
 *    屏上看着正常、握手永远不走 —— 真浏览器门实测）。
 */
export function lobbyCoinViewOf(
  client: LobbyClient,
  hooks: { readonly choose: (side: CoinSide) => void; readonly onChosen: () => void },
): CoinNetView | null {
  if (!client.canChooseFace()) return null; // 没有"要面"的能力 ⇒ 屏上不出现硬币屏
  /**
   * ★★ **G5 T13-A：重连链路上不弹硬币屏**（用户裁决 2026-09-20："重连**不重掷硬币**"）。
   *
   * 硬币在断线之前就定过了：那条链路上的面是**旧链路记下的那一面**（`driveOnce` 的
   * `awaiting-commit-ack` 那一格），而这一帧屏只需要继续往下走 —— 再画一次硬币屏等于
   * 让玩家以为又要掷一次（哪怕算出来的落点一样）。⇒ 判定放在**最前面**，
   * 与"有没有要面能力"同族（都是"这一帧该不该有硬币屏"的输入）。
   */
  if (client.suppressesCoinScreen()) return null;
  const role = client.role();
  if (role === null) return null;
  const phase = client.phase();
  const verdictReady = client.winnerReady();
  const caller: PlayerId = client.callerSeat();
  /**
   * ★★ 先选协议者用到的那一面（**叫出去的那一面**，不是落点）：
   * 加入方读自己叫的、房主读对端在 `reveal-face` 里揭示的。
   */
  const chosenForVerdict: CoinSide | null = role === 'host' ? client.peerChosenSide() : client.chosenSide();
  const seed = client.seedOfSession();
  const ready = verdictReady && chosenForVerdict !== null && seed !== null;
  const landed = ready ? client.landedSide() : null;
  const winner: PlayerId | null = ready && landed !== null
    ? draftStarterFor(caller, chosenForVerdict, seed)
    : null;
  if (ready && landed !== null) {
    /**
     * ★★ **跨端判据读的就是它**（真浏览器门 ③.5）：在"胜负依据齐了"的**那一帧**把四个读数
     * 挂到 `globalThis.__coinInputs`（`caller` / `chosen` / `landed` / `winner`，后两个都是**座位**）。
     *
     * 两端的重画时刻不同 ⇒ 只读"此刻的文案"可能读到一个**瞬时**帧；工具据此比读数，
     * 再比"文案里那个 `玩家 N` 是否等于各自 `winner + 1`"（全局座位编号：玩家 1 = 座位 0）。
     * 它**不改文案、不占屏**（与 `data-net-phase` 同族）。
     */
    const g = globalThis as { __coinReady?: boolean; __coinInputs?: Record<string, unknown> };
    g.__coinReady = true;
    g.__coinInputs = { role, caller, chosen: chosenForVerdict, landed, winner, seed, phase };
  }
  if (role === 'host') {
    // 房主：发完承诺（`awaiting-commit-face`）就在等对方叫面；走完 `complete` 也还在这块屏上
    if (phase !== 'awaiting-commit-face' && phase !== 'face-committed' && phase !== 'complete') return null;
    return {
      role: 'waiter',
      phase,
      choose: () => { /* 等待方没有可点的东西（`renderCoin` 也把芯片禁掉了） */ },
      chosen: null,
      landed,
      winner,
      caller,
    };
  }
  // 加入方：`awaiting-commit-ack` 之后的每一格都属于"它该叫面 / 已经叫了"那一族
  if (phase !== 'awaiting-commit-ack' && phase !== 'face-committed' && phase !== 'seed-revealed'
    && phase !== 'reveal-salt-sent' && phase !== 'complete') return null;
  return {
    role: 'caller',
    phase,
    choose: (side) => { hooks.choose(side); hooks.onChosen(); },
    chosen: client.chosenSide(),
    landed,
    winner,
    caller,
  };
}

/* ==================================================================== *
 * 7. 渲染（整屏屏；默认不渲染的东西**不进 DOM**）
 * ==================================================================== */

/** `renderNetLobby` 的接缝：`nav.state` 是**唯一**的输入 */
export interface LobbyRenderNav {
  state: LobbyState;
  backHome(): void;
  startHost(): void;
  startJoin(): void;
  makeInvite(): void;
  /** 邀请码长度读数的唯一取值路径（`inviteLengthReport`）；本文件不写区间常量 */
  inviteLength(payload: string): string;
  /** 二维码占位说明的唯一出处（`qrPlaceholder().note`） */
  qrNote(): string;
  setRoomCode(text: string): void;
  submitRoomCode(): void;
  joinWithInvite(text: string): void;
  toggleAdvanced(): void;
  /** ★ G5 T15：区里的「中继（TURN）」那一小块展开 / 收起（三项输入框默认不渲染） */
  toggleRelay(): void;
  settingsValue(key: SettingKey): string;
  setSetting(key: SettingKey, value: string): void;
  /** 错误文案的取值口（本文件的 `errorCopy`）；渲染层不自己写文案 */
  errorText(key: LobbyErrorKey): string;
  /** ★ C3：加入方点「出示回示码」⇒ 产一条回示码（产完屏上会显示它） */
  makeAnswerCode(): void;
  /** ★ C3：房主点「用这条回示码接上」⇒ 把粘进来的回示码应用掉 */
  applyAnswerCode(code: string): void;
}

/* ==================================================================== *
 * 7b. ★★ G5 T18：一键复制（那串载荷 / 整条链接）
 * ==================================================================== */

/**
 * 剪贴板的最小结构面（**只写**：本文件不读剪贴板）。
 *
 * ⚠️ 这是 `src/ui/**` 里**允许**碰浏览器 API 的那一层 —— `src/net` / `src/app` 的纯净约束
 * 不管这里（扫描面见 `tests/net/net-purity.test.ts`、`tests/app-purity.test.ts`）。
 * 这一层碰它的理由：`navigator.clipboard` **只**在浏览器里有，而"复制"是纯界面动作。
 */
export interface ClipboardWriter {
  writeText(text: string): Promise<void>;
}

/**
 * 取浏览器的剪贴板；取不到就回 `null`（**不抛**）。
 *
 * 取不到是**正常情况**之一：非 https / localhost 的页面、老浏览器、被策略关掉的实现。
 * 那种时候屏上给的是"没有剪贴板接口"那一句，而不是假装复制成功。
 */
export function browserClipboard(): ClipboardWriter | null {
  const nav = (globalThis as { navigator?: { clipboard?: ClipboardWriter } }).navigator;
  const c = nav?.clipboard;
  return c !== undefined && typeof c.writeText === 'function' ? c : null;
}

/** 复制成功那一句（短、说人话；`what` 是"邀请码 / 回示码 / 链接"） */
export function copyOkText(what: string): string {
  return `已复制${what}。`;
}

/** 浏览器**明确拒绝**（不给剪贴板权限，或写失败）那一句：如实说 + 给出退路 */
export function copyDeniedText(): string {
  return '复制不了（浏览器不给剪贴板权限），请手动全选复制。';
}

/** 这台浏览器**根本没有**剪贴板接口那一句（非 https / localhost 的页面很常见） */
export function copyUnavailableText(): string {
  return '复制不了（这个页面没有剪贴板接口；不是 https 或 localhost 时常见），请手动全选复制。';
}

/**
 * 复制一段文本，并把**如实**的结论写进 `status`（那一行就是屏上的读数）。
 *
 * 三个分支，一个都不许含糊：
 *  - 真写进去了（`writeText` 的 Promise resolve 了）⇒ `copyOkText`；
 *  - 浏览器拒了 / 写失败 ⇒ `copyDeniedText`（**绝不假装成功**）；
 *  - 没有剪贴板接口 ⇒ `copyUnavailableText`。
 *
 * ⚠️ `clipboard` 是**参数**（缺省取浏览器真件）⇒ 三个分支都能在 node 的 DOM 桩上真跑一遍。
 */
export async function copyTextWithStatus(
  text: string,
  what: string,
  status: HTMLElement,
  clipboard: ClipboardWriter | null = browserClipboard(),
): Promise<boolean> {
  if (clipboard === null) {
    status.textContent = copyUnavailableText();
    return false;
  }
  try {
    await clipboard.writeText(text);
  } catch {
    status.textContent = copyDeniedText();
    return false;
  }
  status.textContent = copyOkText(what);
  return true;
}

/**
 * 尽力把那个节点的文字**选中**（复制失败时的退路：玩家按 Ctrl+C 就能拿走）。
 *
 * 选不中就算了 —— 那一行本来就是可手选的，这里只是替他省一步。**不抛**。
 */
function selectNodeContents(node: HTMLElement): void {
  const g = globalThis as {
    getSelection?: () => { removeAllRanges(): void; addRange(r: unknown): void } | null;
    document?: { createRange?: () => { selectNodeContents(n: unknown): void } };
  };
  try {
    const range = g.document?.createRange?.();
    if (range === undefined) return;
    range.selectNodeContents(node);
    const sel = g.getSelection?.() ?? null;
    if (sel === null) return;
    sel.removeAllRanges();
    sel.addRange(range);
  } catch { /* 选不中就算了（无头 / 没有 selection 的环境） */ }
}

/**
 * "复制某个东西"的那个按钮（**一键复制的唯一形状**）：点了之后 `status` 那一行是唯一读数。
 *
 * 失败时顺带把 `source` 的文字选中，并且**绝不**把状态改成成功。
 */
function copyButton(
  cls: string, label: string, text: string, what: string, status: HTMLElement, source: HTMLElement,
): HTMLButtonElement {
  return button(`btn net-lobby-copy ${cls}`, label, () => {
    void copyTextWithStatus(text, what, status).then((ok) => {
      if (!ok) selectNodeContents(source);
    });
  });
}

function el(tag: string, cls: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(cls: string, label: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.className = cls;
  b.type = 'button';
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}

/** 一行文本（状态行 / 提示行 / 错误行的统一形状） */
function line(cls: string, text: string): HTMLElement {
  return el('p', cls, text);
}

/** 一个输入框 + 它的输入回报 */
function textInput(cls: string, value: string, onInput: (v: string) => void): HTMLInputElement {
  const input = document.createElement('input');
  input.className = cls;
  input.type = 'text';
  input.value = value;
  input.addEventListener('input', () => { onInput(String(input.value)); });
  return input;
}

/**
 * 画出大厅这一屏（**整屏屏**：调用方先清 root，本函数自己也清一次）。
 *
 * 形态照 `local-consent.ts:23-24`：**不是** `position:fixed` 覆盖层 —— 本仓有过
 * `document.body` 级浮层残留的惨痛历史。所以"本函数只碰它自己的 root"是一条可断言的事实。
 *
 * ## 这一帧画什么（逐块，与五件义务对齐）
 *
 *  1. 标题 + 返回；玩家没选角色之前只有"建房 / 加入"两条路；
 *  2. 建房：邀请码（链接 + 载荷 + 长度读数）+ 二维码**占位**（`qrPlaceholder()`，不实现编码器）；
 *  3. 加入：短码输入框（端点为空时那句提示**逐字**来自 `NO_ENDPOINT_MESSAGE`）+ 粘贴邀请码；
 *  4. 连接状态：`lobbyLinkText(peerStatus)` 那一句（读数同源）；
 *  5. 「高级 / 连接设置」折叠区：**默认折叠**（内容不进 DOM），展开后才有 TURN 三项与那句中继说明。
 */
export function renderNetLobby(root: HTMLElement, nav: LobbyRenderNav): void {
  root.textContent = '';
  root.classList.remove('screen-home');
  const s = nav.state;
  const screen = el('div', 'net-lobby-screen');
  /**
   * ★ **把相位挂成属性**（T11-B）：大厅那一屏本来就画着「会话相位：…」那一行，
   * 但硬币屏（`src/ui/home.ts` 的 `renderCoin` 联机分支）没有那一行 ——
   * 真浏览器门在硬币屏上要读"握手走到哪一格"就只剩这个口。
   * 与下面的 `data-hello-diag` 同一套做法：**不占屏、不改文案、不参与任何判定**。
   */
  screen.setAttribute('data-net-phase', s.phase ?? 'idle');
  /**
   * ★ **诊断读数挂在属性上**（T8-E）：不占屏、不改文案、不参与任何判定 —— 只是让
   * `document.querySelector('.net-lobby-screen').dataset.helloDiag` 一次就能读到
   * "加入方那条 `hello` 走到哪一步"（这类缺口在屏上本来是**完全看不见**的）。
   */
  if (typeof s.helloDiag === 'string' && s.helloDiag.length > 0) {
    screen.setAttribute('data-hello-diag', s.helloDiag);
  }
  screen.appendChild(el('h1', 'net-lobby-title', '联机对战'));
  screen.appendChild(button('btn-link net-lobby-back', '← 返回模式选择', nav.backHome));

  /* ── 1. 还没选角色：两个入口 ────────────────────────────────────── */
  if (s.role === null) {
    const pick = el('div', 'net-lobby-pick');
    // ★ **零手写信令/隐私说明**（修复轮；评审 §4.2 判第一版这里是 §2 第 6 条的违例）：
    //   屏上这一句是 `src/net/invite.ts` 的 `NO_ENDPOINT_REASON` —— "本程序默认不向任何服务器
    //   发请求"这句话的**唯一出处**。大厅只**引用**它，不另写一份（判据 1 的引用纪律）。
    pick.appendChild(el('p', 'net-lobby-note', NO_ENDPOINT_REASON));
    pick.appendChild(button('btn net-lobby-host', '建房（生成邀请码）', nav.startHost));
    pick.appendChild(button('btn net-lobby-join', '加入（粘贴邀请码 / 输 6 位码）', nav.startJoin));
    screen.appendChild(pick);
  }

  /* ── 2. 房主：邀请码 ───────────────────────────────────────────── */
  if (s.role === 'host') {
    const box = el('div', 'net-lobby-invite');
    box.appendChild(el('h2', 'net-lobby-h2', '把这条邀请码发给对方'));
    if (s.invite === null) {
      box.appendChild(button('btn net-lobby-make-invite', '生成邀请码', nav.makeInvite));
    } else if (!s.invite.ok) {
      // 生成失败的原因来自宿主（压缩能力缺失之类），本文件只转发它
      box.appendChild(line('net-lobby-error', s.invite.message));
    } else {
      /**
       * ★★ **G5 T18：屏上只出现一次那条可复制的载荷，复制靠按钮。**
       *
       * 用户真机实测的两件事：① 那一块"不好复制"（屏上先是 `http://…/#invite=…` 那条链接，
       * 载荷跟在后面）；② 同一串码**显示了两遍**（链接的 fragment 里一遍、载荷那一行一遍）。
       * 现在：`.net-lobby-invite-payload` 那一行是**唯一**显示载荷的地方，紧挨着
       * 「复制邀请码」；链接形态退到**默认折叠的小字**里（`.net-lobby-invite-link` 的正文
       * 一字未变 —— T17 让对手可以直接粘整条链接，真浏览器门读的就是它）。
       */
      const payloadLine = line('net-lobby-invite-payload', s.invite.payload);
      const copyStatus = line('net-lobby-copy-status', '');
      box.appendChild(payloadLine);
      // 长度读数**只能**来自 T7 的唯一取值路径（判据 9：本文件里零命中那两个区间数）
      box.appendChild(el('p', 'net-lobby-invite-length', nav.inviteLength(s.invite.payload)));
      const row = el('div', 'net-lobby-copy-row');
      row.appendChild(copyButton('net-lobby-copy-invite', '复制邀请码', s.invite.payload, '邀请码', copyStatus, payloadLine));
      const linkLine = line('net-lobby-invite-link', s.invite.link);
      row.appendChild(copyButton('net-lobby-copy-link', '复制链接', s.invite.link, '链接', copyStatus, linkLine));
      box.appendChild(row);
      box.appendChild(copyStatus);
      const more = el('details', 'net-lobby-invite-link-more');
      more.appendChild(el('summary', 'net-lobby-invite-link-summary', '链接形态（也可以把整条链接发过去）'));
      more.appendChild(linkLine);
      box.appendChild(more);
    }
    // 二维码形态**只留占位**（D17）：编码器另开任务，本文件不许实现它
    box.appendChild(el('p', 'net-lobby-qr-note', nav.qrNote()));
    screen.appendChild(box);
  }

  /* ── 3. 加入方：短码 + 粘贴邀请码 ──────────────────────────────── */
  if (s.role === 'guest') {
    const box = el('div', 'net-lobby-join-box');

    const codeBox = el('div', 'net-lobby-code');
    codeBox.appendChild(el('h2', 'net-lobby-h2', '输 6 位房间码'));
    codeBox.appendChild(textInput('net-lobby-code-input', s.roomCodeInput, nav.setRoomCode));
    codeBox.appendChild(button('btn net-lobby-code-submit', '用这个房间码连接', nav.submitRoomCode));
    // ★ 端点为空时的那句提示：**逐字**来自 `NO_ENDPOINT_MESSAGE`（本文件不写第二份）
    if (s.roomCodeGate !== null) codeBox.appendChild(line('net-lobby-code-gate', s.roomCodeGate));
    box.appendChild(codeBox);

    const pasteBox = el('div', 'net-lobby-paste');
    pasteBox.appendChild(el('h2', 'net-lobby-h2', '粘贴邀请码'));
    pasteBox.appendChild(textInput('net-lobby-paste-input', '', (v) => { nav.joinWithInvite(v); }));
    // ★ G5/T17：三种形态都能粘的那句短提示（正文只有 `PASTE_SHAPE_HINT` 一处）
    pasteBox.appendChild(el('p', 'net-lobby-paste-hint', PASTE_SHAPE_HINT));
    if (s.joined !== null && !s.joined.ok) {
      pasteBox.appendChild(line('net-lobby-error', s.joined.message));
    }
    box.appendChild(pasteBox);

    // ── ★ C3：加入方的「出示回示码」 ────────────────────────────────────────────
    // 为什么需要这一块：B3 的"回示码"在产出代码里已经能产，但**界面上没有入口**
    // ⇒ 玩家看不到它，那条路等于不存在（T9 任务书作者挖出的结构缺口 ③）。
    const ansBox = el('div', 'net-lobby-answer');
    ansBox.appendChild(el('h2', 'net-lobby-h2', '把回示码发回给房主'));
    if (s.answerCode === null) {
      ansBox.appendChild(button('btn net-lobby-make-answer', '出示回示码', nav.makeAnswerCode));
    } else {
      /**
       * 载荷本体（与邀请码同形状）；房主把它粘回来。
       *
       * ★ G5 T18：与邀请码那一块同款 —— 屏上**只出现一次**这条码，复制走「复制回示码」
       * （回示码没有链接形态，所以这里只有那一个按钮）。
       */
      const codeLine = line('net-lobby-answer-code', s.answerCode);
      const ansStatus = line('net-lobby-copy-status', '');
      ansBox.appendChild(codeLine);
      ansBox.appendChild(copyButton('net-lobby-copy-answer', '复制回示码', s.answerCode, '回示码', ansStatus, codeLine));
      ansBox.appendChild(ansStatus);
    }
    box.appendChild(ansBox);
    screen.appendChild(box);
  }

  // ── ★ C3：房主那一栏的「粘贴对方的回示码」 ────────────────────────────────
  if (s.role === 'host') {
    const back = el('div', 'net-lobby-answer-back');
    back.appendChild(el('h2', 'net-lobby-h2', '对方回示之后：粘贴回示码'));
    back.appendChild(textInput('net-lobby-answer-input', '', (v) => { nav.applyAnswerCode(v); }));
    if (s.answerApplied !== null) {
      back.appendChild(line(s.answerApplied.ok ? 'net-lobby-notice' : 'net-lobby-error', s.answerApplied.message));
    }
    screen.appendChild(back);
  }

  /* ── 4. 连接状态（读数同源） ───────────────────────────────────── */
  if (s.peer !== null) {
    const st = el('div', 'net-lobby-status');
    st.appendChild(el('h2', 'net-lobby-h2', '连接状态'));
    st.appendChild(line('net-lobby-link', lobbyLinkText(s.peer)));
    st.appendChild(line('net-lobby-phase', `会话相位：${s.peer.phase}`));
    screen.appendChild(st);
  } else if (s.transport !== 'idle') {
    // ⚠️ `transport.status()` **不是**"对端在线"（D18）：它只报本侧链路。
    // 所以这一格刻意不说"已连上对端"，只说本侧链路到了哪一步。
    screen.appendChild(line('net-lobby-phase', `本机链路：${s.transport}（这只表示本侧，不代表对端在）`));
  }

  /* ── 4b. 错误路径 / 可读提示 ───────────────────────────────────── */
  if (s.error !== null) {
    screen.appendChild(line('net-lobby-error', nav.errorText(s.error)));
  }
  if (s.notice !== null) screen.appendChild(line('net-lobby-notice', s.notice));

  /* ── 5.「高级 / 连接设置」折叠区（默认折叠 ⇒ 内容不进 DOM） ────── */
  const adv = el('div', 'net-lobby-advanced');
  const toggle = button('btn-link net-lobby-advanced-toggle', '高级 / 连接设置', nav.toggleAdvanced);
  toggle.setAttribute('aria-expanded', s.advancedOpen ? 'true' : 'false');
  adv.appendChild(toggle);
  if (s.advancedOpen) {
    // ★ **默认不渲染**而不是渲染好再藏（判据 7 的注意项 + `local-consent.ts:111-113` 同款纪律）：
    // 无布局引擎的 DOM 桩分不出 `display:none` 与"已展开"，那样行为腿会退化成恒真。
    const panel = el('div', 'net-lobby-advanced-panel');
    // ★ **零手写信令说明**（修复轮）：端点那两行是 `src/net/invite.ts` 的两个导出常量。
    //   第一版这里手写了"没有它时「输 6 位码」这条路走不了，邀请码不受影响" —— 那是**第二份**
    //   信令说明（评审 §4.2 判 §2 第 6 条违例），现在改成引用。
    panel.appendChild(el('h3', 'net-lobby-h3', '信令端点'));
    panel.appendChild(el('p', 'net-lobby-endpoint', s.endpoint.length === 0
      ? NO_ENDPOINT_HEADLINE
      : `已配置信令端点：${s.endpoint}`));
    panel.appendChild(el('p', 'net-lobby-endpoint-reason', NO_ENDPOINT_REASON));
    panel.appendChild(el('h3', 'net-lobby-h3', '中继（TURN）'));
    /**
     * ★★ **G5 T15：这一小块默认收起**（普通玩家不该看见三个空输入框）。
     *
     * 收起时屏上**只留一句"不用管"**：说清默认走哪条路、什么时候才需要自建中继，
     * 并给一个显式开关（"我要用自建中继（TURN）"）展开那三项。
     *
     * ⚠️ **D22**：这里**不写**任何隐私承诺 —— 中继那句隐私说明的唯一出处是
     * `src/app/privacy.ts:111`，启用之后由下面那句 `relayNoticeOf(s.ice)` 原样引用进来。
     * 本块新增的只是"要不要展开这三个框"的操作说明。
     */
    const relayShown = s.relayOpen === true;
    panel.appendChild(el('p', 'net-lobby-relay-hint', '不用管这一块：默认走直连 + 公共 STUN，'
      + '绝大多数情况够用。只有直连不通（比如两边都在管得很严的网络里）才需要自建中继。'));
    const relayToggle = el('label', 'net-lobby-relay-toggle');
    const relayBox = document.createElement('input');
    relayBox.type = 'checkbox';
    relayBox.className = 'net-lobby-relay-toggle-box';
    relayBox.checked = relayShown;
    relayBox.addEventListener('change', () => { nav.toggleRelay(); });
    relayToggle.appendChild(relayBox);
    relayToggle.appendChild(el('span', 'net-lobby-relay-toggle-label', '我要用自建中继（TURN）'));
    panel.appendChild(relayToggle);
    if (relayShown) {
      // 展开之后才渲染那三项（同"默认不渲染"纪律：桩上分不出 `display:none` 与"已展开"）
      panel.appendChild(el('p', 'net-lobby-relay-hint',
        '要填就得三项齐全（URL、用户名、凭据）。'));
      appendField(panel, 'net-lobby-turn-url', 'TURN URL', 'turnUrl', nav);
      appendField(panel, 'net-lobby-turn-user', 'TURN 用户名', 'turnUsername', nav);
      appendField(panel, 'net-lobby-turn-cred', 'TURN 凭据', 'turnCredential', nav);
    }
    // ★ 启用（或配了一半）之后让玩家**看见**那句：文案本体逐字来自 `src/app/privacy.ts:111`
    // （D22：本文件一个字都不许改写它，也不许再加第二句）
    // ★ G5 T15：收起时**也照旧**说 —— 收起只影响那三个输入框显不显示，不影响判定
    //   （三项齐不齐仍由 `readIceServers()` 判）。填过的值不会被这个开关抹掉。
    const relay = relayNoticeOf(s.ice);
    if (relay !== null) panel.appendChild(line('net-lobby-relay-note', relay));
    adv.appendChild(panel);
  }
  screen.appendChild(adv);
  root.appendChild(screen);
}

/** 连接设置的三项共用一种形状：标签 + 输入框（写回的落点是 `nav.setSetting`） */
function appendField(
  host: HTMLElement,
  cls: string,
  label: string,
  key: SettingKey,
  nav: LobbyRenderNav,
): void {
  const row = el('label', `net-lobby-field ${cls}`);
  row.appendChild(el('span', 'net-lobby-field-label', label));
  row.appendChild(textInput(`${cls}-input`, nav.settingsValue(key), (v) => { nav.setSetting(key, v); }));
  host.appendChild(row);
}

/* ==================================================================== *
 * 8. 转发口（唯一出处都在别的模块里；本文件只把它们的结论搬给渲染层）
 * ==================================================================== */

/** 邀请码长度读数的**唯一**组装处（区间由 T7 给；本文件不写那两个数） */
export function inviteLengthText(chars: number, withinMeasuredRange: boolean): string {
  return `这条邀请码 ${chars} 个字符；${withinMeasuredRange
    ? '落在实测区间内。'
    : '不在实测区间内（比实测的长或短）—— 仍然可用，但可能被某些聊天工具截断，发送时注意。'}`;
}

/** 二维码占位说明（`qrPlaceholder()` 的唯一出口；本文件不实现编码器） */
export function qrNote(): string {
  return qrPlaceholder().note;
}

/**
 * 一条裸载荷的**明文协议版本**（载荷的形状是 `<协议版本>.<压缩段>`，T7 已登记的偏离）。
 *
 * 它只**取数**；比对与那句话归 `protocolVersionCheck`（见 `errorCopy`）。
 */
export function protoOfPayload(payload: string): { ok: true; proto: number } | { ok: false; message: string } {
  const dot = payload.indexOf('.');
  if (dot <= 0) {
    return { ok: false, message: '这不是一条邀请码：它没有"协议版本.压缩段"这个两段结构。' };
  }
  const head = payload.slice(0, dot);
  const n = Number(head);
  if (!Number.isInteger(n) || n <= 0) {
    return { ok: false, message: `邀请码的协议版本段不是一个正整数（读到 ${JSON.stringify(head)}）。` };
  }
  return { ok: true, proto: n };
}

/** 链接组装（`inviteLinkOf` 的唯一出口；本文件不拼 `#invite=` 字面量） */
export function linkOf(originAndPath: string, payload: string): string {
  return inviteLinkOf(originAndPath, payload);
}





