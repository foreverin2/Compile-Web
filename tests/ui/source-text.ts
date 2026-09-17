/**
 * 源码文本守卫的**共用助手**（G2 Task 3F 抽出）。
 *
 * 为什么必须**一份实现、多处共用**，而不是每个测试文件各存一份：
 *   `stripComments` 是"去注释判据"的**唯一实现**。两份拷贝一旦漂移，其中一边就会因为
 *   "注释没被删掉"而**假绿** —— 而假绿的那一半在报告里看起来完全正常（G2 Task 3 的 I-2
 *   就是这个形态：`fx-orient.test.ts` 的产出方守卫读裸源码，被 `render.ts` 里一句新增的
 *   中文注释满足，实测把缺省朝向反转 / 删掉 180° 分支后**全套 945 项仍全绿**）。
 *
 * 本文件**不是** `*.test.ts`，不会被 vitest 当测试收集
 * （`vite.config.ts` 的 `include` 是 `tests/**\/*.test.ts`）；它只被测试 import。
 */

/**
 * 去掉行注释（`//` 起）与块注释（`/*` 起），**引号与模板串里的内容一律保留**。
 *
 * 为什么不用正则：`'//'`、`"/*"`、模板串里的注释样式字符会被正则误吃，把真实代码当注释删掉
 * （制造**假红**）；而在别处又会把注释留下（**假绿**）。
 *
 * 行号保持：注释内容替换为**等长空白**（注释起始的两个字符本身留在原位，只是不再是注释），
 * 于是 `split('\n').length` 与原文一致，报错里的行号可直接对照源码。
 *
 * **已知局限（有意接受，不在本轮修）** —— 两处的失败方向都已实测，且当前真实树**零命中**：
 *  1. **模板串 `${}` 插值里的注释不会被删** → **假绿**方向（反引号到反引号整段当字符串，
 *     不解析插值）。本仓被扫文件里此类写法 0 命中。
 *  2. **正则字面量里含未转义的 `//` 会截断该行** → **假红**方向。真正消歧需要完整词法器
 *     （区分除法与正则）；本仓被扫文件里没有任何真实正则含 `//` 或 `/*`（已逐字符复核）。
 */
export function stripComments(src: string): string {
  const out: string[] = new Array(src.length);
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (c === '/' && n === '/') {                       // 行注释：替换到行尾（不含换行）
      while (i < src.length && src[i] !== '\n') { out[i] = ' '; i += 1; }
      continue;
    }
    if (c === '/' && n === '*') {                       // 块注释：替换到闭合处（含），保留换行
      out[i] = '/'; out[i + 1] = '*'; i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) {
        out[i] = src[i] === '\n' ? '\n' : ' ';
        i += 1;
      }
      if (i < src.length) { out[i] = '*'; out[i + 1] = '/'; i += 2; }
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {          // 字符串 / 模板串：整段原样保留
      const quote = c;
      out[i] = c; i += 1;
      while (i < src.length) {
        const ch = src[i];
        out[i] = ch;
        i += 1;
        if (ch === '\\') { if (i < src.length) { out[i] = src[i]; i += 1; } continue; }
        if (ch === quote) break;
      }
      continue;
    }
    out[i] = c; i += 1;
  }
  return out.join('');
}

/**
 * 代码位（不在注释、也不在字符串/模板串里的字符）在 `src` 中的下标。
 *
 * **导出原因**（G2 Task 3F3）：守卫 1b 需要判断"某条语句是不是**真的代码**"——
 * 纯 `indexOf` 文本搜索会被**诱饵字符串**满足（`const CLEAR_DOC = "root.textContent = ''";`），
 * 那与 G1 / 3F 已经栽过两次的"注释满足守卫"是**同一族失效**（读上去像已验收）。
 * 与其在测试里再写一份词法扫描（第三份实现必然漂移），不如共用这一份。
 *
 * ⚠️ 已知局限与 `stripComments` 完全相同：模板串**整段**按字符串处理（`${}` 插值里的字符会被
 * 当成"非代码"）→ 方向是**假红**（判据更严），对本用途安全；正则字面量里含未转义的 `//` 会截断
 * 该行 → 方向也是假红。本仓被扫文件里两者都零命中。
 */
export function codePositions(src: string): boolean[] {
  const isCode: boolean[] = new Array(src.length).fill(false);
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (c === '/' && n === '/') { while (i < src.length && src[i] !== '\n') i += 1; continue; }
    if (c === '/' && n === '*') {
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i += 1;
      i += 2;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      const quote = c; i += 1;
      while (i < src.length) {
        const ch = src[i]; i += 1;
        if (ch === '\\') { i += 1; continue; }
        if (ch === quote) break;
      }
      continue;
    }
    isCode[i] = true;
    i += 1;
  }
  return isCode;
}

