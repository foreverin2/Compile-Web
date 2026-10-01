/**
 * ★★ 2026-10-01（用户报的回归 → 当天下午的收口）：「退出双人热座模式后，回到的选择游戏模式页上
 * 多出了「单视角预览（仅开发）」那张卡」。
 *
 * ## 缺陷本体（本文件当时钉的就是它）
 *
 * 卡的闸门是对的（`src/ui/home.ts` 的 `if (devUnlocked)`），坏的是**闸门读的那个标记的寿命**：
 * `src/ui/devmode.ts` 的 `passwordUnlocked` 是**模块级会话标记**，注释里写着「本局游戏内」，
 * 可全仓**只有解锁那一处写它**（`tryUnlockDevMode` 只写 `true`）⇒ 解锁一次之后它活到**整页刷新**
 * 为止，跨局、跨屏都不收回。而 `src/main.ts` 的 `showModeSelect()` 把这个标记当第三个实参交给
 * `renderModeSelect` ⇒ 打完一局 / 点「← 退出游戏」回到模式页时，那张卡又出现了。
 * 当天的第一版修法：`devmode.ts` 新增 `resetDevUnlock()`，由 `resetToMainInterface()` 收回它。
 *
 * ## 同一天用户又要求：**把那个模式整个删掉**
 *
 * 原话：「单视角预览这个模式可以直接删了，没有用，懂我意思吗」⇒ 那张卡、`renderModeSelect` 的
 * `devUnlocked` 形参、宿主里 `startNetPreview` 那条启动路径、以及**因此变成死代码的
 * `resetDevUnlock()`** 全部删除。
 *
 * 本文件因此改成：**那条泄漏在结构上不可能再发生**，而且这一点要能被实测出来。
 *
 * ## 判据分三半（缺一不可）
 *
 *  - **行为腿**：真跑 `renderModeSelect`，读**模式卡文案清单本身** —— 开发者态与非开发态
 *    **都是那四张**（当年"开发者态 5 张"那条腿是为那张卡写的，现在两边都该是 4 张）。
 *  - **源码腿**：解锁态**没有任何一条通往模式页的路** —— `main.ts` 不再把 `isDevUnlocked()`
 *    交给 `renderModeSelect`，`devmode.ts` 里 `resetDevUnlock` 那个"收回"函数也不存在了
 *    （它的作用面是空的），`src/ui/home.ts` 里不再有那张卡的文案。
 *  - **反向控制**：把那张卡与它的闸门**加回一份合成源码**，上面那条源码判据必须能报出来
 *    —— 证明它不是恒真。
 *
 * ## 反向验证（实测记录，2026-10-01 本机）
 *
 *  - 删卡之前：把 `main.ts` 里那一行 `resetDevUnlock();` 删掉 ⇒ 当天的第 3 条当场红；
 *  - 删卡之后（本次）：把 `if (devUnlocked) { … '单视角预览（仅开发）' … }` 与
 *    `, isDevUnlocked()` 加回 `home.ts` / `main.ts` 的**真实源码**再跑本文件与
 *    `tests/ui/net-preview-wiring.test.ts` ⇒ 第 1/2/3 条与那边的第 12/13 条一起红
 *    （第 4 条不红：它钉的是"解锁态不落盘"，那条本来就不依赖这个模式）。
 *    实测输出见提交信息与 `.superpowers/` 下的记录。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { stripComments, functionBody } from './source-text';
import { descendants, installStubDom, isClass, makeStubEl, type StubNode } from './net-dom-stub';
import { renderModeSelect, type ModeSelectNav } from '../../src/ui/home';
import { isDevUnlocked, tryUnlockDevMode } from '../../src/ui/devmode';

const root = new URL('../../', import.meta.url);
// 与 `tests/ui/net-preview-wiring.test.ts` 同款读法（`.subarray(...).toString('utf8')`：本仓的
// node 类型里 `readFileSync` 返回的是 `Uint8Array`，直接 `.toString('utf8')` 会 TS2554）
const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, root))).subarray(0, 8 * 1024 * 1024).toString('utf8');

/**
 * 模式选择页的**唯一**清单（逐字，DOM 顺序）。
 *
 * ⚠️ 原先这里有两份常量：`PLAYER_CARDS`（玩家四张）与 `DEV_CARDS`（开发者五张，含预览卡）。
 * 那个模式删掉之后**只剩这一份**，而且它同时是"非开发态"与"开发者态"两份判据 —— 见第 1、2 条。
 */
const MODE_CARDS = ['热坐（双人）', '联机对战（两台设备）', '单人模式', '三人模式'];
/** 那张被删掉的卡的文案（只有**反向控制**里造合成源码时才用得到） */
const PREVIEW_CARD = '单视角预览（仅开发）';
/** 开发者密码（`devmode.ts` 的 `PASSWORDS` 里那两个之一；这里用纯函数那一半解锁，不走 DOM 密码框） */
const DEV_PASSWORD = '上上下下左右左右BABA';

