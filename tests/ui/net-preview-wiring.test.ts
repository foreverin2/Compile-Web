import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { stripComments, functionBody } from './source-text';

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
    expect(net, 'startNetPreview 未接收/落地 viewSeat').toMatch(/netViewSeat\s*=\s*viewSeat/);
    expect(net, 'startNetPreview 未沿用现有掷硬币流程（showCoin）').toMatch(/\bshowCoin\(\)/);
    // 预览入口必须传 verifyHooks: true（自查结果显示在工具条上 = 用户可见的运行时证据）
    const rerender = functionBody(main, 'rerender');
    expect(rerender, 'rerender 未传 verifyHooks: true（预览页看不到运行时自查行）')
      .toMatch(/verifyHooks:\s*true/);
    expect(rerender, 'rerender 未传 onPreviewChange（预览工具条完全不渲染 → 无法切视角 / 看自查行）')
      .toMatch(/onPreviewChange/);
    expect(rerender, 'rerender 不再传 onPreviewChange / viewSeat / verifyHooks 之一')
      .toMatch(/viewSeat:\s*netViewSeat/);
    // ── G2 Task 4F 终审 · Critical C-2（**必须留在这一组里**）──
    // 手牌可见性**按座位**决定：自己 = 'all'（真实卡、可点），对手 = NET_HAND_VIS（数量占位）。
    // 曾经把两处都写成常量 `NET_HAND_VIS`（='count'），而 `renderHand` 的 'count' 分支是
    // **与 isSelf 无关的无条件提前返回** → 自己的手牌也变成「手牌 ×n」占位、一张 `.card` 都没有
    // → 预览不可玩（而运行时自查照样 ✓）。**判据必须是这个三元映射本身，不能只看出现次数。**
    const netSrcAll = stripComments(read('src/ui/render-net.ts'));
    const selfMap = [...netSrcAll.matchAll(/handVisibility:\s*isSelf\s*\?\s*'all'\s*:\s*NET_HAND_VIS/g)].length;
    expect(selfMap, `render-net.ts 里"自己='all' / 对手=数量占位"的映射有 ${selfMap} 处（应为恰好 2 处：P0 与 P1）`)
      .toBe(2);
    // 草稿阶段的守卫必须在：预览沿用热座草稿页（否则草稿期会画远程页）
    expect(rerender, "rerender 缺少 state.phase !== 'draft' 守卫（草稿阶段会被画成远程页）")
      .toMatch(/state\.phase\s*!==\s*'draft'/);
    // ── G2 Task 4F · I-2 + N4 + D-2 ──
    // 信息遮蔽是**唯一**形态，而且**根本不存在"档位"这个量**：
    // Task 4F 终审 N4 指出 `NetViewOpts.handVisibility` 已成死参数（传 `'all'` 静默无效），
    // 于是把 `netHandVisibility` 常量与那个字段**一起删掉** —— 现在既没有可切取值、也没有可传参数，
    // "预览恒为信息遮蔽"不再依赖"某个 const 恰好等于 'viewSeat'"，而是**结构上不存在别的可能**。
    // （原来的判据是"它是 const 且只能声明一次"，那仍然留着一个可以被读错的入口；删掉更强。）
    expect(main, 'main.ts 仍有 netHandVisibility 档位常量（N4 之后应已删除 —— 死参数比没有更误导）')
      .not.toMatch(/netHandVisibility/);
    expect(stripComments(read('src/ui/render-net.ts')),
      'render-net.ts 的 NetViewOpts 仍有 page 级 handVisibility 档位字段（死参数，N4）')
      .not.toMatch(/^\s*handVisibility:\s*'all'\s*\|\s*'viewSeat'\s*;/m);
    // D-2：devmode 注入必须走唯一入口 `rerender()`（否则远程页里用 devmode 加牌会把页面画回热座）
    const devmodeLines = main.split('\n')
      .map((line, i) => ({ no: i + 1, line: line.trim() }))
      .filter(({ line }) => line.includes('initDevMode('));
    expect(devmodeLines.length, 'main.ts 里 initDevMode( 的调用点数不是 1').toBe(1);
    expect(devmodeLines[0].line, 'devmode 注入未走 rerender()（D-2：远程页里加牌会被画回热座棋盘）')
      .toMatch(/render:\s*\(\)\s*=>\s*rerender\(\)/);
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
