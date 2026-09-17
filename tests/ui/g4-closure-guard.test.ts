/**
 * G4 Task 7 守卫：`src/main.ts` 收口面的**跨模块归拢** + 两处**已知缺口**的补洞。
 *
 * ## 这个文件与 `tests/ui/main-driver-wiring.test.ts` 的分工（**不许重复写同一条腿**）
 *
 * G4 的收口腿散在两处，本文件把它们的**覆盖面**列成一张表（每条都指向真正的承重腿），
 * 然后只写**表里空着的那几条**：
 *
 * | 收口面 | 已有的承重腿（**不要在本文件里重复写**） |
 * |---|---|
 * | `main.ts` 内 `executeAction(` 零命中 | `main-driver-wiring.test.ts` 第 1 条（含正控） |
 * | `driver.submit(` **全部**落点分类 | 同上第 2 条（生成式列全部出现点 + 反空转 + 反控） |
 * | `renderApp(` 恰好 1 处 | 同上第 4 条；上界/下界原判据 = `net-preview-wiring.test.ts:72-101`（L1） |
 * | `settle()` 的唯一重排点 | 同上第 5 条（含"排在 `renderApp` 之后"的顺序判据） |
 * | 控制条刷新的唯一入口（第 16 条） | 同上第 5/16 条（源码判据 + DOM 桩行为腿） |
 * | 编排每条终止路径都汇到 `rerender()` | 同上第 5b 条（逐条分类 8 个 `return;`） |
 * | 进入/退出两侧的复位面（D11 四件套） | 同上第 6/7 条 |
 * | 重放期间关闭自动推进（D8） | 同上第 8 条 |
 * | 端到端对拍（第 19 条，真驱动 vs 档案重放） | 同上 §19 三组腿 |
 * | 重放节奏（B1/S4：FX 窗口内不许回话/不许提前开播） | 同上 §B1 八条 + 反控 |
 * | `src/app/**` 直呼定时器 | `tests/app/match-driver.test.ts` 判据 9（H 轮起含 3 种绕行写法） |
 *
 * ## 本文件补的是什么（三样，都是"删了就会让下一个人误判"的地方）
 *
 * 1. **FX 守卫的边界**：`if (!drawAnimBusy && !revealFlyBusy) replayDriver?.settle();` ——
 *    第 5 条腿只断言**整句文本存在**（B1 的守卫在不在）。**"两个忙标志各在不在"没有独立判据**
 *    ⇒ 只删掉半个条件（`&& !revealFlyBusy`）时，`toMatch(/if \(!drawAnimBusy && !revealFlyBusy\) \{/)`
 *    确实会红，但**反过来说不清是哪一半丢了**，而且"两个标志都要参与判定"这件事没有自己的腿。
 *    本文件按**标志名逐个**钉住，并在注释里写明这条守卫为什么是"两条各自独立"的。
 * 2. **`replayNav` 两个待办标志**：第 5 条腿钉的是"忙时把 `replayResumePending = true` /
 *    `replayStepPending = true` 写下来"，而这两个标志是**宿主侧**的跨帧状态 ⇒ 它们的
 *    **声明点与两个清零点**（`rerender` 里消费后清零、`resetToMainInterface` 里退出清零）
 *    各需要一条腿，否则"只加标志不清零"会让重放页在退出后带着一个永远为真的待办
 *    （下一次进重放虽然会再清一遍，但那是巧合，不是判据）。
 * 3. **判据 9 的三种漏检形态 + 一条消息措辞缺口**：见下面两个 describe。
 *
 * ## 为什么这里也是文本腿（本仓纪律：文本腿必须写明理由）
 *
 * 与 `main-driver-wiring.test.ts` 头注同一条理由：`src/main.ts` 是**应用入口**，一 import 就会
 * 跑起整个游戏（要真 DOM、真 body 级特效层、真 rAF），而本仓测试环境是 `node`、没有 jsdom
 * ⇒ "跑一次 `rerender()`"没有入口。**行为侧**由 B1 组与第 19 条的模型腿/DOM 桩腿覆盖。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { stripComments, functionBody, objectBody } from './source-text';
import { makeStubEl, queryAllIn } from './net-dom-stub';
import { renderReplayBar, type ReplayBarNav } from '../../src/ui/replay-bar';

const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url))).subarray(0, 8 * 1024 * 1024).toString('utf8');

const MAIN = stripComments(read('../../src/main.ts'));
const CB_HEAD = 'const cb: UiCallbacks = ';
const CB_BODY = objectBody(MAIN, CB_HEAD);
const ON_ACTION = memberBody(CB_BODY, 'onAction(a) {');

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
 * L1-L2. 收口两个零命中面（跨模块视角 = 整份 main.ts 的去注释文本）
 * ==================================================================== */

