/**
 * 会话层驱动 MatchDriver（G4 Task 2；见 docs/2026-09-17-G4-驱动层与档案重放-实现计划.md §5 T2 / §4 D2·D3·D12）。
 *
 * 本模块是**纯逻辑**（受 `tests/app-purity.test.ts` 的常驻守卫）：不碰 DOM / 存储 / 网络 / 时钟。
 * ★「时钟」这一条是本任务补上的：G4 的 Global Constraints 明写**定时器必须注入** ⇒
 * 重放里"该走下一步了"一律由调用方给的 `Ticker` 触发，本文件里
 * `setTimeout` / `setInterval` / `requestAnimationFrame` **零命中**（判据 9 生成式扫 `src/app/**`）。
 *
 * ## 它解决什么
 *
 * `main.ts` 里的动作入口长期是两处（`cb.onAction` 编排 + `applyRearrangeSwap` 旁路），
 * 且"谁来执行、记不记录、能不能操作、下一步什么时候走"四件事全散在 UI 里。本模块把它们收成一个契约：
 *
 *  - `LocalDriver`   = 热座：**执行**（走 T1 的 `applyRecordedAction`，全仓唯一的"档案操作 → 引擎调用"映射）
 *                      + **记录**（`recorder.record`，`via: 'user'`）。执行与记录走同一条路径 ⇒
 *                      "档案 = 真实发生过的操作序列"不是靠调用方自觉。
 *  - `ReplayDriver`  = 重放：**闸门**（D12）。只有档案里的**下一条**能通过，且**应用的是记录里那一条**
 *                      （不是调用方给的那条）；`acceptsInput()` 恒 `false`（UI 据此画只读）。
 *
 * ## ★ 为什么是"闸门"而不是"重放自己执行"（D3 / D12，别按直觉改）
 *
 * 重放的一步 = `cb.onAction(档案里的下一条)` —— 与现场**完全同一条编排**。理由是可证伪的：
 * `main.ts` 的抽牌/揭示累加器（`pendingDraws` / `pendingReveals`）**只在编排内部排空**；
 * 绕过编排直呼 `executeAction` 会把它们灌满且永不排空，泄漏进下一次真实行动 ——
 * **一个不报错的缺陷**。所以重放必须能被"现场的那条路"消费，而消费的接口就是这个闸门。
 *
 * 代价（如实登记）：
 *  1. 重放页不能"从这一步接着打"（不在 G4 验收里）；
 *  2. 玩家恰好点到与档案下一条**完全同形**的操作时会被接受 —— 效果等同按了一次「单步」。
 *     这是 D12 已登记的**已知无害等价**，由 T3 的遮罩层在界面上堵掉（指针级；键盘路径见 T4 第 17 条）。
 *
 * ## ★★ 状态归属：驱动**不持有** `GameState`，`submit` 是唯一的应用点（D2；H 轮阻断 1）
 *
 * 本模块有一条**必须保持**的结构性约束（修复前它被破坏过，代价是一个不报错的分叉）：
 *
 *  - 驱动**没有**私有 `GameState`、**没有** `stateAfterDraft` 缓存、**没有**取状态的 getter；
 *  - `submit(state, a)` 把记录里那一条应用到**宿主传进来的那个 `state`** —— 这是全模块
 *    **唯一**调用 `applyRecordedAction` 的地方；
 *  - tick（`Ticker` 回调 / `onTick` 广播）**只通知宿主**"该走下一步了"，不 apply、不动游标。
 *
 * 为什么必须这样（可证伪的后果，不是风格）：`main.ts` 收口后的接线是
 * `onTick ⇒ cb.onAction(driver.next()!) ⇒ driver.submit(state, …)`，即**宿主经编排执行、驱动收单**。
 * 若 tick 自己也 apply 一步，那就有**两条各自改状态的路**：驱动在自己的副本上推进游标、
 * 宿主在自己的状态上执行 ⇒ 双方**永久分叉**，而且**不报错**（评审镜像实测：40 步的档案，
 * 驱动 position=6 而宿主只应用了 3 步，宿主指纹 ≠ 原局）。
 *
 * ## ★ 闸门的"等价"口径：`kind` + `args` + `player` 逐项相等（**比 `via` / `seq` 宽**）
 *
 * 不比的两种字段及其理由：
 *  - `seq`：`next()` 给的是**档案里**的 `seq`，而现场 UI 提交时**根本不知道**自己的 seq
 *    （`MatchDriver.submit` 的入参类型就是 `Omit<ActionRecord, 'seq'>`）⇒ 比它等于逼调用方猜。
 *  - `via`：档案层元数据，**不进引擎状态**（`match-file.ts:19-30`）⇒ 它对"会发生什么"零影响。
 * 反过来，`args` 必须**深比**（`play` 的 `line`、`effect-choice` 的 `choice` 都是数组/对象）。
 *
 * ⚠️ **一条精确性声明**（H 轮评审实测后改写的注释）：门把等价判到"值"这一层，因此
 * "引擎吃**记录里的** args 而不是**调用方给的** args"这句话在此契约下**不可独立观测** ——
 * 值不同 ⇒ 门先拒（引擎根本不被调用）；值相同 ⇒ 无可观测差异。能观测的是**下一层**：
 * 门把调用方对象规范化成副本、引擎吃的是那份副本（调用方的对象**不会被读第二次**、也不会被泄漏进引擎）。
 * 钉这件事的腿见 `tests/app/match-driver.test.ts` 判据 4 的 Proxy 腿（读计数）。
 *
 * 未覆盖的 `kind`（`applyRecordedAction` 里抛）与引擎自身的合法性守卫（`game.ts:122-128`）都归到
 * `refusal: 'engine-error'`：驱动**不写第二份校验层**（引擎改了它不会静默漂移），只如实展示。
 * `cursor()` 上它**只**占 `error` 一个字段；看门狗的诊断走 `diagnostic`（两者语义不同，
 * 混用会让诊断把整个驱动"砖化"——见 `ReplayCursor` 的注释）。
 *
 * ## ⚠️ 已知副作用（T1 已登记，本驱动如实继承）
 *
 * `applyRecordedAction` 的「控制权归还」还原规则跑在 `executeAction` 的守卫**之前**
 * （`tests/app/match-replay.test.ts`「T1-G4」钉着它）⇒ 一份被篡改的档案走到某步抛错时，
 * 该步的 `control` / `log` **可能已经被改动**。因此 `refusal: 'engine-error'` 之后的状态是**可疑的**：
 * 驱动把它冻在 `error` 上、不再推进（见 `submit` 的 `error !== null` 早退），
 * 但**不承诺**"状态一字未动"。判据 3 的"状态一字不动"只对 `not-the-next-action`（**在调用引擎之前**就返回）成立。
 */

