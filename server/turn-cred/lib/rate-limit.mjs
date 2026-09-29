/**
 * 限流与封禁（**两道闸，各自可配**；T50 任务书 §1(1)）。
 *
 * ## 口径
 *
 *  - **每分钟次数**（按 IP）：滑动窗口，窗口内已签发的请求数 ≥ 上限 ⇒ 拒（HTTP 429）。
 *    "已签发"= 真的走到签发那一步（`/healthz` 与 404 不计数，否则探测就能把自己打满）；
 *  - **并发有效凭据上限**（按 IP）：这个 IP 此刻**还没过期**的凭据数 ≥ 上限 ⇒ 拒（429）。
 *    它挡的是"每次换一个 scope 刷一堆并行凭据"那种用法 —— 单看每分钟次数挡不住
 *    （限流窗口过了照样能签，而凭据在 TTL 内一直是有效的）。
 *
 * ## 为什么不用"进程内的 Map 就完了"
 *
 * 用得上：本服务是单进程 systemd 单元。但**状态必须能被单测注入**（本仓纪律：
 * 计时/随机一律注入），所以这里把 `nowMs` 当参数收，而不是自己在函数体里读 `Date.now()`。
 * 这样"窗口滑过去了没有""过期的凭据有没有被清掉"都是可断言的行为，不靠 sleep。
 */

import { readFileSync } from 'node:fs';

/** 一次准入判定的结论 */
export class RateLimiter {
  /**
   * @param {object} opts
   * @param {number} opts.perMinute 每个 IP 每分钟允许的签发次数
   * @param {number} opts.concurrent 每个 IP 同时有效的凭据上限
   * @param {number} opts.ttlSeconds 凭据有效期（= 并发窗口长度；与签发响应里的 ttl 同源）
   */
  constructor({ perMinute, concurrent, ttlSeconds }) {
    if (!Number.isInteger(perMinute) || perMinute <= 0) throw new Error('perMinute 必须是正整数');
    if (!Number.isInteger(concurrent) || concurrent <= 0) throw new Error('concurrent 必须是正整数');
    if (!Number.isInteger(ttlSeconds) || ttlSeconds <= 0) throw new Error('ttlSeconds 必须是正整数');
    this.perMinute = perMinute;
    this.concurrent = concurrent;
    this.ttlSeconds = ttlSeconds;
    /** ip → { hits: number[](发出时刻，毫秒), creds: number[](过期时刻，毫秒) } */
    this.state = new Map();
  }

  /** 取（或建）某个 IP 的槽位 */
  #slot(ip) {
    let s = this.state.get(ip);
    if (s === undefined) {
      s = { hits: [], creds: [] };
      this.state.set(ip, s);
    }
    return s;
  }

  /** 把过期的记账清掉（**唯一**清理点：每次判定前调它，读数的语义才稳定） */
  #prune(s, nowMs) {
    const winStart = nowMs - 60_000;
    s.hits = s.hits.filter((t) => t > winStart);
    s.creds = s.creds.filter((t) => t > nowMs);
  }

  /**
   * 准入判定。**不改状态**（`hits` / `creds` 的写入在 `record` 里）——
   * 于是"先判后签"与"签成了才记账"是两件事：4xx / 5xx 不该占额度。
   */
  check(ip, nowMs) {
    const s = this.#slot(ip);
    this.#prune(s, nowMs);
    if (s.hits.length >= this.perMinute) {
      return {
        allowed: false,
        reason: 'rate',
        limit: this.perMinute,
        used: s.hits.length,
        message:
          `这个网络地址一分钟内已经取过 ${s.hits.length} 次中继凭据（上限 ${this.perMinute} 次）。`
          + '这是为了防止有人拿我们的中继服务器白刷流量：等一分钟再试，或用两台设备以外的网络。',
      };
    }
    if (s.creds.length >= this.concurrent) {
      return {
        allowed: false,
        reason: 'concurrent',
        limit: this.concurrent,
        used: s.creds.length,
        message:
          `这个网络地址同时有效的凭据已经有 ${s.creds.length} 份（上限 ${this.concurrent} 份）。`
          + `一份凭据的有效期是 ${this.ttlSeconds} 秒；等旧的过期，或先关掉多余的窗口再试。`,
      };
    }
    return { allowed: true };
  }

  /** 记一次**已经签发**的凭据（`expiryMs` = 其过期时刻） */
  record(ip, nowMs, expiryMs) {
    const s = this.#slot(ip);
    s.hits.push(nowMs);
    s.creds.push(expiryMs);
  }

  /** 只读快照（`/healthz` 与日志用；不进任何玩家可见文案） */
  snapshot(nowMs) {
    const out = [];
    for (const [ip, s] of this.state) {
      this.#prune(s, nowMs);
      out.push({ ip, hitsLastMinute: s.hits.length, liveCredentials: s.creds.length });
    }
    return out;
  }
}

/**
 * 可热加载的 deny 列表（**文件坏了不许让服务起不来**）。
 *
 * 文件格式：每行一个 IP，`#` 之后是注释，空行忽略。**允许** `203.0.113.7` 这种字面 IPv4；
 * 也允许后缀通配 `203.0.113.`（挡整段）—— 这是"以后真要按人封"那一档的最小工具。
 *
 * 读不到 / 坏了 / 是半个 JSON ⇒ **保留上一次成功的清单**并记一条 `problems`
 * （绝不因为一个坏文件把服务打死，也绝不因为坏文件把所有 IP 放行）。
 */
export class DenyList {
  /** @param {string|null} file 路径；`null` = 没有封禁清单（一切放行） */
  constructor(file) {
    this.file = file;
    /** @type {string[]} */
    this.patterns = [];
    /** 上一次读文件的**成功**时间（毫秒）；失败时不更新它 */
    this.loadedAtMs = 0;
    /** 最近一次读文件的问题（字符串数组；空 = 好） */
    this.problems = [];
    this.reloadMs = 5_000;
  }

  /** 读一次文件；`force` = 忽略 5 秒节流（单测与启动时用） */
  refresh(nowMs, force = false) {
    if (this.file === null) {
      this.patterns = [];
      this.problems = [];
      this.loadedAtMs = nowMs;
      return;
    }
    if (!force && nowMs - this.loadedAtMs < this.reloadMs) return;
    try {
      const text = readFileSync(this.file, 'utf8');
      const patterns = text
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l.length > 0 && !l.startsWith('#'))
        .map((l) => l.split('#')[0].trim())
        .filter((l) => l.length > 0);
      this.patterns = patterns;
      this.problems = [];
      this.loadedAtMs = nowMs;
    } catch (e) {
      // 文件刚被删 / 权限不对：**保留旧清单**，只记问题
      this.problems = [`读 deny 文件失败（${this.file}）：${String(e && e.message ? e.message : e)}`];
      this.loadedAtMs = nowMs; // 节流：别每个请求都去摸一次坏文件
    }
  }

  /** 这个 IP 在封禁清单里吗（后缀通配：`203.0.113.` 命整段） */
  has(ip) {
    for (const p of this.patterns) {
      if (p === ip) return true;
      if (p.endsWith('.') && ip.startsWith(p)) return true;
    }
    return false;
  }
}
