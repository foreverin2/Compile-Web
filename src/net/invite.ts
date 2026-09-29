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
 * 1b. ★★ G5/T40：压缩能力的**降级链**与明文段标记
 * ------------------------------------------------------------------ */

/**
 * 邀请码压缩段用的**哪一种**编码（**本变体的名字只有这一处**）。
 *
 *  - `'raw'`：`deflate-raw`。**老格式**（`N.<base64url>`，没有标记）就是它，语义一字未变；
 *  - `'deflate'`：zlib 包装的 deflate（`CompressionStream('deflate')`）；
 *  - `'gzip'`：gzip 包装（`CompressionStream('gzip')`）；
 *  - `'none'`：**不压缩**。压缩段就是 `payloadBytesOf()` 的 UTF-8 JSON 直接 base64url。
 *
 * ## 为什么它住在纯层
 *
 * 它**不是浏览器 API**：它只是"这一段字节是用哪一种编码得到的"这个名字。
 * 编码侧（`src/ui/net-browser.ts` 的 `compressBytesWithFormat`）按
 * `'deflate-raw' → 'deflate' → 'gzip' → 不压缩` 的顺序真去试构造 `CompressionStream`，
 * 解出第一个成功的、把它的 `kind` 交给本文件；本文件只负责把 `kind` 写进明文段、
 * 并在解码时按标记挑解压器。名字只有一处，两端才不会各叫各的。
 */
export type CompressionKind = 'raw' | 'deflate' | 'gzip' | 'none';

/**
 * 压缩段开头的**明文标记**。形状：`<协议版本>.<标记><base64url>`。
 *
 * 协议版本**仍然是数字**（`N`），标记住在**压缩段**里，所以"按第一个 `.` 切两段、左边必须是
 * 十进制整数"这条老解析规则**一个字都不用改**：老码 `3.xxxx` 与新码 `3.-u…` 都能切出
 * 同一对（版本、压缩段）。
 *
 * ## ★★ 标记必须**不可能**与 base64url 正文撞车（T40 实现时踩过的坑）
 *
 * 第一版标记取的是 `u` / `d` / `g`（都取自压缩格式名）。它有**歧义**：base64url 的字符表里
 * 就包含这三个字母 ⇒ 老格式（无标记）那一段**恰好以 `u`/`d`/`g` 开头**时会被当成"带标记"，
 * 于是那一个字符被剥掉 ⇒ 6 个比特错位 ⇒ 一条**本来好用**的码报"压缩段解不开"
 * （实测：一条 SDP 恰好让 base64 段以 `d` 开头，整条回示码当场解不开）。
 *
 * ⇒ 标记改用 **`-` 加一个字母**，而 **`-` 不可能出现在"标记之后"的位置**：
 * 它是 base64url 的合法字符，但 base64url 的**无 padding 编码里第一个字符只可能是 `A`-`Z` /
 * `a`-`z` / `0`-`9` / `_`** —— `-` 是 6 位组 `111111`，只可能出现在**后面的组**里。
 * 所以 `'-'` 当标记的开头**没有任何歧义**：第二段以 `-` 开头就一定是新格式，
 * 否则一定是老格式（`deflate-raw`）。
 *
 * 老格式（`CompressionKind` 的 `'raw'`）**不带标记**（`''`）⇒ `N.<base64>` 逐字不变、向后兼容。
 */
export const COMPRESSION_MARKERS: Readonly<Record<CompressionKind, string>> = {
  raw: '',
  none: '-u',
  deflate: '-d',
  gzip: '-g',
};

/**
 * 生成侧用的 `kind → 标记`：与 `COMPRESSION_MARKERS` 只差 `raw` 那一档。
 *
 * `raw` 生成时也带 `'-r'`（**两份都能解**：`-r` 与"没有标记"都读成 `'raw'`），
 * 理由是让新产出的码**显式**说明自己的编码方式 —— 唯一的例外是"兼容老码"那条读路径。
 */
export const ENCODE_MARKER_OF_KIND: Readonly<Record<CompressionKind, string>> = {
  raw: '-r',
  none: '-u',
  deflate: '-d',
  gzip: '-g',
};

/** `kind → 标记`（**生成**用：`ENCODE_MARKER_OF_KIND` 的唯一取法） */
export function markerOfKind(kind: CompressionKind): string {
  return ENCODE_MARKER_OF_KIND[kind];
}

/** 标记的**字符宽度**（`raw` 读路径是 0，其余是 2；判据靠它，别写死常量） */
export function markerWidth(kind: CompressionKind): number {
  return COMPRESSION_MARKERS[kind].length;
}

/** `标记 → kind`（**读**用）：`''`（老格式）与 `'-r'`（新格式显式写出的 raw）都是 `'raw'`；不认得返回 `null` */
export function kindOfMarker(marker: string): CompressionKind | null {
  if (marker === '') return 'raw';
  // ★ `'-r'` 走**生成侧**那张表：它是 raw 的"显式标记"，读的时候必须与老格式的空标记等价
  //   （见 `ENCODE_MARKER_OF_KIND` 的说明）。这样"新码显式写清编码方式"这件事不需要
  //   在读侧多一份特例 —— 两张表都查一次就够。
  const hit = (Object.keys(ENCODE_MARKER_OF_KIND) as CompressionKind[])
    .find((k) => ENCODE_MARKER_OF_KIND[k] === marker);
  return hit ?? null;
}

/**
 * ★★ **一段载荷的第二段（`<协议版本>.` 之后那一整段）** → 三个读数。
 *
 * 这是"标记怎么读、正文从哪切"的**唯一一处**。T40 实现时在四个地方各写了一遍
 * `body.slice(1)`，其中三处漏了"老格式没有标记"这一档 ⇒ 咬掉 base64url 的第一个字符
 * ⇒ **每一条老格式邀请码都报"压缩段解不开"**（实测抓到的坑）。所以收成一个函数：
 * 谁要切这一段，就调它。
 *
 * 返回 `kind: null` = 这段带了一个本程序不认得的标记（调用方给"这不是本程序产出的邀请码"）。
 */
export interface InviteSegmentRead {
  /** 这一段的编码档位；`null` = 标记不认得 */
  readonly kind: CompressionKind | null;
  /** 标记（老格式是空串） */
  readonly marker: string;
  /** **去掉标记之后**的正文（喂给解压器的就是它） */
  readonly body: string;
}

export function readInviteSegment(segment: string, markerHint?: string): InviteSegmentRead {
  // ★ 判标记只需看**前两个字符**（标记是 `''` 或 `-x`）：`-` 不可能出现在 base64url 的首位，
  //   所以"第二段以 `-` 开头"就等于"这是新格式"，与正文内容无关（见 `COMPRESSION_MARKERS` 的说明）。
  const marker = markerHint ?? (segment.startsWith('-') ? segment.slice(0, 2) : '');
  const kind = kindOfMarker(marker);
  if (kind === null) return { kind: null, marker, body: segment };
  return { kind, marker, body: segment.slice(marker.length) };
}

/**
 * **未压缩变体的实测字符数上界**（判据：任务书 §2 第 4 条要求单独记一个）。
 *
 * ## 为什么必须与 `INVITE_CHARS_MAX` 分开
 *
 * `INVITE_CHARS_MIN/MAX`（600-900）钉的是**压缩档**的实测区间（出处见上一段的注释），
 * 任务书明写"别把原来的 600-900 改掉"。未压缩的比压缩的长得多（base64 本身就有 4/3 的膨胀，
 * 而压缩档压掉了一大半）⇒ 它落不进那个区间，也不该落进去。两个变体两个上界，互不冒充。
 *
 * ## 实测读数（G5/T40，2026-09-27）
 *
 * 第一轮用 `tests/ui/net-browser.test.ts` 判据 7 那段**语料**（SDP 619 字符）量：
 * 裸载荷 934 字节 ⇒ 未压缩变体 **1250 字符**（同语料压缩档 631）。
 * 第二轮用**真浏览器**（CDP，见 `.superpowers/g5-T40/run-cdp.txt`）量真 SDP：
 * 未压缩变体 **1826 字符**（同一次会话的压缩档 804-826 —— 与"798-808"那个实测区间吻合）。
 *
 * ⚠️ 上界照**真浏览器那个数**取（**2000**，实测的 1.10 倍）：合成语料量出来的 1250 只是
 * "这段语料有多长"的读数，拿它当上界会让真机产出的正常码被判越界。2000 留的余量是
 * "真机候选数再多一两个 / SDP 再长一点"，同时仍然远在"这条码没法用"之外。
 *
 * ⚠️ 它**不是**"这条码一定好用"的保证：超过上界只说明这一条比实测的长，仍然可用
 * （大厅那句长度读数会说清楚）。
 */
export const INVITE_CHARS_MAX_UNCOMPRESSED = 2000;

