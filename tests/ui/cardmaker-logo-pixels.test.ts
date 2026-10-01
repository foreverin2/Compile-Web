import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { installStubDom } from './net-dom-stub';
import { drawLogoHex } from '../../src/ui/cardmaker/draw';
import { ZONES } from '../../src/ui/cardmaker/config';
import { clampLogoScale } from '../../src/ui/cardmaker/geometry';
import type { DrawableImage } from '../../src/ui/cardmaker/images';

/**
 * ★ 2026-10-01（用户要求）：**logo 缩放的像素腿** —— "六边形内已画像素数明显变大" +
 * "六边形外的像素为 0（裁剪生效）"。
 *
 * ## 为什么这个文件里自带一个**极小的软件光栅化 2D 上下文**
 *
 * 本仓没有 jsdom，官方桩的 `getContext()` 恒返回 `null` ⇒ 绘制层在桩上第一步就返回，
 * "像素"这件事一个字都验不出来（`cardmaker-draw.test.ts` 只能验"调用序列"，验不了面积）。
 * 所以这里自己实现一个**只做点内测试 + 填色**的假上下文：
 *  - `beginPath / moveTo / lineTo / closePath / clip`：把路径存成多边形，裁剪 = 之后每个像素
 *    都必须落在**所有**已压入的多边形内（多边形求交 = 点内测试的合取）；
 *  - `drawImage`：把源图按目标矩形**逐像素重采样**填进缓冲；
 *  - `fillRect` + `globalCompositeOperation = 'source-in'`：照白化那条路的语义实现
 *    （只保留目标已有 alpha 的地方，颜色换成 `fillStyle`）；
 *  - `getImageData`：把缓冲裁一块出来。
 *
 * ⚠️ 它是**独立实现**（点内测试用射线法，与产出代码的 `hexPath` 无关）：产出代码少调一次
 * `clip()`、或者用了别的路径，这里"六边形外的像素 = 0"当场变红。这也正是这一组存在的意义。
 */

type RGBA = readonly [number, number, number, number];

/** 逐像素可采样的位图（测试自己的图 / 假画布都满足） */
interface RasterSource {
  width: number;
  height: number;
  at(x: number, y: number): RGBA;
}

interface RasterCanvas extends RasterSource {
  getContext(kind: string): unknown;
  /** 缓冲（只读用） */
  buf: Uint8ClampedArray;
  /** 元素身份：会被塞进 `document.createElement('canvas')` 的返回值 */
  el: Record<string, unknown>;
}

