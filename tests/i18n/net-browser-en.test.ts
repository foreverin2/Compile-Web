/**
 * ★ 2026-10-02（P3 第五批）：**`src/ui/net-browser.ts` 那 80 条文案的英文帧**。
 *
 * ## 这条腿补的是什么
 *
 * 本轮把这 80 条（压缩能力探测与降级链、信令端点、ICE 收集、`getStats`、offer/answer、
 * 传输层 `send`）从裸中文字面量搬进 `src/i18n/`。搬完之后必须回答一个问题：
 * **英文界面下它们真的会变、而且不是汉字**。屏上摸不到这一步（那些句子全在
 * "设备能力缺失 / 网络失败"的路径上），所以这里用**真产出函数 + 真文案表**在 node 里
 * 把每一条都跑出来读一遍。
 *
 * ## 判据（三条，都不是"恒真"形态）
 *
 *  1. **英文下逐字等于英文表填完占位符的值**（每条路径都真跑一遍产出函数取回来的串）；
 *  2. **英文下零汉字** —— 包括拼出来的人话（`readableCompressionFailureText` /
 *     `describeCandidates` 是多段拼接，不是单键直出）；
 *  3. **切回中文逐字等于中文表**，并且中英**不同值**（否则第 1、2 条在
 *     "英文表恰好等于中文表"上恒真）。
 *
 * ## 这里**不**重复覆盖什么
 *
 * `createInvite` / `decodeInvitePayload` 那几条"压缩段"的话已经在
 * `tests/ui/net-browser.test.ts` 里被逐字钉着（`toContain('调用方指定的档位')` 那一族）；
 * 本文件的判据面是**语言**，不是那些话的内容。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { setLang, t } from '../../src/i18n';
import { ZH } from '../../src/i18n/zh';
import { EN } from '../../src/i18n/en';
import {
  acceptOffer,
  applyAnswer,
  compressBytesWithFallback,
  compressBytesWithFormat,
  createBrowserTransport,
  createSignalingSession,
  decodeInviteFromAddressBar,
  decompressBase64,
  decompressBytes,
  describeCandidates,
  discoverSignalingEndpoint,
  probeCompressionFormat,
  readableCompressionFailureText,
  readCompressionMode,
  readRelayStatsOf,
  relayUnavailableNoteOf,
  signalEndpointOf,
  waitForIceGathering,
  type CompressionStreamLike,
  type CompressionStreamMode,
  type DataChannelLike,
  type PeerConnectionLike,
  type WebSocketLike,
} from '../../src/ui/net-browser';
import { utf8Encode } from '../../src/net/invite';
import type { TransportInit } from '../../src/net/transport';

afterEach(() => { setLang('zh'); });

/* ──────────────────────────────── 夹具 ──────────────────────────────── */

/**
 * 一个**真实**的压缩流（与 `tests/ui/net-browser.test.ts` 的 `realCompression` 同款）：
 * 用 Node 自带的 `CompressionStream` / `DecompressionStream`。用它量出来的才是真 deflate 字节，
 * 而不是假件编出来的数字 —— 本文件要靠它跑通"指定档位可用"那条路。
 */
const realCompression = (mode: CompressionStreamMode = 'compress'): CompressionStreamLike | null => {
  const read = readCompressionMode(mode);
  const Ctor = read.decompress ? globalThis.DecompressionStream : globalThis.CompressionStream;
  if (Ctor === undefined) return null;
  return {
    run: async (input) => {
      const piped = new Blob([input as unknown as BlobPart]).stream().pipeThrough(new Ctor(read.format));
      return new Uint8Array(await new Response(piped).arrayBuffer());
    },
  };
};

/** 一条候选（`id` / `type` / `candidateType` 是 `readRelayStats` 只读的那三个字段） */
const cand = (id: string, type: string): Record<string, unknown> =>
  ({ id, type: 'local-candidate', candidateType: type });

/** 一份可遍历的 `RTCStatsReport` 假件 */
const report = (...entries: Record<string, unknown>[]) => ({
  forEach: (cb: (e: Record<string, unknown>) => void): void => { for (const e of entries) cb(e); },
});

