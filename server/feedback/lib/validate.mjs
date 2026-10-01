/**
 * 投稿字段校验（2026-10-01）。单独一个文件，因为**数字口径**要与契约逐条对上：
 *
 *   契约原话：
 *     `kind` 必须是 `protocol` | `bug`；
 *     `title` 去空白后 1..80 字；
 *     `author` 1..40 字；
 *     `body` 1..5000 字；
 *     每个文件 <=10MB；
 *     每个 IP 每天最多 5 份文件；
 *     扩展名白名单 png jpg jpeg gif webp pdf txt md log json csv（大小写不敏感）。
 *
 * 这里只做**字段**那一半（个数 / 大小 / 额度 / 扩展名在 `handler.mjs` 里，
 * 因为那几项要按 part 走一遍才能判）。返回 `{ok:false, status, code, error}`，
 * `error` 就是回给前端的那句中文。
 *
 * 为什么 `title` / `author` 要"去空白后"再数字数：否则有人交一个 80 个空格的标题，
 * 后台列表里就是一排空白行。
 */

/**
 * @param {Record<string,string>} fields multipart 里的文本字段
 * @param {number} fileCount 附件个数（用来把"没有正文也没有附件"这种空投稿挡住）
 * @param {object} config `loadConfig()` 的 config
 */
export function validateSubmission(fields, fileCount, config) {
  const kind = String(fields.kind ?? '').trim();
  if (kind !== 'protocol' && kind !== 'bug') {
    return {
      ok: false,
      status: 400,
      code: 'bad-kind',
      error: "kind 必须是 protocol 或 bug 这两个之一（投稿类型不对）。",
    };
  }

  const title = String(fields.title ?? '').trim();
  if (title.length < 1 || title.length > config.titleMax) {
    return {
      ok: false,
      status: 400,
      code: 'bad-title',
      error: `标题去掉首尾空白后要在 1 到 ${config.titleMax} 个字之间（现在 ${title.length} 个字）。`,
    };
  }

  const author = String(fields.author ?? '').trim();
  if (author.length < 1 || author.length > config.authorMax) {
    return {
      ok: false,
      status: 400,
      code: 'bad-author',
      error: `昵称要去掉首尾空白后 1 到 ${config.authorMax} 个字（现在 ${author.length} 个字）。`,
    };
  }

  // 正文：契约是 1..5000，**空正文一律 400**（不做"只有附件也行"的自我放宽：
  // 契约是另一个 agent 同时照它写前端的，服务端这边一个字都不许自行改）。
  const body = String(fields.body ?? '').trim();
  if (body.length < 1 || body.length > config.bodyMax) {
    return {
      ok: false,
      status: 400,
      code: 'bad-body',
      error: `正文去掉首尾空白后要在 1 到 ${config.bodyMax} 个字之间（现在 ${body.length} 个字）。太长的话把日志存成附件再投。`,
    };
  }

  // `fileCount` 现在用不到（正文必须非空，就不存在"空投稿"这条支路），
  // 但函数签名留着它：额度那条判据也是按附件个数算的，将来改口径时不用改签名。
  void fileCount;
  return { ok: true, kind, title, author, body };
}

export const KIND_VALUES = Object.freeze(['protocol', 'bug']);
