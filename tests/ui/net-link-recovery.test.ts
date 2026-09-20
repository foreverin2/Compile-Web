/**
 * G5 T13-C 判据 2 与判据 5：**"从屏上重新进来"这条路**（用户 2026-09-20 第 2 条指示）。
 *
 * ## 这一段要证的三件事
 *
 *  1. **判据 2（新链路重新要面）**：`askFaceOnce()` 是**每条链路一次** ⇒ 每建一条需要叫面的
 *     新链路，客户端都会**再问一次面**；而 `main.ts` 的两个模块态（`faceChosen` /
 *     `chooseFaceResolve`）必须在**那一次要面**时复位，否则上一条链路的闩与旧 resolve
 *     会把新链路的点击吞掉（症状：新硬币屏画得出来、点下去没反应，握手永远停在等面那一格）。
 *     ⚠️ **能力边界**：复位那两行住在 `src/main.ts`（应用入口，node 里 import 不了）⇒
 *     客户端那一半是**行为腿**，宿主那一半只能是**源码腿**（与 T13-A 登记过的同一种边界）。
 *  2. **判据 5（屏上那三样控件真的可用）**：`invalidateHandshakeArtifacts()` 之后
 *     「生成邀请码」/ 粘贴框 /「出示回示码」都回到可用状态（不清的话房主那支**根本不画按钮**），
 *     并且用**真渲染器**把那一屏画出来、真的点给宿主看。
 *  3. **判据 5（重新接上之后走 `resuming` 追平）**：两条**新**链路上 `connect('resume')`
 *     之后，落后的那一端被档案追平，两端规范串逐字相等（`stableStringify` 整串）。
 *     这一条从"双方各自重新建了一条链路"开始 —— 邀请码那一来一回本身由大厅门与
 *     `net-lobby.test.ts` 覆盖，本层吃的是它的结果（同一条 `sessionId` + 一条新传输）。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  descendants, installStubDom, makeStubEl, queryAllIn, type StubNode,
} from './net-dom-stub';
import { functionBody, stripComments } from './source-text';
import {
  createLobbyClient, errorCopy, linkRecoveryNotice, qrNote, renderNetLobby,
  type LobbyClient, type LobbyErrorKey, type LobbyRenderNav, type LobbyState, type LobbyTicker,
  type SettingKey,
} from '../../src/ui/net-lobby';
import { createFakeTransportPair } from '../../src/net/fake-transport';
import type { NetTransport } from '../../src/net/transport';
import type { PeerStatus } from '../../src/net/session';
import type { CoinSide } from '../../src/app/coin';
import { PROTO_VERSION } from '../../src/net/protocol';
import { CARD_DATA_HASH } from '../../src/app/card-data-hash';
import { browserHash, inviteLengthReport } from '../../src/ui/net-browser';
import { createGame, getDraftPool } from '../../src/core/state/create';
import { applyRecordedAction, stateAtStep } from '../../src/app/match-replay';
import { createMatchFileRecorder, setupFromState, DRAFT_PICK_KIND, type MatchFile } from '../../src/app/match-file';
import { stableStringify } from '../../src/core/fingerprint';
import type { GameState, PlayerId } from '../../src/core/models/types';

/* ==================================================================== *
 * 夹具
 * ==================================================================== */

let restoreDom: (() => void) | null = null;

afterEach(() => {
  restoreDom?.();
  restoreDom = null;
});

function fakeTicker(): LobbyTicker {
  let h = 0;
  return { schedule: () => { h += 1; return h; }, cancel: () => { /* 不排真时钟 */ } };
}

