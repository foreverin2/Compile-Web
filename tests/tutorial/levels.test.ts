import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildLevelState } from '../../src/tutorial/setup';
import { observedOps, snapshot, isLevelComplete, offTrackKeyFor, revealSeen } from '../../src/tutorial/judge';
import { levelById, TUT_LEVELS, levelAt, levelIndex, TUT_LEVEL_COUNT } from '../../src/tutorial/levels';
import { TUT_UI_NONE, canPeekFaceDown, triggersSeen } from '../../src/tutorial/types';
import { createLocalDriver } from '../../src/app/match-driver';
import { createLocalStore, readTutorialProgress, writeTutorialProgress } from '../../src/app/local-store';
import { advance, readProgress, restart } from '../../src/tutorial/progress';
import { createMemoryStore } from '../../src/app/storage';
import { getLegalActions } from '../../src/core/game';
import { createGame, getLineValue } from '../../src/core/state/create';
import { isUncovered } from '../../src/core/effects/context';
import { ZH, EN } from '../../src/i18n';
import { stripComments } from '../ui/source-text';
import type { Card, GameState, Line, PlayerId } from '../../src/core/models/types';
import type { TutChoiceSeen, TutOp } from '../../src/tutorial/types';

/**
 * ★ 2026-10-02（P2/P5）：教学关卡的**判据有效性**腿（方案 §8："走对 ⇒ 过；走偏 ⇒ 不过且给提示"）。
 *
 * 手法：直接驱动 `LocalDriver`（与屏同一套）把局面推向"过关"或"走偏"，然后问
 * `isLevelComplete` / `observedOps`。**不 import 屏**（`src/ui/tutorial-screen.ts` 碰 DOM，
 * 在无 jsdom 的 node 下跑不了）—— 屏那一层由 `screen.test.ts` 的源码腿与真机读数兜。
 */

/** 一次"提交并回答"的驱动（与屏里那个 `cb.onAction` 同一套调用面） */
function drive(state: GameState, kind: string, args: Record<string, unknown>): boolean {
  const driver = createLocalDriver();
  return driver.submit(state, { player: state.turnPlayer, kind, args } as never).ok;
}

/**
 * 应答挂起的 `effect-choice`（与屏里那个 `cb.onAction` 的 effect-choice 那一支同口径）。
 *
 * ⚠️ `player` 必须是**选择权归属者**（`prompt.chooser ?? pendingEffect.player`）——
 * `game.ts:211` 拿它做 `chooser !== player` 的校验，传 `state.turnPlayer` 会偶发
 * "not your choice"（打出一张牌之后回合可能已经交给对手了）。
 */
function driveChoice(state: GameState, promptId: string, choice: readonly string[]): boolean {
  const driver = createLocalDriver();
  const top = state.pendingEffects[state.pendingEffects.length - 1];
  const chooser = top?.prompt?.chooser ?? top?.player ?? state.turnPlayer;
  return driver.submit(state, {
    player: chooser, kind: 'effect-choice', args: { promptId, choice },
  } as never).ok;
}

/** 当前挂着的选择请求（拿它的 id 与标题用） */
function pending(state: GameState): { id: string; title: string; uids: string[]; lines: number[] } {
  const top = state.pendingEffects[state.pendingEffects.length - 1];
  expect(top, '没有挂起的效果').toBeDefined();
  const p = top.prompt;
  expect(p, '挂起的效果没有 prompt ⇒ 这一关的动作链断了').not.toBeNull();
  return {
    id: top.id,
    title: p?.title ?? '',
    uids: (p?.candidates ?? []).map((c) => c.uid),
    lines: (p?.lines ?? []) as number[],
  };
}

/**
 * 教学屏 `recordChoices()` 的**同口径**（把当前挂着的 `select` 请求的候选集合记一笔）。
 *
 * 屏那一半在无 jsdom 的 node 下跑不了 ⇒ 这里按同一份契约读一遍，用来把 T7 的判据
 * （"默认档候选里没有被盖的那张、明写覆盖档里有"）在真引擎上钉住。
 */
function recordChoices(state: GameState): TutChoiceSeen[] {
  const out: TutChoiceSeen[] = [];
  for (const pe of state.pendingEffects) {
    const prompt = pe.prompt;
    if (prompt === null || prompt.kind !== 'select') continue;
    out.push({ source: pe.sourceDefId, uids: prompt.candidates.map((c) => c.uid) });
  }
  return out;
}

/** 造一张卡（T9/T11 那几条"伪造局面"的反向腿用；与 `setup.ts` 的 `card()` 同形） */
function rawCard(
  uid: string, defId: string, owner: PlayerId = 0, zone: Card['zone'] = 'hand',
  faceUp = true, line: Line | null = null, pos = 0,
): Card {
  return { uid, defId, owner, faceUp, zone, line, pos: zone === 'field' ? pos : null };
}

const readSrc = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(`../../${rel}`, import.meta.url)))
    .subarray(0, 1024 * 1024).toString('utf8');

describe('T0：界面扫盲（四个热点都点过才算过）', () => {
  it('点 3 个 ⇒ 不过；点满 4 个 ⇒ 过', () => {
    const level = levelById('T0');
    const s = buildLevelState('T0');
    expect(isLevelComplete(level, s, { spotsDone: [] }), '一个都没点就算过').toBe(false);
    expect(isLevelComplete(level, s, { spotsDone: ['link', 'protocol', 'threshold'] }), '只点 3 个就算过').toBe(false);
    expect(isLevelComplete(level, s, { spotsDone: ['link', 'protocol', 'threshold', 'control'] }), '四个都点了没过').toBe(true);
  });

  it('四个热点的定义与方案 §5.2 的四个概念一一对应（且白名单是空的：T0 不放引擎动作）', () => {
    const level = levelById('T0');
    expect(level.spots).toEqual(['link', 'protocol', 'threshold', 'control']);
    expect(level.allowKinds, 'T0 竟然放行了引擎动作').toEqual([]);
  });
});

/**
 * ★ 2026-10-02（用户追加两课）：**界面观察类**关卡的判据腿。
 *
 * T1 与 T6 里引擎状态**一模一样**（玩家只是看了看卡），所以判据读的是 `ui`
 * （屏在真 DOM 上观察到的事实）。DOM 那一半在无 jsdom 的 node 下跑不了 ⇒
 * 这里钉**判据**，真 DOM 那一半由 `screen.test.ts` 的源码腿 + 真机脚本兜。
 */
describe('T1：查看卡牌详情（打开过放大视图才算过）', () => {
  it('走对：打开过一次详情 ⇒ 过；一次都没打开 ⇒ 不过', () => {
    const level = levelById('T1');
    const s = buildLevelState('T1');
    expect(isLevelComplete(level, s, { ui: TUT_UI_NONE }), '一次都没打开就算过').toBe(false);
    expect(
      isLevelComplete(level, s, { ui: { detailsOpened: 1, peekAvailable: false, peekBlocked: false } }),
      '打开过一次详情却没判过关',
    ).toBe(true);
  });

  it('它是"看卡"关：不放任何引擎动作（双击放大不走引擎）', () => {
    const level = levelById('T1');
    expect(level.allowKinds, 'T1 竟然放行了引擎动作').toEqual([]);
    expect(level.ui?.detailsAtLeast, 'T1 的判据没有声明"要打开几次"').toBe(1);
    // 反向：「见过能看的反面牌」这件事本身不算"打开过详情"
    expect(
      isLevelComplete(level, buildLevelState('T1'), { ui: { detailsOpened: 0, peekAvailable: true, peekBlocked: true } }),
      '没打开过详情却被判过关',
    ).toBe(false);
  });

  it('局面里真的有牌可看（否则这一关没法做）', () => {
    const s = buildLevelState('T1');
    const cards = s.players[0].hand.length + s.players[0].stacks.flat().length;
    expect(cards, 'T1 的局面上一张牌都没有').toBeGreaterThan(0);
  });
});

describe('T2：打出第一张牌（判据 = 自己链路恰好 1 张正面）', () => {
  it('走对：打出一张正面牌 ⇒ 过', () => {
    const s = buildLevelState('T2');
    const level = levelById('T2');
    expect(isLevelComplete(level, s), '开局就算过关（判据恒真？）').toBe(false);
    expect(drive(s, 'play', { cardUid: 't2h1', faceUp: true, line: 0 }), '引擎拒了这次正面打出').toBe(true);
    expect(s.players[0].stacks[0].length, '线 0 上不是 1 张').toBe(1);
    expect(isLevelComplete(level, s), '打出一张正面牌之后没判过关').toBe(true);
  });

  it('走偏 ①：打了一张**反面**的 ⇒ 不过（那是 T3 的内容）', () => {
    const s = buildLevelState('T2');
    const level = levelById('T2');
    expect(drive(s, 'play', { cardUid: 't2h1', faceUp: false, line: 0 })).toBe(true);
    expect(s.players[0].stacks[0].length, '前置：反面牌也落地了').toBe(1);
    expect(isLevelComplete(level, s), '反着打一张竟然也算过 T2').toBe(false);
    // 走偏提示要**具体**：本关要的是正面
    expect(offTrackKeyFor(level, { kind: 'play', faceUp: false })).toBe('tutorial.off.face-down');
  });

  it('走偏 ②：正面牌打到不匹配的线 ⇒ 引擎**抛**（屏上捕获成 tutorial.off.rejected），局面不变', () => {
    const s = buildLevelState('T2');
    const before = JSON.stringify(s.players[0].stacks);
    // spirit-1 属于 spirit（线 0）；线 1 挂的是 water ⇒ 正面打出会被引擎**抛错**拒掉。
    // ⚠️ 是抛错而不是回 `ok:false` —— 屏里的 `cb.onAction` 用 try/catch 接住并给
    // `tutorial.off.rejected`，这一条就是那段 catch 的依据（去掉它 ⇒ 真机上会冒泡成未捕获异常）。
    expect(() => drive(s, 'play', { cardUid: 't2h1', faceUp: true, line: 1 }), '引擎没有拒').toThrow();
    expect(JSON.stringify(s.players[0].stacks), '被拒的动作改了局面').toBe(before);
    expect(isLevelComplete(levelById('T2'), s), '被拒的动作竟然算过关').toBe(false);
  });

  it('放行范围：T2 的白名单只有 play（编译不在里面）', () => {
    const level = levelById('T2');
    expect(level.allowKinds).toEqual(['play']);
    expect(offTrackKeyFor(level, { kind: 'compile' }), '编译没有被判为走偏')
      .toBe('tutorial.off.wrong-kind');
    expect(offTrackKeyFor(level, { kind: 'play', faceUp: true }), '正面的 play 被误判为走偏').toBe('tutorial.off.rejected');
  });
});

describe('T3：正面与反面各一张', () => {
  it('走对：先打正面再打反面 ⇒ 过（顺序反过来也过）', () => {
    const s = buildLevelState('T3');
    const level = levelById('T3');
    expect(isLevelComplete(level, s), '开局就算过关').toBe(false);
    expect(drive(s, 'play', { cardUid: 't3h1', faceUp: true, line: 0 })).toBe(true);
    expect(isLevelComplete(level, s), '只打了一张（正面）就算过关').toBe(false);
    expect(drive(s, 'play', { cardUid: 't3h2', faceUp: false, line: 1 })).toBe(true);
    expect(isLevelComplete(level, s), '正反各一张之后没判过关').toBe(true);
  });

  it('走偏：两张都正面 ⇒ 不过', () => {
    const s = buildLevelState('T3');
    expect(drive(s, 'play', { cardUid: 't3h1', faceUp: true, line: 0 })).toBe(true);
    expect(drive(s, 'play', { cardUid: 't3h2', faceUp: true, line: 1 })).toBe(true);
    expect(isLevelComplete(levelById('T3'), s), '两张都正面也算过 T3').toBe(false);
  });
});

