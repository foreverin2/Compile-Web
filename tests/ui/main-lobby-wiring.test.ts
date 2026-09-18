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
 *  2. **结构腿一个字都没动**：剥注释后 `driver.submit(` 恰 8 处、`renderApp(root, state, cb)` 恰 1 处、
 *     `renderMode = 'hotseat'` 恰 2 处、`rerender` 里 `renderMode === 'replay'` 恰 1 处；
 *  3. ★ **实现顺序约束**：新入口排在 `startNetPreview` **之前**（D24；见 `net-preview-wiring.test.ts:210-213`）；
 *  4. 大厅符号**没有**溢进 `cb` / `applyRearrangeSwap` / `runAutoAdvance` 三个函数体。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { stripComments, functionBody, objectBody } from './source-text';

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

  it('2. 新入口 `startNetLobby` 存在，且**必须排在 `startNetPreview` 之前**（D24 的顺序约束）', () => {
    const mode = functionBody(MAIN, 'showModeSelect');
    expect(mode, 'showModeSelect 里没有 startNetLobby').toContain('startNetLobby');
    expect(mode, 'showModeSelect 里没有 startNetPreview（预览入口被弄丢了？）').toContain('startNetPreview');
    const iLobby = mode.indexOf('startNetLobby:');
    const iPreview = mode.indexOf('startNetPreview:');
    expect(iLobby, '找不到 startNetLobby: 的键（入口写法变了？）').toBeGreaterThanOrEqual(0);
    expect(iPreview, '找不到 startNetPreview: 的键').toBeGreaterThanOrEqual(0);
    // ★ 这条就是 D24 那条实现顺序约束：`net-preview-wiring.test.ts:210-213` 用
    //   `mode.slice(mode.indexOf('startNetPreview:'))` 切片 ⇒ 排在后面会让那段切片被新入口满足。
    expect(
      iLobby,
      'startNetLobby 排在 startNetPreview **之后**：net-preview-wiring.test.ts:210-213 的 indexOf 切片'
      + '会被拉长到含新入口 ⇒ 它仍绿，但测的已经不是原来那件事（失焦）',
    ).toBeLessThan(iPreview);
    // 顺序约束的**外部自证**：把切片照那条腿的写法真的切一遍，切片里不许出现新入口的符号
    const previewSlice = mode.slice(iPreview);
    expect(previewSlice, 'startNetPreview 之后的切片里出现了 startNetLobby（失焦的证据）')
      .not.toContain('startNetLobby');
    // 新入口只写第四值，**不许**写 `renderMode = 'hotseat'`（那两个字面量点各有腿在数）
    const lobbySlice = mode.slice(iLobby, iPreview);
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
  it('5. `driver.submit(` 恰 8 处（7 类动作 + 1 处重排），且逐处落在两个函数体里', () => {
    const cbBody = objectBody(MAIN, CB_HEAD);
    const swapBody = functionBody(MAIN, 'applyRearrangeSwap');
    const total = offsetsOf(MAIN, 'driver.submit(').length;
    expect(total, `driver.submit( 出现 ${total} 处（1 处重排 + 7 类动作 ≥ 8）`).toBe(8);
    // 逐处分类：任何一处落在这两个函数体之外就报红并指名
    const cbAt = MAIN.indexOf(CB_HEAD);
    const cbEnd = cbAt + cbBody.length;
    const swapAt = MAIN.indexOf(swapBody);
    const swapEnd = swapAt + swapBody.length;
    const outside = offsetsOf(MAIN, 'driver.submit(')
      .filter((i) => !(i >= cbAt && i < cbEnd) && !(i >= swapAt && i < swapEnd));
    expect(outside.map((i) => MAIN.slice(i, i + 40)), '有 driver.submit( 落在 cb / applyRearrangeSwap 之外')
      .toEqual([]);
    expect((cbBody.match(/driver\.submit\(/g) ?? []).length, 'cb 里的提交点').toBeGreaterThanOrEqual(7);
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

describe('G5 T8 · 正控（防这几条腿恒真）', () => {
  it('9. 分类器与计数器对**合成源码**照样有牙', () => {
    // ① 顺序判据：造一份"新入口排在预览之后"的合成主干 ⇒ 判据必须能报出它
    const bad = "const nav = { startNetPreview: () => {}, startNetLobby: () => { renderMode = 'lobby'; } };";
    const iLobby = bad.indexOf('startNetLobby:');
    const iPreview = bad.indexOf('startNetPreview:');
    expect(iLobby, '正控构造失败：合成源码里新入口竟然排在前面').toBeGreaterThan(iPreview);
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
