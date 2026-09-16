/**
 * G3 Task 6：档案导入/导出的**纯逻辑**腿（`src/app/archive-io.ts`）。
 *
 * 全部判据都是"跑一次拿返回值"，没有一条是"读源码找字符串" —— 这个文件能在 node 下
 * 真跑，因为 `archive-io.ts` 零浏览器 API、零 IO（对话框与磁盘在
 * `src/ui/archive-fs-browser.ts`，它的行为腿在 `tests/ui/archive-fs-browser.test.ts`）。
 *
 * 本文件钉住的要害：
 *  1. **文件名确定性**（同一份档案两次导出同名，时间戳来自 `createdAt` 而不是 `Date.now`）
 *     **且对任何输入都不抛、不产出路径分隔符**（修复轮 F5）；
 *  2. **大小判据按字节**（不是 UTF-16 码元数）**且先判大小再 parse** —— 后者有两条牙：
 *     一条"超限且不是合法 JSON ⇒ 必须是 too-large 而不是 not-json"的行为腿，
 *     一条"超限时 `parseMatchFile` **零调用**"的 spy 腿（F4）；
 *  3. **默认不覆盖**（`keep-both` 的 -2/-3 递增，`overwrite` 必须显式选）；
 *  4. **错误码完整透传**（`too-new` / `not-json` / `empty` / `too-large` 四种形态各一条腿）；
 *  5. **上限边界**（恰好 == MAX 属于可接受侧，MAX+1 才拒；修复轮 F6）；
 *  6. **`createdAt` 不合法只警告不拒绝**（修复轮 F5）。
 *
 * ## 变异实测的口径（必须写清楚，否则"存活/变红"没有意义）
 * 本文件的变异实测一律用**整份文件**跑（`npx vitest run tests/app/archive-io.test.ts`），
 * 然后从输出里核对**具体失败的腿名** —— **不用** `-t '<腿名>'` 过滤。
 * 理由是本仓刚发生过的真事故：`-t` 匹配 0 条腿时 vitest **退出码仍为 0**，
 * 于是"过滤器没匹配到任何东西"会被误读成"这条判据没有牙"。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  ARCHIVE_EXT,
  ARCHIVE_MIME,
  MAX_ARCHIVE_BYTES,
  archiveFileName,
  exportArchive,
  importArchive,
  nextArchiveName,
  resolveConflict,
  type ImportOutcome,
} from '../../src/app/archive-io';
import { MATCH_FILE_VERSION, parseMatchFile, stringifyMatchFile, type MatchFile } from '../../src/app/match-file';
import { CARD_DATA_HASH } from '../../src/app/card-data-hash';

/**
 * **F4 的 spy**：把 `parseMatchFile` 换成"记一笔再转发给真实现"的包装。
 *
 * 为什么必须有它：`"too-large 时不做 JSON.parse"` 这句话**不可机检** —— 评审者把大小判据
 * 整体挪到 `parseMatchFile` 之后，25/25 仍全绿（那句"会得到 ok:true"的注释不成立）。
 * 用 spy 断"零调用"之后，判据的位置**直接**可观测。
 * ⚠️ 正对照腿（"没超限时**确实**被调用一次"）是必需的：没有它，一个坏掉的 spy
 * （例如模块被 mock 成两份、spy 永远收不到调用）会让零调用断言**假绿**。
 */
vi.mock('../../src/app/match-file', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/app/match-file')>();
  return { ...actual, parseMatchFile: vi.fn(actual.parseMatchFile) };
});

const enc = new TextEncoder();

/** 一份最小的合法档案（形状与 `src/app/match-file.ts` 的 `MatchFile` 逐字对齐） */
const f = (): MatchFile => ({
  format: 'compile-match',
  version: MATCH_FILE_VERSION,
  cardDataHash: CARD_DATA_HASH,
  seed: 'abcdef0123456789',
  setup: {
    draftMode: 'normal',
    draftStarter: 0,
    firstToPlay: 1,
    draftPool: ['water'],
    draftPicks: ['water'],
    bannedProtocols: [],
  },
  players: [{ nick: '甲' }, { nick: '乙' }],
  actions: [{ seq: 0, player: 0, kind: 'advance', via: 'user' }],
  createdAt: '2026-09-16T12:34:56.000Z',
});

