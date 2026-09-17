/**
 * 联机线协议 `protocol.ts`（G5 T1；见 `docs/2026-09-17-G5-传输层联机-实现计划.md` §5 T1、
 * 设计稿 `docs/2026-09-13-联机与多端-设计稿.md` §5.1 / §5.2 / §5.3）。
 *
 * 本模块是**纯层的第一块**：只有纯数据与纯函数。它受 `tests/net/net-purity.test.ts` 的
 * 生成式守卫（与 `tests/app-purity.test.ts` 同构）：不碰浏览器 API、不取随机、不读时钟、
 * 不直呼定时器、不 import `src/ui/**`、不 import `node:*`。
 *
 * ## 三条裁决直接落在本模块上（改代码前先读这三条）
 *
 * - **D12（房间码）**：6 位 Crockford Base32，字符表**剔除** `I` `L` `O` `U`，字符表只有这一处。
 *   归一化对含混淆字符的输入**明确拒绝** —— **不许**把 `I/L/O/U` 静默映射成 `1/1/0/0`：
 *   静默映射会让两个不同的码落进同一个频道（`K7M2QI` 与 `K7M2Q1` 变成同一局），
 *   而玩家看到的是"我明明输入的是这个码"。
 * - **D15（承诺哈希是注入能力）**：本模块**不算哈希**。`commit.hash` / `reveal-*` 里的串
 *   一律当作"调用方已经算好的不透明字符串"透传。理由有两条，第二条更硬：
 *   ① `crypto` 是浏览器 API，纯层禁用（§2 第 2 条）；
 *   ② `crypto.subtle.digest` 是**异步**的 —— 状态机一旦自己调它就被迫变成异步，
 *      而"`seed` 不得早于 `commit-face`"这条本阶段唯一可机器判定的安全属性会被锁进异步时序里。
 * - **D13（校验顺序）**：`validateHello` 的判定顺序 = 设计稿 `:460-465` 的 1→4，
 *   顺序本身由判据钉住（`tests/net/protocol.test.ts` 判据 1）。顺序决定玩家看到**哪一句**提示：
 *   版本不一致比"位满"更该先说 —— 位满是"换个房间"就能解决的事，版本不一致是"换个房间也没用"。
 *
 * ## 失败一律用**结果对象**，不抛
 *
 * `encodeMsg` / `decodeMsg` / `normalizeRoomCode` 的失败形态都是返回值（照 `parseMatchFile`
 * `src/app/match-file.ts:395` 的取舍：调用方要能区分失败形态**并给不同文案**，异常只能带一句话）。
 *
 * ⚠️ **唯一的例外是 `roomCodeFromRandom` 的"呼叫方违约"**（随机源返回越界值）：那不是
 * "网络来的输入"，而是**调用方**违反了本模块写明的契约，属编程错误，用 `throw` 响亮暴露
 * （静默夹紧会悄悄给出一个偏斜的房间码，而"为什么这个码老是撞"将无法调试）。
 * 网络字节永远走 `decodeMsg` / `normalizeRoomCode` 的结果对象。
 */

import type { PlayerId } from '../core/models/types';
import type { MatchFile } from '../app/match-file';

/* ------------------------------------------------------------------ *
 * 1. 版本与理由码
 * ------------------------------------------------------------------ */

/**
 * 线协议版本。两端 `hello.protoVersion` 不相等即拒绝（设计稿 `:452` / `:462`）。
 *
 * 它与 `MATCH_FILE_VERSION`（`src/app/match-file.ts:17`）是**两个独立的版本号**：前者管
 * "两端说同一种话"，后者管"档案格式怎么读"。改任何一个都不要顺手改另一个 —— 档案格式没变
 * 而线协议变了（或反过来）都是真事。
 */
export const PROTO_VERSION = 1;

/** 房间码长度（设计稿 §5.1：6 位） */
export const ROOM_CODE_LENGTH = 6;

/** 信令频道名前缀（设计稿 `:439`：`compile-v1/<房间码>`） */
export const ROOM_CHANNEL_PREFIX = 'compile-v1/';

/**
 * `decodeMsg` 的失败形态。四个值**互不相同**，逐个给出触发它的**事实**：
 *  - `'not-json'`：文本根本不是 JSON（或为空）。含"截断"—— 截断的 JSON 必然不是合法 JSON。
 *  - `'not-an-object'`：是合法 JSON，但顶层不是对象、或缺一个可用的 `t`。
 *  - `'unknown-type'`：`t` 是一个本协议**不认识**的字符串。
 *  - `'proto-version'`：`t` 认识，但消息自带的 `protoVersion` 与本机不符（设计稿 `:462`）。
 */
export type DecodeReason = 'not-json' | 'not-an-object' | 'unknown-type' | 'proto-version';

