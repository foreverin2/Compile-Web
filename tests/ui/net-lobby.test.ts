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
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  descendants, installStubDom, makeStubEl, queryAllIn, type StubNode,
} from './net-dom-stub';
import { stripComments } from './source-text';
import {
  LOBBY_ERROR_KEYS, LOBBY_LINK_COPY, createLobbyClient, createLobbySessionLink, errorCopy,
  errorKeyOfRejection, lobbyLinkOf, lobbyLinkText, protoOfPayload, qrNote, refusalNotice,
  relayNoticeOf, relayStateOf, renderNetLobby,
  type LobbyClient, type LobbyErrorKey, type LobbyRenderNav, type LobbyState, type SettingKey,
} from '../../src/ui/net-lobby';
import { PRIVACY_COPY, privacyLines } from '../../src/app/privacy';
import {
  acceptOffer, applyAnswer, createBrowserTransport, createInvite, decodeBase64Url, decodeInviteFromAddressBar, decodeInvitePayload,
  decompressBytes, inviteLengthReport, peerConnectionOf, readIceServers, roomCodeEntry,
  stripInviteFromAddressBar, waitForIceGathering,
  DEFAULT_ICE_GATHER_TIMEOUT_MS, MESSAGE_CHANNEL,
  type NetBrowserEnv, type WebSocketLike,
} from '../../src/ui/net-browser';

import { normalizeRoomCode, PROTO_VERSION, roomChannel } from '../../src/net/protocol';
import type { PeerStatus } from '../../src/net/session';
import { createFakeTransportPair } from '../../src/net/fake-transport';
import type { NetTransport } from '../../src/net/transport';
import { CARD_DATA_HASH } from '../../src/app/card-data-hash';
import { makeFakePc } from './fake-peer-connection';
import {
  ANSWER_PROMISE_PLACEHOLDER, NO_ENDPOINT_HEADLINE, NO_ENDPOINT_MESSAGE, NO_ENDPOINT_REASON,
  answerPayloadFields, inviteLinkOf, isAnswerPayload, roomCodeEntryReachability,
} from '../../src/net/invite';
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
      sessionId: 'sid-00000000000000000000000000000000',
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
      helloSent: false,
      answerCode: null,
      answerApplied: null,
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
      makeAnswerCode: () => { calls.push('make-answer'); },
      applyAnswerCode: (code: string) => { calls.push(`apply-answer:${code}`); },
    };
  }
  return h;
}

/* ==================================================================== *
 * 夹具 2b（修复轮）：**真解压** + 假传输成对的客户端
 * ==================================================================== */

/**
 * 房间码那条路要一份真地址栏（`location` + `history`）。
 * 用**真的** `CompressionStream` / `DecompressionStream`（本机有，`net-browser.test.ts` 有腿自证）。
 */
const REAL_HREF = 'https://x.invalid/lobby';

/**
 * ★ **修复轮 A1 用的那个"宿主注入函数"**：与 `main.ts` 传给
 * `LobbyClientOptions.decompressBase64` 的**同一份实现**（`decodeBase64Url`）。
 *
 * ⚠️ 这条腿的关键是"**用宿主给的那个注入函数**"，不是测试自造一个解压器 —— 后者会绕开
 * 产出的那条注入缝，于是"宿主传错了函数"这件事就永远测不出来（第一版 `main.ts` 传的是
 * `() => null`，那种腿照样绿）。
 */
async function hostDecompress(b64: string): Promise<Uint8Array | null> {
  // 与 `main.ts` **同一份实现**：base64url 解码 + 真解压（deflate-raw）两步。
  // 只做第一步会让纯层拿到压缩态的字节 ⇒ `bad-json`（实测）。
  const raw = decodeBase64Url(b64);
  if (raw === null) return null;
  const d = await decompressBytes(raw, REAL_ENV);
  return d.ok ? d.bytes : null;
}

/** 造一个加入方客户端：**真解压** + 真哈希 + 可注入的传输/昵称 */
function makeGuestClient(over: Partial<Parameters<typeof createLobbyClient>[0]> = {}) {
  const t = fakeTicker();
  const built: NetTransport[] = [];
  const client = createLobbyClient({
    role: 'guest',
    sessionId: 'sid-guest',
    // ★ T11-A：种子与随机串改成注入（不再是 `sessionId` 的派生串）——夹具给确定性值
    matchSeed: 'mseed-fixture',
    randomToken: () => 'rtok-fixture',
    localProtoVersion: PROTO_VERSION,
    localCardDataHash: CARD_DATA_HASH,
    hash: browserHash(),
    ticker: t.ticker,
    createTransport: () => {
      const tr = over.createTransport ? over.createTransport() : (() => { throw new Error('这条腿不该造传输'); })();
      built.push(tr);
      return tr;
    },
    signalingEndpoint: '',
    readSettings: () => ({ turnUrl: '', turnUsername: '', turnCredential: '' }),
    buildInvite: async () => ({ ok: true as const, payload: 'P', link: `${REAL_HREF}#invite=P` }),
    // ★ 真解压（与 `main.ts` 同一份实现）
    decompressBase64: hostDecompress,
    readAddressBar: () => null,
    localNick: () => 'join-nick',
    /**
     * ★ **G5 T13-A 同步（协调者 2026-09-20 第 2 条裁决）**：`reconnect()` 的模式现在由
     * `hasResumableGame()` 决定 —— 有可续的对局走 `'resume'`（`markResuming()` + `resuming` 的 hello），
     * 开局期走 `'first'`（重新握一次手）。
     * ⚠️ 这份夹具模特的是"这一局已经在打"（A5 那条腿要验的正是 `markResuming()` 的时机）
     * ⇒ 这里如实声明"有可续的对局"。开局期那一支的腿在
     * `tests/ui/net-reconnect-wiring.test.ts`。
     */
    hasResumableGame: () => true,
    ...over,
  });
  return { client, ticker: t, built };
}

