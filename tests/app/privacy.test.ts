/**
 * 隐私边界文案守卫（G3 Task 5）。
 *
 * 规格出处：`docs/2026-09-13-联机与多端-设计稿.md`
 *  - **§0.4 三条红线**：红线 1（任何服务器都不存储卡组/昵称/个人信息/对局数据）、
 *    红线 3（游客模式下零写入磁盘）；
 *  - **§5.9 隐私边界表**（三行：信令服务 / TURN 中继 / 对端玩家 各自"能看到什么、看不到什么"）；
 *  - **§8.1 末尾**（"离线缓存写的是程序文件，不是用户数据 —— 必须对玩家说明"）。
 *
 * 判据分七层，**全部是行为腿**（跑函数拿返回值，不读源码找字符串，除"唯一出处"/"禁止绝对句"/
 * "禁止软化模态词"三条文本腿）：
 *  1. 结构：每组非空、无空串、无重复句、`privacyLines()` 与各组逐条一致（生成式）。
 *  2. **表驱动**：`BOUNDARY_DECLARATIONS` 把每条边界钉到"哪一组的哪句话"，
 *     逐条遍历断言 —— 而不是散着写 `expect(all).toMatch(...)`（那种写法改一个词就静默失去覆盖）。
 *  3. **唯一出处**：每句文案在全仓**玩家可见面**（`src/` + `tests/` + `index.html` + `public/**` 的文本文件）
 *     里**只有一处定义**（`src/app/privacy.ts` 自己）。
 *     用 `stripComments` 去注释后**逐字**计数 —— 裸 `not.toContain` 会被解释性注释假红
 *     （见 `tests/ui/source-text.ts` 开头记录的那次栽跟头），所以注释先剔、且只认完整句。
 *  4. 面向玩家 / 不泄露实现细节：无内部标识符、无 `src/app` 禁止的浏览器 API。
 *  5. 门槛标注：本阶段不存在的联机能力必须标注"上线后才适用"（不实陈述 = bug）。
 *
 * 已知局限（有意接受，写在这里以免被当成"已覆盖"）：表驱动判据是**关键词/正则在场**级别，
 * 不是自然语言蕴含检查 —— "猜疑的句式"在机器上无法与"如实的句式"区分。
 * 缓解手段是**双成分 + 逐行锚定**：既要求对象词（昵称/卡组/对局数据），也要求否定词
 * （看不到/不存储/…），两者必须同时出现在**同一条边界所绑定的那一组那一行**里，
 * 归属被写死（错组/错行都算不匹配）。
 *
 * ⚠️ 为什么还要"逐行"（评审 N5 实测）：只要否定词与对象词**同组**出现即可时，
 * 把 `:82` 改成".…看不到你的卡组文件；**但能看到**你的昵称、操作内容与对局数据"
 * （语义**反转**）仍 11/11 全绿 —— 因为那一行自己就有"看不到"和"卡组文件"。
 * 现在每条声明用 `line` 钉到具体第几条文案上（见 `BOUNDARY_DECLARATIONS` 与下方
 * "逐行锚定"的自检腿）。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import {
  PRIVACY_COPY,
  PRIVACY_GROUPS,
  BOUNDARY_IDS,
  ONLINE_GATE_MARK,
  assertBoundaryTable,
  isGatedCopyLine,
  privacyLines,
} from '../../src/app/privacy';
import type { PrivacyCopy, PrivacyBoundaryDeclaration, PrivacyGroupKey } from '../../src/app/privacy';
import { stripComments } from '../ui/source-text';
// 整句哈希（阻断 A 的判据）：复用仓内**既有**的 FNV-1a 64 位哈希（`src/core/fingerprint.ts`，
// 底座是 `src/core/rng.ts` 的 `hash32`）。**零新依赖**、纯整数运算 ⇒ 跨进程/跨机器稳定。
// 为什么不用 `node:crypto`：那要引平台模块，而这里只需要"稳定地指出两句是否相同"（同 `fingerprint.ts` 的定位）。
import { hash64 } from '../../src/core/fingerprint';

/* ───────────────────────── 1. 边界声明表（表驱动判据的唯一数据源） ───────────────────────── */

/**
 * 每条 = 设计稿里的一条边界声明。`line` 把声明钉到该组的**第几条文案**（0 起，逐行锚定）；
 * `requiredText` 只在这**一行**上校验：
 *  - 字面串 ⇒ 必须出现；
 *  - 正则   ⇒ 用它表达**否定断言**（如 /[^。]*看不到[^。]*(?:昵称|卡组)/）：
 *    只出现"昵称"不算数，必须同句有"看不到"。
 *
 * ⚠️ 这张表**故意写在测试里**（而不是 `src/app/privacy.ts` 里）：它是**判据**，不是产品数据。
 * 若它由被测模块导出，改文案的人顺手改表就能让门禁变绿 —— 判据与实现必须分居两个文件。
 */
const BOUNDARY_DECLARATIONS: readonly PrivacyBoundaryDeclaration[] = [
  /* ── §0.4 红线 1 + §5.9 第 1 行"信令服务" ── */
  {
    id: 'redline-1-no-server-storage',
    text: '红线 1：任何服务器都不存储卡组、昵称、对局数据（服务器即使存在，也只转发不存储）',
    group: 'noServerStorage',
    // 这条边界天然跨两条：第 0 条"不上传/不存到别人机器"，第 1 条"服务器只转发、不存储"
    line: [0, 1],
    requiredText: [
      // 用**完整字面句**而不是 /不会[^。]*上传/ 这类"前缀空匹配"的正则：
      // 空前缀只能证明"同一行"，证明不了"同一从句"（评审 N5 的教训）。
      '你的昵称、卡组与对局数据都不会被上传，也不会被存到别人的机器上。',
      '它也只会转发数据，不存储你的昵称、卡组、操作内容与对局数据。',
    ],
  },
  {
    id: 'signal-sees-room-code',
    text: '§5.9：信令服务能看到房间码、IP 地址、连接时刻',
    group: 'signalAndRelay',
    line: 0,
    requiredText: [/信令服务[^。]*能看到[^。]*房间码/, /IP\s*地址/, /连接时刻/],
  },
  {
    id: 'signal-cannot-see-content',
    text: '§5.9：信令服务看不到昵称、卡组、操作内容、对局数据',
    group: 'signalAndRelay',
    line: 0,
    requiredText: [
      // 整句枚举（可核对：这一行必须**只**说"能看到这些 / 看不到那些"）
      '信令服务只能看到房间码、IP 地址与连接时刻，看不到你的昵称、卡组、操作内容或对局数据。',
      // ⚠️ 只有"否定词 + 对象词"在场还**不够**：两者只要同行即可，把否定反转成
      // "…看不到你的卡组文件；但能看到你的昵称…"（N5 的 M1b）照样能满足。
      // 所以：① 用**整句字面串**钉住；② 两个方向的计数由下面那条
      // "signal/relay 的能看到/看不到必须精确到整句"腿负责（本函数只支持"必须出现"的成分）。
    ],
  },
  /* ── §5.9 第 2 行"TURN 中继" ── */
  {
    id: 'relay-sees-ip',
    text: '§5.9：中继（若启用）能看到加密流量与你的 IP（评审 N3 之前完全没有落点）',
    group: 'signalAndRelay',
    line: 1,
    requiredText: ['中继', '端到端加密', /中继[^。]*能看到你的 IP 地址/],
  },
  {
    id: 'relay-encrypted-unreadable',
    text: '§5.9：TURN 中继转发的是端到端加密流量，因而内容不可读',
    group: 'signalAndRelay',
    line: 1,
    requiredText: [/[^。]*端到端加密[^。]*不可读/, /中继/],
  },
  {
    id: 'relay-no-storage',
    text: '§5.9：TURN 中继不存储任何内容',
    group: 'signalAndRelay',
    line: 1,
    requiredText: [/[^。]*不存储/],
  },
  /* ── §5.9 第 3 行"对端玩家" ── */
  {
    id: 'peer-sees-ip',
    text: '§5.9：对端玩家能看到你的 IP（P2P 直连的必然结果）',
    group: 'peerVisible',
    line: 0,
    requiredText: [/对手[^。]*能看到[^。]*IP/, /直连/],
  },
  {
    id: 'peer-cannot-see-deck',
    text: '§5.9：对端玩家看不到你的卡组文件与 L1 配置（文案里说成"本机保存的设置"；**昵称必须除外**，见 N2）',
    group: 'peerVisible',
    line: 0,
    requiredText: [/看不到你的卡组文件/, /[^。]*看不到[^。]*本机保存的设置/],
  },
  {
    id: 'peer-nickname-via-channel',
    text: '§5.9 已知项 + §5.2 握手 nick + §14 末：对手昵称的来源就是 L1 配置里的昵称 ⇒ 对手**会**看到你的显示昵称，经加密通道直接交换（评审 N2）',
    group: 'peerVisible',
    line: 1,
    requiredText: [
      /对手会看到你的显示昵称/,
      /昵称[^。]*加密通道/,
      /不经过任何中间服务器/,
      // ⚠️ 补（阶段二复审 · 轻微缺口 N6）：这一行还有半句**可核对的不实承诺** ——
      // "只交换昵称这一项：卡组、设置与档案都不传"（若实现真传了设置，这句话就是假的）。
      // 实测删掉它 ⇒ 17/17 全绿（= 无覆盖），所以在这里钉住。
      // 它是**判据成分**，不是"第二份玩家可见文案"：它是整句的**后缀子串**，
      // 而"唯一出处"腿只对**完整句**计数（整句以门槛标注开头，测试里没有那份整句）。
      '而且只交换昵称这一项：卡组、设置与档案都不传。',
    ],
  },
  /* ── §3.5 / §3.6 / 红线 3：本地数据与授权 ── */
  {
    id: 'consent-before-local-write',
    text: '红线 3 / §3.6：只有用户点「允许」之后才把**用户数据**写进本机浏览器存储；在此之前不写任何用户数据',
    group: 'localOnly',
    // 跨两条：第 0 条 = 允许之前不写**用户数据**；第 1 条 = 被缓存的**程序文件**不是用户数据
    line: [0, 1],
    requiredText: [
      /授权弹窗/,
      /[^。]*之后[^。]*才会写进你自己的浏览器存储/,
      /[^。]*之前[^。]*不会写入任何你的数据/,
      // 必须点出被缓存的**程序文件**不属于用户数据（这是 B-1 裁决的另一半）
      '浏览器为离线打开而缓存的只有程序文件本身',
      '那不是你的数据',
    ],
  },
  {
    id: 'user-can-clear-local',
    text: '§3.6：用户随时可在设置里改授权 / 清理本机数据（≠ 只能选一次）',
    group: 'localOnly',
    line: 2,
    requiredText: [/本地数据与隐私/, /一键清除/],
  },
  {
    id: 'redline-3-guest-zero-write',
    text: '红线 3：拒绝授权（游客模式）时**用户数据**零写入，刷新或关闭即全丢',
    group: 'localOnly',
    line: 3,
    requiredText: [
      /[^。]*不会写入任何你的数据/,
      /[^。]*刷新或关闭[^。]*全部丢失/,
      /只存在内存里/,
      // 零写入的范围必须点明是"游戏数据"（昵称/设置/卡组），不是"磁盘"
      /[^。]*游戏的昵称、设置与卡组/,
    ],
  },
  /* ── §8.1：离线缓存（"必须对玩家说明"） ── */
  {
    id: 'offline-cache-program-files',
    text: '§8.1：预缓存的是**程序文件**（页面/脚本/样式/安装图标），不是整个游戏资源；离线只在首次缓存成功后可用（评审 N10）',
    group: 'offlineCacheNote',
    line: 0,
    requiredText: [
      /预缓存/,
      /程序文件/,
      /页面[^。]*脚本[^。]*样式[^。]*图标/,
      /[^。]*缓存成功之后[^。]*断网也能打开/,
      /缓存没完成[^。]*需要联网/,
    ],
  },
  {
    id: 'offline-cache-runtime-assets',
    text: '§8.1 + sw.js 实际行为（评审 N1）：卡图等大体积资源既不在预缓存里，sw 的 fetch 段也**不写缓存**（只 cache-first 读）⇒ 用过的资源只**可能**留在浏览器自己的缓存里，没看过的首次断网打不开',
    group: 'offlineCacheNote',
    line: 1,
    requiredText: [
      /运行期缓存/,
      /卡图/,
      /用过之后/,
      // 机制归属必须软化到"取决于浏览器"，不得说成"本站一定缓存了"
      /由浏览器自己的缓存决定/,
      /取决于你的浏览器设置/,
      /没看过的内容[^。]*打不开/,
    ],
  },
  {
    id: 'offline-cache-not-user-data',
    text: '§8.1：两类缓存里都不是用户数据（这是红线 1 的边界，须写清）',
    group: 'offlineCacheNote',
    line: 1,
    requiredText: [/[^。]*不是用户数据/, /昵称[^。]*卡组[^。]*档案[^。]*对局记录[^。]*不在缓存里/],
  },
];

