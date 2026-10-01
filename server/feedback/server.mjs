/**
 * Compile 反馈收集后端（**零依赖**：只用 Node 内置 `http` / `fs` / `crypto` / `path`）。
 *
 * 日期：2026-10-01。用户需求要点：
 *  - 只监听 `127.0.0.1:8790`，由 nginx 同源反代 `/feedback/`（不碰 3080 / 5173 / 8788）；
 *  - 数据落 `/var/lib/compile-feedback/items/<id>/`（meta.json + 附件原件）；
 *  - 密码只在服务器上（`/etc/feedback.env`，权限 600），**仓库里只有占位符**；
 *  - 接口契约由前端那边同时照写，服务端逐字实现，不自行发挥。
 *
 * 跑法：
 *   FEEDBACK_PASSWORD=... node server/feedback/server.mjs
 *   node server/feedback/server.mjs --check       # 只校验配置（缺密码就 exit 2）
 *
 * 装法 / 升级 / 排错见 `server/feedback/RUNBOOK.md`。
 */

import { createServer } from 'node:http';
import { loadConfig } from './lib/config.mjs';
import { Sessions } from './lib/auth.mjs';
import { FileQuota, LoginFailures } from './lib/rate-limit.mjs';
import { Logger } from './lib/log.mjs';
import { Store } from './lib/storage.mjs';
import { handleRequest, readBody } from './lib/handler.mjs';

/** 登录体上限：只要够放一个密码（别让 30MB 的垃圾体白占内存） */
const LOGIN_BODY_CAP = 4096;

/** 小 JSON 接口（read / delete）的体上限：几个字段而已 */
const JSON_BODY_CAP = 8192;

/**
 * 取客户端 IP。
 *
 * `FEEDBACK_TRUST_PROXY=1` 时信 `X-Forwarded-For` 的**最后一跳**
 * —— nginx 把真实客户端地址追加在右边，左边可能是别人自己伪造的。
 * 默认关：直接暴露在公网时不该信任何请求头。
 */
export function clientIpOf(headers, remoteAddress, trustProxy) {
  const norm = (ip) => {
    const s = String(ip ?? '').trim();
    return s.startsWith('::ffff:') ? s.slice('::ffff:'.length) : s;
  };
  if (trustProxy) {
    const xff = headers['x-forwarded-for'];
    if (typeof xff === 'string' && xff.trim().length > 0) {
      const parts = xff.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
      if (parts.length > 0) return norm(parts[parts.length - 1]);
    }
    const real = headers['x-real-ip'];
    if (typeof real === 'string' && real.trim().length > 0) return norm(real.trim());
  }
  return norm(remoteAddress);
}

