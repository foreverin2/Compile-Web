import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { deriveInt } from '../../src/core/rng';
import type { PlayerId } from '../../src/core/models/types';
import { coinLanding, draftStarterFor, faceFromSide, sideFromFace, type CoinSide } from '../../src/app/coin';
import { newMatchSeed, newRandomToken } from '../../src/ui/match-seed';
import { stripComments } from '../ui/source-text';

/**
 * G5 T11-A 守卫：硬币规则与面映射的**单一出处**（`src/app/coin.ts`）。
 *
 * ## 这里钉的是什么
 *
 *  - **判据 4 前半（结构腿）**：`src/ui/home.ts` 里不再有硬币那一次 `deriveInt(` 调用；
 *  - **判据 4 后半（等价腿）**：`coinLanding(seed)` 与搬迁前那句逐字式子在**同一批种子**上
 *    逐一相等 —— 只搬家、不改值，靠这条腿保证；
 *  - **M4 的牙（判据 5）**：`draftStarterFor` 的"叫中才算"真的在比落点。把规则改成
 *    "永远 caller" 时，本文件必须红（否则联机两端会各自认为自己先选，而屏上看起来都正常）。
 *
 * ## 为什么不用手写的"期望值表"
 *
 * 落点式的期望值由 `deriveInt(seed, 'coin', 2) === 0 ? 1 : 2` **逐字重算**（那是搬迁前的原文），
 * 不是抄一份数字：抄数字会让"式子被改坏"与"表被同步改坏"同时发生而判据照绿。
 */

/** 一批种子：固定串 + 真实 `newMatchSeed()`（两种形状都覆盖） */
const SEEDS: readonly string[] = [
  'S1', 'S2', 'seed-01', '', 'coin', '0', '1', 'ab',
  ...Array.from({ length: 8 }, () => newMatchSeed()),
];

/** 搬迁前 `src/ui/home.ts:425` 那句**逐字**式子（作为等价腿的参照，不改值） */
function legacyLanding(seed: string): 1 | 2 {
  return deriveInt(seed, 'coin', 2) === 0 ? 1 : 2;
}

