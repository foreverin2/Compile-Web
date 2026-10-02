/**
 * ★★ G6/T49：**紧凑邀请码（v3）** —— 码里不再带整段 SDP，只带最小必要集。
 *
 * 这一份文件钉四件事（每一件都能假）：
 *  1. **真的变小**：同一份字段走 `'compact'` 比走 `'full'` 短一大截，且落在紧凑档自己的
 *     实测区间里（`COMPACT_INVITE_CHARS_MIN/MAX`）；
 *  2. **真的能解**：解码之后 `sessionId` / 两个承诺位逐字回来，**SDP 是本地重建的**，
 *     里面 `a=ice-ufrag` / `a=ice-pwd` / `a=fingerprint:sha-256` / 每一条候选都在
 *     （漏一项就红 —— 这正是变异 M1/M2 的落点）；
 *  3. **缺东西必须退回 v2**（任务书 A4/A5）：没有候选 / 没有指纹 / 认不出的候选行
 *     ⇒ `compact-unavailable`，调用方**自动退回 v2**，**不许**悄悄少带凭据；
 *  4. **老码（v2）仍然解得开**（任务书 A3）：老的两条路（`full` 编码 + 老位置数组的直接解析）
 *     一个字没动。真机老码（`.superpowers/g5-T40/run-cdp.json` 里那几条）在真机那一轮
 *     （`.superpowers/g6-T49/run-legacy.json`）与第九道冰门里验。
 *
 * ⚠️ 它**不**验"两端真能连上" —— 那要真 Chrome 与真 WebRTC，由 `.superpowers/g6-T49/run-*.json`
 * （两个方向各一轮）与第九道冰门覆盖。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PROTO_VERSION } from '../../src/net/protocol';
import {
  COMPACT_INVITE_CHARS_MAX,
  COMPACT_INVITE_CHARS_MIN,
  COMPACT_PAYLOAD_VERSION,
  INVITE_CHARS_MAX_UNCOMPRESSED,
  base64UrlToBytes,
  compactCandidateOfLine,
  compactFoundationOf,
  compactPayloadText,
  compactPriorityOf,
  decodeInvite,
  decodeInviteText,
  encodeInvite,
  icePwdOfSessionId,
  iceUfragOfSessionId,
  newerVersionHint,
  parseInvitePayload,
  rawBytesForInvite,
  utf8Decode,
  utf8Encode,
  type InviteFields,
} from '../../src/net/invite';
import { createInvite, decodeInvitePayload, inviteLengthReportOf } from '../../src/ui/net-browser';
import { inviteLengthText } from '../../src/ui/net-lobby';

/* ------------------------------------------------------------------ *
 * 夹具
 * ------------------------------------------------------------------ */

/** 一台真机形状的 SDP（3 条候选：host(含 mDNS 名) / srflx / relay）—— 取自 g5-T40 的真码 */
const REAL_SDP = [
  'v=0',
  'o=- 3352960531112731972 2 IN IP4 127.0.0.1',
  's=-',
  't=0 0',
  'a=group:BUNDLE 0',
  'a=extmap-allow-mixed',
  'a=msid-semantic: WMS',
  'm=application 49170 UDP/DTLS/SCTP webrtc-datachannel',
  'c=IN IP4 8.130.97.243',
  'a=candidate:259711282 1 udp 2113937151 52f3d6ff-952f-4daf-aba4-bc52bab66e84.local 64489 typ host generation 0 network-cost 999',
  'a=candidate:3565100533 1 udp 1677729535 120.226.109.92 29292 typ srflx raddr 0.0.0.0 rport 0 generation 0 network-cost 999',
  'a=candidate:4037822409 1 udp 33562623 8.130.97.243 49170 typ relay raddr 120.226.109.92 rport 29292 generation 0 network-cost 999',
  'a=ice-ufrag:ffvU',
  'a=ice-pwd:Mof1Vp/uRymuZlfY/OZWa/8z',
  'a=ice-options:trickle',
  'a=fingerprint:sha-256 42:15:35:69:3E:99:40:A2:6D:E9:40:1D:93:DA:59:4E:C1:30:72:AB:76:B0:13:E6:B0:D5:B7:9B:0B:4F:6B:33',
  'a=setup:actpass',
  'a=mid:0',
  'a:sctp-port:5000',
  'a=max-message-size:262144',
].join('\r\n') + '\r\n';

const SESSION_ID = 'sid-00000000000000000000000000000000';
const HOST_PROMISE = 'a'.repeat(64);
const GUEST_PROMISE = 'b'.repeat(64);
const ANSWER_PLACEHOLDER = 'answer-not-a-promise';

function fields(over: Partial<InviteFields> = {}): InviteFields {
  return {
    p: PROTO_VERSION,
    sessionId: SESSION_ID,
    sdp: REAL_SDP,
    ice: REAL_SDP.split('\r\n').filter((l) => l.startsWith('a=candidate:')).map((l) => l.slice(2)),
    hostPromise: HOST_PROMISE,
    guestPromise: GUEST_PROMISE,
    ...over,
  };
}

/** 恒等压缩（纯层往返的夹具；真压缩与真机那一轮分别由 `net-browser.test.ts` 与本任务的真机读数覆盖） */
const idc = (b: Uint8Array): Uint8Array => Uint8Array.from(b);
const idu = (b: Uint8Array): Uint8Array | null => Uint8Array.from(b);

function compactCode(f = fields()): string {
  const r = encodeInvite(f, idc, idu, 'raw', { mode: 'compact' });
  if (!r.ok) throw new Error(`紧凑编码失败：${r.reason} / ${r.message}`);
  return r.payload;
}

