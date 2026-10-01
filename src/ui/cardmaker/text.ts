/**
 * canvas 文本排版：单行自动缩字号、按词换行、以及面板的**富文本**
 * （`**粗**` / `__下划线__`）。
 *
 * 2026-10-01：移植自参考项目 COMPILER · Card Builder（作者 Albert Blanco，MIT 许可，
 * https://github.com/albrtbc/compiler）的 `src/render/text.js`。移植时读了原文再写，
 * 保留了三条**容易写错**的语义：
 *  1. `fitSingleLine` 是**逐像素递减**（不是二分）：字号必须与参考实现逐位相同，
 *     否则同一张卡在两边的排版会差 1px，而"卡面好不好看"这件事没有机检能兜住；
 *  2. `wrapRich` 的换行**按词**（不是按字符），且下划线要**连空格一起画**；
 *  3. `parseRich` 的 `**` / `__` 是**开关**（toggle）语义，不是配对：`**a**b**` 会得到
 *     「粗 a + 普通 b + 粗 (空)」—— 空 run 不产出。
 *
 * `markersToHtml` / `htmlToMarkers` 是"标记串 ↔ contenteditable 的 HTML"，本项目
 * 用**纯 textarea 编辑**（用户 2026-10-01 的范围里没有富文本工具栏），所以这两个函数
 * **没有移植** —— 页面上的"加粗/下划线"就是让用户敲 `**` 与 `__`，页面上有两条说明。
 */
import { LINE_FACTOR, PANEL_FONT, PANEL_MAX, PANEL_MIN, type TextZone } from './config';

/** 排版只用到这几个 2D 上下文成员（这样单测能喂一个手写假上下文，不必有 jsdom） */
export interface TextCtx {
  font: string;
  fillStyle: string | CanvasGradient | CanvasPattern;
  textAlign: CanvasTextAlign;
  textBaseline: CanvasTextBaseline;
  shadowColor: string;
  shadowBlur: number;
  shadowOffsetX: number;
  shadowOffsetY: number;
  /**
   * 与 `CanvasRenderingContext2D.measureText` **逐字同形**（`TextMetrics`）。
   *
   * 为什么不用一个更小的自造形状（只声明 `width` / `actualBoundingBox*`）：那样
   * `CanvasRenderingContext2D` **不能**赋给本接口，每个绘制调用点都要写一次 `as never`
   * —— 强转会把"我传错了上下文"这类真错误一起吃掉。手写的假件照样能实现
   * `TextMetrics`（多写两个字段而已）。
   */
  measureText(text: string): TextMetrics;
  fillText(text: string, x: number, y: number, maxWidth?: number): void;
  fillRect(x: number, y: number, w: number, h: number): void;
}

/** 绘制/排版合起来用到的全部成员（`paint()` 里那个上下文的静态类型） */
export type AllCtx = TextCtx & {
  canvas: { width: number; height: number };
  globalCompositeOperation: GlobalCompositeOperation;
  imageSmoothingEnabled: boolean;
  imageSmoothingQuality: ImageSmoothingQuality;
  clearRect(x: number, y: number, w: number, h: number): void;
  drawImage(image: CanvasImageSource, dx: number, dy: number, dw?: number, dh?: number): void;
  beginPath(): void;
  closePath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  clip(): void;
  save(): void;
  restore(): void;
  translate(x: number, y: number): void;
  rotate(angle: number): void;
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void;
};

/**
 * 只用来**量字**的离屏上下文。懒创建：本模块要能在没有 DOM 的环境里被 import
 * （单测直接调 `parseRich` / `richParagraphs` 时不需要上下文）。
 */
let measureCtx: TextCtx | null | undefined;
function getMeasureCtx(): TextCtx | null {
  if (measureCtx !== undefined) return measureCtx;
  try {
    const c = document.createElement('canvas');
    measureCtx = (c.getContext('2d') as unknown as TextCtx | null) ?? null;
  } catch {
    measureCtx = null;
  }
  return measureCtx;
}

/** 单测用：清掉离屏上下文（换 DOM 桩时必须清，否则量字会用上一个用例的桩）。 */
export function resetMeasureCtxForTest(): void {
  measureCtx = undefined;
}

/** 一个文本片段（富文本的最小单位） */
export interface RichRun {
  text: string;
  bold: boolean;
  underline: boolean;
}

/** 单个词的排版片段（换行的最小单位：词之间不拆） */
export type RichPiece = RichRun;
/** 一个词 = 若干片段（`**粗**体` 这种混排在一个词里可能出现） */
export type RichWord = RichPiece[];
/** 一段（`\n` 分隔）= 若干词 */
export type RichParagraph = RichWord[];

