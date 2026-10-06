/**
 * ★ 2026-10-06：**教学屏那条接线的腿**（用户报的「T4 打出精神1 没有抽牌特效」）。
 *
 * ## 为什么需要它
 *
 * 抽牌飞入特效原先只被 `src/main.ts` 的 `cb.onAction` 消费，而教学屏用的是**自己**的一份
 * `UiCallbacks` ⇒ T4 里 spirit-1 抽了牌、`card:drawn` 也发了，但**没人读累加器**，一次动画都不播。
 * 修法：那段收尾抽进 `src/ui/main-draw-fx.ts`，教学屏在 `onAction` 的**走偏早退之后、
 * `judgeAndAdvance()` 之前** drain 一次、把 `judgeAndAdvance` 挪进 `playDrawSequence` 的
 * `done` 回调。
 *
 * ## 这条腿真跑什么（不是源码判据）
 *
 * 教学屏整屏 `mountTutorial` 在 node 下挂不起来（它建浮层、`MutationObserver`、`renderApp`…），
 * 所以那一段接线被提成**导出 + 显式入参**的 `tutorialCallbacks(deps)`（`tutorial-screen.ts`
 * 里那个函数；`paint()` 是生产路径上唯一的调用点）。本文件用**桩 DOM** + **假 driver** 真调它：
 *
 *  1. `drainDraws()` 为空 ⇒ `judgeAndAdvance()` **同步**执行（不许凭空插一帧等待）；
 *  2. `driver.submit` 期间发了 `card:drawn` ⇒ 走 `playDrawSequence(draws, done)`，
 *     且 `judgeAndAdvance()` **在 done 之前一次都没跑**，`done()` 之后恰好一次；
 *  3. 走偏早退（`kind` 不在本关白名单）⇒ 既不提交也不 drain（累加器留给下一次动作）。
 *
 * 剩下那几条"订阅/退订接线"用**源码腿**（`mountTutorial` 的函数体）：它们只是两句调用，
 * 真跑它们需要把整屏挂起来（含 `MutationObserver` 与浮层布局），性价比不划算。
 *
 * ## 假 driver 的形状（为什么必须是"工厂"而不是空对象）
 *
 * `tutorialCallbacks` 的 `driver` 依赖就是生产路径上 `mountTutorial` 里那个
 * `const driver = createLocalDriver()`，而 `setup.ts` 的 `buildLevelState` 也调同一个函数
 * ⇒ 下面的 `vi.mock('../../src/app/match-driver')` 两边都生效，真跑时用的是**同一个假 driver**
 * （每次 `buildLevelState` 造一个新的）。
 *
 * ⚠️ **本轮踩过的坑**（记在这里，别再犯）：第一版给 `driver` 传的是 `{} as never`（想省事），
 * 于是 `driver.submit` 不是函数、当场抛错，被 `onAction` 的 `catch` 吞成一句"动作被拒"
 * —— 两条腿在**空集**上假绿（`judgeAndAdvance` 0 次、`playDrawSequence` 0 次）。
 * 依赖缝里塞空对象，等于把被测代码变成"永远早退"。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { installStubDom, makeStubEl } from './net-dom-stub';
import { stripComments, functionBody } from './source-text';
import { createLocalStore } from '../../src/app/local-store';
import { createLocalDriver } from '../../src/app/match-driver';
import { L1_SETTINGS, createMemoryStore, type KeyValueStore } from '../../src/app/storage';
import { gameBus } from '../../src/core/events/bus';
import { buildLevelState } from '../../src/tutorial/setup';
import { tutorialCallbacks } from '../../src/ui/tutorial-screen';
import { drainDraws, resetDraws, subscribeDraws, type DrawReq } from '../../src/ui/main-draw-fx';
import type { GameState } from '../../src/core/models/types';

/**
 * 假 driver：`submit` 期间（同步）往真 `gameBus` 上发一条 `card:drawn` —— 这正是引擎在
 * `resolve.ts` 里干的事，也是"教程路径上累加器会收到一条"的成因。
 * 由 `./main-draw-fx-wiring.test.ts` 那条腿单独验过：真引擎在 T4 打出 spirit-1 就是这个形状。
 */
const driverMock = vi.hoisted(() => ({
  submitCalls: [] as Array<{ kind: string; cardUid?: string }>,
  /** 置为 `null` ⇒ `submit` 返回 `{ ok: false }`（引擎拒收那条分支） */
  emitDraw: { player: 0, count: 2 } as { player: number; count: number } | null,
}));
vi.mock('../../src/app/match-driver', () => ({
  createLocalDriver: () => ({
    mode: 'local',
    submit: (state: unknown, a: { kind: string; args?: { cardUid?: string } }) => {
      driverMock.submitCalls.push({ kind: a.kind, cardUid: a.args?.cardUid });
      if (a.kind === 'play' && driverMock.emitDraw !== null) {
        gameBus.emit({
          type: 'card:drawn',
          state: state as GameState,
          payload: { player: driverMock.emitDraw.player, count: driverMock.emitDraw.count, triggerProtocol: 'spirit', triggerDefId: 'spirit-1' },
        });
      }
      return { ok: true };
    },
  }),
}));

