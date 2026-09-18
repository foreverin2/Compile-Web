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
 * ## 两条流水线（修复轮 N-7 之后，两边的"等什么"各自有了名字）
 *
 * | 角色 | 相位推进 |
 * |---|---|
 * | 房主 | `handshaking` →（收 `hello`，回 ack）`awaiting-commit-face` →（`sendCommit`：**相位不变**）→（收 `commit-face`）`face-committed` →（`sendRevealSeed`）`seed-revealed` →（收 `reveal-face`，**这是"对局结束"那一步**）`complete` →（`sendRevealSalt()`）**仍是 `complete`** |
 * | 加入方 | `handshaking` →（收 `hello-ack`）`awaiting-commit` →（收 `commit`）`seed-committed` →（`sendCommitAck`）`awaiting-commit-ack` →（`commitFace`：发出自己的承诺）`face-committed` →（收 `reveal-seed`）`seed-revealed` →（`sendRevealFace`）`reveal-salt-sent` →（收 `reveal-salt`）`complete` |
 *
 * **三个"等"的相位各自只属于一个角色，不许合并**（实测踩过一次：把加入方 ack 之后的
 * 相位写成房主那个 `'awaiting-commit-face'`，守卫就分不清"等对方的承诺"与"等自己发承诺"，
 * 于是"还没收到 commit 就能选面"这条腿当场红）：
 *  - `'awaiting-commit'` = **加入方**在等房主的 `commit`（它刚收到 `hello-ack`，**还没**收到承诺）；
 *  - `'awaiting-commit-ack'` = **加入方**已经回了 `commit-ack`、正在等它自己发出 `commit-face`
 *    （`commitFace()` 的**唯一**合法相位）；
 *  - `'awaiting-commit-face'` = **房主**在等加入方的 `commit-face`。
 *
 * 两个角色的相位里都有 `'face-committed'`，而它的含义在两边**恰好相同**：
 * "加入方的 `commit-face` 已经成立" —— 房主那边是收到了对端的，加入方那边是自己发出了。
 * **`'face-committed'` 就是"允许揭示种子"的唯一相位**（`mayRevealSeed`）。
 *
 * **房主的 `complete` 是"两条收尾动作"里先到的那一步**（第四阶段收口后**只有一个顺序**）：
 * 收 `reveal-face` ⇒ `complete`（同时拿到对端选的面），**然后**才 `sendRevealSalt()`（相位仍是
 * `complete`）。反过来的顺序**结构上不可能**：`sendRevealSalt()` 只认 `complete`，而它在
 * `seed-revealed` 时调会被拒 —— 于是"先发盐 ⇒ `reveal-face` 永久进不来 ⇒ 房主拿不到面"
 * 这条死路不存在（详见 `mayRevealSalt` 的头注）。
 */
