/**
 * G5 T11-C · **握手链路交出去 ⇒ 两端开同一局**（任务书 §6）。
 *
 * ## 这个文件补的是哪一段（以及为什么放在这一层）
 *
 * T11-B 的腿停在"两块硬币屏上的读数逐字相同"（`net-lobby-coin-consensus.test.ts`）。
 * T11-C 要的是**那一组数真的变成两局同一局**：`handoff()` 交出的
 * `{ transport, seat, role, seed, draftStarter }` 各自正确、两端算出**同一个**
 * `draftStarter`/`draftMode`/`draftPool`（★ G5 T21 起 `draftPool` 是**不传** ⇒ 两端都取默认
 * 全量池；见 `stateOf()` 的说明），于是两端的 `stateFingerprint` 逐步相等。
 *
 * `src/main.ts` 是应用入口，node 里 import 不了（见 `tests/ui/main-lobby-wiring.test.ts` 头注）
 * ⇒ 这里能证的是"**产出代码里那条算式**"（`LobbyClient.handoff()` + `src/app/coin.ts` 的规则
 * + `createGame` 的选项），证不了"真浏览器里屏幕真的切过去了"（那由
 * `tools/browser-truth-lobby-cdp.mjs` 判据 5/6/7 覆盖）。
 *
 * ## 夹具（与 T11-B 修复轮同一套：真客户端 + 真会话 + 成对假传输）
 *
 * 传输是 `src/net/fake-transport.ts` 的成对假件（两端各一条、按 channel 对接），
 * 会话是 `src/net/session.ts` 的真对象，握手帧真的从一端走到另一端 ⇒
 * "两端状态相等"不可能是各自本地造出来的结论。
 */
import { describe, it, expect } from 'vitest';
import { createLobbyClient, type LobbyClient, type LobbyTicker } from '../../src/ui/net-lobby';
import { createFakeTransportPair } from '../../src/net/fake-transport';
import { PROTO_VERSION, type NetMsg } from '../../src/net/protocol';
import { browserHashOf } from '../../src/ui/net-browser';
import { CARD_DATA_HASH } from '../../src/app/card-data-hash';
import type { NetTransport } from '../../src/net/transport';
import type { PlayerId } from '../../src/core/models/types';
import { coinLanding, type CoinSide } from '../../src/app/coin';
import { createGame, randomPoolFromSeed, performDraftPick, getDraftPool } from '../../src/core/state/create';
import { stateFingerprint } from '../../src/core/fingerprint';
import { createNetDriver } from '../../src/net/net-driver';

/* ------------------------------------------------------------------ *
 * 夹具
 * ------------------------------------------------------------------ */

function fakeTicker(): LobbyTicker {
  return { schedule: (): number => 1, cancel: (): void => { /* 本文件用不到 8 秒窗口 */ } };
}

function tokenQueue(...values: readonly string[]): () => string {
  let i = 0;
  return () => {
    const v = values[Math.min(i, values.length - 1)];
    i += 1;
    return v ?? '';
  };
}

interface Rig {
  readonly pair: ReturnType<typeof createFakeTransportPair>;
  readonly host: LobbyClient;
  readonly guest: LobbyClient;
  readonly hostTr: NetTransport;
  readonly guestTr: NetTransport;
  connect(): Promise<void>;
  run(rounds: number): Promise<void>;
}

/**
 * 两个真客户端接在一对假传输上。
 *
 * ⚠️ `matchSeed` 由测试注入（产出代码里它是 `newMatchSeed()`）—— 这一条正是 T11-A 的接口：
 * 种子不再从 `sessionId` 派生，所以"两端同一个种子"这件事是**注入的**、不是碰巧的。
 */
