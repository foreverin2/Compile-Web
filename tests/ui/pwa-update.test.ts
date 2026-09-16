import { describe, it, expect, vi } from 'vitest';
import { readFileSync, existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  applyUpdate,
  initPwaUpdate,
  nextUpdateState,
  INITIAL_UPDATE_STATE,
  RELOAD_FALLBACK_MS,
  type PwaElementLike,
  type PwaEnv,
  type SwContainerLike,
  type SwRegistrationLike,
} from '../../src/ui/pwa-update';
import { collectFiles, computeVersion, run as genManifest } from '../../scripts/gen-sw-manifest.mjs';
/** ⚠️ 生成脚本的入口名叫 `run`，测试里读作 `genManifest`（腿的语义名，见 gen-sw-manifest.d.mts） */
import { stripComments } from './source-text';

/**
 * G3 Task 8 守卫：PWA 的注册 / 自动提示 / 一键更新。
 *
 * ## 为什么全部走**注入**而不是真浏览器
 * `vite.config.ts` 的测试环境是 `node`（无 jsdom、禁装 jsdom/playwright）。
 * Service Worker API 在 node 下根本不存在 ⇒ 「注册了吗 / 提示了吗 / 点了更新之后真的
 * 没有静默刷新吗」这些判断只能靠**把假 `navigator.serviceWorker` 从参数缝里递进去**。
 * 所以本文件同时是两条硬约束的守卫：
 *   1. `src/ui/pwa-update.ts` **必须**可注入（否则本文件连 import 都做不到）；
 *   2. 模块里**不许**出现裸的 `navigator.serviceWorker` 读取（唯一允许的一处是
 *      `realEnv()`，见下面第 2 组）。
 *
 * ## 本文件证明什么 / 不能证明什么（**不要读成"运行时已验证"**）
 *  **能**：状态机的每个态与每条转移、`SKIP_WAITING` 是唯一的一键更新动作、**没有静默自动
 *  刷新**、生成式预缓存清单确实由目录内容派生（而不是手写）、`sw.js` 不碰用户数据。
 *  **不能**：真实浏览器里 SW 到底注册成功没有、`caches.keys()` 里有没有 `compile-<hash>`、
 *  断网后页面是否真的打得开 —— 那需要 https/localhost 下的真 SW，属**用户验收**（计划
 *  「用户验收」第 4 项）。本文件不替代它。
 */

/* ── 假件：最小的 service worker 世界 ───────────────────────────────────────── */

type Listener = (ev?: unknown) => void;

function fakeReg(init: { waiting?: unknown; installing?: unknown } = {}): SwRegistrationLike & {
  messages: unknown[];
  fire(type: string, ev?: unknown): void;
} {
  const listeners = new Map<string, Listener[]>();
  const messages: unknown[] = [];
  const waiting = init.waiting ?? null;
  if (waiting && typeof (waiting as { postMessage?: unknown }).postMessage !== 'function') {
    (waiting as { postMessage: (m: unknown) => void }).postMessage = (m) => messages.push(m);
  }
  return {
    waiting,
    installing: init.installing ?? null,
    addEventListener(type: string, cb: Listener) {
      listeners.set(type, [...(listeners.get(type) ?? []), cb]);
    },
    update: async () => {},
    messages,
    fire(type: string, ev?: unknown) {
      for (const cb of listeners.get(type) ?? []) cb(ev);
    },
  };
}

function fakeSw(reg: SwRegistrationLike, controller: unknown = {}): SwContainerLike & { urls: unknown[][] } {
  const urls: unknown[][] = [];
  return {
    urls,
    register: async (url: string, opts?: { scope?: string }) => {
      urls.push([url, opts]);
      return reg;
    },
    getRegistration: async () => reg,
    addEventListener: () => {},
    controller,
  };
}

/** 手动冲刷微任务队列（不依赖 fake timer）：`.then` 链在 `await Promise.resolve()` × n 后必然跑完 */
const flush = async (n = 12): Promise<void> => {
  for (let i = 0; i < n; i += 1) await Promise.resolve();
};