import type { PlayerId } from '../core/models/types';
import type { GameState } from '../core/models/types';
import { createMatchFileRecorder, normalizeAction } from './match-file';
import type { ActionRecord, MatchFile, MatchFileRecorder } from './match-file';
import { applyRecordedAction } from './match-replay';

/* ------------------------------------------------------------------ *
 * 1. 契约
 * ------------------------------------------------------------------ */

export type DriverMode = 'local' | 'replay';

/**
 * 拒绝形态。四个取值**今天都可达**，逐个给出触发的**事实**（不写"将来谁会用到"）：
 *  - `'not-the-next-action'`：`ReplayDriver` 的主拒绝形态 —— 提交的不是档案的下一条（判据 3 / D12）。
 *  - `'exhausted'`：档案走完（`position >= total`）之后再提交（判据 6）。
 *    它**排在** `engine-error` 之前判定 ⇒ "已经走完"永远可判，不会被先前的一次引擎抛错遮住。
 *  - `'engine-error'`：引擎守卫或未覆盖 kind 抛错（判据 7），`error` 带原始 Error。
 *  - `'read-only'`：**`dispose()` 之后**的任何 `submit`。它是"H 轮评审曾判它该删、协调者裁决保留"
 *    的那个取值 —— 保留的理由不是"将来 G5 会用到"（那是预测，不作依据），而是它**确实可达**：
 *    见 `tests/app/match-driver.test.ts` 里"dispose 之后 submit ⇒ read-only"那条腿。
 */
