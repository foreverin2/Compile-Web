import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Card, GameState, Line, PlayerId } from '../../src/core/models/types';
import { createGame } from '../../src/core/state/create';
import { clearGen3Persistent, gen3ControlCheckFx } from '../../src/ui/gen3-control';
import { syncFollowers } from '../../src/ui/fx-follow';
import { setFxViewSeat } from '../../src/ui/fx-seat';
import {
  installStubDom, makeStubEl, setStubRectFor, setStubConnectedModel, type StubNode,
} from './net-dom-stub';

/**
 * **2026-10-01 行为腿：C4（控制权判定）的对比条/数值/金圈必须"跟着主体走"**。
 *
 * 用户原话要点（真机截图上报）："这个特效是粘在屏幕上的，我希望调整为跟随其对应的主体的特效"。
 *
 * ## 为什么必须有这条行为腿（而不是只加一条源码腿）
 *
 * 这三样东西的样式是 `position: fixed`（`styles-gen3-sync.css`，红线文件本轮不动），
 * 坐标由 `gen3ControlCheckFx` **内联**写出。源码腿只能钉"有没有调 `registerFollow`"，
 * 钉不住"滚动之后写进 DOM 的坐标是不是真的跟着主体平移了同一个量" —— 而用户报的正是后者。
 * 这里用 `tests/ui/net-dom-stub` 的桩 DOM **真跑**产出函数 + 注册表，把"主体平移 δ ⇒
 * 条/数字/金圈各自平移 δ"与"不该动的另一条线**一动不动**"两条关系逐字钉住。
 *
 * ## 这个桩能证明 / 不能证明
 *
 * 能：按**测试喂进来的矩形**，产出函数 + 跟随回调写进 DOM 的是什么；以及"主体动、谁跟着动"。
 * **不能**：真实布局（矩形是常量）、真实滚动（`syncFollowers` 在这里是**手工调**的）、观感。
 * 真浏览器里的滚动读数另见 `.superpowers/2026-10-01-c4-cmp-follow/` 的 CDP 读数。
 */

/** 热座页的几何（逐字照抄 `tests/ui/net-check-anchor.test.ts` 的探针实测常量）。 */
const BATTERY = { left: -18, top: 395, width: 92, height: 206 };   // 395..601，竖条
const SLOT = { left: 100, top: 387, width: 660, height: 220 };
const CELL = { left: 770, top: 387, width: 210, height: 220 };     // 协议格在能量槽**右侧**

function place(node: StubNode, b: { left: number; top: number; width: number; height: number }): StubNode {
  setStubRectFor(node, b);
  return node;
}

/** 热座页（`fxViewSeat() === null`）的一条线：链路槽 / 协议格 / 能量槽。
 *  ⚠️ 本文件必须**显式打开**桩的 `isConnected` 模型（`setStubConnectedModel(true)`）——
 *  没有它，`syncFollowers()` 会把每一条跟随项当"已移除"出栈（`isConnected` 在桩上恒 undefined），
 *  本文件三条行为腿全会变成恒真空腿。为什么不默认给所有桩节点加：见 `net-dom-stub.ts` 里
 *  `setStubConnectedModel` 的说明（它会改变 `net-conn-line.test.ts` 那种三档判据走到的分支）。 */
function makeLane(line: Line, player: PlayerId, batteryTop: number): StubNode {
  const body = document.body as unknown as StubNode;
  const row = makeStubEl('div');
  row.className = 'lane-row';
  const slot = place(makeStubEl('div'), SLOT);
  slot.classList.add('stack-slot');
  slot.dataset.player = String(player);
  slot.dataset.line = String(line);
  const cell = place(makeStubEl('div'), CELL);
  cell.classList.add('protocol-cell');
  cell.dataset.player = String(player);
  cell.dataset.line = String(line);
  const bat = place(makeStubEl('div'), { ...BATTERY, top: batteryTop });
  bat.classList.add('battery');
  bat.dataset.player = String(player);
  bat.dataset.line = String(line);
  row.appendChild(slot);
  row.appendChild(cell);
  row.appendChild(bat);
  body.appendChild(row);
  return bat;
}

