import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { handCardBox, handFanLead, handFanStep, stackCardBox } from '../../src/ui/fx-card-size';
import { installStubDom, makeStubEl, type StubNode } from './net-dom-stub';
import { buildTornadoFx } from '../../src/ui/fx-tornado';
import { functionBody, stripComments } from './source-text';

/**
 * **G2 修正 R15-A 守卫：落点盒 / 幽灵不得再用"热座卡"常数。**
 *
 * ## 这一族缺陷的形态
 *
 * `src/ui/fx-card-size.ts` 里那四个常量（`HAND_CARD_W/H` / `HALF_W/H`）是**热座**手牌卡的
 * 几何（130 × 178.8），但同一份源码在**远程页**跑时手牌卡是 **100.572 × 137.601**
 * （由 `.net-board` 的 `--card-h: 140` 派生，`styles-net.css:91-97`）。于是十几处
 * "落点盒 / 幽灵卡"比真卡**大 29%**（宽 +29.3% / 高 +30.0%），扇形步距每张多偏 23.09px
 * （102 vs 78.909）。缺陷之所以能存活 1114 条测试，是因为**没有任何一条判据把
 * "这一页的卡多大"与"落点盒写多大"连起来** —— 本文件就是那条判据。
 *
 * ## 两类判据（各自能证明什么）
 *
 * ① **行为腿**（`handCardBox` / `stackCardBox` / `handFanStep` / `handFanLead`）：
 *    用合成 DOM 桩**真跑**四个出口，钉住"量的是哪个节点 / 用哪个属性 / 算出的数是多少"。
 *    能证明：探针作用域（只在 `.net-board` 内）、读数属性（`offsetWidth/Height`）、
 *    回退链（手牌卡 → 场上卡 → 热座常量）、以及**热座分支逐位等于旧字面量**。
 *    不能证明：真实浏览器布局（本仓无 jsdom，尺寸是测试喂的常量）。
 *
 * ② **调用点腿**（源码判据，全部先过 `stripComments`）：每一处落点盒的尺寸/居中都必须来自
 *    出口函数，且**不许**再出现热座字面量。函数级判据一律用共享的 `functionBody()`
 *    （花括号配平，**不是**"从函数名往后切 N 字符" —— 后者会把后续函数也算进来，
 *    静默失去判别力）。
 *
 * ⚠️ **为什么调用点要用源码判据而不是"真跑一遍特效"**：这些特效都要 `GameState` + 真 DOM +
 * 定时器才跑得起来，而真正会漂移的是**尺寸表达式本身**（谁被写进 `style.width`）。
 * 本仓既有的 FX 守卫（`gen3-card-fx.test.ts` 等）也是同一口径。
 */

/* ────────────────────────── 桩工具 ────────────────────────── */

/** 造一个带布局盒尺寸的桩节点（`offsetWidth/offsetHeight` 是 `fx-card-size` 的读数来源）。 */
function elWithBox(cls: string, w: number, h: number): StubNode {
  const el = makeStubEl('div');
  el.className = cls;
  (el as unknown as { offsetWidth: number }).offsetWidth = w;
  (el as unknown as { offsetHeight: number }).offsetHeight = h;
  return el;
}

/** 装一段合成 DOM：`.net-board > (.net-hands | .net-lane-band > .stack)`。 */
function mountNetBoard(opts: {
  handCard?: { w: number; h: number };
  laneCard?: { w: number; h: number };
}): { restore: () => void } {
  const restore = installStubDom();
  const doc = (globalThis as unknown as { document: { body: StubNode } }).document;
  const board = makeStubEl('div');
  board.className = 'net-board';
  if (opts.handCard) {
    const hands = makeStubEl('div');
    hands.className = 'net-hands';
    hands.appendChild(elWithBox('card', opts.handCard.w, opts.handCard.h));
    board.appendChild(hands);
  }
  if (opts.laneCard) {
    const band = makeStubEl('div');
    band.className = 'net-lane-band';
    const stack = makeStubEl('div');
    stack.className = 'stack';
    stack.appendChild(elWithBox('card', opts.laneCard.w, opts.laneCard.h));
    band.appendChild(stack);
    board.appendChild(band);
  }
  doc.body.appendChild(board);
  return { restore };
}

