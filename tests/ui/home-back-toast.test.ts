import { describe, it, expect, afterEach, afterAll, beforeEach } from 'vitest';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  installStubDom,
  makeStubEl,
  queryAllIn,
  descendants,
  type StubNode,
} from './net-dom-stub';
import { renderHome, renderLibrary, renderRules, renderModeSelect, type HomeNav } from '../../src/ui/home';
import { stripComments, functionBody } from './source-text';

/**
 * ★ 2026-10-03（修用户 2026-10-02 报的缺陷）：**「返回主页」不许把点击事件当提示文案**。
 *
 * ## 缺陷现场（用户截图确认）
 *
 * 首页 →「查看协议及其所属卡牌」→「返回主页」之后，屏幕顶部中央弹出一个**棕色气泡**
 * （`.home-toast`：`styles.css:5287` 的 `border: 1px solid #e0a030` + `color: #ffe2a0`），
 * 里面写的不是中文，而是 **`[object PointerEvent]`**。
 *
 * ## 根因（一条链，四个环节，每一环都能在本文件里对着源码看出来）
 *
 *   1. `src/ui/home.ts` 的 `button()` 把回调**原样**挂成监听器：
 *      `b.addEventListener('click', onClick)` ⇒ 回调收到的第一个实参是**事件对象**；
 *   2. `renderLibrary` 改前那一行是 `button('btn', t('common.back-home'), back)`
 *      —— 把宿主给的 `back` 直传进去 ⇒ `back` 收到的第一个实参是那个事件；
 *   3. 宿主（`src/main.ts` 的 `openLibrary`）给的 `back` 就是 `showHome`，而
 *      `showHome(initialToast?: string)` 的第一个形参正是"进首页要说的一句话"
 *      ⇒ 事件对象成了 `initialToast`；
 *   4. `renderHome` 画完之后 `showToast(nav.initialToast)`，而 `showToast` 里是
 *      `el('div', 'home-toast', msg)` → `node.textContent = msg` ⇒ **对象按 DOM 的
 *      字符串化规则变成 `[object PointerEvent]`**（浏览器里 `click` 事件的接口就是
 *      `PointerEvent`；换成 `MouseEvent` 环境也只是同一句话换个类名）。
 *
 * ## 这一组证明什么 / 不能证明什么
 *
 *  **能**（全部是"真跑一次、看屏上树里有什么"的行为腿，DOM 用手写桩 `tests/ui/net-dom-stub.ts`）：
 *   1. **按产品真实调用路径**走一遍：首页 → 点「查看协议及其所属卡牌」→ 点「返回主页」，
 *      断言 `document.body` 上**没有** `.home-toast`，屏上任何文本都不含 `[object`；
 *   2. 同一个坑的另一条返回路径（规则页）同款断言；
 *   3. **兜底那一层的"腿"**：`showToast` 只认非空字符串 —— 事件对象 / 数字 / `undefined`
 *      / 空串 / `null` 一律**不产出气泡**；即便喂一个**冻结对象**（写它的任何属性都会抛）
 *      也不抛异常，证明守卫跑在"读"之前；
 *   4. **反向锚点**（不是源码腿，是行为腿）：宿主接线改成 `renderLibrary(root, showHome)`
 *      之后，把 `renderLibrary` / `renderRules` / `renderModeSelect` 里的箭头壳去掉、
 *      直接把回调传进 `button()` ⇒ 本文件前两组当场红（截图那件事能在单测里复现）。
 *      这条锚点钉的是"**壳本身是判据的一部分**"，防止将来有人把壳删掉而套件仍然全绿。
 *   5. 正例：`initialToast` 给一句**真字符串**时该气泡照样出现、文案逐字相等 ——
 *      否则"屏上没有气泡"可能只是因为整条提示链根本不通（那这条腿就是假绿）。
 *
 *  **不能**：真实浏览器里的观感与层叠；`[object PointerEvent]` 这个**确切类名**（桩上派发的是
 *  普通对象，字符串化出来是 `[object Object]`）。那一半由真机自查（无头 Chrome + CDP）负责，
 *  本文件只声称"屏上不出现 `[object` 这样的垃圾、也不出现那个气泡"。
 */

