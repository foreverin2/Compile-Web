import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CHANNEL_SPECS, channelSpec } from '../../src/net/transport';
import type { NetChannel, SendFailureReason, TransportStatus } from '../../src/net/transport';
import { CLOSE_RES_TEXT, CONTROL_LATENCY_TICKS, after, createFakeTransportPair } from '../../src/net/fake-transport';
import type { FakePairOptions, FakeTransportPair, Side } from '../../src/net/fake-transport';

/**
 * G5 T2 行为腿（计划 `docs/2026-09-17-G5-传输层联机-实现计划.md` §5 T2 的验收判据 1、2、4、6，
 * 以及本任务书的判据 5）。
 *
 * ## 判据 ↔ 用例的对应（别的腿不要往这里加）
 *
 * | 判据 | 用例 |
 * |---|---|
 * | 1 成对双向、`act` 保序可靠、`beat` 可乱序可丢 | `成对传输能双向传到两条通道上`、`act 保序…`、`beat 可乱序可丢` |
 * | 2 断线：`send` 失败、状态 offline、重连后继续 | `断线…`、`重连之后…` |
 * | 3 `src/net` 定时器零命中 | **不在本文件**：那条腿住在 T1 的生成式守卫 `tests/net/net-purity.test.ts`，本文件只做锚点核对（见最后一条 `it`） |
 * | 4 确定性（同一脚本跑两遍逐字相同） | `同一脚本跑 N 遍…`、`投递时刻只由调用方给的脚本决定…` |
 * | 5 注入式（不依赖全局对象） | `接口不依赖任何全局对象` |
 * | 6 接口能表达"这条通道不可靠" | `通道特性表…` |
 *
 * ## ★ 为什么判据 4 要跑**多遍**且每遍之间要等墙钟前进
 *
 * 曾经的直觉是"跑两遍就够"。错在哪：变异若把墙钟（`Date.now()`）折进投递时刻，
 * 而两遍恰好落在**同一毫秒**里，折出来的偏移一模一样 ⇒ 判据绿。
 * 也就是说"跑两遍"这条腿对"折墙钟"的**检测概率**取决于机器速度 —— 那是一条会看着人品的判据。
 *
 * ⇒ 现在的做法：每遍之间**空转到 `Date.now()` 前进 1ms**（测试文件里读墙钟是允许的，
 * 被禁的是 `src/net/**`），跑 `REPEATS` 遍，断言每一遍的**投递序列与状态日志**都与第一遍逐字相同。
 * 墙钟一旦真的影响投递，偏移就是"哪一遍"的函数，几乎必然被抓到；而干净实现里
 * `Date.now()` 读出来的值**根本进不了任何被比对的数据**。
 *
 * 这一条同时是"投递序列逐字相同"的机械证明：比对的是实现自己产出的 `FakeDelivery[]`，
 * 不是测试在旁边另攒的一份日志（那样"序列"的定义就跑到测试里去了）。
 */

/* ------------------------------------------------------------------ *
 * 夹具
 * ------------------------------------------------------------------ */

/**
 * 一个确定性的线性同余发生器：同样的种子给同样的序列。
 *
 * 为什么自己写：`Math.random` 是"不可复现的输入"，用它写出来的丢包/乱序测试就是不可复现的
 * （本仓的"同一脚本跑两遍"判据根本没法立）。注入固定序列之后，丢包与乱序变成**脚本的一部分**。
 *
 * 数值是自己选的，不做均匀性声明 —— 它只需要"取值落在 [0,1) 且不同种子给不同序列"。
 * `16777619`/`2166136261` 是 FNV 的常数（与 `src/core/rng.ts` 同族，但这里不 import 它：
 * 纯层的测试不该为了造随机数去拉一条跨层依赖）。
 */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 16777619 + 2166136261) >>> 0;
    return s / 4294967296;
  };
}

/** 空转到墙钟前进 1 毫秒（**只在测试里用**；`src/net/**` 读钟是硬禁项） */
function waitNextMs(): void {
  const start = Date.now();
  while (Date.now() === start) {
    /* 空转，最多 1ms */
  }
}

/**
 * 建一对"收发都记日志"的传输。
 *
 * 注入的随机源是 `rng(seed)` —— 每次 `createDeliverer` 都**新建**一个独立的发生器，
 * 所以两遍跑不会因为共享状态而互相影响（那正是"两遍不同"的一种假成因）。
 */
