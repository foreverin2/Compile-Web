/**
 * `server/feedback/` 的离线单测（2026-10-01）。
 *
 * 这一层只管**不需要真服务器**的那半：
 *  - 文件名净化：路径分隔符 / `..` / 控制字符 / 重名序号；
 *  - multipart 解析：多个文件段、空 filename 段（浏览器"没选文件"的形态）、二进制内容里的 CRLF；
 *  - 字段校验：契约里的 1..80 / 1..40 / 1..5000 / kind 取值；
 *  - 按 IP 每天的文件额度与登录失败闸（跨天、重启恢复）；
 *  - 会话：Cookie 形状、过期、无效 token；
 *  - **路径穿越**：`resolveAttachment` 必须只认清单里已存的 `storedAs`。
 *
 * 测试里的密码一律是字面量 `test-password`（占位），**绝不**用线上那个。
 *
 * ⚠️ 加载方式照 `tests/data/card-effect-tags.test.ts` 的既成做法：
 * 被加载的是 `.mjs` 且本仓**没有** `@types/node` / `server/*.d.ts`，
 * 写成静态 `import … from '../../server/feedback/lib/auth.mjs'` 会直接
 * `TS7016: implicitly has an 'any' type`（本仓禁止为某处扩 node 类型声明）。
 * 所以说明符用**运行时拼出来的非字面量**，让 TS 不解析它 —— 运行时行为完全一样。
 */

import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

/** 服务端模块的真实路径都从测试文件位置算出来（不信 cwd） */
const MODULES = {
  auth: ['..', '..', 'server', 'feedback', 'lib', 'auth.mjs'],
  multipart: ['..', '..', 'server', 'feedback', 'lib', 'multipart.mjs'],
  naming: ['..', '..', 'server', 'feedback', 'lib', 'naming.mjs'],
  rateLimit: ['..', '..', 'server', 'feedback', 'lib', 'rate-limit.mjs'],
  storage: ['..', '..', 'server', 'feedback', 'lib', 'storage.mjs'],
  validate: ['..', '..', 'server', 'feedback', 'lib', 'validate.mjs'],
  mime: ['..', '..', 'server', 'feedback', 'lib', 'mime.mjs'],
  handler: ['..', '..', 'server', 'feedback', 'lib', 'handler.mjs'],
};

/** 动态 import 一个服务端模块（说明符运行时拼，TS 不解析它） */
async function load(rel: string[]) {
  return import(/* @vite-ignore */ rel.join('/'));
}

const auth = await load(MODULES.auth);
const multipart = await load(MODULES.multipart);
const naming = await load(MODULES.naming);
const rateLimit = await load(MODULES.rateLimit);
const storage = await load(MODULES.storage);
const validate = await load(MODULES.validate);
const mime = await load(MODULES.mime);
const handler = await load(MODULES.handler);

/** 造一个临时数据目录（数据目录必须是"里面什么都没有"的，所以单独 mkdtemp） */
type TmpDir = string;
const dirs: TmpDir[] = [];
function tempDir(): TmpDir {
  const d = mkdtempSync(join(tmpdir(), 'feedback-test-'));
  dirs.push(d);
  return d;
}
afterEach(() => {
  while (dirs.length > 0) {
    const d = dirs.pop();
    if (d !== undefined) rmSync(d, { recursive: true, force: true });
  }
});

describe('文件名净化', () => {
  it('切掉两种路径分隔符，只留 basename', () => {
    expect(naming.sanitizeFileName('/etc/passwd')).toBe('passwd');
    expect(naming.sanitizeFileName('C:\\Windows\\win.ini')).toBe('win.ini');
    expect(naming.sanitizeFileName('../../etc/passwd')).toBe('passwd');
  });

  it('把 .. 收成一个点并去掉开头的点', () => {
    expect(naming.sanitizeFileName('..')).not.toContain('..');
    expect(naming.sanitizeFileName('...')).not.toContain('..');
    expect(naming.sanitizeFileName('..hidden.png')).toBe('hidden.png');
    expect(naming.sanitizeFileName('.png')).not.toContain('..');
  });

  it('去掉控制字符与危险字符，保留中文与常用字符', () => {
    expect(naming.sanitizeFileName('a\u0000b\nc.png')).toBe('a_b_c.png');
    expect(naming.sanitizeFileName('a*b?c:d|e"f<g>h.png')).toBe('a_b_c_d_e_f_g_h.png');
    expect(naming.sanitizeFileName('崩溃日志 2026-10-01.log')).toBe('崩溃日志_2026-10-01.log');
  });

  it('结果里永远不会出现分隔符、CR/LF 或 ..', () => {
    for (const raw of ['../../x', 'a/b/c', 'a\\b\\c', 'a\r\nb', '..', '.../...', '....//....']) {
      const out = naming.sanitizeFileName(raw);
      expect(out).not.toContain('/');
      expect(out).not.toContain('\\');
      expect(out).not.toContain('\n');
      expect(out).not.toContain('..');
      expect(out.startsWith('.')).toBe(false);
    }
  });

  it('全空输入退到兜底名', () => {
    expect(naming.sanitizeFileName('')).toBe('file');
    expect(naming.sanitizeFileName('///')).toBe('file');
    expect(naming.sanitizeFileName('...')).toBe('file');
  });

  it('超长名字截断但保留扩展名', () => {
    const out = naming.sanitizeFileName(`${'x'.repeat(400)}.png`);
    expect(out.length <= 120).toBe(true);
    expect(out.endsWith('.png')).toBe(true);
  });

  it('重名自动加序号', () => {
    const dir = tempDir();
    expect(naming.uniqueNameIn(dir, 'a.png')).toBe('a.png');
    writeFileSync(join(dir, 'a.png'), 'x');
    expect(naming.uniqueNameIn(dir, 'a.png')).toBe('a-1.png');
    writeFileSync(join(dir, 'a-1.png'), 'x');
    expect(naming.uniqueNameIn(dir, 'a.png')).toBe('a-2.png');
  });

  it('扩展名大小写不敏感，取值是小写', () => {
    expect(naming.extensionOf('A.PNG')).toBe('png');
    expect(naming.extensionOf('noext')).toBe('');
    expect(mime.isAllowedExtension('shot.PNG')).toBe(true);
    expect(mime.isAllowedExtension('shot.exe')).toBe(false);
    expect(mime.isAllowedExtension('shot.svg')).toBe(false);
    expect(mime.isAllowedExtension('shot')).toBe(false);
    // 白名单就是契约里那 11 个，一个不多一个不少
    expect([...mime.ALLOWED_EXTS].sort().join(' ')).toBe(
      'csv gif jpeg jpg json log md pdf png txt webp',
    );
  });

  it('id 是可排序的 base36 时间戳 + 随机串，且不含路径字符', () => {
    const id = naming.newItemId(1759291200000);
    expect(/^[a-z0-9]+-[0-9a-f]{16}$/.test(id)).toBe(true);
    expect(id).not.toContain('/');
    expect(id).not.toContain('.');
  });
});