/**
 * T4：五个基础动作。
 *
 * ⚠️ 这一组是**探路结论的验证**：五个动作靠"打出真卡 → 引擎弹选择 → 应答"这条真链路完成，
 * 判据是 `observedOps` 对前后快照的**差分**（不看玩家点了什么按钮）。
 *
 * ⚠️ **引擎会在一次动作之后把回合交给对手**（实测：第二次 play 报 "card … not in hand"，
 * 因为 `turnPlayer` 已经变成 1）⇒ 本文件在每次动作后**把回合交还玩家 0**：
 * 那是教学屏 `handBackTurn()` 的同口径做法（教学是沙盒，不是回合制对局）。
 */
describe('T4：翻转 / 偏转 / 抽牌 / 弃牌 / 回手 各一次', () => {
  it('五个动作逐个做一遍 ⇒ 五个签名都出现，且中途每少一个都不算过', () => {
    const s = buildLevelState('T4');
    const level = levelById('T4');
    const seen: TutOp[] = [];
    /** 教学屏那一条沙盒规则的**同口径**（见 `tutorial-screen.ts` 的 `handBackTurn()`） */
    const handBack = (): void => {
      // ⚠️ 2026-10-03：这里是**教学屏 `handBackTurn()` 的同口径**（沙盒规则）。
      //    它去掉了原来那个 `turnPlayer !== 0` 的 guard —— 引擎在一次 play 之后只推进到
      //    `check-cache` **且回合没换人**，而 render.ts 的落点判定写死了 `s.step === 'action'`
      //    ⇒ 带着那个 guard 的话"多动作关卡"在真界面上做完第一个动作就再也出不了第二张牌。
      if (s.phase === 'turn') {
        s.turnPlayer = 0;
        s.step = 'action';
        s.compiledThisTurn = false;
      }
    };
    const step = (kind: string, args: Record<string, unknown>): void => {
      const before = snapshot(s);
      expect(drive(s, kind, args), `提交被拒：${kind} ${JSON.stringify(args)}`).toBe(true);
      // 效果可能有挂起选择：把选择浮层一路应答到空（教学里就是玩家点候选卡）
      let guard = 0;
      while (s.pendingEffects.length > 0 && guard < 10) {
        const top = s.pendingEffects[s.pendingEffects.length - 1];
        const prompt = top.prompt;
        expect(prompt, '挂起的效果没有 prompt ⇒ 循环出不去').not.toBeNull();
        /**
         * 三种选择请求各按引擎的**编码**应答（与 `render.ts` 选择浮层送出去的那一种一致）：
         *  - `select`：候选是 `ChoiceCard` **对象**，送 `uid`（送对象会被引擎抛
         *    "invalid selection: [object Object]" —— 第一版就栽在这里）；
         *  - `select-line`：送 `'line:N'`；
         *  - `select-action`：送 `'action:<name>'`。
         */
        let choice: string[];
        if (prompt?.kind === 'select') {
          const cand = prompt.candidates;
          expect(cand.length, `「${prompt.title}」没有候选 ⇒ 这个动作在 T4 的局面里做不出来`).toBeGreaterThan(0);
          /**
           * 选谁：按"真人照提示会点哪一张"来选，而不是随手取第一张。
           *
           *  - **弃牌**那一步的候选是手牌：真人会弃那张用不上的 0 分牌（`t4h-fodder`）。
           *    随手取 `cands[0]` 会把后面还要用的教学卡弃掉 ⇒ 这一关做不完
           *    （这个真实风险由屏上的「重开这一关」按钮兜住，见 `tutorial-screen.ts`）。
           *  - **翻转**那一步的候选里既有"刚打出的这张"也有场上原有的牌：真人按提示会翻
           *    **场上那张反面的牌**。若翻"刚打出的这张"，它这一瞬间是 hand→field，
           *    `observedOps` 看不到朝向变化（差分只在"两次都在场上"时比 `faceUp`）⇒ 停在 4/5。
           */
          const fodder = cand.find((c) => c.uid === 't4h-fodder');
          const onField = cand.find((c) => c.zone === 'field' && !c.faceUp)
            ?? cand.find((c) => c.zone === 'field');
          choice = [(fodder ?? onField ?? cand[0]).uid];
        } else if (prompt?.kind === 'select-line') {
          const lines = prompt.lines ?? [];
          expect(lines.length, `「${prompt.title}」没有可选目标线`).toBeGreaterThan(0);
          choice = [`line:${lines[0]}`];
        } else {
          const actions = prompt?.actions ?? [];
          expect(actions.length, `「${prompt?.title ?? ''}」没有可选操作`).toBeGreaterThan(0);
          choice = [actions[0]];
        }
        expect(drive(s, 'effect-choice', { promptId: top.id, choice }), '应答选择被拒').toBe(true);
        guard += 1;
      }
      for (const op of observedOps(before, snapshot(s))) if (!seen.includes(op)) seen.push(op);
      handBack();
      // 判据本身：**五个没集齐就绝不算过**（集齐之前每一步都要断言"还没过"）
      if (seen.length < 5) {
        expect(isLevelComplete(level, s, { opsSeen: seen }), `只做到 ${seen.join('+')} 就判过关了`).toBe(false);
      }
    };

    // 五个动作各来一次（顺序按手里的卡）
    step('play', { cardUid: 't4h-flip', faceUp: true, line: 0 });     // 翻转
    step('play', { cardUid: 't4h-shift', faceUp: true, line: 2 });    // 偏转（darkness-4 → 线 2）
    step('play', { cardUid: 't4h-draw', faceUp: true, line: 0 });     // 抽牌
    step('play', { cardUid: 't4h-discard', faceUp: true, line: 0 });  // 弃牌
    step('play', { cardUid: 't4h-return', faceUp: true, line: 1 });   // 回手（water-4 → 线 1）
    expect(seen, '五个签名没齐').toEqual(['flip', 'shift', 'draw', 'discard', 'return']);
    expect(isLevelComplete(level, s, { opsSeen: seen }), '五个都做了却没判过关').toBe(true);
  });

  it('放行范围：T4 放行 play 与 effect-choice，但**不放行** compile', () => {
    const level = levelById('T4');
    expect(level.allowKinds).toEqual(['play', 'effect-choice']);
    expect(offTrackKeyFor(level, { kind: 'compile' })).toBe('tutorial.off.wrong-kind');
  });
});

describe('T5：覆盖与揭开（把对手线 0 那张压在下面）', () => {
  it('走对：把牌打到对手那张上面 ⇒ 它变成"被覆盖" ⇒ 过', () => {
    const s = buildLevelState('T5');
    const level = levelById('T5');
    expect(isLevelComplete(level, s), '开局就算过（对手那张本来就是堆顶未覆盖）').toBe(false);
    expect(s.players[1].stacks[0][0].uid, '局面没摆对').toBe('t5o1');
    // ⚠️ 覆盖对手的牌要传 `target: 1`（`PlayArgs.target` = 落在**哪个玩家**的链路）：
    //    不传就落在自己线上，对手那张一点没动 —— 第一版就是这样，被这条腿抓到。
    expect(drive(s, 'play', { cardUid: 't5h1', faceUp: true, line: 0, target: 1 }), '引擎拒了这次打出').toBe(true);
    // 对手那张现在不在堆顶 ⇒ 被覆盖（用引擎自己的 isUncovered 判，不自己重算）
    expect(isUncovered(s, s.players[1].stacks[0][0]), '对手那张没有被覆盖').toBe(false);
    expect(isLevelComplete(level, s), '盖住了却没判过关').toBe(true);
  });

  it('走偏：把牌打到自己线上（不传 target）⇒ 不过（对手那张没被动）', () => {
    const s = buildLevelState('T5');
    // ⚠️ `corruption-0` 能打在任意线，所以"打到别的线"**不会**被引擎拒（第一版的反控就是这么写错的）。
    //    真正的走偏是"打到自己线上"：牌落在自己那条线，对手那张仍然是未覆盖的堆顶。
    expect(drive(s, 'play', { cardUid: 't5h1', faceUp: true, line: 0 }), '打到自己的线竟然被拒').toBe(true);
    expect(isUncovered(s, s.players[1].stacks[0][0]), '打到自己的线竟然把对手那张盖住了').toBe(true);
    expect(isLevelComplete(levelById('T5'), s), '没盖住对手却算过关').toBe(false);
  });

  it('放行范围：T5 只放行 play', () => {
    expect(levelById('T5').allowKinds).toEqual(['play']);
    expect(offTrackKeyFor(levelById('T5'), { kind: 'compile' })).toBe('tutorial.off.wrong-kind');
  });
});

describe('★ T6：场上的反面牌能不能看（两个对照都要看过）', () => {
  it('走对：看过"能看的" + "不能看的" ⇒ 过；只看一个 ⇒ 不过', () => {
    const level = levelById('T6');
    const s = buildLevelState('T6');
    expect(isLevelComplete(level, s, { ui: TUT_UI_NONE }), '一个都没看就算过').toBe(false);
    expect(
      isLevelComplete(level, s, { ui: { detailsOpened: 2, peekAvailable: true, peekBlocked: false } }),
      '只看过"能看的"那张就判过关',
    ).toBe(false);
    expect(
      isLevelComplete(level, s, { ui: { detailsOpened: 2, peekAvailable: false, peekBlocked: true } }),
      '只看过"不能看的"那张就判过关',
    ).toBe(false);
    expect(
      isLevelComplete(level, s, { ui: { detailsOpened: 2, peekAvailable: true, peekBlocked: true } }),
      '两个对照都看过却没判过关',
    ).toBe(true);
  });

  it('★ 两个对照的局面**真的摆出来了**：线 0 非 secret（能看）、线 1 secret（不能看）', () => {
    const s = buildLevelState('T6');
    const open = s.players[0].stacks[0][0];
    const secret = s.players[0].stacks[1][0];
    expect(open.faceUp, '线 0 那张不是反面 ⇒ 这一关的"对照"不成立').toBe(false);
    expect(secret.faceUp, '线 1 那张不是反面').toBe(false);
    // ★ 这就是"已公开 vs 未公开"的机械形态：靠 `Card.secret`（types.ts:48）
    expect(open.secret, '线 0 那张被打了 secret（它应当是"已公开"的那一边）').not.toBe(true);
    expect(secret.secret, '线 1 那张没有 secret 标记（它应当是"牌库来源、未公开"的那一边）').toBe(true);
    // 判据的纯函数镜像：与 render.ts:418 的 peek 实参同口径
    expect(canPeekFaceDown(open, true, 'turn'), '「已公开的自己反面牌」被判成不能看').toBe(true);
    expect(canPeekFaceDown(secret, true, 'turn'), '「牌库来源的未公开反面牌」被判成能看').toBe(false);
    // 反向：**别人的**反面牌不能看（哪怕不是 secret）——这是 render.ts 的 isSelfSlot 那一支
    expect(canPeekFaceDown(open, false, 'turn'), '对手的反面牌被判成能看').toBe(false);
    // 反向：对局结束（复盘）时都能看
    expect(canPeekFaceDown(secret, false, 'gameover'), '复盘时被判成不能看').toBe(true);
  });

  it('★ canPeekFaceDown 与 render.ts 的 peek 判据**逐字同源**（改一边不改另一边就红）', () => {
    const render = stripComments(readSrc('src/ui/render.ts'));
    // render.ts 传给 openZoom 的第 5 个实参就是那条规则
    expect(
      render,
      'render.ts 里的 peek 判据变了（或者被搬走了）—— 请同步 src/tutorial/types.ts 的 canPeekFaceDown',
    ).toContain("card.faceUp || s.phase === 'gameover' || (isSelfSlot && !card.secret)");
    // 反向锚点：这段字符串**真的**在 openZoom 的调用点上（不是碰巧出现在别处）
    const at = render.indexOf("card.faceUp || s.phase === 'gameover'");
    expect(at, '找不到 peek 判据').toBeGreaterThan(0);
    // ⚠️ 往**前**找：那个调用跨两行，`openZoom(` 在第一行、判据是它的第 5 个实参（第二行）
    expect(render.slice(at - 120, at), 'peek 判据不在 openZoom 调用点上').toContain('openZoom(');
  });

  it('它是"看卡"关：不放任何引擎动作', () => {
    expect(levelById('T6').allowKinds, 'T6 竟然放行了引擎动作').toEqual([]);
  });
});

