/**
 * 隐私边界文案守卫（G3 Task 5）。
 *
 * 规格出处：`docs/2026-09-13-联机与多端-设计稿.md`
 *  - **§0.4 三条红线**：红线 1（任何服务器都不存储卡组/昵称/个人信息/对局数据）、
 *    红线 3（游客模式下零写入磁盘）；
 *  - **§5.9 隐私边界表**（三行：信令服务 / TURN 中继 / 对端玩家 各自"能看到什么、看不到什么"）；
 *  - **§8.1 末尾**（"离线缓存写的是程序文件，不是用户数据 —— 必须对玩家说明"）。
 *
 * 判据分五层，**全部是行为腿**（跑函数拿返回值，不读源码找字符串，除两条"唯一出处"文本腿）：
 *  1. 结构：每组非空、无空串、无重复句、`privacyLines()` 与各组逐条一致（生成式）。
 *  2. **表驱动**：`BOUNDARY_DECLARATIONS` 把每条边界钉到"哪一组的哪句话"，
 *     逐条遍历断言 —— 而不是散着写 `expect(all).toMatch(...)`（那种写法改一个词就静默失去覆盖）。
 *  3. **唯一出处**：每句文案在全仓（`src/` + `tests/`）里**只有一处定义**（`src/app/privacy.ts` 自己）。
 *     用 `stripComments` 去注释后**逐字**计数 —— 裸 `not.toContain` 会被解释性注释假红
 *     （见 `tests/ui/source-text.ts` 开头记录的那次栽跟头），所以注释先剔、且只认完整句。
 *  4. 面向玩家 / 不泄露实现细节：无内部标识符、无 `src/app` 禁止的浏览器 API。
 *  5. 门槛标注：本阶段不存在的联机能力必须标注"上线后才适用"（不实陈述 = bug）。
 *
 * 已知局限（有意接受，写在这里以免被当成"已覆盖"）：表驱动判据是**关键词/正则在场**级别，
 * 不是自然语言蕴含检查 —— "猜疑的句式"在机器上无法与"如实的句式"区分。
 * 缓解手段是**双成分**：既要求对象词（昵称/卡组/对局数据），也要求否定词（看不到/不存储/…），
 * 两者必须同时出现在**同一条边界所绑定的那一组**里，且归属被写死（错组也算不匹配）。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import {
  PRIVACY_COPY,
  PRIVACY_GROUPS,
  ONLINE_GATE_MARK,
  assertBoundaryTable,
  isGatedCopyLine,
  privacyLines,
} from '../../src/app/privacy';
import type { PrivacyCopy, PrivacyBoundaryDeclaration, PrivacyGroupKey } from '../../src/app/privacy';
import { stripComments } from '../ui/source-text';

/* ───────────────────────── 1. 边界声明表（表驱动判据的唯一数据源） ───────────────────────── */

/**
 * 每条 = 设计稿里的一条边界声明。`requiredText` 里：
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
    requiredText: [/[^。]*不会[^。]*上传/, /[^。]*不会[^。]*存/, /规则判定全部在你自己的设备上运行/],
  },
  {
    id: 'signal-sees-room-code',
    text: '§5.9：信令服务能看到房间码、IP 地址、连接时刻',
    group: 'signalAndRelay',
    requiredText: [/信令服务[^。]*能看到[^。]*房间码/, /IP\s*地址/, /连接时刻/],
  },
  {
    id: 'signal-cannot-see-content',
    text: '§5.9：信令服务看不到昵称、卡组、操作内容、对局数据',
    group: 'signalAndRelay',
    requiredText: [/[^。]*看不到[^。]*(?:昵称|卡组|操作内容|对局数据)/],
  },
  /* ── §5.9 第 2 行"TURN 中继" ── */
  {
    id: 'relay-encrypted-unreadable',
    text: '§5.9：TURN 中继转发的是端到端加密流量，因而内容不可读',
    group: 'signalAndRelay',
    requiredText: [/[^。]*端到端加密[^。]*不可读/, /中继/],
  },
  {
    id: 'relay-no-storage',
    text: '§5.9：TURN 中继不存储任何内容',
    group: 'signalAndRelay',
    requiredText: [/[^。]*不存储/],
  },
  /* ── §5.9 第 3 行"对端玩家" ── */
  {
    id: 'peer-sees-ip',
    text: '§5.9：对端玩家能看到你的 IP（P2P 直连的必然结果）',
    group: 'peerVisible',
    requiredText: [/对手[^。]*能看到[^。]*IP/, /直连/],
  },
  {
    id: 'peer-cannot-see-deck',
    text: '§5.9：对端玩家看不到你的卡组文件与 L1 配置（文案里说成"本机保存的设置与昵称"）',
    group: 'peerVisible',
    requiredText: [/[^。]*看不到[^。]*卡组文件/, /[^。]*看不到[^。]*本机保存的设置/],
  },
  {
    id: 'peer-nickname-via-channel',
    text: '§5.9 已知项：昵称经 DataChannel（端到端加密）交换，不走信令明文',
    group: 'peerVisible',
    requiredText: [/昵称[^。]*加密通道/, /不经过任何中间服务器/],
  },
  /* ── §3.5 / §3.6 / 红线 3：本地数据与授权 ── */
  {
    id: 'consent-before-local-write',
    text: '红线 3 / §3.6：只有用户点「允许」之后才写本机；允许之前磁盘上零写入',
    group: 'localOnly',
    requiredText: [/授权弹窗/, /[^。]*之后[^。]*才会写进你自己的浏览器存储/, /[^。]*之前[^。]*磁盘上不会有任何写入/],
  },
  {
    id: 'user-can-clear-local',
    text: '§3.6：用户随时可在设置里改授权 / 清理本机数据（≠ 只能选一次）',
    group: 'localOnly',
    requiredText: [/本地数据与隐私/, /一键清除/],
  },
  {
    id: 'redline-3-guest-zero-write',
    text: '红线 3：拒绝授权（游客模式）时零写入磁盘，刷新或关闭即全丢',
    group: 'localOnly',
    requiredText: [/[^。]*不会写入磁盘/, /[^。]*刷新或关闭[^。]*全部丢失/, /只存在内存里/],
  },
  /* ── §8.1：离线缓存（"必须对玩家说明"） ── */
  {
    id: 'offline-cache-program-files',
    text: '§8.1：离线缓存预缓存的是 app shell（程序文件：页面/脚本/样式/卡图）',
    group: 'offlineCacheNote',
    requiredText: [/程序文件/, /页面[^。]*脚本[^。]*样式[^。]*卡图/],
  },
  {
    id: 'offline-cache-not-user-data',
    text: '§8.1：缓存的不是用户数据（这是红线 1 的边界，须写清）',
    group: 'offlineCacheNote',
    requiredText: [/[^。]*不是用户数据/, /昵称[^。]*卡组[^。]*档案[^。]*对局记录[^。]*不在这个离线缓存里/],
  },
];

