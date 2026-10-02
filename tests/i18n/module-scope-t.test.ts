/**
 * ★ 2026-10-02（英文模式真机走查 B6）：**模块顶层的 `t()` 一律不许有**。
 *
 * ## 为什么这条腿必须有（它是本轮最难查的一族 i18n 缺陷）
 *
 * `t()` 读的是**那一刻**的语言（模块级内存态）。写在**模块作用域**（函数体之外）的 `t()`
 * 在**模块被 import 的那一刻**求值 —— 而 `initI18n(...)` 是在 `src/main.ts` 里、**import 之后**
 * 才跑的 ⇒ 那个值被**冻在默认中文**上。之后切到英文，屏上那一处照旧是中文。
 *
 * 走查实测的现场：`src/ui/net-lobby.ts` 的 `PASTE_SHAPE_HINT`（模块级常量）
 * ⇒ 英文模式下加入方那一屏的 `.net-lobby-paste-hint` 是中文，而同屏其它文案都是英文。
 *
 * 这一族为什么**没有一条既有腿抓得到**：
 *  - 键在两张表里都有、英文值也正确（不是缺键）；
 *  - 值非空、占位符也对（不是占位符漏传）；
 *  - 屏上确实渲染了那个键的内容（不是"没接上"）。
 *  缺陷只在**求值时机**上，所以判据只能是"这个调用点在哪一层"。
 *
 * ## 判据的口径
 *
 * 扫 `src/**\/*.ts`（**排除 `src/i18n/**`**：那一层是表与 `t()` 自己的定义），剥注释之后
 * 逐个 `t(` 调用点判断它是否落在**函数体**内。落在函数体外的 ⇒ 报红，逐处点名文件与行号。
 *
 * ## "函数体"的识别（这一层是**文本启发式**，边界如实写在这里）
 *
 * 不用 TypeScript 编译器：本仓的 `typescript` 是 7.x 的**原生预览版**，它的包导出面里
 * 没有经典的解析 API（`.` 指向 `lib/version.cjs`），只有 `unstable/*` —— 一条门禁腿压在
 * `unstable` 上不如自己写清楚。识别规则只有三条：
 *
 *  1. `=> {` ⇒ 那一对花括号是函数体；
 *  2. **返回类型标注之后的花括号**（`…): T {`）⇒ 往回找到参数表的 `)` 与它的 `(`，
 *     再看那个 `(` 前面的标识符：是 `if` / `for` / `while` / `switch` / `catch` / `with`
 *     就**不是**函数体（顶层 `if (x) { const a = t('…') }` 因此照样报红），否则是；
 *  3. `=> <表达式>`（没有花括号）⇒ 从 `=>` 到这一段表达式结尾的区间算函数体内
 *     （`() => t('…')` 是**惰性**的，不是模块级求值 —— 第一版漏了这条，真树上 474 处误报）。
 *
 * 已知边界（有意接受，如实登记）：
 *  - **类字段初始化器**（`class A { x = t('…') }`）会被判成"函数体内"而不报红 ——
 *    它在**实例构造**时求值（不是模块加载），性质与函数体同族，当前真树零出现；
 *  - 模板串的 `${…}` 插值**按代码处理**（里面出现 `t()` 照样算），而字符串/模板串本身
 *    整段跳过 —— 第一版没给"跳过的那一段"填状态，于是 `\`${value}${t('…')}\`` 这种写法
 *    被误判成模块顶层（真树上两处误报，已修）；
 *  - 正则字面量里含未转义的花括号会打乱配平（方向是假红）；当前真树零出现。
 *
 * 反向验证：把 `src/ui/net-lobby.ts` 的 `pasteShapeHint()` 改回模块级常量
 * （`export const PASTE_SHAPE_HINT = t('net-lobby.paste.shape-hint', …)`）⇒ 这条腿当场红。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { stripComments } from '../ui/source-text';

const REPO = fileURLToPath(new URL('../../', import.meta.url));
const SRC = join(REPO, 'src');

/** 递归收集 `.ts`（不含 `.d.ts`） */
function walkTs(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { if (name !== 'node_modules') walkTs(p, out); }
    else if (name.endsWith('.ts') && !name.endsWith('.d.ts')) out.push(p);
  }
  return out;
}

const I18N_PREFIX = 'src/i18n/';

/**
 * 判据面：`src/**` 减去 `src/i18n/**`。
 *
 * 为什么减掉那一层：`t()` 的**定义**就在 `src/i18n/index.ts`，两张表在 `zh.ts` / `en.ts`
 * —— 它们不是"调用点"。与 `tests/i18n/tables.test.ts` 的 `CONSUMERS` 同一条口径。
 */
const FILES = walkTs(SRC)
  .map((abs) => ({ rel: abs.slice(REPO.length).split('\\').join('/'), code: stripComments(readFileSync(abs).subarray(0, 4 * 1024 * 1024).toString('utf8')) }))
  .filter((f) => !f.rel.startsWith(I18N_PREFIX))
  .sort((a, b) => (a.rel < b.rel ? -1 : 1));

