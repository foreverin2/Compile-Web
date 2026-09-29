/**
 * G6 **T46**：选协议那一屏上那一行"当前连接：直连 / 经中继 / 建立中…"。
 *
 * ## 这个文件钉的三半（缺哪一半都会让那一行变成装饰）
 *
 *  1. **分类**（`readRelayStats`）：从一份 `RTCStatsReport` 里挑出"被提名且已成功"的候选对，
 *     看两端 `candidateType` 有没有 `relay`。**真值是 `getStats()`**，不是"我们以为走了哪条路"。
 *  2. **文案三值**（`netConnText`）：`直连` / `经中继` / `建立中…` 三个**字面**，且
 *     "拿不到"那一档**不许**落到"直连"（任务书 §1 的原话：不许猜成直连）。
 *  3. **宿主接线**（`src/main.ts` 的源码腿）：那一行只在**联机局 + 草稿相**产出，
 *     并且在非联机那一支被收掉（否则会在别的屏上留一个带计时器的陈旧浮层）。
 *
 * ## 诚实边界
 *
 * 本文件**不**证明"真机的 ICE 链路在屏上长什么样"（那要真 `RTCPeerConnection`）——
 * 那一条由 `.superpowers/g6-T46/` 里那次真浏览器读数负责（两个窗口 + 强制只走中继）。
 * 这里证的只是**分类与接线**：读数换一份 → 屏上那一句跟着换，且三值与字面一一对应。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { installStubDom, makeStubEl } from './net-dom-stub';
import { functionBody, stripComments } from './source-text';
import {
  RELAY_CANDIDATE_TYPE,
  pendingRelayRead,
  readRelayStats,
  readRelayStatsOf,
  type PeerConnectionLike,
  type RTCStatsReportLike,
} from '../../src/ui/net-browser';
import { NET_CONN_LINE_CLASS, netConnText, startNetConnLine } from '../../src/ui/net-conn-line';

let restoreDom: (() => void) | null = null;

afterEach(() => {
  restoreDom?.();
  restoreDom = null;
});

/* ==================================================================== *
 * 夹具：一份**真形状**的 `RTCStatsReport`（Map：`forEach(entry)`）
 * ==================================================================== */

/** 一条候选（`local-candidate` / `remote-candidate`）的统计条目 */
const cand = (id: string, candidateType: string): Record<string, unknown> => ({
  id, type: id.startsWith('L') ? 'local-candidate' : 'remote-candidate', candidateType,
});

/** 一对候选（`candidate-pair`）的统计条目 */
const pair = (
  id: string, localId: string, remoteId: string, state: string, nominated: boolean,
): Record<string, unknown> => ({
  id, type: 'candidate-pair', localCandidateId: localId, remoteCandidateId: remoteId, state, nominated,
});

/** 把一串条目包成 `RTCStatsReport` 的最小结构面（只有 `forEach`，与 `RTCStatsReportLike` 同形） */
const report = (...entries: readonly Record<string, unknown>[]): RTCStatsReportLike => ({
  forEach(cb: (entry: Record<string, unknown>) => void): void { for (const e of entries) cb(e); },
});

/* ==================================================================== *
 * 判据 1：分类（两种形态都能读出来，且"建立中"那一档不会被猜成"直连"）
 * ==================================================================== */

