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
  /**
   * **R19 修正补上显式类型**：与 `appendChild` **同一族问题** —— `dispatchEvent` 此前只存在于
   * 索引签名里（`unknown`），于是测试侧调用它要写 `as unknown as (…)`。声明出来**运行时零变化**。
   * 语义见 `makeStubEl` 里的实现（冒泡路径 + `target` 字段）。
   */
  dispatchEvent(ev: { type: string; target?: unknown }): boolean;
  /**
   * **R15 修正补上显式类型**：与上面 `appendChild`/`insertBefore` **同一族问题** ——
   * 它此前只存在于索引签名里，于是任何"读桩矩形"的测试代码拿到的是 `unknown`
   * （`TS2571: Object is of type 'unknown'` / `TS18046: … is of type 'unknown'`），
   * 只能靠 `as StubRect` 之类的强转消音。声明出来**运行时零变化**
   * （实现仍是 `makeStubEl` 里那个"按节点覆盖 → 全局 → 全 0"的 `rectOf`）。
   */
  getBoundingClientRect(): StubRect;
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

/**
 * **R15 修正新增**：**按节点**配矩形（`node` 自己的矩形，优先于全局 `setStubRect`）。
 *
 * 为什么必须加（且为什么不能用 `setStubRect` 凑）：R15 的三处缺陷里有一条判据是
 * **"量的是哪一个节点"** —— 远程页的 `.protocol-holder`（未旋转的布局盒 `76.9×107.7`）与
 * `img.protocol-img`（**旋转后**的视觉足迹 `107.7×76.9`）在真浏览器里**尺寸不同**，
 * 而全局矩形让**所有**节点返回同一个 rect ⇒ "取 holder 的 rect"与"取 img 的 rect"在桩上
 * **不可区分**（缺陷与修复都会绿）。按节点配矩形之后就能钉住"取到的是哪个盒子"。
 *
 * ⚠️ 语义与 `setStubRect` 完全同款：`{left, top, width, height}` 由四边推出，缺省补 0；
 * 传 `null` 摘掉该节点的覆盖（回到全局）。⚠️ **`installStubDom()` 的 `restore()` 会清空整张表**，
 * 不会漏到别的用例。⚠️ 这是**测试喂的常量**，桩不校验它与树的任何关系（仍不是布局引擎）。
 *
 * ⚠️ **形参类型是 `object | null`（不是 `{ getBoundingClientRect?: unknown }`）**：
 * 后者是一个**全可选属性的 weak type**，TS 要求实参至少有一个**同名共有**属性，
 * 而 `StubNode`（下方 `interface StubNode`）**没有**声明 `getBoundingClientRect`
 * （它只存在于索引签名 `[k: string]: unknown` 里，索引签名不算"共有属性"）
 * ⇒ 每个调用点都会 `TS2559: has no properties in common`，于是测试里被迫写
 * `as unknown as object` 这种**为了绕过形参类型**的强转 —— 那本身就是形参类型错的信号。
 * `StubNode` / `HTMLElement` / 任何桩节点都是 `object` ⇒ 放宽到 `object` 后**所有调用点零强转**，
 * 而 `WeakMap<object, StubRect>` 的键类型不变 ⇒ 运行时**零变化**。
 * （`StubNode` 的 `getBoundingClientRect` 也已在该接口上声明，见那里的说明。）
 */
const nodeRects = new WeakMap<object, StubRect>();

export function setStubRectFor(node: object | null, r: {
  left?: number; top?: number; width?: number; height?: number;
} | null): void {
  if (node === null || r === null) {
    if (node !== null) nodeRects.delete(node);
    return;
  }
  const left = r.left ?? 0;
  const top = r.top ?? 0;
  const width = r.width ?? 0;
  const height = r.height ?? 0;
  nodeRects.set(node, { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top });
}

/** 该节点的矩形（按节点覆盖 → 全局 → 全 0）。 */
const rectOf = (node: object): StubRect => nodeRects.get(node) ?? stubRect ?? ZERO_RECT;

/**
 * **R19 新增：事件监听表**（`node → 事件类型 → 监听器数组`）。
 *
 * Why：`render-net.ts` 的卡牌放大框把交互做成**事件委托**（挂在板根上），而"真跑行为腿"
 * 需要能把事件派发到某张卡上、让它冒泡到板根。用 `WeakMap` 保证节点被回收时监听表跟着走
 * （不跨用例泄漏 —— 与 `nodeRects` 同一套理由与写法）。
 *
 * ⚠️ 类型放宽成 `(ev: unknown) => void`：本仓的产出代码里监听器形参各式各样
 * （`Event` / `KeyboardEvent` / 自定义），桩不需要它们的成员（只用 `type` / `target`）。
 */
const listeners = new WeakMap<object, Map<string, Array<(ev: unknown) => void>>>();

