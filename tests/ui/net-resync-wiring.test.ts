/**
 * G5 T13-B：**档案追平的接线**（`acceptResyncRes()` / `applyResyncFile()` 的第一批调用者）。
 *
 * ## 这个文件证明什么
 *
 *  - **判据 1（node 面）**：落后的那一端在重连之后**真的**被档案追平 —— 复原出来的状态与
 *    提交方手里那份**规范串逐字相等**（`stableStringify` 整串，与 T12 门那条比法同一份实现），
 *    而不只是"看起来追上了"；
 *  - **判据 2**：追平入口的**唯一性**（文本腿：`session.applyResyncFile(` 恰一处、
 *    `resync-req` 的构造恰一处、两种 cause 各有各的入口）；
 *  - **判据 3**：宿主拒绝/失败时**不许静默覆盖** —— 会话层必须停在"还没追平"那一格。
 *
 * ## 真浏览器面**没做**（修复轮 2026-09-20 改正头注）
 *
 * 上一版这里写的是"端到端腿在 `tools/browser-truth-reconnect-cdp.mjs` 的场景 b"——**与事实相反**：
 * 那道门里 `resync|追平` **零命中**（它只覆盖"同链路恢复 ⇒ redrive"）。
 * 追平要求重连后重新交换 SDP（= 回大厅重新贴码），而进了牌桌之后 `renderMode === 'net'`、
 * 屏上没有回大厅的入口 ⇒ 归 T13-C。**B 段今天只有 node 面**（报告 §2.1 与这里口径一致）。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createFakeTransportPair } from '../../src/net/fake-transport';
import type { NetTransport } from '../../src/net/transport';
import { createLobbyClient, type LobbyClient, type LobbyTicker } from '../../src/ui/net-lobby';
import { browserHash } from '../../src/ui/net-browser';
import { PROTO_VERSION } from '../../src/net/protocol';
import { CARD_DATA_HASH } from '../../src/app/card-data-hash';
import { createGame, getDraftPool } from '../../src/core/state/create';
import { applyRecordedAction, stateAtStep } from '../../src/app/match-replay';
import { createMatchFileRecorder, setupFromState, DRAFT_PICK_KIND, type MatchFile } from '../../src/app/match-file';
import { stableStringify } from '../../src/core/fingerprint';
import type { GameState, PlayerId } from '../../src/core/models/types';
import { stripComments, functionBody } from './source-text';

/* ==================================================================== *
 * 夹具
 * ==================================================================== */

function fakeTicker(): LobbyTicker {
  let h = 0;
  return { schedule: () => { h += 1; return h; }, cancel: () => { /* 不排真时钟 */ } };
}

const MAIN = stripComments(
  readFileSync(fileURLToPath(new URL('../../src/main.ts', import.meta.url))).subarray(0, 8 * 1024 * 1024).toString('utf8'),
);
const LOBBY = stripComments(
  readFileSync(fileURLToPath(new URL('../../src/ui/net-lobby.ts', import.meta.url))).subarray(0, 8 * 1024 * 1024).toString('utf8'),
);

function countOf(src: string, token: string): number {
  let n = 0;
  for (let i = src.indexOf(token); i >= 0; i = src.indexOf(token, i + 1)) n += 1;
  return n;
}

/** 一局真的对局状态 + 记录器：房主那一侧手里那份"权威档案"就是从它来的 */
function makeHostSide(seed: string): {
  state: GameState;
  recorder: ReturnType<typeof createMatchFileRecorder>;
  file: () => MatchFile;
  pick: (defId: string, player: PlayerId) => void;
} {
  const state = createGame({ seed, draftStarter: 0, firstToPlay: 1, draftMode: 'normal' });
  const recorder = createMatchFileRecorder();
  const file = (): MatchFile => recorder.toMatchFile({
    seed: state.rng.seed,
    setup: setupFromState(state),
    players: [{ nick: '房主' }, { nick: '加入方' }],
    cardDataHash: CARD_DATA_HASH,
    createdAt: new Date(0).toISOString(),
  });
  const pick = (defId: string, player: PlayerId): void => {
    const rec = { player, kind: DRAFT_PICK_KIND as 'draft-pick', args: { defId } };
    recorder.record(rec);
    applyRecordedAction(state, { ...rec, seq: recorder.actions().length - 1 });
  };
  return { state, recorder, file, pick };
}

function makeClient(
  role: 'host' | 'guest',
  sessionId: string,
  transport: NetTransport,
  extra: {
    readonly appliedSteps?: () => number;
    readonly resyncSource?: () => MatchFile | null;
    readonly onResyncRes?: (file: MatchFile) => number | null;
  } = {},
): LobbyClient {
  let n = 0;
  return createLobbyClient({
    role,
    sessionId,
    matchSeed: 'mseed-t13b',
    randomToken: () => `rtok-t13b-${String(n)}`,
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
    /**
     * ★ G5 T13-A（协调者 2026-09-20 第 2 条）：这一组腿模特的是"**已经进牌桌**之后掉线"
     * ⇒ 有可续的对局进度 ⇒ 重连走 `'resume'`（要档案追平）。开局期那条路（没有可续进度 ⇒
     * 重新握手）由 `tests/ui/net-reconnect-wiring.test.ts` 的对应腿覆盖。
     */
    hasResumableGame: () => true,
    ...extra,
  });
}

