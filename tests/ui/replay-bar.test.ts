import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { makeStubEl, descendants, queryAllIn, type StubNode } from './net-dom-stub';
import { renderReplayBar, type ReplayBarNav, type ReplayBarState } from '../../src/ui/replay-bar';
import { stripComments } from './source-text';

/**
 * G4 Task 3 守卫：重放控制条（`src/ui/replay-bar.ts` + `src/ui/styles-replay.css`）。
 *
 * ## 本文件证明什么 / 不能证明什么（**不要读成"浏览器里已验证"**）
 *  **能**（全部是"真跑一次、拿返回值 / 调用记录"的行为腿，DOM 用手写桩 `tests/ui/net-dom-stub.ts`）：
 *   1. 一次调用产出的元素树（两个节点的**身份**、挂在哪个 parent 上、`data-role` 出口齐全）；
 *   2. **无模块态**（判据 2）：对两个不同 parent 各调一次 —— 两边各一条，且**不是同一批节点对象**、
 *      内容互不干扰；
 *   3. 五个 nav 回调各自被哪个控件触发（`dispatchEvent` 真派发 + 真调用产出代码注册的监听器）；
 *   4. `paused` / `done` / `rate` 的可见形态（文案、`data-role`、`disabled`、`data-active`）；
 *   5. 进度文本、错误节点与**完成态文案**的**存在性**（非空才存在）、遮罩点不出任何回调、
 *      只读说明恒在；
 *   6. **不依赖全局 `document`**（判据 8）：本文件**从不**调 `installStubDom()`，并且额外把
 *      `globalThis.document` 摘掉再渲染一次 —— 产出代码的元素全部由**调用方给的 parent**
 *      所属文档（`parent.ownerDocument`）创建；
 *   7. 判据 9 的**纯 CSS 事实**（文本腿，理由写在那条腿里）。
 *  **不能**：真浏览器里的观感（控制条挡不挡住手牌、遮罩半透明度好不好看）、真实层叠/命中测试
 *  （桩不模拟布局、没有 stacking context —— 这正是判据 9 只能是文本腿的原因）。
 *
 * ⚠️ 桩的已知边界（`net-dom-stub.ts` 头注）：`dispatchEvent` **只向祖先冒泡、不调用派发节点
 * 自己的监听器** ⇒ 点按钮必须用 `clickNode()` 的"临时挂一个空子节点、在它上面派发、再把文案
 * 写回（顺带摘掉临时子节点）"手法（与 `local-consent.test.ts:86-93` 的 `clickIn` 同源）。
 * **本文件不复制第二份桩**（本仓已因"两份拷贝漂移"栽过）。
 */

/* ---------------- 桩夹具 ---------------- */

/** 桩节点的"所属文档"（真实 DOM 里 `parent.ownerDocument` 恒存在；桩要由**测试**给）。 */
interface StubDoc {
  createElement(tag: string): StubNode;
}

/**
 * 造一个**带所属文档**的桩根。
 *
 * ⚠️ 这里**不给桩源码加 `ownerDocument`**（`tests/ui/net-dom-stub.ts` 是共用文件，本任务不许改），
 * 而是由**调用方**（本测试）把它交进来 —— 这正是产出代码要的形状：元素从 `parent.ownerDocument`
 * 造，而不是从全局 `document` 造。全局 `document` 在本文件里**从头到尾都是 undefined**。
 */
function mountRoot(): StubNode {
  const root = makeStubEl('div');
  (root as unknown as { ownerDocument: StubDoc }).ownerDocument = {
    createElement: (tag: string) => makeStubEl(tag),
  };
  return root;
}

/** 调一次产出函数（一次转型集中在这里，不在每条腿里散落 `as`）。 */
function render(
  root: StubNode, state: ReplayBarState, nav: ReplayBarNav,
): { bar: StubNode; shield: StubNode } {
  const out = renderReplayBar(root as unknown as HTMLElement, state, nav);
  return { bar: out.bar as unknown as StubNode, shield: out.shield as unknown as StubNode };
}

/** 按 `data-role` 找节点。 */
function byRole(root: StubNode, role: string): StubNode[] {
  return queryAllIn(root, `[data-role="${role}"]`);
}

/** 按 `data-role` 找**唯一**节点（找不到/多找都**响亮**报错，而不是在 undefined 上假绿）。 */
function one(root: StubNode, role: string): StubNode {
  const hits = byRole(root, role);
  expect(hits.length, `应有唯一一个 [data-role="${role}"]，实际 ${hits.length} 个`).toBe(1);
  return hits[0];
}

/** 全部后代文本（按 DOM 顺序）。 */
function textOf(n: StubNode): string {
  return descendants(n).map((x) => x.text).join('\n');
}

