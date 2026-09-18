/**
 * G5/T8 修复轮 B1/B2 的**假 peer connection**（判据腿与探针**共用这一份**）。
 *
 * ## 为什么它是一个假件而不是"跑不了"
 *
 * 协调者的判定：`net-browser.ts` 那条 offer/answer 路径住在**注入接口** `PeerConnectionLike`
 * 后面 ⇒ **序列**可以在 node 里逐格验，就像整条消息路由已经在假传输上验过一样。
 * "真 `RTCPeerConnection` 跑不起来"只等于"假件还没写"。
 *
 * ## 它为什么住在 `tests/ui/`（而不是 `.superpowers/g5-T8/`）
 *
 * 探针（`.superpowers/g5-T8/probes/`）与判据腿（`tests/ui/net-lobby.test.ts`）**都要用它**，
 * 而"临时件只放 `.superpowers/`"那条约束管的是**证据与临时产物**；一个**被两处 import 的
 * 测试夹具**放 `tests/ui/` 才是本仓的既有形状（对照 `tests/ui/net-dom-stub.ts`：同理，
 * 它是"远程页的最小 DOM 桩"，被多个测试文件共用）。
 * ⚠️ 它是 `*.ts`、**不是** `*.test.ts` ⇒ vitest 不会把它当测试收集（`vite.config.ts` 的 include）。
 * 探针侧的说明符是 `'../../tests/ui/fake-peer-connection'`（**恰好一层**，合纪律）。
 *
 * ## 这个假件能证明什么、不能证明什么（**写在文件头，别让读者高估**）
 *
 *  - ✅ **能**：调用序列（谁先谁后）、参数（喂进去的是不是那份 offer/answer）、
 *    等 ICE 的上界（状态永不 `complete` ⇒ 走超时且**不挂**）、取到的是不是 `localDescription`。
 *  - ❌ **不能**：真 SDP 的格式与协商结果、ICE 候选的真实可达性、NAT 穿透、真实的失败原因。
 *    那些由 **T9 的 CDP 真浏览器场景**覆盖。
 */

/** 一次调用的记账（顺序即数组顺序） */
export interface PcCall {
  readonly op: string;
  readonly detail?: string;
}

export interface FakePcScript {
  /** 本侧描述（`getLocalDescription` 或最终 `localDescription` 返回它） */
  readonly localSdp?: string;
  /** `createAnswer()` 返回的描述 */
  readonly answerSdp?: string;
  /**
   * ICE 收集状态。
   *  - `'complete'`：一开始就收集完了（`waitForIceGathering` 同步成功）；
   *  - `'gathering'`：**永不完成**（用来验上界 —— 假件不主动回调 `icegatheringstatechange`）。
   */
  readonly iceGatheringState?: string;
  /** 让 `setRemoteDescription` 抛错（验失败处置） */
  readonly failSetRemote?: boolean;
  /** 让 `createAnswer` 抛错 */
  readonly failAnswer?: boolean;
  /** 让 `createAnswer` **不存在**（验 `unsupported` 那条响亮的路） */
  readonly noCreateAnswer?: boolean;
  /** 让 `setRemoteDescription` **不存在** */
  readonly noSetRemote?: boolean;
}

export interface FakePc {
  readonly calls: PcCall[];
  readonly remoteSeen: { type: string; sdp?: string }[];
  /** 触发一次 `icegatheringstatechange` 用的（测试自己调；假件**不会**自动触发） */
  finishGathering(): void;
  /** 把当前状态改成 `complete` 并触发回调 */
  setGatheringComplete(): void;
}

/** 造一个假 `RTCPeerConnection`（结构面照 `PeerConnectionLike`，多出来的记账只在测试侧） */
export function makeFakePc(script: FakePcScript = {}): { pc: Record<string, unknown>; fake: FakePc } {
  const calls: PcCall[] = [];
  const remoteSeen: { type: string; sdp?: string }[] = [];
  const listeners = new Map<string, Array<(ev: unknown) => void>>();
  const localSdp = script.localSdp ?? 'v=0\r\na=candidate:1 1 udp 1 127.0.0.1 5000 typ host\r\n';
  let gathering = script.iceGatheringState ?? 'complete';
  let localDesc: { sdp: string; type: string } | null = {
    sdp: localSdp,
    type: 'offer',
  };

  const pc: Record<string, unknown> = {
    get iceGatheringState(): string { return gathering; },
    get localDescription(): { sdp: string; type: string } | null { return localDesc; },
    createDataChannel: (label: string) => {
      calls.push({ op: 'createDataChannel', detail: label });
      return { label, readyState: 'open', send: () => {}, close: () => {}, addEventListener: () => {} };
    },
    createOffer: async () => {
      calls.push({ op: 'createOffer' });
      return { type: 'offer', sdp: localSdp };
    },
    setLocalDescription: async (desc: { type: string; sdp?: string }) => {
      calls.push({ op: 'setLocalDescription', detail: desc.type });
      localDesc = { sdp: desc.sdp ?? localSdp, type: desc.type };
    },
    addEventListener: (type: string, cb: (ev: unknown) => void) => {
      const arr = listeners.get(type) ?? [];
      arr.push(cb);
      listeners.set(type, arr);
    },
    restartIce: () => { calls.push({ op: 'restartIce' }); },
    close: () => { calls.push({ op: 'close' }); },
  };
  if (script.noSetRemote !== true) {
    pc.setRemoteDescription = async (desc: { type: string; sdp?: string }) => {
      calls.push({ op: 'setRemoteDescription', detail: desc.type });
      if (script.failSetRemote === true) throw new Error('假件：setRemoteDescription 故意失败');
      remoteSeen.push({ type: desc.type, sdp: desc.sdp });
    };
  }
  if (script.noCreateAnswer !== true) {
    pc.createAnswer = async () => {
      calls.push({ op: 'createAnswer' });
      if (script.failAnswer === true) throw new Error('假件：createAnswer 故意失败');
      return { type: 'answer', sdp: script.answerSdp ?? 'v=0\r\na=candidate:9 1 udp 1 10.0.0.9 6000 typ host\r\n' };
    };
  }

  const fake: FakePc = {
    calls,
    remoteSeen,
    finishGathering: () => { for (const cb of listeners.get('icegatheringstatechange') ?? []) cb({}); },
    setGatheringComplete: () => {
      gathering = 'complete';
      for (const cb of listeners.get('icegatheringstatechange') ?? []) cb({});
    },
  };
  return { pc, fake };
}
