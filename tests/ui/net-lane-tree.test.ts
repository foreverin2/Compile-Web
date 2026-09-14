import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createGame } from '../../src/core/state/create';
import { renderNetBoard } from '../../src/ui/render-net';
import { setFxViewSeat } from '../../src/ui/fx-seat';
import { stripComments } from './source-text';

/**
 * G2 修正 R-F · **C-2 的行为守卫**：用最小 DOM 桩**真跑一遍 `renderNetBoard`**，
 * 再按元素树 + 样式表里的 `order` 算出「一列自上而下的六层」。
 *
 * ## 为什么必须有这个文件（而不是再加几条源码断言）
 *
 * C-2 的两个成因**都不是源码能表达的**：
 *  1. `renderSide` 对两侧挂载顺序相同 ⇒ 自己协议落到整列最外端（**DOM 兄弟顺序**的后果）；
 *  2. 能量槽的落端由 **CSS `order`** 决定（`.stack-slot` 是 flex column），
 *     `.p1`/`.p2` 那两个选择器看着"按玩家分得好好的"，实际在默认席位下**两个能量槽都跑到内侧**。
 * 评审正是靠"真跑 + 看元素树"才发现它的；本文件把这件事变成**可重复的机检**。
 *
 * ## 这个桩**能**证明什么 / **不能**证明什么（诚实边界）
 *
 * 能（都是确定性的流式布局语义，不需要浏览器）：
 *  - **元素树的顺序与归属**：一列里 `net-side-foe / net-lane-mid / net-side-self` 的兄弟顺序、
 *    每一侧内部挂了哪些节点、每个节点的 `class` / `data-player` / `data-line`；
 *  - **`order` 求解出的视觉顺序**：按 `styles-net.css` 里真实的 `order:` 声明（含选择器权重与
 *    源序）对 flex column 的子项做**稳定排序**（CSS 规范：`order` 相同则按文档顺序）。
 *
 * **不能**：
 *  - 真实浏览器里的 `getBoundingClientRect()`（本桩一律返回全 0 —— 本文件**不**做任何几何断言）；
 *  - flex 的真实求解（高度/间隙/换行）、缩放、字体导致的换行 —— "到底好不好看"只能人眼；
 *  - `transform` 的效果（协议 ∓90° 是 CSS 的，不在本文件的判据里）。
 *  这三条都在报告的人眼清单里。
 */

/* ============================================================================
 * 样式表：`order:` 声明的解析 + 最小选择器匹配（只为"视觉顺序"服务）
 * ========================================================================== */

interface CssRule { selector: string; body: string; no: number }

/**
 * 去注释后的 `选择器 { 体 }` 列表（本页样式表没有嵌套规则/@media，简版解析够用）。
 *
 * ⚠️ `stripComments` **保留注释起止的两个字符**（`/*`…`*​/` 只把中间内容换成空白，见
 * `./source-text` 的说明）—— 于是紧跟在一条规则**行尾注释**之后的规则，选择器会带上
 * `/* *​/` 前缀。这里必须把它当空白清掉，否则 `.net-lane-band .stack-slot.p2 .battery`
 * 会匹配不上（本文件第一版就是这样漏掉一条规则的）。
 */
function cssRules(css: string): CssRule[] {
  const out: CssRule[] = [];
  const src = stripComments(css);
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let no = 0;
  for (let m = re.exec(src); m !== null; m = re.exec(src)) {
    const selector = m[1].replace(/\/\*|\*\//g, ' ').trim().replace(/\s+/g, ' ');
    out.push({ selector, body: m[2], no: no++ });
  }
  return out;
}

const classesOf = (n: StubNode): string[] => n.cls.split(/\s+/).filter(Boolean);

/** 一个**复合选择器**（不含空格）是否命中该节点：只支持类与属性选择器（本页 `order` 规则只用这两类）。 */
function compoundMatches(part: string, node: StubNode): boolean {
  const simple = part.replace(/::?[a-zA-Z-]+(\([^)]*\))?/g, '');   // 去掉伪类（本页 order 规则没有伪类，稳妥起见）
  const need = [...simple.matchAll(/\.([A-Za-z0-9_-]+)/g)].map((m) => m[1]);
  const have = classesOf(node);
  if (!need.every((c) => have.includes(c))) return false;
  for (const m of simple.matchAll(/\[([a-z-]+)(?:=["']?([^"'\]]*)["']?)?\]/g)) {
    const key = m[1].startsWith('data-')
      ? m[1].slice(5).replace(/-([a-z])/g, (_a, c: string) => c.toUpperCase())
      : m[1];
    if (node.dataset[key] === undefined) return false;
    if (m[2] !== undefined && node.dataset[key] !== m[2]) return false;
  }
  return true;
}