/**
 * 本地最小 `Buffer` 声明（只为让 `tsc --noEmit` 过）。
 * 本仓没装 `@types/node`、且明令"不许为某处扩 node 类型声明"，
 * 所以这里只声明本文件真正用到的四个成员，不碰 `tests/node-types.d.ts`。
 */
declare const Buffer: {
  from(input: string | number[]): LocalBuffer;
  concat(list: LocalBuffer[]): LocalBuffer;
  isBuffer(v: unknown): boolean;
  compare(a: LocalBuffer, b: LocalBuffer): number;
};
interface LocalBuffer {
  readonly length: number;
  toString(encoding?: string): string;
  [Symbol.iterator](): { next(): { value: number; done: boolean } };
}

describe('multipart 解析', () => {
  const B = '----boundary1234';

  /** 拼一个 multipart 请求体（段头 + 体 + CRLF，最后是收尾分隔行） */
  function build(parts: Array<{ head: string; data: string | LocalBuffer }>): LocalBuffer {
    const chunks: LocalBuffer[] = [];
    for (const p of parts) {
      chunks.push(Buffer.from(`--${B}\r\n${p.head}\r\n\r\n`));
      chunks.push(typeof p.data === 'string' ? Buffer.from(p.data) : p.data);
      chunks.push(Buffer.from('\r\n'));
    }
    chunks.push(Buffer.from(`--${B}--\r\n`));
    return Buffer.concat(chunks);
  }

  it('从 content-type 里取 boundary（带引号 / 不带引号）', () => {
    expect(multipart.boundaryOf('multipart/form-data; boundary="abc"')).toBe('abc');
    expect(multipart.boundaryOf('multipart/form-data; boundary=abc')).toBe('abc');
    expect(multipart.boundaryOf('application/json')).toBe(null);
    expect(multipart.boundaryOf(undefined)).toBe(null);
  });

  it('解析两个字段 + 一个文件（含中文与二进制）', () => {
    const body = build([
      { head: 'Content-Disposition: form-data; name="title"', data: '标题' },
      { head: 'Content-Disposition: form-data; name="kind"', data: 'bug' },
      {
        head: 'Content-Disposition: form-data; name="files"; filename="shot.png"\r\nContent-Type: image/png',
        data: Buffer.from([1, 2, 3, 4]),
      },
    ]);
    const parsed = multipart.parseMultipart(body, B);
    expect(parsed.parts.length).toBe(3);
    expect(parsed.parts[0].name).toBe('title');
    expect(parsed.parts[0].data.toString('utf8')).toBe('标题');
    expect(parsed.parts[2].filename).toBe('shot.png');
    expect(parsed.parts[2].contentType).toBe('image/png');
    expect([...parsed.parts[2].data]).toEqual([1, 2, 3, 4]);
  });

  it('filename="" 的段（浏览器"没选文件"）规范成 null', () => {
    const body = build([
      { head: 'Content-Disposition: form-data; name="files"; filename=""', data: '' },
    ]);
    const parsed = multipart.parseMultipart(body, B);
    expect(parsed.parts.length).toBe(1);
    expect(parsed.parts[0].filename).toBe(null);
  });

  it('二进制内容里的 CRLF 与"看着像 boundary"的字节都不破坏解析', () => {
    const payload = Buffer.concat([
      Buffer.from(`\r\n--${'x'.repeat(8)}\r\n`),
      Buffer.from([0x00, 0xff, 0x0d, 0x0a]),
    ]);
    const body = build([
      { head: 'Content-Disposition: form-data; name="files"; filename="a.png"', data: payload },
      { head: 'Content-Disposition: form-data; name="title"', data: 't' },
    ]);
    const parsed = multipart.parseMultipart(body, B);
    expect(parsed.parts.length).toBe(2);
    expect(Buffer.compare(parsed.parts[0].data, payload)).toBe(0);
    expect(parsed.parts[1].data.toString('utf8')).toBe('t');
  });
});

describe('投稿字段校验（契约口径）', () => {
  const config = { titleMax: 80, authorMax: 40, bodyMax: 5000 };
  const base = { kind: 'bug', title: '闪退', author: '小明', body: '打第三回合时闪退' };

  it('正常的过', () => {
    const r = validate.validateSubmission(base, 0, config);
    expect(r.ok).toBe(true);
    expect(r.title).toBe('闪退');
  });

  it('kind 只认 protocol / bug', () => {
    expect(validate.validateSubmission({ ...base, kind: 'other' }, 0, config).status).toBe(400);
    expect(validate.validateSubmission({ ...base, kind: '' }, 0, config).status).toBe(400);
    expect(validate.validateSubmission({ ...base, kind: 'protocol' }, 0, config).ok).toBe(true);
  });

  it('title 去空白后 1..80', () => {
    expect(validate.validateSubmission({ ...base, title: '   ' }, 0, config).status).toBe(400);
    expect(validate.validateSubmission({ ...base, title: 'x'.repeat(80) }, 0, config).ok).toBe(true);
    expect(validate.validateSubmission({ ...base, title: 'x'.repeat(81) }, 0, config).status).toBe(400);
  });

  it('author 1..40', () => {
    expect(validate.validateSubmission({ ...base, author: '' }, 0, config).status).toBe(400);
    expect(validate.validateSubmission({ ...base, author: 'y'.repeat(40) }, 0, config).ok).toBe(true);
    expect(validate.validateSubmission({ ...base, author: 'y'.repeat(41) }, 0, config).status).toBe(400);
  });

  it('body 1..5000（空正文也是 400，契约就是 1..5000）', () => {
    expect(validate.validateSubmission({ ...base, body: '  ' }, 0, config).status).toBe(400);
    expect(validate.validateSubmission({ ...base, body: 'z'.repeat(5000) }, 0, config).ok).toBe(true);
    expect(validate.validateSubmission({ ...base, body: 'z'.repeat(5001) }, 0, config).status).toBe(400);
  });

  it('缺字段（undefined）按空处理 ⇒ 400', () => {
    expect(validate.validateSubmission({}, 0, config).status).toBe(400);
    expect(validate.validateSubmission({ kind: 'bug', title: 't' }, 0, config).status).toBe(400);
  });
});

