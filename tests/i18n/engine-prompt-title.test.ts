/**
 * ★ 2026-10-02（P5）：**引擎 `prompt.title` 的显示层本地化** —— 生成式完整性腿 + 回退腿。
 *
 * ## 被钉住的是什么
 *
 * `src/core/**` 里 `yield` 的选择请求带的 `prompt.title` 是**引擎文案**
 * （`life-1：翻转1张牌` 那种），它是红线（联机两端逐字一致 + 大量测试逐字钉着它）。
 * 英文化只能在**显示层**做：`src/i18n/engine-prompt.ts` 的 `enginePromptTitle()`
 * —— 中文逐字回原文，英文命中模式表则英文，**命中不了回退引擎原文**。
 *
 * 本文件是那件事的**机检判据面**。腿⑤（覆盖）是**生成式**的：它把扫描面里每一个
 * prompt 标题从**源码**重新抽一遍（口径与探路脚本 `.superpowers/engine-prompt/extract.mjs`
 * 同源：剥注释 → 找 `kind: 'select*'` 的对象 → 读它的 `title`），再逐条喂给**真产出函数**
 * `enginePromptTitle()`：
 *
 *  - 抽出来的标题**必须**命中模式表（英文侧零汉字），否则报红并**点名标题 + 出处文件:行**；
 *    确有意保留中文的，逐条登记进 `RETAINED_ENGINE_TITLES` 并写明理由（**只准变短**）。
 *  - 抽出来的**参数来源**（`${n}` / `${label}` / `${verb}`…）必须是已知来源；冒出一个新的
 *    参数名 ⇒ 报红（否则它会带着中文原样拼进英文句子）。
 *  - 反向：模式表里的每一条**都必须**有标题能命中它（先加模式后接引擎 ⇒ 红）。
 *  - 反向：`RETAINED_ENGINE_TITLES` 里不许留"其实已经能命中"的陈旧条目。
 *
 * ## ★ 2026-10-02（收官走查的漏网修复）：扫描面从 `src/core/effects/**` 扩到 `src/core/**`
 *
 * 原来这条腿只扫 `src/core/effects/**` —— 那是 P5 当时的边界（效果卡都在那里）。
 * 代价在收官走查里被实测到：`src/core/game.ts:348` 的**清理缓存**提示
 * （`清理缓存：弃 ${excess} 张牌（手牌超过 5 张上限）`，真机 J4 帧上可见）**没有任何腿盯着**
 * —— `enginePromptTitle()` 命中不了就按设计回退引擎原文，于是它一直是中文，
 * 而所有生成式腿都在空集上恒绿。
 * ⇒ 扫描面改成 `src/core/**`（覆盖 `game.ts` / `actions/**` / `rules/**` /
 * `engine/**` / `state/**` / `models/**` 与 `effects/**`），口径不变（还是"剥注释 →
 * `kind: 'select*'` 对象 → 它的 `title`"）。
 *
 * ## 这一条腿**覆盖不到什么**（如实声明）
 *
 *  - 只认**字面量/模板串**直接写在 `title:` 上的标题；`title: someVar` 这类间接赋值、
 *    三元里非字面量的分支、以及 `prompt.title = …` 这种**事后改写**都抽不到
 *    （`splitTernary` 只认三元链上的字符串字面量分支）；
 *  - 只认 `kind: 'select' | 'select-line' | 'select-action'` 这**三种**对象里紧挨着的 `title:`；
 *    将来若多一种 `kind` 或把标题放到别的字段名上，这里会静默漏掉（那时要跟着改口径）；
 *  - **不认运行期拼出来的标题**：两个字符串相加（`'甲' + '乙'`）或从数据表里读来的中文
 *    都抽不到；
 *  - 它只保证"命中模式表 ⇒ 英文侧零汉字"，**不保证**屏上那一句真的走了
 *    `enginePromptTitle()`（那是 `src/ui/render.ts` / `render-net.ts` / `src/main.ts`
 *    三个来源点的接线条，`tests/i18n/choice-bar-en.test.ts` 与真机走查各钉了一半）。
 *
 * ## 为什么"覆盖"这条腿必须从源码抽，而不是手写一张标题清单
 *
 * 手写清单会在"引擎改了字面 / 新增一张带 prompt 的卡"时**静默过期** —— 那正是英文界面里
 * 重新冒出中文的唯一入口。从源码抽 + 逐条喂真函数，才能让"漂移"变成红的。
 *
 * ## 为什么"中文侧"那条腿是恒等式
 *
 * 中文模式直接 `return title`（见 `engine-prompt.ts`），所以这条腿在实现上不可能假红；
 * 它钉的是**将来有人把中文侧也接进拼接**这件事（那会让中文渲染结果回归）。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ENGINE_PROMPT_KEYS, enginePromptTitle, setLang } from '../../src/i18n';
import { EN } from '../../src/i18n/en';
import { ZH } from '../../src/i18n/zh';

const REPO = fileURLToPath(new URL('../../', import.meta.url));
/**
 * ★ 2026-10-02（收官走查的漏网修复）：扫描面 = **整个 `src/core/**`**（原来只有 `effects/**`）。
 * `EFFECTS` 留着，只给"读某一张卡的源码"这类按目录取文件的腿用（例如 `chaos.ts`）。
 */
