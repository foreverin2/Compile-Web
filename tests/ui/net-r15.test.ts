import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createGame } from '../../src/core/state/create';
import { renderProtocol, resetUiState, syncCompiledFxLayers } from '../../src/ui/render';
import { NET_PAGE_CLASS, renderNetBoard, resetNetUiState } from '../../src/ui/render-net';
import { playAssimRefreshGloss } from '../../src/ui/fx-gen2';
import { setFxViewSeat } from '../../src/ui/fx-seat';
import {
  descendants, drainRaf, installStubDom, isClass, makeStubEl, setStubRect, setStubRectFor,
  type StubNode,
} from './net-dom-stub';
// ⚠️ 用 `subjectPropOf`（**主体绑定**解算）而不是 `cssPropOf`：本文件的判据问的都是
// "这条规则说的是**这个节点**吗" —— 而 `cssPropOf` 允许主体绑到链上**任意祖先**
// （实测：`@keyframes` 的 `100% { right: 94% }` 会被解成 `.protocol-check` 的 `right`，
// 于是"热座链条下不许命中"那条腿**假红**）。`subjectPropOf` 只认"把 node 当选择器主体"的规则。
import { cssLenOf, cssRules, cssVarOf, ruleHitsAsSubject, specificityOf, subjectPropOf } from './net-css-parse';
import { stripComments } from './source-text';

/**
 * G2 修正 **R15** 的三条守卫 —— 三处缺陷**同源**：远程页的 `.protocol-holder` 是
 * **未旋转的布局盒**（`styles-net.css:726-729` = `--card-h × 0.5495` × `--card-h × 0.7692`
 * ≈ `76.9×107.7`），而协议图**自己**被 `.net-rot-ccw` / `.net-rot-cw` 转了 ∓90°
 * （`styles-net.css:735-736`）⇒ 卡的**视觉足迹**是 `107.69×76.93`（横躺）。
 * 任何"取 holder 的 rect 再按竖版算式画东西"或"把光/徽标画在未旋转的 `.protocol` 盒上"
 * 都会错位 15.38px（= (107.69 − 76.93) / 2）。
 *
 * | 守卫 | 守什么 | 机制 |
 * | --- | --- | --- |
 * | **R15-1（修复 1）** | 同化1 刷新光泽框量的是**旋转后**的足迹（`img.protocol-img`），不是 holder | **行为腿**：真跑 `renderNetBoard` + **按节点配矩形**（holder = 竖版 / img = 横躺）+ 真调 `playAssimRefreshGloss`，断言写进 DOM 的 `left/top/width/height` = img 的 rect ∓ 4 |
 * | **R15-2（修复 2）** | 已编译协议的发光挂在**已旋转**的持久层 `.compiled-fx` 上；旧的（未旋转盒上的）发光被关掉 | **CSS 解算腿**：从 `styles-net.css` 解 `body.net-page .compiled-fx` 的 `box-shadow`；解 `.net-page .net-lane-band .protocol.compiled` 的 `box-shadow: none` 且**权重压过** `.protocol.compiled-fx-<defId>`；**页标记腿**：`renderNetBoard` 加 `body.net-page`、`resetNetUiState` 摘掉 |
 * | **R15-3（修复 3）** | `.protocol-check`（**不旋转**的直接子节点）在远程页贴住横躺卡的右上角 | **CSS 解算腿**：把 `left`/`top` 解成像素，与**独立构造**的目标点（holder 矩形 → 旋转 90°（只交换宽高）→ 右上角 → 内缩）比对；**单一规则腿**：只许一条、选择器里没有朝向 token（朝向无关是几何的**结论**）；**热座腿**：`styles.css` 的 `top:4px; right:6px` 一字未改 |
 *
 * ## 诚实边界（不许读成"几何/观感已验证"）
 *
 * 桩**不模拟布局**：矩形是**测试喂的常量**（`setStubRectFor`），桩不校验它与树的任何关系。
 * 所以这里证明的是"**取到的是哪个盒子**、算出来的数是那个盒子的矩形 ±4"、
 * 以及"样式表里**哪条声明生效**"——**证明不了**"1940 宽的屏上这三处看起来真的贴合了"
 * （那三张截图只能人眼确认，见本轮报告的人眼清单）。
 *
 * ## R15-3 的两条**硬事实**（第一版把 R15-3 的几何链建在了它们的反面上，这里逐条钉住）
 *
 * ① **`.protocol-check` 不旋转**：`render.ts` 里它是 `.protocol` 的**直接子节点**、`holder` 的
 *    **兄弟**（`rotate(∓90°)` 只加在 `img.protocol-img` 上，而 `transform` **不继承**）
 *    ⇒ 徽标的屏幕位置**就是**它的布局位置，**不存在**"盒坐标 → ∓90° → 屏幕坐标"这一步。
 * ② **远程页的 `.protocol` 没有 padding / border**（`styles-net.css` 的
 *    `.net-lane-band .protocol { padding: 0; border: none }`）⇒ 绝对定位的包含块
 *    **就是** holder 盒（同原点、同尺寸 `w×h`）。第一版多减了 5px（那是**热座**的 padding+border）。
 * 两条都由本文件的腿机检钉住（事实 ① 由"徽标盒坐标逐位 = 屏幕坐标"的构造体现，
 * 事实 ② 由 `padding`/`border` 的解算腿钉住）。
 */

/**
 * 一条规则的**有效权重**：按**逗号段**各自算 `specificityOf` 再取最大值。
 *
 * ⚠️ 不能直接 `specificityOf(整条选择器)`：本仓的 `specificityOf` 把**整串**的类都数进去，
 * 于是 `.a, .b, …（10 段）` 会得到 20 —— 比任何单段都"重"，而浏览器里逗号组是**各自独立**
 * 参与层叠的。第一版就是这么比的，结果 `.protocol.compiled-fx-death, …, -apathy`（10 段）
 * 被算成 20、把正确的 4 类比下去了（假红）。
 */
const maxSpec = (selector: string): number => Math.max(
  ...selector.split(',').map((s) => s.trim()).filter(Boolean).map((s) => specificityOf(s)),
  0,
);

const read = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`../../src/ui/${name}`, import.meta.url)))
    .subarray(0, 8 * 1024 * 1024).toString('utf8');

