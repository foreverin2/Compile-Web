/**
 * 会话状态机 `session.ts`（G5 T3；见 `docs/2026-09-17-G5-传输层联机-实现计划.md` §5 T3、
 * §4 的 D2 / D3 / D5 / D7 / D8 / D13 / D15、设计稿 `docs/2026-09-13-联机与多端-设计稿.md`
 * §5.2 握手 `:445-465` 与 §5.3 种子承诺 `:467-483`）。
 *
 * ## 本模块存在的理由（一句话）
 *
 * 全阶段唯一**能被机器判定的安全属性**在这里：**`seed` 不得早于 `commit-face` 被揭示**
 * （设计稿 `:479-483` 那段"掷硬币的额外约束"）。做错了不会有任何症状 —— 没有报错、没有红腿，
 * 只是静默地让加入方可以**先看到种子、再挑必胜的那一面**（硬币是种子的纯函数，见下）。
 *
 * ## 为什么这条顺序不能只靠"调用方按顺序调"
 *
 * 硬币结果今天是 `deriveInt(seed, 'coin', 2)`（`src/ui/home.ts:394`，**只吃 seed**，不吃 salt）。
 * 于是"谁先看到 seed"直接等于"谁可以先算出硬币"。若顺序只写在文档里，任何一个调用方
 * （今天的 T5、明天的 UI 接线）把 `reveal-seed` 挪到前面，**没有任何机制会拦住**。
 * 所以顺序落成两处**结构事实**：
 *
 *  1. **相位**（运行期）：`sendRevealSeed()` 只在相位为 `'face-committed'` 时返回成功；
 *     而 `'face-committed'` 只有一条到达路径 —— 房主收到了一条**形状合法的** `commit-face`。
 *     相位是闭包里的私有变量，没有 setter、没有"强行推进"的口子。
 *  2. **类型**（编译期）：`sendRevealSeed()` 只长在**房主**会话上，加入方会话上根本没有这个方法；
 *     反过来 `commitFace()` 只长在加入方会话上。于是"房主自己选面"（D3 明令禁止的那件事）
 *     在**编译期**就写不出来，而不是靠注释提醒。
 *
 * ## 不算哈希（D15）：哈希是**注入能力**，状态机是纯的、同步的
 *
 * 本模块一行 哈希 API 一个都没有（`tests/net/net-purity.test.ts` 的
 * 浏览器 API 腿会当场抓到）。`HashLike` 接口**只此一处定义**（计划 §5.0 的命名表）。
 * 真实实现是 `src/ui/net-browser.ts`（T7）的 `SHA-256 摘要`；测试用纯函数。
 *
 * 为什么这条不能松：`SHA-256 摘要` 是**异步**的。状态机一旦自己调它，整个状态机就被迫
 * 变成异步（相位推进夹在微任务之间），而"seed 不得早于 commit-face"这条判据就会锁进异步时序里 ——
 * 那时"先到"与"后到"要靠 await 的顺序去表达，难测且易错。现在哈希由外部算好喂进来，
 * 相位推进全程同步，一条断言就能钉死顺序。
 *
 * ## 不承诺公平（D3）
 *
 * 种子与 salt 都由**房主自己选**（`src/ui/match-seed.ts:5`、`src/main.ts:1100-1102`），
 * 而硬币是种子的纯函数。所以 `commit { hash(seed+salt) }` **只能**钉住"房主事后不能换洗牌结果"
 * （承诺已发出去，改 seed 就对不上哈希），**钉不住房主事前磨种子** —— 它完全可以离线生成一批
 * 种子、挑一个对自己有利的再承诺，没有任何外部随机源能约束它（裁决 #2 的信任制本来就不防作弊）。
 *
 * ⇒ 本文件（以及将来引用它的玩家文案）里**不许**出现"公平"、"无法作弊"这类承诺。
 * 这里钉住的是一件更小、但真的能做到的事：**加入方在选定正/反之前拿不到 seed**。
 *
 * ## 失败一律返回结果对象，不抛（照 `protocol.ts`）
 *
 * 网络来的输入永远走结果对象（`{ ok: false, reason, message }`），形状与 `protocol.ts` 的
 * `validateHello` 一致；`reason` 是给分支用的契约，`message` 是给人看的一句。
 *
 * **唯一的例外是"调用方违约"**（照 `protocol.ts:29-32` 对 `roomCodeFromRandom` 的取舍）：
 * 调用方自己传了一个空哈希 / 空种子 / 空 salt（或一个返回 `Promise` 的哈希实现），那不是
 * "网络来的输入"，而是编程错误 —— 静默拒绝会让"为什么这局永远开不起来"变成一个查不出来的谜，
 * 所以 `throw` 响亮暴露。网络来的空串则走 `'bad-hash'` / `'bad-seed'` / `'bad-salt'` 结果对象。
 *
 * ## 观战（D5）与重连（D8/T6）
 *
 * - `role: 'spectator'` 是**合法值但 G5 从不放行**：`validateHello` 的四步照走（D13），
 *   之后明确回绝，理由串与"观战席已满"（`spectator-slots-full`）**刻意不同** ——
 *   G7 打开观战时，这两者必须分得清。
 * - `hello.resuming === true` 今天**能通过握手**（重连的凭据就是同一个 `sessionId`），相位进
 *   `'resuming'`，`needsResync` 变 `true`；真正的追平与 `resync-res` 是 T6 的事。
 *   `accept()` 到 `resync-req` 时明确回一句"追平还没接上"，而不是静默吞掉。
 */

import { validateHello } from './protocol';
import type {
  BusyMsg,
  HelloAckMsg,
  HelloMsg,
  HelloRejectReason,
  NetMsg,
  NetMsgType,
} from './protocol';
import type { PlayerId } from '../core/models/types';

/* ------------------------------------------------------------------ *
 * 1. 注入能力：HashLike（D15，全仓只此一处定义）
 * ------------------------------------------------------------------ */

/**
 * 哈希能力（D15）。**由调用方注入**，本模块不算哈希。
 *
 * 契约：把若干段文本按**给定顺序**拼起来的哈希，返回一个不透明字符串。
 * 设计稿 `:472` 写的 `sha256(seed + salt)` 就是 `hash(seed, salt)` —— 拼串细节（分隔符、编码、
 * 是否 hex）**全在实现里**，本模块一个字都不关心，只把返回的串当作不透明值存下与比对。
 *
 * 返回类型允许 `Promise<string>`，是为了让真实实现能把
 * `SHA-256 摘要(...).then(...)` 直接交给它（那是异步 API）。本模块自己是**同步**的：
 * 它在任何地方都不 `await` 注入的实现 —— 拿到 `Promise` 时按"不是一个可用的哈希串"处理
 * （调用方违约 ⇒ `throw`，见文件头）。要同步用，注入一个同步实现（测试就是这么做的）。
 *
 * **同一局里必须用同一个实现**：换一个实现（哪怕算法不变、编码变了）会让已发出的
 * `commit` 与后面的 `reveal` 对不上，而那会表现成"承诺校验失败"，看起来像有人作弊。
 */
export interface HashLike {
  (...parts: readonly string[]): string | Promise<string>;
}

/* ------------------------------------------------------------------ *
 * 2. 结果对象（失败一律返回值）
 * ------------------------------------------------------------------ */

