/**
 * 档案重放（G4 Task 1；见 docs/2026-09-17-G4-驱动层与档案重放-实现计划.md §5 T1）。
 *
 * 本模块是**纯逻辑**（受 tests/app-purity.test.ts 的常驻守卫）：不碰 DOM / 存储 / 网络 / 时钟。
 *
 * 它只做两件事，且各只做一份：
 *  1. 「一条 `ActionRecord` → 一次引擎调用」的**全仓唯一**映射（`applyRecordedAction`）。
 *     在此之前，同一份 `switch` 曾抄在 `tests/app/match-recorder.test.ts` 的 `replay()` 里
 *     （现 `:251-258`）—— 测试与生产各有一份实现，"档案能重放"就有两个可能各自漂移的定义。
 *     本任务把它收口到这里，测试改为调用本模块（T1 判据 6）；G 轮进一步把该文件**现场侧**
 *     那份 `playAndRecord` 的 `switch` 也收口掉 ⇒ 全仓 `switch (a.kind)` 只剩本模块一处。
 *  2. 草稿的**真重放**（`replayDraftFromSetup`）：消费档案 `setup` 的两条顺序快照。
 *     G3 的"重放"测试用硬编码策略 `getDraftPool(s)[0]` **重新选**了一遍草稿
 *     （`tests/app/match-recorder.test.ts`），证明的是"同一套策略算出同一结果"，
 *     而不是"档案里的草稿序列能被复现" —— 对任何真实对局都不成立。这里是那个洞的补丁。
 */

import type { GameState, Line, PlayerId } from '../core/models/types';
import type { ActionKind } from '../core/game';
import { executeAction } from '../core/game';
import {
  createGame,
  draftNextAction,
  getDraftPool,
  performDraftBan,
  performDraftPick,
} from '../core/state/create';
import { resetControlIfHeld } from '../core/rules/control';
import {
  DRAFT_PICK_KIND,
  matchFileToCreateOptions,
  normalizeAction,
  type ActionRecord,
  type AppActionKind,
  type MatchFile,
  type MatchFileSetup,
} from './match-file';

/* ------------------------------------------------------------------ *
 * 1. 一条档案操作 → 一次引擎调用（全仓唯一）
 * ------------------------------------------------------------------ */

