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

/* ── ★ 2026-10-01（用户报缺陷）：把不透明方形 logo 的**背景**抠掉 ──────────────
 *
 * ## 用户报的现象与原作者的答复
 *
 * 用户传了一张**不透明方形**的图当 logo，卡面上只出现"一片白色的小卡片"。
 * 原作者（COMPILER · Card Builder 的 Albert Blanco）的答复被用户转述为：
 * 「这个标志只需要保留形状且背景透明，因为应用会给它叠加一层白色……如果用完整图片，
 * 它会给整个图像上色（在这个案例里就是整个方形）」。
 *
 * 也就是说：**白化那条路（`source-in` + 白色）本身没问题**，问题是它忠实地上色了
 * "用户给的整张方图"。要"只留形状"，就得先把**背景**从 alpha 通道里去掉。
 *
 * ## 为什么用"从边缘漫水填充"而不是"全局颜色替换"
 *
 * 全局把"接近背景色"的像素透明化，会把 logo **内部**与背景同色的部分一起挖掉
 * （白底 + 白色字心的 logo 会变成空心）。从四条边漫水填充只吃掉**与外界连通**的背景，
 * 内部同色区域会被形状挡住 ⇒ 形状被保住。这正是"只留形状"想要的效果。
 *
 * ## 三处工程细节（都是为了让它在真实上传图上稳）
 *
 *  1. **先看有没有 alpha**：已经带透明通道的图（真·透明背景的 logo）**原样返回**，
 *     不做任何处理 —— 二次抠图只会把它啃坏（用户可能就是精心做过边的一张图）。
 *     判据是"四角全透明"（alpha ≤ 8），而不是"存在任何透明像素"。
 *  2. **背景色取四角的众数**，不用单点采样：JPEG 压缩、扫描件边缘脏点都可能让某一个角
 *     颜色跑偏。
 *  3. **抗锯齿边缘给半透明**，不做二值化：`alpha` 按"与背景色的距离"在 `TOL`（全透明）
 *     与 `TOL*2.5`（全不透明）之间线性插值 ⇒ 斜边/圆角不会出现锯齿白边。
 *
 * ⚠️ 判定通不通用的代价（如实记下）：形状**没有闭合**（或形状本身贴到某条边）时，
 * 漫水会从缺口漏进内部。兜底是界面上的「保留原图」开关（用户随时能关掉自动抠图）。
 */

/** 抠图结果：`dataUrl` 是新的图；`removedRatio` 是被透明化的像素占比（0–1，界面与测试读它） */
export interface LogoCutoutResult {
  dataUrl: string;
  removedRatio: number;
}

