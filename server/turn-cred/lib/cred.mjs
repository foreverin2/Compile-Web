/**
 * TURN REST 凭据的**唯一算式**（coturn 的 `use-auth-secret` 那一套）。
 *
 * 规则（RFC 草案 draft-uberti-behave-turn-rest-00；coturn 的 `--use-auth-secret` 实现）：
 *  - `username = <expiryUnixSeconds>:<scope>`
 *  - `credential = base64(HMAC-SHA1(secret, username))`
 *
 * ⚠️ **base64 用标准字母表**（`+` `/`），不是 URL 安全变体：浏览器把 `credential` 原样交给
 * TURN 客户端，coturn 那边按标准 base64 比。本仓的**参考向量**（RFC 2202 那一组）也是标准
 * 字母表 ⇒ 这条口径由独立向量钉住，不靠"我觉得"。
 *
 * 签名输入是 **username 的字节**（UTF-8），不是"expiry 与 scope 拼起来再签两次"。
 */

import { createHmac } from 'node:crypto';

/** 时间戳（Unix 秒）。注入 `now` 是为了让单测能钉住"过期时间就是 now+ttl" */
export function expiryOf(nowMs, ttlSeconds) {
  return Math.floor(nowMs / 1000) + Math.floor(ttlSeconds);
}

/** 用户名：`<expiry>:<scope>`。scope 里**不许**有冒号（否则 coturn 解析出的 expiry 会漂） */
export function usernameOf(expirySeconds, scope) {
  const s = String(scope);
  if (s.length === 0 || s.includes(':')) {
    throw new Error(`scope 不合法（空串或含冒号）：${JSON.stringify(s)}`);
  }
  if (!Number.isInteger(expirySeconds) || expirySeconds <= 0) {
    throw new Error(`expiry 不是正整数秒：${String(expirySeconds)}`);
  }
  return `${String(expirySeconds)}:${s}`;
}

/** `base64(HMAC-SHA1(secret, username))` */
export function credentialOf(secret, username) {
  return createHmac('sha1', secret).update(username, 'utf8').digest('base64');
}

/** 一次签发的全部字段（**不含** ttl —— 那是响应面的事，见 handler） */
export function issueCredential({ secret, scope, ttlSeconds, nowMs }) {
  const expiry = expiryOf(nowMs, ttlSeconds);
  const username = usernameOf(expiry, scope);
  return { username, credential: credentialOf(secret, username), expiry };
}