export type SubmitRefusal = 'read-only' | 'not-the-next-action' | 'exhausted' | 'engine-error';

export interface SubmitResult {
  ok: boolean;
  refusal?: SubmitRefusal;
  error?: unknown;
}

export interface MatchDriver {
  readonly mode: DriverMode;
  /** 我是不是这个 driver 的"行动方"（本阶段 `createLocalDriver` 恒 0 —— 热座两个座位共用同一个 driver，
   *  这个字段在本阶段**没有判别力**；`createReplayDriver` 也返回 0）。保留字段以固定契约形状。 */
  readonly seat: PlayerId;
  /** 这个 driver 接受玩家（人）提交吗（replay = false） */
  acceptsInput(): boolean;
  /** **收口后 `main.ts` 唯一能触发状态迁移的入口** */
  submit(s: GameState, a: Omit<ActionRecord, 'seq'>): SubmitResult;
  /** 旁路留痕（不执行、不进 actions、只 note） */
  note(a: Omit<ActionRecord, 'seq'>): void;
  /** local: 记录器；replay: null */
  recorder(): MatchFileRecorder | null;
  dispose(): void;
}

/**
 * 宿主时钟的注入面（Global Constraints：定时器一律注入）。
 *
 * `schedule` 返回一个句柄，`cancel(h)` 必须能取消它；返回已触发过的句柄时 `cancel` 是 no-op。
 * 生产侧用 `window.setTimeout` / `clearTimeout`，测试侧用假 ticker（判据 8）——
 * 驱动对两者**没有任何假设**（不读时钟、不比较句柄）。
 */
export interface Ticker {
  schedule(fn: () => void, ms: number): number;
  cancel(h: number): void;
}

export interface ReplayCursor {
  /** 已执行步数（不含草稿重建） */
  position: number;
  total: number;
  done: boolean;
  paused: boolean;
  /** 0 = 暂停；1/2/4 = 倍速 */
  rate: 0 | 1 | 2 | 4;
  /**
   * **引擎抛错**的人类可读文本（`refusal: 'engine-error'` 的载荷）。
   *
   * ⚠️ **这个字段只有一个语义**（H 轮修复的阻断 2）：它**不**承载看门狗的诊断。
   * 曾经两者共用一个字段 ⇒ 看门狗一触发就把整个驱动"砖化"：`submit` 对任何入参都返回
   * `engine-error`，连"档案已经走完"（`exhausted`）都判不出来。⇒ 诊断另设 `diagnostic`。
   */
  error: string | null;
  /**
   * **非引擎错误的诊断**（今天只有一种来源：看门狗超时）。
   * 它不进指纹、不参与"要不要推进"的判断，**不**阻塞 `submit` —— 重放页把它显示出来即可。
   */
  diagnostic: string | null;
}

export interface ReplayDriver extends MatchDriver {
  readonly file: MatchFile;
  cursor(): ReplayCursor;
  /** 下一档案操作（**深拷贝快照**，与记录器同款语义）；`done` 后返回 `null`。
   *  main.ts 用它驱动：`cb.onAction(next())` —— 见 D12 的闸门语义。 */
  next(): ActionRecord | null;
  play(): void;
  pause(): void;
  setRate(rate: 0 | 1 | 2 | 4): void;
  /** 订阅"该走下一步了"（由注入的 ticker 驱动）。返回退订函数 */
  onTick(cb: () => void): () => void;
  /** **本步特效已播完**的握手：由 main.ts 在编排的**每个终止点**调用（见 T4）。
   *  驱动据此决定是否安排下一步（pause/rate 生效点）。 */
  settle(): void;
}