function makeRig(chooseFace: () => Promise<CoinSide>, matchSeed: string): Rig {
  const pair = createFakeTransportPair();
  const tokens = tokenQueue('SALT-FIX', 'NONCE-FIX');
  const mk = (role: 'host' | 'guest', tr: NetTransport): LobbyClient => createLobbyClient({
    role,
    sessionId: 'sid-handoff-shared',
    matchSeed,
    randomToken: tokens,
    chooseFace,
    localProtoVersion: PROTO_VERSION,
    localCardDataHash: CARD_DATA_HASH,
    hash: browserHashOf,
    ticker: fakeTicker(),
    createTransport: () => tr,
    signalingEndpoint: '',
    readSettings: () => ({ turnUrl: '', turnUsername: '', turnCredential: '' }),
    buildInvite: async () => ({ ok: true as const, payload: 'P', link: 'https://x.invalid/l#invite=P' }),
    decompressBase64: async () => null,
    readAddressBar: () => null,
    localNick: () => 'nick',
  });
  const host = mk('host', pair.A.transport);
  const guest = mk('guest', pair.B.transport);
  return {
    pair,
    host,
    guest,
    hostTr: pair.A.transport,
    guestTr: pair.B.transport,
    async connect(): Promise<void> {
      await host.connect('first');
      await guest.connect('first');
    },
    async run(rounds: number): Promise<void> {
      for (let i = 0; i < rounds; i += 1) {
        pair.pump(3);
        host.drive();
        guest.drive();
        // 微任务：`chooseFace` 是 Promise（`askFaceOnce()` 的反应是微任务）
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
      }
    },
  };
}

/** 握手走到"两端都 complete"（`handoff().ready`）所需要的最小轮数；不够就返 false 而不是抛 */
async function runUntilReady(rig: Rig, rounds: number): Promise<boolean> {
  for (let i = 0; i < rounds; i += 1) {
    await rig.run(1);
    if (rig.host.handoff().ready && rig.guest.handoff().ready) return true;
  }
  return false;
}

/** 两端各自按 `handoff()` 开一局（**逐字复刻 `main.ts` 的 `enterNetGame()` 那几行**） */
function openMatch(rig: Rig): { hs: ReturnType<LobbyClient['handoff']>; gs: ReturnType<LobbyClient['handoff']> } {
  const hs = rig.host.handoff();
  const gs = rig.guest.handoff();
  return { hs, gs };
}

/**
 * ★★ **G5 T21：联机这条**不传** `draftPool`**（用户真机反馈 1：联机草稿只给了 12 套协议）。
 *
 * 与热座默认一致 —— `createGame` 落回 `opts.draftPool ?? [...DEMO_PROTOCOLS]`
 * （`src/core/state/create.ts:77`）。所以两端拿到的是**同一份常量协议全集**，
 * 一致性的理由从"同一粒种子派生同一个随机池"换成"同一份常量"（判据没变）。
 */
function stateOf(h: ReturnType<LobbyClient['handoff']>, seat: PlayerId) {
  void seat;
  return createGame({
    seed: h.seed!,
    draftStarter: h.draftStarter!,
    firstToPlay: (1 - h.draftStarter!) as PlayerId,
    draftMode: 'normal',
    draftPool: undefined,
  });
}

/**
 * 把草稿走完（每一步选"当前可选池里第一个还没被选的"）。
 *
 * 为什么驱动那两条腿要先走完草稿：`createNetDriver.submit` 只认**对局相**的动作
 * （`net-driver.ts:664` 的 `liveTurn` 第一条就是 `s.phase !== 'turn'` ⇒ 草稿期一律
 * `'not-the-next-action'`）—— 这是既有的、正确的口径，不是本段的缺口。
 */
function finishDraft(s: ReturnType<typeof stateOf>): void {
  while (s.phase === 'draft') {
    const avail = getDraftPool(s);
    performDraftPick(s, avail[0].defId);
  }
}

/* ------------------------------------------------------------------ *
 * 1. `handoff()` 的那一组数（判据 1 的 node 面）
 * ------------------------------------------------------------------ */

