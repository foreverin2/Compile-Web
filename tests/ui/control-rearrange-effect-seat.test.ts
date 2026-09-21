import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { ChoiceRequest, GameState, PlayerId } from '../../src/core/models/types';
import { createGame } from '../../src/core/state/create';
import { resolveMiddle } from '../../src/core/effects/resolve';
import { hostsEffectRearrange } from '../../src/ui/control-rearrange';
import { makeCard } from '../helpers';
import { functionBody, stripComments } from './source-text';

/**
 * **G5 T23 第二处：效果内重排窗口（`momentum-4`）也只许开在操作方那一屏**
 *
 * ## 为什么它和"选牌浮层"是同一族
 *
 * 用户 2026-09-21 两个真窗口看到"P2 选牌、浮层弹在 P1 屏上"。`src/ui/render-net.ts` 的
 * `renderChoiceUi` 里那批装饰已经收进 `who === viewSeat` 的闸门（本任务第一处，腿在
 * `tests/ui/net-choice-seat-decor.test.ts`）。
 *
 * `momentum-4`（"重排你的协议"）**不走**那条路：它产出的是 `select-action` + `rearrangeSide`，
 * 由 `main.ts` 的 `syncRearrangeModalForEffect()` 每帧去**开一个 body 级遮罩**
 * （`openControlRearrangeModal` 直接 append 到 `document.body`，不看棋盘 DOM）。那条路上
 * 原先**一道座位判据都没有** ⇒ 联机下两端持有同一份 `state`，两屏都会弹出这个窗口：
 * 对手能拖着别人的协议摆、点「完成重排」再由 `commitEffectRearrange` → `cb.onAction` 用
 * **自己这个座位**提交应答（引擎会拒，界面不该请我做这件事）。
 *
 * ## 这条腿的两半
 *
 *  - **行为腿**：拿**引擎真产出**的 momentum-4 请求（不是手抄的字面量），把它的 `chooser`
 *    喂进 `hostsEffectRearrange`：操作方那一屏 `true`、对手那一屏 `false`。这条同时钉住
 *    "闸门该按 `chooser` 而不是 `rearrangeSide`"这个判断 —— 两个字段今天同值，但腿读的是
 *    引擎给的那个数。
 *  - **接线腿**（`main.ts` 在 node 里 import 不了 —— 见 `tests/ui/main-lobby-wiring.test.ts` 头注）：
 *    源码文本上钉住"闸门排在开窗之前、且那一句确实被它管着"。它是文本腿，**证不了**真浏览器
 *    行为；真机那条登记在计划 §9。
 */
const MAIN = stripComments(
  readFileSync(fileURLToPath(new URL('../../src/main.ts', import.meta.url)))
    .subarray(0, 4 * 1024 * 1024).toString('utf8'),
);

/** 引擎真产出的 momentum-4 选择请求（`owner` 打出这张卡的那一方）。 */
function momentum4Prompt(owner: PlayerId): ChoiceRequest {
  const s: GameState = createGame();
  for (const pid of [0, 1] as PlayerId[]) {
    s.players[pid].protocols = [
      { defId: 'fire', compiled: false },
      { defId: 'light', compiled: false },
      { defId: 'darkness', compiled: false },
    ];
  }
  s.phase = 'turn';
  const card = makeCard('momentum-4', owner, 'field', true, 0, s.players[owner].stacks[0].length);
  s.players[owner].stacks[0].push(card);
  resolveMiddle(s, owner, card);
  const top = s.pendingEffects[s.pendingEffects.length - 1];
  if (!top?.prompt) throw new Error('夹具失败：momentum-4 没有产出选择请求');
  return top.prompt;
}

describe('G5 T23 · `hostsEffectRearrange`：只有操作方那一屏该开"效果内重排"窗口', () => {
  it('行为腿：引擎给的 momentum-4 请求 —— 操作方那屏 true、对手那屏 false（两个座位都判）', () => {
    for (const owner of [0, 1] as PlayerId[]) {
      const p = momentum4Prompt(owner);
      expect(p.kind, 'momentum-4 产出的不是 select-action（夹具前提）').toBe('select-action');
      expect(p.chooser, 'momentum-4 没写 chooser ⇒ 操作方按 `top.player` 算，夹具要显式核对').toBe(owner);
      expect(p.rearrangeSide, 'momentum-4 的 rearrangeSide 不是卡主（夹具前提）').toBe(owner);
      expect(hostsEffectRearrange({ chooser: p.chooser!, localSeat: owner, net: true }),
        `操作方 P${owner + 1} 那一屏没被允许开窗 ⇒ 他永远无法应答`).toBe(true);
      const foe: PlayerId = owner === 0 ? 1 : 0;
      expect(hostsEffectRearrange({ chooser: p.chooser!, localSeat: foe, net: true }),
        `对手 P${foe + 1} 那一屏被允许开窗 ⇒ 别人的重排窗口会弹到他屏上`).toBe(false);
    }
  });

  it('反空转：这两个座位在**热座**（一屏两人）下都必须为 true（不许把热座一起关掉）', () => {
    for (const owner of [0, 1] as PlayerId[]) {
      for (const localSeat of [0, 1] as PlayerId[]) {
        expect(hostsEffectRearrange({ chooser: owner, localSeat, net: false }),
          '热座里把效果内重排窗口关掉了（一屏两人，两屏都是"这一屏"）').toBe(true);
      }
    }
  });

  it('接线腿：`main.ts` 的 `syncRearrangeModalForEffect` 先过闸门再开窗，且开窗那一句被 `mine` 管着', () => {
    const body = functionBody(MAIN, 'syncRearrangeModalForEffect');
    expect(body.length, '抽到空片段 ⇒ 本判据假绿').toBeGreaterThan(300);
    const gateAt = body.indexOf('hostsEffectRearrange(');
    const openAt = body.indexOf('openControlRearrangeModal(');
    expect(gateAt, '`syncRearrangeModalForEffect` 里没有座位闸门（联机下对手屏会弹别人的重排窗口）')
      .toBeGreaterThanOrEqual(0);
    expect(openAt, '找不到开窗那一句（判据要按它定位）').toBeGreaterThanOrEqual(0);
    expect(gateAt, '闸门排在开窗之后 ⇒ 先开窗再判，等于没判').toBeLessThan(openAt);
    expect(body.slice(gateAt, openAt), '开窗那一句没有被闸门的结论管着（`mine` 没出现在两者之间）')
      .toContain('mine');
    expect(body, '开窗不在一个受 `mine` 约束的条件里')
      .toMatch(/if \([^)]*mine\s*\)\s*\{/);
    // 参数三件：chooser 取 `prompt.chooser ?? top.player`（与渲染层同源）、座位取 netViewSeat、联机由 renderMode 判
    expect(body, 'chooser 的取法不是 `prompt.chooser ?? top.player`').toContain('prompt.chooser ?? top.player');
    expect(body, '座位取的不是 netViewSeat（T21 起它与喂给驱动的本端座位同源）').toContain('localSeat: netViewSeat');
    expect(body, '没有按 renderMode 判"是不是联机"').toContain("net: renderMode === 'net'");
  });

  it('接线腿：`main.ts` 从 `./ui/control-rearrange` 真的 import 了这个纯函数', () => {
    const line = MAIN.split('\n').find((l) => l.includes("from './ui/control-rearrange'"));
    expect(line, '`main.ts` 没有从 control-rearrange 引入任何东西').toBeTruthy();
    expect(line!, 'import 名单里没有 hostsEffectRearrange（闸门调的是别的东西？）')
      .toContain('hostsEffectRearrange');
  });
});