/**
 * ★★ **G6/T49：紧凑档（v3）整条码的字符数区间** —— 实测值，不是估算。
 *
 * ## 为什么必须另立一组（不能沿用 600-900）
 *
 * 600-900 钉的是 **v2**（整段 SDP 进载荷）那一档的实测形态。v3 的载荷里没有整段 SDP
 * ⇒ 长度掉到三分之一上下，拿 600 当下界会把**产品自己刚产出的**正常码判成
 * "不在这一档的实测区间内（比实测的长或短）—— 仍然可用，但可能被某些聊天工具截断"。
 *
 * ## 实测出处（2026-09-28，`.superpowers/g6-T49/run-*.json` 与 `run-gates-*.txt`）
 *
 * 真浏览器两窗口走完"建房 → 贴码 → 回示码 → 贴回 → 硬币屏"那一轮的真实码长见
 * `T49-REPORT.md` 的对照表；下面这组界线按那一轮 + 三条老码语料量出来的区间取，
 * 上界留出"候选再多两三条"的余量。与 `INVITE_CHARS_MIN/MAX` 一样：**它只判长度**，
 * 不保证这条码好用。
 */
export const COMPACT_INVITE_CHARS_MIN = 150;
export const COMPACT_INVITE_CHARS_MAX = 600;

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
  /**
   * ★ **房主的 `sessionId`**（D 轮 I-3 走"甲"）。
   *
   * ## 为什么它必须进载荷
   *
   * 会话层是**按 `sessionId` 配对**的：房主的 `HostSession` 用它校验加入方发来的 `hello`，
   * 不是这一串就当场拒（加入方停在 `handshaking`，房主根本不动）。而真实调用方
   * （`src/main.ts` 的 `startLobby`）**两端各自** `newSessionId()` ⇒ 不把房主那一串
   * 搬过去，两端**永远**是两套 `sessionId` ⇒ 邀请码这条路根本开不了局。
   *
   * 邀请码是房主**单向**递给加入方的那张纸（D17：没有回程通道），所以这个字段的方向
   * 也只有一个：房主写、加入方读。加入方**不再自己造一个**去握手。
   *
   * ⚠️ 它与"加入方**自己**的 `sessionId`"是两件事：后者是加入方上报的身份，
   * 前者是**这一局**的名字。加入方照它建会话对象（见 `net-lobby.ts` 的 `connect`）。
   */
  readonly sessionId: string;
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
 * 2.5 ★★ G6/T49：**紧凑载荷 v3**（码里不再带整段 SDP）
 *
 * ## 为什么另起一个版本号而不是改 v2 的形状
 *
 * v2 的位置数组（6 项、第 3 项是整段 SDP 原文）是**已经发出去的码**的读法，一个字都不能动。
 * 新格式换成一个**新版本号**（`COMPACT_PAYLOAD_VERSION = 3`）与一套**并行**的解析分支：
 * 老码走老分支（逐字不变）、新码走新分支。`INVITE_PAYLOAD_VERSION`（= 2）这个名字与含义
 * 都不动 —— 它仍然只描述 v2 那一套。
 *
 * ## 哪些字段进、哪些不进（判据 2 的"最小必要集"）
 *
 * 进：`ice-ufrag`、`ice-pwd`、`a=fingerprint:sha-256`、每条候选的 `type / 地址 / 端口`、
 * `a=setup`（offer 是 `actpass`、answer 是 `passive`）、以及 v2 里本来就有的
 * `sessionId` 与两个承诺位。**不进**：`v=0 / o=- / s=- / t=0 0 / a=group:BUNDLE 0 /
 * a=msid-semantic / m=application … / a=mid:0 / a=sctp-port:5000 / a=max-message-size` ——
 * 这些每场都一样，由 `sdpOfCompactPayload()` 在本地重建。
 *
 * ## 候选行里被丢掉的字段（本地重算，实测过）
 *
 * `foundation` 与 `priority` **本地重算**（`compactPriorityOf`：RFC 8445 的
 * `(type preference << 24) + (local preference << 8) + (256 - component)`；
 * `local preference` 由调用方从原候选里取出来带着，取不到按 65535 算）。
 * `raddr` / `rport` **不带**（真浏览器探针 `.superpowers/g6-T49/probe-minimal-sdp.mjs`
 * 实测：不带它们、priority 甚至写死成常数，两端照样 `connected` + 数据通道真的通了）。
 * ⇒ 两端连不上与"重算出来的 priority 取值"无关（那只影响 ICE 先试哪一对），
 * 而**判据 2 必须能假**：真正的承重项是 ufrag / pwd / fingerprint / 地址 / 端口。
 * ------------------------------------------------------------------ */

/** 紧凑载荷（v3）自己的版本号。`INVITE_PAYLOAD_VERSION`（v2）不动 */
export const COMPACT_PAYLOAD_VERSION = 3;

/** `a=setup` 在紧凑载荷里的两个取值（`offer` / `answer` 两端各自一个） */
export type CompactIceRole = 'actpass' | 'passive';

/**
 * 一条候选的**最小必要集**。
 *
 * `localPref` 只服务 `priority` 的重算（0-255；取不到时按 65535 = 最大算）。
 * 地址**原样字符串**：IPv4 点分式、IPv6 冒号式、mDNS 的 `xxxx.local` 三种都走同一条路
 * （打包成二进制能再省十几个字符，但会把"地址是不是合法"这件事从"原样带过去"
 * 变成"解包算出来"，多一层出错面 —— 本任务的判据是"真的变小且真的能连"，不是"最小可能"）。
 */
export interface CompactCandidate {
  /** `typ` 原文（`host` / `srflx` / `prflx` / `relay`） */
  readonly type: string;
  /** 地址（IPv4 / IPv6 / mDNS 名） */
  readonly address: string;
  /** 端口（1-65535） */
  readonly port: number;
  /** RFC 8445 里 `priority` 那 8 个比特（0-255；缺省 255） */
  readonly localPref?: number;
}

/** 紧凑载荷的全部入参（调用方要么给齐 ufrag/pwd/fingerprint，要么退回整段 SDP 那一档） */
export interface CompactInviteFields {
  /** 本机协议版本（明文段那一位） */
  readonly p: number;
  readonly sessionId: string;
  /** `a=ice-ufrag` 的值（缺 = 从 SDP 里抠） */
  readonly iceUfrag?: string;
  /** `a=ice-pwd` 的值（缺 = 从 SDP 里抠） */
  readonly icePwd?: string;
  /** `a=fingerprint:sha-256` 的**冒号十六进制**正文（缺 = 从 SDP 里抠） */
  readonly fingerprint?: string;
  /** `a=setup`（缺省 `actpass` = offer 那一侧） */
  readonly iceRole?: CompactIceRole;
  /** 候选（空数组 ⇒ 这一档不可用：重建出来会把 `u` / `p` 报成"没有可用候选"） */
  readonly candidates: readonly CompactCandidate[];
  readonly hostPromise: string;
  readonly guestPromise: string;
}

/** `type` 前缀表与它的门禁：`null` = 认不出（调用方退回整段 SDP 那一档） */
export const CANDIDATE_TYPE_PREFIXES: Readonly<Record<string, string>> = {
  host: 'h',
  srflx: 's',
  prflx: 'f',
  relay: 'r',
};

/** 前缀 → `type`（`CANDIDATE_TYPE_PREFIXES` 的反查，只有一处取法） */
export function candidateTypeOfPrefix(prefix: string): string | null {
  for (const type of Object.keys(CANDIDATE_TYPE_PREFIXES)) {
    if (CANDIDATE_TYPE_PREFIXES[type] === prefix) return type;
  }
  return null;
}

/** `typ` 原文 → 前缀（认不出给 `null`：紧凑载荷只承载认识的四种） */
export function candidateTypePrefix(type: string): string | null {
  return CANDIDATE_TYPE_PREFIXES[type] ?? null;
}

/** RFC 8445 的 type preference（与 Chrome 一致：host 126 / prflx 110 / srflx 100 / relay 0） */
export const CANDIDATE_TYPE_PREFERENCE: Readonly<Record<string, number>> = {
  host: 126,
  prflx: 110,
  srflx: 100,
  relay: 0,
};

/** 用于 `priority` 重算的组件号（本程序只用 SCTP 的 component 1，见 `sdpOfCompactPayload`） */
export const CANDIDATE_COMPONENT = 1;

/** `localPref` 缺省值（0-255；255 = 本机优先级最高） */
export const COMPACT_DEFAULT_LOCAL_PREF = 255;

/**
 * ★ **候选 priority 的本地重算**（RFC 8445 §5.1.2.1）：
 * `priority = (type preference << 24) + (local preference << 8) + (256 - component)`。
 *
 * 认不出的 `type` 返回 `null`（调用方退回整段 SDP 那一档，**不猜**）。
 */
