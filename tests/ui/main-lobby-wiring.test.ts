/**
 * G5/T8 守卫：`src/main.ts` 的**大厅接线**（四处最小侵入）+ 一条顺序约束。
 *
 * ## 为什么这个文件以**文本腿**为主（同族的理由写在 `main-driver-wiring.test.ts:5-21`）
 *
 * `src/main.ts` 是**应用入口**：它一被 import 就会执行 `document.getElementById('app')`、
 * `createGame()`、`initEffects()` … 最后 `showStartScreen()` ⇒ "import 它"等于**把整个游戏跑起来**
 * （要真 DOM、真 body 级特效层、真 rAF）。而本仓测试环境是 `node`、**没有 jsdom**。
 *
 * ⚠️ 所以本文件**只** `readFileSync` 读 `main.ts` 的源码文本，**绝不** `import '../../src/main'`。
 * 大厅的**行为**腿在 `tests/ui/net-lobby.test.ts`（那一个文件可以在 DOM 桩上真跑渲染与握手）。
 *
 * ## 它钉的是什么（逐条对上任务书 §1.2 与 §2 判据 4）
 *
 *  1. 四处最小侵入各自到位（`renderMode` 第四值 / 新入口 / `rerender` 分支 / 复位）；
 *  2. **结构腿按 T12 的新数字**：剥注释后 `driver.submit(` 恰 9 处（8 类动作 + 1 处重排；
 *     T12 加的那一处是 `cb.onDraftPick`，理由见第 5 条腿）、`renderApp(root, state, cb)` 恰 1 处、
 *     `renderMode = 'hotseat'` 恰 2 处、`rerender` 里 `renderMode === 'replay'` 恰 1 处；
 *  3. ★ **nav 键顺序**：`startNetLobby` 排在 `startHotseat` 之后（D24 那条实现顺序约束剩下的
 *     一半；2026-10-01 删掉「单视角预览」那个模式之后，它的右操作数 `startNetPreview` 不存在了,
 *     见第 2 条里的说明）；
 *  4. 大厅符号**没有**溢进 `cb` / `applyRearrangeSwap` / `runAutoAdvance` 三个函数体。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { stripComments, functionBody, objectBody, braceBlock } from './source-text';

const MAIN = stripComments(
  readFileSync(fileURLToPath(new URL('../../src/main.ts', import.meta.url)))
    .subarray(0, 8 * 1024 * 1024).toString('utf8'),
);
const CB_HEAD = 'const cb: UiCallbacks = ';

/** 某个 token 的全部出现（1-based 行号 + 该行）——失败信息里指名道姓 */
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