/**
 * 取 `function <name>(` 的**花括号配平**函数体（含函数头，返回 `function name(...) { … }` 整段）。
 *
 * 为什么必须配平而不是"切到文件尾"：同一文件里函数之间还有别的顶层声明，切到文件尾会把
 * 后续函数的文本也算进"体内" —— 于是「这条断言只查这个函数」会变成「查整个文件」，
 * **静默失去判别力**（G2 Task 4F · Minor M-1 的真实形态：`main.ts` 第 3 条守卫用整份文件
 * 做 `toMatch`，被 devmode 那处的 `renderApp(` 满足 → 删掉 `rerender()` 的回退分支仍然全绿）。
 *
 * 字符串/模板串按整段跳过（里面可能出现花括号或 `function `）；注释应先经 `stripComments`
 * 处理再传入。找不到函数时**抛错**（响亮），而不是返回空串让上层断言变成假绿。
 *
 * **G2 Task 4F 起共用**：`tests/ui/net-preview-wiring.test.ts`（第 3 条的回退分支判据、
 * `resetToMainInterface` / `showModeSelect` / `rerender` 的函数体断言）与
 * `tests/ui/render-net.test.ts`（`verifyPageHooks` 的"只查这个函数"）都用这一份。
 * ⚠️ 它**不替换** `render-net.test.ts` 里那个 `between(code, from, to)`：后者的语义是
 * "从 `from` 切到 `to` **之前**"（返回的是**片段**、不含尾部 `}`），两者用途不同 ——
 * `functionBody` 用于"整个函数体"，`between` 用于"函数体里的某一段"。
 */
export function functionBody(src: string, name: string): string {
  const at = src.indexOf(`function ${name}(`);
  if (at < 0) throw new Error(`源码里找不到 function ${name}(（结构被改动？）`);
  // ⚠️ **不能取"函数名之后的第一个 `{`"**（G2 Task 4F 实测的缺陷）：参数表里可以有**对象类型**
  //    （`onChange: (next: { viewSeat?: 0 | 1 }) => void`）—— 那个 `}` 会被当成函数体结束，
  //    于是 `renderPreviewToolbar` 的"函数体"只有 91 字符，紧接着的断言在**空片段**上恒真/恒假。
  //    正确做法：**先跳过成对括号的参数表**（`(`…`)`，内部跳过字符串/模板串），
  //    再从返回类型标注之后的第一个顶层 `{` 起算函数体。
  let i = src.indexOf('(', at);
  if (i < 0) throw new Error(`找不到 function ${name} 的参数表起始 (`);
  let paren = 0;
  for (; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === "'" || ch === '"' || ch === '`' || ch === '/') break; // 字符串由下面统一跳过
    if (ch === '(') paren += 1;
    else if (ch === ')') { paren -= 1; if (paren === 0) { i += 1; break; } }
  }
  let open = -1;
  for (; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === "'" || ch === '"' || ch === '`') {
      const quote = ch;
      i += 1;
      while (i < src.length) {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === quote) break;
        i += 1;
      }
      continue;
    }
    if (ch === '{') { open = i; break; }   // 返回类型标注里不含 `{`（本仓写法如此）
  }
  if (open < 0) throw new Error(`找不到 function ${name} 的函数体起始 {`);
  let depth = 0;
  for (; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === "'" || ch === '"' || ch === '`') {
      const quote = ch;
      i += 1;
      while (i < src.length) {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === quote) break;
        i += 1;
      }
      continue;
    }
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return src.slice(at, i + 1);
    }
  }
  throw new Error(`function ${name} 的花括号不配平`);
}

/**
 * 取 `const NAME: T = { … }` 这类**对象字面量声明**的整段（花括号配平、字符串/模板串感知）。
 *
 * **为什么它必须和 `functionBody` 住同一份**（G4 Task 4 提升）：`cb`（`UiCallbacks` 的唯一实现）
 * 不是函数声明 ⇒ `functionBody` 抽不到它，而"`cb` 的某个成员必须到达 X"这类判据同时被
 * `net-preview-wiring`（L3 的 `cb.rerender`）、`rearrange-draft`（L6 的 `cb.onRendered`）、
 * `local-data-screen`（L4/L5）四处需要。四份拷贝一旦漂移，其中一边就会因为"抽错了整段"
 * 而**假绿**（与本文件头注里 `stripComments` 的理由同款）。
 *
 * 纪律与 `functionBody` 逐字相同：**找不到声明头就抛错**（响亮），而不是返回空串让上层断言
 * 变成假绿；字符串与模板串整段跳过（对象字面量里就有 `'…{…}…'` 这种文本）。
 *
 * ⚠️ 它与 `stripArrayDecl` 的差别：后者**剔除**数组字面量（返回原串、找不到就返回原文），
 * 本函数**取出**对象字面量（返回片段、找不到抛错）。用途不同，别互相替换。
 */