export function compactPriorityOf(type: string, localPref = COMPACT_DEFAULT_LOCAL_PREF): number | null {
  const typePref = CANDIDATE_TYPE_PREFERENCE[type];
  if (typePref === undefined) return null;
  const local = Math.max(0, Math.min(255, Math.trunc(localPref)));
  return ((typePref << 24) >>> 0) + ((local << 8) >>> 0) + (256 - CANDIDATE_COMPONENT);
}

/**
 * ★ 候选 `foundation` 的本地重算：`type` 前缀 + 地址字符和（十进制）。
 *
 * RFC 8445 只要求"同一对 (type, base, protocol) 的候选 foundation 相同、
 * 不同的尽量不同"，并**没有**规定算法（原文只说 "an arbitrary integer"）⇒ 这一处是**本实现
 * 的规则**，两端一致即可，收方不会拿它当判据（`probe-minimal-sdp.mjs` 里我把它换成
 * 行号 `1/2/3`，两端照样连通）。
 */
export function compactFoundationOf(type: string, address: string): string {
  const prefix = candidateTypePrefix(type) ?? 'x';
  let sum = 0;
  for (let i = 0; i < address.length; i += 1) sum = (sum + address.charCodeAt(i)) % 100_000;
  return `${prefix}${String(sum)}`;
}

/** 紧凑载荷里"本端这一侧"那两项（`ufrag` / `pwd` / 指纹 / 候选），**位置数组**：长度是形状的一部分 */
function compactTupleOf(f: CompactInviteFields): readonly unknown[] {
  return [
    f.iceUfrag ?? '',
    f.icePwd ?? '',
    f.fingerprint ?? '',
    f.candidates.map((c) => [
      candidateTypePrefix(c.type) ?? '?',
      c.address,
      c.port,
      Math.max(0, Math.min(255, Math.trunc(c.localPref ?? COMPACT_DEFAULT_LOCAL_PREF))),
    ]),
  ];
}

/**
 * `a=setup` 的**本地判定**：一条载荷的两个承诺位都是占位串 ⇒ 它是**answer**那一侧
 * （`isAnswerPayload` 的定义，见本文件后面那一节）。
 *
 * ⚠️ 判据与 `ANSWER_PROMISE_PLACEHOLDER` **同一处语义**，但这里不能直接引用那个常量：
 * 它在本文件里声明得比这一段晚（`const` 的 TDZ），而 `sdpToCompact()` 会在模块加载之后
 * 才被调用 —— 真引用也能跑，但"依赖加载时序"是没必要的脆弱。改占位串时**两处一起改**
 * （`sdpToCompact` 的判据与 `ANSWER_PROMISE_PLACEHOLDER`，它们是同一个事实）。
 */
const COMPACT_ANSWER_PLACEHOLDER = 'answer-not-a-promise';

/**
 * ★ 紧凑载荷的**编码**：位置数组 → JSON 文本（压缩的对象就是它）。
 *
 * 形状：`[3, sessionId, [ufrag, pwd, fingerprint, [[类型, 地址, 端口, localPref], …]],
 * 本端这一侧那两项, [setup], hostPromise, guestPromise]`。
 * **逐字段一句**：
 *  - `[0]` 版本（= `COMPACT_PAYLOAD_VERSION`）；
 *  - `[1]` `sessionId`（这一局的名字）；
 *  - `[2]` 本端这一侧的连接材料（ufrag / pwd / 指纹 / 候选）；
 *  - `[3]` 与 `[2]` 同形 —— **备用**（今天恒为空数组；v4 若要带第二条 ICE 世代就往这里放）；
 *  - `[4]` `a=setup` 一个字（`'a'` = actpass / `'p'` = passive）；
 *  - `[5]` / `[6]` 两个承诺位（与 v2 同一个位置语义）。
 */
export function compactPayloadText(f: CompactInviteFields): string {
  return JSON.stringify([
    COMPACT_PAYLOAD_VERSION,
    f.sessionId,
    compactTupleOf(f),
    [],
    f.iceRole === 'passive' ? 'p' : 'a',
    f.hostPromise,
    f.guestPromise,
  ]);
}

/** 紧凑载荷的**字节**形态（`encodeInvite` 压的就是它） */
export function compactPayloadBytesOf(f: CompactInviteFields): Uint8Array {
  return utf8Encode(compactPayloadText(f));
}

/** `sessionId` → `a=ice-ufrag` / `a=ice-pwd` 的**唯一前缀**（两端同一个盐：它只要唯一，不需要保密） */
export const COMPACT_ICE_CREDENTIAL_PREFIX = 'compile-';

/** `sessionId` → `a=ice-ufrag`：`compile-` + 会话号的**十六进制**哈希（同会话号 ⇒ 同一串） */
export function iceUfragOfSessionId(sessionId: string, hash: (text: string) => string): string {
  return `${COMPACT_ICE_CREDENTIAL_PREFIX}${hash(`ufrag|${sessionId}`)}`;
}

/** `sessionId` → `a=ice-pwd`：同上，换一个盐 */
export function icePwdOfSessionId(sessionId: string, hash: (text: string) => string): string {
  return `${COMPACT_ICE_CREDENTIAL_PREFIX}${hash(`pwd|${sessionId}`)}`;
}

/* ------------------------------------------------------------------ *
 * 2.6 整段 SDP → 最小必要集（**唯一的提取处**；缺任何一项就回 `null` ⇒ 调用方退回 v2）
 * ------------------------------------------------------------------ */

/** `sdpToCompact()` 的结论：`ok: false` 的 `missing` 说的是"缺哪一项"（给探针/报告看） */
export type CompactExtractResult =
  | { readonly ok: true; readonly fields: CompactInviteFields }
  | { readonly ok: false; readonly missing: string };

/** 从一行 `a=candidate:` 里抠出最小必要集（认不出的行回 `null`） */
export function compactCandidateOfLine(line: string): CompactCandidate | null {
  const m = /^a=candidate:(\S+) (\d+) (udp) (\d+) (\S+) (\d+) typ (\S+)/.exec(line.trim());
  if (m === null) return null;
  const prefix = candidateTypePrefix(m[7]);
  if (prefix === null) return null;
  const port = Number(m[6]);
  if (!Number.isSafeInteger(port) || port <= 0 || port > 65535) return null;
  const priority = Number(m[4]);
  const localPref = Number.isSafeInteger(priority) && priority > 0
    ? Math.floor(((priority - (256 - CANDIDATE_COMPONENT)) % 0x1_0000_0000) / 256) & 0xff
    : COMPACT_DEFAULT_LOCAL_PREF;
  return { type: m[7], address: m[5], port, localPref };
}

/** `sdp` 里一条 `a=candidate:` 行都找不到（调用方据此退回 v2） */
export const NO_CANDIDATES_IN_SDP = '此端这一份 SDP 里没有 a=candidate: 行（等 ICE 收集完成之后再来）';

/**
 * ★★ **整段 SDP → 紧凑载荷字段**（本文件里唯一做这件事的地方）。
 *
 * 缺 `a=ice-ufrag` / `a=ice-pwd` / `a=fingerprint:sha-256` / 候选 中的**任何一项**就回
 * `ok: false` ⇒ 调用方**必须**退回带全量 SDP 的 v2 档（任务书 A4 那条兜底：
 * 不许为了变小而少带 ICE 凭据或 DTLS 指纹）。承诺位原样带过去。
 */
export function sdpToCompact(fields: InviteFields): CompactExtractResult {
  const sdp = fields.sdp;
  const ufrag = /a=ice-ufrag:(\S+)/.exec(sdp);
  if (ufrag === null || ufrag[1].length === 0) return { ok: false, missing: 'a=ice-ufrag' };
  const pwd = /a=ice-pwd:(\S+)/.exec(sdp);
  if (pwd === null || pwd[1].length === 0) return { ok: false, missing: 'a=ice-pwd' };
  const fp = /a=fingerprint:sha-256 (\S+)/.exec(sdp);
  if (fp === null || fp[1].length === 0) return { ok: false, missing: 'a=fingerprint:sha-256' };
  const candidates: CompactCandidate[] = [];
  for (const line of sdp.split(/\r?\n/)) {
    if (!line.startsWith('a=candidate:')) continue;
    const c = compactCandidateOfLine(line);
    // 认不出的候选行**不跳过**：跳掉它等于悄悄少给对端一条路 ⇒ 退回 v2 更诚实
    if (c === null) return { ok: false, missing: `认不出的候选行：${line.slice(0, 60)}` };
    candidates.push(c);
  }
  if (candidates.length === 0) return { ok: false, missing: NO_CANDIDATES_IN_SDP };
  return {
    ok: true,
    fields: {
      p: fields.p,
      sessionId: fields.sessionId,
      iceUfrag: ufrag[1],
      icePwd: pwd[1],
      fingerprint: fp[1],
      iceRole: fields.hostPromise === COMPACT_ANSWER_PLACEHOLDER ? 'passive' : 'actpass',      candidates,
      hostPromise: fields.hostPromise,
      guestPromise: fields.guestPromise,
    },
  };
}


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
  | 'decompress-unsupported'
  | 'bad-json'
  | 'bad-payload'
  | 'version-mismatch';