/** 控制关键字：`if (x) { … }` 那种块**不是**函数体 */
const CONTROL_KEYWORDS = new Set(['if', 'for', 'while', 'switch', 'catch', 'with']);

/** 跳过一段字符串/模板串，返回引号之后的下标 */
function skipString(code: string, i: number): number {
  const quote = code[i];
  i += 1;
  while (i < code.length) {
    if (code[i] === '\\') { i += 2; continue; }
    if (code[i] === quote) return i + 1;
    i += 1;
  }
  return i;
}

/** 从 `)`（下标 close）反向配平到它的 `(` */
function matchParenBack(code: string, close: number): number {
  let depth = 0;
  for (let i = close; i >= 0; i -= 1) {
    if (code[i] === ')') depth += 1;
    else if (code[i] === '(') { depth -= 1; if (depth === 0) return i; }
  }
  return -1;
}

/** `{`（下标 open）是不是**函数体**（规则 2：往回找参数表，再看那个 `(` 的头） */
function isFunctionBody(code: string, open: number): boolean {
  let j = open - 1;
  let nested = 0;
  let steps = 0;
  let paren = -1;
  while (j >= 0 && steps < 400) {
    steps += 1;
    const c = code[j];
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { j -= 1; continue; }
    if (c === '}') { nested += 1; j -= 1; continue; }
    if (c === '{') { if (nested === 0) return false; nested -= 1; j -= 1; continue; }
    if (c === ')' && nested === 0) { paren = j; break; }
    if (nested > 0) { j -= 1; continue; }
    if (/[A-Za-z0-9_$.,<>|&?[\]:]/.test(c)) { j -= 1; continue; }
    return false;
  }
  if (paren < 0) return false;
  const openParen = matchParenBack(code, paren);
  if (openParen < 0) return false;
  let k = openParen - 1;
  while (k >= 0 && /\s/.test(code[k])) k -= 1;
  if (k < 0) return true;
  if (!/[A-Za-z0-9_$]/.test(code[k])) return true;
  let e = k;
  while (e >= 0 && /[A-Za-z0-9_$]/.test(code[e])) e -= 1;
  return !CONTROL_KEYWORDS.has(code.slice(e + 1, k + 1));
}

/** 全部**函数体花括号**的下标 */
function functionBodyOpens(code: string): Set<number> {
  const opens = new Set<number>();
  for (let i = 0; i < code.length; i += 1) {
    const c = code[i];
    if (c === "'" || c === '"' || c === '`') { i = skipString(code, i) - 1; continue; }
    if (c !== '{') continue;
    let j = i - 1;
    while (j >= 0 && /\s/.test(code[j])) j -= 1;
    if (j >= 0 && code[j] === '>') { // 规则 1：`=> {`
      let k = j - 1;
      while (k >= 0 && /\s/.test(code[k])) k -= 1;
      if (k >= 0 && code[k] === '=') { opens.add(i); continue; }
    }
    if (isFunctionBody(code, i)) opens.add(i);
  }
  return opens;
}

/** 规则 3：`=> <表达式>`（没有花括号）的区间 */
function arrowExprRanges(code: string): Array<readonly [number, number]> {
  const ranges: Array<readonly [number, number]> = [];
  for (let i = 0; i + 1 < code.length; i += 1) {
    const c = code[i];
    if (c === "'" || c === '"' || c === '`') { i = skipString(code, i) - 1; continue; }
    if (c !== '=' || code[i + 1] !== '>') continue;
    const prev = i === 0 ? '' : code[i - 1];
    if (prev === '=' || prev === '!' || prev === '<' || prev === '>') continue;
    let j = i + 2;
    while (j < code.length && /\s/.test(code[j])) j += 1;
    if (code[j] === '{') continue; // 块体：走规则 1 / 2
    let depth = 0;
    for (; j < code.length; j += 1) {
      const d = code[j];
      if (d === "'" || d === '"' || d === '`') { j = skipString(code, j) - 1; continue; }
      if (d === '(' || d === '[' || d === '{') { depth += 1; continue; }
      if (d === ')' || d === ']' || d === '}') { if (depth === 0) break; depth -= 1; continue; }
      if (depth === 0 && (d === ',' || d === ';')) break;
    }
    ranges.push([i, j]);
  }
  return ranges;
}