/* ───────────────────────── 2. 唯一出处：全仓逐字计数 ───────────────────────── */

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
/** 文案唯一出处的**规范来源**（相对路径，正斜杠） */
const COPY_FILE = 'src/app/privacy.ts';

/**
 * 递归收集**玩家可见面的文本文件**。`entry` 可以是目录，也可以是单个文件
 * （`index.html` 在仓库根，不是目录）。
 *
 * 评审 N7 实测（M5）：把一句文案抄进 `index.html` 曾 11/11 全绿 —— 因为扫描面只有
 * `src/` + `tests/`，而 `index.html` 与 `public/**` **同样是玩家可见面**。
 * 二进制资源（png/jpg/pdf/mp4）按**扩展名白名单**排除，不做内容嗅探（零依赖）。
 */
function walk(entry: string, out: string[] = []): string[] {
  const stats = statSync(entry);
  if (stats.isDirectory()) {
    for (const name of readdirSync(entry)) walk(join(entry, name), out);
  } else if (/\.(?:ts|tsx|js|mjs|css|html|json|webmanifest|md)$/.test(entry)) {
    out.push(entry);
  }
  return out;
}

/** 逐字比较前的规范化：换行/空白统一，弯引号统一成直引号（中文文案里两种引号混用很常见） */
function normalize(s: string): string {
  return s
    .replace(/\s+/g, ' ')
    .replace(/[「」“”‘’]/g, '"')
    .trim();
}

function countOccurrences(haystack: string, needle: string): number {
  if (needle.length === 0) return 0;
  let count = 0;
  let at = haystack.indexOf(needle);
  while (at >= 0) {
    count += 1;
    at = haystack.indexOf(needle, at + needle.length);
  }
  return count;
}

/** 在给定"文件 → 去注释文本"的映射里，逐字出现某句的文件清单（唯一出处判据的**唯一实现**） */
function holdersOf(sources: ReadonlyMap<string, string>, line: string): string[] {
  const target = normalize(line);
  return [...sources].filter(([, text]) => text.includes(target)).map(([rel]) => rel);
}

/** 去注释后的源码文本（键 = 相对路径，正斜杠） */
const SOURCES = new Map<string, string>();
// 玩家可见面 = 源码 + 测试 + 仓库根的 index.html + public/** 的文本文件（评审 N7）
for (const base of ['src', 'tests', 'public', 'index.html']) {
  for (const file of walk(join(REPO_ROOT, base))) {
    const rel = file.slice(REPO_ROOT.length).replace(/\\/g, '/');
    SOURCES.set(rel, normalize(stripComments(readFileSync(file).subarray(0, 4 * 1024 * 1024).toString('utf8'))));
  }
}

/* ───────────────────────── 3. 面向玩家的措辞 ───────────────────────── */

/**
 * **内部标识符**清单（出现即"泄露实现细节"）：键名、存储机制、模块名 —— 玩家读不懂，
 * 而且一旦写进面向玩家的文案，重构会把它变成谎言。
 */
const INTERNAL_TOKENS = [
  'localStorage',
  'sessionStorage',
  'indexedDB',
  'Service Worker',
  'service worker',
  'L1',
  'L2',
  'MatchFile',
  'cardDataHash',
  'match-file',
  'privacy.ts',
  'consent',
  'PRIVACY_COPY',
  'DraftPool',
  'defId',
];

/**
 * `src/app` 是纯逻辑层：不得出现浏览器 API（Task 9 守卫同口径）。
 *
 * ⚠️ 判据口径（评审 N8 澄清）：本正则认的是**成员访问**（`localStorage.setItem`，含属性读取）
 * 与**调用**（`fetch(`）两种形态 —— 计划口径就是"**调用**零命中"，所以判据本身没错；
 * 错的是早先的**腿名/说明文字**写成了"不出现浏览器 API"，比判据强（裸引用一个未调用的
 * `localStorage` 不会被抓到，M3b2 实测 11/11 绿 + tsc 0）。
 * 本轮：① 说明文字改成与判据一致；② 顺手补上 `globalThis.<api>` 分支
 * （与 `tests/core-purity.test.ts:91` 同口径：换前缀绕开同一个洞）。
 */
