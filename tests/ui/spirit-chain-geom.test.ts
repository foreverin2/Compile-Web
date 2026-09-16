import { describe, it, expect } from 'vitest';
import { buildChainLayer, chainLinkGeom } from '../../src/ui/render';
import { domRectOf, setFxViewSeat } from '../../src/ui/fx-seat';
import { installStubDom } from './net-dom-stub';

/**
 * **G2 修正 R14-7 守卫（本轮 · 修复 3）**：check-cache 锁链的**环尺寸必须跟着手牌区宽度**走。
 *
 * ## 审计证据（这条守卫要挡的回归）
 * `CHAIN_LINK_W = 18` / `CHAIN_LINK_GAP = 9` 是固定 px，而 `buildChainLayer` 把手牌区横向切成
 * 10 段（`segW = (W − 20) / 10`）：
 *  - 热座：环长 18 与段宽同一量级 → 环环相扣（正常）；
 *  - 远程页：手牌区 `W ≈ 100.57`（`--card-h:140` ⇒ `--card-w = (140−2)×0.71429+2`）⇒
 *    `segW ≈ 8.06`，环长恒 18 ⇒ **2.2 倍横向重叠** ⇒ 20 条链糊成"一束麻绳"。
 *  `syncChainLayerPosition` 只拉伸整层 SVG（`preserveAspectRatio=none`），环的 px 半径不变
 *  ⇒ 那条路径救不了它。
 *
 * ## 这条守卫**能**证明什么 / **不能**证明什么
 * 能：① `chainLinkGeom` 的两个宽度上的**数值**（含"热座必须仍是 18/11/9/4"这条硬要求）；
 * ② **真跑生成器**（桩 DOM + 本地 `setAttribute` 记录器）后读回每个 `<ellipse>` 的 `rx/ry`
 * —— 即"实现的的确确用了这套几何"，而不是只写了个没人调的纯函数；
 * ③ 远程页的环**变小且变密**（同一矩形下环数显著增加）。
 * **不能**：真实浏览器里的手牌区宽度（`100.57` / `128.6` 是**测试喂的常量**，来自 CSS 公式）、
 * 真实观感（"像不像一束麻绳"只能人眼），以及"层生成后手牌区宽度又变了"的场景
 * （那一层不重建，仍是生成时尺寸 —— 见 `chainLinkGeom` 的诚实边界）。
 */

/** 远程页手牌区宽度：`--card-h:140` ⇒ `--card-w = (140 − 2) × 0.71429 + 2`（与 net-r9 同一公式）。 */
const NET_W = (140 - 2) * 0.71429 + 2;   // ≈ 100.57
/** 热座手牌区宽度（本轮审计给出的量级）——用于证明"单靠 clamp 取不到 18"，见下面的用例。 */
const HOT_W = 128.6;

/** 手牌区矩形（高度取手牌整卡高量级；只影响链长，不影响环尺寸）。 */
const handRect = (w: number): DOMRect => domRectOf(10, 20, w, 137.6);

/** 在桩 DOM 下真跑生成器，记录每个 `setAttribute`（桩的 `setAttribute` 是 noop ⇒ 本地补一个记录器）。 */
function ringsOf(w: number, seat: 0 | 1 | null): Array<Record<string, string>> {
  const restore = installStubDom();
  const rings: Array<Record<string, string>> = [];
  try {
    const doc = globalThis.document as unknown as {
      createElementNS(ns: string, tag: string): { setAttribute(k: string, v: string): void };
    };
    const orig = doc.createElementNS.bind(doc);
    doc.createElementNS = (ns: string, tag: string) => {
      const node = orig(ns, tag);
      if (tag === 'ellipse') {
        const attrs: Record<string, string> = {};
        node.setAttribute = (k: string, v: string) => { attrs[k] = String(v); };
        rings.push(attrs);
      }
      return node;
    };
    setFxViewSeat(seat);
    buildChainLayer(handRect(w), 0);
    return rings;
  } finally {
    setFxViewSeat(null);
    restore();
  }
}

