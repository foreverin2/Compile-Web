import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { installStubDom, makeStubEl, setStubRectFor, type StubNode } from './net-dom-stub';
import { stripComments } from './source-text';
import { cloneBoxFrom } from '../../src/ui/fx/clone-orient';
import { fxOrientOf, type CardOrient } from '../../src/ui/fx-orient';
import { setFxViewSeat, vClipInsetCss } from '../../src/ui/fx-seat';
import {
  clipInsetCss, clipInsetRightPct, coveredOuterOf, visibleRectOf,
} from '../../src/ui/gen3-util';

/**
 * G3 守卫：浮层卡 `clipPath` 的**帧一致性**（屏幕帧露出带 ⇔ 元素本地帧 inset）。
 *
 * ## 被钉住的缺陷（源码追踪结论，逐条可在本文件里复核）
 *
 * 1. 伏击 A1 / 惰性 I1·I2 的翻转浮层把 `clipPath` 写在 `api.buildFxCard` 建出的**根元素**上
 *    （`fx-gen3.ts` 的 `c.style.clipPath = clipInsetCss(state, p.uid, hidden)`，两处）；
 * 2. `buildFxCard` → `buildFxCardAt` 在 ±90° **特效朝向**下给**同一个元素**写
 *    `--fx-rot: ±90deg` + `transform: rotate(var(--fx-rot, 0deg))`（`effects/index.ts:239-243`）
 *    ⇒ `clip-path` 与 `transform` **同元素**；
 * 3. 判据（`coveredOuterOf`）与露出带（`visibleRectOf`）都在**屏幕帧**，而 CSS Masking 的语义是
 *    「`clip-path` 先在元素**本地坐标系**生效，再随 transform 一起映射到屏幕」
 *    ⇒ 屏幕帧的四值会被旋转 90°（本地"上/下"落到屏幕"左/右"）。
 *
 * ## 合成模型（本文件唯一的"物理"假设，只有两条 CSS 语义）
 *
 *  - `inset(...)` 的百分比按**参考盒**（元素的 border-box = **未旋转**布局盒）解算；
 *    未旋转布局盒的宽高由**真实源码的几何单一出处** `cloneBoxFrom` 给出（±90° 交换宽高）；
 *  - 本地点 `(u,v) → 屏幕 = 盒心 + R(θ)·(u − w/2, v − h/2)`（CSS 旋转矩阵，y 轴向下、正角顺时针），
 *    盒心 = 卡 rect 的中心 —— 与 `buildFxCardAt` 的"未旋转布局盒 + 绕**中心**旋转 + 定位到卡 rect
 *    的中心"逐条对应。
 *
 * θ ∈ {0, ±90, 180} 时映射轴对齐 ⇒ 四角映射结果的 AABB **就是**精确矩形（不是近似）。
 * 于是"裁剪后的可见区域在屏幕帧里的样子"可复算，拿来与 `visibleRectOf` 的露出带比。
 *
 * ## 旋转输入是**真实的**，不是手写角度
 *
 * 每格的 θ 都由 `fxOrientOf` 从**真实 DOM 形态**读出：热座写 `rot-cw`/`rot-ccw`
 * （`render.ts:377-380` 在热座路径下的产物 —— 热座调用点 `render.ts:5107/5117` 不传 `opts`
 * ⇒ `opts?.orient` 缺省 ⇒ `card.owner === 0 ? 90 : -90`）、远程页写 `data-fx-rot`
 * （`render.ts:383`）。这正是 `buildFxCardAt` 建盒/旋转时读的**同一个函数、同一个节点**
 * （节点 = `[data-uid]` 那张卡：产出方 `render.ts:384`，消费方 `effects/index.ts:2141`）。
 *
 * ## ⚠️ 热座**也**受影响（"热座零变化"这条豁免不存在）
 *
 * 热座场上卡自己就带 `rot-cw`/`rot-ccw`（证据同上）⇒ 热座浮层卡的根元素同样被 `rotate(∓90deg)`
 * ⇒ 屏幕帧的 `inset(0 X% 0 0)` 在热座同样裁错轴。本文件里热座两格（`HOT_CW` / `HOT_CCW`）
 * 就是为此存在的：它们与远程两格一样有牙齿。**因此没有"热座逐字不变"那条腿** ——
 * 那条腿的前提（热座 `fxOrientOf === 0`）被源码追踪推翻了（见报告）。
 *
 * ## 能证明 / 不能证明
 *
 * 能：`clipInsetCss` 的输出在**给定 θ 与给定矩形**下合成回屏幕帧后与露出带一致（1px 内）、
 * 且"把 inset 直接当屏幕帧"的旧读法在这些格子里**不成立**；本地帧四值**逐字**被钉住。
 * 不能：无 jsdom（`environment: 'node'`）—— 矩形是**测试喂的常量**，旋转是**模型**而非浏览器实算；
 * 真实布局、`getComputedStyle` 解出的 clip、以及"看上去对不对"都不在证明范围内（那是用户
 * 在 `localhost:5173` 上的人眼验收项）。
 */

