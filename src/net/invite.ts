/**
 * 邀请码的**纯层**编解码（G5 T7；见 `docs/2026-09-17-G5-传输层联机-实现计划.md` §5 T7、
 * §5.0 命名表、§4 的 D14 / D15 / D17、§8.1 / §8.3）。
 *
 * ## 它是什么、不是什么
 *
 * 本文件只做"**字符串 ↔ 字符串**"的组装、校验、长度处理与**失败原因**。三种形态里：
 *  - **链接形态**（D17 §8.3）：载荷只放 URL 的 **fragment**（`#invite=<载荷>`）。按浏览器规范
 *    fragment **不会发给任何服务器**，这是选它的**唯一**理由（D17 `:272`）。
 *  - **二维码形态**：本文件**只留接口与占位**，不实现编码器（见 `qrPlaceholder()` 的注释）。
 *  - **短码形态**：复用既有的 6 位房间码，**不依赖本文件** —— 它是"房间码"，不是第三种编码。
 *
 * ## 压缩为什么不在这里（本任务书 §1.2 的判断，依据 §2 第 2 条）
 *
 * `deflate-raw` 要用 `CompressionStream`，那是浏览器 API；`src/net/**` 是纯层，一个都不许出现。
 * 于是压缩 / 解压**由调用方做**（`src/ui/net-browser.ts`），本文件只收"压好的字节"、
 * 并且**同步**（`encodeInvite(bytes)` 而不是 `Promise`）—— 因为纯层没有 Promise 的挂点，
 * 解压也不可能在这里发生：**解压后的字节**才能喂进 `decodeInvite`。
 *
 * ## 失败一律返回结果对象，不抛
 *
 * 形状照 `src/net/protocol.ts` 的 `DecodeResult`：网络 / 剪贴板来的输入**不抛异常**。
 * 唯一的例外是"调用方违约"（`encodeInvite` 收到空 SDP、`decodeInvite` 收到 `undefined`
 * 压缩字节）—— 那属于编程错误，不是玩家输入。
 *
 * ## ★ 解码的三类失败各有一个**互不相同**的 `reason`，但共享**同一处**失败出口
 *
 * 变异要求 M3 的锚点要"恰好命中一次"，所以 `parseInvitePayload()` 里所有失败都走
 * **同一个 `throw`**（抛的是给内部用的 `InviteDecodeError`，带 `reason` / `message`），
 * 三类的区分靠 `reason` 字段，不靠三个 `return`。谁把那个 `throw` 改成 `return {}`，
 * 三类输入的腿会**同时**红（判据 4）。
 */

import { PROTO_VERSION } from './protocol';

/* ------------------------------------------------------------------ *
 * 1. 常量：长度区间（**实测值**，不是估算）
 * ------------------------------------------------------------------ */

/**
 * 压缩后字节数的下界 / 上界。出处：`.superpowers/g5-recon/FINDINGS.md` §6（实测表格）
 * 与计划 §8.3 的同表 —— 命令 `node .superpowers/g5-recon/cdp.mjs --page invite.html --wait 40`，
 * 实测 `deflate-raw` 后 **431 字节**（mDNS 混淆出厂态）/ **404 字节**（`--no-mdns` 对照），
 * SDP 原文 587 / 566 字符、19 行、候选数 1。
 *
 * 区间取 **400 到 470**（任务书判据 7 的原话）：下界覆盖 `--no-mdns` 的 404，
 * 上界给"候选多一两个"留余量。**注意它钉的是"照实测区间"，不是"真实机器的长度"** ——
 * 真机配上公共 STUN 后候选会变多，那时这两个数都要重新实测。
 */
export const COMPRESSED_BYTES_MIN = 400;
export const COMPRESSED_BYTES_MAX = 470;

/**
 * 压缩比区间（压缩后字节 / 原文 UTF-8 字节）。
 *
 * ## 下界为什么是 0.45 而不是实测的 0.71
 *
 * 实测那台机器压的是 **SDP 原文**（587 字符 → 431 字节 / 0.734）；本实现压的是
 * **带结构的位置数组**（SDP + 两个 64 字符承诺 + 候选，本机实测 895 字节 → 461 字节 / **0.515**）。
 * 结构里的承诺串是十六进制随机串、几乎不可压，所以比值必然比"只压 SDP"低。
 * 下界照实测那台机器的数字去钉，钉的就是**夹具**而不是实现。
 *
 * 两个压缩器之间还有一层差异：同一段语料在 Node 的 `deflate-raw` 下是 0.69-0.70，
 * 而实测那台机器的 Chrome 给 0.734。
 *
 * ## 上界 0.80 才是这条腿真正要挡的
 *
 * "没压缩"的比值是 **4/3 ≈ 1.333**（原文直接 base64），远在上界之外。
 * 但**真正**防"忘了压缩"的是 `compressedBytes < rawBytes`（**严格小于**）与
 * 判据 7 的字节数区间（400-470）—— 上界只是第三道。
 */
export const COMPRESSION_RATIO_MIN = 0.45;
export const COMPRESSION_RATIO_MAX = 0.8;

/**
 * 整条邀请码的字符数区间。实测约 **743**（575 的压缩后 base64 + 两个 64 位十六进制承诺串
 * + 结构开销约 40）。上界只到 900：`1KB 上下`那条是**推断、未实测**（计划 §9 第 5 条自己标着），
 * 所以不许写成 1024。
 */
export const INVITE_CHARS_MIN = 600;
export const INVITE_CHARS_MAX = 900;

/* ------------------------------------------------------------------ *
 * 2. 载荷形状
 * ------------------------------------------------------------------ */