const CORE = join(REPO, 'src', 'core');
const EFFECTS = join(CORE, 'effects');

afterEach(() => {
  setLang('zh');
});

/* ══════════════════════ 1. 从源码抽 prompt 标题（生成式） ══════════════════════ */

/** 剥注释。**保留换行**（报错要点出文件:行，行号不能因为剥掉块注释里的换行而漂）。 */
function stripComments(src: string): string {
  let out = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') {
      while (i < n && src[i] !== '\n') i += 1;
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      i += 2;
      let nl = '';
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) {
        if (src[i] === '\n') nl += '\n';
        i += 1;
      }
      i += 2;
      out += nl;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      const q = c;
      out += c;
      i += 1;
      while (i < n) {
        if (src[i] === '\\') {
          out += src[i] + (src[i + 1] ?? '');
          i += 2;
          continue;
        }
        out += src[i];
        if (src[i] === q) {
          i += 1;
          break;
        }
        i += 1;
      }
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith('.ts') && !name.endsWith('.d.ts')) out.push(p);
  }
  return out;
}

/** `start`（`{`）起配对的 `}` 之间的对象体 */
function objectBody(code: string, start: number): string {
  let depth = 0;
  for (let i = start; i < code.length; i += 1) {
    const c = code[i];
    if (c === "'" || c === '"' || c === '`') {
      const q = c;
      i += 1;
      while (i < code.length) {
        if (code[i] === '\\') {
          i += 2;
          continue;
        }
        if (code[i] === q) break;
        i += 1;
      }
      continue;
    }
    if (c === '{') depth += 1;
    else if (c === '}') {
      depth -= 1;
      if (depth === 0) return code.slice(start + 1, i);
    }
  }
  return '';
}