const root = new URL('../../src/ui/', import.meta.url);
/**
 * 去注释后的源码（判据文本腿一律用去注释口径，避免被注释满足 —— 本仓 G2 Task 2F 的教训）。
 * ⚠️ `.subarray(0, N).toString('utf8')` 这个形状不是随手写的：本仓没装 `@types/node`
 * （禁止 `npm install`），`tests/node-types.d.ts` 只声明了 `readFileSync(path)` 返回一个带
 * `subarray` 的对象 —— 直接 `.toString('utf8')` 会 `TS2554: Expected 0 arguments`。
 */
const readSrc = (rel: string): string =>
  stripComments(readFileSync(fileURLToPath(new URL(rel, root))).subarray(0, 8 * 1024 * 1024).toString('utf8'));

/** 桩节点 → `Element`（桩只实现 FX 读朝向需要的那几个成员；与 `net-dom-stub` 的能力边界一致）。 */
const asEl = (n: unknown): HTMLElement => n as unknown as HTMLElement;

type Box = { left: number; top: number; width: number; height: number };

/** 卡 rect（测试喂的常量）。 */
function rect(left: number, top: number, width: number, height: number): Box {
  return { left, top, width, height };
}

/** 与 `buildFxCardAt` 的定位同构：布局盒宽度互换后仍以**卡 rect 的中心**为旋转中心。 */
function centerOf(r: Box): { x: number; y: number } {
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

/**
 * 解析 `inset(t r b l)` 的四个值（`%` ⇒ 比例；`0` ⇒ 0）。
 * 四值缺省/多余都当失败：本仓的产出恒为四值，少的那个会让"哪条边"含糊。
 */
function parseInset(css: string): { top: number; right: number; bottom: number; left: number } {
  const m = /^inset\(([^)]*)\)$/.exec(css.trim());
  expect(m, `不是 inset(...) 形态：${css}`).not.toBeNull();
  const parts = (m as RegExpExecArray)[1].trim().split(/\s+/);
  expect(parts.length, `inset 必须是四值：${css}`).toBe(4);
  const num = (t: string): number => (t.endsWith('%') ? Number.parseFloat(t) / 100 : Number.parseFloat(t));
  return { top: num(parts[0]), right: num(parts[1]), bottom: num(parts[2]), left: num(parts[3]) };
}

/**
 * **本地帧 inset → 屏幕帧可见带**（合成模型，见文件头）。
 *
 * 这是对浏览器行为的**模型**：先按参考盒把 `inset` 解成一个本地矩形（`cloneBoxFrom` 给布局盒），
 * 再绕盒心按 `rotate(θ)` 把四角映射到屏幕、取 AABB。θ ∈ {0,±90,180} ⇒ 轴对齐 ⇒ 精确。
 */
