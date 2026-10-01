import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { stripComments, functionBody } from '../ui/source-text';
import { ZH } from '../../src/i18n/zh';

/**
 * ★ 2026-10-01（P0）：「**尚未抽取的屏**」清单的机械形态。
 *
 * 用户的 P0 交付里要一条"还没做 i18n 的屏/文件"清单（方案 §6.5 第 3 条），并且明确
 * **"清单只能变短，不能变长"**。一份手写的 markdown 清单挡不住任何东西 ——
 * 新加一个屏、忘了登记，没人会知道。所以清单是**机检**的：
 *
 *  1. 扫 `src/ui/**\/*.ts` 的**代码位**（剥注释）里的**中文字符串字面量**；
 *  2. **每一个含中文的 `src/ui/**` 文件都必须在 `docs/2026-10-01-i18n-尚未抽取的屏.md`
 *     的表格里登记**（新屏没登记 ⇒ 报红）；
 *  3. 清单里每一行指的文件**真的存在**（幽灵行 ⇒ 报红）；
 *  4. **已经判为"干净"的文件不许再有裸中文字面量**（抽干净了才算划掉 —— 否则"划掉"
 *     只是一次自我声明）。
 *
 * ## 为什么扫描面是 `src/ui/**` 而不是整个 `src/**`
 *
 * 玩家可见的 UI 文案都在 `src/ui/**` 里；`src/core/**`（引擎日志与提示）与
 * `src/app/**`（协议/隐私/档案）的中文各有另外的口径（联机对端一致性、整句哈希），
 * 它们的排期写在那份文档的 C 节里，**不在**这条腿的判据面内 —— 这不是"没覆盖"，
 * 是"覆盖边界写清楚了"。
 *
 * ## 已知边界（如实声明）
 *
 *  - 只认**字面量**：`'甲' + '乙'` 拼出来的句子、或从数据里读来的中文都不算（P0 的屏没有这种写法）；
 *  - 只认**含汉字**的字符串/模板串：`'水'` 这种单字也算（故意从严 —— 它是文案就该进表）；
 *  - 它**不**判断中文是不是玩家可见（类名、`data-*` 的取值、徽标的缩写都会算进去）。
 *    代价是清单里的计数偏大；方向是**假红**（逼一次人工登记），不是静默放行。
 */

const REPO = fileURLToPath(new URL('../../', import.meta.url));
const MANIFEST_REL = 'docs/2026-10-01-i18n-尚未抽取的屏.md';

/** 递归收集 `src/ui/**` 下的 `.ts`（不含 `.d.ts`） */
function walkTs(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walkTs(p, out);
    else if (name.endsWith('.ts') && !name.endsWith('.d.ts')) out.push(p);
  }
  return out;
}

/**
 * 代码位里的**中文字符串/模板串字面量**（去重）。
 *
 * 口径与 `tests/ui/privacy-consumers.test.ts` 的字面量扫描器**同族**（那份是它自己的第三份
 * 实现，本仓有先例）：先 `stripComments`，再按引号切。这里只需要"有没有汉字"，
 * 不需要区分单双引号，所以实现更短。
 */
function cjkLiterals(code: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < code.length) {
    const c = code[i];
    if (c === "'" || c === '"' || c === '`') {
      const quote = c;
      let buf = '';
      i += 1;
      while (i < code.length) {
        const ch = code[i];
        if (ch === '\\') { buf += code[i + 1] ?? ''; i += 2; continue; }
        if (ch === quote) { i += 1; break; }
        buf += ch;
        i += 1;
      }
      if (/[\u3400-\u9fff]/.test(buf)) out.push(buf);
      continue;
    }
    i += 1;
  }
  return [...new Set(out)];
}

interface UiFile {
  readonly rel: string;
  readonly literals: readonly string[];
}

/**
 * 真树上"含裸中文的 `src/ui/**` 文件 → 去重后的中文字面量"。
 *
 * **导出的理由**：清单文档（`docs/2026-10-01-i18n-尚未抽取的屏.md`）里那张表的计数必须与
 * 这条腿**用同一个扫描器**数出来 —— 否则"计数"就是第二份真相（手抄一遍，必然会漂）。
 * 这份导出让那份表可以被机械地重数一遍（报告里的数字就是这么来的），
 * 也让人可以在 node 里一行命令打印当前全量。
 */