const ALL_NET_RULES = cssRules(read('styles-net.css'));
/**
 * 剔除**关键帧步骤**（`from` / `to` / `N%`）与 `@` 规则之后的规则表（本仓既有口径：
 * `net-lane-tree.test.ts` 的 `REAL_RULES` 同款）。
 *
 * ⚠️ **必须剔**：`cssRules` 把关键帧块里的 `100% { right: 94% }` 也解析成一条普通规则，
 * 而共享解析器的 `compoundMatches` **只认类/属性选择器**（`100%` 里没有任何 `.类` ⇒
 * "需要的类"集合为空 ⇒ 恒真）⇒ 它会命中**任意节点**。实测后果：本文件"热座链条下
 * R15-3 的规则不许命中 `right`"那条腿会解到 `@keyframes net-battery-scan-sweep` 的
 * `100% { right: 94% }` 而**假红**。剔掉之后它才是真的"样式表里哪条规则生效"。
 */
const NET_RULES = ALL_NET_RULES.filter((r) => {
  const sel = r.selector.trim();
  return !sel.startsWith('@') && !/^(?:from|to|\d+(?:\.\d+)?%)$/.test(sel);
});
const HOT_RULES = cssRules(read('styles.css'));

/** 只带类名的桩节点（纯 CSS 解算用；不装 DOM、不渲染）。 */
function cssNode(...classes: string[]): StubNode {
  const n = makeStubEl('div');
  n.classList.add(...classes);
  return n;
}

/** 在 `node` 的子树（含自身）里找**全部**带某类名的节点。 */
const allWith = (node: StubNode, cls: string): StubNode[] =>
  descendants(node).filter((n) => isClass(n, cls));

/** `.net-board` 上的 `--card-h`（R9-4 起卡几何的唯一旋钮；本文件按 140 解算）。 */
const CARD_H = 140;
/** ∓90° 旋转造成的"竖版盒 → 横躺足迹"错位量：(107.69 − 76.93) / 2。 */
const SKEW = CARD_H * 0.7692 - CARD_H * 0.5495;   // ≈ 30.758 / 2 = 15.379

/** `.protocol` 的 padding + border（`styles.css:484-486`：1px border + 4px padding）。 */
const PROTO_INSET = 5;

/**
 * `calc(var(--card-h) * <k>)` 的**系数** `k`（可为负 —— R15-3 的 `top` 就是负值：
 * 徽标被推出布局盒上沿，这正是"贴住横躺卡右上角"的几何后果）。用于"同一旋钮"的判据。
 */
const coefIn = (raw: string): number => {
  const m = /^calc\(var\(--card-h\)\s*\*\s*(-?\d+(?:\.\d+)?)\)$/.exec(raw.trim());
  if (m === null) throw new Error(`coefIn 解不了这个长度：${raw}`);
  return Number.parseFloat(m[1]);
};

/**
 * 把一条声明解成**像素**：走仓里既有的 `cssLenOf`（支持 `px` / 无单位 / `var()` / `calc()`，
 * `--card-h` 由 `.net-board` 提供）。解不出来**抛错**（不许当 0 —— 那会让断言静默变松）。
 */
const lenPx = (raw: string): number => {
  const n = cssLenOf([cssNode('net-board')], NET_RULES, raw);
  if (n === null) throw new Error(`cssLenOf 解不出这个长度：${raw}`);
  return n;
};

/* ============================================================================
 * 真跑远程页（已编译协议；与 protocol-fx-rot.test.ts 的 renderNetTree 同形，
 * 但协议**全部已编译** —— R15 的三处都只在 `.protocol.compiled` 上出现）
 * ========================================================================== */

function renderNetCompiled(viewSeat: 0 | 1): StubNode {
  const s = createGame({ seed: 'r15-protocol-geometry', draftStarter: 0, firstToPlay: 1 });
  // ⚠️ **双方 defId 必须不同**（与真实对局的不变式一致：`render.ts:139-140` 的"每玩家 3 协议
  // defId 互不相同、**双方亦不共享**（草案池每 defId 只出现一次）⇒ 以 defId 为键安全"）。
  // 第一版让双方都用 fire-0/ice-0/light-0 ⇒ `compiledFx` 的 defId 键被两侧复用一个层，
  // 后处理的那一侧覆盖前一侧的 `transform` ⇒ "两套朝向都在"这条断言永远看不到对手侧。
  const SELF_DEFS = ['fire-0', 'ice-0', 'light-0'];
  const FOE_DEFS = ['fire-1', 'ice-1', 'light-1'];
  for (const p of [0, 1] as const) {
    const defs = p === viewSeat ? SELF_DEFS : FOE_DEFS;
    s.players[p].protocols = defs.map((defId) => ({ defId, compiled: true })) as never;
  }
  (s as { phase: string }).phase = 'turn';
  const root = makeStubEl('div');
  const noop = (): void => { /* noop */ };
  renderNetBoard(root as unknown as HTMLElement, s, {
    onAction: noop, onRendered: noop, rerender: noop, onDraftPick: noop, onDraftUnpick: noop,
    onDraftBan: noop, onWinReset: noop,
  } as never, { viewSeat, verifyHooks: false });
  return root;
}

/* ============================================================================
 * R15-1（修复 1）：同化1 刷新光泽框量的是**旋转后的足迹**
 *
 * 判据的**区分度**（这是这条腿存在的全部理由）：给 holder 与 img 配**不同**的矩形 ——
 *   · holder（未旋转布局盒）= `76.93 × 107.69`，left/top 取一个非零值
 *   · img（旋转后足迹）    = `107.69 × 76.93`，left/top 与 holder **不同**
 * 旧实现（量 holder）写进 DOM 的是 `{holder.left − 4, holder.top − 4, 76.93 + 8, 107.69 + 8}`
 * ⇒ 与 img 的那一组**不相等** ⇒ 报红；新实现（量 img）逐字段相等。
 * 另外把 img 的矩形设成**宽 > 高**（横躺）、holder 设成**高 > 宽**（竖版）：两者**不可能互推**。
 * ========================================================================== */

