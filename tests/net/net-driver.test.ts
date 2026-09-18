/**
 * G5 T5 行为腿 + 一条文本腿：`src/net/net-driver.ts`
 * （计划 `docs/2026-09-17-G5-传输层联机-实现计划.md` §5 T5 的五条验收判据；
 * 设计稿 §0.3 裁决 #7 锁步、§0.4 红线 2 不做服务端权威）。
 *
 * ## 这个文件的每一条腿各自在守什么（对应关系写在这里，不散在各处）
 *
 * | 判据 | 腿所在 | 它为什么不能换成"更省事"的写法 |
 * |---|---|---|
 * | 1（★ 60 步差分） | `describe('判据 1…')` | 只能真跑引擎 + 真走 fake 传输；**每一维都要有非平凡的动作**，否则"两端相等"会因为"什么都没发生"而恒真 |
 * | 2（拒绝码） | `describe('判据 2…')` | 三个码必须**互不相同**，只断言 `ok === false` 会把 D16 那一处区分抹掉 |
 * | 3（从机无第二份映射） | `describe('判据 3…')` | **只能是文本腿**：另写一份语义逐字相同的映射，行为腿一次都不红（计划 §2 第 15 条最后一条的实证） |
 * | 4（`dispose()` 之后） | `describe('判据 4…')` | 关闭是异步的，而"通道关闭"必须能被同步观测到，否则它会退化成一句注释 |
 * | 5（`acceptsInput` 四种组合） | `describe('判据 5…')` | 四种组合要**逐个**出现，两两组合全试一遍才挡得住"只判其中一个条件" |
 *
 * 除五条判据之外，文件里另有几条**边界腿**（它们不属于判据，但少了就会有"不报错的停摆"）：
 * 走线帧的两处 `seq` 一致（`decodeMsg` 真的被喂过）、入站坏帧的三种处置
 * （序号错位 / 解不出来 / 非 `act` 放行）、链路状态转发与退订、入站队列深度读数
 * （`pendingCount()`）、`send` 三种失败来源都落到 `'offline'`、以及**座位守卫**那条（判据 2 里）。
 * 全文 **24 条腿**。
 *
 * ## ★ 判据 1 的**牙长在哪**（T5 阶段一评审实测后更正，务必读这一段再看那个 `describe`）
 *
 * 这条腿声称的是"每一步之后两端指纹相等"，但它的判据是**"两端相等"**，因此：
 *
 *  1. 它抓得住**不对称**的错：一端落地、另一端没落地（变异 M2 / 评审的 V2、V7 都红在
 *     `第 N 步之后两端指纹必须相等` 那一句上）。这是它真实的能力。
 *  2. 它**抓不住"两端都错、且错得一样"**：变异 M1（两端都只推进序号、都不落地）在位时，
 *     那 60 次指纹比对**一次都没红** —— 两端都冻在开局、次次相等。
 *     评审的实证：把本文件的前缀另接一条"只比指纹、去掉全部反空转"的腿，M1 在位时它**全绿**。
 *  3. 它**只在一个瞬间取样**，因此抓不住"每一步都迟一拍、但永远迟得一样多"的实现：
 *     比对发生在 `submit -> pump(2) -> arm` 之后，而 `pump` 只推进 tick（第 k 步的帧要到
 *     下一次 pump 才交付）⇒ 第 k 步比的是"两端都还没应用第 k 步"的同步瞬间。
 *     ⚠️ 这是这条腿的**能力边界**，不是缺陷 —— 但在读到"60 次都相等"时要知道它保证的是什么。
 *
 * ⇒ **那四句反空转断言是判据 1 的牙，不是锦上添花**：
 * `appliedSteps() === 60`（两端）、`players` 恰为 `[0, 1]`、`kinds` 必须覆盖
 * `REQUIRED_KINDS[seed]` 里的每一项、`new Set(fingerprints).size > 30`。
 * 删掉它们，判据 1 就退化成一条"60 次比较同一个值"的恒真腿，而 60 步循环照跑、照绿。
 * 谁哪天为了"跑得快"动它们，请先看这一段。
 * （M1 另外还有两条直接的牙：判据 1 里"**只 `arm` 不 `submit`**"那条腿，
 * 以及独立探针 `.superpowers/g5-T5/probes/` 里的探针 M1。）
 *
 * ## 为什么"每一维都要有非平凡的动作"（逐局要求，不是全局阈值）
 *
 * 60 步里若全是 `advance`，那"两端相等"证明的东西很薄。所以反空转是**按局**断言的：
 * 每一局必须覆盖它自己那一格 `REQUIRED_KINDS`。全局写"种类 ≥ 4"会让"某一局的某一维一次都没走到"
 * 永远不被发现 —— 实测就是如此：`g5-t5-gamma` 那一局里 `compile` **一次都没有**，
 * 而当时的全局阈值照样绿。⇒ 本文件用两个种子：`g5-t5-gamma`（含 `resolve-trigger`）与
 * `g5-t5-theta`（含 `compile`），两条腿各自钉住自己那一格。
 *
 * 本文里出现的具体数字都是这次跑出来的，**换种子要重测**。
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { stripComments } from '../ui/source-text';
import { createNetDriver, NET_DRIVER_MODE } from '../../src/net/net-driver';
import type { NetDriver } from '../../src/net/net-driver';
import { createFakeTransportPair } from '../../src/net/fake-transport';
import type { FakeTransportPair } from '../../src/net/fake-transport';
import { decodeMsg } from '../../src/net/protocol';
import type { NetChannel } from '../../src/net/transport';
import { createMatchFileRecorder, normalizeAction, setupFromState } from '../../src/app/match-file';
import type { ActionRecord, MatchFileRecorder } from '../../src/app/match-file';
import { createGame, draftNextAction, getDraftPool, performDraftPick, performDraftBan } from '../../src/core/state/create';
import { getLegalActions, type LegalAction } from '../../src/core/game';
import { stateFingerprint } from '../../src/core/fingerprint';
import type { GameState, PlayerId } from '../../src/core/models/types';

/* ------------------------------------------------------------------ *
 * 夹具 0：确定性策略（**不用 Math.random** —— 测试也保持纯层的风格）
 * ------------------------------------------------------------------ */

/**
 * 草稿策略：每一步在可选池里按**步数**取一个（不是恒取池首）。
 *
 * 为什么不用池首：池首策略下两端的开局完全一样，判据 1 的差分腿就少了"草稿序列真的
 * 被两端各自重放出来"这一维。这里用的是同一个确定性函数，两端算出同一个结果。
 */
function draftDeterministic(s: GameState): void {
  let guard = 0;
  for (;;) {
    const next = draftNextAction(s);
    if (!next) break;
    if (guard++ > 200) throw new Error('草稿没有收敛');
    const pool = getDraftPool(s).map((p) => p.defId);
    const defId = pool[(guard * 7) % pool.length];
    if (next.kind === 'pick') performDraftPick(s, defId);
    else performDraftBan(s, defId);
  }
}

/** 开局状态：`createGame` + 走完草稿。两端各调一次，**不共享任何引用** */
function opening(seed: string): GameState {
  const s = createGame({ seed });
  draftDeterministic(s);
  expect(s.phase, `草稿必须走完：seed=${seed}`).toBe('turn');
  return s;
}

