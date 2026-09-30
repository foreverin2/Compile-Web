import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RULES, rulePageDir } from '../../src/ui/home';

/**
 * ★ 2026-09-30（用户要求）：点规则书**按页显示图片**（原来是内嵌 PDF，别人那边变成下载）。
 *
 * 这条腿钉的是**素材与数据的一致性**：`RULES[i].pages` 与 `public/assets/rules/pages/<dir>/`
 * 里的页图逐页对齐（数量 + 两位零填充的文件名），原版 PDF 也还在（顶栏那个按钮要用）。
 * PDF 换了但页图没重转 ⇒ 当场红，不会让玩家看到"少一页"或"从第 4 页开始是别的书"。
 */
const RULES_DIR = fileURLToPath(new URL('../../public/assets/rules/', import.meta.url));

describe('规则书：点开显示页图（用户 2026-09-30 要求）', () => {
  it('每本都留着原版 PDF（顶栏「原版 PDF」按钮用）', () => {
    expect(RULES.length, '规则书列表不该是空的').toBeGreaterThanOrEqual(5);
    for (const doc of RULES) {
      expect(existsSync(join(RULES_DIR, doc.file)), `${doc.title} 的 PDF 不在了：${doc.file}`).toBe(true);
    }
  });

  it('★ 页图与 `pages` 逐页对齐：数量一致 + 文件名是两位零填充的 page-NN.jpg', () => {
    for (const doc of RULES) {
      const dir = join(RULES_DIR, 'pages', rulePageDir(doc.file));
      expect(existsSync(dir), `${doc.title} 的页图目录不在：${dir}`).toBe(true);
      const files = readdirSync(dir).filter((f) => f.endsWith('.jpg')).sort();
      const want = Array.from({ length: doc.pages }, (_, i) => `page-${String(i + 1).padStart(2, '0')}.jpg`);
      expect(files, `${doc.title} 的页图与 pages=${doc.pages} 对不上（PDF 换了但没重转页图？）`)
        .toEqual(want);
    }
  });

  it('反空转：既有两页的、也有十来页的（否则上面那条可能只在空集合上通过）', () => {
    expect(RULES.some((d) => d.pages === 2), '没有两页的那种').toBe(true);
    expect(RULES.some((d) => d.pages >= 10), '没有十页以上的那种（FAQ）').toBe(true);
  });
});
