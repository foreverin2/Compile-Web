/**
 * ★ 2026-10-02（P3 第七批）：**`src/ui/turn-cred.ts` 那 7 条裸中文的英文帧**。
 *
 * ## 这一批修的是什么（玩家能看见的那一条）
 *
 * 前 4 条（`turn-cred.reason.*`）是 `net-browser.ts` 的 `relayUnavailableNoteOf` 拼那句
 * "这一轮没有中继可用…"时用的 `{why}`。抽取之前，英文界面下这一句是
 * `No relay is available this round（凭据服务没有及时回应）, …` —— **英文里夹一段中文**。
 * 台账 `docs/2026-10-01-i18n-尚未抽取的屏.md` 的 G.3 第 1 条把它记成"已知边界"，并写明
 * "哪天 `turn-cred.ts` 抽了，`net-browser-en.test.ts` 那条正面断言会红"。本轮它真的红了。
 *
 * ## 判据（三条，都不是"恒真"形态）
 *
 *  1. **英文下逐字等于英文表**（每条路径都真跑一遍产出函数/真 store 取回来的串）；
 *  2. **英文下零汉字**；
 *  3. **切回中文逐字等于改动前的原文** —— 这里的原文是**冻结值**（抽取前 `git show HEAD:` 里
 *     那一行），不是"从表里再抄一遍"，所以"搬的时候改了一个字"会被抓住。
 *     逐字守恒的机检版本在 `.superpowers/i18n-turn-cred/check-verbatim.mjs`。
 *
 * ## 覆盖面与边界
 *
 *  - 前 4 条（原因那半句）逐条覆盖，并且用**真 store** 把 `timeout` / `malformed` 两条
 *    `detail` 路径真跑一遍；
 *  - `turn-cred.error.no-fetch`（`defaultFetch` 的 reject 消息）**只有表级判据**：那条路要求
 *    `globalThis.fetch` 不存在，而 node 下它一定在；本仓对"测试里替换 `globalThis`"有明确
 *    的纪律（`createTurnCredentialStore` 的注入缝就是为它而设，而 `defaultFetch` 没有注入缝）
 *    ⇒ 不为了这条腿去动全局对象。它的"值 = 原文"由那份机检脚本承担。
 *  - 合并起来的那整句（`net-browser.relay.unavailable-why`，含那对全角括号）由
 *    `tests/i18n/net-browser-en.test.ts` 的 relay 那条腿逐字 + 零汉字钉着。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { setLang, t } from '../../src/i18n';
import { ZH } from '../../src/i18n/zh';
import { EN } from '../../src/i18n/en';
import {
  createTurnCredentialStore,
  describeTurnCredentialFailure,
  type TurnCredFetchResponseLike,
  type TurnCredentialFailure,
} from '../../src/ui/turn-cred';

afterEach(() => { setLang('zh'); });

/** 抽取前 `src/ui/turn-cred.ts` 里的原文（**冻结值**：手写在这里，不从表里读） */
const FROZEN_ZH: Readonly<Record<string, string>> = {
  'turn-cred.reason.timeout': '凭据服务没有及时回应',
  'turn-cred.reason.rejected': '凭据服务拒绝了这次请求',
  'turn-cred.reason.malformed': '凭据服务回的格式读不懂',
  'turn-cred.reason.unreachable': '凭据服务连不上',
  'turn-cred.detail.timeout': '等了 {ms} 毫秒没有回应',
  'turn-cred.detail.malformed': '回应里缺字段或字段形状不对',
  'turn-cred.error.no-fetch': '这台设备没有 fetch 能力',
};

/** 手动计时器（与 `tests/ui/turn-cred.test.ts` 同款：`fire()` 才让"到点"发生） */
function manualTicker(): { ticker: { schedule(fn: () => void, ms: number): number; cancel(h: number): void }; fire(): number } {
  const pending = new Map<number, () => void>();
  let next = 1;
  return {
    ticker: {
      schedule: (fn, _ms) => { const h = next++; pending.set(h, fn); return h; },
      cancel: (h) => { pending.delete(h); },
    },
    fire(): number {
      const fns = [...pending.values()];
      pending.clear();
      for (const fn of fns) fn();
      return fns.length;
    },
  };
}

function res(status: number, payload: unknown): TurnCredFetchResponseLike {
  return { ok: status >= 200 && status < 300, status, json: async () => payload };
}

