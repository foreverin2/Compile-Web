/**
 * G5 T22 收尾的守卫：`lobbyPlainStatus`（状态区那句"人话"）—— 评审登记的**零测试缺口**。
 *
 * ## 这条腿钉的是什么
 *
 * 评审（`.superpowers/g5-T22/T22-REVIEW.md` §判据 X）点出同一屏上两句顶着说：
 * 人话那一行写"对端在线，这一步还没走完。"，紧接着 T6 那张表写"对端在线，可以开始这一局。"。
 * ⇒ 这一格**交出这一行**（返回 `null`），由 T6 那句说。这条腿把它钉成机检：
 *
 *  1. **`online && !handshakeDone` ⇒ `null`**（就是上面那一格，改回去必须红）；
 *  2. 离线那三格只说"对端还没接上来。" —— **不带动作**（动作归步骤条的「现在：…」；
 *     带动作的旧文案在"房主刚点建房、码还没生成"那一帧与步骤条直接矛盾）；
 *  3. "已接上 / 追平"两格照旧（评审说保留的那两格）；
 *  4. **渲染腿**：把那一格喂进 `renderNetLobby` ⇒ 屏上**没有** `.net-lobby-status-human`，
 *     而 `.net-lobby-link` 的正文就是 `lobbyLinkText()` 那一句（读数同源那条链没被绕开）。
 *
 * ⚠️ 它**不碰** T6 那张表（`lobbyLinkText` 只被读、被比），也不碰任何门依赖的选择器。
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  descendants, installStubDom, makeStubEl, queryAllIn, type StubNode,
} from './net-dom-stub';
import {
  lobbyLinkText, lobbyPlainStatus, renderNetLobby,
  type LobbyRenderNav, type LobbyState,
} from '../../src/ui/net-lobby';
import type { PeerStatus } from '../../src/net/session';

let restoreDom: (() => void) | null = null;

afterEach(() => {
  restoreDom?.();
  restoreDom = null;
});

/** 一份对端读数（只改要测的那两位，其余照 `PeerStatus` 的默认形状） */
function peer(over: Partial<PeerStatus>): PeerStatus {
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
    ...over,
  };
}

function state(over: Partial<LobbyState>): LobbyState {
  return {
    role: 'host',
    sessionId: 'sid-plain',
    invite: null,
    joined: null,
    roomCodeInput: '',
    roomCodeGate: null,
    transport: 'idle',
    peer: null,
    endpoint: '',
    ice: { servers: [], relayConfigured: false, relayIncomplete: false },
    advancedOpen: false,
    relayOpen: false,
    waitExpired: null,
    error: null,
    notice: null,
    routedIn: 0,
    routedOut: 0,
    helloSent: false,
    answerCode: null,
    answerApplied: null,
    ...over,
  };
}

/** 只够 `renderNetLobby` 走完一帧的最小接缝（动作一律记账，不接线） */
function navOf(s: LobbyState): LobbyRenderNav {
  return {
    state: s,
    backHome: () => { /* 不测动作 */ },
    startHost: () => { /* 不测动作 */ },
    startJoin: () => { /* 不测动作 */ },
    makeInvite: () => { /* 不测动作 */ },
    inviteLength: (payload: string) => `长度 ${String(payload.length)}`,
    qrNote: () => '',
    setRoomCode: () => { /* 不测动作 */ },
    submitRoomCode: () => { /* 不测动作 */ },
    joinWithInvite: () => { /* 不测动作 */ },
    toggleAdvanced: () => { /* 不测动作 */ },
    toggleRelay: () => { /* 不测动作 */ },
    settingsValue: () => '',
    setSetting: () => { /* 不测动作 */ },
    errorText: () => '',
    makeAnswerCode: () => { /* 不测动作 */ },
    applyAnswerCode: () => { /* 不测动作 */ },
  };
}