const restores: Array<() => void> = [];

beforeEach(() => {
  restores.push(installStubDom());
});

afterEach(() => {
  while (restores.length > 0) restores.pop()?.();
});

/** 桩上的 `document.body`（`installStubDom()` 每次给一个**新的** body）。 */
function body(): StubNode {
  return (globalThis as unknown as { document: { body: StubNode } }).document.body;
}

/** 在某个节点上**真派发一次点击**（桩的 `dispatchEvent` 只向祖先冒泡，不叫派发节点自己的监听器）。 */
function clickOn(node: StubNode): void {
  const clicker = makeStubEl('span');
  node.appendChild(clicker);
  clicker.dispatchEvent({ type: 'click', target: clicker });
}

/** 树里所有节点的文本（按 DOM 顺序） */
function textsOf(n: StubNode): string[] {
  return descendants(n).map((x) => x.text);
}

/** 屏上（`document.body`）所有 `.home-toast` 节点。 */
function toasts(): StubNode[] {
  return queryAllIn(body(), '.home-toast');
}

/** 按类名在整棵树里找节点（**不断言唯一**：本文件要看的正是"有几个"）。 */
function byClass(root: StubNode, cls: string): StubNode[] {
  return queryAllIn(root, `.${cls}`);
}

/**
 * 造一枚"与 `src/ui/home.ts` 的 `button()` **逐字同形**"的按钮：回调**原样**挂成点击监听器。
 *
 * 桩的 `addEventListener` 不在 `StubNode` 的显式成员里（只在索引签名里 ⇒ 读出来是 `unknown`），
 * 而 `net-dom-stub.ts` 的实现确实支持它（R19）—— 所以这里按能力显式取用，不做静默降级：
 * 拿不到这个能力就当场抛（否则"回调被当事件处理器调用"这件事在桩上根本跑不起来，腿会假绿）。
 */
function stubButton(label: string, onClick: (ev?: unknown) => void): StubNode {
  const b = makeStubEl('button');
  b.textContent = label;
  const listen = b.addEventListener as unknown as ((t: string, fn: (ev?: unknown) => void) => void);
  if (typeof listen !== 'function') throw new Error('桩没有 addEventListener（R19 能力缺失）');
  listen.call(b, 'click', onClick);
  return b;
}

/** 首页那排按钮里按**可见文案**找一枚按钮（图鉴 / 规则都是这么进去的）。 */
function buttonByLabel(root: StubNode, label: string): StubNode {
  const hits = byClass(root, 'home-btn').filter((b) => b.text === label);
  expect(hits.length, `首页上应有唯一一枚文案为「${label}」的按钮，实际 ${hits.length} 枚`).toBe(1);
  return hits[0];
}

const LIBRARY_LABEL = '查看协议及其所属卡牌';
const RULES_LABEL = '查看一/二/三代规则图纸';

/* ==================================================================== *
 * 1. 产品真实路径：首页 → 图鉴 → 返回主页
 * ==================================================================== */

