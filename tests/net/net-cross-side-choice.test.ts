/**
 * **交叉应答：一条效果里"先我选、再你选"（双方各自自主弃牌）在联机下能不能走通**
 *
 * ## 这条腿回答的是用户 2026-09-21 的那个问题
 *
 * 用户问："如果一些卡牌效果在触发时会依次触发双方各自的自主选择弃牌，能保证它正常运行吗？"
 * 最干净的例子是 **疫2 / `plague-2`**（`src/core/effects/cards/plague.ts:42-58`）：
 *  - 第一段 `plague-2：弃1张或更多张牌` —— 应答者是**效果属主**（`chooser` 缺省 = `top.player`）；
 *  - 第二段 `plague-2：对手弃N张牌` —— 应答者是**对手**（`chooser: opp`）。
 * 两段是**前后两个 prompt**，中间隔着一次真的状态迁移（自己那批 `discardMany` 已经落地）。
 *
 * ## 为什么这件事值得单独一条腿
 *
 * 联机是锁步 + "驱动不持有状态"（G4 D2）：**能提交的人不等于当前回合玩家**。这条路上有三处
 * 必须同时对：
 *  1. `NetDriver.submit` 的座位闸（`a.player !== seat` 一律拒）—— 防的是"从机替主机走一步"；
 *  2. `NetDriver` 的 `liveTurn` **第三条**（`net-driver.ts:742-753`）—— 有挂起 prompt 时，
 *     `prompt.chooser ?? top.player` 那个人也算"现在能动"；少了它，双方会**同时**拒掉这条合法
 *     应答 ⇒ 谁都不动 ⇒ 一个不报错的**死锁**（差分腿就停在那儿）；
 *  3. `main.ts` 交上去的 `player` 必须是**实际 chooser**（`main.ts:3740-3749`），不是 `turnPlayer`；
 *     记录进档案的 `player` 也是它（重放闸门逐项比对 `kind`+`args`+`player`）。
 * 外加渲染层那条（T23 修的）：选择条 / 候选装饰只许出现在 **chooser 那一屏**。
 *
 * ## 每一条断言各证什么（别把"两端相等"当成全部）
 *
 *  - **第一段**：属主（座位 0，同时也是回合玩家）应答 ⇒ `ok`；两端指纹相等；
 *  - **第二段**：`prompt.chooser === 1`、候选是**对手**手里的牌；**由座位 1 应答** ⇒ `ok`；
 *    两端指纹相等、挂起清空、对手手牌真的少了两张（不是"两端一起没动"）；
 *  - **负控（两条）**：座位 0 冒用 `player: 1` 提交 ⇒ 座位闸拒；座位 0 用**自己**的号去答
 *    "该由 1 答"的那一格 ⇒ 引擎拒（`ok:false`），且**指纹一字不动、prompt 仍在**（不许静默顶替）；
 *  - **渲染腿**：两段 prompt 都用**引擎真产出**的状态跑 `renderNetBoard`，`.choice-bar` 只在
 *    chooser 那一屏出现（这一段把 T23 的座位规则接到"真实交叉 prompt"上，而不是合成形状）。
 *
 * ## 能力边界
 *
 * 没有真浏览器（桩 DOM 的 `addEventListener` 是 noop）；也没有"真人两边各点一次"的端到端 ——
 * 那一条登记在计划 §9（`effect-choice` 过网的整条回合仍未验）。
 */
import { describe, it, expect, afterEach } from 'vitest';
import { createNetDriver } from '../../src/net/net-driver';
import { createFakeTransportPair } from '../../src/net/fake-transport';
import { createGame } from '../../src/core/state/create';
import { resolveMiddle } from '../../src/core/effects/resolve';
import { stateFingerprint } from '../../src/core/fingerprint';
import { renderNetBoard } from '../../src/ui/render-net';
import { setChoiceSelection, setHandSelection } from '../../src/ui/render';
import { setFxViewSeat } from '../../src/ui/fx-seat';
import { makeCard } from '../helpers';
import { descendants, installStubDom, isClass, makeStubEl, queryAllIn, type StubNode } from '../ui/net-dom-stub';
import type { ChoiceRequest, GameState, PlayerId } from '../../src/core/models/types';

const ACT_LATENCY_TICKS = 2;

afterEach(() => {
  setChoiceSelection([], null);
  setHandSelection(null);
  setFxViewSeat(null);
});

