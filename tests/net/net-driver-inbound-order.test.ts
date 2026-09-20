/**
 * G5 **T14**：**入站订阅的先后顺序**——它决定了"立刻 pump"能不能落地。
 *
 * ## 这条腿钉的事实（真浏览器实测，`scenario-mouse.mjs`）
 *
 * 同一个 `transport.onMessage` 上有**两条订阅**，`fake-transport.ts` 的
 * `deliver()`（`:462-464`）按**注册顺序**逐个调（真 WebRTC 那条也一样，见
 * `src/ui/net-browser.ts:1389`）：
 *  1. **大厅链那条**（`src/ui/net-lobby.ts` 的 `opts.transport.onMessage`）——它调
 *     `opts.onInbound?.()`，也就是 `src/main.ts` 里那个"收到帧就 pump + 重画"的钩子；
 *  2. **驱动那条**（`net-driver.ts` 构造时 `opts.onMessage ?? transport.onMessage`）——它把帧
 *     `enqueue` 进 `pendingTexts`。
 *
 * 注册顺序是"大厅链先、驱动后"（链路在 `connect()` 时建，驱动在 `enterNetGame()` 里建）⇒
 * **通知先到、入队后到**。真浏览器里量到的四个数（`__g5Match.diag().inboundProbe`）：
 *
 * ```
 * pendingBefore=0  pendingAfter=0  landed=0
 * enqueuedBefore=1 → enqueuedLater=2（300ms 后）
 * ```
 *
 * ⇒ 立刻 `pump(state)` 面对的是**空队列**；帧随后才入队，而此后再没有东西 pump 它
 * （自动推进关着时没有下一次 `submit`）⇒ "状态后来前进、屏再没画过"。
 * 修法：把 `pump + rerender` **推迟一个微任务**（`queueMicrotask`），那时两条订阅都跑完了。
 *
 * ## 这条腿证明什么、不证明什么
 *
 *  - 证明：**顺序本身**（谁先被调），以及"同一轮派发里**立刻** pump 落不了地 /
 *    推迟到微任务就能落地"这条因果；
 *  - 不证明：`main.ts` 里那几行（它在 node 里 import 不了）—— 那一半由
 *    `scenario-mouse.mjs` 的真浏览器正腿覆盖（草稿第 1-6 手全部"两页对齐"）。
 */
import { describe, expect, it } from 'vitest';
import { createNetDriver } from '../../src/net/net-driver';
import { createFakeTransportPair } from '../../src/net/fake-transport';
import { createGame } from '../../src/core/state/create';
import { DRAFT_PICK_KIND } from '../../src/app/match-file';
import type { GameState } from '../../src/core/models/types';

const SEED = 'g5-t14-inbound-order';

function actText(defId: string, player: 0 | 1, seq: number): string {
  return JSON.stringify({ t: 'act', seq, action: { player, kind: DRAFT_PICK_KIND, args: { defId }, seq } });
}

interface Fixture {
  pair: ReturnType<typeof createFakeTransportPair>;
  s: GameState;
  order: string[];
  /** 通知那一刻**立刻** pump 的结果（改之前的写法） */
  landedImmediately: number[];
  /** 通知那一刻驱动侧'入队点被走到过几次'（0 = 帧还没入队） */
  enqueuedAtNotify: number[];
  /** 推迟一个微任务之后 pump 的结果（本轮修法） */
  deferred: { landed: number };
  driver: ReturnType<typeof createNetDriver>;
  /** 把一条 act 从对端发过来（下一步 `pump()` 才落地） */
  sendFrame(text: string): void;
}

/**
 * 按**生产顺序**接线：① 先订"大厅链那条"（它 = `main.ts` 的 `onInbound`）；
 * ② **后**建驱动（驱动构造时就订了第二条）。
 *
 * ⚠️ **刻意不 `arm(s)`**：`arm` 会顺手 `drain`，那就造不出"帧到了但没落地"这一格。
 */
