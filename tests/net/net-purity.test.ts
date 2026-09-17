import { describe, it, expect } from 'vitest';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { stripComments } from '../ui/source-text';

/**
 * G5 T1 守卫：`src/net` 的**纯层契约**（分层 `ui → net → app → core`，见裁决 D7）。
 *
 * 规格出处：
 *  - 计划 `docs/2026-09-17-G5-传输层联机-实现计划.md` §2 第 2 条（`src/net` 是纯层：不得出现
 *    浏览器 API / `Math.random` / `Date.now` / `performance.now` / 直呼定时器 / import `src/ui` /
 *    import `node:*`；能力一律注入）；
 *  - 裁决 D6 / D7 / D12 / D15（传输抽象是注入接口、纯层住 `src/net`、房间码随机源注入、
 *    承诺哈希由外部算好再喂进来）。
 *
 * ## 它为什么是 `tests/app-purity.test.ts` 的**照搬**而不是"再写一份差不多的"
 *
 * 那份守卫在 G3 落地时踩过三个坑，三个坑都不依赖"被扫的是哪个目录"，所以照搬即可全部继承：
 *  1. **注释不算命中** —— 本仓 `src/app` 里到处是"`showOpenFilePicker` / `document` 一律零命中"
 *     这类解释性注释。⇒ 先 `stripComments` 再按**调用/成员访问形态**匹配（不是裸词面）。
 *  2. **`globalThis.X` 绕行** —— `/\bdocument\s*\./` 抓不到 `globalThis.document`。
 *     `tests/core-purity.test.ts:91` 已有这个分支，照抄它，别再发明一遍。
 *  3. **下界自证** —— 路径写错会扫到 0 个文件，所有"零命中"断言在空数组上恒真
 *     （判据 5 钉住这一点，且**真去建目录、真去扫**，不是嘴上说说）。
 *
 * ## 与本任务的四条判据的对应
 *
 *  - 判据 4（四条腿各自能红）：`it('各条判据都有正控…')` 用**合成样本**逐条钉住"能红"，
 *    另有一组**真文件**（`写入 src/net 的四种被禁形态真的会被扫出来`）把同一套正则喂给
 *    临时目录里的四种形态 —— 后者才是"写进 `src/net` 的临时文件会让对应腿变红"的机械证明。
 *  - 判据 5（下界自证）：`it('把扫描目录指向空目录 ⇒ 报错')`。
 *
 * ## 临时目录放哪
 *
 * 临时目录建在 **`.superpowers/T1/probe-scan/`**（已 gitignore）里，**不**写进 `tests/`、
 * **不**写进仓库根的共享工作树 —— 本仓为"污染共享树"出过两次事故（AGENTS.md）。
 * 每次跑完都 `rmSync(recursive)` 清掉，并用 try/finally 保证红了也清。
 */

/** 被扫目录：本模块的纯层。写在**一处**，别在下面各处再拼一次路径 */
const NET_DIR = fileURLToPath(new URL('../../src/net/', import.meta.url));

/** 下界自证的阈值。今天 `src/net` 只有 `protocol.ts` 一个文件；T2-T7 会陆续加。
 *  ⚠️ 这个数**不许**为了"让测试变绿"往下调 —— 它只在"目录写错/被清空"时变红。 */
const MIN_FILES = 1;

/** 单文件最少字符数：读成空串会让所有"零命中"断言在空串上恒真（`app-purity` 的同款下界） */
const MIN_CHARS = 50;

/** 生成式遍历（`readdirSync` 的声明不递归，`statSync(...).isDirectory()` 才递归） */
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
}

/**
 * 相对路径（报错时好读）。
 *
 * ⚠️ **两种传法都要对**（实测踩过）：`NET_DIR`（`new URL('.../net/')`）**带**尾部分隔符，
 * 而 `mkdtempSync(...)` 的返回值**不带**。第一版直接 `file.slice(dir.length)`，
 * 于是临时目录那一支会把首字符切掉（`rtc.ts` → `tc.ts`），症状是"文件不在扫描结果里"。
 * ⇒ 先归一尾部分隔符。
 */
function rel(file: string, root: string): string {
  const base = root.endsWith('\\') || root.endsWith('/') ? root : `${root}\\`;
  return file.slice(base.length).split('\\').join('/');
}