describe('★ 产品真实路径：首页 →「查看协议及其所属卡牌」→「返回主页」', () => {
  /**
   * 走一遍真路径，返回三个观测点：`{ home, library, afterBack }`
   * （`afterBack` = 返回之后 `#app` 里那棵树 = 新的首页）。
   *
   * ⚠️ 接线**逐字照 `src/main.ts` 的 `showHome`**：`openLibrary` 是
   * `() => renderLibrary(root, showHome)`（那边多一个 `leaveHome()`，与提示链无关）。
   * 本函数**不复刻**任何修复逻辑 —— 壳修在 `home.ts` 里，这里只负责走路径。
   */
  function walk(which: 'library' | 'rules'): {
    root: StubNode;
    opened: StubNode;
    afterBack: StubNode;
    hostToastCalls: Array<unknown>;
  } {
    const root = makeStubEl('div');
    const hostToastCalls: Array<unknown> = [];
    const nav: HomeNav = {
      startGame: () => { /* 本文件不测 */ },
      openLibrary: () => { renderLibrary(root as unknown as HTMLElement, showHome); },
      openRules: () => { renderRules(root as unknown as HTMLElement, showHome); },
      openLocalData: () => { /* 本文件不测 */ },
      openSettings: () => { /* 本文件不测 */ },
      openFeedback: () => { /* 本文件不测 */ },
      openCardmaker: () => { /* 本文件不测 */ },
      openTutorial: () => { /* 本文件不测 */ },
    };
    /** 宿主的 `showHome(initialToast?)` —— 与产出代码同形（**普通函数**：要的就是"第一个形参位置"） */
    function showHome(initialToast?: string): void {
      hostToastCalls.push(initialToast);
      renderHome(root as unknown as HTMLElement, { ...nav, initialToast });
    }
    showHome(); // 进首页
    const home = byClass(root, 'home-screen')[0];
    clickOn(buttonByLabel(home, which === 'library' ? LIBRARY_LABEL : RULES_LABEL));
    const opened = which === 'library'
      ? byClass(root, 'library-screen')[0]
      : byClass(root, 'rules-screen')[0];
    // 目标屏里那枚「返回主页」：`subpage-head` 里的 `btn`
    const backBtn = queryAllIn(opened, '.subpage-head .btn')[0];
    expect(backBtn, '目标屏里没有「返回主页」按钮').toBeDefined();
    clickOn(backBtn);
    return { root, opened, afterBack: byClass(root, 'home-screen')[0], hostToastCalls };
  }

  it('返回之后 `document.body` 上一个 `.home-toast` 都没有', () => {
    const r = walk('library');
    expect(toasts().map((t) => t.text), '「返回主页」不该弹任何提示').toEqual([]);
    // 宿主被调了两次（进首页 / 返回主页），两次的 `initialToast` 都必须是"没有"：
    // 若返回那一次拿到的是事件对象，这里会看到它（第一条腿的"没有气泡"就可能是被兜底层挡下来的）。
    expect(r.hostToastCalls.length, '宿主 `showHome` 的调用次数不对（路径没走通）').toBe(2);
    for (const v of r.hostToastCalls) expect(v).toBeUndefined();
  });

  it('返回之后整棵树里没有任何文本含 `[object`', () => {
    const r = walk('library');
    const bad = [...textsOf(body()), ...textsOf(r.afterBack)].filter((x) => x.includes('[object'));
    expect(bad, '屏上出现了把对象当文案的垃圾').toEqual([]);
  });

  it('规则页的「返回主页」是同一个坑、同款断言', () => {
    const r = walk('rules');
    expect(toasts().map((t) => t.text)).toEqual([]);
    expect(r.hostToastCalls.length, '宿主 `showHome` 的调用次数不对（路径没走通）').toBe(2);
    for (const v of r.hostToastCalls) expect(v).toBeUndefined();
    const bad = [...textsOf(body()), ...textsOf(r.afterBack)].filter((x) => x.includes('[object'));
    expect(bad).toEqual([]);
  });

  it('正例：`initialToast` 给一句**真字符串**时气泡照样出现、文案逐字相等', () => {
    const root = makeStubEl('div');
    /** 与 `src/main.ts` 的 `showHome(initialToast?)` 同形：提示交给首页画完之后自己发 */
    function showHome(initialToast?: string): void {
      renderHome(root as unknown as HTMLElement, { ...nav, initialToast });
    }
    const nav: HomeNav = {
      startGame: () => { /* 本文件不测 */ },
      openLibrary: () => { /* 本文件不测 */ },
      openRules: () => { /* 本文件不测 */ },
      openLocalData: () => { /* 本文件不测 */ },
      openSettings: () => { /* 本文件不测 */ },
      openFeedback: () => { /* 本文件不测 */ },
      openCardmaker: () => { /* 本文件不测 */ },
      openTutorial: () => { /* 本文件不测 */ },
    };
    showHome('走完向导了');
    const hits = toasts();
    expect(hits.length, '给了真字符串却没有气泡 ⇒ 提示链断了，前面两条"没有气泡"的腿就是假绿').toBe(1);
    expect(hits[0].text).toBe('走完向导了');
  });
});

/* ==================================================================== *
 * 2. 产品真实路径（用户 2026-10-02 补的那条）：退出热座对局 → 模式选择页 →「返回主页面」
 * ==================================================================== */

