/**
 * G5/T8 守卫：联机大厅（`src/ui/net-lobby.ts`）—— 渲染判据 + **判据 14 的完整握手**。
 *
 * ## 这个文件能跑什么、不能跑什么
 *
 *  - **能跑行为**：大厅的渲染是"读状态画一帧"（形态照 `local-consent.ts`），所以它能在本仓的
 *    手写 DOM 桩（`tests/ui/net-dom-stub.ts`，没有 jsdom）上**真跑**：建节点、派发点击、读屏上文本；
 *  - **能跑握手**：判据 14 用 `src/net/fake-transport.ts` 的 `createFakeTransportPair` 把两端接起来，
 *    走**真实路径**（`encodeMsg` → 线上 → `decodeMsg` → `accept`），断言两端 `handshakeDone` 都前进；
 *  - **不能跑**：真浏览器 / 真 WebRTC / 真信令。那属 T9 的 CDP 线与人工验收（见文件末的"能力边界"）。
 *
 * ⚠️ **本文件不 `import '../../src/main'`**（绝不）：那个模块导入时会执行
 * `document.getElementById('app')`、`createGame()`… 在 node 环境的 vitest 里会当场炸。
 * `main.ts` 的接线判据住在 `tests/ui/main-lobby-wiring.test.ts`（只读源码文本）。
 *
 * ## 判据编号（对应任务书 §2）
 *
 *  1：文案同源（引用而不复制）· 3：五条错误路径文案两两不同 · 5：端点为空零网络请求 ·
 *  6：载荷只在 fragment · 7：折叠区默认折叠 + TURN 那能看见 · 8：断线文案与 T6 读数同源 ·
 *  9/10：不自己编区间、不自己造字符表 · 12：只碰自己的 root · 14：入站消息喂进 `accept`
 */
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  descendants, installStubDom, makeStubEl, queryAllIn, type StubNode,
} from './net-dom-stub';
import { stripComments } from './source-text';
import {
  LOBBY_ERROR_KEYS, LOBBY_LINK_COPY, createLobbyClient, createLobbySessionLink, errorCopy,
  lobbyLinkOf, lobbyLinkText, protoOfPayload, qrNote, relayNoticeOf, relayStateOf, renderNetLobby,
  type LobbyClient, type LobbyErrorKey, type LobbyRenderNav, type LobbyState, type SettingKey,
} from '../../src/ui/net-lobby';
import { PRIVACY_COPY, privacyLines } from '../../src/app/privacy';
import {
  createInvite, decodeInviteFromAddressBar, decodeInvitePayload, inviteLengthReport,
  readIceServers, roomCodeEntry, stripInviteFromAddressBar,
  type NetBrowserEnv, type WebSocketLike,
} from '../../src/ui/net-browser';
import {
  NO_ENDPOINT_MESSAGE, inviteLinkOf, roomCodeEntryReachability,
} from '../../src/net/invite';
import { normalizeRoomCode, PROTO_VERSION, roomChannel } from '../../src/net/protocol';
import type { PeerStatus } from '../../src/net/session';
import { createFakeTransportPair } from '../../src/net/fake-transport';
import { CARD_DATA_HASH } from '../../src/app/card-data-hash';
import { browserHash } from '../../src/ui/net-browser';

/* ==================================================================== *
 * 夹具 0：DOM 桩与文本读取
 * ==================================================================== */

let restoreDom: (() => void) | null = null;

function mountRoot(): StubNode {
  restoreDom = installStubDom();
  return makeStubEl('div');
}

afterEach(() => {
  restoreDom?.();
  restoreDom = null;
});

/** 屏上的全部文本（按 DOM 顺序拼）——判"文案有没有出现在屏上" */
function textOf(root: StubNode): string {
  return descendants(root).map((n) => n.text).join('\n');
}

/** 按类名取唯一的那个节点；找不到/多个都**响亮**报错（而不是让后面的断言在 undefined 上假绿） */
function oneOf(root: StubNode, sel: string): StubNode {
  const hits = queryAllIn(root, sel);
  expect(hits.length, `屏上应有恰好一个 ${sel}（实际 ${hits.length} 个）`).toBe(1);
  return hits[0];
}

/** 在某个节点上**真派发一次点击**（照 `local-consent.test.ts:69-94` 的桩能力边界做法） */
function click(root: StubNode, sel: string): StubNode {
  const btn = oneOf(root, sel);
  const clicker = makeStubEl('span');
  btn.appendChild(clicker);
  clicker.dispatchEvent({ type: 'click', target: clicker });
  btn.textContent = '';
  return btn;
}

/** 读一个输入框的值（桩把 `value` 放在索引签名里 ⇒ 这里局部收窄，不改共用桩） */
function inputValueOf(root: StubNode, sel: string): string {
  const node = oneOf(root, sel);
  return String((node as unknown as { value: unknown }).value ?? '');
}

/* ==================================================================== *
 * 夹具 1：会记账的假环境（判据 5 的零请求腿）
 * ==================================================================== */

interface Ledger {
  wsUrls: string[];
  fetched: string[];
  historyCalls: string[];
}

function newLedger(): Ledger {
  return { wsUrls: [], fetched: [], historyCalls: [] };
}

/** 记账假件：`webSocket` / `fetch` 各记一笔。判"端点为空时 0 笔"靠它 */
function ledgerEnv(ledger: Ledger, extra: NetBrowserEnv = {}): NetBrowserEnv {
  return {
    webSocket: (url: string): WebSocketLike | null => {
      ledger.wsUrls.push(url);
      return {
        readyState: 0,
        send: () => {},
        close: () => {},
        addEventListener: () => {},
      };
    },
    fetch: async (url: string) => {
      ledger.fetched.push(url);
      return { ok: true, status: 200 };
    },
    ...extra,
  };
}

/** 一个假地址栏（`location` + 会记账的 `history`）——判据 6 的 ⑤ 用它数 `replaceState` */
function fakeAddressBar(href: string): { loc: { href: string; hash: string }; history: { replaceState(d: unknown, t: string, u: string): void }; calls: string[] } {
  const calls: string[] = [];
  const loc = { href, hash: href.includes('#') ? href.slice(href.indexOf('#')) : '' };
  return {
    loc,
    calls,
    history: {
      replaceState: (_d: unknown, _t: string, u: string) => {
        calls.push(u);
        loc.href = u;
        loc.hash = '';
      },
    },
  };
}

/**
 * 压缩能力（判据 6 要用**真的** `createInvite` 与 `decodeInvitePayload`）。
 *
 * 用**真件**（`net-browser.ts` 的 `defaultEnv()` 走 `CompressionStream` / `DecompressionStream`）
 * 而不写假件：`encodeInvite` 有一道**自洽检查**（"压出来的必须解得动、且解出来还是那份载荷"），
 * 一个"异或充数"的假压缩件会当场被它拒绝（实测：`bad-json`）—— 那正说明那道检查是有牙的。
 * 真件的另一个好处：这条腿顺带证明了"邀请码在真压缩下真的能往返"。
 *
 * ⚠️ **确定性**：压缩算法本身确定，而这里的输入（固定的 SDP / 承诺串）逐字节固定 ⇒
 * 同一脚本跑两遍结果相同（本机 Node 22.22.2 实测）。
 */
const REAL_ENV: NetBrowserEnv = {};

/** 一条可用的 offer SDP（长度与真件同族；`encodeInvite` 只要求非空） */
const OFFER_SDP = 'v=0\r\no=- 0 0 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\na=group:BUNDLE 0\r\n';