describe('G5 T11-C · `handoff()` 交出的一组数', () => {
  /**
   * ★★ **两条种子 × 两种叫面**（照 T11-B 修复轮的教训：只用一条种子时"叫中/叫错"
   * 只有一种情形 ⇒ "两端算出同一个先选者"这条会在另一半上假绿）。
   */
  const seeds = ['hs-1', 'hs-2', 'hs-3', 'hs-4'];
  const landings = seeds.map((s) => coinLanding(s));

  it('夹具覆盖两种落点（反空转：否则"叫中/叫错"只有一种情形）', () => {
    expect([1, 2].every((x) => landings.includes(x as CoinSide)),
      `这组种子只给出落点 ${JSON.stringify(landings)}`).toBe(true);
  });

  for (const seed of seeds) {
    for (const side of [1, 2] as const) {
      it(`种子 ${seed} / 加入方叫 ${side}：两端 ready、同一个 seed 与 draftStarter，且座位口径相反`, async () => {
        const rig = makeRig(() => Promise.resolve(side), seed);
        await rig.connect();
        const ready = await runUntilReady(rig, 12);
        expect(ready, `两端没有都到 ready（房主 ${rig.host.handoff().phase} / 加入方 ${rig.guest.handoff().phase}）`).toBe(true);
        const h = rig.host.handoff();
        const g = rig.guest.handoff();

        // ① 四样齐 + 那一组数（任务书 §6 的接口要求）
        expect(h.transport, '房主没交出传输').not.toBeNull();
        expect(g.transport, '加入方没交出传输').not.toBeNull();
        expect(h.seed, '房主那一侧没有种子').toBe(seed);
        expect(g.seed, '加入方那一侧没有种子').toBe(seed);
        expect(h.draftStarter, '两端算出的 draftStarter 不同').toBe(g.draftStarter);
        expect(h.phase, '房主不在 complete 就交链路了').toBe('complete');
        expect(g.phase, '加入方不在 complete 就交链路了').toBe('complete');
        // ② 两端各自的座位**必须相反**（同一个数就说明有一端读错了座位）
        expect(h.seat, '房主读到的本端座位不是 0').toBe(0);
        expect(g.seat, '加入方读到的本端座位不是 1').toBe(1);
        // ③ 叫面者座位两端同一个数（= 加入方的座位 = 1）
        expect(h.caller, '房主读到的叫面者座位').toBe(1);
        expect(g.caller, '加入方读到的叫面者座位').toBe(1);
        // ④ 叫出去的面与落点两端同值
        expect(h.chosen, `房主读到的"对端叫的面"与加入方叫的 ${side} 不同`).toBe(g.chosen);
        expect(g.chosen, '加入方叫的面不是注入的那一面').toBe(side);
        expect(h.landed, '两端落点不同').toBe(g.landed);
        expect(g.landed, '落点不等于 coinLanding(seed)').toBe(coinLanding(seed));
        // ⑤ 反空转：叫中 ⇒ 1（加入方先选）、叫错 ⇒ 0（房主先选）
        expect(h.draftStarter, `落点 ${coinLanding(seed)} / 叫 ${side}：先选者的取值不对`)
          .toBe(coinLanding(seed) === side ? 1 : 0);
      });
    }
  }

  it('握手没走完时 `ready` 是 false 且不交传输（不假装能开局）', async () => {
    const rig = makeRig(() => Promise.resolve(1), 'hs-not-yet');
    await rig.connect();
    const early = rig.host.handoff();
    expect(early.ready, '刚接上就 ready 了（那会在硬币屏之前开局）').toBe(false);
    expect(early.transport, '没 ready 却已经把传输交出去了').toBeNull();
    expect(early.seed, '没 ready 却已经有种子了').toBeNull();
    expect(early.draftStarter, '没 ready 却已经算出 draftStarter 了').toBeNull();
  });
});

/* ------------------------------------------------------------------ *
 * 2. 两端开同一局（判据 1/3 的 node 面：`draftMode` / `draftPool` 逐字一致）
 * ------------------------------------------------------------------ */