const BROWSER_API = /(?:\b(?:window|document|navigator|localStorage|sessionStorage|indexedDB|XMLHttpRequest|WebSocket)\s*(?:\.|\[)|\b(?:fetch|requestAnimationFrame|cancelAnimationFrame)\s*\(|\bglobalThis\s*\.\s*(?:window|document|navigator|fetch|localStorage|sessionStorage|indexedDB|XMLHttpRequest|WebSocket|requestAnimationFrame|cancelAnimationFrame)\b)/;

/* ───────────── 4. 承诺句的**整句哈希钉死**（阶段二复审 · 阻断 A） ───────────── */

/**
 * **每一条玩家可见文案的整句哈希**（键 = 组 + 行号，值 = `hash64(整句)`）。
 *
 * ## 为什么必须存在（阻断 A 的裁决）
 *
 * 早先"不许有绝对句"是**子串黑名单**（`ABSOLUTE_FORMS` 那 7 条）+ "范围化那句必须在"是
 * **子串必须存在**（`toMatch(/不会写入任何你的数据/)`）。两者的合取是一个**只认识旧措辞**的判据：
 * 保留必须子串、再**追加**一条黑名单里没有的新绝对句 —— 实测
 * `localOnly[0]` 改成"…不会写入任何你的数据，本机零写入。" ⇒ **17/17 全绿**；
 * `localOnly[3]` 同族 ⇒ **17/17 全绿**。
 * 任何黑名单都追不上自然语言的措辞空间（"本机零写入""硬盘上没有任何你的数据"
 * "不会在本机留下任何数据"…），所以这里改成**整句身份**：只要某句话的**任何一个字符**变了
 * （追加 / 删改 / 换词 / 增删行 / 移位），哈希就对不上 ⇒ 红。
 *
 * ## 为什么是**全量 12 条**而不是只钉那两句
 *
 * 精选清单**本身就是黑名单**：新加的第 13 句天然不在清单里，于是"追加一条新绝对句"
 * 只要换个位置（比如塞进 `noServerStorage`）就又能穿透。全量 + "每一句都必须有钉"
 * （**生成式**：遍历 `PRIVACY_GROUPS` × 各自的行号，见 `copyEntries`）没有这个缺口。
 *
 * ## 为什么报错里必须打印**实际那句话**
 *
 * 哈希对不上时，维护者只知道"某句变了"，不知道"变成了什么"。`pinDrift()` 的报错带
 * **实际文案 + 实际哈希 + 钉住哈希** ⇒ 重新钉 = 把报错里的实际哈希抄回下表。
 *
 * ## ⚠️ 这是**故意的摩擦**（设计意图，不是缺陷）
 *
 * 面向玩家的隐私承诺**不许**被顺手改掉：改一个字就红，逼一次人工复核
 * （"这句话改成这样还对玩家诚实吗？"）。代价 = 将来**任何**合法改文案都要重算哈希；
 * 这正是要付的价钱 —— 承诺文案的漂移就是**对玩家的不实陈述**（阶段一评审 B-1）。
 * 它**不**取代行为腿：表驱动 / 逐行锚定 / 行级唯一落点 / 门槛对称性等判据仍然独立成立。
 *
 * 顺序 = `PRIVACY_GROUPS` 的声明顺序 × 组内行号（由下面"逐位相等"的腿钉住）。
 */
const COPY_PINS: ReadonlyArray<{ group: PrivacyGroupKey; line: number; hash: string }> = [
  // 红线 1：服务器不存
  { group: 'noServerStorage', line: 0, hash: '6f992822596a369f' },
  { group: 'noServerStorage', line: 1, hash: '5fcf31c75c5b7b75' },
  // 红线 3 + §3.6：授权前不写用户数据 / 程序文件不是用户数据 / 可清除 / 游客零写入
  { group: 'localOnly', line: 0, hash: 'c22ab6f10d151d6f' },
  { group: 'localOnly', line: 1, hash: '22f8b0898e7fe940' },
  { group: 'localOnly', line: 2, hash: '082e4a7ef6ae37c1' },
  { group: 'localOnly', line: 3, hash: 'a61a40d9960e2a30' },
  // §5.9 第 3 行：对端玩家能看到/看不到什么（含"只交换昵称这一项"那半句）
  { group: 'peerVisible', line: 0, hash: 'cc25e4bea9cb4d98' },
  { group: 'peerVisible', line: 1, hash: 'ecf41ba6a1ad65c2' },
  // §8.1：离线缓存语义
  { group: 'offlineCacheNote', line: 0, hash: '25cc9a98f0cff4dc' },
  { group: 'offlineCacheNote', line: 1, hash: '9bcdf3506e9b4361' },
  // §5.9 第 1、2 行：信令 / 中继
  { group: 'signalAndRelay', line: 0, hash: '930ebfa765c90da0' },
  { group: 'signalAndRelay', line: 1, hash: '4dd1a1a32afa8dfe' },
];

/** `组[行号]` 的稳定键（钉住表与真实文案之间的**唯一**连接方式 —— 它不含任何文案本身） */
function copyKey(group: string, line: number): string {
  return `${group}[${line}]`;
}

/** 真实文案里每一句的 (键, 组, 行号, 文本)，顺序 = `PRIVACY_GROUPS` × 组内顺序（**生成式**） */
function copyEntries(copy: PrivacyCopy): Array<{ key: string; group: PrivacyGroupKey; line: number; text: string }> {
  return PRIVACY_GROUPS.flatMap((group) =>
    copy[group].map((text, line) => ({ key: copyKey(group, line), group, line, text })),
  );
}

/** 取某组某一行的**真实文案**（取不到就响亮抛错，而不是返回空串让上层假绿） */
function copyLine(group: PrivacyGroupKey, line: number): string {
  const text = PRIVACY_COPY[group][line];
  if (typeof text !== 'string') throw new Error(`取不到 ${copyKey(group, line)}（结构被改动了？）`);
  return text;
}

/**
 * 逐句比对整句哈希，返回**人可读的漂移清单**（空数组 = 全绿）。
 * 传 `copy` 参数是为了让正控能喂**合成文案**（绝不改真文件）。
 */
function pinDrift(copy: PrivacyCopy, pins = COPY_PINS): string[] {
  const pinByKey = new Map(pins.map((p) => [copyKey(p.group, p.line), p.hash]));
  return copyEntries(copy).flatMap((e) => {
    const pin = pinByKey.get(e.key);
    const actual = hash64(e.text);
    if (pin === undefined) {
      return [`  ${e.key}：**没有钉**（多了一句话 ⇒ 必须人工复核并补上哈希）\n    实际文案：${e.text}\n    实际哈希：${actual}`];
    }
    if (pin === actual) return [];
    return [`  ${e.key}：整句哈希对不上\n    实际文案：${e.text}\n    实际哈希：${actual}\n    钉住哈希：${pin}`];
  });
}

/** 复制一份文案、只替换 `group[line]`（正控专用：不改 `PRIVACY_COPY`） */
function withLine(group: PrivacyGroupKey, line: number, text: string): PrivacyCopy {
  const next: PrivacyCopy = { ...PRIVACY_COPY };
  next[group] = PRIVACY_COPY[group].map((l, i) => (i === line ? text : l));
  return next;
}

/** 钉住表的键序列（与真实文案的键序列比较时必须**逐位相等**） */
function pinKeys(): string[] {
  return COPY_PINS.map((p) => copyKey(p.group, p.line));
}

/* ───────────────────────────────── 判据 ───────────────────────────────── */

describe('隐私说明文案（§5.9 / §8.1）', () => {
  it('每一组都不为空、没有空串、没有重复句（生成式：遍历运行期组清单）', () => {
    for (const key of PRIVACY_GROUPS) {
      const lines = PRIVACY_COPY[key];
      expect(lines.length, `${key} 不该为空`).toBeGreaterThan(0);
      for (const l of lines) expect(l.trim().length, `${key} 里有空行`).toBeGreaterThan(0);
    }
    // 重复句 = 同一句被维护两份（"唯一出处"在**组内**也成立）
    const all = privacyLines();
    expect(new Set(all).size, '有完全重复的文案行（同一句被写了两次）').toBe(all.length);
    // 扫描面自检：空了就说明 REPO_ROOT 算错，否则"唯一出处"判据会**假绿**
    expect(SOURCES.size, '源码扫描面为空（REPO_ROOT 算错？）').toBeGreaterThan(200);
    expect(SOURCES.has(COPY_FILE), `${COPY_FILE} 不在扫描面里（唯一出处判据会假绿）`).toBe(true);
    // 扫描面自检（评审 N7）：玩家可见面必须**真的**被扫到，否则"唯一出处"对 index.html/public 假绿
    expect(SOURCES.has('index.html'), 'index.html 不在扫描面里（抄一句文案进去不会被抓到）').toBe(true);
    expect(SOURCES.has('public/sw.js'), 'public/** 不在扫描面里（评审 N7 的 M5 形态）').toBe(true);
    expect(SOURCES.has('public/manifest.webmanifest'), 'public/** 的 json 不在扫描面里').toBe(true);
    // 二进制资源必须**不在**扫描面里（否则 4MB 上限会把 png 读成乱码，白烧时间）
    expect([...SOURCES.keys()].some((k) => /\.(?:png|jpg|jpeg|pdf|mp4)$/i.test(k)), '二进制资源不该进扫描面').toBe(false);
  });

  it('privacyLines() 与各组逐条一致（生成式：拍平结果必须覆盖每一组、且顺序一致）', () => {
    const all = privacyLines();
    for (const key of PRIVACY_GROUPS) for (const l of PRIVACY_COPY[key]) expect(all).toContain(l);
    expect(all).toEqual(PRIVACY_GROUPS.flatMap((k) => PRIVACY_COPY[k]));
  });

  it('表驱动：每条边界声明都在它指定的那一组文案里命中（逐条对应，散断言无法覆盖到此）', () => {
    const mismatches = assertBoundaryTable(BOUNDARY_DECLARATIONS, PRIVACY_COPY, isGatedCopyLine);
    expect(
      mismatches,
      `以下边界声明在对不上文案（missing = 缺失的关键成分）：\n${mismatches
        .map((m) => `- ${m.id} @ ${m.group} 缺 ${JSON.stringify(m.missing)}\n  该组文案：${m.groupText}`)
        .join('\n')}`,
    ).toEqual([]);
    // 表本身的自检（**生成式**，评审 N3 的协调者要求：不许手写 `length === 14`）：
    //  ① 覆盖：每个 `BoundaryId` 成员都至少有 1 条声明（漏一条声明 ⇒ 这一条报红）
    //  ② 闭包：不存在指向 union 之外的 id（由类型保证，这里再按运行期清单复算一遍）
    //  ③ 唯一：id 不重复；④ 参与：每个文案组都被至少一条声明引用
    const declaredIds = new Set(BOUNDARY_DECLARATIONS.map((d) => d.id));
    // `table-*` 是 **表自身一致性判据** 的 id（由 `assertBoundaryTable` 直接产出，
    // 不是设计稿里的边界）⇒ 不该要求它们出现在声明表里。
    // ⚠️ 豁免清单是**显式且封闭的**：只要有人把它撑大，下面那条断言就会红。
    const TABLE_SELF_IDS: readonly string[] = ['table-covers-gated-group', 'table-gate-mark-symmetry'];
    const exempt = BOUNDARY_IDS.filter((id) => TABLE_SELF_IDS.includes(id));
    expect(exempt.length, '只有这两条"表自身"的 id 可以没有声明行').toBe(TABLE_SELF_IDS.length);
    const uncovered = BOUNDARY_IDS.filter((id) => !TABLE_SELF_IDS.includes(id) && !declaredIds.has(id));
    expect(uncovered, `这些边界 id 一条声明都没有（表被删空/漏加）：${uncovered.join(', ')}`).toEqual([]);
    const unknown = [...declaredIds].filter((id) => !(BOUNDARY_IDS as readonly string[]).includes(id));
    expect(unknown, `这些声明指向了 union 之外的 id：${unknown.join(', ')}`).toEqual([]);
    expect(new Set(BOUNDARY_DECLARATIONS.map((d) => d.group)).size).toBe(PRIVACY_GROUPS.length);
    expect(new Set(BOUNDARY_DECLARATIONS.map((d) => d.id)).size).toBe(BOUNDARY_DECLARATIONS.length);
    // ⑤ 逐行锚定是**真的**在用：每条声明都必须带 `line`（缺一个 ⇒ 那条退回"整组文本"口径，
    //    N5 的 M1b 就能复活）。这条自检让"新声明忘写 line"变红，而不是静默降级。
    const noLine = BOUNDARY_DECLARATIONS.filter(
      (d) => d.line === undefined || (Array.isArray(d.line) && d.line.length === 0),
    ).map((d) => d.id);
    expect(noLine, `这些声明没有 line（逐行锚定会静默失效）：${noLine.join(', ')}`).toEqual([]);
  });

  it('逐行锚定：每条声明只在自己那一行上校验（换行即失效 —— N5 的 M1b 形态）', () => {
    // 这条腿是**判据的判据**：`assertBoundaryTable` 只在这**一行**上验证 requiredText，
    // 于是把否定反转的句子搬到同一组的另一行 ⇒ 必红。用它自己造的合成文案做正控，
    // 证明"逐行"确实生效（否则 `line` 字段只是装饰）。
    // ⚠️ 输入的构造要小心：把 signalAndRelay 清空会顺带叫醒两条**表自身**的门槛判据
    // （`table-covers-gated-group` / `table-gate-mark-symmetry`）—— 那是别的腿的职责，
    // 与本腿无关。所以这里：① 表只取 peerVisible 的声明；② 只断言 peerVisible 的不匹配。
    const mk = (peerLines: string[]): PrivacyCopy => ({
      ...PRIVACY_COPY,
      peerVisible: peerLines,
      signalAndRelay: [],
    });
    const peerDecls = BOUNDARY_DECLARATIONS.filter((d) => d.group === 'peerVisible');
    const peerOnly = (m: ReturnType<typeof assertBoundaryTable>): string[] =>
      m.filter((x) => x.group === 'peerVisible').map((x) => x.id);
    // 正控 1：真实文案（信号组置空以避开无关判据）⇒ peerVisible 0 处不匹配
    expect(peerOnly(assertBoundaryTable(peerDecls, mk([...PRIVACY_COPY.peerVisible]), isGatedCopyLine))).toEqual([]);
    // 正控 2：把 line 0 的"看不到"反转成"但能看到"（M1b 的真实形态）⇒ 必须报出不匹配
    const inverted = mk(PRIVACY_COPY.peerVisible.map((l, i) => (i === 0 ? l.replace('但看不到你的卡组文件', '但能看到你的卡组文件') : l)));
    expect(inverted.peerVisible[0], '正控构造失败：句子里没有可反转的片段').not.toBe(PRIVACY_COPY.peerVisible[0]);
    const bad = assertBoundaryTable(peerDecls, inverted, isGatedCopyLine);
    expect(bad.map((m) => m.id), '把否定反转后竟然还全绿（逐行锚定没有生效）').toContain('peer-cannot-see-deck');
    // 正控 3：把整句挪到**同组另一行**（line 1）⇒ 同样必须报红（证明是"行"锚定，不是"组"锚定）
    const moved = mk([PRIVACY_COPY.peerVisible[1], PRIVACY_COPY.peerVisible[0]]);
    const bad2 = assertBoundaryTable(peerDecls, moved, isGatedCopyLine);
    expect(bad2.length, '两行互换后竟然还全绿（说明校验的是整组文本，不是逐行）').toBeGreaterThan(0);
  });

  it('signal/relay 的"能看到 / 看不到"必须**精确到整句**（M1b 的反转句式无处藏身）', () => {
    // N5 的 M1b 形态：把 `:82` 改成"…看不到你的卡组文件；**但能看到**你的昵称、操作内容与对局数据"
    // ⇒ 旧判据（否定词与对象词同组出现）11/11 全绿。逐行锚定只是第一步：
    // 这一条把两个方向**各自枚举整句**，任何"反转/追加能看到"都会破坏字面串。
    const line = (id: string): string => {
      const d = BOUNDARY_DECLARATIONS.find((x) => x.id === id);
      if (!d || d.line === undefined) throw new Error(`找不到 ${id} 的逐行锚定`);
      const idx = Array.isArray(d.line) ? d.line[0] : d.line;
      return PRIVACY_COPY[d.group][idx];
    };
    const count = (hay: string, needle: string): number => hay.split(needle).length - 1;
    const signalLine = line('signal-sees-room-code');
    expect(count(signalLine, '能看到'), '信令那句的"能看到"必须恰好一次（多了说明能看到的范围被扩大）').toBe(1);
    expect(count(signalLine, '看不到'), '信令那句的"看不到"必须恰好一次').toBe(1);
    // 逐句枚举：正向列表与负向列表都必须**原样**在
    expect(signalLine).toContain('信令服务只能看到房间码、IP 地址与连接时刻');
    expect(signalLine).toContain('看不到你的昵称、卡组、操作内容或对局数据');
    // 反转正控（合成样本，不动真文案）：M1b 的句式必须与上面两条字面串**不相容**
    const m1b = signalLine.replace('看不到你的昵称', '但能看到你的昵称');
    expect(m1b, '正控失效：M1b 反转后竟然还满足字面串').not.toContain('看不到你的昵称、卡组、操作内容或对局数据');
    expect(count(m1b, '能看到'), '正控失效：反转后"能看到"计数没变多').toBe(2);
    // 中继那行必须自带"能看到 IP"（§5.9 中继行）而不是靠信令那行代答
    const relayLine = line('relay-sees-ip');
    expect(relayLine).toMatch(/中继[^。]*能看到你的 IP 地址/);
    expect(relayLine, '中继行不得复述信令的"看不到昵称"（那会让归属变糊）').not.toContain('看不到你的昵称');
  });

  it('联机那三行的"看不到"列表里不得混进昵称/卡组之外的自曝（N2 的反向判据）', () => {
    // 评审 N2 的缺口：声明表只能要求"必须出现什么"，表达不了"**不许**出现什么"。
    // 实测把 `:74` 的"…也看不到你在本机保存的设置。" 改成"…设置**与昵称**。"
    // ⇒ 16/16 全绿（昵称被说成对手看不到 = 与设计稿 §5.9 已知项 + §5.2 握手的 `nick` 直接冲突）。
    // 这一条按**从句**把"看不到"后面的内容切出来，逐项核对白名单。
    const forbiddenFor = (group: PrivacyGroupKey, idx: number): string => {
      const line = PRIVACY_COPY[group][idx];
      const parts = line.split('看不到');
      parts.shift(); // 丢掉"看不到"之前的部分（那是"能看到"的列表）
      return parts.join('看不到');
    };
    // 联机对手（peerVisible[0]）与信令（signalAndRelay[0]）的"看不到"白名单：
    // 对手：卡组文件、本机保存的设置；信令：昵称、卡组、操作内容、对局数据。
    const peerForbidden = forbiddenFor('peerVisible', 0);
    expect(peerForbidden, '正控：peerVisible[0] 必须真的有"看不到"从句').toContain('卡组文件');
    expect(peerForbidden, '对手"看不到"的列表里混进了昵称（N2 的失效形态：对手**会**看到显示昵称）')
      .not.toContain('昵称');
    const signalForbidden = forbiddenFor('signalAndRelay', 0);
    expect(signalForbidden, '正控：signalAndRelay[0] 必须真的有"看不到"从句').toContain('昵称');
    // 昵称只能出现在信令的"看不到"列表里（信令看不到明文昵称）——
    // 逐组枚举，任何别处出现"看不到…昵称"都要报红。
    const nickHiddenGroups = PRIVACY_GROUPS.filter((g) =>
      PRIVACY_COPY[g].some((l) => /看不到[^。]*昵称/.test(l)),
    );
    expect(nickHiddenGroups, '只有信令那一行可以说"看不到昵称"（对手会看到显示昵称，缓存里也不含昵称）')
      .toEqual(['signalAndRelay']);
    // 反向正控（合成样本，不动真文案）：把昵称塞进对手的"看不到"从句 ⇒ 上面那条必须红
    const tampered = PRIVACY_COPY.peerVisible[0].replace('本机保存的设置。', '本机保存的设置与昵称。');
    expect(/看不到[^。]*昵称/.test(tampered), '正控失效：篡改后竟未被识别').toBe(true);
  });

  it('peerVisible 组里「昵称」只能落在**指定的那一行**（行级唯一落点 · 阻断 B）', () => {
    // ## 为什么要有它（阶段二复审 · 阻断 B）
    // 上面那条反向腿有**两种**不完整口径：① 正则 `/看不到[^。]*昵称/` 只认"看不到…昵称"的
    // **同一从句**；② `forbiddenFor` 却把 `split('看不到')` 之后直到**行尾**的内容都算"看不到列表"。
    // 本轮我按**实测**记（修复轮 2 的修复前基线跑，见 `.superpowers/g3-t5-r2/mut-pre-fix.log`）：
    //  · 复审报的穿透形态（`…设置。你的昵称也一览无余。`）在**修复前是红的** —— 旧腿的
    //    `forbiddenFor(...).not.toContain('昵称')` 抓到了它（因为口径 ② 会吃掉句号之后的整段）。
    //    复审自己的原始日志 `.superpowers/probe-out/P_N2_PERIOD.log` 也写着 `1 failed | 16 passed`。
    //    ⚠️ 这与复审报告里"17/17 全绿"的说法**不一致**；我按实测与它自己的日志记录，不照抄结论。
    //  · 真正的活缺口在**同一族**的另一半：把"昵称"放到**第一个「看不到」之前**（"能看到"列表）、
    //    或让该行根本不出现「看不到」时，旧腿两条口径都绿。实测（同一条腿同一份文件）：
    //    `对手能看到你的 IP 地址` → `对手能看到你的昵称与 IP 地址` ⇒ 修复前 **17/17 全绿**，
    //    修复后必红（`P_N2_PUT_0`）。
    //
    // 语义前提（设计稿 §5.9 已知项 + §5.2 握手 `nick` + §14 末）：**对手正是会看到你的显示昵称**。
    // ⇒ 在 `peerVisible` 这个组里，除了那条"对手会看到…显示昵称"的合法声明之外，
    // **不存在**需要再提"昵称"的第二处理由（无论说它"看不到"、还是把它放进"能看到"列表）。
    // 判据 = **行级唯一落点**：整个组里出现「昵称」的行，必须**恰好**是那条声明指定的行。
    // 它不依赖"看不到"这个词的在场与位置，也不依赖任何从句/句号切分 —— 只要"昵称"出现在
    // 非指定行（句号之后 / 句号之前 / "能看到"列表里 / 整行没有"看不到"）都红。
    //
    // **生成式**：指定行**不是**手写常量，而是从 `BOUNDARY_DECLARATIONS` 里
    // `peer-nickname-via-channel` 的 `line` 字段派生（声明表是"昵称该落在哪一行"的唯一出处；
    // 在测试里再手写一份行号清单，会在声明漂移时静默失去覆盖）。
    const nickDecl = BOUNDARY_DECLARATIONS.find((d) => d.id === 'peer-nickname-via-channel');
    if (!nickDecl || nickDecl.line === undefined) throw new Error('找不到 peer-nickname-via-channel 的逐行锚定（判据会假绿）');
    const owner = Array.isArray(nickDecl.line) ? [...nickDecl.line] : [nickDecl.line];
    expect(owner.length, '昵称的落点必须是**一行**（多行就不是"唯一落点"）').toBe(1);
    expect(nickDecl.group, '本判据的语义前提是"peerVisible 组"（组名变了要重新推一遍意图）').toBe('peerVisible');
    const group: PrivacyGroupKey = nickDecl.group;
    /** 该组里**出现「昵称」的行号**（生成式：扫整个组，不是手写清单） */
    const carriersOf = (copy: PrivacyCopy): number[] =>
      copy[group].flatMap((l, i) => (l.includes('昵称') ? [i] : []));
    // 正控（真文案）：恰好只在指定那一行
    expect(carriersOf(PRIVACY_COPY), `「昵称」只能出现在 ${group}[${owner[0]}]（"对手会看到你的显示昵称…"那条），其它任何行出现都是语义冲突`).toEqual(owner);
    // 判据自检：那一行**真的**提了昵称（否则"哪里都没有"也能满足上面那条 = 恒真）
    expect(PRIVACY_COPY[group][owner[0]], '指定的那一行居然没提昵称（判据会恒真/假绿）').toContain('昵称');
    // ── 三条变异形态（全部是**合成样本**，不改真文件）──
    // ① 复审报的形态 `P_N2_PERIOD`（= `P_N2_REWORD_B`，注入串相同）：把"昵称"放到**句号之后**
    //    （修复前它是**红**的 —— 由旧腿的口径 ② 抓到；见上面注释与复审自己的日志）
    const period: PrivacyCopy = { ...PRIVACY_COPY };
    period[group] = PRIVACY_COPY[group].map((l, i) =>
      i === 0 ? l.replace('也看不到你在本机保存的设置。', '也看不到你在本机保存的设置。你的昵称也一览无余。') : l,
    );
    expect(period[group][0], '变异构造失败：没塞进"你的昵称也一览无余"').toContain('你的昵称也一览无余');
    expect(carriersOf(period), '句号之后的"昵称"没被抓到（阻断 B 未修复）').not.toEqual(owner);
    // ② 把"昵称"搬到 `peerVisible[0]` 的**任意位置**（这里放进"能看到"的列表里）
    const movedAt: PrivacyCopy = { ...PRIVACY_COPY };
    movedAt[group] = PRIVACY_COPY[group].map((l, i) =>
      i === 0 ? l.replace('对手能看到你的 IP 地址', '对手能看到你的昵称与 IP 地址') : l,
    );
    expect(movedAt[group][0], '变异构造失败：没把昵称搬进第 0 行').toContain('对手能看到你的昵称');
    expect(carriersOf(movedAt), '把"昵称"搬到第 0 行竟然没被抓到').not.toEqual(owner);
    // ③ "搬家"形态：从指定行**彻底移走**昵称、只留在第 0 行 ⇒ 落点集合变成 [0] ⇒ 也要红
    const movedAway: PrivacyCopy = { ...PRIVACY_COPY };
    movedAway[group] = PRIVACY_COPY[group].map((l, i) =>
      i === 0
        ? l.replace('对手能看到你的 IP 地址', '对手能看到你的昵称与 IP 地址')
        : l.replaceAll('昵称', '资料'),
    );
    expect(carriersOf(movedAway), '昵称搬走之后落点集合竟然是 [0] 以外的东西').toEqual([0]);
    expect(carriersOf(movedAway), '"昵称"整体搬家（落点从 1 变 0）竟然没被抓到').not.toEqual(owner);
    // ④ 负控：真文案一字不动 ⇒ 必须仍绿（= 这条判据不是"永远红"）
    expect(carriersOf({ ...PRIVACY_COPY })).toEqual(owner);
    // ⑤ 反向正控：把昵称从**整个组**里删光 ⇒ 落点空集也必须红（否则"删掉就安全"成了漏洞）
    const nickless: PrivacyCopy = { ...PRIVACY_COPY };
    nickless[group] = PRIVACY_COPY[group].map((l) => l.replaceAll('昵称', '资料'));
    expect(carriersOf(nickless), '把昵称从整组删光竟然仍被判为合规').not.toEqual(owner);
  });

  it('§5.9 三行必须各有落点（信令 / 中继 / 对端）且不得由别组代答', () => {
    const all = privacyLines().join('\n');
    expect(all).toMatch(/房间码|信令/);
    expect(all).toMatch(/IP/);
    expect(all).toMatch(/端到端加密|不可读/);
    expect(all, '必须明说服务器不存卡组/昵称/对局数据').toMatch(/不存(?:储)?/);
    // "归属"判据（行为腿）：把 signalAndRelay 抽空后，上述落点必须**找不到**
    // —— 若还能满足，说明是别的组在替它作答（= §5.9 第 1/2 行没有真正落点）
    const withoutRelay: PrivacyCopy = { ...PRIVACY_COPY, signalAndRelay: [] };
    const mismatches = assertBoundaryTable(
      BOUNDARY_DECLARATIONS.filter((d) => d.group === 'signalAndRelay'),
      withoutRelay,
      isGatedCopyLine,
    );
    const gateRows = BOUNDARY_DECLARATIONS.filter((d) => d.group === 'signalAndRelay');
    // ① 生成式：该组的声明 id 必须**恰好**是 `BOUNDARY_IDS` 里 `signal-` / `relay-` 前缀的那些
    //    （§5.9 第 1、2 行的命名约定）。任一侧单飞（声明被搬走 / union 被改）都红。
    const signalRelayIds = BOUNDARY_IDS.filter((id) => /^(?:signal|relay)-/.test(id));
    expect(signalRelayIds.length, '`signal-`/`relay-` 前缀的边界 id 不该为空（否则下面的等式恒真）').toBeGreaterThan(0);
    expect(gateRows.map((d) => d.id).sort(), 'signalAndRelay 组的声明 id 与 `BOUNDARY_IDS` 的 signal/relay 成员不一致')
      .toEqual([...signalRelayIds].sort());
    // ② **整等**（2026-09-17 协调者裁定，撤销上一轮"保留 `>= 5`"的指示）：
    //    下界 `>=` 抓不住「**净新增**一条 gate 声明」这个信号（5 条变 6 条时 `6 >= 6` 照样绿），
    //    而"这一组该有几条边界"是设计稿 §5.9 第 1、2 行的事实 ⇒ 变化必须由人看一眼。
    //    这个常数是**人工复核闸门**（不是"手写清单代替生成式"）：上面 ① 已经把 id 集合
    //    与 union 双向钉住，这里只补"数量"这一维。
    expect(gateRows.length, 'signalAndRelay 的边界声明数变了（净增/净减都必须人工复核）').toBe(5);
    // ③ 下界仍然保留（不是放宽）：抽空该组后**每一条**声明都必须不匹配，一条都不许蒙对；
    //    `assertBoundaryTable` 还会额外产出两条表自身的不匹配，所以这里只能是 `>=` 而不是 `==`。
    expect(mismatches.length, '抽空 signalAndRelay 后，门槛边界竟然还全部命中（落点跑到别组去了）')
      .toBeGreaterThanOrEqual(gateRows.length);
  });

  it('§8.1：离线缓存写的是程序文件、不是用户数据（红线的边界必须说清）', () => {
    const note = PRIVACY_COPY.offlineCacheNote.join('\n');
    expect(note).toMatch(/程序文件/);
    expect(note).toMatch(/不是用户数据/);
    // ⚠️ 与 PWA 实现的一致性（评审 N1 后**再次收紧**）：`public/sw.js` 只预缓存 app shell，
    // 卡图**不**预缓存；而且它的 fetch 段只做 cache-first **读**（未命中直接 `fetch`，**没有**
    // `cache.put`），仓库还有一条腿禁止在那里写缓存 ⇒ "用过的卡图进了缓存"只可能来自
    // **浏览器自己的 HTTP 缓存**，本站无法保证。所以文案必须区分
    // 「预缓存 = 程序文件（页面/脚本/样式/安装图标）」与「用过的资源**可能**留在浏览器自己的缓存里」，
    // 且后者不得说成"运行期由本站缓存"。下面这些断言就是钉住那个区分的：把"卡图"写回预缓存那一句 ⇒ 必红。
    // 逐行锚定：不再用数组解构（顺序漂移时会静默取错行），改成按 `line` 字段取
    const lineOf = (id: string): string => {
      const d = BOUNDARY_DECLARATIONS.find((x) => x.id === id);
      if (!d || d.line === undefined) throw new Error(`找不到逐行锚定的声明 ${id}`);
      const idx = Array.isArray(d.line) ? d.line[0] : d.line;
      return PRIVACY_COPY[d.group][idx];
    };
    const precacheLine = lineOf('offline-cache-program-files');
    const runtimeLine = lineOf('offline-cache-runtime-assets');
    expect(note).toMatch(/运行期缓存/);
    expect(note).toMatch(/用过之后/);
    expect(note, '必须交代"没看过的内容首次断网打不开"这个代价').toMatch(/没看过的内容[^。]*打不开/);
    expect(precacheLine, '预缓存那句不得再声称缓存了卡图').not.toMatch(/卡图/);
    expect(precacheLine, '预缓存那句须写明预缓存的是程序外壳（含安装图标）').toMatch(/预缓存程序文件本身/);
    expect(runtimeLine, '卡图只能出现在"用过后进运行期缓存"那句里').toMatch(/卡图/);
  });

  it('未实现的联机能力必须标注"上线后才适用"，其余组一条都不许带（不实陈述 = bug）', () => {
    // **重新推导过的旧腿**（评审 N4）：旧意图 = "只有 signalAndRelay 是门槛组"（判据把这句话
    // 钉死成 `key === 'signalAndRelay'`）；新意图 = "**凡本阶段玩不到的能力**都必须标注"。
    // G3 玩不到的能力有两个：signalAndRelay（信令/TURN 不存在）与 peerVisible（没有联机）。
    // ⚠️ 没有删除、也没有放宽：门槛组仍然是**每一条**都要带标注，且非门槛组仍**一条都不许**带。
    const GATED_GROUPS: readonly PrivacyGroupKey[] = ['signalAndRelay', 'peerVisible'];
    for (const key of PRIVACY_GROUPS) {
      const gated = GATED_GROUPS.includes(key);
      for (const line of PRIVACY_COPY[key]) {
        expect(
          line.includes(ONLINE_GATE_MARK),
          `${key} 的这条${gated ? '缺少' : '不该有'}「${ONLINE_GATE_MARK}」：${line}`,
        ).toBe(gated);
      }
    }
    // 判据与实现同口径（独立复算，不依赖 assertBoundaryTable）
    for (const key of GATED_GROUPS) expect(isGatedCopyLine(key), `${key} 必须是门槛组`).toBe(true);
    for (const key of PRIVACY_GROUPS.filter((k) => !GATED_GROUPS.includes(k))) {
      expect(isGatedCopyLine(key), `${key} 不是门槛组`).toBe(false);
    }
    // 正控：peerVisible 的三条不得被当成"现在就是这样"（N4 的失效形态就是它们漏标注）
    expect(PRIVACY_COPY.peerVisible.length, 'peerVisible 不该被清空（否则上面全空转）').toBeGreaterThan(0);
  });

  it('表自身的门槛对称性判据是真判据（喂两张坏表 ⇒ 必须报出不匹配）', () => {
    // 好表：0 处不匹配（防止上面的判据因"永远报红"而失去意义）
    expect(assertBoundaryTable(BOUNDARY_DECLARATIONS, PRIVACY_COPY, isGatedCopyLine)).toEqual([]);
    // 坏表 1：门槛组没有任何声明引用它 ⇒ 报 table-covers-gated-group
    const noGateRows = BOUNDARY_DECLARATIONS.filter((d) => d.group !== 'signalAndRelay');
    const a = assertBoundaryTable(noGateRows, PRIVACY_COPY, isGatedCopyLine);
    expect(a.map((m) => m.id)).toContain('table-covers-gated-group');
    // 坏表 2：门槛文案去掉"上线后才适用"标注 ⇒ 报 table-gate-mark-symmetry
    const copyNoMark: PrivacyCopy = {
      ...PRIVACY_COPY,
      signalAndRelay: PRIVACY_COPY.signalAndRelay.map((l) => l.replaceAll(ONLINE_GATE_MARK, '')),
    };
    const b = assertBoundaryTable(BOUNDARY_DECLARATIONS, copyNoMark, isGatedCopyLine);
    expect(b.map((m) => m.id)).toContain('table-gate-mark-symmetry');
    // 坏表 3：非门槛组混进门槛标注 ⇒ 同样报 table-gate-mark-symmetry（双向）
    const copyMarkInLocal: PrivacyCopy = {
      ...PRIVACY_COPY,
      localOnly: [...PRIVACY_COPY.localOnly, `${ONLINE_GATE_MARK}这条不该在这里`],
    };
    const c = assertBoundaryTable(BOUNDARY_DECLARATIONS, copyMarkInLocal, isGatedCopyLine);
    expect(c.map((m) => m.id)).toContain('table-gate-mark-symmetry');
  });

  it('禁止绝对句：文案里不许出现"磁盘上零写入"这类不可能成立的绝对承诺（B-1）', () => {
    // 背景（阶段一评审 B-1）：`:69` 原话是"在此之前，磁盘上不会有任何写入"、`:71` 是"不会写入磁盘"。
    // 这两句在任何实现下都是假的 —— 光是加载页面，浏览器自己就会把 HTML/JS/CSS 写进它的 HTTP 缓存，
    // 与有没有 service worker 无关（`main.ts` 无条件 `initPwaUpdate()` → `public/sw.js` 的 install
    // 还会 `cache.addAll` 程序文件）。正确读法是**范围化到用户数据**。
    //
    // 这条腿扫 `stripComments` 之后的 `src/app/privacy.ts`：注释里的历史说明不算，
    // **代码位**里（= 玩家真能读到的文案字符串）一条绝对句都不许有。
    const code = stripComments(readFileSync(join(REPO_ROOT, COPY_FILE)).subarray(0, 4 * 1024 * 1024).toString('utf8'));
    // 逐条构造（不写成一个大字面量：否则这条腿的正则自身就会成为"绝对句"的假阳性来源）
    const ABSOLUTE_FORMS = [
      '磁盘上不会有任何写入',
      '不会写入磁盘',
      '不写磁盘',
      '不落盘',
      '不会写入任何数据',
      '绝不写入',
      '不写入任何数据',
    ];
    const hit = ABSOLUTE_FORMS.filter((f) => code.includes(f));
    expect(hit, `privacy.ts 的代码里还有绝对句（B-1 回归）：${hit.join(' / ')}`).toEqual([]);
    // 玩家可见文案侧再确认一次（面向玩家的每一句都取自 PRIVACY_COPY）
    const all = privacyLines().join('\n');
    const hit2 = ABSOLUTE_FORMS.filter((f) => all.includes(f));
    expect(hit2, `玩家可见文案里还有绝对句：${hit2.join(' / ')}`).toEqual([]);
    // 正控：这条腿真的能抓到那两句话（用合成样本，不改真文件）
    const sample = 'const A = \'' + ABSOLUTE_FORMS[0] + '\';';
    expect(ABSOLUTE_FORMS.filter((f) => stripComments(sample).includes(f)).length, '正控失效：判据抓不到绝对句').toBe(1);
    // 范围化那一句必须**在**（不是"把承诺删掉了事"）
    expect(PRIVACY_COPY.localOnly[0]).toMatch(/不会写入任何你的数据/);
    expect(PRIVACY_COPY.localOnly[3]).toMatch(/不会写入任何你的数据/);
  });

  it('承诺句哈希钉死（1/2）：钉住表与真实文案的「组[行]」序列**逐位相等**（生成式：增 / 删 / 移位一句话必红）', () => {
    // ⚠️ 这条腿管**结构**（哪些句子必须各有其钉），下一条管**内容**（每句的哈希对不对）。
    expect(COPY_PINS.length, '钉住表不该为空（否则下面全是空转）').toBeGreaterThan(0);
    // 键必须**逐位**相等（不是"集合相等"）：插入一句会让后面的键整体后移 ⇒ 红，
    // 而不是"集合还对、顺序悄悄变了"。顺序 = `PRIVACY_GROUPS` × 组内顺序（生成式推导）。
    expect(pinKeys(), '钉住表与真实文案的「组[行]」序列不一致（新增/删除/移位了一句话却没人复核）')
      .toEqual(copyEntries(PRIVACY_COPY).map((e) => e.key));
    // 钉住表内部不许有重复键（重复会让 `pinByKey` 静默丢掉一个 ⇒ 那句变成无覆盖）
    expect(new Set(pinKeys()).size, '钉住表里有重复的「组[行]」').toBe(COPY_PINS.length);
    // 每条哈希必须是 16 位小写十六进制（抄错格式 ⇒ 立刻红，不要等到"内容漂移"那一步）
    for (const p of COPY_PINS) {
      expect(p.hash, `${copyKey(p.group, p.line)} 的哈希格式不对（应为 hash64 的 16 位小写十六进制）`).toMatch(/^[0-9a-f]{16}$/);
    }
    // 钉住表必须覆盖**每一组**（生成式：不写组名清单，直接比组集合的大小）
    expect(new Set(COPY_PINS.map((p) => p.group)).size, '钉住表没有覆盖全部文案组').toBe(PRIVACY_GROUPS.length);
  });

  it('承诺句哈希钉死（2/2）：任何一句被改写 / 追加 / 删除都必红（阻断 A 的决定性判据）', () => {
    // 正控 0：真文案一字不动 ⇒ 漂移清单必须**为空**（否则这条判据"永远红"，从而失去意义）
    const drift = pinDrift(PRIVACY_COPY);
    expect(
      drift,
      `以下承诺句与钉住的哈希对不上（真文案被改动了？）。\n⚠️ 若**确实**是人工复核过的合法改动，请把下面打印的「实际哈希」抄回 COPY_PINS：\n${drift.join('\n')}`,
    ).toEqual([]);

    /* ── 以下全部是**合成样本**（`withLine` 只造副本），绝不改真文件 ── */
    // ① 复审者实测穿透形态 `P_ABS_SCOPE`：`localOnly[0]` 保留范围化句 + **追加**一条
    //    黑名单之外的新绝对句 ⇒ 旧判据 17/17 全绿，新判据必须红。
    const pAbsScope = withLine(
      'localOnly', 0,
      copyLine('localOnly', 0).replace('之前，不会写入任何你的数据。', '之前，不会写入任何你的数据，本机零写入。'),
    );
    expect(pAbsScope.localOnly[0], '正控构造失败：句子里没有可追加的锚点').not.toBe(PRIVACY_COPY.localOnly[0]);
    expect(pAbsScope.localOnly[0], '正控构造失败：没有真的追加"本机零写入"').toContain('本机零写入');
    const dAbsScope = pinDrift(pAbsScope);
    expect(dAbsScope.length, `P_ABS_SCOPE 形态（保留必须子串 + 追加新绝对句）竟然没被抓到：\n${dAbsScope.join('\n')}`).toBe(1);
    expect(dAbsScope.join('\n'), '漂移清单必须指名道姓地报出是哪一句').toContain('localOnly[0]');
    expect(dAbsScope.join('\n'), '漂移清单必须打印**实际那句话**（否则维护者不知道改了什么）').toContain('本机零写入');
    // ② 同族形态 `P_BYPASS_1`：`localOnly[3]`（游客零写入那句）
    const pBypass1 = withLine(
      'localOnly', 3,
      copyLine('localOnly', 3).replace('选择「不允许」时不会写入任何你的数据', '选择「不允许」时不会写入任何你的数据、本机零写入'),
    );
    expect(pBypass1.localOnly[3], '正控构造失败：没追加成功').toContain('本机零写入');
    expect(pinDrift(pBypass1).length, 'P_BYPASS_1 形态（localOnly[3] 追加新绝对句）竟然没被抓到').toBe(1);
    // ③ 换措辞的另外三种绝对句（复审探针的 P_BYPASS_2/3/4）⇒ 证明**哈希判据不是黑名单**：
    //    措辞全新（一个黑名单词都不含）也照样红。
    //    注：这三条在**修复前已经是红的**（由"表驱动"腿因 requiredText 字面串失配拦住），
    //    所以它们证明的是"新判据不是黑名单式判据"，**不是**"新判据补了一个洞"。
    const otherWordings: ReadonlyArray<[string, string]> = [
      ['选择「不允许」时不会写入任何你的数据', '选择「不允许」时不会在本机留下任何数据'],
      ['选择「不允许」时不会写入任何你的数据', '选择「不允许」时你的任何数据都不会写入磁盘'],
      ['选择「不允许」时不会写入任何你的数据', '选择「不允许」时全程零磁盘写入'],
    ];
    for (const [from, to] of otherWordings) {
      const bad = withLine('localOnly', 3, copyLine('localOnly', 3).replace(from, to));
      expect(bad.localOnly[3], `正控构造失败：${to}`).not.toBe(PRIVACY_COPY.localOnly[3]);
      expect(pinDrift(bad).length, `换措辞的绝对句竟然没被抓到：${to}`).toBe(1);
    }
    // ④ 负控：**删掉**范围化句（`P_ABS_DEL2` 形态；这里用"删成空壳"模拟，行数不变 ⇒
    //    结构腿抓不到，必须靠**内容**哈希抓到）
    const pAbsDel = withLine('localOnly', 0, copyLine('localOnly', 0).replace('；在你选择「允许」之前，不会写入任何你的数据', ''));
    expect(pAbsDel.localOnly[0], '正控构造失败：没删掉范围化句').not.toContain('不会写入任何你的数据');
    expect(pinDrift(pAbsDel).length, '删掉范围化句（保留空壳）竟然没被抓到').toBe(1);
    // ⑤ 负控：把整行**删掉**（行数 -1）⇒ 结构那条腿（键序列逐位相等）必须报红
    const removed = { ...PRIVACY_COPY, localOnly: PRIVACY_COPY.localOnly.slice(1) };
    expect(pinKeys(), '删掉一整行后键序列竟然还相等').not.toEqual(copyEntries(removed).map((e) => e.key));
    // ⑥ 负控：在**任意组**末尾**追加一整行**新绝对句（旧判据的另一个穿透面）⇒ 必须红
    //    （`pinDrift` 报"没有钉"，结构那条腿也会报键序列不一致）
    const appended: PrivacyCopy = {
      ...PRIVACY_COPY,
      noServerStorage: [...PRIVACY_COPY.noServerStorage, '本机零写入：硬盘上没有任何你的数据。'],
    };
    const dAppended = pinDrift(appended);
    expect(dAppended.length, '追加一行全新绝对句竟然没被抓到').toBe(1);
    expect(dAppended.join('\n'), '漂移清单必须点名新增的那一行').toContain('noServerStorage[2]');
    // ⑦ 判据灵敏度自证：`hash64` 对**一个字符**的追加敏感（不是恒真函数），且同输入恒同输出
    expect(hash64('a'), 'hash64 对单字符追加不敏感（判据会假绿）').not.toBe(hash64('a。'));
    expect(hash64('a')).toBe(hash64('a'));
    // ⑧ 交叉自证：这三条的哈希与**独立实现**（`.superpowers/g3-t5-r2/probe-pins.mjs` 的 Node 版）
    //    算出来的值一致（防"抄错常量"型假绿）；另外两条是阻断 A 明确点名的句子。
    expect(hash64(copyLine('localOnly', 0))).toBe('c22ab6f10d151d6f');
    expect(hash64(copyLine('localOnly', 3))).toBe('a61a40d9960e2a30');
    expect(hash64(copyLine('peerVisible', 1))).toBe('ecf41ba6a1ad65c2');
  });

  it('禁止软化模态词：承诺句里不许出现"暂不会/可能不会/也许/原则上/尽量"这类软化（N5 的 M7）', () => {
    // 评审 M7 实测：把 `:65` 的"不会"软化成"暂不会"⇒ 11/11 全绿。
    // 软化词把一条承诺变成"将来也许会变"的暗示，与"如实陈述"同样冲突，所以单列一条腿。
    const SOFTENERS = [
      '暂不会',
      '暂不',
      '暂时不',
      '可能不会',
      '也许',
      '或许',
      '原则上',
      '尽量',
      '一般不会',
      '通常不会',
      '应该不会',
      '估计不会',
    ];
    const all = privacyLines();
    const offenders: string[] = [];
    for (const key of PRIVACY_GROUPS) {
      for (const line of PRIVACY_COPY[key]) {
        for (const s of SOFTENERS) if (line.includes(s)) offenders.push(`${key}: 「${s}」→ ${line}`);
      }
    }
    expect(offenders, `承诺句里出现软化模态词：\n${offenders.join('\n')}`).toEqual([]);
    // 判据自检：`privacyLines()` 必须真的覆盖了全部组（否则上面是空转）
    expect(all.length).toBeGreaterThanOrEqual(PRIVACY_GROUPS.length);
    // 正控：软化"不会"确实会被抓到（合成样本，不动真文案）
    // ⚠️ 不能写 `SOFTENERS.filter((s) => sample.includes(s))` —— 只要样本里出现"暂不"，
    // "暂不"是**所有** `暂*` 软化词的子串，那句 filter 会恒真（'暂不会' 也含 '暂不'）。
    const softened = `选择「不允许」时${SOFTENERS[1]}写入任何你的数据`;
    expect(softened.includes(SOFTENERS[1]), '正控失效：软化形式没被包含').toBe(true);
    const hard = '选择「不允许」时不会写入任何你的数据';
    expect(SOFTENERS.some((s) => hard.includes(s)), '正控失效：未软化的原句竟被判为软化').toBe(false);
  });

  it('生成式：PRIVACY_COPY 与 PRIVACY_GROUPS 的键集合**相等**（漏改一处必红）', () => {
    // 评审 N6 实测（M4）：新增第 6 个文案组，只加进 `PrivacyCopy` 接口 + `PRIVACY_COPY` 对象、
    // 不进 `PRIVACY_GROUPS` ⇒ vitest 11/11 绿 + tsc 0 错，而那组**永不被 `privacyLines()` 渲染**。
    // 也就是说 `privacy.ts:23-26` 那句"漏改两处中的任何一处都会编译报错"**只有一个方向成立**。
    // 这条腿补另一个方向，并且用**集合相等**（不手写清单）。
    const objectKeys = Object.keys(PRIVACY_COPY).sort();
    const groupKeys = [...PRIVACY_GROUPS].sort();
    expect(objectKeys, 'PRIVACY_COPY 的键与 PRIVACY_GROUPS 不一致（新增组漏改一处）').toEqual(groupKeys);
    // 等价复算：privacyLines() 必须覆盖 PRIVACY_COPY 的每一组
    expect(new Set(privacyLines()).size).toBeGreaterThan(0);
    for (const key of Object.keys(PRIVACY_COPY)) {
      expect(PRIVACY_GROUPS as readonly string[], `${key} 不在 PRIVACY_GROUPS 里（永不被渲染）`).toContain(key);
    }
    // 正控：把组清单换成"少一个"的合成对象 ⇒ 判据必须报红（证明它不是恒真）
    const missingOne = Object.fromEntries(
      Object.entries(PRIVACY_COPY).filter(([k]) => k !== PRIVACY_GROUPS[0]),
    ) as unknown as PrivacyCopy;
    expect(Object.keys(missingOne).sort()).not.toEqual(groupKeys);
  });

  it('唯一出处：每句话在全仓只有一处定义（去注释后逐字计数，只认完整句）', () => {
    for (const key of PRIVACY_GROUPS) {
      for (const line of PRIVACY_COPY[key]) {
        const hits = holdersOf(SOURCES, line);
        expect(hits, `「${key}」的这句话在 ${hits.length} 个文件里逐字出现（唯一出处被破坏）：${hits.join(', ')}`).toEqual([
          COPY_FILE,
        ]);
        expect(
          countOccurrences(SOURCES.get(COPY_FILE) ?? '', normalize(line)),
          `「${key}」的这句话在 ${COPY_FILE} 里出现了多次（同一句被写了两份）`,
        ).toBe(1);
      }
    }
    // 判据自检（正控）：把同一句话**原样**放进一个假消费方 ⇒ 必须被判为"第二处定义"。
    // 没有这条，上面的断言可能因为"扫描永远只命中自己"而恒真（假绿）。
    // 假消费方直接构造在内存里（不落盘）：既不产生仓库临时文件，也不依赖 node:fs 的写接口。
    const decoyRel = 'src/ui/decoy-consent-copy.ts';
    const decoyRaw = `import { PRIVACY_COPY } from '../app/privacy';\n`
      + `// 解释性注释：这里复述了「${PRIVACY_COPY.localOnly[0]}」这句话\n`
      + `export const CONSENT = ${JSON.stringify(PRIVACY_COPY.localOnly[0])};\n`;
    const hits = holdersOf(
      new Map([
        [COPY_FILE, SOURCES.get(COPY_FILE) ?? ''],
        [decoyRel, normalize(stripComments(decoyRaw))],
      ]),
      PRIVACY_COPY.localOnly[0],
    );
    expect(hits, '第二处定义没有被判出来（这条判据是假的）').toEqual([COPY_FILE, decoyRel]);
    // 反向（负控）：同一句话**只出现在注释里**时不算第二处定义
    // —— 这正是不能裸用 `not.toContain` 的原因（本会话已有先例：解释性注释造成假红）。
    const commentOnly = `// 「${PRIVACY_COPY.localOnly[0]}」\nexport const CONSENT = null;\n`;
    expect(holdersOf(new Map([[decoyRel, normalize(stripComments(commentOnly))]]), PRIVACY_COPY.localOnly[0])).toEqual([]);
  });

  it('面向玩家：文案里没有内部标识符（键名 / 存储机制 / 模块名）', () => {
    const offenders: string[] = [];
    for (const [key, lines] of PRIVACY_GROUPS.map((k) => [k, PRIVACY_COPY[k]] as const)) {
      for (const line of lines) for (const token of INTERNAL_TOKENS) if (line.includes(token)) offenders.push(`${key}: ${token} → ${line}`);
    }
    expect(offenders, `面向玩家的文案里出现内部标识符：\n${offenders.join('\n')}`).toEqual([]);
  });

  it('纯层：privacy.ts 不出现浏览器 API 的成员访问与调用（src/app 的硬约束）', () => {
    // 说明文字与判据同口径（N8）：这条腿**只**认"成员访问 / 调用"，
    // 不认"未被调用的函数体里裸引用一个全局名"。要覆盖后者需要 AST，
    // 那是 Task 9 的 `tests/app-purity.test.ts` 的职责，不在本任务的判据范围里。
    const src = readFileSync(join(REPO_ROOT, COPY_FILE)).subarray(0, 4 * 1024 * 1024).toString('utf8');
    const code = stripComments(src);
    const hit = code.match(BROWSER_API);
    expect(hit?.[0] ?? null, `privacy.ts 里出现了浏览器 API 的成员访问/调用：${hit?.[0]}`).toBe(null);
    // 判据正控（合成样本，不动真文件）：三种形态都要能被抓到
    for (const sample of ['localStorage.setItem(a)', 'fetch(x)', 'globalThis.localStorage']) {
      expect(stripComments(sample).match(BROWSER_API)?.[0] ?? null, `正控失效：${sample} 没被抓到`).not.toBe(null);
    }
    // 反向：注释里的名字不算（与"唯一出处"腿同一口径）
    expect(stripComments('// 这里提到 localStorage 与 fetch( 都不算').match(BROWSER_API)).toBe(null);
  });

  it('唯一出处：消费方通过 import 引用（本文件即示例），不得各写一份', () => {
    // 本测试文件自己就不许把文案抄一遍：只能通过 PRIVACY_COPY 拿到
    const self = normalize(stripComments(readFileSync(fileURLToPath(import.meta.url)).subarray(0, 4 * 1024 * 1024).toString('utf8')));
    for (const line of privacyLines()) {
      expect(self.includes(normalize(line)), `测试文件里抄了一份文案（应改为引用 PRIVACY_COPY）：${line}`).toBe(false);
    }
  });
});