/** `chain` = 祖先链（含自身），后代组合器语义（`>` 一视同仁 —— 本页 order 规则的类集合下等价）。 */
function selectorMatches(selector: string, chain: StubNode[]): boolean {
  const parts = selector.split(/\s+/).filter((p) => p.length > 0 && p !== '>');
  let at = chain.length - 1;
  for (let i = parts.length - 1; i >= 0; i -= 1) {
    let found = -1;
    for (let k = at; k >= 0; k -= 1) {
      if (compoundMatches(parts[i], chain[k])) { found = k; break; }
    }
    if (found < 0) return false;
    at = found - 1;
  }
  return true;
}

/** 简易权重：类数 + 属性数（本页 order 规则的选择器只有这两类，够用且与 CSS 的排序一致）。 */
function specificityOf(selector: string): number {
  const parts = selector.split(/\s+/).filter((p) => p.length > 0 && p !== '>');
  let n = 0;
  for (const p of parts) {
    n += (p.match(/\.[A-Za-z0-9_-]+/g) ?? []).length;
    n += (p.match(/\[[a-z-]+/g) ?? []).length;
  }
  return n;
}

/** 该节点（在 `chain` 这一条祖先链下）生效的 `order` 值：权重优先、同权重取**源序靠后**者。 */
function cssOrderOf(node: StubNode, chain: StubNode[], rules: CssRule[]): number {
  let best: { spec: number; no: number; val: number } | null = null;
  for (const r of rules) {
    const m = /(?:^|;|\s)order\s*:\s*(-?\d+)/.exec(r.body);
    if (!m) continue;
    if (!selectorMatches(r.selector, chain)) continue;
    const spec = specificityOf(r.selector);
    if (!best || spec > best.spec || (spec === best.spec && r.no > best.no)) {
      best = { spec, no: r.no, val: Number(m[1]) };
    }
  }
  return best ? best.val : 0;
}

/** flex column 的**视觉顺序**：按 `order` 稳定排序（相同 order 保持文档顺序 —— CSS 规范语义）。
 *  ⚠️ `chain` 是**父节点的祖先链**；每个子项自己要追加进链尾再比对选择器
 *  （本文件第一版漏了这一步 ⇒ 所有 `order` 都匹配不上、求解退化成 DOM 顺序 ——
 *  那样"CSS 那一半"就完全没被判到）。 */
function visualChildren(node: StubNode, chain: StubNode[], rules: CssRule[]): StubNode[] {
  return node.children
    .map((c, i) => ({ c, i, o: cssOrderOf(c, [...chain, node, c], rules) }))
    .sort((a, b) => (a.o - b.o) || (a.i - b.i))
    .map((x) => x.c);
}

/* ============================================================================
 * 最小 DOM 桩（与评审探针同形：只记录结构，不模拟布局）
 * ========================================================================== */

interface StubNode {
  tag: string;
  cls: string;
  children: StubNode[];
  text: string;
  dataset: Record<string, string>;
  classList: { add(...c: string[]): void; remove(...c: string[]): void; contains(c: string): boolean };
  style: Record<string, unknown>;
  [k: string]: unknown;
}

function makeEl(tag: string): StubNode {
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
  return node;
}

/** 装一个最小 `document`/`window`（只够 `renderNetBoard` 走完一帧；**不**模拟任何布局）。 */
function installDom(): () => void {
  const g = globalThis as { document?: unknown; window?: unknown; requestAnimationFrame?: unknown };
  const prevDoc = g.document;
  const prevWin = g.window;
  const prevRaf = g.requestAnimationFrame;
  const doc = {
    createElement: (t: string) => makeEl(t),
    createElementNS: (_ns: string, t: string) => makeEl(t),
    createTextNode: (t: string) => ({ text: t }),
    body: makeEl('body'),
    documentElement: makeEl('html'),
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
  // ⚠️ 渲染器会在**双 rAF** 之后做收尾（移除 no-anim / 滑块过渡），那些回调排在 `restore()` 之后。
  //    若把 `requestAnimationFrame` 还原成 `undefined`，它们会抛 `TypeError` 并被 vitest 记为
  //    **未处理异常**（让整份套件变红）。所以还原时留一个**无害的空实现**，并让用例在 restore
  //    之前先 `await` 一小段把队列跑完（见 `drainRaf`）。
  return () => {
    g.document = prevDoc;
    g.window = prevWin;
    g.requestAnimationFrame = prevRaf ?? (() => 0);
  };
}

/** 跑完渲染器排下的双 rAF 收尾（否则会以"未处理异常"的形式在 restore 之后爆出来）。 */
const drainRaf = (): Promise<void> => new Promise((r) => { setTimeout(r, 10); });

/** 一帧合成局（与评审探针同）：只要"三列 + 两侧 + 能量槽"的结构都在，够本文件用。 */
function renderFrame(viewSeat: 0 | 1): StubNode {
  const s = createGame({ seed: 'rf-tree-seed', draftStarter: 0, firstToPlay: 1 });
  for (const p of [0, 1] as const) {
    s.players[p].protocols = [
      { defId: 'fire-0', compiled: false },
      { defId: 'ice-0', compiled: false },
      { defId: 'light-0', compiled: false },
    ] as never;
  }
  (s as { phase: string }).phase = 'turn';
  const root = makeEl('div');
  const noop = (): void => { /* noop */ };
  renderNetBoard(root as unknown as HTMLElement, s, {
    onAction: noop, onRendered: noop, rerender: noop, onDraftPick: noop, onDraftUnpick: noop,
    onDraftBan: noop, onWinReset: noop,
  } as never, { viewSeat, verifyHooks: false });
  return root;
}

/** 打印用：元素树（深度受控）。 */
function walk(n: StubNode, depth: number, out: string[], maxDepth: number): void {
  if (depth > maxDepth) return;
  const label = `${'  '.repeat(depth)}<${n.tag}${n.cls ? ' class="' + n.cls + '"' : ''}`
    + `${Object.keys(n.dataset).length ? ' data=' + JSON.stringify(n.dataset) : ''}>`
    + `${n.text ? ' "' + n.text + '"' : ''}`;
  out.push(label);
  for (const c of n.children) walk(c, depth + 1, out, maxDepth);
}

/* ============================================================================
 * 层序求解：一列 = 六层
 * ========================================================================== */

type Side = 'foe' | 'self';
type LayerKind = 'battery' | 'stack' | 'protocol';
interface Layer { side: Side; kind: LayerKind }

const label = (l: Layer): string => `${l.side === 'foe' ? '对手' : '自己'}${l.kind === 'battery' ? '能量槽' : l.kind === 'stack' ? '链路' : '协议'}`;

const isClass = (n: StubNode, c: string): boolean => classesOf(n).includes(c);

/** 一列（`.net-lane-band`）里**自上而下的六层**（DOM 顺序 + CSS `order`）。 */
function layersOfColumn(col: StubNode, rules: CssRule[]): Layer[] {
  const out: Layer[] = [];
  for (const sideNode of visualChildren(col, [], rules)) {
    const side: Side | null = isClass(sideNode, 'net-side-foe') ? 'foe'
      : isClass(sideNode, 'net-side-self') ? 'self' : null;
    if (!side) continue;   // 中线等
    for (const cell of visualChildren(sideNode, [col], rules)) {
      if (isClass(cell, 'protocol-cell')) { out.push({ side, kind: 'protocol' }); continue; }
      if (!isClass(cell, 'stack-slot')) continue;
      for (const inner of visualChildren(cell, [col, sideNode], rules)) {
        if (isClass(inner, 'battery')) out.push({ side, kind: 'battery' });
        else if (isClass(inner, 'stack')) out.push({ side, kind: 'stack' });
      }
    }
  }
  return out;
}

const SPEC_ORDER: readonly Layer[] = [
  { side: 'foe', kind: 'battery' },   // 1
  { side: 'foe', kind: 'stack' },     // 2
  { side: 'foe', kind: 'protocol' },  // 3
  { side: 'self', kind: 'protocol' }, // 4
  { side: 'self', kind: 'stack' },    // 5
  { side: 'self', kind: 'battery' },  // 6
];

/** 取第一列（三条线同构，第一列足够；三条列的一致性由 renderNetBoard 的循环与既有计数守卫保证）。 */
const firstColumn = (root: StubNode): StubNode => {
  const found: StubNode[] = [];
  const visit = (n: StubNode): void => {
    if (isClass(n, 'net-lane-band')) found.push(n);
    for (const c of n.children) visit(c);
  };
  visit(root);
  expect(found.length, '元素树里找不到 3 条 .net-lane-band（三列结构被改？）').toBe(3);
  return found[0];
};

/** 在列内按视觉顺序找某个「侧 + 层」的节点（能量槽/链路/协议都能取到）。 */
function findLayer(col: StubNode, rules: CssRule[], want: Layer): StubNode | null {
  for (const sideNode of visualChildren(col, [], rules)) {
    const side: Side | null = isClass(sideNode, 'net-side-foe') ? 'foe'
      : isClass(sideNode, 'net-side-self') ? 'self' : null;
    if (side !== want.side) continue;
    for (const cell of visualChildren(sideNode, [col], rules)) {
      if (want.kind === 'protocol' && isClass(cell, 'protocol-cell')) return cell;
      if (want.kind !== 'protocol' && isClass(cell, 'stack-slot')) {
        for (const inner of visualChildren(cell, [col, sideNode], rules)) {
          if (want.kind === 'battery' && isClass(inner, 'battery')) return inner;
          if (want.kind === 'stack' && isClass(inner, 'stack')) return inner;
        }
      }
    }
  }
  return null;
}

const cssPath = new URL('../../src/ui/styles-net.css', import.meta.url);
const netCss = readFileSync(fileURLToPath(cssPath)).subarray(0, 4 * 1024 * 1024).toString('utf8');
const RULES = cssRules(netCss);

afterEach(() => { setFxViewSeat(null); });

describe('R-F · C-2：真跑 renderNetBoard 的元素树层序（viewSeat 0/1）', () => {
  it('两个席位下，一列自上而下都必须是规格 §1 的六层（对手能量槽→…→自己能量槽）', async () => {
    const restore = installDom();
    try {
      for (const seat of [0, 1] as const) {
        const root = renderFrame(seat);
        const col = firstColumn(root);
        const tree: string[] = [];
        walk(col, 0, tree, 4);
        // 报告里要贴的元素树（真实产出，非手写）
        console.log(`\n===== viewSeat=${seat} · 第一列元素树（DOM 顺序）=====\n${tree.join('\n')}`);
        const layers = layersOfColumn(col, RULES);
        console.log(`----- viewSeat=${seat} · 自上而下（DOM 顺序 + CSS order）-----\n`
          + layers.map((l, i) => `  ${i + 1}. ${label(l)}`).join('\n'));

        // ① **完整六层**：与规格 §1 逐条相等（这是 C-2 的核心判据）
        expect(layers, `viewSeat=${seat} 的列内层序与规格 §1 不符`
          + `（实际：${layers.map(label).join(' → ')}）`).toEqual(SPEC_ORDER);

        // ② 三条腿各自点名（失败信息比"数组不等"可读；也防止将来有人把 SPEC_ORDER 一起改错）
        expect(layers[0], `viewSeat=${seat}：对手能量槽必须在一列的最上端（第 1 层）`)
          .toEqual({ side: 'foe', kind: 'battery' });
        expect(layers[2], `viewSeat=${seat}：对手协议必须紧贴中线（第 3 层，内端）`)
          .toEqual({ side: 'foe', kind: 'protocol' });
        expect(layers[3], `viewSeat=${seat}：自己协议必须紧贴中线（第 4 层，内端）`)
          .toEqual({ side: 'self', kind: 'protocol' });
        expect(layers[5], `viewSeat=${seat}：自己能量槽必须在一列的最下端（第 6 层）`)
          .toEqual({ side: 'self', kind: 'battery' });
        // 自己链路在下半、对手链路在上半（中线把它们分开）
        const iFoeStack = layers.findIndex((l) => l.side === 'foe' && l.kind === 'stack');
        const iSelfStack = layers.findIndex((l) => l.side === 'self' && l.kind === 'stack');
        expect(iFoeStack, `viewSeat=${seat}：对手链路必须在中线之上（第 2 层）`).toBe(1);
        expect(iSelfStack, `viewSeat=${seat}：自己链路必须在中线之下（第 5 层）`).toBe(4);

        // ③ 归属：能量槽/链路槽各自挂在自己的侧里，**不是**按绝对玩家猜的
        const foeSide = visualChildren(col, [], RULES).find((n) => isClass(n, 'net-side-foe'))!;
        const selfSide = visualChildren(col, [], RULES).find((n) => isClass(n, 'net-side-self'))!;
        expect(foeSide.dataset.player, `viewSeat=${seat}：对手侧的 data-player 应是绝对的 ${1 - seat}`)
          .toBe(String(1 - seat));
        expect(selfSide.dataset.player, `viewSeat=${seat}：自己侧的 data-player 应是绝对的 ${seat}`)
          .toBe(String(seat));

        // ④ 竖向生长类**按侧**（不是按绝对玩家）：自己恒 .grow-down、对手恒 .grow-up
        const selfStack = findLayer(col, RULES, { side: 'self', kind: 'stack' })!;
        const foeStack = findLayer(col, RULES, { side: 'foe', kind: 'stack' })!;
        expect(classesOf(selfStack), `viewSeat=${seat}：自己链路必须向上端协议生长（.grow-down）`)
          .toContain('grow-down');
        expect(classesOf(foeStack), `viewSeat=${seat}：对手链路必须向下端协议生长（.grow-up）`)
          .toContain('grow-up');
      }
    } finally {
      await drainRaf();
      restore();
    }
  });

  it('CSS 侧腿：能量槽的落端必须**按侧**给 order（不得再按绝对玩家 .p1/.p2）', () => {
    // 元素树求解已经证明"当前样式表算出来的层序是对的"；这一条防的是"靠权重压住了错的旧规则"：
    // 只要还有人按绝对玩家给 order，换一个席位就会翻回来。
    const batteryOrderRules = RULES.filter((r) => /(?:^|;|\s)order\s*:/.test(r.body) && /\.battery/.test(r.selector));
    const byPlayer = batteryOrderRules.filter((r) => /\.p[12]\b/.test(r.selector)).map((r) => r.selector);
    expect(byPlayer, 'styles-net.css 里仍有"按绝对玩家号"给能量槽定 order 的规则'
      + '（默认席位下会让两个能量槽都跑到内侧 —— C-2）').toEqual([]);
    const bySide = batteryOrderRules.filter((r) => /\.net-side-(foe|self)\b/.test(r.selector));
    expect(bySide.length, 'styles-net.css 未按侧（.net-side-foe/.net-side-self）给能量槽定 order')
      .toBe(2);
  });
});
