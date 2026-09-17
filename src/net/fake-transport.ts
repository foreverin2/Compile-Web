/**
 * 成对 fake 传输 `fake-transport.ts`（G5 T2；见 `docs/2026-09-17-G5-传输层联机-实现计划.md` §5 T2、
 * §4 的 D6 / D11、§2 第 2 条）。
 *
 * ## 它解决什么
 *
 * T3（会话状态机）、T5（锁步驱动）、T6（断线重连）都需要"两条通道 + 掉线重连"这个环境，
 * 而真 WebRTC 在单元测试里既慢又不可控（ICE/DTLS 全在外，§3.6 实测冷启动 5.4 秒）。
 * 本文件提供一个**在内存里、由显式 pump 驱动**的成对传输：它是 `NetTransport` 的第二份实现
 * （第一份是 T7 的 `src/ui/net-browser.ts`）。
 *
 * ## ★ 为什么一个定时器都没有（这不是"暂时这样"，是判据）
 *
 * §2 第 2 条禁止 `src/net/**` 直呼定时器，而 T1 的施工版点名"用定时器实现延迟"就是一条变异。
 * 所以这里的"延迟"用**逻辑步**（tick）而不是毫秒：
 *
 *  - 发送方把一帧排进"待到达"队列，`atTick = 当前 tick + latencyTicks + 1`；
 *  - 测试调用 `pump(n)` ⇒ 内部 tick 前进 n 步，每前进一步交付一帧"到点"的；
 *  - **时间是调用方给的，不是机器给的。** 这既满足纯层约束，也让整条链路可复现 ——
 *    同一脚本跑两遍，投递序列逐字相同（判据 4）。
 *
 * ## 三条通道特性怎么落进实现
 *
 * | 特性 | 落法 |
 * |---|---|
 * | 可靠（`act`） | `pickDeliverable` 挑最早到点的一帧，**永不丢弃** |
 * | 不可靠（`beat`） | 按注入的 `random` 做丢弃判定（`dropNumerator`/`dropDenominator`） |
 * | 保序（`act`） | 同一到达步按 `seq` 稳定排序；`random` 无法把一帧往后推 |
 * | 可乱序（`beat`） | 按注入的 `random` 把一帧的到达步往后推 1..`reorderTicks` |
 *
 * ★ **随机源由调用方注入**（`random`，契约 `[0, 1)`，与 `protocol.ts` 的 `roomCodeFromRandom`
 * 同款）：纯层连"取一次随机"都不许。测试传一个固定序列 ⇒ 丢包与乱序变成**可复现的输入**，
 * 而不是"这次跑没丢、下次跑了丢了"的抖动。
 *
 * ## 与 `protocol.ts` 零耦合
 *
 * 本文件**不 import** `src/net/protocol.ts`：搬运的是不透明字符串。T1 改消息联合类型、
 * T3 加承诺流程，都不必回来动这里。若哪天发现非耦合不可，那说明有一层职责放错了位置，
 * 应当先改设计（计划 §5 T2 硬约束第 1 条）。
 */

import type {
  NetChannel,
  NetChannelSpec,
  NetTransport,
  SendFailure,
  SendResult,
  StatusChange,
  TransportActionResult,
  TransportConnector,
  TransportInit,
  TransportStatus,
} from './transport';
import { CHANNEL_SPECS } from './transport';

/* ------------------------------------------------------------------ *
 * 1. 对外形状
 * ------------------------------------------------------------------ */

export type Side = 'A' | 'B';

/** 一帧到达的观测记录（`pump` 的返回值；判据 4 逐字比对的就是它） */
export interface FakeDelivery {
  readonly atTick: number;
  readonly channel: NetChannel;
  readonly from: Side;
  readonly to: Side;
  /** 传输层发送序号（**线序**，不是 T1 `ActMsg.seq`） */
  readonly seq: number;
  readonly text: string;
}

/** 一帧放上线的时刻。刻意不用裸数字：`0` 读不出是"立刻"还是"第 0 步"，而写错一格的症状是"延迟差一" */
export type ScheduleWhen = { readonly kind: 'now' } | { readonly kind: 'after'; readonly ticks: number };

/** `'now'` 的简写（帧进了待到达队列，`pump` 的下一步才调度它） */
export const NOW: ScheduleWhen = { kind: 'now' };