export type SessionPhase =
  | 'handshaking'
  | 'resuming'
  | 'awaiting-commit'
  | 'seed-committed'
  | 'awaiting-commit-ack'
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
  | { t: 'hello-ack'; msg: unknown }
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
   * 读种子。
   *
   * **它的语义是"本方此刻持有的种子"，不是"对端已经看到的种子"**（修复轮 N-3；
   * 阶段一评审用 `C1={"phase":"awaiting-commit-face","seed":"seed-review","peerSeedRevealed":false}`
   * 实测过这一点）。两侧的时序**故意不同**：
   *  - **房主**：`sendCommit()` 之后 `seed()` 就有值了（种子的来源就是房主自己，
   *    它要留着自己揭示、也要用 `salt()` 收尾）—— 此时对端**还看不到**它；
   *  - **加入方**：只在 `reveal-seed` 被接受之后才有值（之前一直是 `null`，这正是判据 1 要的）。
   *
   * 所以它**不是**判据 1 的第二道闸，别那样用它：
   *  - 要问"对端看到了种子没有"，读 `peerStatus().seedRevealed`（房主侧只有 `sendRevealSeed()`
   *    成功之后才为 `true`）；
   *  - 判据 1 真正的闸门只有一个：`sendRevealSeed()` 的相位判定（`mayRevealSeed`），
   *    它决定种子**能不能出线**。房主自己手里一直有种子这件事不是缺陷，是它的角色。
   *
   * （为什么不干脆改成"没公开就回 `null`"：那是一次**API 变更** —— 需要一个
   * `ownSeed()` 之类的本地读数口，而"房主在 reveal 之前要不要读自己的种子"这件事
   * 取决于 T5/T8 的接线形状（联机那条链还没接）。今天**没有任何调用方**需要在 reveal 之前
   * 读它（`src/main.ts:1107-1113` 是热座掷硬币那条链，与联机无关），所以这件事留给 T5/T8
   * 一并定，不在本轮擅自改形状。
   * 早先这里写的理由是"不改成 null 的话房主永远读不到自己的种子"—— **那条不成立**
   * （阶段二复验指出）：`sendRevealSeed()` 的成功面就带 `seed`，房主在需要的时刻拿得到它。
   * 结论不变，理由换成上面这条成立的。）
   */
  seed(): string | null;
  /** 揭示之后读面（房主收 `reveal-face` 之后、加入方自己提交之后都有值） */
  face(): 0 | 1 | null;
  /**
   * 读盐。
   *
   * 语义与 `seed()` 同款（**本方此刻持有的盐**，不是"对端已经看到的"）：
   *  - **房主**：`sendCommit()` 之后就有值（盐是它的），对端要等 `sendRevealSalt()` 之后才拿得到；
   *  - **加入方**：只在自己收到 `reveal-salt` 之后才有值（之前是 `null`）。
   * 它是**诊断与测试**用的读数（B-1 的腿要断言"加入方确实收到了盐"），不参与任何顺序判定。
   */
  salt(): string | null;
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
  /**
   * 把 `reveal-salt` 发出去（对局结束后，设计稿 `:475`）。
   *
   * **房主这一侧没有"收下 reveal-salt"的口**（修复轮 N-8）：盐是房主自己的，
   * `reveal-salt` 的发送方只能是它 ⇒ "合法收下"这件事不存在，所以那个方法被删掉了
   * （原来叫 `acceptRevealSalt`，调用方是 T5/T8）。入站 `reveal-salt` 在房主侧一律
   * `unexpected-message` 且不改状态。
   */
  sendRevealSalt(): SessionResult<{ output: SessionOutbound; salt: string }>;
  /** 本方承诺的 `hash(seed+salt)`（对端用它验 `reveal-salt`）；还没 `sendCommit` 时是 `null` */
  seedHashOfCommit(): string | null;
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
   * ★ 它只能在 `acceptCommit` + `sendCommitAck` 之后（相位 `'awaiting-commit-ack'` 只有那一条
   * 到达路径 —— N-12 修正：这里早先写的 `'awaiting-commit-face'` 是**房主**那一格的相位名，
   * 加入方这一格是 `'awaiting-commit-ack'`）。
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
  /**
   * **显式声明"这是一次重连"**（第三阶段复验 N-11 补的入口）。
   *
   * ## 为什么需要它（原来加入方的 `resuming` 是**死相位**）
   *
   * N-7 把"加入方收入站 `hello`"封掉之后，加入方那一侧**没有任何入站消息**能把它推进
   * `'resuming'`（复验实测：8 相位 × 11 入站消息逐格扫，`AUDIT-guest-resuming-reachable=[]`，
   * 且 `needsResync` 恒为 `false`）。而 D8/设计稿 `:497` 写的是"从机用
   * `hello{sessionId, resuming:true}` 回来" —— 那句话在相位上**没有落点**了。
   *
   * 为什么不由 `acceptHelloAck` 猜：ack 里**没有** `resuming` 字段（`HelloAckMsg` 的形状是
   * `t`/`protoVersion`/`seat`/`peerNick`/`sessionId`），而"这一次是不是重连"是**本端**
   * （加入方自己）知道的事实 —— 它刚刚带着同一个 `sessionId` 回来就是为了重连。
   * 所以这件事必须**由调用方显式声明**，不能从网络输入里推断（推断就是猜，而猜错会让
   * `needsResync` 变成假读数 —— 那正是这个模块一直在防的东西）。
   *
   * ## 调用时机（**必须在喂 `hello-ack` 之前**，第四阶段复验要求写实）
   *
   * ```ts
   * const g = createGuestSession({ sessionId, hash, ... });   // 新建
   * if (isReconnect) g.markResuming();                        // ← 就在这一步，早于任何入站消息
   * g.accept({ t: 'hello-ack', msg: ack });                   // 收到 ack 就变 awaiting-commit 了
   * ```
   *
   * 它只认 `'handshaking'` —— 也就是说**必须在把 ack 喂进去之前**调用：`acceptHelloAck` 会把相位
   * 推到 `'awaiting-commit'`（那条路径从 `handshaking` 出发），此后 `markResuming()` 一律被拒。
   * 已经进了承诺流程的会话也不该"变成重连"。
   *
   * ## 什么时候能知道"这是重连"（属 T8，不在本模块）
   *
   * 本模块不猜这个 —— 它由调用方（T8 的 UI 接线）根据"本端是不是带着同一个 `sessionId` 回来的"
   * 决定。真正的追平（`resync-req` / `resync-res` / 档案重放）是 **T6** 的事，本模块只把相位与
   * `needsResync` 置起来；进了 `'resuming'` 之后 `acceptCommit` 仍会被拒（`'awaiting-commit'`
   * 才是它的合法相位），**T6 必须自己把相位带出 `resuming`**。
   */
  markResuming(): SessionResult<{ phase: SessionPhase }>;
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