/**
 * 把一步从发送方送到接收方要走几步。
 *
 * 实测依据（不是猜的）：fake 的 `scheduledTick` 是
 * `nowTick + latencyTicks + extraTicks + 1`（`fake-transport.ts:365-367`），缺省
 * `latencyTicks = 1` ⇒ 第 0 步发出的帧到达步是 **2**，而 `pumpOnce` 每步只交付一帧
 * （`:506-526`）。所以 `pump(1)` **到不了** —— 第一次实测就是踩了这一格：
 * 两端指纹在第 0 步就分叉（对端根本没收到），而退出码与"真分叉"完全同形。
 * `ACT_LATENCY_TICKS` 写成 2 而不是 1，就是为了让这个数只有一个出处。
 */
const ACT_LATENCY_TICKS = 2;

/**
 * 本文件统一用的种子。选它的理由是实测出来的（`.superpowers/g5-T5/` 的探索件；换种子必须重测）：
 *  - 60 步走得完（没有在第 60 步之前终局）；
 *  - 两个座位**都**有操作（30 : 30）；
 *  - 操作种类 ≥ 4（`advance` / `play` / `effect-choice` / `resolve-trigger`），
 *    这样判据 1 的"每步指纹相等"才不是"60 次 advance 相等"；
 *  - 开局第一步的行动方是 **P0**（host）—— 判据 2 的"让另一端提交"因此有一个确定的对象。
 *
 * ⚠️ 它**不含 `compile`**（T5 阶段一评审实测：`{advance:46, play:9, effect-choice:4,
 * resolve-trigger:1}`）⇒ `compile` 那一维由 `G5_T5_SEED_WITH_COMPILE` 那一局补。
 */
const G5_T5_SEED = 'g5-t5-gamma';

/**
 * 判据 1 用的**第二份档案**的种子。
 *
 * ## 为什么需要第二个种子（T5 阶段一评审的发现）
 *
 * 评审普查了 `G5_T5_SEED`（`g5-t5-gamma`）的 kind 分布：
 * `{"advance":46,"play":9,"effect-choice":4,"resolve-trigger":1}` —— **`compile` 一次都没有**。
 * 而判据 1 原来的反空转只断言"操作种类 ≥ 4"，所以 `compile` 那条分支在判据 1 里
 * **从未被走过**。我按同一条策略普查了 8 个种子（探查件
 * `.superpowers/g5-T5/probes/seed-kinds.test.ts`，命令与 8 行原始输出见报告 §0.3），
 * 其中 `g5-t5-theta` 的分布是 `{"advance":49,"play":9,"effect-choice":1,"compile":1}` —— 含 `compile`。
 * ⇒ 第二个种子不是"多跑一遍"，它**专门补上 `compile` 这一维**；两条腿各自断言自己那一局
 * 必须出现哪些 kind（见 `REQUIRED_KINDS`），所以"哪一局补哪一维"是机械可查的，不靠人记。
 */
const G5_T5_SEED_WITH_COMPILE = 'g5-t5-theta';

/**
 * 每个种子**必须**出现的操作种类（判据 1 的反空转按它**逐局**断言）。
 *
 * 为什么写成"逐局要求"而不是"全局 ≥ N"：全局阈值会让"某一局的某一维一次都没走到"
 * 永远不被发现 —— 这正是 `compile` 今天的状态（评审发现的那一条）。
 * 表里的名字是**样本反推**的实测值，不是手写清单（逐种子普查见
 * `.superpowers/g5-T5/probes/seed-kinds.test.ts`，8 行 `PROBE-KINDS` 输出在报告 §0.3）：
 *  - `g5-t5-gamma`：`advance` 46 / `play` 9 / `effect-choice` 4 / `resolve-trigger` 1；
 *  - `g5-t5-theta`：`advance` 49 / `play` 9 / `effect-choice` 1 / `compile` 1。
 *
 * ## ⚠️ 这张表是**人工维护**的，改它之前先看普查输出（T5 复验人交办的一句）
 *
 * 它是**包含判定**（"这一局必须走出这些 kind"）⇒ 它**不会假绿，但会假红**：
 *  `compile` 在 `theta` 那局只出现 **1 次**、`resolve-trigger` 在 `gamma` 那局也只 **1 次**
 *  （余量各只有 1）。引擎的任何小改动都可能让某一步不再走那个分支 ⇒ 这条腿红，
 *  而**看起来最自然的"修法"是把那个 kind 从表里删掉** —— 那正好会**静默拆掉这一维唯一的覆盖**
 *  （也就退回评审发现的"`compile` 从未被走过"那个状态）。
 *  ⇒ 表红了要按这个顺序处理：① 先跑普查确认这一维是不是真的没了（`PROBE-KINDS` 那一行）；
 *    ② 若只是换了种子/步数 ⇒ 换种子或补第三个种子（并同步改这张表）；
 *    ③ **只有在确认这一维在整套夹具里再也走不到时**才允许删条目，且在报告里写明"删了哪一维、为什么"。
 * 数字是这次跑出来的，**换种子/换步数必须重测并改这张表**。
 */
const REQUIRED_KINDS: Record<string, readonly string[]> = {
  [G5_T5_SEED]: ['advance', 'play', 'effect-choice', 'resolve-trigger'],
  [G5_T5_SEED_WITH_COMPILE]: ['advance', 'play', 'effect-choice', 'compile'],
};

/** 挂起选择的首选答案（与 `tests/helpers.ts:19` 的 `pickFirst` 同口径，这里复制一份以免跨文件耦合） */
function pickFirst(prompt: {
  optional: boolean;
  kind: string;
  lines?: number[];
  actions?: string[];
  candidates: { uid: string }[];
  max: number;
}): string[] {
  if (prompt.optional) return [];
  if (prompt.kind === 'select-line') return [`line:${prompt.lines?.[0] ?? 0}`];
  if (prompt.kind === 'select-action') return [prompt.actions?.[0] ?? ''].filter(Boolean);
  return prompt.candidates.slice(0, prompt.max).map((c) => c.uid);
}

/** 把一条 `LegalAction` 转成 `ActionRecord` 的 args（与 `match-driver.test.ts:100` 的 `argsOf` 同形） */
function argsOf(a: LegalAction): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  if (a.cardUid !== undefined) args.cardUid = a.cardUid;
  if (a.faceUp !== undefined) args.faceUp = a.faceUp;
  if (a.line !== undefined) args.line = a.line;
  if (a.target !== undefined) args.target = a.target;
  return args;
}

/**
 * 确定性策略：给出**当前状态**上的下一条操作（谁动、动什么）。两端各自独立算出同一条。
 *
 * 与 `tests/app/match-driver.test.ts` 的 `playAndRecord` 同一套判断顺序：
 *  1. 有带 `prompt` 的挂起效果 ⇒ 一条 `effect-choice`（应答者是 `prompt.chooser`，缺省该效果的玩家）；
 *  2. 否则取 `getLegalActions(s, s.turnPlayer)` 的第 `(step % 3)` 条（**非平凡**：不是恒取第一条）。
 */
function nextAction(s: GameState, step: number): Omit<ActionRecord, 'seq'> | null {
  if (s.phase !== 'turn' || s.winner !== null) return null;
  const top = s.pendingEffects[s.pendingEffects.length - 1];
  if (top !== undefined && top.prompt !== null && top.prompt !== undefined) {
    const choice = pickFirst(top.prompt);
    const chooser: PlayerId = top.prompt.chooser ?? top.player;
    return { player: chooser, kind: 'effect-choice', args: { promptId: top.id, choice } };
  }
  const player = s.turnPlayer;
  const legal = getLegalActions(s, player);
  if (legal.length === 0) return null;
  const a = legal[step % Math.min(legal.length, 3)];
  if (a.kind === 'play') return { player, kind: 'play', args: argsOf(a) };
  if (a.kind === 'compile') return { player, kind: 'compile', args: { line: a.line } };
  if (a.kind === 'resolve-trigger') return { player, kind: 'resolve-trigger', args: { cardUid: a.cardUid } };
  if (a.kind === 'effect-choice') return { player, kind: 'effect-choice', args: { promptId: a.promptId, choice: a.choice } };
  return { player, kind: a.kind };
}