/** 走**真件**（浏览器层的 `createInvite`）造一条邀请码：`p` 就是版本不一致那条腿的输入 */
async function realInvite(originAndPath = 'https://x.invalid/lobby', p: number = PROTO_VERSION) {
  const r = await createInvite(
    {
      p,
      originAndPath,
      sdp: OFFER_SDP,
      ice: ['candidate:1 1 udp 1 127.0.0.1 1 typ host'],
      hostPromise: 'host-promise-x',
      guestPromise: 'guest-promise-x',
    },
    REAL_ENV,
  );
  expect(r.ok, `夹具失败：createInvite 没成功（${r.ok ? '' : r.message}）`).toBe(true);
  if (!r.ok) throw new Error('unreachable');
  return r;
}

/* ==================================================================== *
 * 夹具 2：一个能在桩上渲染的大厅（状态两段式：setup 改状态 → 再渲染）
 * ==================================================================== */

interface Harness {
  root: StubNode;
  state: LobbyState;
  calls: string[];
  notices: Array<string | null>;
  /** 改状态再画一帧（模拟"用户点了一下"之后的整帧重画） */
  draw(mutate?: (s: LobbyState) => LobbyState): void;
  /** 只画一帧，不动状态（第一次渲染用） */
  render(): void;
}

function mountLobby(initial?: Partial<LobbyState>): Harness {
  const root = mountRoot();
  const calls: string[] = [];
  const notices: Array<string | null> = [];
  const h: Harness = {
    root,
    state: {
      role: null,
      sessionId: 'sid-test',
      invite: null,
      joined: null,
      roomCodeInput: '',
      roomCodeGate: null,
      transport: 'idle',
      peer: null,
      endpoint: '',
      ice: { servers: [], relayConfigured: false, relayIncomplete: false },
      advancedOpen: false,
      waitExpired: null,
      error: null,
      notice: null,
      routedIn: 0,
      routedOut: 0,
      ...initial,
    },
    calls,
    notices,
    render: () => { renderNetLobby(root as unknown as HTMLElement, nav()); },
    draw: (mutate) => {
      if (mutate) h.state = mutate(h.state);
      renderNetLobby(root as unknown as HTMLElement, nav());
    },
  };
  function nav(): LobbyRenderNav {
    return {
      state: h.state,
      backHome: () => { calls.push('back'); },
      startHost: () => { calls.push('host'); },
      startJoin: () => { calls.push('join'); },
      makeInvite: () => { calls.push('make-invite'); },
      inviteLength: (payload: string) => {
        const r = inviteLengthReport(payload);
        return `长度 ${r.chars} 落在区间=${String(r.withinMeasuredRange)}`;
      },
      qrNote: () => qrNote(),
      setRoomCode: (t: string) => { h.state = { ...h.state, roomCodeInput: t }; },
      submitRoomCode: () => { calls.push('submit-code'); },
      joinWithInvite: (t: string) => { calls.push(`join-invite:${t}`); },
      toggleAdvanced: () => { h.state = { ...h.state, advancedOpen: !h.state.advancedOpen }; },
      settingsValue: (_k: SettingKey) => '',
      setSetting: (_k: SettingKey, _v: string) => { calls.push('set-setting'); },
      errorText: (k: LobbyErrorKey) => errorCopy(k),
    };
  }
  return h;
}

/* ==================================================================== *
 * 夹具 3：一个假时钟（8 秒窗口那条腿）
 * ==================================================================== */

function fakeTicker(): { ticker: { schedule(fn: () => void, ms: number): number; cancel(h: number): void }; fire(): number; scheduled(): number[]; cancelled(): number[] } {
  let next = 1;
  const jobs = new Map<number, () => void>();
  const cancelled: number[] = [];
  const scheduled: number[] = [];
  return {
    ticker: {
      schedule: (fn, ms) => { const id = next++; jobs.set(id, fn); scheduled.push(ms); return id; },
      cancel: (id) => { cancelled.push(id); jobs.delete(id); },
    },
    fire: () => { const ids = [...jobs.keys()]; for (const id of ids) { const fn = jobs.get(id); jobs.delete(id); fn?.(); } return ids.length; },
    scheduled: () => scheduled,
    cancelled: () => cancelled,
  };
}

/** 造一个大厅客户端（注入全假件；`role` 由调用方给） */
function makeClient(over: Partial<Parameters<typeof createLobbyClient>[0]> = {}): LobbyClient {
  const t = fakeTicker();
  return createLobbyClient({
    role: 'guest',
    sessionId: 'sid-1',
    localProtoVersion: PROTO_VERSION,
    localCardDataHash: CARD_DATA_HASH,
    hash: browserHash(),
    ticker: t.ticker,
    createTransport: () => { throw new Error('这个用例不该造传输'); },
    signalingEndpoint: '',
    readSettings: () => ({ turnUrl: '', turnUsername: '', turnCredential: '' }),
    buildInvite: async () => ({ ok: true as const, payload: 'PAYLOAD-X', link: 'https://x.invalid/l#invite=PAYLOAD-X' }),
    decompressBase64: () => null,
    readAddressBar: () => null,
    ...over,
  });
}

/* ==================================================================== *
 * 1. 判据 7：折叠区**默认折叠**（第一帧上不出现任何 signalAndRelay 组的文案）
 * ==================================================================== */

