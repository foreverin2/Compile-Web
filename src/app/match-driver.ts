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
 * ## ★ 闸门的"等价"口径：`kind` + `args` + `player` 逐项相等（**比 `via` / `seq` 宽**）
 *
 * 不比的两种字段及其理由：
 *  - `seq`：`next()` 给的是**档案里**的 `seq`，而现场 UI 提交时**根本不知道**自己的 seq
 *    （`MatchDriver.submit` 的入参类型就是 `Omit<ActionRecord, 'seq'>`）⇒ 比它等于逼调用方猜。
 *  - `via`：档案层元数据，**不进引擎状态**（`match-file.ts:19-30`）⇒ 它对"会发生什么"零影响。
 * 反过来，`args` 必须**深比**（`play` 的 `line`、`effect-choice` 的 `choice` 都是数组/对象）：
 * 浅比会让"同 kind 不同落点"被放行 ⇒ 重放静默走偏（判据 4 就是钉这件事的）。
 *
 * 未覆盖的 `kind`（`applyRecordedAction` 里抛）与引擎自身的合法性守卫（`game.ts:122-128`）都归到
 * `refusal: 'engine-error'`：驱动**不写第二份校验层**（引擎改了它不会静默漂移），只如实展示。
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
import { applyRecordedAction, stateAfterDraft } from './match-replay';

/* ------------------------------------------------------------------ *
 * 1. 契约
 * ------------------------------------------------------------------ */

export type DriverMode = 'local' | 'replay';

/**
 * 拒绝形态。**四个取值今天不全可达**，如实登记（本仓"零调用的码不许留"的规矩见
 * `match-file.ts:80-86` 对 `hash-mismatch-unknown` 的处置 —— 这里选择保留而不是删，
 * 因为它不是"预留的死码"而是**契约的一部分**，且 G5 的 `NetDriver` 会真的用到 `read-only`）：
 *  - `'not-the-next-action'`：`ReplayDriver` 唯一的拒绝形态（判据 3 / D12）。
 *  - `'exhausted'`：档案走完后再提交（判据 6）。
 *  - `'engine-error'`：引擎守卫或未覆盖 kind 抛错（判据 7）。
 *  - `'read-only'`：**今天零可达**。它的语义是"这个 driver 结构上就不接人类的输入"，
 *    而重放的"不接输入"由**闸门**表达得更好（`not-the-next-action` 带得出"你点的那条不是下一条"，
 *    `read-only` 带不出）。留给 G5 的 `NetDriver`（非本方座位的提交）。
 */
export type SubmitRefusal = 'read-only' | 'not-the-next-action' | 'exhausted' | 'engine-error';

export interface SubmitResult {
  ok: boolean;
  refusal?: SubmitRefusal;
  error?: unknown;
}

export interface MatchDriver {
  readonly mode: DriverMode;
  /** 我是不是这个 driver 的"行动方"（G4 恒 0；G5 的 NetDriver 才有意义）—— 保留字段以固定契约 */
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
  /** 引擎抛错 / 看门狗诊断时的人类可读文本（重放页要把它显示出来） */
  error: string | null;
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
    // 热座里两个座位都由**同一个** driver 服务 ⇒ 这个字段在 G4 无判别力（契约占位，G5 的 NetDriver 才有意义）
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
 *    看门狗就是给这个形态兜底的：8 秒还等不到握手就强行放行一步并在 `cursor().error` 留下诊断。
 *    **必须显著大于最长一步的合理耗时**（否则每一局最后的终局特效都会触发它）。
 */
const DEFAULT_STEP_MS = 900;
const DEFAULT_SETTLE_WATCHDOG_MS = 8000;

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

