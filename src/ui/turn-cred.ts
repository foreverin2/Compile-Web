/**
 * ★★ **G6/T50（方案 B1）：TURN 凭据的取 / 续 / 降级**（浏览器侧唯一出处）。
 *
 * ## 这个文件解决的事
 *
 * 过去 `iceServers` 里内联着**永久有效的静态密码**（`net-browser.ts` 的 `DEFAULT_ICE_SERVERS`），
 * 它打在前端 JS 里 ⇒ 谁都能白嫖中继。B1 把它换成"**每一次开局前向我们自己的签发服务换一份
 * 短时凭据**"：换得到就用中继，换不到就**如实降级成直连**（不阻塞单人 / 热座 / 同网直连）。
 *
 * 边界（照 `src/ui/net-browser.ts` 的既成做法）：
 *  - 浏览器 API 只出现在**注入缝**后面（`fetch` / `abortSignal` / `runtimeTimer` / `clock`），
 *    零参调用形态（`createTurnCredentialStore()`）永远可用；
 *  - **上界必须是能在测试里非零构造出来的东西** ⇒ 超时走注入，不裸 `setTimeout`；
 *  - 这个文件**不碰 `iceServers` 的组装**（那是 `readIceServers` 的事），只回答
 *    "这一刻有没有一份能用的凭据、为什么没有"。
 *
 * ## 为什么返回"读数"而不是"凭据或 null"
 *
 * 屏上要如实说"这一轮没有中继可用"，而"为什么没有"是玩家能懂的那句的一部分
 * （签发服务没回应 / 回了一句读不懂的东西 / 回了个错）。`null` 表达不了这件事，
 * 于是它是一份**带 reason 的读数** —— 与 `IceGatherResult` 的失败形态同款。
 *
 * ## ★ 2026-10-02（P3 第七批）：7 条裸中文搬进 `src/i18n/`
 *
 * 这一层原来有 7 条裸中文（`describeTurnCredentialFailure` 的 4 条 + 2 条 `detail` +
 * `defaultFetch` 的 1 条 reject 消息）。前 4 条是**玩家能看见**的：它们的落点是
 * `net-browser.ts` 的 `relayUnavailableNoteOf`（那一句的 `{why}`），英文界面下曾经夹着中文
 * （台账 G.3 第 1 条）。这一批按逐屏抽取的同一套规矩搬到 `turn-cred.*` 键：
 * **中文值逐字守恒**（逐字由 `.superpowers/i18n-turn-cred/check-verbatim.mjs` 从 `git show HEAD:`
 * 抓原文机检），**只换字符串来源、不改任何一条行为**（分支、超时、缓存、读数形状一字未动）。
 *
 * ⚠️ 全部 7 处都是**现调 `t()`**（都在函数体内）：模块顶层调 `t()` 会把语言冻在 import
 * 那一刻（`tests/i18n/module-scope-t.test.ts` 钉这条）。`t()` 读的是**调用那一刻**的语言 ——
 * 这一点对 `describeTurnCredentialFailure` 尤其重要：它的调用方（渲染那一刻的
 * `relayUnavailableNoteOf`）与它同语言 ⇒ 屏上那句整句一致。
 */

// 玩家可见的那几句走文案表（`turn-cred.*`）。这一层是 `src/ui/**` ⇒ 与其它屏同一口径：
// 只 import `t`，**不在模块顶层调它**（语言是模块级内存态，顶层调用会冻在 import 那一刻）。
import { t } from '../i18n';

/** 一份**换到手的**凭据（服务端 `GET /turn-cred` 的字段，见 `server/turn-cred/lib/handler.mjs`） */
export interface TurnCredential {
  /** 服务端给的中继 URL（本仓线上那台 coturn 的 `turn:` 地址） */
  readonly urls: readonly string[];
  /** username = `<expiryUnix>:<scope>`（coturn 按它算 HMAC） */
  readonly username: string;
  /** base64(HMAC-SHA1(secret, username)) —— 短时，过期即废 */
  readonly credential: string;
  /** 这份凭据还能用多少秒（服务端封顶后的值） */
  readonly ttlSeconds: number;
}

/** 为什么这一刻手上没有凭据（**都能翻成人话**，见 `describeTurnCredentialFailure`） */
export type TurnCredentialFailure =
  /** 签发服务在超时内没有回应（网络不通 / 服务停了） */
  | 'timeout'
  /** HTTP 非 2xx（429 限流、403 封禁、404 路径不对…） */
  | 'rejected'
  /** 连都没连上（DNS / 连接被拒 / 混内容拦截） */
  | 'unreachable'
  /** 回了一句但读不懂（不是 JSON / 少了字段 / 字段形状不对） */
  | 'malformed';

