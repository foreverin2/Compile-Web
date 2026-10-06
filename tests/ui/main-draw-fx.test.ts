/**
 * ★ 2026-10-06：**抽牌飞入特效抽成单一出处之后的腿**（`src/ui/main-draw-fx.ts`）。
 *
 * ## 这一族缺陷的形态（用户报的：「第六关（= T4）里打出『精神1』的抽牌特效没有了」）
 *
 * `spirit-1` 的中指令真的抽了牌、引擎真的发了 `card:drawn`，但**消费累加器并播动画**的收尾
 * 原先整段写在 `src/main.ts` 的 `cb.onAction` **函数体内部**（没导出、`src/ui` 也没有反向
 * import `main.ts` 的出口）⇒ 教学屏（自己的 `UiCallbacks`）那条路上累加器躺着一条、没人读。
 * 诊断报告：`.superpowers/2026-10-06-spirit1-draw/报告.md`。
 *
 * ⇒ 这段搬进 `src/ui/main-draw-fx.ts`，`main.ts` 与 `tutorial-screen.ts` 两处调同一份。
 *
 * ## 本文件钉什么
 *
 * - **真跑（引擎级）**：真 `buildLevelState('T4')` + 真 `createLocalDriver` + 真 `gameBus`
 *   —— 订阅 → 打出 `t4h-draw`（spirit-1）→ `drainDraws()` 交得出 `{player:0, count:2, …}`。
 *   这是照着诊断探针（`.superpowers/2026-10-06-spirit1-draw/spirit1-draw.probe.test.ts`）
 *   的**真跑**做法写的（探针不改仓库，本文件是它的常驻版）。
 * - **真跑（映射与去重）**：`love` / `speed` / `fromOpp` 三个标志的映射、
 *   `subscribeDraws()` 的去重（`gameBus` 全仓单例）、退订之后不再入队、`drainDraws()` 清空。
 * - **源码腿**：`main.ts` 那几处接线（import、调用点还在、累加器不在 main.ts 里重复声明）。
 *
 * ⚠️ 本文件**不 import `src/main.ts`**（它 import DOM 级模块，node 下跑不了），
 * 也**不 import `src/ui/tutorial-screen.ts`**（碰 DOM）—— 教学屏那条接线在
 * `tests/ui/tutorial-draw-wiring.test.ts` 里用桩 DOM + 假 driver 真跑。
 */
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { subscribeDraws, drainDraws, resetDraws, playDrawSequence, type DrawReq } from '../../src/ui/main-draw-fx';
import { gameBus } from '../../src/core/events/bus';
import { buildLevelState } from '../../src/tutorial/setup';
import { createLocalDriver } from '../../src/app/match-driver';
import type { GameState } from '../../src/core/models/types';
import { stripComments, functionBody } from './source-text';

/** 每条腿自己收尾：退订（`gameBus` 是单例，退了才不会串到别的腿）+ 清累加器 */
let offs: Array<() => void> = [];
function track(off: () => void): void { offs.push(off); }
afterEach(() => {
  for (const off of offs) off();
  offs = [];
  resetDraws();
});