/** `after(n)` 的简写（在链路延迟与乱序之上再加 n 步） */
export function after(ticks: number): ScheduleWhen {
  return { kind: 'after', ticks };
}

/** 一条链路的参数。**发送侧的端口管它自己那条方向**（A 的端口管 A→B） */
export interface LinkConfig {
  /** 链路是否通（`false` = 本侧发的帧不上线，等价于拔了本侧的线） */
  readonly live?: boolean;
  /** 普通帧的基础延迟步数。控制帧（`close-res`）走 `CONTROL_LATENCY_TICKS`，不受它影响 */
  readonly latencyTicks?: number;
  /** 丢包概率的分子/分母：`random() * 分母 < 分子` 就丢。只用**注入的**随机源 */
  readonly dropNumerator?: number;
  readonly dropDenominator?: number;
  /** 乱序窗口：`random()` 命中时把这一帧的到达步往后推 1..`reorderTicks` 步 */
  readonly reorderTicks?: number;
}

/**
 * `LinkConfig` 的规范化形态（每个字段都有值，测试读它做锚点）。
 *
 * 字段**故意不是 `readonly`**：这是 fake 的**内部可变状态**，`activate()` / `configure()`
 * 都要就地改它。`LinkConfig` 的 `readonly` 约束的是"调用方不许改我收到的对象"，
 * 不是"实现不许改自己的状态"。
 */
export interface ResolvedLinkConfig {
  live: boolean;
  latencyTicks: number;
  dropNumerator: number;
  dropDenominator: number;
  reorderTicks: number;
}

/**
 * 测试用的操作面。它**故意不并进 `NetTransport`**：生产代码不该有"把自己拔线"的能力，
 * 而 fake 必须能被测试从外面摆布。
 */
export interface FakePort {
  readonly side: Side;
  readonly transport: NetTransport;
  /** 改链路参数（只影响**本侧发出**的帧） */
  configure(config: LinkConfig): void;
  /** 当前链路参数（只读快照） */
  config(): ResolvedLinkConfig;
  /** 本侧还有几帧在"待排"队列里（链路不通时攒下的） */
  pendingRequeueCount(): number;
  /**
   * 改可达性：
   *  - `deactivate()`：本侧链路断（本侧 `send` 进待排队列），两端都收到 `offline` 通知；
   *  - `activate()`：链路通，待排的帧按当前参数重排上线。
   */
  activate(): void;
  deactivate(): void;
  /** 把一帧**直接**排上线（不经 `send`，因此不受"本侧已 offline"影响）。返回**线序** */
  schedule(channel: NetChannel, text: string, when?: ScheduleWhen): number;
  /**
   * 某帧**最早可能**在哪一步到达（`undefined` = 它不在队列里）。
   *
   * ★ 名字是 `earliestTick` 而不是 `scheduleAt`（评审 N-3 的整改）。原名承诺的是
   * "它被排在第几步到达"，但 `pump` 每步每侧**只交付一帧** ⇒ 同一步排 3 帧时
   * 三帧的"最早可能到达步"都是 2，而它们实际分别在 2、3、4 落地。
   * 原承诺会骗到 T5/T6 里按"延迟几步"写的断言。
   *
   * 所以调用方**不许**把它的返回值当成实际到达步：实际落地还取决于队列里排在它前面的帧数
   * （每步一帧）。要核对实际到达时刻就读 `steps()`。
   */
  earliestTick(seq: number): number | undefined;
  /**
   * 本侧自己 `close()`；返回那次关闭登记的线序（`null` = 没关成）。
   *
   * 返回值从 `close-res` 的**到达步**改成了**线序**（N-2 整改的连带改动）：
   * 关闭现在是一条内核内部信号（不排队、到达时不进 `onMessage`），所以"哪一步到"要用
   * `earliestTick(seq)` 去问，而不是让 `close()` 猜一个数回来。
   */
  close(): Promise<number | null>;
  /** 撤销 `closed` 回到 `online`（模拟"重连成功"；**不会**自动恢复链路开关） */
  reopen(): void;
  /** 本侧 `sendSeq` 的当前值（测试核对确定性用） */
  sendSeq(): number;
}

