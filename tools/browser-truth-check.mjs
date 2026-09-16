#!/usr/bin/env node
/* ============================================================================
 * 运行期浏览器真值自查（`node tools/browser-truth-check.mjs`）
 *
 * ## 为什么要有这个工具（三个只有浏览器能看见的缺陷）
 *  · **R10-2**：`styles.css:422` 的 `.stack { --card-h: 175px }` 声明在**元素自己身上**，
 *    而自定义属性只在该元素自己没有声明时才继承 ⇒ 任何"把旋钮上提"的改动都赢不了它，
 *    而仓库里的守卫（解算声明 + 权重 + 源序）**看不见浏览器级联的真实胜负**。
 *  · **R12**：预览工具条把放牌区挤掉 **98px** —— 那是 `flex/grid` 真实求解的结果，DOM 桩没有布局引擎。
 *  · **R17**：`.net-hand-area-foe` 与基类**同权重、被源序吃掉** —— 同族。
 * 三者的共同结论是："运行期 `getComputedStyle` / `getBoundingClientRect` 真值自查是唯一能抓住
 * 这一族的守卫"。这个工具就是那句话的落地。
 *
 * ## 它做什么
 *  1. 在**备用端口**（缺省 5199）起一个**临时** vite（用本仓 `node_modules/vite/bin/vite.js`，
 *     不经 `npx`、不装任何东西）；端口若已被占用就**拒绝启动**（保护用户自己的 dev server）。
 *  2. 用系统 Chrome 的 **headless** 模式（`--headless=new` + `--dump-dom` + 临时 `--user-data-dir`）
 *     载入 `tools/browser-truth-probe.html`，逐场景跑：热座页 / 远程页（viewSeat 0 与 1）。
 *  3. 探针在真浏览器里给出每项的「期望值（尽量单源）」与「浏览器实测值」；
 *     **本文件负责容差比较与退出码**（浏览器管真值，Node 管判据）。
 *  4. 收工杀掉 vite 与 Chrome 的**整棵进程树**，并自证"端口未监听 / 没有留下 chrome 进程"。
 *
 * ## 为什么用"文件描述符"而不是管道收 Chrome 的输出
 * 本仓的宿主沙箱在某些模式下**禁止程序用管道捕获子进程输出**（Node `child_process` 的默认
 * `stdio: 'pipe'` 会 EPERM，而 `stdio: 'inherit' / 'ignore'` 正常）。所以这里一律
 * `stdio: ['ignore', fd, 'ignore']` —— **把子进程的 stdout 直接写进文件**，然后读文件。
 * 这既绕开了那条边界，也顺带留下了可复查的原始证据。
 *
 * ## ⚠️⚠️ 绝不要用 `chrome --version` 探测浏览器
 * 这台机器上 `--version` 会**起一个用用户默认 profile 的真 Chrome**（R23 已踩过：它会弹窗、
 * 会占用用户的登录态，甚至可能与用户正在用的窗口抢 profile 锁）。本工具只用
 * `fs.existsSync()` 判断可执行文件在不在，**从不执行探测命令**。
 *
 * ## 它证明什么 / 不能证明什么
 *  **能**：元素的计算样式真值（含自定义属性在**级联之后**的值）、真实 `getBoundingClientRect`
 *  （含 transform 之后的视觉足迹）、真实 flex/grid 求解出来的位置与尺寸、以及"某个选择器到底
 *  命中没命中"这类只有级联能回答的问题。
 *  **不能**：① 观感（好看不好看只能人眼）；② 动画**中间帧**（`--dump-dom` 下 rAF 不产帧、
 *  过渡在虚拟时钟下不推进 —— 见探针头注的三个陷阱）；③ 真实点击/拖拽/键盘输入（这里从不派发事件）。
 *
 * ## 什么时候该跑它
 * 任何**动布局/尺寸**的改动之后（`--card-h`/`--card-w` 旋钮、`.net-board` 网格、栏位/停靠栏、
 * 协议与能量槽的落点、控制轨、任何 `calc()` 表达式）。它在**四道门禁之外**（门禁跑在 node 里、
 * 没有浏览器），是"第五道：浏览器"。
 *
 * 用法：
 *   node tools/browser-truth-check.mjs                     # 三个场景，全部条目
 *   node tools/browser-truth-check.mjs --port 5299         # 换端口（缺省 5199）
 *   node tools/browser-truth-check.mjs --json out.json     # 原始结果落盘（供报告引用）
 *   node tools/browser-truth-check.mjs --shots             # 每个场景额外截一张图（写 .superpowers/）
 *   node tools/browser-truth-check.mjs --no-shots          # 不截图（缺省就不截图）
 *   node tools/browser-truth-check.mjs --only battery.     # 只跑 id 以此开头的项
 *   node tools/browser-truth-check.mjs --tol 2             # 覆盖缺省容差（1px）
 *   node tools/browser-truth-check.mjs --win 2200x1400     # 测量窗口（缺省 2200×1400，见下）
 *   node tools/browser-truth-check.mjs --keep              # 不杀进程（调试用；此时不会自证）
 *
 * ## 窗口尺寸是**测量基准的一部分**（为什么缺省是 2200×1400）
 * 热座页的 `.lane-row` 是 `grid-template-columns: minmax(660px,1fr) auto auto minmax(660px,1fr)`，
 * 两条链路列各要 **660px** 起 ⇒ 加上协议两列与间距，**放牌区需要 ≈1800px 内容宽**
 * 才装得下（`#app { max-width: 2000px; padding: 0 100px }` ⇒ 视口 ≈2000px 起）。
 * 窗口不够宽时 Grid **不会**报错，而是把 `auto` 的协议列压成 0（实测：1500px 窗口下
 * `.protocol-cell` = 10px、`.protocol-img` 宽 = **0**，协议图整块不可见）——那会让"协议几何"
 * 那一整段测量**全部失真**。所以：① 缺省窗口取 2200×1400（两个页面都装得下）；
 * ② 每个场景都有一条 `layout.noOverflow.*` 条目，**容器一旦横向溢出就响亮报红**，
 * 提醒"这轮测量是在装不下的布局里做的，先换窗口再看别的差异"。
 * ⚠️ 换窗口 ⇒ 绝对像素会变，但**判据仍然有效**：每一项的期望值都是从页面自己推导出来的
 * （CSS 声明 / CSS 变量 / 相邻元素），不是记下来的绝对坐标。
 *
 * 退出码：0 = 全部通过；1 = 有差异 / 有警告（探针缺项、单源取值失败、图片没加载）；
 *        2 = 环境错误（端口被占、找不到 Chrome、vite 起不来）。
 * ========================================================================== */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, openSync, closeSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { connect } from 'node:net';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');