/** `playDrawSequence` 的替身：**不**造幽灵（本文件判的是接线，不是 DOM 动画） */
const seqMock = vi.hoisted(() => ({ calls: [] as Array<{ draws: DrawReq[]; done: () => void }> }));
vi.mock('../../src/ui/main-draw-fx', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/ui/main-draw-fx')>();
  return {
    ...actual,
    playDrawSequence: (draws: DrawReq[], done: () => void) => { seqMock.calls.push({ draws, done }); },
  };
});

/** 把当前关设成 `T3`（白名单 `['play']` ⇒ 下面那次 `kind:'play'` 是"放行"而不是"走偏"） */
function storeAt(level: string): ReturnType<typeof createLocalStore> {
  const kv: KeyValueStore = createMemoryStore();
  kv.set(L1_SETTINGS, JSON.stringify({ tutorial: { done: [], current: level } }));
  return createLocalStore({ persistent: kv });
}

/** 造一份"教学屏那六个依赖"（driver 用真实例：上面 mock 过，两边同一个假 driver） */
function makeCb(state: GameState): {
  cb: ReturnType<typeof tutorialCallbacks>;
  judgeAndAdvance: ReturnType<typeof vi.fn>;
  hintBox: ReturnType<typeof makeStubEl>;
  driver: ReturnType<typeof createLocalDriver>;
} {
  const judgeAndAdvance = vi.fn();
  const hintBox = makeStubEl('div');
  // ⚠️ 这里调的是**真出口名**（`vi.mock` 把它换成了假 driver）—— 不自己造一个"看起来像"的对象，
  //    否则"生产路径用的那个 driver"与"测试喂的那个"是两样东西，腿就白跑了。
  const driver = createLocalDriver();
  const cb = tutorialCallbacks({
    state,
    driver,
    hintBox: hintBox as unknown as HTMLElement,
    judgeAndAdvance,
    repaint: vi.fn(),
    currentLevel: () => ({ id: 'T3', allowKinds: ['play'] }) as never,
  });
  return { cb, judgeAndAdvance, hintBox, driver };
}

let restore: (() => void) | null = null;
let offs: Array<() => void> = [];

beforeEach(() => {
  restore = installStubDom();
  driverMock.submitCalls = [];
  driverMock.emitDraw = { player: 0, count: 2 };
  seqMock.calls = [];
  resetDraws();
  offs = [subscribeDraws()];
});

afterEach(() => {
  for (const off of offs) off();
  offs = [];
  resetDraws();
  restore?.();
  restore = null;
});

describe('教学屏接线（真跑 tutorialCallbacks）：抽牌动画的 done 回调接 judgeAndAdvance', () => {
  it('没有抽牌 ⇒ `judgeAndAdvance()` **同步**跑、`playDrawSequence` 一次都不调', () => {
    driverMock.emitDraw = null; // 这次不打牌、不发 card:drawn
    const state = buildLevelState('T3');
    const { cb, judgeAndAdvance } = makeCb(state);

    cb.onAction({ kind: 'play', cardUid: 't3h1' } as never);

    expect(driverMock.submitCalls.length, '这条腿本身要真的走到 submit（否则下面全是空集）').toBe(1);
    expect(judgeAndAdvance, '没有抽牌时必须**同步**继续判定（不许凭空插一帧等待）').toHaveBeenCalledTimes(1);
    expect(seqMock.calls.length, '空数组时不该走动画分支').toBe(0);
  });

  it('有抽牌 ⇒ 走 `playDrawSequence(draws, done)`，且判定**等到 done 之后**才跑', () => {
    const state = buildLevelState('T3');
    const { cb, judgeAndAdvance } = makeCb(state);

    cb.onAction({ kind: 'play', cardUid: 't3h1' } as never);

    expect(seqMock.calls.length, '有抽牌时必须走 playDrawSequence').toBe(1);
    expect(seqMock.calls[0].draws).toEqual<DrawReq[]>([
      { player: 0, count: 2, love: false, speed: false, fromOpp: false },
    ]);
    expect(judgeAndAdvance, '判定在动画落地**之前**就跑了（幽灵会飞向已经重画好的新手牌）').not.toHaveBeenCalled();

    seqMock.calls[0].done();
    expect(judgeAndAdvance, 'done 之后必须恰好继续判定一次').toHaveBeenCalledTimes(1);
  });

  it('走偏（kind 不在本关白名单）⇒ 不提交也不 drain（累加器留着，不出假动画）', () => {
    const state = buildLevelState('T3');
    const { cb, judgeAndAdvance, hintBox } = makeCb(state);
    // 先手动塞一条（模拟"累加器里已经有东西"，用来证明早退不动它）
    const s = buildLevelState('T4');
    gameBus.emit({ type: 'card:drawn', state: s, payload: { player: 0, count: 2 } });

    cb.onAction({ kind: 'compile', line: 0 } as never);

    expect(driverMock.submitCalls.filter((c) => c.kind === 'compile').length, '走偏时不该提交给驱动').toBe(0);
    expect(seqMock.calls.length, '走偏时不该播动画').toBe(0);
    expect(judgeAndAdvance, '走偏时不该推进判定').not.toHaveBeenCalled();
    expect(hintBox.textContent, '走偏要给一句提示（不是静默吞掉）').toBeTruthy();
    // 累加器仍原样躺着（走偏这条路只是早退，不做任何消费）
    expect(drainDraws().length, '走偏早退不该动累加器').toBe(1);
  });

  it('反空集合：夹具本身不假绿（store 真的是 T3、假 driver 真的被调到）', () => {
    const store = storeAt('T3');
    expect(store.consent(), 'store 桩没建起来').toBe('unknown');
    const s = buildLevelState('T3');
    expect(s.players[0].hand.length, 'T3 开局手牌数').toBeGreaterThan(0);
    const { cb } = makeCb(s);
    cb.onAction({ kind: 'play', cardUid: 't3h1' } as never);
    expect(driverMock.submitCalls.length, '假 driver 一次都没被调到 ⇒ 上面的断言全是空集').toBe(1);
  });
});