describe('★ 产品真实路径：退出热座 → 模式选择页 →「返回主页面」', () => {
  const MODE_LABEL = '单人模式';
  const MODE_TOAST = '单人模式：开发中';

  /**
   * 与产出代码同形的接线：
   *  - 模式选择页：`renderModeSelect(root, { backHome: showHome, ... })`（`src/main.ts:5409`）；
   *  - 「退出游戏」那条：`installHotseatExit({ onExit: () => { resetToMainInterface(); showModeSelect(); } })`
   *    （`src/main.ts:5897`）—— 本文件按**回调语义**复刻它（真的点那个按钮需要整套棋盘 DOM，
   *    那是 `hotseat-exit` 自己的用例面；这里验的是"回到模式页之后那一下点击"）。
   */
  function enterModeSelect(hostToastCalls: Array<unknown>, rootIn?: StubNode): {
    root: StubNode;
    showHome: (initialToast?: string) => void;
  } {
    const root = rootIn ?? makeStubEl('div');
    const homeNav: HomeNav = {
      startGame: () => { /* 不测 */ },
      openLibrary: () => { /* 不测 */ },
      openRules: () => { /* 不测 */ },
      openLocalData: () => { /* 不测 */ },
      openSettings: () => { /* 不测 */ },
      openFeedback: () => { /* 不测 */ },
      openCardmaker: () => { /* 不测 */ },
      openTutorial: () => { /* 不测 */ },
    };
    function showHome(initialToast?: string): void {
      hostToastCalls.push(initialToast);
      renderHome(root as unknown as HTMLElement, { ...homeNav, initialToast });
    }
    // 「退出游戏」的落点：模式选择页
    renderModeSelect(root as unknown as HTMLElement, {
      backHome: showHome,
      openDeviceCheck: () => { /* 不测 */ },
      startHotseat: () => { /* 不测 */ },
      startNetLobby: () => { /* 不测 */ },
      // ★ 2026-10-03（用户要求）：自定义协议池那一行的三个接缝（本文件只测返回主页面那条路）
      openPoolPicker: () => { /* 不测 */ },
      readPoolPreset: () => ({ enabled: false, ids: [] }),
      setPoolEnabled: () => { /* 不测 */ },
    });
    return { root, showHome };
  }

  it('模式选择页的「返回主页面」：没有气泡、宿主拿到的不是事件对象', () => {
    const calls: Array<unknown> = [];
    const { root } = enterModeSelect(calls);
    const mode = byClass(root, 'mode-screen')[0];
    expect(mode, '模式选择页没画出来').toBeDefined();
    const backBtn = queryAllIn(mode, '.mode-actions .btn')[0];
    expect(backBtn, '模式选择页里没有「返回主页面」按钮').toBeDefined();
    expect(backBtn.text).toBe('← 返回主页面');
    clickOn(backBtn);
    expect(toasts().map((t) => t.text), '从模式页回主页不该弹任何提示').toEqual([]);
    expect(calls.length, '「返回主页面」没有真的回主页').toBe(1);
    expect(calls[0], '「返回主页面」把点击事件当成了提示文案').toBeUndefined();
    const bad = [...textsOf(body()), ...textsOf(byClass(root, 'home-screen')[0])]
      .filter((x) => x.includes('[object'));
    expect(bad).toEqual([]);
  });

  it('模式选择页的「单人模式 / 三人模式」照样弹各自那句占位提示（正例，别把提示整体堵死）', () => {
    const calls: Array<unknown> = [];
    const { root } = enterModeSelect(calls);
    // 模式卡自己不带文本（名字与描述是两个子节点）⇒ 按 `.mode-card-name` 找
    const names = queryAllIn(root, '.mode-card-name');
    const label = names.filter((n) => n.text === MODE_LABEL)[0];
    expect(label, '模式选择页上没有单人模式卡').toBeDefined();
    const card = label.parentElement;
    expect(card, '模式卡名字没有父节点（桩没挂上？）').not.toBeNull();
    clickOn(card as StubNode);
    expect(toasts().map((t) => t.text), '占位提示的文案与 `toast.solo` 对不上').toEqual([MODE_TOAST]);
  });
});