describe('★★ G6 T46 · 判据 1：从 getStats() 那份报告里读出"直连 / 经中继 / 建立中"', () => {
  it('两端都不是 relay ⇒ 直连（读数逐字贴出）', () => {
    const r = readRelayStats(report(cand('L1', 'host'), cand('R1', 'srflx'), pair('P1', 'L1', 'R1', 'succeeded', true)));
    expect(r.kind, `候选对读数 ${JSON.stringify(r)} 应判成直连`).toBe('direct');
    expect(r.localCandidateType).toBe('host');
    expect(r.remoteCandidateType).toBe('srflx');
    expect(r.pairId).toBe('P1');
  });

  it('本地一侧是 relay ⇒ 经中继', () => {
    const r = readRelayStats(report(cand('L1', 'relay'), cand('R1', 'host'), pair('P1', 'L1', 'R1', 'succeeded', true)));
    expect(r.kind, `候选对读数 ${JSON.stringify(r)} 应判成经中继`).toBe('relay');
    expect(r.localCandidateType).toBe(RELAY_CANDIDATE_TYPE);
  });

  it('远端一侧是 relay ⇒ 经中继（任一侧就够）', () => {
    const r = readRelayStats(report(cand('L1', 'srflx'), cand('R1', 'relay'), pair('P1', 'L1', 'R1', 'succeeded', true)));
    expect(r.kind, `候选对读数 ${JSON.stringify(r)} 应判成经中继`).toBe('relay');
    expect(r.remoteCandidateType).toBe(RELAY_CANDIDATE_TYPE);
  });

  it('只有"未提名"或"没成功"的候选对 ⇒ 建立中（**不许**猜成直连）', () => {
    const notNominated = readRelayStats(
      report(cand('L1', 'host'), cand('R1', 'host'), pair('P1', 'L1', 'R1', 'succeeded', false)),
    );
    expect(notNominated.kind, '未提名的候选对被当成了结论').toBe('pending');
    const notSucceeded = readRelayStats(
      report(cand('L1', 'relay'), cand('R1', 'relay'), pair('P1', 'L1', 'R1', 'in-progress', true)),
    );
    expect(notSucceeded.kind, '没有 succeeded 的候选对被当成了结论（这一格正是"猜"的入口）')
      .toBe('pending');
    const empty = readRelayStats(report());
    expect(empty.kind, '空报告被当成了结论').toBe('pending');
    expect(empty).toEqual(pendingRelayRead());
  });

  it('候选条目缺失 / 字段类型不对 ⇒ 建立中（读不出来就如实说读不出来）', () => {
    // 候选对指着一条**不在报告里**的候选（真件上不该发生；发生了就不许猜）
    const missing = readRelayStats(report(pair('P1', 'L9', 'R9', 'succeeded', true)));
    expect(missing.kind, '候选对指向不存在的候选时仍给出了结论').toBe('pending');
    // 字段类型不对（`nominated` 是字符串 / `state` 不是字符串）
    const badTypes = readRelayStats(report({
      id: 'P1', type: 'candidate-pair', localCandidateId: 'L1', remoteCandidateId: 'R1',
      state: 1, nominated: 'true',
    }));
    expect(badTypes.kind, '字段类型不对时仍给出了结论').toBe('pending');
  });

  it('多对里挑"被提名且已成功"的那一对（挑错就会把没在用的那条路当成结论）', () => {
    const r = readRelayStats(report(
      cand('L1', 'host'), cand('R1', 'host'),
      cand('L2', 'relay'), cand('R2', 'relay'),
      pair('P1', 'L1', 'R1', 'succeeded', false), // 曾经成功、现在没在用
      pair('P2', 'L2', 'R2', 'succeeded', true),  // 此刻在用
    ));
    expect(r.kind, '挑的不是被提名的那一对').toBe('relay');
    expect(r.pairId).toBe('P2');
  });
});

/* ==================================================================== *
 * 判据 6：文案三值的**字面**（光有字面腿不算数，主证据是判据 1 的真机读数）
 * ==================================================================== */

describe('★★ G6 T46 · 判据 6：三个字面（直连 / 经中继 / 建立中）', () => {
  it('三值 → 三句，且互不相同', () => {
    expect(netConnText('direct')).toBe('当前连接：直连');
    expect(netConnText('relay')).toBe('当前连接：经中继');
    expect(netConnText('pending')).toBe('当前连接：建立中…');
    const all = [netConnText('direct'), netConnText('relay'), netConnText('pending')];
    expect(new Set(all).size, '三句文案有重复（那是把三件事说成一件）').toBe(3);
  });

  it('反空转：`pending` 那一句**不含**"直连"（不许把"还不知道"写成"直连"）', () => {
    expect(netConnText('pending'), '`建立中` 那一句里出现了"直连"')
      .not.toContain('直连');
    expect(netConnText('relay'), '`经中继` 那一句里出现了"直连"').not.toContain('直连');
  });
});

/* ==================================================================== *
 * 判据 3 的机检那一半：它是个**脱离文档流**的浮层（不可能挤走别的组件）
 * ==================================================================== */

