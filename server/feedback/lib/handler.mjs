/**
 * 请求处理（2026-10-01）。**一个纯函数**：不碰 socket、不读 `Date.now()`（都从参数注入），
 * 照 `server/turn-cred/lib/handler.mjs` 的既成做法 —— 能注入的都注入，判定才可断言。
 *
 * ## 路由（契约逐字实现，不许自行改动）
 *
 *   POST /feedback/submit   multipart/form-data：kind / title / author / body + files(0..5)
 *   POST /feedback/login    JSON 或表单：password
 *   GET  /feedback/list     需会话，返回 items + unread + total
 *   GET  /feedback/item     需会话，?id=
 *   GET  /feedback/file     需会话，?id=&name=
 *   POST /feedback/read     需会话，JSON { id, read } —— 标记已读 / 标回未读
 *   POST /feedback/delete   需会话，JSON { id } —— 软删除（目录移到 trash/）
 *   GET  /feedback/healthz  本地监控用（nginx 只放 127.0.0.1）
 *
 * 限额口径（2026-10-01 当天改过一次）：
 *   **每 IP 每天最多 5 次成功的投稿**（按提交份数计，一次提交带 0/1/5 个附件都只占 1 份），
 *   第 6 次 429；每次提交内部"附件最多 5 个"是另一条独立上限（超了 400），不受这次改动影响。
 *
 * `/feedback/read` 与 `/feedback/delete` 是 2026-10-01 用户口头追加的需求
 * （隐藏页要能"标记已读 / 删除"），由协调侧转达，与前端同一套口径。
 *
 * ## 状态码口径
 *
 *   200 成功 / 400 校验不过或参数缺失 / 401 未登录或密码不对 / 404 找不到
 *   405 方法不对 / 413 文件太大 / 415 扩展名不在白名单 / 429 限流 / 500 服务端出错
 *
 * 所有响应带 `Cache-Control: no-store`（契约要求）。同源，不需要 CORS。
 */

import { readFileSync, statSync } from 'node:fs';
import {
  COOKIE_NAME, cookieOf, safeEqual, sessionCookie,
} from './auth.mjs';
import { validateSubmission } from './validate.mjs';
import { boundaryOf, parseMultipart } from './multipart.mjs';
import { newItemId, sanitizeFileName } from './naming.mjs';
// `isValidId` 与落盘那层共用同一份判定（id 的形状就是路径安全的第一道闸）
import { isValidId } from './storage.mjs';
import {
  EXT_HINT, contentDispositionInline, contentTypeFor, isAllowedExtension,
} from './mime.mjs';

/** 统一构造 JSON 响应：**一律** no-store（契约要求所有响应都带） */
function json(status, body, extraHeaders = {}) {
  return {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...extraHeaders,
    },
    body,
  };
}

/** 失败响应：契约里失败一律是 `{ok:false, error:'中文原因'}` */
function fail(status, error, extraHeaders = {}) {
  return json(status, { ok: false, error }, extraHeaders);
}

/**
 * 把请求体读全（上限 `cap` 字节）。
 *
 * 为什么先看 `content-length`：附件契约是"每个 ≤10MB"，一个 200MB 的客户端
 * 要是在收到 413 之前把 200MB 全发过来，白占带宽。`content-length` 超了就直接拒。
 * 没有 `content-length`（chunked）时靠边读边数兜底。
 */
