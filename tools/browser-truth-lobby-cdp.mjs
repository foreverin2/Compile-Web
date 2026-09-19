#!/usr/bin/env node
/* ============================================================================
 * 运行期浏览器真值 · **邀请码那条路（联机大厅 UI）**（G5 T9）
 *
 * ## 它为什么必须存在（node 面证明不了什么）
 *
 * `node tools/browser-truth-cdp.mjs` 用的是 `tools/browser-truth-net-probe.html`：
 * 一个自己造的探针页 + `window.__inject()` 注入 SDP。它证明的是**传输层**（ICE / DTLS /
 * 数据通道），**不经过 `src/main.ts` 的任何一行接线**。
 * 而 `src/main.ts` 一 import 就把整个游戏跑起来（要 `document` / `window` / 真 WebRTC），
 * node 里没有 jsdom ⇒ 它的 env 注入与 ICE 链路在 node 面**不可观测**。
 * ⇒ 邀请码那条路的三个断点（I-1 `hostPeerConnection` 恒 null / I-2 传输 env 缺 ticker /
 *   I-3 两端 sessionId 不同让 `hello-ack` 被自己拒）只能在**真浏览器里点界面**来证伪。
 *
 * ## 这一条证明什么
 *
 *  ① 房主点「生成邀请码」⇒ 屏上真的出现一串码（形状 `<协议版本>.<base64url>`，非空）；
 *  ② 加入方贴码 ⇒「出示回示码」产出回示码；房主把回示码贴回来 ⇒ 结论是**成功**那一支
 *     （不是"本机还没有建起对端连接"，那正是 I-1 的症状）；
 *  ③ 握手真的推进 ⇒ 两端相位走到"等待承诺"（房主 `awaiting-commit-face` /
 *     加入方 `awaiting-commit`），不是各自停在 `handshaking`（I-3 的症状）；
 *  ③.5 **硬币屏插在握手中间**（G5 T11-B / D27）：两端屏上都出现硬币屏、标题说清"由加入方选面"、
 *     可见文案不含禁用词；加入方**点芯片之前**屏上没有落点读数（种子还没公开）、
 *     两枚芯片可点；点了之后落点出现、两端读数逐字相同、握手继续走到 `complete`；
 *  ④ 负控：把那条邀请码的**压缩段截断**再贴 ⇒ 屏上必须给**可读**的失败，且**不假装成功**
 *     （不产回示码、相位不前进）。
 *
 * ## 它怎么起环境（端口怎么选）
 *
 *  - **临时 vite dev server**：`node_modules/vite/bin/vite.js --port <P> --strictPort --host 127.0.0.1`。
 *    `<P>` 不是写死的常量，而是**让内核给**：`createServer().listen(0)` 读回分配到的端口再关掉，
 *    然后立刻用 `--strictPort` 起 vite（被抢就**响亮地失败**，不会静默换端口）。
 *    同时断言它不在 `5199 / 9341 / 9342 / 5173` 里（那四个是别人占的：5173 是用户自己的 dev server，
 *    9341/9342 是 `browser-truth-cdp.mjs` 的两个调试端口，5199 是本仓历来用过的）。
 *    端口 0 分配出来的口落在临时端口区间（Windows 默认 49152 起），结构上不可能撞上那四个。
 *  - **两个真 Chrome 进程**：各自 `--user-data-dir`（临时 profile）、`--headless=new`、
 *    `--remote-debugging-port=0`（同样让内核给，事后从 `<profile>/DevToolsActivePort` 读回来）。
 *  - **驱动的是真界面**：CDP `Input.dispatchMouseEvent`（真鼠标按下/抬起）+ `Input.insertText`
 *    （真文本输入事件）。不注入假传输、不注入假 peer、不碰任何模块内部。
 *
 * ## 子进程输出用 `stdio: 'ignore'`（不是管道）
 * 宿主沙箱的某些模式禁止用管道捕获子进程输出（Node `child_process` 默认 `stdio: 'pipe'` 会 EPERM）。
 *
 * ## 绝不用 `chrome --version` 探测浏览器
 * 这台机器上它会起一个用用户默认 profile 的真 Chrome（弹窗 + 抢 profile 锁）。
 * 本工具只 `existsSync()` 判断可执行文件在不在。
 *
 * ## 本次实测（2026-09-18，本机 Chrome 143.0.7499.194 / `--headless=new`）
 *
 * 两次 `node tools/browser-truth-lobby-cdp.mjs --diagnose`：两次都是 **0/4**，收工自证 4/4 干净，
 * 退出码 1（vite 端口 57610 / 62765 都是内核给的；Chrome 调试端口 57614+52384、53677+61334）。
 * 同一时刻的对照 `node tools/browser-truth-cdp.mjs` 是 **8/8 通过** ⇒ 下面这件事**不是环境问题**。
 *
 * **这条检查今天红在第一步**：大厅的「建房（生成邀请码）」点下去**什么都不会发生**
 * ⇒ 屏上永远没有「生成邀请码」这个按钮 ⇒ ①②③④四条**全部未到达**。
 * 现场证据（`--diagnose` 每次都会重放，两次一致）：
 *  - 点「建房」后 `#app` 的 innerHTML 长度 533 -> 533（一秒到三秒一个字节都没变），页面异常 0；
 *  - 同屏点「高级 / 连接设置」**能展开** ⇒ 大厅客户端**建起来了**，只是 `s.role` 仍是 `null`，
 *    `role === 'host'` 那一支（含「生成邀请码」）不渲染；
 *  - 同屏点「加入」（地址栏先放一条坏载荷）**能推进**：出现加入方那一栏，并给出一句可读失败
 *    「邀请码的压缩段解不开（内容被改动或截断过）。…」⇒ 点击链路本身是通的。
 * 根因与逐行定位见 `.superpowers/g5-T9/FINDINGS.md`（`src/**` 一个字未改）。
 *
 * ## 变异镜像实测（候选修法就是一行；`--repo` 指到镜像上跑）
 *
 * 镜像：`.superpowers/g5-T9/mirror`（`src/` 的副本 + `public` 目录联接），里面只改了
 * `src/ui/net-lobby.ts:1099` 的初值：`role: null` → `role: opts.role`（外加一次诊断用的
 * 重驱动定时器，第三次运行才加）。三次运行：
 *
 *  - **① 通过**：邀请码 740 / 740 / 738 个字符（都在 T7 钉的实测区间内）；
 *  - **② 通过两次**（回示码 654 / 658 个字符），**一次没通过**：屏上给的是可读句
 *    「等了 5 秒，ICE 候选还没有收集完…」—— `DEFAULT_ICE_GATHER_TIMEOUT_MS = 5_000`
 *    在这台机器上很紧（`browser-truth-cdp.mjs` 实测本机 host 侧收集要约 4.8–5.2 秒）；
 *  - **③ 一半**：房主贴回示码**成功**（"已经把对方的答案接上了。" ⇒ `hostPeerConnection`
 *    **不是** null，I-1 已修）；但**两端相位都停在 `handshaking`**，握手**没有**推进
 *    （I-3 那条路今天不通）。加了一次"每 500ms 重驱动一遍"的诊断变异也**没有**改善 ——
 *    与 `session.ts` 的 `redriveOutput()` 在 `'handshaking'` 相位返回 `null` 一致：
 *    加入方那条 `hello` 只在 `connect('first')` 时发一次，而那时数据通道还没 open
 *    （传输层 `sendIfOpen` 缺队列、失败即丢；`sendHello()` 又会置 `helloDone` 不再重发），
 *    之后没有任何触发点会把它补上。
 *  - **④ 通过**（改**压缩段第一个字符** ⇒ 可读失败 + 没有假装成功）。
 *    ⚠️ 实测登记：改**中段**那一位（第 444 个字符）**没有被拒**，屏上连错误行都没有 ——
 *    `deflate-raw` 没有校验和，那一位落在字面量字节上时载荷照样解得开。
 *    ⇒ 负控的判据只能钉在"把 deflate 流真打断"的那一位上，不能假定任意一位都会失败。
 *
 * 用法：
 *   node tools/browser-truth-lobby-cdp.mjs                 # 正常一轮
 *   node tools/browser-truth-lobby-cdp.mjs --diagnose      # 追加三条定位阻塞的诊断读数
 *   node tools/browser-truth-lobby-cdp.mjs --wait 45       # 单步等待预算（秒，缺省 45）
 *   node tools/browser-truth-lobby-cdp.mjs --keep          # 不杀进程、不清 profile（调试；此时不做收工自证）
 *   node tools/browser-truth-lobby-cdp.mjs --repo <路径>    # 打到一棵变异镜像上（见下面"变异镜像实测"）
 *   node tools/browser-truth-lobby-cdp.mjs --json <路径>    # 原始结果落盘
 *
 * 退出码：0 = 全部判定通过；1 = 有判定不通过；2 = 环境错误（找不到 Chrome / vite 起不来 / CDP 连不上）。
 * ========================================================================== */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, connect } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');