/** `encodeMsg` 的失败形态（今天只有一个：对象长得不像它自称的那条消息） */
export type EncodeReason = 'bad-shape';

/** 房间码未通过归一化的两种形态：含混淆字符 / 既不是 6 位也不是 32 个合法字符 */
export type RoomCodeReason = 'ambiguous-char' | 'bad-charset';

/**
 * `validateHello` 的拒绝理由。四个值**与设计稿 `:460-465` 的四步一一对应**，且判定顺序
 * 就是下面这个顺序（TS 字面量顺序只影响阅读，真正的顺序在 `validateHello` 的函数体里，
 * 由判据 1 钉住）。
 *  - `'proto-version'`：1. 版本不一致
 *  - `'card-data-hash'`：2. 卡牌数据指纹不一致
 *  - `'player-slots-full'`：3. 玩家位已满（设计稿写 `busy`，指**主机回 `busy` 这条消息**，
 *    不是指理由码要叫 `busy` —— 理由码要能分辨"哪一种满"，否则判据 1 的
 *    "同时违反两条时返回靠前那条"根本没法测）
 *  - `'spectator-slots-full'`：4. 观战位已满
 */
export type HelloRejectReason = 'proto-version' | 'card-data-hash' | 'player-slots-full' | 'spectator-slots-full';

/* ------------------------------------------------------------------ *
 * 2. 消息联合类型
 * ------------------------------------------------------------------ */

/**
 * 握手（设计稿 §5.2 `:448-457`，形状照抄）。
 *
 * `role` 里 `'spectator'` 是**合法值但 G5 从不放行**（裁决 D5）：拒绝发生在会话层
 * （`NetSession`），不在这里 —— 校验顺序的第 4 步("观战位已满")属于本模块，第 3/4 步之后的
 * "G5 不支持观战"那一步要有第 3 步之前的信息才能判，属于会话层。两处都不是"忘了写"。
 */
export interface HelloMsg {
  t: 'hello';
  role: 'player' | 'spectator';
  /** 本局唯一 id，重连时用它找回（会话作用域，**不进 `MatchFile`**，裁决 D2） */
  sessionId: string;
  protoVersion: number;
  /** 卡牌数据指纹（§3.4）。本机值从 `src/app/card-data-hash` 取，由调用方传入（纯层不 import 它） */
  cardDataHash: string;
  seat: PlayerId;
  /** 昵称只在此处交换（设计稿 `:455`：端到端加密，不走信令明文） */
  nick: string;
  resuming?: boolean;
}

/** 主机接受握手（`seat` 是**主机替加入方定的座位**，加入方以它为准） */
export interface HelloAckMsg {
  t: 'hello-ack';
  protoVersion: number;
  seat: PlayerId;
  /** 对手昵称（本机自己的 `nick` 不回给自己） */
  peerNick: string;
  /** 主机此刻认为的"这场对局的身份"，与 `hello.sessionId` 相等或被拒绝 */
  sessionId: string;
}

/** 主机拒绝握手。`reason` 就是 `validateHello` 给出的那个可读理由码 */
export interface BusyMsg {
  t: 'busy';
  reason: HelloRejectReason | 'unsupported';
  detail: string;
}

/**
 * `commit` 只承载**种子承诺**（设计稿 §5.3 第 2 步 `:472`：`hash: sha256(seed + salt)`）。
 *
 * 为什么不用"一个 `commit` 消息 + 一个 `type` 字段"同时承载选面承诺：`commit-face` 的**方向**
 * 与 `commit` 相反（房主发 `commit`、加入方发 `commit-face`，见 D3），把两者塞进一条消息
 * 会让"谁该发哪条"在类型层面消失 —— 而"选面者必须是加入方"正是 D3 要在类型和状态机两层钉住的东西。
 * `hash` 一律是**调用方算好的**不透明串（D15），本模块不碰它。
 */
export interface CommitMsg {
  t: 'commit';
  hash: string;
}

/** 加入方确认收到 `commit`（设计稿 §5.3 第 3 步 `:473`） */
export interface CommitAckMsg {
  t: 'commit-ack';
}

/** 加入方提交正/反的承诺（设计稿 `:481`）—— 它**必须先于** `reveal-seed`（D3 / §5.3 警告） */
export interface CommitFaceMsg {
  t: 'commit-face';
  hash: string;
}

/** 房主揭示种子。**收到它时只能验面，还不能验承诺**（设计稿 `:474`） */
export interface RevealSeedMsg {
  t: 'reveal-seed';
  seed: string;
}

/** 加入方在结束后揭示面与 nonce（设计稿 `:481`） */
export interface RevealFaceMsg {
  t: 'reveal-face';
  face: 0 | 1;
  faceNonce: string;
}

/** 房主在结束后揭示 salt ⇒ `sha256(seed + salt)` 可验（设计稿 `:475`） */
export interface RevealSaltMsg {
  t: 'reveal-salt';
  salt: string;
}