describe('R15-1 · 同化1 刷新光泽框：量的是旋转后的协议 **足迹**（img.protocol-img），不是未旋转的 holder', () => {
  it('真跑：每个已编译协议上罩的 .fx-assim-gloss 矩形 == img.protocol-img 的 rect ∓4（六格全查）', async () => {
    const restore = installStubDom();
    try {
      const root = renderNetCompiled(0);
      // ⚠️ 必须把棋盘挂进 `document.body`：`playAssimRefreshGloss` 用
      // `document.querySelectorAll(...)` 在**文档**里找协议格，而 `renderNetBoard` 只把树写进
      // 传进去的 `root`（本用例的 root 是独立节点）。不挂 ⇒ 查询恒空 ⇒ 这条用例会以
      // "0 个光泽框"的形态**假绿/假红**（缺陷与修复都看不出来）。
      (globalThis as unknown as { document: { body: StubNode } }).document.body.appendChild(root);
      // 六格（3 线 × 双方）必须先真的在
      const holders = allWith(root, 'protocol-holder');
      const imgs = allWith(root, 'protocol-img');
      expect(holders.length, '协议 holder 数量（3 线 × 双方）').toBe(6);
      expect(imgs.length, '协议 img 数量（3 线 × 双方）').toBe(6);

      // 按节点配矩形：holder 竖版（高 > 宽）、img 横躺（宽 > 高），left/top 也各不相同。
      holders.forEach((h, i) => setStubRectFor(h, {
        left: 100 + i * 10, top: 200 + i * 10, width: CARD_H * 0.5495, height: CARD_H * 0.7692,
      }));
      imgs.forEach((im, i) => setStubRectFor(im, {
        left: 500 + i * 10, top: 600 + i * 10, width: CARD_H * 0.7692, height: CARD_H * 0.5495,
      }));

      // 前提腿（反空集合）：holder 与 img 的矩形**确实不同** —— 否则这条用例在
      // "桩只返回一个全局矩形"的形态下会**静默变松**（两边都对，缺陷也绿）。
      const h0 = holders[0].getBoundingClientRect();
      const i0 = imgs[0].getBoundingClientRect();
      expect([h0.width, h0.height], 'holder 的矩形不是"未旋转的竖版盒"').toEqual([CARD_H * 0.5495, CARD_H * 0.7692]);
      expect([i0.width, i0.height], 'img 的矩形不是"旋转后的横躺足迹"').toEqual([CARD_H * 0.7692, CARD_H * 0.5495]);
      expect(h0.width, 'holder 与 img 的矩形相同 ⇒ 本用例区分不出"量的是哪个盒子"').not.toBe(i0.width);
      expect(h0.left, 'holder 与 img 的 left 相同 ⇒ 本用例区分不出"量的是哪个盒子"').not.toBe(i0.left);

      // 真调产出函数（与 fx-gen2 的 assim:refresh 事件同一条调用路径）
      playAssimRefreshGloss(0);

      const body = (globalThis as unknown as { document: { body: StubNode } }).document.body;
      const glosses = allWith(body, 'fx-assim-gloss');
      expect(glosses.length, '自己（P0）的 3 张已编译协议 ⇒ 恰好 3 个光泽框').toBe(3);

      // 逐格核对：写进 DOM 的矩形必须等于**对应 img** 的 rect ∓4（-4 / +8 算式不变）
      const selfImgs = imgs.filter((im) => {
        const cell = descendants(root).find((n) => isClass(n, 'protocol-cell') && descendants(n).includes(im));
        return cell?.dataset.player === '0';
      });
      expect(selfImgs.length, 'P0 的协议图数量').toBe(3);
      const got = glosses.map((g) => `${String(g.style.left)}/${String(g.style.top)}/${String(g.style.width)}/${String(g.style.height)}`)
        .sort();
      // ⚠️ 逐字段按数值比对（而不是比字符串）：实现写的是 `${r.width + 8}px`（`115.688px`），
      // 而这里若用 `toFixed(1)` 造期望串会因**文本**（`115.7px`）不同而假红 —— 判据是几何，不是格式。
      const num = (s: string): number[] => s.split('/').map((x) => Number.parseFloat(x));
      const gotNums = got.map(num).sort((a, b) => a[0] - b[0]);
      const wantNums = selfImgs.map((im) => {
        const r = im.getBoundingClientRect();
        return [r.left - 4, r.top - 4, r.width + 8, r.height + 8];
      }).sort((a, b) => a[0] - b[0]);
      expect(gotNums.length, '光泽框数量与契约不符').toBe(wantNums.length);
      for (let i = 0; i < wantNums.length; i += 1) {
        for (let k = 0; k < 4; k += 1) {
          expect(gotNums[i][k], `第 ${i + 1} 个光泽框的第 ${k} 个字段不等于"旋转后足迹 ±4"`
            + `（实得 ${gotNums[i].join('/')}，应得 ${wantNums[i].join('/')}）—— `
            + '量错盒子（holder 是未旋转的竖版布局盒）时会是 84.9×115.7 的竖版、而卡是 107.7×76.9 横躺').toBeCloseTo(wantNums[i][k], 3);
        }
      }
    } finally {
      await drainRaf();
      restore();
    }
  });

  it('降级路径保留：图未加载（img 矩形 0 宽）时**不产出**光泽框，而不是产出 0 尺寸的框', async () => {
    const restore = installStubDom();
    try {
      const root = renderNetCompiled(0);
      (globalThis as unknown as { document: { body: StubNode } }).document.body.appendChild(root);
      const imgs = allWith(root, 'protocol-img');
      const holders = allWith(root, 'protocol-holder');
      // holder 有尺寸（旧实现会照旧产出 6 个竖版框），img 是 0 宽（图片没加载完）
      holders.forEach((h) => setStubRectFor(h, { left: 10, top: 20, width: CARD_H * 0.5495, height: CARD_H * 0.7692 }));
      imgs.forEach((im) => setStubRectFor(im, { width: 0, height: 0 }));
      playAssimRefreshGloss(0);
      const body = (globalThis as unknown as { document: { body: StubNode } }).document.body;
      expect(allWith(body, 'fx-assim-gloss').length,
        '图未加载时不该产出光泽框（R15-1 后判据对象是 img 的矩形 ⇒ 0 宽即跳过）').toBe(0);
    } finally {
      await drainRaf();
      restore();
    }
  });

  it('源码腿：判据对象是 `img.protocol-img`（选择器里必须有它），且**不再**只取 holder', () => {
    const src = stripComments(read('fx-gen2.ts'));
    const m = /function playAssimRefreshGloss[\s\S]*?\n}/.exec(src);
    expect(m, '在 fx-gen2.ts 里找不到 playAssimRefreshGloss 的函数体（判据面漂移？）').toBeTruthy();
    const fnBody = m![0];
    // 选择器字面量 = `querySelectorAll` 的实参（跨行模板串/普通引号都取到）
    const sel = /querySelectorAll<HTMLElement>\(\s*([\s\S]*?)\n\s*\);/.exec(fnBody);
    expect(sel, '找不到 playAssimRefreshGloss 里的 querySelectorAll 实参（判据面漂移？）').toBeTruthy();
    expect(sel![1], 'playAssimRefreshGloss 的选择器里没有 `img.protocol-img` —— 量的还是未旋转的 holder')
      .toContain('img.protocol-img');
    // 反向：选择器里不许再出现 `.protocol-holder`（它就是"未旋转的布局盒"）
    expect(sel![1], 'playAssimRefreshGloss 的选择器里仍有 `.protocol-holder` —— 取它的 rect 就是 R15-1 的缺陷本身')
      .not.toContain('.protocol-holder');
    // -4 / +8 算式**不动**（修复只换判据对象，不换算式）
    expect(fnBody, '-4 / +8 的算式被改动了（本轮修复只换判据对象）').toContain('r.left - 4');
    expect(fnBody, '-4 / +8 的算式被改动了（本轮修复只换判据对象）').toContain('r.width + 8');
    // 降级路径保留：0 尺寸即跳过
    expect(fnBody, '"查不到就跳过"的降级路径被删了（0 尺寸会产出 0×0 的框）').toContain('if (r.width === 0) continue;');
  });
});

