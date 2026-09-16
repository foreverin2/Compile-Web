import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  gen3DrawFx, RULER_DEGENERATE_SPAN_PX, RULER_MIN_LEN_PX, RULER_PAD_PX,
  type Gen3CardFxApi, type Gen3DrawPayload,
} from '../../src/ui/fx-gen3';
import { setFxViewSeat } from '../../src/ui/fx-seat';
import { descendants, installStubDom, isClass, makeStubEl, setStubRectFor, type StubNode } from './net-dom-stub';
import { functionBody, stripComments } from './source-text';

/**
 * **远程页支点 F2 标尺的退化闸门**（G2 修正 R17）。
 *
 * ## 被守的缺陷
 *
 * `gen3DrawFx` 的支点标尺（ruler / 9 ticks / marker）只按 **x** 铺：
 * `width = Math.max(120, x2 - x1 + 16)`。**远程页**（三条纵向链路 + 停靠栏）里，
 * **对手的牌库**与**对手手牌的张数占位块**同处第 3 列那一个 grid 格子
 * （`styles-net.css` 的 `.net-hand-area-foe { grid-column: 3 }` 与 `.net-info-block[data-net-seat='foe']`
 * 同格）⇒ 两个锚点在 x 上只差几十像素 ⇒ `Math.max` 的下限 120 主导：
 * 画出来的是一条**与真实跨度无关**的固定短棒，且整条落在对手信息块里。
 *
 * ## 这条守卫的三条腿（能证明什么 / 不能证明什么）
 *
 * 1. **行为腿**（主判据）：用最小 DOM 桩**真跑** `gen3DrawFx`，喂两组矩形 —— 唯一变化的是
 *    "页面"（`fxViewSeat()` 与 DOM 里有没有 `.net-board`，两条都按同一页设置 ⇒ 本条**不依赖**
 *    实现选了哪个页面判据）与"两个锚点的 x 跨度"，然后数层内 `.g3-ruler` / `.g3-draw-land.fulcrum`。
 * 2. **源码腿**：`functionBody('gen3DrawFx')` 里闸门必须是**锚在实参与常量上的那一个表达式**，
 *    且标尺构造落在闸门内、落点环落在闸门外（不是"附近出现过某个词"）。
 * 3. **标定腿**：阈值必须 **大于远程页的实测跨度**（63.36px，见下），否则闸门在真页面上永不触发。
 *
 * **能**：闸门的真假、谁在闸门内、真实页面上的跨度是否被判为退化。
 * **不能**：真实布局/观感（无 jsdom ⇒ 桩里的矩形是**测试喂的常量**；真实数字来自下面那次
 * 一次性真浏览器探针，不是本文件算出来的）。
 *
 * ## 63.36px 的出处（真浏览器探针，一次性）
 *
 * Vite dev（`npx vite --port 5199`）+ headless Chrome（`--dump-dom`，1704×727，dpr 1）里跑**真**
 * `renderNetBoard`（`viewSeat: 0`，对手 = P1）再跑**真** `gen3DrawFx({player: 1, triggerProtocol: 'fulcrum'})`。
 * 探针脚本留在 `.superpowers/sdd/_probe-fulcrum.html`（该目录在 `.gitignore` 里，**不进提交**）。实测：
 *   · `.deck[data-player="1"]` 中心 x = 1143.67；`.hand[data-player="1"]` 右缘 = 1231.03
 *     ⇒ 落点 x = 1231.03 − 24 = 1207.03（对手手牌是 `handVisibility: 'count'` ⇒ 无 `.card`，
 *     `handEndPos` 走容器分支）⇒ **跨度 63.36px**；
 *   · `Math.max(120, 63.36 + 16) = 120`（兜底主导：79.36 + 40% 才是真实跨度）；
 *   · 标尺矩形 108×32（`.g3-ruler` 上有一个 0.9 的横向缩放）**100% 落在对手信息块内**
 *     （重叠 108×32 = 3456px² = 整个标尺），横穿"● 本地预览（未联机）"那一行。
 * ⇒ "40"（用户最初批准的阈值，出自"两锚点几乎重合"的**未实测**怀疑）在真页面上**永不触发**；
 * 阈值改用标尺自身的最小长度派生（`RULER_MIN_LEN_PX − RULER_PAD_PX` = 104），标定腿把这条钉住。
 *
 * ⚠️ **R17 之后（只更新说明，判据一字未改）**：`styles-net.css` 那条 `justify-self` 层叠缺陷已修
 * （张数块真的贴到右下角）⇒ 手牌容器右缘 1231.03 → 1254.83，**按 CSS 推导**跨度变成 87.16px
 * （**推导值，本轮未再测量**；上面的 63.36 仍是修前那一次真机实测的历史值）。87.16 < 104 ⇒ 标定腿
 * 与闸门结论都不变。本文件**故意不**把推导值写进判据：宁可用小一点的实测值标定，
 * 也不拿推导值冒充实测（那正是"把估算说成实测"的同一族错误）。
 */

