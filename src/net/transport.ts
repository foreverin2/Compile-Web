/**
 * 传输抽象 `transport.ts`（G5 T2；见 `docs/2026-09-17-G5-传输层联机-实现计划.md` §5 T2、
 * §4 的 D6 / D7 / D11、设计稿 `docs/2026-09-13-联机与多端-设计稿.md` §5.4）。
 *
 * ## 它是什么
 *
 * 纯层与浏览器之间的**唯一接口**（D6）：本文件只有类型，没有一行运行期代码 ——
 * 浏览器那一侧的实现是 `src/ui/net-browser.ts`（T7，唯一碰 `RTCPeerConnection` 的文件），
 * 由 `src/main.ts` 注入；测试那一侧的实现是 `src/net/fake-transport.ts`，由**显式 pump** 驱动。
 * 形状照 §3.2 的三对先例（`FileIoCapabilities` ↔ `archive-fs-browser.ts`、
 * `KeyValueStore` ↔ `local-store-browser.ts`、`Ticker` ↔ `main.ts`）。
 *
 * ## 三条硬约束，写在接口里而不是文档里
 *
 * 1. **只搬运不透明字符串，不解析协议消息。** 本文件与 `src/net/protocol.ts` **零 import**：
 *    编解码（`encodeMsg` / `decodeMsg`）由调用方负责。传输层知道"这条走可靠通道、那条走
 *    不可靠通道"，但对载荷是什么一无所知 —— 于是两边可以独立演进（T1 改消息联合类型时，
 *    这里一个字都不用动）。
 * 2. **一个定时器都没有。** 本层与 fake 都不许直呼定时器（§2 第 2 条），所以"延迟"这件事
 *    在接口里用**相对步数**表达（`netTick` / `deliverAtTick`），不用毫秒：毫秒是真实时钟的量纲，
 *    而纯层没有时钟。这也是 fake 传输确定性的来源。
 * 3. **失败一律返回结果对象，不抛。** 形状照 `protocol.ts` / `archive-fs.ts` 的
 *    `{ ok: true, … } | { ok: false, reason, message }`：网络层的失败是常态，不是异常
 *    （唯一的例外留给"调用方违约"那一类编程错误，例如往一个没 `init` 的传输上发消息 ——
 *    那属于调用顺序错，不属于网络状态）。
 *
 * ## 一条 G5 的性质，别改松
 *
 * 纯层里**没有"全局当前 transport"**：所有函数都收显式入参，没有单例、没有模块级可变状态。
 * 判据 5（注入式）钉的就是这个 —— `NetTransport` 的每个实现都必须能被塞进任何宿主里跑。
 */

/* ------------------------------------------------------------------ *
 * 1. 两条通道（D11）
 * ------------------------------------------------------------------ */

/**
 * 通道名。**只有两条，名字是设计稿 `:485-490` 定的**（D11）：
 *  - `'act'`：可靠且**保序**。握手、承诺、操作记录、重同步、档案传输全走它。
 *  - `'beat'`：不可靠且**可乱序**。G5 只用它传心跳与在线状态（表情留给 G7）。
 *
 * ⚠️ 为什么不允许"只有一条通道、用参数区分可靠与否"：那样"这条消息该走哪条"就没有类型约束，
 * 而 D11 的整条理由（心跳丢一两个无所谓、操作记录一步都不能丢）会退化成调用方的自觉。
 */
export type NetChannel = 'act' | 'beat';

/**
 * 一条通道的传输特性。
 *
 * ★ 判据 6（补强）：接口必须**能表达"这条通道不可靠"这一事实** —— 否则 T7 在真 WebRTC 上
 * 无法把 `beat` 映射成 `ordered: false` / `maxRetransmits: 0`（那两个参数是 `RTCDataChannelInit`
 * 的原生字段，不是本仓发明的）。所以能力写进接口，而不是散在实现的注释里。
 *
 * `reliable: false` 意味着**两件事**：消息可能丢，且到达顺序可能与发送顺序不同。
 * 拆成两个布尔值看似更细，代价是会出现 `{ reliable: true, ordered: false }` 这种
 * WebRTC 表达不了、G5 也用不到的第三态 —— 本仓不造用不上的状态。
 */
export interface NetChannelSpec {
  readonly channel: NetChannel;
  /** `true` = 不丢消息（`maxRetransmits` 有限 / `ordered: true`）。 */
  readonly reliable: boolean;
  /** `false` = 到达顺序不保证（对应 `ordered: false`）。`reliable: false` 时必为 `false`。 */
  readonly ordered: boolean;
}