/**
 * 会话层拒绝的理由码。每个值对应一件**不同的事实**，且 `message` 逐条不同 ——
 * 玩家照着 `message` 决定下一步做什么，调用方照着 `reason` 分支。
 *
 * 安全属性相关（判据 1）：
 *  - `'seed-before-face'`：`reveal-seed` 到得太早（加入方的 `commit-face` 还没到）。
 *    这就是设计稿 `:479-483` 要堵的那个洞，是**唯一一条**与安全有关的理由码。
 *  → `'seed-duplicate'` / `'seed-not-expected'` 与它**分开**：重复投递不是安全事件，
 *    报同一句话会把排查方向带偏（"有人在作弊" vs "消息被重发了"）。
 *
 * 承诺校验（判据 2）：
 *  - `'face-hash-mismatch'`：`reveal-face` 的 `hash(face, faceNonce)` 对不上加入方此前的 `commit-face`
 *  - `'salt-hash-mismatch'`：`reveal-salt` 的 `hash(seed, salt)` 对不上房主此前的 `commit`
 *
 * 形状（网络来的空串 / 缺失字段 / 值域不对）：
 *  - `'bad-hash'` / `'bad-seed'` / `'bad-salt'` / `'bad-face'`
 *
 * 状态机不接受的消息：
 *  - `'unexpected-message'`：当前相位不该收到它（含"这条消息的发送方向反了"）
 *  - `'resync-not-wired'`：`resync-req` 到了，但追平要到 T6 才接上
 */
export type SessionRejectReason =
  | 'seed-before-face'
  | 'seed-duplicate'
  | 'seed-not-expected'
  | 'face-hash-mismatch'
  | 'salt-hash-mismatch'
  | 'bad-hash'
  | 'bad-seed'
  | 'bad-salt'
  | 'bad-face'
  | 'unexpected-message'
  | 'resync-not-wired';

/**
 * 握手回绝的理由码 = `validateHello` 自己那五条 + 会话层加的两条。
 *
 * `'unsupported-spectator'` 是会话层加的：`validateHello` 的四步（D13）走完之后才判得出
 * "这是观战、而 G5 不放行"（第 3/4 步"位满"要能先报出来，见 `protocol.ts:92-94`）。
 * `'unexpected-message'` 也是会话层加的：握手**已经完成或已被回绝**时又收到一条 `hello`
 * （重复投递 / 对端重放），它不属于"这次握手的校验结论"，而是"现在不该再握手了"。
 */
export type SessionHelloReason = HelloRejectReason | 'bad-shape' | 'unsupported-spectator' | 'unexpected-message';

/** 会话层的结果对象（成功面各异，失败面统一） */
export type SessionResult<T> = ({ ok: true } & T) | { ok: false; reason: SessionRejectReason; message: string };

/* ------------------------------------------------------------------ *
 * 3. 相位：顺序约束的载体
 * ------------------------------------------------------------------ */

/**
 * 相位。**这是顺序约束唯一的载体** —— 它是闭包里的私有变量，没有 setter，只能由本文件的
 * 几个推进函数改，没有旁路。
 *
 * 两个角色走的是**两套**相位（不是一套），因为两个方向能做的事不一样：
 *
 * | 角色 | 相位推进 |
 * |---|---|
 * | 房主 | `handshaking` → 握手成功 → `awaiting-commit-face` → `sendCommit`（**相位不变**，仍在等对端的承诺）→ 收到 `commit-face` → `face-committed` → `sendRevealSeed` → `seed-revealed` → 收到 `reveal-face` → `complete` |
 * | 加入方 | `handshaking` → 收到 `commit` → `seed-committed` → `sendCommitAck` → `awaiting-commit-face` → `commitFace` → `face-committed` → 收到 `reveal-seed` → `seed-revealed` → `sendRevealFace` → `reveal-salt-sent` → 收到 `reveal-salt` → `complete` |
 *
 * 房主**没有** `awaiting-commit-face` 之外的中转相位：发过 `commit` 之后它等的还是同一样东西
 * （对端的 `commit-face`），多造一个中间相位只会给 `sendRevealSeed()` 的守卫多加一条与安全无关的分支。
 * 同理，加入方也**没有** `'face-committed'` 之外的第二个"可以收种子"的相位。
 *
 * 不过两套相位里都有一个 `'face-committed'`，而它的含义在两边都恰好是"加入方的承诺已经成立"：
 * 房主那边是收到了对端的 `commit-face`，加入方那边是自己发出了 `commit-face`。
 * **`'face-committed'` 就是"允许揭示种子"的唯一相位**（`mayRevealSeed`）。
 */
export type SessionPhase =
  | 'handshaking'
  | 'resuming'
  | 'seed-committed'
  | 'awaiting-commit-face'
  | 'face-committed'
  | 'seed-revealed'
  | 'reveal-salt-sent'
  | 'complete'
  | 'rejected';

/* ------------------------------------------------------------------ *
 * 4. 对外形状
 * ------------------------------------------------------------------ */

/**
 * 收到的**线协议消息**。
 *
 * 为什么把 `t` 绑进参数（而不是 `accept(text: string)` 让本模块自己解码）：解码是
 * `protocol.ts` 的事（它已经有一份带形状校验的 `decodeMsg`），本模块再来一遍就成了第二份判定；
 * 而且本模块只关心**语义顺序**，不关心字节形态。
 * 调用方的真实路径是 `decodeMsg(text)` → 成功则把 `msg` 喂给 `accept`。
 */
export type SessionInbound =
  | { t: 'hello'; msg: unknown }
  | { t: 'commit'; msg: unknown }
  | { t: 'commit-ack'; msg: unknown }
  | { t: 'commit-face'; msg: unknown }
  | { t: 'reveal-seed'; msg: unknown }
  | { t: 'reveal-face'; msg: unknown }
  | { t: 'reveal-salt'; msg: unknown }
  | { t: 'resync-req'; msg: unknown };

/**
 * 会话**要发出去**的一条消息。
 *
 * 用 `{ t, msg }` 而不是直接回 `NetMsg`：调用方拿到之后要把 `msg` 交给 `encodeMsg()`
 * （那是 `protocol.ts` 的唯一编码口），所以这里必须是可以直接喂给它的形状。留一份 `t` 是为了
 * 调用方能按 `t` 分支而不必去窄化联合类型；`t` 与 `msg.t` 在类型上一致，构造点只有一处。
 */
export interface SessionOutbound {
  readonly t: NetMsgType;
  readonly msg: NetMsg;
}

/** 一次 `accept()` 的结论：产出一条要发的消息，或者一条都不发（`output: null`），或者拒绝 */
export type SessionDecision =
  | { ok: true; output: SessionOutbound; phase: SessionPhase }
  | { ok: true; output: null; phase: SessionPhase }
  | { ok: false; reason: SessionRejectReason; message: string; phase: SessionPhase };