/* ------------------------------------------------------------------ *
 * 夹具 1：两端 + fake 传输
 * ------------------------------------------------------------------ */

interface Endpoint {
  driver: NetDriver;
  s: GameState;
  recorder: MatchFileRecorder | null;
}

/**
 * 建一对已经握好手的锁步驱动。
 *
 * `init()` 之后两端 `status()` 都是 `online`（fake 的三条自洽规则，见 `fake-transport.ts:566-602`）。
 * ⚠️ 按 D18：`init().ok` **不是**"对端在线"的判据（真 WebRTC 在 init 那一刻不知道对端在不在），
 * 本文件只用它把链路开起来。
 */
async function makePair(seed: string, opts: { guestRecorder?: boolean } = {}): Promise<{
  pair: FakeTransportPair;
  host: Endpoint;
  guest: Endpoint;
}> {
  const pair = createFakeTransportPair();
  await pair.A.transport.init({ selfId: 'A', peerId: 'B' });
  await pair.B.transport.init({ selfId: 'B', peerId: 'A' });

  const hostState = opening(seed);
  const guestState = opening(seed);
  const hostRecorder = createMatchFileRecorder();

  const host: Endpoint = {
    driver: createNetDriver({ transport: pair.A.transport, seat: 0, recorder: hostRecorder }),
    s: hostState,
    recorder: hostRecorder,
  };
  const guest: Endpoint = {
    driver: createNetDriver({
      transport: pair.B.transport,
      seat: 1,
      recorder: opts.guestRecorder ? createMatchFileRecorder() : null,
    }),
    s: guestState,
    recorder: opts.guestRecorder ? createMatchFileRecorder() : null,
  };
  return { pair, host, guest };
}

/** 谁该动：用**本端状态**算出来（两端的状态是同一份，所以两端算出的答案相同） */
function actorOf(host: Endpoint, guest: Endpoint, step: number): { ep: Endpoint; a: Omit<ActionRecord, 'seq'> } {
  const a = nextAction(host.s, step) ?? nextAction(guest.s, step);
  if (a === null) throw new Error(`第 ${step} 步没有可用的操作（对局提前结束或策略卡住）`);
  return { ep: a.player === 0 ? host : guest, a };
}

/**
 * 走一步：本端 `submit` ⇒ 让帧到达对端 ⇒ 对端 `arm(它的状态)` 把收到的帧落地。
 *
 * 最后那一下是**必须有**的，理由是本驱动的一条结构事实（第一版漏了它：60 步差分腿在第 0 步
 * 就红，而症状是"对端指纹根本没动"）：
 *
 *  - `transport.onMessage` 是**推送**（帧在 `pump` 里到达时回调），而驱动**不持有 `GameState`**
 *    （G4 D2 的既有结构约束）⇒ 回调里只能把帧入队；
 *  - 真正应用它需要宿主把状态递进来，而这件事的正规口就是 `driver.arm(state)`
 *    （见 net-driver.ts 里 `arm` 的注释：它存在的理由是推送式入站 + 无状态驱动）。
 *
 * `arrive` 把这两件事绑在一起，是为了让每一条腿都走**生产上该走的那条路**，
 * 而不是让测试自己手动拼一段"引擎直呼"。
 */
function arrive(pair: FakeTransportPair, receiver: Endpoint): void {
  pair.pump(ACT_LATENCY_TICKS);
  receiver.driver.arm(receiver.s);
}

/* ------------------------------------------------------------------ *
 * 判据 1（★）：60 步差分腿
 * ------------------------------------------------------------------ */

/**
 * 走完 60 步，返回这一局观测到的读数（kind 集合、座位集合、每一步之后的指纹）。
 *
 * 提出来是为了让"两个种子各跑一遍"共用同一条腿体：若两条腿各抄一份循环，
 * 两份就可能各自漂移（本仓"同一份 switch 抄两处"那一族的同形）。
 * 它只做一件事之外的一切：**不做反空转断言** —— 那些单独放在 `assertNonVacuous` 里，
 * 这样"哪条腿红"始终对应"哪一条主张不成立"。
 */
function walk60With(
  pair: FakeTransportPair,
  host: Endpoint,
  guest: Endpoint,
): { kinds: Set<string>; players: Set<number>; fingerprints: string[] } {
  const kinds = new Set<string>();
  const players = new Set<number>();
  const fingerprints: string[] = [];
  // 两端都先递一次状态：驱动不持有状态，`arrive` 那一侧才知道"轮到谁"
  host.driver.arm(host.s);
  guest.driver.arm(guest.s);
  for (let step = 0; step < 60; step += 1) {
    const { ep, a } = actorOf(host, guest, step);
    const peer = ep === host ? guest : host;
    const r = ep.driver.submit(ep.s, a);
    expect(r.ok, `第 ${step} 步的 submit 必须成功（${a.player}:${a.kind}）`).toBe(true);
    // 让帧到达对端，并让对端把收到的帧落地（见 `arrive` 的注释：这一下不能省）
    arrive(pair, peer);
    // ★ 判据 1 的核心：**每一步之后**都取一次两端的 stateFingerprint
    const fpHost = stateFingerprint(host.s);
    const fpGuest = stateFingerprint(guest.s);
    expect(fpHost, `第 ${step} 步之后两端指纹必须相等（${a.player}:${a.kind}）`).toBe(fpGuest);
    fingerprints.push(fpHost);
    kinds.add(a.kind);
    players.add(a.player);
  }
  return { kinds, players, fingerprints };
}

/**
 * 判据 1 的**反空转断言**（同一个种子共用一份：两条腿的牙必须一模一样）。
 *
 * ⚠️ **这四句是判据 1 的牙，不是锦上添花**（T5 阶段一评审的实测结论，详见文件头）：
 * 差分腿判的是"两端相等"，所以"两端都只推进序号、都不落地"（变异 M1）在位时，
 * 那 60 次指纹比对**一次都没红**，红的就是下面这四句。删掉它们，判据 1 会退化成
 * 一条"60 次比较同一个值"的恒真腿，而 60 步循环照跑、照绿。
 *
 * 逐条为什么不可删：
 *  - `appliedSteps() === 60`：两端步数都要走到 60 —— 抓"什么都没发生"（M1 的第一个症状）。
 *  - `players` 恰为 `[0, 1]`：两个座位都要真的动过 —— 抓"只有本端在走"。
 *  - `kinds ⊇ REQUIRED_KINDS[seed]`：**逐局**要求，抓"某一维一次都没走到"
 *    （评审实测：`g5-t5-gamma` 那局的 `compile` 一次都没有）。
 *  - `new Set(fingerprints).size > 30`：指纹不许退化成常数 —— 否则"60 次相等"毫无信息。
 */