function screenBandOfLocalInset(css: string, o: CardOrient, screenRect: Box): Box {
  const box = cloneBoxFrom(screenRect, o);
  const ins = parseInset(css);
  const u0 = ins.left * box.w;
  const u1 = box.w - ins.right * box.w;
  const v0 = ins.top * box.h;
  const v1 = box.h - ins.bottom * box.h;
  const rad = (o * Math.PI) / 180;
  // o 只可能是 0/±90/180 ⇒ 0/±1，取整消除浮点噪声（不是"四舍五入到整数"的近似）
  const cos = Math.round(Math.cos(rad));
  const sin = Math.round(Math.sin(rad));
  const c = centerOf(screenRect);
  const xs: number[] = [];
  const ys: number[] = [];
  for (const [u, v] of [[u0, v0], [u1, v0], [u0, v1], [u1, v1]] as const) {
    const du = u - box.w / 2;
    const dv = v - box.h / 2;
    xs.push(c.x + cos * du - sin * dv);
    ys.push(c.y + sin * du + cos * dv);
  }
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  return { left, top, width: Math.max(...xs) - left, height: Math.max(...ys) - top };
}

/** 两条带的四字段最大偏差（px）。 */
function bandDiff(a: Box, b: Box): number {
  return Math.max(
    Math.abs(a.left - b.left), Math.abs(a.top - b.top),
    Math.abs(a.width - b.width), Math.abs(a.height - b.height),
  );
}

/** 从 DOMRect 取字段（返回值可能是普通对象，不能用 instanceof）。 */
function box(r: DOMRect): Box {
  return { left: r.left, top: r.top, width: r.width, height: r.height };
}

/** 节点上的**真实**朝向输入（与渲染器产出的 DOM 形态一一对应）。 */
interface OrientInput {
  /** 卡面朝向类（热座路径 `render.ts:378-380` 的产物） */
  cls?: string;
  /** `data-fx-rot`（远程路径 `render.ts:383` 的产物） */
  fxRot?: 'cw' | 'ccw';
}

interface GridCase {
  /** 用例名（写清"哪一页 / 哪个覆盖方向 / 期望裁哪条边"） */
  name: string;
  seat: 0 | 1 | null;
  owner: 0 | 1;
  cardRect: Box;
  coverRect: Box;
  under: OrientInput;
  cover: OrientInput;
  /** 该格由真实输入读出的 θ（与 `buildFxCardAt` 同源） */
  rot: CardOrient;
  /** 该格的**本地帧** `clipInsetCss` 输出（逐字钉住 —— 含"裁哪条边"） */
  wantInset: string;
  /** 该格的**屏幕帧**露出带（与 `visibleRectOf` 对齐，1px 内） */
  wantBand: Box;
  /**
   * 修前的读法（把 inset 直接当屏幕帧）在该格会不会**碰巧也对**。
   * θ === 0 时它必然对 ⇒ 那一格没有牙齿，只能当"边界锚点"（诚实边界，见文件头）。
   */
  teeth: boolean;
}

const REMOTE_CARD = rect(100, 200, 130, 180);
/** 热座卡：带 rot-±90 ⇒ 屏幕足迹 = 旋转后的**横版**（175 × 125.6，同 styles.css 的 --card-h/--card-w） */
const HOT_CARD = rect(100, 200, 175, 125.6);
const HOT_COVER = rect(180.85, 200, 175, 125.6);

/**
 * 六格：θ=0/±90/180 各就位，两条页面腿（远程 2 + 热座 2）都是**有牙齿**的格子。
 *
 * 几何说明：热座两格的覆盖者放在**右**侧（= 热座分支 `clipInsetRightPct` 的既有假设
 * "覆盖者在右 ⇒ 裁右缘"）。⚠️ 真实的**热座 P0（rot-cw）**排列里覆盖者在**左**
 * （`.grow-left` 的 flex-end + `render.ts:361-366` 的 DOM 顺序 + 负 margin-left）——
 * 那是另一件事（既有残余，见文件末尾那条"已知残余"用例），本表只钉**帧换算**这一件事。
 */