describe('判据 7 · 「高级 / 连接设置」默认折叠，启用后才让玩家看见那句', () => {
  it('第一帧：signalAndRelay 组的两句都**不在**屏上（默认不渲染，而不是渲染好再藏起来）', () => {
    const h = mountLobby({ role: 'guest' });
    h.render();
    const text = textOf(h.root);
    // 逐条来自 `privacyLines()` 的**当前返回值**（生成式；不写死文案）
    for (const line of PRIVACY_COPY.signalAndRelay) {
      expect(text, `第一帧上就出现了 signalAndRelay 的那句：${line.slice(0, 24)}…`).not.toContain(line);
    }
    // 反空转：折叠区那个开关本身必须在屏上（否则"没有那句"可能是"整块都没渲染"）
    expect(queryAllIn(h.root, 'button.net-lobby-advanced-toggle').length, '折叠区开关没渲染').toBe(1);
    // 判据 7 的注意项：DOM 里**不许**事先放着那段内容（桩上没有布局引擎，藏起来 = 看不见）
    expect(queryAllIn(h.root, 'div.net-lobby-advanced-panel').length, '折叠区内容已经进了 DOM（只是被藏起来）').toBe(0);
  });

  it('★ M5 的落点：**客户端自己的初值**就是"折叠"（手写状态渲染测不到这条初值）', () => {
    // ⚠️ 这条腿是补上来的：第一版只用手写状态渲染 ⇒ 变异 M5（改 `createLobbyClient` 里的
    //    初值）**根本不会被走到**，判据面在变异世界里照样绿（实测）。所以这里走真客户端。
    const c = makeClient({ role: 'guest' });
    expect(c.state().advancedOpen, '客户端的第一帧就是"已展开"').toBe(false);
    // 行为面：把它自己的状态渲染出来，那一族文案一条都不该在屏上
    const h = mountLobby();
    h.state = c.state();
    h.render();
    const text = textOf(h.root);
    for (const line of PRIVACY_COPY.signalAndRelay) {
      expect(text, `调用方初值（真客户端）渲染的第一帧上出现了那族文案：${line.slice(0, 22)}…`)
        .not.toContain(line);
    }
    // 对照：同一个客户端展开之后，内容进 DOM
    c.toggleAdvanced();
    h.state = c.state();
    h.render();
    expect(queryAllIn(h.root, 'div.net-lobby-advanced-panel').length, '展开之后面板没进 DOM').toBe(1);
  });

  it('点开折叠区：出现 TURN 三项的输入框 + 配了一半时的可读提示；TURN 未填齐时**没有**那句', () => {
    const h = mountLobby({ role: 'guest' });
    h.render();
    click(h.root, 'button.net-lobby-advanced-toggle');
    // ⚠️ 桩上 `click` 走的是**渲染时注册的那个监听器** ⇒ 它改的是渲染接缝自己的状态。
    // 这里直接重画一帧（把"点开"这件事写实：展开状态由 `state.advancedOpen` 决定）
    h.draw((s) => ({ ...s, advancedOpen: true }));
    expect(queryAllIn(h.root, 'div.net-lobby-advanced-panel').length, '展开之后没有面板').toBe(1);
    expect(queryAllIn(h.root, 'input.net-lobby-turn-url-input').length, 'TURN URL 输入框没了').toBe(1);
    expect(queryAllIn(h.root, 'input.net-lobby-turn-user-input').length, 'TURN 用户名输入框没了').toBe(1);
    expect(queryAllIn(h.root, 'input.net-lobby-turn-cred-input').length, 'TURN 凭据输入框没了').toBe(1);
    // ★ 反证（防"屏上永远有它"）：TURN **没填齐**时那句必须不在
    const text = textOf(h.root);
    expect(text, 'TURN 一项都没填，那句中继说明就已经在屏上了').not.toContain(PRIVACY_COPY.signalAndRelay[1]);
  });

  it('★ TURN 三项填齐 ⇒ 屏上出现 `privacy.ts:111` 那句的**完整正文**（含 ONLINE_GATE_MARK 前缀）', () => {
    // 输入面是真的：`readIceServers` 是唯一判定处，这里喂它"三项齐全"的读数
    const read = readIceServers({ turnUrl: 'turn:x.invalid:3478', turnUsername: 'u', turnCredential: 'c' });
    expect(relayStateOf(read), '夹具失败：三项齐全竟然没判成 on').toBe('on');
    const h = mountLobby({ role: 'guest', advancedOpen: true, endpoint: 'wss://x.invalid', ice: read });
    h.render();
    const text = textOf(h.root);
    // 逐字比对（含门槛前缀 `ONLINE_GATE_MARK`——它是那句话正文的一部分）
    expect(text, '启用 TURN 之后屏上没有 privacy.ts:111 那句').toContain(PRIVACY_COPY.signalAndRelay[1]);
    expect(PRIVACY_COPY.signalAndRelay[1], '夹具失败：那句不带门槛前缀（逐字比对的前提不成立）')
      .toContain('（联机功能上线后才适用）');
    // 而且它是**引用**来的：与导出面逐字相等，不是本地拼的
    expect(relayNoticeOf(read), 'relayNoticeOf 在 on 时交的不是 privacy.ts 那一句')
      .toBe(PRIVACY_COPY.signalAndRelay[1]);
    // 配了一半：是**另一句**（不是"没配"也不是"配好了"）
    const half = readIceServers({ turnUrl: 'turn:x.invalid:3478' });
    expect(relayStateOf(half)).toBe('partial');
    expect(relayNoticeOf(half), '配了一半时给出了与"配齐"相同的那句').not.toBe(PRIVACY_COPY.signalAndRelay[1]);
    expect(relayNoticeOf(half), '配了一半时没有可读提示').not.toBeNull();
    // 没配：什么都不说
    expect(relayNoticeOf(readIceServers({})), '没配 TURN 时却给出了提示').toBeNull();
  });

  it('D22 的文本腿：大厅两个文件里**零命中**手写的中继结论片段', () => {
    const read = (rel: string): string =>
      stripComments(readFileSync(fileURLToPath(new URL(`../../src/ui/${rel}`, import.meta.url))).subarray(0, 8 * 1024 * 1024).toString('utf8'));
    for (const f of ['net-lobby.ts', 'styles-net-lobby.css']) {
      const code = read(f);
      expect(code.includes('内容不可读'), `${f} 里手写了"内容不可读"（D22：不许加第二句）`).toBe(false);
      expect(code.includes('也不存储'), `${f} 里手写了"也不存储"（D22：不许加第二句）`).toBe(false);
    }
    // 反空转：那两句确实在真树别处存在（`privacy.ts:111`），否则上面两条是在扫一个不存在的串
    const priv = readFileSync(fileURLToPath(new URL('../../src/app/privacy.ts', import.meta.url))).subarray(0, 8 * 1024 * 1024).toString('utf8');
    expect(priv.includes('内容不可读'), '夹具失败：privacy.ts 里没有那串（词表过时了）').toBe(true);
  });
});

/* ==================================================================== *
 * 2. 判据 5：端点为空时短码入口给可读提示，且**零网络请求**
 * ==================================================================== */

describe('判据 5 · 端点为空：可读提示逐字来自唯一出处，且一个请求都不发', () => {
  it('★ 端点为空时提交短码：屏上出现 `NO_ENDPOINT_MESSAGE` 的**完整正文**', () => {
    // 走**真判定**（`roomCodeEntryReachability`，纯层唯一出处）算出门上那句话，
    // 再交给渲染（这与 `LobbyClient.submitRoomCode()` 的第一步是同一条路）
    const gate = roomCodeEntryReachability('');
    expect(gate.ok, '夹具失败：空端点竟然判成可用').toBe(false);
    if (gate.ok) return;
    expect(gate.message, '纯层那句提示与浏览器层的转发出口不一致')
      .toBe(NO_ENDPOINT_MESSAGE);
    const h = mountLobby({ role: 'guest', roomCodeInput: 'ABCDEF', roomCodeGate: gate.message, notice: gate.message });
    h.render();
    const text = textOf(h.root);
    // 逐字比对（含 `&&` 与标点）：整句都要在
    expect(text, '屏上没有 `NO_ENDPOINT_MESSAGE` 的完整正文').toContain(NO_ENDPOINT_MESSAGE);
    // ③ 屏上**没有**任何"已连接 / 正在连接 / 已发送"字样的状态行（防"提示画了、还装作在连"）
    for (const claim of ['已连接', '正在连接', '已发送', '已连上对端']) {
      expect(text.includes(claim), `端点为空时屏上出现了「${claim}」—— 它在装作正在连`).toBe(false);
    }
  });

  it('★ 零网络请求（记账假件）：端点为空 ⇒ `roomCodeEntry` 一笔都不记', async () => {
    const ledger = newLedger();
    const env = ledgerEnv(ledger);
    const entry = roomCodeEntry(env);
    expect(entry.ok, '夹具失败：空端点竟然给出可用').toBe(false);
    // 通过式（不是抛错）—— 说明那是一条**正常返回**的路
    if (!entry.ok) expect(entry.message).toBe(NO_ENDPOINT_MESSAGE);
    expect(ledger.fetched, '端点为空时发生了 fetch（§8.1：默认不向任何服务器发请求）').toEqual([]);
    expect(ledger.wsUrls, '端点为空时构造了 WebSocket').toEqual([]);
    // ⚠️ 记账假件**确实接上了**：同一份假件喂给一条真网络动作必须记账 > 0
    //   （否则上面那两个 `toEqual([])` 是"假件没接上"造成的假绿）
    const { discoverSignalingEndpoint } = await import('../../src/ui/net-browser');
    const probe = await discoverSignalingEndpoint({ url: 'wss://x.invalid' }, env);
    expect(ledger.wsUrls.length, '反证失败：记账假件根本没接上（那两个空数组证明不了任何事）').toBeGreaterThan(0);
    expect(probe.ok, '端点是 ws 且假件 readyState=0(CONNECTING) ⇒ 应当算连上').toBe(true);
  });

  it('★ 端点**非空**时那条路照常记账（同一条判定的另一侧，防"两条腿同形"）', () => {
    const empty = roomCodeEntryReachability('');
    const filled = roomCodeEntryReachability('wss://x.invalid');
    expect(empty.ok, '空端点没被拒').toBe(false);
    expect(filled.ok, '非空端点被拒了（判定写反了？）').toBe(true);
    if (!empty.ok) expect(empty.message, '空端点给的提示不是唯一出处那句').toBe(NO_ENDPOINT_MESSAGE);
    // 提示只在**空**那一侧出现：非空那侧没有 message 字段可用（类型上就没有）
    expect('message' in filled, '非空端点的读数里带了 message（那会让"配好了却也提示"成为可能）').toBe(false);
  });

  it('判据 5 的文案唯一出口：大厅源码里不含那句提示的正文片段（不许自己写一份）', () => {
    const code = stripComments(
      readFileSync(fileURLToPath(new URL('../../src/ui/net-lobby.ts', import.meta.url))).subarray(0, 8 * 1024 * 1024).toString('utf8'),
    );
    expect(code.includes('6 位房间码要经一个信令服务'), '大厅里手写了那句提示的正文（唯一出处是 net/invite.ts）')
      .toBe(false);
    // 反空转：那个片段在真树别处确实存在
    const invite = readFileSync(fileURLToPath(new URL('../../src/net/invite.ts', import.meta.url))).subarray(0, 8 * 1024 * 1024).toString('utf8');
    expect(invite.includes('6 位房间码要经一个信令服务'), '夹具失败：invite.ts 里没有那个片段').toBe(true);
  });
});

