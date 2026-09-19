/**
 * 锁步联机驱动 `net-driver.ts`（G5 T5；见 `docs/2026-09-17-G5-传输层联机-实现计划.md` §5 T5、
 * §4 的 D1 / D16 / D19 / D20 / D21、设计稿 `docs/2026-09-13-联机与多端-设计稿.md` §0.3 裁决 #7
 * 与 §0.4 红线 2）。
 *
 * ## 它解决什么
 *
 * 把"一条操作记录"在两个端之间同步，并实现 G4 的 `MatchDriver` 契约
 * （`src/app/match-driver.ts:105`）。同步模型是**锁步**（D1 / 裁决 #7）：
 *
 *  - 两端**都**跑引擎，只交换操作记录；
 *  - `submit(s, a)` = "把这条记录交给传输 + **本地**应用它"；
 *  - 收到对端的 `act` = "**同样**应用它"；
 *  - 主机**不做**权威校验（红线 2，设计稿 `:47`）。
 *
 * 主机与从机的差别只有 D1 说的那三件事（种子与硬币的所有权 / 会话身份 / 重连凭据），
 * 而这三件都不在本模块里：硬币与承诺归 `src/net/session.ts`（T3），重连凭据归 T6。
 * 所以本模块**两端共用一份实现**，构造时只区分 `seat` 与 `recorder`。
 *
 * ## ★ `applyRecordedAction` 是本模块唯一改引擎状态的地方（判据 3）
 *
 * 全仓"`ActionRecord` → 引擎调用"的映射只有一处：`src/app/match-replay.ts:83`。
 * `src/net/**` 里 `executeAction(` 与 `resetControlIfHeld` **零命中**，由
 * `tests/net/net-driver.test.ts` 的文本腿钉住。这不是洁癖：同一份 `switch` 曾在现场与测试
 * 各有一份，"档案能重放"因此有两个可能各自漂移的定义（`match-replay.ts` 头注第 1 条）。
 *
 * 于是本文件里只有两个调用点，且都写着同一句：
 *  - `submit` 的成功分支（本端是行动方）；
 *  - `receiveAct` 的成功分支（对端是行动方）。
 *
 * ★ **本任务最重要的那条缺陷族正好住在这里**：收到对端 `act` 时**只推进序号、不落地语义**
 * （"动作发生了、语义没发生"）。所以 `applyOnce` 里那行 `applyRecordedAction(s, record)`
 * 必须留在原位，注释与测试都不要把它改写成"信任对端已应用"。
 *
 * ⚠️ **这条缺陷今天是被哪条腿抓住的**（T5 阶段一评审实测后更正，原来的说法不准）：
 * 不是"每步之后两端指纹相等"那条差分腿抓的 —— 差分腿判的是"两端**相等**"，
 * 而"两端都只推进序号、都不落地"恰恰相等（M1 在位时那 60 次比对一次都没红；
 * 真红的是同一 `describe` 里的**反空转**断言）。⇒ 这条路径的牙长在：
 *  ① 判据 1 的四句反空转（`appliedSteps` / 两个座位 / kind 种类 / 指纹取值数）；
 *  ② 判据 1 里"**只 `arm` 不 `submit`**"那条腿（它直接断言对端落地了语义）；
 *  ③ 探针 M1（`.superpowers/g5-T5/probes/`，独立于判据文件）。
 * 差分腿与记录器腿负责的是**不对称**的错（一端动了、另一端没动）。三者的分工别记错。
 *
 * ## 为什么驱动**不持有** `GameState`（照 G4 D2 的既有结构约束）
 *
 * `submit(s, …)` 的 `s` 是**宿主传进来的**那个状态，也是唯一的被推进对象：驱动没有私有副本、
 * 没有缓存、没有 getter。`src/app/match-driver.ts:32-45` 记着这条约束的代价（两条各自改状态的
 * 路 ⇒ 永久分叉且不报错）。本模块照办，代价写在 `pendingTexts` 的注释里，队列深度可以由
 * `pendingCount()` 读到（T6 落地上限时要用它）。
 *
 * ## 序号：`seq` 就是"已应用的条数"（唯一的顺序依据）
 *
 * `ActionRecord.seq` 是**档案层的位置**（`match-file.ts:21`），两端各自从 `0` 起算
 * ⇒ 每成功应用一条，`applied + 1`，而"下一条该是几"就是 `applied`。
 * 收到 `act` 时先比 `act.seq === applied`：不等就是**错位**（重放 / 丢帧 / 半截发送），
 * 记诊断并**不推进序号**。`ActMsg` 里 `seq` 与 `action.seq` 是同一件事写了两次
 * （`protocol.ts:188-190`：让接收方在解析这一步就发现错位），本模块把两者都比一遍。
 *
 * ## 为什么不在这里"按 seq 重放"来自证同步（与 T4/T6 的分工）
 *
 * "某一时刻的状态"的**单数第一出处**是 `src/app/match-replay.ts:260` 的 `stateAtStep(f, n)`
 * （D9 / T4）。本模块**不**自己再拼一个"按 seq 重放"的循环：那是 T6 追平的活，写在这里就是
 * 第二份映射。同理，这里也**不**因为"顺手"去接通 `resuming` 相位（D19 明写那是 T6 的事）。
 *
 * ## 拒绝码的分工（D16，三者不许混用）
 *
 * | 码 | 什么时候 | 为什么不能合并 |
 * |---|---|---|
 * | `'offline'` | 传输此刻不在 `online`（对端不可达 / 掉线 / 还没连上），**或** `send` 返回失败 | 它是"暂时不在"，会好 |
 * | `'read-only'` | `dispose()` 之后 | 它的原义就是"这局结束了"（`match-driver.ts:93-95`） |
 * | `'not-the-next-action'` | 不是本端回合 / 顺序未到 / 引擎拒绝 | 它是**本端策略**的拒绝，与网络状态无关 |
 *
 * `'offline'` 的产出面比"对端不可达"这句话宽一点，如实写清（`submit` 里那张表是权威版）：
 * 它覆盖 `send` 失败的 `'offline'` / `'closed'` / `'queue-full'` 三种来源。
 * 它们对调用方是**同一个可行动事实**（"这一条没发出去"），所以共用一个码；
 * 但玩家文案要分得清这三件事（归 T8）。
 *
 * `'offline'` 是 T5 给 `SubmitRefusal` 新增的那个值（D16）：`'read-only'` 的原义
 * **一个字都不改**。这里也不去动 `'read-only'` 在 `match-driver.ts` 里的既有说明。
 *
 * ## 计时
 *
 * 一条都没有。本模块不直呼定时器（计划 §2 第 2 条），也没有用到 `Ticker`：锁步的节奏由
 * **对端消息**与**宿主提交**推动，没有"等一会儿再做下一件事"这种需求。将来若真需要
 * （G6 的回合计时），一律走注入的 `Ticker`（`src/app/match-driver.ts:128`）。
 *
 * ## 已知边界（如实登记，别当成零）
 *
 *  1. **分叉不能修，只能被发现**（D1 的代价）。本模块提供的是"每步之后能拿去比对的两份状态"，
 *     检测那一半由调用方做（测试就是这么做的）。本模块自己**不**比对指纹 —— 那需要一份
 *     参考状态，而驱动恰好不持有状态。
 *  2. **不校验动作的合法性**：本端把记录交给引擎，引擎的守卫抛错就转成 `'not-the-next-action'`
 *     并把原因留在 `lastFailure()` 里。这里**不写第二份校验层**（它改了不会静默漂移，
 *     这是 `match-driver.ts:61-62` 的同一条取舍）。
 *  3. **`dispose()` 之后的入站消息一律丢弃**：`onMessage` 已退订，这是有意的 —— 一局结束之后
 *     再应用对端的操作会把已经交付的状态改脏。
 *  4. **入站队列有上限（T6 落地，2026-09-18）**：上限 `inboundCapacity`（缺省
 *     `DEFAULT_INBOUND_CAPACITY`），溢出时**不静默丢** —— 报一条 `'inbound-overflow'`
 *     失败（`lastFailure()` / `onFailure` 都能读到）+ 计数（`inboundOverflowCount()`），
 *     由调用方把它转成会话层的 `needsResync`（`session.ts` 的 `noteResyncNeeded`）。
 *     T5 当初"不设上限"的理由（`act` 可靠保序、丢一条即分叉）**仍然成立**，所以这里的处置
 *     不是"丢掉多余的就算了"，而是"**承认本端跟不上了，去走一次追平**"。
 *     **恢复路径（修复轮补，2026-09-18）**：溢出之后本地状态已经不可信，唯一诚实的出路是
 *     拿房主的档案重建（T6 的 `resync`），重建之后调用方**必须**调一次 `realign(n)`
 *     把本驱动的进度事实（`applied`）对齐到重建后的那一步并清掉卡住的帧 —— 没有这一步，
 *     溢出会被"标出来"但**永远恢复不了**（之后每条入站 `act` 都 `seq-mismatch`）。
 *     `realign()` 就是那条口。**仍有一处缺口如实登记**：房主那一侧溢出**没有出路**
 *     （协议里只有加入方能发 `resync-req`，而档案只在房主手里）⇒ 房主溢出 = 这一局只能由上层结束。
 */

