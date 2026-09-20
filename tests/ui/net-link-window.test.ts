/**
 * G5 T13-C 判据 1：**300s 窗口的三值在屏上各说各的话，而且超窗不自动结束对局**（D8）。
 *
 * ## 这条腿的输入是**真会话的读数**，不是手写的状态对象
 *
 * 三值里的 `false` / `true` 由 `NetSession` 用**注入的时钟**真算出来（`src/net` 不许读时钟，
 * D8 的 2026-09-18 补充裁决），`null` 由**不注入时钟**的那一份会话真给出来 —— 于是这一条
 * 腿证明的是"读数 → 屏上那一句"这条链，而不是"我手写了三个对象、屏按我写的画"。
 *
 * ## 三条纪律
 *
 *  1. **`null`（判不了）不许说"超窗"**：屏上那一句必须仍然是"判不了"那一格，
 *     并且**不许**出现"已经超过宽限期 / 只能重开"这类**结论性**说法（那是我们并不知道的事）；
 *  2. **`false` / `true` 各有各的那一句**，而且都来自 `LOBBY_LINK_COPY` 那张唯一映射表
 *     （屏上手写第二句就会在这里红）；
 *  3. **超窗不自动结束对局**（D8：超窗只是"不许再追平"）：时钟推过 300s 之后，
 *     会话的相位、承诺结论、种子都还在，链路**没有**被关、驱动**没有**被 dispose、
 *     `lastFailure()` 仍是 null、步数一步没动 —— 这一格要是被实现成"超窗就把对局结束掉"，
 *     下面那组断言会红（变异 M2）。
 *
 * 窗口长度的出处是 `DEFAULT_RECONNECT_WINDOW_MS = 300_000`（D8 / 设计稿 `:505`）；
 * 本文件不重写这个常量，只把它当"边界外一点点"的推进入参用。
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  descendants, installStubDom, makeStubEl, queryAllIn, type StubNode,
} from './net-dom-stub';
import {
  LOBBY_LINK_COPY, createLobbyClient, errorCopy, linkRecoveryNotice, lobbyLinkOf, lobbyLinkText,
  qrNote, renderNetLobby,
  type LobbyClient, type LobbyErrorKey, type LobbyRenderNav, type LobbyState, type LobbyTicker,
  type SettingKey,
} from '../../src/ui/net-lobby';
import { createFakeTransportPair } from '../../src/net/fake-transport';
import { createNetDriver } from '../../src/net/net-driver';
import type { ClockLike, PeerStatus } from '../../src/net/session';
import type { NetTransport } from '../../src/net/transport';
import { PROTO_VERSION } from '../../src/net/protocol';
import { CARD_DATA_HASH } from '../../src/app/card-data-hash';
import { browserHash, inviteLengthReport } from '../../src/ui/net-browser';
import { createGame } from '../../src/core/state/create';

/* ==================================================================== *
 * 夹具
 * ==================================================================== */

let restoreDom: (() => void) | null = null;

afterEach(() => {
  restoreDom?.();
  restoreDom = null;
});

/** 一个**测试自己推进**的时钟（窗口的唯一时间来源；`src/net` 不许读时钟） */
function fakeClock(): { clock: ClockLike; advance(ms: number): void } {
  let t = 1_700_000_000_000;
  return { clock: { now: () => t }, advance: (ms: number) => { t += ms; } };
}

function fakeTicker(): LobbyTicker {
  let h = 0;
  return { schedule: () => { h += 1; return h; }, cancel: () => { /* 不排真时钟 */ } };
}

/**
 * 一个加入方 / 房主的大厅客户端。
 *
 * ⚠️ **`chooseFace` 刻意不注入**：这一份夹具要的是"握手能自己走完"（常量面 0，T11-B 之前那套），
 * 于是"窗口三值"这条判据不被硬币屏那条路的异步 resolve 干扰。
 */
function makeSide(
  role: 'host' | 'guest',
  transport: NetTransport,
  extra: { readonly clock?: ClockLike } = {},
): LobbyClient {
  let n = 0;
  return createLobbyClient({
    role,
    sessionId: 'sid-t13c-window',
    matchSeed: 'mseed-t13c-window',
    randomToken: () => `rtok-t13c-window-${String(n++)}`,
    localProtoVersion: PROTO_VERSION,
    localCardDataHash: CARD_DATA_HASH,
    hash: browserHash(),
    ticker: fakeTicker(),
    createTransport: () => transport,
    signalingEndpoint: '',
    readSettings: () => ({ turnUrl: '', turnUsername: '', turnCredential: '' }),
    buildInvite: async () => ({ ok: true as const, payload: 'P', link: 'https://example.test/#invite=P' }),
    decompressBase64: async () => null,
    readAddressBar: () => null,
    localNick: () => (role === 'host' ? '房主' : '加入方'),
    hasResumableGame: () => true,
    ...extra,
  });
}

