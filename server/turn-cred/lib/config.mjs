/**
 * 签发服务的配置读取（**唯一出处**）。
 *
 * 纪律（T50 任务书 §1(1)）：
 *  - 密钥**只从环境变量 / 服务器文件读**，绝不进 git、绝不进前端产物；
 *  - 缺密钥时**拒绝启动**（fail fast）—— 静默发一批"签不对的凭据"比不启动更坏：
 *    前端会拿到 200、把中继写进 ICE 列表，然后每一次分配都被 coturn 拒（401），
 *    而屏上什么都不会说。
 *  - 所有参数都能用环境变量覆盖，便于 runbook 里"怎么调限流"那一段照着改。
 */

import { readFileSync } from 'node:fs';

/** 数字环境变量：读不到 / 不是正整数 ⇒ 用缺省值（并把它记在 `notes` 里，不静默） */
function envInt(env, name, fallback) {
  const raw = env[name];
  if (raw === undefined || String(raw).trim() === '') return { value: fallback, note: null };
  const n = Number(String(raw).trim());
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
    return { value: fallback, note: `${name}=${String(raw)} 不是正整数，按缺省 ${fallback} 用` };
  }
  return { value: n, note: null };
}

/** 逗号分隔的 URL 列表（`TURN_URLS`）。空 ⇒ 缺省那一台 coturn */
function parseUrls(raw) {
  if (typeof raw !== 'string') return null;
  const items = raw.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
  return items.length === 0 ? null : items;
}

export const DEFAULT_TURN_URLS = Object.freeze(['turn:8.130.97.243:3478']);

/** 读密钥：**只**从 `TURN_CRED_SECRET_FILE`（优先）或 `TURN_CRED_SECRET` 读 */
export function readSecret(env = process.env) {
  const file = env.TURN_CRED_SECRET_FILE;
  if (typeof file === 'string' && file.trim().length > 0) {
    try {
      const text = readFileSync(file.trim(), 'utf8').trim();
      return { secret: text, source: `file:${file.trim()}` };
    } catch (e) {
      return { secret: '', source: `file:${file.trim()}`, error: String(e && e.message ? e.message : e) };
    }
  }
  const inline = env.TURN_CRED_SECRET;
  if (typeof inline === 'string' && inline.trim().length > 0) {
    return { secret: inline.trim(), source: 'env:TURN_CRED_SECRET' };
  }
  return { secret: '', source: 'none' };
}

/**
 * 把环境变量读成一份**冻结的**配置。
 *
 * 返回 `{ ok: true, config }` 或 `{ ok: false, problems }` —— **不抛**：
 * 调用方（`server.mjs --check` 与单测）要能逐条读到"哪里不对"，而不是只拿到一个异常串。
 */
export function loadConfig(env = process.env) {
  const problems = [];
  const notes = [];

  const { secret, source, error } = readSecret(env);
  if (error !== undefined) problems.push(`读密钥文件失败（${source}）：${error}`);
  if (secret.length === 0) {
    problems.push(
      '没有密钥：请设 TURN_CRED_SECRET_FILE（推荐，指向只有 root 能读的文件）或 TURN_CRED_SECRET。'
      + '缺密钥时本服务拒绝启动（否则会给前端发一批 coturn 必然拒签的凭据）。',
    );
  }

  const realm = typeof env.TURN_CRED_REALM === 'string' && env.TURN_CRED_REALM.trim().length > 0
    ? env.TURN_CRED_REALM.trim()
    : 'compile-turn';

  const urls = parseUrls(env.TURN_URLS) ?? [...DEFAULT_TURN_URLS];

  const ttl = envInt(env, 'TURN_CRED_TTL', 600);
  const maxTtl = envInt(env, 'TURN_CRED_TTL_MAX', 900);
  const minTtl = envInt(env, 'TURN_CRED_TTL_MIN', 60);
  const perMinute = envInt(env, 'TURN_CRED_PER_IP_PER_MINUTE', 10);
  const concurrent = envInt(env, 'TURN_CRED_PER_IP_CONCURRENT', 3);
  const port = envInt(env, 'TURN_CRED_PORT', 8788);
  const maxLogBytes = envInt(env, 'TURN_CRED_LOG_MAX_BYTES', 5 * 1024 * 1024);
  const trustProxy = env.TURN_CRED_TRUST_PROXY === '1' || env.TURN_CRED_TRUST_PROXY === 'true';
  for (const r of [ttl, maxTtl, minTtl, perMinute, concurrent, port, maxLogBytes]) {
    if (r.note !== null) notes.push(r.note);
  }
  if (minTtl.value > maxTtl.value) {
    problems.push(`TURN_CRED_TTL_MIN(${minTtl.value}) 大于 TURN_CRED_TTL_MAX(${maxTtl.value})`);
  }
  if (ttl.value > maxTtl.value) {
    notes.push(`TURN_CRED_TTL(${ttl.value}) 被 TURN_CRED_TTL_MAX(${maxTtl.value}) 封顶`);
  }

  const config = Object.freeze({
    secret,
    secretSource: source,
    realm,
    urls: Object.freeze([...urls]),
    ttlSeconds: Math.min(Math.max(ttl.value, minTtl.value), maxTtl.value),
    ttlMaxSeconds: maxTtl.value,
    ttlMinSeconds: minTtl.value,
    perIpPerMinute: perMinute.value,
    perIpConcurrent: concurrent.value,
    bindHost: typeof env.TURN_CRED_HOST === 'string' && env.TURN_CRED_HOST.trim().length > 0
      ? env.TURN_CRED_HOST.trim()
      : '127.0.0.1',
    port: port.value,
    denyFile: typeof env.TURN_CRED_DENY_FILE === 'string' && env.TURN_CRED_DENY_FILE.trim().length > 0
      ? env.TURN_CRED_DENY_FILE.trim()
      : null,
    /**
     * ★★ **CORS：缺省 `*`**（T50 实测加的一条）。
     *
     * 生产的推荐形态是**同源反代**（`/turn-cred` ⇒ `127.0.0.1:8788`），那条路上浏览器根本不会发
     * 跨源请求、也就不用这个头。但"线上换个域名 / 本地起一个真签发服务给门禁跑"这两种情形都会
     * 变成跨源，而**没有这个头浏览器会直接把请求判失败**（`TypeError: Failed to fetch`，
     * 页面侧看起来与"服务挂了"一模一样 —— 实测就是这么红的）。
     *
     * 为什么 `*` 是安全的：这个接口**不带 cookie、不带任何凭据**，回出去的那份凭据
     * 本来就只换来一个中继端口（短时、可限流、可封禁），而且**带 CORS 头不等于放宽限流**
     * （限流按 IP 走）。要收紧就设 `TURN_CRED_ALLOW_ORIGIN=https://<你的站点>`。
     */
    allowOrigin: typeof env.TURN_CRED_ALLOW_ORIGIN === 'string' && env.TURN_CRED_ALLOW_ORIGIN.trim().length > 0
      ? env.TURN_CRED_ALLOW_ORIGIN.trim()
      : '*',
    logFile: typeof env.TURN_CRED_LOG_FILE === 'string' && env.TURN_CRED_LOG_FILE.trim().length > 0
      ? env.TURN_CRED_LOG_FILE.trim()
      : null,
    logMaxBytes: maxLogBytes.value,
    trustProxy,
  });

  return problems.length > 0 ? { ok: false, problems, notes, config } : { ok: true, problems, notes, config };
}