const navOf = (calls: string[]): ModeSelectNav => ({
  backHome: () => { calls.push('backHome'); },
  openDeviceCheck: () => { calls.push('openDeviceCheck'); },
  startHotseat: () => { calls.push('startHotseat'); },
  startNetLobby: () => { calls.push('startNetLobby'); },
});

describe('★ 2026-10-01 · 模式页恒为那四张卡（开发者解锁态再也到不了这一页）', () => {
  let restoreDom: (() => void) | null = null;
  afterEach(() => { restoreDom?.(); restoreDom = null; });

  /** 真跑一帧模式选择页：返回模式卡文案清单（DOM 顺序） */
  const run = (): string[] => {
    const el = makeStubEl('div');
    renderModeSelect(el as unknown as HTMLElement, navOf([]));
    return descendants(el as StubNode).filter((n) => isClass(n, 'mode-card-name')).map((n) => n.text);
  };

  it('1. 非开发态：模式卡文案**逐字**等于那四张（没有预览卡）', () => {
    restoreDom = installStubDom();
    const names = run();
    expect(names, `非开发态的模式卡清单：${JSON.stringify(names)}`).toEqual(MODE_CARDS);
    expect(names).not.toContain(PREVIEW_CARD);
  });

  /**
   * ★ **这条是本次改动的判据核心**：当年"开发者态 5 张"是**为那张卡写的**（防删掉开发者能力），
   * 卡被用户点名删掉之后它就反过来了 —— 开发者态也必须是**那四张**，一张不多。
   *
   * 为什么它比上一条强：上一条在 `renderModeSelect` 完全不看解锁态时恒真；
   * 而这一条会抓住"有人又把解锁态接回模式页"（那张卡复活时**两条一起红**）。
   */
  it('2. 开发者态也是那四张（旧腿是"开发者态 5 张"，那是为已删掉的那张卡写的）', () => {
    restoreDom = installStubDom();
    expect(tryUnlockDevMode(DEV_PASSWORD), '密码没命中 ⇒ 本用例其实没在开发者态上跑（假绿）').toBe(true);
    expect(isDevUnlocked(), '解锁后 isDevUnlocked() 仍是 false（解锁路径本身坏了）').toBe(true);
    const names = run();
    expect(names, `开发者态的模式卡清单：${JSON.stringify(names)}`).toEqual(MODE_CARDS);
    expect(names, '开发者态又出现了那张预览卡（那个模式已经被用户点名删掉了）')
      .not.toContain(PREVIEW_CARD);
  });

  /**
   * ★ 源码腿：**解锁态没有任何一条通往模式页的路**。
   *
   * 为什么要两半一起看：只有行为腿会漏掉"宿主留着一条没入口的旧接线"（那正是下一次复活的种子），
   * 只有源码腿会退化成"字符串不在文件里，但页面上照样画得出来"。
   */
  it('3. 源码腿：模式页不读解锁态、`resetDevUnlock` 已删、宿主启动路径不在（源码腿 + 行为腿）', () => {
    restoreDom = installStubDom();
    const main = stripComments(read('src/main.ts'));
    const home = stripComments(read('src/ui/home.ts'));
    const mode = functionBody(main, 'showModeSelect');

    // ① 宿主不再把解锁态交给模式页（当年那条泄漏的**接线本体**）
    expect(mode, 'showModeSelect 仍把 isDevUnlocked() 交给 renderModeSelect'
      + '（解锁态又能影响模式页了 —— 泄漏的接线回来了）')
      .not.toMatch(/isDevUnlocked\(\)/);
    // 它的函数体确实抽到了（反空片段：抽空了上面那条 `not.toMatch` 会恒真）
    expect(mode.length, 'functionBody(main, showModeSelect) 抽到空片段 ⇒ 上面那条断言假绿')
      .toBeGreaterThan(200);
    expect(mode, 'showModeSelect 里没有 renderModeSelect 调用（锚点变了？）')
      .toContain('renderModeSelect(root, {');
    // ② `renderModeSelect` 的签名是两个形参（第三个"开发者闸门"形参已随卡删掉）
    expect(home, 'renderModeSelect 的签名仍是三个形参（开发者闸门形参没删干净）')
      .toMatch(/export function renderModeSelect\(root: HTMLElement, nav: ModeSelectNav\): void \{/);
    // ③ 那张卡的文案在模式页源码里一个字都不剩
    expect(home, 'home.ts 里仍有那张被删掉的模式卡的文案').not.toContain(PREVIEW_CARD);
    expect(home, 'home.ts 里仍有老的"（本地）"版文案').not.toContain('单视角预览（本地）');
    // ④ `resetDevUnlock` 这个"收回解锁态"的函数整个没了（它只为那张卡的闸门而存在）
    expect(stripComments(read('src/ui/devmode.ts')),
      'devmode.ts 里仍有 resetDevUnlock（它已经没有任何消费者 —— 死代码）')
      .not.toContain('resetDevUnlock');
    expect(main, 'main.ts 仍在调 resetDevUnlock / 引它（死接线）').not.toContain('resetDevUnlock');

    // ── 行为腿：把当年那条路整条走一遍（解锁 → 退出热座 → 回模式页）──────────────
    expect(tryUnlockDevMode(DEV_PASSWORD), '密码没命中 ⇒ 后面"开发者态"那一半无从判起').toBe(true);
    const exitAt = main.indexOf('installHotseatExit(');
    expect(exitAt, 'main.ts 里找不到 installHotseatExit( —— 退出热座的入口没了？').toBeGreaterThanOrEqual(0);
    const exitCall = main.slice(exitAt, exitAt + 200);
    expect(exitCall, '「退出游戏」的 onExit 不再是"整局复位 + 回模式选择页"（本判据的锚点变了）')
      .toContain('resetToMainInterface()');
    expect(exitCall, '「退出游戏」的 onExit 不再回模式选择页（本判据的锚点变了）')
      .toContain('showModeSelect()');
    // 退出热座之后（解锁态仍是 true —— 它现在只影响远程页工具条 / devmode 指令）：
    // 模式页**照样**是那四张，因为这一页已经不看那个标记了。
    const afterExit = run();
    expect(afterExit, `退出热座之后回到的模式页：${JSON.stringify(afterExit)}`).toEqual(MODE_CARDS);
    expect(afterExit, '退出热座之后模式页又出现了那张预览卡（用户报的就是这一屏）')
      .not.toContain(PREVIEW_CARD);
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

    /**
     * 收拾：**解锁态现在没有"收回"这个 API 了**（`resetDevUnlock` 随那张卡删掉），
     * 而本文件第 1 条要求"非开发态" ⇒ 只能把模块换成一份干净的新实例。
     * 这也是"解锁只住在模块内存里"这条语义的一个副产品：谁都不能把它清掉，只有刷新。
     */
    vi.resetModules();
    await import('../../src/ui/devmode');
  });

  /**
   * ★★ **反向控制（防上面那组源码腿恒真）**：把那张卡与它的闸门加回一份**合成源码**，
   * ④ 的那三条判据必须能报出来。
   *
   * 为什么用合成源码而不是"临时改真实文件再改回来"：本文件必须能在任何时刻被任何人重跑，
   * 不能依赖"跑之前有人手动注入过缺陷"。真实源码的反向验证是一次性实测，记录写在文件头注释里。
   */
  it('5. 反向控制：把那张卡与它的闸门加回合成源码 ⇒ 上面那三条判据必须报出来', () => {
    const home = stripComments(read('src/ui/home.ts'));
    const main = stripComments(read('src/main.ts'));
    // ① 造一份"卡片又回来了"的 home.ts：插在单人卡之前（就是它当年待的位置）
    const homeWithCard = home.replace(
      "  list.appendChild(\n    mkMode('单人模式'",
      `  list.appendChild(\n    mkMode('${PREVIEW_CARD}', '开发者模式专用', true, () => {})\n  );\n`
        + "  list.appendChild(\n    mkMode('单人模式'",
    );
    expect(homeWithCard, '正控构造失败：模式卡的拼接锚点变了（本用例没造出"卡又回来了"那份源码）')
      .not.toBe(home);
    // 判据③（文案不许在模式页源码里）对合成源码必须为**假**
    expect(homeWithCard.includes(PREVIEW_CARD),
      '正控：合成源码里没有那张卡 —— 判据③就是一条没牙的断言').toBe(true);
    // ② 造一份"闸门又接上了"的 main.ts：把 `isDevUnlocked()` 插回模式页那一行
    const mainWithGate = main.replace(
      'renderModeSelect(root, {',
      'void isDevUnlocked(); renderModeSelect(root, {',
    );
    expect(mainWithGate, '正控构造失败：renderModeSelect( 的拼接锚点变了').not.toBe(main);
    const fakeMode = functionBody(mainWithGate, 'showModeSelect');
    expect(fakeMode.includes('isDevUnlocked()'),
      '正控：注入没落进 showModeSelect 的函数体 ⇒ 判据①无从被判').toBe(true);
    // ③ 判据②（签名两个形参）对"形参又回来"的合成源码必须为假
    const homeWithParam = home.replace(
      'export function renderModeSelect(root: HTMLElement, nav: ModeSelectNav): void {',
      'export function renderModeSelect(root: HTMLElement, nav: ModeSelectNav, devUnlocked = false): void {',
    );
    expect(homeWithParam, '正控构造失败：renderModeSelect 的签名锚点变了').not.toBe(home);
    expect(/export function renderModeSelect\(root: HTMLElement, nav: ModeSelectNav\): void \{/
      .test(homeWithParam), '正控：多了一个形参的签名竟然还能满足判据②').toBe(false);
  });
});
