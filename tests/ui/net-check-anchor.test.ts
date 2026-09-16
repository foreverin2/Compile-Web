import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Card, GameState, Line, PlayerId } from '../../src/core/models/types';
import { createGame } from '../../src/core/state/create';
import { clearGen3Persistent, checkBarProtocolEdge, gen3ControlCheckFx } from '../../src/ui/gen3-control';
import { fxStackEndPoint, fxOuterForSeat, setFxViewSeat, STACK_END_LEAD } from '../../src/ui/fx-seat';
import { installStubDom, makeStubEl, setStubRectFor, type StubNode } from './net-dom-stub';

/**
 * **R23 锚点回归守卫**：能量槽从"每侧最外端"移到"每侧链路头部"（R22）之后，
 * 两处 FX 的落点必须重新定标，且"该跟随的必须跟随、不该动的必须不动"要有机检。
 *
 * 本文件是**行为腿**（真跑产出函数 + 喂测试给定的矩形），三条腿各治一件事：
 *
 *  1. **对比条（发现 2）**：`gen3ControlCheckFx` 真跑一遍，读回写进 DOM 的 `top/left/width`，
 *     断言条与**本侧链路槽**不相交、与**本侧协议格**不相交 —— 旧实现（`anchor.bottom + 5`）
 *     在这两条上都会红（见 `net-check-anchor.test.ts` 的变异记录）。
 *  2. **链路落点（发现 1）**：`fxStackEndPoint` 的"末卡外缘 + `STACK_END_LEAD`"这条**关系**
 *     必须成立 —— 不是钉某个绝对值，而是钉"槽/卡动多少，落点跟着动多少"。
 *  3. **协议侧方向（两页共用）**：`checkBarProtocolEdge` 的四个组合（远程自己/对手、
 *     热座自己/对手）逐格断言 —— 它是"条贴哪一边"的唯一出处。
 *
 * ## 这个桩能证明 / 不能证明
 *
 * 能：**按测试喂进来的矩形**，产出函数写进 DOM 的坐标是什么；以及"两个矩形相对位移时
 * 输出跟着位移同一个量"（关系腿的全部内容）。
 *
 * **不能**：真实布局（矩形是常量，不是浏览器算出来的）、观感（条压在哪儿好不好看）。
 * 真实 rect 与差值由无头探针给（`.superpowers/sdd/_probe-r23-*.json`），观感归用户人眼。
 */

const root = new URL('../../src/', import.meta.url);
const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, root))).subarray(0, 4 * 1024 * 1024).toString('utf8');

/* ============================================================================
 * 夹具：一个只装"几何"的桩 DOM
 * ========================================================================== */

/** 一个矩形（测试喂的常量）。 */
type Box = { left: number; top: number; width: number; height: number };

/** 该线该侧的三个盒子（+ 协议格）。**默认值取自探针实测的远程页**（1500×2400、viewSeat=0、
 *  自己侧线 1）。要复现"能量槽挪回外端"的旧几何，把 `battery` 换成探针记录的旧 rect 即可。 */
interface SideBoxes { slot: Box; battery: Box; holder: Box; cell: Box }

/** 探针 `_probe-r23-remote.json` 实测的**自己侧**三层（R22 之后 = 能量槽夹在协议与链路之间）。
 *  ⚠️ 数值**逐字抄探针**（含 `holder.height = 99.99` / `battery.height = 16.70`）：
 *  夹具把小数位截短会让"条是否与某条边相交"这类 0.01px 级的判据变成假红/假绿。 */
const REMOTE_SELF: SideBoxes = {
  holder: { left: 624.23, top: 589.67, width: 71.42, height: 99.99 },
  battery: { left: 605.23, top: 695.66, width: 109.42, height: 16.7 },
  slot: { left: 605.23, top: 718.36, width: 109.42, height: 404.98 },
  cell: { left: 599.23, top: 583.67, width: 121.42, height: 111.99 },
};

/** 探针实测的**对手侧**（远程页线 1）。 */
const REMOTE_FOE: SideBoxes = {
  slot: { left: 605.23, top: 21, width: 109.42, height: 402.98 },
  battery: { left: 605.23, top: 429.98, width: 109.42, height: 16.7 },
  holder: { left: 624.23, top: 452.69, width: 71.42, height: 99.99 },
  cell: { left: 599.23, top: 446.69, width: 121.42, height: 111.99 },
};