/**
 * 在 `node` 上**真派发一次点击**并返回它被点击前的文案。
 *
 * ⚠️ 桩的 `dispatchEvent` 不调用派发节点自己的监听器（见文件头注）⇒ 挂一个空 `<span>` 子节点，
 * 在**它**上面派发，让冒泡路径必然**经过** `node`。派发后把原文案写回（`textContent = label`
 * 会同时摘掉那个临时子节点，且不污染后续的 `descendants` 遍历）。
 */
function clickNode(node: StubNode): string {
  const label = node.text;
  const clicker = makeStubEl('span');
  node.appendChild(clicker);
  clicker.dispatchEvent({ type: 'click', target: clicker });
  node.textContent = label;
  return label;
}

/** 把 5 个 nav 回调记成调用序列（判"点了哪个按钮"用**调用记录**，不读源码）。 */
function recorder(): { calls: string[]; nav: ReplayBarNav } {
  const calls: string[] = [];
  return {
    calls,
    nav: {
      pause: () => calls.push('pause'),
      play: () => calls.push('play'),
      next: () => calls.push('next'),
      setRate: (r) => calls.push(`setRate:${r}`),
      exit: () => calls.push('exit'),
    },
  };
}

/** 状态工厂（缺省 = 一局刚开跑：0 / 1、1×、未暂停、未结束）。 */
function st(over: Partial<ReplayBarState> = {}): ReplayBarState {
  return { position: 0, total: 1, rate: 1, paused: false, done: false, ...over };
}

/** `disabled` 的真值（真实 DOM 里是布尔属性；桩上是我们赋的普通属性）。 */
function isDisabled(n: StubNode): boolean {
  return Boolean((n as unknown as { disabled?: unknown }).disabled);
}

/**
 * 在桩节点上挂一个**临时**点击监听器。
 * `StubNode` 接口没有声明 `addEventListener`（它在 `makeStubEl` 的 `extra` 里 ⇒ 索引签名 `unknown`），
 * 所以这里集中一次转型，而不是在腿上散落 `as unknown as`。
 */
function onClick(node: StubNode, fn: () => void): void {
  (node as unknown as { addEventListener(t: string, f: () => void): void }).addEventListener('click', fn);
}

/** 一份"永远合法"的 nav（只用于不需要记调用记录的结构腿）。 */
const noopNav: ReplayBarNav = {
  pause: () => { /* noop */ },
  play: () => { /* noop */ },
  next: () => { /* noop */ },
  setRate: () => { /* noop */ },
  exit: () => { /* noop */ },
};

/* ---------------- 1. 结构与返回引用（判据 1） ---------------- */

describe('① 结构与返回引用（判据 1）', () => {
  it('一次调用 ⇒ replay-bar / replay-shield 各恰好一个，且返回的两个引用就是它们', () => {
    const root = mountRoot();
    const out = render(root, st({ position: 3, total: 47 }), noopNav);

    expect(byRole(root, 'replay-bar'), 'replay-bar 不是恰好一个').toHaveLength(1);
    expect(byRole(root, 'replay-shield'), 'replay-shield 不是恰好一个').toHaveLength(1);
    expect(out.bar, '返回的 bar 不是树上那一个').toBe(byRole(root, 'replay-bar')[0]);
    expect(out.shield, '返回的 shield 不是树上那一个').toBe(byRole(root, 'replay-shield')[0]);
  });

  it('两个节点都挂在这个 parent 上（不是挂到别处/挂到 body）', () => {
    const root = mountRoot();
    const out = render(root, st(), noopNav);
    expect(out.bar.parentElement, 'bar 的父节点不是调用方给的 parent').toBe(root);
    expect(out.shield.parentElement, 'shield 的父节点不是调用方给的 parent').toBe(root);
    // 锚点：树真的建起来了（否则上面的 parentElement 断言在两棵空树上也可能"相等地"通过）
    expect(descendants(root).length, 'parent 里几乎没有节点').toBeGreaterThan(5);
  });

  it('锚点：五个 nav 回调都有控件 ⇒ 盘面上至少 5 个 <button>（否则后面的点击腿在空集上恒真）', () => {
    const root = mountRoot();
    render(root, st(), noopNav);
    const buttons = queryAllIn(root, 'button');
    expect(buttons.length, `控制条里只有 ${buttons.length} 个按钮`).toBeGreaterThanOrEqual(5);
    // 每个按钮都必须有文案（"点了个看不见的按钮"不是可操作的界面）
    for (const b of buttons) expect(b.text, '有按钮没有文案').not.toBe('');
  });

  it('data-role 出口齐全且唯一：bar / shield / progress / readonly-note 各 1 个', () => {
    const root = mountRoot();
    render(root, st(), noopNav);
    for (const role of ['replay-bar', 'replay-shield', 'replay-progress', 'replay-readonly-note']) {
      expect(byRole(root, role), `[data-role="${role}"] 不是恰好一个`).toHaveLength(1);
    }
  });
});

