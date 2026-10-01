import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { installStubDom } from './net-dom-stub';
import { stripComments } from './source-text';
import { drawLogoHex } from '../../src/ui/cardmaker/draw';
import { PROTOCOL_FRONT, ZONES } from '../../src/ui/cardmaker/config';
import type { DrawableImage } from '../../src/ui/cardmaker/images';

/**
 * `drawLogoHex` 的**绘制行为腿**（2026-10-01，用户报"logo 会被洗掉关键位置"之后的加固）。
 *
 * ## 为什么要专门造一个"录制用 2D 上下文"
 *
 * 本仓没有 jsdom，桩的 `getContext()` 恒返回 `null` ⇒ `drawLogoHex` 在桩上**第一步就返回**，
 * "画的是原图还是白化后的离屏图"这件事在成品的测试里**一个字都验不出来**（这正是这一轮
 * 用户报的缺陷能溜过 3049 条用例的原因）。所以这里自己造一份**只记录调用**的 2D 上下文：
 * 它不做像素运算，但**记得住"喂进去的那幅图是哪一张"** —— 而"未勾选去掉背景 ⇒ 原图直上"
 * 这句话在绘制层的**全部含义**就是"`drawImage` 的第一个实参是原图那张对象本身，
 * 且没有任何一次白化（离屏画布 / `source-in` / 白色 `fillRect`）"。
 *
 * ⚠️ 这一组证明的是**绘制调用**，不是像素。真像素由 `.superpowers/cardmaker/browser-truth-cardmaker.mjs`
 * 在真浏览器里读（未勾选时六边形内能读到原图的红/绿二色，勾选时读出来全是白）。
 */

/** 一次调用记录 */
interface Call {
  op: string;
  args: unknown[];
}

/**
 * `draw.ts` 的源码，**剥掉注释**再看。
 * 注释里要留"某个函数被删了、为什么删"的记录（那是这个仓库的既有做法），所以"代码里不许再有"
 * 这类判据必须对剥完注释的文本下断言，否则记录本身会把守卫顶红。
 */
const DRAW_SRC = stripComments(
  readFileSync(fileURLToPath(new URL('../../src/ui/cardmaker/draw.ts', import.meta.url)))
    .subarray(0, 512 * 1024)
    .toString('utf8'),
);

/** 录制桩：方法记调用，属性记录并留痕（白化靠 `globalCompositeOperation` + `fillStyle` 判定） */
interface Recorder {
  calls: Call[];
  props: Record<string, unknown>;
}

function makeRecorder(): { rec: Recorder; ctx: unknown } {
  const rec: Recorder = { calls: [], props: {} };
  const ctx: Record<string, unknown> = {};
  for (const m of ['save', 'restore', 'beginPath', 'moveTo', 'lineTo', 'closePath', 'clip', 'fillRect', 'drawImage']) {
    ctx[m] = (...args: unknown[]): void => { rec.calls.push({ op: m, args }); };
  }
  for (const p of ['globalCompositeOperation', 'fillStyle']) {
    Object.defineProperty(ctx, p, {
      get: () => rec.props[p],
      set: (v: unknown) => { rec.props[p] = v; rec.calls.push({ op: `set:${p}`, args: [v] }); },
    });
  }
  return { rec, ctx };
}

/** `document.createElement('canvas')` 的替身：把它的 2D 上下文接到一份录制桩上 */
interface FakeCanvas {
  el: HTMLCanvasElement;
  rec: Recorder;
}

const restores: Array<() => void> = [];

/** 装桩 DOM + 换掉 `createElement`，返回"这次被创建的每一块画布" */
function install(created: FakeCanvas[]): void {
  restores.push(installStubDom());
  const doc = (globalThis as unknown as { document: { createElement(t: string): unknown } }).document;
  const original = doc.createElement;
  doc.createElement = (t: string): unknown => {
    if (t !== 'canvas') return original(t);
    const { rec, ctx } = makeRecorder();
    const el: Record<string, unknown> = { width: 0, height: 0 };
    el.getContext = (): unknown => ctx;
    const fake = el as unknown as HTMLCanvasElement;
    created.push({ el: fake, rec });
    return fake;
  };
  restores.push(() => { doc.createElement = original; });
}