/**
 * 握手回绝的结论。`reason` 是给分支用的事实码，`message` 是给人看的那一句，`busy` 是
 * **要发回去的**那条 `busy` 消息（照设计稿 `:464`，位满是回 `busy`）。
 *
 * `phase` 与 `SessionDecision` 的失败面同名同义（回绝之后相位是 `'rejected'`）——
 * 两份形状一致，是为了让 `accept()` 的返回类型能统一成 `HelloDecision | SessionDecision`
 * 而不必让调用方写两套分支。
 *
 * 观战那一条为什么要有**两个**理由串：
 *  - `BusyMsg.reason` 的类型是 `HelloRejectReason | 'unsupported'`（`protocol.ts:124`），
 *    G5 只能借 `'unsupported'` 承载"本版本不支持观战"；
 *  - 但**会话层的 `reason` 是 `'unsupported-spectator'`**，与"观战席满了"
 *    （`'spectator-slots-full'`）是两个不同的值、两句不同的话（`busy.detail` 也不同）。
 *  G7 打开观战时，这两句必须分得清：一句是"换个房间没用"，另一句是"等新版本"。
 *
 * `busyReason` 单列的理由：`HelloValidationReason` 里有 `'bad-shape'`，而 `BusyMsg.reason` 的
 * 类型不含它（形状不对的输入根本不该被回一条 `busy` —— 连对端是不是它自称的那条消息都不知道）。
 * 所以回 `'unsupported'` 之外一律照 `validateHello` 给的理由码原样回，`'bad-shape'` 落回
 * `'unsupported'` 会是不实陈述 ⇒ 这里改成**让 `rejectHello` 自己决定**（见它的实现）。
 */
export interface HelloRejection {
  readonly ok: false;
  readonly reason: SessionHelloReason;
  readonly message: string;
  readonly phase: SessionPhase;
  /**
   * 要不要把 `busy` 发回去。
   *
   * `false` 只出现在「形状不合法」那一条：连"它是不是一条 hello"都不确定时回一条 `busy`，
   * 等于向一个身份不明的对端确认"这里的协议长这样"。同理 `busy.reason` 也只能取
   * `HelloRejectReason | 'unsupported'` —— 形状失败没有对应的值，正好说明它本来就不该发包。
   */
  readonly emit: boolean;
  readonly busy: BusyMsg;
}

/** 一次 `accept({ t: 'hello' })` 的结论 */
export type HelloDecision =
  | { ok: true; output: HelloAckMsg; phase: SessionPhase; seat: PlayerId }
  | HelloRejection;

/**
 * `peerStatus()` 的形状。
 *
 * **没有 `online` 这个字段**，这是刻意的：`src/net` 是纯层（没有时钟、没有心跳），
 * "对端此刻是否可达"只有**传输层**知道（T2 的 `NetTransport.status()` / `onStatus`）。
 * 在会话层凭 `phase` 猜一个布尔值就是造一个查不出原因的谎。T6 做"对手已断线"提示时，
 * 把传输层状态与本函数的 `phase` 合起来看即可（设计稿 `:496` 要求的是
 * `peerStatus().online = false`，那个字段属于 T6 的"会话+传输"合体，不属于纯状态机）。
 *
 * 同理 `acceptsInput` 只是"本会话层面是否已就绪"：真正的 `MatchDriver.acceptsInput`
 * （`src/app/match-driver.ts:105`）由 T5 决定，它上面还有"轮到谁"这一层。
 */
export interface PeerStatus {
  readonly phase: SessionPhase;
  /** 握手是否已经成功（`true` 之后 `phase` 才在承诺流程里） */
  readonly handshakeDone: boolean;
  /** 选面者（D3：**永远是加入方**）是否已经提交了它的承诺 */
  readonly faceCommitted: boolean;
  /** 种子是否已经揭示（**只有 `true` 之后上层才允许碰种子**） */
  readonly seedRevealed: boolean;
  /** 会话层认为可以收操作了（T5 会在它之上加"轮到谁"） */
  readonly acceptsInput: boolean;
  /**
   * 这是一次重连握手、且**还没追平**（D8/T6）。
   *
   * T3 只负责置位：`hello.resuming === true` 通过握手时它变 `true`。T6 接上追平之后
   * 把它清掉（T6 会在本文件里 `accept` 到 `resync-req`，那时相位离开 `'resuming'`）。
   */
  readonly needsResync: boolean;
}

/* ------------------------------------------------------------------ *
 * 5. 构造参数
 * ------------------------------------------------------------------ */

/** 会话的本地事实（照 `HelloContext` 的口径：一律**显式传入**，不给默认值） */
export interface NetSessionOptions {
  /**
   * 本机 `PROTO_VERSION`。
   *
   * **必填且不给默认值**：`protocol.ts:620-625` 已经就这个坑写过一次 —— 给了默认值之后
   * "忘了传本机事实"不会报错，而是**永远**回某一个理由（看起来像对端的问题）。
   * 必填 ⇒ 漏传是编译错误。
   */
  readonly localProtoVersion: number;
  /**
   * 本机卡牌数据指纹。**唯一出处**是 `src/app/card-data-hash.ts` 的 `CARD_DATA_HASH`；
   * 调用方直接把它喂进来（`src/net` 不 import 它 —— 这里只需要一个字符串）。
   * 在这里另算一份就会变成第二个跨设备契约，而漂移只在两台设备联机失败时才暴露。
   */
  readonly localCardDataHash: string;
  /**
   * 本局的 `sessionId`。**只住会话层，不进 `MatchFile`**（D2）：它是会话作用域的凭据，
   * 放进档案会触发一次格式迁移，而设计稿 `:500` 已经写明"主机关闭页面 ⇒ 对局结束"。
   *
   * 房主：房主自己生成的 id（`hello-ack.sessionId` 回的就是它）。
   * 加入方：本方要发出去的 `hello.sessionId`（本模块不生成它：`src/net` 不许取随机）。
   */
  readonly sessionId: string;
  /**
   * 本机座位。
   *  - 房主：自己的座位（缺省 0）；加入方的座位由握手定（D7：座位是主机的决定）。
   *  - 加入方：本方**自报**的座位（缺省 1）；房主认可后由 `hello-ack.seat` 覆盖，
   *    调用方必须以 `hello-ack.seat` 为准（见 `HelloAckMsg` 的注释）。
   */
  readonly seat?: PlayerId;
  /** 哈希能力（D15）。**必填**：它是本模块唯一的"算哈希"入口，没有它就完不成承诺流程 */
  readonly hash: HashLike;
}

/* ------------------------------------------------------------------ *
 * 6. 内部状态
 * ------------------------------------------------------------------ */

interface CoreState {
  readonly role: 'host' | 'guest';
  readonly opts: NetSessionOptions;
  phase: SessionPhase;
  /** 对端座位（房主：加入方的座位；加入方：本方座位，以 `hello-ack` 为准） */
  peerSeat: PlayerId;
  /** 本机座位 */
  selfSeat: PlayerId;
  /** 承诺流程里的不透明串（`seedHash`：房主的 `hash(seed+salt)`；`faceHash`：加入方的 `hash(face+nonce)`） */
  seedHash: string | null;
  faceHash: string | null;
  seed: string | null;
  face: 0 | 1 | null;
  faceNonce: string | null;
  salt: string | null;
}

/* ------------------------------------------------------------------ *
 * 7. 形状校验（网络来的输入）
 * ------------------------------------------------------------------ */

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * "这条哈希**长得像一个哈希**"。
 *
 * 只有一条实质要求：**非空字符串**。刻意**不**要求 hex / 定长 —— 算法与编码是注入实现的
 * 选择（`HashLike` 的注释已写明它是"不透明串"），在这里钉定长就等于把一个未来会变的事实写死，
 * 而且会让"换算法"表现成握手失败。
 *
 * **`Promise` 必须被挡掉**：`HashLike` 允许异步实现，若调用方把一个异步实现的返回值直接
 * 塞进 `commit.hash`，那条消息里就会是一个 `"[object Promise]"`，而症状要等到对端验承诺时才
 * 出现。这里当场拒绝（理由码与别的形状失败共用 `'bad-hash'`：它确实是"这条哈希不可用"）。
 */
