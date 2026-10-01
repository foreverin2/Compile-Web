import { describe, it, expect, afterEach } from 'vitest';
import { installStubDom } from './net-dom-stub';
import {
  fitSingleLine,
  parseRich,
  pieceFont,
  panelFitSize,
  resetMeasureCtxForTest,
  richParagraphs,
  wordWidth,
  wrapLines,
  wrapRich,
  type RichWord,
} from '../../src/ui/cardmaker/text';
import { PANEL_FONT, PANEL_MAX, PANEL_MIN } from '../../src/ui/cardmaker/config';

/**
 * 文字排版与富文本标记的用例（2026-10-01）。
 *
 * 移植自参考项目 COMPILER · Card Builder（作者 Albert Blanco，MIT 许可，
 * https://github.com/albrtbc/compiler）的 `test/text.test.js`。
 *
 * 那个文件测三样：`parseRich`、`markersToHtml`、`pieceFont`。其中 `markersToHtml` 属
 * **contenteditable** 那条编辑路（把标记串渲染成 HTML、再把用户的 HTML 读回标记串），
 * 本项目用**纯 textarea** 编辑（页面上就是让用户敲 `**` / `__`），那两个函数没有移植 ⇒
 * 它的用例也没有对应物。剩下两样按原样重写，并补上"排版算法"这一层（原项目没有它的腿，
 * 因为那边排版只在真浏览器里被看见过）。
 *
 * 量字用一个**手写假上下文**：`width = 字符数 × 字号 × W`（W 是每个字符的宽度系数，
 * 中文/全角当 1，ASCII 当 0.5）。这不是真字体度量，但足以把"字号逐像素递减""按词换行"
 * "富文本片段拼接"这些**算法**钉住；真实字宽只影响观感，不影响这三条。
 */

/** 每个字符的宽度系数（假上下文用） */
function charWidth(ch: string): number {
  return ch.charCodeAt(0) > 0x2e80 ? 1 : 0.5;
}

interface FakeCtx {
  font: string;
  fillStyle: unknown;
  textAlign: string;
  textBaseline: string;
  shadowColor: string;
  shadowBlur: number;
  shadowOffsetX: number;
  shadowOffsetY: number;
  /** 记录每一次 fillRect（下划线那一层要用） */
  rects: Array<{ x: number; y: number; w: number; h: number }>;
  /** 记录每一次 fillText 与它当时的字体（粗体切换要用） */
  texts: Array<{ text: string; x: number; y: number; font: string }>;
  measureText(text: string): { width: number; actualBoundingBoxAscent: number; actualBoundingBoxDescent: number };
  fillText(text: string, x: number, y: number): void;
  fillRect(x: number, y: number, w: number, h: number): void;
}

function fakeCtx(): FakeCtx {
  const ctx: FakeCtx = {
    font: '',
    fillStyle: '',
    textAlign: '',
    textBaseline: '',
    shadowColor: '',
    shadowBlur: 0,
    shadowOffsetX: 0,
    shadowOffsetY: 0,
    rects: [],
    texts: [],
    measureText(text: string) {
      const size = Number.parseFloat(/(\d+(?:\.\d+)?)px/.exec(ctx.font)?.[1] ?? '0');
      let w = 0;
      for (const ch of text) w += charWidth(ch) * size;
      return { width: w, actualBoundingBoxAscent: size * 0.8, actualBoundingBoxDescent: size * 0.2 };
    },
    fillText(text: string, x: number, y: number) { ctx.texts.push({ text, x, y, font: ctx.font }); },
    fillRect(x: number, y: number, w: number, h: number) { ctx.rects.push({ x, y, w, h }); },
  };
  return ctx;
}

/**
 * 把假上下文交进产出代码。形状是结构化匹配的，但假件的 `measureText` 只声明了产出代码
 * 真正用到的三个字段（真实的 `TextMetrics` 有十几个），所以这里必须显式转一次 ——
 * 转的是**测试侧**的假件，不是产出代码的类型。
 */
const asCtx = (c: FakeCtx): never => c as unknown as never;

/** 一个词的纯文本（把片段拼起来） */
const wordText = (w: RichWord): string => w.map((p) => p.text).join('');

/** 一行的纯文本（词之间补空格，只为断言可读） */
const lineText = (l: RichWord[]): string => l.map(wordText).join(' ');

afterEach(() => {
  // 量字上下文是**模块级懒单例**：换过 DOM 桩之后必须清掉，否则下一个用例量字用的是上一个的桩
  resetMeasureCtxForTest();
});

/* ==================================================================== *
 * 1. 富文本标记（移植自 test/text.test.js 的 parseRich 一组）
 * ==================================================================== */

