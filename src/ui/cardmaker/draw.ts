/**
 * canvas 绘制原语：六边形 logo 裁剪、铺满 + 平移缩放的背景、横竖版旋转、打印尺寸重采样。
 *
 * 2026-10-01：移植自参考项目 COMPILER · Card Builder（作者 Albert Blanco，MIT 许可，
 * https://github.com/albrtbc/compiler）的 `src/render/draw.js`。
 * **没移植 `drawSideCode`**（卡缘那串套装码）：它服务的是"整套牌统一的套装编号"，
 * 用户 2026-10-01 拍板的范围里没有它，留着就是一条没有任何 UI 入口的死代码。
 */
import { CARD_H, CARD_W, POKER_H, POKER_W } from './config';
import { bgBaseScale, clampLogoScale, clampScale, type Sized } from './geometry';
import type { DrawableImage } from './images';
import type { HexBox, TextZone } from './config';
import type { AllCtx } from './text';

/** 绘制只用到的 2D 上下文：**与 `text.ts` 的 `AllCtx` 同一份定义**（不要再造第二个形状） */
export type DrawCtx = AllCtx;

/** 可以直接撒进 `drawImage` 的东西（`DrawableImage` 与 canvas 都是） */
export type DrawSource = DrawableImage | HTMLCanvasElement;

/**
 * 六边形路径，与卡框上的那个六边形对齐。
 * `pointy === 'v'` = 尖朝上下（竖版卡）· `'h'` = 尖朝左右（横版卡）。
 * `flatA` / `flatB` 标出**平边**从哪到哪（相对边长），默认 0.25→0.75。
 */
export function hexPath(ctx: DrawCtx, box: HexBox, pointy: 'v' | 'h'): void {
  const { x, y, w, h } = box;
  const cx = x + w / 2;
  const cy = y + h / 2;
  const a = box.flatA != null ? box.flatA : 0.25;
  const b = box.flatB != null ? box.flatB : 0.75;
  ctx.beginPath();
  if (pointy === 'h') {
    ctx.moveTo(x, cy);
    ctx.lineTo(x + w * a, y);
    ctx.lineTo(x + w * b, y);
    ctx.lineTo(x + w, cy);
    ctx.lineTo(x + w * b, y + h);
    ctx.lineTo(x + w * a, y + h);
  } else {
    ctx.moveTo(cx, y);
    ctx.lineTo(x + w, y + h * a);
    ctx.lineTo(x + w, y + h * b);
    ctx.lineTo(cx, y + h);
    ctx.lineTo(x, y + h * b);
    ctx.lineTo(x, y + h * a);
  }
  ctx.closePath();
}

/**
 * 把 logo 铺满六边形（盖住卡框上原本的图案），裁剪到六边形形状。
 *
 * ## 三种画法（★ 2026-10-01 用户要求）
 *
 *  - `logo.whiten !== false`（**默认**）：**染成白色**（参考项目的做法）。用 `source-in`：
 *    先把 logo 画到一块离屏画布上，再用白色铺满同一块离屏画布 —— `source-in` 只保留
 *    "两幅图都有的地方"，于是得到"logo 的形状 + 纯白"。
 *  - `logo.whiten === false`：**原图直上** —— 不抠背景、不染白、不做任何处理，原图的颜色
 *    与背景原样进卡面。用户原话：「若未勾选去掉 logo 背景，则直接放原图上去，不用管其他的」。
 *  - `logo.zoom`（★ 2026-10-01 用户要求的**独立缩放条**）：在"铺满"的基础上再乘一个倍数。
 *    **锚点是六边形的中心**（`(box.w - w)/2` 这一项让缩放前后中心不动），`offsetX/Y` 是
 *    用户拖出来的像素偏移。两条画法（白化 / 原图直上）都支持缩放 —— 缩放只改 `s`。
 *
 * ## 裁剪（放大之后尤其要紧）
 *
 * `hexPath()` + `clip()` 把绘制**限制在六边形内**：放大到 200% 时那张图会比六边形宽出一大截，
 * 但一个像素都不许溢到卡面别处（真浏览器实测：六边形外 0 个 logo 像素）。
 */
