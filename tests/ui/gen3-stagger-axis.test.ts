import { describe, it, expect, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { gen3DeleteFx, gen3FlipFx, type Gen3CardFxApi, type Gen3CardPayload } from '../../src/ui/fx-gen3';
import { setFxViewSeat } from '../../src/ui/fx-seat';
import { installStubDom, makeStubEl, type StubNode } from './net-dom-stub';
import { functionBody, stripComments } from './source-text';

/**
 * **R15-1 守卫：`lineCenterX` 的排序轴必须按页面取向选（横排 x / 竖排 y）**
 *
 * ## 被守的缺陷（本文件出现之前，全套 1114 项里没有一条能发现它）
 *
 * `fx-gen3.ts` 的 `lineCenterX` 是「多张同时触发」错峰编排（`queueStaggered`）的**排序键**：
 * 距离**线槽中心**最近的卡先播，向外扩散。它算的是 `|卡中心.x − 线槽中心.x|` —— 这在**热座页**
 * 正确（一条线一行、卡从左往右堆，线内位置就是 x）。
 *
 * 但**远程页**（`render-net.ts` 的 `renderNetBoard`）是"三条线 = 三根纵向的列"：同一列里
 * 每张卡与线槽的 **x 中心完全相同** ⇒ `|Δx| ≡ 0` ⇒ 排序键**全等** ⇒
 * `Array.prototype.sort` 在键相等时保留入队顺序 ⇒ 错峰退化成 **DOM 顺序**。
 * 症状：暴怒3（整线翻转）/ 新星0（整线删除）"从中间向两侧"变成"从头到尾逐张"，
 * 且**静默**（没有任何报错、没有任何守卫变红）。
 *
 * ## 这条守卫是什么腿（能证明什么 / 不能证明什么）
 *
 * **行为腿**：真调 `gen3FlipFx`（`wrath`）/ `gen3DeleteFx`（`nova`）—— 它们是与生产同源的入口，
 * 内部就是 `const sortKey = lineCenterX(node, p)` + `queueStaggered(key, sortKey, …)`。
 * 排序的**可观察后果**是延迟回调的执行顺序（`queueStaggered` 里
 * `items.slice().sort((a, b) => a.key - b.key).forEach((it, i) => setTimeout(it.run, i * gapMs))`），
 * 所以这里给 `api.buildFxCardAt` 装一个**录音器**，用假定时器把回调按时间顺序跑出来，
 * 读到的就是真实排序结果。入队顺序**故意**与距离顺序相反 —— 于是"键全等 ⇒ 退化成入队顺序"
 * 这个失败形态会被直接抓到（而不是被"刚好也排对了"掩盖）。
 *
 * 能：`lineCenterX` 取的是哪条轴、以及错峰的真实顺序。
 * **不能**：真实浏览器里的像素坐标（矩形是测试喂给桩的常量）、以及"错峰看起来顺不顺"。
 *
 * ## 假定时器与 DOM 桩的边界
 *
 * 桩的 `window.setTimeout` 就是 `globalThis.setTimeout` 的转发，`vi.useFakeTimers()` 对它生效。
 * `installStubDom()` 的 `restore()` 会把矩形常量一起复位（见 `net-dom-stub.ts` 的 `setStubRect`）。
 */

/** 造一个带私有矩形的桩节点（覆盖 `makeStubEl` 的"恒 0"矩形）。 */
function rectNode(
  tag: string, uid: string, r: { left: number; top: number; width: number; height: number },
): StubNode {
  const n = makeStubEl(tag);
  const box = {
    left: r.left, top: r.top, width: r.width, height: r.height,
    right: r.left + r.width, bottom: r.top + r.height, x: r.left, y: r.top,
  };
  (n as { getBoundingClientRect?: unknown }).getBoundingClientRect = () => box;
  n.dataset.uid = uid;
  return n;
}

/** 线槽桩：`.stack-slot[data-player][data-line]` + 私有矩形（`lineCenterX` 只读矩形）。 */
function slotNode(
  player: 0 | 1, line: number, r: { left: number; top: number; width: number; height: number },
): StubNode {
  const n = rectNode('div', `slot-${player}-${line}`, r);
  n.classList.add('stack-slot');
  n.dataset.player = String(player);
  n.dataset.line = String(line);
  return n;
}

/** 把 `document.querySelector` 换成"恒返回这个线槽"（桩的选择器引擎够用，但这里要精确控制矩形）。 */
function pinQuerySelectorTo(slot: StubNode): void {
  (globalThis as { document: { querySelector(s: string): unknown } }).document.querySelector =
    () => slot as unknown as HTMLElement;
}

/**
 * 录音器 API：`buildFxCardAt` 每被调用一次就记下**是哪张卡**。
 *
 * ⚠️ 卡的身份必须来自**回调自己拿到的 payload**（`buildFxCardAt` 的第 3 个实参就是 `p`），
 * 不能读一个共享的"当前卡"变量：三张卡的 `fire()` 是**同步**跑完的（间隔 0ms），而回调要等
 * `vi.runAllTimers()` 才执行 —— 共享变量那时只剩最后一次的值（我第一版就是这样，三条腿都读到
 * 同一个 'near'，报错信息还指向排序，实际是录音器自己的缺陷）。
 */
function recorder(): { api: Gen3CardFxApi; order: string[] } {
  const order: string[] = [];
  const noop = (): void => { /* noop */ };
  const el = (tag: string, cls: string, text?: string): HTMLElement => {
    const n = makeStubEl(tag);
    n.classList.add(...cls.split(/\s+/).filter(Boolean));
    if (text !== undefined) n.text = text;
    return n as unknown as HTMLElement;
  };
  const api = {
    el,
    buildFxCard: (node: HTMLElement) => node,
    buildFxCardAt: (_rect: DOMRect, _o: unknown, p: Gen3CardPayload) => {
      order.push(p.uid);
      return makeStubEl('div') as unknown as HTMLElement;
    },
    playCutAt: noop, playCut: noop, playShatterAt: noop, playFlip: noop, playShift: noop,
    playReturn: noop, playFlipAt: noop,
    deckPos: () => null, playDeckPlay: noop, playHandPlay: noop,
    extraZ: 1, rnd: (a: number) => a,
  } as unknown as Gen3CardFxApi;
  return { api, order };
}

/** 触发一次 FX（`lineCenterX` 在**调用时**求值，排序键因此在 `fire` 内定格）。 */
function fire(
  fn: typeof gen3DeleteFx, rec: { api: Gen3CardFxApi },
  node: StubNode, p: Gen3CardPayload,
): void {
  fn(node as unknown as HTMLElement, p, rec.api);
}

afterEach(() => { setFxViewSeat(null); vi.useRealTimers(); });

describe('R15-1 · 错峰排序键的轴（横排取 x / 竖排取 y）', () => {
  it('**远程页**（竖列）：新星0 整线删除按 **y** 距离"从中间向两侧"，不是入队顺序', () => {
    vi.useFakeTimers();
    const restore = installStubDom();
    try {
      setFxViewSeat(0);                       // ← 非 null = 远程页（`lineCenterX` 的分支开关）
      // 线槽中心 y = 700；三张卡的 |Δy|：near 20 < mid 200 < far 600
      pinQuerySelectorTo(slotNode(0, 0, { left: 300, top: 400, width: 140, height: 600 }));
      const nodes = {
        near: rectNode('div', 'near', { left: 305, top: 630, width: 130, height: 100 }), // 中心 680
        mid: rectNode('div', 'mid', { left: 305, top: 450, width: 130, height: 100 }),   // 中心 500
        far: rectNode('div', 'far', { left: 305, top: 50, width: 130, height: 100 }),    // 中心 100
      };
      const rec = recorder();
      const payload = (uid: string): Gen3CardPayload => ({
        uid, defId: 'nova-0', faceUp: true, owner: 0, line: 0,
        triggerProtocol: 'nova', triggerDefId: 'nova-0',
      });
      // ⚠️ **入队顺序 = 远 → 中 → 近**（与距离顺序**相反**）：旧的 `|Δx|` 实现在竖列里键恒 0 ⇒
      //    `sort` 稳定 ⇒ 保持入队顺序 ⇒ 得到 [far, mid, near]。
      fire(gen3DeleteFx, rec, nodes.far, payload('far'));
      fire(gen3DeleteFx, rec, nodes.mid, payload('mid'));
      fire(gen3DeleteFx, rec, nodes.near, payload('near'));
      vi.runAllTimers();
      expect(rec.order, '整线删除没有按"到链路中心最近的先播"排序（竖列里排序键全等 ⇒ 退化成入队顺序）')
        .toEqual(['near', 'mid', 'far']);
      // 反空集合：必须**不是**入队顺序（否则"键全等"也会绿）
      expect(rec.order, '排序结果与入队顺序相同 ⇒ 这条用例证明不了轴选对了')
        .not.toEqual(['far', 'mid', 'near']);
    } finally { restore(); vi.useRealTimers(); }
  });

  it('**远程页**（竖列）：暴怒3 整线翻转同样按 y 错峰（与删除走**同一个** `lineCenterX`）', () => {
    vi.useFakeTimers();
    const restore = installStubDom();
    try {
      setFxViewSeat(1);                       // 另一种视角：判据必须只看 `!== null`，与具体座位号无关
      pinQuerySelectorTo(slotNode(1, 2, { left: 700, top: 400, width: 140, height: 600 }));
      const nodes = {
        near: rectNode('div', 'near', { left: 705, top: 620, width: 130, height: 100 }), // 中心 670 ⇒ |Δy| 30
        far: rectNode('div', 'far', { left: 705, top: 100, width: 130, height: 100 }),   // 中心 150 ⇒ |Δy| 550
      };
      const rec = recorder();
      const payload = (uid: string): Gen3CardPayload => ({
        uid, defId: 'wrath-3', faceUp: true, owner: 1, line: 2,
        triggerProtocol: 'wrath', triggerDefId: 'wrath-3',
      });
      fire(gen3FlipFx, rec, nodes.far, payload('far'));    // 先入队"远"
      fire(gen3FlipFx, rec, nodes.near, payload('near'));  // 后入队"近"
      vi.runAllTimers();
      expect(rec.order, '整线翻转没有按"到链路中心最近的先播"排序').toEqual(['near', 'far']);
      expect(rec.order).not.toEqual(['far', 'near']);
    } finally { restore(); vi.useRealTimers(); }
  });

  it('**热座零变化**：`fxViewSeat() === null` 时排序键取 **x**（竖排的 y 距离在这里必须**不**参与）', () => {
    vi.useFakeTimers();
    const restore = installStubDom();
    try {
      setFxViewSeat(null);                    // ← 热座
      // 热座的一行里"线内位置"就是 x：线槽中心 x = 500，槽的高顶 = 400
      pinQuerySelectorTo(slotNode(0, 0, { left: 200, top: 400, width: 600, height: 180 }));
      const nodes = {
        // ⚠️ 两张卡的 **y 完全相同**（都在槽的垂直中心）⇒ 若实现改成用 y，"键全等 ⇒ 入队顺序"，
        //    于是这条用例会红 —— 这正是"热座不许跟着换轴"的直接判据。
        near: rectNode('div', 'near', { left: 435, top: 400, width: 130, height: 180 }), // 中心 x 500 ⇒ |Δx| 0
        far: rectNode('div', 'far', { left: 200, top: 400, width: 130, height: 180 }),   // 中心 x 265 ⇒ |Δx| 235
      };
      const rec = recorder();
      const payload = (uid: string): Gen3CardPayload => ({
        uid, defId: 'wrath-3', faceUp: true, owner: 0, line: 0,
        triggerProtocol: 'wrath', triggerDefId: 'wrath-3',
      });
      // 入队顺序 = 远 → 近；热座按 x ⇒ 必须被排成 近（|Δx| 0）→ 远（|Δx| 235）
      fire(gen3FlipFx, rec, nodes.far, payload('far'));
      fire(gen3FlipFx, rec, nodes.near, payload('near'));
      vi.runAllTimers();
      expect(rec.order, '热座的排序轴从 x 变成了 y（竖排的 y 距离在热座里恒 0 ⇒ 退化成入队顺序）')
        .toEqual(['near', 'far']);
    } finally { restore(); vi.useRealTimers(); }
  });
});

describe('R15-1 · 源码腿（轴的选择只有一处、且只由 fxViewSeat 开关）', () => {
  const src = (): string => stripComments(readFileSync(
    fileURLToPath(new URL('../../src/ui/fx-gen3.ts', import.meta.url)),
  ).subarray(0, 4 * 1024 * 1024).toString('utf8'));

  it('`lineCenterX` 体里同时出现 x 与 y 两条轴，且开关是 `fxViewSeat()`', () => {
    const body = functionBody(src(), 'lineCenterX');
    expect(body, 'lineCenterX 不再按 fxViewSeat() 选轴（竖列里排序键会退化成常量）')
      .toMatch(/fxViewSeat\(\)\s*!==\s*null/);
    expect(body, 'lineCenterX 缺 y 轴（竖排的"线内位置"只能从 y 读）')
      .toMatch(/sr\.top \+ sr\.height \/ 2/);
    expect(body, 'lineCenterX 缺 x 轴（热座逐字不变的那一半）')
      .toMatch(/sr\.left \+ sr\.width \/ 2/);
    // 反空集合：轴必须由**一个**变量派生（两处各判一次 = 将来会漂移）
    expect(body, '两条轴不是由同一个 `vertical` 判据派生的（两处会各自漂移）')
      .toMatch(/const vertical = fxViewSeat\(\) !== null;/);
  });

  it('两个消费点都把 `lineCenterX` 的结果当排序键（新星0 删除 / 暴怒3 翻转）', () => {
    const code = src();
    // 只数**调用点**（模板串实参），不数 `function queueStaggered(` 那句声明本身
    let n = 0;
    for (const _m of code.matchAll(/queueStaggered\(`/g)) n += 1;
    expect(n, `queueStaggered 的调用点数量变了（实际 ${n}）—— 请复核每一处的排序键`).toBe(2);
    expect(code, '新星0 的调用点不再使用 lineCenterX 的结果（排序键可能被就地写死成某条轴）')
      .toMatch(/queueStaggered\(`gen3-nova-delete-\$\{p\.owner\}-\$\{p\.line\}`, sortKey/);
    expect(code, '暴怒3 的调用点不再使用 lineCenterX 的结果（排序键可能被就地写死成某条轴）')
      .toMatch(/queueStaggered\(`gen3-wrath-flip-\$\{p\.owner\}-\$\{p\.line\}`, sortKey/);
  });
});
