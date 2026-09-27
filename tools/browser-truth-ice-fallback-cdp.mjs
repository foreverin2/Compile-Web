#!/usr/bin/env node
/* ============================================================================
 * 运行期浏览器真值 · **ICE 收集到不了 `complete` 时那条路还走不走得通**（G5 T16）
 *
 * ## 它为什么必须存在
 *
 * 用户真机实测（2026-09-22）：他所在的那张网到 Google 的公共 STUN **不可达** ⇒
 * `iceGatheringState` 永远到不了 `complete`（**本机 / mDNS 候选其实早就有了**）⇒
 * 15 秒上界一到，屏上只有一句"等了 15 秒，ICE 候选还没有收集完（对端的网络可能把候选挡住了）"，
 * 邀请码**根本不生成**。而他真正要的只是**同一台机器 / 同一局域网**两个窗口对打。
 *
 * 修复（`src/ui/net-browser.ts` 的 `waitForIceGathering`）之后，那条路变成：
 * **上界到点先看手上已经有几个候选** —— 有 ⇒ 按现状生成邀请码 + 一句**如实**的话；
 * 0 个 ⇒ 仍然是硬失败，但理由只说"这台设备这一次一个候选都没收集到"。
 * ★ **G5/T18 修复轮**：只有 host（没有 srflx / relay）**且这份配置里没有可用中继**时不再等满
 * 15 秒 —— 起一段 **1.5 秒宽限**（`ICE_HOST_ONLY_GRACE_MS`），到点走上面那条"放行 + 如实 note"；
 * 15 秒上界留给"一个候选都没有"那一档（⑤ 的负控量的就是它）。够用（host + srflx/relay，
 * 配了中继时必须是 relay）则**立刻**收工。屏上那句话因此有三种：空（收完）/ 含"等了"（到点）/
 * 含"够用"（早退）—— 本工具用 `gatherOutcomeOf` 按那三个字面分类，不猜。
 *
 * ★★ **G5/T42（2026-09-27）：① 这一格的前提过期了，拆成两条腿。**
 *
 * 起因：收口门（`.superpowers/g5-final/gates-final-20260927.txt`，门 9）在冻结树上跑出
 * **14/17 红**，红的三格是 ①（用时 15128ms，不是 1.5 秒宽限那一档）、②（邀请码解不开）、
 * ③（跟着"未到达"）。产品行为本身是对的，是**夹具量的还是 T38/T40 之前的世界**：
 *  1. **T38 起产品默认就带一台中继**（`DEFAULT_ICE_SERVERS` 里那项 `turn:`，三项设置也预填
 *     同样的值）⇒ `readIceServers().relayConfigured === true` 是**默认状态**，于是
 *     `waitForIceGathering` 走**严格档**：中继不可达时真的等满 15 秒上界再放行
 *     （那句里的"你配了中继，但这一轮中继地址也没收到"）。这是 T38 当面做过的裁决，不是 bug。
 *  2. **T40 起压缩段一定带明文标记**（`ENCODE_MARKER_OF_KIND`：`-r` / `-d` / `-g` / `-u`）⇒
 *     本文件旧的 `decodeInvite()` 只会 `inflateRawSync`，把 `-r` 当正文 ⇒ 必然解不开。
 *
 * 于是 ① 拆成**两条腿**，各自钉一个契约（两条都能在产品行为变了时变红，见
 * `.superpowers/g5-T42/T42-REPORT.md` 里的变异实验）：
 *  - **①-a 严格档**（默认设置 + 不可达 STUN）：用时落在**上界那一档**（≥14s）、收工方式
 *    `bounded`、那句里**同时**含"等了 15 秒"与"你配了中继，但这一轮中继地址也没收到"，
 *    且 `iceGatheringState` 一次都没到过 `complete`；
 *  - **①-b 宽限档**（走真界面把三项设置弄成"配了一半" ⇒ `relayConfigured === false` +
 *    不可达 STUN）：用时落在 **1.5 秒宽限那一档**（1s ≤ 用时 < 10s）、那句含"等了 1.5 秒"
 *    且**不含**"你配了中继"。
 *    ⚠️ `relayConfigured === false` 只有一条路能造出来：**URL 非空、用户名或凭据为空**
 *    （`readIceServers` 的"配了一半"那一支）。"三项空 + 关掉中继开关"造不出来 ——
 *    三项空回的是**默认值**（含内置中继 ⇒ `true`），而那个开关只控制**三个输入框显不显示**
 *    （`net-lobby.ts` 的 `toggleRelay`）。实测形态与读数见报告。
 *
 * **这一条证明的就是那四件事**（全部在**真 Chrome**上点真界面拿读数）：
 *  ① 注入一个**必然不可达**的 STUN（`stun:192.0.2.1:3478`，RFC 5737 的 TEST-NET-1）⇒
 *     `iceGatheringState` 到不了 `complete`（页内探针逐条记时间线）；默认那份配置里**有中继**
 *     ⇒ 走满 15 秒上界（①-a）；把中继弄成"配了一半"（`relayConfigured === false`）⇒ 只有 host
 *     的那种情形走 **1.5 秒宽限**就到点放行（①-b，T18 那条修复量的是它）；
 *  ② 宽限到点之后**仍然产出邀请码**（形状 + 长度，长度从盘上原文里给）；
 *  ③ 屏上那句话与**实测**一致：把邀请码解压开、数它 SDP 里的候选种类与个数，
 *     与 `.net-lobby-notice` 上那句里的数字逐个对上，且那句话里**没有**旧的猜测措辞；
 *  ④ 拿这条邀请码把两端**真的接起来**（加入方产出回示码 → 房主贴回 → 两端走到硬币屏），
 *     证明"同机可用"这句话不是空话；
 *  ⑤ **负控**：注入一个"永远 `gathering`、SDP 里一条候选都没有"的假 `RTCPeerConnection`
 *     ⇒ 硬失败（**不产出**邀请码），且屏上那句的理由准确（说本侧一个候选都没有，
 *     不再猜对端的网络）。
 *  ⑥（**只记录、不判定**）这台机器到 Google / Cloudflare 两家公共 STUN 的可达性读数 ——
 *     它是"默认值里第三个 STUN 该不该加"的现场依据，不是本任务的门禁。
 *  ⑦ ★ **G5/T17**：④ 里粘进加入方粘贴框的是房主屏上那条**整条链接**（不是裸载荷）——
 *     用户真机实测就是这么粘的，而那时这条路只吃裸载荷（屏上回一句"开头不是整数"）。
 *     对应两格：②b（屏上那条链接的 fragment 与裸载荷逐字相同）、④（整条链接 ⇒ 两端硬币屏），
 *     外加一格界面提示（粘贴框旁边那句"三种都能粘"必须在屏上）。
 *
 * ## 它怎么把"STUN 不可达"造出来（**不改一个字节的生产代码**）
 *
 * 用 CDP 的 `Page.addScriptToEvaluateOnNewDocument` 在**页面任何脚本之前**把
 * `window.RTCPeerConnection` 包一层：调用方传什么 `iceServers` 都换成那个不可达地址。
 * 这是夹具侧的注入（`src/ui/net-browser.ts` 的 `defaultEnv()` 每次调用都现读
 * `globalThis.RTCPeerConnection`，所以这一层包装一定被用上），生产路径一个字节都没改。
 *
 * ⚠️ 用真地址 `stun:192.0.2.1:3478`（**不是**域名）：TEST-NET-1 是保留段，本机必然连不上，
 * 又不会引入 DNS 解析这第二种不确定性。
 *
 * ## 起环境（与既有两道浏览器门同一套做法）
 *
 *  - 临时 vite：`--port` 由**内核给**（`listen(0)` 读回再关），且断言不在
 *    `5199 / 9341 / 9342 / 5173 / 3080` 里 —— 5173 是用户自己的 dev server、3080 是 DSH 那个界面，
 *    **本工具一个都不碰**；
 *  - 真 Chrome：各自临时 profile、`--headless=new`、`--remote-debugging-port=0`；
 *  - 子进程输出 `stdio: 'ignore'`（管道捕获在某些沙箱模式下 EPERM）。
 *
 * 用法：
 *   node tools/browser-truth-ice-fallback-cdp.mjs                # 正常一轮
 *   node tools/browser-truth-ice-fallback-cdp.mjs --wait 30      # 单步等待预算（秒，缺省 40）
 *   node tools/browser-truth-ice-fallback-cdp.mjs --json <路径>   # 原始读数落盘
 *   node tools/browser-truth-ice-fallback-cdp.mjs --keep         # 不杀进程、清 profile（调试）
 *
 * 退出码：0 = 全部判定通过；1 = 有判定不通过；2 = 环境错误（找不到 Chrome / vite 起不来 / CDP 连不上）。
 * ========================================================================== */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, connect } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync, gunzipSync, inflateRawSync, inflateSync } from 'node:zlib';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');
const VITE_BIN = join(REPO, 'node_modules', 'vite', 'bin', 'vite.js');

/** 不碰的端口：5173 = 用户自己的 dev server，3080 = DSH 界面，其余是本仓既有夹具的 */
const FORBIDDEN_PORTS = [5199, 9341, 9342, 5173, 3080];
const PROFILE_PREFIX = 'btl-icefall-';

/** ★ 必然不可达的 STUN：RFC 5737 的 TEST-NET-1（192.0.2.0/24 是保留段，不做路由） */
const UNREACHABLE_STUN = 'stun:192.0.2.1:3478';