/* ---------------- 2. 无模块态（判据 2） ---------------- */

describe('② 无模块态（判据 2）', () => {
  /**
   * ⚠️ **这条腿为什么钉"节点身份"而不只钉"每个 parent 各一个"**（实测过的判别力问题）：
   * 桩的 `appendChild` **不做重父化**（它只往新 parent 的 `children` 里 push，不从前一个 parent
   * 摘掉）⇒ 一个"模块级单例"被挂到第二个 parent 之后，**第一个 parent 里仍然找得到它**
   * （`queryAllIn(rootA, …)` 照样返回 1 个）。于是"每边各恰好一个"**对单例是绿的** ——
   * 只有"两次调用返回的**不是同一批对象**"才真的证明没有模块态。
   * 变异实测（M1：`renderReplayBar` 复用模块级单例）时红的正是下面这两条腿。
   */
  it('两个不同 parent 各调一次 ⇒ 两边各有一条，且**不是同一批节点对象**', () => {
    const a = mountRoot();
    const b = mountRoot();
    const ra = render(a, st({ position: 1, total: 2 }), noopNav);
    const rb = render(b, st({ position: 1, total: 2 }), noopNav);

    for (const [name, root] of [['A', a], ['B', b]] as Array<[string, StubNode]>) {
      expect(byRole(root, 'replay-bar'), `parent ${name} 里 replay-bar 不是恰好一个`).toHaveLength(1);
      expect(byRole(root, 'replay-shield'), `parent ${name} 里 replay-shield 不是恰好一个`).toHaveLength(1);
    }
    expect(ra.bar, '两次调用返回了**同一个** bar 节点（模块级单例）').not.toBe(rb.bar);
    expect(ra.shield, '两次调用返回了**同一个** shield 节点（模块级单例）').not.toBe(rb.shield);
    expect(ra.bar.parentElement, 'A 的 bar 被挂到别处去了').toBe(a);
    expect(rb.bar.parentElement, 'B 的 bar 被挂到别处去了').toBe(b);
  });

  it('内容互不干扰：先渲染 A（3 / 47）再渲染 B（9 / 9，暂停）⇒ A 仍是 A 的那一帧', () => {
    const a = mountRoot();
    const b = mountRoot();
    const ra = render(a, st({ position: 3, total: 47 }), noopNav);
    render(b, st({ position: 9, total: 9, paused: true }), noopNav);

    expect(one(a, 'replay-progress').text, 'A 的进度被 B 那次调用改掉了').toBe('3 / 47');
    expect(one(b, 'replay-progress').text).toBe('9 / 9');
    // A 里仍是"暂停"形态（paused=false），B 里才是"继续"形态（paused=true）
    expect(byRole(a, 'replay-pause'), 'A 的暂停按钮不见了（被 B 覆写？）').toHaveLength(1);
    expect(byRole(a, 'replay-play'), 'A 里出现了继续按钮（被 B 覆写？）').toHaveLength(0);
    expect(byRole(b, 'replay-play')).toHaveLength(1);
    expect(ra.bar, 'ra.bar 已不在 A 上').toBe(byRole(a, 'replay-bar')[0]);
  });
});

/* ---------------- 3. 五个控件 → 五个 nav 回调（判据 3） ---------------- */

