/**
 * 会话与密码校验（2026-10-01）。
 *
 * 契约：
 *  - `POST /feedback/login`：密码对 ⇒ `Set-Cookie: fb_session=<随机token>; HttpOnly; SameSite=Strict; Path=/feedback; Max-Age=43200`，
 *    返回 `{ok:true}`；不对 ⇒ 401 `{ok:false,error:'密码不对'}`；
 *  - `GET /feedback/list|item|file` 需要有效会话，未带 / 过期一律 401 `{ok:false,error:'未登录'}`；
 *  - 会话在**服务端内存**里维护（token -> 过期时间），重启即失效（契约明确说可接受）。
 *
 * 为什么重启失效可接受：这是单人项目的反馈后台，不是账号体系。
 * 用内存换掉"会话表落盘 / 清理 / 并发写"三件麻烦事，代价只是重启后要重登一次。
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * 定时安全比较（**长度也尽量不泄漏**）。
 *
 * 先各做一次 sha256 再比：sha256 的输出永远 32 字节，
 * 于是"密码长度不同"这件事不会体现在 `timingSafeEqual` 的用时上
 * （直接比原文时长度不同会提前返回）。
 */
export function safeEqual(a, b) {
  const ha = createHash('sha256').update(String(a), 'utf8').digest();
  const hb = createHash('sha256').update(String(b), 'utf8').digest();
  return timingSafeEqual(ha, hb);
}

export class Sessions {
  /**
   * @param {object} opts
   * @param {number} opts.ttlSeconds 会话有效期（契约里 Cookie 的 Max-Age=43200，即 12 小时）
   * @param {number} [opts.max] 内存里最多留多少个会话（超过就先扔最旧的，防内存被刷爆）
   */
  constructor({ ttlSeconds, max = 512 }) {
    this.ttlMs = ttlSeconds * 1000;
    this.max = max;
    /** @type {Map<string, number>} token -> 过期时刻（毫秒） */
    this.byToken = new Map();
  }

  /** 发一个新会话（token 是 32 字节随机数的十六进制，64 字符） */
  issue(nowMs) {
    if (this.byToken.size >= this.max) {
      // Map 保持插入顺序 ⇒ 第一个就是最旧的
      const oldest = this.byToken.keys().next();
      if (!oldest.done) this.byToken.delete(oldest.value);
    }
    const token = randomBytes(32).toString('hex');
    this.byToken.set(token, nowMs + this.ttlMs);
    return token;
  }

  /** 这个 token 还有效吗（顺手删掉过期的） */
  valid(token, nowMs) {
    const t = String(token ?? '');
    if (t.length === 0) return false;
    const expiry = this.byToken.get(t);
    if (expiry === undefined) return false;
    if (expiry <= nowMs) {
      this.byToken.delete(t);
      return false;
    }
    return true;
  }

  /** 主动作废（登出用；契约没要求，但留着不碍事） */
  revoke(token) {
    return this.byToken.delete(String(token ?? ''));
  }

  get size() {
    return this.byToken.size;
  }
}

/**
 * 从 `cookie` 头里取我们要的那个值。
 *
 * 手写解析而不是找库：这里只需要一个名值对，而且 `cookie` 头里出现的
 * 其它 cookie（比如别的工具在同一个域下写的）都不该影响我们。
 */
export function cookieOf(header, name) {
  const raw = String(header ?? '');
  if (raw.length === 0) return null;
  for (const piece of raw.split(';')) {
    const idx = piece.indexOf('=');
    if (idx <= 0) continue;
    if (piece.slice(0, idx).trim() === name) return piece.slice(idx + 1).trim();
  }
  return null;
}

/**
 * 生成契约里逐字写的那条 Set-Cookie。
 *
 * `HttpOnly`（脚本读不到）、`SameSite=Strict`（跨站请求一律不带，CSRF 面直接关掉）、
 * `Path=/feedback`（只在反馈接口下带，不污染站点其它请求）、`Max-Age=43200`（12 小时）。
 * 线上是 http，所以**不加 `Secure`** —— 加了浏览器在 http 下不会存这条 cookie，
 * 后台就直接登不进去了。等站点上了 https 再加。
 */
export function sessionCookie(token, ttlSeconds) {
  return `${COOKIE_NAME}=${token}; HttpOnly; SameSite=Strict; Path=${COOKIE_PATH}; Max-Age=${ttlSeconds}`;
}

export const COOKIE_NAME = 'fb_session';
export const COOKIE_PATH = '/feedback';
