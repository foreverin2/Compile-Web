/**
 * G6 T45 判据 4 的**两端腿**（用户 2026-09-27 ⑧："用了指令之后两端不同步"）：
 * 联机对局里**会改状态的开发者指令一律拒绝**，拒绝之后两端的 `stableStringify(state)`
 * **逐字相同**（T11-C 那套跨端规范串口径，与 `__g5Match.state()` 同一份实现）。
 *
 * ## "两端"是真的两端（2026-09-27 评审整改）
 *
 * 上一版把两个 `createNetDriver(...).arm(state)` 的返回值一丢就断言"两端相等" —— 那证不了
 * 跨端同步：两端都是同一个 blueprint 的克隆、全程不 step 不 flush，它们相等只是因为**开局同源**。
 * 现在每一格都先过一轮**真帧**：房主 `submit()` 一条**合法**动作 ⇒ `pair.pump()` 把帧送到点
 * ⇒ 对端 `driver.arm()` 落地 ⇒ 断言**对端真的跟着变了一步**（`!==` 开局串）。
 * 对端是"活着的、收帧的"之后，"拒绝之后两端仍逐字相同"才算一个有内容的读数。
 *
 * ## 这一条证明什么、不证明什么（如实标注）
 *
 *  - **证明**：被拒指令**一个字节都没改本端状态**（含 `state.log`），所以两端不会因它分叉；
 *    负控证明"不拒"会当场分叉。全部读数是 `stableStringify(state)` 的字符数与逐字比较。
 *  - **不证明**：用户在**真浏览器**里敲指令 / 点检索行时屏上有没有那句话、真 WebRTC 两端
 *    会不会真的分叉。那一半在真机读数里：`.superpowers/g6-T45/rowgate-cdp.mjs`（真 Chrome +
 *    真 `initDevMode` + `isNetMatch: () => true`，覆盖回车与两条检索行）与 `next-btn-cdp.mjs`。
 *
 * 网络栈用的是生产 `createNetDriver` + `createFakeTransportPair`（与
 * `tests/net/net-cross-side-choice.test.ts` 同一套夹具）。
 */
import { describe, it, expect } from 'vitest';
import { createNetDriver } from '../../src/net/net-driver';
import { createFakeTransportPair } from '../../src/net/fake-transport';
import { createGame } from '../../src/core/state/create';
import { stableStringify } from '../../src/core/fingerprint';
import { NET_STATE_REFUSAL, runCommand, type DevModeHost } from '../../src/ui/devmode';
import type { GameState, PlayerId } from '../../src/core/models/types';
import { makeCard } from '../helpers';

/** 与夹具同口径：默认 `latencyTicks=1` ⇒ 一帧在 `tick + 2` 到点 */
const ACT_LATENCY_TICKS = 2;

const cloneOf = (s: GameState): GameState => JSON.parse(JSON.stringify(s)) as GameState;

/** 蓝图：turn 阶段、P1 行动、双方各 2 张手牌（手牌用 `makeCard` **只造一次** ⇒ 两端 uid 逐字相同） */
function blueprint(): GameState {
  const s = createGame({ seed: 'g6t45-net-sync' });
  for (const p of [0, 1] as PlayerId[]) {
    s.players[p].protocols = [
      { defId: 'fire', compiled: false },
      { defId: 'light', compiled: false },
      { defId: 'darkness', compiled: false },
    ];
    s.players[p].hand = [makeCard('fire-1', p, 'hand', true, null), makeCard('light-2', p, 'hand', true, null)];
    s.players[p].stacks = [[], [], []];
  }
  s.phase = 'turn';
  s.turnPlayer = 0;
  s.step = 'action';
  s.pendingEffects.length = 0;
  s.pendingPlay.length = 0;
  s.pendingShift.length = 0;
  s.winner = null;
  return s;
}

interface End {
  driver: ReturnType<typeof createNetDriver>;
  s: GameState;
}

async function makePair(): Promise<{
  pair: ReturnType<typeof createFakeTransportPair>;
  host: End;
  guest: End;
}> {
  const pair = createFakeTransportPair();
  await pair.A.transport.init({ selfId: 'A', peerId: 'B' });
  await pair.B.transport.init({ selfId: 'B', peerId: 'A' });
  const bp = blueprint();
  const host: End = {
    driver: createNetDriver({ transport: pair.A.transport, seat: 0, recorder: null }),
    s: cloneOf(bp),
  };
  const guest: End = {
    driver: createNetDriver({ transport: pair.B.transport, seat: 1, recorder: null }),
    s: cloneOf(bp),
  };
  host.driver.arm(host.s);
  guest.driver.arm(guest.s);
  return { pair, host, guest };
}

/** 让对端把线上那几帧真的落地（生产上走的就是 `pump` 送达 + 宿主 `arm` 递状态） */
function arrive(pair: ReturnType<typeof createFakeTransportPair>, receiver: End): void {
  pair.pump(ACT_LATENCY_TICKS);
  receiver.driver.arm(receiver.s);
}

