/**
 * 3 代（MN03/AX03）· 批次 D：**控制权族（C1~C6）+ 常驻层（5 个 sync + 贪婪1 硬币堆）**。
 *
 * 两类实现（设计稿 §2.2 硬约束）：
 *  - **瞬态**（一次性）：控制权变更 / 判定阶段 / 清缓存时刻 → body 级浮层，播完自清理；
 *  - **常驻**（持续生效中）：嫉妒0 / 暴怒0 / 怠惰0 / 惰性0·1 / 死板7 / 色欲持有 → 每次渲染按
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
// G2 修正 R3：控制轨**端归属**按座位判（自己端在下 / 对手端在上）；热座 `null` ⇒ 走改动前的左右逻辑。
import { fxOuterForSeat, fxTrackEndPos, fxTrackFallbackPct, fxViewSeat } from './fx-seat';
import { protocolColorOf } from './protocol-colors';
// 2026-10-01（用户原话要点："这个特效是粘在屏幕上的，我希望调整为跟随其对应的主体的特效"）：
// 长寿命 FX 的「跟随」注册表（`render.ts` 每帧 + `main.ts` 的滚动/缩放 rAF 各调一次 `syncFollowers`）。
// C4 判定的条/数值/金圈是 body 级 `position: fixed` 层，坐标只在创建那一帧算一次 ⇒ 必须挂进来。
import { registerFollow } from './fx-follow';

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
  // G2 修正 R8-2：能量槽**不再是** `.stack-slot` 的子元素 —— 远程页把它移到链路框外
  // （`.net-side` 的端上、横置，见 render-net.ts 的 renderSide）。所以这里改成按
  // **节点自描述**定位（`renderBattery` 在根上写 data-player/data-line）。
  // ⚠️ 旧写法 `.stack-slot[data-player=…][data-line=…] .battery` 在远程页会**静默**返回 null
  // （本函数调用点全是 `if (!bat) …` 的降级）⇒ 暴怒0 中缝虚线 / 惰性0 / 对比条 / 领先金圈
  // 一起凭空消失，且控制台一个字都不报。
  return document.querySelector<HTMLElement>(`.battery[data-player="${player}"][data-line="${line}"]`);
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

/* ============================== 2. 暴怒0 顶部（W4） ============================== */

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
      // ── G2 修正 **R14-6**（本轮）：中缝必须按**页面轴向**画（热座横 / 远程竖） ──
      // 判据：`fxViewSeat()`（`null` = 热座；非 null = 远程页）。它的**唯一写入点**是
      // `render-net.ts` 的 `applyFxViewSeat`，热座渲染路径从不调用 ⇒ 热座恒走下面那条**逐字未改**
      // 的横版分支（与本文件其它地方"用 `fxViewSeat()` 选竖向"的写法同源，例如 `controlTrackAxis`）。
      //
      // 为什么必须分轴：热座里两条能量槽是**同一行**的左右两端 ⇒ 横缝 = "跨在两槽之间"，
      // 语义正确；远程页（`styles-net.css` 的竖排）里两条能量槽变成**同一列**的上/下两端 ⇒
      // 沿 x 轴算出来的 left/width 会变成一条**压在协议/链路中部的水平虚线**，而
      // `.g3sync-wrath0-seam::before/::after` 的三角箭头指向左右 —— 方向无意义（用户看到的
      // 是一条横在列里的怪线 + 两个朝左右的箭头）。竖版 = 沿 y 轴跨两槽、箭头朝上下。
      // ⚠️ 没有选"竖排下只保留 chip、隐藏缝"：见本轮报告的理由（缝是"最高档整条被划掉"
      //    这条规则提示的**几何本体**，chip 只是它的注解；隐藏缝会让提示退化成一块孤立文字）。
      const vertical = fxViewSeat() !== null;
      // 类的增删在**两条分支都成立**且结果确定：热座下 `toggle('vert', false)` 对从未加过该类的
      // 节点是**无操作**（DOM 逐字节不变）；它同时负责把"上一次是远程页"留下的类清掉。
      seam.classList.toggle('vert', vertical);
      let left: number;
      let right: number;
      let midY: number;
      // R14-6：竖版另需**两根槽各自的中心点**（`a` = 绝对玩家 0 的那根，`b` = 玩家 1 的那根）。
      // 与 left/right/midY **同一份输入**（能量槽优先、取不到退链路槽），只是换个轴消费；
      // 热座分支的取值与写法因此一个字都没动（这四行只是多算了一组数，不写任何 DOM）。
      let ax: number;
      let ay: number;
      let bx: number;
      let by: number;
      if (r0 && r1) {
        const cx0 = r0.left + r0.width / 2;
        const cx1 = r1.left + r1.width / 2;
        left = Math.min(cx0, cx1) - 34;
        right = Math.max(cx0, cx1) + 34;
        midY = (r0.top + r0.height / 2 + r1.top + r1.height / 2) / 2;
        ax = cx0; ay = r0.top + r0.height / 2;
        bx = cx1; by = r1.top + r1.height / 2;
      } else {
        const slotA = slotNode(0, line);
        const slotB = slotNode(1, line);
        const ra = slotA ? rectOf(slotA) : null;
        const rb = slotB ? rectOf(slotB) : null;
        if (!ra || !rb) continue;
        left = Math.min(ra.left, rb.left);
        right = Math.max(ra.right, rb.right);
        midY = (ra.top + ra.bottom + rb.top + rb.bottom) / 4;
        ax = ra.left + ra.width / 2; ay = ra.top + ra.height / 2;
        bx = rb.left + rb.width / 2; by = rb.top + rb.height / 2;
      }
      if (vertical) {
        // 竖缝（R14-6）：`top = min(两槽中心 y) − 34`、`height = |两槽中心 y 之差| + 68`、
        // `left = 两槽中心 x 的均值`（每端各外伸 34px = 与横版同一个"端外留量"），
        // chip 挂在缝的**中点**（x = 缝的 x、y = midY）。
        // `width` 由 `styles-net.css` 的竖版变体给 0（横版残留的内联 width 在这里清掉）。
        seam.style.left = `${(ax + bx) / 2}px`;
        seam.style.top = `${Math.min(ay, by) - 34}px`;
        seam.style.height = `${Math.abs(ay - by) + 68}px`;
        seam.style.width = '';
        if (chip) {
          chip.style.left = `${(ax + bx) / 2}px`;
          chip.style.top = `${midY}px`;
        }
      } else {
        seam.style.left = `${left}px`;
        seam.style.top = `${midY}px`;
        seam.style.width = `${Math.max(40, right - left)}px`;
        if (chip) {
          chip.style.left = `${(left + right) / 2}px`;
          chip.style.top = `${midY}px`;
        }
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

/* ============================== 5. 死板7 底部（Y2） ============================== */

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

/**
 * ★ 2026-09-30（用户实测的 bug）：**这套视觉是"色欲持有中"，必须真的有色欲在场才画**。
 *
 * 判据 = 持有者场上有**未覆盖正面 `lust-0`**（与 C6 禁编译判据同一个）。
 * 提成函数是因为它现在同时管两件事：C3 常驻红环/牵引链/lust 徽标、C6 对手侧封条。
 *
 * 原来红环那一段**没有查这一条** —— 只要有人持有控制权就画红环 + `lust` 徽标；用户那局
 * 双方协议是 `[water,fire,life]` / `[speed,light,darkness]`（一张色欲都没有），
 * 控制权一易主（`control:changed` reason=`check`）就冒出"色欲的红环"，所以他报了这个 bug。
 */
export function lustHoldOf(s: GameState, holder: PlayerId): boolean {
  return s.players[holder].stacks.some((st) =>
    st.some((c) => c.defId === 'lust-0' && c.faceUp && isUncovered(s, c)),
  );
}

/** C3 持有中：持有者一侧常驻红色牵引环 + 组件徽标；C6：持有者未覆盖正面 lust-0 → 对手协议区暗紫封条。 */
export function syncLustHold(s: GameState): string[] {
  const active = new Set<string>();
  if (s.control === 0 || s.control === 1) {
    const holder = s.control;
    /** ★ 2026-09-30：红环/链/徽标与封条**共用**这一个判据（见 `lustHoldOf` 的说明） */
    const holds = lustHoldOf(s, holder);
    const mod = document.querySelector<HTMLElement>('.control-module');
    const img = document.querySelector<HTMLElement>('.control-slider-img');
    const r = img ? rectOf(img) : mod ? rectOf(mod) : null;
    if (holds && r) {
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
    // C6：禁编译（持有者场上有未覆盖正面 lust-0）—— 与上面同一个条件
    if (holds) {
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
 *
 * ⚠️ **G2 修正 R3：热座 = 横向（左右），远程页 = 竖向（上下）**。判据是 `fxViewSeat()`：
 *  - **热座**（`null`）⇒ `controlTrackPoint` 走**改动前那两行**（P1 贴左端 4% / P2 贴右端 96%），
 *    一行未改 —— 热座零变化是构造性的；
 *  - **远程页**（座位非 null）⇒ 按**座位**判"哪一端"：自己端在**下**（96%）、对手端在**上**（4%），
 *    并且改用 `.control-track` 的**实测 y 坐标**（竖向轨道的"端"在 y 轴上）。
 *
 * 为什么按座位而不是按绝对玩家号：远程页的控制轨是**竖向**的，"上/下"取决于我是谁
 * （用户裁决："自己端在下、对手端在上"）。`viewSeat = 1` 时 P1 是**对手** ⇒ 应落**上端**。
 *
 * 返回 `{ x, y }` 两个坐标（热座时 y 是轨道中心、远程页时 x 是轨道中心）—— 调用方按
 * `controlTrackAxis()` 选该用哪一个，这样"横向的旧代码路径"一行都不用改写。
 */
function controlTrackPoint(to: PlayerId): { x: number; y: number } | null {
  const track = document.querySelector<HTMLElement>('.control-track');
  const r = track ? rectOf(track) : null;
  if (!r) return null;
  // 端归属与坐标换算都在 fx-seat 的纯函数里（`fxTrackEndPos`）—— 那一条可以在无 jsdom 的
  // 单测里逐格断言（含"上下对调"的变异）；这里只负责"取轨道实测矩形"这一件 DOM 的事。
  const p = fxTrackEndPos(r, fxViewSeat(), to);
  return { x: p.x, y: p.y };
}

/** 热座在 x 轴、远程页在 y 轴（与 `controlTrackPoint` 同源，供调用方选 `--tx` / `--ty`）。 */
function controlTrackAxis(): 'x' | 'y' {
  return fxViewSeat() === null ? 'x' : 'y';
}

/**
 * 轨道取不到时的兜底坐标（视口百分比）。G2 修正 R3：轴向不同，兜底轴也不同 ——
 * 热座用改动前的 22%/78%（x），远程页用 82%/18%（y：自己端在下）。**改动前的两个数字原样保留**。
 *
 * ⚠️ **G2 修正 R-F · Minor M-5**：原来这里就地按座位算方向
 * （`const self = fxViewSeat() === null ? to === 0 : to === fxViewSeat()`）—— 评审 §D 的
 * "方向判断是否已全部集中"普查里的**漏网处**，且**无单测**。现在判据与两个量都收进
 * `fx-seat.ts` 的 `fxTrackFallbackPct`（走 `fxIsSelfSide`，六个组合都有绝对断言）——
 * 它与 `fxTrackEndFor`（滑块端归属）永远同向，不会再"改一处忘另一处"。
 * 横向的 22%/78% 仍留在这里：那是**绝对玩家号 0/1 ⇒ 视口左右**的映射（与视角无关）。
 */
function viewportFallback(to: PlayerId): { x: number; y: number } {
  return {
    x: to === 0 ? Math.max(80, window.innerWidth * 0.22) : Math.min(window.innerWidth - 80, window.innerWidth * 0.78),
    y: window.innerHeight * fxTrackFallbackPct(fxViewSeat(), to),
  };
}

/**
 * 2026-09-13 用户清单 #8：控制权"牵引链"是**色欲**的视觉语法（色欲 = 控制控制权）。
 * 只有**色欲卡效果**引发的变更才播链条/断链/幽灵飞卡；判定阶段或其他协议（嫉妒1/新星2/暴怒1·4）
 * 造成的易主只播轻量提示（组件脉冲 + 文字标）——用户实测反馈"没打色欲也每次判定都蹦链条"。
 * 判定依据：引擎 `control:changed` 载荷新增的 `sourceDefId`（setControl 第 4 参）。
 */
function lustDrivenControl(p: { reason?: string; sourceDefId?: string }): boolean {
  return p.reason === 'effect' && (p.sourceDefId ?? '').startsWith('lust-');
}

/** C1/C2 轻量版：不牵链条，只在组件卡新位置播脉冲 + 文字标（判定阶段/其他协议的易主）。
 *  2026-09-13：颜色取**效果源卡协议**的主题色（如嫉妒1 底易主 = 玉青/橙），判定阶段（无源卡）用中性灰——
 *  这样既满足用户 #8「只有色欲才牵链条」，又保留了设计稿 E2② 那种"有来源的易主要能看出是谁做的"。
 *  G2 修正 R3：落点从"一个 x"扩成"(x, y, 轴)"—— 竖向轨道下"持有者一端"在 y 轴上；
 *  文字标沿轴的**反方向**偏 54px（横排偏上、竖排偏左）以免压住滑块。 */
function controlMiniFx(
  p: { from: number; to: number; reason?: string; sourceDefId?: string },
  cx: number, cy: number, x: number, y: number, axis: 'x' | 'y',
): void {
  const l = layer('g3ctrl-layer', Z_CTRL);
  const color = p.sourceDefId ? protocolColorOf(p.sourceDefId) : '#b4bac4';
  const pulse = el('i', 'g3ctrl-mini-pulse');
  pulse.style.left = `${x}px`;
  pulse.style.top = `${y}px`;
  pulse.style.setProperty('--mc', color);
  l.appendChild(pulse);
  const gained = p.to === 0 || p.to === 1;
  const chip = el('i', 'g3ctrl-mini-chip', gained ? `控制组件 → P${p.to + 1}` : '控制组件归还中立');
  chip.style.left = axis === 'y' ? `${x - 54}px` : `${x}px`;
  chip.style.top = axis === 'y' ? `${y}px` : `${cy - 54}px`;
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
    // 落点 = 轨道上"持有者一侧"的实测位置（#1：不再用视口百分比猜）。
    // G2 修正 R3：热座在 x 轴（左右）、远程页在 y 轴（上下：自己端在下 / 对手端在上）。
    const axis = controlTrackAxis();
    const target = controlTrackPoint(p.to) ?? viewportFallback(p.to);
    // #8：非色欲驱动的易主 → 只播轻量提示（不牵链条、不飞幽灵卡）
    if (!lustDrivenControl(p)) {
      controlMiniFx(p, cx, cy, target.x, target.y, axis);
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
      // 牵引链的牵引方向随轴：横排给 --tx、竖排给 --ty（CSS 两条 keyframes 分别消费）
      link.style.setProperty(axis === 'y' ? '--ty' : '--tx',
        `${(axis === 'y' ? target.y - cy : target.x - cx).toFixed(1)}px`);
      link.style.animationDelay = `${(i * 70).toFixed(0)}ms`;
      l.appendChild(link);
    }
    void ghost.offsetWidth;
    ghost.style.transform = axis === 'y'
      ? `translate(0, ${(target.y - cy).toFixed(1)}px) scale(1.06)`
      : `translate(${(target.x - cx).toFixed(1)}px, 0) scale(1.06)`;
    const pulse = el('i', 'g3ctrl-pulse');
    pulse.style.left = `${target.x}px`;
    pulse.style.top = `${target.y}px`;
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
  const axis = controlTrackAxis();
  const from = p.from === 0 || p.from === 1 ? (controlTrackPoint(p.from) ?? viewportFallback(p.from)) : null;
  const side = from ? (axis === 'y' ? from.y : from.x) : (axis === 'y' ? cy : cx);
  if (!lustDrivenControl(p)) {
    controlMiniFx(p, cx, cy, side, from ? (axis === 'y' ? from.x : from.y) : cy, axis);
    return;
  }
  const l = layer('g3ctrl-layer', Z_CTRL);
  for (let i = 0; i < 3; i++) {
    const link = el('i', 'g3ctrl-link break');
    if (axis === 'y') {
      // 竖排：断链沿 y 方向散开（节点仍锚在"原持有者那一端"）
      link.style.left = `${cx}px`;
      link.style.top = `${(side + cy) / 2}px`;
      link.style.setProperty('--ty', `${((i - 1) * 16).toFixed(1)}px`);
    } else {
      link.style.left = `${(side + cx) / 2}px`;
      link.style.top = `${cy + (i - 1) * 9}px`;
      link.style.setProperty('--tx', `${((i - 1) * 16).toFixed(1)}px`);
    }
    link.style.animationDelay = `${(i * 90).toFixed(0)}ms`;
    l.appendChild(link);
  }
  const after = el('i', 'g3ctrl-afterglow');
  if (axis === 'y') {
    after.style.left = `${cx - 60}px`;
    after.style.top = `${side - 40}px`;
  } else {
    after.style.left = `${side - 40}px`;
    after.style.top = `${cy - 60}px`;
  }
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

/** 上述"相等即相切"的亚像素余量（px）。**只**用来把"相切"变成"明确不相交"。 */
const CTRL_CMP_CLEARANCE = 0.01;
/** 对比条与"能量槽协议侧外缘"之间留的空隙（px）。
 *
 * ⚠️ **必须 = 条高（`CTRL_CMP_BAR_H`）**：能量槽与协议卡面之间只有 `gap: 6px`
 * （`.net-side` / `.lane-row` 的 flex gap，实测 6.00）。条从"协议侧那条边"再让开 6px
 * 之后正好**整根**落进这条缝里（实测远程页：协议 holder 底 689.66 / 条 683.64..689.64 /
 * 能量槽顶 695.66 ⇒ 与协议卡面**不相交**、离能量槽 6.00px、离链路槽 28.72px）。
 * 让开量小于条高就会越出到协议卡面上。
 * 再加 `CTRL_CMP_CLEARANCE` 的 0.01px：缝宽是**另一个** flex gap（6px）与条高相等，
 * 亚像素布局（dpr=1.25/1.5 的机器）下可能算出 5.9999 ⇒ 条与协议卡面判"相交"。 */
const CTRL_CMP_OUTER_GAP = 6 + CTRL_CMP_CLEARANCE;
/** 对比条的高度（px）—— **条高与条位的唯一出处**。
 *
 * ⚠️ 它由 `cmp.style.height` **内联**写出（与 left/top/width 同一族：几何全在 JS 里），
 * **不是**从 CSS 读回来的：`styles-gen3-sync.css` 的 `.g3ctrl-cmp { height: 9px }` 是
 * 那三个红线文件之一，本轮**不许改**（那里只加了一段说明注释）。内联值优先于样式表，
 * 于是"条高"只有这一个真相（没有两处会漂移），而它又必须精确等于**能量槽与协议卡面之间
 * 那条 flex 缝的宽度（6px）**，条才整根落进缝里、不压任何卡。 */
const CTRL_CMP_BAR_H = 6;
/** 数值盒（`.g3ctrl-cmp-num`）的**让开量**（px）。
 *
 * 它是个 `position: fixed` 的收缩盒（无 width），实测宽 13.72px（11px 等宽字体 + 3px×2 内边距）。
 *  - `NUM_W`：只用来算"紧贴条端外侧"的横排落点（`left = barLo − NUM_W − NUM_GAP`）；
 *  - `NUM_GAP`：数字与条之间的空隙（两种排布共用）。
 * ⚠️ 这两个数**不参与**"条与卡是否相交"的判据（那条只由 `CTRL_CMP_OUTER_GAP` 决定），
 *    所以字体换一个等宽字族只会让数字离条远一点/近一点，不会让条压到卡上。 */
const CTRL_CMP_NUM_W = 14;
const CTRL_CMP_NUM_GAP = 4;
/** 两侧数值盒的高度（px）。与 `styles-gen3-sync.css` 的 `.g3ctrl-cmp-num` 同一约定：
 *  数字盒比条高，所以按**条与数字同轴心**定位（否则数字会单方面越出到协议卡面上）。 */
const CTRL_CMP_NUM_H = 18;

/**
 * 判定标题/结果与**控制组件下沿**之间的让开量（px）——只在"上方放不下、改挂下方"那一支用。
 *
 * 取值 2 的来历（**探针实测的四候选对比**，见报告 §2）：
 *  - `mr.bottom + CTRL_CAP_GAP`（+26）⇒ 标题盒 154..180，**完全压在链路框顶部**（与 `.stack-slot`
 *    重叠 2852px² = 整块标签的面积）；
 *  - `mr.bottom + 2` ⇒ 标题盒 143..169，与链路框只交 **1488px²**（约一半），且**完全不覆盖控制卡**
 *    （控制卡底 = 141）—— 这是四个候选里代价最小的一个。
 * 热座页的控制组件与放置区之间只有 `141 → 152` 这 9px 的页面留白（探针占用图实测），
 * 任何"整条 26px 高的标签"都会越界 ⇒ 这是**残余观感项**，已列入人眼验收清单。
 */
const CTRL_CAP_BELOW_LIFT = 2;

/** "挂到组件下方"那一支里，**结果**与标题之间的额外空隙（px）。
 *  标题与结果各占一段（`labelH + 这个值` 的中心距）⇒ 结果一出现不会盖住标题
 *  （旧实现两者同点，实测标题被盖 96%~100%，见 `controlCheckLabelPoint` 的头注）。 */
const CTRL_CAP_STACK_GAP = 4;

/**
 * 判定标题/结果与控制组件之间的让开量（px）。原值 `26`（"挂在控制组件上方"），R24 提为具名常量。
 */
const CTRL_CAP_GAP = 26;

/**
 * 判定标题盒（`.g3ctrl-caption`）的**标称高度**（px）。
 *
 * 它只用来回答"上方够不够放整条标题"（见 `controlCheckLabelPoint`），**不**写进 DOM
 * （高度由字体与内容决定，实测 25.19）。取 26 的理由：实测值 25.19 向上取整 ⇒
 * "上方刚好放得下"时不会因为小于 1px 的字体渲染差而改走下方分支（那会让热座/远程
 * 两种页面的分界在临界窗口尺寸下抖动）。⚠️ 它与 `CTRL_CAP_GAP` 数值相同纯属巧合
 * （一个是"让开量"，一个是"标题自身高度"），**不要合并**这两个常量。
 */
const CONTROL_CHECK_LABEL_H = 26;

/**
 * 判定标题/结果的**落点**（R24 修法的唯一出处）。返回**两个** y：
 * 标题（"控制权判定 · P1"）与结果（"获得控制组件 / 未满足…"）。
 *
 * ## 为什么需要一个函数（无头实测的两条缺陷）
 *
 * 原实现只有一句：`capY = mr.top − 26`，并把它**同时**交给标题与结果（`mr` = `.control-module`）。
 *
 *  **缺陷 ①（整条标题跑出视口）**：远程页控制轨在页面中部（实测 module top = 471.67）⇒
 *  标题落在 y=433，完整可见；但**热座页**控制组件就在页面最顶端（实测 module top = **14**）
 *  ⇒ `capY = −12`，标题盒（高 25.19）实测 rect = **−24.59 .. 0.59** —— **96% 在视口之上**
 *  （`elementFromPoint` 七个采样点全部落在视口外）⇒ 那四个字在热座页根本看不见。
 *
 *  **缺陷 ②（结果把标题整条盖住）**：两者共用**同一个中心点**且 `position: fixed`，
 *  而结果在 DOM 里更靠后 ⇒ 结果一出现就压住标题。实测两页都被盖：
 *   - 远程页：标题 634.47,335.08..758.47,360.27 / 结果 640.47,333.27..752.47,362.07 ⇒ 盖住 **96.0%**；
 *   - 热座页：标题 422.50,143.41..546.50,168.59 / 结果 428.50,141.60..540.50,170.40 ⇒ 盖住 **100.0%**。
 *  ⇒ 标题只在结果出场之前（~0.62s）闪一下，此后"控制权判定"四个字**永远读不到**。
 *
 * ## 判据与两支
 *
 *  - **上方放得下**（标题盒顶 ≥ 0 且盒底 ≤ 视口高）：标题走 `module.top − CTRL_CAP_GAP`
 *    （与改动前**逐字同值** ⇒ 远程页测量值不变），结果**与标题同点** —— 这一支维持
 *    "先标题、后结果"的同点替换语义（原设计的表达方式，不改）。
 *  - **放不下**：标题挂到 `module.bottom + CTRL_CAP_BELOW_LIFT` 之下（盒顶 2px 在组件外、
 *    不覆盖控制卡），结果再往下让开 **一条标签高**（`labelH + CTRL_CAP_STACK_GAP`）
 *    ⇒ 两条各占一段，**不再互相覆盖**。
 *
 * ## 热座页的代价（如实记录）
 *
 * 热座页控制组件与放置区之间只有 `141 → 152` 的页面留白（探针占用图实测），
 * 两行 26px 高的标签**必然**越进链路框顶部（标题 143..169、结果 171..201；链路框从 162 开始
 * ⇒ 相交面积约 1488 / 2600px²）。这是"两条文字都可见"的唯一解 ⇒ **残余观感项**，
 * 已列入人眼验收清单（四个候选的实测重叠量见报告 §2）。
 *
 * @param module 控制组件（`.control-module`）的 rect —— 只要 `left`/`width`/`top`/`bottom`
 * @param labelH 标题盒高（实测 `.g3ctrl-caption` 的 `offsetHeight`，随字体渲染约 25.19）
 * @param viewportH 视口高（`window.innerHeight`）
 * @returns `{ x, captionY, resultY }` —— 三者都是**中心锚点**（CSS 是 `fixed` + `translate(-50%,-50%)`）
 */
export function controlCheckLabelPoint(
  module: { left: number; width: number; top: number; bottom: number },
  labelH: number,
  viewportH: number,
): { x: number; captionY: number; resultY: number } {
  const x = module.left + module.width / 2;
  const above = module.top - CTRL_CAP_GAP;
  // "放得下"= 标题盒整条都在视口内（盒顶 ≥ 0 且盒底 ≤ 视口高）。
  const fitsAbove = above - labelH / 2 >= 0 && above + labelH / 2 <= viewportH;
  if (fitsAbove) return { x, captionY: above, resultY: above };
  const captionY = module.bottom + CTRL_CAP_BELOW_LIFT + labelH / 2;
  const resultY = captionY + labelH + CTRL_CAP_STACK_GAP;
  return { x, captionY, resultY };
}

/** 只用到矩形的两条边（结构类型 ⇒ 桩矩形与真 DOMRect 都能直接喂进来）。 */
export interface AxisRect { left: number; top: number; right: number; bottom: number }

/**
 * 沿**链路轴**的"协议侧外缘"与"再往协议一侧"的方向（R23 修法的唯一出处）。
 *
 * ## 为什么必须是一个纯函数
 *
 * `gen3ControlCheckFx` 同时服务两种完全不同的布局（远程页竖排 / 热座横排），而
 * "哪里是协议那一侧"在两种布局里**来源不同**：
 *  - **远程页**（`seat !== null`）：全局轴就是 y，协议侧边 = 能量槽的 `top`/`bottom`
 *    （链路在 `outer` 那一端 ⇒ 协议必然在**反侧**）；
 *  - **热座**（`seat === null`）：全局轴是 x，能量槽是"竖条 + 绝对定位在槽的外侧"
 *    （`render.ts` 的 `.lane-row` 顺序 = `槽 / 协议 / 协议 / 槽`，两侧镜像）⇒
 *    协议侧边 = 能量槽的 `left`/`right`。
 *
 * ⚠️ **热座那一支不能用"`outer` 大端/小端"代替**：热座两半的 `outer` 是 `start`/`end`
 * （P0 链路在左、P1 在右），而**协议在两半都朝列中间** —— 全局轴上的"小端/大端"在左半列里
 * 恰好相反（P0 的协议在它自己那一侧的**右**边）。所以热座那一支用**协议格矩形**定方向：
 * 协议格的中心在能量槽的哪一侧，那一侧就是"协议侧"（`renderProtocolCell` 的产物，
 * 与"视觉上谁挨着谁"同一个事实，不依赖任何比例/中值假设）。
 *
 * 返回 `{ at, dir }`：`at` = 协议侧那条边的坐标；`dir` = 从能量槽往协议一侧的**单位方向**
 * （+1 = 坐标增大方向）。调用方据此把条放在"能量槽盒外、贴那条边"的位置。
 *
 * @param battery 该线**己方能量槽**的矩形
 * @param protos  该线**同侧协议格**的矩形（热座分支用它定方向；远程分支不用 —— 那一支的
 *                方向由 `outer` 唯一决定，协议必然在链路外端的**反侧**）
 * @param outer   该侧链路的"外端"（热座 = 绝对玩家左右；远程 = 自己下 / 对手上）
 * @param seat    `null` = 热座（横排）／非 null = 远程页（竖排）
 */
export function checkBarProtocolEdge(
  battery: AxisRect,
  protos: AxisRect | null,
  outer: 'start' | 'end',
  seat: PlayerId | null,
): { at: number; dir: 1 | -1 } {
  if (seat !== null) {
    // 远程页：竖排。协议侧 = 链路（`outer` 那一端）的**反侧** ⇒ 外端是小端时协议在大端。
    return outer === 'end' ? { at: battery.top, dir: -1 } : { at: battery.bottom, dir: 1 };
  }
  // 热座：横排。协议格在能量槽的左边 ⇒ 协议侧边 = 能量槽左边、方向 -1；反之 +1。
  // ⚠️ 取不到协议格矩形时退回"按 `outer` 反推"（热座页协议格一定存在 —— `renderLaneRow`
  //    恒产 `槽/协议/协议/槽`；这条兜底只在桩或半截 DOM 上可达，且方向与远程页同构）。
  if (!protos) return outer === 'start' ? { at: battery.right, dir: 1 } : { at: battery.left, dir: -1 };
  const protoCenter = (protos.left + protos.right) / 2;
  const batteryCenter = (battery.left + battery.right) / 2;
  return protoCenter < batteryCenter ? { at: battery.left, dir: -1 } : { at: battery.right, dir: 1 };
}

/**
 * C4：控制权判定阶段。
 * 2026-09-13 重做（用户实测反馈"每回合链路蹦出奇怪粗线条"）：旧版把 14px 高的对比条**横铺整条
 * `.stack-slot`** 且没有任何文字 → 看起来就是一条横在卡上的怪线。现在改为：
 *  - 对比条**贴在双方能量槽（数值显示）靠协议那一侧**，宽度≈能量槽宽（短条，不再横跨链路）；
 *  - 条上带 `你/对手` 双色填充 + 分隔线 + 扫描线，旁边有"控制权判定"标题；
 *  - 判定结果用文字明确给出：`获得控制组件` / `未满足 2 条线领先`（Q5 判定失败也要有反馈）；
 *  - 领先的两条线能量槽加金色光圈，让"哪两条线领先"一眼可见。
 *
 * ## R23：对比条为什么从"贴能量槽的链路侧"改成"贴能量槽的**协议侧**"
 *
 * 旧算式是"能量槽 `anchor` 的**下边**再让开 5px"（`src` 里那句 `cmp.style.top` 的右半边）。
 * ⚠️ 这里**故意不逐字复述**那个算式：`tests/ui/gen3-control-fx.test.ts` 有一条源码判据
 * 禁止它再出现（判据的语义就是"不许再用这个算式定位"），注释里照抄会让判据假红。
 * 那句里的"下方"是 **R22 之前**的几何事实：那时能量槽挂在每侧的**最外端**，它的"下方"
 * 落在链路框**之外**的空处（热座页至今如此 —— 能量槽是槽外侧的竖条）。
 * R22 把能量槽移到**链路头部**（夹在本侧协议与本侧链路之间）之后，同一句算式算出来的位置
 * 正好压在本侧链路槽上（1500×2400、viewSeat=0 实测：条顶 717.36 落在 `.stack-slot` 顶边
 * 718.36 之**内** 1px，数字盒顶 718.36 压进去 18.5px）—— 这就是"对比条落到链路框身上"。
 *
 * 为什么换成**协议侧**而不是随便换一条：能量槽只有两条长边，一条朝链路、一条朝协议。
 * R22 之后朝链路那条边与链路槽之间只有 `gap: 6px`（实测 6.00），而条 6px + 数字盒必然更高
 * ⇒ 放在那一侧**无论怎么调**都会压住链路。朝协议那条边外面同样是 6.00px 的 flex gap
 * ⇒ 条整根落进那条缝（实测：协议卡面下沿 689.66 / 条 683.64..689.64 / 能量槽上沿 695.66
 * ⇒ 与协议卡面**相切不相交**、离能量槽 6.00px、离链路槽 718.36 有 **28.72px** 余量）。
 * ⇒ 这是新布局下**唯一不压任何卡**的落点。
 *
 * ⚠️ 数字盒（`g3ctrl-cmp-num`）**必须与条同帧一起挪**（条换了边而数字留在旧边 = 一组悬空的数）
 * ⇒ 两者都由下面同一个 `edge`（协议侧那条边）派生，不各写一句偏移。
 *
 * ⚠️ 热座页（`fxViewSeat() === null`）走的是**同一条算式**：热座的能量槽是槽外侧的竖条、
 * 协议在列中间（`styles.css:178` 的 `.stack-slot.pN .battery`），"协议侧那条边"由
 * `checkBarProtocolEdge` 用**协议格矩形**判（两页共用的唯一出处）。
 *
 * ## 2026-10-01：条/数值/金圈改为**跟随主体**（用户原话："这个特效是粘在屏幕上的，
 * 我希望调整为跟随其对应的主体的特效"）
 *
 * 三样东西在样式表里都是 `position: fixed`（`.g3ctrl-cmp` / `.g3ctrl-cmp-num` /
 * `.g3ctrl-lead-ring`，`styles-gen3-sync.css:335/360/368`，**红线文件本轮不动**），
 * 而本函数只在**事件那一帧**算一次坐标 ⇒ 这段时间里滚动/缩放/换布局，它们会停在旧的
 * 视口坐标上（= 用户看到的"粘在屏幕上"），而它们的**主体**（能量槽 / 协议格）已经走掉了。
 *
 * 修法照抄仓库既有的"跟随"管线（`fx-follow.ts` 的 `registerFollow`：`render.ts` 每帧 +
 * `main.ts` 的滚动/缩放 rAF 各调一次 `syncFollowers`；爱意牌库光芒 / 迷雾卡框灰光 /
 * 透彻落点眼三处 >1.6s 的层就是这么接的）：每个元素注册一个 place 回调，回调**重新查一次
 * 主体节点**、用同一个 `cmpBarGeom` 重算，所以"条跟着能量槽走、数字跟着条走、金圈跟着能量槽走"
 * 是**同一条算式**的必然结果，不是三份各写一遍的偏移。
 */
export function gen3ControlCheckFx(
  p: { player: PlayerId; wins: number; leading: Line[]; gained: boolean },
  s: GameState,
): void {
  const l = layer('g3ctrl-check-layer', Z_CTRL);
  const foe: PlayerId = p.player === 0 ? 1 : 0;
  const leading = new Set(p.leading);
  // 标题 + 结果：挂在控制组件旁边（优先上方；上方放不下时挂到下方并把两者错开）。
  // ⚠️ R24：落点算式收进 `controlCheckLabelPoint`（唯一出处，可喂矩形单测）——判据与实测见它的头注。
  const mod = document.querySelector<HTMLElement>('.control-module');
  const mr = mod ? rectOf(mod) : null;
  const cap = mr
    ? controlCheckLabelPoint(mr, CONTROL_CHECK_LABEL_H, window.innerHeight)
    : { x: window.innerWidth / 2, captionY: 40, resultY: 40 };
  const capX = cap.x;
  const caption = el('div', 'g3ctrl-caption', `控制权判定 · P${p.player + 1}`);
  caption.style.left = `${capX}px`;
  caption.style.top = `${cap.captionY}px`;
  l.appendChild(caption);
  const result = el('div', `g3ctrl-result ${p.gained ? 'ok' : 'no'}`, p.gained ? '获得控制组件' : `未满足（领先 ${p.wins} 条，需 2 条）`);
  result.style.left = `${capX}px`;
  result.style.top = `${cap.resultY}px`;
  result.style.animationDelay = '620ms';
  l.appendChild(result);

  for (const line of [0, 1, 2] as Line[]) {
    const g = cmpBarGeom(p.player, line, s, leading.has(line));
    if (!g) continue;
    const { own, opp, barH } = g;
    const cmp = el('div', `g3ctrl-cmp${g.lead ? ' lead' : ''}${p.gained ? '' : ' failed'}`);
    // 主体标记：跟随回调按 (player, line) 重新查回来（与 `layer()` 上那条"层只建一次、
    // 位置每帧重算"的约定同款 —— 2026-09-13 那批"签名相同就 continue ⇒ 漏重定位"的教训）。
    markSubject(cmp, p.player, line);
    applyCmpBar(cmp, g, null);
    const ownFill = el('i', 'g3ctrl-cmp-own');
    ownFill.style.width = `${g.ownPct}%`;
    const oppFill = el('i', 'g3ctrl-cmp-opp');
    oppFill.style.width = `${g.oppPct}%`;
    cmp.appendChild(ownFill);
    cmp.appendChild(oppFill);
    cmp.appendChild(el('i', 'g3ctrl-cmp-scan'));
    l.appendChild(cmp);
    // 数值（贴在条两端，明确"这是数值对比"）：与条**同一个轴心**（数字盒比条高，居中让视觉重心对齐）。
    const ownNum = el('i', 'g3ctrl-cmp-num own', String(own));
    const oppNum = el('i', 'g3ctrl-cmp-num opp', String(opp));
    markSubject(ownNum, p.player, line);
    markSubject(oppNum, p.player, line);
    applyCmpNum(ownNum, 'own', g);
    applyCmpNum(oppNum, 'opp', g);
    l.appendChild(ownNum);
    l.appendChild(oppNum);
    // 三样（条 + 两个数值盒）各自跟随。⚠️ 回调里**按 data 属性重新查回**数值盒，不闭包捕获
    // （闭包捕获的那两枚若被别处摘掉/换掉，回调会去写一个已经不在 DOM 里的节点：条动数字不动）。
    // 轴心与条同源于 `cmpBarGeom`（同一个函数、同一份几何）。
    registerFollow(cmp, () => followCmp(cmp, p.player, line, s));
    // 领先线：双方能量槽加金圈（各自跟随自己那根能量槽）
    if (g.lead) {
      for (const pid of [p.player, foe] as PlayerId[]) {
        const bn = batteryNode(pid, line);
        if (!bn || !rectOf(bn)) continue;
        const ring = el('i', 'g3ctrl-lead-ring');
        ring.dataset.player = String(pid);
        ring.dataset.line = String(line);
        placeLeadRing(ring, pid, line);
        l.appendChild(ring);
        registerFollow(ring, (node) => placeLeadRing(node, pid, line));
      }
    }
  }
  window.setTimeout(() => l.remove(), 1250);
}

/** 给一枚 C4 元素打上"主体坐标"（谁的第几条线）—— 跟随回调靠它重新查回主体节点。
 *  ⚠️ 走 `dataset`（= `data-*` 属性）而不是闭包变量：桩 DOM 与真浏览器都读得回来，
 *  于是"重新查一次主体"这件事在两处是同一条路径（与 `batteryNode` 的按属性寻址同款）。 */
function markSubject(node: HTMLElement, player: PlayerId, line: Line): void {
  node.dataset.player = String(player);
  node.dataset.line = String(line);
}

/** 重新查回主体节点（每帧调用；查不到 ⇒ 元素已被移除/换页，跟随直接跳过、停在原地）。 */
function subjectBattery(player: PlayerId, line: Line): HTMLElement | null {
  return document.querySelector<HTMLElement>(`.battery[data-player="${player}"][data-line="${line}"]`);
}

/** 该线【己方】协议格（`checkBarProtocolEdge` 在热座分支用它定"协议侧"的方向）。 */
function subjectProtocolCell(player: PlayerId, line: Line): HTMLElement | null {
  return document.querySelector<HTMLElement>(`.protocol-cell[data-player="${player}"][data-line="${line}"]`);
}

/** C4 对比条的几何（位置 + 两条填充比例）：**初次落点与每帧跟随共用同一份**。
 *
 *  为什么值得抽出来：`gen3ControlCheckFx` 的初次落点与 `followCmp` 的重定位如果各写一份算式，
 *  两份迟早漂移 —— 而漂移的表现正是"滚动之后条与数字不再同轴心"（本项目反复栽过的"两份真相"）。
 *  这里返回 `null` 表示**这一帧算不出来**（能量槽与链路槽都取不到 ⇒ 该线的条压根不该画）。 */
function cmpBarGeom(player: PlayerId, line: Line, s: GameState, lead: boolean): {
  own: number; opp: number; lead: boolean; ownPct: string; oppPct: string; axisIsY: boolean;
  barH: number; barW: number; barLo: number; barHi: number; numCenter: number; axisCenter: number;
  /** 落点用的是**能量槽**（false = 退到了链路槽的兜底），见 `followCmp` 里为什么只认前者。 */
  anchorIsBattery: boolean;
} | null {
  const foe: PlayerId = player === 0 ? 1 : 0;
  const own = getLineValue(s, player, line);
  const opp = getLineValue(s, foe, line);
  // 两条填充的比例（条上蓝/红两段的宽度）
  const total = Math.max(1, own + opp);
  const ownPct = ((own / total) * 100).toFixed(1);
  const oppPct = ((opp / total) * 100).toFixed(1);
  // 对比条贴在该线【己方能量槽】**靠协议那一侧**（宽度≈能量槽 → 短条、有归属感）。
  // ⚠️ R23：方向由 `checkBarProtocolEdge` 唯一给出（它同时覆盖远程竖排与热座横排），
  //    本函数不再自己判"上/下/左/右"。
  const mine = batteryNode(player, line);
  const mineR = mine ? rectOf(mine) : null;
  const slotR = (() => { const sl = slotNode(player, line); return sl ? rectOf(sl) : null; })();
  const cell = subjectProtocolCell(player, line);
  const cellR = cell ? rectOf(cell) : null;
  const anchor = mineR ?? slotR;
  if (!anchor) return null;
  const axisIsY = fxViewSeat() !== null;   // 与 `controlTrackAxis()` 同一判据（远程竖 / 热座横）
  const edge = checkBarProtocolEdge(anchor, cellR, fxOuterForSeat(player, fxViewSeat()), fxViewSeat());
  const barH = CTRL_CMP_BAR_H;
  // 条沿轴的起点：从"能量槽协议侧那条边"（`edge.at`）朝协议一侧让开 `CTRL_CMP_OUTER_GAP`，
  // 再从那里**朝能量槽方向**长出 `barH` ⇒ 条整根落在能量槽协议侧那条边之外的那条缝里。
  const barLo = edge.dir > 0 ? edge.at + CTRL_CMP_OUTER_GAP : edge.at - CTRL_CMP_OUTER_GAP - barH;
  const barHi = barLo + barH;
  const barW = Math.max(64, Math.min(150, anchor.width));
  // 另一条轴取能量槽中心。
  // ⚠️ 两条轴**各取各的中心**（轴心混用会让竖排的条横向跑到别的列上 —— R23 第一版就是
  //    把 (top+bottom)/2 当成了 left，实测条横移到相邻列，R23 的 DOM 腿把它抓住了）。
  const axisCenter = axisIsY ? (anchor.left + anchor.right) / 2 : (anchor.top + anchor.bottom) / 2;
  return {
    own, opp, lead, ownPct, oppPct, axisIsY, barH, barW, barLo, barHi,
    numCenter: (barLo + barHi) / 2, axisCenter, anchorIsBattery: mineR !== null,
  };
}

/** 把几何写进一条对比条。`prev` = 上一次写进去的轴（用来判"页面轴向变了"，那时才需要清另一条轴）。
 *  ⚠️ 条高**内联写出**：样式表里的 `.g3ctrl-cmp { height: 9px }` 所在文件是红线文件
 *  （本轮一个字节都不改），而落点要求条高 == "协议卡面 → 能量槽"那条 flex 缝的宽（6px），
 *  否则条会越出到协议卡面或能量槽上。内联值优先 ⇒ 高度只有这一个出处。 */
function applyCmpBar(cmp: HTMLElement, g: NonNullable<ReturnType<typeof cmpBarGeom>>, prev: boolean | null): void {
  cmp.style.height = `${g.barH}px`;
  if (g.axisIsY) {
    cmp.style.left = `${g.axisCenter - g.barW / 2}px`;
    cmp.style.top = `${g.barLo}px`;
    cmp.style.width = `${g.barW}px`;
  } else {
    cmp.style.left = `${g.barLo}px`;
    cmp.style.top = `${g.axisCenter - g.barH / 2}px`;
    cmp.style.width = `${g.barW}px`;
  }
  // 换轴（竖排 ↔ 横排）时，上一条轴留下的那条边要显式写回 —— 否则会残留一个越出条的旧值
  if (prev !== null && prev !== g.axisIsY) {
    if (g.axisIsY) cmp.style.top = `${g.barLo}px`;
    else cmp.style.left = `${g.barLo}px`;
  }
}

/** 把几何写进一枚数值盒（`which` 决定它贴条的哪一端）。
 *
 *  ## 2026-10-01：修掉"数字不跟主体纵向走"（真浏览器读数暴露的**既有**缺陷）
 *
 *  数值盒的两个坐标分别落在**两条不同的轴**上：
 *   - **沿轴**（= 条那条轴，"贴条端"）：`barLo − NUM_W − GAP` / `barHi + GAP` —— 轴是 y 时写 `top`，是 x 时写 `left`；
 *   - **垂轴**（与条同轴心）：本来写 `numCenter` —— ⚠️ 而 `numCenter = (barLo + barHi) / 2`
 *     是**条在沿轴上的中点**，与垂轴完全无关。
 *
 *  写 `numCenter` 的后果（热座页实测）：条的 `barLo` 由**能量槽 left** 派生（热座横向布局下
 *  不随上下移动变化）⇒ 数字的 `top` 被钉死在一个常量上（实测 74.01px 一直不动），
 *  而它的主体（能量槽）上下移动 140px 时条走了、数字没走（真浏览器读数：条 Δ=(60,140)、
 *  数字 Δ=(60,60) —— **垂直方向少跟了 140px**）。
 *  ⇒ 垂轴一律取 `axisCenter`（条在**另一条轴**上贴着的"能量槽中心"，条自己的垂轴位置就是它）。
 *    竖排（远程页）那一支同理：那时条沿 y、数字沿 y 贴两端，垂轴是 x，也取 `axisCenter`。
 */
function applyCmpNum(num: HTMLElement, which: 'own' | 'opp', g: NonNullable<ReturnType<typeof cmpBarGeom>>): void {
  if (g.axisIsY) {
    // 竖排（远程页）：条沿 y 走 ⇒ 数字贴条的上下两端，垂轴（x）取能量槽中心
    num.style.left = `${g.axisCenter - CTRL_CMP_NUM_W / 2}px`;
    num.style.top = which === 'own'
      ? `${g.barLo - CTRL_CMP_NUM_H - CTRL_CMP_NUM_GAP}px`
      : `${g.barHi + CTRL_CMP_NUM_GAP}px`;
  } else {
    // 横排（热座）：条沿 x 走 ⇒ 数字贴条的左右两端，垂轴（y）取能量槽中心
    num.style.left = which === 'own'
      ? `${g.barLo - CTRL_CMP_NUM_W - CTRL_CMP_NUM_GAP}px`
      : `${g.barHi + CTRL_CMP_NUM_GAP}px`;
    num.style.top = `${g.axisCenter - CTRL_CMP_NUM_H / 2}px`;
  }
}

/** 一根能量槽的金圈（`place(node, r, 4)` 的语义原样保留：四条边各外扩 4px）。 */
function placeLeadRing(ring: HTMLElement, player: PlayerId, line: Line): void {
  const bn = subjectBattery(player, line);
  const br = bn ? rectOf(bn) : null;
  if (!br) return;
  place(ring, br, 4);
}

/** 该线的一块 C4 子件（数值盒）—— 跟随回调靠 (player, line) + 类名重新查回它。
 *  ⚠️ 两个类名之间用 `.` 拼：写成 `` `.${cls}` `` 而 `cls` 里带空格 =
 *  `.g3ctrl-cmp-num own` —— 那是**后代选择器**（找 `.g3ctrl-cmp-num` 里的 `<own>` 元素），
 *  一个都查不到。实测过：拼接方式写错时"条跟着走、数字一动不动"。 */
function subjectCmpEl(cls: string, player: PlayerId, line: Line): HTMLElement | null {
  const compound = cls.trim().split(/\s+/).filter(Boolean).map((c) => `.${c}`).join('');
  const sel = `${compound}[data-player="${player}"][data-line="${line}"]`;
  const found = document.querySelector<HTMLElement>(sel);
  const dbg = (globalThis as unknown as { __c4sel?: unknown[] }).__c4sel;
  if (dbg) {
    dbg.push({
      sel, found: found !== null,
      all: [...document.querySelectorAll<HTMLElement>('.g3ctrl-cmp-num')].map((n) => n.className + '|' + n.dataset.player + '|' + n.dataset.line),
    });
  }
  return found;
}

/** 两枚数值盒的类名（`own`/`opp` 是并排的第二个类，见 `styles-gen3-sync.css`）。 */
const CMP_NUM_OWN = 'g3ctrl-cmp-num own';
const CMP_NUM_OPP = 'g3ctrl-cmp-num opp';

/** C4 每帧跟随：**重新查一次主体**（能量槽/协议格）与**两枚数值盒**，再用同一条 `cmpBarGeom` 重算。
 *  主体取不到时（层正在被移除 / 主体节点已被重渲染换掉）**留在原地不动**，绝不清坐标
 *  （清了会让元素跳到视口左上角，比停在旧位置更难看）。 */
function followCmp(
  cmp: HTMLElement, player: PlayerId, line: Line, s: GameState,
): void {
  const ownNum = subjectCmpEl(CMP_NUM_OWN, player, line);
  const oppNum = subjectCmpEl(CMP_NUM_OPP, player, line);
  const g = cmpBarGeom(player, line, s, cmp.classList.contains('lead'));
  // 主体（能量槽）取不到 ⇒ **留在原地不动**：一半是"层正在被移除"，一半是"能量槽节点被重渲染
  // 换掉了"。绝不退到链路槽兜底 —— 那会让条**横跳**到另一个基准上（实测差 1px：热座能量槽顶
  // 395 与链路槽顶 387 之间那条 flex 缝），而"没人看的那一帧悄悄挪一下"正是本仓反复栽的假正确。
  if (!g || !g.anchorIsBattery) return;
  const prev = cmp.dataset.axis === undefined ? null : cmp.dataset.axis === 'y';
  cmp.dataset.axis = g.axisIsY ? 'y' : 'x';
  applyCmpBar(cmp, g, prev);
  if (ownNum) applyCmpNum(ownNum, 'own', g);
  if (oppNum) applyCmpNum(oppNum, 'opp', g);
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
