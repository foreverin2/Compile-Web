/**
 * 隐私边界的**唯一文案出处**（G3 Task 5；逐条对齐设计稿
 * `docs/2026-09-13-联机与多端-设计稿.md` §0.4 三条红线、§5.9 隐私边界表、§8.1 离线缓存说明）。
 *
 * 为什么把文案放进 `src/app/` 而不是直接写在 UI 里：
 *  - §0.4 的三条红线与 §5.9 是**规格**：规格漂移 = 对玩家的不实陈述；
 *  - 放在纯数据模块里，才能用行为腿（`tests/app/privacy.test.ts`）钉住"每条边界都有落点"；
 *  - 授权弹窗（Task 4）与「本地数据与隐私」屏（Task 7）**共用同一份**，两处措辞不会分叉。
 *
 * ⚠️ G3 阶段**没有**信令、没有 TURN、没有任何服务器（红线 1 说的是"即使有也不存"，
 * 不是"现在就有"），**也没有** P2P 联机。因此凡是"本阶段玩不到"的能力 ——
 * `signalAndRelay`（信令 / TURN）与 `peerVisible`（P2P 直连对手）—— 的每一条都必须自带
 * "（联机功能上线后才适用）"——否则就是对玩家撒谎。这条由 `isGatedCopyLine()` 机检。
 *
 * 另一条纪律（2026-09-16 阶段一评审 B-1 后加）：**面向玩家的文案里不许出现绝对句**
 * （"磁盘上不会有任何写入""不会写入磁盘""不落盘"…）。任何绝对句都不可能在真实实现下成立 ——
 * 光是加载页面，浏览器自己就会把 HTML/JS/CSS 写进它的 HTTP 缓存，与有没有 service worker 无关。
 * 诚实做法是**范围化到用户数据**，并如实披露程序文件缓存（见 `localOnly` 与 `offlineCacheNote`）。
 * 这条纪律由测试的"禁止绝对句"腿机检（扫 `stripComments` 后的本文件）。
 *
 * 面向玩家的措辞纪律（见 `tests/app/privacy.test.ts` 的措辞守卫）：
 * 文案是给玩家读的，**不出现内部标识符**（`localStorage`/`L1`/`L2`/`MatchFile`/`cardDataHash`/
 * `consent`/`indexedDB`/`Service Worker` 等），改用「你自己的浏览器存储」「离线缓存」这类
 * 玩家能懂的说法。设计稿本身没有写这条纪律，是本任务按"面向玩家"的定位做的判断。
 */

/**
 * 文案分组键的**运行期清单**（同时也是 `PrivacyGroupKey` 的唯一定义处）。
 *
 * 为什么要有它：`assertBoundaryTable` 需要遍历"全部组"来判门槛对称性。
 * 若用 `Object.keys(copy)`，键的类型是 `string`，必须 cast 成 `PrivacyGroupKey` ——
 * 那个 cast 会把"新增了一个组但忘了同步 union"变成**编译期看不见**的漂移。
 * 这里让 union 从数组派生，新增组时漏改两处中的任何一处都会编译报错。
 */
export const PRIVACY_GROUPS = [
  'noServerStorage',
  'localOnly',
  'peerVisible',
  'offlineCacheNote',
  'signalAndRelay',
] as const;

/** 文案分组键（= `PrivacyCopy` 的字段名，供表驱动判据引用） */
export type PrivacyGroupKey = (typeof PRIVACY_GROUPS)[number];

/**
 * 门槛标注：只对"联机功能上线后"成立的能力，文案里必须自带这一句。
 *
 * 单独导出（而不是在判据里手写一遍字面量）：Task 5 的硬要求是
 * "不得声称 G3 尚未实现的东西"，这句话就是那条要求的**唯一出处**；
 * 它作用于**所有**门槛组（`isGatedCopyLine` = 本阶段玩不到的能力）。
 */
