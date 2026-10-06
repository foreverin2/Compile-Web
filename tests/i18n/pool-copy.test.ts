import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EN, ZH, DEFAULT_LANG, setLang, t } from '../../src/i18n';
import { POOL_MIN } from '../../src/app/pool-choice';
import { DEMO_PROTOCOLS } from '../../src/data/demo';

/**
 * ★ 2026-10-03（用户要求）：自定义协议池那几句文案的**双语纪律**。
 *
 * ## 这一组钉什么
 *
 *  1. **两表键集一一对应、占位符两端完全一致**（本文件自己再核一遍这几条新键 —— 全表的
 *     完整性另有 `tests/i18n/tables.test.ts` 那条腿，这里只把本任务的键放大看）；
 *  2. **英文表里这几个值零中日韩字符**（用户口径：en 表里不许出现 CJK）；
 *  3. **改写后的池子说明对两种模式都成立**（用户口径第 7 条）：中文里既有"随机"也有
 *     "自定义协议池"，而**旧那句专说随机池的错话已经不在**；英文同理；
 *  4. **占位符真的被替换**（`t()` 真跑一遍，屏上不许留着 `{total}` / `{n}`）；
 *  5. 计数句的形态就是用户点名的那个：「已选 N（至少 12）」。
 */

/** 本任务新增/改动的键（键名以字面量出现 ⇒ 与缺键扫描腿同一条口径） */
const NEW_KEYS = [
  'mode.pool',
  'mode.pool.tip',
  'mode.pool.pick',
  'mode.pool.count',
  'mode.pool.none',
  'pool.title',
  'pool.sub',
  'pool.gen.1',
  'pool.gen.2',
  'pool.gen.3',
  'pool.count',
  'pool.need',
  'pool.done',
  'pool.cancel',
] as const;

/** 值里出现的占位符集合（判据：两端必须一模一样） */
const placeholdersOf = (v: string): string[] =>
  [...new Set([...v.matchAll(/\{([A-Za-z0-9_]+)\}/g)].map((m) => m[1]))].sort();

beforeEach(() => { setLang(DEFAULT_LANG); });
afterEach(() => { setLang(DEFAULT_LANG); });

describe('★ 自定义协议池的文案（zh/en 两侧）', () => {
  it('锚点：新键在两张表里都在、都非空（否则下面每条腿在空集上恒真）', () => {
    expect(NEW_KEYS.length).toBeGreaterThan(8);
    for (const k of NEW_KEYS) {
      expect(ZH[k], `zh 表里没有 ${k}`).toBeTruthy();
      expect(EN[k], `en 表里没有 ${k}`).toBeTruthy();
    }
    // 反向：这几个键名确实不是随手写的 —— 它们都能在源码里被 `t()` 静态要到
    // （缺键扫描腿从另一头钉这件事；这里只做一个"键名带对了前缀"的形状锚点）
    expect(NEW_KEYS.every((k) => k.startsWith('mode.pool') || k.startsWith('pool.'))).toBe(true);
  });

  it('占位符两端完全一致（`{min}` / `{n}` 一个不多一个不少）', () => {
    for (const k of NEW_KEYS) {
      expect(placeholdersOf(EN[k]), `键 ${k} 的占位符两端不一致`).toEqual(placeholdersOf(ZH[k]));
    }
    // 带占位符的那几条确实是它们（不是"全都零占位"这种空判据）
    expect(placeholdersOf(ZH['pool.count'])).toEqual(['min', 'n']);
    expect(placeholdersOf(ZH['pool.need'])).toEqual(['n']);
    expect(placeholdersOf(ZH['mode.pool.tip'])).toEqual(['min']);
    expect(placeholdersOf(ZH['pool.sub'])).toEqual(['min']);
  });

  it('英文表里这几个值零中日韩字符', () => {
    for (const k of NEW_KEYS) {
      expect(/[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/.test(EN[k]), `en 的 ${k} 里有中日韩字符：${EN[k]}`)
        .toBe(false);
    }
  });

  it('占位符真的被替换：`t()` 跑一遍之后屏上不留 `{…}`', () => {
    for (const [lang, n, min] of [['zh', '12', String(POOL_MIN)], ['en', '12', String(POOL_MIN)]] as const) {
      setLang(lang);
      const out = t('pool.count', { n, min });
      expect(out, `${lang} 下 pool.count 还留着占位符`).not.toContain('{');
      expect(out, `${lang} 下 pool.count 没带上两个数`).toContain('12');
      const tip = t('mode.pool.tip', { min });
      expect(tip, `${lang} 下 mode.pool.tip 还留着占位符`).not.toContain('{');
      expect(tip, `${lang} 下 mode.pool.tip 没带上最小套数`).toContain(min);
    }
  });

  it('计数句的形态就是用户点名的那个：「已选 N（至少 12）」', () => {
    setLang('zh');
    expect(t('pool.count', { n: '12', min: String(POOL_MIN) })).toBe('已选 12（至少 12）');
    expect(ZH['mode.pool.count'].replace('{n}', '12'), '模式页那一行的计数句不像「已选 N 套」')
      .toContain('已选 12');
  });
});

describe('★ 池子说明（`render.draft.random-pool-note`）对两种模式都成立', () => {
  const KEY = 'render.draft.random-pool-note';

  it('中文：既提到随机池那一档，也提到自定义协议池那一档', () => {
    expect(ZH[KEY], '中文说明没有"随机"那一档').toContain('随机');
    expect(ZH[KEY], '中文说明没有"自定义协议池"那一档').toContain('自定义协议池');
    // 反向：**旧那句专说随机池的错话**不许还在（它在自定义池下是假陈述）
    expect(ZH[KEY], '旧那句"本局为随机池"还在（自定义池下它是假的）').not.toContain('本局为随机池');
  });

  it('英文：同样两档都在，且零中日韩字符', () => {
    expect(EN[KEY].toLowerCase(), '英文说明没有 random 那一档').toContain('random');
    expect(EN[KEY].toLowerCase(), '英文说明没有 custom 那一档').toContain('custom');
    expect(/[\u3400-\u9fff]/.test(EN[KEY]), `en 的 ${KEY} 里有汉字`).toBe(false);
    expect(EN[KEY], '旧那句"Random pool this game"还在').not.toContain('Random pool this game');
  });

  it('占位符 `{total}` / `{n}` 一个都没增删，且真跑之后都替换掉了', () => {
    expect(placeholdersOf(ZH[KEY]), '中文的占位符被改动了（生成式占位符腿会红）').toEqual(['n', 'total']);
    expect(placeholdersOf(EN[KEY]), '英文的占位符被改动了').toEqual(['n', 'total']);
    const total = String(DEMO_PROTOCOLS.length);
    for (const lang of ['zh', 'en'] as const) {
      setLang(lang);
      const out = t(KEY, { total, n: String(POOL_MIN) });
      expect(out, `${lang} 下还留着占位符`).not.toContain('{');
      expect(out, `${lang} 下没带上全量套数`).toContain(total);
      expect(out, `${lang} 下没带上本局套数`).toContain(String(POOL_MIN));
    }
  });
});
