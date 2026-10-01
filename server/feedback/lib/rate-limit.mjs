/**
 * 两道按 IP 的闸门（2026-10-01）。
 *
 *  1. `FileQuota`      —— **每个 IP 每天最多 5 份文件**（按文件个数计，不是按投稿份数）。
 *                         这是契约里明写的额度，所以**必须扛得住重启**：
 *                         计数落在 `<数据目录>/rate/files-<YYYY-MM-DD>.json`，
 *                         进程起来时从今天的那个文件恢复。
 *  2. `LoginFailures`  —— **同一 IP 连续失败 >= 5 次 / 10 分钟内一律 429**。
 *                         这个可以只在内存里（重启即清零，可接受，与"会话重启即失效"一致）。
 *
 * 为什么按 IP 而不是按会话：投稿接口**不需要登录**（任何人都能投），
 * 所以限流键只能是 IP；IP 从 nginx 传来的 `X-Forwarded-For` 最后一跳取。
 *
 * 记账文件的写法是"整份重写 + rename"（同目录 rename 是原子的），
 * 半途断电最多丢这一次的增量，不会写出半个 JSON 让下次启动解析失败。
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** 本地日期键 `YYYY-MM-DD`（按服务器时区；额度就是"按天"的运维口径，不用 UTC） */
export function dayKey(nowMs) {
  const d = new Date(nowMs);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export class FileQuota {
  /**
   * @param {object} opts
   * @param {string} opts.dir 记账目录（数据目录下的 `rate/`）
   * @param {number} opts.perDay 每天每个 IP 的额度（文件个数）
   * @param {number} opts.maxBytes 单个记账文件超过它就整份重写（**别让它无限长**）
   * @param {(msg:string,extra?:object)=>void} [opts.log]
   */
  constructor({ dir, perDay, maxBytes = 256 * 1024, log = () => {} }) {
    this.dir = dir;
    this.perDay = perDay;
    this.maxBytes = maxBytes;
    this.log = log;
    /** @type {Map<string, Record<string, number>>} 文件名 -> { ip: 计数 } */
    this.cache = new Map();
    this.lastPruneMs = 0;
    try {
      mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    } catch (e) {
      this.log('rate-dir-create-failed', { error: String(e && e.message ? e.message : e) });
    }
    this.reload(dayKey(Date.now()));
  }

  fileFor(day) {
    return join(this.dir, `files-${day}.json`);
  }

  /** 读一整天份的记账（进程启动时调；读坏了**不抛**，只记一条并当作空表） */
  reload(day) {
    const file = this.fileFor(day);
    if (!existsSync(file)) {
      this.cache.set(day, {});
      return;
    }
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf8'));
      const table = parsed && typeof parsed === 'object' ? parsed : {};
      this.cache.set(day, table);
    } catch (e) {
      this.cache.set(day, {});
      this.log('rate-file-unreadable', { file, error: String(e && e.message ? e.message : e) });
    }
    try {
      this.prune();
    } catch { /* 清理失败不影响服务 */ }
  }

  /** 删掉两天前的记账文件（留着今天的和昨天的，方便对账） */
  prune() {
    const now = Date.now();
    if (now - this.lastPruneMs < 60 * 60 * 1000) return;
    this.lastPruneMs = now;
    const today = dayKey(now);
    const yesterday = dayKey(now - 24 * 60 * 60 * 1000);
    let names = [];
    try {
      names = readdirSync(this.dir);
    } catch {
      return;
    }
    for (const name of names) {
      const m = /^files-(\d{4}-\d{2}-\d{2})\.json$/.exec(name);
      if (!m) continue;
      if (m[1] === today || m[1] === yesterday) continue;
      try {
        unlinkSync(join(this.dir, name));
      } catch { /* 删不掉就算了 */ }
      this.cache.delete(m[1]);
    }
  }

  tableFor(day) {
    let table = this.cache.get(day);
    if (table === undefined) {
      table = {};
      this.cache.set(day, table);
      // 跨天第一次用到：顺手把旧文件清一清
      try {
        this.prune();
      } catch { /* 忽略 */ }
    }
    return table;
  }

  /**
   * 看额度还够不够。**不记账** —— 记账在 `record()`。
   * 这样"上传失败 / 扩展名非法"的请求不会白吃用户的额度。
   */
  check(ip, count, nowMs) {
    const day = dayKey(nowMs);
    const table = this.tableFor(day);
    const used = table[ip] ?? 0;
    if (used + count > this.perDay) {
      return {
        allowed: false,
        used,
        limit: this.perDay,
        message: `今天从你这个网络地址投稿的附件已经到上限了（每天最多 ${this.perDay} 个文件，已用 ${used} 个）。可以去掉附件再交，或者明天再来。`,
      };
    }
    return { allowed: true, used, limit: this.perDay };
  }

  /** 记账（只有**真正落盘成功**的附件才记） */
  record(ip, count, nowMs) {
    const day = dayKey(nowMs);
    const table = this.tableFor(day);
    table[ip] = (table[ip] ?? 0) + count;
    this.flush(day, table);
    return table[ip];
  }

  flush(day, table) {
    const file = this.fileFor(day);
    const text = `${JSON.stringify(table)}\n`;
    const tmp = `${file}.tmp`;
    try {
      writeFileSync(tmp, text, { encoding: 'utf8', mode: 0o600 });
      renameSync(tmp, file);
    } catch (e) {
      this.log('rate-file-write-failed', { file, error: String(e && e.message ? e.message : e) });
    }
  }
}

/** 登录失败计数：内存里滑动窗口，够用（重启清零可接受） */
export class LoginFailures {
  /**
   * @param {object} opts
   * @param {number} opts.max 窗口内最多失败几次（>= 它一律 429）
   * @param {number} opts.windowMs 窗口长度（毫秒）
   */
  constructor({ max, windowMs }) {
    this.max = max;
    this.windowMs = windowMs;
    /** @type {Map<string, number[]>} ip -> 失败时间戳（毫秒） */
    this.hits = new Map();
  }

  /** 清掉窗口外的旧记录，返回窗口内的次数 */
  prune(ip, nowMs) {
    const list = this.hits.get(ip);
    if (list === undefined) return 0;
    const fresh = list.filter((t) => nowMs - t < this.windowMs);
    if (fresh.length === 0) this.hits.delete(ip);
    else this.hits.set(ip, fresh);
    return fresh.length;
  }

  /** 现在还能不能试密码 */
  check(ip, nowMs) {
    const used = this.prune(ip, nowMs);
    if (used >= this.max) {
      return {
        allowed: false,
        used,
        limit: this.max,
        retryAfterSeconds: Math.ceil(this.windowMs / 1000),
        message: `密码连续输错太多次了（${this.windowMs / 60000} 分钟内 ${used} 次），先等一会儿再试。`,
      };
    }
    return { allowed: true, used, limit: this.max };
  }

  /** 记一次失败 */
  record(ip, nowMs) {
    const list = this.hits.get(ip) ?? [];
    list.push(nowMs);
    this.hits.set(ip, list);
    return this.prune(ip, nowMs);
  }

  /** 密码对了就把这个 IP 的记录清掉（免得正常用户被自己前面的手误挡住） */
  clear(ip) {
    this.hits.delete(ip);
  }
}
