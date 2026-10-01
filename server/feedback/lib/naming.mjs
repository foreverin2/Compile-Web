/**
 * 文件名的净化与唯一化（2026-10-01）。
 *
 * 契约原话：`<id>` 用时间戳 + 随机串，**文件名净化**（去掉路径分隔符 / `..`，
 * 只留安全字符，重名自动加序号）。
 *
 * 这里是**两道**防线里的第一道（第二道在 `handler.mjs` 的 /feedback/file：
 * 请求来的 `name` 必须**逐字命中**该 item 清单里已存的名字，不做任何路径拼接推断）。
 */

import { existsSync } from 'node:fs';
import { extname, join } from 'node:path';
import { randomBytes } from 'node:crypto';

/** 投稿 id：`<毫秒时间戳的 36 进制>-<8 字节随机十六进制>`。可排序、可读、不会撞。 */
export function newItemId(nowMs, bytes = 8) {
  return `${nowMs.toString(36)}-${randomBytes(bytes).toString('hex')}`;
}

/**
 * 净化一个上传文件名，得到可以安全落盘的**基名**（绝不含 `/`、`\`、`..`、控制字符）。
 *
 * 步骤（顺序要紧）：
 *  1. 取 basename：Windows 与 POSIX 两种分隔符都切（客户端可能来自任何平台）；
 *  2. 控制字符与空白换成 `_`（空白换成 `_` 而不是删掉，免得 `a b.png` 和 `ab.png` 撞名）；
 *  3. 白名单过滤：只留 `A-Za-z0-9._-` 与中日韩等 `\u0080` 以上的字符（中文文件名不该被吃掉）；
 *  4. 把连续的 `.` 收成一个（`..` 这一步就没了），去掉开头的 `.`（隐藏文件 / `.` / `..`）；
 *  5. 截断到 120 个字符（**保留扩展名**）；
 *  6. 全空 ⇒ 用 `file`。扩展名由调用方另行校验，这里不管。
 */
export function sanitizeFileName(raw, fallback = 'file') {
  const input = String(raw ?? '');
  // ① basename：两种分隔符都切，取最后一段
  const base = input.split(/[\\/]/).pop() ?? '';
  // ② 控制字符 + 空白 -> `_`
  let out = base.replace(/[\u0000-\u001f\u007f\s]+/g, '_');
  // ③ 白名单
  out = out.replace(/[^A-Za-z0-9._\u0080-\uffff-]/g, '_');
  // ④ 收掉连续的点、去掉开头的点
  out = out.replace(/\.{2,}/g, '.');
  out = out.replace(/^[.\-]+/, '');
  // ⑤ 截断（保扩展名）
  if (out.length > 120) {
    const ext = extname(out).slice(0, 16);
    out = out.slice(0, 120 - ext.length) + ext;
  }
  // ⑥ 兜底
  if (out.length === 0) out = fallback;
  return out;
}

/** 取小写扩展名（不含点）；没有扩展名返回空串 */
export function extensionOf(name) {
  const ext = extname(String(name ?? ''));
  return ext.startsWith('.') ? ext.slice(1).toLowerCase() : '';
}

/**
 * 在 `dir` 里给 `desiredName` 找一个不撞的名字：`a.png` -> `a-1.png` -> `a-2.png` …
 *
 * 注意用 `existsSync` 而不是"只查内存里的集合"：附件是**直接落盘**的，
 * 磁盘才是唯一事实，重启后内存集合是空的。
 */
export function uniqueNameIn(dir, desiredName) {
  if (!existsSync(join(dir, desiredName))) return desiredName;
  const ext = extname(desiredName);
  const stem = ext.length > 0 ? desiredName.slice(0, -ext.length) : desiredName;
  for (let i = 1; i < 1000; i += 1) {
    const candidate = `${stem}-${i}${ext}`;
    if (!existsSync(join(dir, candidate))) return candidate;
  }
  // 一千个同名的极端情况：加一段随机串，别再循环了
  return `${stem}-${randomBytes(4).toString('hex')}${ext}`;
}

/**
 * 契约里的 `name` 参数必须命中清单。
 *
 * 为什么只要 `===` 就够：清单里的 `storedAs` 全部来自 `sanitizeFileName`
 * （不含分隔符、不以 `.` 开头），命中之后我们**只用清单里那个字符串**去 join，
 * 请求里的字符串一个字节都不参与路径拼接 ⇒ 路径穿越没有着力点。
 */
export function matchStoredName(files, requested) {
  const want = String(requested ?? '');
  for (const f of files) {
    if (typeof f.storedAs === 'string' && f.storedAs === want) return f;
  }
  return null;
}