function assertNonVacuous(
  seed: string,
  host: Endpoint,
  guest: Endpoint,
  observed: { kinds: Set<string>; players: Set<number>; fingerprints: string[] },
): void {
  expect(host.driver.appliedSteps(), '走完的步数').toBe(60);
  expect(guest.driver.appliedSteps(), '两端已应用步数必须相同').toBe(60);
  expect([...observed.players].sort(), '两个座位都必须动过').toEqual([0, 1]);
  const required = REQUIRED_KINDS[seed];
  expect(required, `REQUIRED_KINDS 里必须有 ${seed} 这一格（新加种子时要补表）`).toBeDefined();
  // 每局都把自己的 kind 分布打出来：`REQUIRED_KINDS` 这张表必须能由这条输出复算，
  // 而不是我自己抄一遍（第一版我在探针里手抄了一份策略，结果普查出的分布与这条腿对不上）。
  console.log(`KINDS seed=${seed} ${JSON.stringify([...observed.kinds].sort())}`);
  for (const kind of required) {
    expect(
      [...observed.kinds].includes(kind),
      `seed=${seed} 这一局必须走出 ${kind}（实际 ${[...observed.kinds].sort().join('/')}）`,
    ).toBe(true);
  }
  expect(new Set(observed.fingerprints).size, '60 步的指纹不该只有少数几个值').toBeGreaterThan(30);
  // 终局的最后一步之后仍然相等（循环里已经比过，这里再钉一次"事后"）
  expect(stateFingerprint(host.s)).toBe(stateFingerprint(guest.s));
}

describe('判据 1（★）：两端接 fake 传输，确定性走 60 步，每一步之后两端指纹相等', () => {
  it(`60 步 / 逐局覆盖 kind（seed=${G5_T5_SEED}：含 resolve-trigger）`, async () => {
    const seed = G5_T5_SEED;
    const { pair, host, guest } = await makePair(seed);
    // 起跑点必须一致（否则后面的"每一步都相等"从一开始就是假的）
    expect(stateFingerprint(host.s), '两端起跑指纹必须相同').toBe(stateFingerprint(guest.s));
    const observed = walk60With(pair, host, guest);
    assertNonVacuous(seed, host, guest, observed);
  });

  it(`60 步 / 逐局覆盖 kind（seed=${G5_T5_SEED_WITH_COMPILE}：补 compile 这一维）`, async () => {
    const seed = G5_T5_SEED_WITH_COMPILE;
    const { pair, host, guest } = await makePair(seed);
    expect(stateFingerprint(host.s), '两端起跑指纹必须相同').toBe(stateFingerprint(guest.s));
    const observed = walk60With(pair, host, guest);
    assertNonVacuous(seed, host, guest, observed);
  });

  /**
   * **到达即落地**：帧到达本端那一刻就被应用（不等下一次 `submit`）。
   *
   * ## 这条腿证明什么、不证明什么（修复轮复验人实测后收窄，别按旧注释读）
   *
   * 它证明的是"**帧一到就落地**"这一半：本端 `submit` ⇒ `pump` ⇒ 对端此刻
   * `appliedSteps() === 1`、指纹已经变了、两端相等。
   *
   * ⚠️ 它**不**证明"`arm` 里的 `drain` 承重"。复验人实测：把 `arm` 里的 `drain(s)` 删掉
   * （变异 S2），**这条腿依然全绿** —— 因为对端的订阅回调在 `pump` 里就把帧应用了，
   * 而本端 `submit` 自己也会 `drain` ⇒ 队列空是**别人**干的。
   * ⇒ "`arm` 会排空队列"这件事由 `describe('入站队列的只读读数 pendingCount()')` 里那条腿证明
   *   （它先喂帧、**后**才 `arm`；S2 下红在 `arm 之后队列必须空`）。两条腿分工不同，别混。
   *
   * 它仍然必要：把"对端真的调用了 `applyRecordedAction`"从判据 1 的**间接**证明
   * （反空转的副产物）变成一条**直接的语义断言** —— 那正是评审 §3.1 拆开的间接性。
   */
  it('★ 到达即落地：帧一到本端就被应用（不等下一次 submit）', async () => {
    const seed = G5_T5_SEED;
    const { pair, host, guest } = await makePair(seed);
    host.driver.arm(host.s);
    guest.driver.arm(guest.s);

    // 本端走一步（这一步会真的上线）
    const { ep, a } = actorOf(host, guest, 0);
    const peer = ep === host ? guest : host;
    const peerBefore = stateFingerprint(peer.s);
    expect(ep.driver.submit(ep.s, a).ok, '本端这一步必须成功').toBe(true);
    expect(peer.driver.appliedSteps(), '对端此刻还没收到，步数必须是 0').toBe(0);

    // 让帧到达对端。**不**调对端的 `submit`（这条腿要证的正是"不用等下一次 submit"）。
    pair.pump(ACT_LATENCY_TICKS);

    // ★ 承重断言：到达即落地（帧不是"烂在队列里等下一次 submit"）
    expect(peer.driver.appliedSteps(), '帧到达就必须落地（不走对端的 submit）').toBe(1);
    expect(stateFingerprint(peer.s), '对端的状态必须真的变了').not.toBe(peerBefore);
    expect(stateFingerprint(peer.s), '两端指纹必须相等').toBe(stateFingerprint(ep.s));
    // 队列此刻必须是空的。这一句在 S2 世界也绿 —— 它是**口径登记**，不是这条腿的判别力所在。
    expect(peer.driver.pendingCount(), '到达即落地之后队列必须是空的').toBe(0);

    // 生产路径的最后一环：宿主把状态递进来（`arm` 就是那个口，见 net-driver.ts 的注释）。
    // 上面已经落地了 ⇒ 这一步只更新 `lastKnownState`，两件事实都必须保持不变。
    peer.driver.arm(peer.s);
    expect(peer.driver.pendingCount(), 'arm 落地之后队列必须空').toBe(0);
    expect(peer.driver.appliedSteps(), 'arm 不该让同一条被应用两次').toBe(1);
    expect(stateFingerprint(peer.s), 'arm 之后状态与指纹都不许再动').toBe(stateFingerprint(ep.s));
    expect(peer.driver.lastFailure(), '落地的路上不该留下诊断').toBeNull();
  });

  it('主机记录器逐条等于提交序列（T6 resync 的凭据不能只是"条数对"）', async () => {
    const seed = G5_T5_SEED;
    const { pair, host, guest } = await makePair(seed);
    expect(host.recorder, '主机必须有记录器').not.toBeNull();
    expect(guest.driver.recorder(), '从机可以是 null').toBeNull();

    // 记下**本端提交的那条序列**（这才是"档案应该长什么样"的唯一出处）
    const submitted: Omit<ActionRecord, 'seq'>[] = [];
    host.driver.arm(host.s);
    guest.driver.arm(guest.s);
    for (let step = 0; step < 60; step += 1) {
      const { ep, a } = actorOf(host, guest, step);
      const peer = ep === host ? guest : host;
      submitted.push(normalizeAction({ ...a, seq: step }));
      expect(ep.driver.submit(ep.s, a).ok).toBe(true);
      arrive(pair, peer);
    }

    const actions = host.recorder!.actions();
    expect(actions.length, '主机记录器里的条数').toBe(60);
    // `seq` 必须是 0..59 且严格递增 —— 记录器的编号是它自己的事（本驱动不覆盖它）
    expect(actions.map((x) => x.seq)).toEqual([...Array(60).keys()]);

    // ★ 逐条比对（不只是条数 + 两个座位）：评审的 V3（对端落地但**不进记录器**）
    //   今天只被"条数 34 !== 60"这一句**计数**抓住，而记录器是 D8 给 T6 resync 的凭据,
    //   "少了 26 条"与"某一条被换成别的操作"在计数上同形。所以这里比到**值**这一层。
    //   比什么：`player` + `kind` + `normalizeAction` 之后的 `args`（深比，靠 `toEqual`）。
    //   不比 `via`：它是档案层元数据、本驱动按 `'user'` 补，不是"提交序列"的一部分。
    expect(
      actions.map((x) => ({ player: x.player, kind: x.kind, args: normalizeAction(x).args })),
      '记录器必须**逐条**等于本端提交的那条序列（uid 序列与 kind 序列一起比）',
    ).toEqual(submitted.map((x) => ({ player: x.player, kind: x.kind, args: normalizeAction({ ...x, seq: 0 }).args })));

    // 两句话分开写，红了能立刻看出是"位置错"还是"内容错"
    expect(actions.map((x) => x.kind), 'kind 序列').toEqual(submitted.map((x) => x.kind));
    expect(
      actions.map((x) => (x.args as { cardUid?: string; promptId?: string } | undefined)?.cardUid ?? (x.args as { promptId?: string } | undefined)?.promptId ?? null),
      'uid 序列（`play` 的 cardUid / `effect-choice` 的 promptId；无参 kind 记 null）',
    ).toEqual(
      submitted.map((x) => (x.args as { cardUid?: string; promptId?: string } | undefined)?.cardUid ?? (x.args as { promptId?: string } | undefined)?.promptId ?? null),
    );
    // 两个座位都要有（这条是**辅助**，不能替代上面的逐条比对 —— 34 条里各一条也满足它）
    expect(new Set(actions.map((x) => x.player)).size, '记录器里要有两个座位的操作').toBe(2);
  });

  it('走线的是协议消息：act.seq === action.seq，且对端收到的是同一条记录', async () => {
    const seed = G5_T5_SEED;
    const { pair, host, guest } = await makePair(seed);
    host.driver.arm(host.s);
    guest.driver.arm(guest.s);
    for (let step = 0; step < 6; step += 1) {
      const { ep, a } = actorOf(host, guest, step);
      const peer = ep === host ? guest : host;
      expect(ep.driver.submit(ep.s, a).ok).toBe(true);
      arrive(pair, peer);
    }
    const actFrames = pair.steps().filter((d) => d.channel === 'act');
    expect(actFrames.length, '6 步应当产出 6 帧 act').toBe(6);
    // 逐帧解码：序号两处一致，且 `player`/`kind` 与提交的那条一致（不是"另一条记录"）
    actFrames.forEach((frame, i) => {
      const decoded = decodeMsg(frame.text);
      expect(decoded.ok, `第 ${i} 帧必须能解码`).toBe(true);
      if (!decoded.ok) return;
      expect(decoded.msg.t).toBe('act');
      if (decoded.msg.t !== 'act') return;
      expect(decoded.msg.seq, `第 ${i} 帧的线序`).toBe(i);
      expect(decoded.msg.action.seq, `第 ${i} 帧的 action.seq`).toBe(i);
    });
  });
});