/** R22 **之前**的对手侧几何（探针 `_probe-fx-anchors.json` 的改前记录）：能量槽在最外端，
 *  链路槽紧贴协议。⚠️ 这是"能量槽挪回外端"的**实测**形态，不是猜的：
 *  改前对手电池 top=21.00、链路槽 top=43.70（= 协议 holder 底 37.70 + gap 6）。 */
const REMOTE_FOE_BEFORE_R22: SideBoxes = {
  battery: { left: 605.23, top: 21, width: 109.42, height: 16.7 },
  slot: { left: 605.23, top: 43.70, width: 109.42, height: 402.98 },
  holder: { left: 624.23, top: 452.69, width: 71.42, height: 99.98 },
  cell: { left: 599.23, top: 446.69, width: 121.42, height: 111.98 },
};

/** 探针实测的**热座页**（`_probe-r23-hotseat.json`）：能量槽是槽外侧的竖条、协议在列中间。 */
const HOTSEAT_SELF: SideBoxes = {
  battery: { left: -18, top: 395, width: 92, height: 206 },
  slot: { left: 100, top: 387, width: 660, height: 220 },
  cell: { left: 770, top: 387, width: 210, height: 220 },
  holder: { left: 775, top: 487, width: 200, height: 20 },
};
const HOTSEAT_FOE: SideBoxes = {
  slot: { left: 1210, top: 387, width: 660, height: 220 },
  battery: { left: 1897, top: 394, width: 92, height: 206 },
  cell: { left: 990, top: 387, width: 210, height: 220 },
  holder: { left: 995, top: 487, width: 200, height: 20 },
};

/** 给桩节点配一个矩形（`setStubRectFor` 是 WeakMap ⇒ 用例结束自动回收）。 */
function place(node: StubNode, b: Box): StubNode {
  setStubRectFor(node, b);
  return node;
}

/** 造 .battery[data-player][data-line] / .stack-slot / .protocol-cell 三类桩节点。 */
function makeSideDom(): void {
  const body = document.body as unknown as StubNode;
  for (const p of [0, 1] as PlayerId[]) {
    for (const l of [0, 1, 2] as Line[]) {
      const side = makeStubEl('div');
      side.className = 'net-side';
      const boxes = p === 0 ? REMOTE_SELF : REMOTE_FOE;
      const bat = place(makeStubEl('div'), boxes.battery);
      bat.classList.add('battery');
      bat.dataset.player = String(p);
      bat.dataset.line = String(l);
      const slot = place(makeStubEl('div'), boxes.slot);
      slot.classList.add('stack-slot');
      slot.dataset.player = String(p);
      slot.dataset.line = String(l);
      const cell = place(makeStubEl('div'), boxes.cell);
      cell.classList.add('protocol-cell');
      cell.dataset.player = String(p);
      cell.dataset.line = String(l);
      side.appendChild(bat);
      side.appendChild(slot);
      side.appendChild(cell);
      body.appendChild(side);
    }
  }
}

/** 最小状态：三条线的线值都 > 0（保证三条对比条都产出）。 */
function makeState(): GameState {
  const s = createGame({ seed: 'r23-anchor', draftStarter: 0, firstToPlay: 0 });
  const card = (uid: string, defId: string, owner: PlayerId, line: Line): Card =>
    ({ uid, defId, owner, faceUp: true, zone: 'field', line, pos: 0 }) as unknown as Card;
  s.players[0].stacks[0] = [card('a-0', 'fire-1', 0, 0)];
  s.players[0].stacks[1] = [card('a-1', 'fire-2', 0, 1)];
  s.players[1].stacks[2] = [card('b-2', 'fire-3', 1, 2)];
  // ⚠️ 对手侧也要每条线都有卡：`gen3ControlCheckFx` 只给**该线己方**画条，但它是按
  //    `p.player`（这里是 P0）画的 —— 上面那条"对手侧"腿靠的是**同一个 P0 的三条线**
  //    在 `REMOTE_FOE` 几何下的假设……两处布局都真实存在，故下面那条腿单独跑一次。
  //    这里先给 P1 也放上卡，保证两边都能走完循环（也顺带覆盖 `foe` 分支的线值计算）。
  s.players[1].stacks[0] = [card('b-0', 'fire-1', 1, 0)];
  s.players[1].stacks[1] = [card('b-1', 'fire-2', 1, 1)];
  return s;
}

