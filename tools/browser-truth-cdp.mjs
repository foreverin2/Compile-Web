#!/usr/bin/env node
/* ============================================================================
 * 运行期浏览器真值 · **传输层**（CDP 驱动；G5 T9 的基础设施）
 *
 * ## 为什么需要第二个浏览器夹具
 *
 * `tools/browser-truth-check.mjs`（第五道门）每个场景都是
 * `--headless=new --virtual-time-budget=12000 --dump-dom <url>`：一次一个页面、
 * 一个临时 profile、把 DOM 倒出来。它**没有 CDP**，也**从不派发事件**，而且实测
 * 给的真实时间窗口只有约 5 秒（预算从 12000 加到 60000 也一样），而 headless 里
 * 单次 WebRTC 握手光首次 `createOffer` 就要约 4.6 秒 ⇒ **它只能看见"部分握手"**。
 * 实测原始数据见 `.superpowers/g5-recon/FINDINGS.md` 第 1、2 节。
 *
 * 本工具改用 CDP（`--remote-debugging-port` + Node 自带的全局 `WebSocket`/`fetch`，
 * **零依赖**，不装 puppeteer）：起**两个独立 Chrome 进程**（各自 `--user-data-dir`、
 * 各自调试端口），由本进程当**信令中继**交换一次非 trickle 的 SDP，然后放开跑真实
 * 的 ICE + DTLS + SCTP 数据通道。这是在没有第二台物理机时能拿到的最接近"两台机器"
 * 的机器真值。
 *
 * ## 它证明什么 / 不能证明什么
 *
 *  **能**：两个对端在真浏览器里真的建立了数据通道并双向通了消息；ICE 真的选了候选；
 * 连接状态真的走到 `connected`；以及"故意不转发 answer ⇒ 一定连不上"这条**反向证明**
 * （没有它，夹具可能只是空转）。
 *  **不能**：跨网络 NAT 打洞、跨机 mDNS 解析、丢包与切网、移动端后台冻结 —— 这些
 * 本机根本验不了，属设计稿 §5.10 的**用户验收**项。
 *
 * ## ⚠️ 绝不要用 `chrome --version` 探测浏览器
 * 这台机器上它会起一个用用户默认 profile 的真 Chrome（会弹窗、会抢 profile 锁）。
 * 本工具只 `existsSync()` 判断可执行文件在不在，**从不执行探测命令**。
 *
 * ## ⚠️ 子进程输出用文件描述符，不用管道
 * 宿主沙箱在某些模式下禁止程序用管道捕获子进程输出（Node `child_process` 的默认
 * `stdio: 'pipe'` 会 EPERM）。本工具一律 `stdio: 'ignore'`。
 *
 * 用法：
 *   node tools/browser-truth-cdp.mjs                   # 正常一轮
 *   node tools/browser-truth-cdp.mjs --self-check       # 自证：正常轮必须过、抽掉 answer 必须红
 *   node tools/browser-truth-cdp.mjs --wait 45          # 每个对端的等待预算（秒，缺省 45）
 *   node tools/browser-truth-cdp.mjs --probe <路径>      # 换探针页（缺省 tools/browser-truth-net-probe.html）
 *   node tools/browser-truth-cdp.mjs --no-mdns          # 关 mDNS 混淆（**改变了被测世界**，只在诊断时用）
 *   node tools/browser-truth-cdp.mjs --keep             # 不杀进程（调试；此时不做收工自证）
 *   node tools/browser-truth-cdp.mjs --json <路径>       # 原始结果落盘（供报告引用）
 *
 * 退出码：0 = 全部判定通过；1 = 有判定不通过；2 = 环境错误（端口被占、找不到 Chrome、CDP 连不上）。
 * ========================================================================== */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { connect } from 'node:net';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');
const DEFAULT_PROBE = join(HERE, 'browser-truth-net-probe.html');

/* 端口取一对不常用的高位端口。**开工前必须确认没被占**：占着就退 2，绝不去杀别人的进程
 * （用户自己的 dev server 常年在 5173，本工具绝不碰它）。 */
const PORT_HOST = 9341;
const PORT_GUEST = 9342;