/* ------------------------------------------------------------------ *
 * 判据 2：拒绝码（三个码互不相同）
 * ------------------------------------------------------------------ */

describe('判据 2：非本端回合 ⇒ not-the-next-action；断线 ⇒ offline；dispose 之后 ⇒ read-only', () => {
  it('不是本端的回合 ⇒ 拒，码恰为 not-the-next-action（不是 offline，也不是 read-only）', async () => {
    const seed = G5_T5_SEED;
    const { host, guest } = await makePair(seed);
    // 找出第一步该谁动，然后让**另一端**去提交同一条
    const { ep, a } = actorOf(host, guest, 0);
    const other = ep === host ? guest : host;
    const r = other.driver.submit(other.s, a);
    expect(r.ok).toBe(false);
    expect(r.refusal, '非本端回合的拒绝码').toBe('not-the-next-action');
    // 反空转：状态必须一字未动（拒绝发生在引擎之前），且步数没有前进
    expect(stateFingerprint(other.s), '被拒之后状态不许动').toBe(stateFingerprint(opening(seed)));
    expect(other.driver.appliedSteps()).toBe(0);
  });

  it('对端不可达时 submit ⇒ offline（**不是** read-only），且状态一字未动', async () => {
    const seed = G5_T5_SEED;
    const { pair, host, guest } = await makePair(seed);
    const { ep, a } = actorOf(host, guest, 0);
    // 拔线：fake 的 `deactivate()` 会把两端一起转成 offline（见 fake-transport.ts:713-721）
    (ep === host ? pair.A : pair.B).deactivate();
    expect(ep.driver.transport.status()).toBe('offline');
    const before = stateFingerprint(ep.s);
    const r = ep.driver.submit(ep.s, a);
    expect(r.ok).toBe(false);
    expect(r.refusal, 'D16：断线的拒绝码必须是 offline').toBe('offline');
    expect(stateFingerprint(ep.s), '离线时不许本地应用').toBe(before);
    expect(ep.driver.appliedSteps(), '离线时步数不许前进').toBe(0);
  });

  /**
   * ★ **座位守卫的永久腿**（T5 阶段一评审交办的**第 1 条**，也是这一轮最重要的补丁）。
   *
   * ## 为什么原来那条"不是本端的回合"腿没有牙
   *
   * 那条腿（上一条）让 `other` 去提交**同一条** `a`，而 `a` 本来就是按开局状态算出来的
   * ⇒ `liveTurn(other.s, a.player)` 里 `turnPlayer === a.player`，所以**不管有没有座位守卫**
   * 都会被 `liveTurn` 拒成同一个码 `'not-the-next-action'`。
   * ⇒ 它对座位守卫**零区分能力**。评审实测：删掉座位守卫，原来 22 条腿**全绿**。
   *
   * ## 真正的坏输入长什么样
   *
   * **让从机去提交主机的那条"当前该走"的操作** —— 而这条操作恰好也"通过"从机眼里的回合检查
   * （从机手里的状态里 `turnPlayer` 就是主机）。没有座位守卫时：
   * `liveTurn` 放行 ⇒ `encodeMsg` 成功 ⇒ `send` 成功 ⇒ **从机在自己的状态上把主线走了一步**，
   * 并把这条已经不再合法的操作发给主机；主机当时正等第 0 条、`seq` 也对得上 ⇒ 主机**会**应用它
   * ⇒ 两端从这里**永久分叉**。它不会被"序号错位"挡住。
   *
   * ## 这条腿断言四件事（删掉座位守卫必须红在其中之一）
   *
   * ① 拒绝码是 `'not-the-next-action'`；② 从机的 `appliedSteps()` 仍是 0；
   * ③ 从机的状态指纹一字未动；④ 线上**没有**因为这次调用多出一帧（"没发出去"的旁证）。
   */
  it('★ 座位守卫：从机提交主机的**当前**操作必须被拒（删掉守卫这条腿必红）', async () => {
    const seed = G5_T5_SEED;
    const { pair, host, guest } = await makePair(seed);
    host.driver.arm(host.s);
    guest.driver.arm(guest.s);

    // 夹具前提：开局第一步是 host（P0）的，且它现在是合法操作
    const { ep, a } = actorOf(host, guest, 0);
    expect(ep, '夹具前提：第 0 步必须轮到 host').toBe(host);
    expect(a.player, '夹具前提：这条操作的主人是 host').toBe(0);

    const guestBefore = stateFingerprint(guest.s);
    const framesBefore = pair.steps().length;

    // ★ 让**从机**提交这条**主机的当前操作**
    const r = guest.driver.submit(guest.s, a);

    expect(r.ok, '从机提交主机当前操作必须被拒').toBe(false);
    expect(r.refusal, '① 拒绝码').toBe('not-the-next-action');
    expect(guest.driver.appliedSteps(), '② 从机步数不许前进').toBe(0);
    expect(stateFingerprint(guest.s), '③ 从机状态一字未动').toBe(guestBefore);
    expect(pair.steps().length, '④ 线上不许因为这次调用多出一帧').toBe(framesBefore);
    // 两端仍然同步（没有分叉）—— 这才是这条坏输入真正的危害所在
    expect(stateFingerprint(host.s), '两端不许因为这次调用分叉').toBe(stateFingerprint(guest.s));

    // 反空转：同一条操作由**主机自己**提交则必须成功（否则上一条"被拒"可能只是操作不合法）
    expect(host.driver.submit(host.s, a).ok, '同一条操作由主机提交必须成功').toBe(true);
  });

  it('本端发送失败（含 queue-full）也归到 offline：不新增拒码，但三个来源都要能落到这里', async () => {
    const seed = G5_T5_SEED;
    const { pair, host, guest } = await makePair(seed);
    const { ep, a } = actorOf(host, guest, 0);
    const peer = ep === host ? guest : host;
    ep.driver.arm(ep.s);
    peer.driver.arm(peer.s);

    // 让传输**只在这一条腿期间**回报发送失败。为什么可以这样桩：
    // fake 传输**永不**返回 `'queue-full'`（`transport.ts:99-101` 自己写着这一点），
    // 所以"积压 ⇒ 归到 offline"这条分支在 fake 上没有任何输入能碰到 ——
    // 不桩它，这条分支就是一句没有腿的断言。
    const realSend = ep.driver.transport.send;
    const before = stateFingerprint(ep.s);
    (ep.driver.transport as { send: typeof realSend }).send = () => ({
      ok: false,
      reason: 'queue-full',
      message: '本端待发队列积压（由测试桩制造）。',
    });
    try {
      const r = ep.driver.submit(ep.s, a);
      expect(r.ok, '发送失败必须是拒绝').toBe(false);
      expect(r.refusal, '裁决：不新增拒码，queue-full 也归 offline').toBe('offline');
      // 与"对端不可达"同一条取向：**不许**本地应用（本地应用 = 静默分叉）
      expect(stateFingerprint(ep.s), '发不出去就不许本地应用').toBe(before);
      expect(ep.driver.appliedSteps(), '发失败时步数不许前进').toBe(0);
      expect(ep.driver.pendingCount(), '什么都没进队列').toBe(0);
    } finally {
      (ep.driver.transport as { send: typeof realSend }).send = realSend;
    }
    // 桩拆掉之后同一条操作必须成功（证明上一条的被拒**是桩造成的**，不是操作不合法）
    expect(ep.driver.submit(ep.s, a).ok, '拆掉桩之后同一条操作必须成功').toBe(true);
  });

  it('三个码互不相同：offline ≠ read-only ≠ not-the-next-action（D16 的区分有牙）', async () => {
    const seed = G5_T5_SEED;
    const { pair, host, guest } = await makePair(seed);
    const { ep, a } = actorOf(host, guest, 0);
    const other = ep === host ? guest : host;

    const notTurn = other.driver.submit(other.s, a);
    (ep === host ? pair.A : pair.B).deactivate();
    const offline = ep.driver.submit(ep.s, a);
    ep.driver.dispose();
    const afterDispose = ep.driver.submit(ep.s, a);

    expect(notTurn.refusal).toBe('not-the-next-action');
    expect(offline.refusal).toBe('offline');
    expect(afterDispose.refusal).toBe('read-only');
    expect(new Set([notTurn.refusal, offline.refusal, afterDispose.refusal]).size, '三个码必须互不相同').toBe(3);
  });

  it('序号错位的入站 act 不被应用、不留静默：记诊断并挡住本端提交', async () => {
    const seed = G5_T5_SEED;
    const { host } = await makePair(seed);
    const seen: string[] = [];
    host.driver.onFailure((f) => seen.push(f.reason));
    host.driver.arm(host.s);
    const applied0 = host.driver.appliedSteps();
    // 喂一条"第 7 条"的 act（本端远没走到那里）
    host.driver.feedText(JSON.stringify({ t: 'act', seq: 7, action: { seq: 7, player: 1, kind: 'advance' } }));
    expect(seen, '错位必须留下诊断').toContain('seq-mismatch');
    expect(host.driver.lastFailure()?.reason).toBe('seq-mismatch');
    expect(host.driver.appliedSteps(), '错位的帧不许推进步数').toBe(applied0);
    // 而且它必须**继续挡着**本端提交（顺序还没到本端）—— 这一点正是"不许静默错位"的牙
    const blocked = host.driver.submit(host.s, { player: host.driver.seat, kind: 'advance' });
    expect(blocked.ok).toBe(false);
    expect(blocked.refusal, '队列里有错位的帧时本端不许抢先提交').toBe('not-the-next-action');
  });

  it('解不出来的帧记 undecodable 诊断，不抛、不改状态', async () => {
    const seed = G5_T5_SEED;
    const { host } = await makePair(seed);
    host.driver.arm(host.s);
    const before = stateFingerprint(host.s);
    const seen: string[] = [];
    host.driver.onFailure((f) => seen.push(`${f.reason}:${f.message}`));
    expect(() => host.driver.feedText('{"t":"act"')).not.toThrow();
    expect(seen.some((x) => x.startsWith('undecodable:')), '截断帧必须留下 undecodable').toBe(true);
    expect(stateFingerprint(host.s), '坏帧不许改状态').toBe(before);
  });

  it('非 act 的入站消息（beat 心跳等）静默放行：不改状态、不记诊断', async () => {
    const seed = G5_T5_SEED;
    const { host } = await makePair(seed);
    host.driver.arm(host.s);
    const before = stateFingerprint(host.s);
    host.driver.feedText(JSON.stringify({ t: 'bye', reason: 'paused' }));
    expect(stateFingerprint(host.s)).toBe(before);
    expect(host.driver.lastFailure(), 'bye 不是坏帧，不该留诊断').toBeNull();
  });
});