describe('★★ G6 T46 · 判据 3：那一行不占流（position: fixed + pointer-events: none）', () => {
  it('产出节点挂的就是那一族行内样式，且是 `nowrap` 的一行', () => {
    restoreDom = installStubDom();
    const root = makeStubEl('div');
    const h = startNetConnLine({
      root: root as unknown as HTMLElement,
      peerConnection: () => null,
      doc: globalThis.document,
      timer: { setInterval: () => 1, clearInterval: () => {} },
    });
    const line = root.children[0];
    expect(line, '那一行没有挂到 root 上').toBeTruthy();
    expect(line.cls, '类名不是唯一那一个').toContain(NET_CONN_LINE_CLASS);
    // ⚠️ `getAttribute` 不在 `StubNode` 的显式成员里（它在索引签名里 ⇒ 类型是 `unknown`）
    //    ⇒ 这里按"它真的有这个方法"取一次（桩的 R19 补丁确实记了非 `data-` 属性）
    const reader = line as unknown as { getAttribute(name: string): string | null };
    const style = String(reader.getAttribute('style') ?? '');
    for (const decl of ['position: fixed', 'pointer-events: none', 'white-space: nowrap']) {
      expect(style, `那一行的行内样式里没有 \`${decl}\`（不占流 / 不抢点击这几条就没了机检）`).toContain(decl);
    }
    // 建出来时**先不显示**（`getStats()` 是异步的；先闪一个形态会被当成结论）
    expect(style, '那一行建出来就是可见的 ⇒ 第一次读出来之前会在屏上闪一个没根据的形态')
      .toContain('display: none');
    h.dispose();
  });
});

/* ==================================================================== *
 * 判据 4 的机检那一半：读数是**每次重读**的（换一份报告 ⇒ 屏上那一句跟着换）
 * ==================================================================== */

describe('★★ G6 T46 · 判据 4：那一行跟着"此刻这条连接"变（不是写死的）', () => {
  /** 一条假连接：`getStats()` 回**此刻**那一份报告（测试可以在两次读之间换掉它） */
  const fakePc = (get: () => RTCStatsReportLike): PeerConnectionLike => ({
    createDataChannel: () => { throw new Error('本用例不走通道'); },
    createOffer: async () => ({ type: 'offer' }),
    setLocalDescription: async () => {},
    close: () => {},
    addEventListener: () => {},
    getStats: async () => get(),
  });

  it('同一条连接换掉报告：先"直连"后"经中继"（重连换了链路就是这一格）', async () => {
    let current = report(cand('L1', 'host'), cand('R1', 'srflx'), pair('P1', 'L1', 'R1', 'succeeded', true));
    const pc = fakePc(() => current);
    const a = await readRelayStatsOf(pc);
    expect(a.read.kind, '第一次读该是直连').toBe('direct');
    expect(a.note, '读得出来时不该有人话解释（那是"读不出来"才有的）').toBeNull();
    // ★ 链路换掉（真机上就是 `restartIce()` 之后中继那一对被提名）
    current = report(cand('L9', 'relay'), cand('R9', 'relay'), pair('P9', 'L9', 'R9', 'succeeded', true));
    const b = await readRelayStatsOf(pc);
    expect(b.read.kind, '换了报告之后还报旧那个形态 ⇒ 这一行是写死的').toBe('relay');
    expect(b.read.pairId, '两次读到的是同一对 ⇒ 没有真的重读').not.toBe(a.read.pairId);
  });

  it('三种"读不出来"各自如实收口：没有 pc / 没有 getStats / getStats 抛了', async () => {
    const noPc = await readRelayStatsOf(null);
    expect(noPc.read.kind).toBe('pending');
    expect(noPc.note, '没有 pc 时没人话解释').toBeTruthy();
    const noStats: PeerConnectionLike = {
      createDataChannel: () => { throw new Error('不用'); },
      createOffer: async () => ({ type: 'offer' }),
      setLocalDescription: async () => {},
      close: () => {},
      addEventListener: () => {},
    };
    const r1 = await readRelayStatsOf(noStats);
    expect(r1.read.kind, '这条连接没有 getStats 时给出了结论').toBe('pending');
    const throwing = fakePc(() => { throw new Error('连接已经关掉了'); });
    const r2 = await readRelayStatsOf(throwing);
    expect(r2.read.kind, 'getStats() 抛了之后给出了结论').toBe('pending');
    expect(r2.note ?? '', '抛了之后没有人话解释').toContain('读连接统计失败');
  });
});

/* ==================================================================== *
 * 判据（评审扣项）：轮询必须真的收口 —— 自保那一层 + 宿主那一层
 * ==================================================================== */

