/**
 * 两道按 IP 的闸门（2026-10-01；当天晚些时候按用户新口径改过一次，见下）。
 *
 *  1. `SubmitQuota`    —— **每个 IP 每天最多提交 5 份反馈**（按**提交次数**计）。
 *                         ★ 2026-10-01 改口径：原先是"每天最多 5 个文件"（按附件个数计），
 *                         现在**一次提交无论带 0 / 1 / 5 个附件都只占 1 个额度**；
 *                         第 6 次 429。每次提交内部"附件最多 5 个"的上限**没变**（那是另一条判据，在 handler 里）。
 *                         额度必须扛得住重启 ⇒ 计数落在
 *                         `<数据目录>/rate/submits-<YYYY-MM-DD>.json`，进程起来时从今天的那个文件恢复。
 *  2. `LoginFailures`  —— **同一 IP 连续失败 >= 5 次 / 10 分钟内一律 429**。
 *                         这个可以只在内存里（重启即清零，可接受，与"会话重启即失效"一致）。
 *
 * ★ 旧文件怎么办：改口径前的文件叫 `files-<日期>.json`，里面记的是**文件个数**。
 *   "文件个数"和"提交份数"不是一回事（一次带 5 个附件 ⇒ 旧文件记 5、新口径只算 1），
 *   两者**不能安全换算** ⇒ 本模块**不读旧文件**（无视它），文件名换成 `submits-<日期>.json`
 *   从零开始记。于是升级当天，凡是改口径前已经投过的 IP 会**重新拿到 5 份额度**
 *   —— 这是刻意的取舍：宁可多放几份，也不要把旧数据误读成"份数"把正常用户挡在外面。
 *   旧的 `files-*.json` 不会被自动删除（留着对账），要清就按 RUNBOOK §6 的命令手工删。
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

/** 当前口径的记账文件名前缀（旧口径是 `files-`，两者**不通用**） */
export const QUOTA_FILE_PREFIX = 'submits-';
/** 2026-10-01 改口径之前用的前缀；只用来数"有几个旧文件没清"，内容一律不读 */
export const LEGACY_QUOTA_FILE_PREFIX = 'files-';

/**
 * 每个 IP 每天的**提交份数**额度。
 *
 * 名字从 `FileQuota` 改过来（2026-10-01）：单位变了，名字跟着变，
 * 免得以后有人照着旧名字理解成"文件数"。`FileQuota` 这个名字仍作为别名导出，
 * 只为不让外部引用一下子炸掉（本仓没有别的消费方，RUNBOOK 里也没写这个名字）。
 */
export class SubmitQuota {
  /**
   * @param {object} opts
   * @param {string} opts.dir 记账目录（数据目录下的 `rate/`）
   * @param {number} opts.perDay 每天每个 IP 的额度（**提交份数**）
   * @param {(msg:string,extra?:object)=>void} [opts.log]
   */
  constructor({ dir, perDay, log = () => {} }) {
    this.dir = dir;
    this.perDay = perDay;
    this.log = log;
    /** @type {Map<string, Record<string, number>>} 日期键 -> { ip: 已提交份数 } */
    this.cache = new Map();
    this.lastPruneMs = 0;
    try {
      mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    } catch (e) {
      this.log('rate-dir-create-failed', { error: String(e && e.message ? e.message : e) });
    }
    this.reload(dayKey(Date.now()));
  }

  /** 某个日期键对应的记账文件（单位是**份**） */
  fileFor(day) {
    return join(this.dir, `${QUOTA_FILE_PREFIX}${day}.json`);
  }

  /** 旧口径（`files-<日期>.json`）还剩几个没清 —— 只数不读，给 `/feedback/healthz` 与运维看 */
  legacyFiles() {
    try {
      return readdirSync(this.dir).filter((n) => n.startsWith(LEGACY_QUOTA_FILE_PREFIX) && n.endsWith('.json'));
    } catch {
      return [];
    }
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
      // 只清**当前口径**的记账文件（`submits-`）；旧口径的 `files-` 一律不动，
      // 留着让人自己看要不要删（RUNBOOK §6 有命令）—— 自动删别人的对账数据是坏习惯。
      const m = /^submits-(\d{4}-\d{2}-\d{2})\.json$/.exec(name);
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
   * 今天这个 IP 还能不能再交一份。**不记账** —— 记账在 `record()`。
   *
   * 额度单位是**份**：调用方不再传"这一份带几个附件"（改口径前要传，因为那时按文件个数计）。
   * 这样"上传失败 / 扩展名非法 / 附件超 5 个"的请求都不会白吃用户的额度。
   */
  check(ip, nowMs) {
    const day = dayKey(nowMs);
    const table = this.tableFor(day);
    const used = table[ip] ?? 0;
    if (used + 1 > this.perDay) {
      return {
        allowed: false,
        used,
        limit: this.perDay,
        message: `今天从你这个网络地址已经提交过 ${this.perDay} 份反馈了（每天最多 ${this.perDay} 份），请明天再来。`,
      };
    }
    return { allowed: true, used, limit: this.perDay };
  }

  /** 记账：**一次成功的投稿记 1 份**（带几个附件都一样；只有真正落盘成功才记） */
  record(ip, nowMs) {
    const day = dayKey(nowMs);
    const table = this.tableFor(day);
    table[ip] = (table[ip] ?? 0) + 1;
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

/**
 * 旧名字的别名（2026-10-01 改口径时改的名）。
 * 单位从"文件个数"变成"提交份数"，`check()` / `record()` 的签名也跟着少了 `count` 参数
 * —— 谁要是还按旧签名调用，会**立刻**看出不对（多传的参数被忽略 ⇒ 语义静默错），
 * 所以保留别名只为"引用不炸"，不承诺行为兼容。
 */
export const FileQuota = SubmitQuota;