import type { GameState, PlayerId } from '../core/models/types';
import { normalizeAction } from '../app/match-file';
import type { ActionRecord, AppActionKind, MatchFileRecorder } from '../app/match-file';
import type { MatchDriver, SubmitResult } from '../app/match-driver';
import { applyRecordedAction } from '../app/match-replay';
import { draftNextAction } from '../core/state/create';
import { decodeMsg, encodeMsg } from './protocol';
import type { ActMsg } from './protocol';
import type { NetChannel, NetTransport, StatusChange } from './transport';

/* ------------------------------------------------------------------ *
 * 1. 对外形状
 * ------------------------------------------------------------------ */

/**
 * `mode` 的取值。与 `src/app/match-driver.ts` 的 `DriverMode` 里那个 `'net'` 是同一个词。
 *
 * 为什么用常量而不是在对象字面量里直接写 `mode: 'net'`：`NetDriver` 的 `mode` 类型写成
 * `typeof NET_DRIVER_MODE` 之后，"这个驱动是联机驱动"这件事就只有一个出处 ——
 * 改这里忘了改那里是编译错误，而不是一个静默的不一致。
 */
export const NET_DRIVER_MODE = 'net' as const;

/**
 * 入站队列的**缺省上限**（帧数；T6 落地，2026-09-18）。
 *
 * ## 这个数是什么、不是什么（按阶段一评审的意见改写，2026-09-18）
 *
 * 它是**一个可注入的缺省值，不是一句承诺**。
 *
 *  - 队列里攒的是"**已经到了本端、但宿主还没把状态递进来**"的帧（见 `pendingTexts`），
 *    正常深度是 **0 到个位数**（T8 在收到帧时/每次重渲染前 `arm(state)`）⇒ 上限的作用
 *    不是"流控"，而是一个**内存安全阀**；
 *  - 256 这个数今天的依据只有两条：T5 那套夹具的规模（整局 60 步 ⇒ 256 ≈ 四局）与内存量级
 *    （256 × 一条 `act` 帧的大小）。**本仓今天没有任何"一局最多多少步"的读数**，所以
 *    "256 够大"**不能**被读成"正常接线不会溢出" —— 它能被读到的最强含义只是
 *    "碰不到它说明一切正常，碰到它说明本端已经停摆很久"；
 *  - 真正需要按负载调的场景，调用方**自己传 `inboundCapacity`**（判据腿就是把它设成 1
 *    来构造非零溢出的）。
 */
export const DEFAULT_INBOUND_CAPACITY = 256;

/**
 * 本模块登记的一次失败。形状照本仓的既有惯例：`reason` 是给分支用的**事实码**，
 * `message` 是给人看的**真因**（面向玩家的文案由 `src/ui` 决定，纯层不产玩家文案）。
 *
 * 为什么要有这个读数（而不是只写进注释）：网络来的东西可能坏（截断、未知类型、序号错位），
 * 而**静默丢弃**会让"对端明明发了、本端就是不动"变成无法调试的问题 ——
 * `src/app/match-file.ts:230-236` 的同族取舍（"一份数据五处复用最怕的静默错位"）。
 */
