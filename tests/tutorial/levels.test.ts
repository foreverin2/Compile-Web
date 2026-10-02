import { describe, it, expect } from 'vitest';
import { buildLevelState } from '../../src/tutorial/setup';
import { observedOps, snapshot, isLevelComplete, offTrackKeyFor } from '../../src/tutorial/judge';
import { levelById, TUT_LEVELS, levelAt, levelIndex } from '../../src/tutorial/levels';
import { createLocalDriver } from '../../src/app/match-driver';
import { createLocalStore, readTutorialProgress, writeTutorialProgress } from '../../src/app/local-store';
import { advance, readProgress, restart } from '../../src/tutorial/progress';
import { createMemoryStore } from '../../src/app/storage';
import type { GameState, Line } from '../../src/core/models/types';
import type { TutOp } from '../../src/tutorial/types';

/**
 * ★ 2026-10-02（P2）：教学关卡的**判据有效性**腿（方案 §8："走对 ⇒ 过；走偏 ⇒ 不过且给提示"）。
 *
 * 手法：直接驱动 `LocalDriver`（与屏同一套）把局面推向"过关"或"走偏"，然后问
 * `isLevelComplete` 与 `observedOps`。**不 import 屏**（`src/ui/tutorial-screen.ts` 碰 DOM，
 * 在无 jsdom 的 node 下跑不了）—— 屏那一层由 `screen.test.ts` 的源码腿与真机读数兜。
 */

/** 一次"提交并回答"的驱动（与屏里那个 `cb.onAction` 同一套调用面） */
function drive(state: GameState, kind: string, args: Record<string, unknown>): boolean {
  const driver = createLocalDriver();
  return driver.submit(state, { player: state.turnPlayer, kind, args } as never).ok;
}

describe('T1：打出第一张牌（判据 = 自己链路恰好 1 张正面）', () => {
  it('走对：打出一张正面牌 ⇒ 过', () => {
    const s = buildLevelState('T1');
    const level = levelById('T1');
    expect(isLevelComplete(level, s), '开局就算过关（判据恒真？）').toBe(false);
    expect(drive(s, 'play', { cardUid: 't1h1', faceUp: true, line: 0 }), '引擎拒了这次正面打出').toBe(true);
    expect(s.players[0].stacks[0].length, '线 0 上不是 1 张').toBe(1);
    expect(isLevelComplete(level, s), '打出一张正面牌之后没判过关').toBe(true);
  });

  it('走偏 ①：打了一张**反面**的 ⇒ 不过（那是 T2 的内容）', () => {
    const s = buildLevelState('T1');
    const level = levelById('T1');
    expect(drive(s, 'play', { cardUid: 't1h1', faceUp: false, line: 0 })).toBe(true);
    expect(s.players[0].stacks[0].length, '前置：反面牌也落地了').toBe(1);
    expect(isLevelComplete(level, s), '反着打一张竟然也算过 T1').toBe(false);
    // 走偏提示要**具体**：本关要的是正面
    expect(offTrackKeyFor(level, { kind: 'play', faceUp: false })).toBe('tutorial.off.face-down');
  });

  it('走偏 ②：正面牌打到不匹配的线 ⇒ 引擎自己拒（状态不变）', () => {
    const s = buildLevelState('T1');
    const before = JSON.stringify(s.players[0].stacks);
    // spirit-1 属于 spirit（线 0）；线 1 挂的是 water ⇒ 正面打出会被引擎**抛错**拒掉。
    // ⚠️ 是抛错而不是回 `ok:false` —— 屏里的 `cb.onAction` 用 try/catch 接住并给
    // `tutorial.off.rejected`，这一条就是那段 catch 的依据（去掉它 ⇒ 真机上会冒泡成未捕获异常）。
    expect(() => drive(s, 'play', { cardUid: 't1h1', faceUp: true, line: 1 }), '引擎没有拒').toThrow();
    expect(JSON.stringify(s.players[0].stacks), '被拒的动作改了局面').toBe(before);
    expect(isLevelComplete(levelById('T1'), s), '被拒的动作竟然算过关').toBe(false);
  });

  it('放行范围：T1 的白名单只有 play（编译不在里面）', () => {
    const level = levelById('T1');
    expect(level.allowKinds).toEqual(['play']);
    expect(offTrackKeyFor(level, { kind: 'compile' }), '编译没有被判为走偏')
      .toBe('tutorial.off.wrong-kind');
    expect(offTrackKeyFor(level, { kind: 'play', faceUp: true }), '正面的 play 被误判为走偏').toBe('tutorial.off.rejected');
  });
});