function createDeliverer(opts: { seed?: number } & FakePairOptions = {}) {
  const { seed, ...pairOpts } = opts;
  const pair = createFakeTransportPair({
    randomA: rng((seed ?? 1) * 7919),
    randomB: rng((seed ?? 1) * 104729),
    ...pairOpts,
  });
  const got: { side: Side; at: number; channel: NetChannel; text: string }[] = [];
  const record = (side: Side) => (text: string, channel: NetChannel) =>
    got.push({ side, at: pair.tick(), channel, text });
  pair.A.transport.onMessage(record('A'));
  pair.B.transport.onMessage(record('B'));
  return { pair, got };
}

/** 一条腿里反复用到的"建连 + 都要检查返回值"的动作 */
async function connect(pair: FakeTransportPair): Promise<void> {
  const a = await pair.A.transport.init({ selfId: 'A', peerId: 'B' });
  const b = await pair.B.transport.init({ selfId: 'B', peerId: 'A' });
  expect([a.ok, b.ok], '两端 init 都必须成功').toEqual([true, true]);
}

/** 投递序列的**逐字**快照（`expect(JSON.stringify(...)).toBe(...)` 用的就是它） */
function snapshot(pair: FakeTransportPair): string {
  return JSON.stringify({ steps: pair.steps(), status: pair.statusLog() });
}

const REPEATS = 40;

/* ------------------------------------------------------------------ *
 * 判据 1：成对双向、act 保序可靠、beat 可乱序可丢
 * ------------------------------------------------------------------ */

describe('判据 1：成对 fake 双向传消息', () => {
  it('两条通道都能双向送到，且送到的原文一字不改', async () => {
    const { pair, got } = createDeliverer();
    await connect(pair);

    // 先 init 后 send：没 init 就发是 `'not-initialized'`（判据 2 里另有一条腿）
    expect(pair.A.transport.status()).toBe('online');
    expect(pair.B.transport.status()).toBe('online');

    expect(pair.A.transport.send('act', 'A-act-1').ok).toBe(true);
    expect(pair.A.transport.send('beat', 'A-beat-1').ok).toBe(true);
    expect(pair.B.transport.send('act', 'B-act-1').ok).toBe(true);
    expect(pair.B.transport.send('beat', 'B-beat-1').ok).toBe(true);

    pair.pump(4);

    // ★ 分两层断言，混在一起会让"哪一条红了"说不清：
    //   `got` 只证明"原文与通道如实送到"，`steps` 才证明"谁发给了谁"。
    expect(got.map((g) => `${g.channel}:${g.text}`).sort()).toEqual(
      ['act:A-act-1', 'beat:A-beat-1', 'act:B-act-1', 'beat:B-beat-1'].sort(),
    );
    expect(
      pair
        .steps()
        .map((s) => `${s.from}->${s.to}:${s.channel}:${s.text}`)
        .sort(),
    ).toEqual(['A->B:act:A-act-1', 'A->B:beat:A-beat-1', 'B->A:act:B-act-1', 'B->A:beat:B-beat-1'].sort());
    // 通道要如实带到接收侧（T3 的 beat 心跳与 act 操作记录是两种处置）
    expect(got.find((g) => g.text === 'A-act-1')?.channel).toBe('act');
    expect(got.find((g) => g.text === 'B-beat-1')?.channel).toBe('beat');
  });

  it('act 保序：同一步里连发 8 条，到达顺序与发送顺序逐字相同', async () => {
    const { pair, got } = createDeliverer({ aToB: { latencyTicks: 1 } });
    await connect(pair);

    const sent = ['act-0', 'act-1', 'act-2', 'act-3', 'act-4', 'act-5', 'act-6', 'act-7'];
    for (const t of sent) expect(pair.A.transport.send('act', t).ok).toBe(true);
    // 全部排在同一步 ⇒ 到达步相同 ⇒ "保序"这件事被逼到**同一到达步内的排序**上。
    // pump 的步数要够：第 1 帧在 `latencyTicks + 1 = 2` 步到，第 8 帧要到第 9 步，多给几步余量。
    pair.pump(12);

    expect(got.filter((g) => g.side === 'B').map((g) => g.text)).toEqual(sent);
  });

  it('act 可靠：注入再高的丢包率，一条 act 都不丢，而且一条都不少', async () => {
    // dropNumerator/Denominator = 3/4：这一侧几乎必然要丢东西。丢的只能是 beat。
    const { pair, got } = createDeliverer({ aToB: { latencyTicks: 1, dropNumerator: 3, dropDenominator: 4 } });
    await connect(pair);

    const acts = ['x0', 'x1', 'x2', 'x3', 'x4'];
    const beats = ['b0', 'b1', 'b2', 'b3', 'b4'];
    for (let i = 0; i < acts.length; i += 1) {
      pair.A.transport.send('act', acts[i]);
      pair.A.transport.send('beat', beats[i]);
    }
    pair.pump(12);

    const delivered = got.filter((g) => g.side === 'B');
    const actDelivered = delivered.filter((g) => g.channel === 'act').map((g) => g.text);
    // ★ 这条腿只断**可靠**（一条不少、一条不重），**不**断顺序（评审 N-7）：
    //   顺序归 `act 保序` 那条腿管。原先这里写 `toEqual(acts)`（含顺序），于是 M1（乱序）
    //   会让两条腿同时红，定位时串在一起，分不清"丢了"还是"乱了"。
    expect([...actDelivered].sort(), 'act 丢帧或重复了').toEqual([...acts].sort());
    expect(actDelivered.length, 'act 条数不对').toBe(acts.length);
    // 丢包确实发生了（否则这条腿证明不了"act 不丢"是有意义的：队列本来就没压力）
    expect(pair.dropped()).toBeGreaterThan(0);
    // 而且丢的**只可能是** beat：act 那 5 条一条不少（上面已断言）
    expect(delivered.filter((g) => g.channel === 'beat').length).toBeLessThan(beats.length);
  });

  it('beat 可乱序：同一步连发的 5 条 beat，到达顺序与发送顺序不同', async () => {
    // lag(0, 0, 4) 的取值是 4、6、8、10、12…：**只有 ≥ 4 才会把一帧往后推**，
    // 于是前几条被推、整串顺序翻转 ⇒ 这个注入序列本身就是"乱序开关"。
    // reorderTicks = 1 ⇒ 推后 1 步（恰好越过下一条）。
    const { pair, got } = createDeliverer({ seed: 1 });
    pair.A.configure({ reorderTicks: 1 });
    await connect(pair);

    const beats = ['b0', 'b1', 'b2', 'b3', 'b4'];
    for (const t of beats) expect(pair.A.transport.send('beat', t).ok).toBe(true);
    pair.pump(12);

    const arrived = got.filter((g) => g.side === 'B').map((g) => g.text);
    expect(arrived.length, 'beat 一条都没到（乱序腿的前提不成立）').toBeGreaterThan(1);
    expect(arrived, '注入的乱序没有生效：到达顺序与发送顺序相同').not.toEqual(beats.slice(0, arrived.length));
    // 乱序不等于乱丢：所有"没被丢弃"的帧都到了（这一侧 dropNumerator 是 0）
    expect(arrived.length).toBe(beats.length);
  });
});