/**
 * 把**一条档案记录**应用到引擎状态上。
 *
 * 与 `main.ts` 现场编排的关系：现场在 `cb.onAction` 里做了三件额外的事 —— FX 编排、
 * 世代守卫、以及给每类操作补上正确的 `player`（例如 `effect-choice` 的应答者是
 * `prompt.chooser`，见 `main.ts:307-314`）。本模块**只负责引擎调用**这部分：
 * `player` 与 `args` 都取**档案里记的那条**（档案是照现场实际调用记的）。
 *
 * ★「控制权归还」还原规则 —— **只对 `rearrange-protocols` 生效，且必须落在它之前**：
 *
 * 现场 UI 在**打开重排模态之前**会先调一次 `resetControlIfHeld`（`main.ts:266` 编译前 /
 * `:291` 补满前），**那次调用不在档案里**（它不是引擎动作，只是 UI 的弹窗前奏），
 * 但它带一条 `pushLog`（`src/core/rules/control.ts:62`），而 `stateFingerprint` **含 `log`**
 * （`src/core/fingerprint.ts:49-51`）。模态里逐次提交的正是 `rearrange-protocols`
 * （`main.ts:153-157` 的 `applyRearrangeSwap`）⇒ 现场顺序是【归还】【重排…】【编译】。
 *
 * **为什么只有 `rearrange-protocols` 需要助手插手**（评审 M5 实测确认，本条曾把功劳记错）：
 * - `executeAction` 的 `refresh`（`game.ts:142-146`）与 `compile`（`game.ts:153-157`）分支
 *   **各自先调 `resetControlIfHeld`、再 pushLog**（归还 log 在 `:145` / `executeCompile` 之前）
 *   ⇒ "归还 log 落在动作 log 之前"**引擎自己就保证了**。助手替它们做是**第二次 no-op**：
 *   镜像实测（把 compile/refresh 两半删掉）当时 `match-replay(24) + match-recorder(15) = 39 条` **全绿**，
 *   且在 4 个种子上统计到 **32 步**"控制权在该玩家手里时 compile/refresh"仍两侧指纹相等
 *   ⇒ 那两半**零调用、无承重**。按本仓「零调用的分支不许留」的规矩（见 `match-file.ts:80-86`
 *   对 `hash-mismatch-unknown` 的同款处置）**删除**，而不是留着让它看起来有作用。
 * - 真正承重的是 `rearrange-protocols`：`rearrangeProtocolSlots`（`src/core/actions/rearrange.ts:12-33`）
 *   **不读也不改** `s.control` ⇒ 若不在这里先把归还 log 插进去，重放会是【重排…】【归还】【编译】
 *   （归还由随后的 `compile` 分支补做）⇒ `log` 顺序不同 ⇒ `stateFingerprint` 不等。
 *   M4（删掉整段还原规则）实测**红 3 条**：判据 7「★ 往返指纹相等」、G2a「现场侧不走助手」、
 *   G4「篡改档案 ⇒ 抛错但 control/log 已被改动」—— 后两条是**设计上就该**钉住该规则副作用的腿。
 * - `resetControlIfHeld` 幂等（`control.ts:60` 的 `if (s.control === player)`），
 *   故"重排后紧接编译"的场景不会多出第二条 log。
 *
 * ⚠️ **已知副作用（G4，如实登记并配腿钉住）**：本规则跑在 `executeAction` 的合法性守卫
 * （`game.ts:122-128`：非回合期 / 非本方回合 / 有挂起效果 / 落牌中）**之前**。
 * 一份被篡改的档案重放到某一步会抛错，但**该步的 `control` 与 `log` 可能已被本规则改动**
 * ⇒ T2 拿到 `engine-error` 之后的状态是**可疑的**。选择"登记 + 配腿"而不是"复制一份引擎守卫"：
 * 复制守卫就是**第二份真相**（引擎改了它会静默漂移），而重放驱动本来就只需展示错误。
 * 腿见 `tests/app/match-replay.test.ts`「篡改档案 ⇒ 抛错，但 control/log 可能已被改动」。
 *
 * 未覆盖的 `kind` **抛错**，不静默 no-op：静默会让重放从这一步起与原件分叉而看不出哪里错了
 * （档案的"一份数据五处复用"最怕的静默错位，见 `match-file.ts:230-236` 的同族取舍）。
 */