function makeState(): GameState {
  const s = createGame({ seed: 'c4-follow', draftStarter: 0, firstToPlay: 0 });
  const card = (uid: string, defId: string, owner: PlayerId, line: Line): Card =>
    ({ uid, defId, owner, faceUp: true, zone: 'field', line, pos: 0 }) as unknown as Card;
  // 三条线都给 P0 放卡（线值 > 0 ⇒ 三条条都产得出来）
  s.players[0].stacks[0] = [card('f-0', 'fire-1', 0, 0)];
  s.players[0].stacks[1] = [card('f-1', 'fire-2', 0, 1)];
  s.players[0].stacks[2] = [card('f-2', 'fire-3', 0, 2)];
  // ⚠️ 本文件**不加** lust-0 夹具（2026-10-01 曾为"C4 按色欲在场门控"加过一张，随用户第二次
  // 拍板"那根红蓝对比条还是作为公用的特效吧"一起回退）：C4 是**公用特效、不门控** ⇒
  // 本文件三条跟随腿的局面里有没有色欲与产出无关。夹具保持改动前的样子。
  return s;
}

const num = (v: unknown): number => parseFloat(String(v));

/** 该线（`data-line`）的对比条（读内联坐标）。 */
function barOf(line: Line): StubNode {
  return document.querySelector(`.g3ctrl-cmp[data-line="${line}"]`) as unknown as StubNode;
}

/** 该线的一枚数值盒（own / opp）。 */
function numOf(line: Line, which: 'own' | 'opp'): StubNode {
  return document.querySelector(`.g3ctrl-cmp-num.${which}[data-line="${line}"]`) as unknown as StubNode;
}

/** 把主体的矩形挪到新位置（模拟"棋盘/能量槽整体平移"，例如缩放或布局变化）。 */
function moveBattery(node: StubNode, dTop: number, dLeft = 0): void {
  const r = node.getBoundingClientRect();
  setStubRectFor(node, { left: r.left + dLeft, top: r.top + dTop, width: r.width, height: r.height });
}

afterEach(() => {
  vi.useRealTimers();
  clearGen3Persistent();
});