/* ────────────────────────── 源码腿：mountTutorial 的订阅/退订 ────────────────────────── */

const REPO = fileURLToPath(new URL('../../', import.meta.url));
const SCREEN = stripComments(
  readFileSync(`${REPO}src/ui/tutorial-screen.ts`).subarray(0, 8 * 1024 * 1024).toString('utf8'),
);

describe('教学屏接线（源码腿）：`mountTutorial` 订阅并在 `close()` 退订', () => {
  it('`mountTutorial` 里 `subscribeDraws()` 恰好一处，并把退订函数存进 `offDraws`', () => {
    const body = functionBody(SCREEN, 'mountTutorial');
    expect(body, 'mountTutorial 没订阅抽牌队列（教学里抽了牌也不会播动画）').toContain('const offDraws = subscribeDraws();');
    expect((body.match(/subscribeDraws\(\)/g) ?? []).length, '订阅点该恰好一处').toBe(1);
  });

  it('`close()` 里调了 `offDraws()`（不退订 = 退出教程后这一屏还在收事件）', () => {
    const body = functionBody(SCREEN, 'mountTutorial');
    const closeAt = body.indexOf('close() {');
    expect(closeAt, 'mountTutorial 里找不到 close()').toBeGreaterThan(0);
    const closeBody = body.slice(closeAt, body.indexOf('},', closeAt));
    expect(closeBody, 'close() 里没有退订抽牌订阅').toContain('offDraws()');
  });

  it('`onAction` 的 drain 位置：白名单早退**之后**、`judgeAndAdvance()` **之前**', () => {
    const body = functionBody(SCREEN, 'tutorialCallbacks');
    const drainAt = body.indexOf('const draws = drainDraws();');
    const judgeAt = body.indexOf('judgeAndAdvance();', drainAt);
    const wrongKindAt = body.indexOf("hintBox.textContent = t('tutorial.off.wrong-kind');");
    expect(drainAt, 'tutorialCallbacks 里没有 drainDraws()').toBeGreaterThan(0);
    expect(wrongKindAt, '找不到走偏早退那一支').toBeGreaterThan(0);
    expect(drainAt, 'drain 排在走偏早退之前（走偏也会消费累加器）').toBeGreaterThan(wrongKindAt);
    expect(judgeAt, 'drain 之后没有 judgeAndAdvance()').toBeGreaterThan(drainAt);
    // 两条分支都在（空 ⇒ 同步；非空 ⇒ 进 done 回调）
    expect(body, '没有"无抽牌走同步"那条分支').toMatch(/if \(draws\.length === 0\) \{\s*judgeAndAdvance\(\);/);
    expect(body, '没有把 judgeAndAdvance 放进 playDrawSequence 的 done 回调')
      .toMatch(/playDrawSequence\(draws, \(\) => \{ judgeAndAdvance\(\); \}\);/);
  });

  it('`makeTutorialCallbacks()` 把六个依赖都喂给模块层那份实现（不是又长回闭包里）', () => {
    const body = functionBody(SCREEN, 'mountTutorial');
    expect(body, 'paint() 没有用 makeTutorialCallbacks()').toContain('renderApp(root, state, makeTutorialCallbacks());');
    expect(body, 'makeTutorialCallbacks 没有把依赖全喂进去')
      .toMatch(/tutorialCallbacks\(\{[\s\S]{0,200}state, driver, hintBox, judgeAndAdvance, repaint: paint, currentLevel,/);
    // ⚠️ 反向：`tutorialCallbacks` 的本体还在 `mountTutorial` 里面（那样本文件上面那三条真跑腿
    //    就与生产路径不是同一份实现 —— 迟早漂移）。它必须在模块层。
    expect(body, 'tutorialCallbacks 的本体又长回 mountTutorial 里了').not.toContain('function tutorialCallbacks(');
  });
});
