import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createGame } from '../../src/core/state/create';
import { renderControlModule } from '../../src/ui/render';
import { renderNetBoard } from '../../src/ui/render-net';
import { fxIsSelfSide, fxTrackEndFor, FX_TRACK_EDGE_PCT, FX_TRACK_EDGE_PCT_Y } from '../../src/ui/fx-seat';
import { descendants, installStubDom, isClass, makeStubEl, type StubNode } from './net-dom-stub';
import { stripComments } from './source-text';

/**
 * **G2 修正 R16 的行为守卫**：远程页控制轨的**位置端**（滑块贴哪一头）与**归属玩家**
 * （`held-N` / `控制权: 玩家 N`）必须是**两个**参数，且滑块停位必须与 FX 落点
 * （`fxTrackEndFor`）**逐 (座位, 持控者) 配对**相等。
 *
 * ## 为什么必须新开一个文件（而不是再加几条源码断言）
 *
 * R3~R15 期间 `renderControlModule` 的**一个** `holder` 同时当三件事用（位置 / `held-N` / 文案），
 * 而 `render-net.ts` 那次按座位的换算**方向反了**（把"端 ⇒ 绝对玩家号"当"绝对玩家号 ⇒ 端"用）：
 *  - **位置**在两种座位下**全错**（自己持控停在上端 22%、对手持控停在下端 78%）；
 *  - **归属**在 `viewSeat = 1` 时错（P2 自己持控被写成 `held-0` /"玩家 1"）；
 *  - 而 FX 侧 `fxTrackEndFor` 一直按座位算（自己 78% / 对手 22%）⇒ 两者**正好对调**，
 *    差 56% = 158px 轨道上 **88.5px**（用户观感："特效没打在滑块上"）。
 *
 * 这个缺陷**躲过了 1181 条测试**，原因值得写下来：既有守卫（`tests/ui/fx-seat.test.ts` 的 R14-5）
 * 把 FX 侧两个座位的竖向取值收成一个**集合** `{22, 78}`，再与渲染层写进 DOM 的两个停位比集合 ——
 * 而"配对整体对调"**不改变集合**（下面"反空集合"那条用例把这件事本身变成断言）。
 * 所以本条腿的判据**必须按 (seat, control) 配对**，且**真跑** `renderNetBoard`
 * （无 jsdom ⇒ 这是本仓唯一能读回"卡片实际停位"的方式）。
 *
 * ## 这个桩**能**证明什么 / **不能**证明什么（与四个 net 测试文件同一口径）
 *
 * 能：
 *  - 真跑一帧 `renderNetBoard` 后，**内联写进 DOM 的** `top` 百分比（双 rAF 之后的终值 ——
 *    `renderControlModule` 先写上一帧位置、下一帧才写目标位置，所以必须把两层 rAF 都跑完）；
 *  - `.control-module` 的类名集合、`.control-label` 的文本、以及"竖向只写 `top` 不写 `left`"；
 *  - 四种 (座位 × 持控者) 配对与 `fxTrackEndFor` 的**逐配对**相等（两边都由真代码算）。
 *
 * **不能**：
 *  - 真实布局：`top: 78%` 在 158px 轨道上到底落在哪个像素、卡片有没有出轨道、`translate(-50%,-50%)`
 *    的实际效果 —— 桩不实现任何布局（矩形是测试喂的常量，本文件连矩形都不喂）；
 *  - 观感：滑块与特效"看起来是不是打在同一个地方"（这是用户人眼验收项）；
 *  - 过渡动画的实际中间帧（`transition: 0.5s` 是 CSS 的；本文件只读终值）。
 */

/* ============================================================================
 * 渲染harness：桩 DOM + **确定性**的双 rAF 收尾
 * ========================================================================== */

const frameQueue: Array<() => void> = [];

/** 跑完当前队列里的全部 rAF 回调（FIFO；内层回调会追加到队尾，跑到空为止）。
 *
 *  ⚠️ 为什么不能用 `await drainRaf()` 猜时机：桩的 rAF 是 `setTimeout(0)`，而
 *  `renderControlModule` 的"上一帧位置"是**模块级** `controlSliderPos`（跨用例存活）——
 *  回调跑得早晚会改变读到的是"上一帧位置"还是"目标位置"。把回调**同步收集**再按 FIFO 跑完，
 *  读到的必然是终值（`tests/ui/fx-seat.test.ts` 的 R14-5 用例已记录这个坑的实测形态）。 */
const settleRaf = (): void => {
  for (let guard = 0; frameQueue.length > 0 && guard < 100; guard += 1) frameQueue.shift()!();
};