function main(argv) {
  const check = argv.includes('--check');
  const loaded = loadConfig(process.env);

  for (const n of loaded.notes) process.stderr.write(`[feedback] 注意：${n}\n`);
  if (!loaded.ok) {
    for (const p of loaded.problems) process.stderr.write(`[feedback] 配置有问题：${p}\n`);
    process.stderr.write('[feedback] 拒绝启动（fail fast：宁可不起，也不起一个没有密码的后台）。\n');
    return 2;
  }
  const config = loaded.config;

  if (check) {
    process.stdout.write(
      `[feedback] 配置 OK：${config.bindHost}:${config.port} 数据 ${config.dataDir} `
      + `密码来源=${config.passwordSource} 单文件上限=${config.maxFileBytes} 单次附件上限=${config.maxFilesPerItem} `
      + `每IP每天文件=${config.filesPerIpPerDay} 会话=${config.sessionTtlSeconds}s `
      + `登录失败闸=${config.loginFailMax}/${config.loginFailWindowSeconds}s 信代理=${config.trustProxy} `
      + `请求体上限=${config.bodyBytesCap} 日志=${config.logFile ?? '(stderr)'}\n`,
    );
    return 0;
  }

  const logger = new Logger({ file: config.logFile, maxBytes: config.logMaxBytes });
  const sessions = new Sessions({ ttlSeconds: config.sessionTtlSeconds });
  const store = new Store({
    root: config.dataDir,
    maxFileBytes: config.maxFileBytes,
    log: (msg, extra) => logger.line('warn', { ip: '-', method: '-', path: '-', result: msg, ...extra }),
  });
  const quota = new FileQuota({
    dir: store.rateDir,
    perDay: config.filesPerIpPerDay,
    log: (msg, extra) => logger.line('warn', { ip: '-', method: '-', path: '-', result: msg, ...extra }),
  });
  const loginFails = new LoginFailures({
    max: config.loginFailMax,
    windowMs: config.loginFailWindowSeconds * 1000,
  });

  const server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', 'http://placeholder.invalid');
      const method = req.method ?? 'GET';
      const clientIp = clientIpOf(req.headers, req.socket.remoteAddress ?? '', config.trustProxy);
      const nowMs = Date.now();

      // 读完请求体再交给纯函数（GET 不带体）
      let body = null;
      if (method === 'POST') {
        // 登录体只要够放一个密码；投稿体要大（附件）；read / delete 是几个字段的小 JSON
        const cap = url.pathname === '/feedback/login'
          ? LOGIN_BODY_CAP
          : url.pathname === '/feedback/submit'
            ? config.bodyBytesCap
            : JSON_BODY_CAP;
        const read = await readBody(req, cap);
        if (read.error !== undefined) {
          const status = read.error === 'too-large' ? 413 : 400;
          logger.line('info', { ip: clientIp, method, path: url.pathname, status, result: `reject:${read.error}` });
          // 契约：失败一律 `{ok:false, error:'中文原因'}`；413 那句与 handler 里保持一致
          const payload = status === 413
            ? readBodyTooLargePayload()
            : { ok: false, error: '读请求体失败，请重试。' };
          res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
          res.end(JSON.stringify(payload));
          return;
        }
        body = read.data;
      }

      let out;
      try {
        out = handleRequest({
          method, pathname: url.pathname, query: url.searchParams, headers: req.headers,
          body, clientIp, nowMs, config, sessions, quota, loginFails, store, logger,
        });
      } catch (e) {
        logger.line('error', {
          ip: clientIp, method, path: url.pathname, status: 500, result: 'handler-threw',
          error: String(e && e.message ? e.message : e),
        });
        out = {
          status: 500,
          headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
          body: { ok: false, error: '服务器内部出错，这条请求没有处理成功。' },
        };
      }

      res.writeHead(out.status, out.headers);
      if (Buffer.isBuffer(out.body)) res.end(out.body);
      else if (typeof out.body === 'string') res.end(out.body);
      else res.end(JSON.stringify(out.body));
    })().catch((e) => {
      // 兜底：异步链里最后一道，保证不会留下裸的 unhandled rejection 把进程带下去
      process.stderr.write(`[feedback] 请求处理异常：${String(e && e.stack ? e.stack : e)}\n`);
      try {
        res.writeHead(500, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
        res.end(JSON.stringify({ ok: false, error: '服务器内部出错。' }));
      } catch { /* 头已经发出去了，只能算了 */ }
    });
  });

  server.on('clientError', (_err, socket) => {
    // 半开连接 / 畸形请求：响亮地回一句再关，别让 socket 挂着
    if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nconnection: close\r\n\r\n');
    else socket.destroy();
  });

  server.listen(config.port, config.bindHost, () => {
    logger.line('info', {
      ip: '-', method: '-', path: '-', result: 'listening',
      bind: `${config.bindHost}:${config.port}`,
      dataDir: config.dataDir,
      passwordSource: config.passwordSource,
      filesPerIpPerDay: config.filesPerIpPerDay,
      maxFileBytes: config.maxFileBytes,
      maxFilesPerItem: config.maxFilesPerItem,
      sessionTtlSeconds: config.sessionTtlSeconds,
      trustProxy: config.trustProxy,
    });
    process.stderr.write(`[feedback] 监听 http://${config.bindHost}:${config.port}（数据目录 ${config.dataDir}）\n`);
  });

  // systemd 停止时先把在飞的请求放完（Type=simple + SIGTERM 的默认行为够用，
  // 这里显式处理只是为了让日志里有一条干净的 stopping）
  const stop = (sig) => {
    logger.line('info', { ip: '-', method: '-', path: '-', result: 'stopping', signal: sig });
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on('SIGTERM', () => stop('SIGTERM'));
  process.on('SIGINT', () => stop('SIGINT'));

  return 0;
}

/** 413 的中文原因（与 lib/handler.mjs 里 `tooLarge()` 保持同一句话） */
function readBodyTooLargePayload() {
  return { ok: false, error: '附件太大了：单个文件上限 10MB（超过这个数的请求会在服务端被直接拒掉，不会落盘）。' };
}

const code = main(process.argv.slice(2));
if (code !== 0) process.exit(code);