describe('T8：编译与阈值（线 0 编译完成）', () => {
  it('走对：编译线 0 ⇒ protocols[0].compiled === true ⇒ 过', () => {
    const s = buildLevelState('T8');
    const level = levelById('T8');
    expect(isLevelComplete(level, s), '开局就算过').toBe(false);
    // 前置：点差够（6 : 0），所以这条线**真的可以**编译
    expect(getLegalActions(s, s.turnPlayer).some((a) => a.kind === 'compile'),
      '线 0 的点差不够 ⇒ 这一关的判据在引擎里根本不成立').toBe(true);
    expect(drive(s, 'compile', { line: 0 }), '引擎拒了这次编译').toBe(true);
    expect(s.players[0].protocols[0].compiled, '编译之后协议没变已编译').toBe(true);
    expect(isLevelComplete(level, s), '编译完却没判过关').toBe(true);
  });

  it('走偏：什么都不做 ⇒ 不过；线 1 也**不可编译**（点差 0）当对照', () => {
    const s = buildLevelState('T8');
    expect(getLegalActions(s, s.turnPlayer).some((a) => a.kind === 'compile' && a.line === 1),
      '前置：线 1 竟然可以编译（那这条对照就没意义）').toBe(false);
    expect(isLevelComplete(levelById('T8'), s), '什么都没做就判过关').toBe(false);
  });

  it('放行范围：T8 只放行 compile（打牌不在白名单里）', () => {
    expect(levelById('T8').allowKinds).toEqual(['compile']);
    expect(offTrackKeyFor(levelById('T8'), { kind: 'play', faceUp: true })).toBe('tutorial.off.wrong-kind');
  });
});

/**
 * ★ 2026-10-02（P6 任务 A.1）：T7「默认目标规则」。
 *
 * 判据的**四样**（少一样都不算过）在真引擎上逐条钉住：
 *  ① 默认档那次选择的候选集合**不含**被盖住的那张（而且真的选不中：引擎会抛）；
 *  ② 明写「被覆盖」的那次候选集合**含**它；
 *  ③ 它真的被翻成了反面（状态差分）；
 *  ④ 玩家真的点过那张被压暗的牌（`blockedPickTried`，UI 真实交互）。
 */
describe('★ T7：默认目标规则（默认档点不到、明写「被覆盖」才点得到）', () => {
  /**
   * 把 T7 的**完整正路**跑一遍（两档各一次），返回局面与屏那份"候选集合"读数。
   *
   * 抽出来是为了让下面"四样缺一不可"那一组能在**同一个已完成的局面**上逐样改坏 ——
   * 否则每改一样都要重跑一遍流程，而且很容易写成"改坏之后其实还差别的东西"。
   */
  function runT7Flow(): { s: GameState; choices: TutChoiceSeen[] } {
    const s = buildLevelState('T7');
    expect(drive(s, 'play', { cardUid: 't7h-default', faceUp: true, line: 0 }), '引擎拒了精神2').toBe(true);
    const choices = recordChoices(s);
    // 默认档那一步：先试着选被盖的那张（会被引擎抛），再跳过
    const first = pending(s);
    expect(() => driveChoice(s, first.id, ['t7f-buried'])).toThrow();
    expect(driveChoice(s, first.id, []), '跳过默认档那次选择被拒').toBe(true);
    expect(drive(s, 'play', { cardUid: 't7h-covered', faceUp: true, line: 1 }), '引擎拒了腐化3').toBe(true);
    const all = [...choices, ...recordChoices(s)];
    expect(driveChoice(s, pending(s).id, ['t7f-buried']), '选中被盖的那张被拒').toBe(true);
    return { s, choices: all };
  }

  it('走对：两档候选集合一正一反，且状态真的变了 ⇒ 过', () => {
    const { s, choices } = runT7Flow();
    const level = levelById('T7');
    const def = choices.find((c) => c.source === 'spirit-2');
    expect(def, '打完精神2 没有弹出选择请求').toBeDefined();
    expect(def?.uids.length, '默认档的候选是空的 ⇒ "里面没有被盖的那张"就不说明问题').toBeGreaterThan(0);
    expect(def?.uids, '默认档的候选里出现了被盖住的 t7f-buried（默认规则破了）').not.toContain('t7f-buried');
    const explicit = choices.find((c) => c.source === 'corruption-3');
    expect(explicit, '打完腐化3 没有弹出选择请求').toBeDefined();
    expect(explicit?.uids, '明写「被覆盖」的那张牌，候选里没有被盖住的卡').toContain('t7f-buried');
    const buried = s.players[0].stacks[0].find((c) => c.uid === 't7f-buried');
    expect(buried?.faceUp, '腐化3 没有把被盖的那张翻成反面（状态差分不成立）').toBe(false);
    expect(isLevelComplete(level, s, {
      ui: { ...TUT_UI_NONE, blockedPickTried: true, choices },
    }), '两个对照都做到了却没判过关').toBe(true);
    // 开局（还没做任何事）当然不过
    expect(isLevelComplete(level, buildLevelState('T7')), '开局就算过').toBe(false);
  });

  /**
   * ★ 判据的四样**缺一不可**（用户口径的"判据要用候选集合的**集合**来定"就落在这四样上）。
   *
   * 这一组是给反向验证（`p6-mutate.mjs` 的 M8~M11）准备的地面：每一处改坏都**只**影响一样，
   * 所以哪一条腿红就能反推是哪一样坏了 —— 这比"整体不过"那种笼统判据有信息量得多。
   */
  it('★ 四样缺一不可：逐样改坏 ⇒ 各有一条腿红', () => {
    const { s, choices } = runT7Flow();
    const level = levelById('T7');
    const ok = (ui: Partial<typeof TUT_UI_NONE> & { choices?: readonly TutChoiceSeen[] }): boolean =>
      isLevelComplete(level, s, { ui: { ...TUT_UI_NONE, blockedPickTried: true, choices, ...ui } });

    expect(ok({}), '四样齐了却没判过关').toBe(true);
    // ① 没点过那张被压暗的牌
    expect(ok({ blockedPickTried: false }), '没点过那张压暗的牌也算过').toBe(false);
    // ② 默认档的候选里混进了被盖的那张（"默认只列未覆盖顶卡"这条口径破了）
    expect(ok({
      choices: choices.map((c) => (c.source === 'spirit-2' ? { ...c, uids: [...c.uids, 't7f-buried'] } : c)),
    }), '默认档的候选里混进被盖的那张也算过').toBe(false);
    // ③ 明写覆盖档的候选里没有被盖的那张
    expect(ok({
      choices: choices.map((c) => (c.source === 'corruption-3' ? { ...c, uids: [] } : c)),
    }), '明写覆盖档的候选里没有被盖的那张也算过').toBe(false);
    // ④ 状态没变（那张牌还是正面）—— 拿"只打了默认档"的局面当反例
    const onlyDefault = buildLevelState('T7');
    drive(onlyDefault, 'play', { cardUid: 't7h-default', faceUp: true, line: 0 });
    const onlyChoices = recordChoices(onlyDefault);
    driveChoice(onlyDefault, pending(onlyDefault).id, []);
    expect(isLevelComplete(level, onlyDefault, {
      ui: {
        ...TUT_UI_NONE, blockedPickTried: true,
        // 候选集合那两条**假装都满足**（补一份明写覆盖档的候选），只留"状态没变"这一样坏
        choices: [...onlyChoices, { source: 'corruption-3', uids: ['t7f-buried'] }],
      },
    }), '状态没变（没翻面）也算过').toBe(false);
  });

  it('走偏 ①：没点过那张被压暗的牌 ⇒ 不过（不许"跳过对照直接过关"）', () => {
    const s = buildLevelState('T7');
    drive(s, 'play', { cardUid: 't7h-default', faceUp: true, line: 0 });
    const choices = recordChoices(s);
    driveChoice(s, pending(s).id, []);
    drive(s, 'play', { cardUid: 't7h-covered', faceUp: true, line: 1 });
    const all = [...choices, ...recordChoices(s)];
    driveChoice(s, pending(s).id, ['t7f-buried']);
    expect(isLevelComplete(levelById('T7'), s, {
      ui: { ...TUT_UI_NONE, blockedPickTried: false, choices: all },
    }), '没做"试着点被盖的牌"那一下就算过').toBe(false);
  });

  it('走偏 ②：只打了默认档那张（没走到明写覆盖档）⇒ 不过', () => {
    const s = buildLevelState('T7');
    drive(s, 'play', { cardUid: 't7h-default', faceUp: true, line: 0 });
    const choices = recordChoices(s);
    driveChoice(s, pending(s).id, []);
    expect(isLevelComplete(levelById('T7'), s, {
      ui: { ...TUT_UI_NONE, blockedPickTried: true, choices },
    }), '只打了默认档那张就判过关').toBe(false);
  });

  it('局面本身：精神3 真的被精神5 压住（对照的前提），且线 1 是腐化协议线', () => {
    const s = buildLevelState('T7');
    const stack = s.players[0].stacks[0];
    expect(stack.map((c) => c.uid)).toEqual(['t7f-buried', 't7f-cover']);
    expect(isUncovered(s, stack[0]), '精神3 没有被压住 ⇒ 这一关的对照不成立').toBe(false);
    expect(s.players[0].protocols[1].defId, '线 1 不是腐化协议线（腐化3 正面打不出去）').toBe('corruption');
    // 被盖的那张必须是**正面**（腐化3 的候选要求"被覆盖的正面朝上的卡牌"）
    expect(stack[0].faceUp).toBe(true);
  });

  it('放行范围：T7 放行 play 与 effect-choice，不放行 compile', () => {
    expect(levelById('T7').allowKinds).toEqual(['play', 'effect-choice']);
    expect(offTrackKeyFor(levelById('T7'), { kind: 'compile' })).toBe('tutorial.off.wrong-kind');
  });
});

/**
 * ★ 2026-10-02（P6 任务 A.2）：T9「打出 vs 露出」。
 *
 * 判据是**日志差分 + 状态差分**（用户口径），两条露出途径各做到一次：
 *  - 翻正露出：`[中部] speed-0：原因：翻正`（`resolve.ts:469`）；
 *  - 被揭开露出：`[揭示] speed-0 被揭开（其上卡被移除）` + `[中部] speed-0：原因：被揭开`
 *    （`resolve.ts:1103/1104`，由 `shift` 顶卡那一支的 `revealAfterRemoval` 触发）。
 */
