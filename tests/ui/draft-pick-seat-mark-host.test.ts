/**
 * **2026-10-01 两件真机反馈的"宿主那一半"**（源码腿；`src/main.ts` 在 node 里 import 不了）。
 *
 * ## 为什么要单独一条腿（行为腿已经证过产出）
 *
 *  - `tests/ui/draft-pick-seat-mark.test.ts` 证的是**产出**：给座位就标、不给就不标；
 *  - 但"联机局会不会**真的**把座位给进去"没有任何行为腿能证 —— `src/main.ts` 是应用入口
 *    （一 import 就跑起整个游戏、要真 DOM），本仓测试环境是 node、没有 jsdom。
 *    ⇒ 这一条只能读源码文本（与 `net-turn-line.test.ts` / `net-conn-line.test.ts` 的
 *    "宿主那一半"同族）。
 *
 * ## 钉住的三件事
 *
 *  1. `src/main.ts` 在**整帧重画那一帧**（`renderApp(...)` 之前）写一次页级座位，
 *     且值只有两种：`renderMode === 'net'` 时是本端座位 `netViewSeat`，其余是 `null`
 *     —— "其余是 null"正是**热座不标**的构造性保证（不是靠"热座恰好没传"）；
 *  2. `src/ui/render.ts` 的标记是**守卫出来的**（`selfSeat !== undefined` 那一支里）：
 *     不许出现"无条件 append 一个标记"的写法；
 *  3. 两处红线改动都在**同一条因果链**上（`renderDraft` 把座位转交给 `renderPickColumn`），
 *     不是"改了两处互不相干的字"。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { functionBody, stripComments } from './source-text';
import { ZH } from '../../src/i18n/zh';

const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)))
    .subarray(0, 16 * 1024 * 1024).toString('utf8');

const MAIN = stripComments(read('../../src/main.ts'));
const RENDER = stripComments(read('../../src/ui/render.ts'));

describe('★★ 2026-10-01 · 宿主半边（`src/main.ts` 的页级座位开关）', () => {
  it('`rerender()` 里写一次页级座位，且"非联机 ⇒ null"（热座不标是构造性的，不是碰巧）', () => {
    const rr = functionBody(MAIN, 'rerender');
    const calls = rr.match(/setDraftSelfSeat\(/g) ?? [];
    expect(calls.length, `rerender 里 setDraftSelfSeat( 出现 ${calls.length} 处（应为恰好 1 处）`).toBe(1);
    const call = rr.slice(rr.indexOf('setDraftSelfSeat('), rr.indexOf('setDraftSelfSeat(') + 200);
    expect(call, '页级座位的两个来源不是"联机 ⇒ netViewSeat / 其余 ⇒ null"'
      + `（实际：${call.split('\n')[0].trim()}）`).toContain("renderMode === 'net' ? netViewSeat : null");
    // 顺序：先写座位、再渲染（写成"渲染之后"就是晚了一帧 —— 屏上第一帧没有标记）
    const iSeat = rr.indexOf('setDraftSelfSeat(');
    const iRender = rr.indexOf('renderApp(root, state, cb);');
    expect(iRender, 'rerender 里找不到 `renderApp(root, state, cb);`（结构被改了？）').toBeGreaterThanOrEqual(0);
    expect(iSeat, '页级座位写在 renderApp 之后 ⇒ 第一帧画不出标记').toBeLessThan(iRender);
  });

  it('`netViewSeat` 与"喂给驱动的本端座位"同源（不是另拿一个数来标"你"）', () => {
    const g = functionBody(MAIN, 'enterNetGame');
    expect(g, 'enterNetGame 里那句"视角座位 = 本端座位"不见了')
      .toContain('netViewSeat = hand.seat;');
  });
});

describe('★★ 2026-10-01 · 产出半边（`src/ui/render.ts` 的守卫与转交）', () => {
  it('`renderPickColumn` 的标记产出在 `selfSeat !== undefined` 那一支里（无守卫的 append 会污染热座）', () => {
    const fn = functionBody(RENDER, 'renderPickColumn');
    expect(fn.length, '`renderPickColumn` 抽到的函数体太短 ⇒ 这条腿假绿').toBeGreaterThan(400);
    expect(fn, '没有"没给座位就不标"的守卫（热座页会被标上"你"）').toContain('selfSeat !== undefined');
    // ★ 2026-10-02（P3 第四批，用户授权动 render.ts 抽文案）：两句标记文案从裸字面量搬进了
    //   文案表（键 `render.draft.seat-{self,foe}`）。判据改成"钉键 + 钉值"：键必须落在这个
    //   函数体里（两处不同的键 —— 两侧标成同一句仍然报红），值必须逐字是改动前那两句。
    for (const key of ['render.draft.seat-self', 'render.draft.seat-foe']) {
      expect(fn, `标记文案的键 \`${key}\` 不在 \`renderPickColumn\` 里（产出点换了地方？）`).toContain(`t('${key}')`);
    }
    expect(ZH['render.draft.seat-self'], '「（你）」的中文值被改了').toBe('（你）');
    expect(ZH['render.draft.seat-foe'], '「（对方）」的中文值被改了').toBe('（对方）');
    // 标记必须是**标题的子节点**（挂在列上会让 CSS 的 flex 排布错位）
    expect(fn, '标记没有挂到标题上（`title.appendChild(mark)` 不见了）').toContain('title.appendChild(mark)');
  });

  it('`renderDraft` 把座位转交给两侧列（页级缺口在这里，不是"参数收了没用"）', () => {
    const fn = functionBody(RENDER, 'renderDraft');
    const passes = fn.match(/renderPickColumn\(s, \d, activePlayer, cb, seatForMarks\)/g) ?? [];
    expect(passes.length, `renderDraft 里把座位转交给列的次数 = ${passes.length}（应为 2：左右各一次）`).toBe(2);
    expect(fn, '缺省时回落到页级开关的那一行不见了（`setDraftSelfSeat` 那条路会断）')
      .toContain('selfSeat ?? draftSelfSeat ?? undefined');
  });

  it('反空集合：两侧列标题的座位号**仍在**（本轮只加标记，不搬走用户已经认得的那句话）', () => {
    // ★ 2026-10-02（P3 第四批）：那一句从裸模板串搬进了文案表（键 `render.draft.picks-title`）。
    //   这里钉**调用的形状**（键 + 实参仍是 `String(player + 1)` —— 座位号没有从"这一列的玩家"
    //   变成写死的数）与**值**（`玩家 {n} 已选`，仍是改动前的原文）。
    expect(RENDER.includes("t('render.draft.picks-title', { n: String(player + 1) })"),
      'render.ts 里那句"玩家 N 已选"的产出变了（若这是有意的搬迁，请同时改本腿与 draft-fit 的预算）').toBe(true);
    expect(ZH['render.draft.picks-title'], '「玩家 N 已选」的中文值被改了').toBe('玩家 {n} 已选');
    expect(RENDER.includes('draft-picks-title'),
      'render.ts 里连标题类名都不见了（判据面被整体改掉）').toBe(true);
  });
});