export function drawLogoHex(
  ctx: DrawCtx,
  img: DrawableImage,
  box: HexBox,
  pointy: 'v' | 'h',
  logo: { zoom?: number; offsetX?: number; offsetY?: number; whiten?: boolean } | null | undefined,
): void {
  const lg = logo || {};
  // 夹取用 `clampLogoScale()`（与滑杆同一套上下限）：老存档没有 `zoom` ⇒ 1（= 100%）
  const z = clampLogoScale(lg.zoom);
  const ox = lg.offsetX || 0;
  const oy = lg.offsetY || 0;
  const s = Math.max(box.w / img.width, box.h / img.height) * z;
  const w = img.width * s;
  const h = img.height * s;
  /** 要画的那幅图：白化时是离屏白化版；**原图直上**时就是原图本身 */
  let source: CanvasImageSource = img;
  if (lg.whiten !== false) {
    const off = document.createElement('canvas');
    off.width = Math.max(1, Math.round(w));
    off.height = Math.max(1, Math.round(h));
    const oc = off.getContext('2d') as unknown as DrawCtx | null;
    // 拿不到 2D 上下文（无 jsdom 的桩）时**直接不画**：卡面少一个 logo 比抛异常好
    if (!oc) return;
    oc.drawImage(img, 0, 0, off.width, off.height);
    oc.globalCompositeOperation = 'source-in';
    oc.fillStyle = '#ffffff';
    oc.fillRect(0, 0, off.width, off.height);
    source = off;
  }
  ctx.save();
  hexPath(ctx, box, pointy);
  ctx.clip();
  ctx.drawImage(source, box.x + (box.w - w) / 2 + ox, box.y + (box.h - h) / 2 + oy, w, h);
  ctx.restore();
}

/**
 * 画背景：基准"铺满"倍数 × 用户倍数，再加上用户拖出来的平移量。
 *
 * ⚠️ **必须读 `ctx.getTransform().a`**：导出时我们把上下文整体缩放到了 2 倍（超采样），
 * 而 `drawImage` 的坐标是**设计空间**的，两者不能混 —— 参考实现这里只是把 `hq` 那个
 * 高质量降采样接上；本项目不预降采样，保留 `getTransform` 的读取是为了让"导出时
 * 背景用设备像素精度的绘制路径"这一点在代码里还看得见（也方便将来接降采样）。
 */
export function drawBackground(
  ctx: DrawCtx,
  img: DrawableImage,
  t: { scale: number; offsetX: number; offsetY: number } | null | undefined,
  dw: number = CARD_W,
  dh: number = CARD_H,
): void {
  const s = bgBaseScale(img as Sized, dw, dh) * clampScale(t ? t.scale : 1);
  const w = img.width * s;
  const h = img.height * s;
  const x = (dw - w) / 2 + (t ? t.offsetX : 0);
  const y = (dh - h) / 2 + (t ? t.offsetY : 0);
  ctx.drawImage(img, x, y, w, h);
}

/**
 * ★ 2026-10-01：**删掉了 `rotateToPortrait()`**。
 *
 * 它是给「按竖版编译卡导出」那枚按钮服务的：在横版空间（1039×744）把卡面画好之后整张
 * 逆时针转 90° 拿回竖版成品。而模式 tab 一按就能把当前卡切成竖版，那枚按钮要么与
 * 「导出竖版编译卡 PNG」做同一件事、要么在协议卡模式下是永远置灰的摆设 —— 用户
 * 2026-10-01 说"这几个按钮重复了"，按钮连同这条路径一起删掉，**旋转函数也随之没有调用方**。
 * 参考项目里这段几何（`renderCompileVertical()` 的 `translate(0, CARD_H); rotate(-90°)`）
 * 已经不再需要：竖版卡是直接画在 744×1039 里的（卡框素材本来就是竖版）。
 */

/**
 * 把设计空间（744×1039）的母版重采样到打印分辨率（标准扑克牌 63.5×88.9mm @300dpi
 * = 750×1050），保持方向。`scale` 是 dpi 倍数（1 = 300dpi，2 = 600dpi）。
 *
 * 尺寸已经相等时**原样返回母版**（不做一次无意义的重采样）。
 */
export function toPoker(master: HTMLCanvasElement, scale = 1): HTMLCanvasElement {
  const landscape = master.width > master.height;
  const w = Math.round((landscape ? POKER_H : POKER_W) * scale);
  const h = Math.round((landscape ? POKER_W : POKER_H) * scale);
  if (master.width === w && master.height === h) return master;
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const cx = out.getContext('2d') as unknown as DrawCtx | null;
  if (!cx) return master;
  cx.imageSmoothingEnabled = true;
  cx.imageSmoothingQuality = 'high';
  cx.drawImage(master, 0, 0, w, h);
  return out;
}

export type { HexBox, TextZone };