export interface FakeTransportPair {
  readonly A: FakePort;
  readonly B: FakePort;
  /** 两条方向各自的基础延迟步数（不动链路开关） */
  setLatencyTicks(aToB: number, bToA: number): void;
  /** 推进 `n` 步（默认 1）。每步内先交付 A 侧、再交付 B 侧各一帧 */
  pump(n?: number): void;
  /** 内部时钟（已推进的步数） */
  tick(): number;
  /** 从建立到现在**真正到达**的每一帧（`beat` 丢掉的帧不在其中） */
  steps(): readonly FakeDelivery[];
  /** 被丢弃的帧数（只有 `beat` 会丢；`act` 与 `close-res` **永不**计入） */
  dropped(): number;
  /** 状态变化日志（判据 4 连它一起逐字比对；**不管有没有订阅者都记**） */
  statusLog(): readonly { readonly side: Side; readonly from: TransportStatus; readonly to: TransportStatus }[];
}

export interface FakePairOptions {
  /** A 侧注入的随机源（`[0, 1)`）。缺省恒 0 ⇒ 不丢、不乱序 */
  readonly randomA?: () => number;
  /** B 侧注入的随机源（`[0, 1)`）。缺省恒 0 */
  readonly randomB?: () => number;
  readonly aToB?: LinkConfig;
  readonly bToA?: LinkConfig;
  /** 两端初始可达性（缺省都可达） */
  readonly reachable?: { readonly sideA?: boolean; readonly sideB?: boolean };
}

/* ------------------------------------------------------------------ *
 * 2. 常量与内部形状
 * ------------------------------------------------------------------ */

/**
 * 控制帧（`close-res`）的固定延迟步数。
 *
 * 为什么单列一个常量：控制帧是**状态机自己的话**，不是玩家数据。把它的延迟绑在"玩家数据延迟"上，
 * 会让"关掉链路之后几步内应该收到应答"这条判据随 `latencyTicks` 漂移 —— 那种判据会在改了一个
 * 无关数字之后突然变红，而原因看起来在别处。
 */
export const CONTROL_LATENCY_TICKS = 1;

/**
 * `close()` 排队的那条应答的文本。
 *
 * 它**不再交给 `onMessage`**（评审 N-2）：早先它是混进消息流的一条 fake 私有载荷，
 * 于是 T3 的解码器会把它判成"未知 t"，而"对手关了"这件事在状态面上反而看不见。
 * 现在它只是一帧**内部**信号：它照常占一次链路调度（好让"几步到"可被核对），
 * 但到达时不进订阅者，改为把接收侧转成 `offline`。
 */
export const CLOSE_RES_TEXT = '{"t":"fake","kind":"close-res"}';

/** 待到达（或在等待重排）的一帧 */
interface PendingFrame {
  readonly seq: number;
  readonly channel: NetChannel;
  readonly text: string;
  readonly from: Side;
  readonly to: Side;
  /**
   * 这一帧是**玩家数据**还是**内核内部信号**。
   *
   * 为什么要有这个标签（评审 N-2）：`close-res` 必须走"状态转移"而不是"混进消息流"，
   * 而它又要照常占一次链路调度好让"几步到"可被核对 ⇒ 得让落地处能分辨它。
   * **用类型标签、不用文本相等**：载荷是不透明字符串，文本比对会把"谁恰好发了同样的字节"
   * 也当成控制帧。
   */
  readonly kind: 'data' | 'control-close';
  /** 到达步；`null` = 还没排（在待排队列里等 `activate`） */
  atTick: number | null;
  /**
   * 网络跳数：0 = 本步发出、本步交付（内核内部信号，不排队）；1 = 走了一次链路。
   *
   * 加这个字段的原因：`close-res` 要做成"状态转移 + 占一次调度"，就必须把
   * "本步直接送达"和"排进待到达队列"两条路区分开。用一个计数比再加一个布尔标志干净：
   * `0` 天然是"还没上路"，`1` 天然是"上过路了"。
   */
  hops: number;
}