describe('★ T9：打出 vs 露出（两条露出途径各一次）', () => {
  it('走对：翻正对手那张 + 偏转走盖着自己那张 ⇒ 过；中途每一步都不算过', () => {
    const s = buildLevelState('T9');
    const level = levelById('T9');
    expect(isLevelComplete(level, s), '开局就算过').toBe(false);

    // —— 第一种：翻正露出 ——
    expect(drive(s, 'play', { cardUid: 't9h-flip', faceUp: true, line: 0 }), '引擎拒了黑暗1').toBe(true);
    const flipPick = pending(s);
    expect(flipPick.title, '黑暗1 的第一问不是"翻转1张你对手的牌"').toContain('翻转1张你对手的牌');
    expect(flipPick.uids, '对手场上唯一的顶卡不在候选里').toContain('t9f-opp');
    expect(driveChoice(s, flipPick.id, ['t9f-opp']), '选中对手那张被拒').toBe(true);
    expect(s.players[1].stacks[2][0].faceUp, '对手那张速度0 没被翻正（状态差分）').toBe(true);
    expect(revealSeen(s).flipped, '日志里没有 [中部] speed-0：原因：翻正').toBe(true);
    expect(revealSeen(s).revealed, '翻正那一步就把"被揭开"也算上了').toBe(false);
    expect(isLevelComplete(level, s), '只做到翻正就判过关').toBe(false);

    // 黑暗1 的第二问（可选偏转）：跳过
    const flipOptional = pending(s);
    expect(flipOptional.lines.length, '黑暗1 的可选偏转没有可选线').toBeGreaterThan(0);
    expect(driveChoice(s, flipOptional.id, []), '跳过可选偏转被拒').toBe(true);
    expect(s.pendingEffects.length, '跳过后还有挂起的效果').toBe(0);

    // —— 第二种：把盖着自己那张速度0 的牌偏转走 ⇒ 被揭开 ——
    expect(drive(s, 'play', { cardUid: 't9h-cover', faceUp: false, line: 1 }), '反面盖住被拒').toBe(true);
    expect(isUncovered(s, s.players[0].stacks[1][0]), '前置：那张速度0 还没被盖住').toBe(false);
    expect(isLevelComplete(level, s), '只盖住还没揭开就判过关').toBe(false);

    expect(drive(s, 'play', { cardUid: 't9h-shift', faceUp: true, line: 0 }), '引擎拒了黑暗4').toBe(true);
    const shiftPick = pending(s);
    expect(shiftPick.title, '黑暗4 的第一问不是"偏转1张反面牌"').toContain('偏转1张反面牌');
    expect(shiftPick.uids, '盖着那张不在候选里').toEqual(['t9h-cover']);
    expect(driveChoice(s, shiftPick.id, ['t9h-cover']), '选中盖着那张被拒').toBe(true);
    const shiftLine = pending(s);
    expect(shiftLine.lines, '偏转目标线不含线 2').toContain(2);
    expect(driveChoice(s, shiftLine.id, ['line:2']), '选目标线被拒').toBe(true);

    expect(isUncovered(s, s.players[0].stacks[1][0]), '速度0 没被揭开').toBe(true);
    expect(revealSeen(s).revealed, '日志里没有 [揭示]/[中部] speed-0：原因：被揭开').toBe(true);

    // 被揭开之后，速度0 的中部「打出1张牌」接着结算（手里那张精神3 是唯一候选）
    const payPick = pending(s);
    expect(payPick.title, '被揭开后的中部不是"打出1张牌"').toContain('打出1张牌');
    expect(payPick.uids, '手牌里唯一那张不在候选里').toEqual(['t9h-pay']);
    expect(driveChoice(s, payPick.id, ['t9h-pay']), '选中精神3 被拒').toBe(true);
    const payFace = pending(s);
    expect(payFace.title, '没有问"以正面还是反面打出"').toContain('以正面还是反面打出');
    expect(driveChoice(s, payFace.id, ['action:face-up']), '选正面被拒').toBe(true);
    const payLine = pending(s);
    expect(payLine.lines, '精神3 正面打不出去（线 2 不是精神协议线）').toContain(2);
    expect(driveChoice(s, payLine.id, ['line:2']), '选线 2 被拒').toBe(true);
    expect(s.pendingEffects.length, '结算完还有挂起的效果').toBe(0);

    expect(isLevelComplete(level, s), '两条露出都做到了却没判过关').toBe(true);
  });

  it('走偏：只翻正不动盖子那张 ⇒ 不过（一条途径不顶两条）', () => {
    const s = buildLevelState('T9');
    drive(s, 'play', { cardUid: 't9h-flip', faceUp: true, line: 0 });
    driveChoice(s, pending(s).id, ['t9f-opp']);
    driveChoice(s, pending(s).id, []);
    expect(revealSeen(s).flipped).toBe(true);
    expect(isLevelComplete(levelById('T9'), s), '只做翻正就判过关').toBe(false);
  });

  it('★ 走偏：只做"偏转揭开"、不翻正对手那张 ⇒ 不过（"翻正"那一项是真的在判）', () => {
    // 这一条把判据里的 `seen.flipped` 单独钉住：其余三样（被揭开 / 对手那张的状态 /
    // 我方那张未覆盖）在这个局面里都成立，只有"翻正"没做。
    const s = buildLevelState('T9');
    expect(drive(s, 'play', { cardUid: 't9h-cover', faceUp: false, line: 1 }), '反面盖住被拒').toBe(true);
    expect(drive(s, 'play', { cardUid: 't9h-shift', faceUp: true, line: 0 }), '引擎拒了黑暗4').toBe(true);
    expect(driveChoice(s, pending(s).id, ['t9h-cover']), '选中盖着那张被拒').toBe(true);
    expect(driveChoice(s, pending(s).id, ['line:2']), '选目标线被拒').toBe(true);
    expect(revealSeen(s).revealed, '前置：被揭开那一路应当成立').toBe(true);
    expect(revealSeen(s).flipped, '前置：翻正那一路不该成立').toBe(false);
    const ours = s.players[0].stacks[1][0];
    expect(isUncovered(s, ours), '前置：我方那张应当已经未被覆盖').toBe(true);
    expect(isLevelComplete(levelById('T9'), s), '没做翻正也算过（`flipped` 那一项没在判）').toBe(false);
  });

  it('★ 反向实测（方案 §7.10）：偏转**被覆盖的那张本身**（allowCovered）**不**触发中部', () => {
    /**
     * 这一条是"不要照着直觉改文案"的机械保障：用户口径里的"偏转把被覆盖的卡变为未被覆盖"
     * 有两种读法，其中**偏转被盖住的那张自己**走的是 `completeShift` 的落地重估
     * （`resolve.ts:1091`，只对 `diversity-0`/`unity-1` 开）⇒ speed-0 的中部**不会**触发。
     * 课上演示用的是另一条（偏转**盖着它的那张**，走 `revealAfterRemoval`）。
     * 两条都实测过；这条腿把"后者成立、前者不成立"钉死，免得以后有人把课改成错的。
     */
    const s = createGame({ seed: 't9-shift-covered', draftStarter: 0, firstToPlay: 0 });
    s.phase = 'turn';
    s.step = 'action';
    s.turnPlayer = 0;
    s.draftRound = 6;
    s.draftPicks = [];
    s.draftPool = [];
    s.log = [];
    s.pendingEffects = [];
    s.pendingPlay = [];
    s.pendingShift = [];
    s.players[0].protocols = [{ defId: 'spirit', compiled: false }, { defId: 'water', compiled: false }, { defId: 'darkness', compiled: false }];
    s.players[1].protocols = [{ defId: 'spirit', compiled: false }, { defId: 'water', compiled: false }, { defId: 'darkness', compiled: false }];
    // 对手线 0：speed-0（正面、**被盖住**）＋ 一张正面顶卡
    s.players[1].stacks[0] = [rawCard('b0', 'speed-0', 1, 'field', true, 0, 0), rawCard('b-cover', 'water-1', 1, 'field', true, 0, 1)];
    s.players[0].hand = [rawCard('h-dark0', 'darkness-0', 0, 'hand', true)];
    s.players[0].deck = [rawCard('e1', 'water-2', 0, 'deck'), rawCard('e2', 'water-3', 0, 'deck'), rawCard('e3', 'water-4', 0, 'deck')];
    expect(isUncovered(s, s.players[1].stacks[0][0]), '前置：speed-0 应当是被盖住的').toBe(false);

    // 黑暗0 的中指令：抽 3 张 → 偏转 1 张**对手被盖住的**牌（`allowCovered: true`）
    expect(drive(s, 'play', { cardUid: 'h-dark0', faceUp: true, line: 2 }), '引擎拒了黑暗0').toBe(true);
    const pick = pending(s);
    expect(pick.title, '黑暗0 的选择不是"偏转1张你对手的被盖住的牌"').toContain('被盖住的牌');
    expect(pick.uids, '被盖住的 b0 不在候选里').toContain('b0');
    expect(driveChoice(s, pick.id, ['b0']), '选中 b0 被拒').toBe(true);
    const line = pending(s);
    expect(driveChoice(s, line.id, ['line:1']), '选目标线被拒').toBe(true);

    // 它在新线成了未覆盖的顶卡 —— 但**中部没有再次触发**
    const moved = s.players[1].stacks[1].find((c) => c.uid === 'b0');
    expect(moved, 'b0 没有被偏转过去').toBeDefined();
    expect(moved?.line, 'b0 的目标线不是 1').toBe(1);
    expect(isUncovered(s, moved as Card), '前置：b0 在目标线应当是未覆盖的顶卡').toBe(true);
    expect(revealSeen(s).revealed, '偏转被覆盖者竟然触发了"被揭开"那一路').toBe(false);
    expect(s.log.some((l) => l.includes('[中部] speed-0')), '偏转被覆盖者竟然触发了中部指令（与 §7.10 的实测相反）').toBe(false);
  });

  it('放行范围：T9 放行 play 与 effect-choice', () => {
    expect(levelById('T9').allowKinds).toEqual(['play', 'effect-choice']);
    expect(offTrackKeyFor(levelById('T9'), { kind: 'compile' })).toBe('tutorial.off.wrong-kind');
  });
});

/**
 * ★ 2026-10-02（P7）：**后四关（T10~T13）**的判据腿。
 *
 * 四关的动作链都先在真引擎上实测过一遍（探针 `.superpowers/p7-verify/engine.probe.ts`，
 * 读数写在方案 §7.13），这里的腿是那批读数的**回归**：走对 ⇒ 过；走偏 / 零操作 ⇒ 不过。
 */
describe('★ T10：控制权（s.control === 自己）', () => {
  it('走对：点一次「推进」⇒ 引擎在控制阶段判定 ⇒ control=0 ⇒ 过', () => {
    const s = buildLevelState('T10');
    const level = levelById('T10');
    expect(isLevelComplete(level, s), '开局就算过（control 已经是自己的？）').toBe(false);
    expect(s.control, '局面没摆对：控制权应当从中立开始').toBe(-1);
    expect(s.step, '局面没摆对：应当停在控制阶段那一步').toBe('check-control');
    // 这一步在引擎里真的只有「推进」可以点（`getLegalActions` 在 check-control 只出 advance）
    expect(getLegalActions(s, 0).map((a) => a.kind), '控制阶段还能干别的？').toEqual(['advance']);
    expect(drive(s, 'advance', {}), '引擎拒了这次推进').toBe(true);
    expect(s.control, '推进之后控制权没到手（判定门槛不是文案写的那样？）').toBe(0);
    expect(isLevelComplete(level, s), '控制权到手了却没判过关').toBe(true);
  });

  it('★ 文案必须写实现口径：判据门槛是「至少两条线高过对手」，不是「差 5」', () => {
    // 实现口径的出处：`src/core/rules/control.ts:41-51`（`wins >= 2`）。
    // 上一轮有人在编译那一课把门槛讲成"差 5"被自己的腿抓到（方案 §7.9 ③），这里用同一手法钉住：
    // 局面本身只有**两条**线领先（第三条 0:0）—— 若门槛是"差 5"，线 1（3:1）根本不算。
    const s = buildLevelState('T10');
    const lead = ([0, 1, 2] as Line[]).filter((l) => getLineValue(s, 0, l) > getLineValue(s, 1, l));
    expect(lead, '这个局面不是"恰好两条线领先"').toEqual([0, 1]);
    expect(getLineValue(s, 0, 0) - getLineValue(s, 1, 0), '线 1 的差值恰好是 2 ⇒ 与"差 5"口径可分辨').toBe(2);
    const zh = ZH as Record<string, string>;
    expect(zh['tutorial.T10.teach.1'], 'T10 的讲解没写"两条线"这个口径').toContain('两条');
    expect(zh['tutorial.T10.teach.2'], 'T10 的讲解没否掉"看差值/看总分"那种说法').toContain('不是');
  });

  it('走偏：什么都不做 ⇒ 不过（控制权还是中立）', () => {
    const s = buildLevelState('T10');
    expect(isLevelComplete(levelById('T10'), s), '没点推进就判过关').toBe(false);
  });

  it('放行范围：T10 只放行「推进」（这一关不教打牌）', () => {
    expect(levelById('T10').allowKinds).toEqual(['advance']);
    expect(offTrackKeyFor(levelById('T10'), { kind: 'play', faceUp: true })).toBe('tutorial.off.wrong-kind');
  });
});

