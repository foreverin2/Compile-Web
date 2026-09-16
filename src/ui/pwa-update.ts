/**
 * PWA 的注册与**自动提示 + 一键更新**（G3；设计稿 §8.1、§8.4 的"网页 / PWA"行）。
 *
 * 零依赖：不装 `vite-plugin-pwa`、不改 `vite.config.ts`。SW 本体是 `public/sw.js`（手写，
 * classic script），预缓存清单由构建脚本 `scripts/gen-sw-manifest.mjs` 生成到
 * `dist/sw-manifest.json`。
 *
 * ## 四条纪律（每条都被 `tests/ui/pwa-update.test.ts` 钉住）
 *  1. **dev 不注册**（`import.meta.env.DEV`）：否则开发期 SW 会缓存住入口，`vite dev` 的
 *     模块热更新失效（"手写 SW"最容易踩的坑）。
 *  2. **不许静默自动刷新**：`update-ready` 只**提示**；真正换代码要用户点"立即更新"
 *     （刷新会打断正在进行的一局）。设计稿 §8.4 要的就是"提示 → skipWaiting + reload"，
 *     其中"提示"是用户可见的一步，不是可以省略的实现细节。
 *  3. **不新增 body 级常驻层**：更新条插在 `#app` 的第一层，且是**懒插**（每次提示时现插，
 *     因为宿主屏（授权弹窗 / 本地数据屏）会 `root.textContent = ''` 把内容清掉），
 *     卸载函数负责移除。本仓在 G2 已因 `document.body` 级浮层残留栽过一次。
 *  4. **环境可注入**（`PwaEnv`）：SW API 在 node 下不存在，行为腿靠从参数缝里递假件。
 *     浏览器全局的读取**只允许出现在 `realEnv()` 一处**
 *     （测试里有一条腿数它出现的次数）。
 *
 * ## 这个模块证明什么 / 不能证明什么
 *  能：状态机五态与转移、`SKIP_WAITING` 是唯一的一键更新动作、提示阶段零刷新、
 *      注册失败被降级为 `failed` 态（PWA 不可用不影响游戏）。
 *  不能：真实浏览器里 SW 到底注册成功没有、断网后页面是否真的打得开 —— 那要 https/127.0.0.1
 *      下的真 SW，属**用户验收**（计划「用户验收」第 4 项）。
 */

/* ── SW 的最小结构型接口（只声明本模块**用到**的成员，不照抄 DOM 类型） ───────── */

export interface SwRegistrationLike {
  waiting: unknown | null;
  installing: unknown | null;
  addEventListener(t: string, cb: () => void): void;
  update(): Promise<void>;
}

export interface SwContainerLike {
  register(url: string, opts?: { scope?: string }): Promise<SwRegistrationLike>;
  getRegistration(): Promise<SwRegistrationLike | undefined>;
  addEventListener(t: string, cb: () => void): void;
  readonly controller: unknown;
}

/** 更新条只用到这几个元素成员（行为腿用最小手写桩即可，不需要 jsdom） */
export interface PwaElementLike {
  className: string;
  textContent: string;
  type?: string;
  // ⚠️ 子节点参数刻意放宽到 `unknown`：语义就是"把某个子节点挂上来"，本模块从不读回它。
  //    真实 `HTMLElement` 的 `appendChild<T extends Node>(node: T): T` 与
  //    `prepend(...nodes: (Node | string)[]): void` 都能满足本接口 —— 若在这里收紧成
  //    `PwaElementLike`，`document.createElement` 的返回值就赋不进来，注入缝会**假死**
  //    （G3 Task 8 实测：tsc 直接报 prepend 参数逆变不兼容）。
  appendChild(child: unknown): unknown;
  prepend(child: unknown): unknown;
  addEventListener(t: string, cb: () => void): void;
  remove(): unknown;
  querySelector?(sel: string): PwaElementLike | null;
}

/** 更新条的宿主（`#app`）与元素工厂。node 下不存在 `document`，所以两者都必须能注入。 */
export interface PwaUiLike {
  host(): PwaElementLike | null;
  make(tag: string): PwaElementLike;
}

export interface PwaEnv {
  sw: SwContainerLike | null;
  reload(): void;
  isProd: boolean;
  /** 有更新可用时调用一次（**只提示，不刷新**） */
  onUpdateAvailable(): void;
  /** 状态转移回调（测试/诊断用；默认空实现） */
  onState?(state: PwaUpdateState): void;
  /** 更新条宿主（默认 `document.getElementById('app')` + `document.createElement`） */
  ui?: PwaUiLike;
}

/* ── 状态机（纯函数） ─────────────────────────────────────────────────────────
 * 五态是判据的硬要求：**无更新 / 有更新 / 更新中 / 已更新 / 失败**，每态一条腿。
 * `nextUpdateState` 刻意不碰任何浏览器对象 —— 它可以在 node 下被穷举。
 * ------------------------------------------------------------------------- */