/**
 * 两条通道的**唯一出处**。调用方（T3/T5/T7）从这里取，别各自写一份字面量。
 *
 * `beat` 的"不可靠"在 G5 里其实用不满（心跳丢一两个无所谓，见 D11 的代价），
 * 但接口里必须留着它：等到 G7 观战真的需要时**不必改接口**（改接口等于同时改
 * fake、浏览器适配与所有调用方）。
 */
export const CHANNEL_SPECS: readonly NetChannelSpec[] = [
  { channel: 'act', reliable: true, ordered: true },
  { channel: 'beat', reliable: false, ordered: false },
];

/** 取一条通道的特性（`CHANNEL_SPECS` 的唯一取用口，避免调用方自己 `find` 出漏网） */
export function channelSpec(channel: NetChannel): NetChannelSpec {
  for (const spec of CHANNEL_SPECS) {
    if (spec.channel === channel) return spec;
  }
  // 穷尽性兜底：`NetChannel` 只有两个值，走不到这里；写它是为了让返回类型不是 `undefined`
  // （TS 的控制流分析看不出上面的循环必然返回），而不是"防御运行期"。
  throw new Error(`未知通道 ${String(channel)}（CHANNEL_SPECS 里没有它）。`);
}

/* ------------------------------------------------------------------ *
 * 2. 结果对象（失败一律返回值，不抛）
 * ------------------------------------------------------------------ */

/**
 * `send` 的失败形态。四个值**互不相同**，逐个给出触发它的**事实**：
 *  - `'offline'`：对端不可达（掉线/断网/还没连上）。这是 G5 里最常见的一个 ——
 *    T6 的"对手已断线"提示就是它的消费方。
 *  - `'closed'`：本方已经 `close()`（这一局结束了，不是"暂时不在"）。
 *  - `'not-initialized'`：`init()` 还没成功。它单列（而不是并进 `'offline'`）的理由是
 *    它属于**调用顺序错误**：`'offline'` 是网络状态，`'not-initialized'` 是"你没开门就想发货"。
 *  - `'queue-full'`：本端待发队列积压超过上限（真 WebRTC 上是 `bufferedAmount` 过高）。
 *    ⚠️ fake 传输**永不**返回它（模拟里没有拥塞这个概念）；它出现在这个 union 里是因为
 *    **接口必须能表达它**，否则 T7 遇到积压只能返回一个乐观的 `ok`。
 */
export type SendFailureReason = 'offline' | 'closed' | 'not-initialized' | 'queue-full';

/** 发送失败的**实体**（`onError` 收的就是它） */
export interface SendFailure {
  ok: false;
  reason: SendFailureReason;
  message: string;
}

/** 发送结果：`reason` 是判别键，`message` 是给人看的一句真因（**不参与分支**） */
export type SendResult = { ok: true } | SendFailure;

/** 传输所处的状态（`offline` 与 `closed` 是**两件事**：前者能重连，后者不能） */
export type TransportStatus = 'idle' | 'connecting' | 'online' | 'offline' | 'closed';

/**
 * `init()` / `close()` 的结果。
 *
 * ⚠️ 这两个方法**是异步的**（真 WebRTC 的 `RTCPeerConnection` 必须异步建立），而
 * `send` **是同步的**（`RTCDataChannel.send()` 本来就同步）—— 这不是风格，是照实现的能力走：
 * 把 `send` 也写成 `Promise` 会让每一步锁步操作都多一层微任务，而 T5 的每一步都不想被时序漂移干扰。
 */
export type TransportActionResult = { ok: true } | { ok: false; reason: string; message: string };

/* ------------------------------------------------------------------ *
 * 3. 线封装（帧）与投递步
 * ------------------------------------------------------------------ */

/**
 * 传输层**唯一**往线上放的东西：一个不透明文本 + 它属于哪条通道。
 *
 * `seq` 是**传输层自己的发送序号**，与 `protocol.ts` 的 `ActMsg.seq`（档案里的步号）
 * 是两件事，别混：前者用于 fake 在"同一到达时刻"上稳定排序（确定性），后者是会议层语义。
 * `from` 是本端 `TransportInit.selfId`，让接收方知道这条是谁发的。
 *
 * ⚠️ `payload` 由调用方编成**字符串**（`encodeMsg().text` 的样子），传输层不看它一眼。
 */
export interface NetEnvelope {
  readonly channel: NetChannel;
  readonly seq: number;
  readonly from: string;
  readonly payload: string;
}