interface Scanned {
  /** 相对路径 */
  path: string;
  /** 绝对路径（报错时能直接点开） */
  abs: string;
  /** 剥注释后的源码（字符串字面量原样保留，与 `app-purity` 同口径） */
  code: string;
}

function scan(dir: string): Scanned[] {
  return walk(dir).sort().map((p) => ({
    path: rel(p, dir),
    abs: p,
    code: stripComments(readFileSync(p).subarray(0, 4 * 1024 * 1024).toString('utf8')),
  }));
}

/** 模块说明符（`from '…'` 与动态 `import('…')`；都已剥注释） */
function specifiersOf(code: string): string[] {
  return [
    ...[...code.matchAll(/\bfrom\s*['"]([^'"]+)['"]/g)].map((m) => m[1]),
    ...[...code.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]),
  ];
}

/**
 * `globalThis.<浏览器全局>` 分支（照抄 `tests/app-purity.test.ts:81`，一个字都没改口径）。
 * 它存在的唯一理由：裸前缀正则抓不到"换个前缀就绕开"的写法。
 */
const GLOBAL_THIS_BROWSER =
  /\bglobalThis\s*\.\s*(?:window|document|navigator|fetch|localStorage|sessionStorage|indexedDB|XMLHttpRequest|WebSocket|RTCPeerConnection|serviceWorker|showOpenFilePicker|showSaveFilePicker|requestAnimationFrame|cancelAnimationFrame|getRandomValues|crypto)\b/;

/** `globalThis.<定时器>` 分支：定时器那组是**独立**的一条禁项（不是浏览器 API 那组） */
const GLOBAL_THIS_TIMER = /\bglobalThis\s*\.\s*(?:setTimeout|setInterval|cancelAnimationFrame|requestAnimationFrame)\b/;

/**
 * 被禁的**调用 / 成员访问**形态。标签只用于报错可读性，且必须唯一
 * （`tests/net/protocol.test.ts` 与下面的正控表都按标签取值）。
 *
 * 分族的口径与 `app-purity` 逐字一致：
 *  - **无歧义族**（`localStorage` / `indexedDB` / `WebSocket` …）：裸标识符即违规 ——
 *    游戏逻辑里不会有人把这些名字当局部变量，整词匹配的假阳风险是 0；
 *  - **有歧义族**（`document` / `window` / `navigator` / `fetch`）：只认"后跟 `.` 或 `(`"
 *    的形态，另加 `globalThis.` 与 `typeof` 两个绕行形态。
 */