/** 从机请求追平（重连用；主机以 `resync-res` 回一份档案，设计稿 `:497`） */
export interface ResyncReqMsg {
  t: 'resync-req';
  sessionId: string;
  /** 从机自称已应用到第几步（主机据此判断要不要真的传档案；权威值仍是档案里那一步） */
  appliedSteps: number;
}

/** 主机回一份**当前档案**（设计稿 `:497`：`resync-res { MatchFile }`） */
export interface ResyncResMsg {
  t: 'resync-res';
  file: MatchFile;
}

/**
 * 一步操作（锁步：两端都跑引擎，只交换操作指令 —— 裁决 D1 / 设计稿裁决 #7）。
 *
 * `seq` 与 `action.seq` 必须相等：前者是"线序"，后者是"档案里的位置"。重复写的理由是
 * 接收方能**在解析这一步就发现错位**（`action` 被截断成 `{}` 时 `action.seq` 是 `undefined`，
 * 而 `seq` 还在），而不是把错位带到引擎里变成一次不报错的分叉。
 */
export interface ActMsg {
  t: 'act';
  seq: number;
  action: { seq: number; player: PlayerId; kind: string; args?: unknown };
}

/** 主动道别。`paused` = 切后台（设计稿 `:513`：隐藏时主动发 `bye{paused}`），不是离开对局 */
export interface ByeMsg {
  t: 'bye';
  reason: 'paused' | 'leave';
}

/**
 * 投降（裁决 D4：本阶段**只定消息与双方收尾语义**，引擎动作留给 G6）。
 *
 * 收尾语义（写在这里，因为它是协议的一部分而非实现细节）：收到 `forfeit` 的一方**立即**把
 * 对局标记为结束、`winner` = 未投降的一方，写进档案的 `result`；不需要对方确认，也不存在
 * "撤回"。`reason` 里的 `'timeout'` 今天**没有任何发送方**（它是 G6 回合计时的形态，D4 明写），
 * 留着是因为 union 变宽是 API 变更、而 G6 就在下一段 —— 它不是"将来谁会用到"的猜测，
 * 是设计稿 `:42` 已经把它绑给 §14.7 的既定事实。
 */
export interface ForfeitMsg {
  t: 'forfeit';
  reason: 'resign' | 'timeout';
}

export type NetMsg =
  | HelloMsg
  | HelloAckMsg
  | BusyMsg
  | CommitMsg
  | CommitAckMsg
  | CommitFaceMsg
  | RevealSeedMsg
  | RevealFaceMsg
  | RevealSaltMsg
  | ResyncReqMsg
  | ResyncResMsg
  | ActMsg
  | ByeMsg
  | ForfeitMsg;

/** `NetMsg['t']` 的取值集合（**唯一出处**：`NetMsg` 变了这里必须跟着变，见 `MSG_TYPES` 的用法） */
export type NetMsgType = NetMsg['t'];

/**
 * 全部已知消息类型。
 *
 * ⚠️ **必须用 `Record<NetMsgType, true>` 声明**：这样给 `NetMsg` 加一条消息而忘了登记时，
 * tsc 当场报"缺属性"（`Record` 的键是穷尽的）。若写成 `['hello', …] as const` 数组，
 * 漏登记只会表现为"新消息解码时被判成未知类型"—— 那是一个**运行期**才暴露、且看起来像
 * "对端发错东西"的假象。
 */
const MSG_TYPES: Record<NetMsgType, true> = {
  hello: true,
  'hello-ack': true,
  busy: true,
  commit: true,
  'commit-ack': true,
  'commit-face': true,
  'reveal-seed': true,
  'reveal-face': true,
  'reveal-salt': true,
  'resync-req': true,
  'resync-res': true,
  act: true,
  bye: true,
  forfeit: true,
};

/* ------------------------------------------------------------------ *
 * 3. 房间码（D12）
 * ------------------------------------------------------------------ */

/**
 * Crockford Base32 字符表，**剔除** `I` `L` `O` `U`（设计稿 `:438`）。
 * 32 个字符，逐个数得出来：`0-9` 十个 + `A-Z` 二十六个 − 四个混淆字符 = 32。
 *
 * 剔除理由（Crockford 的原始理由，与本仓相关的部分）：`I`/`L` 与 `1` 难分、`O` 与 `0` 难分；
 * `U` 被剔除是为了避免拼出脏词（对房间码无影响，但保持"就是 Crockford 表"这件事只有一种解释，
 * 免得下一个人来问"为什么单剔 U"）。
 */
export const ROOM_CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** 混淆字符：**必须拒绝**，不许静默映射（D12 的理由见文件头） */
const AMBIGUOUS_CHARS = 'ILOU';