/** 到达的一帧 + 它在哪一步到的（`atTick` = fake 的逻辑步编号；真实实现里它就是到达次序） */
export interface StampedText {
  readonly text: string;
}

/**
 * `pump()` 的一步：谁发的、谁收的、哪条通道、第几步到、载荷原文。
 *
 * ★ **为什么把"到达步"渲染成结构化数据而不是回调的副作用**：判据 4（确定性）要能
 * **逐字比对两遍的投递序列**。若只有 `onMessage` 回调，比对就只能靠测试自己往数组里攒日志 ——
 * 那样"序列"的定义在测试里、而不在实现里，换个测试就能改口径。这里由传输层自己产出，
 * 两遍对比的是同一份东西。
 */
export interface DeliveryStep {
  readonly sender: string;
  readonly receiver: string;
  readonly channel: NetChannel;
  readonly atTick: number;
  readonly text: string;
}

/* ------------------------------------------------------------------ *
 * 4. 注入面
 * ------------------------------------------------------------------ */

/** `init` 的入参：本端身份与对端身份（都由调用方给，纯层不自己生成 id） */
export interface TransportInit {
  /** 本端 id（主机/从机由调用方在会话层定，传输层不关心谁是主机） */
  selfId: string;
  /** 对端 id */
  peerId: string;
}

/** 状态变化的一张快照（`onStatus` 收到的东西） */
export interface StatusChange {
  readonly from: TransportStatus;
  readonly to: TransportStatus;
  /** 给人看的一句（T6 的"对手已断线"提示会引用它，但不直接展示它） */
  readonly message: string;
}

/**
 * 网络内核（fake 传输的"线"）与一帧传输之间的接缝。
 *
 * 为什么要有这一层：`NetTransport` 的实现负责"解码 + 状态机"，而"消息怎么走"（延迟、丢包、乱序）
 * 必须能在不改 `NetTransport` 形状的前提下换掉。T7 不需要实现它（它的"内核"就是真 WebRTC）；
 * 它今天只有 fake 传输一个实现。
 *
 * ⚠️ `deliver` 的契约是"**内核已经决定这一帧现在到达**"，实现不得在其中再排延迟 ——
 * 延迟只发生在 `schedule`（发的那一侧）。两层都排延迟会让"延迟是几步"变成两处相加，
 * 而判据里的步数断言就再也对不上了。
 */
export interface TransportConnector {
  /** 排一帧（返回它被排在第几步到达，便于测试核对） */
  schedule(channel: NetChannel, text: string, opts?: { readonly extraTicks?: number }): number;
  /**
   * 一帧到达。`channel` 要与发送侧一致（内核负责把通道带过来）——
   * 接收方要能分辨"这条走的是哪条通道"（T3 的 `beat` 心跳与 `act` 操作记录是两种处置）。
   */
  deliver(text: string, channel: NetChannel): void;
  /** 网络内核判定本端可达性变了（`false` = 对端不可达 / 连接断了） */
  setReachable(reachable: boolean, message: string): void;
}

export interface NetTransport {
  /**
   * 建立连接。**幂等**：已经 `online` 时再调一次是 no-op（返回成功）——
   * 重连路上会被反复调用（T6），让调用方每次都要先问状态是没必要的负担。
   */
  init(init: TransportInit): Promise<TransportActionResult>;
  /** 本端此刻支持的通道（真实 WebRTC 上就是两条 DataChannel） */
  channels(): readonly NetChannelSpec[];
  /** 走到这一步的发送序号（`NetEnvelope.seq` 的当前值）；测试用它核对确定性 */
  seq(): number;
  /** 发一帧。**同步**（见 `TransportActionResult` 的说明），失败返回结果对象 */
  send(channel: NetChannel, text: string): SendResult;
  /** `send` + 若失败则把 `message` 交给 `onError`（调用方不想写 `if (!r.ok)` 时的糖） */
  sendIfOpen(channel: NetChannel, text: string): SendResult;
  /** 关闭。**不可逆**（`closed` 之后不能重连）；重复调用是 no-op，返回成功 */
  close(): Promise<TransportActionResult>;
  /** 订阅收到的帧。返回退订函数（**幂等**：重复退订不抛） */
  onMessage(cb: (text: string, channel: NetChannel) => void): () => void;
  /** 订阅状态变化。返回退订函数。回调只报**变化**，同状态不重复报 */
  onStatus(cb: (change: StatusChange) => void): () => void;
  /** 本端**发送**失败的旁路口（调用方不想在每一处都写 `if (!r.ok)` 时用它） */
  onError(cb: (failure: SendFailure) => void): () => void;
  status(): TransportStatus;
}
