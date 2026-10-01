import { afterEach, describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { stripComments, functionBody, objectBody, braceBlock } from './source-text';
import { descendants, installStubDom, isClass, makeStubEl, type StubNode } from './net-dom-stub';
import { renderModeSelect, type ModeSelectNav } from '../../src/ui/home';

/**
 * G2 Task 4 守卫：**接线**（`src/main.ts` 的页面路由 + 预览入口 + 重置）与**契约配套**。
 *
 * 为什么这个文件单独存在（而不是并进 `render-net.test.ts`）：`render-net.test.ts` 守的是
 * **渲染器自己**（`src/ui/render-net.ts` 的内部结构）；本文件守的是**宿主接线** ——
 * `main.ts` 有没有真的把远程页画出来、有没有提供 `cb.rerender`、预览模式会不会泄漏到热座。
 * 这两类断言的失效形态完全不同：渲染器可以完全正确，而接线漏一行 → **远程页一次都不会被执行**
 * （G2 Task 3 的 700+ 行改动就是这样：JS 产物内容哈希一字未动，因为它没有任何生产代码 import）。
 *
 * ## ⚠️ 本文件的固有限度（不要把它读成"运行时已验证"）
 * 全部断言都是**源码文本**判据：它们能证明"路由函数存在、调用点改对了、顺序对"，
 * **证明不了**运行时真的路由对了 —— 例如 `rerender()` 里 `state.phase` 的实际取值、
 * `renderNetBoard` 在真实 DOM 上是否真的挂上了钩子。真正的兜底是：
 *   1. 用户在 5173 上做 G2 验收清单（`.superpowers/sdd/G2-acceptance-checklist.md`，F1~F15）；
 *   2. 预览页工具条上的**运行时自查行**（`.net-verify-note`，由 `verifyHooks: true` 驱动）。
 * 本文件**不能**替代其中任何一条。
 */

const root = new URL('../../', import.meta.url);
const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, root))).subarray(0, 8 * 1024 * 1024).toString('utf8');

/** `main.ts` 的去注释源码：判据不该被注释里的同名文本满足（本项目已栽过三次）。 */
const mainSrc = (): string => stripComments(read('src/main.ts'));

/**
 * `cb` 对象字面量的声明头（`source-text.objectBody` 用它抽整段）。
 * 与 `tests/ui/local-data-screen.test.ts` 的 `CB_HEAD` 同字面量 —— 两处都指向**同一个**声明。
 */
const CB_HEAD = 'const cb: UiCallbacks = ';

/**
 * `functionBody`（**花括号配平**的函数体提取）已移到 `./source-text` 共用。
 *
 * ⚠️ **G2 Task 4F · M-1 的教训**：原先它是本文件的局部实现，只被**部分**断言使用；
 * 第 3 条的反向判据（"`rerender` 里有 `renderApp` 回退分支"）当时写成对**整份 `main.ts`**
 * 的 `toMatch` —— 于是删掉 `rerender()` 里的回退分支后，断言仍被 **devmode 那处** `renderApp(`
 * 满足，8/8 全绿（终审变异 M4 实测）。**凡是"某个函数必须做 X"的断言，判据面必须是那个函数的
 * 函数体，不是整份文件。** 本文件从 4F 起统一用共用的 `functionBody`。
 */

/** 某个 token 在源码里的全部出现（1-based 行号 + 该行 trim 后的内容），供失败信息指名道姓 */
function occurrences(src: string, token: string): string[] {
  const out: string[] = [];
  src.split('\n').forEach((line, i) => {
    if (line.includes(token)) out.push(`src/main.ts:${i + 1}: ${line.trim()}`);
  });
  return out;
}