/** `reveal-salt` 形状失败的那一句（**只此一处**：形状检查与加入方的事后处理都要用它） */
function badSaltFailure(): { ok: false; reason: SessionRejectReason; message: string } {
  return { ok: false, reason: 'bad-salt', message: '收到的 reveal-salt 没有可用的 salt（空串 / 缺失 / 不是字符串）；拒绝。' };
}

/**
 * `reveal-salt` 的**形状检查**（房主与加入方共用一份；文案只有一处，免得两支漂移）。
 *
 * 它**不**含相位守卫 —— 守卫单独一个函数，因为加入方那一支需要在守卫之后、**校验之前**
 * 允许"验不过"这条路走完（`salt-hash-mismatch` 要能发出来），见 `mayIntakeSalt` 与
 * `acceptRevealSaltFinal`。
 */
function intakeRevealSalt(msg: unknown): { ok: true; salt: string } | { ok: false; reason: SessionRejectReason; message: string } {
  const salt = strField(msg, 'salt');
  if (!isNonEmptyString(salt)) return badSaltFailure();
  return { ok: true, salt };
}

/**
 * **收** `reveal-salt` 的相位守卫（只有**加入方**会走到它）。
 *
 * 这是修复轮 N-1 加的（阶段一评审实测 C2）：第一版没有守卫，于是一条**入站**
 * `{t:'reveal-salt', salt:'peer-salt'}` 就能把房主推到 `complete` —— `handshakeDone` 与
 * `acceptsInput` 双双变 `true`、`salt()` 被覆盖，而且此后**合法的 hello 被"握手已完成"永久拒掉**。
 * 握手都没做也照样成立。
 *
 * 为什么这不是"小毛病"：`phase` 是顺序约束**唯一的运行期载体** —— 一个能被单条网络消息推到
 * 终态的相位机，等于把"顺序由相位保证"这句话打了个洞。它不泄 seed（`sendRevealSeed()`
 * 那时被拒），但 T5/T6 会读 `acceptsInput` / `handshakeDone` 去做"能不能收操作""要不要重连"，
 * 读到一个**由对端凭空写出来的** `complete` 就是实质故障。
 *
 * 允许的两个相位：`seed-revealed`（本方收到过种子）与 `reveal-salt-sent`（本方已经发出
 * `reveal-face`）。其余一律拒，且**不改任何状态**。
 *
 * **它只管"收"，别拿它当"发"的窗口用**（第三阶段复验 N-13 点名的语义错位，也正是 B-1 的成因）：
 * 收盐的合法集合与发盐的合法集合**不是同一个**（发盐在 `complete` 也要允许）。发盐走
 * `mayRevealSalt`。
 */
function mayIntakeSalt(phase: SessionPhase): { ok: true } | { ok: false; reason: SessionRejectReason; message: string } {
  if (phase === 'seed-revealed' || phase === 'reveal-salt-sent') return { ok: true };
  return {
    ok: false,
    reason: 'unexpected-message',
    message:
      `当前相位是 ${phase}，此时收到 reveal-salt：` +
      '盐是**对局结束后、由房主**揭示的，本方还没有揭示过种子（或握手都还没完成），' +
      '所以这条消息只可能是对端搞错了方向或提前重放；拒绝，且不改变任何状态。',
  };
}

/**
 * **发** `reveal-salt` 的相位守卫（只有**房主**会走到它）—— 与 `mayIntakeSalt` **分开**（N-13）。
 *
 * ## 窗口收成**只有 `complete`**（第四阶段复验收口，裁决 D21 按建议 (i)）
 *
 * 历史：第一版拿**收**盐那个守卫当发盐的窗口用（允许 `seed-revealed` / `reveal-salt-sent`），
 * 于是设计稿 §5.3 那个顺序走不通 —— **先收 `reveal-face`**（房主据此才拿得到对端选的面）⇒
 * 相位到 `complete` ⇒ `sendRevealSalt()` 被拒 ⇒ **加入方永远验不了** `hash(seed+salt) === commit`。
 * 那是**阻断项 B-1**，第三轮的修法是"把 `complete` 加进窗口"。
 *
 * 但只加 `complete` 会留下一个**窗口严格大于能走完的顺序**的陷阱（第四阶段实测
 * `AUDIT-B1-residual={"phaseAfterSalt":"complete","faceOk":false,"reason":"unexpected-message","face":null}`）：
 * 从 `seed-revealed` 发盐是"窗口允许但走不完"的 —— 发完盐相位就是 `complete`，而
 * `acceptRevealFace` 只认 `seed-revealed` ⇒ **`reveal-face` 永久进不来** ⇒ 房主永远拿不到面。
 * 那种顺序不是"另一种合法顺序"，是一条**死路**。
 *
 * ⇒ 收成**只有 `complete`**：`seed-revealed` 那种发法**结构上不可能**（不是"别这么用"的注释纪律），
 * 于是"先发盐 ⇒ `reveal-face` 进不来"这件事**不可能发生**。代价是发盐**必须**晚于收到
 * `reveal-face` —— 与设计稿 `:475`"**结束后**房主发 `reveal-salt`"的读法一致（`:481` 那段把
 * `reveal-face` 也放在"结束后"，两条收尾动作里"结束"由揭示面那一步标记）。
 *
 * 幂等由 `saltMadePublic` 保证（`complete` 是终态，"发过没有"不能靠相位分辨）。
 */
