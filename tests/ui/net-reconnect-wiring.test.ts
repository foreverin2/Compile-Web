/**
 * G5 T13-A：**重发链的接线**（`redrive()` 的第一批调用者；D23）。
 *
 * ## 这个文件证明什么、不证明什么
 *
 * 证明的是**接线**（判据 1 的 node 面 + 判据 2 + 判据 3）：
 * 一条**真的 `NetTransport`**（`src/net/fake-transport.ts`，生产代码）上，链路转过
 * `offline -> online` 之后：
 *  - 断线期间**发失败**的那条消息（D23 的形态：`doSend` 在 `status !== 'online'` 时返回
 *    失败、**不排队** ⇒ 那条消息按连接语义已经丢了）被**按相位重发**了一次；
 *  - **冷启动**的 `idle -> connecting -> online` **不算恢复** ⇒ 一条都不重发（判据 2 的
 *    "只在恢复且确有在途消息时发"）；
 *  - 重连的 `hello` 带 `resuming: true` 且**被房主 ack**；不带那个字段的普通 hello
 *    在同一个相位上**被拒**（负控）。
 *
 * 真浏览器里的端到端腿在 `tools/browser-truth-reconnect-cdp.mjs`（两个场景），
 * 实测时刻与判定集写在 `.superpowers/g5-T13/T13AB-REPORT.md`。两条腿各证一半：
 * 这里证"接线可数"，那里证"玩家能用"。
 *
 * ## 断线怎么造
 *
 * `FakePort.deactivate()`（`fake-transport.ts:713-721`）：两端一起转 `offline` 并通知订阅者，
 * 此后 `send` / `sendIfOpen` **返回失败、不排队**（`fake-transport.ts:541-556`）——
 * 这正是 D23 说的"按连接语义已经丢了"。`activate()` 把两端转回 `online`，那才是"链路回来了"。
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
import { stripComments, functionBody } from './source-text';

/* ==================================================================== *
 * 夹具：两个真客户端 + 一条真（假件）传输对
 * ==================================================================== */

/** 假计时器（本文件不用它推进任何东西；`createLobbyClient` 要一个注入的计时能力） */
function fakeTicker(): LobbyTicker {
  let h = 0;
  return { schedule: () => { h += 1; return h; }, cancel: () => { /* 不排真时钟 */ } };
}

function makeSide(
  role: 'host' | 'guest',
  sessionId: string,
  transports: readonly NetTransport[],
  /** ★ G5 T13-A（协调者 2026-09-20 第 2 条）：本端有没有"可续的对局进度" */
  hasResumableGame: () => boolean = () => true,
): LobbyClient {
  let next = 0;
  return createLobbyClient({
    role,
    sessionId,
    // T11-A：种子与随机串是注入的（本文件不校验它们的值；那几条腿在别处）
    matchSeed: 'mseed-t13a',
    randomToken: () => `rtok-t13a-${String(next)}`,
    localProtoVersion: PROTO_VERSION,
    localCardDataHash: CARD_DATA_HASH,
    hash: browserHash(),
    ticker: fakeTicker(),
    hasResumableGame,
    createTransport: () => {
      const t = transports[Math.min(next, transports.length - 1)];
      next += 1;
      if (t === undefined) throw new Error('makeSide：传输用完了（夹具写错了）');
      return t;
    },
    signalingEndpoint: '',
    readSettings: () => ({ turnUrl: '', turnUsername: '', turnCredential: '' }),
    buildInvite: async () => ({ ok: true as const, payload: 'P', link: 'https://example.test/#invite=P' }),
    decompressBase64: async () => null,
    readAddressBar: () => null,
    localNick: () => (role === 'host' ? '房主' : '加入方'),
  });
}

/**
 * 交替"投递 + 驱动"若干轮。
 *
 * ⚠️ 两件事缺一不可：`pump` 是**假件的投递**（帧只在 pump 时到达对端），`drive` 是
 * **接线层的相位驱动**（`onInbound` 也会驱动，这里显式调一次保证收敛）。
 */