/* ==================================================================== *
 * 3. 判据 6：邀请码链接的载荷只在 fragment
 * ==================================================================== */

describe('判据 6 · 载荷只在 fragment（生成函数的返回值，不靠人眼看）', () => {
  it('★ 真件生成的 link：`#` 之后逐字等于 payload，且 query / 路径段都不含载荷', async () => {
    const inv = await realInvite('https://x.invalid/lobby', PROTO_VERSION);
    const hashAt = inv.link.indexOf('#');
    expect(hashAt, '链接里没有 fragment').toBeGreaterThanOrEqual(0);
    // ① `#` 之后是 `invite=<载荷>`，且载荷**逐字等于** payload
    expect(inv.link.slice(hashAt), `fragment 不是 invite=<载荷>`).toBe(`#invite=${inv.payload}`);
    // ② `?` 之后的 query 段不含载荷（生成函数不碰 query）
    const q = inv.link.indexOf('?');
    if (q >= 0) {
      expect(inv.link.slice(q + 1, hashAt < 0 ? undefined : hashAt).includes(inv.payload), 'query 段里有载荷')
        .toBe(false);
    } else {
      expect(inv.link.includes('?'), '生成的链接里出现了 query（生成函数应当不碰 query）').toBe(false);
    }
    // ③ 路径段不含载荷
    const pathEnd = hashAt;
    const path = inv.link.slice(0, pathEnd);
    expect(path.includes(inv.payload), '路径段里有载荷').toBe(false);
    expect(path, '路径不是给进来的 originAndPath').toContain('https://x.invalid/lobby');
    expect(path.includes('invite='), 'invite= 出现在了 fragment 之前').toBe(false);
  });

  it('★ ④ 解码口只吃 fragment：同一串载荷放到 query 或路径上 ⇒ 必须失败（且给可读原因）', async () => {
    const inv = await realInvite();
    const bar = fakeAddressBar(`https://x.invalid/lobby#invite=${inv.payload}`);
    const env = { location: () => bar.loc, history: () => bar.history };
    // fragment 上：能解出来
    const good = await decodeInviteFromAddressBar(env);
    expect(good.ok, `fragment 上的邀请码竟然没解开：${good.ok ? '' : good.message}`).toBe(true);
    // query 上：**不认**
    const q = await decodeInviteFromAddressBar({
      ...env, location: () => ({ href: `https://x.invalid/lobby?invite=${inv.payload}`, hash: '' }),
    });
    expect(q.ok, 'query 里的载荷被当成邀请码收下了（D17：那条链路会被服务器看到）').toBe(false);
    if (!q.ok) expect(q.reason, 'query 那条路给的不是 no-fragment（原因不可读）').toBe('no-fragment');
    // 路径上：**不认**
    const p = await decodeInviteFromAddressBar({
      ...env, location: () => ({ href: `https://x.invalid/lobby/${inv.payload}`, hash: '' }),
    });
    expect(p.ok, '路径段里的载荷被当成邀请码收下了').toBe(false);
    // 反向自证：同一条载荷**真的**可解（否则上面两条"不认"可能只是因为载荷本身是坏的）
    const bare = await decodeInvitePayload(inv.payload, REAL_ENV);
    expect(bare.ok, '载荷本身解不开 ⇒ 上面那些"不认"没有区分力').toBe(true);
  });

  it('★ ⑤ 读完立刻抹地址栏，且**只在读到载荷之后**才抹（用假 history 记账）', () => {
    const payload = '1.PAYLOAD';
    const withFrag = fakeAddressBar(`https://x.invalid/lobby#invite=${payload}`);
    const envA = { location: () => withFrag.loc, history: () => withFrag.history };
    expect(readInviteRaw(envA), 'fragment 读不出来').toBe(payload);
    expect(stripInviteFromAddressBar(envA), '抹没成功').toBe(true);
    expect(withFrag.calls.length, '有 fragment 的世界里 `replaceState` 的调用数不是 1').toBe(1);
    expect(withFrag.calls[0], '抹完之后留下的 URL 不是去掉 fragment 的那一条')
      .toBe('https://x.invalid/lobby');
    // 没有 fragment 的世界：**一次都不许抹**（别把别人的 hash 抹掉）
    const noFrag = fakeAddressBar('https://x.invalid/lobby#section-3');
    const envB = { location: () => noFrag.loc, history: () => noFrag.history };
    expect(readInviteRaw(envB), '夹具失败：这条地址栏竟然被读出了载荷').toBeNull();
    expect(stripInviteFromAddressBar(envB), '没有邀请码时也抹了地址栏').toBe(false);
    expect(noFrag.calls.length, '没有 fragment 的世界里 `replaceState` 的调用数不是 0').toBe(0);
    expect(noFrag.loc.href, '别人的 hash 被抹掉了').toBe('https://x.invalid/lobby#section-3');
  });

  it('大厅的"生成邀请链接"落点只有一个，且它交出的 link 就是 `inviteLinkOf` 的产出', () => {
    const code = stripComments(
      readFileSync(fileURLToPath(new URL('../../src/ui/net-lobby.ts', import.meta.url))).subarray(0, 8 * 1024 * 1024).toString('utf8'),
    );
    // 唯一出处：链接组装只许调 `inviteLinkOf`，不许自己拼 `#invite=`
    expect(code.includes('inviteLinkOf'), '大厅没调用唯一出处 inviteLinkOf').toBe(true);
    expect(code.includes('#invite='), '大厅自己拼了 `#invite=` 字面量（第二处链接组装）').toBe(false);
    // 行为面：同一个载荷交给两处，产出必须逐字相同
    expect(inviteLinkOf('https://x.invalid/l', 'P1')).toBe('https://x.invalid/l#invite=P1');
  });
});