describe('G5 T11-C · 两端开同一局（同一 seed / draftStarter ⇒ 同一状态）', () => {
  it('★ 同一 seed + 同一 draftStarter ⇒ 两端 createGame 的选项逐字一致、指纹相等', async () => {
    const rig = makeRig(() => Promise.resolve(1), 'hs-samegame');
    await rig.connect();
    expect(await runUntilReady(rig, 12), '两端没有都到 ready').toBe(true);
    const { hs, gs } = openMatch(rig);
    const hostState = stateOf(hs, hs.seat);
    const guestState = stateOf(gs, gs.seat);
    expect(stateFingerprint(hostState), '两端刚进草稿时的指纹不同').toBe(stateFingerprint(guestState));
    // 选项逐字一致（这两样是本段新定的：协议里没有传设置的消息）
    expect(hostState.draftMode, 'draftMode 两端不同').toBe(guestState.draftMode);
    expect(hostState.draftStarter, 'draftStarter 两端不同').toBe(guestState.draftStarter);
    expect(hostState.firstToPlay, 'firstToPlay 两端不同（必须是 1 - draftStarter）').toBe(guestState.firstToPlay);
    expect(hostState.firstToPlay, 'firstToPlay 不是 1 - draftStarter').toBe(1 - hostState.draftStarter);
    expect(
      hostState.draftPool.map((p) => p.defId).join(','),
      'draftPool 两端不同（同一个种子必须派生出同一个池）',
    ).toBe(guestState.draftPool.map((p) => p.defId).join(','));
    /**
     * ★★ **G5 T21 同步（语义变化：联机这一条不再传 12 套随机池）**。
     *
     * 原来这一条钉的是"池子不是**因为两边都用默认值**而恰好相同"（反空转），做法是断言
     * `draftPool.length === 12`。T21 把联机的池改成与热座默认一致的**全部协议** ⇒ 那个
     * 反空转做法本身失效（"等于默认值"现在正是要求）。换成一条**同样有牙、但不假定池大小**的腿：
     * 两端各自的池必须逐字等于"本机默认池"（`createGame({ seed })` 的 `draftPool`），
     * 且它与"同种子派生的 12 套随机池"**不同** —— 后半个断言正是反空转：如果哪天有人把联机
     * 又改回 12 套随机池，这条会红（那 12 套必然是真子集）。
     */
    const defaultPool = createGame({ seed: hs.seed! }).draftPool.map((p) => p.defId).join(',');
    expect(hostState.draftPool.map((p) => p.defId).join(','), '房主的池不是默认全量池').toBe(defaultPool);
    expect(guestState.draftPool.map((p) => p.defId).join(','), '加入方的池不是默认全量池').toBe(defaultPool);
    expect(defaultPool, '默认池与随机池恰好同长同序 —— 这条反空转失去判别力')
      .not.toBe(randomPoolFromSeed(hs.seed!, 12).map((p) => p.defId).join(','));
    /**
     * ★★ **G5 T21 的两把实测尺子**（`getDraftPool` = 开局那一刻的整池，草稿还没起始 ⇒ 未过滤）。
     *
     * 读的三个数：联机这条（不传池）与热座默认（同样不传池）**必须相等**；T21 之前那条
     * `randomPoolFromSeed(seed, 12)` **必须不同**（不然这条腿分不出修没修）。数字由
     * `console.log` 落盘（报告里引的就是它）。
     */
    const netLen = getDraftPool(hostState).length;
    const hotseatLen = getDraftPool(createGame({ seed: hs.seed! })).length;
    const oldNetLen = getDraftPool(createGame({ seed: hs.seed!, draftPool: randomPoolFromSeed(hs.seed!, 12) })).length;
    console.log(`[G5-T21 实测] 联机开局 getDraftPool=${netLen} / 热座默认=${hotseatLen} / 旧联机(12 套随机池)=${oldNetLen}`);
    expect(netLen, `联机开局池 ${netLen} 与热座默认 ${hotseatLen} 不等（本轮缺陷 1 没修好）`).toBe(hotseatLen);
    expect(oldNetLen, '旧那条 12 套随机池与全量池同长 —— 这条腿分不出修没修').not.toBe(netLen);
    expect(hostState.phase, '开出来的不是草稿相').toBe('draft');
  });

  it('★ 反空转：两个不同的种子给出**不同**的池（否则"池一致"这条恒真）', () => {
    const pools = ['hs-pool-1', 'hs-pool-2', 'hs-pool-3', 'hs-pool-4'].map(
      (s) => randomPoolFromSeed(s, 12).map((p) => p.defId).join(','),
    );
    expect(new Set(pools).size, `四个种子给出 ${new Set(pools).size} 种池（只有一种 ⇒ 池与种子无关）`)
      .toBeGreaterThan(1);
  });

  it('★ 两端各自完成整场草稿（1-2-2-1 顺序由 draftStarter 派生）⇒ 每一步指纹都相等', async () => {
    for (const side of [1, 2] as const) {
      const rig = makeRig(() => Promise.resolve(side), `hs-draft-${side}`);
      await rig.connect();
      expect(await runUntilReady(rig, 12), `side=${side}：两端没有都到 ready`).toBe(true);
      const { hs, gs } = openMatch(rig);
      const a = stateOf(hs, hs.seat);
      const b = stateOf(gs, gs.seat);
      expect(stateFingerprint(a)).toBe(stateFingerprint(b));
      // 逐次选池子里的第 n 个（顺序**不**来自两端各自的读数，而是同一个函数算的轮选者）
      for (let step = 0; step < 6; step += 1) {
        const defA = a.draftPool.filter((p) => !a.draftPicks.some((x) => x.defId === p.defId))[0].defId;
        const defB = b.draftPool.filter((p) => !b.draftPicks.some((x) => x.defId === p.defId))[0].defId;
        expect(defA, `第 ${step + 1} 步：两端算出的"下一个可选项"不同`).toBe(defB);
        performDraftPick(a, defA);
        performDraftPick(b, defB);
        expect(stateFingerprint(a), `第 ${step + 1} 步之后两端指纹不同`).toBe(stateFingerprint(b));
      }
      expect(a.phase, '六次选完没有进入对局相').toBe('turn');
      expect(a.turnPlayer, '先出牌者不是 firstToPlay').toBe(a.firstToPlay);
    }
  });
});

