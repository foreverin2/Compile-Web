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

/** 代码位（不在注释、也不在字符串/模板串里的字符）在 `src` 中的下标。 */
function codePositions(src: string): boolean[] {
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