/** spy 的调用次数（`vi.mocked` 只做类型收窄，运行时就是那个 `vi.fn`） */
const parseCalls = (): number => vi.mocked(parseMatchFile).mock.calls.length;

beforeEach(() => {
  vi.mocked(parseMatchFile).mockClear();
});

/**
 * 构造一个**字节数**刚好超过上限、但**码元数**没超过的串（中文每字 3 字节）。
 *
 * `n` = 期望的 UTF-8 字节数（向上取整到 3 的倍数）。上限 8 MiB ⇒ 约 2.8M 个汉字，
 * 比"用 8M+ 个 ASCII 字符凑"省 3 倍内存，且正是"按码元数判会让它溜过去"的那个形状。
 */
function multibyteOfBytes(n: number): string {
  return '中'.repeat(Math.ceil(n / 3));
}

/**
 * 造一份**恰好** `target` 字节的**合法**档案文本（靠 `players[0].nick` 补 ASCII 填充）。
 *
 * 为什么要"合法"而不只是"够长"：F6 的边界值要求区分两件事 —— "恰好 == MAX 时**继续往下走**"
 * 与"MAX+1 时拒"。用**合法**档案才能在"恰好"那侧断言到 `ok:true`（最强的可接受证据），
 * 而不只是"不是 too-large"。ASCII `'A'` 每字 1 字节 ⇒ 填充多少就是多少字节，可精确控制。
 */
function archiveTextOfExactBytes(target: number): string {
  const probe = JSON.stringify(f());
  const pad = target - enc.encode(probe).length;
  if (pad < 0) throw new Error(`目标字节数太小（${target} < ${probe.length}）`);
  return JSON.stringify({ ...f(), players: [{ nick: `甲${'A'.repeat(pad)}` }, { nick: '乙' }] });
}

describe('档案文件名与导出', () => {
  it('文件名 = compile-<seed 前 8 位>-<yyyyMMdd-HHmmss>.compile-match.json（逐字比对）', () => {
    const n = archiveFileName(f());
    expect(n).toBe('compile-abcdef01-20260916-123456.compile-match.json');
    expect(n).toContain('abcdef01');
    expect(n).toMatch(/\.json$/);
  });

  it('**F3** 扩展名只有一个出处：文件名以 `.compile-match` + `ARCHIVE_EXT` 结尾（生成式）', () => {
    const n = archiveFileName(f());
    expect(n.endsWith(`.compile-match${ARCHIVE_EXT}`)).toBe(true);
    // 反证方向：把 `ARCHIVE_EXT` 改成别的值而文件名里仍硬编码 `.json` ⇒ 这条变红
    expect(ARCHIVE_EXT.startsWith('.')).toBe(true);
    expect(ARCHIVE_MIME).toContain('/');
  });

  it('文件名含时间戳、且**不含**冒号/毫秒（否则 Windows 落盘会因非法字符失败）', () => {
    const n = archiveFileName(f());
    expect(n).toContain('20260916-123456');
    expect(n).not.toContain(':');
    expect(n).not.toMatch(/\.\d{3}/);
  });

  it('同一份档案两次导出**同名**（确定性；时间戳取自 createdAt，不是 Date.now）', () => {
    const a = exportArchive(f());
    const b = exportArchive(f());
    expect(a.name).toBe(b.name);
    expect(a.name).toBe(archiveFileName(f()));
    // 换个 createdAt ⇒ 名字必须跟着变（证明时间戳真的来自档案，而不是某个常量）
    expect(archiveFileName({ ...f(), createdAt: '2030-01-02T03:04:05.000Z' }))
      .toBe('compile-abcdef01-20300102-030405.compile-match.json');
  });

  it('seed 短于 8 位时取全长（不补位、不抛）', () => {
    expect(archiveFileName({ ...f(), seed: 'ab' })).toBe('compile-ab-20260916-123456.compile-match.json');
  });

  it('exportArchive 的文本能被 importArchive 原样读回（往返闭合）', () => {
    const { name, text } = exportArchive(f());
    expect(name.endsWith(ARCHIVE_EXT)).toBe(true);
    const r = importArchive(text, { currentHash: CARD_DATA_HASH });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.file.actions).toEqual(f().actions);
    expect(r.file.seed).toBe('abcdef0123456789');
    expect(r.warnings).toEqual([]);
    // raw 是**原文**（不是被规范化后重新序列化的版本）
    expect(r.raw).toBe(text);
  });
});