/** 热座页的合成 DOM：手牌区里放一张**尺寸故意不同**的卡（缺省 `200×300`），并且**同时**挂一份
 *  "看起来像远程页手牌"的等价物（`.net-hands > .card`）—— 但**没有** `.net-board` 这个祖先。
 *
 * ## 为什么必须是这个形状（**变异实测 M19 逼出来的**，不是设计出来的）
 *
 * 第一版只在 `.hand` 里放诱饵，结果"把探针的 `.net-board` 前缀删掉"**判据不红** ——
 * 因为 `.net-hands` 这个类根本没出现过，删掉前缀与否都命中不了。也就是说：
 * 那条判据当时证明的是"热座没有 `.net-hands`"，**不是**"探针被 `.net-board` 限定住"。
 * 改成"有 `.net-hands`、但**没有** `.net-board` 祖先"之后，作用域才变成**唯一**的阻挡
 * ⇒ 删掉前缀会立刻量到 200×300，判据随即红。
 *
 * ⚠️ 这在真浏览器里对应的是 `renderNetBoard` 的 DOM（`.net-board` 是整个远程页的根容器，
 * 见 `render-net.ts`）；热座页**没有**这个类 ⇒ 下面这些诱饵在热座页真实不存在，
 * 但本判据要的正是"**万一**存在也不许被量到"。 */
function mountHotSeat(handCard: { w: number; h: number } = { w: 200, h: 300 }): { restore: () => void } {
  const restore = installStubDom();
  const doc = (globalThis as unknown as { document: { body: StubNode } }).document;
  const hand = makeStubEl('div');
  hand.className = 'hand';
  hand.appendChild(elWithBox('card', handCard.w, handCard.h));
  doc.body.appendChild(hand);
  // 诱饵 2：`.net-hands > .card`（**没有** `.net-board` 祖先）—— 只有丢掉作用域才会命中它
  const hands = makeStubEl('div');
  hands.className = 'net-hands';
  hands.appendChild(elWithBox('card', handCard.w, handCard.h));
  doc.body.appendChild(hands);
  // 诱饵 3：`.net-lane-band > .stack > .card`（同样没有 `.net-board` 祖先）
  const band = makeStubEl('div');
  band.className = 'net-lane-band';
  const stack = makeStubEl('div');
  stack.className = 'stack';
  stack.appendChild(elWithBox('card', handCard.w, handCard.h));
  band.appendChild(stack);
  doc.body.appendChild(band);
  return { restore };
}

let cleanups: Array<() => void> = [];
afterEach(() => { for (const c of cleanups) c(); cleanups = []; });

/* ────────────────────────── ① 四个出口 ────────────────────────── */

describe('R15-A 出口 1：handCardBox() —— 手牌/浮层整卡尺寸', () => {
  it('远程页：量到 `.net-board .net-hands .card` 的 **offsetWidth/Height**（不是 rect）', () => {
    const { restore } = mountNetBoard({ handCard: { w: 100.572, h: 137.601 } });
    cleanups.push(restore);
    const box = handCardBox();
    expect(box.w, '手牌盒宽必须等于真卡布局宽 100.572（R9-4 的 --card-w）').toBeCloseTo(100.572, 3);
    expect(box.h, '手牌盒高必须等于 --hand-card-h 137.601').toBeCloseTo(137.601, 3);
    // 变异"改用 getBoundingClientRect()" ⇒ 桩的 rect 恒 0 ⇒ 退到热座常量 ⇒ 这两条会红
    expect(box.w, '退化成了热座常量 130（是不是用了 getBoundingClientRect？rect 受 rotate 影响）')
      .not.toBeCloseTo(130, 1);
  });

  it('远程页：`.net-hands` 只有"张数占位块"（无真卡）⇒ 退到**场上卡**尺寸，而不是 130×178.8', () => {
    // 对手手牌只剩 `.hand-count-only` 时手牌探针为空；此时仍应认出"这是远程页"
    const { restore } = mountNetBoard({ laneCard: { w: 100.572, h: 140 } });
    cleanups.push(restore);
    expect(handCardBox().w, '手牌探针落空时应退到**场上卡**尺寸（远程页 100.572），而不是热座 130')
      .toBeCloseTo(100.572, 3);
  });

  it('反空集合：热座页（无 `.net-board`）⇒ **构造性**等于旧常量 130×178.8', () => {
    // 诱饵：热座手牌里那张卡是 200×300（不是 130×178.8）⇒ 探针一旦漏进热座，判据立刻红
    const { restore } = mountHotSeat({ w: 200, h: 300 });
    cleanups.push(restore);
    expect(handCardBox()).toEqual({ w: 130, h: 178.8 });
  });

  it('反空集合：`document` 缺席（SSR / 静态扫描场景）⇒ 仍回退 130×178.8，不抛异常', () => {
    const g = globalThis as unknown as { document?: unknown };
    const had = 'document' in g;
    const prev = g.document;
    g.document = undefined;
    try {
      expect(handCardBox()).toEqual({ w: 130, h: 178.8 });
      expect(handFanStep()).toBe(102);
      expect(handFanLead()).toBe(28);
      expect(stackCardBox().h).toBe(175);
    } finally {
      // ⚠️ 用 `had` 而不是直接赋值：`delete` 在非配置属性上会抛，而直接赋回 `undefined`
      //    会把"本来就没有 document"变成"有一个 undefined 的 document"（两者对被测代码等价，
      //    但对后续用例的全局状态不等价）。
      if (had) g.document = prev; else delete g.document;
    }
  });
});