export function applyRecordedAction(s: GameState, a: ActionRecord): void {
  // ★「控制权归还」还原规则（见头注）：**在应用之前**复现现场 UI 打开重排模态前的那次归还。
  // 必须在 `switch` **之前**（而不是塞进 rearrange 分支里）：现场顺序是
  // 【UI 归还】→【重排…】→【编译】，归还的 pushLog 必须落在重排**之前**。
  // `compile` / `refresh` **不在这个集合里** —— 引擎那两个分支自己就会先归还（见头注）。
  if (a.kind === 'rearrange-protocols' && s.control === a.player) {
    resetControlIfHeld(s, a.player);
  }
  switch (a.kind) {
    case 'play': {
      const args = a.args as { cardUid: string; faceUp: boolean; line: Line; target?: PlayerId };
      executeAction(s, a.player, 'play', args);
      return;
    }
    case 'compile': {
      const args = a.args as { line: Line };
      executeAction(s, a.player, 'compile', { line: args.line });
      return;
    }
    case 'resolve-trigger': {
      const args = a.args as { cardUid: string };
      executeAction(s, a.player, 'resolve-trigger', { cardUid: args.cardUid });
      return;
    }
    case 'effect-choice': {
      const args = a.args as { promptId: string; choice: string[] };
      executeAction(s, a.player, 'effect-choice', { promptId: args.promptId, choice: args.choice });
      return;
    }
    case 'rearrange-protocols': {
      const args = a.args as { target: PlayerId; a: Line; b: Line };
      executeAction(s, a.player, 'rearrange-protocols', { target: args.target, a: args.a, b: args.b });
      return;
    }
    case 'refresh': {
      executeAction(s, a.player, 'refresh');
      return;
    }
    case 'advance': {
      executeAction(s, a.player, 'advance');
      return;
    }
    case 'clear-cache': {
      executeAction(s, a.player, 'clear-cache');
      return;
    }
    /**
     * ★★ **G5 T12：草稿选牌走的就是这条流水线**（用户裁决 A：把它接进既有的 `act` 通道，
     * 而不是另起一条"各自算"的路）。
     *
     * 这一格是**应用层**的那一格：`performDraftPick` 是 `src/core/state/create.ts` 的草稿原语，
     * 它**不在** `executeAction` 的 8 个分支里（所以上面 8 格调用的是引擎，这一格调用的是
     * core 的草稿函数 —— "调用 core 的函数"是允许的，改 core 才是红线）。
     *
     * ## 为什么"轮到谁"不用在这里校验
     *
     * `performDraftPick` 自己就带轮次语义：`getCurrentDrafter(s)` 按 `draftRoundOwner` 派生
     * 当前轮选者，而 `getDraftPool(s)` 会把已选/已禁的 defId 排除 ⇒ "不是本回合的人选了"
     * 与"选了池外/重复的 defId"都会被**引擎/or 原语**拒掉（抛错），于是重放与联机接收方
     * 都不需要第二份校验。**发送方**那一侧另有一道闸（`src/net/net-driver.ts` 的 `liveTurn`
     * 的草稿分支），两端各自校验同一规则。
     *
     * ⚠️ 与 `'rearrange-protocols'` 那条"控制权归还"还原规则**无关**：草稿期没有控制组件，
     * 也不是被那个规则覆盖的动作。
     */
    case DRAFT_PICK_KIND: {
      const args = a.args as { defId: string };
      performDraftPick(s, args.defId);
      return;
    }
  }
  // 穷尽性守卫：上面的 switch 覆盖了**全部 9 个** `AppActionKind`（引擎的 8 个 + 应用层的
  // `'draft-pick'`），TypeScript 在这里把 `a.kind` 收成 `never`。若将来任一**词表**新增取值
  // 而这里漏了分支，**这一行会在 tsc 阶段就报错**（`never` 不可赋给 `AppActionKind` 形参），
  // 而不是到运行时才静默走空。
  //
  // 为什么写成"取一个函数"而不是上一版那样 `const narrowed: never = a.kind` 再转一次类型：
  // 把 `never` 交给一个**形参类型是 `AppActionKind`** 的函数，是 TypeScript 里表达"这个值已经
  // 属于空集"的标准写法，且**它的报错就是我们要的那条**（`Argument of type '"xxx"' is not
  // assignable to parameter of type 'AppActionKind'`）。上一版那两句靠两处 cast 才编译过，
  // 读起来像"为了绕过类型系统"，而这里要的恰好相反：让漏分支**在编译期就爆**。
  return assertNeverAction(a.kind);
}

/**
 * `applyRecordedAction` 的穷尽性兜底（见那里的注释）：**只在运行期**给一份被篡改的档案兜底。
 *
 * 调用点把 `a.kind` 收窄成 `never` 之后传进来 ⇒ 漏了分支时**先烂在 tsc**，运行期这条
 * 只在"档案里的 kind 是一个字符串、不在任何词表里"（`parseMatchFile` 会先拦，
 * 但直呼本函数的人可以绕过它）时走到。
 */
