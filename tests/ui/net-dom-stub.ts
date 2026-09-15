/**
 * **远程页的最小 DOM 桩**（无 jsdom）—— `net-lane-tree.test.ts` 与 `render-net.test.ts` 共用。
 *
 * 为什么抽成独立文件（而不是在第二个文件里复制一份）：本仓没有 jsdom，`renderNetBoard` 只能靠
 * 一份手写的桩真跑。桩一旦被复制成两份，**两份就会漂移** —— 而漂移的表现恰好是"一个文件里的
 * 行为断言绿、另一个红"（或更糟：两边都用同一份**错的**桩，于是谁都不红）。项目历史上已经因为
 * "手写清单/手写副本"栽过（见 `render-net.ts` 头注的 I-1）。
 *
 * ⚠️ 这个桩**只**记录结构，不模拟任何布局：
 *  - `getBoundingClientRect()` 默认恒返回全 0；**R8-2 修正起可由 `setStubRect()` 配一个常量矩形**
 *    （只为让"按实测矩形判横竖"这条分支能被真跑到，见 `setStubRect` 的说明）；
 *  - `querySelector` / `querySelectorAll`：**R8-2 修正起实现了极简的后代选择器引擎**
 *    （只支持 `tag` / `.类` / `[attr="值"]` 的组合 + 后代组合器；见 `queryAllIn` 的边界说明）。
 *    改之前它们恒空 —— 于是 `syncScanOverlays` 在桩上**第一步就 continue**，那句
 *    `classList.toggle('scan-horiz', r.width > r.height)` 永远走不到（Guard 缺口 I-1）。
 *    ⚠️ 仍然**不**实现逗号组 / `>` / `+` / `~` / 伪类：遇到就返回空（宁可"找不到"，也不猜）。
 *  - `getAttribute`：**R8-4 修正起把 `data-*` 映射到 `dataset`**（真实 DOM 里两者是同一个属性），
 *    其余属性名仍返 `null`。改之前恒返 `null`，于是"读 `data-*` 属性"的产出代码在桩上永远读不到
 *    （`fxRotDegOf(holder)` 恒 0 ⇒ 协议 FX 的几何跟随**没有行为腿**）。见 `makeStubEl` 里的说明。
 *  - `appendChild` **维护 `parentElement`**（G2 修正 **R7** 加上的；此前**不维护**）。
 *    ⚠️ 这一条在 R7 之前写的是"产出代码不得回读它"—— 那个限制的**真实目的**是"别让产出代码依赖
 *    桩没有的能力"，而 R7 的证据 2（`.net-bottom` 的父节点必须是 `.net-board`）**必须**能读它，
 *    否则"是兄弟、不是子节点"这句话在行为层只能靠"网格子节点数"间接推断。
 *    维护它**不放松**任何现有守卫：全仓没有一个用例断言 `parentElement` 为空/undefined。
 *  能证明的：元素树的顺序与归属（含父子指针）、`class`/`dataset`/`text`、**由样式表
 *  `order`/`grid-column` 解算出的视觉顺序**（解算器在两个消费方各自实现，本文件只提供树）、
 *  以及"按一个**测试给定的**矩形常量走完的分支"（`setStubRect`）。
 *  **仍然不能**证明的：真实布局（尺寸是测试喂的常量，不是算出来的）、缩放、字体换行、
 *  以及任何"到底好不好看"的结论。
 */

/** 桩节点（结构 + 类名 + dataset；不含布局）。 */
export interface StubNode {
  tag: string;
  cls: string;
  children: StubNode[];
  text: string;
  dataset: Record<string, string>;
  classList: {
    add(...c: string[]): void;
    remove(...c: string[]): void;
    toggle(c: string, force?: boolean): boolean;
    contains(c: string): boolean;
  };
  /** 结构操作（**R8-2 修正补上显式类型**）：此前它们只存在于索引签名里（`unknown`），
   *  于是测试里 `stub.appendChild(child)` 会报 `TS18046: 'stub.appendChild' is of type 'unknown'`。
   *  声明出来**不改变任何运行时行为**（实现仍在 `makeStubEl` 的 `extra` 里）。 */
  appendChild(c: StubNode): StubNode;
  insertBefore(c: StubNode): StubNode;
  /** 父子指针（由 `appendChild`/`insertBefore`/`textContent=''` 维护；R7 起）。 */
  parentElement: StubNode | null;
  style: Record<string, unknown>;
  [k: string]: unknown;
}

/** `getBoundingClientRect()` 的返回形状（与浏览器同字段）。 */
export interface StubRect {
  left: number; top: number; right: number; bottom: number;
  width: number; height: number; x: number; y: number;
}