/**
 * 生成一个房间码。
 *
 * **随机来源由调用方注入**（§2 第 2 条：纯层禁用 `Math.random`）——
 * `randomness` 的契约是"返回 `[0, 1)` 的均匀值"，逐位取一次，共 `ROOM_CODE_LENGTH` 次。
 * 生产侧传 `() => { const b = new Uint8Array(1); crypto.getRandomValues(b); return b[0] / 256; }`
 * （住在 `src/ui/net-browser.ts`），测试侧传确定序列。
 *
 * ⚠️ `randomness` 返回越界值（`< 0` / `>= 1` / `NaN`）时**抛错**：那是调用方违约，
 * 不是网络输入。静默夹紧会给出一个偏斜的码而没有任何迹象（见文件头末段）。
 */
export function roomCodeFromRandom(randomness: () => number): string {
  let out = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i += 1) {
    const v = randomness();
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v >= 1) {
      throw new Error(
        `roomCodeFromRandom 的随机源返回了越界值 ${String(v)}（契约是 [0, 1) 的均匀值）；` +
          '这里不夹紧，因为夹紧会静默产出一个偏斜的房间码。',
      );
    }
    out += ROOM_CODE_ALPHABET[Math.floor(v * ROOM_CODE_ALPHABET.length)];
  }
  return out;
}

/**
 * 从一段**字节**生成房间码（`roomCodeFromRandom` 的姊妹口，给"手上已经有随机字节"的调用方）。
 *
 * 每字节取模 32。⚠️ 256 是 32 的整数倍 ⇒ **没有取模偏斜**（这是它优于"字节 / 256 再乘 32"的地方：
 * 后者在浮点上仍均匀，但多一次无谓的除法与一次越界风险）。
 * 字节不足 `ROOM_CODE_LENGTH` 时返回失败结果（**不抛**：字节可能来自网络或剪贴板，
 * 与"网络来的输入不抛"同一条纪律）。
 */
export function roomCodeFromBytes(bytes: Uint8Array): RoomCodeResult {
  if (bytes.length < ROOM_CODE_LENGTH) {
    return {
      ok: false,
      reason: 'bad-charset',
      message: `随机字节不足：需要 ${ROOM_CODE_LENGTH} 个，只拿到 ${bytes.length} 个。`,
    };
  }
  let out = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i += 1) {
    out += ROOM_CODE_ALPHABET[bytes[i] % ROOM_CODE_ALPHABET.length];
  }
  return { ok: true, code: out };
}

/** `roomCodeFromBytes` / `normalizeRoomCode` 的结果union（两者的失败形态是同一族，故共用） */
export type RoomCodeResult = { ok: true; code: string } | { ok: false; reason: RoomCodeReason; message: string };

/**
 * 归一化一个**人输入**的房间码：大小写归一（→ 大写），并做两项校验。
 *
 * 拒绝而不是修的两类输入：
 *  1. 含 `I` `L` `O` `U`（大小写都算）⇒ `'ambiguous-char'`。**这是 D12 的核心**：
 *     静默映射成 `1/1/0/0` 会把两个不同的码指向同一个频道，而玩家以为自己在另一局；
 *  2. 出现两个字符表之外的字符（空格、连字符、中文、标点）或长度不是恰好 6 ⇒ `'bad-charset'`。
 *     不做"去掉空格/连字符再试"的宽容：剪贴板里的房间码由本程序自己产出，宽容处理只会让
 *     "粘错了半行"变成一次**指向错误频道**的连接尝试。
 *
 * 返回的 `code` 恒为**大写**且恒 6 位（判据 2 钉住）。
 */
export function normalizeRoomCode(input: string): RoomCodeResult {
  const up = input.toUpperCase();
  for (const ch of up) {
    if (AMBIGUOUS_CHARS.includes(ch)) {
      return {
        ok: false,
        reason: 'ambiguous-char',
        message:
          `房间码里出现了易混字符 ${ch}（字符表剔除了 I/L/O/U，避免与 1/0 看错）。` +
          '请向对方重新确认这个码，本程序不会替你猜它该是 1 还是 0。',
      };
    }
  }
  if (up.length !== ROOM_CODE_LENGTH) {
    return {
      ok: false,
      reason: 'bad-charset',
      message: `房间码必须是 ${ROOM_CODE_LENGTH} 位，收到 ${up.length} 位。`,
    };
  }
  for (const ch of up) {
    if (!ROOM_CODE_ALPHABET.includes(ch)) {
      return {
        ok: false,
        reason: 'bad-charset',
        message: `房间码里出现了字符表之外的字符 ${JSON.stringify(ch)}（合法字符是 0-9 与 A-Z 去掉 I/L/O/U）。`,
      };
    }
  }
  return { ok: true, code: up };
}

