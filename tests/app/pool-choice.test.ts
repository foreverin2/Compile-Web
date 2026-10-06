import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import {
  POOL_MIN,
  buildPool,
  encodePoolIntoSeed,
  isPoolUsable,
  normalizePoolIds,
  poolDefsOf,
  poolFromSeed,
  poolIdsFromSeed,
} from '../../src/app/pool-choice';
import { DEMO_PROTOCOLS } from '../../src/data/demo';
import { stripComments } from '../ui/source-text';

/**
 * ★ 2026-10-06（用户要求）：「自定义协议池」的**纯逻辑**。
 *
 * ## 这一组钉什么
 *
 *  1. **顺序确定**（联机那条判据的地基）：对同一个 defId **集合**，无论以什么顺序传进来，
 *     算出来的数组逐项相同、且等于 `DEMO_PROTOCOLS` 的常量顺序；
 *  2. **种子编解码成对**：可逆、幂等，"没编码 ⇒ `null`"；
 *  3. **不足 12 套一律回 `null`**（用户点名的兜底："开局不许用一个不足数的池子"）；
 *  4. **`POOL_MIN` 只有一处定义**（生成式：扫 `src/**` 的代码位）。
 *
 * 纯函数腿，真调函数 —— 没有桩、没有源码文本（除了第 4 条那条"唯一出处"的扫描）。
 */

const IDS = DEMO_PROTOCOLS.map((p) => p.defId);
/** 前 12 套（够数） */
const TWELVE = IDS.slice(0, POOL_MIN);
/** 一个"跨世代"的 12 套（联机/顺序那几条腿用它，保证不是同代连号） */
const MIXED = DEMO_PROTOCOLS.filter((_, i) => i % 3 === 0).slice(0, POOL_MIN).map((p) => p.defId);

describe('pool-choice · 最小套数与归一', () => {
  it('锚点：`POOL_MIN` 是 12，且协议数据集比它大得多（否则下面每条腿在空集上恒真）', () => {
    expect(POOL_MIN, '最小套数被改了？用户口径是 12').toBe(12);
    expect(DEMO_PROTOCOLS.length, '协议数据集太小 ⇒ 挑选屏那条路测不出东西').toBeGreaterThan(POOL_MIN * 2);
    expect(new Set(IDS).size, 'defId 有重复 ⇒ 下面"按集合相等"的断言会失真').toBe(DEMO_PROTOCOLS.length);
  });

  it('MIXED 夹具真的跨世代（不是同代连号）', () => {
    expect(new Set(MIXED.map((id) => DEMO_PROTOCOLS.find((p) => p.defId === id)!.set)).size)
      .toBeGreaterThan(1);
  });

  it('归一：只留现有协议、去重、排成常量顺序；未知 defId 被忽略', () => {
    const shuffled = [...TWELVE].reverse();
    const out = normalizePoolIds([...shuffled, shuffled[0], 'nope-0', '', 'MN99']);
    expect(out, '归一后的顺序不是 DEMO_PROTOCOLS 的常量顺序').toEqual(TWELVE);
    expect(out.length, '重复项没被去掉').toBe(POOL_MIN);
    expect(normalizePoolIds([]), '空输入该回空数组').toEqual([]);
    expect(normalizePoolIds(['nope-0']), '只认现有协议').toEqual([]);
  });

  it('buildPool：按常量顺序过滤，未知 defId 忽略，且元素与数据集**同一批对象**', () => {
    const pool = buildPool([...TWELVE].reverse());
    expect(pool.map((p) => p.defId)).toEqual(TWELVE);
    expect(pool[0], '池里的协议不是数据集里的那个对象（复制一份会让两端/重放各说各话）')
      .toBe(DEMO_PROTOCOLS.find((p) => p.defId === TWELVE[0]));
    expect(buildPool([TWELVE[0], 'nope-0']).map((p) => p.defId), '未知 defId 没被忽略').toEqual([TWELVE[0]]);
    expect(buildPool([]), '空输入该回空池').toEqual([]);
  });

  it('顺序确定：同一个集合换三种输入顺序 ⇒ 三次结果逐项相同', () => {
    const a = buildPool(MIXED);
    const b = buildPool([...MIXED].reverse());
    const c = buildPool([...MIXED.slice(6), ...MIXED.slice(0, 6)]);
    expect(a.map((p) => p.defId)).toEqual(b.map((p) => p.defId));
    expect(a.map((p) => p.defId)).toEqual(c.map((p) => p.defId));
    // 反向：这条判据不是"怎么排都相等"——换一个集合必须换一份结果
    expect(a.map((p) => p.defId)).not.toEqual(buildPool(TWELVE).map((p) => p.defId));
  });

  it('`isPoolUsable`：12 套算够，11 套不算', () => {
    expect(isPoolUsable(TWELVE), '12 套被判成不够').toBe(true);
    expect(isPoolUsable(TWELVE.slice(0, POOL_MIN - 1)), '11 套被判成够（用户口径是至少 12）').toBe(false);
    expect(isPoolUsable([...TWELVE, 'nope-0']), '未知 defId 不该把计数撑上去').toBe(true);
    expect(isPoolUsable(Array(POOL_MIN).fill('nope-0')), '全是未知 defId 却算够数').toBe(false);
  });
});

