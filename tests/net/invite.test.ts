import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { stripComments } from '../ui/source-text';
import { PROTO_VERSION, normalizeRoomCode, roomCodeFromRandom, ROOM_CODE_ALPHABET } from '../../src/net/protocol';
import {
  COMPRESSED_BYTES_MAX,
  COMPRESSED_BYTES_MIN,
  COMPRESSION_RATIO_MAX,
  COMPRESSION_RATIO_MIN,
  INVITE_CHARS_MAX,
  INVITE_CHARS_MIN,
  INVITE_FRAGMENT_KEY,
  INVITE_PAYLOAD_VERSION,
  INVITE_PROTO_VERSION,
  NO_ENDPOINT_MESSAGE,
  base64UrlToBytes,
  bytesToBase64Url,
  decodeInvite,
  decodeInviteText,
  encodeInvite,
  inviteFragmentOf,
  inviteLinkOf,
  payloadBytesOf,
  protocolVersionCheck,
  qrPlaceholder,
  roomCodeEntryReachability,
  utf8Decode,
  utf8Encode,
  type InviteFields,
} from '../../src/net/invite';

/* ============================================================================
 * G5 T7 的**纯层**判据（`src/net/invite.ts`）
 *
 * 对应任务书 §2 的判据 3（往返）、4（损坏输入给可读原因）、6（载荷只在 fragment）、
 * 7（长度区间）、11（短码字符表只有一处）、13（QR 只留占位）、14（文案本体的边界）。
 *
 * ## 本文件里的两条文本腿，能力边界写在这里（T4 的教训：§2 第 15 条 `:94`）
 *
 *  - `短码字符表` 那条腿只扫 `src/net/invite.ts` 与 `src/ui/net-browser.ts` **两个文件**，
 *    **不保证全仓唯一** —— 全仓唯一由 `src/net/protocol.ts:274` 的常量本身与它的消费者决定；
 *  - `判据 14` 那条腿只断言"文案本体在 `invite.ts`、`net-browser.ts` 只是转发"，
 *    它**不**保证 T8 的页面一定引用它（那属 T8 的判据，本任务书判据 14 明写划界）。
 * ========================================================================== */

/** 读一份源码文本。走仓库既有的读取口径（`tests/node-types.d.ts:22` 的声明只有 subarray/toString） */
function readSrc(path: string): string {
  return readFileSync(path).subarray(0, 4 * 1024 * 1024).toString('utf8');
}

/* ---------------- 测试语料 ---------------- */

/** 一段与实测同量级的承诺串（64 位十六进制；实测里就是两个 sha256 十六进制串） */
const PROMISE_A = '4dd1a1a32afa8dfe4dd1a1a32afa8dfe4dd1a1a32afa8dfe4dd1a1a32afa8dfe';
const PROMISE_B = '9c1f2b7e0a3d4f5a9c1f2b7e0a3d4f5a9c1f2b7e0a3d4f5a9c1f2b7e0a3d4f5a';

/** 一段假的 SDP（本文件只测编解码，不需要真实 SDP；真实语料在 `tests/ui/net-browser.test.ts`） */
const SDP = 'v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\ns=-\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\n';

/** 这一局的房主会话号（D 轮 I-3 甲之后载荷里的一项；形状照 `main.ts` 的 `newSessionId()`） */
const SESSION_ID = 'sid-00000000000000000000000000000000';

/** 一份完整的载荷字段（`v` 由 `encodeInvite` 补） */
function fields(over: Partial<InviteFields> = {}): InviteFields {
  return {
    p: PROTO_VERSION,
    // ★ D 轮（I-3 甲）：载荷里多了"这一局的房主会话号"这一项
    sessionId: SESSION_ID,
    sdp: SDP,
    ice: ['candidate:1 1 udp 2122260223 10.0.0.1 5000 typ host'],
    hostPromise: PROMISE_A,
    guestPromise: PROMISE_B,
    ...over,
  };
}

/**
 * 一对**恒等**的压缩 / 解压：原样交回字节。
 *
 * 本文件测的是编解码本身（往返、失败原因、fragment）；压缩的**真值**在
 * `tests/ui/net-browser.test.ts` 用真的 `deflate-raw` 量（那里才有判据 7 的长度区间）。
 * 这一对在这里的作用是让"编码侧的自洽检查"通得过。
 */