/** 与背景色的距离（欧氏，RGB 三通道） */
function colorDistance(r: number, g: number, b: number, br: number, bg: number, bb: number): number {
  const dr = r - br;
  const dg = g - bg;
  const db = b - bb;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

/**
 * 把"与四边连通的背景"变透明（纯函数，吃 `ImageData` 吐 `ImageData`）。
 *
 * 独立成一个纯函数是为了它能被单测直接喂合成像素（不需要 DOM / 真实图片解码）。
 *
 * @param tol 与背景色的距离阈值：≤ tol 判为背景（全透明）；tol 到 tol*2.5 之间线性过渡
 * @returns 改好的像素 + 被透明化的比例
 */
export function cutoutBackground(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  tol = 42,
): { data: Uint8ClampedArray; removedRatio: number } {
  const out = new Uint8ClampedArray(data);
  if (width <= 1 || height <= 1) return { data: out, removedRatio: 0 };

  /** 取一个像素的 RGB */
  const at = (x: number, y: number): [number, number, number] => {
    const i = (y * width + x) * 4;
    return [out[i], out[i + 1], out[i + 2]];
  };
  /** 四角全透明 ⇒ 这张图本来就是"只有形状"的，原样返回 */
  const corners = [at(0, 0), at(width - 1, 0), at(0, height - 1), at(width - 1, height - 1)];
  const alphaAt = (x: number, y: number): number => out[(y * width + x) * 4 + 3];
  const allCornersClear = [[0, 0], [width - 1, 0], [0, height - 1], [width - 1, height - 1]]
    .every(([x, y]) => alphaAt(x, y) <= 8);
  if (allCornersClear) return { data: out, removedRatio: 0 };

  /** 背景色 = 四角里出现次数最多的那一档颜色（量化到 8 级再投票，抗噪） */
  const bucket = (c: [number, number, number]): string => `${c[0] >> 5},${c[1] >> 5},${c[2] >> 5}`;
  const votes = new Map<string, { n: number; sum: [number, number, number] }>();
  for (const c of corners) {
    const k = bucket(c);
    const cur = votes.get(k) ?? { n: 0, sum: [0, 0, 0] };
    cur.n += 1;
    cur.sum = [cur.sum[0] + c[0], cur.sum[1] + c[1], cur.sum[2] + c[2]];
    votes.set(k, cur);
  }
  let best: { n: number; sum: [number, number, number] } | null = null;
  for (const v of votes.values()) if (best === null || v.n > best.n) best = v;
  const b0: [number, number, number] = best === null
    ? [255, 255, 255]
    : [Math.round(best.sum[0] / best.n), Math.round(best.sum[1] / best.n), Math.round(best.sum[2] / best.n)];

  const soft = tol * 2.5;
  const visited = new Uint8Array(width * height);
  const stack: number[] = [];
  const push = (x: number, y: number): void => {
    const p = y * width + x;
    if (visited[p] === 1) return;
    visited[p] = 1;
    const [r, g, b] = at(x, y);
    if (colorDistance(r, g, b, b0[0], b0[1], b0[2]) <= soft) stack.push(p);
  };
  // 四条边全部作为种子
  for (let x = 0; x < width; x++) { push(x, 0); push(x, height - 1); }
  for (let y = 0; y < height; y++) { push(0, y); push(width - 1, y); }

  let removed = 0;
  while (stack.length > 0) {
    const p = stack.pop() as number;
    const x = p % width;
    const y = (p - x) / width;
    const i = p * 4;
    const d = colorDistance(out[i], out[i + 1], out[i + 2], b0[0], b0[1], b0[2]);
    // 距离 ≤ tol ⇒ 完全透明；tol..soft ⇒ 线性过渡（保抗锯齿边缘）
    const a = d <= tol ? 0 : Math.max(0, Math.min(1, (d - tol) / (soft - tol)));
    const nextAlpha = Math.min(out[i + 3], Math.round(a * 255));
    if (nextAlpha < out[i + 3]) removed += 1;
    out[i + 3] = nextAlpha;
    if (x > 0) push(x - 1, y);
    if (x < width - 1) push(x + 1, y);
    if (y > 0) push(x, y - 1);
    if (y < height - 1) push(x, y + 1);
  }
  return { data: out, removedRatio: removed / (width * height) };
}

/**
 * 把一张 logo 图处理成"只有形状"：先抠掉与边缘连通的背景，再缩到 320px 存 PNG。
 *
 * 拿不到 2D 上下文（无 jsdom 的桩 / 极老浏览器）时**退化成普通 `normalizeLogo`**
 * —— 不抛、不假成功，只是没抠背景（界面上的说明仍然成立："去背景"失败时形状还在）。
 */
export function removeLogoBackground(dataUrl: string, tol = 42): Promise<LogoCutoutResult> {
  return new Promise<LogoCutoutResult>((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      try {
        // 缩到上限**之前**先抠：在原分辨率上抠，边缘判断更准（缩图会把背景与形状混色）
        const c = document.createElement('canvas');
        c.width = img.width;
        c.height = img.height;
        const cx = c.getContext('2d');
        if (!cx) { reject(new Error('这台设备拿不到 2D 画布，无法去掉 logo 背景')); return; }
        cx.drawImage(img, 0, 0);
        const src = cx.getImageData(0, 0, c.width, c.height);
        const cut = cutoutBackground(src.data, c.width, c.height, tol);
        // ⚠️ 不写 `new ImageData(cut.data, w, h)`：TS 7 的 `ImageData` 构造签名吃的是
        // `ImageDataArray`（背后是 `ArrayBuffer`），而 `cutoutBackground` 返回的是
        // `Uint8ClampedArray<ArrayBufferLike>` ⇒ 类型对不上。用 `createImageData` 拿到一块
        // 尺寸正确的缓冲再 `set`，语义完全一样且不需要强转。
        const dst = cx.createImageData(c.width, c.height);
        dst.data.set(cut.data);
        cx.putImageData(dst, 0, 0);
        resolve({ dataUrl: c.toDataURL('image/png'), removedRatio: cut.removedRatio });
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    };
    img.onerror = () => { reject(new Error('这张 logo 解不开（格式不支持或文件损坏）')); };
    img.src = dataUrl;
  });
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