function settle(
  pair: ReturnType<typeof createFakeTransportPair>,
  a: LobbyClient,
  b: LobbyClient,
  rounds = 12,
): void {
  for (let i = 0; i < rounds; i += 1) {
    pair.pump(1);
    a.drive();
    b.drive();
  }
}

const phaseOf = (c: LobbyClient): string => String(c.state().peer?.phase);
const framesOf = (pair: ReturnType<typeof createFakeTransportPair>, t: string): number =>
  pair.steps().filter((s) => s.text.includes(`"t":"${t}"`)).length;

/**
 * 交替"驱动 + 投递"，**停在预测为真的那一步之前**。
 *
 * 为什么需要它：这条腿要的正是"房主已经发出 `reveal-seed`、而那条消息**还没到**对端"那一格
 * —— `settle` 会一路走到 `complete`（中间态被吃掉），所以这里逐轮推进、每轮先判预测。
 */
function driveUntil(
  pair: ReturnType<typeof createFakeTransportPair>,
  a: LobbyClient,
  b: LobbyClient,
  pred: () => boolean,
  maxRounds = 40,
): boolean {
  for (let i = 0; i < maxRounds; i += 1) {
    if (pred()) return true;
    a.drive();
    b.drive();
    pair.pump(1);
  }
  return pred();
}

/* ==================================================================== *
 * 判据 1（node 面）+ 判据 2：恢复那一刻按相位重发
 * ==================================================================== */

