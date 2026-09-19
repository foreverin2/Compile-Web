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
 *     两枚芯片可点；点了之后落点出现、两端读数逐字相同、握手继续走到 `complete`。
 *     ⚠️ **T11-C 起，这一组里"点后落点出现"那条读的是 `globalThis.__coinInputs`（那一帧的
 *     记账位），不再读屏上的 `.coin-result-text`**：硬币屏在联机下从"终点"变成了"中间站"
 *     （两端一 ready 就进草稿），读屏上此刻会读到一个**已经被换走**的屏。判据本身没放宽
 *     ——仍然是"落点必须算出来过"，只是改成读"发生过的事"；
 *  ③.6 **握手完 ⇒ 两端真的进草稿**（G5 T11-C）：两端屏上都出现 `.draft-screen`、
 *     两端 `__g5Match` 报的种子与先选协议者相同、**两端状态指纹逐字相等**；
 *  ③.7 **真的选一步协议**（判据 3）：按"谁先选"的那一侧在池子里真鼠标拖一张卡
 *     （真 `mousedown/mousemove/mouseup`，走 `bindDraftDrag`）⇒ 选中的那一侧状态变了、
 *     没选的那一侧**一字未动**（草稿动作今天不走线上，登记在报告里）；
 *  ③.8 **两端各自走完整场草稿 ⇒ 两端状态规范串逐字相等**（判据 3 的收口）：六次选完、
 *     进对局相。走草稿走 `__g5Match.finishDraft()`（**不动驱动、不碰传输**；它调的就是拖拽落点
 *     那一句调的同一个 `cb.onDraftPick`）。⚠️ 判据 3 的"跨端草稿同步"今天**不成立**（草稿动作
 *     不过线），所以这一格证的是"同一起始状态 + 各自确定性重演"，标题里写明了这一点；
 *  ④ 负控：把那条邀请码的**压缩段截断**再贴 ⇒ 屏上必须给**可读**的失败，且**不假装成功**
 *     （不产回示码、相位不前进）。
 *
 * ## 读对局读数为什么要带 `#g5probe=1`
 *
 * 两端状态指纹那几条读的是 `globalThis.__g5Match`（`src/main.ts` 的 `exposeMatchProbe()`），
 * 而它**只在这个查询片段出现时挂上**：它返回的是**整份 `GameState` 的规范串**（几万字符），
 * 无条件挂上去会让每次重画都序列化一遍。⇒ 本工具起的两个 Chrome 一开始就带这个片段
 * （见下面的 `launchChrome` 调用），其余两道浏览器门不带它、行为一字不变。
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
/**
 * 打开"跨端状态指纹"那个只读读取口的查询片段（`src/main.ts` 的 `exposeMatchProbe()`）。
 * 两个 Chrome 从一开始就带它 —— 见文件头"读对局读数为什么要带 `#g5probe=1`"。
 */
const PROBE_FRAGMENT = '#g5probe=1';

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

/* ── ★★ G5 T11-C：跨端对局读数（判据 5/6/7 的读数口）────────────────────── */

/** 32 位 FNV-1a（**与 `src/core/rng.ts:26` 的 `hash32` 同一份算式**：`0x811c9dc5` 起始、
 * 每字节 `^=` 之后 `Math.imul(h, 0x01000193)`）。
 *
 * 为什么在工具这一侧再写一遍：跨端比的那份串是 `stableStringify(state)`，几万字符，
 * 不相等的两份逐字打印出来是十几万字符的差异（人读不了、日志也放不下）。
 * 比哈希与比串在"**不相等**"这件事上等价；而"相等"那一刻两边给出的是同一个哈希 ——
 * 真正的逐字比较（以及那个哈希本身的出处）由 node 腿钉着
 * （`tests/ui/net-lobby-handoff.test.ts` 比的是 `stateFingerprint`）。
 */
function hash32(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** `JSON.parse` 的安全版（页面里那个记账位可能是 `null` / 半个对象） */
function parseJson(text) {
  try { return JSON.parse(String(text)); } catch { return null; }
}

/**
 * ★★ **读"硬币那一帧的结算读数"**（评审阻断项 1 的修法那一半）。
 *
 * 两个来源，**先 `__coinInputs`（T11-B 那一帧写下的原文）、再 `__coinVerdict`（`main.ts`
 * 在进牌桌之前持久下来的那一份）**：
 *
 * 为什么需要第二个来源：`__coinInputs` 的**唯一**写入点是 `lobbyCoinViewOf()`，而进牌桌之后
 * 那一帧就 `return` 了、硬币屏再也不画 ⇒ 房主的"读数齐了"那一帧与"进牌桌"那一帧**重叠**时，
 * 它那一侧**永远没被写过** ⇒ 这条跨端判据读到 `null`、固红（评审实测：镜像 9 跑 3 红，
 * 红点正是 `两端读数不同：房主 null / 加入方 {...}`）。
 *
 * 两者是**同一组数**（都由 `handoff()` 交出来的那一组派生），`__coinVerdict` 只是把它
 * 留在模块态里、不再依赖"屏还在不在"。
 */
async function coinVerdictOf(p) {
  const raw = await p.evaluate(`(() => {
    const v = globalThis.__coinInputs ?? globalThis.__coinVerdict ?? null;
    return v === null ? null : JSON.stringify(v);
  })()`);
  return parseJson(raw);
}

/**
 * 本端这一刻的对局读数（`__g5Match`，`src/main.ts` 的 `exposeMatchProbe()`）。
 *
 * `null` = 这一页还没挂那个读取口（没带 `#g5probe=1`，或页面还在旧版本上）。
 */
async function matchOf(p) {
  const raw = await p.evaluate(`(() => {
    const m = globalThis.__g5Match;
    if (!m) return null;
    return JSON.stringify({
      state: m.state(), seed: m.seed(),
      draftStarter: m.draftStarter(), draftRound: m.draftRound(),
    });
  })()`);
  if (typeof raw !== 'string' || raw.length === 0) return null;
  let parsed = null;
  try { parsed = JSON.parse(raw); } catch { return null; }
  if (parsed === null || typeof parsed.state !== 'string') return null;
  return {
    fp: hash32(parsed.state),
    chars: parsed.state.length,
    seed: String(parsed.seed),
    draftStarter: parsed.draftStarter,
    draftRound: parsed.draftRound,
  };
}

/**
 * 读某一侧草稿屏上的读数（**屏面那一半**：不经过任何全局探针）。
 *
 * `drafter` = 顶部横幅里那个「玩家 N」的座位号（-1 = 读不到）。它与 `__g5Match` 的
 * `draftStarter` 是**两件事**，正是判据要交叉比的那两件：屏上写的是谁在选、状态里算的是谁先选。
 */
async function draftScreenOf(p) {
  return await p.evaluate(`(() => {
    const s = document.querySelector('.draft-screen');
    if (!s) return null;
    const banner = s.querySelector('.draft-turn-banner .turn-badge');
    const m = /玩家\\s*(\\d+)/.exec(banner ? banner.textContent : '');
    return {
      cards: s.querySelectorAll('.draft-card').length,
      picks: s.querySelectorAll('.draft-pick-card').length,
      drafter: m ? Number(m[1]) - 1 : -1,
      progress: (s.querySelector('.draft-progress-text') || {}).textContent || '',
      note: (s.querySelector('.draft-mode-note') || {}).textContent || '',
    };
  })()`);
}

/** 真鼠标拖拽（`bindDraftDrag` 要的是 mousedown → 动 >6px → mouseup 落在目标框里） */
async function drag(send, label, from, to) {
  const a = { x: Math.round(from.x), y: Math.round(from.y), button: 'left', clickCount: 1 };
  const b = { x: Math.round(to.x), y: Math.round(to.y), button: 'left', clickCount: 1 };
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: a.x, y: a.y });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...a });
  // 分两步移动：第一步越过 6px 阈值（这一步才 `beginDrag()`）、第二步落到目标框中心
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: a.x + 10, y: a.y + 10, button: 'left' });
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: b.x, y: b.y, button: 'left' });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...b });
  void label;
}

