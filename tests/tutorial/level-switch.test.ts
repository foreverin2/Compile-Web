import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { TUT_LEVELS, levelIndex } from '../../src/tutorial/levels';
import { buildLevelState } from '../../src/tutorial/setup';
import { createLocalStore, readTutorialProgress, writeTutorialProgress } from '../../src/app/local-store';
import { createMemoryStore } from '../../src/app/storage';
import { mountTutorial } from '../../src/ui/tutorial-screen';
import { renderBoard, resetUiState } from '../../src/ui/render';
import { setBoardState } from '../../src/ui/board-scope';
import { createLocalDriver } from '../../src/app/match-driver';
import { ZH } from '../../src/i18n';
import {
  installStubDom, makeStubEl, descendants, classOf, isClass, queryAllIn, type StubNode,
} from '../ui/net-dom-stub';
import { stripComments } from '../ui/source-text';

/**
 * ★ 2026-10-06（**用户当天报的两个缺陷**，都在"换关/跳关"这条路上）：
 *
 *  1. **D**：「当我已经解锁了下一关并自动跳到下一关之后，我点击下方的数字回到上一关，
 *     下一关的跳转按钮会变灰并且无法跳回去，从第一关重来的按钮也会这样，请修复」；
 *  2. **E**：「第10关到第11关后，精神协议的已编译特效不会消失，会粘到第11关，请修复」
 *     （第 10 关 = T8，我方协议精神/流水/黑暗 ⇒ 会编译精神；第 11 关 = T9，我方黑暗/动量/流水，
 *     **没有精神**）。
 *
 * ## 这一组能给什么证据
 *
 *  - **纯函数腿**（D）：解锁口径的真跑读数（"复现旧口径 ⇒ 灰；新口径 ⇒ 可点"）在
 *    `screen.test.ts` 那一组里；这里补的是**端到端**那半截。
 *  - **真跑（桩 DOM）**：`mountTutorial` 真的挂起来（补两个最小的 Observer 桩），点面板上那排数字、
 *    点棋盘的「编译线」按钮，走的是用户真走的那条路（`cb.onAction` → `driver.submit` →
 *    `judgeAndAdvance` → `advance` → `restartLevel()`/`gotoNextLevel()` → `openLevel()`）。
 *  - **给不了**：真浏览器时钟（倒计时到点换关那一路要假定时器 + 一整套动画时钟）与"看起来对不对"
 *    （人眼项）。倒计时那一半仍是源码腿（`screen.test.ts`）。
 */

const REPO = fileURLToPath(new URL('../../', import.meta.url));
const read = (rel: string): string => readFileSync(`${REPO}${rel}`).subarray(0, 4 * 1024 * 1024).toString('utf8');
/** 剥过注释的源码（源码腿用；`paint()` 这类字符串在注释里也出现过） */
const SCREEN = stripComments(read('src/ui/tutorial-screen.ts'));

const CB = {
  onAction: () => { /* noop */ },
  onRendered: () => { /* noop */ },
  rerender: () => { /* noop */ },
  onDraftPick: () => { /* noop */ },
  onDraftUnpick: () => { /* noop */ },
  onDraftBan: () => { /* noop */ },
  onWinReset: () => { /* noop */ },
};
const cb = CB as never;

let restore: (() => void) | null = null;
let stubbed = false;
const savedGlobals: Record<string, unknown> = {};

/** 桩 DOM + 两个最小的观察者桩（屏一上来就 `new MutationObserver` / `new ResizeObserver`） */
function installStubs(): void {
  restore = installStubDom();
  stubbed = true;
  const g = globalThis as unknown as Record<string, unknown>;
  for (const name of ['MutationObserver', 'ResizeObserver']) savedGlobals[name] = g[name];
  class NoopObserver {
    observe(): void { /* 本文件不测观察者回调 */ }
    disconnect(): void { /* noop */ }
  }
  g.MutationObserver = NoopObserver;
  g.ResizeObserver = NoopObserver;
}

/**
 * 装桩 + 造一个"棋盘根"（`mountTutorial` 的第一个实参；`renderApp` 画在它里面）。
 *
 * ⚠️ 返回的是**根节点本身**，不是"用选择器再找一遍"：`renderApp` 会把 `root.className`
 * 改成棋盘那一族（`screen-*`）⇒ 挂载之后再按 `cls === ''` 找是找不到的。
 */
function mountBoardRoot(): { body: StubNode; root: HTMLElement } {
  installStubs();
  const body = document.body as unknown as StubNode;
  const node = makeStubEl('div');
  body.appendChild(node);
  return { body, root: node as unknown as HTMLElement };
}