export const ONLINE_GATE_MARK = '（联机功能上线后才适用）';

export interface PrivacyCopy {
  /** 红线 1：任何服务器都不存卡组/昵称/个人信息/对局数据 */
  noServerStorage: string[];
  /**
   * L1 只在本机、用户可随时清除；拒绝授权（游客模式）= **用户数据**零写入。
   *
   * ⚠️ 粒度必须写"你的数据"，不能写"磁盘"：浏览器为离线打开而缓存的**程序文件**
   * （页面 / 脚本 / 样式 / 图标）不是用户数据，也不受授权状态影响（评审 B-1 的裁决）。
   */
  localOnly: string[];
  /**
   * 对端玩家能看到/看不到什么（P2P 直连的必然结果，§5.9 第 3 行）。
   *
   * ⚠️ 对手**会**看到你的显示昵称（§5.9 已知项 + §5.2 握手 `nick` + 设计稿 §14 末
   * "对手昵称的来源 = L1 配置里的昵称"）——所以"看不到昵称"是错的，不能写（评审 N2）。
   * 正确口径：**昵称与 IP 对手看得到**（前者经端到端加密通道直接交换、不经服务器），
   * **看不到**的是卡组文件与本机设置；且只交换昵称这一项，不传卡组 / 设置 / 档案。
   */
  peerVisible: string[];
  /**
   * §8.1：离线缓存的**语义边界** —— 预缓存的是程序文件（页面/脚本/样式/安装图标），
   * 未预缓存的大体积资源（卡图等）在**被访问过之后**才可能进入运行期缓存，且那由浏览器自己的缓存决定；
   * 两者都不是用户数据。
   *
   * ⚠️ 不再说"运行期**由本站**缓存卡图"：`public/sw.js` 的 fetch 段只做 cache-first **读**
   * （`caches.match` 未命中直接 `fetch`，**没有** `cache.put`），而且仓库有一条腿禁止在那里写缓存
   * （`tests/ui/pwa-update.test.ts` 的"缓存写入只允许出现在 install 段"）。所以"用过的资源被留住了"
   * 只可能是**宿主/浏览器自己的 HTTP 缓存**，本站既无法保证也未验证 ⇒ 只能说"可能…取决于你的浏览器"
   * （评审 N1，推翻了 5298046 那次"与 PWA 实现对齐"的运行期缓存说法）。
   */
  offlineCacheNote: string[];
  /** §5.9 第 1、2 行：信令服务与 TURN 中继（**联机上线后才适用**；本阶段不存在） */
  signalAndRelay: string[];
}

export const PRIVACY_COPY: PrivacyCopy = {
  noServerStorage: [
    '本游戏没有任何后端服务器：你的昵称、卡组与对局数据都不会被上传，也不会被存到别人的机器上。',
    '游戏的规则判定全部在你自己的设备上运行；即使将来接入服务器（联机功能上线后），它也只会转发数据，不存储你的昵称、卡组、操作内容与对局数据。',
  ],
  localOnly: [
    '你在授权弹窗里选择「允许」之后，昵称、设置与卡组才会写进你自己的浏览器存储；在你选择「允许」之前，不会写入任何你的数据。',
    '浏览器为离线打开而缓存的只有程序文件本身（页面、脚本、样式与安装图标）；那不是你的数据，你随时可以清掉。',
    '你随时可以在「本地数据与隐私」里一键清除已保存的本地数据。',
    '选择「不允许」时不会写入任何你的数据：本次游戏的昵称、设置与卡组只存在内存里，刷新或关闭页面就会全部丢失。',
  ],
  peerVisible: [
    '（联机功能上线后才适用）联机对局是两台设备直连（P2P）：对手能看到你的 IP 地址（这是直连的技术必然），但看不到你的卡组文件，也看不到你在本机保存的设置。',
    '（联机功能上线后才适用）对手会看到你的显示昵称（它经双方直连的加密通道直接交换，不经过任何中间服务器），而且只交换昵称这一项：卡组、设置与档案都不传。',
  ],
  offlineCacheNote: [
    '把网页安装为应用后，浏览器会预缓存程序文件本身（页面、脚本、样式与安装图标）；首次缓存成功之后，断网也能打开游戏，缓存没完成时仍然需要联网。',
    '用过之后进入运行期缓存的只有你访问过的卡图等资源，而且它由浏览器自己的缓存决定（取决于你的浏览器设置）：没看过的内容第一次断网时打不开。缓存的这些都不是用户数据：你的昵称、卡组、档案与对局记录都不在缓存里。',
  ],
  signalAndRelay: [
    '（联机功能上线后才适用）信令服务只能看到房间码、IP 地址与连接时刻，看不到你的昵称、卡组、操作内容或对局数据。',
    '（联机功能上线后才适用）若你自行配置了中继（TURN），它能看到你的 IP 地址（这是走中继的技术必然），但转发的是端到端加密后的数据包：内容不可读，也不存储。',
  ],
};