describe('2026-10-01 · C4 对比条/数值/金圈跟随主体（行为腿）', () => {
  it('主体平移 δ ⇒ 条与两枚数值各自平移 δ；**另一条线一动不动**', () => {
    vi.useFakeTimers();
    const restore = installStubDom();
    setStubConnectedModel(true);   // 见 makeLane 上的说明：本文件的跟随判据承重
    try {
      setFxViewSeat(null);                    // 热座（横排；`styles.css:178`）
      const bat0 = makeLane(0, 0, BATTERY.top);
      const bat1 = makeLane(1, 0, BATTERY.top);
      makeLane(2, 0, BATTERY.top);
      // 领先线 = 1（金圈只在这两条能量槽上）
      gen3ControlCheckFx({ player: 0, wins: 2, leading: [1], gained: true }, makeState());

      const bar0 = barOf(0); const bar1 = barOf(1);
      expect(bar0, '线 0 没有对比条').not.toBeNull();
      expect(bar1, '线 1 没有对比条').not.toBeNull();
      const before = { top: num(bar0.style.top), left: num(bar0.style.left) };
      const before1 = { top: num(bar1.style.top), left: num(bar1.style.left) };
      const numBefore = { top: num(numOf(0, 'own').style.top), left: num(numOf(0, 'own').style.left) };
      const ring = document.querySelector('.g3ctrl-lead-ring[data-player="0"][data-line="1"]') as unknown as StubNode;
      expect(ring, '线 1 领先却没有金圈').not.toBeNull();
      const ringBefore = { top: num(ring.style.top), left: num(ring.style.left) };

      // ── 主体（线 0 的能量槽）下移 130、右移 24（δ 取"竖条高度"量级，够大不会被取整吃掉）──
      const dTop = 130; const dLeft = 24;
      moveBattery(bat0, dTop, dLeft);
      syncFollowers();                        // `render.ts` 每帧 + `main.ts` 滚动/缩放 rAF 调的就是它

      expect(num(bar0.style.top) - before.top, `主体下移 ${dTop}px，线 0 的条没跟着走（= 粘在屏幕上）`)
        .toBeCloseTo(dTop, 3);
      expect(num(bar0.style.left) - before.left, `主体右移 ${dLeft}px，线 0 的条没跟着走`).toBeCloseTo(dLeft, 3);
      // 数值盒的两个坐标落在**两条不同的轴**上：
      //  - **沿条那条轴**（"贴条端"）：热座下条沿 x ⇒ `left = barLo − NUM_W − GAP` / `barHi + GAP`，跟 **dLeft**；
      //  - **垂轴**（条与数字同轴心）：`top = axisCenter − NUM_H/2`（能量槽中心），跟 **dTop**。
      // ⚠️ 2026-10-01 真浏览器读数在**修前**抓到过这一条红：数字的 `top` 当时写的是 `numCenter`
      //    （= 条在**沿轴**上的中点，与垂轴无关）⇒ 热座下它被钉在常量上，主体上下移动 140px
      //    时数字一动不动（实测 Δ=(60, 60) 而不是 (60, 140)）。下面这两条就是钉那个后果的。
      expect(num(numOf(0, 'own').style.left) - numBefore.left, '线 0 的数值盒（贴条端那条轴）没跟条一起走')
        .toBeCloseTo(dLeft, 3);
      expect(num(numOf(0, 'own').style.top) - numBefore.top, '线 0 的数值盒的轴心没跟主体一起走（写成了条的沿轴中点）')
        .toBeCloseTo(dTop, 3);
      // 反空集合：两个位移量不相等 ⇒ 上面这两条真能分辨"跟着哪条轴走"（若相等就分不出）
      expect(dTop, '两个位移量相等 ⇒ 这两条判据分辨不出"跟错了轴"').not.toBe(dLeft);

      // 条宽由能量槽宽派生、条高由常量派生 ⇒ 位置动了，尺寸不该被顺手改坏
      expect(num(bar0.style.width)).toBeCloseTo(BATTERY.width, 3);
      expect(num(bar0.style.height)).toBe(6);

      // ── 反空集合（防止"判据取错矩形"）：线 1 的主体**没动** ⇒ 它的条与金圈必须一动不动 ──
      expect(num(bar1.style.top), '线 0 的主体动了，线 1 的条却跟着动了（跟随取错了主体）').toBe(before1.top);
      expect(num(bar1.style.left), '线 0 的主体动了，线 1 的条却跟着动了（跟随取错了主体）').toBe(before1.left);
      expect(num(ring.style.top), '线 0 的主体动了，线 1 的金圈却跟着动了（金圈锚错了能量槽）').toBe(ringBefore.top);
      expect(num(ring.style.left), '线 0 的主体动了，线 1 的金圈却跟着动了（金圈锚错了能量槽）').toBe(ringBefore.left);
    } finally {
      setFxViewSeat(null);
      restore();
    }
  });

  it('金圈跟的是**它自己**那根能量槽：两侧各加一个圈，分别只跟各自的主体', () => {
    vi.useFakeTimers();
    const restore = installStubDom();
    setStubConnectedModel(true);   // 见 makeLane 上的说明：本文件的跟随判据承重
    try {
      setFxViewSeat(null);
      const bat0 = makeLane(0, 0, BATTERY.top);
      const bat1 = makeLane(0, 1, BATTERY.top);   // 对手侧（P1）同一条线（线 0）
      makeLane(2, 0, BATTERY.top);
      gen3ControlCheckFx({ player: 0, wins: 2, leading: [0], gained: true }, makeState());
      const mineRing = document.querySelector('.g3ctrl-lead-ring[data-player="0"][data-line="0"]') as unknown as StubNode;
      const foeRing = document.querySelector('.g3ctrl-lead-ring[data-player="1"][data-line="0"]') as unknown as StubNode;
      expect(mineRing, '自己侧金圈没产出').not.toBeNull();
      expect(foeRing, '对手侧金圈没产出').not.toBeNull();
      const mineBefore = num(mineRing.style.top);
      const foeBefore = num(foeRing.style.top);

      moveBattery(bat1, 77);          // 只挪对手那根
      syncFollowers();

      expect(num(mineRing.style.top), '对手的能量槽动了，自己侧的金圈却跟着动了（圈锚错了槽）')
        .toBe(mineBefore);
      expect(num(foeRing.style.top) - foeBefore, '对手的能量槽动了，对手侧的金圈没跟着走')
        .toBeCloseTo(77, 3);
    } finally {
      setFxViewSeat(null);
      restore();
    }
  });

  it('主体取不到时不写任何坐标（留在原地；不得跳到视口原点）', () => {
    vi.useFakeTimers();
    const restore = installStubDom();
    setStubConnectedModel(true);   // 见 makeLane 上的说明：本文件的跟随判据承重
    try {
      setFxViewSeat(null);
      const bat0 = makeLane(0, 0, BATTERY.top);
      makeLane(1, 0, BATTERY.top);
      makeLane(2, 0, BATTERY.top);
      gen3ControlCheckFx({ player: 0, wins: 2, leading: [], gained: true }, makeState());
      const bar0 = barOf(0);
      const before = { top: num(bar0.style.top), left: num(bar0.style.left) };

      // 只把**能量槽**摘出文档（槽整根被重画；链路槽/协议格还在 ⇒ 几何其实还能算出来）。
      // ⚠️ 必须**真的**把它从父节点的 children 里摘掉：桩的 `remove()` 只维护父子指针，
      //    而"几何退到链路槽兜底"这条失败形态恰恰要靠"节点真的不在树里"才成立（实测：只调
      //    `remove()` 时 `cmpBarGeom` 仍会用**链路槽**兜底 ⇒ 条被挪到另一个基准上）。
      const row = bat0.parentElement;
      expect(row, '夹具坏了：能量槽没有父节点').not.toBeNull();
      row!.children.splice(row!.children.indexOf(bat0), 1);
      syncFollowers();

      expect(num(bar0.style.top), '主体没了却把条挪去了别处（会跳到视口原点）').toBe(before.top);
      expect(num(bar0.style.left), '主体没了却把条挪去了别处（会跳到视口原点）').toBe(before.left);
    } finally {
      setFxViewSeat(null);
      restore();
    }
  });

  it('接线：C4 的三样东西都注册了跟随（源码腿：防"只写了一个 helper 没人调"）', () => {
    // ⚠️ 与 `tests/ui/gen3-control-fx.test.ts` 同一个读法（`subarray(...).toString('utf8')`）：
    //    本仓的 `readFileSync` 类型签名只吃一个参数，传 `'utf8'` 会 TS2554。
    const src = readFileSync(fileURLToPath(new URL('../../src/ui/gen3-control.ts', import.meta.url)))
      .subarray(0, 4 * 1024 * 1024).toString('utf8');
    // 条 + 两枚数值盒由**条自己**那一条跟随回调重定位（回调里按 data 属性重新查回数值盒）；
    // 金圈各自一枚。
    expect((src.match(/registerFollow\(cmp, /g) ?? []).length, '对比条（含两个数值盒）没有注册跟随').toBe(1);
    expect((src.match(/registerFollow\(ring, /g) ?? []).length, '领先线金圈没有注册跟随').toBe(1);
    // 跟随必须**重新查主体与数值盒**（不能拿创建时的节点/rect 糊弄）
    expect(src, '跟随回调没有重新查能量槽（拿旧 rect 重算等于没跟随）')
      .toMatch(/function subjectBattery\([\s\S]{0,220}querySelector/);
    expect(src, '跟随回调没有重新查数值盒（闭包捕获的节点掉了就会"条动数字不动"）')
      .toMatch(/function followCmp\([\s\S]{0,300}subjectCmpEl\(/);
  });
});
