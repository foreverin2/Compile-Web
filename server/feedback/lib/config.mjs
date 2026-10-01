/**
 * Compile 反馈收集服务 —— 配置读取（**唯一出处**）。
 *
 * 日期：2026-10-01。用户需求要点（本文件与整个 `server/feedback/` 都照这几条写）：
 *  1. 零依赖：只用 Node 内置模块（http / fs / crypto / path），不 npm install。
 *  2. 只监听 127.0.0.1:8790，由 nginx 同源反代 `/feedback/`，不需要 CORS。
 *  3. **密码只放服务器配置**（`/etc/feedback.env`，权限 600），仓库里只许出现占位符。
 *  4. 数据落在 `/var/lib/compile-feedback/`，只有服务用户可写。
 *  5. 接口契约逐字固定（submit / login / list / item / file / read / delete），前端由另一个 agent
 *     同时写，本服务**不许**自行改契约。
 *  6. **限额口径（2026-10-01 当天改过）**：每 IP 每天最多 **5 次成功投稿**（按份数计，
 *     一次提交带 0/1/5 个附件都只占 1 份）；每次提交内部"附件最多 5 个"是另一条独立的判据。
 *
 * 纪律照 `server/turn-cred/lib/config.mjs`：读不到密码就**拒绝启动**（fail fast）。
 * 宁可服务不起，也不要起一个"谁都能登进来看别人投稿"的服务。
 */

import { readFileSync } from 'node:fs';

/** 数字环境变量：读不到 / 不是正整数 ⇒ 用缺省值（并记进 `notes`，不静默） */
function envInt(env, name, fallback) {
  const raw = env[name];
  if (raw === undefined || String(raw).trim() === '') return { value: fallback, note: null };
  const n = Number(String(raw).trim());
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
    return { value: fallback, note: `${name}=${String(raw)} 不是正整数，按缺省 ${fallback} 用` };
  }
  return { value: n, note: null };
}

/** 非空字符串环境变量，缺省给 fallback */
function envStr(env, name, fallback) {
  const raw = env[name];
  return typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : fallback;
}

/** 布尔环境变量：只认 `1` / `true` */
function envBool(env, name) {
  const raw = env[name];
  return raw === '1' || raw === 'true';
}

/**
 * 读密码：**只**从 `FEEDBACK_PASSWORD_FILE`（优先，指向只 root 能读的文件）
 * 或 `FEEDBACK_PASSWORD`（环境变量，由 `/etc/feedback.env` 提供）读。
 *
 * 部署形态是后者（`/etc/feedback.env` 权限 600）；前者留给"密码放独立文件"的场景。
 */
export function readPassword(env = process.env) {
  const file = env.FEEDBACK_PASSWORD_FILE;
  if (typeof file === 'string' && file.trim().length > 0) {
    try {
      const text = readFileSync(file.trim(), 'utf8').trim();
      return { password: text, source: `file:${file.trim()}` };
    } catch (e) {
      return { password: '', source: `file:${file.trim()}`, error: String(e && e.message ? e.message : e) };
    }
  }
  const inline = env.FEEDBACK_PASSWORD;
  if (typeof inline === 'string' && inline.length > 0) {
    return { password: inline, source: 'env:FEEDBACK_PASSWORD' };
  }
  return { password: '', source: 'none' };
}

export const DEFAULTS = Object.freeze({
  bindHost: '127.0.0.1',
  port: 8790,
  dataDir: '/var/lib/compile-feedback',
  maxFilesPerItem: 5,
  maxFileBytes: 10 * 1024 * 1024,
  /** 每 IP 每天的**提交份数**上限（2026-10-01 改口径：原先字段叫 filesPerIpPerDay，按文件个数） */
  submitsPerIpPerDay: 5,
  sessionTtlSeconds: 12 * 60 * 60,
  loginFailMax: 5,
  loginFailWindowSeconds: 10 * 60,
  titleMax: 80,
  authorMax: 40,
  bodyMax: 5000,
});

/** 允许的附件扩展名（小写）。契约里是 `png jpg jpeg gif webp pdf txt md log json csv`。 */
export const ALLOWED_EXTENSIONS = Object.freeze([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'pdf', 'txt', 'md', 'log', 'json', 'csv',
]);

/**
 * 把环境变量读成一份**冻结的**配置。
 *
 * 返回 `{ ok, problems, notes, config }` —— **不抛**：`server.mjs --check` 与单测
 * 都要能逐条读到"哪里不对"，而不是只拿到一个异常串。
 */