/**
 * 拍平全部文案，顺序 = `PRIVACY_GROUPS` 的声明顺序，供 UI 渲染与文本腿守卫使用。
 *
 * 遍历 `PRIVACY_GROUPS`（而不是 `Object.values(PRIVACY_COPY)`）：`Object.values` 只认
 * **运行期**存在的键，新增组时若不改本函数也照样"全部拍平"，但拍平顺序会随手写死 ——
 * 而 `tests/app/privacy.test.ts` 有一条生成式判据钉住"拍平结果 = 每一组逐条拼起来"，
 * 顺序漂移会报红而不是静默改变 UI 渲染顺序。
 */
export function privacyLines(): string[] {
  return PRIVACY_GROUPS.flatMap((key) => PRIVACY_COPY[key]);
}

/**
 * 该条文案是否**只对"联机功能上线后"成立**。
 *
 * 判据是"意图"，不是"组名清单"：G3 阶段**玩不到**的能力有两个 ——
 * `signalAndRelay`（信令服务 / TURN 中继：本阶段不存在）与 `peerVisible`（P2P 联机对手：
 * 本阶段没有联机）。这两组的**每一条**都必须自带门槛标注；其余组说的是"现在就是这样"，
 * 一条都不许加门槛（否则玩家会以为现在没有这能力）。
 *
 * ⚠️ 评审 N4：早先这里只认 `signalAndRelay`，于是 `peerVisible` 的三条（含 IP / 昵称）
 * 被当成"现在就是这样"投放 —— 而 G3 根本没有联机功能。补齐后的判据由
 * `tests/app/privacy.test.ts` 的独立复算**与** `assertBoundaryTable` 的门槛对称性**双向**机检。
 */
export function isGatedCopyLine(group: PrivacyGroupKey): boolean {
  return group === 'signalAndRelay' || group === 'peerVisible';
}

/* ───────────────────────── 表驱动：边界 ↔ 文案 ───────────────────────── */

/**
 * 被钉住的边界的**运行期清单**（= 设计稿 §0.4 红线 / §5.9 表格的每一行 +
 * `tests/app/privacy.test.ts` 表自身的一致性判据）。同时也是 `BoundaryId` 的唯一定义处。
 *
 * 为什么要有它（评审 N3 的连带）：测试里早先用手写的
 * `expect(BOUNDARY_DECLARATIONS.length).toBe(14)` 保证"表没被删空" —— 那是**手写清单**：
 * 加一条边界就要手改一个数字，而且它**不会**因为"某条 union 成员漏了声明"而报红。
 * 现在由测试做集合判据："每个 `BoundaryId` 成员都至少有 1 条声明" +
 * "不存在指向 union 之外的 id"（生成式，漏一条就红）。
 */