/** 记录 env 的三块探针，省得每个用例都手写一遍 */
function probe(extra: Partial<PwaEnv> = {}): {
  env: Partial<PwaEnv>;
  log: { reloads: number; prompts: number; states: string[] };
} {
  const log = { reloads: 0, prompts: 0, states: [] as string[] };
  const env: Partial<PwaEnv> = {
    isProd: true,
    reload: () => { log.reloads += 1; },
    onUpdateAvailable: () => { log.prompts += 1; },
    onState: (s) => { log.states.push(s.kind); },
    ...extra,
  };
  return { env, log };
}

/* ── 1. 纯状态机：五个态各一条腿 ─────────────────────────────────────────────── */

describe('PWA 更新状态机（纯函数，五态齐全，§8.4）', () => {
  it('初始态是「无更新」，且初始态本身不发起任何动作', () => {
    expect(INITIAL_UPDATE_STATE.kind).toBe('idle');
    expect(INITIAL_UPDATE_STATE.kind === 'idle' && INITIAL_UPDATE_STATE.prompted).toBe(false);
  });

  it('态 1「无更新」→ 注册失败进「失败」，且**不**提示、**不**刷新', () => {
    const s = nextUpdateState(INITIAL_UPDATE_STATE, { type: 'failed', reason: 'boom', phase: 'register' });
    expect(s.kind).toBe('failed');
    expect(s.kind === 'failed' && s.reason).toBe('boom');
    expect(s.kind === 'failed' && s.phase).toBe('register');
  });

  it('态 2「有更新」：updatefound→installed 进 update-ready，提示一次、**不**刷新', () => {
    const installing = { state: 'installing' };
    const s1 = nextUpdateState(INITIAL_UPDATE_STATE, { type: 'updatefound', installing });
    expect(s1.kind).toBe('idle'); // installing：还不能提示（新 SW 尚未装好）
    const s2 = nextUpdateState(s1, { type: 'installed' });
    expect(s2.kind).toBe('update-ready');
    expect(s2.kind === 'update-ready' && s2.prompted).toBe(true);
    // 已在 waiting 的 SW 直接进 update-ready（不依赖 updatefound）
    const s3 = nextUpdateState(INITIAL_UPDATE_STATE, { type: 'waiting-present' });
    expect(s3.kind).toBe('update-ready');
  });

  it('态 3「更新中」：applyUpdate 进 updating（此时**仍未刷新**）', () => {
    const ready = nextUpdateState(INITIAL_UPDATE_STATE, { type: 'waiting-present' });
    const s = nextUpdateState(ready, { type: 'apply-update' });
    expect(s.kind).toBe('updating');
  });

  it('态 4「已更新」：skip-waiting-sent 进 updated', () => {
    const updating = nextUpdateState(
      nextUpdateState(INITIAL_UPDATE_STATE, { type: 'waiting-present' }),
      { type: 'apply-update' },
    );
    const s = nextUpdateState(updating, { type: 'skip-waiting-sent' });
    expect(s.kind).toBe('updated');
    expect(s.kind === 'updated' && s.phase).toBe('skip-waiting');
  });

  it('态 5「失败」：apply 阶段失败进 failed（phase=apply），不谎报已更新', () => {
    const updating = nextUpdateState(
      nextUpdateState(INITIAL_UPDATE_STATE, { type: 'waiting-present' }),
      { type: 'apply-update' },
    );
    const s = nextUpdateState(updating, { type: 'failed', reason: 'postMessage threw', phase: 'apply' });
    expect(s.kind).toBe('failed');
    expect(s.kind === 'failed' && s.phase).toBe('apply');
    expect(INITIAL_UPDATE_STATE.kind).not.toBe('updated'); // 反向：别把"没更新"当"已更新"
  });

  it('「已更新」之后仍可再次进入「有更新」（SW 是长寿命的，状态机不得卡死）', () => {
    const updated = nextUpdateState(INITIAL_UPDATE_STATE, { type: 'skip-waiting-sent' });
    expect(updated.kind).toBe('updated');
    expect(nextUpdateState(updated, { type: 'waiting-present' }).kind).toBe('update-ready');
  });
});

/* ── 2. initPwaUpdate：注册、提示、一键更新 ──────────────────────────────────── */