describe('按 IP 每天的提交份数额度（2026-10-01 改口径）', () => {
  /**
   * ★ 日期夹具必须**锚在真今天**，不能写死某一天。
   *
   * 原因（2026-10-02 查出来的那 2 条红）：`SubmitQuota.prune()` 会把**早于昨天**的
   * `submits-*.json` 删掉（这是产线要的行为：额度文件按天分，隔两天就该清）。
   * 而这一组用例原先写死 `new Date(2026, 9, 1, …)`；到了 2026-10-02 再跑，
   * 那个日期已经"早于昨天" ⇒ 新造的实例在构造函数里顺手把刚写下的文件当过期清理了，
   * 于是 `check()` 读到 0。夹具的锅，不是产的锅（详见下面每条用例的注释）。
   */
  const DAY_MS = 24 * 60 * 60 * 1000;
  /** 真今天（跟着系统时钟走，不写死） */
  const TODAY = Date.now();
  const YESTERDAY = TODAY - DAY_MS;

  it('额度用满就拒，过了零点再算', () => {
    const dir = tempDir();
    const q = new rateLimit.SubmitQuota({ dir, perDay: 5 });
    const t0 = TODAY;
    expect(q.check('1.2.3.4', t0).allowed).toBe(true);
    for (let i = 0; i < 5; i += 1) q.record('1.2.3.4', t0);   // 连交 5 份
    const denied = q.check('1.2.3.4', t0);                    // 第 6 次
    expect(denied.allowed).toBe(false);
    expect(denied.used).toBe(5);
    // 文案必须说"份"，不许再说"个文件"
    expect(denied.message).toContain('每天最多 5 份');
    expect(denied.message).toContain('提交过 5 份反馈');
    expect(denied.message).not.toContain('个文件');
    // 换个 IP 不受影响
    expect(q.check('5.6.7.8', t0).allowed).toBe(true);
    // 第二天重新有额度
    const t1 = t0 + DAY_MS;
    expect(q.check('1.2.3.4', t1).allowed).toBe(true);
    expect(rateLimit.dayKey(t1)).toBe(rateLimit.dayKey(t0 + DAY_MS));
    expect(rateLimit.dayKey(t1)).not.toBe(rateLimit.dayKey(t0));
  });

  it('额度按**份**记：record 一次只加 1（不管那次带几个附件）', () => {
    const dir = tempDir();
    const q = new rateLimit.SubmitQuota({ dir, perDay: 5 });
    const t0 = TODAY;
    expect(q.record('7.7.7.7', t0)).toBe(1);
    expect(q.record('7.7.7.7', t0)).toBe(2);
    expect(q.check('7.7.7.7', t0).used).toBe(2);
  });

  it('重启后从磁盘恢复今天的计数（额度不是内存里的）', () => {
    const dir = tempDir();
    const t0 = TODAY;
    const a = new rateLimit.SubmitQuota({ dir, perDay: 5 });
    a.record('9.9.9.9', t0);
    a.record('9.9.9.9', t0);
    a.record('9.9.9.9', t0);
    const b = new rateLimit.SubmitQuota({ dir, perDay: 5 });
    const v = b.check('9.9.9.9', t0);
    expect(v.allowed).toBe(true);
    expect(v.used).toBe(3);
    b.record('9.9.9.9', t0);
    b.record('9.9.9.9', t0);
    // 第 6 次
    expect(b.check('9.9.9.9', t0).allowed).toBe(false);
  });

  /**
   * ★ 冷缓存必须读盘（旧实现"缓存 miss ⇒ 当空表"在这条上必红）。
   *
   * 为什么换成"昨天"：新建实例的构造函数只把**今天**装进缓存，而 `prune()` 会删掉
   * 早于昨天的文件。用"昨天"正好落在两个条件之间 —— 文件不会被清掉，
   * 而缓存里又没有这个日期键 ⇒ 必须靠 `readDayFromDisk` 才能读到。
   *
   * 反向验证（改完实测过，见交付回报）：
   *   - 把 `tableFor` 里的 `readDayFromDisk(day)` 换回 `{}` ⇒ 本用例红（expected 4 / received 0）；
   *   - 单独一条用例做不到"反向变红"的话，它就是白写的。
   */
  it('冷缓存也要读盘：盘上摆一份昨天的计数，新实例问昨天必须读回来', () => {
    const dir = tempDir();
    const t0 = YESTERDAY;
    const day = rateLimit.dayKey(t0);
    // 直接摆盘，不经过任何实例的 record()
    writeFileSync(join(dir, `submits-${day}.json`), JSON.stringify({ '4.4.4.4': 4 }));
    const cold = new rateLimit.SubmitQuota({ dir, perDay: 5 });
    // 构造函数只装了今天 ⇒ 昨天那个键并不在缓存里（这条支路就是"冷缓存"）
    expect([...cold.cache.keys()]).not.toContain(day);
    const v = cold.check('4.4.4.4', t0);
    expect(v.used).toBe(4);
    expect(v.allowed).toBe(true);      // 还剩 1 份
    cold.record('4.4.4.4', t0);
    expect(cold.check('4.4.4.4', t0).allowed).toBe(false);   // 第 6 次
  });

  it('跨天那一刻不会白送额度：构造时是前一天、请求已经跨到第二天', () => {
    const dir = tempDir();
    // A = 真今天、B = 明天（都落在 prune 的保留窗口里，不会被清理）
    const dayA = TODAY;
    const dayB = TODAY + DAY_MS;
    // A 日交了 5 份，落到盘上
    const a = new rateLimit.SubmitQuota({ dir, perDay: 5 });
    for (let i = 0; i < 5; i += 1) a.record('6.6.6.6', dayA);
    expect(a.check('6.6.6.6', dayA).allowed).toBe(false);
    // 同一个实例（进程没重启）处理已经跨到 B 日的请求：B 日从来没记过 ⇒ 应当放行
    //   这一条同时钉住"按天分文件"这件事：A 日的 5 份不该被算进 B 日
    expect(a.check('6.6.6.6', dayB).allowed).toBe(true);
    expect(a.check('6.6.6.6', dayB).used).toBe(0);
    // 而 A 日仍然是满的（读的是 A 日的盘）
    expect(a.check('6.6.6.6', dayA).used).toBe(5);
  });

  it('旧的 files-*.json 被无视这件事会记一条日志（不静默），每个进程最多一条', () => {
    const dir = tempDir();
    const t0 = TODAY;
    const day = rateLimit.dayKey(t0);
    writeFileSync(join(dir, `files-${day}.json`), JSON.stringify({ '5.5.5.5': 9 }));
    const lines: Array<Record<string, unknown>> = [];
    const q = new rateLimit.SubmitQuota({
      dir,
      perDay: 5,
      log: (msg: string, extra?: Record<string, unknown>) => lines.push({ msg, ...extra }),
    });
    q.check('5.5.5.5', t0);
    q.check('5.5.5.5', t0);
    q.check('5.5.5.5', t0);
    const hits = lines.filter((l) => l.msg === 'legacy-rate-file-ignored');
    expect(hits.length).toBe(1);
    expect(String(hits[0].note)).toContain('files-*.json');
    // 而且额度没有被旧文件的 9 影响
    expect(q.check('5.5.5.5', t0).used).toBe(0);
    // 旧文件一个字节没动
    expect(existsSync(join(dir, `files-${day}.json`))).toBe(true);
  });

  it('记账文件名换成 submits-（与旧口径的 files- 分开），旧文件不读也不删', () => {
    const dir = tempDir();
    const t0 = new Date(2026, 9, 1, 10, 0, 0).getTime();
    const day = rateLimit.dayKey(t0);
    const q = new rateLimit.SubmitQuota({ dir, perDay: 5 });
    q.record('1.1.1.1', t0);
    // 新口径的文件名
    expect(readdirSync(dir)).toContain(`submits-${day}.json`);
    expect(rateLimit.QUOTA_FILE_PREFIX).toBe('submits-');
    expect(rateLimit.LEGACY_QUOTA_FILE_PREFIX).toBe('files-');

    // 再手工放一个旧口径的文件：里面是"文件个数 5"。
    // 要是被当成"已提交 5 份"，这个 IP 就再也交不了了 —— 那是我们必须避免的误读。
    writeFileSync(join(dir, `files-${day}.json`), JSON.stringify({ '1.1.1.1': 5 }));
    const q2 = new rateLimit.SubmitQuota({ dir, perDay: 5 });
    // 只认 submits- 里的那 1 份；旧文件的 5 不参与计数
    expect(q2.check('1.1.1.1', t0).used).toBe(1);
    expect(q2.check('1.1.1.1', t0).allowed).toBe(true);
    // 旧文件被"看见"了（列得出来，供运维决定要不要清），而且没被删掉
    expect(q2.legacyFiles()).toEqual([`files-${day}.json`]);
    expect(existsSync(join(dir, `files-${day}.json`))).toBe(true);
  });
});

