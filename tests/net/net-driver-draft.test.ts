/**
 * G5 T12 的**轮次闸**行为腿（任务书判据 3）：草稿选牌走驱动之后，"轮到谁"必须**两端各自校验**。
 *
 * ## 为什么这个文件是**新建**的，而不是加进 `tests/net/net-driver.test.ts`
 *
 * 任务书 §2 把 `tests/ui/net-driver.test.ts` 列为**冻结**（那是 T5 的交付物，本轮一个字不许动）。
 * 而判据 3 需要一条**行为腿**："非本回合的草稿提交必须被拒、且**不静默吞**（不产生任何帧）"。
 * 引擎那一半（`performDraftPick` 的相位/池子守卫）在 `tests/app/match-replay.test.ts` 的
 * T12 那一组里有腿；**驱动那一半**（发送方的轮次闸 + 拒码）只有这里能钉。
 *
 * ## 它钉的三件事
 *
 *  1. **非本回合**的草稿提交：`submit` 返回 `{ ok: false, refusal: 'not-the-next-action' }`，
 *     状态一字不动，且**一帧都没发出去**（对端的 `sendSeq` 不变）—— "不静默吞"的那一半；
 *  2. 它**不是**"谁都提交不了"：同一时刻换**轮选者**那一端提交同一条 ⇒ 成功；
 *  3. 提交成功之后，对端 `arm` 一次就把那一条落地 ⇒ 两端指纹逐字相同，且**两端 `appliedSteps`
 *     都恰好 +1**（任务书 §8 第 2 条：草稿动作进来之后两端的进度事实必须仍然一致）。
 *
 * ## 为什么用 `advance` 之外的东西做"另一条动作"
 *
 * 判据 2 那条（"duplicate" 之外的第二半）要证的是"拒的是**轮次**，不是这种 kind"：
 * 同一端、同一个 kind、同一条 `args`，只把**提交的时机**从"不是它的回合"换成"轮到它"，
 * 结果就从拒变过。所以两半用的是**同一条**动作。
 */
import { describe, it, expect } from 'vitest';
import { createNetDriver } from '../../src/net/net-driver';
import type { NetDriver } from '../../src/net/net-driver';
import { createFakeTransportPair } from '../../src/net/fake-transport';
import { createGame, getCurrentDrafter, getDraftPool } from '../../src/core/state/create';
import { stateFingerprint } from '../../src/core/fingerprint';
import { DRAFT_PICK_KIND } from '../../src/app/match-file';
import type { GameState } from '../../src/core/models/types';

/**
 * 两个座位**各一条**腿：`draftStarter = 0`（房主先选）与 `draftStarter = 1`（客人先选）。
 * 只测一个方向的话，"座位判据写反了"会有一半的形态漏掉（那种 bug 在一个方向上恰好正确）。
 */
async function makeDraftPair(seed: string, draftStarter: 0 | 1): Promise<{
  pair: ReturnType<typeof createFakeTransportPair>;
  host: { driver: NetDriver; s: GameState };
  guest: { driver: NetDriver; s: GameState };
}> {
  const pair = createFakeTransportPair();
  await pair.A.transport.init({ selfId: 'A', peerId: 'B' });
  await pair.B.transport.init({ selfId: 'B', peerId: 'A' });
  const hostState = createGame({ seed, draftStarter });
  const guestState = createGame({ seed, draftStarter });
  const host = { driver: createNetDriver({ transport: pair.A.transport, seat: 0 as const }), s: hostState };
  const guest = { driver: createNetDriver({ transport: pair.B.transport, seat: 1 as const }), s: guestState };
  host.driver.arm(hostState);
  guest.driver.arm(guestState);
  return { pair, host, guest };
}

