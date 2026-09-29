/**
 * 极小的 TURN 凭据签发服务（**零依赖**：只用 Node 内置 `http`）。
 *
 * 跑法：
 *   TURN_CRED_SECRET_FILE=/etc/turn-cred/secret node server/turn-cred/server.mjs
 *   node server/turn-cred/server.mjs --check        # 只校验配置（缺密钥就 exit 2）
 *
 * 边界（T50 任务书 §0/§1）：本进程**只签发凭据**，不碰 coturn、不碰 nginx、不存任何玩家数据。
 * 线上那台 coturn 由协调侧改配置；本文件里**没有**任何 ssh / 远程调用。
 */

import { createServer } from 'node:http';
import { loadConfig } from './lib/config.mjs';
import { DenyList, RateLimiter } from './lib/rate-limit.mjs';
import { Logger } from './lib/log.mjs';
import { clientIpOf, handleRequest } from './lib/handler.mjs';

/** 读一次请求体（本服务不解析 body，但**必须**把流排空，否则 keep-alive 会卡住） */
function drain(res, req) {
  req.resume();
  req.on('end', () => { res.end(); });
}

function main(argv) {
  const check = argv.includes('--check');
  const loaded = loadConfig(process.env);

  for (const n of loaded.notes) process.stderr.write(`[turn-cred] 注意：${n}\n`);
  if (!loaded.ok) {
    for (const p of loaded.problems) process.stderr.write(`[turn-cred] 配置有问题：${p}\n`);
    process.stderr.write('[turn-cred] 拒绝启动（fail fast：宁可不起，也不发一批 coturn 必然拒签的凭据）。\n');
    return 2;
  }
  const config = loaded.config;
  if (check) {
    process.stdout.write(`[turn-cred] 配置 OK：realm=${config.realm} urls=${config.urls.join(',')} `
      + `ttl=${config.ttlSeconds}(max ${config.ttlMaxSeconds}) 限流=${config.perIpPerMinute}/分钟、并发 ${config.perIpConcurrent} `
      + `密钥来源=${config.secretSource} deny=${config.denyFile ?? '(无)'} 日志=${config.logFile ?? '(stdout)'}\n`);
    return 0;
  }

  const logger = new Logger({ file: config.logFile, maxBytes: config.logMaxBytes });
  const limiter = new RateLimiter({
    perMinute: config.perIpPerMinute,
    concurrent: config.perIpConcurrent,
    ttlSeconds: config.ttlSeconds,
  });
  const deny = new DenyList(config.denyFile);
  deny.refresh(Date.now(), true);
  for (const p of deny.problems) process.stderr.write(`[turn-cred] 注意：${p}\n`);

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://placeholder.invalid');
    const clientIp = clientIpOf(req.headers, req.socket.remoteAddress ?? '', config.trustProxy);
    const out = handleRequest({
      method: req.method ?? 'GET',
      pathname: url.pathname,
      query: url.searchParams,
      clientIp,
      nowMs: Date.now(),
      config,
      limiter,
      deny,
      logger,
    });
    res.writeHead(out.status, out.headers);
    if (req.method === 'HEAD') { res.end(); return; }
    if (typeof out.body === 'string') { res.end(out.body); return; }
    res.end(JSON.stringify(out.body));
  });

  server.on('clientError', (_err, socket) => {
    // 半开连接 / 畸形请求：**响亮地**回一句再关，别让 socket 挂着
    if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nconnection: close\r\n\r\n');
    else socket.destroy();
  });

  server.listen(config.port, config.bindHost, () => {
    logger.line('info', {
      ip: '-', method: '-', result: 'listening', scope: null,
      bind: `${config.bindHost}:${config.port}`, realm: config.realm,
      urls: config.urls.join('|'), ttl: config.ttlSeconds,
      limitPerMinute: config.perIpPerMinute, limitConcurrent: config.perIpConcurrent,
      secretSource: config.secretSource, deny: config.denyFile ?? '-', log: config.logFile ?? 'stdout',
    });
    process.stderr.write(`[turn-cred] 监听 http://${config.bindHost}:${config.port}（realm=${config.realm}）\n`);
  });
  return 0;
}

const code = main(process.argv.slice(2));
if (code !== 0) process.exit(code);