/** 该帧产出的对比条（按行号）。**读的是写进 DOM 的内联坐标**，不是 CSS 解算值。 */
function cmpBars(): Array<{ left: number; top: number; width: number; height: number }> {
  return [...(document.querySelectorAll('.g3ctrl-cmp') as unknown as StubNode[])].map((n) => ({
    left: parseFloat(String(n.style.left)),
    top: parseFloat(String(n.style.top)),
    width: parseFloat(String(n.style.width)),
    height: parseFloat(String(n.style.height)),
  }));
}

/** `Box` → `AxisRect`（`checkBarProtocolEdge` 只吃四条边，而夹具用"左上 + 宽高"写）。 */
const rect = (b: Box): { left: number; top: number; right: number; bottom: number } =>
  ({ left: b.left, top: b.top, right: b.left + b.width, bottom: b.top + b.height });

/** 运行一次判定特效并收回三条条的几何（跑完立刻清层：注册表是模块态）。 */
function runCheckFx(): Array<{ left: number; top: number; width: number; height: number }> {
  gen3ControlCheckFx({ player: 0, wins: 2, leading: [1], gained: true }, makeState());
  const bars = cmpBars();
  clearGen3Persistent();
  for (const n of document.querySelectorAll('.g3ctrl-lead-ring') as unknown as Array<{ remove(): void }>) n.remove();
  return bars;
}

/* ============================================================================
 * 腿 1：对比条贴在能量槽的**协议侧**，且与本侧链路槽 / 协议格都不相交
 * ========================================================================== */

