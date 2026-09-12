import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * FX 容器 CSS 守卫（2026-09-12）：新增特效层时最隐蔽的一类 bug 就是
 * **同名的旧规则残留**——例如 `.compiled-clarity-pyramid` 旧规则留下 `width:0; height:0`，
 * 新规则只写 `inset:0` 而不覆盖宽高 → 容器被压成 0×0，整个特效「根本不出现」，
 * 且 tsc/vitest 都不会报错（纯 CSS 生效顺序问题）。
 *
 * 本测试用简单的顶层规则扫描对「近期新增/改写的 FX 容器」做两条断言：
 *   ① 不得存在把容器压成 0 尺寸的规则（width/height: 0 / 0px）；
 *   ② 每个类最多只有一条规则声明 width/height（防止旧规则与新规则各写一半、互相打架）。
 * 修改 styles.css 时若命中，请合并规则而不是再加一条。
 */

const css = readFileSync(fileURLToPath(new URL('../../src/ui/styles.css', import.meta.url)))
  .subarray(0, 1024 * 1024)
  .toString('utf8');

/** 取某个类选择器在顶层（行首）定义的所有规则体（这些规则都不含嵌套大括号） */
function rulesFor(cls: string): { line: number; body: string }[] {
  const out: { line: number; body: string }[] = [];
  const lines = css.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // 顶层规则：行首即 .cls 或 .cls 结尾（允许 :hover/.class 等组合，用正则锚定行首类名）
    if (!new RegExp(`^\\.${cls.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s*[,{]|:)`).test(line)) continue;
    if (!line.includes('{')) continue;
    let body = line.slice(line.indexOf('{') + 1);
    let j = i;
    while (!body.includes('}') && j + 1 < lines.length) {
      j += 1;
      body += `\n${lines[j]}`;
    }
    out.push({ line: i + 1, body: body.slice(0, body.indexOf('}')) });
    i = j;
  }
  return out;
}

/** 近期新增/改写的 FX 容器类（全屏铺满型或定位型；都必须有确定的尺寸语义） */
const CONTAINERS = [
  'compiled-clarity-pyramid',
  'compiled-clarity-pyr-svg',
  'compiled-clarity-pyr-glow',
  'compiled-courage-sword',
  'compiled-war-sword',
  'fx-war-sword',
  'fx-diversity-orb',
  'fx-diversity-halo',
  'fx-diversity-rainbow-ring',
  'fx-div0-pillar',
  'fx-div0-beam',
  'fx-div0-burst',
  'fx-div3-cardglow',
  'fx-div3-lineflow',
  'fx-assim-dot',
  'fx-assim-land',
  'fx-assim-gloss',
  'fx-assim-band',
  'fx-unity-ring',
  'fx-unity-halo',
  'fx-unity-band',
  'fx-unity-pillar',
  'fx-unity-sash',
  'fx-courage-spark',
  'fx-peace-dove-wing',
];

describe('FX 容器 CSS 守卫', () => {
  for (const cls of CONTAINERS) {
    it(`.${cls}：无 0 尺寸规则、至多一条规则声明宽高`, () => {
      const rules = rulesFor(cls);
      expect(rules.length, `.${cls} 未在 styles.css 定义`).toBeGreaterThan(0);
      for (const r of rules) {
        expect(
          /(^|[\s;])(width|height)\s*:\s*0(px)?\s*(;|$)/.test(r.body),
          `.${cls} 第 ${r.line} 行把容器压成 0 尺寸（历史 bug：整个特效不会出现）`,
        ).toBe(false);
      }
      const sized = rules.filter((r) => /(^|[\s;])(width|height)\s*:/.test(r.body));
      expect(
        sized.length,
        `.${cls} 有 ${sized.length} 条规则声明宽高（行 ${sized.map((r) => r.line).join('/')}）——合并为一条`,
      ).toBeLessThanOrEqual(1);
    });
  }

  it('透彻金字塔容器铺满协议卡（inset + 宽高 auto，底面四角对齐协议四角）', () => {
    const rules = rulesFor('compiled-clarity-pyramid');
    const base = rules.find((r) => /inset\s*:\s*0/.test(r.body));
    expect(base, '金字塔容器缺少 inset:0 铺满规则').toBeTruthy();
    expect(/(^|[\s;])width\s*:\s*auto/.test(base!.body)).toBe(true);
    expect(/(^|[\s;])height\s*:\s*auto/.test(base!.body)).toBe(true);
  });
});