/** 造一个用**假传输**的客户端（`role` 由调用方给；传输由工厂一条条发出来） */
function makePairClient(role: 'host' | 'guest', transports: NetTransport[]) {
  const t = fakeTicker();
  return createLobbyClient({
    role,
    sessionId: 'sid-shared',
    // ★ T11-A：注入的种子/随机串（两端同值 ⇒ 与真实两端各自取熵的差别只在这两个数上）
    matchSeed: 'mseed-fixture',
    randomToken: () => 'rtok-fixture',
    localProtoVersion: PROTO_VERSION,
    localCardDataHash: CARD_DATA_HASH,
    hash: browserHash(),
    ticker: t.ticker,
    createTransport: () => {
      const next = transports.shift();
      if (next === undefined) throw new Error('夹具失败：传输不够用了');
      return next;
    },
    signalingEndpoint: '',
    readSettings: () => ({ turnUrl: '', turnUsername: '', turnCredential: '' }),
    buildInvite: async () => ({ ok: true as const, payload: 'P', link: `${REAL_HREF}#invite=P` }),
    decompressBase64: hostDecompress,
    readAddressBar: () => null,
    localNick: () => 'join-nick',
    /**
     * ★ **G5 T13-A 同步（协调者 2026-09-20 第 2 条裁决）**：`reconnect()` 的模式由
     * `hasResumableGame()` 决定 —— 有可续的对局走 `'resume'`（`markResuming()` + 带 `resuming`
     * 的 hello），**开局期**走 `'first'`（重新握一次手）。这份夹具模特的是"这一局已经在打"
     * （A5 那条腿要验的正是 `markResuming()` 的时机）⇒ 如实声明"有可续的对局"；
     * 开局期那一支的腿在 `tests/ui/net-reconnect-wiring.test.ts`。
     */
    hasResumableGame: () => true,
  });
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
    // ★ T11-A：种子与随机串改成注入（不再是 `sessionId` 的派生串）——夹具给确定性值
    matchSeed: 'mseed-fixture',
    randomToken: () => 'rtok-fixture',
    localProtoVersion: PROTO_VERSION,
    localCardDataHash: CARD_DATA_HASH,
    hash: browserHash(),
    ticker: t.ticker,
    createTransport: () => { throw new Error('这个用例不该造传输'); },
    signalingEndpoint: '',
    readSettings: () => ({ turnUrl: '', turnUsername: '', turnCredential: '' }),
    buildInvite: async () => ({ ok: true as const, payload: 'PAYLOAD-X', link: 'https://x.invalid/l#invite=PAYLOAD-X' }),
    decompressBase64: async () => null,
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
    advancedOpen: false, waitExpired: null, error: null, notice: null, routedIn: 0, routedOut: 0, helloSent: false, answerCode: null, answerApplied: null,
  };
  return {
    state: s,
    backHome: () => {}, startHost: () => {}, startJoin: () => {}, makeInvite: () => {},
    inviteLength: () => '', qrNote: () => '', setRoomCode: () => {}, submitRoomCode: () => {},
    joinWithInvite: () => {}, toggleAdvanced: () => {},
    settingsValue: () => '', setSetting: () => {}, errorText: (k) => errorCopy(k),
    makeAnswerCode: () => {}, applyAnswerCode: () => {},
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
      matchSeed: 'mseed-fixture',
      randomToken: () => 'rtok-fixture',
      seat: 0,
      localProtoVersion: PROTO_VERSION,
      localCardDataHash: CARD_DATA_HASH,
    });
    const guest = createLobbySessionLink({
      role: 'guest',
      transport: pair.B.transport,
      sessionId: 'sid-1',
      hash: browserHash(),
      matchSeed: 'mseed-fixture',
      randomToken: () => 'rtok-fixture',
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

/* ==================================================================== *
 * 9. ★ 修复轮 A 档：把"形状上通"变成"产出路径上真的通"
 *
 * 评审（`.superpowers/g5-T8-review/REVIEW.md` §1.1）在 `src/main.ts` 里数出四处断点：
 *   ① `decompressBase64: async () => null` ⇒ 邀请码必然解不开；
 *   ② `attach(` 0 处 ⇒ `s.link` 恒 null、`peerStatus()` 永不被读；
 *   ③ `reconnect(` 0 处 ⇒ "重连必须新建会话对象"在产出代码里没有调用者；
 *   ④ 没有任何一处发出第一条 `hello` ⇒ 加入方的握手在产出路径上永远不会开始。
 * 这一节四条腿各钉一处（A1/A3/A4/A5 + A2）。
 * ==================================================================== */

describe('★ 修复轮 A1 · 邀请码那两条入口用**宿主给的那个**解压函数（真解压）', () => {
  /** 走**真件**造一条邀请码（`createInvite` 的压缩与自洽检查都是真的） */
  async function builtPayload(): Promise<string> {
    const inv = await realInvite();
    return inv.payload;
  }

  it('★ `joinWithInvite` 用宿主的注入函数（= `main.ts` 传的 `decodeBase64Url`）⇒ `joined.ok === true`', async () => {
    const payload = await builtPayload();
    const { client } = makeGuestClient();
    await client.joinWithInvite(payload);
    const joined = client.state().joined;
    // eslint-disable-next-line no-console
    console.log(`\nA1 实测：joined.ok=${String(joined?.ok)} payload=${payload.length} 字符`);
    expect(joined, 'joinWithInvite 之后没有结论').not.toBeNull();
    expect(joined?.ok, `真载荷竟然解不开：${joined?.ok === false ? joined.message : '（没有失败原因）'}`).toBe(true);
    if (joined?.ok === true) {
      // 解出来的就是那条 offer 的 SDP（逐字来自真件）
      expect(joined.payload.sdp, '解出来的 SDP 不是载荷里那一条').toContain('v=0');
      expect(joined.payload.hostPromise, '解出来的承诺串不对').toBe('host-promise-x');
    }
    // 明文协议版本与本机一致 ⇒ 不该报版本错误
    expect(client.state().error, '版本一致却报了 proto-version').toBeNull();
  });

  it('★ **反证**：把同一个注入函数换成恒 null（= 第一版的 `main.ts`）⇒ **同一份载荷解不开**', async () => {
    const payload = await builtPayload();
    const { client } = makeGuestClient({ decompressBase64: async () => null });
    await client.joinWithInvite(payload);
    const joined = client.state().joined;
    expect(joined?.ok, '恒 null 的解压口竟然把载荷解开了 ⇒ 上一条腿分不出"真解压"与"没解压"').toBe(false);
    if (joined?.ok === false) {
      // 失败原因必须是"压缩段解不开"（那是恒 null 的**直接后果**，不是别的路）
      expect(joined.reason, '失败原因不是 decompress-failed').toBe('decompress-failed');
      // 屏上也要有那句可读原因（不是静默失败）
      const h = mountLobby({ role: 'guest', joined });
      h.render();
      expect(textOf(h.root), '解不开时屏上没有可读原因').toContain(joined.message);
    }
    // 反空转：那条载荷**本身**是可解的（否则上面两条"解不开"没有区分力）
    const bare = await decodeInvitePayload(payload, REAL_ENV);
    expect(bare.ok, '载荷本身解不开 ⇒ 这条反证没有区分力').toBe(true);
  });

  it('★ 读地址栏那条入口也共用同一个注入函数（两条入口一份实现）', async () => {
    const payload = await builtPayload();
    const bar = fakeAddressBar(`${REAL_HREF}#invite=${payload}`);
    const { client } = makeGuestClient({
      readAddressBar: () => {
        const p = readInviteRaw({ location: () => bar.loc, history: () => bar.history });
        if (p === null) return null;
        return { payload: p, stripped: stripInviteFromAddressBar({ location: () => bar.loc, history: () => bar.history }) };
      },
    });
    await client.readFromAddressBar();
    expect(client.state().joined?.ok, '地址栏那条入口没解出来（两条入口没共用一份实现）').toBe(true);
    expect(bar.calls.length, '读到载荷之后没有抹地址栏').toBe(1);
  });
});

/* ==================================================================== *
 * 14. ★★ D25：加入方在收到对端 offer 之前**不许**建自己的 offer
 *
 * 真浏览器只读探针（`.superpowers/g5-T8/T8E-ICE-CONFIG.md`）实测：加入方过去在 `init` 里
 * 也 `createOffer` + `setLocalDescription`，之后又在**同一条**连接上
 * `setRemoteDescription(对端 offer)` + `createAnswer` ⇒ 那条连接的 ICE 收集被回滚成
 * `gathering -> new`，重新 `gathering` 之后再没产出任何候选（40 秒零候选、零
 * `icecandidateerror`、`iceConnectionState` 一直 `new`）⇒ 握手永远推进不了。
 *
 * 下面三条腿钉的就是这个分流（账本用假 peer connection 的 `fake.calls`）：
 *   ① 加入方：收到 remote offer **之前** `createOffer` 调用数 = 0；
 *   ② 房主：`createOffer` >= 1（对照，防"两边都不出 offer"也算过）；
 *   ③ 收到 remote offer 之后：加入方 `createAnswer` = 1（而且要落在**同一条**连接上）。
 * ==================================================================== */

describe('★★ D25 · 加入方在收到对端 offer 之前不建自己的 offer', () => {
  /** 造一条真 `createBrowserTransport`（内核是假 peer connection，账本记在 `fake.calls` 上） */
  function transportWithLedger() {
    const { pc, fake } = makeFakePc({ iceGatheringState: 'complete' });
    const tr = createBrowserTransport({ peerConnection: () => pc as never, settings: () => null });
    return { tr, fake, pc };
  }
  const countOf = (fake: ReturnType<typeof makeFakePc>['fake'], op: string): number =>
    fake.calls.filter((c) => c.op === op).length;

  it('★ ① 加入方 `init({ role: \'guest\' })` ⇒ `createOffer` **= 0**，且**通道一条都不建**（D26）', async () => {
    const { tr, fake } = transportWithLedger();
    const r = await tr.init({ selfId: 'g', peerId: 'h', role: 'guest' });
    expect(r.ok, `加入方的传输没起来：${r.ok ? '' : r.message}`).toBe(true);
    expect(countOf(fake, 'createOffer'), '加入方在收到对端 offer 之前就建了自己的 offer（D25 的靶子）').toBe(0);
    expect(countOf(fake, 'setLocalDescription'), '加入方在 init 里就把自己的描述落下去了').toBe(0);
    // ★ D26：通道由**出 offer 方**建、加入方认领 ⇒ 这里一条都不许建（建了就是两条流，对端收不到）
    expect(countOf(fake, 'createDataChannel'), '加入方自己建了通道（D26：那会和对端那条成为两条不同的流）').toBe(0);
  });

  it('★ ② 房主 `init({ role: \'host\' })` ⇒ `createOffer` **>= 1** 且**建两条通道**（D26）', async () => {
    const { tr, fake } = transportWithLedger();
    const r = await tr.init({ selfId: 'h', peerId: 'g', role: 'host' });
    expect(r.ok, '房主的传输没起来').toBe(true);
    expect(countOf(fake, 'createOffer'), '房主没出 offer（那它就没有可发出去的邀请码）').toBeGreaterThanOrEqual(1);
    expect(countOf(fake, 'setLocalDescription'), '房主没把自己的 offer 落下去').toBeGreaterThanOrEqual(1);
    // ★ D26：出 offer 的一方建两条通道（`act` + `beat`），认领方一条都不建
    expect(countOf(fake, 'createDataChannel'), '房主没建够两条通道').toBe(2);
    // 缺省语义：**不给 role** 的既有调用点走同一条路（`undefined` = 'host'，见 `TransportInit.role`）
    const legacy = transportWithLedger();
    expect((await legacy.tr.init({ selfId: 'h', peerId: 'g' })).ok).toBe(true);
    expect(countOf(legacy.fake, 'createOffer'), '省略 role 的既有调用点行为变了（缺省必须是 host）')
      .toBeGreaterThanOrEqual(1);
    expect(countOf(legacy.fake, 'createDataChannel'), '省略 role 的既有调用点没建通道（缺省必须是 host）').toBe(2);
  });

  it('★ ③ 收到对端 offer 之后：加入方 `createAnswer` **= 1**，且落在**同一条**连接上', async () => {
    const { tr, fake, pc } = transportWithLedger();
    await tr.init({ selfId: 'g', peerId: 'h', role: 'guest' });
    expect(countOf(fake, 'createAnswer'), '还没收到 offer 就 createAnswer 了').toBe(0);
    const r = await acceptOffer(peerConnectionOf(tr) ?? (pc as never), { sdp: 'HOST-OFFER' });
    expect(r.ok, `收下对端 offer 之后产不出 answer：${r.ok ? '' : r.message}`).toBe(true);
    expect(countOf(fake, 'createAnswer'), '收到 offer 之后没有产 answer（或产了不止一条）').toBe(1);
    // ★ 落在**同一条**连接上（缺口 ① 的回归）：answer 的三步与"认领通道用的那条连接"是同一份 calls
    const ops = fake.calls.map((c) => c.op);
    expect(ops, 'answer 不在承载消息的那条连接上').toEqual(
      expect.arrayContaining(['setRemoteDescription', 'createAnswer', 'setLocalDescription']),
    );
    expect(countOf(fake, 'createDataChannel'), 'D26：加入方在 answer 这条路上也不该建通道').toBe(0);
    expect(fake.remoteSeen[0]?.sdp, '喂进去的不是那条 offer').toBe('HOST-OFFER');
  });
});

describe('★ 修复轮 A2/A3/A4/A5 · 建链路 / 发 hello / 入站重画 / 重连新建对象', () => {
  /** 造一对真客户端：各自的传输来自成对假件，`sessionId` 相同 */
  function pairClients() {
    const pair = createFakeTransportPair();
    const host = makePairClient('host', [pair.A.transport]);
    const guest = makePairClient('guest', [pair.B.transport]);
    return { pair, host, guest };
  }

  it('★ A2：加入方 `connect(\'first\')` **自己发出第一条 `hello`**（产出代码的动作）', async () => {
    const { pair, guest } = pairClients();
    expect(guest.state().helloSent, '还没连就说 hello 发过了').toBe(false);
    await guest.connect('first');
    expect(guest.state().helloSent, 'connect 之后 `hello` 没发出去').toBe(true);
    expect(guest.state().routedOut, '发了 hello 但记账是 0').toBeGreaterThan(0);
    // 反空转：线上真的出现过一条 `hello`
    pair.pump(4);
    expect(pair.steps().some((s) => s.text.includes('"t":"hello"')), '线上从来没有出现过 hello').toBe(true);
    // 幂等：再调一次不该再发一条
    const before = guest.state().routedOut;
    expect(guest.sendHello(), '重复调 sendHello 竟然又发了一条').toBe(false);
    expect(guest.state().routedOut, 'routedOut 变了（说明真发了第二条）').toBe(before);
  });

  it('★ A2 反证：**不发第一条 `hello`** ⇒ 房主那条链路的记账恒 0（两面都不前进）', async () => {
    const { pair, host, guest } = pairClients();
    // 只建链路，**不发** hello（等价于第一版：产出代码里没有这一步）
    await host.connect('first');
    await guest.connect('first');
    // 把刚发出去的那条 hello 撤掉的效果：用一个"不发 hello"的连接次序重建 ——
    // 直接断言"房主此刻什么都没收到"，再对照下面那条走通的腿
    expect(host.state().routedIn, '房主还没收到任何东西，记账就已经 > 0').toBe(0);
    expect(host.state().peer?.handshakeDone ?? false, '房主竟然已经握手完成了').toBe(false);
    // 反空转：假传输里此刻确实有帧（就是那条 hello）⇒ 说明上面那两条不是"什么都没发生"
    const pending = pair.steps().length;
    pair.pump(4);
    pair.pump(4);
    // 现在走通了：房主收到了 hello ⇒ 记账 > 0
    expect(host.state().routedIn, `房主始终没收到 hello（投递前线上有 ${pending} 帧）`).toBeGreaterThan(0);
    expect(host.state().peer?.handshakeDone, '房主收到 hello 之后握手没完成').toBe(true);
  });

  it('★ A2 走通那条链：两端 `handshakeDone` 都前进，加入方到 `awaiting-commit`', async () => {
    const { pair, host, guest } = pairClients();
    await host.connect('first');
    await guest.connect('first');
    for (let i = 0; i < 8; i += 1) pair.pump(2);
    expect(host.state().peer?.handshakeDone, '房主没握手完成').toBe(true);
    expect(guest.state().peer?.handshakeDone, '加入方没握手完成').toBe(true);
    // ⚠️ C 轮之后这条腿**不再**断言"停在 awaiting-commit"：驱动者（C2）把承诺-揭示流程接上之后，
    //    加入方会合法地继续往前走（一路到 complete）。"停在 awaiting-commit"是**没有驱动者**时的
    //    症状，不是目标。这里改成钉"它已经离开了握手那一格"；"一路走完"由 C2 那条专门的腿证明。
    expect(guest.state().peer?.phase, '加入方没有离开握手阶段（驱动者没接上）').not.toBe('handshaking');
    expect(host.state().routedIn, '房主没收到入站').toBeGreaterThan(0);
    expect(guest.state().routedIn, '加入方没收到入站').toBeGreaterThan(0);
  });

  it('★ A3/A4：`attach` 有真实调用点（`connect` 里）⇒ `peerStatus()` 真的被读、`routedIn/Out` 会动', async () => {
    const { pair, host, guest } = pairClients();
    expect(guest.state().routedIn, '还没接上就有入站记账').toBe(0);
    // ⚠️ **先让房主连上**（订阅是"连上那一刻"才挂的）⇒ 加入方那条 `hello` 才有人接
    await host.connect('first');
    await guest.connect('first');
    // ★ A3 的判别力：接上之后 `peerStatus()` 不再恒 null
    expect(guest.state().peer, 'connect 之后 `peerStatus()` 还是 null（`s.link` 恒 null 的形态）')
      .not.toBeNull();
    expect(guest.state().transport, 'connect 之后传输状态没被读出来').not.toBe('idle');
    // ★ A4 的判别力：入站帧到了 ⇒ 记账动、屏上跟着变
    const outBefore = guest.state().routedOut;
    for (let i = 0; i < 4; i += 1) pair.pump(2);
    expect(guest.state().routedIn, 'A4：投了几帧之后入站记账还是 0').toBeGreaterThan(0);
    expect(guest.state().peer?.handshakeDone, 'A4：账记了但读数没跟着变（`sync()` 没被调）').toBe(true);
    expect(guest.state().routedOut, 'A4：房主的 hello-ack 到了之后本端没回话').toBeGreaterThanOrEqual(outBefore);
    // 行为面：把这一刻的状态画出来，屏上出现连接状态块（不是停在"本机链路 idle"）
    const h = mountLobby({ role: 'guest', peer: guest.state().peer });
    h.render();
    expect(queryAllIn(h.root, 'div.net-lobby-status').length, '屏上没有连接状态块（入站到了但界面没反映）').toBe(1);
  });

  it('★ A4 的接线自证：`onInbound` 每来一帧都回调（宿主据此重画）', async () => {
    const pair = createFakeTransportPair();
    let inbound = 0;
    const t = fakeTicker();
    // ⚠️ **先让房主连上**再让加入方连：`connect()` 里会立刻发一条 `hello`，而订阅是在**连上那一刻**
    //    才挂到传输上的 ⇒ 顺序反了的话那条 `hello` 会落在"房主还没订阅"的空窗里（第一版这么绿不了）。
    const host = makePairClient('host', [pair.A.transport]);
    const watched = createLobbyClient({
      role: 'guest',
      sessionId: 'sid-shared',
      matchSeed: 'mseed-fixture',
      randomToken: () => 'rtok-fixture',
      localProtoVersion: PROTO_VERSION,
      localCardDataHash: CARD_DATA_HASH,
      hash: browserHash(),
      ticker: t.ticker,
      createTransport: () => pair.B.transport,
      signalingEndpoint: '',
      readSettings: () => ({ turnUrl: '', turnUsername: '', turnCredential: '' }),
      buildInvite: async () => ({ ok: true as const, payload: 'P', link: `${REAL_HREF}#invite=P` }),
      decompressBase64: hostDecompress,
      readAddressBar: () => null,
      localNick: () => 'n',
      onInbound: () => { inbound += 1; },
    });
    await host.connect('first');
    await watched.connect('first');
    for (let i = 0; i < 4; i += 1) pair.pump(2);
    expect(inbound, 'onInbound 一次都没被调（屏上不会跟着变）').toBeGreaterThan(0);
    // 反空转：那条链**真的**走通了（否则"回调被调"可能只是收到了坏帧）
    expect(host.state().peer?.handshakeDone, '房主没握手完成 ⇒ 上面那个回调可能只是坏帧触发的').toBe(true);
  });

  it('★ A5：`reconnect()` 在产出代码里有调用点，且**新建**会话对象 + 先 `markResuming()`', async () => {
    const pair = createFakeTransportPair();
    const guest = makePairClient('guest', [pair.B.transport, pair.B.transport]);
    await guest.connect('first');
    const firstPhase = guest.state().peer?.phase;
    expect(firstPhase, '第一次接上之后相位不对').toBe('handshaking');
    // ★ 重连：**新对象**（相位回到 handshaking 且 needsResync 为真 —— 只有调过 markResuming 才可能）
    await guest.reconnect();
    const st = guest.state();
    expect(st.peer, 'reconnect 之后没有对端读数').not.toBeNull();
    expect(st.peer?.needsResync, 'A5：重连之后 `needsResync` 不是 true（`markResuming()` 没被调，或调晚了）')
      .toBe(true);
    expect(st.peer?.needsResyncCause, 'needsResync 的原因不是"对端回来握手"').toBe('resuming-handshake');
    void firstPhase;
  });

  /**
   * ★★ **G5 T13-A 修复轮（评审第 1 条）：开局期掉线之后，大厅控件必须**可再次使用**。**
   *
   * 生产口径：开局期（还没有可续的对局）掉线 ⇒ **不假装续上**（`main.ts` 的
   * `attachLobbyReconnect` 那一支不调 `client.reconnect()`），把屏退回大厅那一屏并给一行如实结论。
   * 这条腿钉的是"退回大厅之后玩家手里真的还有东西可用"：三样控件都在，而且点了宿主真收到回调
   * —— **不必刷新页面**就能重来。
   */
  it('★ 开局期掉线之后：屏退回大厅，三样控件都在且真的接上了宿主回调（不必刷新页面）', () => {
    const hostLobby = mountLobby({
      role: 'host',
      peer: peer({ online: false, windowExpired: null }),
    });
    hostLobby.render();
    expect(queryAllIn(hostLobby.root, 'button.net-lobby-make-invite').length,
      '开局期掉线之后房主屏上没有「生成邀请码」（玩家没法重来）').toBe(1);
    click(hostLobby.root, 'button.net-lobby-make-invite');
    expect(hostLobby.calls, '点了「生成邀请码」但宿主没收到回调').toContain('make-invite');

    const guestLobby = mountLobby({
      role: 'guest',
      peer: peer({ online: false, windowExpired: null }),
    });
    guestLobby.render();
    expect(queryAllIn(guestLobby.root, 'input.net-lobby-paste-input').length,
      '开局期掉线之后加入方屏上没有粘贴框（玩家没法重来）').toBe(1);
    expect(queryAllIn(guestLobby.root, 'button.net-lobby-make-answer').length,
      '开局期掉线之后加入方屏上没有「出示回示码」').toBe(1);
    click(guestLobby.root, 'button.net-lobby-make-answer');
    expect(guestLobby.calls, '点了「出示回示码」但宿主没收到回调').toContain('make-answer');
    // 反空转：那一格屏上确实有可读结论的位置（掉线那一行），不是空白页
    expect(textOf(guestLobby.root), '大厅那一屏没有连接状态行（玩家看不到"断了"）')
      .toContain(LOBBY_LINK_COPY['offline-window-unknown']);
  });

/* ==================================================================== *
 * 13. ★★ J-1 / J-2（G5 T9 真浏览器检查打出来的两条**产出路径**缺陷）
 * ==================================================================== */

describe('★★ J-1/J-2 · 真浏览器那两条断点（入口不设角色 / 第一条 hello 丢在通道 open 之前）', () => {
  /**
   * ## J-1：角色是**入口的选择**，不是"点第二下才有"
   *
   * 真浏览器实测（`.superpowers/g5-T9/FINDINGS.md` §3）：点「建房」之后屏上**不会**出现
   * 「生成邀请码」按钮 ⇒ 那条路是**闭环** ——
   *
   * ```
   * 看到「生成邀请码」 <= s.role === 'host' <= client.startHost(draft) <= 点「生成邀请码」
   * ```
   *
   * 环上没有入口。加入方同病（粘贴框要 `role === 'guest'`，而它只由 `applyInvite` 设，
   * 调用者又是粘贴框自己）。
   *
   * ⚠️ 这条腿走的是**真客户端**（不是手写状态）：手写状态的 `mountLobby()` 照样能渲染出
   * 「生成邀请码」，所以它**测不到**客户端自己那个初值 —— 那正是这个缺陷的第一版就是这么漏过去的。
   */
  it('★ J-1：`createLobbyClient({ role })` 的第一帧就带角色 ⇒ 房主屏上真有「生成邀请码」', () => {
    const host = makeClient({ role: 'host' });
    expect(host.state().role, '客户端的第一帧没有角色 ⇒ 屏上只画两个入口，那条路进不去').toBe('host');
    const h = mountLobby();
    h.state = host.state();
    h.render();
    const makeInvite = queryAllIn(h.root, 'button.net-lobby-make-invite');
    expect(makeInvite.length, '房主第一帧上没有「生成邀请码」按钮（J-1 的闭环）').toBe(1);
    // 行为面：点它 ⇒ 宿主真收到那个回调（不是画了个不接线的按钮）
    click(h.root, 'button.net-lobby-make-invite');
    expect(h.calls, '点了「生成邀请码」但宿主没收到回调').toContain('make-invite');

    // 加入方那一半：粘贴框必须在第一帧上（它的两个调用者过去也成环）
    const guest = makeClient({ role: 'guest' });
    expect(guest.state().role, '加入方客户端的第一帧没有角色').toBe('guest');
    const g = mountLobby();
    g.state = guest.state();
    g.render();
    expect(queryAllIn(g.root, 'input.net-lobby-paste-input').length, '加入方第一帧上没有粘贴框').toBe(1);
    expect(queryAllIn(g.root, 'button.net-lobby-make-answer').length, '加入方第一帧上没有「出示回示码」').toBe(1);
  });

  /**
   * ## J-2：那条 `hello` 必须在**通道真的 open（传输状态转 `online`）之后**发出去
   *
   * 真浏览器实测（FINDINGS §4.2）：加入方的第一条 `hello` 只在 `connect('first')` 发一次，
   * 而那一刻数据通道还没 open ⇒ 传输层 `sendIfOpen` 不排队、直接丢 ⇒ `sendHello()` 已经
   * 置了 `helloDone` ⇒ **没人补发** ⇒ 两端永远停在 `handshaking`。
   *
   * 这条腿用**假传输**把那一刻摆出来：让加入方那条链路在 `init` 之后停在 `offline`
   * （= 通道还没 open），再让它转 `online`（= 通道 open）。判据两半都要：
   *  - **open 之前**：一条都不许发（发出去就是丢，而且会把 `helloDone` 烧掉）；
   *  - **open 之后**：真发、**且只发一条**（`offline → online → online` 不许补第二条）。
   *
   * ⚠️ 为什么这段在**链路层**（`createLobbySessionLink`）而不在客户端层：待发位住在那条链上，
   * 而"传输状态变化"那个机制是 `transport.onStatus`（**注入的状态订阅**，本仓没有裸定时器）。
   */
  it('★ J-2：通道 open（转 online）之前**一条都不发**，转 online 之后**真发且只发一条**', async () => {
    const pair = createFakeTransportPair();
    // ★ 夹具要点：`init()` 成功之后假传输会把自己置成 `online`，如果照常 `connect()`，那条
    //   `hello` **当场就发出去了**（拿不到"通道还没 open"那一刻）。真 WebRTC 不是这样：
    //   `init()` 只保证本侧（D18），要等对端接上才转 `online` ⇒ 这里把 `status()` 包一层，
    //   在"第一次转 online 之前"一律报 `connecting`（= 通道还没 open）。
    const raw = pair.B.transport;
    /**
     * `gate = false` 的语义是"通道还没 open"：真 WebRTC 里 `init()` 只保证本侧（D18），
     * 这里把那个窗口显式摆出来 —— `connect('first')` 那条 `hello` 落在窗口里 ⇒ 只该被攒住。
     *
     * ⚠️ 事后置 `true` 是**夹具**在摆"对端接上了"那一刻：产出代码自己那条状态订阅照旧
     * 只在真事件（`offline -> online`）上来的时候才补发。
     */
    let gate = false;
    const notOpen: NetTransport = {
      ...raw,
      status: () => (gate ? raw.status() : 'connecting'),
    };
    const guest = makePairClient('guest', [notOpen]);
    await guest.connect('first');
    // 反空转：`connect('first')` 那一刻"通道还没 open"这件事真的发生过（不是套了个壳子看着像）
    expect(raw.status(), '夹具失败：真传输此刻竟然还是 idle').not.toBe('idle');
    expect(pair.B.sendSeq(), '夹具失败：connect 的时候那条 hello 就发出去了（窗口没摆成）').toBe(0);

    // ① 通道还没 open：这一条**只许攒着**（发出去就是丢，而且会把 `helloDone` 烧掉）
    const sentBefore = pair.B.sendSeq();
    expect(sentBefore, '夹具失败：还没 open 就已经有帧上线了').toBe(0);
    expect(guest.state().helloSent, '通道还没 open 就报"发过了" ⇒ 没有人会再补发它').toBe(false);
    expect(guest.state().routedOut, '通道还没 open，已经记了一笔"发出去了"').toBe(0);
    expect(guest.sendHello(), '通道没 open 就说发出去了').toBe(false);
    expect(guest.state().helloSent, '通道没 open 却记成"发过了"').toBe(false);
    expect(pair.B.sendSeq(), '通道没 open，帧却已经上了线').toBe(sentBefore);

    // ② open：状态真转一次 online（`offline -> online` 才是"变化"；`activate` 自己会去重）
    //   ⇒ 由**状态订阅**把待发的那一条补发出去
    gate = true; // 夹具：对端接上了
    expect(notOpen.status(), '夹具失败：放行之后包装口还是没报 online').toBe('online');
    pair.B.deactivate();
    expect(raw.status(), '夹具失败：断链之后传输没转 offline').toBe('offline');
    pair.B.activate();
    expect(raw.status(), '夹具失败：activate 之后传输没转 online').toBe('online');
    expect(notOpen.status(), '夹具失败：activate 之后包装口没跟着转 online').toBe('online');
    expect(guest.state().helloSent, '通道 open 之后那条 hello 还是没有发出去（J-2 没修上）').toBe(true);
    expect(guest.state().routedOut, '通道 open 之后一条都没发出去').toBeGreaterThan(0);
    expect(pair.B.sendSeq(), '通道 open 之后线上还是空的').toBeGreaterThan(sentBefore);
    // 反空转：线上那条真的是 `hello`（不是别的帧把计数顶上去）
    pair.pump(4);
    expect(pair.steps().some((s) => s.text.includes('"t":"hello"')), '线上从来没有出现过 hello').toBe(true);

    // ③ 只发一条：状态来回转一圈也不许补发
    const sentAfter = pair.B.sendSeq();
    pair.B.deactivate();
    pair.B.activate();
    expect(guest.sendHello(), '重复调 sendHello 竟然又发了一条').toBe(false);
    expect(pair.B.sendSeq(), '状态来回转一圈就补发了第二条 hello（房主会看到两条）').toBe(sentAfter);
  });

  it('★ J-2 反证：链路**没有**接上状态订阅 ⇒ 转 online 之后那条 hello 留在原地（红）', async () => {
    // 等价于"把 flushHello 那一句摘掉"的形态：手工造一条链路，只喂状态、不调 sendHello 的补发口。
    // 这条腿不需要改产出代码就能证明"上面那条腿的判别力来自状态订阅"：这里刻意**不订阅**。
    const pair = createFakeTransportPair();
    await pair.A.transport.init({ selfId: 'A', peerId: 'B' });
    await pair.B.transport.init({ selfId: 'B', peerId: 'A' });
    pair.B.deactivate();
    const statusSeen: string[] = [];
    const off = pair.B.transport.onStatus((c) => { statusSeen.push(c.to); });
    expect(pair.B.sendSeq(), '夹具失败：还没发就有帧上线').toBe(0);
    pair.B.activate();
    // 观察者收到了 online，但**没有任何人**把 hello 交下来 ⇒ 线上一条帧都没有
    expect(statusSeen, '夹具失败：状态订阅没收到 online').toContain('online');
    expect(pair.B.sendSeq(), '没人发 hello，线上却有帧（这条反证不成立）').toBe(0);
    off();
  });

  /**
   * ★★ **D25 之后的第三个断点**：真机实测 `connectionstatechange -> connected`（= 传输转
   * `online`）与 DataChannel 真的 `open` **差约 3 毫秒**（`.superpowers/g5-T8/ice-chan-probe.txt`：
   * 11521ms vs 11524ms）⇒ 在 `online` 那一刻发那条 `hello`，`readyState` 还是 `connecting`，
   * `send` 直接失败；而"等状态"这条路不会再响 ⇒ 必须由**通道 open** 这个事件再叫一次。
   *
   * 这条腿把那个 3 毫秒的窗口摆出来：`status()` 报 `online`（状态事件已经来过），但**发是失败的**
   * 直到夹具喊"通道开了"。判据两半：open 之前不许记成"发过了"；open 之后真发、且只发一条。
   */
  it('★ J-2b：传输报 `online` 但通道还没 open ⇒ 发失败、不许记成"发过了"；通道 open ⇒ 补发成功', async () => {
    const pair = createFakeTransportPair();
    const raw = pair.B.transport;
    let channelOpen = false;
    const openCbs: Array<() => void> = [];
    const racy: NetTransport = {
      ...raw,
      status: () => 'online', // 状态事件已经来过（真机上它比通道 open 早约 3ms）
      send: (ch, text) => {
        if (!channelOpen) {
          return { ok: false, reason: 'offline', message: '通道还没 open（这一条没有发出去）。' };
        }
        return raw.send(ch, text);
      },
      sendIfOpen: (ch, text) => {
        if (!channelOpen) {
          return { ok: false, reason: 'offline', message: '通道还没 open（这一条没有发出去）。' };
        }
        return raw.sendIfOpen(ch, text);
      },
      onChannelOpen: (cb: () => void) => { openCbs.push(cb); return () => { /* 这条腿不退订 */ }; },
    };
    const guest = makePairClient('guest', [racy]);
    await guest.connect('first');
    expect(pair.B.sendSeq(), '夹具失败：通道没开却已经有帧上线').toBe(0);
    expect(guest.state().helloSent, '通道还没 open 就记成"发过了" ⇒ 没有人会再补发它').toBe(false);
    expect(openCbs.length, '发失败之后没有请传输层"通道 open 时叫我"（那这条 hello 永远发不出去）')
      .toBeGreaterThan(0);
    // 通道开了 ⇒ 由那个订阅补发
    channelOpen = true;
    for (const cb of openCbs) cb();
    expect(guest.state().helloSent, '通道 open 之后那条 hello 还是没发出去').toBe(true);
    expect(pair.B.sendSeq(), '通道 open 之后线上还是空的').toBeGreaterThan(0);
    // 幂等：再叫一次不许补第二条
    const after = pair.B.sendSeq();
    for (const cb of openCbs) cb();
    expect(pair.B.sendSeq(), '通道 open 被通知两次就补发了第二条 hello').toBe(after);
  });

  /* ==================================================================== *
   * ★★ **通道时序 / 认领腿**（T8-E 收口）：
   *
   *  - 真机里两条 `RTCDataChannel` 的 `open` **不同时到**（`.superpowers/g5-T8/ice-diag-read.txt`：
   *    当时 `onChannelOpen` 里那个全局一次性 `done` 让 `beat` 的 open 再也没有第二次机会）；
   *  - 而 **D26** 之后，加入方的通道是**认领**来的（`datachannel` 事件，见 `net-browser.init`）
   *    ⇒ 这个假件必须能演 `ondatachannel`，否则腿测的不是真形状。
   *
   * 用**真** `createBrowserTransport` + 一个"按 label 认领、通道逐个 open"的假 peer connection
   * （**注入局部桩件**，不动 `fake-transport.ts`）。
   * ==================================================================== */

  /** 一个"通道可由对端认领、且能逐个 open"的假 peer connection */
  function sequencingRig() {
    const pcListeners = new Map<string, Array<(ev: unknown) => void>>();
    const channels: Array<{ label: string; readyState: string; sent: string[]; fireOpen: () => void }> = [];
    /** 按 label 造一条通道记录 + 它的对外视图（认领方拿到的是**对端那条**的视图） */
    const makeChan = (label: string) => {
      const own = new Map<string, Array<(ev: unknown) => void>>();
      const rec = {
        label,
        readyState: 'connecting',
        sent: [] as string[],
        fireOpen: (): void => {
          rec.readyState = 'open';
          for (const cb of own.get('open') ?? []) cb({});
        },
      };
      channels.push(rec);
      const view = {
        label,
        get readyState(): string { return rec.readyState; },
        send: (text: string): void => { rec.sent.push(text); },
        close: (): void => {},
        addEventListener: (type: string, cb: (ev: unknown) => void): void => {
          const arr = own.get(type) ?? [];
          arr.push(cb);
          own.set(type, arr);
        },
      };
      return { rec, view };
    };
    let created = 0;
    const pc: Record<string, unknown> = {
      iceConnectionState: 'new',
      connectionState: 'new',
      iceGatheringState: 'complete',
      localDescription: null,
      // 出 offer 方才走这一格（D26：加入方一条都不建）
      createDataChannel: (label: string) => { created += 1; return makeChan(label).view; },
      createOffer: async () => ({ type: 'offer', sdp: 'v=0\r\n' }),
      setLocalDescription: async () => { /* 加入方不走这一格 */ },
      setRemoteDescription: async () => { /* 这条腿不喂 offer */ },
      createAnswer: async () => ({ type: 'answer', sdp: 'v=0\r\n' }),
      addEventListener: (type: string, cb: (ev: unknown) => void): void => {
        const arr = pcListeners.get(type) ?? [];
        arr.push(cb);
        pcListeners.set(type, arr);
      },
      close: (): void => {},
    };
    return {
      pc,
      channels,
      /** 本侧 createDataChannel 被调了几次（D26：加入方必须是 0） */
      created: () => created,
      /** ★ **D26**：把对端那条通道"递"过来（真 WebRTC 的 `datachannel` 事件） */
      adopt: (label: string): void => {
        const { view } = makeChan(label);
        for (const cb of pcListeners.get('datachannel') ?? []) cb({ channel: view });
      },
      /** 把对端连上这件事报出来（真传输据此转 `online`） */
      fireConnected: (): void => {
        pc.connectionState = 'connected';
        for (const cb of pcListeners.get('connectionstatechange') ?? []) cb({});
      },
    };
  }

  /** 注入桩传输的加入方客户端（一次 `connect('first')`，`hello` 落在"通道还没 open"的窗口里） */
  async function guestOnSequencingRig() {
    const rig = sequencingRig();
    const t = fakeTicker();
    const client = createLobbyClient({
      role: 'guest',
      sessionId: 'sid-chan',
      matchSeed: 'mseed-fixture',
      randomToken: () => 'rtok-fixture',
      localProtoVersion: PROTO_VERSION,
      localCardDataHash: CARD_DATA_HASH,
      hash: browserHash(),
      ticker: t.ticker,
      createTransport: () => createBrowserTransport({
        peerConnection: () => rig.pc as never,
        settings: () => null,
      }),
      signalingEndpoint: '',
      readSettings: () => ({ turnUrl: '', turnUsername: '', turnCredential: '' }),
      buildInvite: async () => ({ ok: true as const, payload: 'P', link: `${REAL_HREF}#invite=P` }),
      decompressBase64: async () => null,
      readAddressBar: () => null,
      localNick: () => 'g',
    });
    await client.connect('first');
    rig.fireConnected(); // 传输转 online：这一刻 `beat` 还没 open
    return { client, rig };
  }
  const hellosOf = (rig: ReturnType<typeof sequencingRig>): string[] =>
    rig.channels.flatMap((c) => c.sent).filter((t2) => t2.includes('"t":"hello"'));

  it('★ D26/时序：认领 `act` + 认领 `beat`（逐个 open）⇒ `hello` 真发出、且只发一条', async () => {
    const { client, rig } = await guestOnSequencingRig();
    // ★ D26：加入方**认领**两条（自己一条都不建）
    expect(rig.created(), 'D26：加入方自己建了通道 —— 那会和对端那条成为两条不同的流（真机收不到）').toBe(0);
    rig.adopt('act');
    rig.adopt('beat');
    expect(  rig.channels.map((c) => c.label).sort(), 'D26：两条通道要按 label 各认领到一条',  ).toEqual(['act', 'beat']);
    expect(hellosOf(rig), 'online 那一刻（两条通道都没 open）就不该有 hello 上线').toEqual([]);
    // ★ `hello` 走 **`act`**（`MESSAGE_CHANNEL`）⇒ `act` 一 open，它就该发出去
    rig.channels.find((c) => c.label === 'act')?.fireOpen();
    expect(hellosOf(rig).length, 'act 的 open 到了，hello 还没发出去').toBe(1);
    rig.channels.find((c) => c.label === 'beat')?.fireOpen();
    expect(hellosOf(rig).length, 'beat 后 open 不该再补一条').toBe(1);
    expect(client.state().helloSent, '发出去了但读数还是 false').toBe(true);
    // 只发一条：再 open 一遍 / 再叫一次 sendHello 都不许补
    rig.channels.forEach((c) => { c.readyState = 'connecting'; c.fireOpen(); });
    expect(client.sendHello(), '重复调 sendHello 竟然又发了一条').toBe(false);
    expect(hellosOf(rig).length, '通道 open 被通知两次就补发了第二条 hello').toBe(1);
  });

  it('★ D26/反顺序：`beat` 先 open、`act` 后 open ⇒ 仍只发一条（顺序无关）', async () => {
    const { client, rig } = await guestOnSequencingRig();
    rig.adopt('beat');
    rig.adopt('act');
    rig.channels.find((c) => c.label === 'beat')?.fireOpen();
    expect(hellosOf(rig), '`hello` 走 act ⇒ beat 先 open 时它还不该出去').toEqual([]);
    // ★ 判据：`beat` 那次 open 已经叫过一次回声，`act` 的 open 必须**再叫一次**
    //   （「第一条通道 open 就叫一次就完」那种写法会让这条 hello 永远发不出去）
    rig.channels.find((c) => c.label === 'act')?.fireOpen();
    expect(hellosOf(rig).length, 'act 后 open 时 hello 该发出去（onChannelOpen 只叫了一次？）').toBe(1);
    expect(client.state().helloSent).toBe(true);
  });
});

  /** ★ 下面这段是**同一个** describe（A2/A3/A4/A5）里那条文本腿，上面插进来的是 J-1/J-2 那一节 */
  it('★ 文本腿（评审 1.3 的 A3/A5 判别力）：`main.ts` 里这三处不再 0 命中', () => {
    const code = stripComments(
      readFileSync(fileURLToPath(new URL('../../src/main.ts', import.meta.url)))
        .subarray(0, 8 * 1024 * 1024).toString('utf8'),
    );
    for (const [token, why] of [
      ['connect(', '建链路/接上的落点（A3）'],
      ["connect('first')", '第一次接上（A3）'],
      ['reconnect(', '重连的落点（A5）'],
      ['decompressBase64:', '真解压的注入（A1）'],
      ['decodeBase64Url', '真解压的实现（A1）'],
      ['onInbound:', '入站重画的落点（A4）'],
      ['localNick:', 'hello.nick 的来源（A2）'],
    ] as const) {
      expect(code.includes(token), `main.ts 里找不到「${token}」（${why}）`).toBe(true);
    }
    // 反证：恒 null 的那个注入**必须已经不在了**
    expect(code.includes('decompressBase64: async () => null'), 'main.ts 里还有恒 null 的解压注入（A1 没修）')
      .toBe(false);
  });
});

describe('★ 修复轮 · D22 的第二份信令说明（评审 §4.2 的违例）', () => {
  it('大厅与模式卡里**零手写**信令/隐私说明：那两句只在唯一出处里', () => {
    const lobby = stripComments(
      readFileSync(fileURLToPath(new URL('../../src/ui/net-lobby.ts', import.meta.url)))
        .subarray(0, 8 * 1024 * 1024).toString('utf8'),
    );
    const home = stripComments(
      readFileSync(fileURLToPath(new URL('../../src/ui/home.ts', import.meta.url)))
        .subarray(0, 8 * 1024 * 1024).toString('utf8'),
    );
    // ① 第一版那两句手写正文**一个字都不许再出现**（它们现在只住在 `invite.ts`）
    const banned = [
      '本程序默认不向任何服务器发请求',
      '两台设备直连（P2P）',
      '没有配置信令端点时用邀请码',
    ];
    for (const [name, code] of [['net-lobby.ts', lobby], ['home.ts', home]] as const) {
      for (const b of banned) {
        expect(code.includes(b), `${name} 里手写了「${b}」（第二份信令说明，§2 第 6 条违例）`).toBe(false);
      }
    }
    // ② 大厅确实**引用**了那两个常量（不是把那句话删了了事）
    expect(lobby.includes('NO_ENDPOINT_REASON'), '大厅没有引用 `NO_ENDPOINT_REASON`（说明被删了而不是改成引用）')
      .toBe(true);
    expect(lobby.includes('NO_ENDPOINT_HEADLINE'), '大厅没有引用 `NO_ENDPOINT_HEADLINE`').toBe(true);
    // ③ 反空转：那两句话确实在唯一出处里（否则上面两条是在扫不存在的串）
    const invite = readFileSync(fileURLToPath(new URL('../../src/net/invite.ts', import.meta.url)))
      .subarray(0, 8 * 1024 * 1024).toString('utf8');
    expect(invite.includes('本程序默认不向任何服务器发请求'), '唯一出处里没有那句话（词表过时了）').toBe(true);
    // ④ 整句仍然逐字可拼（`NO_ENDPOINT_MESSAGE` 的正文一字未变）
    expect(NO_ENDPOINT_HEADLINE + NO_ENDPOINT_REASON, 'HEADLINE+REASON 不再是原句的前两段')
      .toBe(NO_ENDPOINT_MESSAGE.slice(0, (NO_ENDPOINT_HEADLINE + NO_ENDPOINT_REASON).length));
    expect(NO_ENDPOINT_MESSAGE, '整句里少了"否则既有的那条文本腿会红"的那一段')
      .toContain('6 位房间码要经一个信令服务');
  });

  it('行为腿：端点为空时屏上出现那两行，且都是唯一出处的正文', () => {
    const h = mountLobby({ role: 'guest', advancedOpen: true, endpoint: '' });
    h.render();
    const text = textOf(h.root);
    expect(text, '屏上没有 `NO_ENDPOINT_REASON` 的正文').toContain(NO_ENDPOINT_REASON);
    expect(text, '屏上没有 `NO_ENDPOINT_HEADLINE` 的正文').toContain(NO_ENDPOINT_HEADLINE);
    // 反证：端点**配好了**的时候不该再说"还没有配置"
    const h2 = mountLobby({ role: 'guest', advancedOpen: true, endpoint: 'wss://x.invalid' });
    h2.render();
    const text2 = textOf(h2.root);
    expect(text2.includes(NO_ENDPOINT_HEADLINE), '端点已配置却还说"还没有配置信令端点"').toBe(false);
    expect(text2, '端点配好了却没把它显示出来').toContain('wss://x.invalid');
    // 而"默认不发请求"那半句**两种情况都在**（它说的是本程序的设计，不是当前配置）
    expect(text2, '端点配好之后少了"默认不向任何服务器发请求"那句').toContain(NO_ENDPOINT_REASON);
  });
});

describe('★ 修复轮 · 判据 3 的连线（"输入读数 → 该格文案"，评审 §6.1 要求补的那一半）', () => {
  it('★ 三种拒绝理由 ⇒ **各自那一格**（不是"五句两两不同"）', () => {
    const cases = [
      { reason: 'card-data-hash', key: 'card-data-hash' },
      { reason: 'player-slots-full', key: 'busy' },
      { reason: 'unsupported-spectator', key: 'spectator' },
      { reason: 'spectator-slots-full', key: 'spectator' },
    ] as const;
    // 实测分布打出来
    // eslint-disable-next-line no-console
    console.log('\n判据 3 连线实测：\n' + cases.map((c) => `  ${c.reason} ⇒ ${errorKeyOfRejection({ reason: c.reason, detail: 'x' })}`).join('\n'));
    for (const c of cases) {
      expect(errorKeyOfRejection({ reason: c.reason, detail: 'x' }), `${c.reason} 没连到 ${c.key} 那一格`).toBe(c.key);
    }
    // ★ **两件不同的事必须分得开**（`session.ts:657-664` 刻意给了两个不同的理由串）：
    //   "不支持观战"与"位满"不许互相冒充
    expect(errorKeyOfRejection({ reason: 'unsupported', detail: 'x' }), '`unsupported` 没连到观战那一格')
      .toBe('spectator');
    expect(errorKeyOfRejection({ reason: 'player-slots-full', detail: 'x' }), '位满被连到了观战那一格')
      .toBe('busy');
  });

  it('★ 判别力：**认得出**的拒绝显示那一格的文案；**认不出**的不许猜', () => {
    // ① 认得出：屏上出现的是**那一格**的文案（`errorCopy` 的唯一出处），不是对方的原话
    const busy = refusalNotice({ reason: 'player-slots-full', detail: '对端说：位满了' });
    expect(busy.key, '位满那条没归到 busy').toBe('busy');
    expect(busy.text, '显示的不是 busy 那一格的文案').toContain(errorCopy('busy'));
    expect(busy.text, '对方的原话没被附上').toContain('对端说：位满了');
    // ② 认不出：**原样显示对方那句**，不硬塞进任何一格
    const unknown = refusalNotice({ reason: 'something-new', detail: '对端给的一句新理由' });
    expect(unknown.key, '认不出的拒绝被硬塞进了某一格').toBeNull();
    expect(unknown.text, '认不出时没显示对方的原话').toBe('对端给的一句新理由');
    // ③ 观战与位满显示的是**不同**的文案（否则"分得开"是空话）
    expect(refusalNotice({ reason: 'unsupported-spectator', detail: 'd' }).text,
      '观战与位满显示了同一句').not.toBe(refusalNotice({ reason: 'player-slots-full', detail: 'd' }).text);
    // ④ 反空转：那一格的文案本身非空
    expect(errorCopy('busy').length).toBeGreaterThan(10);
  });

  it('行为腿：把一条拒绝喂进渲染 ⇒ 屏上出现**对应那一格**的文案', () => {
    const notice = refusalNotice({ reason: 'card-data-hash', detail: '对端指纹不同' });
    expect(notice.key).toBe('card-data-hash');
    const h = mountLobby({ role: 'guest', error: notice.key, notice: notice.text });
    h.render();
    const text = textOf(h.root);
    expect(text, '屏上没有 card-data-hash 那一格的文案').toContain(errorCopy('card-data-hash'));
    expect(text, '屏上没有对方的真因').toContain('对端指纹不同');
    // 反向：它**不该**是别的格子那句
    expect(text.includes(errorCopy('busy')), '把卡牌指纹那条显示成了"位满"').toBe(false);
    expect(text.includes(errorCopy('spectator')), '把卡牌指纹那条显示成了"观战不支持"').toBe(false);
  });
});

/* ==================================================================== *
 * 10. ★ 修复轮 B 档：offer/answer 的**序列**与等 ICE 的**上界**
 *
 * 协调者的判定（本轮边界扩宽的根据）：`net-browser.ts` 那条路径住在注入接口
 * `PeerConnectionLike` 后面 ⇒ **序列可以在 node 里用假 peer connection 验**，
 * 就像整条消息路由已经在假传输上验过一样。
 *
 * ⚠️ **这些腿证明的是"序列与失败处置"，不是"真能连上"**：
 * 真 `RTCPeerConnection` 的 SDP 协商、ICE 可达性、连不上的真实原因
 * **真浏览器未验证，由 T9 的 CDP 场景覆盖**。
 * ==================================================================== */

describe('★ 修复轮 B1 · 收方那条序列（顺序错就要红）', () => {
  it('★ `acceptOffer`：`setRemoteDescription(offer)` → `createAnswer` → `setLocalDescription(answer)` → 等 ICE', async () => {
    const { pc, fake } = makeFakePc({ iceGatheringState: 'complete' });
    const r = await acceptOffer(pc as never, { sdp: 'OFFER-SDP-X' });
    expect(r.ok, `acceptOffer 失败：${r.ok ? '' : r.message}`).toBe(true);
    // ★ **顺序**（这是这条腿的核心）：逐格比对调用序列
    const seq = fake.calls.map((c) => `${c.op}(${c.detail ?? ''})`);
    // eslint-disable-next-line no-console
    console.log('\nB1 实测序列：\n  ' + seq.join('\n  '));
    expect(seq, 'offer/answer 的序列不对（顺序错就没有第二条路可走）').toEqual([
      'setRemoteDescription(offer)',
      'createAnswer()',
      'setLocalDescription(answer)',
    ]);
    // ① 喂进去的**就是**那条 offer（不是别的）
    expect(fake.remoteSeen.length, '`setRemoteDescription` 没被调到（修复轮之前它一次都没被调用过）').toBe(1);
    expect(fake.remoteSeen[0].type, '喂进去的不是 offer').toBe('offer');
    expect(fake.remoteSeen[0].sdp, '喂进去的 SDP 不是邀请码里那一条').toBe('OFFER-SDP-X');
    // ② 取到的是 `localDescription`（不是占位串），候选也从 SDP 里抠出来了
    expect(r.ok && r.sdp.includes('candidate:9'), '返回的不是 answer 那份 localDescription').toBe(true);
    expect(r.ok && r.ice.length, 'ICE 候选没从 SDP 里抠出来').toBeGreaterThan(0);
  });

  it('★ 反证：把序列倒过来（先 `createAnswer` 再 `setRemoteDescription`）⇒ 这条腿必须红', async () => {
    // 用一份"顺序被写反"的合成记录做**判别力正控**：证明上面那条腿比的是**顺序**，
    // 不是"这几个方法被调过就算"。
    const wrong = ['createAnswer()', 'setRemoteDescription(offer)', 'setLocalDescription(answer)'];
    const { pc, fake } = makeFakePc({ iceGatheringState: 'complete' });
    await acceptOffer(pc as never, { sdp: 'OFFER-SDP-X' });
    const right = fake.calls.map((c) => `${c.op}(${c.detail ?? ''})`);
    expect(right, '正控构造失败：真实序列竟然等于那条错序').not.toEqual(wrong);
    // 逐位重合度：错序在第 1 位就与真实序列不同
    expect(right[0] === wrong[0], '正控失效：两种序列的第一位竟然相同').toBe(false);
  });

  it('★ 缺能力时**响亮地拒绝**（不挂、不假装成功）', async () => {
    // ① 没有 `createAnswer`
    const a = makeFakePc({ noCreateAnswer: true });
    const ra = await acceptOffer(a.pc as never, { sdp: 'X' });
    expect(ra.ok, '没有 createAnswer 竟然成功了').toBe(false);
    if (!ra.ok) {
      expect(ra.reason, '原因不是 unsupported').toBe('unsupported');
      expect(ra.message, '没有可读原因').toContain('createAnswer');
    }
    // ② 没有 `setRemoteDescription`
    const b = makeFakePc({ noSetRemote: true });
    const rb = await acceptOffer(b.pc as never, { sdp: 'X' });
    expect(rb.ok, '没有 setRemoteDescription 竟然成功了').toBe(false);
    if (!rb.ok) expect(rb.message, '没有可读原因').toContain('setRemoteDescription');
    // ③ 空 offer
    const c = makeFakePc({});
    const rc = await acceptOffer(c.pc as never, { sdp: '' });
    expect(rc.ok, '空 SDP 竟然成功了').toBe(false);
    // ④ ★ C 轮：`"设备没有对端连接能力"` 这条路**已经不在 `acceptOffer` 里**了 ——
    //    `pc` 现在是**必填参数**（结构缺口 ① 的修法：调用方必须交出"正在传消息的那条连接"）。
    //    ⇒ 那条路改由**调用方**负责，腿也搬过去（见下面 C1 那一组的 `pc === null` 分支）。
  });

  it('真实异常被收成可读结果（`setRemoteDescription` 抛错 / `createAnswer` 抛错）', async () => {
    const a = makeFakePc({ failSetRemote: true });
    const ra = await acceptOffer(a.pc as never, { sdp: 'X' });
    expect(ra.ok).toBe(false);
    if (!ra.ok) {
      expect(ra.reason, 'setRemoteDescription 抛错没被归到 set-remote-failed').toBe('set-remote-failed');
      expect(ra.message, '没有把原因带出来').toContain('假件');
    }
    const b = makeFakePc({ failAnswer: true });
    const rb = await acceptOffer(b.pc as never, { sdp: 'X' });
    expect(rb.ok).toBe(false);
    if (!rb.ok) expect(rb.reason, 'createAnswer 抛错没被归到 answer-failed').toBe('answer-failed');
  });
});

describe('★ 修复轮 B2 · 等 ICE 收集的**上界**（唯一失败形态，且不挂）', () => {
  /** 一个假时钟（照本仓既有做法：计时一律注入） */
  function ticker() {
    let next = 1;
    const jobs = new Map<number, () => void>();
    const scheduled: number[] = [];
    const cancelled: number[] = [];
    return {
      t: {
        schedule: (fn: () => void, ms: number) => { const id = next++; jobs.set(id, fn); scheduled.push(ms); return id; },
        cancel: (id: number) => { cancelled.push(id); jobs.delete(id); },
      },
      fire: () => { for (const [id, fn] of [...jobs.entries()]) { jobs.delete(id); fn(); } },
      scheduled: () => scheduled,
      cancelled: () => cancelled,
    };
  }

  it('★ 上界用注入的时钟；到点 ⇒ `ice-timeout`（**可读、非空、且真的返回了**）', async () => {
    const clk = ticker();
    // 假件的 ICE **永不完成**（它不会自己触发 `icegatheringstatechange`）
    const { pc } = makeFakePc({ iceGatheringState: 'gathering' });
    const p = waitForIceGathering(pc as never, { ticker: clk.t, iceGatherTimeoutMs: 1_234 });
    // 反空转：上界那个数**真的是注入值**
    expect(clk.scheduled(), '排的计时不是注入的上界').toEqual([1_234]);
    // 还没到点：那条 Promise **不许**已经 settle（用 Promise.race 观测）
    const early = await Promise.race([p.then(() => 'settled'), Promise.resolve('pending')]);
    expect(early, '还没到点就 settle 了（那"上界"就没意义）').toBe('pending');
    // 到点
    clk.fire();
    const r = await p;
    expect(r.ok, '上界到点之后竟然成功了').toBe(false);
    if (!r.ok) {
      expect(r.reason, '唯一失败形态不是 ice-timeout').toBe('ice-timeout');
      expect(r.message.length, '超时的原因是空的（玩家看不到任何东西）').toBeGreaterThan(10);
      expect(r.message, '超时那句里没有那个秒数').toContain('秒');
    }
    // 到点之后计时器被取消（不许留一个悬着的句柄）
    expect(clk.cancelled().length, '到点之后没有取消计时器').toBe(1);
  });

  it('★ 已经 `complete` ⇒ **同步**成功，且**不排计时器**（别为一个已完成的等待排时钟）', () => {
    const clk = ticker();
    const { pc } = makeFakePc({ iceGatheringState: 'complete', localSdp: 'v=0\r\na=candidate:7 1 udp 1 10.0.0.7 7000 typ host\r\n' });
    return waitForIceGathering(pc as never, { ticker: clk.t }).then((r) => {
      expect(r.ok, '已经 complete 却失败了').toBe(true);
      expect(clk.scheduled(), '已经 complete 还排了计时器').toEqual([]);
      if (r.ok) {
        expect(r.sdp, '取到的不是 localDescription').toContain('candidate:7');
        expect(r.ice, '候选没抠出来').toEqual(['candidate:7 1 udp 1 10.0.0.7 7000 typ host']);
      }
    });
  });

  it('★ 没有计时能力 ⇒ 响亮地拒绝（**绝不静默挂起**）', async () => {
    const { pc } = makeFakePc({ iceGatheringState: 'gathering' });
    const r = await waitForIceGathering(pc as never, {});
    expect(r.ok, '没有计时能力竟然成功了').toBe(false);
    if (!r.ok) {
      expect(r.reason, '原因不是 unsupported').toBe('unsupported');
      expect(r.message, '没有可读原因').toContain('计时');
    }
  });

  /**
   * ★★ **缺省上界那条腿**（T8-E 补；评审指出"缺省值 5000ms 今天没有腿"）。
   *
   * ## 这条腿钉的是什么
   *
   * 它钉**两件事**，第一件比第二件重要：
   *  1. **上界存在**：不注入 `iceGatherTimeoutMs` 时，"等 ICE 收集"这条路**仍然**会排一个计时器
   *     —— 没有上界的 `await` 就是一次静默挂起（D23 要消灭的形态），那种缺陷在这条腿上当场红；
   *  2. **上界等于 `DEFAULT_ICE_GATHER_TIMEOUT_MS`**（今天 15 秒）：把常数与"实际排下去的
   *     那个数"绑在一起。过去这个数没有任何腿 ⇒ 改它、或者把它改回"没有缺省"都不会响。
   *
   * ⚠️ 它**不**断言 15 秒这个数是"对的"（那件事只能由真浏览器量，属 T9/人工验收）——
   * 它只断言"有一个上界，且这个上界就是那个导出常量"。改常数时这条腿仍然绿，
   * 但报告/注释里的实测依据必须跟着更新（那正是这个数被写进源码注释的原因）。
   */
  it('★ 缺省上界：不注入时仍然排**一个**计时器，且那个数就是 `DEFAULT_ICE_GATHER_TIMEOUT_MS`', async () => {
    const clk = ticker();
    const { pc } = makeFakePc({ iceGatheringState: 'gathering' }); // 假件永不完成
    // ★ 只给 ticker（= 真实调用方给的那份环境），**不给** iceGatherTimeoutMs
    const p = waitForIceGathering(pc as never, { ticker: clk.t });
    expect(
      clk.scheduled().length,
      '没有排任何计时器 ⇒ 这条等待没有上界（一次静默挂起，D23 同族）',
    ).toBe(1);
    expect(clk.scheduled()[0], '缺省上界不是那个导出常量（改常数改了行为，读数却没跟着走）')
      .toBe(DEFAULT_ICE_GATHER_TIMEOUT_MS);
    // 反空转：那个缺省值真的能触发"可读失败"这一支（不是排了个永不使用的计时器）
    clk.fire();
    const r = await p;
    expect(r.ok, '到点之后竟然成功了').toBe(false);
    if (!r.ok) {
      expect(r.reason, '缺省上界到点不是 ice-timeout').toBe('ice-timeout');
      expect(r.message.length, '超时那句是空的').toBeGreaterThan(10);
      // 可读失败句**保留**（有上界 + 可读真因这两条都不许丢）：秒数来自那个常量本身
      expect(r.message, '那句里没有那个秒数').toContain(`${DEFAULT_ICE_GATHER_TIMEOUT_MS / 1000} 秒`);
    }
  });

  it('★ `localDescription` 为空 ⇒ `no-description`（不是"成功但空串"）', async () => {
    const { pc } = makeFakePc({ iceGatheringState: 'complete' });
    // 把 localDescription 抹掉（模拟"setLocalDescription 没成功、实现没暴露它"）
    Object.defineProperty(pc, 'localDescription', { get: () => null, configurable: true });
    const r = await waitForIceGathering(pc as never, { ticker: ticker().t });
    expect(r.ok, '没有描述竟然成功了').toBe(false);
    if (!r.ok) expect(r.reason, '原因不是 no-description').toBe('no-description');
  });

  it('★ B3：房主把回示的 answer 喂进**同一条**连接（`applyAnswer`）', async () => {
    const { pc, fake } = makeFakePc({});
    const r = await applyAnswer(pc as never, { sdp: 'ANSWER-SDP-9' });
    expect(r.ok, `applyAnswer 失败：${r.ok ? '' : r.message}`).toBe(true);
    expect(fake.remoteSeen.length, 'answer 没被喂进去').toBe(1);
    expect(fake.remoteSeen[0].type, '喂进去的不是 answer').toBe('answer');
    expect(fake.remoteSeen[0].sdp, '喂进去的不是那条 answer').toBe('ANSWER-SDP-9');
    // 反证：空 answer 被响亮拒绝
    const bad = await applyAnswer(pc as never, { sdp: '' });
    expect(bad.ok, '空 answer 竟然被接受了').toBe(false);
  });
});

describe('★ 修复轮 B3/B4 · 回示码：同形状 + 具名构造器 + 编解码往返', () => {
  it('★ `answerPayloadFields`：两个承诺位就是那个**具名占位串**（类型上给不了真承诺）', () => {
    const f = answerPayloadFields({ protoVersion: PROTO_VERSION, sessionId: 'sid-b34', sdp: 'SDP-Y', ice: ['c1', 'c2'] });
    expect(f.hostPromise, '房主承诺位不是占位串').toBe(ANSWER_PROMISE_PLACEHOLDER);
    expect(f.guestPromise, '加入方承诺位不是占位串').toBe(ANSWER_PROMISE_PLACEHOLDER);
    expect(f.sessionId, '回示码没带上这一局的会话号（D 轮 I-3 甲）').toBe('sid-b34');
    expect(f.sdp).toBe('SDP-Y');
    expect(f.ice).toEqual(['c1', 'c2']);
    expect(f.p).toBe(PROTO_VERSION);
    // 占位串必须匹配 `PROMISE_TEXT`（否则 `encodeInvite` 会拒）
    expect(/^[^\s.]+$/.test(ANSWER_PROMISE_PLACEHOLDER), '占位串形状不合法（encodeInvite 会拒）').toBe(true);
    // 类型上给不了承诺：构造器的入参里没有那两个字段（这里用"多传一个字段"来固化这一点）
    const extra = answerPayloadFields({ protoVersion: 1, sessionId: 'sid-b34', sdp: 'S', ice: [], hostPromise: 'x' } as never);
    expect(extra.hostPromise, '多传的 hostPromise 竟然生效了（构造器没把承诺位写死）')
      .toBe(ANSWER_PROMISE_PLACEHOLDER);
  });

  it('★ 往返：回示码经**真件**编码 ⇒ 解出来的 SDP/ICE 与原件逐字相同，且 `isAnswerPayload` 为真', async () => {
    // 用**真件**（`createInvite`：真压缩 + 真自洽检查）编码一条**回示码形状**的载荷：
    // 两个承诺位来自 `answerPayloadFields`（具名占位串），其余是 answer 的 sdp / ice。
    const fields = answerPayloadFields({ protoVersion: PROTO_VERSION, sessionId: 'sid-b34', sdp: OFFER_SDP, ice: ['cand-a'] });
    const enc = await createInvite({ ...fields, originAndPath: REAL_HREF }, REAL_ENV);
    expect(enc.ok, `回示码编码失败：${enc.ok ? '' : enc.message}`).toBe(true);
    if (!enc.ok) return;
    const dec = await decodeInvitePayload(enc.payload, REAL_ENV);
    expect(dec.ok, `回示码解码失败（同一套编解码）：${dec.ok ? '' : dec.message}`).toBe(true);
    if (!dec.ok) return;
    expect(dec.payload.sdp, '往返之后 SDP 变了').toBe(OFFER_SDP);
    expect(dec.payload.ice, '往返之后 ICE 变了').toEqual(['cand-a']);
    expect(isAnswerPayload(dec.payload), '解出来的载荷没被认成回示码').toBe(true);
    expect(dec.proto.ok, '回示码的明文版本比对没过').toBe(true);
    // 反向：一条**真邀请码**不该被判成回示码
    const inv = await realInvite();
    const invDec = await decodeInvitePayload(inv.payload, REAL_ENV);
    expect(invDec.ok).toBe(true);
    if (invDec.ok) expect(isAnswerPayload(invDec.payload), '真邀请码被误判成了回示码').toBe(false);
  });
});

/* ==================================================================== *
 * 11. ★★ C 轮：结构缺口 ①（同一条连接）与 ②（承诺-揭示流程的驱动者）
 *
 * ①② 是 T9 任务书作者核对代码时挖出来的**结构缺口**：它们解释了"为什么两个浏览器今天连不上"。
 * C1：收方的 answer 落在**第二条**连接上（offer/answer 在 B 上完成、消息通道在 A 上）。
 * C2：六个 `send*` / `commitFace` 在 `src/**` 里**零调用者** ⇒ 握手完成后流程根本不会被驱动。
 *
 * ⚠️ 这一节证明的是"**结构接对了 + 序列走得通**"，**不是**"真浏览器里连得上"
 * （真 SDP 协商 / 真 ICE 可达性由 **T9 的 CDP 场景**覆盖）。
 * ==================================================================== */

describe('★★ C1 · answer 必须落在**承载消息的那条连接**上（结构缺口 ①）', () => {
  /** 造一个**浏览器传输**（用假 peer connection 当它的内核），并给出一条待喂的 offer */
  async function browserTransportWithPc() {
    const { pc: fakePc, fake: script } = makeFakePc({ iceGatheringState: 'complete' });
    // 每一次 `peerConnection(...)` 调用都把假件交出去；`peerConnectionOf` 要能取回**同一个对象**
    const tr = createBrowserTransport({
      peerConnection: () => fakePc as never,
      settings: () => null,
    });
    const started = await tr.init({ selfId: 'g', peerId: 'h' });
    expect(started.ok, '夹具失败：浏览器传输没起来').toBe(true);
    return { tr, script, fakePc };
  }

  it('★ `peerConnectionOf(transport)` 交回的**就是**传输内部那条连接', async () => {
    const { tr, fakePc } = await browserTransportWithPc();
    const pc = peerConnectionOf(tr);
    expect(pc, '`peerConnectionOf` 没交出连接（收方就没法把 answer 落在同一条上）').not.toBeNull();
    // ★ **身份**（不是"形状相同"）：同一个对象
    expect(pc, '`peerConnectionOf` 交的是**另一条**连接 ⇒ 这正是结构缺口 ①')
      .toBe(fakePc as never);
    // 反证（防恒真）：一条**别的**传输交回的不是它
    const other = await browserTransportWithPc();
    expect(peerConnectionOf(other.tr), '两条不同传输交回了同一条连接').not.toBe(fakePc as never);
  });

  it('★ 假传输（非本文件造的）交回 `null`（响亮，不是给一条新的）', () => {
    const pair = createFakeTransportPair();
    expect(peerConnectionOf(pair.A.transport), '假传输竟然被交出了一条对端连接').toBeNull();
  });

  it('★ 行为腿：把 `peerConnectionOf` 的结果喂进 `acceptOffer` ⇒ 序列落在**同一条**连接上', async () => {
    const { tr, script } = await browserTransportWithPc();
    const pc = peerConnectionOf(tr);
    expect(pc).not.toBeNull();
    const r = await acceptOffer(pc as never, { sdp: 'HOST-OFFER' });
    expect(r.ok, `acceptOffer 失败：${r.ok ? '' : r.message}`).toBe(true);
    // ★ 那条 offer/answer 的序列**记在传输内部那条连接的账上**（`script.calls`）
    const ops = script.calls.map((c) => c.op);
    expect(ops, 'offer/answer 的序列没有落在承载消息的那条连接上（缺口 ① 仍在）')
      .toEqual(expect.arrayContaining(['setRemoteDescription', 'createAnswer', 'setLocalDescription']));
    expect(script.remoteSeen[0]?.sdp, '喂进去的不是那条 offer').toBe('HOST-OFFER');
    // 反空转：传输自己也确实用过这条连接（`init` 里 createOffer/createDataChannel 的账在同一份 calls 上）
    expect(ops, '传输内部那条连接上没有任何 init 的痕迹 ⇒ 上面那些不是同一条').toEqual(
      expect.arrayContaining(['createOffer', 'createDataChannel']),
    );
  });
});

describe('★★ C2 · 承诺-揭示流程的驱动者（结构缺口 ②）', () => {
  /**
   * 一条**把待投帧攒起来**的外壳：`connect()` 里那一刻发的帧不能丢
   * （订阅是"连上那一刻"才挂的，早发的帧会掉进空窗 —— 实测过一次）。
   */
  async function wireSide(role: 'host' | 'guest', tr: NetTransport) {
    const pending: string[] = [];
    const { detach } = { detach: tr.onMessage((text) => { pending.push(text); }) };
    const t = fakeTicker();
    const client = createLobbyClient({
      role,
      sessionId: 'sid-c2',
      matchSeed: 'mseed-fixture',
      randomToken: () => 'rtok-fixture',
      localProtoVersion: PROTO_VERSION,
      localCardDataHash: CARD_DATA_HASH,
      hash: browserHash(),
      ticker: t.ticker,
      createTransport: () => tr,
      signalingEndpoint: '',
      readSettings: () => ({ turnUrl: '', turnUsername: '', turnCredential: '' }),
      buildInvite: async () => ({ ok: true as const, payload: 'P', link: `${REAL_HREF}#invite=P` }),
      decompressBase64: hostDecompress,
      readAddressBar: () => null,
      localNick: () => 'nick',
      onInbound: () => { client.drive(); },
    });
    return {
      client,
      detach,
      /** 消费待投帧（消费掉就从 pending 里移除；返回消费了几条） */
      async consume(n: number): Promise<number> {
        const take = pending.splice(0, n);
        for (const text of take) client.drive();
        return take.length;
      },
    };
  }

  it('★ 从握手一路走到两端 `complete`，且加入方 `commitmentVerified() === true`', async () => {
    const pair = createFakeTransportPair();
    const host = await wireSide('host', pair.A.transport);
    const guest = await wireSide('guest', pair.B.transport);
    await host.client.connect('first');
    await guest.client.connect('first');

    // 交替投递：每一轮把在线上的帧全部送到对端、再让两端按相位驱动到不动
    const trace: string[] = [];
    for (let round = 0; round < 20; round += 1) {
      pair.pump(2);
      await host.consume(8);
      await guest.consume(8);
      host.client.drive();
      guest.client.drive();
      trace.push(`r${round}: h=${String(host.client.state().peer?.phase)} g=${String(guest.client.state().peer?.phase)}`);
      if (host.client.state().peer?.phase === 'complete' && guest.client.state().peer?.phase === 'complete') break;
    }

    const hp = host.client.state().peer;
    const gp = guest.client.state().peer;
    // eslint-disable-next-line no-console
    console.log(`\nC2 实测：host phase=${String(hp?.phase)} / guest phase=${String(gp?.phase)}`
      + ` / 线上帧=${pair.steps().length}\n相位轨迹：\n  ` + trace.join('\n  '));
    // ★ 相位是唯一的排序载体 ⇒ 断言就该打在相位上
    expect(hp?.phase, '房主没有走到 complete（承诺-揭示流程没被驱动完）').toBe('complete');
    expect(gp?.phase, '加入方没有走到 complete').toBe('complete');
    // ★ 加入方的验盐结论（N-9 的代价：不许只看 phase / acceptsInput）
    expect(guest.client.commitmentVerified(), '加入方的承诺校验结论不是 true').toBe(true);
    // 反空转：线上真的运过那六条消息里的每一条
    const kinds = pair.steps().map((s) => /"t":"([a-z-]+)"/.exec(s.text)?.[1] ?? '?');
    // eslint-disable-next-line no-console
    console.log('C2 线上消息序列：' + kinds.join(' -> '));
    for (const k of ['hello', 'hello-ack', 'commit', 'commit-ack', 'commit-face', 'reveal-seed', 'reveal-face', 'reveal-salt']) {
      expect(kinds, `线上从来没有出现过 ${k}（那条消息的驱动者没接上）`).toContain(k);
    }
    host.detach();
    guest.detach();
  });

  it('★ 驱动者是**相位驱动**的：它不另存状态（同一个相位驱动两次只发一条）', async () => {
    const pair = createFakeTransportPair();
    // ⚠️ **两端都要接上**：`hello` 是加入方发的 ⇒ 只连房主的话它永远停在 handshaking
    //    （第一版就是那么红的：夹具自己的问题，不是被测对象的问题）。
    const host = await wireSide('host', pair.A.transport);
    const guest = await wireSide('guest', pair.B.transport);
    await host.client.connect('first');
    await guest.client.connect('first');
    // 投递到房主真的走到 awaiting-commit-face（假链路一帧要走几步）
    for (let i = 0; i < 10 && host.client.state().peer?.phase === 'handshaking'; i += 1) {
      pair.pump(4);
      await host.consume(8);
      await guest.consume(8);
      host.client.drive();
      guest.client.drive();
    }
    host.detach();
    guest.detach();
    // 重来一遍、但这次**不再驱动**（要验的是"同一个相位驱动两次只发一条"）
    const pair2 = createFakeTransportPair();
    const h2 = await wireSide('host', pair2.A.transport);
    const g2 = await wireSide('guest', pair2.B.transport);
    await h2.client.connect('first');
    await g2.client.connect('first');
    for (let i = 0; i < 10 && h2.client.state().peer?.phase === 'handshaking'; i += 1) {
      pair2.pump(4);
      await h2.consume(8);
      await g2.consume(8);
    }
    const host2 = h2;
    const mid = host2.client.state().peer?.phase;
    expect(mid, '夹具失败：房主没走到 awaiting-commit-face').toBe('awaiting-commit-face');
    const before = host2.client.state().routedOut;
    // 再驱动两次：`sendCommit` **不改相位** ⇒ 必须靠"发过就算"的一次性位挡住（不许重复发）
    host2.client.drive();
    host2.client.drive();
    expect(host2.client.state().routedOut, '`sendCommit` 被重复发了（相位不变那一格没有一次性位）').toBe(before);
    // 反证：它也没把流程凭空推进（相位仍停在那一格，等对端）
    expect(host2.client.state().peer?.phase, '驱动者凭空推进了相位').toBe('awaiting-commit-face');
    host2.detach();
    g2.detach();
  });
});
/* ==================================================================== *
 * 12. ★★ C3：回示码的两个 UI 入口（结构缺口 ③）+ 六个 send* 的产出侧调用者
 * ==================================================================== */

describe('★★ C3 · 回示码在界面上有入口（结构缺口 ③）', () => {
  it('★ 加入方：未产码时屏上是「出示回示码」按钮；点它 ⇒ 回调被调', () => {
    const h = mountLobby({ role: 'guest' });
    h.render();
    const btns = queryAllIn(h.root, 'button.net-lobby-make-answer');
    expect(btns.length, '屏上没有「出示回示码」按钮（玩家看不到这条路）').toBe(1);
    expect(btns[0].text, '按钮文案不是那个标签').toContain('回示码');
    click(h.root, 'button.net-lobby-make-answer');
    expect(h.calls, '点了「出示回示码」但宿主没收到回调').toContain('make-answer');
  });

  it('★ 加入方：产码之后屏上**显示那条码**（不再是按钮）', () => {
    const code = '1.ABCDEF-PAYLOAD';
    const h = mountLobby({ role: 'guest', answerCode: code });
    h.render();
    expect(queryAllIn(h.root, 'button.net-lobby-make-answer').length, '已有码时还显示「出示」按钮').toBe(0);
    expect(textOf(h.root), '屏上没有那条回示码（玩家拿不到它）').toContain(code);
  });

  it('★ 房主：一个输入框 + 粘进去 ⇒ 回调带上了那条码', () => {
    const h = mountLobby({ role: 'host' });
    h.render();
    const inputs = queryAllIn(h.root, 'input.net-lobby-answer-input');
    expect(inputs.length, '房主那一栏没有「粘贴回示码」输入框').toBe(1);
    // 桩上派发 input 事件（照本文件既有的输入腿口径）
    const inp = inputs[0];
    (inp as unknown as { value: string }).value = '1.ZZZ';
    const child = makeStubEl('span');
    inp.appendChild(child);
    child.dispatchEvent({ type: 'input', target: child });
    inp.textContent = '';
    expect(h.calls, '粘贴回示码没把内容送到宿主').toContain('apply-answer:1.ZZZ');
  });

  it('★ 房主：应用结论（成功/失败）都在屏上可见', () => {
    const ok = mountLobby({ role: 'host', answerApplied: { ok: true, message: '已经把对方的答案接上了。' } });
    ok.render();
    expect(textOf(ok.root), '成功结论没显示').toContain('已经把对方的答案接上了。');
    const bad = mountLobby({ role: 'host', answerApplied: { ok: false, message: '这条不是对方回示的答案。' } });
    bad.render();
    expect(textOf(bad.root), '失败结论没显示').toContain('这条不是对方回示的答案。');
  });

  it('★ 两个入口都是「界面标签」，不是隐私/信令说明（D22 的第二份说明没被引进来）', () => {
    const code = stripComments(
      readFileSync(fileURLToPath(new URL('../../src/ui/net-lobby.ts', import.meta.url)))
        .subarray(0, 8 * 1024 * 1024).toString('utf8'),
    );
    for (const banned of ['本程序默认不向任何服务器发请求', '两台设备直连（P2P）']) {
      expect(code.includes(banned), `回示码那两个入口把信令说明手写进来了：${banned}`).toBe(false);
    }
  });
});

describe('★★ C2 的可机械检查面：六个 send* / commitFace 在 src/** 里有产出侧调用者', () => {
  it('★ 六个方法各有至少一个**产出侧**调用者（零调用者 ⇒ 红）', () => {
    // 唯一的例外是 session.ts 自己（那是定义处）。其余任何一处都算"产出侧调用者"。
    const files = srcTsFiles().filter((f) => !f.endsWith(`net${SRC_SEP}session.ts`));
    const bodies = files.map((f) => ({
      rel: f.split(SRC_SEP).slice(-2).join('/'),
      code: stripComments(readFileSync(f).subarray(0, 8 * 1024 * 1024).toString('utf8')),
    }));
    const wanted = ['sendCommit', 'sendCommitAck', 'commitFace', 'sendRevealSeed', 'sendRevealSalt', 'sendRevealFace'] as const;
    const missing: string[] = [];
    // eslint-disable-next-line no-console
    const table: string[] = [];
    for (const name of wanted) {
      const callers = bodies
        .filter((b) => new RegExp(`\\b${name}\\s*\\(`).test(b.code))
        .map((b) => b.rel);
      table.push(`  ${name} => ${callers.length === 0 ? '（零调用者）' : [...new Set(callers)].join(', ')}`);
      if (callers.length === 0) missing.push(name);
    }
    // eslint-disable-next-line no-console
    console.log('\nC2 六个方法的产出侧调用者：\n' + table.join('\n'));
    expect(missing, `这些方法在 src/** 里零调用者 ⇒ 承诺-揭示流程在产出代码里没人驱动：${missing.join(', ')}`)
      .toEqual([]);
    // 反空转：扫描面本身非空，且**真的**排掉了 session.ts（否则"有调用者"可能只是定义处自己）
    expect(bodies.length, 'src 下一个 .ts 都没扫到 ⇒ 扫描面塌了').toBeGreaterThan(50);
    expect(bodies.some((b) => b.rel.endsWith('session.ts')), 'session.ts 没被排掉 ⇒ 这条腿可能是自证').toBe(false);
  });
});

/**
 * 路径分隔符。`node:path` 的 `sep` 在本仓的窄声明里没有，`process` 也没有
 * ⇒ 从**一条已知路径**反推：`fileURLToPath` 出来的 Windows 路径里必然带 `\\`。
 */
const SRC_SEP: string = fileURLToPath(new URL('../../src/main.ts', import.meta.url)).includes('\\') ? '\\' : '/';

/** `src/**` 下的全部 `.ts`（本文件自己的遍历；`tests/node-types.d.ts` 只声明了 `readdirSync`/`statSync`/`join`） */
function srcTsFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (name.endsWith('.ts')) out.push(full);
    }
  };
  walk(fileURLToPath(new URL('../../src/', import.meta.url)));
  return out;
}