/** 真浏览器探针实测的"牌库中心 → 手牌落点"x 跨度（出处见文件头注；**不是**本文件算出来的）。 */
const MEASURED_FOE_SPAN_X = 63.36;

afterEach(() => { setFxViewSeat(null); });   // 模块态是全局的，别漏给本文件后面的用例

/** 与生产同源的最小桩 API（支点分支只用到 `el`；`deckPos` 与 `effects/index.ts` 同款选择器）。 */
function fxApi(): Gen3CardFxApi {
  const noop = (): void => { /* noop */ };
  const el = (tag: string, cls: string, text?: string): HTMLElement => {
    const n = makeStubEl(tag);
    n.classList.add(...cls.split(/\s+/).filter(Boolean));
    if (text !== undefined) n.text = text;
    return n as unknown as HTMLElement;
  };
  return {
    el,
    buildFxCard: () => null,
    buildFxCardAt: () => null,
    playCutAt: noop, playCut: noop, playShatterAt: noop, playFlip: noop, playShift: noop,
    playReturn: noop, playFlipAt: noop,
    deckPos: (player: 0 | 1): DOMRect | null => {
      const d = document.querySelector<HTMLElement>(`.deck[data-player="${player}"]`);
      return d ? d.getBoundingClientRect() : null;
    },
    playDeckPlay: noop, playHandPlay: noop,
    extraZ: 1, rnd: (a: number) => a,
  } as unknown as Gen3CardFxApi;
}

/**
 * 造"对手侧"的桩场景：`.net-info-block[data-net-seat='foe']` 里放 `.net-piles > .deck[data-player="1"]`，
 * 同格放 `.net-hand-area-foe > .hand[data-player="1"]`（**无 `.card`** = `handVisibility: 'count'`
 * 的真实形态 ⇒ `handEndPos` 取容器矩形、`handOuterFor` = `'end'` ⇒ 落点 x = 右缘 − 24）。
 *
 * 两个锚点的矩形由调用方喂：`deckDcx` 是牌库中心 x，`handRight` 是手牌容器右缘 x
 * ⇒ 跨度 = |(handRight − 24) − deckDcx|。`remote` 同时决定"页面"的**两条表征**
 * （`fxViewSeat()` 与 `.net-board` 类），于是本文件对"实现用哪一条判据"是**中立的**。
 */
function buildFoeScene(remote: boolean, deckDcx: number, handRight: number): StubNode {
  const body = (globalThis as unknown as { document: { body: StubNode } }).document.body;
  const board = makeStubEl('div');
  board.classList.add('board');
  // 热座页没有 `.net-board`；远程页的根容器就是它（render-net.ts 的 renderNetBoard 产出）
  if (remote) board.classList.add('net-board', 'net-view-0');
  const block = makeStubEl('div');
  block.classList.add('net-info-block', 'net-info-foe');
  block.dataset.netSeat = 'foe';
  const piles = makeStubEl('div');
  piles.classList.add('net-piles');
  const deck = makeStubEl('div');
  deck.classList.add('deck');
  deck.dataset.player = '1';
  setStubRectFor(deck, { left: deckDcx - 20, top: 500, width: 40, height: 58 });
  piles.appendChild(deck);
  block.appendChild(piles);
  const area = makeStubEl('div');
  area.classList.add('net-hand-area', 'net-hand-area-foe');
  const hand = makeStubEl('div');
  hand.classList.add('hand');            // ⚠️ 无 `.card`：远程页对手手牌只有张数占位块
  hand.dataset.player = '1';
  setStubRectFor(hand, { left: handRight - 100.56, top: 594, width: 100.56, height: 19 });
  area.appendChild(hand);
  block.appendChild(area);
  board.appendChild(block);
  body.appendChild(board);
  return body;
}

