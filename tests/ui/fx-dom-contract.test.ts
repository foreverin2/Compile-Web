import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { FX_DOM_CONTRACT, hooksOfCategory } from '../../src/ui/fx-dom-contract';

/**
 * G1 守卫：FX DOM 契约必须「出处真实 + 现热座渲染器确实提供 + 分类互斥」。
 * 无 jsdom（项目惯例）：这里全部是源码文本核对。
 */

const root = new URL('../../src/ui/', import.meta.url);
const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, root))).subarray(0, 8 * 1024 * 1024).toString('utf8');

/** FX 层模块（契约的消费方） */
const FX_MODULES = [
  'effects/index.ts',
  'fx-gen2.ts',
  'fx-gen3.ts',
  'fx-gen3-swap.ts',
  'gen3-control.ts',
  'compiled-gen3.ts',
  'gen3-util.ts',
  'fx-follow.ts',
  'fx/delete-shatter.ts',
  'fx/discard-cut.ts',
  'fx-tornado.ts',
] as const;

/** 结构钩子的提供方（当前唯一渲染器；G2 会新增远程页渲染器） */
const RENDERERS = ['render.ts'] as const;

const fxSources = new Map(FX_MODULES.map((m) => [m, read(m)]));

describe('G1 · FX DOM 契约', () => {
  it('清单非空，且三类都出现过（防止只盘点了一类）', () => {
    expect(FX_DOM_CONTRACT.length).toBeGreaterThan(0);
    for (const c of ['A', 'B', 'C'] as const) expect(hooksOfCategory(c).length).toBeGreaterThan(0);
  });

  it('每条钩子都有 kind / category / requiredBy，且 requiredBy 指向真实存在的 FX 模块', () => {
    const names = new Set<string>(FX_MODULES);
    for (const h of FX_DOM_CONTRACT) {
      expect(h.hook.length, `空钩子：${JSON.stringify(h)}`).toBeGreaterThan(0);
      expect(['attr', 'class', 'element']).toContain(h.kind);
      expect(['A', 'B', 'C']).toContain(h.category);
      expect(h.requiredBy.length, `${h.hook} 的 requiredBy 为空`).toBeGreaterThan(0);
      for (const m of h.requiredBy) expect(names.has(m), `${h.hook} 的出处 ${m} 不在 FX_MODULES 内`).toBe(true);
    }
  });

  it('钩子字符串不重复（同名钩子不得出现在两个分类里）', () => {
    const seen = new Map<string, string>();
    for (const h of FX_DOM_CONTRACT) {
      const prev = seen.get(h.hook);
      expect(prev, `钩子 ${h.hook} 重复登记（${prev} 与 ${h.category}）`).toBeUndefined();
      seen.set(h.hook, h.category);
    }
  });

  it('A 类钩子必须真的被某个 FX 模块引用（防止凭空发明）', () => {
    const missing: string[] = [];
    for (const h of hooksOfCategory('A')) {
      // 取钩子的「判别子串」：属性名或类名，去掉值与 CSS 语法
      const probe = h.hook.includes('[') ? /\[([a-z-]+)/.exec(h.hook)?.[1] ?? h.hook : h.hook.replace(/^\./, '');
      const hit = [...fxSources.values()].some((src) => src.includes(probe));
      if (!hit) missing.push(`${h.hook}（判别子串 ${probe} 未在任何 FX 模块中出现）`);
    }
    expect(missing, `以下 A 类钩子找不到引用出处：\n${missing.join('\n')}`).toEqual([]);
  });

  it('A 类钩子必须被当前渲染器提供（这是 G2 的验收基准）', () => {
    const missing: string[] = [];
    for (const r of RENDERERS) {
      const src = read(r);
      for (const h of hooksOfCategory('A')) {
        const probe = h.hook.includes('[') ? /\[([a-z-]+)/.exec(h.hook)?.[1] ?? h.hook : h.hook.replace(/^\./, '');
        if (!src.includes(probe)) missing.push(`${r} 未提供 ${h.hook}`);
      }
    }
    expect(missing, `以下 A 类钩子当前渲染器缺失：\n${missing.join('\n')}`).toEqual([]);
  });

  it('七个已确认的核心钩子必须在清单里（防止盘点漏掉主干）', () => {
    const all = FX_DOM_CONTRACT.map((h) => h.hook).join('\n');
    // 注意：这里的判别串必须与 hook 的书写形式一致（机读清单里属性选择器**不带具体值**）
    for (const core of [
      '.stack-slot[data-player]',
      '[data-uid]',
      '.deck[data-player]',
      'protocol-img',
      'hand-strip',
      'play-btns',
      'control-track',
    ]) {
      expect(all, `核心钩子 ${core} 未登记`).toContain(core);
    }
  });
});