/** 一侧的全部内部状态 */
interface SideState {
  readonly side: Side;
  readonly random: () => number;
  readonly link: ResolvedLinkConfig;
  /** 链路通不通（`link.live` 的可写副本；`link` 是快照，不给外面改） */
  live: boolean;
  readonly pending: PendingFrame[];
  readonly requeue: PendingFrame[];
  status: TransportStatus;
  sendSeq: number;
  /** `init()` 时记下的本端/对端 id（今天只有诊断与自证会读它） */
  selfId: string;
  peerId: string;
  /** 本侧的 `NetTransport`（`makeTransport` 建好后回填，供 `FakePort.close()` 调用） */
  transport: NetTransport | null;
  readonly log: { side: Side; from: TransportStatus; to: TransportStatus }[];
  messageListeners: ((text: string, channel: NetChannel) => void)[];
  statusListeners: ((change: StatusChange) => void)[];
  errorListeners: ((failure: SendFailure) => void)[];
}

function otherSide(side: Side): Side {
  return side === 'A' ? 'B' : 'A';
}

function resolveLink(cfg: LinkConfig, base?: ResolvedLinkConfig): ResolvedLinkConfig {
  return {
    live: cfg.live ?? base?.live ?? true,
    latencyTicks: cfg.latencyTicks ?? base?.latencyTicks ?? 1,
    dropNumerator: cfg.dropNumerator ?? base?.dropNumerator ?? 0,
    dropDenominator: cfg.dropDenominator ?? base?.dropDenominator ?? 1,
    reorderTicks: cfg.reorderTicks ?? base?.reorderTicks ?? 0,
  };
}

/* ------------------------------------------------------------------ *
 * 3. 成对传输
 * ------------------------------------------------------------------ */

