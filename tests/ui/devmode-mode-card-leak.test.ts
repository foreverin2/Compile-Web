/**
 * ★★ 2026-10-01（用户报的回归）：「退出双人热座模式后，回到的选择游戏模式页上多出了
 * 「单视角预览（仅开发）」那张卡」—— 那张卡本该**只在开发模式**出现。
 *
 * ## 缺陷本体（本文件钉的就是它）
 *
 * 卡的闸门是对的（`src/ui/home.ts` 的 `if (devUnlocked)`），坏的是**闸门读的那个标记的寿命**：
 * `src/ui/devmode.ts` 的 `passwordUnlocked` 是**模块级会话标记**，注释里写着「本局游戏内」，
 * 可全仓**只有解锁那一处写它**（`tryUnlockDevMode` 只写 `true`）⇒ 解锁一次之后它活到**整页刷新**
 * 为止，跨局、跨屏都不收回。而 `src/main.ts` 的 `showModeSelect()` 把这个标记当第三个实参交给
 * `renderModeSelect` ⇒ 打完一局 / 点「← 退出游戏」回到模式页时，那张卡又出现了。
 *
 * 修法：`devmode.ts` 新增 `resetDevUnlock()`，由 `resetToMainInterface()`（**整局复位的唯一点**：
 * 胜利返回主界面、热座「退出游戏」、重放页出口都走它）在 `showHome()` 之前收回它。
 *
 * ## 判据分两半（都在第 3 条里，缺一不可）
 *
 *  - **源码腿**：`main.ts` 那条真接线（退出按钮的 `onExit` → `resetToMainInterface()` → `showModeSelect()`
 *    里把 `isDevUnlocked()` 交给 `renderModeSelect`）确实在 `showHome()` 之前调了 `resetDevUnlock()`。
 *    `src/main.ts` 是应用入口、在 node 里 import 不了（会当场跑启动流程），所以这一半只能是源码腿 ——
 *    本仓既有的 `tests/ui/net-preview-wiring.test.ts` 头注里写着同一条边界。
 *  - **行为腿**：照那条路径真跑一遍（解锁 → 整局复位 → 把闸门读数交给 `renderModeSelect`），
 *    读**模式卡文案清单本身**。它证明"收回之后页面上真的是玩家那四张"，而不是"函数被调了"。
 *
 * ⚠️ 两条腿**必须一起看**：只有源码腿会退化成"调了个空函数也绿"；只有行为腿会漏掉
 * "宿主根本没在退出路径上调它"（= 本缺陷的真实形态）。
 *
 * ## 反向验证（实测记录，2026-10-01 本机）
 *
 * 把 `main.ts` 里那一行 `resetDevUnlock();` 退回缺陷形态（删掉），本文件第 3 条**当场红**
 * （源码腿 `resetToMainInterface 未收回开发者解锁态`）；把它放回去即绿。第 1、2 条**不红** ——
 * 它们钉的是渲染闸门本身（那一条本来就是对的），说明这组断言不是"一改就全红"的空腿。
 * 三条命令的实测数字见提交信息。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { stripComments, functionBody } from './source-text';
import { descendants, installStubDom, isClass, makeStubEl, type StubNode } from './net-dom-stub';
import { renderModeSelect, type ModeSelectNav } from '../../src/ui/home';
import { isDevUnlocked, resetDevUnlock, tryUnlockDevMode } from '../../src/ui/devmode';

const root = new URL('../../', import.meta.url);
// 与 `tests/ui/net-preview-wiring.test.ts` 同款读法（`.subarray(...).toString('utf8')`：本仓的
// node 类型里 `readFileSync` 返回的是 `Uint8Array`，直接 `.toString('utf8')` 会 TS2554）
const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, root))).subarray(0, 8 * 1024 * 1024).toString('utf8');

/** 普通玩家看到的模式卡清单（逐字，DOM 顺序）—— 用户要的就是这四张 */
const PLAYER_CARDS = ['热坐（双人）', '联机对战（两台设备）', '单人模式', '三人模式'];
/** 开发者模式解锁后才有五张（闸门为真时的清单；这张卡是 devmode 的既有能力，不许被修掉） */
const DEV_CARDS = ['热坐（双人）', '联机对战（两台设备）', '单视角预览（仅开发）', '单人模式', '三人模式'];
const PREVIEW_CARD = '单视角预览（仅开发）';
/** 开发者密码（`devmode.ts` 的 `PASSWORDS` 里那两个之一；这里用纯函数那一半解锁，不走 DOM 密码框） */
const DEV_PASSWORD = '上上下下左右左右BABA';