/* ------------------------------------------------------------------ *
 * 判据 3：从机没有自己的映射（**文本腿**）
 * ------------------------------------------------------------------ */

/** 被扫目录：`src/net/**`（本任务新增的驱动也在这个目录里） */
const NET_DIR = fileURLToPath(new URL('../../src/net/', import.meta.url));

function netSources(): { path: string; code: string }[] {
  const out: { path: string; code: string }[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (p.endsWith('.ts')) out.push({ path: p, code: stripComments(readFileSync(p).subarray(0, 4 * 1024 * 1024).toString('utf8')) });
    }
  };
  walk(NET_DIR);
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

describe('判据 3：从机没有自己的映射（文本腿，只扫 src/net）', () => {
  it('`src/net/**` 里 `executeAction(` 与 `resetControlIfHeld` 零命中', () => {
    const files = netSources();
    // 下界自证：路径写错会扫到 0 个文件，那样"零命中"恒真（计划 §2 第 13 条）
    expect(files.length, 'src/net 至少要扫到 5 个文件（T1-T5 的交付）').toBeGreaterThanOrEqual(5);
    for (const f of files) {
      expect(f.code.includes('executeAction('), `${f.path} 不许出现引擎调用 executeAction(`).toBe(false);
      expect(f.code.includes('resetControlIfHeld'), `${f.path} 不许出现 resetControlIfHeld`).toBe(false);
    }
  });

  it('`applyRecordedAction` 是 `src/net/**` 里引擎状态的唯一入口（相对 import 只许指向 match-replay）', () => {
    const files = netSources();
    const importers = files.filter((f) => f.code.includes('applyRecordedAction'));
    // 反空转：今天**恰好一个**文件（net-driver.ts）。多一个就说明有第二份映射在长出来
    expect(importers.map((f) => f.path.split(/[\\/]/).pop()), 'applyRecordedAction 的消费方').toEqual(['net-driver.ts']);
    // 它必须来自 match-replay 这一个模块（不是"某个同名函数"）
    const src = importers[0].code;
    expect(/from\s+'\.\.\/app\/match-replay'/.test(src), 'applyRecordedAction 必须 import 自 ../app/match-replay').toBe(true);
  });

  it('文本腿自己能红：把禁项写进合成样本，同一个判定必须命中', () => {
    // 这条腿是给上面两条腿的"能红"证明：**同一条判定**（`includes`）喂进被禁的字面量必须命中。
    // 没有它，上面两条可能因为"匹配串写错了"而恒绿（本仓的"0 tests look green"同族）。
    const sample = 'export function f(s) { executeAction(s, 0, "advance"); resetControlIfHeld(s, 0); }';
    expect(sample.includes('executeAction(')).toBe(true);
    expect(sample.includes('resetControlIfHeld')).toBe(true);
  });
});