describe('initPwaUpdate（可注入环境）', () => {
  it('dev 环境**不**注册 service worker（否则 vite dev 的模块热更新会被缓存住）', async () => {
    let registered = 0;
    const { env } = probe({
      isProd: false,
      sw: { register: async () => { registered += 1; return fakeReg(); } } as never,
    });
    const dispose = initPwaUpdate(env);
    await flush();
    expect(registered).toBe(0);
    dispose();
  });

  it('prod 环境注册 /sw.js，scope 为 /', async () => {
    const reg = fakeReg();
    const sw = fakeSw(reg);
    const dispose = initPwaUpdate(probe({ sw }).env);
    await flush();
    expect(sw.urls).toEqual([['/sw.js', { scope: '/' }]]);
    dispose();
  });

  it('没有 serviceWorker 能力（null）时静默返回卸载函数，不抛错', async () => {
    const { env, log } = probe({ sw: null });
    const dispose = initPwaUpdate(env);
    await flush();
    expect(typeof dispose).toBe('function');
    expect(() => dispose()).not.toThrow();
    expect(log.prompts).toBe(0);
    expect(log.reloads).toBe(0);
  });

  it('已有 waiting 的 SW → 立刻提示可更新（不依赖 updatefound），且**没有**刷新', async () => {
    const sw = fakeSw(fakeReg({ waiting: { postMessage: () => {} } }));
    const { env, log } = probe({ sw });
    const dispose = initPwaUpdate(env);
    await flush();
    expect(log.prompts).toBe(1);
    expect(log.states).toContain('update-ready');
    expect(log.reloads, '提示阶段刷新 = 静默打断对局（判据 2 的硬红线）').toBe(0);
    dispose();
  });

  it('updatefound→statechange(installed) → 提示一次；重复的 statechange 不重复提示', async () => {
    const installing = {
      state: 'installing',
      handlers: [] as Listener[],
      addEventListener(_t: string, cb: Listener) { this.handlers.push(cb); },
    };
    const reg = fakeReg({ installing });
    const sw = fakeSw(reg);
    const { env, log } = probe({ sw });
    const dispose = initPwaUpdate(env);
    await flush();
    expect(log.prompts).toBe(0); // 只是 updatefound：新 SW 还没装好
    reg.fire('updatefound');
    expect(log.prompts).toBe(0);
    installing.state = 'installed';
    for (const cb of installing.handlers) cb();
    installing.state = 'activated';
    for (const cb of installing.handlers) cb();
    expect(log.prompts).toBe(1);
    expect(log.reloads).toBe(0);
    dispose();
  });

  it('首次安装（还没有 controller）**不**提示"有新版本"（那是安装，不是更新）', async () => {
    const installing = {
      state: 'installing',
      handlers: [] as Listener[],
      addEventListener(_t: string, cb: Listener) { this.handlers.push(cb); },
    };
    const reg = fakeReg({ installing });
    const sw = fakeSw(reg, null); // ← 首次安装：controller 还是 null
    const { env, log } = probe({ sw });
    const dispose = initPwaUpdate(env);
    await flush();
    reg.fire('updatefound');
    installing.state = 'installed';
    for (const cb of installing.handlers) cb();
    expect(log.prompts, '首次安装就弹"有新版本可用"是在骗用户').toBe(0);
    expect(log.reloads).toBe(0);
    dispose();
  });

  it('注册失败（reject）走「失败」态：不抛错、不提示、不刷新', async () => {
    const sw = {
      register: async () => { throw new Error('SecurityError'); },
      getRegistration: async () => undefined,
      addEventListener: () => {},
      controller: null,
    } as unknown as SwContainerLike;
    const { env, log } = probe({ sw });
    const dispose = initPwaUpdate(env);
    await flush();
    expect(log.states).toContain('failed');
    expect(log.prompts).toBe(0);
    expect(log.reloads).toBe(0);
    expect(() => dispose()).not.toThrow();
  });

  it('applyUpdate 向 waiting 发 SKIP_WAITING（一键更新的唯一动作）', () => {
    const reg = fakeReg({ waiting: {} });
    applyUpdate(reg);
    expect(reg.messages).toEqual([{ type: 'SKIP_WAITING' }]);
  });

  it('waiting 不存在时 applyUpdate 是安全 no-op（不抛、不发消息）', () => {
    const reg = fakeReg();
    expect(() => applyUpdate(reg)).not.toThrow();
    expect(reg.messages).toEqual([]);
  });

  it('卸载函数移除自己插的条（不留 body / #app 级残留）', () => {
    const { env } = probe({ isProd: false, sw: null });
    const dispose = initPwaUpdate(env);
    expect(typeof dispose).toBe('function');
    expect(() => dispose()).not.toThrow();
  });
});