describe('G4 T7 · 收口面（跨模块归拢：`executeAction` 零命中 + `driver.submit(` 全落点）', () => {
  /**
   * 与 `main-driver-wiring.test.ts` 第 1 条**同一条不变式**，但**扫描面不同**：
   * 那里在 `describe('G4 T4 · 收口：动作只走 driver')` 里、与 `driver.submit(` 的分类同处一腿；
   * 这里独立成腿，是为了让"整份 `main.ts`（含 `cb` 之外的每一个函数）都不直呼引擎"这件事
   * 有一个**不会被误读成'只查了 cb.onAction'**的落点 —— 这是设计稿 §4.5 验收项 1 的原文要求
   * （"源码守卫测试"）。
   */
  it('L1. 整份 main.ts（去注释）里 `executeAction(` 零命中；正控证明扫描器不恒空', () => {
    const sites = occurrences(MAIN, 'executeAction(');
    expect(sites.length, `main.ts 里仍有直呼引擎的动作：\n${sites.join('\n')}`).toBe(0);
    expect(occurrences('const x = executeAction(s, 0, "advance");', 'executeAction(').length, '正控：扫描器对合成源码必须命中').toBe(1);
  });

  /**
   * **生成式落点表**：把每一个 `driver.submit(` 分类到 `cb.onAction` / `applyRearrangeSwap` 之外，
   * 并**打印出全部落点**（今天的正确答案是 8 处：`cb.onAction` 7 + `applyRearrangeSwap` 1）。
   *
   * 与 `main-driver-wiring.test.ts` 第 2 条的差别只有一点、但很重要：那里把"落点表"和
   * "落在外面的一律报红"合在一腿里；这里额外断言**两段各自的下界都来自真实计数**，
   * 并把 `driver.submit(` 的**总出现数**与两段之和**独立**比一次（防"分类器把一处算两遍"）。
   */
  it('L2. `driver.submit(` 的全部落点都在 `cb.onAction` 或 `applyRearrangeSwap` 内（生成式列全部）', () => {
    const swapBody = functionBody(MAIN, 'applyRearrangeSwap');
    const inAction = ON_ACTION.split('driver.submit(').length - 1;
    const inSwap = swapBody.split('driver.submit(').length - 1;
    const total = offsetsOf(MAIN, 'driver.submit(').length;
    expect(total, `main.ts 里 driver.submit( 出现 ${total} 处（cb.onAction ${inAction} + applyRearrangeSwap ${inSwap}）`).toBe(inAction + inSwap);
    const cbAt = MAIN.indexOf(CB_HEAD);
    const onAt = MAIN.indexOf(ON_ACTION);
    const swapAt = MAIN.indexOf(swapBody);
    expect(cbAt, '找不到 cb 的声明头').toBeGreaterThanOrEqual(0);
    expect(onAt, '找不到 cb.onAction 的函数体').toBeGreaterThanOrEqual(0);
    expect(swapAt, '找不到 applyRearrangeSwap 的函数体').toBeGreaterThanOrEqual(0);
    const onEnd = onAt + ON_ACTION.length;
    const swapEnd = swapAt + swapBody.length;
    const outside = offsetsOf(MAIN, 'driver.submit(').filter((i) => !(i >= onAt && i < onEnd) && !(i >= swapAt && i < swapEnd));
    expect(outside.map((i) => MAIN.slice(i, i + 48)), '有 driver.submit( 落在两个出口之外').toEqual([]);
    // 两段各自下界（反空转：少了任何一段，"分类"都可能是空的）
    expect(inAction, 'cb.onAction 里没有提交点 ⇒ 动作没走驱动').toBeGreaterThanOrEqual(7);
    expect(inSwap, 'applyRearrangeSwap 里没有提交点 ⇒ 重排旁路没收口').toBe(1);
    expect(occurrences(MAIN, 'driver.submit(').map((s) => s.replace(/\s+/g, ' ').slice(0, 96))).toHaveLength(8);
  });

  /**
   * **第 3 条（devmode 旁路未 `note()`）的现状钉住** —— 这条腿**故意钉住一个缺口**：
   * `main.ts`（去注释）里 `note(` **零命中**。它存在的理由不是"要求现在是错的"，
   * 而是：**将来给 `DevModeHost` 加上 `onBypass` → `driver.note` 时，这条腿会立刻变红**，
   * 逼着改它的人同时更新收口文档 §3 的缺口 1（"devmode 旁路未 note"）。这与本仓
   * "把已知残余如实钉成一条腿"的先例（`tests/ui/privacy-consumers.test.ts` 最后一条）同形。
   *
   * ⚠️ 它是**钉现状**，不是"要求"：注入过的对局不可忠实重放是**已登记的已知缺口**，
   * 承重注释在 `src/ui/devmode.ts:323`。
   */
  it('L3. 已知缺口 1 的现状：main.ts 里 `note(` 零命中（加 onBypass 时这条会红，提醒改文档）', () => {
    const sites = occurrences(MAIN, 'note(');
    expect(sites.length, `main.ts 里出现了 note(（若这是给 devmode 旁路补的留痕，请同时更新收口文档 §3 缺口 1）：\n${sites.join('\n')}`).toBe(0);
  });

  /**
   * 与 `main-driver-wiring.test.ts` 第 4 条**同一条不变式**（`renderApp(` 唯一入口）。
   * 独立成腿的理由：那条腿的标题是"rerender 里有 replay 分支"，`renderApp(` 计数只是它的
   * **附带**断言 ⇒ 只改坏计数、不动 replay 分支时，失败信息会指向"replay 分支"（误导）。
   */
  it('L4. `renderApp(` 在整份 main.ts 里仍恰好 1 处（唯一入口的牙；正控证明计数不恒 1）', () => {
    const sites = occurrences(MAIN, 'renderApp(');
    expect(sites.length, `renderApp( 出现 ${sites.length} 处（上限 = 1）：\n${sites.join('\n')}`).toBe(1);
    expect(occurrences('a();\nrenderApp(root, s, cb);\nb();', 'renderApp(').length, '正控：单处必须数成 1（扫描器不恒 1、也不恒 0）').toBe(1);
    expect(occurrences('renderApp(a);\nrenderApp(b);', 'renderApp(').length, '正控：两处必须数成 2').toBe(2);
  });
});