describe('parseRich（移植自 test/text.test.js）', () => {
  it('没有标记时只有一个普通片段', () => {
    expect(parseRich('hello')).toEqual([{ text: 'hello', bold: false, underline: false }]);
  });

  it('`**` 切换粗体', () => {
    expect(parseRich('a **b** c')).toEqual([
      { text: 'a ', bold: false, underline: false },
      { text: 'b', bold: true, underline: false },
      { text: ' c', bold: false, underline: false },
    ]);
  });

  it('`__` 切换下划线', () => {
    expect(parseRich('__u__')).toEqual([{ text: 'u', bold: false, underline: true }]);
  });

  it('粗体与下划线可以嵌套', () => {
    expect(parseRich('**__x__**')).toEqual([{ text: 'x', bold: true, underline: true }]);
  });

  it('是**开关**而不是配对：落单的标记会一路影响到结尾', () => {
    // 这一条是"开关语义"的判据：`**a` 之后没有闭合，后面的字全都是粗的
    expect(parseRich('**a')).toEqual([{ text: 'a', bold: true, underline: false }]);
    expect(parseRich('**a**b**')).toEqual([
      { text: 'a', bold: true, underline: false },
      { text: 'b', bold: false, underline: false },
    ]);
  });

  it('空标记不产出空片段（`****` 只是切了两次开关）', () => {
    expect(parseRich('****')).toEqual([]);
    expect(parseRich('')).toEqual([]);
  });

  it('反向：把 `**` 换成普通字符就得到一整段（证明上面的切分真的发生了）', () => {
    expect(parseRich('a **b** c').length).toBe(3);
    expect(parseRich('a b c')).toEqual([{ text: 'a b c', bold: false, underline: false }]);
  });
});

describe('pieceFont（移植自 test/text.test.js）', () => {
  it('只有粗体才换成 Bold 字面', () => {
    expect(pieceFont({ bold: false }, 20)).toBe(`20px ${PANEL_FONT}`);
    expect(pieceFont({ bold: true }, 20)).toBe('20px SupermolotB');
  });
});

describe('richParagraphs：段 → 词 → 片段', () => {
  it('`\\n` 分段，空白分导致词边界，样式跟着片段走', () => {
    const paras = richParagraphs('a **b c**\n\n__d__');
    expect(paras).toHaveLength(3);
    // ⚠️ `**b c**` 里的那个空格**也**分词：粗体段落里的两个词是两个独立的词，
    //    词之间的空格不携带样式（这正是 `wrapRich`/`drawPanelText` 里
    //    `spaceW` 与 `prevUnderline` 那两处要单独处理空格的原因）。
    expect(paras[0].map(wordText)).toEqual(['a', 'b', 'c']);
    expect(paras[0][1].map((p) => p.bold), '第二个词应当是粗体片段').toEqual([true]);
    expect(paras[0][2].map((p) => p.bold), '第三个词也是粗体（同一个 run 里）').toEqual([true]);
    // 空行产出一个空段（硬换行），不是被吞掉
    expect(paras[1]).toEqual([]);
    expect(paras[2][0].map((p) => p.underline)).toEqual([true]);
  });

  it('一个词里可以混着粗体与普通片段（拼接顺序不能乱）', () => {
    const paras = richParagraphs('a**b**c');
    expect(paras[0]).toHaveLength(1);
    expect(paras[0][0].map((p) => `${p.text}:${p.bold ? 'B' : '-'}`)).toEqual(['a:-', 'b:B', 'c:-']);
  });
});

/* ==================================================================== *
 * 2. 排版算法
 * ==================================================================== */

describe('fitSingleLine：逐像素递减直到放得下', () => {
  it('宽度够就保持 max，不够就往下缩', () => {
    const ctx = fakeCtx();
    // 4 个 ASCII ⇒ 宽 = 4 × 0.5 × size = 2 × size；宽上限 100 ⇒ size ≤ 50
    expect(fitSingleLine(asCtx(ctx), 'abcd', 'F', 100, 1000, 60, 10)).toBe(50);
    // 宽上限很大 ⇒ 保持 max
    expect(fitSingleLine(asCtx(ctx), 'abcd', 'F', 10000, 1000, 60, 10)).toBe(60);
  });

  it('放不下时**下界是 minSize**（不会缩到 0）', () => {
    const ctx = fakeCtx();
    // 100 个全角字符：任何字号都放不进 100px ⇒ 停在 min
    const huge = '　'.repeat(100);
    expect(fitSingleLine(asCtx(ctx), huge, 'F', 100, 1000, 60, 18)).toBe(18);
  });

  it('高度也参与判定（maxH 很小时会继续缩）', () => {
    const ctx = fakeCtx();
    // 高 = size × (0.8 + 0.2) = size ⇒ maxH = 30 时 size 必须 ≤ 30
    expect(fitSingleLine(asCtx(ctx), 'a', 'F', 10000, 30, 60, 10)).toBe(30);
  });
});

