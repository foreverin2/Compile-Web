/**
 * ★★ **G6/T50（B1）：中继凭据的"取 / 续 / 降级"**（`src/ui/turn-cred.ts` 的守卫）。
 *
 * 这个文件钉的是四条纪律（任务书 §1(2) 的原话）：
 *  1. **超时要有界**（2 秒级）—— 取不到凭据不许把"生成邀请码"卡死；
 *  2. **失败与超时都要有测试**；
 *  3. **到手之后按 ttl 续期**（到期前换一份新的，而不是等它失效）；
 *  4. **失败绝不写进缓存**（下一次会再试 —— 把一个瞬时的 500 记成"以后都没凭据"是错的）。
 *
 * 计时与时钟一律**注入**（本仓纪律）：`ticker` 是手动的、`clock` 是字面量 ——
 * 于是"续期了没有""超时了没有"都是可断言的行为，不靠 sleep、也不靠真实时间。
 */

import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_TURN_CRED_SETTINGS,
  TURN_CRED_RENEW_MARGIN_MS,
  createTurnCredentialStore,
  describeTurnCredentialFailure,
  type TurnCredFetchResponseLike,
  type TurnCredentialStoreEnv,
} from '../../src/ui/turn-cred';

/** 一份服务端会回的报文（字段与 `server/turn-cred/lib/handler.mjs` 的输出逐字同形） */
function body(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    urls: ['turn:8.130.97.243:3478'],
    username: '1800000000:player',
    credential: 'synthetic-not-a-real-credential=',
    ttl: 600,
    realm: 'compile-turn',
    ...over,
  };
}

function res(status: number, payload: unknown): TurnCredFetchResponseLike {
  return { ok: status >= 200 && status < 300, status, json: async () => payload };
}

/** 手动计时器：`fire()` 才让"到点"发生（于是超时可控，不用 sleep） */
function manualTicker() {
  const pending = new Map<number, () => void>();
  let next = 1;
  return {
    ticker: {
      schedule: (fn: () => void, _ms: number): number => { const h = next++; pending.set(h, fn); return h; },
      cancel: (h: number): void => { pending.delete(h); },
    },
    fire(): number {
      const fns = [...pending.values()];
      pending.clear();
      for (const fn of fns) fn();
      return fns.length;
    },
    pendingCount(): number { return pending.size; },
  };
}

/** 一个可控的时钟 */
function clockFrom(start = 1_700_000_000_000) {
  let now = start;
  return { now: () => now, advance: (ms: number) => { now += ms; } };
}

/** 造一个 store（默认"服务端正常"），连同它的记账面 */
function makeStore(over: Partial<TurnCredentialStoreEnv> = {}, settings: Record<string, unknown> = {}) {
  const mt = manualTicker();
  const clock = clockFrom();
  const calls: string[] = [];
  const { settings: _ignored, ...rest } = over;
  void _ignored;
  const env: TurnCredentialStoreEnv = {
    ticker: mt.ticker,
    clock: clock.now,
    baseUrl: () => 'https://example.invalid/compile/index.html',
    fetch: async (url) => { calls.push(url); return res(200, body()); },
    ...rest,
    // ★ 放在最后：`over` 里若也给了 `settings`（一个**函数**）会被下面这一句覆盖 ——
    //   所以那个口子只有一个：本函数的第二个参数（设置值）。
    settings: () => ({ endpoint: '/turn-cred', timeoutMs: 2_000, scope: 'player', ttlSeconds: 600, ...settings }),
  };
  return { store: createTurnCredentialStore(env), mt, clock, calls };
}