/* ------------------------------------------------------------------ *
 * 边界腿：入站队列深度（T5 修复轮按评审 §5.2 的接口缺口补的只读读数）
 * ------------------------------------------------------------------ */

describe('入站队列的只读读数 pendingCount()（T6 落地上限要用它）', () => {
  /**
   * 这条腿造一个**"帧到了、但驱动手里还没有状态"**的场面 —— 那正是队列真正会攒起来的时刻
   * （G4 D2：驱动不持有 `GameState`，所以 `onMessage` 推到的那一刻可能还没有状态可应用）。
   *
   * 做法：建 B 时注入一个 `onMessage`（驱动会**同步**把它的订阅回调交给我们，
   * 见 `net-driver.ts`：`const onMessage = opts.onMessage ?? …; const unsubscribe = onMessage(cb)`），
   * 于是"帧什么时候到达本端"由这条腿精确控制。**先**把 A 真实产出的帧喂进去、**后**才 `arm(sB)`
   * ⇒ 中间那段队列深度必须是 N、步数必须是 0。反过来（先 `arm` 再喂）会走驱动的"到达即落地"
   * 那一半，队列当场被排空 —— 这条腿把这个区别也钉住。
   */
  it('喂 N 条不 drain ⇒ 读数是 N；arm 之后 ⇒ 0 且对端落地', async () => {
    const seed = G5_T5_SEED;
    const pair = createFakeTransportPair();
    await pair.A.transport.init({ selfId: 'A', peerId: 'B' });
    await pair.B.transport.init({ selfId: 'B', peerId: 'A' });
    const sA = opening(seed);
    const sB = opening(seed);
    let deliverToB: ((text: string, channel: NetChannel) => void) | null = null;
    let subscribeCount = 0;
    const dA = createNetDriver({ transport: pair.A.transport, seat: 0, recorder: null });
    const dB = createNetDriver({
      transport: pair.B.transport,
      seat: 1,
      recorder: null,
      onMessage: (cb) => {
        subscribeCount += 1;
        deliverToB = cb;
        return () => {};
      },
    });
    expect(deliverToB, '订阅回调必须被同步交给注入的 onMessage').not.toBeNull();
    expect(subscribeCount, '驱动只订阅一次').toBe(1);
    dA.arm(sA);
    // ⚠️ 故意**先不** `arm(sB)`：这样入站的帧只能进队列（没有状态可应用）
    expect(dB.pendingCount(), '一开始队列是空的').toBe(0);

    // A 连走三步，每一步都把它**那条线上真实产出的帧**交给 B 的订阅回调
    let fed = 0;
    for (let step = 0; step < 8 && fed < 3; step += 1) {
      const a = nextAction(sA, step);
      if (a === null || a.player !== 0) break;
      const before = pair.steps().length;
      expect(dA.submit(sA, a).ok, `第 ${step} 步（A）必须成功`).toBe(true);
      pair.pump(ACT_LATENCY_TICKS);
      const produced = pair.steps().slice(before).filter((x) => x.from === 'A');
      expect(produced.length, `第 ${step} 步必须真的产出一帧（否则"攒队列"的前提不成立）`).toBeGreaterThan(0);
      for (const frame of produced) {
        (deliverToB as unknown as (text: string, channel: NetChannel) => void)(frame.text, frame.channel);
        fed += 1;
      }
    }
    expect(fed, '夹具前提：要真的喂进 3 帧').toBe(3);
    expect(dB.pendingCount(), `喂了 ${fed} 帧、一次都没排空 ⇒ 读数就是 ${fed}`).toBe(fed);
    expect(dB.appliedSteps(), '入队不等于落地').toBe(0);
    expect(stateFingerprint(sB), 'B 的状态这时还没动').toBe(stateFingerprint(opening(seed)));

    // `arm` 是排空的正规口：排空之后读数归零、对端真的落地
    dB.arm(sB);
    expect(dB.pendingCount(), 'arm 之后队列必须空').toBe(0);
    expect(dB.appliedSteps(), 'arm 必须让对端落地').toBe(fed);
    expect(stateFingerprint(sB), '落地之后两端指纹必须相等').toBe(stateFingerprint(sA));

    // 只读读数不许有副作用：连读三次结果一样，状态也不动
    const fp = stateFingerprint(sB);
    expect([dB.pendingCount(), dB.pendingCount(), dB.pendingCount()], '读 pendingCount 不许消费/改状态').toEqual([0, 0, 0]);
    expect(stateFingerprint(sB)).toBe(fp);
    dA.dispose();
    dB.dispose();
  });

  /**
   * 另一半：**已经有状态**时到达的帧会走"到达即落地" ⇒ 队列**不会**攒起来。
   *
   * 这条不是重复：它证明 `pendingCount()` 读到 0 的两种情形**不是同一件事**
   * （"队列空" vs "帧还没来"），也证明"帧到了就落"这条生产路径在注入 `onMessage` 时同样成立。
   */
  it('已经有状态时到达的帧走"到达即落地"：队列不攒、步数当场前进', async () => {
    const seed = G5_T5_SEED;
    const pair = createFakeTransportPair();
    await pair.A.transport.init({ selfId: 'A', peerId: 'B' });
    await pair.B.transport.init({ selfId: 'B', peerId: 'A' });
    const sA = opening(seed);
    const sB = opening(seed);
    let deliverToB: ((text: string, channel: NetChannel) => void) | null = null;
    const dA = createNetDriver({ transport: pair.A.transport, seat: 0, recorder: null });
    const dB = createNetDriver({
      transport: pair.B.transport,
      seat: 1,
      recorder: null,
      onMessage: (cb) => {
        deliverToB = cb;
        return () => {};
      },
    });
    dA.arm(sA);
    dB.arm(sB); // ★ 先给状态

    const a = nextAction(sA, 0);
    expect(a, '第 0 步必须有操作').not.toBeNull();
    const before = pair.steps().length;
    expect(dA.submit(sA, a as Omit<ActionRecord, 'seq'>).ok).toBe(true);
    pair.pump(ACT_LATENCY_TICKS);
    const produced = pair.steps().slice(before).filter((x) => x.from === 'A');
    expect(produced.length).toBeGreaterThan(0);
    (deliverToB as unknown as (text: string, channel: NetChannel) => void)(produced[0].text, produced[0].channel);

    expect(dB.pendingCount(), '有状态时到达 ⇒ 当场排空，队列不攒').toBe(0);
    expect(dB.appliedSteps(), '有状态时到达 ⇒ 语义当场落地').toBe(1);
    expect(stateFingerprint(sB), '两端指纹必须相等').toBe(stateFingerprint(sA));
    dA.dispose();
    dB.dispose();
  });
});