/* ───────────────────────── 2. 唯一出处：全仓逐字计数 ───────────────────────── */

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
/** 文案唯一出处的**规范来源**（相对路径，正斜杠） */
const COPY_FILE = 'src/app/privacy.ts';

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(?:ts|tsx|js|mjs|css|html|json)$/.test(name)) out.push(full);
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
for (const base of ['src', 'tests']) {
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

/** `src/app` 是纯逻辑层：不得出现浏览器 API（Task 9 守卫同口径） */
const BROWSER_API = /\b(?:window|document|navigator|localStorage|sessionStorage|indexedDB|XMLHttpRequest|WebSocket)\s*(?:\.|\[)|\b(?:fetch|requestAnimationFrame|cancelAnimationFrame)\s*\(/;

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
    // 表本身的自检：13 条边界 + 5 个组都参与（重新数一遍，防止"表被删空"仍全绿）
    expect(BOUNDARY_DECLARATIONS.length).toBe(13);
    expect(new Set(BOUNDARY_DECLARATIONS.map((d) => d.group)).size).toBe(PRIVACY_GROUPS.length);
    expect(new Set(BOUNDARY_DECLARATIONS.map((d) => d.id)).size).toBe(BOUNDARY_DECLARATIONS.length);
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
    expect(mismatches.length, '抽空 signalAndRelay 后，门槛边界竟然还全部命中（落点跑到别组去了）').toBe(5);
  });

  it('§8.1：离线缓存写的是程序文件、不是用户数据（红线的边界必须说清）', () => {
    const note = PRIVACY_COPY.offlineCacheNote.join('\n');
    expect(note).toMatch(/程序文件/);
    expect(note).toMatch(/不是用户数据/);
  });

  it('未实现的联机能力必须标注"上线后才适用"，其余组一条都不许带（不实陈述 = bug）', () => {
    // 与 Task 5 的接口清单同口径的**独立**复算（不依赖 assertBoundaryTable 的实现）
    for (const key of PRIVACY_GROUPS) {
      const gated = key === 'signalAndRelay';
      for (const line of PRIVACY_COPY[key]) {
        expect(
          line.includes(ONLINE_GATE_MARK),
          `${key} 的这条${gated ? '缺少' : '不该有'}「${ONLINE_GATE_MARK}」：${line}`,
        ).toBe(gated);
      }
    }
    expect(isGatedCopyLine('signalAndRelay')).toBe(true);
    for (const key of PRIVACY_GROUPS.filter((k) => k !== 'signalAndRelay')) expect(isGatedCopyLine(key)).toBe(false);
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

  it('纯层：privacy.ts 不出现浏览器 API（src/app 的硬约束）', () => {
    const src = readFileSync(join(REPO_ROOT, COPY_FILE)).subarray(0, 4 * 1024 * 1024).toString('utf8');
    const code = stripComments(src);
    const hit = code.match(BROWSER_API);
    expect(hit?.[0] ?? null, `privacy.ts 里出现了浏览器 API：${hit?.[0]}`).toBe(null);
  });

  it('唯一出处：消费方通过 import 引用（本文件即示例），不得各写一份', () => {
    // 本测试文件自己就不许把文案抄一遍：只能通过 PRIVACY_COPY 拿到
    const self = normalize(stripComments(readFileSync(fileURLToPath(import.meta.url)).subarray(0, 4 * 1024 * 1024).toString('utf8')));
    for (const line of privacyLines()) {
      expect(self.includes(normalize(line)), `测试文件里抄了一份文案（应改为引用 PRIVACY_COPY）：${line}`).toBe(false);
    }
  });
});
