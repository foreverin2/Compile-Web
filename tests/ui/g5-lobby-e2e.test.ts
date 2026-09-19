/**
 * G5/T8 **D 轮**：一条**端到端**的腿 —— "邀请码那条路"真的能把两端接上。
 *
 * ## 它补的是哪个洞
 *
 * `tests/ui/net-lobby.test.ts` 里那几条握手腿（判据 14 / C2）用的是 `createFakeTransportPair()`：
 * 两端**各自**被喂了同一个 `sessionId: 'sid-c2'`，握手帧由夹具直接 `sendIfOpen` 投出去。
 * 于是"**房主产得出邀请码 → 加入方吃得下 → 两端接上**"这条真实路径上，
 * 下面三处断点**一条腿都碰不到**（`REVIEW-BC.md` 的 I-1 / I-2 / I-3）：
 *
 *  - **I-1**：`onPeerConnection` 只注进了 `lobbyEnvWithIce()`，而 `createTransport` 用的是
 *    `lobbyEnv()` ⇒ 房主那格 `hostPeerConnection` 永远是 `null` ⇒ `applyAnswer` 恒失败；
 *  - **I-2**：`createTransport` 用的那个 env 里**没有 `ticker`** ⇒ `waitForIceGathering` 在
 *    `iceGatheringState !== 'complete'` 时回 `'unsupported'` ⇒ 房主永远取不到连接描述
 *    ⇒ **永远产不出邀请码**（假件缺省的 `'complete'` 让这条缺陷一直假绿）；
 *  - **I-3**：两端**各自** `newSessionId()` ⇒ 线上有两套 `sessionId` ⇒ 房主拒掉加入方的 `hello`。
 *
 * ## 这条腿为什么用**真传输**（`createBrowserTransport`）而不是假传输
 *
 * I-1 / I-2 就住在 `createBrowserTransport(env)` 这一句上：换成假传输，那两处断点会连同
 * "环境里有没有 ticker / 有没有 onPeerConnection"一起被绕过去（腿当场变成恒真）。
 * 所以这里：**传输是真的**（真 `init` / 真 `createOffer` / 真 `waitForIceGathering` /
 * 真 `localDescription` / 真 `sendIfOpen`），**对端连接是假的**
 * （`tests/ui/fake-peer-connection.ts`），两条假连接之间的数据通道**按 channel 名对接**，
 * 让帧真的从一端走到另一端。
 *
 * ## 能力边界（别高估这条腿）
 *
 * 它证的仍然是"在假 SDP / 假候选上那条**代码路径**是通的"。真 SDP 协商、真 ICE 可达性、
 * 两个真浏览器连上——**一条都没证**，那些属 T9 的 CDP 线。
 */
import { describe, expect, it } from 'vitest';
import {
  acceptOffer, applyAnswer, browserHash, createInvite, createBrowserTransport,
  peerConnectionOf, type NetBrowserEnv,
} from '../../src/ui/net-browser';
import { answerPayloadFields } from '../../src/net/invite';
import { createLobbyClient, type LobbyClient, type LobbyTicker } from '../../src/ui/net-lobby';
import { PROTO_VERSION } from '../../src/net/protocol';
import { CARD_DATA_HASH } from '../../src/app/card-data-hash';
import { makeFakePc } from './fake-peer-connection';

/* ==================================================================== *
 * 夹具 1：真计时 + 真 deflate-raw（两条都为了"别把缺陷假绿化"）
 * ==================================================================== */

/**
 * ★★ **真的 `setTimeout`，而且记账**（本文件的关键夹具决定之一）。
 *
 * ## 为什么用真计时器
 *
 * 仓库纪律是"计时一律注入"，但注入**假**计时器在这里会把腿挂住：房主那条路会
 * `await transport.localDescription()`，而假计时器不会自己到点。用真计时器 + 真
 * `'icegatheringstatechange'`，两次 `await` 之间让事件循环转一圈就够了。
 *
 * ## ★ 为什么要记账（I-2 的**判别力**就在这里）
 *
 * "env 里有没有 ticker"这件事，只有在 `waitForIceGathering` 真的**去要上界**时才参与结果。
 * 而"收集完成"若排在超时之前（第一版夹具排 0 ms），有没有 ticker 都会成功 ⇒ 腿假绿
 * （实测踩过：红先证据第一遍 I-2 = 绿）。反过来把超时排在完成之前又会变成一场**竞跑**。
 *
 * ⇒ 两条都不走：让完成**先到**（缺省 5 秒上界，事件必然赢），另外**直接断言计时器被要过**
 * （`scheduleCount > 0`）。没有 ticker 时 `waitForIceGathering` 走的是那条
 * "响亮地拒绝"（`'unsupported'`）的早退 ⇒ 计数恒为 0 ⇒ 这条腿**确定性地红**。
 */
function countingTicker(): LobbyTicker & { scheduleCount(): number } {
  let scheduled = 0;
  const t = {
    schedule: (fn: () => void, ms: number): number => {
      scheduled += 1;
      return setTimeout(fn, ms) as unknown as number;
    },
    cancel: (h: number): void => { clearTimeout(h as unknown as ReturnType<typeof setTimeout>); },
    scheduleCount: (): number => scheduled,
  };
  return t;
}