function render(s: LobbyState): StubNode {
  restoreDom = installStubDom();
  const root = makeStubEl('div');
  renderNetLobby(root as unknown as HTMLElement, navOf(s));
  return root;
}

const textOf = (root: StubNode): string => descendants(root).map((n) => n.text).join('\n');

describe('G5 T22 收尾 · `lobbyPlainStatus`：不留与 T6 那句顶着说的行', () => {
  it('★ `online && !handshakeDone` ⇒ `null`（这一格交给 T6 那句，改回去必须红）', () => {
    const p = peer({ online: true, handshakeDone: false, phase: 'handshaking' });
    expect(lobbyPlainStatus(state({ peer: p })), '这一格又自己写了一句（与 T6 那句顶着说）').toBeNull();
    // 反空转：同一份读数在 T6 那张表上**有**一句（否则上面的 null 可能只是"什么都没渲染"）
    expect(lobbyLinkText(p), '夹具失败：这一格在 T6 那张表上也没有话').toContain('对端在线');
  });

  it('渲染腿：那一格屏上没有 `.net-lobby-status-human`，而 `.net-lobby-link` 就是 T6 那句', () => {
    const p = peer({ online: true, handshakeDone: false, phase: 'handshaking' });
    const root = render(state({ peer: p, transport: 'online' }));
    expect(queryAllIn(root, 'div.net-lobby-status').length, '连接状态块不在').toBe(1);
    expect(queryAllIn(root, '.net-lobby-status-human').length,
      '那一格又画了一句人话（与紧挨着的 T6 那句顶着说）').toBe(0);
    expect(queryAllIn(root, '.net-lobby-link')[0]?.text, '`.net-lobby-link` 的正文不是 T6 那句')
      .toBe(lobbyLinkText(p));
  });

  it('★ 离线三格只说"对端还没接上来。"：**不带动作**（动作归步骤条的「现在：…」）', () => {
    const offline = [
      peer({ online: false, handshakeDone: false, windowExpired: false }),
      peer({ online: false, handshakeDone: false, windowExpired: true }),
      peer({ online: false, handshakeDone: false, windowExpired: null }),
    ];
    for (const p of offline) {
      for (const role of ['host', 'guest'] as const) {
        const line = lobbyPlainStatus(state({ role, peer: p }));
        expect(line, `离线那一格（windowExpired=${String(p.windowExpired)}）没给话`).toBe('对端还没接上来。');
        // 旧文案里那两句动作与步骤条的「现在：…」重复（房主那一句在"码还没生成"时还与它矛盾）
        for (const banned of ['把邀请码发给对方', '把回示码发回给房主', '还没走完']) {
          expect(String(line).includes(banned), `离线那一行又带上了「${banned}」`).toBe(false);
        }
      }
    }
    // 渲染腿：那一行在屏上出现，且步骤条那句「现在：…」仍然在（动作没被删掉，只是归了步骤条）
    const root = render(state({ role: 'host', invite: null, peer: offline[0] }));
    const human = queryAllIn(root, '.net-lobby-status-human');
    expect(human.length, '离线那一格屏上没有人话那一行').toBe(1);
    expect(human[0].text, '离线那一行不是那句').toBe('对端还没接上来。');
    expect(textOf(root), '步骤条那句「现在：…」不见了（动作指引被一起删掉了）').toContain('现在：点「生成邀请码」。');
  });

  it('"已接上 / 追平"两格照旧；没有链路读数时不出这一行', () => {
    expect(lobbyPlainStatus(state({ peer: peer({ online: true, handshakeDone: true }) })))
      .toBe('两边都接上了。');
    expect(lobbyPlainStatus(state({ peer: peer({ online: false, needsResync: true, needsResyncDetail: '细节' }) })))
      .toBe('这一局在追平：等对方把缺掉的那几步补上。');
    expect(lobbyPlainStatus(state({ peer: null })), '没有对端读数却给了一句人话').toBeNull();
  });
});