export function readBody(req, cap) {
  return new Promise((resolve) => {
    const declared = Number(req.headers['content-length'] ?? NaN);
    if (Number.isFinite(declared) && declared > cap) {
      resolve({ error: 'too-large', message: `请求体太大了（${declared} 字节，上限 ${cap} 字节）。` });
      req.resume();
      return;
    }
    const chunks = [];
    let size = 0;
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    req.on('data', (c) => {
      if (settled) return;
      size += c.length;
      if (size > cap) {
        done({ error: 'too-large', message: `请求体太大了（超过 ${cap} 字节）。` });
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => done({ data: Buffer.concat(chunks) }));
    req.on('error', (e) => done({ error: 'read-failed', message: String(e && e.message ? e.message : e) }));
  });
}

/** 解析 `{password}`：JSON 与表单两种都认（契约说"JSON 或表单均可"） */
function passwordFrom(contentType, text) {
  const ct = String(contentType ?? '').toLowerCase();
  if (ct.includes('application/json')) {
    try {
      const parsed = JSON.parse(text.length === 0 ? '{}' : text);
      if (parsed !== null && typeof parsed === 'object' && typeof parsed.password === 'string') {
        return { password: parsed.password };
      }
      return { error: '请求体里没有 password 字段。' };
    } catch {
      return { error: '请求体不是合法 JSON。' };
    }
  }
  // 表单（application/x-www-form-urlencoded）与"没有 content-type"都走这条
  const params = new URLSearchParams(text);
  return { password: params.get('password') ?? '' };
}

/**
 * 解析 JSON 请求体（`/feedback/read` 与 `/feedback/delete` 用）。
 *
 * 只认普通对象：JSON 里写 `[]` / `"x"` / `null` 都当"没有这个字段"处理，
 * 免得后面 `parsed.id` 在字符串上取属性取出一堆看不懂的行为。
 */
function jsonObjectFrom(text) {
  try {
    const parsed = JSON.parse(text.length === 0 ? '{}' : text);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return { error: '请求体必须是一个 JSON 对象。' };
    return { value: parsed };
  } catch {
    return { error: '请求体不是合法 JSON。' };
  }
}

/**
 * `id` 里带路径分隔符 / `..` ⇒ 400（契约对 delete 明写的一条，read 一并用同一套口径）。
 *
 * 为什么要在 `isValidId` 之前单独判一句：两者都拦得住，
 * 但契约要求这种输入的回答是 **400**（"你传的东西不合法"），而不是 404（"没找到"）。
 */
const PATH_TRAVERSAL_RE = /[\\/]|\.\./;

function idRejection(id) {
  if (PATH_TRAVERSAL_RE.test(id)) return 'id 里不能有路径分隔符或 ..';
  if (!isValidId(id)) return 'id 的形状不对。';
  return null;
}

/**
 * 处理一次请求。
 *
 * @param {object} req
 * @param {string} req.method HTTP 方法
 * @param {string} req.pathname 路径（不含查询串），形如 `/feedback/list`
 * @param {URLSearchParams} req.query
 * @param {object} req.headers 原始请求头
 * @param {Buffer|null} req.body 已读全的请求体（GET 为 null）
 * @param {string} req.clientIp
 * @param {number} req.nowMs
 * @param {object} req.config `loadConfig()` 的 `config`
 * @param {import('./auth.mjs').Sessions} req.sessions
 * @param {import('./rate-limit.mjs').FileQuota} req.quota
 * @param {import('./rate-limit.mjs').LoginFailures} req.loginFails
 * @param {import('./storage.mjs').Store} req.store
 * @param {import('./log.mjs').Logger} req.logger
 */
export function handleRequest(req) {
  const {
    method, pathname, query, headers, body, clientIp, nowMs, config, sessions, quota, loginFails, store, logger,
  } = req;
  const base = { ip: clientIp, method, path: pathname };

  if (method === 'HEAD') {
    // 契约里没有 HEAD 的路由；统一按"方法不对"处理，免得 HEAD 变成绕过限流的读接口
    logger.line('info', { ...base, status: 405, result: 'method-not-allowed' });
    return fail(405, '这个接口不支持 HEAD。');
  }

  if (pathname === '/feedback/healthz') {
    logger.line('info', { ...base, status: 200, result: 'healthz' });
    return json(200, {
      ok: true,
      service: 'feedback',
      items: store.listMetas().length,
      trash: store.trashCount(),
      sessions: sessions.size,
      // 额度单位是**份**（2026-10-01 改口径；字段名跟着从 filesPerIpPerDay 改掉，免得被误读）
      submitsPerIpPerDay: config.submitsPerIpPerDay,
      maxFileBytes: config.maxFileBytes,
      maxFilesPerItem: config.maxFilesPerItem,
      // 旧口径（files-*.json）还剩几个没清 —— 只报个数，内容一律不读，见 RUNBOOK §6
      legacyRateFiles: quota.legacyFiles().length,
    });
  }

  // ---- 公开接口：投稿 ----
  if (pathname === '/feedback/submit') {
    if (method !== 'POST') {
      logger.line('info', { ...base, status: 405, result: 'method-not-allowed' });
      return fail(405, '投稿请用 POST。');
    }
    return handleSubmit({
      headers, body, clientIp, nowMs, config, quota, store, logger, base,
    });
  }

  // ---- 公开接口：登录 ----
  if (pathname === '/feedback/login') {
    if (method !== 'POST') {
      logger.line('info', { ...base, status: 405, result: 'method-not-allowed' });
      return fail(405, '登录请用 POST。');
    }
    return handleLogin({
      headers, body, clientIp, nowMs, config, sessions, loginFails, logger, base,
    });
  }

  // ---- 以下五个都要会话 ----
  const AUTHED_PATHS = [
    '/feedback/list', '/feedback/item', '/feedback/file', '/feedback/read', '/feedback/delete',
  ];
  if (AUTHED_PATHS.includes(pathname)) {
    const wantsPost = pathname === '/feedback/read' || pathname === '/feedback/delete';
    if (method !== (wantsPost ? 'POST' : 'GET')) {
      logger.line('info', { ...base, status: 405, result: 'method-not-allowed' });
      return fail(405, wantsPost ? '请用 POST。' : '请用 GET。');
    }
    const token = cookieOf(headers.cookie, COOKIE_NAME);
    if (!sessions.valid(token, nowMs)) {
      // 契约：未带 / 过期会话一律 401 `{ok:false,error:'未登录'}`
      logger.line('info', { ...base, status: 401, result: 'unauthenticated' });
      return fail(401, '未登录');
    }
    if (pathname === '/feedback/list') return handleList({ store, logger, base });
    if (pathname === '/feedback/item') return handleItem({ query, store, logger, base });
    if (pathname === '/feedback/read') return handleRead({ body, nowMs, store, logger, base });
    if (pathname === '/feedback/delete') return handleDelete({ body, nowMs, store, logger, base });
    return handleFile({ query, store, logger, base });
  }

  logger.line('info', { ...base, status: 404, result: 'not-found' });
  return fail(404, '没有这个接口。');
}

/** 附件上限只报 413 时用（服务端字节数封顶，不区分是哪个文件） */
function tooLarge() {
  return fail(413, '附件太大了：单个文件上限 10MB（超过这个数的请求会在服务端被直接拒掉，不会落盘）。');
}

/** POST /feedback/submit */
function handleSubmit({ headers, body, clientIp, nowMs, config, quota, store, logger, base }) {
  const contentType = String(headers['content-type'] ?? '');
  const boundary = boundaryOf(contentType);
  if (boundary === null) {
    logger.line('info', { ...base, status: 400, result: 'bad-content-type' });
    return fail(400, '投稿要发 multipart/form-data。');
  }
  if (body === null) {
    logger.line('info', { ...base, status: 400, result: 'empty-body' });
    return fail(400, '请求体是空的。');
  }

  const { parts } = parseMultipart(body, boundary);
  const fields = {};
  const files = [];
  for (const p of parts) {
    if (p.name === 'files' || p.name === 'files[]') {
      if (p.filename === null) continue;   // 浏览器"没选文件"时会补一个空的 files 段，忽略
      files.push(p);
      continue;
    }
    if (p.name === 'kind' || p.name === 'title' || p.name === 'author' || p.name === 'body') {
      if (p.filename === null) fields[p.name] = p.data.toString('utf8');
    }
  }

  // ① 字段校验（长度 / kind 取值），任一不过就是 400 + 那句中文原因
  const checked = validateSubmission(fields, files.length, config);
  if (!checked.ok) {
    logger.line('info', { ...base, status: checked.status, result: `reject:${checked.code}` });
    return fail(checked.status, checked.error);
  }

  // ② 附件个数（契约 0..5）
  if (files.length > config.maxFilesPerItem) {
    logger.line('info', { ...base, status: 400, result: 'reject:too-many-files', files: files.length });
    return fail(400, `一次最多带 ${config.maxFilesPerItem} 个附件，这次带了 ${files.length} 个。`);
  }

  // ③ 逐个附件：大小 + 扩展名白名单（**先全查一遍再落盘**，别写了一半才发现第 3 个不合法）
  for (const f of files) {
    if (f.data.length > config.maxFileBytes) {
      logger.line('info', { ...base, status: 413, result: 'reject:file-too-large', bytes: f.data.length });
      return tooLarge();
    }
    if (!isAllowedExtension(f.filename)) {
      logger.line('info', { ...base, status: 415, result: 'reject:bad-extension', ext: f.filename });
      return fail(415, `附件的扩展名不在白名单里。${EXT_HINT}`);
    }
  }

  // ④ 每 IP 每天的**提交份数**额度（2026-10-01 改口径：一次提交不管带 0/1/5 个附件都只占 1 份；
  //    先查后记 —— 失败或不合法的请求不白吃用户的额度）
  const verdict = quota.check(clientIp, nowMs);
  if (!verdict.allowed) {
    logger.line('warn', { ...base, status: 429, result: 'rate-limited:submits-per-day', used: verdict.used });
    return fail(429, verdict.message, { 'retry-after': '3600' });
  }

  // ⑤ 落盘
  const id = newItemId(nowMs);
  const createdAt = new Date(nowMs).toISOString();
  try {
    const dir = store.begin(id);
    const saved = [];
    for (const f of files) {
      const clean = sanitizeFileName(f.filename);
      const put = store.saveAttachment(dir, clean, f.data);
      saved.push({ name: clean, size: put.size, storedAs: put.storedAs });
    }
    // meta.json 里存 `ip`（契约要求）；回给前端的 item 会把 ip 去掉
    const meta = {
      id,
      kind: checked.kind,
      title: checked.title,
      author: checked.author,
      body: checked.body,
      createdAt,
      ip: clientIp,
      files: saved,
    };
    store.commit(id, meta);
    // ★ 记账：一次成功的投稿记 **1 份**（不管带 0 个还是 5 个附件）
    quota.record(clientIp, nowMs);
    logger.line('info', {
      ...base, status: 200, result: 'submitted', id, kind: meta.kind, files: saved.length,
      // 只写净化后的名字，不写客户端原始文件名
      storedAs: saved.map((s) => s.storedAs),
    });
    return json(200, { ok: true, id });
  } catch (e) {
    logger.line('error', { ...base, status: 500, result: 'write-failed', error: String(e && e.message ? e.message : e) });
    return fail(500, '服务器写盘失败，这条投稿没有存下来。请稍后再试。');
  }
}

/** POST /feedback/login */
function handleLogin({ headers, body, clientIp, nowMs, config, sessions, loginFails, logger, base }) {
  // 先看限流：连续失败 >= 5 次 / 10 分钟 ⇒ 一律 429（连密码都不比，省得给爆破留时间差）
  const gate = loginFails.check(clientIp, nowMs);
  if (!gate.allowed) {
    logger.line('warn', { ...base, status: 429, result: 'rate-limited:login-failures', used: gate.used });
    return fail(429, gate.message, { 'retry-after': String(gate.retryAfterSeconds) });
  }

  const parsed = passwordFrom(headers['content-type'], body === null ? '' : body.toString('utf8'));
  if (parsed.error !== undefined) {
    logger.line('info', { ...base, status: 400, result: 'reject:bad-body' });
    return fail(400, parsed.error);
  }
  const given = parsed.password ?? '';
  if (given.length === 0 || !safeEqual(given, config.password)) {
    const used = loginFails.record(clientIp, nowMs);
    // 契约逐字要求这句：`{ok:false, error:'密码不对'}`
    logger.line('info', { ...base, status: 401, result: 'login-failed', fails: used });
    return fail(401, '密码不对', { 'x-login-failures': String(used) });
  }

  loginFails.clear(clientIp);
  const token = sessions.issue(nowMs);
  logger.line('info', { ...base, status: 200, result: 'login-ok', sessions: sessions.size });
  // ★ 只回 cookie，token 不进日志、不进响应体
  return json(200, { ok: true }, { 'set-cookie': sessionCookie(token, config.sessionTtlSeconds) });
}

/** GET /feedback/list —— 最新的在最前（store.listMetas 已排序），带 unread / total 汇总 */
function handleList({ store, logger, base }) {
  const metas = store.listMetas();
  const items = metas.map((m) => ({
    id: m.id,
    kind: m.kind,
    title: m.title,
    author: m.author,
    createdAt: m.createdAt,
    fileCount: Array.isArray(m.files) ? m.files.length : 0,
    // 2026-10-01 追加：隐藏页要显示未读数、要能一眼看出哪些读过
    read: m.read === true,
    readAt: typeof m.readAt === 'string' ? m.readAt : null,
  }));
  const unread = items.filter((it) => !it.read).length;
  logger.line('info', { ...base, status: 200, result: 'list', count: items.length, unread });
  return json(200, { ok: true, items, unread, total: items.length });
}

/**
 * POST /feedback/read —— 标记已读 / 标回未读（2026-10-01 追加）。
 *
 * 契约：JSON `{ id, read }`；改 meta.json 的 `read`/`readAt`；
 * 回 `{ ok:true, id, read }`；`id` 不存在 ⇒ 404 `{ok:false,error:'找不到这条反馈'}`。
 */
function handleRead({ body, nowMs, store, logger, base }) {
  const parsed = jsonObjectFrom(body === null ? '' : body.toString('utf8'));
  if (parsed.error !== undefined) {
    logger.line('info', { ...base, status: 400, result: 'reject:bad-body' });
    return fail(400, parsed.error);
  }
  const id = String(parsed.value.id ?? '');
  const bad = idRejection(id);
  if (bad !== null) {
    logger.line('info', { ...base, status: 400, result: 'reject:bad-id' });
    return fail(400, bad);
  }
  if (typeof parsed.value.read !== 'boolean') {
    logger.line('info', { ...base, status: 400, result: 'reject:bad-read' });
    return fail(400, 'read 必须是 true 或 false。');
  }
  const res = store.setRead(id, parsed.value.read, nowMs);
  if (!res.ok) {
    const status = res.writeFailed === true ? 500 : 404;
    logger.line(status === 500 ? 'error' : 'info', {
      ...base, status, result: status === 500 ? 'meta-write-failed' : 'item-not-found', id,
    });
    return status === 500 ? fail(500, '服务器写盘失败，这条反馈的状态没有改成功。') : fail(404, '找不到这条反馈');
  }
  logger.line('info', { ...base, status: 200, result: 'read-set', id, read: res.read });
  return json(200, { ok: true, id, read: res.read });
}

/**
 * POST /feedback/delete —— 软删除（2026-10-01 追加）。
 *
 * 契约：JSON `{ id }`；把 `items/<id>/` 整个目录**移到** `trash/<id>-<时间戳>/`（不 rm）；
 * 回 `{ ok:true, id }`；`id` 不存在 ⇒ 404 同一句话；`id` 含路径分隔符或 `..` ⇒ 400。
 */
function handleDelete({ body, nowMs, store, logger, base }) {
  const parsed = jsonObjectFrom(body === null ? '' : body.toString('utf8'));
  if (parsed.error !== undefined) {
    logger.line('info', { ...base, status: 400, result: 'reject:bad-body' });
    return fail(400, parsed.error);
  }
  const id = String(parsed.value.id ?? '');
  const bad = idRejection(id);
  if (bad !== null) {
    logger.line('info', { ...base, status: 400, result: 'reject:bad-id' });
    return fail(400, bad);
  }
  const res = store.moveToTrash(id, nowMs);
  if (!res.ok) {
    const status = res.moveFailed === true ? 500 : 404;
    logger.line(status === 500 ? 'error' : 'info', {
      ...base, status, result: status === 500 ? 'trash-move-failed' : 'item-not-found', id,
    });
    return status === 500 ? fail(500, '服务器移动文件失败，这条反馈没有删掉。') : fail(404, '找不到这条反馈');
  }
  // ★ 只记 id（不记标题 / 正文）：日志不是内容仓库
  logger.line('info', { ...base, status: 200, result: 'deleted', id });
  return json(200, { ok: true, id });
}

/** GET /feedback/item?id= —— 回 meta 的副本，**去掉 ip**，不带服务器路径 */
function handleItem({ query, store, logger, base }) {
  const id = query.get('id') ?? '';
  const meta = store.readMeta(id);
  if (meta === null) {
    logger.line('info', { ...base, status: 404, result: 'item-not-found', id });
    return fail(404, '没有这份投稿。');
  }
  const item = {
    id: meta.id,
    kind: meta.kind,
    title: meta.title,
    author: meta.author,
    body: meta.body,
    createdAt: meta.createdAt,
    read: meta.read === true,
    readAt: typeof meta.readAt === 'string' ? meta.readAt : null,
    files: (Array.isArray(meta.files) ? meta.files : []).map((f) => ({ name: f.storedAs, size: f.size })),
  };
  // 日志只记 id / kind（**不记标题正文**：正文可能含个人信息，要看就读 items/<id>/meta.json）
  logger.line('info', { ...base, status: 200, result: 'item', id, kind: item.kind, bodyLength: String(item.body ?? '').length });
  return json(200, { ok: true, item });
}

/** GET /feedback/file?id=&name= —— 附件字节 */
function handleFile({ query, store, logger, base }) {
  const id = query.get('id') ?? '';
  const name = query.get('name') ?? '';
  const hit = store.resolveAttachment(id, name);
  if (hit === null) {
    // 契约：`name` 必须命中该 item 的清单，防路径穿越 ⇒ 不命中就是 404
    logger.line('info', { ...base, status: 404, result: 'attachment-not-found', id });
    return fail(404, '这个附件不在该投稿里。');
  }
  try {
    const data = readFileSync(hit.path);
    const size = statSync(hit.path).size;
    logger.line('info', { ...base, status: 200, result: 'file', id, storedAs: hit.entry.storedAs, size });
    return {
      status: 200,
      headers: {
        'content-type': contentTypeFor(hit.entry.storedAs),
        // 契约要求 inline（图片/PDF 直接在浏览器里看）
        'content-disposition': contentDispositionInline(hit.entry.storedAs),
        'content-length': String(data.length),
        'cache-control': 'no-store',
        // 附件是用户上传的内容，别让浏览器按内容猜类型
        'x-content-type-options': 'nosniff',
      },
      body: data,
    };
  } catch (e) {
    logger.line('error', { ...base, status: 500, result: 'file-read-failed', id, error: String(e && e.message ? e.message : e) });
    return fail(500, '读附件失败。');
  }
}