/** 读地址栏（只认 fragment）——测试侧的薄包装，避免每条腿各写一遍 */
function readInviteRaw(env: NetBrowserEnv): string | null {
  const loc = env.location?.() ?? null;
  if (loc === null) return null;
  const at = loc.href.indexOf('#');
  if (at < 0) return null;
  const frag = loc.href.slice(at + 1);
  if (!frag.startsWith('invite=')) return null;
  const p = frag.slice('invite='.length);
  return p.length === 0 ? null : p;
}

/* ==================================================================== *
 * 4. 判据 3：五条错误路径的文案两两不同、非空、来源可追
 * ==================================================================== */

describe('判据 3 · 五条错误路径各有互不相同的可读文案', () => {
  it('★ 五条文案两两不同、非空（**这就是变异 M2 的判据面**）', () => {
    const rows = LOBBY_ERROR_KEYS.map((k) => ({ k, text: errorCopy(k) }));
    // 打印实测分布（覆盖类断言要打印实测分布）
    // eslint-disable-next-line no-console
    console.log('\n五条错误文案：\n' + rows.map((r) => `  ${r.k}: ${r.text.slice(0, 46)}…`).join('\n'));
    expect(rows.length, '五条路径的键数量').toBe(5);
    for (const r of rows) expect(r.text.length, `${r.k} 的文案是空的`).toBeGreaterThan(10);
    const texts = rows.map((r) => r.text);
    const uniq = new Set(texts);
    expect(uniq.size, `五条文案里有重复：${texts.map((t) => t.slice(0, 18)).join(' | ')}`).toBe(texts.length);
    // 逐对检查（生成式：任一对相等就报红并指名）
    for (let i = 0; i < texts.length; i += 1) {
      for (let j = i + 1; j < texts.length; j += 1) {
        expect(texts[i] === texts[j], `${LOBBY_ERROR_KEYS[i]} 与 ${LOBBY_ERROR_KEYS[j]} 的文案是同一句`).toBe(false);
      }
    }
  });

  it('★ 来源可追：`proto-version` 那一格**现调**唯一出处（协议版本不一致时逐字等于它的 message）', () => {
    // `protocolVersionCheck` 是那句话的唯一出处：远端版本更高/更低各给一句**不同**的话
    const higher = errorCopy('proto-version', PROTO_VERSION + 1);
    const lower = errorCopy('proto-version', PROTO_VERSION - 1);
    expect(higher, '远端更高时没给出那句提示').toContain('更新的版本');
    expect(lower, '远端更低时没给出那句提示').toContain('更旧的版本');
    expect(higher === lower, '两个方向的版本不一致给了同一句（原因不可分辨）').toBe(false);
    // 反向自证：与别的四条都不相同
    for (const k of LOBBY_ERROR_KEYS.filter((x) => x !== 'proto-version')) {
      expect(higher === errorCopy(k), `proto-version 与 ${k} 撞了`).toBe(false);
    }
    // 反空转：一致时那一格给的是"这一格不该被渲染"的说明（不是空串）
    expect(errorCopy('proto-version', PROTO_VERSION).length, '版本一致时给出了空串（屏上会出现空行）')
      .toBeGreaterThan(10);
  });

  it('★ 8 秒窗口（`room-gone`）有**行为腿**：注入假时钟走到点，错误落在 `room-gone` 上', () => {
    const t = fakeTicker();
    const notices: Array<string | null> = [];
    const client = makeClient({
      role: 'guest',
      signalingEndpoint: '',
      ticker: t.ticker,
      onNotice: (x) => { notices.push(x); },
    });
    // 端点为空的短码提交：给提示，并**不**起窗口（它压根没在等对端）
    client.setRoomCode('ABCDEF');
    client.submitRoomCode();
    expect(client.state().waitExpired, '端点为空时不该起 8 秒窗口').toBeNull();
    expect(t.scheduled().length, '端点为空时竟然排了计时器').toBe(0);
    // 端点非空时：提交会起窗口，窗口到点 ⇒ `waitExpired = true` 且错误是 room-gone
    const t2 = fakeTicker();
    const c2 = makeClient({ role: 'guest', signalingEndpoint: 'wss://x.invalid', ticker: t2.ticker });
    c2.setRoomCode('abcdef');
    c2.submitRoomCode();
    expect(t2.scheduled(), '窗口的长度不是 8 秒（计划 §5 T8 写死的那个数）').toEqual([8_000]);
    expect(c2.state().waitExpired, '还没到点时 waitExpired 不是 null').toBeNull();
    expect(c2.state().error, '还没到点就报了错').toBeNull();
    // 手动"走完时钟"
    expect(t2.fire(), '没有可触发的计时器').toBe(1);
    expect(c2.state().waitExpired, '窗口到点之后 waitExpired 不是 true').toBe(true);
    expect(c2.state().error, '窗口到点之后没有落到 room-gone 上').toBe('room-gone');
    expect(errorCopy('room-gone'), 'room-gone 的文案里没有那个秒数').toContain('8 秒');
  });

  it('能力边界（写实，不是"没做到"）：三条只转发会话层拒绝原因的腿今天没有真端点', () => {
    for (const k of ['card-data-hash', 'busy', 'spectator'] as const) {
      const text = errorCopy(k);
      expect(text.length, `${k} 没有文案`).toBeGreaterThan(10);
      // 它们说的是"哪一件事"，而不是"连不上"（与 room-gone 不同族）
      expect(text.includes('8 秒'), `${k} 的文案里混进了超时那句（两条路径串味）`).toBe(false);
    }
    expect(errorCopy('spectator'), '观战那条没点明"不是坐满了"').toContain('不是');
    expect(errorCopy('busy'), '位满那条没点明"位满了"').toContain('满');
  });
});

/* ==================================================================== *
 * 5. 判据 8：断线文案与 T6 的读数**同源**
 * ==================================================================== */

/** 造一个 `PeerStatus` 快照（只填这条判据关心的字段，其余给安全缺省） */
function peer(over: Partial<PeerStatus> = {}): PeerStatus {
  return {
    phase: 'complete',
    handshakeDone: true,
    faceCommitted: true,
    seedRevealed: true,
    acceptsInput: true,
    needsResync: false,
    needsResyncCause: null,
    needsResyncDetail: null,
    online: true,
    windowExpired: null,
    ...over,
  };
}