const VITE_BIN = join(REPO, 'node_modules', 'vite', 'bin', 'vite.js');

/** 任务书点名不许用的四个端口（5173 用户自己的 dev server、9341/9342 既有 CDP 夹具的调试端口、5199 同列） */
const FORBIDDEN_PORTS = [5199, 9341, 9342, 5173];
const PROFILE_PREFIX = 'btl-lobby-';

const argv = process.argv.slice(2);
const argVal = (name, dflt = null) => {
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : dflt;
};
const WAIT_S = Number(argVal('--wait', 45));
/**
 * 被服务的**根目录**（缺省 = 本仓库）。给 `--repo <路径>` 就能把同一套检查打到一棵
 * **变异镜像**上（照本仓既有纪律：变异不许原地改共享树，镜像放 `.superpowers/<任务>/`）。
 * vite 可执行文件仍然从**本仓库**的 `node_modules` 取，只是 `cwd` 换成镜像根。
 */
const ROOT = resolve(argVal('--repo', REPO));
const KEEP = argv.includes('--keep');
const DIAGNOSE = argv.includes('--diagnose');
const JSON_OUT = argVal('--json', null);

const say = (m) => process.stdout.write(`${m}\n`);
const die = (m) => { say(`\n[X] 环境错误：${m}`); process.exit(2); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const budgetMs = WAIT_S * 1000;

/* ── 端口与进程 ─────────────────────────────────────────────────────────── */

/** 让内核给一个空闲端口：listen(0) 读回分配到的端口，再关掉。 */
function pickFreePort() {
  return new Promise((res, rej) => {
    const srv = createServer();
    srv.once('error', rej);
    srv.listen(0, '127.0.0.1', () => {
      const p = srv.address().port;
      srv.close(() => res(p));
    });
  });
}

/** 端口是否有人监听（连得上 = 有人）。收工自证与"起 vite 前先确认没人占"都用它。 */
function portListening(port) {
  return new Promise((res) => {
    const sock = connect({ port, host: '127.0.0.1' });
    const done = (v) => { sock.destroy(); res(v); };
    sock.once('connect', () => done(true));
    sock.once('error', () => done(false));
    setTimeout(() => done(false), 1200);
  });
}

/** 找浏览器可执行文件。只查存在性，绝不执行探测命令（见文件头）。 */
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

/* ── CDP 客户端 ─────────────────────────────────────────────────────────── */

async function attach(label, port, urlPrefix) {
  let wsUrl = null;
  const t0 = Date.now();
  while (Date.now() - t0 < 25000) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const page = list.find((t) => t.type === 'page' && String(t.url).startsWith(urlPrefix));
      if (page && page.webSocketDebuggerUrl) { wsUrl = page.webSocketDebuggerUrl; break; }
    } catch { /* CDP 端口还没起来 */ }
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
  const events = [];
  ws.addEventListener('message', (ev) => {
    let m; try { m = JSON.parse(String(ev.data)); } catch { return; }
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
    if (m.method) events.push(m);
  });
  const send = (method, params) => {
    const id = nextId++;
    const p = new Promise((res) => pending.set(id, res));
    ws.send(JSON.stringify({ id, method, params: params ?? {} }));
    return p;
  };
  /** 页面里求值（`returnByValue`）。页面抛异常时**响亮地**抛出，不返回 undefined。 */
  const evaluate = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r?.result?.exceptionDetails) {
      throw new Error(`${label}: 页面异常 ${JSON.stringify(r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails)}`);
    }
    return r?.result?.result?.value;
  };
  const text = async (selector) => {
    const v = await evaluate(`(document.querySelector(${JSON.stringify(selector)})?.textContent) ?? null`);
    return typeof v === 'string' ? v : null;
  };
  const count = (selector) => evaluate(`document.querySelectorAll(${JSON.stringify(selector)}).length`);
  const waitFor = async (selector, ms) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      if ((await count(selector)) > 0) return true;
      await sleep(200);
    }
    return false;
  };
  /** 真鼠标点击：滚进视口取矩形中心 → Input 按下/抬起（不是 `el.click()`） */
  const click = async (selector) => {
    const box = await evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return null;
      el.scrollIntoView({ block: 'center', inline: 'center' });
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return 'zero-size';
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()`);
    if (box === null) throw new Error(`${label}: 找不到可点击元素 ${selector}`);
    if (box === 'zero-size') throw new Error(`${label}: 元素 ${selector} 尺寸为 0`);
    const p = { x: Math.round(box.x), y: Math.round(box.y), button: 'left', clickCount: 1 };
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y });
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...p });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...p });
  };
  /** 真文本输入：聚焦后 Input.insertText（浏览器会派发真的 `input` 事件） */
  const type = async (selector, value) => {
    const focused = await evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return false;
      el.scrollIntoView({ block: 'center' });
      el.focus();
      return document.activeElement === el;
    })()`);
    if (!focused) throw new Error(`${label}: 聚焦失败 ${selector}`);
    await send('Input.insertText', { text: value });
  };
  return { label, send, evaluate, text, count, waitFor, click, type, events, close: () => ws.close() };
}