function assertNeverAction(kind: AppActionKind): never {
  throw new Error(`applyRecordedAction: 未覆盖的操作 kind=${String(kind)}（档案被篡改或 ActionKind 新增后漏了分支）`);
}

/* ------------------------------------------------------------------ *
 * 2. 草稿重放（消费 setup.draftPicks / setup.bannedProtocols）
 * ------------------------------------------------------------------ */

export interface DraftReplayResult {
  picks: number;
  bans: number;
}

/** 草稿重放的失败：带 `defId`（判据 3 要求"消息里带 defId"）与失败形态。 */
function draftSeqError(detail: string, kind: 'pick' | 'ban', defId: string): Error {
  return new Error(`replayDraftFromSetup: ${detail}（需要下一条 ${kind} 的 defId=${JSON.stringify(defId)}）`);
}

/**
 * 按 `setup` 的两条顺序快照重建草稿（消费 `draftPicks` / `bannedProtocols`）。
 *
 * **为什么只能这么重建**（下一个人一定会问"凭什么"）：
 * 草稿的选/禁交错由引擎守卫锁死，档案里不可能出现"该禁的步上记了一次选"：
 *  - `performDraftPick`（`src/core/state/create.ts:260-264`）：ban 模式下若 `!draftPickPending(s)`
 *    直接 **throw** `'not a pick step (ban pending)'`；
 *  - `performDraftBan`（`src/core/state/create.ts:198-206`）：`draftNextAction(s)` 的 kind 不是
 *    `'ban'` 直接 **throw** `'no ban step pending'`。
 * ⇒ 现场每条草稿动作的 kind 恒等于当时 `draftNextAction(s)` 的 kind。而 `draftNextAction`
 * （`create.ts:139-141` → `nextActionFrom` `:144-166`）**只依赖两个计数**
 * （`draftPicks.length` / `bannedProtocols.length`）⇒ 本函数按 kind 从对应序列取"下一个"即可，
 * 不需要（而 `MatchFileSetup` 也没有）任何额外的顺序信息。
 *
 * 三种错都必须**抛**而不是静默跳过（判据 3）——静默跳过会让重放从第一步就与原件错位：
 *  - 序列**不足**：还需要一个 pick/ban 但对应数组已空；
 *  - 序列**多余**：草稿动作已全部派生完（`draftNextAction` 返回 `null`）而数组还有剩；
 *  - 含**池外 defId**：核心会抛（`protocol X not available`），但本函数先判一次，好让消息带上 defId。
 *
 * ⚠️ `bannedProtocols` 在 `normal` 模式下**永远不会被消费** ⇒ 非空时必须抛（否则"多余"会被静默吞掉）。
 */
export function replayDraftFromSetup(s: GameState, setup: MatchFileSetup): DraftReplayResult {
  const picks = setup.draftPicks;
  const bans = setup.bannedProtocols;
  let pi = 0;
  let bi = 0;
  let guard = 0;
  for (;;) {
    const next = draftNextAction(s);
    if (!next) break;
    if (++guard > 1000) throw new Error('replayDraftFromSetup: 草稿重放没有收敛（守卫超限，引擎状态异常？）');
    if (next.kind === 'pick') {
      if (pi >= picks.length) throw draftSeqError('setup.draftPicks 不足：还需要一个 pick 的 defId', 'pick', '<缺失>');
      const defId = picks[pi];
      // ⚠️ 顺序要紧：先判"**不足**"再判"池外/重复"。倒过来会把"不足"误报成"池外"
      // ——因为序列耗尽时 `picks[pi]` 是 `undefined`，而 `undefined` 当然不在池里。
      // 这两种失败态的文案与诊断方向完全不同（一个说"档案少记了一步"，另一个说"这一条 defId 非法"）。
      if (typeof defId !== 'string' || !getDraftPool(s).some((p) => p.defId === defId)) {
        throw draftSeqError('setup.draftPicks 含池外/重复 defId', 'pick', String(defId));
      }
      performDraftPick(s, defId);
      pi += 1;
    } else {
      if (bi >= bans.length) throw draftSeqError('setup.bannedProtocols 不足：还需要一个 ban 的 defId', 'ban', '<缺失>');
      const defId = bans[bi];
      if (typeof defId !== 'string' || !getDraftPool(s).some((p) => p.defId === defId)) {
        throw draftSeqError('setup.bannedProtocols 含池外/重复 defId', 'ban', String(defId));
      }
      performDraftBan(s, defId);
      bi += 1;
    }
  }
  if (pi < picks.length) {
    throw draftSeqError('setup.draftPicks 多于草稿动作（草稿已结束仍有剩余）', 'pick', picks[pi]);
  }
  if (bi < bans.length) {
    throw draftSeqError('setup.bannedProtocols 多于草稿动作（normal 模式不消费该序列）', 'ban', bans[bi]);
  }
  return { picks: pi, bans: bi };
}