/* ============================================================================
 * R15-2（修复 2）：发光挂在**已旋转**的持久层上
 * ========================================================================== */

describe('R15-2 · 已编译协议的发光：挪到持久层 `.compiled-fx`（已 rotate∓90°），并关掉旧的那条', () => {
  it('CSS 解算：`body.net-page .compiled-fx` 有 box-shadow + border-radius（层就是旋转后的视觉盒）', () => {
    const layer = cssNode('compiled-fx', 'compiled-fx-fire');
    const shadow = subjectPropOf(layer, [cssNode('body', NET_PAGE_CLASS), layer], NET_RULES, 'box-shadow');
    expect(shadow, 'styles-net.css 里没有给 `body.net-page .compiled-fx` 写 box-shadow —— '
      + '已编译协议在远程页就只剩"左右长边没有光"的竖版残影').toBeTruthy();
    // 外光（贴合四条边）+ 内光各一条（与 styles.css 旧规则的"外光 + 内光"同形）
    const normalized = shadow!.replace(/\s+/g, ' ').trim();
    expect(normalized, '发光里没有外光（`0 0 <blur> <color>`）—— 卡外不会亮').toMatch(/^0 0 [\d.]+px /);
    expect(normalized, '发光里没有内光（`inset 0 0 <blur> <color>`）—— 与 styles.css 旧规则"外光 + 内光"不同形')
      .toMatch(/,\s*inset 0 0 [\d.]+px /);
    const radius = subjectPropOf(layer, [cssNode('body', NET_PAGE_CLASS), layer], NET_RULES, 'border-radius');
    expect(radius, '层没有 border-radius ⇒ 盒阴影的角是直角（卡面是 6px 圆角）').toBeTruthy();
    expect(lenPx(radius!), '层的圆角值与 .protocol 的 6px 不再同源').toBeCloseTo(6, 6);
  });

  it('CSS 解算：旧的（画在未旋转 `.protocol` 盒上的）发光被关掉，且**权重严格压得过**逐套配色规则', () => {
    const proto = cssNode('protocol', 'compiled', 'compiled-fx-fire');
    const chain = [cssNode('body', NET_PAGE_CLASS), cssNode('net-lane-band'), proto];
    // ② 旧的发光确实被关掉了（解算出来的生效值）
    expect(subjectPropOf(proto, chain, NET_RULES, 'box-shadow'), '旧的发光没被关掉').toBe('none');
    // ③ **承重的权重比较**：每一条"把 `.protocol` 的 box-shadow 关掉"的规则，权重都必须
    //    **严格大于**旧的逐套配色规则。为什么是"严格大于"而不是"大于等于"：
    //    相等就意味着覆盖**依赖 `styles-net.css` 的 import 顺序**（隐式依赖），而那正是
    //    `net-lane-tree.test.ts` 反复写明要避免的形态。
    //    ⚠️ 这条断言也顺带钉住"**必须有这样一条规则**"（`killers` 为空即报红）——
    //    第一版只查朴素写法的**字面串**，于是 `.net-page .net-lane-band .protocol`
    //    （3 类，实测**确实赢**）这类**合法**写法会被误判成"死代码"，而真正危险的
    //    **无前缀写法**（`.net-lane-band .protocol`，2 类 = 与旧规则同权）反而漏网。
    //    现在判据换成"权重 + 主体"，不再依赖选择器怎么写。
    const killers = NET_RULES.filter((r) => /(?:^|;|\s)box-shadow\s*:\s*none/.test(r.body)
      && ruleHitsAsSubject(r, proto, chain));
    expect(killers.length, 'styles-net.css 里没有"关掉 `.protocol` 旧发光"的规则 ⇒ '
      + '浏览器里旧的竖版光会继续亮（只有左右两条长边没有光的那个残影）').toBeGreaterThan(0);
    const old = HOT_RULES.filter((r) => r.selector.trim().startsWith('.protocol.compiled-fx-'));
    expect(old.length, 'styles.css 里没有 `.protocol.compiled-fx-<defId>` 的发光规则（前提面没了）').toBeGreaterThan(0);
    // 旧规则与……本仓 30 套逐套配色的另一种形态（`.protocol.compiled`）也要一起比
    const oldSpecs = [
      ...HOT_RULES.filter((r) => r.selector.trim().startsWith('.protocol.compiled')).map((r) => r.selector),
      ...old.map((r) => r.selector),
    ];
    const maxOld = Math.max(...oldSpecs.map(maxSpec));
    for (const r of killers) {
      expect(maxSpec(r.selector), `\`${r.selector}\` 的权重（${maxSpec(r.selector)}）`
        + `没有**严格大于**旧规则（${maxOld}）`
        + ' ⇒ 覆盖会依赖本文件的 import 顺序（隐性依赖）。给主体再挂一个类（如 `.compiled`）即可。')
        .toBeGreaterThan(maxOld);
    }
  });

  it('页标记腿：`renderNetBoard` 把 NET_PAGE_CLASS 加到 body；`resetNetUiState` 摘掉（离页不留光）', async () => {
    const restore = installStubDom();
    try {
      const body = (globalThis as unknown as { document: { body: StubNode } }).document.body;
      expect(isClass(body, NET_PAGE_CLASS), '用例起点：body 上不该有页标记').toBe(false);
      renderNetCompiled(0);
      expect(isClass(body, NET_PAGE_CLASS),
        'renderNetBoard 没有给 body 加页标记 —— `body.net-page …` 那组远程页专属规则全部失效').toBe(true);
      resetNetUiState();
      expect(isClass(body, NET_PAGE_CLASS),
        'resetNetUiState 没有摘掉页标记 —— 回热座后已编译协议会多套一圈远程页专用的光').toBe(false);
    } finally {
      await drainRaf();
      restore();
    }
  });

  it('行为腿：已编译层真的被定位 + 旋转（`body.net-page .compiled-fx` 的前提没有被 R15 改坏）', () => {
    const restore = installStubDom();
    try {
      // ⚠️ 先把上一批用例留下的**模块态**清掉：`compiledFx`（defId → 层节点）是 `render.ts` 的
      // 模块级 Map，而它里面的层挂在上一个 `installStubDom()` 的 `body` 上 —— 不清就会
      // "复用旧层 + 新 body 上查不到层"（本用例的第一版正是这样拿到 0 个层）。
      resetUiState();
      // 真跑一帧远程页（协议全部已编译）—— 层的注册（`compiledFxCells`）由渲染器自己完成，
      // 所以这里**只从桩树里取节点**（不把 `renderProtocol()` 的 `HTMLElement` 返回值硬塞进桩树：
      // 那会让"节点属于哪棵树"这条判据失去意义，也无法覆盖"6 格 → 3 个 defId"的真实接线）。
      const root = renderNetCompiled(0);
      const holders = allWith(root, 'protocol-holder');
      expect(holders.length, '协议 holder 数量').toBe(6);
      holders.forEach((h, i) => {
        // 桩的 `isConnected` 恒 false ⇒ 显式打开（模拟已入 DOM）。
        // ⚠️ `positionCompiledFxLayer` 的第一步就是 `if (!fx || !holder.isConnected) return;`（render.ts:1641）
        Object.defineProperty(h, 'isConnected', { value: true, configurable: true });
        setStubRectFor(h, { left: 10 + i * 5, top: 20, width: 100, height: 140 });
      });
      syncCompiledFxLayers();
      const body = (globalThis as unknown as { document: { body: StubNode } }).document.body;
      const layers = allWith(body, 'compiled-fx');
      expect(layers.length, '双方各 3 张已编译协议、defId 互不共享 ⇒ 恰好 6 个持久层').toBe(6);
      const transforms = layers.map((l) => String(l.style.transform));
      // 两套朝向都在（自己 −90° / 对手 +90°），且缩放基准 = holder 宽 100 / 作者基准 200 = 0.5
      expect(transforms.some((t) => t.includes('rotate(-90deg)')), '没有一层按自己侧（−90°）旋转').toBe(true);
      expect(transforms.some((t) => t.includes('rotate(90deg)')), '没有一层按对手侧（+90°）旋转').toBe(true);
      for (const l of layers) {
        expect(String(l.style.transform), '层的缩放基准不是 holder 宽 / 200（k 的算式被改了）')
          .toContain('scale(0.5000)');
        // 前提腿：层的盒仍是**作者基准 200×280**（R15 的禁令：holder 矩形必须保持未旋转，
        // 否则 k 会算成 107.69/200 且双重旋转）
        expect(String(l.style.width), '层的宽被改成了"旋转后尺寸"').toBe('200px');
        expect(String(l.style.height)).toBe('280px');
      }
      // `body.net-page .compiled-fx`（R15-2 的光）命中的正是这些层
      expect(isClass(body, NET_PAGE_CLASS), 'body 上没有页标记 ⇒ R15-2 的规则整组失效').toBe(true);
    } finally {
      drainRaf();
      restore();
    }
  });

  it('诚实边界腿：styles-net.css 里**没有**抄 30 套协议的逐套配色（近似方案不许退化成第 31 条真相）', () => {
    const shadowRules = NET_RULES.filter((r) => /(?:^|;|\s)box-shadow\s*:/.test(r.body));
    const perProto = shadowRules.filter((r) => /\.compiled-fx-[a-z0-9-]+\s*[,{]/.test(`${r.selector} {`));
    expect(perProto.map((r) => r.selector),
      'styles-net.css 里出现了逐套协议的 `.compiled-fx-<defId>` 配色规则 —— 那会造出 30 条要与 '
      + 'styles.css / styles-gen3.css 同步的第二真相（R15-2 明确放弃配色，只做一条通用发光）').toEqual([]);
    // 反空集合：确实存在那条通用发光（否则"没有逐套规则"这个断言可能是因为一条都没有）
    expect(shadowRules.length, 'styles-net.css 里没有任何 box-shadow 规则（判据面为空）').toBeGreaterThan(0);
  });
});


/* ============================================================================
 * R15-3（修复 3）：已编译对勾 `.protocol-check` 贴住**横躺卡**的右上角
 *
 * ## 几何链条（全部由本组**独立构造**，不抄 CSS 里的数）
 *
 * 事实 ①（**徽标不旋转**）：徽标是 `.protocol` 的直接子节点、`holder` 的兄弟，
 * 而 `rotate(∓90°)` 只加在 `img.protocol-img` 上、`transform` **不继承**
 * ⇒ 徽标的屏幕位置 = 它在 `.protocol` **padding box** 里的布局位置。
 * ⇒ 本组**没有**任何"盒坐标 → ∓90° → 屏幕坐标"的换算（第一版在这里凭空造了一次旋转，
 * 于是把 `top` 解成 −2.80 / 96.64 两个不同的屏幕位置 —— 而正确解是**一个**位置）。
 *
 * 事实 ②（**远程页 `.protocol` 没有 padding / border**）：`padding: 0; border: none`
 * ⇒ 绝对定位的包含块**就是** holder 盒（同原点、同尺寸）⇒ 盒坐标 = holder 局部位移。
 *
 * 目标点 = "holder 矩形 → **旋转 90°（只交换宽高）** → 取右上角 → 按热座同构内缩 `(11k, 9k)`"：
 *   · 这一步只用"旋转 90° 交换宽高"，**不依赖**任何"旋转方向 / 盒内哪个角"的假设；
 *   · 内缩量取**闭式**：`k = --card-h / 182`（徽标缩放系数），`11k` = 中心距卡视觉右缘、
 *     `9k` = 中心距卡视觉上缘（⇒ 徽标上缘与卡视觉上缘**齐平**、右缘内缩 `2k`）。
 *   · ⚠️ **被否决的口径** `15w/280`、`13w/280`（第一版用的 4.12 / 3.57）：那两个数是从
 *     `styles.css` 的 **padding box**（含 4px padding + 1px border）量出来的，而远程页的
 *     `.protocol` 没有 padding / border ⇒ 徽标会**探出**卡视觉右缘 2.8px、上缘 3.35px。
 *     本组的变异腿把旧口径代回去 ⇒ 必须报红。
 * ========================================================================== */

describe('R15-3 · 已编译对勾 `.protocol-check`：贴住横躺卡的右上角（单规则、与朝向无关）', () => {
  /** holder（= 卡面盒 = `.protocol` 的 padding box）的宽高。 */
  const W = CARD_H * 0.5495;          // 76.930
  const H = CARD_H * 0.7692;          // 107.688
  /**
   * **徽标缩放系数**：`k = --card-h / 182`（182 = R8-1 定下的基准高度）⇒ 徽标边长 `18k`、半宽 `9k`。
   * 本组所有"贴角量"都由它派生 ⇒ 判据钉的是**闭式**，不是把 CSS 里的系数抄一遍。
   */
  const K = CARD_H / 182;             // 0.769231
  /** 徽标边长（解出来应当是 `--card-h × 18/182`）。 */
  const BADGE = 18 * K;               // 13.846
  /** 贴角内缩（对徽标**中心**）：热座同构的 `(11k, 9k)`。 */
  const INSET = { x: 11 * K, y: 9 * K };   // 8.4615 / 6.9231
  /** **被否决的旧口径**（变异腿用）：从 `styles.css` 的 padding box 量的 `15w/280`、`13w/280`。 */
  const LEGACY_INSET = { x: 15 * W / 280, y: 13 * W / 280 };   // 4.121 / 3.572

  /** 一条 `.protocol-check` 规则命中的链（**不**带任何朝向标记：几何与朝向无关）。 */
  const chain = (): StubNode[] => [
    cssNode('body', NET_PAGE_CLASS),
    cssNode('net-board', 'net-view-0'),
    cssNode('net-grid'),
    cssNode('net-lane-band'),
    cssNode('protocol-cell'),
    cssNode('protocol', 'compiled'),
    cssNode('protocol-check'),
  ];

  const resolve = (prop: string): string | null => {
    const c = chain();
    return subjectPropOf(c[c.length - 1], c, NET_RULES, prop);
  };

  it('前提腿（事实 ②）：远程页 `.protocol` 的 padding / border 都被压成 0 ⇒ 包含块 = holder 盒', () => {
    const c = chain();
    const proto = c[c.length - 2];
    const chainToProto = c.slice(0, c.length - 1);
    expect(subjectPropOf(proto, chainToProto, NET_RULES, 'padding'),
      '`.net-lane-band .protocol` 没有 padding: 0 ⇒ 包含块不等于 holder 盒（第一版多减了 5px）').toBe('0');
    expect(subjectPropOf(proto, chainToProto, NET_RULES, 'border'),
      '`.net-lane-band .protocol` 没有 border: none').toBe('none');
  });

  it('前提腿（事实 ①）：徽标由 `box`（`.protocol`）产出、且**不在** holder 里（不受 transform 影响）', () => {
    const src = stripComments(read('render.ts'));
    // 判据 = 产出语句本身（不看它与 `holder.appendChild(img)` 的距离：中间夹着注释，
    // 用"窗口内匹配"会随注释长度漂移而假红 —— 第一版就是这么写的）
    expect(src, '在 render.ts 里找不到 `if (p.compiled) box.appendChild(el(\'span\', \'protocol-check\', \'✓\'));` '
      + '—— 徽标的产出点变了，本组整条几何的前提就没了')
      .toContain("if (p.compiled) box.appendChild(el('span', 'protocol-check', '✓'));");
    // 反向：不许把徽标塞进 holder（那会让它跟着 `img.protocol-img` 一起被旋转，判据对象就换了）
    expect(/holder\.appendChild\(el\('span', 'protocol-check'/.test(src),
      '徽标被挂进了 holder —— 它会跟着协议图一起转，几何判据的对象不再是"不旋转的徽标"').toBe(false);
  });

  it('几何腿：徽标中心 = **独立构造**的"卡视觉盒右上角按 `(11k, 9k)` 内缩"（holder 矩形非零、逐位比对）', () => {
    const c = chain();
    const check = c[c.length - 1];
    const left = resolve('left');
    const top = resolve('top');
    expect(left, 'styles-net.css 里没有给 `.net-page .net-lane-band .protocol .protocol-check` 写 left —— '
      + '徽标仍停在竖版盒的老位置（悬在卡视觉上缘上方约 11px 的空白里）').toBeTruthy();
    expect(top, '没有写 top').toBeTruthy();
    const leftPx = lenPx(left!);
    const topPx = lenPx(top!);
    const widthPx = lenPx(resolve('width')!);
    // 另一侧与 bottom 必须显式中和（否则 styles.css 的 `right: 6px` 会同时生效）
    expect(resolve('right'), 'right 不是 auto ⇒ `styles.css` 的 `right:6px` 仍然生效（left+right 同时约束）').toBe('auto');
    expect(resolve('bottom'), 'bottom 不是 auto').toBe('auto');

    // ── 独立构造目标点：holder 矩形（**非零原点**，证明不是"恰好 0 也能过"）──
    const holder = { left: 137, top: 411, width: W, height: H };
    // 旋转 90° ⇒ 视觉足迹交换宽高；绕同一中心 ⇒ 右上角 = 中心 + (h/2, −w/2)
    const cardRight = holder.left + holder.width / 2 + holder.height / 2;
    const cardTop = holder.top + holder.height / 2 - holder.width / 2;
    const targetX = cardRight - INSET.x;
    const targetY = cardTop + INSET.y;
    // 事实 ② ⇒ 徽标的盒坐标**逐位等于**屏幕坐标（相对 holder 原点），不再有任何旋转映射
    const gotX = holder.left + leftPx + widthPx / 2;
    const gotY = holder.top + topPx + widthPx / 2;
    expect(gotX, `徽标中心 x=${gotX.toFixed(2)}（= holder.left + left + 半宽）不在卡视觉盒右上角内侧 `
      + `（want ${targetX.toFixed(2)}；卡右缘 ${cardRight.toFixed(2)}，内缩 ${INSET.x.toFixed(2)}）`)
      .toBeCloseTo(targetX, 1);
    expect(gotY, `徽标中心 y=${gotY.toFixed(2)} 不在卡视觉上缘内侧（want ${targetY.toFixed(2)}；`
      + `卡视觉上缘 ${cardTop.toFixed(2)}）—— 修前 top:4px 落在 y≈${(holder.top + 4 + BADGE / 2 * 0).toFixed(1)}，`
      + '离卡视觉上缘还差约 11px 的空档').toBeCloseTo(targetY, 1);
    // 反空集合：修前那两组数（竖版的 4px/6px、以及第一版错误推导出的 66.43/−2.80）都必须**不成立**
    expect(topPx, 'top 解出来与第一版错误推导的 −2.80px 相同（凭空多算了一次 ∓90° 映射）')
      .not.toBeCloseTo(-2.80, 1);
    expect(topPx, 'top 解出来仍是竖版盒的 4px —— 等于没改').not.toBeCloseTo(4, 1);
    expect(leftPx, 'left 解出来与第一版错误推导的 66.43px 相同').not.toBeCloseTo(66.43, 1);
    expect(leftPx, 'left 解出来仍是竖版盒的 right:6px 换算式 − 等于没改').not.toBeCloseTo(6, 1);

    // ── **变异腿（旧口径代回 ⇒ 必须报红）** ──
    // 把"从 padding box 量的"旧口径（15w/280、13w/280）代进同一条构造：
    //   · 旧 left = (w+h)/2 − (LEGACY.x + LEGACY.y) → 落点会比目标**右移/上移**若干 px；
    //   · 断言"当前解出来的落点 == 旧口径的落点"必须**不成立**。
    const legacyTargetX = cardRight - LEGACY_INSET.x;
    const legacyTargetY = cardTop + LEGACY_INSET.y;
    expect(gotX, `徽标落点与"旧口径（从 padding box 量 ${LEGACY_INSET.x.toFixed(2)}px）"算出的点相同 `
      + `（${legacyTargetX.toFixed(2)}）—— 等于没改`).not.toBeCloseTo(legacyTargetX, 1);
    expect(gotY, `徽标落点与"旧口径（${LEGACY_INSET.y.toFixed(2)}px）"算出的点相同（${legacyTargetY.toFixed(2)}）`)
      .not.toBeCloseTo(legacyTargetY, 1);
    // 且两个口径**确实不同**（否则上一条断言会因为"两个口径恰好一样"而静默变松）
    expect(Math.abs(INSET.x - LEGACY_INSET.x), '新旧两个口径的横向内缩量相同 ⇒ 变异腿没有区分力')
      .toBeGreaterThan(1);
    expect(Math.abs(INSET.y - LEGACY_INSET.y), '新旧两个口径的纵向内缩量相同 ⇒ 变异腿没有区分力')
      .toBeGreaterThan(1);
    // 闭式自检（不抄 CSS 里的系数）：解出来的 left/top 必须等于**闭式**推出的值
    //   left = (w+h)/2 − (11k + 9k)  [徽标左边贴到"中心内缩 11k"处 ⇒ 减半宽 9k]
    //   top  = (h−w)/2                [徽标上缘与卡视觉上缘齐平]
    // ⚠️ 容差取 0.05px（不是 0.005）：CSS 里的系数是闭式的**四位小数舍入**
    //    （`0.54946 → 0.5495`）⇒ 有一条 ~0.006px 的固有残差，把它当"不符"是假红。
    const closedLeft = (W + H) / 2 - 20 * K;
    const closedTop = (H - W) / 2;
    expect(leftPx, `left=${leftPx.toFixed(4)} 与闭式 (w+h)/2 − 20k = ${closedLeft.toFixed(4)} 不符`
      + '（差 ' + Math.abs(leftPx - closedLeft).toFixed(4) + 'px）').toBeCloseTo(closedLeft, 1);
    expect(topPx, `top=${topPx.toFixed(4)} 与闭式 (h−w)/2 = ${closedTop.toFixed(4)} 不符`)
      .toBeCloseTo(closedTop, 2);
    // 徽标整块必须落在卡的视觉足迹**之内**（这是"不会被 `.net-grid` 的 overflow 裁掉"的唯一理由）
    const badgeRight = holder.left + leftPx + BADGE;
    const badgeTop = holder.top + topPx;
    expect(badgeRight, `徽标右缘 ${badgeRight.toFixed(2)} 超出卡视觉右缘 ${cardRight.toFixed(2)}（会被裁剪/悬在卡外）`)
      .toBeLessThanOrEqual(cardRight);
    expect(badgeTop, `徽标上缘 ${badgeTop.toFixed(2)} 高于卡视觉上缘 ${cardTop.toFixed(2)}（悬在卡外空档里 = 本缺陷）`)
      .toBeGreaterThanOrEqual(cardTop);
    expect(badgeRight, '徽标右缘与卡视觉右缘的距离不是 2k（与热座 `right:6px`+4px padding 的 2px 同构；'
      + '容差 0.05px 同上：CSS 系数是闭式的四位小数舍入）')
      .toBeCloseTo(cardRight - 2 * K, 1);
    void check;
  });

  it('单一规则腿：`styles-net.css` 里只有**一条** `.protocol-check` 规则，且选择器不含任何朝向 token', () => {
    // 为什么这是**结论**而不是前提：±90° 绕同一中心旋转得到的是**同一个轴对齐包围盒**
    // ⇒ 屏幕上的"卡视觉右上角"对两套朝向是**同一个点** ⇒ 几何与朝向无关。
    // 第一版把它当成"两套朝向各一个角"，于是写了 `[data-net-rot='ccw']` / `['cw']` 两条规则，
    // 两条解出**两个不同的屏幕位置**（这正是"几何链错了"的信号）。
    const mine = NET_RULES.filter((r) => r.selector.includes('protocol-check'));
    expect(mine.length, `styles-net.css 里有 ${mine.length} 条 .protocol-check 规则（应为 1 条）`)
      .toBe(1);
    expect(mine[0].selector, '唯一那条 .protocol-check 规则的选择器里出现了朝向 token')
      .not.toMatch(/net-rot|data-net-rot|ccw|cw\b/);
    // `.protocol` 上也不该再有"没人读"的朝向标记（`render.ts` 的 data-net-rot 已删）
    expect(stripComments(read('render.ts')), 'render.ts 里仍在写 `data-net-rot`（现在没有消费方了）')
      .not.toContain('data-net-rot');
    expect(read('render.ts')).not.toContain("dataset.netRot");
    // 每一段选择器都必须含 `.net-page`（否则会串到热座页）
    for (const seg of mine[0].selector.split(',').map((s) => s.trim()).filter(Boolean)) {
      expect(seg, `规则 \`${seg}\` 没有 .net-page 前缀 —— 会串到热座页`).toContain(`.${NET_PAGE_CLASS}`);
    }
  });

  it('旋钮腿：徽标尺寸与贴角量全部是 `--card-h` 的倍数（一个数驱动全部）', () => {
    expect(coefIn(resolve('width')!), '徽标宽不是 --card-h × 18/182').toBeCloseTo(18 / 182, 4);
    expect(coefIn(resolve('height')!), '徽标高与宽不是同一个旋钮').toBeCloseTo(18 / 182, 4);
    expect(coefIn(resolve('font-size')!), '字号没跟着缩（对勾会溢出 13.85px 的圆）').toBeCloseTo(11 / 182, 4);
    expect(lenPx(resolve('width')!), '徽标宽解出来不是 13.85px').toBeCloseTo(BADGE, 2);
    // left = holder 宽（0.5495）、top = (0.7692 − 0.5495)/2 = 0.10985
    expect(coefIn(resolve('left')!), 'left 不是 --card-h × 0.5495（= holder 宽）').toBeCloseTo(0.5495, 4);
    expect(coefIn(resolve('top')!), 'top 不是 --card-h × 0.10985（= (0.7692−0.5495)/2）').toBeCloseTo(0.10985, 4);
    expect(lenPx(resolve('left')!), 'left 解出来不是 holder 宽').toBeCloseTo(W, 2);
    expect(lenPx(resolve('top')!), 'top 解出来不是盒顶到卡视觉上缘的空档').toBeCloseTo((H - W) / 2, 2);
  });

  it('热座腿：新规则带 `.net-page` 前缀 ⇒ 热座页恒不命中；styles.css 的 4px/6px 一字未改', () => {
    // ⚠️ 热座链条必须**就是热座的 DOM 形态**（否则会解到别的规则上、假红）：
    // 热座页的协议在 `renderApp` 产出的是 `.board … .protocol-cell > .protocol.compiled`，
    // 页面上**没有** `.net-board` / `.net-lane-band`。
    const checkHot = cssNode('protocol-check');
    const checkChainHot: StubNode[] = [
      cssNode('body'),
      cssNode('board'),
      cssNode('protocol-cell'),
      cssNode('protocol', 'compiled'),
      checkHot,
    ];
    for (const prop of ['top', 'right', 'left', 'bottom', 'width', 'height', 'font-size']) {
      expect(subjectPropOf(checkHot, checkChainHot, NET_RULES, prop),
        `styles-net.css 的 .protocol-check 规则在热座链条下也命中了 ${prop} ⇒ 会串页`).toBe(null);
    }
    // ② 热座样式表**一字未改**（判据对象 = styles.css 里那条规则本身）
    const hot = HOT_RULES.find((r) => r.selector.trim() === '.protocol-check');
    expect(hot, 'styles.css 里找不到 `.protocol-check` 的规则（前提面没了）').toBeTruthy();
    expect(hot!.body.replace(/\s+/g, ' '), '热座的 .protocol-check 被改动了（红线：styles.css 一行不许动）')
      .toContain('top: 4px; right: 6px;');
    expect(hot!.body.replace(/\s+/g, ' '), '热座的徽标尺寸被改动了').toContain('width: 18px; height: 18px;');
  });
});

/* ============================================================================
 * 共用的红线腿：新增的三组规则**不许**碰 styles.css / styles-gen3.css 的既有数值
 * ========================================================================== */

describe('R15 · 共享红线腿', () => {
  it('三组新规则只住在 styles-net.css：styles.css / styles-gen3.css 里的既有数值一字未动', () => {
    const hot = read('styles.css');
    const gen3 = read('styles-gen3.css');
    // ① 热座的旧发光仍在原处（供热座页继续用；远程页只是**覆盖**它）
    expect(hot, 'styles.css 的 `.protocol.compiled` 发光被删了（热座页会失去已编译高亮）')
      .toContain('.protocol.compiled { border-color: #4caf50; box-shadow: 0 0 8px rgba(76, 175, 80, 0.4); }');
    expect(hot, 'styles.css 的逐套配色被改了').toContain('.protocol.compiled-fx-assimilation { border-color: #2ec9a8;');
    expect(gen3, 'styles-gen3.css 的逐套配色被改了').toContain('.protocol.compiled-fx-envy        { border-color: #2fb3a8;');
    // ② R15 新增的**三块**里不许出现 `!important`（解析器前提：本仓守卫不建模它；
    //    ⚠️ 不能对整份 styles-net.css 断言 —— 第 4 节有一条**既有且有意**的
    //    `.net-lane-band .stack .card:hover { z-index: 60 !important }`（R1 的卡悬停压过邻卡），
    //    那是既有的、与本轮无关的红线，写成整表断言会**假红**）
    const net = read('styles-net.css');
    // R15 新增的**三块**（R15-2 的层发光、R15-2 的旧发光中和、R15-3 的徽标规则）
    const R15_HEADS = [
      '.net-page .compiled-fx {',
      '.net-page .net-lane-band .protocol.compiled {',
      '.net-page .net-lane-band .protocol .protocol-check {',
    ];
    for (const head of R15_HEADS) {
      const i = net.indexOf(head);
      expect(i, `styles-net.css 里找不到 ${head}`).toBeGreaterThan(-1);
      expect(net.slice(i, net.indexOf('}', i)), `${head} 里出现了 !important（解析器不建模它）`)
        .not.toContain('!important');
    }
    // ③ 规则确实住在 styles-net.css 里（而不是被塞进 styles.css）
    expect(net, 'styles-net.css 里找不到 R15-2 的层发光规则').toContain('.net-page .compiled-fx {');
    expect(net, 'styles-net.css 里找不到 R15-3 的徽标规则')
      .toContain('.net-page .net-lane-band .protocol .protocol-check {');
  });

  it('`--card-h` 仍是**唯一旋钮**：R15 新增的 calc 只引用它，不引入第二组字面量', () => {
    const net = read('styles-net.css');
    const r15Blocks = [
      '.net-page .compiled-fx {',
      '.net-page .net-lane-band .protocol.compiled {',
      '.net-page .net-lane-band .protocol .protocol-check {',
    ];
    for (const head of r15Blocks) {
      const i = net.indexOf(head);
      expect(i, `styles-net.css 里找不到 ${head}`).toBeGreaterThan(-1);
      const body = net.slice(i, net.indexOf('}', i));
      // 新块里不许再出现"裸像素宽度/高度"那种第二旋钮（box-shadow 的模糊半径与圆角除外：
      // 它们跟着层的 scale(k) 走，不是布局尺寸）
      expect(body, `${head} 里出现了 --card-h 之外的长度字面量（第二组旋钮）`)
        .not.toMatch(/(?:^|[;\s])(?:width|height|top|right|left|bottom)\s*:\s*-?\d+(?:\.\d+)?px/);
    }
    // 反空集合：`--card-h` 的**真值定义**在 styles-net.css 里仍恰好一处（R9-4 的单一旋钮）。
    // ⚠️ 必须先 `stripComments`：本文件的**注释里**多次提到 `--card-h: 140px` 这种写法
    //    （解说文字），不去注释会让这条断言数到 5 处而**假红**。
    const defs = [...stripComments(net).matchAll(/--card-h\s*:\s*([^;{}]+);/g)].map((m) => m[1].trim());
    expect(defs.filter((v) => v !== 'inherit').length,
      `\`--card-h\` 的真值定义不再是恰好 1 处（解出 ${defs.join(' / ')}）`).toBe(1);
    expect(cssVarOf([cssNode('net-board')], NET_RULES, '--card-h'), '`.net-board` 上解不出 --card-h').toBeTruthy();
  });
});