const DEFAULT_PORT = 5199;
const SCENARIOS = [
  { key: 'hotseat', label: '热座页', query: 'scenario=hotseat' },
  { key: 'net-0', label: '远程页 · viewSeat=0', query: 'scenario=net&seat=0' },
  { key: 'net-1', label: '远程页 · viewSeat=1', query: 'scenario=net&seat=1' },
];
const WIN_DEFAULT = '2200x1400';

/* ── 参数 ─────────────────────────────────────────────────────────────────── */
const argv = process.argv.slice(2);
const argVal = (name, dflt = null) => {
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : dflt;
};
const PORT = Number(argVal('--port', DEFAULT_PORT));
const TOL = Number(argVal('--tol', 1));
const ONLY = argVal('--only', null);
const JSON_OUT = argVal('--json', null);
const SHOTS = argv.includes('--shots') && !argv.includes('--no-shots');
const KEEP = argv.includes('--keep');

const say = (m) => process.stdout.write(`${m}\n`);
const die = (m) => { say(`\n✗ 环境错误：${m}`); process.exit(2); };

// ⚠️ 必须在 `argVal` / `die` **定义之后**再求值（`const` 的 TDZ：提前调用会
// `ReferenceError: Cannot access 'argVal' before initialization` —— 第一版就是这样崩的）。
const WIN = (() => {
  const raw = String(argVal('--win', WIN_DEFAULT));
  const m = /^(\d+)x(\d+)$/.exec(raw);
  if (!m) die(`--win 的格式是 WxH（例如 ${WIN_DEFAULT}），收到 ${JSON.stringify(raw)}`);
  return { w: Number(m[1]), h: Number(m[2]) };
})();