/**
 * 解码结果（失败**不抛**，照 `protocol.ts` 的结果对象口径）。
 *
 * ★ 成功面多带一个 `proto`：明文段的协议版本与本机的比对结论（`protocolVersionCheck`）。
 * 它**不是**失败面的一部分 —— 版本不一致时邀请码本身仍然解得出（"邀请码坏了"与
 * "两端版本不一样"是两件事），提示由调用方（T8 的大厅）渲染。
 *
 * ★★ **G5/T40**：成功面再带一个 `format` —— "这条码用的是哪一档编码"。
 */
export type InviteDecodeResult =
  | { ok: true; payload: InvitePayload; proto: ProtocolVersionVerdict; format: InviteFormatRead }
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

/**
 * 本文件认得的载荷版本。改动 `InvitePayload` 的字段就该动它
 *
 * ★ **D 轮：1 → 2**（I-3 走甲：位置数组里多了一项 `sessionId`）。
 * 版本必须动，因为**不动的后果是静默错配**：老的 5 项载荷在"只看项数"的解析器里
 * 会掉进 `bad-payload`（项数不对），而那正是这里想要的结果 —— 但如果不升版本，
 * 一份**恰好 7 项、顺序不同**的载荷会被当成本版本收下。两个字段同时改，解析器才分得开。
 *
 * ⚠️ 它与 `PROTO_VERSION`（线协议版本）是**两个独立**的常量：这里动它**不动**线协议。
 */
export const INVITE_PAYLOAD_VERSION = 2;

/**
 * ★★ **G6/T49：解不开一条"结构上比本机新"的载荷时，给玩家的那一句提示**。
 *
 * ## 为什么必须有它
 *
 * T49 起新产出的码缺省是**紧凑载荷 v3**，而**旧版前端只认 v2 的 6 项布局**。旧版收到一条
 * v3 码时，`parseInvitePayload` 只能走到"这份载荷不完整 / 这不是本程序产出的形状"那一支 ——
 * 那句**按字面是真的**，但对玩家毫无下一步：他手里那条码明明是对方刚给的。
 * 补上这一句之后，屏上会直接说出**最可能的那件事**与**下一步**（刷新页面）。
 *
 * ⚠️ 它**只挂在"形状不对"那一族失败上**（不是所有失败）：压缩段解不开 / base64url 不合法
 * 是"码被改坏了"，那时候说"版本旧"会把人带偏。
 */
export const INVITE_NEWER_VERSION_HINT =
  '（也请对方确认他用的是最新版本：这条码可能是更新的版本产出的格式，旧版本的前端读不懂 —— '
  + '让对方刷新页面之后重新生成一条，或把本机更新到最新版本。）';

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
 * 顺序是契约（`v` / `p` / `sessionId` / `sdp` / `ice` / `hostPromise` / `guestPromise`），
 * 校验在 `parseInvitePayload` 里**逐位**做 —— 字段少一个长度就不够，当场拒。
 * 空候选列表写成 `[""]`（不是 `[]`）：位置数组的下标必须固定，`[]` 会让后面的项前移。
 *
 * ⚠️ **协议版本（`p`）不在里面**：它是**握手时要先比对**的那一项（D13 的第 1 步），
 * 所以它必须**不经过压缩**就能读到 —— 在本文件里它是明文段（见 `encodeInvite`）。
 */
export function payloadBytesOf(fields: InviteFields): Uint8Array {
  const tuple: readonly (string | readonly string[] | number)[] = [
    INVITE_PAYLOAD_VERSION,
    fields.sessionId,
    fields.sdp,
    fields.ice.length === 0 ? [''] : [...fields.ice],
    fields.hostPromise,
    fields.guestPromise,
  ];
  return utf8Encode(JSON.stringify(tuple));
}

/** 位置数组的下标（契约写在这里，解析侧只许用这几个常量） */
const AT_VERSION = 0;
const AT_SESSION_ID = 1;
const AT_SDP = 2;
const AT_ICE = 3;
const AT_HOST_PROMISE = 4;
const AT_GUEST_PROMISE = 5;
/** 位置数组的长度（少一项就拒 —— "缺字段"这条判据靠它） */
const TUPLE_LEN = 6;

/** 压缩能力的形状：**同步**、把字节压成字节、解不动返回 `null`（不抛） */
export type ByteCompressor = (raw: Uint8Array) => Uint8Array | null;

/**
 * 解码侧按**标记**分派的解压器表。
 *
 * 形状与 `CompressionKind` 同键：`'raw'` / `'deflate'` / `'gzip'` 各是一个"把 base64url
 * 解成字节"的同步口；`'none'` **不进这张表**（不压缩那段自己就是 base64url，
 * 解码时用 `base64UrlToBytes` 直接还原，不需要任何设备能力 —— 这正是"降级到不压缩"
 * 在**任何**设备上都能解开的理由）。
 *
 * 缺项 = 本端没有这一档的解压能力 ⇒ 给**人话**拒绝（`decompress-unsupported`），
 * 不是"压缩段坏了"（那是两件不同的事，玩家要做的下一步也不同）。
 */
export type DecompressorSet = Partial<Record<'raw' | 'deflate' | 'gzip', (b64: string) => Uint8Array | null>>;

/** 编码的失败形态（**不抛**：压缩能力的缺失是常态） */
export type InviteEncodeResult = { ok: true; payload: string } | { ok: false; reason: string; message: string };

/**
 * ★ 编码：字段 →（按 `kind` 编码）→ 载荷串。
 *
 * ## 载荷的形状（`<协议版本>.<标记><压缩段>`）
 *
 *  - **协议版本**：明文的十进制（**不压缩**）。它要在握手第一步就被读到并比对（D13），
 *    压进压缩流里就等于"为了读一个整数先解压"；
 *  - **标记**：`''` / `u` / `d` / `g`，说的是**压缩段是用哪一种编码得到的**（`COMPRESSION_MARKERS`）。
 *    老格式（`raw`）的标记是空串 ⇒ **`N.<base64>` 逐字不变**，向后兼容；
 *  - **压缩段**：`compress(payloadBytesOf(fields))` 的 base64url —— 编码的对象是那份
 *    位置数组（含 `v` / `sdp` / `ice` / 两个承诺串），**只有这一段**。
 *
 * ## 为什么标记要进载荷（而不是让对端猜）
 *
 * 各台设备的 `CompressionStream` 支持面**不一样**（用户真机事故：有一台对 `deflate-raw`
 * 直接抛 `TypeError`）。让对端"挨个试"会把"解不开"变成一种**必然出现**的日常路径，
 * 而试错顺序还可能与发送端不同 ⇒ 明明有解却报"压缩段坏了"。带上标记，对端一次就选对解压器。
 *
 * ## `kind` 与 `decompress` 的取法（**老调用形态仍然可用**）
 *
 *  - `kind` 缺省 = `'raw'`（老格式，`N.<base64>`）；
 *  - `decompress` 是**函数**时（老调用形态）：它就是**这一档**的解压器。调用方既然把 `kind`
 *    交给了本函数，就说明它手上那个"真解一遍"的结果**就是这一档**的（`createInvite()` 就是
 *    这么做：降级链挑出哪一档，它就把哪一档的真解压结果交进来）。
 *    ⚠️ 这里曾经写成"函数只当 `'raw'` 用、`kind !== 'raw'` 一律 `null`" —— 那会让**降级链
 *    每一档都失败**（实测：`deflate` 档压得出来、真也解得出，却被自洽检查判成"解不回来"，
 *    整条邀请码生成不了）。**不为了兼容形状而牺牲正确性**：函数形态照样服务非 raw 的档。
 *  - `decompress` 是 `{ raw, deflate, gzip }`**表**时：按 `kind` 取那一档的解压器做自洽检查。
 *
 * ## 自洽检查（两道）与调用方的义务
 *
 * 压出来的东西**必须**（a）解得动、（b）解出来还是那份载荷。它挡住的是"压缩与编码各走各的"
 * 这一类缝。本函数同步 ⇒ 检查也只能是同步的，而真实解压是异步的 ⇒
 * **调用方先 `await` 出"真解一遍"的结果，再把那个结果当同步口交进来**
 * （`src/ui/net-browser.ts` 的 `createInvite()` 就是这么做的；评审 D 实测过
 * "把同一性检查冒充解压"的写法会让这道检查恒真）。
 *
 * ⚠️ 当 `kind === 'none'` 时，调用方给的那个"同步解压口"应当返回**原样字节**
 * （不压缩那段没有可解的东西）—— `createInvite()` 交的就是真解一遍的结果，不是恒真判断。
 *
 * ★★ **G6/T49：`payload` 那个参数**（缺省 = `{ mode: 'full' }`，**老调用与老行为一字不变**）。
 *  - `'full'`：v2 那一份（整段 SDP 进载荷）；
 *  - `'compact'`：v3（**最小必要集**）。候选的 `foundation` / `priority` 在收方本地重算，
 *    这条码里**不出现整段 SDP**。`compact` 缺哪一项（ufrag / pwd / 指纹 / 候选）
 *    一律回 `{ ok: false, reason: 'compact-unavailable' }` ⇒ **调用方必须退回 `'full'`**，
 *    不许为了变小而少带 ICE 凭据或 DTLS 指纹（任务书 A4/A5 那条兜底）。
 */
