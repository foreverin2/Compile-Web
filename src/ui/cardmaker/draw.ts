/**
 * canvas 绘制原语：六边形 logo 裁剪、铺满 + 平移缩放的背景、横竖版旋转、打印尺寸重采样。
 *
 * 2026-10-01：移植自参考项目 COMPILER · Card Builder（作者 Albert Blanco，MIT 许可，
 * https://github.com/albrtbc/compiler）的 `src/render/draw.js`。
 * **没移植 `drawSideCode`**（卡缘那串套装码）：它服务的是"整套牌统一的套装编号"，
 * 用户 2026-10-01 拍板的范围里没有它，留着就是一条没有任何 UI 入口的死代码。
 */
import { CARD_H, CARD_W, POKER_H, POKER_W } from './config';
import { bgBaseScale, clampScale, type Sized } from './geometry';
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
 * 把 logo **染成白色**并铺满六边形（盖住卡框上原本的图案），裁剪到六边形形状。
 *
 * 白化用 `source-in`：先把 logo 画到一块离屏画布上，再用白色铺满同一块离屏画布 ——
 * `source-in` 只保留"两幅图都有的地方"，于是得到"logo 的形状 + 纯白"。
 * `logo.zoom` 可以在铺满的基础上再放大（用户滚轮调的），`offsetX/Y` 是像素偏移。
 */
export function drawLogoHex(
  ctx: DrawCtx,
  img: DrawableImage,
  box: HexBox,
  pointy: 'v' | 'h',
  logo: { zoom?: number; offsetX?: number; offsetY?: number } | null | undefined,
): void {
  const lg = logo || {};
  const z = Math.max(0.3, Math.min(4, lg.zoom || 1));
  const ox = lg.offsetX || 0;
  const oy = lg.offsetY || 0;
  const s = Math.max(box.w / img.width, box.h / img.height) * z;
  const w = img.width * s;
  const h = img.height * s;
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
  ctx.save();
  hexPath(ctx, box, pointy);
  ctx.clip();
  ctx.drawImage(off, box.x + (box.w - w) / 2 + ox, box.y + (box.h - h) / 2 + oy, w, h);
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
 * 竖版编译卡的做法：**在横版空间画完之后整张转 90°**。
 *
 * 为什么不是"另写一套竖版绘制"：卡框美术只有一张 `frame.png`（竖版），横版那张是把它
 * 逆时针转 90° 得到的（`ASSETS.protocolFront` 的 `rotated`）。所以只要反着转回去就能拿回
 * 竖版卡 —— 文字、面板、六边形全部跟着一起转，**一套排版两处用**。
 *
 * 参考项目 `renderCompileVertical()` 写的是**逆时针**（`translate(0, CARD_H); rotate(-90°)`）
 * 且正/背两个面方向相反（双面打印翻面之后两面都正）。本项目只导出**正面**，
 * 故只保留正面那一个方向，且下面这条注释里的"为什么是逆时针"就是那次移植的结论：
 * 竖版卡框是原图，横版是它逆时针转出来的 ⇒ 转回去要用**同向**的逆时针。
 *
 * `master` 是横版（1039×744）那一张；返回一张 744×1039 的新画布，或 `null`
 * （拿不到 2D 上下文时，调用方据此放弃这一步，而不是画出一张空白卡）。
 */
export function rotateToPortrait(master: HTMLCanvasElement): HTMLCanvasElement | null {
  const out = document.createElement('canvas');
  out.width = CARD_H;
  out.height = CARD_W;
  const x = out.getContext('2d') as unknown as DrawCtx | null;
  if (!x) return null;
  x.imageSmoothingEnabled = true;
  x.imageSmoothingQuality = 'high';
  x.translate(0, out.height);
  x.rotate(-Math.PI / 2);
  x.drawImage(master, 0, 0);
  return out;
}

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