/** 某个选择器的矩形中心（拖拽的目标点用） */
async function centerOf(p, selector) {
  return await p.evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return null;
    el.scrollIntoView({ block: 'center', inline: 'center' });
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return null;
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`);
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
/**
 * ★ 判据②（`coin-result-text` 里「玩家 N」== `winner + 1`）的取样槽：在 ③.5**点完芯片之后**
 * 取（那是唯一的窗口 —— 两端一 ready 就进草稿屏，结论行会被换掉），在 ③.6 判。
 * 声明在**模块级**（不是那个 if 块里）：③.5 在 `if (guestCoin) { … }` 里取样，③.6 在块外判。
 */
let coinSnapHost = null;
let coinSnapGuest = null;
const raw = { when: new Date().toISOString(), chrome, vitePort, waitS: WAIT_S, diagnose: DIAGNOSE };
let envError = null;
/** 收工清理失败的真因（见下面的删除重试）；写进 `raw` 供事后查证 */
const cleanupErrors = [];

try {
  if (!(await httpOk(`${origin}/`, 40000))) throw new Error('vite 没起来（40s 内没有 HTTP 200）');
  hostInst = await launchChrome(chrome, `${origin}/${PROBE_FRAGMENT}`);
  guestInst = await launchChrome(chrome, `${origin}/${PROBE_FRAGMENT}`);
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
      /**
       * ★★ **判据②的取样：在点芯片之前装一个 `MutationObserver`，把"**出现过的**结论行"记下来**
       * （评审 R2 §8 遗留 1 的补回；同一套做法在 T11-B 的 ③ 里用过 —— 那里记的是
       * `.net-lobby-notice`）。
       *
       * ## 为什么不能靠轮询
       *
       * 实测（2026-09-19，两次）：点完芯片之后**两端在几十毫秒内就进了草稿屏**，
       * `.coin-result-text` 只在一两帧里存在；而 CDP 每轮 `evaluate` 要几十毫秒 ⇒ 轮询
       * 整整 30 秒都读不到（两次都是 `房主 null / 加入方 null`，而同一刻 `coinReady=true`、
       * `hasVerdict=true`、`draft:1`）。**读 DOM 的"此刻"必然错过它**。
       *
       * ## 记的东西是"同一帧的一对"
       *
       * 观察者的回调在浏览器那一侧跑：`__coinInputs` 是 `lobbyCoinViewOf()` 在**同一帧**里、
       * 画屏**之前**写的（`net-lobby.ts` 里那句），所以回调里读到的 `winner` 与刚出现的
       * 结论行**是同一帧的一对** —— 判据②要的就是这个配对，而不是"事后拿一个持久读数配一条
       * 已经被换掉的屏"。
       */
      const installResultWatch = async (p) => await p.evaluate(`(() => {
        const w = { text: null, winner: null, frames: 0, scans: 0 };
        globalThis.__coinResultWatch = w;
        /**
         * ⚠️ **必须在 records 的 addedNodes 里找，不能查 document**（实测踩过）：
         * 进牌桌那一帧是"先补画落地帧、紧接着 rerender() 画牌桌"——同一任务里 root 被重写，
         * 而 MutationObserver 的回调在**微任务之后**才跑，那时节点**已经被换掉了** ⇒
         * document.querySelector('.coin-result-text') 恒为 null（实测：房主 frames: 0
         * 而 renderCoin 明明跑了两次）。从 record.addedNodes 里找才拿得到**那一刻**的文本。
         */
        const grabFrom = (node) => {
          if (!(node instanceof Element)) return null;
          if (node.classList && node.classList.contains('coin-result-text')) return node.textContent;
          const inner = node.querySelector ? node.querySelector('.coin-result-text') : null;
          return inner === null ? null : inner.textContent;
        };
        const note = (t) => {
          w.frames += 1;
          if (w.text !== null) return;
          w.text = t;
          const v = globalThis.__coinInputs ?? globalThis.__coinVerdict ?? null;
          w.winner = v === null || typeof v.winner !== 'number' ? null : v.winner;
        };
        const obs = new MutationObserver((records) => {
          w.scans += 1;
          for (const rec of records) {
            for (const n of rec.addedNodes) {
              const t = grabFrom(n);
              if (t !== null && t.length > 0) { note(t); return; }
            }
          }
        });
        obs.observe(document.getElementById('app'), { childList: true, subtree: true, characterData: true });
        const now = document.querySelector('.coin-result-text');
        if (now !== null && now.textContent) note(now.textContent);
        return true;
      })()`);
      await installResultWatch(host);
      await installResultWatch(guest);
      // 真鼠标点第一枚（正面）
      await guest.click('.coin-face-chip');
      /**
       * ⚠️ 它**只是诊断读数**（"屏上此刻还看不看得到结论行"），不参与判定 —— 它几乎总是
       * `false`（硬币屏是中间站）。判据②读的是上面那个观察者记下的"出现过的那一对"。
       */
      const landed = await guest.waitFor('.coin-result-text', budgetMs);
      {
        /**
         * 点完等一会儿取样（观察者已经在记了）：两端各自"第一次出现的那一对"。
         * 等的是**观察者记到**，不是"屏上此刻还在" —— 所以零点几秒就够。
         */
        const t4 = Date.now();
        while (Date.now() - t4 < Math.min(budgetMs, 8000)) {
          coinSnapHost = parseJson(await host.evaluate('JSON.stringify(globalThis.__coinResultWatch ?? null)'));
          coinSnapGuest = parseJson(await guest.evaluate('JSON.stringify(globalThis.__coinResultWatch ?? null)'));
          if (coinSnapHost !== null && coinSnapGuest !== null
            && coinSnapHost.text !== null && coinSnapGuest.text !== null) break;
          await sleep(150);
        }
        notes.push(`结论行取样（观察者记的，等了 ${String(Date.now() - t4)}ms）：`
          + `房主 ${JSON.stringify(coinSnapHost)} / 加入方 ${JSON.stringify(coinSnapGuest)}`);
        if (coinSnapHost === null || coinSnapGuest === null
          || coinSnapHost.text === null || coinSnapGuest.text === null) {
          const probePage = async (p) => parseJson(await p.evaluate(`(() => {
            const el = document.querySelector('.coin-result-text');
            return JSON.stringify({
              coinScreen: document.querySelectorAll('.coin-screen').length,
              resultText: el === null ? null : el.textContent,
              coinReady: globalThis.__coinReady === true,
              hasVerdict: globalThis.__coinVerdict !== undefined,
              draft: document.querySelectorAll('.draft-screen').length,
            });
          })()`));
          notes.push(`取样失败时的屏面：房主 ${JSON.stringify(await probePage(host))}`
            + ` / 加入方 ${JSON.stringify(await probePage(guest))}`);
        }
      }
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
      notes.push(`点完芯片之后：芯片类名 ${JSON.stringify(pickedNow)} / 相位 ${String(phaseNow)}`
        + ` / 屏上此刻的落点行 ${JSON.stringify(landed)}`);
      /**
       * ★★ **T11-C：判据从"读屏上的此刻"换成"读那一帧的记账位"**（判定口径的替换，**不是放宽**：
       * 下面那句仍然是"落点必须算出来过"，而且是**同一条**判据）。
       *
       * T11-B 时硬币屏是**终点**：落点到手之后它一直留在屏上，所以读 `.coin-result-text` 是稳的。
       * T11-C 把它变成**中间站**：两端一 ready 就立刻进草稿 ⇒ 那块屏连同落点这一行会被
       * `.draft-screen` **换掉**。实测（2026-09-19，本工具，第一版 21/26，其中一条就是这里）：
       * `点完芯片之后：芯片类名 [] / 相位 null / 落点 false` —— 屏在三次轮询内就换掉了，
       * 于是"点后没有落点"看起来是红的，其实落点**算出来过**（记账位里 `landed=2`）。
       *
       * 现在读 `globalThis.__coinInputs`（`lobbyCoinViewOf()` 在"胜负依据齐了"那一帧写下的
       * 四个读数 + 落点）：它记的是**发生过的事**，不会因为屏被换掉而消失。
       * 屏面那一半（两端落点文案里的座位号）仍是 T11-B 那几条腿钉的，本段一个字没动 ——
       * 那块屏在联机下是**中间站**，读到它需要抢在进牌桌之前（T11-B 的腿用的是假传输、
       * 没有"进牌桌"这一步，所以那几条腿不受影响）。
       */
      const readyGuest = (await guest.evaluate('String(globalThis.__coinReady ?? false)')) === 'true';
      const gObj2 = parseJson(await guest.evaluate('JSON.stringify(globalThis.__coinInputs ?? null)'));
      push(readyGuest && gObj2 !== null && typeof gObj2.landed === 'number',
        readyGuest && gObj2 !== null
          ? `点完芯片之后落点算出来了：掷出 ${String(gObj2.landed)}（读数由那一帧的记账位给出；`
            + '屏此时可能已经让位给草稿屏了）'
          : '点了芯片之后加入方**始终**没有算出落点（`__coinInputs` 一直是空的 ⇒ 握手没有继续）');
      if (landed) {
        notes.push('加入方屏上还看得到落点行（这一格的两条判据已挪到 ③.6，见那里的"判据②"）');
      }
      // ★ T11-C：硬币屏被换掉之后 `phaseOfSide()` 读不到任何东西（两块屏都不在），
      //   而那正是"走完了"的形态 ⇒ 屏不在就当"不在等"。
      const t2 = Date.now();
      let gPhase2 = await phaseOfSide(guest);
      while (Date.now() - t2 < budgetMs) {
        gPhase2 = await phaseOfSide(guest);
        if (gPhase2 === 'complete' || (await guest.count('.coin-screen')) === 0) break;
        await sleep(500);
      }
      const gCoinGone = (await guest.count('.coin-screen')) === 0;
      const movedOn = gCoinGone || (gPhase2 !== null && gPhase2 !== 'awaiting-commit-ack'
        && gPhase2 !== 'awaiting-commit' && gPhase2 !== 'handshaking');
      push(movedOn, movedOn
        ? `点完芯片之后握手继续走（加入方相位 ${String(gPhase2)}${gCoinGone ? '，硬币屏已经让位' : ''}）`
        : `点完芯片之后加入方仍停在 ${String(gPhase2)}（叫面没有解锁握手）`);
      notes.push(`硬币屏实测：房主 ${hostCoin ? '有' : '无'} / 加入方 ${guestCoin ? '有' : '无'}，`
        + `点前落点 ${JSON.stringify(preResult)}，点后相位 ${String(gPhase2)}，`
        + `点后硬币屏还在=${!gCoinGone}，__coinInputs=${JSON.stringify(gObj2)}`);
    } else {
      push(false, '未到达：加入方屏上没有硬币屏 ⇒ 后面几条（点前无落点 / 点后继续）都到不了');
    }
  }
  say('');

  /* ── ③.6 握手完 ⇒ 两端真的进草稿（G5 T11-C 判据 1/3）──────────────────── */
  say('=== ③.6 进牌桌：两端都进草稿 + 两端状态指纹相等（T11-C）===');
  let hMatch = null;
  let gMatch = null;
  let gEndDraft = null;
  let hEndDraft = null;
  let hReboot = null;
  let gReboot = null;
  let hVerdict = null;
  let gVerdict = null;
  let draftAdmitted = false;
  if (answerCode === null) {
    push(false, '未到达：握手没推进（③不通过）⇒ 进牌桌那几条也没到');
  } else {
    /**
     * ★★ **等待判据：两端各自的 `__g5Match` 都在、种子相同、`.draft-screen` 都在。**
     *
     * 为什么等这三样而不是等"屏上出现某个类"：进牌桌是**两端各自**由 `enterNetGame()` 触发的
     * （没有服务器告诉它们"该开始了"），所以"都进去了"这件事只能在两端各读一次再比。
     * 拿屏面当唯一判据会漏掉"一端进去了、另一端还停在硬币屏上"（那正是 T11-C 要抓的形态）。
     */
    const t0 = Date.now();
    while (Date.now() - t0 < budgetMs) {
      hMatch = await matchOf(host);
      gMatch = await matchOf(guest);
      // 顺带把"这段读数 → 喂进 createGame 的那两个数"也读下来
      // （`__g5Handoff`，见下面那条"先选者必须是硬币算出来的那一个"）。
      // ⚠️ 两端**都要**读它：`__coinInputs` 只有**叫面方那一支**会写（T11-B 的实现），
      //    房主那一侧恒为 `null` —— 实测（2026-09-19）：拿 `__coinInputs` 当对照物时
      //    房主那半边永远是 `null`，那一条当场变红。
      hVerdict = parseJson(await host.evaluate('JSON.stringify(globalThis.__g5Handoff ?? null)'));
      gVerdict = parseJson(await guest.evaluate('JSON.stringify(globalThis.__g5Handoff ?? null)'));
      draftAdmitted = hMatch !== null && gMatch !== null
        && hMatch.seed === gMatch.seed
        && hMatch.draftStarter === gMatch.draftStarter;
      if (draftAdmitted && hVerdict !== null && gVerdict !== null) break;
      await sleep(300);
    }
    const hDraft = await host.count('.draft-screen');
    const gDraft = await guest.count('.draft-screen');
    const hSeedHint = await host.text('.coin-result-text');
    const gSeedHint = await guest.text('.coin-result-text');
    notes.push(`进牌桌读数：房主 ${JSON.stringify(hMatch)}（.draft-screen=${hDraft}，硬币屏残留=${JSON.stringify(hSeedHint)}）`
      + ` / 加入方 ${JSON.stringify(gMatch)}（.draft-screen=${gDraft}，硬币屏残留=${JSON.stringify(gSeedHint)}）`);
    push(hDraft > 0 && gDraft > 0, hDraft > 0 && gDraft > 0
      ? '两端屏上都出现了草稿屏（`.draft-screen`）'
      : `草稿屏没出现：房主 ${hDraft} 个 / 加入方 ${gDraft} 个（进牌桌那一步没有在两端都发生）`);
    push(draftAdmitted, draftAdmitted
      ? `两端都进了同一局：种子 ${String(hMatch && hMatch.seed)}、先选协议者 ${String(hMatch && hMatch.draftStarter)}`
      : `两端没有进到同一局：房主 ${JSON.stringify(hMatch)} / 加入方 ${JSON.stringify(gMatch)}`);
    const sameFp = draftAdmitted && hMatch.fp === gMatch.fp;
    push(sameFp, sameFp
      ? `两端状态指纹相等：${hMatch.fp}（各 ${hMatch.chars} 字符的规范串）`
      : `两端状态指纹不同：房主 ${String(hMatch && hMatch.fp)} / 加入方 ${String(gMatch && gMatch.fp)}`);
    // 反空转：两个指纹必须不是"都没算"（`null` 的 `null === null` 会让上一条假绿）
    push(hMatch !== null && gMatch !== null, hMatch !== null && gMatch !== null
      ? '两端的读数口都在（上面那两条不是在比两个 null）'
      : '有一端的 `__g5Match` 读不到（页面没带 #g5probe=1？）');
    /**
     * ★★ **先选协议者必须是硬币算出来的那一个**（判据 3 的"值"那一半）。
     *
     * 为什么必须有这一条（镜像实测，2026-09-19）：上面那几条比的都是**两端是否一致**，
     * 而"两端一致地算错"它是看不见的 —— 变异 M1（把喂给 `createGame` 的 `draftStarter`
     * 取反）跑了两轮浏览器门**都 27/27 通过**（两次报出的先选者一次 1、一次 0），
     * 而节点腿也照样全绿（它测的是自己复刻的那几行）。
     *
     * 对照物是 `__g5Handoff`（`enterNetGame()` 把 `handoff()` 的结果与**真正喂进 `createGame`
     * 的那两个数**一起留下的那一份）：两端的 `draftStarter` 都必须等于各自 `handoff()` 里
     * 由硬币算出来的那一个。
     */
    const verdictMatches = hVerdict !== null && gVerdict !== null
      && typeof hVerdict.draftStarter === 'number' && typeof gVerdict.draftStarter === 'number'
      && hVerdict.seed === gVerdict.seed
      && hMatch !== null && gMatch !== null
      && hMatch.draftStarter === hVerdict.draftStarter
      && gMatch.draftStarter === gVerdict.draftStarter
      && hVerdict.draftStarter === gVerdict.draftStarter;
    push(verdictMatches, verdictMatches
      ? `两端喂进 createGame 的 draftStarter 都等于硬币交出来的先选者 ${String(hVerdict && hVerdict.draftStarter)}`
        + `（叫面者座位 ${String(hVerdict && hVerdict.caller)}、叫的面 ${String(hVerdict && hVerdict.chosen)}、`
        + `落点 ${String(hVerdict && hVerdict.landed)}）`
      : `先选者对不上：握手交出来的是 房主 ${String(hVerdict && hVerdict.draftStarter)} / 加入方 ${String(gVerdict && gVerdict.draftStarter)}，`
        + `实际喂进 createGame 的是 房主 ${String(hMatch && hMatch.draftStarter)} / 加入方 ${String(gMatch && gMatch.draftStarter)}`);
    /**
     * ★★ **硬币那一帧的四个读数两端逐个相同**（T11-B 的跨端判据；T11-C 挪到这一格）。
     *
     * 为什么挪：那两条原来住在 ③.5 的 `if (landed)` 里 —— 而"加入方屏上还读得到落点行"
     * 在 T11-C 之后是**偶然**的（硬币屏是中间站，两端一 ready 就进草稿屏）⇒ 那两条
     * 有时**根本不跑**（判定条数 39 / 41 抖动），而那正是评审看到的"门不确定"之一。
     * 挪到 ③.6 之后它们**每次都在**，读数还是那两个持久来源（`__coinInputs` /
     * `__coinVerdict`，见 `coinVerdictOf`）。
     *
     * ⚠️ 必须**在 `enterNetGame` 已经跑过之后**读才稳：`__coinVerdict` 就是它在那一格写的。
     */
    const hV = await coinVerdictOf(host);
    const gV = await coinVerdictOf(guest);
    const readingsSame = hV !== null && gV !== null
      && hV.caller === gV.caller && hV.chosen === gV.chosen
      && hV.landed === gV.landed && hV.winner === gV.winner;
    push(readingsSame, readingsSame
      ? `硬币那一帧的四个读数两端逐个相同：caller=${String(hV.caller)} chosen=${String(hV.chosen)}`
        + ` landed=${String(hV.landed)} winner=${String(hV.winner)}`
      : `两端的硬币读数不同：房主 ${JSON.stringify(hV)} / 加入方 ${JSON.stringify(gV)}`);
    notes.push(`硬币读数（③.6 这一格读的）：房主 ${JSON.stringify(hV)} / 加入方 ${JSON.stringify(gV)}`);
    /**
     * ★★ **判据②：`coin-result-text` 里那个「玩家 N」== 各自 `winner + 1`**（两端都判）。
     *
     * ## 它被删过一次，现在补回来（评审 R2 §8 遗留 1）
     *
     * 上一轮我把 ③.5 `if (landed)` 里的两条一起搬走，实际只搬走①（四个读数两端逐个相同），
     * **②被删掉了**；删的理由只写在注释里，而报告写成了"文案与读数改成同一次求值"——
     * 那句不成立（全仓 `snapshotOf` 只在 `tests/net/session.test.ts`）。**这是覆盖面被悄悄
     * 收窄**，协调者不接受 ⇒ 补回来，而且放在**会真的跑到的地方**。
     *
     * ## 取样在 ③.5 点完芯片之后（`coinSnapHost` / `coinSnapGuest`），判定在这一格
     *
     * 放在 ③.5 取样是因为**那是唯一的窗口**：点完之后两端一路走到 `complete` 就进草稿屏，
     * `.coin-result-text` 会被换掉（实测：在 ③.6 读两次都是 `text: null`，而 `__coinVerdict`
     * 两端都在）。判定放在 ③.6（每次都会走到）是为了**条数恒定、且不静默跳过**。
     *
     * ## 与"原来那条"的差别（说清楚，免得被读成换了个写法）
     *
     * 原来读"点完那一刻的 `.coin-result-text`"、读到 `null` 就整条不判；现在**同一时刻**把
     * 读数与结论行一起取回，并且**把"读不到"也写成一条判据**（不再是静默跳过）。
     * 判据本身不放宽：读到了就必须 `座位 === winner + 1` 且两端一致。
     */
    const resultSeatOf = (line) => {
      const m = /玩家\s*(\d+)\s*先选协议/.exec(line ?? '');
      return m === null ? null : Number(m[1]);
    };
    const hS = coinSnapHost === null ? null : resultSeatOf(coinSnapHost.text);
    const gS = coinSnapGuest === null ? null : resultSeatOf(coinSnapGuest.text);
    const hW = coinSnapHost === null ? null : coinSnapHost.winner;
    const gW = coinSnapGuest === null ? null : coinSnapGuest.winner;
    const resultSeen = hS !== null && gS !== null && hW !== null && gW !== null;
    const textMatches = resultSeen && hS === hW + 1 && gS === gW + 1 && hS === gS;
    push(textMatches, textMatches
      ? `两端文案说的是同一个全局座位号：玩家 ${String(hS)} 先选协议（各自 winner=${String(hW)} / ${String(gW)}）`
      : resultSeen
        ? `文案与读数对不上：房主文案 ${JSON.stringify(coinSnapHost.text)}（座位 ${String(hS)}，winner=${String(hW)}）`
          + ` / 加入方文案 ${JSON.stringify(coinSnapGuest.text)}（座位 ${String(gS)}，winner=${String(gW)}）`
        : `这一格没取到结论行（房主 ${JSON.stringify(coinSnapHost && coinSnapHost.text)}`
          + ` / 加入方 ${JSON.stringify(coinSnapGuest && coinSnapGuest.text)}）⇒ 判据②不成立`);
    notes.push(`结论行快照（③.6 判的）：房主 ${JSON.stringify(coinSnapHost)} / 加入方 ${JSON.stringify(coinSnapGuest)}`);
  }
  say('');

  /* ── ③.7 真的选一步协议（判据 3）────────────────────────────────────── */
  say('=== ③.7 真的选一步协议：先选者那一侧在池子里拖一张卡（真鼠标）===');
  let stepOk = false;
  let firstPicker = null;
  if (!draftAdmitted) {
    push(false, '未到达：两端没进同一局（③.6 不通过）⇒ 选协议那几条也没到');
  } else {
    // 谁先选：状态里那个数（两端相同，上面已经比过）
    const starterSeat = Number(hMatch.draftStarter);
    // 座位 -> 哪一页：`__g5Match` 不带座位，用草稿屏横幅上那句「玩家 N」反推（N-1 = 座位）
    const hScreen = await draftScreenOf(host);
    const gScreen = await draftScreenOf(guest);
    notes.push(`草稿屏读数：房主 ${JSON.stringify(hScreen)} / 加入方 ${JSON.stringify(gScreen)}`);
    firstPicker = hScreen !== null && hScreen.drafter === starterSeat ? host
      : (gScreen !== null && gScreen.drafter === starterSeat ? guest : null);
    push(firstPicker !== null, firstPicker !== null
      ? `找出了先选协议的那一页（座位 ${starterSeat}，房主屏 drafter=${String(hScreen && hScreen.drafter)}`
        + ` / 加入方屏 drafter=${String(gScreen && gScreen.drafter)}）`
      : `两端屏上都读不出"轮到谁选"（房主 ${JSON.stringify(hScreen)} / 加入方 ${JSON.stringify(gScreen)}）`);
    if (firstPicker !== null) {
      const label = firstPicker === host ? '房主' : '加入方';
      const other = firstPicker === host ? guest : host;
      const before = await matchOf(firstPicker);
      const otherBefore = await matchOf(other);
      // 拖拽：从池子里第一张卡拖到**先选者那一侧**的选择框（`.draft-picks.pN`）
      const from = await centerOf(firstPicker, '.draft-card');
      const to = await centerOf(firstPicker, `.draft-picks.p${starterSeat + 1}`);
      if (from === null || to === null) {
        push(false, `找不到可拖的卡或目标选择框（卡 ${JSON.stringify(from)} / 框 ${JSON.stringify(to)}）`);
      } else {
        await drag(firstPicker.send, label, from, to);
        // 等读数变（`draftRound` 加一）—— 只等 DOM 会读到重画前的那一帧
        const t1 = Date.now();
        let after = null;
        while (Date.now() - t1 < budgetMs) {
          after = await matchOf(firstPicker);
          if (after !== null && before !== null && after.draftRound === before.draftRound + 1) break;
          await sleep(300);
        }
        const picked = after !== null && before !== null && after.draftRound === before.draftRound + 1;
        push(picked, picked
          ? `${label}真的选中了一张协议（草稿轮次 ${before.draftRound} -> ${after.draftRound}，`
            + `状态指纹 ${before.fp} -> ${after.fp}）`
          : `${label}的拖拽没有选中任何协议（草稿轮次 ${String(before && before.draftRound)}`
            + ` -> ${String(after && after.draftRound)}）`);
        // 反空转：选中的那一侧状态**必须真的变了**（指纹不同）
        push(picked && after.fp !== before.fp, picked && after.fp !== before.fp
          ? '选中之后那一侧的状态指纹变了（不是"点了但状态没动"）'
          : `拖拽之后状态指纹没变：${String(before && before.fp)} -> ${String(after && after.fp)}`);
        /**
         * ★ **没选的那一侧不许动**（草稿动作今天不走线上，见报告里的缺口登记）。
         *
         * 这一条把"选协议是本地发生的"这件事**如实钉住**：它的状态必须与拖拽之前**逐字相同**。
         * 如果它变了，说明草稿动作被同步过去了（那是下一段的事）；如果它"变了但两端指纹随后相等"，
         * 那才是真正的分叉风险。
         */
        const otherAfter = await matchOf(other);
        const otherUntouched = otherAfter !== null && otherBefore !== null && otherAfter.fp === otherBefore.fp;
        push(otherUntouched, otherUntouched
          ? `没选的那一侧状态一字未动（指纹仍 ${String(otherBefore && otherBefore.fp)}）—— 草稿动作今天不走线上`
          : `没选的那一侧状态变了：${String(otherBefore && otherBefore.fp)} -> ${String(otherAfter && otherAfter.fp)}`);
        stepOk = picked;
      }
    }
  }
  say('');

  /* ── ③.8 同一起始状态 + 各自确定性重演 ⇒ 结果逐字相等（**不是**跨端同步）────────── */
  say('=== ③.8 同一起始状态 + 各自确定性重演：两端独立走完六次 ⇒ 结果逐字相等（判据 3 未达成）===');
  if (!stepOk) {
    push(false, '未到达：上一步没真的选中（③.7 不通过）⇒ 收口那条也没到');
  } else {
    /**
     * ★★ **这一格证的是"同一起始状态 + 各自确定性重演"，不是"跨端同步"**（评审 §2 的收口）。
     *
     * ## 为什么不能写成判据 3 原文那条
     *
     * 任务书判据 3 写的是"进草稿后两端各走一步真实选协议 ⇒ 两端状态指纹相等"。**今天做不到**：
     * 草稿动作（`performDraftPick`）**不在驱动的 `ActionKind` 里**（`src/core/game.ts:22`
     * 那张表只有对局动作），协议里也没有草稿报文 ⇒ 一次本地选择**只改本端状态**。
     * 实测（2026-09-19，本工具第一版）：拖过一次之后
     * `房主 {"picks":1,"drafter":1} / 加入方 {"picks":0,"drafter":0}` —— 两端各自停在自己的
     * 草稿上，于是"轮次对不上"是**必然**的，不是竞态。⇒ **判据 3 未达成**，这条缺口登记在报告里。
     *
     * ## 所以这一格改成什么（以及它**能**证明什么）
     *
     * 两端**各自**从同一局出发、各自独立走完六次本地选牌 ⇒ 结果状态**逐字相等**。
     * 能证的：`同一种子 + 同一 draftStarter ⇒ 两端算的是同一局`（轮选顺序由 `draftStarter` 派生、
     * 池子由 `seed` 派生 ⇒ 六个 `defId` 相同、分配相同、洗牌相同），且这**不是**两端在同步 ——
     * 两个 Chrome 是独立进程，相等只可能来自"同一局 + 同一条确定性序列"。
     * **不能证**的：任何跨端传播。跨端传播那一条由 ③.9（对局相的 `act` 帧）负责。
     *
     * 顺带：③.7 已经用真鼠标证明"没选的那一侧一字未动"—— 那正是"草稿不走线上"的直接读数。
     *
     * 走草稿用的是 `__g5Match.finishDraft()`（**不重开对局、不动驱动、不碰传输**）：
     * 它调的就是拖拽落点那一句调的同一个 `cb.onDraftPick`（`src/ui/render.ts:4679`）
     * —— 不是第二套实现。③.7 已经用真鼠标钉过那条回调能通。
     *
     * ## ⚠️ 为什么**不能**用 `rebootDraft()` 来"回到起点"（实测踩过，值得写下来）
     *
     * 第一版用的是 `rebootDraft()`（它 `driver.dispose()` 之后重新 `enterNetGame()`）。
     * 但 `dispose()` 会 **`transport.close()`**（`src/net/net-driver.ts:784`）⇒ 握手那条
     * 链路被关掉 ⇒ ③.9 里**每一个** `submit` 都拿到 `'offline'`（实测
     * `submit ok=false refusal=offline`，而 `lastFailure()` 是 `null` —— 不报错的失效）。
     * ⇒ "重来一局再走线上"这条路在同一局内**不存在**；`finishDraft()` 才是这一格要的。
     */
    hReboot = parseJson(await host.evaluate('JSON.stringify(globalThis.__g5Match ? globalThis.__g5Match.finishDraft() : null)'));
    gReboot = parseJson(await guest.evaluate('JSON.stringify(globalThis.__g5Match ? globalThis.__g5Match.finishDraft() : null)'));
    const hSteps = hReboot === null ? -1 : Number(hReboot.steps);
    const gSteps = gReboot === null ? -1 : Number(gReboot.steps);
    // ③.7 已经在先选那一侧真鼠标选过一次 ⇒ 它这边只剩 5 步，另一侧仍是 6 步。
    // 断言写成"**步数不同、但两边都到达了 `draftRound 6`**"（那才是不变量）。
    push(hSteps >= 0 && gSteps >= 0 && hSteps !== gSteps, hSteps >= 0 && gSteps >= 0
      ? `两端各自把本机剩下的草稿选完（房主 ${hSteps} 步 / 加入方 ${gSteps} 步；`
        + `差 1 步 = ③.7 真鼠标选过的那一次只落在其中一侧）`
      : `有一端没走完：房主 ${hSteps} 步 / 加入方 ${gSteps} 步`);
    const hStr = hReboot === null ? null : String(hReboot.state);
    const gStr = gReboot === null ? null : String(gReboot.state);
    const literalEq = typeof hStr === 'string' && hStr.length > 0 && hStr === gStr;
    // ⚠️ 它比的是"**各自重演**的终态相同"（⇒ 两端算的是同一局），**不是**"选牌同步到对端"。
    push(literalEq, literalEq
      ? `两端各自重演六个本地选择的终态**逐字相同**（各 ${hStr.length} 字符，指纹 ${hash32(hStr)}）`
      : `两端重演的终态不同：房主 ${String(hStr && hStr.length)} 字符（${hStr === null ? 'null' : hash32(hStr)}）`
        + ` / 加入方 ${String(gStr && gStr.length)} 字符（${gStr === null ? 'null' : hash32(gStr)}）`);
    hEndDraft = await matchOf(host);
    gEndDraft = await matchOf(guest);
    const inTurn = hEndDraft !== null && gEndDraft !== null && hEndDraft.draftRound >= 6 && gEndDraft.draftRound >= 6;
    push(inTurn, inTurn
      ? `两端都进了对局相（草稿轮次 ${hEndDraft.draftRound} / ${gEndDraft.draftRound}）`
      : `还有一端停在草稿：轮次 ${String(hEndDraft && hEndDraft.draftRound)} / ${String(gEndDraft && gEndDraft.draftRound)}`);
    // 屏面那一半：两端都**离开**草稿页（进了对局相）
    /**
     * ⚠️ 必须**轮询**而不是读一次：草稿完成那一格会先画"六张全选"的最终草稿页、再播过渡动画，
     * 之后才画牌桌（`main.ts` 的 `cb.onDraftPick` → `playDraftToGameTransition()`）。
     * 实测（2026-09-19，本工具，第二版 25/28）：走完草稿之后立刻读，两端都还挂着
     * `.draft-screen`（而状态已经是 `turn`）—— 那一条是**读早了**，不是缺陷。
     */
    const tS = Date.now();
    let hTurn = await host.count('.draft-screen');
    let gTurn = await guest.count('.draft-screen');
    while ((hTurn > 0 || gTurn > 0) && Date.now() - tS < budgetMs) {
      await sleep(400);
      hTurn = await host.count('.draft-screen');
      gTurn = await guest.count('.draft-screen');
    }
    push(hTurn === 0 && gTurn === 0, hTurn === 0 && gTurn === 0
      ? '两端都离开了草稿屏（六次选完 ⇒ 进对局相）'
      : `还有一页停在草稿屏：房主 ${hTurn} 个 / 加入方 ${gTurn} 个（等了 ${String(Date.now() - tS)}ms）`);
    notes.push(`走完草稿：房主 ${JSON.stringify(hEndDraft)} / 加入方 ${JSON.stringify(gEndDraft)}，`
      + `规范串逐字相同=${literalEq}`);
  }
  say('');
  /* ── ③.9 真的打一步对局动作（`createNetDriver` 在真浏览器里**唯一承重**的行为腿）──── */
  say('=== ③.9 走一步真对局动作：一端提交、另一端靠那一帧跟上（座位 + 锁步驱动）===');
  if (!stepOk || hReboot === null || gReboot === null
    || hEndDraft === null || gEndDraft === null || hEndDraft.draftRound < 6 || gEndDraft.draftRound < 6) {
    push(false, '未到达：草稿没走完（③.8 不通过）⇒ 对局动作那条也没到');
  } else {
    /**
     * ★★ **这一条是 `createNetDriver` 在真浏览器里唯一**承重**的行为腿**。
     *
     * ## 为什么 ③.6~③.8 全绿还不够
     *
     * 那三条都停在**草稿相**，而草稿动作**根本不经过驱动**（它不在 `ActionKind` 里）。
     * 于是"驱动接线是否真的在工作"在那几条上**完全没有承重**。
     *
     * ## ★★ 为什么必须先**关掉本机自动推进**（评审阻断项 3 的第二条）
     *
     * 原来这一格只比"对端指纹跟上了"，而两端**各自**每 400ms 会
     * `cb.onAction({kind:'advance'})` 自行推进一格 ⇒ 即使那一帧根本没送到对端，
     * 对端的指纹也会**自己走到同一个地方**。评审实测（2026-09-19，M2-wiring：
     * 保留 `createNetDriver(...)` 那一行、只把交给 `driver` 的对象换成本地驱动）
     * 在旧判据下 **33/33 全绿** ⇒ 那一格的"对端跟上"**不承重**。
     *
     * 修法：进这一格先在两页上 `__g5Match.noAutoAdvance()`（`main.ts` 里一个布尔，
     * 只关 `scheduleAutoAdvance` 这一条本地时序，不动驱动、不动玩家输入）。
     * 关掉之后，**对端的状态只可能因为收到那一帧而变** ⇒ 这一格才有牙。
     *
     * ## 判据（四样）
     *
     *  1. **座位**：两页各自"自己以为的座位"必须**不同**，且**轮到的那一位就是提交方**
     *     （评审 M2-seat：把 `createNetDriver` 的 `seat` 取反 ⇒ 旧判据 33/33 全绿，座位写错无门可查）；
     *  2. 提交之后**提交方**的状态真的变了（指纹不同 ⇒ 不是空转）；
     *  3. **对端**的状态随后变成与提交方**逐字相同**（关掉自动推进之后 ⇒ 只能来自那一帧）；
     *  4. 两端的规范串**逐字相等**。
     *
     * ## ⚠️ 它**不是** `arm(state)` 的判别腿（实测结论，别再往上加戏）
     *
     * 镜像实测（2026-09-19）：把 `enterNetGame()` 里那句 `netDriver.arm(state)` 删掉
     * （变异 M4），这一格**照样绿**。原因在**实现里那条冗余路径**：`onInbound` 收到帧就
     * `rerender()`，而重画会走 `scheduleAutoAdvance()` → `cb.onAction` → `driver.submit`，
     * 而 `submit` 内部第一件事就是 `drain(s)`（`src/net/net-driver.ts:704`）⇒ 队列照样排空。
     * ⇒ M4 由**两条腿**钉住：`tests/ui/coin-screen-net.test.ts` 的源码腿 与
     * `tests/ui/net-lobby-handoff.test.ts` 的驱动行为腿（不给对端 `arm` ⇒ 帧留在队列里）。
     *
     * ## 谁提交、提交什么
     *
     * 提交方是**轮到的那一位**（`liveTurn`：`submit` 会拒掉不是本端的操作）。
     * 动作是"点自己手牌第一张"（远程页没有通用推进按钮）。
     */
    // ★ 自动推进**暂时不关**：要先靠它把"轮到的那一位"推到 `step === 'action'`（见下）
    const hNow = await matchOf(host);
    const gNow = await matchOf(guest);
    // ★ 座位读数走 `__g5Match.seat()`（它就是 `createNetDriver` 拿到的那个数），
    //   `__g5Handoff.seat` 作兜底 —— 两者不同就说明"交出去的"与"驱动吃到的"不是一个数。
    const seatOf = {
      host: parseJson(await host.evaluate('JSON.stringify(globalThis.__g5Handoff ?? null)')),
      guest: parseJson(await guest.evaluate('JSON.stringify(globalThis.__g5Handoff ?? null)')),
    };
    const driverSeatOf = async (page) => Number(await page.evaluate('globalThis.__g5Match ? globalThis.__g5Match.seat() : -1'));
    const hDriverSeat = await driverSeatOf(host);
    const gDriverSeat = await driverSeatOf(guest);
    const hSeat = hDriverSeat >= 0 ? hDriverSeat : (seatOf.host === null ? null : Number(seatOf.host.seat));
    const gSeat = gDriverSeat >= 0 ? gDriverSeat : (seatOf.guest === null ? null : Number(seatOf.guest.seat));
    /**
     * ★★ **座位腿**（评审 M2-seat 的落点）：**驱动吃到的座位**必须等于 `handoff()`
     * **不做任何加工**交出来的那一个。三处读数：`__g5Match.seat()`（驱动自己的）、
     * `__g5Handoff.driverSeat`（同一件事的另一个口）、`__g5Handoff.handSeat`（原样那一个）。
     *
     * ⚠️ 第一版比的是 `__g5Handoff.seat` —— 而那个字段**本身**就是"喂进去的值"，
     * 于是"把 `seat` 取反"的变异会让两边**一起**变、比出来仍然相等（实测：那一条全绿，
     * 真正红的是下面"一步都没走出去"）。现在比的是"**加工前后**是否一致"。
     */
    const hHandSeat = seatOf.host === null ? null : seatOf.host.handSeat;
    const gHandSeat = seatOf.guest === null ? null : seatOf.guest.handSeat;
    const seatUnprocessed = typeof hHandSeat === 'number' && typeof gHandSeat === 'number'
      && hDriverSeat === hHandSeat && gDriverSeat === gHandSeat
      && seatOf.host.driverSeat === hHandSeat && seatOf.guest.driverSeat === gHandSeat;
    push(seatUnprocessed, seatUnprocessed
      ? `驱动吃到的座位就是 handoff() 原样交出来的那一个：房主 ${String(hDriverSeat)} / 加入方 ${String(gDriverSeat)}`
      : `座位被加工过：驱动吃到 房主 ${String(hDriverSeat)} / 加入方 ${String(gDriverSeat)}，`
        + `而 handoff() 原样交出来的是 房主 ${String(hHandSeat)} / 加入方 ${String(gHandSeat)}`);
    /**
     * ★ 再钉一条：喂进 `createNetDriver` 的那个数**与 `handoff()` 原样交出来的**是同一个。
     * ⚠️ 能力边界（实测 M2-seat）：把 `seat` 取反时**这四个读数一起变**（它们同源），
     * 所以这一条**绿**；真正抓住它的是**下面那条走不动**（`advanceOnce()` 一直 `not-my-turn`，
     * 因为 `turnPlayer` 与被打错的 `selfSeat` 对不上）。⇒ 座位这件事的硬钉子在 node 面
     * （`net-lobby-handoff.test.ts` 比 `driver.seat === handoff().seat` 与"反向驱动必须被拒"）
     * 与源码腿（`coin-screen-net.test.ts` 要求那串字面量）。
     */
    const seatConsistent = hHandSeat !== null && gHandSeat !== null
      && Number(seatOf.host.seat) === hHandSeat && Number(seatOf.guest.seat) === gHandSeat;
    push(seatConsistent, seatConsistent
      ? `座位读数三处一致（房主 ${String(hDriverSeat)} / 加入方 ${String(gDriverSeat)}）`
      : `座位读数不一致：房主 ${String(seatOf.host && seatOf.host.seat)} vs ${String(hHandSeat)}`
        + ` / 加入方 ${String(seatOf.guest && seatOf.guest.seat)} vs ${String(gHandSeat)}`);
    // 两端的"该谁动"必须一致（同一个状态 ⇒ 同一个 turnPlayer）
    const turnOf = async (page) => parseJson(
      await page.evaluate('JSON.stringify(globalThis.__g5Match ? globalThis.__g5Match.turn() : null)'),
    );
    const hTurnInfo = await turnOf(host);
    const gTurnInfo = await turnOf(guest);
    const sameTurn = hTurnInfo !== null && gTurnInfo !== null
      && hTurnInfo.turnPlayer === gTurnInfo.turnPlayer && hTurnInfo.phase === gTurnInfo.phase;
    push(sameTurn, sameTurn
      ? `两端对局相一致：phase=${hTurnInfo.phase} step=${hTurnInfo.step} turnPlayer=${hTurnInfo.turnPlayer}`
      : `两端的对局相/turnPlayer 不一致：房主 ${JSON.stringify(hTurnInfo)} / 加入方 ${JSON.stringify(gTurnInfo)}`);
    /**
     * ★★ **座位腿**（评审 M2-seat 的落点）：两页各自"自己以为的座位"必须**不同**，
     * 且**轮到的那一位正是提交方** —— 座位写错时这一条必然红。
     *
     * 为什么旧判据看不见座位写错：座位只影响"谁该动"（`liveTurn`），而两端各自的
     * 400ms 自动推进会把状态推成一样 ⇒ 指纹照样相等。关了自动推进之后，座位错的那些
     * 页面根本不会去提交（`submit` 会拒），于是"提交方是轮到的那位"这条就把它抓出来了。
     */
    const seatsDistinct = hSeat !== null && gSeat !== null && hSeat !== gSeat;
    push(seatsDistinct, seatsDistinct
      ? `两页各自的座位不同：房主 ${String(hSeat)} / 加入方 ${String(gSeat)}`
      : `两页的座位相同或读不到：房主 ${String(hSeat)} / 加入方 ${String(gSeat)}（写错座位时正是这个形状）`);
    const turnSeatKnown = hTurnInfo !== null && gTurnInfo !== null
      && (hTurnInfo.turnPlayer === hSeat || hTurnInfo.turnPlayer === gSeat);
    push(turnSeatKnown, turnSeatKnown
      ? `轮到的座位（${String(hTurnInfo && hTurnInfo.turnPlayer)}）就是两页之一：房主 ${String(hSeat)} / 加入方 ${String(gSeat)}`
      : `轮到的座位不是两页任何一个：turnPlayer=${String(hTurnInfo && hTurnInfo.turnPlayer)}`);
    const submitter = hTurnInfo !== null && hSeat !== null && hTurnInfo.turnPlayer === hSeat ? host : guest;
    const submitterLabel = submitter === host ? '房主' : '加入方';
    const peer = submitter === host ? guest : host;
    /**
     * ★★ **一步一步走（每一帧都要求"对端跟上"）—— 判据不再靠自动推进。**
     *
     * ## 为什么不能"点一张牌然后等两端指纹相等"（评审阻断项 3 的第二条）
     *
     * 两端**各自**每 400ms 会 `cb.onAction({kind:'advance'})` 自行推进一格 ⇒ 即使那一帧
     * 根本没送到对端，对端的指纹也会**自己走到同一个地方**。评审实测（M2-wiring：
     * 保留 `createNetDriver(...)` 那一行、只把交给 `driver` 的对象换成本地驱动）
     * 在旧判据下 **33/33 全绿** ⇒ 那一格不承重。
     *
     * ## 现在的判据（四样，都不靠计时器）
     *
     *  1. **座位**：驱动吃到的座位与 `handoff()` 交给它的是同一个数、且两页**不同**
     *     （评审 M2-seat：座位取反时旧判据 33/33 全绿）；
     *  2. 两页的自动推进**关掉**（`setAutoAdvance(false)`）⇒ 状态不会自己动；
     *  3. 由门禁**一步一步**调 `advanceOnce()`（它走的是**真的**那条编排：
     *     `runAutoAdvance()` → `cb.onAction` → `driver.submit`，座位与轮次的闸门都在）
     *     ⇒ 每一步之后**对端必须逐字跟上**（否则就是那一帧没过去）；
     *  4. 提交方每一步的 `applied` 都必须**涨**（帧真的发出去了），且两端队列为 0。
     *
     * ⚠️ 第 3 条是"**每一步都比**"而不是"最后比一次"：一次走多步时，某一步丢了、
     * 后面的自动收殓可能把终态抹平（旧判据栽的正是这个）。逐步比之后，
     * 丢任何一帧都会当场红。
     *
     * ## 为什么不是"点手牌"
     *
     * 远程页没有通用推进按钮，而"点手牌"只在 `step === 'action'` 时才有意义（实测踩过：
     * 刚进对局相时 `step === 'start'`，点手牌什么都不改 ⇒ 那条会红在"动作挑错了时机"上）。
     * `advanceOnce()` 把开局那几步走完，动作面本身（选线、特效）不在本段面内。
     */
    const hAutoBefore = await host.evaluate('globalThis.__g5Match ? globalThis.__g5Match.setAutoAdvance(false) : null');
    const gAutoBefore = await guest.evaluate('globalThis.__g5Match ? globalThis.__g5Match.setAutoAdvance(false) : null');
    notes.push(`关自动推进（返回的是"关之前"）：房主 ${String(hAutoBefore)} / 加入方 ${String(gAutoBefore)}`);
    const stepOf = async (p) => parseJson(
      await p.evaluate('JSON.stringify(globalThis.__g5Match ? globalThis.__g5Match.turn() : null)'),
    );
    const driveOf = async (p) => parseJson(
      await p.evaluate('JSON.stringify(globalThis.__g5Match ? globalThis.__g5Match.drive() : null)'),
    );
    /**
     * ★ **等草稿→对局的过渡落地**（`turn().transitioning === false`）。
     *
     * 为什么必须等：过渡期间自动推进**不排**（`runAutoAdvance` 的守卫），而 `advanceOnce()`
     * 走的就是那条编排 ⇒ 抢在那个窗口里调它只会白跑（实测踩过：`applied` 一直是 0、
     * 看起来像"驱动没工作"，其实是过渡还在飞 —— 它最长 450ms + 4.5s 兜底 + 420ms）。
     */
    const tTrans = Date.now();
    let hTrans = await stepOf(host);
    let gTrans = await stepOf(guest);
    while (((hTrans !== null && hTrans.transitioning) || (gTrans !== null && gTrans.transitioning))
      && Date.now() - tTrans < budgetMs) {
      await sleep(300);
      hTrans = await stepOf(host);
      gTrans = await stepOf(guest);
    }
    push(hTrans !== null && gTrans !== null && hTrans.transitioning === false && gTrans.transitioning === false,
      `两端都离开了草稿→对局的过渡（transitioning=false，等了 ${String(Date.now() - tTrans)}ms）`);
    const submitAtStart = parseJson(await submitter.evaluate(
      'JSON.stringify(globalThis.__g5Match ? globalThis.__g5Match.drive() : null)',
    ));
    let stepsWalked = 0;
    let firstBadStep = null;
    const walkLog = [];
    const tWalk = Date.now();
    while (stepsWalked < 8 && Date.now() - tWalk < budgetMs) {
      const before = await matchOf(submitter);
      const peerBefore = await matchOf(peer);
      const walkBefore = { turn: await stepOf(submitter), drive: await driveOf(submitter) };
      const moved = parseJson(await submitter.evaluate(
        'JSON.stringify(globalThis.__g5Match ? globalThis.__g5Match.advanceOnce() : null)',
      ));
      if (moved === null || moved.ok !== true) {
        notes.push(`第 ${stepsWalked + 1} 次 advanceOnce：${JSON.stringify(moved)}`
          + ` / 调用前 ${JSON.stringify(walkBefore)} / 对端相 ${JSON.stringify(await stepOf(peer))}`);
        break; // 走到行动步（或非玩家输入步骤没了）
      }
      stepsWalked += 1;
      // 本端：等它自己的状态变（`submit` 是同步的，一次 RPC 之后就该变了）
      const selfNow = await matchOf(submitter);
      // 对端：它**没有**自动推进（上面关了）⇒ 它变了就只可能因为收到那一帧
      let peerNow = null;
      const tPeer = Date.now();
      while (Date.now() - tPeer < Math.min(budgetMs, 8000)) {
        peerNow = await matchOf(peer);
        if (peerNow !== null && selfNow !== null && peerNow.fp === selfNow.fp) break;
        await sleep(120);
      }
      const ok = selfNow !== null && peerNow !== null && peerNow.fp === selfNow.fp
        && selfNow.fp !== (before && before.fp);
      walkLog.push(`第 ${stepsWalked} 步：自己 ${String(before && before.fp)} -> ${String(selfNow && selfNow.fp)}，`
        + `对端 ${String(peerBefore && peerBefore.fp)} -> ${String(peerNow && peerNow.fp)}${ok ? '' : ' ← 没跟上'}`);
      if (!ok && firstBadStep === null) firstBadStep = stepsWalked;
      if (!ok) break;
      const s = await stepOf(submitter);
      if (s !== null && (s.step === 'action' || s.phase !== 'turn')) break; // 走到行动步就停
    }
    push(stepsWalked > 0, stepsWalked > 0
      ? `门禁按步走了 ${stepsWalked} 步非玩家输入步骤（advanceOnce()，走的是真编排）`
      : '一步都没走出去（`advanceOnce()` 一直返 false ⇒ 这一局已经停在行动步或已结束）');
    push(firstBadStep === null && stepsWalked > 0, firstBadStep === null && stepsWalked > 0
      ? `每一步之后对端都逐字跟上（${stepsWalked} 步，两端指纹始终相同）`
      : firstBadStep === null
        ? '没走到任何一步 ⇒ 这条判不了（上面那条已经红）'
        : `第 ${firstBadStep} 步对端没跟上（逐帧判据：旧判据下这条会因为两端各自自动推进而假绿）`);
    const submitAtEnd = await driveOf(submitter);
    const peerAtEnd = await driveOf(peer);
    push(submitAtEnd !== null && submitAtStart !== null && submitAtEnd.applied > submitAtStart.applied,
      `提交方的驱动真的应用了这些步：applied ${String(submitAtStart && submitAtStart.applied)}`
        + ` -> ${String(submitAtEnd && submitAtEnd.applied)}（applied 不涨就说明那些 submit 没走驱动）`);
    /**
     * ⚠️ 这里**只**比 `applied` 的**涨**（本端自己的步骤），不拿它当"对端收到帧"的证据 ——
     * 对端那半边由"逐帧指纹相等"负责（它没有自动推进了，变了就只能是收到了帧）。
     */
    const noBacklog = submitAtEnd !== null && peerAtEnd !== null
      && submitAtEnd.pending === 0 && peerAtEnd.pending === 0
      && submitAtEnd.failure === null && peerAtEnd.failure === null;
    push(noBacklog, noBacklog
      ? `两端都没有积压也没有驱动失败（入站队列 ${String(submitAtEnd.pending)} / ${String(peerAtEnd.pending)} 帧）`
      : `驱动侧不干净：提交方 ${JSON.stringify(submitAtEnd)} / 对端 ${JSON.stringify(peerAtEnd)}`);
    const hFin = await matchOf(host);
    const gFin = await matchOf(guest);
    const hStr2 = await host.evaluate('globalThis.__g5Match ? globalThis.__g5Match.state() : null');
    const gStr2 = await guest.evaluate('globalThis.__g5Match ? globalThis.__g5Match.state() : null');
    const eq2 = typeof hStr2 === 'string' && hStr2.length > 0 && hStr2 === gStr2;
    push(eq2, eq2
      ? `走完之后两端规范串仍然**逐字相同**（各 ${hStr2.length} 字符，指纹 ${hash32(hStr2)}）`
      : `走完之后两端规范串不同：房主 ${String(hFin && hFin.fp)} / 加入方 ${String(gFin && gFin.fp)}`);
    notes.push(`逐步走：提交方=${submitterLabel}，${walkLog.join(' ｜ ')}`
      + ` / 驱动 提交方 ${JSON.stringify(submitAtEnd)}`);
  }
  say('');
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
    // ★ 必须带一个每次都不同的查询片段，否则与上面 ③.8 同款的"同文档导航"会发生
    //   （`origin/` 与 `origin/?x#y` 之间的差别才是"换文档"）。
    // 等"入口屏"由下面 driveToLobby 的第一步负责（它会等授权屏/主页出现，最多 90 秒）。
    await guest.send('Page.navigate', { url: `${origin}/?g5r=${Date.now()}` });
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
    /**
     * ★ **两轮杀**（T11-C 实测）：`taskkill /T /F` 在第一轮有时只杀掉了顶层进程 ——
     * 此时子进程还握着 profile 里的文件（`Local State` / `Cache`）⇒ `rmSync` 一直失败。
     * 实测（2026-09-19）：第一轮之后隔 600ms 再杀一次，profile 就能删干净了。
     * 这不是"重试删除"，是"**重试杀进程**"——比删不掉再删更接近真因。
     */
    for (const inst of [hostInst, guestInst]) {
      if (!inst) continue;
      for (let i = 0; i < 3; i += 1) {
        killTree(inst.proc.pid);
        await sleep(500);
      }
    }
    for (const p of [hostInst?.profile, guestInst?.profile]) {
      if (!p) continue;
      /**
       * ★ 清理**重试**（T11-C 实测：单次 `rmSync` 偶尔会撞上"Chrome 还没死透"的占用窗口
       * —— 收工自证报"残留 2 个"，而它们过几百毫秒就删得掉了）。
       * 只重试删除（幂等、只影响临时 profile 目录），**不改**自证的口径：
       * 真删不掉时那两条判定照样红。
       *
       * ⚠️ 失败原因**写进 `raw`**（`raw.cleanupErrors`）：不写就只剩"残留 N 个"这一句，
       * 查的时候只能猜（实测踩过：真正的错误信息是 `EBUSY` 之类的系统级原因）。
       */
      for (let i = 0; i < 8; i += 1) {
        if (!existsSync(p)) break;
        try { rmSync(p, { recursive: true, force: true }); } catch (e) {
          cleanupErrors.push(`${p}（第 ${i + 1} 次）：${e instanceof Error ? e.message : String(e)}`);
        }
        if (!existsSync(p)) break;
        await sleep(400);
      }
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
  for (const n of left) {
    /**
     * ★ 残留时把"这是不是**本次**起的 profile"写清楚（T11-C 实测踩过）：被强杀的旧一轮
     * （例如超时 `Ctrl-C`、或上一轮清理失败）会留下目录，下一次跑就会把它们算成"本次残留"，
     * 于是干净的一跑也报"不干净"。判定**不放宽**（残留 > 0 就算不干净），但要把归属写明，
     * 否则下一次又要从"哪个是这次的"查起。
     */
    const mine = [hostInst?.profile, guestInst?.profile].some((p) => p !== undefined && p.endsWith(n));
    say(`      残留：${n}（${mine ? '**本次**起的' : '**别人的**：不是这一跑起的 profile'}）`);
  }
  if (left.length > 0) clean = false;
  say('');
}

const pass = judged.filter((x) => x.ok).length;
const verdict = envError === null && judged.length > 0 && pass === judged.length && clean;
raw.judged = judged;
raw.clean = clean;
raw.cleanupErrors = cleanupErrors;
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










