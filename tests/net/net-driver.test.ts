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
 * （序号错位 / 解不出来 / 非 `act` 放行）、链路状态转发与退订。全文 18 条腿。
 *
 * ## 60 步差分腿的具体形状（判据 1）
 *
 *  - 两端**各自**从 `createGame({ seed })` + 同一套草稿策略起跑（**不是**一方把状态复制给另一方）；
 *  - 每一步都用**本端当前状态**上的确定性策略算"下一条该谁动、动什么"，再调那一端的 `submit`；
 *  - `pump(ACT_LATENCY_TICKS)` 推进 fake 传输（缺省延迟 1 ⇒ 第 0 步发出的帧到第 2 步才交付，
 *    见 `ACT_LATENCY_TICKS` 的注释：这里第一次写的就是 `pump(1)`，当场踩红）；
 *  - **每一步之后**用 `stateFingerprint`（`src/core/fingerprint.ts:50`，全仓唯一的状态指纹出处）
 *    取两端指纹并断言相等 —— 60 次比对，不是只在最后比一次。
 *
 * 指纹来自 `src/core/fingerprint.ts` 的 `stateFingerprint`，**不自己拼**（判据 1 的原文）。
 *
 * ## 为什么"每一维都要有非平凡的动作"
 *
 * 60 步里若全是 `advance`，那"两端相等"证明的东西很薄。所以断言里有反空转：步数恰为 60、
 * 两个座位都动过、操作种类 ≥ 4、以及 60 步的指纹取值数 > 30（不然"60 次比较"比的是同一个值）。
 *
 * **4 这个数不是拍的**：本文件用同一条策略普查了 8 个种子（`.superpowers/g5-T5/` 的探索件），
 * 每一个都恰好给出 4 种 —— `advance` / `play` / `effect-choice` 三种必有，第四种在
 * `resolve-trigger` 与 `refresh`（`g5-t5-theta` 是 `compile`）之间随种子变。
 * ⇒ 阈值写 5 会变成"必须换到某个特定种子才绿"，那是在测种子而不是测驱动。
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
import { createMatchFileRecorder, setupFromState } from '../../src/app/match-file';
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
 * 本文件统一用的种子。**选它的理由是实测出来的**（`.superpowers/g5-T5/` 的探索件，
 * 6 个候选种子里只有它同时满足下面几条；换种子必须重测并重写这里的数字）：
 *  - 60 步走得完（没有在第 60 步之前终局）；
 *  - 两个座位**都**有操作（30 : 30）；
 *  - 操作种类 ≥ 5（`advance` / `play` / `compile` / `effect-choice` …），
 *    这样判据 1 的"每步指纹相等"才不是"60 次 advance 相等"；
 *  - 开局第一步的行动方是 **P0**（host）—— 判据 2 的"让另一端提交"因此有一个确定的对象。
 */
const G5_T5_SEED = 'g5-t5-gamma';

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

describe('判据 1（★）：两端接 fake 传输，确定性走 60 步，每一步之后两端指纹相等', () => {
  it('60 步 / 每一步都比对 stateFingerprint / 非平凡（两个座位 + 至少 4 种 kind）', async () => {
    const seed = G5_T5_SEED;
    const { pair, host, guest } = await makePair(seed);

    // 起跑点必须一致（否则后面的"每一步都相等"从一开始就是假的）
    expect(stateFingerprint(host.s), '两端起跑指纹必须相同').toBe(stateFingerprint(guest.s));

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

    // 反空转：步数、座位、操作种类都要真的出现过，否则"指纹相等"很容易因为"什么都没发生"而恒真
    expect(host.driver.appliedSteps(), '走完的步数').toBe(60);
    expect(guest.driver.appliedSteps(), '两端已应用步数必须相同').toBe(60);
    expect([...players].sort(), '两个座位都必须动过').toEqual([0, 1]);
    expect(kinds.size, `操作种类太少（实际 ${[...kinds].sort().join('/')}）`).toBeGreaterThanOrEqual(4);
    // 指纹不许退化成常数（那会让上一条断言变成"60 次比较同一个值"）
    expect(new Set(fingerprints).size, '60 步的指纹不该只有少数几个值').toBeGreaterThan(30);
    // 终局的最后一步之后仍然相等（循环里已经比过，这里再钉一次"事后"）
    expect(stateFingerprint(host.s)).toBe(stateFingerprint(guest.s));
  });

  it('主机的记录器里是完整的 60 条（两端记录同一条序列），从机可以是 null', async () => {
    const seed = G5_T5_SEED;
    const { pair, host, guest } = await makePair(seed);
    expect(host.recorder, '主机必须有记录器').not.toBeNull();
    expect(guest.driver.recorder(), '从机可以是 null').toBeNull();
    for (let step = 0; step < 60; step += 1) {
      const { ep, a } = actorOf(host, guest, step);
      const peer = ep === host ? guest : host;
      expect(ep.driver.submit(ep.s, a).ok).toBe(true);
      arrive(pair, peer);
    }
    const actions = host.recorder!.actions();
    expect(actions.length, '主机记录器里的条数').toBe(60);
    // `seq` 必须是 0..59 且严格递增 —— 记录器的编号是它自己的事（本驱动不覆盖它）
    expect(actions.map((x) => x.seq)).toEqual([...Array(60).keys()]);
    // 记录器里的序列必须真的来自两个座位（不是"只有本端"）
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