function makeClient(
  role: 'host' | 'guest',
  sessionId: string,
  next: () => NetTransport,
  extra: Partial<Parameters<typeof createLobbyClient>[0]> = {},
): LobbyClient {
  let n = 0;
  return createLobbyClient({
    role,
    sessionId,
    matchSeed: 'mseed-t13c-recovery',
    randomToken: () => `rtok-t13c-recovery-${String(n++)}`,
    localProtoVersion: PROTO_VERSION,
    localCardDataHash: CARD_DATA_HASH,
    hash: browserHash(),
    ticker: fakeTicker(),
    createTransport: next,
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
  calls: string[];
  state: LobbyState;
  render(patch?: Partial<LobbyState>): void;
}

const BASE_STATE: LobbyState = {
  role: 'host',
  sessionId: 'sid-t13c-recovery-screen',
  invite: null,
  joined: null,
  roomCodeInput: '',
  roomCodeGate: null,
  transport: 'offline',
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
};

/** 用**真渲染器**（`renderNetLobby`）在 DOM 桩上画一帧；回调都记进 `calls` */
function mount(initial: Partial<LobbyState>): Mount {
  restoreDom = installStubDom();
  const root = makeStubEl('div');
  const calls: string[] = [];
  const h: Mount = {
    root,
    calls,
    state: { ...BASE_STATE, ...initial },
    render: (patch) => {
      if (patch !== undefined) h.state = { ...h.state, ...patch };
      renderNetLobby(root as unknown as HTMLElement, nav());
    },
  };
  function nav(): LobbyRenderNav {
    return {
      state: h.state,
      backHome: () => { calls.push('back'); },
      startHost: () => { calls.push('start-host'); },
      startJoin: () => { calls.push('start-join'); },
      makeInvite: () => { calls.push('make-invite'); },
      inviteLength: (payload: string) => {
        const r = inviteLengthReport(payload);
        return `长度 ${r.chars} 落在区间=${String(r.withinMeasuredRange)}`;
      },
      qrNote: () => qrNote(),
      setRoomCode: (t: string) => { h.state = { ...h.state, roomCodeInput: t }; },
      submitRoomCode: () => { calls.push('submit-code'); },
      joinWithInvite: (t: string) => { calls.push(`join-invite:${t}`); },
      toggleAdvanced: () => { calls.push('toggle-advanced'); },
      settingsValue: (_k: SettingKey) => '',
      setSetting: () => { calls.push('set-setting'); },
      errorText: (k: LobbyErrorKey) => errorCopy(k),
      makeAnswerCode: () => { calls.push('make-answer'); },
      applyAnswerCode: (code: string) => { calls.push(`apply-answer:${code}`); },
    };
  }
  return h;
}

/** 在某个节点上**真派发一次点击**（桩的冒泡路径不含派发节点自身，所以要挂一个子节点再派发） */
function click(root: StubNode, sel: string): void {
  const hits = queryAllIn(root, sel);
  expect(hits.length, `要点的元素应有恰好一个：${sel}（实际 ${hits.length}）`).toBe(1);
  const child = makeStubEl('span');
  hits[0].appendChild(child);
  child.dispatchEvent({ type: 'click', target: child });
}

/** 往输入框里敲一段文字（同上：桩要一个子节点才能把 `input` 事件冒到监听器上） */
function typeInto(root: StubNode, sel: string, text: string): void {
  const hits = queryAllIn(root, sel);
  expect(hits.length, `要输入的框应有恰好一个：${sel}（实际 ${hits.length}）`).toBe(1);
  const input = hits[0];
  (input as unknown as { value: string }).value = text;
  const child = makeStubEl('span');
  input.appendChild(child);
  child.dispatchEvent({ type: 'input', target: child });
}

function textOf(root: StubNode): string {
  return descendants(root).map((n) => n.text).join('\n');
}

/** 一个"离线、判不了窗口"的对端读数（真会话也能给，但这一段的屏腿只需要这一份读数） */
function offlinePeer(): PeerStatus {
  return {
    phase: 'complete',
    handshakeDone: true,
    faceCommitted: true,
    seedRevealed: true,
    acceptsInput: false,
    needsResync: false,
    needsResyncCause: null,
    needsResyncDetail: null,
    online: false,
    windowExpired: null,
  };
}

/* ==================================================================== *
 * 判据 2：新链路重新要面（客户端那一半是行为腿）
 * ==================================================================== */

describe('★★ G5 T13-C 判据 2：重连中的加入方不再停在新硬币屏', () => {
  it('每建一条新链路，客户端都会**再问一次面**；第二次 resolve 真的落到新链路上', async () => {
    const asks: Array<(side: CoinSide) => void> = [];
    const pairA = createFakeTransportPair();
    const pairB = createFakeTransportPair();
    const guestTransports = [pairA.B.transport, pairB.B.transport];
    const guest = makeClient('guest', 'sid-t13c-face', () => {
      const t = guestTransports.shift();
      if (t === undefined) throw new Error('夹具失败：传输不够用了');
      return t;
    }, {
      chooseFace: () => new Promise<CoinSide>((resolve) => { asks.push(resolve); }),
    });
    const hostA = makeClient('host', 'sid-t13c-face', () => pairA.A.transport);
    const hostB = makeClient('host', 'sid-t13c-face', () => pairB.A.transport);

    /* ── 第一条链路：走到"该叫面"那一格，客户端问了一次面 ─────────────────────────── */
    await hostA.connect('first');
    await guest.connect('first');
    settle(pairA, hostA, guest);
    expect(guest.phase(), '加入方该停在"等玩家叫面"那一格').toBe('awaiting-commit-ack');
    expect(asks.length, '第一条链路上客户端问面的次数').toBe(1);
    asks[0](1);
    // ⚠️ 面的落点是**微任务**（`askFaceOnce` 的 `.then`）⇒ 驱动之前必须让出一次微任务
    await Promise.resolve();
    guest.drive();
    expect(guest.phase(), '第一条链路：面到手之后该往下走').toBe('face-committed');
    expect(guest.chosenSide(), '第一条链路叫出去的那一面').toBe(1);

    /* ── 第二条链路（模拟"重新贴码回来"之后重建的链路）：**必须再问一次面** ───────────── */
    await hostB.connect('first');
    await guest.connect('first');
    settle(pairB, hostB, guest);
    expect(asks.length, '第二条链路上客户端**没有**再问面（新链路要不到面 ⇒ 屏上那块硬币屏永远停住）').toBe(2);
    expect(guest.phase(), '第二条链路上加入方也停在"等玩家叫面"那一格').toBe('awaiting-commit-ack');
    // ★ 这一句是判据 2 的落点：旧链路那次 resolve 已经用掉了，新链路必须能拿到**新的一次**
    asks[1](2);
    await Promise.resolve();
    guest.drive();
    expect(guest.phase(), '第二条链路：新面到手之后该往下走（旧 resolve 挡住了新链路）').toBe('face-committed');
    expect(guest.chosenSide(), '第二条链路叫出去的那一面是新的那一次').toBe(2);
  });

  it('★ 判据 2（源码腿，宿主那一半）：复位点在 `chooseFace` 注入里 —— 新链路要面的那一刻', () => {
    const MAIN = stripComments(
      readFileSync(fileURLToPath(new URL('../../src/main.ts', import.meta.url)))
        .subarray(0, 8 * 1024 * 1024).toString('utf8'),
    );
    const start = functionBody(MAIN, 'startLobby');
    const at = start.indexOf('chooseFace:');
    expect(at, 'startLobby 里没有注入 chooseFace（大厅永远问不到面）').toBeGreaterThanOrEqual(0);
    const inject = start.slice(at, start.indexOf('}),', at));
    expect(inject.length, '切出来的注入片段太短 ⇒ 这条腿假绿').toBeGreaterThan(40);
    expect(inject, '注入里没有复位"已经叫过面"那枚闩（新链路的点击会被旧闩吞掉）')
      .toContain('faceChosen = false;');
    expect(inject, '注入里没有把新那条 resolve 换上去（旧 resolve 还指着上一条链路）')
      .toContain('chooseFaceResolve = resolve;');
    // 顺序：先复位闩、再换 resolve（反过来的话新 resolve 装上了而闩还是旧的）
    expect(
      inject.indexOf('faceChosen = false;'),
      '复位与换 resolve 的顺序反了',
    ).toBeLessThan(inject.indexOf('chooseFaceResolve = resolve;'));
  });
});

/* ==================================================================== *
 * 判据 5：屏上那三样控件真的可用（真渲染器腿）
 * ==================================================================== */

describe('★★ G5 T13-C 判据 5：对局中掉线超过宽限 ⇒ 带回"建房 / 加入房"那一屏', () => {
  it('作废旧交接产物之后：房主的「生成邀请码」/ 加入方的粘贴框与「出示回示码」都可用', async () => {
    const pair = createFakeTransportPair();
    const host = makeClient('host', 'sid-t13c-artifacts', () => pair.A.transport);
    // 反空转：不清的话屏上**没有**「生成邀请码」按钮（房主那支只在 invite === null 时画它）
    await host.startHost({
      p: PROTO_VERSION,
      originAndPath: 'https://example.test/lobby',
      sessionId: host.state().sessionId,
      sdp: 'v=0\r\n',
      ice: [],
      hostPromise: 'x',
      guestPromise: 'y',
    });
    expect(host.state().invite, '夹具前提：这条邀请码该产出来了').not.toBeNull();

    const before = mount({ role: 'host', invite: host.state().invite });
    before.render();
    expect(queryAllIn(before.root, 'button.net-lobby-make-invite').length,
      '反空转：invite 还在时不该有「生成邀请码」按钮（那这条腿就没有区分力了）').toBe(0);

    host.invalidateHandshakeArtifacts();
    const s = host.state();
    expect(s.invite, '作废之后房主手里还留着旧邀请码（那条 SDP 属于死链路）').toBeNull();
    expect(s.joined, '作废之后 joined 还在').toBeNull();
    expect(s.answerCode, '作废之后旧的回示码还在').toBeNull();
    expect(s.answerApplied, '作废之后旧回示码的处理结论还在').toBeNull();
    // 作废**不碰**这一局的会话号（玩家没有被踢出这一局）
    expect(s.sessionId, '作废动了这一局的会话号').toBe(host.state().sessionId);

    const after = mount({ role: 'host', invite: s.invite, peer: offlinePeer() });
    after.render();
    click(after.root, 'button.net-lobby-make-invite');
    expect(after.calls, '点了「生成邀请码」却没人收到回调').toContain('make-invite');
    // 加入方那一屏（同一次交接的另一端）：粘贴框与「出示回示码」都在，且点了宿主真收到
    const guestScreen = mount({ role: 'guest', invite: null, joined: null, peer: offlinePeer() });
    guestScreen.render();
    click(guestScreen.root, 'button.net-lobby-make-answer');
    expect(guestScreen.calls, '加入方点了「出示回示码」却没人收到回调').toContain('make-answer');
  });

  it('真渲染器画出那一屏：如实那一行话在、加入方的粘贴框真的把文本交给宿主', () => {
    const peer = offlinePeer();
    const notice = linkRecoveryNotice(peer);

    const host = mount({
      role: 'host',
      peer,
      notice,
      answerApplied: null,
      // 作废之后的形状：invite / answerCode 都是 null
      invite: null,
      answerCode: null,
    });
    host.render();
    const hostText = textOf(host.root);
    expect(hostText, '房主屏上没有那一行如实的重连指引').toContain(notice);
    expect(hostText, '房主屏上没有连接状态那一行').toContain('对端现在不在线');
    expect(queryAllIn(host.root, 'button.net-lobby-make-invite').length,
      '房主屏上没有「生成邀请码」（玩家没有重新交接的入口）').toBe(1);
    expect(queryAllIn(host.root, 'input.net-lobby-answer-input').length,
      '房主屏上没有"粘贴对方的回示码"那个框').toBe(1);

    const guest = mount({
      role: 'guest',
      peer,
      notice,
      invite: null,
      joined: null,
      answerCode: null,
    });
    guest.render();
    const guestText = textOf(guest.root);
    expect(guestText, '加入方屏上没有那一行如实的重连指引').toContain(notice);
    expect(queryAllIn(guest.root, 'input.net-lobby-paste-input').length,
      '加入方屏上没有粘贴邀请码的框（没法重新加入）').toBe(1);
    expect(queryAllIn(guest.root, 'button.net-lobby-make-answer').length,
      '加入方屏上没有「出示回示码」').toBe(1);
    // 控件不只是"在"：真的把文本交给宿主
    typeInto(guest.root, 'input.net-lobby-paste-input', 'PAYLOAD-X');
    expect(guest.calls, '粘进邀请码之后宿主没收到那条文本').toContain('join-invite:PAYLOAD-X');
    click(guest.root, 'button.net-lobby-make-answer');
    expect(guest.calls, '点了「出示回示码」却没人收到回调').toContain('make-answer');
  });

  it('★ 判据 5（源码腿，宿主那一半）：宽限到点之后**不自动重建**，而是退回大厅那一屏', () => {
    const MAIN = stripComments(
      readFileSync(fileURLToPath(new URL('../../src/main.ts', import.meta.url)))
        .subarray(0, 8 * 1024 * 1024).toString('utf8'),
    );
    const body = functionBody(MAIN, 'attachLobbyReconnect');
    // ① 整段里**没有**自动重建（新传输永远连不上，见 §9 第 27 条）
    expect(body, '掉线宽限到点之后仍然自动重建链路（玩家会被丢在一个没有出口的死牌桌上）')
      .not.toContain('client.reconnect()');
    // ② 对局中那一支 = `if (netGame === null) { … } else { … }` 的 **else** 那一段
    const guard = body.indexOf('if (netGame === null) {');
    const els = body.indexOf('} else {', guard);
    expect(guard, '找不到开局期那一支').toBeGreaterThanOrEqual(0);
    expect(els, '找不到对局中那一支（`netGame === null` 后面没有 else？）').toBeGreaterThan(guard);
    const branch = body.slice(els, body.indexOf('}, RECONNECT_GRACE_MS)', els));
    expect(branch.length, '对局中那一支太短 ⇒ 这条腿假绿').toBeGreaterThan(150);
    expect(branch, '那一支没有把屏切成大厅（牌桌支先 return，大厅控件进不了 DOM）')
      .toContain("renderMode = 'lobby'");
    expect(branch, '那一支没有置"屏该画大厅那一屏"那个读数').toContain('linkRecoveryNeeded = true');
    expect(branch, '那一支没有作废旧邀请码/回示码（房主那一支连按钮都不画）')
      .toContain('invalidateHandshakeArtifacts()');
    expect(branch, '那一支没有给出如实的一行话').toContain('linkRecoveryNotice(');
    expect(branch, '那一支没有重画一帧').toContain('renderLobbyFrame()');
    // ③ 反向：这一段不许把对局结束掉（判据 1 的"超窗不自动结束对局"在宿主这一层的对应）
    for (const tear of ['netGame = null', 'driver.dispose()', 'netGame?.driver.dispose()']) {
      expect(branch, `那一支把这一局结束掉了（"${tear}"）—— 超窗只是不许追平，不是结束对局`)
        .not.toContain(tear);
    }
    // ④ 进牌桌的唯一闸门是"读数齐了"（否则玩家点「生成邀请码」当场被弹回牌桌）
    const enter = functionBody(MAIN, 'enterNetGame');
    expect(enter, 'enterNetGame 没有"没握手完就不进牌桌"的闸（会在大厅屏刚出现时把它盖掉）')
      .toContain('if (!raw.ready) return null;');
  });
});

/* ==================================================================== *
 * 判据 5：重新接上之后走 `resuming` 追平（node 面）
 * ==================================================================== */

describe('★★ G5 T13-C 判据 5：新链路上 `connect(\'resume\')` ⇒ 档案追平、两端规范串相等', () => {
  it('落后的那一端被新链路追平（`resync-req` / `resync-res` 走的是**新**那条链路）', async () => {
    const seed = 'g5t13c-recovery-catchup';
    const sessionId = 'sid-t13c-recovery-catchup';

    /* ── 房主那一侧：真的对局状态 + 权威档案（D8 的重连凭据）──────────────────────── */
    const hostState: GameState = createGame({ seed, draftStarter: 0, firstToPlay: 1, draftMode: 'normal' });
    const recorder = createMatchFileRecorder();
    const file = (): MatchFile => recorder.toMatchFile({
      seed: hostState.rng.seed,
      setup: setupFromState(hostState),
      players: [{ nick: '房主' }, { nick: '加入方' }],
      cardDataHash: CARD_DATA_HASH,
      createdAt: new Date(0).toISOString(),
    });
    const pick = (defId: string, player: PlayerId): void => {
      const rec = { player, kind: DRAFT_PICK_KIND as 'draft-pick', args: { defId } };
      recorder.record(rec);
      applyRecordedAction(hostState, { ...rec, seq: recorder.actions().length - 1 });
    };

    /* ── 加入方那一侧：故意从第 0 步起（掉线期间一步都没跟上）────────────────────── */
    let guestState: GameState = createGame({ seed, draftStarter: 0, firstToPlay: 1, draftMode: 'normal' });
    let guestApplied = 0;
    let received: MatchFile | null = null;

    const pair1 = createFakeTransportPair();
    const pair2 = createFakeTransportPair();
    const hostTransports = [pair1.A.transport, pair2.A.transport];
    const guestTransports = [pair1.B.transport, pair2.B.transport];
    const shift = (xs: NetTransport[]) => (): NetTransport => {
      const t = xs.shift();
      if (t === undefined) throw new Error('夹具失败：传输不够用了');
      return t;
    };
    const host = makeClient('host', sessionId, shift(hostTransports), { resyncSource: () => file() });
    const guest = makeClient('guest', sessionId, shift(guestTransports), {
      appliedSteps: () => guestApplied,
      onResyncRes: (f) => {
        received = f;
        guestState = stateAtStep(f, f.actions.length);
        guestApplied = f.actions.length;
        return guestApplied;
      },
    });

    /* ── 第一条链路：两端握手完成 ─────────────────────────────────────────────── */
    await host.connect('first');
    await guest.connect('first');
    settle(pair1, host, guest, 24);
    expect(guest.commitmentVerified(), '反空转：第一条链路上这一局没走起来').toBe(true);

    /* ── 掉线期间房主继续推进 3 步（草稿：轮次 1-2-2-1…，只由轮选者提交）───────────── */
    const pool = getDraftPool(hostState).map((p) => p.defId);
    pick(pool[0], 0);
    pick(pool[1], 1);
    pick(pool[2], 1);
    const hostCanonical = stableStringify(hostState);
    expect(stableStringify(guestState), '反空转：加入方本来就追平了（那这条腿什么都没验）')
      .not.toBe(hostCanonical);

    /* ── 第二条链路（= 玩家重新生成邀请码 / 重新贴码之后那条）：两端都走 `'resume'` ──────── */
    await host.connect('resume');
    await guest.connect('resume');
    settle(pair2, host, guest, 32);

    // ① 那条新链路上真的有"重连握手"与"追平"两种帧（不是本地补齐）
    const texts = pair2.steps().map((s) => s.text);
    expect(texts.filter((t) => t.includes('"t":"hello"') && t.includes('"resuming"')).length,
      '新链路上没有带 resuming 的 hello（房主不会把它当重连接）').toBeGreaterThan(0);
    expect(texts.filter((t) => t.includes('"t":"resync-req"')).length,
      '新链路上没有 resync-req（追平请求没发出去）').toBeGreaterThan(0);
    expect(texts.filter((t) => t.includes('"t":"resync-res"')).length,
      '新链路上没有 resync-res（房主没把档案交出来）').toBeGreaterThan(0);

    // ② 加入方真的收到了档案、并且按它重建（`stateAtStep`，D9 的单一出处）
    expect(received, '加入方从来没有收到过档案').not.toBeNull();
    const got = received as MatchFile | null;
    expect(got?.actions.length, '收到的档案条数与房主手里的不一致').toBe(3);
    expect(guestApplied, '加入方自报应用了几步').toBe(3);

    // ③ 判据 1 的硬要求（T13-B 同一条比法）：两端规范串**整串**逐字相等
    expect(stableStringify(guestState), '追平之后两端的规范串不相等（只是"看起来追上了"）')
      .toBe(hostCanonical);
    expect(guest.state().peer?.needsResync, '追平之后 needsResync 还是真').toBe(false);
    expect(guest.state().peer?.phase, '追平之后相位没有离开 resync-pending')
      .not.toBe('resync-pending');
    // ④ 追平之后两端在新链路上继续把承诺流程走完（这一局真的接回来了）
    expect(guest.state().peer?.phase, '新链路上这一局没有走回 complete（接回来了但打不了）')
      .toBe('complete');
    expect(host.state().peer?.phase, '房主那一侧也没有走回 complete').toBe('complete');
  });
});