const navOf = (calls: string[]): ModeSelectNav => ({
  backHome: () => { calls.push('backHome'); },
  openDeviceCheck: () => { calls.push('openDeviceCheck'); },
  startHotseat: () => { calls.push('startHotseat'); },
  startNetLobby: () => { calls.push('startNetLobby'); },
  startNetPreview: () => { calls.push('startNetPreview'); },
});

describe('★ 2026-10-01 · 退出热座之后模式页不许出现「单视角预览（仅开发）」', () => {
  let restoreDom: (() => void) | null = null;
  afterEach(() => { restoreDom?.(); restoreDom = null; });

  /** 真跑一帧模式选择页：返回模式卡文案清单（DOM 顺序 / 与闸门实参同源） */
  const run = (dev: boolean): string[] => {
    const el = makeStubEl('div');
    renderModeSelect(el as unknown as HTMLElement, navOf([]), dev);
    return descendants(el as StubNode).filter((n) => isClass(n, 'mode-card-name')).map((n) => n.text);
  };

  it('1. 非开发态：模式卡文案**逐字**等于玩家那四张（没有预览卡）', () => {
    restoreDom = installStubDom();
    const names = run(false);
    expect(names, `非开发态的模式卡清单：${JSON.stringify(names)}`).toEqual(PLAYER_CARDS);
    expect(names).not.toContain(PREVIEW_CARD);
  });

  it('2. 开发者态仍然是 5 张（防把开发者能力一起删掉）', () => {
    restoreDom = installStubDom();
    const names = run(true);
    expect(names, `开发者态的模式卡清单：${JSON.stringify(names)}`).toEqual(DEV_CARDS);
  });

  /**
   * ★ 本组最承重的一条：**从热座返回这条路**。
   *
   * 走的是产品自己那条路（不是"直接调渲染函数"）：
   *   解锁（`Ctrl+Shift+P` + 密码那一半，纯函数）→ 「← 退出游戏」那两行
   *   （`main.ts`：`installHotseatExit({ onExit: () => { resetToMainInterface(); showModeSelect(); } })`）
   *   → 模式页把 `isDevUnlocked()` 交给 `renderModeSelect`。
   */
  it('3. 从热座退出：整局复位收回开发者态，模式页回到玩家那四张（源码腿 + 行为腿）', () => {
    restoreDom = installStubDom();

    // ── ① 源码腿：退出路径的真接线（`main.ts` 在 node 里 import 不了）────────────────
    const main = stripComments(read('src/main.ts'));
    const exitAt = main.indexOf('installHotseatExit(');
    expect(exitAt, 'main.ts 里找不到 installHotseatExit( —— 退出热座的入口没了？').toBeGreaterThanOrEqual(0);
    const exitCall = main.slice(exitAt, exitAt + 200);
    expect(exitCall, '「退出游戏」的 onExit 不再是"整局复位 + 回模式选择页"（本判据的锚点变了）')
      .toContain('resetToMainInterface()');
    expect(exitCall, '「退出游戏」的 onExit 不再回模式选择页（本判据的锚点变了）')
      .toContain('showModeSelect()');

    const resetBody = functionBody(main, 'resetToMainInterface');
    expect(resetBody.length, 'functionBody 抽到空片段 ⇒ 本判据假绿').toBeGreaterThan(200);
    const iDev = resetBody.indexOf('resetDevUnlock()');
    const iHome = resetBody.indexOf('showHome()');
    expect(iDev, 'resetToMainInterface 没有收回开发者解锁态 —— 解锁一次之后模式页永远带那张卡'
      + '（用户 2026-10-01 报的回归：退出热座后回到的模式页多出「单视角预览（仅开发）」）')
      .toBeGreaterThanOrEqual(0);
    expect(iHome, 'resetToMainInterface 未回主页面（本判据的锚点变了）').toBeGreaterThanOrEqual(0);
    expect(iDev, '收回开发者态排在 showHome() 之后 ⇒ 中间态里"主页面已在屏上、开发者态还没收回"')
      .toBeLessThan(iHome);
    // 收回的**来源**必须是 devmode（不是本地糊一个同名函数）
    expect(main, 'main.ts 未从 ./ui/devmode 引入 resetDevUnlock（收回的是别的东西？）')
      .toMatch(/import \{[^}]*resetDevUnlock[^}]*\} from '\.\/ui\/devmode'/);
    // 闸门这一环仍必须是把 `isDevUnlocked()` 交给 `renderModeSelect`（与
    // `tests/ui/net-preview-wiring.test.ts` 第 6 条同一个锚点；这里再钉一次，让本文件自证"整条链")
    expect(functionBody(main, 'showModeSelect'),
      'showModeSelect 不再把 isDevUnlocked() 交给 renderModeSelect（本判据的链条断了）')
      .toMatch(/renderModeSelect\(root,\s*\{[\s\S]*?\},\s*isDevUnlocked\(\)\)/);

    // ── ② 行为腿：真跑那条路 ──────────────────────────────────────────────────────
    // 解锁（= 用户在浏览器里按 Ctrl+Shift+P 输对密码之后的那一刻）
    expect(tryUnlockDevMode(DEV_PASSWORD), '密码没命中 ⇒ 后面"开发者态"那一半无从判起').toBe(true);
    expect(isDevUnlocked(), '解锁后 isDevUnlocked() 仍是 false（解锁路径本身坏了）').toBe(true);

    /**
     * 「← 退出游戏」= `main.ts` 那两行，逐行对应：
     *   `resetToMainInterface()` → 它体内（源码腿已钉）调 `resetDevUnlock()` 收回开发者态；
     *   `showModeSelect()`       → 把 `isDevUnlocked()` 当第三个实参交给 `renderModeSelect`。
     */
    resetDevUnlock();
    const afterExit = run(isDevUnlocked());
    expect(afterExit, `退出热座之后回到的模式页：${JSON.stringify(afterExit)}`).toEqual(PLAYER_CARDS);
    expect(afterExit, '退出热座之后模式页又出现了预览卡（用户报的就是这一屏）').not.toContain(PREVIEW_CARD);

    // ③「重进游戏」：退出之后不解锁就直接再开一局、再退一次 —— 仍然只有四张
    //    （收回必须是"真的回到未解锁"，不是"这一次渲染恰好为假"）
    resetDevUnlock();
    const secondExit = run(isDevUnlocked());
    expect(secondExit, `第二次退出热座之后的模式页：${JSON.stringify(secondExit)}`).toEqual(PLAYER_CARDS);
    expect(isDevUnlocked(), '第二次整局复位之后开发者标记还是真（收回没落到实处）').toBe(false);
  });

  it('4. 刷新 / 重启之后仍是非开发态（解锁态不落盘，且重载后是干净的）', async () => {
    // ① 源码腿：解锁态只住在模块内存里 —— devmode 不许碰任何持久层
    const src = stripComments(read('src/ui/devmode.ts'));
    for (const api of ['localStorage', 'sessionStorage', 'indexedDB', 'document.cookie']) {
      expect(src.includes(api), `devmode.ts 里出现了 ${api} —— 解锁态被落盘了？`
        + '（落盘的话"刷新之后仍是非开发态"就不成立，得另加清除路径）').toBe(false);
    }

    // ② 行为腿：解锁 → 重载入口模块（= 刷新页面）⇒ 新实例是未解锁的
    expect(tryUnlockDevMode(DEV_PASSWORD), '解锁失败 ⇒ 本判据假绿').toBe(true);
    expect(isDevUnlocked(), '解锁后应当为真（否则下面那条"重载后为 false"恒真）').toBe(true);
    vi.resetModules();
    const fresh = await import('../../src/ui/devmode');
    expect(fresh.isDevUnlocked(), '重新加载入口（= 刷新页面）之后还是开发者态 —— 有东西被落盘了')
      .toBe(false);
    // 反向：老实例的标记不该被"新实例"清掉（证明它确实只住在模块内存里，两条腿各说各的事）
    expect(isDevUnlocked(), '新实例把老实例的标记也改了 —— 两者共享了同一份持久状态？').toBe(true);

    // 收拾：本文件其它用例（以及将来追加的）要从未解锁态起跑
    resetDevUnlock();
    expect(isDevUnlocked()).toBe(false);
  });
});
