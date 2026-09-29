/**
 * 签发服务的单测（`npx vitest run`；服务本身零依赖、只用 Node 内置模块）。
 *
 * ## 判据 1 的"独立读数"怎么落地的（**本文件最重要的一条纪律**）
 *
 * `credentialOf` 的实现用的是 Node 的 `crypto.createHmac('sha1', …)`。如果测试也用它算一遍
 * 再跟自己比，那条腿就是**同义反复**（自算自验）。所以：
 *  - `server/turn-cred/reference-vectors.json` 由 **Python**（CPython 的 `hmac` + `hashlib`，
 *    另一份独立实现）经同目录的 `make-reference-vectors.py` 算出并提交进仓；本文件只**读**它、**比**它；
 *  - 其中 6 组是 **RFC 2202 的公开测试向量**（第三方原文，可外部复核），
 *    验证的正是"HMAC-SHA1 这条算式本身"；
 *  - 另外 4 组是本服务真的会签的 `expiry:scope` 形状，验证"我们拼 username 的方式"。
 *
 * 换句话说：这里比的是**两个独立实现的结果**，不是"我自己算的和我自己算的"。
 *
 * ## 怎么跑
 *
 * `npx vitest run server/turn-cred/tests/cred.test.ts`
 *
 * 它**不在默认门禁的扫描面**里（`vite.config.ts` 的 include 是 `tests/**\/*.test.ts`）——
 * 这一点是**故意的**：服务与前端是两套运行环境，把它塞进前端门禁会让"门禁数字"变成两件事混在一起。
 * 报告里这一条单独给读数。零依赖说的是**服务本身**（`server/turn-cred/**` 只 import `node:…`）。
 */

import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { credentialOf, expiryOf, issueCredential, usernameOf } from '../lib/cred.mjs';
import { loadConfig, readSecret, DEFAULT_TURN_URLS } from '../lib/config.mjs';
import { DenyList, RateLimiter } from '../lib/rate-limit.mjs';
import { Logger, credentialFingerprint } from '../lib/log.mjs';
import { clientIpOf, handleRequest, normalizeIp } from '../lib/handler.mjs';

const REF = JSON.parse(
  readFileSync(new URL('../reference-vectors.json', import.meta.url), 'utf8'),
) as {
  python: string;
  rfc2202: { case: number; keyHex: string; msgHex: string; macHex: string; macBase64: string }[];
  service: { secret: string; expiry: number; scope: string; username: string; credential: string }[];
  sensitivity: { lastByteOfMessage: boolean; oneByteOfKey: boolean };
};

/** 一个不写文件、只收行的 Logger（单测用它，别往真盘上写） */
function memLogger(): { logger: Logger; lines: string[] } {
  const lines: string[] = [];
  return { logger: new Logger({ file: null, sink: (l) => lines.push(l) }), lines };
}

type Cfg = ReturnType<typeof cfg>;
/** 一份最小配置（`loadConfig` 的输出形状；值都很小，便于构造"到限"） */
function cfg(over: Record<string, unknown> = {}) {
  return {
    secret: 'unit-secret',
    secretSource: 'test',
    realm: 'compile-turn',
    urls: [...DEFAULT_TURN_URLS],
    ttlSeconds: 600,
    ttlMaxSeconds: 900,
    ttlMinSeconds: 60,
    perIpPerMinute: 3,
    perIpConcurrent: 2,
    bindHost: '127.0.0.1',
    port: 0,
    denyFile: null as string | null,
    allowOrigin: '*',
    logFile: null as string | null,
    logMaxBytes: 1024,
    trustProxy: false,
    ...over,
  };
}

