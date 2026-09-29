/**
 * 请求处理：**一个纯函数**（不碰 socket、不碰 `Date.now()`）。
 *
 * 形状照本仓的既成做法（`src/ui/net-browser.ts` 往 `globalThis` 打桩那次教训）：
 * 能注入的都注入 —— 判定才可断言。这里注入的是 `nowMs` 与 `clientIp`
 * （它们在真 HTTP 里来自 `Date.now()` 与 socket，在单测里来自字面量）。
 *
 * ## 路由
 *
 *  - `GET /healthz` ⇒ 200 `{ok:true,...}`（nginx / 监控用；**不计数**，否则监控自己会打满限流）
 *  - `GET /turn-cred` ⇒ 200 `{urls,username,credential,ttl}` / 403 deny / 429 限流 / 400 参数
 *  - 其余 ⇒ 404
 *
 * ## 两处**故意**的取舍
 *
 *  - `urls` 与 `realm` 是服务端配置，**不接受**客户端传；客户端只能传 `?ttl=` 与 `?scope=`；
 *  - `?ttl=` 服务端封顶：调小可以（有人只想要 2 分钟），调大不行（封顶 = `ttlMaxSeconds`）。
 *    封顶值写进响应里的 `ttl`，客户端照它缓存 —— 不给"客户端以为自己要了 1 小时"的空间。
 */

import { issueCredential } from './cred.mjs';
import { credentialFingerprint } from './log.mjs';

/** 允许的 scope 形状：短、只含字母数字与 `-_.`（**不许冒号**：它会破坏 `expiry:scope` 的解析） */
const SCOPE_RE = /^[A-Za-z0-9._-]{1,64}$/;

/** 把一个值说成 JSON 响应 */
function json(status, body, extraHeaders = {}) {
  return {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extraHeaders },
    body,
  };
}

/**
 * CORS：**只给这一个接口开**（`GET` + `OPTIONS` 预检）。
 *
 * 为什么必须处理 `OPTIONS`：跨源时浏览器先发预检，而预检**不带**我们的任何逻辑 ——
 * 不答它，真实请求根本不会发出去（页面侧只看到 `TypeError: Failed to fetch`，
 * 与"服务挂了"长得一模一样，T50 第一次跑真浏览器门就是这么红的）。
 *
 * 生产推荐仍然是同源反代（那条路上一个预检都不会有）；这里只是让"跨源"这条备选路真的能用。
 */
function corsHeaders(config) {
  return {
    'access-control-allow-origin': config.allowOrigin,
    'access-control-allow-methods': 'GET, HEAD, OPTIONS',
    'access-control-allow-headers': 'content-type',
    'access-control-max-age': '600',
    vary: 'origin',
  };
}

/**
 * 从 `x-forwarded-for` 里取**最后一跳**。
 *
 * 为什么是最后一跳而不是第一跳：nginx 把客户端地址**追加**在右边（`X-Forwarded-For: <客户端>`），
 * 而左边可能是别人自己伪造的。取最后一跳 = 取"我们信得过的那台反代亲眼看到的那个地址"。
 * 这一支只在 `trustProxy` 打开时用（默认关：直接暴露在公网时不该信任何请求头）。
 */
export function clientIpOf(headers, remoteAddress, trustProxy) {
  if (trustProxy) {
    const xff = headers['x-forwarded-for'];
    if (typeof xff === 'string' && xff.trim().length > 0) {
      const parts = xff.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
      if (parts.length > 0) return normalizeIp(parts[parts.length - 1]);
    }
    const real = headers['x-real-ip'];
    if (typeof real === 'string' && real.trim().length > 0) return normalizeIp(real.trim());
  }
  return normalizeIp(remoteAddress);
}

/** `::ffff:127.0.0.1` → `127.0.0.1`（IPv4 映射写法：限流的键必须是同一个字符串） */
export function normalizeIp(ip) {
  const s = String(ip ?? '').trim();
  return s.startsWith('::ffff:') ? s.slice('::ffff:'.length) : s;
}

/**
 * 处理一次请求。
 *
 * @param {object} req
 * @param {string} req.method HTTP 方法（只认 GET / HEAD）
 * @param {string} req.pathname 路径（不含查询串）
 * @param {URLSearchParams} req.query 查询串
 * @param {string} req.clientIp 客户端 IP（`clientIpOf` 的结果）
 * @param {number} req.nowMs 此刻（毫秒）
 * @param {object} req.config `loadConfig()` 的 `config`
 * @param {import('./rate-limit.mjs').RateLimiter} req.limiter
 * @param {import('./rate-limit.mjs').DenyList} req.deny
 * @param {import('./log.mjs').Logger} req.logger
 */