/* ============================================================================
 * F5：`archiveFileName` 对**任何**档案字段都不抛、不产出路径分隔符
 * ========================================================================== */

describe('**F5** archiveFileName 的输入硬化（任何输入都不抛、不产出分隔符 / `..`）', () => {
  /** 刁钻输入：数字 / 分隔符 / 上跳 / 反斜杠 / unicode / 空串 / null / undefined / 对象 */
  const NASTY: unknown[] = [
    12345,
    0,
    '',
    '   ',
    '/',
    '\\',
    '..',
    '../..',
    '..\\..\\windows\\system32',
    '2026/09/16 12:34:56',
    '2026-09-16T12:34:56.000Z/../../etc/passwd',
    '中文🎴\u0000',
    null,
    undefined,
    {},
    [],
    ['/'],
    true,
  ];

  const SAFE_TAIL = `.compile-match${ARCHIVE_EXT}`;

  function assertSafe(name: string): void {
    expect(typeof name).toBe('string');
    expect(name.length).toBeGreaterThan(SAFE_TAIL.length);
    expect(name.includes('/')).toBe(false);
    expect(name.includes('\\')).toBe(false);
    expect(name.includes('..')).toBe(false);
    expect(name.endsWith(SAFE_TAIL)).toBe(true);
    // 只允许 `[A-Za-z0-9_.-]`（点只可能出现在固定后缀里）
    expect(/^[A-Za-z0-9_.-]+$/.test(name)).toBe(true);
  }

  it('createdAt 喂 18 种刁钻输入（含数字 / `/` / `..` / 反斜杠 / unicode / 空串 / null）⇒ 全部不抛且安全', () => {
    for (const v of NASTY) {
      let name = '';
      expect(() => { name = archiveFileName({ ...f(), createdAt: v as never }); }).not.toThrow();
      assertSafe(name);
    }
  });

  it('seed 喂同一组刁钻输入 ⇒ 同样不抛且安全', () => {
    for (const v of NASTY) {
      let name = '';
      expect(() => { name = archiveFileName({ ...f(), seed: v as never }); }).not.toThrow();
      assertSafe(name);
    }
  });

  it('两个字段**同时**是刁钻输入 ⇒ 仍安全（不是"只硬化了其中一个"）', () => {
    for (const v of NASTY) {
      let name = '';
      expect(() => { name = archiveFileName({ seed: v, createdAt: v } as never); }).not.toThrow();
      assertSafe(name);
    }
  });

  it('退化名**可预期**：createdAt 非字符串 / 非法（被剔除干净）⇒ 同一个确定的名字（两次调用相同）', () => {
    const a = archiveFileName({ ...f(), createdAt: 12345 as never });
    const b = archiveFileName({ ...f(), createdAt: null as never });
    const c = archiveFileName({ ...f(), createdAt: '//' as never });
    expect(a).toBe(b);
    expect(b).toBe(c);
    expect(a).toBe('compile-abcdef01-unknown-time.compile-match.json');
    // 合法输入**不**走退化名（防止"永远退化"的假实现把上面那条骗绿）
    expect(archiveFileName(f())).toBe('compile-abcdef01-20260916-123456.compile-match.json');
  });

  it('含 `/` 的 createdAt **不**把 `/` 带进文件名（评审者 P4c 的原始反例）', () => {
    const n = archiveFileName({ ...f(), createdAt: '2026/09/16 12:34:56' as never });
    expect(n).toBe('compile-abcdef01-20260916123456.compile-match.json');
    expect(n).not.toContain('/');
  });
});

