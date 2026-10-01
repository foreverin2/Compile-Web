/**
 * 附件类型映射与文件名头编码（2026-10-01）。
 *
 * 契约的两个点都落在这里：
 *  - "扩展名白名单：png jpg jpeg gif webp pdf txt md log json csv（大小写不敏感），其它一律 415"；
 *  - "/feedback/file ... 图片/pdf 给对 Content-Type"。
 *
 * 白名单与 MIME 表分开写：白名单是**准入**（决定收不收），MIME 表是**回给浏览器的头**
 * （决定怎么看）。两者必须同源，所以这里用同一张表导出。
 */

import { extensionOf } from './naming.mjs';

/** 扩展名 -> Content-Type（白名单的值域 = 这张表的键） */
export const MIME_BY_EXT = Object.freeze({
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  pdf: 'application/pdf',
  txt: 'text/plain; charset=utf-8',
  md: 'text/markdown; charset=utf-8',
  log: 'text/plain; charset=utf-8',
  json: 'application/json; charset=utf-8',
  csv: 'text/csv; charset=utf-8',
});

export const ALLOWED_EXTS = Object.freeze(Object.keys(MIME_BY_EXT));

export function isAllowedExtension(name) {
  return Object.prototype.hasOwnProperty.call(MIME_BY_EXT, extensionOf(name));
}

export function contentTypeFor(name) {
  return MIME_BY_EXT[extensionOf(name)] ?? 'application/octet-stream';
}

/** 契约里那句中文错误，白名单和它一起出现在 415 的响应里 */
export const EXT_HINT = `只收这几种附件：${ALLOWED_EXTS.join(' ')}。`;

/**
 * `Content-Disposition: inline`（契约要求 inline，不是 attachment）。
 *
 * `filename` 用带引号的 ASCII 形态，中文名额外给 `filename*=UTF-8''…`
 * （RFC 5987）。不给 `filename*` 的话中文名在部分浏览器里会变成乱码或直接丢名字。
 */
export function contentDispositionInline(name) {
  const raw = String(name ?? 'file');
  const ascii = raw.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `inline; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(raw)}`;
}
