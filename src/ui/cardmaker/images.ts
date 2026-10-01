/**
 * 图片加载 / 缓存 / 重编码，以及网页字体装载。
 *
 * 2026-10-01：移植自参考项目 COMPILER · Card Builder（作者 Albert Blanco，MIT 许可，
 * https://github.com/albrtbc/compiler）的 `src/core/images.js`。**没移植的三块**及理由：
 *  - `encodeForShare` / `dataUrlBytes`：那是"分享短链"那条路（gzip + dpaste）用的，
 *    本项目不做分享短链（用户 2026-10-01 拍板的范围）；
 *  - `hqDownscaled`（反复折半的高质量降采样）：它服务的是"导出/分享时把 8000px 的图
 *    压到 744px"，而本项目在**上传时**就把图缩到 2000px（`normalizeImage`），
 *    渲染时再让浏览器的 `imageSmoothingQuality = 'high'` 走一次即可 —— 少一条
 *    "缓存按目标宽度分层"的复杂度；
 *  - `getValueOverlay` 的参考实现"读不到文件就静默回 null"，这里保留同一语义
 *    （素材目录里只有 value_1..6，其它数值没有专属底图）。
 */
import {
  ASSET_BASE,
  LOGO_MAX_DIM,
  PRESETS,
  UPLOAD_JPEG_QUALITY,
  UPLOAD_MAX_DIM,
} from './config';

/** 能被 canvas 直接绘制的位图（三档解码都归到这个形状） */
export type DrawableImage = CanvasImageSource & { width: number; height: number };

/**
 * 解码一张图。**两档降级**：
 *  1. `createImageBitmap`（浏览器主路径，`blob:` URL，同源限制不适用于 blob）；
 *  2. `new Image()` + data URL / 同源 URL。
 *
 * 第一档存在的理由：`<img>` 解码是**延迟**的（第一次 `drawImage` 可能同步解码一个
 * 1.6MB 的 JPEG，掉帧），而 `createImageBitmap` 解完才 resolve。
 * 第二档是**所有**环境都有的兜底（也是单测里能被桩替换的那一档）。
 */
export async function loadImage(src: string): Promise<DrawableImage> {
  if (typeof createImageBitmap === 'function' && typeof fetch === 'function') {
    try {
      const res = await fetch(src);
      if (res.ok) {
        const blob = await res.blob();
        return (await createImageBitmap(blob)) as DrawableImage;
      }
    } catch {
      /* 落到第二档 */
    }
  }
  return await new Promise<DrawableImage>((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => { resolve(img as unknown as DrawableImage); };
    img.onerror = () => { reject(new Error(`图片加载失败：${src}`)); };
    img.src = src;
  });
}

/* ── 缓存 ──────────────────────────────────────────────────────────────── */

/** 预设背景：名字 → 已解码的图（全分辨率，用户在屏上缩放时不该重复解码） */
const presetCache = new Map<string, DrawableImage>();
/** data URL → 已解码的图（上传的背景与 logo 共用） */
const dataUrlCache = new Map<string, DrawableImage>();
/** 数值底图 `value_<n>.png`：没这个文件时缓存 null（不重复 404） */
const valueOverlayCache = new Map<string, DrawableImage | null>();

/** 预设背景的 URL。名字只允许 `PRESETS` 里的那 15 个（见 `presetUrl` 的守卫）。 */
export function presetUrl(name: string): string {
  return `${ASSET_BASE}/card-backgrounds/${name}.jpg`;
}

export async function getPresetImage(name: string): Promise<DrawableImage> {
  const hit = presetCache.get(name);
  if (hit) return hit;
  const img = await loadImage(presetUrl(name));
  presetCache.set(name, img);
  return img;
}

export async function getImageFromDataUrl(dataUrl: string | null): Promise<DrawableImage | null> {
  if (!dataUrl) return null;
  const hit = dataUrlCache.get(dataUrl);
  if (hit) return hit;
  const img = await loadImage(dataUrl);
  dataUrlCache.set(dataUrl, img);
  return img;
}

/**
 * 数值底图（`card-frame/value_<n>.png`）：只有数值型且素材里真有这张图时才返回，
 * 否则返回 `null`（缓存）—— 卡面照常渲染，只是少一层底图，**不报错**。
 */
export async function getValueOverlay(value: string): Promise<DrawableImage | null> {
  const v = String(value ?? '').trim();
  if (!/^[0-9]+$/.test(v)) return null;
  const hit = valueOverlayCache.get(v);
  if (hit !== undefined) return hit;
  let img: DrawableImage | null = null;
  try {
    img = await loadImage(`${ASSET_BASE}/card-frame/value_${v}.png`);
  } catch {
    img = null;
  }
  valueOverlayCache.set(v, img);
  return img;
}