/* ============================================================================
 * F5：`createdAt` 不是 ISO 形态 ⇒ 只警告、不拒绝
 * ========================================================================== */

describe('**F5** createdAt 不是合法 ISO 形态 ⇒ 只加一条警告，**不拒绝**（它不影响重放）', () => {
  const badCases: unknown[] = [12345, '2026/09/16 12:34:56', '', 'Not a date', '2026-09-16', 'x'.repeat(40)];

  it('六种非法 createdAt ⇒ 全部 ok:true 且**恰好**一条警告（含 createdAt 字样）', () => {
    for (const bad of badCases) {
      const r = importArchive(JSON.stringify({ ...f(), createdAt: bad }), { currentHash: CARD_DATA_HASH });
      expect(r.ok).toBe(true);
      if (!r.ok) continue;
      expect(r.warnings.length).toBe(1);
      expect(r.warnings[0]).toContain('createdAt');
    }
  });

  it('对照面：合法 ISO createdAt ⇒ **零**警告（防止"永远警告一条"把上面那条骗绿）', () => {
    for (const good of ['2026-09-16T12:34:56.000Z', '2026-09-16T12:34:56Z', '2026-09-16T12:34:56.123456+08:00']) {
      const r = importArchive(JSON.stringify({ ...f(), createdAt: good }), { currentHash: CARD_DATA_HASH });
      expect(r.ok).toBe(true);
      if (!r.ok) continue;
      expect(r.warnings).toEqual([]);
    }
  });

  it('非法 createdAt 的档案仍能导出成一个**安全**文件名（警告说的事是真的）', () => {
    const r = importArchive(JSON.stringify({ ...f(), createdAt: 12345 }), { currentHash: CARD_DATA_HASH });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const n = archiveFileName(r.file);
    expect(n).toBe('compile-abcdef01-unknown-time.compile-match.json');
  });
});