export type PwaUpdateState =
  | { kind: 'idle'; prompted: false }
  | { kind: 'update-ready'; prompted: true }
  | { kind: 'updating'; prompted: true }
  | { kind: 'updated'; prompted: true; phase: 'skip-waiting' }
  | { kind: 'failed'; prompted: boolean; phase: 'register' | 'apply'; reason: string };

export type PwaUpdateEvent =
  | { type: 'updatefound'; installing?: unknown }
  | { type: 'installed' }
  | { type: 'waiting-present' }
  | { type: 'apply-update' }
  | { type: 'skip-waiting-sent' }
  | { type: 'failed'; reason: string; phase: 'register' | 'apply' };

export const INITIAL_UPDATE_STATE: PwaUpdateState = { kind: 'idle', prompted: false };

/** 纯转移函数：非法/无关事件返回**原状态**（幂等，绝不抛错 —— PWA 不可用不该影响游戏）。 */
export function nextUpdateState(state: PwaUpdateState, ev: PwaUpdateEvent): PwaUpdateState {
  switch (ev.type) {
    case 'updatefound':
      // 新 SW 只是开始安装：还不能提示（等 'installed'）
      return state;
    case 'installed':
    case 'waiting-present':
      return { kind: 'update-ready', prompted: true };
    case 'apply-update':
      return { kind: 'updating', prompted: true };
    case 'skip-waiting-sent':
      return { kind: 'updated', prompted: true, phase: 'skip-waiting' };
    case 'failed':
      return { kind: 'failed', prompted: state.kind === 'idle' ? false : true, phase: ev.phase, reason: ev.reason };
    default:
      return state;
  }
}

/* ── 一键更新的**唯一动作** ────────────────────────────────────────────────── */

/**
 * 向等待中的 SW 发跳过等待指令（页面随后 reload 才会用上新的 controller）。
 * 没有 `waiting` 时是**安全 no-op**（不抛错）。
 */
export function applyUpdate(reg: SwRegistrationLike): void {
  const w = reg.waiting as { postMessage?: (m: unknown) => void } | null;
  if (w && typeof w.postMessage === 'function') w.postMessage({ type: 'SKIP_WAITING' });
}

/* ── 默认（真实）环境 ─────────────────────────────────────────────────────── */

/** `globalThis` 上可能挂着 Service Worker 容器的那一小块（不引 DOM 全局名字，见 realEnv 的说明）。 */
interface SwHolder {
  serviceWorker?: SwContainerLike;
}

/** 真实浏览器的 `#app` 宿主 + `document` 元素工厂。node 下宿主恒为 null。 */
function realUi(): PwaUiLike {
  const doc = (globalThis as { document?: Document }).document;
  return {
    host: () => (doc ? doc.getElementById('app') : null),
    // 只在 host 非空（⇒ 有 document）时被调用，故这里的 doc 必然存在
    make: (tag: string) => (doc as Document).createElement(tag),
  };
}

/**
 * 从真实的 Service Worker 容器取默认环境。**本模块唯一**允许直接碰浏览器全局的地方。
 *
 * 写成 `(globalThis as unknown as SwHolder | undefined)?.serviceWorker` 而不是经 `globalThis` 上的
 * 浏览器全局名字（后者的属性访问形态会让源码里出现第二处"裸访问"，而测试的"注入缝守卫"数的
 * 就是这种形态）—— 把唯一出口做成**可数的一个**，守卫才有意义。
 */
function realEnv(): PwaEnv {
  const holder = globalThis as unknown as SwHolder | undefined;
  return {
    sw: holder?.serviceWorker ?? null,
    reload: () => (globalThis as { location?: { reload(): void } }).location?.reload(),
    isProd: !import.meta.env.DEV,
    onUpdateAvailable: () => {},
    ui: realUi(),
  };
}

/** 更新条的元素类名与文案（唯一出处）。对玩家的离线说明在 Task 5 的隐私文案里。 */
export const UPDATE_BAR_CLASS = 'pwa-update-bar';
export const UPDATE_BAR_TEXT = '有新版本可用';
export const UPDATE_BAR_BUTTON = '立即更新';

/** 点了"立即更新"之后等新 controller 接管的时间上限（到点仍没接管也要刷新，不能卡住用户） */
export const RELOAD_FALLBACK_MS = 1500;

/**
 * 懒插更新条：宿主屏（授权弹窗 / 本地数据屏）会 `root.textContent = ''` 把内容清掉，
 * 所以每次"有更新"时都确认一次，而不是在注册时插一次。宿主上已有条则不动。
 */
