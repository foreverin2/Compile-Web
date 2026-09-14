/**
 * 3 代特效共用小工具（批次 E 收尾；**G2 修正 R3：覆盖方向改为按座位**）。
 *
 * ## 被盖卡露出的可见带 —— 两套方向（规格 §3.2）
 *
 * | 页面 | 视角座位 | 链路生长 | 覆盖者在 | 露出的是 |
 * |---|---|---|---|---|
 * | **热座页** | `null`（默认） | 绝对玩家左右（P0 左 / P1 右） | **右** | **左侧竖条**（原逻辑，一行不改） |
 * | **远程页** | 本页 `viewSeat` | 自己向下 / 对手向上 | **下**（自己）/ **上**（对手） | **上段 / 下段横带** |
 *
 * 判据的**单一出处**是"覆盖着这张卡的那张牌自己的**特效朝向标记**"（`data-fx-rot`，R1/R2 建立）：
 *  - `data-fx-rot="ccw"` = 自己（下半部）⇒ 新牌在下方 ⇒ 覆盖者在**下** ⇒ 露出**上段**；
 *  - `data-fx-rot="cw"` = 对手（上半部）⇒ 新牌在上方 ⇒ 覆盖者在**上** ⇒ 露出**下段**。
 *
 * 为什么按**那张覆盖卡**的属性判、而不是按 `fxViewSeat()` + 卡属主：逐卡判与"哪一侧在上/下"
 * 的真实渲染同源（R1 的 `fxRot: isSelfSeat ? 'ccw' : 'cw'` 就是按**这张卡所在的视觉侧**给的），
 * 于是即使将来某个局面在一条链路里混了朝向，判据也仍然跟着卡走。**热座页读不到该属性** ⇒
 * 走 `vCoveredOuter` 的 `null` 分支 ⇒ 原来的"覆盖者在右"逻辑（热座零变化是构造性的）。
 *
 * 命名（规格 §8.2 要求"具体名字由 R3 定，须在契约文档记录"）：
 *  - `vOuter` = 覆盖者在容器坐标轴的哪一端（`'start'` = 小端 = 自己侧 / `'end'` = 大端 = 对手侧）；
 *  - `vCoveredOuter` / `vVisibleStripRect` / `vClipInsetPct` / `vClipInsetCss` —— 竖向变体四件套。
 *  `v*` 前缀表示"竖向（vertical）语义"，与热座那套横排逻辑成对存在。
 *
 * ## 诚实边界（无 jsdom）
 *
 * 四个 `v*` 变体都是**纯函数**（入参是 `DOMRect`，不碰 `document`），可以在 vitest 里逐字段断言 ——
 * 这是**能**机检的那一半。`visibleRectOf` / `clipInset` 的 DOM 读取路径只能用合成 DOM 桩验证
 * **调用与取值**（`tests/ui/fx-seat.test.ts`），证明不了真实浏览器里的实测矩形。
 */

import type { Card, GameState, Line, PlayerId } from '../core/models/types';
import { fxRotMarkerOf } from './fx-orient';
import {
  domRectOf, fxOuterFor, fxViewSeat, vClipInsetCss, vClipInsetPct, vVisibleStripRect, type FxOuter,
} from './fx-seat';

/**
 * "覆盖卡的 `data-fx-rot` 标记缺失"的**诊断信号**（G2 修正 R-F · Minor M-3）。
 *
 * 为什么需要：`coveredOuterOf` 的兜底虽然方向正确，但它意味着**渲染期少产出了一条属性**
 * （`renderStackSlot` 的 `fxRot`）—— 那是 R2 那套"特效朝向"机制的输入。少了它，
 * 覆盖方向这一处还能自愈，别处（`fxOrientOf`）会静默回退到卡面朝向 ⇒ 整类特效差 90°。
 * 所以这里留一条**控制台痕迹**，并且**按 uid 去重**（每张卡最多一条，避免逐帧刷屏）。
 */
const warnedMissingFxRot = new Set<string>();