describe('导入的四类前置判据', () => {
  it('空内容 → empty', () => {
    const r = importArchive('   ', { currentHash: CARD_DATA_HASH });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('empty');
  });

  it('长度为 0 的串也 → empty（不是 not-json）', () => {
    const r = importArchive('', { currentHash: CARD_DATA_HASH });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('empty');
  });

  it('超过 8 MiB → too-large（且不做 JSON.parse）', () => {
    const r = importArchive('x'.repeat(MAX_ARCHIVE_BYTES + 1), { currentHash: CARD_DATA_HASH });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('too-large');
    // 消息里带上真实字节数：UI 要能告诉用户"你的文件多大"
    expect(r.message).toContain(String(MAX_ARCHIVE_BYTES + 1));
  });

  it('超限的**合法档案文本** → 仍是 too-large（证明确实先判大小、没先 parse）', () => {
    // 用 `JSON.stringify` 的 `toJSON` 缝造出"结构完全合法的档案、但体积超限"。
    const data = f() as unknown as { actions: unknown[] };
    data.actions = [{ seq: 0, player: 0, kind: 'advance', toJSON: () => 'x'.repeat(MAX_ARCHIVE_BYTES) }];
    const big = JSON.stringify(data);
    expect(enc.encode(big).length).toBeGreaterThan(MAX_ARCHIVE_BYTES);
    const r = importArchive(big, { currentHash: CARD_DATA_HASH });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('too-large');
  });

  it('**F4** 超限且**不是合法 JSON** ⇒ 必须是 too-large（判据若在 parse 之后，这里必然是 not-json）', () => {
    // 这是最便宜也最直接的"可观测化"：一份 8 MiB 的 `'x'` 既超限、又不是 JSON。
    //   * 判据在 parse **之前** ⇒ too-large（本腿绿）；
    //   * 判据在 parse **之后** ⇒ `parseMatchFile` 先返回 not-json ⇒ 本腿红。
    const r = importArchive('x'.repeat(MAX_ARCHIVE_BYTES + 1), { currentHash: CARD_DATA_HASH });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).not.toBe('not-json');
    expect(r.code).toBe('too-large');
  });

  it('**F4** 超限时 `parseMatchFile` **零调用**（spy；判据的位置直接可观测）', () => {
    const r = importArchive('x'.repeat(MAX_ARCHIVE_BYTES + 1), { currentHash: CARD_DATA_HASH });
    expect(r.ok).toBe(false);
    expect(parseCalls()).toBe(0);
  });

  it('**F4 正对照**：没超限时 `parseMatchFile` **确实**被调用了一次（否则上面那条零调用可能是坏 spy 的假绿）', () => {
    importArchive('{oops', { currentHash: CARD_DATA_HASH });
    expect(parseCalls()).toBe(1);
  });

  it('大小判据按**字节**而不是码元数：中文串长度 < 上限但字节 > 上限 → too-large', () => {
    const s = multibyteOfBytes(MAX_ARCHIVE_BYTES + 9);
    // 前提成立：码元数**没有**超上限（按 .length 判就会放行）
    expect(s.length).toBeLessThan(MAX_ARCHIVE_BYTES);
    expect(enc.encode(s).length).toBeGreaterThan(MAX_ARCHIVE_BYTES);
    const r = importArchive(s, { currentHash: CARD_DATA_HASH });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('too-large');
  });

  it('emoji（**4 字节**/字）同样按字节计：码元数远小于上限也会被挡下', () => {
    const s = '🎴'.repeat(Math.ceil((MAX_ARCHIVE_BYTES + 9) / 4));
    expect(s.length).toBeLessThan(MAX_ARCHIVE_BYTES);           // UTF-16 里一个 emoji 是 2 个码元
    expect(enc.encode(s).length).toBeGreaterThan(MAX_ARCHIVE_BYTES);
    const r = importArchive(s, { currentHash: CARD_DATA_HASH });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('too-large');
  });

  it('孤立代理对按 U+FFFD（**3 字节**）计（诚实边界：这条主要固化行为，判别力弱于上面的中文/emoji 腿）', () => {
    const half = '\uD800';
    expect(enc.encode(half).length).toBe(3);                     // 前提：编码器把它换成 U+FFFD
    const n = Math.ceil((MAX_ARCHIVE_BYTES + 3) / 3);
    const s = half.repeat(n);
    expect(s.length).toBeLessThan(MAX_ARCHIVE_BYTES);
    expect(enc.encode(s).length).toBeGreaterThan(MAX_ARCHIVE_BYTES);
    const r = importArchive(s, { currentHash: CARD_DATA_HASH });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('too-large');
  });

  it('码元数与字节数都**没**超上限的中文串不会被大小判据挡下（只是解析失败）', () => {
    // 这条是上面那条的对照面：证明 too-large 只由字节数触发，不是"见到中文就拒"
    const r = importArchive('{中'.repeat(1000), { currentHash: CARD_DATA_HASH });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('not-json');
  });

  it('版本过新 → too-new 透传（§3.3：不猜测）', () => {
    const r = importArchive(JSON.stringify({ ...f(), version: 99 }), { currentHash: CARD_DATA_HASH });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('too-new');
  });

  it('坏操作（seq 与下标不符）→ bad-action 透传', () => {
    const r = importArchive(
      JSON.stringify({ ...f(), actions: [{ seq: 7, player: 0, kind: 'advance' }] }),
      { currentHash: CARD_DATA_HASH },
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('bad-action');
  });

  /**
   * ⚠️ **这一对腿看起来互斥，其实同时成立**（G3 Task 6 修复轮 · 评审偏差 #4 的理由更正）。
   *
   * 下面两条一条要"恰好 1 个警告"、一条要"0 个警告"，但它们的输入**不同**：
   *  - 前者 `currentHash: '0000000000000000'` —— 故意与本机指纹不同 ⇒ **必**有一条卡牌警告；
   *  - 后者 `currentHash: CARD_DATA_HASH` —— 与本机一致 ⇒ **零**卡牌警告。
   *
   * 上一轮报告曾据此声称"计划骨架的 warnings 自相矛盾" —— **那句话不成立，是本实现者的
   * 误读**：计划 `docs/…G3…:2176` 用 `currentHash = CARD_DATA_HASH`（⇒ 0 条）、
   * `:2207` 用 `currentHash = '0000000000000000'`（⇒ 1 条），**两处本来就同时成立**
   * （实测 `CARD_DATA_HASH = 9d3a2d8ad585ff5e`）。把计划里的一处拆成这两条相反腿本身是**改进**
   * （保留），但**正当理由**是"把'警告条件真的由指纹决定'钉成可机检"，而不是"计划自相矛盾"。
   */
  it('卡牌数据不匹配 → ok 但带警告（§3.3 第 3 条：警告并允许仍要打开）', () => {
    const r = importArchive(stringifyMatchFile(f()), { currentHash: '0000000000000000' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.warnings.length).toBe(1);
    expect(r.warnings[0]).toContain('0000000000000000');
  });

  it('指纹一致 ⇒ 零警告（与上一条互为反面，防止"永远警告一条"的假实现）', () => {
    const r = importArchive(stringifyMatchFile(f()), { currentHash: CARD_DATA_HASH });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.warnings).toEqual([]);
  });

  it('损坏的 JSON → not-json（保留原文件不动：调用方负责不写盘）', () => {
    const r = importArchive('{oops', { currentHash: CARD_DATA_HASH });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('not-json');
  });

  it('顶层不是对象（JSON 合法但是别的文件）→ not-a-match-file', () => {
    const r = importArchive('[1,2,3]', { currentHash: CARD_DATA_HASH });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('not-a-match-file');
  });

  it('`read-failed` 仍在码集里（本模块**永不产出**它，由调用方在 FilePicker 层合成；删掉它会让 UI 少一条分支）', () => {
    // 这条是**编译期**判据：下面这个对象字面量一旦不再满足 `ImportOutcome`，`tsc --noEmit` 当场红。
    // 运行时那一行 `expect` 只是让"这条腿真的跑过"可见。
    const synthesized: ImportOutcome = { ok: false, code: 'read-failed', message: '文件读不出来（调用方合成）' };
    expect(synthesized.ok).toBe(false);
  });
});