describe('R15-A 出口 2：stackCardBox() —— 场上卡尺寸', () => {
  it('远程页：读 `.net-board .net-lane-band .stack .card` 的 offsetHeight，并按**样式表同一条算式**推宽', () => {
    const { restore } = mountNetBoard({ laneCard: { w: 100.572, h: 140 } });
    cleanups.push(restore);
    const box = stackCardBox();
    expect(box.h, '场上卡高 = --card-h = 140').toBeCloseTo(140, 6);
    // 宽必须由高按 `(h − 2) × 0.71429 + 2` 推出（与 styles.css:422 / styles-net.css:461-462 同源）
    expect(box.w, '场上卡宽必须 = (140 − 2) × 0.71429 + 2')
      .toBeCloseTo((140 - 2) * 0.71429 + 2, 6);
    expect(box.w, '换了个高度也必须跟着变（判据不是"写死 100.572"）').not.toBeCloseTo(130.57, 1);
  });

  it('热座页 / 读不到 ⇒ 130.5717 × 175（`styles.css:422` 的 .stack 默认值）', () => {
    const { restore } = mountHotSeat();
    cleanups.push(restore);
    const box = stackCardBox();
    expect(box.h).toBe(175);
    expect(box.w).toBeCloseTo((175 - 2) * 0.71429 + 2, 6);
  });

  it('**作用域**：远程页有手牌卡时，场上卡探针不得漏到 `.net-hands`（两者尺寸不同）', () => {
    // 手牌 100.572×137.601、场上 100.572×140 —— 高不同 ⇒ "量到哪一个"可观测。
    // 若 stackCardBox 的探针丢掉 `.net-board` 或写成了 `.net-hands .card`，
    // 它会量到 137.601（手牌）而不是 140（场上）。
    const { restore } = mountNetBoard({
      handCard: { w: 100.572, h: 137.601 },
      laneCard: { w: 100.572, h: 140 },
    });
    cleanups.push(restore);
    expect(stackCardBox().h, '场上卡探针量到的必须是**场上**卡（140），不是手牌卡（137.601）')
      .toBeCloseTo(140, 6);
  });
});

describe('R15-A 出口 3/4：handFanStep() / handFanLead() —— 扇形步距与行内缩', () => {
  it('远程页：步距 = 卡宽 × (1 − 0.2154) = 78.909；内缩 = 卡宽 − 步距 = 21.663', () => {
    const { restore } = mountNetBoard({ handCard: { w: 100.572, h: 137.601 } });
    cleanups.push(restore);
    const step = handFanStep();
    expect(step, '远程页步距必须是 78.909（宽 100.572 的 0.7846 倍），不再是热座的 102')
      .toBeCloseTo(100.572 * 0.7846, 3);
    expect(step, '步距不能还是 102（每张多偏 23.09px）').not.toBeCloseTo(102, 1);
    const lead = handFanLead();
    expect(lead, '内缩 = 卡宽 − 步距（= 扇形重叠量 0.2154 × 卡宽）').toBeCloseTo(100.572 * 0.2154, 3);
    // 步距是**唯一出处**：内缩必须与步距自洽（不是第二份 0.2154）
    expect(lead + step, '内缩 + 步距必须逐位回到卡宽').toBeCloseTo(100.572, 6);
  });

  it('热座页 ⇒ **逐位**等于旧字面量（步距 102、内缩 28），红线"热座零变化"', () => {
    // 同一个诱饵（200×300）：探针漏进热座 ⇒ 步距会变成 200 × 0.7846 = 156.9、内缩 43.1
    const { restore } = mountHotSeat({ w: 200, h: 300 });
    cleanups.push(restore);
    expect(handFanStep(), '热座步距必须逐位是 102（styles.css:879）').toBe(102);
    expect(handFanLead(), '热座内缩必须逐位是 28（styles.css:871-872）').toBe(28);
  });

  it('步距与内缩在**远程页**也不是第二份魔数：改卡宽两者一起变', () => {
    const { restore } = mountNetBoard({ handCard: { w: 80, h: 120 } });
    cleanups.push(restore);
    const step = handFanStep();
    const lead = handFanLead();
    expect(step).toBeCloseTo(80 * 0.7846, 6);
    expect(lead).toBeCloseTo(80 * 0.2154, 6);
    expect(lead + step).toBeCloseTo(80, 6);
  });
});