function settle(
  pair: ReturnType<typeof createFakeTransportPair>,
  a: LobbyClient,
  b: LobbyClient,
  rounds = 24,
): void {
  for (let i = 0; i < rounds; i += 1) {
    pair.pump(1);
    a.drive();
    b.drive();
  }
}

interface Mount {
  root: StubNode;
  render(s: LobbyState): void;
}

/** 用**真渲染器**（`renderNetLobby`）在 DOM 桩上画一帧 */
function mount(): Mount {
  restoreDom = installStubDom();
  const root = makeStubEl('div');
  const nav = (s: LobbyState): LobbyRenderNav => ({
    state: s,
    backHome: () => { /* 本文件不点它 */ },
    startHost: () => { /* 本文件不点它 */ },
    startJoin: () => { /* 本文件不点它 */ },
    makeInvite: () => { /* 本文件不点它 */ },
    inviteLength: (payload: string) => {
      const r = inviteLengthReport(payload);
      return `长度 ${r.chars} 落在区间=${String(r.withinMeasuredRange)}`;
    },
    qrNote: () => qrNote(),
    setRoomCode: () => { /* 本文件不点它 */ },
    submitRoomCode: () => { /* 本文件不点它 */ },
    joinWithInvite: () => { /* 本文件不点它 */ },
    toggleAdvanced: () => { /* 本文件不点它 */ },
    toggleRelay: () => { /* 本文件不点它 */ },
    settingsValue: (_k: SettingKey) => '',
    setSetting: () => { /* 本文件不点它 */ },
    errorText: (k: LobbyErrorKey) => errorCopy(k),
    makeAnswerCode: () => { /* 本文件不点它 */ },
    applyAnswerCode: () => { /* 本文件不点它 */ },
  });
  return {
    root,
    render: (s) => { renderNetLobby(root as unknown as HTMLElement, nav(s)); },
  };
}

/** 屏上那一行连接状态（`renderNetLobby` 的第 4 块）的正文 */
function linkLineOf(root: StubNode): string {
  const hits = queryAllIn(root, '.net-lobby-link');
  expect(hits.length, `屏上应有恰好一行 .net-lobby-link（实际 ${hits.length} 行）`).toBe(1);
  return hits[0].text;
}

function textOf(root: StubNode): string {
  return descendants(root).map((n) => n.text).join('\n');
}

/** 把一对客户端走到"这一局已经打起来"（承诺校验通过 = 握手走到了 complete） */
async function readyPair(clock?: ClockLike): Promise<{
  pair: ReturnType<typeof createFakeTransportPair>;
  host: LobbyClient;
  guest: LobbyClient;
}> {
  const pair = createFakeTransportPair();
  const opt = clock === undefined ? {} : { clock };
  const host = makeSide('host', pair.A.transport, opt);
  const guest = makeSide('guest', pair.B.transport, opt);
  await host.connect('first');
  await guest.connect('first');
  settle(pair, host, guest);
  expect(guest.commitmentVerified(), '反空转：这一局没走到承诺校验通过（夹具没把流程走起来）').toBe(true);
  return { pair, host, guest };
}

/* ==================================================================== *
 * 判据 1：三值
 * ==================================================================== */