describe('★ T11：触发时机（打出后 / 被盖住前 / 结束 各一次）', () => {
  /**
   * ★ 2026-10-03（**本轮实测重写**）：这一关的棋盘与三步动作链都改了，腿跟着改。
   *
   * 旧摆法（冰1 在我方线 1，靠"对手出牌"触发「打出后」）在教学屏里**走不通**：
   * 那一步要求玩家去打**对手手牌**，而教学屏只会在 `state.turnPlayer` 那一侧提交
   * （render.ts 也只把当前行动方的手牌做成可拖拽物）⇒ 判据里的"打出后"永远不成立。
   * 现在：冰1 摆在**对手**那条线（`t11o-ice1`），我在**自己同一条线**上盖火焰0 的那一次
   * 出牌同时打响两处（`fireDirectedTop` 查的正是"打出者的对手同线顶卡"）。
   * 实测读数（`.superpowers/2026-10-03-S0-序章/step.probe.test.ts`）：
   * `① 盖牌后 step=action pending=2` ⇒ 应答后 `step=check-cache` ⇒ 推进 ⇒ `step=end` ⇒ 结算 ⇒ 判据 true。
   */
  it('走对：盖火焰0（同时响两处）→ 推进到结束 → 结算生命0 ⇒ 三条触发都出现 ⇒ 过', () => {
    const s = buildLevelState('T11');
    const level = levelById('T11');
    expect(isLevelComplete(level, s), '开局就算过').toBe(false);

    // —— ① 反面盖住自己的火焰0：同一次出牌里「被盖住前」与「打出后」都响 ——
    expect(drive(s, 'play', { cardUid: 't11h-cover', faceUp: false, line: 1 }), '引擎拒了这次反面盖牌').toBe(true);
    expect(isUncovered(s, s.players[0].stacks[1][0]), '前置：火焰0 应当已经被盖住').toBe(false);
    expect(triggersSeen(s.log)['before-covered'], '日志里没有「被盖前」那条触发').toBeGreaterThanOrEqual(1);
    // 冰1 的底命令罚的是**往那条线出牌的人**（`ice1AfterPlay`：`foe = opp(ctx.player)`）⇒ 这次是我弃牌
    const discardPick = pending(s);
    expect(discardPick.uids, '冰1 的「打出后」没有给出候选（或候选不是手里那张弃料）').toEqual(['t11h-fodder']);
    expect(driveChoice(s, discardPick.id, ['t11h-fodder']), '弃牌被拒').toBe(true);
    /**
     * ★ 实测：`after-play` 是**定向触发**（`resolve.ts:70-94` 的 `fireDirectedTop`），它
     * **不写阶段日志**（`pushEffectLog` 只在 `fireReactive` 那一支）⇒ 日志里没有
     * `[连锁·出牌后]` 这一行（`stageLabel('after-play')` 因此是一条**当前不可达**的标签）。
     * 所以这一路的证据是**状态**：那张 `t11h-fodder` 只可能因为这次弃牌进我的弃牌堆
     * （出牌只把 `t11h-cover` 放到场上）—— 而且关卡文案里**不许**让玩家去日志里找它。
     */
    expect(s.players[0].trash.some((c) => c.uid === 't11h-fodder'), '冰1 的「打出后」没有让我弃掉那张牌').toBe(true);
    expect(s.log.some((l) => l.includes('[连锁·出牌后]')),
      '日志里竟然出现了 [连锁·出牌后]（那说明 fireDirectedTop 开始写日志了 —— 请把判据改回日志通道，'
      + '并同步 types.ts 的 TRIGGER_LABEL）').toBe(false);
    for (const [lang, table] of [['zh', ZH], ['en', EN]] as const) {
      const obs = (table as Record<string, string>)['tutorial.T11.observe'] ?? '';
      expect(obs, `${lang} 的 T11 观察点让玩家去日志里找一条不存在的记录`).not.toContain('连锁·出牌后');
      expect(obs, `${lang} 的 T11 观察点没写那两条真的会出现的日志标题`).toContain('[被盖前]');
    }
    expect(isLevelComplete(level, s), '只做到两处触发就判过关').toBe(false);

    // —— ② 推进到结束阶段（教学屏的 allowKinds 里有 advance；这一步是玩家点棋盘上的「下一步」） ——
    expect(getLegalActions(s, 0).map((a) => a.kind), '前置：这一步应当只剩「推进」可点').toEqual(['advance']);
    expect(drive(s, 'advance', {}), '引擎拒了这次推进').toBe(true);
    expect(s.step, '推进之后没到结束阶段').toBe('end');

    // —— ③ 结束：点那张被盖住的生命0 的「结算触发」 ——
    expect(getLegalActions(s, 0).some((a) => a.kind === 'resolve-trigger' && a.cardUid === 't11f-c'),
      '结束阶段没有给出生命0 的结算按钮 ⇒ 这一课做不出来').toBe(true);
    expect(drive(s, 'resolve-trigger', { cardUid: 't11f-c' }), '引擎拒了这次结算').toBe(true);
    expect(triggersSeen(s.log).end, '日志里没有「结束」那条触发').toBeGreaterThanOrEqual(1);
    const life0 = s.players[0].trash.find((c) => c.uid === 't11f-c');
    expect(life0, '生命0 没被移除（状态差分不成立）').toBeDefined();
    expect(isLevelComplete(level, s), '三种触发都出现了却没判过关').toBe(true);
  });

  it('★ 三路证据缺一不可：逐样改坏 ⇒ 各有一条腿红', () => {
    /**
     * T11 的判据有四样（打出后 / 被盖住前 / 结束 / 生命0 真的离开场上），
     * 这里用"伪造局面 + 逐样改坏"把它们**逐条**钉住（T7 那一组是同款手法）：
     * 光有"整条正路跑通"那一条腿时，把任意一路改成恒真都**不会红**（实测见 `.superpowers/p7-verify/`
     * 的 M7~M10）—— 那说明那条腿只证明了"走得通"，没证明"缺了不行"。
     * ⚠️ 2026-10-03 跟着判据改方向：证据那张牌是**我方**的 `t11h-fodder`（理由见 judge.ts）。
     */
    const build = (mut: (s: GameState) => void): GameState => {
      const s = buildLevelState('T11');
      // 造一份"三路证据都成立"的伪造局面：生命0 不在场上、我方那张弃料进了弃牌堆、两条日志都在
      s.players[0].stacks[2] = [rawCard('t11c-cover', 'life-5', 0, 'field', true, 2, 0)];
      s.players[0].trash = [rawCard('t11h-fodder', 'ice-5', 0, 'trash', true)];
      s.log = ['[被盖前] fire-0', '[结束] life-0：由 P1 结算'];
      mut(s);
      return s;
    };
    const level = levelById('T11');
    expect(isLevelComplete(level, build(() => { /* 什么都不改 */ })), '三路证据齐了却没判过关').toBe(true);
    // ① 打出后：那张弃料没进弃牌堆
    expect(isLevelComplete(level, build((s) => { s.players[0].trash = []; })),
      '没弃牌也算过「打出后」').toBe(false);
    // ② 被盖住前：日志里没有那一条
    expect(isLevelComplete(level, build((s) => { s.log = ['[结束] life-0：由 P1 结算']; })),
      '日志里没有被盖前也算过').toBe(false);
    // ③ 结束：日志里没有那一条
    expect(isLevelComplete(level, build((s) => { s.log = ['[被盖前] fire-0']; })),
      '日志里没有结束也算过').toBe(false);
    // ④ 生命0 还在场上（"结束"那一支其实没生效）
    expect(isLevelComplete(level, build((s) => { s.players[0].stacks[2] = [rawCard('t11f-c', 'life-0', 0, 'field', true, 2, 0)]; })),
      '那张生命0 还在场上也算过').toBe(false);
  });

  it('走偏：只盖住火焰0（不推进、不结算）⇒ 不过（一条触发顶不了三条）', () => {
    const s = buildLevelState('T11');
    drive(s, 'play', { cardUid: 't11h-cover', faceUp: false, line: 1 });
    driveChoice(s, pending(s).id, ['t11h-fodder']);
    expect(triggersSeen(s.log)['before-covered'], '前置：被盖前那一路应当成立').toBeGreaterThanOrEqual(1);
    expect(isLevelComplete(levelById('T11'), s), '只做一种触发就判过关').toBe(false);
  });

  it('放行范围：T11 放行 play / effect-choice / advance / resolve-trigger（advance 是 2026-10-03 补的）', () => {
    expect(levelById('T11').allowKinds).toEqual(['play', 'effect-choice', 'advance', 'resolve-trigger']);
    expect(offTrackKeyFor(levelById('T11'), { kind: 'compile' })).toBe('tutorial.off.wrong-kind');
    // ★ 这一关的三种触发跨了三步（action → check-cache → end）⇒ 必须让引擎自己的步真的走
    expect(levelById('T11').keepStep, 'T11 没有声明 keepStep ⇒ 玩家永远到不了结束阶段').toBe(true);
  });

  it('局面本身：三张被触发的卡与各自的位置都对（这一关的三种时机真的摆出来了）', () => {
    const s = buildLevelState('T11');
    expect(s.players[1].stacks[1].map((c) => c.defId), '对手线 2 上不是冰1（打出后的触发源）').toEqual(['ice-1']);
    expect(s.players[0].stacks[1][0].defId, '我方线 2 上不是火焰0').toBe('fire-0');
    expect(s.players[0].stacks[2].map((c) => c.defId), '线 3 上不是"被盖住的生命0"').toEqual(['life-0', 'life-5']);
    expect(isUncovered(s, s.players[0].stacks[2][0]), '前置：生命0 应当已经被盖住').toBe(false);
    // 冰1 的「打出后」罚的是"往那条线出牌的人" ⇒ 我手里必须留一张可弃的牌（否则那条效果静默 fizzle，
    // 判据里的"打出后"就永远不成立 —— 第一版就是这么摆的，被上面那条正路腿当场抓到）
    expect(s.players[0].hand.map((c) => c.uid), '手里没有留给「打出后」弃的那张牌').toContain('t11h-fodder');
  });
});

/**
 * ★ 2026-10-03（用户要求「再加上一关，用于先告诉玩家背景故事，然后再给玩家详细解释，
 * 这个游戏的胜利条件是什么，然后再是介绍界面」）：**序章 S0** 的腿。
 *
 * 这一关的判据就是"真打赢这一局"（`s.winner === 0`）⇒ 腿必须**真驱动引擎**把那一局打完
 * （打出补分的牌 ⇒ 编译 ⇒ 终局），而不是拿一份伪造的状态去问判据。
 */