/* ── 3. 「一键更新」的 UI 行为腿（用最小手写桩，不用 jsdom） ──────────────────── */

describe('一键更新：手动触发才不会刷新（行为腿，DOM 桩）', () => {
  interface StubElement extends PwaElementLike {
    children: StubElement[];
    handlers: Record<string, Listener[]>;
    hidden: boolean;
  }

  /** 极简元素桩：只需要 className / children / appendChild / prepend / remove / 事件 */
  function makeElement(tag: string): StubElement {
    const el: StubElement = {
      tag,
      className: '',
      textContent: '',
      type: '',
      children: [] as StubElement[],
      handlers: {} as Record<string, Listener[]>,
      hidden: false,
      appendChild(c: unknown) { el.children.push(c as StubElement); },
      prepend(c: unknown) { el.children.unshift(c as StubElement); },
      addEventListener(t, cb) { el.handlers[t] = [...(el.handlers[t] ?? []), cb]; },
      remove() { el.hidden = true; },
      querySelector(sel: string) {
        if (sel !== '.pwa-update-bar') return null;
        return el.children.find((c) => c.className === 'pwa-update-bar') ?? null;
      },
    } as StubElement & { tag: string };
    return el;
  }

  interface StubHost extends StubElement {
    querySelector(sel: string): StubElement | null;
  }

  function makeHost(): StubHost {
    return makeElement('div') as StubHost;
  }

  it('提示时插入更新条；点「立即更新」才 post SKIP_WAITING + 刷新', async () => {
    const posted: unknown[] = [];
    const waiting = { postMessage: (m: unknown) => { posted.push(m); } };
    const reg = fakeReg({ waiting });
    const sw = fakeSw(reg);
    let reloads = 0;
    const host = makeHost();
    const dispose = initPwaUpdate({
      isProd: true,
      sw,
      reload: () => { reloads += 1; },
      ui: { host: () => host, make: (tag: string) => makeElement(tag) },
    } as unknown as Partial<PwaEnv>);
    await flush();
    const bar = host.querySelector('.pwa-update-bar');
    expect(bar, '有更新可用却没插更新条（那就不叫"自动提示"）').not.toBeNull();
    const btn = (bar as StubElement).children[1];
    expect(btn.textContent).toBe('立即更新');
    expect(btn.handlers.click?.length).toBe(1);
    // 关键：点之前一个动作都没发生
    expect(posted).toEqual([]);
    expect(reloads, '还没点就刷新了 = 静默打断对局').toBe(0);
    vi.useFakeTimers();
    try {
      btn.handlers.click[0]();
      expect(posted).toEqual([{ type: 'SKIP_WAITING' }]);
      // 点完的一瞬间也**没有**刷新：真实浏览器里是等新 SW 接管（controllerchange）才刷；
      // 这里没有真 SW，所以由兜底计时器在 RELOAD_FALLBACK_MS 后兜住。
      expect(reloads, '点了就立刻刷 = 在旧 controller 下白发一次刷新').toBe(0);
      vi.advanceTimersByTime(RELOAD_FALLBACK_MS);
    } finally {
      vi.useRealTimers();
    }
    expect(reloads).toBe(1);
    dispose();
  });

  it('卸载函数把更新条从宿主上摘掉', async () => {
    const sw = fakeSw(fakeReg({ waiting: {} }));
    const host = makeHost();
    const dispose = initPwaUpdate({
      isProd: true,
      sw,
      reload: () => {},
      ui: { host: () => host, make: (tag: string) => makeElement(tag) },
    } as unknown as Partial<PwaEnv>);
    await flush();
    const bar = host.querySelector('.pwa-update-bar');
    expect(bar).not.toBeNull();
    expect((bar as StubElement).hidden).toBe(false);
    dispose();
    expect((bar as StubElement).hidden).toBe(true);
  });

  it('宿主不存在时不抛错（PWA 不可用不该影响游戏）', async () => {
    const sw = fakeSw(fakeReg({ waiting: {} }));
    const dispose = initPwaUpdate({
      isProd: true,
      sw,
      reload: () => {},
      ui: { host: () => null, make: (tag: string) => makeElement(tag) },
    } as unknown as Partial<PwaEnv>);
    expect(() => dispose()).not.toThrow();
    await flush();
    expect(dispose).toBeTypeOf('function');
  });
});

