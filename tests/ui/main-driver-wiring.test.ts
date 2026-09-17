/**
 * G4 Task 4 守卫：`src/main.ts` 的**收口**（动作走 driver / 重放路由 / 复位面 / 导出 meta）
 * + **一条端到端对拍腿**（规格第 19 条：真现场路径 vs 档案重放）。
 *
 * ## ★ 为什么这个文件以**文本腿**为主（这条理由必须写在腿里，否则它会被读成"偷懒"）
 *
 * `src/main.ts` 是**应用入口**：它一被 import 就会执行 `document.getElementById('app')`、
 * `createGame()`、`initEffects()`/`initCompileFx()`/… ，最后 `showStartScreen()`
 * ⇒ "import 它"等于**把整个游戏跑起来**（要真 DOM、真 body 级特效层、真 rAF）。
 * 而本仓的测试环境是 `node`、**没有 jsdom**（`vite.config.ts`），唯一的 DOM 是手写桩
 * `tests/ui/net-dom-stub.ts`（它是为**渲染器**写的，不是为整台应用写的）；本文件也**不导出
 * 任何符号** ⇒ "跑一次 `cb.onAction`"这类行为腿**没有入口**（这与
 * `tests/ui/net-preview-wiring.test.ts` 头注声明的限度是同一件事）。
 * ⇒ 能跑行为的部分尽量跑行为：驱动、档案、重放的**行为腿**在 `tests/app/match-replay.test.ts`
 * （T1）与 `tests/app/match-driver.test.ts`（T2），本文件只补两样它们覆盖不到的：
 *   1. `main.ts` 的**接线**（文本腿，逐条写明"为什么行为腿在这里跑不动"）；
 *   2. **端到端对拍**（真驱动记录的现场 vs 档案重放）—— 那是"重放真的等于现场"的锚点。
 *
 * ⚠️ **本文件证明不了**"运行时真的在浏览器里重放出来了"。真值锚点另有两条：
 * 第五道门禁的 `replay` 场景（真 Chrome、真几何、`elementFromPoint` hit test）与人工验收
 * （播放/暂停/倍速/单步/退出、只读遮罩）。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { stripComments, functionBody, objectBody } from './source-text';
import { makeStubEl, queryAllIn, type StubNode } from './net-dom-stub';
import { renderReplayBar, type ReplayBarNav } from '../../src/ui/replay-bar';
import {
  createMatchFileRecorder,
  parseMatchFile,
  setupFromState,
  stringifyMatchFile,
  type ActionRecord,
  type MatchFile,
  type MatchFileSetup,
} from '../../src/app/match-file';
import { applyRecordedAction, stateAfterDraft } from '../../src/app/match-replay';
import { createLocalDriver, createReplayDriver, type Ticker } from '../../src/app/match-driver';
import { CARD_DATA_HASH } from '../../src/app/card-data-hash';
import { createGame, draftNextAction, getDraftPool, performDraftBan, performDraftPick } from '../../src/core/state/create';
import { getLegalActions } from '../../src/core/game';
import { getCompilableLines } from '../../src/core/rules/compile';
import { resetControlIfHeld } from '../../src/core/rules/control';
import { stateFingerprint } from '../../src/core/fingerprint';
import type { Card, GameState, Line, PlayerId } from '../../src/core/models/types';
import { pickFirst, resolveAllChoices } from '../helpers';

/* ==================================================================== *
 * 源码面（`src/main.ts` 的去注释文本）
 * ==================================================================== */

const MAIN = stripComments(
  readFileSync(fileURLToPath(new URL('../../src/main.ts', import.meta.url)))
    .subarray(0, 8 * 1024 * 1024).toString('utf8'),
);
const CB_HEAD = 'const cb: UiCallbacks = ';

/** 花括号配平的片段（字符串/模板串感知）。找不到起点就抛错（响亮），不返回空串。 */
function braceBody(src: string, open: number): string {
  if (src[open] !== '{') throw new Error(`braceBody: 起点不是 {（实际 ${JSON.stringify(src[open])}）`);
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === "'" || ch === '"' || ch === '`') {
      const q = ch;
      i += 1;
      while (i < src.length) {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === q) break;
        i += 1;
      }
      continue;
    }
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return src.slice(open, i + 1);
    }
  }
  throw new Error('braceBody: 花括号不配平');
}

/** `cb` 里某个方法成员的片段（`head` 例：`'onAction(a) {'`）。找不到即抛错。 */
function memberBody(objSrc: string, head: string): string {
  const at = objSrc.indexOf(head);
  if (at < 0) throw new Error(`cb 里找不到成员 ${head}（结构被改动？）`);
  return braceBody(objSrc, at + head.length - 1);
}

const CB_BODY = objectBody(MAIN, CB_HEAD);
const ON_ACTION = memberBody(CB_BODY, 'onAction(a) {');

/** 某个 token 的全部出现（1-based 行号 + 该行），失败信息里指名道姓 */
function occurrences(src: string, token: string): string[] {
  const out: string[] = [];
  src.split('\n').forEach((line, i) => {
    if (line.includes(token)) out.push(`src/main.ts:${i + 1}: ${line.trim()}`);
  });
  return out;
}

/** 生成式：`token` 在 `src` 里的每一个出现位置 */
function offsetsOf(src: string, token: string): number[] {
  const out: number[] = [];
  for (let i = src.indexOf(token); i >= 0; i = src.indexOf(token, i + 1)) out.push(i);
  return out;
}

/* ==================================================================== *
 * 1-3. `executeAction` 归零 + 每一个 `driver.submit(` 都落在两个出口里
 * ==================================================================== */

/**
 * **第 1 条（设计稿 §4.5 验收项 1 逐字要求"源码守卫测试"）**：剥注释后 `main.ts` 内
 * `executeAction(` **零命中**。行为侧的理由：`applyRecordedAction`（`src/app/match-replay.ts`）
 * 已是全仓唯一的"一条档案操作 → 一次引擎调用"映射，`main.ts` 再直呼一次就等于**第二份真相**：
 * 那条路不进档案、不被闸门约束、也不排空 `pendingDraws`/`pendingReveals`（D3 的整条理由链）。
 */
describe('G4 T4 · 收口：动作只走 driver', () => {
  it('1. 剥注释后 main.ts 里 `executeAction(` 零命中（正控：同一个扫描器能命中合成源码）', () => {
    const sites = occurrences(MAIN, 'executeAction(');
    expect(sites.length, `main.ts 里仍有直呼引擎的动作（收口不完整）：\n${sites.join('\n')}`).toBe(0);
    // 正控（防"扫描器恒为空"）：同样的判据函数喂一段**合成**源码必须报出命中
    const fake = 'function f(){ executeAction(state, 0, "advance"); }';
    expect(occurrences(fake, 'executeAction(').length, '正控：扫描器对合成源码也要命中').toBe(1);
  });

  it('2. 每一个 `driver.submit(` 都落在 `cb.onAction` 或 `applyRearrangeSwap` 内（生成式列全部出现点）', () => {
    const swapBody = functionBody(MAIN, 'applyRearrangeSwap');
    const inAction = ON_ACTION.split('driver.submit(').length - 1;
    const inSwap = swapBody.split('driver.submit(').length - 1;
    const total = MAIN.split('driver.submit(').length - 1;
    expect(total, `main.ts 里 driver.submit( 出现 ${total} 处（应用面：cb.onAction ${inAction} + applyRearrangeSwap ${inSwap}）`)
      .toBe(inAction + inSwap);
    // —— 生成式：把**每一个**出现点分类，任何一处落在两个函数体之外就报红并指名 ——
    const cbAt = MAIN.indexOf(CB_HEAD);
    const cbEnd = cbAt + CB_BODY.length;
    const onAt = MAIN.indexOf(ON_ACTION);
    const onEnd = onAt + ON_ACTION.length;
    const swapAt = MAIN.indexOf(swapBody);
    const swapEnd = swapAt + swapBody.length;
    expect(cbAt, '找不到 cb 的声明头').toBeGreaterThanOrEqual(0);
    expect(onAt, '找不到 cb.onAction 的函数体').toBeGreaterThanOrEqual(0);
    expect(swapAt, '找不到 applyRearrangeSwap 的函数体').toBeGreaterThanOrEqual(0);
    const outside = offsetsOf(MAIN, 'driver.submit(').filter(
      (i) => !(i >= onAt && i < onEnd) && !(i >= swapAt && i < swapEnd),
    );
    expect(outside.map((i) => MAIN.slice(i, i + 40)), '有 driver.submit( 落在 cb.onAction / applyRearrangeSwap 之外').toEqual([]);
    // 反空转：两个函数体**各自**都必须有提交点（少了任何一个，上面的"分类"都可能是空的）
    expect(inAction, 'cb.onAction 里一个 driver.submit( 都没有 ⇒ 动作没有走驱动').toBeGreaterThanOrEqual(7);
    expect(inSwap, 'applyRearrangeSwap 里没有 driver.submit( ⇒ 重排旁路没收口').toBe(1);
    // 逐条列出来（失败信息与会话报告都要能指名）
    expect(offsetsOf(MAIN, 'driver.submit(').length, '驱动提交点总数（1 处重排 + 7 类动作）').toBe(8);
  });

  it('3. 反控：把一处提交挪出这两个函数 ⇒ 上面那条判据必须报出它（比较器不恒真）', () => {
    // 取出 onAction 的**函数体之外**放一句提交：分类器必须把它算作"落在外面"
    const onAt = MAIN.indexOf(ON_ACTION);
    const injected = MAIN.slice(0, onAt) + 'function __probe(): void { driver.submit(state, { player: 0, kind: "advance" }); }\n' + MAIN.slice(onAt);
    const onEnd = onAt + ON_ACTION.length;
    const outside = offsetsOf(injected, 'driver.submit(').filter((i) => !(i >= onAt && i < onEnd));
    expect(outside.length, '反控：挪出去的那一处必须被分类器抓出来').toBeGreaterThanOrEqual(1);
  });
});