describe('R15-A 判据自身的健全性（防止"在截断片段上假绿"）', () => {
  it('bodyOf 对"返回对象字面量"的函数也返回完整函数体（不是只有函数头一行）', () => {
    const b = bodyOf(GEN2, 'handLandingPos');
    expect(b.trimEnd().endsWith('}'), '函数体必须配平到结尾的 }').toBe(true);
    expect(b, '必须包含函数体内的代码（截断的片段会让所有 toContain 判据假绿）')
      .toContain('const base = fxHandEndPoint(hand, 37, 128);');
    expect(b, '必须包含 return（截断形态里没有）').toContain('return { x: base.x + step * indexFromEnd, y: base.y };');
    expect(b.length, `函数体长度只有 ${b.length} 字符 —— 像是被返回类型里的 { 截断了`).toBeGreaterThan(150);
  });
  it('bodyOf 对普通函数返回正确边界（不含后续函数）', () => {
    const b = bodyOf(MAIN, 'playDrawAnimation');
    expect(b).toContain('function playDrawAnimation(player: PlayerId');
    expect(b.trimEnd().endsWith('}')).toBe(true);
    expect(b, '不许把后面的函数也吃进来').not.toContain('function playDraftToGameTransition');
  });
  it('bodyOf 对不存在的函数**抛错**（响亮，而不是返回空串让上层假绿）', () => {
    expect(() => bodyOf(MAIN, 'noSuchFunctionXyz')).toThrow();
  });
});

/* ────────────────────────── ② 调用点 ────────────────────────── */

const srcOf = (rel: string): string =>
  stripComments(readFileSync(fileURLToPath(new URL(rel, import.meta.url)))
    .subarray(0, 8 * 1024 * 1024).toString('utf8'));

/** 取**围绕**某个语句锚点的一段源码（用于不在具名函数里的调用点，如 `x.className = '…'`）。
 *
 * ⚠️ 为什么不能只取"锚点往后"：多数改动是"在**赋值之前**先 `const box = handCardBox()`"，
 * 锚点恰好在那句**之后**。第一版就因此假红过（判据找不到自己改写出来的行）—— 记在这里。
 * `anchor` 必须**唯一**，否则判据会指错地方（本函数报红）。 */
function around(src: string, anchor: string, opts: { before?: number; after?: number } = {}): string {
  const i = src.indexOf(anchor);
  expect(i, `锚点找不到（调用点被改名/删掉了？）：${anchor}`).toBeGreaterThanOrEqual(0);
  expect(src.indexOf(anchor, i + 1), `锚点在本文件里不唯一，判据会指错地方：${anchor}`).toBe(-1);
  return src.slice(Math.max(0, i - (opts.before ?? 600)), i + anchor.length + (opts.after ?? 600));
}

/** 取一个具名函数的**配平函数体**。
 *
 * ## 为什么不用共享的 `functionBody()`
 *
 * 它找函数体起始 `{` 时**不跳过返回类型标注**，于是 `: { x: number; y: number }` 里的那个 `{`
 * 被当成函数体开头 —— 返回的"函数体"只有函数头一行。`functionBody` 自己的头注写着
 * "返回类型标注里不含 `{`（本仓写法如此）"，而 `handLandingPos` 这类返回对象字面量的函数
 * 正是那个前提的**反例**（本轮实测：`functionBody(src,'handLandingPos')` 返回的字符串
 * 以 `…: { x: number; y: number }` 结尾、体内一行代码都没有 ⇒ 判据在截断片段上可能假绿）。
 * ⚠️ 这里**不改**共享助手（全仓多处依赖它，改它属于另一件事）；本文件自带一个跳过
 * "参数表 + 返回类型"的版本，并且**找不到/不配平就抛错**（响亮）。
 *
 * ## 算法
 *
 * 1. `function <name>(` 起，花括号/圆括号配平地跳过参数表；
 * 2. 之后找函数体 `{`：**跳过返回类型里的成对 `{…}`** —— 判据是"紧跟其后的是 `=>` / `|` / `&` / `;`
 *    或另一个 `{`"（那些都是**类型**里的形态）。`{ x: number; y: number }` 之后是 `{`（真正的
 *    函数体）⇒ 被跳过；而真正的函数体后面一定是**语句**，不会被误判。
 * 3. 花括号配平到 depth 0（字符串/模板串整段跳过）。 */