/** 造一个 store（与 `tests/ui/turn-cred.test.ts` 的 `makeStore` 同形，只留这条腿要的那几格） */
function makeStore(fetchImpl: (url: string) => Promise<TurnCredFetchResponseLike>) {
  const mt = manualTicker();
  return {
    mt,
    store: createTurnCredentialStore({
      ticker: mt.ticker,
      clock: () => 1_700_000_000_000,
      baseUrl: () => 'https://example.invalid/compile/index.html',
      fetch: fetchImpl,
      settings: () => ({ endpoint: '/turn-cred', timeoutMs: 2_000, scope: 'player', ttlSeconds: 600 }),
    }),
  };
}

/** 跑一次"服务端不回"的超时路径，取那条 `detail`（**当前语言**下产出） */
async function timeoutDetail(): Promise<string> {
  const { store, mt } = makeStore(() => new Promise<TurnCredFetchResponseLike>(() => { /* 永不 settle */ }));
  const p = store.refresh();
  await Promise.resolve();
  mt.fire();
  const read = await p;
  expect(read.available, '夹具失败：超时那条路竟然判成"有凭据"').toBe(false);
  return read.available ? '' : (read.detail ?? '');
}

/** 跑一次"回应里缺字段"的 malformed 路径，取那条 `detail`（**当前语言**下产出） */
async function malformedDetail(): Promise<string> {
  const { store } = makeStore(async () => res(200, { urls: ['turn:x:1'] }));
  const read = await store.refresh();
  expect(read.available, '夹具失败：缺字段那条路竟然判成"有凭据"').toBe(false);
  if (!read.available) expect(read.reason, '夹具失败：缺字段没被判成 malformed').toBe('malformed');
  return read.available ? '' : (read.detail ?? '');
}