/* ============================================================================
 * F6：上限的**边界值**（恰好可接受 / 多一字节才拒）
 * ========================================================================== */

describe('**F6** MAX_ARCHIVE_BYTES 的边界（`>` 不能变成 `>=`）', () => {
  it('恰好 == MAX 字节（**合法档案**）⇒ ok:true（边界值属于可接受侧）', () => {
    const text = archiveTextOfExactBytes(MAX_ARCHIVE_BYTES);
    expect(enc.encode(text).length).toBe(MAX_ARCHIVE_BYTES); // 前提：构造器真的精确到了字节
    const r = importArchive(text, { currentHash: CARD_DATA_HASH });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.warnings).toEqual([]);
  });

  it('恰好 == MAX 字节（不合法 JSON）⇒ **不是** too-large（判据真的走过去了）', () => {
    const s = 'x'.repeat(MAX_ARCHIVE_BYTES);
    expect(enc.encode(s).length).toBe(MAX_ARCHIVE_BYTES);
    const r = importArchive(s, { currentHash: CARD_DATA_HASH });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('not-json');
    expect(r.code).not.toBe('too-large');
  });

  it('MAX + 1 字节 ⇒ too-large（`>` 改成 `>=` 时这条与上面那条会同时变红）', () => {
    const s = 'x'.repeat(MAX_ARCHIVE_BYTES + 1);
    expect(enc.encode(s).length).toBe(MAX_ARCHIVE_BYTES + 1);
    const r = importArchive(s, { currentHash: CARD_DATA_HASH });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('too-large');
    expect(r.message).toContain(String(MAX_ARCHIVE_BYTES + 1));
  });

  it('MAX 字节的**合法档案** + 1 个填充字节 ⇒ too-large（把上面两条的分界钉在同一个被判对象上）', () => {
    const okText = archiveTextOfExactBytes(MAX_ARCHIVE_BYTES);
    const r1 = importArchive(okText, { currentHash: CARD_DATA_HASH });
    expect(r1.ok).toBe(true);
    // 同一个构造器，只多 1 个 ASCII 填充字符 ⇒ 恰好 +1 字节
    const over = archiveTextOfExactBytes(MAX_ARCHIVE_BYTES + 1);
    expect(enc.encode(over).length).toBe(MAX_ARCHIVE_BYTES + 1);
    const r2 = importArchive(over, { currentHash: CARD_DATA_HASH });
    expect(r2.ok).toBe(false);
    if (r2.ok) return;
    expect(r2.code).toBe('too-large');
  });
});

