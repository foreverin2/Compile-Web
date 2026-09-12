import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ALL_CARD_DEFS } from '../../src/data/cards';
import { ALL_CARD_DEFS_2 } from '../../src/data/cards2';
import { ALL_CARD_DEFS_3 } from '../../src/data/cards3';
import { DEMO_PROTOCOLS } from '../../src/data/demo';
import { shiftTerm, actionCn } from '../../src/core/log';

/**
 * 文本用词约定（2026-09-13 用户拍板：位移指令**全世代统一「偏转」**）：
 *  - 卡文（1/2/3 代）一律写「偏转」，不得再出现「平移」；
 *  - 引擎 UI/日志（动作按钮、操作日志、提示标题）同样统一「偏转」（唯一出处 core/log.ts shiftTerm）。
 * 这些断言防止以后再出现「卡文写偏转、提示框写平移」这类不一致。
 */

const cardsText = (defs: { defId: string; top?: string; middle?: string; bottom?: string }[]) =>
  defs.map((d) => `${d.defId}: ${d.top ?? ''}${d.middle ?? ''}${d.bottom ?? ''}`);

describe('文本用词约定：位移指令全世代「偏转」', () => {
  it('1代卡文不再出现「平移」，且确有「偏转」用法', () => {
    const text = cardsText(ALL_CARD_DEFS);
    expect(text.filter((t) => t.includes('偏转')).length).toBeGreaterThan(0);
    for (const t of text) expect(t, `1代卡文应写「偏转」`).not.toContain('平移');
  });

  it('2代卡文不再出现「平移」，且确有「偏转」用法', () => {
    const text = cardsText(ALL_CARD_DEFS_2);
    expect(text.filter((t) => t.includes('偏转')).length).toBeGreaterThan(0);
    for (const t of text) expect(t, `2代卡文应写「偏转」`).not.toContain('平移');
  });

  it('3代卡文不再出现「平移」，且确有「偏转」用法', () => {
    const text = cardsText(ALL_CARD_DEFS_3);
    expect(text.filter((t) => t.includes('偏转')).length).toBeGreaterThan(0);
    for (const t of text) expect(t, `3代卡文应写「偏转」`).not.toContain('平移');
  });

  it('协议关键词（图鉴关键词行）也不含「平移」', () => {
    for (const p of DEMO_PROTOCOLS) {
      expect(p.commands.join('，'), `${p.defId} 关键词应写「偏转」`).not.toContain('平移');
    }
  });

  it('shiftTerm 全世代返回「偏转」（含未知协议兜底）', () => {
    expect(shiftTerm('light-2')).toBe('偏转');
    expect(shiftTerm('speed-2')).toBe('偏转');
    expect(shiftTerm('apathy-4')).toBe('偏转');
    expect(shiftTerm('ice-1')).toBe('偏转');
    expect(shiftTerm('pride-4')).toBe('偏转');
    expect(shiftTerm('flexibility-3')).toBe('偏转');
    expect(shiftTerm('unknown-0')).toBe('偏转');
  });

  it('actionCn：shift 动作按钮文字一律「偏转」；其它动作不受影响', () => {
    expect(actionCn('action:shift', 'light-2')).toBe('偏转');
    expect(actionCn('action:shift', 'pride-0')).toBe('偏转');
    expect(actionCn('action:shift')).toBe('偏转');
    expect(actionCn('action:flip', 'light-2')).toBe('翻转');
    expect(actionCn('action:face-down', 'pride-2')).toBe('反面打出');
  });
});

describe('文本文件与数据同步状态（外部权威文本存在时校验）', () => {
  const TXT_DIR = 'E:\\studyE\\compile\\正版compile';
  const readIfExists = (p: string): string | null => {
    try {
      return readFileSync(p).subarray(0, 1 << 20).toString('utf8');
    } catch {
      return null;
    }
  };

  it('「若你这么做」已在数据与文本中全部替换为「若你达成该条件」', () => {
    const txt = readIfExists(`${TXT_DIR}\\compile2文本.txt`);
    if (txt === null) return; // 外部文本不存在（其他环境）→ 跳过
    expect(txt).not.toContain('若你这么做');
    const dataText = cardsText([...ALL_CARD_DEFS, ...ALL_CARD_DEFS_2, ...ALL_CARD_DEFS_3]).join('\n');
    expect(dataText).not.toContain('若你这么做');
  });

  it('1/2/3代文本文件与数据的卡牌文本差异为 0（需先跑 npm run texts:sync）', async () => {
    const { execFileSync } = await import('node:child_process');
    const repo = fileURLToPath(new URL('../..', import.meta.url));
    if (readIfExists(`${TXT_DIR}\\compile1文本.txt`) === null) return; // 外部文本缺失 → 跳过
    let out = '';
    try {
      out = execFileSync('node', ['tools/sync-card-texts.mjs'], { cwd: repo, encoding: 'utf8' });
    } catch (err) {
      const e = err as { stdout?: string; status?: number };
      if (e.status === 1) out = e.stdout ?? '';
      else throw err;
    }
    expect(out).toContain('卡牌文本差异 0 处；协议元数据差异 0 处');
  });
});