/* ------------------------------------------------------------------ *
 * 3. 档案 → "草稿结束"的完整状态（ReplayDriver 的起跑点）
 * ------------------------------------------------------------------ */

/**
 * 档案里**草稿选牌**那几条（按 log 顺序）。
 *
 * ★ G5 T12：这是"两条重放路走哪一条"的**判据**。新档案（T12 之后录的）把草稿选牌记进了
 * `actions`（`kind: 'draft-pick'`）⇒ 这条非空 ⇒ 草稿由**动作流**重演，`setup` 那两条顺序快照
 * **不再被消费**。老档案（T12 之前录的）里没有这种记录 ⇒ 这条为空 ⇒ 走
 * `replayDraftFromSetup` 的老路（它一个字都没动）。
 *
 * 为什么用"日志里有没有草稿动作"当判据、而不是给档案加一个版本位或标志字段：
 *  - 加字段要动 `parseMatchFile` 的校验面与 `canonicalMatchFile` 的规范化面（两份都可能漏）；
 *  - 而"日志里有没有草稿动作"是**数据本身**的事，读一下就有，不可能与档案内容不同步；
 *  - 一份档案的草稿永远是**从第 0 步开始**记的（`draftRound === 0` 时选第一张）⇒ "有草稿动作"
 *    与"整场草稿都在日志里"是同一件事，不存在"只记了一半"的形态需要另行判断。
 *
 * 代价（如实登记）：一份**被手工编辑过**、把草稿动作从 `actions` 里删掉一半的新档案会退回老路
 * 并用 `setup` 重演 —— 那与"老档案"不可区分，而它本来就是被篡改的档案（`checkAction` 的
 * `seq === 下标` 判据会先把它拦住）。
 */
function draftPicksInLog(f: MatchFile): Array<ActionRecord & { kind: typeof DRAFT_PICK_KIND }> {
  // `filter` 之后类型仍然是 `ActionRecord` ⇒ 这里的 cast 只是把**已经由谓词保证**的那件事
  // 写进类型里（`a.kind === DRAFT_PICK_KIND` 是过滤条件本身，不是猜测）。
  return f.actions.filter((a) => a.kind === DRAFT_PICK_KIND) as Array<
    ActionRecord & { kind: typeof DRAFT_PICK_KIND }
  >;
}