function bodyOf(src: string, name: string): string {
  const at = src.indexOf(`function ${name}(`);
  if (at < 0) throw new Error(`源码里找不到 function ${name}(（结构被改动？）`);
  let i = src.indexOf('(', at);
  let paren = 0;
  for (; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === '(') paren += 1;
    else if (ch === ')') { paren -= 1; if (paren === 0) { i += 1; break; } }
  }
  for (; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === '(') {          // 返回类型里的函数类型参数表（`(a: number) => void`）
      let d2 = 0;
      for (; i < src.length; i += 1) {
        if (src[i] === '(') d2 += 1;
        else if (src[i] === ')') { d2 -= 1; if (d2 === 0) break; }
      }
      continue;
    }
    if (ch !== '{') continue;
    let d = 0;
    let j = i;
    for (; j < src.length; j += 1) {
      if (src[j] === '{') d += 1;
      else if (src[j] === '}') { d -= 1; if (d === 0) break; }
    }
    if (/^\s*(=>|\||&|;|\{)/.test(src.slice(j + 1, j + 20))) { i = j; continue; }   // 是返回类型
    break;                     // 是函数体
  }
  if (i >= src.length || src[i] !== '{') throw new Error(`找不到 function ${name} 的函数体起始 {`);
  let depth = 0;
  for (; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === "'" || ch === '"' || ch === '`') {
      const quote = ch;
      i += 1;
      while (i < src.length) {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === quote) break;
        i += 1;
      }
      continue;
    }
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return src.slice(at, i + 1);
    }
  }
  throw new Error(`function ${name} 的花括号不配平`);
}

const MAIN = srcOf('../../src/main.ts');
const EFF = srcOf('../../src/ui/effects/index.ts');
const GEN2 = srcOf('../../src/ui/fx-gen2.ts');
const TORNADO = srcOf('../../src/ui/fx-tornado.ts');
const RENDER = srcOf('../../src/ui/render.ts');
const HOT_CSS = srcOf('../../src/ui/styles.css');

describe('R15-A A1：抽牌幽灵（main.ts playDrawAnimation）', () => {
  const fn = bodyOf(MAIN, 'playDrawAnimation');
  it('尺寸与步距来自 handCardBox()/handFanStep()（不再是 GHOST_W/GHOST_H/102）', () => {
    expect(fn, '幽灵盒必须来自 handCardBox()').toContain('const ghostBox = ghostCardBox();');
    expect(fn, '扇形步距必须来自 handFanStep()').toContain('const fanStep = handFanSpacing();');
    expect(fn, '幽灵必须内联宽高（.draw-ghost 挂在 body 上，styles-net.css 命不中它）')
      .toContain('ghost.style.width = `${ghostBox.w}px`;');
    expect(fn, '幽灵垂直居中必须用实测半高').toContain('${cy - ghostBox.h / 2}px');
    // 扇形重叠量的**单一出处**：两个分支（有末卡 / 空手牌）都必须用它，不许各写一遍减法
    expect(fn, '重叠量必须来自 handFanLead()（卡宽 − 步距）')
      .toContain('const overlap = handFanLead();');
    expect(fn, '两个分支都必须用 overlap（旧句各自写 `w − step` 与字面量 `28`）')
      .toContain('const lead = ghostBox.w / 2 - overlap;');
    expect(fn, '空手牌分支也必须用 overlap').toContain('rect.left + overlap + ghostBox.w / 2');
    expect(fn, '幽灵盒不得再引用热座常量名').not.toMatch(/\bGHOST_[WH]\b/);
    expect(fn).not.toMatch(/\bHAND_CARD_SPACING\b/);
  });
  it('扇形方向判据是 handOuterFor(hand)，不再是绝对玩家号', () => {
    expect(fn, '方向必须按容器排列方向判（远程页两座位都是 reversed:false ⇒ 都给 end）')
      .toContain("const fromLeft = handOuterFor(hand) === 'end';");
    // ⚠️ 判据是"**方向**不再按绝对玩家号"，不是"文件里不许出现 player === 0"：
    //    同一函数里的 fromOpp 分支用 `player === 0 ? 1 : 0` 挑**对手牌库**，那是另一件事。
    expect(fn, '不许再有 `fromLeft = player === 0` 这种方向判据')
      .not.toMatch(/fromLeft\s*=\s*player\s*===/);
  });
});