/* ── 工具 ─────────────────────────────────────────────────────────────────── */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 端口是否有人监听（连得上 = 有人）。用于**开工前**保护用户的 dev server 与**收工后**自证。 */
function portListening(port) {
  return new Promise((res) => {
    const sock = connect({ port, host: '127.0.0.1' });
    const done = (v) => { sock.destroy(); res(v); };
    sock.once('connect', () => done(true));
    sock.once('error', () => done(false));
    setTimeout(() => done(false), 1200);
  });
}

/**
 * 找浏览器可执行文件。**只查存在性，绝不执行 `--version` 之类的探测命令**（见文件头注：
 * 那会起一个用用户默认 profile 的真 Chrome，R23 已踩过）。
 * 顺序：显式 `--chrome=` → 环境变量 `CHROME_PATH` → 常见安装路径（Chrome 优先，Edge 兜底）。
 */
function findChrome(explicit) {
  const win = process.platform === 'win32';
  const candidates = [];
  if (explicit) candidates.push(explicit);
  if (process.env.CHROME_PATH) candidates.push(process.env.CHROME_PATH);
  if (win) {
    const pf = process.env['ProgramFiles'] ?? 'C:\\Program Files';
    const pf86 = process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)';
    const local = process.env['LOCALAPPDATA'] ?? '';
    for (const root of [pf, pf86]) {
      candidates.push(join(root, 'Google', 'Chrome', 'Application', 'chrome.exe'));
      candidates.push(join(root, 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
    }
    if (local) {
      candidates.push(join(local, 'Google', 'Chrome', 'Application', 'chrome.exe'));
      candidates.push(join(local, 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
    }
  } else {
    candidates.push(
      '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium',
      '/usr/bin/chromium-browser', '/snap/bin/chromium',
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    );
  }
  for (const c of candidates) if (c && existsSync(c)) return c;
  return null;
}

/** 杀掉整棵进程树（Windows 用 `taskkill /T`，POSIX 用进程组）。 */
function killTree(pid) {
  if (!pid) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    try { process.kill(-pid, 'SIGKILL'); } catch { try { process.kill(pid, 'SIGKILL'); } catch { /* 已退出 */ } }
  }
}

/** 列出命令行里带某个标记的进程（收工自证用：标记 = 本次的临时 profile 目录）。
 *  ⚠️ 用 `.Contains()` 而不是 `-like`：`-like` 的 `[` / `?` / `*` 是通配符，而临时路径可能含它们。
 *  ⚠️ 必须**排除 powershell/pwsh 自己**：标记就在我们这条查询命令的命令行里，否则恒自匹配。 */
function processesMentioning(marker) {
  if (!marker) return [];
  const tmp = join(tmpdir(), `btc-ps-${Date.now()}.txt`);
  const fd = openSync(tmp, 'w');
  let ok = true;
  try {
    if (process.platform === 'win32') {
      const script = `$m='${marker.replace(/'/g, "''")}'; `
        + 'Get-CimInstance Win32_Process | Where-Object { '
        + "$_.Name -ne 'powershell.exe' -and $_.Name -ne 'pwsh.exe' -and $_.CommandLine -and $_.CommandLine.Contains($m) } "
        + '| Select-Object -ExpandProperty ProcessId';
      // ⚠️ Windows PowerShell 与 pwsh 都试一遍（有些机器只有其中一个在 PATH 上）。
      let r = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], { stdio: ['ignore', fd, 'ignore'] });
      if (r.error) r = spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-Command', script], { stdio: ['ignore', fd, 'ignore'] });
      ok = r.status === 0;
    } else {
      const r = spawnSync('sh', ['-c', `ps -eo pid=,args= | grep -F ${JSON.stringify(marker)} | grep -v grep | awk '{print $1}'`],
        { stdio: ['ignore', fd, 'ignore'] });
      ok = r.status === 0;
    }
  } catch { ok = false; }
  closeSync(fd);
  const txt = readFileSync(tmp, 'utf8');
  rmSync(tmp, { force: true });
  if (!ok) return null;                 // 查不了就如实返回 null（由调用方降级为"未自证"）
  return txt.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
}