/**
 * ★ **真的 `deflate-raw` 压缩 / 解压**（本文件的关键夹具决定之二）。
 *
 * `createInvite` 与 `decompressBase64` 都要一个压缩能力；浏览器里是 `CompressionStream`，
 * **这里用的就是 `globalThis.CompressionStream`**（node 18+ 自带，本仓实测 node v22.22.2
 * 两个构造器都在）—— 与产出代码走的是**同一个**实现，不是"测试专用压缩器"。
 * 为什么不用"恒等压缩"：`createInvite` 里那道自洽检查要求"压出来的必须解得动"，
 * 而恒等函数会让"真解压"与"没解压"逐字同形 —— 那正是 T7 评审 D 抓过的洞。
 */
const zlibEnv: NetBrowserEnv = {
  compressionStream: (mode) => {
    const g = globalThis as unknown as {
      CompressionStream?: new (f: string) => unknown;
      DecompressionStream?: new (f: string) => unknown;
      Blob?: new (parts: readonly Uint8Array[]) => { stream(): unknown };
      Response?: new (body: unknown) => { arrayBuffer(): Promise<ArrayBuffer> };
    };
    const Ctor = mode === 'compress' ? g.CompressionStream : g.DecompressionStream;
    const BlobCtor = g.Blob;
    const ResponseCtor = g.Response;
    if (Ctor === undefined || BlobCtor === undefined || ResponseCtor === undefined) return null;
    return {
      run: async (input: Uint8Array): Promise<Uint8Array> => {
        const stream = new Ctor('deflate-raw');
        const piped = (new BlobCtor([input]).stream() as { pipeThrough(s: unknown): unknown }).pipeThrough(stream);
        return new Uint8Array(await new ResponseCtor(piped).arrayBuffer());
      },
    };
  },
};

/* ==================================================================== *
 * 夹具 2：两条**互相对接**的假对端连接
 * ==================================================================== */

interface WireChannel {
  readonly label: string;
  readonly readyState: string;
  send(text: string): void;
  close(): void;
  addEventListener(type: string, cb: (ev: unknown) => void): void;
}

/** 一侧的接线图：channel 名 → "投递给本侧监听者"的那个动作 */
type WireMap = Map<string, (text: string) => void>;

/**
 * ★ **D26 的桥**（两侧共用一份）：加入方不再 `createDataChannel`，改为在 `datachannel` 事件里
 * **认领**。假件必须能演那件事，否则端到端腿会变成"什么都没建、也没人认领"（不是产品的形状）。
 *  - 出 offer 方建通道时 `notify(label)`；
 *  - 认领方把自己的认领函数 `register` 进来（建得比认领先，所以是真事件）；
 *  - `mark`/`bothCreated` 是**两条流**那条现实：两侧都建同一个 label ⇒ 谁都没收到。
 */
interface WireBridge {
  notify(label: string): void;
  register(f: (label: string) => void): void;
  mark(role: 'host' | 'guest', label: string): void;
  bothCreated(label: string): boolean;
}

/**
 * 把 `makeFakePc` 的结果改造成"能真的收发帧"的假连接。
 *
 * ## 为什么必须改造
 *
 * `makeFakePc` 的 `createDataChannel` 交出的是一根**哑**通道（`send: () => {}`）⇒ 真传输
 * 发出去的每一帧都会掉在地上，两端永远握手不上。那是夹具的缺陷，不是被测对象的 ——
 * 但如果不接上，"邀请码那条路通不通"就**没有可观测的后果**，腿会退化成恒真的形状检查。
 *
 * ## 接法
 *
 * 每一侧每建一个 channel 就登记进**本侧**的图；`send(text)` 直接调**对端**那条同名 channel
 * 的监听者。真 WebRTC 的投递是异步的，这里同步是为了让腿**确定**（没有"等多久算投递到了"）。
 *
 * ## 时序也要像真的
 *
 * `makeFakePc` 缺省 `iceGatheringState: 'complete'`（一开始就收集完了）—— 那会让
 * `waitForIceGathering` **同步早退**，"env 里有没有 ticker"根本不参与 ⇒ I-2 假绿。
 * 这里把**房主**那侧设成 `'gathering'`，收集完成由一个真计时器（0 ms）触发，
 * 与 B2 注释里那句"`setLocalDescription` 之后 ICE 收集才刚开始"同形。
 */