function isHashString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}

/** 网络来的种子 / salt / nonce 的形态（同样只要求非空字符串） */
function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}

/** 从入站消息里取一个非空字符串字段；取不到就是 `null`（调用方据此回 `'bad-*'` 一族） */
function strField(msg: unknown, key: string): string | null {
  if (!isObj(msg)) return null;
  const v = msg[key];
  return isNonEmptyString(v) ? v : null;
}

/* ------------------------------------------------------------------ *
 * 8. 调用方违约（throw，不是结果对象）
 * ------------------------------------------------------------------ */

/**
 * 调用方必须自己算好哈希再喂进来（D15）。传空串 / 非字符串 / `Promise` 都是**编程错误**。
 *
 * 为什么 throw 而不返回结果对象：这不是"网络来的输入"，是"你还没算好就调了这个方法"。
 * 静默返回 `{ ok: false }` 会让调用方以为"操作被拒绝了"，而真相是它的哈希实现根本没接上 ——
 * 那会表现成"这局怎么都开不起来"，且没有任何线索指向哈希实现。
 * 与 `protocol.ts:29-32`（`roomCodeFromRandom` 的越界随机值）是同一条取舍。
 */
function requireHash(hash: HashLike, ...parts: readonly string[]): string {
  const out = hash(...parts);
  if (typeof out !== 'string' || out.length === 0) {
    throw new Error(
      'session.ts 的哈希注入（HashLike）没有返回可用的哈希串：' +
        `收到 ${typeof out === 'string' ? '空字符串' : String(out)}。` +
        '本模块不做异步（D15）：要同步用就注入一个同步实现；' +
        // 这条文案里**刻意不写**那个哈希 API 的名字（连注释里都尽量少写）：
        // `tests/net/net-purity.test.ts` 的浏览器 API 判据是**裸词面**匹配，而剥注释**不剥字符串**
        // ⇒ 报错文案里出现那个名字（`…哈希 API…`）会让守卫把这条纯字符串判成"调用了浏览器 API"。
        // 实测：T2 的评审人自建镜像时，本文件的这句文案就把守卫的"浏览器 API 零命中"那条腿打红了。
        // 说的是同一件事，换个说法即可："异步封装（真实实现住 src/ui/net-browser.ts，T7）"。
        '异步封装（真实实现住 src/ui/net-browser.ts，T7）算出来的是一个 Promise，不算哈希串。',
    );
  }
  return out;
}

/** 调用方传进来的种子 / salt / nonce 形状（同 `requireHash` 的取舍，文案分开以便定位） */
function requireNonEmpty(what: string, v: unknown): string {
  if (typeof v !== 'string' || v.length === 0) {
    throw new Error(
      `session.ts 的 ${what} 必须是非空字符串（收到 ${JSON.stringify(v)}）；这是调用方违约，不是网络输入。`,
    );
  }
  return v;
}

/* ------------------------------------------------------------------ *
 * 9. 可读文案（逐条不同；**不许**出现"公平 / 无法作弊"这类承诺，D3）
 * ------------------------------------------------------------------ */

/**
 * `reveal-seed` 到得太早的那一句（判据 1 的文案，房主与加入方共用）。
 *
 * 说什么、不说什么：
 *  - 说：**为什么**必须先选面（硬币是种子的纯函数 ⇒ 先看到种子就能反推结果），以及下一步做什么。
 *  - 不说：任何"本程序保证公平"的话。种子是房主自己选的，承诺钉不住"事前磨种子"（见文件头）。
 */
export const REVEAL_SEED_BEFORE_FACE_MESSAGE =
  '拒绝了过早到达的 reveal-seed：加入方还没有提交正/反的承诺（commit-face）。' +
  '硬币结果是种子的纯函数，先拿到种子的一方可以先算出结果、再挑对自己有利的那一面，' +
  '所以选面必须先于种子公开（设计稿 §5.3）。这一局请让对端先发 commit-face；' +
  '本程序不会替它补一个承诺。';

/** 判据 4：G5 不支持观战的那一句。**与 `spectator-slots-full` 的文案刻意不同**（G7 要分得清） */
export const SPECTATOR_UNSUPPORTED_MESSAGE =
  '这个版本（G5）还不支持观战：观战席还没造出来，不是坐满了。两张牌桌只留给两位玩家，' +
  '请让对方以玩家身份重发握手；观战会在后续版本里单独做。';

/** 观战回绝的 `busy.detail`：一句话点明"是不支持，不是位满" */
export const SPECTATOR_UNSUPPORTED_DETAIL =
  'G5 不支持观战（注意：这不是"观战席已满"）：本版本只有两张玩家位，观战要等后续版本。';

/** 追平还没接上（T6 的事）。**不静默吞掉**这条消息，也不假装已经追平 */
export const RESYNC_NOT_WIRED_MESSAGE =
  '收到了 resync-req，但这一版还没有接上追平流程（档案重传与重放是 T6 的事）。' +
  '本会话把它记下来并保持重连相位；请不要把它当成"追平已完成"。';

/* ------------------------------------------------------------------ *
 * 10. 对外 API（按角色分叉）
 * ------------------------------------------------------------------ */

/** 两个角色共有的读口与推进口 */
interface NetSessionCommon {
  /** 本会话的角色（`'host'` = 房主） */
  readonly role: 'host' | 'guest';
  /** 本机座位 */
  selfSeat(): PlayerId;
  /** 对端座位（握手定下之后才有意义；握手前是缺省值） */
  peerSeat(): PlayerId;
  /** 本局的 `sessionId`（**不进 `MatchFile`**，D2） */
  sessionId(): string;
  /**
   * 收一条消息。失败一律返回结果对象，**不抛**（网络来的输入走这条路）。
   *
   * `resync-req` 今天**一定**回 `'resync-not-wired'`（追平是 T6 的事）——
   * 不是"忘了写"，是为了不静默吞掉一条真消息。
   */
  accept(req: SessionInbound): HelloDecision | SessionDecision;
  /** 对端状态读数（T6 会在它上面接"已断线"，见 `PeerStatus` 的注释） */
  peerStatus(): PeerStatus;
  /** 承诺流程走到哪一相位 */
  phase(): SessionPhase;
  /**
   * 揭示之后读种子。**相位没到就回 `null`** —— 上层因此不可能"不小心"在承诺成立之前拿到种子
   * （这是第二道闸：第一道是 `sendRevealSeed()` 的相位判定）。
   */
  seed(): string | null;
  /** 揭示之后读面（房主收 `reveal-face` 之后、加入方自己提交之后都有值） */
  face(): 0 | 1 | null;
}

/**
 * 房主会话。
 *
 * 这里**没有** `commitFace()` / `sendRevealFace()` —— 选面者是加入方（D3），
 * 房主连方法都不该有（"房主自己选面"在编译期就写不出来）。
 */