/* ------------------------------------------------------------------ *
 * 判据 2：断线（send 失败 / offline / 重连后继续）
 * ------------------------------------------------------------------ */

describe('判据 2：断线、失败结果与重连', () => {
  it('断线：send 返回 offline 失败结果、两端状态都变 offline，且帧真的没过去', async () => {
    const { pair, got } = createDeliverer();
    await connect(pair);
    const statusA: TransportStatus[] = [];
    pair.A.transport.onStatus((c) => statusA.push(c.to));

    pair.A.deactivate();
    expect(pair.A.transport.status()).toBe('offline');
    expect(pair.B.transport.status(), '拔线是双向的：对端也要变 offline').toBe('offline');
    expect(statusA, 'A 端收到过一次状态变化').toEqual(['offline']);

    const r = pair.A.transport.send('act', 'after-unplug');
    // 先判外形再判内容（TS 的判别式联合在 `expect(...).toMatchObject` 之后不会收窄）
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('断线时 send 居然成功了');
    expect(r.reason).toBe('offline');
    expect(r.message.length, '失败要带一句给人看的真因').toBeGreaterThan(0);

    pair.pump(6);
    expect(got, '断线期间发出去的帧一条都不许到达对端').toEqual([]);
  });

  it('close 之后 send 给 closed，且 idle 状态给 not-initialized（两个理由码不是同一个）', async () => {
    const idle = createDeliverer();
    const idleResult = idle.pair.A.transport.send('act', 'x');
    expect(idleResult.ok).toBe(false);
    if (idleResult.ok) throw new Error('没 init 就 send 居然成功了');
    expect(idleResult.reason).toBe('not-initialized');

    const { pair } = createDeliverer();
    await connect(pair);
    expect((await pair.A.transport.close()).ok).toBe(true);

    const closedResult = pair.A.transport.send('act', 'x');
    expect(closedResult.ok).toBe(false);
    if (closedResult.ok) throw new Error('close 之后 send 居然成功了');
    expect(closedResult.reason).toBe('closed');
    expect(pair.A.transport.status()).toBe('closed');
    // 重复 close 是幂等的（重连路上会被反复调）
    expect((await pair.A.transport.close()).ok).toBe(true);
  });

  it('重连：activate 之后待排的帧原样送达，接着发的新帧也照常走', async () => {
    const { pair, got } = createDeliverer();
    await connect(pair);

    pair.A.deactivate();
    // 这一条在断线期间发：`send` 失败（判据 2 的上面那条腿），所以它**不该**被收下
    expect(pair.A.transport.send('act', 'while-down').ok).toBe(false);
    pair.pump(3);

    pair.A.activate();
    expect(pair.A.transport.status(), 'activate 之后本端要回到 online').toBe('online');
    expect(pair.B.transport.status(), 'activate 之后对端也要回到 online').toBe('online');

    expect(pair.A.transport.send('act', 'after-reconnect').ok).toBe(true);
    pair.pump(4);

    expect(got.map((g) => g.text)).toEqual(['after-reconnect']);
  });

  it('★ N-1：断线之后 `init()` 不许把状态说成 online（要么失败、要么真连上）', async () => {
    // 病（评审 N-1 实测 `expected 'online' to be 'offline'`）：`deactivate()` 之后调 `init()`
    // 会把状态从 offline 说成 online，而 `reachable[side]` 仍是 false、`setReachable(false)`
    // 也不会再触发 ⇒ 状态**永久说谎**；此后 `send` 回报成功而帧只烂在 requeue。
    const { pair } = createDeliverer();
    await connect(pair);
    pair.A.deactivate();
    expect(pair.A.transport.status()).toBe('offline');

    // 对端仍不可达 ⇒ 这次 init 必须失败，且状态不许变成 online
    const again = await pair.A.transport.init({ selfId: 'A', peerId: 'B' });
    expect(again.ok, '对端不可达时 init 居然成功了').toBe(false);
    if (again.ok) throw new Error('对端不可达时 init 居然成功了');
    expect(again.reason).toBe('offline');
    expect(pair.A.transport.status(), 'init 把状态说成了 online（状态说谎）').toBe('offline');
    // 而且不许"看着成功、帧却发不出去"：这一条仍然是 offline 失败
    const r = pair.A.transport.send('act', 'x');
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('离线时 send 居然成功了');
    expect(r.reason).toBe('offline');

    // 线接回来之后再 init 才是真的连上
    pair.A.activate();
    const third = await pair.A.transport.init({ selfId: 'A', peerId: 'B' });
    expect(third.ok).toBe(true);
    expect(pair.A.transport.status()).toBe('online');
  });

  it('★ N-1 的第二面：一端从一开始就不可达时，`init()` 给可读失败而不是假 online', async () => {
    // 这一面用构造参数造"对端不可达"（不去用负数延迟那类**语义非法**的手段）：
    // 它钉的是"init 不许在连不上的情况下报成功"。跑完用 `activate()` 把两端放回 online。
    const { pair } = createDeliverer({ reachable: { sideB: false } });
    const a = await pair.A.transport.init({ selfId: 'A', peerId: 'B' });
    expect(a.ok, '对端不可达时 A 的 init 居然成功了').toBe(false);
    if (a.ok) throw new Error('对端不可达时 A 的 init 居然成功了');
    expect(a.reason).toBe('offline');
    expect(pair.A.transport.status()).toBe('offline');

    try {
      // 对端这时才真的上线
      const b = await pair.B.transport.init({ selfId: 'B', peerId: 'A' });
      expect(b.ok).toBe(true);
      const a2 = await pair.A.transport.init({ selfId: 'A', peerId: 'B' });
      expect(a2.ok, '对端上线之后 A 的 init 该成功').toBe(true);
      expect(pair.A.transport.status()).toBe('online');
      expect(pair.B.transport.status()).toBe('online');
    } finally {
      pair.B.activate();
      pair.A.activate();
    }
  });

  it('★ R-1：`init()` 失败之后 `activate()` 必须把本端带回 online', async () => {
    // 病（阶段二复验 R-1）：`init()` 的规则二会造出"本侧 `reachable === true`
    // 而 `status === 'offline'`"这个组合，而 `setReachable` 当时有同值早退 ⇒
    // `activate()` 里那一步被吞掉，本端永远留在 offline、`send` 一直失败。
    // 症状逐字是 `expected 'offline' to be 'online'`。
    const { pair } = createDeliverer();
    await connect(pair);
    pair.A.deactivate();

    const failed = await pair.A.transport.init({ selfId: 'A', peerId: 'B' });
    expect(failed.ok, '对端不可达时 init 居然成功了').toBe(false);

    // ★ 这一条是本腿的核心：**只调 activate()**，不再补一次 init()
    pair.A.activate();
    expect(pair.A.transport.status(), 'activate 之后本端仍是 offline').toBe('online');
    expect(pair.B.transport.status(), 'activate 之后对端也要回到 online').toBe('online');
    const r = pair.A.transport.send('act', 'after-activate');
    expect(r.ok, 'activate 之后 send 仍然失败').toBe(true);
    pair.pump(4);
    expect(pair.A.transport.status()).toBe('online');
  });

  it('★ R-3：对端已关闭（终态）之后，本端 `init()` 不许把自己说成 online', async () => {
    // 病（阶段二复验 R-3）：`close()` 只清**接收侧**的 reachable，于是接收侧以为
    // "只是暂时断了" ⇒ 它的 `init()` 报成功并转 online，形成"本端 online / 对端 closed"
    // 这种永远连不上的组合。症状逐字是 `expected true to be false`。
    const { pair } = createDeliverer();
    await connect(pair);
    await pair.A.close();
    pair.pump(CONTROL_LATENCY_TICKS + 2);
    expect(pair.B.transport.status(), '前提：B 已经因为 A 关闭而转 offline').toBe('offline');

    const b = await pair.B.transport.init({ selfId: 'B', peerId: 'A' });
    expect(b.ok, '对端已关闭时 B 的 init 居然成功了').toBe(false);
    if (b.ok) throw new Error('对端已关闭时 B 的 init 居然成功了');
    expect(b.reason).toBe('offline');
    expect(pair.B.transport.status(), 'B 把自己说成了 online（对端明明是 closed 终态）').toBe('offline');
    const r = pair.B.transport.send('act', 'x');
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('对端已关闭时 send 居然成功了');
    expect(r.reason).toBe('offline');
  });

  it('★ N-5：`sendIfOpen` 解构调用不抛（它是闭包，不依赖 this）', async () => {
    // 病（评审 N-5）：原先实现用 `this.send(...)`，解构调用抛
    // `TypeError: Cannot read properties of undefined (reading 'send')`，
    // 与 `transport.ts` 头顶"失败一律返回结果对象、不抛"直接相左。
    const { pair } = createDeliverer();
    await connect(pair);
    const { sendIfOpen } = pair.A.transport;
    const okResult = sendIfOpen('act', 'destructured-ok');
    expect(okResult.ok).toBe(true);
    pair.pump(4);

    pair.A.deactivate();
    const failures: SendFailureReason[] = [];
    pair.A.transport.onError((f) => failures.push(f.reason));
    // 解构之后**在失败路径上**也不许抛
    const failResult = sendIfOpen('act', 'destructured-fail');
    expect(failResult.ok).toBe(false);
    if (failResult.ok) throw new Error('离线时 sendIfOpen 居然成功了');
    expect(failResult.reason).toBe('offline');
    expect(failures, 'onError 旁路没收到同一次失败').toEqual(['offline']);
  });

  it('close：本端关闭后对端转 offline，且这条信号**不进消息流**（N-2 的整改腿）', async () => {
    const { pair, got } = createDeliverer();
    await connect(pair);
    const statusB: TransportStatus[] = [];
    pair.B.transport.onStatus((c) => statusB.push(c.to));

    const seq = await pair.A.close();
    expect(seq, 'close 应该登记一条内部信号').not.toBeNull();
    // 这一问必须在 `pump` **之前**：投递之后帧就不在队列里了，`earliestTick` 会回 undefined
    //    （第一版写反了顺序，症状是"expected undefined to be 1"）。
    expect(pair.A.earliestTick(seq as number), '内部信号的到达步应为当前步 + CONTROL_LATENCY_TICKS').toBe(
      CONTROL_LATENCY_TICKS,
    );
    pair.pump(CONTROL_LATENCY_TICKS + 2);

    // ★ 评审 N-2 的整改：早先唯一信号是 fake 私有载荷混进 `onMessage`（T3 会判成"未知 t"），
    //   而对端状态仍是 online。现在反过来：状态面有正规信号，消息面一个字都不进。
    expect(pair.B.transport.status(), '对端关闭后 B 必须转 offline').toBe('offline');
    expect(statusB, 'B 收到过状态变化').toEqual(['offline']);
    expect(got, 'close 的内部信号不许混进 onMessage').toEqual([]);
  });
});