/** 打一次请求（走真的 `handleRequest`，只是不经过 socket） */
function call(c: Cfg, over: Record<string, unknown> = {}) {
  const { logger, lines } = memLogger();
  const limiter = (over.limiter as RateLimiter | undefined) ?? new RateLimiter({
    perMinute: c.perIpPerMinute, concurrent: c.perIpConcurrent, ttlSeconds: c.ttlSeconds,
  });
  const deny = (over.deny as DenyList | undefined) ?? new DenyList(c.denyFile);
  const out = handleRequest({
    method: 'GET',
    pathname: '/turn-cred',
    query: new URLSearchParams(),
    clientIp: '203.0.113.7',
    nowMs: 1_700_000_000_000,
    config: c as never,
    limiter,
    deny,
    logger,
    ...over,
  } as never);
  return { out: out as { status: number; headers: Record<string, string>; body: Record<string, unknown> }, lines, limiter, deny };
}

/* ───────────────────────── 判据 1：独立参考向量 ───────────────────────── */

describe('判据 1：HMAC 与用户名格式对**独立算出来的**参考向量', () => {
  it('HMAC-SHA1 与 RFC 2202 的公开向量逐字相同（独立实现的读数）', () => {
    expect(REF.rfc2202.length, '参考向量条数变了（人工复核一次）').toBe(6);
    for (const v of REF.rfc2202) {
      expect(v.macHex.length).toBe(40);
    }
    /**
     * ⚠️ 参考向量里的键/消息是**字节**（十六进制给出），case 3/4 的键里就有 >0x7f 的字节
     * ⇒ 必须用 `Buffer` 逐字节喂进去，**不许** `toString('latin1')` 再当文本传：那样每个字节
     * 先被当作 Unicode 码点、再按 UTF-8 编回去，算出来会是别的东西（本测试第一版就是这么红的）。
     */
    for (const v of REF.rfc2202) {
      const key = Buffer.from(v.keyHex, 'hex');
      const msg = Buffer.from(v.msgHex, 'hex');
      expect(credentialOf(key as never, msg as never), `RFC 2202 case ${v.case} 的 HMAC 与参考向量不一致`)
        .toBe(v.macBase64);
    }
  });

  it('服务会签的 `expiry:scope` 形状与 Python 算出的参考向量逐字相同', () => {
    expect(REF.service.length, '服务向量条数变了（人工复核一次）').toBe(4);
    for (const v of REF.service) {
      const username = usernameOf(v.expiry, v.scope);
      expect(username, 'username 的拼法与参考向量不一致').toBe(v.username);
      expect(credentialOf(v.secret, username), `${v.username} 的凭据与 Python 参考向量不一致`)
        .toBe(v.credential);
    }
  });

  it('参考向量对输入敏感（否则上面两条是恒真）', () => {
    expect(REF.sensitivity.lastByteOfMessage).toBe(true);
    expect(REF.sensitivity.oneByteOfKey).toBe(true);
    const v = REF.service[0];
    expect(credentialOf(v.secret, `${v.username}X`)).not.toBe(v.credential);
    expect(credentialOf(`${v.secret}X`, v.username)).not.toBe(v.credential);
    // ★ 正控（本文件自己的算式）：同一个输入两次必须同值，否则"逐字相同"这条腿会让所有输入都过
    expect(credentialOf(v.secret, v.username)).toBe(credentialOf(v.secret, v.username));
  });

  it('username 的格式：`<expiryUnix>:<scope>`，scope 里不许有冒号，expiry 必须是正整数秒', () => {
    expect(usernameOf(1_700_000_000, 'player')).toBe('1700000000:player');
    expect(() => usernameOf(1_700_000_000, '')).toThrow(/scope/);
    expect(() => usernameOf(1_700_000_000, 'a:b')).toThrow(/scope/);
    expect(() => usernameOf(0, 'player')).toThrow(/expiry/);
    expect(() => usernameOf(1.5, 'player')).toThrow(/expiry/);
  });

  it('expiry = now + ttl（用注入的 now 钉住，不读真实时钟）', () => {
    expect(expiryOf(1_700_000_000_000, 600)).toBe(1_700_000_600);
    expect(expiryOf(1_700_000_000_999, 60)).toBe(1_700_000_060);
    const issued = issueCredential({ secret: 's', scope: 'player', ttlSeconds: 300, nowMs: 1_700_000_000_000 });
    expect(issued.username).toBe('1700000300:player');
    expect(issued.credential).toBe(credentialOf('s', '1700000300:player'));
  });
});