export function scanUiLiterals(): readonly UiFile[] {
  return UI_FILES;
}

const UI_FILES: readonly UiFile[] = walkTs(join(REPO, 'src', 'ui'))
  .sort()
  .map((abs) => ({
    rel: abs.slice(REPO.length).split('\\').join('/'),
    literals: cjkLiterals(stripComments(readFileSync(abs).subarray(0, 4 * 1024 * 1024).toString('utf8'))),
  }));

/** 清单里登记的文件（从 markdown 表格里的 `src/...` 反引号路径生成式解析 —— 不手写第二份） */
const MANIFEST_TEXT = readFileSync(join(REPO, MANIFEST_REL)).subarray(0, 1024 * 1024).toString('utf8');
const MANIFEST_FILES: readonly string[] = [
  ...new Set(
    [...MANIFEST_TEXT.matchAll(/`(src\/ui\/[^`]+\.ts)`/g)]
      .map((m) => m[1])
      // 文档里会出现 `src/ui/**/*.ts` 这种**扫描面**的写法（不是一份具体文件）⇒ 它不是幽灵行
      .filter((p) => !p.includes('*')),
  ),
].sort();

/**
 * 判为"**已经抽干净**"的例外（P0 只剩这一个）——**必须同时满足**下面两条，缺一条就报红：
 *
 *  1. 它的文件路径在清单里被**显式标注**为"干净/特例"（本文件用 `CLEAN_DECLARED` 写死，
 *     并在清单 D 节里说明理由）；
 *  2. 它剩下的中文字面量**逐条**都能在 `zh.ts` 的**值**里找到（= 它只是那份文案的
 *     数据源/文档字段，不是散落的第二份中文）。
 *
 * `src/ui/fx-settings.ts` 就是这一档：P0 把它的 label/desc 降级成**文档字段**，
 * 值必须与中文表逐字相同（`tests/i18n/settings-overlay.test.ts` 另有一条腿三方对齐）。
 */
const CLEAN_DECLARED: readonly string[] = ['src/ui/fx-settings.ts'];

describe('★ 尚未抽取的屏：清单只能变短，不能变长', () => {
  it('锚点：扫描器真的在工作（既扫得到中文，也不把注释算进去）', () => {
    const withChinese = UI_FILES.filter((f) => f.literals.length > 0).map((f) => f.rel);
    expect(UI_FILES.length, 'src/ui 下一个 .ts 都没读到 ⇒ 路径写错').toBeGreaterThan(40);
    expect(withChinese.length, '一个含中文的 ui 文件都没扫到 ⇒ 扫描器失效').toBeGreaterThan(20);
    // 抽过的那一屏必须**不再**出现裸中文：设置小窗原来是"造元素时直接写中文字面量"，
    // P0 之后它的每一条都从表里取 ⇒ 这里断言"构造器体内不再有中文字面量"。
    // ⚠️ 判据面收在小窗**那一个函数**里，不是整个 `home.ts`：P0 **只**抽了设置小窗，
    //    首页菜单上那个 `设置` 按钮、掷硬币、图鉴、规则仍是裸中文（它们在清单 A 节里）。
    const homeSrc = readFileSync(join(REPO, 'src', 'ui', 'home.ts')).subarray(0, 4 * 1024 * 1024).toString('utf8');
    const overlayBody = functionBody(stripComments(homeSrc), 'settingsOverlayElement');
    expect(overlayBody.length, 'functionBody 抽到空片段 ⇒ 本判据假绿').toBeGreaterThan(400);
    expect(
      cjkLiterals(overlayBody),
      `设置小窗的构造器里还有裸中文字面量：${cjkLiterals(overlayBody).join(' / ')}`
      + '（它的每一条文案都应该从 `src/i18n/` 取）',
    ).toEqual([]);
    // 反向自证：那个扫描器对这个文件不是恒空（它还有 90 多条别的屏的中文）
    const home = UI_FILES.find((f) => f.rel === 'src/ui/home.ts');
    expect(home?.literals.length, 'home.ts 一条中文都没有 ⇒ 上面那条"抽干净了"是废话').toBeGreaterThan(50);
    // 反控：注释里的中文不算（`stripComments` 生效）
    expect(cjkLiterals(stripComments('// 这是注释里的中文\nexport const a = 1;'))).toEqual([]);
    expect(cjkLiterals("export const a = '中文';")).toEqual(['中文']);
  });

  it('清单解析自检：真的解析到了那些行（否则下面两条判据在空集合上恒真）', () => {
    expect(MANIFEST_FILES.length, '清单里一个 src/ui 路径都没解析到').toBeGreaterThan(20);
    expect(MANIFEST_FILES).toContain('src/ui/render.ts');
    expect(MANIFEST_FILES).toContain('src/ui/net-lobby.ts');
    expect(MANIFEST_FILES).toContain('src/ui/local-data.ts');
  });

  it('① 每一个含中文的 `src/ui/**` 文件都在清单里（新屏没登记 ⇒ 报红）', () => {
    const missing = UI_FILES
      .filter((f) => f.literals.length > 0 && !CLEAN_DECLARED.includes(f.rel))
      .map((f) => f.rel)
      .filter((rel) => !MANIFEST_FILES.includes(rel));
    expect(
      missing,
      '以下文件里有裸中文字面量，但**没有**登记进 `' + MANIFEST_REL + '`：\n'
      + missing.map((m) => `  - ${m}`).join('\n')
      + '\n处置：要么把该屏抽进 `src/i18n/`（抽完把它的行划掉），要么先把它登记进清单。',
    ).toEqual([]);
  });

  it('② 清单里不许有幽灵行（表里指的文件必须真的存在）', () => {
    const known = new Set(UI_FILES.map((f) => f.rel));
    const ghosts = MANIFEST_FILES.filter((rel) => !known.has(rel));
    expect(ghosts, `清单里这些行指向不存在的文件：${ghosts.join(', ')}`).toEqual([]);
  });

  it('③ 清单里**不含中文**的文件不许被登记成"待抽"（划掉之后要把那一行也拿走）', () => {
    // 反向：一个已经抽干净的文件若还留在清单里，那"清单只能变短"就没有判据面 ——
    // 谁都可以把抽完的屏留在表里假装还没做。这里要求：表里的文件要么还有中文，
    // 要么在 `CLEAN_DECLARED` 里（那种文件在 D 节里说明理由）。
    const wrong = UI_FILES
      .filter((f) => f.literals.length === 0 && MANIFEST_FILES.includes(f.rel) && !CLEAN_DECLARED.includes(f.rel))
      .map((f) => f.rel);
    // ⚠️ 这一条**当前允许**"已划掉但没删行"的中间态：清单里用 `[x]` 标注的行是"已抽取但保留
    //    记录"。所以它只对"代码位里一个中文都没有"的文件报红 —— 那种文件留在 A/B 表里
    //    说明那一行忘了划、也忘了删。
    expect(
      wrong,
      `这些文件已经没有裸中文了，却还登记在清单里：${wrong.join(', ')}。`
      + '抽完就该把那一行连同计数一起删掉（清单只准变短）。',
    ).toEqual([]);
  });

  it('④ "干净"例外必须自证：它的中文字面量逐条都来自 `zh.ts` 的值', () => {
    const zhValues = new Set(Object.values(ZH));
    for (const rel of CLEAN_DECLARED) {
      const f = UI_FILES.find((x) => x.rel === rel);
      expect(f, `CLEAN_DECLARED 里的 ${rel} 不在扫描面里（幽灵例外）`).toBeDefined();
      expect(f?.literals.length, `${rel} 被判为"干净"却一个中文都没有 ⇒ 这条例外该删了`)
        .toBeGreaterThan(0);
      const strays = (f?.literals ?? []).filter((s) => !zhValues.has(s));
      expect(
        strays,
        `${rel} 被判为"干净"，但这些中文字面量不在 \`zh.ts\` 的值里（= 散落的第二份文案）：`
        + `${strays.join(' / ')}`,
      ).toEqual([]);
    }
  });

  it('清单文件本身存在且说明了口径（不是一张光秃秃的表）', () => {
    expect(MANIFEST_TEXT.length, '清单文件是空的').toBeGreaterThan(1000);
    for (const anchor of ['只准变短', 'src/data/cards', '显示层翻译表']) {
      expect(MANIFEST_TEXT, `清单里没有说明「${anchor}」这一条口径`).toContain(anchor);
    }
  });
});