/* ── 起环境：临时 vite + 两个真 Chrome ─────────────────────────────────── */

async function httpOk(url, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { if ((await fetch(url)).ok) return true; } catch { /* 还没起来 */ }
    await sleep(200);
  }
  return false;
}

async function launchChrome(chrome, url) {
  const profile = mkdtempSync(join(tmpdir(), PROFILE_PREFIX));
  const flags = [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--remote-allow-origins=*',
    '--window-size=1280,900', url,
  ];
  const proc = spawn(chrome, flags, { stdio: 'ignore' });
  const portFile = join(profile, 'DevToolsActivePort');
  const t0 = Date.now();
  let port = null;
  while (Date.now() - t0 < 25000) {
    if (existsSync(portFile)) {
      try {
        const line = readFileSync(portFile, 'utf8').split('\n')[0].trim();
        if (line) { port = Number(line); break; }
      } catch { /* 正在写 */ }
    }
    await sleep(150);
  }
  if (!port) throw new Error(`${profile}: 拿不到 DevToolsActivePort`);
  return { proc, profile, port };
}

/** 把一屏走到联机大厅的"还没选角色"那一帧（授权门 → 主页 → 模式选择 → 联机大厅）。 */
async function driveToLobby(p) {
  if (!(await p.waitFor('.consent-grant, .home-btn-primary', 90000))) return '页面起来了但既没有授权屏也没有主页';
  if ((await p.count('.consent-grant')) > 0) {
    await p.click('.consent-grant');
    if (!(await p.waitFor('.home-btn-primary', 15000))) return '点了「允许」但主页没出现';
  }
  await p.click('.home-btn-primary');
  if (!(await p.waitFor('.mode-card', 15000))) return '点了「开始游戏」但模式选择没出现';
  // 模式卡是 `<button class="mode-card">`，联机那张**按文案**取（不靠下标，免得文案顺序改了就对错卡）
  const picked = await p.evaluate(`(() => {
    const cards = [...document.querySelectorAll('.mode-card')];
    const i = cards.findIndex((c) => c.textContent.includes('联机对战'));
    if (i < 0) return null;
    cards[i].setAttribute('data-btl', 'lobby');
    return i;
  })()`);
  if (picked === null) return '模式选择里找不到「联机对战（两台设备）」那张卡';
  await p.click("[data-btl='lobby']");
  if (!(await p.waitFor('.net-lobby-host', 15000))) return '进了大厅但没有「建房 / 加入」两个入口';
  return null;
}

/* ── 主流程 ─────────────────────────────────────────────────────────────── */

/**
 * 读某一侧的握手相位。
 *
 * ★ **优先读屏幕属性 `data-net-phase`**：它是**两块屏都挂**的那一个口。T11-B 之后加入方会切到
 * 硬币屏，而那块屏上**没有**大厅的「会话相位：…」行 ⇒ 只读那一行会读到 `null`，
 * 把"走得更远"判成"没推进"（实测：第 1 次跑 ③ 就是这么红的）。老那一行留作兜底。
 */
async function phaseOfSide(p) {
  const v = await p.evaluate(
    "document.querySelector('.coin-screen')?.getAttribute('data-net-phase')"
    + " ?? document.querySelector('.net-lobby-screen')?.getAttribute('data-net-phase')"
    + ' ?? null',
  );
  if (typeof v === 'string' && v.length > 0) return v;
  const line = await p.text('.net-lobby-phase');
  const m = /会话相位：(\S+)/.exec(line ?? '');
  return m ? m[1] : null;
}

const chrome = findChrome();
if (!chrome) die('找不到 Chrome/Edge（可用 CHROME_PATH 指定）');
if (!existsSync(VITE_BIN)) die(`找不到 vite：${VITE_BIN}`);

const vitePort = await pickFreePort();
if (FORBIDDEN_PORTS.includes(vitePort)) die(`内核给回了禁用端口 ${vitePort}（重跑一次即可）`);
if (await portListening(vitePort)) die(`端口 ${vitePort} 已被占用（本工具不去杀别人的进程）`);
const origin = `http://127.0.0.1:${vitePort}`;

say(`chrome = ${chrome}`);
say(`root   = ${ROOT}${ROOT === REPO ? '' : '（变异镜像；vite 可执行文件仍取自本仓库）'}`);
say(`vite   = ${VITE_BIN}`);
say(`port   = ${vitePort}（内核给的：listen(0) 读回后关闭，再以 --strictPort 起 vite；`
  + `不在禁用表 ${FORBIDDEN_PORTS.join('/')} 里）`);
say(`budget = ${WAIT_S}s / 步`);
say('');

const vite = spawn(process.execPath, [VITE_BIN, '--port', String(vitePort), '--strictPort',
  '--host', '127.0.0.1', '--clearScreen', 'false'], { cwd: ROOT, stdio: 'ignore' });

const judged = [];
const push = (ok, what) => { judged.push({ ok, what }); say(`  [${ok ? '通过' : '不通过'}] ${what}`); };
const notes = [];
let hostInst = null;
let guestInst = null;
let host = null;
let guest = null;
const raw = { when: new Date().toISOString(), chrome, vitePort, waitS: WAIT_S, diagnose: DIAGNOSE };
let envError = null;