/**
 * ★★ **草稿前导的条数**（G5 T12 小修复轮）：档案日志**开头**那几条 `'draft-pick'` 的个数。
 *
 * ## 它是谁的唯一出处
 *
 * 两个消费方都要这个数，所以它只能有一处（本仓库对"同一件事两处各算一遍"的成见）：
 *  1. `src/main.ts` 的重放页：起跑状态是 `stateAfterDraft(f)`（**已经**把草稿走完了）⇒ 游标的
 *     初始位置必须跳过这几条，否则第一步就会把一条 `'draft-pick'` 交给一个 `'turn'` 相的状态
 *     （实测两种拒绝：`not-the-next-action` / `engine-error: not in draft phase`）；
 *  2. `assertDraftPreludeMatchesSetup`：拿它与 `setup.draftPicks.length` 对账（见那里的说明）。
 *
 * 实现：数的是**前导**（从下标 0 开始连续的那几条），不是"日志里一共有几条 `'draft-pick'`"——
 * 后者会把"对局中混进一条同名 kind"也算上，而前者的语义才是"起跑点已经走掉的那一段"。
 * 一份正常档案里两者相等（草稿永远从第 0 步记起），但语义要按前导写。
 */
export function draftPreludeCount(log: readonly { kind: string }[]): number {
  let n = 0;
  while (n < log.length && log[n].kind === DRAFT_PICK_KIND) n += 1;
  return n;
}

/**
 * ★★ **前导草稿条数必须与 `setup.draftPicks` 的条数一致** —— 不一致是**档案自相矛盾**，
 * 必须给可读失败，**不许静默跳过**（T12 小修复轮，协调者交办）。
 *
 * ## 为什么这条前提不能"默认成立"
 *
 * 重放页新起点的算法是"起始状态用 `stateAfterDraft(f)`（它读 `setup` 那份派生回显走完草稿）+
 * 游标跳过日志前导那几条"。两边的**条数**因此是这条算法的隐含前提：
 *  - `setup.draftPicks` 比日志前导**多** ⇒ 起始状态"多走了"几步，而游标跳得少 ⇒ 中间那几步
 *    会被应用**两次**（`performDraftPick` 在 `'turn'` 相上抛 `not in draft phase` ——
 *    那次抛错是"碰巧"救回来的，不该拿它当保证）；
 *  - `setup.draftPicks` 比日志前导**少** ⇒ 起始状态与日志的前进量对不上，重放出来的盘面
 *    来历不明（看起来能走，但走出来的东西不是这份档案说的那一局）。
 *  两种形态都不该被静默吸收：档案自相矛盾时，重放页唯一诚实的反应是**说不出来**。
 *
 * ## 调用点
 *
 * `src/main.ts` 的 `startReplayFile` **第一句**（在任何状态被改写之前抛）—— 那里也是最容易
 * 看见这条失败的地方（重放页进不去，屏上留在档案屏）。老档案（日志无草稿动作）⇒ 前导 0，
 * 而 `setup.draftPicks` 恒为 6（它只住在 setup 里）⇒ **不能**拿这条去卡老档案：判据是
 * "日志里**有没有**草稿前导"，没有就说明这一份是旧格式，`stateAfterDraft` 走 `replayDraftFromSetup`，
 * 两边本来就不该对账（`stateAtStep` 对它也没有"跳过"这回事）。
 */
export function assertDraftPreludeMatchesSetup(f: MatchFile): number {
  const prelude = draftPreludeCount(f.actions);
  if (prelude === 0) return 0; // 旧格式：草稿不住在日志里，这一层不适用（见上面）
  const declared = f.setup.draftPicks.length;
  if (prelude !== declared) {
    const which = prelude > declared
      ? `日志前导比 setup 多 ${prelude - declared} 条（日志 ${prelude} / setup.draftPicks ${declared}）`
      : `setup.draftPicks 比日志前导多 ${declared - prelude} 条（日志 ${prelude} / setup.draftPicks ${declared}）`;
    throw new Error(
      `这份档案自相矛盾，不能重放：${which}。` +
        '档案里"草稿动作的日志"与"草稿的顺序快照（setup.draftPicks）"必须逐条对应，' +
        '否则重放的起点说不清（会把草稿多走一遍，或者走出一局来历来不明的棋）。' +
        '请重新导出这一局的档案，不要手工改动其中任何一部分。',
    );
  }
  return prelude;
}