/** 真跑一次支点抽牌附加层，返回 `{ fired, nodes }`（nodes = 桩 `document.body` 的全部后代）。 */
function fireFoeFulcrumDraw(o: { remote: boolean; deckDcx: number; handRight: number }): {
  fired: boolean; nodes: StubNode[];
} {
  const restore = installStubDom();
  try {
    setFxViewSeat(o.remote ? 0 : null);
    const body = buildFoeScene(o.remote, o.deckDcx, o.handRight);
    const payload: Gen3DrawPayload = {
      player: 1, count: 1, triggerProtocol: 'fulcrum', triggerDefId: 'fulcrum-3',
    };
    const fired = gen3DrawFx(payload, fxApi());
    return { fired, nodes: descendants(body) };
  } finally {
    restore();   // 桩的 document/window 只在本用例内用；节点树是普通对象，restore 后仍可遍历
  }
}

const hasClass = (nodes: StubNode[], cls: string): boolean => nodes.some((n) => isClass(n, cls));

describe('R17 · 远程页支点标尺的退化闸门（行为腿）', () => {
  it('远程页 + 跨度 20px（< 阈值）：**不建**标尺/刻度/游标，但落点环**在**', () => {
    const { fired, nodes } = fireFoeFulcrumDraw({ remote: true, deckDcx: 300, handRight: 344 });
    // 反空集合：先证明这一层真的被接管了（否则"没有标尺"可以因为"整条特效没播"而假绿）
    expect(fired, '支点抽牌层没被接管 ⇒ 本用例什么都没测到').toBe(true);
    expect(hasClass(nodes, 'g3-draw-layer'), '抽牌附加层不存在').toBe(true);
    expect(hasClass(nodes, 'g3-draw-land'), '落点环被一起省掉了（"牌会落到哪"的语义不能随标尺消失）').toBe(true);
    expect(nodes.some((n) => isClass(n, 'g3-draw-land') && isClass(n, 'fulcrum'))).toBe(true);
    expect(hasClass(nodes, 'g3-ruler'), '远程页近跨度下仍建了标尺（固定 120px 短棒压在对手信息块上）').toBe(false);
    expect(hasClass(nodes, 'g3-ruler-tick'), '刻度没跟着标尺一起省').toBe(false);
    expect(hasClass(nodes, 'g3-ruler-marker'), '游标没跟着标尺一起省').toBe(false);
  });

  it('远程页 + 跨度 300px（≥ 阈值）：标尺**在**（9 刻度 + 1 游标），长度由真实跨度决定', () => {
    const { fired, nodes } = fireFoeFulcrumDraw({ remote: true, deckDcx: 300, handRight: 624 });
    expect(fired).toBe(true);
    expect(hasClass(nodes, 'g3-ruler'), '远程页大跨度下标尺不该消失（退化判据不是"远程页一律不画"）').toBe(true);
    expect(nodes.filter((n) => isClass(n, 'g3-ruler-tick')).length).toBe(9);
    expect(nodes.filter((n) => isClass(n, 'g3-ruler-marker')).length).toBe(1);
    const ruler = nodes.find((n) => isClass(n, 'g3-ruler')) as StubNode;
    // 300 + 16 = 316 > 120 ⇒ 长度由**真实跨度**决定（下限没有主导）
    expect(String((ruler.style as Record<string, unknown>).width)).toBe('316px');
    expect(hasClass(nodes, 'g3-draw-land')).toBe(true);
  });

  it('**热座**（无 `.net-board`）+ 同样的 20px 跨度：标尺**照样在**（闸门是页面判据，不是距离判据）', () => {
    const { fired, nodes } = fireFoeFulcrumDraw({ remote: false, deckDcx: 300, handRight: 344 });
    expect(fired).toBe(true);
    expect(hasClass(nodes, 'g3-ruler'), '热座被"距离 < 阈值"这条判据误伤了（热座必须逐字不变）').toBe(true);
    expect(nodes.filter((n) => isClass(n, 'g3-ruler-tick')).length).toBe(9);
    expect(hasClass(nodes, 'g3-draw-land')).toBe(true);
  });

  it('标定腿：远程页的**实测**跨度（63.36px）必须判为退化 —— 阈值若退回 40 就永不触发', () => {
    // 63.36 是真浏览器探针测到的真实页面跨度（出处见文件头注）。这条腿钉的是**标定**：
    // 闸门的阈值必须盖住真实几何，否则"修了"在真页面上一字不变（用户批准的 40 就是这样落空的）。
    const { fired, nodes } = fireFoeFulcrumDraw({
      remote: true, deckDcx: 300, handRight: 300 + MEASURED_FOE_SPAN_X + 24,
    });
    expect(fired).toBe(true);
    expect(hasClass(nodes, 'g3-ruler'), '真实页面的跨度没被判为退化 ⇒ 闸门在生产中永不触发').toBe(false);
    expect(hasClass(nodes, 'g3-draw-land')).toBe(true);
  });
});