  function setError(msg: string): void {
    if (cur.error === null) cur.error = msg;
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
      // ★ 兜底的**动作**是"替宿主把这次握手一次性走完"，不是"只通知订阅者"：
      //   `emitTick()` 只是把"该走下一步了"广播给宿主（`main.ts` 的编排入口）。宿主若正是因为
      //   漏了一个终止点而没回话，下一次它**同样**不会回话 ⇒ 广播一下等于什么都没做
      //   （本实现第一版就是这个形态：看门狗"响了"、诊断也写了，但**重放仍停在那一步**，
      //    判据 8 的看门狗腿当场打红）。这里复现 `settle()` 的效果（闩已在上行清掉 + 按当前
      //   rate 排下一步），于是重放能继续 —— 代价是这一步的收尾特效被跳过（重放页会显示诊断）。
      // ⚠️ **顺序要紧**：必须先排下一步、**再**写诊断。`scheduleNext()` 在 `error !== null` 时早退
      //   ⇒ 先写诊断会把这次兜底变成 no-op（本实现在这一行上栽过一次，症状与"没写兜底"完全一样）。
      if (!cur.paused && !cur.done && cur.error === null) scheduleNext(true);
      setError(
        `重放看门狗：${watchdogMs}ms 内没有收到「本步特效已播完」的握手（settle 未被调用），` +
          `已强制放行一步以免重放永久停在这一步。`,
      );
    }, watchdogMs);
  }

  /**
   * 安排"下一步走"。**必须由 `settle()` 触发**（握手语义）：
   *  - `play()` 自己**不**调度（判据 8 的第一条）—— 进入播放态只是"可以走了"，
   *    真正的一步要等上一步的 `settle()` 或首次 `settle()`；
   *  - ms = `stepMs / rate` ⇒ 倍速只缩短**步间隔**（D10：G4 不新增 FX 开关，不吞特效）；
   *  - `rate === 0` 等价于 `paused`（判据 8）⇒ 不调度、只取消。
   */
  function scheduleNext(force: boolean): void {
    if (disposed) return;
    // 「已经有在飞的步进时钟」⇒ 只有 `setRate()` / 看门狗兜底（`force = true`，语义就是重排）才继续；
    // 重复的 `settle()` 必须在这里被挡掉（判据 8 的幂等腿：`settle()` 后**恰好**一次 schedule）。
    if (!force && scheduled !== null) return;
    // `force` 路径**绕开** `error` 这一条：看门狗的兜底正是要在"已经写下诊断"之后**仍然**推进一步
    // （否则"防永久卡死"这句是空的 —— 见 `armWatchdog` 里的实测记录）。
    if (!force && cur.error !== null) return;
    if (cur.paused || cur.done) return;
    if (cur.rate === 0) {
      cur.paused = true;
      clearAll();
      return;
    }
    // 重排 / 首次排：先取消在飞的（步进**与**看门狗），再按当前 rate 排一个
    clearAll();
    scheduled = ticker.schedule(() => {
      scheduled = null; // 这一步已经交给宿主了：没有在飞的步进时钟
      handleTick(force);
      // ★ 一步走完之后**宿主欠我们下一次 `settle()`**（`main.ts` 播完这一步的特效后回话）。
      // ⚠️ 这一行必须在 `handleTick()` **之后**（不是之前）——它与上面那行合起来才是本模块的不变式：
      //   **`awaitingSettle` ⟺ 「下一步还没排进 ticker」**。
      //   本实现第一版把这一步写反/写漏过两次，症状**完全一样且不报错**：一步走完之后
      //   `awaitingSettle` 仍是假 ⇒ 下一次 `settle()` 被当成"重复调用"而 no-op ⇒
      //   **重放走完第一步就永久停住**。判据 8 的"一步之后要等下一次 settle"与看门狗两条腿
      //   就是这条不变式的牙（两次都当场打红）。
      awaitingSettle = true;
    }, stepMs / cur.rate);
    // 只给"等 settle"兜底（注释见 armWatchdog）；不在这里额外做别的判断
    armWatchdog();
  }

  /**
   * 一 tick = 恰好一步：推进游标、在引擎里执行**档案里的那一条**，然后再等下一次 `settle()`。
   *
   * `forced` = 这一步是**看门狗的兜底步**（宿主从不回话）。它只多一条豁免：
   * 允许穿过"已有诊断就不许推进"那道闩 —— 否则看门狗写下诊断的同一刻就把自己的兜底步废掉了
   * （本实现在这一行上栽过一次：诊断写了、步进时钟也排了，但那一步**必然**被 `error` 拦下，
   *  位置一动不动，判据 8 的看门狗腿当场打红）。
   */
  function handleTick(forced = false): void {
    if (disposed) return;
    // ⚠️ 只清**步进**时钟，**不**碰看门狗：`awaitingSettle` 在宿主调 `settle()` 之前一直是 true，
    //    看门狗因此仍然守着"宿主忘了握手"这个形态（`settle()` 才会取消它）。
    if (scheduled !== null) {
      ticker.cancel(scheduled);
      scheduled = null;
    }
    if (cur.paused || cur.done) return;
    const rec = actions[cur.position];
    if (!rec) {
      cur.done = true;
      return;
    }
    if (cur.error !== null && !forced) return;
    // 状态由 `play()` / 首次 `submit` 里 `ensureState()` 建好；这里只做防御（空态 = 草稿重建失败，
    // 此时 `cur.error` 已经非空，上面的分支已经返回了）。
    const s = replayState;
    if (!s) {
      setError('重放状态未建立（草稿重建失败）');
      return;
    }
    try {
      applyRecordedAction(s, rec);
      cur.position += 1;
    } catch (e) {
      setError(describeError(e));
    }
    if (cur.position >= cur.total) cur.done = true;
    // ⚠️ 这里**不**继续调度：下一步等宿主的 `settle()`（`main.ts` 走完 FX 编排后调）——
    // 否则"步间隔"与"特效时长"两套时钟会各走各的（那正是 D8 要避免的形态）。
    emitTick();
  }

  function emitTick(): void {
    if (disposed) return;
    for (const cb of [...listeners]) cb();
  }

  /**
   * 重放状态：`stateAfterDraft(f)`（`createGame` + 草稿序列真重建）。
   *
   * 为什么**懒建**而不是在 `createReplayDriver` 里就建：`stateAfterDraft` 会对一份被篡改的档案
   * **抛错**（`replayDraftFromSetup` 的三种失败态）。构造函数抛错会让调用方拿到半个对象，
   * 而错误路径需要的是一个**可展示的 driver**。⇒ 第一次 `submit` / `next` 时建，
   * 抛错则转成 `engine-error`（`cursor().error` 有诊断、驱动不崩）。
   */
  let replayState: GameState | null = null;
  function ensureState(): GameState | null {
    if (replayState) return replayState;
    if (cur.error !== null) return null;
    try {
      replayState = stateAfterDraft(f);
      return replayState;
    } catch (e) {
      setError(`档案的草稿序列无法重建：${describeError(e)}`);
      return null;
    }
  }

  const driver: ReplayDriver = {
    mode: 'replay',
    seat: 0,
    acceptsInput: () => false, // 恒 false（判据 3）—— 重放的只读由它 + D12 的闸门共同表达
    file: f,

    submit(s: GameState, a: Omit<ActionRecord, 'seq'>): SubmitResult {
      if (disposed) return { ok: false, refusal: 'read-only' };
      if (cur.error !== null) return { ok: false, refusal: 'engine-error', error: new Error(cur.error) };
      if (cur.position >= cur.total) return { ok: false, refusal: 'exhausted' };
      if (!ensureState()) return { ok: false, refusal: 'engine-error', error: new Error(cur.error ?? '重放状态未建立') };
      const rec = actions[cur.position];
      // ★ 闸门（D12）：不是下一条 ⇒ **在调用引擎之前**就返回 ⇒ 状态一字不动（判据 3）
      if (!isSameSubmit(a, rec)) return { ok: false, refusal: 'not-the-next-action' };
      // ★ 应用**记录里**那一条，不是调用方给的那条（判据 4）：现场 UI 算出来的 args 可能与档案不同
      //   （例如 `effect-choice` 的 `player` 由 `prompt.chooser` 推出），按调用方给的走会**静默走偏**。
      try {
        applyRecordedAction(s, rec);
      } catch (e) {
        setError(describeError(e));
        return { ok: false, refusal: 'engine-error', error: e };
      }
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

    play(): void {
      if (disposed || cur.paused === false || cur.done || cur.error !== null) return;
      if (!ensureState()) return;
      cur.paused = false;
      // ★ **不**在这里 `schedule`（判据 8）：进入播放态后的第一步也走同一条握手路径
      //   （宿主渲染完第一帧、走完编排后调 `settle()`）。
      // 但必须**在进入播放态时就把握手闩竖起来**：否则 `play()` 之后紧接着的第一次 `settle()`
      // 会被当成"没有在等握手的 settle"而 no-op ⇒ 重放**永远不动**（本实现第一版就是这个形态，
      // 判据 8 的第一条腿当场把它打红）。
      awaitingSettle = true;
      // `play()` 之后也要能被看门狗保住：宿主若**从不** `settle()`（T4 的编排漏了一个终止点），
      // 重放会永远停在第一步且不报错 —— 看门狗正是给这个形态兜底（判据 8 的最后一条）。
      armWatchdog();
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
      //  · `awaitingSettle`（在等宿主回话 / 刚 `play()`）⇒ 直接按新的 ms 排。
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