function settle(
  pair: ReturnType<typeof createFakeTransportPair>,
  a: LobbyClient,
  b: LobbyClient,
  rounds = 16,
): void {
  for (let i = 0; i < rounds; i += 1) {
    pair.pump(1);
    a.drive();
    b.drive();
  }
}

/* ==================================================================== *
 * 判据 1（node 面）：落后的那一端被档案追平，两端规范串逐字相等
 * ==================================================================== */

describe('★★ G5 T13-B 判据 1：档案追平（`resync-res` → `applyResyncFile`）', () => {
  it('掉线期间对端走了 3 步 ⇒ 追平之后两端的规范串逐字相等（整串，不是长度）', async () => {
    const seed = 'g5t13b-catchup';
    const pair = createFakeTransportPair();
    const hostSide = makeHostSide(seed);
    /**
     * 加入方那一侧的状态**故意从第 0 步起**（= 它掉线期间一步都没跟上），而房主会走到第 3 步。
     * 这条腿要的就是"追平把这段差距补上"，所以起点必须是**真的落后**。
     * 两端都从同一个 `createGame` 起跑（same seed ⇒ 同一副牌、同一个池子）。
     */
    let guestState = createGame({ seed, draftStarter: 0, firstToPlay: 1, draftMode: 'normal' });
    let guestApplied = 0;
    let received: MatchFile | null = null;
    let rebuildRefused = false;

    const host = makeClient('host', 'sid-t13b', pair.A.transport, { resyncSource: () => hostSide.file() });
    const guest = makeClient('guest', 'sid-t13b', pair.B.transport, {
      appliedSteps: () => guestApplied,
      onResyncRes: (file) => {
        received = file;
        if (rebuildRefused) return null; // 「本端拒绝重建」那条路（判据 3 的腿会把它打开）
        guestState = stateAtStep(file, file.actions.length);
        guestApplied = file.actions.length;
        return guestApplied;
      },
    });
    await host.connect('first');
    await guest.connect('first');
    settle(pair, host, guest);
    expect(guest.commitmentVerified(), '反空转：这一局没走到承诺校验通过（夹具没把流程走起来）').toBe(true);

    /* ── 掉线期间房主继续推进 3 步（草稿：轮次是 1-2-2-1…，只由轮选者提交）────────── */
    const pool = getDraftPool(hostSide.state).map((p) => p.defId);
    hostSide.pick(pool[0], 0); // draftStarter = 0
    hostSide.pick(pool[1], 1);
    hostSide.pick(pool[2], 1);
    expect(hostSide.recorder.actions().length, '反空转：房主那 3 步没进档案').toBe(3);
    const hostCanonical = stableStringify(hostSide.state);
    expect(stableStringify(guestState), '反空转：加入方本来就追平了（那这条腿什么都没验）').not.toBe(hostCanonical);

    /* ── 加入方重连：要档案 ⇒ 应用 ⇒ 追平 ────────────────────────────────────────── */
    await guest.reconnect();
    settle(pair, host, guest, 24);

    expect(received, '加入方从来没有收到过档案（resync-res 那条链路没接上）').not.toBeNull();
    const got = received as MatchFile | null;
    expect(got?.actions.length, '收到的档案条数与房主手里的不一致').toBe(3);
    expect(guestApplied, '加入方自报应用了几步').toBe(3);
    /**
     * ★★ 判据 1 的硬要求：**两端规范串逐字相等**（`stableStringify` 整串 ——
     * 与 T12 那道门比的是同一份实现、同一种比法）。
     */
    expect(stableStringify(guestState), '追平之后两端的规范串不相等（只是"看起来追上了"）')
      .toBe(hostCanonical);
    // 会话层那一侧：追平完成了 ⇒ `needsResync` 清零、相位被放回去
    expect(guest.state().peer?.needsResync, '追平之后 needsResync 还是真（applyResyncFile 没被走到）')
      .toBe(false);
    expect(guest.state().peer?.phase, '追平之后相位没有离开 resync-pending')
      .not.toBe('resync-pending');
  });

  it('判据 3：宿主拒绝重建（`onResyncRes` 回 null）⇒ 不许静默覆盖，会话层停在"还没追平"', async () => {
    const seed = 'g5t13b-refuse';
    const pair = createFakeTransportPair();
    const hostSide = makeHostSide(seed);
    const guestState = createGame({ seed, draftStarter: 0, firstToPlay: 1, draftMode: 'normal' });
    const before = stableStringify(guestState);
    let asked = 0;
    const host = makeClient('host', 'sid-t13b-refuse', pair.A.transport, { resyncSource: () => hostSide.file() });
    const guest = makeClient('guest', 'sid-t13b-refuse', pair.B.transport, {
      appliedSteps: () => 0,
      onResyncRes: () => { asked += 1; return null; }, // 宿主拒绝：屏上给可读原因（本层不假装成功）
    });
    await host.connect('first');
    await guest.connect('first');
    settle(pair, host, guest);
    const pool = getDraftPool(hostSide.state).map((p) => p.defId);
    hostSide.pick(pool[0], 0);

    await guest.reconnect();
    settle(pair, host, guest, 24);

    expect(asked, '宿主那条重建口一次都没被问到（追平入口没接上）').toBeGreaterThan(0);
    expect(guest.state().peer?.needsResync, '宿主拒绝了，而会话层却把"还需要追平"清掉了（静默覆盖）')
      .toBe(true);
    expect(stableStringify(guestState), '宿主拒绝了，本端状态却被改了').toBe(before);
  });
});