export function handleRequest(req) {
  const { method, pathname, query, clientIp, nowMs, config, limiter, deny, logger } = req;
  const base = { ip: clientIp, method };
  const cors = corsHeaders(config);

  // ★ 预检：不签、不计数，只把跨源那几项答清楚（见 `corsHeaders` 的说明）
  if (method === 'OPTIONS') {
    logger.line('info', { ...base, result: 'preflight', scope: null });
    return { status: 204, headers: { ...cors, 'content-length': '0' }, body: '' };
  }

  if (pathname === '/healthz') {
    logger.line('info', { ...base, result: 'healthz', scope: null });
    return json(200, {
      ok: true,
      service: 'turn-cred',
      realm: config.realm,
      urls: [...config.urls],
      ttlDefaultSeconds: config.ttlSeconds,
      ttlMaxSeconds: config.ttlMaxSeconds,
      perIpPerMinute: config.perIpPerMinute,
      perIpConcurrent: config.perIpConcurrent,
      denyPatterns: deny.patterns.length,
    }, cors);
  }

  if (pathname !== '/turn-cred') {
    logger.line('info', { ...base, result: 'not-found', scope: null });
    return json(404, { ok: false, error: 'not-found', message: '这里只有 GET /turn-cred 与 GET /healthz。' }, cors);
  }

  if (method !== 'GET' && method !== 'HEAD') {
    logger.line('info', { ...base, result: 'method-not-allowed', scope: null });
    return json(405, { ok: false, error: 'method-not-allowed', message: '请用 GET。' },
      { ...cors, allow: 'GET, HEAD, OPTIONS' });
  }

  // ① 封禁（读一次 deny 文件；`refresh` 自己带 5 秒节流）
  deny.refresh(nowMs);
  if (deny.has(clientIp)) {
    logger.line('warn', { ...base, result: 'denied', scope: null });
    return json(403, {
      ok: false,
      error: 'denied',
      message: '这个网络地址已被禁止取用中继凭据。若你认为是误封，请把这一行连同时间发给维护者。',
    }, cors);
  }

  // ② scope（默认 `player`：B1 阶段还没有身份，scope 只用于日志与配额归类）
  const rawScope = query.get('scope');
  const scope = rawScope === null || rawScope.trim().length === 0 ? 'player' : rawScope.trim();
  if (!SCOPE_RE.test(scope)) {
    logger.line('info', { ...base, result: 'bad-scope', scope: scope.slice(0, 32) });
    return json(400, {
      ok: false,
      error: 'bad-scope',
      message: 'scope 只允许 1-64 个字母、数字、点、下划线或减号。',
    }, cors);
  }

  /**
   * ③ ttl：客户端**可以调小**，但服务端**两头都封** —— 夹在 `[ttlMinSeconds, ttlMaxSeconds]` 之间。
   *
   * ⚠️ **下限不是装饰**（T50 评审实测抓到的功能缺口）：改之前只有 `Math.min(n, ttlMaxSeconds)`，
   * 于是 `?ttl=1` 原样回 1 —— 签出去一份**一秒就过期**的凭据，`ttlMinSeconds` 全仓没有消费者。
   * 一份几秒的凭据对玩家毫无用处（ICE 都还没收集完就废了），而它照样**占用**那个 IP 的并发额度。
   * ⇒ 低于下限的一律夹到下限，并在日志里记 `ttl-clamped`（与 `ttl-capped` 分开，读日志时能分辨）。
   */
  const rawTtl = query.get('ttl');
  let ttlSeconds = config.ttlSeconds;
  if (rawTtl !== null && rawTtl.trim().length > 0) {
    const n = Number(rawTtl.trim());
    if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
      logger.line('info', { ...base, result: 'bad-ttl', scope });
      return json(400, { ok: false, error: 'bad-ttl', message: 'ttl 必须是正整数秒。' }, cors);
    }
    ttlSeconds = Math.min(Math.max(n, config.ttlMinSeconds), config.ttlMaxSeconds);
    if (n > config.ttlMaxSeconds) {
      logger.line('info', { ...base, result: 'ttl-capped', scope, ttl: ttlSeconds, requested: n });
    } else if (n < config.ttlMinSeconds) {
      logger.line('info', { ...base, result: 'ttl-clamped', scope, ttl: ttlSeconds, requested: n });
    }
  }

  // ④ 限流（两道闸）
  const verdict = limiter.check(clientIp, nowMs);
  if (!verdict.allowed) {
    logger.line('warn', { ...base, result: `rate-limited:${verdict.reason}`, scope, limit: verdict.limit, used: verdict.used });
    return json(429, {
      ok: false,
      error: verdict.reason === 'rate' ? 'rate-limited' : 'too-many-credentials',
      limit: verdict.limit,
      used: verdict.used,
      retryAfterSeconds: 60,
      message: verdict.message,
    }, { ...cors, 'retry-after': '60' });
  }

  // ⑤ 签发
  const issued = issueCredential({ secret: config.secret, scope, ttlSeconds, nowMs });
  limiter.record(clientIp, nowMs, issued.expiry * 1000);
  logger.line('info', {
    ...base,
    result: 'issued',
    scope,
    ttl: ttlSeconds,
    expiry: issued.expiry,
    // ★ 只写指纹：**绝不**写 credential 原文（任务书 §1(1) 的硬要求）
    credFp: credentialFingerprint(issued.credential),
  });
  return json(200, {
    urls: [...config.urls],
    username: issued.username,
    credential: issued.credential,
    ttl: ttlSeconds,
    realm: config.realm,
  }, cors);
}