/* ------------------------------------------------------------------ *
 * 判据 4：确定性
 * ------------------------------------------------------------------ */

describe('判据 4：同一脚本跑多遍，投递序列逐字相同', () => {
  /**
   * 一段**固定的**脚本：两条通道都发、两种延迟都用、丢包与乱序都开、
   * 还有一次断线与重连。它必须足够长且足够杂 —— 只发三条消息的脚本会把
   * "墙钟偷偷进了投递时刻"这件事遮掉（差异没有机会显出来）。
   */
  function runScript(seed: number): FakeTransportPair {
    const { pair } = createDeliverer({ seed });
    pair.A.configure({ dropNumerator: 1, dropDenominator: 3, reorderTicks: 1 });
    pair.B.configure({ latencyTicks: 2, dropNumerator: 1, dropDenominator: 4, reorderTicks: 2 });
    // `dropNumerator: 1` + 注入的固定序列 ⇒ 丢哪些帧是**脚本**决定的，不是机器决定的
    void pair.A.transport.init({ selfId: 'A', peerId: 'B' });
    void pair.B.transport.init({ selfId: 'B', peerId: 'A' });
    for (let i = 0; i < 12; i += 1) {
      pair.A.transport.send('act', `a-act-${i}`);
      pair.A.transport.send('beat', `a-beat-${i}`);
      pair.B.transport.send('act', `b-act-${i}`);
      pair.B.transport.send('beat', `b-beat-${i}`);
      pair.pump(1);
    }
    pair.pump(20);
    pair.A.deactivate();
    pair.pump(2);
    pair.A.activate();
    pair.pump(3);
    pair.A.schedule('act', 'late-byte', after(2));
    pair.pump(6);
    return pair;
  }

  it(`同一脚本跑 ${REPEATS} 遍（每遍之间等墙钟前进 1ms），每一步的投递记录逐字相同`, () => {
    const first = snapshot(runScript(7));
    const firstLength = runScript(7).steps().length;
    // 下界自证：脚本必须真的产生了可观测量，否则"两遍相同"在空序列上恒真
    expect(firstLength, '脚本一条都没投递（这条判据会在空序列上恒真）').toBeGreaterThan(10);

    for (let round = 1; round < REPEATS; round += 1) {
      waitNextMs(); // ★ 让墙钟**一定**前进：否则"两遍落在同一毫秒"会把折墙钟的缺陷遮掉
      expect(snapshot(runScript(7)), `第 ${round + 1} 遍与第 1 遍不同`).toBe(first);
    }
  });

  it('记录本身有区分力：换一个种子，投递序列必须不同（否则上一遍的"相同"是假的）', () => {
    // ★ 没有这条腿，上面那条可能是"无论输入是什么都产出同一份序列"式假绿。
    const a = snapshot(runScript(7));
    const b = snapshot(runScript(11));
    expect(a).not.toBe(b);
  });

  it('投递时刻只由调用方给的脚本决定：同一次调度，两遍给出同一个最早到达步', async () => {
    // 这条腿把"确定性"缩到**一个数**上（最早到达步），便于变异定位：这一帧最早在哪一步能到，
    // 只能是"当前步 + 延迟 + 乱序"的函数，不许掺墙钟。
    async function scheduleAndRead(): Promise<{ seq: number; earliest: number | undefined }> {
      const { pair } = createDeliverer();
      await connect(pair);
      const seq = pair.A.schedule('act', 'probe');
      return { seq, earliest: pair.A.earliestTick(seq) };
    }
    const one = await scheduleAndRead();
    waitNextMs();
    const two = await scheduleAndRead();
    expect(one.earliest, '刚 schedule 的帧就查不到（earliestTick 的入参口径错了？）').toBeDefined();
    expect(two, '同一调度在两遍里排到了不同的最早到达步（墙钟进了投递时刻）').toEqual(one);
    // 顺带钉住"查到的是真的那一帧"：投递之后它必须从队列里消失
    const { pair } = createDeliverer();
    await connect(pair);
    const seq = pair.A.schedule('act', 'probe');
    expect(pair.A.earliestTick(seq)).toBeDefined();
    pair.pump(4);
    expect(pair.A.earliestTick(seq), '已投递的帧还留在队列里（earliestTick 会给出过期的到达步）').toBeUndefined();
  });

  it('★ 绝对到达步逐字钉住（N-3 的改名腿 + 墙钟检测力补强）', async () => {
    // ★ 为什么需要这条腿（评审 M4 暴露的硬上界）：上面那条"跑 40 遍"是**跨遍比对**，
    //   它只对"每毫秒都变"的墙钟依赖灵敏。加一个**粗粒度**墙钟依赖
    //   （例如 `Math.floor(Date.now() / 10000) % 2`，十秒才翻一次）时：
    //   同一遍之内的所有帧偏移**相同**，跨遍比对也相同（都在同一个十秒窗口里）
    //   ⇒ 40 遍那条腿全绿，只有 T1 守卫的文本腿能红。
    //   而这条腿钉的是**绝对**步号，任何常量偏移都会当场红。
    const pair = createFakeTransportPair();
    const got: { at: number; text: string }[] = [];
    pair.A.transport.onMessage((text) => got.push({ at: pair.tick(), text }));
    pair.B.transport.onMessage((text) => got.push({ at: pair.tick(), text }));
    await pair.A.transport.init({ selfId: 'A', peerId: 'B' });
    await pair.B.transport.init({ selfId: 'B', peerId: 'A' });

    pair.A.transport.send('act', 'a1');
    pair.A.transport.send('act', 'a2');
    pair.B.transport.send('beat', 'b1');
    pair.pump(6);

    // 默认 latencyTicks = 1，帧在发送那一步**还没到**（同一个 +1）。
    // 每步**每侧**各交一帧 ⇒ 第 2 步 A 与 B 各交一帧（a1、b1 都落在 2），第 3 步 A 交 a2。
    expect(
      pair.steps().map((s) => `${s.atTick}:${s.from}->${s.to}:${s.channel}:${s.text}`),
      '绝对到达步变了：投递时刻掺进了脚本之外的量（例如墙钟常量偏移）',
    ).toEqual(['2:A->B:act:a1', '2:B->A:beat:b1', '3:A->B:act:a2']);
    expect(got.map((g) => `${g.at}:${g.text}`)).toEqual(['2:a1', '2:b1', '3:a2']);
  });

  it('★ 一步只交付一帧这件事是**明确承诺**：earliestTick 是下界，不是实际到达步', async () => {
    // 评审 N-3：原 API 名 `scheduleAt` 承诺"第几步到达"，而实现每步每侧只交一帧。
    // 现在的口径是：`earliestTick` 返回**最早可能**的到达步；实际落地还取决于队列。
    // 这条腿把三帧的"下界相同、实际递推"这件事钉住，免得后来人又把两者混起来。
    const { pair } = createDeliverer();
    await connect(pair);
    const seqs = ['d0', 'd1', 'd2'].map((t) => pair.A.schedule('act', t));
    expect(seqs.map((s) => pair.A.earliestTick(s)), '三帧的最早到达步应当相同（同一步发出、同延迟）').toEqual([2, 2, 2]);
    pair.pump(6);
    expect(
      pair.steps().map((s) => s.atTick),
      '实际到达步是按队列逐条递推的（每步每侧一帧）',
    ).toEqual([2, 3, 4]);
  });
});