export type DriverFailureReason =
  /** 收到的帧不是一条能解码的协议消息（`decodeMsg` 的四种失败：截断 / 非 JSON / 未知类型 / 版本不符） */
  | 'undecodable'
  /** 对端的 `act` 与"下一条"对不上（重放 / 丢帧 / 半截发送） */
  | 'seq-mismatch'
  /** 引擎在应用**对端**那一条时抛错（未覆盖的 kind 或引擎守卫） */
  | 'peer-action-refused'
  /** 本端提交被引擎拒绝，或本端的操作编不成协议消息（原因在 `message` 里） */
  | 'local-action-refused'
  /**
   * **入站队列满了**，这一帧没有被收下（T6）。
   *
   * 它是一条**真失败**，不是"丢弃"：本端已经跟不上对端（差了一整段操作），本地状态不可信，
   * 唯一的出路是走一次追平（`resync`）。调用方应当把它转成会话层的 `needsResync`
   * （`session.ts` 的 `noteResyncNeeded('queue-overflow', …)`），别让它只留在日志里。
   */
  | 'inbound-overflow'
  /**
   * **`realign()` 之后的第一条入站 `act` 序号对不上**（T6 收尾轮补；D16 的先例）。
   *
   * ## 为什么要与 `'seq-mismatch'` 分开（同一个值不许承载两个含义，D16）
   *
   * 两者对调用方是**两件不同的事**：
   *  - `'realign-mismatch'`：本端刚 `realign(n)` 过，收到的却是第 m 条（m ≠ n）
   *    ⇒ **多半是调用方传错了 `realign` 的值**（少算/多算一条）。`message` 里带着对齐时的步数；
   *  - `'seq-mismatch'`：不在 `realign` 之后 ⇒ 是**对端跳号 / 丢帧 / 重放**那一族，
   *    指向网络与对端（T5 原本的语义，一个字不改）。
   *
   * 为什么只报**第一条**（**这一句按复验人的实测写实，别再写成"之后回到 `seq-mismatch`"**）：
   * 第一条 `realign-mismatch` 会把那条帧钉进 `stuck`，而 `drain` 每轮开头就是
   * `if (stuck !== null) return` ⇒ **后续帧根本不再被检查**（复验人实测：再喂第二条不匹配，
   * `lastFailure()` 连 message 都逐字未变、`pendingCount` 就停在 1）。
   * ⇒ 想看到**下一条**可区分的失败，调用方必须先**再调一次 `realign()`**（那时 `stuck` 被清掉、
   * `realignUnreported` 重新置位）；也就是说它是"**每次 `realign` 之后各一条**"，
   * 不是"整个进程只报一次"。
   */
  | 'realign-mismatch';

export interface DriverFailure {
  readonly reason: DriverFailureReason;
  readonly message: string;
}

export interface NetDriverOptions {
  /** 本端链路。**必须已经 `init` 过**（`init` 之前 `send` 会返回 `'not-initialized'`，那是调用顺序错） */
  readonly transport: NetTransport;
  /** 本端座位。它决定"轮到谁"：本端只在 `turnPlayer === seat`（或本方是挂起选择的应答者）时才收输入 */
  readonly seat: PlayerId;
  /**
   * 记录器。主机把它交给 `MatchFileRecorder`（T6 的 `resync` 要用
   * `MatchFileRecorder.actions()`，`src/app/match-file.ts:516`）；从机可以是 `null`。
   *
   * **两端记录的是同一条序列**：本端提交的那条与收到对端的那条都进记录器，`seq` 由记录器
   * 按自己的长度编号（**不**用对端给的 `seq` 覆盖它）—— 它只接受 `Omit<ActionRecord, 'seq'>`
   * （`match-file.ts:508`），编号本来就是它的事。
   */
  readonly recorder?: MatchFileRecorder | null;
  /**
   * 订阅入站帧（缺省 = 从 `transport.onMessage` 订阅）。**测试的注入点**：用它可以在
   * 不建传输的情况下测"宿主从没递过状态"这条边界（见 `pendingTexts` 的注释）。
   * 名字与 `NetTransport.onMessage` 一致：换实现的人不必记两套口径。
   */
  readonly onMessage?: (cb: (text: string, channel: NetChannel) => void) => () => void;
  /**
   * 入站队列的帧数上限（T6；缺省 `DEFAULT_INBOUND_CAPACITY`）。
   *
   * **可注入**的理由是可测性：上限必须是"能在测试里非零地构造出溢出"的东西，
   * 否则"溢出时会发生什么"这条判据只能靠读代码相信。判据腿把它设成 1、喂两条 `act`
   * （`inboundCapacity: 1` ⇒ 第二条落地时那条 `'inbound-overflow'` 必然出现）。
   *
   * **下界校验**（修复轮补，2026-09-18）：`< 1` 或非整数**当场抛**（照 `commitFace` 那条
   * "调用方违约就抛"的既有口径）。阶段一评审实测过 `0` / `-1` 的后果：**每一帧**都被判溢出
   * ⇒ 队列永远是空的、"溢出"这个信号失去区分力（它不再表示"本端跟不上了"，只表示"配置写错了"）。
   */
  readonly inboundCapacity?: number;
}

