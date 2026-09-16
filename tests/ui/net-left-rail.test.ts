import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createGame } from '../../src/core/state/create';
import { renderNetBoard, NET_BOTTOM_SIDES } from '../../src/ui/render-net';
import { setFxViewSeat } from '../../src/ui/fx-seat';
import { cardImgSrc, protocolImgSrc } from '../../src/data/demo';
import {
  assertNoUnmodelableCascade, cssLenOf, cssRules, MODELED_PROPS, subjectPropOf,
} from './net-css-parse';
import {
  descendants, drainRaf, installStubDom, isClass, makeStubEl, type StubNode,
} from './net-dom-stub';

/**
 * **R19 的守卫：左栏（`.net-left-rail`）与卡牌放大框（`.net-zoom-box`）**。
 *
 * 用户原话（本轮）："将下方的己方牌堆以及弃牌堆、手牌区、对方牌堆以及弃牌堆等三个组件，
 * 平移挪到左边区域，直至这三个组件的最右边紧挨着中间的放置区域，也就是能够完整漏出中间
 * 放置卡牌的区域为止，然后为页面左上角也就是三大组件移动后的上方新加一个卡牌放大框，
 * 同时还能显示当前卡牌的中文文本信息……具体可参考图鉴中的那个展示框。"
 *
 * | 腿 | 守什么 | 机制 |
 * | --- | --- | --- |
 * | **RAIL-1** | 结构：`.net-left-rail` / `.net-zoom-box` / `.net-dock` 三层都在，
 *   三块停靠组件都在 `.net-dock` 里、`.net-bottom`/`.net-hands` 仍是 `display: contents` | 真跑 `renderNetBoard`（桩 DOM） |
 * | **RAIL-2** | CSS 解算：`.net-board` 的列模板 = `minmax(0,1fr) auto minmax(0,1fr)`、
 *   行模板只有一行、`.net-grid` 在**第 2 列**、左栏在**第 1 列**且 `justify-self: end` | 解 `styles-net.css` 的级联 |
 * | **RAIL-3** | 行为：放大框的四档内容（正面卡 / 背面卡 / 对手手牌占位 / 协议）+ **防泄露** | 真跑 `netZoomContentFor` + `fillNetZoomBox` |
 * | **RAIL-4** | 放大框的**交互**：悬浮即时显示、单击固定、同 key 再点取消固定 | 真跑 `bindNetZoomBox`（桩的 `dispatchEvent` 冒泡） |
 * | **RAIL-5** | 反空集合：把公开性判据注入恒 `true` ⇒ 背面卡 / 对手手牌那两条**必须变红** | 同 RAIL-3，只换 `deps` |
 *
 * ## 这个桩**能**证明什么 / **不能**证明什么（与既有 net 文件同一口径）
 *
 * 能：元素树（归属 / 顺序 / 类名 / dataset）、由真实样式表**级联解算**出的"哪条声明生效"、
 * 放大框内容的**真实构造**（`netZoomContentFor` + `fillNetZoomBox` 的产出文本与 `data-state`）、
 * 以及**事件委托**在冒泡路径上的真实行为。
 * **不能**：真实布局（左栏到底多宽、压缩后好不好看、"放大框是否挡住放置区"）——
 * 那些只能由用户在 `localhost:5173` 上人眼验收（见报告的人眼清单）。
 */

/* ============================================================================
 * 样式表（与既有 net 文件**同一套**解析器；见 ./net-css-parse 头注）
 * ========================================================================== */

const read = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`../../src/ui/${name}`, import.meta.url)))
    .subarray(0, 4 * 1024 * 1024).toString('utf8');

const RULES = cssRules(read('styles-net.css'));

/** 造一个只带类名 / `data-*` 的桩节点（纯 CSS 解算用；不装 DOM、不渲染）。 */
function cssNode(...classes: string[]): StubNode {
  const n = makeStubEl('div');
  n.classList.add(...classes);
  return n;
}