describe('R23 · 发现 2：C4 对比条真跑（贴能量槽的协议侧那条边）', () => {
  it('远程页（竖排）：条落在协议与能量槽之间，**不**与本侧链路槽相交（旧实现 100% 相交）', () => {
    const restore = installStubDom();
    try {
      setFxViewSeat(0);
      makeSideDom();
      const bars = runCheckFx();
      expect(bars.length, '三条线都应产出对比条').toBe(3);

      // 自己侧（P0）三层：协议 589.67..689.66 / 能量槽 695.66..712.36 / 链路 718.36..1123.34
      // ⇒ 协议与能量槽之间的缝 = 689.66..695.66 ⇒ 条必须**整根落在"能量槽协议侧那条边的外面"**
      //    （`top = 电池.top − 6.01 − 6 = 683.65`）。
      for (const bar of bars) {
        const b = REMOTE_SELF.battery;                                   // 695.66..712.36
        const slot = REMOTE_SELF.slot;                                   // 718.36..1123.34
        const holderTop = REMOTE_SELF.holder.top;                        // 589.67
        // 条高必须由**内联**给出（样式表里那份 9px 是红线文件、不许改 ⇒ 内联是唯一出路）
        expect(bar.height, '条高没有内联写出（会被样式表的旧 9px 接管 ⇒ 越出到能量槽上）').toBe(6);
        expect(bar.top + bar.height, `条顶越过了能量槽顶（条跑到链路那一边去了）：条底 ${bar.top + bar.height}，能量槽顶 ${b.top}`)
          .toBeLessThanOrEqual(b.top);
        expect(bar.top + bar.height, `条与链路槽相交（旧实现的落点）—— 条底 ${bar.top + bar.height}，链路槽顶 ${slot.top}`)
          .toBeLessThanOrEqual(slot.top);
        expect(bar.top, `条顶越过了协议卡面的上沿（${holderTop}）`).toBeGreaterThan(holderTop);
        // 条中心离**最近的那张卡边**必须留出空隙：协议在上（holder 底）、能量槽在下（电池顶）
        const nearCardEdge = Math.max(
          REMOTE_SELF.holder.top + REMOTE_SELF.holder.height,   // 协议卡面的下边
          b.top - 6.01 - 6,                                     // 能量槽协议侧的边
        );
        const barCenter = bar.top + bar.height / 2;
        expect(Math.abs(barCenter - nearCardEdge), `条压在卡边上（中心距最近卡边 ${Math.abs(barCenter - nearCardEdge)}px）`)
          .toBeGreaterThan(2);
        // 条宽仍按能量槽宽（短条，不横跨链路）
        expect(bar.width).toBeCloseTo(b.width, 2);
        // 关系腿（对布局变动稳健）：条的位置**由能量槽的协议侧那条边派生**，不是某个绝对像素。
        expect(bar.top, '条没有贴在"能量槽协议侧外缘之外 6px"处（关系腿）')
          .toBeCloseTo(b.top - 6.01 - 6, 2);
      }
      // 与旧实现的**反空集合**：旧落点（能量槽底 + 5）必然与本侧链路槽相交 ⇒ 这条腿不是恒真
      const oldTop = REMOTE_SELF.battery.top + REMOTE_SELF.battery.height + 5;
      expect(oldTop + 9, '旧算式在新布局下竟然不相交？那这条腿就抓不到 R22 的回归').toBeGreaterThan(REMOTE_SELF.slot.top);
      expect(bars[0].top, '条顶仍是旧算式（anchor.bottom + 5）').not.toBe(oldTop);
    } finally {
      setFxViewSeat(null);
      restore();
    }
  });

  it('热座（横排）：条落在能量槽与链路槽之间的外侧空档，**不**横穿链路槽内部', () => {
    const restore = installStubDom();
    try {
      setFxViewSeat(null);   // 热座：`fxViewSeat() === null`
      const body = document.body as unknown as StubNode;
      for (const l of [0, 1, 2] as Line[]) {
        const side = makeStubEl('div');
        side.className = 'lane-row';
        const bat = place(makeStubEl('div'), HOTSEAT_SELF.battery);
        bat.classList.add('battery');
        bat.dataset.player = '0';
        bat.dataset.line = String(l);
        const slot = place(makeStubEl('div'), HOTSEAT_SELF.slot);
        slot.classList.add('stack-slot');
        slot.dataset.player = '0';
        slot.dataset.line = String(l);
        const cell = place(makeStubEl('div'), HOTSEAT_SELF.cell);
        cell.classList.add('protocol-cell');
        cell.dataset.player = '0';
        cell.dataset.line = String(l);
        // 热座 DOM 顺序 = 槽 / 协议 / 协议 / 槽（两侧镜像）
        side.appendChild(slot); side.appendChild(cell); side.appendChild(bat);
        body.appendChild(side);
      }
      const bars = runCheckFx();
      expect(bars.length).toBe(3);
      for (const bar of bars) {
        // 热座自己侧：能量槽 165..369（竖条，左边缘 -18）/ 链路槽 100..760 ⇒
        // 协议在**列中间**（右侧），条贴能量槽的**右**边（= 朝协议），落在 74..100 的空档里。
        expect(bar.left, '热座下条没有落在能量槽与链路槽之间的空档（跑到链路槽内部了）')
          .toBeGreaterThanOrEqual(HOTSEAT_SELF.battery.left + HOTSEAT_SELF.battery.width);
        expect(bar.left, '热座下条越过了链路槽的外缘（跑出列外）').toBeLessThanOrEqual(HOTSEAT_SELF.slot.left);
        // 条在竖条能量槽的**盒内**：不得越过能量槽的上下端
        expect(bar.top).toBeGreaterThanOrEqual(HOTSEAT_SELF.battery.top);
        expect(bar.top + bar.height).toBeLessThanOrEqual(HOTSEAT_SELF.battery.top + HOTSEAT_SELF.battery.height);
      }
    } finally {
      setFxViewSeat(null);
      restore();
    }
  });

  it('对手侧：把整局翻到 P1（判定方 = 对手）时，条贴在**它自己**那一侧的协议边（两页同一条算式）', () => {
    const restore = installStubDom();
    try {
      setFxViewSeat(0);
      // DOM 用的是自己侧三层（`REMOTE_SELF`）；判定方换成 P1 之后，`p.player` 指向 P1，
      // 而 P1 在 `seat = 0` 下**就是对手**（`fxOuterForSeat(1, 0) = 'start'`）。
      // 但 P1 的协议在能量槽**下方**（`REMOTE_FOE` 的层序：链路在上、协议在下）——
      // 所以这里给 P1 单独铺一份对手侧几何。
      const body = document.body as unknown as StubNode;
      for (const l of [0, 1, 2] as Line[]) {
        const side = makeStubEl('div');
        side.className = 'net-side net-side-foe';
        const slot = place(makeStubEl('div'), REMOTE_FOE.slot);
        slot.classList.add('stack-slot'); slot.dataset.player = '1'; slot.dataset.line = String(l);
        const bat = place(makeStubEl('div'), REMOTE_FOE.battery);
        bat.classList.add('battery'); bat.dataset.player = '1'; bat.dataset.line = String(l);
        const cell = place(makeStubEl('div'), REMOTE_FOE.cell);
        cell.classList.add('protocol-cell'); cell.dataset.player = '1'; cell.dataset.line = String(l);
        side.appendChild(slot); side.appendChild(bat); side.appendChild(cell);
        body.appendChild(side);
      }
      gen3ControlCheckFx({ player: 1, wins: 2, leading: [1], gained: true }, makeState());
      const bars = cmpBars();
      clearGen3Persistent();
      expect(bars.length, '对手侧（判定方 = P1）也应产出三条对比条').toBe(3);
      for (const bar of bars) {
        const b = REMOTE_FOE.battery;      // 429.98..446.69
        const holder = REMOTE_FOE.holder;  // 452.69..552.67（协议在能量槽**下方**）
        const slot = REMOTE_FOE.slot;      // 21..423.98（链路在**上方**）
        // 协议侧 = 能量槽下边缘那条边 ⇒ 条整根落在 446.69..452.69 的缝里（446.69+6.01 = 452.70）
        expect(bar.top, `对手侧条贴错了边（应贴能量槽下边缘；实测 ${bar.top}）`)
          .toBeGreaterThan(b.top + b.height - 0.02);
        expect(bar.top, '对手侧条跑回链路那一边去了（链路在能量槽上方）').toBeGreaterThan(slot.top + slot.height);
        expect(bar.top + bar.height, '对手侧条越过了协议卡面上沿（协议在能量槽下方）')
          .toBeLessThanOrEqual(holder.top + holder.height);
        expect(bar.width).toBeCloseTo(b.width, 2);
        // 反空集合：旧算式（能量槽底 + 5）在对手侧落在 451.68 —— 它**压在协议 holder 的上沿**
        // （452.69）之上 1px，正是无头探针记录的"压在协议 holder 顶边"那一条。
        const oldTop = b.top + b.height + 5;
        expect(oldTop, '旧算式在对手侧竟然不与协议相交？').toBeGreaterThan(holder.top - 3);
        expect(oldTop, '旧算式在对手侧竟跑到了协议卡面之外？').toBeLessThan(holder.top + 3);
        expect(bar.top, '对手侧仍是旧算式（anchor.bottom + 5）').not.toBe(oldTop);
      }
    } finally {
      setFxViewSeat(null);
      restore();
    }
  });
});