function wireChannels(
  pc: Record<string, unknown>,
  gatheringAtStart: string,
  fake: ReturnType<typeof makeFakePc>['fake'],
  mine: WireMap,
  theirs: WireMap,
  /** 本侧**发出去**的每一帧（记账：看哪几条消息真的上过线） */
  onSend: (text: string) => void,
  /**
   * ★ **D26 的桥**：加入方不再 `createDataChannel`，改为在 `datachannel` 事件里**认领**。
   * 假件必须能演那件事，否则这条端到端腿会变成"什么都没建、也没人认领"（不是产品的形状）。
   *  - 出 offer 方建通道时 `notify(label)`；
   *  - 认领方把自己的认领函数 `register` 进来（建得比认领先，所以是真事件）。
   */
  bridge: WireBridge,
  role: 'host' | 'guest',
): {
  /**
   * ★ J-2 的夹具动作：把这条假连接的"接上了"报出来（见 `Side.markConnected` 的说明）。
   *
   * 假件缺省 `connectionState: 'new'`、而且它**不会**主动报 `connected` ⇒ 真传输的 `status`
   * 永远停在 `connecting`。J-2 之后那条 `hello` 要等这个状态 ⇒ 这里补上真 WebRTC 会报的那两个
   * 事件（真传输对 `connectionstatechange` 与 `iceconnectionstatechange` 都挂了监听器）。
   */
  readonly markConnected: () => void;
} {
  // 假件自己的监听器表（`makeFakePc` 内部的 `listeners`）：真传输通过 `addEventListener` 挂进来，
  // 这里把两个连接状态事件都补报一次（`fake` 只暴露了 ICE 收集那一个）。
  const statusListeners = new Map<string, Array<(ev: unknown) => void>>();
  const origAdd = pc.addEventListener as ((type: string, cb: (ev: unknown) => void) => void);
  pc.addEventListener = (type: string, cb: (ev: unknown) => void): void => {
    const arr = statusListeners.get(type) ?? [];
    arr.push(cb);
    statusListeners.set(type, arr);
    origAdd(type, cb);
  };
  /** 造一条"本侧视图"的通道（出 offer 方建的那条、与认领方认领的那条共用这一份形状） */
  const makeView = (label: string): WireChannel => {
    const listeners: Array<(ev: unknown) => void> = [];
    mine.set(label, (text: string) => { for (const cb of listeners) cb({ data: text }); });
    return {
      label,
      readyState: 'open',
      send: (text: string) => {
        onSend(text);
        /**
         * ★★ **两条流的现实**（D26 的判别力就在这里）：若**两侧都 `createDataChannel`** 了同一个
         * label，真 WebRTC 里那是**两条不同的 SCTP 流**，本侧发出去的帧落在**对端建的那条**上，
         * 而应用把 `message` 监听挂在**自己建的那条**上 ⇒ **谁都没收到**。
         * 夹具必须照这个来，否则"加入方也建通道"那个回退在腿里**照样绿**（实测踩过）。
         */
        if (bridge.bothCreated(label)) return;
        const dest = theirs.get(label);
        if (dest === undefined) return; // 对端还没认领这条通道 ⇒ 丢掉（真 WebRTC 也会丢）
        dest(text);
      },
      close: () => {},
      addEventListener: (type: string, cb: (ev: unknown) => void) => {
        if (type === 'message') listeners.push(cb);
      },
    };
  };
  pc.createDataChannel = (label: string): WireChannel => {
    const view = makeView(label);
    bridge.mark(role, label);
    // 出 offer 方建完就通知认领方（真 WebRTC 的 `datachannel` 事件就是这个时机）
    bridge.notify(label);
    return view;
  };
  if (role === 'guest') {
    /**
     * 认领方的动作：把桥上的通知转成一次 `datachannel` 事件（带上"对端那条"的视图）。
     *
     * ⚠️ 时序（腿里必须摆对）：房主 `connect('first')` 时就建了通道，而加入方要到**它自己**
     * `connect('first')` 时才挂 `datachannel` 监听 ⇒ 监听还没挂上时的通知先**攒着**，
     * 等真传输挂上监听那一刻**补投**（真 WebRTC 的时序也是这样：事件在连接建立之后到）。
     */
    const adoptQueue: string[] = [];
    const emitAdopt = (label: string): void => {
      const cbs = statusListeners.get('datachannel') ?? [];
      if (cbs.length === 0) { adoptQueue.push(label); return; }
      for (const cb of cbs) cb({ channel: makeView(label) });
    };
    bridge.register(emitAdopt);
    const addBefore = pc.addEventListener as ((type: string, cb: (ev: unknown) => void) => void);
    pc.addEventListener = (type: string, cb: (ev: unknown) => void): void => {
      addBefore(type, cb);
      if (type === 'datachannel' && adoptQueue.length > 0) {
        for (const label of adoptQueue.splice(0, adoptQueue.length)) cb({ channel: makeView(label) });
      }
    };
  }
  const origSetLocal = pc.setLocalDescription as (d: { type: string; sdp?: string }) => Promise<void>;
  pc.setLocalDescription = async (desc: { type: string; sdp?: string }): Promise<void> => {
    await origSetLocal(desc);
    // ★ 收集完成排在 **0 ms**（收集一开始就完成）；上界走缺省的 `DEFAULT_ICE_GATHER_TIMEOUT_MS`
    //   （T8-E 之后是 15 秒）⇒ 事件必然先到，腿里没有竞跑。
    if (gatheringAtStart === 'gathering') setTimeout(() => { fake.setGatheringComplete(); }, 0);
  };
  return {
    markConnected: (): void => {
      pc.connectionState = 'connected';
      pc.iceConnectionState = 'connected';
      for (const type of ['connectionstatechange', 'iceconnectionstatechange'] as const) {
        for (const cb of statusListeners.get(type) ?? []) cb({});
      }
    },
  };
}