/** 一个文件里**模块顶层**的 `t(` 调用（人读的 `路径:行号` 列表） */
export function moduleScopeTCalls(code: string, rel: string): string[] {
  const fnOpens = functionBodyOpens(code);
  const inArrow = new Array<boolean>(code.length).fill(false);
  for (const [a, b] of arrowExprRanges(code)) for (let k = a; k < b; k += 1) inArrow[k] = true;
  const inside = new Array<boolean>(code.length).fill(false);
  const stack: boolean[] = [];
  for (let i = 0; i < code.length; i += 1) {
    const c = code[i];
    if (c === "'" || c === '"' || c === '`') {
      // ⚠️ 跳过的这一段也要**填上当前状态**：模板串的 `${…}` 里是真代码
      const end = skipString(code, i);
      for (let k = i; k < end; k += 1) inside[k] = stack.some(Boolean) || inArrow[k];
      i = end - 1;
      continue;
    }
    if (c === '{') stack.push(fnOpens.has(i));
    else if (c === '}') stack.pop();
    inside[i] = stack.some(Boolean) || inArrow[i];
  }
  const out: string[] = [];
  for (let i = 0; i < code.length; i += 1) {
    if (code[i] !== 't' || code[i + 1] !== '(') continue;
    const prev = i === 0 ? '' : code[i - 1];
    if (/[A-Za-z0-9_$.]/.test(prev)) continue;
    if (inside[i]) continue;
    out.push(`${rel}:${String(code.slice(0, i).split('\n').length)}：${code.slice(i, i + 60).split('\n')[0]?.trim() ?? ''}`);
  }
  return out;
}

describe('★ 模块顶层的 `t()` 一律不许有（语言会被冻在 import 那一刻）', () => {
  it('锚点：判据面真的扫到了大量 `t()` 调用（否则下面那条在空集上恒真）', () => {
    expect(FILES.length, 'src 下一个 .ts 都没读到 ⇒ 路径写错').toBeGreaterThan(50);
    const total = FILES.reduce((n, f) => n + (f.code.match(/(?:^|[^A-Za-z0-9_$.])t\(/g) ?? []).length, 0);
    expect(total, '一个 t() 调用都没扫到 ⇒ 这条腿没在防任何东西').toBeGreaterThan(300);
    // 反向锚点：i18n 那一层确实被排除在外（它是 t() 的定义处，不是调用点）
    expect(FILES.some((f) => f.rel === 'src/i18n/index.ts'), 'i18n 层没有被排除').toBe(false);
    expect(FILES.some((f) => f.rel === 'src/ui/net-lobby.ts'), 'net-lobby.ts 不在判据面里').toBe(true);
  });

  it('真树：零处模块顶层 `t()`（出现即红，逐处点名文件与行号）', () => {
    const bad = FILES.flatMap((f) => moduleScopeTCalls(f.code, f.rel));
    expect(
      bad,
      '这些 `t()` 写在模块作用域里 —— 它们在模块被 import 的那一刻求值，'
      + '而 `initI18n()` 在那之后才跑 ⇒ 语言被冻在默认中文上（英文模式下屏上照旧是中文）：\n'
      + bad.join('\n')
      + '\n处置：改成**取值函数**（`export function xText(): string { return t(\'键\'); }`），'
      + '或在**渲染点**内联 `t(\'字面量键\')`。',
    ).toEqual([]);
  });

  it('★ 正控（合成源码）：三种模块顶层形态必须都报红，四种函数体内的都不许报', () => {
    const hit = (src: string): string[] => moduleScopeTCalls(stripComments(src), 'synth.ts');
    // 走查抓到的那个形态（模块级常量）
    expect(hit("export const HINT = t('net-lobby.paste.shape-hint', { prefix: 'x' });\n"), '模块级常量没被报出来').not.toEqual([]);
    // 模块级对象字面量里
    expect(hit("export const O = { a: t('settings.title') };\n"), '模块级对象字面量里的 t() 没被报出来').not.toEqual([]);
    // 模块级模板串插值里
    expect(hit('export const S = `x${t(\'settings.title\')}y`;\n'), '模块级模板串插值里的 t() 没被报出来').not.toEqual([]);
    // 顶层 if 块里（`if` 不是函数）
    expect(hit("if (Math.random() > 0.5) { const a = t('settings.title'); }\n"), '顶层 if 块里的 t() 没被报出来').not.toEqual([]);

    // 四种"惰性"形态：一律不许报
    expect(hit("export function f(): string { return t('settings.title'); }\n"), '函数声明体里被误报').toEqual([]);
    expect(hit("const f = (): string => { return t('settings.title'); };\n"), '块体箭头里被误报').toEqual([]);
    expect(hit("const f = () => t('settings.title');\n"), '表达式体箭头里被误报').toEqual([]);
    expect(hit("const o = { m(): string { return t('settings.title'); } };\n"), '对象方法体里被误报').toEqual([]);
    // 函数体内的模板串插值也要判成"在函数里"（真树上两处误报就是这一条）
    expect(hit('function f(): string { return `x${t(\'settings.title\')}y`; }\n'), '函数体内模板串插值里被误报').toEqual([]);
    // 函数体内的 `catch` / `if` 块（块体不是函数体，但外层函数体仍然包着它）
    expect(hit("function f(): string { if (x) { return t('settings.title'); } return ''; }\n"), '函数体内 if 块被误报').toEqual([]);
    expect(hit("function f(): string { try { return t('settings.title'); } catch (e) { return ''; } }\n"), '函数体内 try/catch 被误报').toEqual([]);
  });
});