/** 造一个桩节点（`appendChild` / `textContent` / `className` 的手写最小语义）。 */
export function makeStubEl(tag: string): StubNode {
  const set = new Set<string>();
  /** **R19**：`setAttribute` 记下的非 `data-` 属性（`getAttribute` 的读侧，见那里的说明）。 */
  const attrs = new Map<string, string>();
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
    /** R15：矩形（按节点覆盖 → 全局常量 → 全 0）。**放在字面量里**是为了让它成为
     *  `StubNode` 接口的**显式成员**（此前它在 `extra` 里 ⇒ 测试侧读到的是 `unknown`）。
     *  闭包引用 `node` 是安全的：它只在这个箭头被**调用**时才求值。 */
    getBoundingClientRect: () => rectOf(node),
    /**
     * **R19 新增：极简事件派发**（`addEventListener` 的配对物）。
     *
     * 为什么必须加：`render-net.ts` 的卡牌放大框（R19）把交互做成**事件委托**挂在板根上
     * （每帧重建 DOM ⇒ 不能把监听挂在卡上）。没有派发能力时，"悬浮即时显示 / 单击固定"
     * 这两条裁决就**只**能做源码腿或半纯腿，而用户这一轮明确要求"放大框行为腿**真跑**"。
     *
     * ## 语义（够用就好，诚实声明边界）
     *  - 冒泡路径 = 从**派发节点**沿 `parentElement` 到根（`node` 自己**不算**在路径里：
     *    它没有挂在任何地方，也不需要收到自己的事件）；
     *  - 每个节点上按**注册顺序**调用监听器，`ev.target` 恒为**派发节点**
     *    （与真实 DOM 的 `event.target` 同义 —— 委托方靠它 resolve 出"命中了哪张卡"）；
     *  - 不实现 `stopPropagation` / `preventDefault` / 捕获阶段 / 事件对象的方法
     *    （本仓的产出代码不用它们 —— 用了会在桩上抛 TypeError，属**响亮**退化）。
     *
     * ⚠️ **它对既有用例零影响**：改之前 `addEventListener` 是 noop、没有任何用例派发过事件 ⇒
     *    新实现只在"测试主动调 `dispatchEvent`"时才有行为。`installStubDom()` 每帧新建节点，
     *    监听表随节点回收（不跨用例）。
     */
    dispatchEvent: (ev: { type: string; target?: unknown }) => {
      const path: StubNode[] = [];
      for (let p = node.parentElement; p !== null; p = p.parentElement) path.push(p);
      for (const n of path) {
        for (const fn of [...(listeners.get(n)?.get(ev.type) ?? [])]) {
          fn({ type: ev.type, target: ev.target ?? node });
        }
      }
      return true;
    },
  };
  const extra: Record<string, unknown> = {
    removeChild: () => { /* noop */ },
    remove: () => { /* noop */ },
    /**
     * **R19 修正：`setAttribute` 真的记属性了**（改之前是 noop）。
     *
     * 为什么要改：`render-net.ts` 的卡牌放大框从 **`img.getAttribute('src')`** 反推 defId
     * （与 `render.ts` 的 `fxRotDegOf` 读 `data-fx-rot` 同一族读法）。桩此前 `setAttribute` 是
     * noop、而 `getAttribute` 只把 `data-*` 映射到 `dataset` ⇒ **非 `data-` 属性写进去读不回来**
     * ⇒ 那条分支在桩上**第一步就空转**，测试只能靠手写 `dataset.src` 绕过去（那会让"桩的读法"
     * 与"产出代码的读法"分叉，正是本文件头注警告的"两份真相"）。
     *
     * ⚠️ 只补"写进去能读回来"，**不放宽**任何既有语义：`data-*` 仍然走 `dataset`
     * （真实 DOM 里两者是同一个属性），其余属性名进这个属性表。
     */
    setAttribute: (n?: string, v?: unknown) => { attrs.set(String(n ?? ''), String(v ?? '')); },
    removeAttribute: (n?: string) => { attrs.delete(String(n ?? '')); },
    // **G2 修正 R8-4**：`data-*` 属性在真实 DOM 里**就是** `dataset`（`el.dataset.fxRot = 'ccw'`
    // 写的就是 `data-fx-rot`）—— 桩此前 `getAttribute` **恒返 null**，于是任何"读 data-* 属性"的
    // 产出代码在桩上都**永远读不到**（`fxRotDegOf(holder)` 恒得 0 ⇒ 协议 FX 的行为腿不可能存在，
    // 与 R8-2 修 `querySelectorAll` 之前的 I-1 是同一个形态）。
    // ⚠️ 只把 `data-*` 映射到 `dataset`；其余属性（`src` / `width` / `viewBox`…）仍返 null ——
    //    桩**不实现属性表**（`setAttribute` 依旧是 noop），所以这条**不放宽**任何把非 dataset 属性
    //    当输入的分支（`fx-gen3-swap.ts:120` 的 `getAttribute('src')` 行为一字未变）。
    getAttribute: (n?: string) => {
      const name = String(n ?? '');
      if (name.startsWith('data-')) {
        const key = name.slice(5).replace(/-([a-z])/g, (_a, c: string) => c.toUpperCase());
        const v = node.dataset[key];
        return v === undefined ? null : v;
      }
      // R19：非 `data-` 属性先看 `setAttribute` 记下的那张表（见那里的说明）。
      const v = attrs.get(name);
      if (v !== undefined) return v;
      // ⚠️ **R19 的第二个补丁：反射属性**。真实 DOM 里 `img.src = x` 与
      //    `img.setAttribute('src', x)` 是**同一个属性**（`src` / `id` / `title` / `alt` … 都是
      //    reflected IDL attributes）。产出代码 `render.ts` 写的正是 **属性赋值**
      //    （`img.src = cardImgSrc(…)`），而放大框读的是 `getAttribute('src')`
      //    （与 `fxRotDegOf` 读 `data-fx-rot` 同一族；作者把两者当等价）。桩此前只认
      //    `setAttribute` ⇒ `renderProtocol` 产出的协议图在桩上**读不回 src**，协议那一档
      //    因此永远解不出条目（实测）。这里把节点自己的可见属性值接上，与浏览器同义。
      const own = (node as unknown as Record<string, unknown>)[name];
      return typeof own === 'string' && own !== '' ? own : null;
    },
    addEventListener: (type?: string, fn?: (ev: unknown) => void) => {
      if (typeof type !== 'string' || typeof fn !== 'function') return;
      let byType = listeners.get(node);
      if (!byType) { byType = new Map(); listeners.set(node, byType); }
      const arr = byType.get(type) ?? [];
      arr.push(fn);
      byType.set(type, arr);
    },
    removeEventListener: () => { /* noop */ },
    querySelector: (sel?: string) => queryAllIn(node, String(sel ?? ''))[0] ?? null,
    querySelectorAll: (sel?: string) => queryAllIn(node, String(sel ?? '')) as StubNode[],
    /**
     * **R19 新增：`closest` 的极简实现**（改之前恒返 `null`）。
     *
     * 为什么要加：`render-net.ts` 的卡牌放大框靠 `target.closest('.card' / '.protocol' / …)`
     * 从**悬浮到的那个叶子节点**回溯到"命中哪一张卡"（事件委托的标准写法，`event.target`
     * 通常是卡里的 `<img>`）。桩此前恒返 `null` ⇒ **放大框对任何目标都解不出条目**
     * （实测：四档行为腿全部报 "没有解出条目"），于是"悬浮显示 / 单击固定"这两条裁决
     * 在桩上根本跑不起来。
     *
     * **语义**：从 `node` 自己开始沿 `parentElement` 往上，返回第一个**自己命中**
     * `selector` 的节点（与浏览器一致：`closest` 含自身）。只支持**单个复合选择器**
     * （类 / `tag` / `[attr="值"]`）—— 遇到 `>` / `,` / `+` / `~` / 伪类一律返回 `null`
     * （宁可"找不到"，也不猜：与 `queryAllIn` 同一套边界）。
     */
    closest: (sel?: string) => {
      const s = String(sel ?? '').trim();
      if (s === '' || /[>,+~]/.test(s) || s.includes(':')) return null;
      for (let p: StubNode | null = node; p !== null; p = p.parentElement) {
        if (matchesCompound(s, p)) return p;
      }
      return null;
    },
    // ⚠️ `getBoundingClientRect` 已上移到上面的字面量里（R15：让它成为接口的显式成员，
    //    否则测试侧读到 `unknown`）。这里**不再**重复定义 —— 重复会被 `Object.assign` 覆盖，
    //    两份实现一旦漂移就是本项目反复栽过的"两份真相"。
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
    // ⚠️ 按节点矩形**不需要**显式清：它是 `WeakMap`，键是**本用例新建的那些桩节点**，
    //    用例结束后键不可达 ⇒ 条目随之回收；`installStubDom()` 每次都用**新的** `body`，
    //    所以"新用例里同名节点的旧矩形"不可能被读到。
  };
}