/** 一个假计时器（`waitForIceGathering` 要的 `GatherTicker`）：只记账，不真的跑 */
function fakeTicker(): { t: { schedule(fn: () => void, ms: number): number; cancel(h: number): void }; fire(): void } {
  let next = 1;
  const jobs = new Map<number, () => void>();
  return {
    t: {
      schedule: (fn, _ms) => { const id = next++; jobs.set(id, fn); return id; },
      cancel: (id) => { jobs.delete(id); },
    },
    fire: () => { for (const [id, fn] of [...jobs]) { jobs.delete(id); fn(); } },
  };
}

/** 一个最小的 `PeerConnectionLike`（只填这条腿会走到的那几个成员） */
function pcLike(extra: Partial<PeerConnectionLike> = {}): PeerConnectionLike {
  return {
    createDataChannel: (label: string): DataChannelLike => ({
      label, readyState: 'open', send: () => {}, close: () => {}, addEventListener: () => {},
    }),
    createOffer: async () => ({ type: 'offer', sdp: 'v=0\r\n' }),
    setLocalDescription: async () => {},
    close: () => {},
    addEventListener: () => {},
    ...extra,
  };
}

/**
 * 把一条"产出函数真跑出来的串"与表里的值对上。
 *
 * `key` 必须是**字面量**（`tests/i18n/tables.test.ts` 的缺键腿与占位符腿都只认静态键）。
 *
 * `allowCjk`（**只在一条腿上用，并且写明理由**）：那条串里有一段来自**另一个文件名下**
 * 仍未抽取的中文（`turn-cred.ts` 的 `describeTurnCredentialFailure`，登记在台账 G.2）。
 * 这一轮的判据面是 `net-browser.ts` 自己的字，不该把那条边界判成假红 —— 但要显式写出来，
 * 不能靠"少断言一句"糊过去。
 */
function expectLocalized(
  actual: string,
  key: string,
  params: Readonly<Record<string, string>> = {},
  opts: { readonly allowCjk?: true } = {},
): void {
  setLang('zh');
  const zh = t(key, params);
  setLang('en');
  const en = t(key, params);
  setLang('zh');
  expect(actual, `${key} 的英文产出与英文表不一致：实际=${JSON.stringify(actual)} 英文表=${JSON.stringify(en)}`).toBe(en);
  // `en` 里面**这个键自己的字**是英文：`allowCjk` 只放行"参数带进来的中文"，
  // 做法是把实参值从英文整句里剔掉之后再看还有没有汉字。
  const stripped = Object.values(params).reduce((acc, v) => acc.split(v).join(''), en);
  expect(/[\u3400-\u9fff]/.test(stripped),
    `${key} 的英文值里有汉字（把实参剔掉之后仍有汉字 ⇒ 是键自己的字没翻）：${en}`).toBe(false);
  if (opts.allowCjk !== true) {
    expect(/[\u3400-\u9fff]/.test(en), `${key} 的英文值里有汉字：${en}`).toBe(false);
  }
  expect(zh, `${key} 的中英值一样 ⇒ 上面两条判据恒真`).not.toBe(en);
}

/* ──────────────────────────────── 腿 ──────────────────────────────── */

