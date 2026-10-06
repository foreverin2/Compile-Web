import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createGame } from '../../src/core/state/create';
import type { Card, GameState } from '../../src/core/models/types';
import { buildLevelState } from '../../src/tutorial/setup';
import { TUT_LEVELS } from '../../src/tutorial/levels';
import { createLocalStore, writeTutorialProgress } from '../../src/app/local-store';
import { createMemoryStore } from '../../src/app/storage';
import { mountTutorial } from '../../src/ui/tutorial-screen';
import {
  renderBoard, resetUiState,
  syncChainLayerPosition,
} from '../../src/ui/render';
/** ★ 2026-10-06 第二轮：常驻 FX 层滚动/缩放重定位的**唯一清单**（main.ts 的 rAF 与教学屏都调它） */
import { syncPersistentFx } from '../../src/ui/fx-persistent-sync';
import { clearGen3Persistent, syncGen3Persistent } from '../../src/ui/gen3-control';
import { boardStateOf, setBoardState } from '../../src/ui/board-scope';
import { syncFollowers } from '../../src/ui/fx-follow';
import {
  installStubDom, makeStubEl, setStubRectFor, descendants, classOf, isClass, type StubNode,
} from './net-dom-stub';
import { stripComments } from './source-text';

/**
 * ★ 2026-10-06（**用户当天报的两个缺陷**）：教学屏的常驻 FX 在"换关 / 滚动"之后的生命周期。
 *
 * 用户原话：
 *  1. 「教程里的死板7在（移动）过页面后的场上持续特效会消失，而特效并没有继续持续跟随卡牌而显示」
 *  2. 「第十四关（= T12）不知道怎么回事突然就显示出了精神协议的已编译特效……原因是我刚刚从
 *     第 15 关重新跳到了第十四关，而这个特效似乎没被清除才导致的」
 *
 * 两个缺陷的形态是同一族：**body 级常驻层是模块态、跨帧存活，而"换局面"的时候没人清**
 * （缺陷 2：换关只重建了引擎状态）／**"换局面"的另一份 state 被拿去同步了**
 * （缺陷 1：主循环的滚动 rAF 永远喂它自己那份 `state`，而教学屏画的是它自己那份受控局面）。
 *
 * ## 这一组腿能给什么证据（以及给不了什么）
 *
 *  - **真跑（桩 DOM）**：`renderBoard` 是 `renderApp` 真走的那条路（`render.ts:6429`），
 *    本文件用它把"这一屏的棋盘层"真的建出来；然后**逐字照抄 `main.ts:5906-5931` 那张清单**
 *    模拟主循环的滚动/缩放 rAF（那份 `state` 是**外来局面**）。
 *    能证明：层的去留、注册表键、以及内联几何（"跟着卡走"）是不是按预期变。
 *  - **给不了**：真实布局（矩形是测试喂的常量）、"看起来对不对"（人眼项）、以及
 *    `mountTutorial` 里那几样**需要真浏览器时钟**的东西（倒计时到点换关、滚动事件的派发 ——
 *    桩的 `window.addEventListener` 是 noop）。
 *    ⚠️ 但"换关"这一条**有一条端到端的真跑腿**：补两个最小的 `MutationObserver`/`ResizeObserver`
 *    桩之后，屏真的挂起来了，点面板上那枚 T12 的 chip 会真的走 `restartLevel()` → `openLevel()`
 *    （见下面那一组）。滚动/跟随那一半仍是机制腿（直接调 `syncGen3Persistent`）+ 源码腿。
 */

const REPO = fileURLToPath(new URL('../../', import.meta.url));
const read = (rel: string): string =>
  stripComments(readFileSync(`${REPO}${rel}`).subarray(0, 4 * 1024 * 1024).toString('utf8'));
const SCREEN = read('src/ui/tutorial-screen.ts');
const GEN3 = read('src/ui/gen3-control.ts');
const MAIN = read('src/main.ts');
const RENDER = read('src/ui/render.ts');

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

/** 某个函数的函数体（剥过注释；与 `tests/tutorial/screen.test.ts` 的 `bodyOf` 同款） */
function bodyOf(code: string, name: string): string {
  const at = code.indexOf(`function ${name}(`);
  expect(at, `找不到 function ${name}(`).toBeGreaterThan(0);
  let i = code.indexOf('{', at);
  const start = i;
  let depth = 0;
  for (; i < code.length; i += 1) {
    if (code[i] === '{') depth += 1;
    else if (code[i] === '}') { depth -= 1; if (depth === 0) break; }
  }
  return code.slice(start, i + 1);
}

/**
 * **滚动/缩放那一趟**：与 `main.ts` 的 rAF 回调**逐字同参**（`syncPersistentFx(boardStateOf(state))`）。
 *
 * ⚠️ 2026-10-06 第二轮：这一趟原来在本文件里**手工镜像** `main.ts:5906-5931` 那张 23 条清单
 * （镜像一旦漂了就是一条假腿）。现在清单搬去 `src/ui/fx-persistent-sync.ts`（**唯一一份**，
 * 教学屏的 `onViewportMove` 也调它）⇒ 本函数直接**调那个真出处**，不再手工抄。
 * 判据面因此比原来更强：这里跑的就是生产代码那一趟。
 *
 * ⚠️ `boardStateOf(state)` 也照抄 `main.ts`：声明过本屏局面就喂它（教学屏那一路），
 * 没声明就逐字退回入参（热座/远程页/重放）。
 */
function mainScrollSync(s: GameState): void {
  syncPersistentFx(boardStateOf(s));
}

let restore: (() => void) | null = null;
afterEach(() => {
  /**
   * 顺序要紧：`resetUiState()` 要**在桩 DOM 还在的时候**调（它自己会去扫 body 上的层），
   * 之后再 `restore()`。模块态（3代常驻层注册表 / 声明口）是本用例的输入，不许漏到别的用例。
   */
  if (restore !== null) {
    resetUiState();
    restore();
    restore = null;
  }
  clearGen3Persistent();
  setBoardState(null);
});

