import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
// ⚠️ `lightningcss` 是 **vite 的传递依赖**（`node_modules/vite/package.json` 里声明），不在本仓
// `package.json` 的 devDependencies 里。**这是有意接受的**（G2 Task 3F2 · §4-2，复评实测确认）：
//   1. 缺失时失败是**响亮的** —— 静态 import 不存在的包 → `Failed Suites` / `Tests no tests` / exit 1，
//      不会被吞、不会静默跳过整条守卫；
//   2. 为什么**不**动 `package.json`：本仓禁止 `npm install`（零运行时依赖纪律），手写一条声明会让
//      `package-lock.json` 失同步（lockfile 里它挂在 vite 下面）；
//   3. 为什么**不**改成 `await import()` + try/catch：那会把"包没了"变成**静默跳过**（守卫读起来仍绿），
//      正是本项目反复出现的失效模式 —— 宁可响亮地红。
//   风险与对策：若 vite 将来弃用 lightningcss，本文件会立刻红（而不是静默失去 CSS 校验），
//   那时再决定"新增显式依赖"或"换一个等价解析器"。
import { transform } from 'lightningcss';
import { hooksOfCategory, RENDERERS } from '../../src/ui/fx-dom-contract';
import { NET_PAGE_HOOKS, verifyPageHooks } from '../../src/ui/render-net';
import { stripComments, stripArrayDecl, codePositions } from './source-text';

/**
 * G2 Task 3/3F 守卫：远程对战页渲染器 `src/ui/render-net.ts`（源码文本守卫，**无 jsdom**）。
 *
 * ⚠️ 这些断言的**固有限度**必须记住（计划附录 A.4-3 已披露，本项目历史上多次因此误判"已验收"）：
 *   - 它们只能证明「某个 token 出现在**非注释的源码文本**里」；
 *   - 证明不了运行时真的把属性写在节点上、值是否与状态一致、节点在 FX 读取那一刻是否存在；
 *   - 证明不了 DOM 的**真实顺序**（见第 6 条的代理断言）与节点的**真实布局盒**。
 * 19 条 A 类钩子与两条运行时断言（`.hand` 顺序 / 对手卡 `.rot-180`）的真实验证靠
 * `opts.verifyHooks`（`verifyPageHooks`）与用户在 5173 上的 ≥20 个点名特效抽查。
 *
 * ## G2 Task 4
 * A 类清单补入 `.rot-180`（远程页对手侧的倒置态）→ `NET_PAGE_HOOKS` 同步镜像（20 条），
 * 第 2b 条的条数断言改为**从契约推导**（硬编码数字只会与契约文档永久打架）。
 * 本页的自查侧：`.rot-180` 走 `stateDependent`（场上无卡合法为 0），**逐卡计数**仍由
 * 第 13b/19 条钉住的断言 2（硬约束 2：对手侧每张卡/协议各自带 `.rot-180`）承担。
 *
 * ## G2 Task 3F 对三条守卫可信度的修正（每条都在报告里有变异实测）
 * 1. **C-3 / I-3**：`NET_PAGE_HOOKS` 表里逐字写着 19 条 hook 字符串，而"本文件提供全部 A 类钩子"
 *    的判据是"本文件源码里出现 token" → **表满足了断言本身**（变异：删掉 `renderStackSlot(` /
 *    `renderProtocolCell(` 的真实挂载，契约 20 + 本文件 11 全绿）。现在 `netCode()` 一律
 *    **先 `stripArrayDecl` 剔除表体**，判据换成「助手调用链」（第 2 条）。表本身只剩"契约镜像"
 *    职责，并对它加了两条机检（第 2b 条）。
 * 2. **I-2 的镜像修正**在 `tests/ui/fx-orient.test.ts`（读去注释源码 + 180° 分支与类名配对）。
 * 3. **I-1 / C-4 / M-3** 各加了机检（第 15/16/17 条）。
 *
 * ## G2 Task 3F2 新增的三条（复评 F-1 / F-2）
 * - **第 1b 条**：`renderNetBoard` 必须**第一件事**清空 root（清空早于任何 `root.appendChild`，
 *   且不在条件/循环里）。原缺陷（`aba8944` 就有）：入口不清 root → 接线第一帧叠一份棋盘、
 *   每次 `rerender` 线性叠加（兄弟入口 `renderDraft`/`renderBoard`/`home.ts` 全都清）。
 * - **第 17 条**：`verifyPageHooks` 的**期望数量表**必须能从源码结构**推导出来**
 *   （`3 线 × 2 侧 = 6` 等），并钉住两侧 `renderSideRow` 的**真实挂载**。
 * - **第 18/19 条**：把合成 DOM 桩喂给 `verifyPageHooks()` **真跑一遍** —— 缺了对手侧的树必须报 ✗
 *   并说出 `数量 …，期望 …`。没有这两条，`expected` 表在无 jsdom 下只是一句声明。
 */

const root = new URL('../../src/ui/', import.meta.url);
const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, root))).subarray(0, 8 * 1024 * 1024).toString('utf8');

/**
 * 源码与"去注释、且**剔除 NET_PAGE_HOOKS 表体**"的源码都在**取用时**才读，且**不缓存**：
 * 文件缺失时给一条清楚的存在性断言失败，而不是模块作用域 ENOENT 让整个测试文件变成
 * `Tests no tests`。（`tests/ui/fx-dom-contract.test.ts` 的 `rendererSources` 正是模块作用域读的
 * —— 所以「先建文件、再登记进 RENDERERS」是硬顺序约束，本文件刻意不重复那个坑。）
 *
 * ⚠️ `stripComments` / `stripArrayDecl` 来自 `./source-text`（**两边共用同一实现**，
 * 不在这里复制 —— 拷贝一旦漂移，一边的断言就会因为"注释没被删"而假绿，见该文件头注）。
 */
const netSource = (): string => {
  try { return read('render-net.ts'); } catch { return ''; }
};
/** 判据面：去注释 + **剔除钩子数据表**（表不得充当任何"提供/产出"断言的证据） */
const netCode = (): string => stripArrayDecl(stripComments(netSource()), 'NET_PAGE_HOOKS');

/** 取 `from` 之后、`to` 之前的源码片段（本文件的函数都是顶层 `function` 声明，够用） */
function between(code: string, from: string, to: string): string {
  const i = code.indexOf(from);
  const j = code.indexOf(to);
  expect(i, `源码里找不到 ${from}（结构被改动？）`).toBeGreaterThanOrEqual(0);
  expect(j, `源码里找不到 ${to}（结构被改动？）`).toBeGreaterThan(i);
  return code.slice(i, j);
}

/** 去注释后的 CSS 规则（本文件没有嵌套规则/@media，`选择器 { 体 }` 的简版解析够用）。
 *  ⚠️ 选择器**内部**的换行/多空格原样保留（正则只切"选择器 → `{`"这一段）：
 *  形如 `.a,\n.b { … }` 的多行选择器会被切成 `'.a,\n.b'`，调用方要么用子串比、
 *  要么先压空白（见 R1-1 的 `norm`）。 */
function cssRules(css: string): Array<{ selector: string; body: string }> {
  const out: Array<{ selector: string; body: string }> = [];
  const src = stripComments(css);
  const re = /([^{}]+)\{([^{}]*)\}/g;
  for (let m = re.exec(src); m !== null; m = re.exec(src)) {
    out.push({ selector: m[1].trim().replace(/\s+/g, ' '), body: m[2] });
  }
  return out;
}

/**
 * 把选择器交给 lightningcss 解析（仓库已装的真 CSS 解析器，vite 的依赖）。
 * 本仓没有 `@types/node`（禁止 npm install），所以不能用 `Buffer` —— lightningcss 的
 * `code` 类型就是 `Uint8Array`，用 `TextEncoder` 造一个即可。
 */
function parseSelector(selector: string): void {
  transform({ filename: 'probe.css', code: new TextEncoder().encode(`${selector} { color: red }`), minify: false });
}

/**
 * 1. 本页的**容器节点**（信息条 / 带 / 行 / 手牌条）不得被任何 `transform`/`rotate` 作用 ——
 *    C-4 的原始形态是 `.net-lane-band .net-side-foe { transform: rotate(180deg) }`：
 *    它与卡自身的 `.rot-180` 叠加成 0°（对手的卡其实**正立**），并把整行**水平镜像**
 *    （"覆盖者在右"的屏幕假设被翻转 → 被覆盖卡可见区被压成 6px）。
 *    卡级 hover（`.stack .card:hover`）的 transform 是**允许**的：它的最后一个复合选择器是
 *    `.card`，不在容器名单里。
 */