/* ───────────────────────── 接口面：/healthz 与 /turn-cred ───────────────────────── */

describe('接口面', () => {
  it('健康检查：`GET /healthz` 回 200 且带 realm / urls / 限流参数', () => {
    const { out } = call(cfg(), { pathname: '/healthz' });
    expect(out.status).toBe(200);
    expect(out.body.ok).toBe(true);
    expect(out.body.realm).toBe('compile-turn');
    expect(out.body.urls).toEqual([...DEFAULT_TURN_URLS]);
    expect(out.body.perIpPerMinute).toBe(3);
    expect(out.headers['cache-control']).toBe('no-store');
  });

  it('`GET /turn-cred` 回 200 且形状就是 `{urls,username,credential,ttl}`', () => {
    const c = cfg();
    const { out, lines } = call(c);
    expect(out.status).toBe(200);
    expect(Object.keys(out.body).sort()).toEqual(['credential', 'realm', 'ttl', 'urls', 'username'].sort());
    expect(out.body.urls).toEqual(['turn:8.130.97.243:3478']);
    expect(out.body.ttl).toBe(600);
    expect(out.body.realm).toBe('compile-turn');
    const username = String(out.body.username);
    const [expiry, scope] = username.split(':');
    expect(Number(expiry)).toBe(expiryOf(1_700_000_000_000, 600));
    expect(scope).toBe('player');
    expect(out.body.credential).toBe(credentialOf(c.secret, username));
    // 日志：只写指纹，**绝不**写 credential 原文
    const issued = lines.find((l) => l.includes('result=issued'));
    expect(issued, '没有写 issued 日志').toBeDefined();
    expect(String(issued).includes(String(out.body.credential)), '日志里出现了完整凭据（绝对不许）').toBe(false);
    expect(String(issued).includes(`credFp=${credentialFingerprint(String(out.body.credential))}`)).toBe(true);
  });

  it('未知路径 ⇒ 404；非 GET ⇒ 405；**OPTIONS 预检** ⇒ 204 + CORS 头（同一件事的另一半）', () => {
    const a = call(cfg(), { pathname: '/nope' });
    expect(a.out.status).toBe(404);
    expect(a.out.body.error).toBe('not-found');
    const b = call(cfg(), { method: 'POST' });
    expect(b.out.status).toBe(405);
    expect(b.out.headers.allow).toBe('GET, HEAD, OPTIONS');
    /**
     * ★★ **T50 实测补的一条**：跨源时浏览器先发 `OPTIONS` 预检，不答它真实请求根本不会发出去
     * （页面侧只看到 `TypeError: Failed to fetch`，与"服务挂了"长得一样 —— 第一次跑真浏览器门
     * 就是这么红的）。生产推荐仍是同源反代（那条路上没有预检），这里只是让跨源这条备选路能用。
     */
    const pre = call(cfg(), { method: 'OPTIONS' });
    expect(pre.out.status).toBe(204);
    expect(pre.out.headers['access-control-allow-origin']).toBe('*');
    expect(pre.out.headers['access-control-allow-methods']).toContain('GET');
    // 正常响应也要带 CORS 头（否则预检过了、真响应又被浏览器拦）
    expect(call(cfg()).out.headers['access-control-allow-origin']).toBe('*');
    // 可收紧：配了 `TURN_CRED_ALLOW_ORIGIN` 就照它回
    const tight = loadConfig({ TURN_CRED_SECRET: 's', TURN_CRED_ALLOW_ORIGIN: 'https://play.example' } as never);
    expect(tight.config.allowOrigin).toBe('https://play.example');
    expect(call(cfg({ allowOrigin: 'https://play.example' })).out.headers['access-control-allow-origin'])
      .toBe('https://play.example');
  });

  it('ttl 封顶：要 100000 ⇒ 只给封顶值，日志记 `ttl-capped`；要 120 ⇒ 给 120', () => {
    const c = cfg({ ttlMaxSeconds: 900, ttlSeconds: 600 });
    const big = call(c, { query: new URLSearchParams('ttl=100000') });
    expect(big.out.status).toBe(200);
    expect(big.out.body.ttl).toBe(900);
    expect(big.lines.some((l) => l.includes('result=ttl-capped'))).toBe(true);
    const small = call(c, { query: new URLSearchParams('ttl=120') });
    expect(small.out.body.ttl).toBe(120);
    const bad = call(c, { query: new URLSearchParams('ttl=abc') });
    expect(bad.out.status).toBe(400);
    expect(bad.out.body.error).toBe('bad-ttl');
  });

  /**
   * ★★ **T50 评审（P0）抓到的功能缺口**：`?ttl=` 只有上限、**下限从来没生效过**
   * （`ttlMinSeconds` 全仓没有消费者）⇒ 评审实测 `?ttl=1` 原样回 1：一份一秒就过期、ICE 都还没收完的
   * 凭据，而它照样占用那个 IP 的并发额度。
   *
   * 这条腿**能假**：把那句 `Math.max(n, config.ttlMinSeconds)` 去掉 ⇒ `1/10/30/59` 全都会原样返回 ⇒ 红。
   * 四个请求覆盖 1/10/30/59 与边界两侧（59 夹、60 不夹）。
   */
  it('★ ttl 下限：要 1/10/30/59 ⇒ 一律夹到下限（60），日志记 `ttl-clamped`', () => {
    const c = cfg({ ttlMinSeconds: 60, ttlSeconds: 600, ttlMaxSeconds: 900 });
    for (const asked of [1, 10, 30, 59]) {
      const r = call(c, { query: new URLSearchParams(`ttl=${String(asked)}`) });
      expect(r.out.status, `?ttl=${String(asked)} 被拒了（下限应当是"夹"而不是"拒"）`).toBe(200);
      expect(r.out.body.ttl, `?ttl=${String(asked)} 没有夹到下限 60`).toBe(60);
      expect(r.lines.some((l) => l.includes('result=ttl-clamped')), `?ttl=${String(asked)} 没记 ttl-clamped`).toBe(true);
      // 夹过之后签出去的过期时间也必须按 60 算（不是按请求值）
      const username = String(r.out.body.username);
      const expiry = Number(username.split(':')[0]);
      expect(expiry - expiryOf(1_700_000_000_000, 0), `?ttl=${String(asked)} 的 expiry 没按夹后的 ttl 算`).toBe(60);
    }
    // 边界：刚好等于下限 ⇒ 原样（不是夹），也不记 clamped；区间内的 120 也不许被夹
    const atMin = call(c, { query: new URLSearchParams('ttl=60') });
    expect(atMin.out.body.ttl).toBe(60);
    expect(atMin.lines.some((l) => l.includes('result=ttl-clamped')), '刚好等于下限时不该记 clamped').toBe(false);
    expect(call(c, { query: new URLSearchParams('ttl=120') }).out.body.ttl).toBe(120);
  });

  it('scope：默认 player；非法 scope ⇒ 400（不许让它进 username）', () => {
    const ok = call(cfg(), { query: new URLSearchParams('scope=host-2') });
    expect(ok.out.status).toBe(200);
    expect(String(ok.out.body.username).split(':')[1]).toBe('host-2');
    const bad = call(cfg(), { query: new URLSearchParams('scope=a:b') });
    expect(bad.out.status).toBe(400);
    expect(bad.out.body.error).toBe('bad-scope');
  });
});