/** 逐级缩小字号，直到这一行既放得进 maxW 又放得进 maxH */
export function fitSingleLine(
  ctx: TextCtx,
  text: string,
  fontFam: string,
  maxW: number,
  maxH: number,
  maxSize: number,
  minSize: number,
): number {
  let size = maxSize;
  for (; size >= minSize; size--) {
    ctx.font = `${size}px ${fontFam}`;
    const m = ctx.measureText(text);
    const h = (m.actualBoundingBoxAscent || size * 0.8) + (m.actualBoundingBoxDescent || size * 0.2);
    if (m.width <= maxW && h <= maxH) break;
  }
  return Math.max(size, minSize);
}

/** 纯文本按词换行（`\n` 是硬换行；空行产出一个空行） */
export function wrapLines(ctx: TextCtx, text: string, fontFam: string, size: number, maxW: number): string[] {
  ctx.font = `${size}px ${fontFam}`;
  const lines: string[] = [];
  for (const para of text.split('\n')) {
    if (para.trim() === '') { lines.push(''); continue; }
    let cur = '';
    for (const word of para.split(/\s+/)) {
      const test = cur ? `${cur} ${word}` : word;
      // `!cur` 那一支保证"一个词比整行还宽"时仍然放进去（否则会无限循环）
      if (ctx.measureText(test).width <= maxW || !cur) cur = test;
      else { lines.push(cur); cur = word; }
    }
    if (cur) lines.push(cur);
  }
  return lines;
}

/** 画一行自动缩字号的单行文本（标题 / 数值 / 协议名） */
export function drawLine(ctx: TextCtx, text: string, zone: TextZone, color: string): void {
  if (!text) return;
  const padX = zone.padX || 0;
  const availW = zone.w - padX * 2;
  const size = fitSingleLine(ctx, text, zone.font, availW, zone.h, zone.max, zone.min);
  ctx.font = `${size}px ${zone.font}`;
  ctx.fillStyle = color;
  ctx.textBaseline = 'middle';
  if (zone.shadow) {
    ctx.shadowColor = zone.shadow.color || 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = zone.shadow.blur || 0;
    ctx.shadowOffsetX = zone.shadow.dx || 0;
    ctx.shadowOffsetY = zone.shadow.dy || 0;
  }
  const cy = zone.y + zone.h / 2 + (zone.dy || 0);
  if (zone.align === 'left') {
    ctx.textAlign = 'left';
    ctx.fillText(text, zone.x + padX, cy, availW);
  } else {
    ctx.textAlign = 'center';
    ctx.fillText(text, zone.x + zone.w / 2 + (zone.dx || 0), cy, availW);
  }
  // 阴影是**状态**（不是参数）：画完必须清掉，否则后面每一层都拖一条黑影
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
}

/* ── 富文本：`**粗**` 与 `__下划线__` ──────────────────────────────────── */

/**
 * 把一段文本切成带样式的片段。`**` 切粗体、`__` 切下划线，两者都是**开关**。
 * 空片段不产出（所以 `****` 只是切两次开关，不留痕迹）。
 */
export function parseRich(text: string): RichRun[] {
  const runs: RichRun[] = [];
  let bold = false;
  let underline = false;
  let buf = '';
  const flush = (): void => {
    if (buf) { runs.push({ text: buf, bold, underline }); buf = ''; }
  };
  for (let i = 0; i < text.length; i++) {
    const two = text.substr(i, 2);
    if (two === '**') { flush(); bold = !bold; i++; continue; }
    if (two === '__') { flush(); underline = !underline; i++; continue; }
    buf += text[i];
  }
  flush();
  return runs;
}

/** 切成 `段 → 词 → 片段` 三级（换行按段、折行按词） */
export function richParagraphs(text: string): RichParagraph[] {
  return text.split('\n').map((para) => {
    const words: RichWord[] = [];
    let cur: RichWord | null = null;
    for (const run of parseRich(para)) {
      // 保留空白段（`/(\s+)/` 有捕获组，所以 split 出来的奇数项就是空白）
      for (const part of run.text.split(/(\s+)/)) {
        if (part === '') continue;
        if (/^\s+$/.test(part)) { if (cur) { words.push(cur); cur = null; } }
        else { if (!cur) cur = []; cur.push({ text: part, bold: run.bold, underline: run.underline }); }
      }
    }
    if (cur) words.push(cur);
    return words;
  });
}

/** 片段用的字体族名（粗体走 `SupermolotB`，那是同一个字体家族的 Bold 字重） */
export function pieceFont(p: { bold: boolean }, size: number): string {
  return `${size}px ${p.bold ? 'SupermolotB' : PANEL_FONT}`;
}