describe('判据 8 · 「断线 ≠ 刷新」由 T6 的读数派生（映射只有一张表）', () => {
  it('★ 六种读数组合 ⇒ 六个**互不相同**的键，每一格都看得出真因', () => {
    const cases: Array<{ name: string; st: PeerStatus; key: string }> = [
      { name: '在线', st: peer({ online: true }), key: 'online' },
      { name: '断线·窗口内', st: peer({ online: false, windowExpired: false }), key: 'offline-window-live' },
      { name: '断线·超窗', st: peer({ online: false, windowExpired: true }), key: 'offline-window-expired' },
      { name: '断线·判不了窗口', st: peer({ online: false, windowExpired: null }), key: 'offline-window-unknown' },
      {
        name: '追平中·对端回来',
        st: peer({ online: false, needsResync: true, needsResyncCause: 'resuming-handshake', needsResyncDetail: '细节-A' }),
        key: 'resync-handshake',
      },
      {
        name: '追平中·本端溢出',
        st: peer({ online: false, needsResync: true, needsResyncCause: 'queue-overflow', needsResyncDetail: '细节-B' }),
        key: 'resync-queue-overflow',
      },
    ];
    const keys = cases.map((c) => lobbyLinkOf(c.st));
    // 打印实测分布
    // eslint-disable-next-line no-console
    console.log('\n读数 → 键：\n' + cases.map((c, i) => `  ${c.name} ⇒ ${keys[i]}`).join('\n'));
    expect(keys, '读数 → 键的映射与预期不符').toEqual(cases.map((c) => c.key));
    // 六句两两不同（**这就是变异 M6 的判据面**）
    const texts = keys.map((k) => LOBBY_LINK_COPY[k as keyof typeof LOBBY_LINK_COPY]);
    expect(new Set(texts).size, `六句里有重复：${texts.map((t) => t.slice(0, 14)).join(' | ')}`).toBe(texts.length);
    for (const t of texts) expect(t.length, '有一格是空文案').toBeGreaterThan(8);
    // 每一格都能看出真因（各自的关键词）
    expect(LOBBY_LINK_COPY['offline-window-live'], '窗口内那句没说"宽限期还没过"').toContain('宽限期');
    expect(LOBBY_LINK_COPY['offline-window-expired'], '超窗那句没说"超过了宽限期"').toContain('超过');
    expect(LOBBY_LINK_COPY['offline-window-unknown'], '判不了窗口那句没点明"无法判定"').toContain('无法判定');
    expect(LOBBY_LINK_COPY['resync-handshake'], '对端回来那句没说"对端"').toContain('对端');
    expect(LOBBY_LINK_COPY['resync-queue-overflow'], '本端溢出那句没说"溢出"').toContain('溢出');
    // ★ T6 登记缺口：房主侧溢出**没有自动出路** ⇒ 那句话必须说出来
    expect(LOBBY_LINK_COPY['resync-queue-overflow'], '房主侧溢出那句没写"今天的协议里没有自动出路"')
      .toContain('没有自动出路');
  });

  it('★ "刷新 ≠ 让对局回来"落在 `online === false` 那一族里（三句都带，不是只写死一句）', () => {
    for (const k of ['offline-window-live', 'offline-window-expired', 'offline-window-unknown'] as const) {
      expect(LOBBY_LINK_COPY[k], `${k} 那句没有"刷新不能让对局回来"这层意思`).toContain('刷新');
      expect(LOBBY_LINK_COPY[k], `${k} 那句没有点明"对局不能/不会回来"`).toContain('对局');
    }
    // 反向：在线那一句**不许**带这层意思（否则"断线 ≠ 刷新"就没有区分力）
    expect(LOBBY_LINK_COPY.online.includes('刷新'), '在线那格也写了"刷新"').toBe(false);
  });

  it('★ `needsResyncDetail` **必须**被渲染出来（不许丢掉它另写一句）', () => {
    const st = peer({ online: false, needsResync: true, needsResyncCause: 'queue-overflow', needsResyncDetail: '会话层给的那句真因-XY' });
    const text = lobbyLinkText(st);
    expect(text, 'detail 没有被拼进屏上那句话').toContain('会话层给的那句真因-XY');
    expect(text, '拼出来的那句没有映射表那一句作为主体').toContain(LOBBY_LINK_COPY['resync-queue-overflow']);
    // 没有 detail 时不该出现空括号
    const bare = lobbyLinkText(peer({ online: false, windowExpired: false }));
    expect(bare.includes('（）'), '没有 detail 时屏上多出一对空括号').toBe(false);
    // 行为面：把那个快照喂进渲染，屏上必须真的出现它
    const h = mountLobby({ role: 'guest', peer: st });
    h.render();
    expect(textOf(h.root), '屏上没有 detail 那句').toContain('会话层给的那句真因-XY');
  });

  it('★ 四种快照喂进渲染 ⇒ 屏上是四种互不相同的文案（行为腿，不是只读表）', () => {
    const snaps: PeerStatus[] = [
      peer({ online: true }),
      peer({ online: false, windowExpired: false }),
      peer({ online: false, windowExpired: true }),
      peer({ online: false, needsResync: true, needsResyncCause: 'resuming-handshake', needsResyncDetail: '追平细节' }),
    ];
    const screens = snaps.map((st) => {
      const h = mountLobby({ role: 'guest', peer: st });
      h.render();
      // 只取"连接状态"那一块的正文，避免别处（标题之类）的固定文本混进来
      const blocks = queryAllIn(h.root, 'div.net-lobby-status');
      expect(blocks.length, '屏上没有连接状态块').toBe(1);
      return descendants(blocks[0]).map((n) => n.text).join('\n');
    });
    // eslint-disable-next-line no-console
    console.log('\n四种快照的屏上文案：\n' + screens.map((s, i) => `  #${i}: ${s.replace(/\n+/g, ' / ').slice(0, 60)}…`).join('\n'));
    expect(new Set(screens).size, `四种快照在屏上不是四种文案：\n${screens.join('\n---\n')}`).toBe(4);
    for (const s of screens) expect(s.length, '有一屏的连接状态块是空的').toBeGreaterThan(8);
  });

  it('`transport.status()` **不许**被渲染成"已连上对端"（D18）', () => {
    // 有 peer 读数时：屏上出现的是映射表那一句
    const withPeer = mountLobby({ role: 'guest', transport: 'online', peer: peer({ online: false, windowExpired: false }) });
    withPeer.render();
    expect(textOf(withPeer.root), '有对端读数时屏上没走映射表').toContain(LOBBY_LINK_COPY['offline-window-live']);
    // 没有 peer 读数时：只说**本侧**链路，且必须点明"不代表对端在"
    const noPeer = mountLobby({ role: 'guest', transport: 'online', peer: null });
    noPeer.render();
    const text = textOf(noPeer.root);
    expect(text, '没有对端读数时应当只说本侧链路').toContain('本机链路');
    expect(text, '没有对端读数时没说"不代表对端在"（D18）').toContain('不代表对端在');
    expect(text.includes('已连上对端'), '把本侧链路读成了"已连上对端"').toBe(false);
  });
});

/* ==================================================================== *
 * 6. 判据 1 / 9 / 10：文案同源、不自己编区间、不自己造字符表
 * ==================================================================== */

