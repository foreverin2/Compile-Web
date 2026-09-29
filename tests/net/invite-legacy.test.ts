/**
 * ★★ G6/T49：**老码兼容**（任务书判据 3 / A3）—— 产品侧真的把四条老形态各解一次。
 *
 * ## 为什么单独一个文件（而不是塞进 `invite-compact.test.ts`）
 *
 * 评审（2026-09-28 定向复验 P2）指出：第九道冰门夹具里那行"两条读路径自证"是 `say`（**不判定**），
 * 而且缺夹具文件时会**静默跳过** ⇒ "老码仍然解得开"这件事整体悬在一行不判定的输出上。
 * 那个先例（T42）允许保留，但**牙要放在产品侧**：这一份就是那颗牙。
 *
 * ## 它钉什么
 *
 * 1. **真机老码**：`.superpowers/g6-T49/old-codes.json` 里 `B_answer_raw`（654 字符、`-r` 档、
 *    **改之前产出的**、承诺位是回示码占位串）原样抄进来当夹具 —— 不读文件（门禁在任何工作
 *    目录下都能跑），不 import 产品代码去造它。
 * 2. **四条老形态各解一次**：`.-r` / `.-d` / `.-g` / `.-u`，用**真的**压缩 / 解压
 *    （`CompressionStream`，Node 22 自带；本仓 tsconfig 没有 `@types/node`，所以不用 `zlib`）。
 * 3. **关键字段逐条在**：`sessionId` / `sdp` 逐字 / `ice` 与 SDP 里那几行一致 / 两个承诺位 /
 *    版本号是 v2（`INVITE_PAYLOAD_VERSION`）。
 *
 * ⚠️ 它**不**验真连接（那要真 Chrome：见 `.superpowers/g6-T49/run-t49.txt` 的"老码贴进新代码"那三条）。
 */
import { describe, expect, it } from 'vitest';
import { PROTO_VERSION } from '../../src/net/protocol';
import {
  INVITE_PAYLOAD_VERSION,
  base64UrlToBytes,
  bytesToBase64Url,
  payloadBytesOf,
  decodeInviteText,
  encodeInvite,
  type CompressionKind,
  type InviteFields,
  type InvitePayload,
} from '../../src/net/invite';

/**
 * **真机老码**（`.superpowers/g6-T49/old-codes.json` 的 `B_answer_raw`，654 字符）。
 *
 * 出处：`.superpowers/g5-T40/run-cdp.json` 的 `scenarios.B.guestAnswerCode`（2026-09-27 真机产出）。
 * 两个承诺位是 `answer-not-a-promise` ⇒ 它是一条**回示码**（`isAnswerPayload` 那条定义），
 * 而邀请码与回示码同一套编解码 ⇒ 拿它验"老码读路径"是同一件事。
 */
const OLD_REAL_CODE = '1.-rxZE7b9swFEb_CqHZtPmmeAENqS0DAZI0hWN0SDLQFGWz1gsUHaf99YFiF5k6d7rA-e7jgHxms2wM'
  + 'FTacClqzimtWc8FFzkyuaqU494xpzrJZ9laQl_jS9QVGklFNc6UkY0xybghRiKHbB3T7KBBlek7mZE6n7rHAU0kFQZ_TttjH_jTAt-3D6q78y_x7au2AbdP0'
  + 'Z9yGd19deDupjb61XQoO0M_7zcTbwg5DE5xNoe-QQdvV42L1dLdZbJZPj-jsdzE5XNlk3cF2nW-mGVdc7cin2_Wus10VKps8MMO0'
  + 'MpQziSg6VQNilHLDNZUUWUqllo5j41iNBaEW5zthsa53XFHGvd7ZedM72yApKJUo_R7QoR8T2vvOx4smQZ1P5z4esZsSY8xFITiP'
  + 'T3W0e2jv4_GLDecKXBn85tfxxsfF4kfcHtZlx7_H9farqx-m5SOkGNyx8ZegDt3exyGGLsF4sJhJhdYUVgSYAJ5DLqDUIDRICkYD'
  + '1aCXQBWUKyAKRA5rAfoGdDmlyxxKCcqAMbCUICioFWgCeg2Cg-GwzqFcXg6PPp0GsC6Ft6tKGyq4vvXo0oCHPiaQhFxZa99x68fR'
  + '7j0ewx8PTDEqxBRms-fsv35P9jrLbDeefcRdn7DFQ-zbMPrsH_j1Aw';

/** 一条**老形态**（v2）可执行语料（与 `invite-compact.test.ts` 同一个形状） */
const SDP = [
  'v=0',
  'o=- 3352960531112731972 2 IN IP4 127.0.0.1',
  's=-',
  't=0 0',
  'm=application 49170 UDP/DTLS/SCTP webrtc-datachannel',
  'a=candidate:259711282 1 udp 2113937151 52f3d6ff-952f-4daf-aba4-bc52bab66e84.local 64489 typ host',
  'a=ice-ufrag:ffvU',
  'a=ice-pwd:Mof1Vp/uRymuZlfY/OZWa/8z',
  'a=fingerprint:sha-256 42:15:35:69:3E:99:40:A2:6D:E9:40:1D:93:DA:59:4E:C1:30:72:AB:76:B0:13:E6:B0:D5:B7:9B:0B:4F:6B:33',
  'a=setup:actpass',
].join('\r\n') + '\r\n';

