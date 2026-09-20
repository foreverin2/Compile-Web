/**
 * G5 **T14** 判据：**"入站帧 → 落地"必须有一个公开的、可被宿主调用的口**（`pump`）。
 *
 * ## 这条腿钉的是什么（本轮实测的拦路，链是一条）
 *
 *  `src/net/net-driver.ts` 的入站回调是：
 *    `enqueue(text)`（帧先入队）→ `if (lastKnownState !== null) drain(lastKnownState)`。
 *  当**帧到得比第一次 `arm` 早**（传输 `online` 与"握手读数齐了"不是同一刻）时，
 *  `lastKnownState === null` ⇒ **只入队、不落地**。而驱动**按设计不持有 `GameState`**
 *  （G4 D2），公开面当时也只有 `submit(s, a)` 会顺手 `drain(s)`。
 *
 *  这一格的后果（真浏览器里量到的）：宿主收到帧后只重画 ⇒ 画的是**还没含这一帧**的状态；
 *  之后某次 `submit` 顺手把帧落地、状态前进，而**那一步被拒就早退、不再重画**
 *  ⇒ 症状是"**状态进了、屏停在上一手**"。
 *
 * ## 三条腿
 *
 *  1. **正腿**：入站一帧后 `pendingCount() === 1` 而 `appliedSteps()` 不变（帧**没**落地）；
 *     调 `pump(state)` 之后 `appliedSteps()` +1、宿主状态与对端逐字一致；
 *  2. **反空转**：不调 `pump` 就**永远不落地**（把它删掉这条腿必须红 ⇒ 证明这个口是必需的）；
 *  3. **负控**：没有待落地帧时 `pump` 返回 0、不改状态、不报错（也不写失败记录）。
 *
 * ⚠️ 它**不**写进 `tests/net/net-driver.test.ts`（那份是本阶段不许动的既有文件）——
 * 与本目录既有的 `net-link-dead.test.ts` 同一做法。
 */
import { describe, expect, it } from 'vitest';
import { createNetDriver } from '../../src/net/net-driver';
import { createFakeTransportPair } from '../../src/net/fake-transport';
import { createGame } from '../../src/core/state/create';
import { stableStringify } from '../../src/core/fingerprint';
import { applyRecordedAction } from '../../src/app/match-replay';
import { DRAFT_PICK_KIND } from '../../src/app/match-file';
import type { GameState } from '../../src/core/models/types';

const SEED = 'g5-t14-pump';

function stateOf(): GameState {
  return createGame({ seed: SEED });
}

/**
 * 一条 `draft-pick` 的投递：**发送方直接构造线格式的 `act` 文本**（不经第二个驱动）。
 *
 * 为什么这样造：本腿要的是"**一条已经到达本端、还没落地的帧**"这个状态，
 * 而用两个驱动对打会把"谁在什么时候 drain"搅在一起。`feedText` 的头注明写它就是
 * "与 `transport.onMessage` 的回调同一条路"，测试可以直接喂坏帧/单帧。
 */
function actText(defId: string, player: 0 | 1, seq: number): string {
  return JSON.stringify({ t: 'act', seq, action: { player, kind: DRAFT_PICK_KIND, args: { defId }, seq } });
}

/** 对端（权威）那一份：把同一条操作应用进自己的状态 */
function peerStateAfter(defId: string, player: 0 | 1, base: GameState): GameState {
  const s = createGame({ seed: SEED });
  applyRecordedAction(s, { player, kind: DRAFT_PICK_KIND as 'draft-pick', args: { defId }, seq: 0 });
  void base;
  return s;
}