export function objectBody(src: string, head: string): string {
  const at = src.indexOf(head);
  if (at < 0) throw new Error(`源码里找不到声明头 ${head}（结构被改动？）`);
  const open = src.indexOf('{', at);
  if (open < 0) throw new Error(`声明头 ${head} 之后没有 {`);
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === "'" || ch === '"' || ch === '`') {
      const q = ch;
      i += 1;
      while (i < src.length) {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === q) break;
        i += 1;
      }
      continue;
    }
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return src.slice(at, i + 1);
    }
  }
  throw new Error(`声明头 ${head} 的花括号不配平`);
}

/**
 * 整段剔除一个 `[export] const NAME [: 类型] = [ … ];` 形式的**数组字面量声明体**
 * （含 `NAME` 之前的声明头与结尾的 `];`），替换为等长空白（保留换行 → 行号不变）。
 *
 * **为什么必须有它**（G2 Task 3F · C-3 的硬要求）：渲染器 `render-net.ts` 里有一张
 * `NET_PAGE_HOOKS` 数据表，把 19 条 A 类钩子的选择器字符串**逐字**写着。源码文本守卫的
 * 判据是"本文件里出现 token"→ 于是**表本身**就能满足"本文件提供全部 A 类钩子"这条断言：
 * 评审变异实测把 `renderStackSlot(`/`renderProtocolCell(` 的真实挂载删掉（页面因此没有链路槽
 * 与协议格），契约测试 20 + render-net 守卫 11 **全绿（31/31）**。
 * 结论：任何 token 扫描都必须**先把表体剔除**，命中的才只可能来自真实代码。
 *
 * 括号配对是**字符串感知**的（表里就有 `'.stack-slot[data-player][data-line]'` 这种带方括号
 * 的字符串，朴素计数会把表尾找错）。找不到声明时**返回原文**（让上层断言以"缺 token"的形式
 * 报红，而不是在这里抛异常）。
 *
 * ## 已知局限（G2 Task 3F2 · F-4；**本轮有意不修**，只固化行为）
 *
 * 定位 `NAME` 取的是**第一个代码位命中**，而 `=` 是从那里一路向后搜的 —— 于是当**声明之前**
 * 有代码提前引用同名标识符时（函数声明会提升，TS 合法），会从那个引用处开始吃、到**下一个**
 * `= [...]` 结束：
 *
 * ```
 * function useHooks() { return NET_PAGE_HOOKS.length; }   // ← at 落在这里
 * const OTHER = [1, 2];                                   // ← 被当成"表体"整段吃掉（假红）
 * export const NET_PAGE_HOOKS: readonly X[] = [ … ];       // ← 真表体**没被剔掉**（假绿方向）
 * ```
 *
 * 评审喂了 9 例刁钻输入，8 过 1 错（错的就是上面这例）。影响面：**今天真实树零命中**
 * （`NET_PAGE_HOOKS` 的第一个代码位命中就是声明本身），且失败方向主要是**假红**（响亮、
 * 不会伪装成"已验收"）。当前行为已由一条**固化单测**钉住
 * （`tests/ui/fx-dom-contract.test.ts` 的 `stripArrayDecl` 组），免得它无声漂移。
 *
 * 改进方向（留给下一轮，**本轮不重构**）：把定位钉到声明头
 * `/(?:^|\n)\s*(?:export\s+)?const\s+NAME\b/`，并把 `=` 的搜索限制在**同一条语句内**
 * （遇 `;` 或换行即停）；找不到就返回原文。
 */
export function stripArrayDecl(src: string, name: string): string {
  const isCode = codePositions(src);
  // 在**代码位**上找标识符（避免命中注释/字符串里的同名子串）
  let at = -1;
  const re = new RegExp(`\\b${name}\\b`, 'g');
  for (let m = re.exec(src); m !== null; m = re.exec(src)) {
    if (isCode[m.index]) { at = m.index; break; }
  }
  if (at < 0) return src;
  // 先跳过类型标注：声明头里的 `[`（如 `readonly NetPageHook[]`）不是初始值。
  // 找 `NAME` 之后的第一个**代码位 `=`**，再找它之后的第一个 `[`。
  let eq = -1;
  for (let i = at; i < src.length; i += 1) {
    if (isCode[i] && src[i] === '=') { eq = i; break; }
  }
  if (eq < 0) return src;
  const open = src.indexOf('[', eq);
  if (open < 0) return src;
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    if (!isCode[i]) continue;
    if (src[i] === '[') depth += 1;
    else if (src[i] === ']') {
      depth -= 1;
      if (depth === 0) {
        // 连同其后紧跟的 `;`（若有）一起剔除
        const end = src[i + 1] === ';' ? i + 2 : i + 1;
        const out = src.slice(0, at) + src.slice(at, end).replace(/[^\n]/g, ' ') + src.slice(end);
        return out;
      }
    }
  }
  return src;
}