describe('G6/T50 凭据客户端：取 / 续 / 降级', () => {
  it('零参调用形态永远可用（不为注入而破坏生产调用）', () => {
    const store = createTurnCredentialStore();
    expect(typeof store.read).toBe('function');
    // 没取过 ⇒ 一份"没有凭据"的读数（**不是** null、也不抛）
    const read = store.read();
    expect(read.available).toBe(false);
    if (!read.available) expect(['unreachable', 'timeout', 'rejected', 'malformed']).toContain(read.reason);
  });

  it('默认设置：同源 `/turn-cred`、2 秒上界、scope=player', () => {
    expect(DEFAULT_TURN_CRED_SETTINGS.endpoint).toBe('/turn-cred');
    expect(DEFAULT_TURN_CRED_SETTINGS.timeoutMs).toBe(2_000);
    expect(DEFAULT_TURN_CRED_SETTINGS.scope).toBe('player');
  });

  it('取到手：URL 带上 ttl 与 scope（相对路径补成绝对地址）；read() 同步给出凭据', async () => {
    const { store, calls } = makeStore();
    const read = await store.refresh();
    expect(read.available).toBe(true);
    if (read.available) {
      expect(read.source).toBe('app');
      expect(read.credential.username).toBe('1800000000:player');
      expect(read.credential.ttlSeconds).toBe(600);
      expect(read.credential.urls).toEqual(['turn:8.130.97.243:3478']);
    }
    /**
     * ⚠️ 期望值是 `https://example.invalid/turn-cred…`（不是 `…/compile/turn-cred`）：
     * 端点 `/turn-cred` 是**以斜杠开头的绝对路径**，`new URL(path, base)` 按规范会丢掉 base 的
     * 目录部分。这正是我们想要的（runbook 里 nginx 就是把**站根**的 `/turn-cred` 反代出去）。
     */
    expect(calls).toEqual(['https://example.invalid/turn-cred?ttl=600&scope=player']);
    expect(store.read().available).toBe(true);
    expect(store.stats()).toEqual({ attempts: 1, issued: 1, servedFromCache: 0 });
  });

  it('缓存期间不重复请求；到期前（ttl - 10 秒）续一份新的', async () => {
    let n = 0;
    const { store, clock, calls } = makeStore({
      fetch: async (url) => {
        calls.push(url);
        n += 1;
        return res(200, body({ username: `18000000${String(n).padStart(2, '0')}:player`, credential: `cred-${String(n)}` }));
      },
    });
    await store.refresh();
    expect(calls.length).toBe(1);
    // 还在有效期内：refresh 直接复用缓存，不再发请求
    clock.advance(600_000 - TURN_CRED_RENEW_MARGIN_MS - 1_000);
    expect((await store.refresh()).available).toBe(true);
    expect(calls.length, '还没到续期点就又发了一次请求').toBe(1);
    expect(store.stats().servedFromCache).toBe(1);
    // 越过续期点：换一份新的
    clock.advance(2_000);
    const renewed = await store.refresh();
    expect(calls.length, '到了续期点却没有换新的').toBe(2);
    expect(renewed.available).toBe(true);
    if (renewed.available) expect(renewed.credential.credential).toBe('cred-2');
  });

  it('★ 超时有界：服务端不回 ⇒ `timeout`，而且计时器真的响过（不是永久挂着）', async () => {
    const never = new Promise<TurnCredFetchResponseLike>(() => { /* 永远不 settle */ });
    const { store, mt } = makeStore({ fetch: () => never }, { timeoutMs: 2_000 });
    const p = store.refresh();
    const settled = vi.fn();
    void p.then(settled);
    await Promise.resolve();
    expect(settled, '计时器还没到点就结算了').not.toHaveBeenCalled();
    expect(mt.pendingCount(), '没有排下超时计时器（那就是无上界的等待）').toBe(1);
    mt.fire();
    const read = await p;
    expect(read.available).toBe(false);
    if (!read.available) {
      expect(read.reason).toBe('timeout');
      expect(read.detail).toContain('2000');
    }
    expect(store.lastFailure()?.reason).toBe('timeout');
  });

  it('失败不写缓存：一次 rejected 之后**下一次**会真的再试（而且真的成功了）', async () => {
    let n = 0;
    const { store, calls } = makeStore({
      fetch: async (url) => {
        calls.push(url);
        n += 1;
        return n === 1 ? res(429, { ok: false, error: 'rate-limited', message: '太快了' }) : res(200, body());
      },
    });
    const first = await store.refresh();
    expect(first.available).toBe(false);
    if (!first.available) {
      expect(first.reason).toBe('rejected');
      expect(first.detail).toBe('HTTP 429');
    }
    expect(store.lastFailure()?.detail).toBe('HTTP 429');
    // ★ 关键：失败的**不**进缓存 ⇒ 下一次真的再发一次
    const second = await store.refresh();
    expect(calls.length).toBe(2);
    expect(second.available).toBe(true);
    expect(store.lastFailure()).toBeNull();
    expect(store.stats()).toEqual({ attempts: 2, issued: 1, servedFromCache: 0 });
  });

  it('四种失败各有各的名字：rejected / malformed / unreachable（timeout 见上一条）', async () => {
    const cases: { name: string; env: Partial<TurnCredentialStoreEnv>; reason: string }[] = [
      { name: 'HTTP 500', env: { fetch: async () => res(500, {}) }, reason: 'rejected' },
      { name: '不是 JSON', env: { fetch: async () => ({ ok: true, status: 200, json: async () => { throw new Error('bad json'); } }) }, reason: 'malformed' },
      { name: '缺字段', env: { fetch: async () => res(200, { urls: ['turn:x:1'] }) }, reason: 'malformed' },
      { name: 'urls 里没有 turn:', env: { fetch: async () => res(200, body({ urls: ['stun:x:3478'] })) }, reason: 'malformed' },
      { name: 'ttl 不是正数', env: { fetch: async () => res(200, body({ ttl: 0 })) }, reason: 'malformed' },
      { name: '连不上', env: { fetch: async () => { throw new TypeError('Failed to fetch'); } }, reason: 'unreachable' },
    ];
    for (const c of cases) {
      const { store } = makeStore(c.env);
      const read = await store.refresh();
      expect(read.available, `${c.name} 竟然被判成"有凭据"`).toBe(false);
      if (!read.available) expect(read.reason, `${c.name} 的原因不对`).toBe(c.reason);
    }
  });

  it('并发调用搭同一趟车（只发一次请求）', async () => {
    let calls = 0;
    const gate: { open: () => void } = { open: () => {} };
    const waiting = new Promise<void>((resolve) => { gate.open = resolve; });
    const { store } = makeStore({ fetch: async () => { calls += 1; await waiting; return res(200, body()); } });
    const a = store.refresh();
    const b = store.refresh();
    gate.open();
    const [ra, rb] = await Promise.all([a, b]);
    expect(calls, '并发调用发了不止一次请求（白耗限流额度）').toBe(1);
    expect(ra.available).toBe(true);
    expect(rb.available).toBe(true);
    expect(store.read().available).toBe(true);
  });

  it('abort 信号工厂被调过（真实现里 = `AbortSignal.timeout(上界)`）', async () => {
    const seen: number[] = [];
    const { store } = makeStore({
      abortSignal: (ms) => { seen.push(ms); return { aborted: false }; },
      fetch: async () => { throw new Error('aborted'); },
    });
    await store.refresh();
    expect(seen).toEqual([2_000]);
  });

  it('失败原因都能翻成玩家能懂的一句（屏上那句"没有中继可用"的一半）', () => {
    for (const r of ['timeout', 'rejected', 'unreachable', 'malformed'] as const) {
      const text = describeTurnCredentialFailure(r);
      expect(text.length, `${r} 没有可读的说法`).toBeGreaterThan(3);
      expect(text.includes('fetch'), `"${text}" 里有内部术语`).toBe(false);
    }
    expect(describeTurnCredentialFailure('timeout')).toContain('没有及时回应');
  });
});