/* ------------------------------------------------------------------ *
 * 2. 共享小助手
 * ------------------------------------------------------------------ */

/** 深比较（只处理 JSON 值：本仓所有 `args` 都来自 `JSON.parse` ⇒ 恒等变换，见 `normalizeAction` 头注） */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (typeof a !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((x, i) => deepEqual(x, b[i]));
  }
  const ka = Object.keys(a as Record<string, unknown>);
  const kb = Object.keys(b as Record<string, unknown>);
  if (ka.length !== kb.length) return false;
  return ka.every((k) =>
    Object.prototype.hasOwnProperty.call(b, k) &&
    deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
  );
}

/**
 * 闸门判据：`a` 是不是档案里 `rec` 那一条的**等价提交**（`kind` + `args` + `player` 逐项相等）。
 *
 * 用 `normalizeAction` 先规范化 `a`：它做一次 JSON 深拷贝，于是"调用方传进来一个稍后会被改写的
 * 对象"不会让比较结果漂移（`match-file.ts:107-118` 的理由同款）。
 */
function isSameSubmit(a: Omit<ActionRecord, 'seq'>, rec: ActionRecord): boolean {
  if (a.kind !== rec.kind) return false;
  if (a.player !== rec.player) return false;
  return deepEqual(normalizeAction({ ...a, seq: 0 }).args, normalizeAction(rec).args);
}


/** 引擎抛出的错误文本：`Error` 取 `message`，非 Error 用 JSON 兜底（**不吞**，只转成可显示形态） */
function describeError(e: unknown): string {
  if (e instanceof Error) return e.message;
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}

/* ------------------------------------------------------------------ *
 * 3. LocalDriver（热座：执行 + 记录）
 * ------------------------------------------------------------------ */

export function createLocalDriver(opts?: { recorder?: MatchFileRecorder }): MatchDriver {
  const rec = opts?.recorder ?? createMatchFileRecorder();
  return {
    mode: 'local',
    // 热座里两个座位都由**同一个** driver 服务 ⇒ 这个字段在本阶段无判别力（契约占位）
    seat: 0,
    acceptsInput: () => true,
    submit(s: GameState, a: Omit<ActionRecord, 'seq'>): SubmitResult {
      // ★ 执行与记录**紧挨着**、且记录的是**同一条** `a`：先执行再记录（不是先记录再执行）——
      //   执行抛错时引擎状态是可疑的，此时**不该**往档案里塞一条"没发生过的操作"，
      //   否则档案与真实对局分叉（`match-file.ts:228-236` 的同族取舍）。
      applyRecordedAction(s, { ...a, seq: rec.nextSeq() });
      rec.record({ ...a, via: a.via ?? 'user' });
      return { ok: true };
    },
    note(a: Omit<ActionRecord, 'seq'>): void {
      rec.note(a);
    },
    recorder: () => rec,
    // 记录器是内存数组，没有需要释放的资源（`dispose` 只把"之后不许再用"这件事变成**明确**的契约）。
    dispose: () => {},
  };
}

/* ------------------------------------------------------------------ *
 * 4. ReplayDriver（只读闸门 + 注入时钟的握手）
 * ------------------------------------------------------------------ */