/** 射线法：点是否在多边形内（顶点数组 `[[x,y],…]`） */
function inPoly(poly: ReadonlyArray<readonly [number, number]>, x: number, y: number): boolean {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

/**
 * 那六个顶点（尖朝上下）——**按配置里的平边位置独立算一遍**（`flatA/flatB` 从 `ZONES.hex` 读，
 * 不写死常数：万一六边形形状被调整，这里的"六边形内/外"跟着走，而**不是**跟着产出代码的
 * `hexPath()` 走 —— 那正是这一组要独立的地方）。
 */
export function hexPolygon(box: { x: number; y: number; w: number; h: number; flatA?: number; flatB?: number }): Array<[number, number]> {
  const cx = box.x + box.w / 2;
  const a = box.flatA ?? 0.25;
  const b = box.flatB ?? 0.75;
  return [
    [cx, box.y],
    [box.x + box.w, box.y + box.h * a],
    [box.x + box.w, box.y + box.h * b],
    [cx, box.y + box.h],
    [box.x, box.y + box.h * b],
    [box.x, box.y + box.h * a],
  ];
}

function makeRasterCanvas(initW: number, initH: number): RasterCanvas {
  /**
   * ⚠️ 宽高必须**可改**（`drawLogoHex()` 白化那条路会 `off.width = 448` 之后再画）：
   * 改了宽高要**重新分配缓冲**，否则那块离屏画布的缓冲还是 1×1、采样全落在一个透明像素上，
   * 白化腿就会"什么都没画"地假绿/假红。所以缓冲放在一个可变对象里，宽高用访问器。
   */
  let w = initW;
  let h = initH;
  const state = { buf: new Uint8ClampedArray(w * h * 4) };
  const resize = (nw: number, nh: number): void => {
    if (nw === w && nh === h) return;
    w = nw; h = nh;
    state.buf = new Uint8ClampedArray(w * h * 4);
  };
  /** 已压入的裁剪多边形（合取） */
  let clip: Array<Array<[number, number]>> = [];
  let path: Array<[number, number]> = [];
  const stack: Array<{ clip: Array<Array<[number, number]>>; gco: string; fill: string }> = [];
  let gco = 'source-over';
  let fillStyle = '#000000';

  const parseFill = (): RGBA => {
    const m = /^#([0-9a-f]{6})$/i.exec(fillStyle);
    if (m === null) return [0, 0, 0, 255];
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 255];
  };
  const inside = (x: number, y: number): boolean => clip.every((poly) => inPoly(poly, x, y));

  const api: Record<string, unknown> = {
    save: (): void => { stack.push({ clip: clip.map((p) => p.map((q) => [...q] as [number, number])), gco, fill: fillStyle }); },
    restore: (): void => {
      const s = stack.pop();
      if (s !== undefined) { clip = s.clip; gco = s.gco; fillStyle = s.fill; }
    },
    beginPath: (): void => { path = []; },
    moveTo: (x: number, y: number): void => { path.push([x, y]); },
    lineTo: (x: number, y: number): void => { path.push([x, y]); },
    closePath: (): void => { /* 顶点已经闭合（射线法不需要重复首点） */ },
    clip: (): void => { if (path.length >= 3) clip = [...clip, path.map((p) => [...p] as [number, number])]; },
    fillRect: (fx: number, fy: number, fw: number, fh: number): void => {
      const buf = state.buf;
      const c = parseFill();
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4;
          const insideRect = x + 0.5 >= fx && x + 0.5 < fx + fw && y + 0.5 >= fy && y + 0.5 < fy + fh && inside(x + 0.5, y + 0.5);
          if (gco === 'source-in') {
            // source-in：源（这块纯色）只在目标已有 alpha 的地方留下 ⇒ 其余一律清空
            if (!insideRect || buf[i + 3] === 0) { buf[i] = 0; buf[i + 1] = 0; buf[i + 2] = 0; buf[i + 3] = 0; }
            else { buf[i] = c[0]; buf[i + 1] = c[1]; buf[i + 2] = c[2]; buf[i + 3] = 255; }
          } else if (insideRect) {
            buf[i] = c[0]; buf[i + 1] = c[1]; buf[i + 2] = c[2]; buf[i + 3] = c[3];
          }
        }
      }
    },
    drawImage: (src: RasterSource, dx: number, dy: number, dw: number, dh: number): void => {
      const buf = state.buf;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          if (!inside(x + 0.5, y + 0.5)) continue;
          if (x + 0.5 < dx || x + 0.5 >= dx + dw || y + 0.5 < dy || y + 0.5 >= dy + dh) continue;
          const sx = Math.min(src.width - 1, Math.max(0, Math.floor(((x + 0.5 - dx) / dw) * src.width)));
          const sy = Math.min(src.height - 1, Math.max(0, Math.floor(((y + 0.5 - dy) / dh) * src.height)));
          const [r, g, b, a] = src.at(sx, sy);
          const i = (y * w + x) * 4;
          // 源透明的地方**不清空**已有内容（真实 canvas 的 source-over 语义；本组只用不透明源）
          if (a === 0) continue;
          buf[i] = r; buf[i + 1] = g; buf[i + 2] = b; buf[i + 3] = a;
        }
      }
    },
    getImageData: (sx: number, sy: number, sw: number, sh: number): { data: Uint8ClampedArray } => {
      const buf = state.buf;
      const out = new Uint8ClampedArray(sw * sh * 4);
      for (let y = 0; y < sh; y++) {
        for (let x = 0; x < sw; x++) {
          const si = ((sy + y) * w + (sx + x)) * 4;
          const di = (y * sw + x) * 4;
          out[di] = buf[si]; out[di + 1] = buf[si + 1]; out[di + 2] = buf[si + 2]; out[di + 3] = buf[si + 3];
        }
      }
      return { data: out };
    },
    translate: (): void => { /* 本组用不到 */ },
    rotate: (): void => { /* 本组用不到 */ },
  };
  for (const p of ['globalCompositeOperation', 'fillStyle']) {
    Object.defineProperty(api, p, {
      get: () => (p === 'globalCompositeOperation' ? gco : fillStyle),
      set: (v: unknown) => { if (p === 'globalCompositeOperation') gco = String(v); else fillStyle = String(v); },
    });
  }
  const el: Record<string, unknown> = { getContext: (k: string) => (k === '2d' ? api : null) };
  Object.defineProperty(el, 'width', { get: () => w, set: (v: number) => resize(Math.max(1, Math.round(v)), h) });
  Object.defineProperty(el, 'height', { get: () => h, set: (v: number) => resize(w, Math.max(1, Math.round(v))) });
  /**
   * ⚠️ `at()` 必须挂在**元素**上（不只是外面那个对象）：`drawLogoHex()` 白化那条路交给
   * `drawImage` 的是 `off`（= 这个元素），主画布要能按像素采样它。
   */
  el.at = (x: number, y: number): RGBA => {
    const buf = state.buf;
    const i = (y * w + x) * 4;
    return [buf[i], buf[i + 1], buf[i + 2], buf[i + 3]];
  };
  return {
    get width() { return w; },
    get height() { return h; },
    get buf() { return state.buf; },
    el,
    at: (x: number, y: number): RGBA => (el.at as (a: number, b: number) => RGBA)(x, y),
    getContext: (k: string) => (k === '2d' ? api : null),
  };
}

const restores: Array<() => void> = [];
afterEach(() => { while (restores.length > 0) restores.pop()?.(); });

/** 每条腿都装一次：白化那条路要 `document.createElement('canvas')`，原图直上那条路不需要 —— 装上无害 */
beforeEach(() => { installRaster(); });

