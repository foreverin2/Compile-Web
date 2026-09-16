import { describe, it, expect, vi } from 'vitest';
import { readFileSync, existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  applyUpdate,
  initPwaUpdate,
  nextUpdateState,
  INITIAL_UPDATE_STATE,
  RELOAD_FALLBACK_MS,
  SW_CACHE_INCOMPLETE,
  type PwaElementLike,
  type PwaEnv,
  type SwContainerLike,
  type SwRegistrationLike,
} from '../../src/ui/pwa-update';
import {
  collectFiles,
  computeVersion,
  isShellAsset,
  run as genManifest,
  stampSw,
  readSwVersion,
  generate,
  SW_VERSION_PLACEHOLDER,
  DEFAULT_SW_TEMPLATE,
} from '../../scripts/gen-sw-manifest.mjs';
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

/** 带事件派发的容器桩（`controllerchange` 真的刷新通路 / `message` 真的预缓存失败通告）。 */
function fakeSwDispatch(
  reg: SwRegistrationLike,
  controller: unknown = {},
): SwContainerLike & { urls: unknown[][]; listeners: Map<string, Listener[]>; fire(type: string, ev?: unknown): void } {
  const listeners = new Map<string, Listener[]>();
  const urls: unknown[][] = [];
  return {
    urls,
    listeners,
    register: async (url: string, opts?: { scope?: string }) => {
      urls.push([url, opts]);
      return reg;
    },
    getRegistration: async () => reg,
    addEventListener(type: string, cb: Listener) {
      listeners.set(type, [...(listeners.get(type) ?? []), cb]);
    },
    controller,
    fire(type: string, ev?: unknown) {
      for (const cb of listeners.get(type) ?? []) cb(ev);
    },
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

  it('态 5 的另一条：预缓存失败（cache-incomplete）**不谎报有更新**，但必须可观察', () => {
    // 评审重要 2：install 的 addAll 失败必须"不静默"。
    // 判定：① 它绝不把状态变成 update-ready（那是"有新版本"的语义，会骗用户）；
    //      ② 它总是落到 failed（phase=install），于是 `onState` 出口一定被调到。
    const idle = nextUpdateState(INITIAL_UPDATE_STATE, { type: 'cache-incomplete', reason: 'quota' });
    expect(idle.kind, '预缓存失败被读成"有新版本可用"就是骗用户').toBe('failed');
    expect(idle.kind === 'failed' && idle.phase).toBe('install');
    expect(idle.kind === 'failed' && idle.reason).toBe('quota');
    expect(idle.kind === 'failed' && idle.prompted, '还没提示过任何更新').toBe(false);
    const ready = nextUpdateState(INITIAL_UPDATE_STATE, { type: 'waiting-present' });
    const after = nextUpdateState(ready, { type: 'cache-incomplete', reason: 'quota' });
    expect(after.kind).toBe('failed');
    expect(after.kind === 'failed' && after.prompted, '已经提示过更新了，别把 prompted 抹掉').toBe(true);
  });
});

/* ── 1b. B-1：真实浏览器全局（navigator.serviceWorker）真的被读到（**运行时**腿） ──
 *
 * 为什么必须有这一组：修复前本文件只有"文本形状"腿（`realEnv` 源码里有 `globalThis` /
 * `serviceWorker` / `?? null` 三个词）。它证明不了 `realEnv()` **真的**从浏览器全局取到容器 ——
 * 实现曾写成 `globalThis.serviceWorker`（浏览器上**不存在**的属性），所有文本腿仍全绿，
 * 而真实浏览器里 `sw === null` ⇒ `/sw.js` 一次都不注册（评审 B-1）。
 * 这组腿不传 `sw` override，只往 `globalThis.navigator` 装假件，然后要求**真的**注册了 `/sw.js`。
 * ------------------------------------------------------------------------- */