/**
 * 从档案重建到**开局那一帧**（`createGame` 之后、任何操作之前）的状态。
 *
 * 它只是"`createGame(matchFileToCreateOptions(f))`"这一句的具名化。存在的理由：T12 之后
 * `stateAfterDraft()` 要走两条路（新档案走动作流、老档案走 setup 快照），而两条路都从
 * **同一帧**起跑 —— 具名之后"起跑点是什么"在这一个地方说清，两处不再各写一遍。
 */
function stateAtStart(f: MatchFile): GameState {
  return createGame(matchFileToCreateOptions(f));
}

/**
 * 从档案重建到草稿结束的状态：`createGame(matchFileToCreateOptions(f))` + **草稿重放**。
 *
 * 返回的状态是**全新**的（不共享档案里的任何引用），调用方可以随意推进它。
 * `ReplayDriver` 从这里起跑，再逐步 `applyRecordedAction` 走 `f.actions`。
 *
 * ★★ **G5 T12：草稿重放有两条路，同一次调用只许走一条**（用户裁决 (i)："重放时不许双应用"）。
 *
 * | 档案 | 走哪条 | 为什么 |
 * |---|---|---|
 * | 老档案（`actions` 里没有 `'draft-pick'`） | `replayDraftFromSetup(s, f.setup)` | 它的草稿**只**住在 `setup` 的两条顺序快照里（T12 之前的唯一记法），日志里没有可应用的东西 |
 * | 新档案（`actions` 里有 `'draft-pick'`） | 逐条 `applyRecordedAction` | **真值是动作流**：草稿就在日志里，`setup.draftPicks` 只是它的派生读数 |
 *
 * 判据是**数据本身**（`draftPicksInLog(f).length > 0`），不是版本号、也不是"两边都试一下看哪个
 * 走得通"——后者会在"两条都能走"的形态上静默双应用，而那正是本仓最恨的那类缺陷
 * （`match-file.ts:228-236` 的同族取舍：宁可响亮地失败，不要静默错位）。
 *
 * ⚠️ **新档案这条路走完之后的 `phase` 一定是 `'turn'`**：日志里草稿动作齐 6 条
 * （`DRAFT_PICK_COUNT`）时 `performDraftPick` 自己会把相位翻过去（`create.ts:271-279`）。
 * "草稿没走完就录了档案"这种档案今天不存在（`MatchFile` 只在有记录器的地方产生，
 * 而那两处都是对局中/终局导出）。
 */
export function stateAfterDraft(f: MatchFile): GameState {
  const s = stateAtStart(f);
  const logged = draftPicksInLog(f);
  if (logged.length === 0) {
    replayDraftFromSetup(s, f.setup);
    return s;
  }
  // 新路：只走草稿那几条（`applyRecordedAction` 的草稿分支）—— 本函数的契约是"到草稿结束为止"，
  // 对局那几条由 `stateAtStep` / `ReplayDriver` 负责。
  for (const a of logged) {
    applyRecordedAction(s, normalizeAction(a));
  }
  return s;
}

/* ------------------------------------------------------------------ *
 * 4. 档案 → 第 n 步的状态（G5 T4；见 G5 实现计划 D9 / §5 T4）
 * ------------------------------------------------------------------ */