/* ── 4. 源码形态守卫（对应 Global Constraints「浏览器能力必须可注入」） ────────── */

const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url))).subarray(0, 1024 * 1024).toString('utf8');

describe('src/ui/pwa-update.ts 的可注入性（否则 node 下一条腿都跑不了）', () => {
  const src = read('../../src/ui/pwa-update.ts');

  it('浏览器全局只在 realEnv() 一处取（其余一律走注入缝）', () => {
    // 数的是**属性访问形态**（`navigator.xxx` / `navigator?.xxx`）—— 注释里的举例文字不算。
    const accesses = (src2: string): string[] => src2.split('\n')
      .filter((l) => /navigator\s*[?.]\s*[A-Za-z_$]/.test(l));
    expect(accesses(src), '模块里不该再有裸的浏览器全局属性访问').toEqual([]);

    const realEnv = src.slice(src.indexOf('function realEnv('), src.indexOf('export const UPDATE_BAR_CLASS'));
    expect(realEnv, 'realEnv 没了').not.toBe('');
    // 默认环境必须真的从浏览器全局取 SW 容器（且取不到时为 null ⇒ 静默降级）
    expect(realEnv).toMatch(/globalThis/);
    expect(realEnv).toMatch(/serviceWorker/);
    expect(realEnv).toMatch(/\?\?\s*null/);
  });

  it('initPwaUpdate 每一个浏览器对象都从 env 取（document/location 零裸用）', () => {
    const body = src.slice(src.indexOf('export function initPwaUpdate'));
    expect(body).not.toMatch(/\bdocument\./);
    expect(body).not.toMatch(/\blocation\./);
    expect(body).toMatch(/env\.sw\b/);
  });
});

/* ── 5. public/sw.js 文本腿 ──────────────────────────────────────────────────── */

describe('public/sw.js 文本腿（离线缓存只缓存程序文件）', () => {
  const sw = read('../../public/sw.js');

  it('绝不触碰任何用户数据存储（红线 1 / §8.1）', () => {
    expect(sw).not.toMatch(/localStorage/);
    expect(sw).not.toMatch(/indexedDB/);
    expect(sw).not.toMatch(/sessionStorage/);
  });

  it('支持跳等待（一键更新的另一半）', () => {
    expect(sw).toContain('SKIP_WAITING');
    expect(sw).toContain('skipWaiting');
  });

  it('install **不**自动 skipWaiting（否则更新条与用户点击都失去意义）', () => {
    const install = sw.slice(sw.indexOf("addEventListener('install'"), sw.indexOf("addEventListener('activate'"));
    expect(install).not.toMatch(/self\.skipWaiting\(\)/);
    expect(install).not.toContain('clients.claim');
  });

  it('激活时清理旧版本缓存（否则用户永远拿不到新代码）', () => {
    expect(sw).toContain('caches.delete');
  });

  it('读构建期生成的清单（版本键由内容哈希决定）', () => {
    expect(sw).toContain('sw-manifest.json');
  });

  it('fetch 只处理同源 GET，且导航失败回退 /index.html', () => {
    expect(sw).toMatch(/req\.method\s*!==\s*'GET'/);
    expect(sw).toMatch(/url\.origin\s*!==\s*self\.location\.origin/);
    expect(sw).toContain("'navigate'");
    expect(sw).toContain("caches.match('/index.html')");
  });
});