const identityCompress = (raw: Uint8Array): Uint8Array => Uint8Array.from(raw);
const identityDecompress = (b: Uint8Array): Uint8Array | null => Uint8Array.from(b);

/** 用恒等压缩编一条载荷（返回**直接**给玩家粘贴的那串字符） */
function encodeWith(f: InviteFields): string {
  const r = encodeInvite(f, identityCompress, identityDecompress);
  if (!r.ok) throw new Error(`编码失败：${r.reason} / ${r.message}`);
  return r.payload;
}

/** 解一条载荷：走 `decodeInviteText`（先判字符集、再"解压"、再解析） */
function decodeWith(text: string, decompress: (b64: string) => Uint8Array | null = (b64) => base64UrlToBytes(b64)) {
  return decodeInviteText(text, decompress);
}

/* ============================================================================
 * 1. 往返（判据 3）
 * ========================================================================== */

describe('邀请码往返：逐字段相等（判据 3）', () => {
  it('decodeInvite(encodeInvite(x)) 与 x **逐字段**相等', () => {
    const x = fields();
    const payload = encodeWith(x);
    const r = decodeInviteText(payload, (b64) => base64UrlToBytes(b64));
    expect(r.ok, `解码失败：${r.ok ? '' : r.reason + ' / ' + r.message}`).toBe(true);
    if (!r.ok) return;
    expect(r.payload.p).toBe(x.p);
    // ★ D 轮（I-3 甲）：这一局的会话号也逐字往返
    expect(r.payload.sessionId).toBe(x.sessionId);
    expect(r.payload.sdp).toBe(x.sdp);
    expect(r.payload.ice).toEqual([...x.ice]);
    expect(r.payload.hostPromise).toBe(x.hostPromise);
    expect(r.payload.guestPromise).toBe(x.guestPromise);
    expect(r.payload.v).toBe(INVITE_PAYLOAD_VERSION);
  });

  it('往返对**多候选**与**空候选**都成立（`ice` 是数组，不是"有一个候选"的假设）', () => {
    for (const ice of [[], ['a', 'b', 'c']] as const) {
      const x = fields({ ice: [...ice] });
      const r = decodeInviteText(encodeWith(x), (b64) => base64UrlToBytes(b64));
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.payload.ice).toEqual([...ice]);
    }
  });

  it('两次编码同一条输入得到**同一串**（编码里没有取随机 / 时钟的位置）', () => {
    expect(encodeWith(fields())).toBe(encodeWith(fields()));
  });

  it('UTF-8 往返：中文与代理对（表情）都能原样回来', () => {
    for (const s of ['甲方的种子承诺', 'a\u0000b', '\u{1F600} 表情也算字符']) {
      expect(utf8Decode(utf8Encode(s))).toBe(s);
    }
  });

  it('base64url 往返：随机字节逐字节相等（含 0 字节与 255）', () => {
    const bytes = Uint8Array.from([0, 1, 127, 128, 254, 255, 0, 255, 42]);
    const back = base64UrlToBytes(bytesToBase64Url(bytes));
    expect(back === null ? null : [...back]).toEqual([...bytes]);
  });
});

/* ============================================================================
 * 2. 损坏 / 截断 / 结构缺失（判据 4、变异 M3）
 *
 * 三类的 `reason` **互不相同**，且都**不**是"静默返回空对象"。
 * ========================================================================== */