describe('判据 1 / 9 / 10 · 引用而不复制、不自己编区间、不自己造字符表', () => {
  it('判据 1 · 大厅的隐私说明**引用** `privacyLines()`（逐条渲染，一条都不手写）', () => {
    const h = mountLobby({ role: 'guest', advancedOpen: true, endpoint: '', ice: readIceServers({ turnUrl: 'turn:x:1', turnUsername: 'u', turnCredential: 'c' }) });
    h.render();
    const text = textOf(h.root);
    // 第 2 件义务那句来自导出面
    expect(text, '屏上没有 privacy.ts:111 那句').toContain(PRIVACY_COPY.signalAndRelay[1]);
    // 判据 1 的 ④：代码位里**没有**那份文案的字面量（它是运行期取的）
    const code = stripComments(readFileSync(fileURLToPath(new URL('../../src/ui/net-lobby.ts', import.meta.url))).subarray(0, 8 * 1024 * 1024).toString('utf8'));
    for (const line of privacyLines()) {
      expect(code.includes(line), `大厅代码位里出现了 privacyLines() 的整句（抄写）：${line.slice(0, 20)}…`).toBe(false);
    }
    // 反空转：privacyLines() 非空，否则上面那个循环是废话
    expect(privacyLines().length, 'privacyLines() 是空的').toBeGreaterThan(5);
  });

  it('判据 9 · 邀请码长度读数用 `inviteLengthReport`（大厅里零命中那两个区间数）', async () => {
    const inv = await realInvite();
    const r = inviteLengthReport(inv.payload);
    expect(r.chars, 'length report 的 chars 不是载荷长度').toBe(inv.payload.length);
    expect(r.withinMeasuredRange, '真件生成的载荷竟然不在实测区间里').toBe(inv.withinMeasuredRange);
    const code = stripComments(readFileSync(fileURLToPath(new URL('../../src/ui/net-lobby.ts', import.meta.url))).subarray(0, 8 * 1024 * 1024).toString('utf8'));
    // 能力边界（写进注释）：这条腿**只扫这一个文件**，不保证全仓唯一（计划 §2 第 15 条）
    for (const n of ['600', '900']) {
      expect(code.includes(n), `大厅里出现了作为邀请码区间的常量 ${n}（应当走 inviteLengthReport）`).toBe(false);
    }
  });

  it('判据 10 · 短码不自己造字符表 / 归一化：`ILOU23` 的原因由 `normalizeRoomCode` 给', () => {
    // 行为腿：喂一个含歧义字符的码 ⇒ 得到的可读原因与纯层**同一处**产出（逐字比对）
    const mine = normalizeRoomCode('ILOU23');
    expect(mine.ok, '`ILOU23` 竟然被接受了（歧义字符没被挡）').toBe(false);
    if (mine.ok) return;
    // 大厅那边走的是同一个函数（源码腿：大厅里没有第二份字符表 / 剔除逻辑）
    const code = stripComments(readFileSync(fileURLToPath(new URL('../../src/ui/net-lobby.ts', import.meta.url))).subarray(0, 8 * 1024 * 1024).toString('utf8'));
    expect(code.includes('0123456789ABCDEFGHJKMNPQRSTVWXYZ'), '大厅里抄了 Crockford 字符表').toBe(false);
    expect(/\[ILOU\]/.test(code), '大厅里自己写了剔除 I/L/O/U 的逻辑').toBe(false);
    expect(code.includes('normalizeRoomCode'), '大厅没调用唯一的归一化入口').toBe(true);
    // 正控：合法码真的能过（否则"拒绝"没有区分力）
    const ok = normalizeRoomCode('abcdef');
    expect(ok.ok, '合法码被拒了').toBe(true);
    if (ok.ok) {
      expect(ok.code, '归一化没把字母大写').toBe('ABCDEF');
      const ch = roomChannel(ok.code);
      expect(ch.ok).toBe(true);
      if (ch.ok) expect(ch.channel, '频道名前缀不对').toContain('ABCDEF');
    }
  });

  it('判据 12 · `renderNetLobby` 只碰它自己的 root（整屏屏：先清空）', () => {
    const root = mountRoot();
    // 先塞一个"上一屏"的节点进去，渲染之后它必须消失（`root.textContent = ''` 的契约）
    const stale = makeStubEl('div');
    stale.className = 'board';
    root.appendChild(stale);
    expect(descendants(root).length, '夹具失败：预置节点没进去').toBeGreaterThan(1);
    renderNetLobby(root as unknown as HTMLElement, mountLobbyNavFor(root));
    const staleLeft = queryAllIn(root, 'div.board');
    expect(staleLeft.length, '大厅渲染没有清空 root（上一屏的棋盘节点还在）').toBe(0);
    // 它也没有跑到 `document.body` 上（本仓有过 body 级浮层残留的惨痛历史）
    const body = (globalThis as unknown as { document: { body: StubNode } }).document.body;
    expect(queryAllIn(body, 'div.net-lobby-screen').length, '大厅跑到 document.body 上去了').toBe(0);
    void stale;
  });

  it('判据 12 · 大厅**不** import 棋盘渲染器（render.ts / render-net.ts）', () => {
    const code = stripComments(readFileSync(fileURLToPath(new URL('../../src/ui/net-lobby.ts', import.meta.url))).subarray(0, 8 * 1024 * 1024).toString('utf8'));
    for (const banned of ["from './render'", "from './render-net'", 'renderApp(', 'renderNetBoard(']) {
      expect(code.includes(banned), `大厅里出现了棋盘渲染器符号「${banned}」（大厅是独立屏）`).toBe(false);
    }
  });
});

/** 给"只碰自己的 root"那条腿用的最小渲染接缝（不关心动作，只关心清屏） */
function mountLobbyNavFor(_root: StubNode): LobbyRenderNav {
  const s: LobbyState = {
    role: null, sessionId: '', invite: null, joined: null, roomCodeInput: '', roomCodeGate: null,
    transport: 'idle', peer: null, endpoint: '', ice: { servers: [], relayConfigured: false, relayIncomplete: false },
    advancedOpen: false, waitExpired: null, error: null, notice: null, routedIn: 0, routedOut: 0,
  };
  return {
    state: s,
    backHome: () => {}, startHost: () => {}, startJoin: () => {}, makeInvite: () => {},
    inviteLength: () => '', qrNote: () => '', setRoomCode: () => {}, submitRoomCode: () => {},
    joinWithInvite: () => {}, toggleAdvanced: () => {},
    settingsValue: () => '', setSetting: () => {}, errorText: (k) => errorCopy(k),
  };
}

/* ==================================================================== *
 * 7. ★ 判据 14：入站消息必须喂进 `accept` —— 用可注入的假传输驱动一次**完整握手**
 * ==================================================================== */