/* ==================================================================== *
 * 夹具 3：两端的大厅客户端（照 `src/main.ts` 的接线写，能力换成假件）
 * ==================================================================== */

interface Side {
  /** 本侧的大厅客户端（建好之后就地填进来：`buildAnswer` 里要用它回头取传输） */
  client: LobbyClient;
  /** 本侧"造出来的那一条对端连接"（`onPeerConnection` 的回执落点，照 `main.ts` 的单槽位） */
  pc: Record<string, unknown> | null;
  /** 本侧假连接的记账口 */
  readonly fake: ReturnType<typeof makeFakePc>['fake'];
  /** 本侧**发出去**的每一帧原文（记账：看哪几条消息真的上过线） */
  readonly sent: string[];
  /** `onPeerConnection` 被叫了几次（反空转：只该有一次） */
  n: number;
  /** 本侧的计时器（I-2 的判别力：`waitForIceGathering` 到底有没有去要上界） */
  readonly ticker: LobbyTicker & { scheduleCount(): number };
  /**
   * ★ **J-2 之后新增的夹具动作：把这条假连接的"接上了"事件补上**。
   *
   * 为什么非要显式补：假件缺省 `connectionState: 'new'`（见 `makeSide`），它**永远不报**
   * `connected` ⇒ 真传输的 `status` 停在 `connecting`。J-2 之前没人看这个状态（那条 `hello`
   * 是"发了就算发过"），J-2 之后它决定那条 `hello` 什么时候真的上线 ⇒ 不补这一下，
   * 这条端到端腿问的就从"邀请码那条路通不通"悄悄变成"假件有没有报 connected"。
   *
   * 它模拟的是真 WebRTC 的 `connectionstatechange` —— 两端各自的传输据此转 `online`。
   */
  markConnected(): void;
}
/**
 * 造一侧。
 *
 * ⚠️ `env` 是**本文件里照 `main.ts` 的 `lobbyEnv()` 写的那份**：`settings` + `ticker` +
 * `onPeerConnection`。D 轮 I-1 / I-2 的修法就是把后两样挪进 `main.ts` 的 `lobbyEnv()` ——
 * 这条腿能红能绿，靠的正是"这份 env 里有没有那两样"。
 */