/* ============================================================================
 * 腿 2：`checkBarProtocolEdge` —— "条贴哪一边"的唯一出处（四个组合逐格）
 * ========================================================================== */

describe('R23 · `checkBarProtocolEdge` 的四个组合（方向判据的唯一出处）', () => {
  const b = (l: number, t: number, w: number, h: number): Box => ({ left: l, top: t, width: w, height: h });

  it('远程页（seat 非 null）：协议侧 = 链路外端的**反侧**；自己贴 top、对手贴 bottom', () => {
    const bat = b(100, 500, 40, 40);          // 500..540
    expect(fxOuterForSeat(0, 0), '自己侧的外端应是大端（向下生长）').toBe('end');
    expect(checkBarProtocolEdge(rect(bat), null, 'end', 0), '自己侧：协议在上方（top），朝 -1 方向')
      .toEqual({ at: 500, dir: -1 });
    expect(fxOuterForSeat(1, 0), '对手侧的外端应是小端（向上生长）').toBe('start');
    expect(checkBarProtocolEdge(rect(bat), null, 'start', 0), '对手侧：协议在下方（bottom），朝 +1 方向')
      .toEqual({ at: 540, dir: 1 });
  });

  it('热座（seat === null）：协议侧 = **协议格所在的那一侧**（与链路外端相反）', () => {
    const bat = b(-18, 395, 92, 206);         // 热座 P0 的竖条能量槽：-18..74
    // P0：协议格在右边（770..980）
    expect(checkBarProtocolEdge(rect(bat), rect(b(770, 387, 210, 220)), 'start', null))
      .toEqual({ at: 74, dir: 1 });
    // P1：协议格在左边（990..1200）
    const batP1 = b(1897, 394, 92, 206);      // 1897..1989
    expect(checkBarProtocolEdge(rect(batP1), rect(b(990, 387, 210, 220)), 'end', null))
      .toEqual({ at: 1897, dir: -1 });
  });

  it('反空集合：四个组合里**至少有两个不同的方向**（防止判据退化成常量）', () => {
    const bat = b(-18, 395, 92, 206);
    const dirs = new Set<number>();
    dirs.add(checkBarProtocolEdge(rect(bat), rect(b(770, 387, 210, 220)), 'start', null).dir);
    dirs.add(checkBarProtocolEdge(rect(bat), rect(b(990, 387, 210, 220)), 'end', null).dir);
    dirs.add(checkBarProtocolEdge(rect(b(0, 0, 10, 10)), null, 'end', 0).dir);
    dirs.add(checkBarProtocolEdge(rect(b(0, 0, 10, 10)), null, 'start', 0).dir);
    expect([...dirs].sort(), '四个组合只有一种方向 ⇒ 判据退化成常量（等于"永远贴同一边"）')
      .toEqual([-1, 1]);
  });

  it('协议格取不到时的兜底仍**不**与链路端同侧（否则条会落在链路上）', () => {
    const bat = b(100, 500, 40, 40);   // 100..140
    // 热座兜底（协议格取不到）：P0 的 `outer = 'start'`（链路在左）⇒ 协议在右 ⇒ 贴 right、朝 +1
    expect(checkBarProtocolEdge(rect(bat), null, 'start', null)).toEqual({ at: 140, dir: 1 });
    // P1 的 `outer = 'end'`（链路在右）⇒ 协议在左 ⇒ 贴 left、朝 -1
    expect(checkBarProtocolEdge(rect(bat), null, 'end', null)).toEqual({ at: 100, dir: -1 });
    // 反空集合：两条兜底**方向相反**（若都返回同一侧，条在热座的某一半会落到链路上）
    expect(checkBarProtocolEdge(rect(bat), null, 'start', null).dir)
      .not.toBe(checkBarProtocolEdge(rect(bat), null, 'end', null).dir);
  });
});