describe('★ P3 第五批：`net-browser.ts` 那 80 条在英文下的形态', () => {
  it('锚点：判据面真的非空（这些键都在，而且中英真的不同值）', () => {
    const keys = Object.keys(ZH).filter((k) => k.startsWith('net-browser.'));
    expect(keys.length, 'net-browser.* 的键一条都没有 ⇒ 下面每条腿都在空集合上恒真').toBeGreaterThan(60);
    const same = keys.filter((k) => ZH[k] === EN[k]);
    expect(same, `这些键中英同值 ⇒ 与它们有关的腿恒真：${same.join(', ')}`).toEqual([]);
  });

  it('候选清单那句人话：逐段与英文表对齐，且零汉字', () => {
    const ice = [
      'candidate:1 1 udp 1 127.0.0.1 5000 typ host',
      'candidate:2 1 udp 1 127.0.0.1 5001 typ host',
      'candidate:3 1 udp 1 203.0.113.7 6100 typ srflx',
      'candidate:4 1 udp 1 198.51.100.7 6200 typ relay',
      'candidate:5 1 udp 1 198.51.100.9 6400 typ wat',
    ];
    setLang('en');
    const said = describeCandidates(ice);
    // 逐段从表里取（不手抄）：种类名 4 条 + 计数模板
    const want = [
      t('net-browser.candidate.count', { label: t('net-browser.candidate.kind.host'), n: '2' }),
      t('net-browser.candidate.count', { label: t('net-browser.candidate.kind.srflx'), n: '1' }),
      t('net-browser.candidate.count', { label: t('net-browser.candidate.kind.relay'), n: '1' }),
      t('net-browser.candidate.count', { label: t('net-browser.candidate.kind.other'), n: '1' }),
    ].join('、');
    expect(said, `英文下候选清单那句与逐段拼出来的不一致：${said}`).toBe(want);
    expect(/[\u3400-\u9fff]/.test(said), `英文下候选清单里出现汉字：${said}`).toBe(false);
    // 切回中文：逐字等于改动前的原文（这是"抽的时候没改字"的正面证据）
    setLang('zh');
    expect(describeCandidates(ice), '切回中文后那一句与改动前的原文不一致')
      .toBe('本机（host） 2 个、公网映射（srflx） 1 个、中继（relay） 1 个、类型认不出的 1 个');
  });

  it('空清单那句与五种种类名各自与表对齐', () => {
    setLang('en');
    expectLocalized(describeCandidates([]), 'net-browser.candidate.none');
    for (const [type, key] of [
      ['host', 'net-browser.candidate.kind.host'],
      ['srflx', 'net-browser.candidate.kind.srflx'],
      ['prflx', 'net-browser.candidate.kind.prflx'],
      ['relay', 'net-browser.candidate.kind.relay'],
      ['wat', 'net-browser.candidate.kind.other'],
    ] as const) {
      // ① 英文帧：拼出来的那一段逐字等于"英文种类名 + 英文计数模板"
      setLang('en');
      const one = describeCandidates([`candidate:1 1 udp 1 127.0.0.1 5000 typ ${type}`]);
      const enWant = t('net-browser.candidate.count', { label: EN[key], n: '1' });
      setLang('zh');
      expect(one, `typ ${type} 那一格在英文下拼出来的不是"${EN[key]}: 1"：${one}`).toBe(enWant);
      // ② 中文帧：同一格逐字等于"中文种类名 + 中文计数模板"（证明上一条不是在"两表同值"上恒真）
      const zhOne = describeCandidates([`candidate:1 1 udp 1 127.0.0.1 5000 typ ${type}`]);
      expect(zhOne, `typ ${type} 那一格在中文下拼出来的不是"${ZH[key]} 1 个"：${zhOne}`).toBe(
        t('net-browser.candidate.count', { label: ZH[key], n: '1' }));
      expect(one, `typ ${type} 那一格中英同值 ⇒ 这条腿恒真`).not.toBe(zhOne);
    }
  });

  it('`relayUnavailableNoteOf` 那两支在英文下与表一致', () => {
    const withWhy = (): string | null => relayUnavailableNoteOf({
      relayUnavailableReason: 'credential-unavailable',
      relayCredentialFailure: 'timeout',
    } as never);
    // `{why}` 那一段来自 `turn-cred.ts`（它自己也跟着语言走）⇒ 拿中文整句把那段抠出来
    setLang('zh');
    const zhWith = withWhy() ?? '';
    const innerZh = zhWith.slice('这一轮没有中继可用'.length, zhWith.indexOf('，只能试直连'));
    expect(innerZh.length, '夹具失败：从中文整句里抠不出 why 那一段').toBeGreaterThan(0);
    const zhPlain = relayUnavailableNoteOf({ relayUnavailableReason: 'not-configured' } as never) ?? '';
    expect(zhPlain, '不带原因那一支的中文与改动前不一致')
      .toBe('这一轮没有中继可用，只能试直连：同一个局域网里一般能直接连上，跨网络就不一定了。');
    setLang('en');
    const enWith = withWhy() ?? '';
    const enPlain = relayUnavailableNoteOf({ relayUnavailableReason: 'not-configured' } as never) ?? '';
    setLang('zh');
    expectLocalized(enWith, 'net-browser.relay.unavailable-why', { why: innerZh }, { allowCjk: true });
    expectLocalized(enPlain, 'net-browser.relay.unavailable-plain');
    // ⚠️ **如实记一条边界**：`allowCjk` 那一条不是"放宽"，是把**另一个文件名下**仍未抽取的
    // 中文显式点出来 —— `why` 那一段来自 `turn-cred.ts` 的 `describeTurnCredentialFailure`，
    // 它在英文模式下**仍然返回中文**（7 条裸中文，登记在台账 A 表的 `turn-cred.ts` 行）。
    // 所以这一句在英文界面下会夹一段中文；本文件把它钉成**已知项**，而不是假装它是英文。
    setLang('en');
    expect(/[\u3400-\u9fff]/.test(enWith), '`why` 那一段在英文下已经不是中文了 ⇒ 把 allowCjk 删掉、并更新台账').toBe(true);
    setLang('zh');
    expect(/[\u3400-\u9fff]/.test(enPlain), '不带原因那一支英文下不该有汉字').toBe(false);
  });

  it('压缩失败那三段人话（探测没结果 / 三档全废 / 部分失败）在英文下与表一致', () => {
    const F = ['deflate-raw', 'deflate', 'gzip'] as const;
    setLang('en');
    const noProbe = readableCompressionFailureText([]);
    const allFailed = readableCompressionFailureText(F.map((format) => ({ format, supported: false })));
    const someFailed = readableCompressionFailureText([
      { format: 'deflate-raw', supported: false },
      { format: 'deflate', supported: true },
    ]);
    setLang('zh');
    expectLocalized(noProbe, 'net-browser.compress.readable.no-probe');
    expectLocalized(allFailed, 'net-browser.compress.readable.all-failed', { formats: 'deflate-raw、deflate、gzip' });
    expectLocalized(someFailed, 'net-browser.compress.readable.some-failed', { failed: 'deflate-raw', ok: 'deflate' });
    expect(/[\u3400-\u9fff]/.test(noProbe + allFailed + someFailed), '英文下压缩失败那三段里出现汉字').toBe(false);
    // 反向锚点：中文那三段与改动前逐字相同（三段拼接最容易在搬的时候少一个逗号 / 引号）
    expect(readableCompressionFailureText([]), '第一段的中文被改了')
      .toBe('这台设备的压缩能力探测没有给出结果，邀请码没能生成。请刷新页面再试一次。');
    expect(readableCompressionFailureText(F.map((format) => ({ format, supported: false }))), '第二段的中文被改了')
      .toBe('这台设备的浏览器不支持本程序用到的任何一种压缩方式（deflate-raw、deflate、gzip），'
        + '连"不压缩"那条兜底路也没走通。请换一个较新的浏览器打开本页再试。');
    expect(readableCompressionFailureText([
      { format: 'deflate-raw', supported: false },
      { format: 'deflate', supported: true },
    ]), '第三段的中文被改了')
      .toBe('这台设备编不出邀请码：可用的压缩方式里，deflate-raw 这一档用不了，'
        + '而不压缩那条兜底路也没走通（deflate 虽然探测通过，但没有产出可用的字节）。'
        + '请刷新页面再试一次；如果一直这样，换一个较新的浏览器打开本页。');
  });

  it('压缩侧各条读数/失败句在英文下与表一致', async () => {
    setLang('en');
    const probe = await probeCompressionFormat('gzip', { compressionStream: () => null });
    const factoryThrows = await compressBytesWithFormat(utf8Encode('x'), 'gzip', {
      compressionStream: () => { throw new TypeError('boom'); },
    });
    const noStream = await compressBytesWithFormat(utf8Encode('x'), 'gzip', { compressionStream: () => null });
    const runThrows = await compressBytesWithFormat(utf8Encode('x'), 'gzip', {
      compressionStream: () => ({ run: async () => { throw new Error('boom'); } }),
    });
    const preferred = await compressBytesWithFallback(
      utf8Encode('hello world hello world'), { compressionStream: realCompression }, 'gzip');
    const fellBack = await compressBytesWithFallback(
      utf8Encode('hello world hello world'),
      { compressionStream: (m: CompressionStreamMode = 'compress') => (m === 'gzip' ? null : realCompression(m)) },
      'gzip');
    setLang('zh');
    expectLocalized(probe.note ?? '', 'net-browser.compress.probe-no-stream');
    if (!factoryThrows.ok) expectLocalized(factoryThrows.message, 'net-browser.compress.format.unavailable', { format: 'gzip' });
    if (!noStream.ok) {
      expectLocalized(noStream.message, 'net-browser.compress.no-stream');
      expectLocalized(noStream.probes?.[0]?.note ?? '', 'net-browser.compress.note.no-stream');
    }
    if (!runThrows.ok) expectLocalized(runThrows.message, 'net-browser.compress.format.no-bytes', { format: 'gzip' });
    expect(preferred.ok, '夹具失败：指定档位那条路没出结果').toBe(true);
    if (preferred.ok) {
      const used = (preferred.probes ?? []).find((p) => p.supported && (p.note ?? '') !== '')?.note ?? '';
      expectLocalized(used, 'net-browser.compress.prefer.used', { kind: 'gzip' });
    }
    expect(fellBack.ok, '夹具失败：降级那条路没出结果').toBe(true);
    if (fellBack.ok) {
      const unusable = (fellBack.probes ?? []).find((p) => !p.supported)?.note ?? '';
      expectLocalized(unusable, 'net-browser.compress.prefer.unusable', { kind: 'gzip' });
      const from = (fellBack.probes ?? []).find((p) => p.supported && (p.note ?? '') !== '')?.note ?? '';
      expectLocalized(from, 'net-browser.compress.fallback.from', { skipped: 'gzip' });
    }
  });

  it('解压侧与地址栏那几条在英文下与表一致', async () => {
    setLang('en');
    const formatFailed = await decompressBytes(utf8Encode('x'), {
      compressionStream: () => { throw new TypeError('boom'); },
    });
    const noStream = await decompressBytes(utf8Encode('x'), { compressionStream: () => null });
    // ⚠️ 这条必须给一个**非 null** 的流：`decompressBytes` 的检查顺序是
    //    `工厂抛` → `流为 null` → `输入为空` → `输出为空`。给 `() => null` 会落到
    //    "没有解压流能力"那一句（实测踩过，假红一次）。
    const empty = await decompressBytes(new Uint8Array(0), {
      compressionStream: () => ({ run: async () => new Uint8Array(0) }),
    });
    const emptyOut = await decompressBytes(utf8Encode('x'), {
      compressionStream: () => ({ run: async () => new Uint8Array(0) }),
    });
    const corrupt = await decompressBytes(utf8Encode('x'), {
      compressionStream: () => ({ run: async () => { throw new Error('boom'); } }),
    });
    const notB64 = await decompressBase64('A');
    const noFragment = await decodeInviteFromAddressBar({ location: () => null });
    const detail = readableCompressionFailureText([{ format: 'deflate-raw', supported: false, note: 'boom' }]);
    setLang('zh');
    if (!formatFailed.ok) expectLocalized(formatFailed.message, 'net-browser.decompress.format-failed', { format: 'deflate-raw', detail });
    if (!noStream.ok) expectLocalized(noStream.message, 'net-browser.decompress.no-stream');
    if (!empty.ok) expectLocalized(empty.message, 'net-browser.decompress.empty-segment');
    if (!emptyOut.ok) expectLocalized(emptyOut.message, 'net-browser.decompress.empty-result');
    if (!corrupt.ok) expectLocalized(corrupt.message, 'net-browser.decompress.corrupt');
    if (!notB64.ok) expectLocalized(notB64.message, 'net-browser.invite.not-base64url');
    if (!noFragment.ok) expectLocalized(noFragment.message, 'net-browser.address-bar.no-invite');
  });

  it('信令那几条（坏端点 / 一个都没连上 / 没能力 / 没连上 / 已关 / 发送失败）在英文下与表一致', async () => {
    setLang('en');
    const bad = signalEndpointOf('https://example.invalid/signal');
    const unreachable = await discoverSignalingEndpoint({ url: 'wss://x.invalid' }, { webSocket: () => null });
    /**
     * ⚠️ **不能**用"端点为空 + 假信令给 null"来打 `signal.no-capability`：那条路会先在
     * `roomCodeEntry` 的**端点为空**那一支返回（落到 `net.invite.no-endpoint.*`，
     * 与本轮判据面无关）。要走 `createSignalingSession` 的 `'unsupported'` 那一支，
     * 得让端点**形状合法**（`wss://`）而 `webSocket()` 给 `null` ——
     * `signalEndpointOf` 只看前缀，不建连接，所以这一份设置是确定的。
     */
    const noCap = createSignalingSession(
      { code: 'ABC123', channel: 'c' },
      { settings: () => ({ signalingEndpoint: 'wss://signal.invalid' }), webSocket: () => null },
    );
    setLang('zh');
    if (!bad.ok) expectLocalized(bad.message, 'net-browser.signal.bad-endpoint');
    if (!unreachable.ok) expectLocalized(unreachable.message, 'net-browser.signal.unreachable');
    if (!('open' in noCap)) expectLocalized(noCap.message, 'net-browser.signal.no-capability');

    const neverOpen: WebSocketLike = { readyState: 0, send: () => {}, close: () => {}, addEventListener: () => {} };
    // ⚠️ 会话与它的 `sendText` 都必须在 **en** 之下真跑：那些句子是**现调 `t()`**
    //    （不是模块级常量），但产出函数仍然只在被调用的那一刻取语言 ⇒ 在 zh 下建好再切 en
    //    读回来的还是中文（本轮实测踩过一次，假红）。
    setLang('en');
    const s = createSignalingSession({ code: 'ABC123', channel: 'c' }, {
      settings: () => ({ signalingEndpoint: 'wss://signal.invalid' }),
      webSocket: () => neverOpen,
    });
    expect('sendText' in s, '夹具失败：信令会话没造出来（端点没配？）').toBe(true);
    if ('sendText' in s) {
      const notOpen = s.sendText('x');
      setLang('zh');
      if (!notOpen.ok) expectLocalized(notOpen.message, 'net-browser.signal.not-open');
      setLang('en');
      s.close();
      const closed = s.sendText('x');
      setLang('zh');
      if (!closed.ok) expectLocalized(closed.message, 'net-browser.signal.closed');
    }
    const wsThrows: WebSocketLike = {
      readyState: 1, send: () => { throw new Error('pipe broken'); }, close: () => {}, addEventListener: () => {},
    };
    setLang('en');
    const s2 = createSignalingSession({ code: 'ABC123', channel: 'c' }, {
      settings: () => ({ signalingEndpoint: 'wss://signal.invalid' }),
      webSocket: () => wsThrows,
    });
    if ('sendText' in s2) {
      const threw = s2.sendText('x');
      setLang('zh');
      if (!threw.ok) expectLocalized(threw.message, 'net-browser.signal.send-failed', { detail: 'Error: pipe broken' });
    }
  });

  it('ICE 收集那三条（没有描述 / 没有计时能力 / 零候选到点）在英文下与表一致', async () => {
    const noDescPc = pcLike({ iceGatheringState: 'gathering' });
    Object.defineProperty(noDescPc, 'localDescription', { get: () => null, configurable: true });
    setLang('en');
    /**
     * ⚠️ 顺序：这一条会**排一个上界计时器**（`iceGatheringState !== 'complete'` ⇒ 不是同步返回），
     * 所以必须 `await` 之前 `fire()`。写成 `await waitForIceGathering(...)` 之后再 fire
     * ⇒ Promise 永不 settle、用例超时（本轮实测踩过，把 15 秒超时耗光才发现）。
     */
    const descTicker = fakeTicker();
    const noDescPromise = waitForIceGathering(noDescPc, { ticker: descTicker.t });
    descTicker.fire();
    const noDesc = await noDescPromise;
    const withDesc = (): PeerConnectionLike => pcLike({
      iceGatheringState: 'gathering',
      localDescription: { sdp: 'v=0\r\n', type: 'offer' },
    });
    const noTicker = await waitForIceGathering(withDesc(), {});
    const clk = fakeTicker();
    const p = waitForIceGathering(withDesc(), { ticker: clk.t, iceGatherTimeoutMs: 1234 });
    clk.fire();
    const zero = await p;
    setLang('zh');
    if (!noDesc.ok) expectLocalized(noDesc.message, 'net-browser.ice.no-description');
    if (!noTicker.ok) expectLocalized(noTicker.message, 'net-browser.ice.no-ticker');
    if (!zero.ok) expectLocalized(zero.message, 'net-browser.ice.no-candidate-timeout', { sec: '1.234' });
  }, 15_000);

  it('`getStats` 那五条在英文下与表一致', async () => {
    setLang('en');
    const noPc = await readRelayStatsOf(null);
    const noStats = await readRelayStatsOf(pcLike());
    const statsThrows = await readRelayStatsOf(pcLike({ getStats: async () => { throw new Error('closed'); } }));
    const notIterable = await readRelayStatsOf(pcLike({ getStats: async () => ({}) as never }));
    const pending = await readRelayStatsOf(pcLike({
      getStats: async () => report(cand('L1', 'host'), cand('R1', 'host')),
    }));
    setLang('zh');
    expectLocalized(noPc.note ?? '', 'net-browser.ice.no-connection');
    expectLocalized(noStats.note ?? '', 'net-browser.ice.no-getstats');
    expectLocalized(statsThrows.note ?? '', 'net-browser.ice.stats-failed', { detail: 'Error: closed' });
    expectLocalized(notIterable.note ?? '', 'net-browser.ice.stats-not-iterable');
    expectLocalized(pending.note ?? '', 'net-browser.ice.no-nominated-pair');
  });

  it('offer/answer 那九条在英文下与表一致', async () => {
    setLang('en');
    const noSetRemote = await acceptOffer(pcLike({ createAnswer: async () => ({ type: 'answer' }) }), { sdp: 'x' });
    const noAnswer = await acceptOffer(pcLike({ setRemoteDescription: async () => {} }), { sdp: 'x' });
    const noOfferSdp = await acceptOffer(pcLike({
      setRemoteDescription: async () => {}, createAnswer: async () => ({ type: 'answer' }),
    }), { sdp: '' });
    const setRemoteFails = await acceptOffer(pcLike({
      setRemoteDescription: async () => { throw new Error('bad offer'); },
      createAnswer: async () => ({ type: 'answer' }),
    }), { sdp: 'x' });
    const answerFails = await acceptOffer(pcLike({
      setRemoteDescription: async () => {},
      createAnswer: async () => { throw new Error('no codec'); },
    }), { sdp: 'x' });
    const setLocalFails = await acceptOffer(pcLike({
      setRemoteDescription: async () => {},
      createAnswer: async () => ({ type: 'answer', sdp: 'y' }),
      setLocalDescription: async () => { throw new Error('bad local'); },
    }), { sdp: 'x' });
    const answerNoSetRemote = await applyAnswer(pcLike(), { sdp: 'x' });
    const answerNoSdp = await applyAnswer(pcLike({ setRemoteDescription: async () => {} }), { sdp: '' });
    const answerFailsRemote = await applyAnswer(pcLike({
      setRemoteDescription: async () => { throw new Error('bad answer'); },
    }), { sdp: 'x' });
    setLang('zh');
    if (!noSetRemote.ok) expectLocalized(noSetRemote.message, 'net-browser.offer.no-set-remote');
    if (!noAnswer.ok) expectLocalized(noAnswer.message, 'net-browser.offer.no-create-answer');
    if (!noOfferSdp.ok) expectLocalized(noOfferSdp.message, 'net-browser.offer.no-offer-sdp');
    if (!setRemoteFails.ok) expectLocalized(setRemoteFails.message, 'net-browser.offer.set-remote-failed', { detail: 'Error: bad offer' });
    if (!answerFails.ok) expectLocalized(answerFails.message, 'net-browser.offer.answer-failed', { detail: 'Error: no codec' });
    if (!setLocalFails.ok) expectLocalized(setLocalFails.message, 'net-browser.offer.set-local-failed', { detail: 'Error: bad local' });
    if (!answerNoSetRemote.ok) expectLocalized(answerNoSetRemote.message, 'net-browser.answer.no-set-remote');
    if (!answerNoSdp.ok) expectLocalized(answerNoSdp.message, 'net-browser.answer.no-sdp');
    if (!answerFailsRemote.ok) expectLocalized(answerFailsRemote.message, 'net-browser.answer.set-remote-failed', { detail: 'Error: bad answer' });
  });

  it('传输层那几条（状态行 / 构建失败 / send 六种失败）在英文下与表一致', async () => {
    const INIT: TransportInit = { selfId: 'host-1', peerId: 'guest-1' };
    setLang('en');
    const noConn = createBrowserTransport({ peerConnection: () => null });
    const initFail = await noConn.init(INIT);

    /** 一条能**自己派事件**的假连接（`onPeerState` 由 `connectionstatechange` 触发） */
    const makeEvented = (dc: (label: string) => DataChannelLike) => {
      const listeners = new Map<string, Array<(ev: unknown) => void>>();
      const pc: PeerConnectionLike = {
        connectionState: 'new',
        iceConnectionState: 'new',
        localDescription: { sdp: 'v=0\r\na=candidate:1 1 udp 1 127.0.0.1 5000 typ host\r\n', type: 'offer' },
        createDataChannel: dc,
        createOffer: async () => ({ type: 'offer', sdp: 'v=0\r\n' }),
        setLocalDescription: async () => {},
        close: () => {},
        addEventListener: (type, cb) => { listeners.set(type, [...(listeners.get(type) ?? []), cb]); },
      };
      return { pc, fire: (type: string): void => { for (const cb of listeners.get(type) ?? []) cb({}); } };
    };

    const openDc = (label: string): DataChannelLike => ({
      label, readyState: 'open', bufferedAmount: 0,
      send: () => {}, close: () => {}, addEventListener: () => {},
    });
    const ev = makeEvented(openDc);
    const tr = createBrowserTransport({ peerConnection: () => ev.pc });
    const st: string[] = [];
    tr.onStatus((c) => st.push(c.message));
    await tr.init(INIT);
    const connecting = st[0];
    (ev.pc as { iceConnectionState?: string }).iceConnectionState = 'connected';
    (ev.pc as { connectionState?: string }).connectionState = 'connected';
    ev.fire('connectionstatechange');
    const online = st[1];
    (ev.pc as { connectionState?: string }).connectionState = 'disconnected';
    ev.fire('connectionstatechange');
    const offline = st[2];
    await tr.close();
    const closedStatus = st[st.length - 1] ?? '';
    const sendClosed = tr.send('act', 'x');

    // 从来没 init 过 ⇒ not-initialized
    const neverInited = createBrowserTransport({ peerConnection: () => ev.pc });
    const sendNotInit = neverInited.send('act', 'x');

    // 队列积压
    const trFull = createBrowserTransport({
      peerConnection: () => makeEvented((label) => ({
        label, readyState: 'open', bufferedAmount: (1 << 20) + 1,
        send: () => {}, close: () => {}, addEventListener: () => {},
      })).pc,
    });
    await trFull.init(INIT);
    const sendFull = trFull.send('act', 'x');

    // 对端不可达（通道还没 open）
    const trConnecting = createBrowserTransport({
      peerConnection: () => makeEvented((label) => ({
        label, readyState: 'connecting', bufferedAmount: 0,
        send: () => {}, close: () => {}, addEventListener: () => {},
      })).pc,
    });
    await trConnecting.init(INIT);
    const unreachable = trConnecting.send('act', 'x');

    // 通道没建出来（只建 act，而 send 要 beat）
    const trNoChan = createBrowserTransport({
      peerConnection: () => makeEvented((label) => (label === 'act' ? openDc(label) : ({
        label, readyState: 'open', bufferedAmount: 0,
        send: () => {}, close: () => {}, addEventListener: () => {},
      } as DataChannelLike))).pc,
    });
    await trNoChan.init(INIT);
    const noChannel = trNoChan.send('beat', 'x');

    // `send` 自己抛
    const trThrows = createBrowserTransport({
      peerConnection: () => makeEvented((label) => ({
        label, readyState: 'open', bufferedAmount: 0,
        send: () => { throw new Error('channel closed'); }, close: () => {}, addEventListener: () => {},
      })).pc,
    });
    await trThrows.init(INIT);
    const sendThrew = trThrows.send('act', 'x');

    setLang('zh');
    if (!initFail.ok) expectLocalized(initFail.message, 'net-browser.transport.no-peer-connection');
    expectLocalized(connecting ?? '', 'net-browser.transport.connecting', { self: 'host-1', peer: 'guest-1' });
    expectLocalized(online ?? '', 'net-browser.transport.peer-online');
    expectLocalized(offline ?? '', 'net-browser.transport.peer-offline');
    expectLocalized(closedStatus, 'net-browser.transport.closed-final');
    if (!sendNotInit.ok) expectLocalized(sendNotInit.message, 'net-browser.transport.not-initialized-send');
    if (!sendClosed.ok) expectLocalized(sendClosed.message, 'net-browser.transport.closed');
    if (!sendFull.ok) expectLocalized(sendFull.message, 'net-browser.transport.queue-full');
    if (!unreachable.ok) expectLocalized(unreachable.message, 'net-browser.transport.peer-unreachable');
    if (!noChannel.ok) expectLocalized(noChannel.message, 'net-browser.transport.no-channel', { channel: 'beat' });
    if (!sendThrew.ok) expectLocalized(sendThrew.message, 'net-browser.transport.send-failed', { detail: 'Error: channel closed' });
  });
});