describe('★★ G6 T46 评审扣项：节点没了 ⇒ 轮询自己停（自保那一层）', () => {
  /**
   * 假计时器：只**记下**回调与句柄，谁都不真的跑 —— 于是"排了几次、清了几次"可数。
   * （不用 `vi.useFakeTimers()`：本仓既有测试都用这种手写件，形状更小、也不受全局影响。）
   */
  const fakeTimer = () => {
    const state: { fns: Array<() => void>; next: number; cleared: number[] } = { fns: [], next: 1, cleared: [] };
    return {
      state,
      timer: {
        setInterval: (fn: () => void): number => { state.fns.push(fn); return state.next++; },
        clearInterval: (h: number): void => { state.cleared.push(h); },
      },
    };
  };
  /** 让被 `void` 掉的 promise 链跑完（`readRelayStatsOf` 是异步的） */
  const flush = (): Promise<void> => new Promise((r) => { setTimeout(r, 0); });

  it('节点被抹掉（`root.textContent = \'\'` 那一族）之后：清计时器 + **不再读 getStats()**', async () => {
    restoreDom = installStubDom();
    const root = makeStubEl('div');
    let calls = 0;
    const pc = {
      createDataChannel: () => { throw new Error('本用例不走通道'); },
      createOffer: async () => ({ type: 'offer' }),
      setLocalDescription: async () => {},
      close: () => {},
      addEventListener: () => {},
      getStats: async () => {
        calls += 1;
        return report(cand('L1', 'host'), cand('R1', 'host'), pair('P1', 'L1', 'R1', 'succeeded', true));
      },
    };
    const ft = fakeTimer();
    const h = startNetConnLine({
      root: root as unknown as HTMLElement,
      peerConnection: () => pc,
      doc: globalThis.document,
      timer: ft.timer,
    });
    await flush();
    expect(calls, '第一帧那一次读没发生 ⇒ 本用例的前提不成立').toBe(1);
    expect(ft.state.fns.length, '轮询没排上').toBe(1);

    // ★ 模拟"渲染器整帧重画"：`renderNetBoard()` 的 `root.textContent = ''` 把这一行连同它的
    //   父指针一起抹掉（本仓的桩用 `remove()` 表达这一件事，父指针归 null）
    (root.children[0] as unknown as { remove(): void }).remove();
    ft.state.fns[0]();          // 下一个轮询周期
    await flush();
    expect(calls, '节点已经不在文档里，却还去读了 getStats()（评审读数：进对局相后 6 秒 +6 次）')
      .toBe(1);
    expect(ft.state.cleared, '轮询计时器没被清掉（整局一直在跑）').toEqual([1]);
    h.dispose(); // 幂等：再收一次不该再清一个计时器
    expect(ft.state.cleared, 'dispose() 不幂等（第二次又清了计时器）').toEqual([1]);
  });

  it('节点还在时照常工作：显示那一句、轮询继续（反空集合）', async () => {
    restoreDom = installStubDom();
    const root = makeStubEl('div');
    let calls = 0;
    const pc = {
      createDataChannel: () => { throw new Error('本用例不走通道'); },
      createOffer: async () => ({ type: 'offer' }),
      setLocalDescription: async () => {},
      close: () => {},
      addEventListener: () => {},
      getStats: async () => {
        calls += 1;
        return report(cand('L1', 'relay'), cand('R1', 'relay'), pair('P1', 'L1', 'R1', 'succeeded', true));
      },
    };
    const ft = fakeTimer();
    startNetConnLine({
      root: root as unknown as HTMLElement,
      peerConnection: () => pc,
      doc: globalThis.document,
      timer: ft.timer,
    });
    await flush();
    expect(root.children[0].text, '屏上那一句不是三值里那一句').toBe('当前连接：经中继');
    expect(ft.state.cleared, '节点还在就自己停了轮询（过度收口）').toEqual([]);
    ft.state.fns[0]();
    await flush();
    expect(calls, '节点还在时轮询没继续读（那一行不会跟着链路变）').toBe(2);
  });
});

/* ==================================================================== *
 * 判据 1/3 的产出方那一半：宿主只在**联机局 + 草稿相**画它，并在别处收掉
 * ==================================================================== */

