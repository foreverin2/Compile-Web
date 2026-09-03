import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ALL_PROTOCOLS_2, ALL_CARD_DEFS_2 } from '../../src/data/cards2';

const PROTOCOLS_DIR = fileURLToPath(new URL('../../public/assets/protocols/', import.meta.url));

/** 每协议分值集合（权威：compile2文本.txt 卡文逐条核对） */
const EXPECTED_VALUE_SETS: Record<string, number[]> = {
  ice: [1, 2, 3, 4, 5, 6],
  mirror: [0, 1, 2, 3, 4, 5],
  peace: [1, 2, 3, 4, 5, 6],
  chaos: [0, 1, 2, 3, 4, 5],
  fear: [0, 1, 2, 3, 4, 5],
  clarity: [0, 1, 2, 3, 4, 5],
  corruption: [0, 1, 2, 3, 5, 6],
  time: [0, 1, 2, 3, 4, 5],
  war: [0, 1, 2, 3, 4, 5],
  courage: [0, 1, 2, 3, 5, 6],
  luck: [0, 1, 2, 3, 4, 5],
  smoke: [0, 1, 2, 3, 4, 5],
  assimilation: [0, 1, 2, 4, 5, 6],
  diversity: [0, 1, 3, 4, 5, 6],
  unity: [0, 1, 2, 3, 4, 5],
};

describe('2代（MN02）卡牌数据', () => {
  it('共 15 套协议：基础版 12 套 MN02 + 拓展 3 套 AX02', () => {
    expect(ALL_PROTOCOLS_2).toHaveLength(15);
    expect(ALL_PROTOCOLS_2.filter((p) => p.set === 'MN02')).toHaveLength(12);
    expect(ALL_PROTOCOLS_2.filter((p) => p.set === 'AX02')).toHaveLength(3);
    expect(ALL_PROTOCOLS_2.filter((p) => p.set === 'MN01' || p.set === 'AX01')).toHaveLength(0);
  });

  it('协议 defId 唯一且与 1代 defId 无冲突', () => {
    const ids = ALL_PROTOCOLS_2.map((p) => p.defId);
    expect(new Set(ids).size).toBe(ids.length);
    const mn01 = ['water', 'fire', 'light', 'darkness', 'life', 'death', 'spirit', 'gravity',
      'psychic', 'plague', 'metal', 'speed', 'love', 'hate', 'apathy'];
    for (const id of ids) expect(mn01).not.toContain(id);
  });

  it('每套协议 6 张卡、defId 与分值集合正确', () => {
    expect(ALL_CARD_DEFS_2).toHaveLength(90);
    for (const p of ALL_PROTOCOLS_2) {
      const cards = ALL_CARD_DEFS_2.filter((c) => c.protocol === p.defId);
      expect(cards).toHaveLength(6);
      const values = cards.map((c) => c.value).sort((a, b) => a - b);
      expect(values).toEqual(EXPECTED_VALUE_SETS[p.defId]);
      for (const c of cards) {
        expect(c.defId).toBe(`${p.defId}-${c.value}`);
      }
    }
  });

  it('卡 defId 全局唯一、协议引用均存在', () => {
    const ids = ALL_CARD_DEFS_2.map((c) => c.defId);
    expect(new Set(ids).size).toBe(ids.length);
    const protoIds = new Set(ALL_PROTOCOLS_2.map((p) => p.defId));
    for (const c of ALL_CARD_DEFS_2) expect(protoIds.has(c.protocol)).toBe(true);
  });

  it('每张卡至少 1 个指令位；无「空」残留、无字段泄漏', () => {
    for (const c of ALL_CARD_DEFS_2) {
      const parts = [c.top, c.middle, c.bottom].filter((t): t is string => t !== undefined);
      expect(parts.length).toBeGreaterThan(0);
      for (const t of parts) {
        expect(t.length).toBeGreaterThan(0);
        expect(t).not.toContain('空');
        expect(t).not.toContain('/');
        expect(t.endsWith('。')).toBe(true);
        // 转写规则：数量词阿拉伯数字化（禁中文数量词 一~十、两）
        expect(t).not.toMatch(/[二两三四五六七八九十]/);
        expect(t).not.toMatch(/一[张个种只]/);
      }
    }
  });

  it('每张卡对应的图像资源存在且为 JPEG', () => {
    for (const p of ALL_PROTOCOLS_2) {
      for (const f of ['protocol-loading.jpg', 'protocol-compiled.jpg']) {
        const path = `${PROTOCOLS_DIR}${p.defId}/${f}`;
        expect(existsSync(path), `缺少 ${path}`).toBe(true);
        expect(readFileSync(path).subarray(0, 2).toString('hex')).toBe('ffd8');
      }
      for (const c of ALL_CARD_DEFS_2.filter((x) => x.protocol === p.defId)) {
        const path = `${PROTOCOLS_DIR}${p.defId}/card-${c.value}.jpg`;
        expect(existsSync(path), `缺少 ${path}`).toBe(true);
        expect(readFileSync(path).subarray(0, 2).toString('hex')).toBe('ffd8');
      }
    }
  });
});