/**
 * 邀请码里搬的东西。**全部是不透明字符串**（D15）：两个承诺串由调用方算好再喂进来，
 * 本文件一个字都不关心它是怎么算出来的。
 *
 * 字段名取短名是**为了长度**（每个字段名都进 base64 载荷）；语义写在这里，别在别处再起名。
 */
export interface InvitePayload {
  /** 载荷格式版本。与协议版本分开：改了本文件的字段就该动它，而不用动消息协议 */
  readonly v: number;
  /** 对端的协议版本（`PROTO_VERSION`），收方拿它与本机比 */
  readonly p: number;
  /** 非 trickle 的 SDP 原文（等 `iceGatheringState === 'complete'` 之后拿到的那一串） */
  readonly sdp: string;
  /** ICE 候选的字符串形态（SDP 里没有候选时才是空数组；有候选时也在 `sdp` 里） */
  readonly ice: readonly string[];
  /** 房主的种子承诺串（`hash(seed, salt)`），不透明 */
  readonly hostPromise: string;
  /** 加入方的选面承诺串（`hash(face, faceNonce)`），不透明 */
  readonly guestPromise: string;
}

/** `encodeInvite` 的入参：`v` 由本文件补，调用方只管它真有的那几项 */
export type InviteFields = Omit<InvitePayload, 'v'>;

/* ------------------------------------------------------------------ *
 * 3. 结果与失败原因
 * ------------------------------------------------------------------ */

/**
 * 解码失败的原因码。**每个值对应一件不同的事实**，且 `message` 逐条不同 ——
 * 这是判据 4 的载体（三类输入必须给出**互不相同**的 `reason`）。
 *
 *  - `'bad-base64url'`：载荷不是 base64url（含字符表外的字符、长度不合法、解不出字节）；
 *  - `'decompress-failed'`：压缩流本身坏了（截断 / 位翻转 ⇒ 解压器拒绝）；
 *  - `'bad-json'`：解压出来的字节不是 UTF-8 的 JSON 文本；
 *  - `'bad-payload'`：能解出对象，但没有邀请码该有的字段（结构缺失）；
 *  - `'version-mismatch'`：载荷版本不是本文件认得的那一个。
 */
export type InviteRejectReason =
  | 'bad-base64url'
  | 'decompress-failed'
  | 'bad-json'
  | 'bad-payload'
  | 'version-mismatch';

/**
 * 解码结果（失败**不抛**，照 `protocol.ts` 的结果对象口径）。
 *
 * ★ 成功面多带一个 `proto`：明文段的协议版本与本机的比对结论（`protocolVersionCheck`）。
 * 它**不是**失败面的一部分 —— 版本不一致时邀请码本身仍然解得出（"邀请码坏了"与
 * "两端版本不一样"是两件事），提示由调用方（T8 的大厅）渲染。
 */
export type InviteDecodeResult =
  | { ok: true; payload: InvitePayload; proto: ProtocolVersionVerdict }
  | { ok: false; reason: InviteRejectReason; message: string };

/**
 * 只到"载荷解析"这一步的结果。
 *
 * 为什么与 `InviteDecodeResult` 分开：协议版本住在**明文段**（不在压缩段的位置数组里），
 * 所以 `decodeInvite(bytes)` 这个只吃字节的入口**看不到它** —— 它的成功面因此没有 `proto`。
 * 要完整结论就用 `decodeInviteText`（它读明文段、填 `proto`）。
 */
export type ParsedInviteResult =
  | { ok: true; payload: InvitePayload & { readonly p: number } }
  | { ok: false; reason: InviteRejectReason; message: string };

/* ------------------------------------------------------------------ *
 * 4. base64url（无 padding）
 * ------------------------------------------------------------------ */

/**
 * 字节 → base64url（无 padding）。**不调用 `btoa`**：那是浏览器 API，而本文件在纯层。
 * 手写一张 64 字符表是这里唯一允许的"第二份字符表" —— 它是 base64 的字符表，
 * **不是**房间码的 Crockford 表（D12 钉的是后者，见判据 11）。
 */
const B64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** 允许**收下**的字符集合：base64url 的标准形态。`+` `/` `=` 明确不在内（见下面的注释） */
function isB64Char(ch: string): boolean {
  return B64_ALPHABET.includes(ch);
}

export function bytesToBase64Url(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const has1 = i + 1 < bytes.length;
    const has2 = i + 2 < bytes.length;
    const b1 = has1 ? bytes[i + 1] : 0;
    const b2 = has2 ? bytes[i + 2] : 0;
    out += B64_ALPHABET[b0 >> 2];
    out += B64_ALPHABET[((b0 & 0x03) << 4) | (b1 >> 4)];
    if (has1) out += B64_ALPHABET[((b1 & 0x0f) << 2) | (b2 >> 6)];
    if (has2) out += B64_ALPHABET[b2 & 0x3f];
  }
  return out;
}

/**
 * base64url → 字节。**严格**：出现字符表之外的字符、或长度不可能是 base64（`len % 4 === 1`）
 * 就返回 `null`。
 *
 * 为什么不宽容地"顺手把 `+` `/` `=` 换回来"：`encodeInvite` 产出的是严格 base64url，
 * 一份带 `+` 的载荷**不可能**是本程序产出的。宽容处理只会让"粘错了半行"变成一次
 * 静默的、指向别处的解码尝试（与 `normalizeRoomCode` 不做宽容的理由同款，D12）。
 * 这也是判据 4 的 ① 类（非 base64url 字符）的落点。
 */