describe('R15-A A2/A3：揭示飞行幽灵（effects/index.ts playRevealFly）', () => {
  const fn = bodyOf(EFF, 'playRevealFly');
  it('盒尺寸/步距是函数内取值（模块级常量已删 —— import 期求值会永久冻结热座值）', () => {
    expect(fn, '盒必须函数内 handCardBox()').toContain('const box = handCardBox();');
    expect(fn, '步距必须函数内 handFanStep()').toContain('const step = handFanStep();');
    expect(EFF, 'REVEAL_W / REVEAL_H / REVEAL_SPACING 三个模块级常量必须已删除')
      .not.toMatch(/const\s+REVEAL_(W|H|SPACING)\s*=/);
  });
  it('A2：扇形方向改按接收方**容器**排列方向（shownTo === 0 的绝对号判据必须消失）', () => {
    expect(fn, '方向必须由 handOuterFor(dst) 定').toContain("handOuterFor(dst) === 'start' ? -1 : 1");
    expect(fn, '不许再按绝对玩家号判揭示扇形方向').not.toMatch(/shownTo\s*===\s*0/);
  });
  it('A3：幽灵盒必须内联宽高（覆盖 styles.css:1944-1945 的 .reveal-fly-ghost）', () => {
    expect(fn, '揭示幽灵必须内联宽高，否则远程页仍是 130×178.8')
      .toContain('ghost.style.width = `${box.w}px`;');
    expect(fn).toContain('ghost.style.height = `${box.h}px`;');
  });
});

describe('R15-A A4：gravity 终点掩盖罩（罩的是**场上**卡）', () => {
  it('spawnGravityEndShroud 的**入参**来自 stackCardBox()，不是 REVEAL_W/REVEAL_H', () => {
    // ⚠️ 本文件里有**两处** spawnGravityEndShroud 调用（重力黑洞那一处 + speed 终点那一处，
    //    后者本来就是正确的 `rect.width/height` 写法）⇒ 锚**第一处**（重力）。
    const i = EFF.indexOf('const shroud = spawnGravityEndShroud(end,');
    expect(i, '找不到 gravity 的 spawnGravityEndShroud 调用点').toBeGreaterThanOrEqual(0);
    // ⚠️ **必须断言"实参"本身**，不能只说"附近有 stackCardBox()"：
    //    变异实测（M5：把实参改回 `130, 178.8`）当时**没有变红** —— 因为
    //    `const stackBox = stackCardBox();` 就在上一行、满足了弱判据。这里改成
    //    对**调用表达式**逐字匹配（旧句为什么必须改：它证明的是"附近取过场上卡尺寸"，
    //    新句多查的是"**这个调用真的用了它**"）。
    const call = EFF.slice(i, EFF.indexOf(';', i) + 1);
    expect(call, 'gravity 终点罩的两个实参必须来自 stackCardBox()')
      .toMatch(/spawnGravityEndShroud\(end,\s*stackBox\.w,\s*stackBox\.h\)/);
    expect(call, '不许再拿手牌常数（130/178.8 或 REVEAL_*）盖场上落点')
      .not.toMatch(/(REVEAL_|\b130\b|\b178\.8\b)/);
  });
});

describe('R15-A A5/A6：水回手落点框 与 love 落点盒（都锚**手牌**）', () => {
  it('A5：water-return-settle 用 handCardBox()', () => {
    const fn = around(EFF, "settle.className = 'water-return-settle'", { before: 900, after: 400 });
    expect(fn, '水回手落点框必须按手牌整卡').toContain('const box = handCardBox();');
    expect(fn, '不许再写 HAND_CARD_W/H').not.toMatch(/\bHAND_CARD_(W|H)\b/);
  });
  it('A6：两处 fx-love-settle 都用 handCardBox()（LOVE_CARD_W/H 常量必须已删）', () => {
    expect(EFF, 'LOVE_CARD_W / LOVE_CARD_H 两个模块级常量必须已删除')
      .not.toMatch(/const\s+LOVE_CARD_[WH]\s*=/);
    const count = (EFF.match(/settle\.className = 'fx-love-settle';/g) ?? []).length;
    expect(count, 'fx-love-settle 的调用点应恰好 2 处（抽牌落点 / 给牌落点）').toBe(2);
    // 两处都必须在 settle 之前取 box
    const blocks = EFF.split("settle.className = 'fx-love-settle';");
    for (const b of blocks.slice(0, -1)) {
      expect(b.slice(-400), 'love 落点盒必须由 handCardBox() 给出').toContain('const box = handCardBox();');
      expect(b.slice(-400), 'love 落点盒不许再写 LOVE_CARD_W/H').not.toMatch(/\bLOVE_CARD_[WH]\b/);
    }
  });
});