/** 桩的 `getBoundingClientRect()` 数据源（`null` = 恒 0，即 R7 之前的行为）。 */
let stubRect: StubRect | null = null;

/**
 * **R8-2 修正新增**：给桩配一个**常量**矩形（四边由 `left/top/width/height` 推出）。
 *
 * 为什么必须加：`render.ts` 的 `syncScanOverlays` 按 `.battery-shell` 的**实测矩形**决定
 * 横竖（`r.width > r.height` ⇒ 给层盒加 `.scan-horiz`）—— 那是"横置电池的扫描方向"唯一的
 * 出处，而"恒 0"的桩让 `0 > 0` 恒假 ⇒ 这条承重分支在本仓**没有任何机检**（I-1 的 5 条变异全绿）。
 * 配上矩形之后就能在桩上**真跑** `syncScanOverlays`，断言"宽 > 高 ⇒ 有类 / 高 > 宽 ⇒ 无类 /
 * 换一个矩形 ⇒ 类被双向同步"。
 *
 * ⚠️ 这不是布局引擎：矩形是**测试喂的常量**，桩不校验它与树的任何关系（"真实观感"仍是人眼项）。
 * ⚠️ `installStubDom()` 的 `restore()` 会把它复位成 `null`（不会漏到别的用例）。
 */
export function setStubRect(r: { left?: number; top?: number; width?: number; height?: number } | null): void {
  if (r === null) { stubRect = null; return; }
  const left = r.left ?? 0;
  const top = r.top ?? 0;
  const width = r.width ?? 0;
  const height = r.height ?? 0;
  stubRect = { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top };
}

const ZERO_RECT: StubRect = { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0 };

/** 造一个桩节点（`appendChild` / `textContent` / `className` 的手写最小语义）。 */
export function makeStubEl(tag: string): StubNode {
  const set = new Set<string>();
  const node: StubNode = {
    tag,
    cls: '',
    children: [],
    text: '',
    classList: {
      add: (...c: string[]) => { c.forEach((x) => x && set.add(x)); node.cls = [...set].join(' '); },
      remove: (...c: string[]) => { c.forEach((x) => set.delete(x)); node.cls = [...set].join(' '); },
      // R8-2 修正新增：`syncScanOverlays` 用 `classList.toggle('scan-horiz', 判据)` 双向同步
      // （横置电池 / 换页面时既要能加、也要能删）—— 桩缺这个方法会让那条分支抛 TypeError，
      // 于是"行为腿"根本走不到（这也是 I-1 只能靠文本腿的原因之一）。
      toggle: (c: string, force?: boolean) => {
        const on = force === undefined ? !set.has(c) : force;
        if (on) set.add(c); else set.delete(c);
        node.cls = [...set].join(' ');
        return on;
      },
      contains: (c: string) => set.has(c),
    },
    dataset: {},
    style: { setProperty: () => { /* 桩只记结构 */ } },
    // R7：`appendChild` / `insertBefore` 维护**父子指针**（见文件头注）——
    // R7 的证据 2（`.net-bottom` 的父节点必须是 `.net-board`）靠它。
    // ⚠️ **R8-2 修正把它们从 `extra`（索引签名 ⇒ `unknown`）搬进字面量**：接口里已有显式签名，
    //    留在 `extra` 里会让测试侧的 `stub.appendChild(child)` 报 `TS18046`。运行时语义**一字未改**。
    appendChild: (c: StubNode) => { c.parentElement = node; node.children.push(c); return c; },
    insertBefore: (c: StubNode) => { c.parentElement = node; node.children.unshift(c); return c; },
    /** R7：父子指针（由 `appendChild`/`insertBefore`/`textContent=''` 维护） */
    parentElement: null,
  };
  const extra: Record<string, unknown> = {
    removeChild: () => { /* noop */ },
    remove: () => { /* noop */ },
    setAttribute: () => { /* noop */ },
    // **G2 修正 R8-4**：`data-*` 属性在真实 DOM 里**就是** `dataset`（`el.dataset.fxRot = 'ccw'`
    // 写的就是 `data-fx-rot`）—— 桩此前 `getAttribute` **恒返 null**，于是任何"读 data-* 属性"的
    // 产出代码在桩上都**永远读不到**（`fxRotDegOf(holder)` 恒得 0 ⇒ 协议 FX 的行为腿不可能存在，
    // 与 R8-2 修 `querySelectorAll` 之前的 I-1 是同一个形态）。
    // ⚠️ 只把 `data-*` 映射到 `dataset`；其余属性（`src` / `width` / `viewBox`…）仍返 null ——
    //    桩**不实现属性表**（`setAttribute` 依旧是 noop），所以这条**不放宽**任何把非 dataset 属性
    //    当输入的分支（`fx-gen3-swap.ts:120` 的 `getAttribute('src')` 行为一字未变）。
    getAttribute: (n?: string) => {
      const name = String(n ?? '');
      if (!name.startsWith('data-')) return null;
      const key = name.slice(5).replace(/-([a-z])/g, (_a, c: string) => c.toUpperCase());
      const v = node.dataset[key];
      return v === undefined ? null : v;
    },
    addEventListener: () => { /* noop */ },
    removeEventListener: () => { /* noop */ },
    querySelector: (sel?: string) => queryAllIn(node, String(sel ?? ''))[0] ?? null,
    querySelectorAll: (sel?: string) => queryAllIn(node, String(sel ?? '')),
    closest: () => null,
    getBoundingClientRect: () => (stubRect ?? ZERO_RECT),
    getContext: () => null,
    focus: () => { /* noop */ },
    click: () => { /* noop */ },
    contains: () => false,
    innerHTML: '',
    title: '',
    alt: '',
    src: '',
    width: 0,
    height: 0,
    offsetHeight: 0,
    offsetWidth: 0,
    firstChild: null,
    parentNode: null,
  };
  Object.assign(node, extra);
  Object.defineProperty(node, 'className', {
    get: () => node.cls,
    set: (v: string) => {
      node.cls = String(v);
      set.clear();
      String(v).split(/\s+/).filter(Boolean).forEach((x) => set.add(x));
    },
  });
  Object.defineProperty(node, 'textContent', {
    get: () => node.text,
    set: (v: string) => {
      node.text = String(v);
      // R7：清空时**同时**解除被移除子节点的父子指针（否则它们会指向一个已经不要它们的父节点）
      for (const c of node.children) c.parentElement = null;
      node.children.length = 0;
    },
  });
  // `lastElementChild`：`renderNetBoard` 用它取底部行里的手牌区（比 `querySelector` 可靠 ——
  // R8-2 修正之前桩的 `querySelector` 恒空，产出代码若走查询会**静默**拿到 null）。
  Object.defineProperty(node, 'lastElementChild', {
    get: () => (node.children.length > 0 ? node.children[node.children.length - 1] : null),
  });
  return node;
}