/** `grid-template-columns/rows` 的声明值 → 轨道列表（只展开本页用到的 `repeat(n, …)`）。 */
function splitTopLevel(value: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of value) {
    if (ch === '(') depth += 1;
    else if (ch === ')') depth -= 1;
    if (/\s/.test(ch) && depth === 0) {
      if (cur !== '') out.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  if (cur !== '') out.push(cur);
  return out;
}
function gridTracks(raw: string): string[] {
  const out: string[] = [];
  for (const token of splitTopLevel(raw)) {
    const m = /^repeat\(\s*(\d+)\s*,([\s\S]*)\)$/.exec(token);
    if (m === null) { out.push(token); continue; }
    const inner = splitTopLevel(m[2]);
    for (let i = 0; i < Number.parseInt(m[1], 10); i += 1) out.push(...inner);
  }
  return out;
}

/* ============================================================================
 * 真跑一帧（与 net-dock / net-r9 的 renderFrame 同源）
 * ========================================================================== */

function renderFrame(viewSeat: 0 | 1): StubNode {
  const s = createGame({ seed: 'r19-left-rail', draftStarter: 0, firstToPlay: 1 });
  for (const p of [0, 1] as const) {
    s.players[p].protocols = [
      { defId: 'fire-0', compiled: false },
      { defId: 'ice-0', compiled: false },
      { defId: 'light-0', compiled: false },
    ] as never;
  }
  (s as { phase: string }).phase = 'turn';
  s.turnPlayer = 0;
  const root = makeStubEl('div');
  const noop = (): void => { /* noop */ };
  renderNetBoard(root as unknown as HTMLElement, s, {
    onAction: noop, onRendered: noop, rerender: noop, onDraftPick: noop, onDraftUnpick: noop,
    onDraftBan: noop, onWinReset: noop,
  } as never, { viewSeat, verifyHooks: false });
  return root;
}

const boardOf = (root: StubNode): StubNode => {
  const b = root.children.find((n) => isClass(n, 'net-board'));
  expect(b, 'root 下没有 .net-board（渲染器没挂 wrap？）').toBeTruthy();
  return b!;
};

/** 从 `root` 到 `target` 的祖先链（含 `target` 自己）；找不到就抛错。 */
function ancestorsOf(root: StubNode, target: StubNode): StubNode[] {
  const path: StubNode[] = [];
  const visit = (n: StubNode, chain: StubNode[]): boolean => {
    const next = [...chain, n];
    if (n === target) { path.push(...next); return true; }
    for (const c of n.children) if (visit(c, next)) return true;
    return false;
  };
  if (!visit(root, [])) throw new Error('ancestorsOf：目标节点不在 root 的子树里（结构被改动？）');
  return path;
}

/**
 * 把 `src` 写到桩 `<img>` 上（**与产出代码的写法逐字一致**：`img.src = …` 属性赋值）。
 *
 * ⚠️ **R19 的桩修正**：`net-dom-stub` 的 `setAttribute` 从 noop 改成了"真的记属性"，
 * 且 `getAttribute` 现在也认**反射属性**（真实 DOM 里 `img.src = x` 与
 * `img.setAttribute('src', x)` 是同一个属性）。⇒ 本文件直接走真实写法，**不手写 `dataset`**
 * （那会让"桩的读法"与"产出代码的读法"分叉）。
 */
const setSrc = (img: StubNode, src: string): void => {
  (img as unknown as HTMLImageElement).src = src;
};
function textOf(n: StubNode): string {
  let out = n.text;
  // ⚠️ 跳过**文本节点**（桩里 `document.createTextNode` 返回 `{ text }`，没有 `children`）——
  //    与 `net-dom-stub` 的 `descendants` 同一口径（真实 DOM 的 `children` 只含元素）。
  for (const c of n.children ?? []) {
    if (Array.isArray((c as StubNode).children)) out += '\n' + textOf(c as StubNode);
    else out += '\n' + String((c as { text?: string }).text ?? '');
  }
  return out;
}

afterEach(() => { setFxViewSeat(null); });

/* ============================================================================
 * 合成卡 / 协议的节点工厂（放大框那两条行为腿的输入）
 * ========================================================================== */

/** 一张**正面**卡（`renderCardFace` 的正面分支形态：`img.card-face-img`）。 */
function faceCard(defId: string, extra?: { hand?: boolean; uid?: string }): StubNode {
  const card = makeStubEl('div');
  card.classList.add('card');
  if (extra?.uid !== undefined) card.dataset.uid = extra.uid;
  const [proto, value] = defId.split('-');
  const img = makeStubEl('img');
  img.className = 'card-face-img';
  setSrc(img, cardImgSrc(proto, value));
  card.appendChild(img);
  return card;
}

/** 一张**背面**卡（`renderCardFace` 的背面分支形态：只有 `.card-back`，**没有**卡面图）。 */
function backCard(uid: string): StubNode {
  const card = makeStubEl('div');
  card.classList.add('card');
  card.dataset.uid = uid;
  const back = makeStubEl('div');
  back.classList.add('card-back');
  const img = makeStubEl('img');
  img.className = 'cardback-img';
  setSrc(img, '/assets/Cardback.jpg');
  back.appendChild(img);
  card.appendChild(back);
  return card;
}

/** 一块协议格（`renderProtocolCell` 的形态：`.protocol-cell > .protocol > .protocol-holder > img.protocol-img`）。 */
function protocolCell(defId: string, compiled = false): StubNode {
  const cell = makeStubEl('div');
  cell.classList.add('protocol-cell');
  const proto = makeStubEl('div');
  proto.classList.add('protocol');
  if (compiled) proto.classList.add('compiled');
  const holder = makeStubEl('div');
  holder.classList.add('protocol-holder');
  const img = makeStubEl('img');
  img.className = 'protocol-img';
  setSrc(img, protocolImgSrc(defId, compiled));
  holder.appendChild(img);
  proto.appendChild(holder);
  cell.appendChild(proto);
  return cell;
}

/** 对手手牌的**张数占位块**（`renderHand` 的 `handVisibility: 'count'` 分支形态）。 */
function foeHandPlaceholder(count: number): StubNode {
  const hand = makeStubEl('div');
  hand.classList.add('hand', 'hand-count-only');
  hand.dataset.player = '1';
  // `data-hand-count` 的等价读法（真实 DOM 里 `setAttribute('data-hand-count', …)` 与
  // `dataset.handCount` 是同一个属性；桩的 `getAttribute('data-*')` 走 `dataset`）。
  hand.dataset.handCount = String(count);
  const ph = makeStubEl('div');
  ph.classList.add('hand-count-placeholder');
  ph.textContent = `手牌 ×${count}`;
  hand.appendChild(ph);
  return hand;
}

/**
 * 一条**完整**的悬浮链：`板根 → [座位类] → 命中节点`。
 * 返回 `{ wrap, target }`（`wrap` 就是放大框交互委托挂的那一层）。
 */
function targetUnder(seatCls: string | null, node: StubNode): { wrap: StubNode; target: StubNode } {
  const wrap = cssNode('board', 'net-board', 'net-view-0');
  let parent = wrap;
  if (seatCls !== null) {
    const side = makeStubEl('div');
    side.classList.add(...seatCls.split(' '));
    wrap.appendChild(side);
    parent = side;
  }
  parent.appendChild(node);
  return { wrap, target: node };
}

/** 放大框的交互依赖（与 `renderNetBoard` 里传的那一份同形；可注入）。 */
const depsOf = (viewSeat: 0 | 1) => ({
  isSelfSide: (side: 'self' | 'foe' | null): boolean =>
    side === 'self' ? viewSeat === 0 || viewSeat === 1 : false,
});

/* ============================================================================
 * RAIL-1：结构腿（真跑 renderNetBoard）
 * ========================================================================== */

describe('R19 · RAIL-1：左栏结构（真跑 renderNetBoard）', () => {
  it('RAIL-1a. `.net-left-rail` 里有且仅有「放大框（上）+ `.net-dock`（下）」；三块停靠组件都在 `.net-dock` 里', async () => {
    const restore = installStubDom();
    try {
      for (const seat of [0, 1] as const) {
        const root = renderFrame(seat);
        const board = boardOf(root);
        const rail = descendants(root).filter((n) => isClass(n, 'net-left-rail'));
        expect(rail.length, `viewSeat=${seat}：.net-left-rail 不是恰好一块（实际 ${rail.length}）`).toBe(1);
        const tree: string[] = [];
        const walk = (n: StubNode, d: number): void => {
          tree.push(`${'  '.repeat(d)}<${n.tag} class="${n.cls}">${n.text ? ` "${n.text}"` : ''}`);
          for (const c of n.children) walk(c, d + 1);
        };
        walk(rail[0], 0);
        console.log(`\n===== RAIL-1a · viewSeat=${seat} · 左栏元素树 =====\n${tree.join('\n')}`);

        // ① 左栏的**直接子节点**恰好两个：[放大框, .net-dock]
        const railKidKinds = rail[0].children.map((n) => (isClass(n, 'net-zoom-box') ? 'zoom-box'
          : isClass(n, 'net-dock') ? 'dock' : `?${n.cls}`));
        expect(railKidKinds, `viewSeat=${seat}：左栏的直接子节点必须是 [卡牌放大框, .net-dock]`
          + `（实际 ${railKidKinds.join(' | ')}）`).toEqual(['zoom-box', 'dock']);
        // ② 放大框在**上**（flex column 的第一个子节点 = 视觉最上）
        expect(isClass(rail[0].children[0], 'net-zoom-box'),
          `viewSeat=${seat}：左栏的第一个子节点必须是卡牌放大框（用户："页面左上角"/"三大组件移动后的上方"）`)
          .toBe(true);
        // ③ 三块停靠组件都在 `.net-dock` 里（经 `.net-bottom` / `.net-hands` 两层 contents）
        const dock = rail[0].children[1];
        expect(isClass(dock, 'net-dock'), `viewSeat=${seat}：左栏的第二个子节点不是 .net-dock`).toBe(true);
        expect(descendants(dock).filter((n) => isClass(n, 'net-bottom')).length,
          `viewSeat=${seat}：.net-dock 里必须恰好一块 .net-bottom`).toBe(1);
        expect(descendants(dock).filter((n) => isClass(n, 'net-hands')).length,
          `viewSeat=${seat}：.net-dock 里必须恰好一块 .net-hands`).toBe(1);
        for (const sel of ['net-info-block', 'net-hand-area'] as const) {
          const nodes = descendants(dock).filter((n) => isClass(n, sel));
          expect(nodes.length, `viewSeat=${seat}：.net-dock 里 ${sel} 不是恰好两块（实际 ${nodes.length}）`).toBe(2);
        }
        // ④ **反空集合**：三块真的都在**同一个** `.net-dock` 下（不是散在别处）
        const dockEls = descendants(root).filter((n) => isClass(n, 'net-dock'));
        expect(dockEls.length, `viewSeat=${seat}：.net-dock 不是恰好一块`).toBe(1);
        expect(dockEls[0], `viewSeat=${seat}：.net-dock 不在左栏里`).toBe(dock);
        // ⑤ 板根的直接子节点 = [.net-grid, .net-left-rail, …]（左栏与放置区同在第 1 行）
        const boardKids = board.children.map((n) => [n.cls.split(/\s+/)[0],
          isClass(n, 'net-grid') ? 'net-grid' : isClass(n, 'net-left-rail') ? 'net-left-rail' : '?']);
        expect(boardKids.slice(0, 2).map((x) => x[1]), `viewSeat=${seat}：.net-board 的前两个子节点必须是`
          + ` [.net-grid, .net-left-rail]（实际 ${boardKids.slice(0, 2).map((x) => x[0]).join(' | ')}）`)
          .toEqual(['net-grid', 'net-left-rail']);
      }
    } finally {
      await drainRaf();
      restore();
    }
  });

  it('RAIL-1b. 红线：`.net-hands` 仍恰好一块、两条 `.hand` 的 DOM 顺序仍 `[P0, P1]`', async () => {
    const restore = installStubDom();
    try {
      for (const seat of [0, 1] as const) {
        const root = renderFrame(seat);
        const handsRoots = descendants(root).filter((n) => isClass(n, 'net-hands'));
        expect(handsRoots.length, `viewSeat=${seat}：.net-hands 必须恰好一块（多一块 = 两份手牌 ⇒ `
          + 'FX 按下标取到旧副本）').toBe(1);
        const hands = descendants(handsRoots[0]).filter((n) => isClass(n, 'hand'));
        expect(hands.map((n) => String(n.dataset.player)), `viewSeat=${seat}：.hand 的 DOM 顺序必须恒为`
          + ` [P0, P1]（FX 用 querySelectorAll('.hand')[player] **按下标**读手牌 —— 顺序反了会把`
          + `特效飞到对手手牌区，不报错也不跳过）`).toEqual(['0', '1']);
        // 反空集合：这一帧里真的有两块手牌区与两块信息块（否则上面几条是空判据）
        expect(descendants(root).filter((n) => isClass(n, 'net-hand-area')).length,
          `viewSeat=${seat}：两块手牌区`).toBe(2);
        expect(descendants(root).filter((n) => isClass(n, 'net-info-block')).length,
          `viewSeat=${seat}：两块信息块`).toBe(2);
        // 信息块进 DOM 的顺序仍等于 `NET_BOTTOM_SIDES`（改常量必须同时改这条腿）
        const bottom = descendants(root).find((n) => isClass(n, 'net-bottom'))!;
        expect(bottom.children.filter((n) => isClass(n, 'net-info-block'))
          .map((n) => String(n.dataset.netSeat)),
        `viewSeat=${seat}：信息块进 DOM 的顺序必须等于 NET_BOTTOM_SIDES（现为 [${NET_BOTTOM_SIDES.join(', ')}]）`)
          .toEqual([...NET_BOTTOM_SIDES]);
      }
    } finally {
      await drainRaf();
      restore();
    }
  });

  it('RAIL-1c. **放大框不参与整帧重建之外的状态**：一帧里只建一个，且它在 `.net-board` 的子树内', async () => {
    const restore = installStubDom();
    try {
      for (const seat of [0, 1] as const) {
        const root = renderFrame(seat);
        const board = boardOf(root);
        const boxes = descendants(root).filter((n) => isClass(n, 'net-zoom-box'));
        expect(boxes.length, `viewSeat=${seat}：一帧里 .net-zoom-box 必须恰好一个（实际 ${boxes.length}）`).toBe(1);
        expect(ancestorsOf(root, boxes[0]).includes(board),
          `viewSeat=${seat}：放大框不在 .net-board 的子树里 —— 事件委托（挂在板根上）会收不到它的悬浮事件`)
          .toBe(true);
        // 空态：提示行在，且没有 `data-state` 之外的内容
        expect(boxes[0].dataset.state, `viewSeat=${seat}：新建的放大框不是空态（data-state=${String(boxes[0].dataset.state)}）`)
          .toBe('empty');
        expect(textOf(boxes[0]), `viewSeat=${seat}：空态必须有一行提示（"把鼠标移到卡牌 / 协议上…"）`)
          .toContain('把鼠标移到卡牌');
      }
    } finally {
      await drainRaf();
      restore();
    }
  });
});

/* ============================================================================
 * RAIL-2：CSS 解算腿
 * ========================================================================== */

describe('R19 · RAIL-2：`.net-board` 的列/行模板与左栏的贴边（CSS 解算腿）', () => {
  const board = (): StubNode => cssNode('board', 'net-board');
  const grid = (): StubNode => cssNode('board-grid', 'net-grid');
  const rail = (): StubNode => cssNode('net-left-rail');

  it('RAIL-2a. `.net-board` 的列模板 = `minmax(0, 1fr) auto minmax(0, 1fr)`（左右等宽 ⇒ 放置区恒居中）', () => {
    const b = board();
    const raw = subjectPropOf(b, [b], RULES, 'grid-template-columns');
    expect(raw, '`.net-board` 没有 grid-template-columns（放置区的居中失去机制）').toBeTruthy();
    const tracks = gridTracks(raw!);
    console.log(`\n===== RAIL-2a · .net-board 的列模板 = ${raw}\n  轨道 = ${tracks.join(' | ')}`);
    expect(tracks.length, `列模板必须恰好 3 条轨道（左栏 · 放置区 · 右空），实际 ${tracks.length}`).toBe(3);
    // 逐字钉住"左右两条**同值**、中间 `auto`"——这是"放置区恒居中"的充要条件
    expect(tracks[0].replace(/\s+/g, ' '), `第 1 条轨道必须是 minmax(0, 1fr)（实际 ${tracks[0]}）`)
      .toBe('minmax(0, 1fr)');
    expect(tracks[1], `第 2 条轨道（放置区）必须是 auto（实际 ${tracks[1]}）`).toBe('auto');
    expect(tracks[2].replace(/\s+/g, ' '), `第 3 条轨道必须与第 1 条**同值**（实际 ${tracks[2]}）`)
      .toBe(tracks[0].replace(/\s+/g, ' '));
    // 反面（旧形态）：不许再有 R12-7 的三条内容宽轨道 + justify-content: center
    expect(tracks.filter((t) => /content/.test(t)).map((t) => t),
      '列模板里仍有内容宽轨道 —— 那是 R12-7 的"停靠栏三块"形态；R19 之后它们住在 `.net-dock`（flex）里，'
      + '留在 `.net-board` 上会让左栏被算成"三块的内容宽"').toEqual([]);
    expect(subjectPropOf(b, [b], RULES, 'justify-content'),
      '`.net-board` 上仍有 `justify-content: center`（R12-7 的"三块整组居中"）—— '
      + 'R19 的居中改由左右两条等宽留白表达，留着它就是同一件事两套真相').toBeNull();
  });

  it('RAIL-2b. `.net-board` 的**行模板只有一行**（放置区独占整页高）', () => {
    const b = board();
    const raw = subjectPropOf(b, [b], RULES, 'grid-template-rows');
    expect(raw, '`.net-board` 没有 grid-template-rows').toBeTruthy();
    const rows = gridTracks(raw!);
    console.log(`\n===== RAIL-2b · .net-board 的行模板 = ${raw}\n  轨道 = ${rows.join(' | ')}`);
    expect(rows.length, `行模板必须恰好 1 条轨道（旧值 3 条里有两条没有任何子节点 = 永远 0 高的死轨道），`
      + `实际 ${rows.length} 条：${rows.join(' | ')}`).toBe(1);
    expect(/fr\b/.test(rows[0]), `唯一那条轨道必须是弹性族（放置区吃掉整页高），实际 ${rows[0]}`).toBe(true);
    // 反面：`align-content: start` 在只有一行时没有对象（R19 已删）
    expect(subjectPropOf(b, [b], RULES, 'align-content'),
      '`.net-board` 上仍留着 `align-content: start` —— 只有一行时它没有对象（R19 已删，'
      + '留着会让人以为还有多行表）').toBeNull();
  });

  it('RAIL-2c. `.net-grid` 在**第 2 列**、`.net-left-rail` 在**第 1 列** + `justify-self: end`（+ `align-self: stretch`）', () => {
    const b = board();
    const g = grid();
    const r = rail();
    const gChain = [b, g];
    const rChain = [b, r];
    const got = {
      gridCol: subjectPropOf(g, gChain, RULES, 'grid-column'),
      gridRow: subjectPropOf(g, gChain, RULES, 'grid-row'),
      railCol: subjectPropOf(r, rChain, RULES, 'grid-column'),
      railRow: subjectPropOf(r, rChain, RULES, 'grid-row'),
      justify: subjectPropOf(r, rChain, RULES, 'justify-self'),
      align: subjectPropOf(r, rChain, RULES, 'align-self'),
      display: subjectPropOf(r, rChain, RULES, 'display'),
      flexDir: subjectPropOf(r, rChain, RULES, 'flex-direction'),
    };
    console.log(`\n===== RAIL-2c · 放置区 ←→ 左栏（由 styles-net.css 真实解算）=====\n`
      + `  .net-grid       grid-column=${String(got.gridCol)} grid-row=${String(got.gridRow)}\n`
      + `  .net-left-rail  grid-column=${String(got.railCol)} grid-row=${String(got.railRow)}`
      + ` justify-self=${String(got.justify)} align-self=${String(got.align)}`
      + ` display=${String(got.display)} flex-direction=${String(got.flexDir)}`);
    expect(got.gridCol, '放置区必须**只占中列**（`grid-column: 2`）—— 写成 `1 / -1` 会跨过左右留白，'
      + '`fit-content` 的盒宽被拉散').toBe('2');
    expect(got.gridRow, '放置区必须在第 1 行（唯一一行）').toBe('1');
    expect(got.railCol, '左栏必须在**第 1 列**（放置区在它右边）').toBe('1');
    expect(got.railRow, '左栏必须与放置区**同一行**（"左右两栏"而不是"上下两块"）').toBe('1');
    // ⚠️ 这三条是"最右边紧挨着放置区"的**全部机制** —— 删掉 `justify-self` 立刻红
    expect(got.justify, '左栏必须 `justify-self: end` —— 它的右缘要贴住第 1 列的右缘'
      + '（用户："这三个组件的最右边紧挨着中间的放置区域"）').toBe('end');
    expect(got.align, '左栏必须 `align-self: stretch` —— `justify-self: end` 只给"右缘贴住"，'
      + '高度要撑满整行才装得下"放大框 + 三块组件"').toBe('stretch');
    expect(got.display, '左栏必须是 flex 容器（放大框在上、停靠栏在下）').toBe('flex');
    expect(got.flexDir, '左栏必须是**纵向** flex（自上而下：放大框 → 停靠栏）').toBe('column');
    // 反面：`.net-left-rail` **不许**是 `display: contents`（那样放大框与 dock 会各成一个 grid item）
    expect(got.display, '`.net-left-rail` 被写成了 display: contents —— 放大框与 .net-dock 会各自成为'
      + '`.net-board` 的 grid item，左栏的"上下两块 + 右缘贴边"完全失效').not.toBe('contents');
  });

  it('RAIL-2d（前提腿）：样式表里不得含 `!important` / ID / 内联覆盖（与既有四条腿同一份实现）', () => {
    expect(() => assertNoUnmodelableCascade(RULES, MODELED_PROPS)).not.toThrow();
  });

  it('RAIL-2e. 压缩档位：`--card-h` 收到 130、牌堆 34×50、`.net-hands .card` 的宽/扇步仍由旋钮推出', () => {
    const b = board();
    const cardH = cssLenOf([b], RULES, subjectPropOf(b, [b], RULES, '--card-h') ?? '');
    const cardW = cssLenOf([b], RULES, subjectPropOf(b, [b], RULES, '--card-w') ?? '');
    const handH = cssLenOf([b], RULES, subjectPropOf(b, [b], RULES, '--hand-card-h') ?? '');
    console.log(`\n===== RAIL-2e · R19 的压缩档位 =====\n`
      + `  --card-h = ${String(cardH)} / --card-w = ${cardW === null ? 'null' : cardW.toFixed(2)}`
      + ` / --hand-card-h = ${handH === null ? 'null' : handH.toFixed(2)}`);
    expect(cardH, '`--card-h` 不是 140 → 130 的那一档（R19 的左栏压缩）').toBe(130);
    expect(cardW, '`--card-w` 不再由 `--card-h` 推出').not.toBeNull();
    expect(cardW!, '`--card-w` 必须等于卡面 5:7 的推导值').toBeCloseTo((130 - 2) * 0.71429 + 2, 2);
    expect(handH, '`--hand-card-h` 必须等于 `(--card-w − 8) × 1.4 + 8`')
      .toBeCloseTo((cardW! - 8) * 1.4 + 8, 2);
    // 牌堆 / 弃牌堆：R19 的 34×50（解算成像素，不认写法）
    for (const [cls, tag] of [['deck', '牌库'], ['trash-pile', '弃牌堆']] as const) {
      const pile = cssNode(cls, `${cls} p1`);
      pile.dataset.player = '1';
      const chain = [b, cssNode('net-piles'), pile];
      expect(cssLenOf(chain, RULES, subjectPropOf(pile, chain, RULES, 'width') ?? ''),
        `${tag}的宽不是 34px（R19 的左栏压缩没生效）`).toBe(34);
      expect(cssLenOf(chain, RULES, subjectPropOf(pile, chain, RULES, 'height') ?? ''),
        `${tag}的高不是 50px（R19 的左栏压缩没生效）`).toBe(50);
    }
    // ⚠️ **一处旋钮**（R9-1/R9-4 的硬要求）：整份文件里 `--card-h` 只许有 **1 处真值定义**。
    //    ⚠️ **必须在去注释后的正文里数**：注释里写着 `--card-h` 这三个字的地方不止一处
    //    （历史说明、`var(--card-h)` 的引用说明…），拿裸文本数会把注释一起算进去
    //    （实测：裸数得 5 —— 那是"注释补位"的假红，本项目反复栽过）。
    //    `var(--card-h)` 的**引用**不匹配本正则（`--card-h` 后面必须紧跟 `:`）；
    //    `.net-lane-band .stack { --card-h: inherit }` 是 R10-2 的"拿回旋钮"再声明，**不算**第二个值。
    const noComments = read('styles-net.css').replace(/\/\*[\s\S]*?\*\//g, ' ');
    const decls = noComments.match(/--card-h\s*:(?!\s*inherit)/g) ?? [];
    expect(decls.length, `styles-net.css 里 --card-h 被定义了 ${decls.length} 次（必须恰好 1 次 = 单一旋钮）`)
      .toBe(1);
  });
});

/* ============================================================================
 * RAIL-3：放大框的**内容**（真跑 netZoomContentFor + fillNetZoomBox）
 * ========================================================================== */

describe('R19 · RAIL-3：放大框的内容与**防泄露**（四档）', () => {
  it('RAIL-3a. 正面场上卡 ⇒ 出现卡名 / 中文效果文本 / 卡图（`data-state=card`）', async () => {
    const restore = installStubDom();
    try {
      const { netZoomContentFor, fillNetZoomBox } = await import('../../src/ui/render-net');
      const card = faceCard('fire-3', { uid: 'u-fire3' });
      const { target } = targetUnder('net-side net-side-self', card);
      const item = netZoomContentFor(target as unknown as HTMLElement, {
        phase: 'turn', deps: depsOf(0),
      });
      expect(item, '正面场上卡没有解出条目 —— 放大框对它什么都没显示').toBeTruthy();
      expect(item!.kind, '正面卡的档位不是 card').toBe('card');
      const box = makeStubEl('div');
      box.classList.add('net-zoom-box');
      fillNetZoomBox(box as unknown as HTMLElement, item);
      const txt = textOf(box);
      console.log(`\n===== RAIL-3a · 正面卡 ⇒ 放大框内容 =====\n${txt}`);
      expect(box.dataset.state, '`data-state` 不是 card').toBe('card');
      expect(txt, '正面卡没有显示卡名（中文标题）').toContain('3 分');
      expect(txt, '正面卡没有显示中文效果文本（buildCardTextEl 的产出）').toMatch(/顶部|中部|底部/);
      expect(descendants(box).filter((n) => isClass(n, 'net-zoom-box-img')).length,
        '正面卡没有卡图（`.net-zoom-box-img`）').toBe(1);
    } finally {
      await drainRaf();
      restore();
    }
  });

  it('RAIL-3b. **背面**场上卡 ⇒ **不出现**卡名与效果文本，只出现「未公开」（`data-state=back`）', async () => {
    const restore = installStubDom();
    try {
      const { netZoomContentFor, fillNetZoomBox, netPublicOf } = await import('../../src/ui/render-net');
      const card = backCard('u-back');
      const { target } = targetUnder('net-side net-side-foe', card);
      const item = netZoomContentFor(target as unknown as HTMLElement, {
        phase: 'turn', deps: depsOf(0),
      });
      expect(item, '背面卡没有解出条目（它必须落 back 档，而不是"什么都不显示"）').toBeTruthy();
      expect(item!.kind, '背面卡的档位不是 back').toBe('back');
      const box = makeStubEl('div');
      box.classList.add('net-zoom-box');
      fillNetZoomBox(box as unknown as HTMLElement, item);
      const txt = textOf(box);
      console.log(`\n===== RAIL-3b · 背面卡 ⇒ 放大框内容 =====\n${txt}`);
      expect(box.dataset.state, '`data-state` 不是 back').toBe('back');
      expect(txt, '背面卡必须有一行「未公开」').toContain('未公开');
      // ⚠️⚠️ **防泄露的判据本体**：卡名与效果文本的**任何片段**都不许出现
      const defName = (await import('../../src/data/demo')).getCardDef('fire-3');
      expect(txt, `背面卡的框里出现了卡名「${defName.protocol}」的片段 —— 这是信息泄露`).not.toContain(defName.protocol);
      expect(txt, '背面卡的框里出现了效果文本（顶部/中部/底部分段）—— 这是信息泄露')
        .not.toMatch(/顶部：|中部：|底部：/);
      expect(descendants(box).filter((n) => isClass(n, 'net-zoom-box-img')).length,
        '背面卡不该有卡面图（只能有卡背）').toBe(0);
      expect(descendants(box).filter((n) => isClass(n, 'card-back')).length,
        '背面卡必须显示**卡背**（与场上背面卡同款类）').toBe(1);
      // 反空集合：公开性判据在"这一档真的走到了"上确实为 false（否则上面的"没出现"是空断言）
      expect(netPublicOf({
        faceUp: false, side: 'foe', phase: 'turn', secret: false, deps: depsOf(0),
      }), '对手回合/对手侧的背面卡被公开性判据判成"可看" —— 上面那条"没出现"就是空断言').toBe(false);
    } finally {
      await drainRaf();
      restore();
    }
  });

  it('RAIL-3c. 对手手牌**张数占位块** ⇒ 只报张数、不泄露（`data-state=unknown`）', async () => {
    const restore = installStubDom();
    try {
      const { netZoomContentFor, fillNetZoomBox } = await import('../../src/ui/render-net');
      const hand = foeHandPlaceholder(5);
      const { target } = targetUnder('net-hand-area net-hand-area-foe', hand);
      // 命中占位块里的那行字（真实的 pointerover 目标就是它）
      const ph = descendants(hand).find((n) => isClass(n, 'hand-count-placeholder'))!;
      const item = netZoomContentFor(ph as unknown as HTMLElement, { phase: 'turn', deps: depsOf(0) });
      expect(item, '对手手牌占位块没有解出条目').toBeTruthy();
      expect(item!.kind, '对手手牌占位块的档位不是 unknown').toBe('unknown');
      const box = makeStubEl('div');
      box.classList.add('net-zoom-box');
      fillNetZoomBox(box as unknown as HTMLElement, item);
      const txt = textOf(box);
      console.log(`\n===== RAIL-3c · 对手手牌占位块 ⇒ 放大框内容 =====\n${txt}`);
      expect(box.dataset.state, '`data-state` 不是 unknown').toBe('unknown');
      expect(txt, '对手手牌占位块必须报出**张数**（5）').toContain('5');
      expect(txt, '对手手牌占位块必须明说"内容未公开"').toMatch(/未公开/);
      expect(txt, '对手手牌占位块里出现了 `.card` 分支的标题（说明它走了卡分支 —— 那会泄露卡名）')
        .not.toMatch(/分$/m);
      // 反空集合：占位块**不是** `.card`（它没有任何卡面数据），这是"unknown 档"的树前提
      expect(descendants(hand).some((n) => isClass(n, 'card')),
        '构造的占位块里出现了 `.card` —— 那它就不再是"没有卡面数据"的占位块了').toBe(false);
    } finally {
      await drainRaf();
      restore();
    }
  });

  it('RAIL-3d. 协议 ⇒ 出现协议名与中文详情（`data-state=protocol`，恒公开）', async () => {
    const restore = installStubDom();
    try {
      const { netZoomContentFor, fillNetZoomBox } = await import('../../src/ui/render-net');
      const { getProtocolDef } = await import('../../src/data/demo');
      // ⚠️ 协议 defId 是**协议**（`fire`），不是指令卡（`fire-0`）—— `getProtocolDef` 只认前者
      //    （源码腿：`data/demo.ts` 的 `protocolIndex` 由 `ALL_PROTOCOLS*` 建）。
      const cell = protocolCell('fire', false);
      // ⚠️ 悬浮的**真实目标**是 `.protocol` 的**子节点**（协议图），不是格子的外层 ——
      //    `netZoomContentFor` 用 `target.closest('.protocol')` **向上**找协议盒，
      //    所以从这里派发才与真实指针位置同义（从格子上派发会因"协议是后代而不是祖先"解不出）。
      const protoImg = descendants(cell).find((n) => isClass(n, 'protocol-img'))!;
      const { target } = targetUnder('net-side net-side-foe', cell);
      expect(protoImg, '（结构前提）协议格里没有 .protocol-img').toBeTruthy();
      const item = netZoomContentFor(protoImg as unknown as HTMLElement, { phase: 'turn', deps: depsOf(0) });      expect(item, '协议没有解出条目').toBeTruthy();
      expect(item!.kind, '协议的档位不是 protocol').toBe('protocol');
      const box = makeStubEl('div');
      box.classList.add('net-zoom-box');
      fillNetZoomBox(box as unknown as HTMLElement, item);
      const txt = textOf(box);
      console.log(`\n===== RAIL-3d · 协议 ⇒ 放大框内容 =====\n${txt}`);
      expect(box.dataset.state, '`data-state` 不是 protocol').toBe('protocol');
      const name = getProtocolDef('fire').name;
      expect(txt, `协议名「${name}」没有出现在放大框里`).toContain(name);
      expect(txt, '协议详情面板（buildProtocolRatingPanel）的关键词行没出现').toMatch(/关键词/);
      expect(descendants(box).filter((n) => isClass(n, 'net-zoom-box-img')).length,
        '协议没有协议图（`.net-zoom-box-img`）').toBe(1);
    } finally {
      await drainRaf();
      restore();
    }
  });

  it('RAIL-3e（反空集合 · **变异实测的判据本体**）：公开性这一层恒 `true` ⇒ 背面卡与对手手牌那两条**必须变红**', async () => {
    // ⚠️ 这条腿是 RAIL-3b / RAIL-3c 的**反空集合**：把**公开性那一层**弄成恒 `true`
    //    （= 第二层判据失效），然后重跑那两条的**判据本体**：
    //      · 背面卡：**仍然不许**出现卡名与效果文本 —— 因为"有没有卡面图"这层 DOM 事实
    //        （`img.card-face-img`）本身就会把它拦在 `back` 档；
    //      · 对手手牌占位块：**仍然**只报张数 —— 因为它在 `.hand-count-only` 上先命中 `unknown` 档。
    //
    // ## 怎么把"公开性那一层"弄成恒真（**两条注入，覆盖两种真实错法**）
    //  ① `deps.isSelfSide` 注入恒 `true` —— 让 `netPublicOf` 的第三个分支恒真；
    //  ② **把卡片所在侧的类名换成 `self`**（`net-side-foe` → `net-side-self`）——
    //     因为本页的"侧别"是**从类名读的**（`sideOfEl`），只注入 ①**不会**让 `side` 变成 `self`。
    //  ⚠️ **实测教训（本文件第一版在这里是绿的）**：只有 ① 时，实现里那句
    //     `if (face !== null && visible)` 的**第一个合取项**仍然拦住了背面卡 ⇒ 把判据写成
    //     `face !== null || …`（甚至 `face === null || visible` 这种真错法）都**不会被抓到**。
    //     ⇒ 必须同时用 ②（同一张背面卡、只把它所在的侧换成 self）才把"只剩一层"的写法逼出来。
    //  ⇒ 若有人把"防泄露"实现成"只看公开性"（把两层合成一层），下面两条会红。
    const restore = installStubDom();
    try {
      const { netZoomContentFor, fillNetZoomBox, netPublicOf } = await import('../../src/ui/render-net');
      const alwaysSelf = { isSelfSide: (): boolean => true };
      // ① 变异的前提下，公开性判据**确实**变成 true（证明"注入生效了"，否则下面两条是空断言）
      expect(netPublicOf({ faceUp: false, side: 'foe', phase: 'turn', secret: false, deps: alwaysSelf }),
        '注入恒 true 之后公开性判据仍为 false —— 那这条反空集合证明不了任何事').toBe(true);
      // ② 背面卡：判据本体**必须仍然成立**（DOM 事实层把它拦在 back 档）
      const back = backCard('u-back');
      const { target: backTarget } = targetUnder('net-side net-side-foe', back);
      const backItem = netZoomContentFor(backTarget as unknown as HTMLElement,
        { phase: 'turn', deps: alwaysSelf });
      const backBox = makeStubEl('div');
      backBox.classList.add('net-zoom-box');
      fillNetZoomBox(backBox as unknown as HTMLElement, backItem);
      const backTxt = textOf(backBox);
      console.log(`\n===== RAIL-3e · 注入恒 true 后的背面卡 =====\n${backTxt}`);
      expect(backItem!.kind, '注入恒 true 之后背面卡的档位变成了非 back —— 防泄露只剩一层（isSelfSide）了')
        .toBe('back');
      expect(backTxt, '注入恒 true 之后背面卡泄露了效果文本').not.toMatch(/顶部：|中部：|底部：/);
      // ③ 对手手牌占位块：判据本体**必须仍然成立**（它在卡分支之前就命中 unknown 档）
      const hand = foeHandPlaceholder(3);
      const { target: handTarget } = targetUnder('net-hand-area net-hand-area-foe', hand);
      const handItem = netZoomContentFor(
        descendants(hand).find((n) => isClass(n, 'hand-count-placeholder')) as unknown as HTMLElement,
        { phase: 'turn', deps: alwaysSelf },
      );
      expect(handItem!.kind, '注入恒 true 之后对手手牌占位块不再落 unknown 档 —— 它会去读卡面数据')
        .toBe('unknown');
      expect(handTarget, '（结构前提）占位块仍在构造的树里').toBeTruthy();
      /* ④ **第二条注入：把这一张背面卡所在的侧换成 `self`** —— 侧别是从**类名**读的
       *    （`sideOfEl`），所以只注入 `deps.isSelfSide` 不会让 `side` 变成 `self`；
       *    换掉类名之后，"公开性那一层"对这张卡**确实**返回 `true`（= 第二层失效）。
       *    **判据本体**：档位必须仍是 `back`、文本里不许出现效果文本分段。
       *    ⚠️ 没有这一条时，"把 `visible` 写成 `face !== null || netPublicOf(...)`"
       *    这类**真实现里的错法**在本文件里是**绿的**（实测见本用例头注）。 */
      const back2 = backCard('u-back2');
      const { target: back2Target } = targetUnder('net-side net-side-foe', back2);
      const sideNode = back2Target.parentElement as StubNode;
      sideNode.classList.remove('net-side', 'net-side-foe');
      sideNode.classList.add('net-side', 'net-side-self');
      // 反空集合：换完之后**公开性那一层**真的为 true（否则下面两条又是空断言）
      expect(netPublicOf({
        faceUp: false, side: 'self', phase: 'turn', secret: false, deps: alwaysSelf,
      }), '把侧换成 self 之后公开性判据仍为 false —— 第二条注入没生效').toBe(true);
      const back2Item = netZoomContentFor(back2Target as unknown as HTMLElement,
        { phase: 'turn', deps: alwaysSelf });
      const back2Box = makeStubEl('div');
      back2Box.classList.add('net-zoom-box');
      fillNetZoomBox(back2Box as unknown as HTMLElement, back2Item);
      const back2Txt = textOf(back2Box);
      console.log(`\n===== RAIL-3e · 公开性这一层为 true + 背面卡 ⇒ 放大框内容 =====\n${back2Txt}`);
      expect(back2Item!.kind, '公开性这一层为 true 时，**背面卡**的档位不是 back —— '
        + '说明"防泄露"只剩一层（只查公开性、不查 DOM 上有没有卡面图）⇒ 对手的背面卡会泄露卡名与效果文本')
        .toBe('back');
      expect(back2Txt, '公开性这一层为 true 时，背面卡泄露了效果文本（顶部/中部/底部分段）')
        .not.toMatch(/顶部：|中部：|底部：/);
    } finally {
      await drainRaf();
      restore();
    }
  });

  it('RAIL-3f. 与既有出口**同源**（源码腿）：不许出现第二份中文文本渲染', () => {
    const src = readFileSync(fileURLToPath(new URL('../../src/ui/render-net.ts', import.meta.url)))
      .subarray(0, 4 * 1024 * 1024).toString('utf8');
    // ① 复用两处：`buildCardTextEl`（卡牌中文效果面板）与 `buildProtocolRatingPanel`（协议详情）
    expect(src, '`render-net.ts` 没有调用 `buildCardTextEl`（卡牌中文效果面板的唯一出口）')
      .toContain('buildCardTextEl(');
    expect(src, '`render-net.ts` 没有调用 `buildProtocolRatingPanel`（协议详情面板的唯一出口）')
      .toContain('buildProtocolRatingPanel(');
    // ② 反面：本页**不许**自己拼 `card-text-*` / `draft-preview-*` 的结构（那是共享助手的产出形态）
    expect(src, '`render-net.ts` 里出现了 `card-text-seg` —— 那是 `buildCardTextEl` 的内部结构，'
      + '手写它 = 第二份中文文本渲染逻辑').not.toContain("'card-text-seg'");
    expect(src, '`render-net.ts` 里出现了 `draft-preview-` —— 那是 `buildProtocolRatingPanel` 的内部结构')
      .not.toContain("'draft-preview-");
  });
});

/* ============================================================================
 * RAIL-4：放大框的**交互**（真跑 bindNetZoomBox + 桩的事件冒泡）
 * ========================================================================== */

describe('R19 · RAIL-4：悬浮即时显示 + 单击固定（真跑事件委托）', () => {
  /** 造一个"板根 + 放大框 + 一张卡"的迷你树，并挂好委托。 */
  async function harness(): Promise<{
    wrap: StubNode; box: StubNode; card: StubNode; back: StubNode;
  }> {
    const { renderNetZoomBox, bindNetZoomBox } = await import('../../src/ui/render-net');
    const wrap = cssNode('board', 'net-board', 'net-view-0');
    const box = renderNetZoomBox() as unknown as StubNode;
    wrap.appendChild(box);
    const card = faceCard('fire-3', { uid: 'u-a' });
    const back = backCard('u-b');
    const side = cssNode('net-side', 'net-side-self');
    side.appendChild(card);
    side.appendChild(back);
    wrap.appendChild(side);
    bindNetZoomBox(wrap as unknown as HTMLElement,
      () => (wrap as unknown as HTMLElement).querySelector<HTMLElement>('.net-zoom-box'),
      { phase: 'turn', deps: depsOf(0) });
    return { wrap, box, card, back };
  }

  it('RAIL-4a. 悬浮一张正面卡 ⇒ 框里立刻出现该卡的内容；再悬浮另一张 ⇒ 跟着换', async () => {
    const restore = installStubDom();
    try {
      const { box, card, back } = await harness();
      expect(box.dataset.state, '初始不是空态').toBe('empty');
      // ① 悬浮正面卡
      card.dispatchEvent({ type: 'pointerover' });
      expect(box.dataset.state, '悬浮正面卡之后框里不是 card 档（悬浮即时显示没生效）').toBe('card');
      const first = textOf(box);
      expect(first, '悬浮正面卡之后框里没有卡名').toContain('3 分');
      console.log(`\n===== RAIL-4a · 悬浮正面卡之后 =====\n${first}`);
      // ② 再悬浮一张背面卡 ⇒ 跟着换成 back 档（且不泄露）
      back.dispatchEvent({ type: 'pointerover' });
      expect(box.dataset.state, '悬浮背面卡之后框里没有跟着换档（还是上一张的内容）').toBe('back');
      const second = textOf(box);
      console.log(`  ----- 再悬浮背面卡之后 -----\n${second}`);
      expect(second, '背面卡的框里出现了上一张卡名（内容没被换掉）').not.toContain('3 分');
      expect(second, '背面卡的框里没有「未公开」').toContain('未公开');
      // ③ **反空集合**：事件真的冒泡到了板根（若委托没挂上，`data-state` 会一直是 empty）
      expect(box.dataset.state, '两次悬浮之后仍是空态 —— 事件没有冒泡到委托方').not.toBe('empty');
    } finally {
      await drainRaf();
      restore();
    }
  });

  it('RAIL-4b. 单击固定 ⇒ 之后悬浮别的卡**不覆盖**；同 key 再点 ⇒ 取消固定（回到悬浮自由）', async () => {
    const restore = installStubDom();
    try {
      const { box, card, back } = await harness();
      // ① 单击固定这张正面卡
      card.dispatchEvent({ type: 'click' });
      expect(box.dataset.state, '单击之后框里不是 card 档（单击固定没生效）').toBe('card');
      expect(box.dataset.pinned, '固定态没有写进 `data-pinned`（"钉住"的机读镜像）').toBe('1');
      expect(box.classList.contains('pinned'), '固定态没有加 `.pinned` 类（可见反馈）').toBe(true);
      const pinned = textOf(box);
      // ② 悬浮**别的**卡 ⇒ 不覆盖（用户选项 ②："移开不清空已固定的那张"）
      back.dispatchEvent({ type: 'pointerover' });
      expect(box.dataset.state, '固定之后悬浮别的卡把内容覆盖了 —— 违反"固定内容不被打扰"').toBe('card');
      expect(textOf(box), '固定之后内容被改掉了').toBe(pinned);
      expect(box.dataset.pinned, '固定态丢了').toBe('1');
      // ③ 同 key 再点 ⇒ 取消固定
      card.dispatchEvent({ type: 'click' });
      expect(box.dataset.pinned, '同 key 再点没有取消固定（`data-pinned` 仍是 1）').toBe('0');
      expect(box.classList.contains('pinned'), '同 key 再点之后 `.pinned` 类还在').toBe(false);
      // ④ 取消固定之后，悬浮**另一张** ⇒ 又能自由跟随了
      back.dispatchEvent({ type: 'pointerover' });
      expect(box.dataset.state, '取消固定之后悬浮别的卡不再跟随（"回到悬浮自由预览"没落地）').toBe('back');
      console.log(`\n===== RAIL-4b · 固定 → 悬浮别的卡 → 再点同一张 → 悬浮别的卡 =====\n`
        + `  固定态 data-pinned=${String(box.dataset.pinned)} / 最终 data-state=${String(box.dataset.state)}`);
    } finally {
      await drainRaf();
      restore();
    }
  });

  it('RAIL-4c. 悬浮**非卡节点**（板根自己 / 占位之外的空白）⇒ 不改动框里的内容', async () => {
    const restore = installStubDom();
    try {
      const { wrap, box, card } = await harness();
      card.dispatchEvent({ type: 'pointerover' });
      const before = textOf(box);
      // 从板根自己派发（没有任何 `.card` / `.protocol` / 占位块祖先）
      wrap.dispatchEvent({ type: 'pointerover' });
      expect(textOf(box), '悬浮"非卡节点"把框里的内容清掉/改掉了 —— 用户要的是"移开不清空"')
        .toBe(before);
      console.log(`\n===== RAIL-4c · 悬浮非卡节点前后内容不变（${before.split('\n').length} 行）`);
    } finally {
      await drainRaf();
      restore();
    }
  });
});