describe('③ 控件 → nav 回调（判据 3）', () => {
  it('暂停按钮 ⇒ 恰好 nav.pause()；继续按钮 ⇒ 恰好 nav.play()', () => {
    const a = mountRoot();
    const rec1 = recorder();
    render(a, st({ paused: false }), rec1.nav);
    clickNode(one(a, 'replay-pause'));
    expect(rec1.calls, '点暂停按钮没有恰好触发 nav.pause()').toEqual(['pause']);

    const b = mountRoot();
    const rec2 = recorder();
    render(b, st({ paused: true }), rec2.nav);
    clickNode(one(b, 'replay-play'));
    expect(rec2.calls, '点继续按钮没有恰好触发 nav.play()').toEqual(['play']);
  });

  it('单步按钮 ⇒ 恰好 nav.next()', () => {
    const root = mountRoot();
    const rec = recorder();
    render(root, st(), rec.nav);
    clickNode(one(root, 'replay-next'));
    expect(rec.calls).toEqual(['next']);
  });

  it('倍速三档各自 ⇒ 恰好 nav.setRate(1|2|4)，参数就是那一档', () => {
    for (const r of [1, 2, 4] as const) {
      const root = mountRoot();
      const rec = recorder();
      render(root, st(), rec.nav);
      const target = queryAllIn(root, `[data-role="replay-rate"][data-rate="${r}"]`);
      expect(target, `找不到 data-rate="${r}" 的倍速按钮`).toHaveLength(1);
      clickNode(target[0]);
      expect(rec.calls, `点 ${r}× 没有恰好触发 nav.setRate(${r})`).toEqual([`setRate:${r}`]);
    }
  });

  it('退出按钮 ⇒ 恰好 nav.exit()', () => {
    const root = mountRoot();
    const rec = recorder();
    render(root, st(), rec.nav);
    clickNode(one(root, 'replay-exit'));
    expect(rec.calls).toEqual(['exit']);
  });

  /**
   * **生成式覆盖**（判据 3 的"每个回调都要有控件"那一半）。
   * 计划原文说"五个控件"；本实现里盘面上是 **6 个按钮**（倍速 1×/2×/4× 三个按钮共同承担
   * `setRate` 一个回调）。这条腿按"点遍**全部**按钮"来判，因此它比"五个控件"的字面**更强**：
   *  - 每次点击**恰好**新增一条回调（不许一次点击触发两条 / 一条都不触发）；
   *  - 全部点击合起来**覆盖 nav 的五个方法**（`Object.keys` 派生，不手写清单）；
   *  - 序列**逐位**相等（按钮的顺序与归属一起钉住）。
   */
  it('点遍全部控件 ⇒ 每次恰好一条回调，且合起来覆盖 nav 的全部 5 个方法', () => {
    const root = mountRoot();
    const rec = recorder();
    render(root, st({ paused: false }), rec.nav);
    const buttons = queryAllIn(root, 'button');
    expect(buttons.length, '按钮数与预期不符（新增/删除了控件？）').toBe(6);

    const perClick: number[] = [];
    for (const b of buttons) {
      const before = rec.calls.length;
      clickNode(b);
      perClick.push(rec.calls.length - before);
    }
    expect(perClick, '有控件被点击后触发了 0 条或 2 条以上回调').toEqual([1, 1, 1, 1, 1, 1]);
    expect(rec.calls, '控件的顺序/归属与预期不符').toEqual([
      'pause', 'next', 'setRate:1', 'setRate:2', 'setRate:4', 'exit',
    ]);
    // 「继续」是**同一个**切换控件的另一形态（`paused` 那一帧才出现）⇒ 必须再点一次才覆盖到它
    const pausedRoot = mountRoot();
    render(pausedRoot, st({ paused: true }), rec.nav);
    clickNode(one(pausedRoot, 'replay-play'));
    expect(rec.calls[rec.calls.length - 1], '暂停帧上的按钮没有触发 nav.play()').toBe('play');
    // 反向（防"少一个控件也绿"）：全部点击触发的回调集合 = nav 的方法集合
    const covered = [...new Set(rec.calls.map((c) => c.split(':')[0]))].sort();
    expect(covered, '有点不动的 nav 方法（回调没有控件）').toEqual(Object.keys(rec.nav).sort());
  });
});

/* ---------------- 4. paused / done / rate 的可见状态（判据 4） ---------------- */