describe('R14-7 · check-cache 锁链环尺寸按手牌区宽度定', () => {
  it('几何的单一出处：热座逐字 18/11/9/4；远程页按 W/12 缩，且**单靠 clamp 取不到 18**', () => {
    // ① 热座：与改动前的四个常量**逐位**相同（"热座零变化"落在这一条上）
    expect(chainLinkGeom(HOT_W, null), '热座锁环几何被改了（它是热座页的既有观感）')
      .toEqual({ w: 18, h: 11, gap: 9, offset: 4 });
    expect(chainLinkGeom(21.5, null), '热座的环尺寸不许可跟手牌区宽度走（宽度一变观感就变）')
      .toEqual({ w: 18, h: 11, gap: 9, offset: 4 });
    // ② 反空集合：**单靠 clamp 在 W=128.6 时得 10.72，取不到 18** —— 这就是判据必须用
    //    "座位分支"而不是"宽度阈值"的直接原因（注释写在 chainLinkGeom 上）。
    expect(Math.min(18, Math.max(8, HOT_W / 12)), '任务书的括注前提：clamp 在 128.6 上取不到 18')
      .toBeCloseTo(10.72, 2);

    // ③ 远程页：环长 = clamp(8, W/12, 18)、间距 = 环长一半、形状比例不变
    const g = chainLinkGeom(NET_W, 0);
    expect(g.w, '远程页环长不是 W/12（≈ 8.38）').toBeCloseTo(NET_W / 12, 6);
    expect(g.gap, '间距不是环长的一半（环环相扣的口径）').toBeCloseTo(g.w / 2, 6);
    expect(g.h, '短轴没有按同一比例缩（环会变成竖着比横着还高的怪椭圆）')
      .toBeCloseTo(11 * (g.w / 18), 6);
    expect(g.offset, '交错量没有按同一比例缩').toBeCloseTo(4 * (g.w / 18), 6);
    // 与段宽同量级 ⇒ 不再 2.2 倍重叠：segW = (W − 20) / 10
    const segW = (NET_W - 20) / 10;
    expect(g.w, `远程页环长（${g.w.toFixed(2)}）仍显著大于段宽（${segW.toFixed(2)}）⇒ 环还会互相压成一束`)
      .toBeLessThanOrEqual(segW * 1.1);
    // 两个座位都要缩（换视角不能改几何：判据只有 seat === null / !== null 两档）
    expect(chainLinkGeom(NET_W, 1)).toEqual(chainLinkGeom(NET_W, 0));
    // 极小宽度走 8px 下限（不塌成 0）
    expect(chainLinkGeom(30, 0).w, '极窄手牌区没有下限（环会退化成点）').toBe(8);
  });

  it('真跑生成器：热座每个环 rx=9.0/ry=5.5（逐字等于改动前）；远程页每个环 rx≈4.2/ry≈2.6', () => {
    // 热座：与改动前**逐字**相同（改动前 rx = CHAIN_LINK_W/2 = 9.0、ry = CHAIN_LINK_H/2 = 5.5）
    const hot = ringsOf(HOT_W, null);
    expect(hot.length, '热座一根链环都没生成（生成器没跑起来？）').toBeGreaterThan(100);
    for (const a of hot) {
      expect(a.rx, '热座的环长轴不再是 18（rx 应为 9.0）').toBe('9.0');
      expect(a.ry, '热座的环短轴不再是 11（ry 应为 5.5）').toBe('5.5');
    }
    // 远程页：环必须**变小**，且是同一形状比例（rx/ry = 18/11）
    const net = ringsOf(NET_W, 0);
    expect(net.length, '远程页一根链环都没生成').toBeGreaterThan(100);
    const g = chainLinkGeom(NET_W, 0);
    const wantRx = (g.w / 2).toFixed(1);
    const wantRy = (g.h / 2).toFixed(1);
    for (const a of net) {
      expect(a.rx, `远程页的环长轴没有跟着手牌区宽度缩（rx 应为 ${wantRx}）`).toBe(wantRx);
      expect(a.ry, `远程页的环短轴没有跟着缩（ry 应为 ${wantRy}）`).toBe(wantRy);
    }
    expect(Number(wantRx), '远程页环长没有真的变小（这条守卫就失去意义了）').toBeLessThan(9);
    // 变密：间隔近乎减半 ⇒ 同一矩形下环数显著增加（0.5 的间隔比 ⇒ 至少 1.6 倍，留足随机余量）
    expect(net.length, `远程页的环没有变密（热座 ${hot.length} → 远程 ${net.length}）`)
      .toBeGreaterThan(hot.length * 1.6);
  });

  it('热座零变化的机制：`seat === null` 这一支与宽度**完全无关**（换宽度不进远程页公式）', () => {
    // 判据是 `seat === null`（不是宽度）：随便喂什么宽度，热座几何都必须一模一样
    for (const w of [40, 100.57, 128.6, 400, 2000]) {
      expect(chainLinkGeom(w, null), `W=${w} 时热座几何被宽度污染了`).toEqual(chainLinkGeom(0, null));
    }
    // 反向：远程页对宽度**敏感**（否则这条判据在"两边都返回常量"时也会假绿）
    expect(chainLinkGeom(200, 0).w).not.toBe(chainLinkGeom(100.57, 0).w);
  });
});