/** 装桩 DOM + 一个装棋盘的根；返回 body（层都挂在它下面） */
function mountBoardRoot(): StubNode {
  restore = installStubDom();
  const body = document.body as unknown as StubNode;
  const root = makeStubEl('div');
  body.appendChild(root);
  return body;
}

const boardRoot = (body: StubNode): HTMLElement =>
  body.children.find((n) => n.tag === 'div' && n.cls === '') as unknown as HTMLElement;

/**
 * 把**棋盘自己画出来的那张卡**（`[data-uid]`）配一个矩形 —— 桩不模拟布局，`getBoundingClientRect()`
 * 默认全 0，而常驻层的位置与"建不建子件"都按实测矩形判（`gen3-control.ts` 的 `rectOf`）。
 * ⚠️ 必须给**棋盘那棵树里的**节点配（不是另造一枚同 uid 的桩）：`cardNode(uid)` 查的就是
 * `[data-uid=...]`，另造一枚会让被测代码拿到 0×0 的那一枚，腿就假绿了（第一版就是这么写的）。
 */
function rectBoardCard(body: StubNode, uid: string, r: { left: number; top: number; width: number; height: number }): StubNode {
  const card = descendants(body).find((n) => n.dataset.uid === uid);
  expect(card, `棋盘上没有画出 data-uid="${uid}" 的那张卡（夹具与局面脱节了）`).toBeTruthy();
  setStubRectFor(card!, r);
  return card!;
}

/** body 级那些常驻层（直接子节点，排除棋盘根） */
const bodyLayers = (body: StubNode, re: RegExp): StubNode[] =>
  descendants(body).filter((n) => re.test(n.cls) && n.parentElement === body);

/**
 * body 上那些**已编译环持久层**（`compiled-fx`）。
 * ⚠️ 不能直接按 `compiled-fx-<defId>` 数：那个类**协议格自己也有**
 * （`render.ts:164` 的 `box.classList.add()`），数进去会把棋盘上那一格也算上。
 */
const compiledLayers = (body: StubNode, defId?: string): StubNode[] =>
  descendants(body).filter((n) => n.parentElement === body && isClass(n, 'compiled-fx')
    && (defId === undefined || isClass(n, `compiled-fx-${defId}`)));

const mazeOf = (body: StubNode): StubNode => {
  const maze = classOf(body, 'g3sync-rig7-maze');
  expect(maze.length, '屏上没有 .g3sync-rig7-maze（死板7 的常驻层没建出来？）').toBe(1);
  return maze[0];
};
const boxOf = (n: StubNode): [number, number, number, number] => {
  const s = n.style as Record<string, string>;
  return [Number.parseFloat(s.left), Number.parseFloat(s.top), Number.parseFloat(s.width), Number.parseFloat(s.height)];
};

/** 把 T12 那一关的棋盘画出来（含 `t12f-rigid` = 对手线 3 那张死板7），返回局面与那张卡的桩节点 */
function renderT12(): { body: StubNode; s: GameState; card: StubNode } {
  const body = mountBoardRoot();
  const s = buildLevelState('T12');
  renderBoard(boardRoot(body), s, cb);
  // 死板7 的层按**卡牌节点**的实测矩形定位 ⇒ 给棋盘画出来的那张卡配一个矩形
  const card = rectBoardCard(body, 't12f-rigid', { left: 100, top: 100, width: 200, height: 280 });
  syncGen3Persistent(s);
  return { body, s, card };
}

/* ============================================================================
 * 缺陷 1：教学屏的3代常驻层不能被"主循环那份外来局面"删掉
 * ========================================================================== */