describe('★★ G5 T14：入站帧的落地口 `pump(s)`', () => {
  it('① 帧到了但没落地（`pendingCount` 1 / `appliedSteps` 不变）；`pump(state)` 之后落地且与对端逐字一致', async () => {
    const pair = createFakeTransportPair();
    await pair.A.transport.init({ selfId: 'A', peerId: 'B' });
    const driver = createNetDriver({ transport: pair.A.transport, seat: 0 });
    const s = stateOf();
    /**
     * ⚠️ **刻意不 `arm(s)`**：`arm` 会顺手 `drain`，那就造不出"帧到了但没落地"这一格 ——
     * 而这一格正是本轮拦路的形状（帧到得比第一次 `arm` 早）。
     */
    const defId = 'flexibility';

    driver.feedText(actText(defId, 0, 0));
    // 反空转：这一步必须真的"只入队不落地"，否则下面 pump 那条腿什么都没证
    expect(driver.pendingCount(), '帧没有被排队 ⇒ 这条腿的夹具不成立').toBe(1);
    expect(driver.appliedSteps(), '帧没有 arm 就落地了 ⇒ "pump 是必需的"这句话变了，请复核').toBe(0);

    const landed = driver.pump(s);
    expect(landed, '`pump(s)` 说它落地了 0 条').toBe(1);
    expect(driver.appliedSteps(), 'pump 之后 `appliedSteps` 没有 +1').toBe(1);
    expect(driver.pendingCount(), 'pump 之后队列里还压着帧').toBe(0);
    expect(driver.lastFailure(), 'pump 留下了失败记录').toBeNull();
    // 与对端（权威）逐字一致
    expect(stableStringify(s), '落地之后本端状态与对端不一致')
      .toBe(stableStringify(peerStateAfter(defId, 0, s)));
  });

  it('② 反空转：**不调 `pump` 就永远不落地**（把 `pump` 删掉这条腿必须红）', async () => {
    const pair = createFakeTransportPair();
    await pair.A.transport.init({ selfId: 'A', peerId: 'B' });
    const driver = createNetDriver({ transport: pair.A.transport, seat: 0 });
    const s = stateOf();
    const before = stableStringify(s);

    driver.feedText(actText('flexibility', 0, 0));
    // 等一会儿、再读一次：**没有任何别的口会落地它**（`submit` 也会，但那要轮到自己并提交）
    for (let i = 0; i < 3; i += 1) {
      expect(driver.appliedSteps(), `第 ${i + 1} 次读：没人调 pump，帧却落地了`).toBe(0);
      expect(stableStringify(s), `第 ${i + 1} 次读：没人调 pump，宿主状态却变了`).toBe(before);
    }
    expect(driver.pendingCount(), '没人调 pump，队列却空了').toBe(1);
    // 现在调它 ⇒ 立刻落地（证明"红"与"绿"只差这一句）
    expect(driver.pump(s)).toBe(1);
    expect(driver.appliedSteps()).toBe(1);
    expect(stableStringify(s)).not.toBe(before);
  });

  it('③ 负控：没有待落地帧时 `pump` 返回 0、状态一字不动、不报错、不写失败记录', async () => {
    const pair = createFakeTransportPair();
    await pair.A.transport.init({ selfId: 'A', peerId: 'B' });
    const driver = createNetDriver({ transport: pair.A.transport, seat: 0 });
    const s = stateOf();
    const before = stableStringify(s);

    expect(driver.pump(s), '空队列上 pump 说落地了东西').toBe(0);
    expect(stableStringify(s), '空队列上 pump 改了状态').toBe(before);
    expect(driver.appliedSteps(), '空队列上 pump 动了 appliedSteps').toBe(0);
    expect(driver.pendingCount(), '空队列上 pump 动了队列').toBe(0);
    expect(driver.lastFailure(), '空队列上 pump 写了失败记录').toBeNull();

    // `dispose()` 之后是 no-op（与 `arm` 同一条纪律）
    driver.dispose();
    expect(driver.pump(s), 'dispose 之后 pump 还在落地').toBe(0);
    expect(stableStringify(s), 'dispose 之后 pump 改了状态').toBe(before);
  });
});