const devHost = (s: GameState, net: boolean): DevModeHost => ({
  getState: () => s, render: () => { /* noop */ }, isNetMatch: () => net,
});

/**
 * 先把这一对端证成"活的"：房主过驱动提交一条**合法**动作（反面打一张手牌），
 * 对端收到帧并落地 ⇒ 对端真的动了，而且两端逐字相同。返回这一轮之后的规范串。
 */
function proveLivePair(pair: ReturnType<typeof createFakeTransportPair>, host: End, guest: End): string {
  const opened = stableStringify(host.s);
  const sub = host.driver.submit(host.s, {
    player: 0,
    kind: 'play',
    args: { cardUid: host.s.players[0].hand[0].uid, faceUp: false, line: 0 },
  });
  expect(sub.ok, `夹具失败：房主这条合法动作被驱动拒了（refusal=${String(sub.refusal)}）`).toBe(true);
  const afterHost = stableStringify(host.s);
  expect(afterHost, '夹具失败：房主提交之后本端没变（那这一格证不了帧）').not.toBe(opened);

  arrive(pair, guest);
  const afterGuest = stableStringify(guest.s);
  expect(afterGuest, '对端没有跟着走一步 ⇒ 这一对"两端"是摆设，后面"两端相等"就没内容').not.toBe(opened);
  expect(afterGuest, '对端落地之后两端规范串必须逐字相同').toBe(afterHost);
  return afterHost;
}

describe('G6 T45 ⑧ · 联机对局里开发者指令改状态 ⇒ 两端不同步（两端规范化串读数）', () => {
  it('闸门在：真过了一轮帧的两端，`get light-2` 被拒后规范串仍逐字相同', async () => {
    const { pair, host, guest } = await makePair();
    const canon = proveLivePair(pair, host, guest);
    console.log(`[G6T45] 帧往返之后：两端规范串各 ${canon.length} 字符，逐字相同=true`);

    const notice = runCommand(devHost(host.s, true), 'get light-2');
    expect(notice, '联机里这条指令必须被拒').toBe(NET_STATE_REFUSAL);

    const afterHost = stableStringify(host.s);
    expect(afterHost.length, '本端规范串长度变了（说明状态真被改了）').toBe(canon.length);
    expect(afterHost, '本端规范串必须一个字节都没变').toBe(canon);
    expect(stableStringify(guest.s), `拒绝之后两端规范串必须仍然逐字相同（各 ${afterHost.length} 字符）`).toBe(afterHost);
    expect(afterHost.length, '规范串长度是个真读数（不许是 0）').toBeGreaterThan(1000);
  });

  it('负控（去掉闸门 = "干脆别管了"）：同一条 `get light-2` 让两端当场不等', async () => {
    const { pair, host, guest } = await makePair();
    const canon = proveLivePair(pair, host, guest);
    expect(canon).toBe(stableStringify(guest.s));

    const notice = runCommand(devHost(host.s, false), 'get light-2'); // 非联机形态 ⇒ 照旧执行
    expect(notice, '非联机形态下这条指令是正常路径（不拒）').toBe(null);

    const handBefore = guest.s.players[0].hand.length; // 对端没被碰过 ⇒ 就是本端加牌前的张数
    expect(host.s.players[0].hand.length, `本端手牌真的多了一张（${handBefore} → ${host.s.players[0].hand.length}）`)
      .toBe(handBefore + 1);
    const afterHost = stableStringify(host.s);
    const afterGuest = stableStringify(guest.s);
    expect(afterHost, '本端规范串应当已经变了（否则负控没跑起来）').not.toBe(canon);
    expect(afterHost, `去掉闸门之后两端规范串当场不等（本端 ${afterHost.length} 字符 / 对端 ${afterGuest.length} 字符）`)
      .not.toBe(afterGuest);
    expect(afterHost.length, '本端比原来长（多了一张牌的 JSON）').toBeGreaterThan(canon.length);
    console.log(`[G6T45] 负控（无闸门）：本端 ${afterHost.length} 字符 / 对端 ${afterGuest.length} 字符，`
      + `逐字相同=${afterHost === afterGuest}（帧往返后两端都是 ${canon.length} 字符）`);
  });

  it('联机里 `/skip` 也被拒（不进 state.log）：两端规范串同样逐字相同', async () => {
    const { pair, host, guest } = await makePair();
    const canon = proveLivePair(pair, host, guest);
    const logLen = host.s.log.length;
    const notice = runCommand(devHost(host.s, true), '/skip');
    expect(notice).toBe(NET_STATE_REFUSAL);
    expect(host.s.log.length, '联机下 state.log 一格都不许动（它在跨端规范串里）').toBe(logLen);
    expect(host.s.step, '`/skip` 一步都没推进（帧往返之后停在 check-cache）').toBe('check-cache');
    expect(stableStringify(host.s)).toBe(canon);
    expect(stableStringify(guest.s)).toBe(canon);
  });
});