/** 从 `chrome --dump-dom` 的 DOM 文本里取探针 JSON。 */
function extractProbe(dom) {
  const at = dom.indexOf('<pre id="__probe">');
  if (at < 0) return null;
  const from = dom.indexOf('{', at);
  const to = dom.indexOf('</pre>', from);
  if (from < 0 || to < 0) return null;
  const raw = dom.slice(from, to)
    .replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  if (raw.trim() === '') return { empty: true };
  try { return JSON.parse(raw); } catch (e) { return { parseError: String(e) }; }
}

/* ── 判定 ─────────────────────────────────────────────────────────────────── */
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * **在案差异**（id → 一句话说明）：这些条目**仍然算失败、仍然让退出码非零** ——
 * 这里只做"分组显示"，让**新出现**的差异在输出里一眼可辨。绝不把真差异洗成"期望值"。
 *
 * ⚠️ 往这张表里加条目之前先问自己：这是"已诊断、已上报、等产品裁决"的真差异吗？
 * 如果是"容差不够"，那就去论证容差（写进 `tok` / 项自带的 `tol`），**不要**塞进这里。
 */
const KNOWN_ISSUES = new Map([
  ['layout.overflow._lane_row', '热座 `.lane-row`（grid 4 列）需要 ≈1919px 内容宽，而 `#app{max-width:2000px;padding:0 100px}` '
    + '把内容宽**封在 1800px** ⇒ 任何视口下都溢出 ≈119px（协议两列被压）。首轮实测（本工具的第一跑），已上报，未修。'],
  ['layout.overflow._board', '同上，热座板根 `.board` 溢出 ≈166px（含 `.lane-row` 的 119px 与手牌条带）。首轮实测，已上报，未修。'],
]);

/** 一项是否通过。数值项按容差；字符串/布尔项必须严格相等。 */
function judge(it, tolOverride) {
  const tol = num(it.tol) ?? (num(tolOverride) ? tolOverride : TOL);
  if (it.expected === null || it.expected === undefined || it.measured === null || it.measured === undefined) {
    return { pass: false, why: '期望值或实测值缺失（探针缺项 / 单源取值失败）' };
  }
  const e = num(it.expected), m = num(it.measured);
  if (e !== null && m !== null) {
    const d = Math.abs(e - m);
    return { pass: d <= tol, why: `|Δ|=${d.toFixed(3)} > 容差 ${tol}`, delta: d };
  }
  return { pass: String(it.expected) === String(it.measured), why: '字符串/布尔项不相等' };
}

const fmt = (v) => {
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(3);
  if (v === null || v === undefined) return '—';
  return String(v);
};

/* ── 主流程 ───────────────────────────────────────────────────────────────── */
const VITE = join(REPO, 'node_modules', 'vite', 'bin', 'vite.js');
if (!existsSync(VITE)) die(`找不到 vite（${VITE}）—— 本仓 node_modules 未安装？本工具**不**会 npm install`);
const PROBE = join(HERE, 'browser-truth-probe.html');
if (!existsSync(PROBE)) die(`找不到探针页 ${PROBE}`);
const chrome = findChrome(argVal('--chrome', null));
if (!chrome) die('找不到 Chrome/Edge —— 用 --chrome=<路径> 或设 CHROME_PATH 环境变量'
  + '（本工具刻意**不执行**探测命令，理由见文件头注）');

if (await portListening(PORT)) {
  die(`端口 ${PORT} 已被占用（可能是你自己的 dev server）—— 换一个端口跑：--port <另一个>。`
    + '本工具**不会**去占用或干扰已有的服务。');
}

const profile = mkdtempSync(join(tmpdir(), 'btc-chrome-'));
const shotsDir = join(REPO, '.superpowers', 'browser-truth');
if (SHOTS) mkdirSync(shotsDir, { recursive: true });
const viteLog = join(profile, 'vite.log');
const viteFd = openSync(viteLog, 'w');

say(`运行期浏览器真值自查 · 端口 ${PORT} · 窗口 ${WIN.w}×${WIN.h} · 缺省容差 ${TOL}px`);
say(`  chrome  = ${chrome}`);
say(`  探针页  = tools/browser-truth-probe.html`);
say(`  临时 profile = ${profile}`);
say('');