/**
 * 蓝图：轮到 P0、双方各有 3 张手牌、P0 的 0 号线顶上摆着 `plague-2`（**还没有**跑中指令）。
 *
 * 手牌用 `makeCard` 发（它按模块级计数器发 uid）⇒ 蓝图只建**一次**，两端各拿一份 JSON 副本，
 * 这样 uid 逐字相同（否则两端状态从一开始就不一样，后面的"指纹相等"会变成假红）。
 */
function blueprint(): GameState {
  const s = createGame({ seed: 't23-cross-side' });
  for (const p of [0, 1] as PlayerId[]) {
    s.players[p].protocols = [
      { defId: 'fire', compiled: false },
      { defId: 'light', compiled: false },
      { defId: 'darkness', compiled: false },
    ];
    s.players[p].hand = [
      makeCard('fire-1', p, 'hand', true, null),
      makeCard('water-1', p, 'hand', true, null),
      makeCard('ice-1', p, 'hand', true, null),
    ];
  }
  // ★ `plague-2` 也必须**在蓝图里**造（它的 uid 也来自同一个模块级计数器）——
  //   在副本上各造一张会让两端从第一帧起就不同（首跑就是这样红的：
  //   `夹具失败：两端开局指纹就不一样`）。这里造一次，`resolveMiddle` 时从手牌里取那一张。
  s.players[0].hand.push(makeCard('plague-2', 0, 'hand', true, null));
  s.phase = 'turn';
  s.turnPlayer = 0;
  s.pendingEffects.length = 0;
  s.pendingPlay.length = 0;
  s.pendingShift.length = 0;
  s.winner = null;
  return s;
}

const cloneOf = (s: GameState): GameState => JSON.parse(JSON.stringify(s)) as GameState;

/** 在一个副本上把**蓝图里那一张** `plague-2` 从手牌挪到 0 号线顶，并跑它的中指令 ⇒ 挂着第一段 prompt。 */
function withPlague2(s: GameState): GameState {
  const hand = s.players[0].hand;
  const i = hand.findIndex((c) => c.defId === 'plague-2');
  if (i < 0) throw new Error('夹具失败：蓝图的手牌里没有 plague-2');
  const [c] = hand.splice(i, 1);
  c.line = 0;
  c.zone = 'field';
  c.pos = s.players[0].stacks[0].length;
  s.players[0].stacks[0].push(c);
  resolveMiddle(s, 0, c);
  return s;
}

const topPrompt = (s: GameState): ChoiceRequest => {
  const top = s.pendingEffects[s.pendingEffects.length - 1];
  if (!top?.prompt) throw new Error('夹具失败：状态上没有挂起的 prompt');
  return top.prompt;
};

const promptIdOf = (s: GameState): string => {
  const top = s.pendingEffects[s.pendingEffects.length - 1];
  if (!top) throw new Error('夹具失败：没有挂起效果');
  return top.id;
};

/** 造一对已经握好手的锁步驱动（与 `tests/net/net-driver.test.ts` 的 `makePair` 同形，只留必要部分）。 */
async function makePair(): Promise<{
  pair: ReturnType<typeof createFakeTransportPair>;
  host: { driver: ReturnType<typeof createNetDriver>; s: GameState };
  guest: { driver: ReturnType<typeof createNetDriver>; s: GameState };
}> {
  const pair = createFakeTransportPair();
  await pair.A.transport.init({ selfId: 'A', peerId: 'B' });
  await pair.B.transport.init({ selfId: 'B', peerId: 'A' });
  const bp = blueprint();
  const hostS = withPlague2(cloneOf(bp));
  const guestS = withPlague2(cloneOf(bp));
  const host = { driver: createNetDriver({ transport: pair.A.transport, seat: 0, recorder: null }), s: hostS };
  const guest = { driver: createNetDriver({ transport: pair.B.transport, seat: 1, recorder: null }), s: guestS };
  host.driver.arm(hostS);
  guest.driver.arm(guestS);
  return { pair, host, guest };
}

/** 让对端把上一帧落地（生产上该走的那条路：`pump` 送达 + 宿主 `arm` 递状态）。 */
function arrive(pair: ReturnType<typeof createFakeTransportPair>, receiver: { driver: ReturnType<typeof createNetDriver>; s: GameState }): void {
  pair.pump(ACT_LATENCY_TICKS);
  receiver.driver.arm(receiver.s);
}