/* ───────────────────────── 判据 4：限流与封禁真的开火 ───────────────────────── */

describe('判据 4：限流与封禁', () => {
  it('按 IP 每分钟次数 ⇒ 第 N+1 次是 429，报文可读；窗口滑过去之后恢复', () => {
    const c = cfg({ perIpPerMinute: 3, perIpConcurrent: 10 });
    const first = call(c);
    expect(first.out.status).toBe(200);
    const limiter = first.limiter;
    for (let i = 1; i < 3; i += 1) {
      expect(call(c, { limiter }).out.status, `第 ${i + 1} 次就被拒了（上限是 3）`).toBe(200);
    }
    const over = call(c, { limiter });
    expect(over.out.status, '到限之后没有回 429').toBe(429);
    expect(over.out.body.error).toBe('rate-limited');
    expect(over.out.body.limit).toBe(3);
    expect(over.out.headers['retry-after']).toBe('60');
    expect(String(over.out.body.message).length, '429 报文不可读').toBeGreaterThan(10);
    expect(over.lines.some((l) => l.includes('result=rate-limited:rate'))).toBe(true);
    // ★ 正向对照：**加一个不同 IP 的调用者**仍然拿得到（限流是按 IP 的，不是全局）
    expect(call(c, { limiter, clientIp: '203.0.113.8' }).out.status, '另一个 IP 也被拒了（那是全局限流）').toBe(200);
    // ★ 恢复：窗口（60 秒）滑过去之后同一个 IP 又能取
    expect(call(c, { limiter, nowMs: 1_700_000_000_000 + 61_000 }).out.status, '窗口滑过去之后没有恢复').toBe(200);
  });

  it('并发有效凭据上限 ⇒ 到限回 429，凭据过期之后恢复', () => {
    const c = cfg({ perIpPerMinute: 100, perIpConcurrent: 2 });
    const first = call(c);
    expect(first.out.status).toBe(200);
    const limiter = first.limiter;
    expect(call(c, { limiter, nowMs: 1_700_000_000_000 + 1_000 }).out.status).toBe(200);
    const third = call(c, { limiter, nowMs: 1_700_000_000_000 + 2_000 });
    expect(third.out.status, '并发上限 2 却没有拒第三次').toBe(429);
    expect(third.out.body.error).toBe('too-many-credentials');
    expect(String(third.out.body.message).includes('2'), '报文里没写清上限/已用').toBe(true);
    // 前两份凭据的 expiry 都是 now+600 ⇒ 601 秒之后它们都过期了
    expect(call(c, { limiter, nowMs: 1_700_000_000_000 + 601_000 }).out.status, '旧凭据过期之后没有恢复').toBe(200);
  });

  it('deny 列表里加一个 IP ⇒ 它立刻被拒（403，且日志记 denied）；热加载与后缀通配都生效', () => {
    const dir = mkdtempSync(join(tmpdir(), 'turn-cred-deny-'));
    try {
      const file = join(dir, 'deny.txt');
      writeFileSync(file, '# 注释行\n198.51.100.9\n', 'utf8');
      const deny = new DenyList(file);
      deny.refresh(1_700_000_000_000, true);
      const blocked = call(cfg({ denyFile: file }), { deny, clientIp: '198.51.100.9' });
      expect(blocked.out.status).toBe(403);
      expect(blocked.out.body.error).toBe('denied');
      expect(blocked.lines.some((l) => l.includes('result=denied'))).toBe(true);
      // 正向对照：不在清单里的 IP 照旧能取
      expect(call(cfg({ denyFile: file }), { deny, clientIp: '198.51.100.10' }).out.status).toBe(200);
      // ★ 热加载：文件加一行，5 秒节流过后立刻生效
      writeFileSync(file, '198.51.100.9\n198.51.100.10\n', 'utf8');
      deny.refresh(1_700_000_000_000 + 6_000);
      expect(
        call(cfg({ denyFile: file }), { deny, clientIp: '198.51.100.10', nowMs: 1_700_000_000_000 + 6_000 }).out.status,
        'deny 文件改了之后没有热加载生效',
      ).toBe(403);
      // 后缀通配：挡整段
      writeFileSync(file, '203.0.113.\n', 'utf8');
      deny.refresh(1_700_000_000_000 + 12_000);
      expect(deny.has('203.0.113.77')).toBe(true);
      expect(deny.has('203.0.114.77')).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('deny 文件坏了 / 没了 ⇒ 服务不挂，保留上一次的清单并记 problems', () => {
    const dir = mkdtempSync(join(tmpdir(), 'turn-cred-deny2-'));
    try {
      const file = join(dir, 'deny.txt');
      writeFileSync(file, '198.51.100.9\n', 'utf8');
      const deny = new DenyList(file);
      deny.refresh(1_700_000_000_000, true);
      expect(deny.has('198.51.100.9')).toBe(true);
      rmSync(file, { force: true });
      deny.refresh(1_700_000_000_000 + 10_000);
      expect(deny.problems.length, '读坏了却没记问题').toBe(1);
      expect(deny.has('198.51.100.9'), '读坏了之后把旧清单丢了（那等于把所有被封的 IP 放出来）').toBe(true);
      // 服务照旧能给别的 IP 签发
      expect(
        call(cfg({ denyFile: file }), { deny, clientIp: '198.51.100.11', nowMs: 1_700_000_000_000 + 10_000 }).out.status,
      ).toBe(200);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

/* ───────────────────────── 配置：fail fast 与密钥来源 ───────────────────────── */

describe('配置与密钥', () => {
  it('缺密钥 ⇒ `loadConfig` 不 ok（`server.mjs` 据此拒绝启动）', () => {
    const none = loadConfig({} as never);
    expect(none.ok).toBe(false);
    expect(none.problems.some((p) => p.includes('没有密钥')), `问题清单里没有"缺密钥"：${none.problems.join('|')}`)
      .toBe(true);
    expect(loadConfig({ TURN_CRED_SECRET: '   ' } as never).ok).toBe(false);
  });

  it('密钥来源：文件优先于内联；文件读不到要如实报错（不是静默无密钥）', () => {
    const dir = mkdtempSync(join(tmpdir(), 'turn-cred-secret-'));
    try {
      const file = join(dir, 'secret');
      writeFileSync(file, '  file-secret\n', 'utf8');
      expect(readSecret({ TURN_CRED_SECRET: 'inline', TURN_CRED_SECRET_FILE: file } as never))
        .toEqual({ secret: 'file-secret', source: `file:${file}` });
      expect(readSecret({ TURN_CRED_SECRET: 'inline' } as never))
        .toEqual({ secret: 'inline', source: 'env:TURN_CRED_SECRET' });
      const missing = readSecret({ TURN_CRED_SECRET_FILE: join(dir, 'nope') } as never) as { secret: string; error?: string };
      expect(missing.secret).toBe('');
      expect(typeof missing.error === 'string' && missing.error.length > 0, '文件读不到却没报错').toBe(true);
      const loaded = loadConfig({ TURN_CRED_SECRET_FILE: join(dir, 'nope') } as never);
      expect(loaded.ok).toBe(false);
      expect(loaded.problems.some((p) => p.includes('读密钥文件失败'))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('配置缺省值：realm=compile-turn、urls 就是那台 coturn、限额有值且能被环境变量改', () => {
    const d = loadConfig({ TURN_CRED_SECRET: 's' } as never);
    expect(d.ok).toBe(true);
    expect(d.config.realm).toBe('compile-turn');
    expect([...d.config.urls]).toEqual(['turn:8.130.97.243:3478']);
    expect(d.config.ttlSeconds).toBe(600);
    expect(d.config.ttlMaxSeconds).toBe(900);
    expect(d.config.perIpPerMinute).toBe(10);
    expect(d.config.perIpConcurrent).toBe(3);
    expect(d.config.trustProxy).toBe(false);
    const tuned = loadConfig({
      TURN_CRED_SECRET: 's', TURN_CRED_PER_IP_PER_MINUTE: '25', TURN_CRED_PER_IP_CONCURRENT: '6',
      TURN_CRED_TTL: '120', TURN_URLS: 'turn:10.0.0.1:3479, turn:10.0.0.1:5349', TURN_CRED_REALM: 'x',
    } as never);
    expect(tuned.ok).toBe(true);
    expect(tuned.config.perIpPerMinute).toBe(25);
    expect(tuned.config.perIpConcurrent).toBe(6);
    expect(tuned.config.ttlSeconds).toBe(120);
    expect([...tuned.config.urls]).toEqual(['turn:10.0.0.1:3479', 'turn:10.0.0.1:5349']);
    expect(tuned.config.realm).toBe('x');
    // 垃圾值 ⇒ 用缺省 + 一条 note（不静默、也不崩）
    const junk = loadConfig({ TURN_CRED_SECRET: 's', TURN_CRED_PER_IP_PER_MINUTE: 'abc' } as never);
    expect(junk.config.perIpPerMinute).toBe(10);
    expect(junk.notes.some((n) => n.includes('TURN_CRED_PER_IP_PER_MINUTE'))).toBe(true);
  });

  it('客户端 IP：默认不信任何请求头；打开 trustProxy 取**最后一跳**；IPv4 映射写法归一', () => {
    const headers = { 'x-forwarded-for': '1.2.3.4, 203.0.113.7', 'x-real-ip': '9.9.9.9' };
    expect(clientIpOf(headers, '10.0.0.5', false), '默认竟然信了请求头').toBe('10.0.0.5');
    expect(clientIpOf(headers, '10.0.0.5', true), '没有取最后一跳').toBe('203.0.113.7');
    expect(clientIpOf({ 'x-real-ip': '9.9.9.9' }, '10.0.0.5', true)).toBe('9.9.9.9');
    expect(clientIpOf({}, '::ffff:127.0.0.1', false)).toBe('127.0.0.1');
    expect(normalizeIp('::ffff:203.0.113.7')).toBe('203.0.113.7');
  });
});

/* ───────────────────────── 日志：只记指纹、按大小轮转 ───────────────────────── */

describe('日志', () => {
  it('超过上限就把当前文件改名成 `.1` 再开新文件', () => {
    const dir = mkdtempSync(join(tmpdir(), 'turn-cred-log-'));
    try {
      const file = join(dir, 'turn-cred.log');
      let rotations = 0;
      const logger = new Logger({ file, sink: () => {}, maxBytes: 200, onRotate: () => { rotations += 1; } });
      for (let i = 0; i < 20; i += 1) logger.line('info', { ip: '203.0.113.7', result: 'issued', scope: 'player', n: i });
      expect(rotations, '写了 20 行都没轮转（上限 200 字节）').toBeGreaterThanOrEqual(1);
      expect(readFileSync(`${file}.1`, 'utf8').includes('ts='), '轮转出来的文件不是日志内容').toBe(true);
      expect(readFileSync(file, 'utf8').length).toBeLessThanOrEqual(400);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('字段里的换行/空格被清掉（不许往日志里塞假行）', () => {
    const { logger, lines } = memLogger();
    logger.line('info', { ip: '203.0.113.7\nevil=1', result: 'issued', scope: 'a b' });
    expect(lines.length).toBe(1);
    expect(lines[0].includes('\n')).toBe(false);
    expect(lines[0].includes('scope=a_b')).toBe(true);
  });

  it('凭据指纹是 8 位十六进制且**不可**由指纹还原原文', () => {
    const fp = credentialFingerprint('VJnIpEwqx6Awmonm88SE+nqHaFc=');
    expect(fp).toMatch(/^[0-9a-f]{8}$/);
    expect(fp.includes('VJnIp')).toBe(false);
    expect(fp).not.toBe(credentialFingerprint('VJnIpEwqx6Awmonm88SE+nqHaFcX'));
  });
});