const argv = process.argv.slice(2);
const argVal = (name, dflt = null) => {
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : dflt;
};
const WAIT_S = Number(argVal('--wait', 45));
const PROBE = resolve(argVal('--probe', DEFAULT_PROBE));
const NO_MDNS = argv.includes('--no-mdns');
const KEEP = argv.includes('--keep');
const SELF_CHECK = argv.includes('--self-check');
const JSON_OUT = argVal('--json', null);

const say = (m) => process.stdout.write(`${m}\n`);
const die = (m) => { say(`\n[X] 环境错误：${m}`); process.exit(2); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 端口是否有人监听（连得上 = 有人）。 */
function portListening(port) {
  return new Promise((res) => {
    const sock = connect({ port, host: '127.0.0.1' });
    const done = (v) => { sock.destroy(); res(v); };
    sock.once('connect', () => done(true));
    sock.once('error', () => done(false));
    setTimeout(() => done(false), 1200);
  });
}

/** 找浏览器可执行文件。只查存在性，绝不执行探测命令。 */
function findChrome() {
  const cands = [];
  if (process.env.CHROME_PATH) cands.push(process.env.CHROME_PATH);
  const pf = process.env['ProgramFiles'] ?? 'C:\\Program Files';
  const pf86 = process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)';
  const local = process.env['LOCALAPPDATA'] ?? '';
  for (const root of [pf, pf86]) {
    cands.push(join(root, 'Google', 'Chrome', 'Application', 'chrome.exe'));
    cands.push(join(root, 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
  }
  if (local) {
    cands.push(join(local, 'Google', 'Chrome', 'Application', 'chrome.exe'));
    cands.push(join(local, 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
  }
  cands.push(
    '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium',
    '/usr/bin/chromium-browser', '/snap/bin/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  );
  for (const c of cands) if (c && existsSync(c)) return c;
  return null;
}

function killTree(pid) {
  if (!pid) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    try { process.kill(-pid, 'SIGKILL'); } catch { try { process.kill(pid, 'SIGKILL'); } catch { /* 已退出 */ } }
  }
}

/* ── CDP 客户端：连到某个 page target，用 Runtime.evaluate 读状态 / 注入 SDP ── */
async function attach(label, port, role, profile) {
  let wsUrl = null;
  const t0 = Date.now();
  while (Date.now() - t0 < 25000) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const page = list.find((t) => t.type === 'page' && String(t.url).startsWith('file:'));
      if (page && page.webSocketDebuggerUrl) { wsUrl = page.webSocketDebuggerUrl; break; }
    } catch { /* 端口还没起来 */ }
    await sleep(200);
  }
  if (!wsUrl) throw new Error(`${label}: 拿不到 page target 的 webSocketDebuggerUrl`);

  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true });
    ws.addEventListener('error', () => rej(new Error(`${label}: CDP WebSocket 连接失败`)), { once: true });
  });
  let nextId = 1;
  const pending = new Map();
  ws.addEventListener('message', (ev) => {
    let m; try { m = JSON.parse(String(ev.data)); } catch { return; }
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  });
  const send = (method, params) => {
    const id = nextId++;
    const p = new Promise((res) => pending.set(id, res));
    ws.send(JSON.stringify({ id, method, params: params ?? {} }));
    return p;
  };
  const state = async () => {
    const r = await send('Runtime.evaluate', {
      expression: "document.getElementById('__probe').textContent",
      returnByValue: true,
    });
    const s = r?.result?.result?.value;
    if (typeof s !== 'string' || !s.trim()) return null;
    try { return JSON.parse(s); } catch { return null; }
  };
  const inject = async (sdp, type) => {
    const expr = `window.__inject(${JSON.stringify(sdp)}, ${JSON.stringify(type)})`;
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
    if (r?.result?.exceptionDetails) {
      throw new Error(`${label}: 注入 ${type} 时页面抛异常 ${JSON.stringify(r.result.exceptionDetails)}`);
    }
  };
  return { label, role, profile, state, inject, close: () => ws.close() };
}

/** 轮询直到 pred(state) 为真（或超时）。返回最后一次状态。超时不抛，由调用方判定。 */
async function until(peer, pred, budgetMs) {
  const t0 = Date.now();
  let last = null;
  while (Date.now() - t0 < budgetMs) {
    last = await peer.state();
    if (last && last.error) return { state: last, hit: false, errored: true };
    if (last && pred(last)) return { state: last, hit: true, errored: false };
    await sleep(200);
  }
  return { state: last, hit: false, errored: false };
}