/** 一次"取凭据"的读数 */
export type TurnCredentialRead =
  | { readonly available: true; readonly source: 'app'; readonly credential: TurnCredential }
  | { readonly available: false; readonly source: 'app'; readonly reason: TurnCredentialFailure; readonly detail?: string };

/** 浏览器 `fetch` 的最小结构面（只用到这三个成员 —— 结构面越小，假件越容易与真件同形） */
export interface TurnCredFetchResponseLike {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
}

export interface TurnCredFetchInitLike {
  readonly method: 'GET';
  readonly signal?: unknown;
  readonly cache: 'no-store';
}

/** 计时能力（形状与 `net-browser.ts` 的 `GatherTicker` 同形：`window.setTimeout` 直接就能塞进来） */
export interface TurnCredTicker {
  schedule(fn: () => void, ms: number): number;
  cancel(h: number): void;
}

/** 取凭据要用的那一台服务的配置 */
export interface TurnCredSettings {
  /**
   * 签发服务的地址。**默认 `/turn-cred`（同源）**：runbook 里 nginx 就是把这个路径反代到
   * `127.0.0.1:<port>`，于是既不用配 CORS、也不会有混内容问题。
   */
  readonly endpoint: string;
  /** 上界（毫秒）。**必须有界**：取凭据不许把"生成邀请码"卡死（任务书 §1(2)） */
  readonly timeoutMs: number;
  /** 用户名里冒号后面那一段（B1 阶段没有身份，默认 `player`；服务端只拿它做日志与配额归类） */
  readonly scope: string;
  /** 客户端想多长的凭据（服务端封顶，回应里的 `ttl` 才是准的） */
  readonly ttlSeconds: number;
}

/** 缺省设置：同源、2 秒上界、scope=player、要 600 秒 */
export const DEFAULT_TURN_CRED_SETTINGS: TurnCredSettings = {
  endpoint: '/turn-cred',
  timeoutMs: 2_000,
  scope: 'player',
  ttlSeconds: 600,
};

/** 提前多少毫秒续期（在过期前就把新凭据换回来，玩家不该感觉到"续期"这件事） */
export const TURN_CRED_RENEW_MARGIN_MS = 10_000;

export interface TurnCredentialStoreEnv {
  /** 真 `fetch`（缺省 = `globalThis.fetch`，拿不到就判 `unreachable`） */
  readonly fetch?: (url: string, init: TurnCredFetchInitLike) => Promise<TurnCredFetchResponseLike>;
  /** 中止信号工厂（缺省 = `AbortSignal.timeout(ms)`；拿不到就不带信号，靠下面那个计时器兜底） */
  readonly abortSignal?: (ms: number) => unknown;
  /** 计时能力（缺省 = `setTimeout` / `clearTimeout`） */
  readonly ticker?: TurnCredTicker;
  /** 时钟（缺省 = `Date.now`；注入是为了让"续期没续期"可断言） */
  readonly clock?: () => number;
  /** 地址解析的基（缺省 = `location.href`；相对路径要靠它补成绝对地址） */
  readonly baseUrl?: () => string;
  /** 设置（可缺省；缺省即 `DEFAULT_TURN_CRED_SETTINGS`） */
  readonly settings?: () => Partial<TurnCredSettings> | null;
  /** 诊断钩子：每一次真实的取用都报一条（**不进玩家文案**，只给宿主计数/日志用） */
  readonly onAttempt?: (info: { ok: boolean; reason?: TurnCredentialFailure; ms: number }) => void;
}

/** 取凭据的客户端（宿主只用到这四个方法） */
export interface TurnCredentialStore {
  /** **同步**读这一刻的凭据（没有就返回一份带 reason 的读数）。不阻塞、不发请求 */
  read(): TurnCredentialRead;
  /** 主动去换一份（缓存还新就复用；已有在飞的那一次就搭它的车）。**有上界**，不抛 */
  refresh(): Promise<TurnCredentialRead>;
  /** 最近一次失败的读数（`read()` 的对偶；成功时为 `null`） */
  lastFailure(): { reason: TurnCredentialFailure; detail?: string } | null;
  /** 诊断读数：真发出去过几次请求、其中成功几次 */
  stats(): { attempts: number; issued: number; servedFromCache: number };
}

