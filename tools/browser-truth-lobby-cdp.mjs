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
 *  ④ 负控：把那条邀请码**改坏一个字符**再贴 ⇒ 屏上必须给**可读**的失败，且**不假装成功**
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
 * 退出码：0 = 四条判定全通过；1 = 有判定不通过；2 = 环境错误（找不到 Chrome / vite 起不来 / CDP 连不上）。
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
    await host.type('.net-lobby-answer-input', answerCode);
    const t0 = Date.now();
    let applied = null;
    while (Date.now() - t0 < budgetMs) {
      applied = await host.text('.net-lobby-notice');
      if ((await host.count('.net-lobby-error')) > 0) break;
      if (applied !== null && applied.length > 0) break;
      await sleep(400);
    }
    const errLine = await host.text('.net-lobby-error');
    const appliedOk = errLine === null && applied !== null && applied.length > 0;
    const phaseOf = async (p) => {
      const line = await p.text('.net-lobby-phase');
      const m = /会话相位：(\S+)/.exec(line ?? '');
      return m ? m[1] : null;
    };
    const t1 = Date.now();
    while (Date.now() - t1 < budgetMs) {
      hostPhase = await phaseOf(host);
      guestPhase = await phaseOf(guest);
      if (hostPhase === 'awaiting-commit-face' && guestPhase !== null && guestPhase !== 'handshaking') break;
      await sleep(500);
    }
    if (!appliedOk) push(false, `房主贴回示码的结论是失败那一支：${errLine ?? '（没有结论）'}`);
    else push(true, `房主贴回的结论：${applied}`);
    const advanced = hostPhase === 'awaiting-commit-face'
      && guestPhase !== null && guestPhase !== 'handshaking' && guestPhase !== 'idle';
    push(advanced, advanced
      ? `两端相位推进到等待承诺：房主 ${hostPhase} / 加入方 ${guestPhase}`
      : `相位没推进：房主 ${hostPhase ?? '未读到'} / 加入方 ${guestPhase ?? '未读到'}（加入方停在 handshaking 就是 I-3 的症状）`);
  }
  say('');

  /* ── ④ 负控：邀请码改坏一个字符 ─────────────────────────────────────── */
  say('=== ④ 负控（把邀请码改坏一个字符再贴：必须给可读失败，且不假装成功）===');
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
         * 改哪一位：取**压缩段的第一个字符**（`<协议版本>.` 之后那一位）。
         * 那一位落在 deflate 流的头几个比特上（`BFINAL/BTYPE`），改它能真把流打断。
         * ⚠️ 实测登记（别读成"任何一位都会失败"）：第一次用的是**中段**那一位
         * （第 444 个字符，`j -> A`），deflate-raw **没有校验和**，那一位恰好落在字面量字节上
         * ⇒ 载荷照样解得开、屏上连错误行都没有。这一条写在下面 notes 里。
         */
        const dot = invitePayload.indexOf('.');
        const i = dot + 1;
        const ch = invitePayload[i];
        const swapped = ch === 'A' ? 'B' : 'A';
        const broken = invitePayload.slice(0, i) + swapped + invitePayload.slice(i + 1);
        notes.push(`负控用的坏码：压缩段第 1 个字符（整条第 ${i} 位）${ch} -> ${swapped}`);
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
          ? `改坏一个字符后屏上给了可读失败：「${errLine}」`
          : `改坏一个字符后屏上**没有**可读失败（error=${JSON.stringify(errLine)}）`);
        push(noFakeLink, noFakeLink
          ? '没有假装成功：屏上没起本侧链路、也没产出回示码'
          : `假装成功了：相位行=${JSON.stringify(phaseLine)}、回示码个数=${answerCode2}`);
      }
    }
  }
  say('');

  /* ── 追加诊断（--diagnose）：把"点不动"钉到具体那一格 ───────────────── */
  if (DIAGNOSE) {
    say('=== 诊断（不属于那四条判定）===');
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