/** 信令频道名（设计稿 `:439`）。房间码非法时返回失败结果，**不**把非法码拼进频道名 */
export function roomChannel(code: string): RoomCodeResult & { channel?: string } {
  const n = normalizeRoomCode(code);
  if (!n.ok) return n;
  return { ok: true, code: n.code, channel: `${ROOM_CHANNEL_PREFIX}${n.code}` };
}

/* ------------------------------------------------------------------ *
 * 4. 编解码（失败一律结果对象）
 * ------------------------------------------------------------------ */

export type EncodeResult = { ok: true; text: string } | { ok: false; reason: EncodeReason; message: string };

export type DecodeResult = { ok: true; msg: NetMsg } | { ok: false; reason: DecodeReason; message: string };

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isStr(v: unknown): v is string {
  return typeof v === 'string';
}

function isSeat(v: unknown): v is PlayerId {
  return v === 0 || v === 1;
}

/** 非负整数（`seq` / `appliedSteps` 的形态） */
function isCount(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0;
}

/**
 * 每种消息的**形状校验**。
 *
 * 为什么需要它（而不是只检查 `t`）：`encodeMsg` 的入参可能来自调用方拼的普通对象
 * （测试、未来的 UI 层），只认 `t` 会让一份 `{ t: 'act' }`（没有 `action`）被安静地编码出去，
 * 对端收到才发现 —— 而那时错误已经跨过网络、离现场很远了。
 * 校验强度是**结构性的最小集**（有哪些键、类型对不对），不是完整业务校验（那是状态机的事）：
 * 这里多写一条就多一份会和状态机漂移的规则。
 */
const SHAPES: { [K in NetMsgType]: (m: Record<string, unknown>) => boolean } = {
  hello: (m) =>
    (m.role === 'player' || m.role === 'spectator') &&
    isStr(m.sessionId) &&
    typeof m.protoVersion === 'number' &&
    isStr(m.cardDataHash) &&
    isSeat(m.seat) &&
    isStr(m.nick) &&
    (m.resuming === undefined || typeof m.resuming === 'boolean'),
  'hello-ack': (m) => typeof m.protoVersion === 'number' && isSeat(m.seat) && isStr(m.peerNick) && isStr(m.sessionId),
  busy: (m) => isStr(m.reason) && isStr(m.detail),
  commit: (m) => isStr(m.hash),
  'commit-ack': () => true,
  'commit-face': (m) => isStr(m.hash),
  'reveal-seed': (m) => isStr(m.seed),
  'reveal-face': (m) => (m.face === 0 || m.face === 1) && isStr(m.faceNonce),
  'reveal-salt': (m) => isStr(m.salt),
  'resync-req': (m) => isStr(m.sessionId) && isCount(m.appliedSteps),
  'resync-res': (m) => isObj(m.file),
  act: (m) => isCount(m.seq) && isObj(m.action) && isCount(m.action.seq) && isSeat(m.action.player) && isStr(m.action.kind),
  bye: (m) => m.reason === 'paused' || m.reason === 'leave',
  forfeit: (m) => m.reason === 'resign' || m.reason === 'timeout',
};

/**
 * 一个名字看起来像消息类型的**非消息**值。
 *
 * 为什么必须显式挡（这是个真会踩的洞）：`(m.t as NetMsgType)` 之后写 `m.t in MSG_TYPES`
 * 会把 `Object.prototype` 上的键也算成"已知类型" —— `{ t: 'toString' }` 于是通过类型检查，
 * 接着 `SHAPES['toString']` 取到的是 `Object.prototype.toString`（一个函数），
 * `SHAPES[t]` 的调用结果恒真 ⇒ 一份垃圾被当成合法消息交给状态机。
 * 判据 3 里 `'toString'` / `'hasOwnProperty'` / `'__proto__'` 三条腿就是钉这个的。
 */
const PROTOTYPE_KEYS = new Set(Object.getOwnPropertyNames(Object.prototype));

/** 用一个**自有属性**判断"这个字符串是不是本协议认识的消息类型" */
function knownType(t: string): t is NetMsgType {
  return Object.prototype.hasOwnProperty.call(MSG_TYPES, t) && !PROTOTYPE_KEYS.has(t);
}

/**
 * "未知消息类型"的可读文案。
 *
 * 抽成独立函数是**为了可读性与可测性**，不是风格：这条文案要在两处被引用
 * （`decodeMsg` 的拒绝、以及将来的诊断/日志），而且它把 `Object.keys(MSG_TYPES).length`
 * （协议有几种消息）写进了给玩家/排查者看的话里 —— 那是一个**会随协议增长而自动更新**的数，
 * 不该在文案里手写死。
 */
function unknownTypeMessage(t: string): string {
  return '未知的消息类型 ' + JSON.stringify(t) + '（本协议有 ' + Object.keys(MSG_TYPES).length + ' 种消息，没有这一种）。';
}