const GRID: readonly GridCase[] = [
  {
    name: '远程页 · 自己侧（data-fx-rot=ccw ⇒ −90°）· 覆盖者在下方 ⇒ 屏幕帧裁下 / 本地帧裁左',
    seat: 0, owner: 0,
    cardRect: REMOTE_CARD,
    coverRect: rect(100, 320, 130, 180),
    under: { fxRot: 'ccw' }, cover: { fxRot: 'ccw' },
    rot: -90,
    // 交集 60px / 卡高 180 ⇒ 33.3%；−90° 下"屏幕下"落到"本地左"
    wantInset: 'inset(0 0 0 33.3%)',
    wantBand: rect(100, 200, 130, 120),
    teeth: true,
  },
  {
    name: '远程页 · 对手侧（data-fx-rot=cw + rot-180 ⇒ +90°）· 覆盖者在上方 ⇒ 屏幕帧裁上 / 本地帧裁左',
    seat: 0, owner: 1,
    cardRect: REMOTE_CARD,
    coverRect: rect(100, 140, 130, 180),
    under: { cls: 'rot-180', fxRot: 'cw' }, cover: { cls: 'rot-180', fxRot: 'cw' },
    rot: 90,
    // 交集 120px / 卡高 180 ⇒ 66.7%；+90° 下"屏幕上"落到"本地左"
    wantInset: 'inset(0 0 0 66.7%)',
    wantBand: rect(100, 320, 130, 60),
    teeth: true,
  },
  {
    name: '热座 · P1 卡（rot-cw ⇒ +90°）· 覆盖者在右 ⇒ 屏幕帧裁右 / 本地帧裁上',
    seat: null, owner: 0,
    cardRect: HOT_CARD,
    coverRect: HOT_COVER,
    under: { cls: 'rot-cw' }, cover: { cls: 'rot-cw' },
    rot: 90,
    // 被遮 94.15 / 足迹宽 175 ⇒ 53.8%；+90° 下"屏幕右"落到"本地上"
    wantInset: 'inset(53.8% 0 0 0)',
    wantBand: rect(100, 200, 80.85, 125.6),
    teeth: true,
  },
  {
    name: '热座 · P2 卡（rot-ccw ⇒ −90°）· 覆盖者在右 ⇒ 屏幕帧裁右 / 本地帧裁下',
    seat: null, owner: 1,
    cardRect: HOT_CARD,
    coverRect: HOT_COVER,
    under: { cls: 'rot-ccw' }, cover: { cls: 'rot-ccw' },
    rot: -90,
    wantInset: 'inset(0 0 53.8% 0)',
    wantBand: rect(100, 200, 80.85, 125.6),
    teeth: true,
  },
  {
    // 今天两个渲染器都不产出这一格（热座恒 ±90、远程标记恒 ±90）：它钉的是 **θ=0 ⇒ 逐字不变**
    // 这条边界，同时是"反空集合"的对照 —— θ=0 时"把 inset 直接当屏幕帧"本来就对。
    name: '边界锚点 · 无朝向类也无标记（θ=0）⇒ 与修前逐字一致（本格**没有**牙齿）',
    seat: null, owner: 0,
    cardRect: rect(100, 200, 130, 180),
    coverRect: rect(160, 200, 130, 180),
    under: {}, cover: {},
    rot: 0,
    wantInset: 'inset(0 53.8% 0 0)',
    wantBand: rect(100, 200, 60, 180),
    teeth: false,
  },
  {
    // 结构性输入（今天不可达）：只为把 180° 那一行映射钉死 —— 180° 的裁剪带与 0° 是**镜像**的，
    // 少换算就会裁到相反的一端（本格有牙齿）。
    name: '结构性输入 · rot-180（θ=180，今天不可达）⇒ 屏幕帧裁右 / 本地帧裁左（镜像）',
    seat: null, owner: 0,
    cardRect: rect(100, 200, 130, 180),
    coverRect: rect(160, 200, 130, 180),
    under: { cls: 'rot-180' }, cover: { cls: 'rot-180' },
    rot: 180,
    wantInset: 'inset(0 0 0 53.8%)',
    wantBand: rect(100, 200, 60, 180),
    teeth: true,
  },
];

interface Built {
  state: Parameters<typeof clipInsetRightPct>[0];
  underNode: StubNode;
  restore: () => void;
}