/** 装一个最小 `document`/`window`（只够 `renderNetBoard` 走完一帧；**不**模拟任何布局）。
 *
 *  返回 `restore()`。⚠️ 渲染器会在**双 rAF** 之后做收尾（移除 no-anim），那些回调排在
 *  `restore()` 之后 —— 若把 `requestAnimationFrame` 还原成 `undefined`，它们会抛 `TypeError`
 *  并被 vitest 记为**未处理异常**（整份套件变红）。所以还原时留一个**无害的空实现**，
 *  并让用例在 restore 之前先 `await drainRaf()` 把队列跑完。 */
export function installStubDom(): () => void {
  const g = globalThis as { document?: unknown; window?: unknown; requestAnimationFrame?: unknown };
  const prevDoc = g.document;
  const prevWin = g.window;
  const prevRaf = g.requestAnimationFrame;
  const doc = {
    createElement: (t: string) => makeStubEl(t),
    createElementNS: (_ns: string, t: string) => makeStubEl(t),
    createTextNode: (t: string) => ({ text: t }),
    body: makeStubEl('body'),
    documentElement: makeStubEl('html'),
    getElementById: () => null,
    // R8-2 修正：从"恒空"改成**极简真查找**（见 `queryAllIn` 的边界说明）。
    // 其余用例的 `document.body` 都是空的 ⇒ 行为与"恒空"完全一致（不会给旧断言引入新结果）。
    querySelector: (sel?: string) => queryAllIn(doc.body, String(sel ?? ''))[0] ?? null,
    querySelectorAll: (sel?: string) => queryAllIn(doc.body, String(sel ?? '')),
    addEventListener: () => { /* noop */ },
    removeEventListener: () => { /* noop */ },
  };
  g.document = doc;
  g.window = {
    setTimeout: (fn: () => void, ms?: number) => setTimeout(fn, ms) as unknown as number,
    clearTimeout: (id: number) => clearTimeout(id),
    innerWidth: 1920,
    innerHeight: 1080,
    addEventListener: () => { /* noop */ },
    removeEventListener: () => { /* noop */ },
    requestAnimationFrame: (fn: () => void) => setTimeout(fn, 0) as unknown as number,
    cancelAnimationFrame: () => { /* noop */ },
    location: { href: 'http://localhost/' },
    document: doc,
    matchMedia: () => ({ matches: false, addEventListener: () => { /* noop */ } }),
  };
  g.requestAnimationFrame = (fn: () => void) => setTimeout(fn, 0) as unknown as number;
  return () => {
    g.document = prevDoc;
    g.window = prevWin;
    g.requestAnimationFrame = prevRaf ?? (() => 0);
    setStubRect(null);   // 矩形常量是**本用例**的输入，不许漏到别的用例
  };
}