describe('R15-A A7/A8/A9：fx-gen2 的烟光（场上）/ 鎏金框（手牌）/ 抽牌光晕步距', () => {
  it('A7：fx-smoke-cardglow 用 stackCardBox()（落点是 smokeStackEnd = 场上链路）', () => {
    const fn = around(GEN2, "glow.className = 'fx-smoke-cardglow'", { before: 400, after: 600 });
    expect(fn, '场上落点的灰光必须按场上卡').toContain('const box = stackCardBox();');
    expect(fn, '不许再用手牌卡常数').not.toMatch(/\bHAND_CARD_(W|H|HALF_W|HALF_H)\b/);
  });
  it('A8：fx-courage-cardglow 用 handCardBox()（land = courageLandPos = 手牌末尾）', () => {
    const fn = around(GEN2, "glow.className = 'fx-courage-cardglow'", { before: 400, after: 400 });
    expect(fn, '手牌落点的鎏金框必须按手牌整卡').toContain('const handBox = handCardBox();');
    expect(fn, '不许再用手牌卡热座常数').not.toMatch(/\bHAND_CARD_(W|H|HALF_W|HALF_H)\b/);
  });
  it('A9：handLandingPos 的步进幅值来自 handFanStep()，**符号不动**', () => {
    const fn = bodyOf(GEN2, 'handLandingPos');
    expect(fn, '步进幅值必须来自 handFanStep()').toContain('const mag = handFanStep();');
    expect(fn, '方向的符号必须仍是 handOuterFor 判据（只改幅值，不改符号）')
      .toContain("handOuterFor(hand) === 'start' ? -mag : mag");
    expect(fn, '不许再写死 102').not.toContain('-102 : 102');
    // 反空集合：热座的"支点标尺"（37 / 128）是 B 类产品选择，本波**有意不动** ——
    // 若有人把它一起改了，这条会红（提醒那是另一件事，需要上层拍板）。
    expect(fn, '支点标尺 37 / 128 属于另一类（B 类），本波不动')
      .toContain('const base = fxHandEndPoint(hand, 37, 128);');
  });
});

describe('R15-A A10：CSS 写死尺寸的三个手牌落点盒必须在 JS 内联宽高', () => {
  const CASES: Array<[string, string, string]> = [
    ['fx-diversity-halo', "const halo = mk('div', 'fx-diversity-halo');", 'styles.css:8707-8708'],
    ['fx-assim-land', "const flash = mk('div', 'fx-assim-land');", 'styles.css:8809-8810'],
    ['fx-unity-halo', "const halo = mk('div', 'fx-unity-halo');", 'styles.css:8861-8862'],
  ];
  for (const [cls, anchor, cssRef] of CASES) {
    it(`${cls}：内联 width/height（内联优先于 ${cssRef} 的 130×178.8 ⇒ styles.css 一字不动）`, () => {
      // `around()` 自身会断言"锚点在文件里唯一" ⇒ 判据不会指到别的调用点
      const fn = around(GEN2, anchor, { before: 400, after: 400 });
      expect(fn, `${cls} 必须内联 width`).toContain('style.width = `${box.w}px`;');
      expect(fn, `${cls} 必须内联 height`).toContain('style.height = `${box.h}px`;');
      expect(fn, `${cls} 必须按 handCardBox() 的尺寸居中`).toContain('box.w / 2');
      expect(fn, `${cls} 不许再用热座半宽/半高`).not.toMatch(/\bHAND_CARD_HALF_[WH]\b/);
    });
  }
  it('styles.css 的三个写死尺寸**一字未动**（红线：不许改既有数值；只允许 JS 内联覆盖）', () => {
    for (const cls of ['fx-diversity-halo', 'fx-assim-land', 'fx-unity-halo']) {
      const i = HOT_CSS.indexOf('.' + cls);
      expect(i, `${cls} 的规则不见了`).toBeGreaterThanOrEqual(0);
      const body = HOT_CSS.slice(i, HOT_CSS.indexOf('}', i));
      expect(body, `${cls} 的 CSS 宽度被改了（红线：styles.css 既有数值不许动）`).toContain('width: 130px');
      expect(body, `${cls} 的 CSS 高度被改了`).toContain('height: 178.8px');
    }
  });
});