/**
 * ★ G5/T42：①-b 用来造"**配了一半**"的那个 TURN URL。
 *
 * 同样的 TEST-NET-1 段，同样必然不可达；取一个与 STUN 那个不同的端口只为让读数里一眼能分清
 * "这是玩家填的那一项"。**它不会被真的连**（注入把整份 `iceServers` 换掉了）——
 * 这一格量的是 `readIceServers()` 的 `relayConfigured` 怎么影响 `waitForIceGathering`，
 * 不是"这台中继通不通"。
 */
const RELAY_HALF_CONFIGURED_URL = 'turn:192.0.2.2:3478';

const argv = process.argv.slice(2);
const argVal = (name, dflt = null) => {
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : dflt;
};
const WAIT_S = Number(argVal('--wait', 40));
const ROOT = resolve(argVal('--repo', REPO));
const KEEP = argv.includes('--keep');
const JSON_OUT = argVal('--json', null);

const say = (m) => process.stdout.write(`${m}\n`);
const die = (m) => { say(`\n[X] 环境错误：${m}`); process.exit(2); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const budgetMs = WAIT_S * 1000;

/* ── 端口与进程（照 `browser-truth-lobby-cdp.mjs` 的既有做法） ─────────────── */

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

function portListening(port) {
  return new Promise((res) => {
    const sock = connect({ port, host: '127.0.0.1' });
    const done = (v) => { sock.destroy(); res(v); };
    sock.once('connect', () => done(true));
    sock.once('error', () => done(false));
    setTimeout(() => done(false), 1200);
  });
}

/** 只查存在性，**绝不**执行 `chrome --version`（那会起一个用默认 profile 的真 Chrome） */
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
  ws.addEventListener('message', (ev) => {
    let m; try { m = JSON.parse(String(ev.data)); } catch { return; }
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  });
  /**
   * ⚠️ **CDP 的协议错误必须响亮地抛**（本工具第一版把它吞掉了：`Page.addScriptToEvaluateOnNewDocument`
   * 因为没先 `Page.enable` 而报错，注入**静默地**没生效 ⇒ 那一轮读到的全是**真实网络**的读数
   * ——"STUN 不可达"这一格根本没造出来，而工具照样在跑）。被测的是"注入生效之后的应用行为"，
   * 所以协议层出错必须是**环境错误**，不是一条可以忽略的 readback。
   */
  const send = async (method, params) => {
    const id = nextId++;
    const p = new Promise((res) => pending.set(id, res));
    ws.send(JSON.stringify({ id, method, params: params ?? {} }));
    const r = await p;
    if (r !== undefined && r.error !== undefined) {
      throw new Error(`${label}: CDP ${method} 失败 ${JSON.stringify(r.error)}`);
    }
    return r;
  };
  // ★ 先开 Page 域：`Page.addScriptToEvaluateOnNewDocument`（本夹具造"STUN 不可达"靠它）要先有它
  await send('Page.enable');
  const evaluate = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r?.result?.exceptionDetails) {
      throw new Error(`${label}: 页面异常 ${
        JSON.stringify(r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails)}`);
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
  /** 真鼠标点击（不是 `el.click()`） */
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
  /** 真文本输入（浏览器会派发真的 `input` 事件） */
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
  /** ★ 在**下一个文档**的任何脚本之前注入（本夹具造"STUN 不可达"就靠它） */
  const injectOnNewDocument = (source) => send('Page.addScriptToEvaluateOnNewDocument', { source });
  const navigate = (url) => send('Page.navigate', { url });
  return { label, send, evaluate, text, count, waitFor, click, type, injectOnNewDocument, navigate,
    close: () => ws.close() };
}

/* ── 注入脚本（夹具侧；生产代码一个字节都不改） ──────────────────────────── */

/**
 * 把 `RTCPeerConnection` 包一层，**强制**换成那个不可达的 STUN，并把页内真实发生的事记下来。
 *
 * 记的读数（本工具的全部判据都从这里来，不靠猜）：
 *  - `configs`：调用方本来传的 `iceServers`（证明"应用确实给了默认值"，且注入真的改了它）；
 *  - `states`：`[相对毫秒, 状态]` 的 `icegatheringstatechange` 时间线（判据①）；
 *  - `candidates`：`icecandidate` 事件的**非空**候选个数（与邀请码里数出来的交叉验证）；
 *  - `errors`：`icecandidateerror`（STUN 不可达时应当有它的痕迹，这是"确实试着连过"的证据）。
 */
function stunOverrideScript(stunUrl) {
  return `(() => {
    const REAL = window.RTCPeerConnection;
    if (typeof REAL !== 'function') { window.__iceProbe = { fatal: 'no RTCPeerConnection' }; return; }
    const t0 = Date.now();
    const probe = {
      forced: ${JSON.stringify(stunUrl)},
      configs: [], states: [], timeline: [], candidates: 0, errors: [], lastCandidate: null, pcs: 0,
      at: () => Date.now() - t0,
    };
    window.__iceProbe = probe;
    function Wrapped(config) {
      try { probe.configs.push(JSON.stringify(config ?? null)); } catch (e) { probe.configs.push('unreadable'); }
      const base = (config !== null && typeof config === 'object') ? config : {};
      const forced = Object.assign({}, base, { iceServers: [{ urls: [probe.forced] }] });
      const pc = new REAL(forced);
      probe.pcs += 1;
      // 建出来那一刻的状态也记（"到没到过 complete"这件事要有完整时间线，不能只看变化事件）
      probe.timeline.push([probe.at(), 'constructed', String(pc.iceGatheringState)]);
      pc.addEventListener('icegatheringstatechange', () => {
        probe.states.push([probe.at(), String(pc.iceGatheringState)]);
        probe.timeline.push([probe.at(), 'state', String(pc.iceGatheringState)]);
      });
      pc.addEventListener('icecandidate', (ev) => {
        if (ev && ev.candidate && typeof ev.candidate.candidate === 'string' && ev.candidate.candidate.length > 0) {
          probe.candidates += 1;
          probe.lastCandidate = ev.candidate.candidate;
          const m = /\\btyp\\s+([A-Za-z]+)/.exec(ev.candidate.candidate);
          probe.timeline.push([probe.at(), 'candidate', m ? m[1] : '?']);
        } else {
          probe.states.push([probe.at(), 'end-of-candidates']);
          probe.timeline.push([probe.at(), 'end-of-candidates', '']);
        }
      });
      pc.addEventListener('icecandidateerror', (ev) => {
        probe.errors.push([probe.at(), String((ev && ev.errorCode) || ''), String((ev && ev.url) || '')]);
      });
      return pc;
    }
    Wrapped.prototype = REAL.prototype;
    try { Object.defineProperty(Wrapped, 'name', { value: 'RTCPeerConnection' }); } catch (e) { /* 名字改不动不影响 */ }
    window.RTCPeerConnection = Wrapped;
  })();`;
}

/**
 * ★ 负控用的假 `RTCPeerConnection`：**永远 `gathering`、SDP 里一条候选都没有**。
 *
 * 为什么这个负控能把"0 候选 ⇒ 硬失败"钉死：
 *  - `iceGatheringState` 永远是 `'gathering'` ⇒ 应用那条路一定走到**上界到点**那一支；
 *  - `localDescription` 里 `a=candidate:` **一行都没有** ⇒ 走的是 0 候选那一支；
 *  - 它能 `createDataChannel` / `createOffer` / `setLocalDescription` ⇒ 应用**能走到**
 *    "等候选"那一步（不是"更早的地方就炸了"，那种红不能证明这一条）。
 */
function emptyCandidateScript() {
  return `(() => {
    const probe = { offers: 0, pcs: 0 };
    window.__iceProbe = probe;
    const SDP = 'v=0\\r\\no=- 1 1 IN IP4 127.0.0.1\\r\\ns=-\\r\\nt=0 0\\r\\n';
    class FakePeerConnection {
      constructor(config) {
        probe.pcs += 1;
        probe.config = JSON.stringify(config ?? null);
        this.iceGatheringState = 'gathering';
        this.connectionState = 'new';
        this.iceConnectionState = 'new';
        this.localDescription = null;
        this.__l = new Map();
      }
      addEventListener(t, cb) {
        const a = this.__l.get(t) || [];
        a.push(cb);
        this.__l.set(t, a);
      }
      createDataChannel(label) {
        return { label, readyState: 'connecting', bufferedAmount: 0, send() {}, close() {}, addEventListener() {} };
      }
      async createOffer() { probe.offers += 1; return { type: 'offer', sdp: SDP }; }
      async setLocalDescription(d) { this.localDescription = { type: d.type, sdp: d.sdp }; }
      async setRemoteDescription() { /* 负控不走这一格 */ }
      async createAnswer() { return { type: 'answer', sdp: SDP }; }
      restartIce() { /* 负控不需要 */ }
      close() { /* 负控不需要 */ }
    }
    window.RTCPeerConnection = FakePeerConnection;
  })();`;
}

/* ── 页面驱动 ───────────────────────────────────────────────────────────── */

async function httpOk(url, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { if ((await fetch(url)).ok) return true; } catch { /* 还没起来 */ }
    await sleep(200);
  }
  return false;
}