let restore: (() => void) | null = null;

afterEach(() => {
  restore?.();
  restore = null;
  frameQueue.length = 0;
});

/** 装桩 DOM 并把 `requestAnimationFrame` 换成上面的**同步收集**版（必须在 `installStubDom()` 之后）。 */
function bootStub(): void {
  restore = installStubDom();
  (globalThis as { requestAnimationFrame: (fn: () => void) => number }).requestAnimationFrame =
    (fn: () => void) => { frameQueue.push(fn); return frameQueue.length; };
}

/** 收工：还原全局（`restore()` 会把 rAF 也还原成"无害空实现"，见 net-dom-stub 的说明）。 */
function teardownStub(): void {
  restore?.();
  restore = null;
  frameQueue.length = 0;
}

/** 造一份"协议格可渲染"的合成对局（`renderProtocol` 要读 `protocols[line].compiled`）。 */
function makeState(control: -1 | 0 | 1): ReturnType<typeof createGame> {
  const s = createGame({ seed: 'r16-control-end', draftStarter: 0, firstToPlay: 1 });
  for (const p of [0, 1] as const) {
    s.players[p].protocols = [
      { defId: 'fire-0', compiled: false },
      { defId: 'ice-0', compiled: false },
      { defId: 'light-0', compiled: false },
    ] as never;
  }
  (s as { phase: string }).phase = 'turn';
  s.control = control;
  return s;
}

/** 控制轨三件东西的**读回值**（内联样式取字符串 —— `undefined` 本身也要能断言）。 */
interface ControlRead {
  /** `.control-module` 的类名串 */
  cls: string;
  /** `.control-label` 的文本 */
  label: string;
  /** `.control-slider-img` 的内联 `top`（竖向；未写时为字符串 `"undefined"`） */
  top: string;
  /** `.control-slider-img` 的内联 `left`（横向；未写时为字符串 `"undefined"`） */
  left: string;
}

/** 从一棵元素树里读控制轨（三件各**恰好**一个 —— 多个/缺失都当场报红）。 */
function readControl(root: StubNode): ControlRead {
  const all = descendants(root);
  const pick = (cls: string): StubNode => {
    const hit = all.filter((n) => isClass(n, cls));
    expect(hit.length, `元素树里 ${cls} 不是恰好一个（实际 ${hit.length} 个）`).toBe(1);
    return hit[0];
  };
  const mod = pick('control-module');
  const img = pick('control-slider-img');
  return {
    cls: mod.cls,
    label: pick('control-label').text,
    top: String(img.style.top),
    left: String(img.style.left),
  };
}

/** 内联百分比 → 数字（`"78%"` → `78`；没写内联样式时是 `NaN`，正是我们要响亮报错的形态）。 */
const pctOf = (inline: string): number => Number(inline.replace('%', ''));

/**
 * **真跑一帧远程页**：`renderNetBoard(root, s, cb, { viewSeat })`，读回控制轨的终态。
 *
 * 走的是真实入口（不是直接调 `renderControlModule`）—— 因为本任务修的正是 `render-net.ts`
 * 那次**接线**；只调助手的话，"按座位算端"这一步根本不在被测范围里。
 */
function netControlFrame(o: { viewSeat: 0 | 1; control: -1 | 0 | 1 }): ControlRead {
  bootStub();
  const root = makeStubEl('div');
  const noop = (): void => { /* noop */ };
  renderNetBoard(root as unknown as HTMLElement, makeState(o.control), {
    onAction: noop, onRendered: noop, rerender: noop, onDraftPick: noop, onDraftUnpick: noop,
    onDraftBan: noop, onWinReset: noop,
  } as never, { viewSeat: o.viewSeat, verifyHooks: false });
  settleRaf();
  const read = readControl(root);
  teardownStub();
  return read;
}

/**
 * **真跑一次热座页的那一处调用**（`render.ts` 里就是 `renderControlModule(s)` —— 只有 `holder`、
 * 不传 `axis`、更不传 `end`）。这是"热座零变化"的**被测形态本身**：多传一个参数就不是热座了。
 */
function hotControlFrame(holder: -1 | 0 | 1): ControlRead {
  bootStub();
  const s = { control: holder } as unknown as Parameters<typeof renderControlModule>[0];
  const mod = renderControlModule(s) as unknown as StubNode;
  settleRaf();
  const read = readControl(mod);
  teardownStub();
  return read;
}

/* ============================================================================
 * ① 行为腿：滑块停位 == FX 落点（**逐配对**）
 * ========================================================================== */