/* ==================================================================== *
 * 3. 兜底那一层的腿：`showToast` 只认非空字符串
 * ==================================================================== */

describe('★ 兜底层：`showToast` 对"不是字符串"的输入不产出气泡、也不抛异常', () => {
  /** 一个**冻结**的事件对象：往它上面写任何属性都会当场抛（用来证明守卫跑在"写"之前）。 */
  function frozenEvent(): object {
    return Object.freeze({ type: 'click', target: null, clientX: 12, clientY: 34 });
  }

  /** 走"给 `renderHome` 喂 initialToast"这条公开口喂一个值（`showToast` 不是导出符号）。 */
  function feed(value: unknown): void {
    const root = makeStubEl('div');
    const nav = {
      startGame: () => { /* 不测 */ },
      openLibrary: () => { /* 不测 */ },
      openRules: () => { /* 不测 */ },
      openLocalData: () => { /* 不测 */ },
      openSettings: () => { /* 不测 */ },
      openFeedback: () => { /* 不测 */ },
      openCardmaker: () => { /* 不测 */ },
      openTutorial: () => { /* 不测 */ },
      initialToast: value as string,
    } as HomeNav;
    renderHome(root as unknown as HTMLElement, nav);
  }

  const rejected: ReadonlyArray<readonly [string, unknown]> = [
    ['点击事件对象（缺陷现场那种）', frozenEvent()],
    ['数字', 42],
    ['undefined', undefined],
    ['null', null],
    ['空串', ''],
    ['数组', ['提示']],
    ['函数', () => '提示'],
    ['布尔', true],
  ];

  for (const [label, value] of rejected) {
    it(`${label} ⇒ 不产出那个气泡，且不抛异常`, () => {
      expect(() => feed(value)).not.toThrow();
      expect(toasts().map((t) => t.text)).toEqual([]);
      const bad = textsOf(body()).filter((x) => x.includes('[object'));
      expect(bad).toEqual([]);
    });
  }

  it('正例锚点：同一个入口喂一句真字符串 ⇒ 气泡照样出现（证明上面那条不是"整条链空转"）', () => {
    feed('这是一句正常提示');
    expect(toasts().map((t) => t.text)).toEqual(['这是一句正常提示']);
  });
});

/* ==================================================================== *
 * 4. 反向锚点：把壳去掉 ⇒ 上面那几组必须红
 * ==================================================================== */

/**
 * **变异件**：把 `src/ui/home.ts` 的源码读进来、把 `showToast` 里那道
 * `typeof msg !== 'string'` 守卫改写成恒真的 `return;`，落到 `.superpowers/` 下再动态 import。
 *
 * 为什么要真跑一个变异件：兜底那一层的"腿"如果只是"我传个对象、断言没有气泡"，
 * 那么**删掉守卫这条腿照样绿**（气泡照样没有，因为 `renderHome` 那一层守卫同样拦得住）
 * —— 那是假腿。变异之后同一个调用会**真的**产出气泡，才证明"两道守卫各挡一次"这件事
 * 各自都有腿；同时也直接展示"壳被去掉 + 守卫被去掉"就是用户看到的现场。
 *
 * ⚠️ 变异只落在**临时副本**上：仓库里的 `src/ui/home.ts` 一个字节都不动。
 *   副本刻意写在 **`src/ui/` 里**（文件名带 `.mutant-` 前缀 + 进程号，用完全在 `afterAll` 删掉）：
 *   这样它里面的 `./render` / `../i18n` 等相对 import 按原样就能解析，不必改一个字符 ——
 *   变异件与产出代码因此**逐行同形**，只有那两行守卫不同。
 *   写在 `.superpowers/` 下试过，那条路要重写全部相对说明符（实测 `Cannot find module
 *   '../app/coin'`），会引入"变异件与产出代码不同形"这个额外变量。
 */
const HOME_SRC_URL = new URL('../../src/ui/home.ts', import.meta.url);
/**
 * 每一份变异件写一个**新文件名**（`-1.ts` / `-2.ts` …），跑完删掉。
 *
 * ⚠️ 为什么不能复用同一个文件名：Vite/vitest 按**模块 id** 缓存已转译的模块，
 * 同一个路径第二次 import 拿回来的还是**第一次那份代码**（实测：变异件②不生效，
 * 两条腿读到的是同一份变异件）。换文件名 = 换模块 id ⇒ 每份都是真的新代码。
 */