describe('提交接口的额度行为（改口径后的三条硬判据）', () => {
  /** 拼一个带 n 个附件的 multipart 请求体 */
  function submitBody(n: number, name = 'a.txt') {
    const B = '----q';
    const chunks = [];
    const field = (k: string, v: string) => {
      chunks.push(Buffer.from(`--${B}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
    };
    field('kind', 'bug');
    field('title', '额度用例');
    field('author', '小明');
    field('body', '额度用例正文');
    for (let i = 0; i < n; i += 1) {
      chunks.push(Buffer.from(
        `--${B}\r\nContent-Disposition: form-data; name="files"; filename="${name}"\r\n\r\nx\r\n`,
      ));
    }
    chunks.push(Buffer.from(`--${B}--\r\n`));
    return { body: Buffer.concat(chunks), headers: { 'content-type': `multipart/form-data; boundary=${B}` } };
  }

  it('① 带 5 个附件的一次提交只占 1 个额度', () => {
    const root = tempDir();
    const g = rig(root);
    const { body, headers } = submitBody(5);
    const r = g.call({ method: 'POST', pathname: '/feedback/submit', headers, body });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    // 5 个附件都落盘了，但额度只记 1 份
    expect(g.store.readMeta(r.body.id).files.length).toBe(5);
    expect(g.call({ headers: withCookie(g.token) }).body.total).toBe(1);
    const saved = JSON.parse(String(readFileSync(join(g.store.rateDir, `${rateLimit.QUOTA_FILE_PREFIX}${rateLimit.dayKey(g.now)}.json`))));
    expect(saved['203.0.113.9']).toBe(1);
  });

  it('② 连投 5 次成功、第 6 次 429（每次 1 个附件也一样）', () => {
    const root = tempDir();
    const g = rig(root);
    for (let i = 1; i <= 5; i += 1) {
      const { body, headers } = submitBody(1);
      const r = g.call({ method: 'POST', pathname: '/feedback/submit', headers, body });
      expect(r.status).toBe(200);
    }
    const { body, headers } = submitBody(1);
    const sixth = g.call({ method: 'POST', pathname: '/feedback/submit', headers, body });
    expect(sixth.status).toBe(429);
    expect(sixth.body.ok).toBe(false);
    expect(sixth.body.error).toContain('每天最多 5 份');
    expect(sixth.body.error).not.toContain('个文件');
    // 被拒的那次没有落盘、也没有把额度顶过 5
    expect(g.call({ headers: withCookie(g.token) }).body.total).toBe(5);
    const saved = JSON.parse(String(readFileSync(join(g.store.rateDir, `${rateLimit.QUOTA_FILE_PREFIX}${rateLimit.dayKey(g.now)}.json`))));
    expect(saved['203.0.113.9']).toBe(5);
  });

  it('②b 混合：一次带 5 个附件 + 四次各 1 个 ⇒ 正好 5 份，第 6 次 429', () => {
    const root = tempDir();
    const g = rig(root);
    const first = submitBody(5);
    expect(g.call({ method: 'POST', pathname: '/feedback/submit', headers: first.headers, body: first.body }).status).toBe(200);
    for (let i = 0; i < 4; i += 1) {
      const s = submitBody(1);
      expect(g.call({ method: 'POST', pathname: '/feedback/submit', headers: s.headers, body: s.body }).status).toBe(200);
    }
    const again = submitBody(1);
    expect(g.call({ method: 'POST', pathname: '/feedback/submit', headers: again.headers, body: again.body }).status).toBe(429);
    // 6 次请求、共 9 个附件都尝试过，只有前 5 份落盘（5+1+1+1+1 = 9 个附件）
    expect(g.call({ headers: withCookie(g.token) }).body.total).toBe(5);
  });

  /**
   * ★ 产线那条路的"重启"语义：请求走的是**真实当天**（`Date.now()`），
   * 服务重启 = 换一个全新的 `SubmitQuota` 实例。
   * 这一条钉的是"额度不会因为重启就白送 5 份"——也就是 `systemctl restart feedback` 之后
   * 同一个 IP 的第 6 份仍然 429。旧实现（缓存 miss ⇒ 当空表）在**当天**这条路上恰好能过，
   * 所以它防不住回归；真正能反向变红的是上面那条"冷缓存读盘"的用例。
   */
  it('②c 模拟服务重启：换一个全新的额度实例（同一数据目录），第 6 份仍然 429', () => {
    const root = tempDir();
    const g = rig(root);
    for (let i = 0; i < 5; i += 1) {
      const s = submitBody(1);
      expect(g.call({ method: 'POST', pathname: '/feedback/submit', headers: s.headers, body: s.body }).status).toBe(200);
    }
    // 重启：拿同一个数据目录、同一个时间戳造一个全新实例，换掉 rig 里那一个
    // 重启：拿同一个数据目录、用**真当天**的时间戳造一个全新实例（与产线一致）
    const now = Date.now();
    const rebooted = new rateLimit.SubmitQuota({ dir: g.store.rateDir, perDay: 5 });
    const before = rebooted.check('203.0.113.9', now);
    expect(before.used).toBe(5);
    expect(before.allowed).toBe(false);
    // 用新实例再走一次真正的请求路径
    const g2 = rig(root);
    const s = submitBody(1);
    const sixth = g2.call({
      method: 'POST', pathname: '/feedback/submit', headers: s.headers, body: s.body, quota: rebooted,
    });
    expect(sixth.status).toBe(429);
    expect(sixth.body.error).toContain('每天最多 5 份');
  });

  it('③ 附件超 5 个仍然 400（这条判据没被改口径影响）', () => {
    const root = tempDir();
    const g = rig(root);
    const six = submitBody(6);
    const r = g.call({ method: 'POST', pathname: '/feedback/submit', headers: six.headers, body: six.body });
    expect(r.status).toBe(400);
    expect(r.body.error).toContain('一次最多带 5 个附件');
    // 被 400 挡下的这次不占额度
    const ratePath = join(g.store.rateDir, `${rateLimit.QUOTA_FILE_PREFIX}${rateLimit.dayKey(g.now)}.json`);
    expect(existsSync(ratePath)).toBe(false);
    expect(g.call({ headers: withCookie(g.token) }).body.total).toBe(0);
  });

  it('超限被拒之后额度不会被顶过头（反复打第 6 次还是 5）', () => {
    const root = tempDir();
    const g = rig(root);
    for (let i = 0; i < 5; i += 1) {
      const s = submitBody(1);
      g.call({ method: 'POST', pathname: '/feedback/submit', headers: s.headers, body: s.body });
    }
    for (let i = 0; i < 3; i += 1) {
      const s = submitBody(2);
      expect(g.call({ method: 'POST', pathname: '/feedback/submit', headers: s.headers, body: s.body }).status).toBe(429);
    }
    const saved = JSON.parse(String(readFileSync(join(g.store.rateDir, `${rateLimit.QUOTA_FILE_PREFIX}${rateLimit.dayKey(g.now)}.json`))));
    expect(saved['203.0.113.9']).toBe(5);
  });

  /**
   * 并发：同一时刻打进来 12 份（0/1/5 个附件混着来），只有 5 份能成。
   *
   * 这一条钉两件事：
   *  - **额度不会被并发冲破**：`check` 与 `record` 都在 `handleRequest` 的同步段里
   *    （`readBody` 之后就没有 await 了），Node 单线程 ⇒ 12 个请求的"查-记"逐个串行完成，
   *    不存在两个请求都看到 used=4 于是都放行的窗口；
   *  - **计数文件不会被写坏**：`flush()` 是"写 `.tmp` + rename"（同目录 rename 原子），
   *    6 次写盘之后文件仍是一份完整 JSON，数字正好等于成功份数。
   * 将来谁把 `record()` 挪到 await 之后，这一条会红。
   */
  it('并发 12 份同时进来（0/1/5 个附件混合）⇒ 只有 5 份成功，计数正好 5 且文件是完整 JSON', () => {
    const root = tempDir();
    const g = rig(root);
    const results: number[] = [];
    for (let i = 0; i < 12; i += 1) {
      const s = submitBody(i % 3 === 0 ? 5 : (i % 3 === 1 ? 1 : 0));
      results.push(g.call({ method: 'POST', pathname: '/feedback/submit', headers: s.headers, body: s.body }).status);
    }
    expect(results.filter((c) => c === 200).length).toBe(5);
    expect(results.filter((c) => c === 429).length).toBe(7);
    // 落盘的份数也正好是 5（被 429 挡下的没有落盘）
    expect(g.call({ headers: withCookie(g.token) }).body.total).toBe(5);
    // 计数文件是完整 JSON，数字 = 成功份数
    const text = String(readFileSync(join(g.store.rateDir, `${rateLimit.QUOTA_FILE_PREFIX}${rateLimit.dayKey(g.now)}.json`)));
    const saved = JSON.parse(text);      // 解析不抛 = 没被写坏
    expect(saved['203.0.113.9']).toBe(5);
    // 临时文件不残留
    expect(readdirSync(g.store.rateDir).filter((n) => n.endsWith('.tmp'))).toEqual([]);
  });
});

describe('登录失败闸', () => {
  it('5 次失败之后 10 分钟内一律拒，窗口滑过去才放行', () => {
    const g = new rateLimit.LoginFailures({ max: 5, windowMs: 10 * 60 * 1000 });
    const t0 = 1759291200000;
    expect(g.check('1.1.1.1', t0).allowed).toBe(true);
    for (let i = 0; i < 5; i += 1) g.record('1.1.1.1', t0 + i * 1000);
    const gate = g.check('1.1.1.1', t0 + 6000);
    expect(gate.allowed).toBe(false);
    expect(gate.retryAfterSeconds).toBe(600);
    expect(g.check('1.1.1.1', t0 + 11 * 60 * 1000).allowed).toBe(true);
  });

  it('另一个 IP 不受牵连；密码对了会清掉自己的记录', () => {
    const g = new rateLimit.LoginFailures({ max: 5, windowMs: 600000 });
    const t0 = 1759291200000;
    for (let i = 0; i < 5; i += 1) g.record('1.1.1.1', t0);
    expect(g.check('2.2.2.2', t0).allowed).toBe(true);
    g.clear('1.1.1.1');
    expect(g.check('1.1.1.1', t0).allowed).toBe(true);
  });
});

describe('会话与 Cookie', () => {
  it('密码比较：对的就是对的，长度不同也不会抛', () => {
    expect(auth.safeEqual('abc', 'abc')).toBe(true);
    expect(auth.safeEqual('abc', 'abd')).toBe(false);
    expect(auth.safeEqual('abc', 'abcdefgh')).toBe(false);
    expect(auth.safeEqual('', '')).toBe(true);
  });

  it('会话发出来能校验，过期就不认了', () => {
    const s = new auth.Sessions({ ttlSeconds: 43200 });
    const t0 = 1759291200000;
    const token = s.issue(t0);
    expect(/^[0-9a-f]{64}$/.test(token)).toBe(true);
    expect(s.valid(token, t0 + 1000)).toBe(true);
    expect(s.valid(token, t0 + 43201 * 1000)).toBe(false);
    expect(s.valid('deadbeef', t0)).toBe(false);
    expect(s.valid(null, t0)).toBe(false);
    expect(s.valid('', t0)).toBe(false);
  });

  it('Set-Cookie 与契约逐字一致', () => {
    expect(auth.sessionCookie('tok', 43200)).toBe(
      'fb_session=tok; HttpOnly; SameSite=Strict; Path=/feedback; Max-Age=43200',
    );
    // 线上是 http，不能带 Secure（带了浏览器不存，后台直接登不进去）
    expect(auth.sessionCookie('tok', 43200)).not.toContain('Secure');
  });

  it('从 cookie 头里取到我们要的那个，别的 cookie 不干扰', () => {
    expect(auth.cookieOf('other=1; fb_session=abc; x=2', auth.COOKIE_NAME)).toBe('abc');
    expect(auth.cookieOf('fb_session=abc', auth.COOKIE_NAME)).toBe('abc');
    expect(auth.cookieOf('other=1', auth.COOKIE_NAME)).toBe(null);
    expect(auth.cookieOf(undefined, auth.COOKIE_NAME)).toBe(null);
  });

  it('会话数超过上限时扔最旧的', () => {
    const s = new auth.Sessions({ ttlSeconds: 100, max: 3 });
    const t0 = 1759291200000;
    const first = s.issue(t0);
    s.issue(t0 + 1);
    s.issue(t0 + 2);
    s.issue(t0 + 3);
    expect(s.valid(first, t0 + 4)).toBe(false);
    expect(s.size).toBe(3);
  });
});

describe('落盘与路径穿越', () => {
  it('meta.json 写得出来，列表按 createdAt 倒序', () => {
    const root = tempDir();
    const store = new storage.Store({ root, maxFileBytes: 1024 });
    const mk = (id: string, createdAt: string) => {
      const dir = store.begin(id);
      store.saveAttachment(dir, 'a.png', Buffer.from([1]));
      store.commit(id, {
        id, kind: 'bug', title: id, author: 'a', body: 'b', createdAt, ip: '1.1.1.1',
        files: [{ name: 'a.png', size: 1, storedAs: 'a.png' }],
      });
    };
    mk('aaa-1', '2026-10-01T01:00:00.000Z');
    mk('bbb-2', '2026-10-01T02:00:00.000Z');
    expect(store.listMetas().map((m: { id: string }) => m.id)).toEqual(['bbb-2', 'aaa-1']);
    expect(store.readMeta('aaa-1').title).toBe('aaa-1');
    expect(store.readMeta('nope-1')).toBe(null);
  });

  it('resolveAttachment 只认清单里的名字，穿越串一律拿不到', () => {
    const root = tempDir();
    const store = new storage.Store({ root, maxFileBytes: 1024 });
    const dir = store.begin('x1-1');
    store.saveAttachment(dir, 'shot.png', Buffer.from([1, 2]));
    store.commit('x1-1', {
      id: 'x1-1', kind: 'bug', title: 't', author: 'a', body: 'b',
      createdAt: '2026-10-01T00:00:00.000Z', ip: '1.1.1.1',
      files: [{ name: 'shot.png', size: 2, storedAs: 'shot.png' }],
    });

    expect(store.resolveAttachment('x1-1', 'shot.png') !== null).toBe(true);
    const evil = [
      '../../etc/passwd', '/etc/passwd', 'etc/passwd', '..', '.', '',
      'shot.png/../../etc/passwd', '..\\..\\windows\\win.ini', 'meta.json',
    ];
    for (const name of evil) {
      expect(store.resolveAttachment('x1-1', name)).toBe(null);
    }
    // id 也必须合法：穿越串进不了 items 目录之外
    expect(store.resolveAttachment('../x1-1', 'shot.png')).toBe(null);
    expect(store.resolveAttachment('x1-1/../x1-1', 'shot.png')).toBe(null);
    expect(store.resolveAttachment('..', 'shot.png')).toBe(null);
  });

  it('同一份投稿里两个同名附件自动加序号，都能取回', () => {
    const root = tempDir();
    const store = new storage.Store({ root, maxFileBytes: 1024 });
    const dir = store.begin('x2-1');
    const a = store.saveAttachment(dir, 'log.txt', Buffer.from('a'));
    const b = store.saveAttachment(dir, 'log.txt', Buffer.from('bb'));
    expect(a.storedAs).toBe('log.txt');
    expect(b.storedAs).toBe('log-1.txt');
    store.commit('x2-1', {
      id: 'x2-1', kind: 'protocol', title: 't', author: 'a', body: 'b',
      createdAt: '2026-10-01T00:00:00.000Z', ip: '1.1.1.1',
      files: [
        { name: 'log.txt', size: a.size, storedAs: a.storedAs },
        { name: 'log-1.txt', size: b.size, storedAs: b.storedAs },
      ],
    });
    expect(store.resolveAttachment('x2-1', 'log-1.txt').entry.size).toBe(2);
  });
});

describe('Content-Type 映射与响应头', () => {
  it('图片 / PDF / 文本各自给对', () => {
    expect(mime.contentTypeFor('a.png')).toBe('image/png');
    expect(mime.contentTypeFor('a.JPEG')).toBe('image/jpeg');
    expect(mime.contentTypeFor('a.webp')).toBe('image/webp');
    expect(mime.contentTypeFor('a.pdf')).toBe('application/pdf');
    expect(mime.contentTypeFor('a.txt')).toContain('text/plain');
    expect(mime.contentTypeFor('a.json')).toContain('application/json');
    expect(mime.contentTypeFor('a.csv')).toContain('text/csv');
    expect(mime.contentTypeFor('a.bin')).toBe('application/octet-stream');
  });

  it('Content-Disposition 是 inline，中文名另给 filename*', () => {
    const head = mime.contentDispositionInline('崩溃日志.log');
    expect(head.startsWith('inline; ')).toBe(true);
    expect(head).toContain("filename*=UTF-8''");
    expect(head).not.toContain('\n');
  });
});

// ---------------------------------------------------------------------------
// 2026-10-01 追加：隐藏页的"标记已读 / 删除"
// ---------------------------------------------------------------------------

/** 往 store 里塞一份投稿，返回 id */
function seed(
  store: {
    begin: (id: string) => string;
    saveAttachment: (d: string, n: string, b: LocalBuffer) => { storedAs: string; size: number };
    commit: (id: string, meta: Record<string, unknown>) => string;
  },
  id: string,
  createdAt: string,
  withFile: boolean,
) {
  const dir = store.begin(id);
  const files: Array<{ name: string; size: number; storedAs: string }> = [];
  if (withFile) {
    const put = store.saveAttachment(dir, 'log.txt', Buffer.from('hello'));
    files.push({ name: 'log.txt', size: put.size, storedAs: put.storedAs });
  }
  store.commit(id, {
    id, kind: 'bug', title: `标题-${id}`, author: '小明', body: '正文',
    createdAt, ip: '1.1.1.1', files,
  });
  return id;
}

/**
 * 直接调 `handleRequest`（不起真 HTTP）。
 * 会话、限流、store 都是真对象，只有 nowMs / clientIp / body 是字面量 —— 与 turn-cred 的
 * `handler.mjs` 一个路子：判定要可断言。
 */
function rig(root: string) {
  const store = new storage.Store({ root, maxFileBytes: 1024 * 1024 });
  const sessions = new auth.Sessions({ ttlSeconds: 43200 });
  // 额度单位是**份**（2026-10-01 改口径）
  const quota = new rateLimit.SubmitQuota({ dir: store.rateDir, perDay: 5 });
  const loginFails = new rateLimit.LoginFailures({ max: 5, windowMs: 600000 });
  const lines: Array<Record<string, unknown>> = [];
  const logger = { line: (_level: string, fields: Record<string, unknown>) => lines.push(fields) };
  const config = {
    password: 'test-password', passwordSource: 'test', titleMax: 80, authorMax: 40, bodyMax: 5000,
    maxFilesPerItem: 5, maxFileBytes: 1024 * 1024, submitsPerIpPerDay: 5, sessionTtlSeconds: 43200,
    loginFailMax: 5, loginFailWindowSeconds: 600, bodyBytesCap: 8 * 1024 * 1024, trustProxy: true,
  };
  // ★ 请求时间戳用**真当时**（不写死某一天）：
  //   额度按天分文件、且 `prune()` 会清掉早于昨天的记账，写死一个过去的日期会让
  //   "提交 → 记账 → 重启后再查"这条链落到不同的一天上（2026-10-02 那 2 条红的一半原因）。
  //   日期相关的断言本来就不该依赖"今天是几号"，所以这里跟着系统时钟走。
  const NOW = Date.now();
  const token = sessions.issue(NOW);
  const call = (over: Record<string, unknown>) => handler.handleRequest({
    method: 'GET',
    pathname: '/feedback/list',
    query: new URLSearchParams(),
    headers: {},
    body: null,
    clientIp: '203.0.113.9',
    nowMs: NOW,
    config,
    sessions,
    quota,
    loginFails,
    store,
    logger,
    ...over,
  });
  return { store, sessions, quota, loginFails, lines, config, token, now: NOW, call };
}

/** 造一个带会话 Cookie 的 GET 请求头 */
function withCookie(token: string, name = auth.COOKIE_NAME) {
  return { cookie: `${name}=${token}` };
}

describe('追加需求：已读 / 未读', () => {
  it('新投稿的 meta.json 里 read=false、readAt=null', () => {
    const root = tempDir();
    const store = new storage.Store({ root, maxFileBytes: 1024 });
    seed(store, 'n1-1', '2026-10-01T00:00:00.000Z', true);
    const meta = store.readMeta('n1-1');
    expect(meta.read).toBe(false);
    expect(meta.readAt).toBe(null);
  });

  it('老投稿（meta.json 里没有 read 字段）按未读算，不需要回填', () => {
    const root = tempDir();
    const store = new storage.Store({ root, maxFileBytes: 1024 });
    seed(store, 'old-1', '2026-09-30T00:00:00.000Z', false);
    // 手工抹掉字段，模拟升级前落的那批
    const p = `${root}/items/old-1/meta.json`;
    const raw = JSON.parse(String(readFileSync(p)));
    delete raw.read;
    delete raw.readAt;
    writeFileSync(p, JSON.stringify(raw));
    const meta = store.readMeta('old-1');
    expect(meta.read).toBe(false);
    expect(meta.readAt).toBe(null);
  });

  it('setRead 记下 readAt；标回未读时 readAt 一起清掉', () => {
    const root = tempDir();
    const store = new storage.Store({ root, maxFileBytes: 1024 });
    seed(store, 'r1-1', '2026-10-01T00:00:00.000Z', true);
    const t = 1759291200000;
    const on = store.setRead('r1-1', true, t);
    expect(on.ok).toBe(true);
    expect(on.read).toBe(true);
    expect(on.readAt).toBe(new Date(t).toISOString());
    const back = store.setRead('r1-1', false, t + 1000);
    expect(back.read).toBe(false);
    expect(back.readAt).toBe(null);
    expect(store.setRead('nope-1', true, t).ok).toBe(false);
  });

  it('list 带回 unread / total，item 带回 read / readAt', () => {
    const root = tempDir();
    const g = rig(root);
    seed(g.store, 'a1-1', '2026-10-01T00:00:00.000Z', true);
    seed(g.store, 'a2-2', '2026-10-01T01:00:00.000Z', true);

    const before = g.call({ headers: withCookie(g.token) });
    expect(before.status).toBe(200);
    expect(before.body.total).toBe(2);
    expect(before.body.unread).toBe(2);
    expect(before.body.items[0].read).toBe(false);
    expect(before.body.items[0].readAt).toBe(null);
    // 最新的在最前
    expect(before.body.items.map((i: { id: string }) => i.id)).toEqual(['a2-2', 'a1-1']);

    const marked = g.call({
      method: 'POST', pathname: '/feedback/read', headers: withCookie(g.token),
      body: Buffer.from(JSON.stringify({ id: 'a2-2', read: true })),
    });
    expect(marked.status).toBe(200);
    expect(marked.body).toEqual({ ok: true, id: 'a2-2', read: true });

    const after = g.call({ headers: withCookie(g.token) });
    expect(after.body.unread).toBe(1);
    expect(after.body.total).toBe(2);
    expect(after.body.items[0].read).toBe(true);
    expect(typeof after.body.items[0].readAt).toBe('string');

    const item = g.call({
      pathname: '/feedback/item', query: new URLSearchParams({ id: 'a2-2' }), headers: withCookie(g.token),
    });
    expect(item.body.item.read).toBe(true);
    expect(typeof item.body.item.readAt).toBe('string');
  });

  it('read 接口：未登录 401、id 不存在 404、read 不是布尔 400、带路径的 id 400', () => {
    const root = tempDir();
    const g = rig(root);
    seed(g.store, 'x9-9', '2026-10-01T00:00:00.000Z', false);

    const noAuth = g.call({
      method: 'POST', pathname: '/feedback/read', body: Buffer.from(JSON.stringify({ id: 'x9-9', read: true })),
    });
    expect(noAuth.status).toBe(401);
    expect(noAuth.body).toEqual({ ok: false, error: '未登录' });

    const missing = g.call({
      method: 'POST', pathname: '/feedback/read', headers: withCookie(g.token),
      body: Buffer.from(JSON.stringify({ id: 'nope-1', read: true })),
    });
    expect(missing.status).toBe(404);
    expect(missing.body.error).toBe('找不到这条反馈');

    const badRead = g.call({
      method: 'POST', pathname: '/feedback/read', headers: withCookie(g.token),
      body: Buffer.from(JSON.stringify({ id: 'x9-9', read: 'yes' })),
    });
    expect(badRead.status).toBe(400);

    const badId = g.call({
      method: 'POST', pathname: '/feedback/read', headers: withCookie(g.token),
      body: Buffer.from(JSON.stringify({ id: '../../etc/passwd', read: true })),
    });
    expect(badId.status).toBe(400);

    const badJson = g.call({
      method: 'POST', pathname: '/feedback/read', headers: withCookie(g.token), body: Buffer.from('{oops'),
    });
    expect(badJson.status).toBe(400);
  });

  it('所有响应都带 no-store；read 接口 GET 是 405', () => {
    const root = tempDir();
    const g = rig(root);
    const listed = g.call({ headers: withCookie(g.token) });
    expect(listed.headers['cache-control']).toBe('no-store');
    const wrong = g.call({ method: 'GET', pathname: '/feedback/read', headers: withCookie(g.token) });
    expect(wrong.status).toBe(405);
  });
});

describe('追加需求：软删除', () => {
  it('删除把整个目录移进 trash/<id>-<时间戳>/，list 里消失，item / file 404', () => {
    const root = tempDir();
    const g = rig(root);
    seed(g.store, 'd1-1', '2026-10-01T00:00:00.000Z', true);
    seed(g.store, 'd2-2', '2026-10-01T01:00:00.000Z', true);

    const del = g.call({
      method: 'POST', pathname: '/feedback/delete', headers: withCookie(g.token),
      body: Buffer.from(JSON.stringify({ id: 'd2-2' })),
    });
    expect(del.status).toBe(200);
    expect(del.body).toEqual({ ok: true, id: 'd2-2' });

    // 目录真的进了 trash，不是 rm
    const trash = g.store.trashCount();
    expect(trash).toBe(1);
    expect(g.store.trashDir.startsWith(root)).toBe(true);

    // items 里没了 ⇒ list 消失、item 404、file 404
    const listed = g.call({ headers: withCookie(g.token) });
    expect(listed.body.items.map((i: { id: string }) => i.id)).toEqual(['d1-1']);
    expect(listed.body.total).toBe(1);

    const item = g.call({
      pathname: '/feedback/item', query: new URLSearchParams({ id: 'd2-2' }), headers: withCookie(g.token),
    });
    expect(item.status).toBe(404);
    const file = g.call({
      pathname: '/feedback/file',
      query: new URLSearchParams({ id: 'd2-2', name: 'log.txt' }),
      headers: withCookie(g.token),
    });
    expect(file.status).toBe(404);
  });

  it('trash 里能捞回：目录还在，meta.json 与附件都在（这就是软删除的意义）', () => {
    const root = tempDir();
    const g = rig(root);
    seed(g.store, 'e1-1', '2026-10-01T00:00:00.000Z', true);
    g.call({
      method: 'POST', pathname: '/feedback/delete', headers: withCookie(g.token),
      body: Buffer.from(JSON.stringify({ id: 'e1-1' })),
    });
    const names = readdirSync(g.store.trashDir);
    expect(names.length).toBe(1);
    expect(names[0].startsWith('e1-1-')).toBe(true);
    const files = readdirSync(`${g.store.trashDir}/${names[0]}`);
    expect(files.sort()).toEqual(['log.txt', 'meta.json']);
    const meta = JSON.parse(String(readFileSync(`${g.store.trashDir}/${names[0]}/meta.json`)));
    expect(meta.id).toBe('e1-1');
    expect(meta.body).toBe('正文');
  });

  it('delete 接口：未登录 401、id 不存在 404、带路径的 id 400 而且没动任何东西', () => {
    const root = tempDir();
    const g = rig(root);
    seed(g.store, 'f1-1', '2026-10-01T00:00:00.000Z', true);

    const noAuth = g.call({ method: 'POST', pathname: '/feedback/delete', body: Buffer.from(JSON.stringify({ id: 'f1-1' })) });
    expect(noAuth.status).toBe(401);

    const missing = g.call({
      method: 'POST', pathname: '/feedback/delete', headers: withCookie(g.token),
      body: Buffer.from(JSON.stringify({ id: 'nope-1' })),
    });
    expect(missing.status).toBe(404);
    expect(missing.body.error).toBe('找不到这条反馈');

    for (const evil of ['../../etc/passwd', '..', 'f1-1/../../x', '/etc/passwd']) {
      const r = g.call({
        method: 'POST', pathname: '/feedback/delete', headers: withCookie(g.token),
        body: Buffer.from(JSON.stringify({ id: evil })),
      });
      expect(r.status).toBe(400);
    }
    // 那一份投稿还在
    expect(g.store.readMeta('f1-1') !== null).toBe(true);
    expect(g.store.trashCount()).toBe(0);
  });
});