/* ------------------------------------------------------------------ *
 * 判据 4：dispose()
 * ------------------------------------------------------------------ */

describe('判据 4：dispose() 之后通道关闭、submit ⇒ read-only（**不是** offline）', () => {
  it('dispose() 调用了 transport.close()：本端状态变 closed，后续 submit 一律 read-only', async () => {
    const seed = G5_T5_SEED;
    const { pair, host, guest } = await makePair(seed);
    host.driver.arm(host.s);
    guest.driver.arm(guest.s);
    const { ep, a } = actorOf(host, guest, 0);
    const peer = ep === host ? guest : host;
    expect(ep.driver.submit(ep.s, a).ok).toBe(true);
    arrive(pair, peer);
    const before = stateFingerprint(host.s);

    host.driver.dispose();
    // `dispose` 是同步契约，`close()` 是异步的 ⇒ 等一个微任务再读状态
    await Promise.resolve();
    expect(pair.A.transport.status(), 'dispose 必须把通道关掉').toBe('closed');

    const r1 = host.driver.submit(host.s, a);
    expect(r1.ok).toBe(false);
    expect(r1.refusal, 'dispose 之后的码是 read-only，不是 offline').toBe('read-only');
    // 幂等：再 dispose 不抛
    expect(() => host.driver.dispose()).not.toThrow();
    const r2 = host.driver.submit(host.s, a);
    expect(r2.refusal).toBe('read-only');
    expect(stateFingerprint(host.s), 'dispose 之后 submit 不许改状态').toBe(before);
    expect(host.driver.recorder(), 'dispose 之后记录器口关闭').toBeNull();
  });

  it('dispose() 之后入站帧不再被应用（退订生效）', async () => {
    const seed = G5_T5_SEED;
    const { pair, host, guest } = await makePair(seed);
    host.driver.arm(host.s);
    guest.driver.arm(guest.s);
    // 走到"轮到 guest"的那一步（第 0 步是 host 的：见 G5_T5_SEED 的注释）
    let step = 0;
    while (step < 8) {
      const { ep, a } = actorOf(host, guest, step);
      if (ep === guest) break;
      const peer = ep === host ? guest : host;
      expect(host.driver.submit(host.s, a).ok, `第 ${step} 步（host）必须成功`).toBe(true);
      arrive(pair, peer);
      step += 1;
    }
    const target = actorOf(host, guest, step);
    expect(target.ep, '这一步必须轮到 guest（否则夹具前提不成立）').toBe(guest);
    host.driver.dispose();
    await Promise.resolve();
    expect(guest.driver.submit(guest.s, target.a).ok, 'guest 的这一步必须成功').toBe(true);
    const before = stateFingerprint(host.s);
    // 只剩"让帧到达"这一半：host 已退订，所以**不能**再调 `arm(host.s)`（那才可能改状态）
    pair.pump(ACT_LATENCY_TICKS);
    expect(stateFingerprint(host.s), 'dispose 之后不许再应用对端的操作').toBe(before);
  });
});

/* ------------------------------------------------------------------ *
 * 判据 5：acceptsInput 的四种组合
 * ------------------------------------------------------------------ */

describe('判据 5：acceptsInput() 的四种组合（轮到自己 / 不是自己 × 在线 / 离线）', () => {
  it('四种组合逐个出现（两两组合全试一遍）', async () => {
    const seed = G5_T5_SEED;
    const { pair, host, guest } = await makePair(seed);

    // 两端各把状态交给驱动（`arm`）：否则 `acceptsInput()` 不知道轮到谁。
    host.driver.arm(host.s);
    guest.driver.arm(guest.s);

    const first = nextAction(host.s, 0);
    expect(first, '开局第一步必须有一个行动方').not.toBeNull();
    const whoseTurn = (first as Omit<ActionRecord, 'seq'>).player;
    const mine = whoseTurn === 0 ? host : guest;
    const theirs = whoseTurn === 0 ? guest : host;
    expect(mine.driver.appliedSteps(), '递状态不许推进步数').toBe(0);
    expect(theirs.driver.appliedSteps()).toBe(0);

    // 组合 1：轮到自己 + 在线 ⇒ true
    expect(mine.driver.acceptsInput(), '轮到自己 + 在线 ⇒ true').toBe(true);
    // 组合 2：不是自己 + 在线 ⇒ false
    expect(theirs.driver.acceptsInput(), '不是自己 + 在线 ⇒ false').toBe(false);
    // 组合 3：轮到自己 + 离线 ⇒ false
    (mine === host ? pair.A : pair.B).deactivate();
    expect(mine.driver.transport.status()).toBe('offline');
    expect(mine.driver.acceptsInput(), '轮到自己 + 离线 ⇒ false').toBe(false);
    // 组合 4：不是自己 + 离线 ⇒ false（另一端也被 deactivate 一起转成 offline）
    expect(mine.driver.acceptsInput(), '组合 4 的前置：本端确实离线').toBe(false);
    expect(theirs.driver.acceptsInput(), '不是自己 + 离线 ⇒ false').toBe(false);
  });

  it('`mode` 是 net、`seat` 是本端座位（契约字段不是摆设）', async () => {
    const { host, guest } = await makePair(G5_T5_SEED);
    expect(host.driver.mode).toBe('net');
    expect(NET_DRIVER_MODE).toBe('net');
    expect(host.driver.seat).toBe(0);
    expect(guest.driver.seat).toBe(1);
  });

  it('链路状态变化会转给宿主（UI 要靠它重算 acceptsInput），退订与 dispose 都生效', async () => {
    const seed = G5_T5_SEED;
    const { pair, host } = await makePair(seed);
    host.driver.arm(host.s);
    const seen: string[] = [];
    const off = host.driver.onStatus((c) => seen.push(`${c.from}->${c.to}`));
    pair.A.deactivate();
    expect(seen, '掉线必须转给宿主').toContain('online->offline');
    const n = seen.length;
    off();
    pair.A.activate();
    expect(seen.length, '退订之后不许再收到').toBe(n);
    // 重新订阅之后 dispose：订阅者也不许再被通知
    const seen2: string[] = [];
    host.driver.onStatus((c) => seen2.push(`${c.from}->${c.to}`));
    host.driver.dispose();
    await Promise.resolve();
    pair.B.deactivate();
    expect(seen2, 'dispose 之后不许再转状态').toEqual([]);
  });

  it('宿主一次状态都没递过时 acceptsInput 为假（不许凭 seat 猜"轮到我"）', async () => {
    const solo = createFakeTransportPair();
    await solo.A.transport.init({ selfId: 'A', peerId: 'B' });
    const d = createNetDriver({ transport: solo.A.transport, seat: 0, recorder: null });
    expect(d.acceptsInput(), '没有状态就不知道轮到谁，只能为假').toBe(false);
    d.dispose();
  });
});