describe('★★ G5 T13-C 判据 1：300s 窗口三值（判不了 / 窗口内 / 超窗）各自的那一句', () => {
  it('注入时钟 ⇒ 窗口内是 `false`、推过 300s 是 `true`；不注入 ⇒ `null`（判不了）', async () => {
    const withClock = fakeClock();
    const a = await readyPair(withClock.clock);
    expect(a.guest.state().peer?.windowExpired, '注入时钟 + 刚说过话 ⇒ 该是 false（在窗口内）').toBe(false);

    // 拔线（可逆）之后仍在窗口内：这一格必须还是 false，而不是"超窗"
    a.pair.B.deactivate();
    a.guest.sync();
    expect(a.guest.state().peer?.windowExpired, '拔线那一刻仍在宽限期内 ⇒ 该是 false').toBe(false);

    // 推过 300s（D8 的边界口径是 `> window`；这里多推 1ms 就是"边界外"）
    withClock.advance(300_001);
    a.guest.sync();
    const expired = a.guest.state().peer;
    expect(expired?.windowExpired, '推过 300s 之后该是 true（超窗）').toBe(true);

    // 不注入时钟的那一份：同一个位置必须是 `null`（判不了），不是 false、也不是 true
    const noClock = await readyPair();
    noClock.pair.B.deactivate();
    noClock.guest.sync();
    expect(noClock.guest.state().peer?.windowExpired, '没注入时钟却说得出窗口结论（那是假读数）').toBeNull();
  });

  it('屏上那一句来自唯一映射表，且 `null` 那一格**不说"超窗"**（判据 1 的第一半）', async () => {
    const withClock = fakeClock();
    const a = await readyPair(withClock.clock);
    a.pair.B.deactivate();
    a.guest.sync();
    const livePeer = a.guest.state().peer as PeerStatus;
    expect(lobbyLinkOf(livePeer), '窗口内那一格的键').toBe('offline-window-live');

    withClock.advance(300_001);
    a.guest.sync();
    const expiredPeer = a.guest.state().peer as PeerStatus;
    expect(lobbyLinkOf(expiredPeer), '超窗那一格的键').toBe('offline-window-expired');

    const noClock = await readyPair();
    noClock.pair.B.deactivate();
    noClock.guest.sync();
    const unknownPeer = noClock.guest.state().peer as PeerStatus;
    expect(lobbyLinkOf(unknownPeer), '判不了那一格的键').toBe('offline-window-unknown');

    const live = LOBBY_LINK_COPY['offline-window-live'];
    const expired = LOBBY_LINK_COPY['offline-window-expired'];
    const unknown = LOBBY_LINK_COPY['offline-window-unknown'];
    // 三句两两不同（合并任意两句就是"把两件不同的事说成一件"）
    expect(new Set([live, expired, unknown]).size, '三格的文案有重复（读数不同、话却一样）').toBe(3);
    // `null` 那一格：只说"判不了"，**不许**给结论
    expect(unknown, '判不了那一格没有说"判不了"').toContain('判不了');
    for (const conclusion of ['已经超过', '不能再接着打', '只能重开', '超过了宽限期']) {
      expect(unknown, `判不了那一格竟然说了"${conclusion}"（那是我们并不知道的事）`).not.toContain(conclusion);
    }
    // `false` / `true` 两格各说各的（窗口内说"还没过"、超窗说"已经超过"）
    expect(live, '窗口内那一格没说"宽限期还没过"').toContain('宽限期还没过');
    expect(expired, '超窗那一格没说"已经超过"').toContain('已经超过');

    /* ── 把这三份**真读数**画到屏上：屏上那一句必须就是表里那一句 ─────────────────── */
    const h = mount();
    h.render({ ...noClock.guest.state(), peer: livePeer });
    expect(linkLineOf(h.root), '窗口内：屏上那一句不是映射表那一句').toBe(live);
    h.render({ ...noClock.guest.state(), peer: expiredPeer });
    expect(linkLineOf(h.root), '超窗：屏上那一句不是映射表那一句').toBe(expired);
    h.render({ ...noClock.guest.state(), peer: unknownPeer });
    expect(linkLineOf(h.root), '判不了：屏上那一句不是映射表那一句').toBe(unknown);
    // 反空转：屏上确实画出了那一块（不是"没画 ⇒ textOf 空 ⇒ 上面三条碰巧"）
    expect(textOf(h.root), '屏上连"连接状态"那一块都没有').toContain('连接状态');
    expect(lobbyLinkText(unknownPeer), '正文组装口与表不一致').toBe(unknown);
  });

  it('超窗**不自动结束对局**（D8）：相位 / 承诺 / 种子都还在，链路没关、驱动没被丢', async () => {
    const clk = fakeClock();
    const a = await readyPair(clk.clock);
    const game = createGame({ seed: 'g5-t13c-window-game' });
    const driver = createNetDriver({ transport: a.pair.B.transport, seat: 1 });
    driver.arm(game);

    // 反空转：推时钟之前这些读数必须是"活着"的那一份（否则下面的断言可能是恒真）
    expect(a.guest.state().peer?.phase, '反空转：这一局该是 complete').toBe('complete');
    expect(a.pair.B.transport.status(), '反空转：链路该是 online').toBe('online');

    clk.advance(300_001);
    a.guest.sync();
    const peer = a.guest.state().peer as PeerStatus;
    expect(peer.windowExpired, '推过 300s 之后该是 true').toBe(true);
    expect(peer.online, '超窗 ⇒ online 为假（不许追平的那一半）').toBe(false);
    expect(peer.acceptsInput, '超窗 ⇒ 不再收输入（T6 的语义，本任务不动它）').toBe(false);
    /**
     * ★ 判据 1 的第三半：**"不许追平"不等于"把对局结束掉"**。逐条摆出"还活着"的证据：
     */
    expect(peer.phase, '超窗把相位推走了（对局被结束掉的形状）').toBe('complete');
    expect(peer.needsResync, '超窗竟然把 needsResync 置成了真（那不是超窗的后果）').toBe(false);
    expect(peer.needsResyncDetail, 'needsResync 为假时 detail 该是 null').toBeNull();
    expect(a.guest.commitmentVerified(), '超窗把承诺结论丢了').toBe(true);
    expect(a.guest.seedOfSession(), '超窗把种子丢了（这一局已经不可能继续了？）').not.toBeNull();
    // 链路与驱动：窗口只改读数，不关链路、不 dispose、不留失败
    expect(a.pair.B.transport.status(), '超窗把链路关掉了（那是"结束对局"的做法）').toBe('online');
    expect(driver.linkClosed(), '驱动说链路已死 —— 超窗不该做这件事').toBe(false);
    expect(driver.lastFailure(), '超窗竟然留下了一条失败记录').toBeNull();
    expect(driver.appliedSteps(), '超窗动了驱动进度').toBe(0);
  });

  it('带回大厅那一行话也按三值分：超窗说"不自动结束 + 只能重开"，判不了就不下结论', async () => {
    const clk = fakeClock();
    const a = await readyPair(clk.clock);
    a.pair.B.deactivate();
    a.guest.sync();
    const live = linkRecoveryNotice(a.guest.state().peer);
    expect(live, '窗口内那一句没有让玩家重新生成邀请码').toContain('重新生成邀请码');
    expect(live, '窗口内那一句没有说清"接上之后要追平"').toContain('追平');

    clk.advance(300_001);
    a.guest.sync();
    const expired = linkRecoveryNotice(a.guest.state().peer);
    expect(expired, '超窗那一句没有说"不能再追平"').toContain('不能再追平');
    expect(expired, '超窗那一句没有如实说"只能重新开一局"').toContain('只能重新开一局');
    expect(expired, '超窗那一句把"对局不会被自动结束"这半句丢了（D8 的裁决）')
      .toContain('不会被程序自动结束');
    for (const lie of ['已经结束', '已经接上', '自动重连', '会自动接回']) {
      expect(expired, `超窗那一句写成了"${lie}"`).not.toContain(lie);
    }

    const noClock = await readyPair();
    noClock.pair.B.deactivate();
    noClock.guest.sync();
    const unknown = linkRecoveryNotice(noClock.guest.state().peer);
    expect(unknown, '判不了那一句没有说"判不了"').toContain('判不了');
    /**
     * ⚠️ 这一句与上面**状态行**那一格（`LOBBY_LINK_COPY['offline-window-unknown']`）的要求不同：
     * 状态行只描述"此刻什么状态"，所以连"只能重开"都不许出现；而这一句是**动作指引**，
     * 判不了时它必须把**两个方向的条件**都说出来（5 分钟内回来可以追平、超过之后只能重开）
     * —— 所以这里禁的是"对**此刻**下结论"的那几种写法，不是"提到重开"。
     */
    for (const conclusion of ['已经超过', '这一局已经', '这一局不能再接着打']) {
      expect(unknown, `判不了那一句竟然对此刻下了结论："${conclusion}"`).not.toContain(conclusion);
    }
    expect(unknown, '判不了那一句把"超过之后只能重开"这个条件丢了（玩家会以为无所谓）')
      .toContain('只能重开');
    // 三句两两不同：可续 / 不可续 / 判不了 是三件不同的事
    expect(new Set([live, expired, unknown]).size, '三条指引有重复').toBe(3);
    // 没有会话读数（`peer === null`）时也不许下结论（同族的边界）
    expect(linkRecoveryNotice(null), '没有读数时竟然给了结论').toContain('判不了');
  });
});