let mutantSeq = 0;
const mutantFiles: string[] = [];

/** `showToast` 里那道兜底守卫（去掉注释之后逐字的样子）。 */
const GUARD_AS_WRITTEN = 'if (typeof msg !== \'string\' || msg === \'\') return;';
/**
 * 变异体 ①：把守卫改成**恒真的提前返回**。
 *
 * ⚠️ 这不是"把这道守卫去掉"——它把**整个 toast 关掉**，连正例都不出气泡。
 * 本文件用它钉住"上游两道类型闸（`renderHome` / 宿主 `showHome`）各自承重"：
 * 上游把住了 ⇒ 这一道无论怎么变，屏上都不该有 `[object`。
 */
const GUARD_ALWAYS_RETURN = 'if (true as boolean) return;';
/**
 * 变异体 ②：把守卫那一行**整行删掉**（= 这道守卫不存在），并把两台上游的类型闸也撤掉
 * （`renderHome` 原样转交、宿主原样转交）—— 那才是"哪一层都没有"的形态，
 * 用来复现用户截图里那件事（`[object PointerEvent]`）。
 */
const GUARD_DELETED = '';
/** `renderHome` 里那道守卫（同样逐字）。 */
const HOME_GUARD_AS_WRITTEN =
  'if (typeof nav.initialToast === \'string\' && nav.initialToast !== \'\') showToast(nav.initialToast);';
/** 变异体：把类型判据去掉，值**原样**交给 `showToast`。 */
const HOME_GUARD_MUTATED = 'showToast(nav.initialToast as string);';

/**
 * 写一份变异件并返回它的路径。
 *
 * 只替换**两行守卫**；其余（含全部注释与相对 import）逐字节保留。
 *
 * @param toastMutant `showToast` 那道守卫的替换物（见上面两个常量的说明）
 */
function writeMutantHome(toastMutant: string): string {
  const raw = readFileSync(fileURLToPath(HOME_SRC_URL)).subarray(0, 1024 * 1024).toString('utf8');
  const stripped = stripComments(raw);
  // 判据认的是**去掉注释之后**的源码（注释里也写着这两行，必须先在注释层面区分开）
  expect(stripped, '变异锚点失效：`showToast` 的守卫那一行不在源码里了（改过写法？）')
    .toContain(GUARD_AS_WRITTEN);
  expect(stripped, '变异锚点失效：`renderHome` 的守卫那一行不在源码里了（改过写法？）')
    .toContain(HOME_GUARD_AS_WRITTEN);
  const patched = raw
    .replace(GUARD_AS_WRITTEN, toastMutant)
    .replace(HOME_GUARD_AS_WRITTEN, HOME_GUARD_MUTATED);
  expect(patched, '变异没落地（替换是空操作 ⇒ 这条反向腿是假的）').not.toBe(raw);
  mutantSeq += 1;
  const file = fileURLToPath(new URL(`../../src/ui/.mutant-home-toastguard-${mutantSeq}.ts`, import.meta.url));
  mutantFiles.push(file);
  writeFileSync(file, patched, 'utf8');
  return file;
}