export const BOUNDARY_IDS = [
  'redline-1-no-server-storage',
  'redline-3-guest-zero-write',
  'consent-before-local-write',
  'user-can-clear-local',
  'signal-sees-room-code',
  'signal-cannot-see-content',
  'relay-sees-ip',
  'relay-encrypted-unreadable',
  'relay-no-storage',
  'peer-sees-ip',
  'peer-cannot-see-deck',
  'peer-nickname-via-channel',
  'offline-cache-program-files',
  'offline-cache-runtime-assets',
  'offline-cache-not-user-data',
  /* 下面两条不是设计稿里的边界，而是**表自身的**一致性判据 */
  'table-covers-gated-group',
  'table-gate-mark-symmetry',
] as const;

/** 被钉住的边界 id（= `BOUNDARY_IDS` 的成员；见测试里的 `BOUNDARY_DECLARATIONS`） */
export type BoundaryId = (typeof BOUNDARY_IDS)[number];

/**
 * 一条**边界声明** ↔ **文案落点**。
 *
 * 为什么要有这张表：Task 5 的验收要求是"逐条对应、可机检"。手写散断言（一句一个
 * `expect(all).toMatch(...)`）在文案改一个字后会**静默失去覆盖**——没人知道被删掉的是哪条边界。
 * 表驱动后，判据变成"这张表里的每条边界，在它指定的那一组文案里**必须命中**"，
 * 并同时写死**归属**：`signalAndRelay` 的边界不许由 `noServerStorage` 的文字满足
 * （否则"未实现的能力"又一次被说成"现在就是这样"，而门禁全绿）。
 */
export interface PrivacyBoundaryDeclaration {
  /** 边界 id（设计稿里的条目名，报错时直接可读） */
  id: BoundaryId;
  /** 边界的一句规范陈述（给维护者看；面向玩家的成品在 `PRIVACY_COPY` 里） */
  text: string;
  /** 这条边界**必须**落在哪一组文案里 */
  group: PrivacyGroupKey;
  /**
   * 这条边界**必须**落在该组的第几条文案上（0 起，可选）。
   *
   * 为什么必须有（评审 N5）：`requiredText` 早先是在**整组拼起来的文本**上做正则，
   * 于是"否定词 + 对象词只要同组出现即可" —— 评审把
   * `:82` 改成"…看不到你的卡组文件；**但能看到**你的昵称、操作内容与对局数据"（M1b），
   * 11/11 全绿。逐行锚定后，每条声明只在自己指定的那几行上校验，**换行即失效**。
   *
   * 为什么允许数组：有些边界天然跨两条文案（红线 1 的"不存储"在第 1 条；
   * "用户数据零写入 + 被缓存的程序文件不是用户数据"横跨第 0/1 条）。
   * 数组仍然**不放宽**到"整组"：只是显式列出参与校验的那几行。
   */
  line?: number | readonly number[];
  /**
   * 该条声明必须命中的关键成分。每项是 `RegExp`（用它写**否定断言**：必须出现
   * "看不到 / 不可读 / 不存储 / 不是"这类否定词，而不是只出现关键词）或字面串。
   */
  requiredText: (RegExp | string)[];
}

/** 一条边界声明对不上文案时的报错（收集全部不匹配，一次报清楚） */
export interface BoundaryMismatch {
  id: BoundaryId;
  group: PrivacyGroupKey;
  /** 缺失的成分（正则用 `String(re)` 打印，带上两边的 `/`，便于区分"正则没命中"与"字面串不在"） */
  missing: string[];
  /** 该组文案全文（报错时贴出来，省得再去翻源码） */
  groupText: string;
}

function requiredTokens(pattern: RegExp | string): string[] {
  return typeof pattern === 'string' ? [pattern] : [String(pattern)];
}