describe('④ paused / done / rate（判据 4）', () => {
  it('暂停/继续按钮按 paused 切换文案与 data-role（两种形态互斥存在）', () => {
    const running = mountRoot();
    render(running, st({ paused: false }), noopNav);
    expect(one(running, 'replay-pause').text, '运行中那个按钮不是「暂停」').toBe('暂停');
    expect(byRole(running, 'replay-play'), '运行中不该有「继续」按钮').toHaveLength(0);

    const paused = mountRoot();
    render(paused, st({ paused: true }), noopNav);
    expect(one(paused, 'replay-play').text, '暂停时那个按钮不是「继续」').toBe('继续');
    expect(byRole(paused, 'replay-pause'), '暂停时不该有「暂停」按钮').toHaveLength(0);
  });

  it('done ⇒ 单步与继续按钮的 disabled 属性真的被设置；未 done 时不被设置（反空转）', () => {
    const finished = mountRoot();
    render(finished, st({ paused: true, done: true }), noopNav);
    expect(isDisabled(one(finished, 'replay-play')), 'done 时「继续」没有被禁用').toBe(true);
    expect(isDisabled(one(finished, 'replay-next')), 'done 时「单步」没有被禁用').toBe(true);

    const running = mountRoot();
    render(running, st({ paused: false, done: false }), noopNav);
    expect(isDisabled(one(running, 'replay-pause')), '未 done 时「暂停」被误禁用').toBe(false);
    expect(isDisabled(one(running, 'replay-next')), '未 done 时「单步」被误禁用').toBe(false);
  });

  /**
   * 阶段一评审 F3（覆盖缺口，不是缺陷）：上面那条腿只覆盖了 `done && paused`。
   * 实现是**统一**的 `toggle.disabled = state.done`（与 `paused` 无关）⇒ 必须把
   * `done === true && paused === false` 也钉住：那种形态下屏上是「暂停」按钮，它同样要禁用。
   */
  it('done 且**未**暂停时，屏上的「暂停」按钮同样被禁用（F3：覆盖 done && !paused）', () => {
    const root = mountRoot();
    render(root, st({ paused: false, done: true }), noopNav);
    expect(byRole(root, 'replay-play'), 'done 且未暂停时不该出现「继续」按钮').toHaveLength(0);
    expect(isDisabled(one(root, 'replay-pause')), 'done 时「暂停」没有被禁用').toBe(true);
    expect(isDisabled(one(root, 'replay-next')), 'done 时「单步」没有被禁用').toBe(true);
    // 反空转：同一形态下换成未 done ⇒ 两个都不该被禁用（否则上面两条可能只是"恒真"）
    const running = mountRoot();
    render(running, st({ paused: false, done: false }), noopNav);
    expect(isDisabled(one(running, 'replay-pause'))).toBe(false);
    expect(isDisabled(one(running, 'replay-next'))).toBe(false);
  });

  it('当前 rate 档带 data-active="1"，其余档**没有**这个属性；rate=0 ⇒ 三档都没有', () => {
    for (const r of [1, 2, 4] as const) {
      const root = mountRoot();
      render(root, st({ rate: r }), noopNav);
      const hits = queryAllIn(root, '[data-role="replay-rate"]');
      expect(hits, '倍速按钮不是三个').toHaveLength(3);
      expect(hits.map((b) => b.dataset.rate)).toEqual(['1', '2', '4']);
      for (const b of hits) {
        expect(b.dataset.active, `rate=${r} 时 data-rate=${String(b.dataset.rate)} 的 active 不对`)
          .toBe(b.dataset.rate === String(r) ? '1' : undefined);
      }
    }
    // 0 档（暂停）没有对应的倍速按钮 —— D8：0 = 暂停，由切换控件承担
    const zero = mountRoot();
    render(zero, st({ rate: 0 }), noopNav);
    for (const b of queryAllIn(zero, '[data-role="replay-rate"]')) {
      expect(b.dataset.active, 'rate=0 时不该有高亮档').toBe(undefined);
    }
  });
});

/* ---------------- 5. 进度（判据 5） ---------------- */

describe('⑤ 进度（判据 5）', () => {
  it('渲染成 `3 / 47` 形态，且有独立出口 replay-progress', () => {
    const root = mountRoot();
    render(root, st({ position: 3, total: 47 }), noopNav);
    expect(one(root, 'replay-progress').text).toBe('3 / 47');
  });

  it('不做格式化/取整：0 / 0 与 12000 / 12000 原样渲染', () => {
    const zero = mountRoot();
    render(zero, st({ position: 0, total: 0 }), noopNav);
    expect(one(zero, 'replay-progress').text).toBe('0 / 0');
    const big = mountRoot();
    render(big, st({ position: 12000, total: 12000 }), noopNav);
    expect(one(big, 'replay-progress').text).toBe('12000 / 12000');
  });
});

/* ---------------- 6. 错误态（判据 6） ---------------- */

describe('⑥ 错误态（判据 6）', () => {
  it('error 非空 ⇒ 出现唯一 replay-error，文本 = error 原文（在控制条内）', () => {
    const root = mountRoot();
    const out = render(root, st({ error: '引擎在第 7 步拒绝了这条操作' }), noopNav);
    const err = one(root, 'replay-error');
    expect(err.text).toBe('引擎在第 7 步拒绝了这条操作');
    expect(out.bar, 'replay-error 不在控制条里').toBe(err.parentElement);
  });

  it('error 为空（undefined / null / ""）⇒ 该节点**不存在**（不是空串节点）；反空转：真错误就出现', () => {
    const cases: Array<[string, ReplayBarState]> = [
      ['undefined', st()],
      ['null', st({ error: null })],
      ['空串', st({ error: '' })],
    ];
    for (const [name, state] of cases) {
      const root = mountRoot();
      render(root, state, noopNav);
      expect(byRole(root, 'replay-error'), `error=${name} 时仍插入了 replay-error 节点`).toHaveLength(0);
      // 锚点：同一条腿里换成真错误必须出现（否则上面的"0 个"可能只是因为整个渲染都没跑）
      expect(textOf(root), `error=${name} 时连只读说明都没有 ⇒ 渲染根本没跑`).toContain('重放中不可操作');
    }
    const withErr = mountRoot();
    render(withErr, st({ error: 'x' }), noopNav);
    expect(byRole(withErr, 'replay-error'), '真错误也没出现节点 ⇒ 上面的"0 个"是假绿').toHaveLength(1);
  });
});

