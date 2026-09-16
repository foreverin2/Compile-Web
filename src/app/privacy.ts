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
 * 不是"现在就有"）。因此 `signalAndRelay` 的每条都必须自带
 * "（联机功能上线后才适用）"——否则就是对玩家撒谎。这条由 `isGatedCopyLine()` 机检。
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
 * "不得声称 G3 尚未实现的东西"，这句话就是那条要求的**唯一出处**。
 */
export const ONLINE_GATE_MARK = '（联机功能上线后才适用）';

export interface PrivacyCopy {
  /** 红线 1：任何服务器都不存卡组/昵称/个人信息/对局数据 */
  noServerStorage: string[];
  /** L1 只在本机、用户可随时清除；拒绝授权（游客模式）零写入 */
  localOnly: string[];
  /** 对端玩家能看到/看不到什么（P2P 直连的必然结果，§5.9 第 3 行） */
  peerVisible: string[];
  /**
   * §8.1：离线缓存的**语义边界** —— 预缓存的是程序外壳（页面/脚本/样式/安装图标），
   * 卡图等大体积资源只在**被用过之后**进运行期缓存，且两者都不是用户数据。
   */
  offlineCacheNote: string[];
  /** §5.9 第 1、2 行：信令服务与 TURN 中继（**联机上线后才适用**） */
  signalAndRelay: string[];
}

export const PRIVACY_COPY: PrivacyCopy = {
  noServerStorage: [
    '本游戏没有任何后端服务器：你的昵称、卡组与对局数据都不会被上传，也不会被存到别人的机器上。',
    '游戏的规则判定全部在你自己的设备上运行；即使将来接入服务器（联机功能上线后），它也只会转发数据，不会存储任何内容。',
  ],
  localOnly: [
    '你在授权弹窗里选择「允许」之后，昵称、设置与卡组才会写进你自己的浏览器存储；在此之前，磁盘上不会有任何写入。',
    '你随时可以在「本地数据与隐私」里一键清除已保存的本地数据。',
    '选择「不允许」时不会写入磁盘：本次游戏的全部数据只存在内存里，刷新或关闭页面就会全部丢失。',
  ],
  peerVisible: [
    '联机对局是两台设备直连（P2P）：对手能看到你的 IP 地址（这是直连的技术必然），但看不到你的卡组文件，也看不到你在本机保存的设置与昵称。',
    '真正的昵称只在双方直连的加密通道里交换，不经过任何中间服务器。',
  ],
  offlineCacheNote: [
    '把网页安装为应用后，浏览器会预缓存程序文件本身（页面、脚本、样式与安装图标），断网时仍能打开游戏。',
    '用过之后进入运行期缓存的只有看过的卡图等资源，没看过的内容第一次断网时打不开；缓存的这些都不是用户数据：你的昵称、卡组、档案与对局记录都不在缓存里。',
  ],
  signalAndRelay: [
    '（联机功能上线后才适用）信令服务只能看到房间码、IP 地址与连接时刻，看不到你的昵称、卡组、操作内容或对局数据。',
    '（联机功能上线后才适用）若你自行配置了中继（TURN），中继转发的是端到端加密后的数据包：内容不可读，也不存储。',
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
 * 判据是"组"：只有 `signalAndRelay` 描述的是本阶段尚不存在的能力（信令服务 / TURN 中继），
 * 因此该组的**每一条**都必须自带门槛标注；其余组说的是"现在就是这样"，不得加门槛。
 */
export function isGatedCopyLine(group: PrivacyGroupKey): boolean {
  return group === 'signalAndRelay';
}

/* ───────────────────────── 表驱动：边界 ↔ 文案 ───────────────────────── */

/** 被钉住的边界（= 设计稿 §0.4 红线 / §5.9 表格的每一行；见测试里的 `BOUNDARY_DECLARATIONS`） */
export type BoundaryId =
  | 'redline-1-no-server-storage'
  | 'redline-3-guest-zero-write'
  | 'consent-before-local-write'
  | 'user-can-clear-local'
  | 'signal-sees-room-code'
  | 'signal-cannot-see-content'
  | 'relay-encrypted-unreadable'
  | 'relay-no-storage'
  | 'peer-sees-ip'
  | 'peer-cannot-see-deck'
  | 'peer-nickname-via-channel'
  | 'offline-cache-program-files'
  | 'offline-cache-runtime-assets'
  | 'offline-cache-not-user-data'
  /* 下面两条不是设计稿里的边界，而是**表自身的**一致性判据 */
  | 'table-covers-gated-group'
  | 'table-gate-mark-symmetry';

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
 *  - 门槛组（`signalAndRelay`）里的**每一条**都必须带 `ONLINE_GATE_MARK`，
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
    used.add(decl.group);
    const missing = decl.requiredText
      .map((p) => ({ pattern: p, ok: typeof p === 'string' ? groupText.includes(p) : p.test(groupText) }))
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
