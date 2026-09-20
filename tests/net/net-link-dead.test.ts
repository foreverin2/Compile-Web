/**
 * G5 T13-C 判据 3：**§9 第 14 条那个"不报错的失效"要能被调用方判出来**。
 *
 * ## 事实（§9 第 14 条的原文，以及它在代码里的形状）
 *
 * `NetDriver.dispose()` 会 `void transport.close()`，而 `close()` 是**不可逆**的
 * （`src/net/transport.ts:229`）。在那之后，**另一条**拿同一条传输造出来的驱动
 * （`main.ts` 的 `enterNetGame()` 在 `handoff()` 里拿到的就是那条被关掉的传输 ——
 * 探针 `rebootDraft()` 走的就是这条路）再去 `submit`：
 *
 *  - `refusal === 'offline'`（D16 那个码：传输不在 `online`）；
 *  - 而 `lastFailure() === null` —— 它只由 `report()` 写，这条路**不上报失败**。
 *
 * ⇒ 调用方只能看见"离线"，看不见"这条链路已经死了"。而这两件事对玩家的含义完全不同：
 * 前者是"等一等会好"，后者是"必须重新交换邀请码/回示码"（T13-C 判据 5 那条 UI 路）。
 *
 * ## 这条腿证明什么、不证明什么
 *
 *  - 证明：`linkClosed()` 这个新读数**能把"已关闭"与"只是离线"分开**（三种情形各一条），
 *    而且它是**加在既有三个拒绝码之外**的读数（`refusal` / `lastFailure()` 一个字都没动）；
 *  - 不证明：它不改变 `submit` 的行为（那是 D16 的裁决，本轮不动），也不替宿主决定怎么办。
 *
 * ⚠️ 它**不**写进 `tests/net/net-driver.test.ts`（那份是本任务不许动的既有文件）：新的读数
 * 与新的腿都属于 T13-C 的交付面，单独一份文件。
 */
import { describe, expect, it } from 'vitest';
import { createNetDriver } from '../../src/net/net-driver';
import { createFakeTransportPair } from '../../src/net/fake-transport';
import { createGame } from '../../src/core/state/create';
import type { GameState } from '../../src/core/models/types';
import type { ActionRecord } from '../../src/app/match-file';

/** 一条不需要真回应的提交（三种情形都在"传输不可用"那一格被拒，走不到引擎） */
const SUBMIT_A: Omit<ActionRecord, 'seq'> = { player: 0, kind: 'advance', args: {} };

function stateOf(): GameState {
  return createGame({ seed: 'g5-t13c-link-dead' });
}

describe('★★ G5 T13-C 判据 3：链路已死可判（§9 第 14 条）', () => {
  it('链路关掉之后：`refusal` 仍是 offline，但 `linkClosed()` 说得出"这条链路已经死了"', async () => {
    const pair = createFakeTransportPair();
    await pair.A.transport.init({ selfId: 'A', peerId: 'B' });
    const driver = createNetDriver({ transport: pair.A.transport, seat: 0 });
    const s = stateOf();

    // 反空转：链路活着的时候这个读数必须是假（否则"恒真"也能让下面那句绿）
    expect(pair.A.transport.status(), '夹具前提：init 之后本侧链路该是 online').toBe('online');
    expect(driver.linkClosed(), '链路还在线，而 linkClosed() 说它死了').toBe(false);

    /**
     * ★ **正是 `dispose()` 对传输做的那一下**（`net-driver.ts` 的 `void transport.close()`）。
     * 这里直接调传输的 `close()` 而不是 `driver.dispose()` —— 因为 §9 第 14 条的症状属于
     * **之后那条新驱动**（它没有 disposed），旧驱动那一侧 `submit` 报的是 `'read-only'`，
     * 那条路本来就是可判的（下面第三种情形会把这三件事并排摆出来）。
     */
    await pair.A.transport.close();
    expect(pair.A.transport.status(), '反空转：close() 之后链路没有转 closed').toBe('closed');

    const r = driver.submit(s, SUBMIT_A);
    expect(r.ok, '链路已关，提交却成功了').toBe(false);
    // ① §9 第 14 条的原症状：调用方**只能**看见 offline
    expect(r.ok === false ? r.refusal : null, '拒绝码变了（D16 的裁决没动过它）').toBe('offline');
    // ② 失败记录**仍然是 null**（那条路不上报失败）—— 这正是"不报错的失效"
    expect(driver.lastFailure(), '这条路竟然写了失败记录？那 §9 第 14 条的症状已经变了，请复核这条腿').toBeNull();
    // ③ 新增的那个读数：**它是可判的**
    expect(driver.linkClosed(), '链路已经 close() 了，linkClosed() 却说它还活着（这条腿的判据）').toBe(true);
  });

  it('负控：只是"掉线"（可逆）⇒ `linkClosed()` 必须是假（两个读数不许合并）', async () => {
    const pair = createFakeTransportPair();
    await pair.A.transport.init({ selfId: 'A', peerId: 'B' });
    const driver = createNetDriver({ transport: pair.A.transport, seat: 0 });
    const s = stateOf();

    // `deactivate()` 是"拔线"：两端转 offline，而**线还能接回来**（`activate()`）
    pair.A.deactivate();
    expect(pair.A.transport.status(), '夹具前提：拔线之后该是 offline').toBe('offline');
    const r = driver.submit(s, SUBMIT_A);
    expect(r.ok === false ? r.refusal : null, '拔线那一格的拒绝码').toBe('offline');
    expect(driver.linkClosed(), '只是掉线（拔线）却说这条链路已经死了 —— 两个读数被合并了').toBe(false);
    expect(driver.lastFailure(), '掉线不该留失败记录（与上一格同源）').toBeNull();
  });

  it('并排：`dispose()` 之后是 `read-only`（本驱动不再收输入），与"链路已死"不是同一件事', async () => {
    const pair = createFakeTransportPair();
    await pair.A.transport.init({ selfId: 'A', peerId: 'B' });
    const driver = createNetDriver({ transport: pair.A.transport, seat: 0 });
    const s = stateOf();

    driver.dispose();
    const r = driver.submit(s, SUBMIT_A);
    expect(r.ok === false ? r.refusal : null, 'dispose 之后的拒绝码该是 read-only（不是 offline）').toBe('read-only');
    // 它顺手关掉了传输 ⇒ 这一位也是真：两件事**同时**成立，但语义不同（一个是"本驱动退休"，
    // 一个是"这条链路回不来"）。把三格摆在一起，读者才看得出新读数补的是哪一格。
    expect(driver.linkClosed(), 'dispose() 会 transport.close()，这一位该是真的').toBe(true);
  });
});