afterEach(() => {
  const g = globalThis as unknown as Record<string, unknown>;
  /**
   * ⚠️ 只有真装过桩的那些用例才去动 render 的模块态：`resetUiState()` 自己会扫 `document`，
   * 桩不在时调它就是 `document is not defined`（源码腿那几条不装桩）。
   * ⚠️ 顺序：`resetUiState()` 要在桩**还在**的时候调，之后再拆桩。
   */
  if (stubbed) {
    resetUiState();
    setBoardState(null);
  }
  for (const [k, v] of Object.entries(savedGlobals)) {
    if (v === undefined) delete g[k]; else g[k] = v;
  }
  for (const k of Object.keys(savedGlobals)) delete savedGlobals[k];
  if (restore !== null) { restore(); restore = null; }
  stubbed = false;
});

const chipsOf = (body: StubNode): StubNode[] => descendants(body).filter((n) => isClass(n, 'tutorial-chip'));
const chipFor = (body: StubNode, id: string): StubNode => {
  const hit = chipsOf(body).filter((n) => n.dataset.level === id);
  expect(hit.length, `面板上没有 ${id} 那枚 chip`).toBe(1);
  return hit[0];
};
const isDisabled = (n: StubNode): boolean => (n as unknown as { disabled?: boolean }).disabled === true;

/** 点一下桩节点（桩的 `dispatchEvent` 从**派发节点**沿 parentElement 往上走，不含自己） */
function clickNode(node: StubNode): void {
  const clicker = makeStubEl('span');
  node.appendChild(clicker);
  (clicker as unknown as { dispatchEvent(ev: unknown): void }).dispatchEvent({ type: 'click', target: clicker });
}

/** body 上那些**已编译环持久层**（`compiled-fx`）；协议格自己也有这个类 ⇒ 只数 body 的直接子节点 */
const compiledLayers = (body: StubNode, defId?: string): StubNode[] =>
  descendants(body).filter((n) => n.parentElement === body && isClass(n, 'compiled-fx')
    && (defId === undefined || isClass(n, `compiled-fx-${defId}`)));

/** 进度：过到 `upTo`、当前在它后面那一关 */
function progressUpTo(upTo: string): { done: string[]; current: string } {
  const ids: string[] = TUT_LEVELS.map((l) => l.id);
  const i = ids.indexOf(upTo);
  expect(i, `关卡表里没有 ${upTo}`).toBeGreaterThanOrEqual(0);
  return { done: ids.slice(0, i + 1), current: ids[i + 1] };
}

/* ============================================================================
 * D：跳回去之后仍能跳回下一关，也仍能「从第一关重来」
 * ========================================================================== */