/**
 * 步间隔 / 看门狗的缺省值。**两个数都是"人类观感"参数，不是协议参数**（调用方可覆盖）：
 *  - `stepMs = 900`：比 `main.ts` 的自动推进（400ms）长 —— 重放期间自动推进是**关掉**的（D8），
 *    900ms 是"一步特效播完后再等一会儿"的观感值；
 *  - `settleWatchdogMs = 8000`：`settle()` 是"这一步的特效播完了"的握手，由 `main.ts` 在编排的
 *    **每个终止点**调用（T4 第 6 条）。少了任何一处，重放就会**永久卡在那一步且不报错** ——
 *    看门狗就是给这个形态兜底的：8 秒还等不到握手就**强制 `emitTick()`**（由宿主经 `cb.onAction`
 *    走完整编排）并在 `cursor().diagnostic` 留下诊断（⚠️ 不是 `error` —— 见 `ReplayCursor` 的注释）。
 *    **必须显著大于最长一步的合理耗时**（否则每一局最后的终局特效都会触发它）。
 */
const DEFAULT_STEP_MS = 900;
const DEFAULT_SETTLE_WATCHDOG_MS = 8000;

/**
 * ⚠️ `env.settleWatchdogMs` 的类型是 `number | null`（相对规格的 `number` 是一次**有意的契约扩宽**，
 * 不是顺手加的）：`null` = **显式关掉**看门狗。理由是可测的 —— 判据 8 的多条腿要求
 * "在飞时钟恰好一个"，而看门狗**本身也是一个在飞时钟**；没有这个开关，那些腿只能靠
 * "把 ms 调得足够大"来绕，那会把断言变成时间假设。生产永远不传 `null`（走缺省值）。
 */