export interface HostSession extends NetSessionCommon {
  readonly role: 'host';
  /** 生成 `commit { hash(seed+salt) }`（设计稿 `:472`）。承诺必须先于整个承诺流程 */
  sendCommit(seed: string, salt: string): SessionResult<{ output: SessionOutbound }>;
  /** 收到加入方的 `commit-face` ⇒ 承诺成立，相位进 `'face-committed'` */
  acceptCommitFace(msg: unknown): SessionDecision;
  /**
   * 揭示种子。**这是全阶段唯一可机器判定的安全属性所在的那一步。**
   *
   * 只有相位 `'face-committed'`（= 加入方的 `commit-face` 已经收到并通过形状校验）才成功。
   * 理由：硬币是种子的纯函数（设计稿 `:479-483`），先看到 seed 的一方可以先算出结果
   * 再挑必胜的那一面。三种失败各有**不同的**理由码（`'seed-before-face'` 是安全那一条，
   * `'seed-duplicate'` / `'seed-not-expected'` 是重复与重放）。
   */
  sendRevealSeed(): SessionResult<{ output: SessionOutbound; seed: string }>;
  /** 收到加入方的 `reveal-face` ⇒ 当场用注入哈希验 `hash(face, faceNonce)` 是否等于那条承诺 */
  acceptRevealFace(msg: unknown): SessionDecision;
  /** 收到 `reveal-salt` ⇒ 结束（盐的**校验方**是加入方，不是房主；这里只收下） */
  acceptRevealSalt(msg: unknown): SessionDecision;
  /** 本方承诺的 `hash(seed+salt)`（对端用它验 `reveal-salt`）；还没 `sendCommit` 时是 `null` */
  seedHashOfCommit(): string | null;
  /** 本方手里的盐（对端要用它验承诺）；还没 `sendCommit` 时是 `null` */
  salt(): string | null;
}

/**
 * 加入方会话。
 *
 * 这里**没有** `sendCommit()` / `sendRevealSeed()`。选面者（`commitFace`）只住这里。
 */
export interface GuestSession extends NetSessionCommon {
  readonly role: 'guest';
  /** 收房主的 `commit`，记下 `seedHash` 并转到"该回 ack"的相位（**不**自动发包） */
  acceptCommit(msg: unknown): SessionDecision;
  /** 把 `commit-ack` 发出去（设计稿 `:473`） */
  sendCommitAck(): SessionResult<{ output: SessionOutbound }>;
  /**
   * 提交正/反的承诺 `commit-face { hash(face, faceNonce) }`（设计稿 `:481`）。
   *
   * ★ 它只能在 `acceptCommit` 之后（相位 `'awaiting-commit-face'` 只有那一条到达路径）。
   * 这不是流程洁癖：它保证加入方的承诺哈希是在看到房主的 `seedHash`（而不是 seed）之后定下的，
   * 而 `face` 与 `faceNonce` 是加入方在**看到 seed 之前**就选好的。两条合起来，
   * "先看种子再挑面"在结构上没有位置可放。
   */
  commitFace(face: 0 | 1, faceNonce: string): SessionResult<{ output: SessionOutbound; hash: string }>;
  /** 收房主的 `reveal-seed`（**只能**在承诺之后，见判据 1） */
  acceptRevealSeed(msg: unknown): SessionDecision;
  /** 结束后揭示面与 nonce（设计稿 `:481`） */
  sendRevealFace(): SessionResult<{ output: SessionOutbound }>;
  /** 收到 `reveal-salt` ⇒ 验 `hash(seed, salt)` 是否等于房主的承诺（判据 2 的最后一步） */
  acceptRevealSalt(msg: unknown): SessionDecision;
  /** 承诺校验的结论：`null` = `reveal-salt` 还没到；`true`/`false` = 验过了与结论 */
  commitmentVerified(): boolean | null;
  /** 本方承诺的 `hash(face+faceNonce)`（对端用它验 `reveal-face`）；还没 `commitFace` 时是 `null` */
  faceHashOfCommit(): string | null;
}

/** 一个会话对象（两个角色的并集；用 `role` 窄化） */
export type NetSession = HostSession | GuestSession;

/* ------------------------------------------------------------------ *
 * 11. 实现
 * ------------------------------------------------------------------ */

/** ★ **唯一**允许"揭示种子"的相位。判据 1 的落点就是这一个函数返回 `false` 的那些情形 */
function mayRevealSeed(phase: SessionPhase): boolean {
  return phase === 'face-committed';
}

/** 判据 1 的三句不同的话：安全那条与"重复/重放"两条分开报，免得把重发误读成作弊 */
function seedRefusal(phase: SessionPhase, side: '房主' | '加入方'): { reason: SessionRejectReason; message: string } {
  if (phase === 'seed-revealed') {
    return {
      reason: 'seed-duplicate',
      message:
        `${side}已经见过一次 reveal-seed 了，不重复接受：同一条承诺只揭示一次种子。` +
        '对端若没收到，请让它重发 commit-ack，而不是再揭示一遍。',
    };
  }
  if (phase === 'reveal-salt-sent' || phase === 'complete') {
    return {
      reason: 'seed-not-expected',
      message:
        '这局已经走完承诺流程（种子与盐都揭示过），此时再来一条 reveal-seed 只可能是对端把流程重放了一遍；拒绝。',
    };
  }
  return { reason: 'seed-before-face', message: REVEAL_SEED_BEFORE_FACE_MESSAGE };
}

function ok<T extends object>(extra: T): { ok: true } & T {
  return { ok: true, ...extra };
}

function fail(reason: SessionRejectReason, message: string): { ok: false; reason: SessionRejectReason; message: string } {
  return { ok: false, reason, message };
}

/** 构造一条出站消息。`t` 与 `msg.t` 在这里被同一个实参约束住，不可能写歪 */
function outbound<K extends NetMsgType>(msg: Extract<NetMsg, { t: K }>): SessionOutbound {
  return { t: msg.t, msg };
}

