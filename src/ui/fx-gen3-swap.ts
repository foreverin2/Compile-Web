/**
 * 3 代（MN03/AX03）· 批次 E：**交换附加层**（支点1·3 / 柔性3）。
 *
 * 触发：
 *  - `stacks:swapped { player, a, b, sourceDefId }`（支点1 中「交换你的左堆叠与右堆叠」= fulcrum-1）
 *  - `protocols:rearranged { player, a|order, sourceDefId }`（支点3 中 / 柔性3 中 的"交换协议"分支）
 *
 * 与既有基础动画**叠加不替换**：
 *  - 协议交换的"两张协议卡同时平移互换"由 effects/index.ts 的 initRearrangeFx 照常播放；
 *  - 堆叠交换（stacks:swapped）此前**没有基础动画**（引擎只换数组），本模块补上
 *    "整堆沿弧线互换"的整堆位移 + 每张略错位跟随 + 落点回弹（设计稿 §4.8 F3）。
 *
 * 视觉：
 *  - 支点：青蓝杠杆弧（连接两个位置）+ 两端棋盘砝码随行 + 刻度环亮一圈；
 *  - 柔性：紫罗兰飘带连接两个协议位，两端各打一个结（交换中两结互相移动到对面再解开）。
 */

const MOVE_MS = 560; // 与"再渲染后无缝衔接"的时长（重排协议基础动画用 MOVE_MS=450；这里略从容）

function el(tag: string, cls: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

function layer(cls: string, z: number): HTMLElement {
  const l = el('div', `${cls} g3fx-layer`);
  l.style.cssText = `position:fixed;left:0;top:0;width:100vw;height:100vh;pointer-events:none;z-index:${z};`;
  document.body.appendChild(l);
  return l;
}

/** 协议格矩形（协议交换用） */
function protocolCellRect(player: number, line: number): DOMRect | null {
  const cell = document.querySelector<HTMLElement>(`.protocol-cell[data-player="${player}"][data-line="${line}"]`);
  if (!cell) return null;
  const img = cell.querySelector<HTMLElement>('.protocol-img') ?? cell;
  const r = img.getBoundingClientRect();
  return r.width === 0 ? null : r;
}

/** 链路槽矩形（堆叠交换用） */
function slotRect(player: number, line: number): DOMRect | null {
  const slot = document.querySelector<HTMLElement>(`.stack-slot[data-player="${player}"][data-line="${line}"]`);
  if (!slot) return null;
  const r = slot.getBoundingClientRect();
  return r.width === 0 ? null : r;
}

/** 两点之间的二次曲线（同 fx-gen3 的弧轨，但这里画在已知矩形之间） */
function curveD(a: DOMRect, b: DOMRect, bowScale = 0.26): { d: string; x1: number; y1: number; x2: number; y2: number; cx: number; cy: number } {
  const x1 = a.left + a.width / 2;
  const y1 = a.top + a.height / 2;
  const x2 = b.left + b.width / 2;
  const y2 = b.top + b.height / 2;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.max(1, Math.hypot(dx, dy));
  const bow = Math.min(150, len * bowScale);
  const cx = (x1 + x2) / 2 - (dy / len) * bow;
  const cy = (y1 + y2) / 2 + (dx / len) * bow;
  return { d: `M ${x1.toFixed(1)} ${y1.toFixed(1)} Q ${cx.toFixed(1)} ${cy.toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)}`, x1, y1, x2, y2, cx, cy };
}

/**
 * 支点：整堆沿弧线互换（stacks:swapped）。
 * 整堆每张卡建一个 body 级幽灵（现有卡面），沿同一条弧线平移、逐张错开 40ms，
 * 到达后轻微回弹 2px；同时画青蓝杠杆弧 + 两端砝码 + 刻度环亮圈。
 */
export function gen3FulcrumSwapFx(p: { player: number; a: number; b: number }, s: { players: { stacks: { uid: string; defId: string; faceUp: boolean }[][] }[] }): void {
  const ra = slotRect(p.player, p.a);
  const rb = slotRect(p.player, p.b);
  if (!ra || !rb) return;
  const l = layer('g3swap-layer', 301);
  // ① 杠杆弧：连接两个链路（自下而上拱起）
  const { d } = curveD(ra, rb, 0.18);
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'g3swap-arc');
  svg.setAttribute('viewBox', `0 0 ${window.innerWidth} ${window.innerHeight}`);
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', d);
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', '#2f7f8f');
  path.setAttribute('stroke-width', '2');
  svg.appendChild(path);
  const wide = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  wide.setAttribute('d', d);
  wide.setAttribute('fill', 'none');
  wide.setAttribute('stroke', '#d8f0ff');
  wide.setAttribute('stroke-width', '9');
  wide.setAttribute('class', 'g3swap-arc-glow');
  svg.appendChild(wide);
  l.appendChild(svg);
  // ② 两端砝码（棋盘格）+ 中央刻度环
  for (const [r, side] of [[ra, 'l'], [rb, 'r']] as const) {
    const w = el('i', `g3swap-weight ${side}`);
    w.style.left = `${r.left + r.width / 2 - 11}px`;
    w.style.top = `${r.top - 18}px`;
    l.appendChild(w);
  }
  const dial = el('i', 'g3swap-dial');
  dial.style.left = `${(ra.left + ra.width / 2 + rb.left + rb.width / 2) / 2}px`;
  dial.style.top = `${(ra.top + rb.top) / 2 + Math.min(ra.height, rb.height) * 0.5}px`;
  l.appendChild(dial);
  // ③ 整堆幽灵：每张沿弧线互换（用实时卡节点卡面，避免依赖引擎类型）
  const stacks = s.players[p.player].stacks;
  const maxCount = Math.max(stacks[p.a].length, stacks[p.b].length);
  for (let i = 0; i < maxCount; i++) {
    for (const [from, to] of [[p.a, p.b], [p.b, p.a]] as const) {
      const card = stacks[from][i];
      if (!card) continue;
      const node = document.querySelector<HTMLElement>(`[data-uid="${card.uid}"]`);
      if (!node) continue;
      const r = node.getBoundingClientRect();
      if (r.width === 0) continue;
      const ghost = el('div', 'g3swap-ghost');
      ghost.style.cssText = `position:fixed;left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;`;
      const face = el('i', 'g3swap-ghost-face');
      if (card.faceUp) face.style.backgroundImage = `url("${node.querySelector('img')?.getAttribute('src') ?? ''}")`;
      else face.classList.add('back');
      ghost.appendChild(face);
      ghost.style.transitionDelay = `${(i * 40).toFixed(0)}ms`;
      l.appendChild(ghost);
      const dx = (from === p.a ? ra.left + ra.width / 2 : rb.left + rb.width / 2) - (r.left + r.width / 2);
      const dy = (from === p.a ? ra.top + ra.height / 2 : rb.top + rb.height / 2) - (r.top + r.height / 2);
      void ghost.offsetWidth;
      requestAnimationFrame(() => {
        ghost.style.transform = `translate(${dx}px, ${dy}px) scale(1)`;
      });
    }
  }
  window.setTimeout(() => l.remove(), MOVE_MS + 700);
}