/* ---------------- 6b. 完成态文案（D8 的「已重放完」；阶段一评审 F2） ---------------- */

describe('⑥b 完成态文案（D8 的「已重放完」）', () => {
  /**
   * 阶段一评审 F2：计划的 D8 明写"重放结束停在终局状态并**显示「已重放完」**"，而实现此前
   * 只用 `done` 做禁用（全文件没有一句完成态文案）⇒ 这条腿是这个缺口的归属。
   * 纪律与判据 6 对 `replay-error` **同款**：非该态时节点**不存在**，不是空串节点。
   */
  it('done ⇒ 出现唯一 replay-done-note 且含「已重放完」；只读说明仍并列存在（不替代）', () => {
    const root = mountRoot();
    render(root, st({ paused: true, done: true, position: 47, total: 47 }), noopNav);
    const note = one(root, 'replay-done-note');
    expect(note.text, '完成态文案不含「已重放完」').toContain('已重放完');
    // 并列：D3 那句"不可操作"在结束后**仍然**要在屏上（完成态不许把它顶掉）
    expect(one(root, 'replay-readonly-note').text.trim(), '完成态把只读说明顶掉了').not.toBe('');
  });

  it('未 done（运行 / 暂停两态）⇒ replay-done-note 不存在；反空转：同形态换成 done 就出现', () => {
    for (const [name, state] of [
      ['运行', st({ paused: false, done: false })],
      ['暂停', st({ paused: true, done: false })],
    ] as Array<[string, ReplayBarState]>) {
      const root = mountRoot();
      render(root, state, noopNav);
      expect(byRole(root, 'replay-done-note'), `${name} 态仍插入了 replay-done-note 节点`).toHaveLength(0);
      // 锚点：同一条腿里证明渲染真的跑了（否则上面的"0 个"可能只是因为整棵树是空的）
      expect(textOf(root), `${name} 态连只读说明都没有 ⇒ 渲染根本没跑`).toContain('重放中不可操作');
    }
    const finished = mountRoot();
    render(finished, st({ paused: false, done: true }), noopNav);
    expect(byRole(finished, 'replay-done-note'), 'done 也没出现节点 ⇒ 上面的"0 个"是假绿')
      .toHaveLength(1);
  });
});

/* ---------------- 7. 遮罩的 DOM 事实（判据 7） ---------------- */

describe('⑦ 遮罩与只读说明（判据 7）', () => {
  it('点遮罩不触发任何 nav 回调（同时证明这次点击真的派发到了祖先）', () => {
    const root = mountRoot();
    const rec = recorder();
    const out = render(root, st(), rec.nav);

    // 正控：在 root 上挂一个临时监听器，证明 clickNode 的派发**真的到达了祖先链**
    // （否则"没有回调"可能只是因为事件根本没派发出去 —— 那是假绿）
    const seen: string[] = [];
    onClick(root, () => seen.push('root'));
    clickNode(out.shield);
    expect(seen, '点击根本没有冒泡到 root ⇒ 这条腿证明不了任何事').toEqual(['root']);
    expect(rec.calls, '点遮罩竟然触发了 nav 回调').toEqual([]);
  });

  it('遮罩不是一个控件：tag = div，且点它之后屏上文本与控件形态一字不变', () => {
    const root = mountRoot();
    const rec = recorder();
    const out = render(root, st({ position: 5, total: 9 }), rec.nav);
    expect(out.shield.tag).toBe('div');
    // 快照（文本 + 每个控件形态）⇒ 点遮罩 ⇒ 两样都必须一字不变。
    // ⚠️ 腿名承诺的是"一字不变"，所以这里必须真的比一遍快照 —— 只断言 rec.calls 为空
    //    会让"点遮罩改了屏上别的东西"（例如把按钮全禁用）仍然全绿。
    const shape = (): string[] => queryAllIn(root, 'button')
      .map((b) => `${String(b.dataset.role)}|${b.text}|${String(b.dataset.active ?? '')}|${String(isDisabled(b))}`);
    const textBefore = textOf(root);
    const shapeBefore = shape();
    clickNode(out.shield);
    expect(textOf(root), '点遮罩改动了屏上的文本').toBe(textBefore);
    expect(shape(), '点遮罩改动了控件形态').toEqual(shapeBefore);
    expect(rec.calls).toEqual([]);
  });

  it('只读说明恒存在：运行 / 暂停 / 结束 / 错误 四种状态下都恰好一个且非空', () => {
    const states: Array<[string, ReplayBarState]> = [
      ['运行', st({ paused: false })],
      ['暂停', st({ paused: true })],
      ['结束', st({ paused: true, done: true, position: 47, total: 47 })],
      ['错误', st({ error: '引擎抛错' })],
    ];
    for (const [name, state] of states) {
      const root = mountRoot();
      render(root, state, noopNav);
      const note = one(root, 'replay-readonly-note');
      expect(note.text.trim(), `${name} 状态下只读说明为空`).not.toBe('');
    }
  });
});

