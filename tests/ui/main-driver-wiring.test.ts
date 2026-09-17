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
  setupFromState,
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

  it('5. settle 的唯一重排点：rerender 的 replay 分支里、renderApp 之后那一次；且控制条刷新也只在那一处', () => {
    const body = functionBody(MAIN, 'rerender');
    // 整个 main.ts 里 settle( 只许出现一次（唯一重排点）
    const settles = occurrences(MAIN, '.settle()');
    expect(settles.length, `main.ts 里 settle() 出现 ${settles.length} 处（唯一重排点应当在 rerender 的 replay 分支里）：\n${settles.join('\n')}`).toBe(1);
    expect(body, 'settle() 不在 rerender 体内').toMatch(/replayDriver\?\.settle\(\);/);
    const iRender = body.indexOf('renderApp(root, state, cb)');
    const iSettle = body.indexOf('replayDriver?.settle()');
    expect(iSettle, 'settle() 排在 renderApp 之前（编排还没画完这一帧就把下一步排出来了）').toBeGreaterThan(iRender);
    // 控制条：`renderReplayBar(` 只在装配函数里出现一次，而它的**调用**（refreshReplayBar）只在 rerender 里
    expect(occurrences(MAIN, 'renderReplayBar(').length, 'renderReplayBar( 的出现处数').toBe(1);
    // ⚠️ 计数用**带分号的调用形态**：`function refreshReplayBar(): void {` 里也含
    //    `refreshReplayBar()` 这个子串（定义头），不带分号会把定义当成第二个调用点
    expect(occurrences(MAIN, 'refreshReplayBar();').length, 'refreshReplayBar(); 只许有一个调用点（T3 一审第 5 条）').toBe(1);
    expect(occurrences(MAIN, 'function refreshReplayBar(').length, 'refreshReplayBar 的定义数').toBe(1);
    expect(body, 'refreshReplayBar() 不在 rerender 体内（会叠出第二层遮罩）').toContain('refreshReplayBar();');
    expect(body.indexOf('refreshReplayBar();'), '控制条刷新必须排在 renderApp 之后').toBeGreaterThan(iRender);
    // 反过来：控制条的回调里**不许**自己刷新（那是"不以整帧 renderApp 为前置"的路径）
    const nav = functionBody(MAIN, 'replayNav');
    expect(nav, 'replayNav 里出现了 refreshReplayBar / renderReplayBar（会叠出第二层遮罩）')
      .not.toMatch(/refreshReplayBar|renderReplayBar\(/);
    for (const m of ['pause', 'play', 'setRate']) {
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

  it('导出 meta 的装配面（T4 第 11 条）：seed/setup/昵称/指纹/createdAt 各来自哪里', () => {
    const meta = functionBody(MAIN, 'matchFileMeta');
    expect(meta, 'seed 必须来自本局状态（重放全靠它）').toMatch(/seed:\s*s\.rng\.seed/);
    expect(meta, 'setup 必须走 setupFromState（草稿两条序列的唯一抽取点）').toMatch(/setup:\s*setupFromState\(s\)/);
    expect(meta, '昵称必须来自 L1（不许自己编）').toMatch(/readNickName\(localStore\)/);
    expect(meta, '卡牌指纹必须写进 meta').toMatch(/cardDataHash:\s*CARD_DATA_HASH/);
    // `createdAt` 由 **UI 层**读时钟（`src/app` 不许读时钟 —— tests/app-purity.test.ts 有守卫）
    expect(meta, 'createdAt 必须由 UI 层读时钟').toMatch(/createdAt:\s*new Date\(\)\.toISOString\(\)/);
    const build = functionBody(MAIN, 'buildSessionArchive');
    expect(build, '会话里没有对局记录时必须**如实返回理由**，不许退化成导一份空档案').toMatch(/return \{ reason:/);
    expect(build, 'buildSessionArchive 没接记录器').toMatch(/rec\.toMatchFile\(matchFileMeta\(state\)\)/);
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