/**
 * 协议交换附加层（支点3 / 柔性3）：既有幽灵交换照常 → 本层加"杠杆弧 + 砝码"或"飘带两端打结"。
 * sourceDefId：'fulcrum-3' → 支点；'flexibility-3' → 柔性；其它（玩家行动重排 / 别的协议）不接管。
 */
export function gen3ProtocolSwapFx(p: { player: number; a?: number; b?: number; order?: number[]; sourceDefId?: string }): boolean {
  const src = p.sourceDefId ?? '';
  const isFulcrum = src.startsWith('fulcrum-');
  const isFlex = src.startsWith('flexibility-');
  if (!isFulcrum && !isFlex) return false;
  // 交换的两个位置：a/b（交换）或 order（重排 → 取发生变化的两处）
  let a = p.a;
  let b = p.b;
  if (a === undefined || b === undefined) {
    const order = p.order ?? [0, 1, 2];
    const changed = order.map((v, i) => (v === i ? -1 : i)).filter((i) => i >= 0);
    a = changed[0];
    b = changed[1];
  }
  if (a === undefined || b === undefined) return true; // 位置不明：仍算接管（不改动基础动画）
  const ra = protocolCellRect(p.player, a);
  const rb = protocolCellRect(p.player, b);
  if (!ra || !rb) return true;
  const l = layer('g3swap-layer', 620);

  if (isFulcrum) {
    // 支点：杠杆弧 + 两端砝码 + 刻度环亮圈
    const { d } = curveD(ra, rb, 0.2);
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'g3swap-arc');
    svg.setAttribute('viewBox', `0 0 ${window.innerWidth} ${window.innerHeight}`);
    for (const [cls, w, color] of [['g3swap-arc-glow', 9, '#d8f0ff'], ['', 2, '#2f7f8f']] as const) {
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', d);
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', color);
      path.setAttribute('stroke-width', String(w));
      if (cls) path.setAttribute('class', cls);
      svg.appendChild(path);
    }
    l.appendChild(svg);
    for (const [r, side] of [[ra, 'l'], [rb, 'r']] as const) {
      const w = el('i', `g3swap-weight ${side}`);
      w.style.left = `${r.left + r.width / 2 - 11}px`;
      w.style.top = `${r.top - 20}px`;
      l.appendChild(w);
    }
  } else {
    // 柔性：飘带连接两个协议位，两端各打一个结（结互相移动到对面再解开）
    const { d, x1, y1, x2, y2 } = curveD(ra, rb, 0.3);
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'g3swap-ribbon');
    svg.setAttribute('viewBox', `0 0 ${window.innerWidth} ${window.innerHeight}`);
    for (const [cls, w, color, op] of [['g3swap-ribbon-wide', 12, '#a86fd0', '0.32'], ['', 3, '#ffb0e0', '0.95']] as const) {
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', d);
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', color);
      path.setAttribute('stroke-width', String(w));
      path.setAttribute('stroke-linecap', 'round');
      path.setAttribute('opacity', op);
      if (cls) path.setAttribute('class', cls);
      svg.appendChild(path);
    }
    l.appendChild(svg);
    for (const [from, to, dir] of [[x1, y1, 1], [x2, y2, -1]] as const) {
      const knot = el('i', 'g3swap-knot');
      knot.style.left = `${from}px`;
      knot.style.top = `${from === x1 ? y1 : y2}px`;
      knot.style.setProperty('--dx', `${((from === x1 ? x2 : x1) - from).toFixed(1)}px`);
      knot.style.setProperty('--dy', `${((from === x1 ? y2 : y1) - (from === x1 ? y1 : y2)).toFixed(1)}px`);
      knot.style.animationDelay = `${dir > 0 ? 0 : 60}ms`;
      l.appendChild(knot);
    }
  }
  window.setTimeout(() => l.remove(), 1400);
  return true;
}