export function loadConfig(env = process.env) {
  const problems = [];
  const notes = [];

  const { password, source, error } = readPassword(env);
  if (error !== undefined) problems.push(`读密码文件失败（${source}）：${error}`);
  if (password.length === 0) {
    problems.push(
      '没有密码：请设 FEEDBACK_PASSWORD（部署形态是 /etc/feedback.env，权限 600）或 FEEDBACK_PASSWORD_FILE。'
      + '缺密码时本服务拒绝启动（否则任何人都能登进后台看投稿）。',
    );
  }

  const port = envInt(env, 'FEEDBACK_PORT', DEFAULTS.port);
  const maxFiles = envInt(env, 'FEEDBACK_MAX_FILES', DEFAULTS.maxFilesPerItem);
  const maxFileBytes = envInt(env, 'FEEDBACK_MAX_FILE_BYTES', DEFAULTS.maxFileBytes);
  /**
   * 每 IP 每天的**提交份数**额度（2026-10-01 当天改口径：原先是"文件个数"）。
   *
   * 环境变量名沿用 `FEEDBACK_FILES_PER_IP_PER_DAY`（线上 /etc/feedback.env 里就是它），
   * 但**配置字段**叫 `submitsPerIpPerDay` —— 单位变了，字段名必须跟着变，
   * 否则下一个读代码的人一定会按"文件数"理解。新名字 `FEEDBACK_SUBMITS_PER_IP_PER_DAY` 也认
   * （两个都设时以新名字为准）。
   */
  const submitsPerDay = envInt(
    env,
    'FEEDBACK_SUBMITS_PER_IP_PER_DAY',
    envInt(env, 'FEEDBACK_FILES_PER_IP_PER_DAY', DEFAULTS.submitsPerIpPerDay).value,
  );
  const sessionTtl = envInt(env, 'FEEDBACK_SESSION_TTL', DEFAULTS.sessionTtlSeconds);
  const loginFailMax = envInt(env, 'FEEDBACK_LOGIN_FAIL_MAX', DEFAULTS.loginFailMax);
  const loginFailWindow = envInt(env, 'FEEDBACK_LOGIN_FAIL_WINDOW', DEFAULTS.loginFailWindowSeconds);
  const bodyBytesCap = envInt(env, 'FEEDBACK_BODY_BYTES_CAP', maxFiles.value * maxFileBytes.value + 1024 * 1024);
  const logMaxBytes = envInt(env, 'FEEDBACK_LOG_MAX_BYTES', 5 * 1024 * 1024);
  for (const r of [port, maxFiles, maxFileBytes, submitsPerDay, sessionTtl, loginFailMax, loginFailWindow, bodyBytesCap, logMaxBytes]) {
    if (r.note !== null) notes.push(r.note);
  }
  if (bodyBytesCap.value < maxFileBytes.value) {
    notes.push(`FEEDBACK_BODY_BYTES_CAP(${bodyBytesCap.value}) 比单个文件上限(${maxFileBytes.value}) 还小，`
      + '超过这个字节数的请求会在服务端被直接判 413');
  }

  const config = Object.freeze({
    password,
    passwordSource: source,
    bindHost: envStr(env, 'FEEDBACK_HOST', DEFAULTS.bindHost),
    port: port.value,
    dataDir: envStr(env, 'FEEDBACK_DATA_DIR', DEFAULTS.dataDir),
    maxFilesPerItem: maxFiles.value,
    maxFileBytes: maxFileBytes.value,
    /** 每 IP 每天的**提交份数**上限（不是文件个数；见 `rate-limit.mjs` 头注） */
    submitsPerIpPerDay: submitsPerDay.value,
    sessionTtlSeconds: sessionTtl.value,
    loginFailMax: loginFailMax.value,
    loginFailWindowSeconds: loginFailWindow.value,
    titleMax: DEFAULTS.titleMax,
    authorMax: DEFAULTS.authorMax,
    bodyMax: DEFAULTS.bodyMax,
    bodyBytesCap: bodyBytesCap.value,
    /**
     * ★ 取客户端 IP 时信不信 `X-Forwarded-For`。
     * 走 nginx 时必须开（否则所有投稿人被算成同一个 127.0.0.1，按 IP 的每日额度
     * 一开局就被吃光）；直接暴露在公网时**不要**开。
     */
    trustProxy: envBool(env, 'FEEDBACK_TRUST_PROXY'),
    logFile: envStr(env, 'FEEDBACK_LOG_FILE', null),
    logMaxBytes: logMaxBytes.value,
    /** 会话 Cookie 名与 Path（契约里逐字固定） */
    cookieName: 'fb_session',
    cookiePath: '/feedback',
  });

  return problems.length > 0 ? { ok: false, problems, notes, config } : { ok: true, problems, notes, config };
}