describe('main-draw-fx 真跑：订阅 → card:drawn → drainDraws', () => {
  it('没有订阅时事件被丢掉（drainDraws 为空）—— 这就是"教学屏原先没人读"的形态', () => {
    const s = buildLevelState('T4');
    const driver = createLocalDriver();
    const ok = driver.submit(s, { player: 0, kind: 'play', args: { cardUid: 't4h-draw', faceUp: true, line: 0 } }).ok;
    expect(ok, '引擎拒了这次打出 ⇒ 这个局面在 T4 里做不出来').toBe(true);
    // 手牌真的多了两张（抽牌本身发生了）
    expect(s.players[0].hand.some((c) => c.uid === 't4d2')).toBe(true);
    // 但没人订阅 ⇒ 队列空（累加器不是"自己会满"的）
    expect(drainDraws(), '没有订阅者时 drainDraws 不该有东西').toEqual([]);
  });

  it('订阅之后：T4 打出 spirit-1 ⇒ drainDraws 交出 {player:0, count:2}（真事件真引擎）', () => {
    const s = buildLevelState('T4');
    const driver = createLocalDriver();
    track(subscribeDraws());
    const handBefore = s.players[0].hand.length;
    const deckBefore = s.players[0].deck.length;

    const ok = driver.submit(s, { player: 0, kind: 'play', args: { cardUid: 't4h-draw', faceUp: true, line: 0 } }).ok;
    expect(ok).toBe(true);
    // ⚠️ 手牌净增 1 而不是 2：打出 spirit-1 本身让手牌 −1，它的中指令再抽 2
    //    ⇒ 用**牌库**的读数判"真的抽了 2 张"（诊断探针 `[探针1]` 的读数同款）
    expect(deckBefore - s.players[0].deck.length, 'spirit-1 的中指令是"抽 2 张牌"').toBe(2);
    expect(s.players[0].hand.length - handBefore, '打出那张离手（−1），抽 2 张进口（净 +1）').toBe(1);
    expect(s.players[0].hand.some((c) => c.uid === 't4d2'), '抽到的牌真的进了手牌').toBe(true);

    const draws = drainDraws();
    expect(draws.length, 'card:drawn 应该恰好入队一条（同一玩家多次抽牌由 playDrawSequence 合并）').toBe(1);
    expect(draws[0], 'spirit 抽牌不是 love/speed，也不是从对手牌库抽').toEqual({
      player: 0, count: 2, love: false, speed: false, fromOpp: false,
    });
    // drain 是"搬走并清空"：再 drain 一次是空的
    expect(drainDraws(), 'drainDraws 必须清空（否则同一批会重复播）').toEqual([]);
  });

  it('三个标志按 payload 映射：love / speed / fromOpp（用真总线发事件）', () => {
    track(subscribeDraws());
    const state = buildLevelState('T4');
    gameBus.emit({ type: 'card:drawn', state, payload: { player: 1, count: 3, triggerProtocol: 'love', fromOpponentDeck: true } });
    gameBus.emit({ type: 'card:drawn', state, payload: { player: 0, count: 1, triggerProtocol: 'speed' } });
    gameBus.emit({ type: 'card:drawn', state, payload: { player: 0, count: 1, triggerProtocol: 'spirit', triggerDefId: 'spirit-1' } });
    // 别的事件名不该入队
    gameBus.emit({ type: 'card:revealed', state, payload: { owner: 0, shownTo: 1, defId: 'x' } });

    expect(drainDraws()).toEqual<DrawReq[]>([
      { player: 1, count: 3, love: true, speed: false, fromOpp: true },
      { player: 0, count: 1, love: false, speed: true, fromOpp: false },
      { player: 0, count: 1, love: false, speed: false, fromOpp: false },
    ]);
  });

  it('`subscribeDraws()` 去重：连订两次也只入队一条（gameBus 是全仓单例）', () => {
    track(subscribeDraws());
    track(subscribeDraws());
    const state = buildLevelState('T4');
    gameBus.emit({ type: 'card:drawn', state, payload: { player: 0, count: 2 } });
    expect(drainDraws().length, '订了两次 ⇒ 同一次抽牌入队两条（幽灵会double）').toBe(1);
  });

  it('退订之后事件不再入队（教程 `close()` 就是靠它）', () => {
    const off = subscribeDraws();
    const state = buildLevelState('T4');
    gameBus.emit({ type: 'card:drawn', state, payload: { player: 0, count: 1 } });
    expect(drainDraws().length).toBe(1);
    off();
    gameBus.emit({ type: 'card:drawn', state, payload: { player: 0, count: 1 } });
    expect(drainDraws(), '退订之后还在收事件（gameBus 单例没断开）').toEqual([]);
  });

  it('`resetDraws()` 丢弃而不是交出（整局复位用）', () => {
    track(subscribeDraws());
    const state = buildLevelState('T4');
    gameBus.emit({ type: 'card:drawn', state, payload: { player: 0, count: 4 } });
    resetDraws();
    expect(drainDraws()).toEqual([]);
  });

  it('`playDrawSequence([])` 同步 done()（调用方据"空"走同步路，语义靠这一条兜底）', () => {
    let calls = 0;
    playDrawSequence([], () => { calls += 1; });
    expect(calls, '空数组必须同步回调一次（不许凭空插一帧等待）').toBe(1);
  });
});

/* ────────────────────────── 源码腿：main.ts 的接线 ────────────────────────── */

const REPO = fileURLToPath(new URL('../../', import.meta.url));
const read = (rel: string): string =>
  stripComments(readFileSync(`${REPO}${rel}`).subarray(0, 8 * 1024 * 1024).toString('utf8'));

const MAIN = read('src/main.ts');