function warnMissingFxRot(coverUid: string): void {
  if (warnedMissingFxRot.has(coverUid)) return;
  warnedMissingFxRot.add(coverUid);
  console.warn(`[gen3-util] 覆盖卡 ${coverUid} 上读不到 data-fx-rot：`
    + '覆盖方向已按"该卡属主 + 座位"兜底（方向仍正确），但远程页场上卡本应逐卡带标记'
    + '（renderStackSlot 的 fxRot ⇒ render.ts 的 data-fx-rot）—— 别处会静默退回卡面朝向');
}

/** 找到该卡所在链路与下标（找不到返回 null） */
export function locate(s: GameState, uid: string): { player: PlayerId; line: Line; index: number; card: Card } | null {
  for (const player of [0, 1] as PlayerId[]) {
    for (const line of [0, 1, 2] as Line[]) {
      const stack = s.players[player].stacks[line];
      const index = stack.findIndex((c) => c.uid === uid);
      if (index !== -1) return { player, line, index, card: stack[index] };
    }
  }
  return null;
}

/** 覆盖该卡的那张（紧邻上方）卡的 uid；顶卡返回 null */
export function coverUidOf(s: GameState, uid: string): string | null {
  const loc = locate(s, uid);
  if (!loc) return null;
  const stack = s.players[loc.player].stacks[loc.line];
  const above = stack[loc.index + 1];
  return above ? above.uid : null;
}