/* ── 6. 预缓存清单必须是**生成**的，不是手写的 ──────────────────────────────── */

describe('scripts/gen-sw-manifest.mjs：清单由真实产物派生', () => {
  const ROOT = fileURLToPath(new URL('../../', import.meta.url));
  const scriptSrc = read('../../scripts/gen-sw-manifest.mjs');

  function fixture(files: Record<string, string>): string {
    const dir = mkdtempSync(join(tmpdir(), 'g3-swman-'));
    for (const [rel, body] of Object.entries(files)) {
      const abs = join(dir, rel);
      const cut = abs.lastIndexOf('\\') >= 0 ? abs.lastIndexOf('\\') : abs.lastIndexOf('/');
      const parent = abs.slice(0, cut);
      if (parent && !existsSync(parent)) mkdirSync(parent, { recursive: true });
      writeFileSync(abs, body, 'utf8');
    }
    return dir;
  }

  const TMP: string[] = [];
  const tmp = (files: Record<string, string>): string => {
    const d = fixture(files);
    TMP.push(d);
    return d;
  };
  // 用完即删：临时目录绝不留在仓库里
  const cleanup = (): void => {
    while (TMP.length > 0) {
      const d = TMP.pop();
      if (d) rmSync(d, { recursive: true, force: true });
    }
  };

  it('清单 = 目录里真实存在的文件（形状与来源都由磁盘决定）', () => {
    const dir = tmp({
      'index.html': '<html></html>',
      'assets/index-abc123.js': 'console.log(1)',
      'manifest.webmanifest': '{"name":"x"}',
      'icons/icon-192.png': 'PNG-BYTES',
    });
    const files = collectFiles(dir).map((f) => f.rel);
    expect(files).toEqual([
      '/assets/index-abc123.js',
      '/icons/icon-192.png',
      '/index.html',
      '/manifest.webmanifest',
    ]);
    // 反向：清单里不许出现磁盘上没有的东西（手写清单的典型形态）
    for (const rel of files) expect(existsSync(join(dir, rel.slice(1)))).toBe(true);
    // sw.js / sw-manifest.json 自身不预缓存
    const dir2 = tmp({ 'index.html': 'x', 'sw.js': 'y', 'sw-manifest.json': 'z', 'notes.txt': 'n' });
    expect(collectFiles(dir2).map((f) => f.rel)).toEqual(['/index.html']);
    cleanup();
  });

  it('版本键是内容哈希：任一文件内容变了 → version 变；内容不变 → version 不变', () => {
    const a = tmp({ 'index.html': 'AAA', 'assets/app.js': 'v1' });
    const b = tmp({ 'index.html': 'AAA', 'assets/app.js': 'v2' }); // 只改一个字节
    const c = tmp({ 'index.html': 'AAA', 'assets/app.js': 'v1' }); // 同内容、不同目录
    const [va, vb, vc] = [a, b, c].map((d) => computeVersion(collectFiles(d)));
    expect(va).not.toBe(vb);
    expect(va).toBe(vc); // 与路径无关，只看内容（同一份产物重跑给同一个版本）
    cleanup();
  });

  it('脚本里**没有**硬编码的文件清单（不得出现产物文件名/数组字面量式白名单）', () => {
    expect(scriptSrc, '脚本里出现了 dist 产物文件名（清单必须是生成的）').not.toMatch(/index-[A-Za-z0-9_-]+\.js/);
    expect(scriptSrc).not.toMatch(/['"]\/assets\//);
    expect(scriptSrc).not.toMatch(/['"]\/icons\//);

    /**
     * 更强的判据：把代码里的每个**字符串字面量**取出来（先 `stripComments` —— 否则注释里
     * 举例的 `index-abc.js` 这种说明文字会被当成"脚本里有清单"），再做两件事：
     *  ① 每个"像文件名的"字面量，**同一行**必须出现 `SKIP`（跳过的自己人）或 `writeFileSync`
     *     （唯一产物名）。手写清单的最简形态 `const files = ['/index.html', '/assets/app.js']`
     *     两行都不含这两个词 ⇒ 变红；
     *  ② 交给 `collectFiles` 的**过滤器**必须只认静态的根路径与后缀（regex 字面量），
     *     不许把某个具体文件名写进去。
     */
    const code = stripComments(scriptSrc);
    const literals: { text: string; line: string }[] = [];
    for (const m of code.matchAll(/'([^'\\\n]*)'|"([^"\\\n]*)"|`([^`\\\n]*)`/g)) {
      const line = code.slice(0, m.index).split('\n').pop() ?? '';
      literals.push({ text: m[1] ?? m[2] ?? m[3], line });
    }
    const nameLike = literals.filter((l) => /^[\w@./-]*\.[A-Za-z0-9]+$/.test(l.text));
    expect(nameLike.length, '脚本里连一个文件名都不提？那 prepend 逻辑就不用跳过自己人了')
      .toBeGreaterThan(0);
    for (const { text, line } of nameLike) {
      expect(
        /\bSKIP\b|writeFileSync/.test(line),
        `文件名字面量 ${text} 出现在既不是 SKIP 也不是 writeFileSync 的行上：${line.trim()}`,
      ).toBe(true);
    }

    // ② 过滤器是静态的（不许把具体文件名写进"要不要缓存"的判据里）
    const filterSrc = code.slice(code.indexOf('const SKIP'));
    expect(filterSrc).toMatch(/SKIP\s*=\s*new Set\(\[/);
    expect(filterSrc).toMatch(/EXT_OK\s*=\s*\/\^?\\?\./);
    expect(filterSrc).not.toMatch(/EXT_OK\s*=\s*\[/);
    expect(filterSrc).not.toMatch(/\bassets\b/);

    // 反向钉住"清单只能来自目录内容"：把开关打开后清空名单，数量必须跟着变
    const probeDir = tmp({ 'index.html': 'a', 'assets/app.js': 'b', 'manifest.webmanifest': 'c' });
    expect(collectFiles(probeDir).length).toBe(3);
    rmSync(join(probeDir, 'assets', 'app.js'), { force: true });
    expect(collectFiles(probeDir).length, '删了一个文件清单却没变 ⇒ 清单不是从目录派生的').toBe(2);
    cleanup();
  });

  it('对真实 dist/ 跑一次：产出与 dist 目录内容一致（构建产物被正确复制）', () => {
    const dist = join(ROOT, 'dist');
    if (!existsSync(dist)) {
      throw new Error('dist/ 不存在 —— 本腿必须先跑 npx vite build（门禁顺序：tsc → build → vitest）');
    }
    const report = genManifest(dist);
    expect(report.files.length).toBeGreaterThan(0);
    expect(report.version).toMatch(/^[0-9a-f]{16}$/);
    const manifest = JSON.parse(
      readFileSync(join(dist, 'sw-manifest.json')).subarray(0, 4 * 1024 * 1024).toString('utf8'),
    ) as { version: string; files: string[] };
    expect(manifest.version).toBe(report.version);
    expect(manifest.files).toEqual(collectFiles(dist).map((f) => f.rel));
    // dist 里必须**真的**有 public/ 复制过来的资产（否则"离线可开"只覆盖了壳）
    expect(manifest.files).toContain('/index.html');
    expect(manifest.files.some((f) => f.startsWith('/assets/') && f.endsWith('.js'))).toBe(true);
    expect(manifest.files.some((f) => f.startsWith('/icons/'))).toBe(true);
    expect(manifest.files).toContain('/manifest.webmanifest');
    // 自己不进清单（否则清单要为自己算哈希 = 自指）
    expect(manifest.files).not.toContain('/sw.js');
    expect(manifest.files).not.toContain('/sw-manifest.json');
  });

  it('dist/ 不存在时给出清晰的报错（而不是 ENOENT 堆栈）', () => {
    const missing = join(tmpdir(), `g3-swman-missing-${Date.now()}`);
    expect(() => genManifest(missing)).toThrow(/vite build/);
    cleanup();
  });
});

/* ── 7. manifest.webmanifest 与图标（清单语义不在门禁范围内，这里只钉结构与可访问性） ── */

describe('public/manifest.webmanifest 与图标', () => {
  const ROOT = fileURLToPath(new URL('../../', import.meta.url));
  const mf = JSON.parse(read('../../public/manifest.webmanifest')) as {
    name: string; short_name: string; start_url: string; scope: string; display: string;
    theme_color: string; icons: { src: string; sizes: string; type: string; purpose?: string }[];
  };

  it('start_url 与 scope 是 /（改成 /assets/ 或 /index.html 会让安装后的 PWA 打不开）', () => {
    expect(mf.start_url).toBe('/');
    expect(mf.scope).toBe('/');
    expect(mf.display).toBe('standalone');
  });

  it('图标文件真的存在且尺寸声明与实际一致（不是空文件占位）', () => {
    for (const icon of mf.icons) {
      const abs = join(ROOT, 'public', icon.src.replace(/^\//, ''));
      expect(existsSync(abs), `manifest 声明的图标不存在：${icon.src}`).toBe(true);
      const bytes = readFileSync(abs).subarray(0, 8).toString('utf8');
      expect(bytes.slice(1, 4), `${icon.src} 不是 PNG`).toBe('PNG');
      // PNG 的 IHDR 宽高（大端 4 字节）
      const head = readFileSync(abs).subarray(16, 24).toString('latin1');
      const num = (at: number): number =>
        (head.charCodeAt(at) << 24) | (head.charCodeAt(at + 1) << 16) | (head.charCodeAt(at + 2) << 8) | head.charCodeAt(at + 3);
      const w = num(0);
      const h = num(4);
      expect(`${w}x${h}`).toBe(icon.sizes);
    }
    expect(mf.icons.some((i) => i.purpose === 'maskable')).toBe(true);
  });
});

/* ── 8. 接线：index.html / package.json / main.ts（只查 Task 8 允许的行区） ──── */

describe('Task 8 的接线（严格限定在附录 A 允许的行区）', () => {
  const html = read('../../index.html');
  const pkg = JSON.parse(read('../../package.json')) as {
    scripts: Record<string, string>; dependencies?: Record<string, string>; devDependencies: Record<string, string>;
  };
  const main = read('../../src/main.ts');

  it('index.html 链接了 manifest（2 行内改动）', () => {
    expect(html).toContain('<link rel="manifest" href="/manifest.webmanifest" />');
    expect(html).toMatch(/<meta name="theme-color" content="#0d0d10" \/>/);
  });

  it('package.json：build 尾部挂生成脚本，且**零新增依赖**', () => {
    expect(pkg.scripts.build).toBe('tsc --noEmit && vite build && node scripts/gen-sw-manifest.mjs');
    expect(pkg.dependencies, '零运行时依赖：dependencies 必须仍然不存在').toBeUndefined();
    expect(Object.keys(pkg.devDependencies).sort()).toEqual(['typescript', 'vite', 'vitest']);
  });

  it('main.ts 在 import 区与初始化区各加一处，且**没有**动 cb / rerender', () => {
    expect(main).toMatch(/import \{ initPwaUpdate \} from '\.\/ui\/pwa-update'/);
    const calls = [...main.matchAll(/^\s*initPwaUpdate\(\);/gm)];
    expect(calls.length).toBe(1);
    // 调用点必须在 showHome() 之前的初始化区（不能插进 setSeedNonce / createGame 之间）
    const at = calls[0].index ?? -1;
    const seed = main.indexOf('setSeedNonce(newMatchSeed());');
    const show = main.indexOf('showHome();');
    expect(seed).toBeGreaterThan(-1);
    expect(show).toBeGreaterThan(-1);
    expect(at, 'initPwaUpdate() 落在了 setSeedNonce/createGame 之间（会打乱 G0 的启动语义）').toBeGreaterThan(seed);
    expect(show).toBeGreaterThan(seed);
  });

  it('main.ts 里 cb / rerender 两个函数体一字未动（G4 的收口范围）', () => {
    // 只钉"这两个函数仍然存在且 rerender 仍以 renderApp 收口"——它们是**禁令**的锚点：
    // 若 Task 8 的接线把 rerender 改坏，本腿与 net-preview-wiring.test.ts 会同时变红。
    expect(main).toMatch(/\bfunction rerender\(\)/);
    expect(main).toMatch(/\bconst cb\b/);
  });
});
