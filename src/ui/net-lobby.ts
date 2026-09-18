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
  INVITE_PROTO_VERSION,
  decodeInviteText,
  inviteLinkOf,
  protocolVersionCheck,
  qrPlaceholder,
  roomCodeEntryReachability,
} from '../net/invite';
import type { InviteDecodeResult } from '../net/invite';
import { createGuestSession, createHostSession } from '../net/session';
import type { HashLike, NetSession, PeerStatus, SessionInbound, SessionOutbound } from '../net/session';
import { decodeMsg, encodeMsg, normalizeRoomCode, roomChannel } from '../net/protocol';
import type { NetMsg } from '../net/protocol';
import type { NetChannel, NetTransport, TransportStatus } from '../net/transport';
import { PRIVACY_COPY } from '../app/privacy';
import { readIceServers } from './net-browser';
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
 * 大厅的宿主接缝 —— **能力一律注入**。
 *
 * ## 为什么传输是"造一个"的动作而不是现成对象
 *
 * 判据 14 要求**用可注入的假传输**驱动一次完整握手。如果大厅内部直接
 * `createBrowserTransport()`（真 WebRTC），假件就喂不进来 —— 那**正是那条判据要抓的缺陷**，
 * 不是判据要放宽的理由。
 */
export interface LobbyClientOptions {
  /** 本端角色：房主建房、加入方贴邀请码 */
  readonly role: 'host' | 'guest';
  /** 本局 `sessionId`。**由调用方生成**（`src/net` 不许取随机，§2 第 2 条） */
  readonly sessionId: string;
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
   * 造一个**已经 `init` 过**的传输（`NetDriverOptions.transport` 的前置条件）。
   *
   * 生产实现是 `createBrowserTransport(env)`；测试传 `createFakeTransportPair().A.transport`。
   */
  readonly createTransport: () => NetTransport;
  /** 读设置里的信令端点（**纯配置读**，不发请求；唯一出处是 `signalingEndpointSetting`） */
  readonly signalingEndpoint: string;
  /** 读 TURN 三项（读设置的动作；唯一判定处是 `net-browser.ts:431` 的 `readIceServers`） */
  readonly readSettings: () => { readonly turnUrl?: string; readonly turnUsername?: string; readonly turnCredential?: string } | null;
  /** 生成邀请链接（真压缩在浏览器层，是异步的） */
  readonly buildInvite: (draft: LobbyDraftInput) => Promise<MakeInviteResult>;
  /** 解一条裸载荷（`decodeInviteText` 的唯一消费口；真解压由宿主在调用前算好，D15） */
  readonly decompressBase64: (b64: string) => Uint8Array | null;
  /** 读地址栏里的邀请码并**在读到之后**抹掉它（`readInviteFromAddressBar` + `stripInviteFromAddressBar`） */
  readonly readAddressBar: () => InviteRead | null;
  /** 可读提示的搬运口（错误路径 / 短码提示）。`null` = 清空 */
  readonly onNotice?: (text: string | null) => void;
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

/**
 * 判据 3 的**能力边界**（写进注释，照计划 §2 第 15 条）：
 *
 * 它钉的是"这五条路径的文案**两两不同、非空、来源可追**"，**不是**"这五条路径在真网络下
 * 都走得通"。逐条说清：
 *  - `'room-gone'` 有**行为腿**（注入假时钟，走完 8s 窗口）；
 *  - `'proto-version'` 有**行为腿**（喂一条明文版本不一致的载荷，比对 `protocolVersionCheck`）；
 *  - `'card-data-hash'` / `'busy'` / `'spectator'` 今天**只有渲染转发**（文案来自会话层的拒绝原因，
 *    而 T8 不跑真握手）⇒ 它们在真浏览器里能不能被触发属 T9 的 CDP 线与人工验收。
 *
 * 这个边界不是"没做到"，是这条判据**声明的范围**：写成"五条都验过了"才是谎报。
 */
export const ERROR_COPY_BOUNDARY =
  '本表钉的是五条文案互不相同且来源可追；真网络下能否触发属 T9/人工验收。';

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

/** 大厅这一屏的**全部**可显示状态 */
export interface LobbyState {
  /** 本端角色（`null` = 还没选"建房/加入"） */
  readonly role: 'host' | 'guest' | null;
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
  readonly seat?: 0 | 1;
  readonly localProtoVersion: number;
  readonly localCardDataHash: string;
}): LobbySessionLink {
  const session: NetSession = opts.role === 'host'
    ? createHostSession({
      localProtoVersion: opts.localProtoVersion,
      localCardDataHash: opts.localCardDataHash,
      sessionId: opts.sessionId,
      seat: opts.seat ?? 0,
      hash: opts.hash,
    })
    : createGuestSession({
      localProtoVersion: opts.localProtoVersion,
      localCardDataHash: opts.localCardDataHash,
      sessionId: opts.sessionId,
      seat: opts.seat ?? 1,
      hash: opts.hash,
    });

  let inCount = 0;
  let outCount = 0;
  /** 订阅链路状态变化的宿主回调（本路由转发 `NetTransport.onStatus`） */
  const statusListeners = new Set<(to: TransportStatus) => void>();

  /** 发一条会话层产出的消息（通道按消息类型定：只有 `act` 是可靠保序的，D11） */
  function send(msg: NetMsg): void {
    const enc = encodeMsg(msg);
    // 编不出来就不发：形状由会话层定，这里没有能修的余地（`decodeMsg`/`encodeMsg` 都不抛）
    if (!enc.ok) return;
    const channel: NetChannel = msg.t === 'act' ? 'act' : 'beat';
    opts.transport.sendIfOpen(channel, enc.text);
    outCount += 1;
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
   */
  function receive(text: string): boolean {
    const dec = decodeMsg(text, { protoVersion: opts.localProtoVersion });
    if (!dec.ok) return false; // 坏帧不是异常：丢掉这一帧，不抛
    const decision = session.accept({ t: dec.msg.t, msg: dec.msg } as SessionInbound);
    inCount += 1;
    if (!decision.ok) return true;         // 情形 1：被会话层拒了
    if (decision.output === null) return true; // 情形 2：收下了但本端不必回话
    if (dec.msg.t === 'hello') {
      // `hello` 的成功面**直接是** `HelloAckMsg`（不是 `SessionOutbound`）
      send(decision.output as unknown as NetMsg);
    } else {
      send((decision.output as SessionOutbound).msg);
    }
    return true;
  }

  const detachMessages = opts.transport.onMessage((text) => { receive(text); });
  // 会话层**不自己**订阅传输状态（`session.ts:768-776`：订阅是有生命周期的副作用，纯状态机
  // 不持有它）⇒ 调用方转一手，这正是"读数同源"那一半的落点。
  const detachStatus = opts.transport.onStatus((change) => {
    session.noteTransportStatus(change.to);
    for (const cb of statusListeners) cb(change.to);
  });
  return {
    session,
    receive,
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
  note(text: string | null): void;
  /** 接上一条路由（本方法**不**新建会话对象 —— 它是"第一次接上"，不是重连） */
  attach(link: LobbySessionLink): void;
  /**
   * 把链路状态与 T6 的对端读数**重读一遍**（读数同源的那一半）。
   *
   * 为什么要这个口：`peerStatus()` 是**拉**的读数，会话层不推送（`session.ts` 明写"会话层不自己
   * 订阅 `onStatus`"，那是调用方的活）⇒ 宿主在收到帧之后、每次重渲染之前调一次它。
   */
  sync(): void;
  /**
   * 重连：**新建会话对象 + 先声明重连 + 再接上**（顺序见 `createLobbySessionLink` 的注释）。
   *
   * ⚠️ 它**不**复用旧的 `HostSession` / `GuestSession` 实例（D23 的充分性前提，写死了）。
   */
  reconnect(): void;
  /** 起一次"等对端"的窗口（8s 之后置 `waitExpired`） */
  startWait(): void;
  dispose(): void;
}

/** 连接设置里的三个键 */
export type SettingKey = 'turnUrl' | 'turnUsername' | 'turnCredential';

const SETTING_KEYS: readonly SettingKey[] = ['turnUrl', 'turnUsername', 'turnCredential'];

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
    waitExpired: boolean | null;
    error: LobbyErrorKey | null;
    notice: string | null;
    link: LobbySessionLink | null;
  } = {
    role: null,
    invite: null,
    joined: null,
    roomCodeInput: '',
    roomCodeGate: null,
    transport: 'idle',
    peer: null,
    advancedOpen: false,
    waitExpired: null,
    error: null,
    notice: null,
    link: null,
  };

  /**
   * ★ **`advancedOpen` 的初值恰好一处**（变异 M5 的锚点）。
   *
   * 折叠区的内容**默认不渲染**，而不是"渲染好再 `display:none`"：后者在没有布局引擎的
   * DOM 桩上与"已展开"不可区分（判据 7 的注意项），行为腿会退化成恒真。
   * 这条纪律与 `src/ui/consent` 的 `renderPrivacyDetail`（`local-consent.ts:111-113`）同款。
   */
  s.advancedOpen = false;

  let waitHandle: number | null = null;

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
   * 收下一条裸载荷（`joinWithInvite` 与 `readFromAddressBar` **共用**这一份：
   * "收下"的判定只有一处，免得两条入口对同一条载荷给出两种结论）。
   */
  const applyInvite = async (payload: string): Promise<void> => {
    s.role = 'guest';
    s.error = null;
    const text = payload.trim();
    if (text.length === 0) {
      s.joined = { ok: false, reason: 'bad-base64url', message: '邀请码是空的：请把对方发来的整条邀请码完整粘贴进来。' };
      opts.onNotice?.(null);
      return;
    }
    const r = decodeInviteText(text, opts.decompressBase64);
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

  return {
    state: (): LobbyState => ({
      role: s.role,
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
      waitExpired: s.waitExpired,
      error: s.error,
      notice: s.notice,
      routedIn: linkOf()?.routedIn() ?? 0,
      routedOut: linkOf()?.routedOut() ?? 0,
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

    settingsValue: (key: SettingKey): string => settings[key],

    setSetting: (key: SettingKey, value: string): void => { settings[key] = value; },

    settingKeys: SETTING_KEYS,

    endpoint: (): string => opts.signalingEndpoint,

    noteError: (key: LobbyErrorKey): void => {
      s.error = key;
      s.notice = null;
    },

    note: (text: string | null): void => { s.notice = text; },

    attach: (link: LobbySessionLink): void => {
      s.link = link;
    },

    sync: (): void => {
      const link = s.link;
      if (link === null) return;
      s.transport = link.transportStatus();
      s.peer = link.session.peerStatus();
      // 会话层不自己订阅传输状态（`session.ts` 的注释）：那是调用方的活 ⇒ 每次 sync 转发一次。
      link.session.noteTransportStatus(s.transport);
    },

    reconnect: (): void => {
      // ★ **新建会话对象**（不复用旧的实例）：D23 的收方幂等只覆盖 2/5 格，
      //   复用旧对象会让另外 3 格落在没有被幂等保护的相位上（见 `createLobbySessionLink` 的注释）。
      const old = s.link;
      if (old !== null) old.detach();
      const link = createLobbySessionLink({
        role: s.role === 'host' ? 'host' : 'guest',
        transport: opts.createTransport(),
        sessionId: opts.sessionId,
        hash: opts.hash,
        ...(opts.seat === undefined ? {} : { seat: opts.seat }),
        localProtoVersion: opts.localProtoVersion,
        localCardDataHash: opts.localCardDataHash,
      });
      // ★ 顺序写死（`session.ts:925-935` 的示例）：**必须在喂任何入站消息之前**声明重连 —
      //   `acceptHelloAck` 会把相位推离 `handshaking`，此后 `markResuming()` 一律被拒。
      if (link.session.role === 'guest') link.session.markResuming();
      link.session.noteTransportStatus(link.transportStatus());
      s.link = link;
    },

    startWait: (): void => { beginWait(); },

    dispose: (): void => {
      clearWait();
      s.link?.detach();
      s.link = null;
    },
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
  settingsValue(key: SettingKey): string;
  setSetting(key: SettingKey, value: string): void;
  /** 错误文案的取值口（本文件的 `errorCopy`）；渲染层不自己写文案 */
  errorText(key: LobbyErrorKey): string;
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
  screen.appendChild(el('h1', 'net-lobby-title', '联机对战'));
  screen.appendChild(button('btn-link net-lobby-back', '← 返回模式选择', nav.backHome));

  /* ── 1. 还没选角色：两个入口 ────────────────────────────────────── */
  if (s.role === null) {
    const pick = el('div', 'net-lobby-pick');
    pick.appendChild(el('p', 'net-lobby-note',
      '两台设备直连（P2P），不经任何服务器。默认不向任何服务器发请求：没有配置信令端点时用邀请码。'));
    pick.appendChild(button('btn net-lobby-host', '建房（生成邀请码）', nav.startHost));
    pick.appendChild(button('btn net-lobby-join', '加入（粘贴邀请码 / 输 6 位码）', nav.startJoin));
    screen.appendChild(pick);
  }

  /* ── 2. 房主：邀请码 ───────────────────────────────────────────── */
  if (s.role === 'host') {
    const box = el('div', 'net-lobby-invite');
    box.appendChild(el('h2', 'net-lobby-h2', '把这条邀请链接发给对方'));
    if (s.invite === null) {
      box.appendChild(button('btn net-lobby-make-invite', '生成邀请码', nav.makeInvite));
    } else if (!s.invite.ok) {
      // 生成失败的原因来自宿主（压缩能力缺失之类），本文件只转发它
      box.appendChild(line('net-lobby-error', s.invite.message));
    } else {
      // ★ 载荷只进 fragment（判据 6）：`link` 由 `inviteLinkOf` 组装，本文件不碰 query
      box.appendChild(line('net-lobby-invite-link', s.invite.link));
      box.appendChild(line('net-lobby-invite-payload', s.invite.payload));
      // 长度读数**只能**来自 T7 的唯一取值路径（判据 9：本文件里零命中那两个区间数）
      box.appendChild(el('p', 'net-lobby-invite-length', nav.inviteLength(s.invite.payload)));
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
    if (s.joined !== null && !s.joined.ok) {
      pasteBox.appendChild(line('net-lobby-error', s.joined.message));
    }
    box.appendChild(pasteBox);
    screen.appendChild(box);
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
    panel.appendChild(el('p', 'net-lobby-endpoint', s.endpoint.length === 0
      ? '信令端点：没有配置（默认就是这样）。没有它时"输 6 位码"这条路走不了，邀请码不受影响。'
      : `信令端点：${s.endpoint}`));
    panel.appendChild(el('h3', 'net-lobby-h3', '中继（TURN）'));
    panel.appendChild(el('p', 'net-lobby-relay-hint',
      '中继是可选的：不填就只走直连与公共 STUN。要填就得三项齐全（URL、用户名、凭据）。'));
    appendField(panel, 'net-lobby-turn-url', 'TURN URL', 'turnUrl', nav);
    appendField(panel, 'net-lobby-turn-user', 'TURN 用户名', 'turnUsername', nav);
    appendField(panel, 'net-lobby-turn-cred', 'TURN 凭据', 'turnCredential', nav);
    // ★ 启用（或配了一半）之后让玩家**看见**那句：文案本体逐字来自 `src/app/privacy.ts:111`
    // （D22：本文件一个字都不许改写它，也不许再加第二句）
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