describe('B-1：默认环境真的从 navigator.serviceWorker 取容器（运行时，不靠文本）', () => {
  /** node 下没有 `navigator`，用 defineProperty 装/拆（可配置，能删干净）。 */
  const withNavigator = async (value: unknown, body: () => Promise<void>): Promise<void> => {
    const desc = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    Object.defineProperty(globalThis, 'navigator', { value, configurable: true, writable: true });
    try {
      await body();
    } finally {
      if (desc) Object.defineProperty(globalThis, 'navigator', desc);
      else Reflect.deleteProperty(globalThis, 'navigator');
    }
  };

  /** 只用来满足 `ui` 的接口：这一组腿不关心更新条，只关心 `register` 是否被调用。 */
  const bareElement = (): PwaElementLike => ({
    className: '',
    textContent: '',
    appendChild: (c: unknown) => c,
    prepend: (c: unknown) => c,
    addEventListener: () => {},
    remove: () => undefined,
    querySelector: () => null,
  });

  it('容器挂在 navigator.serviceWorker 上 ⇒ 真的调用 register(/sw.js, scope:/)', async () => {
    const urls: unknown[][] = [];
    const reg = fakeReg();
    const container = {
      register: async (url: string, opts?: { scope?: string }) => { urls.push([url, opts]); return reg; },
      getRegistration: async () => reg,
      addEventListener: () => {},
      controller: {},
    };
    await withNavigator({ serviceWorker: container }, async () => {
      // 浏览器真实的全局布局：容器在 `navigator` 上，`globalThis.serviceWorker` **不存在**。
      // 这两条断言把 B-1 的成因**当场**钉住（而不是靠"读源码找字符串"）。
      expect((globalThis as { serviceWorker?: unknown }).serviceWorker, '浏览器上 globalThis.serviceWorker 不存在').toBeUndefined();
      expect((globalThis as { navigator?: { serviceWorker?: unknown } }).navigator?.serviceWorker).toBe(container);

      const { env, log } = probe({
        // ⚠️ 刻意**不传** `sw`：这一腿走的就是 `realEnv()` 的取值路径
        ui: { host: () => null, make: () => bareElement() },
      });
      const dispose = initPwaUpdate(env);
      await flush();
      expect(urls, '浏览器把 SW 容器挂在 navigator.serviceWorker 上；读 globalThis.serviceWorker 会一个都不注册').toEqual([
        ['/sw.js', { scope: '/' }],
      ]);
      expect(log.reloads, '注册阶段不该刷新').toBe(0);
      dispose();
    });
  });

  it('容器挂在 globalThis.serviceWorker（浏览器上不存在的位置）⇒ 不注册', async () => {
    const urls: unknown[][] = [];
    const desc = Object.getOwnPropertyDescriptor(globalThis, 'serviceWorker');
    Object.defineProperty(globalThis, 'serviceWorker', {
      value: { register: async (url: string, opts?: { scope?: string }) => { urls.push([url, opts]); return fakeReg(); } },
      configurable: true,
      writable: true,
    });
    try {
      await withNavigator(undefined, async () => {
        const dispose = initPwaUpdate({ isProd: true, reload: () => {}, onUpdateAvailable: () => {} });
        await flush();
        expect(urls, 'globalThis.serviceWorker 不是浏览器的容器位置；靠它取容器就是 B-1').toEqual([]);
        dispose();
      });
    } finally {
      if (desc) Object.defineProperty(globalThis, 'serviceWorker', desc);
      else Reflect.deleteProperty(globalThis, 'serviceWorker');
    }
  });

  it('navigator 整个缺失 ⇒ 静默 no-op：不抛错、不注册、不刷新', async () => {
    const reload = vi.fn();
    await withNavigator(undefined, async () => {
      let dispose: (() => void) | null = null;
      expect(() => { dispose = initPwaUpdate({ isProd: true, reload }); }).not.toThrow();
      await flush();
      expect(typeof dispose).toBe('function');
      expect(() => (dispose as unknown as () => void)()).not.toThrow();
      expect(reload).not.toHaveBeenCalled();
    });
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

  it('sw 广播预缓存失败 ⇒ 状态不静默（failed/phase=install）且**不刷新**', async () => {
    // 重要 2：install 的 cache.addAll 失败此前完全没有出口（用户与开发者都收不到提示）。
    const sw = fakeSwDispatch(fakeReg());
    const seen: string[] = [];
    const { env, log } = probe({ sw, onCacheIncomplete: (r) => { seen.push(r); } });
    const dispose = initPwaUpdate(env);
    await flush();
    sw.fire('message', { data: { type: SW_CACHE_INCOMPLETE, reason: 'HTTP 404' } });
    expect(log.states, '预缓存失败必须能被观察到，不能静默').toContain('failed');
    expect(seen, '预缓存失败的专用出口没被调到').toEqual(['HTTP 404']);
    expect(log.reloads, 'install 失败时刷新既没用又打断对局').toBe(0);
    expect(log.prompts, 'install 失败不是"有新版本"').toBe(0);
    // 反向：无关消息不该改变状态
    log.states.length = 0;
    sw.fire('message', { data: { type: 'SOMETHING_ELSE' } });
    sw.fire('message', undefined);
    expect(log.states).toEqual([]);
    expect(seen).toEqual(['HTTP 404']);
    dispose();
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

  it('controllerchange 是正常刷新通路，且只刷新一次（刷新闸）', async () => {
    // 评审 S-3：真实浏览器里"点完更新 → 新 controller 接管"是**唯一**的正常刷新路径，
    // 此前没有任何腿 fire 过 controllerchange；刷新闸（reloading）也没有腿。
    vi.useFakeTimers();
    try {
      const sw = fakeSwDispatch(fakeReg({ waiting: { postMessage: () => {} } }));
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
      expect(bar, '没有更新条 ⇒ 后面的点击与刷新判据都跑不到').not.toBeNull();
      (bar as StubElement).children[1].handlers.click[0]();
      expect(reloads, 'onclick 里刷新 = 用户点了就白发一次').toBe(0);

      sw.fire('controllerchange');
      expect(reloads, '新 controller 接管后才刷新（真实浏览器的正常通路）').toBe(1);
      // 幂等：controllerchange 再来一次、兜底计时器到点，都不许再刷
      sw.fire('controllerchange');
      vi.advanceTimersByTime(RELOAD_FALLBACK_MS * 3);
      expect(reloads, '刷新闸失效：一次更新刷了多次').toBe(1);
      dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it('宿主上已有更新条时不重复插（去重分支，评审 S-2 的零覆盖）', async () => {
    const sw = fakeSwDispatch(fakeReg({ waiting: {} }));
    const host = makeHost();
    // 预置一条（模拟"宿主屏重建后条还在"的形态）：initPwaUpdate 不该再插第二条
    const preexisting = makeElement('div');
    preexisting.className = 'pwa-update-bar';
    host.children.push(preexisting);
    const dispose = initPwaUpdate({
      isProd: true,
      sw,
      reload: () => {},
      ui: { host: () => host, make: (tag: string) => makeElement(tag) },
    } as unknown as Partial<PwaEnv>);
    await flush();
    const bars = host.children.filter((c) => c.className === 'pwa-update-bar');
    expect(bars.length, `宿主上出现了 ${bars.length} 条更新条（去重分支失效）`).toBe(1);
    expect(bars[0]).toBe(preexisting);
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
    // 数的是**代码里的属性访问形态**（`navigator.xxx` / `navigator?.xxx`）——
    // ⚠️ 先 `stripComments`：不这么做的话，**注释里举例**的 `navigator.serviceWorker`
    // 会同时造成假红（判据被说明文字撞红）与假绿（说明文字满足"这里有全局访问"）。
    // 这条腿只管"模块里还有没有第二处裸访问"；"默认环境真的取得浏览器容器的容器"这件事
    // 由上面第 1b 组的**运行时**腿证明（B-1 就是靠 `globalThis.serviceWorker` 从这里溜过去的）。
    const code = stripComments(src);
    const accesses = (src2: string): string[] => src2.split('\n')
      .filter((l) => /navigator\s*[?.]\s*[A-Za-z_$]/.test(l));
    expect(accesses(code), '模块里不该再有裸的浏览器全局属性访问').toEqual([]);

    const realEnv = code.slice(code.indexOf('function realEnv('), code.indexOf('export const UPDATE_BAR_CLASS'));
    expect(realEnv, 'realEnv 没了').not.toBe('');
    // 默认环境必须经 `globalThis.navigator` 取 SW 容器（且取不到时为 null ⇒ 静默降级）
    expect(realEnv).toMatch(/globalThis/);
    expect(realEnv).toMatch(/navigator/);
    expect(realEnv).toMatch(/serviceWorker/);
    expect(realEnv).toMatch(/\?\?\s*null/);
    // 反向：不许再从 `globalThis` 上直接取同名属性（那正是 B-1）
    expect(realEnv, 'globalThis.serviceWorker 不是浏览器的容器位置').not.toMatch(/globalThis\s*\)?\s*(?:as[^;]*)?[?.]\s*serviceWorker/);
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
    // 先 `stripComments`：这条腿判的是**代码**里有没有存储 API。文件头注里点名写清"不许出现
    // localStorage/indexedDB/sessionStorage"是纪律要求，不该把注释本身变成假红。
    const code = stripComments(sw);
    expect(code).not.toMatch(/localStorage/);
    expect(code).not.toMatch(/indexedDB/);
    expect(code).not.toMatch(/sessionStorage/);
    // 反向：真的出现过这些名字时要能抓到（把注释剥干净的前提是代码里确实有判据）
    expect(code).toContain('caches.');
  });

  /**
   * 评审假守卫 M12：往 `fetch` 里注入"未命中就 `cache.put` 每个同源响应"曾经**全绿**。
   * 这条腿钉两件事：
   *  ① 全文件**只有一处 `cache.put`**（版本标记），且它只在 install 段被调用；
   *  ② `fetch` 段里既没有 `cache.put/add/addAll`，也没有 `caches.open`。
   * 与 `src/app/privacy.ts` 的 `offlineCacheNote`（"缓存的不是用户数据"）对齐：
   * sw **只**允许写预缓存清单里的静态资产。
   */
  it('缓存写入只允许出现在 install 段（fetch 未命中绝不 cache.put）', () => {
    const code = stripComments(sw);
    const at = (needle: string): number => {
      const i = code.indexOf(needle);
      expect(i, `sw.js 里找不到 ${needle}`).toBeGreaterThan(-1);
      return i;
    };
    const install = code.slice(at("addEventListener('install'"), at("addEventListener('activate'"));
    const activate = code.slice(at("addEventListener('activate'"), at("addEventListener('message'"));
    const fetchSeg = code.slice(at("addEventListener('fetch'"));

    expect(fetchSeg, 'fetch 里写缓存 = 把任意同源响应（可能是用户数据）写进 Cache Storage').not.toMatch(
      /cache\.(put|add|addAll)\s*\(/,
    );
    expect(fetchSeg, 'fetch 里不该自己开缓存').not.toMatch(/caches\.open\s*\(/);

    // 全文件唯一的缓存 put = 版本标记（静态的版本字符串，不是用户数据）
    const puts = [...code.matchAll(/cache\.put\s*\(/g)].map((m) => code.slice(m.index).split('\n')[0]);
    expect(puts.length, `cache.put 应只有版本标记一处，实际 ${puts.length} 处：${puts.join(' | ')}`).toBe(1);
    expect(puts[0]).toMatch(/VERSION_MARKER_URL/);
    // 预缓存写入（addAll）在 install 段，且只吃清单里的文件
    expect(install).toMatch(/cache\.addAll\(\s*manifest\.files\s*\)/);
    // ⚠️ fetch 段被 settle：它必须存在（否则下面 slice 的是空串、判据恒真）
    expect(fetchSeg.length).toBeGreaterThan(20);
    expect(activate).toContain('caches.delete');
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

  it('预缓存失败的消息类型两边**逐字一致**（sw.js 是 classic script，不能 import 模块常量）', () => {
    // `SW_CACHE_INCOMPLETE` 是 `pwa-update.ts` 的常量，`sw.js` 里必然要再写一份字面量。
    // 改名只改一边 ⇒ 这条腿红（否则页面永远收不到"预缓存未完成"）。
    expect(sw).toContain(SW_CACHE_INCOMPLETE);
    expect(sw).toMatch(new RegExp(`const CACHE_INCOMPLETE = '${SW_CACHE_INCOMPLETE}'`));
    expect(read('../../src/ui/pwa-update.ts')).toContain(`export const SW_CACHE_INCOMPLETE = '${SW_CACHE_INCOMPLETE}'`);
  });

  it('install 失败**不静默**：广播给页面窗口，且失败时让 install 失败（不换上空的缓存）', () => {
    const code = stripComments(sw);
    const install = code.slice(code.indexOf("addEventListener('install'"), code.indexOf("addEventListener('activate'"));
    expect(install).toContain('notifyCacheIncomplete');
    expect(install, 'install 失败必须 throw（旧 SW 与旧缓存继续生效）').toMatch(/catch[\s\S]*throw e/);
    expect(sw).toContain('clients.matchAll');
    // 版本标记：预缓存全部成功后才写（"有标记"= 这份缓存完整，activate 才敢删旧的）
    expect(code).toContain('VERSION_MARKER');
  });

  it('activate 只认 CURRENT_VERSION 当"当前版本"，不再从 caches.keys() 反推（评审 N-1 的根因）', () => {
    const code = stripComments(sw);
    const activate = code.slice(code.indexOf("addEventListener('activate'"));
    // 反向钉住 N-1 的**根因写法**：把"当前版本"算成"缓存里所有带标记版本的集合"，会让
    // `!versions.has(x.version)` 对任何带标记的缓存恒为假 ⇒ 完整旧缓存永远删不掉。
    expect(
      activate,
      '从缓存自身反推"当前版本"= 完整旧缓存永远删不掉（评审 N-1：点完更新后离线仍拿旧壳）',
    ).not.toMatch(/new Set\(entries\.map/);
    expect(activate, 'activate 必须真的删缓存').toContain('caches.delete');
    // ⚠️ 这里**刻意不再**禁止 `CACHE_PREFIX + CURRENT_VERSION` 这个写法：评审变异 M-G 证明
    //    同一写法**加了 null 守卫就是正确的**（activate 段的三条规则里第 2 条）。上一轮那条
    //    `not.toMatch(/CACHE_PREFIX\s*\+\s*CURRENT_VERSION/)` 把唯一自然的正确修法一起禁掉了
    //    （行为改对、文本腿反而变红），所以它**已被下面第 5b 组的四条行为腿取代**（真跑
    //    install+activate 断言删了谁 / 留了谁，含"版本号缺失不误删"），不是被删掉了事。
    //    这一条只留"根因写法"这一半，删掉根因写法仍然会红（见报告的变异表 M-N1b）。
  });

  it('fetch 只处理同源 GET，且导航失败回退 /index.html', () => {
    expect(sw).toMatch(/req\.method\s*!==\s*'GET'/);
    expect(sw).toMatch(/url\.origin\s*!==\s*self\.location\.origin/);
    expect(sw).toContain("'navigate'");
    expect(sw).toContain("caches.match('/index.html')");
  });
});

/* ── 5b. public/sw.js 的**行为**腿：把 install / activate 处理函数在 node 里真跑起来 ────
 *
 * ## 为什么必须这样（本轮的核心整改）
 * 上半组那条文本腿原来只断言源码里含 `caches.delete` 字符串 —— 而 activate **整个清理能力
 * 都没了**的时候它照样全绿（评审 N-1：真 Chrome 里点完"立即更新"再断网，拿到的是**上一版**
 * 的壳；Cache Storage 每次发布净增约 1 MiB 永不回收）。更糟的是：把 activate 按**行为**改对
 * （拿 `CURRENT_VERSION` 比、加 null 守卫）会让那条文本腿**变红** —— 判据主动禁止了唯一自然
 * 的正确修法（评审变异 M-G）。所以这里改成：用 `new Function('self', src)` 把 `public/sw.js`
 * **它自己的** install / activate 处理函数跑起来，断言**删了谁、留了谁**。
 *
 * ## N-7 的治理教训（这条腿的取材纪律）
 * 上一轮的"真浏览器自查"里，探针页**自己**调了 `register('/sw.js')`，没走应用自己的注册路径，
 * 于是报了 `registered:true` 而 B-1（应用根本不注册）依然存在；同一次自查的 3 条断网检查全
 * false 也没上报。⇒ **腿不得替被测代码做事**。这里：代码只从 `read('../../public/sw.js')` 来
 * （不重写实体，只把构建期占位符换成版本串 —— 那是 `gen-sw-manifest.mjs` 干的事，第 6 组
 * 用生成器自己的 `stampSw` 证明同一条替换），事件只由 `self.addEventListener` **自己**注册的
 * 处理函数消费，缓存操作只经 `self.caches`，断言只看 `caches.delete` 的真实调用与 `keys()`
 * 的真实结果。
 * ------------------------------------------------------------------------- */

/** 沙箱里的 response 桩（只需 readMarker 用到的 `text()`） */
function swResponse(body: string, status = 200): { ok: boolean; status: number; text(): Promise<string> } {
  return { ok: status >= 200 && status < 300, status, text: async () => body };
}

interface SwCacheApi {
  keys(): Promise<string[]>;
  open(name: string): Promise<{
    addAll(files: string[]): Promise<void>;
    put(url: string, res: unknown): Promise<void>;
    match(url: string): Promise<unknown>;
  }>;
  delete(name: string): Promise<boolean>;
  match(req: unknown): Promise<unknown>;
}

interface SwRun {
  caches: SwCacheApi;
  deleted: string[];
  puts: string[];
  /** 按类型触发 sw.js **自己注册**的处理函数，并收集它 waitUntil 的 promise */
  dispatch(type: string, event?: Record<string, unknown>): Promise<void>;
}

const SW_ORIGIN = 'https://example.test';
const SW_MARKER_URL = SW_ORIGIN + '/sw-version';
const SW_MANIFEST_URL = SW_ORIGIN + '/sw-manifest.json';
/** 夹具用的版本号：**必须**是清单那种 16 位十六进制（sw.js 的 isRealVersion 只认这种形状） */
const SW_V_NEW = 'a1b2c3d4e5f60718';
const SW_V_OLD = '0f1e2d3c4b5a6978';

/** 把 repo 里的 `public/sw.js` 取来，只做**生成器做的那一次**占位符替换 */
function swSourceWithVersion(version: string): string {
  const raw = read('../../public/sw.js');
  expect(raw, 'public/sw.js 里没有版本占位符 ⇒ 版本戳机制（N-2）断了').toContain(SW_VERSION_PLACEHOLDER);
  return raw.replace(SW_VERSION_PLACEHOLDER, version);
}

/**
 * 在 node 里把 sw.js 当 **classic script** 真跑起来。
 * `caches` 是手写的最小 Cache Storage：`seed` 里带 markerUrl 的那一项就是"版本标记"，
 * 没有 marker 的缓存 = 没跑完 install 的**半截**缓存。
 */
function loadSw(opts: {
  src: string;
  manifest?: unknown;
  seed?: [string, string | null][];
}): SwRun {
  const stores = new Map<string, Map<string, unknown>>();
  for (const [name, marker] of opts.seed ?? []) {
    const s = new Map<string, unknown>();
    if (marker !== null) s.set(SW_MARKER_URL, swResponse(marker));
    stores.set(name, s);
  }
  const deleted: string[] = [];
  const puts: string[] = [];
  const caches = {
    async keys() {
      return [...stores.keys()];
    },
    async open(name: string) {
      if (!stores.has(name)) stores.set(name, new Map());
      const store = stores.get(name) as Map<string, unknown>;
      return {
        async addAll(files: string[]) {
          for (const f of files) store.set(new URL(f, SW_ORIGIN).href, swResponse('body:' + f));
        },
        async put(url: string, res: unknown) {
          puts.push(name + ' ' + url);
          store.set(url, res);
        },
        async match(url: string) {
          return store.get(url);
        },
      };
    },
    async delete(name: string) {
      deleted.push(name);
      return stores.delete(name);
    },
    async match(req: unknown) {
      const url = typeof req === 'string' ? req : ((req as { url?: string }).url ?? '');
      for (const store of stores.values()) if (store.has(url)) return store.get(url);
      return undefined;
    },
  };

  const listeners = new Map<string, ((ev: unknown) => void)[]>();
  const fetchImpl = async (url: unknown) => {
    if (String(url) === SW_MANIFEST_URL) {
      const manifest = opts.manifest ?? { version: SW_V_NEW, files: ['/index.html'] };
      return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(manifest)), text: async () => '' };
    }
    return { ok: false, status: 404, json: async () => ({}), text: async () => '' };
  };
  /**
   * ## 为什么是 `new Function(前导声明, src)` 而不是 `new Function('self', src)`（实测教训）
   * sw.js 里有些引用是**自由标识符**（裸 `fetch(`、`new Response(`）。若只把 `self` 传进去，
   * 那个函数体在**本测试模块的全局**里解析自由标识符 —— 于是 `self.fetch` 是桩、而裸 `fetch`
   * 是 node 的真 fetch（实测：跑 install 时真的去 DNS 解析 `example.test`，ENOTFOUND）。
   * 解法是把沙箱的**每个键**都绑成函数体的局部标识符（下面的前导声明由 `Object.keys(sandbox)`
   * **生成**，不手写名单）：于是无论代码写 `self.fetch` 还是裸 `fetch`，走的都是桩。
   * 用 `node:vm` 也能达到同样效果，但那需要给 `tests/node-types.d.ts` 加声明（本仓没有
   * `@types/node`，那份声明是极简手写的）—— 而这条路**零新声明、零依赖**，所以选它。
   * `let` 而非 `const`：sw.js 对 `self.clients` 之类只读不写，但 `let` 更宽松、也更贴近真实全局。
   */
  const sandbox = {
    caches,
    fetch: fetchImpl,
    console,
    URL,
    Response: class {
      body: string;
      constructor(body?: unknown) {
        this.body = String(body ?? '');
      }
      async text() {
        return this.body;
      }
      static error() {
        return new this('');
      }
    },
    location: { href: SW_ORIGIN + '/sw.js', origin: SW_ORIGIN },
    clients: { matchAll: async () => [], claim: async () => {} },
    skipWaiting: () => {},
    addEventListener(type: string, cb: (ev: unknown) => void) {
      listeners.set(type, [...(listeners.get(type) ?? []), cb]);
    },
  } as Record<string, unknown>;
  sandbox.self = sandbox; // classic script 的形态：self 就是全局
  const prelude = Object.keys(sandbox)
    .map((k) => `let ${k} = sandbox[${JSON.stringify(k)}];`)
    .join('\n');
  new Function('sandbox', `${prelude}\n${opts.src}`)(sandbox);

  return {
    caches,
    deleted,
    puts,
    async dispatch(type: string, event: Record<string, unknown> = {}) {
      const waits: Promise<unknown>[] = [];
      const ev = { ...event, waitUntil: (p: Promise<unknown>) => { waits.push(p); } };
      for (const cb of listeners.get(type) ?? []) cb(ev);
      await Promise.all(waits);
    },
  };
}

describe('public/sw.js 行为腿：activate 真的删旧缓存、留当前缓存（评审 N-1）', () => {
  it('① caches = [compile-OLD, compile-NEW]（都带正确版本标记）⇒ 删 compile-OLD、留 compile-NEW', async () => {
    // 场景取"同一 SW 实例：install 成功 → activate"。旧版本缓存完整（带标记 OLD）。
    const sw = loadSw({
      src: swSourceWithVersion(SW_V_NEW),
      manifest: { version: SW_V_NEW, files: ['/index.html'] },
      seed: [['compile-' + SW_V_OLD, SW_V_OLD]],
    });
    await sw.dispatch('install');
    expect(await sw.caches.keys(), '夹具没生效：install 之后应该有两份缓存').toEqual([
      'compile-' + SW_V_OLD,
      'compile-' + SW_V_NEW,
    ]);
    await sw.dispatch('activate');
    expect(sw.deleted, '计划 :2445「activate：删掉旧版本缓存」没达成（评审 N-1 的回归就是这条）').toEqual([
      'compile-' + SW_V_OLD,
    ]);
    expect(await sw.caches.keys(), '当前版本的缓存被误删了 ⇒ 离线能力没了').toEqual(['compile-' + SW_V_NEW]);
  });

  it('② caches = [compile-NEW, compile-BROKEN]（后者无标记/半截）⇒ 删 compile-BROKEN', async () => {
    const sw = loadSw({
      src: swSourceWithVersion(SW_V_NEW),
      manifest: { version: SW_V_NEW, files: ['/index.html'] },
      seed: [['compile-' + SW_V_OLD + '-broken', null]],
    });
    await sw.dispatch('install');
    await sw.dispatch('activate');
    expect(sw.deleted).toEqual(['compile-' + SW_V_OLD + '-broken']);
    expect(await sw.caches.keys()).toEqual(['compile-' + SW_V_NEW]);
  });

  it('③ 只有 compile-NEW ⇒ 不误删自己（activate 之后离线壳还在）', async () => {
    const sw = loadSw({
      src: swSourceWithVersion(SW_V_NEW),
      manifest: { version: SW_V_NEW, files: ['/index.html'] },
    });
    await sw.dispatch('install');
    expect(await sw.caches.keys()).toEqual(['compile-' + SW_V_NEW]);
    await sw.dispatch('activate');
    expect(sw.deleted, 'activate 把自己的缓存删了 = 每次激活都清空离线壳').toEqual([]);
    expect(await sw.caches.keys()).toEqual(['compile-' + SW_V_NEW]);
  });

  it('④ 版本号不可用（占位符没被替换）⇒ 一份完整缓存都不删（宁可留下也不能删正在用的）', async () => {
    // ④ 就是被删掉的那条文本禁止（CACHE_PREFIX + CURRENT_VERSION 字形）的**行为**替代：
    //    同一写法加了这个守卫就是正确的。
    const sw = loadSw({
      // 模板原样加载：CURRENT_VERSION 停在占位符上，且 install 不跑（activate 落在没跑过
      // install 的实例里 —— 评审 S-4 的场景）
      src: read('../../public/sw.js'),
      seed: [
        ['compile-AAA', 'AAA'],
        ['compile-BBB', 'BBB'],
      ],
    });
    await sw.dispatch('activate');
    expect(sw.deleted, '版本号不可用时删了完整缓存 ⇒ 就是 S-4 的 compile-null 删光').toEqual([]);
    expect(await sw.caches.keys()).toEqual(['compile-AAA', 'compile-BBB']);
    // 半截缓存（无标记）在这条路径上**仍然**删（规则 3 与规则 2 独立）
    const sw2 = loadSw({
      src: read('../../public/sw.js'),
      seed: [
        ['compile-AAA', 'AAA'],
        ['compile-null', null],
      ],
    });
    await sw2.dispatch('activate');
    expect(sw2.deleted).toEqual(['compile-null']);
  });

  it('⑤ install 真的预缓存清单里的文件，并把版本号写进缓存（"有标记=完整"的前提）', async () => {
    const sw = loadSw({
      src: swSourceWithVersion(SW_V_NEW),
      manifest: { version: SW_V_NEW, files: ['/index.html', '/assets/app.js'] },
    });
    await sw.dispatch('install');
    expect(await sw.caches.keys()).toEqual(['compile-' + SW_V_NEW]);
    expect(sw.puts, 'install 少了版本标记的写入 ⇒ activate 会把这份完整缓存当半截删掉').toEqual([
      'compile-' + SW_V_NEW + ' ' + SW_MARKER_URL,
    ]);
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
    // （修复轮 2 备注：版本戳新增的 `DEFAULT_SW_TEMPLATE` 一行，把 `sw.js` 的**路径**指给版本戳用。
    //  它既不是缓存名单、也不写文件，但本腿是**按行**判的 ⇒ 那行结尾注了 `SKIP` 说明它指的就是
    //  `SKIP` 名单里的自己人。判据本身没有放宽。）
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
        `文件名字面量 ${text} 出现在既不是 SKIP 也不是 writeFileSync 的行上：${JSON.stringify(line)}`,
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

  it('版本键**覆盖清单里的每一个文件**：任何一项被漏算 ⇒ version 必须变', () => {
    // 评审假守卫 M10：`computeVersion(files.slice(0, -1))` 曾**全绿**（变更了实现，但没有任何腿
    // 判"版本键是否真的覆盖全部文件"）。这条腿把"覆盖性"变成可判定的：从清单里逐个（以及一次
    // 全部）剔除文件，若版本**不变**，就说明那个文件没进版本键。
    const dir = tmp({
      'index.html': 'HTML-A',
      'assets/index-aaa.js': 'JS-A',
      'assets/index-bbb.css': 'CSS-B',
      'manifest.webmanifest': 'MF-A',
      'icons/icon-192.png': 'PNG-A',
    });
    const all = collectFiles(dir);
    expect(all.length, '夹具本身没构出清单，腿恒真').toBe(5);
    const full = computeVersion(all);
    for (const drop of all) {
      const rest = all.filter((f) => f.rel !== drop.rel);
      expect(
        computeVersion(rest),
        `漏掉 ${drop.rel} 版本键却没变 ⇒ 版本键没覆盖这个文件（清单与 cacheName 会不匹配）`,
      ).not.toBe(full);
    }
    expect(computeVersion(all.slice(0, -1))).not.toBe(full); // M10 的形态，逐字钉住
    // ⚠️ 上面只钉住了 `computeVersion` 本身。**调用点**也必须钉住：`run()` 里
    //    `computeVersion(files.slice(0, -1))` 这种"少喂一个文件"的变异只在 run() 里，
    //    `computeVersion` 的腿看不见它。所以这里再对**真实生成的清单**做一次独立复算：
    //    清单里写的 version 必须等于"对 collectFiles 的全部文件独立算出来的 version"。
    const report = genManifest(dir);
    const manifest = JSON.parse(
      readFileSync(join(dir, 'sw-manifest.json')).subarray(0, 1024 * 1024).toString('utf8'),
    ) as { version: string; files: string[] };
    expect(manifest.files).toEqual(all.map((f) => f.rel));
    expect(
      report.version,
      'run() 写出的版本键 ≠ 对清单全部文件独立复算的版本键（少喂/多喂文件了）',
    ).toBe(full);
    expect(manifest.version).toBe(full);
    cleanup();
  });

  it('预缓存 = app shell：卡图/PDF/音效**不进**清单，图标进（设计稿 §8.1 / 评审重要 2）', () => {
    const dir = tmp({
      // app shell：进
      'index.html': 'A',
      'assets/index-abc123.js': 'B',
      'assets/index-abc123.css': 'C',
      'manifest.webmanifest': 'D',
      'icons/icon-192.png': 'E',
      // 大体积资产：不进（预缓存只收 app shell；它们仍走运行时 fetch）
      'assets/protocols/ambush/01.png': 'F',
      'assets/protocols/ambush/02.jpg': 'G',
      'assets/rules/rule-faq.pdf': 'H',
      'assets/rules/covers/cover.png': 'I',
      'assets/audio/bgm.mp3': 'J',
      'assets/battery/volt.png': 'K',
      'assets/bg-thumbs/t.png': 'L',
    });
    expect(collectFiles(dir).map((f) => f.rel)).toEqual([
      '/assets/index-abc123.css',
      '/assets/index-abc123.js',
      '/icons/icon-192.png',
      '/index.html',
      '/manifest.webmanifest',
    ]);
    // 逐条把判据本身也钉住（防止某天有人把 SHELL_EXT 放宽成"什么都收"）
    expect(isShellAsset('/assets/index-abc123.js')).toBe(true);
    expect(isShellAsset('/assets/index-abc123.css')).toBe(true);
    expect(isShellAsset('/icons/icon-512.png')).toBe(true);
    expect(isShellAsset('/assets/protocols/ambush/01.png')).toBe(false);
    expect(isShellAsset('/assets/rules/rule-faq.pdf')).toBe(false);
    expect(isShellAsset('/assets/audio/bgm.mp3')).toBe(false);
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
    // 清单体积（重要 2 的验收数）：app shell 应该是**几 MiB 以内**，不是几百 MiB
    const bytes = collectFiles(dist).reduce((n, f) => n + statSync(f.abs).size, 0);
    expect(bytes, `预缓存清单 ${(bytes / 1024 / 1024).toFixed(1)} MiB —— 预缓存又涨回几百 MiB？`).toBeLessThan(
      32 * 1024 * 1024,
    );
    // 逐条：图片 / PDF / 音效一个都不许进预缓存（哪怕后缀在 EXT_OK 里）
    const heavy = manifest.files.filter((f) => /\.(png|jpe?g|webp|gif|pdf|mp3)$/i.test(f) && !f.startsWith('/icons/'));
    expect(heavy, `预缓存里混进了大体积资产：${heavy.slice(0, 5).join(', ')}`).toEqual([]);
    expect(manifest.files.filter((f) => f.startsWith('/icons/')).length).toBeGreaterThan(0);
  });


  /* ── 版本戳（修复轮 2 / 评审 N-2）：内容型发布必须能触发"重装 SW" ──────────────
   * 浏览器只在 SW 脚本**字节变化**时重装。`vite build` 只原样拷贝 `public/sw.js`，
   * 所以没有版本戳时"只发内容"永远不提示更新、离线永远停旧版（评审真 Chrome A→B→C→D 实测）。
   * 下面四条腿真跑生成器，证明这条链成立，并证明它**不会说话不算数**（占位符缺席就大声失败）。 */
  // 假 dist 里的 sw.js **直接就是**仓库的真模板（构建时 vite 也是这么原样拷贝它）——
  // 这样"版本戳"这条腿跑的就是真产物会走的那份模板，而不是测试里重写的迷你副本（N-7 的取材纪律）。
  // ⚠️ `stampSw` 的**模板来源永远是它**（不是刚打好的 dist/sw.js）：模板是"带占位符的源文件"，
  // 已打戳的产物再喂回去当然找不到占位符 —— 那正是"大声失败"在保护的行为。
  const swFixtureFiles = (): Record<string, string> => ({
    'index.html': 'HTML-A',
    'assets/index-aaa.js': 'JS-A',
    'sw.js': read('../../public/sw.js'),
  });

  it('① dist/sw.js 里的版本串 == dist/sw-manifest.json 的 version（占位符一律不留）', () => {
    const dir = tmp(swFixtureFiles());
    const report = genManifest(dir);
    stampSw(dir, report.version, DEFAULT_SW_TEMPLATE);
    const swText = readFileSync(join(dir, 'sw.js')).subarray(0, 1024 * 1024).toString('utf8');
    const manifest = JSON.parse(
      readFileSync(join(dir, 'sw-manifest.json')).subarray(0, 1024 * 1024).toString('utf8'),
    ) as { version: string };
    expect(readSwVersion(dir), 'dist/sw.js 里的版本串 ≠ 清单 version ⇒ cacheName 与清单会不一致').toBe(report.version);
    expect(manifest.version).toBe(report.version);
    expect(swText, '占位符还在 dist/sw.js 里 ⇒ 版本戳没写进去').not.toContain(SW_VERSION_PLACEHOLDER);
    // 幂等：同一个 dist 再打一次戳，结果逐字节相同（生成器可以被重复调用）
    stampSw(dir, report.version, DEFAULT_SW_TEMPLATE);
    expect(readFileSync(join(dir, 'sw.js')).subarray(0, 1024 * 1024).toString('utf8')).toBe(swText);
    cleanup();
  });

  it('② 内容变化 ⇒ version 变 ⇒ dist/sw.js 字节变（N-2 的因果链）；内容不变 ⇒ 两边都不变', () => {
    const a = tmp(swFixtureFiles());
    const r1 = genManifest(a);
    stampSw(a, r1.version, DEFAULT_SW_TEMPLATE);
    const sw1 = readSwVersion(a);
    const bytes1 = readFileSync(join(a, 'sw.js')).subarray(0, 1024 * 1024).toString('utf8');
    expect(sw1).toBe(r1.version);

    // 只改一个**被清单覆盖**的文件的内容（发布新内容，不动 sw.js 模板）
    const a2 = tmp(swFixtureFiles());
    writeFileSync(join(a2, 'index.html'), 'HTML-B', 'utf8');
    const r2 = genManifest(a2);
    stampSw(a2, r2.version, DEFAULT_SW_TEMPLATE);
    const sw2 = readSwVersion(a2);
    const bytes2 = readFileSync(join(a2, 'sw.js')).subarray(0, 1024 * 1024).toString('utf8');
    expect(r2.version, '内容变了版本却没变 ⇒ 版本键没覆盖到那个文件').not.toBe(r1.version);
    expect(sw2, 'sw.js 里的版本戳没跟着清单变 ⇒ SW 不会重装 ⇒ N-2 原样复发').toBe(r2.version);
    expect(bytes2, '★ N-2 的根因：内容变了而 dist/sw.js 字节不变 ⇒ 浏览器认为 SW 没更新').not.toBe(bytes1);

    // 内容不变（同内容、不同目录）⇒ 版本与 sw.js 字节都不变（不会无谓地让所有人重下）
    const c = tmp(swFixtureFiles());
    const r3 = genManifest(c);
    stampSw(c, r3.version, DEFAULT_SW_TEMPLATE);
    expect(r3.version).toBe(r1.version);
    expect(readFileSync(join(c, 'sw.js')).subarray(0, 1024 * 1024).toString('utf8')).toBe(bytes1);
    cleanup();
  });

  it('③ 占位符缺席 ⇒ 抛错（静默跳过 = 悄悄退回 N-2：内容型发布永不提示更新）', () => {
    const dir = tmp({ 'index.html': 'HTML', 'sw.js': '/* 没有占位符的 sw */\nlet CURRENT_VERSION = null;\n' });
    const report = genManifest(dir);
    expect(
      () => stampSw(dir, report.version, join(dir, 'sw.js')),
      '占位符缺席时静默通过 ⇒ 没人会发现版本戳断了',
    ).toThrow(
      /恰好出现 1 次/,
    );
    expect(readSwVersion(dir), '没打上戳的 dist/sw.js 不该被读出版本串').toBeNull();
    // 反向：占位符出现两次也要大声失败（否则写不干净）
    const dir2 = tmp({
      'index.html': 'HTML',
      'sw.js': "let a = '__SW_VERSION__';\nlet b = '__SW_VERSION__';\n",
    });
    expect(() => stampSw(dir2, '0123456789abcdef', join(dir2, 'sw.js'))).toThrow(/恰好出现 1 次/);
    // 模板文件整个不存在 ⇒ 也是大声失败，不是静默跳过（缺省模板也不许悄悄降级）
    const dir3 = tmp({ 'index.html': 'HTML' });
    expect(() => stampSw(dir3, '0123456789abcdef', join(dir3, 'nope-sw.js'))).toThrow(/找不到 service worker 模板/);
    // 缺省模板（`DEFAULT_SW_TEMPLATE` = 仓库的 public/sw.js）存在且恰好一处占位符
    expect(existsSync(DEFAULT_SW_TEMPLATE)).toBe(true);
    cleanup();
  });

  it('④ 发布链 generate()：一次调用同时产出清单与**已打戳**的 sw.js（CLI 走的就是它）', () => {
    // 这条腿钉的是"发布链真的闭合"：CLI 分支（`if (isMain)`）在 vitest 里**不执行**，
    // 所以只有把"清单 + 版本戳"收进可调用的 `generate()` 才看得见它。变异 M-N2d
    // （generate 不打戳）会让这条腿红 —— 而不再是被一条**无关**的文本腿顺手撞红。
    const dir = tmp(swFixtureFiles());
    const r = generate(dir, DEFAULT_SW_TEMPLATE);
    expect(readSwVersion(dir), '生成器溜了一圈却没把版本戳写进 dist/sw.js').toBe(r.version);
    expect(r.swFile).toBe(join(dir, 'sw.js'));
    const manifest = JSON.parse(
      readFileSync(join(dir, 'sw-manifest.json')).subarray(0, 1024 * 1024).toString('utf8'),
    ) as { version: string };
    expect(manifest.version).toBe(r.version);
    // 反向：模板缺失时**大声失败**（不许静默跳过版本戳 —— 那就是 N-2 原样复发）
    const bare = tmp({ 'index.html': 'HTML' });
    expect(() => generate(bare, join(bare, 'no-template.js'))).toThrow(/找不到 service worker 模板/);
    cleanup();
  });

  it('⑤ 对真实 dist/ 也打一次戳（构建产物本身被正确注入，不只是夹具）', () => {
    const dist = join(ROOT, 'dist');
    if (!existsSync(dist)) {
      throw new Error('dist/ 不存在 —— 本腿必须先跑 npx vite build（门禁顺序：tsc → build → vitest）');
    }
    const report = genManifest(dist);
    stampSw(dist, report.version, DEFAULT_SW_TEMPLATE);
    const swText = readFileSync(join(dist, 'sw.js')).subarray(0, 1024 * 1024).toString('utf8');
    expect(swText, 'dist/sw.js 里有残留占位符').not.toContain(SW_VERSION_PLACEHOLDER);
    expect(swText, 'dist/sw.js 的 CURRENT_VERSION 没指向真实的版本串').toMatch(
      new RegExp("CURRENT_VERSION = '" + report.version + "';"),
    );
    expect(readSwVersion(dist)).toBe(report.version);
    // 反向：模板（public/sw.js）**必须**留着占位符，否则版本戳下一次就写不进去
    expect(read('../../public/sw.js')).toContain(SW_VERSION_PLACEHOLDER);
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
    // 调用点必须排在**第一屏被显示**之前，且仍在 setSeedNonce 之后（不能插进 setSeedNonce /
    // createGame 之间，也不能跑到启动屏之后）。
    //
    // ## 为什么把锚点从 `showHome();` 换成"顶层启动屏调用"（Task 8 修复轮 2 / 评审 N-8）
    // 计划附录 A `:3226` 明确把 `main.ts` 末尾的 `showHome();` → `showStartScreen();` 归给 Task 4。
    // Task 4 一旦这么做，`lastIndexOf('showHome();')` 只能取到**函数体内**那一处（在
    // `initPwaUpdate()` **之前**）⇒ 这条腿必然假红（工作区实测：`expected 32214 to be less than 29914`）。
    // 这属于**被预期改动打破的守卫 ⇒ 按意图重推**，不是放宽：
    //   旧锚点的意图是"注册 SW 排在启动序列里、且在第一屏被显示之前"；
    //   它错在把意图**绑死在"启动屏函数叫什么名字"**上 —— 而那个名字恰恰被计划授权改动。
    // 新判据用**零缩进**识别**顶层**启动屏调用（函数体内那两处 `showHome();` 都带缩进、不匹配），
    // 于是对名字保持生成式：Task 4 改了名，这条腿跟着新名字走；只要"注册在启动屏之前"仍然成立，
    // 它就是绿的。牙齿：把 `initPwaUpdate();` 挪到启动屏**之后** ⇒ 红；挪到 `setSeedNonce` 之前 ⇒ 红。
    const at = calls[0].index ?? -1;
    const seed = main.indexOf('setSeedNonce(newMatchSeed());');
    const bootCalls = [...main.matchAll(/^(showStartScreen|showHome)\(\);/gm)];
    expect(bootCalls.length, '启动屏调用必须是文件里唯一一条顶层语句').toBe(1);
    const boot = bootCalls[0].index ?? -1;
    expect(seed, '找不到 setSeedNonce 锚点').toBeGreaterThan(-1);
    expect(at, 'initPwaUpdate() 落在了 setSeedNonce 之前（会打乱 G0 的启动语义）').toBeGreaterThan(seed);
    expect(at, 'initPwaUpdate() 落在了启动屏之前').toBeLessThan(boot);
  });

  it('main.ts 里 cb / rerender 两个函数体一字未动（G4 的收口范围）', () => {
    // 只钉"这两个函数仍然存在且 rerender 仍以 renderApp 收口"——它们是**禁令**的锚点：
    // 若 Task 8 的接线把 rerender 改坏，本腿与 net-preview-wiring.test.ts 会同时变红。
    expect(main).toMatch(/\bfunction rerender\(\)/);
    expect(main).toMatch(/\bconst cb\b/);
  });
});