describe('pool-choice · 池子从存储/种子来', () => {
  it('`poolDefsOf`：没勾 ⇒ null；勾了但不足 12 套 ⇒ null；勾了且够 ⇒ 恰好那几套', () => {
    expect(poolDefsOf({ enabled: false, ids: TWELVE }), '没勾却给了池子').toBeNull();
    expect(poolDefsOf({ enabled: true, ids: TWELVE.slice(0, POOL_MIN - 1) }), '11 套也给了池子').toBeNull();
    expect(poolDefsOf({ enabled: true, ids: ['nope-0'] }), '一个都不认识却给了池子').toBeNull();
    const pool = poolDefsOf({ enabled: true, ids: [...MIXED].reverse() });
    expect(pool, '勾了且够 12 套却没有池子').not.toBeNull();
    expect(pool?.map((p) => p.defId)).toEqual(buildPool(MIXED).map((p) => p.defId));
  });

  it('`encodePoolIntoSeed` / `poolIdsFromSeed`：可逆（解出来 = 归一后的那一份）', () => {
    const seed = 'a1b2c3d4e5f6';
    const encoded = encodePoolIntoSeed(seed, [...MIXED].reverse());
    expect(encoded.startsWith(seed), '编码之后原始种子不是前缀 ⇒ 硬币/洗牌会跟着变形状').toBe(true);
    expect(poolIdsFromSeed(encoded)).toEqual(MIXED);
  });

  it('幂等：编码两次 == 编码一次（第二次不许把两段编码叠起来）', () => {
    const once = encodePoolIntoSeed('deadbeef', MIXED);
    const twice = encodePoolIntoSeed(once, [...MIXED].reverse());
    expect(twice, '重复编码改变了结果（幂等性破了）').toBe(once);
    expect(poolIdsFromSeed(twice)).toEqual(MIXED);
  });

  it('没有编码的种子解出 `null`（不是空数组、不是抛）', () => {
    for (const seed of ['', 'a1b2c3', 'auto-p0-7', 'seed-with-pool-word']) {
      expect(poolIdsFromSeed(seed), `种子 ${JSON.stringify(seed)} 被解出了池子`).toBeNull();
      expect(poolFromSeed(seed), `种子 ${JSON.stringify(seed)} 被解出了池子`).toBeNull();
    }
  });

  it('空集不编码：`encodePoolIntoSeed(seed, [])` 原样返回种子（于是解出来仍是 null）', () => {
    expect(encodePoolIntoSeed('abc', [])).toBe('abc');
    expect(encodePoolIntoSeed('abc', ['nope-0']), '全是未知 defId 也被编进去了').toBe('abc');
    expect(poolIdsFromSeed('abc')).toBeNull();
  });

  it('编码里的未知 defId 被忽略；一个都不认识 ⇒ `null`', () => {
    const encoded = encodePoolIntoSeed('abc', [...MIXED, 'nope-0', 'nope-1']);
    expect(poolIdsFromSeed(encoded), '未知 defId 混进了解码结果').toEqual(MIXED);
    expect(poolIdsFromSeed('abc#pool=nope-0,nope-1'), '全是未知 defId 却解出了池子').toBeNull();
    expect(poolIdsFromSeed('abc#pool='), '空载荷却解出了池子').toBeNull();
  });

  it('`poolFromSeed`：够 12 套才回池子；11 套回 null（两端同时这么判）', () => {
    const ok = poolFromSeed(encodePoolIntoSeed('seed-1', MIXED));
    expect(ok?.map((p) => p.defId), '解出来的池子与 buildPool 不一致').toEqual(buildPool(MIXED).map((p) => p.defId));
    expect(poolFromSeed(encodePoolIntoSeed('seed-1', TWELVE.slice(0, POOL_MIN - 1))), '11 套也回池子').toBeNull();
  });

  it('两端一致性（判据形态）：同一粒种子解两次 ⇒ 逐项相同，且等于房主挑的那一份', () => {
    const hostIds = MIXED;
    const seed = encodePoolIntoSeed('2f9c1ab7', hostIds);
    const endA = poolFromSeed(seed)?.map((p) => p.defId);
    const endB = poolFromSeed(seed)?.map((p) => p.defId);
    expect(endA).toEqual(endB);
    expect(endA).toEqual(buildPool(hostIds).map((p) => p.defId));
    // 反向锚点：这条判据不是"恒等于某个常量"——换一份预设必须换一份池子
    expect(poolFromSeed(encodePoolIntoSeed('2f9c1ab7', TWELVE))?.map((p) => p.defId))
      .not.toEqual(endA);
  });
});