const CONTAINER_LAST = [
  'net-board', 'net-grid', 'net-strip', 'net-strip-foe', 'net-lane-band', 'net-side',
  'net-side-self', 'net-side-foe', 'net-hands', 'net-hand-side', 'net-hand-side-self', 'net-hand-side-foe',
];
function rotatedContainers(css: string): string[] {
  return cssRules(css)
    .filter((r) => {
      const last = (r.selector.split(/\s+/).pop() ?? '').split(':')[0];
      const isContainer = CONTAINER_LAST.some((c) => new RegExp(`^\\.${c}(?:\\.|\\[|$)`).test(last));
      if (!isContainer) return false;
      return /rotate\(/.test(r.body) || /transform:\s*(?!none)/.test(r.body);
    })
    .map((r) => r.selector);
}

/** 2. 承载/就是两条 `.hand` 的节点不得用 `display:none`（隐藏节点 `getBoundingClientRect()` 全 0） */
function hiddenHandRules(css: string): string[] {
  return cssRules(css)
    .filter((r) => /(net-hands|net-hand-side|\.hand\b)/.test(r.selector) && /display:\s*none/.test(r.body))
    .map((r) => r.selector);
}

/**
 * 助手调用结果**确实流进 DOM**的文本形态：`appendChild(<call>` 或 `= <call>`（绑定后再挂载）。
 * 只查 `code.includes(call)` 会漏掉"调用还在、结果被丢掉"（`void renderStackSlot(…)`）——
 * 那正是评审 Critical C-3 的变异形态，页面同样没有链路槽。
 */
function mountedFormOf(call: string): RegExp {
  return new RegExp(`(?:appendChild\\(\\s*|=\\s*)${call.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
}

/**
 * 守卫 1b 用的判据助手（G2 Task 3F3）。
 *
 * 背景：原来的 1b 是**纯 `indexOf` 文本搜索**（`netCode()` 只去注释、剔除钩子表体，
 * **字符串内容保留**），于是任何"**文本上存在、执行上不存在**"的写法都能满足它。
 * 终轮复评实测两种诱饵：
 *   * **X1** `const noopClear = () => { root.textContent = ''; }; void noopClear;`（定义但从不调用）
 *   * **X2** `const CLEAR_DOC = "root.textContent = ''";`（只是文档字符串）
 * 两者页面照旧逐帧叠加、守卫 22/22 全绿 —— 与 G1（注释满足守卫）、3F-I2（注释满足守卫）
 * 是**同一族**失效，只是换成了"字符串 / 不可达代码满足守卫"。
 * 两条最小检查即可封死（不引入新机制）：
 *   ① **代码位**：命中的起点必须落在代码位（不在字符串/模板串里）→ 杀 X2；
 *   ② **花括号净深度为 0**：该处不得嵌在任何块里（前缀里代码位的 `{`/`}` 必须平衡）→ 杀 X1
 *      （`() => { ` 把深度抬到 1）。花括号配对同样跳过字符串/模板串（走 `codePositions`）。
 */

/** 认可的**清空**形态（"把 root 清空"的等价写法；M-1：不绑定某一种写法，否则会假红） */
const CLEAR_FORMS: readonly string[] = [
  "root.textContent = ''",
  "root.innerHTML = ''",
  'root.replaceChildren()',
];

/** 认可的**挂载**形态（"把棋盘挂进 root"；M-1 的 X5：`append` 是 `appendChild` 的等价写法） */
const MOUNT_FORMS: readonly string[] = ['root.appendChild(', 'root.append('];

/**
 * 一次调用**既清空又挂载**（M-1 的 X4：`root.replaceChildren(wrap)` 语义完全正确）。
 * 空实参的 `root.replaceChildren()` 属**清空**形态（见 `CLEAR_FORMS`），不算挂载。
 */
const REPLACE_MOUNT = 'root.replaceChildren(';

/** `needle` 在 `text` 里所有**起点落在代码位**的下标（字符串/模板串里的同名文本不算） */
function codeMatches(text: string, needle: string, isCode: boolean[]): number[] {
  const out: number[] = [];
  const re = new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
  for (let m = re.exec(text); m !== null; m = re.exec(text)) {
    // 只要求**起点**是代码位：判据本身含字符串字面量（`…= ''`），其引号按定义是"非代码"。
    if (isCode[m.index]) out.push(m.index);
  }
  return out;
}

/** `at` 之前（不含）的**代码位花括号净深度**：`{` 记 +1、`}` 记 −1 */
function braceDepthBefore(text: string, isCode: boolean[], at: number): number {
  let depth = 0;
  for (let i = 0; i < at; i += 1) {
    if (!isCode[i]) continue;
    if (text[i] === '{') depth += 1;
    else if (text[i] === '}') depth -= 1;
  }
  return depth;
}

/**
 * 取**花括号配平的那一段**（`from` 是一个代码位 `{` 的下标；返回**不含**这对外层花括号的内容，
 * 于是"体内容里的净深度从 0 起算"）。
 *
 * 为什么必须配平而不是"切到文件尾"：`renderNetBoard` 是文件里最后一个顶层声明，直接 `slice` 到
 * 文件尾会把**它之后**定义的任何东西也算进"函数体"。复评的 X3a 正是"清空写进定义在渲染器
 * **之后**的 helper"——那时若切到文件尾，helper 里的清空文本就落在"体内"了（块体会被深度规则
 * 挡住，但**表达式体箭头**（`const f = (r) => r.x = ''`）没有花括号、深度为 0，会漏）。
 */
function balancedBlock(text: string, from: number, isCode: boolean[]): string {
  let depth = 0;
  for (let i = from; i < text.length; i += 1) {
    if (!isCode[i]) continue;
    if (text[i] === '{') depth += 1;
    else if (text[i] === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(from + 1, i);
    }
  }
  return text.slice(from + 1);
}

/**
 * 从 `at` 往前到最近的**语句边界**（代码位的 `;` / `{` / `}`）之间的文本 = 这条语句的"语句头"。
 *
 * 用来判断两件事：
 *  1. 清空是不是嵌在**别的函数**里 —— `const noopClear = () => root.x = '';` 这种**表达式体箭头**
 *     没有花括号、深度检查抓不到，但它的语句头里含 `=>`（或 `function`）；而"清空自己就是一条
 *     语句"时语句头只有空白（或 `void (` 之类）→ 不误伤。
 *  2. 清空是不是**裸条件/循环**（`if (x) root.x = '';` 没有花括号，深度同样是 0）—— 语句头里含
 *     `if|for|while|switch` 即拒。
 */
function statementHeadBefore(text: string, isCode: boolean[], at: number): string {
  let i = at - 1;
  for (; i >= 0; i -= 1) {
    if (!isCode[i]) continue;
    if (text[i] === ';' || text[i] === '{' || text[i] === '}') break;
  }
  return text.slice(i + 1, at);
}

/** 取 `[from, to)` 之间**代码位**的文本（跳过字符串/模板串与注释） */
function codeTextBetween(text: string, isCode: boolean[], from: number, to: number): string {
  let out = '';
  for (let i = Math.max(0, from); i < Math.min(to, text.length); i += 1) if (isCode[i]) out += text[i];
  return out;
}

describe('G2 · 远程对战页渲染器（render-net.ts 源码守卫）', () => {
  it('1. 文件存在且导出 renderNetBoard / resetNetUiState', () => {
    const src = netSource();
    expect(src.length, 'src/ui/render-net.ts 不存在或为空（先建文件，再登记进 RENDERERS）').toBeGreaterThan(0);
    expect(stripComments(src)).toContain('export function renderNetBoard');
    expect(stripComments(src)).toContain('export function resetNetUiState');
  });

  /**
   * F-1（复评 Critical，`aba8944` 起的既有缺陷）：`renderNetBoard` 必须**自己清空 root**。
   *
   * 为什么：`renderApp` 的契约是"渲染器自己清空并重建 root 内容"，兄弟入口全都清
   * （`render.ts:4472` renderDraft / `:4637` renderBoard / `home.ts:65`），而 Task 4 计划的
   * 单行 `rerender()` dispatch **不做清理**。少了这一行 → 从热座/草稿切进远程预览时**叠一屏**，
   * 之后每次 `cb.rerender?.()` 再叠一份（线性增长），而 FX 全走 `querySelector`（取首个）
   * → 特效全部打在旧副本上。运行时断言 1 会把它报成"4 条 .hand"（用户可见），但那时页面已经叠坏。
   *
   * 判据（G2 Task 3F3 加固后）——不是"文件里有 `textContent = ''`"，而是**真的会执行**的那一处：
   *   ① 定位到 `renderNetBoard` 的**函数体**（**花括号配平**，不是切到文件尾）；
   *   ② 清空语句必须落在**代码位**（`codePositions`）→ 杀诱饵字符串 X2；
   *   ③ 该处的**花括号净深度必须为 0**（不在任何块里）→ 杀块体箭头 X1
   *      （`() => { root.textContent = ''; }` 把深度抬到 1）；
   *   ④ 语句头里不得有 `=>`/`function` → 杀**表达式体**箭头（花括号深度为 0 的那种漏法）；
   *   ⑤ **语句头**里没有 `if/for/while/switch`（不得条件化；也不得排在 early-return 之后 ——
   *      判据是"清空与挂载之间没有 `return`/`throw`"，比"前缀里没有 if"精确，且不会因为
   *      函数体中部本来就有 `for`/`if` 而误判靠后的语句）；
   *   ⑥ 必须早于**任何**代码位的挂载调用（`appendChild(` / `append(`）；或者挂载本身就是
   *      `root.replaceChildren(<实参>)`（一次调用既清空又挂载，语义正确）。
   * 认可三种等价清空写法 + 两种等价挂载写法（M-1：**拒绝正确代码的守卫会被绕过**，不能假红）。
   */
  it('1b. F-1：renderNetBoard 必须**第一件事**清空 root（代码位、无嵌套、无条件、早于任何挂载）', () => {
    const code = netCode();
    const entryAt = code.indexOf('export function renderNetBoard');
    expect(entryAt, '找不到 export function renderNetBoard').toBeGreaterThanOrEqual(0);
    const entry = code.slice(entryAt);
    const entryCode = codePositions(entry);
    const bodyStart = entry.indexOf('{');
    expect(bodyStart, '找不到 renderNetBoard 的函数体起始 `{`').toBeGreaterThan(0);
    // 函数体 = **花括号配平**的那一段（不是"切到文件尾"—— 否则渲染器**之后**定义的 helper
    // 会被算进体内，见 balancedBlock 的注释）
    const body = balancedBlock(entry, bodyStart, entryCode);
    const isCode = codePositions(body);

    // 候选：三种清空形态里，**落在代码位**的每一处（连同它的花括号净深度与语句头）
    const clearSites: Array<{ form: string; at: number; depth: number; head: string }> = [];
    for (const form of CLEAR_FORMS) {
      for (const at of codeMatches(body, form, isCode)) {
        clearSites.push({
          form, at,
          depth: braceDepthBefore(body, isCode, at),
          head: statementHeadBefore(body, isCode, at),
        });
      }
    }
    // 挂载点：`appendChild(` / `append(` 的第一处（代码位、且在函数体顶层）
    const mountSites = MOUNT_FORMS.flatMap((f) => codeMatches(body, f, isCode))
      .filter((at) => braceDepthBefore(body, isCode, at) === 0);
    const firstMount = mountSites.length > 0 ? Math.min(...mountSites) : -1;
    // 既清空又挂载的 `root.replaceChildren(<非空实参>)`（空实参的 `replaceChildren()` 属**清空**形态，
    // 已在上面的候选里；这里必须**排除**它，否则会把"只清空、没挂载"误当成一次合法挂载）
    const replaceMounts = codeMatches(body, REPLACE_MOUNT, isCode)
      .filter((at) => !body.slice(at + REPLACE_MOUNT.length).trimStart().startsWith(')'));

    /**
     * 一条语句"真的会执行、且不在别的函数/裸条件里"的判据。
     *
     * ⚠️ 这里**不能**用"整个前缀里没有 if/for/while"（我第一版就是这么写的，被 E4 变异抓住）：
     * 函数体中部本来就有 `for (const line of …)` 与 `if (…)`，于是**任何靠后的语句**都会被误判成
     * 条件化 → `root.replaceChildren(wrap)`（一次调用既清空又挂载）这种合法写法假红。
     * 正确的本地判据是：**花括号净深度为 0**（不在任何块里）+ **语句头**里没有条件/循环关键字
     * （挡住不加大括号的 `if (x) stmt;`）+ 语句头里没有 `=>`/`function`（挡住表达式体箭头）。
     */
    const topLevelPlainStatement = (at: number): boolean => {
      if (braceDepthBefore(body, isCode, at) !== 0) return false;
      // ⚠️ 黑名单里**必须**含 `&&`/`||`/`?`（G2 Task 3F3 终轮复评的残留绕过）：
      //    深度 0 + 无 if/for/while + 无 `=>` 仍挡不住**短路求值**——
      //    `false && (root.textContent = '');` 与 `false ? (…) : null;` 是独立语句、在代码位、深度 0，
      //    于是守卫全绿而**清空永不执行**（页面照旧逐帧叠加）。补上这三个运算符后，该族封口：
      //    深度 0 + 语句头空白 ⇒ "语句不执行"只剩两种可能 —— 被 return/throw 跳过（那挂载也跳过了，
      //    已由 noEarlyExitBetween 覆盖），或它根本不是独立语句（表达式前缀，被本条挡掉）。
      //    代价：同时拒掉"带条件的清空"（`(s.phase !== 'draft') && clear`）——**方向正确**，
      //    本守卫的口号就是"无条件清空 root"（Task 4 的分派已经保证 net 路径下 phase ≠ draft）。
      return !/\b(if|for|while|switch)\s*\(|=>|\bfunction\b|&&|\|\||\?/.test(
        statementHeadBefore(body, isCode, at)
      );
    };
    // 清空与挂载之间**不得有 return/throw**：否则存在"挂载了却没清空"的路径（原来的
    // "前缀里没有 if/for/while" 想挡的就是这个，这里换成更精确的本地判据）
    const noEarlyExitBetween = (from: number, to: number): boolean =>
      to < 0 || !/\b(return|throw)\b/.test(codeTextBetween(body, isCode, from, to));
    const usable = clearSites.filter((s) => topLevelPlainStatement(s.at)
      && firstMount >= 0 && s.at < firstMount
      && noEarlyExitBetween(s.at, firstMount));
    const usableReplaceMount = replaceMounts.filter((at) => topLevelPlainStatement(at));

    // 失败信息要**指名道姓**：说清找到了什么、哪一条判据把它挡下了
    const why = clearSites.length === 0
      ? `函数体里**代码位**上没有找到任何清空语句（三种等价形态都试过：${CLEAR_FORMS.join(' / ')}）`
        + '—— 注：写在字符串/模板串里的同名文本不算（诱饵形态 X2）'
      : `找到 ${clearSites.length} 处清空文本，但没有一处满足"无嵌套 + 非条件 + 早于挂载"：`
        + clearSites.map((s) => `「${s.form}」深度=${s.depth} 语句头=${JSON.stringify(s.head.trim())}`
          + ` 位置=${s.at}（首个挂载=${firstMount}）`).join('；');
    expect(usable.length > 0 || usableReplaceMount.length > 0,
      `F-1：renderNetBoard 没有**真的会执行**的"清空 root"（入口不清空 → 每次渲染叠一份棋盘）。${why}`)
      .toBe(true);
    expect(firstMount >= 0 || usableReplaceMount.length > 0,
      'F-1：找不到任何"把棋盘挂进 root"的调用（appendChild( / append( / replaceChildren(<实参>)）—— 结构被改？')
      .toBe(true);

    // 与兄弟入口同形（这条把"这是全仓约定"写进守卫，防止有人"顺手"只在这里去掉）。
    // 判据写成两种等价清空形式都接受（`textContent = ''` / `replaceChildren(`）—— 不绑定写法。
    const renderSrc = stripComments(read('render.ts'));
    expect(renderSrc, 'render.ts 的 renderBoard/renderDraft 也不再清空 root（全仓约定被改？）')
      .toMatch(/root\.(?:textContent = ''|replaceChildren\()/);
  });

  /**
   * C-3 的核心修正：判据从「本文件出现钩子 token」换成「本文件的**真实代码里调用了产出这些钩子的
   * 共享助手**」。为什么这是唯一诚实的判据：
   *   - 钩子的产出表达式（`el('div', 'stack-slot p1')` / `dataset.player` …）都在 `render.ts` 里，
   *     本页的贡献是"把这些助手挂进渲染链路"；
   *   - 本页源码文本里出现的 hook 字符串（`NET_PAGE_HOOKS`）**不是产出**，它只是契约镜像，
   *     所以扫描前先整段剔除（否则断言自我满足 —— 变异：删掉真实挂载仍全绿）；
   *   - **拼写**由 `render.ts` 自己那条注册项负责（同一个契约守卫逐条查它），本页不重复管。
   */
  it('2. A 类钩子经**共享助手调用链**产出（表体剔除后逐条查真实调用 —— C-3）', () => {
    const code = netCode();
    const missing: string[] = [];
    const nonExempt = NET_PAGE_HOOKS.filter((h) => h.exempt === undefined);
    // 反空集合：表为空 / 全部豁免则下面恒真（读起来像"已验收"，其实什么都没查）
    expect(nonExempt.length, 'NET_PAGE_HOOKS 的非豁免项为 0（判据失效）').toBeGreaterThan(0);
    for (const h of nonExempt) {
      expect(h.call.length, `${h.hook} 的 call 为空（等于关闭这条断言）`).toBeGreaterThan(0);
      for (const c of h.call) {
        if (!code.includes(c)) missing.push(`${h.hook}：找不到助手调用 ${JSON.stringify(c)}（本页应把该助手挂进渲染链路）`);
        // ⚠️ 只查「调用字面量存在」是不够的：评审 Critical C-3 的变异形态恰恰是
        //    「调用还在、**结果被丢掉**」（`void renderStackSlot(…)`）—— 页面同样没有链路槽。
        //    所以再要求调用结果**被挂载或被绑定**（`appendChild(<call>` / `= <call>`），
        //    二者都是"这个节点/元素确实流进了 DOM"的必要条件。
        //    诚实边界：这仍是**文本代理**（`if (x) renderStackSlot(` 这种写法也会命中），
        //    真正的产出证据是 verifyHooks 的运行时自查与 5173 实机抽查。
        if (!mountedFormOf(c).test(code)) {
          missing.push(`${h.hook}：${JSON.stringify(c)} 的返回值既没被 appendChild 也没被绑定（结果被丢掉 = 节点没进 DOM）`);
        }
      }
    }
    expect(missing, `以下 A 类钩子的产出助手调用不在本文件（剔除表体后）的真实代码里：\n${missing.join('\n')}`).toEqual([]);

    // 契约基准面：这 11 条助手调用是本页"把钩子挂进链路"的全部入口（与 fx-dom-contract.test.ts
    // 的 ASSISTANT_CALLS 同口径）。少一条就说明某类节点整类不再产出。
    for (const c of [
      'renderStackSlot(', 'renderProtocolCell(', 'renderDeck(', 'renderTrash(',
      'renderHand(s, 0', 'renderHand(s, 1', 'renderControlModule(', 'renderPlayerInfo(',
      'renderRefreshButton(', 'choiceBar(', 'buildChoicePickOverlay(',
    ]) {
      expect(code, `本页缺少 A 类钩子的产出助手调用 ${c}`).toContain(c);
    }
  });

  it('2b. NET_PAGE_HOOKS 是契约 A 类清单的**逐字镜像**（防止表漂移 + 防 probeSelector/call 缺项）', () => {
    // 镜子必须逐字相等：否则表会变成"与契约各改各的散文"，而人读它时以为它代表契约。
    const aHooks = hooksOfCategory('A').map((h) => h.hook).slice().sort();
    const tableHooks = NET_PAGE_HOOKS.map((h) => h.hook).slice().sort();
    expect(tableHooks, 'NET_PAGE_HOOKS 与契约 A 类清单不一致（表已漂移）').toEqual(aHooks);
    // G2 Task 4：期望值改为**从契约推导**（原来硬编码 19）。理由有两条：
    //   ① 硬编码数字与上一行的集合相等断言**重复**（集合相等已经蕴含条数相等），删掉它不丢机检力；
    //   ② 硬编码会**主动制造漂移** —— Task 4 把 `.rot-180` 登记为 A 类后条数变成 20，而契约测试
    //      的「契约文档必须逐一登记全部 A 类钩子」会**逼**文档写 20；若这里仍写 19，两处就永久打架。
    // 保留下来的仍然是一条**跨文件**断言（表 vs 契约），不是"抄一遍数字"。
    expect(NET_PAGE_HOOKS.length, 'A 类钩子条数变了？请同步 NET_PAGE_HOOKS 与 docs/4代-FX DOM 契约.md')
      .toBe(hooksOfCategory('A').length);
    // 豁免项必须与 RENDERERS 里 render-net.ts 的 exempt 逐字一致（两处都是"有意不提供"的声明）
    const netRenderer = RENDERERS.find((r) => r.file === 'render-net.ts');
    expect(netRenderer, 'render-net.ts 未登记进 RENDERERS').toBeTruthy();
    expect(NET_PAGE_HOOKS.filter((h) => h.exempt !== undefined).map((h) => h.hook).sort())
      .toEqual([...(netRenderer?.exempt ?? [])].slice().sort());
    // 两条**运行时**断言要查的东西必须在表/代码里可读（它们的一部分就是"探测选择器"）
    expect(netCode(), '缺少对手卡 .rot-180 的运行时自检（C-4 之后对手卡的倒置只能靠它机检）')
      .toMatch(/\.card\.rot-180/);
  });

  it('3. 不产出热座专属的 ±90° 朝向类；对手 180° 必须是**传给共享助手的实参**（C-3 变异 A-2 的杀手）', () => {
    // 判据用**带引号的字面量**：注释里写 `.rot-cw`（不带引号）不算产出
    const code = netCode();
    expect(code).not.toMatch(/['"]rot-cw['"]/);
    expect(code).not.toMatch(/['"]rot-ccw['"]/);
    // ⚠️ 这里**不再**用 `expect(code).toContain('rot-180')` 当作"对手朝上"的证据：
    //    本页连引号类名字面量都不产出（映射集中在 render.ts 的分支链），那句断言只会被
    //    "别处的某个字符串"满足（G2 Task 3 里它由死代码 `orientClassOf` 满足 —— 评审 M-1）。
    //    真正承重的是**调用形态**：把 180 作为 orient 实参交给两个共享助手。
    //    ⚠️ 它真正生效还依赖 render.ts 的 180 分支仍在产出（`orient === 180 → 'rot-180'`）——
    //    那一条由 tests/ui/fx-orient.test.ts 第 3 条（去注释源码 + 条件与类名配对）守住。
    expect(code, '链路槽的对手朝向未按座位传 orient（硬约束 2 变成"完全不倒置"）')
      .toMatch(/orient:\s*isSelfSeat\s*\?\s*0\s*:\s*180/);
    expect(code, '协议格的对手朝向未按座位传 orient')
      .toMatch(/renderProtocolCell\(\s*s,\s*player,\s*line,\s*isSelfSeat\s*\?\s*0\s*:\s*180,/);
  });

  it('4. 不得用 s.turnPlayer 冒充"自己"；"自己"必须来自 viewSeat', () => {
    const code = netCode();
    expect(code, "远程页的\"自己\"必须来自 viewSeat，不能用 turnPlayer 当座位")
      .not.toContain('s.turnPlayer ===');
    expect(code).toContain('viewSeat');
  });

  /**
   * I-3 的修正：原来这条数的是**裸源码里 `'hand'` 带引号字面量的出现次数**，
   * 而它实际命中 3 条注释 + `data-net-hand-slots='hand'` 这个"为可机检而存在"的标记 ——
   * 对产出零判别力（删掉真正的产出路径它毫无反应）。现在钉**真实调用形态**：
   * `renderHand(s, 0 …)` / `renderHand(s, 1 …)` 各一次（本页只有两个手牌区），
   * 且 `data-hand-count` 的产出点必须在 `render.ts` 的 `handVisibility === 'count'` 分支里。
   * 那两个"为测试而写的"标记与注释已随本修正一并删除（N-2）。
   */
  it('5. 两条 .hand 产出路径（renderHand 恰好两次真实调用）+ data-hand-count 的真实产出形态', () => {
    const code = netCode();
    const calls = code.match(/renderHand\(/g) ?? [];
    expect(calls.length, `本页必须**恰好**调两次 renderHand（P0 一个、P1 一个），实际 ${calls.length} 次`)
      .toBe(2);
    expect(code, '找不到 renderHand(s, 0 … 的调用').toContain('renderHand(s, 0');
    expect(code, '找不到 renderHand(s, 1 … 的调用').toContain('renderHand(s, 1');
    // 生产代码里不得再有"只为满足子串断言而存在"的字符串（I-3 / N-2）
    expect(code, 'data-net-hand-slots 是为可机检而写的产物，必须删掉（它证明不了任何产出）')
      .not.toContain('netHandSlots');

    // 对手手牌张数写在**手牌节点本身**上（`renderHand` 的 count 分支 `setAttribute`），
    // 这条必须去**真正的产出方**（render.ts，不是本文件）钉**真实调用形态**，而不是裸子串：
    // 裸子串会被 `.hand-count-only` / 注释 / 别的 dataset 键满足 —— 属性名打错时照样全绿。
    const renderSrc = read('render.ts');
    expect(renderSrc, 'render.ts 未把 data-hand-count 真的写到手牌节点上（只含子串不算）')
      .toMatch(/setAttribute\(\s*'data-hand-count'/);
    const at = renderSrc.search(/setAttribute\(\s*'data-hand-count'/);
    const window = renderSrc.slice(Math.max(0, at - 1200), at);
    expect(window, 'data-hand-count 的产出点不在 .hand 的数量占位分支里（产出位置可疑）')
      .toMatch(/el\(\s*'div',\s*'hand'/);
    expect(window, 'data-hand-count 的产出点不在 handVisibility === \'count\' 分支里')
      .toMatch(/handVisibility === 'count'/);
  });

  it('6. DOM 顺序约束（P0 先建、P1 后建 + 同一父容器相邻挂载）—— 源码调用顺序的**代理**断言', () => {
    // ⚠️ 这条守卫证明的只是**源码里 renderHand 的调用顺序**，它是 DOM 顺序的**代理**：
    //    P0 的 .hand 先 build、P1 的后 build，且唯一的挂载点按同一顺序 append ⇒ 运行时
    //    querySelectorAll('.hand') 的 [0] 是 P0、[1] 是 P1。真正的运行时顺序只能靠实机验收
    //    （或 `opts.verifyHooks` 的运行时断言 1）—— 源码文本守卫无法证明 DOM 真的这样挂载。
    // 为什么必须恒定 [P0,P1]：FX 读手牌是**按下标**的（fx-gen2.ts:693/1316/1786、
    //    effects/index.ts:849/942/1541/1590/1650；:1703 一次取两手），而甲读法把「对手」放在
    //    上方带 —— viewSeat=0 时上带是 P1，若按视觉顺序自然挂载就得到 [P1,P0]，下标 0 会拿到
    //    **对手**的手牌，特效不报错、不跳过，而是把卡飞到对手手牌区（比 undefined 更难发现）。
    const code = netCode();
    const i0 = code.indexOf('renderHand(s, 0');
    const i1 = code.indexOf('renderHand(s, 1');
    expect(i0, '找不到 renderHand(s, 0 …) 的调用（顺序断言失去意义）').toBeGreaterThanOrEqual(0);
    expect(i1, '找不到 renderHand(s, 1 …) 的调用（顺序断言失去意义）').toBeGreaterThanOrEqual(0);
    expect(i0, 'P0 的手牌必须在 P1 之前建出（DOM 顺序恒定为绝对玩家顺序）').toBeLessThan(i1);
    // 光有"建的顺序"还不够：两条手牌必须挂进**同一个父容器**，且挂载本身也按同一顺序。
    expect(code, '找不到「同一父容器里先 append P0、再 append P1」的语句对（顺序保证的挂载点）')
      .toMatch(/appendChild\(buildP0Hand\([^)]*\)\);\s*hands\.appendChild\(buildP1Hand\([^)]*\)\);/);
    // 视觉归属必须是 CSS 的事：父容器带座位类，且样式表真的用 order 实现
    expect(code, '父容器未按座位加类（视觉归属应交给 CSS）').toContain('net-view-');
    const css = read('styles-net.css');
    expect(css, 'styles-net.css 未用 order 决定上下带归属').toMatch(/order\s*:/);
    // display:none 的检查**扩到所有承载/就是手牌的节点**（评审变异 D-1：只查 `.net-hands` 时
    // `.net-hand-side-foe { display:none }` 仍然全绿，而它正是"rect 全 0"的真实危险形态）。
    // 这里用"对合成 CSS 的阳性/阴性对照"证明仪器本身有判别力，再对真实样式表跑一遍。
    expect(hiddenHandRules('.net-hand-side-foe { display: none; }')).toEqual(['.net-hand-side-foe']);
    expect(hiddenHandRules('.net-hands .hand { display: none; }')).toEqual(['.net-hands .hand']);
    expect(hiddenHandRules('.net-hands { display: grid; }')).toEqual([]);
    expect(hiddenHandRules(css), '承载/就是两条 .hand 的节点不得用 display:none（隐藏节点 rect 全 0）')
      .toEqual([]);
  });

  it('7. 不得调用挡板（设计稿 §6.1 已删挡板）', () => {
    expect(netCode(), '远程页调用了 renderShield / bindShieldDrag（§6.1 已删挡板）')
      .not.toMatch(/\brenderShield\s*\(|\bbindShieldDrag\s*\(/);
  });

  it('8. 入口四件副作用齐全（与 renderApp 对齐，漏一个就会有时序 bug）', () => {
    const code = netCode();
    expect(code).toContain('no-anim');
    expect(code).toContain('syncCheckCacheChains(');
    expect(code).toContain('syncChainLayerPosition(');
    expect(code).toContain('onRendered?.()');
  });

  /**
   * I-4：`choicePromptId` 是 `render.ts` 里"选择模式"的**全局闸门**
   * （`:5583` 选择模式禁止拖拽打牌、`:1658` 手牌单击选中）。远程页曾经只写自己的
   * `netChoicePromptId`，从不写共享的那个 → 两处守卫**永不生效**；C-1 修好后候选手牌会拿到
   * `.choice-target`（指针事件恢复），于是 prompt 挂起时**仍可拖牌打出**。
   * 这里钉"每帧都正确设置/清除"的调用形态（含"没有 pending effect"的分支）。
   */
  it('9. 共享选择态：render.ts 导出三个口 + 远程页复用 playToLine + 正确写/清 choicePromptId', () => {
    const renderSrc = read('render.ts');
    expect(renderSrc).toContain('export function getHandSelection');
    expect(renderSrc).toContain('export function setHandSelection');
    expect(renderSrc).toContain('export function pruneSelection');
    const code = netCode();
    expect(code, '远程页未复用既有打牌路径 playToLine（自写一套会与合法性与复位语义发散）')
      .toContain('playToLine(');
    // ── I-4：promptId 的每条路径都要在**对应分支**里（"文件里某处出现过"不算 —— 那样
    //    把某一条分支改坏时，别的分支仍能让断言通过。变异实测：G-2 最初就是绿的。）──
    // ⚠️ 切片标记必须用**代码**（注释已被 stripComments 抹掉，用注释文本会 indexOf = -1）。
    const head = between(code, 'function renderChoiceUi', 'const who = prompt.chooser');
    // ①「没有 pending 选择」分支 → 必须清空 promptId + 已选（否则 render.ts 的两处守卫
    //    （`:5583` 禁止拖拽、`:1658` 手牌单击）会在 prompt 结束后**永久锁死**打牌）
    const noPrompt = between(head, 'if (!prompt || !top) {', 'if (netChoicePromptId !== top.id) {');
    expect(noPrompt, '无 pending 选择时未清空 promptId（render.ts 的选择模式守卫会永久锁住打牌）')
      .toMatch(/setChoiceSelection\(\s*\[\],\s*null\s*\)/);
    // ②「prompt 活动」分支 → 换 prompt 时重开选择并写下 promptId；未换时每帧重申
    const active = head.slice(head.indexOf('if (netChoicePromptId !== top.id) {'));
    expect(active, '换 prompt 时未把 promptId 写进共享选择态（render.ts 的选择模式守门将失效）')
      .toMatch(/setChoiceSelection\(\s*\[\],\s*top\.id\s*\)/);
    expect(active, 'prompt 存在时未每帧重申 promptId（选择模式守门必须在每一帧都成立）')
      .toMatch(/setChoiceSelection\(\s*getChoiceSelection\(\),\s*top\.id\s*\)/);
    // ③ 应答完成后的各条路径（跳过 / 确认 / 线槽点击 / 动作按钮）也必须清空
    //    计数含①：当前实现共 5 处；新增应答路径时应同步 +1（失败消息会说明）。
    expect((code.match(/setChoiceSelection\(\s*\[\],\s*null\s*\)/g) ?? []).length,
      '应答完成后清空选择态的调用点太少（跳过/确认/线槽/动作按钮每条路径都要清）')
      .toBeGreaterThanOrEqual(5);
  });

  it('10. 预览工具条是有条件的（真实联机不传 onPreviewChange → 完全不渲染）', () => {
    const code = netCode();
    expect(code).toContain('onPreviewChange');
    expect(code, '预览工具条未被 opts.onPreviewChange 守卫住（真实联机会多出一条工具条）')
      .toMatch(/if\s*\(\s*opts\.onPreviewChange\s*\)/);
    // 运行时自查结果必须显示在**工具条**上（不能只在 console）
    expect(code, '自查结果只写在控制台？真实用户看不到').toMatch(/\.net-verify-note/);
  });

  it('11. 不得调用 renderBoard / renderApp 本体（设计稿 §6.1：远程页必须另写；重渲染一律走 cb.rerender）', () => {
    const code = netCode();
    expect(code, '远程页调用了盘本体（§6.1 要求另写）').not.toMatch(/\brenderBoard\s*\(/);
    expect(code, '远程页调用了 renderApp（重渲染必须走 cb.rerender?.()）').not.toMatch(/\brenderApp\s*\(/);
  });

  /**
   * C-1：`renderChoiceUi` 必须在 `wrap.appendChild(grid)` **之后**调用。
   *
   * 它内部三处 `wrap.querySelectorAll(...)` 都只对"已挂在 wrap 下的节点"生效：
   *  - `select` 分支 → `.card[data-uid]`（场上卡 + 手牌卡都在 grid 里）
   *  - `select-line` 分支 → `.net-lane-band`（`data-line` 写在带节点上）
   * 曾经它在 grid 之前跑 → `select-line` 拿到 0 条带、没有可点目标，而 `choiceBar` 对
   * select-line **没有确认按钮** → 非 optional 的 select-line 永久无法应答（对局卡死）。
   *
   * ⚠️ 这是**源码顺序的代理**断言：它证明调用顺序对，证明不了运行时真的查到节点
   * （那要看 `verifyHooks` 的 A 类钩子自查 + 5173 实机）。但它对"把这一行搬回去"这个
   * 具体回归形态是有效的（变异实测红）。
   */
  it('12. C-1：renderChoiceUi 必须晚于 wrap.appendChild(grid)（select-line 才能拿到候选带）', () => {
    const code = netCode();
    const iGrid = code.indexOf('wrap.appendChild(grid)');
    const iChoice = code.indexOf('renderChoiceUi(wrap');
    expect(iGrid, '找不到 wrap.appendChild(grid)（grid 挂载点被改？）').toBeGreaterThanOrEqual(0);
    expect(iChoice, '找不到 renderChoiceUi(wrap, …) 的调用').toBeGreaterThanOrEqual(0);
    expect(iGrid, 'renderChoiceUi 跑在 grid 挂进 wrap 之前 → select-line 找不到任何 .net-lane-band（死锁）')
      .toBeLessThan(iChoice);
    // 它必须查 `wrap`（= grid 的祖先），不能改成查 grid 之外的东西
    expect(code).toMatch(/wrap\.querySelectorAll<HTMLElement>\('\.net-lane-band'\)/);
  });

  /**
   * C-2：`verifyPageHooks` 一执行就抛 `SyntaxError`（`scope.querySelector(h.hook)`，
   * 而 `.trash-pile.p1/.p2` 不是合法 CSS 选择器），没有 try/catch → 异常从 `renderNetBoard`
   * 逃逸到宿主。修法三层，这里逐层机检：
   *  1. **探测选择器与展示写法分离**（`probeSelector`），且每个都是**合法 CSS**（下一条用
   *     仓库已装的 lightningcss —— 真正的 CSS 解析器 —— 实测）；
   *  2. 逐条 `try/catch`，失败收集后一次性报告（不当场抛）；
   *  3. `renderNetBoard` 那道调用外面再包一层兜底 try/catch。
   */
  it('13. C-2：每个 probeSelector 都是合法 CSS（lightningcss 实测）+ 展示写法绝不当作选择器', () => {
    // 阳性对照：仪器（lightningcss）对评审实测的那条非法选择器必须报错 —— 证明它有牙齿
    expect(() => parseSelector('.trash-pile.p1/.p2')).toThrow();
    const bad: string[] = [];
    for (const h of NET_PAGE_HOOKS) {
      if (h.probeSelector === undefined) continue;
      try {
        parseSelector(h.probeSelector);
      } catch (err) {
        bad.push(`${h.hook} → ${JSON.stringify(h.probeSelector)}：${String(err)}`);
      }
      // 展示写法里可能有多段/复合写法（如 `.p1/.p2`），任何 `/` 都不该出现在选择器里
      expect(h.probeSelector, `${h.hook} 的 probeSelector 含 '/'（复合展示写法不能当选择器）`).not.toContain('/');
    }
    expect(bad, `以下 probeSelector 不是合法 CSS（querySelector 会抛 SyntaxError）：\n${bad.join('\n')}`).toEqual([]);
    // 反空集合 + 覆盖面：非豁免钩子**每条**都要有探测选择器（少一条 = 少查一条）
    const nonExempt = NET_PAGE_HOOKS.filter((h) => h.exempt === undefined);
    expect(nonExempt.filter((h) => h.probeSelector === undefined).map((h) => h.hook),
      '以下非豁免钩子缺少 probeSelector（运行时自查会漏掉它们）').toEqual([]);
    // 展示写法必须原样保留在 `hook` 里（它是契约镜像，不是选择器）
    expect(NET_PAGE_HOOKS.map((h) => h.hook)).toContain('.trash-pile.p1/.p2');
  });

  it('13b. C-2：verifyPageHooks 逐条 try/catch、绝不用展示写法查询、外层还有兜底', () => {
    const code = netCode();
    // 展示用 hook 字符串**绝不能**交给 querySelector（C-2 的根因）
    expect(code, '源码里出现了 querySelector(h.hook) —— 展示写法不是合法选择器（C-2 的根因）')
      .not.toContain('querySelector(h.hook)');
    const body = between(code, 'function verifyPageHooks', 'function renderPreviewToolbar');
    expect((body.match(/try\s*\{/g) ?? []).length,
      'verifyPageHooks 必须逐条 try/catch（将来写错选择器不得让整页崩）').toBeGreaterThanOrEqual(3);
    expect((body.match(/\}\s*catch\s*\(/g) ?? []).length,
      'catch 数必须与 try 数一致（漏一个就等于没有防御）').toBeGreaterThanOrEqual(3);
    // 非法/缺失选择器必须成为**具名失败**，而不是静默
    expect(body, '非法选择器没有变成一条具名失败').toContain('非法');
    // 两条特有运行时断言必须真的在里面（顺序 + 对手 180°）
    expect(body, '缺少"手牌 DOM 顺序 [P0,P1]"的运行时断言').toContain("dataset.player");
    expect(body, '缺少"对手侧场上卡各自带 .rot-180"的运行时断言').toContain('.net-side-foe .card.rot-180');
    expect(body, '缺少"对手侧协议图各自带 .rot-180"的运行时断言').toContain('.net-side-foe .protocol-img.rot-180');
    // G2 修正 R2 · 约束 8：**特效朝向标记**的逐卡断言（读侧的回退机制意味着"忘了产出标记"
    // 不会有任何报错 —— 只会静默退回卡面朝向 ⇒ 整类特效差 90°；所以这条运行时证据是必要的）
    expect(body, '缺少"对手侧每张场上卡各自带 [data-fx-rot]"的运行时断言').toContain('.net-side-foe .card[data-fx-rot]');
    expect(body, '缺少"自己侧每张场上卡各自带 [data-fx-rot]"的运行时断言').toContain('.net-side-self .card[data-fx-rot]');
    expect(body, '缺少"标记取值按座位（自己 ccw / 对手 cw）"的运行时断言').toContain("v !== 'ccw'");
    // 外层兜底：任何未预料的异常都不得从 renderNetBoard 逃逸（"诊断不得把渲染搞崩"）
    const entry = code.slice(code.indexOf('export function renderNetBoard'));
    expect(entry, '调用 verifyPageHooks 的地方没有兜底 try/catch').toMatch(/try\s*\{\s*note\s*=\s*verifyPageHooks\(/);
  });

  /**
   * I-1：对手的**牌库/弃牌堆只保留一份**（顶部信息条），对手那一行只有手牌 + 一行小标签。
   * 为什么是承重的：FX 取牌库/弃牌堆全走 `querySelector`（**取首个**，如
   * effects/index.ts:215/435/483/1138/1323/2249、fx-gen2.ts:568/665/1123/…），两份 A 类节点
   * 会让特效飞向用户**没在看**的那一份 —— 不报错、不跳过，纯静默错位。
   */
  it('14. I-1：renderDeck/renderTrash 各只有一处调用；两个玩家各覆盖一次（互补不重复）', () => {
    const code = netCode();
    expect((code.match(/renderDeck\(/g) ?? []).length,
      'renderDeck( 必须**恰好一处**调用（两份 .deck[data-player] 会让取首个的 FX 静默错位）').toBe(1);
    expect((code.match(/renderTrash\(/g) ?? []).length,
      'renderTrash( 必须**恰好一处**调用（同上）').toBe(1);
    // 两处调用点：顶部对手条用 foe，自己那一行用 player（= viewSeat）→ 玩家集合互补
    expect(code, '对手信息条未渲染对手的牌库/弃牌堆').toContain('renderPiles(s, foe)');
    expect(code, '自己那一行未渲染自己的牌库/弃牌堆').toContain('renderPiles(s, player)');
    expect((code.match(/renderPiles\(s, /g) ?? []).length,
      'renderPiles 的调用点应恰好两处（对手条 + 自己行）').toBe(2);
    // 对手那一行（decorateHand 的非自己分支）不得再渲染 piles：唯一一处 renderPiles 必须在
    // `if (o.isSelf) {` 之后（否则对手行里又出现第二份）
    const decorate = between(code, 'function decorateHand', 'function buildP0Hand');
    expect((decorate.match(/renderPiles\(/g) ?? []).length, 'decorateHand 里只应有一处 renderPiles').toBe(1);
    expect(decorate.indexOf('renderPiles('), 'renderPiles 未落在 `if (o.isSelf)` 分支内（对手行会多一份）')
      .toBeGreaterThan(decorate.indexOf('if (o.isSelf) {'));
    // `.net-hand-side-foe` 必须在样式表里有规则（评审 I-1：原实现里它零规则、两份都可见）
    expect(read('styles-net.css'), '.net-hand-side-foe 在 CSS 里零规则（I-1：重复渲染因此完全可见）')
      .toMatch(/\.net-hand-side-foe\s*\{/);
  });

  /**
   * C-4：对手那一行整块的 `rotate(180deg)` 与卡自身的 `.rot-180` 叠加成 0°（对手的卡其实正立），
   * 并把该行水平镜像（"覆盖者在右"的屏幕假设被翻转）。修法是**删掉那一行**，对手的倒置只由
   * `.rot-180` 各自承担。判据是"本页**容器节点**的规则里不得有 transform/rotate"。
   */
  it('15. C-4：容器规则不得带 transform/rotate（对手的倒置只能来自卡/协议自身的 .rot-180）', () => {
    // 阳性对照（评审实测的原始形态）必须被抓到
    expect(rotatedContainers('.net-lane-band .net-side-foe { transform: rotate(180deg); }'))
      .toEqual(['.net-lane-band .net-side-foe']);
    // 阴性对照：卡级 hover 的 transform 是**允许**的（最后一个复合选择器是 .card，不是容器）
    expect(rotatedContainers('.net-lane-band .stack .card.rot-180:hover { transform: translateY(-18px) rotate(180deg); }'))
      .toEqual([]);
    const css = read('styles-net.css');
    expect(css, '样式表里找不到 .net-side-foe（对手行的规则被删光了？）').toContain('.net-side-foe');
    expect(rotatedContainers(css), '以下容器规则带了 transform/rotate —— 会与卡自身的 .rot-180 叠加抵消'
      + '（对手的卡变回正立）并水平镜像该行：').toEqual([]);
    // 卡级 180° 的悬停必须**带着旋转**一起 transform，否则鼠标一碰卡的 180° 就被抹掉
    expect(css, '对手卡的 hover 必须保留 rotate(180deg)（否则 hover 会把倒置抹掉）')
      .toMatch(/\.card\.rot-180:hover\s*\{[^}]*rotate\(180deg\)/);
  });

  /* ==========================================================================
   * G2 修正 R1 · 三列纵向布局的守卫
   *
   * ⚠️ **所有这些都只是源码文本代理**（本项目反复栽在这里）：它们能证明"函数 / 规则按这个
   * 顺序写、类名与实参这么给"，**证明不了**运行期的观感 —— 布局最终只能靠用户人眼看
   * （规格 §1 是用户逐条确认的）。这一点在下面每条里都复述一遍，别把绿读成"已验证"。
   * ======================================================================== */

  /**
   * R1-1（**本次重做的核心**）：一条线必须是**一个纵向的列**，列内自上而下恰好是规格 §1 的六层：
   *   对手能量槽 → 对手链路 → 对手协议 → 自己协议 → 自己链路 → 自己能量槽
   *
   * 判据（三条腿，缺一条就会被"结构被改回去"瞒过去）：
   *  ① `renderLaneColumn` 里**对手侧 / 中线 / 自己侧**三个 append 的顺序；
   *  ② `renderSide` 里**两侧镜像**的挂载顺序（中线两侧都是协议：自己 = 协议→链路槽）；
   *  ③ 样式表里 `.net-side` 是**纵向** flex、`.stack-slot` 的 `order` 让能量槽落在链路**外侧**
   *     （按**侧**给：对手 `.net-side-foe` order 1 在上、自己 `.net-side-self` order 3 在下），
   *     且 `.stack-slot` 自身是纵向 flex。
   *
   * 「旧布局 → 新布局」的守卫对照：旧版这条位置上是**第 17 条**（`band.appendChild(renderSideRow(…))`
   * 两次 + `for (const line of [0, 1, 2])`）。它抓的是"整条对手侧行没了"（F-2 的计数盲区），
   * **抓不到**"三条横带 vs 三个竖列"—— 因为横带与竖列在源码上是**同一个**函数名与同一个循环。
   * 新增的 ③ 才是真正钉住"列"的那条腿；①②把"列内的层顺序"钉死。
   */
  it('R1-1. 三列纵向布局：列内层顺序（对手侧 / 中线 / 自己侧）+ 链路槽在协议格之前 + 能量槽在外侧端', () => {
    const code = netCode();
    // ① 列内顺序：对手侧 → 中线 → 自己侧（`foe` 先于 `mid`，`mid` 先于 `viewSeat`）
    const col = between(code, 'function renderLaneColumn', 'function choiceSkipBtn');
    const iFoe = col.indexOf('col.appendChild(renderSide(s, foe,');
    const iMid = col.indexOf('col.appendChild(renderLaneMid(');
    const iSelf = col.indexOf('col.appendChild(renderSide(s, viewSeat,');
    expect(iFoe, '列内找不到对手侧的挂载（`col.appendChild(renderSide(s, foe, …))`）').toBeGreaterThanOrEqual(0);
    expect(iMid, '列内找不到中线的挂载').toBeGreaterThanOrEqual(0);
    expect(iSelf, '列内找不到自己侧的挂载').toBeGreaterThanOrEqual(0);
    expect(iFoe, '列内顺序错：对手侧必须在中线**之前**（规格 §1 第 1-3 层）。'
      + '横带时代这里是 `band.appendChild(renderSideRow(s, foe, …))`，改回横带即红').toBeLessThan(iMid);
    expect(iMid, '列内顺序错：中线必须在自己侧**之前**（规格 §1 第 4 层的分界）').toBeLessThan(iSelf);
    expect((col.match(/col\.appendChild\(renderSide\(/g) ?? []).length,
      'renderSide 必须恰好挂载两次（对手 / 自己各一次 —— 少一次就是半个棋盘，F-2 的计数盲区）').toBe(2);
    // ② 一侧之内：**两侧的挂载顺序必须镜像**（规格 §1：中线两侧**都是协议**）
    //
    // ⚠️ **R-F · C-2 的守卫修正（这条旧断言把错误钉成了正确）**：
    //   旧判据是"链路槽必须在协议格之前"——对**两侧**同一句话，失败信息还写着
    //   "层 5 在层 4 之后靠列顺序实现"。那是一句**空推理**：列顺序只是把三"段"排成
    //   对手侧/中线/自己侧，**无法**重排某一侧内部的两层。于是它把
    //   "自己协议落到整列最外端（应在层 4、紧贴中线）"这个 C-2 缺陷**固化成了期望值**
    //   （改对反而报红）。现在钉规格本身：
    //     · 自己侧（下半）= 协议格（层 4）在前、链路槽（层 5）在后；
    //     · 对手侧（上半）= 链路槽（层 2）在前、协议格（层 3）在后。
    //   **原能抓什么**：两侧共用一个无条件顺序时的"整段挂载被删"（已由第 17 条的计数表承担）。
    //   **现在还能抓什么**：把两侧写成同一个顺序（= C-2 回归）、或把两侧顺序对调（自己协议跑到最外端）。
    //   **为什么新的更贴规格**：它约束的是"中线两侧都是协议"这条**版面事实**的镜像，
    //   而不是"某个 appendChild 在第几行"。
    //   ⚠️ 层序的**行为**判据（真跑 `renderNetBoard` 后按元素树 + CSS `order` 数六层）在
    //   `tests/ui/net-lane-tree.test.ts` —— 源码文本只能证明"分支这么写"，证明不了产出顺序。
    const side = between(code, 'function renderSide(', 'function renderLaneMid');
    expect(side, '自己侧必须**协议格在前**（层 4 贴中线、链路槽层 5 在其外）—— 两侧共用一个顺序 = C-2 回归')
      .toMatch(/kind === 'self'\)\s*\{[\s\S]{0,300}side\.appendChild\(protoNode\)[\s\S]{0,150}side\.appendChild\(slotNode\)/);
    expect(side, '对手侧必须**链路槽在前**（层 2 在外、协议格层 3 贴中线）—— 两侧共用一个顺序 = C-2 回归')
      .toMatch(/\}\s*else\s*\{[\s\S]{0,300}side\.appendChild\(slotNode\)[\s\S]{0,150}side\.appendChild\(protoNode\)/);
    // 两个节点确实来自那两个助手（挂载顺序钉的是"哪一份先挂"，这里把"哪一份是谁"补上）
    expect(side, '链路槽不是 renderStackSlot 的产物（顺序判据失去意义）').toMatch(/=\s*renderStackSlot\(/);
    expect(side, '协议格不是 renderProtocolCell 的产物（顺序判据失去意义）').toMatch(/=\s*renderProtocolCell\(/);
    // ③ 样式表：列/侧都是纵向，能量槽用 order 落在链路外侧端
    const css = read('styles-net.css');
    // ⚠️ `cssRules` 对这份样式表**不是**先去掉注释再解析（它按 `{}` 切块，块注释里的 `*`/`/`
    //    会留成 `/* */` 前缀），所以选择器要用 `endsWith` 比 —— 用 `===` 会假红。
    //    另外复合选择器里的换行/多空格也要压掉（`.a .b` 与 `.a  .b` 语义相同）。
    const norm = (s: string): string => s.replace(/\s+/g, ' ').trim();
    const ruleBody = (sel: string): string => {
      const want = norm(sel);
      const r = cssRules(css).find((x) => norm(x.selector).endsWith(want));
      expect(r, `styles-net.css 里找不到规则 ${sel}（布局腿被删？）`).toBeTruthy();
      return r?.body ?? '';
    };
    expect(ruleBody('.net-lane-band'), '`.net-lane-band` 不是纵向 flex —— 三个列就变回三条横带')
      .toMatch(/flex-direction:\s*column/);
    expect(ruleBody('.net-side'), '`.net-side` 不是纵向 flex（列内的两层会并排）')
      .toMatch(/flex-direction:\s*column/);
    expect(ruleBody('.net-lane-band .stack-slot'), '`.stack-slot` 不是纵向 flex（能量槽没法用 order 挪到上/下）')
      .toMatch(/flex-direction:\s*column/);
    // 能量槽的**外侧端归属**：对手 order 1（在链路 order 2 之上 ⇒ 列的**最上端**）、
    // 自己 order 3（在**最下端**）。**规格没变，选择器必须按侧给**（R-F · C-2）：
    // ⚠️ 旧判据钉的是 `.stack-slot.p1/.p2`（**绝对玩家号**）—— 而"哪一侧是自己"由**座位**决定，
    //    默认预览席位（`viewSeat = 0`，自己 = P0）下那两条会把**两个能量槽都摆到内侧**，
    //    与 §1 相反（评审真跑元素树实测）。按侧的钩子 `.net-side-foe` / `.net-side-self` 本来就在产出。
    expect(ruleBody('.net-lane-band .net-side-foe .stack-slot .battery'),
      '对手能量槽未**按侧**定 order（应在链路上方的外侧端 = 层 1）')
      .toMatch(/order:\s*1/);
    expect(ruleBody('.net-lane-band .net-side-self .stack-slot .battery'),
      '自己能量槽未**按侧**定 order（应在链路下方的外侧端 = 层 6）')
      .toMatch(/order:\s*3/);
    // 反空集合 + 反回归：**不得**再有按绝对玩家号给能量槽定 order 的规则（C-2 的第二个成因）
    expect(css, 'styles-net.css 仍按绝对玩家号（.p1/.p2）给能量槽定 order —— 默认席位下两个能量槽都会跑到内侧')
      .not.toMatch(/\.stack-slot\.p[12]\s*(?:,|\{)[^}]*order/);
    expect(ruleBody('.net-lane-band .stack-slot .battery'),
      '能量槽仍是绝对定位（styles.css:161 的 left/right:-120px 会把竖排的能量槽甩到列外）')
      .toMatch(/position:\s*static/);
    // 三条线仍然由同一个循环产出（写成 `[0, 1, 2]`；改长度必须同步第 17 条的期望数量表）
    expect(code, '三条线必须由 `for (const line of [0, 1, 2] as Line[])` 产出')
      .toMatch(/for \(const line of \[0, 1, 2\] as Line\[\]\)/);
  });

  /**
   * R1-2：**卡面**朝向 —— 场上卡 0°（自己）/ 180°（对手），且**必须按座位**传（不能写死）。
   *
   * 断言 2（运行时自查）已经会查"对手侧每张卡各自带 .rot-180"，本条的增量是**协议图**的
   * ∓90°（断言 2 查不到它，因为协议不再用 `.rot-180`）。
   * 守卫对照：旧版这里只有"不产出 ±90°"（第 3 条）与"orient 按座位传"（第 3 条后半），
   * 现在多两条：协议图 ∓90° 类的产出，以及"类名不写死在 render.ts 里"。
   */
  it('R1-2. 朝向分离：卡面 0°/180° 按座位传 + 协议图 ∓90° 用本页自有类（且 render.ts 里没有 .net-*）', () => {
    const code = netCode();
    // 卡面：`orient` 仍是按座位的三元实参（C-3 变异 A-2 的杀手，保留）
    expect(code, '链路槽的对手朝向未按座位传 orient')
      .toMatch(/orient:\s*isSelfSeat\s*\?\s*0\s*:\s*180/);
    // 协议图：∓90° 走 renderProtocolCell 的**第 5 个实参**（extraClass）
    expect(code, '自己协议的 ∓90° 类没交给 renderProtocolCell（协议会与卡面同向，全是正立/倒置）')
      .toMatch(/renderProtocolCell\(\s*s,\s*player,\s*line,\s*isSelfSeat\s*\?\s*0\s*:\s*180,\s*isSelfSeat\s*\?\s*'net-rot-ccw'\s*:\s*'net-rot-cw'/);
    const css = read('styles-net.css');
    expect(css, 'styles-net.css 未定义 .net-rot-ccw（自己协议 −90°）的规则')
      .toMatch(/\.net-rot-ccw\s*\{[^}]*rotate\(-90deg\)/);
    expect(css, 'styles-net.css 未定义 .net-rot-cw（对手协议 +90°）的规则')
      .toMatch(/\.net-rot-cw\s*\{[^}]*rotate\(90deg\)/);
    // ⚠️ 类名归属：远程页的类不得写进共享助手 render.ts（写进去 = 热座页源码依赖远程页的类名，
    //    "热座零变化"就不再是构造性的）。通用参数 `extraClass` 才是对的做法。
    const renderSrc = stripComments(read('render.ts'));
    expect(renderSrc, 'render.ts 里出现了 net-rot-* —— 远程页的字面量被硬写进共享助手（热座红线）')
      .not.toMatch(/net-rot-/);
    // extraClass 的真产出点必须在协议图 className 上（不是只声明了个参数）
    expect(renderSrc, 'render.ts 的 protocol-img 未把 extraClass 拼进类名（协议 ∓90° 不会生效）')
      .toMatch(/img\.className\s*=\s*'protocol-img'[^\n]*extraClass/);
    // 旋转的布局后果：静态盒必须补回来，否则横躺的协议溢出列宽压到相邻列
    expect(css, '协议图未给静态宽高（transform 不改布局盒 → 横躺的协议会压到相邻列）')
      .toMatch(/\.net-lane-band \.protocol-holder\s*\{[^}]*width:\s*100px[^}]*height:\s*140px/);
  });

  /**
   * R1-3：**竖向生长类** `.stack.grow-down`（自己）/ `.grow-up`（对手）+ **竖向重叠**。
   *
   * 守卫对照：旧版零覆盖（`.grow-left/.grow-right` 由 `renderStackSlot` 内部按绝对玩家给，
   * 热座页也在用，所以"本页是否改成了竖排"根本无从判断 —— 这正是重做前那条横排布局
   * 能一路全绿的原因之一）。现在钉：① `vGrow: true` 的真实参；② `.grow-*` **按侧**给
   * （`selfPlayer: viewSeat`）；③ 两个类名的 CSS 规则；④ 竖向重叠用 `margin-top`。
   *
   * ⚠️ **R-F · C-2 的守卫修正**：旧版只看"两边都传了 vGrow"，于是漏掉了另一半 ——
   * `grow-*` 的配对当时在 `render.ts` 里按**绝对玩家号**做（`player === 0 ? grow-down : grow-up`），
   * `viewSeat = 1` 时"自己向上长、对手向下长"，与 §1 的垂直镜像相反。现在 ② 把
   * "哪一号是自己由**座位**给"钉住；真正的元素树层序与 `.grow-*` 归属由
   * `tests/ui/net-lane-tree.test.ts` 真跑 `renderNetBoard` 后逐列断言。
   */
  it('R1-3. 竖向生长：vGrow 真实参 + selfPlayer 按座位 + .grow-down/.grow-up 规则 + 竖向重叠（margin-top）', () => {
    const code = netCode();
    expect(code, 'renderStackSlot 未传 vGrow: true（本页会退回热座页的横向生长）').toMatch(/vGrow:\s*true/);
    // 竖向生长必须**两种座位都**生效，且"哪一号是自己"必须由**座位**给（不是按绝对玩家号）
    const iSlot = code.indexOf('renderStackSlot(');
    expect(iSlot, '找不到 renderStackSlot( 的调用（结构被改？）').toBeGreaterThanOrEqual(0);
    const stackOpts = code.slice(iSlot, iSlot + 2000);
    expect(stackOpts, 'vGrow 不在 renderStackSlot 的 opts 里（传给了别的调用？）')
      .toMatch(/vGrow:\s*true/);
    expect(stackOpts, '竖向生长未把"哪一号是自己"按**座位**交给共享助手（selfPlayer: viewSeat）'
      + '—— 按绝对玩家号会让 viewSeat=1 时"自己向上长、对手向下长"（规格 §1 的垂直镜像不成立）')
      .toMatch(/selfPlayer:\s*viewSeat/);
    const css = read('styles-net.css');
    expect(css, 'styles-net.css 未定义 .stack.grow-down（自己：向下长）')
      .toMatch(/\.stack\.grow-down\s*\{[^}]*flex-direction:\s*column/);
    expect(css, 'styles-net.css 未定义 .stack.grow-up（对手：向上长）')
      .toMatch(/\.stack\.grow-up\s*\{[^}]*flex-direction:\s*column/);
    expect(css, 'styles-net.css 未定义竖向重叠（`.card + .card` 的 margin-top）—— 卡会 100% 全展、一列撑爆')
      .toMatch(/\.stack \.card \+ \.card\s*\{[^}]*margin-top:\s*calc\(/);
    // ⚠️ 这仍然是**源码代理**：`.grow-*` 只是类名，真正的方向由运行期 flex 布局算出来。
    // 哪一侧拿哪个类（按座位）的**行为**判据在 tests/ui/net-lane-tree.test.ts（真跑 + 查元素树）。
  });

  /**
   * R1-4：**特效朝向标记** `data-fx-rot`（约束 8；R1 只负责**产出**，读侧是 R2 的 `fxOrientOf`）。
   * 自己 = `"ccw"`（−90°）、对手 = `"cw"`（+90°）—— 规格 §8.2 钉死的名字。
   *
   * ⚠️ 它与**卡面**朝向是两套（自己卡面 0° 而特效 −90°），所以判据必须是"按座位给的两个值"，
   * 不能是"从 orient 推导"（那样热座页也会被写出标记）。
   * 守卫对照：旧版零覆盖（这个钩子本轮才出现）。
   */
  it('R1-4. 特效朝向标记：data-fx-rot 的两种取值（自己 ccw / 对手 cw）+ 热座不产出', () => {
    const code = netCode();
    expect(code, '未按座位传 fxRot（特效朝向标记没产出）')
      .toMatch(/fxRot:\s*isSelfSeat\s*\?\s*'ccw'\s*:\s*'cw'/);
    const renderSrc = stripComments(read('render.ts'));
    // 生产点必须在**卡节点**上（不是随便某个 dataset）
    expect(renderSrc, 'render.ts 未把 fxRot 写到卡节点上（`node.dataset.fxRot = opts.fxRot`）——标记不会出现在 DOM 里')
      .toMatch(/node\.dataset\.fxRot\s*=\s*opts\.fxRot/);
    expect(renderSrc, 'fxRot 的写入没有 opts?.fxRot !== undefined 守卫 → 热座页也会被打上标记'
      + '（R2 的 fxOrientOf 就再也回退不回 orientOf，"热座零变化"被打破）')
      .toMatch(/if\s*\(\s*opts\?\.fxRot\s*!==\s*undefined\s*\)/);
    // 热座渲染器里不得出现任何远程页字面量（标记的**读**侧在 R2，R1 不许碰 FX 层）
    expect(renderSrc, "render.ts 里出现了 'data-fx-rot' 字面量（那是 R2 的读侧钩子，R1 只产出）")
      .not.toContain('data-fx-rot');
  });

  /**
   * R1-5：**手牌中置**（规格 §1）与"协议图的 180° 只属热座页"。
   *
   * 手牌中置的判据必须是"样式表里真的把这一块居中"：
   *  - `.net-hands` 的 `justify-items: center`（块级子项水平中置）；
   *  - `.net-hand-side` 的 `align-items: center`（块内信息条/标签/手牌统一中置，否则窄容器里贴左会显得歪）。
   * 两条腿分开查、且指名到选择器：只查 `align-items: center` 会被**任何**一条 flex 规则满足
   * （`.hand` 自己就是 `align-items: flex-start`）。
   *
   * 第二条：远程页的协议**不**走 180°（那是卡面朝向），而热座页确实仍在产出
   * `.protocol-img.rot-180` —— 必须两边都钉，否则"协议 ∓90° 改对了"与"热座被顺手改坏"
   * 这两种情况在删掉任一条断言后都会静默。
   */
  it('R1-5. 手牌区水平中置（选择器级判据）+ 协议 180° 仍在热座页产出（∓90° 只属远程页）', () => {
    const css = read('styles-net.css');
    expect(css, 'styles-net.css 未把 .net-hands 的子项水平中置（手牌区没有中置）')
      .toMatch(/\.net-hands\s*\{[^}]*justify-items:\s*center/);
    expect(css, 'styles-net.css 未把 .net-hand-side 的内容水平中置（信息条/小标签会贴左）')
      .toMatch(/\.net-hand-side\s*\{[^}]*align-items:\s*center/);
    // 热座页的协议 180° 产出点**一行未改**（`orient === 180 ? ' rot-180' : ''`）——
    // 它是 A 类钩子 `.rot-180` 在热座页的唯一产出点，也是"远程页 ∓90° 不能借用 .rot-cw/.rot-ccw"
    // 这条裁决的对照面（两种朝向并存，谁也不许吃掉谁）。
    const renderSrc = stripComments(read('render.ts'));
    expect(renderSrc, 'render.ts 的协议 180° 产出点被改动了（热座红线：协议图的 .rot-180）')
      .toMatch(/'protocol-img'\s*\+\s*\(orient === 180 \? ' rot-180' : ''\)/);
    // 反向：本页**不**产出任何热座专属朝向类（第 3 条已有前半，这里补"协议也不产出"）
    expect(netCode()).not.toMatch(/['"]rot-cw['"]|['"]rot-ccw['"]/);
  });

  /**
   * M-3：热座 `renderBoard` 的两个几何型点名特效（透彻牌库眼睛 / 幸运宣告骰子）曾经在远程页
   * 完全缺失（三个 choice-* 分支是重写的）。它们都用**契约钩子**定位（`.deck[data-player]` /
   * 源卡 `[data-uid]`），远程页的节点都在，所以直接复用；但必须在棋盘**挂进 root**
   * **之后**执行 —— 此前 `getBoundingClientRect()` 全 0，特效会静默不显示。
   */
  it('16. M-3：几何型 FX 走 deferredFx，且在棋盘挂进 root 之后执行', () => {
    const code = netCode();
    expect(code, '未复用 startClarityDeckEye（透彻：从牌库中选择 的古埃及眼睛在远程页不播）')
      .toContain('startClarityDeckEye(');
    expect(code, '未复用 startLuckDiceFx（luck-0/3 宣告的骰子在远程页不播）').toContain('startLuckDiceFx(');
    expect(code).toMatch(/deferredFx\.push\(/);
    const entry = code.slice(code.indexOf('export function renderNetBoard'));
    const isCode = codePositions(entry);
    // ⚠️ G2 Task 3F3：挂载点不再绑定 `root.appendChild(wrap);` 这一种写法 —— 变异 E3 实测
    //    `root.append(wrap)`（语义等价）会让本条**假红**。这里与守卫 1b 用同一组挂载形态。
    const mountHits = MOUNT_FORMS.flatMap((f) => codeMatches(entry, f, isCode))
      .concat(codeMatches(entry, REPLACE_MOUNT, isCode)
        .filter((at) => !entry.slice(at + REPLACE_MOUNT.length).trimStart().startsWith(')')));
    const iMount = mountHits.length > 0 ? Math.min(...mountHits) : -1;
    const iRun = entry.indexOf('for (const fn of deferredFx) fn();');
    expect(iMount, '找不到"把棋盘挂进 root"的调用（appendChild( / append( / replaceChildren(<实参>)）')
      .toBeGreaterThanOrEqual(0);
    expect(iRun, '找不到 deferredFx 的执行点').toBeGreaterThanOrEqual(0);
    expect(iRun, '几何型 FX 在棋盘入 DOM 之前执行 → getBoundingClientRect() 全 0、特效静默不显示')
      .toBeGreaterThan(iMount);
    // 两个特效必须由**选择分支**触发（与热座同条件），而不是无条件播
    expect(code).toMatch(/prompt\.title\.startsWith\('透彻：从牌库中选择'\)/);
    expect(code).toMatch(/prompt\.title\.startsWith\('luck-0：宣告'\)/);
  });

  /**
   * R3-2（G2 修正 R3）：**方向座位**只在渲染时设一次，且**必须来自 `opts.viewSeat`**。
   *
   * 为什么单列一条（而 `tests/ui/fx-seat.test.ts` 已有一条）：那条守卫的是"设了一次、且早于挂载"，
   * 这条钉的是**调用形态与参数来源**：`applyFxViewSeat(opts.viewSeat)`（写常量 = 切换视角失效）、
   * 且 `render-net.ts` 里**不出现** `setFxViewSeat(` 直调（直调就拿不到"写进去的值"，
   * 运行时断言 4 的契约链会失去判据）。
   */
  it('R3-2. 方向座位：applyFxViewSeat(opts.viewSeat) 恰好一次；不得直调 setFxViewSeat', () => {
    const code = netCode();
    expect((code.match(/applyFxViewSeat\(/g) ?? []).length,
      'render-net.ts 必须**恰好**设一次方向座位（多了就是"每处都设"的散弹式写法）').toBe(1);
    expect(code, '方向座位不是从 opts.viewSeat 取的（切换视角会失效）')
      .toMatch(/applyFxViewSeat\(\s*opts\.viewSeat\s*\)/);
    expect(code, 'render-net.ts 直调了 setFxViewSeat —— 拿不到写进去的值，运行时断言 4 失去判据')
      .not.toMatch(/\bsetFxViewSeat\s*\(/);
    // 它必须交回自查（断言 4 的契约链：渲染期写进去的值 == 模块态）
    expect(code, 'verifyPageHooks 未收到渲染期写进去的座位')
      .toMatch(/verifyPageHooks\(\s*wrap\s*,\s*seatApplied\s*\)/);
    // 控制轨：仍由共享助手产出（A 类钩子拼写不变），且**本页**显式传竖向 + 座位换算后的持有者
    expect(code, '控制轨未按竖向渲染（用户裁决"控制轨改成竖向，自己端在下、对手端在上"）')
      .toMatch(/grid\.appendChild\(renderControlModule\(s,\s*\{\s*axis:\s*'y',\s*holder:\s*netControlHolder\(s,\s*viewSeat\)\s*\}\)\)/);
  });

  /**
   * F-2（复评 Important）：**计数盲区** —— 只查"存在"不查"个数"。
   *
   * 评审变异 R4：删掉 `band.appendChild(renderSideRow(s, foe, …))`（对手的 6 个 `.stack-slot`、
   * 6 个 `.protocol-cell`、6 个 `.battery` 全没）→ 契约 24 + 本文件 18 = **42/42 全绿**，
   * 而运行时自查也报 `自查 ✓`（自己侧每类仍各有一个）。
   *
   * 本条的职责：把 `verifyPageHooks` 的**期望数量表**从**源码结构推导出来**，而不是把数字再抄一遍。
   *   - 一帧 = `for (const line of [0, 1, 2])` 三条线 × `band.appendChild(renderSideRow(…))` 两侧；
   *   - 每侧的链路槽/协议格各 1 → `.stack-slot`/`.protocol-cell`/`.battery`/`.protocol`/
   *     `.protocol-holder`/`.protocol-img` = 3 × 2 = 6；
   *   - 牌库/弃牌堆来自 `renderPiles`（唯一调用点，两处挂载互补）→ 2；手牌来自 `renderHand(` → 2；
   *     控制轨来自 `renderControlModule(` → 1。
   * 这样"删掉一侧挂载"会同时打破 ①两个挂载字面量、②推导出的数量，而**数字本身也不可能被悄悄改小**
   * （表里少一个 `expected` 字段或改小数字都会在下面对比里报红）。
   */
  it('17. F-2：verifyPageHooks 的**期望数量表**必须与源码结构一致（无 jsdom 下的结构腿）', () => {
    const code = netCode();
    // ① 两侧 `renderSide` 的真实挂载（评审变异 R4 正是删掉了其中一条）
    //    ⚠️ G2 修正 R1：函数名由 `renderSideRow` 改为 `renderSide`，且新增了 `kind` 实参
    //    （`'foe'` / `'self'`）—— 判据同步成 `renderSide(s, foe …` / `renderSide(s, viewSeat …`
    //    （**挂载对象仍是同一个 `col`**，故"整条对手侧行消失"这个变异形态照样被抓）。
    expect(code, '对手侧的整侧挂载不见了（对手 6 个 .stack-slot / 6 个 .protocol-cell 全没）')
      .toMatch(/col\.appendChild\(renderSide\(s,\s*foe,/);
    expect(code, '自己侧的整侧挂载不见了').toMatch(/col\.appendChild\(renderSide\(s,\s*viewSeat,/);
    const sideMounts = (code.match(/col\.appendChild\(renderSide\(/g) ?? []).length;
    expect(sideMounts, 'renderSide 必须恰好挂载两次（对手 / 自己各一次）').toBe(2);
    // 三条线来自同一个循环（写死 `[0, 1, 2]`；改成别的长度必须同步改期望表）
    expect(code, '三条线必须由 `for (const line of [0, 1, 2] as Line[])` 产出').toMatch(/for \(const line of \[0, 1, 2\] as Line\[\]\)/);
    const LANES = 3;
    const perFrame = LANES * sideMounts;                       // 6
    const pilesCalls = (code.match(/renderPiles\(s, /g) ?? []).length;
    const handCalls = (code.match(/renderHand\(/g) ?? []).length;
    const controlCalls = (code.match(/renderControlModule\(/g) ?? []).length;
    expect(pilesCalls, 'renderPiles 的调用点应恰好两处（对手条 + 自己行）').toBe(2);
    expect(handCalls, 'renderHand 的调用点应恰好两处（P0 / P1）').toBe(2);
    expect(controlCalls, 'renderControlModule 的调用点应恰好一处').toBe(1);

    const expectOf = (hook: string): number | undefined => NET_PAGE_HOOKS.find((h) => h.hook === hook)?.expected;
    // ② 数量 = 结构推导值（不是抄一遍数字）
    for (const hook of [
      '.stack-slot[data-player][data-line]', '.protocol-cell[data-player][data-line]',
      '.protocol-img', '.protocol', '.protocol-holder', '.battery',
    ]) {
      expect(expectOf(hook), `${hook} 的 expected 必须等于 线数 × 侧数 = ${perFrame}`).toBe(perFrame);
    }
    for (const hook of ['.deck[data-player]', '.trash-pile[data-player]', '.trash-pile.p1/.p2']) {
      expect(expectOf(hook), `${hook} 的 expected 必须等于 renderPiles 的调用点数 = ${pilesCalls}`).toBe(pilesCalls);
    }
    for (const hook of ['.hand', '.hand[data-player]']) {
      expect(expectOf(hook), `${hook} 的 expected 必须等于 renderHand 的调用点数 = ${handCalls}`).toBe(handCalls);
    }
    for (const hook of ['.control-module', '.control-slider-img', '.control-track']) {
      expect(expectOf(hook), `${hook} 的 expected 必须等于 renderControlModule 的调用点数 = ${controlCalls}`).toBe(controlCalls);
    }
    // ③ 分类完备：每条非豁免钩子**要么**定数量、**要么**标状态相关（不许两头都不占）
    const classified = NET_PAGE_HOOKS.filter((h) => h.exempt === undefined);
    expect(classified.filter((h) => h.expected === undefined && h.stateDependent === undefined).map((h) => h.hook),
      '以下钩子既没定数量、也没标"状态相关"（自查会对它既不报错也不计数）').toEqual([]);
    // ④ 反之：状态相关钩子**不得**定数量（`.card`/`[data-uid]`/`img` 在空局面合法为 0，定了会稳定误报）
    expect(NET_PAGE_HOOKS.filter((h) => h.stateDependent !== undefined && h.expected !== undefined).map((h) => h.hook),
      '状态相关钩子被定了数量（空局面会稳定误报）').toEqual([]);
    // ⑤ 定数量的恰好是这 14 条（少一条或多一条都要在这里说清楚）
    expect(NET_PAGE_HOOKS.filter((h) => h.expected !== undefined).map((h) => h.hook).sort()).toEqual([
      '.battery', '.control-module', '.control-slider-img', '.control-track',
      '.deck[data-player]', '.hand', '.hand[data-player]',
      '.protocol', '.protocol-cell[data-player][data-line]', '.protocol-holder', '.protocol-img',
      '.stack-slot[data-player][data-line]', '.trash-pile.p1/.p2', '.trash-pile[data-player]',
    ].sort());
    // ⑥ `verifyPageHooks` 必须真的**用**这个字段（不是只声明）
    expect(code, 'verifyPageHooks 未使用 expected（计数判据被关掉）').toMatch(/const want = h\.expected;/);
    expect(code, 'verifyPageHooks 未把实际数量与期望数量对比').toMatch(/found !== want/);
    expect(code, 'verifyPageHooks 未把数量写进报告文本').toMatch(/数量 \$\{found\}，期望 \$\{want\}/);
  });

  /**
   * `syntheticPage` 与 `fakeScope` 共享的"该侧约定的标记取值"。
   * 为什么要共享：`render-net.ts` 的取值断言用的是**无值形式**选择器
   * （`.net-side-self .card[data-fx-rot]` —— 真实 DOM 里选择器不会带值），桩因此拿不到值，
   * 必须由合成页告诉它"这一侧应该是什么值"。`null` = 标记整个缺失（回退路径的合成形态）。
   */
  let selfFxRot: string | null = 'ccw';
  let foeFxRot: string | null = 'cw';

  /**
   * R2-1（G2 修正 R2）：**特效朝向标记**在 `NET_PAGE_HOOKS` 里的登记形态。
   *
   * 为什么单列一条：镜像相等（第 2b 条）只保证"表里有这一条"，证明不了**它怎么被判**。
   * `[data-fx-rot]` 是**逐卡**挂在场上卡上的（数量随场面变化），若有人给它顺手填一个
   * `expected: 6`，空局面会**稳定误报**（页面上那 6 个槽里可能一张卡都没有）——
   * 而空局面是**合法**的。反过来，若把它删掉，第 2b 条的集合相等会红，但那条消息指向"契约漂移"，
   * 读起来不知道是"远程页少了这条钩子"。
   *
   * 另一条腿：`exempt` 在热座页那一侧（`RENDERERS` 的 `render.ts`），本页**必须提供**它 ——
   * 由上一条（第 2 条）的 `renderStackSlot(` 调用链与运行时断言 3（约束 8）共同承担。
   */
  it('R2-1. [data-fx-rot] 在表里登记为 stateDependent（不计数）且产出链条锚在 renderStackSlot(', () => {
    const entry = NET_PAGE_HOOKS.find((h) => h.hook === '[data-fx-rot]');
    expect(entry, '[data-fx-rot] 未登记进 NET_PAGE_HOOKS（契约漂移）').toBeTruthy();
    expect(entry?.expected, '[data-fx-rot] 定了数量 —— 它是**逐卡**标记，空局面合法为 0，定死会稳定误报')
      .toBeUndefined();
    expect(entry?.stateDependent, '[data-fx-rot] 既没定数量也没标状态相关（自查会对它既不报错也不计数）')
      .toBeTruthy();
    expect(entry?.call, '[data-fx-rot] 的产出链条不对（值经 renderStackSlot 的 fxRot 参数逐卡写入）')
      .toEqual(['renderStackSlot(']);
    expect(entry?.probeSelector, '[data-fx-rot] 缺运行时探测选择器')?.toBe('[data-fx-rot]');
    // 反空集合：热座那条豁免必须与本页的"必须提供"成对（两边都缺就等于这条契约无人验收）
    const hotseat = RENDERERS.find((r) => r.file === 'render.ts');
    expect(hotseat?.exempt, 'render.ts 没有豁免 [data-fx-rot]（热座页会产出标记 ⇒ 回退机制失效）')
      .toContain('[data-fx-rot]');
    const net = RENDERERS.find((r) => r.file === 'render-net.ts');
    expect(net?.exempt ?? [], 'render-net.ts 不得豁免 [data-fx-rot]（它是唯一产出方）')
      .not.toContain('[data-fx-rot]');
  });

  /** 合成「一帧远程页」的选择器计数（`sides: 1` = 评审变异 R4：对手侧整行消失） */
  function syntheticPage(o: {
    sides?: number;
    foeInverted?: boolean;
    /** `null` = 标记整个缺失（回退路径）；字符串 = 两套卡的标记取值（默认按座位正确） */
    fxRot?: { self: string; foe: string } | null;
  } = {}): Record<string, number> {
    const sides = o.sides ?? 2;
    const perLine = 3 * sides;      // 每类"每线每侧各一个"
    const foeCards = sides === 2 ? 2 : 0;
    const selfCards = sides === 2 ? 2 : 0;
    const foeProto = sides === 2 ? 3 : 0;
    const inv = o.foeInverted === false ? 0 : undefined;
    // G2 修正 R2 · 约束 8：标记**逐卡**挂。`fxRot === null` 模拟"标记缺失"（回退路径）；
    // 取值由调用方给（默认按座位正确），供"取值反了"的断言使用。
    const selfVal = o.fxRot === null ? null : (o.fxRot?.self ?? 'ccw');
    const foeVal = o.fxRot === null ? null : (o.fxRot?.foe ?? 'cw');
    // 带值的键：**只在有值时**追加。⚠️ 无值时**不写**这个键 —— 否则 `Object.fromEntries` 会用
    // 0 覆盖上面 `.net-side-foe .card` 的计数（我第一版就是这么错的：标记缺失时卡片数也变成 0，
    // 于是硬约束 2 抢在约束 8 前面报红）。
    const keyOf = (sel: string, val: string | null, n: number): Array<[string, number]> =>
      val === null ? [] : [[`${sel}[data-fx-rot="${val}"]`, n]];
    // 无值形式的选择器（`.card[data-fx-rot]`）不携带值 —— 桩需要知道"这一侧约定值是多少"。
    // 放在模块作用域的兄弟变量里，`fakeScope` 读它（`fxRot: null` 时置 null = 标记缺失）。
    selfFxRot = selfVal;
    foeFxRot = foeVal;
    return {
      '.stack-slot[data-player][data-line]': perLine,
      '.protocol-cell[data-player][data-line]': perLine,
      '.protocol-img': perLine,
      '.protocol': perLine,
      '.protocol-holder': perLine,
      '.battery': perLine,
      '[data-uid]': 4,                                   // 状态相关：不计数
      '[data-fx-rot]': foeVal === null ? 0 : foeCards + selfCards, // 21 条 A 类里的新钩子（存在性自查）
      '.trash-pile[data-player]': 2,
      '.trash-pile.p1, .trash-pile.p2': 2,
      '.deck[data-player]': 2,
      '.hand': 2,
      '.hand[data-player]': 2,
      '.card': 4,                                        // 状态相关：不计数
      img: 20,                                           // 状态相关：不计数
      '.control-module': 1,
      '.control-slider-img': 1,
      '.control-track': 1,
      '.net-side-foe .card': foeCards,
      '.net-side-self .card': selfCards,
      '.net-side-foe .card.rot-180': inv ?? foeCards,
      // ── 约束 8 的三条探测：无值的（计数用）+ 带具体值的（取值用；桩按"基础选择器"取数量）──
      '.net-side-foe .card[data-fx-rot]': foeVal === null ? 0 : foeCards,
      '.net-side-self .card[data-fx-rot]': selfVal === null ? 0 : selfCards,
      ...Object.fromEntries([
        ...keyOf('.net-side-self .card', selfVal, selfVal === null ? 0 : selfCards),
        ...keyOf('.net-side-foe .card', foeVal, foeVal === null ? 0 : foeCards),
      ]),
      '.net-side-foe .protocol-img': foeProto,
      '.net-side-foe .protocol-img.rot-180': inv ?? foeProto,
      '.net-side-self .card.rot-180, .net-side-self .card.rot-cw, .net-side-self .card.rot-ccw': 0,
    };
  }

  /**
   * 合成 DOM 桩：**只**实现 `verifyPageHooks` 用到的三个方法（无 jsdom）。
   *
   * ⚠️ 它证明的是「**计数逻辑本身有牙齿**」（缺了对手侧的合成树必须报 ✗ 并说出期望数量），
   * **不是**"真实 DOM 里有这些节点" —— 后者只能靠 `opts.verifyHooks` 在预览页真跑 +
   * 用户在 5173 上做点名特效抽查。它是"期望值表在无 jsdom 下也有牙齿"的第二条腿：
   * 第一条腿是第 17 条（数字从源码结构推导），这一条把 `verifyPageHooks` **真的执行一遍**。
   *
   * G2 修正 R2：加了 `getAttribute`（约束 8 的"取值按座位"断言要读它 —— `querySelectorAll`
   * 只能证明"带了属性"，证明不了"值对不对"）。
   */
  function fakeScope(counts: Record<string, number>, handOrder: number[] = [0, 1]): HTMLElement {
    /** 选择器里可能带 `[attr="value"]` / `[attr=value]`（约束 8 的合成树用它验取值） */
    const attrOf = (sel: string): Record<string, string> => {
      const out: Record<string, string> = {};
      for (const m of sel.matchAll(/\[([a-z-]+)=["']?([^"'\]]+)["']?\]/g)) {
        out[m[1].replace(/^data-/, '').replace(/-([a-z])/g, (_a, c: string) => c.toUpperCase())] = m[2];
      }
      return out;
    };
    const listOf = (sel: string): Array<{ dataset: Record<string, string>; getAttribute: (n: string) => string | null }> => {
      // 带值的属性选择器（`.card[data-fx-rot="ccw"]`）在计数表里没有自己的键 → 取"基础选择器"
      // 的数量，再把属性值喂给桩（真实 DOM 里这两条查询返回的是**同一批节点**，桩必须同构）。
      const baseline = sel.replace(/\[[a-z-]+(?:=["'][^"']*["'])?\]\s*$/, '');
      const n = counts[sel] ?? counts[baseline] ?? 0;
      if (sel === '.hand') return handOrder.slice(0, n).map((p) => ({ dataset: { player: String(p) }, getAttribute: () => null }));
      // ⚠️ 无值形式（`.card[data-fx-rot]`）的选择器**不携带值** ⇒ 桩从"该侧约定值"补上，
      //    否则 `getAttribute('data-fx-rot')` 恒为 null、取值断言永远报红（我第一版就踩了这里：
      //    以为选择器字符串里会带 `="ccw"`，实际运行时那条查询是无值形式）。
      //    `null` = 该侧没有标记（约束 8 的反面用例）；显示为 `dataset` 时剔除 null 项。
      const attrs: Record<string, string | null> = {
        ...(baseline === '.net-side-self .card' ? { fxRot: selfFxRot } : {}),
        ...(baseline === '.net-side-foe .card' ? { fxRot: foeFxRot } : {}),
        ...attrOf(sel),
      };
      const dataset: Record<string, string> = {};
      for (const [k, v] of Object.entries(attrs)) if (v !== null) dataset[k] = v;
      return Array.from({ length: n }, () => ({
        dataset,
        getAttribute: (name: string): string | null => {
          const key = name.replace(/^data-/, '').replace(/-([a-z])/g, (_a, c: string) => c.toUpperCase());
          return attrs[key] ?? null;
        },
      }));
    };
    return {
      querySelectorAll: (sel: string) => listOf(sel),
      querySelector: (sel: string) => listOf(sel)[0] ?? null,
    } as unknown as HTMLElement;
  }

  it('18. F-2：把合成 DOM 桩喂给 verifyPageHooks() 真跑 —— 正常 ✓ / 状态相关为空仍 ✓ / 非法选择器不抛', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    try {
      expect(verifyPageHooks(fakeScope(syntheticPage()))).toMatch(/^自查 ✓/);
      // 状态相关钩子为空（合法局面：手牌打空 + 场上空）→ 仍 ✓，只走 info 通道，不进失败计数
      const empty = syntheticPage();
      empty['.card'] = 0; empty['[data-uid]'] = 0; empty.img = 0;
      expect(verifyPageHooks(fakeScope(empty))).toMatch(/^自查 ✓/);
      expect(info, '状态相关钩子为空时应留下 info 记录（而不是静默）').toHaveBeenCalled();
      // C-2 回归：非法选择器（querySelectorAll 抛 SyntaxError）不得让函数抛异常，只报一条具名失败
      const boom = {
        querySelectorAll: () => { throw new SyntaxError("Unexpected token Delim('/')"); },
        querySelector: () => null,
      } as unknown as HTMLElement;
      let out = '';
      expect(() => { out = verifyPageHooks(boom); }, '非法选择器让 verifyPageHooks 抛异常（C-2 回归）').not.toThrow();
      expect(out).toContain('非法');
      expect(warn, '失败必须留下 console.warn 证据（不能只在返回值里）').toHaveBeenCalled();
    } finally {
      warn.mockRestore();
      info.mockRestore();
    }
  });

  it('19. F-2：缺对手侧整行 / 手牌顺序反了 / 对手卡没倒置 —— 运行时自查都必须报 ✗', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    try {
      // ① 评审变异 R4 的**运行时等价形态**：对手侧整行消失（每类只剩 3）
      const missingFoe = verifyPageHooks(fakeScope(syntheticPage({ sides: 1 })));
      expect(missingFoe, '缺了对手侧整行却报 ✓ —— 计数判据没生效（这就是 F-2）').toMatch(/^自查 ✗/);
      expect(missingFoe, '失败信息必须同时给出实际数量与期望数量').toContain('数量 3，期望 6');
      // ② `.hand` 顺序反了（[P1, P0]）→ 约束 7
      expect(verifyPageHooks(fakeScope(syntheticPage(), [1, 0])), '手牌顺序反了没报（FX 会飞错手牌区）')
        .toContain('约束 7');
      // ③ 对手卡没带 .rot-180 → 硬约束 2
      expect(verifyPageHooks(fakeScope(syntheticPage({ foeInverted: false }))), '对手卡没倒置没报')
        .toContain('硬约束 2');
      // ④ G2 修正 R2 · 约束 8：特效朝向标记整个缺失（远程页忘了产出 ⇒ fxOrientOf 静默回退卡面朝向
      //    ⇒ 整类特效差 90°、且**不会有任何报错** —— 这正是这条运行时断言存在的唯一理由）
      //    ⚠️ `foeInverted: true` 是必须的：合成页的 **rot-180 计数与 [data-fx-rot] 计数是同源的**，
      //    不显式给真值的话"标记缺失"会同时打红硬约束 2，fatal[0] 就不是约束 8（测试看不到它）。
      expect(verifyPageHooks(fakeScope(syntheticPage({ fxRot: null, foeInverted: true }))),
        '特效朝向标记缺失却没报 —— R2 最危险的静默退化')
        .toContain('约束 8');
      // ⑤ 标记存在但**取值反了**（自己拿到 cw、对手拿到 ccw）：计数断言看不见这个，
      //    只有"逐卡读 getAttribute 比对座位值"的断言能抓 —— 故必须有这条反面用例。
      expect(verifyPageHooks(fakeScope(syntheticPage({ fxRot: { self: 'cw', foe: 'ccw' }, foeInverted: true }))),
        '自己侧的标记取值不是 ccw 却没报（特效朝向与座位相反）')
        .toContain("必须是 'ccw'");
      // 阳性对照：取值正确时不得报约束 8
      const ok = verifyPageHooks(fakeScope(syntheticPage()));
      expect(ok, '取值正确却报了约束 8（假红）').toMatch(/^自查 ✓/);
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
      info.mockRestore();
    }
  });
});
