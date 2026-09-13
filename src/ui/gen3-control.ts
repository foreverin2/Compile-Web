/**
 * 3 代（MN03/AX03）· 批次 D：**控制权族（C1~C6）+ 常驻层（5 个 sync + 贪婪1 硬币堆）**。
 *
 * 两类实现（设计稿 §2.2 硬约束）：
 *  - **瞬态**（一次性）：控制权变更 / 判定阶段 / 清缓存时刻 → body 级浮层，播完自清理；
 *  - **常驻**（持续生效中）：嫉妒0 / 愤怒0 / 怠惰0 / 惰性0·1 / 刚性7 / 色欲持有 → 每次渲染按
 *    当前状态增删，**层跨重渲染存活、绝不重建**（重建会重启动画，这是历史踩过的坑），
 *    并带"签名"短路：无变化时零开销。
 *
 * 层波段（设计稿 §2.3）：常驻层 z=46~49（同 1/2 代常驻层同级可见度，低于 hover 弹卡）；
 * 瞬态控制权层 z=620（与编译横幅同层，结果性信息优先）。
 */

import type { Card, GameState, Line, PlayerId } from '../core/models/types';
import { cardPointValue, getLineValue } from '../core/state/create';
import { cardCommandDisabled, isUncovered } from '../core/effects/context';
import { visibleRectOf } from './gen3-util';
import { protocolColorOf } from './protocol-colors';

/* ============================== 小工具 ============================== */

const Z_LINE = 46; // 链路级常驻层
const Z_CARD = 48; // 卡级常驻层
const Z_BADGE = 49; // 数值/标记
const Z_CTRL = 620; // 瞬态控制权层（与编译横幅同级）