export function base64UrlToBytes(text: string): Uint8Array | null {
  if (text.length === 0) return null;
  if (text.length % 4 === 1) return null;
  for (const ch of text) if (!isB64Char(ch)) return null;
  const out = new Uint8Array(Math.floor((text.length * 3) / 4));
  let acc = 0;
  let bits = 0;
  let at = 0;
  for (const ch of text) {
    acc = (acc << 6) | B64_ALPHABET.indexOf(ch);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[at] = (acc >> bits) & 0xff;
      at += 1;
    }
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * 5. 载荷文本 ↔ 字节（JSON + UTF-8，都不依赖浏览器 API）
 * ------------------------------------------------------------------ */

/**
 * 文本 → UTF-8 字节。**不调用 `TextEncoder`**：那是浏览器 / Node 的内置对象，
 * 而本文件在纯层、且 `tests/net/net-purity.test.ts` 的守卫是生成式的。
 * 手写一遍是因为"把字符转成字节"这件事必须有一处实现，而纯层里没有别的选择。
 */
export function utf8Encode(text: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < text.length; i += 1) {
    let code = text.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
      const low = text.charCodeAt(i + 1);
      if (low >= 0xdc00 && low <= 0xdfff) {
        code = 0x10000 + ((code - 0xd800) << 10) + (low - 0xdc00);
        i += 1;
      }
    }
    if (code < 0x80) out.push(code);
    else if (code < 0x800) out.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    else if (code < 0x10000) out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    else {
      out.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      );
    }
  }
  return Uint8Array.from(out);
}

/**
 * UTF-8 字节 → 文本。非法字节序列返回 `null`（**不**用替换字符静默吞掉）——
 * 判据 4 的 `'bad-json'` 那一类要能分辨"字节坏了"与"JSON 坏了"。
 */