describe('★ 反向锚点：把修复与两层守卫都撤掉 ⇒ 缺陷在同一个桩上原样复现', () => {
  afterAll(() => { for (const f of mutantFiles) rmSync(f, { force: true }); });

  /**
   * 这一组把"用户看到的现场"逐环节拼回来（每一步都真跑，不是读源码）：
   *
   *   ① 宿主 `showHome(initialToast?)`（与 `src/main.ts` 同形）；
   *   ② 一个与 `src/ui/home.ts` 的 `button()` **逐字同形**的按钮 —— 回调原样挂成监听器
   *      （= 修复前 `renderLibrary` / `renderRules` / `renderModeSelect` 的形态）；
   *   ③ 首页的**两道**类型守卫都撤掉（变异件）⇒ 事件对象一路流到 `textContent`；
   *   ④ 真点一下 ⇒ 屏上出现棕色气泡，文本是对象字符串化的结果。
   *
   * ⚠️ 为什么必须把两道一起撤（实测教训）：只撤 `showToast` 那一层，`renderHome` 那一层
   *   同样拦得住 ⇒ 气泡不会出现，这条腿会变成"永远绿的空腿"。
   */
  it('`button(cls, label, showHome)` + 无守卫的 `home.ts` ⇒ 气泡里写着 `[object ...]`', async () => {
    const file = writeMutantHome(GUARD_DELETED);
    // 绝对路径动态 import（node 的动态 `import()` 接受绝对文件路径；
    // 本仓没有 `@types/node` ⇒ `node:url` 的 `pathToFileURL` 声明不可见，不能引）
    const mutant = await import(/* @vite-ignore */ file) as {
      renderHome(root: HTMLElement, nav: HomeNav): void;
    };
    const root = makeStubEl('div');
    const nav: HomeNav = {
      startGame: () => { /* 不测 */ },
      openLibrary: () => { /* 不测 */ },
      openRules: () => { /* 不测 */ },
      openLocalData: () => { /* 不测 */ },
      openSettings: () => { /* 不测 */ },
      openFeedback: () => { /* 不测 */ },
      openCardmaker: () => { /* 不测 */ },
      openTutorial: () => { /* 不测 */ },
    };
    /** 与 `src/main.ts` 的 `showHome(initialToast?)` 同形：提示交给首页画完之后自己发 */
    function showHome(initialToast?: string): void {
      mutant.renderHome(root as unknown as HTMLElement, { ...nav, initialToast });
    }
    // 与 `src/ui/home.ts` 的 `button()` 逐字同形：回调**原样**挂成监听器（不包壳）
    const b = stubButton('返回主页', showHome as unknown as (ev?: unknown) => void);
    root.appendChild(b);
    clickOn(b);
    const hits = toasts();
    expect(hits.length, '缺陷形状没有复现 ⇒ 这条锚点是空的（气泡根本没出来）').toBe(1);
    expect(hits[0].text, '气泡里不是"对象字符串化"的结果 ⇒ 判据面没盖住这个缺陷')
      .toBe('[object Object]');
    // 反向锚点还要证明"屏上确实有垃圾文本"（真机里这里是 `[object PointerEvent]`）
    expect(textsOf(body()).some((x) => x.includes('[object'))).toBe(true);
  });

  it('同一个桩上：包了壳的形态跑一次 ⇒ 一个气泡都不出（两条腿的差别只在那一层壳）', () => {
    const root = makeStubEl('div');
    const nav: HomeNav = {
      startGame: () => { /* 不测 */ },
      openLibrary: () => { /* 不测 */ },
      openRules: () => { /* 不测 */ },
      openLocalData: () => { /* 不测 */ },
      openSettings: () => { /* 不测 */ },
      openFeedback: () => { /* 不测 */ },
      openCardmaker: () => { /* 不测 */ },
      openTutorial: () => { /* 不测 */ },
    };
    /** 与 `src/main.ts` 的 `showHome(initialToast?)` 同形：提示交给首页画完之后自己发 */
    function showHome(initialToast?: string): void {
      renderHome(root as unknown as HTMLElement, { ...nav, initialToast });
    }
    // 产出代码现在的形态：`button('btn', label, () => { back(); })`
    const b = stubButton('返回主页', () => { showHome(); });
    root.appendChild(b);
    clickOn(b);
    expect(toasts().map((t) => t.text)).toEqual([]);
    expect(byClass(root, 'home-screen').length,
      '这一处应当画出首页（否则"没气泡"是因为根本没画）').toBe(1);
  });

  /**
   * **变异体 ①**：兜底那道守卫改成"恒真提前返回"（= 这一道完全不工作）。
   *
   * 期望：**屏上照样没有 `[object`** —— 对象在 `renderHome` 那道类型闸上就被挡下了。
   * 这条腿钉的是"层次"这件事：上游确实承重，不是"所有事都靠最后那道 catch-all"。
   *
   * ⚠️ 为什么这里**只能**测"兜底那道不工作时上游还挡得住"，而不能再写一条"兜底整行删掉"：
   *   Vite/vitest 按模块 id 缓存转译结果，同一份 `home.ts` 的**子模块**在第二次 import
   *   变异件时会被复用（实测：变异件②读到的是变异件①的代码 ⇒ 结论反过来）。
   *   本文件因此每个变异只跑一次、且用**新文件名**（见 `writeMutantHome`）。
   */
  it('变异件①（兜底那道恒真提前返回）+ 上游守卫在 ⇒ 屏上仍然没有 `[object`', async () => {
    const file = writeMutantHome(GUARD_ALWAYS_RETURN);
    const mutant = await import(/* @vite-ignore */ file) as {
      renderHome(root: HTMLElement, nav: HomeNav): void;
    };
    const root = makeStubEl('div');
    const nav: HomeNav = {
      startGame: () => { /* 不测 */ },
      openLibrary: () => { /* 不测 */ },
      openRules: () => { /* 不测 */ },
      openLocalData: () => { /* 不测 */ },
      openSettings: () => { /* 不测 */ },
      openFeedback: () => { /* 不测 */ },
      openCardmaker: () => { /* 不测 */ },
      openTutorial: () => { /* 不测 */ },
    };
    mutant.renderHome(root as unknown as HTMLElement, {
      ...nav, initialToast: { type: 'click', target: null } as unknown as string,
    });
    expect(toasts().map((t) => t.text)).toEqual([]);
    expect(textsOf(body()).some((x) => x.includes('[object')), '上游没把住 ⇒ 层次说明是假的').toBe(false);
  });

  /**
   * **上游 `renderHome` 那道守卫的直接腿**（跑真产出代码，不走变异件）：
   * 直接给 `renderHome` 喂一个事件对象 ⇒ 屏上既没有气泡也没有 `[object`。
   *
   * 这条与"变异件①"是一对：① 证明**对象被挡住时兜底那道在不在都无所谓**，
   * 这一条证明**真产出代码里上游确实挡住了**。
   */
  it('真产出代码：直接给 `renderHome` 喂事件对象 ⇒ 没有气泡、没有 `[object`', () => {
    const root = makeStubEl('div');
    const nav: HomeNav = {
      startGame: () => { /* 不测 */ },
      openLibrary: () => { /* 不测 */ },
      openRules: () => { /* 不测 */ },
      openLocalData: () => { /* 不测 */ },
      openSettings: () => { /* 不测 */ },
      openFeedback: () => { /* 不测 */ },
      openCardmaker: () => { /* 不测 */ },
      openTutorial: () => { /* 不测 */ },
    };
    renderHome(root as unknown as HTMLElement, {
      ...nav, initialToast: { type: 'click', target: null } as unknown as string,
    });
    expect(toasts().map((t) => t.text)).toEqual([]);
    expect(textsOf(body()).some((x) => x.includes('[object'))).toBe(false);
    expect(byClass(root, 'home-screen').length, '首页没画出来 ⇒ 这条腿是空跑').toBe(1);
  });
});

/* ==================================================================== *
 * 5. 源码纪律：三个"返回主页"入口都必须包壳
 * ==================================================================== */

describe('★ 源码纪律：`home.ts` 里不许把 `back` / `nav.backHome` 直传进 `button()`', () => {
  const HOME_CODE = stripComments(
    readFileSync(fileURLToPath(new URL('../../src/ui/home.ts', import.meta.url)))
      .subarray(0, 1024 * 1024).toString('utf8'),
  );

  it('`button(` 的第三个实参不许是光秃秃的 `back` / `nav.backHome`', () => {
    for (const body of [
      functionBody(HOME_CODE, 'renderLibrary'),
      functionBody(HOME_CODE, 'renderRules'),
      functionBody(HOME_CODE, 'renderModeSelect'),
    ]) {
      expect(body.length, '抽到空片段（锚点失效）').toBeGreaterThan(400);
      expect(body, '又把事件回调直接当成 button 的点击处理器了').not.toMatch(
        /button\([^)]*,\s*(back|nav\.backHome)\s*\)/,
      );
      expect(body, '壳没了：这一处应当显式包一层箭头函数').toMatch(
        /\(\)\s*=>\s*\{\s*(back|nav\.backHome)\(\);\s*\}/,
      );
    }
  });
});