function el(tag: string, cls: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** body 级满屏层（无 transform → 子元素 fixed 视口坐标不被破坏） */
function layer(cls: string, z: number): HTMLElement {
  const l = el('div', `${cls} g3fx-layer`);
  l.style.cssText = `position:fixed;left:0;top:0;width:100vw;height:100vh;pointer-events:none;z-index:${z};`;
  document.body.appendChild(l);
  return l;
}

function rectOf(node: HTMLElement): DOMRect | null {
  const r = node.getBoundingClientRect();
  return r.width === 0 || r.height === 0 ? null : r;
}

function cardNode(uid: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-uid="${uid}"]`);
}

function slotNode(player: PlayerId, line: Line): HTMLElement | null {
  return document.querySelector<HTMLElement>(`.stack-slot[data-player="${player}"][data-line="${line}"]`);
}

function batteryNode(player: PlayerId, line: Line): HTMLElement | null {
  // 能量槽（显示该线总值）是 .stack-slot[data-player][data-line] 的子元素（render.ts renderBattery）
  const slot = document.querySelector<HTMLElement>(`.stack-slot[data-player="${player}"][data-line="${line}"]`);
  return slot ? slot.querySelector<HTMLElement>('.battery') : null;
}

/** 取某玩家某链路的全部卡（含被盖） */
function stackOf(s: GameState, player: PlayerId, line: Line): Card[] {
  return s.players[player].stacks[line];
}

/** 该链路双方的卡片最大点数值（含被盖/反面；design §4.15 W4 口径） */
function maxPointBothSides(s: GameState, line: Line): number {
  let m = 0;
  for (const pid of [0, 1] as const) {
    for (const c of stackOf(s, pid, line)) m = Math.max(m, cardPointValue(s, c));
  }
  return m;
}

/** sloth-0 是否被一张**正面**怠惰牌覆盖（= 引擎 sloth0Modifier 的判定：相邻上方那张为正面怠惰牌。
 *  2026-09-13 审计：引擎要求覆盖者 faceUp（反面牌无协议信息），UI 漏了这一项 → 会多显示 +5/边框光。 */
function coveredBySlothCard(s: GameState, owner: PlayerId, line: Line, uid: string): string | null {
  const stack = stackOf(s, owner, line);
  const idx = stack.findIndex((c) => c.uid === uid);
  const above = idx === -1 ? undefined : stack[idx + 1];
  return above && above.faceUp && above.defId.startsWith('sloth-') ? above.uid : null;
}

/* ============================== 常驻层注册表 ============================== */

interface Rec {
  node: HTMLElement;
  sig: string;
}
const layerRecs = new Map<string, Rec>();

function ensure(key: string, cls: string, z: number): Rec {
  let rec = layerRecs.get(key);
  if (!rec) {
    rec = { node: layer(cls, z), sig: '' };
    layerRecs.set(key, rec);
  }
  return rec;
}

/** 条件消失 → 移除层并从注册表删除（避免残影）。
 *  2026-09-13：改为**先淡出再移除**（设计稿 §8.1 起止衔接：消失要有 0.15~0.3s 收束，禁止硬切）。
 *  注册表立刻删除 → 若条件在同一帧回来会新建一层，旧层由定时器自行收尾。 */
function drop(key: string): void {
  const rec = layerRecs.get(key);
  if (rec) {
    layerRecs.delete(key);
    rec.node.classList.add('g3sync-out');
    window.setTimeout(() => rec.node.remove(), 320);
  }
}

/** 统一清理：清掉本帧未被任何 sync 声明的层（各 sync 返回自己的 active 键，避免互相误删） */
function pruneAll(active: Set<string>): void {
  for (const key of [...layerRecs.keys()]) if (!active.has(key)) drop(key);
}

/** 应用内重置/新局：移除全部常驻层（resetUiState 调用） */
export function clearGen3Persistent(): void {
  for (const rec of layerRecs.values()) rec.node.remove();
  layerRecs.clear();
  greed1Stack.clear();
}

/** 把层定位到某个矩形（每次渲染都调用；层本身不重建） */
function place(node: HTMLElement | null, r: DOMRect | null, pad = 0): void {
  if (!node || !r) return;
  node.style.left = `${r.left - pad}px`;
  node.style.top = `${r.top - pad}px`;
  node.style.width = `${r.width + pad * 2}px`;
  node.style.height = `${r.height + pad * 2}px`;
}

/* ============================== 1. 嫉妒0 顶部（E1） ============================== */

/**
 * 此链路中，你的总阈值增加对手在此链路中最高阈值卡牌的阈值（对手全部卡，含被盖/反面）。
 * 常驻表现（与 1/2 代同级的可见度）：玉青"吸收格"（贴能量槽）+ 橙金汲取丝（从对手那张最大卡
 * 流向 envy-0 卡）+ `+N` 浮标 + 对手最大卡的橙环标记。
 */
export function syncEnvy0Absorb(s: GameState): string[] {
  const active = new Set<string>();
  for (const line of [0, 1, 2] as Line[]) {
    for (const owner of [0, 1] as PlayerId[]) {
      const envy0 = stackOf(s, owner, line).find(
        (c) => c.defId === 'envy-0' && c.faceUp && !cardCommandDisabled(s, c, 'top'),
      );
      if (!envy0) continue;
      const foe: PlayerId = owner === 0 ? 1 : 0;
      const foeCards = stackOf(s, foe, line);
      let best: Card | null = null;
      let bestV = 0;
      for (const c of foeCards) {
        const v = cardPointValue(s, c);
        if (v > bestV) { bestV = v; best = c; }
      }
      if (!best || bestV <= 0) continue; // +0 → 无表现
      const key = `envy0-${owner}-${line}`;
      active.add(key);
      const rec = ensure(key, 'g3sync-envy0', Z_LINE);
      const sig = `${best.uid}:${bestV}:${envy0.uid}`;
      const target = cardNode(envy0.uid);
      const source = cardNode(best.uid);
      const tr = target ? rectOf(target) : null;
      const sr = source ? rectOf(source) : null;
      const bat = batteryNode(owner, line);
      const br = bat ? rectOf(bat) : null;
      if (!tr) continue;
      // 只有"参与元素集合"变化才重建子节点；**位置每帧都重算**——2026-09-13 修复：
      // 旧版在 sig 相同时只重定位 thread/ticks，漏了 glow（卡面边框）/mark（源卡橙环）/badge（+N），
      // 结果滚动屏幕时这些会**粘在原来的屏幕坐标**不跟卡走（用户实测复现）。
      if (rec.sig !== sig) {
        rec.sig = sig;
        rec.node.textContent = '';
        // 2026-09-13（审计补漏）：三个"源卡相关"子件**无条件创建**——旧版写成 `if (sr) {...}`，
        // 若重建那一帧源卡 rect 取不到（刚重渲染/卡面图未加载）则这些节点永远不会出现，
        // 且签名不再变化 → 之后也无法补建（与"滚动后特效消失"同一类静默失效）。
        // 位置由 placeEnvy0 每帧算（它对 sr 为空已有守卫）。
        rec.node.appendChild(el('div', 'g3sync-envy0-thread'));
        rec.node.appendChild(el('i', 'g3sync-envy0-mark'));
        rec.node.appendChild(el('i', 'g3sync-envy0-borrow'));
        rec.node.appendChild(el('i', 'g3sync-envy0-glow'));
        rec.node.appendChild(el('i', 'g3sync-badge envy', `+${bestV}`));
        const ticks = el('div', 'g3sync-envy0-ticks');
        const n = Math.min(10, Math.max(2, bestV));
        for (let i = 0; i < n; i++) ticks.appendChild(el('i', 'g3sync-envy0-tick'));
        rec.node.appendChild(ticks);
      }
      placeEnvy0(rec.node, s, tr, sr, best.uid, br, bestV);
    }
  }
  return [...active];
}

/** 嫉妒0 子元素定位（**每帧都调用**，含滚动/缩放重定位） */
function placeEnvy0(
  node: HTMLElement,
  s: GameState,
  tr: DOMRect,
  sr: DOMRect | null,
  sourceUid: string,
  br: DOMRect | null,
  bestV: number,
): void {
  const thread = node.querySelector<HTMLElement>('.g3sync-envy0-thread');
  if (thread && sr) {
    // 2026-09-13：改为**卡片边缘 → 卡片边缘**（旧版中心到中心，长线横穿棋盘，像"怪线"）
    const sx = sr.left + sr.width / 2;
    const sy = sr.top + sr.height / 2;
    const tx = tr.left + tr.width / 2;
    const ty = tr.top + tr.height / 2;
    const dx = tx - sx;
    const dy = ty - sy;
    const dist = Math.max(1, Math.hypot(dx, dy));
    const ux = dx / dist;
    const uy = dy / dist;
    const sInset = (Math.min(sr.width, sr.height) / 2) * 0.85;
    const tInset = (Math.min(tr.width, tr.height) / 2) * 0.85;
    const x1 = sx + ux * sInset;
    const y1 = sy + uy * sInset;
    thread.style.left = `${x1}px`;
    thread.style.top = `${y1}px`;
    thread.style.width = `${Math.max(8, dist - sInset - tInset)}px`;
    thread.style.transform = `rotate(${Math.atan2(dy, dx)}rad)`;
  }
  // 源卡橙环 + "借 N" 小标（明确"这张卡被借走了阈值"，避免看不出这条线是什么）
  const mark = node.querySelector<HTMLElement>('.g3sync-envy0-mark');
  if (mark) place(mark, sr ? (visibleRectOf(s, sourceUid) ?? sr) : null, 3);
  const borrow = node.querySelector<HTMLElement>('.g3sync-envy0-borrow');
  if (borrow && sr) {
    borrow.textContent = `借 ${bestV}`;
    borrow.style.left = `${sr.left + sr.width - 6}px`;
    borrow.style.top = `${sr.bottom - 4}px`;
  }
  const glow = node.querySelector<HTMLElement>('.g3sync-envy0-glow');
  if (glow) place(glow, tr, 2);
  const badge = node.querySelector<HTMLElement>('.g3sync-badge.envy');
  if (badge) {
    badge.style.left = `${tr.right - 14}px`;
    badge.style.top = `${tr.top - 6}px`;
  }
  const ticks = node.querySelector<HTMLElement>('.g3sync-envy0-ticks');
  if (ticks && br) place(ticks, br, 4);
}

/* ============================== 2. 愤怒0 顶部（W4） ============================== */

/**
 * 全链最高点数值 M（双方合并、含被盖/反面）→ **该线中每一张点数值 == M 的卡（双方都算）**
 * 都不计入其拥有者总阈值。常驻表现：斜纹划除带 + 阈值数字变灰 + 双方能量槽"剔除框" + 中缝虚线。
 */
export function syncWrath0Cull(s: GameState): string[] {
  const active = new Set<string>();
  for (const line of [0, 1, 2] as Line[]) {
    const has = ([0, 1] as PlayerId[]).some((pid) =>
      stackOf(s, pid, line).some((c) => c.defId === 'wrath-0' && c.faceUp && !cardCommandDisabled(s, c, 'top')),
    );
    if (!has) continue;
    const m = maxPointBothSides(s, line);
    if (m <= 0) continue;
    const culled: Card[] = [];
    for (const pid of [0, 1] as const) {
      for (const c of stackOf(s, pid, line)) if (cardPointValue(s, c) === m) culled.push(c);
    }
    if (culled.length === 0) continue;
    const key = `wrath0-${line}`;
    active.add(key);
    const rec = ensure(key, 'g3sync-wrath0', Z_CARD);
    const sig = culled.map((c) => c.uid).join(',') + `|${m}`;
    // 只有"被剔除的卡集合"变化才重建；**位置每帧重算**（2026-09-13 修复：旧版漏了中缝虚线的重定位，
    // 滚动时会粘在屏幕原位）
    if (rec.sig !== sig) {
      rec.sig = sig;
      rec.node.textContent = '';
      for (const c of culled) {
        const band = el('i', 'g3sync-wrath0-band');
        band.dataset.band = c.uid;
        rec.node.appendChild(band);
      }
      rec.node.appendChild(el('i', 'g3sync-wrath0-seam'));
      rec.node.appendChild(el('i', 'g3sync-wrath0-chip', '最高档剔除'));
    }
    for (const c of culled) {
      const band = rec.node.querySelector<HTMLElement>(`[data-band="${c.uid}"]`);
      if (band) place(band, visibleRectOf(s, c.uid), 1);
    }
    // 中缝虚线 + 文字标（表示"这条线的最高档整条被划掉"）。
    // 2026-09-13 改进：旧版横跨【双方槽位并集】= 整行宽，看起来就是一条横在链路里的怪线；
    // 现在改为**只跨两条能量槽之间**、两端带箭头、中央挂「最高档剔除」文字标 → 一眼看懂是规则提示。
    const b0 = batteryNode(0, line);
    const b1 = batteryNode(1, line);
    const r0 = b0 ? rectOf(b0) : null;
    const r1 = b1 ? rectOf(b1) : null;
    const seam = rec.node.querySelector<HTMLElement>('.g3sync-wrath0-seam');
    const chip = rec.node.querySelector<HTMLElement>('.g3sync-wrath0-chip');
    if (seam) {
      let left: number;
      let right: number;
      let midY: number;
      if (r0 && r1) {
        const cx0 = r0.left + r0.width / 2;
        const cx1 = r1.left + r1.width / 2;
        left = Math.min(cx0, cx1) - 34;
        right = Math.max(cx0, cx1) + 34;
        midY = (r0.top + r0.height / 2 + r1.top + r1.height / 2) / 2;
      } else {
        const slotA = slotNode(0, line);
        const slotB = slotNode(1, line);
        const ra = slotA ? rectOf(slotA) : null;
        const rb = slotB ? rectOf(slotB) : null;
        if (!ra || !rb) continue;
        left = Math.min(ra.left, rb.left);
        right = Math.max(ra.right, rb.right);
        midY = (ra.top + ra.bottom + rb.top + rb.bottom) / 4;
      }
      seam.style.left = `${left}px`;
      seam.style.top = `${midY}px`;
      seam.style.width = `${Math.max(40, right - left)}px`;
      if (chip) {
        chip.style.left = `${(left + right) / 2}px`;
        chip.style.top = `${midY}px`;
      }
    }
  }
  return [...active];
}

/* ============================== 3. 怠惰0 顶部（S1） ============================== */

/** 被 1 张怠惰牌覆盖 → 你在此链路总阈值 +5。常驻：暖灰边框光 + `+5` 浮标 + 灰红涟漪 + 覆盖者连线。 */
export function syncSloth0Bonus(s: GameState): string[] {
  const active = new Set<string>();
  for (const line of [0, 1, 2] as Line[]) {
    for (const owner of [0, 1] as PlayerId[]) {
      for (const c of stackOf(s, owner, line)) {
        if (c.defId !== 'sloth-0' || !c.faceUp) continue;
        const coverUid = coveredBySlothCard(s, owner, line, c.uid);
        if (!coverUid) continue;
        const key = `sloth0-${c.uid}`;
        active.add(key);
        const rec = ensure(key, 'g3sync-sloth0', Z_CARD);
        const sig = `${coverUid}`;
        const self = cardNode(c.uid);
        const cover = cardNode(coverUid);
        const sr = self ? rectOf(self) : null;
        const cr = cover ? rectOf(cover) : null;
        if (!sr) continue;
        // 只有覆盖者变化才重建；**位置每帧重算**（2026-09-13 修复：旧版漏了涟漪的重定位）
        if (rec.sig !== sig) {
          rec.sig = sig;
          rec.node.textContent = '';
          rec.node.appendChild(el('i', 'g3sync-sloth0-glow'));
          rec.node.appendChild(el('i', 'g3sync-sloth0-ripple'));
          // 2026-09-13（审计补漏）：覆盖者连线**无条件创建**（旧版 `if (cr)` → 重建帧取不到
          // 覆盖者 rect 时该连线永不出现且无法补建）；位置每帧算，其中已对 cr 为空做了守卫。
          rec.node.appendChild(el('i', 'g3sync-sloth0-link'));
          rec.node.appendChild(el('i', 'g3sync-badge sloth', '+5'));
        }
        place(rec.node.querySelector<HTMLElement>('.g3sync-sloth0-glow'), sr, 2);
        place(rec.node.querySelector<HTMLElement>('.g3sync-sloth0-ripple'), sr, 6);
        const line2 = rec.node.querySelector<HTMLElement>('.g3sync-sloth0-link');
        if (line2 && cr) {
          const dx = cr.left + cr.width / 2 - (sr.left + sr.width / 2);
          const dy = cr.top + cr.height * 0.75 - (sr.top + sr.height * 0.25);
          line2.style.left = `${sr.left + sr.width / 2}px`;
          line2.style.top = `${sr.top + sr.height * 0.25}px`;
          line2.style.height = `${Math.hypot(dx, dy)}px`;
          line2.style.transform = `rotate(${Math.atan2(dy, dx) - Math.PI / 2}rad)`;
        }
        const badge = rec.node.querySelector<HTMLElement>('.g3sync-badge.sloth');
        if (badge) {
          badge.style.left = `${sr.right - 14}px`;
          badge.style.top = `${sr.top - 6}px`;
        }
      }
    }
  }
  return [...active];
}

/* ============================== 4. 惰性0 顶 / 惰性1 底（I3·I4） ============================== */

/**
 * 惰性0 顶：该线其他牌顶部指令无效 → 灰色断电栅格（逐卡）+ 链路灰白边框光 + 惰性0 静默标记。
 * 惰性1 底：该线其他牌底部指令无效（**仅当惰性1 为未覆盖顶卡**）→ 其他卡下缘灰条纹。
 */
export function syncInertiaNullify(s: GameState): string[] {
  const active = new Set<string>();
  for (const line of [0, 1, 2] as Line[]) {
    // 惰性0（被覆盖仍生效）
    const nulled = ([0, 1] as PlayerId[]).find((pid) =>
      stackOf(s, pid, line).some((c) => c.defId === 'inertia-0' && c.faceUp),
    );
    if (nulled !== undefined) {
      const key = `inertia0-${line}`;
      active.add(key);
      const rec = ensure(key, 'g3sync-inertia0', Z_CARD);
      const cards = ([0, 1] as PlayerId[]).flatMap((pid) => stackOf(s, pid, line)).filter((c) => c.defId !== 'inertia-0');
      const sig = cards.map((c) => c.uid).join(',');
      if (rec.sig !== sig) {
        rec.sig = sig;
        rec.node.textContent = '';
        // 2026-09-13（审计补漏）：栅格/自身光框**无条件创建**（旧版按 rect 是否为 null 决定是否创建
        // → 重建帧取不到 rect 的卡永远没有栅格，且签名不再变化无法补建）。位置统一在下面每帧算。
        for (const c of cards) {
          const grid = el('i', 'g3sync-inertia0-grid');
          grid.dataset.band = c.uid;
          rec.node.appendChild(grid);
        }
        rec.node.appendChild(el('i', 'g3sync-inertia0-field'));
      }
      for (const c of cards) {
        const node = cardNode(c.uid);
        const r = node ? rectOf(node) : null;
        const grid = rec.node.querySelector<HTMLElement>(`[data-band="${c.uid}"]`);
        if (grid && r) place(grid, r, 1);
      }
      {
        const self = stackOf(s, nulled, line).find((c) => c.defId === 'inertia-0');
        const sr = self ? (cardNode(self.uid)?.getBoundingClientRect() ?? null) : null;
        const ring = rec.node.querySelector<HTMLElement>('.g3sync-inertia0-field');
        if (ring && sr) place(ring, sr, 4);
      }
    }
    // 惰性1（须为未覆盖顶卡）
    const top = ([0, 1] as PlayerId[])
      .map((pid) => stackOf(s, pid, line).find((c) => c.defId === 'inertia-1' && c.faceUp && isUncovered(s, c)))
      .find((c) => !!c);
    if (top) {
      const key = `inertia1-${line}`;
      active.add(key);
      const rec = ensure(key, 'g3sync-inertia1', Z_CARD);
      const others = ([0, 1] as PlayerId[]).flatMap((pid) => stackOf(s, pid, line)).filter((c) => c.uid !== top.uid);
      const sig = others.map((c) => c.uid).join(',');
      if (rec.sig !== sig) {
        rec.sig = sig;
        rec.node.textContent = '';
        // 2026-09-13（审计补漏）：同上——条纹与自身下缘粗灰边无条件创建，位置每帧算
        for (const c of others) {
          const stripe = el('i', 'g3sync-inertia1-stripe');
          stripe.dataset.band = c.uid;
          rec.node.appendChild(stripe);
        }
        rec.node.appendChild(el('i', 'g3sync-inertia1-edge'));
      }
      for (const c of others) {
        const node = cardNode(c.uid);
        const r = node ? rectOf(node) : null;
        const stripe = rec.node.querySelector<HTMLElement>(`[data-band="${c.uid}"]`);
        if (stripe && r) place(stripe, r, 1);
      }
      {
        const self = cardNode(top.uid);
        const sr = self ? rectOf(self) : null;
        const edge = rec.node.querySelector<HTMLElement>('.g3sync-inertia1-edge');
        if (edge && sr) place(edge, sr, 3);
      }
    }
  }
  return [...active];
}

/* ============================== 5. 刚性7 底部（Y2） ============================== */

/** 此牌不能被翻转或偏转（正面且未被覆盖）→ 荧光黄迷宫纹 + 四角锚钉 + 紫光呼吸；免疫时闪亮 + 锚钉震动。 */
export function syncRigidity7Guard(s: GameState): string[] {
  const active = new Set<string>();
  for (const pid of [0, 1] as PlayerId[]) {
    for (const stack of s.players[pid].stacks) {
      for (const c of stack) {
        if (c.defId !== 'rigidity-7') continue;
        if (!(c.faceUp && isUncovered(s, c) && !cardCommandDisabled(s, c, 'bottom'))) continue;
        const key = `rig7-${c.uid}`;
        active.add(key);
        const rec = ensure(key, 'g3sync-rig7', Z_CARD);
        const node = cardNode(c.uid);
        const r = node ? rectOf(node) : null;
        if (!r) continue;
        if (rec.sig !== 'on') {
          rec.sig = 'on';
          rec.node.textContent = '';
          const maze = el('i', 'g3sync-rig7-maze');
          rec.node.appendChild(maze);
          const shield = el('i', 'g3sync-rig7-shield');
          rec.node.appendChild(shield);
          for (const pos of ['tl', 'tr', 'bl', 'br'] as const) rec.node.appendChild(el('i', `g3sync-rig7-anchor ${pos}`));
        }
        place(rec.node.querySelector<HTMLElement>('.g3sync-rig7-maze')!, r, 3);
        place(rec.node.querySelector<HTMLElement>('.g3sync-rig7-shield')!, r, 2);
        const anchors = rec.node.querySelectorAll<HTMLElement>('.g3sync-rig7-anchor');
        const corners: [number, number][] = [
          [r.left - 4, r.top - 4], [r.right - 5, r.top - 4], [r.left - 4, r.bottom - 5], [r.right - 5, r.bottom - 5],
        ];
        anchors.forEach((a, i) => {
          a.style.left = `${corners[i][0]}px`;
          a.style.top = `${corners[i][1]}px`;
        });
      }
    }
  }
  return [...active];
}

/** 免疫反馈（card:immune 事件）：迷宫纹闪亮 + 锚钉震动 0.35s */
export function flashRigidity7Guard(uid: string): void {
  const rec = layerRecs.get(`rig7-${uid}`);
  if (!rec) return;
  rec.node.classList.remove('immune');
  void rec.node.offsetWidth;
  rec.node.classList.add('immune');
  window.setTimeout(() => rec.node.classList.remove('immune'), 420);
}

/* ============================== 6. 色欲持有中 / 禁编译（C3·C6） ============================== */

/** C3 持有中：持有者一侧常驻红色牵引环 + 组件徽标；C6：持有者未覆盖正面 lust-0 → 对手协议区暗紫封条。 */
export function syncLustHold(s: GameState): string[] {
  const active = new Set<string>();
  if (s.control === 0 || s.control === 1) {
    const holder = s.control;
    const mod = document.querySelector<HTMLElement>('.control-module');
    const img = document.querySelector<HTMLElement>('.control-slider-img');
    const r = img ? rectOf(img) : mod ? rectOf(mod) : null;
    if (r) {
      const key = 'lusthold';
      active.add(key);
      const rec = ensure(key, 'g3sync-lusthold', Z_LINE);
      if (rec.sig !== `${holder}`) {
        rec.sig = `${holder}`;
        rec.node.textContent = '';
        rec.node.appendChild(el('i', 'g3sync-lusthold-ring'));
        rec.node.appendChild(el('i', 'g3sync-lusthold-chain'));
        const badge = el('i', 'g3sync-badge lust', holder === 0 ? 'P1' : 'P2');
        rec.node.appendChild(badge);
      }
      place(rec.node.querySelector<HTMLElement>('.g3sync-lusthold-ring')!, r, 8);
      place(rec.node.querySelector<HTMLElement>('.g3sync-lusthold-chain')!, r, 4);
      const badge = rec.node.querySelector<HTMLElement>('.g3sync-badge.lust');
      if (badge) { badge.style.left = `${r.left + r.width / 2 - 10}px`; badge.style.top = `${r.top - 14}px`; }
    }
    // C6：禁编译（持有者场上有未覆盖正面 lust-0）
    const blocks = s.players[holder].stacks.some((st) =>
      st.some((c) => c.defId === 'lust-0' && c.faceUp && isUncovered(s, c)),
    );
    if (blocks) {
      const foe: PlayerId = holder === 0 ? 1 : 0;
      const key = `lustblock-${foe}`;
      active.add(key);
      const rec = ensure(key, 'g3sync-lustblock', Z_LINE);
      if (rec.sig !== 'on') {
        rec.sig = 'on';
        rec.node.textContent = '';
        for (let line = 0; line < 3; line++) {
          const seal = el('i', 'g3sync-lustblock-seal');
          seal.dataset.band = String(line);
          rec.node.appendChild(seal);
        }
      }
      for (let line = 0; line < 3; line++) {
        const cell = document.querySelector<HTMLElement>(`.protocol-cell[data-player="${foe}"][data-line="${line}"]`);
        const cr = cell ? rectOf(cell) : null;
        const seal = rec.node.querySelector<HTMLElement>(`[data-band="${line}"]`);
        if (seal && cr) place(seal, cr, 3);
      }
    }
  }
  return [...active];
}

/* ============================== 7. 贪婪1 硬币堆（R2 ④） ============================== */

/** 贪婪1 每次触发编译 → 该卡上硬币堆永久 +1 级（≤3） */
const greed1Stack = new Map<string, number>();

/** line:compiled 且 sourceDefId='greed-1' 时调用（fx-gen3.ts 的 gen3CompiledFx 内） */
export function noteGreed1Compile(sourceUid?: string): void {
  if (!sourceUid) return;
  const cur = greed1Stack.get(sourceUid) ?? 0;
  greed1Stack.set(sourceUid, Math.min(3, cur + 1));
}

/** 常驻：把硬币堆等级画在贪婪1 卡上（等级 0 不画；卡离场即清理） */
export function syncGreed1Stack(s: GameState): string[] {
  const active = new Set<string>();
  const onField = new Set<string>();
  for (const pid of [0, 1] as PlayerId[]) {
    for (const stack of s.players[pid].stacks) for (const c of stack) onField.add(c.uid);
  }
  for (const uid of [...greed1Stack.keys()]) if (!onField.has(uid)) greed1Stack.delete(uid);
  for (const [uid, lvl] of greed1Stack) {
    if (lvl <= 0) continue;
    const node = cardNode(uid);
    const r = node ? rectOf(node) : null;
    if (!r) continue;
    const key = `greed1stack-${uid}`;
    active.add(key);
    const rec = ensure(key, 'g3sync-greed1', Z_BADGE);
    if (rec.sig !== String(lvl)) {
      rec.sig = String(lvl);
      rec.node.textContent = '';
      const wrap = el('div', 'g3sync-greed1-stack');
      for (let i = 0; i < lvl; i++) wrap.appendChild(el('i', 'g3sync-greed1-coin'));
      rec.node.appendChild(wrap);
      const badge = el('i', 'g3sync-badge greed', `×${lvl}`);
      rec.node.appendChild(badge);
    }
    const wrap = rec.node.querySelector<HTMLElement>('.g3sync-greed1-stack');
    if (wrap) {
      wrap.style.left = `${r.left + 4}px`;
      wrap.style.top = `${r.top + 4}px`;
    }
    const badge = rec.node.querySelector<HTMLElement>('.g3sync-badge.greed');
    if (badge) {
      badge.style.left = `${r.left + 4}px`;
      badge.style.top = `${r.bottom - 18}px`;
    }
  }
  return [...active];
}


/** 每次渲染末尾调用（render.ts）：全部 3代 常驻层 */
export function syncGen3Persistent(s: GameState): void {
  const active = new Set<string>([
    ...syncEnvy0Absorb(s),
    ...syncWrath0Cull(s),
    ...syncSloth0Bonus(s),
    ...syncInertiaNullify(s),
    ...syncRigidity7Guard(s),
    ...syncLustHold(s),
    ...syncGreed1Stack(s),
  ]);
  pruneAll(active);
}

/* ============================== 瞬态：控制权族 C1·C2·C4·C5 ============================== */

function controlImgRect(): DOMRect | null {
  const img = document.querySelector<HTMLElement>('.control-slider-img');
  const mod = document.querySelector<HTMLElement>('.control-module');
  return img ? rectOf(img) : mod ? rectOf(mod) : null;
}

/**
 * 2026-09-13 用户清单 #1（"特效粘在屏幕固定位置"的一种形态）：控制组件卡本身在 `.control-track` 上
 * **滑动**（render.ts 按 CONTROL_EDGE_PCT=4% 把它推向持有者一侧），所以"组件被拉走后的落点"必须
 * **按轨道实测矩形**算，而不是拿视口 22%/78% 猜——否则窗口尺寸/布局一变，落点就和组件真实位置错位。
 */
function controlTrackSideX(to: PlayerId): number | null {
  const track = document.querySelector<HTMLElement>('.control-track');
  const r = track ? rectOf(track) : null;
  if (!r) return null;
  // 与 render.ts 一致：P1 贴左端 4%、P2 贴右端 96%
  const pct = to === 0 ? 0.04 : 0.96;
  return r.left + r.width * pct;
}

/**
 * 2026-09-13 用户清单 #8：控制权"牵引链"是**色欲**的视觉语法（色欲 = 控制控制权）。
 * 只有**色欲卡效果**引发的变更才播链条/断链/幽灵飞卡；判定阶段或其他协议（嫉妒1/新星2/愤怒1·4）
 * 造成的易主只播轻量提示（组件脉冲 + 文字标）——用户实测反馈"没打色欲也每次判定都蹦链条"。
 * 判定依据：引擎 `control:changed` 载荷新增的 `sourceDefId`（setControl 第 4 参）。
 */
function lustDrivenControl(p: { reason?: string; sourceDefId?: string }): boolean {
  return p.reason === 'effect' && (p.sourceDefId ?? '').startsWith('lust-');
}

/** C1/C2 轻量版：不牵链条，只在组件卡新位置播脉冲 + 文字标（判定阶段/其他协议的易主）。
 *  2026-09-13：颜色取**效果源卡协议**的主题色（如嫉妒1 底易主 = 玉青/橙），判定阶段（无源卡）用中性灰——
 *  这样既满足用户 #8「只有色欲才牵链条」，又保留了设计稿 E2② 那种"有来源的易主要能看出是谁做的"。 */
function controlMiniFx(p: { from: number; to: number; reason?: string; sourceDefId?: string }, cx: number, cy: number, x: number): void {
  const l = layer('g3ctrl-layer', Z_CTRL);
  const color = p.sourceDefId ? protocolColorOf(p.sourceDefId) : '#b4bac4';
  const pulse = el('i', 'g3ctrl-mini-pulse');
  pulse.style.left = `${x}px`;
  pulse.style.top = `${cy}px`;
  pulse.style.setProperty('--mc', color);
  l.appendChild(pulse);
  const gained = p.to === 0 || p.to === 1;
  const chip = el('i', 'g3ctrl-mini-chip', gained ? `控制组件 → P${p.to + 1}` : '控制组件归还中立');
  chip.style.left = `${x}px`;
  chip.style.top = `${cy - 54}px`;
  chip.style.setProperty('--mc', color);
  chip.style.animationDelay = '120ms';
  l.appendChild(chip);
  void cx;
  window.setTimeout(() => l.remove(), 900);
}

/** C1/C2/C5：控制权变更（获得 = 牵引链拉来 / 失去 = 链断 / 归还中立） */
export function gen3ControlChangedFx(
  p: { from: number; to: number; reason?: string; sourceDefId?: string },
  s: GameState,
): void {
  const r = controlImgRect();
  if (!r) return;
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;

  if (p.to === 0 || p.to === 1) {
    // 落点 = 轨道上"持有者一侧"的实测位置（#1：不再用视口百分比猜）
    const targetX = controlTrackSideX(p.to) ?? (p.to === 0 ? Math.max(80, window.innerWidth * 0.22) : Math.min(window.innerWidth - 80, window.innerWidth * 0.78));
    // #8：非色欲驱动的易主 → 只播轻量提示（不牵链条、不飞幽灵卡）
    if (!lustDrivenControl(p)) {
      controlMiniFx(p, cx, cy, targetX);
      return;
    }
    const l = layer('g3ctrl-layer', Z_CTRL);
    // 获得：组件卡幽灵沿弧线飞到新持有者一侧 + 3 节红色牵引链 + 落位脉冲/冲击环
    const ghost = el('div', 'g3ctrl-ghost');
    ghost.style.left = `${cx - 24}px`;
    ghost.style.top = `${cy - 32}px`;
    ghost.appendChild(el('i', 'g3ctrl-ghost-face'));
    l.appendChild(ghost);
    for (let i = 0; i < 3; i++) {
      const link = el('i', 'g3ctrl-link');
      link.style.left = `${cx}px`;
      link.style.top = `${cy}px`;
      link.style.setProperty('--tx', `${(targetX - cx).toFixed(1)}px`);
      link.style.animationDelay = `${(i * 70).toFixed(0)}ms`;
      l.appendChild(link);
    }
    void ghost.offsetWidth;
    ghost.style.transform = `translate(${targetX - cx}px, 0) scale(1.06)`;
    const pulse = el('i', 'g3ctrl-pulse');
    pulse.style.left = `${targetX}px`;
    pulse.style.top = `${cy}px`;
    pulse.style.animationDelay = '560ms';
    l.appendChild(pulse);
    // C5：对手获得控制权后 → 场上 lust-4 底 / pride-6 顶 卡面红徽记 + 组件向该卡扩散波纹
    const triggerCards: Card[] = [];
    for (const pid of [0, 1] as PlayerId[]) {
      for (const stack of s.players[pid].stacks) {
        for (const c of stack) {
          if (!c.faceUp) continue;
          if (c.defId === 'lust-4' || c.defId === 'pride-6') triggerCards.push(c);
        }
      }
    }
    for (const [i, c] of triggerCards.entries()) {
      const node = cardNode(c.uid);
      const cr = node ? rectOf(node) : null;
      if (!cr) continue;
      const emblem = el('i', 'g3ctrl-emblem');
      place(emblem, cr, 2);
      emblem.style.animationDelay = `${(120 + i * 90).toFixed(0)}ms`;
      l.appendChild(emblem);
      const wave = el('i', 'g3ctrl-wave');
      wave.style.left = `${cx}px`;
      wave.style.top = `${cy}px`;
      wave.style.setProperty('--dx', `${(cr.left + cr.width / 2 - cx).toFixed(1)}px`);
      wave.style.setProperty('--dy', `${(cr.top + cr.height / 2 - cy).toFixed(1)}px`);
      wave.style.animationDelay = `${(160 + i * 90).toFixed(0)}ms`;
      l.appendChild(wave);
    }
    window.setTimeout(() => l.remove(), 1500);
    return;
  }

  // 失去/归还中立：3 节链条依次崩断 + 暗紫余温（留在原持有者一侧）
  const side = (p.from === 0 || p.from === 1 ? controlTrackSideX(p.from) : null)
    ?? (p.from === 0 ? Math.max(60, window.innerWidth * 0.18) : Math.min(window.innerWidth - 60, window.innerWidth * 0.82));
  if (!lustDrivenControl(p)) {
    controlMiniFx(p, cx, cy, p.from === 0 || p.from === 1 ? side : cx);
    return;
  }
  const l = layer('g3ctrl-layer', Z_CTRL);
  for (let i = 0; i < 3; i++) {
    const link = el('i', 'g3ctrl-link break');
    link.style.left = `${(side + cx) / 2}px`;
    link.style.top = `${cy + (i - 1) * 9}px`;
    link.style.setProperty('--tx', `${((i - 1) * 16).toFixed(1)}px`);
    link.style.animationDelay = `${(i * 90).toFixed(0)}ms`;
    l.appendChild(link);
  }
  const after = el('i', 'g3ctrl-afterglow');
  after.style.left = `${side - 40}px`;
  after.style.top = `${cy - 60}px`;
  l.appendChild(after);
  const fallback = el('i', 'g3ctrl-ghost drift');
  fallback.style.left = `${cx - 24}px`;
  fallback.style.top = `${cy - 32}px`;
  fallback.appendChild(el('i', 'g3ctrl-ghost-face'));
  l.appendChild(fallback);
  void fallback.offsetWidth;
  fallback.style.transform = `translate(${(window.innerWidth / 2 - cx).toFixed(1)}px, 0) scale(0.92)`;
  window.setTimeout(() => l.remove(), 1500);
}

/**
 * C4：控制权判定阶段。
 * 2026-09-13 重做（用户实测反馈"每回合链路蹦出奇怪粗线条"）：旧版把 14px 高的对比条**横铺整条
 * `.stack-slot`** 且没有任何文字 → 看起来就是一条横在卡上的怪线。现在改为：
 *  - 对比条**贴在双方能量槽（数值显示）正下方**，宽度≈能量槽宽（短条，不再横跨链路）；
 *  - 条上带 `你/对手` 双色填充 + 分隔线 + 扫描线，旁边有"控制权判定"标题；
 *  - 判定结果用文字明确给出：`获得控制组件` / `未满足 2 条线领先`（Q5 判定失败也要有反馈）；
 *  - 领先的两条线能量槽加金色光圈，让"哪两条线领先"一眼可见。
 */
export function gen3ControlCheckFx(
  p: { player: PlayerId; wins: number; leading: Line[]; gained: boolean },
  s: GameState,
): void {
  const l = layer('g3ctrl-check-layer', Z_CTRL);
  const foe: PlayerId = p.player === 0 ? 1 : 0;
  const leading = new Set(p.leading);
  // 标题 + 结果（挂在控制组件上方，避免"凭空出现"）
  const mod = document.querySelector<HTMLElement>('.control-module');
  const mr = mod ? rectOf(mod) : null;
  const capX = mr ? mr.left + mr.width / 2 : window.innerWidth / 2;
  const capY = mr ? mr.top - 26 : 40;
  const caption = el('div', 'g3ctrl-caption', `控制权判定 · P${p.player + 1}`);
  caption.style.left = `${capX}px`;
  caption.style.top = `${capY}px`;
  l.appendChild(caption);
  const result = el('div', `g3ctrl-result ${p.gained ? 'ok' : 'no'}`, p.gained ? '获得控制组件' : `未满足（领先 ${p.wins} 条，需 2 条）`);
  result.style.left = `${capX}px`;
  result.style.top = `${capY}px`;
  result.style.animationDelay = '620ms';
  l.appendChild(result);

  for (const line of [0, 1, 2] as Line[]) {
    const own = getLineValue(s, p.player, line);
    const opp = getLineValue(s, foe, line);
    const total = Math.max(1, own + opp);
    const lead = leading.has(line);
    // 对比条贴在该线【己方能量槽】下方（宽度≈能量槽 → 短条、有归属感）
    const mine = batteryNode(p.player, line);
    const mineR = mine ? rectOf(mine) : null;
    const anchor = mineR
      ?? (() => { const sl = slotNode(p.player, line); return sl ? rectOf(sl) : null; })();
    if (!anchor) continue;
    const barW = Math.max(64, Math.min(150, anchor.width));
    const cmp = el('div', `g3ctrl-cmp${lead ? ' lead' : ''}${p.gained ? '' : ' failed'}`);
    cmp.style.left = `${anchor.left + anchor.width / 2 - barW / 2}px`;
    cmp.style.top = `${anchor.bottom + 5}px`;
    cmp.style.width = `${barW}px`;
    const ownFill = el('i', 'g3ctrl-cmp-own');
    ownFill.style.width = `${((own / total) * 100).toFixed(1)}%`;
    const oppFill = el('i', 'g3ctrl-cmp-opp');
    oppFill.style.width = `${((opp / total) * 100).toFixed(1)}%`;
    cmp.appendChild(ownFill);
    cmp.appendChild(oppFill);
    cmp.appendChild(el('i', 'g3ctrl-cmp-scan'));
    l.appendChild(cmp);
    // 数值（贴在条两端，明确"这是数值对比"）
    const ownNum = el('i', 'g3ctrl-cmp-num own', String(own));
    ownNum.style.left = `${anchor.left + anchor.width / 2 - barW / 2 - 16}px`;
    ownNum.style.top = `${anchor.bottom + 6}px`;
    l.appendChild(ownNum);
    const oppNum = el('i', 'g3ctrl-cmp-num opp', String(opp));
    oppNum.style.left = `${anchor.left + anchor.width / 2 + barW / 2 + 4}px`;
    oppNum.style.top = `${anchor.bottom + 6}px`;
    l.appendChild(oppNum);
    // 领先线：双方能量槽加金圈
    if (lead) {
      for (const pid of [p.player, foe] as PlayerId[]) {
        const bn = batteryNode(pid, line);
        const br = bn ? rectOf(bn) : null;
        if (!br) continue;
        const ring = el('i', 'g3ctrl-lead-ring');
        place(ring, br, 4);
        l.appendChild(ring);
      }
    }
  }
  window.setTimeout(() => l.remove(), 1250);
}

/** 清缓存时刻（rule:clear-cache）：**清缓存那位玩家**场上有未覆盖正面 gluttony-0 → 齿颚咬合（G1"咬合时刻"）。
 *  2026-09-13 审计修复：此前忽略 payload.player，扫全场取第一个 gluttony-0 → 对方清缓存时会在**你的**
 *  gluttony-0 上咬一口（位置/归属都错）。 */
export function gen3ClearCacheFx(p: { player: PlayerId; count: number }, s: GameState): void {
  const own = s.players[p.player].stacks.flat();
  const gluttony0 = own.find((c) => c.defId === 'gluttony-0' && c.faceUp && isUncovered(s, c));
  const node = gluttony0 ? cardNode(gluttony0.uid) : null;
  const r = node ? rectOf(node) : null;
  if (!r) return;
  const l = layer('g3clear-cache-layer', Z_CTRL);
  const host = el('div', 'g3clear-jaws');
  place(host, r, 0);
  for (const side of ['top', 'bottom'] as const) {
    const jaw = el('div', `g3clear-jaw ${side}`);
    for (let i = 0; i < 5; i++) {
      const t = el('i', 'g3clear-tooth');
      t.style.left = `${6 + i * 18.5}%`;
      jaw.appendChild(t);
    }
    host.appendChild(jaw);
  }
  const flash = el('i', 'g3clear-flash');
  host.appendChild(flash);
  l.appendChild(host);
  window.setTimeout(() => l.remove(), 900);
}