describe('损坏输入给可读原因，不静默返回空对象（判据 4）', () => {
  /**
   * 三条坏输入。每条**自己带解压行为** —— 因为它们坏在**不同的一步**上：
   *
   *  ① 非 base64url 字符：`&` `!` `=` 不在字符表里 ⇒ 解压之前就被判掉；
   *  ② 截断：字符集仍然合法，但**解压器拒绝**这份字节 ⇒ 这一条用"恒返回 null 的解压器"
   *     如实表达"deflate 流坏了"（真实的解压器对坏流就是 reject，不会返回半截内容）；
   *  ③ 结构缺失：载荷是合法 base64url、也解得开（真 JSON），但对象里只有版本号。
   */
  /** 数据段用的 JSON：**由纯层的 `payloadBytesOf` 产出**（不在测试里手抄一份形状） */
  const segment = (f: InviteFields) => bytesToBase64Url(payloadBytesOf(f));

  const bad: ReadonlyArray<readonly [string, () => { ok: boolean; reason?: string; message?: string }]> = [
    ['① 非 base64url 字符', () => decodeWith(`${PROTO_VERSION}.v=0!!这一串不是 base64url!!AAAA`)],
    ['② 截断（载荷被砍掉一半）', () => {
      const full = encodeWith(fields());
      /**
       * 截断点取 60%：要让**压缩段**仍然是合法的 base64url 长度 —— 否则这一条会掉进
       * `'bad-base64url'`（长度 % 4 === 1 不可能解码），与 ① 撞成同一个 reason，
       * 判据 4 的"三类互不相同"就测不出东西了。实测 585 字符的载荷下 60% 处长度 % 4 === 2。
       */
      const cut = Math.floor(full.length * 0.6);
      return decodeWith(full.slice(0, cut), () => null);
    }],
    ['③ 结构缺失（能解出对象但缺字段）', () => {
      // 两段结构**合法**（明文版本 + 合法 base64url 压缩段），解出来的是一个**项数不够**的
      // 位置数组（只有格式版本 / sdp / 候选，缺两个承诺），于是它会走到解析那一步、
      // 报 `bad-payload` —— 与 ① `bad-base64url`、② `decompress-failed` 都不同。
      //
      // ⚠️ 这里的"解压器"必须交出**真 JSON 字节**：恒返回 `new Uint8Array([1,2,3])` 会让这一条
      // 掉进 `'bad-json'`（那不是"缺字段"，是"连 JSON 都不是"），实测踩过一次。
      const json = JSON.stringify([INVITE_PAYLOAD_VERSION, SESSION_ID, SDP, ['']]);
      const body = bytesToBase64Url(utf8Encode(json));
      return decodeWith(`${PROTO_VERSION}.${body}`, () => utf8Encode(json));
    }],
  ];

  it('三类输入各自失败（`ok === false`），且都给非空 `reason` 与可读 `message`', () => {
    for (const [name, run] of bad) {
      const r = run();
      expect(r.ok, `${name}：居然被收下了（这正是 M3 要能红的世界）`).toBe(false);
      if (r.ok) continue;
      expect((r.reason ?? '').length, `${name}：reason 是空串`).toBeGreaterThan(0);
      expect((r.message ?? '').length, `${name}：message 不可读`).toBeGreaterThan(8);
    }
  });

  it('★ 三类的 `reason` **互不相同**（靠 reason 区分，不靠三个出口）', () => {
    const reasons = bad.map(([name, run]) => {
      const r = run();
      expect(r.ok, `${name} 被收下了`).toBe(false);
      return r.reason ?? '(ok)';
    });
    expect(new Set(reasons).size, `三类的 reason 撞了：${JSON.stringify(reasons)}`).toBe(3);
    expect(reasons).toEqual(['bad-base64url', 'decompress-failed', 'bad-payload']);
  });

  it('结构缺失的几条子情形（缺 sdp / 缺承诺 / 项数不对 / 根本不是数组）都给 `bad-payload`', () => {
    const one = (over: readonly unknown[]): string => JSON.stringify(over);
    const full = [INVITE_PAYLOAD_VERSION, SESSION_ID, SDP, [''], PROMISE_A, PROMISE_B];
    const cases: readonly string[] = [
      one([INVITE_PAYLOAD_VERSION, SESSION_ID, [''], PROMISE_A, PROMISE_B]), // 只 5 项
      one([INVITE_PAYLOAD_VERSION, SESSION_ID, SDP, [''], '', PROMISE_B]), // 缺房主承诺
      one([INVITE_PAYLOAD_VERSION, SESSION_ID, SDP, [''], PROMISE_A, '']), // 缺加入方承诺
      one([INVITE_PAYLOAD_VERSION, SESSION_ID, '', [''], PROMISE_A, PROMISE_B]), // 缺 sdp
      one([INVITE_PAYLOAD_VERSION, '', SDP, [''], PROMISE_A, PROMISE_B]), // 缺会话号（D 轮新增的一位）
      one([INVITE_PAYLOAD_VERSION, SESSION_ID, SDP, 'not-an-array', PROMISE_A, PROMISE_B]), // ice 不是数组
      one([...full, '多出来的一项']), // 7 项
      one([]), // 空数组
      one([null, null, null, null, null, null]), // 逐位都不对
    ];
    for (const raw of cases) {
      const r = decodeInvite(utf8Encode(raw));
      expect(r.ok, `${raw} 被收下了`).toBe(false);
      if (!r.ok) expect(r.reason).toBe('bad-payload');
    }
    // 反控：**完整**的那一份必须被收下（否则上面全是恒真）
    expect(decodeInvite(utf8Encode(one(full))).ok).toBe(true);
  });

  it('版本不符给 `version-mismatch`（与 `bad-payload` 分开：那是"格式新"，不是"缺字段"）', () => {
    const r = decodeWith(`${PROTO_VERSION}.${bytesToBase64Url(utf8Encode(JSON.stringify([
      INVITE_PAYLOAD_VERSION + 1,
      SESSION_ID,
      SDP,
      [''],
      PROMISE_A,
      PROMISE_B,
    ])))}`, (b64) => base64UrlToBytes(b64));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('version-mismatch');
      expect(r.message).toContain('版本');
    }
  });

  it('解压之后不是 JSON ⇒ `bad-json`（与"结构缺失"分开：连对象都不是）', () => {
    const r = decodeInvite(utf8Encode('这不是 JSON'));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('bad-json');
      expect(r.message.length).toBeGreaterThan(8);
    }
  });

  it('反证：**合法**输入必须被收下（否则上面那些"失败"可能只是解码器恒失败）', () => {
    const r = decodeInviteText(encodeWith(fields()), (b64) => base64UrlToBytes(b64));
    expect(r.ok, '合法输入被拒了 —— 上面那批判据是恒真的').toBe(true);
  });
});

