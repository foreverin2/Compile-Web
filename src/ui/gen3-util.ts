/**
 * 3 代特效共用小工具（批次 E 收尾）：
 *  - `visibleRectOf`：**被覆盖卡的可见区域**。链路里新牌沿"从协议向外"逐张横向重叠铺开
 *    （见 render.ts 的 `.stack .card` 负 margin 注释），因此被盖卡被上方那张卡遮住的是**右侧**部分
 *    ——可见区 = 从本卡左缘到上方那张卡左缘之间的竖条（高度不变）。所有"标记被盖卡"的特效都应
 *    只画在这一条里，否则会盖到压在上面的卡（设计稿 §4 多处"只在可见区域播放"的要求）。
 *  - `coveredByUidOf` / `clipInsetRightPct`：给浮层卡用的裁剪百分比。
 */

import type { Card, GameState, Line, PlayerId } from '../core/models/types';

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
 * 可见区域矩形：被盖卡返回"左侧露出条"，未盖卡返回整卡矩形。
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
  const width = Math.max(6, Math.min(r.width, cr.left - r.left)); // 至少保留 6px 可见宽度
  return new DOMRect(r.left, r.top, width, r.height);
}

/** 浮层卡裁剪：右缘被覆盖的比例（0~0.94）——用于 buildFxCard 出来的整卡浮层 */
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
  const hidden = (r.right - cr.left) / r.width;
  if (!(hidden > 0.02)) return 0;
  return Math.min(0.94, hidden);
}

/** 该卡是否被覆盖（= 上方还有牌） */
export function isCovered(s: GameState, uid: string): boolean {
  return coverUidOf(s, uid) !== null;
}