afterEach(() => {
  while (restores.length > 0) restores.pop()?.();
});

/** 一张 320×100 的"logo"（只用到宽高与身份） */
function makeLogoImage(): DrawableImage {
  return { width: 320, height: 100 } as unknown as DrawableImage;
}

const callsOf = (rec: Recorder, op: string): Call[] => rec.calls.filter((c) => c.op === op);

describe('★ 2026-10-01：logo 的两种画法（drawLogoHex）', () => {
  it('`whiten: false`（未勾选去掉背景）⇒ **原图直上**：只画原图本身，一次白化都没有', () => {
    const created: FakeCanvas[] = [];
    install(created);
    const { rec, ctx } = makeRecorder();
    const img = makeLogoImage();

    drawLogoHex(
      ctx as never,
      img,
      ZONES.hex,
      'v',
      { zoom: 1, offsetX: 0, offsetY: 0, whiten: false },
    );

    // ① **一张离屏画布都没建** —— 白化那条路的入口就是 createElement('canvas')
    expect(created.length, '未勾选却建了离屏画布（说明还是走了白化）').toBe(0);
    // ② 唯一那次 drawImage 喂进去的是**原图那张对象本身**（不是任何副本/离屏图）
    const draws = callsOf(rec, 'drawImage');
    expect(draws).toHaveLength(1);
    expect(draws[0].args[0], '画的不是原图本身 ⇒ "原图直上"是假的').toBe(img);
    // ③ 没有任何白化痕迹：不设 source-in、不铺白色
    expect(callsOf(rec, 'set:globalCompositeOperation'), '未勾选却设了 globalCompositeOperation').toHaveLength(0);
    expect(callsOf(rec, 'fillRect'), '未勾选却铺了白色').toHaveLength(0);
    expect(rec.props.fillStyle).toBeUndefined();
    // ④ 还是裁在六边形里（不是"为了原图直上就不裁了"）
    const ops = rec.calls.map((c) => c.op);
    expect(ops.filter((o) => o === 'clip')).toHaveLength(1);
    expect(ops.indexOf('clip'), 'clip 必须在 drawImage 之前').toBeLessThan(ops.indexOf('drawImage'));
    expect(ops.filter((o) => o === 'closePath')).toHaveLength(1); // 六边形路径闭合了一次
    expect(callsOf(rec, 'lineTo'), '六边形是 6 个顶点（moveTo + 5 lineTo）').toHaveLength(5);
    // ⑤ 铺满六边形的几何：320×100 的图按 cover 放进 124×135 ⇒ 放大 1.35 倍、水平居中
    const [, x, y, w, h] = draws[0].args;
    expect([x, y, w, h]).toEqual([ZONES.hex.x + (ZONES.hex.w - 432) / 2, ZONES.hex.y, 432, 135]);
    // 反向锚点：这个矩形**不是**六边形本身（否则"铺满 + 居中"这件事分辨不出来）
    expect([x, y, w, h]).not.toEqual([ZONES.hex.x, ZONES.hex.y, ZONES.hex.w, ZONES.hex.h]);
  });

  it('`whiten` 缺省（老存档）与显式 `true` 走**同一条**白化路：原图 → 离屏 → 白色 source-in', () => {
    const img = makeLogoImage();
    const sources: unknown[] = [];
    for (const whiten of [undefined, true] as const) {
      const created: FakeCanvas[] = [];
      install(created);
      const { rec, ctx } = makeRecorder();
      drawLogoHex(ctx as never, img, PROTOCOL_FRONT.hex, 'h', { zoom: 1, whiten });
      // ① 建了一块离屏画布，尺寸 = 铺满六边形后的 448×140
      //    （320×100 的图按 cover 放进 144×140 的六边形 ⇒ 放大 1.4 倍）
      expect(created, `whiten=${String(whiten)} 时没有离屏画布`).toHaveLength(1);
      expect([created[0].el.width, created[0].el.height]).toEqual([448, 140]);
      const off = created[0].rec;
      // ② 离屏上：先画原图，再 source-in 铺白（= 只留形状 + 纯白）
      expect(callsOf(off, 'drawImage')[0].args).toEqual([img, 0, 0, 448, 140]);
      expect(off.props.globalCompositeOperation, '没有 source-in ⇒ 白化不成立').toBe('source-in');
      expect(off.props.fillStyle, '铺的不是白色').toBe('#ffffff');
      expect(callsOf(off, 'fillRect')[0].args).toEqual([0, 0, 448, 140]);
      // ③ 主上下文画的是**那块离屏画布**，不是原图
      const main = callsOf(rec, 'drawImage');
      expect(main).toHaveLength(1);
      expect(main[0].args[0], '主上下文直接画了原图 ⇒ 白化被绕过了').toBe(created[0].el);
      expect(main[0].args[0]).not.toBe(img);
      sources.push(main[0].args[0]);
    }
    // 反向锚点（同一条腿内、同一个 img 对象）：显式 `false` 时喂进去的**就是** img，
    // 于是"缺省/true 时喂的不是 img"这句不是恒真。
    const createdPlain: FakeCanvas[] = [];
    install(createdPlain);
    const plain = makeRecorder();
    drawLogoHex(plain.ctx as never, img, PROTOCOL_FRONT.hex, 'h', { zoom: 1, whiten: false });
    expect(createdPlain, 'false 那条路不该建离屏画布').toHaveLength(0);
    expect(callsOf(plain.rec, 'drawImage')[0].args[0]).toBe(img);
    expect(sources[0]).not.toBe(img);
    expect(sources[1]).not.toBe(img);
  });

  it('两种画法的分界就是 `whiten !== false`（缺省 = 白化，只有**显式 false** 才是原图直上）', () => {
    // 行为腿已经钉住了两条路各自的样子；这一条钉的是**判据本身**：老存档里根本没有
    // `whiten` 这个键，缺省必须是"白化"（与参考项目一致）。写成 `=== true` 会让所有老存档
    // 一夜之间变成"原图直上"（卡面上冒出一整块带背景色的图），写成 `!== true` 则相反。
    expect(DRAW_SRC, '判据不是"不等于 false" ⇒ 老存档（没有这个键）会变成原图直上').toContain('lg.whiten !== false');
    expect(DRAW_SRC, '出现了一个把 whiten 当真的判据').not.toMatch(/whiten\s*===\s*true/);
    expect(DRAW_SRC, '出现了一个把 whiten 当假的判据').not.toMatch(/whiten\s*!==\s*true/);
  });

  it('★ 「按竖版编译卡导出」删掉之后，它那条**旋转死路径**也不许留在绘制层', () => {
    // 用户 2026-10-01："图中的这四个按钮我感觉没啥用呀，是不是重复了" ⇒ 那枚按钮连同
    // `rotateToPortrait()` 一起删（模式 tab 就能切竖版，那枚按钮要么重复、要么永远是摆设）。
    // 这条腿是"死代码不许回来"的锚点：函数、以及它那次 90° 旋转的调用都在代码里消失。
    expect(DRAW_SRC, '竖版旋转那条死路径（rotateToPortrait）还在绘制层里').not.toContain('rotateToPortrait');
    expect(DRAW_SRC, '代码里还留着那次竖版 90° 旋转').not.toContain('rotate(-Math.PI / 2)');
    // 反向锚点：真正还在用的两个绘制函数一个都没被误删
    expect(DRAW_SRC).toContain('export function toPoker(');
    expect(DRAW_SRC).toContain('export function drawLogoHex(');
  });
});
