import { describe, it, expect, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { HAND_CARD_W } from '../../src/ui/fx-card-size';
import { TORNADO_BASE_CARD_H } from '../../src/ui/fx-tornado';
import { clearGen2Fx, startLuckDiceFx } from '../../src/ui/fx-gen2';
import { playRevealFly } from '../../src/ui/effects';
import {
  descendants, installStubDom, isClass, makeStubEl, setStubRectFor, type StubNode,
} from './net-dom-stub';
import { functionBody, stripComments } from './source-text';

/**
 * **G2 修正 R15-B 守卫：卡片相关装饰（骰子底光 / 揭示翅膀）按页缩。**
 *
 * ## 这一族缺陷的形态（与 R15-A 同源，但对象是"装饰"而不是"落点盒"）
 *
 * 远程页把**场上卡**缩到 `--card-h: 140`（宽 100.572）、**手牌卡**缩到 100.572×137.601，
 * 而一批**装饰**的尺寸是 `styles.css` 或 JS 里的**绝对 px**。于是它们相对卡"长大"了：
 *  · 骰子底光 `.fx-luck-dice-glow`：`GLOW_W = 150` 是热座卡高 175 的 85.7%，
 *    在远程页变成卡高 140 的 **107%**（比卡还宽）；
 *  · 揭示翅膀 `.reveal-wings::before/::after`：`192×104` 原本是卡宽 130 的 1.48×，
 *    在远程页变成卡宽 100.572 的 **1.91×**。
 * 两者都挂在 `document.body` 级浮层上（`position:fixed` / body 里的幽灵），
 * **不在 `.net-board` 里** ⇒ `styles-net.css` 的页级规则**命不中它们**，
 * 唯一的办法是在 JS 里按"这一页的卡多大"内联缩。
 *
 * ## 四条腿各自能证明什么
 *
 * ① **行为腿（骰子底光）**：桩 DOM 真跑 `startLuckDiceFx`（不是文本腿），断言
 *    `glow.style.width` 在热座 = `150px`、远程页（场上卡 140）= `120px`。
 *    顺带断言**骰子层自己的盒仍是 76×76** —— 本轮明确**不缩** `DICE_W`
 *    （`.fx-luck-pip{13px}` / `border-radius:14px` 是固定 px，缩盒会让点相对变大）。
 * ② **重定位腿**：同一 uid 的**第二次/第三次**调用走"层已存在"那条分支 —— 尺寸必须
 *    跟着**当前**量到的卡高走（这条专门抓"只改创建分支、不改重定位分支"：
 *    那种实现会在第一次创建后把尺寸**冻住**）。
 * ③ **翅膀腿（行为 + 源码）**：真跑 `playRevealFly`（light 协议），读那个
 *    `.reveal-wings` 节点上的内联 `transform`；源码腿再**锚住实参表达式**
 *    `scale(${box.w / HAND_CARD_W})` —— 只查"附近出现过 handCardBox"是假绿
 *    （R15-A 的 M5 变异就是这个形态）。
 * ④ **反空集合**：热座分支必须写**可逐字验证**的 `scale(1)`；`DICE_W` 仍 `= 76`；
 *    基准常数**复用** `fx-tornado` 的 `TORNADO_BASE_CARD_H`（不得另造）。
 *
 * ## ⚠️ 能证明 / 不能证明（无 jsdom，诚实边界）
 *
 * **能**：JS 真的把哪个值写进了 `style`（行为腿跑的是产出函数本身）、探针读的是哪个节点、
 * 热座分支与改动前**逐字**相同（150px / scale(1)）、热座下探针**不会**漏进 `.net-board`
 * 之外的诱饵卡（热座用例里那张卡的 `offsetHeight` 故意设成 140）。
 * **不能**：真实浏览器布局与像素（尺寸是测试喂给桩的常量）、翅膀的**观感**是否顺眼、
 * `transform` 与 `@keyframes` 在真实合成层的交互（伪元素的 `rotate` 动画只存在于 CSS 里，
 * 桩不解算 CSS，所以"铰链不动"这条在**源码/几何推导**上成立、在桩上**不可观测** ——
 * 推导写在 `effects/index.ts` 的 `wings.style.transform` 上方）。
 */

/* ────────────────────────── 桩工具 ────────────────────────── */

/** 桩 `document.body`（每个用例先装一次 `installStubDom()`）。 */
const stubBody = (): StubNode => (globalThis as unknown as { document: { body: StubNode } }).document.body;

/** 全部带某类名的后代（前序 = DOM 顺序）。 */
const withClass = (root: StubNode, cls: string): StubNode[] =>
  descendants(root).filter((n) => isClass(n, cls));

/** 造一个带**布局盒**尺寸的桩节点（`fx-card-size` 的探针读的就是 `offsetWidth/offsetHeight`）。 */
function boxed(cls: string, w: number, h: number): StubNode {
  const el = makeStubEl('div');
  el.className = cls;
  (el as unknown as { offsetWidth: number }).offsetWidth = w;
  (el as unknown as { offsetHeight: number }).offsetHeight = h;
  return el;
}

/**
 * 挂一张"源卡"：`.net-board > .net-lane-band > .stack > .card[data-uid]`（远程页），
 * 或去掉 `.net-board` 那一层（热座）。
 *
 * ⚠️ **热座用例里这张卡的 `offsetHeight` 故意设成远程页的 140**（不是热座的 175）：
 * 这样"探针丢掉 `.net-board` 作用域"这条缺陷会立刻显形（k 会变成 0.8、底光变 120），
 * 否则热座腿证明的只是"热座没有 `.net-board`"，不是"探针被 `.net-board` 限定住"。
 * （与 `net-r15a-landing-box.test.ts` 的 `mountHotSeat` 用 200×300 诱饵同一个理由。）
 */
function mountLaneCard(opts: { uid: string; inNetBoard: boolean; h: number; w?: number }): StubNode {
  const w = opts.w ?? (opts.h - 2) * 0.71429 + 2;
  const body = stubBody();
  const band = makeStubEl('div');
  band.className = 'net-lane-band';
  const stack = makeStubEl('div');
  stack.className = 'stack';
  const card = boxed('card', w, opts.h);
  card.dataset.uid = opts.uid;
  // `cardCenterByUid` 用 rect（这个函数只认 rect；探针认的是 offset*）——两者都要给。
  setStubRectFor(card, { left: 300, top: 400, width: w, height: opts.h });
  stack.appendChild(card);
  band.appendChild(stack);
  if (opts.inNetBoard) {
    const board = makeStubEl('div');
    board.className = 'net-board';
    board.appendChild(band);
    body.appendChild(board);
  } else {
    body.appendChild(band);   // 热座：没有 `.net-board` 祖先
  }
  return card;
}

/** 取桩 body 上唯一的 `.fx-luck-dice-glow`（找不到就报红，而不是让后面的断言在 `undefined` 上炸）。 */
function onlyGlow(): StubNode {
  const glows = withClass(stubBody(), 'fx-luck-dice-glow');
  expect(glows.length, '桩上应当恰好有一个 .fx-luck-dice-glow（startLuckDiceFx 自建）').toBe(1);
  return glows[0];
}

/** 取桩 body 上唯一的 `.fx-luck-dice` 层（用来核对"骰子自己的盒没被缩"）。 */
function onlyDiceLayer(): StubNode {
  const layers = withClass(stubBody(), 'fx-luck-dice');
  expect(layers.length, '桩上应当恰好有一个 .fx-luck-dice 层').toBe(1);
  return layers[0];
}

afterEach(() => {
  // 假定时器是**本用例**的输入（见 gen3-stagger-axis.test.ts 的同一惯例）：漏还原会污染后续用例。
  vi.useRealTimers();
});

/* ────────────────────────── ① 骰子底光（行为腿） ────────────────────────── */

describe('R15-B ① 骰子底光 GLOW_W：按**这一页的场上卡**等比缩（行为腿，真跑 startLuckDiceFx）', () => {
  it('热座（无 `.net-board`）⇒ `150px`；且探针**不许**漏进热座那张 140 高的诱饵卡', () => {
    vi.useFakeTimers();
    const restore = installStubDom();
    try {
      mountLaneCard({ uid: 'u-hot', inNetBoard: false, h: 140 });   // ← 诱饵：漏作用域 ⇒ 120px
      startLuckDiceFx('u-hot');
      const glow = onlyGlow();
      expect(String(glow.style.width), '热座底光必须逐字是改动前的 150px（GLOW_W × 175/175）')
        .toBe('150px');
      expect(String(glow.style.height), '热座底光高同样逐字 150px').toBe('150px');
      // 反空集合：骰子层自己的盒仍是 76×76（本轮**不缩** DICE_W）——
      // 这一句同时钉住"缩的只有底光"，缩了骰子会让 `.fx-luck-pip{13px}` 的点相对变大。
      const box = String(onlyDiceLayer().style.cssText);
      expect(box, '骰子层自己的盒仍是 76px 宽').toContain('width:76px');
      expect(box).toContain('height:76px');
    } finally { clearGen2Fx(); restore(); vi.useRealTimers(); }
  });

  it('远程页（`.net-board` 里场上卡 offsetHeight = 140）⇒ `120px`（= 150 × 140/175）', () => {
    vi.useFakeTimers();
    const restore = installStubDom();
    try {
      const W = (140 - 2) * 0.71429 + 2;          // 场上卡布局宽（与 fx-card-size 反推的同一条算式）
      mountLaneCard({ uid: 'u-net', inNetBoard: true, h: 140, w: W });
      startLuckDiceFx('u-net');
      const glow = onlyGlow();
      expect(String(glow.style.width), '远程页底光必须是 150 × 0.8 = 120px（不是 150）')
        .toBe('120px');
      expect(String(glow.style.height), '远程页底光高同样 120px').toBe('120px');
      // 反空集合 1：**不能**是热座的 150（否则这条判据对"忘了乘 k"无感）
      expect(String(glow.style.width)).not.toBe('150px');
      // 反空集合 2：骰子自己的盒**不许**跟着缩（缩了会让 13px 的点相对变大）
      const box = String(onlyDiceLayer().style.cssText);
      expect(box, '骰子层仍是 76×76：本波明确不缩 DICE_W').toContain('width:76px');
      expect(box).toContain('height:76px');
      // 底光以骰子中心对齐：left = center.x − gw/2（gw = 120 ⇒ 减 60），不是减 75
      expect(String(glow.style.left), '远程页底光的左侧必须按**缩放后**的直径居中（−60，不是 −75）')
        .toBe(`${(300 + W / 2 - 60).toFixed(1)}px`);
    } finally { clearGen2Fx(); restore(); vi.useRealTimers(); }
  });
});

/* ────────────────────────── ② 重定位腿 ────────────────────────── */

describe('R15-B ② 重定位腿：层已存在时，尺寸必须跟着**当前**卡高（专抓"只改创建分支"）', () => {
  it('同一 uid 连调三次（175 → 140 → 175）：每次都按当次量到的卡高重写尺寸', () => {
    vi.useFakeTimers();
    const restore = installStubDom();
    try {
      // 第一次：创建分支（`.net-board` 在、卡高 175 ⇒ k = 1）
      const card = mountLaneCard({ uid: 'u-re', inNetBoard: true, h: 175 });
      startLuckDiceFx('u-re');
      expect(String(onlyGlow().style.width), '第 1 次（创建分支，k = 1）').toBe('150px');

      // 第二次：卡高变成远程页的 140 ⇒ 走"已有层"分支，尺寸必须变成 120px
      (card as unknown as { offsetHeight: number }).offsetHeight = 140;
      setStubRectFor(card, { left: 500, top: 600, width: 100.572, height: 140 });
      startLuckDiceFx('u-re');
      expect(withClass(stubBody(), 'fx-luck-dice-glow').length, '第二次调用**不许**再建一个底光').toBe(1);
      expect(String(onlyGlow().style.width),
        '已有层分支（第 2 次调用）必须用同一个 k 重写尺寸 —— 只改创建分支的实现会停在第 1 次的 150px')
        .toBe('120px');

      // 第三次：卡高回到 175 ⇒ 尺寸也必须**回得去**（不是只单向缩一次）
      (card as unknown as { offsetHeight: number }).offsetHeight = 175;
      startLuckDiceFx('u-re');
      expect(String(onlyGlow().style.width), '已有层分支（第 3 次调用，k 回到 1）必须回 150px')
        .toBe('150px');
    } finally { clearGen2Fx(); restore(); vi.useRealTimers(); }
  });
});

/* ────────────────────────── ③ 揭示翅膀 ────────────────────────── */

/** 挂两条手牌（`.hand` ×2）+ 远程页的 `.net-board > .net-hands > .card`（`handCardBox()` 的第一探针）。 */
function mountHands(opts: { netHandCard?: { w: number; h: number } }): void {
  const body = stubBody();
  for (let i = 0; i < 2; i += 1) {
    const hand = makeStubEl('div');
    hand.className = 'hand';
    setStubRectFor(hand, { left: 400, top: 800, width: 600, height: 180 });
    body.appendChild(hand);
  }
  if (opts.netHandCard) {
    const board = makeStubEl('div');
    board.className = 'net-board';
    const hands = makeStubEl('div');
    hands.className = 'net-hands';
    hands.appendChild(boxed('card', opts.netHandCard.w, opts.netHandCard.h));
    board.appendChild(hands);
    body.appendChild(board);
  }
}

/** 真跑一次揭示飞行（light 协议 ⇒ 会带翅膀），返回那个 `.reveal-wings` 节点所属的幽灵。 */
function flyReveal(index = 0): StubNode {
  return flyWithDone(index).ghost;
}
function flyWithDone(index = 0): { ghost: StubNode; doneCalls: () => number } {
  let done = 0;
  playRevealFly(
    { source: 0, shownTo: 1, defId: 'light-0', triggerProtocol: 'light', index },
    () => { done += 1; },
  );
  const ghosts = withClass(stubBody(), 'reveal-fly-ghost');
  expect(ghosts.length, '桩上应当恰好有一个 .reveal-fly-ghost（playRevealFly 自建）').toBe(1);
  return { ghost: ghosts[0], doneCalls: () => done };
}

describe('R15-B ③ 揭示翅膀：父元素内联 scale(手牌卡宽 / 130)（行为腿，真跑 playRevealFly）', () => {
  it('远程页（手牌卡 100.572）⇒ `scale(0.7736307692307692)`；翅膀节点是幽灵的第一个子节点', () => {
    vi.useFakeTimers();
    const restore = installStubDom();
    try {
      mountHands({ netHandCard: { w: 100.572, h: 137.601 } });
      const ghost = flyReveal();
      const wings = withClass(ghost, 'reveal-wings');
      expect(wings.length, 'light 协议的揭示幽灵必须带 .reveal-wings').toBe(1);
      expect(String(wings[0].style.transform),
        '翅膀父元素的内联 transform 必须是 手牌卡宽 / HAND_CARD_W = 100.572/130')
        .toBe(`scale(${100.572 / HAND_CARD_W})`);
      expect(String(wings[0].style.transform), '远程页**不许**是 scale(1)（那就是没缩）')
        .not.toBe('scale(1)');
      // 反空集合：幽灵盒本身也缩了（"相对卡"两边一起缩才叫等比）
      expect(String(ghost.style.width), '幽灵盒必须仍按这一页的手牌卡宽（100.572）')
        .toBe('100.572px');
      // 翅膀是幽灵的**第一个**子节点（先翅膀后卡面：卡面会盖住翅膀）
      expect(ghost.children[0], '翅膀必须在卡面之前 append（否则被卡面盖住）').toBe(wings[0]);
    } finally { restore(); vi.useRealTimers(); }
  });

  it('热座（无 `.net-board`）⇒ 逐字 `scale(1)`（构造性零变化）', () => {
    vi.useFakeTimers();
    const restore = installStubDom();
    try {
      mountHands({});
      const ghost = flyReveal();
      const wings = withClass(ghost, 'reveal-wings');
      expect(wings.length).toBe(1);
      expect(String(wings[0].style.transform),
        '热座必须写逐字可验证的 scale(1)（handCardBox().w === 130 === HAND_CARD_W）')
        .toBe('scale(1)');
      expect(String(ghost.style.width), '热座幽灵盒仍是热座手牌卡宽').toBe('130px');
    } finally { restore(); vi.useRealTimers(); }
  });

  it('落地收尾：跑完定时器后 `done()` 被调用、翅膀拿到 `.fade`（R15-B 改动了这段引用，需真跑到）', () => {
    vi.useFakeTimers();
    const restore = installStubDom();
    try {
      mountHands({});
      const { ghost, doneCalls } = flyWithDone();
      expect(doneCalls(), '起飞阶段不该已经 done').toBe(0);
      vi.runAllTimers();          // 400ms 落点 + 220ms 清理（假定时器 ⇒ 不会漏到 restore 之后）
      const wings = withClass(ghost, 'reveal-wings');
      expect(wings.length).toBe(1);
      expect(isClass(wings[0], 'fade'), '落地后翅膀必须拿到 .fade（渐隐）').toBe(true);
      expect(doneCalls(), '落地后必须调用 done()（下一张立即起飞）').toBe(1);
    } finally { restore(); vi.useRealTimers(); }
  });
});

/* ────────────────────────── ④ 源码腿 / 反空集合 ────────────────────────── */

/** 去注释后的源码。⚠️ 必须先去注释：`functionBody` 不做注释词法（见 `source-text.ts` 的说明），
 *  而本轮新增的说明性块注释里就有 `wings.style.transform` / `scale(...)` 字样 ——
 *  不去注释的话，源码腿会被**注释**满足（这正是本项目反复栽过的假绿形态）。 */
const srcOf = (rel: string): string =>
  stripComments(readFileSync(fileURLToPath(new URL(rel, import.meta.url)))
    .subarray(0, 8 * 1024 * 1024).toString('utf8'));

const GEN2 = srcOf('../../src/ui/fx-gen2.ts');
const EFF = srcOf('../../src/ui/effects/index.ts');

describe('R15-B ④ 源码腿：系数来自哪、两个分支都改、基准常数复用', () => {
  const dice = functionBody(GEN2, 'startLuckDiceFx');

  it('骰子：`k` 由 `stackCardBox().h / TORNADO_BASE_CARD_H` 算出（复用基准，不另造常数）', () => {
    expect(dice, 'k 必须由**场上卡**高除以共用基准得出').toContain('const k = stackCardBox().h / TORNADO_BASE_CARD_H;');
    expect(GEN2, '必须复用 fx-tornado 的基准常数（同一页两个"跟着卡缩"的族共用一条基准）')
      .toContain("import { TORNADO_BASE_CARD_H } from './fx-tornado';");
    expect(GEN2, '不许在 fx-gen2 里另造一个基准常数').not.toMatch(/const\s+TORNADO_BASE_CARD_H\s*=/);
    // 反空集合：`DICE_W` 仍是 76、`GLOW_W` 的热座值仍是 150（本轮明确不缩骰子本身）
    expect(GEN2, 'DICE_W 必须仍是 76（`.fx-luck-pip{13px}` 是固定 px，缩盒会让点相对变大）')
      .toContain('const DICE_W = 76;');
    expect(GEN2, 'GLOW_W 的热座值必须仍是 150').toContain('const GLOW_W = 150;');
  });

  it('骰子：**两个分支**（创建 + 重定位）都写尺寸，且都消费同一个 `gw`', () => {
    expect(dice, '尺寸与位置必须同出一个局部量（两处各写一遍 GLOW_W * k 就是"两份真相"）')
      .toContain('const gw = GLOW_W * k;');
    const writes = dice.match(/glow\.style\.width = `\$\{gw\}px`;/g) ?? [];
    expect(writes.length, '创建分支与"已有层"重定位分支**都必须**写宽度（漏一处 ⇒ 只改一半）').toBe(2);
    expect(dice, '不许再出现"裸 GLOW_W 当尺寸"的写法').not.toMatch(/glow\.style\.(width|height) = `\$\{GLOW_W\}px`/);
  });

  const fly = functionBody(EFF, 'playRevealFly');

  it('翅膀：内联 transform 的**实参表达式**是 `box.w / HAND_CARD_W`（锚实参，不查"附近有 handCardBox"）', () => {
    // ① `box` 必须在本函数里由 `handCardBox()` 绑定，且绑定发生在赋值之前
    const iBox = fly.indexOf('const box = handCardBox();');
    const iSet = fly.indexOf('wings.style.transform');
    expect(iBox, 'playRevealFly 里必须 `const box = handCardBox();`').toBeGreaterThanOrEqual(0);
    expect(iSet, 'playRevealFly 里必须出现 `wings.style.transform`').toBeGreaterThanOrEqual(0);
    expect(iSet, '`box` 必须在赋值之前绑定').toBeGreaterThan(iBox);
    // ② 整条语句逐字锚定（只查"附近出现过 handCardBox"会被别的赋值满足 —— R15-A 的 M5）
    expect(fly, '缩放系数必须**来自 `box.w`**（手牌卡宽）除以 HAND_CARD_W')
      .toMatch(/wings\.style\.transform = `scale\(\$\{box\.w\s*\/\s*HAND_CARD_W\}\)`;/);
    // ③ 反向：源码里**不许**写死 `scale(1)` —— 热座的 1 必须是算出来的（130/130）
    expect(fly, '不许写死 scale(1)：那样远程页也不缩，且热座腿会因"源码恰好等于期望"而失去判别力')
      .not.toMatch(/scale\(\s*1\s*\)/);
    expect(fly, '分母不许换成裸数字（`/ 130` 等于把 HAND_CARD_W 抄成第二份）')
      .not.toMatch(/scale\(\$\{box\.w\s*\/\s*130\}\)/);
  });

  it('反空集合：分母常量本身必须是热座手牌卡宽 130（否则热座的 scale(1) 不再是恒等）', () => {
    expect(HAND_CARD_W, 'HAND_CARD_W 是这对 192×104 翅膀的设计基准卡宽').toBe(130);
    expect(TORNADO_BASE_CARD_H, 'TORNADO_BASE_CARD_H 是"跟着卡缩"族的共用基准').toBe(175);
  });
});