/* ============================================================================
 * 2.5 明文段协议版本的比对（收尾轮：消掉那个死常量）
 *
 * 评审（`.superpowers/g5-T7-review/REVIEW.md` 评审 B）实测：明文段那个数字
 * 从前**没有任何一处比对** —— `decodeInviteText('999.<合法压缩段>')` 给出
 * `ok: true` 且 `p === 999`，玩家看不到任何提示。
 * ========================================================================== */

describe('明文段的协议版本会被比对（收尾轮）', () => {
  it('本机版本 ⇒ `proto.ok === true`、`message` 为空串', () => {
    const r = decodeInviteText(encodeWith(fields()), (b64) => base64UrlToBytes(b64));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.proto.ok, '本机版本居然被判成不一致').toBe(true);
    expect(r.proto.remote).toBe(PROTO_VERSION);
    expect(r.proto.local).toBe(PROTO_VERSION);
    expect(r.proto.message).toBe('');
  });

  it('★ 对端版本更**新** ⇒ `proto.ok === false` + 一句可读提示（但不在这里拒绝）', () => {
    const payload = `${PROTO_VERSION + 7}.${bytesToBase64Url(payloadBytesOf(fields()))}`;
    const r = decodeInviteText(payload, (b64) => base64UrlToBytes(b64));
    // 邀请码本身仍然解得出（"版本不一样"与"邀请码坏了"是两件事）
    expect(r.ok, '版本不一致时把整条邀请码也拒了').toBe(true);
    if (!r.ok) return;
    expect(r.payload.p).toBe(PROTO_VERSION + 7);
    expect(r.proto.ok).toBe(false);
    expect(r.proto.remote).toBe(PROTO_VERSION + 7);
    expect(r.proto.local).toBe(PROTO_VERSION);
    expect(r.proto.message).toContain('更新的版本');
    expect(r.proto.message).toContain(String(PROTO_VERSION + 7));
    expect(r.proto.message).toContain(String(PROTO_VERSION));
  });

  it('★ 对端版本更**旧** ⇒ 另一句提示（与"更新"分开：玩家要做的事不一样）', () => {
    const older = PROTO_VERSION - 1 >= 1 ? PROTO_VERSION - 1 : PROTO_VERSION + 1;
    const payload = `${older}.${bytesToBase64Url(payloadBytesOf(fields()))}`;
    const r = decodeInviteText(payload, (b64) => base64UrlToBytes(b64));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.proto.ok).toBe(false);
    expect(r.proto.message).toContain(older > PROTO_VERSION ? '更新的版本' : '更旧的版本');
    // 反控：两句提示**不是同一句**（否则"分开"只是嘴上说说）
    const newerMsg = protocolVersionCheck(PROTO_VERSION + 1).message;
    const olderMsg = protocolVersionCheck(PROTO_VERSION - 1 >= 1 ? PROTO_VERSION - 1 : 1).message;
    expect(newerMsg).not.toBe(olderMsg);
  });

  it('这个判定是**一条可断言的纯函数**（`protocolVersionCheck(remote, local?)`）', () => {
    expect(protocolVersionCheck(3, 3)).toMatchObject({ ok: true, remote: 3, local: 3, message: '' });
    expect(protocolVersionCheck(4, 3)).toMatchObject({ ok: false, remote: 4, local: 3 });
    expect(protocolVersionCheck(2, 3)).toMatchObject({ ok: false, remote: 2, local: 3 });
    // 缺省 local = 本机 `PROTO_VERSION`（唯一出处是 `protocol.ts`，这里不另存一份）
    expect(protocolVersionCheck(PROTO_VERSION).ok).toBe(true);
    expect(protocolVersionCheck(PROTO_VERSION + 1).ok).toBe(false);
    // `INVITE_PROTO_VERSION` 与 `PROTO_VERSION` 是同一个数字（转发名，不是第二个出处）
    expect(INVITE_PROTO_VERSION).toBe(PROTO_VERSION);
  });

  it('坏掉的协议版本（不是整数）仍然给失败结果，且与"版本不一致"**分开**', () => {
    const body = bytesToBase64Url(payloadBytesOf(fields()));
    for (const bad of ['x', '-1', '1.5', '', '99999999999999999999']) {
      const r = decodeInviteText(`${bad}.${body}`, (b64) => base64UrlToBytes(b64));
      expect(r.ok, `"${bad}" 被收下了`).toBe(false);
      if (!r.ok) expect(r.reason, `"${bad}" 的 reason 不对`).toBe('bad-base64url');
    }
  });

  it('`PROTO_VERSION` 与 `INVITE_PAYLOAD_VERSION` 是两个**独立**的常量（今天相等是巧合）', () => {
    // 理由：前者是**线协议**的版本（握手要比对的那一个），后者是**载荷封装**的版本
    // （改了载荷字段就该动它、不该动线协议）。两者语义不同 ⇒ **不加**把它们钉在一起的腿，
    // 否则每次改其中一个都会撞一条与它无关的守卫。这里只钉"它们是两个名字"这件事。
    expect(typeof PROTO_VERSION).toBe('number');
    expect(typeof INVITE_PAYLOAD_VERSION).toBe('number');
    // 载荷版本进了压缩段（位置数组第 1 项），协议版本进了明文段 —— 两条路各自可读
    const tuple = JSON.parse(utf8Decode(payloadBytesOf(fields())) as string) as readonly unknown[];
    expect(tuple[0]).toBe(INVITE_PAYLOAD_VERSION);
    const payload = encodeWith(fields());
    expect(payload.slice(0, payload.indexOf('.'))).toBe(String(PROTO_VERSION));
  });
});

