import { describe, it, expect } from 'vitest';
import { resolveCardName, searchCards } from '../../src/ui/devmode';

/**
 * 隐藏开发者模式：卡牌名解析（纯函数，无 DOM 依赖，可在 vitest(node) 下导入）。
 * 接受的输入形式：trim + 大小写不敏感；`light-2` / `light2` / `光2` / `光-2` / `光 2`
 * 均应解析到同一张牌（协议中文名 + 分值）。
 */
describe('resolveCardName', () => {
  it("resolves 'light-2' to light-2", () => {
    expect(resolveCardName('light-2')?.defId).toBe('light-2');
  });

  it("resolves 'light2' to light-2", () => {
    expect(resolveCardName('light2')?.defId).toBe('light-2');
  });

  it("resolves 'LIGHT-2' to light-2 (case-insensitive)", () => {
    expect(resolveCardName('LIGHT-2')?.defId).toBe('light-2');
  });

  it("resolves '光2' to light-2 (protocol short name + value)", () => {
    expect(resolveCardName('光2')?.defId).toBe('light-2');
  });

  it("resolves '光-2' to light-2", () => {
    expect(resolveCardName('光-2')?.defId).toBe('light-2');
  });

  it("resolves ' 光 2 ' to light-2 (trimmed, spaces removed)", () => {
    expect(resolveCardName(' 光 2 ')?.defId).toBe('light-2');
  });

  it("resolves '暗3' to darkness-3", () => {
    expect(resolveCardName('暗3')?.defId).toBe('darkness-3');
  });

  it("resolves '灵魂0' to spirit-0", () => {
    expect(resolveCardName('灵魂0')?.defId).toBe('spirit-0');
  });

  it("resolves 'water-0' to water-0", () => {
    expect(resolveCardName('water-0')?.defId).toBe('water-0');
  });

  it("returns null for 'light-9' (no such card)", () => {
    expect(resolveCardName('light-9')).toBeNull();
  });

  it("returns null for '不存在'", () => {
    expect(resolveCardName('不存在')).toBeNull();
  });

  it("returns null for ''", () => {
    expect(resolveCardName('')).toBeNull();
  });
});

/**
 * 实时检索（指令页输入时显示匹配列表）：
 * 归一化子串匹配 defId（'light2'/'light-2'）与「协议中文名+分值」（'光'/'光2'/'暗5'），
 * 结果按 defId 自然排序（darkness-0..5, fire-0..5, light-0..5 …），默认上限 8。
 */
describe('searchCards', () => {
  it("'光' matches all 6 light cards (light-0..light-5)", () => {
    expect(searchCards('光').map((c) => c.defId)).toEqual([
      'light-0',
      'light-1',
      'light-2',
      'light-3',
      'light-4',
      'light-5',
    ]);
  });

  it("'光1' matches exactly light-1", () => {
    expect(searchCards('光1').map((c) => c.defId)).toEqual(['light-1']);
  });

  it("'light' matches all 6 light cards", () => {
    expect(searchCards('light').map((c) => c.defId)).toEqual([
      'light-0',
      'light-1',
      'light-2',
      'light-3',
      'light-4',
      'light-5',
    ]);
  });

  it("'light2' matches exactly light-2", () => {
    expect(searchCards('light2').map((c) => c.defId)).toEqual(['light-2']);
  });

  it("'暗5' matches exactly darkness-5", () => {
    expect(searchCards('暗5').map((c) => c.defId)).toEqual(['darkness-5']);
  });

  it("'2' returns up to the default limit (8), sorted by defId (natural)", () => {
    // 2026-09-06 并池（+3代）后：值 2 卡三代共 44 张，全子串同分 → 取自然序前 8
    expect(searchCards('2').map((c) => c.defId)).toEqual([
      'ambush-2',
      'apathy-2',
      'assimilation-2',
      'chaos-2',
      'clarity-2',
      'corruption-2',
      'courage-2',
      'darkness-2',
    ]);
  });

  it("returns [] for ''", () => {
    expect(searchCards('')).toEqual([]);
  });

  it('returns [] for whitespace-only query', () => {
    expect(searchCards('   ')).toEqual([]);
  });

  it("returns [] for '不存在' (no match)", () => {
    expect(searchCards('不存在')).toEqual([]);
  });

  it("respects an explicit limit: '光', 3 → 3 items", () => {
    expect(searchCards('光', 3).map((c) => c.defId)).toEqual([
      'light-0',
      'light-1',
      'light-2',
    ]);
  });
});

/**
 * 百度式模糊检索（R4）：
 * - 多 token AND：按空白切分为多个词，每词都必须命中（defKey 或「中文名+分值」）；
 * - 相关性排序：每词得分 3=精确 / 2=前缀 / 1=子串，按总分降序、同分按 defId 自然序，
 *   再截取 limit。
 */
describe('searchCards — multi-token AND + relevance ranking', () => {
  it("'light 2' (multi-token AND) matches exactly light-2", () => {
    expect(searchCards('light 2').map((c) => c.defId)).toEqual(['light-2']);
  });

  it("'光 2' (multi-token AND via cnKey) matches exactly light-2", () => {
    expect(searchCards('光 2').map((c) => c.defId)).toEqual(['light-2']);
  });

  it("AND narrows: 'l 2' keeps only cards whose key has both 'l' and '2'", () => {
    // 旧实现会连成 'l2'（无匹配）；AND 语义下逐词命中。并池（+3代）后：前缀组
    // life/light/love/luck/lust（得分更高）在前，含 'l' 的子串组按 defId 自然序在后
    // （默认 limit 8 → 前缀 5 + 子串前 3：assimilation/clarity/flexibility）。
    expect(searchCards('l 2').map((c) => c.defId)).toEqual([
      'life-2',
      'light-2',
      'love-2',
      'luck-2',
      'lust-2',
      'assimilation-2',
      'clarity-2',
      'flexibility-2',
    ]);
  });

  it("ranking: '5' returns the top-20 of 45 value-5 cards by defId natural order", () => {
    expect(searchCards('5', 20).map((c) => c.defId)).toEqual([
      'ambush-5',
      'apathy-5',
      'assimilation-5',
      'chaos-5',
      'clarity-5',
      'corruption-5',
      'courage-5',
      'darkness-5',
      'death-5',
      'diversity-5',
      'envy-5',
      'fear-5',
      'fire-5',
      'flexibility-5',
      'fulcrum-5',
      'gluttony-5',
      'gravity-5',
      'greed-5',
      'hate-5',
      'ice-5',
    ]);
  });

  it("ranking: prefix match beats plain substring — 'a 2' puts ambush/apathy/assimilation first", () => {
    // ambush-2/apathy-2/assimilation-2 的 'a' 是 defKey 前缀（2 分）其余仅子串（1 分）→ 得分 3 vs 2
    expect(searchCards('a 2').map((c) => c.defId)).toEqual([
      'ambush-2',
      'apathy-2',
      'assimilation-2',
      'chaos-2',
      'clarity-2',
      'courage-2',
      'darkness-2',
      'death-2',
    ]);
  });

  it("ranking applies the limit after sorting: 'a 2', 3 → top-3 by score", () => {
    expect(searchCards('a 2', 3).map((c) => c.defId)).toEqual([
      'ambush-2',
      'apathy-2',
      'assimilation-2',
    ]);
  });
});