export const BANNED_BROWSER: ReadonlyArray<readonly [string, RegExp]> = [
  ['localStorage', /\blocalStorage\b/],
  ['sessionStorage', /\bsessionStorage\b/],
  ['indexedDB', /\bindexedDB\b/],
  ['document 成员访问', /\bdocument\s*\./],
  ['window 成员访问', /\bwindow\s*\./],
  ['navigator 成员访问', /\bnavigator\s*\./],
  ['fetch 调用', /\bfetch\s*\(/],
  ['serviceWorker', /\bserviceWorker\b/],
  ['XMLHttpRequest', /\bXMLHttpRequest\b/],
  ['WebSocket', /\bWebSocket\b/],
  ['RTCPeerConnection', /\bRTCPeerConnection\b/],
  ['showOpenFilePicker / showSaveFilePicker', /\bshow(Open|Save)FilePicker\b/],
  ['getRandomValues', /\bgetRandomValues\b/],
  ['crypto 成员访问', /\bcrypto\s*\./],
  ['requestAnimationFrame / cancelAnimationFrame 调用', /\b(?:request|cancel)AnimationFrame\s*\(/],
  ['globalThis.<浏览器全局>', GLOBAL_THIS_BROWSER],
  ['typeof <浏览器全局>', /\btypeof\s+(?:document|window|navigator|localStorage|sessionStorage|indexedDB)\b/],
];

/** 时钟与随机：`src/net` 里连"取一次"都不许（一律由调用方注入） */
export const BANNED_CLOCK: ReadonlyArray<readonly [string, RegExp]> = [
  ['Math.random', /\bMath\s*\.\s*random\b/],
  ['Date.now', /\bDate\s*\.\s*now\b/],
  ['performance.now', /\bperformance\s*\.\s*now\b/],
];

/**
 * 定时器：**直呼**与**赋给变量再调用**两种绕行都抓。
 *
 * 为什么"赋给变量"要专门一条：`const t = globalThis.setTimeout;` 之后调 `t(fn, 0)`
 * 与 `setTimeout(fn, 0)` 对纯层是同一件事（都是"模块自己排了一个时钟"），
 * 而只写 `/\bsetTimeout\s*\(/` 的守卫对它零命中。
 * ⚠️ 已知**不可判**的第三种绕行：`const { setTimeout: t } = globalThis;` 或
 * `const n = 'set' + 'Timeout'` 这类**运行期**拼接。前者由 `globalThis.` 裸访问分支抓到，
 * 后者文本层面原理上抓不到（需要求值）。如实登记，不假装覆盖。
 */
export const BANNED_TIMER: ReadonlyArray<readonly [string, RegExp]> = [
  ['setTimeout', /\bsetTimeout\b/],
  ['setInterval', /\bsetInterval\b/],
  ['requestAnimationFrame / cancelAnimationFrame', /\b(?:request|cancel)AnimationFrame\b/],
  ['globalThis.<定时器>', GLOBAL_THIS_TIMER],
];

/** 对**任意**源码跑一遍某张判据表，返回命中的标签 */
function hitsOf(code: string, table: ReadonlyArray<readonly [string, RegExp]>): string[] {
  return table.filter(([, re]) => re.test(code)).map(([label]) => label);
}

/** 逐文件逐标签收集命中（报错信息要能看到"哪个文件里的哪一条"） */
function collect(sources: readonly Scanned[], table: ReadonlyArray<readonly [string, RegExp]>): string[] {
  const hits: string[] = [];
  for (const s of sources) {
    for (const label of hitsOf(s.code, table)) hits.push(`${s.path}: ${label}`);
  }
  return hits;
}

/**
 * 正控表：每个**标签**配一段**必然命中**的合成源码。
 *
 * 为什么按标签（而不是按 `table[i]`)遍历：这张表是"标签 → 样本"的映射，而表里每个标签
 * 恰好出现一次（下面有一条断言钉住这件事）⇒ 遍历样本就等于遍历表，
 * 且**标签写错**（比如把两条判据的标签互换）也会当场红 —— 那是本仓反复出现的一族假绿。
 */
const POSITIVE_SAMPLES: ReadonlyArray<readonly [string, string]> = [
  ['localStorage', 'const a = localStorage.getItem("k");'],
  ['sessionStorage', 'const a = sessionStorage.getItem("k");'],
  ['indexedDB', 'const a = indexedDB.open("db");'],
  ['document 成员访问', 'const a = document.createElement("div");'],
  ['window 成员访问', 'const a = window.innerWidth;'],
  ['navigator 成员访问', 'const a = navigator.userAgent;'],
  ['fetch 调用', 'const r = await fetch("/x");'],
  ['serviceWorker', 'const a = navigator.serviceWorker;'],
  ['XMLHttpRequest', 'const x = new XMLHttpRequest();'],
  ['WebSocket', 'const w = new WebSocket("wss://x");'],
  ['RTCPeerConnection', 'const pc = new RTCPeerConnection(cfg);'],
  ['showOpenFilePicker / showSaveFilePicker', 'const f = await showOpenFilePicker(opts);'],
  ['getRandomValues', 'crypto.getRandomValues(new Uint8Array(4));'],
  ['crypto 成员访问', 'const s = crypto.subtle;'],
  ['requestAnimationFrame / cancelAnimationFrame 调用', 'const h = requestAnimationFrame(cb);'],
  ['globalThis.<浏览器全局>', 'const f = globalThis.fetch;'],
  ['typeof <浏览器全局>', 'if (typeof document !== "undefined") { }'],
  ['Math.random', 'const d = Math.random();'],
  ['Date.now', 'const t = Date.now();'],
  ['performance.now', 'const t = performance.now();'],
  ['setTimeout', 'setTimeout(cb, 8);'],
  ['setInterval', 'setInterval(cb, 8);'],
  ['requestAnimationFrame / cancelAnimationFrame', 'const h = cancelAnimationFrame(0);'],
  ['globalThis.<定时器>', 'const t = globalThis.setTimeout;'],
];

const ALL_TABLES = [...BANNED_BROWSER, ...BANNED_CLOCK, ...BANNED_TIMER];

describe('src/net 的纯层契约（ui → net → app → core；net 不碰浏览器/时钟/UI/Node）', () => {
  const sources = scan(NET_DIR);

  it('至少扫到了本阶段的 net 模块（生成式：文件数必须 >= 1、且读到的内容非空）', () => {
    // 现状：`protocol.ts` 一个（T2-T7 会加）。这里**不写文件名清单** —— 写死清单会在
    // "新增模块漏扫"时假绿，只钉下界（与 `tests/app-purity.test.ts:121` 同款）。
    expect(
      sources.length,
      `src/net 下只扫到 ${sources.length} 个 .ts 文件（目录被清空 / 路径写错？）`,
    ).toBeGreaterThanOrEqual(MIN_FILES);
    for (const s of sources) {
      expect(s.code.length, `${s.path} 读成空串（判据会在空串上恒真）`).toBeGreaterThan(MIN_CHARS);
    }
  });

  it('浏览器 API 零命中（含 globalThis.X 与 typeof 两种绕行）', () => {
    const hits = collect(sources, BANNED_BROWSER);
    expect(hits, `src/net 里出现浏览器 API（应挪到 src/ui/net-browser.ts）：\n${hits.join('\n')}`).toEqual([]);
  });

  it('不自行取随机、不自行读时钟（Math.random / Date.now / performance.now 零命中）', () => {
    const hits = collect(sources, BANNED_CLOCK);
    expect(hits, `src/net 自己取随机或读时钟（能力必须注入）：\n${hits.join('\n')}`).toEqual([]);
  });

  it('不直呼定时器（也抓"赋给变量再调用"的绕行）', () => {
    const hits = collect(sources, BANNED_TIMER);
    expect(hits, `src/net 里出现定时器（定时器必须由宿主注入，见 Ticker 的取舍）：\n${hits.join('\n')}`).toEqual([]);
  });

  it('不得 import src/ui（依赖方向严格单向 ui → net）', () => {
    const hits: string[] = [];
    for (const s of sources) {
      for (const spec of specifiersOf(s.code)) {
        if (/(^|\/)ui\//.test(spec)) hits.push(`${s.path}: ${spec}`);
      }
    }
    expect(hits, `src/net 反向依赖了 src/ui：\n${hits.join('\n')}`).toEqual([]);
    // 锚点：说明符提取器真的工作（否则上面那条在空数组上恒真）
    expect(
      specifiersOf(stripComments("import { x } from '../ui/home';\nconst y = import('./ui/z');")),
      '说明符提取器没扫到 src/ui（锚点失效）',
    ).toEqual(['../ui/home', './ui/z']);
    expect(specifiersOf(stripComments("import { z } from './protocol';")), '锚点失效').toEqual(['./protocol']);
  });

  it('不得 import node:*（纯层在浏览器里也要能跑）', () => {
    const hits: string[] = [];
    for (const s of sources) {
      for (const spec of specifiersOf(s.code)) if (spec.startsWith('node:')) hits.push(`${s.path}: ${spec}`);
    }
    expect(hits, `src/net import 了 Node 内置模块：\n${hits.join('\n')}`).toEqual([]);
    expect(specifiersOf(stripComments("import { readFileSync } from 'node:fs';")), '正控失效').toEqual(['node:fs']);
  });

  it('各条判据都有正控（合成样本逐条能红），且注释与纯逻辑不被误判（反控）', () => {
    // 标签唯一性：重复标签会让"从标签取正则"的调用方取到错的那条（本仓出现过这一族假绿）
    const labels = ALL_TABLES.map(([l]) => l);
    expect(labels.length, '判据表里有重复标签').toBe(new Set(labels).size);
    // 覆盖完整性：正控表把三条判据表的每个标签都覆盖了一遍
    expect(POSITIVE_SAMPLES.map(([l]) => l).sort()).toEqual([...labels].sort());

    const byLabel = new Map(ALL_TABLES);
    for (const [label, sample] of POSITIVE_SAMPLES) {
      const re = byLabel.get(label);
      expect(re, `正控表里的标签在判据表里不存在：${label}`).toBeDefined();
      expect(re!.test(sample), `正控失效：${label} 的样本没被抓到：${sample}`).toBe(true);
    }

    // 反控 1：注释里提到这些名字**不算**命中（本仓 `src/net/protocol.ts` 的头注里就逐字写着
    // 它们 —— 没有这条，守卫会在自己的注释上假红）
    const commented = stripComments(
      '// 这里提到 WebSocket / localStorage / setTimeout / Math.random / crypto. 都不算\nconst a = 1;',
    );
    expect(hitsOf(commented, BANNED_BROWSER), '注释被判成浏览器 API（假红）').toEqual([]);
    expect(hitsOf(commented, BANNED_CLOCK), '注释被判成取时钟（假红）').toEqual([]);
    expect(hitsOf(commented, BANNED_TIMER), '注释被判成定时器（假红）').toEqual([]);

    // 反控 2：合法的纯逻辑代码一条都不许被误判
    const pure = 'export function pick(xs: number[]): number | null { return xs.length > 0 ? xs[0] : null; }';
    expect(hitsOf(pure, ALL_TABLES), '纯逻辑被判成违规（判据恒假）').toEqual([]);
  });

  it('写入 src/net 的被禁形态真的会被扫出来（判据 4：真文件，不是合成样本）', () => {
    // ★ 这条是判据 4 的机械证明：把计划 §5 T1 判据 4 点名的形态**真的写进文件**并**真的扫**。
    //   它与"合成样本"那条是两层：合成样本证明正则本身有效，这条证明 scan()/walk() 这条路有效
    //   （路径写错、后缀过滤写错、stripComments 用错，都会在这里暴露）。
    //   写入位置是 `.superpowers/T1/probe-scan-<随机>/`（已 gitignore），**不碰共享工作树**。
    //   ⚠️ 目录名必须**每次运行都唯一**（实测踩过）：同一台机器上两个 vitest 进程同时跑
    //   这棵树时（变异批的"判据一轮"与"探针一轮"挨着跑就会这样），固定目录名会让
    //   A 的 `rmSync` 删掉 B 正在写的文件 —— 实测症状是 `ENOENT ... clock.ts`，
    //   而且**间歇性**（一次红一次绿）。用 `mkdtempSync` 生成唯一目录，一次解决。
    //   （不用 `process.pid`：本仓 `tsconfig.json` 的 `types` 里没有 `@types/node`，
    //    `process` 在测试文件里不可见，加它得改 tsconfig —— 那是越界。）
    //
    // ⚠️ **为什么关键的名字必须在真文件样本里出现**（变异 M4 实测出来的洞）：
    //   本用例原先只有 rtc / timer / random / clock 四个样本，于是变异 M4（把 `WebSocket`
    //   从禁项表里删掉）在**这条用例**下变红的是"标签唯一性 / 正控覆盖完整性"，而不是
    //   `浏览器 API 零命中` 那条腿 —— 因为四个样本里**没有**一个含 `WebSocket`，
    //   `rtc.ts` 抓的是 `RTCPeerConnection`。也就是说那条腿当时对 WebSocket **没有牙**。
    //   ⇒ 补上 `ws.ts`，并把"哪些名字必须有真文件样本"钉成下面的 `REAL_FILE_REQUIRED`。
    //
    //   口径（为什么不要求**全部**标签都有真文件样本）：那些标签已经由上面的
    //   `POSITIVE_SAMPLES` **逐条**在合成样本上钉过一轮，再给每条都写一个真文件是重复；
    //   而"整张表扫过真文件"这件事由 `rtc.ts` / `ws.ts` / `timer.ts` / `random.ts` / `clock.ts`
    //   这五个**代表性**样本 + `scan()`/`walk()` 路径本身证明。这里只额外钉住"计划 §5 T1
    //   判据 4 点名的名字"与"每条变异要用的名字"，多一个都不加。
    const root = fileURLToPath(new URL('../../.superpowers/T1/', import.meta.url));
    mkdirSync(root, { recursive: true });
    const probeDir = mkdtempSync(join(root, 'probe-scan-'));
    const cases: ReadonlyArray<readonly [string, string, ReadonlyArray<readonly [string, RegExp]>]> = [
      ['rtc.ts', 'export const pc = new RTCPeerConnection({});\n', BANNED_BROWSER],
      ['ws.ts', 'export const sock = new WebSocket("wss://example.invalid");\n', BANNED_BROWSER],
      ['timer.ts', 'export function later(cb: () => void) { setTimeout(cb, 0); }\n', BANNED_TIMER],
      ['random.ts', 'export function roll() { return Math.random(); }\n', BANNED_CLOCK],
      ['clock.ts', 'export function stamp() { return Date.now(); }\n', BANNED_CLOCK],
    ];
    /** 必须**在真文件里**被扫出来的名字（判据 4 的原文 + 每条变异要用的靶子） */
    const REAL_FILE_REQUIRED: readonly string[] = [
      'RTCPeerConnection',
      'WebSocket',
      'setTimeout',
      'Math.random',
      'Date.now',
    ];

    try {
      for (const [name, text] of cases) writeFileSync(join(probeDir, name), text, 'utf8');
      const found = scan(probeDir);
      expect(found.length, `临时目录里的 ${cases.length} 个文件没被扫到（walk/后缀过滤坏了？）`).toBe(cases.length);
      for (const [name, , table] of cases) {
        const one = found.filter((s) => s.path === name);
        expect(one.length, `${name} 不在扫描结果里`).toBe(1);
        expect(
          hitsOf(one[0].code, table),
          `${name} 的被禁形态没被抓到（这条判据在真文件上失效）`,
        ).not.toEqual([]);
      }
      // ★ 覆盖面自证：`REAL_FILE_REQUIRED` 里的每个名字都必须被某个真文件样本打中。
      //   否则那条禁项可以悄悄失效，而"零命中"那条腿照样全绿（样本里根本没有它）。
      const sampled = new Set(
        cases.flatMap(([name]) => hitsOf(found.filter((s) => s.path === name)[0].code, ALL_TABLES)),
      );
      const unsampled = REAL_FILE_REQUIRED.filter((l) => !sampled.has(l));
      expect(
        unsampled,
        `这些名字在真文件样本里一个命中都没有（那条判据对它们没有牙）：${unsampled.join(' / ')}`,
      ).toEqual([]);
      // 反向：没有 WebSocket 的文件**不许**被报成浏览器 API 违规
      //   （否则上面那条可能是"报了一堆"式假绿）
      expect(collect(found, BANNED_BROWSER).filter((h) => h.includes('timer.ts'))).toEqual([]);
    } finally {
      rmSync(probeDir, { recursive: true, force: true });
    }
  });

  it('下界自证：把扫描目录指向空目录 ⇒ 报错（防"路径写错导致空扫为绿"）', () => {
    // 计划 §5 T1 判据 5 的机械证明：真建一个**空目录**、真扫它，然后断言"下界会红"。
    // 这里断言的是**判据本身**（`sources.length >= MIN_FILES`），不是调一次被测函数 ——
    // 因为下界就写在上面那条 `it` 里，把它的条件在这里复现一遍才能证明"空扫会红"。
    const parent = fileURLToPath(new URL('../../.superpowers/T1/', import.meta.url));
    mkdirSync(parent, { recursive: true });
    const empty = mkdtempSync(join(parent, 'empty-'));
    try {
      const found = scan(empty);
      expect(found.length, '空目录居然扫到了文件（下界自证的前提不成立）').toBe(0);
      // 这就是上面那条 `it` 的判据本身：空扫 ⇒ 必须断言失败
      let red = false;
      try {
        expect(found.length).toBeGreaterThanOrEqual(MIN_FILES);
      } catch {
        red = true;
      }
      expect(red, `空目录下界没有报错（阈值 ${MIN_FILES}），"零命中"全是假的`).toBe(true);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });

  it('守卫的路径本身是对的（NET_DIR 真的存在、且就是 src/net）', () => {
    // 一条便宜但值钱的腿：`fileURLToPath(new URL('../../src/net/', import.meta.url))` 写错一级
    // 时，`walk` 会在 `readdirSync` 上抛 ENOENT —— 这条腿让报错信息直接指向路径，而不是
    // 让上一条下界断言报"只扫到 0 个文件"（后者会被读成"目录被清空了"）。
    expect(NET_DIR.split('\\').join('/'), `NET_DIR 不在 src 下：${NET_DIR}`).toMatch(/\/src\/net\/$/);
    expect(scan(NET_DIR).some((s) => s.path === 'protocol.ts'), 'src/net/protocol.ts 没被扫到').toBe(true);
  });
});
