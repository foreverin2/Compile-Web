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
  // 能量槽（显示该线总值）在 .battery[data-points]；玩家/线序由渲染顺序决定 → 用行容器定位
  const row = document.querySelector<HTMLElement>(`.line-row[data-line="${line}"]`) ?? document.body;
  const list = row.querySelectorAll<HTMLElement>('.battery');
  if (list.length >= 2) return player === 0 ? list[0] : list[1];
  return list[0] ?? null;
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

/** sloth-0 是否被一张怠惰牌覆盖（= 引擎 sloth0Modifier 的判定：相邻上方那张为怠惰牌） */
function coveredBySlothCard(s: GameState, owner: PlayerId, line: Line, uid: string): string | null {
  const stack = stackOf(s, owner, line);
  const idx = stack.findIndex((c) => c.uid === uid);
  const above = idx === -1 ? undefined : stack[idx + 1];
  return above && above.defId.startsWith('sloth-') ? above.uid : null;
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

/** 条件消失 → 移除层并从注册表删除（避免残影） */
function drop(key: string): void {
  const rec = layerRecs.get(key);
  if (rec) {
    rec.node.remove();
    layerRecs.delete(key);
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
      if (rec.sig === sig) {
        // 只重定位（层不重建 → 呼吸/流动动画不重启）
        if (sr) place(rec.node.querySelector<HTMLElement>('.g3sync-envy0-thread')!, sr, 0);
        if (br) place(rec.node.querySelector<HTMLElement>('.g3sync-envy0-ticks')!, br, 4);
        continue;
      }
      rec.sig = sig;
      rec.node.textContent = '';
      // 汲取丝：从对手最大卡 → envy-0 卡（用一条渐细的斜向光带表示，方向由两端矩形算出）
      if (sr) {
        const thread = el('div', 'g3sync-envy0-thread');
        const dx = tr.left + tr.width / 2 - (sr.left + sr.width / 2);
        const dy = tr.top + tr.height / 2 - (sr.top + sr.height / 2);
        thread.style.left = `${sr.left + sr.width / 2}px`;
        thread.style.top = `${sr.top + sr.height / 2}px`;
        thread.style.width = `${Math.hypot(dx, dy)}px`;
        thread.style.transform = `rotate(${Math.atan2(dy, dx)}rad)`;
        rec.node.appendChild(thread);
        // 源卡标记（橙环）：被盖卡只标露出可见区域
        const mark = el('i', 'g3sync-envy0-mark');
        place(mark, visibleRectOf(s, best.uid) ?? sr, 3);
        rec.node.appendChild(mark);
      }
      // 卡面玉青光 + `+N`
      const glow = el('i', 'g3sync-envy0-glow');
      place(glow, tr, 2);
      rec.node.appendChild(glow);
      const badge = el('i', 'g3sync-badge envy', `+${bestV}`);
      badge.style.left = `${tr.right - 14}px`;
      badge.style.top = `${tr.top - 6}px`;
      rec.node.appendChild(badge);
      // 能量槽吸收格
      if (br) {
        const ticks = el('div', 'g3sync-envy0-ticks');
        const n = Math.min(10, Math.max(2, bestV));
        for (let i = 0; i < n; i++) ticks.appendChild(el('i', 'g3sync-envy0-tick'));
        place(ticks, br, 4);
        rec.node.appendChild(ticks);
      }
    }
  }
  return [...active];
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
    if (rec.sig === sig) {
      // 只重定位既有划除带
      for (const c of culled) {
        const band = rec.node.querySelector<HTMLElement>(`[data-band="${c.uid}"]`);
        const r = visibleRectOf(s, c.uid);
        if (band && r) place(band, r, 1);
      }
      continue;
    }
    rec.sig = sig;
    rec.node.textContent = '';
    for (const c of culled) {
      const r = visibleRectOf(s, c.uid);
      if (!r) continue;
      const band = el('i', 'g3sync-wrath0-band');
      band.dataset.band = c.uid;
      place(band, r, 1);
      rec.node.appendChild(band);
    }
    // 中缝虚线（表示"这条线的最高档整条被划掉"）
    const slotA = slotNode(0, line);
    const slotB = slotNode(1, line);
    const ra = slotA ? rectOf(slotA) : null;
    const rb = slotB ? rectOf(slotB) : null;
    if (ra && rb) {
      const seam = el('i', 'g3sync-wrath0-seam');
      const top = Math.min(ra.top, rb.top);
      const bottom = Math.max(ra.bottom, rb.bottom);
      seam.style.left = `${Math.min(ra.left, rb.left)}px`;
      seam.style.top = `${(top + bottom) / 2}px`;
      seam.style.width = `${Math.max(ra.right, rb.right) - Math.min(ra.left, rb.left)}px`;
      rec.node.appendChild(seam);
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
        if (rec.sig === sig) {
          place(rec.node.querySelector<HTMLElement>('.g3sync-sloth0-glow')!, sr, 2);
          const line2 = rec.node.querySelector<HTMLElement>('.g3sync-sloth0-link');
          if (line2 && cr) {
            const dx = cr.left + cr.width / 2 - (sr.left + sr.width / 2);
            const dy = cr.top + cr.height * 0.75 - (sr.top + sr.height * 0.25);
            line2.style.left = `${sr.left + sr.width / 2}px`;
            line2.style.top = `${sr.top + sr.height * 0.25}px`;
            line2.style.height = `${Math.hypot(dx, dy)}px`;
            line2.style.transform = `rotate(${Math.atan2(dy, dx) - Math.PI / 2}rad)`;
          }
          const badge2 = rec.node.querySelector<HTMLElement>('.g3sync-badge.sloth');
          if (badge2) { badge2.style.left = `${sr.right - 14}px`; badge2.style.top = `${sr.top - 6}px`; }
          continue;
        }
        rec.sig = sig;
        rec.node.textContent = '';
        const glow = el('i', 'g3sync-sloth0-glow');
        place(glow, sr, 2);
        rec.node.appendChild(glow);
        const ripple = el('i', 'g3sync-sloth0-ripple');
        place(ripple, sr, 6);
        rec.node.appendChild(ripple);
        if (cr) {
          const link = el('i', 'g3sync-sloth0-link');
          rec.node.appendChild(link);
        }
        const badge = el('i', 'g3sync-badge sloth', '+5');
        badge.style.left = `${sr.right - 14}px`;
        badge.style.top = `${sr.top - 6}px`;
        rec.node.appendChild(badge);
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
        for (const c of cards) {
          const node = cardNode(c.uid);
          const r = node ? rectOf(node) : null;
          if (!r) continue;
          const grid = el('i', 'g3sync-inertia0-grid');
          grid.dataset.band = c.uid;
          place(grid, r, 1);
          rec.node.appendChild(grid);
        }
        const self = stackOf(s, nulled, line).find((c) => c.defId === 'inertia-0');
        const sr = self ? (cardNode(self.uid)?.getBoundingClientRect() ?? null) : null;
        const slot = slotNode(nulled, line);
        if (sr && slot) {
          const ring = el('i', 'g3sync-inertia0-field');
          place(ring, sr, 4);
          rec.node.appendChild(ring);
        }
      } else {
        for (const c of cards) {
          const node = cardNode(c.uid);
          const r = node ? rectOf(node) : null;
          const grid = rec.node.querySelector<HTMLElement>(`[data-band="${c.uid}"]`);
          if (grid && r) place(grid, r, 1);
        }
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
        for (const c of others) {
          const node = cardNode(c.uid);
          const r = node ? rectOf(node) : null;
          if (!r) continue;
          const stripe = el('i', 'g3sync-inertia1-stripe');
          stripe.dataset.band = c.uid;
          place(stripe, r, 1);
          rec.node.appendChild(stripe);
        }
        const self = cardNode(top.uid);
        const sr = self ? rectOf(self) : null;
        if (sr) {
          const edge = el('i', 'g3sync-inertia1-edge');
          place(edge, sr, 3);
          rec.node.appendChild(edge);
        }
      } else {
        for (const c of others) {
          const node = cardNode(c.uid);
          const r = node ? rectOf(node) : null;
          const stripe = rec.node.querySelector<HTMLElement>(`[data-band="${c.uid}"]`);
          if (stripe && r) place(stripe, r, 1);
        }
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

/** C1/C2/C5：控制权变更（获得 = 牵引链拉来 / 失去 = 链断 / 归还中立） */
export function gen3ControlChangedFx(
  p: { from: number; to: number; reason?: string },
  s: GameState,
): void {
  const r = controlImgRect();
  if (!r) return;
  const l = layer('g3ctrl-layer', Z_CTRL);
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;

  if (p.to === 0 || p.to === 1) {
    // 获得：组件卡幽灵沿弧线飞到新持有者一侧 + 3 节红色牵引链 + 落位脉冲/冲击环
    const targetX = p.to === 0 ? Math.max(80, window.innerWidth * 0.22) : Math.min(window.innerWidth - 80, window.innerWidth * 0.78);
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
  const side = p.from === 0 ? Math.max(60, window.innerWidth * 0.18) : Math.min(window.innerWidth - 60, window.innerWidth * 0.82);
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

/** C4：控制权判定阶段（三条线对比条自中间向两侧扫描；满足→领先两条亮起，未满足→整体暗下+抖动） */
export function gen3ControlCheckFx(
  p: { player: PlayerId; wins: number; leading: Line[]; gained: boolean },
  s: GameState,
): void {
  const l = layer('g3ctrl-check-layer', Z_CTRL);
  const foe: PlayerId = p.player === 0 ? 1 : 0;
  const leading = new Set(p.leading);
  for (const line of [0, 1, 2] as Line[]) {
    const slot = slotNode(p.player, line);
    const r = slot ? rectOf(slot) : null;
    if (!r) continue;
    const own = getLineValue(s, p.player, line);
    const opp = getLineValue(s, foe, line);
    const total = Math.max(1, own + opp);
    const bar = el('div', `g3ctrl-bar${leading.has(line) ? ' lead' : ''}${p.gained ? '' : ' failed'}`);
    bar.style.left = `${r.left - 6}px`;
    bar.style.top = `${r.top + r.height / 2 - 7}px`;
    bar.style.width = `${r.width + 12}px`;
    const ownFill = el('i', 'g3ctrl-bar-own');
    ownFill.style.width = `${((own / total) * 100).toFixed(1)}%`;
    const oppFill = el('i', 'g3ctrl-bar-opp');
    oppFill.style.width = `${((opp / total) * 100).toFixed(1)}%`;
    bar.appendChild(ownFill);
    bar.appendChild(oppFill);
    const scan = el('i', 'g3ctrl-bar-scan');
    bar.appendChild(scan);
    l.appendChild(bar);
  }
  window.setTimeout(() => l.remove(), 1100);
}

/** 清缓存时刻（rule:clear-cache）：持牌方场上有未覆盖正面 gluttony-0 → 齿颚咬合（G1 的"咬合时刻"） */
export function gen3ClearCacheFx(p: { player: PlayerId; count: number }, s: GameState): void {
  const own = ([0, 1] as PlayerId[]).flatMap((pid) => s.players[pid].stacks.flat());
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