/** 装桩 DOM，并把 `createElement('canvas')` 换成"软件光栅化"的那一版（白化那条路要用） */
function installRaster(): void {
  restores.push(installStubDom());
  const doc = (globalThis as unknown as { document: { createElement(t: string): unknown } }).document;
  doc.createElement = (t: string): unknown => (t === 'canvas' ? makeRasterCanvas(1, 1).el : { tag: t });
}

/** 一张 64×64 的测试图：中间 24×24 不透明洋红，四周透明（这样"画了多少"一眼可数） */
function testLogo(): DrawableImage {
  const size = 64;
  return {
    width: size,
    height: size,
    at: (x: number, y: number): RGBA => (
      x >= 20 && x < 44 && y >= 20 && y < 44 ? [255, 0, 255, 255] : [0, 0, 0, 0]
    ),
  } as unknown as DrawableImage;
}

const isPink = (c: RGBA): boolean => c[0] > 200 && c[1] < 80 && c[2] > 200;
const isWhite = (c: RGBA): boolean => c[0] > 230 && c[1] > 230 && c[2] > 230;

/** 画一次 logo，返回"六边形内 / 六边形外"的像素计数 */
function paint(z: number, whiten: boolean): { inside: number; outside: number; outsideBox: number } {
  const cv = makeRasterCanvas(744, 1039);
  const ctx = cv.getContext('2d');
  drawLogoHex(ctx as never, testLogo(), ZONES.hex, 'v', { zoom: z, offsetX: 0, offsetY: 0, whiten });
  const poly = hexPolygon(ZONES.hex);
  const test = whiten ? isWhite : isPink;
  let inside = 0;
  let outside = 0;
  let outsideBox = 0;
  for (let y = 0; y < 1039; y++) {
    for (let x = 0; x < 744; x++) {
      if (!test(cv.at(x, y))) continue;
      const inBox = x >= ZONES.hex.x && x < ZONES.hex.x + ZONES.hex.w
        && y >= ZONES.hex.y && y < ZONES.hex.y + ZONES.hex.h;
      if (inPoly(poly, x + 0.5, y + 0.5)) inside += 1;
      else { outside += 1; if (!inBox) outsideBox += 1; }
    }
  }
  return { inside, outside, outsideBox };
}

describe('★ 2026-10-01：logo 缩放的像素腿（软件光栅化假上下文）', () => {
  it('放大 ⇒ 六边形内已画像素**明显变大**，且六边形外**一个像素都没有**', () => {
    const at100 = paint(1, false);
    const at160 = paint(1.6, false);
    const at50 = paint(0.5, false);

    // 裁剪：三种倍数下，六边形外（含包框外）都是 0
    expect(at100.outside, '100% 时六边形外有 logo 像素').toBe(0);
    expect(at160.outside, '160% 时六边形外有 logo 像素（放大之后溢出到卡面别处了）').toBe(0);
    expect(at160.outsideBox, '160% 时有像素跑出六边形的包框').toBe(0);
    // 面积随倍数走（不透明方块 = 24×24 源像素，落在六边形内部）
    expect(at160.inside, `160% 的已画像素 ${at160.inside} 不比 100% 的 ${at100.inside} 大`).toBeGreaterThan(at100.inside);
    expect(at50.inside, '缩小到 50% 之后已画像素没有变小').toBeLessThan(at100.inside);
    // 具体读数（本文件实测）：100% = 2550、160% = 6561、50% = 650
    expect(at100.inside).toBe(2550);
    expect(at160.inside).toBe(6561);
    expect(at50.inside).toBe(650);
  });

  it('**白化那条路**同样支持缩放（形状被染白，仍裁在六边形内）', () => {
    const at100 = paint(1, true);
    const at160 = paint(1.6, true);
    expect(at100.outside).toBe(0);
    expect(at160.outside).toBe(0);
    expect(at160.inside).toBeGreaterThan(at100.inside);
    // 白化之后颜色只剩白色（洋红一个都不剩）
    const cv = makeRasterCanvas(744, 1039);
    drawLogoHex(cv.getContext('2d') as never, testLogo(), ZONES.hex, 'v', { zoom: 1.6, whiten: true });
    let pink = 0;
    for (let y = 0; y < 1039; y += 1) for (let x = 0; x < 744; x += 1) if (isPink(cv.at(x, y))) pink += 1;
    expect(pink, '白化之后仍有原色像素').toBe(0);
  });

  it('夹取与上下限：0.5~2 之外的值被夹住（滑杆给不出的倍数也不会画出界）', () => {
    expect(clampLogoScale(0.1)).toBe(0.5);
    expect(clampLogoScale(9)).toBe(2);
    expect(clampLogoScale(undefined)).toBe(1);
    // 画出来与"夹到 2"完全一致（不是"用 9 画了一次、只是滑杆显示 200%"）
    const clamped = paint(9, false);
    const at200 = paint(2, false);
    expect(clamped.inside).toBe(at200.inside);
    expect(clamped.outside).toBe(0);
  });
});