/** 真跑一帧远程页（桩 DOM）。 */
function renderFrame(s: GameState, viewSeat: PlayerId): StubNode {
  const root = makeStubEl('div');
  const noop = (): void => { /* noop */ };
  renderNetBoard(root as unknown as HTMLElement, s, {
    onAction: noop, onRendered: noop, rerender: noop, onDraftPick: noop, onDraftUnpick: noop,
    onDraftBan: noop, onWinReset: noop,
  } as never, { viewSeat });
  return root;
}

const countOf = (root: StubNode, sel: string): number => queryAllIn(root, sel).length;

/** 一屏的 `.choice-bar` 上的操作者标题（`P1 操作 — …`），读不到就是 null。 */
function barTitle(root: StubNode): string | null {
  const el = descendants(root).find((n) => isClass(n, 'choice-title'));
  return el ? el.text : null;
}

describe('G5 T23 · 交叉应答：疫2（先我选、再你选）在联机锁步里能走通', () => {
  it('第一段由属主（座位 0）应答 ⇒ ok；两端指纹相等，第二段换到座位 1 且候选是对手手里的牌', async () => {
    const { pair, host, guest } = await makePair();
    // 夹具前提：两端同源
    expect(stateFingerprint(host.s), '夹具失败：两端开局指纹就不一样').toBe(stateFingerprint(guest.s));

    // ── 第一段 ──
    const p1 = topPrompt(host.s);
    expect(p1.title, '第一段不是"属主自己弃牌"那一句').toBe('plague-2：弃1张或更多张牌');
    expect(p1.chooser, '第一段不该有显式 chooser（应答者 = 效果属主 P0）').toBeUndefined();
    expect(p1.candidates.map((c) => c.uid), '第一段的候选不是 P0 的手牌')
      .toEqual(host.s.players[0].hand.map((c) => c.uid));

    const ownPick = host.s.players[0].hand[0].uid;
    const r1 = host.driver.submit(host.s, {
      player: 0, kind: 'effect-choice', args: { promptId: promptIdOf(host.s), choice: [ownPick] },
    });
    expect(r1.ok, `属主应答自己那一格被拒了（refusal=${String(r1.refusal)}）`).toBe(true);
    arrive(pair, guest);
    expect(stateFingerprint(host.s), '第一段之后两端指纹不同（对端没落地）').toBe(stateFingerprint(guest.s));
    expect(host.s.players[0].hand.length, 'P0 那张牌没真的弃掉').toBe(2);

    // ── 第二段：应答者换成座位 1，候选是 P1 自己的手牌 ──
    const p2 = topPrompt(guest.s);
    expect(p2.title, `第二段标题不是"对手弃N张牌"（实际：${p2.title}）`).toBe('plague-2：对手弃2张牌');
    expect(p2.chooser, '第二段没有把应答权交给对手（chooser 不是 1）').toBe(1);
    expect(p2.candidates.map((c) => c.uid), '第二段的候选不是 P1 的手牌')
      .toEqual(guest.s.players[1].hand.map((c) => c.uid));
    // 两端都要看到同一段 prompt（锁步：状态是同一份）
    expect(topPrompt(host.s).title, '两端看到的 prompt 不是同一段').toBe(p2.title);
  });

  it('第二段由座位 1 应答 ⇒ ok；两端指纹相等、挂起清空、对手手牌真的少两张（不是"都没动"）', async () => {
    const { pair, host, guest } = await makePair();
    // 先走第一段
    host.driver.submit(host.s, {
      player: 0, kind: 'effect-choice', args: { promptId: promptIdOf(host.s), choice: [host.s.players[0].hand[0].uid] },
    });
    arrive(pair, guest);
    const handBefore = guest.s.players[1].hand.length;
    expect(handBefore, '夹具失败：P1 手里没有牌可弃').toBeGreaterThanOrEqual(2);

    // 第二段：**由被指定的那一方（座位 1）答**，答案从它自己的状态里取
    const p2 = topPrompt(guest.s);
    const r2 = guest.driver.submit(guest.s, {
      player: 1, kind: 'effect-choice', args: { promptId: promptIdOf(guest.s), choice: p2.candidates.slice(0, p2.max).map((c) => c.uid) },
    });
    expect(r2.ok, `对手（非回合玩家）应答被拒了（refusal=${String(r2.refusal)}）—— 这正是死锁那一格`).toBe(true);
    arrive(pair, host);
    expect(host.s.players[1].hand.length, 'P1 的手牌没有真的少掉').toBe(handBefore - p2.max);
    expect(stateFingerprint(host.s), '第二段之后两端指纹不同').toBe(stateFingerprint(guest.s));
    expect(host.s.pendingEffects.length, '两段都答完之后还挂着效果').toBe(0);
    expect(guest.s.pendingEffects.length, '两段都答完之后还挂着效果（对端）').toBe(0);
  });

  it('负控 A：座位 0 冒用 `player: 1` 提交 ⇒ 座位闸拒（不许从机替主机/替对手走一步）', async () => {
    const { host } = await makePair();
    host.driver.submit(host.s, {
      player: 0, kind: 'effect-choice', args: { promptId: promptIdOf(host.s), choice: [host.s.players[0].hand[0].uid] },
    });
    const before = stateFingerprint(host.s);
    const p2 = topPrompt(host.s);
    const bad = host.driver.submit(host.s, {
      player: 1, kind: 'effect-choice', args: { promptId: promptIdOf(host.s), choice: p2.candidates.slice(0, p2.max).map((c) => c.uid) },
    });
    expect(bad.ok, '座位 0 冒用座位 1 的号提交却被放行了').toBe(false);
    expect(bad.refusal, '拒绝码不是 not-the-next-action').toBe('not-the-next-action');
    expect(stateFingerprint(host.s), '被拒的提交却改了状态').toBe(before);
  });

  it('负控 B：座位 0 用自己的号去答"该由 1 答"的那一格 ⇒ 引擎拒，指纹一字不动、prompt 仍在', async () => {
    const { pair, host, guest } = await makePair();
    host.driver.submit(host.s, {
      player: 0, kind: 'effect-choice', args: { promptId: promptIdOf(host.s), choice: [host.s.players[0].hand[0].uid] },
    });
    arrive(pair, guest);
    const before = stateFingerprint(host.s);
    const p2 = topPrompt(host.s);
    expect(p2.chooser, '夹具前提：第二段该由 1 答').toBe(1);
    const wrong = host.driver.submit(host.s, {
      player: 0, kind: 'effect-choice', args: { promptId: promptIdOf(host.s), choice: p2.candidates.slice(0, p2.max).map((c) => c.uid) },
    });
    expect(wrong.ok, '"该由对手答"的那一格被回合玩家答掉了').toBe(false);
    expect(wrong.refusal, '拒绝码不是 not-the-next-action').toBe('not-the-next-action');
    expect(stateFingerprint(host.s), '被拒的"顶替应答"改了状态').toBe(before);
    expect(topPrompt(host.s).title, '被拒之后 prompt 不见了（被静默消费？）').toBe(p2.title);
  });

  it('渲染腿：两段 prompt 各自只把选择条画在 **chooser 那一屏**（引擎真产出的状态，不是合成形状）', async () => {
    const restore = installStubDom();
    try {
      const { pair, host, guest } = await makePair();
      // 第一段：chooser = 0（属主）
      for (const seat of [0, 1] as PlayerId[]) {
        const root = renderFrame(seat === 0 ? host.s : guest.s, seat);
        expect(countOf(root, '.choice-bar'), `第一段（该由 0 答）在座位 ${seat} 的屏上画了选择条`).toBe(seat === 0 ? 1 : 0);
        if (seat === 0) expect(barTitle(root), '第一段标题不对').toContain('P1 操作');
      }
      // 走到第二段（chooser = 1）
      host.driver.submit(host.s, {
        player: 0, kind: 'effect-choice', args: { promptId: promptIdOf(host.s), choice: [host.s.players[0].hand[0].uid] },
      });
      // 两端各自的本地状态（锁步里它们是同一份；这里为了渲染腿把提交方那一帧也补上）
      arrive(pair, guest);
      for (const seat of [0, 1] as PlayerId[]) {
        const root = renderFrame(seat === 0 ? host.s : guest.s, seat);
        expect(countOf(root, '.choice-bar'), `第二段（该由 1 答）在座位 ${seat} 的屏上画了选择条`).toBe(seat === 1 ? 1 : 0);
        if (seat === 1) expect(barTitle(root), '第二段标题不对').toContain('P2 操作');
      }
    } finally {
      restore();
    }
  });
});