/* ------------------------------------------------------------------ *
 * 3. 驱动接线：对局动作走 `createNetDriver`（判据 2/3 的 node 面）
 * ------------------------------------------------------------------ */

describe('G5 T11-C · 换驱动（`createNetDriver` + `arm(state)`）之后仍然逐字同步', () => {
  it('★ 同一局 + 同一个驱动 ⇒ 一端提交、另一端 `arm` 之后指纹相等（走真传输、真 JSON 帧）', async () => {
    const rig = makeRig(() => Promise.resolve(1), 'hs-driver');
    await rig.connect();
    expect(await runUntilReady(rig, 12), '两端没有都到 ready').toBe(true);
    const hs = rig.host.handoff();
    const gs = rig.guest.handoff();
    const hostState = stateOf(hs, hs.seat);
    const guestState = stateOf(gs, gs.seat);
    const hostDriver = createNetDriver({ transport: hs.transport!, seat: hs.seat });
    const guestDriver = createNetDriver({ transport: gs.transport!, seat: gs.seat });
    /**
     * ★★ **座位腿**（评审 M2-seat 的落点）：驱动拿到的座位必须**就是** `handoff()` 交出来的
     * 那一个，而且**两端不同**（一端 0、一端 1）。
     *
     * 为什么要有它：座位只影响"谁该动"（`net-driver.ts` 的 `liveTurn`），而两端各自的
     * 400ms 自动推进会把状态推成一样 ⇒ 座位写错在**跨端比指纹**的腿上看不见
     * （评审实测：把 `seat` 取反，旧判据浏览器 33/33 全绿）。这里直接比那个数，
     * 与"驱动确实按它收输入"分开钉。
     */
    expect(hostDriver.seat, '房主驱动拿到的座位不是 handoff().seat').toBe(hs.seat);
    expect(guestDriver.seat, '加入方驱动拿到的座位不是 handoff().seat').toBe(gs.seat);
    expect(hs.seat, '两端的座位没有区分开（房主那一侧）').toBe(0);
    expect(gs.seat, '两端的座位没有区分开（加入方那一侧）').toBe(1);
    hostDriver.arm(hostState);
    guestDriver.arm(guestState);
    // 草稿走完（两端各自本地走 —— 草稿动作不在 `ActionKind` 里，见下面那条注释）
    finishDraft(hostState);
    finishDraft(guestState);
    expect(stateFingerprint(hostState), '两端草稿走完之后的指纹不同').toBe(stateFingerprint(guestState));

    /**
     * 提交一步对局动作（`advance`：无参数，把非行动步骤推进一格）。
     *
     * 为什么是 `advance` 而不是随手挑一个（实测踩过）：`clear-cache` 只在 `check-cache` 那一步
     * 合法，草稿刚结束时 `step === 'start'` ⇒ 引擎拒它（`clear-cache only at check-cache`），
     * 驱动如实报 `'not-the-next-action'` + `local-action-refused`。`advance` 在开局那几步
     * 一律合法（`executeAction` 的 advance 分支），是这一格唯一稳的选择。
     *
     * 提交方必须是**先出牌的那一位**（`s.turnPlayer`）—— `createNetDriver.submit` 只认
     * "轮到本端"（`liveTurn`）。
     *
     * 为什么用对局动作而不是"直接选协议"：草稿动作（`performDraftPick`）**不在驱动的
     * `ActionKind` 里**（`src/core/game.ts:22` 那张表只有对局动作）⇒ 它今天既进不了档案、
     * 也走不了锁步通道（**缺口，登记在报告里**）。所以"换驱动之后仍然同步"这条只能用
     * 对局动作来钉，而它是本段真正要证的那件事（草稿之后就是它）。
     */
    const hostIsNext = hostState.turnPlayer === hs.seat;
    const submitterDriver = hostIsNext ? hostDriver : guestDriver;
    const submitterState = hostIsNext ? hostState : guestState;
    const submitterSeat = hostIsNext ? hs.seat : gs.seat;
    /**
     * ★★ **座位腿的行为那一半**：**不是本端回合**的那一个驱动提交同一件事必须被拒。
     *
     * 为什么它不能被"两端指纹相等"替代（评审实测）：座位写错时两端**各自**的自动推进会把
     * 状态推成一样 ⇒ 比指纹看不见。而这里问的是"驱动有没有按座位把住闸门"：
     * 反方向那一个驱动拿着**同一个 `turnPlayer`** 去提交，必须拿到
     * `'not-the-next-action'`（它只认 `a.player === seat`，`net-driver.ts:718`）。
     */
    const wrongDriver = hostIsNext ? guestDriver : hostDriver;
    const wrongState = hostIsNext ? guestState : hostState;
    const wrongSeat = hostIsNext ? gs.seat : hs.seat;
    const wrongTry = wrongDriver.submit(wrongState, { player: wrongState.turnPlayer, kind: 'advance' });
    expect(
      wrongTry.ok,
      `座位不在本端的那个驱动竟然放行了（seat=${String(wrongSeat)}、turnPlayer=${String(wrongState.turnPlayer)}）`
      + ' —— 座位这条闸门没在工作',
    ).toBe(false);
    expect(wrongTry.refusal, '拒法不是「不是下一条该做的事」').toBe('not-the-next-action');
    // 反空转：正确那一个驱动提交**同一件事**必须放行（否则上面那条只是"谁都提交不了"）
    const r = submitterDriver.submit(submitterState, { player: submitterSeat, kind: 'advance' });
    expect(r.ok, `本端提交被拒：${String(r.refusal)}（turnPlayer=${String(submitterState.turnPlayer)} seat=${String(submitterSeat)}）`).toBe(true);
    // 两端都 arm 一遍（宿主在每次重画前 arm 的状态递进来 —— 这里模拟那两次）
    for (let i = 0; i < 6; i += 1) {
      rig.pair.pump(3);
      guestDriver.arm(guestState);
      hostDriver.arm(hostState);
      if (stateFingerprint(guestState) === stateFingerprint(hostState)) break;
    }
    expect(stateFingerprint(guestState), '对端没有把那条动作落地（两端分叉）').toBe(stateFingerprint(hostState));
    expect(hostDriver.appliedSteps(), '房主应用步数').toBe(1);
    expect(guestDriver.appliedSteps(), '加入方应用步数').toBe(1);
    expect(hostDriver.lastFailure(), '房主有失败').toBeNull();
    expect(guestDriver.lastFailure(), '加入方有失败').toBeNull();
  });

  it('★ 反空转：不给对端 `arm` ⇒ 那一帧烂在队列里（证明上一条不是"两端本来就相等"）', async () => {
    const rig = makeRig(() => Promise.resolve(1), 'hs-driver-arm');
    await rig.connect();
    expect(await runUntilReady(rig, 12), '两端没有都到 ready').toBe(true);
    const hs = rig.host.handoff();
    const gs = rig.guest.handoff();
    const hostState = stateOf(hs, hs.seat);
    const guestState = stateOf(gs, gs.seat);
    const hostDriver = createNetDriver({ transport: hs.transport!, seat: hs.seat });
    const guestDriver = createNetDriver({ transport: gs.transport!, seat: gs.seat });
    hostDriver.arm(hostState);
    finishDraft(hostState);
    finishDraft(guestState);
    const before = stateFingerprint(guestState);
    // 提交方永远是**房主**（这条腿只在看加入方的队列，不要把方向搞反）
    const hostIsNext = hostState.turnPlayer === hs.seat;
    const submitterDriver = hostIsNext ? hostDriver : guestDriver;
    const submitterState = hostIsNext ? hostState : guestState;
    const submitterSeat = hostIsNext ? hs.seat : gs.seat;
    const r = submitterDriver.submit(submitterState, { player: submitterSeat, kind: 'advance' });
    expect(r.ok, `本端提交被拒：${String(r.refusal)}`).toBe(true);
    rig.pair.pump(3);
    // 故意不 arm：帧应该**还压在队列里**（而不是被静默应用/丢弃）
    expect(guestDriver.pendingCount(), '对端没有 arm，帧却已经不在队列里了').toBe(1);
    expect(stateFingerprint(guestState), '对端没 arm 却已经落地了').toBe(before);
    // arm 之后就落地（同一条帧，不重发）
    guestDriver.arm(guestState);
    expect(guestDriver.pendingCount(), 'arm 之后队列没有排空').toBe(0);
    expect(stateFingerprint(guestState)).toBe(stateFingerprint(hostState));
  });
});

/* ------------------------------------------------------------------ *
 * 4. 线上真的有过那些帧（防"两端各自本地算出一个结论"）
 * ------------------------------------------------------------------ */

describe('G5 T11-C · 反空转：那一组数是线上走出来的', () => {
  it('★ 线上有 commit / commit-ack / commit-face / reveal-seed / reveal-face / reveal-salt 六条', async () => {
    const rig = makeRig(() => Promise.resolve(2), 'hs-wire');
    await rig.connect();
    expect(await runUntilReady(rig, 12), '两端没有都到 ready').toBe(true);
    const types: string[] = [];
    for (const s of rig.pair.steps()) {
      const m = JSON.parse(s.text) as NetMsg;
      types.push(m.t);
    }
    for (const t of ['hello', 'hello-ack', 'commit', 'commit-ack', 'commit-face', 'reveal-seed', 'reveal-face', 'reveal-salt']) {
      expect(types.includes(t), `线上没有 ${t}（那一组数是本地造出来的？）`).toBe(true);
    }
  });
});