/** 解一条恒等档（"压缩段就是原文的 base64url"）的码 */
function decodeIdPayload(text: string) {
  return decodeInviteText(text, (b64) => base64UrlToBytes(b64));
}

/* ------------------------------------------------------------------ *
 * 生成式扫源码用的小工具（判据"唯一出处"要扫 `src/**`，不是点开两个文件看）
 * ------------------------------------------------------------------ */

/** 递归收集 `dir` 下的 `.ts`（与 `tests/ui/net-browser.test.ts` 的 `walkTs` 同款） */
function walkTs(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walkTs(p, out);
    else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
}

/** 剥掉块注释与行注释（"注释里提到"不算命中；与 `net-browser.test.ts` 的 `stripComments` 同款） */
function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/** `parseInvitePayload` 失败时**抛**（唯一出口），这里是测试侧的收口（与 `decodeInvite` 同款） */function parseOrFail(tuple: unknown): {
  readonly ok: boolean;
  readonly reason?: string;
  readonly message?: string;
  readonly sdp?: string;
  readonly p?: number;
} {
  try {
    const r = parseInvitePayload(tuple);
    return r.ok ? { ok: true, sdp: r.payload.sdp, p: r.payload.p } : { ok: false, reason: r.reason };
  } catch (e) {
    const err = e as { reason?: string; message?: string };
    return { ok: false, reason: err.reason ?? '(无 reason)', message: err.message ?? '' };
  }
}

/* ============================================================================
 * 1. 判据 1：真的变小
 * ========================================================================== */