describe('★★ G6 T46 · 宿主那一半（`src/main.ts`，node 里 import 不了）', () => {
  const MAIN = stripComments(
    readFileSync(fileURLToPath(new URL('../../src/main.ts', import.meta.url)))
      .subarray(0, 16 * 1024 * 1024).toString('utf8'),
  );

  it('`appendNetConnLine()` 的三个前置：不是联机局不画、不是草稿相不画、真要读那条连接', () => {
    const body = functionBody(MAIN, 'appendNetConnLine');
    expect(body.length, '`appendNetConnLine` 的函数体太短 ⇒ 这条腿假绿').toBeGreaterThan(150);
    expect(body, '没有"不是联机局就不画"的早退（热座页会多出一行）').toContain('netGame === null');
    expect(body, '没有"只在草稿相画"那个守卫（对局相会多出一行）').toContain("state.phase !== 'draft'");
    expect(body, '没有从传输上取那条连接（真值来源就断了）').toContain('peerConnectionOf(transport)');
    expect(body, '没有把活交给 `src/ui/net-conn-line.ts` 的 `startNetConnLine`')
      .toContain('startNetConnLine(');
    expect(body, '第一句不是先把上一帧那个句柄收掉 ⇒ 每帧都会叠一个轮询计时器')
      .toContain('disposeNetConnLine()');
  });

  it('只在草稿相那一支调它，且在 `renderApp(...)` 之后（那一屏是红线文件画的，只能补浮层）', () => {
    const rr = functionBody(MAIN, 'rerender');
    const app = rr.indexOf('renderApp(root, state, cb);');
    expect(app, 'rerender 里找不到 `renderApp(root, state, cb);`（结构被改了？）').toBeGreaterThanOrEqual(0);
    expect(rr.slice(app, app + 900), '草稿相那一支没有画那一行').toContain('appendNetConnLine(root)');
    // 对局相那一支（`renderNetBoard` 到 `return;`）里**不许**出现它
    const net = rr.indexOf('renderNetBoard(');
    expect(net).toBeGreaterThanOrEqual(0);
    expect(rr.slice(net, rr.indexOf('appendTurnLine(root);', net)), '对局相那一支也画了那一行')
      .not.toContain('appendNetConnLine(root)');
  });

  it('★ 收口在**所有早退分支之前**（G6/T46 评审扣项：写在尾部时对局相/大厅两条早退根本走不到）', () => {
    const rr = functionBody(MAIN, 'rerender');
    const calls = (rr.match(/disposeNetConnLine\(\)/g) ?? []).length;
    expect(calls, `rerender 里 disposeNetConnLine() 出现 ${calls} 处（应为恰好 1：一处无条件收口）`).toBe(1);
    const iDispose = rr.indexOf('disposeNetConnLine()');
    /** 三条早退：对局相 / 大厅 / `return`（`renderNetBoard` 与 `renderLobbyFrame` 那两支各自 return） */
    const firstReturn = rr.indexOf('renderNetBoard(');
    const lobby = rr.indexOf('renderLobbyFrame();');
    expect(firstReturn, 'rerender 里找不到 renderNetBoard(（结构被改了？）').toBeGreaterThanOrEqual(0);
    expect(lobby, 'rerender 里找不到 renderLobbyFrame();（结构被改了？）').toBeGreaterThanOrEqual(0);
    expect(iDispose, '收口排在对局相那条早退**之后** ⇒ 那条路永远走不到它（评审实测：轮询整局在跑）')
      .toBeLessThan(firstReturn);
    expect(iDispose, '收口排在大厅那条早退之后 ⇒ 大厅里那一行的轮询不会停').toBeLessThan(lobby);
    // 反空集合：草稿相仍然真的把它建出来（只有"建成那一半"才谈得上收口）
    expect(rr, '草稿相那一支不再产出那一行了（本组的另一半前提没了）').toContain('appendNetConnLine(root)');
    const dispose = functionBody(MAIN, 'disposeNetConnLine');
    expect(dispose, '`disposeNetConnLine` 不是幂等的（没有把句柄置空）').toContain('netConnLine = null');
  });

  it('★ 红线未被碰：`src/ui/render.ts` 里没有本轮任何一个名字', () => {
    const RENDER = stripComments(
      readFileSync(fileURLToPath(new URL('../../src/ui/render.ts', import.meta.url)))
        .subarray(0, 16 * 1024 * 1024).toString('utf8'),
    );
    for (const forbidden of ['netConnText', 'net-conn-line', 'NET_CONN_LINE_CLASS', '当前连接：']) {
      expect(RENDER, `render.ts（红线）里出现了本轮的东西「${forbidden}」`).not.toContain(forbidden);
    }
    // 反空集合：那一屏的横幅仍在它手里（说明我们没"顺手"把它搬走）
    expect(RENDER, 'render.ts 的草稿横幅不见了（红线文件被改了？）').toContain('选择协议 · 本轮还可选');
  });
});