describe('★★ G5 T13-A 判据 1/2：链路恢复 ⇒ 按相位重发在途消息（D23 ②）', () => {
  it('断线期间发失败的那条消息在恢复那一刻被重发一次；握手继续走到 complete', async () => {
    const pair = createFakeTransportPair();
    /**
     * 两侧都**不注入 `chooseFace`**：这条腿要的是"承诺-揭示流程一路走到底"，而面那件事
     * （谁叫面、重连不重掷）归判据 3 与硬币那几条腿。没有注入时面走常量 0
     * （`faceFromSide(1)`，T11-B 之前那条路），在链路上与"玩家点了一下"等价。
     */
    const host = makeSide('host', 'sid-t13a', [pair.A.transport]);
    const guest = makeSide('guest', 'sid-t13a', [pair.B.transport]);
    await host.connect('first');
    await guest.connect('first');
    // 推进到"加入方刚发出承诺（face-committed）、那一帧还没到房主"那一格
    const atGuestCommitted = driveUntil(pair, host, guest, () => phaseOf(guest) === 'face-committed');
    expect(atGuestCommitted, `加入方没走到 face-committed（停在 ${phaseOf(guest)}）`).toBe(true);
    expect(phaseOf(host), `房主该还在等那条承诺（停在 ${phaseOf(host)}）`).toBe('awaiting-commit-face');
    // 反空转：那条 `commit-face` 真的上了线序（`steps()` 只记**到达**的帧，这里要的是"发出去了"）
    expect(pair.B.sendSeq(), '反空转：加入方一条帧都没发过（夹具没把流程走起来）').toBeGreaterThan(0);

    /* ── ① 拔线：两端转 offline（此后 `send` 返回失败、**不排队** ⇒ 那条消息真的丢）──── */
    pair.A.deactivate();
    expect(pair.A.transport.status(), '夹具失败：拔线之后房主那条链路还是 online').toBe('offline');
    /**
     * 继续投递（`pump` **不看可达性**）：房主收下那条承诺 ⇒ **当场**要揭示种子，
     * 而这一条在 offline 下**发失败**（`doSend` 的 `status !== 'online'` 那一支，不排队）——
     * 这正是 D23 的形态："按连接语义已经丢了，重连后两端谁都不会再发它"。
     */
    const lost = driveUntil(pair, host, guest, () => phaseOf(host) === 'seed-revealed', 12);
    expect(lost, `房主没往前走（那条 reveal-seed 根本没被尝试发出去；房主停在 ${phaseOf(host)}）`).toBe(true);
    expect(framesOf(pair, 'reveal-seed'), '反空转：拔线之后线上竟然收到了 reveal-seed（那条没丢）').toBe(0);
    // 相位上确有在途消息（`seed-revealed` + `seedMadePublic` ⇒ `redrive()` 推得出 `reveal-seed`），
    // 但链路还没恢复 ⇒ 判据 2 要求这一刻**什么都不发**。
    expect(host.redrivenCount(), '链路还没恢复就重发了（判据 2：只在恢复那一刻发）').toBe(0);

    /* ── ② 恢复：链路自己转回 online ⇒ 接线在那一刻重发那一条 ────────────────────── */
    const sendsBefore = pair.A.sendSeq();
    pair.A.activate();
    expect(pair.A.transport.status(), '夹具失败：activate 之后没转回 online').toBe('online');
    expect(host.redrivenCount(), '恢复那一刻没有重发（变异 M1：去掉 redrive 调用 ⇒ 这里恒 0）').toBe(1);
    expect(pair.A.sendSeq(), '重发没有真的上线（redrivenCount 涨了但线上没有帧）').toBeGreaterThan(sendsBefore);

    /* ── ③ 反空转：线上那一条**就是** reveal-seed（不是别的帧把计数顶上去）────────── */
    pair.pump(4);
    expect(framesOf(pair, 'reveal-seed'), '线上从来没有出现过 reveal-seed（重发的那条不是它）').toBe(1);

    /* ── ④ 握手继续走到底 ──────────────────────────────────────────────────────── */
    settle(pair, host, guest, 24);
    expect(phaseOf(guest), `加入方没走到 complete（停在 ${phaseOf(guest)}）`).toBe('complete');
    expect(phaseOf(host), `房主没走到 complete（停在 ${phaseOf(host)}）`).toBe('complete');
    expect(guest.commitmentVerified(), '加入方的承诺校验结论不是 true（承诺-揭示流程没走完）').toBe(true);

    /* ── ⑤ 判据 2 的第二半：**有界**（恢复才发，不是每帧都发）────────────────────── */
    expect(host.redrivenCount(), '整条流程里的重发次数必须是有界的').toBeLessThanOrEqual(2);
    /**
     * ★★ **§9 第 9 条 + T11-A 的那条不变式**：整条重连路上**任何**第二条 `commit-face`
     * 都必须是**逐字相同**的那一条（同一个 `hash` ⇒ 房主最后验 `reveal-face` 不会失配）。
     *
     * 实测（本条腿跑出来的事实）：恢复那一刻**两端各自**按相位重发 —— 房主重发 `reveal-seed`、
     * 加入方重发 `commit-face`（它的相位正是"这条承诺发出去了、但对端不一定收到"那一格）。
     * 所以线上会有两条 `commit-face`，而它们**必须逐字相同**：
     *  - 相同 ⇒ 靠的是 T11-A 那条按链路记忆的 nonce（`faceNonce()`）；少了它就会现取一条新 nonce，
     *    承诺哈希随之改变，房主记下的 `guestFaceHash` 与本条不一致 ⇒ 最后验 `reveal-face` 失配；
     *  - 而"内容不同的第二条承诺"正是 §9 第 9 条点名的那个形态 ⇒ 这条断言同时钉住两者。
     *
     * ⚠️ 诚实登记：`faceSent` 那个一次性位防的是**另一件事**（同一格被走两遍 ⇒ 相位回退路径），
     * 那条路在本轮接线之后**结构上不可达**（要 `phaseBeforeResyncApply ∈ {resuming, handshaking}`
     * 且 `seedHash` 已记下，而 `acceptCommit` 一收下承诺就把相位写成 `seed-committed` ⇒ 那个组合
     * 到不了）。变异实测：删掉 `faceSent` ⇒ 本文件 0 红。见报告里"§9 第 9 条的处置"一节。
     */
    const faces = pair.steps().filter((s) => s.text.includes('"t":"commit-face"')).map((s) => s.text);
    expect(faces.length, '整条路上一条 commit-face 都没有（反空转）').toBeGreaterThan(0);
    expect(new Set(faces).size, `第二条 commit-face 与第一条**不一样**了（§9 第 9 条：房主验 reveal-face 必失配）：${faces.join(' || ')}`)
      .toBe(1);
  });

  it('冷启动的 online（idle -> connecting -> online）**不算恢复** ⇒ 一条都不重发', async () => {
    const pair = createFakeTransportPair();
    const host = makeSide('host', 'sid-t13a-cold', [pair.A.transport]);
    const guest = makeSide('guest', 'sid-t13a-cold', [pair.B.transport]);
    await host.connect('first');
    await guest.connect('first');
    // 驱动到"房主发过 commit、还没收到 face"那一格 —— 正是 `redrive()` 会推出 `commit` 的相位
    settle(pair, host, guest, 3);
    expect(host.redrivenCount(), '冷启动的 online 被当成了"恢复"（判据 2）').toBe(0);
    expect(guest.redrivenCount(), '加入方在冷启动时也重发了').toBe(0);
    // 反空转：这一刻房主**确实**有在途消息可重发（否则上面两条只是"没东西可发"）
    const hostPhase = phaseOf(host);
    expect(['awaiting-commit-face', 'seed-revealed'], `房主的相位是 ${hostPhase}，不在"有在途消息"那两格`)
      .toContain(hostPhase);
  });
});