describe('T2：正面与反面各一张', () => {
  it('走对：先打正面再打反面 ⇒ 过（顺序反过来也过）', () => {
    const s = buildLevelState('T2');
    const level = levelById('T2');
    expect(isLevelComplete(level, s), '开局就算过关').toBe(false);
    expect(drive(s, 'play', { cardUid: 't2h1', faceUp: true, line: 0 })).toBe(true);
    expect(isLevelComplete(level, s), '只打了一张（正面）就算过关').toBe(false);
    expect(drive(s, 'play', { cardUid: 't2h2', faceUp: false, line: 1 })).toBe(true);
    expect(isLevelComplete(level, s), '正反各一张之后没判过关').toBe(true);
  });

  it('走偏：两张都正面 ⇒ 不过', () => {
    const s = buildLevelState('T2');
    expect(drive(s, 'play', { cardUid: 't2h1', faceUp: true, line: 0 })).toBe(true);
    expect(drive(s, 'play', { cardUid: 't2h2', faceUp: true, line: 1 })).toBe(true);
    expect(isLevelComplete(levelById('T2'), s), '两张都正面也算过 T2').toBe(false);
  });
});

describe('T0：四个热点都点过才算过', () => {
  it('点 3 个 ⇒ 不过；点满 4 个 ⇒ 过', () => {
    const level = levelById('T0');
    const s = buildLevelState('T0');
    expect(isLevelComplete(level, s, { spotsDone: [] }), '一个都没点就算过').toBe(false);
    expect(isLevelComplete(level, s, { spotsDone: ['link', 'protocol', 'threshold'] }), '只点 3 个就算过').toBe(false);
    expect(isLevelComplete(level, s, { spotsDone: ['link', 'protocol', 'threshold', 'control'] }), '四个都点了没过').toBe(true);
  });

  it('四个热点的定义与方案 §5.2 的四个概念一一对应（且 white-list 是空的：T0 不放行动作）', () => {
    const level = levelById('T0');
    expect(level.spots).toEqual(['link', 'protocol', 'threshold', 'control']);
    expect(level.allowKinds, 'T0 竟然放行了引擎动作').toEqual([]);
  });
});

/**
 * T3：五个基础动作。
 *
 * ⚠️ 这一组是**探路结论的验证**：五个动作靠"打出真卡 → 引擎弹选择 → 应答"这条真链路完成，
 * 判据是 `observedOps` 对前后快照的**差分**（不看玩家点了什么按钮）。
 *
 * ⚠️ **引擎会在一次动作之后把回合交给对手**（实测：第二次 play 报 "card … not in hand"，
 * 因为 `turnPlayer` 已经变成 1）⇒ 本文件在每次动作后**把回合交还玩家 0**：
 * 那是教学屏 `handBackTurn()` 的同口径做法（教学是沙盒，不是回合制对局）。
 */
