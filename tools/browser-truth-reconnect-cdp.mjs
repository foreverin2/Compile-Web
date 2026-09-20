#!/usr/bin/env node
/* ============================================================================
 * 运行期浏览器真值 · **断线重连的同链路恢复**（G5 T13-A 的浏览器腿）
 *
 * ## 它证明什么
 *
 * 在**两个真 Chrome + 真 WebRTC**上，把一端的**数据通道真的关掉**（不是翻状态、不是假传输）、
 * 再**真的重建**，然后看：
 *  ① 两端屏上都出现"对端不在线"那一行（玩家可见的那一半）；
 *  ② 恢复那一刻，卡在半路的那条握手消息被**按相位重发**（`__g5Match.netLink().redriven` 0 -> >=1）；
 *  ③ 握手继续推进到 `complete`，两端**规范串逐字相等**，并且真的进了草稿屏。
 *
 * ## 断线怎么造（三次只读实验的结论，见 `.superpowers/g5-T13/T13AB-REPORT.md` §5）
 *
 *  - CDP `Network.emulateNetworkConditions(offline)` **不碰** WebRTC（实测：两端一直 `connected`）；
 *  - 杀 Chrome 的 NetworkService 能真断，但那条连接**回不来**（转 `failed`、零新候选）；
 *  ⇒ 唯一可逆的做法是页面自己 **真关通道 + 真重建**（SCTP/DCEP 允许在已建立的连接上换通道）。
 *  这段能力在 `src/ui/net-browser.ts` 里由 `NetBrowserEnv.probeLinkCut` 开关控制，**只在
 *  `#g5probe=1` 时打开**；默认路径连那段代码都不执行。
 *
 * ## 它不证明什么
 *
 * 跨机 NAT / 丢包 / 切网 / 手机后台（§7）；也**不**覆盖"超过宽限 ⇒ 重建 + resync 追平"那条路
 * —— 那条路要重新交换 SDP，而进了牌桌之后屏上没有回大厅的入口（见报告 §5 第 6 点）。
 *
 * ## 端口纪律
 *
 * 临时 vite 的端口**让内核给**（`listen(0)` 读回来再用 `--strictPort` 起），并断言它不在
 * `5199 / 9341 / 9342 / 5173` 里；两个 Chrome 用 `--remote-debugging-port=0`。**绝不碰 5173**
 * （用户自己的 dev server）。
 *
 * 用法：
 *   node tools/browser-truth-reconnect-cdp.mjs              # 正常一轮
 *   node tools/browser-truth-reconnect-cdp.mjs --wait 30    # 单步等待预算（秒）
 *   node tools/browser-truth-reconnect-cdp.mjs --keep       # 不杀进程、不清 profile（调试）
 *   node tools/browser-truth-reconnect-cdp.mjs --json <路径> # 原始结果落盘
 *
 * 退出码：0 = 全部判定通过；1 = 有判定不通过；2 = 环境错误。
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
const FORBIDDEN_PORTS = [5199, 9341, 9342, 5173];
const PROFILE_PREFIX = 'btl-reconnect-';
const PROBE_FRAGMENT = '#g5probe=1';

const argv = process.argv.slice(2);
const argVal = (name, dflt = null) => {
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : dflt;
};
const WAIT_S = Number(argVal('--wait', 30));
const KEEP = argv.includes('--keep');
const JSON_OUT = argVal('--json', null);
const ROOT = resolve(argVal('--repo', REPO));
const budgetMs = WAIT_S * 1000;

const say = (m) => process.stdout.write(`${m}\n`);
const die = (m) => { say(`\n[X] 环境错误：${m}`); process.exit(2); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function pickFreePort() {
  return new Promise((res, rej) => {
    const srv = createServer();
    srv.once('error', rej);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr !== null ? addr.port : 0;
      srv.close(() => res(port));
    });
  });
}
function portListening(port) {
  return new Promise((res) => {
    const sock = connect({ port, host: '127.0.0.1' });
    const done = (v) => { sock.destroy(); res(v); };
    sock.once('connect', () => done(true));
    sock.once('error', () => done(false));
    setTimeout(() => done(false), 1200);
  });
}
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
  for (const c of cands) if (c && existsSync(c)) return c;
  return null;
}
function killTree(pid) {
  if (!pid) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
  else { try { process.kill(-pid, 'SIGKILL'); } catch { try { process.kill(pid, 'SIGKILL'); } catch { /* 已退出 */ } } }
}