export function encodeInvite(
  fields: InviteFields,
  compress: ByteCompressor,
  decompress: ((compressed: Uint8Array) => Uint8Array | null) | DecompressorSet,
  kind: CompressionKind = 'raw',
  payload: InvitePayloadMode = { mode: 'full' },
): InviteEncodeResult {
  if (fields.sdp.length === 0) {
    // 调用方违约（不是玩家输入）：一条没有 SDP 的邀请码收方无论如何都连不上
    throw new Error('encodeInvite 收到了空 SDP：邀请码里必须有一份完整 offer，这是调用方违约。');
  }
  if (fields.sessionId.length === 0) {
    // ★ D 轮（I-3 甲）：没有房主的会话号，这条邀请码收下也握不上手 ⇒ 同样是**调用方违约**，
    //   而且要在**发出之前**就炸出来（发出去之后玩家只会看到"对端不理我"）
    throw new Error('encodeInvite 收到了空 sessionId：邀请码必须带上房主这一局的会话号，这是调用方违约。');
  }
  if (!PROMISE_TEXT.test(fields.hostPromise) || !PROMISE_TEXT.test(fields.guestPromise)) {
    // 形状校验：两个承诺串必须是非空且不含分隔符 / 换行的文本（它们会进载荷）
    return { ok: false, reason: 'bad-promise', message: '两个承诺串必须是非空、且不含分隔符的文本。' };
  }
  /** 压的对象：紧凑档是 v3 那一份（最小必要集），否则是 v2 那一份（整段 SDP） */
  const prepared = rawBytesForInvite(fields, payload);
  if (!prepared.ok) return prepared;
  const raw = prepared.bytes;
  const compressed = compress(raw);
  if (compressed === null || compressed.length === 0) {
    return { ok: false, reason: 'compress-unsupported', message: '这台设备压不出邀请码要用的压缩流（压缩能力缺失）。' };
  }
  // ★ 自洽检查（两道）：压出来的东西**必须**（a）解得动、（b）解出来还是那份载荷。
  //   它挡住的是"压缩与编码各走各的"这一类缝（压的是别的内容、或者压完被截断）。
  //   函数形态**服务所有档**（不是只服务 raw）：见上面那段说明与实测踩过的坑。
  const back = typeof decompress === 'function'
    ? decompress(compressed)
    : (decompress[kind as 'raw' | 'deflate' | 'gzip']?.(bytesToBase64Url(compressed)) ?? null);
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
  /**
   * ★ 紧凑档的**第二道自洽检查**：重建出来的 SDP 必须真的带着 ICE 凭据与 DTLS 指纹
   * （"漏 `a=ice-pwd`"这一类变异会在这里当场变红，而不是等到两端连不上才发现）。
   * `'full'` 档不做这件事（那一档的 `sdp` 就是原文，没什么可查的）。
   */
  if (payload.mode === 'compact') {
    const rebuilt = roundTrip.payload.sdp;
    if (!rebuilt.includes('a=ice-pwd:') || !rebuilt.includes('a=fingerprint:sha-256 ')
      || !rebuilt.includes('a=ice-ufrag:')) {
      return {
        ok: false,
        reason: 'compact-rebuild-incomplete',
        message: '紧凑格式重建出来的 SDP 缺 ICE 凭据或 DTLS 指纹：这一档不可用，请退回带整段 SDP 的那一档。',
      };
    }
  }
  return { ok: true, payload: `${fields.p}.${markerOfKind(kind)}${bytesToBase64Url(compressed)}` };
}

/**
 * 一条码**带什么进载荷**（`encodeInvite` 的第五个入参）。
 *
 *  - `{ mode: 'full' }`：**缺省**。v2 那一档（整段 SDP 进载荷），老调用与老行为一字不变；
 *  - `{ mode: 'compact' }`：从 `fields.sdp` 里抠出最小必要集（`sdpToCompact`）。抠不齐
 *    （缺 `a=ice-ufrag` / `a=ice-pwd` / `a=fingerprint:sha-256` / 候选）就回
 *    `'compact-unavailable'` ⇒ 调用方退回 `'full'`；
 *  - `{ mode: 'compact', compact }`：**调用方自己造好了 ICE 凭据**（`createInvite` 就是：
 *    两端各自从 `sessionId` 本地推同一个 ufrag/pwd，这一路不依赖 SDP 里有没有那两行）。
 *    指纹与候选仍然从 `sdp` 里取。
 */
export type InvitePayloadMode =
  | { readonly mode: 'full' }
  | { readonly mode: 'compact'; readonly compact?: InviteCompactPreset };

/** 调用方自己造好的那一半（进 `InvitePayloadMode` 的 `compact` 位） */
export interface InviteCompactPreset {
  readonly iceUfrag?: string;
  readonly icePwd?: string;
  readonly fingerprint?: string;
  readonly iceRole?: CompactIceRole;
}

/**
 * ★ 把 `(fields, payload)` 收成**要压的那份字节**（唯一的取法；`encodeInvite` 用它）。
 *
 * 紧凑档的取值顺序：`payload.compact` 里给的 > `fields.sdp` 里抠的。
 * 缺 `a=ice-ufrag` / `a=ice-pwd` / `a=fingerprint:sha-256` / 候选里**任何一项**，
 * 而 `payload.compact` 又没把那一样给出来 ⇒ `'compact-unavailable'`（调用方退回 `'full'`）。
 */