describe('★ P3 第七批：`turn-cred.ts` 那 7 条在英文下的形态', () => {
  it('锚点：7 条键都在两张表里、值非空、中英不同值、`en` 里零汉字', () => {
    const keys = Object.keys(FROZEN_ZH);
    expect(keys.length, '夹具里一条冻结值都没有 ⇒ 下面每条腿都在空集合上恒真').toBe(7);
    for (const k of keys) {
      expect(ZH[k], `zh 表里没有 ${k}`).toBeTypeOf('string');
      expect(EN[k], `en 表里没有 ${k}`).toBeTypeOf('string');
      expect(ZH[k], `${k} 的中文值是空的`).not.toBe('');
      expect(EN[k], `${k} 的英文值是空的`).not.toBe('');
      expect(EN[k], `${k} 的英文值里有汉字：${EN[k]}`).not.toMatch(/[\u3400-\u9fff]/);
      expect(ZH[k], `${k} 中英同值 ⇒ 语言判据恒真`).not.toBe(EN[k]);
    }
    // 反向锚点：这 7 条键真的被 `src/ui/turn-cred.ts` 读到（不是死在表里的键）——
    // `tests/i18n/tables.test.ts` 的"没有死键"那条腿是**生成式**的，这里只钉这一批的形态。
    expect(ZH['turn-cred.reason.timeout'], '中文值被改了（它应当逐字等于抽取前的原文）')
      .toBe('凭据服务没有及时回应');
  });

  it('四条原因句：英文逐字等于英文表 + 零汉字；中文逐字等于冻结原文', () => {
    const all = ['timeout', 'rejected', 'malformed', 'unreachable'] as const;
    for (const reason of all) {
      const key = `turn-cred.reason.${reason}`;
      setLang('en');
      const en = describeTurnCredentialFailure(reason);
      setLang('zh');
      const zh = describeTurnCredentialFailure(reason);
      expect(en, `${key} 的英文产出与英文表不一致：${JSON.stringify(en)}`).toBe(EN[key]);
      expect(en, `${key} 的英文产出里有汉字：${en}`).not.toMatch(/[\u3400-\u9fff]/);
      expect(zh, `${key} 的中文产出被改了（应逐字等于抽取前的原文）`).toBe(FROZEN_ZH[key]);
    }
    // 四条**互不相同**（否则"原因"这件事在屏上分不出来 —— 那是这张表存在的理由）
    setLang('en');
    const texts = all.map((r) => describeTurnCredentialFailure(r));
    expect(new Set(texts).size, `四条英文原因句有重复：${texts.join(' / ')}`).toBe(4);
    setLang('zh');
    const zhTexts = all.map((r) => describeTurnCredentialFailure(r));
    expect(new Set(zhTexts).size, `四条中文原因句有重复：${zhTexts.join(' / ')}`).toBe(4);
    // 反空集合：兜底那一支（`unreachable` 是 `if` 链的最后一格）也真的走文案表
    const bogus = 'nope' as unknown as TurnCredentialFailure;
    setLang('en');
    expect(describeTurnCredentialFailure(bogus), '兜底那一支绕过了文案表（英文下会回中文）')
      .toBe(EN['turn-cred.reason.unreachable']);
  });

  it('超时那条 `detail`：英文逐字等于英文表（带上毫秒数）、零汉字；中文逐字等于原文', async () => {
    setLang('en');
    const en = await timeoutDetail();
    // 期望值也在 en 之下取（`t()` 读的是**调用那一刻**的语言）
    const enWant = t('turn-cred.detail.timeout', { ms: '2000' });
    setLang('zh');
    const zh = await timeoutDetail();
    expect(en, `英文下超时那条 detail 与表不一致：${JSON.stringify(en)}`).toBe(enWant);
    expect(en, `英文下超时那条 detail 里有汉字：${en}`).not.toMatch(/[\u3400-\u9fff]/);
    expect(en, '英文那条没有把毫秒数带出来').toContain('2000');
    // 中文逐字：冻结原文的 `{ms}` 填上真机上那个数
    expect(zh, '中文那条 detail 被改了').toBe('等了 2000 毫秒没有回应');
    expect(zh, '中文那条没有把毫秒数带出来').toContain('2000');
    expect(zh, '中英同值 ⇒ 上面两条判据恒真').not.toBe(en);
  });

  it('`malformed`（回应里缺字段）那条 `detail`：中英各取各的，中文逐字等于原文', async () => {
    setLang('en');
    const en = await malformedDetail();
    setLang('zh');
    const zh = await malformedDetail();
    expect(en, `英文下 malformed 那条 detail 与表不一致：${JSON.stringify(en)}`).toBe(EN['turn-cred.detail.malformed']);
    expect(en, `英文下 malformed 那条 detail 里有汉字：${en}`).not.toMatch(/[\u3400-\u9fff]/);
    expect(zh, '中文那条 detail 被改了').toBe('回应里缺字段或字段形状不对');
    expect(EN['turn-cred.detail.malformed'], '中英同值 ⇒ 上面那条判据恒真')
      .not.toBe(ZH['turn-cred.detail.malformed']);
  });

  it('★ 没抽的那两条不动：`HTTP <状态码>` 与原样透出的系统消息在两种语言下逐字相同', async () => {
    /**
     * 这一条钉的是"**只换字符串来源**"：`fail('rejected', `HTTP ${status}`)` 那一条**不是**
     * 我们写的文案（它是一个读数），抽取这一批时**一个字都不许动**；`String(e)` 那条同理。
     */
    for (const lang of ['zh', 'en'] as const) {
      setLang(lang);
      const { store } = makeStore(async () => res(429, { ok: false }));
      const read = await store.refresh();
      expect(read.available).toBe(false);
      if (!read.available) expect(read.detail, `${lang} 下 HTTP 那条 detail 被改了`).toBe('HTTP 429');

      const { store: s2 } = makeStore(async () => ({ ok: true, status: 200, json: async () => { throw new Error('bad json'); } }));
      const r2 = await s2.refresh();
      expect(r2.available).toBe(false);
      if (!r2.available) expect(r2.detail, `${lang} 下系统消息被改写了（它应当原样透出）`).toBe('Error: bad json');
    }
  });

  it('`no-fetch` 那条（`defaultFetch` 的 reject 消息）：表级判据 + 它是现调 `t()`', () => {
    expect(ZH['turn-cred.error.no-fetch'], '中文值被改了（应逐字等于抽取前的原文）').toBe('这台设备没有 fetch 能力');
    expect(EN['turn-cred.error.no-fetch'], '英文值里有汉字').not.toMatch(/[\u3400-\u9fff]/);
    expect(EN['turn-cred.error.no-fetch'], '中英同值 ⇒ 这条腿恒真').not.toBe(ZH['turn-cred.error.no-fetch']);
    // 为什么这条只有表级判据：见文件头注（`defaultFetch` 没有注入缝，而本仓不许在测试里替换
    // `globalThis`）⇒ 它的"值 = 原文"由 `.superpowers/i18n-turn-cred/check-verbatim.mjs` 承担。
  });
});