const SESSION_ID = 'sid-legacy-00000000000000000000000';
const PROMISE = 'answer-not-a-promise';

function fields(): InviteFields {
  return {
    p: PROTO_VERSION,
    sessionId: SESSION_ID,
    sdp: SDP,
    ice: SDP.split('\r\n').filter((l) => l.startsWith('a=candidate:')).map((l) => l.slice(2)),
    hostPromise: PROMISE,
    guestPromise: PROMISE,
  };
}

/**
 * 真的压缩 / 解压（`CompressionStream` / `DecompressionStream`，Node 22 自带）。
 *
 * ⚠️ **不用 `node:zlib` / `Buffer`**：本仓 tsconfig 只带 `types: ["vite/client"]`
 * （没有 `@types/node`）⇒ 那两个名字在类型上不存在，`npx tsc --noEmit` 会红。
 */
type ZKind = 'deflate-raw' | 'deflate' | 'gzip';
async function pump(stream: { readable: ReadableStream<Uint8Array>; writable: WritableStream<Uint8Array> },
  bytes: Uint8Array): Promise<Uint8Array> {
  const writer = stream.writable.getWriter();
  void writer.write(bytes);
  void writer.close();
  const chunks: Uint8Array[] = [];
  const reader = stream.readable.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done === true) break;
    if (value !== undefined) chunks.push(value);
  }
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  return out;
}

async function deflateTo(kind: ZKind, bytes: Uint8Array): Promise<Uint8Array> {
  const CS = (globalThis as { CompressionStream?: new (f: string) => unknown }).CompressionStream;
  if (typeof CS !== 'function') throw new Error('这台机器没有 CompressionStream，这一份测试没有判别力');
  return pump(new CS(kind) as never, bytes);
}

async function inflateFrom(kind: ZKind, bytes: Uint8Array): Promise<Uint8Array> {
  const DS = (globalThis as { DecompressionStream?: new (f: string) => unknown }).DecompressionStream;
  if (typeof DS !== 'function') throw new Error('这台机器没有 DecompressionStream，这一份测试没有判别力');
  return pump(new DS(kind) as never, bytes);
}

/** 解一条码（四条形态各自按自己的档位**真解**一遍，再交给产品读路径） */
async function decodeWithRealStreams(code: string): Promise<
  { ok: true; payload: InvitePayload } | { ok: false; reason: string }
> {
  const dot = code.indexOf('.');
  const seg = code.slice(dot + 1);
  const marker = seg.startsWith('-') ? seg.slice(0, 2) : '';
  const body = seg.slice(marker.length);
  const buf = base64UrlToBytes(body);
  if (buf === null) return { ok: false, reason: 'bad-base64url' };
  let plain: Uint8Array;
  try {
    plain = marker === '-d' ? await inflateFrom('deflate', buf)
      : marker === '-g' ? await inflateFrom('gzip', buf)
        : marker === '-u' ? buf : await inflateFrom('deflate-raw', buf);
  } catch {
    return { ok: false, reason: 'decompress-failed' };
  }
  const r = decodeInviteText(code, () => plain);
  return r.ok ? { ok: true, payload: r.payload } : { ok: false, reason: r.reason };
}