/** 用**共享的**最小 DOM 桩（`net-dom-stub`）搭一帧：两张卡（被盖卡 + 覆盖卡）+ 各自矩形与朝向输入。 */
function build(c: GridCase): Built {
  const restore = installStubDom();
  const doc = (globalThis as unknown as { document: { body: StubNode } }).document;
  const mk = (uid: string, r: Box, o: OrientInput): StubNode => {
    const n = makeStubEl('div');
    n.className = `card ${o.cls ?? ''}`.trim();
    n.dataset.uid = uid;
    // 真实 DOM 里 `dataset.fxRot` 与 `data-fx-rot` 是同一个属性（桩的 getAttribute 也这么映射）
    if (o.fxRot !== undefined) n.dataset.fxRot = o.fxRot;
    setStubRectFor(n, r);
    doc.body.appendChild(n);
    return n;
  };
  const underNode = mk('under', c.cardRect, c.under);
  mk('over', c.coverRect, c.cover);
  const state = {
    players: [
      { stacks: [[], [], []], hand: [] },
      { stacks: [[], [], []], hand: [] },
    ],
  } as unknown as Parameters<typeof clipInsetRightPct>[0];
  const stacks = state.players[c.owner].stacks as unknown as { uid: string }[][];
  stacks[0] = [{ uid: 'under' }, { uid: 'over' }];
  setFxViewSeat(c.seat);
  return { state, underNode, restore };
}

afterEach(() => { setFxViewSeat(null); });

describe('G3 · 浮层卡 clipPath 的帧一致性（屏幕帧露出带 ⇔ 本地帧 inset，合成回屏幕比对）', () => {
  for (const c of GRID) {
    it(c.name, () => {
      const { state, underNode, restore } = build(c);
      try {
        // ① 旋转输入是**真实**的（同一函数、同一节点 ⇒ 与 buildFxCardAt 建盒时一致）
        expect(fxOrientOf(asEl(underNode)), '本格的真实朝向输入应读出预期的 θ').toBe(c.rot);
        // ② 露出带（参考）= 仓库里"可见区域"的定义本身（两条页面分支都在里面）
        const want = visibleRectOf(state, 'under');
        expect(want, '被盖卡必须能取到露出带').not.toBeNull();
        const wantBand = box(want as DOMRect);
        expect(wantBand, '本格参考带必须是"喂进去的那条"，不能是 6px 下限兜底').toEqual(c.wantBand);
        expect(Math.min(wantBand.width, wantBand.height), '参考带不许退化到下限').toBeGreaterThan(6);
        // ③ 产出：pct（屏幕帧）→ inset（本地帧）
        const pct = clipInsetRightPct(state, 'under');
        expect(pct, '本格必须真的被裁剪（否则后面的断言全部空转）').toBeGreaterThan(0);
        const css = clipInsetCss(state, 'under', pct);
        expect(css, '本地帧四值逐字（含裁哪条边）').toBe(c.wantInset);
        // ④ 核心：把本地 inset 按 θ 合成回屏幕帧 ⇒ 必须等于露出带（1px 内）
        const got = screenBandOfLocalInset(css, c.rot, c.cardRect);
        expect(bandDiff(got, wantBand), `合成回屏幕帧后与露出带不符：${JSON.stringify(got)}`).toBeLessThanOrEqual(1);
        // ⑤ 反空集合：把 inset **直接当屏幕帧**（= 修前的读法）在该格必须**不成立**
        const asScreen = screenBandOfLocalInset(css, 0, c.cardRect);
        if (c.teeth) {
          expect(bandDiff(asScreen, wantBand), '修前读法在本格竟然也对 ⇒ 这条守卫没有牙齿')
            .toBeGreaterThan(1);
        } else {
          expect(bandDiff(asScreen, wantBand), 'θ=0 时两帧重合（这就是"逐字不变"的边界）')
            .toBeLessThanOrEqual(1);
        }
        // ⑥ 修前那句**字面量**（屏幕帧读法）本身也要被抓出来：它再被正确合成时给出的是**错的带**
        const outer = coveredOuterOf(state, 'under');
        const preFix = outer === null
          ? `inset(0 ${(pct * 100).toFixed(1)}% 0 0)`          // 热座（改动前的字面量）
          : vClipInsetCss(pct, outer);                          // 远程页（改动前的出口）
        if (c.teeth) {
          expect(preFix, '修前字符串在本格应与新输出不同').not.toBe(css);
          expect(bandDiff(screenBandOfLocalInset(preFix, c.rot, c.cardRect), wantBand),
            '修前字符串即使**按真实 θ 合成**也应给出错的带（缺陷真的存在）').toBeGreaterThan(1);
        } else {
          expect(preFix, 'θ=0（无朝向输入）⇒ 逐字不变').toBe(css);
        }
      } finally { restore(); }
    });
  }
});