/** 起一对进程、连上 CDP、当信令中继跑一轮。relayAnswer=false 是**故意抽掉答案**的反向证明。 */
async function runScenario({ relayAnswer, chrome, budgetMs, tag }) {
  const profHost = mkdtempSync(join(tmpdir(), 'btc-net-host-'));
  const profGuest = mkdtempSync(join(tmpdir(), 'btc-net-guest-'));
  const probeUrl = pathToFileURL(PROBE).href;
  const mk = (profile, port, role) => {
    const flags = [
      '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
      `--user-data-dir=${profile}`, `--remote-debugging-port=${port}`, '--remote-allow-origins=*',
    ];
    if (NO_MDNS) flags.push('--disable-features=WebRtcHideLocalIpsWithMdns');
    flags.push(`${probeUrl}?role=${role}`);
    return spawn(chrome, flags, { stdio: 'ignore' });
  };
  const procHost = mk(profHost, PORT_HOST, 'host');
  const procGuest = mk(profGuest, PORT_GUEST, 'guest');

  let host = null;
  let guest = null;
  const result = { tag, relayAnswer, judged: [], host: null, guest: null, done: false, note: null };
  try {
    host = await attach('host', PORT_HOST, 'host', profHost);
    guest = await attach('guest', PORT_GUEST, 'guest', profGuest);

    const hOffer = await until(host, (s) => s.phase === 'offer-ready', budgetMs);
    if (!hOffer.hit) { result.note = `host 没到 offer-ready（phase=${hOffer.state?.phase}）`; return result; }
    await guest.inject(hOffer.state.localSdp, 'offer');

    const gAnswer = await until(guest, (s) => s.phase === 'answer-ready', budgetMs);
    if (!gAnswer.hit) { result.note = `guest 没到 answer-ready（phase=${gAnswer.state?.phase}）`; return result; }

    if (relayAnswer) await host.inject(gAnswer.state.localSdp, 'answer');

    const hDone = await until(host, (s) => s.done === true, budgetMs);
    result.done = hDone.hit;
    result.host = hDone.state;
    result.guest = await guest.state();
  } catch (e) {
    result.note = String(e);
  } finally {
    if (host) host.close();
    if (guest) guest.close();
    if (!KEEP) {
      killTree(procHost.pid);
      killTree(procGuest.pid);
      try { rmSync(profHost, { recursive: true, force: true }); } catch { /* 偶尔被占 */ }
      try { rmSync(profGuest, { recursive: true, force: true }); } catch { /* 偶尔被占 */ }
    }
  }
  return result;
}

/** 判定一个正常轮：每条给 [通过]/[不通过]，返回通过数与总数。 */
function judgeNormal(r) {
  const j = [];
  const push = (ok, what) => j.push({ ok, what });
  const h = r.host ?? {};
  const g = r.guest ?? {};
  const logHas = (s, k, v) => Array.isArray(s?.log) && s.log.some((e) => e.k === k && (v === undefined || e.v === v));
  push(r.done === true, '宿主收到 pong（数据通道双向通了）');
  push(g.gotPing === true, '客端收到 ping');
  push(g.gotPong === true, '客端回过 pong');
  push(logHas(h, 'conn', 'connected'), '宿主连接状态走到 connected');
  push(Array.isArray(g.log) && g.log.some((e) => e.k === 'conn' && e.v === 'connected') || logHas(g, 'conn', 'connected'), '客端连接状态走到 connected');
  push(Array.isArray(h.log) && h.log.some((e) => e.k === 'cand' && String(e.v).includes('typ host')), '宿主至少产出一条 host 候选（真的走了 ICE）');
  push(typeof h.localSdp === 'string' && h.localSdp.length > 0, '宿主本地 SDP 非空');
  push(typeof g.localSdp === 'string' && g.localSdp.length > 0, '客端本地 SDP 非空');
  return j;
}

