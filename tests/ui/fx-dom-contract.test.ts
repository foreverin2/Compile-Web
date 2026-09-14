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
  it('清单非空，且四类都出现过（防止只盘点了一类）', () => {
    expect(FX_DOM_CONTRACT.length).toBeGreaterThan(0);
    for (const c of ['A', 'B', 'C', 'D'] as const) expect(hooksOfCategory(c).length).toBeGreaterThan(0);
  });

  it('每条钩子都有 kind / category / requiredBy，且 requiredBy 指向真实存在的 FX 模块', () => {
    const names = new Set<string>(FX_MODULES);
    for (const h of FX_DOM_CONTRACT) {
      expect(h.hook.length, `空钩子：${JSON.stringify(h)}`).toBeGreaterThan(0);
      expect(['attr', 'class', 'element']).toContain(h.kind);
      expect(['A', 'B', 'C', 'D']).toContain(h.category);
      if (h.category === 'D') {
        // D 类＝渲染器产出但 FX 不读：没有 FX 消费方，requiredBy 必须是空数组。
        // （首轮为迁就两条互斥规则曾填 'effects/index.ts'，那是不实声明。）
        expect(h.requiredBy, `${h.hook} 是 D 类（FX 零引用），requiredBy 必须为空`).toEqual([]);
        continue;
      }
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

  it('六个已确认的 A 类核心钩子必须在清单里（防止盘点漏掉主干）', () => {
    const aHooks = hooksOfCategory('A').map((h) => h.hook).join('\n');
    // 判别串必须与 hook 的书写形式一致（机读清单里属性选择器**不带具体值**）。
    // 这六条都已 git grep 到 FX 模块确有引用；`.hand-strip`/`.play-btns`/`.lane-row` 因 FX 零引用归 D，不在此列。
    for (const core of [
      '.stack-slot[data-player]',
      '[data-uid]',
      '.deck[data-player]',
      'protocol-img',
      'control-track',
      'protocol-holder',
    ]) {
      expect(aHooks, `核心 A 类钩子 ${core} 未登记为 A`).toContain(core);
    }
  });

  it('D 类钩子必须由渲染器产出、且 FX 模块完全读不到（两个条件缺一不可，防止分类搞反）', () => {
    const rendererSrc = RENDERERS.map((r) => read(r)).join('\n');
    const problems: string[] = [];
    for (const h of hooksOfCategory('D')) {
      const probe = h.hook.includes('[') ? /\[([a-z-]+)/.exec(h.hook)?.[1] ?? h.hook : h.hook.replace(/^\./, '');
      if (!rendererSrc.includes(probe)) problems.push(`${h.hook} 未被当前渲染器产出（应归 B 特效自建）`);
      if ([...fxSources.values()].some((src) => src.includes(probe))) {
        problems.push(`${h.hook} 其实被 FX 模块读到（判别子串 ${probe}，应归 A 契约项）`);
      }
    }
    expect(problems, `以下 D 类钩子判定有误：\n${problems.join('\n')}`).toEqual([]);
  });
});