/* ------------------------------------------------------------------ *
 * 判据 5 / 6：注入式与通道特性
 * ------------------------------------------------------------------ */

describe('判据 5 / 6：注入式，以及"不可靠"这件事必须能被接口表达', () => {
  it('接口不依赖任何全局对象：宿主随便给 id，同名两端也能各自独立跑', async () => {
    // 两个**互不相干**的 pair 同时活着，各自收各自的消息（没有模块级单例）。
    const one = createDeliverer({ seed: 3 });
    const two = createDeliverer({ seed: 5 });
    await connect(one.pair);
    await connect(two.pair);

    one.pair.A.transport.send('act', 'from-one');
    two.pair.B.transport.send('act', 'from-two');
    one.pair.pump(3);
    two.pair.pump(3);

    expect(one.got.map((g) => g.text)).toEqual(['from-one']);
    expect(two.got.map((g) => g.text)).toEqual(['from-two']);
    // `init` 收的 id 被如实记住（不是从全局或环境里猜的）
    expect(one.pair.A.transport.seq()).toBe(1);
    expect(two.pair.B.transport.seq()).toBe(1);
  });

  it('★ 无参建两对：互不共享状态（判据 5 的"没有隐藏单例"腿）', async () => {
    // ★ 补这条腿的原因（评审 S1 实测）：原判据面里**每一处**建 pair 都走 `createDeliverer()`，
    //   而它总是注入 `randomA/randomB` ⇒ 从不走无参那条路。于是"给无参调用加一个模块级单例"
    //   这种变异对全部判据不可见（S1：判据面 25 条全绿、只有探针红）。这是**结构性漏**，
    //   不是概率漏 —— 补法就是真的用无参形式建两对，并断言它们的**对象身份**都不同。
    const one = createFakeTransportPair();
    const two = createFakeTransportPair();
    expect(one, '两次无参调用拿到了同一个实例（模块级单例）').not.toBe(two);
    expect(one.A.transport, '两对的 A 端是同一个对象').not.toBe(two.A.transport);
    expect(one.steps()).not.toBe(two.steps());

    await one.A.transport.init({ selfId: 'A', peerId: 'B' });
    await one.B.transport.init({ selfId: 'B', peerId: 'A' });
    await two.A.transport.init({ selfId: 'A', peerId: 'B' });
    await two.B.transport.init({ selfId: 'B', peerId: 'A' });
    one.A.transport.send('act', 'only-in-one');
    one.pump(4);

    // 状态互不串：`one` 走了一步，`two` 的时钟与日志必须纹丝不动
    expect(one.steps().map((s) => s.text)).toEqual(['only-in-one']);
    expect(two.steps(), '两对共享了投递日志').toEqual([]);
    expect(two.tick(), '两对共享了时钟').toBe(0);
    expect(one.tick()).toBe(4);
  });

  it('通道特性表：act = 可靠 + 保序，beat = 不可靠 + 可乱序，且两者都在 transport.ts 里声明', () => {
    // 这是判据 6 的机械证明：T7 要能把 `beat` 映射成 ordered:false / maxRetransmits:0，
    // 前提是接口**说出了**这件事。
    expect(channelSpec('act')).toEqual({ channel: 'act', reliable: true, ordered: true });
    expect(channelSpec('beat')).toEqual({ channel: 'beat', reliable: false, ordered: false });
    expect(CHANNEL_SPECS.map((s) => s.channel)).toEqual(['act', 'beat']);

    // 真实实现也会把这张表报出来（fake 与浏览器实现共用同一个事实来源）。
    // ★ 这条断言本身**区分力有限**（评审 N-6 的同族）：它比的是 `channelSpec` 的输出与
    //   `CHANNEL_SPECS`，所以下面另加两条"会红"的钉法 —— 真去改一个字段看会不会被看出来。
    const { pair } = createDeliverer();
    expect(pair.A.transport.channels()).toEqual(CHANNEL_SPECS);
    // (a) `channels()` 必须**不是**模块常量本身：直接返回会让调用方能改到共享的那份
    expect(pair.A.transport.channels(), 'channels() 返回了模块常量本身').not.toBe(CHANNEL_SPECS);
    // (b) 非空 + 恰好两条 + 每条都有 `reliable`/`ordered` 两个布尔（漏字段会红）
    const reported = pair.A.transport.channels();
    expect(reported.length).toBe(2);
    for (const spec of reported) {
      expect(typeof spec.reliable, `${spec.channel}.reliable 不是布尔`).toBe('boolean');
      expect(typeof spec.ordered, `${spec.channel}.ordered 不是布尔`).toBe('boolean');
    }
    expect(reported.filter((s) => !s.reliable).map((s) => s.channel), '只有 beat 可不可靠').toEqual(['beat']);
  });

  it('onError 旁路：失败的那一次会带着同一个理由码出现在订阅者那里', async () => {
    const { pair } = createDeliverer();
    await connect(pair);
    const seen: SendFailureReason[] = [];
    pair.B.transport.onError((f) => seen.push(f.reason));
    pair.A.deactivate();
    pair.B.transport.sendIfOpen('act', 'x');
    expect(seen).toEqual(['offline']);
  });
});