/** 对象体里顶层属性 `name` 的原文（到这一层的 `,` / `}` 为止） */
function propText(body: string, name: string): string | null {
  let depth = 0;
  for (let i = 0; i < body.length; i += 1) {
    const c = body[i];
    if (c === "'" || c === '"' || c === '`') {
      const q = c;
      i += 1;
      while (i < body.length) {
        if (body[i] === '\\') {
          i += 2;
          continue;
        }
        if (body[i] === q) break;
        i += 1;
      }
      continue;
    }
    if (c === '(' || c === '[' || c === '{') depth += 1;
    else if (c === ')' || c === ']' || c === '}') depth -= 1;
    else if (depth === 0 && body.startsWith(`${name}:`, i) && (i === 0 || /[\s,{]/.test(body[i - 1]))) {
      let j = i + name.length + 1;
      let d2 = 0;
      let buf = '';
      for (; j < body.length; j += 1) {
        const c2 = body[j];
        if (c2 === "'" || c2 === '"' || c2 === '`') {
          const q = c2;
          buf += c2;
          j += 1;
          while (j < body.length) {
            if (body[j] === '\\') {
              buf += body[j] + (body[j + 1] ?? '');
              j += 2;
              continue;
            }
            buf += body[j];
            if (body[j] === q) break;
            j += 1;
          }
          continue;
        }
        if (c2 === '(' || c2 === '[' || c2 === '{') d2 += 1;
        if (c2 === ')' || c2 === ']' || c2 === '}') d2 -= 1;
        if (c2 === ',' && d2 === 0) break;
        buf += c2;
      }
      return buf.trim();
    }
  }
  return null;
}

/** 把 `a ? b : c` 拆成顶层分支（三元链）；不是三元就返回单元素 */
function splitTernary(expr: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let cur = '';
  for (let i = 0; i < expr.length; i += 1) {
    const c = expr[i];
    if (c === "'" || c === '"' || c === '`') {
      const q = c;
      cur += c;
      i += 1;
      while (i < expr.length) {
        if (expr[i] === '\\') {
          cur += expr[i] + (expr[i + 1] ?? '');
          i += 2;
          continue;
        }
        cur += expr[i];
        if (expr[i] === q) break;
        i += 1;
      }
      continue;
    }
    if (c === '(' || c === '[' || c === '{') depth += 1;
    if (c === ')' || c === ']' || c === '}') depth -= 1;
    if (c === '?' && depth === 0) {
      parts.push(cur);
      cur = '';
      continue;
    }
    if (c === ':' && depth === 0 && parts.length > 0) {
      parts.push(cur);
      cur = '';
      continue;
    }
    cur += c;
  }
  parts.push(cur);
  return parts.map((p) => p.trim()).filter((p) => p !== '');
}

/** 字面量/模板串 → `{ text: 带 \u0000 占位标记, exprs: 占位里的表达式 }`；不是字面量返回 null */
function literalText(x: string): { readonly text: string; readonly exprs: readonly string[] } | null {
  const s = x.trim();
  const quoted = (s.startsWith("'") && s.endsWith("'")) || (s.startsWith('"') && s.endsWith('"'));
  const templated = s.startsWith('`') && s.endsWith('`');
  if (!quoted && !templated) return null;
  const inner = s.slice(1, -1);
  if (!templated) return { text: inner, exprs: [] };
  const exprs: string[] = [];
  const text = inner.replace(/\$\{([^}]*)\}/g, (_all, e: string) => {
    exprs.push(e.trim());
    return '\u0000';
  });
  return { text, exprs };
}

interface RawTitle {
  readonly rel: string;
  /** 1-based 行号（`title:` 那一行） */
  readonly line: number;
  readonly kind: string;
  readonly text: string;
  readonly exprs: readonly string[];
}

function collectRawTitles(): RawTitle[] {
  const out: RawTitle[] = [];
  for (const abs of walk(CORE)) {
    const rel = abs.slice(REPO.length).split('\\').join('/');
    const code = stripComments(readFileSync(abs).subarray(0, 4 * 1024 * 1024).toString('utf8'));
    for (const m of code.matchAll(/kind:\s*'(select|select-line|select-action)'/g)) {
      const at = m.index ?? 0;
      let b = -1;
      let depth = 0;
      for (let i = at; i >= 0; i -= 1) {
        const c = code[i];
        if (c === '}' || c === ')' || c === ']') depth += 1;
        else if (c === '{' || c === '(' || c === '[') {
          if (depth === 0 && c === '{') {
            b = i;
            break;
          }
          depth -= 1;
        }
      }
      if (b < 0) continue;
      const body = objectBody(code, b);
      const titleAt = body.indexOf('title:');
      const info = literalText(propText(body, 'title') ?? '');
      const branches = info === null ? splitTernary(propText(body, 'title') ?? '').slice(1) : [];
      if (info !== null) {
        // ⚠️ 行号报的是 **`title:` 那一行**（不是对象 `{` 那一行）：多行对象（如
        //    `src/core/game.ts` 的 `cacheClearGen`）靠它才能被一眼定位。
        out.push({
          rel,
          line: titleAt < 0 ? code.slice(0, b).split('\n').length : code.slice(0, b + 1 + titleAt).split('\n').length,
          kind: m[1],
          text: info.text,
          exprs: info.exprs,
        });
        continue;
      }
      for (const br of branches) {
        const lit = literalText(br);
        if (lit === null) continue;
        out.push({ rel, line: code.slice(0, b + 1 + titleAt).split('\n').length, kind: m[1], text: lit.text, exprs: lit.exprs });
      }
    }
  }
  return out;
}