/* ==================================================================== *
 * 判据 3：重连的 hello 带 resuming ⇒ 被 ack；不带 ⇒ 被拒（负控）
 * ==================================================================== */

describe('★★ G5 T13-A 判据 3：重连的 hello 必须带 `resuming: true` 且被 ack', () => {
  it('`connect(\'resume\')` ⇒ 线上那条 hello 带 resuming=true、房主回 ack、加入方随即要档案', async () => {
    const pair = createFakeTransportPair();
    const host = makeSide('host', 'sid-t13a-resume', [pair.A.transport]);
    const guest = makeSide('guest', 'sid-t13a-resume', [pair.B.transport]);
    await host.connect('first');
    await guest.connect('first');
    settle(pair, host, guest, 8);
    // 反空转：房主已经不在 handshaking ⇒ 普通（不带 resuming 的）hello 会被 refuseLateHello 拒
    expect(phaseOf(host), '反空转：房主还在 handshaking，这条腿比不出"迟到 hello 被拒"')
      .not.toBe('handshaking');
    const acksBefore = framesOf(pair, 'hello-ack');
    const reqsBefore = framesOf(pair, 'resync-req');

    // ── 重连：**新建会话对象**（A5 的形态）+ `markResuming()`（`connect('resume')` 内部做）──
    await guest.reconnect();
    expect(phaseOf(guest), 'reconnect 之后加入方不在 resuming（markResuming 没被调）').toBe('resuming');
    settle(pair, host, guest, 10);

    /* ① 线上真的出现过带 `resuming: true` 的 hello（没有它，整条重建路发不起来） */
    const resumed = pair.steps().filter((s) => s.text.includes('"t":"hello"') && s.text.includes('"resuming":true'));
    expect(resumed.length, '线上从来没有出现过带 resuming:true 的 hello').toBeGreaterThan(0);
    /* ② 房主**回了 ack**（而不是把它当迟到的 hello 拒掉：refuseLateHello 的 emit 是 false） */
    expect(framesOf(pair, 'hello-ack'), '房主没有回第二条 hello-ack（refuseLateHello 那一条）')
      .toBeGreaterThan(acksBefore);
    /* ③ 加入方收下 ack 之后**随即去要档案**（`resync-req` 的唯一构造点在接线层） */
    expect(framesOf(pair, 'resync-req'), '加入方没有去要档案（resync-req 没发出去）')
      .toBeGreaterThan(reqsBefore);
    /* ④ 两端都认为"需要一次追平"（那是玩家会看到的那句话的来源） */
    expect(guest.state().peer?.needsResync, '加入方的 needsResync 不是真').toBe(true);
    expect(host.state().peer?.needsResync, '房主的 needsResync 不是真（它没认出这是重连握手）').toBe(true);
    expect(guest.state().peer?.needsResyncCause, '加入方的 cause 不是 resuming-handshake')
      .toBe('resuming-handshake');
  });

  it('负控：**同一相位**上喂一条不带 resuming 的普通 hello ⇒ 房主不回 ack', async () => {
    const pair = createFakeTransportPair();
    const host = makeSide('host', 'sid-t13a-plain', [pair.A.transport]);
    const guest = makeSide('guest', 'sid-t13a-plain', [pair.B.transport]);
    await host.connect('first');
    await guest.connect('first');
    settle(pair, host, guest, 8);
    const acksBefore = framesOf(pair, 'hello-ack');
    const hostPhase = phaseOf(host);
    // 直接往线上排一条**普通** hello（没有 resuming 字段）—— 与"忘了带那个字段"逐字同形
    pair.B.schedule('act', JSON.stringify({
      t: 'hello', role: 'player', sessionId: 'sid-t13a-plain',
      protoVersion: PROTO_VERSION, cardDataHash: CARD_DATA_HASH, seat: 1, nick: '加入方',
    }));
    pair.pump(2);
    expect(framesOf(pair, 'hello-ack'), '房主给一条迟到的普通 hello 回了 ack（refuseLateHello 那一条失效了）')
      .toBe(acksBefore);
    expect(phaseOf(host), '房主的相位被一条迟到的普通 hello 改动了').toBe(hostPhase);
  });
});