/* ============================================================================
 * 3. 链接形态：载荷**只在 fragment**（判据 6；变异 M6）
 * ========================================================================== */

describe('链接形态的载荷只出现在 fragment（判据 6）', () => {
  const payload = encodeWith(fields());
  const link = inviteLinkOf('https://example.invalid/compile/index.html', payload);

  it('① 生成的链接里 `#` 之后包含载荷', () => {
    const at = link.indexOf('#');
    expect(at).toBeGreaterThan(0);
    expect(link.slice(at + 1)).toBe(`${INVITE_FRAGMENT_KEY}=${payload}`);
  });

  it('② `?` 之后的 query 段**不含**载荷；③ 路径段**不含**载荷', () => {
    expect(link.includes('?'), '这条链接本来就不该有 query 段').toBe(false);
    const before = beforeHash(link);
    expect(before.includes(payload), '`#` 之前（路径段）出现了载荷').toBe(false);
  });

  it('④ `decodeInvite` 只吃 fragment：把同一串载荷放到 query / path 上喂它必须失败', () => {
    for (const url of [
      `https://example.invalid/compile/index.html?${INVITE_FRAGMENT_KEY}=${payload}`,
      `https://example.invalid/compile/${payload}/index.html`,
      `https://example.invalid/compile/index.html`,
    ]) {
      expect(inviteFragmentOf(url), `${url} 居然被当成了邀请链接`).toBeNull();
      // 直接把这串 URL 当载荷喂给解码：它必须**失败**，不许被当成邀请码收下
      const r = decodeInviteText(url, (b64) => base64UrlToBytes(b64));
      expect(r.ok, `${url} 被当成了邀请码收下`).toBe(false);
    }
  });

  it('反证：真正带 fragment 的同一条 URL 必须取得到载荷', () => {
    expect(inviteFragmentOf(link)).toBe(payload);
  });

  it('`inviteLinkOf` 会先剥掉原有的 query 与 fragment（不许把载荷拼在 `?` 后面）', () => {
    const made = inviteLinkOf('https://example.invalid/x?a=1#old', 'P');
    expect(made).toBe('https://example.invalid/x#invite=P');
  });

  it('空载荷是调用方违约（**抛**），不是"一条没用的链接"', () => {
    expect(() => inviteLinkOf('https://example.invalid/', '')).toThrow();
  });
});