describe('R16 · 远程页控制轨：滑块停位与 FX 落点逐配对相等', () => {
  it('行为腿：(seat, control) 四个组合下 `top` 终值 == `fxTrackEndFor(seat, control).pct × 100`', () => {
    const observed = new Map<string, number>();
    for (const viewSeat of [0, 1] as const) {
      for (const control of [0, 1] as const) {
        const f = netControlFrame({ viewSeat, control });
        const top = pctOf(f.top);
        expect(Number.isFinite(top), `seat=${viewSeat} control=${control}：竖向滑块没有内联 top`
          + `（实际 "${f.top}"）—— 位置没有出处`).toBe(true);
        // 竖向只写 top：`left` 的 `50%` 由 styles-net.css 第 9 节中和掉（写 left 就是新行为）
        expect(f.left, `seat=${viewSeat} control=${control}：竖向分支写了内联 left（改动前只写 top）`)
          .toBe('undefined');
        observed.set(`${viewSeat}/${control}`, top);
        const at = fxTrackEndFor(viewSeat, control);
        expect(at.axis, `seat=${viewSeat} control=${control}：远程页的 FX 端点不在 y 轴`).toBe('y');
        // ① **核心不变量**：同一个数 —— 它同时守住"渲染侧改对"和"FX 侧改对"，
        //    也守住"不许只改一边"（R16 之前的形态是两者正好对调）。
        expect(top, `seat=${viewSeat} control=${control}：滑块停位 ${top}% ≠ FX 落点 `
          + `${at.pct * 100}%（两边差 ${Math.abs(top - at.pct * 100)}%）—— 观感上就是"特效没打在滑块上"`
          + `（R16 之前自己持控停 22% / 对手持控停 78%，差 56% = 158px 轨道上 88.5px）`)
          .toBe(at.pct * 100);
        // ② **绝对**判据（不靠与另一个配对比较）：自己端恒在下（大端 78）、对手端恒在上（小端 22）
        expect(top, `seat=${viewSeat} control=${control}：端归属与 fxIsSelfSide（"哪一端是自己"的`
          + `唯一判据）不同向 —— 用户裁决"自己端在下、对手端在上"`)
          .toBe(fxIsSelfSide(viewSeat, control) ? 100 - FX_TRACK_EDGE_PCT_Y : FX_TRACK_EDGE_PCT_Y);
        // ③ 取值必须来自 fx-seat 的**单一出处**（挡住"渲染侧自己写一个 22/78"）
        expect([FX_TRACK_EDGE_PCT_Y, 100 - FX_TRACK_EDGE_PCT_Y].includes(top),
          `seat=${viewSeat} control=${control}：停位 ${top}% 不是 FX_TRACK_EDGE_PCT_Y（22/78）派生的`)
          .toBe(true);
      }
    }
    expect([...observed.keys()].sort(), '四个配对必须都被观察到（少一个就是漏测）')
      .toEqual(['0/0', '0/1', '1/0', '1/1']);
  });

  it('归属腿：`held-${s.control}` 与 `控制权: 玩家 ${s.control + 1}` 用**绝对玩家号**（viewSeat=1 也对）', () => {
    for (const viewSeat of [0, 1] as const) {
      for (const control of [0, 1] as const) {
        const f = netControlFrame({ viewSeat, control });
        const cls = f.cls.split(/\s+/).filter(Boolean);
        expect(cls, `seat=${viewSeat} control=${control}：控制组件没有带 held-${control}`
          + `（实际 "${f.cls}"）—— 配色/归属跟着"端"走了`).toContain(`held-${control}`);
        expect(cls, `seat=${viewSeat} control=${control}：控制组件带了 held-${1 - control}`
          + `（实际 "${f.cls}"）`).not.toContain(`held-${1 - control}`);
        expect(f.label, `seat=${viewSeat} control=${control}：文案不是**绝对玩家号**`
          + `（viewSeat=1 时 P2 自己持控被写成"玩家 1"正是 R16 修掉的那一格）`)
          .toBe(`控制权: 玩家 ${control + 1}`);
      }
    }
  });

  it('中立腿：`s.control === -1` ⇒ `neutral` + 「中立」+ 居中，且不带 held-0/held-1（两种座位都一样）', () => {
    for (const viewSeat of [0, 1] as const) {
      const f = netControlFrame({ viewSeat, control: -1 });
      const cls = f.cls.split(/\s+/).filter(Boolean);
      expect(cls, `seat=${viewSeat}：中立控制组件没有 neutral`).toContain('neutral');
      expect(cls, `seat=${viewSeat}：中立控制组件带 held 类（配色会按玩家上色）`)
        .not.toContain('held-0');
      expect(cls, `seat=${viewSeat}：中立控制组件带 held 类`).not.toContain('held-1');
      expect(f.label, `seat=${viewSeat}：中立文案不对`).toBe('控制权: 中立');
      expect(pctOf(f.top), `seat=${viewSeat}：中立滑块不在中点（end 丢了 -1 分支就会贴某一端）`)
        .toBe(50);
    }
  });

  /**
   * **反空集合**：把"集合相等"这条**弱判据**为什么骗得过人写成可执行断言。
   *
   * R16 之前的错误配对（在本文件里按已知形态复算）与正确配对**无序集合完全相同** `{22, 78}` ——
   * 所以任何"把两端收成集合再比"的判据对"配对整体对调"零判别力（这正是缺陷躲过 1181 条测试的原因）。
   * 本条断言两件事：① 两者集合相等（弱判据确实骗得过）；② 按 `(seat, control)` **配对**后不相等
   * （本文件用的是强判据）。**只有 ② 才指向缺陷**。
   *
   * ⚠️ "错误配对"的形态不是猜的：R16 之前用**同一个桩 + 同一个入口**实测过（探针输出：
   * seat=0/control=0 → 22%、0/1 → 78%、1/0 → 78%、1/1 → 22%），与下面 `buggy` 的算式逐值相同。
   */
  it('反空集合：配对判据不是"位置集合 == {22,78}"（那种写法对"两两对调"零判别力）', () => {
    const observed = new Map<string, number>();
    const buggy = new Map<string, number>();
    for (const viewSeat of [0, 1] as const) {
      for (const control of [0, 1] as const) {
        const key = `${viewSeat}/${control}`;
        observed.set(key, pctOf(netControlFrame({ viewSeat, control }).top));
        // R16 之前的接线：`holder = fxSeatEndToPlayer(s.control, viewSeat)`（方向反了），
        // 位置又按 `holder` 算 ⇒ 端 = (control === 0 ? viewSeat : 1 - viewSeat)。
        const wrongEnd = control === 0 ? viewSeat : 1 - viewSeat;
        buggy.set(key, wrongEnd === 0 ? FX_TRACK_EDGE_PCT_Y : 100 - FX_TRACK_EDGE_PCT_Y);
      }
    }
    const sorted = (m: Map<string, number>): number[] => [...m.values()].sort((a, b) => a - b);
    const pairs = (m: Map<string, number>): string[] =>
      [...m.entries()].map(([k, v]) => `${k}=${v}`).sort();
    // ① 弱判据（集合）：正确与错误**完全一样** ⇒ 它对缺陷零判别力（这就是它当初为什么没报红）
    expect(sorted(observed), '两端集合判据失去了"弱"这个前提：本文件要证明的正是"集合相等不足以'
      + '区分配对"（若这里不等，说明取值已经不在 22/78 两点了，先修上面的行为腿）')
      .toEqual(sorted(buggy));
    // ② 强判据（配对）：两者**不同** ⇒ 本文件的行为腿用的是有牙齿的那一条
    expect(pairs(observed), '配对判据和集合判据一样弱了（观察到的配对与 R16 之前的错误配对相同 ——'
      + '要么修回了旧接线，要么这条用例被改坏了）').not.toEqual(pairs(buggy));
    // ③ 而且观察到的配对必须**正好**是错误配对的对调（挡住"另一种错法"趁虚而入）
    const flipped = new Map<string, number>(
      [...buggy.entries()].map(([k, v]) => [k, v === FX_TRACK_EDGE_PCT_Y ? 100 - FX_TRACK_EDGE_PCT_Y : FX_TRACK_EDGE_PCT_Y]),
    );
    expect(pairs(observed)).toEqual(pairs(flipped));
  });

  /**
   * **热座零变化腿**：不传新参数时的位置/类名/文案与改动前**逐位相同**。
   *
   * bug 修法给 `ControlTrackOpts` 加了 `end`（缺省 = `holder`），热座那一处调用
   * （`render.ts` 的 `renderControlModule(s)`）**一个字都没改** ⇒ 观感零变化必须是**构造性**的，
   * 而不是"我记得它没变"。这条腿读的是**改动前用探针实测的同一组值**：
   *
   * | 输入 | `cls` | `left` | `top` |
   * | --- | --- | --- | --- |
   * | `holder = 0` | `control-module held-0` | `4%` | 不写 |
   * | `holder = 1` | `control-module held-1` | `96%` | 不写 |
   * | `holder = -1` | `control-module neutral` | `50%` | 不写 |
   *
   * ⚠️ `top` 那一列是"**不写**"（`String(undefined)`）—— 横向分支只写 `left`；哪天它开始写 `top`，
   * 就是"共享助手被远程页的轴向污染"的第一征兆。
   */
  it('热座零变化腿：只给 holder（axis 缺省 x、不传 end）时 left / held-N / 文案与改动前逐位相同', () => {
    for (const holder of [0, 1] as const) {
      const f = hotControlFrame(holder);
      expect(f.cls, `holder=${holder}：热座控制组件的类名变了（改动前是 control-module held-${holder}）`)
        .toBe(`control-module held-${holder}`);
      expect(f.left, `holder=${holder}：热座滑块的 left 不再是改动前的 ${holder === 0 ? '4%' : '96%'}`
        + '（`end` 的缺省值不再是 `holder`）。⚠️ 这条只对活字面量 —— 它记的是 R16 改动前'
        + '用同一份桩实测读到的值').toBe(holder === 0 ? '4%' : '96%');
      expect(f.top, `holder=${holder}：横向分支写了内联 top（改动前只写 left —— 多写一个属性就是新行为）`)
        .toBe('undefined');
      expect(f.label, `holder=${holder}：热座文案变了（改动前是 控制权: 玩家 ${holder + 1}）`)
        .toBe(`控制权: 玩家 ${holder + 1}`);
    }
    const neutral = hotControlFrame(-1);
    expect(neutral.cls, '中立控制组件的类名变了（改动前是 control-module neutral）')
      .toBe('control-module neutral');
    expect(neutral.left, '中立滑块不在中点（改动前是 50%）').toBe('50%');
    expect(neutral.top, '中立横向滑块写了内联 top').toBe('undefined');
    expect(neutral.label, '中立文案变了（改动前是 控制权: 中立）').toBe('控制权: 中立');
    // 缺省值 = `holder` 这件事的**数值**依据：横向贴端距离仍是 fx-seat 的单一出处（4 / 96）
    expect(FX_TRACK_EDGE_PCT, '横向贴端距离不再是 4（热座两个值都会跟着漂）').toBe(4);
  });
});