/* ---------------- 8. 不依赖全局 document（判据 8） ---------------- */

describe('⑧ 不依赖全局 document（判据 8）', () => {
  it('把全局 document 摘掉后仍能渲染（文档随 parent 一起给）', () => {
    const g = globalThis as { document?: unknown };
    const had = 'document' in g;
    const prev = g.document;
    delete g.document;
    try {
      expect('document' in g, '本腿的前提失效：全局 document 没被摘掉').toBe(false);
      const root = mountRoot();
      const out = render(root, st({ position: 1, total: 2 }), noopNav);
      expect(byRole(root, 'replay-bar'), '没有全局 document 就渲染不出控制条').toHaveLength(1);
      expect(out.bar).toBe(byRole(root, 'replay-bar')[0]);
      expect(byRole(root, 'replay-shield')).toHaveLength(1);
    } finally {
      if (had) g.document = prev;
    }
  });

  it('源码位：replay-bar.ts 里没有裸 `document` 记号（锚点：确实用了 ownerDocument）', () => {
    const raw = readFileSync(fileURLToPath(new URL('../../src/ui/replay-bar.ts', import.meta.url)))
      .subarray(0, 512 * 1024).toString('utf8');
    const code = stripComments(raw);
    // 锚点：读对了文件（否则下面的"零命中"可能只是因为读到了空串）
    expect(code, '锚点失效：replay-bar.ts 里没有 ownerDocument').toContain('ownerDocument');
    expect(code, '锚点失效：replay-bar.ts 里没有 renderReplayBar').toContain('renderReplayBar');
    // `parent.ownerDocument` 里的 `Document` 是大写，不命中；`document.createElement` 会命中
    const bare = /(?<![\w$.])document(?![\w$])/;
    expect(bare.test(code), 'replay-bar.ts 的代码位里出现了全局 document —— '
      + '元素必须由调用方给的 parent 所属文档创建（否则无 jsdom 的 node 下测不了）').toBe(false);
  });
});

/* ---------------- 9. 遮罩的 CSS 事实（判据 9，文本腿） ---------------- */

/** 去 CSS 注释（与 `stripComments` 同一条纪律：注释不得满足判据）。 */
function stripCssComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, ' ');
}

function readUi(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)))
    .subarray(0, 8 * 1024 * 1024).toString('utf8');
}

const REPLAY_CSS = stripCssComments(readUi('../../src/ui/styles-replay.css'));

/** 被测文件自己（候选面必须排除它，理由见下面判据 9 的层叠腿）。 */
const SELF_CSS = 'styles-replay.css';
const UI_CSS_DIR = fileURLToPath(new URL('../../src/ui', import.meta.url));

/**
 * **除被测文件之外的**全部 `src/ui/*.css`（**生成式**：`readdirSync` 现扫，不手写清单）。
 *
 * 为什么必须生成式（阶段一评审 F1）：棋盘/特效层横跨**一整族**样式表（今天 6 张非 replay 表），
 * 还有 `index.html` 的外链与 JS 内联。只读一张表时，别的表将来声明 ≥ 遮罩的 z-index 就会
 * **静默穿帮而判据 9 全绿** —— 今天"全局最大值恰在 styles.css"只是巧合。
 */
const OTHER_CSS = readdirSync(UI_CSS_DIR).filter((f) => f.endsWith('.css') && f !== SELF_CSS);

/** 那一族样式表里全部 `z-index` 声明（去注释后现算；跨表取 max 才是"棋盘层上限"）。 */
const OTHER_ZS = OTHER_CSS.flatMap((f) => {
  const css = stripCssComments(readUi(`../../src/ui/${f}`));
  return [...css.matchAll(/z-index\s*:\s*(\d+)/g)].map((m) => Number(m[1]));
});

/** 某个选择器的规则体（找不到就**抛错**，而不是返回空串让断言在空集上假绿）。 */
function ruleBody(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(css);
  if (m === null) throw new Error(`样式表里找不到规则体 \`${selector}\`（改名/删掉了？）`);
  return m[1];
}

/** 规则体里的 `z-index`（找不到就抛错 —— 缺了它就是"没有层叠"，必须响亮）。 */
function zIndexOf(body: string, what: string): number {
  const m = /z-index\s*:\s*(-?\d+)/.exec(body);
  if (m === null) throw new Error(`${what} 没有 z-index 声明`);
  return Number(m[1]);
}