/**
 * ★ `POOL_MIN` 的**唯一出处**（用户口径："最小数量常量只许有一处定义"）。
 *
 * 判据面：`src/**` 的**代码位**里 `POOL_MIN = <数>` 恰好出现一次，且那一次在
 * `src/app/pool-choice.ts` 里。写成生成式（现扫）而不是"看一眼就写死"：换文件、加第二处
 * 都会让它当场红。
 */
describe('pool-choice · `POOL_MIN` 只有一处定义（生成式扫描）', () => {
  const REPO = fileURLToPath(new URL('../../', import.meta.url));

  function walkTs(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walkTs(p, out);
      else if (name.endsWith('.ts') && !name.endsWith('.d.ts')) out.push(p);
    }
    return out;
  }

  const SOURCES = walkTs(join(REPO, 'src')).map((abs) => ({
    rel: abs.slice(REPO.length).split('\\').join('/'),
    code: stripComments(readFileSync(abs).subarray(0, 4 * 1024 * 1024).toString('utf8')),
  }));

  it('扫描面自检：读到了池子那两个文件（否则下面的判据在空集上恒真）', () => {
    expect(SOURCES.length, 'src 下一个 .ts 都没读到').toBeGreaterThan(50);
    for (const rel of ['src/app/pool-choice.ts', 'src/ui/pool-picker.ts', 'src/ui/home.ts', 'src/main.ts']) {
      expect(SOURCES.some((s) => s.rel === rel), `${rel} 不在扫描面里`).toBe(true);
    }
  });

  it('全仓 `POOL_MIN = <字面量>` 恰好一处，且在 `src/app/pool-choice.ts` 里', () => {
    const hits = SOURCES.flatMap((s) => {
      const m = s.code.match(/POOL_MIN\s*=\s*[^;]+;/g) ?? [];
      return m.map((x) => `${s.rel}：${x}`);
    });
    expect(hits, `POOL_MIN 的定义处不是恰好一处：\n${hits.join('\n')}`).toEqual([
      'src/app/pool-choice.ts：POOL_MIN = 12;',
    ]);
  });
});