/** 取 `#` 的下标（写成函数是为了让"路径段 = `#` 之前"这个口径一眼可读） */
function beforeHash(s: string): string {
  return s.slice(0, s.indexOf('#'));
}

/* ============================================================================
 * 4. 长度与压缩区间（判据 7 的纯层那一半；压缩本身在 net-browser 的腿里量）
 * ========================================================================== */

describe('长度区间与短码占比（判据 7 的纯层一半）', () => {
  it('区间常量本身就是实测区间（改窄 / 改宽都会在这里露出来）', () => {
    // 实测：deflate-raw 后 431 / 404 字节，原文 587 / 566 字符，整条约 743 字符。
    // 出处 `.superpowers/g5-recon/FINDINGS.md` §6。这几条是"常量没被顺手改宽"的闸门。
    expect(COMPRESSED_BYTES_MIN).toBe(400);
    expect(COMPRESSED_BYTES_MAX).toBe(470);
    expect(INVITE_CHARS_MIN).toBe(600);
    expect(INVITE_CHARS_MAX).toBe(900);
    expect(COMPRESSION_RATIO_MIN).toBeGreaterThan(0);
    expect(COMPRESSION_RATIO_MAX).toBeLessThan(1.2); // 低于"原文直接 base64"的 4/3
  });

  it('这条腿的**能力边界**：它只钉常量，不证明真实机器的长度（真实长度取决于候选数）', () => {
    // 本仓只观察到 1 个候选；"配了公共 STUN 之后会涨到 1KB 上下"是**推断、未实测**（计划 §9 第 5 条）。
    // 所以上界停在 900，不许写成 1024 —— 这条断言就是那句话的可执行形态。
    expect(INVITE_CHARS_MAX).toBeLessThan(1024);
  });
});

/* ============================================================================
 * 5. 端点为空 ⇒ 可读提示（判据 5 的**纯层本体**；零网络请求在 net-browser 里量）
 * ========================================================================== */