describe('★ S0：序章（背景故事 + 胜利条件；玩家亲手打赢这一局）', () => {
  it('走对：打出那张 1 分牌（线 3 到 10 且高于对手）⇒ 编译 ⇒ 三条协议全编译 ⇒ winner=0 ⇒ 过', () => {
    const s = buildLevelState('S0');
    const level = levelById('S0');
    expect(isLevelComplete(level, s), '开局就算过').toBe(false);
    expect(s.winner, '局面没摆对：开局就有赢家').toBeNull();
    // 前置①：三条协议里**两条**已经编译过（"决胜那一步"这个局面）
    expect(s.players[0].protocols.map((p) => p.compiled), '局面不是"两条已编译 + 一条没编译"')
      .toEqual([true, true, false]);
    // 前置②：第 3 条链路差 1 分到 10，而且**高于对手**（编译条件自己算一遍：own >= 10 && own > opp）
    expect(getLineValue(s, 0, 2), '局面没摆对：我方线 3 不是 9 分').toBe(9);
    expect(getLineValue(s, 1, 2), '局面没摆对：对手线 3 不是 2 分').toBe(2);
    expect(getLegalActions(s, 0).some((a) => a.kind === 'compile'), '局面没摆对：这条线现在就能编译').toBe(false);
    // 前置③：手里那张牌真的能打进第 3 条链路（正面打出的协议匹配）
    expect(drive(s, 'play', { cardUid: 's0h1', faceUp: true, line: 2 }), '引擎拒了那张补分的牌').toBe(true);
    expect(getLineValue(s, 0, 2), '打完之后这条链路没到 10').toBe(10);
    expect(getLineValue(s, 0, 2) > getLineValue(s, 1, 2), '打完之后不高过对手').toBe(true);
    expect(isLevelComplete(level, s), '只补到 10 分就判过关（协议还没编译）').toBe(false);
    // 引擎的真实次序是"编译判定在自己回合开头"⇒ 教学屏把步摆回 check-compile（见 TutLevel.toCompileStepAfterPlay）
    s.step = 'check-compile';
    expect(getLegalActions(s, 0).map((a) => a.kind), '补到 10 分之后引擎没给出编译（那一步不是强制的？）')
      .toEqual(['compile']);
    expect(drive(s, 'compile', { line: 2 }), '引擎拒了这次编译').toBe(true);
    // 真终局：三条协议全编译 + 赢家 + gameover（`compile-body.ts:131`）
    expect(s.players[0].protocols.every((pr) => pr.compiled), '三条协议没全部编译').toBe(true);
    expect(s.winner, '编译完之后没有赢家').toBe(0);
    expect(s.phase, '没有进入终局结算').toBe('gameover');
    expect(isLevelComplete(level, s), '打赢了却没判过关').toBe(true);
  });

  it('走偏：什么都不做 ⇒ 不过；只打牌不编译 ⇒ 不过（判据不是"打了一张牌"）', () => {
    const s = buildLevelState('S0');
    expect(isLevelComplete(levelById('S0'), s), '什么都没做就判过关').toBe(false);
    drive(s, 'play', { cardUid: 's0h1', faceUp: true, line: 2 });
    expect(isLevelComplete(levelById('S0'), s), '只打出牌、没编译就判过关').toBe(false);
    // 反向锚点：这一关**不是**"编译一条线就算过"（那是 T8）—— 必须三条全编译 + 赢
    expect(s.players[0].protocols.filter((p) => p.compiled).length, '前置：这时只有两条已编译').toBe(2);
  });

  it('放行范围：S0 放行 play 与 compile（补分与编译这两步真的需要）', () => {
    const level = levelById('S0');
    expect(level.allowKinds).toEqual(['play', 'compile']);
    expect(level.ui?.detailsAtLeast, '这一关的判据不是纯 UI 读数').toBeUndefined();
    // ★ 它靠 `toCompileStepAfterPlay` 把步交回 check-compile（引擎真实的编译判定那一步）
    expect(level.toCompileStepAfterPlay, 'S0 没有声明 toCompileStepAfterPlay').toBe(true);
    expect(offTrackKeyFor(level, { kind: 'advance' })).toBe('tutorial.off.wrong-kind');
  });

  it('★ 它是"四件套"齐全的**序章**：实战例子 / 引导步骤 / 观察点都不是缺键回退形态', () => {
    const l = levelById('S0');
    expect(l.scenario(), '没有实战例子').not.toContain('⟪');
    expect(l.guidedSteps.length, '没有引导步骤').toBe(2);
    expect(l.observe(), '没有观察点').not.toContain('⟪');
    // 文案逐句取自官方规则书页图（定稿与出处见 .superpowers/2026-10-03-S0-序章/S0-copy.md）
    expect(l.title(), '标题不是定稿那句').toBe('序章：你是谁，怎么算赢');
  });
});

describe('★ T12：删除 / 加成 / 免疫 各一次', () => {
  /** 把 T12 的完整正路跑一遍（三样各一次），返回局面 */
  function runT12Flow(): GameState {
    const s = buildLevelState('T12');
    // ① 删除：火焰1（先弃掉流水0，再删对手那张生命2）
    expect(drive(s, 'play', { cardUid: 't12h-del', faceUp: true, line: 0 }), '引擎拒了火焰1').toBe(true);
    const discardPick = pending(s);
    expect(discardPick.uids, '火焰1 的弃牌候选里没有那张弃料').toContain('t12h-fodder');
    expect(driveChoice(s, discardPick.id, ['t12h-fodder']), '弃牌被拒').toBe(true);
    const delPick = pending(s);
    expect(delPick.uids, '删除候选里没有对手那张生命2').toContain('t12o1');
    expect(driveChoice(s, delPick.id, ['t12o1']), '选中生命2 被拒').toBe(true);
    // ② 加成：明晰0
    expect(drive(s, 'play', { cardUid: 't12h-buff', faceUp: true, line: 1 }), '引擎拒了明晰0').toBe(true);
    // ③ 免疫：死板1 去翻对手那张死板7
    expect(drive(s, 'play', { cardUid: 't12h-flip', faceUp: true, line: 2 }), '引擎拒了死板1').toBe(true);
    const flipPick = pending(s);
    expect(flipPick.uids, '死板1 的翻转候选里没有对手那张死板7（摆错边了？）').toEqual(['t12f-rigid']);
    expect(driveChoice(s, flipPick.id, ['t12f-rigid']), '选中死板7 被拒').toBe(true);
    return s;
  }

  it('走对：删除 + 加成 + 免疫 都做到 ⇒ 过；中途每一步都不算过', () => {
    const s = buildLevelState('T12');
    const level = levelById('T12');
    expect(isLevelComplete(level, s), '开局就算过').toBe(false);

    // ① 删除
    drive(s, 'play', { cardUid: 't12h-del', faceUp: true, line: 0 });
    driveChoice(s, pending(s).id, ['t12h-fodder']);
    driveChoice(s, pending(s).id, ['t12o1']);
    expect(s.players[1].trash.some((c) => c.uid === 't12o1'), '前置：生命2 应当进了对手弃牌堆').toBe(true);
    expect(isLevelComplete(level, s), '只做了删除就判过关').toBe(false);

    // ② 加成
    drive(s, 'play', { cardUid: 't12h-buff', faceUp: true, line: 1 });
    expect(getLineValue(s, 0, 1), '明晰0 的加成没有改变线 2 的总值').not.toBe(0);
    expect(isLevelComplete(level, s), '只做了删除+加成就判过关').toBe(false);

    // ③ 免疫
    drive(s, 'play', { cardUid: 't12h-flip', faceUp: true, line: 2 });
    driveChoice(s, pending(s).id, ['t12f-rigid']);
    expect(isLevelComplete(level, s), '三样都做到了却没判过关').toBe(true);
  });

  it('★ 免疫：死板7 仍是正面，而且日志里有引擎那句「不可被翻转，跳过」', () => {
    const s = runT12Flow();
    const imm = s.players[1].stacks[2].find((c) => c.uid === 't12f-rigid');
    expect(imm?.faceUp, '死板7 被翻面了（免疫没生效？）').toBe(true);
    expect(s.log.some((l) => l.includes('rigidity-7 不可被翻转，跳过')),
      '日志里没有引擎那条免疫跳过（判据的日志那一半没成立）').toBe(true);
  });

  it('走偏 ①：不删那张牌（只做加成+免疫）⇒ 不过', () => {
    const s = buildLevelState('T12');
    drive(s, 'play', { cardUid: 't12h-buff', faceUp: true, line: 1 });
    drive(s, 'play', { cardUid: 't12h-flip', faceUp: true, line: 2 });
    driveChoice(s, pending(s).id, ['t12f-rigid']);
    expect(isLevelComplete(levelById('T12'), s), '没删除也判过关').toBe(false);
  });

  it('走偏 ②：那张被保护的牌**本来就是正面**，所以"没被翻"本身不算做到免疫', () => {
    // 只打火焰1（删除）+ 明晰0（加成），碰都没碰死板7 ⇒ 免疫那一半没有证据 ⇒ 不过
    const s = buildLevelState('T12');
    drive(s, 'play', { cardUid: 't12h-del', faceUp: true, line: 0 });
    driveChoice(s, pending(s).id, ['t12h-fodder']);
    driveChoice(s, pending(s).id, ['t12o1']);
    drive(s, 'play', { cardUid: 't12h-buff', faceUp: true, line: 1 });
    const imm = s.players[1].stacks[2].find((c) => c.uid === 't12f-rigid');
    expect(imm?.faceUp, '前置：那张死板7 本来就该是正面').toBe(true);
    expect(isLevelComplete(levelById('T12'), s), '没去翻它也算做到免疫').toBe(false);
  });

  it('★ 加成那一路真的在判：线 2 的总值**确实被那条线自己的牌数改了**，而"没改"的形态不过', () => {
    /**
     * 这条腿把"加成"这一路**单独**钉住（去掉了它 ⇒ 从这里红）：
     *  - 正路：明晰0 打到线 2 之后，引擎算出来的线值与开局**不同**（0 → 1）；
     *  - 反例：把那张明晰0 **从线 2 拿掉**（模拟"加成没生效"的形态），其余两样都做到 ⇒ 必须不过。
     * 为什么不用"改坏判据"的方式测：那要改 `judge.ts`（变异脚本 M12 干的事），
     * 这里的腿要在**不改源码**的前提下把同一件事证明出来。
     */
    const s = runT12Flow();
    expect(getLineValue(s, 0, 1), '明晰0 打到线 2 之后总值没变（加成那一路在判据里其实没起作用？）').not.toBe(0);

    const fake = buildLevelState('T12');
    // 删除 + 免疫都做到，只有"加成"那一半**不成立**（线 2 上一张自己的牌都没有 ⇒ 总值 0）
    drive(fake, 'play', { cardUid: 't12h-del', faceUp: true, line: 0 });
    driveChoice(fake, pending(fake).id, ['t12h-fodder']);
    driveChoice(fake, pending(fake).id, ['t12o1']);
    drive(fake, 'play', { cardUid: 't12h-flip', faceUp: true, line: 2 });
    driveChoice(fake, pending(fake).id, ['t12f-rigid']);
    expect(fake.players[1].trash.some((c) => c.uid === 't12o1'), '前置：删除那一半应当成立').toBe(true);
    expect(getLineValue(fake, 0, 1), '前置：线 2 的总值应当还是 0').toBe(0);
    expect(isLevelComplete(levelById('T12'), fake), '没做加成就判过关（加成那一路没在判）').toBe(false);
  });

  it('放行范围：T12 放行 play 与 effect-choice', () => {
    expect(levelById('T12').allowKinds).toEqual(['play', 'effect-choice']);
    expect(offTrackKeyFor(levelById('T12'), { kind: 'compile' })).toBe('tutorial.off.wrong-kind');
  });
});