try {
  if (!(await httpOk(`${origin}/`, 40000))) throw new Error('vite 没起来（40s 内没有 HTTP 200）');
  hostInst = await launchChrome(chrome, origin);
  guestInst = await launchChrome(chrome, `${origin}/`);
  host = await attach('host', hostInst.port, origin);
  guest = await attach('guest', guestInst.port, origin);
  say(`chrome 调试端口：host=${hostInst.port} guest=${guestInst.port}（都是 --remote-debugging-port=0）`);
  say('');

  const hDrive = await driveToLobby(host);
  const gDrive = await driveToLobby(guest);
  say(`驱动到大厅：host ${hDrive ?? 'ok'} / guest ${gDrive ?? 'ok'}`);
  say('');

  /* ── ① 房主：生成邀请码 ─────────────────────────────────────────────── */
  say('=== ① 房主的邀请码真的产出（I-2：传输 env 缺 ticker 时恒失败）===');
  let invitePayload = null;
  if (hDrive !== null) {
    push(false, `房主这一屏驱动失败：${hDrive}`);
  } else {
    await host.click('.net-lobby-host');
    const hasMake = await host.waitFor('.net-lobby-make-invite', 8000);
    if (!hasMake) {
      push(false, '点「建房（生成邀请码）」之后屏上没有出现「生成邀请码」按钮（这一条路今天到不了）');
      notes.push('建房点不动：见 --diagnose 与 .superpowers/g5-T9/FINDINGS.md');
    } else {
      await host.click('.net-lobby-make-invite');
      const appeared = await host.waitFor('.net-lobby-invite-payload', budgetMs);
      invitePayload = appeared ? await host.text('.net-lobby-invite-payload') : null;
      const shaped = typeof invitePayload === 'string' && /^\d+\.[A-Za-z0-9_-]{40,}$/.test(invitePayload);
      push(shaped, shaped
        ? `屏上产出了一条邀请码：${invitePayload.length} 个字符（${await host.text('.net-lobby-invite-length') ?? '没有长度读数'}）`
        : `屏上没有产出邀请码（通知：${(await host.text('.net-lobby-notice')) ?? '无'}）`);
    }
  }
  say('');

  /* ── ② 加入方：回示码真的落地 ───────────────────────────────────────── */
  say('=== ② 回示码真的落地（I-1：hostPeerConnection 恒 null）===');
  let answerCode = null;
  if (invitePayload === null) {
    push(false, '未到达：没有可贴的邀请码（①没产出）');
  } else if (gDrive !== null) {
    push(false, `加入方这一屏驱动失败：${gDrive}`);
  } else {
    if ((await guest.count('.net-lobby-paste-input')) === 0 && (await guest.count('.net-lobby-join')) > 0) {
      await guest.click('.net-lobby-join');
    }
    const hasPaste = await guest.waitFor('.net-lobby-paste-input', 8000);
    if (!hasPaste) {
      push(false, '点「加入」之后屏上没有出现粘贴邀请码的输入框（这一条路今天到不了）');
    } else {
      await guest.type('.net-lobby-paste-input', invitePayload);
      const hasAnswer = await guest.waitFor('.net-lobby-make-answer', 20000);
      if (!hasAnswer) {
        push(false, `贴了邀请码之后没有「出示回示码」按钮（通知：${(await guest.text('.net-lobby-notice')) ?? '无'}）`);
      } else {
        await guest.click('.net-lobby-make-answer');
        const appeared = await guest.waitFor('.net-lobby-answer-code', budgetMs);
        answerCode = appeared ? await guest.text('.net-lobby-answer-code') : null;
        const okAnswer = typeof answerCode === 'string' && answerCode.length > 0;
        push(okAnswer, okAnswer
          ? `加入方产出了回示码：${answerCode.length} 个字符`
          : `加入方没有产出回示码（屏上：${(await guest.text('.net-lobby-error')) ?? (await guest.text('.net-lobby-notice')) ?? '无'}）`);
      }
    }
  }
  say('');

  /* ── ③ 房主把回示码贴回来 ⇒ 握手推进 ───────────────────────────────── */
  say('=== ③ 握手真的推进（I-3：两端 sessionId 不同 ⇒ hello-ack 被自己拒）===');
  let hostPhase = null;
  let guestPhase = null;
  if (answerCode === null) {
    push(false, '未到达：没有可贴回去的回示码（②没产出）');
  } else {
    /**
     * ★★ **先把"贴码那一刻的结论"抓下来**（修复轮；评审建议的延迟判定必须靠它）。
     *
     * 为什么不能在旁边慢慢轮询：`type()` 会派发真的 `input` 事件 ⇒ 大厅那一屏**会整屏重画**
     * ⇒ `.net-lobby-notice` 上那一行被抹掉。等 400ms 再读就已经晚了（实测：轮询一直读到
     * `notice=null`，而那一行其实**出现过**）。所以在同一次 `evaluate` 里做两件事：
     * 先装一个 MutationObserver 把"这一行出现过没有"记进 `window.__answerWatch`，
     * 再 `insertText` 触发 `input`。之后读那个记账位，不读 DOM 的此刻。
     */
    await host.evaluate(`(() => {
      const w = { notice: null, error: null };
      window.__answerWatch = w;
      const grab = () => {
        const n = document.querySelector('.net-lobby-notice');
        if (n && n.textContent && n.textContent.trim().length > 0) w.notice = n.textContent.trim();
        const e = document.querySelector('.net-lobby-error');
        if (e && e.textContent && e.textContent.trim().length > 0) w.error = e.textContent.trim();
      };
      const obs = new MutationObserver(grab);
      obs.observe(document.getElementById('app'), { childList: true, subtree: true, characterData: true });
      grab();
      return true;
    })()`);
    await host.type('.net-lobby-answer-input', answerCode);
    const t0 = Date.now();
    let applied = null;
    let errLine = null;
    /**
     * 等结论：**优先读那个记账位**（它记的是"出现过没有"），DOM 的此刻作兜底。
     *
     * ⚠️ **两种读数都要看**：`applyAnswer` 是异步的（`setRemoteDescription` 之后要等 ICE 那一步），
     * 而成功那一支写的**不是** `state().notice`，是 `state().answerApplied.message`
     * —— 它渲染出来的那行也是 `.net-lobby-notice`（失败那一支渲染成 `.net-lobby-error`）。
     */
    while (Date.now() - t0 < budgetMs) {
      const watch = await host.evaluate('JSON.stringify(window.__answerWatch ?? null)');
      let w = null;
      try { w = JSON.parse(String(watch)); } catch { w = null; }
      applied = (w && typeof w.notice === 'string' && w.notice.length > 0 ? w.notice : null)
        ?? (await host.text('.net-lobby-notice'));
      errLine = (w && typeof w.error === 'string' && w.error.length > 0 ? w.error : null)
        ?? (await host.text('.net-lobby-error'));
      if (errLine !== null && errLine.length > 0) break;
      if (applied !== null && applied.length > 0) break;
      await sleep(200);
    }
    if (errLine === null) errLine = await host.text('.net-lobby-error');
    // 记账位里的那一份优先（它记的是"出现过"，不会被后来的重画抹掉）
    const watchFinal = await host.evaluate('JSON.stringify(window.__answerWatch ?? null)');
    try {
      const w = JSON.parse(String(watchFinal));
      if (w && typeof w.notice === 'string' && w.notice.length > 0) applied = w.notice;
      if (w && typeof w.error === 'string' && w.error.length > 0) errLine = w.error;
    } catch { /* 读不到就用上面那一份 */ }
    /**
     * ★ **两种"成功"都算通过**（T11-B 实测的判据收口，**不是**放宽）：
     *
     *  1. 屏上出现了应用结论（`.net-lobby-answer-applied` / `.net-lobby-notice`）—— 原来那一条；
     *  2. **两端相位真的往后走了**（下面 `advanced` 那一条就是它）。
     *
     * 为什么第 2 条也算：`applyAnswer` 成功那一支**也会**写 `answerApplied`，但它要先等
     * 本机那条对端连接建起来（`hostPeerConnection` 由 `onPeerConnection` 回执填）——
     * 本机 ICE 收集慢的时候（实测 4.8-5.2 秒，预算 25 秒足够）它可能还没轮到那一格，
     * 而加入方那条路**不依赖**它 ⇒ 两端相位照样一路走到 `awaiting-commit-face` / `awaiting-commit-ack`。
     * 于是"结论那行还没写"与"这条路没通"是两件事，原判据把前者读成了后者（实测：先红后绿两次）。
     * **失败那一支仍然是失败**：`errLine` 非空一律不通过（下面那句）。
     */
    const appliedOk = errLine === null && applied !== null && applied.length > 0;
    if (!appliedOk) {
      // 不通过时把那一屏的原始读数记下来（否则只能猜"是没结论还是读错了"）
      const noticeRaw = await host.text('.net-lobby-notice');
      const phaseRaw = await phaseOfSide(host);
      notes.push(`③ 未通过时的原始读数：notice=${JSON.stringify(noticeRaw)}`
        + ` error=${JSON.stringify(errLine)} 相位=${String(phaseRaw)} 轮询读数=${JSON.stringify(applied)}`);
    }
    // 「握手真的推进」= 两端都离开 `handshaking`/`idle`。**不再要求恰好停在 `awaiting-commit-face`**：
    // T8-C 接上驱动者之后两端会一路走到 `complete`，用"那个相位"判会让**走得更远反而算失败**（2026-09-18 实测）。
    // T11-B 之后加入方会停在 `awaiting-commit-ack`（等玩家叫面）—— 那同样算推进。
    const advancedPhase = (p) => p !== null && p !== 'handshaking' && p !== 'idle';
    const t1 = Date.now();
    while (Date.now() - t1 < budgetMs) {
      hostPhase = await phaseOfSide(host);
      guestPhase = await phaseOfSide(guest);
      if (advancedPhase(hostPhase) && advancedPhase(guestPhase)) break;
      await sleep(500);
    }
    const advanced = advancedPhase(hostPhase) && advancedPhase(guestPhase);
    if (errLine !== null && errLine.length > 0) {
      push(false, `房主贴回示码的结论是失败那一支：${errLine}`);
    } else if (appliedOk) {
      push(true, `房主贴回的结论：${applied}`);
    } else {
      push(advanced, advanced
        ? `房主那行结论还没写上去（等 ICE 收集），但两端相位已经推进到 房主 ${hostPhase} / 加入方 ${guestPhase}`
        : '房主贴回示码之后既没有结论、相位也没动');
    }
    push(advanced, advanced
      ? `两端相位都推进了（离开 handshaking）：房主 ${hostPhase} / 加入方 ${guestPhase}`
      : `相位没推进：房主 ${hostPhase ?? '未读到'} / 加入方 ${guestPhase ?? '未读到'}（加入方停在 handshaking 就是 I-3 的症状）`);
    /**
     * ★★ **延迟判定：房主那行结论最终必须出现**（评审对 ③ 收口的建议，修复轮补上）。
     *
     * 上面那条收口允许"结论行还没写上去、但相位已经推进"算通过 —— 理由是 `applyAnswer` 是
     * 异步的（要等本机那条对端连接建起来、`hostPeerConnection` 由 `onPeerConnection` 回执填），
     * 而加入方那条路不依赖它。代价：**万一它永远不出现**，上面那条会把 ③ 判绿。
     * ⇒ 这里认"**出现过**"（上面那个 `MutationObserver` 的记账位）：
     * 既没有可读失败、也没有结论行出现过 ⇒ 红。
     */
    const tLate = Date.now();
    let lateLine = applied;
    let lateErr = errLine;
    while ((lateLine === null || lateLine.length === 0) && (lateErr === null || lateErr.length === 0)
      && Date.now() - tLate < 20000) {
      const raw = await host.evaluate('JSON.stringify(window.__answerWatch ?? null)');
      try {
        const w = JSON.parse(String(raw));
        if (w && typeof w.notice === 'string' && w.notice.length > 0) lateLine = w.notice;
        if (w && typeof w.error === 'string' && w.error.length > 0) lateErr = w.error;
      } catch { /* 记账位读不到就继续等 */ }
      if ((lateLine === null || lateLine.length === 0) && (lateErr === null || lateErr.length === 0)) await sleep(400);
    }
    const lateOk = (lateLine !== null && lateLine.length > 0) || (lateErr !== null && lateErr.length > 0);
    if (!lateOk) {
      const phaseLate = await phaseOfSide(host);
      notes.push(`③ 延迟判定未通过时的原始读数：notice=${JSON.stringify(await host.text('.net-lobby-notice'))}`
        + ` error=${JSON.stringify(await host.text('.net-lobby-error'))} 房主相位=${String(phaseLate)}`
        + ` 轮询读数=${JSON.stringify(applied)}`);
    }
    push(lateOk, lateOk
      ? `房主那行结论出现过：「${lateLine ?? lateErr ?? ''}」`
      + '（③ 收口放行的那一格里，它最终确实出现了）'
      : '房主贴回示码之后**始终**没有结论行、也没有可读失败（③ 那条收口会把它漏过去）');
  }
  say('');

  /* ── ③.5 硬币屏：加入方叫面之前屏上没有落点，点了之后握手才继续（G5 T11-B）───── */
  say('=== ③.5 硬币屏插在握手中间（D27：叫面早于公开种子）===');
  if (answerCode === null) {
    push(false, '未到达：握手没推进（③不通过）⇒ 硬币屏那几条也没到');
  } else {
    // 两端都该出现硬币屏：加入方叫面、房主等（`lobbyCoinView()` 按会话角色分）
    const hostCoin = await host.waitFor('.coin-face-chip', budgetMs);
    const guestCoin = await guest.waitFor('.coin-face-chip', budgetMs);
    push(hostCoin && guestCoin, hostCoin && guestCoin
      ? '两端屏上都出现了硬币屏（同一套 `coin-face-chip`）'
      : `硬币屏没出现：房主 ${hostCoin ? '有' : '没有'} / 加入方 ${guestCoin ? '有' : '没有'}`);
    if (guestCoin) {
      const guestTitle = (await guest.text('.coin-title')) ?? '';
      // 标题必须说清"由加入方选面"（热座那句在联机下不成立）
      push(guestTitle.includes('加入方'), guestTitle.includes('加入方')
        ? `硬币屏标题说清了选面的一方：「${guestTitle}」`
        : `硬币屏标题没有说清"由加入方选面"：「${guestTitle}」`);
      const banned = ['公平', '防作弊', '无法作弊'];
      const guestAll = (await guest.evaluate('document.body.innerText')) ?? '';
      const hostAll = (await host.evaluate('document.body.innerText')) ?? '';
      const hit = banned.filter((w) => guestAll.includes(w) || hostAll.includes(w));
      push(hit.length === 0, hit.length === 0
        ? '硬币屏可见文案不含「公平 / 防作弊 / 无法作弊」'
        : `硬币屏可见文案里出现了禁用词：${hit.join('、')}`);
      /**
       * ★ 点芯片**之前**：屏上不许有落点读数（判据 4 的那一半）。
       *
       * 为什么这条能钉住"种子不早于叫面"：落点是从种子派生的，种子的唯一来源是
       * 房主的 `reveal-seed`，而那条消息只在 `commit-face` 之后才发 —— 所以"点之前没有落点"
       * 与"叫面早于公开种子"在屏上是同一件事。
       */
      const preResult = await guest.text('.coin-result-text');
      const preChips = await guest.evaluate(`[...document.querySelectorAll('.coin-face-chip')].map((c) => c.disabled)`);
      push(preResult === null, preResult === null
        ? '点芯片之前屏上没有落点读数（种子还没公开）'
        : `点芯片之前屏上已经有落点读数了：「${preResult}」`);
      /**
       * ★ **等待方也不许提前显示落点**（变异 M4 的锚点）。
       *
       * 房主手里**本来就有种子**（`sendCommit` 之后），比加入方更早算得出落点；
       * 而"叫中还是叫错"要看加入方叫的那一面 —— 那个面在 `reveal-face` 进来之前谁也拿不到。
       * 不挡住这一格，等待方的屏会在一个回合之前定格出一个**胜负装错**的读数
       * （实测症状：房主"玩家 2 先选协议"、加入方"玩家 1 先选协议"）。
       */
      const preHostResult = await host.text('.coin-result-text');
      push(preHostResult === null, preHostResult === null
        ? '点芯片之前，等待方（房主）的屏上也没有落点读数'
        : `等待方的屏上提前出现了落点：「${preHostResult}」`);
      push(
        Array.isArray(preChips) && preChips.length === 2 && preChips.every((d) => d === false),
        Array.isArray(preChips) && preChips.length === 2 && preChips.every((d) => d === false)
          ? '加入方那两枚芯片可点（叫面的一方）'
          : `加入方的芯片状态不对：${JSON.stringify(preChips)}`,
      );
      // 真鼠标点第一枚（正面）
      await guest.click('.coin-face-chip');
      const landed = await guest.waitFor('.coin-result-text', budgetMs);
      /**
       * 诊断读数：点完那一刻芯片上的 `selected` 与屏上的相位。
       *
       * 它的用处是**分辨两种失败**：芯片被选中 = 点击真的进了处理函数（问题在握手那一侧）；
       * 一枚都没选 = 点击没到（`Input.dispatchMouseEvent` 与元素矩形的问题）。
       * 只进 `notes`，不参与判定。
       */
      const pickedNow = await guest.evaluate(
        "[...document.querySelectorAll('.coin-face-chip')].map((c) => c.className)",
      );
      const phaseNow = await phaseOfSide(guest);
      notes.push(`点完芯片之后：芯片类名 ${JSON.stringify(pickedNow)} / 相位 ${String(phaseNow)} / 落点 ${String(landed)}`);
      push(landed, landed
        ? `点完芯片之后屏上出现了落点：${(await guest.text('.coin-result-text')) ?? ''}`
        : '点了芯片之后屏上没有出现落点（握手没继续 ⇒ 种子没到）');
      if (landed) {
        /**
         * ★★ **跨端判据**（修复轮）：等两端**读数就绪**，再比**读数**（座位号），文案按同一套
         * 全局座位编号归一化后比 —— 不比本地化字符串的逐字相等。
         *
         * ## 上一版为什么读不出那个缺陷
         *
         * 上一版只比"两端 `.coin-result-text` 的整句是否逐字相同"。那有两个毛病：
         *  1. 两句都合法、只是**先选者不同**时，它给出的是一句"文案不同"，读者分不清
         *     "两端算的是两件事"还是"编号口径不同"；
         *  2. 更糟的是它**可能读到瞬时帧**（两端的重画时刻本来就不同）。
         *
         * ## 现在比什么
         *
         * `main.ts` 在**胜负依据齐了的那一帧**把四个输入挂到 `globalThis.__coinInputs`
         * （`caller` / `chosen` / `landed` / `winner`，后两个都是**座位**）。判据：
         *  - ① 四个数两端逐个相同；
         *  - ② 两端**文案里那个 `玩家 N`** 都等于各自 `winner + 1`（全局座位编号：玩家 1 = 座位 0）。
         * ② 是把"读数对、文案却写了另一个数"这条也钉住 —— 只比读数时它看不见。
         */
        const readReady = async (p) => (await p.evaluate('String(globalThis.__coinReady ?? false)')) === 'true';
        const t3 = Date.now();
        while (Date.now() - t3 < budgetMs) {
          if ((await readReady(host)) && (await readReady(guest))) break;
          await sleep(200);
        }
        const inputsOf = async (p) => await p.evaluate('JSON.stringify(globalThis.__coinInputs ?? null)');
        const parse = (s) => { try { return JSON.parse(String(s)); } catch { return null; } };
        const hObj = parse(await inputsOf(host));
        const gObj = parse(await inputsOf(guest));
        notes.push(`硬币屏读数：房主 ${JSON.stringify(hObj)} / 加入方 ${JSON.stringify(gObj)}`);
        const sameInputs = hObj !== null && gObj !== null
          && hObj.caller === gObj.caller && hObj.chosen === gObj.chosen
          && hObj.landed === gObj.landed && hObj.winner === gObj.winner;
        push(sameInputs, sameInputs
          ? `两端四个读数逐个相同：caller=${String(hObj.caller)} chosen=${String(hObj.chosen)}`
            + ` landed=${String(hObj.landed)} winner=${String(hObj.winner)}`
          : `两端的读数不同：房主 ${JSON.stringify(hObj)} / 加入方 ${JSON.stringify(gObj)}`);
        // ② 文案里的座位号 = `winner + 1`（全局座位编号；不是本地化字符串逐字相等）
        const seatInText = (line) => {
          const m = /玩家\s*(\d+)\s*先选协议/.exec(line ?? '');
          return m === null ? null : Number(m[1]);
        };
        const hLine2 = await host.text('.coin-result-text');
        const gLine2 = await guest.text('.coin-result-text');
        const hSeat = seatInText(hLine2);
        const gSeat = seatInText(gLine2);
        const textOk = hObj !== null && gObj !== null
          && hSeat === hObj.winner + 1 && gSeat === gObj.winner + 1 && hSeat === gSeat;
        push(textOk, textOk
          ? `两端文案说的是同一个全局座位号：玩家 ${String(hSeat)} 先选协议（房主 / 加入方都是它）`
          : `文案与读数对不上：房主文案 ${JSON.stringify(hLine2)}（座位 ${String(hSeat)}，读数 winner=${String(hObj?.winner)}）`
            + ` / 加入方文案 ${JSON.stringify(gLine2)}（座位 ${String(gSeat)}，读数 winner=${String(gObj?.winner)}）`);
      }
      // 握手继续到底：加入方不再停在"等承诺 / 等面"那几格
      const t2 = Date.now();
      let gPhase2 = null;
      while (Date.now() - t2 < budgetMs) {
        gPhase2 = await phaseOfSide(guest);
        if (gPhase2 === 'complete') break;
        await sleep(500);
      }
      const movedOn = gPhase2 !== null && gPhase2 !== 'awaiting-commit-ack' && gPhase2 !== 'awaiting-commit'
        && gPhase2 !== 'handshaking';
      push(movedOn, movedOn
        ? `点完芯片之后握手继续走到 ${gPhase2}`
        : `点完芯片之后加入方仍停在 ${String(gPhase2)}（叫面没有解锁握手）`);
      notes.push(`硬币屏实测：房主 ${hostCoin ? '有' : '无'} / 加入方 ${guestCoin ? '有' : '无'}，`
        + `点前落点 ${JSON.stringify(preResult)}，点后相位 ${String(gPhase2)}`);
    } else {
      push(false, '未到达：加入方屏上没有硬币屏 ⇒ 后面几条（点前无落点 / 点后继续）都到不了');
    }
  }
  say('');

  /* ── ④ 负控：邀请码压缩段截断 ─────────────────────────────────────── */
  say('=== ④ 负控（把邀请码的压缩段截断再贴：必须给可读失败，且不假装成功）===');
  if (invitePayload === null) {
    push(false, '未到达：没有可改坏的邀请码（①没产出）');
  } else {
    /**
     * 负控必须用**干净的一侧**：③已经把一条**好码**贴进过加入方，屏上留着那条码产出的
     * 回示码与相位行 ⇒ 在那一屏上判"有没有假装成功"是判不出来的（第一版就是这么拿到一个
     * 假的不通过）。所以先把加入方那一页**重新载入**、重新走一遍到大堂，再点「加入」。
     */
    // 真导航回起点（不是同文档改 hash）：这样加入方那一屏是**干净**的。
    // 等"入口屏"由下面 driveToLobby 的第一步负责（它会等授权屏/主页出现，最多 90 秒）。
    await guest.send('Page.navigate', { url: `${origin}/` });
    await sleep(1000);
    const gDrive2 = await driveToLobby(guest);
    if (gDrive2 !== null) {
      push(false, `未到达：负控要用的干净加入方那一屏起不来（${gDrive2}）`);
    } else if ((await guest.count('.net-lobby-join')) === 0) {
      push(false, '未到达：干净那一屏上没有「加入」入口');
    } else {
      await guest.click('.net-lobby-join');
      if (!(await guest.waitFor('.net-lobby-paste-input', 8000))) {
        push(false, '未到达：干净那一屏上「加入」之后没有粘贴框');
      } else {
        /**
         * ★★ **篡改方式：砍掉压缩段最后 8 个字符**（修复轮换的）。
         *
         * 为什么换：上一版改的是**压缩段第 1 个字符**。那一位确实落在 deflate 流头几个比特上，
         * 但"改一位"这类篡改**不是必然失败** —— `deflate-raw` 没有校验和，某一位恰好落在
         * 字面量字节上时载荷照样解得开（工具自己就记过：中段那一位改完屏上连错误行都没有）。
         * ⇒ ④ 变成了"多跑几次碰运气"，评审实测两次里红一次、绿一次。
         *
         * 截断则是**结构性**的：deflate 流被切断之后解压器必然报错（不等于"某一位碰巧"),
         * 这也是 node 侧那条 50 条现场邀请码的腿钉的同一件事
         * （`tests/ui/net-lobby-coin-consensus.test.ts`：50/50 全部 `decompress-failed` 且文案可读）。
         */
        const dot = invitePayload.indexOf('.');
        const compressed = invitePayload.slice(dot + 1);
        const keep = Math.max(1, compressed.length - 8);
        const broken = `${invitePayload.slice(0, dot + 1)}${compressed.slice(0, keep)}`;
        notes.push(`负控用的坏码：截掉压缩段最后 8 个字符（${compressed.length} -> ${keep}）`);
        await guest.type('.net-lobby-paste-input', broken);
        await sleep(3000);
        const errLine = await guest.text('.net-lobby-error');
        const readable = typeof errLine === 'string' && errLine.trim().length >= 12;
        // "假装成功"的两个可观测形态：屏上出现本侧链路/相位那一行（那是"解开了、去连了"才会画的）
        // 以及回示码。两者都不许有。
        const phaseLine = (await guest.text('.net-lobby-phase')) ?? '';
        const answerCode2 = await guest.count('.net-lobby-answer-code');
        const noFakeLink = phaseLine.trim().length === 0 && answerCode2 === 0;
        push(readable, readable
          ? `截断压缩段后屏上给了可读失败：「${errLine}」`
          : `截断压缩段后屏上**没有**可读失败（error=${JSON.stringify(errLine)}）`);
        push(noFakeLink, noFakeLink
          ? '没有假装成功：屏上没起本侧链路、也没产出回示码'
          : `假装成功了：相位行=${JSON.stringify(phaseLine)}、回示码个数=${answerCode2}`);
      }
    }
  }
  say('');

  /* ── 追加诊断（--diagnose）：把"点不动"钉到具体那一格 ───────────────── */
  if (DIAGNOSE) {
  say('');
  say('=== 诊断（不属于那些判定）===');
    const diag = {};
    if (hDrive === null) {
      await host.click('.net-lobby-host');
      const before = await host.evaluate("document.getElementById('app').innerHTML.length");
      await sleep(1500);
      const after = await host.evaluate("document.getElementById('app').innerHTML.length");
      diag.hostClickChangedDom = before !== after;
      diag.makeInviteBtn = await host.count('.net-lobby-make-invite');
      await host.click('.net-lobby-advanced-toggle');
      await sleep(400);
      diag.advancedPanelOpens = (await host.count('.net-lobby-advanced-panel')) > 0;
      diag.inviteBoxAfterHostClick = await host.count('.net-lobby-invite');
      diag.exceptions = host.events.filter((e) => e.method === 'Runtime.exceptionThrown').length;
      say(`  点「建房」后 #app 的 innerHTML 长度 ${before} -> ${after}（变了 = ${diag.hostClickChangedDom}）`);
      say(`  同屏「生成邀请码」按钮个数 = ${diag.makeInviteBtn}；房主那一栏 = ${diag.inviteBoxAfterHostClick}`);
      say(`  「高级 / 连接设置」能展开 = ${diag.advancedPanelOpens}`
        + `（它只有大厅客户端存在才生效 ⇒ 客户端**建起来了**，是 s.role 仍为 null）`);
      say(`  页面异常数 = ${diag.exceptions}`);
    }
    if (gDrive === null) {
      // 「加入」这条路要看的是**同一屏**上另一个按钮能不能推进。地址栏那段用真导航改
      // （同文档 fragment 导航：页面不重载，与点一条 `#invite=...` 链接同效），
      // 因为 `readInviteFromAddressBar` 是在**点「加入」那一刻**读的 `location.href`。
      await guest.send('Page.navigate', { url: `${origin}/#invite=1.zzzzzzzzzz` });
      await sleep(1500);
      let guestBox = 0;
      let errLine = null;
      if (await guest.waitFor('.net-lobby-host', 8000)) {
        await guest.click('.net-lobby-join');
        await sleep(2500);
        guestBox = await guest.count('.net-lobby-join-box');
        errLine = await guest.text('.net-lobby-error');
      }
      diag.guestHash = await guest.evaluate('location.hash');
      diag.guestBoxWithBadFragment = guestBox;
      diag.guestBadFragmentError = errLine;
      say(`  地址栏带一条坏载荷时（#invite=1.zzzzzzzzzz）点「加入」：加入方那一栏 = ${guestBox}，`
        + `可读失败 = ${JSON.stringify(errLine)}`);
      say('  ⇒ 同一屏、同一套点击：「加入」这条路能推进（applyInvite 里设了 s.role），「建房」不能'
        + '（s.role 只有 client.startHost(draft) 会设，而它要一份真 SDP）');
    }
    raw.diagnoseFacts = diag;
    say('');
  }
} catch (e) {
  envError = String(e);
  say(`\n[X] 环境错误：${envError}`);
} finally {
  if (host) host.close();
  if (guest) guest.close();
  if (!KEEP) {
    killTree(hostInst?.proc.pid);
    killTree(guestInst?.proc.pid);
    killTree(vite.pid);
    await sleep(600);
    for (const p of [hostInst?.profile, guestInst?.profile]) {
      if (p) { try { rmSync(p, { recursive: true, force: true }); } catch { /* 偶尔被占 */ } }
    }
  }
}

