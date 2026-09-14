import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { stripComments } from './source-text';

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

/** 取 `function <name>` 的**花括号配平**函数体（含函数头）。
 *
 *  为什么必须配平而不是"切到文件尾"：`main.ts` 的顶层函数之间还有别的顶层声明，
 *  切到文件尾会把后续函数的文本也算进"体内"（顺序断言会因此假绿）。
 *  配平时字符串/模板串按整段跳过（`template`/`${}` 里可能出现花括号）。
 */
function functionBody(src: string, name: string): string {
  const at = src.indexOf(`function ${name}(`);
  expect(at, `找不到 function ${name}（结构被改动？）`).toBeGreaterThanOrEqual(0);
  const open = src.indexOf('{', at);
  expect(open, `找不到 function ${name} 的函数体起始 {`).toBeGreaterThan(at);
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === "'" || ch === '"' || ch === '`') {
      const quote = ch;
      i += 1;
      while (i < src.length) {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === quote) break;
        i += 1;
      }
      continue;
    }
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return src.slice(at, i + 1);
    }
  }
  throw new Error(`function ${name} 的花括号不配平`);
}

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

  it('3. main.ts 定义 rerender()，且裸 renderApp( 的出现次数降到 2 处（每处都列出来）', () => {
    const code = mainSrc();
    expect(code, 'main.ts 未定义 rerender（页面路由的唯一入口）').toMatch(/\bfunction rerender\(\)/);
    const sites = occurrences(code, 'renderApp(');
    /**
     * 上限 = 2，两处都是**有意保留**的，逐条说明（不是为了数字好看硬改）：
     *   (a) `rerender()` 自身定义体内的**唯一**一处 `renderApp(root, state, cb)` ——
     *       它就是"回退到热座页"的那一条分支，删掉它就没有回退路径了；
     *   (b) `initDevMode({ …, render: () => renderApp(root, state, cb) })` ——
     *       开发者模式的 Ctrl+Shift+P 调试命令（`get <牌名>`）注入的重绘回调。
     *       保留理由：它是**调试专用**的旁路（生产玩家不可达），且 devmode 的调用契约
     *       就是一个同步重绘函数；改成 `rerender()` 属于"顺手扩大改动面"，
     *       而 Task 4 的红线是**热座路径零变化**（见简报 §8）。它的已知代价如实记在报告里：
     *       开发者带 `renderMode === 'net'` 时用 devmode 加牌会把页面画回热座棋盘
     *       —— 恢复方式是再触发一次状态变更（或返回主界面），不会破坏状态。
     * ⚠️ 注意判据是**去注释后**的源码（`mainSrc()`）：`rerender()` 的 JSDoc 里为了可读性
     * 写着 `renderApp(root, state, cb)`，若按裸源码计数会得到 3 处而误报。
     */
    expect(sites.length, `main.ts 里 renderApp( 出现 ${sites.length} 处（上限 2：rerender 回退分支 + devmode 注入）：\n`
      + sites.join('\n')).toBeLessThanOrEqual(2);
    // 反向：这两处必须在场（否则说明有人把回退分支也删了 → rerender 在热座模式下不画任何东西）
    expect(sites.length, '主渲染路径整体消失（rerender 无回退分支？）').toBeGreaterThanOrEqual(1);
    expect(code, 'rerender 里没有 renderApp 回退分支（热座模式将渲染不出任何东西）')
      .toMatch(/renderApp\(root,\s*state,\s*cb\)/);
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

  it('6. 预览入口：home.ts 的模式卡 + main.ts 的 startNetPreview 三件事', () => {
    const home = stripComments(read('src/ui/home.ts'));
    expect(home, 'ModeSelectNav 未定义 startNetPreview（宿主无法接上预览入口）')
      .toMatch(/startNetPreview\s*\(/);
    expect(home, '模式选择页未加预览卡（用户无法进入远程页预览）').toContain('单视角预览（本地）');
    // **恰好一张**预览卡：断言"列表里加一张卡"，两张会让模式选择页出现两个入口
    const PREVIEW_CARD = "'单视角预览（本地）'";
    expect((home.match(new RegExp(PREVIEW_CARD.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) ?? []).length,
      '预览卡必须**恰好一张**（模式卡名字面量出现次数不符）').toBe(1);
    // 预览卡必须在热坐卡**之后**（它是热坐流程的布局变体，视觉上从属）
    const iPreview = home.indexOf(PREVIEW_CARD);
    expect(iPreview, '找不到预览卡的名字面量').toBeGreaterThanOrEqual(0);
    expect(iPreview, '预览卡排在热坐卡之前（模式选择页的层级被改）')
      .toBeGreaterThan(home.indexOf("mkMode('热坐（双人）'"));
    // 热坐卡的文案与行为**一行未改**（本任务红线：热座观感零变化）
    expect(home, '热坐卡的文案被改动了（本任务不得动热座路径）')
      .toContain("mkMode('热坐（双人）', '两名玩家轮流在同一设备上对战（当前可用）', true, () => {");
    expect(home, '热坐卡不再调用 nav.startHotseat(banBox.checked, randomBox.checked)')
      .toContain('nav.startHotseat(banBox.checked, randomBox.checked)');

    const main = mainSrc();
    const mode = functionBody(main, 'showModeSelect');
    const net = mode.slice(mode.indexOf('startNetPreview:'));
    expect(net, 'main.ts 未实现 startNetPreview').toBeTruthy();
    expect(net, "startNetPreview 未设 renderMode = 'net'（预览会画成热座棋盘）")
      .toMatch(/renderMode\s*=\s*'net'/);
    expect(net, "startNetPreview 未设 netHandVisibility = 'viewSeat'（验收第 1 项要看的形态丢失）")
      .toMatch(/netHandVisibility\s*=\s*'viewSeat'/);
    expect(net, 'startNetPreview 未接收/落地 viewSeat').toMatch(/netViewSeat\s*=\s*viewSeat/);
    expect(net, 'startNetPreview 未沿用现有掷硬币流程（showCoin）').toMatch(/\bshowCoin\(\)/);
    // 预览入口必须传 verifyHooks: true（自查结果显示在工具条上 = 用户可见的运行时证据）
    const rerender = functionBody(main, 'rerender');
    expect(rerender, 'rerender 未传 verifyHooks: true（预览页看不到运行时自查行）')
      .toMatch(/verifyHooks:\s*true/);
    expect(rerender, 'rerender 未传 onPreviewChange（预览工具条完全不渲染 → 无法切视角 / 看自查行）')
      .toMatch(/onPreviewChange/);
    expect(rerender, 'rerender 未按状态传 handVisibility（工具条的切换不生效）')
      .toMatch(/handVisibility:\s*netHandVisibility/);
    expect(rerender, 'rerender 未按状态传 viewSeat').toMatch(/viewSeat:\s*netViewSeat/);
    // 草稿阶段的守卫必须在：预览沿用热座草稿页（否则草稿期会画远程页）
    expect(rerender, "rerender 缺少 state.phase !== 'draft' 守卫（草稿阶段会被画成远程页）")
      .toMatch(/state\.phase\s*!==\s*'draft'/);
  });

  it('7. cb.rerender 已接上（否则远程页里选牌 / 翻面 / 浮层 / 工具条全都没反应）', () => {
    const main = mainSrc();
    // cb 对象字面量里必须提供 rerender —— 转调同一入口，路由规则只有一处
    expect(main, 'cb 里没有提供 rerender（render.ts 的选择浮层会退回 renderApp → 页面被换回热座）')
      .toMatch(/rerender\(\)\s*\{\s*rerender\(\);\s*\}/);
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
});