let vite = null;
let exitCode = 0;
const allResults = [];

try {
  // ── 起临时 vite（stdio 走文件描述符，见文件头注） ──
  vite = spawn(process.execPath, [VITE, '--port', String(PORT), '--strictPort', '--host', '127.0.0.1', '--logLevel', 'warn'],
    { cwd: REPO, stdio: ['ignore', viteFd, viteFd], env: { ...process.env, NO_COLOR: '1' } });
  let up = false;
  for (let i = 0; i < 60; i += 1) {                  // 最多等 ~15s
    await sleep(250);
    if (await portListening(PORT)) { up = true; break; }
    if (vite.exitCode !== null) break;
  }
  if (!up) {
    const log = readFileSync(viteLog, 'utf8').slice(-2000);
    die(`临时 vite 没起来（端口 ${PORT} 未监听）。vite 日志尾部：\n${log}`);
  }
  say(`✓ 临时 vite 已就绪（http://127.0.0.1:${PORT}/）`);

  // ── 逐场景跑 Chrome ──
  for (const sc of SCENARIOS) {
    const url = `http://127.0.0.1:${PORT}/tools/browser-truth-probe.html?${sc.query}`;
    const domFile = join(profile, `${sc.key}.dom.html`);
    const fd = openSync(domFile, 'w');
    const t0 = Date.now();
    const r = spawnSync(chrome, [
      '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
      '--disable-extensions', '--disable-background-networking', '--hide-scrollbars',
      `--user-data-dir=${profile}`,
      '--virtual-time-budget=12000',
      `--window-size=${WIN.w},${WIN.h}`,
      '--dump-dom', url,
    ], { stdio: ['ignore', fd, 'ignore'], timeout: 120000 });
    closeSync(fd);
    const dom = readFileSync(domFile, 'utf8');
    const probe = extractProbe(dom);
    const ms = Date.now() - t0;
    if (!probe || probe.empty || probe.parseError) {
      say(`✗ ${sc.label}：探针没有产出结果（${probe?.parseError ?? (probe?.empty ? '空 JSON' : 'DOM 里没有 __probe')}）`
        + ` [${ms}ms, chrome exit=${r.status}]`);
      exitCode = Math.max(exitCode, 1);
      continue;
    }
    allResults.push({ scenario: sc.key, label: sc.label, probe, ms });
    say(`✓ ${sc.label}：探针产出 ${probe.items.length} 项（${ms}ms）`
      + (probe.warnings?.length ? ` · ${probe.warnings.length} 条警告` : ''));

    if (SHOTS) {
      const shot = join(shotsDir, `${sc.key}.png`);
      spawnSync(chrome, [
        '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
        '--hide-scrollbars',
        `--user-data-dir=${profile}`, '--virtual-time-budget=12000',
        `--window-size=${WIN.w},${WIN.h}`, `--screenshot=${shot}`, url,
      ], { stdio: ['ignore', 'ignore', 'ignore'] });
      say(`  截图 → ${shot.replace(REPO + '\\', '').replace(REPO + '/', '')}`);
    }
  }

  // ── 比较与打印 ──
  let pass = 0, fail = 0, known = 0, judged = 0;
  const knownHits = [];
  for (const { label, probe } of allResults) {
    const items = (probe.items ?? []).filter((it) => (ONLY ? String(it.id).startsWith(ONLY) : true));
    say('');
    say(`── ${label} ──  视口 ${probe.viewport?.w}×${probe.viewport?.h}`
      + (probe.notes?.length ? `\n   ${probe.notes.join('\n   ')}` : ''));
    if (items.length === 0) { say('   （本次筛选下没有条目）'); continue; }
    say(`   ${'id'.padEnd(26)} ${'期望'.padStart(14)} ${'实测'.padStart(14)}  ${'Δ'.padStart(9)}  判定`);
    for (const it of items) {
      const j = judge(it, TOL);
      judged += 1;
      const isKnown = !j.pass && KNOWN_ISSUES.has(String(it.id));
      if (j.pass) pass += 1;
      else if (isKnown) { known += 1; knownHits.push({ it, note: KNOWN_ISSUES.get(String(it.id)) }); }
      else fail += 1;
      const d = j.delta !== undefined ? j.delta.toFixed(3) : (typeof it.expected === 'number' ? '—' : '');
      const verdict = j.pass ? '✓' : (isKnown ? '✗（在案）' : '✗ ' + j.why);
      say(`   ${String(it.id).padEnd(26)} ${fmt(it.expected).padStart(14)} ${fmt(it.measured).padStart(14)}`
        + `  ${String(d).padStart(9)}  ${verdict}`);
      if (!j.pass) say(`      ↳ ${it.what}\n         期望来源：${it.src}`);
    }
    for (const w of probe.warnings ?? []) say(`   ⚠ ${w}`);
  }

  const warns = allResults.flatMap((r) => r.probe.warnings ?? []);
  // ⚠️ **"什么都没查" ≠ "通过"**：`--only` 写错前缀时被判条目数为 0，若只看 fail 就会静默绿。
  //    这里用**实际判过的条目数**（judged）而不是探针产出的总数。
  if (judged === 0) {
    say(`\n✗ 本次**一个条目都没判定**（${ONLY === null ? '探针没产出任何条目' : `--only ${JSON.stringify(ONLY)} 没匹配到任何条目`}）`
      + ' —— "什么都没查"不等于"通过"，按失败处理');
    exitCode = Math.max(exitCode, 2);
  }
  if (allResults.length !== SCENARIOS.length) {
    say(`\n✗ 只跑成 ${allResults.length}/${SCENARIOS.length} 个场景 —— 缺场景时"全绿"没有意义`);
    exitCode = Math.max(exitCode, 1);
  }
  say('');
  say('════ 汇总 ════');
  say(`  条目：判定 ${judged} 项 —— 通过 ${pass} / 失败 ${fail} / 在案失败 ${known}`);
  if (knownHits.length > 0) {
    say('  ── 在案差异（**基线里就有**，非本轮引入；仍然让退出码非零）──');
    for (const { it, note } of knownHits) say(`    · ${it.id}（实测 ${fmt(it.measured)} vs 期望 ${fmt(it.expected)}）：${note}`);
  }
  say(`  警告：${warns.length} 条（探针缺项 / 单源取值失败 / 图片未加载 —— 这些**也算失败**，见退出码）`);
  if (fail > 0 || warns.length > 0 || known > 0) exitCode = Math.max(exitCode, 1);
  say(exitCode === 0 ? '  ✓ 全部在容差内'
    : `  ✗ 存在差异或警告（新差异 ${fail} 项 / 在案 ${known} 项 / 警告 ${warns.length} 条）`);

  if (JSON_OUT) {
    const out = { port: PORT, win: WIN, tol: TOL, at: new Date().toISOString(), results: allResults };
    writeFileSync(JSON_OUT, JSON.stringify(out, null, 1), 'utf8');
    say(`  原始结果 → ${JSON_OUT}`);
  }
} finally {
  // ── 收工：杀整棵树 + 自证 ──
  const evidence = [];
  if (!KEEP) {
    killTree(vite?.pid);
    await sleep(500);
    const still = await portListening(PORT);
    evidence.push(`端口 ${PORT} ${still ? '**仍在监听**（✗）' : '未监听（✓）'}`);
    if (still) exitCode = Math.max(exitCode, 2);
    const procs = processesMentioning(profile);
    if (procs === null) evidence.push('chrome 进程自证：无法查询（跳过，不算通过）');
    else if (procs.length === 0) evidence.push('无残留 chrome 进程（✓，按临时 profile 标记查命令行）');
    else { evidence.push(`**仍有 ${procs.length} 个 chrome 进程**：${procs.join(', ')}（✗）`); exitCode = Math.max(exitCode, 2); }
  } else {
    evidence.push('--keep：按你的要求**没有**杀进程（vite pid=' + String(vite?.pid) + '，profile=' + profile + '）');
  }
  say('');
  say('════ 收工自证 ════');
  for (const e of evidence) say(`  · ${e}`);
  if (!KEEP) { try { rmSync(profile, { recursive: true, force: true }); } catch { /* 目录可能被占用 */ } }
}

process.exit(exitCode);