async function attach(label, port, urlPrefix) {
  let wsUrl = null;
  const t0 = Date.now();
  while (Date.now() - t0 < 25000) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const page = list.find((t) => t.type === 'page' && String(t.url).startsWith(urlPrefix));
      if (page && page.webSocketDebuggerUrl) { wsUrl = page.webSocketDebuggerUrl; break; }
    } catch { /* 端口还没起来 */ }
    await sleep(200);
  }
  if (!wsUrl) throw new Error(`${label}: 拿不到 page target`);
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
  return { label, send, evaluate, text, count, waitFor, click, type, close: () => ws.close() };
}

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
/** 授权门 → 主页 → 模式选择 → 联机大厅（照 lobby 门那一份，取卡按文案不按下标）
 *
 * ★ **修复轮（2026-09-20 评审第 2 条）：三次点击都加**有界重试**。**
 * 评审那次干净复跑正是死在这一步（点了同意、主页 15s 没出现 ⇒ `判定 1/2`、exit 1）——
 * 那是**驱动阶段的一次丢点击**，不该把整轮记红。重试有界（3 次），判定集一条都没放松；
 * 第几次才生效会打印出来，原始输出里看得见。
 */
async function driveToLobby(p) {
  const clickUntil = async (sel, ready, ms, label) => {
    for (let i = 0; i < 3; i += 1) {
      await p.click(sel);
      if (await p.waitFor(ready, ms)) {
        if (i > 0) say(`  注：${label} 第 ${i + 1} 次点击才生效（有界重试）`);
        return true;
      }
      await sleep(600);
    }
    return false;
  };
  if (!(await p.waitFor('.consent-grant, .home-btn-primary', 90000))) return '页面起来了但既没有授权屏也没有主页';
  if ((await p.count('.consent-grant')) > 0) {
    if (!(await clickUntil('.consent-grant', '.home-btn-primary', 15000, '点「允许」'))) {
      return '点了「允许」但主页没出现（有界重试 3 次之后仍然没有）';
    }
  }
  if (!(await clickUntil('.home-btn-primary', '.mode-card', 15000, '点「开始游戏」'))) {
    return '点了「开始游戏」但模式选择没出现（有界重试 3 次之后仍然没有）';
  }
  const picked = await p.evaluate(`(() => {
    const cards = [...document.querySelectorAll('.mode-card')];
    const i = cards.findIndex((c) => c.textContent.includes('联机对战'));
    if (i < 0) return null;
    cards[i].setAttribute('data-btl', 'lobby');
    return i;
  })()`);
  if (picked === null) return '模式选择里找不到「联机对战（两台设备）」那张卡';
  if (!(await clickUntil("[data-btl='lobby']", '.net-lobby-host', 15000, '点「联机对战」'))) {
    return '进了大厅但没有「建房 / 加入」两个入口（有界重试 3 次之后仍然没有）';
  }
  return null;
}
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
function hash32(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
async function matchOf(p) {
  const raw = await p.evaluate(`(() => {
    if (typeof __g5Match === 'undefined' || __g5Match === null) return null;
    return JSON.stringify({
      state: __g5Match.state(), fp: (() => { const s = __g5Match.state(); return null; })(),
      seed: __g5Match.seed(), draftRound: __g5Match.draftRound(),
      drive: __g5Match.drive(), netLink: __g5Match.netLink(),
    });
  })()`);
  try { return JSON.parse(String(raw)); } catch { return null; }
}

/* ── 主流程 ─────────────────────────────────────────────────────────────── */
const chrome = findChrome();
if (!chrome) die('找不到 Chrome/Edge（可用 CHROME_PATH 指定）');
if (!existsSync(VITE_BIN)) die(`找不到 vite：${VITE_BIN}`);
if (!existsSync(join(ROOT, 'index.html'))) die(`--repo 指到的目录里没有 index.html：${ROOT}`);

const vitePort = await pickFreePort();
if (FORBIDDEN_PORTS.includes(vitePort)) die(`内核给的端口 ${vitePort} 撞上了禁用端口`);
const origin = `http://127.0.0.1:${vitePort}`;
say(`repo   = ${ROOT}`);
say(`chrome = ${chrome}`);
say(`vite   = ${origin}（内核给的端口，--strictPort）`);
say(`budget = ${WAIT_S}s / 步`);
say('');

const judged = [];
const push = (ok, what) => { judged.push({ ok, what }); say(`  [${ok ? '通过' : '不通过'}] ${what}`); };
const notes = [];
let host = null; let guest = null; let hostInst = null; let guestInst = null;
let vite = null;
let envError = null;
const raw = { when: new Date().toISOString(), chrome, vitePort, waitS: WAIT_S };

try {
  vite = spawn(process.execPath, [VITE_BIN, '--port', String(vitePort), '--strictPort', '--host', '127.0.0.1'], {
    cwd: ROOT, stdio: 'ignore',
  });
  if (!(await httpOk(`${origin}/`, 40000))) throw new Error('vite 没起来（40s 内没有 HTTP 200）');
  hostInst = await launchChrome(chrome, `${origin}/${PROBE_FRAGMENT}`);
  guestInst = await launchChrome(chrome, `${origin}/${PROBE_FRAGMENT}`);
  host = await attach('host', hostInst.port, origin);
  guest = await attach('guest', guestInst.port, origin);
  say(`chrome 调试端口：host=${hostInst.port} guest=${guestInst.port}`);
  say('');

  const hDrive = await driveToLobby(host);
  const gDrive = await driveToLobby(guest);
  push(hDrive === null && gDrive === null, `两端都驱动到了联机大厅（host ${hDrive ?? 'ok'} / guest ${gDrive ?? 'ok'}）`);

  /* ── ① 房主：邀请码 ─────────────────────────────────────────────────── */
  await host.click('.net-lobby-host');
  if (!(await host.waitFor('.net-lobby-make-invite', 8000))) throw new Error('房主屏上没有「生成邀请码」');
  await host.click('.net-lobby-make-invite');
  const inviteOk = await host.waitFor('.net-lobby-invite-payload', budgetMs);
  const invitePayload = inviteOk ? await host.text('.net-lobby-invite-payload') : null;
  push(typeof invitePayload === 'string' && invitePayload.length > 40, `房主产出了邀请码（${invitePayload?.length ?? 0} 字符）`);

  /* ── ② 加入方：贴码 ⇒ 回示码 ─────────────────────────────────────────── */
  if ((await guest.count('.net-lobby-paste-input')) === 0 && (await guest.count('.net-lobby-join')) > 0) {
    await guest.click('.net-lobby-join');
  }
  if (!(await guest.waitFor('.net-lobby-paste-input', 8000))) throw new Error('加入方屏上没有粘贴框');
  await guest.type('.net-lobby-paste-input', String(invitePayload));
  if (!(await guest.waitFor('.net-lobby-make-answer', 20000))) throw new Error('加入方屏上没有「出示回示码」');
  await guest.click('.net-lobby-make-answer');
  const ansOk = await guest.waitFor('.net-lobby-answer-code', budgetMs);
  const answerCode = ansOk ? await guest.text('.net-lobby-answer-code') : null;
  push(typeof answerCode === 'string' && answerCode.length > 0, `加入方产出了回示码（${answerCode?.length ?? 0} 字符）`);

  /* ── ③ 房主贴回示码 ⇒ 握手推进到"等玩家叫面" ─────────────────────────── */
  await host.type('.net-lobby-answer-input', String(answerCode));
  const advanced = async (wantBall) => {
    const t0 = Date.now();
    let h = null; let g = null;
    while (Date.now() - t0 < budgetMs) {
      h = await phaseOfSide(host); g = await phaseOfSide(guest);
      const okH = h !== null && h !== 'handshaking' && h !== 'idle';
      const okG = g !== null && g !== 'handshaking' && g !== 'idle';
      if (okH && okG && (!wantBall || g === 'awaiting-commit-ack')) return { h, g };
      await sleep(400);
    }
    return { h, g };
  };
  const st3 = await advanced(true);
  push(st3.g === 'awaiting-commit-ack',
    `两端握手推进、加入方停在"等玩家叫面"那一格（host ${st3.h} / guest ${st3.g}）`);

  /* ── ④ 掐线（两端真关通道）⇒ 两端屏上出现"对端不在线"那一行 ─────────────── */
  // 钩子在 `createBrowserTransport().init()` 里装（也就是 `connect()` 之后）⇒ 到这里才断言它
  push((await host.evaluate("typeof window.__g5LinkCut === 'function'")) === true
    && (await guest.evaluate("typeof window.__g5LinkCut === 'function'")) === true,
  '两端的掐线钩子都装上了（`#g5probe=1` ⇒ `probeLinkCut`；默认路径不装）');
  const cutAt = Date.now();
  await host.evaluate('window.__g5LinkCut()');
  await guest.evaluate('window.__g5LinkCut()');
  let hostOfflineLine = null; let guestOfflineLine = null;
  // ⚠️ 这一段的预算必须**远小于** `main.ts` 的重建宽限期（4s）：宽限内恢复才是"同链路"这条腿
  // 两个可能的位置：硬币屏上那一行（`.net-link-line`，本轮加的）与大厅那一行（`.net-lobby-link`）
  const linkLineText = (p) => p.evaluate(
    "(document.querySelector('.net-link-line')?.textContent)"
    + " ?? (document.querySelector('.net-lobby-link')?.textContent) ?? null",
  );
  for (let i = 0; i < 8; i += 1) {
    hostOfflineLine = await linkLineText(host);
    guestOfflineLine = await linkLineText(guest);
    if ((hostOfflineLine ?? '').includes('不在线') && (guestOfflineLine ?? '').includes('不在线')) break;
    await sleep(80);
  }
  push((hostOfflineLine ?? '').includes('不在线'),
    `房主屏上给出了掉线那一行（${(hostOfflineLine ?? '（空）').slice(0, 24)}…）`);
  push((guestOfflineLine ?? '').includes('不在线'),
    `加入方屏上给出了掉线那一行（${(guestOfflineLine ?? '（空）').slice(0, 24)}…）`);

  /* ── ⑤ 掐线期间玩家叫面 ⇒ 那条 `commit-face` 到不了对端（卡在半路的那条消息）────── */
  await guest.click('.coin-face-chip');
  const t5 = Date.now();
  let hostPhaseDuringCut = null;
  let hostEverGotIt = false;
  while (Date.now() - t5 < 2500) {
    hostPhaseDuringCut = await phaseOfSide(host);
    if (hostPhaseDuringCut !== 'awaiting-commit-face') hostEverGotIt = true;
    await sleep(80);
  }
  push(!hostEverGotIt,
    `掐线期间房主**没有**收到加入方叫出去的那一面（房主相位一直是 ${hostPhaseDuringCut}）`
    + ' ⇒ 那条消息真的卡在半路了，不是"其实早到了"');
  push((await matchOf(guest))?.netLink?.redriven === 0,
    '掐线期间重发计数仍为 0（判据 2：没有恢复就不许重发；这个数只数 `send()` 报成功的）');
  const cutWindow = Date.now() - cutAt;
  notes.push(`掐线持续 ${cutWindow}ms（宽限期 4000ms 之内恢复 ⇒ 走的才是"同链路"那条路）`);
  push(cutWindow < 3800, `恢复赶在宽限期之内（掐线窗口 ${cutWindow}ms < 4000ms）`);

  /* ── ⑥ 恢复（房主重建通道，加入方认领）⇒ 重发 + 握手走到底 ───────────────── */
  await host.evaluate('window.__g5LinkRestore()');
  const t6 = Date.now();
  let guestLinkOnline = null;
  while (Date.now() - t6 < 15000) {
    guestLinkOnline = (await matchOf(guest))?.netLink?.link ?? null;
    if (guestLinkOnline === 'online') break;
    await sleep(200);
  }
  push(guestLinkOnline === 'online', `加入方的链路自己恢复了（transport=${guestLinkOnline}）`);
  const redriven = (await matchOf(guest))?.netLink?.redriven ?? -1;
  push(redriven >= 1, `恢复那一刻按相位重发了在途消息（redriven=${redriven}；这个数只数 \`send()\` 报成功的）`);
  push((await matchOf(host))?.netLink?.redriven >= 1 || redriven >= 1,
    '两端至少有一侧真的重发过（这一格是 D23 ② 的落点）');

  const t7 = Date.now();
  let hPhase = null; let gPhase = null;
  while (Date.now() - t7 < budgetMs) {
    // 进了牌桌之后 `.coin-screen` / `.net-lobby-screen` 都不在了 ⇒ 相位从探针口读（会话层真值）
    hPhase = (await matchOf(host))?.netLink?.phase ?? null;
    gPhase = (await matchOf(guest))?.netLink?.phase ?? null;
    if (hPhase === 'complete' && gPhase === 'complete') break;
    await sleep(400);
  }
  push(hPhase === 'complete' && gPhase === 'complete',
    `握手继续推进到 complete（host ${hPhase} / guest ${gPhase}）—— M1（去掉 redrive 调用）时这里会停在 face-committed/awaiting-commit-face`);
  const draftOn = (await host.waitFor('.draft-screen', 20000)) && (await guest.waitFor('.draft-screen', 20000));
  push(draftOn, '两端都进了牌桌（草稿屏）⇒ 这一局真的接着打了');
  const hMatch = await matchOf(host);
  const gMatch = await matchOf(guest);
  const sameState = typeof hMatch?.state === 'string' && hMatch.state === gMatch?.state;
  push(sameState, `两端规范串逐字相等（各 ${hMatch?.state?.length ?? 0} 字符，指纹 ${hash32(String(hMatch?.state ?? ''))}）`);
  push((hMatch?.seed ?? 'x') === (gMatch?.seed ?? 'y'), `两端种子相同（${String(hMatch?.seed ?? '').slice(0, 12)}…）`);

  raw.steps = {
    hostFinal: hMatch, guestFinal: gMatch,
    phases: { st3, hostPhaseDuringCut, hPhase, gPhase },
    redriven: { host: hMatch?.netLink?.redriven ?? -1, guest: gMatch?.netLink?.redriven ?? -1 },
    lines: { hostOfflineLine, guestOfflineLine },
    cutWindowMs: cutWindow,
  };
} catch (e) {
  envError = String(e);
  say(`\n[X] 这一轮没跑完：${envError}`);
} finally {
  if (host) host.close();
  if (guest) guest.close();
  if (!KEEP) {
    if (hostInst) { killTree(hostInst.proc.pid); try { rmSync(hostInst.profile, { recursive: true, force: true }); } catch { /* 被占 */ } }
    if (guestInst) { killTree(guestInst.proc.pid); try { rmSync(guestInst.profile, { recursive: true, force: true }); } catch { /* 被占 */ } }
    if (vite) killTree(vite.pid);
    // Chrome 的子进程退出要一点时间：清不掉时再等一会儿重试一次（否则收工自证会假红）
    await sleep(1200);
    for (const inst of [hostInst, guestInst]) {
      if (!inst) continue;
      try { rmSync(inst.profile, { recursive: true, force: true }); } catch { /* 真的清不掉就如实报 */ }
    }
  }
}

/* ── 收工自证 ───────────────────────────────────────────────────────────── */
let clean = true;
if (!KEEP) {
  say('');
  say('=== 收工自证 ===');
  const listening = await portListening(vitePort);
  say(`  [${listening ? '不通过' : '通过'}] 临时 vite 端口 ${vitePort} 未在监听`);
  if (listening) clean = false;
  const left = [];
  for (const pre of [PROFILE_PREFIX]) {
    try { for (const n of readdirSync(tmpdir())) if (n.startsWith(pre)) left.push(n); } catch { /* 读不了 */ }
  }
  say(`  [${left.length === 0 ? '通过' : '不通过'}] 临时 profile 已清（残留 ${left.length} 个）`);
  if (left.length > 0) clean = false;
  raw.leftProfiles = left;
}

const pass = judged.filter((x) => x.ok).length;
const verdict = envError === null && judged.length > 0 && pass === judged.length && clean;
raw.judged = judged;
raw.notes = notes;
raw.verdict = verdict;
if (JSON_OUT) {
  writeFileSync(JSON_OUT, JSON.stringify(raw, null, 2), 'utf8');
  say(`原始结果已写入 ${JSON_OUT}`);
}
say('');
say(`判定 ${pass}/${judged.length} 条通过${clean ? '' : '（收工自证不干净）'}`);
say(verdict ? '\n全部判定通过。' : '\n有判定不通过。');
process.exit(verdict ? 0 : 1);