describe('G5 T11-A · 硬币落点与面映射的单一出处', () => {
  it('判据 4（等价腿）：`coinLanding` 与搬迁前那句式子在 16 个种子上逐一相等', () => {
    expect(SEEDS.length, '种子样本太少，这条腿会退化成抽样').toBeGreaterThanOrEqual(16);
    for (const seed of SEEDS) {
      expect(coinLanding(seed), `种子 ${JSON.stringify(seed)} 的落点与旧式子不一致`).toBe(legacyLanding(seed));
    }
    // 反空转：这批种子里**两种落点都要出现过**（否则"恒等"可能只是恒等于 1）
    const seen = new Set(SEEDS.map((s) => coinLanding(s)));
    expect([...seen].sort(), '样本里只出现过一种落点，等价腿在单值上恒真').toEqual([1, 2]);
  });

  it('判据 4（结构腿）：`src/ui/home.ts` 里没有硬币那一次 `deriveInt(` 调用', () => {
    const home = stripComments(
      readFileSync(fileURLToPath(new URL('../../src/ui/home.ts', import.meta.url)))
        .subarray(0, 4 * 1024 * 1024)
        .toString('utf8'),
    );
    expect(
      /\bderiveInt\s*\(/.test(home),
      'src/ui/home.ts 里还留着 `deriveInt(`（硬币规则必须只有 src/app/coin.ts 一处）',
    ).toBe(false);
    // 正控：同一个正则对搬迁前那句必须命中（否则上面那条在"正则写坏"时恒真）
    expect(/\bderiveInt\s*\(/.test(stripComments("const l = deriveInt(seed, 'coin', 2);")), '正控失效').toBe(true);
    // 反控：`coinLanding(` 是真的被用上了（不然"没有 deriveInt"可能只是整段被删）
    expect(/\bcoinLanding\s*\(/.test(home), 'home.ts 没有用上 coinLanding（规则被删了而不是搬家了）').toBe(true);
  });

  it('面映射只此一处：`sideFromFace` / `faceFromSide` 互为逆，且两端点值正确', () => {
    expect(sideFromFace(0)).toBe(1);
    expect(sideFromFace(1)).toBe(2);
    expect(faceFromSide(1)).toBe(0);
    expect(faceFromSide(2)).toBe(1);
    for (const face of [0, 1] as const) {
      expect(faceFromSide(sideFromFace(face)), `face ${face} 往返不一致`).toBe(face);
    }
    for (const side of [1, 2] as const) {
      expect(sideFromFace(faceFromSide(side)), `side ${side} 往返不一致`).toBe(side);
    }
    // ★ 会话层哈希把面写成 `String(face)`（`session.ts:1963`）⇒ 屏上的 2 必须对应字面量 '1'
    expect(String(faceFromSide(2)), '屏上"反面"(2) 没有映射到会话层的 1').toBe('1');
    expect(String(faceFromSide(1)), '屏上"正面"(1) 没有映射到会话层的 0').toBe('0');
  });

  it('M4 的牙：`draftStarterFor` 是"叫中才算"，不是"永远 caller"', () => {
    // 找一个落点为 1 的种子与一个落点为 2 的种子，两种情形都必须真的出现
    const seed2 = SEEDS.find((s) => coinLanding(s) === 2);
    const seed1 = SEEDS.find((s) => coinLanding(s) === 1);
    expect(seed2, '样本里没有落点 2 的种子（这条腿会退化成单分支）').toBeDefined();
    expect(seed1, '样本里没有落点 1 的种子').toBeDefined();
    const s2 = seed2 as string;
    const s1 = seed1 as string;

    // 叫中（caller 叫的面 == 落点）⇒ caller
    expect(draftStarterFor(1, 2, s2), '加入方（座位 1）叫中却没拿到先选').toBe(1);
    expect(draftStarterFor(0, 1, s1), '房主（座位 0）叫中却没拿到先选').toBe(0);
    // 叫错 ⇒ 另一方（这条正是 M4"永远 caller"会打红的那一半）
    expect(draftStarterFor(1, 1, s2), '加入方叫错却仍拿到先选（M4 的形态）').toBe(0);
    expect(draftStarterFor(0, 2, s1), '房主叫错却仍拿到先选（M4 的形态）').toBe(1);

    // 反空转：四种组合的**结果集合**必须同时含 0 与 1（不是恒 0 / 恒 1）
    const outs = new Set<PlayerId>([
      draftStarterFor(0, 1, s1), draftStarterFor(1, 1, s2),
      draftStarterFor(0, 2, s1), draftStarterFor(1, 2, s2),
    ]);
    expect([...outs].sort(), '四种组合的结果只出现一种（规则退化成常量）').toEqual([0, 1]);
  });

  it('T11-A 的随机串口子：`newRandomToken(8)` 是 16 个 hex 字符、两次不同；`newMatchSeed` 仍是 32 个', () => {
    const t = newRandomToken(8);
    expect(t, 'newRandomToken(8) 不是 8 字节的 hex').toMatch(/^[0-9a-f]{16}$/);
    expect(newRandomToken(8), 'newRandomToken 两次调用相同').not.toBe(t);
    // `newMatchSeed` 的对外形状不变（搬迁前也是 32 个 hex 字符 / 两次不同）
    const a = newMatchSeed();
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(a).not.toBe(newMatchSeed());
  });

  it('`CoinSide` 与屏上的 `1 | 2` 同口径（类型面：两处赋值都必须编得过）', () => {
    const side: CoinSide = coinLanding('S1');
    const asUnion: 1 | 2 = side;
    expect([1, 2]).toContain(asUnion);
  });
});