function createSession(role: 'host' | 'guest', opts: NetSessionOptions): NetSession {
  const selfSeat: PlayerId = opts.seat ?? (role === 'host' ? 0 : 1);

  const s: CoreState = {
    role,
    opts,
    phase: 'handshaking',
    selfSeat,
    peerSeat: selfSeat === 0 ? 1 : 0,
    seedHash: null,
    faceHash: null,
    seed: null,
    face: null,
    faceNonce: null,
    salt: null,
  };

  /** 判据 2 最后一步的结论（`null` = `reveal-salt` 还没到） */
  let commitmentOk: boolean | null = null;
  /** 房主记下加入方承诺的哈希（`s.faceHash` 在两边含义相同，这里只为了让读数更直白） */
  let guestFaceHash: string | null = null;
  /**
   * **种子已经公开了**（= 对端现在拿得到它）。
   *
   * 它**不等于** `s.seed !== null`：房主在 `sendCommit` 的那一刻就把 seed 存在 `s.seed` 里了
   * （它要留着自己揭示用），但那时种子**还没公开**。若 `peerStatus().seedRevealed` 读的是
   * `s.seed !== null`，房主会在刚发出承诺时就被报成"种子已揭示"—— 那是一条**假读数**，
   * 而它恰好出现在安全属性最要命的那个窗口里（上层可能据此以为"可以公开种子了"）。
   */
  let seedMadePublic = false;

  /* ---------------- 握手 ---------------- */

  /** 握手：本机侧已经占用的玩家座位（房主自己先占一个，D7：座位由主机定） */
  function occupiedPlayers(): PlayerId[] {
    return role === 'host' ? [s.selfSeat] : [];
  }

  /**
   * 回绝一次握手。
   *
   * `busyReason` 与 `reason` **分开传**，因为两个类型不一样：`BusyMsg.reason` 是
   * `HelloRejectReason | 'unsupported'`，不含 `'bad-shape'`。
   *
   * 「形状不对」为什么**不**回一条 `busy`：那种输入连"它是不是一条 hello"都不确定
   * （`protocol.ts` 的形状检查就是为这个存在的）—— 回一条 `busy` 等于向一个身份不明的对端
   * 确认"这里的协议长这样"。所以形状失败根本不产出发包，`busy` 只在**四步业务拒绝 + 观战**
   * 这五种情况下产出。这与 `protocol.ts:599-611` 的取舍同源（形状失败不占用四条的顺序）。
   */
  function rejectHello(
    reason: SessionHelloReason,
    message: string,
    busyReason: BusyMsg['reason'] | null,
    detail: string,
  ): HelloRejection {
    s.phase = 'rejected';
    if (busyReason === null) {
      // 形状失败：**不发包**。`busy` 字段仍然要给（类型要求），但 `emit: false` 明确告诉调用方
      // "这条别发出去"，免得它把一句不实的理由发给一个身份不明的对端。
      return {
        ok: false,
        reason,
        message,
        phase: s.phase,
        emit: false,
        busy: { t: 'busy', reason: 'unsupported', detail: `${detail}（形状不合法，本端不向外发包）` },
      };
    }
    return { ok: false, reason, message, phase: s.phase, emit: true, busy: { t: 'busy', reason: busyReason, detail } };
  }

  function acceptHello(msg: unknown): HelloDecision {
    if (s.phase !== 'handshaking') {
      return rejectHello(
        'unexpected-message',
        s.phase === 'rejected'
          ? '这次握手已经被回绝过了，不再接受第二条 hello；请让对端开一个新的会话。'
          : `当前相位是 ${s.phase}，握手已经完成，不再接受 hello。`,
        null,
        '握手已完成，这条 hello 被丢弃。',
      );
    }
    // D13：校验顺序与文案全在 `protocol.ts` 的 `validateHello` 里（那是**唯一出处**，
    // 本模块不再判一遍 —— 两处判定迟早会漂移）。
    const v = validateHello(msg, {
      localProtoVersion: opts.localProtoVersion,
      localCardDataHash: opts.localCardDataHash,
      occupied: { players: occupiedPlayers(), spectators: [] },
      // D7：座位是主机的决定。房主替加入方定座位（`protocol.ts` 里 `ctx.seat` 优先于对端自报值）。
      seat: role === 'host' ? s.peerSeat : s.selfSeat,
    });
    if (!v.ok) {
      // `validateHello` 的四条（含 `'bad-shape'`）原样透传：同一件事不在两处各给一句话。
      // 形状失败**不发 busy**（`busyReason` 传 null），理由见 `rejectHello`。
      return rejectHello(v.reason, v.message, v.reason === 'bad-shape' ? null : v.reason, v.message);
    }

    const hello: HelloMsg = v.msg;

    // ---- D5：观战是合法值，但 G5 明确回绝（**在四步校验之后**，理由见 `SessionHelloReason`）----
    if (hello.role === 'spectator') {
      return rejectHello(
        'unsupported-spectator',
        SPECTATOR_UNSUPPORTED_MESSAGE,
        // `BusyMsg.reason` 的类型只认 `HelloRejectReason | 'unsupported'`；G5 用 `'unsupported'`
        // 承载"这个版本不支持观战"，而**区分它与人满了**靠的是这句 detail（与观战席满了那句不同）。
        'unsupported',
        SPECTATOR_UNSUPPORTED_DETAIL,
      );
    }

    s.peerSeat = v.seat;
    if (role === 'guest') s.selfSeat = v.seat;

    // ---- 重连（D8）：`resuming: true` 能通过握手，相位标成 `'resuming'` ----
    // 追平（`resync-res` 与档案重放）是 T6 的事：本模块只把这件事**记下来**
    // （`needsResync` 给 T6 与 UI 一个读口），不假装已经追平。
    s.phase = hello.resuming === true ? 'resuming' : role === 'host' ? 'awaiting-commit-face' : 'handshaking';
    return {
      ok: true,
      output: {
        t: 'hello-ack',
        protoVersion: opts.localProtoVersion,
        seat: s.peerSeat,
        peerNick: hello.nick,
        sessionId: opts.sessionId,
      },
      phase: s.phase,
      seat: s.peerSeat,
    };
  }

  /* ---------------- 承诺流程：房主 ---------------- */

  function sendCommit(seed: string, salt: string): SessionResult<{ output: SessionOutbound }> {
    const sd = requireNonEmpty('seed', seed);
    const st = requireNonEmpty('salt', salt);
    if (s.phase !== 'awaiting-commit-face') {
      return fail(
        'unexpected-message',
        `当前相位是 ${s.phase}，还不能发 commit：承诺要先于整个承诺流程（设计稿 §5.3 第 2 步），` +
          '而它只在握手成功之后才谈得上。',
      );
    }
    const hash = requireHash(opts.hash, sd, st);
    s.seed = sd;
    s.salt = st;
    s.seedHash = hash;
    // **相位不变**：房主的整段承诺流程都停在 `'awaiting-commit-face'`，直到收到对端的
    // `commit-face`（那才是 `'face-committed'`）。发过 commit 不等于"进了一步"——
    // 房主此刻唯一在等的东西还是同一样。多造一个中间相位只会让 `sendRevealSeed()` 的守卫
    // 多一条要维护的分支，而那条分支与安全属性无关。
    return ok({ output: outbound({ t: 'commit', hash }) });
  }

  function acceptCommitFace(msg: unknown): SessionDecision {
    const hash = strField(msg, 'hash');
    if (!isHashString(hash)) {
      return { ...fail('bad-hash', '收到的 commit-face 没有可用的 hash（空串 / 缺失 / 不是字符串）；承诺不成立，拒绝。'), phase: s.phase };
    }
    if (s.phase !== 'awaiting-commit-face') {
      return {
        ...fail(
          'unexpected-message',
          `当前相位是 ${s.phase}，此时收到 commit-face：` +
            (s.phase === 'handshaking' ? '握手还没完成。' : '这条承诺已经收到过了。'),
        ),
        phase: s.phase,
      };
    }
    // ★ 判据 1 的另一半：加入方的承诺**在这里**成立，而 `sendRevealSeed()` 只认这个相位。
    s.faceHash = hash;
    guestFaceHash = hash;
    s.phase = 'face-committed';
    return { ok: true, output: null, phase: s.phase };
  }

  function sendRevealSeed(): SessionResult<{ output: SessionOutbound; seed: string }> {
    // **顺序要紧**：先判相位，再判"有没有种子"。
    // 反过来写会在"握手都没做就调 `sendRevealSeed()`"时抛一句**内部不一致**的错
    // （实测踩过：`s.seed === null` 在 `handshaking` 相位下**恒真**）—— 而那不是内部不一致，
    // 是调用方在错误的时刻问了一件错事，本该走 `'seed-before-face'` 的结果对象。
    // 内部不变式只在**允许揭示的那个相位**下才谈得上：那时房主必然已经 `sendCommit` 过。
    if (mayRevealSeed(s.phase) && s.seed === null) {
      throw new Error('session.ts 内部不一致：相位已经是 face-committed 但还没有种子（sendCommit 没设上？）。');
    }
    if (!mayRevealSeed(s.phase)) {
      const refusal = seedRefusal(s.phase, '房主');
      return fail(refusal.reason, refusal.message);
    }
    // 到这里 `s.seed` 必非 null（上面那条不变式 + `mayRevealSeed` 为真）
    const seed = s.seed as string;
    s.phase = 'seed-revealed';
    seedMadePublic = true;
    return ok({ output: outbound({ t: 'reveal-seed', seed }), seed });
  }

  function acceptRevealFace(msg: unknown): SessionDecision {
    if (!isObj(msg) || (msg.face !== 0 && msg.face !== 1)) {
      return { ...fail('bad-face', '收到的 reveal-face 的 face 不是 0/1；拒绝。'), phase: s.phase };
    }
    const nonce = strField(msg, 'faceNonce');
    if (!isNonEmptyString(nonce)) {
      return { ...fail('bad-face', '收到的 reveal-face 没有可用的 faceNonce（空串 / 缺失）；拒绝。'), phase: s.phase };
    }
    if (s.phase !== 'seed-revealed') {
      return {
        ...fail('unexpected-message', `当前相位是 ${s.phase}，此时收到 reveal-face（承诺流程的次序不对）；拒绝。`),
        phase: s.phase,
      };
    }
    if (guestFaceHash === null) {
      throw new Error('session.ts 内部不一致：相位到了 seed-revealed 却没有加入方的承诺哈希。');
    }
    const face: 0 | 1 = msg.face;
    const actual = requireHash(opts.hash, String(face), nonce);
    if (actual !== guestFaceHash) {
      // 校验失败**不改任何状态**（相位与面都不动）：这条路径上没有任何东西可以"继续"，
      // 上层应当结束对局并如实记录。
      //
      // ⚠️ **不要在校验之前先把面写进 `s.face`**（本轮实测踩过）：那样"对端揭示的面与承诺对不上"
      // 之后，房主手里会留下一个**从未通过校验**的面 —— 而 `face()` 的语义是"这一局实际采用的面"。
      // 这会同时坏掉两件事：① 上层读到一个不实的面；② 由它派生的读数（`peerStatus().faceCommitted`
      // 之类）跟着变假，而症状是"校验报了错、但面还是被用上了"。本仓对这类"先写后验"取
      // **fail-closed**：验不过就什么都不留。
      return {
        ...fail(
          'face-hash-mismatch',
          '加入方揭示的 face 与它此前的承诺对不上：收到的 hash(face, faceNonce) 与 commit-face 里的 hash 不同。' +
            '这说明它现在给出的面不是承诺时定下的那一个；请结束这一局并如实记录。',
        ),
        phase: s.phase,
      };
    }
    s.face = face;
    s.faceNonce = nonce;
    s.phase = 'complete';
    return { ok: true, output: null, phase: s.phase };
  }

  function acceptRevealSalt(msg: unknown): SessionDecision {
    const salt = strField(msg, 'salt');
    if (!isNonEmptyString(salt)) {
      return { ...fail('bad-salt', '收到的 reveal-salt 没有可用的 salt（空串 / 缺失 / 不是字符串）；拒绝。'), phase: s.phase };
    }
    s.salt = salt;
    s.phase = 'complete';
    return { ok: true, output: null, phase: s.phase };
  }

  /* ---------------- 承诺流程：加入方 ---------------- */

  function acceptCommit(msg: unknown): SessionDecision {
    const hash = strField(msg, 'hash');
    if (!isHashString(hash)) {
      return { ...fail('bad-hash', '收到的 commit 没有可用的 hash（空串 / 缺失 / 不是字符串）；拒绝。'), phase: s.phase };
    }
    if (s.phase !== 'handshaking') {
      return { ...fail('unexpected-message', `当前相位是 ${s.phase}，不接受第二条 commit。`), phase: s.phase };
    }
    s.seedHash = hash;
    s.phase = 'seed-committed';
    // 这里**只记状态、不发包**：发 `commit-ack` 由调用方显式驱动（`sendCommitAck`）。
    // 理由：状态机是同步的，而"这条消息有没有排进传输层"是调用方的事（T5/T7 的注入面）。
    return { ok: true, output: null, phase: s.phase };
  }

  function sendCommitAck(): SessionResult<{ output: SessionOutbound }> {
    if (s.phase !== 'seed-committed') {
      return fail(
        'unexpected-message',
        `当前相位是 ${s.phase}，还不能回 commit-ack：先收到房主的 commit 再确认（设计稿 §5.3 第 3 步）。`,
      );
    }
    s.phase = 'awaiting-commit-face';
    return ok({ output: outbound({ t: 'commit-ack' }) });
  }

  function commitFace(face: 0 | 1, faceNonce: string): SessionResult<{ output: SessionOutbound; hash: string }> {
    if (face !== 0 && face !== 1) {
      throw new Error(`session.ts 的 commitFace 收到越界的 face ${String(face)}（契约是 0 | 1）；这是调用方违约。`);
    }
    const nonce = requireNonEmpty('faceNonce', faceNonce);
    if (s.phase !== 'awaiting-commit-face') {
      return fail(
        'unexpected-message',
        `当前相位是 ${s.phase}，还不能提交 commit-face：` +
          (s.phase === 'handshaking'
            ? '先收到房主的 commit（否则面的承诺会早于种子承诺）。'
            : '这条承诺已经提交过了。'),
      );
    }
    const hash = requireHash(opts.hash, String(face), nonce);
    s.face = face;
    s.faceNonce = nonce;
    s.faceHash = hash;
    s.phase = 'face-committed';
    return ok({ output: outbound({ t: 'commit-face', hash }), hash });
  }

  function acceptRevealSeed(msg: unknown): SessionDecision {
    const seed = strField(msg, 'seed');
    if (!isNonEmptyString(seed)) {
      return { ...fail('bad-seed', '收到的 reveal-seed 没有可用的 seed（空串 / 缺失 / 不是字符串）；拒绝。'), phase: s.phase };
    }
    // ★★ 判据 1 的守卫点（加入方这一侧）。
    // 只有相位 `'face-committed'`（= 本方已经 `commitFace`）才接受种子，而 `commitFace` 又只能在
    // `sendCommitAck()` 之后（`'awaiting-commit-face'`）。⇒ 加入方**结构上**不可能在看种子之前
    // 不承诺，也不可能先看种子再挑面。
    if (!mayRevealSeed(s.phase)) {
      const refusal = seedRefusal(s.phase, '加入方');
      return { ...fail(refusal.reason, refusal.message), phase: s.phase };
    }
    s.seed = seed;
    s.phase = 'seed-revealed';
    seedMadePublic = true;
    return { ok: true, output: null, phase: s.phase };
  }

  function sendRevealFace(): SessionResult<{ output: SessionOutbound }> {
    if (s.face === null || s.faceNonce === null) {
      throw new Error('session.ts 内部不一致：还没提交 commit-face 就要揭示面。');
    }
    if (s.phase !== 'seed-revealed') {
      return fail(
        'unexpected-message',
        `当前相位是 ${s.phase}，还不能揭示面：先收到房主的 reveal-seed（设计稿 §5.3 第 4 步）。`,
      );
    }
    s.phase = 'reveal-salt-sent';
    return ok({ output: outbound({ t: 'reveal-face', face: s.face, faceNonce: s.faceNonce }) });
  }

  function acceptRevealSaltFinal(msg: unknown): SessionDecision {
    const salt = strField(msg, 'salt');
    if (!isNonEmptyString(salt)) {
      return { ...fail('bad-salt', '收到的 reveal-salt 没有可用的 salt（空串 / 缺失 / 不是字符串）；拒绝。'), phase: s.phase };
    }
    if (s.phase !== 'reveal-salt-sent' && s.phase !== 'seed-revealed') {
      return {
        ...fail('unexpected-message', `当前相位是 ${s.phase}，此时收到 reveal-salt（承诺流程的次序不对）；拒绝。`),
        phase: s.phase,
      };
    }
    if (s.seed === null || s.seedHash === null) {
      throw new Error('session.ts 内部不一致：还没拿到种子/承诺就要验盐。');
    }
    const actual = requireHash(opts.hash, s.seed, salt);
    s.salt = salt;
    s.phase = 'complete';
    commitmentOk = actual === s.seedHash;
    if (commitmentOk !== true) {
      return {
        ...fail(
          'salt-hash-mismatch',
          '房主揭示的 salt 与它此前的承诺对不上：收到的 hash(seed, salt) 与 commit 里的 hash 不同。' +
            '这说明现在这一对 (seed, salt) 不是承诺时定下的那一对；请如实记录，不要把它当成一次正常的开局。',
        ),
        phase: s.phase,
      };
    }
    return { ok: true, output: null, phase: s.phase };
  }

  /* ---------------- 重连（T6 的接口先留出来） ---------------- */

  function acceptResyncReq(msg: unknown): SessionDecision {
    if (!isObj(msg)) {
      return { ...fail('unexpected-message', '收到的 resync-req 不是对象；拒绝。'), phase: s.phase };
    }
    // 不静默吞掉：T6 要接的就是这条。今天明确回一句"还没接上"。
    return { ...fail('resync-not-wired', RESYNC_NOT_WIRED_MESSAGE), phase: s.phase };
  }

  /* ---------------- 公共部分 ---------------- */

  const common = {
    selfSeat: () => s.selfSeat,
    peerSeat: () => s.peerSeat,
    sessionId: () => opts.sessionId,
    phase: () => s.phase,
    seed: () => s.seed,
    face: () => s.face,
    peerStatus: (): PeerStatus => ({
      phase: s.phase,
      handshakeDone:
        s.phase === 'seed-committed' ||
        s.phase === 'awaiting-commit-face' ||
        s.phase === 'face-committed' ||
        s.phase === 'seed-revealed' ||
        s.phase === 'reveal-salt-sent' ||
        s.phase === 'complete',
      faceCommitted: s.faceHash !== null,
      seedRevealed: seedMadePublic,
      // 只有种子揭示之后才谈得上"可以收操作"；真正的判据（轮到谁）在 T5。
      acceptsInput: s.phase === 'complete',
      needsResync: s.phase === 'resuming',
    }),
  };

  /**
   * 共用入口：按 `t` 分派。**返回类型是 `HelloDecision | SessionDecision`** ——
   * 因为 `hello` 的失败面多两条（`'bad-shape'` / `'unsupported-spectator'`），
   * 以及一条"要不要发包"的标记（`emit`）。调用方按 `reason` 分支即可，两边字段同名同义。
   */
  function accept(req: SessionInbound): HelloDecision | SessionDecision {
    const wrongWay = (what: string): SessionDecision => ({
      ...fail('unexpected-message', `${what} 的发送方向与本端角色（${s.role === 'host' ? '房主' : '加入方'}）不符；拒绝。`),
      phase: s.phase,
    });
    switch (req.t) {
      case 'hello':
        return acceptHello(req.msg);
      case 'commit':
        return s.role === 'guest' ? acceptCommit(req.msg) : wrongWay('commit');
      case 'commit-ack':
        return s.role === 'host' ? { ok: true, output: null, phase: s.phase } : wrongWay('commit-ack');
      case 'commit-face':
        return s.role === 'host' ? acceptCommitFace(req.msg) : wrongWay('commit-face');
      case 'reveal-seed':
        return s.role === 'guest' ? acceptRevealSeed(req.msg) : wrongWay('reveal-seed');
      case 'reveal-face':
        return s.role === 'host' ? acceptRevealFace(req.msg) : wrongWay('reveal-face');
      case 'reveal-salt':
        return s.role === 'guest' ? acceptRevealSaltFinal(req.msg) : acceptRevealSalt(req.msg);
      case 'resync-req':
        return acceptResyncReq(req.msg);
      default: {
        // 穷尽性兜底：`SessionInbound['t']` 只有上面那些，走不到这里。
        // 写它是为了让函数在所有分支上都有返回值（TS 看不出 switch 是穷尽的）。
        const never: never = req;
        return {
          ...fail('unexpected-message', `session.ts 不认得的入站消息 ${JSON.stringify((never as { t?: unknown }).t)}。`),
          phase: s.phase,
        };
      }
    }
  }

  if (role === 'host') {
    const host: HostSession = {
      role: 'host',
      ...common,
      accept,
      sendCommit,
      acceptCommitFace,
      sendRevealSeed,
      acceptRevealFace,
      acceptRevealSalt,
      seedHashOfCommit: () => s.seedHash,
      salt: () => s.salt,
    };
    return host;
  }

  const guest: GuestSession = {
    role: 'guest',
    ...common,
    accept,
    acceptCommit,
    sendCommitAck,
    commitFace,
    acceptRevealSeed,
    sendRevealFace,
    acceptRevealSalt: acceptRevealSaltFinal,
    commitmentVerified: () => commitmentOk,
    faceHashOfCommit: () => s.faceHash,
  };
  return guest;
}