describe('★ 判据 14 · 入站消息喂进 `accept`（D24 的裁决 + D19）', () => {
  /**
   * 一条**真实路径**的完整握手：
   *
   *   1. 房主侧路由发一条 `hello`（走 `encodeMsg` → 假传输 → `decodeMsg`）；
   *   2. 房主 `accept` 它 ⇒ 产出 `hello-ack`（路由自动发回去）；
   *   3. 加入方路由收到 `hello-ack` ⇒ 喂进 `accept` ⇒ `handshakeDone` 前进、相位到 `awaiting-commit`。
   *
   * 投递由假传输的**显式 pump** 驱动（本仓没有裸定时器）。
   */
  async function driveHandshake() {
    const pair = createFakeTransportPair();
    const a = await pair.A.transport.init({ selfId: 'A', peerId: 'B' });
    const b = await pair.B.transport.init({ selfId: 'B', peerId: 'A' });
    expect(a.ok && b.ok, '夹具失败：假传输没建起来').toBe(true);

    const host = createLobbySessionLink({
      role: 'host',
      transport: pair.A.transport,
      sessionId: 'sid-1',
      hash: browserHash(),
      seat: 0,
      localProtoVersion: PROTO_VERSION,
      localCardDataHash: CARD_DATA_HASH,
    });
    const guest = createLobbySessionLink({
      role: 'guest',
      transport: pair.B.transport,
      sessionId: 'sid-1',
      hash: browserHash(),
      seat: 1,
      localProtoVersion: PROTO_VERSION,
      localCardDataHash: CARD_DATA_HASH,
    });
    return { pair, host, guest };
  }

  /** 房主侧发起握手：把一条**过线**的 `hello` 投给加入方那条链路（由假传输运） */
  async function sendHello(pair: ReturnType<typeof createFakeTransportPair>): Promise<void> {
    const { encodeMsg } = await import('../../src/net/protocol');
    const enc = encodeMsg({
      t: 'hello',
      role: 'player',
      sessionId: 'sid-1',
      protoVersion: PROTO_VERSION,
      cardDataHash: CARD_DATA_HASH,
      seat: 1,
      nick: 'guest',
    });
    expect(enc.ok, '夹具失败：hello 编不出来').toBe(true);
    if (!enc.ok) return;
    // 加入方用它那条链路发出去（`hello` 本来就是这个方向：加入方 → 房主）
    pair.B.transport.sendIfOpen('act', enc.text);
  }

  it('两端 `handshakeDone` **都**前进，加入方相位走到 `awaiting-commit`，且路由记账 > 0', async () => {
    const { pair, host, guest } = await driveHandshake();
    // 起点：两端都还没握手
    expect(host.session.peerStatus().handshakeDone, '房主一开始就握手完成了？夹具不对').toBe(false);
    expect(guest.session.peerStatus().handshakeDone, '加入方一开始就握手完成了？夹具不对').toBe(false);

    await sendHello(pair);
    pair.pump(4); // 显式投递（假传输每步每侧交一帧）

    // ① 两端都前进（只断言一端会让"另一端卡住"漏过去）
    expect(host.session.peerStatus().handshakeDone, '房主没收到 hello（它等的那条入站没进 accept）').toBe(true);
    expect(guest.session.peerStatus().handshakeDone, '加入方没收到 hello-ack（这条路由没把入站喂进 accept）').toBe(true);
    // ② 加入方的相位走到 `awaiting-commit`（D20 的相位名，**不许**写旧名）
    expect(guest.session.phase(), '加入方没有走到 awaiting-commit').toBe('awaiting-commit');
    // ③ 反空转：至少有入站消息真的经过那条路由（否则"握手完成"可能是两端各自本地造出来的）
    expect(guest.routedIn(), '加入方一条入站都没经过路由 ⇒ "握手完成"是假的').toBeGreaterThan(0);
    expect(host.routedIn(), '房主一条入站都没经过路由').toBeGreaterThan(0);
    expect(host.routedOut(), '房主没有把 hello-ack 发出去').toBeGreaterThan(0);
    // 经过线协议的**证据**：假传输里真的有过一帧
    expect(pair.steps().length, '假传输一帧都没运过（那是本地直调，不是走线）').toBeGreaterThan(0);
    expect(pair.steps().some((s) => s.text.includes('hello-ack')), '线上没有出现过 hello-ack').toBe(true);
  });

  it('★ 反证（变异 M8 的形态）：摘掉"入站 → accept"那条路由 ⇒ 加入方**停住**', async () => {
    const { pair, host, guest } = await driveHandshake();
    // 造一个**只有接收面被摘掉**的链路（等价于 M8：收到只记日志、不交给 accept）
    const deaf = {
      session: guest.session,
      receive: (_t: string) => true, // 记一笔就走，不喂 accept
      routedIn: () => 0,
      routedOut: () => 0,
      transportStatus: () => 'online' as const,
      onStatus: () => () => {},
      detach: () => {},
    };
    // 把加入方那条链路从传输上摘掉，换成"聋"的那条
    guest.detach();
    pair.B.transport.onMessage((text) => { deaf.receive(text); });

    await sendHello(pair);
    pair.pump(4);

    // 房主那一侧照常前进（变异只动了加入方的接收面）
    expect(host.session.peerStatus().handshakeDone, '房主侧不该被这条变异影响').toBe(true);
    // ★ 加入方**停住**：这是判据 14 要抓的那个可观测事实
    expect(deaf.routedIn(), '变异在位时路由记账竟然 > 0').toBe(0);
    expect(
      guest.session.peerStatus().handshakeDone,
      '摘掉路由之后加入方仍然握手完成了 ⇒ 判据 14 对这条变异没有区分力',
    ).toBe(false);
    expect(guest.session.phase(), '加入方不该走到 awaiting-commit').not.toBe('awaiting-commit');
    // 反空转：线上**确实运过**那条 hello-ack（不是"没人发"造成的停住）
    expect(pair.steps().some((s) => s.text.includes('hello-ack')), '线上没有 hello-ack ⇒ 上面那条停住不是路由造成的')
      .toBe(true);
  });

  it('能力边界（写实）：这条腿用的是**假件**，不是真 WebRTC / 真信令', async () => {
    const { pair } = await driveHandshake();
    // 假传输没有 `bufferedAmount` 这类东西，"真浏览器里走不走得通"属 T9 的 CDP 线
    expect(typeof pair.A.transport.send, '假传输没有同步 send').toBe('function');
    expect(pair.A.transport.channels().length, '假传输的通道数').toBe(2);
  });
});

/* ==================================================================== *
 * 8. 判据 12 / 13 的补充：渲染面不碰红线文件
 * ==================================================================== */

describe('判据 12 · 渲染面与红线文件划界', () => {
  it('大厅的样式表只带 `net-lobby-` 前缀类（写进 `EXCLUDED_SOURCES` 的理由就是这个）', () => {
    const raw = readFileSync(fileURLToPath(new URL('../../src/ui/styles-net-lobby.css', import.meta.url))).subarray(0, 8 * 1024 * 1024).toString('utf8');
    // ⚠️ 扫描面必须**先剥块注释**：头注里引用了别处的类名（`.board` / `.card` / …，那些正是
    //   "为什么不可能命中棋盘节点"那条理由的正文）—— 不剥就会把**注释**当成选择器，制造假红。
    const css = stripCssComments(raw);
    // 只认"选择器位置上的类名"：前面必须是行首 / 空白 / `,` / `>` / `+` / `~`（后代组合器）
    const classes = [...css.matchAll(/(?:^|[\s,>+~])\.([a-zA-Z][\w-]*)/gm)].map((m) => m[1]);
    expect(classes.length, '样式表里一个类选择器都没有（读错文件了？）').toBeGreaterThan(10);
    const bad = [...new Set(classes)].filter((c) => !c.startsWith('net-lobby-'));
    expect(bad, `大厅样式里出现了非 net-lobby- 前缀的类：${bad.join(', ')}`).toEqual([]);
    // 反空转：剥注释**真的**剥掉了一段（否则上面那条"零违规"可能是"整份文件没读到"）
    expect(raw.length, '剥注释之后比原文还长？').toBeGreaterThan(css.length);
    expect(css.includes('.board'), '头注里那段"为什么不可能命中棋盘节点"的理由没被剥掉（假红来源）').toBe(false);
    expect(raw.includes('.board'), '夹具失败：头注里本来就没有那段理由（说明理由被删了）').toBe(true);
    // 层叠模型**不建模**的两种形态：`!important` 与 ID 选择器
    expect(/!important/.test(css), '大厅样式里出现了 !important（层叠模型不建模它）').toBe(false);
    expect(/^\s*#[a-zA-Z]/m.test(css), '大厅样式里出现了 ID 选择器（层叠模型不建模它）').toBe(false);
  });
});

/** 去掉 CSS 的块注释（`/* … *\/`）——只给上面那条"零命中 !important"用 */
function stripCssComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}