async function launchChrome(chrome) {
  const profile = mkdtempSync(join(tmpdir(), PROFILE_PREFIX));
  const flags = [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--remote-allow-origins=*',
    '--window-size=1280,900', 'about:blank',
  ];
  const proc = spawn(chrome, flags, { stdio: 'ignore' });
  const portFile = join(profile, 'DevToolsActivePort');
  const t0 = Date.now();
  let port = null;
  while (Date.now() - t0 < 25000) {
    if (existsSync(portFile)) {
      try {
        const first = readFileSync(portFile, 'utf8').split('\n')[0].trim();
        if (first) { port = Number(first); break; }
      } catch { /* 文件正在写 */ }
    }
    await sleep(150);
  }
  if (!port) throw new Error(`${profile}: 拿不到 DevToolsActivePort`);
  return { proc, profile, port };
}

/** 走到联机大厅"还没选角色"那一帧（授权门 → 主页 → 模式选择 → 联机大厅） */
async function driveToLobby(p) {
  if (!(await p.waitFor('.consent-grant, .home-btn-primary', 90000))) return '页面起来了但既没有授权屏也没有主页';
  if ((await p.count('.consent-grant')) > 0) {
    await p.click('.consent-grant');
    if (!(await p.waitFor('.home-btn-primary', 15000))) return '点了「允许」但主页没出现';
  }
  await p.click('.home-btn-primary');
  if (!(await p.waitFor('.mode-card', 15000))) return '点了「开始游戏」但模式选择没出现';
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

/** 某一侧此刻的会话相位（硬币屏与大厅屏都挂 `data-net-phase`） */
async function phaseOfSide(p) {
  const v = await p.evaluate(
    "document.querySelector('.coin-screen')?.getAttribute('data-net-phase')"
    + " ?? document.querySelector('.net-lobby-screen')?.getAttribute('data-net-phase')"
    + ' ?? null',
  );
  return typeof v === 'string' && v.length > 0 ? v : null;
}

/* ── 邀请码的**真解码**（判据③：屏上那句里的数字要与 SDP 实测对得上） ─────── */

/**
 * 压缩段的**明文标记 → 编码档位**（测试侧独立实现，照 `src/net/invite.ts` 的明文契约写，
 * **不 import 产品代码** —— 与本文件里的 `linkFragmentOf` 同一套纪律）。
 *
 * 两处出处（T42 动手前逐字核过）：
 *  - `COMPRESSION_MARKERS`（**读**）：`raw: ''` / `none: '-u'` / `deflate: '-d'` / `gzip: '-g'`；
 *  - `ENCODE_MARKER_OF_KIND`（**生成**）：`raw: '-r'`，其余三档同上。
 * 生成侧把 `raw` 也显式写成 `-r`，**读侧也认它**（`kindOfMarker` 两张表都查）。
 */
const READ_MARKER_OF_KIND = { raw: '', none: '-u', deflate: '-d', gzip: '-g' };
const ENCODE_MARKER_OF_KIND = { raw: '-r', none: '-u', deflate: '-d', gzip: '-g' };

/** 标记的**宽度**：`-x` 就是 2 个字符。第二段以 `-` 开头 ⇒ 前两个字符是标记（否则老格式 `''`）。 */
function markerOfSegment(segment) {
  return segment.startsWith('-') ? segment.slice(0, 2) : '';
}

/** `标记 → kind`（**读**用）：`''`（老格式）与 `'-r'` 都是 `'raw'`；不认得返回 `null` */
function kindOfMarker(marker) {
  if (marker === '') return 'raw';
  const keys = [...Object.keys(ENCODE_MARKER_OF_KIND), ...Object.keys(READ_MARKER_OF_KIND)];
  const hit = keys.find((k) => ENCODE_MARKER_OF_KIND[k] === marker || READ_MARKER_OF_KIND[k] === marker);
  return hit ?? null;
}

/**
 * 把一条邀请码解回那份位置数组。
 *
 * 形状（`src/net/invite.ts`，T40 起）：`<协议版本>.<标记?><base64url(压缩正文)>`，
 * 标记是 `-r` / `-d` / `-g` / `-u` 之一；**老格式（无标记）按 `raw` 读**。
 * 数组的下标是契约：`[v, sessionId, sdp, ice[], hostPromise, guestPromise]`。
 * **在 node 里真解一遍**（`zlib` 那几个解压器），不靠页面自报。
 *
 * 返回 `null` = 解不开；**解不开的原因**由 `decodeFailureNote()` 说出来（"标记不认得"与
 * "正文解不开"是两回事，报告里要分得清）。
 */
function decodeInvite(payload) {
  const dot = payload.indexOf('.');
  if (dot <= 0) { lastDecodeFailure = '第一段不是"第一个点在中间"的形状（拿不到协议版本与压缩段）'; return null; }
  const segment = payload.slice(dot + 1);
  const marker = markerOfSegment(segment);
  const kind = kindOfMarker(marker);
  if (kind === null) { lastDecodeFailure = `压缩段带了一个不认得的标记 ${JSON.stringify(marker)}`; return null; }
  const body = segment.slice(marker.length);
  const buf = Buffer.from(body, 'base64url');
  let plain = null;
  try {
    if (kind === 'raw') plain = inflateRawSync(buf);
    else if (kind === 'deflate') plain = inflateSync(buf);
    else if (kind === 'gzip') plain = gunzipSync(buf);
    else plain = buf;
  } catch (e) {
    lastDecodeFailure = `压缩段解不开（标记 ${marker === '' ? "''（老格式）" : marker} ⇒ ${kind}）：`
      + String(e instanceof Error ? e.message : e);
    return null;
  }
  let tuple = null;
  try { tuple = JSON.parse(plain.toString('utf8')); } catch (e) {
    lastDecodeFailure = `解出来的正文不是 JSON：${String(e instanceof Error ? e.message : e)}`;
    return null;
  }
  if (!Array.isArray(tuple) || typeof tuple[2] !== 'string') {
    lastDecodeFailure = '解出来的不是那份位置数组（tuple[2] 不是字符串）';
    return null;
  }
  const sdp = tuple[2];
  const ice = Array.isArray(tuple[3]) ? tuple[3].filter((x) => typeof x === 'string' && x.length > 0) : [];
  const candidates = sdp.split(/\r?\n/).filter((l) => l.startsWith('a=candidate:'));
  const kinds = { host: 0, srflx: 0, prflx: 0, relay: 0, other: 0 };
  for (const c of candidates) {
    const m = /\btyp\s+([A-Za-z]+)/.exec(c);
    const t = m === null ? '' : m[1].toLowerCase();
    if (t === 'host' || t === 'srflx' || t === 'prflx' || t === 'relay') kinds[t] += 1;
    else kinds.other += 1;
  }
  return { protoVersion: payload.slice(0, dot), marker, kind, bodyLen: body.length,
    payloadVersion: tuple[0], sdpLen: sdp.length, candidates, kinds, iceField: ice };
}

/** 最近一次 `decodeInvite()` 为什么返回 `null`（只在报告/失败信息里用，不参与判定） */
let lastDecodeFailure = null;
const decodeFailureNote = (payload) => lastDecodeFailure ?? `只拿到 ${String(payload?.length ?? 0)} 个字符`;

/** 候选种类的中文名（与 `src/ui/net-browser.ts` 的 `KIND_LABELS` **同义**；屏上那句里就会出现它） */
const KIND_CN = { host: '本机（host）', srflx: '公网映射（srflx）', prflx: '对端映射（prflx）',
  relay: '中继（relay）', other: '类型认不出的' };

/**
 * ★ G5/T17：从一条 URL 里取 `#invite=` 那一段的载荷。
 *
 * 与 `src/net/invite.ts` 的 `inviteFragmentOf` **同义**（只吃 fragment；`?invite=` 与路径段不认），
 * 但这里是**测试侧独立实现**：这条腿要证的是"房主屏上那条链接里真的带着同一条载荷"，
 * 拿被测代码去验被测屏面等于自证。
 */
function linkFragmentOf(url) {
  if (typeof url !== 'string') return null;
  const i = url.indexOf('#');
  if (i < 0) return null;
  const frag = url.slice(i + 1);
  if (!frag.startsWith('invite=')) return null;
  const p = frag.slice('invite='.length);
  return p.length === 0 ? null : p;
}

/** 把种类的计数拼成屏上那句话里应当出现的那几个片段（判据③用它逐项对） */
function kindPhrases(kinds) {
  const out = [];
  for (const k of ['host', 'srflx', 'prflx', 'relay', 'other']) {
    if (kinds[k] > 0) out.push(`${KIND_CN[k]} ${String(kinds[k])} 个`);
  }
  return out;
}

/**
 * ★★ **G5/T18 修复轮：从屏上那句话读出"ICE 收集是怎么收工的"**。
 *
 * 为什么要有它：`note` 现在有**三种**来路（`src/ui/net-browser.ts` 的 `earlyEnoughNote` /
 * `partialGatherNote` / 正常收完那条 `null`），所以"没有 note ⇒ 收完了"那句推断**不再成立**
 * （早退也带话）。本函数只按屏上**确实写着**的字分类，不猜：
 *  - 空 ⇒ `complete`（正常收完）；
 *  - 含"等了" ⇒ `bounded`（宽限或上界到点放行，两句都长这样）；
 *  - 含"够用" ⇒ `early`（够用就收工，`stoppedEarly: true`）。
 */
function gatherOutcomeOf(notice) {
  const text = typeof notice === 'string' ? notice.trim() : '';
  if (text.length === 0) return { kind: 'complete', text: '(屏上没有额外的话)' };
  if (text.includes('等了')) return { kind: 'bounded', text };
  if (text.includes('够用')) return { kind: 'early', text };
  return { kind: 'other', text };
}

/* ── ★ G5/T42：①-b 造 `relayConfigured === false`（走大厅真界面） ───────────── */

/**
 * 走大厅的「高级 / 连接设置」把三项弄成**配了一半**。
 *
 * 为什么只有这一条路能造出 `relayConfigured === false`（`readIceServers`，T42 动手前核过）：
 *  - **三项为空** ⇒ 回默认值，里面**有**内置中继 ⇒ `relayConfigured: true`（`relaySource: 'builtin'`）；
 *  - **三项填齐** ⇒ 按玩家给的写 ⇒ `true`；
 *  - **只填一半**（URL 非空、用户名或凭据为空）⇒ 玩家那项**不换上**、回默认值，
 *    但报 `relayConfigured: false` + `relayIncomplete: true`（`net-browser.ts` 那一支就是这么写的）。
 * 大厅那个中继开关（`input.net-lobby-relay-toggle-box`）**只控制三个输入框显不显示**
 * （`net-lobby.ts` 的 `toggleRelay` 只翻 `s.relayOpen`），它跟 `iceServers` 一个字节都不沾。
 *
 * ⚠️ 三个输入框是**真 DOM 输入框 + `input` 事件**（`textInput()` 把 `onInput` 接在 DOM 事件上，
 * 不是受控组件）⇒ 直接设 `.value` 再派发 `input`/`change` 就是产品的正常输入路径。
 */
async function setRelayHalfConfigured(p, turnUrl) {
  const fail = (step) => ({ ok: false, step, relayConfigured: null, settings: null, inputsReadback: null });
  const probeSnapshot = async () => {
    const out = await p.evaluate('typeof window.__g5Match === "object" ? JSON.stringify(window.__g5Match.ice()) : null');
    try { return JSON.parse(String(out)); } catch { return null; }
  };
  /** 点一下屏上某个选择器（真 `click` 事件按顺序派发） */
  const clickSel = (sel) => p.evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(sel)});
    if (el === null) return false;
    for (const t of ['mousedown', 'mouseup', 'click']) el.dispatchEvent(new Event(t, { bubbles: true }));
    return true;
  })()`);
  /**
   * ★ **勾选框**要按"从**未勾**到勾上"来点：`relayOpen` 是渲染时用 `box.checked = relayShown`
   * 写进 DOM 的，而 `box.checked = true` 是**用户赋值**（之后 `getAttribute('checked')` 仍是 null）
   * ⇒ 如果我把它设成 `true` 之后又点一次，渲染层按 `s.relayOpen` 算出的仍是"没变"（它读的是自己的
   * 状态，不是 DOM）⇒ 三个输入框**永远不出现**（实测 `dbg-run4.txt`：面板开了、勾选框找不到时
   * 报的就是这一格）。所以这里先把它按回 `false` 再派发 `change`，下一次状态翻转一定是"勾上"。
   */
  const checkBox = (sel) => p.evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(sel)});
    if (el === null) return false;
    if (el.checked === true) el.checked = false;
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  const count = async (sel) => Number(await p.evaluate(`document.querySelectorAll(${JSON.stringify(sel)}).length`));
  /**
   * 点到"条件成立"为止（每次点完等 700ms 让那一帧画完）。
   *
   * ⚠️ **为什么不能点一下就当它成了**（2026-09-28 实测，`.superpowers/g5-T42/dbg-run3.txt`）：
   * 这一路走到大厅时那一屏可能还停在**"还没选角色"**（`role === null` ⇒ 只有两张入口卡，
   * 没有「生成邀请码」按钮）；一次点击落在应用自己那次重渲染上就会被整棵树换掉、**静默无效**。
   * 大厅那几处（选角色 / 展开高级 / 展开 TURN）都是这样，所以各自点到条件成立为止，
   * 失败要能说出点了几次、当时屏上是什么。
   */
  const clickUntil = async (sel, cond, fire = clickSel, tries = 6) => {
    let hits = 0;
    for (let i = 0; i < tries; i += 1) {
      if (await cond()) return { ok: true, hits };
      if (!(await fire(sel))) return { ok: false, hits, why: `屏上找不到 ${sel}` };
      hits += 1;
      await sleep(700);
    }
    return { ok: await cond(), hits, why: `点了 ${String(hits)} 次，条件一直没成立` };
  };

  // 1) 选角色：必须真的点到"房主那一屏"（`.net-lobby-make-invite` 在屏上）
  const role = await clickUntil('.net-lobby-host', async () => (await count('.net-lobby-make-invite')) > 0);
  if (!role.ok) {
    return fail(`选角色那一步没成：${String(role.why)}`
      + `（大厅屏 ${String(await count('.net-lobby-screen'))} 个；入口卡 ${String(await count('.net-lobby-host'))} 个）`);
  }
  // 2) 展开「高级 / 连接设置」：点到面板真的渲染出来
  const panel = await clickUntil('.net-lobby-advanced-toggle',
    async () => (await count('div.net-lobby-advanced-panel')) > 0);
  if (!panel.ok) return fail(`展开「高级 / 连接设置」没成：${String(panel.why)}`);
  // 3) 展开 TURN 三项（那个勾选框只翻 `relayOpen`，不碰 iceServers）
  const box = await clickUntil('input.net-lobby-relay-toggle-box',
    async () => (await count('input.net-lobby-turn-url-input')) > 0, checkBox);
  if (!box.ok) return fail(`展开 TURN 三项没成：${String(box.why)}`);
  // 4) URL 填上、用户名与凭据清空 ⇒ readIceServers() 走"配了一半"那一支
  const wrote = await p.evaluate(`(() => {
    const q = (c) => document.querySelector('input.' + c);
    const set = (el, v) => {
      if (el === null) return false;
      el.value = v;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    };
    const url = set(q('net-lobby-turn-url-input'), ${JSON.stringify(turnUrl)});
    const user = set(q('net-lobby-turn-user-input'), '');
    const cred = set(q('net-lobby-turn-cred-input'), '');
    return JSON.stringify({ url, user, cred });
  })()`);
  await sleep(500);
  let flags = { url: false, user: false, cred: false };
  try { flags = JSON.parse(String(wrote)); } catch { flags = { url: false, user: false, cred: false }; }
  if (!flags.url || !flags.user || !flags.cred) return fail(`三个 TURN 输入框没有全部写到（${String(wrote)}）`);
  const readback = await p.evaluate(`(() => JSON.stringify({
    url: document.querySelector('input.net-lobby-turn-url-input')?.value ?? null,
    user: document.querySelector('input.net-lobby-turn-user-input')?.value ?? null,
    cred: document.querySelector('input.net-lobby-turn-cred-input')?.value ?? null,
  }))()`);
  say(`  [记录] ①-b 三个输入框的写后读数：${String(readback)}`);
  const settings = await probeSnapshot();
  return {
    ok: settings !== null && settings.relayConfigured === false,
    step: '大厅真界面：点「建房（生成邀请码）」定下房主那一屏 ⇒ 点开「高级 / 连接设置」'
      + ' ⇒ 勾上「改用我自己的中继（TURN）」展开三项 '
      + `⇒ URL 填 ${turnUrl}、用户名与凭据清空`,
    relayConfigured: settings === null ? null : settings.relayConfigured === true,
    settings,
    inputsReadback: readback,
  };
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
say(`port   = ${vitePort}（内核给的；不在禁用表 ${FORBIDDEN_PORTS.join('/')} 里 —— 5173/3080 一个都不碰）`);
say(`注入    = iceServers 被强制换成 ${UNREACHABLE_STUN}（TEST-NET-1，必然不可达）`);
say(`budget = ${WAIT_S}s / 步`);
say('');

const vite = spawn(process.execPath, [VITE_BIN, '--port', String(vitePort), '--strictPort',
  '--host', '127.0.0.1', '--clearScreen', 'false'], { cwd: ROOT, stdio: 'ignore' });

const judged = [];
const push = (ok, what) => { judged.push({ ok, what }); say(`  [${ok ? '通过' : '不通过'}] ${what}`); };
const notes = [];
let hostInst = null;
let guestInst = null;
let negInst = null;
/** ★ G5/T42：①-b 那一台（专造"配了一半 ⇒ relayConfigured === false"的那个房主） */
let relayInst = null;
let host = null;
let guest = null;
let neg = null;
let relay = null;
const raw = { when: new Date().toISOString(), chrome, vitePort, waitS: WAIT_S, unreachableStun: UNREACHABLE_STUN };
let envError = null;
const cleanupErrors = [];

try {
  if (!(await httpOk(`${origin}/`, 40000))) throw new Error('vite 没起来（40s 内没有 HTTP 200）');

  hostInst = await launchChrome(chrome);
  guestInst = await launchChrome(chrome);
  negInst = await launchChrome(chrome);
  host = await attach('host', hostInst.port, 'about:blank');
  guest = await attach('guest', guestInst.port, 'about:blank');
  neg = await attach('neg', negInst.port, 'about:blank');
  say(`chrome 调试端口：host=${hostInst.port} guest=${guestInst.port} neg=${negInst.port}`
    + '（都是 --remote-debugging-port=0）');
  // ★ 注入**必须在导航之前**：下一次文档的任何脚本之前就会跑（生产代码零改动）
  await host.injectOnNewDocument(stunOverrideScript(UNREACHABLE_STUN));
  await guest.injectOnNewDocument(stunOverrideScript(UNREACHABLE_STUN));
  await host.navigate(`${origin}/`);
  await guest.navigate(`${origin}/`);
  // ★ 注入有没有生效**当场自证**：探针对象必须在页面一加载就存在（否则这一轮所有读数都不是被测世界）
  for (const [name, p] of [['host', host], ['guest', guest]]) {
    const hasProbe = await p.evaluate('typeof window.__iceProbe');
    if (hasProbe !== 'object') {
      throw new Error(`${name}: 注入没生效（window.__iceProbe = ${String(hasProbe)}）—— 拒绝在"真实网络"上得出读数`);
    }
  }
  say('');

  /* ── ⑥（只记录）两家公共 STUN 在这台机器上的可达性 ─────────────────────── */
  say('=== ⑥（只记录、不判定）公共 STUN 在这台机器上的可达性 ===');
  {
    const probeExpr = `(async () => {
      const out = [];
      for (const url of ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478']) {
        const pc = new RTCPeerConnection({ iceServers: [{ urls: [url] }] });
        const seen = [];
        pc.addEventListener('icecandidate', (ev) => {
          if (ev && ev.candidate && ev.candidate.candidate) seen.push(ev.candidate.candidate);
        });
        const t0 = Date.now();
        try {
          pc.createDataChannel('probe');
          await pc.setLocalDescription(await pc.createOffer());
          while (Date.now() - t0 < 8000 && pc.iceGatheringState !== 'complete') {
            await new Promise((r) => setTimeout(r, 100));
          }
        } catch (e) { out.push({ url, error: String(e) }); continue; }
        const kinds = {};
        for (const c of seen) {
          const m = /\\btyp\\s+([A-Za-z]+)/.exec(c);
          const k = m ? m[1] : '?';
          kinds[k] = (kinds[k] || 0) + 1;
        }
        out.push({ url, ms: Date.now() - t0, state: pc.iceGatheringState, total: seen.length, kinds });
        pc.close();
      }
      return JSON.stringify(out);
    })()`;
    // 这一格**不是门禁**：这台开发机的出网策略与用户那张网无关，读数只作为"要不要加第三个 STUN"的现场依据
    const got = await neg.evaluate(probeExpr);
    raw.publicStunProbe = typeof got === 'string' ? JSON.parse(got) : null;
    if (raw.publicStunProbe === null) {
      say('  读不到（页面探针没返回）—— 这一格只记录，不影响判定');
    } else {
      for (const r of raw.publicStunProbe) {
        say(`  ${r.url}：${r.error !== undefined ? `抛错 ${r.error}` : `${r.ms}ms 内 state=${r.state}，候选 ${r.total} 个 `
          + `(${JSON.stringify(r.kinds)})`}`);
      }
      const cf = raw.publicStunProbe.find((r) => String(r.url).includes('cloudflare'));
      notes.push(`⑥ 这台机器到公共 STUN 的可达性（只记录）：${JSON.stringify(raw.publicStunProbe)}`
        + `（Cloudflare 那一条拿到 srflx 了吗：${cf && cf.kinds && cf.kinds.srflx ? '是' : '否'}）`);
    }
    say('');
  }

  const hDrive = await driveToLobby(host);
  const gDrive = await driveToLobby(guest);
  say(`驱动到大厅：host ${hDrive ?? 'ok'} / guest ${gDrive ?? 'ok'}`);
  say('');

  /* ── ①-a 房主：默认配置（含内置中继）+ 注入的 STUN 不可达 ⇒ 严格档等满上界 ─────── */
  say(`=== ①-a 严格档：默认配置里有中继（T38 起）而 ${UNREACHABLE_STUN} 不可达`
    + ' ⇒ iceGatheringState 到不了 complete ⇒ 等满 15 秒上界才放行 ===');
  let invitePayload = null;
  /** ★ G5/T17：房主屏上那条**整条链接**（`.net-lobby-invite-link` 的正文）——用户真机粘的就是它 */
  let inviteLink = null;
  let hostNotice = null;
  let hostProbeAtInvite = null;
  let inviteMs = null;
  if (hDrive !== null) {
    push(false, `房主这一屏驱动失败：${hDrive}`);
  } else {
    await host.click('.net-lobby-host');
    const hasMake = await host.waitFor('.net-lobby-make-invite', 8000);
    if (!hasMake) {
      push(false, '点「建房（生成邀请码）」之后屏上没有出现「生成邀请码」按钮');
    } else {
      const t0 = Date.now();
      await host.click('.net-lobby-make-invite');
      const appeared = await host.waitFor('.net-lobby-invite-payload', budgetMs);
      inviteMs = Date.now() - t0;
      invitePayload = appeared ? await host.text('.net-lobby-invite-payload') : null;
      inviteLink = appeared ? await host.text('.net-lobby-invite-link') : null;
      hostNotice = await host.text('.net-lobby-notice');
      hostProbeAtInvite = await host.evaluate('JSON.stringify(window.__iceProbe ?? null)');
      let probe = null;
      try { probe = JSON.parse(String(hostProbeAtInvite)); } catch { probe = null; }
      raw.hostProbe = probe;
      raw.hostNoticeAtInvite = hostNotice;
      raw.inviteMs = inviteMs;
      // ①-a 页内探针确实被应用用上了（否则"注入"这件事本身没生效，后面所有读数都没意义）
      push(probe !== null && Array.isArray(probe.configs) && probe.configs.length > 0,
        probe !== null && Array.isArray(probe.configs) && probe.configs.length > 0
          ? `注入生效：应用真的建了 ${probe.pcs} 条连接，构造参数被改成 ${UNREACHABLE_STUN}`
          : '注入没生效（页内探针一条连接都没记到）—— 后面的读数都不能算');
      // 到不了 complete（**保留**的那一格：没有它就证不了"STUN 不可达"这件事真的造出来了）
      const states = probe === null || !Array.isArray(probe.states) ? [] : probe.states;
      const completed = states.filter((s) => s[1] === 'complete');
      raw.hostStatesAtInvite = states;
      raw.hostTimelineAtInvite = probe?.timeline ?? null;
      push(completed.length === 0,
        completed.length === 0
          ? `邀请码出现那一刻（${String(inviteMs)}ms）之前 iceGatheringState 一次都没到过 complete`
            + `（状态变化：${JSON.stringify(states)}；时间线：${JSON.stringify(probe?.timeline ?? null)}；`
            + `iceCandidateError ${String(probe?.errors?.length ?? 0)} 条）`
          : `居然到过 complete（${JSON.stringify(completed)}）—— "STUN 不可达"这一格没有造出来`);
      /**
       * ★★ **①-a 严格档（G5/T42 改口径：这一格量的不再是 1.5 秒宽限）**。
       *
       * T38 起默认那三项设置里就有一台中继 ⇒ `readIceServers().relayConfigured === true`
       * ⇒ `waitForIceGathering` 走**严格档**（`enoughCandidatesForInvite(ice, true)` 要求 relay ≥ 1）
       * ⇒ 中继不可达时**真的等满 15 秒上界**再放行。这一格钉三件事：
       *  1. 出码时刻落在**上界那一档**（≥14s；上界本身是 15000ms，留 1s 余量，
       *     另给一个宽松上界 30s 只为挡住"卡到远超上界"，不把 15s 写死成精确值）；
       *  2. 收工方式是 `bounded`（含"等了"那一句），且那句里**同时**有"等了 15 秒"与
       *     "你配了中继，但这一轮中继地址也没收到"（后半句是本轮契约的核心：配了中继而
       *     relay 没到手这件事必须被说出来 —— 它变红就说明产品不再说这件事了）；
       *  3. `iceGatheringState` 一次都没到过 `complete`（上一格）。
       *
       * ⚠️ 宽限那一档（T18 的修复）现在由 **①-b** 专门造 `relayConfigured === false` 来量 ——
       * 上面这份"默认配置"是造不出宽限档的（有中继就不排宽限计时器）。
       */
      const outcome = gatherOutcomeOf(hostNotice);
      raw.hostOutcomeAtInvite = outcome;
      const upperBoundNote = '你配了中继，但这一轮中继地址也没收到';
      /**
       * ⚠️ **上界 20000 这一头必须有牙**（T42 修复轮，评审指出 `<= 30000` 是无牙合取项）：
       * `inviteMs` 就是 `waitFor('.net-lobby-invite-payload', budgetMs)` 的墙钟耗时，而
       * `budgetMs = WAIT_S*1000 = 30000` ⇒ 原来那个 `<= 30000` 等于"没拿到码就等满预算"，
       * **产品把上界从 15s 放宽到 25s 也照样绿**。实测三次 15160 / 15197 / 15204ms（这一轮
       * 又量到 15222 / 15274ms）⇒ 收成 `<= 20000`：两边各留几秒给慢机器，25s 那种一定红。
       */
      const STRICT_MS_MIN = 14000;
      const STRICT_MS_MAX = 20000;
      const strictOk = typeof inviteMs === 'number' && inviteMs >= STRICT_MS_MIN && inviteMs <= STRICT_MS_MAX
        && outcome.kind === 'bounded' && outcome.text.includes('等了 15 秒')
        && outcome.text.includes(upperBoundNote);
      raw.strictUpperBound = { inviteMs, min: STRICT_MS_MIN, max: STRICT_MS_MAX, kind: outcome.kind,
        has15s: outcome.text.includes('等了 15 秒'), hasRelayNote: outcome.text.includes(upperBoundNote) };
      push(strictOk, strictOk
        ? `①-a 严格档：默认配置里有中继（不可达）⇒ ${String(inviteMs)}ms **走满上界**那一档才放行`
          + `（窗口 ${String(STRICT_MS_MIN)}-${String(STRICT_MS_MAX)}ms）；`
          + `那句里同时有"等了 15 秒"与"${upperBoundNote}"（收工方式 ${outcome.kind}）`
        : `①-a 严格档没量到（用时 ${String(inviteMs)}ms，窗口 ${String(STRICT_MS_MIN)}-${String(STRICT_MS_MAX)}ms；`
          + `收工方式 ${outcome.kind}；含"等了 15 秒"=${String(outcome.text.includes('等了 15 秒'))}；`
          + `含"${upperBoundNote}"=${String(outcome.text.includes(upperBoundNote))}）：「${outcome.text}」`);
    }
  }
  say('');

  /* ── ② 严格档（①-a）到点之后仍然产出邀请码 ─────────────────────────────── */
  say('=== ② ①-a 那份配置到点之后仍然产出邀请码（改之前这一格恒失败） ===');
  const shaped = typeof invitePayload === 'string' && /^\d+\.[A-Za-z0-9_-]{40,}$/.test(invitePayload);
  push(shaped, shaped
    ? `屏上产出了一条邀请码：${invitePayload.length} 个字符（用时 ${String(inviteMs)}ms）`
    : `屏上没有产出邀请码（通知：${hostNotice ?? '无'}）`);
  let decoded = null;
  /**
   * ★★ **G5/T42 修复轮：新码必须带显式压缩标记**（评审指出这条契约在门禁里不承重）。
   *
   * T40 起生成侧 `ENCODE_MARKER_OF_KIND` **一定**把标记写进压缩段（`raw` 也写成 `-r`），
   * 而本夹具把 `''`（老格式）与 `-r` **都**读成 raw ⇒ 产品哪天悄悄退回"无标记老格式"，
   * ② 照样绿（它只打印 marker、不判 marker）。所以单独一格钉住"标记非空且在四档里"，
   * 并把它落到 `raw.decoded` 里（"这一跑用的是哪一档"要能进报告）。
   * ⚠️ 老格式（`''`）仍是**读**得通的（向后兼容那条读路径不能破），但它不该是**新产出**的形状。
   */
  const MARKERS = ['-r', '-d', '-g', '-u'];
  const markerOk = (d) => d !== null && MARKERS.includes(d.marker);
  if (shaped) {
    decoded = decodeInvite(invitePayload);
    raw.invite = { length: invitePayload.length, ms: inviteMs, decoded };
    push(decoded !== null && decoded.candidates.length >= 1,
      decoded === null
        ? `邀请码解不开（node 侧：${decodeFailureNote(invitePayload)}）`
        : `邀请码真的解得开：压缩段标记 ${decoded.marker === '' ? "''（老格式，按 raw 读）" : decoded.marker}`
          + ` ⇒ ${decoded.kind}；SDP ${String(decoded.sdpLen)} 字符，候选 ${String(decoded.candidates.length)} 个`
          + `（${JSON.stringify(decoded.kinds)}），ice 字段 ${String(decoded.iceField.length)} 项`);
    raw.decoded = { marker: decoded?.marker ?? null, kind: decoded?.kind ?? null, length: invitePayload.length };
    push(markerOk(decoded), markerOk(decoded)
      ? `这条码的压缩段带了**显式标记** ${String(decoded.marker)}（T40 起生成侧一定写标记；`
        + `''（无标记老格式）只允许出现在**读**旧码那条路上）`
      : decoded === null
        ? `未到达：这条码解不开，读不出标记（${decodeFailureNote(invitePayload)}）`
        : `这条码的压缩段标记是 ${decoded.marker === '' ? "''（无标记老格式）" : decoded.marker}`
          + ` —— 不是 ${MARKERS.join(' / ')} 里的一档（T40 起新码必须显式写标记）`);
  } else {
    push(false, '未到达：②没有产出邀请码 ⇒ 解不开、也接不起来');
    push(false, '未到达：②没有产出邀请码 ⇒ 读不出压缩段标记');
  }
  say('');

  /* ── ②b ★ G5/T17：房主屏上给的是一条**整条链接**，且它就是这次要粘的东西 ──── */
  say('=== ②b G5/T17：房主屏上那条整条链接（加入方以前只吃纯载荷，用户真机就栽在这里） ===');
  {
    const frag = linkFragmentOf(inviteLink);
    const linkOk = typeof inviteLink === 'string' && /^https?:\/\//.test(inviteLink)
      && typeof invitePayload === 'string' && invitePayload.length > 0 && frag === invitePayload;
    raw.inviteLink = inviteLink;
    raw.inviteLinkFragmentMatches = frag === invitePayload;
    push(linkOk, linkOk
      ? `房主屏上那条**整条链接**（${inviteLink.length} 字符，${inviteLink.slice(0, inviteLink.indexOf('#'))}…）`
        + '里取出的 fragment 与裸载荷**逐字相同**'
      : `房主屏上那条链接取不出同一条载荷（link=${String(inviteLink).slice(0, 140)}；`
        + `fragment=${String(frag).slice(0, 40)}）`);
  }
  say('');

  /* ── ①-b 宽限档：把设置弄成"配了一半"（relayConfigured === false）+ 不可达 STUN ─ */
  say('=== ①-b 宽限档：走真界面把中继弄成"配了一半"（relayConfigured === false）'
    + ' ⇒ 只有 host 时走 1.5 秒宽限（T18 那条修复量的是它） ===');
  {
    let relayStep = null;
    let relaySettingsBefore = null;
    let relayConfiguredFalse = null;
    let relaySettingsAfter = null;
    let relayMs = null;
    let relayNotice = null;
    let relayProbeAtInvite = null;
    let relayPayload = null;
    relayInst = await launchChrome(chrome);
    relay = await attach('relay', relayInst.port, 'about:blank');
    await relay.injectOnNewDocument(stunOverrideScript(UNREACHABLE_STUN));
    await relay.navigate(`${origin}/#g5probe=1`);
    // 注入有没有生效**当场自证**（与 host / guest 同一格纪律）
    const relayProbeType = await relay.evaluate('typeof window.__iceProbe');
    if (relayProbeType !== 'object') {
      throw new Error(`relay: 注入没生效（window.__iceProbe = ${String(relayProbeType)}）`
        + '—— 拒绝在"真实网络"上得出读数');
    }
    const rDrive = await driveToLobby(relay);
    if (rDrive !== null) {
      push(false, `①-b 那一屏驱动失败：${rDrive}`);
    } else {
      /**
       * ⚠️ **走真界面之前先给这一屏一点落定时间**（实测 2026-09-28，`.superpowers/g5-T42/dbg-run3.txt`）：
       * `driveToLobby()` 一返回时那一屏还可能停在**"还没选角色"**（`role === null` ⇒ 屏上只有两张
       * 入口卡），而应用自己那次重渲染会**静默吃掉**落在它身上的点击。
       * `setRelayHalfConfigured()` 里每一步都点到条件成立为止，这里的 800ms 只是让它少绕几圈。
       */
      await sleep(800);
      const pre = await relay.evaluate('JSON.stringify(window.__g5Match ? window.__g5Match.ice() : null)');
      try { relaySettingsBefore = JSON.parse(String(pre)); } catch { relaySettingsBefore = null; }
      const set = await setRelayHalfConfigured(relay, RELAY_HALF_CONFIGURED_URL);
      relayStep = set.step;
      relayConfiguredFalse = set.relayConfigured;
      relaySettingsAfter = set.settings;
      // 这一格必须有牙：设置没被改动（或探针读不到）时**当场红**，后面的读数才作数
      push(set.ok, set.ok
        ? `这一跑造出的 relayConfigured === false 是**"配了一半"**那一支：URL 非空、用户名与凭据为空`
          + `（relaySource=${String(relaySettingsAfter?.relaySource)}、`
          + `relayIncomplete=${String(relaySettingsAfter?.relayIncomplete)}、`
          + `settingsAreDefault=${String(relaySettingsAfter?.settingsAreDefault)}；`
          + `写后读数 ${String(set.inputsReadback)}）；`
          + `改之前那一份是 relayConfigured=${String(relaySettingsBefore?.relayConfigured)}`
        : `没能把设置弄成 relayConfigured === false（${String(relayStep)}；读到 ${String(pre)}）`);
      if (set.ok) {
        const t0r = Date.now();
        await relay.click('.net-lobby-make-invite');
        const rAppeared = await relay.waitFor('.net-lobby-invite-payload', budgetMs);
        relayMs = Date.now() - t0r;
        relayPayload = rAppeared ? await relay.text('.net-lobby-invite-payload') : null;
        relayNotice = await relay.text('.net-lobby-notice');
        const rProbeRaw = await relay.evaluate('JSON.stringify(window.__iceProbe ?? null)');
        try { relayProbeAtInvite = JSON.parse(String(rProbeRaw)); } catch { relayProbeAtInvite = null; }
        const rOutcome = gatherOutcomeOf(relayNotice);
        raw.relayHalfConfigured = {
          settingsBefore: relaySettingsBefore, settingsAfter: relaySettingsAfter,
          inputsReadback: set.inputsReadback,
          step: relayStep, inviteMs: relayMs, notice: relayNotice, outcome: rOutcome,
          payloadLength: typeof relayPayload === 'string' ? relayPayload.length : null,
          probeStates: relayProbeAtInvite?.states ?? null,
        };
        const graceOk = typeof relayMs === 'number' && relayMs >= 1000 && relayMs < 10000
          && rOutcome.kind === 'bounded' && rOutcome.text.includes('等了 1.5 秒')
          && !rOutcome.text.includes('你配了中继');
        push(graceOk, graceOk
          ? `①-b 宽限档：这套配置没有可用中继（relayConfigured === false）+ STUN 不可达`
            + ` ⇒ ${String(relayMs)}ms 就走**1.5 秒宽限**那一档放行（不是 15 秒上界）；`
            + `那句里含"等了 1.5 秒"、不含"你配了中继"：「${rOutcome.text}」`
          : `①-b 宽限档没量到（用时 ${String(relayMs)}ms；收工方式 ${rOutcome.kind}；`
            + `含"等了 1.5 秒"=${String(rOutcome.text.includes('等了 1.5 秒'))}；`
            + `含"你配了中继"=${String(rOutcome.text.includes('你配了中继'))}）：「${rOutcome.text}」`);
        const rShaped = typeof relayPayload === 'string' && /^\d+\.[A-Za-z0-9_-]{40,}$/.test(relayPayload);
        push(rShaped, rShaped
          ? `①-b 这条路照样产出了邀请码：${String(relayPayload.length)} 个字符`
          : `①-b 这条路没有产出邀请码（通知：${String(relayNotice ?? '无')}）`);
        /**
         * ★ T42 修复轮顺手加的一格：①-b 那条码也过同一份"必须带显式标记"的判定。
         * 顺手能判就判 —— 这一格用的是同一个 `decodeInvite()` + 同一张 `MARKERS` 表，
         * 成本是多解一条码；好处是"标记契约"在**两份不同配置**产出的码上都被钉住。
         */
        const rDecoded = rShaped ? decodeInvite(relayPayload) : null;
        raw.relayHalfConfigured.payloadMarker = rDecoded?.marker ?? null;
        push(markerOk(rDecoded), markerOk(rDecoded)
          ? `①-b 那条码也带了显式标记 ${String(rDecoded.marker)}（⇒ ${String(rDecoded.kind)}）`
          : rShaped
            ? `①-b 那条码的标记不对（${rDecoded === null ? decodeFailureNote(relayPayload) : `读到 ${JSON.stringify(rDecoded.marker)}`}）`
            : '未到达：①-b 没有产出邀请码 ⇒ 读不出标记');
      } else {
        push(false, '未到达：①-b 的设置没造成 ⇒ 宽限那一档量不到');
        push(false, '未到达：①-b 没有产出邀请码');
        push(false, '未到达：①-b 没有产出邀请码 ⇒ 读不出标记');
      }
    }
  }
  say('');

  /* ── ③ 屏上那句话与实测一致 ───────────────────────────────────────────── */
  say('=== ③ 屏上那句话与实测（候选个数 / 种类）逐项对得上 ===');
  if (decoded === null) {
    push(false, '未到达：没有可对照的邀请码（②没产出）');
  } else {
    const notice = hostNotice ?? '';
    raw.noticeChecks = { notice };
    // ③-a 那句话里必须逐个出现"种类 + 个数"（数字来自 SDP 实测，屏上不许自己编一个）
    const phrases = kindPhrases(decoded.kinds);
    const missing = phrases.filter((w) => !notice.includes(w));
    raw.noticeChecks.phrases = phrases;
    raw.noticeChecks.missing = missing;
    push(missing.length === 0, missing.length === 0
      ? `屏上那句把实测的候选项逐条说了出来：${phrases.join('、')}`
      : `屏上那句少了${missing.join('、')}（实测 ${JSON.stringify(decoded.kinds)}；屏上：「${notice}」）`);
    // ③-b 与页内探针的候选**计数**也要对得上（两条独立读数交叉验证）
    let probeCandidates = null;
    try { probeCandidates = JSON.parse(String(hostProbeAtInvite))?.candidates ?? null; } catch { probeCandidates = null; }
    raw.noticeChecks.probeCandidates = probeCandidates;
    raw.noticeChecks.sdpCandidates = decoded.candidates.length;
    push(probeCandidates === decoded.candidates.length,
      probeCandidates === decoded.candidates.length
        ? `两条独立读数一致：页内 icecandidate 事件 ${String(probeCandidates)} 个 = 邀请码 SDP 里 ${String(decoded.candidates.length)} 个`
        : `两条读数不一致（页内 ${String(probeCandidates)} / SDP ${String(decoded.candidates.length)}）—— 要查`);
    // ③-c 跨网那句必须是"还不知道"，且**不许**出现旧的猜测措辞
    const saysUnknown = notice.includes('还不知道');
    const noGuess = !notice.includes('对端的网络') && !notice.includes('挡住了');
    raw.noticeChecks.saysUnknown = saysUnknown;
    raw.noticeChecks.noGuessPhrase = noGuess;
    push(saysUnknown && noGuess, saysUnknown && noGuess
      ? '那句话把跨网说成"还不知道"（没有把候选不全写成能用），且没有旧的猜测措辞'
      : `那句话的口径不对（含"还不知道"=${String(saysUnknown)}；不含旧猜测=${String(noGuess)}）：「${notice}」`);
  }
  say('');

  /* ── ④ ★ G5/T17：把房主屏上那条**整条链接**真粘进加入方的粘贴框 ─────────── */
  say('=== ④ 把房主屏上那条整条链接真粘进加入方的粘贴框 ⇒ 两端走到硬币屏 ===');
  let answerCode = null;
  let guestNotice = null;
  /** ★ G5/T17 的读数：那句界面提示 / 加入方到底吃没吃下那条**整条链接** */
  let pasteHint = null;
  let linkAccepted = false;
  if (inviteLink === null) {
    push(false, '未到达：房主屏上没有可粘的整条链接（②没产出）');
  } else if (gDrive !== null) {
    push(false, `加入方这一屏驱动失败：${gDrive}`);
  } else {
    if ((await guest.count('.net-lobby-paste-input')) === 0 && (await guest.count('.net-lobby-join')) > 0) {
      await guest.click('.net-lobby-join');
    }
    const hasPaste = await guest.waitFor('.net-lobby-paste-input', 8000);
    if (!hasPaste) {
      push(false, '点「加入」之后屏上没有出现粘贴邀请码的输入框');
    } else {
      /**
       * ★ G5/T17 的界面提示那一格：粘贴框旁边那句短提示必须在屏上，且三种形态都点名。
       * （读在**粘之前**：粘完整链接之后这一屏会被硬币屏替掉。）
       */
      pasteHint = await guest.text('.net-lobby-paste-hint');
      const hintOk = typeof pasteHint === 'string'
        && pasteHint.includes('链接') && pasteHint.includes('#invite=') && pasteHint.includes('邀请码');
      raw.pasteHint = pasteHint;
      push(hintOk, hintOk
        ? `粘贴框旁边那句提示在屏上、三种形态都点名了：「${pasteHint}」`
        : `粘贴框旁边没有那句提示（读到：${String(pasteHint)}）`);
      // ★ 真鼠标先点进输入框（记一笔焦点读数，**不判定** —— 无头 Chrome 的焦点行为不是被测对象）
      await guest.click('.net-lobby-paste-input');
      const focused = await guest.evaluate(
        "document.querySelector('.net-lobby-paste-input') === document.activeElement");
      raw.pasteInputFocused = focused === true;
      // ★ 真输入：粘的是**整条链接**（用户真机实测那一次就是这么粘的）
      await guest.type('.net-lobby-paste-input', inviteLink);
      const hasAnswer = await guest.waitFor('.net-lobby-make-answer', 20000);
      raw.linkAccepted = hasAnswer;
      linkAccepted = hasAnswer;
      // ★ G5/T17 的那一格：**整条链接**被吃下了（改之前这一格恒红：屏上会是一句"开头不是整数"）
      push(hasAnswer, hasAnswer
        ? '整条链接粘进粘贴框之后加入方真的收下了（屏上出现「出示回示码」）'
        : `整条链接没被收下（输入框旁边那句：${(await guest.text('.net-lobby-error')) ?? '无'}）`);
      if (!hasAnswer) {
        push(false, `贴了整条链接之后没有「出示回示码」按钮（通知：${(await guest.text('.net-lobby-notice')) ?? '无'}）`);
      } else {
        const tAns = Date.now();
        /**
         * ★ **有界重试**（计划 §9 第 32/43 条登记的"这一步没有重试"）：这一格过去偶发"点了没反应"
         * （判定个位数 + exit 1、紧接着重跑全绿）。**只加重试，判定集一个字没动**：每次重试仍然是
         * 真点击 + 同样的 `waitFor` 上界；三次都拿不到码 ⇒ 照旧 `answerCode = null`，后面的判定照旧判红。
         * 重试次数与既有那道大厅门的写法同量级（大厅门是 3 次）。
         */
        let appeared = false;
        for (let attempt = 1; attempt <= 3 && !appeared; attempt += 1) {
          await guest.click('.net-lobby-make-answer');
          appeared = await guest.waitFor('.net-lobby-answer-code', budgetMs);
          if (!appeared) raw[`guestAnswerAttempt${String(attempt)}Failed`] = true;
        }
        answerCode = appeared ? await guest.text('.net-lobby-answer-code') : null;
        guestNotice = await guest.text('.net-lobby-notice');
        raw.guestAnswerMs = Date.now() - tAns;
        raw.guestNoticeAtAnswer = guestNotice;
        const guestProbeRaw = await guest.evaluate('JSON.stringify(window.__iceProbe ?? null)');
        try { raw.guestProbe = JSON.parse(String(guestProbeRaw)); } catch { raw.guestProbe = null; }
        raw.guestAnswer = typeof answerCode === 'string' && answerCode.length > 0 ? decodeInvite(answerCode) : null;
        /**
         * ★★ **G5/T18 修复轮**：收工方式**按屏上确实写着的字分类**（`gatherOutcomeOf`），
         * 不再用"没有 note ⇒ 收完了"那句推断 —— 早退现在也带话，那句已经不成立了。
         */
        const guestOutcome = gatherOutcomeOf(guestNotice);
        raw.guestOutcomeAtAnswer = guestOutcome;
        push(guestOutcome.kind !== 'other', guestOutcome.kind !== 'other'
          ? `加入方那条路的收工方式可读：${guestOutcome.kind}（${guestOutcome.text}）`
          : `加入方屏上那句话读不出收工方式（既不是空、也不含"等了/够用"）：「${guestOutcome.text}」`);
        push(typeof answerCode === 'string' && answerCode.length > 0,
          typeof answerCode === 'string' && answerCode.length > 0
            ? `加入方产出了回示码：${answerCode.length} 个字符（用时 ${String(raw.guestAnswerMs)}ms；`
              + `收方那条路的候选 ${String(raw.guestAnswer?.candidates?.length ?? 0)} 个 `
              + `${JSON.stringify(raw.guestAnswer?.kinds ?? null)}；`
              + `收工方式：${guestOutcome.kind}）`
            : `加入方没有产出回示码（屏上：${(await guest.text('.net-lobby-error')) ?? (await guest.text('.net-lobby-notice')) ?? '无'}）`);
      }
    }
  }
  if (answerCode !== null && (await host.count('.net-lobby-answer-input')) > 0) {
    await host.type('.net-lobby-answer-input', answerCode);
    const hostCoin = await host.waitFor('.coin-face-chip', budgetMs);
    const guestCoin = await guest.waitFor('.coin-face-chip', budgetMs);
    const hostPhase = await phaseOfSide(host);
    const guestPhase = await phaseOfSide(guest);
    raw.handshake = { hostCoin, guestCoin, hostPhase, guestPhase };
    // ④ 的判据：**两端都走到硬币屏**（那是"握手真的推进了"在屏上的落点），相位一并留盘
    push(hostCoin && guestCoin,
      hostCoin && guestCoin
        ? `两端都走到硬币屏：房主相位 ${String(hostPhase)} / 加入方相位 ${String(guestPhase)}`
        : `没有接起来：房主硬币屏 ${hostCoin ? '有' : '没有'} / 加入方硬币屏 ${guestCoin ? '有' : '没有'}`
          + `（相位：房主 ${String(hostPhase)} / 加入方 ${String(guestPhase)}）`);
    /**
     * ★ G5/T17 的整格：**"粘进去的是整条链接"这件事与"两端走到硬币屏"连起来**。
     * 它与上一条分开judged：上一条只说"接起来了"，这一条钉的是"接起来用的那条链接
     * 是**原样整条**粘进去的"——改之前加入方连收都收不下（`linkAccepted` 恒 false）。
     */
    push(linkAccepted && hostCoin && guestCoin,
      linkAccepted && hostCoin && guestCoin
        ? '整条链接原样粘进粘贴框 ⇒ 加入方收下 ⇒ 两端都走到硬币屏（T17 的那一格）'
        : `整条链接那一格没走通：加入方收下=${String(linkAccepted)} / 房主硬币屏=${String(hostCoin)}`
          + ` / 加入方硬币屏=${String(guestCoin)}`);
  } else if (answerCode === null) {
    push(false, '未到达：没有可贴回去的回示码（②/④上半没产出）');
  }
  say('');

  /* ── ⑤ 负控：0 候选 ⇒ 硬失败，且理由准 ────────────────────────────────── */
  say('=== ⑤ 负控：0 候选（假件永远 gathering、SDP 里一条候选都没有）⇒ 硬失败 ===');
  {
    await neg.injectOnNewDocument(emptyCandidateScript());
    await neg.navigate(`${origin}/?g5neg=1`);
    const nDrive = await driveToLobby(neg);
    if (nDrive !== null) {
      push(false, `负控那一屏驱动失败：${nDrive}`);
    } else {
      await neg.click('.net-lobby-host');
      await neg.waitFor('.net-lobby-make-invite', 8000);
      const t0 = Date.now();
      await neg.click('.net-lobby-make-invite');
      /**
       * 等它走完上界（15 秒）+ 余量：**必须**先确认"等过"这件事真的发生过，
       * 否则下面那句"失败"可能只是"还没轮到"。
       * ⚠️ `正在建立链路…` 那一句**不算结论**（它是 `waitLobbyLinkReady` 的过程提示），
       * 拿它当结论会让这一格在 0ms 就"通过"。
       */
      let notice = null;
      const negBudget = Math.max(budgetMs, 20000);
      while (Date.now() - t0 < negBudget) {
        const n = await neg.text('.net-lobby-notice');
        if (typeof n === 'string' && n.length > 0 && !n.startsWith('正在建立链路')) { notice = n; break; }
        await sleep(300);
      }
      const waitedMs = Date.now() - t0;
      const inviteCount = await neg.count('.net-lobby-invite-payload');
      const probeNeg = await neg.evaluate('JSON.stringify(window.__iceProbe ?? null)');
      let probe = null;
      try { probe = JSON.parse(String(probeNeg)); } catch { probe = null; }
      raw.negative = { waitedMs, notice, inviteCount, probe };
      push(probe !== null && probe.offers > 0,
        probe !== null && probe.offers > 0
          ? `负控夹具真的被用上了：应用走到 createOffer（${String(probe.offers)} 次）才开始等候选`
          : '负控夹具没被用上（应用没走到 createOffer）—— 这一格不成立');
      push(waitedMs >= 14000,
        waitedMs >= 14000
          ? `失败是在**上界之后**才出现的（${String(waitedMs)}ms ≥ 15000ms 上界的下限）`
          : `失败来得太早（${String(waitedMs)}ms）—— 那不是"上界到点"那一支，这一格不算`);
      push(inviteCount === 0 && (notice ?? '').includes('一个') && (notice ?? '').includes('候选'),
        inviteCount === 0 && (notice ?? '').includes('一个') && (notice ?? '').includes('候选')
          ? `0 候选 ⇒ 硬失败：屏上没有邀请码，理由说清了本侧的事实：「${notice ?? ''}」`
          : `0 候选那一格的结论不对（邀请码个数 ${String(inviteCount)}；屏上：「${notice ?? '无'}」）`);
      push(!(notice ?? '').includes('对端'),
        !(notice ?? '').includes('对端')
          ? '理由里没有"对端"二字（不再猜对端的网络）'
          : `理由里出现"对端"（旧的猜测措辞又回来了）：「${notice ?? ''}」`);
    }
  }
  say('');
} catch (e) {
  envError = String(e);
  say(`\n[X] 环境错误：${envError}`);
} finally {
  if (host) host.close();
  if (guest) guest.close();
  if (neg) neg.close();
  if (relay) relay.close();
  if (!KEEP) {
    killTree(hostInst?.proc.pid);
    killTree(guestInst?.proc.pid);
    killTree(negInst?.proc.pid);
    killTree(relayInst?.proc.pid);
    killTree(vite.pid);
    await sleep(600);
    // ★ 两轮杀（T11-C 的实验结论）：`taskkill /T /F` 第一轮有时只杀掉顶层进程，
    //   子进程还握着 profile 里的文件 ⇒ `rmSync` 一直失败
    for (const inst of [hostInst, guestInst, negInst, relayInst]) {
      if (!inst) continue;
      for (let i = 0; i < 3; i += 1) {
        killTree(inst.proc.pid);
        await sleep(500);
      }
    }
    for (const p of [hostInst?.profile, guestInst?.profile, negInst?.profile, relayInst?.profile]) {
      if (!p) continue;
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
  const ports = [['vite dev server', vitePort], ['host 调试端口', hostInst?.port],
    ['guest 调试端口', guestInst?.port], ['neg 调试端口', negInst?.port],
    ['relay 调试端口（①-b 那一台）', relayInst?.port]];
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
    const mine = [hostInst?.profile, guestInst?.profile, negInst?.profile, relayInst?.profile]
      .some((p) => p !== undefined && p.endsWith(n));
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
  say(`原始读数已写入 ${JSON_OUT}`);
}
if (envError !== null) process.exit(2);
for (const n of notes) say(`注：${n}`);
say(`判定 ${pass}/${judged.length} 条通过${clean ? '' : '（收工自证不干净）'}`);
say(verdict ? '\n全部判定通过。' : '\n有判定不通过。');
process.exit(verdict ? 0 : 1);
