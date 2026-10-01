/**
 * multipart/form-data 解析（2026-10-01，零依赖）。
 *
 * 为什么自己写：契约要求 `POST /feedback/submit` 收 `multipart/form-data`，
 * 而本项目**不许 npm install**（任务书硬性约束）；Node 内置模块里没有 multipart 解析。
 *
 * 实现取舍：**整个请求体先在内存里拼完再解析**。
 *  - 上限由调用方卡死（`config.bodyBytesCap`，缺省 = 5 个 10MB 文件 + 1MB 余量）。
 *    本服务是单人项目的反馈箱，并发投稿数是个位数，几十 MB 的内存峰值可以接受；
 *  - 换来的是**一段能读懂、能断言**的解析代码：不用处理流式状态机那种边界状态。
 *    真要做流式，等有了真实并发再改。
 *
 * 本文件只做解析，**不写盘**（写盘在 `storage.mjs`，校验在 `handler.mjs`）。
 */

/** 一个 part 的形状 */
export function part({ name, filename, contentType, data }) {
  return { name, filename: filename ?? null, contentType: contentType ?? '', data };
}

/**
 * 从 `content-type` 头里取 boundary。取不到返回 `null`（调用方判 400）。
 */
export function boundaryOf(contentType) {
  const s = String(contentType ?? '');
  if (!/^multipart\/form-data/i.test(s.trim())) return null;
  // boundary 在引号里（浏览器都会带引号），也兼容不带引号的写法
  const quoted = /boundary="([^"]+)"/i.exec(s);
  if (quoted !== null) return quoted[1];
  const bare = /boundary=([^;,\s]+)/i.exec(s);
  return bare === null ? null : bare[1];
}

/** 取 part 头里的某个字段（头名大小写不敏感） */
function headerValue(headers, name) {
  const lower = name.toLowerCase();
  for (const [k, v] of headers) {
    if (k.toLowerCase() === lower) return v;
  }
  return null;
}

/**
 * 解析 multipart 体。
 *
 * @param {Buffer} buf 整个请求体
 * @param {string} boundary 分隔串（不含前导 `--`）
 * @returns {{ parts: Array<{name:string,filename:string|null,contentType:string,data:Buffer}> }}
 */
export function parseMultipart(buf, boundary) {
  const delim = Buffer.from(`--${boundary}`);
  const parts = [];
  let pos = buf.indexOf(delim);
  if (pos < 0) return { parts };

  while (pos >= 0) {
    let p = pos + delim.length;

    // 收尾：`--<boundary>--`
    if (buf.length >= p + 2 && buf[p] === 0x2d && buf[p + 1] === 0x2d) break;

    // 分隔行后面应当是一个 CRLF（容忍个别客户端只发 LF）
    if (buf.length >= p + 2 && buf[p] === 0x0d && buf[p + 1] === 0x0a) p += 2;
    else if (buf.length >= p + 1 && buf[p] === 0x0a) p += 1;

    // part 头：到空行为止
    const headEnd = buf.indexOf('\r\n\r\n', p);
    if (headEnd < 0) break;
    const headText = buf.slice(p, headEnd).toString('utf8');
    const headers = [];
    for (const line of headText.split('\r\n')) {
      const idx = line.indexOf(':');
      if (idx <= 0) continue;
      headers.push([line.slice(0, idx).trim(), line.slice(idx + 1).trim()]);
    }

    const next = buf.indexOf(delim, headEnd + 4);
    const bodyEnd = next < 0 ? buf.length : next;
    let dataEnd = bodyEnd;
    if (dataEnd >= 2 && buf[dataEnd - 2] === 0x0d && buf[dataEnd - 1] === 0x0a) dataEnd -= 2;
    else if (dataEnd >= 1 && buf[dataEnd - 1] === 0x0a) dataEnd -= 1;

    const disposition = headerValue(headers, 'content-disposition') ?? '';
    const nameMatch = /name="([^"]*)"/i.exec(disposition);
    const fileMatch = /filename="([^"]*)"/i.exec(disposition);
    parts.push(part({
      name: nameMatch === null ? '' : nameMatch[1],
      // 浏览器在"没选文件"时会发 filename=""（空串）⇒ 规范成 null，免得被当成一个 0 字节附件
      filename: fileMatch !== null && fileMatch[1].length > 0 ? fileMatch[1] : null,
      contentType: headerValue(headers, 'content-type') ?? '',
      data: buf.slice(headEnd + 4, dataEnd),
    }));

    if (next < 0) break;
    pos = next;
  }
  return { parts };
}