/**
 * 编码：`NetMsg` → 线文本。
 *
 * 失败**不抛**：入参在纯层是 `unknown`（调用方可能传一个从别处来的对象），
 * 所以"长得不像它自称的那条消息"是一个正常结果，而不是编程错误。
 * 编码形态就是 `JSON.stringify(msg)` —— 线协议不引入第二种序列化（`MatchFile` 走
 * `stringifyMatchFile` 的稳定序列化是**档案格式**的事，与线文本无关；线文本只在两端之间活一次，
 * 没有"两份字节要逐字相等"的需求）。
 */
export function encodeMsg(msg: unknown): EncodeResult {
  if (!isObj(msg)) {
    return { ok: false, reason: 'bad-shape', message: '要编码的消息不是对象。' };
  }
  const t = msg.t;
  if (!isStr(t)) {
    return { ok: false, reason: 'bad-shape', message: `消息缺少字符串字段 t（收到 ${JSON.stringify(t)}）。` };
  }
  if (!knownType(t)) {
    return { ok: false, reason: 'bad-shape', message: `要编码的消息类型本协议不认识：${JSON.stringify(t)}。` };
  }
  if (!SHAPES[t](msg)) {
    return { ok: false, reason: 'bad-shape', message: `消息 ${t} 的字段不完整或类型不对，拒绝编码。` };
  }
  return { ok: true, text: JSON.stringify(msg) };
}

/**
 * 解码：线文本 → `NetMsg`。
 *
 * 四种失败**互不相同**（判据 3 逐条钉住），且**都不抛**（`JSON.parse` 被 try 包住）：
 *  - 空串 / 非 JSON / 被截断的 JSON ⇒ `'not-json'`
 *  - 合法 JSON 但顶层不是对象，或缺 `t` ⇒ `'not-an-object'`
 *  - `t` 是字符串但本协议不认识（含 `toString` 这类原型键） ⇒ `'unknown-type'`
 *  - `t` 认识、`protoVersion` 字段在但与本机不符 ⇒ `'proto-version'`
 *
 * ⚠️ **只有 `hello` / `hello-ack` 今天带 `protoVersion`**：其余消息没有这个字段 ⇒ 它们
 * 跳过第 4 步。这不是漏检 —— 版本一致性在握手时已经定下，此后每条消息再带一次版本号是
 * 冗余（而且 `act` 是最热的路径）。设计稿 `:452` 也只把 `protoVersion` 放在 `HelloMsg` 上。
 *
 * 第 4 步用的是**消息自带的值**（而不是 `opts.protoVersion`）—— 后者是"本机版本"，
 * 是拒绝时用来写文案的参照物。两者混起来会让"对端说自己是 v2"和"本机是 v1"变成同一件事，
 * 而文案里要同时说清这两件事。
 */
export function decodeMsg(text: unknown, opts: { protoVersion?: number } = {}): DecodeResult {
  const mine = opts.protoVersion ?? PROTO_VERSION;
  if (!isStr(text)) {
    return { ok: false, reason: 'not-json', message: '收到的不是文本（线协议只传字符串）。' };
  }
  if (text.length === 0) {
    return { ok: false, reason: 'not-json', message: '收到空文本（连接刚建立就被关掉？）。' };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    // 截断落在这里：被切断的 JSON 一定 parse 失败。文案里点名"截断"是因为它是最常见的成因
    // （`act` 走不可靠通道、消息体被切一半），让报错能直接指向排查方向。
    return {
      ok: false,
      reason: 'not-json',
      message: `收到的不是合法 JSON（常见成因：消息被截断、或对端发的是二进制）。原文前 80 字：${text.slice(0, 80)}`,
    };
  }
  if (!isObj(raw)) {
    return { ok: false, reason: 'not-an-object', message: '收到的 JSON 顶层不是对象。' };
  }
  const t = raw.t;
  if (!isStr(t)) {
    return { ok: false, reason: 'not-an-object', message: `消息缺少字符串字段 t（收到 ${JSON.stringify(t)}）。` };
  }
  if (!knownType(t)) {
    return { ok: false, reason: 'unknown-type', message: unknownTypeMessage(t) };
  }
  if (raw.protoVersion !== undefined && raw.protoVersion !== mine) {
    return {
      ok: false,
      reason: 'proto-version',
      message:
        `游戏版本不一致，请双方都更新到最新版（对端协议 v${String(raw.protoVersion)}，本机 v${mine}）。`,
    };
  }
  if (!SHAPES[t](raw)) {
    return {
      ok: false,
      reason: 'not-an-object',
      message: `消息 ${t} 的字段不完整或类型不对（t 认识，但形状不像它）。`,
    };
  }
  return { ok: true, msg: raw as unknown as NetMsg };
}

/* ------------------------------------------------------------------ *
 * 5. 握手校验（D13：顺序照抄设计稿）
 * ------------------------------------------------------------------ */