/** 一个响应形状对不对（**缺一个字段就不许用**：凭据是喂给 `RTCPeerConnection` 的） */
function parseCredential(raw: unknown): TurnCredential | null {
  if (raw === null || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (!Array.isArray(o.urls) || o.urls.length === 0) return null;
  const urls = o.urls.filter((u): u is string => typeof u === 'string' && u.trim().length > 0);
  if (urls.length !== o.urls.length) return null;
  // 只有中继 URL 才配叫"这一份凭据的中继"（回一条 stun: 进来 = 服务端配错了，不能当能用）
  if (!urls.every((u) => /^turns?:/i.test(u.trim()))) return null;
  if (typeof o.username !== 'string' || o.username.trim().length === 0) return null;
  if (typeof o.credential !== 'string' || o.credential.length === 0) return null;
  const ttl = o.ttl;
  if (typeof ttl !== 'number' || !Number.isFinite(ttl) || ttl <= 0) return null;
  return { urls: urls.map((u) => u.trim()), username: o.username, credential: o.credential, ttlSeconds: ttl };
}

/** 默认计时能力（真浏览器 / node 都有的那一对全局函数） */
function defaultTicker(): TurnCredTicker {
  return {
    schedule: (fn, ms) => setTimeout(fn, ms) as unknown as number,
    cancel: (h) => { clearTimeout(h as unknown as ReturnType<typeof setTimeout>); },
  };
}

function defaultFetch(
  url: string, init: TurnCredFetchInitLike,
): Promise<TurnCredFetchResponseLike> {
  const f = (globalThis as { fetch?: (u: string, i: unknown) => Promise<TurnCredFetchResponseLike> }).fetch;
  if (typeof f !== 'function') return Promise.reject(new Error(t('turn-cred.error.no-fetch')));
  return f(url, init);
}

/**
 * 造一个凭据客户端。
 *
 * **零参调用形态必须永远可用**（`createTurnCredentialStore()`），可选参数只为注入假件 ——
 * 理由与 `createBrowserTransport(env?)` 逐字相同（本仓栽过一次"测试里替换 `globalThis`"的亏）。
 */
export function createTurnCredentialStore(env?: TurnCredentialStoreEnv): TurnCredentialStore {
  const ticker = env?.ticker ?? defaultTicker();
  const clock = env?.clock ?? (() => Date.now());
  const doFetch = env?.fetch ?? defaultFetch;

  /** 当前手上的那一份（含它的过期时刻） */
  let current: { credential: TurnCredential; expiresAtMs: number } | null = null;
  /** 最近一次失败的读数 */
  let failure: { reason: TurnCredentialFailure; detail?: string } | null = null;
  /** 在飞的那一次（并发调用搭同一趟车，别把限流额度用在重复请求上） */
  let inFlight: Promise<TurnCredentialRead> | null = null;
  let attempts = 0;
  let issued = 0;
  let servedFromCache = 0;

  const resolveSettings = (): TurnCredSettings => {
    const given = env?.settings?.() ?? null;
    return {
      endpoint: typeof given?.endpoint === 'string' && given.endpoint.length > 0
        ? given.endpoint : DEFAULT_TURN_CRED_SETTINGS.endpoint,
      timeoutMs: typeof given?.timeoutMs === 'number' && given.timeoutMs > 0
        ? given.timeoutMs : DEFAULT_TURN_CRED_SETTINGS.timeoutMs,
      scope: typeof given?.scope === 'string' && given.scope.length > 0
        ? given.scope : DEFAULT_TURN_CRED_SETTINGS.scope,
      ttlSeconds: typeof given?.ttlSeconds === 'number' && given.ttlSeconds > 0
        ? given.ttlSeconds : DEFAULT_TURN_CRED_SETTINGS.ttlSeconds,
    };
  };

  /** 端点 + 查询串 ⇒ 绝对地址（相对路径靠 `baseUrl` 补；补不出来就原样用，交给 fetch 抛） */
  const urlOf = (s: TurnCredSettings): string => {
    const sep = s.endpoint.includes('?') ? '&' : '?';
    const path = `${s.endpoint}${sep}ttl=${String(Math.floor(s.ttlSeconds))}&scope=${encodeURIComponent(s.scope)}`;
    if (/^https?:\/\//i.test(path)) return path;
    const base = env?.baseUrl?.() ?? (globalThis as { location?: { href?: string } }).location?.href ?? '';
    if (typeof base !== 'string' || base.length === 0) return path;
    try { return new URL(path, base).href; } catch { return path; }
  };

  const read = (): TurnCredentialRead => {
    if (current !== null && clock() < current.expiresAtMs) {
      return { available: true, source: 'app', credential: current.credential };
    }
    return {
      available: false,
      source: 'app',
      reason: failure?.reason ?? 'unreachable',
      ...(failure?.detail === undefined ? {} : { detail: failure.detail }),
    };
  };

  /**
   * 真去换一份。
   *
   * 三条纪律：
   *  1. **有上界**：`timeoutMs` 到点就判 `timeout`（同时 `abort` 掉那次请求）；
   *  2. **失败绝不写进缓存**：取了就忘，下一次 `refresh()` 会再试一次
   *     （把一个瞬时的 500 记成"以后都没有凭据"是错的）；
   *  3. **不抛**：任何一条异常路径都翻成读数。
   */
  const doRefresh = async (): Promise<TurnCredentialRead> => {
    const settings = resolveSettings();
    const url = urlOf(settings);
    const t0 = clock();
    attempts += 1;
    let timerHandle: number | null = null;
    let signal: unknown;
    const signalFactory = env?.abortSignal;
    if (signalFactory !== undefined) {
      try { signal = signalFactory(settings.timeoutMs); } catch { signal = undefined; }
    }
    const timeout = new Promise<'timeout'>((resolve) => {
      timerHandle = ticker.schedule(() => { resolve('timeout'); }, settings.timeoutMs);
    });
    /** 把一条失败路径结算干净（**唯一**的失败出口：缓存不写、计数、日志、读数一次成形） */
    const fail = (reason: TurnCredentialFailure, detail?: string): TurnCredentialRead => {
      failure = detail === undefined ? { reason } : { reason, detail };
      env?.onAttempt?.({ ok: false, reason, ms: clock() - t0 });
      return detail === undefined
        ? { available: false, source: 'app', reason }
        : { available: false, source: 'app', reason, detail };
    };
    try {
      const racing = doFetch(url, signal === undefined
        ? { method: 'GET', cache: 'no-store' }
        : { method: 'GET', cache: 'no-store', signal });
      const res = await Promise.race([racing, timeout]);
      if (res === 'timeout') return fail('timeout', t('turn-cred.detail.timeout', { ms: String(settings.timeoutMs) }));
      if (!res.ok) return fail('rejected', `HTTP ${String(res.status)}`);
      let body: unknown;
      try { body = await res.json(); } catch (e) { return fail('malformed', String(e)); }
      const parsed = parseCredential(body);
      if (parsed === null) return fail('malformed', t('turn-cred.detail.malformed'));
      const lifeMs = Math.max(1_000, parsed.ttlSeconds * 1000 - TURN_CRED_RENEW_MARGIN_MS);
      current = { credential: parsed, expiresAtMs: clock() + lifeMs };
      failure = null;
      issued += 1;
      env?.onAttempt?.({ ok: true, ms: clock() - t0 });
      return { available: true, source: 'app', credential: parsed };
    } catch (e) {
      // 连都没连上（DNS / 连接被拒 / 混内容 / 被扩展拦）：与"服务回了个错"分开报
      return fail('unreachable', String(e));
    } finally {
      if (timerHandle !== null) ticker.cancel(timerHandle);
    }
  };

  const refresh = (): Promise<TurnCredentialRead> => {
    const nowRead = read();
    if (nowRead.available) { servedFromCache += 1; return Promise.resolve(nowRead); }
    if (inFlight !== null) return inFlight;
    const p = doRefresh().finally(() => { inFlight = null; });
    inFlight = p;
    return p;
  };

  return {
    read,
    refresh,
    lastFailure: () => (failure === null ? null : { ...failure }),
    stats: () => ({ attempts, issued, servedFromCache }),
  };
}

/**
 * 把失败原因翻成**玩家能懂**的一句（屏上那句"没有中继可用"的一半就来自它）。
 *
 * ★ 2026-10-02（P3 第七批）：四条文案搬进 `turn-cred.reason.*`；**现调 `t()`**
 * （调用方在渲染那一刻取，语言因此与整句一致）。行为一字未改：仍是四条 `if` + 一个兜底。
 */
export function describeTurnCredentialFailure(reason: TurnCredentialFailure): string {
  if (reason === 'timeout') return t('turn-cred.reason.timeout');
  if (reason === 'rejected') return t('turn-cred.reason.rejected');
  if (reason === 'malformed') return t('turn-cred.reason.malformed');
  return t('turn-cred.reason.unreachable');
}