describe('G5 T12 · 草稿的轮次闸（判据 3）：两端各自校验同一规则，拒的时候不静默吞', () => {
  for (const draftStarter of [0, 1] as const) {
    it(`★ draftStarter=${draftStarter}：非轮选者提交 ⇒ not-the-next-action、状态不动、一帧不发`, async () => {
      const { pair, host, guest } = await makeDraftPair(`g5t12-gate-${draftStarter}`, draftStarter);
      const owner = getCurrentDrafter(host.s);
      expect(owner, '反空转：这一局的轮选者必须是 draftStarter 派生的那一个').toBe(draftStarter);
      expect(host.s.phase, '这一局必须停在草稿相（否则下面比的不是草稿的闸）').toBe('draft');
      const wrong = owner === 0 ? guest : host;
      const right = owner === 0 ? host : guest;
      const defId = getDraftPool(host.s)[0].defId;
      const action = { player: owner, kind: DRAFT_PICK_KIND as 'draft-pick', args: { defId } };
      const beforeFp = stateFingerprint(wrong.s);
      const framesBefore = pair.B.sendSeq();
      const framesBeforeA = pair.A.sendSeq();
      // —— ① 非轮选者提交：**必须被拒**（拒码是"不是下一条该做的事"，不是"离线"也不是"只读"）
      const refused = wrong.driver.submit(wrong.s, action);
      expect(refused.ok, '非轮选者的草稿提交竟然放行了（轮次闸没在工作）').toBe(false);
      expect(refused.refusal, `拒码：${String(refused.refusal)}`).toBe('not-the-next-action');
      expect(stateFingerprint(wrong.s), '被拒之后状态必须一字不动').toBe(beforeFp);
      // ★ "不静默吞"的那一半：它**一帧都没发**（`pair.A/B` 的线序各自不变）
      expect(pair.B.sendSeq(), 'B 侧（加入方）的线序').toBe(framesBefore);
      expect(pair.A.sendSeq(), 'A 侧（房主）的线序').toBe(framesBeforeA);
      expect(wrong.driver.appliedSteps(), '被拒的一方自己的进度事实').toBe(0);
      // —— ② 反空转：同一时刻换**轮选者**提交同一条 ⇒ 成功（否则上面那条只是"谁都提交不了"）
      const ok = right.driver.submit(right.s, action);
      expect(ok.ok, `轮选者提交同一条被拒：${String(ok.refusal)}`).toBe(true);
      expect(right.s.draftPicks.map((p) => p.defId), '轮选者那一侧的草稿真的往前走了一步').toEqual([defId]);
      expect(right.driver.appliedSteps(), '轮选者那一侧的进度事实').toBe(1);
      // —— ③ 对端 `arm` 一次就把那一条落地 ⇒ 两端指纹逐字相同、进度事实也相同
      pair.pump(2);
      wrong.driver.arm(wrong.s);
      expect(stateFingerprint(wrong.s), '对端没有把那一帧落地（两端分叉）').toBe(stateFingerprint(right.s));
      expect(wrong.driver.appliedSteps(), '对端的进度事实必须与提交方一样').toBe(1);
      expect(wrong.driver.lastFailure(), '这条路上不该有任何失败').toBeNull();
      expect(right.driver.lastFailure(), '提交方那条路上不该有任何失败').toBeNull();
      expect(wrong.s.draftPicks.map((p) => p.defId), '两端选出来的是同一个 defId').toEqual([defId]);
    });
  }

  it('★ 轮次真的会换人（1-2-2-1）：第 2 轮换到座位 1、第 3 轮换回座位 0，抢选一律被拒', async () => {
    const { pair, host, guest } = await makeDraftPair('g5t12-gate-repeat', 0);
    const pool = getDraftPool(host.s).map((p) => p.defId);
    // 第 1 轮：座位 0（`draftStarter`）
    expect(getCurrentDrafter(host.s), '第 1 轮').toBe(0);
    expect(host.driver.submit(host.s, { player: 0, kind: DRAFT_PICK_KIND, args: { defId: pool[0] } }).ok).toBe(true);
    // ⚠️ 座位 1 要提交**必须先拿到那一帧**（它不持有状态：帧先入队，`arm` 才落地）——
    //    这正是 G4 D2 那条结构约束在测试里的形状，漏了它这条腿会红在一个**夹具**问题上。
    pair.pump(2);
    guest.driver.arm(guest.s);
    expect(stateFingerprint(guest.s), '夹具：两端必须同步到同一帧').toBe(stateFingerprint(host.s));
    // 第 2 轮：**换成座位 1**（1-2-2-1 的第二个位置）
    expect(getCurrentDrafter(host.s), '第 2 轮').toBe(1);
    // 此刻座位 0 抢选 ⇒ 必须被拒、状态不动、一帧不发
    const beforeFp = stateFingerprint(host.s);
    const framesBefore = pair.A.sendSeq();
    const refused = host.driver.submit(host.s, { player: 0, kind: DRAFT_PICK_KIND, args: { defId: pool[1] } });
    expect(refused.ok, '第 2 轮里座位 0 抢选竟然放行了（轮次闸没跟着轮次走）').toBe(false);
    expect(refused.refusal).toBe('not-the-next-action');
    expect(stateFingerprint(host.s), '被拒之后状态必须一字不动').toBe(beforeFp);
    expect(pair.A.sendSeq(), '它一帧都没发出去').toBe(framesBefore);
    // 正控：座位 1 提交同一条 ⇒ 成功（证明上面拒的是**轮次**，不是"这个 kind 谁都提交不了"）
    const guestOk = guest.driver.submit(guest.s, { player: 1, kind: DRAFT_PICK_KIND, args: { defId: pool[1] } });
    expect(guestOk.ok, `座位 1 提交被拒：${String(guestOk.refusal)}`).toBe(true);
    // 第 3 轮：**仍是座位 1**（1-2-2-1 的第三位置也是 1）—— 顺手钉住"连续两轮同一人"
    expect(getCurrentDrafter(guest.s), '第 3 轮').toBe(1);
  });
});