/* ==================================================================== *
 * 4-5. `rerender` 的 replay 分支 + settle 的唯一重排点
 * ==================================================================== */

describe('G4 T4 · 重放路由与 settle 的单一重排点', () => {
  it('4. rerender 里有 replay 分支，且 `renderApp(` 在整份 main.ts 里仍然只有 1 处（沿用 L1 的牙）', () => {
    const body = functionBody(MAIN, 'rerender');
    expect(body, "rerender 没有 replay 分支（重放页不会被整帧画出来）").toMatch(/renderMode\s*===\s*'replay'/);
    const sites = occurrences(MAIN, 'renderApp(');
    expect(sites.length, `renderApp( 出现 ${sites.length} 处（上限 1：唯一入口）：\n${sites.join('\n')}`).toBe(1);
    expect(body, 'renderApp(root, state, cb) 不在 rerender 体内').toMatch(/renderApp\(root,\s*state,\s*cb\)/);
    // 重放**不早退**：replay 分支必须排在 `renderApp(...)` **之后**（否则重放页画不出来）
    const iRender = body.indexOf('renderApp(root, state, cb)');
    const iReplay = body.indexOf("renderMode === 'replay'");
    expect(iReplay, 'replay 分支排在 renderApp 之前（重放页会早退成空白）').toBeGreaterThan(iRender);
  });

  it('5. settle 的唯一重排点：rerender 的 replay 分支里、renderApp 之后那一次，且**只在 FX 播完时**回话', () => {
    const body = functionBody(MAIN, 'rerender');
    // 整个 main.ts 里 settle( 只许出现一次（唯一重排点）
    const settles = occurrences(MAIN, '.settle()');
    expect(settles.length, `main.ts 里 settle() 出现 ${settles.length} 处（唯一重排点应当在 rerender 的 replay 分支里）：\n${settles.join('\n')}`).toBe(1);
    expect(body, 'settle() 不在 rerender 体内').toMatch(/replayDriver\?\.settle\(\);/);
    const iRender = body.indexOf('renderApp(root, state, cb)');
    const iSettle = body.indexOf('replayDriver?.settle()');
    expect(iSettle, 'settle() 排在 renderApp 之前（编排还没画完这一帧就把下一步排出来了）').toBeGreaterThan(iRender);
    // ★ **B1 的守卫**（T4 一审阻断项）：FX 窗口内不许回话 —— 此刻驱动正欠着这次握手、
    //   ticker 里没有在飞时钟 ⇒ 回话就会真的把下一步排出来（并发动画 / refresh 被挡回后停机）。
    //   `settle()` 的幂等只挡得住"下一步已经排进 ticker"那一种重复，挡不住这一种。
    expect(body, 'settle() 没有"本步 FX 已播完"的守卫（B1：FX 窗口内的额外 rerender 会把下一步提前排出来）')
      .toMatch(/if \(!drawAnimBusy && !revealFlyBusy\) \{/);
    expect(fxGuardBlock(), 'FX 守卫块里没有 settle()（B1 的守卫被删）').toMatch(/replayDriver\?\.settle\(\);/);
    // ★ **S4 的守卫**（本轮补充实测）：FX 窗口内按「继续」也不能直接 `play()` ——
    //   `play()` 会立刻排下一个 tick（它该这么做，否则第一个 tick 永远不来），而宿主还欠着
    //   这一步的 settle ⇒ tick 会在 FX 中间到点。⇒ 忙的时候只记待办，FX 播完再真正开播。
    expect(body, '「继续」没有"本步 FX 播完再开播"的待办分支（S4：FX 中按继续会提前走下一步）')
      .toMatch(/if \(replayResumePending\) \{[\s\S]{0,120}replayDriver\?\.play\(\);/);
    // ★ **单步**同理（同族的第三条控制条路径）：FX 中按「单步」若立刻走，两套动画并发飞，
    //   且下一条若是 `refresh` 会被 `drawAnimBusy` 挡回 ⇒ 游标不动 ⇒ **误报停机诊断**。
    expect(body, '「单步」没有"本步 FX 播完再走"的待办分支').toMatch(/if \(replayStepPending\) \{[\s\S]{0,200}replayStep\(\);/);
    const nav = functionBody(MAIN, 'replayNav');
    expect(nav, 'replayNav.play 没有"忙时只记待办"的守卫（S4）')
      .toMatch(/if \(drawAnimBusy \|\| revealFlyBusy\) \{[\s\S]{0,160}replayResumePending = true;/);
    expect(nav, 'replayNav.next 没有"忙时只记待办"的守卫（单步也会踩 FX 窗口）')
      .toMatch(/if \(drawAnimBusy \|\| revealFlyBusy\) replayStepPending = true;/);
    // 控制条：`renderReplayBar(` 只在装配函数里出现一次，而它的**调用**（refreshReplayBar）只在 rerender 里
    expect(occurrences(MAIN, 'renderReplayBar(').length, 'renderReplayBar( 的出现处数').toBe(1);
    // ⚠️ 计数用**带分号的调用形态**：`function refreshReplayBar(): void {` 里也含
    //    `refreshReplayBar()` 这个子串（定义头），不带分号会把定义当成第二个调用点
    expect(occurrences(MAIN, 'refreshReplayBar();').length, 'refreshReplayBar(); 只许有一个调用点（T3 一审第 5 条）').toBe(1);
    expect(occurrences(MAIN, 'function refreshReplayBar(').length, 'refreshReplayBar 的定义数').toBe(1);
    expect(body, 'refreshReplayBar() 不在 rerender 体内（会叠出第二层遮罩）').toContain('refreshReplayBar();');
    expect(body.indexOf('refreshReplayBar();'), '控制条刷新必须排在 renderApp 之后').toBeGreaterThan(iRender);
    // 反过来：控制条的回调里**不许**自己刷新（那是"不以整帧 renderApp 为前置"的路径）
    expect(nav, 'replayNav 里出现了 refreshReplayBar / renderReplayBar（会叠出第二层遮罩）')
      .not.toMatch(/refreshReplayBar|renderReplayBar\(/);
    for (const m of ['pause', 'play', 'next', 'setRate']) {
      expect(nav, `replayNav.${m} 没有整帧重渲染（控制条状态会与驱动状态脱节）`).toMatch(/\brerender\(\);/);
    }
  });

  it('5b. 编排的每条终止路径都汇到 rerender()（逐条分类；没有一条停在"不渲染"上）', () => {
    // 生成式：取出 cb.onAction 里**每一个** `return;`，逐条分类。四类合法形态（其余一律报红）：
    //   · 紧跟 `rerender();`（终止前已经把这一帧画出来）；
    //   · 落在**带 `renderMode !== 'replay'` 守卫**的重排模态分支里（重放进不去这个分支）；
    //   · `if (state.phase === 'gameover') return;`（顶部早退：它之前没有任何迁移）；
    //   · `if (… !== resetEpoch) return;`（世代守卫：重置已发生 ⇒ 这一页已经不在了，
    //     "放弃渲染"正是它的语义；`resetToMainInterface` 已经 dispose 了驱动）。
    //
    // ⚠️ 第 ② 类用**花括号配平**定位，不用"前 N 字符窗口"：模态分支的守卫离它的 `return;`
    //    有近千字符（中间是模态参数）⇒ 窗口法要么漏判、要么把别的 return 误判进来。
    const modalBodies: Array<{ start: number; end: number }> = [];
    for (const m of ON_ACTION.matchAll(/if \(renderMode !== 'replay' && state\.control === player\) \{/g)) {
      const open = (m.index ?? 0) + m[0].length - 1;
      modalBodies.push({ start: open, end: open + braceBody(ON_ACTION, open).length });
    }
    expect(modalBodies.length, 'compile/refresh 两个重排模态分支都必须带 replay 守卫（否则重放会停在一个没人能点的模态上）').toBe(2);
    for (const b of modalBodies) {
      expect(ON_ACTION.slice(b.start, b.end), '重排模态分支里没有 return（那它就不是"重放进不去"的终止路径）')
        .toMatch(/return;\s*\}\s*$/);
    }
    const rets = offsetsOf(ON_ACTION, 'return;');
    expect(rets.length, `cb.onAction 里的 return; 出现 ${rets.length} 处（本腿逐条分类它们）`).toBe(8);
    const unclassified: string[] = [];
    let nRendered = 0;
    let nModal = 0;
    let nGameover = 0;
    let nEpoch = 0;
    for (const i of rets) {
      const before = ON_ACTION.slice(Math.max(0, i - 400), i);
      const tail = ON_ACTION.slice(Math.max(0, i - 40), i);
      if (/rerender\(\);\s*$/.test(tail)) { nRendered += 1; continue; }                                   // ① 终止前已渲染
      if (modalBodies.some((b) => i > b.start && i < b.end)) { nModal += 1; continue; }                   // ② 重放进不去的模态分支
      if (/if \(state\.phase === 'gameover'\) return;/.test(`${before}return;`)) { nGameover += 1; continue; }          // ③ 顶部早退
      if (/if \([^\n]*!==\s*resetEpoch\) return;/.test(`${before}return;`)) { nEpoch += 1; continue; }                   // ④ 世代守卫
      unclassified.push(ON_ACTION.slice(Math.max(0, i - 120), i + 7));
    }
    expect(unclassified, `以下 return 既不在"已渲染"后、也不在重放进不去的分支里：\n${unclassified.join('\n---\n')}`).toEqual([]);
    // 反空转：四类都真的各出现过（否则上面的分类器可能把一切都归到某一类里）
    expect([nRendered, nModal, nGameover, nEpoch].every((n) => n > 0), `分类计数 ${JSON.stringify({ nRendered, nModal, nGameover, nEpoch })}`).toBe(true);
    // 反控：删掉一处 `rerender();` ⇒ 分类器必须报出那一条（判据不恒真）
    const probe = ON_ACTION.replace('rerender();\n        return;', 'return;');
    expect(probe, '反控注入没生效（锚点变了？）').not.toBe(ON_ACTION);
    const stillOk = offsetsOf(probe, 'return;').every((i) => /rerender\(\);\s*$/.test(probe.slice(Math.max(0, i - 40), i)));
    expect(stillOk, '反控：删掉 rerender() 之后分类器必须认为有 return 未被覆盖').toBe(false);
    // ③ afterFx 的两个分支 + 三处 FX 完成回调都汇到 afterFx()（"揭示/抽牌完成也算终止点"）
    expect(ON_ACTION.split('afterFx();').length - 1, 'afterFx() 的调用点数（两处 draw 完成 + 同步分支）').toBe(3);
    const afterFxAt = ON_ACTION.indexOf('const afterFx = () =>');
    expect(afterFxAt, '找不到 afterFx 的定义（终止点的汇合处变了？）').toBeGreaterThanOrEqual(0);
    const afterFxBody = braceBody(ON_ACTION, ON_ACTION.indexOf('{', afterFxAt));
    expect(afterFxBody.split('rerender();').length - 1, 'afterFx 的两个分支各要一次 rerender()').toBe(2);
  });

  it('6. 重放页的进入面：复位四件套 + 状态绑定 + 驱动 + 首帧，顺序可核', () => {
    const body = functionBody(MAIN, 'startReplayFile');
    for (const token of [
      'resetEpoch += 1',
      'resetUiState()',
      'resetNetUiState()',
      'setFxViewSeat(null)',
      'createReplayDriver(file',
      'state = stateAfterDraft(file)',
      "renderMode = 'replay'",
      'replayDriver.play()',
      'rerender()',
    ]) {
      expect(body.includes(token), `startReplayFile 缺「${token}」（进入重放的复位面不完整）`).toBe(true);
    }
    // 顺序：`resetEpoch += 1` 要在**任何**渲染之前；`state =` 要在 `play()` 之前
    //（第一个 tick 可能在 900ms 后到，但 Play 之前 state 必须已经指向重放局 —— 否则第一帧画的是旧局）
    expect(body.indexOf('resetEpoch += 1'), 'resetEpoch 必须最先 +1（在飞动画回调据此失效）')
      .toBeLessThan(body.indexOf('resetUiState()'));
    expect(body.indexOf('state = stateAfterDraft(file)')).toBeLessThan(body.indexOf('replayDriver.play()'));
    // `state` 只换绑定：它的**类型与名字**不许动（6 处闭包读它）
    expect(MAIN, 'state 的声明被改了类型/名字（D11 只允许换绑定）').toMatch(/^let state = createGame\(\);$/m);
    // 动作入口的绑定也要跟着换（否则重放页的提交会打到热座驱动上，闸门形同不存在）
    expect(body, 'startReplayFile 没把动作入口指向重放驱动').toMatch(/^\s*driver = replayDriver;$/m);
  });

  it('7. 退出面（第四份跨页状态）：resetToMainInterface 里 dispose + 入口回热座 + renderMode 回 hotseat', () => {
    const body = functionBody(MAIN, 'resetToMainInterface');
    expect(body, 'resetToMainInterface 没有 dispose 重放驱动（在飞时钟与 onTick 订阅会活着）')
      .toMatch(/replayDriver\?\.dispose\(\);/);
    expect(body, 'resetToMainInterface 没把动作入口收回到热座驱动').toMatch(/^\s*driver = localDriver;$/m);
    expect(body, 'resetToMainInterface 没把重放驱动置空').toMatch(/^\s*replayDriver = null;$/m);
    expect(body, 'resetToMainInterface 没清"待办开播"标志（S4 的伴生状态）').toMatch(/^\s*replayResumePending = false;$/m);
    expect(body, 'resetToMainInterface 没清"待办单步"标志（同族的伴生状态）').toMatch(/^\s*replayStepPending = false;$/m);
    expect(body, "resetToMainInterface 没把 renderMode 复位回 'hotseat'").toMatch(/renderMode\s*=\s*'hotseat'/);
    // 反向：L2 的并排清理与 fx-seat 复位**不许**被这次改动挤掉
    expect(body).toContain('resetUiState()');
    expect(body).toContain('resetNetUiState()');
    expect(body).toMatch(/setFxViewSeat\(\s*null\s*\)/);
    // 两个"进入热座"的入口计数不许变（L2 的反空转计数；见 net-preview-wiring.test.ts:5b）
    expect(occurrences(MAIN, "renderMode = 'hotseat'").length, 'renderMode = hotseat 的赋值点数').toBe(2);
  });

  it('8. 重放期间关掉自动推进（D8）：两个入口都早退', () => {
    expect(functionBody(MAIN, 'runAutoAdvance'), 'runAutoAdvance 没有重放守卫（400ms 的时钟会替重放多走一步）')
      .toMatch(/if \(renderMode === 'replay'\) return;/);
    expect(functionBody(MAIN, 'scheduleAutoAdvance'), 'scheduleAutoAdvance 没有重放守卫（重放页会白排一个 400ms 定时器）')
      .toMatch(/if \(renderMode === 'replay'\) return;/);
  });

  it('9. 重放的一步 = 同一条编排：onTick 订阅 replayStep，而 replayStep 走 cb.onAction(driver.next())', () => {
    const start = functionBody(MAIN, 'startReplayFile');
    expect(start, '没有把注入时钟的 tick 接到步进函数上（重放永远不动）').toMatch(/replayDriver\.onTick\(replayStep\)/);
    const step = functionBody(MAIN, 'replayStep');
    expect(step, 'replayStep 没有取档案的下一条').toContain('drv.next()');
    expect(step, 'replayStep 没有走同一条编排（D3/D12）').toMatch(/cb\.onAction\(a\)/);
    // 反向：重放**不许**自己直呼引擎（那是 pendingDraws/pendingReveals 泄漏的形态）
    expect(step, 'replayStep 里出现了直呼引擎的痕迹').not.toMatch(/executeAction\(/);
    // 游标不前进即停（否则注入时钟会每 900ms 重试同一个拒绝）
    expect(step, 'replayStep 没有"游标不动就停下并留诊断"的兜底').toMatch(/cursor\(\)\.position === before/);
    // ★ 一审 N5：**成功推进时必须把宿主诊断清掉** —— 否则一次瞬时错位会让控制条永久显示
    //   "已停在这一步"，而重放其实早已恢复（诊断只在 startReplayFile 与 resetToMainInterface 里清）。
    expect(step, 'replayStep 没有"成功推进就清诊断"的分支（N5：诊断恢复后永不消失）')
      .toMatch(/replayHostError = null;/);
    const iAdvanceCheck = step.indexOf('if (drv.cursor().position === before)');
    const iClear = step.indexOf('replayHostError = null;');
    expect(iClear, '清诊断的分支不在"游标前进了"之后（顺序反了会连停机那一次的诊断一起清掉）').toBeGreaterThan(iAdvanceCheck);
  });

  it('10. CSS import 顺序：styles-replay.css 排在 styles-local.css 之后', () => {
    const iLocal = MAIN.indexOf("import './ui/styles-local.css'");
    const iReplay = MAIN.indexOf("import './ui/styles-replay.css'");
    expect(iLocal, '找不到 styles-local.css 的 import').toBeGreaterThanOrEqual(0);
    expect(iReplay, 'main.ts 没有 import styles-replay.css（重放页的遮罩在真实应用里没有任何样式）').toBeGreaterThan(iLocal);
    // 反向：两条 import 都在文件头部（没有被塞进某个函数里）
    expect(iReplay, 'styles-replay.css 的 import 不在 import 区').toBeLessThan(MAIN.indexOf('const root = document'));
  });

  /**
   * **第 16 条的后半**（T3 一审第 5 条的契约风险）：`renderReplayBar` **不清 parent**、
   * 也不移除自己上次插入的节点 ⇒ 只要存在"不以整帧 `renderApp` 为前置"的刷新路径，屏上就会
   * 叠出**第二层遮罩 + 第二条控制条**，而且旧监听器仍然活着。
   *
   * 上面第 5 条是**源码判据**（唯一调用点）；这一条是**行为腿**：用共用 DOM 桩真跑一遍
   * "整帧重画 → 点控件 → 整帧重画" 的序列，断言每一帧之后 `replay-bar` / `replay-shield`
   * **各恰好一个**，且**每一次点击恰好触发一条回调**（旧节点与新节点不会各响一次）。
   *
   * ⚠️ 它建模的是"每帧清空 root"这一**渲染器契约**（`renderApp → renderBoard` 清空 root；
   * `main.ts` 的注释引的就是它）—— 桩不实现 `innerHTML`，所以清空写作 `textContent = ''`
   * （桩里语义相同：摘掉全部子节点）。
   */
  it('16. 整帧重建：连点暂停/倍速多次 ⇒ bar/shield 各仍只有一个，每次点击恰好一条回调', () => {
    const parent = makeStubEl('div');
    (parent as unknown as { ownerDocument: { createElement(t: string): StubNode } }).ownerDocument = {
      createElement: (t: string) => makeStubEl(t),
    };
    const calls: string[] = [];
    let paused = false;
    const nav: ReplayBarNav = {
      pause: () => { calls.push('pause'); paused = true; frame(); },
      play: () => { calls.push('play'); paused = false; frame(); },
      next: () => { calls.push('next'); },
      setRate: (r: 0 | 1 | 2 | 4) => { calls.push(`rate:${r}`); frame(); },
      exit: () => { calls.push('exit'); },
    };
    const frame = (): void => {
      (parent as unknown as { textContent: string }).textContent = '';   // ← 渲染器每帧清空 root 的契约
      renderReplayBar(
        parent as unknown as HTMLElement,
        { position: 3, total: 47, rate: 1, paused, done: false },
        nav,
      );
    };
    const count = (role: string): number => queryAllIn(parent, `[data-role="${role}"]`).length;
    /** 在节点上真派发一次点击（桩的 `dispatchEvent` **不调用派发节点自己的监听器** ⇒
     *  与 `tests/ui/replay-bar.test.ts:88-95` 同款手法：在临时子节点上派发，让冒泡路径经过它） */
    const click = (node: StubNode): void => {
      const label = node.text;
      const clicker = makeStubEl('span');
      node.appendChild(clicker);
      clicker.dispatchEvent({ type: 'click', target: clicker });
      node.textContent = label;   // 写回文案（同时摘掉临时子节点）
    };

    frame();
    expect(count('replay-bar'), '第一帧之后 bar 的个数').toBe(1);
    for (let i = 0; i < 3; i += 1) {
      const role = paused ? 'replay-play' : 'replay-pause';
      const toggle = queryAllIn(parent, `[data-role="${role}"]`);
      expect(toggle.length, `第 ${i} 次点击前找不到 ${role} 按钮`).toBe(1);
      click(toggle[0]);
      expect(calls.length, `第 ${i} 次点击必须恰好触发一条回调（旧节点不许再响）`).toBe(i + 1);
      expect(count('replay-bar'), `第 ${i} 次点击后 bar 的个数`).toBe(1);
      expect(count('replay-shield'), `第 ${i} 次点击后 shield 的个数`).toBe(1);
    }
    expect(calls, '三次点击的形态应当是 暂停/继续/暂停 交替').toEqual(['pause', 'play', 'pause']);
    // 倍速按钮同样连点：每次恰好一条回调，且控件仍只有一套
    for (const r of [2, 4, 1]) {
      const btn = queryAllIn(parent, `[data-role="replay-rate"]`).filter((b) => b.dataset.rate === String(r));
      expect(btn.length, `找不到 ${r}× 按钮`).toBe(1);
      const before = calls.length;
      click(btn[0]);
      expect(calls.length, `${r}× 点击必须恰好触发一条回调`).toBe(before + 1);
    }
    expect(calls).toEqual(['pause', 'play', 'pause', 'rate:2', 'rate:4', 'rate:1']);
    expect(count('replay-bar'), '连点之后 bar 仍然恰好一个').toBe(1);
    expect(count('replay-shield'), '连点之后 shield 仍然恰好一个').toBe(1);
    // 反控（**判据不恒真**的证据）：**不清空 parent** 直接再渲染一次 ⇒ 立刻叠成两套。
    // 这正是"`refreshReplayBar` 必须以整帧 `renderApp` 为前置"的理由，也是本腿前提的证明：
    // 上面那些"各恰好一个"不是因为 `renderReplayBar` 自己有去重，而是因为每帧都清了 parent。
    renderReplayBar(parent as unknown as HTMLElement, { position: 3, total: 47, rate: 1, paused, done: false }, nav);
    expect(count('replay-bar'), '反控：不清空 parent 时 bar 会叠成两个').toBe(2);
    expect(count('replay-shield'), '反控：不清空 parent 时 shield 会叠成两个').toBe(2);
  });
});

/* ==================================================================== *
 * 19. 端到端对拍：真现场路径（LocalDriver + main.ts 的现场顺序） vs 档案重放
 * ==================================================================== */

/** 种子派生的小整数（纯、确定性；与 `tests/app/match-replay.test.ts` 同款做法） */
function deriveIndex(seed: string, tag: string, n: number): number {
  let h = 0x811c9dc5;
  const text = `${seed}|${tag}`;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return n > 0 ? h % n : 0;
}

/** 非平凡选牌策略：索引由种子 + (kind, 序号) 派生（不恒取 `avail[0]`，否则档案的草稿序列是平凡的） */
function draftNontrivial(s: GameState, seed: string): void {
  let guard = 0;
  for (;;) {
    const next = draftNextAction(s);
    if (!next) break;
    if (guard++ > 200) throw new Error('草稿没有收敛');
    const avail = getDraftPool(s).map((p) => p.defId);
    const defId = avail[deriveIndex(seed, `${next.kind}:${guard}`, avail.length)];
    if (next.kind === 'pick') performDraftPick(s, defId);
    else performDraftBan(s, defId);
  }
}

function metaFor(seed: string, setup: MatchFileSetup): Parameters<ReturnType<typeof createMatchFileRecorder>['toMatchFile']>[0] {
  return {
    seed,
    setup,
    players: [{ nick: '甲' }, { nick: '乙' }] as [{ nick: string }, { nick: string }],
    cardDataHash: CARD_DATA_HASH,
    createdAt: '2026-09-17T00:00:00.000Z',
  };
}

describe('G4 第 19 条 · 端到端对拍（真现场路径 vs 档案重放）', () => {
  /**
   * 这条腿补的是 T1 一审点名的**残留缺口**：T1 的判据 7 里"现场侧"是**测试自己**显式调
   * `resetControlIfHeld` 铰接出来的（现场复制品），它证明的是"助手与那个复制品一致"，
   * **没有**任何腿把助手与**真实现场编码**对拍。
   *
   * 本腿的现场侧尽量贴近 `main.ts`：
   *   · 动作走 `createLocalDriver().submit(...)` —— **同一个**生产驱动、同一条
   *     `applyRecordedAction`、同一条记录器（`main.ts` 的热座路径就是它）；
   *   · 持控制组件的编译顺序照 `main.ts` 的编排：**【UI 先归还（不进档案）】→【逐次重排（进档案）】
   *     →【编译（进档案）】**；这条顺序另有下面那条**源码判据**钉住（脚本复制品不许漂移）。
   * 重放侧走"档案 → `stateAfterDraft` + 逐条 `applyRecordedAction`"（第 19 条逐字要求的形态），
   * 并**额外**走一遍 `ReplayDriver` 闸门（宿主实际用的那条路），两侧都要与现场指纹相等。
   *
   * ⚠️ **它不是"真浏览器里的 main.ts"**：`main.ts` 不可 import（见文件头注）⇒ 现场侧的
   * `cb.onAction` 外壳（FX 编排、世代守卫）不在本腿的覆盖里。人工复现步骤见任务报告。
   */
  it('真现场：持控制组件 → 重排 ×2 → 编译；档案重放（助手 + 闸门两条路）指纹逐字节相等', () => {
    const seed = 'g4t4-e2e-live-vs-replay';
    // ① 现场：草稿（非平凡）→ 用**生产驱动**推进到可编译的步
    const s = createGame({ seed });
    draftNontrivial(s, seed);
    expect(s.phase, '草稿应当已结束').toBe('turn');
    const live = createLocalDriver();
    const player = s.turnPlayer;
    let guard = 0;
    while (s.step !== 'check-compile' && s.step !== 'action' && guard++ < 8) {
      const r = live.submit(s, { player: s.turnPlayer, kind: 'advance' });
      expect(r.ok, `现场推进第 ${guard} 步失败：${JSON.stringify(r)}`).toBe(true);
    }
    expect(['check-compile', 'action'], `推进后的步：${s.step}`).toContain(s.step);

    // ② 脚本化前置条件（可编译线 + 控制权在该玩家手里）。uid **写死**：`tests/helpers.ts` 的
    //    `makeCard()` 用模块级计数器发 uid ⇒ 两侧各调一次会得到不同 uid、指纹必然不等。
    const line = 0 as Line;
    const mk = (defId: string, uid: string, pos: number): Card => ({
      uid, defId, owner: player, faceUp: true, zone: 'field', line, pos,
    });
    const scripted = (st: GameState): void => {
      expect(st.players[player].protocols.every((p) => !p.compiled), '前置：未编译任何协议').toBe(true);
      st.players[player].stacks[line] = [
        mk('unity-5', 'g4t4-e2e-u5', 0),
        mk('unity-4', 'g4t4-e2e-u4', 1),
        mk('unity-3', 'g4t4-e2e-u3', 2),
      ];
      st.control = player;
      expect(getCompilableLines(st, player), '前置：这条线必须真的可编译').toContain(line);
    };
    scripted(s);
    const beforeSteps = stateFingerprint(s);

    // ③ 现场顺序（= `main.ts` 的 `cb.onAction` compile 分支 + `applyRearrangeSwap`）：
    //    【UI 归还（带一条 pushLog，**不进档案**）】→【重排 ×2（进档案）】→【编译（进档案）】
    expect(resetControlIfHeld(s, player), '这条腿必须真的走到"持控制组件"的分支').toBe(true);
    for (const [a, b] of [[0, 1], [1, 2]] as Array<[Line, Line]>) {
      const r = live.submit(s, { player, kind: 'rearrange-protocols', args: { target: 0, a, b } });
      expect(r.ok, `现场重排 (${a},${b}) 失败：${JSON.stringify(r)}`).toBe(true);
    }
    const rCompile = live.submit(s, { player, kind: 'compile', args: { line } });
    expect(rCompile.ok, `现场编译失败：${JSON.stringify(rCompile)}`).toBe(true);
    const file = live.recorder()!.toMatchFile(metaFor(seed, setupFromState(s)));

    // 档案的形态证据：推进若干条 + 两条重排 + 一条编译（少了任何一类，"对拍"就是空的）
    const kinds = file.actions.map((a) => a.kind);
    expect(kinds.filter((k) => k === 'rearrange-protocols').length, '档案里必须留下 2 条重排').toBe(2);
    expect(kinds[kinds.length - 1], '最后一条必须是编译').toBe('compile');
    expect(kinds.filter((k) => k === 'advance').length, '推进步也必须进档案').toBeGreaterThan(0);
    // 现场的 log 顺序：【归还】【重排】【重排】【编译】（指纹含 log ⇒ 这条顺序就是承重物）
    const iReturn = s.log.findIndex((l) => l.includes('归还控制组件'));
    const iCompileLog = s.log.findIndex((l) => l.includes('编译线'));
    expect(iReturn, `现场必须留下"归还控制组件"那条 log：${JSON.stringify(s.log)}`).toBeGreaterThanOrEqual(0);
    expect(iCompileLog, '现场必须留下"编译线"那条 log').toBeGreaterThan(iReturn);

    // ④ 重放 A：档案 → `stateAfterDraft` + 逐条 `applyRecordedAction`（第 19 条要求的形态）
    const replayA = stateAfterDraft(file);
    const stopKinds = new Set(['rearrange-protocols', 'compile']);
    for (const a of file.actions) {
      if (stopKinds.has(a.kind)) break;
      applyRecordedAction(replayA, a);
    }
    scripted(replayA);
    expect(stateFingerprint(replayA), '重放侧到达的前置状态必须与现场相同（否则比的是两个局）').toBe(beforeSteps);
    for (const a of file.actions) {
      if (!stopKinds.has(a.kind)) continue;
      applyRecordedAction(replayA, a);
    }
    expect(replayA.log, 'log 逐条相同（顺序敏感）').toEqual(s.log);
    expect(stateFingerprint(replayA), '重放 A（助手）指纹必须与现场逐字节相等').toBe(stateFingerprint(s));

    // ⑤ 重放 B：同一条档案走 `ReplayDriver` 闸门（宿主实际用的那条路）
    const ticker: Ticker = { schedule: () => 0, cancel: () => {} };
    const drv = createReplayDriver(file, { ticker, settleWatchdogMs: null });
    const replayB = stateAfterDraft(file);
    for (;;) {
      const a = drv.next();
      if (!a) break;
      if (stopKinds.has(a.kind)) break;
      const r = drv.submit(replayB, a);
      expect(r.ok, `重放 B 第 ${drv.cursor().position} 步被拒：${JSON.stringify(r)}`).toBe(true);
    }
    scripted(replayB);
    for (;;) {
      const a = drv.next();
      if (!a) break;
      const r = drv.submit(replayB, a as Omit<ActionRecord, 'seq'>);
      expect(r.ok, `重放 B 第 ${drv.cursor().position} 步被拒：${JSON.stringify(r)}`).toBe(true);
    }
    expect(drv.cursor().position, '重放 B 必须走完档案每一步').toBe(file.actions.length);
    expect(stateFingerprint(replayB), '重放 B（闸门）指纹必须与现场逐字节相等').toBe(stateFingerprint(s));
  });

  it('反空转：删掉「重排」两条记录 ⇒ 两侧指纹**必须**不同（否则上面那条相等是空的）', () => {
    const seed = 'g4t4-e2e-live-vs-replay';
    const s = createGame({ seed });
    draftNontrivial(s, seed);
    const live = createLocalDriver();
    const player = s.turnPlayer;
    let guard = 0;
    while (s.step !== 'check-compile' && s.step !== 'action' && guard++ < 8) {
      live.submit(s, { player: s.turnPlayer, kind: 'advance' });
    }
    const line = 0 as Line;
    const mk = (defId: string, uid: string, pos: number): Card => ({
      uid, defId, owner: player, faceUp: true, zone: 'field', line, pos,
    });
    const scripted = (st: GameState): void => {
      st.players[player].stacks[line] = [mk('unity-5', 'g4t4-e2e-u5', 0), mk('unity-4', 'g4t4-e2e-u4', 1), mk('unity-3', 'g4t4-e2e-u3', 2)];
      st.control = player;
    };
    scripted(s);
    resetControlIfHeld(s, player);
    live.submit(s, { player, kind: 'rearrange-protocols', args: { target: 0, a: 0 as Line, b: 1 as Line } });
    live.submit(s, { player, kind: 'compile', args: { line } });
    const file = live.recorder()!.toMatchFile(metaFor(seed, setupFromState(s)));
    // 把重排那条从档案里删掉（其余保持）⇒ 重放出来的 log/协议摆放必然与现场不同
    const crippled: MatchFile = { ...file, actions: file.actions.filter((a) => a.kind !== 'rearrange-protocols') };
    const replay = stateAfterDraft(crippled);
    for (const a of file.actions) {
      if (a.kind === 'rearrange-protocols') continue;
      if (a.kind === 'compile') break;
      applyRecordedAction(replay, a);
    }
    scripted(replay);
    for (const a of file.actions) {
      if (a.kind === 'rearrange-protocols') continue;
      if (a.kind === 'compile') { applyRecordedAction(replay, a); break; }
    }
    expect(stateFingerprint(replay), '删掉重排后指纹必须不同（否则"相等"这条判据没有判别力）')
      .not.toBe(stateFingerprint(s));
  });

  it('现场顺序的源码依据：main.ts 的 compile 分支确实是【归还 → 重排 → 编译】', () => {
    // 编译分支里 `resetControlIfHeld` 必须**早于**编译的提交（现场那次 UI 归还只在 UI 侧、不进档案）
    const iReset = ON_ACTION.indexOf('resetControlIfHeld(state, player)');
    const iCompileSubmit = ON_ACTION.indexOf("kind: 'compile', args: { line: a.line! }");
    expect(iReset, 'compile 分支没有 UI 侧的 `resetControlIfHeld`（现场顺序的第一拍）').toBeGreaterThanOrEqual(0);
    expect(iCompileSubmit, 'compile 分支没有把编译提交给驱动').toBeGreaterThan(iReset);
    // 模态里的提交必须回到同一条编排（`cb.onAction({ kind: 'compile', line })`）
    expect(ON_ACTION, '模态提交没有回到 cb.onAction（现场会绕过编排）').toMatch(/cb\.onAction\(\{ kind: 'compile', line \}\)/);
    expect(ON_ACTION, '模态的 onSwap 没有接 applyRearrangeSwap（重排不会进档案）').toMatch(/onSwap:\s*applyRearrangeSwap/);
    // `applyRearrangeSwap` 必须是**真实规则动作**的提交（不是 note）
    const swap = functionBody(MAIN, 'applyRearrangeSwap');
    expect(swap, 'applyRearrangeSwap 没走 driver.submit（重排会从档案里消失）').toMatch(/driver\.submit\(state, \{ player: state\.turnPlayer, kind: 'rearrange-protocols'/);
    expect(swap, 'applyRearrangeSwap 把它当成旁路留痕了（note）').not.toMatch(/\.note\(/);
  });

  it('导出 meta 的装配面（T4 第 11 条 + 一审 N2）：seed/setup/昵称/指纹/createdAt，终局还要写 result', () => {
    const meta = functionBody(MAIN, 'matchFileMeta');
    expect(meta, 'seed 必须来自本局状态（重放全靠它）').toMatch(/seed:\s*s\.rng\.seed/);
    expect(meta, 'setup 必须走 setupFromState（草稿两条序列的唯一抽取点）').toMatch(/setup:\s*setupFromState\(s\)/);
    expect(meta, '昵称必须来自 L1（不许自己编）').toMatch(/readNickName\(localStore\)/);
    expect(meta, '卡牌指纹必须写进 meta').toMatch(/cardDataHash:\s*CARD_DATA_HASH/);
    // `createdAt` 由 **UI 层**读时钟（`src/app` 不许读时钟 —— tests/app-purity.test.ts 有守卫）
    expect(meta, 'createdAt 必须由 UI 层读时钟').toMatch(/createdAt:\s*new Date\(\)\.toISOString\(\)/);
    // ★ T4 一审 N2：终局（`winner !== null`）时必须把 `result` 写进档案；**未终局时不写**
    //   （不是写 `winner: null`）。`reason` 是"引擎只判谁赢"的如实说明，不编造成因。
    expect(meta, '终局时没有把 result 写进档案（MatchFile.result 之前全仓没有生产者）')
      .toMatch(/s\.winner !== null \? \{ result: \{ winner: s\.winner, reason: /);
    expect(meta, 'result 的写法必须是"条件展开"（未终局时不能带 result）').toMatch(/\.\.\.\(s\.winner !== null/);
    const build = functionBody(MAIN, 'buildSessionArchive');
    expect(build, '会话里没有对局记录时必须**如实返回理由**，不许退化成导一份空档案').toMatch(/return \{ reason:/);
    expect(build, 'buildSessionArchive 没接记录器').toMatch(/rec\.toMatchFile\(matchFileMeta\(state\)\)/);
    // `result` 必须**能过档案校验并往返**（生产 API：`parseMatchFile` 会校验 winner/reason 的形状）
    const finished: MatchFile = createMatchFileRecorder().toMatchFile({
      seed: 'g4t4-result-roundtrip',
      setup: setupFromState(createGame({ seed: 'g4t4-result-roundtrip' })),
      players: [{ nick: '甲' }, { nick: '乙' }],
      cardDataHash: CARD_DATA_HASH,
      createdAt: '2026-09-17T00:00:00.000Z',
      result: { winner: 1, reason: '对局结束：胜负由引擎判定' },
    });
    const back = parseMatchFile(stringifyMatchFile(finished), { currentHash: CARD_DATA_HASH });
    expect(back.ok, '带 result 的档案必须能解析回来（形状由 parseMatchFile 校验）').toBe(true);
    if (back.ok) expect(back.file.result, 'result 必须逐字往返').toEqual({ winner: 1, reason: '对局结束：胜负由引擎判定' });
  });

  it('本地对局的记录面：effect-choice 记的是**实际 chooser**（不是 turnPlayer）', () => {
    // 归档面上的这条修正有两个后果：① 联机/重放时 chooser 才是对的；② 闸门逐项比 player，
    // 退回 turnPlayer 会让"对手应答"的记录在重放里被拒（T4 第 4 条）
    expect(ON_ACTION, 'effect-choice 的提交没有用 prompt.chooser')
      .toMatch(/const chooser = top\?\.prompt\?\.chooser \?\? top\?\.player \?\? state\.turnPlayer;/);
    expect(ON_ACTION, 'effect-choice 的提交没有把 chooser 作为 player 交给驱动')
      .toMatch(/driver\.submit\(state, \{ player: chooser, kind: 'effect-choice'/);
  });
});

/* ==================================================================== *
 * 一审阻断 B1 · 重放节奏：FX 窗口内的额外 rerender() 不许把下一步提前排出来
 * ==================================================================== */

/**
 * 这一组是**节奏模型腿**：它不 import `main.ts`（不可 import，见文件头注），而是逐条复刻
 * `main.ts` 的三件事 —— `rerender` 的收尾（`renderApp → refreshReplayBar → [本步 FX 播完才]
 * settle`，`:210-224`）、`replayStep`（`:246-263`）、`replayNav`（`:294-302`）。
 *
 * **模型与真代码的绑定**：上面第 5 条的文本腿要求 `main.ts` 里那句守卫**逐字存在**
 * （`if (!drawAnimBusy && !revealFlyBusy) replayDriver?.settle();`）⇒ 模型漂移不会被静默放过。
 *
 * 两个世界（双向可辨，方法学教训第 1 条）：
 *   · `guard: true`  = 现在的主代码（FX 内不回话）⇒ **FX 内重入 0 次**、走完档案、无诊断；
 *   · `guard: false` = 一审 B1 的旧形态（无条件回话）⇒ 重入 > 0 次，且"下一条是 refresh"那种
 *     形态会把 `refresh` 挡回、游标不动 ⇒ 停在那一步。
 */
class RhythmClock implements Ticker {
  now = 0;
  private q: Array<{ id: number; t: number; fn: () => void }> = [];
  private seq = 1;
  schedule(fn: () => void, ms: number): number {
    const id = this.seq++;
    this.q.push({ id, t: this.now + ms, fn });
    return id;
  }
  cancel(h: number): void { this.q = this.q.filter((x) => x.id !== h); }
  advanceTo(t: number): void {
    for (;;) {
      const due = this.q.filter((x) => x.t <= t).sort((a, b) => a.t - b.t || a.id - b.id)[0];
      if (!due) break;
      this.q = this.q.filter((x) => x !== due);
      this.now = due.t;
      due.fn();
    }
    this.now = t;
  }
}

/** 真档案（生产 `LocalDriver` + 引擎；草稿走完，动作优先 `refresh`/`play`，最多 24 步） */
function buildRhythmArchive(): MatchFile {
  const seed = 'g4t4-rhythm';
  const s = createGame({ seed });
  let guard0 = 0;
  while (s.phase === 'draft') {
    if (guard0++ > 50) throw new Error('草稿没有收敛');
    const step = draftNextAction(s);
    if (!step) break;
    const avail = getDraftPool(s);
    if (step.kind === 'pick') performDraftPick(s, avail[0].defId);
    else performDraftBan(s, avail[0].defId);
  }
  const live = createLocalDriver();
  const drain = (): void => {
    for (;;) {
      const top = s.pendingEffects[s.pendingEffects.length - 1];
      if (!top?.prompt) return;
      const chooser = top.prompt.chooser ?? top.player ?? s.turnPlayer;
      live.submit(s, { player: chooser, kind: 'effect-choice', args: { promptId: top.id, choice: pickFirst(top.prompt) } });
    }
  };
  drain();
  let guard = 0;
  while (s.phase === 'turn' && guard++ < 24) {
    const p = s.turnPlayer;
    const legal = getLegalActions(s, p);
    const prefer = legal.find((a) => a.kind === 'refresh') ?? legal.find((a) => a.kind === 'play') ?? legal[0];
    if (!prefer) break;
    const args: Record<string, unknown> = {};
    if (prefer.cardUid !== undefined) args.cardUid = prefer.cardUid;
    if (prefer.faceUp !== undefined) args.faceUp = prefer.faceUp;
    if (prefer.line !== undefined) args.line = prefer.line;
    if (prefer.target !== undefined) args.target = prefer.target;
    const r = live.submit(s, { player: p, kind: prefer.kind, ...(Object.keys(args).length ? { args } : {}) });
    if (!r.ok) break;
    drain();
  }
  return live.recorder()!.toMatchFile(metaFor(seed, setupFromState(s)));
}

const RHYTHM_FILE = buildRhythmArchive();

/**
 * `rerender` 里 **FX 守卫块**的片段（花括号配平，含守卫头与全部待办分支）。
 * 用配平而不是"前 N 字符窗口"：块里的注释与待办分支会长大（本文件就长过一次），
 * 窗口法会让"守卫在不在"退化成"注释有多长"。
 *
 * ⚠️ **找不到守卫头时返回空串，绝不抛错**：这个助手在**模块作用域**被调用（下面几个
 * `*_IN_MAIN` 常量）——若它抛错，变异体下整个文件会**收集失败**，于是"变异被抓到"只表现为
 * `1 failed file` 而**没有任何红腿名**（读起来像环境故障，而不是判据变红）。返回空串则
 * `GUARD_IN_MAIN = false` ⇒ 行为腿照常变红，且第 5 条的文本腿会指名报错。
 */
function fxGuardBlock(): string {
  const body = functionBody(MAIN, 'rerender');
  const at = body.indexOf('if (!drawAnimBusy && !revealFlyBusy) {');
  if (at < 0) return '';
  return braceBody(body, body.indexOf('{', at));
}

/**
 * ★ **三处守卫从 `main.ts` 派生**（不是测试里写死的常量）—— 这样把守卫从主代码里删掉/改坏时，
 * 下面那些**行为腿**会当场变红（否则它们只证明"模型自己是自洽的"，对着 `main.ts` 的变异无牙）。
 */
const GUARD_IN_MAIN = /replayDriver\?\.settle\(\);/.test(fxGuardBlock());
const RESUME_IN_MAIN =
  /if \(replayResumePending\) \{[\s\S]{0,200}replayDriver\?\.play\(\);/.test(functionBody(MAIN, 'rerender'))
  && /if \(drawAnimBusy \|\| revealFlyBusy\) \{[\s\S]{0,160}replayResumePending = true;/.test(functionBody(MAIN, 'replayNav'));
/** 「单步」的忙时待办（同族第三条）：两处都在才算数 */
const STEP_DEFER_IN_MAIN =
  /if \(replayStepPending\) \{[\s\S]{0,200}replayStep\(\);/.test(functionBody(MAIN, 'rerender'))
  && /if \(drawAnimBusy \|\| revealFlyBusy\) replayStepPending = true;/.test(functionBody(MAIN, 'replayNav'));

/**
 * 跑一次宿主循环。`extra` 在**某一步的 FX 窗口内部**（FX 开始后 150ms）被调用一次，
 * 模拟"重放中发生的一次额外 `rerender()`"（devmode 解锁 / 控制条点击都会走到同一个 `rerender()`）。
 */
function runRhythm(opts: {
  fxMs: number;
  guard: boolean;
  extra?: (nav: { rerender: () => void; pause: () => void; play: () => void; next: () => void; setRate: (r: 0 | 1 | 2 | 4) => void }, drv: ReturnType<typeof createReplayDriver>) => void;
  every?: boolean;
  extraAtStep?: number;
}) {
  const clock = new RhythmClock();
  const drv = createReplayDriver(RHYTHM_FILE, { ticker: clock, stepMs: 900 });
  const rs = stateAfterDraft(RHYTHM_FILE);
  /** ★ 承重计数：**本步 FX 还没播完就又被要求走下一步**的次数（= 节奏被踩） */
  let reentry = 0;
  let rejectedRefresh = 0;
  let drawBusy = false;
  let extraArmed = false;
  /** 「用户在本步 FX 播放中按了继续 / 单步」的待办（= `main.ts` 的两个 pending 标志） */
  let resumePending = false;
  let stepPending = false;

  /** 走一步（tick 与「单步」共用）：忙的时候按下就记一次"被重入" */
  const takeStep = (): void => {
    const a = drv.next();
    if (drawBusy) reentry += 1;
    if (!a) { hostRerender(); return; }
    const before = drv.cursor().position;
    if (a.kind === 'refresh' && drawBusy) {
      // `main.ts:555-560` 的 `drawAnimBusy` 早退：不提交、只重渲染
      rejectedRefresh += 1;
      hostRerender();
      if (drv.cursor().position === before) drv.pause();   // = replayStep 的停机分支
      return;
    }
    const r = drv.submit(rs, a as Omit<ActionRecord, 'seq'>);
    expect(r.ok, `节奏腿：第 ${before} 步被拒 ${JSON.stringify(r)}`).toBe(true);
    // ⚠️ **不要**在这里 `resolveAllChoices(...)`：档案里**已经**有每次应答的 `effect-choice`
    //    记录（现场是逐条记下来的）⇒ 每一步都由档案驱动。自行应答会造出档案里没有的状态迁移，
    //    下一步就对不上了（本腿第一版就栽在这：第 10 步 engine-error）。
    if (opts.fxMs > 0) {
      drawBusy = true;
      clock.schedule(() => { drawBusy = false; hostRerender(); }, opts.fxMs);
      if (opts.extra && (opts.every || (opts.extraAtStep ? drv.cursor().position === opts.extraAtStep : !extraArmed))) {
        extraArmed = true;
        clock.schedule(() => { opts.extra!(nav, drv); }, 150);
      }
    } else {
      hostRerender();
    }
  };

  // `main.ts:210-232` 的收尾：整帧渲染 → 控制条刷新 → **只在本步 FX 播完时**回话；
  // 期间按过「继续」/「单步」则此刻才处理（否则 FX 中排 tick 会把下一步提前）。
  const hostRerender = (): void => {
    if (!opts.guard || !drawBusy) {
      if (stepPending) { stepPending = false; resumePending = false; takeStep(); }
      else if (resumePending) { resumePending = false; drv.play(); }
      else drv.settle();
    }
  };
  // `main.ts:313-341` 的 `replayNav`（guard=true = 现在的形态；false = 一审 S2-S4 的旧形态）
  const nav = {
    rerender: hostRerender,
    pause: (): void => { drv.pause(); hostRerender(); },
    play: (): void => {
      if (opts.guard && drawBusy) { resumePending = true; drv.pause(); }
      else drv.play();
      hostRerender();
    },
    next: (): void => {
      drv.pause();
      if (opts.guard && drawBusy) stepPending = true;
      else takeStep();
      hostRerender();
    },
    setRate: (r: 0 | 1 | 2 | 4): void => { drv.setRate(r); hostRerender(); },
  };

  drv.onTick(takeStep);
  drv.play();
  // 虚拟时钟的预算必须够走完：每一步 ≈ stepMs(900) + fxMs ⇒ 25 步 × 2900ms ≈ 73s。
  // （给 300s：跑的是虚拟时间，真实耗时与预算无关；给太少会假红在"没走完"上。）
  clock.advanceTo(300_000);
  return { drv, reentry, rejectedRefresh, position: drv.cursor().position, total: RHYTHM_FILE.actions.length };
}

describe('G4 T4 · 重放节奏（一审 B1 + S4：FX 窗口内不许回话、也不许提前开播）', () => {
  it('前置：节奏档案够用（含 refresh，且至少 3 步）', () => {
    const kinds = RHYTHM_FILE.actions.map((a) => a.kind);
    expect(RHYTHM_FILE.actions.length).toBeGreaterThan(3);
    expect(kinds, '档案里必须有 refresh，否则"下一条是 refresh"那种形态构造不出来').toContain('refresh');
  });

  it('B1-a 纯净世界（FX 330ms，宿主不做额外调用）⇒ FX 内重入 0 次、走完档案、无诊断', () => {
    const r = runRhythm({ fxMs: 330, guard: GUARD_IN_MAIN });
    expect(r.reentry, '纯净世界里 FX 窗口内不该被重入').toBe(0);
    expect(r.rejectedRefresh).toBe(0);
    expect(r.position, '纯净世界必须走完档案').toBe(RHYTHM_FILE.actions.length);
    expect(r.drv.cursor().done).toBe(true);
    expect(r.drv.cursor().error).toBeNull();
    expect(r.drv.cursor().diagnostic, '纯净世界里看门狗不该被触发（触发 = 某一步没 settle）').toBeNull();
  });

  it('B1-b 额外 rerender() 落在 FX 窗口里（devmode 解锁 / 控制条点击）⇒ 重入 0 次、仍走完档案', () => {
    const r = runRhythm({ fxMs: 2000, extra: (nav) => nav.rerender(), guard: GUARD_IN_MAIN });
    expect(r.reentry, 'FX 窗口内被重入（守卫失效）').toBe(0);
    expect(r.position).toBe(RHYTHM_FILE.actions.length);
    expect(r.drv.cursor().done).toBe(true);
  });

  it('B1-c 控制条 setRate(4) 落在 FX 窗口里 ⇒ 0 次（T2 侧只记 rate、不排 tick + 宿主守卫）', () => {
    const r = runRhythm({ fxMs: 2000, extra: (nav) => nav.setRate(4), guard: GUARD_IN_MAIN });
    expect(r.reentry, 'setRate 在 FX 窗口里排了 tick（T2 的不变式 + 宿主守卫都该挡住它）').toBe(0);
    expect(r.position).toBe(RHYTHM_FILE.actions.length);
  });

  it('B1-d 控制条 pause→play 落在 FX 窗口里 ⇒ 0 次（本轮补充：忙时不直接 play，只记待办）', () => {
    const r = runRhythm({ fxMs: 2000, extra: (nav) => { nav.pause(); nav.play(); }, guard: GUARD_IN_MAIN && RESUME_IN_MAIN });
    expect(r.reentry, 'FX 窗口内按「继续」把下一步提前排出来了（S4）').toBe(0);
    expect(r.rejectedRefresh, '也不该出现"被挡回的 refresh"').toBe(0);
    expect(r.position, '按过继续之后必须仍然走完档案（不能因为延后 play 而停住）').toBe(RHYTHM_FILE.actions.length);
    expect(r.drv.cursor().done).toBe(true);
  });

  it('B1-e 最坏形态：**每一步**的 FX 窗口里都被额外调用一次 ⇒ 仍然 0 次', () => {
    const r = runRhythm({ fxMs: 2000, extra: (nav) => nav.rerender(), every: true, guard: GUARD_IN_MAIN });
    expect(r.reentry, '每一步都注入也必须 0 次（守卫是按"本步 FX 是否播完"判的）').toBe(0);
    expect(r.position).toBe(RHYTHM_FILE.actions.length);
  });

  it('B1-f 精确形态：只在"下一条是 refresh"那一步的 FX 里额外调用 ⇒ 不再被挡回、不再停在半路', () => {
    const at = RHYTHM_FILE.actions.findIndex((a) => a.kind === 'refresh');
    expect(at, '找不到 refresh 那一步').toBeGreaterThanOrEqual(0);
    const r = runRhythm({ fxMs: 2000, extra: (nav) => nav.rerender(), extraAtStep: at, guard: GUARD_IN_MAIN });
    expect(r.rejectedRefresh, 'refresh 不该再被 drawAnimBusy 挡回（一审 S6 的形态）').toBe(0);
    expect(r.position, '必须走完档案（一审 S6 停在 15/24）').toBe(RHYTHM_FILE.actions.length);
  });

  it('B1-g 控制条「单步」落在 FX 窗口里 ⇒ 0 次重入、0 次误挡（同族第三条路径）', () => {
    // 单步的语义是 D8 的"无视倍速走一步、且走完仍停在暂停态" ⇒ 这里只断言"不踩 FX 窗口"：
    // 重入 0、没有 refresh 被误挡（后者正是"FX 中被立刻走一步"会造成的假停机诊断）。
    const r = runRhythm({ fxMs: 2000, extra: (nav) => nav.next(), guard: GUARD_IN_MAIN && STEP_DEFER_IN_MAIN });
    expect(r.reentry, 'FX 窗口内按「单步」把下一步提前走了').toBe(0);
    expect(r.rejectedRefresh, '也不该出现"被挡回的 refresh"（那会误报停机诊断）').toBe(0);
    expect(r.position, '单步之后仍然真的走了一步').toBeGreaterThan(0);
    expect(r.drv.cursor().done, '单步之后应停在暂停态（D8），不是一路播完').toBe(false);
  });

  it('反控（判据不恒真）：去掉两个守卫 = 一审的旧形态 ⇒ 重入 > 0 次、S6/S4 形态都会踩乱', () => {
    const plain = runRhythm({ fxMs: 2000, guard: false, extra: (nav) => nav.rerender() });
    expect(plain.reentry, '去掉守卫后必须能量到"FX 窗口内被重入"').toBeGreaterThan(0);
    const at = RHYTHM_FILE.actions.findIndex((a) => a.kind === 'refresh');
    const s6 = runRhythm({ fxMs: 2000, guard: false, extra: (nav) => nav.rerender(), extraAtStep: at });
    expect(s6.rejectedRefresh, '旧形态必须复现"refresh 被挡回"').toBeGreaterThan(0);
    expect(s6.position, '旧形态必须复现"停在那一步"').toBeLessThan(RHYTHM_FILE.actions.length);
    const s4 = runRhythm({ fxMs: 2000, guard: false, extra: (nav) => { nav.pause(); nav.play(); } });
    expect(s4.reentry, '旧形态下 pause→play 也会在 FX 窗口里被重入（S4）').toBeGreaterThan(0);
    const s7 = runRhythm({ fxMs: 2000, guard: false, extra: (nav) => nav.next() });
    expect(s7.reentry, '旧形态下「单步」也会在 FX 窗口里被重入').toBeGreaterThan(0);
  });
});