export function createFakeTransportPair(opts: FakePairOptions = {}): FakeTransportPair {
  /** 逻辑时钟（步）。**唯一的时间来源**，没有任何墙钟参与 */
  let nowTick = 0;
  /** 全对端共用的线序（`NetTransport.seq()` 是**本端**计数，两者不要混） */
  let nextSeq = 0;
  let droppedCount = 0;
  const allSteps: FakeDelivery[] = [];

  const sides: Record<Side, SideState> = {
    A: newSide('A', opts.randomA ?? (() => 0), resolveLink(opts.aToB ?? {})),
    B: newSide('B', opts.randomB ?? (() => 0), resolveLink(opts.bToA ?? {})),
  };

  /** 两端是否可达（`deactivate()` 会把两端一起翻成 false） */
  const reachable: Record<Side, boolean> = {
    A: opts.reachable?.sideA ?? true,
    B: opts.reachable?.sideB ?? true,
  };
  /** 每一侧的 `TransportConnector`（`makeTransport` 里填） */
  const connectors: Partial<Record<Side, TransportConnector>> = {};

  function newSide(side: Side, random: () => number, link: ResolvedLinkConfig): SideState {
    return {
      side,
      random,
      link,
      live: link.live,
      pending: [],
      requeue: [],
      status: 'idle',
      sendSeq: 0,
      selfId: side,
      peerId: otherSide(side),
      transport: null,
      log: [],
      messageListeners: [],
      statusListeners: [],
      errorListeners: [],
    };
  }

  /**
   * 这一帧现在到得了吗？返回最早到点的那一帧。
   *
   * `frame.channel === 'beat'` 这一句是 `act` 的**保序**与 `beat` 的**可乱序**的分界线，
   * 也是变异 M1（把 `act` 也当成可乱序 ⇒ 判据 1 变红）的锚点。
   */
  function pickDeliverable(list: readonly PendingFrame[], tick: number): PendingFrame | null {
    const due: PendingFrame[] = [];
    for (const frame of list) {
      if (frame.atTick !== null && frame.atTick <= tick) due.push(frame);
    }
    if (due.length === 0) return null;
    due.sort((x, y) => {
      const ax = x.atTick ?? 0;
      const ay = y.atTick ?? 0;
      if (ax !== ay) return ax - ay;
      // 同一到达步：按线序稳定排序（`act` 的"保序"最终落在这一行上）
      return x.seq - y.seq;
    });
    return due[0];
  }

  /** 一个已经排定的到达步（帧在发送的那一步**还没到**，所以有个 +1） */
  function scheduledTick(side: Side, extraTicks: number): number {
    return nowTick + sides[side].link.latencyTicks + extraTicks + 1;
  }

  /** 丢包判定：只对 `beat` 生效，且只用**注入的**随机源 */
  function shouldDrop(side: Side, channel: NetChannel): boolean {
    const st = sides[side];
    if (channel !== 'beat') return false;
    if (st.link.dropNumerator <= 0) return false;
    return st.random() * st.link.dropDenominator < st.link.dropNumerator;
  }

  /** 乱序判定：只对 `beat` 生效，命中时返回 1..reorderTicks 的额外步数 */
  function reorderExtra(side: Side, channel: NetChannel): number {
    const st = sides[side];
    if (channel !== 'beat') return 0;
    if (st.link.reorderTicks <= 0) return 0;
    if (st.random() >= 0.5) return 0;
    return 1 + Math.floor(st.random() * st.link.reorderTicks);
  }

  function takeOut<T>(list: T[], item: T): void {
    const i = list.indexOf(item);
    if (i >= 0) list.splice(i, 1);
  }

  /**
   * 把一帧交给内核排定。返回它的线序。
   *
   * 丢包与乱序**都只在这一处**发生，所以"哪条通道有什么特性"只有一份实现，
   * 变异也只需要改一处。
   */
  function enqueue(side: Side, channel: NetChannel, text: string, extraTicks: number): PendingFrame {
    const frame: PendingFrame = {
      seq: nextSeq,
      channel,
      text,
      from: side,
      to: otherSide(side),
      kind: 'data',
      atTick: null,
      hops: 1,
    };
    nextSeq += 1;
    if (shouldDrop(side, channel)) {
      // 丢了：不进任何队列（`dropped()` 会记一笔，好让测试核对"确实丢了"而不是"没发"）
      droppedCount += 1;
      frame.atTick = null;
      return frame;
    }
    frame.atTick = scheduledTick(side, reorderExtra(side, channel) + extraTicks);
    sides[side].pending.push(frame);
    return frame;
  }

  /**
   * 把一帧交给接收侧（**唯一**的落地处）。三条支路按"这是不是内核内部信号"分：
   *
   *  - `hops === 0`（内核内部信号，目前只有 `close-res`）：**不进 `onMessage`**，
   *    改为把接收侧转成 `offline`（评审 N-2 的整改：让"对手关了"有正规状态信号，
   *    而不是把一条 fake 私有载荷塞进消息流让 T3 判成"未知 t"）；
   *  - `'close-res'` 走正常链路到达（`hops === 1`，测试可以显式排它）：同样按状态信号处理；
   *  - 其余：正常交付给订阅者。
   *
   * 判断用**类型标签**而不是文本相等：载荷是不透明字符串，用文本比对会把
   * "谁恰好发了同样的字节"也算成控制帧。
   */
  function transfer(frame: PendingFrame): void {
    if (frame.kind === 'control-close') {
      const st = sides[frame.to];
      // 接收侧必须知道"对端不见了" —— 这是它唯一的状态信号（N-2）
      setStatus(frame.to, 'offline', '对端已关闭连接。');
      st.live = false;
      st.link.live = false;
      reachable[frame.to] = false;
      return;
    }
    connectors[frame.to]?.deliver(frame.text, frame.channel);
  }

  function makeConnector(side: Side): TransportConnector {
    const st = sides[side];
    return {
      schedule(channel, text, o) {
        const frame = enqueue(side, channel, text, o?.extraTicks ?? 0);
        if (frame.atTick === null) return -1;
        if (!st.live) {
          // 链路不通：帧**不能**留在待到达队列里（它一步都不该前进），挪到待排队列等 `activate`
          takeOut(st.pending, frame);
          st.requeue.push(frame);
          return -1;
        }
        return frame.atTick;
      },
      deliver(text, channel): void {
        for (const cb of [...st.messageListeners]) cb(text, channel);
      },
      setReachable(next, message): void {
        if (reachable[side] === next) return;
        reachable[side] = next;
        setStatus(side, next ? 'online' : 'offline', message);
      },
    };
  }

  /** 改一侧的状态并广播（同状态不重复报） */
  function setStatus(side: Side, to: TransportStatus, message: string): void {
    const st = sides[side];
    const from = st.status;
    if (from === to) return;
    st.status = to;
    st.log.push({ side, from, to });
    for (const cb of [...st.statusListeners]) cb({ from, to, message });
  }

  /** 记一步投递（日志 + 落地的唯一入口，三条支路都要经过这里） */
  function recordStep(frame: PendingFrame): void {
    allSteps.push({
      atTick: nowTick,
      channel: frame.channel,
      from: frame.from,
      to: frame.to,
      seq: frame.seq,
      text: frame.text,
    });
    transfer(frame);
  }

  function pumpOnce(): void {
    nowTick += 1;
    for (const side of ['A', 'B'] as const) {
      const st = sides[side];
      // ★ 内核内部信号（`hops === 0`）**不排队**：它的延迟是固定的 `CONTROL_LATENCY_TICKS`，
      //   与链路延迟、与队列里积压多少帧都无关（理由见 `CONTROL_LATENCY_TICKS` 的注释）。
      const control = pickDeliverable(
        st.pending.filter((f) => f.hops === 0),
        nowTick,
      );
      if (control !== null) {
        takeOut(st.pending, control);
        recordStep(control);
        continue;
      }
      const frame = pickDeliverable(st.pending, nowTick);
      if (frame === null) continue;
      takeOut(st.pending, frame);
      recordStep(frame);
    }
  }

  function makeTransport(side: Side): NetTransport {
    const st = sides[side];
    const connector = connectors[side]!;

    /**
     * 发送的**唯一**实现（是个闭包，不是对象方法）。
     *
     * ★ 为什么抽成闭包（评审 N-5）：原先 `sendIfOpen` 写的是 `this.send(...)`，
     * 于是 `const { sendIfOpen } = t; sendIfOpen('act', 'x')` 会抛
     * `TypeError: Cannot read properties of undefined (reading 'send')` —— 与
     * `transport.ts` 头顶"失败一律返回结果对象、不抛"的纪律直接相左。
     * 抽成闭包之后，`send` 与 `sendIfOpen` 谁都不依赖 `this`，解构随便调。
     */
    function doSend(channel: NetChannel, text: string): SendResult {
      if (st.status === 'closed') {
        return { ok: false, reason: 'closed', message: '这一端已经关闭，不再发送。' };
      }
      if (st.status === 'idle') {
        return { ok: false, reason: 'not-initialized', message: '传输还没 init，先建立连接再发送。' };
      }
      if (st.status !== 'online') {
        return { ok: false, reason: 'offline', message: '对端不可达（掉线或还没连上），这一条没有发出去。' };
      }
      // 链路不通时帧进"待排"队列：这**不算失败** —— 帧已经收下了，`activate()` 会重排它。
      // 真正的失败只在上面那三种状态里（offline 是"对端不在"，链路不通是"这一侧的路断了"）。
      connector.schedule(channel, text);
      st.sendSeq += 1;
      return { ok: true };
    }

    return {
      async init(init: TransportInit): Promise<TransportActionResult> {
        if (st.status === 'online') return { ok: true };
        if (st.status === 'closed') {
          return { ok: false, reason: 'closed', message: '这一端已经关闭，不能重新打开（closed 是终态）。' };
        }
        st.selfId = init.selfId;
        st.peerId = init.peerId;
        // ★ 两条自洽规则（评审 N-1）。
        //
        // 病是：`deactivate()` 之后调 `init()`，状态会从 offline **说成 online**，
        // 而 `reachable[side]` 仍是 false、`setReachable(false)` 也不会再触发 ⇒ 状态永久说谎；
        // 此后 `send` 回报成功而帧只烂在 requeue。
        //
        // 规则一：`init()` 是"把这一侧的链路开起来"的动作，所以它要**同时**把本侧链路置通
        //   （否则 `live === false` 与 `status === 'online'` 会长期并存，`send` 一直成功、
        //   帧一直进 requeue —— 那正是"状态说谎"的下一站）。
        // 规则二：**对端**不可达时不许转 `online`，而是回一个可读的失败结果 ——
        //   单向插线是连不上的（对端自己得调 `init()`），这条正是 N-1 的核心。
        st.live = true;
        st.link.live = true;
        reachable[side] = true;
        if (!reachable[otherSide(side)]) {
          setStatus(side, 'offline', '本端链路已就绪，但对端仍不可达。');
          return {
            ok: false,
            reason: 'offline',
            message: '对端仍不可达（对端那条链路还没接回来，或对端已经关闭）。这一端没有转成 online。',
          };
        }
        setStatus(side, 'online', '已建立连接。');
        return { ok: true };
      },
      // 每次给一份**新数组**：直接返回模块常量会让调用方能改到共享的那份（评审 N-8）
      channels: (): readonly NetChannelSpec[] => [...CHANNEL_SPECS],
      seq: () => st.sendSeq,
      send: doSend,
      sendIfOpen(channel: NetChannel, text: string): SendResult {
        const r = doSend(channel, text);
        if (!r.ok) for (const cb of [...st.errorListeners]) cb(r);
        return r;
      },
      async close(): Promise<TransportActionResult> {
        if (st.status === 'closed') return { ok: true };
        if (st.status === 'idle') {
          return { ok: false, reason: 'not-initialized', message: '还没 init 就 close：没有连接可关。' };
        }
        setStatus(side, 'closed', '本端已主动关闭这条连接。');
        // ★ `close-res` 是**内核内部信号**（评审 N-2）：它不进 `onMessage`（否则 T3 的解码器
        //   会把它判成"未知 t"），而是到达时把对端转成 `offline`。它照常占一次调度，
        //   延迟固定为 `CONTROL_LATENCY_TICKS`（不随链路延迟漂移），且**不看链路开关**
        //   —— 对方必须能听到"这一端关闭了"。
        const frame: PendingFrame = {
          seq: nextSeq,
          channel: 'act',
          text: CLOSE_RES_TEXT,
          from: side,
          to: otherSide(side),
          kind: 'control-close',
          // 内部信号的到达步**固定为当前步 + CONTROL_LATENCY_TICKS**（不受 `latencyTicks`
          // 影响，也不排 `pickDeliverable` 的队）：`CONTROL_LATENCY_TICKS` 的全部意义就是
          // "控制帧的节奏与玩家数据的延迟无关"（见它的注释）。写成 `scheduledTick(...)`
          // 会把它偷偷绑回 `latencyTicks` 上 —— 第一版就是这么写的，实测在默认延迟下
          // 得到 2 而不是 1。
          atTick: nowTick + CONTROL_LATENCY_TICKS,
          hops: 0,
        };
        nextSeq += 1;
        st.pending.push(frame);
        return { ok: true };
      },
      onMessage(cb): () => void {
        st.messageListeners.push(cb);
        return () => takeOut(st.messageListeners, cb);
      },
      onStatus(cb): () => void {
        st.statusListeners.push(cb);
        return () => takeOut(st.statusListeners, cb);
      },
      onError(cb): () => void {
        st.errorListeners.push(cb);
        return () => takeOut(st.errorListeners, cb);
      },
      status: () => st.status,
    };
  }

  function makePort(side: Side): FakePort {
    const st = sides[side];
    // 顺序不能反：`makeTransport` 一开始就抓走 `connectors[side]`，所以必须先建连接器。
    // 第一版写反了，症状是 `send` 在 `connector.schedule` 上抛 "Cannot read properties of undefined"
    // —— 一个看起来像"传输坏了"、实际是初始化次序错的错误。
    connectors[side] = makeConnector(side);
    st.transport = makeTransport(side);
    return {
      side,
      transport: st.transport,
      configure(config: LinkConfig): void {
        const next = resolveLink(config, st.link);
        st.link.live = next.live;
        st.link.latencyTicks = next.latencyTicks;
        st.link.dropNumerator = next.dropNumerator;
        st.link.dropDenominator = next.dropDenominator;
        st.link.reorderTicks = next.reorderTicks;
        st.live = next.live;
      },
      config: () => ({ ...st.link, live: st.live }),
      pendingRequeueCount: () => st.requeue.length,
      activate(): void {
        // ★ **不许**写 `if (st.live) return;` 这样的早退：
        //   `init()` 也会把 `st.live` 置真，于是"`deactivate()` → `init()`（失败）→ `activate()`"
        //   这条顺序下 `live` 已经是 true ⇒ 早退 ⇒ 两个 `reachable` 标志停在上一次的 false 上
        //   ⇒ 之后 `send` 一直失败、`init` 一直报"对端仍不可达"。实测踩过这一条。
        //   幂等：重复 `activate()` 只是把同样的状态再置一遍（`setReachable` 在同值时不出事件）。
        st.live = true;
        st.link.live = true;
        // 拔线时两端都转过 offline（见 `deactivate`），所以"线接回来"也要把两端转回 online ——
        // 否则 `activate()` 之后 `send` 仍然一律失败。
        //
        // ★ 顺序是**先转状态、再强置标志**，两件事都不能省（这一条实测踩了两次）：
        //   - 先强置标志再调 `setReachable` 会让它的 `reachable[side] === next` 早退 ⇒
        //     状态永远留在 offline（实测：日志里 `setReachable side=A next=true cur=true`
        //     之后 `setStatus` 一次都没被调到）；
        //   - 只调 `setReachable` 不置标志，则当标志**已经是** true、状态却是 offline 时
        //     （`init()` 只置本侧标志就会造成这种不一致）同样会早退。
        connectors[side]?.setReachable(true, '本端链路已恢复。');
        connectors[otherSide(side)]?.setReachable(true, '对端链路已恢复。');
        reachable[side] = true;
        reachable[otherSide(side)] = true;
        const queued = st.requeue.splice(0, st.requeue.length);
        for (const frame of queued) {
          // 控制帧不该参与乱序，也不该重新抽随机数：它的到达步永远是
          // "当前步 + CONTROL_LATENCY_TICKS"（内部信号不排队，见 `pumpOnce`）。
          // 早先这里对所有帧一律走 `reorderExtra`，于是拔线期间攒下的帧会让随机序列
          // 与"拔过几次线"相关（评审在自评复核里点出的"随机源消费顺序"问题）。
          frame.atTick =
            frame.hops === 0
              ? nowTick + CONTROL_LATENCY_TICKS
              : scheduledTick(side, reorderExtra(side, frame.channel));
          st.pending.push(frame);
        }
      },
      deactivate(): void {
        if (!st.live) return;
        st.live = false;
        st.link.live = false;
        // 拔线是**双向**的：本端发不出去，对端也收不到 —— 所以两端一起转 offline。
        // 这条通知让 UI 立刻反映"对手已断线"，而不是等下一帧超时（T6 的判据 1 依赖它）。
        connectors[side]?.setReachable(false, '本端链路已断开。');
        connectors[otherSide(side)]?.setReachable(false, '对端链路已断开（对手掉线）。');
      },
      schedule(channel: NetChannel, text: string, when: ScheduleWhen = NOW): number {
        const extra = when.kind === 'now' ? 0 : when.ticks;
        // ★ 返回的是**线序**（`earliestTick` 按它查），不是到达步 —— 两者都是数字，
        //   第一版把到达步返回出去，症状是"刚排完就查不到"（`earliestTick(2)` 找的是 seq 2，
        //   而当时 seq 只有 0）。这一族的错法在数字类型上完全不可见，只能靠断言暴露。
        return enqueue(side, channel, text, extra).seq;
      },
      earliestTick(seq: number): number | undefined {
        // 两个队列都要找：链路不通时帧被挪进 `requeue`（它仍然"排在那儿等上线"，
        // 只是还没有到达步）。第一版只找 `pending`，症状是"刚 schedule 完就查不到"。
        for (const frame of st.pending) if (frame.seq === seq) return frame.atTick ?? undefined;
        for (const frame of st.requeue) if (frame.seq === seq) return frame.atTick ?? undefined;
        return undefined;
      },
      async close(): Promise<number | null> {
        if (st.status === 'idle' || st.status === 'closed') return null;
        if (st.transport === null) return null;
        await st.transport.close();
        for (const frame of st.pending) if (frame.kind === 'control-close') return frame.seq;
        return null;
      },
      reopen(): void {
        if (st.status !== 'closed') return;
        setStatus(side, 'online', '连接已重建。');
      },
      sendSeq: () => st.sendSeq,
    };
  }

  return {
    A: makePort('A'),
    B: makePort('B'),
    setLatencyTicks(aToB: number, bToA: number): void {
      sides.A.link.latencyTicks = aToB;
      sides.B.link.latencyTicks = bToA;
    },
    pump(n = 1): void {
      for (let i = 0; i < n; i += 1) pumpOnce();
    },
    tick: () => nowTick,
    steps: () => allSteps,
    dropped: () => droppedCount,
    statusLog: () => sides.A.log.concat(sides.B.log),
  };
}