describe('★ 缺陷 1（2026-10-06 用户报的「死板7 移动过页面后特效消失」）：外来局面不许碰这一屏的常驻层', () => {
  it('★ 复现读数（反向腿）：**不声明**棋盘局面 ⇒ 外来局面那一趟真的把层删掉（就是用户看到的那一幕）', () => {
    const { body, s } = renderT12();
    expect(bodyLayers(body, /g3sync-rig7/).length, 'T12 开局就该有一层死板7 护壁').toBe(1);

    // 不声明 ⇒ 是改动前的行为：主循环那一趟按**外来局面**重算，教学屏的键不在 active 里
    setBoardState(null);
    mainScrollSync(createGame({ seed: 'foreign-hotseat' }));

    const after = bodyLayers(body, /g3sync-rig7/);
    expect(after.length, '层被整个摘掉了').toBe(1);
    expect(isClass(after[0], 'g3sync-out'), '外来局面那一趟没有把教学屏的层判成"该删"（复现失败：这条腿失去意义）')
      .toBe(true);
    // 320ms 之后层就真的没了（`drop()` 的收尾定时器）—— 也就是用户看到的"特效消失了"
    expect(s.players[1].stacks[2].some((c) => c.defId === 'rigidity-7'),
      '局面本身没变（变的只是"谁来同步"）').toBe(true);
  });

  it('★ 修法：声明了棋盘局面 ⇒ 外来局面那一趟整趟早退（层既不被删、也不被改）', () => {
    const { body, s } = renderT12();
    setBoardState(s); // 教学屏在每次 openLevel() 里做的就是这个

    const before = boxOf(mazeOf(body));
    mainScrollSync(createGame({ seed: 'foreign-hotseat' }));

    const after = bodyLayers(body, /g3sync-rig7/);
    expect(after.length, '层没了').toBe(1);
    expect(isClass(after[0], 'g3sync-out'), '层被加上了淡出类（= 被判成该删）').toBe(false);
    expect(boxOf(mazeOf(body)), '外来局面那一趟改动了这一屏的层几何').toEqual(before);
  });

  it('★ 跟随（用户第二半句"特效并没有继续持续跟随卡牌"）：本屏按自己的局面重同步 ⇒ 层跟着卡走', () => {
    const { body, s, card } = renderT12();
    setBoardState(s);
    // 滚动 = 卡牌实测矩形整体平移（主循环那一趟先跑，它整趟早退；本屏随后按自己的局面重定位）
    const dx = 37;
    const dy = -220;
    setStubRectFor(card, { left: 100 + dx, top: 100 + dy, width: 200, height: 280 });
    mainScrollSync(createGame({ seed: 'foreign-hotseat' })); // ← 主循环的滚动 rAF（外来局面）
    syncGen3Persistent(s); // ← 教学屏的 onViewportMove（自己那份 state）

    expect(boxOf(mazeOf(body)), '死板7 的护壁没有跟着卡牌平移同一个量')
      .toEqual([100 + dx - 3, 100 + dy - 3, 206, 286]);
  });

  it('★ 反向：声明**不会**把 prune 变成空操作 —— 同一份局面上条件真的消失时，层照旧被删', () => {
    const { body, s } = renderT12();
    setBoardState(s);
    // 死板7 的常驻条件是"正面 + 未被覆盖 + 底框可用"（= 引擎 rigidity7Immune，守卫腿在
    // `tests/ui/gen3-control-fx.test.ts`）⇒ 在它上面再盖一张牌，条件就不成立了。
    s.players[1].stacks[2] = [
      ...s.players[1].stacks[2],
      { uid: 'cover', defId: 'water-0', owner: 1, line: 2, faceUp: true, zone: 'field', pos: 1 } as Card,
    ];
    syncGen3Persistent(s);
    const after = bodyLayers(body, /g3sync-rig7/);
    expect(after.length, '被盖住之后层还留着').toBe(1);
    expect(isClass(after[0], 'g3sync-out'), '被盖住之后层没有进入收尾（常驻条件判据失效了）').toBe(true);
  });

  it('★ 逐关真跑：声明了棋盘局面 ⇒ 15 关 × 外来局面那一趟，3代常驻层一个都不丢', () => {
    const foreign = createGame({ seed: 'foreign-hotseat' });
    const lines: string[] = [];
    let totalLayers = 0; // 反空集合：这一族在扫面里真的建出过层
    for (const l of TUT_LEVELS) {
      const body = mountBoardRoot();
      const s = buildLevelState(l.id);
      renderBoard(boardRoot(body), s, cb);
      setBoardState(s);
      const before = bodyLayers(body, /g3sync-|g3fx-layer/).map((n) => n.cls);
      totalLayers += before.length;
      mainScrollSync(foreign);
      const lost = before.filter((cls) => !bodyLayers(body, /g3sync-|g3fx-layer/).some((n) => n.cls === cls));
      lines.push(`${l.id}:${before.length}层${lost.length === 0 ? 'ok' : '丢' + lost.join('|')}`);
      expect(lost, `${l.id} 的3代常驻层被外来局面那一趟删掉了：${lost.join(', ')}`).toEqual([]);
      // 逐关换夹具：先撤声明（否则下一关 `renderBoard` 那一趟会被当成"外来局面"而整趟早退），
      // 清模块态 + 拆桩（`restore()` 必须在桩还在时先把 `resetUiState()` 走完）
      setBoardState(null);
      resetUiState();
      restore?.(); restore = null;
    }
    // 锚点：扫描面真的覆盖到有层的关卡（否则上面那条可以在"全都没有层"上恒真）
    expect(lines.filter((x) => x.endsWith('ok')).length).toBe(TUT_LEVELS.length);
    expect(totalLayers, '15 关一张 3 代常驻层都没建出来 ⇒ 上面那条是空集上的恒真').toBeGreaterThan(0);
  });

  it('★ 反向锚点：声明口**没被谁偷偷设成永远有主** —— 热座/远程页/重放那几档一律不声明', () => {
    // `setBoardState` / 它的旧名 `setGen3BoardState` 的调用点全仓只有教学屏（正反两处）+ 本文件
    const calls = [...RENDER.matchAll(/set(BoardState|Gen3BoardState)\(/g)].length
      + [...MAIN.matchAll(/set(BoardState|Gen3BoardState)\(/g)].length;
    expect(calls, 'render.ts / main.ts 里出现了声明口（那两个文件不该知道"教学屏画的哪一份"这件事）').toBe(0);
    // 教学屏里成对的两处 + import 那一行（import 里不带左括号 ⇒ 不计）
    expect(SCREEN.match(/setBoardState\(/g)?.length, '教学屏没有成对地"声明 + 撤销"').toBe(2);
    expect(SCREEN, '声明口没有在 openLevel 里设上').toContain('setBoardState(state)');
    expect(SCREEN, '声明口没有在 close() 里撤掉').toContain('setBoardState(null)');
    // 声明口只能由本屏闭包里那份 state 发起（不是外面随手塞一份）
    expect(GEN3, 'syncGen3Persistent 里没有"外来局面不许碰"那一句')
      .toContain('if (!isBoardState(s)) return;');
    // 判据本体必须是那个唯一出处（`board-scope.ts`），不是本文件里另写一份
    expect(read('src/ui/gen3-control.ts'), 'gen3-control 自己又造了一份局面状态（应当只从 board-scope 读）')
      .toContain("from './board-scope'");
    expect(read('src/ui/board-scope.ts'), 'board-scope 的"没声明时逐字返回入参"那一句不在了')
      .toMatch(/return declared \?\? main;/);
  });

  it('源码腿：滚动/缩放那一趟喂的是**局面声明口**，清单只有一份（教学屏与主循环共用）', () => {
    // ① 主循环的滚动/缩放 rAF 喂 `boardStateOf(state)`（声明过本屏局面就喂它，否则逐字是 state）
    expect(MAIN, 'main.ts 的滚动 rAF 没走局面声明口 —— 教学屏的层又会被按外来局面删掉')
      .toMatch(/syncPersistentFx\(boardStateOf\(state\)\)/);
    // ② 清单只有一份：`fx-persistent-sync.ts`（教学屏的 onViewportMove 调的是同一个）
    const syncTs = read('src/ui/fx-persistent-sync.ts');
    const names = [...syncTs.matchAll(/^\s*(sync[A-Za-z0-9]+)\(/gm)].map((m) => m[1]);
    expect(names.length, `常驻 FX 清单条数变了（清单是承重的，改这里要连带核 23 条都还在）：${names.join(', ')}`).toBe(23);
    // 锚点：清单里必须真的含"用户报的那两条"所依赖的两个 sync（否则上面那条可以在"清单被删空"上恒真）
    expect(names, '清单里没有 syncIceFx（冰1 的线冻结没人重定位）').toContain('syncIceFx');
    expect(names, '清单里没有 syncGen3Persistent（死板7 护壁没人重定位）').toContain('syncGen3Persistent');
    // ③ 反向：`main.ts` 里不许再出现"裸喂 state"的那一串（两份清单必然漂）
    expect(MAIN, 'main.ts 里又长出了一串 sync*(state)（清单漂了）')
      .not.toMatch(/syncIceFx\(state\)/);
    expect(SCREEN, '教学屏自己又列了一份清单（应调 syncPersistentFx(state)）')
      .toContain('syncPersistentFx(state)');
  });
});

/* ============================================================================
 * 缺陷 2：每一次换关 / 跳关 / 重开都把上一关的常驻 FX 清干净
 * ========================================================================== */

describe('★ 缺陷 2（2026-10-06 用户报的「从第 15 关跳回第十四关，精神已编译特效没被清除」）', () => {
  /** `openLevel()` 真正做的那三步（换局面之前先清 FX —— 这一条就是修法本身） */
  function openLevelLike(levelId: 'T12' | 'T13' | 'T11'): { body: StubNode; s: GameState } {
    const body = mountBoardRoot();
    resetUiState();
    const s = buildLevelState(levelId);
    renderBoard(boardRoot(body), s, cb);
    return { body, s };
  }

  it('★ 复现读数（反向腿）：**不清**就换局面 ⇒ T13 的精神已编译环留在 T12 的屏上', () => {
    const body = mountBoardRoot();
    const t13 = buildLevelState('T13');
    renderBoard(boardRoot(body), t13, cb);
    const compiled13 = classOf(body, 'compiled-fx').map((n) => n.cls).sort();
    expect(compiled13, 'T13 开局不是我方两条 + 对手两条已编译（锚点）')
      .toEqual(['compiled-fx compiled-fx-fire', 'compiled-fx compiled-fx-light',
        'compiled-fx compiled-fx-spirit', 'compiled-fx compiled-fx-water']);

    // ← 这里**刻意不调** resetUiState()：那就是修之前 openLevel() 的样子
    const t12 = buildLevelState('T12');
    renderBoard(boardRoot(body), t12, cb);

    const left = classOf(body, 'compiled-fx').map((n) => n.cls).sort();
    expect(left, 'T13 的已编译环一个都没剩（复现失败：这条腿失去意义）')
      .toEqual(['compiled-fx compiled-fx-spirit']);
    // 为什么偏偏剩 spirit：`compiledFx` 以 defId 为键，而"未编译就删同 defId"只写在
    // `renderProtocol()` 的 else 分支里 ⇒ T12 里**没有 spirit 协议格**时没人删它（正是用户截图那一圈）
    expect(RENDER, 'renderProtocol 的"未编译就删同 defId 层"那一支不在了')
      .toMatch(/const fx = compiledFx\.get\(p\.defId\);[\s\S]{0,120}?compiledFx\.delete\(p\.defId\)/);
    const t12DefIds = TUT_LEVELS.length > 0 ? t12.players.flatMap((p) => p.protocols.map((pr) => pr.defId)) : [];
    expect(t12DefIds.includes('spirit'), 'T12 里居然有精神协议格 ⇒ 上面那条不是"没人删"的形态').toBe(false);
  });

  it('★ 修法真跑：换局面**之前**先 resetUiState() ⇒ 一条常驻层都不留（T13 → T12）', () => {
    const body = mountBoardRoot();
    const t13 = buildLevelState('T13');
    renderBoard(boardRoot(body), t13, cb);
    expect(classOf(body, 'compiled-fx').length, '锚点：T13 有已编译环').toBe(4);

    resetUiState(); // ← openLevel() 的第一句
    const t12 = buildLevelState('T12');
    renderBoard(boardRoot(body), t12, cb);

    expect(classOf(body, 'compiled-fx').map((n) => n.cls), 'T13 的已编译环还有残留（用户截图那一幕）').toEqual([]);
    // 新关该有的层照常在（清 FX 不该把这一关自己的东西也清掉）
    const t12Rigid = buildLevelState('T12');
    rectBoardCard(body, 't12f-rigid', { left: 10, top: 20, width: 200, height: 280 });
    syncGen3Persistent(t12Rigid);
    expect(bodyLayers(body, /g3sync-rig7/).length, 'T12 自己的死板7 护壁没建出来').toBe(1);
  });

  it('★ 修法真跑：换到**别的**关卡也一样干净（T13 → T11，含 render.ts 那一批常驻层）', () => {
    const body = mountBoardRoot();
    renderBoard(boardRoot(body), buildLevelState('T13'), cb);
    expect(descendants(body).filter((n) => n.parentElement === body && n.cls !== '').length,
      '锚点：T13 的屏幕上本来有一批 body 级常驻层').toBeGreaterThan(3);

    resetUiState();
    renderBoard(boardRoot(body), buildLevelState('T11'), cb);
    const stale = descendants(body)
      .filter((n) => n.parentElement === body && n.cls !== '')
      .map((n) => n.cls)
      .filter((c) => /compiled-fx/.test(c));
    expect(stale, 'T13 的已编译环在 T11 的屏上还有残留').toEqual([]);
  });

  it('源码腿：`openLevel()` 的第一件事就是清 FX，且排在重建局面 / paint 之前', () => {
    const body = bodyOf(SCREEN, 'openLevel');
    const iReset = body.indexOf('resetUiState()');
    const iBuild = body.indexOf('buildLevelState(levelId)');
    const iPaint = body.indexOf('paint()');
    expect(iReset, 'openLevel 里没有 resetUiState（换关不清 FX = 用户报的缺陷）').toBeGreaterThan(0);
    expect(iReset < iBuild, 'resetUiState 排在重建局面之后（清单里那一批层会跟着旧局面被清掉？顺序反了）').toBe(true);
    expect(iBuild < iPaint, 'paint() 排在重建局面之前').toBe(true);
    // 声明口跟着新局面换（缺陷 1 那一半）
    expect(body.indexOf('setBoardState(state)'), 'openLevel 没有把新局面的棋盘声明下去').toBeGreaterThan(iBuild);
    expect(body.indexOf('setBoardState(state)'), '声明排在了 paint() 之后（这一帧的同步会走错门）').toBeLessThan(iPaint);
    // 四个入口都经它：退出教程 / 重开这一关 / chip 跳关 / 倒计时换关
    expect(bodyOf(SCREEN, 'restartLevel'), 'chip 跳关没有走 openLevel').toContain('openLevel()');
    expect(bodyOf(SCREEN, 'gotoNextLevel'), '倒计时到点换关没有走 openLevel').toContain('openLevel()');
    const restartAll = SCREEN.slice(SCREEN.indexOf("btn tutorial-restart'"), SCREEN.indexOf("btn tutorial-restart'") + 400);
    expect(restartAll, '「从第一关重来」没有走 openLevel（那条路也不清 FX）').toContain('openLevel()');
  });

  it('源码腿（同一族查漏）：胜利横幅也在 openLevel 里收掉（`resetUiState()` 不摘它）', () => {
    const body = bodyOf(SCREEN, 'openLevel');
    expect(body, 'openLevel 没有收上一关的胜利横幅（S0 赢了之后点 chip 跳关，横幅会一直压在屏上）')
      .toContain('dismissWinBanner()');
    // 2代瞬态 FX 那一族（`fx-gen2.ts`）：换关也要清（宿主那两处整局复位清了，换关这一处原先没清）
    expect(body, 'openLevel 没有清 2代瞬态 FX（上一关的骰子/烟花会悬在下一关上）').toContain('clearGen2Fx()');
    expect(SCREEN, '没有从 fx-gen2 引清扫口').toMatch(/import \{ clearGen2Fx \} from '\.\/fx-gen2'/);
    // 反向锚点：`resetUiState()` 确实不摘那面横幅（只有它自己那颗按钮摘）—— 这条腿的**前提**
    expect(RENDER, 'render.ts 的胜利横幅现在会被 resetUiState 摘掉了？请复核上面那条腿的必要性')
      .toMatch(/let winOverlayShown = false;/);
    const showWin = RENDER.slice(RENDER.indexOf('export function showWinOverlay'), RENDER.indexOf('export function renderBoard'));
    expect(showWin, '胜利横幅没有移除路径了（判据面变了）').toContain('banner.remove()');
    expect(showWin, '胜利横幅的移除不再只挂在那颗按钮上').toMatch(/btn\.addEventListener\('click', \(\) => \{\s*banner\.remove\(\)/);
  });

  it('源码腿：`close()` 把声明口撤成 null、把两个滚动/缩放监听摘掉（不留跨屏残留）', () => {
    const closeAt = SCREEN.indexOf('close() {');
    expect(closeAt, '找不到 close()').toBeGreaterThan(0);
    const close = SCREEN.slice(closeAt, closeAt + 1600);
    expect(close, '退出教程没有撤销"棋盘是这个局面"的声明（热座那边的3代常驻层会永远不更新）')
      .toContain('setBoardState(null)');
    expect(close, '退出教程没有摘掉 scroll 监听').toMatch(/removeEventListener\('scroll',\s*onViewportMove/);
    expect(close, '退出教程没有摘掉 resize 监听').toMatch(/removeEventListener\('resize',\s*onViewportMove/);
    // add/remove 用的是同一个函数对象（写第二个箭头函数撤不掉）
    const addAt = SCREEN.indexOf("window.addEventListener('scroll', onViewportMove");
    const rmAt = SCREEN.indexOf("window.removeEventListener('scroll', onViewportMove");
    expect(addAt, '没有挂上 scroll 监听（跟随这一半没人做）').toBeGreaterThan(0);
    expect(rmAt, 'remove 出现在 add 之前（撤一个还没挂的监听）').toBeGreaterThan(addAt);
  });

  it('源码腿：滚动/缩放重定位用的是**本屏闭包里那份 state**（不是另拿一份）', () => {
    const at = SCREEN.indexOf('const onViewportMove');
    expect(at, '找不到 onViewportMove').toBeGreaterThan(0);
    const fn = SCREEN.slice(at, SCREEN.indexOf('window.addEventListener(\'resize\', onViewportMove', at));
    expect(fn, '没有 rAF 节流（滚动事件一秒能来上百次）').toMatch(/requestAnimationFrame\(/);
    /**
     * ★ 2026-10-06 第二轮：本屏不再只同步 3 代那一族，改调**唯一清单**
     * `syncPersistentFx(state)`（`main.ts` 的滚动 rAF 调的也是它）—— 上一版只同步
     * `syncGen3Persistent`，`render.ts` 那一族（冰1 的线冻结）因此没人替本屏重定位。
     */
    expect(fn, '重定位没有走常驻 FX 的唯一清单').toContain('syncPersistentFx(state)');
    expect(fn, '用的是别的局面（本屏那份 state 是闭包里那个 let，换关时会被就地换掉）')
      .not.toMatch(/syncPersistentFx\((?!state\))/);
  });
});

/* ============================================================================
 * 正常游玩（热座 / 远程页）：主循环那份 state 就是画的局面 ⇒ 同一族缺陷不成立
 * ========================================================================== */

describe('★ 「正常情况下是否也是这样」：热座/远程页那份 state 就是画的局面 ⇒ 滚一趟一个层都不丢', () => {
  it('★ 真跑：逐关按**同一份局面**滚一趟（= 热座/远程页那条路），常驻层零丢失', () => {
    for (const l of TUT_LEVELS) {
      const body = mountBoardRoot();
      const s = buildLevelState(l.id);
      renderBoard(boardRoot(body), s, cb);
      setBoardState(s);
      const before = descendants(body)
        .filter((n) => n.parentElement === body && n.cls !== '')
        .map((n) => n.cls)
        .sort();
      mainScrollSync(s); // ← 主循环那一趟，但喂的是"这一屏正在画的那份局面"
      const after = descendants(body)
        .filter((n) => n.parentElement === body && n.cls !== '')
        .map((n) => n.cls)
        .sort();
      expect(after, `${l.id} 按自己的局面滚一趟丢了层：${before.filter((c) => !after.includes(c)).join(', ')}`)
        .toEqual(before);
      // 逐关换夹具：先撤声明（否则下一关 `renderBoard` 那一趟会被当成"外来局面"而整趟早退）
      setBoardState(null);
      resetUiState();
      restore?.(); restore = null;
    }
  });

  it('★ 真跑：热座/远程页**不声明**棋盘局面 ⇒ 声明口对它们是恒等变换（零变化）', () => {
    /**
     * 热座 / 远程页 / 重放页画的就是主循环那一份 `state` ⇒ 声明口根本不设，
     * 同步的判据、建层、收层与改动前**逐字相同**。这里把"同一份局面"在
     * **声明 / 不声明**两种情形下各跑一遍，几何与去留都要求逐字段相等。
     */
    const one = (declare: boolean): { box: [number, number, number, number]; dropped: boolean } => {
      const { body, s } = renderT12();
      if (declare) setBoardState(s);
      const box = boxOf(mazeOf(body));
      // 条件消失（被盖住）⇒ 同一份局面下一趟必须把层收掉
      s.players[1].stacks[2] = [
        ...s.players[1].stacks[2],
        { uid: 'cover', defId: 'water-0', owner: 1, line: 2, faceUp: true, zone: 'field', pos: 1 } as Card,
      ];
      syncGen3Persistent(s);
      const after = bodyLayers(body, /g3sync-rig7/);
      const dropped = after.length === 1 && isClass(after[0], 'g3sync-out');
      resetUiState();
      restore?.(); restore = null;
      return { box, dropped };
    };
    const off = one(false);
    const on = one(true);
    expect(off, '热座/远程页那一档（不声明）的建层/收层被动过了').toEqual({
      box: [97, 97, 206, 286],
      dropped: true,
    });
    expect(on, '声明口改变了"同一份局面"那条正常路的几何或去留（它应当只挡外来局面）').toEqual(off);
  });
});

/* ============================================================================
 * 缺陷 2 的**端到端**腿：真的把教学屏挂起来，点 chip 从 T13 跳到 T12
 * ========================================================================== */

describe('★ 缺陷 2 端到端（真跑教学屏）：从 T13 点 chip 跳回 T12 ⇒ 精神已编译环不留', () => {
  /**
   * 为什么这条腿值得单开：上面那条"换局面之前先 resetUiState()"是**手工照抄** openLevel 的三步；
   * 这里走用户真走的那条路 —— `mountTutorial` → 面板上那排数字（chip）→ `restartLevel()` → `openLevel()`。
   * 屏本身在无 jsdom 的 node 下跑不起来（`new MutationObserver` / `new ResizeObserver`），
   * 所以这里**补两个最小的桩**（只提供 observe/disconnect），把屏真的挂起来。
   *
   * 能给：真的点了那枚 chip 之后，body 上还剩什么。
   * 给不了：定时器真的到点换关（那要假定时器 + 一整套动画时钟）、滚动监听真的被触发
   * （桩的 `window.addEventListener` 是 noop，没有事件派发）—— 那两半仍是源码腿 + 机制腿。
   */
  const savedGlobals: Record<string, unknown> = {};
  const installObservers = (): void => {
    const g = globalThis as unknown as Record<string, unknown>;
    for (const name of ['MutationObserver', 'ResizeObserver']) savedGlobals[name] = g[name];
    class NoopObserver {
      observe(): void { /* 桩：本腿不测观察者回调 */ }
      disconnect(): void { /* noop */ }
    }
    g.MutationObserver = NoopObserver;
    g.ResizeObserver = NoopObserver;
  };
  const restoreObservers = (): void => {
    const g = globalThis as unknown as Record<string, unknown>;
    for (const [k, v] of Object.entries(savedGlobals)) {
      if (v === undefined) delete g[k]; else g[k] = v;
    }
  };

  it('★ 真跑：T13 那一屏有精神已编译环 ⇒ 点 chip 跳到 T12 之后，T13 的层一个都不剩', async () => {
    const body = mountBoardRoot();
    installObservers();
    const store = createLocalStore({ persistent: createMemoryStore() });
    // 进度：过到 T12、当前在 T13（用户原话就是"从第 15 关重新跳到第十四关"）
    const ids = TUT_LEVELS.map((l) => l.id);
    const upToT12 = ids.slice(0, ids.indexOf('T12') + 1);
    writeTutorialProgress(store, { done: upToT12, current: 'T13' });

    let closed = false;
    const handle = mountTutorial(boardRoot(body), store, {
      exit: () => { /* 本腿不退出 */ },
      saveProgress: () => { /* 本腿不落进度 */ },
    });
    try {
      // 开局在 T13：我方精神/流水两条已编译 ⇒ 屏上真的有那一圈（用户截图里的东西）
      expect(compiledLayers(body, 'spirit').length, 'T13 开局没有精神已编译环（这条腿失去前提）').toBe(1);
      expect(compiledLayers(body).length, 'T13 开局的已编译环不是四条').toBe(4);

      // 面板上那排数字：点 T12 那一枚（`dataset.level` 是屏幕显示序号之外的唯一标识）
      const chips = descendants(body).filter((n) => n.cls.includes('tutorial-chip') && n.dataset.level === 'T12');
      expect(chips.length, '面板上没有 T12 那枚 chip').toBe(1);
      expect((chips[0] as unknown as { disabled?: boolean }).disabled, 'T12 那枚 chip 是禁用的（进度不对？）')
        .not.toBe(true);
      const clicker = makeStubEl('span');
      chips[0].appendChild(clicker);
      /**
       * ⚠️ 这里**不放**"上一关那个 `.fx-luck-dice` 有没有被清掉"的行为断言：`clearGen2Fx()`
       * 靠的是**逗号组**选择器（`.fx-luck-spark, .fx-luck-msg, …`），而桩的选择器引擎
       * **故意不实现逗号组**（`net-dom-stub.ts` 头注：宁可"找不到"也不猜）⇒ 那条断言会
       * 恒真（假绿）。所以 2代瞬态 FX 那一半**只到源码腿**（见下面那条）。
       */
      (clicker as unknown as { dispatchEvent(ev: unknown): void }).dispatchEvent({ type: 'click', target: clicker });

      // 换关之后：T13 的精神已编译环必须没了，而 T12 自己的死板7 护壁该在
      expect(compiledLayers(body, 'spirit').length, '点了 chip 跳回 T12 之后，精神已编译环还留在屏上')
        .toBe(0);
      expect(compiledLayers(body).length, 'T13 的其它已编译环还有残留').toBe(0);
      // 反向：清 FX 不许把**教学自己的屏件**一起清掉（浮层 / 面板 / 倒计时 / 那排数字都在）
      expect(descendants(body).some((n) => isClass(n, 'tutorial-overlay')), '换关把教学浮层清掉了').toBe(true);
      expect(descendants(body).some((n) => isClass(n, 'tutorial-panel')), '换关把教学面板清掉了').toBe(true);
      expect(descendants(body).some((n) => isClass(n, 'tutorial-countdown')), '换关把倒计时浮层清掉了').toBe(true);
      expect(descendants(body).filter((n) => isClass(n, 'tutorial-chip')).length, '换关把那排数字清掉了')
        .toBe(TUT_LEVELS.length);
      const rig = bodyLayers(body, /g3sync-rig7/);
      expect(rig.length, 'T12 自己的死板7 护壁没建出来').toBe(1);
      expect(isClass(rig[0], 'g3sync-out'), 'T12 自己的死板7 护壁刚建出来就被判成该删').toBe(false);
    } finally {
      if (!closed) { handle.close(); closed = true; }
      restoreObservers();
    }
  });
  it('★ 远程页那一趟（render-net）也喂"这一帧画的那份局面"（同族查漏：那是另一条渲染路）', () => {
    /**
     * 远程页**不复用** `renderBoard` 本体（设计稿 §6.1），它自己那一趟也把 22 条 sync 全调了一遍
     * （`renderNetBoard` 的入口副作用）。它喂的是它自己那个形参 `s` —— 也就是"这一帧画的那份
     * 局面"。本腿钉住这件事：那一处**不许**改成从别的地方另取一份（否则远程页会重演教学屏那个
     * "按别人的局面把层剪掉"的缺陷）。
     */
    const net = read('src/ui/render-net.ts');
    expect(net, 'renderNetBoard 的常驻 FX 那一趟不再喂它自己的形参 s').toContain('syncIceFx(s);');
    expect(net, 'renderNetBoard 的常驻 FX 那一趟喂了别的局面')
      .not.toMatch(/syncIceFx\((?!s\))/);
    // 远程页的滚动监听只做两条（环 + 锁链），**不**跑常驻 FX 那一趟 —— 别在那一处另喂一份局面
    const bindAt = net.indexOf('function bindNetScrollSync');
    const bind = net.slice(bindAt, bindAt + 1400);
    expect(bind, '远程页的滚动监听没有重定位已编译环（协议环会粘在旧坐标）').toContain('syncCompiledFxLayers()');
    expect(bind, '远程页的滚动监听里出现了常驻 FX 那一趟（两份清单会漂；那一趟由 main.ts 的滚动监听统一发起）')
      .not.toContain('syncIceFx(');
  });
});

/* ============================================================================
 * 缺陷 3（2026-10-06 第二轮，用户复报）：`render.ts` 那一批常驻注册表（冰1 的线冻结）
 * ========================================================================== */

describe('★ 缺陷 3（用户复报的「冰1 的场上持续特效滑一下/缩放一下就没了」）：render.ts 那一批也走同一个声明口', () => {
  /**
   * T11 是"教学里唯一命中 `render.ts` 那一族"的一关：对手（p1）线 1 顶卡是正面 `ice-1`
   * ⇒ 引擎口径下**我方（p0）线 1** 被铺 30% 深蓝冰面（`syncIceFx` 的 `iceLineFreezes`，
   * key `${owner}-${line}` = `1-1`，层类名 `.fx-ice-linefreeze`）。
   *
   * 为什么它是这一类缺陷的判据：`syncIceFx` 的收尾是"本帧 `activeFreezes` 里没有这个 key
   * 就 `remove()`"——**纯状态判据**，喂错局面（主循环那份外来局面里没有 `ice-1`）就当场删层。
   * 这正是用户说的"上下滑动/缩放一下就消失了"。
   */
  const ICE = /fx-ice-linefreeze/;

  /** T11 的棋盘 + 那条冰面层的桩矩形（冰面按**对手链路槽**定位：p0 线 1） */
  function renderT11(slot = { left: 40, top: 300, width: 300, height: 290 }): {
    body: StubNode; s: GameState; slot: { left: number; top: number; width: number; height: number };
  } {
    const body = mountBoardRoot();
    const s = buildLevelState('T11');
    renderBoard(boardRoot(body), s, cb);
    expect(s.players[1].stacks[1].some((c) => c.defId === 'ice-1' && c.faceUp),
      'T11 的夹具变了（对手线 1 不再是正面 ice-1）⇒ 本组腿失去前提').toBe(true);
    const slotNode = descendants(body).find(
      (n) => n.dataset.player === '0' && n.dataset.line === '1' && (n.cls ?? '').includes('stack-slot')
    );
    expect(slotNode, '棋盘上没有画出 p0 线 1 的链路槽（夹具与局面脱节）').toBeTruthy();
    setStubRectFor(slotNode!, slot);
    syncPersistentFx(s); // 这一帧按**本屏局面**建层（= renderBoard 末尾那一趟等价）
    return { body, s, slot };
  }

  const iceBox = (body: StubNode): [number, number, number, number] => {
    const layers = bodyLayers(body, ICE);
    expect(layers.length, '屏上没有 .fx-ice-linefreeze（冰1 的线冻结层没建出来？）').toBe(1);
    return boxOf(layers[0]);
  };

  it('★ 复现读数（反向腿）：**不声明**棋盘局面 ⇒ 外来局面那一趟真的把冰面层删掉（就是用户看到的那一幕）', () => {
    const { body, s } = renderT11();
    expect(iceBox(body), '锚点：T11 开局该有一条对手线冰面').toEqual([40, 300, 300, 290]);

    // 不声明 ⇒ 是改动前的行为：滚动/缩放那一趟按**外来局面**重算，T11 的 `1-1` 不在 active 里
    setBoardState(null);
    mainScrollSync(createGame({ seed: 'foreign-hotseat' }));

    expect(bodyLayers(body, ICE).length, '冰面层被整个摘掉了').toBe(0);
    // 局面本身没变（变的只是"谁来同步"）
    expect(s.players[1].stacks[1].some((c) => c.defId === 'ice-1' && c.faceUp)).toBe(true);
  });

  it('★ 修法真跑：声明了棋盘局面 ⇒ 外来局面那一趟按**本屏局面**同步（冰面层活着且几何不变）', () => {
    const { body, s } = renderT11();
    setBoardState(s); // 教学屏在每次 openLevel() 里做的就是这个

    const before = iceBox(body);
    mainScrollSync(createGame({ seed: 'foreign-hotseat' })); // ← 主循环的滚动 rAF

    expect(bodyLayers(body, ICE).length, '冰面层没了（声明口没喂到 render.ts 那一族）').toBe(1);
    expect(iceBox(body), '外来局面那一趟改动了这一屏的层几何').toEqual(before);
  });

  it('★ 跟随（同一半句"特效没有继续跟随"）：滚动 = 槽位矩形平移 ⇒ 冰面层跟着平移同一个量', () => {
    const { body, s, slot } = renderT11();
    setBoardState(s);
    const dx = -55;
    const dy = 120;
    const moved = { left: slot.left + dx, top: slot.top + dy, width: slot.width, height: slot.height };
    const slotNode = descendants(body).find(
      (n) => n.dataset.player === '0' && n.dataset.line === '1' && (n.cls ?? '').includes('stack-slot')
    )!;
    setStubRectFor(slotNode, moved);
    mainScrollSync(boardStateOf(s)); // ← 主循环那一趟（声明过 ⇒ 喂本屏局面）

    expect(iceBox(body), '冰1 的冰面层没有跟着链路槽平移同一个量')
      .toEqual([moved.left, moved.top, moved.width, moved.height]);
  });

  it('★ 反向：声明**不会**把 prune 变成空操作 —— 同一份局面上条件真的消失时，冰面层照旧被删', () => {
    const { body, s } = renderT11();
    setBoardState(s);
    // 把对手线 1 顶卡翻成反面 ⇒ `ice-1` 底命令的守卫不再成立（顶层 `faceUp` 判据）
    s.players[1].stacks[1] = s.players[1].stacks[1].map((c) => ({ ...c, faceUp: false }));
    syncPersistentFx(s);
    expect(bodyLayers(body, ICE).length, '条件消失之后冰面层还留着（prune 被判据挡住了 = 修法过宽）').toBe(0);
  });

  it('★ 逐关真跑：15 关 × 声明本屏局面 × 滚动那一趟 ⇒ **一条常驻层都不丢**（含 T11 的冰面）', () => {
    const lines: string[] = [];
    let totalLayers = 0; // 反空集合：真的建出过层（否则"一条都没丢"可以在"一条都没有"上恒真）
    for (const l of TUT_LEVELS) {
      const body = mountBoardRoot();
      const s = buildLevelState(l.id);
      renderBoard(boardRoot(body), s, cb);
      setBoardState(s);
      // 把所有链路槽/电池/手牌区都配上非零矩形 —— 常驻层的"建不建"全按实测矩形判
      for (const n of descendants(body)) {
        if (/stack-slot|battery|hand/.test(n.cls ?? '')) {
          setStubRectFor(n, { left: 100, top: 200, width: 200, height: 280 });
        }
      }
      syncPersistentFx(s);
      const before = descendants(body)
        .filter((n) => n.parentElement === body && n.cls !== '')
        .map((n) => n.cls)
        .sort();
      totalLayers += before.length;
      mainScrollSync(s);
      const after = descendants(body)
        .filter((n) => n.parentElement === body && n.cls !== '')
        .map((n) => n.cls)
        .sort();
      const lost = before.filter((c) => !after.includes(c));
      lines.push(`${l.id}:${before.length}层${lost.length === 0 ? 'ok' : '丢' + lost.join('|')}`);
      expect(lost, `${l.id} 按本屏局面滚一趟丢了层：${lost.join(', ')}`).toEqual([]);
      setBoardState(null);
      resetUiState();
      restore?.(); restore = null;
    }
    // 锚点：扫描面真的覆盖到有层的关卡（否则上面那条可以在"全都没有层"上恒真）
    expect(lines.filter((x) => x.endsWith('ok')).length).toBe(TUT_LEVELS.length);
    expect(totalLayers, '15 关一张常驻层都没建出来 ⇒ 上面那条是空集上的恒真').toBeGreaterThan(10);
  });
});