describe('★★ T49 判据 3（产品侧）：四条老形态各自解得开，关键字段逐条在', () => {
  it('★ 真机老码（654 字符 / `-r` 档 / 改之前产出的回示码）解得开，字段逐条对得上', async () => {
    const r = await decodeWithRealStreams(OLD_REAL_CODE);
    expect(r.ok, `真机老码解不开：${r.ok ? '' : r.reason}`).toBe(true);
    if (!r.ok) return;
    const p = r.payload;
    expect(p.v, '老码的载荷版本必须是 v2').toBe(INVITE_PAYLOAD_VERSION);
    expect(p.p).toBe(PROTO_VERSION);
    expect(p.sessionId.length).toBeGreaterThan(8);
    // 那一条是"1 候选那场"的回示码 ⇒ SDP 里恰好一条候选、指纹与 ICE 凭据都在
    expect(p.sdp).toContain('a=ice-ufrag:');
    expect(p.sdp).toContain('a=ice-pwd:');
    expect(p.sdp).toContain('a=fingerprint:sha-256 ');
    expect(p.sdp.split('\r\n').filter((l) => l.startsWith('a=candidate:'))).toHaveLength(1);
    // `ice` 那一项 = 从 SDP 里抠出来的那几行（v2 的定义）
    expect(p.ice).toEqual(p.sdp.split('\r\n').filter((l) => l.startsWith('a=candidate:')).map((l) => l.slice(2)));
    // 两个承诺位是回示码占位串（`isAnswerPayload` 的定义）
    expect(p.hostPromise).toBe('answer-not-a-promise');
    expect(p.guestPromise).toBe('answer-not-a-promise');
  });

  it('★ 四条老形态（`-r` / `-d` / `-g` / `-u`）各解一次，字段与原文逐字相同', async () => {
    const f = fields();
    /**
     * ⚠️ 要压的字节用**产品侧同一份** `payloadBytesOf()`（不是这里手搓的 JSON ——
     * 手搓一份会让"压出来的必须解得动"那道自检当场红，第一版就是这么错的）。
     */
    const raw = payloadBytesOf(f);
    /** 三条**压缩档**（`-u` 那一条单独走：它自己就是 base64url，不需要压缩器） */
    const forms: ReadonlyArray<readonly [CompressionKind, ZKind, string]> = [
      ['raw', 'deflate-raw', '-r'],
      ['deflate', 'deflate', '-d'],
      ['gzip', 'gzip', '-g'],
    ];
    for (const [productKind, streamKind, marker] of forms) {
      const encoded = await deflateTo(streamKind, raw);
      const enc = encodeInvite(
        f,
        () => encoded,
        // 同步口回答的是"真解一遍"的结果（不是同一性判断）
        () => raw,
        productKind,
        { mode: 'full' },
      );
      expect(enc.ok, `${marker} 档编不出来：${enc.ok ? '' : enc.reason}`).toBe(true);
      if (!enc.ok) continue;
      /**
       * ★ 标记**逐字**断言（评审复核轮点出的恒真断言）。
       *
       * 原来是 `startsWith('1' + marker) || startsWith('1.')` —— 括号里第二项把**所有**码
       * 都包含了（每条码都以 `1.` 开头）⇒ 那条断言形同没写，"标记写错"根本红不了。
       * 现在按"这条码**实际该有的**标记"逐字比：前缀 = `<协议版本>.<标记>`（`-r`/`-d`/`-g`
       * 各 2 字符 ⇒ 前 4 个字符）。
       */
      const prefix = `${PROTO_VERSION}.${marker}`;
      const head = enc.payload.slice(0, prefix.length);
      expect(head, `标记写错了：这条码以 ${JSON.stringify(head)} 开头，应该是 ${prefix}`).toBe(prefix);
      // 反控（防"这三条腿其实量的是同一档"）：三个标记互不相同、且恰好覆盖三条腿
      expect(new Set(forms.map(([, , m]) => m)).size).toBe(3);
      // 真正的牙在往返上：解回来必须逐字段等于原文
      const r = await decodeWithRealStreams(enc.payload);
      expect(r.ok, `${marker} 档解不开：${r.ok ? '' : r.reason}`).toBe(true);
      if (!r.ok) continue;
      expect(r.payload.v).toBe(INVITE_PAYLOAD_VERSION);
      expect(r.payload.sessionId).toBe(SESSION_ID);
      expect(r.payload.sdp).toBe(SDP);
      expect(r.payload.ice).toEqual(f.ice);
      expect(r.payload.hostPromise).toBe(PROMISE);
    }
    // ★ `-u`（不压缩那一档）：载荷就是 base64url 的原文，不需要任何设备能力
    const encU = encodeInvite(f, () => raw, () => raw, 'none', { mode: 'full' });
    expect(encU.ok).toBe(true);
    if (encU.ok) {
      expect(encU.payload.startsWith(`${PROTO_VERSION}.-u`)).toBe(true);
      const r = await decodeWithRealStreams(encU.payload);
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.payload.v).toBe(INVITE_PAYLOAD_VERSION);
        expect(r.payload.sdp).toBe(SDP);
      }
    }  });

  it('反控：**六项**位置数组的校验一个字没动（缺 sdp / 缺承诺 / 7 项 ⇒ `bad-payload` / `version-mismatch`）', () => {
    const full = [2, SESSION_ID, SDP, [''], PROMISE, PROMISE];
    const one = (x: unknown): string => {
      const bytes = new TextEncoder().encode(JSON.stringify(x));
      // 这一条腿只服务"读路径的拒绝面"，用恒等压缩段（`-u`）最直白
      return `${PROTO_VERSION}.-u${bytesToBase64Url(bytes)}`;
    };
    const cases: ReadonlyArray<readonly [string, string, string]> = [
      ['缺 sdp', one([2, SESSION_ID, '', [''], PROMISE, PROMISE]), 'bad-payload'],
      ['缺房主承诺', one([2, SESSION_ID, SDP, [''], '', PROMISE]), 'bad-payload'],
      ['7 项（v2 版本号）', one([...full, '多']), 'bad-payload'],
      ['版本号不认识', one([9, SESSION_ID, SDP, [''], PROMISE, PROMISE]), 'version-mismatch'],
    ];
    for (const [name, code, want] of cases) {
      const r = decodeInviteText(code, (b64) => base64UrlToBytes(b64));
      expect(r.ok, `${name} 被收下了`).toBe(false);
      if (!r.ok) expect(r.reason, `${name} 的 reason 不对`).toBe(want);
    }
    // 反控：完整的那一份必须被收下
    expect(decodeInviteText(one(full), (b64) => base64UrlToBytes(b64)).ok).toBe(true);
  });
});
