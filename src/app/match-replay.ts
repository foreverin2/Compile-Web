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
  matchFileToCreateOptions,
  normalizeAction,
  type ActionRecord,
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
  }
  // 穷尽性守卫：上面的 switch 覆盖了全部 8 个 ActionKind，TypeScript 在这里把 `a.kind` 收成
  // `never`。若将来 `ActionKind` 新增取值而这里漏了分支，**这行会在 tsc 阶段就报错**
  // （`never` 不可赋给形参），而不是到运行时才静默走空。`as ActionKind` 只为让运行时兜底
  // 分支也能编译通过（调用方可能喂进一份被篡改的档案）。
  const unknownKind = (a as { kind: ActionKind }).kind;
  throw new Error(`applyRecordedAction: 未覆盖的操作 kind=${String(unknownKind)}（档案被篡改或 ActionKind 新增后漏了分支）`);
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
 * 从档案重建到草稿结束的状态：`createGame(matchFileToCreateOptions(f))` + 草稿重放。
 *
 * 返回的状态是**全新**的（不共享档案里的任何引用），调用方可以随意推进它。
 * `ReplayDriver` 从这里起跑，再逐步 `applyRecordedAction` 走 `f.actions`。
 */
export function stateAfterDraft(f: MatchFile): GameState {
  const s = createGame(matchFileToCreateOptions(f));
  replayDraftFromSetup(s, f.setup);
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
 * **`n` 是操作条数，不是 `seq`**：`n = 0` 就是草稿结束的状态（逐字节等于 `stateAfterDraft(f)`），
 * `n = f.actions.length` 是终局。
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
  for (let i = 0; i < n; i += 1) {
    applyRecordedAction(s, normalizeAction(f.actions[i]));
  }
  return s;
}