/**
 * 从档案重建到**第 n 条操作之后**的状态（T6 断线重连的 `resync-res` 落点）。
 *
 * 内部只做两件事：`stateAfterDraft(f)` 起跑，再逐条 `applyRecordedAction` 走前 n 条 ——
 * 「`ActionRecord` → 引擎调用」的映射**仍然只有那一处**（D9 的硬要求）。重连不能另开一份：
 * 在那个映射收口之前，同一份 `switch` 曾在现场与测试各有一份，"档案能重放"因此有两个
 * 可能各自漂移的定义（本文件头注第 1 条）。
 *
 * ⚠️ **T12 的一处修正（不改口径，改的是"起跑点已经包含什么"）**：新档案的 `f.actions` 前
 * 六条是草稿（`'draft-pick'`），而 `stateAfterDraft(f)` 起跑时**已经把它们走完了**
 * （相位都是 `'turn'` 了）⇒ 循环必须**跳过**那几条，否则第一条就会被
 * `performDraftPick` 的相位守卫抛错（T12 实现期实测："game not in turn phase"）。
 * 跳过之后 `n` 的含义仍然是**档案第 n 条操作之后**：`n = 6` 就是 "6 条草稿走完"，
 * 与 `stateAfterDraft(f)` 逐字节相等（有腿）。
 *
 * **`n` 是操作条数，不是 `seq`**：`n = 0` 就是草稿结束的状态（与 T12 之前一致，
 * 逐字节等于 `stateAfterDraft(f)`；两条重放路径的这一点都有腿），`n = f.actions.length`
 * 是终局。这也是重连要的口径：房主报的 `appliedSteps` 与档案下标是同一个数。
 *
 * **越界一律拒绝（抛错），不夹紧**。理由：夹紧会把"对端比我多走了几步"静默变成一个**看起来
 * 同步**的状态 —— 那正是 D1「分叉就停下来给可读提示，不静默继续」要避免的形态，也与本模块
 * 既有的取舍一致（未覆盖的 `kind` 抛错，`replayDraftFromSetup` 的不足/多余/池外三种错全抛）。
 * 非整数（含 `NaN`）同样拒绝：不拒的话 `[0, n)` 这个循环会把 `1.5` 悄悄当成 1 走完。
 *
 * 返回的状态是**全新**的：每一轮都把那条记录**规范化（`normalizeAction` 深拷贝 `args`）**
 * 之后再喂给引擎。这一层拷贝不是洁癖，是必需的 —— 引擎会把调用方传进去的 `choice` 数组
 * **原样存进状态**（`src/core/effects/resolve.ts:168` 的 `pe.lastAnswer = { selected }`），
 * 而 `effect-choice` 的 `args.choice` 恰好就是档案里的那个数组。实测（`.superpowers/g5-T4/`
 * 的探索件，**37 步**档案 `g5t4-diff-first-9`，共享出现在 `n = 36`，即走完前 36 条之后的那一步）：
 * 不拷贝时那一步返回的状态与 `f.actions`
 * **共享 1 个对象**，改返回值就顺着那条引用改掉了档案里的一条操作。重连恰好会落在这种
 * "选择答到一半"的步上（挂起效果 2 个），所以这不是理论风险。
 * 腿见 `tests/app/match-replay.test.ts`「判据 4：返回的状态不共享档案的引用」。
 * 顺带：`normalizeAction` 在值上是恒等变换（只丢未知 `via`），指纹因此一字不变。
 */
export function stateAtStep(f: MatchFile, n: number): GameState {
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`stateAtStep: n 必须是不小于 0 的整数（收到 ${String(n)}）`);
  }
  if (n > f.actions.length) {
    throw new Error(
      `stateAtStep: n=${n} 超出档案长度 ${f.actions.length}（拒绝夹紧：夹紧会把"对端比我多走了几步"静默成一个看起来同步的状态）`,
    );
  }
  const s = stateAfterDraft(f);
  /**
   * 起跑点已经走完了多少条**草稿**动作（老档案是 0：它的草稿不在日志里，是 `setup` 重建的）。
   * 这个数就是循环要跳过的前导条数 —— 它由**同一个** `draftPicksInLog` 数出来，
   * 与 `stateAfterDraft` 挑路用的是同一份判据。
   */
  let applied = draftPicksInLog(f).length;
  while (applied < n) {
    const a = f.actions[applied];
    if (a === undefined) break; // `n > f.actions.length` 已在上面被拒，这里是防御性兜底
    applyRecordedAction(s, normalizeAction(a));
    applied += 1;
  }
  return s;
}