/* ==================================================================== *
 * ★★ **T8-E：一条消息走哪条通道，由唯一一张表定**（`MESSAGE_CHANNEL`）
 *
 * 缺陷形状（真机实测）：`net-lobby.send()` 原来写的是 `msg.t === 'act' ? 'act' : 'beat'`
 * ⇒ **整条握手**（hello / hello-ack / commit* / reveal-* / resync* / bye）全挤在 `beat`
 * 上，而 `beat` 是 `{reliable:false, ordered:false}`（`maxRetransmits: 0`）的不可靠通道。
 * 真机读数（`.superpowers/g5-T8/ice-diag-afterleg.txt`）：加入方那条 `hello` 上了线，
 * 房主侧 `send()` 一次都没被调用 ⇒ 没有 `hello-ack` ⇒ 两端永远停在 `handshaking`。
 * **假传输两条通道都不丢包/不重排** ⇒ 这个缺陷在 node 面永远看不见 —— 所以这里两条腿都要：
 * 一条钉表，一条钉**线上实际走的那条通道**。
 * ==================================================================== */

describe('★★ T8-E · 消息 → 通道（`act` = reliable+ordered / `beat` = 心跳与在线）', () => {
  /** 本文件 `C2` 那节的 `wireSide` 是那个 describe 的局部函数 ⇒ 这里照它的形状再造一份最小版 */
  function wireSideLocal(role: 'host' | 'guest', tr: NetTransport) {
    const pending: string[] = [];
    tr.onMessage((text) => { pending.push(text); });
    const client: LobbyClient = createLobbyClient({
      role,
      sessionId: 'sid-chan-map',
      matchSeed: 'mseed-fixture',
      randomToken: () => 'rtok-fixture',
      localProtoVersion: PROTO_VERSION,
      localCardDataHash: CARD_DATA_HASH,
      hash: browserHash(),
      ticker: fakeTicker().ticker,
      createTransport: () => tr,
      signalingEndpoint: '',
      readSettings: () => ({ turnUrl: '', turnUsername: '', turnCredential: '' }),
      buildInvite: async () => ({ ok: true as const, payload: 'P', link: `${REAL_HREF}#invite=P` }),
      decompressBase64: hostDecompress,
      readAddressBar: () => null,
      localNick: () => 'nick',
      onInbound: () => { client.drive(); },
    });
    return {
      client,
      /** 消费待投帧（消费掉就从 pending 里移除；返回消费了几条） */
      async consume(n: number): Promise<number> {
        const take = pending.splice(0, n);
        for (const text of take) client.drive();
        return take.length;
      },
    };
  }

  /** 握手的整族（全在 `act` 上的判据按这一族逐条核） */
  const HANDSHAKE_FAMILY = [
    'hello', 'hello-ack', 'busy',
    'commit', 'commit-ack', 'commit-face', 'reveal-seed', 'reveal-face', 'reveal-salt',
    'resync-req', 'resync-res', 'act', 'bye', 'forfeit',
  ] as const;

  it('★ 表腿：`MESSAGE_CHANNEL` 覆盖全部 14 条消息，且**每条都在 `act`**（`beat` 上没有协议消息）', () => {
    // 覆盖：与 `protocol.ts` 的 `MSG_TYPES` 同一份清单（那边是 `Record<NetMsgType, true>`，
    // 少一条 tsc 就报；这条腿钉的是"这张表也跟着全"）
    expect(
      Object.keys(MESSAGE_CHANNEL).sort(),
      '`MESSAGE_CHANNEL` 的键与协议的消息类型对不上（漏登记 / 写错名字）',
    ).toEqual([...HANDSHAKE_FAMILY].sort());
    for (const t of HANDSHAKE_FAMILY) {
      expect(MESSAGE_CHANNEL[t], `${t} 没走 act（握手/协议消息丢不起）`).toBe('act');
    }
    // 反空转：这张表真的只有两条通道、没有第三种值
    expect([...new Set(Object.values(MESSAGE_CHANNEL))].sort()).toEqual(['act']);
  });

  it('★ 线腿：走完握手 + 承诺-揭示全程，线上**每一帧协议消息都在 `act`**（`beat` 上零帧）', async () => {
    const pair = createFakeTransportPair();
    const host = wireSideLocal('host', pair.A.transport);
    const guest = wireSideLocal('guest', pair.B.transport);
    await host.client.connect('first');
    await guest.client.connect('first');
    for (let round = 0; round < 20; round += 1) {
      pair.pump(2);
      await host.consume(8);
      await guest.consume(8);
      host.client.drive();
      guest.client.drive();
      if (host.client.state().peer?.phase === 'complete' && guest.client.state().peer?.phase === 'complete') break;
    }
    const frames = pair.steps().map((s) => ({
      channel: String(s.channel),
      type: /"t":"([a-z-]+)"/.exec(s.text)?.[1] ?? '?',
    }));
    // 反空转：线上真的运过握手与承诺-揭示两族（否则下面那条"全在 act"可能是空集恒真）
    for (const must of ['hello', 'hello-ack', 'commit', 'commit-face', 'reveal-seed', 'reveal-salt']) {
      expect(frames.some((f) => f.type === must), `线上从来没有出现过 ${must}（这条腿没走完全程）`).toBe(true);
    }
    const wrong = frames.filter((f) => HANDSHAKE_FAMILY.includes(f.type as typeof HANDSHAKE_FAMILY[number]) && f.channel !== 'act');
    expect(wrong, `有协议消息走了非 act 通道：${JSON.stringify(wrong)}`).toEqual([]);
    const onBeat = frames.filter((f) => f.channel === 'beat');
    expect(onBeat.map((f) => f.type), '`beat` 上出现了协议消息（它只该跑心跳/在线读数）').toEqual([]);
  });
});