describe('R15-A A11：飓风相对卡的缩放（fx-tornado.ts + 两个调用点）', () => {
  it('**行为腿**：buildTornadoFx(scale) 真的按 scale 缩盒（不是只改源码文本）', () => {
    const { restore } = mountHotSeat();   // 只要一个 document 就好；本用例不看探针
    cleanups.push(restore);
    const fit = buildTornadoFx(0.8);
    // 118 × 0.8 = 94.4（不是 94，也不是 118）⇒ 判的是**算式**，不是近似值
    expect(String(fit.style.width), '盒宽必须 = TORNADO_W × scale = 118 × 0.8 = 94.4')
      .toBe(`${118 * 0.8}px`);
    expect(String(fit.style.height), '盒高必须 = TORNADO_H × scale = 170 × 0.8 = 136')
      .toBe(`${170 * 0.8}px`);
    // 反空集合（热座红线）：缺省 scale = 1 ⇒ 两个数**逐字**等于改动前 CSS 里的 118 / 170
    const hot = buildTornadoFx();
    expect(String(hot.style.width), '热座（缺省 scale=1）必须逐字是 118px').toBe('118px');
    expect(String(hot.style.height), '热座（缺省 scale=1）必须逐字是 170px').toBe('170px');
  });
  it('源码腿：viewBox / 云帽半径 / 弹簧线用户单位都跟着缩（盒缩了粒子不能还按 118 铺）', () => {
    expect(TORNADO, '`buildTornadoFx` 必须收 scale 参数（缺省 1 = 热座逐字不变）')
      .toMatch(/export function buildTornadoFx\(scale = 1\)/);
    expect(TORNADO, '盒子宽必须乘 scale').toContain('const W = TORNADO_W * scale;');
    expect(TORNADO, '盒子高必须乘 scale').toContain('const H = TORNADO_H * scale;');
    expect(TORNADO, '云帽半径必须跟着缩（否则盒缩了粒子还按 118 铺）')
      .toContain('const rMax = W / 2 - 8 * scale;');
    expect(TORNADO, '弹簧线的 viewBox 必须用缩放后的 W/H')
      .toContain("svg.setAttribute('viewBox', `0 0 ${W} ${H}`);");
    expect(TORNADO, '弹簧线的用户单位宽高也必须跟着缩').toContain("svg.setAttribute('width', String(W));");
    expect(TORNADO, '必须内联宽高覆盖 styles.css:3029-3030 的 118×170')
      .toContain('tornado.style.width = `${W}px`;');
    expect(TORNADO, '弹簧线必须收到 scale（否则它仍按 118 铺）')
      .toContain('buildSpringLine((Math.PI * 2 * i) / SPRING_LINES, scale)');
  });
  it('两个调用点各按自己的落点取基准卡高（远程页才换算；热座恒 1）', () => {
    expect(EFF, '抽牌场景（飞行物 = 手牌大小的卡）').toContain('buildSpeedTornado(tornadoScaleFor(handCardBox().h))');
    expect(EFF, '偏转场景（落点 = 场上链路）').toContain('buildSpeedTornado(tornadoScaleFor(stackCardBox().h))');
    const helper = bodyOf(EFF, 'tornadoScaleFor');
    expect(helper, '热座页必须恒 1（红线：热座零变化 ⇒ 逐字不改）')
      .toContain("return document.querySelector('.net-board') ? cardH / TORNADO_BASE_CARD_H : 1;");
  });
});

describe('R15-A A12：烟桥厚度（.shift-bridge 的 178.8 / -89.4 必须在 JS 内联覆盖）', () => {
  it('两行内联由 stackCardBox().h 推（桥挂在 body 上 ⇒ styles-net.css 命不中）', () => {
    const fn = bodyOf(EFF, 'playDarknessShiftBridge');
    expect(fn, '桥厚必须按场上卡的长边').toContain('const bridgeH = stackCardBox().h;');
    expect(fn, '桥厚必须内联覆盖 CSS 的 178.8').toContain('bridge.style.height = `${bridgeH}px`;');
    expect(fn, '负半高必须内联覆盖 CSS 的 -89.4（否则桥不再居中于起点）')
      .toContain('bridge.style.marginTop = `${-bridgeH / 2}px`;');
  });
});

describe('R15-A A13：拖拽打牌幽灵（render.ts bindCardDrag）', () => {
  /** ⚠️ 本文件里有**两处** `positionGhost`（草稿拖拽 + 拖拽打牌）⇒ 判据锚在 `bindCardDrag`
   *  这个函数体里，而不是锚 `positionGhost` 本身（锚函数名会指到草稿那一处）。 */
  const fn = bodyOf(RENDER, 'bindCardDrag');
  it('克隆后补内联宽高（挂到 body ⇒ .net-hands .card 不再命中 ⇒ 宽度会退回 130）', () => {
    expect(fn, '幽灵盒必须按这一页的手牌卡取（handCardBox()）').toContain('ghostBox = handCardBox();');
    expect(fn, '必须内联宽度').toContain('ghost.style.width = `${ghostBox.w}px`;');
    expect(fn, '必须内联高度').toContain('ghost.style.height = `${ghostBox.h}px`;');
  });
  it('光标居中偏移也必须按实测盒推（原来写死 65 —— 远程页会偏 14.7px）', () => {
    expect(fn, '横向偏移必须用 w / 2，不许留 -65').toContain('ev.clientX - w / 2');
    expect(fn, '不许再写 -65').not.toContain('clientX - 65');
    expect(fn, '纵向偏移必须按实测盒高推（热座逐位仍是 -50）').toContain('h / 2 - 39.4');
  });
});