describe('G5 T8 · main.ts 的四处最小侵入', () => {
  it('1. `renderMode` 有了第四个值 `lobby`（联合类型 + 一个字面量点）', () => {
    // 联合类型扩宽：原文 `'hotseat' | 'net' | 'replay'` ⇒ 现在尾部多一个 `| 'lobby'`
    expect(MAIN, "renderMode 的联合类型里没有第四个值 'lobby'").toContain("| 'lobby'");
    // 反空转：那一行确实是 `renderMode` 的声明（不是别处的巧合）
    const decl = occurrences(MAIN, "let renderMode:");
    expect(decl.length, `renderMode 的声明点数量：\n${decl.join('\n')}`).toBe(1);
    expect(decl[0], '第四值不在 renderMode 的声明行上').toMatch(/let renderMode:[^;]*'lobby'/);
    // 反向：**不许**改成 `string`（那会把"哪些页面"这件事实从类型里抹掉）
    expect(MAIN, 'renderMode 被放宽成了 string（联合类型的判别力没了）').not.toMatch(/let renderMode:\s*string/);
  });

  it('2. 新入口 `startNetLobby` 存在，排在 `startHotseat` 之后，且只写第四值 `lobby`', () => {
    const mode = functionBody(MAIN, 'showModeSelect');
    expect(mode, 'showModeSelect 里没有 startNetLobby').toContain('startNetLobby');
    const iLobby = mode.indexOf('startNetLobby:');
    const iHotseat = mode.indexOf('startHotseat:');
    expect(iLobby, '找不到 startNetLobby: 的键（入口写法变了？）').toBeGreaterThanOrEqual(0);
    expect(iHotseat, '找不到 startHotseat: 的键').toBeGreaterThanOrEqual(0);
    /**
     * ★ 这条是原 D24 顺序约束**剩下的那一半**。
     *
     * ⚠️ **2026-10-01（用户要求）的成组改动**：原先它是「`startNetLobby` 必须排在
     * `startNetPreview` 之前」，理由是"nav 键顺序与 `home.ts` 源码里的模式卡顺序
     * （热坐 → 联机 → 预览）一致"。用户要求把「单视角预览（仅开发）」那个模式整个删掉
     * （入口 / 启动路径 / 死代码一起走）⇒ nav 里**没有** `startNetPreview:` 这个键了，
     * 那条比较失去右操作数。
     *
     * 判据**换成仍然成立的那一条**（不是放宽成"只要存在就行"）：nav 键顺序与 `home.ts`
     * 里模式卡的顺序一致 ⇒ `startHotseat:` 必须排在 `startNetLobby:` 之前
     * （热坐是第一张卡、联机是第二张）；区间上界取函数体末尾。
     * 同一条腿再加一条反空转的存在性判据：**`startNetPreview` 这个键不许再出现**
     * （它复活时这里当场红，`tests/ui/net-preview-wiring.test.ts` 的锚点腿也会红）。
     */
    expect(iHotseat, 'startNetLobby 排在 startHotseat **之前**：nav 键顺序与 home.ts 里'
      + '「热坐 → 联机 → 单人 → 三人」的卡顺序不一致').toBeLessThan(iLobby);
    // 那条被删掉的预览接线：**不许**在任何地方留下键（留一个没有模式卡的键就是死接线）
    expect(mode, 'showModeSelect 里又出现了 startNetPreview:（被删掉的预览模式复活了）')
      .not.toContain('startNetPreview');
    // 新入口只写第四值，**不许**写 `renderMode = 'hotseat'`（那两个字面量点各有腿在数）
    const lobbySlice = mode.slice(iLobby);
    expect(lobbySlice, '大厅入口里写了 renderMode = hotseat（会撞上那两条计数腿）')
      .not.toMatch(/renderMode\s*=\s*'hotseat'/);
    expect(lobbySlice, "大厅入口没有把 renderMode 切成 'lobby'").toMatch(/renderMode\s*=\s*'lobby'/);
    // 大厅**不进**掷硬币流程（它是独立屏，没有 state）
    expect(lobbySlice, '大厅入口调了 showCoin（那会把大厅拉进热座流程）').not.toContain('showCoin');
  });

  it('3. `rerender` 里有 `lobby` 分支，且它排在 `renderApp(root, state, cb)` 之前', () => {
    const body = functionBody(MAIN, 'rerender');
    expect(body, "rerender 没有 'lobby' 分支（大厅那一屏画不出来）").toMatch(/renderMode === 'lobby'/);
    const iLobby = body.indexOf("renderMode === 'lobby'");
    const iRender = body.indexOf('renderApp(root, state, cb)');
    expect(iRender, 'rerender 里找不到 renderApp(root, state, cb)').toBeGreaterThanOrEqual(0);
    expect(iLobby, 'lobby 分支排在 renderApp 之后（早退失去意义，大厅会被热座棋盘覆盖）')
      .toBeLessThan(iRender);
    // 大厅分支必须**早退**（否则 renderApp 会接着把热座棋盘画上去）
    const slice = body.slice(iLobby, iRender);
    expect(slice, 'lobby 分支里没有 return（renderApp 会接着画热座盘）').toMatch(/return;/);
    // ⚠️ 结构腿：全文件 `renderApp(` 仍恰 1 处（大厅分支**不许**自己也调它）
    const sites = occurrences(MAIN, 'renderApp(');
    expect(sites.length, `renderApp( 出现 ${sites.length} 处（上限 1：唯一入口）：\n${sites.join('\n')}`).toBe(1);
  });

  it('4. `resetToMainInterface` 复位了大厅那两份模块态', () => {
    const body = functionBody(MAIN, 'resetToMainInterface');
    expect(body, 'resetToMainInterface 没有 dispose 大厅客户端（下一局会接着上一局的会话跑）')
      .toMatch(/lobbyClient\?\.dispose\(\);/);
    expect(body, 'resetToMainInterface 没有把 lobbyClient 置空').toMatch(/lobbyClient = null;/);
    expect(body, 'resetToMainInterface 没有把 lobbyMode 置空').toMatch(/lobbyMode = null;/);
    // 反向：复位**必须排在** `showHome()` 之前（与那一节自己的纪律同款：无中间态）
    const iReset = body.indexOf('lobbyClient = null;');
    const iHome = body.indexOf('showHome();');
    expect(iHome, 'resetToMainInterface 里找不到 showHome()').toBeGreaterThanOrEqual(0);
    expect(iReset, '大厅复位排在 showHome() 之后（"主页面已在屏上、模式还没复位"那个中间态回来了）')
      .toBeLessThan(iHome);
  });
});