/* ── 主流程 ─────────────────────────────────────────────────────────────── */
const chrome = findChrome();
if (!chrome) die('找不到 Chrome/Edge（可用 CHROME_PATH 指定）');
if (!existsSync(PROBE)) die(`探针页不存在：${PROBE}`);
for (const p of [PORT_HOST, PORT_GUEST]) {
  if (await portListening(p)) die(`端口 ${p} 已被占用。本工具不去杀别人的进程，请先腾出它（或改端口常量）。`);
}

const budgetMs = WAIT_S * 1000;
say(`chrome = ${chrome}`);
say(`probe  = ${PROBE}`);
say(`ports  = ${PORT_HOST} / ${PORT_GUEST}   mdns = ${NO_MDNS ? '关闭（诊断用，改变了被测世界）' : '出厂'}`);
say(`budget = ${WAIT_S}s / 对端`);
say('');

const runs = [];
say('=== 第 1 轮：正常信令中继 ===');
const normal = await runScenario({ relayAnswer: true, chrome, budgetMs, tag: 'normal' });
normal.judged = judgeNormal(normal);
for (const j of normal.judged) say(`  [${j.ok ? '通过' : '不通过'}] ${j.what}`);
if (normal.note) say(`  注：${normal.note}`);
const nPass = normal.judged.filter((x) => x.ok).length;
say(`  ⇒ ${nPass}/${normal.judged.length} 条通过`);
runs.push({ id: 'normal', relayAnswer: true, pass: nPass, total: normal.judged.length, judged: normal.judged, note: normal.note });
if (normal.host) {
  say(`  宿主状态机：${(normal.host.log ?? []).map((e) => `${e.ms}ms ${e.k}`).join(' -> ')}`);
}
say('');

let verdict = nPass === normal.judged.length && normal.judged.length > 0;

if (SELF_CHECK) {
  /* 反向证明：抽掉 answer，宿主**必须**连不上。若它照样"通过"，说明这套夹具是空转的。 */
  const shortBudget = Math.min(15000, budgetMs);
  say(`=== 第 2 轮（自证）：故意不转发 answer，宿主必须连不上（预算 ${shortBudget / 1000}s）===`);
  const withheld = await runScenario({ relayAnswer: false, chrome, budgetMs: shortBudget, tag: 'withheld' });
  const stillConnected = withheld.done === true;
  say(`  宿主 done = ${withheld.done}${withheld.note ? `   注：${withheld.note}` : ''}`);
  say(`  [${stillConnected ? '不通过' : '通过'}] 抽掉 answer 后宿主没有连上（夹具不是空转）`);
  runs.push({ id: 'withheld', relayAnswer: false, pass: stillConnected ? 0 : 1, total: 1, judged: [{ ok: !stillConnected, what: '抽掉 answer 后宿主没有连上' }], note: withheld.note });
  if (stillConnected) verdict = false;
  say('');
}

/* ── 收工自证 ───────────────────────────────────────────────────────────── */
if (!KEEP) {
  say('=== 收工自证 ===');
  let clean = true;
  for (const [name, p] of [['host', PORT_HOST], ['guest', PORT_GUEST]]) {
    const listening = await portListening(p);
    say(`  [${listening ? '不通过' : '通过'}] ${name} 调试端口 ${p} 未在监听`);
    if (listening) clean = false;
  }
  const tmpLeft = [];
  for (const prefix of ['btc-net-host-', 'btc-net-guest-']) {
    try {
      for (const n of readdirSync(tmpdir())) if (n.startsWith(prefix)) tmpLeft.push(n);
    } catch { /* 读不了就不断言 */ }
  }
  say(`  [${tmpLeft.length === 0 ? '通过' : '不通过'}] 临时 profile 已清（残留 ${tmpLeft.length} 个）`);
  if (tmpLeft.length > 0) clean = false;
  say('');
  if (!clean) verdict = false;
}

const payload = {
  when: new Date().toISOString(),
  chrome, probe: PROBE, mdns: !NO_MDNS, waitS: WAIT_S, selfCheck: SELF_CHECK,
  runs, verdict,
};
if (JSON_OUT) {
  writeFileSync(JSON_OUT, JSON.stringify(payload, null, 2), 'utf8');
  say(`原始结果已写入 ${JSON_OUT}`);
}

say(verdict ? '\n全部判定通过。' : '\n有判定不通过。');
process.exit(verdict ? 0 : 1);