function makeSide(
  role: 'host' | 'guest',
  env: NetBrowserEnv,
  mine: WireMap,
  theirs: WireMap,
  /** ★ D26 的桥（见 `wireChannels`）：出 offer 方建通道时通知认领方 */
  bridge: WireBridge,
): Side {
  // ★ I-2 的**判别力**靠这一格：`'gathering'` 起步 ⇒ 第一次调用一定会去问
  //   "等多久算超时"（`resolved.ticker`）——`'complete'` 起步会**同步早退**，那条问题根本不问。
  const { pc, fake } = makeFakePc({ iceGatheringState: role === 'host' ? 'gathering' : 'complete' });
  const p = pc as Record<string, unknown>;
  p.connectionState = 'new';
  p.iceConnectionState = 'new';
  const side: Side = {
    client: null as unknown as LobbyClient,
    pc: null,
    fake,
    sent: [],
    n: 0,
    ticker: countingTicker(),
    markConnected: () => {},
  };
  const wires = wireChannels(
    pc,
    role === 'host' ? 'gathering' : 'complete',
    fake,
    mine,
    theirs,
    (text) => { side.sent.push(text); },
    bridge,
    role,
  );
  // ★ J-2 的夹具动作（见 `Side.markConnected` 的说明）：把假件缺省不报的那个"接上了"补上。
  side.markConnected = (): void => { wires.markConnected(); };

  /** 本侧**自报**的会话号（真实调用方各自 `newSessionId()`；加入方建会话时会改用邀请码里那一串） */
  const ownSessionId = role === 'host' ? 'sid-host-real' : 'sid-guest-real';
  /**
   * ★★ **本侧的观察口挂在 `env.onPeerConnection` 上，不自己另注一个**（否则 I-1 假绿）。
   *
   * 第一版这里写的是 `onPeerConnection: (conn) => { side.pc = conn; ... }` —— 那是
   * **测试自己把结果塞给自己**：把 `main.ts` 那份 env 里的 `onPeerConnection` 撤掉之后，
   * `side.pc` 照样有值（因为这一句还在），腿**照绿**。实测踩过（D 轮红先证据第一遍 I-1 = 绿）。
   * 现在 `side.pc` / `side.n` 只在**宿主回调真的被叫**时才有值 ⇒ 那条腿问的才是
   * "这份 env 有没有被真传输用上"。
   */
  const hostEnv: NetBrowserEnv = {
    ...env,
    ...zlibEnv,
    /**
     * ★★ **这一个 `ticker` 就是"env 里有没有 ticker"那句话里的那个**（I-2 的判别力）。
     *
     * 它同时是①`createBrowserTransport(hostEnv)` 里 `waitForIceGathering` 会去要的那个，
     * ②腿里 `scheduleCount()` 断言的那个 ⇒ "等 ICE 真的问过上界"变成可观测的事实，
     * 而不是"跑通了所以大概有"。
     */
    ticker: side.ticker,
    peerConnection: () => pc as never,
    onPeerConnection: (conn) => {
      side.n += 1;
      side.pc = conn as unknown as Record<string, unknown>;
      env.onPeerConnection?.(conn);
    },
  };
  /**
   * ⚠️ 给 `acceptOffer` / `decompressBytes` 的那一份**不要**带 `onPeerConnection`：
   * 真 `main.ts` 里那两个能力也走同一份 env，但收方产 answer 走的是 `peerConnectionOf`
   * （C 轮那条登记表），不是这个回执 —— 混在一起会让 `side.n` 的计数被第二个调用点污染。
   */
  const { onPeerConnection: _hostHook, ...capabilities } = hostEnv;
  const capsEnv: NetBrowserEnv = capabilities;
  side.client = createLobbyClient({
    role,
    // ★ 两端的 `sessionId` **故意不同**（I-3：真实调用方就是各自 `newSessionId()`）
    sessionId: ownSessionId,
    localProtoVersion: PROTO_VERSION,
    localCardDataHash: CARD_DATA_HASH,
    hash: browserHash(),
    // ★ 本侧那个**记账**计时器：`ticker.scheduleCount() > 0` 就是"等 ICE 时真的要过上界"
    ticker: side.ticker,
    createTransport: () => createBrowserTransport(hostEnv),
    signalingEndpoint: '',
    readSettings: () => ({ turnUrl: '', turnUsername: '', turnCredential: '' }),
    buildInvite: async (draft) => {
      const r = await createInvite({ ...draft }, hostEnv);
      return r.ok ? { ok: true, payload: r.payload, link: r.link } : { ok: false, message: r.message };
    },
    decompressBase64: async (b64: string) => {
      const { decodeBase64Url, decompressBytes } = await import('../../src/ui/net-browser');
      const raw = decodeBase64Url(b64);
      if (raw === null) return null;
      const d = await decompressBytes(raw, capsEnv);
      return d.ok ? d.bytes : null;
    },
    // ★ B3 的两半（收方产 answer / 房主把 answer 喂回**同一条**连接）—— 与 `main.ts` 同形
    buildAnswer: async (offer) => {
      const tr = side.client.transport();
      const conn = tr === null ? null : peerConnectionOf(tr);
      if (conn === null) return { ok: false, message: '本侧还没有承载消息的那条连接。' };
      const r = await acceptOffer(conn, { sdp: offer.sdp }, capsEnv);
      if (!r.ok) return { ok: false, message: r.message };
      const fields = answerPayloadFields({
        protoVersion: PROTO_VERSION,
        // ★ I-3 甲：回示码也带上这一局的会话号（照抄房主那一串）
        sessionId: ownSessionId,
        sdp: r.sdp,
        ice: r.ice,
      });
      const enc = await createInvite({ ...fields, originAndPath: 'https://example.test/compile/' }, capsEnv);
      return enc.ok ? { ok: true, code: enc.payload } : { ok: false, message: enc.message };
    },
    applyAnswer: async (answer) => {
      const conn = side.pc;
      if (conn === null) return { ok: false, message: '本侧还没有那条承载消息的连接。' };
      const r = await applyAnswer(conn as never, { sdp: answer.sdp });
      return r.ok ? { ok: true } : { ok: false, message: r.message };
    },
    readAddressBar: () => null,
    localNick: () => (role === 'host' ? '房主' : '加入方'),
    onInbound: () => { side.client.drive(); },
  });
  return side;
}

/** 造两端（各自一张接线图，互指） */
function makeBothSides(): { host: Side; guest: Side } {
  const hostWires: WireMap = new Map();
  const guestWires: WireMap = new Map();
  /**
   * ★ **D26 的桥**：出 offer 方（房主）建通道时 `notify(label)`；认领方（加入方）
   * 在 `init` 里 `register` 自己的认领函数。房主建得**晚**（`connect('first')` 时），
   * 所以这是"真事件"而不是"建好再补"。
   */
  const adopters: Array<(label: string) => void> = [];
  const pendingAdopt: string[] = [];
  /** ★ 每条 label 被哪几侧 `createDataChannel` 过（两侧都建 ⇒ 两条流，见 `makeView` 的 `send`） */
  const createdBy = new Map<string, Set<'host' | 'guest'>>();
  const bridge = {
    notify: (label: string): void => {
      // ⚠️ 真 WebRTC 里 `datachannel` 事件是在**连接建立之后**才到认领方的；腿里的顺序是
      //    房主先 `connect('first')`（那一刻建通道）、加入方后 `connect('first')`（那一刻挂
      //    `datachannel` 监听）⇒ 没人在场时先攒着，等认领方一注册再补投（否则腿会假红）。
      if (adopters.length === 0) { pendingAdopt.push(label); return; }
      for (const f of adopters) f(label);
    },
    register: (f: (label: string) => void): void => {
      adopters.push(f);
      for (const label of pendingAdopt.splice(0, pendingAdopt.length)) f(label);
    },
    mark: (role: 'host' | 'guest', label: string): void => {
      const set = createdBy.get(label) ?? new Set<'host' | 'guest'>();
      set.add(role);
      createdBy.set(label, set);
    },
    bothCreated: (label: string): boolean => (createdBy.get(label)?.size ?? 0) > 1,
  };
  /** ★ 这份 env 就是 `main.ts` 那份 `lobbyEnv()` 的形状（I-1 / I-2 的落点） */
  const env: NetBrowserEnv = {
    settings: () => ({ turnUrl: '', turnUsername: '', turnCredential: '' }),
    onPeerConnection: () => {},
  };
  return {
    host: makeSide('host', env, hostWires, guestWires, bridge),
    guest: makeSide('guest', env, guestWires, hostWires, bridge),
  };
}