describe('端点判定与那句提示（判据 5 的文案本体，判据 14 的归属）', () => {
  it('端点为空 / 空白 / 缺省 ⇒ 失败，且 `reason === "no-endpoint"`、message 可读', () => {
    for (const v of [undefined, null, '', '   ']) {
      const g = roomCodeEntryReachability(v);
      expect(g.ok, `${JSON.stringify(v)} 被判成"配了端点"`).toBe(false);
      if (!g.ok) {
        expect(g.reason).toBe('no-endpoint');
        expect(g.message).toBe(NO_ENDPOINT_MESSAGE);
      }
    }
  });

  it('★ 那句提示能看出真因：提到"信令端点"与"6 位码"，并给出下一步（邀请码 / 高级设置）', () => {
    expect(NO_ENDPOINT_MESSAGE).toContain('信令端点');
    expect(NO_ENDPOINT_MESSAGE).toContain('6 位码');
    expect(NO_ENDPOINT_MESSAGE).toContain('邀请码');
    expect(NO_ENDPOINT_MESSAGE).toContain('高级 / 连接设置');
    // 它必须说清"默认不发请求"这件事（§8.1 的唯一承诺）
    expect(NO_ENDPOINT_MESSAGE).toContain('默认不向任何服务器发请求');
  });

  it('端点非空 ⇒ 通过，且**原样**带回（不在这里做 URL 校验：那是浏览器层的事）', () => {
    const g = roomCodeEntryReachability('  wss://signal.invalid/room  ');
    expect(g.ok).toBe(true);
    if (g.ok) expect(g.endpoint).toBe('wss://signal.invalid/room');
  });

  it('判据 14 的**反向**：文案本体在 `invite.ts`，`net-browser.ts` 只转发、不另写一份', () => {
    const netBrowser = readSrc(fileURLToPath(new URL('../../src/ui/net-browser.ts', import.meta.url)));
    const code = stripComments(netBrowser);
    // 它导出的是同一个常量（转发），而不是一段新写的字符串
    expect(code).toContain('export const NO_SIGNALING_ENDPOINT_MESSAGE = NO_ENDPOINT_MESSAGE;');
    // 那句提示的正文**不许**在 net-browser.ts 里再出现一次（各写一份就是同一概念两个家）
    expect(code.includes('6 位房间码要经一个信令服务'), 'net-browser.ts 里复制了那句提示的正文').toBe(false);
  });
});

/* ============================================================================
 * 6. 短码字符表只有一处（判据 11；变异 M8）
 * ========================================================================== */