/* ============================================================================
 * ② 接线腿（源码）：两件事由两个参数承担 —— 行为腿的**出处**在这里
 * ========================================================================== */

describe('R16 · 接线腿（谁给位置、谁给归属）', () => {
  const root = new URL('../../src/ui/', import.meta.url);
  const read = (rel: string): string => stripComments(
    readFileSync(fileURLToPath(new URL(rel, root))).subarray(0, 8 * 1024 * 1024).toString('utf8'),
  );

  it('`render.ts`：位置用 `end`（缺省 = holder）、类名与文案仍用 `holder`', () => {
    const src = read('render.ts');
    expect(src, '`end` 没有"缺省 = holder"（热座一传 holder 就会被算成贴小端 —— 最隐蔽的一种改坏）')
      .toMatch(/const end: -1 \| PlayerId = opts\?\.end \?\? holder;/);
    expect(src, '位置不再由 `end` 决定（退回归属玩家 ⇒ 远程页滑块端与 FX 落点再次对调）')
      .toMatch(/if \(end === 0\) target = edge;/);
    expect(src, '位置的另一端不再由 `end` 决定').toMatch(/else if \(end === 1\) target = 100 - edge;/);
    expect(src, '归属类名不再用**绝对玩家号** holder（配色会跟着"端"走）')
      .toMatch(/held-\$\{holder\}/);
    expect(src, '归属文案不再用**绝对玩家号** holder').toMatch(/玩家 \$\{holder \+ 1\}/);
  });

  it('`render-net.ts`：归属传绝对号 `s.control`、位置端传按座位算的 `netControlEnd`', () => {
    const src = read('render-net.ts');
    expect(src, '远程页的归属不再是绝对玩家号 `s.control`')
      .toMatch(/holder: s\.control,/);
    expect(src, '远程页没有把"位置端"交给助手')
      .toMatch(/end: netControlEnd\(s, viewSeat\),/);
    const at = src.indexOf('function netControlEnd(');
    expect(at, 'render-net.ts 里没有 netControlEnd（位置端没有出处）').toBeGreaterThanOrEqual(0);
    const body = src.slice(at, at + 400);
    expect(body, '`netControlEnd` 的判据不是 `fxIsSelfSide`（"哪一端是自己"的唯一出处）—— '
      + '端会与 `fxTrackEndFor` 的落点脱钩').toContain('fxIsSelfSide(');
    expect(body, '`netControlEnd` 丢了中立分支（中立滑块会贴到某一端）')
      .toContain('s.control === -1 ? -1');
  });
});