describe('★ D（2026-10-06 用户报的"下一关的跳转按钮会变灰"）：跳回去之后仍能跳回来', () => {
  it('★ 真跑（桩 DOM）：过到 T8 → 点数字回 T7 → T8 那枚仍可点、点它就回得去；「从第一关重来」也没被锁', () => {
    const { body, root } = mountBoardRoot();
    const store = createLocalStore({ persistent: createMemoryStore() });
    // 用户那一刻的进度：过到 T7、当前在 T8（= 自动跳到的那一关）
    const p = progressUpTo('T7');
    writeTutorialProgress(store, p);
    const handle = mountTutorial(root, store, {
      exit: () => { /* 本腿不退出 */ },
      saveProgress: (next) => { writeTutorialProgress(store, next); },
    });
    try {
      // 开局在 T8
      expect(isClass(chipFor(body, 'T8'), 'now'), '开局不在 T8').toBe(true);
      expect(isDisabled(chipFor(body, 'T8')), 'T8 那枚开局就是禁用的').toBe(false);

      // ① 点数字回到上一关（T7）
      clickNode(chipFor(body, 'T7'));
      expect(isClass(chipFor(body, 'T7'), 'now'), '点了 T7 那枚没有回到 T7').toBe(true);
      expect(store !== null, '锚点：存储还在').toBe(true);

      // ② 用户报的那一幕：下一关（T8）变灰、点不回去 —— 复现口径写在 screen.test.ts 的纯函数腿里，
      //    这里断言**修好之后**的形态：T8 那枚没有 disabled、也没有压暗类
      const t8 = chipFor(body, 'T8');
      expect(isDisabled(t8), '跳回上一关之后，下一关（T8）那枚被禁用了 —— 用户报的缺陷').toBe(false);
      expect(isClass(t8, 'tutorial-chip-locked'), 'T8 那枚被压暗了（= 用户看到的"变灰"）').toBe(false);

      // ③ 点它 —— 真的跳得回去
      clickNode(t8);
      expect(isClass(chipFor(body, 'T8'), 'now'), '点了 T8 那枚没跳回 T8').toBe(true);

      // ④ 用户第二半句：「从第一关重来」那颗按钮也"会这样" —— 它从来没被禁用过（下面这条就是那条读数），
      //    点它之后进度清空、回到第一关，而且第一枚 chip 是可点的
      const restartAll = queryAllIn(body, 'button').filter((n) => isClass(n, 'tutorial-restart'));
      expect(restartAll.length, '面板上没有「从第一关重来」那颗按钮').toBe(1);
      expect(isDisabled(restartAll[0]), '「从第一关重来」那颗按钮被禁用了').toBe(false);
      clickNode(restartAll[0]);
      const first = TUT_LEVELS[0].id;
      const prog = readTutorialProgress(store);
      expect(prog.done, '「从第一关重来」没有清空 done').toEqual([]);
      expect(prog.current, '「从第一关重来」没有回到第一关').toBe(first);
      expect(isClass(chipFor(body, first), 'now'), '重来之后第一关那枚不是当前关').toBe(true);
      expect(isDisabled(chipFor(body, first)), '重来之后第一关那枚是禁用的（"从第一关重来"也点不动了）').toBe(false);
      // 反向：重来之后后面那些关仍然锁着（不许放宽成"全都能点"）
      for (const l of TUT_LEVELS.slice(1)) {
        expect(isDisabled(chipFor(body, l.id)), `${l.id} 还没到却是可点的（跳课）`).toBe(true);
      }
    } finally {
      handle.close();
      resetUiState();
      setBoardState(null);
    }
  });

  it('源码腿：解锁口径读的是"最后过掉那关的下一关"与"当前这一关"里较远的那个（跳回去不会缩水解锁面）', () => {
    expect(SCREEN, '解锁口径里没有"最后过掉那关的下一关"').toMatch(/all\.indexOf\(id\)\s*\+\s*1/);
    expect(SCREEN, '解锁口径没和"当前这一关"取较远者').toMatch(/Math\.max\(/);
    // 反向：旧的 `done ∪ {当前这一关}` 那一条不许再回来（它就是这次缺陷的根因）
    expect(SCREEN, '旧的窄口径（done.includes(clicked) || clicked === current）又回来了')
      .not.toMatch(/unlocked\s*=\s*done\.includes\(clicked\)\s*\|\|\s*clicked\s*===\s*current/);
  });
});

/* ============================================================================
 * E：T8 编译精神 → T9 之后那张"已编译特效"不许粘在屏上
 * ========================================================================== */

describe('★ E（2026-10-06 用户报的"精神已编译特效粘到第 11 关"）：T8 → T9 换关把 FX 清干净', () => {
  /** T8 真编译一次（走引擎：`compile` 是这一关唯一的合法动作） */
  function compileSpirit(): ReturnType<typeof buildLevelState> {
    const s = buildLevelState('T8');
    const driver = createLocalDriver();
    expect(driver.submit(s, { player: s.turnPlayer, kind: 'compile', args: { line: 0 } } as never).ok,
      '引擎拒了 T8 的编译').toBe(true);
    expect(s.players[0].protocols[0].compiled, '编译之后精神协议没变已编译').toBe(true);
    return s;
  }

  it('★ 复现读数（反向腿）：**不清 FX** 就换局面 ⇒ T8 的精神已编译环留在 T9 的屏上（用户看到的那一幕）', () => {
    const { body, root } = mountBoardRoot();
    renderBoard(root, compileSpirit(), cb);
    expect(compiledLayers(body, 'spirit').length, 'T8 编译完之后屏上没有精神已编译环（这条腿失去前提）').toBe(1);

    // ← 这里**刻意不调** resetUiState()：那就是改之前 openLevel() 的样子
    renderBoard(root, buildLevelState('T9'), cb);
    expect(compiledLayers(body, 'spirit').length,
      'T9 里没有精神协议格，本该没人删它 —— 复现失败：这条腿失去意义').toBe(1);
    // 为什么偏偏剩 spirit：`compiledFx` 以 defId 为键，只有"新关里还有那个 defId 的协议格"才会走 else 删掉
    const t9Protocols = buildLevelState('T9').players.flatMap((p) => p.protocols.map((pr) => pr.defId));
    expect(t9Protocols.includes('spirit'), 'T9 里居然有精神协议格 ⇒ 上面那条不是"没人删"的形态').toBe(false);
  });

  it('★ 修法真跑：换关前先 resetUiState()（openLevel() 的第一句）⇒ T9 屏上一条已编译环都不留', () => {
    const { body, root } = mountBoardRoot();
    renderBoard(root, compileSpirit(), cb);
    expect(compiledLayers(body, 'spirit').length, '锚点：T8 编译完有一条精神已编译环').toBe(1);

    resetUiState(); // ← openLevel() 的第一句
    renderBoard(root, buildLevelState('T9'), cb);

    expect(compiledLayers(body, 'spirit').length, '精神已编译环还留在 T9 的屏上（用户报的缺陷）').toBe(0);
    expect(compiledLayers(body).length, 'T9 屏上还有别的已编译环残留').toBe(0);
  });

  it('★ 端到端（真跑教学屏）：在 T8 点棋盘的「编译线 1」编译精神 ⇒ 跳到 T9 之后精神那一层归零', () => {
    const { body, root } = mountBoardRoot();
    const store = createLocalStore({ persistent: createMemoryStore() });
    // 用户的进度形态：过到 T7、当前在 T8
    writeTutorialProgress(store, progressUpTo('T7'));
    const handle = mountTutorial(root, store, {
      exit: () => { /* 本腿不退出 */ },
      saveProgress: (next) => { writeTutorialProgress(store, next); },
    });
    try {
      // ① 开局在 T8：棋盘上给出「编译线 1（10 vs 0）」那颗按钮（`render.ts` 按 getLegalActions 画）
      const label = ZH['render.action.compile-line'].replace('{n}', '1').replace('{a}', '10').replace('{b}', '0');
      const compileBtns = descendants(root as unknown as StubNode).filter((n) => n.tag === 'button' && n.text === label);
      expect(compileBtns.length, `棋盘上没有「${label}」那颗按钮（这一关的编译按钮没画出来）`).toBe(1);

      // ② 真点它：走的是教学屏的 `cb.onAction` → `driver.submit` → 引擎真的编译精神
      clickNode(compileBtns[0]);
      expect(compiledLayers(body, 'spirit').length, '编译之后屏上没有出现精神已编译环（这一课的前提没了）').toBe(1);
      expect(readTutorialProgress(store).done, '编译过关之后进度里没有 T8').toContain('T8');

      // ③ 跳到 T9（= 用户说的"第10关到第11关"）：点了编译之后 local 还在 T8，点 T9 那枚就等于换关
      const t9 = chipFor(body, 'T9');
      expect(isDisabled(t9), 'T9 那枚是禁用的 —— 跳不过去就没法验证这一条（D 的缺陷会遮住 E）').toBe(false);
      clickNode(t9);
      expect(isClass(chipFor(body, 'T9'), 'now'), '没有换到 T9').toBe(true);

      // ④ 用户报的那一幕：精神已编译特效粘在 T9 上
      expect(compiledLayers(body, 'spirit').length, 'T8 编译出来的精神已编译环粘到了 T9 上（用户报的缺陷）').toBe(0);
      expect(compiledLayers(body).length, 'T9 屏上还有别的已编译环残留').toBe(0);
      // 反向：换关不许把教学自己的屏件一起清掉
      expect(descendants(body).some((n) => isClass(n, 'tutorial-overlay')), '换关把教学浮层清掉了').toBe(true);
      expect(chipsOf(body).length, '换关把那排数字清掉了').toBe(TUT_LEVELS.length);
    } finally {
      handle.close();
    }
  });

  it('源码腿：四个换关入口都经 `openLevel()`，而它第一件事就是清 FX（排在重建局面 / paint 之前）', () => {
    const at = SCREEN.indexOf('function openLevel(');
    expect(at, '找不到 openLevel()').toBeGreaterThan(0);
    const bodyOf = (name: string): string => {
      const i = SCREEN.indexOf(`function ${name}(`);
      let j = SCREEN.indexOf('{', i);
      const start = j;
      let depth = 0;
      for (; j < SCREEN.length; j += 1) {
        if (SCREEN[j] === '{') depth += 1;
        else if (SCREEN[j] === '}') { depth -= 1; if (depth === 0) break; }
      }
      return SCREEN.slice(start, j + 1);
    };
    const open = bodyOf('openLevel');
    const iReset = open.indexOf('resetUiState()');
    const iBuild = open.indexOf('buildLevelState(levelId)');
    const iPaint = open.indexOf('paint()');
    expect(iReset, 'openLevel 里没有 resetUiState（换关不清 FX = 用户报的缺陷）').toBeGreaterThan(0);
    expect(iReset < iBuild, 'resetUiState 排在重建局面之后（顺序反了）').toBe(true);
    expect(iBuild < iPaint, 'paint() 排在重建局面之前').toBe(true);
    // 四个入口：退出教程（close）/ 重开这一关（openLevel 自身）/ chip 跳关（restartLevel）/ 到点换关（gotoNextLevel）
    expect(bodyOf('restartLevel'), 'chip 跳关没有走 openLevel').toContain('openLevel()');
    expect(bodyOf('gotoNextLevel'), '倒计时到点换关没有走 openLevel').toContain('openLevel()');
    expect(SCREEN.slice(SCREEN.indexOf("btn tutorial-restart'"), SCREEN.indexOf("btn tutorial-restart'") + 400),
      '「从第一关重来」没有走 openLevel').toContain('openLevel()');
    // 关卡确实换了 id（这条腿的锚点：T8 与 T9 是两关）
    expect(levelIndex('T9') > levelIndex('T8'), 'T9 不在 T8 之后').toBe(true);
  });
});