/** 一个词的总宽度（逐片段量再加起来） */
export function wordWidth(ctx: TextCtx, word: RichWord, size: number): number {
  let w = 0;
  for (const p of word) { ctx.font = pieceFont(p, size); w += ctx.measureText(p.text).width; }
  return w;
}

/** 富文本折行：按词放，放不下就换行；返回行数组与一个空格的宽度（画下划线要用它） */
export function wrapRich(
  ctx: TextCtx,
  paragraphs: RichParagraph[],
  size: number,
  maxW: number,
): { lines: RichWord[][]; spaceW: number } {
  ctx.font = `${size}px ${PANEL_FONT}`;
  const spaceW = ctx.measureText(' ').width;
  const lines: RichWord[][] = [];
  for (const words of paragraphs) {
    let line: RichWord[] = [];
    let lineW = 0;
    for (const word of words) {
      const ww = wordWidth(ctx, word, size);
      const add = line.length ? spaceW + ww : ww;
      if (line.length && lineW + add > maxW) { lines.push(line); line = [word]; lineW = ww; }
      else { line.push(word); lineW += add; }
    }
    // 空段也要落一行（硬换行），所以这一句在循环外、且不判空
    lines.push(line);
  }
  return { lines, spaceW };
}

/**
 * 画面板文本。字号从 `PANEL_MAX` 逐级缩到"行数放得下"为止。
 *
 * 两条与参考实现逐字一致的细节：
 *  - **垂直居中**：整块文本在 zone 里居中（`(zone.h - 行数 × 行高) / 2`）；
 *  - 下划线**连词间空格一起画**（`prevUnderline && 下一个词以粗/下划线开头`），
 *    否则 `__a b__` 看起来会断成两段。
 */
export function drawPanelText(ctx: TextCtx, text: string, zone: { x: number; y: number; w: number; h: number }, color: string): void {
  const t = text.replace(/\s+$/g, '');
  if (!t.trim()) return;
  const paragraphs = richParagraphs(t);
  let size = PANEL_MAX;
  let wrapped = wrapRich(ctx, paragraphs, size, zone.w);
  for (; size >= PANEL_MIN; size--) {
    wrapped = wrapRich(ctx, paragraphs, size, zone.w);
    if (wrapped.lines.length * size * LINE_FACTOR <= zone.h) break;
  }
  ctx.fillStyle = color;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  const lh = size * LINE_FACTOR;
  const ulThick = Math.max(1, size * 0.06);
  const spaceW = wrapped.spaceW;
  let y = zone.y + Math.max(0, (zone.h - wrapped.lines.length * lh) / 2);
  for (const line of wrapped.lines) {
    let x = zone.x;
    const ulY = y + size * 0.92;
    let prevUnderline = false;
    for (let wi = 0; wi < line.length; wi++) {
      const word = line[wi];
      if (wi > 0) {
        if (prevUnderline && word.length && word[0].underline) ctx.fillRect(x, ulY, spaceW, ulThick);
        x += spaceW;
      }
      for (const p of word) {
        ctx.font = pieceFont(p, size);
        ctx.fillText(p.text, x, y);
        const pw = ctx.measureText(p.text).width;
        if (p.underline) ctx.fillRect(x, ulY, pw, ulThick);
        x += pw;
        prevUnderline = p.underline;
      }
    }
    y += lh;
  }
}

/**
 * 一个面板会用到的**字号与行数**（与 `drawPanelText` 同一套算法）。
 *
 * 用途是排版给用户看的那份提示（"这一段文本用了 24px、共 3 行"）—— 参考项目用它对齐
 * 卡面浮层输入框里的光标。没有 DOM 时（量字上下文拿不到）返回一个**显式的保守值**，
 * 而不是假装算过：调用方拿到 `null` 就该显示"算不了"。
 */
export function panelFitSize(text: string, zone: { w: number; h: number }): { size: number; lines: number } | null {
  const t = (text || '').replace(/\s+$/g, '');
  if (!t.trim()) return { size: PANEL_MAX, lines: 1 };
  const mctx = getMeasureCtx();
  if (!mctx) return null;
  const paras = richParagraphs(t);
  let size = PANEL_MAX;
  let wrapped = wrapRich(mctx, paras, size, zone.w);
  for (; size >= PANEL_MIN; size--) {
    wrapped = wrapRich(mctx, paras, size, zone.w);
    if (wrapped.lines.length * size * LINE_FACTOR <= zone.h) break;
  }
  return { size, lines: Math.max(1, wrapped.lines.length) };
}