/** 清掉全部图片缓存（单测用；避免用例之间互相污染）。 */
export function resetImageCachesForTest(): void {
  presetCache.clear();
  dataUrlCache.clear();
  valueOverlayCache.clear();
}

/* ── 重编码 ────────────────────────────────────────────────────────────── */

/**
 * 把用户上传的图缩到上限之内再编码回去。
 *
 * **为什么必须缩**（与参考项目的取舍相反，那边为了打印质量保留原图，代价是牌组只能
 * 活在本机 IndexedDB 里）：本项目要求"自定义图以 base64 内嵌进牌组 JSON"，
 * 一张 4000×3000 的照片原样 base64 是 15MB 量级，一个牌组就爆。卡面只有 744px 宽、
 * 导出 750px，所以 2000px 已经够任何缩放与裁切。
 *
 * ⚠️ 本项目**零运行时依赖**：只用了浏览器自带的 `<canvas>` + `toDataURL`。
 */
export function normalizeImage(
  dataUrl: string,
  maxDim: number = UPLOAD_MAX_DIM,
  mime = 'image/jpeg',
  quality: number = UPLOAD_JPEG_QUALITY,
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxDim / img.width, maxDim / img.height);
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const cx = c.getContext('2d');
      if (!cx) { reject(new Error('这台设备拿不到 2D 画布，无法处理上传的图片')); return; }
      cx.imageSmoothingEnabled = true;
      cx.imageSmoothingQuality = 'high';
      cx.drawImage(img, 0, 0, w, h);
      resolve(c.toDataURL(mime, quality));
    };
    img.onerror = () => { reject(new Error('这张图片解不开（格式不支持或文件损坏）')); };
    img.src = dataUrl;
  });
}

/** logo 专用：缩到 320px 并存成 PNG（要保留透明通道，不能转 JPEG） */
export function normalizeLogo(dataUrl: string): Promise<string> {
  return normalizeImage(dataUrl, LOGO_MAX_DIM, 'image/png', 1);
}

/* ── 网页字体 ──────────────────────────────────────────────────────────── */

export interface FontDef {
  family: string;
  file: string;
}

/**
 * 四个字体的**唯一出处**。字体文件与参考项目**逐字节相同**地搬进了
 * `public/assets/cardmaker/fonts/`（用户 2026-10-01 明确要求连字体一起搬；
 * TT-Supermolot 的授权风险由用户承担）。
 */
export const FONTS: readonly FontDef[] = [
  { family: 'SupermolotR', file: 'TT-Supermolot-Regular.ttf' },
  { family: 'SupermolotB', file: 'TT-Supermolot-Bold.ttf' },
  { family: 'HackedKerX', file: 'Hacked-KerX.ttf' },
  { family: 'MotionControl', file: 'motion-control.bold.otf' },
];

/** 字体是否已经装过（只需要装一次；屏被反复打开时不重复下载） */
let fontsReady = false;

/**
 * 装载四个网页字体。**失败不抛**：字体没装上也必须能画卡 ——
 * 那时 canvas 会用 fallback 字体，字宽与设计稿不同但卡还是画得出来。
 * 返回是否**全部**装上（调用方据此决定要不要重画一遍预览）。
 */
export async function loadFonts(): Promise<boolean> {
  if (fontsReady) return true;
  // ⚠️ `document.fonts` 在无 jsdom 的单测 DOM 桩里不存在 ⇒ 必须按能力判，
  //    不能在模块顶层直接取（那也是 `page.ts` 能在桩上真跑的前提）。
  const registry = (globalThis as { document?: { fonts?: FontFaceSet } }).document?.fonts;
  if (!registry || typeof FontFace !== 'function') return false;
  const results = await Promise.all(FONTS.map(async (f) => {
    try {
      const face = new FontFace(f.family, `url(${ASSET_BASE}/fonts/${f.file})`);
      await face.load();
      registry.add(face);
      return true;
    } catch {
      return false;
    }
  }));
  fontsReady = results.every(Boolean);
  return fontsReady;
}

/** 单测用：把"字体装过了"这个记忆复位。 */
export function resetFontsForTest(): void {
  fontsReady = false;
}

/** 预设名合法吗（防止把任意字符串拼进 URL） */
export function isPresetName(name: string): boolean {
  return (PRESETS as readonly string[]).includes(name);
}