/* ==================================================================== *
 * L5-L6. FX 守卫的两半 + replayNav 两个待办标志的声明/消费/清零
 * ==================================================================== */

describe('G4 T7 · FX 守卫与两个待办标志（第 5 条腿只钉了整句，这里逐半钉）', () => {
  /** `rerender` 里 FX 守卫块（花括号配平，含守卫头与三个互斥分支） */
  function guardBlock(): string {
    const body = functionBody(MAIN, 'rerender');
    const at = body.indexOf('if (!drawAnimBusy && !revealFlyBusy) {');
    if (at < 0) throw new Error('rerender 里找不到 FX 守卫块（B1 的守卫被删/改写？）');
    return braceBody(body, body.indexOf('{', at));
  }

  /**
   * ★ **两个忙标志各自独立参与判定**（B1 的根因就是它们是**单布尔**、由较早结束的回调清掉
   * ⇒ 少守一个就会出现"第三条动画叠上"）。`toMatch` 整句只能证明"这句话在"，
   * 数不清"两个名字都真的被读了"。这里按名字逐个钉，并且**两半必须都在同一个守卫头里**。
   */
  it('L5. FX 守卫头里 `drawAnimBusy` 与 `revealFlyBusy` 各自都在、且都是取反形态', () => {
    const body = functionBody(MAIN, 'rerender');
    const head = body.slice(body.indexOf('if (!drawAnimBusy && !revealFlyBusy) {'), body.indexOf('if (!drawAnimBusy && !revealFlyBusy) {') + 60);
    expect(head, '守卫头本体').toContain('!drawAnimBusy');
    expect(head, '守卫头丢了 `!drawAnimBusy`（抽牌动画期间会提前回话 ⇒ B1 复现）').toContain('!revealFlyBusy');
    // 反空转：整份 main.ts 里这两个标志必须**各自**被读过至少两次（守卫头 + FX 完成回调的判断）
    expect(occurrences(MAIN, 'drawAnimBusy').length, 'drawAnimBusy 的出现处数').toBeGreaterThanOrEqual(2);
    expect(occurrences(MAIN, 'revealFlyBusy').length, 'revealFlyBusy 的出现处数').toBeGreaterThanOrEqual(2);
    // 守卫块里 settle 是**唯一**的回话点，且它只在"两个都不忙"的 else 分支里
    expect(guardBlock(), '守卫块里没有 settle()（B1 的守卫被架空）').toMatch(/replayDriver\?\.settle\(\);/);
    expect(guardBlock(), '守卫块里没有「单步」待办分支').toMatch(/if \(replayStepPending\) \{/);
    expect(guardBlock(), '守卫块里没有「继续」待办分支').toMatch(/\} else if \(replayResumePending\) \{/);
  });

  /**
   * 两个待办标志的**声明 + 写入 + 消费后清零 + 退出清零**四个面。
   *
   * 为什么必须四个面都有腿：它们是**跨帧**状态（`replayNav` 写、下一帧的 `rerender` 读）。
   * 只写不清 ⇒ "退出重放后仍欠一次开播"；只在进入时清、退出不清 ⇒ 依赖下一条路径顺手清。
   */
  it('L6. `replayResumePending` / `replayStepPending`：声明、忙时写入、消费后清零、退出清零', () => {
    // ① 声明（模块级 `let`，初值 false）
    for (const name of ['replayResumePending', 'replayStepPending']) {
      expect(MAIN, `${name} 的声明不是模块级 let（跨帧状态被改成别的作用域？）`).toMatch(new RegExp(`^let ${name} = false;$`, 'm'));
    }
    // ② 忙时写入（replayNav 的 play / next）—— 与 `main-driver-wiring` 第 5 条同一条不变式的**独立**表述
    const nav = functionBody(MAIN, 'replayNav');
    expect(nav, 'replayNav 里没有"忙时记继续待办"').toMatch(/if \(drawAnimBusy \|\| revealFlyBusy\) \{[\s\S]{0,160}replayResumePending = true;/);
    expect(nav, 'replayNav 里没有"忙时记单步待办"').toMatch(/if \(drawAnimBusy \|\| revealFlyBusy\) replayStepPending = true;/);
    // ③ 消费后清零：rerender 的守卫块里，两个待办各自被清零一次
    const guard = guardBlock();
    expect(guard, '「单步」待办消费后没清零（会每帧都再走一步）').toMatch(/replayStepPending = false;/);
    expect(guard, '「继续」待办消费后没清零（会每帧都重排一次 tick）').toMatch(/replayResumePending = false;/);
    // ④ 退出清零：`resetToMainInterface` 与 `startReplayFile` 两侧都要清（第四份跨页状态）
    for (const fn of ['resetToMainInterface', 'startReplayFile']) {
      const body = functionBody(MAIN, fn);
      expect(body, `${fn} 没清 replayResumePending`).toMatch(/replayResumePending = false;/);
      expect(body, `${fn} 没清 replayStepPending`).toMatch(/replayStepPending = false;/);
    }
  });

  /**
   * 第 16 条的**行为侧**（T3 一审第 5 条的契约风险）已在
   * `main-driver-wiring.test.ts` 第 16 条用 DOM 桩跑过（连点暂停/倍速 ⇒ bar/shield 各仍一个，
   * 且**配了"不清 parent 就叠两个"的反控**）。这里只补一件文本面的事实：
   * `refreshReplayBar` 的定义体里**不许**出现 `rerender(`（刷新函数不得反过来触发整帧重画，
   * 那会变成"每次刷新再刷新一次"的递归）。
   */
  it('L7. `refreshReplayBar` 只装配、不重渲染（定义体里不许出现 `rerender(`）', () => {
    const body = functionBody(MAIN, 'refreshReplayBar');
    expect(body, 'refreshReplayBar 里出现了 rerender(（刷新 → 重渲染 → 再刷新的递归）').not.toContain('rerender(');
    expect(body, 'refreshReplayBar 没接装配函数').toContain('renderReplayBar(');
    // 行为侧：装配两次（模拟两帧）后，parent 里 bar/shield 各恰好一个（前提是每帧清了 parent）
    const parent = makeStubEl('div');
    (parent as unknown as { ownerDocument: { createElement(t: string): unknown } }).ownerDocument = {
      createElement: (t: string) => makeStubEl(t),
    };
    const nav: ReplayBarNav = { pause: () => {}, play: () => {}, next: () => {}, setRate: () => {}, exit: () => {} };
    const frame = (position: number): void => {
      (parent as unknown as { textContent: string }).textContent = '';
      renderReplayBar(parent as unknown as HTMLElement, { position, total: 47, rate: 1, paused: false, done: false }, nav);
    };
    frame(3);
    frame(9);
    expect(queryAllIn(parent, '[data-role="replay-bar"]').length, '两帧之后 bar 的个数').toBe(1);
    expect(queryAllIn(parent, '[data-role="replay-shield"]').length, '两帧之后 shield 的个数').toBe(1);
    const prog = queryAllIn(parent, '[data-role="replay-progress"]');
    expect(prog.length).toBe(1);
    expect(prog[0].text, '第二帧必须显示第二帧的位置（不是第一帧的残留）').toBe('9 / 47');
  });
});

/* ==================================================================== *
 * T7-a. 判据 9 的**别名形态**补洞（`const f = setTimeout;`）
 * ==================================================================== */

/**
 * ## 这条腿补的是哪一半，以及**为什么拆成两个正则**
 *
 * T2 的判据 9（`tests/app/match-driver.test.ts`）判的是"**调用形态**"，H 轮已覆盖四种绕行
 * （`window.setTimeout(` / `globalThis["setTimeout"](` / `(setTimeout)(` / 以及裸名）。
 * T2 收口的复验另登记了**三种仍漏检**的形态（实测 0 命中）：
 *   ① `setTimeout<T>(`、② `setTimeout?.call(`、③ `const f = setTimeout;`。
 *
 * 本任务对三者的处置（判据按**事实**分开写，而不是把三种塞进一条"看起来覆盖了"的正则）：
 *   - **①② 已并入调用正则**（`tests/app/match-driver.test.ts` 的 `TIMER_CALL`）：它们是
 *     "同一个调用的另一种写法"（泛型实参 / 可选链间接调用），够得着 ⇒ 该修而不是该记；
 *   - **③ 不能与①②混为一谈**：它**根本没有调用** —— 它是一次**别名赋值**，"调用"这个概念
 *     够不着它（本仓已栽过一次同族事故：`if (false)` 包住原代码同时满足"锚点唯一 + 摘要变化"，
 *     语义却完全没变 ⇒ 见 G4 方法学教训第 9 条）。⇒ 单列一条**别名赋值形态**的腿。
 *
 * ## 别名腿的**已知边界**（如实登记，不假装覆盖）
 *
 * 它只抓"**一行内**把裸定时器名赋给一个变量"这一种别名。仍**漏检**的形态（都要求控制流/多行
 * 绑定分析，正则做不到）：
 *   · 跨行拆分（`const f =\n  setTimeout;` 这种**反引号/注释切行**之外的换行）；
 *   · 解构别名、`let f; f = setTimeout;` 的两段式；
 *   · `const g = f;`（别名链）；
 *   · 通过对象属性传递（`const api = { t: setTimeout }`）。
 * ⇒ 与本波对判据 9 的结论一致：**"`src/app/**` 里一个定时器都不许出现"是纪律，不是有腿兜着**。
 */
describe('G4 T7 · 判据 9 的别名形态（`const f = setTimeout;`）——补第三种漏检', () => {
  /** **调用形态**（与 `match-driver.test.ts` 的 `TIMER_CALL` 同口径；这里只写"别名不会被它误抓"）
   *  ⚠️ **两份正则是同一条判据的两个副本**（一个扫 `src/app/**`、一个只做形态自证）。
   *  本仓对"手写副本"的纪律是"必须有一条腿证明两份一致"——否则其中一份漂移会静默失效
   *  （`tests/ui/source-text.ts:1-12` 的 `stripComments` 就是这个教训）。下面那条腿里
   *  `TIMER_CALL_SRC` 的比对就是这条一致性腿：从**生产腿文件**里把它的正则**源码**读出来，
   *  与这里的源码串逐字比较。 */
  const TIMER_CALL_SRC =
    `(?<![\\w$.])(?:` +
    `(?:(?:window|globalThis|self|global|frames)\\s*\\.\\s*)?(?:setTimeout|setInterval|requestAnimationFrame)` +
    `|(?:window|globalThis|self|global|frames)\\s*\\[\\s*['"](?:setTimeout|setInterval|requestAnimationFrame)['"]\\s*\\]` +
    `|\\[\\s*['"](?:setTimeout|setInterval|requestAnimationFrame)['"]\\s*\\]` +
    `|\\(\\s*(?:setTimeout|setInterval|requestAnimationFrame)\\s*\\)` +
    `)\\s*(?:\\??\\.\\s*(?:call|apply)\\s*)?(?:<[^<>()]*>\\s*)?\\(\\s*(?!\\w+\\s*:)`;
  const TIMER_CALL = new RegExp(TIMER_CALL_SRC, 'g');

  /**
   * **别名赋值形态**：`[const|let|var] NAME = [宿主全局.]定时器名;`
   *
   * 两个刻意的选择：
   *  - **接收者只认宿主全局或缺省**（`window.` / `globalThis.` / `self.` / `global.` / `frames.`
   *    或无前缀）。⇒ `const f = obj.setTimeout;` **不命中** —— 那正是本仓注入面自己的写法
   *    （`ticker.schedule(...)`），把它算违例会**假红**（判据 9 的调用腿早就踩过这一个坑）。
   *    代价如实记：`const f = someObj.setTimeout;` 这种"从别处借来定时器"的形态漏检 ——
   *    但那已经不是"直呼定时器"，而是"注入了定时器"，语义上本就允许。
   *  - **必须在一行内**（`\s*` 不跨行）：跨行拆分留给纪律（见上面头注的边界清单）。
   */
  const TIMER_ALIAS = new RegExp(
    `(?:const|let|var)\\s+\\w+\\s*=\\s*(?:(?:window|globalThis|self|global|frames)\\s*\\.\\s*)?` +
      `(?:setTimeout|setInterval|requestAnimationFrame)\\s*;`,
    'g',
  );

  const APP_DIR = fileURLToPath(new URL('../../src/app/', import.meta.url));

  it('两个正则的**形态边界**（正控 + 反控双向）：三种漏检形态里 ①② 归调用、③ 归别名', () => {
    // ① 泛型实参 + 可选链间接调用 ⇒ 由**调用**正则抓（判据 9 已并入）
    for (const s of ['setTimeout<number>(fn, 1);', 'window.setTimeout<T>(fn, 1);', 'setTimeout?.call(null, fn, 1);', 'globalThis.setTimeout?.apply(null, [fn, 1]);']) {
      expect([...s.matchAll(TIMER_CALL)].length, `调用正则漏了：${s}`).toBe(1);
      expect([...s.matchAll(TIMER_ALIAS)].length, `别名正则不该抓调用形态：${s}`).toBe(0);
    }
    // ③ 别名赋值 ⇒ 由**别名**正则抓
    for (const s of ['const f = setTimeout;', 'let g = window.setTimeout;', 'var h = globalThis.setInterval;', 'const r = requestAnimationFrame;']) {
      expect([...s.matchAll(TIMER_ALIAS)].length, `别名正则漏了：${s}`).toBe(1);
      expect([...s.matchAll(TIMER_CALL)].length, `调用正则不该抓别名赋值：${s}`).toBe(0);
    }
    // 反控（假红方向）：注入面自己的写法与普通变量都不许被抓
    for (const s of [
      'const h = ticker.schedule(fn, 10);',
      'const f = obj.setTimeout;',
      'type X = { setTimeout(fn: () => void, ms: number): number };',
      'const s = "setTimeout";',
      'const n = 1;',
      '// const f = setTimeout;',
    ]) {
      const code = stripComments(s);
      expect([...code.matchAll(TIMER_ALIAS)].length + [...code.matchAll(TIMER_CALL)].length, `假红方向：${s}`).toBe(0);
    }
    // ★ **两份副本一致性腿**：把生产腿文件里那条正则的**模板串内容**读出来，与这里的源码串比较。
    //   （两份手写副本是本仓反复栽过的形态；这里不靠纪律，靠这条腿。）
    //   两步归一化，各有理由：
    //    ① **取模板串内容**而不是整段源码 —— 那段源码里有**注释**（注释里也有反引号包裹的例子）；
    //    ② **去掉一个反斜杠** —— 模板串里的 `\\s` 是**两个字符**，而本文件用普通字符串写 `'\\s'`
    //       得到的是**一个**反斜杠；不归一化会因"转义写法不同"假红（判据要判表达式一样，不是排版一样）。
    const driver = read('../app/match-driver.test.ts');
    const at = driver.indexOf('const TIMER_CALL = new RegExp(');
    expect(at, 'match-driver.test.ts 里找不到 TIMER_CALL 的声明（这条一致性腿的前提）').toBeGreaterThanOrEqual(0);
    const body = driver.slice(driver.indexOf('new RegExp(', at), driver.indexOf("'g',", at));
    const parts = [...body.matchAll(/^[ \t]*`([^`]*)`/gm)].map((m) => m[1]);
    expect(parts.length, '没能从生产腿里取出正则片段（拼接写法被改成了别的形态？）').toBeGreaterThanOrEqual(2);
    const norm = (s: string): string => s.replace(/\\\\/g, '\\');
    expect(norm(parts.join('')), 'match-driver.test.ts 的 TIMER_CALL 正则源码与本文件漂移了（两份副本必须一致）').toBe(TIMER_CALL_SRC);
  });

  it('生成式扫 `src/app/**`（剥注释）⇒ 别名形态零命中；锚点证明这条判据本身能红', () => {
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (p.endsWith('.ts')) files.push(p);
      }
    };
    walk(APP_DIR);
    expect(files.length, `src/app 下只扫到 ${files.length} 个 .ts（路径写错/目录被清空？）`).toBeGreaterThanOrEqual(7);
    const hits: string[] = [];
    for (const p of files.sort()) {
      const code = stripComments(readFileSync(p).subarray(0, 4 * 1024 * 1024).toString('utf8'));
      for (const m of code.matchAll(TIMER_ALIAS)) hits.push(`${p.slice(APP_DIR.length)}: ${m[0].trim()}`);
    }
    expect(hits, `src/app 里出现定时器别名赋值（必须走注入的 Ticker）：\n${hits.join('\n')}`).toEqual([]);
    // 正控：同一条扫描路径喂一段合成源码必须报出命中（否则上面那条在空数组上恒真）
    const synth = stripComments('const f = setTimeout;\n');
    expect([...synth.matchAll(TIMER_ALIAS)].length, '正控：合成源码里的别名赋值没被抓到').toBe(1);
  });
});

/* ==================================================================== *
 * T7-b. 一条**已被证伪的说法**不许回到断言消息里（T2 判据 4 的措辞缺口）
 * ==================================================================== */

/**
 * ## 这条腿守的是一条**措辞纪律**，不是功能
 *
 * T2 判据 4 的复验实测把"说法 A"证伪了（评审的变异 G1：只把 `isSameSubmit` 左边换成调用方
 * args 的 JSON 深拷贝、引擎仍吃 `rec` ⇒ **20 条生产腿一条都不红**）⇒
 * **"应用记录里的 args 而不是调用方给的 args"在 D12 闸门下不可独立观测**：
 * args 值不同 ⇒ 门先拒（引擎根本不被调用）；值相同 ⇒ 无可观测差异。
 *
 * 但断言**消息**仍写着"引擎必须吃记录里的 args（不是调用方对象）"（弱化版的说法 A）。
 * 消息是**下一个人读代码时唯一的解释**：留着它，下一次做变异的人会按这句话去构造
 * "引擎吃调用方对象"的变异，然后在**全绿**的读数上得出"这条腿没牙"的错误结论 ——
 * 而那正是 G4 方法学教训第 2 条（"注释里宣称的实测依据必须与代码逐字相符，归因错了比没有
 * 注释更坏"）说的同一件事。
 *
 * ⇒ 本任务把消息改成**说法 B**（"引擎收到的是门规范化出来的那份（调用方对象未被读第二次）"），
 * 并用下面这条腿把它钉住。**这条腿本身没有行为副作用**（它只读测试文件的文本），如实声明：
 * 它守的是"文档/措辞不许回退"，价值在**下一个人**身上，不在运行时。
 */
describe('G4 T7 · 断言消息不许回退到已被证伪的"说法 A"（T2 判据 4）', () => {
  const DRIVER_TEST = read('../app/match-driver.test.ts');

  it('判据 4 的断言消息是说法 B；说法 A 的措辞在整份文件里零命中', () => {
    // ⚠️ **这两条常量必须拼出来，不能写成整句字面量**：本文件的正文里若出现与判据完全相同的
    //    整句，就会让"注入这句话"这类变异命中**本文件自己的常量**（实测过一次：变异把正控常量
    //    与被判文件里的消息同时改掉 ⇒ 正控把被测对象也一起换了，判据看起来全绿）。
    //    拼出来的常量在**源码文本**层面不与任何整句相同 ⇒ 变异只能改到 `match-driver.test.ts`。
    const correct = ['引擎收到的是门规范化出来的那份', '（调用方对象未被读第二次）'].join('');
    const disproven = ['引擎必须吃记录里的 args', '（不是调用方对象）'].join('');
    // 说法 B（应当存在，且**恰好一处** —— 就是那条断言）
    expect(DRIVER_TEST.split(correct).length - 1, `说法 B 的消息出现处数（应为 1：判据 4 那条断言）`).toBe(1);
    // 说法 A（**不许**回来）：H 轮复验建议替换掉的原句
    const sites: string[] = [];
    DRIVER_TEST.split('\n').forEach((line, i) => {
      if (line.includes(disproven)) sites.push(`tests/app/match-driver.test.ts:${i + 1}: ${line.trim()}`);
    });
    expect(sites, `已被证伪的"说法 A"回到了断言消息里（下一个人会按它构造无效变异）：\n${sites.join('\n')}`).toEqual([]);
    // 反控（这条判据不恒真）：把说法 B 的消息换回说法 A ⇒ 上面的扫描器必须报出那一行
    const regressed = DRIVER_TEST.replace(correct, disproven);
    expect(regressed, '反控构造失败：替换没生效').not.toBe(DRIVER_TEST);
    expect(regressed.includes(disproven), '反控：替换后必须能命中说法 A').toBe(true);
    expect(regressed.includes(correct), '反控：替换后说法 B 必须消失').toBe(false);
  });
});