/* ============================================================================
 * 腿 3：链路落点（发现 1）—— "跟随关系"而不是绝对值
 * ========================================================================== */

describe('R23 · 发现 1：链路落点与链路槽/末卡的**跟随关系**（钉关系，不钉绝对值）', () => {
  /** 造一个链路槽 + 一张卡（两者矩形都由测试喂）。 */
  /** 造一个链路槽 + 一张卡（两者矩形都由测试喂）。
   *  ⚠️ 返回类型写成 `HTMLElement` 是**为了让被测函数的签名原样可用**（`fxStackEndPoint`
   *  吃 `HTMLElement | null`）—— 运行时它就是桩节点（`as unknown as` 只是跨过 TS 的结构检查，
   *  桩自身仍只提供"矩形 + 后代查询"这两件被测函数真正用到的事）。 */
  function slotWithCard(slotBox: Box, cardBox: Box | null, player: PlayerId): HTMLElement {
    const body = document.body as unknown as StubNode;
    const slot = place(makeStubEl('div'), slotBox);
    slot.classList.add('stack-slot');
    slot.dataset.player = String(player);
    slot.dataset.line = '1';
    if (cardBox) {
      const card = place(makeStubEl('div'), cardBox);
      card.classList.add('card');
      slot.appendChild(card);
    }
    body.appendChild(slot);
    return slot as unknown as HTMLElement;
  }

  it('有卡：落点 = 末卡**外缘** + `STACK_END_LEAD`；槽整体平移 δ ⇒ 落点跟着平移 δ', () => {
    const restore = installStubDom();
    try {
      setFxViewSeat(0);
      const slotBox: Box = { left: 605, top: 21, width: 109, height: 403 };
      const cardBox: Box = { left: 613, top: 45, width: 93, height: 128 };
      const slot = slotWithCard(slotBox, cardBox, 1);
      const p1 = fxStackEndPoint(slot, 0, 1);
      expect(p1, '对手侧满链路应给出落点').not.toBeNull();
      // 对手（seat=0 时是"对手"⇒ 外端 = start = 上端）⇒ 落点 y = 末卡上缘 − lead
      expect(p1!.y, '落点不是"末卡上缘 − STACK_END_LEAD"').toBeCloseTo(45 - STACK_END_LEAD, 6);
      expect(p1!.x, '落点的横向必须落在槽的水平中心').toBeCloseTo(605 + 109 / 2, 6);

      // ── 跟随关系：把**槽与卡一起**下移 δ ⇒ 落点必须同样下移 δ（而不是"回到某个固定值"） ──
      const delta = 22.7;   // R22 实测的连带位移量（能量槽高 16.70 + gap 6）
      const slot2 = slotWithCard(
        { ...slotBox, top: slotBox.top + delta },
        { ...cardBox, top: cardBox.top + delta },
        1,
      );
      const p2 = fxStackEndPoint(slot2, 0, 1);
      expect(p2!.y - p1!.y, `槽与卡平移 ${delta}px，落点却只移动了 ${(p2!.y - p1!.y).toFixed(2)}px`)
        .toBeCloseTo(delta, 6);
    } finally {
      setFxViewSeat(null);
      restore();
    }
  });

  it('跟随关系是**双向**的：落点随槽/卡移动，但**不**随"另一侧"的几何变化（防止判据取错矩形）', () => {
    const restore = installStubDom();
    try {
      setFxViewSeat(0);
      const slotBox: Box = { left: 605, top: 21, width: 109, height: 403 };
      const cardBox: Box = { left: 613, top: 45, width: 93, height: 128 };
      const before = fxStackEndPoint(slotWithCard(slotBox, cardBox, 1), 0, 1);
      // 自己侧（P0）的槽与卡整体下移 —— 对手侧的落点**必须一动不动**
      slotWithCard({ left: 605, top: 718, width: 109, height: 405 }, { left: 613, top: 970, width: 93, height: 128 }, 0);
      const after = fxStackEndPoint(document.querySelector('.stack-slot[data-player="1"][data-line="1"]') as unknown as HTMLElement, 0, 1);
      expect(after!.y, '对手侧落点被"自己侧"的几何影响了（判据取错了矩形）').toBeCloseTo(before!.y, 6);
    } finally {
      setFxViewSeat(null);
      restore();
    }
  });

  it('空链路：落点锚在槽的**内端**（贴协议那一侧），且随槽平移同量', () => {
    const restore = installStubDom();
    try {
      setFxViewSeat(0);
      const slotBox: Box = { left: 740, top: 21, width: 101, height: 403 };
      const p1 = fxStackEndPoint(slotWithCard(slotBox, null, 1), 0, 1);
      // 对手侧空槽：锚 `slot.bottom − STACK_END_LIFT`（内端 = 贴协议那一侧 = 下端）
      expect(p1!.y, '空槽落点没有锚在槽的内端（贴协议侧）').toBeCloseTo(424 - 90, 6);
      const delta = 22.7;
      const p2 = fxStackEndPoint(slotWithCard({ ...slotBox, top: slotBox.top + delta }, null, 1), 0, 1);
      expect(p2!.y - p1!.y, '空槽平移后落点没有同量跟随').toBeCloseTo(delta, 6);
    } finally {
      setFxViewSeat(null);
      restore();
    }
  });

  it('**关系腿的证伪能力**：把"能量槽挪回外端"的旧几何喂进来，落点会差出整整一个连带位移', () => {
    const restore = installStubDom();
    try {
      setFxViewSeat(0);
      // 当前几何（R22 之后）
      const now = fxStackEndPoint(
        slotWithCard(REMOTE_FOE.slot, { left: 613, top: 45, width: 93, height: 128 }, 1), 0, 1);
      // R22 之前：链路槽紧贴协议（top 43.70 而不是 21.00），末卡跟着下移 22.70
      const before = fxStackEndPoint(
        slotWithCard(REMOTE_FOE_BEFORE_R22.slot, { left: 613, top: 67.70, width: 93, height: 128 }, 1), 0, 1);
      expect(now!.y - before!.y, '两种布局的落点差应等于能量槽占位 + gap = 22.70'
        + '（差 0 ⇒ 落点根本没跟着链路槽走，这条腿是假绿的）').toBeCloseTo(-22.7, 6);
    } finally {
      setFxViewSeat(null);
      restore();
    }
  });
});