/** `validateHello` 的输入：一个（可能来自网络的）unknown，加上本机事实 */
export interface HelloContext {
  /**
   * 本机 `PROTO_VERSION`。**显式传入而不是默认读模块常量**：判据 1 要构造"两端版本不同"
   * 的情形，而 `PROTO_VERSION` 是常量 ⇒ 不注入就没法在测试里造出这个场景（这是本仓
   * "能力一律注入"的同一族做法，只不过注入的是配置而不是副作用）。
   */
  localProtoVersion: number;
  /**
   * 本机卡牌数据指纹。
   *
   * **唯一出处是 `src/app/card-data-hash.ts:101` 的 `CARD_DATA_HASH`**（同文件的
   * `cardDataHashOf` 是它的算法，`:48` 的 `HASH_FORMAT_VERSION` 是它的格式版本）。
   * 调用方直接把这个常量喂进来即可（裁决 D7 也允许 `src/net` import `src/app`）。
   *
   * ⚠️ **不要在这里造第二份**：`tests/app/card-data-hash.test.ts` 逐字钉住 `CARD_DATA_HASH`
   * 与现算值相等（`card-data-hash.ts:10`），任何"自己拼一个哈希"的写法都会脱离那条守卫，
   * 变成第二个跨设备契约 —— 而这种漂移只会在两台设备联机失败时才暴露。
   */
  localCardDataHash: string;
  /** 主机此刻据有的**座位占用**（`seat` 的取值就是 `PlayerId`） */
  occupied: { players: readonly PlayerId[]; spectators: readonly PlayerId[] };
  /**
   * **主机替加入方分配座位时必填**；缺省时退回对端自报的 `hello.seat`
   * （那只该用于"只测形状"的调用 —— 生产里座位是主机的决定，见 `HelloAckMsg.seat` 与裁决 D7）。
   *
   * 优先级（`ctx.seat` 赢过 `msg.seat`）由 `tests/net/protocol.test.ts` 的一对负向腿钉住：
   * 两者的值在夹具里必须**不同**，否则优先级不可观测（写成 `msg.seat ?? ctx.seat` 也全绿）。
   */
  seat?: PlayerId;
}

export type HelloValidation =
  | { ok: true; msg: HelloMsg; seat: PlayerId }
  | { ok: false; reason: HelloValidationReason; message: string };

/**
 * 握手校验的完整理由集 = 四条**有顺序**的业务拒绝 + 一条**排在它们之前**的形状拒绝。
 *
 * 形状那条为什么必须单列、且为什么不能混进四条（这是本轮的一处硬决定）：
 * 四条判定都要先读 `hello` 的字段；形状不对时读到的全是 `undefined`，此时回"版本不一致"
 * 是一句**假话** —— 本机并不是因为版本才拒的。玩家会照着假话去更新版本，然后还是连不上。
 * 所以形状失败走 `'bad-shape'`，它的判定位置在四条之前，但它**不占用**四条的顺序。
 *
 * ⚠️ 判据 1 的四条腿因此必须用**形状合法**的 `hello`：一份连 `protoVersion` 都没有的输入
 * 命中的是 `'bad-shape'`，把它当成"第一条腿"会让整条顺序判据变得无法分辨（那种输入在
 * `decodeMsg` 那一层就已经被拦下了，本函数是第二道闸）。
 */
export type HelloValidationReason = HelloRejectReason | 'bad-shape';

/**
 * 握手校验，顺序严格照设计稿 `:460-465` 的 1→4（形状检查排在四条之前，见 `HelloValidationReason`）。
 *
 * **为什么顺序本身要被判据钉住**（D13）：顺序决定玩家看到哪一句。同时违反两条的输入
 * （例如"版本既不对、玩家位又满了"）必须回**靠前**那条 —— 否则玩家会去"换个房间"，
 * 而换了房间版本还是不对。判据 1 专门有一条腿构造这种输入。
 *
 * ⚠️ **`ctx` 是必填的，这里刻意不给默认值**（阶段一评审 N-3 实测的"静默全拒"暗道）：
 * 第一版给了 `{ localProtoVersion: PROTO_VERSION, localCardDataHash: '' }` 这样的默认值，
 * 于是"忘了传 ctx"不会报错，而是**永远**回 `'card-data-hash'`（对端指纹永远不等于空串），
 * 而默认的版本号恰好等于 `PROTO_VERSION` ⇒ 第 1 步拦不住它。症状是"怎么都连不上却看不出原因"。
 * 删掉默认值之后，"必须传全本机事实"从一条口头约定变成**类型事实** —— 调用方漏传就编译不过。
 * （本函数今天没有生产调用方，T3 的会话层才是第一个；测试侧全部走显式夹具，成本为零。）
 */