/** 跑完渲染器排下的双 rAF 收尾（否则会以"未处理异常"的形式在 restore 之后爆出来）。 */
export const drainRaf = (): Promise<void> => new Promise((r) => { setTimeout(r, 10); });

/** 节点类名（数组形式）。 */
export const classListOf = (n: StubNode): string[] => n.cls.split(/\s+/).filter(Boolean);

/** 节点是否带某个类。 */
export const isClass = (n: StubNode, c: string): boolean => classListOf(n).includes(c);

/**
 * 元素树里的**全部后代**（前序 = DOM 顺序），含自身。
 *
 * ⚠️ **R19 修正：跳过文本节点**。`document.createTextNode(t)` 在桩里返回 `{ text: t }`
 * ——那**不是** `StubNode`（没有 `children`）。`buildCardTextEl`（卡牌中文效果面板，
 * 放大框复用它）正会把这种节点 `appendChild` 进元素里 ⇒ 任何"递归整棵树"的助手
 * （本函数 / `queryAllIn` / 测试里的 `textOf`）撞上它就会抛
 * `TypeError: n.children is not iterable`。真实 DOM 里 `children` **只含元素**（文本节点在
 * `childNodes` 里），所以这里跳过它们才是与浏览器同义的行为（不是放宽）。
 */
export function descendants(n: StubNode): StubNode[] {
  const out: StubNode[] = [n];
  for (const c of n.children ?? []) {
    if (Array.isArray((c as StubNode).children)) out.push(...descendants(c as StubNode));
  }
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