export function rawBytesForInvite(
  fields: InviteFields,
  payload: InvitePayloadMode = { mode: 'full' },
): { readonly ok: true; readonly bytes: Uint8Array } | Extract<InviteEncodeResult, { ok: false }> {
  if (payload.mode === 'full') return { ok: true, bytes: payloadBytesOf(fields) };
  const preset = payload.compact ?? {};
  const sdp = fields.sdp;
  const fromSdp = {
    iceUfrag: /a=ice-ufrag:(\S+)/.exec(sdp)?.[1],
    icePwd: /a=ice-pwd:(\S+)/.exec(sdp)?.[1],
    fingerprint: /a=fingerprint:sha-256 (\S+)/.exec(sdp)?.[1],
  };
  const ufrag = preset.iceUfrag ?? fromSdp.iceUfrag;
  const pwd = preset.icePwd ?? fromSdp.icePwd;
  const fingerprint = preset.fingerprint ?? fromSdp.fingerprint;
  const missing = ufrag === undefined || ufrag.length === 0 ? 'a=ice-ufrag'
    : pwd === undefined || pwd.length === 0 ? 'a=ice-pwd'
      : fingerprint === undefined || fingerprint.length === 0 ? 'a=fingerprint:sha-256'
        : null;
  if (missing !== null) {
    // ★ A4/A5 的那条兜底：缺 ICE 凭据 / DTLS 指纹 ⇒ **不缩**，交给调用方走 'full'
    return {
      ok: false,
      reason: 'compact-unavailable',
      message: `这条码没法用紧凑格式（缺 ${missing}）：请退回带整段 SDP 的那一档。`,
    };
  }
  const candidates: CompactCandidate[] = [];
  for (const line of sdp.split(/\r?\n/)) {
    if (!line.startsWith('a=candidate:')) continue;
    const c = compactCandidateOfLine(line);
    // 认不出的候选行**不跳过**：跳掉它等于悄悄少给对端一条路 ⇒ 退回 v2 更诚实
    if (c === null) {
      return {
        ok: false,
        reason: 'compact-unavailable',
        message: `这条码没法用紧凑格式（认不出的候选行：${line.slice(0, 60)}）：请退回带整段 SDP 的那一档。`,
      };
    }
    candidates.push(c);
  }
  if (candidates.length === 0) {
    return {
      ok: false,
      reason: 'compact-unavailable',
      message: `这条码没法用紧凑格式（${NO_CANDIDATES_IN_SDP}）：请退回带整段 SDP 的那一档。`,
    };
  }
  return {
    ok: true,
    bytes: compactPayloadBytesOf({
      p: fields.p,
      sessionId: fields.sessionId,
      iceUfrag: ufrag as string,
      icePwd: pwd as string,
      fingerprint: fingerprint as string,
      iceRole: preset.iceRole ?? (fields.hostPromise === COMPACT_ANSWER_PLACEHOLDER ? 'passive' : 'actpass'),
      candidates,
      hostPromise: fields.hostPromise,
      guestPromise: fields.guestPromise,
    }),
  };
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

/** 紧凑载荷（v3）的位置数组长度（7 项：版本 / 会话号 / 材料 / 备用 / setup / 两个承诺位） */
const COMPACT_TUPLE_LEN = 7;
/** 紧凑载荷里"本端这一侧的材料"的下标（`[ufrag, pwd, fingerprint, 候选]`） */
const COMPACT_AT_MATERIAL = 2;
/** 紧凑载荷里备用那一项的下标（与材料同形；今天恒为空数组） */
const COMPACT_AT_SPARE = 3;
/** 紧凑载荷里 `a=setup` 那一个字的下标 */
const COMPACT_AT_SETUP = 4;
/** 紧凑载荷里两个承诺位的下标 */
const COMPACT_AT_HOST_PROMISE = 5;
const COMPACT_AT_GUEST_PROMISE = 6;

/**
 * ★★ **本地重建一份最小可用 SDP**（`setRemoteDescription` 吃的那一串）。
 *
 * 每一行都在这里，**一处不多一处不少**：
 *  - `v=0` / `o=-` / `s=-` / `t=0 0`：SDP 的骨架（`o=` 的会话 id 取 0：对端只用它比"是不是同一次协商"，
 *    而 offer 与 answer 各自那一份都由本函数重建，两端一致）；
 *  - `a=group:BUNDLE 0` / `a=msid-semantic: WMS`：与真机那一份同形（少一行也让 Chrome 收，但同形更省心）；
 *  - `m=application 9 UDP/DTLS/SCTP webrtc-datachannel` + `a=mid:0` + `a=sctp-port:5000`
 *    + `a=max-message-size:262144`：数据通道那一份媒体描述（本程序只用这一条 m 行）；
 *  - `c=IN IP4 0.0.0.0`：媒体级连接行（**必须**在 m 行之后 —— 第一版把它放在 m 行之前，
 *    那是会话级的写法，候选行就落不到媒体上）；
 *  - `a=candidate:`：每一条候选一行（`foundation` 与 `priority` 本地重算）；
 *  - `a=ice-ufrag` / `a=ice-pwd` / `a=fingerprint:sha-256` / `a=setup`：ICE 与 DTLS 的凭据。
 */
export function sdpOfCompactPayload(
  material: { readonly ufrag: string; readonly pwd: string; readonly fingerprint: string;
    readonly candidates: readonly CompactCandidate[] },
  setup: CompactIceRole,
): string {
  const lines = [
    'v=0',
    'o=- 0 2 IN IP4 127.0.0.1',
    's=-',
    't=0 0',
    'a=group:BUNDLE 0',
    'a=msid-semantic: WMS',
    'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
    'c=IN IP4 0.0.0.0',
  ];
  for (const c of material.candidates) {
    const priority = compactPriorityOf(c.type, c.localPref ?? COMPACT_DEFAULT_LOCAL_PREF) ?? 0;
    lines.push(
      `a=candidate:${compactFoundationOf(c.type, c.address)} ${String(CANDIDATE_COMPONENT)} udp `
        + `${String(priority)} ${c.address} ${String(c.port)} typ ${c.type}`,
    );
  }
  lines.push(
    `a=ice-ufrag:${material.ufrag}`,
    `a=ice-pwd:${material.pwd}`,
    `a=fingerprint:sha-256 ${material.fingerprint}`,
    `a=setup:${setup}`,
    'a=mid:0',
    'a=sctp-port:5000',
    'a=max-message-size:262144',
  );
  return `${lines.join('\r\n')}\r\n`;
}

/** 一条候选行的**合法性**（重建之后逐条复读：跨得过这条才交给 `setRemoteDescription`） */
const REBUILT_CANDIDATE_LINE = /^a=candidate:[A-Za-z0-9+/-]+ [0-9]+ udp [0-9]+ \S+ [0-9]+ typ (host|srflx|prflx|relay)$/;

/**
 * ★ 紧凑载荷（v3）→ 一份完整载荷（含**本地重建**的 SDP）。
 *
 * 只被 `parseInvitePayload()` 调用；失败用 `InviteDecodeError` 抛出来、由调用方接住，
 * 好让本文件的失败出口仍然只有 `parseInvitePayload` 里那一处（M3 的锚点）。
 *
 * 校验顺序：**版本** → **会话号** → **材料**（`ufrag` / `pwd` / 指纹 / 候选）→ **承诺位**
 * → 重建 SDP → **逐条复读候选行**。缺 ICE 凭据或 DTLS 指纹的一律拒（那两样是不可省的）。
 */
function readCompactInvite(raw: readonly unknown[]): { readonly payload: InvitePayload; readonly sdp: string } {
  const ver = raw[AT_VERSION];
  if (typeof ver !== 'number' || !Number.isInteger(ver)) {
    throw new InviteDecodeError('bad-payload', '邀请码里缺少格式版本（第 1 项不是整数）：这不是一份完整的邀请码。');
  }
  if (ver !== COMPACT_PAYLOAD_VERSION) {
    throw new InviteDecodeError(
      'version-mismatch',
      `邀请码的格式版本是 ${String(ver)}，本程序只认 ${INVITE_PAYLOAD_VERSION}（或紧凑格式的 ${COMPACT_PAYLOAD_VERSION}）：`
        + '两端版本不一致，请让对端用同一个版本重新生成。',
    );
  }
  if (!nonEmptyString(raw[AT_SESSION_ID])) {
    throw new InviteDecodeError('bad-payload', '邀请码里缺少这一局的房主会话号（sessionId）：没有它对不上房主，握手会被当场拒掉。');
  }
  const material = raw[COMPACT_AT_MATERIAL];
  if (!Array.isArray(material) || material.length !== 4) {
    throw new InviteDecodeError('bad-payload', '紧凑邀请码里的连接材料不是 4 项（ufrag / pwd / 指纹 / 候选）：这份载荷不完整。');
  }
  const [ufrag, pwd, fingerprint, rawCandidates] = material as readonly unknown[];
  if (!nonEmptyString(ufrag) || !nonEmptyString(pwd)) {
    throw new InviteDecodeError(
      'bad-payload',
      '紧凑邀请码里缺少 ICE 凭据（a=ice-ufrag / a=ice-pwd）：这两样一个都不能省，这份载荷不完整。',
    );
  }
  if (!nonEmptyString(fingerprint)) {
    throw new InviteDecodeError(
      'bad-payload',
      '紧凑邀请码里缺少 DTLS 指纹（a=fingerprint:sha-256）：没有它就验不了对端身份，不能收下这份邀请码。',
    );
  }
  if (!Array.isArray(rawCandidates)) {
    throw new InviteDecodeError('bad-payload', '紧凑邀请码里的候选不是数组：这份载荷不完整。');
  }
  const candidates: CompactCandidate[] = [];
  for (const item of rawCandidates) {
    if (!Array.isArray(item) || item.length !== 4) {
      throw new InviteDecodeError('bad-payload', '紧凑邀请码里有一条候选不是 4 项（类型 / 地址 / 端口 / 本机优先级）。');
    }
    const [prefix, address, port, localPref] = item as readonly unknown[];
    const type = typeof prefix === 'string' ? candidateTypeOfPrefix(prefix) : null;
    if (type === null) {
      throw new InviteDecodeError('bad-payload', `紧凑邀请码里的候选类型认不出（读到 ${JSON.stringify(prefix)}）。`);
    }
    if (!nonEmptyString(address) || typeof port !== 'number' || !Number.isSafeInteger(port) || port <= 0 || port > 65535) {
      throw new InviteDecodeError('bad-payload', '紧凑邀请码里有一条候选的地址或端口不合法（端口要 1-65535 的整数）。');
    }
    if (typeof localPref !== 'number' || !Number.isSafeInteger(localPref) || localPref < 0 || localPref > 255) {
      throw new InviteDecodeError('bad-payload', '紧凑邀请码里有一条候选的本机优先级不是 0-255 的整数。');
    }
    candidates.push({ type, address, port, localPref });
  }
  if (candidates.length === 0) {
    throw new InviteDecodeError('bad-payload', '紧凑邀请码里一条候选都没有：没有可用候选就建不起连接，这份载荷不完整。');
  }
  const spare = raw[COMPACT_AT_SPARE];
  if (!Array.isArray(spare) || spare.length !== 0) {
    throw new InviteDecodeError('bad-payload', '紧凑邀请码里本端材料之后那一项今天必须是空数组（备用位）：这份载荷不完整或被改过。');
  }
  const setup = raw[COMPACT_AT_SETUP];
  if (setup !== 'a' && setup !== 'p') {
    throw new InviteDecodeError('bad-payload', `紧凑邀请码里的 a=setup 认不出（读到 ${JSON.stringify(setup)}）。`);
  }
  if (!nonEmptyString(raw[COMPACT_AT_HOST_PROMISE]) || !nonEmptyString(raw[COMPACT_AT_GUEST_PROMISE])) {
    throw new InviteDecodeError('bad-payload', '紧凑邀请码里缺少承诺位：这份载荷不完整。');
  }
  const sdp = sdpOfCompactPayload(
    { ufrag, pwd, fingerprint, candidates },
    setup === 'p' ? 'passive' : 'actpass',
  );
  // ★ 逐条复读：重建出来的每一行候选都要**跨得过**合法性判定（地址/端口里的空格、换行、
  //   空串都会在这里露出来 ⇒ 宁可当场拒，也不把一串畸形 SDP 交给 setRemoteDescription）
  const rebuilt = sdp.split('\r\n').filter((l) => l.startsWith('a=candidate:'));
  if (rebuilt.length !== candidates.length || !rebuilt.every((l) => REBUILT_CANDIDATE_LINE.test(l))) {
    throw new InviteDecodeError('bad-payload', '紧凑邀请码重建出来的候选行不合法（地址或端口里有不该有的字符）。');
  }
  return {
    sdp,
    payload: {
      v: COMPACT_PAYLOAD_VERSION,
      p: -1,
      sessionId: raw[AT_SESSION_ID] as string,
      sdp,
      ice: rebuilt,
      hostPromise: raw[COMPACT_AT_HOST_PROMISE] as string,
      guestPromise: raw[COMPACT_AT_GUEST_PROMISE] as string,
    },
  };
}

/**
 * 已经解出来的 JSON → 载荷。**唯一的失败出口**在这里。
 *
 * 输入的形状是 `payloadBytesOf` 产出的**位置数组**（下标见 `AT_*` 常量）。
 * 校验顺序：**项数** → **格式版本** → **逐位结构**。三项分别给
 * `'bad-payload'`（项数不对 ⇒ 缺字段）、`'version-mismatch'`、`'bad-payload'`；
 * `'bad-json'` 一族在调用方（`decodeInvite`）判 —— 那时还没有对象可看。
 *
 * ★★ **G6/T49**：v2（6 项、带整段 SDP）与 v3（7 项、最小必要集，`COMPACT_PAYLOAD_VERSION`）
 * 是两个**并列**的分支。**分派只看第 1 项那个版本号**（不看项数）：项数不对是"缺字段"
 * （`bad-payload`），版本不对是"格式新"（`version-mismatch`）—— 这两件事**不能**混。
 * 曾经按"项数是不是 7"分派，结果是"6 项 + 版本号 3"被读成 v3 的形状 ⇒ 一条**项数写着 6**
 * 的载荷拿到 `version-mismatch` 而不是 `bad-payload`（老那条判据当场红）。
 *
 * 老码的六条校验一个字没动；新码的失败走 `readCompactInvite()` 那条内部
 * `throw`，由本函数接住之后**仍然只有下面那一处 `throw`**（M3 的锚点不变）。
 */
export function parseInvitePayload(raw: unknown): ParsedInviteResult {
  /** 第一处失败（链式取反会同时命中多条 ⇒ 只留第一条，报错才指得准） */
  let fail: InviteDecodeError | null = null;
  const miss = (reason: InviteRejectReason, message: string): void => {
    if (fail === null) fail = new InviteDecodeError(reason, message);
  };

  /** 第 1 项（格式版本号）—— 分支的唯一依据 */
  const ver: unknown = Array.isArray(raw) ? (raw as readonly unknown[])[AT_VERSION] : undefined;
  /** v3 那一支的结论 / 失败（`readCompactInvite` 会 throw，这里接住） */
  let compactFail: InviteDecodeError | null = null;
  let compact: { readonly payload: InvitePayload; readonly sdp: string } | null = null;
  if (Array.isArray(raw) && typeof ver === 'number' && ver === COMPACT_PAYLOAD_VERSION
    && raw.length === COMPACT_TUPLE_LEN) {
    try {
      compact = readCompactInvite(raw);
    } catch (e) {
      if (e instanceof InviteDecodeError) compactFail = e;
      else throw e;
    }
  }

  if (!Array.isArray(raw)) {
    miss('bad-payload', '邀请码里的内容不是本程序产出的形状（它不是一个位置数组）：这份载荷不完整或被改过。'
      + INVITE_NEWER_VERSION_HINT);
  } else if (typeof ver !== 'number' || !Number.isInteger(ver)) {
    miss('bad-payload', '邀请码里缺少格式版本（第 1 项不是整数）：这不是一份完整的邀请码。'
      + INVITE_NEWER_VERSION_HINT);
  } else if (ver === COMPACT_PAYLOAD_VERSION && raw.length === COMPACT_TUPLE_LEN) {
    /**
     * v3：形状与逐字段校验都在 `readCompactInvite()` 里（它的失败已经收在 `compactFail`）。
     * ⚠️ v3 这一支的**所有**失败都是"这份要紧载荷缺项 / 被改过"⇒ 一律带上那句版本提示
     * （它正是"旧版前端读到新版码"最可能落到的那一格）。
     */
    if (compactFail !== null) miss(compactFail.reason, compactFail.message + INVITE_NEWER_VERSION_HINT);
    else if (compact === null) {
      miss('bad-payload', '紧凑邀请码的载荷不完整（会话号 / 材料 / setup / 承诺位有缺项）。'
        + INVITE_NEWER_VERSION_HINT);
    }
  } else if (ver !== INVITE_PAYLOAD_VERSION) {
    miss(
      'version-mismatch',
      `邀请码的格式版本是 ${String(ver)}，本程序只认 ${INVITE_PAYLOAD_VERSION}（或紧凑格式的 ${COMPACT_PAYLOAD_VERSION}）：` +
        '两端版本不一致，请让对端用同一个版本重新生成。' + INVITE_NEWER_VERSION_HINT,
    );
  } else if (raw.length !== TUPLE_LEN) {
    miss(
      'bad-payload',
      `邀请码里只有 ${raw.length} 项，本程序需要 ${TUPLE_LEN} 项：这份载荷缺字段，收下也没法开局。`
        + INVITE_NEWER_VERSION_HINT,
    );
  } else {
    if (!nonEmptyString(raw[AT_SESSION_ID])) {
      miss('bad-payload', '邀请码里缺少这一局的房主会话号（sessionId）：没有它对不上房主，握手会被当场拒掉。');
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

  if (compact !== null) {
    /**
     * v3：`sdp` 是**本地重建**出来的（`readCompactInvite` 已经把候选行逐条核对过），
     * `ice` 那一项与 v2 同义（`candidatesOf(sdp)` 会再抠一遍，值相同）。
     */
    return { ok: true, payload: { ...compact.payload, p: -1 } };
  }

  const t = raw as readonly unknown[];
  return {
    ok: true,
    payload: {
      v: INVITE_PAYLOAD_VERSION,
      // `p` **不在压缩段里**（见 `payloadBytesOf` 的注释）：解析这一步只填一个占位值，
      // 真正的协议版本由 `decodeInviteText` 从明文段读进来覆盖。
      p: -1,
      sessionId: t[AT_SESSION_ID] as string,
      sdp: t[AT_SDP] as string,
      // 空候选在载荷里写成 `[""]`，这里换回空数组（位置数组的下标必须固定，见 `payloadBytesOf`）
      ice: (t[AT_ICE] as string[]).filter((x) => x.length > 0),
      hostPromise: t[AT_HOST_PROMISE] as string,
      guestPromise: t[AT_GUEST_PROMISE] as string,
    },
  };
}

/**
 * **整条**解码：读明文协议版本与压缩标记 → 判压缩段的字符集 → 解压 → 解析位置数组。
 *
 * ## 两种调用形态（老调用一字不改）
 *
 *  - **老形态**：`decodeInviteText(text, (b64) => bytes|null)` —— 这个函数就是**本档**
 *    的解压器。老载荷（`N.<base64>`，没有标记）走 `'raw'` ⇒ 老调用点与老码**逐字兼容**；
 *  - **新形态**：`decodeInviteText(text, { raw, deflate, gzip })` —— 按压缩段的**明文标记**
 *    挑解压器（`COMPRESSION_MARKERS`）。缺的那一档给 **`'decompress-unsupported'`**
 *    （一句"本端没有这一档解压能力"的人话），不是"压缩段坏了" —— 那是两件不同的事。
 *
 * ⚠️ **函数形态不是"只给 raw 用"**：调用方把 `kind` 交过来，就说明它手上那个解压结果
 * **就是这一档**的（`decodeInvitePayload` / 大厅的 `decodeWithFormat` 都这么做）。
 * 曾经写成只认 `'raw'`，结果是**降级链挑出来的 `deflate` / `gzip` 档一律报"本机解不开"**
 * （实测抓到的坑）。表形态与函数形态的区别只是"能不能一次给多档"，不是"能服务哪一档"。
 *
 * `'none'`（未压缩变体）**不进那张表**：不压缩那段自己就是 base64url，用 `base64UrlToBytes`
 * 直接还原 ⇒ 任何设备都解得开（这正是降级链最后一档的意义）。
 *
 * ## 字符集先判还是先解压
 *
 * 顺序是**先判字符集、再解压**，让判据 4 的 ① 与 ② 分得开：非法字符给
 * `'bad-base64url'`，字符合法但压缩流坏了给 `'decompress-failed'`。
 *
 * ★ **明文段的协议版本会被比对**（`protocolVersionCheck`）：不等时**不在这里拒绝**
 * （拒绝时机归 T8 的大厅），而是把结论与一句可读提示放进成功面的 `proto` 字段。
 *
 * ★★ **G5/T40**：成功面还带一个 `format`（用的是哪一档、标记是什么、压缩段多少字符）——
 * 界面上"这条码是哪一档"这个读数**只能**从这里取，别在渲染层再猜一次。
 */
export function decodeInviteText(
  text: string,
  decompress: ((b64: string) => Uint8Array | null) | DecompressorSet,
  options?: {
    readonly marker?: string;
    readonly decompressors?: DecompressorSet;
  },
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
  const body = text.slice(dot + 1);
  const proto = Number(protoText);
  if (!/^\d+$/.test(protoText) || !Number.isSafeInteger(proto)) {
    return {
      ok: false,
      reason: 'bad-base64url',
      message: `邀请码开头的协议版本不是整数（收到 "${protoText}"）：这不是本程序产出的邀请码。`,
    };
  }
  /**
   * 压缩段的**明文标记**：第二段的第一个字符若是本程序认得的标记（`u` / `d` / `g`），
   * 它就是"这一档编码"的说明、**不属于** base64url 正文。空标记 = 老格式（`deflate-raw`）。
   *
   * ⚠️ 切段只有 `readInviteSegment` 一处（见那里的注释：手写 `slice(1)` 会咬掉老格式的第一个字符）。
   * 调用方给的 `options.marker` 优先（宿主可能在切段时自己判过形态）；没给就自己判。
   */
  const seg = readInviteSegment(body, options?.marker);
  const kind = seg.kind;
  if (kind === null) {
    return {
      ok: false,
      reason: 'bad-base64url',
      message: `邀请码的压缩段带了一个本程序不认得的编码标记（"${seg.marker}"）：这不是本程序产出的邀请码。`,
    };
  }
  const compressed = seg.body;
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
  const format: InviteFormatRead = { kind, marker: seg.marker, compressedChars: compressed.length };
  /**
   * ★ 挑解压器：`'none'` 自己解（不需要任何设备能力）；其余按表取，缺项给人话。
   */
  let decoded: Uint8Array | null;
  if (kind === 'none') {
    decoded = base64UrlToBytes(compressed);
  } else {
    /**
     * ★ 函数形态**服务所有档**（不是只服务 `'raw'`）。
     *
     * 这里曾经写成 `kind === 'raw' ? decompress : undefined` ⇒ **降级链挑出来的每一档
     * 都解不开**（调用方明明把 `deflate` 那一档的真解压结果交进来了，纯层却当它不存在，
     * 报"本机没有这一档解压能力"）。实测抓到的坑：`1.-d…` 这条码在**能力齐全**的设备上
     * 也解不开，而 `decompressBase64` 单独调是同一条字节解得开的。
     * ⇒ 谁把 `kind` 交给了本函数，谁交的那个函数就**是**这一档的解压器。
     */
    const fn = typeof decompress === 'function'
      ? decompress
      : (decompress[kind] ?? options?.decompressors?.[kind]);
    if (fn === undefined) {
      return {
        ok: false,
        reason: 'decompress-unsupported',
        message:
          '这条邀请码用的是一种本机解不开的压缩方式（这条码是压缩档，而本机没有对应的解压能力）。' +
          '请把这台设备换成较新的浏览器打开本页，或让对方在你这台设备上重新生成一条邀请码。',
      };
    }
    decoded = fn(compressed);
  }
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
  return { ok: true, payload: { ...r.payload, p: proto }, proto: protocolVersionCheck(proto), format };
}

/**
 * 解码出来的"这一条码是用哪一档编码的"读数（成功面 `format` 字段；判据 ① 的界面读数靠它）。
 *
 *  - `kind`：`raw` / `deflate` / `gzip` / `none`（`CompressionKind`）；
 *  - `marker`：压缩段那个明文标记（老格式是空串）；
 *  - `compressedChars`：**去掉标记之后**的压缩段字符数（不含协议版本段与那个 `.`）。
 */
export interface InviteFormatRead {
  readonly kind: CompressionKind;
  readonly marker: string;
  readonly compressedChars: number;
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
 * 大厅需要把"没有配端点 ⇒ 短码走不了"与"端点这件事默认是什么状态"这两件事**分开**展示
 * （它有一个「高级 / 连接设置」区，那两句分别落在不同位置）。修复轮之前，大厅把后者**手写**
 * 了一遍（评审 §4.2 判为 §2 第 6 条的违例：同一件事有两个家）。
 *
 * ⇒ 处置是把那两句提成**导出常量**，本整句由它们拼成 —— 于是：
 *  - **唯一出处还是一个**（大厅渲染的是这两个常量本身，不是新写的一句）；
 *  - 判据 1 的"引用而不是复制"照旧成立。
 *
 * ## ★★ G5/T38：`NO_ENDPOINT_REASON` 的正文改了（**越界改动，已如实登记**）
 *
 * 原句是"…而本程序默认不向任何服务器发请求。" —— **T38 起这句不再成立**：默认 ICE 就要联系
 * `8.130.97.243` 的 STUN/TURN（`src/ui/net-browser.ts` 的 `DEFAULT_ICE_SERVERS`）。
 * 任务书 §2 要求"凡这类句子都要按事实改"，而这句话的**唯一出处就在本文件**
 * ⇒ 不改它就没法满足判据 4。改后说的是**端点这件事**的默认状态（仍然是真的），
 * 不再对本程序的出网行为下一个已经不成立的断言。
 */
export const NO_ENDPOINT_HEADLINE =
  '这台设备还没有配置信令端点，所以"输 6 位码"这条路暂时不可用：';

/** "为什么短码要端点" + "默认没有信令端点"（大厅的「高级 / 连接设置」区单独渲染它） */
export const NO_ENDPOINT_REASON =
  '6 位房间码要经一个信令服务才能把两端对上，而本程序默认没有配置信令端点（中继是另一件事，默认已经配好）。';

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
  /**
   * ★ D 轮（I-3 甲）：**这一局的会话号**。回示码与邀请码同形状、走同一条编码路
   * （`encodeInvite` 要求它非空）⇒ 加入方照抄邀请码里房主那一串即可 —— 它本来就是
   * "这一局"的名字，不是"谁写的"。
   */
  readonly sessionId: string;
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
    sessionId: input.sessionId,
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
  /** ★ D 轮（I-3 甲）：这一局的房主会话号（见 `InvitePayload.sessionId`） */
  readonly sessionId: string;
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
  decompress: ((compressed: Uint8Array) => Uint8Array | null) | DecompressorSet,
  kind: CompressionKind = 'raw',
): BuiltInvite | Extract<InviteEncodeResult, { ok: false }> {
  const encoded = encodeInvite(
    {
      p: input.protoVersion,
      sessionId: input.sessionId,
      sdp: input.sdp,
      ice: input.ice,
      hostPromise: input.hostPromise,
      guestPromise: input.guestPromise,
    },
    compress,
    decompress,
    kind,
  );
  if (!encoded.ok) return encoded;
  const payload = encoded.payload;
  return {
    ok: true,
    payload,
    link: inviteLinkOf(input.originAndPath, payload),
    chars: payload.length,
    withinMeasuredRange: payload.length >= INVITE_CHARS_MIN && payload.length <= INVITE_CHARS_MAX,
    kind,
    marker: markerOfKind(kind),
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
   *
   * ⚠️ 它钉的**只是压缩档**：未压缩变体（`kind === 'none'`）必然为 `false`
   * （见 `INVITE_CHARS_MAX_UNCOMPRESSED`），那不是异常，是这一档的固有长度。
   */
  readonly withinMeasuredRange: boolean;
  /** ★ G5/T40：这条码用的是哪一档编码 */
  readonly kind: CompressionKind;
  /** 压缩段的明文标记（`raw` 是空串） */
  readonly marker: string;
}