describe('wrapLines：按词换行、硬换行、超长单词不无限循环', () => {
  it('放不下就换行，行数是可预期的', () => {
    const ctx = fakeCtx();
    // size 10：ASCII 每字 5px。"aa bb cc" 总宽 40；maxW 20 ⇒ 每行一个词
    const lines = wrapLines(asCtx(ctx), 'aa bb cc', 'F', 10, 20);
    expect(lines).toEqual(['aa', 'bb', 'cc']);
    // maxW 大 ⇒ 一行
    expect(wrapLines(asCtx(ctx), 'aa bb cc', 'F', 10, 1000)).toEqual(['aa bb cc']);
  });

  it('`\\n` 是硬换行；空行产出一个空串行', () => {
    const ctx = fakeCtx();
    expect(wrapLines(asCtx(ctx), 'a\n\nb', 'F', 10, 1000)).toEqual(['a', '', 'b']);
  });

  it('单个词比整行还宽时仍然放进去（否则会死循环）', () => {
    const ctx = fakeCtx();
    const lines = wrapLines(asCtx(ctx), `${'x'.repeat(200)} tail`, 'F', 10, 20);
    expect(lines.length).toBe(2);
    expect(lines[1]).toBe('tail');
  });
});

describe('wrapRich + wordWidth：富文本换行', () => {
  it('词宽是各片段之和（粗体与普通各按自己的字体量）', () => {
    const ctx = fakeCtx();
    const word: RichWord = [{ text: 'ab', bold: false, underline: false }, { text: 'cd', bold: true, underline: false }];
    // size 10 ⇒ 每个 ASCII 字 5px ⇒ 四个字 20
    expect(wordWidth(asCtx(ctx), word, 10)).toBe(20);
    expect(wordWidth(asCtx(ctx), [], 10)).toBe(0);
  });

  it('换行按词，且返回空格宽度（画下划线要用它）', () => {
    const ctx = fakeCtx();
    const paras = richParagraphs('aa bb cc');
    const wide = wrapRich(asCtx(ctx), paras, 10, 1000);
    expect(wide.lines).toHaveLength(1);
    expect(lineText(wide.lines[0])).toBe('aa bb cc');
    expect(wide.spaceW).toBe(5); // 一个 ASCII 空格 @10px
    const narrow = wrapRich(asCtx(ctx), paras, 10, 20);
    expect(narrow.lines.map(lineText)).toEqual(['aa', 'bb', 'cc']);
  });

  it('空段也落一行（硬换行不允许被折行算法吃掉）', () => {
    const ctx = fakeCtx();
    const out = wrapRich(asCtx(ctx), richParagraphs('a\n\nb'), 10, 1000);
    expect(out.lines.map(lineText)).toEqual(['a', '', 'b']);
  });

  it('一个比整行还长的词仍然自成一行（`line.length &&` 那道闸门）', () => {
    const ctx = fakeCtx();
    const out = wrapRich(asCtx(ctx), richParagraphs('x'.repeat(100)), 10, 20);
    expect(out.lines).toHaveLength(1);
  });
});

describe('panelFitSize：与 drawPanelText 同一套字号算法', () => {
  it('空文本回 { max, 1 }（不调用量字）', () => {
    expect(panelFitSize('', { w: 100, h: 100 })).toEqual({ size: PANEL_MAX, lines: 1 });
    expect(panelFitSize('   \n  ', { w: 100, h: 100 })).toEqual({ size: PANEL_MAX, lines: 1 });
  });

  it('没有量字上下文时返回 null（不编一个假读数出来）', () => {
    // 这个用例里**没有**装 DOM 桩（本文件的其它用例也都没装）⇒ `document` 不存在
    resetMeasureCtxForTest();
    expect(panelFitSize('一段字', { w: 100, h: 100 })).toBeNull();
  });

  it('装了 DOM 桩也仍然是 null：桩的 canvas 没有 2D 上下文（本仓的能力边界，如实钉住）', () => {
    const restore = installStubDom();
    try {
      // 本仓没有 jsdom，`tests/ui/net-dom-stub.ts` 的 `getContext()` 返回 null ⇒
      // `panelFitSize` 的**真值分支**在本仓**无法**被机检（它用的是模块内那个懒单例，
      // 接受不了注入）。这里钉住的是"它老老实实回 null"，而不是假装测过了真量字。
      expect(panelFitSize('一段字', { w: 100, h: 100 })).toBeNull();
    } finally {
      restore();
    }
  });
});

describe('配置里的字号区间是自洽的', () => {
  it('min < max，且面板最小字号不至于小到看不见', () => {
    expect(PANEL_MIN).toBeLessThan(PANEL_MAX);
    expect(PANEL_MIN).toBeGreaterThanOrEqual(10);
  });
});
