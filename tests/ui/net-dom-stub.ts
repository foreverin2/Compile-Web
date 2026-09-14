/**
 * **远程页的最小 DOM 桩**（无 jsdom）—— `net-lane-tree.test.ts` 与 `render-net.test.ts` 共用。
 *
 * 为什么抽成独立文件（而不是在第二个文件里复制一份）：本仓没有 jsdom，`renderNetBoard` 只能靠
 * 一份手写的桩真跑。桩一旦被复制成两份，**两份就会漂移** —— 而漂移的表现恰好是"一个文件里的
 * 行为断言绿、另一个红"（或更糟：两边都用同一份**错的**桩，于是谁都不红）。项目历史上已经因为
 * "手写清单/手写副本"栽过（见 `render-net.ts` 头注的 I-1）。
 *
 * ⚠️ 这个桩**只**记录结构，不模拟任何布局：
 *  - `getBoundingClientRect()` 恒返回全 0（所以**任何文件都不得**在此之上做几何断言）；
 *  - `querySelector` / `querySelectorAll` **恒空**（桩不实现选择器引擎）—— 因此被校验的产出代码
 *    不得依赖它们（`renderNetBoard` 只用 `lastElementChild` 与直接子节点，见该文件的说明）；
 *  - `appendChild` **不维护 `parentElement`**（同上：产出代码不得回读它）。
 *  能证明的：元素树的顺序与归属、`class`/`dataset`/`text`、以及**由样式表 `order`/`grid-column`
 *  解算出的视觉顺序**（解算器在两个消费方各自实现，本文件只提供树）。
 */

/** 桩节点（结构 + 类名 + dataset；不含布局）。 */
export interface StubNode {
  tag: string;
  cls: string;
  children: StubNode[];
  text: string;
  dataset: Record<string, string>;
  classList: { add(...c: string[]): void; remove(...c: string[]): void; contains(c: string): boolean };
  style: Record<string, unknown>;
  [k: string]: unknown;
}

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
      contains: (c: string) => set.has(c),
    },
    dataset: {},
    style: { setProperty: () => { /* 桩只记结构 */ } },
  };
  const extra: Record<string, unknown> = {
    appendChild: (c: StubNode) => { node.children.push(c); return c; },
    insertBefore: (c: StubNode) => { node.children.unshift(c); return c; },
    removeChild: () => { /* noop */ },
    remove: () => { /* noop */ },
    setAttribute: () => { /* noop */ },
    getAttribute: () => null,
    addEventListener: () => { /* noop */ },
    removeEventListener: () => { /* noop */ },
    querySelector: () => null,
    querySelectorAll: () => [],
    closest: () => null,
    getBoundingClientRect: () => ({ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0 }),
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
    set: (v: string) => { node.text = String(v); node.children.length = 0; },
  });
  // `lastElementChild`：`renderNetBoard` 用它取底部行里的手牌区（比 `querySelector` 可靠 ——
  // 桩的 `querySelector` 恒空，若产出代码走查询，这里会**静默**拿到 null）。
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
    querySelector: () => null,
    querySelectorAll: () => [],
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