/* ==================================================================== *
 * 修复轮（2026-09-20 评审第 1 条）：**开局期掉线 —— 可读 + 可重来**
 * ==================================================================== */

describe('★★ G5 T13-A 开局期掉线：不假装续上、给可读结论、大厅控件可再次使用', () => {
  /**
   * ## 评审判上一版不成立的两道墙（读码可核）
   *
   *  1. `src/net/session.ts:1515-1517`：房主相位不是 `handshaking` **且** hello 不带 `resuming`
   *     ⇒ `refuseLateHello`（不回 ack）。开局期房主会话**还活着**（相位 `awaiting-commit-face`）
   *     ⇒ "新的一次握手"的那条普通 hello 当场被拒，加入方停在 `handshaking`；
   *  2. `connect()` 每次都 `createTransport()` ⇒ 新链路要**重新交换邀请码/回示码**才可能通，
   *     而自动分支里没有"重贴码"这个动作。
   *
   * ⇒ 生产口径改成：**如实说清"这一局还没开始：请重新生成邀请码 / 重新加入"**，并把屏退回
   * **大厅那一屏**（那三样控件本来就在那里，玩家点一下就能重来）。**本轮没有做自动重贴码。**
   *
   * ## 下面两条腿的分工（前一条只证"两个新会话之间握手能走完"，是夹具事实）
   *
   *  - 第 1 条：`hasResumableGame() === false` 时 `reconnect()` 究竟选哪个模式（这是"可重来"的
   *    **前置条件**）。⚠️ 它的夹具是**两端各传同一个已连通的传输、并显式 `await host.reconnect()`**
   *    —— 那**不是**生产路径（生产里那一步是玩家分别点「生成邀请码」/ 贴码完成的）。它证的是
   *    "两个**新**会话之间的普通握手能走到底"，**不证**"生产能自动续上"；
   *  - 第 2-4 条：生产路径上的事实（源码腿 + 渲染腿）：那一格**不许调** `client.reconnect()`、
   *    屏上必须有那条如实结论、且**大厅控件可再次使用**。
   */
  it('（夹具事实）没有可续的对局 ⇒ `reconnect()` 走 `first`：不见 resuming、线上是普通 hello', async () => {
    const pair = createFakeTransportPair();
    // ⚠️ 夹具前提：两端各传同一个已连通的传输（**不是生产路径**，见本块头注）
    const host = makeSide('host', 'sid-t13a-pregame', [pair.A.transport, pair.A.transport], () => false);
    const guest = makeSide('guest', 'sid-t13a-pregame', [pair.B.transport, pair.B.transport], () => false);
    await host.connect('first');
    await guest.connect('first');
    settle(pair, host, guest, 24);
    expect(guest.commitmentVerified(), '反空转：第一遍握手没走完').toBe(true);

    const hellosBefore = framesOf(pair, 'hello');
    await guest.reconnect();
    await host.reconnect();
    settle(pair, host, guest, 20);

    expect(phaseOf(guest), '没有可续对局时加入方停在了 resuming（死挂回来了）').not.toBe('resuming');
    expect(guest.state().peer?.needsResync, '没有可续对局时 needsResync 竟然是真（被写成了"重连可用"）')
      .toBe(false);
    const plainHellos = pair.steps()
      .filter((s) => s.text.includes('"t":"hello"') && !s.text.includes('"resuming"'));
    expect(framesOf(pair, 'hello'), '重连之后线上没有新的 hello（握手没有重新开始）')
      .toBeGreaterThan(hellosBefore);
    expect(plainHellos.length, '线上没有不带 resuming 的 hello（本该走 first）').toBeGreaterThan(0);
  });

  it('对照：有可续的对局 ⇒ 仍是 `resume`（带 resuming 的 hello + needsResync）', async () => {
    const pair = createFakeTransportPair();
    const host = makeSide('host', 'sid-t13a-pregame2', [pair.A.transport]);
    const guest = makeSide('guest', 'sid-t13a-pregame2', [pair.B.transport]);
    await host.connect('first');
    await guest.connect('first');
    settle(pair, host, guest, 8);
    await guest.reconnect();
    expect(phaseOf(guest), '有可续对局时反而没走 resume').toBe('resuming');
    expect(guest.state().peer?.needsResync, '有可续对局时 needsResync 不是真').toBe(true);
  });

  it('★ 源码腿（生产路径）：开局期那一格**不调** `client.reconnect()`，只给结论 + 退回大厅', () => {
    const src = stripComments(
      readFileSync(fileURLToPath(new URL('../../src/main.ts', import.meta.url))).subarray(0, 8 * 1024 * 1024).toString('utf8'),
    );
    const body = functionBody(src, 'attachLobbyReconnect');
    // ① 那条如实结论逐字在（玩家能读到"这一局还没开始"与两条退路）
    expect(body, '没有"这一局还没开始"这句结论').toContain('这一局还没开始');
    expect(body, '结论里没让玩家重新生成邀请码').toContain('重新生成邀请码');
    expect(body, '结论里没让玩家重新加入').toContain('重新加入');
    // ② 反向：不许写成"重连可用"
    for (const bad of ['已经接上', '已经续上', '自动重连', '已经续上这一局']) {
      expect(body, `那一行把开局期这条路写成了"${bad}"`).not.toContain(bad);
    }
    // ③ 开局期那一支里**不许**调 `client.reconnect()`（新传输永远连不上，见本块头注）
    const guard = body.indexOf('if (netGame === null) {');
    expect(guard, '开局期那一支不见了').toBeGreaterThanOrEqual(0);
    const branch = body.slice(guard, body.indexOf('reconnecting = true;', guard));
    expect(branch.length, '开局期那一支是空的（切错了 ⇒ 这条腿假绿）').toBeGreaterThan(80);
    expect(branch, '开局期那一支仍然调了 `client.reconnect()`（新传输连不上、玩家还是挂在原地）')
      .not.toContain('client.reconnect()');
    // ④ 它把屏退回大厅那一屏（`lobbyRestartNeeded`），于是三样控件可再次使用
    expect(branch, '开局期那一支没有把屏退回大厅那一屏').toContain('lobbyRestartNeeded = true');
    expect(branch, '退回大厅之后没有重画一帧（玩家看不到那一行）').toContain('renderLobbyFrame()');
  });

});