/* ------------------------------------------------------------------ *
 * 12. 工厂
 * ------------------------------------------------------------------ */

/**
 * 造一个**房主**会话（`sendCommit` / `sendRevealSeed` / `peerStatus()` 住它上面）。
 *
 * 房主是种子与 salt 的持有者（`src/ui/match-seed.ts` 生成种子），也是**不能**选面的一方：
 * 本会话对象上没有 `commitFace()`，写错方向编译不过。
 */
export function createHostSession(opts: NetSessionOptions): HostSession {
  return createSession('host', opts) as HostSession;
}

/**
 * 造一个**加入方**会话。
 *
 * 加入方是选面者（D3），所以只有这个对象上有 `commitFace()` / `sendRevealFace()`。
 *
 * 本函数**不**生成也不发送 `hello`：`hello` 里还有 `nick`，而且要经过传输层。
 * 它只把 `sessionId` 记进会话（`sessionId()`），调用方据此自己拼 `hello` 并在收到 `hello-ack`
 * 之后以 `hello-ack.seat` 为准（房主是定座位的一方，D7）。
 */
export function createGuestSession(opts: NetSessionOptions): GuestSession {
  return createSession('guest', opts) as GuestSession;
}

/**
 * `sessionId` 的生成**不在这里**：`src/net` 是纯层，不许取随机（§2 第 2 条）。
 * 调用方（`src/ui/net-browser.ts` / `src/main.ts`）用自己的随机源生成后传进 `NetSessionOptions`。
 */
