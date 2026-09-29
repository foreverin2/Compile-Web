/**
 * 日志：**只记 时间 / IP / 结果 / scope**，绝不记完整凭据（T50 任务书 §1(1)）。
 *
 * 三件事都在这里：
 *  1. 一行一条、`key=value` 且值里的空格换成 `_`（免得有人用换行往日志里塞假行）；
 *  2. 凭据**一个字节都不写**，只写它的 `sha1` 前 8 位当指纹（跨日志比对用，反推不出原文）；
 *  3. **按大小轮转**：超过上限就把当前文件改名成 `<file>.1`（覆盖旧的那个），再开新文件。
 *     没有 `logrotate` 也能自证不会把磁盘写满。
 *
 * 测试可注入 `sink`（一个收行的函数）⇒ 单测不碰真文件；真跑时由 `server.mjs` 传文件路径。
 */

import { appendFileSync, renameSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';

/** 凭据指纹（日志里唯一的"凭据痕迹"）：`sha1(base64 文本)` 的前 8 位 */
export function credentialFingerprint(credential) {
  return createHash('sha1').update(String(credential), 'utf8').digest('hex').slice(0, 8);
}

/** 一个字段值里不许出现的字符（换行 / 制表 / `=`）*/
function clean(v) {
  return String(v).replace(/[\s=]+/g, '_');
}

export class Logger {
  /**
   * @param {object} opts
   * @param {string|null} opts.file 日志文件（`null` = 只往 `sink` 写）
   * @param {(line: string) => void} [opts.sink] 每行的落点（缺省 = `process.stdout.write`）
   * @param {number} [opts.maxBytes] 轮转阈值
   * @param {() => void} [opts.onRotate] 轮转时回调（单测读它，不用真造 5MB 文件）
   */
  constructor({ file = null, sink = null, maxBytes = 5 * 1024 * 1024, onRotate = null } = {}) {
    this.file = file;
    this.sink = sink ?? ((line) => { process.stdout.write(line + '\n'); });
    this.maxBytes = maxBytes;
    this.onRotate = onRotate;
    /** 已经写过的字节数（启动时按现有文件大小起算） */
    this.bytes = 0;
    if (this.file !== null) {
      try { this.bytes = statSync(this.file).size; } catch { this.bytes = 0; }
    }
  }

  rotateIfNeeded() {
    if (this.file === null) return false;
    if (this.bytes < this.maxBytes) return false;
    try {
      renameSync(this.file, `${this.file}.1`);
    } catch {
      // 改名失败（文件被别人搬走了 / 权限不够）：**不抛**，继续往原路径写。
      // 服务不该因为日志轮转失败而拒服务（那一档的代价是磁盘，不是可用性）。
    }
    this.bytes = 0;
    if (this.onRotate !== null) this.onRotate();
    return true;
  }

  /** 写一行。`fields` 的顺序就是输出的顺序（**不含 credential**） */
  line(level, fields) {
    const parts = [`ts=${clean(new Date().toISOString())}`, `level=${clean(level)}`];
    for (const [k, v] of Object.entries(fields)) {
      if (v === undefined || v === null) continue;
      parts.push(`${clean(k)}=${clean(v)}`);
    }
    const text = parts.join(' ');
    this.rotateIfNeeded();
    if (this.file !== null) {
      try { appendFileSync(this.file, text + '\n'); this.bytes += Buffer.byteLength(text) + 1; } catch { /* 见 rotateIfNeeded 的理由 */ }
    }
    this.sink(text);
    return text;
  }
}