/* ==================================================================== *
 * 判据 2：追平入口的唯一性（文本腿）
 * ==================================================================== */

describe('★★ G5 T13-B 判据 2：两个追平入口各有且仅有一处', () => {
  it('`session.applyResyncFile(` 在 `src/ui/net-lobby.ts` 里恰 1 处（`resync-res` 的落点）', () => {
    expect(countOf(LOBBY, 'session.applyResyncFile('),
      '`applyResyncFile` 的调用点数不是 1（多一处就是第二份追平实现）').toBe(1);
  });

  it('`resync-req` 的**构造**恰 1 处（会话层只有 acceptor，请求由接线层拼）', () => {
    // 构造的形状：`t: 'resync-req',`（后面跟着字段）—— 分派器的 `case 'resync-req':` 不是构造
    expect(countOf(LOBBY, "t: 'resync-req',"), '`resync-req` 的构造点数不是 1').toBe(1);
    // 会话层里必须**没有**产出它的口（这条是"为什么必须由接线层拼"的事实依据）
    const SESSION = stripComments(
      readFileSync(fileURLToPath(new URL('../../src/net/session.ts', import.meta.url))).subarray(0, 8 * 1024 * 1024).toString('utf8'),
    );
    expect(countOf(SESSION, "t: 'resync-req',"), 'session.ts 里居然会产 resync-req（本层的唯一性前提没了）')
      .toBe(0);
    // 反空转：会话层确实**收**它（`case 'resync-req':` 在分派器里，一字未动）
    expect(countOf(SESSION, "case 'resync-req':"), 'session.ts 不再收 resync-req 了（方向分派被改了？）')
      .toBe(1);
  });

  it('两种 cause 各有各的入口：握手那条在 `net-lobby.ts`，溢出那条在 `main.ts`', () => {
    // ① 重连握手：`hello-ack` 到了就去要档案（`resuming-handshake` 那条 cause 的动作）
    const inbound = functionBody(LOBBY, 'receive');
    expect(inbound, 'receive() 里没有"收到 hello-ack ⇒ 要档案"那一格').toContain('requestResync()');
    // ② 入站队列溢出：宿主的失败回调（`queue-overflow` 那条 cause 的动作）
    const overflow = functionBody(MAIN, 'noteNetOverflow');
    expect(overflow, 'noteNetOverflow 没有把溢出的真因转成会话层的 needsResync')
      .toContain("noteResyncNeeded('queue-overflow'");
    expect(overflow, 'noteNetOverflow 没有去要档案（溢出这条路还是恢复不了）').toContain('requestResync()');
    // ③ 反向：溢出那条**不许**混进握手那条（两个 cause 混成一条就分不出"谁落后了"）
    expect(inbound, '握手那条路上出现了 queue-overflow（两种 cause 混了）').not.toContain('queue-overflow');
    expect(overflow, '溢出那条路上出现了 hello-ack（两种 cause 混了）').not.toContain('hello-ack');
  });

  it('`main.ts` 侧：重建口 / 凭据 / 进度各自只有一处，且驱动真的被 realign', () => {
    expect(countOf(MAIN, 'onResyncRes:'), '`onResyncRes` 的注入点数不是 1').toBe(1);
    expect(countOf(MAIN, 'resyncSource:'), '`resyncSource` 的注入点数不是 1').toBe(1);
    expect(countOf(MAIN, 'appliedSteps:'), '`appliedSteps` 的注入点数不是 1').toBe(1);
    // 追平重建里"拿档案算状态"只此一处（`stateAtStep` 在 main.ts 里的第一个调用点）
    expect(countOf(MAIN, 'stateAtStep('), '`stateAtStep` 在 main.ts 里不是 1 处').toBe(1);
    // 驱动侧的进度对齐：两处（换驱动与追平重建）—— 多一处就是第二个"对齐"的口
    expect(countOf(MAIN, 'realign('), '`realign(` 在 main.ts 里不是 2 处').toBe(2);
  });
});