describe('★ T13：迷你对局（打到终局 s.winner !== null）', () => {
  it('走对：编译线 3 ⇒ 三条协议全已编译 ⇒ winner=自己 ⇒ 过', () => {
    const s = buildLevelState('T13');
    const level = levelById('T13');
    expect(isLevelComplete(level, s), '开局就算过').toBe(false);
    expect(s.winner, '局面没摆对：开局就有赢家').toBeNull();
    // 前置：这条线**真的**可编译（自己 ≥10 且高于对手）
    expect(getLegalActions(s, 0).some((a) => a.kind === 'compile' && a.line === 2),
      '线 3 不可编译 ⇒ 这一关的判据在引擎里不成立').toBe(true);
    expect(drive(s, 'compile', { line: 2 }), '引擎拒了这次编译').toBe(true);
    expect(s.players[0].protocols.every((pr) => pr.compiled), '三条协议没全部编译').toBe(true);
    expect(s.winner, '编译完之后没有赢家').toBe(0);
    expect(s.phase, '没有进入终局结算').toBe('gameover');
    expect(isLevelComplete(level, s), '打到终局却没判过关').toBe(true);
  });

  it('走偏：什么都不做 ⇒ 不过（只编译过两条线不算打完）', () => {
    const s = buildLevelState('T13');
    expect(s.players[0].protocols.filter((pr) => pr.compiled).length, '局面里应当只有两条已编译').toBe(2);
    expect(isLevelComplete(levelById('T13'), s), '没编译第三条就判过关').toBe(false);
  });

  it('放行范围：T13 只放行 compile', () => {
    expect(levelById('T13').allowKinds).toEqual(['compile']);
    expect(offTrackKeyFor(levelById('T13'), { kind: 'play', faceUp: true })).toBe('tutorial.off.wrong-kind');
  });
});

/**
 * ★ 2026-10-02（P6 任务 B）：**教学设计四件套的生成式腿**。
 *
 * 用户 2026-10-01 追加的硬要求：「我希望**所有的教程中都要有我举的这种以实战场举例子
 * 并引导玩家的教学方式**」⇒ 不许有"只念文字"的关卡。这一组是"以后新增关卡自动受约束"
 * 的那条保障：
 *  1. 每关 `scenario` 非空、`guidedSteps.length ≥ 1` 且每条非空、`observe` 非空；
 *  2. 每关都有"至少一种真实操作"—— 按 `interaction` 分成**两类，各自的成立条件显式写出**
 *     （引擎动作类：真的放行了引擎动作、判据不是纯 UI 读数；UI 交互类：有 UI 状态差分的落点），
 *     **不放宽成恒真**（下面有两条"两类都存在"的反向锚点）；
 *  3. 判据依赖"操作引起的变化"：**零操作时没有任何一关算过** —— 这条把
 *     "只念文字 / 点下一步就算过"直接钉死。
 */
describe('★ 教学设计四件套（生成式：以后新增关卡自动受约束）', () => {
  it('锚点：十五关（S0 + T0~T13）、引擎动作类与 UI 交互类**都存在**（否则下面每条腿在空集上恒真）', () => {
    expect(TUT_LEVELS.length, '关卡数不是 15（S0 + T0~T13）').toBe(15);
    expect(TUT_LEVELS.filter((l) => l.interaction === 'engine').length, '一个引擎动作类关卡都没有').toBeGreaterThan(0);
    expect(TUT_LEVELS.filter((l) => l.interaction === 'ui').length, '一个 UI 交互类关卡都没有').toBeGreaterThan(0);
  });

  it('每关都有实战例子 / 引导步骤 / 观察点，且都不是缺键回退形态', () => {
    for (const l of TUT_LEVELS) {
      expect(l.scenario().length, `${l.id} 没有实战例子`).toBeGreaterThan(0);
      expect(l.scenario(), `${l.id} 的实战例子是缺键回退形态`).not.toContain('⟪');
      expect(l.guidedSteps.length, `${l.id} 没有引导步骤`).toBeGreaterThanOrEqual(1);
      for (const step of l.guidedSteps) {
        expect(step().length, `${l.id} 有一条空步骤`).toBeGreaterThan(0);
        expect(step(), `${l.id} 的引导步骤是缺键回退形态`).not.toContain('⟪');
      }
      expect(l.observe().length, `${l.id} 没有观察点`).toBeGreaterThan(0);
      expect(l.observe(), `${l.id} 的观察点是缺键回退形态`).not.toContain('⟪');
    }
  });

  it('★ 每关都有"至少一种真实操作"，两类的成立条件**显式**成立（不许恒真）', () => {
    const engineIds: string[] = [];
    const uiIds: string[] = [];
    for (const l of TUT_LEVELS) {
      if (l.interaction === 'engine') {
        engineIds.push(l.id);
        // 引擎动作类：本关真的放行了引擎动作（玩家必须提交一次）
        expect(l.allowKinds.length, `${l.id} 声明走引擎动作，却没放行任何动作`).toBeGreaterThanOrEqual(1);
        // 而且判据不能是纯 UI 读数（那样"引擎动作"就白放了）
        expect(l.ui?.detailsAtLeast, `${l.id} 声明走引擎动作，判据却是纯 UI 计数`).toBeUndefined();
      } else {
        uiIds.push(l.id);
        // UI 交互类：有 UI 状态差分的落点（T0 的四个热点 / T1、T6 的详情遮罩真的打开过）
        const uiEvidence = (l.spots?.length ?? 0) > 0 || (l.ui?.detailsAtLeast ?? 0) > 0;
        expect(uiEvidence, `${l.id} 声明走 UI 交互，却没有 UI 状态差分的落点`).toBe(true);
      }
    }
    // 两类的"存在性"再锚一次：UI 交互类正好是 T0/T1/T6（看卡与点热点那三关）
    expect(uiIds, 'UI 交互类关卡变了 —— 请确认新那一关的"真实操作"是什么').toEqual(['T0', 'T1', 'T6']);
    expect(engineIds.length + uiIds.length).toBe(TUT_LEVELS.length);
  });

  it('★ 判据依赖"操作引起的变化"：**零操作时没有任何一关算过**（这条就是"只念文字"的反面）', () => {
    for (const l of TUT_LEVELS) {
      const s = buildLevelState(l.id);
      expect(isLevelComplete(l, s), `${l.id} 什么都不做就判过关 —— 这是"点下一步就算过"的形态`).toBe(false);
      expect(isLevelComplete(l, s, { ui: TUT_UI_NONE }), `${l.id} 只传一个空 ui 就判过关`).toBe(false);
      expect(isLevelComplete(l, s, { spotsDone: [], opsSeen: [], ui: TUT_UI_NONE }),
        `${l.id} 传齐三路空输入就判过关`).toBe(false);
    }
  });
});

/**
 * ★ 2026-10-03（**用户报的缺陷 → 用户裁决的修法**）：**教学受控局面里，双方协议不许重名**。
 *
 * ## 为什么这是一条必须钉住的纪律（不是洁癖）
 *
 * `src/ui/render.ts:2384` 的已编译协议**持久特效层注册表** `compiledFx` 是**以 defId 为键**的，
 * 它依赖一条前提，代码自己写在 `render.ts:170-171`：
 * 「每玩家 3 协议 defId 互不相同、双方亦不共享（草案池每 defId 只出现一次）→ 以 defId 为键安全」。
 * 真对局里这条前提成立（`getDraftPool` 滤掉已挑走的 defId，`src/core` 也没有任何地方改写
 * `protocols` 的 defId），而教学这批局面是**手摆的**：改之前 `controlledGame` 给双方摆的是
 * **同一组**协议（15/15 关都重名）⇒ 同一个 defId 的两格共用一层：
 *   · 一侧已编译、另一侧同名未编译时，未编译那支把已建好的层 `remove()` 掉（谁后跑谁赢）；
 *   · 两侧都已编译时，层被摆到最后处理的那个 holder 上。
 * 两种都表现为**只有一边亮已编译特效**（用户 2026-10-03 报的就是这个）。
 *
 * 用户当天的裁决：**不做"双方共用同一协议"的玩法**（永远不出现）⇒ 正确处置是让教学的局面也
 * 满足那条前提（`setup.ts` 的 `opponentProtocols()`），**不去动红线 `render.ts`**。
 * 这条腿就是那个裁决的守卫：以后哪一关手摆出重名，这里当场红。
 */
describe('★ 受控局面：双方协议两两不重名（已编译特效的 defId 键前提）', () => {
  /** 两份协议列表的交集（判据本体；下面那条反向锚点证明它不是恒空） */
  const overlap = (mine: readonly string[], foe: readonly string[]): string[] =>
    mine.filter((d) => foe.includes(d));

  it('十五关逐关检查：双方协议 defId 的交集为空', () => {
    for (const l of TUT_LEVELS) {
      const s = buildLevelState(l.id);
      const mine = s.players[0].protocols.map((p) => p.defId);
      const foe = s.players[1].protocols.map((p) => p.defId);
      expect(mine.length, `${l.id} 我方协议不是三条`).toBe(3);
      expect(foe.length, `${l.id} 对手协议不是三条`).toBe(3);
      expect(overlap(mine, foe), `${l.id} 双方协议重名 —— 已编译特效会撞 defId 键（只有一边亮）`).toEqual([]);
      // 顺带：一侧内部也不许重名（同一位玩家对同一协议最多一张，这是"以 defId 为键"的另一半前提）
      expect(new Set(mine).size, `${l.id} 我方自己两条线挂了同一个协议`).toBe(3);
      expect(new Set(foe).size, `${l.id} 对手自己两条线挂了同一个协议`).toBe(3);
    }
  });

  it('反向锚点：把"同一组协议"喂给同一个判据 ⇒ 它必须报出重名（否则上面那条在空集上恒真）', () => {
    const same = ['spirit', 'water', 'darkness'];
    expect(overlap(same, same), '判据认不出重名 ⇒ 上面那条腿是假的').toEqual(same);
    expect(overlap(['spirit', 'water', 'darkness'], ['fire', 'light', 'life']), '判据把不重名也算成重名了').toEqual([]);
  });

  /**
   * ★ 2026-10-03（**用户报的缺陷**）：**场上每一张正面牌都必须属于"它自己那一侧"那条线的协议**。
   *
   * 用户原话（第二轮，明确纠正了我第一版放宽的口径）：
   * 「关于教学场上的卡牌改成本线协议的牌，你有一点搞错了，就是我说的范围还包括，例如**第一关的那个
   *   生命协议场上的明光2**，我希望将其换成生命协议的卡牌，懂我意思吗」。
   *
   * ⚠️ 这条比**引擎的落线规则**更严，两者别混：
   *  - 引擎（`src/core/actions/base.ts:33-37` 的 `isPlayableFaceUp`）：正面牌的协议 == **本线我方协议
   *    或本线对手协议**——任一即可（这是真规则，改不得）；
   *  - 本条（**教学局面的可读性口径**）：`协议 == 该牌所有者在这条线的协议`。理由就是用户那句
   *    "生命协议场上摆着一张明光2"：对手那条线挂着他自己的生命协议，他压在那条线上的牌就该是生命牌。
   * **反面牌不看协议**（`base.ts:66` 只守正面）⇒ 一律跳过。
   *
   * 实测（改之前）：按严格口径有 4 关对不上 —— S0 对手线 3 的 `light-2`（他自己那条线是 life）、
   * T4 对手线 1 的 `spirit-2`（fire）、T10 对手线 1 的 `spirit-1`（fire）、T12 对手线 3 的
   * `rigidity-7`（darkness）。前三条换了靶子牌（**分值不变**）；T12 那条是教学对象不能换卡，
   * 于是把那条线的**对手协议**设成 `rigidity`、我方线 3 改挂 `darkness` 并把"翻对手牌"那张
   * 从 `rigidity-1` 换成 `darkness-1`（同一件事，被死板7 挡住时引擎写同一条日志）。
   */
  it('★ 场上每一张正面牌都属于**它自己那一侧**那条线的协议（反面牌不看协议）', () => {
    const protocolOf = (defId: string): string => defId.replace(/-\d+$/, '');
    for (const l of TUT_LEVELS) {
      const s = buildLevelState(l.id);
      for (const pid of [0, 1] as const) {
        const own = s.players[pid].protocols.map((p) => p.defId);
        for (const line of [0, 1, 2] as const) {
          for (const c of s.players[pid].stacks[line]) {
            if (!c.faceUp) continue; // 反面牌不看协议
            expect(
              protocolOf(c.defId),
              `${l.id}: 正面牌 ${c.defId}（玩家 ${pid + 1} 的第 ${line + 1} 条线）不属于**他自己**那条线的协议`
              + `（他这条线挂的是 ${own[line]}）—— 屏上就是"一张不属于这个协议的卡牌"`,
            ).toBe(own[line]);
          }
        }
      }
    }
  });
});