/** 跑完渲染器排下的双 rAF 收尾（否则会以"未处理异常"的形式在 restore 之后爆出来）。 */
export const drainRaf = (): Promise<void> => new Promise((r) => { setTimeout(r, 10); });

/** 节点类名（数组形式）。 */
export const classListOf = (n: StubNode): string[] => n.cls.split(/\s+/).filter(Boolean);

/** 节点是否带某个类。 */
export const isClass = (n: StubNode, c: string): boolean => classListOf(n).includes(c);

/** 元素树里的**全部后代**（前序 = DOM 顺序），含自身。 */
export function descendants(n: StubNode): StubNode[] {
  const out: StubNode[] = [n];
  for (const c of n.children) out.push(...descendants(c));
  return out;
}

/**
 * **极简选择器引擎（R8-2 修正新增）**：一个**复合选择器**（不含空格）是否命中该节点。
 * 支持 `tag` / `.类` / `[attr]` / `[attr="值"]`（`data-*` 映射到 `dataset` 的驼峰键）的任意组合。
 * 不支持的写法一律**返回 false**（宁可"找不到"，也不猜 —— 猜错的假绿正是本项目反复栽的那类）。
 */
function matchesCompound(part: string, n: StubNode): boolean {
  const m = /^([a-zA-Z][\w-]*)?((?:\.[\w-]+|\[[^\]]*\])*)$/.exec(part);
  if (m === null) return false;
  if (m[1] && m[1].toLowerCase() !== n.tag.toLowerCase()) return false;
  for (const cls of m[2].matchAll(/\.([\w-]+)/g)) if (!classListOf(n).includes(cls[1])) return false;
  for (const attr of m[2].matchAll(/\[([^\]]*)\]/g)) {
    const a = /^([\w-]+)(?:=["']?([^"'\]]*)["']?)?$/.exec(attr[1]);
    if (a === null) return false;
    const key = a[1].startsWith('data-')
      ? a[1].slice(5).replace(/-([a-z])/g, (_x, c: string) => c.toUpperCase())
      : a[1];
    const val = n.dataset[key];
    if (val === undefined) return false;
    if (a[2] !== undefined && val !== a[2]) return false;
  }
  return true;
}

/**
 * `root` 子树里命中 `selector` 的全部节点（**后代组合器**语义，前序 = DOM 顺序）。
 *
 * **为什么必须有它**（R8-2 修正的 I-1）：`syncScanOverlays` 用
 * `document.querySelector('.battery[data-player="X"][data-line="Y"] .battery-shell')` 定位外壳，
 * 而桩的 `querySelector` 恒返 null ⇒ 它在桩上**第一步就 `continue`**，
 * `classList.toggle('scan-horiz', r.width > r.height)` 永远走不到 ⇒ 那条判据零机检。
 *
 * **诚实边界**：不支持逗号选择器组、子组合器 `>`、兄弟组合器 `+`/`~`、伪类、`*`；
 * 命中这些字符就**返回空数组**（调用方走"找不到"的降级分支 —— 响亮地退化，不假装命中）。
 * 它只是"树上的确定性查找"，**不是**布局引擎，也不给任何观感结论。
 */
export function queryAllIn(root: StubNode, selector: string): StubNode[] {
  const sel = selector.trim();
  if (sel === '' || /[>,+~]/.test(sel) || sel.includes(':')) return [];
  const parts = sel.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return [];
  let cur: StubNode[] = [root];
  for (const part of parts) {
    const next: StubNode[] = [];
    for (const node of cur) {
      for (const d of descendants(node)) {
        if (d !== node && matchesCompound(part, d) && !next.includes(d)) next.push(d);
      }
    }
    if (next.length === 0) return [];
    cur = next;
  }
  return cur;
}

/** 找**全部**带某类名、且额外满足 `where` 的后代（`where` 省略 = 不筛）。 */
export function classOf(
  root: StubNode, cls: string, where?: (n: StubNode) => boolean,
): StubNode[] {
  return descendants(root).filter((n) => isClass(n, cls) && (where === undefined || where(n)));
}

/** 打印用：元素树（深度受控）。 */
export function walk(n: StubNode, depth: number, out: string[], maxDepth: number): void {
  if (depth > maxDepth) return;
  const label = `${'  '.repeat(depth)}<${n.tag}${n.cls ? ' class="' + n.cls + '"' : ''}`
    + `${Object.keys(n.dataset).length ? ' data=' + JSON.stringify(n.dataset) : ''}>`
    + `${n.text ? ' "' + n.text + '"' : ''}`;
  out.push(label);
  for (const c of n.children) walk(c, depth + 1, out, maxDepth);
}