function nodeOf(uid: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-uid="${uid}"]`);
}

/**
 * **覆盖方向**的单一判定（G2 修正 R3；兜底策略见下面的"显式契约"）。
 *
 * @returns `null` = 热座（走原来的"覆盖者在右"逻辑）；`'start'` = 覆盖者在小端（远程自己侧，
 *          露出**上段**）；`'end'` = 覆盖者在大端（远程对手侧，露出**下段**）。
 *
 * ## 判据链（逐级）
 * 1. 覆盖卡自己的 `data-fx-rot`（`ccw` = 自己 ⇒ `'end'`、`cw` = 对手 ⇒ `'start'`）；
 * 2. **标记读不到**（G2 修正 R-F · Minor M-3）⇒ 按**本卡属主 + 座位**兜底
 *    （`fxOuterFor(loc.player)`：自己 ⇒ `'end'`、对手 ⇒ `'start'` —— 与标记**同义**，
 *    因为 `render-net.ts` 的标记就是按"这张卡在哪个视觉侧"给的），并 `console.warn` **一次**。
 *
 * ## 显式契约：为什么可以兜底、以及为什么不再是"静默按对手侧"
 *
 * - 远程页的场上卡**结构上必然带标记**（R1 逐卡产出；`render-net.ts` 的运行时断言 3 会逐卡核对），
 *   所以第 2 级在正确实现下**不可达**；它存在只是为了守住既有纪律"**诊断/特效绝不把渲染搞崩**"
 *   （抛异常会把整帧特效链条打断，比方向错更糟）。
 * - R3 的旧兜底是一个**常量 `'start'`**（恒等于"对手侧"）—— 自己列被覆盖时会**静默反向**。
 *   现在兜底值由"属主 + 座位"算出：即使标记真的丢了，方向**仍然是正确的**（只是失去了
 *   "一条链路里混朝向"这类将来的可扩展性）。
 * - `console.warn` **按覆盖卡 uid 去重**（每张卡最多一条）：它是"标记丢了"这件事在控制台里的
 *   唯一痕迹 —— 没有它，这类退化在页面上完全无声。
 */
export function coveredOuterOf(s: GameState, uid: string): FxOuter | null {
  const cover = coverUidOf(s, uid);
  if (!cover) return null;
  // 热座（`fxViewSeat() === null`）⇒ 返回 null，调用方走原来的"覆盖者在右"逻辑。
  if (fxViewSeat() === null) return null;
  const coverNode = nodeOf(cover);
  // 用 `fxRotMarkerOf`（而不是 `fxOrientOf`）：后者会把"标记缺失"回退成**卡面**朝向
  // （远程页卡面是 0°/180°）⇒ 于是一切都会被判成"不是 ccw" ⇒ 恒 `'start'`。这里要的就是
  // "缺失"这个事实本身。
  const marker = fxRotMarkerOf(coverNode);
  if (marker === 'ccw') return 'end';    // 自己（−90°，下半部）⇒ 新牌在**下方** ⇒ 覆盖者在下 ⇒ 大坐标端
  if (marker === 'cw') return 'start';   // 对手（+90°，上半部）⇒ 新牌在**上方** ⇒ 覆盖者在上
  // ── 第 2 级：标记缺失/取值不认识（见上面的显式契约）──
  warnMissingFxRot(cover);
  // `coverUidOf` 取的是**同一条链路**里紧邻上方的那张 ⇒ 与本卡恒同属主、同侧，
  // 所以"按本卡属主 + 座位"兜底与标记同义。
  const loc = locate(s, uid);
  if (!loc) return 'end';               // 理论上不可达（coverUidOf 已经要求能定位本卡）
  return fxOuterFor(loc.player);
}

/**
 * 可见区域矩形：被盖卡返回"露出的那一条"（热座 = **左侧竖条**；远程页 = **上/下横带**），
 * 未盖卡返回整卡矩形。
 * 取不到 DOM（重渲染中/卡不在场）时返回 null，调用方应跳过。
 */
export function visibleRectOf(s: GameState, uid: string): DOMRect | null {
  const self = nodeOf(uid);
  if (!self) return null;
  const r = self.getBoundingClientRect();
  if (r.width === 0 || r.height === 0) return null;
  const cover = coverUidOf(s, uid);
  if (!cover) return r;
  const coverNode = nodeOf(cover);
  if (!coverNode) return r;
  const cr = coverNode.getBoundingClientRect();
  const outer = coveredOuterOf(s, uid);
  if (outer !== null) return vVisibleStripRect(r, cr, outer);
  // ── 热座：与改动前逐字相同（覆盖者在**右** ⇒ 露出左侧竖条，至少 6px） ──
  const width = Math.max(6, Math.min(r.width, cr.left - r.left));
  return domRectOf(r.left, r.top, width, r.height);
}

/**
 * 浮层卡裁剪：被覆盖的比例（0~0.94）——用于 `buildFxCard` 出来的整卡浮层。
 *
 * 热座裁**右缘**（与原 `clipInsetRightPct` 逐字等价）；远程页按覆盖方向裁**上/下缘**。
 * `vClipInsetCss` 给出对应的 `inset(...)` 字符串，调用方（fx-gen3.ts 的伏击/惰性翻转）用它。
 */
export function clipInsetRightPct(s: GameState, uid: string): number {
  const self = nodeOf(uid);
  if (!self) return 0;
  const r = self.getBoundingClientRect();
  if (r.width === 0) return 0;
  const cover = coverUidOf(s, uid);
  if (!cover) return 0;
  const coverNode = nodeOf(cover);
  if (!coverNode) return 0;
  const cr = coverNode.getBoundingClientRect();
  const outer = coveredOuterOf(s, uid);
  if (outer !== null) return vClipInsetPct(r, cr, outer);
  // ── 热座：与改动前逐字相同（裁右缘） ──
  const hidden = (r.right - cr.left) / r.width;
  if (!(hidden > 0.02)) return 0;
  return Math.min(0.94, hidden);
}

/**
 * 竖向裁剪的 CSS 形态（`inset(...)` 四值）——热座用 `inset(0 X% 0 0)`（裁右）、
 * 远程页用 `inset(X% 0 0 0)`（对手侧裁上）/ `inset(0 0 X% 0)`（自己侧裁下）。
 *
 * 为什么单独一个出口：`fx-gen3.ts` 的两处翻转覆盖层要把同一组数字写进 `clipPath`，
 * 若各写一份 `inset(...)` 字面量，两处一旦漂移就是"裁剪方向反了但没人报错"。
 */
export function clipInsetCss(s: GameState, uid: string, pct: number): string {
  const outer = coveredOuterOf(s, uid);
  return outer === null ? `inset(0 ${(pct * 100).toFixed(1)}% 0 0)` : vClipInsetCss(pct, outer);
}

/** 该卡是否被覆盖（= 上方还有牌） */
export function isCovered(s: GameState, uid: string): boolean {
  return coverUidOf(s, uid) !== null;
}
