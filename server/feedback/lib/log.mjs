/**
 * 日志（照 `server/turn-cred/lib/log.mjs` 的形状，2026-10-01）。
 *
 * 一行一条 JSON：`ts / level / ip / method / path / status / result / 其它字段`。
 * 边界（任务书硬性约束的延伸）：
 *  - 日志里**绝不**写密码、cookie 原文、会话 token；
 *    投稿正文（`body`）也不写（反馈内容可能含个人信息，要看看 `items/<id>/meta.json`）。
 *  - 附件名只写净化后的形态（`storedAs`），不写客户端原始名。
 *  - 用追加写，超过 `maxBytes` 就自己轮转成 `<file>.1`（systemd 那边不需要配 logrotate）。
 */

import { appendFileSync, renameSync, statSync } from 'node:fs';

export class Logger {
  /** @param {{file?: string|null, maxBytes?: number}} opts */
  constructor({ file = null, maxBytes = 5 * 1024 * 1024 } = {}) {
    this.file = file;
    this.maxBytes = maxBytes;
    this.broken = false;
  }

  /** 轮转：只在超过阈值时做一次（每个进程一次 stat，不是每条日志一次） */
  rotateIfNeeded() {
    if (this.file === null || this.broken) return;
    try {
      const st = statSync(this.file);
      if (st.size < this.maxBytes) return;
      renameSync(this.file, `${this.file}.1`);
    } catch { /* 文件还不存在 / 改不动：不折腾 */ }
  }

  line(level, fields) {
    const rec = { ts: new Date().toISOString(), level, ...fields };
    const text = `${JSON.stringify(rec)}\n`;
    if (this.file === null) {
      process.stderr.write(text);
      return;
    }
    try {
      this.rotateIfNeeded();
      appendFileSync(this.file, text, { encoding: 'utf8', mode: 0o640 });
    } catch (e) {
      // 日志写不进去**不能**影响服务本身：退到 stderr，只报一次
      if (!this.broken) {
        this.broken = true;
        process.stderr.write(
          `[feedback] 日志写不进去（${this.file}）：${String(e && e.message ? e.message : e)}，后面一律走 stderr\n`,
        );
      }
      process.stderr.write(text);
    }
  }
}