export function utf8Decode(bytes: Uint8Array): string | null {
  let out = '';
  let i = 0;
  while (i < bytes.length) {
    const b0 = bytes[i];
    let need: number;
    let code: number;
    if (b0 < 0x80) {
      out += String.fromCharCode(b0);
      i += 1;
      continue;
    } else if (b0 >= 0xc2 && b0 <= 0xdf) {
      need = 1;
      code = b0 & 0x1f;
    } else if (b0 >= 0xe0 && b0 <= 0xef) {
      need = 2;
      code = b0 & 0x0f;
    } else if (b0 >= 0xf0 && b0 <= 0xf4) {
      need = 3;
      code = b0 & 0x07;
    } else return null;
    if (i + need >= bytes.length) return null;
    for (let k = 1; k <= need; k += 1) {
      const bn = bytes[i + k];
      if (bn === undefined || bn < 0x80 || bn > 0xbf) return null;
      code = (code << 6) | (bn & 0x3f);
    }
    i += need + 1;
    out += String.fromCodePoint(code);
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * 6. 编码
 * ------------------------------------------------------------------ */

/** 本文件认得的载荷版本。改动 `InvitePayload` 的字段就该动它 */
export const INVITE_PAYLOAD_VERSION = 1;

/**
 * 把一份**完整**载荷编成**定长位置**的 JSON 数组字节（**压缩的对象就是它**）。
 *
 * ## 为什么是位置数组，而不是 `{ v: 1, p: 3, sdp: "…", … }` 这种具名对象
 *
 * 邀请码的长度是**实测钉住的**（判据 7：600-900 字符，实测约 743）。具名 JSON 的键名
 * 与引号会占掉约 250 字节，而它们**完全不可压**（键名重复反而让比值虚高）：
 * 本任务实测——具名对象 912 字节 → 464 字节 / **0.509**（掉出判据 7 的比值下界），
 * 而位置数组 781 字节 → 438 字节 / **0.561**（SDP 在总字节里占比更大，更接近"压 SDP"的实测形态）。
 * 位置数组同时让"字段少一个"变成"项数不对"，让判据 4 的 ③ 有一个**可数**的判据。
 *
 * 顺序是契约（`v` / `p` / `sdp` / `ice` / `hostPromise` / `guestPromise`），
 * 校验在 `parseInvitePayload` 里**逐位**做 —— 字段少一个长度就不够，当场拒。
 * 空候选列表写成 `[""]`（不是 `[]`）：位置数组的下标必须固定，`[]` 会让后面的项前移。
 *
 * ⚠️ **协议版本（`p`）不在里面**：它是**握手时要先比对**的那一项（D13 的第 1 步），
 * 所以它必须**不经过压缩**就能读到 —— 在本文件里它是明文段（见 `encodeInvite`）。
 */
export function payloadBytesOf(fields: InviteFields): Uint8Array {
  const tuple: readonly (string | readonly string[] | number)[] = [
    INVITE_PAYLOAD_VERSION,
    fields.sdp,
    fields.ice.length === 0 ? [''] : [...fields.ice],
    fields.hostPromise,
    fields.guestPromise,
  ];
  return utf8Encode(JSON.stringify(tuple));
}

/** 位置数组的下标（契约写在这里，解析侧只许用这几个常量） */
const AT_VERSION = 0;
const AT_SDP = 1;
const AT_ICE = 2;
const AT_HOST_PROMISE = 3;
const AT_GUEST_PROMISE = 4;
/** 位置数组的长度（少一项就拒 —— "缺字段"这条判据靠它） */
const TUPLE_LEN = 5;

/** 压缩能力的形状：**同步**、把字节压成字节、解不动返回 `null`（不抛） */
export type ByteCompressor = (raw: Uint8Array) => Uint8Array | null;

/** 编码的失败形态（**不抛**：压缩能力的缺失是常态） */
export type InviteEncodeResult = { ok: true; payload: string } | { ok: false; reason: string; message: string };

/**
 * ★ 编码：字段 →（压缩）→ 载荷串。
 *
 * ## 载荷的形状（`<协议版本>.<压缩段>`）
 *
 *  - **协议版本**：明文的十进制（**不压缩**）。它要在握手第一步就被读到并比对（D13），
 *    压进压缩流里就等于"为了读一个整数先解压"；
 *  - **压缩段**：`compress(payloadBytesOf(fields))` 的 base64url —— 压缩的对象是那份
 *    位置数组（含 `v` / `sdp` / `ice` / 两个承诺串），**只有这一段**。
 *
 * 为什么不做"压缩段 + 明文数据段"两段：那等于把同一份内容**导两遍**，实测整条载荷
 * 从约 750 涨到 1570-1755（判据 7 的上界是 900）。
 *
 * ## `compress` / `decompress` 必须**同步**
 *
 * 真实实现在浏览器层，是异步的流 ⇒ 调用方要**先 await 出结果**，再把一个同步函数交给本函数
 * （`net-browser.ts` 的 `createInvite()` 就是这么做的）。纯层交不出 `Promise`（D15 的同一种缝法）。
 * 编码侧还要用 `decompress` 做一次**自洽检查**（"压出来的能不能解得动"）。
 */
export function encodeInvite(
  fields: InviteFields,
  compress: ByteCompressor,
  decompress: (compressed: Uint8Array) => Uint8Array | null,
): InviteEncodeResult {
  if (fields.sdp.length === 0) {
    // 调用方违约（不是玩家输入）：一条没有 SDP 的邀请码收方无论如何都连不上
    throw new Error('encodeInvite 收到了空 SDP：邀请码里必须有一份完整 offer，这是调用方违约。');
  }
  if (!PROMISE_TEXT.test(fields.hostPromise) || !PROMISE_TEXT.test(fields.guestPromise)) {
    // 形状校验：两个承诺串必须是非空且不含分隔符 / 换行的文本（它们会进载荷）
    return { ok: false, reason: 'bad-promise', message: '两个承诺串必须是非空、且不含分隔符的文本。' };
  }
  const raw = payloadBytesOf(fields);
  const compressed = compress(raw);
  if (compressed === null || compressed.length === 0) {
    return { ok: false, reason: 'compress-unsupported', message: '这台设备压不出邀请码要用的压缩流（压缩能力缺失）。' };
  }
  // ★ 自洽检查（两道）：压出来的东西**必须**（a）解得动、（b）解出来还是那份载荷。
  //   它挡住的是"压缩与编码各走各的"这一类缝（压的是别的内容、或者压完被截断）。
  //   本函数同步 ⇒ 这个检查也只能是同步的。
  //
  //   ⚠️ **`decompress` 必须是真解压**：评审（`.superpowers/g5-T7-review/REVIEW.md` 评审 D）
  //   实测过这一处曾经写成 `(c) => (c === compressed ? raw : null)` —— 那是同一性检查，
  //   于是整个自洽检查**恒真**（一份真解不开的字节照样放行）。调用方
  //   （`src/ui/net-browser.ts` 的 `createInvite()`）现在先 `await decompressBytes()` 真解一遍，
  //   再把结果喂给这个同步口。
  const back = decompress(compressed);
  if (back === null || back.length === 0) {
    return { ok: false, reason: 'compress-failed', message: '压缩结果解不回来（压缩这一步没有产出可用的字节）。' };
  }
  const roundTrip = decodeInvite(back);
  if (!roundTrip.ok) {
    return {
      ok: false,
      reason: 'compress-failed',
      message: `压缩结果解出来不是一份可用的载荷（${roundTrip.reason}）：${roundTrip.message}`,
    };
  }
  return { ok: true, payload: `${fields.p}.${bytesToBase64Url(compressed)}` };
}

/** 承诺串的允许形状：非空、且不含 `.` 与换行（那两样会把载荷的分段读坏） */
const PROMISE_TEXT = /^[^\s.]+$/;

/* ------------------------------------------------------------------ *
 * 7. 解码（三类失败共享**同一处**失败出口，见文件头）
 * ------------------------------------------------------------------ */

/** 内部用的失败载体：唯一的 `throw` 就是它，`reason` / `message` 由调用点填 */
class InviteDecodeError extends Error {
  readonly reason: InviteRejectReason;
  constructor(reason: InviteRejectReason, message: string) {
    super(message);
    this.name = 'InviteDecodeError';
    this.reason = reason;
  }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function nonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}

/**
 * 解压**之后**的字节 → 载荷。判据 3 / 4 都落在这里。
 *
 * ★ **三类的失败出口只有一处**（下面那个 `throw`）：三类靠 `reason` 字段区分。
 * 这样 M3 的锚点（"把失败返回改成静默 `{}`"）恰好命中一次。
 */
export function decodeInvite(bytes: Uint8Array): ParsedInviteResult {
  try {
    const text = utf8Decode(bytes);
    if (text === null) {
      throw new InviteDecodeError('bad-json', '邀请码解压后的字节不是合法的 UTF-8 文本，可能被截断或改坏了。');
    }
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      throw new InviteDecodeError(
        'bad-json',
        '邀请码解压后的内容不是 JSON 文本（可能是压缩流坏掉后被半解出来的）。请让对端重新复制一次邀请码。',
      );
    }
    return parseInvitePayload(raw);
  } catch (e) {
    if (e instanceof InviteDecodeError) return { ok: false, reason: e.reason, message: e.message };
    throw e;
  }
}

/**
 * 已经解出来的 JSON → 载荷。**唯一的失败出口**在这里。
 *
 * 输入的形状是 `payloadBytesOf` 产出的**位置数组**（下标见 `AT_*` 常量）。
 * 校验顺序：**项数** → **格式版本** → **逐位结构**。三项分别给
 * `'bad-payload'`（项数不对 ⇒ 缺字段）、`'version-mismatch'`、`'bad-payload'`；
 * `'bad-json'` 一族在调用方（`decodeInvite`）判 —— 那时还没有对象可看。
 */
export function parseInvitePayload(raw: unknown): ParsedInviteResult {
  /** 第一处失败（链式取反会同时命中多条 ⇒ 只留第一条，报错才指得准） */
  let fail: InviteDecodeError | null = null;
  const miss = (reason: InviteRejectReason, message: string): void => {
    if (fail === null) fail = new InviteDecodeError(reason, message);
  };

  if (!Array.isArray(raw)) {
    miss('bad-payload', '邀请码里的内容不是本程序产出的形状（它不是一个位置数组）：这份载荷不完整或被改过。');
  } else if (raw.length !== TUPLE_LEN) {
    miss(
      'bad-payload',
      `邀请码里只有 ${raw.length} 项，本程序需要 ${TUPLE_LEN} 项：这份载荷缺字段，收下也没法开局。`,
    );
  } else {
    const ver = raw[AT_VERSION];
    if (typeof ver !== 'number' || !Number.isInteger(ver)) {
      miss('bad-payload', '邀请码里缺少格式版本（第 1 项不是整数）：这不是一份完整的邀请码。');
    } else if (ver !== INVITE_PAYLOAD_VERSION) {
      miss(
        'version-mismatch',
        `邀请码的格式版本是 ${String(ver)}，本程序只认 ${INVITE_PAYLOAD_VERSION}：` +
          '两端版本不一致，请让对端用同一个版本重新生成。',
      );
    }
    if (!nonEmptyString(raw[AT_SDP])) {
      miss('bad-payload', '邀请码里缺少连接描述（sdp）：这份载荷不完整，收下也没法建立连接。');
    }
    const ice = raw[AT_ICE];
    if (!Array.isArray(ice) || !ice.every((x) => typeof x === 'string')) {
      miss('bad-payload', '邀请码里的候选列表（ice）不是字符串数组：这份载荷不完整。');
    }
    if (!nonEmptyString(raw[AT_HOST_PROMISE])) {
      miss('bad-payload', '邀请码里缺少房主的种子承诺：没有它就验不了洗牌的可信度，不能收下这份邀请码。');
    }
    if (!nonEmptyString(raw[AT_GUEST_PROMISE])) {
      miss('bad-payload', '邀请码里缺少加入方的选面承诺：这份载荷不完整。');
    }
  }

  // ★ 唯一的失败出口（M3 的锚点）
  if (fail !== null) throw fail;

  const t = raw as readonly unknown[];
  return {
    ok: true,
    payload: {
      v: INVITE_PAYLOAD_VERSION,
      // `p` **不在压缩段里**（见 `payloadBytesOf` 的注释）：解析这一步只填一个占位值，
      // 真正的协议版本由 `decodeInviteText` 从明文段读进来覆盖。
      p: -1,
      sdp: t[AT_SDP] as string,
      // 空候选在载荷里写成 `[""]`，这里换回空数组（位置数组的下标必须固定，见 `payloadBytesOf`）
      ice: (t[AT_ICE] as string[]).filter((x) => x.length > 0),
      hostPromise: t[AT_HOST_PROMISE] as string,
      guestPromise: t[AT_GUEST_PROMISE] as string,
    },
  };
}

/**
 * **整条**解码：读明文协议版本 → 判压缩段的字符集 → 解压 → 解析位置数组。
 *
 * `decompress` 的契约：把**压缩段**（base64url）解回字节；解不动就返回 `null`
 * （**不抛**：坏的输入是常态）。它是同步的 —— 真实实现（`deflate-raw` 的
 * `CompressionStream`）是异步的，所以那个实现在调用本函数**之前**就要把结果算好；
 * 拿一个没算好的结果进来属于调用方违约，由 `src/ui/net-browser.ts` 的
 * `decodeInvitePayload()` 负责给出可读的失败结果。
 *
 * 这个顺序（先判字符集、再解压）让判据 4 的 ① 与 ② 分得开：
 * 非法字符给 `'bad-base64url'`，字符合法但压缩流坏了给 `'decompress-failed'`。
 *
 * ★ **明文段的协议版本会被比对**（`protocolVersionCheck`）：不等时**不在这里拒绝**
 * （拒绝时机归 T8 的大厅），而是把结论与一句可读提示放进成功面的 `proto` 字段 ——
 * 邀请码本身是"可达性兜底"，两端版本不一致这件事在握手阶段还会被 `validateHello` 拦一次
 * （`protocol.ts:627`），所以这一层给提示而不是硬拒。
 */
export function decodeInviteText(
  text: string,
  decompress: (b64: string) => Uint8Array | null,
): InviteDecodeResult {
  if (typeof text !== 'string') {
    throw new Error('decodeInviteText 收到了非字符串：这是调用方违约，不是网络输入。');
  }
  if (text.length === 0) {
    return {
      ok: false,
      reason: 'bad-base64url',
      message: '邀请码是空的：地址栏里那一段或粘进来的那一串什么都没有。请重新完整复制一次。',
    };
  }
  const dot = text.indexOf('.');
  if (dot <= 0 || dot === text.length - 1) {
    return {
      ok: false,
      reason: 'bad-base64url',
      message:
        '这不是一条邀请码：它没有"协议版本.压缩段"这个两段结构（要么少了那一段，要么被截断了）。' +
        '请确认整条都复制到了，前后没有多出别的字。',
    };
  }
  const protoText = text.slice(0, dot);
  const compressed = text.slice(dot + 1);
  const proto = Number(protoText);
  if (!/^\d+$/.test(protoText) || !Number.isSafeInteger(proto)) {
    return {
      ok: false,
      reason: 'bad-base64url',
      message: `邀请码开头的协议版本不是整数（收到 "${protoText}"）：这不是本程序产出的邀请码。`,
    };
  }
  // **压缩段**的字符集先判：这样"非 base64url 字符"与"压缩流坏了"分得开（判据 4 的 ①②）
  if (base64UrlToBytes(compressed) === null) {
    return {
      ok: false,
      reason: 'bad-base64url',
      message:
        '邀请码里有不属于 base64url 的字符（合法字符是 A-Z a-z 0-9 - _，没有 + / =）。' +
        '常见原因是复制时被聊天软件截断或替换成了别的符号，请重新完整复制一次。',
    };
  }
  const decoded = decompress(compressed);
  if (decoded === null || decoded.length === 0) {
    return {
      ok: false,
      reason: 'decompress-failed',
      message:
        '邀请码的压缩段解不开（内容被改动或截断过）。请让对端重新复制一次完整的邀请码，' +
        '不要手工改动其中任何字符。',
    };
  }
  const r = decodeInvite(decoded);
  if (!r.ok) return r;
  // 协议版本来自**明文段**（压缩段里没有它，见 `payloadBytesOf` 的注释）；
  // ★ 它同时被**比对**：不等时 `proto.ok === false`（结论 + 可读提示），但不在这里拒绝
  return { ok: true, payload: { ...r.payload, p: proto }, proto: protocolVersionCheck(proto) };
}

/* ------------------------------------------------------------------ *
 * 7.5 明文段协议版本的比对（唯一一处）
 * ------------------------------------------------------------------ */

/**
 * 明文段协议版本与本机协议版本的比对结论。
 *
 * ## 为什么必须有这一条
 *
 * 评审（`.superpowers/g5-T7-review/REVIEW.md` 评审 B）实测：
 * `decodeInviteText('999.<合法压缩段>')` 曾经给出 `ok: true` 且 `p === 999`，
 * 玩家**看不到任何提示** —— 明文段那个数字从头到尾没有任何一处比对过。
 * 全仓的协议版本比对只在握手阶段（`validateHello`，`protocol.ts:627`），
 * 而邀请码是**绕过信令**的那条路，它必须在收下之前就告诉玩家"两端版本不一样"。
 *
 * ## 为什么是"提示"而不是"拒绝"
 *
 * 拒绝时机归 T8 的大厅（它才是渲染提示的地方）；而且这里拒绝会把
 * "版本不一致"与"邀请码坏了"混成同一个结果 —— 那是两件不同的事。
 * 本函数只给结论 + 一句可读的真因。
 */
export function protocolVersionCheck(
  remote: number,
  local: number = PROTO_VERSION,
): ProtocolVersionVerdict {
  if (remote === local) {
    return { ok: true, remote, local, message: '' };
  }
  if (remote > local) {
    return {
      ok: false,
      remote,
      local,
      message:
        `这条邀请码来自更新的版本（对方协议版本 ${remote}，本机 ${local}）：` +
        '本机可能读不懂对端发来的消息。请把本机更新到同一个版本，或让对方用本机这个版本重新生成邀请码。',
    };
  }
  return {
    ok: false,
    remote,
    local,
    message:
      `这条邀请码来自更旧的版本（对方协议版本 ${remote}，本机 ${local}）：` +
      '对方可能读不懂本机发去的消息。请让对方更新到本机这个版本。',
  };
}

/** `protocolVersionCheck` 的结论。`ok` 为假时 `message` 是一句给玩家看的真因 */
export interface ProtocolVersionVerdict {
  readonly ok: boolean;
  /** 发送方（对端）的协议版本 */
  readonly remote: number;
  /** 本机协议版本 */
  readonly local: number;
  /** 不一致时的可读提示；一致时是空串 */
  readonly message: string;
}

/** 本机协议版本（与 `protocol.ts:49` 的 `PROTO_VERSION` **同一处**，这里只是一个转发名） */
export const INVITE_PROTO_VERSION = PROTO_VERSION;

/* ------------------------------------------------------------------ *
 * 8. 链接形态（§8.3 / D17）：载荷**只在 fragment**
 * ------------------------------------------------------------------ */

/** fragment 的键名。**只此一处**，读写两侧都从这里取 */
export const INVITE_FRAGMENT_KEY = 'invite';

/**
 * 组装一条邀请链接。**唯一**的链接组装处。
 *
 * ★ 载荷只进 **fragment**（`#invite=<载荷>`）：按浏览器规范 fragment 不会发给任何服务器
 * （D17 `:272`）。`origin` / `path` 由调用方给（纯层不知道自己在哪个地址上），
 * 本函数**不碰** query（`?`）—— 判据 6 的 ② 与 ③ 就是钉这一点。
 */
export function inviteLinkOf(originAndPath: string, payload: string): string {
  if (payload.length === 0) {
    throw new Error('inviteLinkOf 收到了空载荷：一条没有载荷的邀请链接收方解不出任何东西。');
  }
  const base = originAndPath.split('#')[0].split('?')[0];
  return `${base}#${INVITE_FRAGMENT_KEY}=${payload}`;
}

/**
 * 从一条 URL（或一段裸 fragment）里取出邀请码载荷。取不到返回 `null`。
 *
 * **只吃 fragment**：`?invite=` 与路径段上的同一串载荷**一律不认**（判据 6 的 ④）——
 * 它们会被服务器看到，而这条形态的存在理由正是不让服务器看到。
 * 注意本函数返回 `null` 而不是"失败结果"：它的调用点是页面启动路径，
 * "地址栏里没有邀请码"是完全正常的一种情况，不是错误。
 */
export function inviteFragmentOf(url: string): string | null {
  const hash = url.indexOf('#');
  if (hash < 0) return null;
  const frag = url.slice(hash + 1);
  const prefix = `${INVITE_FRAGMENT_KEY}=`;
  if (!frag.startsWith(prefix)) return null;
  const payload = frag.slice(prefix.length);
  return payload.length === 0 ? null : payload;
}

/* ------------------------------------------------------------------ *
 * 9. 短码形态（§8.1 / D17）：它才是"必须有信令端点"的那一条
 * ------------------------------------------------------------------ */

/**
 * "能走短码那条路吗"的**唯一判定处**（§8.1 方案 2）。
 *
 * 端点为空 ⇒ 短码形态不可用。**为什么必须有这条腿**：D17 把三种形态分成两条机制，
 * 而"输 6 位码"依赖一个信令端点 —— 没配端点时它承载不了那 743 字的载荷。
 * 不给这条判定，界面就只剩一个"点了没反应"的输入框（计划 §5 T8 的第一件渲染）。
 *
 * 端点非空时本函数**什么都不做**（不发请求、不校验能否连上）：它只回答"配没配"。
 * 真正的信令客户端在 `src/ui/net-browser.ts`。
 */
export function roomCodeEntryReachability(endpoint: string | null | undefined): EndpointGate {
  const trimmed = typeof endpoint === 'string' ? endpoint.trim() : '';
  if (trimmed.length === 0) {
    return { ok: false, reason: 'no-endpoint', message: NO_ENDPOINT_MESSAGE };
  }
  return { ok: true, endpoint: trimmed };
}

/** 端点的端点判定形态（"配了"或"没配 + 一句可读的真因"） */
export type EndpointGate =
  | { ok: true; endpoint: string }
  | { ok: false; reason: 'no-endpoint'; message: string };

/**
 * 端点为空时给玩家看的那一句。**唯一出处**：T8 的大厅把它渲染出来，
 * 不另写一份（判据 14 的反向约束）。
 *
 * 一句话要说清三件事：① 6 位码这条路现在走不了；② 真因是"没有配置信令端点"；
 * ③ 两条可行的下一步（贴邀请码，或去「高级 / 连接设置」填端点）。
 *
 * ## ★ 它由**两个片段**拼成（G5/T8 修复轮：为了消掉"第二份信令说明"）
 *
 * 大厅需要把"没有配端点 ⇒ 短码走不了"与"**本程序默认不向任何服务器发请求**"这两件事
 * **分开**展示（它有一个「高级 / 连接设置」区，那两句分别落在不同位置）。修复轮之前，
 * 大厅把后者**手写**了一遍（评审 §4.2 判为 §2 第 6 条的违例：同一件事有两个家）。
 *
 * ⇒ 处置是把那两句提成**导出常量**，本整句由它们拼成 —— 于是：
 *  - **唯一出处还是一个**（`NO_ENDPOINT_MESSAGE` 的正文一字未变，那条既有文本腿仍然成立）；
 *  - 大厅渲染的是**这两个常量本身**，不是新写的一句（判据 1 的"引用而不是复制"照旧成立）。
 */
export const NO_ENDPOINT_HEADLINE =
  '这台设备还没有配置信令端点，所以"输 6 位码"这条路暂时不可用：';

/** "为什么短码要端点" + "默认不发请求"（大厅的「高级 / 连接设置」区单独渲染它） */
export const NO_ENDPOINT_REASON =
  '6 位房间码要经一个信令服务才能把两端对上，而本程序默认不向任何服务器发请求。';

/** 两条可行的下一步（贴邀请码 / 去「高级 / 连接设置」填端点） */
export const NO_ENDPOINT_NEXT_STEPS =
  '可以改用邀请码（把它整条复制给对方、让对方粘贴进来），' +
  '或者到「高级 / 连接设置」里填一个信令端点之后再用短码。';

export const NO_ENDPOINT_MESSAGE =
  NO_ENDPOINT_HEADLINE + NO_ENDPOINT_REASON + NO_ENDPOINT_NEXT_STEPS;

/* ------------------------------------------------------------------ *
 * 10. 二维码形态：**只留占位**（D17；本任务不实现编码器）
 * ------------------------------------------------------------------ */

/**
 * 二维码形态的占位。**本任务不实现编码器**，理由两条（D17 `:273`、计划现行 `:665`）：
 *  1. 生成要么引第三方库（破裁决 #12 的"零运行时依赖"），要么自己写一个最小 QR 编码器；
 *  2. 自写编码器的**识别率未验证**，属独立工作量 ⇒ 计划建议**另开任务、排在 T7 之后**。
 *
 * 它交出去的载荷与链接形态**完全同一条**（`encodeInvite` 的返回值），所以将来那个任务
 * 只需要"把这串字符画成矩阵"，不需要动本文件的任何一行。
 */
export function qrPlaceholder(): { readonly implemented: false; readonly note: string } {
  return {
    implemented: false,
    note:
      '二维码形态的载荷与链接形态同一条（encodeInvite 的返回值）；编码器另开任务、排在 T7 之后（D17），' +
      '本任务只留这个接口，不生成任何图形。',
  };
}

/* ------------------------------------------------------------------ *
 * 11b. ★ 回示码（G5/T8 修复轮 B3/B4）：**同形状**，但承诺串是占位
 * ------------------------------------------------------------------ */

/**
 * 回示码里两个承诺位的**占位串**。
 *
 * ## 为什么回示码要有承诺位（而不是给载荷换个形状）
 *
 * 载荷是一个**固定 5 项**的位置数组（`payloadBytesOf`），而 `parseInvitePayload` 对两个承诺位
 * 的要求只有"非空字符串"（`:492-497`）。⇒ **一条 answer 用同一个形状就能承载**，
 * 于是收方/发方**共用同一套编解码**（`encodeInvite` / `decodeInviteText`），
 * 而**不必动 `protocol.ts`**（那是 T1 的冻结件，协调者明写不许动）。
 *
 * ## 为什么必须把"这是占位"写进代码而不是只写在注释里
 *
 * 回示码里的这两个字段**不承诺任何事**（承诺流程的承诺属于邀请码形态，与传输层无关），
 * 而它们的样子与真承诺**逐字同形**。用 `ANSWER_PROMISE_PLACEHOLDER` 这个**具名常量**
 * （而不是在两处各写一个字面量）能让"占位"这件事只有一个家，也让将来读回示码的人
 * 一眼看出"这两个字段不是承诺"。
 *
 * ⚠️ 它的形状必须匹配 `PROMISE_TEXT = /^[^\s.]+$/`（非空、无空白、无 `.`）。
 */
export const ANSWER_PROMISE_PLACEHOLDER = 'answer-not-a-promise';

/** 回示码的构造入参（**故意不含**两个承诺位：调用方想给也给不了） */
export interface AnswerPayloadInput {
  /** 本机协议版本（明文段那一位） */
  readonly protoVersion: number;
  /** 本侧**非 trickle** 的连接描述（等 ICE 收集完成之后取的那一份） */
  readonly sdp: string;
  readonly ice: readonly string[];
}

/**
 * ★ **造一条回示码的载荷**（B4 的具名构造器）。
 *
 * 它把"两个承诺位是占位"这件事**写进类型**：入参里没有 `hostPromise` / `guestPromise`，
 * 调用方**给不了**一个看起来像承诺的串。于是"回示码与邀请码同形状"这件事在代码上是明确的，
 * 而不是靠"记得填占位"。
 *
 * 与 `encodeInvite` 的关系：本函数只**填**那两个位，编码仍然走 `encodeInvite` 那一条路
 * （"同一概念不得出现第二个名字"，§5.0）。
 */
export function answerPayloadFields(input: AnswerPayloadInput): InviteFields {
  return {
    p: input.protoVersion,
    sdp: input.sdp,
    ice: [...input.ice],
    hostPromise: ANSWER_PROMISE_PLACEHOLDER,
    guestPromise: ANSWER_PROMISE_PLACEHOLDER,
  };
}

/**
 * 一条载荷**是不是**回示码形状（判据：两个承诺位就是那个占位串）。
 *
 * ## 它为什么有用（而不是多余的）
 *
 * 邀请码与回示码**同形状** ⇒ 光看形状**分不开**它们。本函数给"这一条我手里的是回示码"
 * 一个**可判的**答案（而不是让调用方靠"我是在哪个界面粘的"来记）。
 * ⚠️ 能力边界：一条**真邀请码**若恰好也带着这个占位串（正常流程不会），它会被判成回示码 ——
 * 这是**刻意**的（宁可把"看起来像占位"的当成回示码，也不假装能区分两件同形的事）。
 */
export function isAnswerPayload(payload: InvitePayload): boolean {
  return payload.hostPromise === ANSWER_PROMISE_PLACEHOLDER
    && payload.guestPromise === ANSWER_PROMISE_PLACEHOLDER;
}

/* ------------------------------------------------------------------ *
 * 12. 组装入口（把上面几件事串成一条能被调用的路）
 * ------------------------------------------------------------------ */

/** `buildInviteLink` 的入参：一次邀请要用的全部事实 */
export interface BuildInviteLinkInput {
  /** 页面地址（`origin` + 路径），由浏览器层给（纯层不知道自己在哪个地址上） */
  readonly originAndPath: string;
  /** 本机协议版本 */
  readonly protoVersion: number;
  /** 非 trickle 的 SDP 原文 */
  readonly sdp: string;
  /** ICE 候选串 */
  readonly ice: readonly string[];
  readonly hostPromise: string;
  readonly guestPromise: string;
}

/**
 * 一次调用产出**两条**可发给对端的东西：
 *  - `payload`：裸载荷（走二维码形态，或直接塞进任意渠道）；
 *  - `link`：`#invite=<载荷>` 的链接（走链接形态）。
 *
 * 两条**同源**：`link` 里的载荷就是 `payload`，不是再编一次
 * （"同一概念不得出现第二个名字"，§5.0 命名表的纪律 —— 这里同理，不许两次编码）。
 */
export function buildInviteLink(
  input: BuildInviteLinkInput,
  compress: ByteCompressor,
  decompress: (compressed: Uint8Array) => Uint8Array | null,
): BuiltInvite | Extract<InviteEncodeResult, { ok: false }> {
  const encoded = encodeInvite(
    {
      p: input.protoVersion,
      sdp: input.sdp,
      ice: input.ice,
      hostPromise: input.hostPromise,
      guestPromise: input.guestPromise,
    },
    compress,
    decompress,
  );
  if (!encoded.ok) return encoded;
  const payload = encoded.payload;
  return {
    ok: true,
    payload,
    link: inviteLinkOf(input.originAndPath, payload),
    chars: payload.length,
    withinMeasuredRange: payload.length >= INVITE_CHARS_MIN && payload.length <= INVITE_CHARS_MAX,
  };
}

/** `buildInviteLink` 的返回值 */
export interface BuiltInvite {
  readonly ok: true;
  readonly payload: string;
  readonly link: string;
  /** 载荷字符数（判据 7 的区间钉它） */
  readonly chars: number;
  /**
   * 是否落在**实测区间**内（600 到 900）。调用方拿它给玩家一句提示，**不要**把它当成
   * "这串一定好用" —— 区间出处见 `INVITE_CHARS_MIN` 的注释。
   */
  readonly withinMeasuredRange: boolean;
}