describe('冲突策略（默认 keep-both：不覆盖用户数据）', () => {
  it('nextArchiveName 依次给出 -2 / -3 …', () => {
    expect(nextArchiveName(['a.json'], 'a.json')).toBe('a-2.json');
    expect(nextArchiveName(['a.json', 'a-2.json'], 'a.json')).toBe('a-3.json');
    expect(nextArchiveName([], 'a.json')).toBe('a.json');
  });

  it('nextArchiveName：desired 空闲 ⇒ 原样返回（不多加 -2）', () => {
    expect(nextArchiveName(['b.json', 'c.json'], 'a.json')).toBe('a.json');
  });

  it('nextArchiveName：填空洞（有 a.json 与 a-3.json 时给 a-2.json）', () => {
    expect(nextArchiveName(['a.json', 'a-3.json'], 'a.json')).toBe('a-2.json');
  });

  it('nextArchiveName：无扩展名（含点开头的隐藏文件）时后缀缀在末尾', () => {
    expect(nextArchiveName(['a'], 'a')).toBe('a-2');
    expect(nextArchiveName(['.env'], '.env')).toBe('.env-2');
  });

  it('nextArchiveName：desired **自带后缀**（`a-2.json`）时给出 `a-2-2.json`（不把 `-2` 当成可替换的序号）', () => {
    // 评审者点名的未覆盖形状。语义上"填洞"只发生在 `desired` **本身**被占用时的后缀追加，
    // 而"把 -2 递增成 -3"是**另一个**函数该做的事（本仓没有）—— 这条腿把这个取舍钉住。
    expect(nextArchiveName(['a-2.json'], 'a-2.json')).toBe('a-2-2.json');
    expect(nextArchiveName(['a-2.json', 'a-2-2.json'], 'a-2.json')).toBe('a-2-3.json');
  });

  it('nextArchiveName 的候选名必须**不在** existing 里（生成式：连跑 50 次都不撞）', () => {
    const existing = ['a.json', ...Array.from({ length: 50 }, (_, i) => `a-${i + 2}.json`)];
    const got = nextArchiveName(existing, 'a.json');
    expect(existing).not.toContain(got);
    expect(got).toBe('a-52.json');
  });

  it('keep-both 永不覆盖；overwrite 覆盖；skip 跳过', () => {
    expect(resolveConflict(['a.json'], 'a.json', 'keep-both')).toEqual({ action: 'write', name: 'a-2.json' });
    expect(resolveConflict(['a.json'], 'a.json', 'overwrite')).toEqual({ action: 'write', name: 'a.json' });
    expect(resolveConflict(['a.json'], 'a.json', 'skip')).toEqual({ action: 'skip', name: 'a.json' });
    expect(resolveConflict([], 'a.json', 'skip')).toEqual({ action: 'write', name: 'a.json' });
  });

  it('三种策略在"没有冲突"时都必须 write（否则新档案会被静默丢掉）', () => {
    for (const s of ['keep-both', 'overwrite', 'skip'] as const) {
      expect(resolveConflict(['z.json'], 'a.json', s)).toEqual({ action: 'write', name: 'a.json' });
    }
  });

  it('keep-both 的产出名**恒不覆盖**既有名字（生成式：在每个策略下都不许命中 existing）', () => {
    const existing = ['a.json', 'a-2.json', 'a-3.json'];
    const r = resolveConflict(existing, 'a.json', 'keep-both');
    expect(r.action).toBe('write');
    expect(existing).not.toContain(r.name);
  });
});