export function createReplayDriver(
  f: MatchFile,
  env: { ticker: Ticker; stepMs?: number; settleWatchdogMs?: number | null },
): ReplayDriver {
  const ticker = env.ticker;
  const stepMs = env.stepMs ?? DEFAULT_STEP_MS;
  // `null` = **显式关掉**看门狗；缺省 = 用上面的缺省值。测试可以用 `null` 只测握手、不被看门狗干扰
  // （判据 8 的每一条都要求"到点前恰好一个在飞时钟"，看门狗本身也是一个在飞时钟）。
  const watchdogMs = env.settleWatchdogMs === undefined ? DEFAULT_SETTLE_WATCHDOG_MS : env.settleWatchdogMs;

  const actions = f.actions;
  const cur: ReplayCursor = {
    position: 0,
    total: actions.length,
    done: actions.length === 0,
    paused: true,
    rate: 1,
    error: null,
    diagnostic: null,
  };
  /** 已安排给 ticker 的时钟句柄（`null` = 没有在飞的时钟；**任何**调度都必须先取消它） */
  let scheduled: number | null = null;
  /** ★ 握手闩：「**宿主欠我们一次 `settle()`**」—— `play()` 之后为真；宿主每次回话（`settle()`）后转假；
   *  每次"一步交给宿主"（步进时钟到点）之后又转真。**看门狗只在它为 true 时武装**（那正是"卡死等宿主"）。 */
  let awaitingSettle = false;
  /** 看门狗句柄 */
  let watchdog: number | null = null;
  let disposed = false;
  const listeners = new Set<() => void>();

  /** 取消一切在飞的时钟（步进与看门狗各一个句柄；**幂等**） */
  function clearAll(): void {
    if (scheduled !== null) {
      ticker.cancel(scheduled);
      scheduled = null;
    }
    if (watchdog !== null) {
      ticker.cancel(watchdog);
      watchdog = null;
    }
  }

  /** `error`：**只有**引擎抛错会写它（`refusal: 'engine-error'` 的载荷） */
  function setError(msg: string): void {
    if (cur.error === null) cur.error = msg;
  }

  /** `diagnostic`：非引擎错误的诊断（今天只有看门狗）。**不**阻塞 `submit`、**不**进指纹 */
  function setDiagnostic(msg: string): void {
    if (cur.diagnostic === null) cur.diagnostic = msg;
  }

  /** 武装看门狗：**只对"等 settle"这一个卡死形态**兜底（见 `DEFAULT_SETTLE_WATCHDOG_MS` 注释） */
  function armWatchdog(): void {
    if (disposed || watchdog !== null || watchdogMs === null) return;
    watchdog = ticker.schedule(() => {
      watchdog = null;
      if (disposed || cur.paused || cur.done) return;
      // `awaitingSettle === false` ⇒ 卡的是"步进时钟本身"（ticker 不响应），那是宿主时钟的问题，
      // 不是本驱动能修的；诊断仍然留下，但**不**代替步进（否则"没响应"会被伪装成"走了一步"）。
      if (!awaitingSettle) {
        setError(`重放看门狗：${watchdogMs}ms 内重放没有推进（注入的时钟没有响应？）`);
        return;
      }
      awaitingSettle = false;
      // ★ 看门狗**只广播**（H 轮裁决：我第一版让它"替宿主把这次握手走完"，那是错的，三条因果）：
      //  ① **绕过 D3 的唯一编排**：那一步是驱动自己在状态上推的，`main.ts` 的 `cb.onAction` 那套
      //     抽牌/揭示编排**不会被跑** ⇒ `pendingDraws` / `pendingReveals` 两个累加器**不排空** ——
      //     而"灌满且永不排空、泄漏进下一次真实行动"正是 D3 存在的理由（一个不报错的缺陷）。
      //  ② 我原来的代价陈述（"只是跳过这一步的收尾特效"）**低估了**：跳过的是整条编排。
      //  ③ 回退后语义变成"看门狗只广播 ⇒ 由宿主经 `cb.onAction` 走完整编排"，
      //     于是"D3 被绕过 / 累加器不排空"与"诊断把重放砖化"（后者由 `error`/`diagnostic` 分离修）
      //     一举同时消失。⇒ **兜底交给宿主，驱动不替它做决定。**
      setDiagnostic(
        `重放看门狗：${watchdogMs}ms 内没有收到「本步特效已播完」的握手（settle 未被调用），` +
          `已强制通知宿主再走一步以免重放永久停在这一步。`,
      );
      emitTick();
    }, watchdogMs);
  }

  /**
   * 安排"下一步走"（只排进 ticker，**不**动状态、**不**动游标）。
   *  - `play()` 排第一次（宿主此刻没有特效在播）、之后每一步由宿主在编排终止点 `settle()` 重排；
   *  - ms = `stepMs / rate` ⇒ 倍速只缩短**步间隔**（D10：G4 不新增 FX 开关，不吞特效）；
   *  - `rate === 0` 等价于 `paused`（判据 8）⇒ 不调度、只取消。
   *
   * `force` = "这是 `setRate()` 的重排"（取消旧的、按新 ms 再排一个）。它不是"兜底步"——
   * 看门狗不再走这条路（见 `armWatchdog`）。
   */
  function scheduleNext(force: boolean): void {
    if (disposed) return;
    // 「已经有在飞的步进时钟」⇒ 只有 `setRate()`（`force = true`，语义就是重排）才继续；
    // 重复的 `settle()` 必须在这里被挡掉（判据 8 的幂等腿：`settle()` 后**恰好**一次 schedule）。
    if (!force && scheduled !== null) return;
    if (cur.paused || cur.done || cur.error !== null) return;
    if (cur.rate === 0) {
      cur.paused = true;
      clearAll();
      return;
    }
    // 重排 / 首次排：先取消在飞的（步进**与**看门狗），再按当前 rate 排一个
    clearAll();
    scheduled = ticker.schedule(() => {
      // ⚠️ 这个回调**只广播**：不 apply、不动游标（唯一的应用点是 `submit`，见那里的注释）。
      // 一步之后**宿主欠我们下一次 `settle()`** —— 与 `scheduled = null` 合起来才是本模块的不变式：
      //   **`awaitingSettle` ⟺ 「下一步还没排进 ticker」**。
      // 本实现第一版把这一步写反/写漏过两次，症状**完全一样且不报错**：一步走完之后
      // `awaitingSettle` 仍是假 ⇒ 下一次 `settle()` 被当成"重复调用"而 no-op。判据 8 的
      // "一步之后要等下一次 settle"与看门狗两条腿就是这条不变式的牙（两次都当场打红）。
      scheduled = null;
      awaitingSettle = true;
      emitTick();
    }, stepMs / cur.rate);
    // 只给"等 settle"兜底（注释见 armWatchdog）；不在这里额外做别的判断
    armWatchdog();
  }

  function emitTick(): void {
    if (disposed) return;
    for (const cb of [...listeners]) cb();
  }

  const driver: ReplayDriver = {
    mode: 'replay',
    seat: 0,
    acceptsInput: () => false, // 恒 false（判据 3）—— 重放的只读由它 + D12 的闸门共同表达
    file: f,

    /**
     * ★★ **本模块唯一应用引擎的地方**（H 轮阻断 1 的修复；D2：驱动不持有 `GameState`）。
     *
     * `s` 是**宿主传进来的**状态，也是唯一被推进的状态 —— 驱动**没有**私有状态副本、
     * 没有 `stateAfterDraft` 缓存、没有 getter。这条约束不是风格问题：
     * 修复前 `handleTick` 会自己在私有状态上 apply 一步（并推进游标），宿主通过 `onTick`
     * 再走一遍 `submit` ⇒ **两条各自改状态的路**，于是 T4 规格的接线
     * （`onTick ⇒ cb.onAction(driver.next()!) ⇒ submit`）下**每次 tick 只命中档案的第 1、3、5…条**：
     * 驱动按自己的副本推进游标、宿主按自己的状态执行，两者**永久分叉**（评审镜像实测：
     * driver position=6/40 而宿主只应用了 3 步）。⇒ 现在 tick **只广播**，"走一步"这件事
     * 只能由宿主经 `submit` 请求、且作用在宿主自己的状态上。
     *
     * 判定顺序：`exhausted` 排在 `engine-error` **之前**。为什么（以及这句话的**精确范围**）：
     * "档案已经走完"是**进度事实**，不该被先前的一次引擎抛错遮住 —— 这修正了 H 轮阻断 2 里
     * "两种语义共用一个字段"的病根（那是**真**缺陷：看门狗诊断曾让 `exhausted` 永远回不出来）。
     * ⚠️ 但要如实说清：`diagnostic` / `error` 分离之后，`position >= total` 与 `error !== null`
     * **在本模块的不变式下互斥**（引擎抛错的那一步不推进游标 ⇒ 位置到不了 `total`）
     * ⇒ 这个顺序今天是**防御性**的，**没有**一条腿能观测到它（H 轮变异 M5 实测：对调顺序后
     * 全套 31 项仍全绿）。留着它是因为"进度优先"是**契约**而非实现细节：
     * 将来若有别的路径能在末尾留下错误（例如引擎在最后一步之后仍报错），这条顺序就是对的。
     */
    submit(s: GameState, a: Omit<ActionRecord, 'seq'>): SubmitResult {
      if (disposed) return { ok: false, refusal: 'read-only' };
      // ★ `exhausted` 先判：它描述的是"档案的进度"，与"上一步是否抛过错"无关
      if (cur.position >= cur.total) return { ok: false, refusal: 'exhausted' };
      if (cur.error !== null) return { ok: false, refusal: 'engine-error', error: new Error(cur.error) };
      const rec = actions[cur.position];
      // ★ 闸门（D12）：不是下一条 ⇒ **在调用引擎之前**就返回 ⇒ 状态一字不动（判据 3）
      if (!isSameSubmit(a, rec)) return { ok: false, refusal: 'not-the-next-action' };
      // ★ 应用**记录里**那一条（不是调用方给的那条）：门只保证"值等价"，而等价之下仍有
      //   **对象身份**的差别（调用方的对象可能带 getter / 稍后被改写）⇒ 引擎吃记录里的那份。
      try {
        applyRecordedAction(s, rec);
      } catch (e) {
        setError(describeError(e));
        return { ok: false, refusal: 'engine-error', error: e };
      }
      // 宿主**正在按它的编排往前走**（它刚刚请求了这一步）⇒ 下一步仍欠它一次 `settle()`。
      // 为什么在这里竖闩（而不是只靠看门狗那条路）：`submit` 是"一步已经开始"的唯一证据；
      // 竖在这里，无论这一步是"宿主自己 tick 出来的"还是"看门狗兜底 tick 出来的"，
      // 后续 `settle()` 都能正常排下一步（否则看门狗兜底之后链条会断，重放再次停住）。
      awaitingSettle = true;
      cur.position += 1;
      if (cur.position >= cur.total) cur.done = true;
      return { ok: true };
    },

    note(a: Omit<ActionRecord, 'seq'>): void {
      // 只读驱动**没有**记录器；留痕落在这里会让调用方以为"档案里记下了"。
      // 所以显式丢弃，但**不抛**（`note` 在契约里是"尽力而为的留痕"）。
      void normalizeAction({ ...a, seq: 0 });
    },

    recorder: () => null,

    cursor: () => ({ ...cur }),

    next(): ActionRecord | null {
      if (cur.position >= cur.total) return null;
      // 深拷贝快照（与 `MatchFileRecorder.actions()` 同款语义）：调用方改它不该动到档案
      return normalizeAction(actions[cur.position]);
    },

    /**
     * 进入播放态，并**直接排第一次 tick**（H 轮裁决 4，纠正了我第一版的语义）。
     *
     * 为什么 `play()` 就该排：此刻**没有任何特效在播**（宿主停在第一步之前），不存在"两套时钟
     * 交叠"的风险；而"等 `settle()` 才排"会让**第一个 tick 永远不来**（宿主在第一步之前没有
     * 任何终止点可回话）。`play()` 之后每一步才由宿主在编排终止点 `settle()` 重排。
     */
    play(): void {
      if (disposed || cur.paused === false || cur.done || cur.error !== null) return;
      cur.paused = false;
      scheduleNext(false);
    },

    pause(): void {
      clearAll();
      awaitingSettle = false;
      cur.paused = true;
    },

    setRate(rate: 0 | 1 | 2 | 4): void {
      if (rate !== 0 && rate !== 1 && rate !== 2 && rate !== 4) return;
      cur.rate = rate;
      if (rate === 0) {
        // 0 = 暂停：取消在飞时钟、不再 tick（判据 8）
        clearAll();
        awaitingSettle = false;
        cur.paused = true;
        return;
      }
      // 播放态下改倍速：立刻按新倍速（重）排一次 —— 两种合法时机都在这个条件里：
      //  · `scheduled !== null`（下一步已排、还没到点）⇒ 取消后用新的 ms 重排；
      //  · `awaitingSettle`（在等宿主回话）⇒ 直接按新的 ms 排。
      // 其余情况（暂停中、已 done、已报错、什么都没在跑）⇒ 什么都不做。
      if (!cur.paused && !cur.done && cur.error === null && (scheduled !== null || awaitingSettle)) {
        scheduleNext(true);
      }
    },

    onTick(cb: () => void): () => void {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },

    settle(): void {
      if (disposed) return;
      // 宿主没有欠我们回话（重复的 `settle()`）⇒ no-op（幂等：宿主可以在每个终止点多调几次）
      if (!awaitingSettle) return;
      awaitingSettle = false;
      if (watchdog !== null) {
        ticker.cancel(watchdog);
        watchdog = null;
      }
      if (cur.paused || cur.done || cur.error !== null) return;
      scheduleNext(false);
    },

    dispose(): void {
      if (disposed) return;
      disposed = true;
      clearAll();
      awaitingSettle = false;
      listeners.clear();
    },
  };

  return driver;
}