describe('R17 · 源码腿（闸门只有一处，且落在真实的构造点上）', () => {
  const stripped = (): string => stripComments(readFileSync(
    fileURLToPath(new URL('../../src/ui/fx-gen3.ts', import.meta.url)),
  ).subarray(0, 4 * 1024 * 1024).toString('utf8'));
  /** 空白折叠后的函数体（注释已由 `stripComments` 去掉了 ⇒ 断言不可能被注释满足）。 */
  const flat = (): string => functionBody(stripped(), 'gen3DrawFx').replace(/\s+/g, ' ');

  it('闸门 = "页面判据 ∧ 跨度 < 具名常量"（锚在实参与常量上，不是"附近出现过某个词"）', () => {
    expect(flat(), '远程页闸门不在（热座会跟着退化，或退化判据被写成别的形态）')
      .toMatch(/const degenerate = fxViewSeat\(\) !== null && x2 - x1 < RULER_DEGENERATE_SPAN_PX;/);
  });

  it('标尺在闸门**内**、落点环在闸门**外**（且闸门里没有提前 return）', () => {
    const body = flat();
    expect(body, 'ruler 的构造不在 `if (!degenerate)` 里')
      .toMatch(/if \(!degenerate\) \{ [\s\S]{0,900}?api\.el\('div', 'g3-ruler'\)/);
    expect(body, '标尺宽度没用 RULER_MIN_LEN_PX / RULER_PAD_PX（阈值与标尺几何脱钩）')
      .toMatch(/Math\.max\(RULER_MIN_LEN_PX, x2 - x1 \+ RULER_PAD_PX\)/);
    expect(body, '宽度算式里又出现了裸 120（常量被绕开）').not.toMatch(/Math\.max\(\s*120\b/);
    // 闸门块的 `}` 之后**紧跟**落点环的构造 ⇒ 环不在块里，块里也没有 return 提前退出
    expect(body, '落点环被挪进闸门里 / 闸门里提前 return（退化时"牌落到哪"的语义会一起消失）')
      .toMatch(/layer\.appendChild\(ruler\); \} const land = api\.el\('i', 'g3-draw-land fulcrum'\);/);
    // 反空集合：标尺构造点全文件只此一处（防"闸门之外再加一条备用标尺"）
    expect([...body.matchAll(/api\.el\('div', 'g3-ruler'\)/g)].length, '标尺构造点不止一处').toBe(1);
  });

  it('常量：阈值 = 标尺最小长度 − 两端余量，且**大于真实页面实测跨度**', () => {
    expect(RULER_MIN_LEN_PX).toBe(120);
    expect(RULER_PAD_PX).toBe(16);
    expect(RULER_DEGENERATE_SPAN_PX, '阈值不再是"标尺自身几何"派生的').toBe(RULER_MIN_LEN_PX - RULER_PAD_PX);
    expect(RULER_DEGENERATE_SPAN_PX,
      `阈值 ${RULER_DEGENERATE_SPAN_PX}px 不大于远程页实测跨度 ${MEASURED_FOE_SPAN_X}px ⇒ 闸门在生产中永不触发（40 就是这样）`)
      .toBeGreaterThan(MEASURED_FOE_SPAN_X);
  });

  it('热座页的两条表征（`fxViewSeat()` / 无 `.net-board`）都被本文件同时设置（判据中立性自检）', () => {
    // 这条是**元**断言：行为腿里"页面"由 `fxViewSeat()` 与 `.net-board` **一起**表达，
    // 于是将来把判据从一条换成另一条时，行为腿仍然有效（不会因为"判据换了"而假绿/假红）。
    // ⚠️ 两次场景必须各装一次桩：`installStubDom()` 的 `body` 是**同一个**用例内持续累积的，
    //    两次 append 到同一个 body 会让"热座场景里没有 .net-board"这条断言读到**上一个**场景的板子。
    const r1 = installStubDom();
    try {
      setFxViewSeat(0);
      expect(hasClass(descendants(buildFoeScene(true, 300, 344)), 'net-board')).toBe(true);
    } finally { r1(); }
    const r2 = installStubDom();
    try {
      setFxViewSeat(null);
      expect(hasClass(descendants(buildFoeScene(false, 300, 344)), 'net-board')).toBe(false);
    } finally { r2(); }
  });
});