/* ── 收工自证 ───────────────────────────────────────────────────────────── */
let clean = true;
if (!KEEP && envError === null) {
  say('=== 收工自证 ===');
  const ports = [['vite dev server', vitePort], ['host 调试端口', hostInst?.port], ['guest 调试端口', guestInst?.port]];
  for (const [name, p] of ports) {
    if (p === undefined) continue;
    const listening = await portListening(p);
    say(`  [${listening ? '不通过' : '通过'}] ${name} ${p} 未在监听`);
    if (listening) clean = false;
  }
  const left = [];
  try {
    for (const n of readdirSync(tmpdir())) if (n.startsWith(PROFILE_PREFIX)) left.push(n);
  } catch { /* 读不了就不断言 */ }
  say(`  [${left.length === 0 ? '通过' : '不通过'}] 临时 profile 已清（残留 ${left.length} 个）`);
  if (left.length > 0) clean = false;
  say('');
}

const pass = judged.filter((x) => x.ok).length;
const verdict = envError === null && judged.length > 0 && pass === judged.length && clean;
raw.judged = judged;
raw.clean = clean;
raw.envError = envError;
raw.verdict = verdict;
if (JSON_OUT) {
  writeFileSync(JSON_OUT, JSON.stringify(raw, null, 2), 'utf8');
  say(`原始结果已写入 ${JSON_OUT}`);
}

if (envError !== null) {
  process.exit(2);
}
for (const n of notes) say(`注：${n}`);
say(`判定 ${pass}/${judged.length} 条通过${clean ? '' : '（收工自证不干净）'}`);
say(verdict ? '\n全部判定通过。' : '\n有判定不通过。');
process.exit(verdict ? 0 : 1);

