async function wire(): Promise<Fixture> {
  const pair = createFakeTransportPair();
  // 两端都要 init（否则 B 的 send 报 not-initialized，帧根本不上线）
  await pair.A.transport.init({ selfId: 'A', peerId: 'B' });
  await pair.B.transport.init({ selfId: 'B', peerId: 'A' });
  const s = createGame({ seed: SEED });
  const order: string[] = [];
  const landedImmediately: number[] = [];
  const enqueuedAtNotify: number[] = [];
  const deferred = { landed: 0 };
  let driver: ReturnType<typeof createNetDriver> | null = null;

  // ① 大厅链那条（先注册）：它模仿 `main.ts` 的 onInbound —— 立刻 pump + 排一个微任务
  pair.A.transport.onMessage(() => {
    order.push('notify');
    // ★ 通知那一刻入队点计数：**0** = 驱动那条订阅（后注册）还没跑 ⇒ 帧还没入队
    enqueuedAtNotify.push(driver === null ? -1 : driver.enqueuedCount());
    landedImmediately.push(driver === null ? -1 : driver.pump(s));
    queueMicrotask(() => { deferred.landed += driver === null ? 0 : driver.pump(s); });
  });
  // ② 驱动那条（后注册：构造即订）
  driver = createNetDriver({ transport: pair.A.transport, seat: 0 });
  return {
    pair, s, order, landedImmediately, enqueuedAtNotify, deferred, driver,
    sendFrame: (text) => { pair.B.transport.send('act', text); },
  };
}

describe('★★ G5 T14：入站订阅的先后（决定"立刻 pump"能不能落地）', () => {
  it('① 顺序与总账：通知先、入队后 ⇒ 立刻 pump 落地 0；推迟一个微任务落地 1', async () => {
    const f = await wire();
    expect(f.pair.A.transport.status(), '夹具前提：A 侧该是 online').toBe('online');

    f.sendFrame(actText('flexibility', 0, 0));
    f.pair.pump(2);   // 默认 latencyTicks=1 ⇒ 下一拍才到

    // ── 顺序：通知先、驱动后 ────────────────────────────────────────────────────
    // 顺序：本回调（通知）先跑 ⇒ 那一刻**入队点计数是 0**（帧还没入队）；入队由后注册那条做
    expect(f.order, '通知没有被调到').toEqual(['notify']);
    expect(f.enqueuedAtNotify[0], '通知那一刻帧已经入队了 ⇒ 顺序假设不成立，请复核').toBe(0);
    // ── 立刻 pump：队列还空着（驱动那条订阅还没跑）────────────────────────────────
    expect(f.landedImmediately[0], '"立刻 pump"竟然落地了 —— 那这条腿的前提不成立').toBe(0);
    expect(f.driver.appliedSteps(), '"立刻 pump"就动了 appliedSteps').toBe(0);
    // ── 帧确实进了队列（驱动那条订阅跑过了）──────────────────────────────────────
    expect(f.driver.pendingCount(), '驱动那条订阅没有把帧入队（夹具不成立）').toBe(1);
    expect(f.driver.enqueuedCount(), '入队点计数没涨').toBe(1);
    // ── 微任务之后：落地 1 ──────────────────────────────────────────────────────
    await Promise.resolve();
    expect(f.deferred.landed, '推迟一个微任务之后仍未落地（这就是本轮修的拦路）').toBe(1);
    expect(f.driver.appliedSteps(), '落地之后 appliedSteps 没有 +1').toBe(1);
    expect(f.driver.pendingCount(), '落地之后队列没清空').toBe(0);
    expect(f.driver.lastFailure(), '这条路上留下了失败记录').toBeNull();
  });

  it('② 反空转：**不推迟**（只在派发里立刻 pump）就永远落不了地 —— 证明那一句是必需的', async () => {
    const pair = createFakeTransportPair();
    await pair.A.transport.init({ selfId: 'A', peerId: 'B' });
    await pair.B.transport.init({ selfId: 'B', peerId: 'A' });
    const s = createGame({ seed: SEED });
    const landed: number[] = [];
    let driver: ReturnType<typeof createNetDriver> | null = null;
    // 只订"立刻 pump"那条：**没有**微任务（= 改之前的写法）
    pair.A.transport.onMessage(() => { landed.push(driver === null ? -1 : driver.pump(s)); });
    driver = createNetDriver({ transport: pair.A.transport, seat: 0 });

    pair.B.transport.send('act', actText('flexibility', 0, 0));
    pair.pump(2);   // 默认 latencyTicks=1 ⇒ 下一拍才到
    await Promise.resolve();
    await Promise.resolve();

    expect(landed[0], '这一格该是一次"落地 0"的立刻 pump').toBe(0);
    expect(driver.appliedSteps(), '不推迟却也落地了 —— 那"推迟"就不是必需的了，请复核').toBe(0);
    expect(driver.pendingCount(), '帧没有留在队列里').toBe(1);
    expect(driver.pump(s), '手动补一次 pump 竟然落不了地').toBe(1);
    expect(driver.appliedSteps(), '手动 pump 之后 appliedSteps 没有 +1').toBe(1);
  });
});