describe('⑨ 遮罩的 CSS 事实（判据 9 · 文本腿）', () => {
  /**
   * ── **为什么这条只能是文本腿**（判据 9 的理由，逐条） ──────────────────────────────
   * "遮罩真的挡住棋盘点击"在本仓**唯一**的成立条件是 `styles-replay.css` 里的层叠关系：
   *  ① DOM 桩（`tests/ui/net-dom-stub.ts`）的头注明写它"**只记录结构，不模拟任何布局**"：
   *     它没有布局引擎、没有命中测试（hit testing）、没有 stacking context —— 一个
   *     `position:fixed; inset:0` 的节点在桩上只是一个普通子节点，`z-index` 在桩上**不是事实**。
   *  ② 真实浏览器里的层叠与命中是**渲染引擎**的事，本仓测试环境是 `node`（无 jsdom、更无浏览器）。
   *  ⇒ "遮罩挡不挡得住"既不能在桩上跑出来、也不能在 node 里算出来，**只能读样式表**。
   *  这条腿的**承重部分**是"从磁盘**现算**棋盘/特效层那一族的 z-index 上限"（不写死数字，
   *  也不只读一张表）：写死会在任何一层抬高之后静默失效，只读一张表会在**别的表**抬高之后
   *  静默失效（阶段一评审 F1：候选面已改成 `readdirSync` 现扫 `src/ui/*.css` 整族）。
   *  变异实测：把 `.replay-shield` 的 z-index 调到棋盘之下（M4）⇒ 本条必红；
   *  往**任意一张非 replay 的 css** 里插一条 `z-index: 13000`（F1）⇒ 本条也必红。
   *  若某天这两条变异都不红了，说明它已变成没有判别力的装饰。
   */
  it('锚点：styles-replay.css 里真的能解析出两段规则体（空解析 ⇒ 下面全是废话）', () => {
    expect(REPLAY_CSS.length, 'styles-replay.css 读空了').toBeGreaterThan(200);
    expect(ruleBody(REPLAY_CSS, '.replay-shield').length).toBeGreaterThan(10);
    expect(ruleBody(REPLAY_CSS, '.replay-bar').length).toBeGreaterThan(10);
    // 候选面本身非空（否则下面的层叠腿在空集上恒真）
    expect(OTHER_CSS.length, '非 replay 的样式表少于 5 张 ⇒ 候选面塌了').toBeGreaterThanOrEqual(5);
    expect(OTHER_CSS, '候选面里混进了被测文件自己（会让 shield > max 恒假）').not.toContain(SELF_CSS);
    // 去注释真的生效（注释里写了这两个数字，不许被当成声明）
    expect(stripCssComments('/* z-index: 999999 */ .x { z-index: 1 }')).not.toContain('999999');
  });

  it('.replay-shield 是 position:fixed + inset:0（铺满视口的那种遮罩）', () => {
    const body = ruleBody(REPLAY_CSS, '.replay-shield');
    expect(body, '.replay-shield 不是 position:fixed（遮罩不会铺满视口）').toMatch(/position\s*:\s*fixed/);
    expect(body, '.replay-shield 没有 inset:0（遮罩不铺满视口）').toMatch(/inset\s*:\s*0\b/);
    // 遮罩必须是**功能件**：写了 pointer-events:none 就成了装饰（点击会穿到棋盘上）
    expect(body, '.replay-shield 把指针事件关掉了 ⇒ 它挡不住任何点击').not.toMatch(/pointer-events\s*:\s*none/);
  });

  it('层叠：遮罩 z-index 低于 .replay-bar、高于棋盘/特效层那一族的最大值（跨表现算）', () => {
    const shieldZ = zIndexOf(ruleBody(REPLAY_CSS, '.replay-shield'), '.replay-shield');
    const barZ = zIndexOf(ruleBody(REPLAY_CSS, '.replay-bar'), '.replay-bar');

    // 解析器前提：真读到了那一族样式表（否则 othersMax 会是 -Infinity，判据的上界恒真）
    expect(OTHER_ZS.length, `${OTHER_CSS.length} 张非 replay 表里 z-index 声明太少 ⇒ 解析失效`)
      .toBeGreaterThan(100);
    const othersMax = Math.max(...OTHER_ZS);
    expect(othersMax, '棋盘/特效层那一族的最大 z-index 太小 ⇒ 上面的前提没生效')
      .toBeGreaterThanOrEqual(1000);

    expect(shieldZ, `遮罩(${shieldZ}) 不低于控制条(${barZ}) ⇒ 控制条自己被挡住、点不动`)
      .toBeLessThan(barZ);
    expect(
      shieldZ,
      `遮罩(${shieldZ}) 不高于棋盘/特效层的最大值(${othersMax}，来自 ${OTHER_CSS.join(' + ')} 这一族) `
      + '⇒ 它只是装饰，棋盘照旧可点',
    ).toBeGreaterThan(othersMax);
  });
});