/** 取一个具名函数的**配平函数体**（剥过注释）。找不到/不配平就抛错（响亮，不返回空串）。 */
function bodyOf(src: string, name: string): string {
  const at = src.indexOf(`function ${name}(`);
  if (at < 0) throw new Error(`源码里找不到 function ${name}(（结构被改动？）`);
  const open = src.indexOf('{', src.indexOf(')', at));
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}') { depth -= 1; if (depth === 0) return src.slice(at, i + 1); }
  }
  throw new Error(`function ${name} 的花括号不配平`);
}

describe('main.ts 接线（源码腿）：新模块被 import、调用点还在、累加器不在这里', () => {
  it('从 `./ui/main-draw-fx` import 了四个出口（订阅 / 排空 / 复位 / 播序列）', () => {
    const at = MAIN.indexOf("from './ui/main-draw-fx'");
    expect(at, 'main.ts 没有 import 新模块').toBeGreaterThan(0);
    const stmt = MAIN.slice(MAIN.lastIndexOf('import', at), at + 30);
    for (const name of ['subscribeDraws', 'drainDraws', 'resetDraws', 'playDrawSequence']) {
      expect(stmt, `import 里没有 ${name}`).toContain(name);
    }
  });

  it('`cb.onAction` 的收尾搬走并清空累加器改调 `drainDraws()`', () => {
    // `cb.onAction` 是对象字面量里的方法（不是 `function onAction(`）⇒ 用成员体助手取它
    const cbAt = MAIN.indexOf('const cb: UiCallbacks = {');
    expect(cbAt, 'main.ts 里找不到 `const cb: UiCallbacks = {`').toBeGreaterThan(0);
    let depth = 0;
    let end = -1;
    for (let i = MAIN.indexOf('{', cbAt); i < MAIN.length; i += 1) {
      if (MAIN[i] === '{') depth += 1;
      else if (MAIN[i] === '}') { depth -= 1; if (depth === 0) { end = i; break; } }
    }
    expect(end, 'cb 对象字面量的花括号不配平').toBeGreaterThan(0);
    const cbBody = MAIN.slice(cbAt, end + 1);
    expect(cbBody, 'cb.onAction 里没有 drainDraws()（累加器没人排空）').toContain('const effectDraws = drainDraws();');
    expect(cbBody, 'cb.onAction 里没有调 playDrawSequence').toContain('playDrawSequence(effectDraws,');
    // 反向：原先那两句"搬走 + 清空"不许还在（留一句就等于两份累加器）
    expect(cbBody, 'main.ts 里还留着 `pendingDraws` 的搬走/清空（累加器已经搬走了）').not.toMatch(/pendingDraws\s*=\s*\[\]/);
  });

  it('两处整局复位改调 `resetDraws()`（返回主界面 / 进重放页）', () => {
    // ⚠️ 判据锚在**两个函数体里各一处**，不是"全文件出现 ≥2 次"：后者会被别处新增的
    //    `resetDraws()` 满足（例如教学屏那个 `openLevel`），判别力不如前者。
    expect(functionBody(MAIN, 'resetToMainInterface'), 'resetToMainInterface 没有清抽牌累加器').toContain('resetDraws();');
    expect(functionBody(MAIN, 'startReplayFile'), 'startReplayFile 没有清抽牌累加器').toContain('resetDraws();');
    expect(MAIN, '`pendingDraws = []` 这句不该再出现在 main.ts 里').not.toMatch(/pendingDraws\s*=\s*\[\]/);
  });

  it('`drawAnimBusy` 这个闩**留在 main.ts**（它还挡重放自动推进与 refresh 重入，不是抽牌私有的）', () => {
    expect(MAIN, 'drawAnimBusy 的声明不见了（被误搬？）').toMatch(/let drawAnimBusy = false;/);
    expect(bodyOf(MAIN, 'replayNav'), 'replayNav 里的忙判据没了').toMatch(/if \(drawAnimBusy \|\| revealFlyBusy\)/);
  });

  it('累加器的声明与 `card:drawn` 订阅体**不在** main.ts 里（避免两份）', () => {
    expect(MAIN, 'main.ts 里还有 pendingDraws 的声明').not.toMatch(/let\s+pendingDraws\s*:/);
    expect(MAIN, '`card:drawn` 的订阅体还写在 main.ts 里（新模块才是唯一出处）').not.toContain("e.type !== 'card:drawn'");
  });

  it('`subscribeDraws()` 在 main.ts 里恰好一处（进程级一次；教学屏那份由它自己订阅/退订）', () => {
    const n = (MAIN.match(/subscribeDraws\(\)/g) ?? []).length;
    expect(n, `main.ts 里 subscribeDraws() 出现 ${n} 处`).toBe(1);
  });
});