/* ══════════════════════ 2. 参数取样（新的参数来源 ⇒ 报红） ══════════════════════ */

/** `chaos1Session(..., '你的' | '对手的')`：这两个标签**本身是中文**，见 `engine-prompt.ts` 的词表 */
const CHAOS_LABELS: readonly string[] = ['你的', '对手的'];

/**
 * `controlRearrangeFlow(s, chooser, '<defId> <刷新|编译>')`：第三参从**调用点**读
 * —— 引擎将来多一种动词，这里就会多一个取样值，拼出来的英文若带汉字 ⇒ 覆盖腿报红。
 */
function verbSamples(): string[] {
  const out = new Set<string>();
  for (const abs of walk(CORE)) {
    const code = stripComments(readFileSync(abs).subarray(0, 4 * 1024 * 1024).toString('utf8'));
    for (const m of code.matchAll(/controlRearrangeFlow\((?:[^()]|\([^()]*\))*?'([^']+)'\s*\)/g)) out.add(m[1]);
  }
  return [...out].sort();
}

/** 纯数字型表达式（`n` / `k` / `need` / `line + 1` / `holder + 1` / `side + 1` / `ctx.card.line`…） */
const NUMERIC_EXPR = /^[A-Za-z_$][\w$.]*(?:\s*[+-]\s*\d+)?$/;

/** 一个参数表达式 → 取样值；**不认识 ⇒ null**（覆盖腿上单独报红，点名文件:行与表达式） */
function samplesForExpr(expr: string): readonly string[] | null {
  if (expr === 'label') return CHAOS_LABELS;
  if (expr === 'verb') return verbSamples();
  if (expr === 'who') return ['P1'];
  if (NUMERIC_EXPR.test(expr)) return ['3'];
  return null;
}

interface Sample {
  readonly title: string;
  readonly rel: string;
  readonly line: number;
}

function instantiate(raw: RawTitle): Sample[] {
  let acc: string[] = [raw.text];
  for (const expr of raw.exprs) {
    const values = samplesForExpr(expr) ?? [];
    const next: string[] = [];
    for (const prefix of acc) {
      for (const v of values) next.push(prefix.replace('\u0000', v));
    }
    acc = next;
  }
  return acc.map((title) => ({ title, rel: raw.rel, line: raw.line }));
}

const RAW = collectRawTitles();
const UNKNOWN_EXPRS = RAW.flatMap((r) => r.exprs.filter((e) => samplesForExpr(e) === null).map((e) => `${r.rel}:${r.line} 的 \${${e}}`));
const SAMPLES: readonly Sample[] = (() => {
  const seen = new Map<string, Sample>();
  for (const raw of RAW) for (const s of instantiate(raw)) if (!seen.has(s.title)) seen.set(s.title, s);
  return [...seen.values()];
})();

/**
 * 英文模式下**有意保留中文**的引擎标题（逐条写理由）。
 *
 * 现在是**空的** —— 204 条模式把扫描面（`src/core/**`）里的 prompt 站点全盖住了。
 * 这一张表留着是为了"将来确实做不了"时有地方登记：登记即意味着**屏上仍是中文**，
 * 所以每条都必须写理由，而且只准变短（已经能命中的条目留着 ⇒ 报红）。
 */
const RETAINED_ENGINE_TITLES: ReadonlyMap<string, string> = new Map<string, string>();

/* ══════════════════════ 3. 腿 ══════════════════════ */

describe('★ P5：引擎 prompt.title 的显示层本地化（生成式）', () => {
  it('扫描面自检：真的从 `src/core/**` 抽到了 prompt 标题与取样（否则下面每条腿都在空集上恒真）', () => {
    expect(RAW.length, '一个 prompt 标题都没抽到 ⇒ 抽取器或路径写错').toBeGreaterThan(250);
    expect(SAMPLES.length, '取样条数太少 ⇒ 参数实例化塌了').toBeGreaterThan(250);
    expect(RAW.some((r) => r.rel.includes('/cards/')), '没扫到 cards/**').toBe(true);
    expect(RAW.some((r) => r.rel.includes('control-rearrange-flow.ts')), '没扫到共用流程那三条').toBe(true);
    expect(verbSamples().length, 'controlRearrangeFlow 的动词取样是空的').toBeGreaterThan(0);
    // ★ 2026-10-02（收官走查的漏网修复）：扫描面必须真的扩到了 `effects/**` **之外** ——
    //   否则"扩面"只是自我声明，`src/core/game.ts` 那条又会回到"没人盯"的状态。
    expect(RAW.some((r) => r.rel === 'src/core/game.ts'), '扫描面没扩到 `src/core/game.ts`（清理缓存那条提示又没人盯了）').toBe(true);
    // 反向锚点：`effects/**` 之外**确实有**标题被抽到（不是"恰好一条都没有"）
    expect(RAW.filter((r) => !r.rel.startsWith('src/core/effects/')).length, '`src/core/effects/**` 之外一条标题都没抽到 ⇒ 扩面没生效')
      .toBeGreaterThan(0);
    // 扩面之后 `actions/**` / `rules/**` 也在扫描面里（当前它们**一条 select 标题都没有** ——
    // 这条腿钉的是"路径真的走到了那两个目录"，不是"它们一定有标题"）
    for (const dir of ['src/core/actions/', 'src/core/rules/']) {
      expect(walk(join(REPO, dir)).length, `${dir} 下一个 .ts 都没读到 ⇒ 扩面的路径写错`).toBeGreaterThan(0);
    }
  });

  it('参数来源全都认识（冒出一个新参数名 ⇒ 报红并点名文件:行）', () => {
    expect(
      UNKNOWN_EXPRS,
      `这些标题里的运行期参数没有取样口径（新参数可能带着中文拼进英文句子）：\n  ${UNKNOWN_EXPRS.join('\n  ')}`
      + '\n处置：在 samplesForExpr() 里给它一个取样值（数字给 \'3\'；中文标签要在 engine-prompt.ts 的 TOKEN_EN 里加词）。',
    ).toEqual([]);
  });

  it('★ 覆盖：每一个引擎标题在英文模式下都命中模式表（点名没命中的标题 + 出处；有意保留的必须逐条登记）', () => {
    setLang('en');
    const uncovered: string[] = [];
    const cjk: string[] = [];
    for (const s of SAMPLES) {
      const out = enginePromptTitle(s.title);
      const retained = RETAINED_ENGINE_TITLES.has(s.title);
      if (out === s.title) {
        if (!retained) uncovered.push(`${s.rel}:${s.line} 「${s.title}」`);
        continue;
      }
      if (/[\u3400-\u9fff]/.test(out)) cjk.push(`${s.rel}:${s.line} 「${s.title}」→「${out}」`);
    }
    expect(uncovered, `这些引擎标题没有对应的 i18n 条目（英文界面下它们仍是中文）：\n  ${uncovered.join('\n  ')}`).toEqual([]);
    expect(cjk, `这些引擎标题的英文结果里仍夹着汉字：\n  ${cjk.join('\n  ')}`).toEqual([]);
  });

  it('★ 反向：`RETAINED_ENGINE_TITLES` 里不许留"其实已经能命中"的陈旧条目（它只准变短）', () => {
    setLang('en');
    const stale = SAMPLES.filter((s) => RETAINED_ENGINE_TITLES.has(s.title) && enginePromptTitle(s.title) !== s.title);
    expect(stale.map((s) => `${s.rel}:${s.line} 「${s.title}」`), '这些已登记"保留中文"，但它们其实已经能翻成英文了 ⇒ 从登记表里删掉').toEqual([]);
    for (const [title, why] of RETAINED_ENGINE_TITLES) {
      expect(why.trim().length, `登记条目「${title}」没有写理由`).toBeGreaterThan(0);
    }
  });

  it('★ 反向：模式表里每一条都必须有引擎标题能命中它（先加模式后接引擎 ⇒ 报红）', () => {
    setLang('en');
    const dead: string[] = [];
    for (const key of ENGINE_PROMPT_KEYS) {
      const pattern = ZH[key] ?? '';
      // 用真函数跑一条合成标题：`zz-9：<模式>`（`zz-9` 只是个形状合法的假 defId）
      const probe = pattern.replace(/\{label\}/g, '你的').replace(/\{verb\}/g, 'war-1 刷新').replace(/\{who\}/g, 'P1').replace(/\{n\}/g, '3');
      const out = enginePromptTitle(`zz-9：${probe}`);
      if (out === `zz-9：${probe}` || /[\u3400-\u9fff]/.test(out.slice(6))) dead.push(`${key} 「${pattern}」`);
    }
    expect(dead, `这些键在两张表里，但没有任何引擎标题能命中（要么引擎那边删了，要么模式串写歪了）：\n  ${dead.join('\n  ')}`).toEqual([]);
  });

  it('★ 中文侧逐字守恒：中文模式下 `enginePromptTitle` 返回的就是引擎原文（逐字节）', () => {
    setLang('zh');
    const changed = SAMPLES.filter((s) => enginePromptTitle(s.title) !== s.title);
    expect(changed.map((s) => `${s.rel}:${s.line} 「${s.title}」`), '中文模式下标题被改写了（中文渲染结果回归）').toEqual([]);
  });

  it('★ 回退：模式表里没有的标题 ⇒ 原样返回、不抛、不记缺键（英文模式下也不许白屏）', () => {
    setLang('en');
    const unknown = ['zz-9：这条标题不存在', '完全未知的标题', '', 'life-1：翻转1张牌（改过的字面）'];
    for (const u of unknown) {
      let out = '';
      expect(() => {
        out = enginePromptTitle(u);
      }, `喂未知标题「${u}」时抛了`).not.toThrow();
      expect(out, `未知标题「${u}」没有原样回退`).toBe(u);
    }
  });

  it('★ 回退：命中模式、但运行期参数带着**词表之外的汉字** ⇒ 整句退回引擎原文（不端半截中文上去）', () => {
    setLang('en');
    // `chaos-1` 的 `${label}` 走 `TOKEN_EN` 的词表；这里喂一个词表里没有的标签
    const hostile = 'chaos-1：重新排列某个未登记标签的协议（可多次交换，直到满意）';
    expect(enginePromptTitle(hostile)).toBe(hostile);
  });

  it('★ 漂移：`chaos1Session` 的中文标签 / `controlRearrangeFlow` 的动词 都在词表里（新增一个 ⇒ 红）', () => {
    setLang('en');
    const chaosSrc = readFileSync(join(EFFECTS, 'cards', 'chaos.ts')).subarray(0, 1024 * 1024).toString('utf8');
    const labels = [...chaosSrc.matchAll(/chaos1Session\([^)]*?'([^']+)'\s*\)/g)].map((m) => m[1]);
    expect(labels.length, 'chaos1Session 的调用点一个都没扫到').toBeGreaterThan(0);
    const bad: string[] = [];
    for (const label of labels) {
      const probe = `chaos-1：重新排列${label}的协议（可多次交换，直到满意）`;
      const out = enginePromptTitle(probe);
      if (/[\u3400-\u9fff]/.test(out)) bad.push(probe);
    }
    for (const verb of verbSamples()) {
      const probe = `${verb}：P1 持有控制组件（已归还中立）——可重排一名玩家的协议`;
      const out = enginePromptTitle(probe);
      if (/[\u3400-\u9fff]/.test(out)) bad.push(probe);
    }
    expect(bad, `这些参数值没有英文词（英文界面下会整句退回中文）：\n  ${bad.join('\n  ')}`).toEqual([]);
  });

  it('★ 人的读数锚点：用户举的那三条（含标记、含参数）逐字对得上', () => {
    setLang('en');
    expect(enginePromptTitle('life-1：翻转1张牌')).toBe('life-1: flip 1 card');
    expect(enginePromptTitle('spirit-2：你可以翻转1张牌')).toBe('spirit-2: you may flip 1 card');
    expect(enginePromptTitle('life-3（被盖住前）：在另一列反面打出牌堆顶')).toBe(
      'life-3 (before being covered): play the top of your deck face down in another line',
    );
    expect(enginePromptTitle('inertia-1：对手弃3张牌')).toBe('inertia-1: opponent discards 3 cards');
    expect(enginePromptTitle('luck-0：宣告1个数字（0-6）')).toBe('luck-0: declare a number (0-6)');
    // ★ 2026-10-02（收官走查的漏网修复）：`src/core/game.ts:348` 的清理缓存提示 ——
    //    引擎原文逐字照抄那一条模板串（`${excess}` 取 3），不许"顺口改成更顺的句子"。
    expect(enginePromptTitle('清理缓存：弃 3 张牌（手牌超过 5 张上限）')).toBe(
      'Clear cache: discard 3 cards (hand over the 5-card limit)',
    );
    // ⚠️ 这条的前缀是**引擎的真实措辞**：`chaos.ts` 的 `chaos1Session(ctx, player, '你的')`
    //    拼出来就是 `重新排列你的的协议`（两个「的」）—— 锚点照抄引擎，不照抄"应该长什么样"。
    expect(enginePromptTitle('chaos-1：重新排列你的的协议（可多次交换，直到满意）')).toBe(
      'chaos-1: rearrange your protocols (swap as many times as you like, until you are satisfied)',
    );
    expect(enginePromptTitle('war-1 刷新：P1 持有控制组件（已归还中立）——可重排一名玩家的协议')).toBe(
      "war-1 refresh: P1 holds the control component (returned to neutral) - you may rearrange one player's protocols",
    );
  });

  it('模式表自身：键与两张表逐条对应、占位符一一对应、英文值零汉字、没有同名占位符', () => {
    expect(ENGINE_PROMPT_KEYS.length, '模式表是空的').toBeGreaterThan(100);
    expect(new Set(ENGINE_PROMPT_KEYS).size, '模式表里有重复键').toBe(ENGINE_PROMPT_KEYS.length);
    const ph = (s: string): string[] => [...s.matchAll(/\{([A-Za-z0-9_]+)\}/g)].map((m) => m[1]).sort();
    const bad: string[] = [];
    for (const key of ENGINE_PROMPT_KEYS) {
      const zh = ZH[key];
      const en = EN[key];
      if (zh === undefined || en === undefined || zh.trim() === '' || en.trim() === '') {
        bad.push(`${key}：两张表里缺值`);
        continue;
      }
      if (ph(zh).join(',') !== ph(en).join(',')) bad.push(`${key}：占位符不一致 zh(${ph(zh)}) en(${ph(en)})`);
      if (new Set(ph(zh)).size !== ph(zh).length) bad.push(`${key}：同一个模式里有同名占位符`);
      if (/[\u3400-\u9fff]/.test(en)) bad.push(`${key}：英文值里有汉字「${en}」`);
    }
    expect(bad, `模式表自身的问题：\n  ${bad.join('\n  ')}`).toEqual([]);
    // 反向：两张表里不许有"没进模式表"的 `engine.prompt.*` 键（否则它永远读不到）
    const stray = [...Object.keys(ZH), ...Object.keys(EN)].filter((k) => k.startsWith('engine.prompt.') && !ENGINE_PROMPT_KEYS.includes(k));
    expect([...new Set(stray)], '这些 `engine.prompt.*` 键不在 `ENGINE_PROMPT_KEYS` 里（永远读不到）').toEqual([]);
    // 表卫生：两个键不许写同一个模式串 —— 运行期它们是同一个 `Map` 键，后写的会静默盖掉先写的
    // （实测抓到过一条：`你弃置1张牌` 既是有前缀标题的余项、又是 luck 那条无前缀的整标题）。
    const bodies = ENGINE_PROMPT_KEYS.map((k) => ZH[k]);
    const dupBodies = [...new Set(bodies.filter((b, i) => bodies.indexOf(b) !== i))];
    expect(dupBodies, `这些模式串被两个键共用（后一条永远命中不到）：${dupBodies.join(' / ')}`).toEqual([]);
  });
});