export interface NetDriver extends MatchDriver {
  readonly mode: typeof NET_DRIVER_MODE;
  /**
   * 本端链路（只读暴露，供 T6/T8 查 `status()` 与 `channels()`）。
   * 状态**变化**的订阅走下面的 `onStatus`（它转发的就是这条链路的事件）。
   */
  readonly transport: NetTransport;
  /**
   * 订阅**链路状态变化**（返回退订函数）。
   *
   * 为什么本驱动要转一手（而不是让调用方直接订阅 `transport.onStatus`）：`acceptsInput()`
   * 的答案是"回合 **且** 在线"，而**在线那一半会变**（对端掉线 / 重连）。UI 要据此把棋盘
   * 切成只读、或把可点的牌变灰，就必须知道"这一刻该重新问一次 `acceptsInput()`"。
   * 直接订阅传输当然也行（那是同一个事实源），但那样每个调用方都要自己记住"状态变化时要
   * 重算 `acceptsInput`"，而漏掉它的症状是**界面停在可操作态、点了却没反应**。
   *
   * 它只转发、不加工：`StatusChange` 原样给出（`src/net/transport.ts:165`），
   * 不在这里派生出"所以你能不能动"这种判断（那要宿主手里那份状态，驱动拿不到）。
   */
  onStatus(cb: (change: StatusChange) => void): () => void;
  /** 已应用的操作条数（**也就是下一条的 `seq`**）。主机可以拿它与记录器对账 */
  appliedSteps(): number;
  /**
   * **把进度事实对齐到重建后的那一步**（T6 修复轮补，2026-09-18；入站队列溢出的恢复路径）。
   *
   * ## 为什么必须有它（阶段一评审的阻断级发现）
   *
   * 溢出之后本端能做的唯一诚实的事是"拿房主的档案重建本地状态"（T6 的 `resync` +
   * `stateAtStep`）。但重建的是**宿主手里那份 `GameState`**，而驱动另有一个进度事实
   * `applied`（= 下一条 `seq`），外加一个 `stuck` 槽位（溢出时那条序号对不上的帧会被钉在那里，
   * 而它**只有 `dispose()` 会清**）。两者不对齐的后果是：会话层把 `needsResync` 清成 `false`、
   * 相位也放回去了，**但驱动这一侧之后每一条入站 `act` 都继续 `seq-mismatch`**
   * ⇒ "标记清掉了、状态没救回来"。调用方调一次本方法就把这条路走通。
   *
   * ## 语义（三件，别多想）
   *
   *  - `appliedSteps` = **重建后的状态已经应用了多少条操作**（也就是下一条的 `seq`）；
   *  - 清掉 `stuck`（那条帧属于重建前的那一段，它的序号已经没有意义了）；
   *  - 清空入站队列（同上：队里那些帧全是重建前的世界留下来的）。
   *
   * `inboundOverflowCount()` **不清** —— 它是"本端曾经跟丢过"的历史事实，清掉就等于抹证据。
   *
   * ## 纪律
   *
   *  - **它是调用方的动作，不是驱动自己的行为**：驱动不持有状态、也无从知道"重建到哪一步"，
   *    所以这里是"你告诉我"（与 `arm(state)` 同一族的口，都是宿主把事实递进来）；
   *  - `appliedSteps` 非整数 / 负数 = **调用方违约 ⇒ 抛**（照 `commitFace` 的口径）；
   *  - `dispose()` 之后是 no-op（同 `arm`）。
   */
  realign(appliedSteps: number): void;
  /**
   * 入站队列**还没落地**的帧数（只读读数）。
   *
   * ## 为什么要有它（T5 阶段一评审交办；队列上限本身归 T6）
   *
   * 队列无上限这件事计划 §5 T6 判据 7 已经判归 **T6**，而 T6 要落地"上限 + 溢出标
   * `needsResync`"时，必须能读到"现在积压了多少"。没有这个读数，T6 只有两条路：
   * 改**本文件**（那就是第二次越界改 T5 的交付物，证据链要重走），或者从外面拿
   * `transport.steps()` 减 `appliedSteps()` 去估（那是一份**近似的第二真相**，
   * 而且它对 `close-res` / `beat` 这类非 `act` 帧会数错）。
   * ⇒ 加一个只读读数，把 T6 的裁决留在 T6 自己手里。今天**没有任何生产调用方**读它，
   * 这一点如实登记（"将来谁会用到"不作为存在理由，这里的理由是为下一个任务留口）。
   *
   * 语义说清三件（免得被当成别的东西）：
   *  - 它数的是 `pendingTexts`（已到达、**还没被解码落地**的帧），**不含** `stuck` 那一帧
   *    （那一帧已经判定为错位、已经离开了队列，见 `pendingCount` 的实现）；
   *  - 它**不**区分 `act` 与别的消息（`drain` 只在消费时才解码分类）⇒ 它是"待处理帧数"，
   *    不是"待应用操作数"；
   *  - 它**不含**"在传输层排队、还没到达本端"的帧（那要问传输）。
   *
   * ## ★ 归属分工（T6 复验人点名要写进代码的一句）
   *
   * 本读数 **只答"驱动侧入站队列"**。**传输侧**那一半（还压在 `send` 队列 / `bufferedAmount`
   * 上的帧）今天**没有**队列深度读数 —— 只有 `send` 的 `'queue-full'` **失败信号**
   * （`transport.ts:99-101`）。⇒ **不许**把 `pendingCount() === 0` 读成"全网没有积压"：
   * 它只说"已经到本端、还没落地的帧是 0"。
   * 本任务**不**为这条语义配腿/扩接口：要读传输侧深度就得改 T2 的 `NetTransport`
   * 形状（那是 T2 的交付物），而复验人的判定是"不需要为它配腿"。玩家文案由 T8 按
   * `'queue-full'` 那条失败信号单独分支。
   */
  pendingCount(): number;
  /**
   * **入站队列溢出过多少次**（T6 落地上限时加的读数；`0` = 没溢出过）。
   *
   * 为什么要一个**计数**而不是只看 `lastFailure()`：`lastFailure` 会被后来的失败覆盖
   * （它是"最近一次"），而"溢出这件事发生过"是一个**不可逆的事实** —— 本端曾经跟丢过，
   * 本地状态从此不可信。计数是这条事实唯一的可读证据（判据 7 的腿要断言
   * "另一条被**记成溢出**"而不是"它不存在"）。
   */
  inboundOverflowCount(): number;
  /**
   * 把**当前状态**交给驱动，并顺手消费排队中的入站帧。
   *
   * ## 为什么必须有这个口（不是测试用的旁门）
   *
   * 本驱动的入站消息是**推送**的（`transport.onMessage` 在对端发消息那一刻回调），而驱动
   * **不持有 `GameState`**（G4 D2 的结构约束：驱动持有状态会长出"两条各自改状态的路"，
   * 代价是一个不报错的分叉）。两条合起来的后果是：回调里拿不到要应用的那份状态。
   *
   * ⇒ 宿主必须在"帧到达之后、下一次 `submit` 之前"把状态递进来。`submit(s, …)` 自己也会
   * 递（它在判断之前先 `drain`），但**不能只靠它**：一整局里可能连着来几步对端的操作，
   * 而宿主只在轮到自己时才 `submit`；那几步就会一直烂在队列里（一个不报错的停摆）。
   * T8 的接线应在收到帧时调 `arm(state)`（或每次重渲染前调一次）。
   *
   * 幂等、可重复调用；`dispose()` 之后是 no-op。
   */
  arm(s: GameState): void;
  /**
   * 喂一条**原始文本**进来（与 `transport.onMessage` 的回调同一条路）。
   *
   * 存在的理由：测试要能直接构造"坏帧"（重放 / 序号错位 / 截断），而那类输入**不该**
   * 经过 fake 传输（它搬的是不透明字符串，不产坏帧）。生产代码不调它。
   */
  feedText(text: string, channel?: NetChannel): void;
  /** 最近一次失败（`null` = 还没有过） */
  lastFailure(): DriverFailure | null;
  /** 订阅失败事件（返回退订函数）。**不抛**：网络来的坏输入不是异常 */
  onFailure(cb: (failure: DriverFailure) => void): () => void;
}

/* ------------------------------------------------------------------ *
 * 2. 小助手
 * ------------------------------------------------------------------ */

function isActMsg(msg: unknown): msg is ActMsg {
  return typeof msg === 'object' && msg !== null && (msg as { t?: unknown }).t === 'act';
}

function describeError(e: unknown): string {
  if (e instanceof Error) return e.message;
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}

/* ------------------------------------------------------------------ *
 * 3. 实现
 * ------------------------------------------------------------------ */