describe('G2 Task 4 · 接线：远程页进入产物 + 重渲染路由唯一入口', () => {
  it('1. main.ts 从 render-net 引入 renderNetBoard 与 resetNetUiState（**本页第一次进入产物**）', () => {
    const code = mainSrc();
    // 行内 import 与多行 import 都接受：钉的是"这两个出口被引入"，不是排版
    expect(code, 'main.ts 未 import renderNetBoard（远程页不会进入 JS 产物，build 那道门对它永远是瞎的）')
      .toMatch(/\brenderNetBoard\b/);
    expect(code, 'main.ts 未 import resetNetUiState（重置时远程页模块态会跨局残留）')
      .toMatch(/\bresetNetUiState\b/);
    expect(code, 'main.ts 不是从 ./ui/render-net 引入的（可能引入到了别的模块）')
      .toMatch(/from\s+'\.\/ui\/render-net'/);
    // 两个名字都要真的出现在 import 列表里（`from './ui/render-net'` 单独存在是不够的）
    const importStmts = code.split('\n').filter((l) => l.includes("from './ui/render-net'"));
    expect(importStmts.length, 'main.ts 里没有指向 ./ui/render-net 的 import 语句').toBe(1);
  });

  it('2. main.ts 引入 styles-net.css（远程页样式必须随产物加载，否则布局是"没样式的一坨"）', () => {
    const code = mainSrc();
    expect(code, "main.ts 未 import './ui/styles-net.css'").toMatch(/import\s+'\.\/ui\/styles-net\.css'/);
    // styles.css 也必须在（热座页样式；两条 import 并存，不得被替换掉）
    expect(code, "main.ts 未 import './ui/styles.css'（热座样式被顶掉了？）").toMatch(/import\s+'\.\/ui\/styles\.css'/);
  });

  it('3. main.ts 定义 rerender()，且裸 renderApp( 的出现次数降到 1 处（每处都列出来）', () => {
    const code = mainSrc();
    expect(code, 'main.ts 未定义 rerender（页面路由的唯一入口）').toMatch(/\bfunction rerender\(\)/);
    const sites = occurrences(code, 'renderApp(');
    /**
     * 上限 = **1**，且就是 `rerender()` 自己体内那一处。为什么只能是 1（G2 Task 4F 收紧）：
     *   - 它是"回退到热座页"的**唯一**分支，删掉它热座模式就渲染不出任何东西；
     *   - Task 4 曾**例外保留** `initDevMode({ …, render: () => renderApp(root, state, cb) })`，
     *     4F 按终审 D-2 改成 `render()` 走 `rerender()`：热座下逐字等价，而远程页下不再把页面
     *     画回热座棋盘。于是 `main.ts` 里 `renderApp(` 只剩这一处 —— "唯一入口"这句话现在
     *     在**代码位**上也是真的（不再有第二个调用点）。
     *
     * ⚠️ **M-1（终审变异 M4）：这条断言必须按函数体判定，不能按整份文件。**
     * 4F 之前的写法是「整份 `main.ts` 的 `toMatch(/renderApp\(root,\s*state,\s*cb\)/)`」——
     * 它被 **devmode 那处**满足，所以删掉 `rerender()` 里的回退分支后**仍然全绿**（8/8）。
     * 现在：判据面 = `functionBody(code, 'rerender')`，且出现次数上界 = 1。
     * 变异实测（删掉回退分支）→ 本文件第 3 条立刻红（见报告 §1 的 M-1 记录）。
     *
     * ⚠️ 计数用的是**去注释后**的源码（`mainSrc()`）：`rerender()` 的 JSDoc 与 devmode 那处
     * 注释里为可读性写着 `renderApp(root, state, cb)`，按裸源码计数会得到 3 处而误报。
     */
    expect(sites.length, `main.ts 里 renderApp( 出现 ${sites.length} 处（上限 1：只允许 rerender 的回退分支）：\n`
      + sites.join('\n')).toBeLessThanOrEqual(1);
    // 反向：那 1 处必须在 `rerender` 的函数体内（否则说明有人把回退分支删了 →
    // rerender 在热座模式下不画任何东西，而整页会因为这条断言**按整份文件**判定而静默绿）
    const rerenderBody = functionBody(code, 'rerender');
    expect(rerenderBody, 'rerender 里没有 renderApp 回退分支（热座模式将渲染不出任何东西）')
      .toMatch(/renderApp\(root,\s*state,\s*cb\)/);
    expect(sites.length, '主渲染路径整体消失（rerender 无回退分支？）').toBe(1);
  });

  it('4. resetToMainInterface 并排清两个模块态，且清空**早于** showHome()', () => {
    const body = functionBody(mainSrc(), 'resetToMainInterface');
    expect(body, 'resetToMainInterface 未清 render.ts 的 UI 模块态').toContain('resetUiState()');
    expect(body, 'resetToMainInterface 未清 render-net.ts 的模块态（跨局残留选择 id / 工具条反馈）')
      .toContain('resetNetUiState()');
    const iUi = body.indexOf('resetUiState()');
    const iNet = body.indexOf('resetNetUiState()');
    const iHome = body.indexOf('showHome()');
    expect(iHome, 'resetToMainInterface 未回主页面').toBeGreaterThanOrEqual(0);
    expect(iNet, 'resetNetUiState() 必须排在 showHome() 之前（不得"主页面已在屏上、模块态还没清"）')
      .toBeLessThan(iHome);
    // 两处是**相邻的并排调用**（不是散落在函数两头）—— 间距 < 200 字符即视为相邻
    expect(Math.abs(iNet - iUi), '两个 reset 不是并排调用（散落会让将来新增的复位点漏掉其中一边）')
      .toBeLessThan(200);
  });

  it('5. resetToMainInterface 把页面模式复位回热座（堵住"预览模式泄漏到热座"）', () => {
    const body = functionBody(mainSrc(), 'resetToMainInterface');
    expect(body, "resetToMainInterface 未复位 renderMode = 'hotseat'"
      + '（打完一局预览 → 返回主页面 → 开热座会渲染成**远程页**，且不报任何错）')
      .toMatch(/renderMode\s*=\s*'hotseat'/);
    expect(body, 'resetToMainInterface 未复位 netViewSeat（下一局预览会从上一局的视角起手）')
      .toMatch(/netViewSeat\s*=\s*0/);
    // 复位必须早于 showHome()：理由同第 4 条（不留"主页面已在屏上、模式还是 net"的中间态）
    expect(body.indexOf('showHome()'), '模式复位排在 showHome() 之后（中间态留给将来的渲染逻辑）')
      .toBeGreaterThan(body.indexOf("renderMode = 'hotseat'"));
    // 幂等堵点二：startHotseat 里也必须显式复位（防其它历史路径把模式留成 net）
    const mode = functionBody(mainSrc(), 'showModeSelect');
    const hotseat = mode.slice(mode.indexOf('startHotseat:'));
    expect(hotseat, "startHotseat 未显式 renderMode = 'hotseat'（幂等复位，防串味）")
      .toMatch(/renderMode\s*=\s*'hotseat'/);
  });

  /**
   * **R-F · I-1**：FX 视角座位（`fx-seat.ts` 的模块态）必须随"离开远程页的每一条路径"复位。
   *
   * ## 这条守卫为什么必须有（评审实测：反向变异**绿**）
   *
   * `resetToMainInterface()` 复位了 `renderMode` / `netViewSeat` / `resetNetUiState()`，
   * 却**没有** `setFxViewSeat(null)`（当时全仓零生产调用）。于是"远程页预览跑过一帧 →
   * 返回主界面 → 开热座"这条**用户验收必走**的路径上，热座 FX 读到非 null 座位、
   * 走竖向分支：落点翻边、覆盖条带变横带、控制轨特效变竖向 —— 而且**不报任何错**。
   * 评审的变异 M-A3（**补上**这行复位）当时的全套测试**全绿**，证明**没有任何断言要求它**。
   *
   * ## 判据（钉规格，不钉某一行）
   *
   * "进入热座"在 `main.ts` 里恰好有两个入口（`resetToMainInterface` 与 `showModeSelect`
   * 的 `startHotseat`），**每一个**都必须把座位复位成 `null` —— 也就是"每当
   * `renderMode = 'hotseat'` 被赋值，同一条路径上都要复位座位"。
   * 数量断言（= 2）是**反空集合**：将来新增第三个入口时它会立刻要求同步，
   * 而不是让新入口悄悄漏掉复位（这正是 I-1 的形态）。
   */
  it('5b. 进入热座的**每一条路径**都必须复位 FX 视角座位（跨页残留 = 热座零变化不成立）', () => {
    const main = mainSrc();
    // ① 返回主界面那条路径
    expect(functionBody(main, 'resetToMainInterface'),
      'resetToMainInterface 未复位 FX 视角座位（预览过一帧后返回主界面再开热座，'
      + '热座 FX 会走竖向分支：落点翻边 / 覆盖条带变横带 / 控制轨变竖向）')
      .toMatch(/setFxViewSeat\(\s*null\s*\)/);
    // ② "直接开热座"那条路径（幂等复位：任何历史路径进来都不带上一页的座位）
    const mode = functionBody(main, 'showModeSelect');
    const hotseat = mode.slice(mode.indexOf('startHotseat:'));
    expect(hotseat, 'startHotseat 未复位 FX 视角座位（从"开发中"或任何历史路径进来会带着上一页的座位）')
      .toMatch(/setFxViewSeat\(\s*null\s*\)/);
    // ③ 反空集合：`renderMode = 'hotseat'` 的赋值点必须**恰好**两处（多一处就会漏复位 → 报红要求同步）
    const setters = occurrences(main, "renderMode = 'hotseat'");
    expect(setters.length, `进入热座的入口数量变了（${setters.length} 处）—— 每一个新入口都必须同时复位`
      + ` FX 视角座位：\n${setters.join('\n')}`).toBe(2);
    // ④ 复位的**来源**必须是 fx-seat（不是本地糊一个同名函数）
    expect(main, 'main.ts 未 import setFxViewSeat（复位的是别的东西？）')
      .toMatch(/import \{[^}]*setFxViewSeat[^}]*\} from '\.\/ui\/fx-seat'/);
    // ⑤ 反向：热座页源码仍不许出现座位写入（否则"热座恒 null"的构造性证明失效）
    expect(stripComments(read('src/ui/render.ts')), 'render.ts 出现了座位写入（热座页会读到非 null 座位）')
      .not.toMatch(/\b(apply|set)FxViewSeat\s*\(/);
    // ⑥ 反向：远程页仍必须在渲染时设座位（否则"复位"会退化成"永远 null"、远程页方向全错）
    expect(read('src/ui/render-net.ts'), '远程页不再设座位（FX 会永远按热座左右算）')
      .toMatch(/applyFxViewSeat\(/);
  });

  it('6. 远程页那条渲染支路（`renderMode === net`）仍按开发者闸门喂 `viewSeat` / `verifyHooks`', () => {
    const main = mainSrc();
    const rerender = functionBody(main, 'rerender');
    /**
     * ⚠️ **2026-10-01（用户要求）**：本条原先叫「预览入口：home.ts 的开发者闸门 + main.ts 的
     * `startNetPreview` 三件事」，钉的是「单视角预览（仅开发）」那个模式（模式卡 / `devUnlocked`
     * 形参 / `startNetPreview` 启动路径）。用户要求把那个模式**整个删掉**
     * （「单视角预览这个模式可以直接删了，没有用」）⇒ 那三件事的判据**没有放松，而是改判它现在的
     * 主人**：`renderMode === 'net'` 这条渲染支路是**联机牌桌**在走（进牌桌由 `enterNetGame()`
     * 写 `renderMode = 'net'`），本条的每一条断言都还逐字钉在这条支路上。
     * 「那个模式彻底没了」另立一条锚点腿（本文件第 13 条）。
     */
    // ★ 判据面 = `rerender` 里那个 `if (renderMode === 'net' && state.phase !== 'draft') { … }`
    //   的**花括号配平块**（`braceBlock`）。比"整份 main.ts 里出现过这几个词"强，也比
    //   "从某个键一直切到末尾"稳：这一段里出现的东西就是这个支路自己做的事。
    const netAt = rerender.indexOf("renderMode === 'net'");
    expect(netAt, "rerender 里没有 `renderMode === 'net'` 这条支路（联机牌桌画不出来）")
      .toBeGreaterThanOrEqual(0);
    const net = braceBlock(rerender, netAt);
    expect(net.length, 'net 支路抽到空片段（锚点配平失败）⇒ 本判据假绿').toBeGreaterThan(80);
    // 草稿阶段的守卫必须在：联机沿用热座草稿页（否则草稿期会画远程页）
    expect(net, "net 支路缺少 state.phase !== 'draft' 守卫（草稿阶段会被画成远程页）")
      .toMatch(/state\.phase\s*!==\s*'draft'/);
    // 视角座位与本端座位同源（T21）：渲染器吃到的就是喂给驱动的那一个
    expect(net, 'net 支路不再把 netViewSeat 交给渲染器').toMatch(/viewSeat:\s*netViewSeat/);
    // 解锁后会切视角（工具栏 / devmode 的 netSeat 指令都走这条回传）
    expect(net, 'net 支路不再传 onPreviewChange（解锁后无法切视角）').toMatch(/onPreviewChange/);
    expect(net, 'net 支路不再设 netViewSeat（onPreviewChange 的回传落不了地）')
      .toMatch(/netViewSeat\s*=\s*next\.viewSeat/);
    // ── R12-6：工具条与自查**只在开发者模式解锁后**启用（用户："隐藏它，功能内化给开发者模式"）──
    // 判据从"传 verifyHooks: true"改成"**由 `isDevUnlocked()` 闸门**决定" —— 两者都必须查：
    //  · 闸门在（`const dev = isDevUnlocked()` + `verifyHooks: dev`）⇒ 普通对局里页面上没有工具条；
    //  · 功能仍在（`onPreviewChange` / `verifyHooks` 两个键都还在，只是条件展开）。
    // ⚠️ 反面（同一条腿）：**不许**再无条件写 `verifyHooks: true` —— 那正是用户要隐藏的形态。
    expect(net, 'net 支路没有开发者模式闸门（`isDevUnlocked()`）—— 预览工具条会常驻在页面上')
      .toMatch(/isDevUnlocked\(\)/);
    expect(net, 'net 支路未按闸门传 verifyHooks（远程页看不到运行时自查行）')
      .toMatch(/verifyHooks:\s*dev/);
    // 判据面是**支路本身**（不是整份 main.ts）：`isDevUnlocked()` 只许在这个支路里出现一次
    //   —— 本文件第 6 条旧版还有一条"`renderModeSelect(root, {…}, isDevUnlocked())`"的闸门接线腿，
    //   那条随预览卡一起删了（模式页不再读解锁态，见第 13 条锚点腿）。
    expect((net.match(/isDevUnlocked\(\)/g) ?? []).length,
      'net 支路里 isDevUnlocked() 的出现次数不是 1（闸门被判了两次？）').toBe(1);
    // ── G2 Task 4F 终审 · Critical C-2（**必须留在这一组里**）──
    // 手牌可见性**按座位**决定：自己 = 'all'（真实卡、可点），对手 = NET_HAND_VIS（数量占位）。
    // 曾经把两处都写成常量 `NET_HAND_VIS`（='count'），而 `renderHand` 的 'count' 分支是
    // **与 isSelf 无关的无条件提前返回** → 自己的手牌也变成「手牌 ×n」占位、一张 `.card` 都没有
    // → 联机牌桌不可玩（而运行时自查照样 ✓）。**判据必须是这个三元映射本身，不能只看出现次数。**
    const netSrcAll = stripComments(read('src/ui/render-net.ts'));
    const selfMap = [...netSrcAll.matchAll(/handVisibility:\s*isSelf\s*\?\s*'all'\s*:\s*NET_HAND_VIS/g)].length;
    expect(selfMap, `render-net.ts 里"自己='all' / 对手=数量占位"的映射有 ${selfMap} 处（应为恰好 2 处：P0 与 P1）`)
      .toBe(2);
    // ── G2 Task 4F · I-2 + N4 + D-2 ──
    // 信息遮蔽是**唯一**形态，而且**根本不存在"档位"这个量**：
    // Task 4F 终审 N4 指出 `NetViewOpts.handVisibility` 已成死参数（传 `'all'` 静默无效），
    // 于是把 `netHandVisibility` 常量与那个字段**一起删掉** —— 现在既没有可切取值、也没有可传参数，
    // "信息遮蔽恒成立"不再依赖"某个 const 恰好等于 'viewSeat'"，而是**结构上不存在别的可能**。
    // （原来的判据是"它是 const 且只能声明一次"，那仍然留着一个可以被读错的入口；删掉更强。）
    expect(main, 'main.ts 仍有 netHandVisibility 档位常量（N4 之后应已删除 —— 死参数比没有更误导）')
      .not.toMatch(/netHandVisibility/);
    expect(stripComments(read('src/ui/render-net.ts')),
      'render-net.ts 的 NetViewOpts 仍有 page 级 handVisibility 档位字段（死参数，N4）')
      .not.toMatch(/^\s*handVisibility:\s*'all'\s*\|\s*'viewSeat'\s*;/m);
    // D-2：devmode 注入必须走唯一入口 `rerender()`（否则远程页里用 devmode 加牌会把页面画回热座）
    // ⚠️ R12-6：调用现在是**多行**（多了 netSeat 回调）⇒ 判据改成"从调用点起的一段"。
    const devmodeCall = main.slice(main.indexOf('initDevMode('), main.indexOf('initDevMode(') + 400);
    expect((main.match(/initDevMode\(/g) ?? []).length, 'main.ts 里 initDevMode( 的调用点数不是 1').toBe(1);
    expect(devmodeCall, 'devmode 注入未走 rerender()（D-2：远程页里加牌会被画回热座棋盘）')
      .toMatch(/render:\s*\(\)\s*=>\s*rerender\(\)/);
    expect(devmodeCall, 'devmode 宿主没接上 netSeat（R12-6 把视角切换内化进开发者模式 —— '
      + '预览工具条已隐藏 ⇒ 没有这条回调就无法切到对方视角）').toMatch(/netSeat:\s*\{/);
  });

  it('7. cb.rerender 已接上（否则远程页里选牌 / 翻面 / 浮层 / 工具条全都没反应）', () => {
    const main = mainSrc();
    /**
     * cb 对象字面量里必须提供 rerender —— 转调**同一入口**，路由规则只有一处。
     *
     * ⚠️ **G4 Task 4 · L3 的 retarget（只换"面"，不放松）**：原判据是整份源码里的
     * `/rerender\(\)\s*\{\s*rerender\(\);\s*\}/` —— 它把**方法简写**这一种排版当成了契约，
     * 而 G4 要收口 `cb`（收口后合法的写法还有箭头函数）。新判据：
     *   · 判据面从"整份源码"收窄到 **`cb` 的函数体**（不会再有别处的同形文本满足它）；
     *   · **两种合法写法都接受**（方法简写 / 箭头），但都必须到达同一个唯一入口符号 `rerender(`。
     * 强度：面更小、且要求"到达的是 `rerender()` 本身"（旧写法里一个巧合的
     * `rerender() { rerender(); }` 出现在任何地方都算数 ⇒ 那是更弱的形态）。
     */
    const cbBody = objectBody(main, CB_HEAD);
    expect(cbBody.length, 'cb 抽到空片段 ⇒ 本判据假绿').toBeGreaterThan(200);
    expect(cbBody, 'cb 没提供 rerender（render.ts 的选择浮层会退回 renderApp → 页面被换回热座）')
      .toMatch(/rerender\s*\(\)\s*\{\s*rerender\(\);\s*\}|rerender\s*:\s*\(\)\s*=>\s*rerender\(\)/);
    // 反向：`rerender` 这个成员必须真的在 cb 里（不是被上面那条正则命中了别的成员）
    expect(cbBody, 'cb 里没有 rerender 成员').toMatch(/(?:^|\n)\s*rerender\s*(?:\(\)\s*\{|:\s*\()/);
    // 提供方（render.ts）必须**优先**用它：`if (cb.rerender) cb.rerender(); else renderApp(…)`
    const renderSrc = stripComments(read('src/ui/render.ts'));
    expect(renderSrc, 'render.ts 里找不到 cb.rerender（选择浮层不会回到当前页面）').toContain('cb.rerender');
    const at = renderSrc.indexOf('cb.rerender');
    expect(renderSrc.slice(at - 400, at + 200),
      'render.ts 的 cb.rerender 不在"优先走宿主、否则回退 renderApp"的形态里（回退分支被删？）')
      .toMatch(/if\s*\(\s*cb\.rerender\s*\)\s*cb\.rerender\(\)\s*;\s*else\s+renderApp\(/);
    // 它必须落在 buildChoicePickOverlay 里（选择浮层是远程页与热座页共用得最多的一块）
    const build = functionBody(renderSrc, 'buildChoicePickOverlay');
    expect(build, 'buildChoicePickOverlay 未走 cb.rerender（浮层里点候选卡不会回到远程页）')
      .toContain('cb.rerender');
  });

  it('8. 反向：两个渲染器互不复用本体（设计稿 §6.1「远程页必须另写」没有被悄悄破坏）', () => {
    const renderSrc = stripComments(read('src/ui/render.ts'));
    const netSrc = stripComments(read('src/ui/render-net.ts'));
    expect(renderSrc, 'render.ts 引用了 renderNetBoard（热座页反向依赖远程页＝分层被打破）')
      .not.toMatch(/\brenderNetBoard\b/);
    // 远程页调 `renderBoard(` 才会让"另写一套布局"变成摆设（本页应复用叶子助手而非本体）
    expect(netSrc, 'render-net.ts 调用了 renderBoard（设计稿 §6.1 要求本体另写）')
      .not.toMatch(/\brenderBoard\s*\(/);
    expect(netSrc, 'render-net.ts 调用了 renderApp（重渲染必须走 cb.rerender）')
      .not.toMatch(/\brenderApp\s*\(/);
    // 复用面仍然存在（反向断言不能靠"把 import 全删了"变绿）
    expect(netSrc, '远程页不再复用 render.ts 的叶子助手（复用面被清空？）')
      .toMatch(/from\s+'\.\/render'/);
  });

  /**
   * G2 Task 4F（终审 I-1）：**入口职责对齐**守卫 —— 本次最有价值的一条。
   *
   * 背景：`render-net.ts` 原来自称"入口四件副作用与 `renderApp` 对齐"，而 `renderApp` 实际有
   * **六件**（+清 root）→ 漏掉 `removeDraftPreviews()` 与 `activeDragCancel()`，两块 body 级
   * `.draft-preview`（`fixed; z-index:400`，无 `pointer-events:none`）整局残留在预览页并拦截点击。
   * 根因不是"忘了某一件"，而是**清单是手写的**：手写清单必然漏项。
   *
   * ## 判据怎么做的：**从 `renderApp` 推导**，不是在测试里硬抄一份清单
   *
   * 1. **要求面由数据表 `ENTRY_DUTIES` 描述**（标识 / `call` 实参串 / `classOps` 类名），
   *    这与"在测试里硬抄一列 `expect(netBody).toContain(…)`"的区别在于：表里的每一项都必须
   *    **同时**在 `renderApp` 与 `renderNetBoard` 的函数体里成立（`expectDuty` 对两侧各判一次），
   *    所以**表不可能单方面漂移**，也不会出现"表里写着、`renderApp` 里其实没有"的假条目。
   * 2. **`renderApp` 里出现的 `root.classList.*` 操作由源码自动抽取**（`rootClassOps`），
   *    要求每一个都能被表里某个 duty 的 `classOps` 解释 —— 于是往 `renderApp` 里加一个
   *    `.no-anim` 之外的**新**类操作，守卫立刻红，不会因为"表里没有"而静默放过。
   * 3. `renderNetBoard` 的函数体里，**每一条** duty 的 `call`/`classOps` 都必须出现。
   *
   * ## 已知边界（如实写在守卫里）
   * `ENTRY_DUTIES` 是新职责的**登记表**：若有人往 `renderApp` 加一件"既不碰 `root.classList`、
   * 也不属于表内任何条目"的新职责（例如又一句 `someCleanup()`），本守卫**不会**自动要求
   * `renderNetBoard` 也加 —— 那时必须把它登记进表。这是"推导"能做到的极限（无法从任意语句
   * 语义上判断"这是入口职责"），所以另加一条**出现次数下界**：一旦 `renderApp` 的一级语句数
   * 明显增长而表没有增长，报错信息会指向这里（见下面的 `renderApp 的一级语句数` 断言）。
   */
  const ENTRY_DUTIES: ReadonlyArray<{
    id: string;
    call?: string;
    /** 本页（`renderNetBoard`）侧的判据串；省略 = 与 `call` 相同 */
    netCall?: string;
    classOps?: readonly string[];
    appDelegates?: readonly string[];
  }> = [
    // 拖拽安全网：`renderApp` 直接读模块变量（`if (activeDragCancel) activeDragCancel();`），
    // 本页走 `render.ts` 新增的包装 `cancelActiveDrag()`（语义逐字等价：空值即无操作）。
    // ⚠️ 理由更正（G2 终审 N6）：**不是**"导出裸变量会被 import 方覆写" —— ESM 导入绑定只读，
    // `export let` 同样改不了（`error TS2632`）。真正的理由：封装判空 / 导出动作而非可变状态 /
    // 给"等价但不同形"的调用一个正式位置（`netCall` 就是为它存在的）。见 render.ts 的说明。
    { id: '拖拽安全网', call: 'activeDragCancel(', netCall: 'cancelActiveDrag(' },
    { id: '清 body 级草稿展示框', call: 'removeDraftPreviews(' },
    // ⚠️ "③ 清空并重建 root" 在两个渲染器里的**落点不同**，这不是偏差而是委托：
    //    `renderApp` 自己**不**碰 root 内容 —— 它 `if (phase==='draft') renderDraft(…) else renderBoard(…)`，
    //    清 root 由那两个子渲染器负责（`renderDraft`/`renderBoard` 首行都是 `root.textContent = ''`）。
    //    而 `renderNetBoard` **自己就是**那个"子渲染器"（本页不复用本体）→ 它必须自己清。
    //    所以这里逐文件判定：本页用 `call`（必须自己清），`renderApp` 用 `appDelegates`（委托给子渲染器）。
    //    **不把它写成 `call` 的原因**：那会让本守卫在 `renderApp` 上**恒红**（假红），
    //    而"拒绝正确代码的守卫会被绕过" —— 本项目已有两次这样的教训。
    {
      id: '清空并重建 root', call: "root.textContent = ''",
      appDelegates: ['renderDraft(', 'renderBoard('],
    },
    { id: '重渲染动画抑制', classOps: ['no-anim'] },
    // 双 rAF 后移除 `no-anim`（与上一件是一对；两个渲染器都必须有这个收尾，否则 `no-anim`
    // 会永久留在 root 上 → 整页过渡动画全被抑制）
    { id: '双 rAF 后移除 no-anim', call: 'requestAnimationFrame(' },
    { id: 'check-cache 锁链', call: 'syncCheckCacheChains(' },
    { id: '锁链层重定位', call: 'syncChainLayerPosition(' },
    { id: '宿主每帧钩子', call: 'cb.onRendered?.()' },
  ];

  /** 从源码里抽出"语句级"的 `root.classList.add/remove/toggle(…)`（顺序按出现） */
  function rootClassOps(src: string): string[] {
    return [...src.matchAll(/root\.classList\.(add|remove|toggle)\(\s*['"]([^'"]+)['"]/g)]
      .map((m) => `${m[1]}('${m[2]}')`);
  }

  /**
   * 一级语句的**代表性**调用（每条语句里出现的第一处具名调用）。
   * 只用来找"未分类的入口职责"：`const x = f(y)` / `f(y);` / `if (c) f(y);` 都取到 `f(y)`。
   *
   * ⚠️ 必须排掉**语言关键字**：`if (` 会被当成"名为 `if` 的调用"（实测假红）。
   */
  const NON_CALL_KEYWORDS = new Set([
    'if', 'for', 'while', 'switch', 'catch', 'function', 'return', 'typeof', 'void', 'new', 'await', 'do', 'else',
  ]);
  function topLevelCalls(body: string): string[] {
    const out: string[] = [];
    for (const raw of body.split('\n')) {
      const line = raw.trim();
      if (line === '' || line.startsWith('//') || line.startsWith('*') || line.startsWith('/*')) continue;
      const m = /(?:^|[=(?:,&|]|\bvoid\s+)\s*([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?)\s*\(/.exec(line);
      if (m && !NON_CALL_KEYWORDS.has(m[1])) out.push(`${m[1]}(`);
    }
    return out;
  }

  it('9. I-1：renderNetBoard 的入口职责必须与 renderApp **对齐**（要求面从 renderApp 推导，不是硬抄）', () => {
    const renderAppBody = functionBody(stripComments(read('src/ui/render.ts')), 'renderApp');
    const netBody = functionBody(stripComments(read('src/ui/render-net.ts')), 'renderNetBoard');

    // 反空集合：表为空则下面两条 for 循环恒真（读起来像"已验收"）
    expect(ENTRY_DUTIES.length, 'ENTRY_DUTIES 为空（入口职责判据失效）').toBeGreaterThan(0);
    for (const d of ENTRY_DUTIES) {
      expect((d.call ?? '') + (d.classOps ?? []).join(','), `duty ${d.id} 的判据为空`).not.toBe('');
    }

    // 每条 duty 的判据形式：`call` 串，或 `root.classList.<op>('类')`。
    // `classOps` 只声明**类名**，含它的职责要把该类的**全部** classList 操作都算作已解释：
    // `no-anim` 就是"加 + 双 rAF 后移除"这一对（`renderApp` 里 add 与 remove 都有，
    // 断言只钉 add 的存在性，remove 由 ② 的"无未分类操作"覆盖）。
    const formsOf = (d: typeof ENTRY_DUTIES[number]): string[] => [
      ...(d.call ? [d.call] : []),
      ...(d.classOps ?? []).map((c) => `root.classList.add('${c}')`),
    ];
    /** `renderApp` 侧的判据：可以是本页式直做（`formsOf`），也可以是**委托**给某个子渲染器 */
    const appFormsOf = (d: typeof ENTRY_DUTIES[number]): string[] =>
      d.appDelegates && d.appDelegates.length > 0 ? [...d.appDelegates] : formsOf(d);

    // ① 每条 duty 都必须在 `renderApp` 里成立（直做或委托；否则表里是假条目 —— 表不得单方面漂移）
    const appMissing = ENTRY_DUTIES
      .filter((d) => !appFormsOf(d).every((f) => renderAppBody.includes(f)))
      .map((d) => `${d.id}（判据 ${appFormsOf(d).join(' / ')} 在 renderApp 里找不到）`);
    expect(appMissing, `ENTRY_DUTIES 里这些条目在 renderApp 里不成立（表已漂移成假条目）：\n${appMissing.join('\n')}`)
      .toEqual([]);

    // ② 反向：`renderApp` 里出现的每个 `root.classList.*` 操作都必须被某个 duty 解释
    //    （往 renderApp 加新的类操作而不登记 → 这里红）
    const known = new Set<string>();
    for (const d of ENTRY_DUTIES) for (const c of d.classOps ?? []) known.add(c);
    const unclassified = rootClassOps(renderAppBody)
      .filter((op) => ![...known].some((c) => op.includes(`'${c}'`)));
    expect(unclassified, `renderApp 里的这些 root.classList 操作没有被任何入口职责条目解释 —— `
      + `请登记进本测试的 ENTRY_DUTIES 并确认 renderNetBoard 也照做：\n${unclassified.join('\n')}`).toEqual([]);

    // ③ 未分类的**一级语句调用**（推导的边界：新职责必须登记，否则这里点名）
    const classifiedCalls = ENTRY_DUTIES.map((d) => d.call).filter((c): c is string => c !== undefined)
      .concat(ENTRY_DUTIES.flatMap((d) => d.appDelegates ?? []))
      .concat(['root.classList.']);
    const strayCalls = topLevelCalls(renderAppBody)
      .filter((c) => !classifiedCalls.some((k) => k.startsWith(c) || c.startsWith(k.replace(/\($/, '('))));
    expect(strayCalls, `renderApp 里有未登记进 ENTRY_DUTIES 的一级调用 —— 若它是"入口职责"，`
      + `必须登记并确认 renderNetBoard 也照做：\n${strayCalls.join('\n')}`).toEqual([]);
    // 表规模与 renderApp 的职责面大致相称（防"表被清空/截断"而其余断言静默变松）
    expect(ENTRY_DUTIES.length, 'ENTRY_DUTIES 条目数异常（renderApp 的入口职责面被截断？）')
      .toBeGreaterThanOrEqual(7);

    // ④ 正向：`renderNetBoard` 必须满足**全部** duty（I-1 的真正判据）。
    //    `netCall` 存在时以它为准（本页允许等价但不同形的写法，例如 `cancelActiveDrag()`）——
    //    这正是 `EntryDuty` 里那个字段存在的唯一理由，且 `call` 那一侧仍由 ① 对 `renderApp` 断言。
    const netMissing: string[] = [];
    for (const d of ENTRY_DUTIES) {
      const forms = d.netCall !== undefined ? [d.netCall, ...(d.classOps ?? []).map((c) => `root.classList.add('${c}')`)] : formsOf(d);
      for (const f of forms) {
        if (!netBody.includes(f)) netMissing.push(`${d.id}：renderNetBoard 里找不到 ${JSON.stringify(f)}`);
      }
    }
    expect(netMissing, `renderNetBoard 缺少以下入口职责（漏一件就是一个残留/时序 bug，`
      + `I-1 的两块草稿面板与拖拽幽灵卡就是这么漏掉的）：\n${netMissing.join('\n')}`).toEqual([]);

    // ⑤ 反面：删掉 duty 的判据串本身就是"缺职责"，由 ④ 抓；这里再钉一条**顺序**——
    //    清空 root 必须早于任何 `root.appendChild`（F-1 的判据在 render-net.test.ts 第 1b 条，
    //    此处只确认职责序列里"清 root"排在"挂载"之前，防止有人把清理挪到渲染之后）
    expect(netBody.indexOf("root.textContent = ''"), 'renderNetBoard 清空 root 晚于第一次挂载（F-1 回归）')
      .toBeLessThan(netBody.indexOf('root.appendChild('));
    // ⑥ 草稿面板的清理必须在"清 root"之前或紧随（它清的是 body 上的节点，与 root 无关；
    //    但顺序上必须在挂载之前，否则第一帧就会带着残留面板绘制）
    expect(netBody.indexOf('removeDraftPreviews();'), 'removeDraftPreviews 晚于挂载（首帧就带残留面板）')
      .toBeLessThan(netBody.indexOf('root.appendChild('));
    // ⑦ 胜利横幅只在 gameover 局面产出（不许无条件挂）
    expect(netBody, 'renderNetBoard 未按 gameover 条件产出胜利横幅')
      .toMatch(/if\s*\(\s*s\.phase === 'gameover'\s*&&\s*s\.winner !== null\s*\)\s*showWinOverlay\(/);
  });

  /**
   * G2 Task 4F（终审 C-1）：**预览页必须能退出**。
   *
   * 原缺陷：`renderNetBoard` 从不产出胜利横幅，`cb.onWinReset` 只被 `showWinOverlay` 的按钮调用，
   * 而 `showWinOverlay` 的唯一调用点在 `renderBoard` 内且**未 export** ⇒ 预览里打完一局
   * **只能刷新浏览器**；用户验收 D2/F14 按字面无法执行；Task 4 的三道"防模式泄漏"堵点里，
   * 堵点①（`resetToMainInterface`）**不可达**。
   *
   * 判据（不能只断言函数名出现 —— 注释/import 都会满足它，这轮已栽过多次）：
   * ① `renderNetBoard` 的函数体里必须有**真实调用** `showWinOverlay(<winner>, cb);`（带实参形态）；
   * ② 该调用必须被 `s.phase === 'gameover' && s.winner !== null` 守卫（与 `renderBoard` 同条件）；
   * ③ `render.ts` 必须真的把它 `export`（否则 import 编译不过 —— 但源码守卫仍值得钉一条，
   *    因为"export 被撤掉"在只看 render-net.ts 的断言下是完全不可见的）；
   * ④ `renderBoard` **一行不改**（热座红线）：它的调用形态与 `export` 前完全一致。
   */
  it('10. C-1：预览页能退出 —— renderNetBoard 在 gameover 局面产出胜利横幅（与 renderBoard 同条件）', () => {
    const renderSrc = stripComments(read('src/ui/render.ts'));
    const netBody = functionBody(stripComments(read('src/ui/render-net.ts')), 'renderNetBoard');

    // ① 真实调用（带两个实参），且分号结尾 —— 排除"函数名出现在 import 行/注释里"这种假绿
    expect(netBody, 'renderNetBoard 未调用 showWinOverlay(<winner>, cb)（预览页打完一局无法退出）')
      .toMatch(/showWinOverlay\(\s*s\.winner\s*,\s*cb\s*\)\s*;/);
    // ② 条件与 `renderBoard` 逐字同形（不许无条件挂横幅）
    expect(netBody, '奖励横幅的守卫条件与 renderBoard 不一致（必须是 gameover 且 winner 非空）')
      .toMatch(/if\s*\(\s*s\.phase === 'gameover'\s*&&\s*s\.winner !== null\s*\)\s*showWinOverlay\(/);
    // ③ render.ts 真的导出（`export function showWinOverlay(`）
    expect(renderSrc, 'render.ts 未 export showWinOverlay（render-net.ts 无法复用 → C-1 回归）')
      .toMatch(/export function showWinOverlay\(/);
    // ④ 热座红线：renderBoard 体的横幅调用形态与原先逐字一致
    const boardBody = functionBody(renderSrc, 'renderBoard');
    expect(boardBody, 'renderBoard 的胜利横幅调用被改动了（热座红线）')
      .toMatch(/if\s*\(\s*s\.phase === 'gameover'\s*&&\s*s\.winner !== null\s*\)\s*\{\s*showWinOverlay\(s\.winner, cb\);/);
    // ⑤ onWinReset 的消费点仍在（点按钮 → 宿主回主页面）：`cb.onWinReset?.()`
    expect(functionBody(renderSrc, 'showWinOverlay'), 'showWinOverlay 不再回调 cb.onWinReset（横幅按钮无效）')
      .toMatch(/cb\.onWinReset\?\.\(\)/);
  });

  /**
   * G2 Task 4F（终审 I-2）：**工具条只留"视角"一个开关**。
   *
   * 原缺陷：第二个开关「对手手牌：全部可见 ⇄ 只显示数量」实测**既不"可见"也不"可操作"** ——
   * `render.ts` 的 `faceUp` 与单击/拖拽绑定都以 `isSelf` 为条件、`styles-net.css` 又对非 self
   * 手牌 `pointer-events:none`，于是它只等于"去掉数量占位、改画卡背、仍不可点"。
   * 而宿主注释与验收清单都称它能"推进对手回合"（误导）。
   * 裁决：删开关，靠**切视角**推进（切过去对手变 self ⇒ 正面 + 可点）。
   *
   * 判据：工具条函数体里**恰好只有一个** `.net-preview-btn` 按钮（视角），且
   * `onPreviewChange` 的类型只回传 `viewSeat`；page 级的 `handVisibility` 档位字段**已删除**
   * （N4：它成了死参数、传 `'all'` 静默无效）。"自己='all' / 对手=数量占位"的映射由上面的三元断言钉住。
   */
  it('11. I-2：预览工具条只有"视角"一个开关；onPreviewChange 只回传 viewSeat', () => {
    const netSrc = stripComments(read('src/ui/render-net.ts'));
    const bar = functionBody(netSrc, 'renderPreviewToolbar');
    const btns = [...bar.matchAll(/net-preview-btn/g)].length;
    expect(btns, `工具条里有 ${btns} 个 net-preview-btn（I-2 之后应恰好 1 个：视角开关）`).toBe(1);
    expect(bar, '工具条不再有视角开关（无法推进对手回合 / 无法检查我是 P2 时的布局）')
      .toMatch(/viewSeat === 0 \? '视角：我 = P1/);
    // 旧的第二个开关必须**彻底消失**（按钮、提示文案、事件绑定）
    expect(bar, '工具条里仍有"对手手牌：…全部可见"的开关或文案（I-2 未修净）')
      .not.toContain('全部可见');
    expect(netSrc, 'render-net.ts 里仍有"全部可见"的文案/注释残留（与实现不符）')
      .not.toContain('全部可见');
    expect(netSrc, 'render-net.ts 仍有按 handVisibility 切换的回传（I-2 未修净）')
      .not.toMatch(/onChange\(\s*\{\s*handVisibility/);
    // onPreviewChange 的**类型**只回传 viewSeat。
    // 并且 **page 级的 `handVisibility` 档位字段必须不存在** —— G2 Task 4F 终审 N4：
    // 那个字段在 4F 之后已成**死参数**（`render-net.ts` 不再读 `opts.handVisibility`），
    // 传 `'all'` 会**静默无效**；留着它就是"看起来能用、实际没有任何效果"的第二个半成品。
    // 门与守卫都发现不了"参数被静默忽略"，所以这里把它钉死：档位不存在，行为恒为信息遮蔽。
    expect(netSrc, 'NetViewOpts.onPreviewChange 的类型仍带 handVisibility（I-2 未修净）')
      .not.toMatch(/onPreviewChange\?\(next:\s*\{[^}]*handVisibility/);
    expect(netSrc, 'NetViewOpts 仍有 page 级 handVisibility 档位字段（死参数 → 传值静默无效，N4）')
      .not.toMatch(/^\s*handVisibility:\s*'all'\s*\|\s*'viewSeat'\s*;/m);
    // 视角开关必须真的回传 viewSeat（两态都覆盖）
    expect(bar, '视角开关未回传 viewSeat').toMatch(/onChange\(\s*\{\s*viewSeat:\s*opts\.viewSeat === 0 \? 1 : 0\s*\}\s*\)/);
  });
});

/**
 * G5/T41 · **行为腿**：模式选择页的开发者闸门（真跑 `renderModeSelect`）。
 *
 * ## 为什么要有它（上面那些源码腿做不到的事）
 *
 * 第 6 条能证明"home.ts 里有 `if (devUnlocked)`、卡片在它的花括号体里"，**证明不了**
 * "`devUnlocked === false` 时页面上真的没有那张卡"—— 例如把闸门写成 `if (!devUnlocked)`、
 * 或者把卡片在闸门**外面**又建了一次，源码腿都可能照样绿。这里用共用的 DOM 桩
 * （`tests/ui/net-dom-stub.ts`，无 jsdom）真跑一帧，**读模式卡文案清单本身**。
 *
 * 能力边界：桩只记结构、不模拟布局 ⇒ 能证明"卡片建没建、顺序、点击落到哪个回调"，
 * 证明不了观感；真浏览器里的读数（跳转前的清单、点设备体检后的 `location.pathname`）
 * 在 `.superpowers/g5-T41/run-*.txt` 里。
 */
describe('G5 T41 · 模式选择页的开发者闸门（行为腿：真跑 renderModeSelect）', () => {
  let restoreDom: (() => void) | null = null;
  afterEach(() => { restoreDom?.(); restoreDom = null; });

  const navOf = (calls: string[]): ModeSelectNav => ({
    backHome: () => { calls.push('backHome'); },
    openDeviceCheck: () => { calls.push('openDeviceCheck'); },
    startHotseat: () => { calls.push('startHotseat'); },
    startNetLobby: () => { calls.push('startNetLobby'); },
  });

  /** 真跑一帧模式选择页：返回模式卡文案清单（DOM 顺序）与点击记录 */
  const run = (): { root: StubNode; names: string[]; calls: string[] } => {
    const root = makeStubEl('div');
    const calls: string[] = [];
    renderModeSelect(root as unknown as HTMLElement, navOf(calls));
    const names = descendants(root).filter((n) => isClass(n, 'mode-card-name')).map((n) => n.text);
    return { root, names, calls };
  };

  /** 在某个节点上**真派发一次点击**（挂一个空子节点再派发，冒泡到它自己） */
  const clickInner = (node: StubNode): void => {
    const clicker = makeStubEl('span');
    node.appendChild(clicker);
    clicker.dispatchEvent({ type: 'click', target: clicker });
  };

  /**
   * ⚠️ **2026-10-01（用户要求）**：本条原先叫「dev=false 没有预览卡、dev=true 才有；设备体检按钮
   * 两条路径都在、点了真回调」，跑的是**两条路径**（`dev=false` / `dev=true`）。
   *
   * 用户要求把「单视角预览（仅开发）」那个模式整个删掉 ⇒ `renderModeSelect` 不再接收任何
   * "开发者闸门"实参、模式页与解锁态**再无关系** ⇒ 这里只剩**一条**路径可跑。
   * 判据**没有放松**：仍然是"逐字断言那四张卡 + 逐张点得动 + 点第二张走 startNetLobby"，
   * 只是不再拿同一个清单去比对第二遍（那第二遍过去测的就是那张已删掉的卡）。
   * 「那个模式彻底没了」另立一条锚点腿（下面第 13 条）。
   */
  it('12. 模式页恒为那四张卡；设备体检按钮在、点了真回调；第二张卡走 startNetLobby', () => {
    restoreDom = installStubDom();
    const off = run();

    // ① 用户要的就是这个：**游戏模式清单里没有那张卡，也永远不会有**
    expect(off.names, `模式卡清单：${JSON.stringify(off.names)}`)
      .not.toContain('单视角预览（仅开发）');
    expect(off.names, '模式卡清单被改动了（热坐/联机/单人/三人应当都在，且逐字如此）')
      .toEqual(['热坐（双人）', '联机对战（两台设备）', '单人模式', '三人模式']);

    // ② 设备体检按钮在（它不是模式卡）
    const btn = descendants(off.root).find((n) => n.tag === 'button' && n.text === '设备体检 / 网络自检');
    expect(btn, '模式选择页没有「设备体检 / 网络自检」按钮').toBeTruthy();
    clickInner(btn as StubNode);
    expect(off.calls, '点了「设备体检」按钮，宿主回调没被调到（或调到了别的东西）')
      .toEqual(['openDeviceCheck']);

    // ③ 模式卡真的点得动，且**没有第三条通往那个已删模式的路**
    const cards = descendants(off.root).filter((n) => isClass(n, 'mode-card'));
    expect(cards.length, '模式卡数量（应为 4：热坐/联机/单人/三人）').toBe(4);
    clickInner(cards[1]);
    expect(off.calls, '点第二张模式卡（联机对战）没有走 startNetLobby')
      .toEqual(['openDeviceCheck', 'startNetLobby']);
    const names = descendants(off.root).filter((n) => isClass(n, 'mode-card-name')).map((n) => n.text);
    expect(names, '第三张模式卡不是"单人模式"（少了一张卡之后顺序错了）')
      .toEqual(['热坐（双人）', '联机对战（两台设备）', '单人模式', '三人模式']);
  });

  /**
   * ★ **2026-10-01 新增锚点腿**：证明「单视角预览」这个模式**在源码里彻底没了**，
   * 而不只是"模式页运行时没画出来"。
   *
   * ## 为什么必须有它（上一条行为腿做不到的事）
   *
   * 第 12 条读的是**运行期清单** —— 它证明"今天这四张卡逐字如此"，却证明不了
   * "那张卡与它专属的启动路径已经被删掉"：有人可能把卡片建在**渲染函数外面**、
   * 或者在宿主里留一条**没有入口的**启动路径（模式页看不见、但代码还在，下一个人
   * 顺手给它加个按钮就复活了）。本条的判据面是**源码文本**：
   * 入口文案、`renderModeSelect` 的第三个形参、`ModeSelectNav.startNetPreview`、
   * 宿主里那个启动回调、devmode 的收回函数 —— 一处都不许剩。
   *
   * ## 判据为什么与注释无关（`stripComments`）
   *
   * 本仓的注释里**故意**留了这次删除的说明（`home.ts` / `main.ts` / `devmode.ts` 都写了
   * "原先还有 …"），所以判据必须作用在**去注释**的源码上：否则那些说明本身就会把断言判红。
   * 反过来，这也意味着"把卡片加回去"这种变异**一定会**被判据抓住 —— 见文件末的反向验证记录。
   */
  it('13. 锚点腿：「单视角预览」在源码里彻底没了，而共用的联机那套仍逐条在', () => {
    const home = stripComments(read('src/ui/home.ts'));
    const main = mainSrc();
    const mode = functionBody(main, 'showModeSelect');

    // ── ① 那张卡的**入口文案**不许在任何源码里出现（去注释之后）────────────────────
    const ANCHOR = 'src/main.ts:114 附近那一行 import 曾写 `resetDevUnlock`；home.ts:493 一带曾写 '
      + "'单视角预览（仅开发）'";
    for (const [what, text, needle] of [
      ['模式卡文案', home, '单视角预览（仅开发）'],
      ['模式卡文案（旧版）', home, '单视角预览（本地）'],
      ['宿主启动回调', main, 'startNetPreview'],
      ['devmode 收回函数', stripComments(read('src/ui/devmode.ts')), 'resetDevUnlock'],
      ['开发者闸门形参', home, 'devUnlocked'],
      ['模式页的宿主第三个实参', mode, 'isDevUnlocked()'],
    ] as const) {
      expect(text.includes(needle), `${what}：${needle} 仍然出现在源码里（删干净了吗？${ANCHOR}）`).toBe(false);
    }

    // ── ② 反向：这一组断言不是"把模式页删空"就能满足的 ────────────────────────────
    // 四张卡仍逐字在源码里，顺序同 DOM 顺序（热坐 → 联机 → 单人 → 三人）。
    // ⚠️ 2026-10-01（C）：卡的**文案**已经走 i18n（`mkMode(t('mode.hotseat.name'), …)`）⇒
    //    源码里找的是**键**，顺序判据一字未变；"四张卡都在"这件事由下面的键清单保证
    //    （键对应的中文值另有 `tests/i18n/home-copy.test.ts` 逐字钉住）。
    const iHot = home.indexOf("mkMode(t('mode.hotseat.name')");
    const iLobby = home.indexOf("t('mode.online.name')");
    const iSolo = home.indexOf("mkMode(t('mode.solo.name')");
    const iTrio = home.indexOf("mkMode(t('mode.trio.name')");
    for (const [what, at] of [['热坐', iHot], ['联机', iLobby], ['单人', iSolo], ['三人', iTrio]] as const) {
      expect(at, `模式页源码里找不到「${what}」那张卡（判据 ① 会因此变成"把页面删空也绿"）`)
        .toBeGreaterThanOrEqual(0);
    }
    expect(iHot, '热坐卡不在第一张').toBeLessThan(iLobby);
    expect(iLobby, '联机卡不在热坐之后').toBeLessThan(iSolo);
    expect(iSolo, '单人卡不在联机之后').toBeLessThan(iTrio);
    // 热坐卡的**行为**一行未改（红线：热座观感零变化）；文案现在是文案键
    expect(home, '热坐卡的文案键被改动了')
      .toContain("mkMode(t('mode.hotseat.name'), t('mode.hotseat.desc'), true, () => {");
    expect(home, '热坐卡不再调用 nav.startHotseat(banBox.checked, randomBox.checked)')
      .toContain('nav.startHotseat(banBox.checked, randomBox.checked)');
    // ★ G5/T41 第 1 条：**设备体检**按钮（不是模式卡，住在 mode-actions 那一区）仍在
    expect(home, '模式选择页没有「设备体检」按钮（用户 2026-09-27 第 1 条）')
      .toContain("button('btn mode-probe-btn', t('mode.device-check'), nav.openDeviceCheck)");
    // 它不是游戏模式：这一行不许碰 renderMode / state（只跳转）
    expect(home.split('\n').find((l) => l.includes('mode-probe-btn')) ?? '',
      '设备体检按钮那一行碰了 renderMode / state（它不该是游戏模式）')
      .not.toMatch(/renderMode|\bstate\b/);
    // 函数签名回到两个形参（`root` / `nav`），不再是三个
    expect(home, 'renderModeSelect 的签名还不是"两个形参"'
      + '（第三个开发者闸门形参没删干净）')
      .toMatch(/export function renderModeSelect\(root: HTMLElement, nav: ModeSelectNav\): void \{/);

    // ── ③ 反向：**共用的联机那套一个字都没少** ───────────────────────────────────
    // 三个入口仍在 nav 里（删的只有第四个：预览）
    expect(functionBody(main, 'showModeSelect'), '联机大厅入口不见了（删预览时把共用入口带走了？）')
      .toContain('startNetLobby:');
    expect(main, "main.ts 不再把 renderMode 切成 'net'（联机进牌桌画不出远程页）")
      .toMatch(/renderMode\s*=\s*'net'/);
    // `renderMode === 'net'` 那条渲染支路与它的四个要素（第 6 条逐条断言）仍在这份源码里
    for (const needle of ['renderNetBoard(', 'viewSeat: netViewSeat', 'onPreviewChange', 'verifyHooks: dev']) {
      expect(main.includes(needle), `删预览时把共用渲染路径的一部分带走了：${needle}`).toBe(true);
    }
  });
});