/** 让事件循环转一圈（真计时器那条"ICE 收集完成"要它） */
const tick = (): Promise<void> => new Promise((r) => { setTimeout(r, 1); });

/**
 * ★★ **腿 2：房主那份 env 里"没有 ticker"时，取连接描述这条路仍然通**（I-2 的另一半）。
 *
 * ## 它问的是哪一件事
 *
 * `createBrowserTransport(env)` 内部排那个 `waitForIceGathering` 时，**必须用它与缺省环境
 * 合并之后的 `resolved`**（那里有宿主给的能力），而不是**原始的** `env`。
 * 用原始 `env` 的后果只有一个：**宿主给的能力这一句看不见** ⇒ 拿不到上界 ⇒ 响亮地拒绝
 * （`'unsupported'`）。而"宿主的 env 里可能没有 ticker"正是这一层的常态：
 * 计时是本仓一律注入的能力，**传不传是调用方的事**，而等 ICE 的上界是这一层自己的职责。
 *
 * ## 为什么它必须与腿 1 分开
 *
 * 腿 1 的 env 里**有** ticker（房主那条路要它），所以把上面那句改回传 `env` 时腿 1 **照绿**
 * （实测踩过）。这条腿的 env 里**故意不给 ticker**：
 *  - 修好之后（传 `resolved`）：`resolved` 里那个 ticker 仍然是 `undefined`（缺省环境本来就没有）
 *    ⇒ 但**收集已经完成**（假件一开始就是 `'complete'`）⇒ 走"同步取描述"那一支 ⇒ 成功；
 *  - 回退之后（传原始 `env`）：同样会先撞上 `'complete'` 那一支 ⇒ **也成功**。
 *
 * ⚠️ 所以第二条**证明不了 I-2**（这一条是如实登记的缺口）：`waitForIceGathering` 有两处入口，
 * 而两处都会先合并缺省环境；`'complete'` 那一支在**两种写法下都同步早退**，
 * 真正的差别只在 `'gathering'` 那一支，而那一支没有 ticker 时**两条写法都不给上界**
 * （缺省环境没有 ticker 这个能力）⇒ 在 node 里不可观测。
 */
describe('★ D 轮：env 缺 ticker 时"取连接描述"这条路', () => {
  it('收集**还没完成**时也能等到它完成：上界由这一层自己解决，不向调用方要计时能力', async () => {
    const wires: WireMap = new Map();
    const peerWires: WireMap = new Map();
    // ★★ 关键：`'gathering'` 起步。"收集已经完成"那一支会**同步早退**，
    //    两种写法（传 env / 传 resolved）在那里逐字同形 ⇒ 那条路验不出 I-2（实测踩过）。
    const { pc, fake } = makeFakePc({ iceGatheringState: 'gathering' });
    (pc as Record<string, unknown>).connectionState = 'new';
    (pc as Record<string, unknown>).iceConnectionState = 'new';
    // 这条腿只关心"等 ICE 的上界"，没有对端 ⇒ 桥上没人认领（`notify` 是空操作）
    wireChannels(pc, 'gathering', fake, wires, peerWires, () => {},
      { notify: () => {}, register: () => {}, mark: () => {}, bothCreated: () => false }, 'host');
    /**
     * ★ 故意**不给** `ticker`：计时是本仓"一律注入"的能力，而"等 ICE 的上界"是这一层
     * （`net-browser.ts`）自己的职责 —— 传不传计时能力是调用方的事，不该因此把这条路关掉。
     *
     * ## 这条腿为什么能分开两种写法（判别力在这里）
     *
     * `waitForIceGathering` 合并的环境是**它拿到的那个入参**与缺省环境的合并：
     *  - 修好之后（`createBrowserTransport` 传 `resolved`）：合并结果里**有** ticker
     *    （`resolved` 是本函数从 `env` 与缺省环境合出来的，那个 ticker 就是这里给的
     *    `injectedTicker`）⇒ 排得下上界 ⇒ 收集完成（5 ms）时成功拿到描述；
     *  - 回退之后（传原始 `env`）：合并结果里 ticker 仍是 `undefined`（缺省环境没有这个能力）
     *    ⇒ **响亮地拒绝**（`'unsupported'`）⇒ 当场红。
     */
    /**
     * ★ **这里给 `ticker`，而且这个决定是被实测逼出来的**（记一笔，别下一轮又改回去）：
     *
     * 这份 env 是"宿主交给 `createBrowserTransport` 的整份环境"。`waitForIceGathering` 在
     * 拿不到 ticker 时是**响亮地拒绝**（`'unsupported'`，不是静默降级）——缺省环境里没有 ticker
     * （那是注入能力），所以**只**把这一句改成传 `resolved` 而宿主不给 ticker 时，它**照样拒绝**
     * （实测：报"这台设备没有可用的计时能力"）。也就是说这条链上两处**缺一不可**：
     * ① 宿主把计时能力注进这份 env（`main.ts`）；② 这一句把合并结果传下去（`net-browser.ts`）。
     * 所以给了 ticker 之后，这条腿红/绿就**只**取决于 ② —— 那正是它要验的那一处。
     */
    const injectedTicker: LobbyTicker = {
      schedule: (fn, ms) => setTimeout(fn, ms) as unknown as number,
      cancel: (h) => { clearTimeout(h as unknown as ReturnType<typeof setTimeout>); },
    };
    const noTickerEnv: NetBrowserEnv = {
      settings: () => ({ turnUrl: '', turnUsername: '', turnCredential: '' }),
      peerConnection: () => pc as never,
      ticker: injectedTicker,
    };
    // 先把"收集完成"排在 5 ms 之后（真计时器）：模拟"`setLocalDescription` 之后 ICE 才刚开始"
    setTimeout(() => { fake.setGatheringComplete(); }, 5);
    const tr = createBrowserTransport(noTickerEnv);
    const started = await tr.init({ selfId: 'sid-x', peerId: 'peer' });
    expect(started.ok, `传输出不来：${started.ok ? '' : started.message}`).toBe(true);
    const desc = await tr.localDescription?.();
    expect(
      desc?.ok,
      `收集还没完成时取不到描述（I-2：这一句用的是**原始** env 而不是合并后的 resolved，`
      + `于是宿主给的能力在这一句里看不见）：${desc !== undefined && desc.ok === false ? desc.message : ''}`,
    ).toBe(true);
  });
});