export function createNetDriver(opts: NetDriverOptions): NetDriver {
  const transport = opts.transport;
  const seat = opts.seat;
  const recorder = opts.recorder ?? null;

  /**
   * 已应用的操作条数 = 下一条的 `seq`。
   *
   * 它是**唯一的进度事实**，没有第二份副本：`appliedSteps()` 直接读它，收到 `act` 时比它，
   * 成功应用之后加一。两端各自从 0 起算 ⇒ 它同时是"两端同一位置"的锚。
   */
  let applied = 0;
  let disposed = false;
  let failure: DriverFailure | null = null;
  let lastKnownState: GameState | null = null;
  const failureListeners = new Set<(f: DriverFailure) => void>();
  const statusListeners = new Set<(change: StatusChange) => void>();

  /**
   * 宿主还没把状态递进来时先收下的帧。
   *
   * 为什么要有它：`transport.onMessage` 是**推送**（对端发消息那一刻回调），而驱动不持有状态
   * ⇒ 回调里没有 `GameState` 可应用。硬要在那里应用就必须让驱动持有状态，那正是 G4 D2
   * 禁止的形状（`match-driver.ts:32-45`），代价是一个不报错的分叉。所以入站帧先排队，
   * 由宿主带着状态的下一次动作（`submit` / 下一帧落地）来消费它。
   *
   * ## 上限与溢出（T6 落地；原来那句"无上限"已作废）
   *
   * T5 当初不设上限的理由是：`act` 是可靠保序通道（D11），对端发多少条就有多少条**该**被应用，
   * 丢任何一条都等于分叉，设一个上限只是把分叉推迟到更难查的地方。
   * **那条理由没有被推翻**，所以这里的处置不是"丢掉多余的就算了"，而是：到上限时
   * **这一帧不收下**（`enqueue` 的溢出分支）＋ 报一条可读失败 ＋ 计数，由调用方折成会话层的
   * `needsResync` —— 也就是"**承认本地跟不上了，去走一次追平**"（房主手里那份档案才是权威，
   * 见 `session.ts` 的 `resync` 那一支）。静默 `shift()` 掉最旧的一条正是本仓最恨的形态
   * （"动作发生了、语义没发生"）；变异 M7 就是把它改成那个样子。
   */
  const pendingTexts: string[] = [];

  /**
   * 入站队列的帧数上限（可注入；见 `NetDriverOptions.inboundCapacity` 与 `DEFAULT_INBOUND_CAPACITY`）。
   *
   * **下界校验**（修复轮补）：`0` / 负数 / 非整数是**调用方违约**（不是网络输入），当场抛。
   * 阶段一评审实测过不抛的后果 —— 每一帧都判溢出 ⇒ 队列恒空、"溢出"这个信号不再表示
   * "本端跟不上了"而只表示"配置写错了"，判据与文案都会读到假话。
   */
  const capacityOpt = opts.inboundCapacity ?? DEFAULT_INBOUND_CAPACITY;
  if (!Number.isInteger(capacityOpt) || capacityOpt < 1) {
    throw new Error(
      `net-driver.ts 的 inboundCapacity 必须是 ≥ 1 的整数（收到 ${String(opts.inboundCapacity)}）；` +
        '这是调用方违约，不是网络输入 —— 上限为 0 会让每一帧都被判溢出，信号就失去区分力。',
    );
  }
  const inboundCapacity = capacityOpt;

  /** 溢出过多少次（"本端曾经跟丢过"是一条不可逆的事实，所以用计数而不是只看最近一次失败） */
  let inboundOverflows = 0;

  /**
   * `realign()` 对齐到的那一步；以及"这次对齐之后的**第一条**不匹配还没报过"（收尾轮补）。
   *
   * 用途只有一个：把"我刚 realign 过、第一条就撞上不匹配"（多半是调用方传错了值）
   * 与"对端跳号/丢帧/重放"分开报（D16 的先例：同一个值不许承载两个含义）。
   *
   * ## 报过之后是什么样（**按复验人的实测写实**）
   *
   * `realignUnreported` 报过一次就关掉，但**不会**因此让后续不匹配变成 `'seq-mismatch'` ——
   * 那条帧已经被钉进 `stuck`，而 `drain` 每轮开头 `if (stuck !== null) return`
   * ⇒ **后续帧根本不再被检查**（复验人实测：第二条不匹配喂进去，`lastFailure()` 逐字未变、
   * `pendingCount` 停在 1）。只有**再调一次 `realign()`**（它清 `stuck` 并重新置位
   * `realignUnreported`）才会有下一条可区分的失败。
   * ⇒ 语义是"**每次 `realign` 之后各一条**"，不是"整个进程一条"。
   * 判据腿 `队列那条 › ★ realign 传了"合法但错一位"的值` 的 B 组（另一个**从没 realign 过**的
   * 驱动）证明 `'seq-mismatch'` 这一支仍然红得对。
   */
  let realignBaseline: number | null = null;
  let realignUnreported = false;

  /**
   * 报一条"入站 `act` 序号对不上"的失败 —— **两处调用（`drain` 与 `receiveAct`）共用这一份**，
   * 免得"realign 之后的第一条"在一条路径上被区分、另一条上没有被区分。
   */
  function reportSeqMismatch(expected: number, got: number, detail: string): void {
    if (realignUnreported && realignBaseline !== null) {
      realignUnreported = false;
      report(
        'realign-mismatch',
        `realign 之后第一条入站 act 就对不上：本端刚把进度对齐到第 ${realignBaseline} 步，` +
          `收到的却是第 ${got} 步（本端正在等第 ${expected} 步）。` +
          '这多半是**调用方传给 realign() 的步数不对**（多算/少算了一条），不是对端跳号；' +
          '请核对"重建后的状态应用了多少条操作"再调一次 realign()。',
      );
      return;
    }
    report('seq-mismatch', detail);
  }

  /**
   * 收下一帧（**唯一的入队口**：`onMessage` 与 `feedText` 都走它）。
   *
   * ★ **溢出分支只此一处**（变异 M7 的锚点）：上限判定、"这一帧不收下"、报失败、计数四件事
   * 必须在同一个地方做完 —— 分开写就会留下"某一处悄悄放行"的漏洞
   * （与"超窗判定只能写一处"是同一条纪律）。
   *
   * 溢出之后的**恢复路径**是"重建状态 + `realign(n)`"，见 `NetDriver.realign` 的头注；
   * 这条 message 里说的"请走一次追平"指的就是那条路。
   */
  function enqueue(text: string): void {
    if (pendingTexts.length >= inboundCapacity) {
      inboundOverflows += 1;
      report(
        'inbound-overflow',
        `入站队列已满（上限 ${inboundCapacity} 帧），这一帧**没有被收下**：宿主很久没有把当前` +
          '状态递进来（arm / submit），本端已经比对端落后一大段操作，本地状态不再可信。' +
          '请走一次追平（resync：拿房主的档案重建本地状态），重建之后调 realign() 对齐进度；' +
          '不要在这种情况下继续推进回合。',
      );
      return;
    }
    pendingTexts.push(text);
  }

  /**
   * 被卡住的那一帧：队列里最靠前的 `act` 的序号**不等于** `applied`。
   *
   * 为什么不把它留在队列里：留在队列里就得在每次 `drain` 时**重复**报同一条诊断
   * （而"同一条坏帧报 N 次"会让调用方以为对端一直在乱发）。挪进这个槽位之后，
   * 诊断只报一次，而"顺序还没到本端"这件事仍然挡着 `submit`（见那里的 `stuck !== null`）。
   * 队列里排在它后面的帧一概不看：它们全都依赖它先被应用。
   */
  let stuck: ActMsg | null = null;

  function report(reason: DriverFailureReason, message: string): void {
    failure = { reason, message };
    for (const cb of [...failureListeners]) cb(failure);
  }

  /**
   * 应用一条记录并推进序号（**本模块唯一改引擎状态的地方**）。
   *
   * 顺序是"先 `applyRecordedAction`、成功之后才记录并推进"（与 `LocalDriver`
   * `match-driver.ts:229-234` 同款，理由也同款）：引擎抛错时状态是**可疑的**，
   * 此时不该往档案里塞一条"没发生过的操作"，也不该让序号前进 ——
   * 否则档案与真实对局分叉（`match-file.ts:228-236`）。
   *
   * 返回 `null` = 成功；返回一个失败对象 = 引擎拒绝了它（调用方决定它变成哪个拒绝码）。
   */
  function applyOnce(
    s: GameState,
    rec: Omit<ActionRecord, 'seq'>,
    where: 'local' | 'peer',
  ): DriverFailure | null {
    // ★ 规范化：与档案、与 `stateAtStep` 同口径（深拷贝 args 的那一层，见
    //   match-replay.ts:249-258）。对端来的 `args` 是 `JSON.parse` 的产物，本来就已经是
    //   独立对象；本端来的可能是调用方之后还会改写的那个对象。一条路径、一种口径，
    //   省得两端对同一份输入产生不同的状态。
    const record: ActionRecord = normalizeAction({ ...rec, seq: applied });
    try {
      // ★★ 全模块唯一改引擎状态的那一行（判据 3）。对端来的与本地来的走的是**同一句**：
      //    这正是锁步的定义（D1）—— 若这里按 where 分叉，就会长出第二份语义，
      //    而"动作发生了、语义没发生"那一族缺陷刚好住在分叉的另一侧。
      applyRecordedAction(s, record);
    } catch (e) {
      const detail = describeError(e);
      return {
        reason: where === 'peer' ? 'peer-action-refused' : 'local-action-refused',
        message:
          where === 'peer'
            ? `对端第 ${record.seq} 条操作被引擎拒绝：${detail}（两端可能已经分叉，请核对状态指纹）`
            : `本端第 ${record.seq} 条操作被引擎拒绝：${detail}`,
      };
    }
    // 记录器不该失败：它只收 `Omit<ActionRecord, 'seq'>`，编号按自己的长度算（match-file.ts:528）
    recorder?.record({ ...rec, via: rec.via ?? 'user' });
    applied += 1;
    return null;
  }

  /**
   * 收到对端一条 `act`。
   *
   * ★ 这里的 `applyOnce(s, msg.action, 'peer')` 就是"语义真的发生了"的那一半。
   *
   * ⚠️ 这条路径的**强度边界**（T5 阶段一评审实测后写清，别再记错功劳）：差分腿判的是
   * "两端指纹相等"，因此它抓得住**不对称**的错（一端落地、另一端没落地），却抓不住
   * **对称**的错 —— 变异 M1（两端都只推进序号、都不落地）在位时，那 60 次指纹比对
   * **一次都没红**（两端都冻在开局、次次相等）。真正抓住 M1 的是判据 1 里那四句**反空转**
   * 断言，以及新增的"只 `arm` 不 `submit`"腿（见 `tests/net/net-driver.test.ts`）。
   * 改这一行之前先想清楚这件事：这条路径的牙不在"指纹相等"上。
   */
  function receiveAct(s: GameState, msg: ActMsg): void {
    if (msg.action === undefined || msg.action === null) {
      report('seq-mismatch', `收到的 act 没有 action 载荷（seq=${String(msg.seq)}），已丢弃。`);
      return;
    }
    if (msg.seq !== msg.action.seq) {
      report(
        'seq-mismatch',
        `act 的两处序号不一致（act.seq=${String(msg.seq)}，action.seq=${String(msg.action.seq)}），已丢弃。`,
      );
      return;
    }
    if (msg.seq !== applied) {
      reportSeqMismatch(
        applied,
        msg.seq,
        `act 的序号对不上：收到 ${String(msg.seq)}，本端正在等第 ${applied} 条。` +
          '两端的位置不同（丢帧 / 重放 / 半截发送），这一条没有被应用。',
      );
      return;
    }
    // 线协议把 `action.kind` 声明成 `string`（`protocol.ts:195`），因为解码器只做**形状**校验、
    // 不认识引擎的操作种类；"这个 kind 引擎认不认"由 `applyRecordedAction` 的穷尽性分支回答
    // （`match-replay.ts:130-135`：未覆盖的 kind 抛错，不静默 no-op）。所以这里只把类型收窄，
    // **不**在这里写第二份 kind 白名单 —— 那正是判据 3 要防的"第二个映射"。
    //
    // ★ G5 T12：收窄的目标从 `ActionKind`（引擎那 8 个）换成 `AppActionKind`（+ 应用层的
    //   `'draft-pick'`）。这不是"放宽校验"：白名单仍然只有 `applyRecordedAction` 那一处，
    //   这里换的只是**类型标注**，而它必须跟着词表走 —— 不换的话草稿选牌会在这一句被
    //   tsc 拦下（`'draft-pick'` 不属于 `ActionKind`），那正是"线上格式不拦、拦人的是应用层"
    //   这条事实的编译期体现。
    const wire: Omit<ActionRecord, 'seq'> = {
      player: msg.action.player,
      kind: msg.action.kind as AppActionKind,
      ...(msg.action.args === undefined ? {} : { args: msg.action.args }),
    };
    const fail = applyOnce(s, wire, 'peer');
    if (fail !== null) report(fail.reason, fail.message);
  }

  /**
   * 消费入站队列：只应用"紧接着该用的那一条"。
   *
   * 遇到序号对不上的 `act` 就把它挪进 `stuck` 并**停下**（诊断只报一次），
   * 因为排在它后面的每一条都依赖它先被应用 —— 继续往下应用就是静默错位。
   * 解不出来的帧在这里直接记诊断并丢弃：它不该把提交永远挡在门外，也不该静默消失。
   */
  function drain(s: GameState): void {
    for (;;) {
      if (stuck !== null) return;
      const text = pendingTexts.shift();
      if (text === undefined) return;
      const decoded = decodeMsg(text);
      if (!decoded.ok) {
        report('undecodable', `收到一条解不出来的帧（${decoded.reason}）：${decoded.message}`);
        continue;
      }
      if (!isActMsg(decoded.msg)) {
        // `beat` 心跳、握手、承诺、`resync-*` 都由各自的层处理（T3/T6/T7）。
        // 这里**只认 `act`**，其余静默放行 —— 但"解不出来"的帧要留诊断（上面那条）。
        continue;
      }
      if (decoded.msg.seq !== applied) {
        stuck = decoded.msg;
        reportSeqMismatch(
          applied,
          decoded.msg.seq,
          `入站 act 的序号对不上：它自称第 ${String(decoded.msg.seq)} 条，本端正在等第 ${applied} 条。` +
            '两端的位置不同（丢帧 / 重放 / 半截发送），这一条没有被应用，本端也不会抢在它前面提交。',
        );
        return;
      }
      receiveAct(s, decoded.msg);
    }
  }

  const onMessage = opts.onMessage ?? ((cb: (text: string, channel: NetChannel) => void) => transport.onMessage(cb));
  const unsubscribe: () => void = onMessage((text, _channel) => {
    // 生产路径：帧先到这里，再由宿主把当前状态递进来（见 `pendingTexts` 的注释）。
    // T6：入队走 `enqueue`（它带着上限与溢出处置）。
    enqueue(text);
    if (lastKnownState !== null) drain(lastKnownState);
  });
  /** 链路状态订阅（`onStatus` 转发用；`dispose` 时退订） */
  const unsubscribeStatus = transport.onStatus((change) => {
    if (disposed) return;
    for (const cb of [...statusListeners]) cb(change);
  });

  /**
   * `a.player` 现在动得了吗（**发送方那一侧的轮次闸**）。
   *
   * 三条路（都来自引擎/原语的既有语义，**没有**本模块自己发明的规则）：
   *  - ★ **草稿相**（G5 T12）：`phase === 'draft'` 时，能动的**只有当前轮选者**
   *    —— `draftRoundOwner(draftStarter, draftRound)`，由 `draftNextAction` 交出来
   *    （`src/core/state/create.ts:139-141`）。这一格是 T12 新加的：草稿选牌从 T12 起也走
   *    这条 `act` 通道（应用层的 `'draft-pick'`，用户裁决 A），而**轮次规则与对局相不同**
   *    （草稿看轮选者、对局看 `turnPlayer`）。两端各自校验同一规则：发送方在这里被拒，
   *    接收方在 `applyRecordedAction` 的草稿分支被 `performDraftPick` 的池子/相位守卫拒
   *    （⇒ 报 `'peer-action-refused'`，不静默吞）。
   *  - `GameState.turnPlayer === author`：常规回合行动；
   *  - 有一个**带 `prompt` 的挂起效果**、且 `author` 是它的应答者（`prompt.chooser` 优先，
   *    缺省回落到该效果的 `player`）：`effect-choice` 的应答者就是它（`main.ts:307-314` 同口径）。
   *
   * 为什么要放开第三条：`effect-choice` 的 `player` 不一定是 `turnPlayer`（效果可以让**对方**
   * 做选择）。只认 `turnPlayer` 会把合法的应答判成"不是你的回合"，而那条腿在两端**同时**
   * 拒绝 ⇒ 谁都不动 ⇒ 差分腿停在那儿（一个不报错的死锁，不是分叉）。
   *
   * ⚠️ **草稿分支与对局分支是 if/else，不是"或"**：草稿期的状态里 `turnPlayer` 恒为 `0`
   * （`createGame` 的初值）⇒ 写成"或"会让座位 0 在对局规则的判据下**冒充**轮选者
   * （`turnPlayer === author` 恒真）⇒ 座位 1 真该选的那一回合反而被拒。对局分支自己带
   * `phase !== 'turn'` 早退，两个分支互斥这件事因此是**结构上**成立的，不靠调用顺序。
   */
  function liveTurn(s: GameState, author: PlayerId): boolean {
    if (s.winner !== null) return false;
    if (s.phase === 'draft') return draftNextAction(s)?.player === author;
    if (s.phase !== 'turn') return false;
    if (s.turnPlayer === author) return true;
    const top = s.pendingEffects[s.pendingEffects.length - 1];
    if (top === undefined) return false;
    const prompt = top.prompt;
    if (prompt === null || prompt === undefined) return false;
    const chooser: PlayerId = prompt.chooser ?? top.player;
    return chooser === author;
  }

  const driver: NetDriver = {
    mode: NET_DRIVER_MODE,
    seat,
    transport,

    /**
     * 判据 5 的四种组合：**轮到本端 且 通道在线**才为真。
     *
     * ⚠️ 这里刻意**不**读会话层的 `acceptsInput()`（N-9 的代价，计划 D20 `:320-323`）：加入方
     * 验盐失败时会话层的 `acceptsInput` **也是 `true`**（它按 `phase === 'complete'` 派生）。
     * 判"能不能收输入"要读 `commitmentVerified()` 或失败理由，那是**会话层**的读数；
     * 本驱动只回答"回合 + 链路"这两件它真知道的事，不替会话层猜。
     */
    acceptsInput(): boolean {
      if (disposed) return false;
      if (transport.status() !== 'online') return false;
      if (lastKnownState === null) return false;
      return liveTurn(lastKnownState, seat);
    },

    submit(s: GameState, a: Omit<ActionRecord, 'seq'>): SubmitResult {
      // ★ 三条拒绝的判定顺序是**契约**，不是随手排的：
      //   1. `dispose()` 之后一律 `'read-only'` —— 连"离线"都不该说，因为这一局已经结束了
      //      （D16 / `match-driver.ts:93-95` 的原义）；
      //   2. 传输不在线 ⇒ `'offline'`（D16 新增的那个值，**不是** `'read-only'`）；
      //   3. 其余是本端策略（顺序未到 / 不是本端的回合 / 引擎拒绝）。
      if (disposed) return { ok: false, refusal: 'read-only' };
      lastKnownState = s;
      // 先把能落地的入站帧落地：它们比"我现在要提交的这一条"更早（对端的序号在前）。
      // 不先排空的话，本端会在一个落后的状态上提交 ⇒ 双方立刻错位。
      drain(s);
      if (transport.status() !== 'online') {
        return { ok: false, refusal: 'offline' };
      }
      if (stuck !== null) {
        // 队列里有一条序号对不上的对端操作：现在提交会让两边永久错位。
        // 这不是"对端离线"，也不是"这局结束"，而是"顺序还没到本端"。
        return { ok: false, refusal: 'not-the-next-action' };
      }
      // ★ 先看"这条操作是不是本端的"：`a.player` 必须就是本驱动的 `seat`。
      //   少了这一句，**从机也能提交主机的操作**（实测踩过：`liveTurn` 只看"这个座位现在
      //   动得了吗"，而从机手里的状态里 `turnPlayer` 就是主机 ⇒ 它一路放行，
      //   于是从机自己把主线走了一步，两端立刻分叉）。这是"座位"这一层的检查，
      //   排在回合检查之前：它更便宜，也更基本（连是不是你的事都没确定，谈什么轮到谁）。
      if (a.player !== seat) return { ok: false, refusal: 'not-the-next-action' };
      if (!liveTurn(s, a.player)) {
        return { ok: false, refusal: 'not-the-next-action' };
      }
      const encoded = encodeMsg({ t: 'act', seq: applied, action: { ...a, seq: applied } });
      if (!encoded.ok) {
        // 本端的操作形状不对（例如 args 里有不可序列化的东西）：这是**调用方违约**，
        // 不该伪装成网络失败。转成 `'not-the-next-action'`（本端策略拒绝）并留原因。
        report('local-action-refused', `本端的操作编不成协议消息（${encoded.reason}）：${encoded.message}`);
        return { ok: false, refusal: 'not-the-next-action' };
      }
      const sent = transport.send('act', encoded.text);
      if (!sent.ok) {
        // 传输层说这条没发出去。这里**不**把它当成"本端可以自己玩下去"：
        // 发不出去就等于对端拿不到这一步，本地应用它只会让两端永久分叉（D1 禁止静默分叉）。
        //
        // ★ 拒绝码与来源的对应关系（T5 修复轮按评审 §2 的裁决收紧措辞，**未新增拒码**）：
        //   `SendFailureReason` 有四个值（`transport.ts:103`），除 `'not-initialized'`（调用顺序错，
        //   属于编程错误、由 `init` 的文档管）之外的三个都落到这里，而它们**对调用方是同一个
        //   可行动事实**："这一条没发出去"。三个来源逐个点名（别让文档只说"不可达"）：
        //     · `'offline'`  —— 对端不可达（掉线 / 还没连上）；
        //     · `'closed'`   —— 本端已经 `close()`（驱动还没 `dispose()`，所以不是 `'read-only'`）；
        //     · `'queue-full'` —— 本端待发队列积压（真 WebRTC 的 `bufferedAmount` 过高）。
        //   为什么不拆出第四个拒码：`SubmitRefusal` 是 `src/app` 的 union，加值要同步所有消费方，
        //   而"怎么办"在三者上完全一样（重试 / 等对端回来 / 等积压排空，都不是本驱动能决定的）。
        //   但**玩家文案必须分得清**这是三种不同的事 —— 那句文案归 T8，届时按 `lastFailure()`
        //   或传输自己的 `onError`（`transport.ts:235`）给的真因写。这里只保证：一条都没漏。
        return { ok: false, refusal: 'offline' };
      }
      const fail = applyOnce(s, a, 'local');
      if (fail !== null) {
        report(fail.reason, fail.message);
        return { ok: false, refusal: 'not-the-next-action' };
      }
      return { ok: true };
    },

    note(a: Omit<ActionRecord, 'seq'>): void {
      // 旁路留痕。`dispose()` 之后一律丢弃（同 `submit` 的第一条）：把一条"没发生过的操作"
      // 留在档案里会让 T6 的追平把一个不存在的步数当成真相。
      //
      // ⚠️ 这里**静默**丢弃，而 `submit` 在同样情形下**报** `'read-only'` —— 两者取向不同，
      // 这是**有意的**（T5 阶段一评审点过一句，这里写清理由）：`note` 的契约返回 `void`
      // （`match-driver.ts:115` 写着"旁路留痕，不执行、不进 actions、只 note"），没有码可报；
      // 而它的语义是"尽力而为"，调用方本来就不该依赖它成功。若哪天要给 `note` 一个可读的失败，
      // 那是一次**契约变更**（返回值类型变宽），要先改 `MatchDriver` 的文档与所有实现，
      // 不能在这里单独加。
      if (disposed) return;
      recorder?.note(a);
    },

    recorder: () => (disposed ? null : recorder),

    dispose(): void {
      if (disposed) return;
      disposed = true;
      unsubscribe();
      unsubscribeStatus();
      failureListeners.clear();
      statusListeners.clear();
      pendingTexts.length = 0;
      stuck = null;
      // 通道关闭（判据 4 的"通道关闭"）：`close()` 是异步的且不可逆（`transport.ts:229`）。
      // 这里**不等**它：本方法在 `MatchDriver` 契约里是同步的（`dispose(): void`），
      // 而"关闭这件事已经开始"在同步返回之后立刻成立。真正的失败（真 WebRTC 的 close 抛错）
      // 由 `close()` 自己的 Promise 报给调用方 —— 驱动不吞它，也不在这里造一个假结果。
      void transport.close();
    },

    appliedSteps: () => applied,

    realign(next: number): void {
      // 调用方违约 ⇒ 抛（照 `commitFace` 的口径：这不是网络输入，是"你报了一个不可能的数"）
      if (!Number.isInteger(next) || next < 0) {
        throw new Error(
          `net-driver.ts 的 realign 收到越界的 appliedSteps ${String(next)}（契约是 ≥ 0 的整数）；这是调用方违约。`,
        );
      }
      if (disposed) return;
      applied = next;
      // ★ 记下基线 + "第一条不匹配还没报过"：让"realign 传错了值"与"对端跳号"能分开报
      //（`reportSeqMismatch`；D16 的先例：同一个值不许承载两个含义）。
      realignBaseline = next;
      realignUnreported = true;
      // 重建前那个世界留下的两样东西，在这里一起丢掉：
      //  - `stuck`：它记的是"重建前那一段里序号对不上的帧"，序号已经失去意义；
      //  - 入站队列：队里那些帧全都属于重建前的那一段。
      // ⚠️ **这是有意丢掉了可能仍然有效的那一条**（收尾轮按复验人的实测补写）：溢出时队里那条
      // 往往**正是期待的下一条**（复验人实测 `pendingBefore=1 applied=0`）。取舍是**丢**而不是留：
      // 重建之后旧的 `seq` 已经失去意义，留着它只会让 `drain` 立刻报 `seq-mismatch` 并把 `stuck`
      // 钉在一条错的帧上；而"对端会按 D23 的重发清单把它补回来"是本协议的既有承诺。
      stuck = null;
      pendingTexts.length = 0;
      // `inboundOverflows` **不清**：它是历史事实（见 `inboundOverflowCount` 的注释）。
    },

    pendingCount: () => pendingTexts.length,

    inboundOverflowCount: () => inboundOverflows,

    arm(s: GameState): void {
      if (disposed) return;
      lastKnownState = s;
      drain(s);
    },

    feedText(text: string, channel: NetChannel = 'act'): void {
      void channel;
      enqueue(text);
      if (lastKnownState !== null) drain(lastKnownState);
    },

    lastFailure: () => failure,

    onStatus(cb: (change: StatusChange) => void): () => void {
      statusListeners.add(cb);
      return () => {
        statusListeners.delete(cb);
      };
    },

    onFailure(cb: (failure: DriverFailure) => void): () => void {
      failureListeners.add(cb);
      return () => {
        failureListeners.delete(cb);
      };
    },
  };

  return driver;
}