function mountUpdateBar(ui: PwaUiLike, onClick: () => void): void {
  const host = ui.host();
  if (!host) return;
  if (typeof host.querySelector === 'function' && host.querySelector(`.${UPDATE_BAR_CLASS}`) !== null) return;
  const bar = ui.make('div');
  bar.className = UPDATE_BAR_CLASS;
  const text = ui.make('span');
  text.textContent = UPDATE_BAR_TEXT;
  const btn = ui.make('button');
  btn.type = 'button';
  btn.className = 'btn';
  btn.textContent = UPDATE_BAR_BUTTON;
  btn.addEventListener('click', onClick);
  bar.appendChild(text);
  bar.appendChild(btn);
  host.prepend(bar);
}

function removeUpdateBar(ui: PwaUiLike): void {
  const host = ui.host();
  if (!host || typeof host.querySelector !== 'function') return;
  host.querySelector(`.${UPDATE_BAR_CLASS}`)?.remove();
}

/* ── 注册与更新提示 ───────────────────────────────────────────────────────── */

/**
 * 注册 SW 并挂"自动提示 + 一键更新"。返回**卸载函数**（移除更新条）。
 * `main.ts` 在初始化区调一次；失败一律降级为 `failed` 态（PWA 不可用不影响游戏）。
 *
 * 默认注册 `/sw.js`、`scope: '/'`；dev 或没有 serviceWorker 能力时**直接返回空卸载函数**。
 */
export function initPwaUpdate(overrides: Partial<PwaEnv> = {}): () => void {
  const base = realEnv();
  const env: PwaEnv = { ...base, ...overrides };
  const ui: PwaUiLike = env.ui ?? base.ui ?? realUi();
  const container = env.sw;
  if (!env.isProd || container === null) return () => {};

  let disposed = false;
  let state: PwaUpdateState = INITIAL_UPDATE_STATE;
  let prompted = false;      // 幂等闸：提示只发一次
  let reloading = false;     // 刷新闸：controllerchange 与超时兜底只允许刷新一次

  const emit = (next: PwaUpdateState): void => {
    state = next;
    try { env.onState?.(state); } catch { /* 诊断回调不该影响游戏 */ }
  };

  const reloadOnce = (): void => {
    if (disposed || reloading) return;
    reloading = true;
    env.reload();
  };

  // 新 SW 接管页面 ⇒ 用户点的"一键更新"生效了。刷新在这里发生（**不是**在提示时）。
  container.addEventListener('controllerchange', () => {
    if (disposed || state.kind !== 'updating') return;
    emit(nextUpdateState(state, { type: 'skip-waiting-sent' }));
    reloadOnce();
  });

  const prompt = (reg: SwRegistrationLike): void => {
    if (disposed || prompted) return;
    prompted = true;
    emit(nextUpdateState(state, { type: 'waiting-present' }));
    try { env.onUpdateAvailable(); } catch { /* 同上 */ }
    mountUpdateBar(ui, () => {
      if (disposed) return;
      emit(nextUpdateState(state, { type: 'apply-update' }));
      try {
        applyUpdate(reg);
      } catch (e) {
        emit({ kind: 'failed', prompted: true, phase: 'apply', reason: String(e) });
        return;
      }
      // 还没有新的 controller 时，收到它的 postMessage 会立即接管并触发 controllerchange；
      // 但若用户点的这一刻 controller 已经是新的（或浏览器没有派发该事件），给一个兜底刷新。
      globalThis.setTimeout(() => {
        if (disposed || state.kind !== 'updating') return;
        emit(nextUpdateState(state, { type: 'skip-waiting-sent' }));
        reloadOnce();
      }, RELOAD_FALLBACK_MS);
    });
  };

  /** 监听"正在安装"的那个 SW：装好（installed）且有 controller ⇒ 是**更新**，提示。 */
  const watchInstalling = (installing: unknown, reg: SwRegistrationLike): void => {
    const sw = installing as { state?: string; addEventListener?: (t: string, cb: () => void) => void } | null;
    if (!sw) return;
    if (typeof sw.addEventListener === 'function') {
      sw.addEventListener('statechange', () => {
        if (sw.state === 'installed' && container.controller) prompt(reg);
      });
    }
    if (sw.state === 'installed' && container.controller) prompt(reg);
  };

  void Promise.resolve()
    .then(() => container.register('/sw.js', { scope: '/' }))
    .then((reg) => {
      if (disposed || !reg) return;
      if (reg.waiting) { prompt(reg); return; }   // 已有等待中的 SW：立刻提示（不依赖 updatefound）
      watchInstalling(reg.installing, reg);
      reg.addEventListener('updatefound', () => {
        if (disposed) return;
        emit(nextUpdateState(state, { type: 'updatefound', installing: reg.installing }));
        watchInstalling(reg.installing, reg);
      });
    })
    .catch((e: unknown) => {
      if (disposed) return;
      emit({ kind: 'failed', prompted: false, phase: 'register', reason: String(e) });
    });

  return () => {
    disposed = true;
    removeUpdateBar(ui);
  };
}