function mayRevealSalt(phase: SessionPhase): { ok: true } | { ok: false; reason: SessionRejectReason; message: string } {
  if (phase === 'complete') return { ok: true };
  return {
    ok: false,
    reason: 'unexpected-message',
    message:
      `当前相位是 ${phase}，还不能揭示盐：盐要在**收到对端的 reveal-face 之后**才发` +
      '（那时这一局才算"结束"，设计稿 §5.3 最后一步）。先发盐会把相位推到 `complete`，' +
      '而那时 `reveal-face` 已经进不来了 —— 房主会永远拿不到对端选的面，所以本端不接受那种顺序。',
  };
}

/** 从（可能来自网络的）unknown 里取一个**给人看**的消息类型串（诊断与文案用，不参与分支） */
function whatOf(msg: unknown): string {
  if (!isObj(msg)) return '非对象的消息';
  const t = msg.t;
  return typeof t === 'string' ? t : '没有 t 字段的消息';
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

  /**
   * **盐已经发出去过了**（房主侧的幂等位；照 `seedMadePublic` 的写法）。
   *
   * 为什么需要它：`mayRevealSalt` 现在允许 `complete`（B-1 的修法 —— 先收 `reveal-face`
   * 再发盐），而 `complete` 是个**终态**，没有"再前进一格"这回事。所以"发过没有"必须**另记一位**，
   * 不能靠相位区分（相位在发盐前后都可能是 `complete`）。
   */
  let saltMadePublic = false;

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
  /**
   * 回绝一次握手（**真的把这次握手判死**：相位进 `'rejected'`）。
   *
   * `busyReason` 与 `reason` **分开传**，因为两个类型不一样：`BusyMsg.reason` 是
   * `HelloRejectReason | 'unsupported'`，不含 `'bad-shape'`。
   *
   * 「形状不对」为什么**不**回一条 `busy`：那种输入连"它是不是一条 hello"都不确定
   * （`protocol.ts` 的形状检查就是为这个存在的）—— 回一条 `busy` 等于向一个身份不明的对端
   * 确认"这里的协议长这样"。所以形状失败根本不产出发包，`busy` 只在**四步业务拒绝 + 观战**
   * 这五种情况下产出。这与 `protocol.ts:599-611` 的取舍同源（形状失败不占用四条的顺序）。
   *
   * **它不该被用来处理"迟到/重复的 hello"**（修复轮 N-6，阶段二复验实测）：
   * 那种消息不构成"这次握手失败"，把它推成 `'rejected'` 会**一条重放消息废掉健康会话**
   * （在途的 `reveal-face` 再也进不来、`handshakeDone` 从 true 变回 false）。迟到的 hello 走
   * 下面的 `refuseLateHello`。
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

  /**
   * 拒绝一条**不该在此时出现的 `hello`**，但**不动任何状态**（修复轮 N-6）。
   *
   * 三条后果是阶段二复验实测出来的（`AUDIT-duplicate-hello`），逐条对上：
   *  1. `seed-revealed` 之后合法的 `reveal-face` **再也进不来** —— 在途的承诺流程被一条
   *     重放消息作废；
   *  2. `peerStatus().handshakeDone` 从 `true` **变回 `false`**；
   *  3. 之后 `sendRevealSeed()` 报 `seed-before-face`，而那句文案说"加入方还没有提交承诺" ——
   *     在 `seed-revealed` 相位下这是**一句假话**（承诺早就提交过了）。
   *
   * ⇒ 迟到的 hello 与"握手被回绝"是**两件事**，因此：相位不动、`emit: false`（不回一条
   * `busy` —— 会话是好的，回 busy 会让对端以为这局没戏）、文案按**当前相位**如实说。
   *
   * 为什么 `emit: false`：`busy` 的语义是"这个房间不收你"，而这里的事实是"握手早就成了，
   * 这条消息来晚了"。发一条 busy 会误导对端去换房间。
   */
  function refuseLateHello(what: string): HelloRejection {
    const why =
      s.phase === 'rejected'
        ? '这次握手已经被本端回绝过了'
        : '握手已经成功过（这一局已经在承诺流程里）';
    return {
      ok: false,
      reason: 'unexpected-message',
      message:
        `${what}：${why}，当前相位是 ${s.phase} —— 本端**忽略**它，会话状态一点都没动。` +
        '已经完成的步骤不会因为你重发握手就退回去；若确实要开新的一局，请换一个新的 sessionId 重新握手。',
      phase: s.phase,
      emit: false,
      busy: { t: 'busy', reason: 'unsupported', detail: '这条 hello 来得太晚，被忽略（会话未改动）。' },
    };
  }

  function acceptHello(msg: unknown): HelloDecision {
    // N-7：`hello` 的合法发送方是**加入方**，所以只有房主该收它。
    // 加入方收到入站 hello 是对端搞错了方向 —— 那既不构成"握手回绝"，也不该改任何状态
    // （阶段二复验实测：一条 `{t:'hello',resuming:true}` 能把加入方推到 `resuming`，
    //  此后真正的 `commit` 永久进不来；普通 hello 还会改写它的座位读数）。
    if (role !== 'host') {
      return {
        ok: false,
        reason: 'unexpected-message',
        message:
          `收到了一条 ${JSON.stringify(whatOf(msg))}：hello 只能由**加入方**发给房主，本端是加入方，` +
          '这条消息方向反了，本端忽略它且不改动任何状态（本端要等的是 hello-ack）。',
        phase: s.phase,
        emit: false,
        busy: { t: 'busy', reason: 'unsupported', detail: 'hello 的方向反了（本端是加入方），已忽略。' },
      };
    }
    if (s.phase !== 'handshaking') {
      return refuseLateHello('重复/迟到的 hello');
    }
    // D13：校验顺序与文案全在 `protocol.ts` 的 `validateHello` 里（那是**唯一出处**，
    // 本模块不再判一遍 —— 两处判定迟早会漂移）。
    const v = validateHello(msg, {
      localProtoVersion: opts.localProtoVersion,
      localCardDataHash: opts.localCardDataHash,
      occupied: { players: occupiedPlayers(), spectators: [] },
      // D7：座位是主机的决定 —— 房主替加入方定座位（`protocol.ts` 里 `ctx.seat` 优先于对端自报值）。
      seat: s.peerSeat,
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

    // ---- 重连（D8）：`resuming: true` 能通过握手，相位标成 `'resuming'` ----
    // 追平（`resync-res` 与档案重放）是 T6 的事：本模块只把这件事**记下来**
    // （`needsResync` 给 T6 与 UI 一个读口），不假装已经追平。
    s.phase = hello.resuming === true ? 'resuming' : 'awaiting-commit-face';
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

  /**
   * 加入方收下 `hello-ack`（修复轮 N-7）。
   *
   * ## 为什么必须新增这一条入站消息
   *
   * 在它存在之前，加入方那一侧的"握手"在相位上**没有表示**：`SessionInbound` 里没有
   * `hello-ack`，于是 `guest.peerStatus().handshakeDone` 在握手刚成功时仍是 `false`
   * （阶段一评审 N-4 记录过，交给了 T5/T8）。
   *
   * 更要紧的是 N-7：加入方**唯一**能表达"握手完成"的办法此前竟是**收一条入站 `hello`** ——
   * 而 `hello` 的合法发送方是加入方自己。那条路一旦被对端利用，一条
   * `{t:'hello',resuming:true}` 就能把加入方推到 `resuming`（**假读数**），此后真正的
   * `commit` 永久进不来。⇒ 把"收到 hello"（方向错，忽略）与"收到 hello-ack"（对，推进）
   * 分开，加入方的相位才由**它真正该等的消息**驱动。
   */
  function acceptHelloAck(msg: unknown): SessionDecision {
    if (role !== 'guest') {
      return {
        ...fail('unexpected-message', 'hello-ack 只能由房主发出、由加入方接收；本端是房主，收到的方向反了。'),
        phase: s.phase,
      };
    }
    if (
      !isObj(msg) ||
      !isNonEmptyString(msg.sessionId) ||
      typeof msg.peerNick !== 'string' ||
      (msg.seat !== 0 && msg.seat !== 1)
    ) {
      return {
        ...fail('unexpected-message', '收到的 hello-ack 形状不对（缺 sessionId / peerNick / seat）；拒绝，状态不动。'),
        phase: s.phase,
      };
    }
    // ---- `protoVersion`：**补上**（第三阶段复验交回时点名的那一项，我判定它是**漏项**）----
    // 理由：`HelloAckMsg`（`protocol.ts`，T1 冻结）确实带着 `protoVersion`，而它就是房主
    // 自己的线协议版本 —— 加入方收到它必须与自己的比一次。
    //
    // **这是一层防御性检查，不是主闸门**（第四阶段复验纠正了我原来写反的说法）：真实路径上
    // `decodeMsg`（T1）**已经当场拒了**版本不符的 ack —— `protocol.ts:425` 要求 ack 带
    // `protoVersion`，`:541` 比"消息自带的值 vs 本机值"（复验实测 `layer1.reason='proto-version'`）。
    // 所以这一层平时不触发；它保护的是**绕过 `decodeMsg` 的调用方**（测试、以及将来任何直接喂
    // `accept` 的接线）—— 那些调用方拿到的就是"本模块该不该接受这条 ack"的答案。
    // 我早先在这里写的是"`decodeMsg` 会让版本不符的 ack 静默通过"，**那句是错的**（实测会拒），
    // 已改掉；同一轮里 `tests/net/session.test.ts` 的腿注写的是对的（"`decodeMsg` 在那一层就先拒了"），
    // 两处现在口径一致。
    // 文案与 `validateHello` 的第 1 步逐字同源（同一件事不给第二种说法）。
    if (typeof msg.protoVersion !== 'number') {
      return {
        ...fail('unexpected-message', '收到的 hello-ack 里 protoVersion 不是数字；拒绝，状态不动。'),
        phase: s.phase,
      };
    }
    if (msg.protoVersion !== opts.localProtoVersion) {
      return {
        ...fail(
          'unexpected-message',
          `游戏版本不一致，请双方都更新到最新版（对端协议 v${msg.protoVersion}，本机 v${opts.localProtoVersion}）。`,
        ),
        phase: s.phase,
      };
    }
    // **`cardDataHash` 不校，这是有意的、不是漏项**，理由两条都是可核对的：
    //  1. `HelloAckMsg` **根本没有这个字段**（`protocol.ts` 的形状里只有
    //     `t` / `protoVersion` / `seat` / `peerNick` / `sessionId`），想校就得改
    //     `protocol.ts` 的冻结形状 —— 那是 T1 的交付物，不在本任务边界内；
    //  2. 这件事**已经在握手第一步做过了**：加入方的 `hello.cardDataHash` 是发给房主的，
    //     房主用 `validateHello` 的第 2 步（D13）比过一次，比不过就回 `busy`
    //     （`reason='card-data-hash'`）而**不会回 ack**。⇒ 拿到 ack 就蕴含"房主那边的指纹
    //     已经与本端一致"，再在 ack 里回传一次是冗余的（也会把指纹多送一趟网络）。
    //  ⇒ 若将来要把指纹也放进 ack，先改 `protocol.ts` 的 `HelloAckMsg` 形状并同轮重钉 T1 的腿。
    if (msg.sessionId !== opts.sessionId) {
      return {
        ...fail(
          'unexpected-message',
          `收到的 hello-ack 属于另一局（对端回的 sessionId 是 ${JSON.stringify(msg.sessionId)}，` +
            `本端这一局是 ${JSON.stringify(opts.sessionId)}）；拒绝，状态不动。`,
        ),
        phase: s.phase,
      };
    }
    if (s.phase !== 'handshaking' && s.phase !== 'resuming') {
      return { ...fail('unexpected-message', `当前相位是 ${s.phase}，不接受第二条 hello-ack。`), phase: s.phase };
    }
    // D7：座位是**房主**的决定 —— 以 ack 里的座位为准（本端自报的只是初值）。
    s.selfSeat = msg.seat;
    s.peerSeat = msg.seat === 0 ? 1 : 0;
    // 相位往前走一格：本端等的东西从"hello-ack"变成"房主的 commit"。
    // `'resuming'` 保持不动（重连那一支的追平是 T6 的事，见 N-4）。
    if (s.phase === 'handshaking') s.phase = 'awaiting-commit';
    return { ok: true, output: null, phase: s.phase };
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
      // **不要在校验之前先把面写进 `s.face`**（本轮实测踩过）：那样"对端揭示的面与承诺对不上"
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

  /* ---------------- 承诺流程：房主的揭示 ---------------- */

  /**
   * 房主把盐发出去（对局结束后；设计稿 `:475`）。
   *
   * 与 `sendRevealSeed()` 同一形状：**产出**一条要发的消息，不由状态机自己发包。
   * 相位守卫与种子那条同源（`mayIntakeSalt` 认的两个相位）：只有**本方已经揭示过种子**之后
   * 才谈得上揭示盐 —— 先盐后种毫无意义，而且那时对方还没法验。
   *
   * 为什么房主这一侧**只有发、没有收**（修复轮 N-8）：`reveal-salt` 的发送方只能是房主
   * （盐是它的），所以"房主合法收下 reveal-salt"这件事不存在。原来那个 `acceptRevealSalt(msg)`
   * 因此被**删掉**（阶段二复验实测 `AUDIT-host-salt-overwrite`：合法窗口里一条入站
   * `{t:'reveal-salt', salt:'对端塞进来的盐'}` 会把房主自己的盐覆盖掉）。入站 `reveal-salt`
   * 在房主侧一律 `unexpected-message` 且不改状态。
   * 这是一次 API 变更，调用方是 T5/T8 —— 比"留一个永远拒绝的方法"更诚实：调用方**编译期**
   * 就知道房主不收这东西。
   */
  function sendRevealSalt(): SessionResult<{ output: SessionOutbound; salt: string }> {
    if (s.salt === null) {
      throw new Error('session.ts 内部不一致：还没发过 commit 就要揭示盐（sendCommit 没设上？）。');
    }
    if (saltMadePublic) {
      // 幂等出口（B-1 的修法带来的必要一位）：`mayRevealSalt` 现在也认 `complete`，
      // 而 `complete` 是终态 ⇒"发过没有"必须另记，不能靠相位分辨。
      //
      // 理由码用 `'unexpected-message'`（不是 `'seed-duplicate'`）：后者是**种子**那一条的码，
      // 它的文案说的是"同一条承诺只揭示一次**种子**"；拿它报盐会让 T5/T8 按码分支时读到假话。
      // 为盐单独造一个码要考虑 `SessionRejectReason` 的闭合表与 T5/T8 的分支，收益不抵成本 ——
      // 第二次揭示盐本来就属于"此刻不该发这条"。
      return fail('unexpected-message', '这条 reveal-salt 已经发过一次了，不重复发：同一条承诺只揭示一次盐。');
    }
    const guard = mayRevealSalt(s.phase);
    if (!guard.ok) return fail(guard.reason, guard.message);
    saltMadePublic = true;
    s.phase = 'complete';
    return ok({ output: outbound({ t: 'reveal-salt', salt: s.salt }), salt: s.salt });
  }

  /* ---------------- 承诺流程：加入方 ---------------- */

  function acceptCommit(msg: unknown): SessionDecision {
    const hash = strField(msg, 'hash');
    if (!isHashString(hash)) {
      return { ...fail('bad-hash', '收到的 commit 没有可用的 hash（空串 / 缺失 / 不是字符串）；拒绝。'), phase: s.phase };
    }
    // 加入方等 `commit` 的相位是 `'awaiting-commit'`（收到 `hello-ack` 之后进入）。
    // N-7 之前它靠"收一条入站 hello"进相位 —— 那是方向错的用法，现在由 `hello-ack` 驱动。
    if (s.phase !== 'awaiting-commit') {
      return {
        ...fail(
          'unexpected-message',
          `当前相位是 ${s.phase}，此时不接受 commit（要么握手还没完成，要么这条是重复的）。`,
        ),
        phase: s.phase,
      };
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
    // 加入方发过 ack 之后等的是**自己**发出 `commit-face` —— 那与"房主在等对方的承诺"、
    // 以及"加入方还在等房主的 commit"都不是同一件事，所以它有**自己的**相位
    // `'awaiting-commit-ack'`（`commitFace()` 只认这一个）。
    s.phase = 'awaiting-commit-ack';
    return ok({ output: outbound({ t: 'commit-ack' }) });
  }
  function commitFace(face: 0 | 1, faceNonce: string): SessionResult<{ output: SessionOutbound; hash: string }> {
    if (face !== 0 && face !== 1) {
      throw new Error(`session.ts 的 commitFace 收到越界的 face ${String(face)}（契约是 0 | 1）；这是调用方违约。`);
    }
    const nonce = requireNonEmpty('faceNonce', faceNonce);
    // `commitFace()` 的**唯一**合法相位：本方已经回过 `commit-ack`（`'awaiting-commit-ack'`）。
    // 刻意**不**接受 `'awaiting-commit'`（那时连房主的 commit 都还没到 —— 面的承诺会抢在
    // 种子承诺之前，正是判据 1 要堵的形状）。
    if (s.phase !== 'awaiting-commit-ack') {
      return fail(
        'unexpected-message',
        `当前相位是 ${s.phase}，还不能提交 commit-face：` +
          (s.phase === 'handshaking' || s.phase === 'awaiting-commit'
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
    // `sendCommitAck()` 之后（相位 `'awaiting-commit-ack'` —— N-12 修正：早先这里写的是房主那一格的
    // `'awaiting-commit-face'`）。⇒ 加入方**结构上**不可能在看种子之前
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
    // 形状（共用一份）+ 相位守卫（共用一份），然后是**本方特有**的一步：兑现承诺的校验。
    // 顺序要紧：守卫必须在"形状"之后（空 salt 是形状问题，不是时机问题），
    //    而**校验必须在相位推进之前完成** —— 否则 `salt-hash-mismatch` 再也发不出来
    //    （相位已经被推到 `complete`，理由码就丢了）。实测踩过：把三步合成"形状+守卫+推进"
    //    之后，`salt-hash-mismatch` 这条真实路径变成不可达，理由码覆盖面当场少一个。
    //
    // ★★ **收盐守卫是承重的**（第四阶段复验实测，值得单独记）：
    //    它不只是"排序"，还是下面那条**内部不变式**的前提。若把 `mayIntakeSalt` 短路成永远放行，
    //    加入方在 `handshaking` 收到一条 `reveal-salt` 就会走到
    //    `throw new Error('session.ts 内部不一致：还没拿到种子/承诺就要验盐。')` ——
    //    也就是"**网络来的输入一律走结果对象、不抛**"这条契约**依赖于守卫先跑**。
    //    守卫今天挡住了那条路，所以不是缺陷；但这意味着改这里的守卫时必须同时想清楚
    //    下面那条 `throw` 会不会被网络输入够到（`M5` 那条变异就是拿它当靶子的）。
    const shape = intakeRevealSalt(msg);
    if (!shape.ok) return { ...fail(shape.reason, shape.message), phase: s.phase };
    const guard = mayIntakeSalt(s.phase);
    if (!guard.ok) return { ...fail(guard.reason, guard.message), phase: s.phase };
    if (s.seed === null || s.seedHash === null) {
      // 不变式：走到这里必须"已经拿到种子与承诺"。**上面的守卫保证了这一点**（它只放行
      // `seed-revealed` / `reveal-salt-sent`，而这两个相位都蕴含 seed 与 seedHash 已置）。
      throw new Error('session.ts 内部不一致：还没拿到种子/承诺就要验盐（收盐守卫被放宽了？）。');
    }
    const actual = requireHash(opts.hash, s.seed, shape.salt);
    s.salt = shape.salt;
    s.phase = 'complete';
    commitmentOk = actual === s.seedHash;
    if (commitmentOk !== true) {
      // 这里**推进了相位**（与房主的 `reveal-face` 失配那条路**刻意不同**），
      // 理由有两条，都是可核对的（修复轮 N-9 要求写清）：
      //  1. **角色不同**：加入方是**验证方**，它的职责是"验完并如实记下结论"——
      //     `commitmentVerified() === false` 就是那个结论，而这条结论必须能被上层读到。
      //     房主那条路是**见证方**（对端在揭示自己承诺过的面），失配时它手上不能留下一个
      //     没通过校验的面（`face()` 的语义是"这一局实际采用的面"）。
      //  2. **能继续的东西不同**：加入方验不过之后没有"下一步"要做（盐都到了，流程到头了），
      //     所以收尾到 `complete` 并把结论摆在读数里；房主失配时后面还有它要做的事，
      //     而它**不该**基于一个假的面继续 —— 所以 fail-closed（相位不动、面不落）。
      // ⇒ 两条路的**收尾纪律**不同是设计，不是漏改；判据 2 的负向腿各自钉住了它们。
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

  /**
   * 加入方显式声明"这是一次重连"（N-11）。理由与允许的相位见接口注释。
   */
  function markResuming(): SessionResult<{ phase: SessionPhase }> {
    if (s.phase !== 'handshaking') {
      return fail(
        'unexpected-message',
        `当前相位是 ${s.phase}，不能把它标成重连：这一局已经在承诺流程里，` +
          '"变成重连"只对还没握完手的加入方有意义。',
      );
    }
    s.phase = 'resuming';
    // 成功面带 `phase`（第四阶段复验：原先是空成功面，调用方得猜；带上它就与
    // `SessionDecision` 同一口径 —— 调用方能直接读到"现在在哪个相位"）。
    return ok({ phase: s.phase });
  }

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
    salt: () => s.salt,
    peerStatus: (): PeerStatus => ({
      phase: s.phase,
      handshakeDone:
        s.phase === 'awaiting-commit' ||
        s.phase === 'seed-committed' ||
        s.phase === 'awaiting-commit-ack' ||
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
      case 'hello-ack':
        return acceptHelloAck(req.msg);
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
        // N-8：`reveal-salt` 的发送方**只能是房主**。加入方照旧走"收下并兑现校验"那一支；
        // 房主**不再有**"收下自己那条 reveal-salt"的路（它的盐是本地持有的，见 `sendRevealSalt`）。
        return s.role === 'guest' ? acceptRevealSaltFinal(req.msg) : wrongWay('reveal-salt');
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
      sendRevealSalt,
      seedHashOfCommit: () => s.seedHash,
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
    markResuming,
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