/**
 * 逐条校验"边界声明表 ↔ 文案"。
 *
 * 传 `isGated` 时附加"门槛对称性"判据（本模块传 `isGatedCopyLine`）——它是**双向**的：
 *  - 门槛组（`isGatedCopyLine` 认可的那些，见它的注释）里的**每一条**都必须带 `ONLINE_GATE_MARK`，
 *    且该组必须被**至少一条**声明引用（否则新加的门槛文案可以完全不进表而门禁全绿）；
 *  - 非门槛组**一条都不许**带 `ONLINE_GATE_MARK`（否则文案会让玩家以为现在就有这能力）。
 *
 * 返回**不匹配清单**（空数组 = 全绿）。**不抛异常、不自己断言**：把判定结果交回测试，
 * 才能被"注入变异 ⇒ 变红"的流程真实覆盖到（本仓的守卫哲学：行为腿 > 文本腿）。
 */
export function assertBoundaryTable(
  table: readonly PrivacyBoundaryDeclaration[],
  copy: PrivacyCopy = PRIVACY_COPY,
  isGated: (group: PrivacyGroupKey) => boolean = isGatedCopyLine,
): BoundaryMismatch[] {
  const mismatches: BoundaryMismatch[] = [];
  const used = new Set<PrivacyGroupKey>();

  for (const decl of table) {
    const groupText = copy[decl.group].join('\n');
    // 逐行锚定：给了 `line` 就只在这一行（或显式列出的这几行）上校验
    // （越界会在这里**响亮**抛错，而不是静默假绿）
    const groupLines = copy[decl.group];
    const picked = decl.line === undefined
      ? groupLines
      : (Array.isArray(decl.line) ? decl.line : [decl.line as number]).map((i) => groupLines[i as number]);
    // 组**非空**却取不到该行 = 声明的 line 写错了（维护期错误）⇒ 响亮抛错。
    // 组被**故意清空**（测试语料会传 `{...PRIVACY_COPY, signalAndRelay: []}`）时
    // 不能抛错，而要如实报"不匹配"——那条腿要验证的正是"抽空后落点必须消失"。
    if (decl.line !== undefined && groupLines.length > 0 && picked.some((l) => l === undefined)) {
      throw new Error('边界声明「' + decl.id + '」的 line=' + String(decl.line) + ' 越界（' + decl.group + ' 只有 ' + groupLines.length + ' 条）');
    }
    const haystack = decl.line === undefined ? groupText : (picked as string[]).join('\n');
    used.add(decl.group);
    const missing = decl.requiredText
      .map((p) => ({ pattern: p, ok: typeof p === 'string' ? haystack.includes(p) : p.test(haystack) }))
      .filter((x) => !x.ok)
      .flatMap((x) => requiredTokens(x.pattern));
    if (missing.length > 0) mismatches.push({ id: decl.id, group: decl.group, missing, groupText });
  }

  for (const key of PRIVACY_GROUPS) {
    const groupText = copy[key].join('\n');
    if (isGated(key) && !used.has(key)) {
      mismatches.push({
        id: 'table-covers-gated-group',
        group: key,
        missing: [`门槛组「${key}」没有任何边界声明引用它（新增门槛文案必须进表，否则它永远不被检查）`],
        groupText,
      });
    }
    if (isGated(key) && !(copy[key].length > 0 && copy[key].every((l) => l.includes(ONLINE_GATE_MARK)))) {
      mismatches.push({
        id: 'table-gate-mark-symmetry',
        group: key,
        missing: [`门槛组「${key}」为空或其中有一条缺少「${ONLINE_GATE_MARK}」标注（= 对玩家的不实陈述）`],
        groupText,
      });
    }
    if (!isGated(key) && copy[key].some((l) => l.includes(ONLINE_GATE_MARK))) {
      mismatches.push({
        id: 'table-gate-mark-symmetry',
        group: key,
        missing: [`组「${key}」不该出现「${ONLINE_GATE_MARK}」（它不是门槛能力，加了会让玩家以为现在没有）`],
        groupText,
      });
    }
  }

  return mismatches;
}