export function validateHello(input: unknown, ctx: HelloContext): HelloValidation {
  // ---- 第 0 步：形状。它必须排在四条之前 ----
  // 理由：四条判定都要读 `input` 的字段；形状不对时读到的全是 undefined，
  // 回"版本不一致"就是一句假话（本机并不是因为版本才拒的），玩家会照着假话去更新版本。
  // 形状失败**不伪装**成四条里的任何一条，所以它走独立的 `'bad-shape'` 码。
  if (!isObj(input)) {
    return { ok: false, reason: 'bad-shape', message: '握手消息不是对象，无法校验。' };
  }
  if (input.t !== 'hello') {
    return { ok: false, reason: 'bad-shape', message: `握手的 t 必须是 hello（收到 ${JSON.stringify(input.t)}）。` };
  }
  if (input.role !== 'player' && input.role !== 'spectator') {
    return { ok: false, reason: 'bad-shape', message: `hello.role 非法：${JSON.stringify(input.role)}。` };
  }
  if (!isStr(input.sessionId) || input.sessionId.length === 0) {
    return { ok: false, reason: 'bad-shape', message: 'hello.sessionId 必须是非空字符串。' };
  }
  if (typeof input.protoVersion !== 'number') {
    return { ok: false, reason: 'bad-shape', message: 'hello.protoVersion 不是数字。' };
  }
  if (!isStr(input.cardDataHash)) {
    return { ok: false, reason: 'bad-shape', message: 'hello.cardDataHash 不是字符串。' };
  }
  if (!isSeat(input.seat)) {
    return { ok: false, reason: 'bad-shape', message: 'hello.seat 不是 0/1。' };
  }
  if (!isStr(input.nick)) {
    return { ok: false, reason: 'bad-shape', message: 'hello.nick 不是字符串。' };
  }
  if (input.resuming !== undefined && typeof input.resuming !== 'boolean') {
    return { ok: false, reason: 'bad-shape', message: 'hello.resuming 不是布尔值。' };
  }
  const msg = input as unknown as HelloMsg;
  const seat = ctx.seat ?? msg.seat;

  /**
   * 四条有顺序的校验，**顺序就是这张数组的顺序**（D13 / 设计稿 `:460-465` 的 1→4）。
   *
   * ★ **为什么写成"数组 + 顺序遍历"而不是四个并列的 `if`**（这是刻意的，不是风格）：
   * 顺序是本模块最容易被"顺手重排"改掉、而且改掉之后**所有行为腿都不会红**的东西 ——
   * 四个 `if` 互不引用，谁把它们调换一下，单看代码完全看不出问题。写成数组之后：
   *  1. 顺序在**一处**、以行的先后表达；
   *  2. 判据 1 的"靠前那条"腿直接钉住这张数组的效果；
   *  3. 变异 M1（对调顺序）在该数组上是一次**单行对调**，锚点可精确核对（见 `.superpowers/T1/`）。
   * ⚠️ 校验**失败时的文案逐条不同、且要用到各自读到的值**（版本号、指纹串、座位数），
   * 所以每一条是一个返回 `HelloValidation | null` 的闭包，而不是"一个理由码数组 + 一个文案函数"。
   */
  const checks: ReadonlyArray<() => { ok: false; reason: HelloRejectReason; message: string } | null> = [
    // 第 1 步：版本
    () =>
      msg.protoVersion === ctx.localProtoVersion
        ? null
        : {
            ok: false,
            reason: 'proto-version',
            message: `游戏版本不一致，请双方都更新到最新版（对端协议 v${msg.protoVersion}，本机 v${ctx.localProtoVersion}）。`,
          },
    // 第 2 步：卡牌数据指纹
    () =>
      msg.cardDataHash === ctx.localCardDataHash
        ? null
        : {
            ok: false,
            reason: 'card-data-hash',
            message: `卡牌数据版本不一致，无法联机（对端 ${JSON.stringify(msg.cardDataHash)}，本机 ${JSON.stringify(ctx.localCardDataHash)}）。`,
          },
    // 第 3 步：玩家位
    () =>
      msg.role === 'player' && ctx.occupied.players.length >= 2
        ? { ok: false, reason: 'player-slots-full', message: '这个房间的两张牌桌都坐满了（玩家位已满）。' }
        : null,
    // 第 4 步：观战位
    // G5 从不放行观战（裁决 D5），但这一条**仍然要判**：G5 与 G7 的拒绝理由必须是两句不同的话
    // （"房主不支持观战" vs "观战席也满了"），否则 G7 打开观战时会分不清是哪一种。
    // 观战位只有 2 个，规则与玩家位同形。
    () =>
      msg.role === 'spectator' && ctx.occupied.spectators.length >= 2
        ? { ok: false, reason: 'spectator-slots-full', message: '这个房间的观战席也满了（观战位已满）。' }
        : null,
  ];

  for (const check of checks) {
    const rejected = check();
    if (rejected) return rejected;
  }

  return { ok: true, msg, seat };
}