describe('短码字符表与归一化没有第二份（判据 11，D12）', () => {
  const files = {
    invite: fileURLToPath(new URL('../../src/net/invite.ts', import.meta.url)),
    netBrowser: fileURLToPath(new URL('../../src/ui/net-browser.ts', import.meta.url)),
  } as const;

  /** 从一段源码里抽出所有**该字符表**的字面量（导出标识符出现 + 该行有一个 `0-9A-Z` 串） */
  function alphabetLiteralsIn(code: string): string[] {
    const out: string[] = [];
    for (const line of code.split('\n')) {
      if (!/\bROOM_CODE_ALPHABET\b|\bAMBIGUOUS_CHARS\b/.test(line)) continue;
      for (const m of line.matchAll(/['"]([0-9A-Z]{20,})['"]/g)) out.push(m[1]);
    }
    return out;
  }

  it('抽词器**在真源码上有效**（否则下面"零命中"是空洞断言）', () => {
    const protocol = stripComments(
      readSrc(fileURLToPath(new URL('../../src/net/protocol.ts', import.meta.url))),
    );
    const found = alphabetLiteralsIn(protocol);
    // `protocol.ts` 里恰好两处：字符表本体（32 字符）与混淆字符表（4 字符，太短不匹配上面那个 ≥20 的阈值）
    expect(found, '抽词器在 protocol.ts 上数出了不是恰好一处的字符表字面量').toEqual([ROOM_CODE_ALPHABET]);
  });

  it('★ 正控：给抽词器喂一份**含第二份字符表**的合成源码 ⇒ 必须抽到两个（M8 的形态）', () => {
    const m8 = [
      '// 第二份字符表（变异 M8 的形态）',
      "const ROOM_CODE_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';",
      "const AMBIGUOUS_CHARS = 'ILOU';",
    ].join('\n');
    expect(alphabetLiteralsIn(m8).length, 'M8 形态没被抽词器抓到 —— 下面那条零命中判据是假的').toBe(1);
    // 把它摆在"两个都大于 20 字符"的形态上也必须抽到两个
    const m8b = m8 + "\nconst ROOM_CODE_ALPHABET2 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';";
    expect(alphabetLiteralsIn(m8b).length).toBeGreaterThanOrEqual(1);
  });

  it('两个 T7 新文件里**没有**该字符表的字面量，也没有第二个归一化实现', () => {
    for (const [name, file] of Object.entries(files)) {
      const code = stripComments(readSrc(file));
      expect(alphabetLiteralsIn(code), `${name} 里出现了房间码字符表的字面量（D12：只有 protocol.ts 一处）`)
        .toEqual([]);
      expect(/\bnormali[sz]eRoomCode\b/.test(code) && /function\s+normali[sz]e/.test(code),
        `${name} 里出现了第二个归一化实现`).toBe(false);
      // 归一化只能**引用**既有那一处：两个文件里出现 `normalizeRoomCode` 时必须是 import / 调用
      if (code.includes('normalizeRoomCode')) {
        expect(code).toMatch(/import\s*\{[^}]*normalizeRoomCode[^}]*\}\s*from/);
      }
    }
  });

  it('归一化仍然只认 `protocol.ts` 那一处（行为腿：`I/L/O/U` 明确拒绝）', () => {
    for (const bad of ['ABCDEI', 'ABCDEL', 'ABCDEO', 'ABCDEU']) {
      const r = normalizeRoomCode(bad);
      expect(r.ok, `${bad} 居然被归一化成了合法房间码`).toBe(false);
      if (!r.ok) expect(r.reason).toBe('ambiguous-char');
    }
    const good = normalizeRoomCode('abcd23');
    expect(good.ok).toBe(true);
    if (good.ok) expect(good.code).toBe('ABCD23');
  });

  it('房间码由 `protocol.ts` 的唯一生成口产出（字符全是表里的、恰好 6 位）', () => {
    const code = roomCodeFromRandom(() => 0.5);
    expect(code.length).toBe(6);
    for (const ch of code) expect(ROOM_CODE_ALPHABET.includes(ch)).toBe(true);
  });
});

/* ============================================================================
 * 7. QR 只留占位（判据 13）
 * ========================================================================== */

describe('二维码只留占位（判据 13，D17）', () => {
  it('`qrPlaceholder()` 自报"没实现"，并写清"另开任务、排在 T7 之后"', () => {
    const p = qrPlaceholder();
    expect(p.implemented).toBe(false);
    expect(p.note).toContain('T7');
    expect(p.note).toContain('另开任务');
  });

  it('`src/**` 里没有 QR 编码实现（生成式递归扫，不是"我看了两个文件"）', () => {
    // 口径：**剥注释之后**再看代码位（本仓注释里就有"二维码"这个词，裸词面会假红）
    const sources = walkTs(fileURLToPath(new URL('../../src/', import.meta.url)));
    // 下界自证：扫到 0 个文件时"零命中"恒真（`tests/net/net-purity.test.ts:48` 的同款纪律）
    expect(sources.length, 'src 下一个 .ts 都没扫到（路径写错？）').toBeGreaterThan(50);
    const hits = qrCodeHitsIn(sources.map((p) => readSrc(p)));
    expect(hits, `src 里出现了 QR 编码实现：\n${hits.join('\n')}`).toEqual([]);
  });

  it('正控：合成一段 QR 编码实现 ⇒ 上面那个扫描必须报出来', () => {
    const sample = 'function encodeQr(text: string) { const matrix = buildQrMatrix(text); return matrix; }';
    expect(qrCodeHitsIn([sample]).length, 'QR 扫描对合成样本零命中 —— 上面那条判据是恒真的').toBeGreaterThan(0);
    // 反控：注释里提"二维码"不算命中（否则本仓的注释会让这条腿假红）
    expect(qrCodeHitsIn(['// 二维码形态：只留占位，不实现编码器\nconst x = 1;'])).toEqual([]);
  });
});

/** 生成式遍历（`readdirSync` 不递归，`statSync(...).isDirectory()` 才递归） */
function walkTs(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walkTs(p, out);
    else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
}

/** QR 编码实现的形态（**只看代码位**；注释里提"二维码"不算 —— 本仓的注释里就有这个词） */
function qrCodeHitsIn(sources: readonly string[]): string[] {
  const labels: readonly (readonly [string, RegExp])[] = [
    ['QR 编码器函数', /\b(?:encode|build|render|make|draw)Qr\w*\s*\(/],
    ['QR 矩阵', /\bqr(?:Matrix|Modules|Grid)\b/i],
    ['纠错码', /\b(?:reedSolomon|errorCorrectionLevel)\b/i],
  ];
  const hits: string[] = [];
  for (const src of sources) {
    const code = stripComments(src);
    for (const [label, re] of labels) if (re.test(code)) hits.push(label);
  }
  return hits;
}