/** 读一侧的相位（`null` = 还没链路） */
function phaseOf(side: Side): string | null {
  side.client.sync();
  return side.client.state().peer?.phase ?? null;
}

/** 本侧**发出去**的那些消息的类型（"那条消息的驱动者有没有接上"靠它看） */
function kindsOf(side: Side): string {
  return side.sent.map((t) => /"t":"([a-z-]+)"/.exec(t)?.[1] ?? '?').join(' -> ');
}

/* ==================================================================== *
 * 腿 1：邀请码那条路
 * ==================================================================== */

describe('★★ D 轮端到端：邀请码那条路', () => {
  it('房主产得出邀请码 → 加入方吃得下 → 握手走到 awaiting-commit → 回示码喂回同一条连接', async () => {
    const { host, guest } = makeBothSides();

    // ── 房主：接上链路（`init` 里 createOffer）→ 等 ICE 收集 → 取非 trickle 的本侧描述
    await host.client.connect('first');
    // ★ I-1 的落点：真传输在 `init` 里把"刚造出来的那条连接"交给 `env.onPeerConnection`
    expect(host.pc, '房主那格连接还是 null ⇒ env 里没有 onPeerConnection（applyAnswer 会恒失败）').not.toBeNull();
    const hostTr = host.client.transport();
    expect(hostTr, '房主 connect 之后没有传输').not.toBeNull();
    const hostDesc = await hostTr?.localDescription?.();
    /**
     * ★★ **I-2 的判别力**：等 ICE 那一步必须**真的去要过上界**（`ticker.schedule`）。
     *
     * 这条断言把"env 里有没有 ticker"从"结果恰好一样"变成"**过程里看得见**"：
     * `waitForIceGathering` 在拿不到 ticker 时是**响亮地拒绝**（`'unsupported'`，一次 schedule 都不排）
     * ⇒ 没有 ticker 的世界里这个计数恒为 0 ⇒ 腿确定性地红（不依赖谁先到点的竞跑）。
     */
    expect(
      host.ticker.scheduleCount(),
      '等 ICE 时一次上界都没排过（`waitForIceGathering` 没拿到 ticker ⇒ 它走的是 unsupported 那条早退）',
    ).toBeGreaterThan(0);
    expect(
      hostDesc?.ok,
      `房主取不到连接描述（I-2：env 里没有 ticker ⇒ waitForIceGathering 回 unsupported）：${
        hostDesc !== undefined && hostDesc.ok === false ? hostDesc.message : ''
      }`,
    ).toBe(true);
    // ★ 反空转：**非 trickle** 的描述里必须真的带着一条候选（否则"等 ICE"这一步等于没等）
    const offerSdp = hostDesc !== undefined && hostDesc.ok === true ? (hostDesc.sdp ?? '') : '';
    expect(offerSdp, '房主取到的连接描述是空串').toContain('a=candidate:');

    await host.client.startHost({
      p: PROTO_VERSION,
      originAndPath: 'https://example.test/compile/',
      // ★ 邀请码里带上**房主这一局**的会话号（`startHost` 的入参里就有它）
      sessionId: host.client.state().sessionId,
      sdp: offerSdp,
      ice: [],
      hostPromise: 'host-promise',
      guestPromise: 'guest-promise',
    });
    const invite = host.client.state().invite;
    expect(invite?.ok, `房主没有产出邀请码：${invite !== null && invite.ok === false ? invite.message : ''}`).toBe(true);
    const payload = invite?.ok === true ? invite.payload : '';
    expect(payload.length, '邀请码是空的').toBeGreaterThan(0);

    // ── 加入方：吃下邀请码 → 接上链路（第一条 `hello` 立刻发出去）
    await guest.client.joinWithInvite(payload);
    expect(guest.client.state().joined?.ok, '加入方没有收下这条邀请码').toBe(true);
    await guest.client.connect('first');
    /**
     * ★ **J-2 之后新增的夹具动作**：真 WebRTC 会在对端接上时把 `connectionstatechange` 报成
     * `connected`，假件缺省不报（`makeSide` 把它设成 `'new'` 就再也没动过）⇒ 两端传输都停在
     * `connecting`。J-2 之后"那条 `hello` 什么时候真的上线"由这个状态决定 ⇒ 补报这一下，
     * 这条腿才还是在问"邀请码那条路通不通"，而不是"假件有没有报 connected"。
     */
    host.markConnected();
    guest.markConnected();
    await tick();
    // 房主那一侧收到 hello 之后 `onInbound` 会把相位驱动一次。
    // 再交替驱动几轮：投递是**同步**的（假通道直接调对端监听者），所以每一轮都能推进一步。
    for (let round = 0; round < 20; round += 1) {
      host.client.drive();
      guest.client.drive();
      if (phaseOf(host) === 'complete' && phaseOf(guest) === 'complete') break;
    }

    // ★★ 本腿的判据：**邀请码那条路真的把两端接上了**
    //
    // 为什么不断言"停在 awaiting-commit"：C 轮接上驱动者（`onInbound` 里 `drive()`）之后，
    // 一帧到了就会按相位往下推 ⇒ 两端会一路走到 `complete`。把断言钉在 `awaiting-commit`
    // 上等于要求"驱动者别工作"，那是把一条已经修好的行为重新钉死。
    // 真正要证的三件事：① 两端**都在 `awaiting-commit` 之后**（说明 hello 被房主接受了）；
    // ② 两端相位**相同**（说明用的是同一个会话号）；③ 加入方的承诺校验结论是 `true`
    // （N-9 的代价：判"这一局好不好"只能看它，不能看相位）。
    const h = phaseOf(host);
    const g = phaseOf(guest);
    expect(g, `加入方的相位是 ${String(g)}（它停在 handshaking ⇒ 房主没接受它的 hello）。线上消息：${kindsOf(guest)}`).not.toBe('handshaking');
    expect(h, `房主的相位是 ${String(h)}（握手没完成 ⇒ 它拒了加入方的 hello）。线上消息：${kindsOf(host)}`).not.toBe('handshaking');
    expect(h, `两端相位不一样：房主 ${String(h)} / 加入方 ${String(g)}（各自用了不同的会话号）`).toBe(g);
    expect(
      guest.client.commitmentVerified(),
      '加入方的承诺校验结论不是 true（承诺-揭示流程没走完）',
    ).toBe(true);

    // ── 第二半：回示码喂回**同一条**连接（I-1 的直接后果）
    expect(await guest.client.makeAnswer(), '加入方产不出回示码').toBe(true);
    const code = guest.client.state().answerCode;
    expect(code, '加入方没有产出回示码').not.toBeNull();
    expect(
      await host.client.submitAnswerCode(code ?? ''),
      '房主吃不下回示码（hostPeerConnection 是 null ⇒ I-1）',
    ).toBe(true);
    expect(
      host.client.state().answerApplied?.ok,
      `房主吃回示码的结论：${JSON.stringify(host.client.state().answerApplied)}`,
    ).toBe(true);
    // ★ 反空转（三重）：answer 真的被喂进**房主那条**连接
    //
    // ① 传输内部登记的那条连接、`env.onPeerConnection` 收到的那条、假件的记账对象
    //    指向的是**同一个**对象（"喂的是同一份 offer/answer 协商"这件事靠它）；
    // ② 那次 `setRemoteDescription` 真的发生了；
    // ③ 喂进去的类型是 `answer`（不是把 offer 又喂了一遍）。
    const hostTrAfter = host.client.transport();
    expect(hostTrAfter, '房主 connect 之后没有传输').not.toBeNull();
    const registered = hostTrAfter === null ? null : peerConnectionOf(hostTrAfter);
    expect(registered, '传输内部登记的那条连接与 env 回执那条不是同一条').toBe(host.pc as never);
    // ★ 反空转：房主那条连接**只被造过一次**（造了第二条的话，answer 会喂到另一条上）
    expect(host.n, '`onPeerConnection` 被叫了不止一次（造了第二条连接）').toBe(1);
    // ⚠️ 记账口用 `fake.remoteSeen`（与 `tests/ui/net-lobby.test.ts` 的 B1 腿同一个口径）
    const seen = host.fake.remoteSeen;
    expect(seen.length, '房主那条连接上一次 setRemoteDescription 都没发生').toBeGreaterThan(0);
    expect(seen[0]?.type, '喂进房主那条连接的不是一条 answer').toBe('answer');
  });
});