describe('T3：翻转 / 偏转 / 抽牌 / 弃牌 / 回手 各一次', () => {
  it('五个动作逐个做一遍 ⇒ 五个签名都出现，且中途每少一个都不算过', () => {
    const s = buildLevelState('T3');
    const level = levelById('T3');
    const seen: TutOp[] = [];
    /** 教学屏那一条沙盒规则的**同口径**（见 `tutorial-screen.ts` 的 `handBackTurn()`） */
    const handBack = (): void => {
      if (s.phase === 'turn' && s.turnPlayer !== 0) {
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
          expect(cand.length, `「${prompt.title}」没有候选 ⇒ 这个动作在 T3 的局面里做不出来`).toBeGreaterThan(0);
          /**
           * 选谁：按"真人照提示会点哪一张"来选，而不是随手取第一张。
           *
           *  - **弃牌**那一步的候选是手牌：真人会弃那张用不上的 0 分牌（`t3h-fodder`）。
           *    随手取 `cands[0]` 会把后面还要用的教学卡弃掉 ⇒ 这一关做不完
           *    （这个真实风险由屏上的「重开这一关」按钮兜住，见 `tutorial-screen.ts`）。
           *  - **翻转**那一步的候选里既有"刚打出的这张"也有场上原有的牌：真人按提示会翻
           *    **场上那张反面的牌**。若翻"刚打出的这张"，它这一瞬间是 hand→field，
           *    `observedOps` 看不到朝向变化（差分只在"两次都在场上"时比 `faceUp`）⇒ 停在 4/5。
           */
          const fodder = cand.find((c) => c.uid === 't3h-fodder');
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
    step('play', { cardUid: 't3h-flip', faceUp: true, line: 0 });     // 翻转
    step('play', { cardUid: 't3h-shift', faceUp: true, line: 2 });    // 偏转（darkness-4 → 线 2）
    step('play', { cardUid: 't3h-draw', faceUp: true, line: 0 });     // 抽牌
    step('play', { cardUid: 't3h-discard', faceUp: true, line: 0 });  // 弃牌
    step('play', { cardUid: 't3h-return', faceUp: true, line: 1 });   // 回手（water-4 → 线 1）
    expect(seen, '五个签名没齐').toEqual(['flip', 'shift', 'draw', 'discard', 'return']);
    expect(isLevelComplete(level, s, { opsSeen: seen }), '五个都做了却没判过关').toBe(true);
  });

  it('放行范围：T3 放行 play 与 effect-choice，但**不放行** compile', () => {
    const level = levelById('T3');
    expect(level.allowKinds).toEqual(['play', 'effect-choice']);
    expect(offTrackKeyFor(level, { kind: 'compile' })).toBe('tutorial.off.wrong-kind');
  });
});

describe('关卡数据本身（顺序 / 序号 / 钳位）', () => {
  it('四关的 id 与顺序就是 T0~T3（进度按这个顺序推）', () => {
    expect(TUT_LEVELS.map((l) => l.id)).toEqual(['T0', 'T1', 'T2', 'T3']);
    expect(levelIndex('T3')).toBe(3);
    expect(levelAt(1)).toBe('T1');
  });

  it('序号越界钳到两端（通关之后再进教学停在最后一关，不是崩）', () => {
    expect(levelAt(-5)).toBe('T0');
    expect(levelAt(99)).toBe('T3');
  });

  it('每关都有标题 / 目标 / 至少一句讲解，且四关文案**互不相同**（不是复制粘贴同一句）', () => {
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
    expect(titles.size, '四关的标题有重复').toBe(TUT_LEVELS.length);
    expect(goals.size, '四关的目标有重复').toBe(TUT_LEVELS.length);
  });
});

describe('进度存取（住在既有 L1_SETTINGS 里，零新增键）', () => {
  function store() {
    return createLocalStore({ persistent: createMemoryStore() });
  }

  it('没玩过 ⇒ T0 + 空 done；过一关 ⇒ 记进 done 且当前关推到下一关', () => {
    const s = store();
    s.grant();
    expect(readProgress(s)).toEqual({ done: [], current: 'T0', allDone: false });
    writeTutorialProgress(s, advance(s, 'T0'));
    expect(readProgress(s), '过完 T0 之后没有推到 T1').toEqual({ done: ['T0'], current: 'T1', allDone: false });
    writeTutorialProgress(s, advance(s, 'T1'));
    expect(readProgress(s)).toEqual({ done: ['T0', 'T1'], current: 'T2', allDone: false });
  });

  it('最后一关过完停在最后一关（不会被钳到别处）', () => {
    const s = store();
    s.grant();
    writeTutorialProgress(s, advance(s, 'T3'));
    expect(readProgress(s).current, '过完 T3 之后当前关不是 T3').toBe('T3');
    expect(readProgress(s).done).toEqual(['T3']);
  });

  it('「从头开始」清空 done 与当前关（**不动**昵称/语言那些设置）', () => {
    const s = store();
    s.grant();
    writeTutorialProgress(s, advance(s, 'T0'));
    s.kv().set('compile-settings', JSON.stringify({ nick: '甲', lang: 'en', tutorial: { done: ['T0'], current: 'T1' } }));
    restart(s);
    const raw = JSON.parse(String(s.kv().get('compile-settings'))) as Record<string, unknown>;
    expect(raw.tutorial).toEqual({ done: [], current: 'T0' });
    expect(raw.nick, '「从头开始」把昵称也清了').toBe('甲');
    expect(raw.lang, '「从头开始」把语言也清了').toBe('en');
  });

  it('坏值 / 坏 JSON ⇒ 退回"没玩过"（不抛、不把进度卡在非法状态）', () => {
    const s = store();
    s.grant();
    s.kv().set('compile-settings', JSON.stringify({ tutorial: { done: ['T9', 42, 'T0'], current: 'TX' } }));
    expect(readTutorialProgress(s), '非法值没有被过滤').toEqual({ done: ['T0'], current: 'T0' });
    s.kv().set('compile-settings', '{"tutorial":');
    expect(readTutorialProgress(s), '坏 JSON 时应当退回"没玩过"').toEqual({ done: [], current: 'T0' });
    s.kv().set('compile-settings', JSON.stringify({ tutorial: 'nope' }));
    expect(readTutorialProgress(s), '不是对象时应当退回"没玩过"').toEqual({ done: [], current: 'T0' });
  });

  it('游客模式：进度只进内存（盘上零写入）—— 与语言/向导标记同一条口径', () => {
    const s = store();
    s.deny();
    writeTutorialProgress(s, { done: ['T0'], current: 'T1' });
    expect(readProgress(s).done, '游客模式下内存里的进度都不对').toEqual(['T0']);
    expect(s.isPersistent(), '游客模式竟然在写盘').toBe(false);
  });
});