/* ------------------------------------------------------------------ *
 * 判据 3 的锚点核对（腿本体在 T1 的守卫里，本文件不改它、也不重复它）
 * ------------------------------------------------------------------ */

describe('判据 3 的锚点核对（**记录型**，不是判据 3 的牙）', () => {
  it('定时器零命中这条腿住在 T1 的生成式守卫里，且它真的在扫 src/net', () => {
    // ★ 这条用例的口径（评审 N-6 要求写清）：它是**记录型断言**，阅读价值大于判别价值。
    //   判据 3 的牙在 `tests/net/net-purity.test.ts` 那条生成式腿（M2 实测红在它上面），
    //   本文件不重复实现扫描（两份实现会漂移）。
    //
    //   原先这里还有两条 `expect(path).toMatch(/.../)` —— 那是对**刚构造出来的字符串常量**
    //   做正则，恒真（文件删了也照样绿）。已删掉，换成下面三条**会红**的钉法。
    const guardPath = fileURLToPath(new URL('./net-purity.test.ts', import.meta.url));
    const guard = readFileSync(guardPath).subarray(0, 4 * 1024 * 1024).toString('utf8');
    expect(guard, '守卫不在扫 src/net').toContain("new URL('../../src/net/'");
    expect(guard, '守卫里没有"定时器零命中"那条腿').toContain('不直呼定时器');

    // (1) 本任务的两份交付源码必须真的存在于 `src/net/`（文件被挪走/删掉 ⇒ 这里红）
    const lib = fileURLToPath(new URL('../../src/net/fake-transport.ts', import.meta.url));
    const iface = fileURLToPath(new URL('../../src/net/transport.ts', import.meta.url));
    expect(existsSync(lib), `交付源码不在：${lib}`).toBe(true);
    expect(existsSync(iface), `交付源码不在：${iface}`).toBe(true);
    // (2) 它们必须落在守卫的扫描根之下（用**守卫自己那份代码**里的根，不另写一份）
    const netDir = fileURLToPath(new URL('../../src/net/', import.meta.url));
    expect(lib.startsWith(netDir), 'fake-transport.ts 不在守卫的扫描根下').toBe(true);
    expect(iface.startsWith(netDir), 'transport.ts 不在守卫的扫描根下').toBe(true);
  });
});