describe('★★ T49 判据 1：紧凑码比整段 SDP 那一档短一大截', () => {
  it('同一份字段：compact 比 full 短 40% 以上，且落在紧凑档自己的实测区间里', () => {
    const full = encodeInvite(fields(), idc, idu, 'raw', { mode: 'full' });
    const compact = encodeInvite(fields(), idc, idu, 'raw', { mode: 'compact' });
    expect(full.ok && compact.ok).toBe(true);
    if (!full.ok || !compact.ok) return;
    expect(compact.payload.length, `紧凑码 ${compact.payload.length} 字符，没比 full 的 ${full.payload.length} 短`)
      .toBeLessThan(full.payload.length * 0.6);
    expect(compact.payload.length).toBeGreaterThanOrEqual(COMPACT_INVITE_CHARS_MIN);
    expect(compact.payload.length).toBeLessThanOrEqual(COMPACT_INVITE_CHARS_MAX);
    expect(compact.payload.slice(0, 2)).toBe(`${PROTO_VERSION}.`);
  });

  it('★★ 真机 relay 候选固化成输入：重建出来的候选行与原始**逐字段相同**（含 raddr/rport 那种形态）', () => {
    /**
     * 输入出处：`.superpowers/g6-T49/fixture-real-relay-offer.txt` —— **真机 relay-only 那一跑**
     * 房主的 `localDescription`（见 `run-relay-compact.json` 的 `sdpCompare.hostLocal`）。
     *
     * 这一条是评审要的"那条腿"：把**真机上真产出的 relay 候选行与 SDP 关键字段**当夹具，
     * 断言重建结果与原件的**每一项**都对得上。回退/写坏重建口径（端口、地址、优先级档、
     * 类型、指纹、ICE 凭据、setup）都会让它红。
     */
    const REAL_RELAY_SDP = [
      'v=0',
      'o=- 1800361632143834460 2 IN IP4 127.0.0.1',
      's=-',
      't=0 0',
      'a=group:BUNDLE 0',
      'a=extmap-allow-mixed',
      'a=msid-semantic: WMS',
      'm=application 49198 UDP/DTLS/SCTP webrtc-datachannel',
      'c=IN IP4 8.130.97.243',
      'a=candidate:56111826 1 udp 33562623 8.130.97.243 49198 typ relay raddr 0.0.0.0 rport 0 generation 0 network-cost 999',
      'a=ice-ufrag:vwBP',
      'a=ice-pwd:ZUkSZKGwQTzQCoHeNP+Qjr0G',
      'a=ice-options:trickle',
      'a=fingerprint:sha-256 AC:A1:3B:6C:B5:01:68:85:CF:BA:2C:E0:87:BD:71:12:E3:B1:4C:03:B1:BB:FA:35:03:80:46:63:D4:4A:50:61',
      'a=setup:actpass',
      'a=mid:0',
      'a=sctp-port:5000',
      'a=max-message-size:262144',
    ].join('\r\n') + '\r\n';
    const f = fields({ sdp: REAL_RELAY_SDP, ice: [] });
    const prepared = rawBytesForInvite(f, { mode: 'compact' });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    // 真正解一遍（走产品读路径），拿到重建出来的 SDP
    const encoded = encodeInvite(f, idc, idu, 'raw', { mode: 'compact' });
    expect(encoded.ok).toBe(true);
    if (!encoded.ok) return;
    const back = decodeIdPayload(encoded.payload);
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    const rebuilt = back.payload.sdp;
    const origLine = REAL_RELAY_SDP.split('\r\n').find((l) => l.startsWith('a=candidate:'));
    const newLine = rebuilt.split('\r\n').find((l) => l.startsWith('a=candidate:'));
    expect(origLine).toBeDefined();
    expect(newLine).toBeDefined();
    const fieldsOf = (line: string) => {
      const m = /^a=candidate:(\S+) (\d+) (\S+) (\d+) (\S+) (\d+) typ (\S+)(.*)$/.exec(line ?? '');
      if (m === null) return null;
      return { foundation: m[1], component: m[2], transport: m[3], priority: Number(m[4]),
        address: m[5], port: m[6], type: m[7], tail: m[8].trim() };
    };
    const o = fieldsOf(origLine as string);
    const n = fieldsOf(newLine as string);
    expect(o).not.toBeNull();
    expect(n).not.toBeNull();
    if (o === null || n === null) return;
    // ★ 逐字段（评审列的清单）
    expect(n.type, '类型').toBe(o.type);
    expect(n.address, '地址').toBe(o.address);
    expect(n.port, '端口').toBe(o.port);
    expect(n.component, 'component').toBe(o.component);
    expect(n.transport, '传输').toBe(o.transport);
    /**
     * priority：本实现照 **RFC 8445** 的 type preference 重算（relay 的 type preference 是 0），
     * 而 Chrome 给 relay 用的是高位字节 2 ⇒ **具体取值不同**（`16777215` vs `33562623`）。
     * 这一条钉两件事：
     *  ① 重算出来的值落在 **relay 那一档**（高位字节 = 0，即"最低优先级"那一类）；
     *  ② **不是**把别的类型算成了 relay（host/srflx 的高位字节是 126/100）。
     *
     * ⚠️ 这是**已知且被接受的**偏离（真机实测：`probe-minimal-sdp.mjs` 里把 relay 的 priority
     * 写死成 100/300 也照样连通 ⇒ 它只影响"先试哪一对"）。**评测侧也照同一套 RFC 口径重算**
     * （`tools/browser-truth-ice-fallback-cdp.mjs` 的 `compactPriorityOf`），两端一致。
     */
    const typeBand = (p: number) => (p >>> 24) & 0xff;
    expect(typeBand(n.priority), `重建的 relay 优先级档位不对：${String(n.priority)}`).toBe(0);
    expect(typeBand(o.priority), 'Chrome 给 relay 的高位字节变了（这条腿的说明要跟着改）').toBe(2);
    expect(typeBand(compactPriorityOf('host', 30) as number), 'host 那一档').toBe(126);
    expect(typeBand(compactPriorityOf('srflx', 30) as number), 'srflx 那一档').toBe(100);
    expect(n.priority, '重建值要落在 uint32 范围里').toBeGreaterThan(0);
    expect(n.priority).toBeLessThan(2 ** 32);
    expect(n.foundation.length, 'foundation 空').toBeGreaterThan(0);
    // 关键属性：ICE 凭据 / DTLS 指纹 / setup **逐字相同**
    const lineOf = (sdp: string, key: string) => sdp.split('\r\n').find((l) => l.startsWith(key)) ?? '';
    expect(lineOf(rebuilt, 'a=ice-ufrag:')).toBe(lineOf(REAL_RELAY_SDP, 'a=ice-ufrag:'));
    expect(lineOf(rebuilt, 'a=ice-pwd:')).toBe(lineOf(REAL_RELAY_SDP, 'a=ice-pwd:'));
    expect(lineOf(rebuilt, 'a=fingerprint:sha-256 ')).toBe(lineOf(REAL_RELAY_SDP, 'a=fingerprint:sha-256 '));
    expect(lineOf(rebuilt, 'a=setup:')).toBe(lineOf(REAL_RELAY_SDP, 'a=setup:'));
    expect(lineOf(rebuilt, 'a=sctp-port:')).toBe(lineOf(REAL_RELAY_SDP, 'a=sctp-port:'));
    expect(lineOf(rebuilt, 'a=max-message-size:')).toBe(lineOf(REAL_RELAY_SDP, 'a=max-message-size:'));
    expect(lineOf(rebuilt, 'a=mid:')).toBe(lineOf(REAL_RELAY_SDP, 'a=mid:'));
    // 候选条数一致（这里恰好 1 条 relay）
    expect(rebuilt.split('\r\n').filter((l) => l.startsWith('a=candidate:'))).toHaveLength(
      REAL_RELAY_SDP.split('\r\n').filter((l) => l.startsWith('a=candidate:')).length,
    );
    // 指纹的**形状**（冒号十六进制、32 组）也要对得上 —— 写坏格式会让 DTLS 协商失败
    const fp = lineOf(rebuilt, 'a=fingerprint:sha-256 ').slice('a=fingerprint:sha-256 '.length);
    expect(fp.split(':')).toHaveLength(32);
    expect(fp).toMatch(/^[0-9A-F]{2}(:[0-9A-F]{2}){31}$/);
  });

  it('紧凑档的 JSON 里**没有**整段 SDP 的影子（v=0 / m=application / candidate: / raddr 都不许出现）', () => {
    const r = rawBytesForInvite(fields(), { mode: 'compact' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const text = utf8Decode(r.bytes);
    expect(text).not.toBeNull();
    for (const banned of ['v=0', 'm=application', 'a=candidate:', 'a=group:BUNDLE', 'a=mid:0', 'raddr', 'generation 0']) {
      expect(text ?? '', `紧凑载荷里出现了 ${banned}（那说明它还在搬整段 SDP）`).not.toContain(banned);
    }
    expect(JSON.parse(text as string)[0]).toBe(COMPACT_PAYLOAD_VERSION);
  });

  it('长度读数按档位选区间（紧凑档不会因为比 600 短就被说成越界）', () => {
    const code = compactCode();
    expect(inviteLengthReportOf(code, true).withinMeasuredRange).toBe(true);
    expect(inviteLengthReportOf(code, true).min).toBe(COMPACT_INVITE_CHARS_MIN);
    // 反控：把它当 v2 量 ⇒ 落在 600-900 之外（这正是"必须按档选"的理由）
    expect(inviteLengthReportOf(code, false).withinMeasuredRange).toBe(false);
  });

  /**
   * ★★ **P0（评审核出，2026-09-28）**：一条 **v3 的 `-u`（不压缩兜底）码**必须落在
   * **v3 自己那一组区间**里 —— 评审在真屏上读到它被判成「不在这一档的实测区间内…可能被
   * 某些聊天工具截断」。原因：档位判定里 `none` 优先于 `compact`（v2 未压缩档的 2000 上界
   * 把紧凑档那一组盖住了）。真机实测：v3 `-u` 邀请码 **476** 字符（`run-t49-u.txt`）。
   */
  it('★ v3 的 `-u` 码不许被说成"可能被截断"（档位按载荷版本判，不按压缩档）', async () => {
    const made = await createInvite(
      { originAndPath: 'https://example.invalid/x.html', ...fields() },
      { compressionStream: () => null },
    );
    expect(made.ok).toBe(true);
    if (!made.ok) return;
    expect(made.format, '这一条腿要的是一条未压缩码').toBe('none');
    expect(made.payload.includes('.-u'), '打的不是 -u 标记').toBe(true);
    // ① 逐字段：它落在紧凑档那一组区间里（不是 v2 未压缩档那一组）
    const report = inviteLengthReportOf(made.payload, true);
    expect(report.min).toBe(COMPACT_INVITE_CHARS_MIN);
    expect(report.max).toBe(COMPACT_INVITE_CHARS_MAX);
    expect(report.withinMeasuredRange, `v3 -u 码 ${String(report.chars)} 字符被判成"越出区间"`).toBe(true);
    // ② 屏上那句人话：不许出现"可能被截断"那一支
    const line = inviteLengthText(report.chars, report.withinMeasuredRange);
    expect(line).toContain('落在这一档的实测区间内');
    expect(line, 'v3 -u 码被屏上说要防截断 —— 这就是评审在真屏上读到的那一条').not.toContain('截断');
    // 反控：**v2** 的 `-u` 码仍然走它自己那一组（未压缩档的 2000 上界，T40 那一条没动）
    const v2 = await createInvite(
      { originAndPath: 'https://example.invalid/x.html', ...fields(), payloadFormat: 'full' },
      { compressionStream: () => null },
    );
    expect(v2.ok).toBe(true);
    if (v2.ok) {
      expect(v2.format).toBe('none');
      const r2 = inviteLengthReportOf(v2.payload, false);
      expect(r2.max).toBe(INVITE_CHARS_MAX_UNCOMPRESSED);
      expect(r2.withinMeasuredRange).toBe(true);
    }
  });
});

/* ============================================================================
 * 2. 判据 2：解码之后逐字段回来，SDP 是本地重建的
 * ========================================================================== */

describe('★★ T49 判据 2：解码之后逐字段回来，SDP 是本地重建的', () => {
  it('sessionId / 两个承诺位逐字回来；SDP 里 ICE 凭据、DTLS 指纹、每一条候选都在', () => {
    const back = decodeIdPayload(compactCode());
    expect(back.ok, `紧凑码解不开：${back.ok ? '' : back.reason + ' / ' + back.message}`).toBe(true);
    if (!back.ok) return;
    const p = back.payload;
    expect(p.v).toBe(COMPACT_PAYLOAD_VERSION);
    expect(p.sessionId).toBe(SESSION_ID);
    expect(p.hostPromise).toBe(HOST_PROMISE);
    expect(p.guestPromise).toBe(GUEST_PROMISE);
    expect(p.p).toBe(PROTO_VERSION);
    expect(p.sdp).toContain('a=ice-ufrag:ffvU');
    expect(p.sdp).toContain('a=ice-pwd:Mof1Vp/uRymuZlfY/OZWa/8z');
    expect(p.sdp).toContain('a=fingerprint:sha-256 42:15:35:69:3E:99:40:A2:6D:E9:40:1D:93:DA:59:4E:C1:30:72:AB:76:B0:13:E6:B0:D5:B7:9B:0B:4F:6B:33');
    expect(p.sdp).toContain('a=setup:actpass');
    expect(p.sdp).toContain('m=application 9 UDP/DTLS/SCTP webrtc-datachannel');
    expect(p.sdp).toContain('a=sctp-port:5000');
    const lines = p.sdp.split('\r\n').filter((l) => l.startsWith('a=candidate:'));
    expect(lines.length).toBe(3);
    expect(p.sdp).toContain('52f3d6ff-952f-4daf-aba4-bc52bab66e84.local 64489 typ host');
    expect(p.sdp).toContain('120.226.109.92 29292 typ srflx');
    expect(p.sdp).toContain('8.130.97.243 49170 typ relay');
    // `ice` 那一项与重建出来的候选行逐字相同（v2 里它是 `candidatesOf(sdp)` 抠出来的）
    expect(p.ice).toEqual(lines);
  });

  it('★ 候选 priority 由 type 重算：host > prflx > srflx > relay（RFC 8445 的 type preference）', () => {
    expect(compactPriorityOf('host')).toBeGreaterThan(compactPriorityOf('prflx') as number);
    expect(compactPriorityOf('prflx')).toBeGreaterThan(compactPriorityOf('srflx') as number);
    expect(compactPriorityOf('srflx')).toBeGreaterThan(compactPriorityOf('relay') as number);
    // 缺省本机优先级（255）下 host / relay 的两个端点值（component 恒为 1 ⇒ 低 8 位是 255）
    expect(compactPriorityOf('host')).toBe(2113994751);
    expect(compactPriorityOf('relay')).toBe(65535);
    // 本机优先级那一档由调用方带着（真机那一份 host 的 local preference = 30）
    expect(compactPriorityOf('host', 30)).toBe(2113937151);
    expect(compactPriorityOf('host', 30)).toBeLessThan(compactPriorityOf('host') as number);
    // 认不出的 type 回 null（调用方据此退回 v2，不猜）
    expect(compactPriorityOf('wat')).toBeNull();
    // 重算确定性：同 type 同地址同 foundation；地址不同则不同
    expect(compactFoundationOf('host', '10.0.0.1')).toBe(compactFoundationOf('host', '10.0.0.1'));
    expect(compactFoundationOf('host', '10.0.0.1')).not.toBe(compactFoundationOf('host', '10.0.0.2'));
    // 原候选的 local preference 被取出来带着（真机那一份的候选：126/100/0 三个 type 前缀，
    // 本机优先级那一字节分别是 30 / 30 / 31 —— 这台机器上 Chrome 给的 local preference 很小）
    expect(compactCandidateOfLine('a=candidate:1 1 udp 2113937151 10.0.0.1 5000 typ host'))
      .toEqual({ type: 'host', address: '10.0.0.1', port: 5000, localPref: 30 });
    expect(compactCandidateOfLine('a=candidate:2 1 udp 1677729535 203.0.113.7 6100 typ srflx'))
      .toEqual({ type: 'srflx', address: '203.0.113.7', port: 6100, localPref: 30 });
    expect(compactCandidateOfLine('a=candidate:3 1 udp 33562623 198.51.100.7 6200 typ relay'))
      .toEqual({ type: 'relay', address: '198.51.100.7', port: 6200, localPref: 31 });
    // 取出来再放回去必须逐位相同（重算不是"换一个值"，是"同一个值的两处表示"）
    expect(compactPriorityOf('host', 30)).toBe(2113937151);
    expect(compactPriorityOf('srflx', 30)).toBe(1677729535);
    /**
     * ⚠️ **relay 对不上**：真机那一份的 relay 是 **33562623**（高位字节 = 2），而按 RFC 8445 的
     * type preference 算出来是 **8191**（高位字节 = 0）。⇒ **Chrome 给候选的 priority 不是
     * 照 RFC 那一套填的**（它给 srflx 的也是 1685987071 / 高位 102，同款偏离）。
     *
     * 本实现照 **RFC** 重算（`CANDIDATE_TYPE_PREFERENCE`），两端都是本程序 ⇒ 一致。
     * 这不是判据：probe（`.superpowers/g6-T49/probe-minimal-sdp.mjs`）实测过 priority
     * **写死成常数**也照样连通 —— priority 只影响"先试哪一对"。
     * 这一条只是把"我们与 Chrome 的取值不同"这个事实钉在测试里，免得后来人以为它是 bug。
     */
    expect(compactPriorityOf('relay', 31)).toBe(8191);
    expect(compactPriorityOf('relay', 31)).not.toBe(33562623);  });

  it('★ `a=setup` 按"这是不是回示码"本地定：邀请码 actpass / 回示码 passive', () => {
    const answerFields = fields({ hostPromise: ANSWER_PLACEHOLDER, guestPromise: ANSWER_PLACEHOLDER });
    const r = rawBytesForInvite(answerFields, { mode: 'compact' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const tuple = JSON.parse(utf8Decode(r.bytes) as string) as readonly unknown[];
    expect(tuple[4]).toBe('p');
    const back = parseOrFail(tuple);
    expect(back.ok).toBe(true);
    expect(back.sdp ?? '', '回示码那一侧重建出来的 setup 应当是 passive').toContain('a=setup:passive');
    // 反控：邀请码那一份是 actpass，且 `p` 由 `decodeInviteText` 从明文段填（这里是占位 -1）
    const inviteTuple = JSON.parse(compactPayloadText({
      p: PROTO_VERSION, sessionId: SESSION_ID, iceUfrag: 'compile-u', icePwd: 'compile-p',
      fingerprint: 'AA:BB', iceRole: 'actpass',
      candidates: [{ type: 'host', address: '10.0.0.1', port: 5000 }],
      hostPromise: HOST_PROMISE, guestPromise: GUEST_PROMISE,
    })) as readonly unknown[];
    const inviteBack = parseOrFail(inviteTuple);
    expect(inviteBack.ok).toBe(true);
    expect(inviteBack.sdp ?? '').toContain('a=setup:actpass');
    expect(inviteBack.p).toBe(-1);
  });
});

/* ============================================================================
 * 3. 判据 3：缺必要项 ⇒ 退回 v2（A4/A5 的兜底）
 * ========================================================================== */

describe('★★ T49 判据 3：缺必要项 ⇒ 紧凑档不可用（不许少带凭据）', () => {
  const noUfrag = REAL_SDP.replace('a=ice-ufrag:ffvU\r\n', '');
  const noPwd = REAL_SDP.replace('a=ice-pwd:Mof1Vp/uRymuZlfY/OZWa/8z\r\n', '');
  const noFp = REAL_SDP.replace(/a=fingerprint:sha-256 [^\r]+\r\n/, '');
  const noCand = REAL_SDP.split('\r\n').filter((l) => !l.startsWith('a=candidate:')).join('\r\n');

  it('缺 ufrag / pwd / 指纹 / 候选 各自都让紧凑档不可用，且说的是缺哪一项', () => {
    const cases: ReadonlyArray<readonly [string, string, string]> = [
      ['缺 a=ice-ufrag', noUfrag, 'a=ice-ufrag'],
      ['缺 a=ice-pwd', noPwd, 'a=ice-pwd'],
      ['缺 a=fingerprint', noFp, 'a=fingerprint:sha-256'],
      ['缺候选', noCand, 'a=candidate:'],
    ];
    for (const [name, sdp, want] of cases) {
      const r = rawBytesForInvite(fields({ sdp, ice: [] }), { mode: 'compact' });
      expect(r.ok, `${name}：紧凑档居然产出来了`).toBe(false);
      if (r.ok) continue;
      expect(r.reason).toBe('compact-unavailable');
      expect(r.message).toContain(want);
    }
    // 反控：正常那一份必须成功（否则上面全是恒真）
    expect(rawBytesForInvite(fields(), { mode: 'compact' }).ok).toBe(true);
  });

  it('★ 调用方（`createInvite`）在紧凑档不可用时**自动退回 v2**，并留下真因', async () => {
    const made = await createInvite(
      { originAndPath: 'https://example.invalid/x.html', ...fields({ sdp: noCand, ice: [] }) },
      undefined,
    );
    expect(made.ok, `退不回 v2：${made.ok ? '' : made.message}`).toBe(true);
    if (!made.ok) return;
    const back = await decodeInvitePayload(made.payload);
    expect(back.ok).toBe(true);
    if (back.ok) expect(back.payload.v).toBe(2);
    expect(made.fallbackReason ?? '', '退回 v2 却没留下真因').toContain('a=candidate:');
    // 拿不到指纹时同一条路（v2 档照旧出得来）
    const noFpMade = await createInvite(
      { originAndPath: 'https://example.invalid/x.html', ...fields({ sdp: noFp, ice: [] }) },
      undefined,
    );
    expect(noFpMade.ok).toBe(true);
    if (noFpMade.ok) expect(noFpMade.fallbackReason ?? '').toContain('fingerprint');
  });

  it('反控：正常那份**不**退回（`fallbackReason` 是 null，解出来是 v3）', async () => {
    const made = await createInvite(
      { originAndPath: 'https://example.invalid/x.html', ...fields() },
      undefined,
    );
    expect(made.ok).toBe(true);
    if (!made.ok) return;
    expect(made.fallbackReason).toBeNull();
    const back = await decodeInvitePayload(made.payload);
    expect(back.ok).toBe(true);
    if (back.ok) {
      expect(back.payload.v).toBe(COMPACT_PAYLOAD_VERSION);
      /**
       * ★ ICE 凭据**逐字取自 SDP**（`a=ice-ufrag:ffvU` / `a=ice-pwd:Mof1…`）——
       * 它们必须是**这条连接真正在用的那一对**。第一版是"本端按 `sessionId` 推一串"，
       * 真机当场红：`setRemoteDescription(offer)` 报
       * `InvalidAccessError … Invalid ICE…`（两端凭据对不上）。
       */
      expect(back.payload.sdp).toContain('a=ice-ufrag:ffvU');
      expect(back.payload.sdp).toContain('a=ice-pwd:Mof1Vp/uRymuZlfY/OZWa/8z');
      expect(back.payload.sdp).toContain('a=fingerprint:sha-256 42:15:35:69:3E:99:40:A2:6D:E9:40:1D:93:DA:59:4E:C1:30:72:AB:76:B0:13:E6:B0:D5:B7:9B:0B:4F:6B:33');
      expect(back.payload.sdp.split('\r\n').filter((l) => l.startsWith('a=candidate:')).length).toBe(3);
    }
  });

  it('★ SDP 里缺 ICE 凭据（上界到点那一刻）⇒ **退回 v2**，不许改写成别的凭据', async () => {
    const noCreds = REAL_SDP
      .replace('a=ice-ufrag:ffvU\r\n', '')
      .replace('a=ice-pwd:Mof1Vp/uRymuZlfY/OZWa/8z\r\n', '');
    const made = await createInvite(
      { originAndPath: 'https://example.invalid/x.html', ...fields({ sdp: noCreds, ice: [] }) },
      undefined,
    );
    expect(made.ok, `SDP 没有凭据时应当退回 v2 照旧出码：${made.ok ? '' : made.message}`).toBe(true);
    if (!made.ok) return;
    expect(made.fallbackReason ?? '', '退回 v2 却没留下真因').toContain('ice-ufrag');
    const back = await decodeInvitePayload(made.payload);
    expect(back.ok).toBe(true);
    if (back.ok) {
      expect(back.payload.v).toBe(2);
      // ★ 这条码里**没有**凭据（SDP 本来就没有），而实现**没有**自己编一串塞进去
      expect(back.payload.sdp).not.toContain('a=ice-ufrag:compile-');
    }
  });

  it('`payloadFormat: "full"` 显式要求老格式时，出的是 v2（判据 3 的那条腿）', async () => {
    const made = await createInvite(
      { originAndPath: 'https://example.invalid/x.html', ...fields(), payloadFormat: 'full' },
      undefined,
    );
    expect(made.ok).toBe(true);
    if (!made.ok) return;
    expect(made.fallbackReason).toBeNull();
    const back = await decodeInvitePayload(made.payload);
    expect(back.ok).toBe(true);
    if (back.ok) {
      expect(back.payload.v).toBe(2);
      expect(back.payload.sdp).toBe(REAL_SDP);
    }
  });

  it('认不出的候选行 ⇒ 退回 v2（跳掉它等于悄悄少给对端一条路）', () => {
    const weird = REAL_SDP.replace('typ host', 'typ wat');
    const r = rawBytesForInvite(fields({ sdp: weird }), { mode: 'compact' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain('认不出的候选行');
  });

  it('★ 篡改候选的地址（塞空格）⇒ 重建之后逐条复读当场拒（`bad-payload`）', () => {
    const prepared = rawBytesForInvite(fields(), { mode: 'compact' });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    const tuple = JSON.parse(utf8Decode(prepared.bytes) as string) as unknown[][];
    (tuple[2] as unknown[])[3] = [['h', '10.0.0.1 9999', 5000, 255]];
    const r = parseOrFail(tuple);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('bad-payload');
  });

  it('版本号不是 2 也不是 3 ⇒ `version-mismatch`（两条读路径分得开）', () => {
    const prepared = rawBytesForInvite(fields(), { mode: 'compact' });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    const tuple = JSON.parse(utf8Decode(prepared.bytes) as string) as unknown[];
    tuple[0] = 9;
    const r = parseOrFail(tuple);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('version-mismatch');
  });

  it('★ ICE 凭据由 `sessionId` 本地推：同会话号同串、不同会话号不同串', () => {
    const a = iceUfragOfSessionId(SESSION_ID, (s) => `h(${s})`);
    const b = iceUfragOfSessionId(SESSION_ID, (s) => `h(${s})`);
    const c = iceUfragOfSessionId('sid-11111111111111111111111111111111', (s) => `h(${s})`);
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toContain('compile-');
    expect(icePwdOfSessionId(SESSION_ID, (s) => `h(${s})`)).not.toBe(a);
  });
});

/* ============================================================================
 * 5. ★ 「旧版前端读到新版码」那一句提示（G6/T49 顺手加的产品改进）
 * ========================================================================== */

describe('★★ T49：解不开一条"结构上比本机新"的载荷时，人话里要点名版本', () => {
  /**
   * 这一条钉的是 `parseInvitePayload` 的**哪一条分支**：`'bad-payload'` 那一族里
   * "形状不对"的四种情形（不是数组 / 版本项不是整数 / v3 材料缺项 / 项数不对）。
   * ⚠️ 它**不**覆盖"压缩段解不开"那两条（那是码被改坏，说"版本旧"会把人带偏）。
   */
  const shapes: ReadonlyArray<readonly [string, unknown]> = [
    ['根本不是数组', { not: 'an array' }],
    ['版本项不是整数', ['x', SESSION_ID, REAL_SDP, [''], HOST_PROMISE, GUEST_PROMISE]],
    ['v3 版本 + v2 的 6 项（旧版前端的形状）', [3, SESSION_ID, REAL_SDP, [''], HOST_PROMISE, GUEST_PROMISE]],
    ['v3 材料缺项', [3, SESSION_ID, [], [], 'a', HOST_PROMISE, GUEST_PROMISE]],
    ['项数多一项', [2, SESSION_ID, REAL_SDP, [''], HOST_PROMISE, GUEST_PROMISE, '多']],
  ];

  it('形状不对的每一支都给"让对方刷新页面"那一句（且 reason 仍然是可读的那一族）', () => {
    for (const [name, tuple] of shapes) {
      const r = parseOrFail(tuple);
      expect(r.ok, `${name}：居然被收下了`).toBe(false);
      if (r.ok) continue;
      expect(['bad-payload', 'version-mismatch'], `${name}：reason 不在"形状不对"那一族里`).toContain(r.reason);
      expect(r.message ?? '', `${name}：那句人话里没有"刷新页面"这一步`).toContain('刷新页面');
      expect(r.message ?? '', `${name}：没点名"版本"`).toContain('版本');
    }
    // 反控：正常的 v3 与 v2 都必须被收下（否则上面全是恒真）
    const good = rawBytesForInvite(fields(), { mode: 'compact' });
    expect(good.ok).toBe(true);
    if (good.ok) expect(parseOrFail(JSON.parse(utf8Decode(good.bytes) as string)).ok).toBe(true);
    expect(decodeInvite(utf8Encode(JSON.stringify(
      [2, SESSION_ID, REAL_SDP, [''], HOST_PROMISE, GUEST_PROMISE],
    ))).ok).toBe(true);
  });

  it('反控：**码被改坏**那两条（压缩流坏了 / 字符集不对）**不**说"版本旧"', () => {
    // 压缩流坏了：解压器拒收 ⇒ `decompress-failed`（这条腿用的就是"恒返回 null 的解压器"）
    const r = decodeInviteText(`${PROTO_VERSION}.-r${'A'.repeat(40)}`, () => null);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('decompress-failed');
      expect(r.message, '码被改坏却说"版本旧"，会把玩家带偏').not.toContain('刷新页面');
    }
    // 字符集不对 ⇒ `bad-base64url`
    const r2 = decodeIdPayload(`${PROTO_VERSION}.-rAAAA!!AAAA`);
    expect(r2.ok).toBe(false);
    if (!r2.ok) {
      expect(r2.reason).toBe('bad-base64url');
      expect(r2.message).not.toContain('刷新页面');
    }
  });

  /**
   * ★★ **评审 P1.5**：这一条是**真的**在查"唯一出处"，不是只查取值非空。
   *
   * 口径：把 `src/**` 生成式扫一遍（剥注释），那一句人话的**正文片段**
   * （`'刷新页面之后重新生成一条'`）只许出现在**一处**；屏上那条路径
   * （`src/ui/net-lobby.ts`）**引用取值函数**，不许把那句话抄一遍。
   *
   * ★ 2026-10-02（英文模式真机走查 B）：唯一出处从 `src/net/invite.ts` 搬到了
   * `src/i18n/zh.ts`（键 `net.invite.newer-version-hint`）—— 那句中文不再是源码里的字面量，
   * 而是文案表里的一条。判据的**意图没变**（同一句话只有一个家），只是那个家换了地方：
   * 现在**全仓只有 `zh.ts` 一处**写着它，`invite.ts` 只调 `newerVersionHint()`。
   */
  it('那条提示的唯一出处是一个取值函数 + 文案表一条，且 `src/**` 里只有一处写它的正文', () => {
    expect(newerVersionHint()).toContain('刷新页面');
    expect(newerVersionHint()).toContain('版本');
    const srcDir = fileURLToPath(new URL('../../src/', import.meta.url));
    const files = walkTs(srcDir);
    expect(files.length, 'src 下一个 .ts 都没扫到（路径写错？）').toBeGreaterThan(50);
    const fragment = '刷新页面之后重新生成一条';
    /**
     * ⚠️ 读文件**不走 node 的 `Buffer` / `readFileSync(path,'utf8')`**：本仓的 tsconfig 只带
     * `types: ["vite/client"]`（没有 `@types/node`）⇒ `Buffer` 在类型上不存在。用
     * `TextDecoder`（DOM lib）把 `Uint8Array` 解成文本，类型与运行时都不用 node 的全局。
     */
    const read = (p: string): string => {
      const raw = readFileSync(p) as unknown as { readonly length: number; readonly [i: number]: number };
      const bytes = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i += 1) bytes[i] = raw[i];
      return new TextDecoder('utf-8').decode(bytes);
    };
    const hits = files
      .filter((f) => stripComments(read(f)).includes(fragment))
      .map((f) => f.slice(srcDir.length).split('\\').join('/'));
    expect(hits, `那句提示的正文出现在多处（应当只有 src/i18n/zh.ts 一处）：${hits.join('、')}`)
      .toEqual(['i18n/zh.ts']);
    // 大厅那条路是**引用取值函数**（这一条防"把话抄一份到渲染层"）
    const lobby = stripComments(read(join(srcDir, 'ui', 'net-lobby.ts')));
    expect(lobby.includes(fragment), '大厅里把那句提示抄了一遍（应当引用取值函数）').toBe(false);
    // 反向：写它的那一层**不许**是产出代码（`invite.ts` 里已经一个字都没有了）
    expect(stripComments(read(join(srcDir, 'net', 'invite.ts'))).includes(fragment),
      'invite.ts 里又写了一遍那句正文（应当只调 newerVersionHint()）').toBe(false);
    // 反控：片段本身确实在 zh.ts 里（否则上面那条可能是"文件没扫到"造成的恒真）
    expect(stripComments(read(join(srcDir, 'i18n', 'zh.ts')))).toContain(fragment);
  });
});

/* ============================================================================
 * 4. 判据 3（A3）：老码（v2）仍然解得开
 * ========================================================================== */

describe('★★ T49 判据 3：老码（v2）仍然解得开', () => {
  it('v2 那一份仍然解得出（走 `full` 编出来的码解回来是 v2 / 版本号 2 / SDP 逐字相同）', () => {
    const r = encodeInvite(fields(), idc, idu, 'raw', { mode: 'full' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const back = decodeIdPayload(r.payload);
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(back.payload.v).toBe(2);
    expect(back.payload.sdp).toBe(REAL_SDP);
    expect(back.payload.ice).toEqual(fields().ice);
  });

  it('v2 的 6 项位置数组逐条校验一个字没动（缺 sdp / 缺承诺 / 7 项都给 bad-payload）', () => {
    const full = [2, SESSION_ID, REAL_SDP, [''], HOST_PROMISE, GUEST_PROMISE];
    expect(decodeInvite(utf8Encode(JSON.stringify(full))).ok).toBe(true);
    for (const bad of [
      [2, SESSION_ID, REAL_SDP, [''], HOST_PROMISE],
      [2, SESSION_ID, '', [''], HOST_PROMISE, GUEST_PROMISE],
      [2, SESSION_ID, REAL_SDP, 'not-an-array', HOST_PROMISE, GUEST_PROMISE],
      [...full, '多出来的一项'],
    ]) {
      const r = decodeInvite(utf8Encode(JSON.stringify(bad)));
      expect(r.ok, `${JSON.stringify(bad).slice(0, 40)}… 被收下了`).toBe(false);
      if (!r.ok) expect(r.reason).toBe('bad-payload');
    }
  });

  it('★ 分派按"版本号 + 项数"：版本不对是"格式新"、项数不对是"缺字段"', () => {    // 6 项（v2 的形状）但版本写 3 ⇒ 项数对不上 v3 那 7 项 ⇒ 按 v2 判 ⇒ `version-mismatch`
    // （⚠️ 这一条是**老判据**（`tests/net/invite.test.ts` 的"版本不符"那条）钉住的语义：
    //   6 项 + 版本 3 是那条老测试的输入 —— 它要的就是 `version-mismatch`，不是"缺字段"）
    const sixWithV3 = [3, SESSION_ID, REAL_SDP, [''], HOST_PROMISE, GUEST_PROMISE];
    const r = parseOrFail(sixWithV3);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('version-mismatch');
    // 6 项、版本是个**不认识**的数 ⇒ `version-mismatch`
    const sixWithV9 = [9, SESSION_ID, REAL_SDP, [''], HOST_PROMISE, GUEST_PROMISE];
    const r9 = parseOrFail(sixWithV9);
    expect(r9.ok).toBe(false);
    if (!r9.ok) expect(r9.reason).toBe('version-mismatch');
    // 7 项但版本写 2 ⇒ 按 v2 的形状校验 ⇒ 项数不对 ⇒ `bad-payload`（不是"格式新"）
    const sevenWithV2 = [2, SESSION_ID, REAL_SDP, [''], HOST_PROMISE, GUEST_PROMISE, '多'];
    const r2 = parseOrFail(sevenWithV2);
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.reason).toBe('bad-payload');
    // 7 项、版本 3（正确的 v3 形状）⇒ 收下
    const good = rawBytesForInvite(fields(), { mode: 'compact' });
    expect(good.ok).toBe(true);
    if (good.ok) {
      const tuple = JSON.parse(utf8Decode(good.bytes) as string) as readonly unknown[];
      expect(tuple.length).toBe(7);
      expect(parseOrFail(tuple).ok).toBe(true);
    }
  });
});