describe('G5 T8 · 结构腿一个字都没动（剥注释口径）', () => {
  it('5. `driver.submit(` 恰 9 处（8 类动作 + 1 处重排），且逐处落在两个函数体里', () => {
    const cbBody = objectBody(MAIN, CB_HEAD);
    const swapBody = functionBody(MAIN, 'applyRearrangeSwap');
    const total = offsetsOf(MAIN, 'driver.submit(').length;
    /**
     * ★ **G5 T12：8 -> 9**（任务书 §3 第 4 条明写"既有守卫按新数字改，并在提交信息里写明
     * 为什么 +1"）。第 9 处是 **`cb.onDraftPick`** —— 草稿选牌从 T12 起走应用层的
     * `'draft-pick'` 动作（用户裁决 A），于是它必须提交给当前驱动（`src/main.ts` 里那一行
     * `const r = driver.submit(state, { player, kind: DRAFT_PICK_KIND, args: { defId } });`）。
     * 逐处分类仍然要求它落在 `cb` 里：`cb.onAction` 从 7 处不变，`cb` 整体从 7 变 8。
     */
    expect(total, `driver.submit( 出现 ${total} 处（1 处重排 + 8 类动作 = 9）`).toBe(9);
    // 逐处分类：任何一处落在这两个函数体之外就报红并指名
    const cbAt = MAIN.indexOf(CB_HEAD);
    const cbEnd = cbAt + cbBody.length;
    const swapAt = MAIN.indexOf(swapBody);
    const swapEnd = swapAt + swapBody.length;
    const outside = offsetsOf(MAIN, 'driver.submit(')
      .filter((i) => !(i >= cbAt && i < cbEnd) && !(i >= swapAt && i < swapEnd));
    expect(outside.map((i) => MAIN.slice(i, i + 40)), '有 driver.submit( 落在 cb / applyRearrangeSwap 之外')
      .toEqual([]);
    expect((cbBody.match(/driver\.submit\(/g) ?? []).length, 'cb 里的提交点').toBeGreaterThanOrEqual(8);
    expect((swapBody.match(/driver\.submit\(/g) ?? []).length, 'applyRearrangeSwap 里的提交点').toBe(1);
  });

  it('6. `renderMode = \'hotseat\'` 仍恰 2 处（showModeSelect 的 startHotseat 与 resetToMainInterface）', () => {
    const hits = occurrences(MAIN, "renderMode = 'hotseat'");
    expect(
      hits.length,
      `进入热座的入口数量变了（${hits.length} 处）—— 大厅入口不许再写第三处这个字面量：\n${hits.join('\n')}`,
    ).toBe(2);
    // 两处各自的归属（生成式：按函数体切一遍，不靠行号）
    expect(functionBody(MAIN, 'showModeSelect'), 'showModeSelect 里那一处没了')
      .toContain("renderMode = 'hotseat'");
    expect(functionBody(MAIN, 'resetToMainInterface'), 'resetToMainInterface 里那一处没了')
      .toContain("renderMode = 'hotseat'");
  });

  it('7. `rerender` 里 `renderMode === \'replay\'` 仍恰 1 处，且在 renderApp 之后', () => {
    const body = functionBody(MAIN, 'rerender');
    const n = (body.match(/renderMode === 'replay'/g) ?? []).length;
    expect(n, `rerender 里 renderMode === 'replay' 出现 ${n} 处（应为恰好 1：主驱动腿用 indexOf 取第一处再切片）`)
      .toBe(1);
    const iRender = body.indexOf('renderApp(root, state, cb)');
    const iReplay = body.indexOf("renderMode === 'replay'");
    expect(iReplay, 'replay 分支排在 renderApp 之前（重放页会早退成空白）').toBeGreaterThan(iRender);
  });

  it('8. `cb` / `applyRearrangeSwap` / `runAutoAdvance` 三个函数体里零命中大厅符号', () => {
    const bodies: Array<[string, string]> = [
      ['cb', objectBody(MAIN, CB_HEAD)],
      ['applyRearrangeSwap', functionBody(MAIN, 'applyRearrangeSwap')],
      ['runAutoAdvance', functionBody(MAIN, 'runAutoAdvance')],
    ];
    for (const [name, body] of bodies) {
      expect(body.length, `${name} 抽到空片段 ⇒ 本判据假绿`).toBeGreaterThan(50);
      for (const sym of ['lobby', 'net-lobby', 'renderNetLobby', 'lobbyClient']) {
        expect(body.includes(sym), `${name} 里出现了大厅符号「${sym}」（改动溢出了）`).toBe(false);
      }
    }
    // 反向：抽出来的确实是那三个东西（防"切错了、切出空片段"）
    expect(bodies[0][1], 'cb 片段里没有 onWinReset（切错了）').toContain('onWinReset');
    expect(bodies[1][1], 'applyRearrangeSwap 片段里没有 driver.submit(').toContain('driver.submit(');
    expect(bodies[2][1].length, 'runAutoAdvance 片段太短').toBeGreaterThan(80);
  });
});

describe('G5 T8 · D 轮：大厅那份 env 与"造传输用的那一份"是同一份', () => {
  /**
   * ## 这条腿为什么必须是**文本腿**（说清楚它的能力边界，别高估）
   *
   * I-1 / I-2 的缺陷形状是"**能力注进了另一份环境**"，而 `main.ts` 是应用入口，
   * 一 import 就把整个游戏跑起来（见文件头注）⇒ 本仓**没有任何行为腿**能观察
   * "`createTransport` 用的那份 env 里到底有没有那两样"。端到端腿也不行：
   * `tests/ui/g5-lobby-e2e.test.ts` 里那份 env 是**夹具自己写的**，与 `main.ts` 无关
   * （实测：把这里的注入撤掉，那条腿**照绿**；这也是它红了才叫证据的原因）。
   *
   * ⇒ 这里用"**能力清单**"这条文本判据把回路堵上：它问的不是"某一行文本在不在"，
   * 而是"那份 env 的**能力集合**与 `createTransport` 真正吃到的是不是同一份"。
   * 它能抓的是"少注一样 / 注到另一份上"这一类**静默失效**；抓不到"环境对象造错了"。
   */
  const envBody = functionBody(MAIN, 'lobbyEnv');

  it('10. `lobbyEnv()` 同时给出 `settings` / `ticker` / `onPeerConnection` 三样能力', () => {
    // ★ 三样各自都是"某个调用点唯一的来源"：settings（读设置）、ticker（等 ICE 的上界）、
    //   onPeerConnection（把造出来的那条连接交回房主那格）。少任何一样都**不报错**，只是静默失效。
    for (const key of ['settings', 'ticker', 'onPeerConnection']) {
      expect(envBody, `lobbyEnv() 里没有 ${key}（这一样能力会静默失效：没有调用点会报错）`).toContain(key);
    }
    // 反空转：抽出来的确实是那个函数（切错了会得到空片段 ⇒ 上面三条恒假）
    expect(envBody.length, 'lobbyEnv 的片段太短（切错了？）').toBeGreaterThan(40);
    expect(envBody, 'lobbyEnv 的片段里没有 return（这不是那个环境工厂）').toContain('return {');
    // `peerConnection` 那一样**不许**出现在这里：浏览器 API 的唯一出处是 net-browser.ts（D6）
    expect(envBody, 'main.ts 里出现了 peerConnection 构造（D6：那个名字只能住在 net-browser.ts）')
      .not.toMatch(/peerConnection\s*:/);
  });

  it('11. 全文件**只有一份**环境工厂，且 `createTransport` / `buildInvite` 用的就是它', () => {
    // ① "第二份环境"正是 I-1 / I-2 的根因 ⇒ 这里的计数腿直接钉死它不许回来
    const factories = occurrences(MAIN, 'function lobbyEnv');
    expect(
      factories.length,
      `lobbyEnv 被声明了 ${factories.length} 处：多出来的第二份环境会让"能力注到哪一份上"再次分叉`
      + `（I-1 / I-2 就是这个形状）:\n${factories.join('\n')}`,
    ).toBe(1);
    // ② 造传输的那一处必须用**这一份**（改成别的名字就等于又把能力分叉出去）
    const start = functionBody(MAIN, 'startLobby');
    expect(start, 'startLobby 里没有 createTransport').toContain('createTransport');
    expect(
      start,
      'createTransport 用的不是 lobbyEnv()：造出来的传输拿不到 ticker / onPeerConnection',
    ).toContain('createTransport: () => createBrowserTransport(lobbyEnv())');
    // ③ 反面：一个**形状相同但缺能力**的第二份环境不许再出现（`lobbyEnvWithIce` 那个名字就是它）
    expect(
      occurrences(MAIN, 'lobbyEnvWithIce').length,
      'lobbyEnvWithIce 又回来了（D 轮把它并掉了：两份环境正是 I-1 / I-2 的根因）',
    ).toBe(0);
    // ④ `init()` 回执那一格确实被写下来（否则 `onPeerConnection` 注了也没人接）
    expect(MAIN, 'onPeerConnection 的回执没有落到 hostPeerConnection 上')
      .toMatch(/onPeerConnection:\s*\(pc\)\s*=>\s*\{\s*hostPeerConnection\s*=\s*pc;?\s*\}/);
  });

  it('12. 正控：往合成源码里塞"第二份环境" ⇒ 上面那条计数腿必须能报出来', () => {
    const fake = `${MAIN}\nfunction lobbyEnv() { return {}; }\n`;
    expect(occurrences(fake, 'function lobbyEnv').length, '正控：合成源码里多加的那份环境没被数到').toBe(2);
    const fakeMissing = "function lobbyEnv(): NetBrowserEnv { return { settings: () => netSettings }; }";
    expect(functionBody(fakeMissing, 'lobbyEnv').includes('ticker'), '正控：缺 ticker 的合成环境竟然被判成齐了')
      .toBe(false);
  });
});

/* ============================================================================
 * ★ 2026-10-02（英文模式真机走查 C）：选角色那一格上「高级 / 连接设置」点不开
 *
 * ## 缺陷（走查实测）
 *
 * 在**选角色那一格**（`role === null`）点 `.net-lobby-advanced-toggle`：`aria-expanded` 仍是
 * `false`、面板也不进 DOM；进了房主/加入那一格再点就正常。根因是那一刻 `lobbyClient` 还是
 * `null`，而接线写的是 `lobbyClient?.toggleAdvanced()`（`?.` 把整件事吞成空操作），
 * 渲染用的 `lobbyEntryState()` 又把 `advancedOpen` 硬写成 `false`。
 *
 * ## 修法与判据
 *
 * 入口那一屏的折叠位改住**宿主侧**（`lobbyEntryAdvancedOpen`）：`lobbyClient` 还没建时它是
 * 唯一的状态源，建了之后照旧归客户端（`createLobbyClient` 里的初值仍是 `false`，
 * 那条"初值恰好一处"的腿在 `tests/ui/net-lobby.test.ts` 里不动）。
 *
 * `main.ts` 是应用入口（import 它等于把整个游戏跑起来，见文件头注）⇒ 这里**仍然是文本腿**：
 * 它钉的是"那条接线真的有一个 `null` 分支、且渲染读的是那一位"。**行为**那一半在
 * `tests/ui/net-lobby.test.ts`（`role === null` + `advancedOpen: true` ⇒ 面板进 DOM）。
 * ========================================================================== */

describe('★ 2026-10-02（走查 C）：入口那一屏的「高级 / 连接设置」不再是死开关', () => {
  const body = functionBody(MAIN, 'lobbyEntryState');

  it('`lobbyEntryState()` 的 `advancedOpen` 读的是那一份宿主侧折叠位（不再是字面量 false）', () => {
    expect(body.length, 'lobbyEntryState 抽到空片段 ⇒ 本判据假绿').toBeGreaterThan(50);
    expect(body, '入口那一屏的 advancedOpen 又写成了字面量 false（走查 C 的缺陷形状）')
      .not.toMatch(/advancedOpen:\s*false/);
    expect(body, '入口那一屏没有读那份宿主侧折叠位').toContain('advancedOpen: lobbyEntryAdvancedOpen,');
  });

  it('`toggleAdvanced` 的接线有 `lobbyClient === null` 分支（否则选角色时又被 `?.` 吞掉）', () => {
    const at = MAIN.indexOf('toggleAdvanced:');
    expect(at, '找不到 toggleAdvanced 的接线').toBeGreaterThanOrEqual(0);
    const block = braceBlock(MAIN, at);
    expect(block.length, 'toggleAdvanced 的块抽到空片段 ⇒ 本判据假绿').toBeGreaterThan(50);
    expect(block, '接线里没有 "客户端还没建" 这一支').toMatch(/if\s*\(\s*lobbyClient\s*===\s*null\s*\)/);
    expect(block, '那一支没有翻转宿主侧折叠位').toContain('lobbyEntryAdvancedOpen = !lobbyEntryAdvancedOpen');
    expect(block, '客户端已建的那一支没走它自己的 toggleAdvanced()').toContain('lobbyClient.toggleAdvanced()');
    // 反向：不许再退回"整个动作被 `?.` 吞掉"的那个形状
    expect(block, '接线退回了 `lobbyClient?.toggleAdvanced()`（选角色时点它还是没反应）')
      .not.toContain('lobbyClient?.toggleAdvanced()');
  });

  it('那份折叠位**只声明一处**、且在离开大厅时复位（下一局从"收起"开始）', () => {
    const decls = occurrences(MAIN, 'let lobbyEntryAdvancedOpen');
    expect(decls.length, `lobbyEntryAdvancedOpen 被声明了 ${decls.length} 处：\n${decls.join('\n')}`).toBe(1);
    const leave = functionBody(MAIN, 'leaveLobbyModule');
    expect(leave, 'leaveLobbyModule 没有复位那份折叠位（下次进大厅会带着上一局的展开态）')
      .toContain('lobbyEntryAdvancedOpen = false;');
  });

  it('正控：把接线改回"被 `?.` 吞掉"的形状 ⇒ 上面第二条腿必须能报出来', () => {
    const broken = MAIN.replace(
      /if \(lobbyClient === null\) lobbyEntryAdvancedOpen = !lobbyEntryAdvancedOpen;\s*\n\s*else lobbyClient\.toggleAdvanced\(\);/,
      'lobbyClient?.toggleAdvanced();',
    );
    expect(broken, '正控构造失败：没有把接线改回缺陷形状').not.toBe(MAIN);
    const at = broken.indexOf('toggleAdvanced:');
    const block = braceBlock(broken, at);
    expect(/if\s*\(\s*lobbyClient\s*===\s*null\s*\)/.test(block), '正控：改回缺陷形状之后判据居然是绿的').toBe(false);
    // 另一条：把 lobbyEntryState 的字段改回字面量 false ⇒ 第一条腿必须能报出来
    const broken2 = MAIN.replace('advancedOpen: lobbyEntryAdvancedOpen,', 'advancedOpen: false,');
    expect(broken2, '正控构造失败：没有把 advancedOpen 改回字面量').not.toBe(MAIN);
    expect(broken2.includes('advancedOpen: lobbyEntryAdvancedOpen,')).toBe(false);
  });
});

describe('G5 T8 · 正控（防这几条腿恒真）', () => {  it('9. 分类器与计数器对**合成源码**照样有牙', () => {
    // ① 顺序判据：造一份"联机入口排在热坐之前"的合成主干 ⇒ 判据必须能报出它
    //    （2026-10-01 起右操作数是 `startHotseat:` —— 见第 2 条的说明）
    const bad = "const nav = { startNetLobby: () => { renderMode = 'lobby'; }, startHotseat: () => {} };";
    const iLobby = bad.indexOf('startNetLobby:');
    const iHotseat = bad.indexOf('startHotseat:');
    expect(iLobby, '正控构造失败：合成源码里联机入口竟然排在热坐之后').toBeLessThan(iHotseat);
    expect(/startNetPreview/.test(bad), '正控构造失败：合成源码里还带着已删掉的预览键').toBe(false);
    // ② 计数判据：往合成源码里多塞一处字面量 ⇒ 计数必须变
    const fake = MAIN + "\nrenderMode = 'hotseat';\n";
    expect(occurrences(fake, "renderMode = 'hotseat'").length, '正控：合成源码里多加的那一处没被数到')
      .toBe(3);
    // ③ 函数体切片：往一个**别的**函数里塞大厅符号 ⇒ 溢出判据必须能报出它
    const overflow = MAIN.replace('function runAutoAdvance(', 'function runAutoAdvance(){ void lobbyClient; } function runAutoAdvance(');
    expect(functionBody(overflow, 'runAutoAdvance').includes('lobbyClient'), '正控：注入的溢出没被切进函数体')
      .toBe(true);
  });
});