describe('关卡数据本身（顺序 / 序号 / 钳位）', () => {
  it('十五关的 id 与顺序就是 S0 + T0~T13（S0 插在最前面，其余 id 一个都没动）', () => {
    expect(TUT_LEVELS.map((l) => l.id)).toEqual([
      'S0', 'T0', 'T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8', 'T9', 'T10', 'T11', 'T12', 'T13',
    ]);
    // ★ 2026-10-03：S0 插在**最前面** ⇒ 原来每一关的**序号**往后挪一格，但 **id 没变**
    //   （已存进度里的 current/done 仍指向原来那几课 —— 这是"不重新编号"的代价与好处）
    expect(levelIndex('S0'), 'S0 不在最前面').toBe(0);
    expect(levelIndex('T0'), 'T0 被 S0 顶到第 2 位').toBe(1);
    expect(levelIndex('T9')).toBe(10);
    // ★ P7：后四关是**追加**上去的（老 id 没有被重新指向，不用清本机数据 —— 与 P5/P6 两次不同）
    expect(levelIndex('T10'), 'T10 不在 T9 之后').toBe(11);
    expect(levelIndex('T13')).toBe(14);
    expect(levelAt(1)).toBe('T0');
    expect(levelAt(2)).toBe('T1');
  });

  it('★ 追加两课的**编排位置**：详情紧跟 T0、反面牌可视与默认目标规则在"覆盖与揭开"之后', () => {
    // 用户要求："查看卡牌详情"紧随界面扫盲；"反面牌可视规则"放在"覆盖与揭开"之后；
    // 方案 §7.10 ③ 要求"默认目标规则"也放在"覆盖与揭开"之后（本仓摆在反面牌可视之后、
    // 编译之前），"打出 vs 露出"排在最后（它讲触发途径，是最"效果向"的一课）。
    // ⚠️ 2026-10-03：S0 插到最前面 ⇒ 这里每一条的**下标**都往后挪 1（断言的是 id，不是"第几关"）
    expect(TUT_LEVELS[1].id, '界面扫盲（T0）不在序章之后').toBe('T0');
    expect(TUT_LEVELS[2].id, '「查看卡牌详情」不在 T0 之后').toBe('T1');
    expect(levelIndex('T5'), '「覆盖与揭开」的位置变了').toBe(6);
    expect(TUT_LEVELS[7].id, '「反面牌可视规则」不在「覆盖与揭开」之后').toBe('T6');
    expect(TUT_LEVELS[8].id, '「默认目标规则」不在「反面牌可视」之后').toBe('T7');
    expect(TUT_LEVELS[10].id, '「打出 vs 露出」不是最后一关').toBe('T9');
  });

  it('序号越界钳到两端（通关之后再进教学停在最后一关，不是崩）', () => {
    expect(levelAt(-5)).toBe('S0');
    expect(levelAt(99)).toBe('T13');
  });

  it('★ 关卡总数只有一处真相（屏与隐私屏都取常量，不把"共 8 关"写死）', () => {
    expect(TUT_LEVEL_COUNT).toBe(TUT_LEVELS.length);
    const screen = readSrc('src/ui/tutorial-screen.ts');
    const localData = readSrc('src/ui/local-data.ts');
    expect(screen, '屏上没有用 TUT_LEVEL_COUNT / TUT_LEVELS.length 取总数')
      .toMatch(/TUT_LEVEL_COUNT|TUT_LEVELS\.length/);
    expect(localData, '隐私屏没有用常量取总数').toMatch(/TUT_LEVEL_COUNT|TUT_LEVELS\.length/);
  });

  it('每关都有标题 / 目标 / 至少一句讲解，且各关文案**互不相同**（不是复制粘贴同一句）', () => {
    const titles = new Set<string>();
    const goals = new Set<string>();
    for (const l of TUT_LEVELS) {
      expect(l.title().length, `${l.id} 的标题是空的`).toBeGreaterThan(0);
      expect(l.goal().length, `${l.id} 的目标是空的`).toBeGreaterThan(0);
      expect(l.teach.length, `${l.id} 没有讲解`).toBeGreaterThan(0);
      for (const line of l.teach) expect(line().length, `${l.id} 有一句空讲解`).toBeGreaterThan(0);
      // 反向：缺键会回退成 `⟪键⟫` 那种形状 —— 屏上不许出现它
      expect(l.title(), `${l.id} 的标题是缺键回退形态`).not.toContain('⟪');
      expect(l.goal(), `${l.id} 的目标是缺键回退形态`).not.toContain('⟪');
      titles.add(l.title());
      goals.add(l.goal());
    }
    expect(titles.size, '各关标题有重复').toBe(TUT_LEVELS.length);
    expect(goals.size, '各关目标有重复').toBe(TUT_LEVELS.length);
  });
});

describe('进度存取（住在既有 L1_SETTINGS 里，零新增键）', () => {
  function store() {
    return createLocalStore({ persistent: createMemoryStore() });
  }

  it('没玩过 ⇒ 第一关（S0）+ 空 done；过一关 ⇒ 记进 done 且当前关推到下一关', () => {
    const s = store();
    s.grant();
    // ★ 2026-10-03：第一关是 S0（序章）—— 没玩过的人从它开始，不是从 T0
    expect(readProgress(s)).toEqual({ done: [], current: 'S0', allDone: false });
    writeTutorialProgress(s, advance(s, 'S0'));
    expect(readProgress(s), '过完 S0 之后没有推到 T0').toEqual({ done: ['S0'], current: 'T0', allDone: false });
    writeTutorialProgress(s, advance(s, 'T0'));
    expect(readProgress(s), '过完 T0 之后没有推到 T1').toEqual({ done: ['S0', 'T0'], current: 'T1', allDone: false });
    writeTutorialProgress(s, advance(s, 'T1'));
    expect(readProgress(s)).toEqual({ done: ['S0', 'T0', 'T1'], current: 'T2', allDone: false });
  });

  it('最后一关过完停在最后一关（不会被钳到别处）', () => {
    const s = store();
    s.grant();
    writeTutorialProgress(s, advance(s, 'T13'));
    expect(readProgress(s).current, '过完 T13 之后当前关不是 T13').toBe('T13');
    expect(readProgress(s).done).toEqual(['T13']);
  });

  it('★ 2026-10-03 插序章之后：老进度里的当前关**照旧有效**（S0 是插进来的，id 没重排）', () => {
    // P5/P6 两次是"插入新关卡 ⇒ 老 id 指向另一课"，P7 是往后追加，这一次是**往前**插一关 ——
    // 三种都不动既有 id ⇒ 老进度的语义没变（代价：老进度不会补看序章，要看得点「从头开始」）。
    const s = store();
    s.grant();
    s.kv().set('compile-settings', JSON.stringify({ tutorial: { done: ['T0', 'T1'], current: 'T9' } }));
    expect(readProgress(s), '老进度里的 T9 读不出来').toEqual({ done: ['T0', 'T1'], current: 'T9', allDone: false });
    // 过完 T9 ⇒ 当前关推到 T10（追加出来的第一关），而不是被钳在 T9
    writeTutorialProgress(s, advance(s, 'T9'));
    expect(readProgress(s).current).toBe('T10');
  });

  it('「从头开始」清空 done 与当前关（**不动**昵称/语言那些设置），当前关回到第一关 S0', () => {
    const s = store();
    s.grant();
    writeTutorialProgress(s, advance(s, 'T0'));
    s.kv().set('compile-settings', JSON.stringify({ nick: '甲', lang: 'en', tutorial: { done: ['T0'], current: 'T1' } }));
    restart(s);
    const raw = JSON.parse(String(s.kv().get('compile-settings'))) as Record<string, unknown>;
    expect(raw.tutorial).toEqual({ done: [], current: 'S0' });
    expect(raw.nick, '「从头开始」把昵称也清了').toBe('甲');
    expect(raw.lang, '「从头开始」把语言也清了').toBe('en');
  });

  it('坏值 / 坏 JSON ⇒ 退回"没玩过"（当前关 = 第一关 S0；不抛、不把进度卡在非法状态）', () => {
    const s = store();
    s.grant();
    s.kv().set('compile-settings', JSON.stringify({ tutorial: { done: ['TX', 42, 'T0'], current: 'TX' } }));
    expect(readTutorialProgress(s), '非法值没有被过滤').toEqual({ done: ['T0'], current: 'S0' });
    s.kv().set('compile-settings', '{"tutorial":');
    expect(readTutorialProgress(s), '坏 JSON 时应当退回"没玩过"').toEqual({ done: [], current: 'S0' });
    s.kv().set('compile-settings', JSON.stringify({ tutorial: 'nope' }));
    expect(readTutorialProgress(s), '不是对象时应当退回"没玩过"').toEqual({ done: [], current: 'S0' });
  });

  it('★ 纯层那份关卡 id 清单与本模块的 TUT_LEVELS **一致**（两份清单不许漂）', () => {
    // `src/app/local-store.ts` 是纯层，不许 import `src/tutorial/**` ⇒ 它自己列了一份 id。
    // 这条腿把两份钉在一起：加了新关卡却忘了改那份 ⇒ 当场红。
    const storeSrc = readSrc('src/app/local-store.ts');
    const ids = TUT_LEVELS.map((l) => l.id);
    for (const id of ids) {
      expect(storeSrc, `纯层的关卡 id 清单里少了 ${id}`).toContain(`'${id}'`);
    }
    // 反向：纯层清单里不许有本模块没有的 id（幽灵 id）
    const listed = [...storeSrc.matchAll(/'(T\d+)'/g)].map((m) => m[1]);
    const ghosts = [...new Set(listed)].filter((id) => !ids.includes(id as never));
    expect(ghosts, `纯层清单里有本模块不存在的关卡 id：${ghosts.join(', ')}`).toEqual([]);
  });

  it('游客模式：进度只进内存（盘上零写入）—— 与语言/向导标记同一条口径', () => {
    const s = store();
    s.deny();
    writeTutorialProgress(s, { done: ['T0'], current: 'T1' });
    expect(readProgress(s).done, '游客模式下内存里的进度都不对').toEqual(['T0']);
    expect(s.isPersistent(), '游客模式竟然在写盘').toBe(false);
  });
});