describe('G3 · 热座是否受影响（源码追踪结论的机检化）', () => {
  it('热座场上卡**自己**带 rot-cw/rot-ccw（render.ts:377-380 的缺省朝向）⇒ fxOrientOf = ±90 ⇒ 热座也受影响', () => {
    const src = readSrc('render.ts');
    // 缺省朝向 = ±90（按 owner），并写成**卡节点自己**的类；热座调用点不传 opts ⇒ 走缺省
    expect(src, 'renderStackSlot 的缺省朝向不再是"按 owner 的 ±90"（判据失效，先复核再改）')
      .toMatch(/opts\?\.orient \?\? \(card\.owner === 0 \? 90 : -90\)/);
    expect(src, '朝向类没有加在卡节点上（那会让 fxOrientOf 读不到）')
      .toMatch(/node\.classList\.add\('rot-cw'\)/);
    expect(src, '朝向类没有加在卡节点上（那会让 fxOrientOf 读不到）')
      .toMatch(/node\.classList\.add\('rot-ccw'\)/);
    expect(src, 'data-uid 挂的必须是同一个 node（FX 派发器按它取节点）')
      .toMatch(/node\.dataset\.uid = card\.uid/);
    // 热座调用点：两个 renderStackSlot(...) 都不带第 7 个实参（opts）
    const hotCalls = src.match(/renderStackSlot\(\s*s, [01], line,[\s\S]{0,400}?\n\s*\)/g) ?? [];
    expect(hotCalls.length, '找不到热座的两个 renderStackSlot 调用点').toBeGreaterThanOrEqual(2);
    for (const call of hotCalls) {
      expect(call, '热座调用点带了 opts ⇒ "缺省 ±90"这条推断不再成立').not.toMatch(/\{\s*(orient|fxRot)/);
    }
  });

  it('热座腿的产出**不等于**修前的屏幕帧字面量（"热座零变化"这条豁免不存在）', () => {
    const c = GRID[2]; // 热座 P1：rot-cw
    const { state, restore } = build(c);
    try {
      const pct = clipInsetRightPct(state, 'under');
      const css = clipInsetCss(state, 'under', pct);
      expect(css).toBe('inset(53.8% 0 0 0)');
      expect(css).not.toBe(`inset(0 ${(pct * 100).toFixed(1)}% 0 0)`);
      // 反空集合：热座的真实浮层卡**确实**被旋转（这里是模型 + 源码腿两处都钉）
      expect(fxOrientOf(asEl((globalThis as unknown as { document: Document }).document
        .querySelector('[data-uid="under"]'))), '热座卡的 fxOrientOf 必须是 ±90（不是 0）').toBe(90);
    } finally { restore(); }
  });
});

describe('G3 · 事实链与单一出处的源码腿（改动的前提/结构被钉住）', () => {
  it('浮层卡根元素 = fxOrientOf(原卡) 的旋转，且 clipPath 与它**同元素**', () => {
    const fx = readSrc('effects/index.ts');
    expect(fx, 'buildFxCard 不再按 fxOrientOf 建盒（本修复的前提失效，先复核）')
      .toMatch(/buildFxCardAt\(rect, fxOrientOf\(node\), payload, zIndex, orientOf\(node\)\)/);
    expect(fx, '浮层卡根元素不再用 --fx-rot 旋转（那 clip 就不需要换帧了）')
      .toMatch(/card\.style\.setProperty\('--fx-rot', orientToFxRot\(orient\)\)/);
    expect(fx, '浮层卡根元素不再用 --fx-rot 旋转（那 clip 就不需要换帧了）')
      .toMatch(/card\.style\.transform = 'rotate\(var\(--fx-rot, 0deg\)\)'/);
    // 消费方：两处 clipPath 都写在 buildFxCard 的返回值（= 根元素）上，且都走唯一出口
    const gen3 = readSrc('fx-gen3.ts');
    const clipSites = gen3.match(/c\.style\.clipPath = clipInsetCss\(state, p\.uid, hidden\)/g) ?? [];
    expect(clipSites.length, '伏击/惰性的两处 clipPath 必须都经 clipInsetCss（多/少都是判据失效）').toBe(2);
    expect(gen3, '浮层卡必须来自 api.buildFxCard（否则不是"根元素"）').toMatch(/api\.buildFxCard\(node, p, api\.extraZ\)/);
  });

  it('单一出处：屏幕帧→本地帧的换算只有 fx-seat 的 localInsetCss 一处，消费方不再自拼 inset', () => {
    expect(readSrc('gen3-util.ts'), 'gen3-util 又自己拼 inset(...) 字面量（两处实现必然漂移）')
      .not.toMatch(/inset\(/);
    expect(readSrc('fx-gen3.ts'), 'fx-gen3 又自己拼 inset(...) 字面量').not.toMatch(/inset\(/);
    const util = readSrc('gen3-util.ts');
    expect(util, 'clipInsetCss 的本地帧换算没有走 fx-seat 的唯一出口')
      .toMatch(/localInsetCss\(pct, side, fxOrientOf\(nodeOf\(uid\)\)\)/);
    const seat = readSrc('fx-seat.ts');
    expect(seat, '屏幕帧→本地帧的映射表不见了').toMatch(/const LOCAL_SIDE_OF_SCREEN_SIDE/);
    expect(seat.match(/LOCAL_SIDE_OF_SCREEN_SIDE/g)?.length,
      '映射表被复制成了多份（单一出处被破坏）').toBe(2); // 1 处定义 + 1 处使用
  });
});

/**
 * 已知残余（**本次不修**，只钉住它别被忘掉）。
 *
 * 热座 **P0（rot-cw）** 的真实排列里覆盖者在**左**：
 *  - `.stack.grow-left { justify-content: flex-end }`（styles.css:93）+ DOM 顺序 [最新 … 最旧]
 *    （render.ts:361-366）+ z-index = 下标（render.ts:385）⇒ 最新的（覆盖者）在最左、压住旧卡的**左**半；
 *  - 负 `margin-left`（styles.css:439-440）让每张后续卡只前进 `0.462 × --card-h`。
 *
 * 而热座分支的两条既有定义都假设"覆盖者在**右**"：`visibleRectOf` 走 6px 下限兜底、
 * `clipInsetRightPct` 走 0.94 夹取。二者**在改动前就不一致**（6px vs 6%），本文件只把它记下来：
 * 改判据前必须先由人眼在 5173 上复核"热座 P0 到底露出哪一侧"。
 */
describe('G3 · 已知残余（非本次修复目标）：热座 P0 真实排列下两条既有定义本就不一致', () => {
  it('visibleRectOf 的 6px 下限 ≠ clipInsetRightPct 的 6% 夹取（>1px）', () => {
    const { state, restore } = build({
      name: '热座 P0 真实排列', seat: null, owner: 0,
      cardRect: HOT_CARD,
      coverRect: rect(19.15, 200, 175, 125.6), // 覆盖者在**左**（左移 0.462 × 175 = 80.85）
      under: { cls: 'rot-cw' }, cover: { cls: 'rot-cw' },
      rot: 90, wantInset: '', wantBand: HOT_CARD, teeth: true,
    });
    try {
      const want = box(visibleRectOf(state, 'under') as DOMRect);
      expect(want.width, 'visibleRectOf 的热座分支此时给的是 6px 下限兜底').toBe(6);
      const pct = clipInsetRightPct(state, 'under');
      expect(pct, 'clipInsetRightPct 的热座分支此时夹到 0.94（6%）').toBe(0.94);
      const css = clipInsetCss(state, 'under', pct);
      // 帧换算是**对的**（合成回屏幕帧后是"屏幕左侧 6%"），与"6px"的差是**比例 vs 像素**的既有口径差
      const got = screenBandOfLocalInset(css, 90, HOT_CARD);
      expect(got.left, '本帧理应落在屏幕左侧').toBeCloseTo(100, 6);
      expect(got.width, '屏幕左侧 6% = 175 × 0.06 = 10.5px').toBeCloseTo(10.5, 6);
      expect(Math.abs(got.width - want.width), '两条既有定义的不一致（改动前就存在，>1px）')
        .toBeGreaterThan(1);
    } finally { restore(); }
  });
});
