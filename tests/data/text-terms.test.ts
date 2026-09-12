import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ALL_CARD_DEFS } from '../../src/data/cards';
import { ALL_CARD_DEFS_2 } from '../../src/data/cards2';
import { ALL_CARD_DEFS_3 } from '../../src/data/cards3';
import { shiftTerm, actionCn } from '../../src/core/log';

/**
 * 文本用词约定（2026-09-13 用户同步文本后固化）：
 *  - 位移（shift）指令在【卡文】里的用词随世代：1代（MN01/AX01）「平移」；2代/3代「偏转」；
 *  - 引擎 UI/日志（动作按钮、操作日志）必须与**动作来源卡的世代**用词一致（shiftTerm）。
 * 这些断言防止以后再出现「卡文写偏转、提示框写平移」这类不一致。
 */

const cardsText = (defs: { defId: string; top?: string; middle?: string; bottom?: string }[]) =>
  defs.map((d) => `${d.defId}: ${d.top ?? ''}${d.middle ?? ''}${d.bottom ?? ''}`);

describe('文本用词约定：位移指令随世代（1代「平移」/ 2·3代「偏转」）', () => {
  it('1代卡文只用「平移」，不用「偏转」', () => {
    const hits = cardsText(ALL_CARD_DEFS).filter((t) => t.includes('平移') || t.includes('偏转'));
    expect(hits.length).toBeGreaterThan(0);
    for (const t of hits) {
      expect(t, `1代卡文应写「平移」`).not.toContain('偏转');
    }
  });

  it('2代卡文只用「偏转」，不用「平移」', () => {
    const hits = cardsText(ALL_CARD_DEFS_2).filter((t) => t.includes('平移') || t.includes('偏转'));
    expect(hits.length).toBeGreaterThan(0);
    for (const t of hits) {
      expect(t, `2代卡文应写「偏转」`).not.toContain('平移');
    }
  });

  it('3代卡文只用「偏转」，不用「平移」', () => {
    const hits = cardsText(ALL_CARD_DEFS_3).filter((t) => t.includes('平移') || t.includes('偏转'));
    expect(hits.length).toBeGreaterThan(0);
    for (const t of hits) {
      expect(t, `3代卡文应写「偏转」`).not.toContain('平移');
    }
  });

  it('shiftTerm 按世代给出用词（1代=平移；2/3代=偏转；未知兜底偏转）', () => {
    expect(shiftTerm('light-2')).toBe('平移');
    expect(shiftTerm('speed-2')).toBe('平移');
    expect(shiftTerm('apathy-4')).toBe('平移'); // AX01 拓展属 1代
    expect(shiftTerm('ice-1')).toBe('偏转');
    expect(shiftTerm('time-2')).toBe('偏转');
    expect(shiftTerm('pride-4')).toBe('偏转');
    expect(shiftTerm('flexibility-3')).toBe('偏转');
    expect(shiftTerm('unknown-0')).toBe('偏转');
  });

  it('actionCn：shift 动作按钮文字随来源卡世代；其它动作不受影响', () => {
    expect(actionCn('action:shift', 'light-2')).toBe('平移');
    expect(actionCn('action:shift', 'pride-0')).toBe('偏转');
    expect(actionCn('action:shift', 'flexibility-1')).toBe('偏转');
    expect(actionCn('action:shift')).toBe('偏转'); // 无上下文兜底
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
