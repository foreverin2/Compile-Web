import { describe, it, expect } from 'vitest';
import type { Card, ChoiceCard, GameState, Line, PlayerId } from '../../src/core/models/types';
import { createGame } from '../../src/core/state/create';
import { answerEffect, resolveMiddle, runStack } from '../../src/core/effects/resolve';
import { collectTriggers, resolveTrigger, fireReactive } from '../../src/core/effects/triggers';
import { getCardDef } from '../../src/data/demo';
import { makeCard } from '../helpers';

/**
 * 新星3 / 新星4 的候选筛选（用户 2026-09-23 裁决）。
 *
 * 裁决原文：「筛选点数中没有必须正面朝上的这个条件，两张都能选反面卡，只是遵守规则-不能选择被覆盖的卡罢了，修复。」
 * 口径：按阈值筛候选时**没有**「必须正面朝上」条件 —— 反面朝上的**未被覆盖**顶卡同样是候选；
 * 唯一的覆盖约束是「不能选被覆盖的卡」（`listCandidates` 不给 `covered:true` 时就只列顶卡）。
 *
 * 读数直接取 `pendingEffects[].prompt.candidates` 的 uid 集合（引擎真产出，不构造假 prompt），
 * 对 nova-3 / nova-4 各跑一遍。局面构造沿用 `tests/effects/gen3-batch3-cards.test.ts:14` 的 setup / placeSrc。
 *
 * 四条局面/引擎纪律（踩过的坑，别改回去）：
 * 1) 阈值 count = **源卡所在链路**（己方）牌数（`nova.ts:173` / `:192`），候选条件 = 印刷值 < count。
 *    源卡必须**未被覆盖**否则 `sourceValid` 立刻终止效果（`resolve.ts:216`「效果终止：…被覆盖」）⇒
 *    源卡只能是其链路顶卡；阈值又要 ≥ 2（否则腿 2/3 的"< 阈值"和"≥ 阈值"两侧落不到纸上），
 *    所以先往源卡所在链路垫 1 张反面卡（反面卡不触发中指令）、源卡压其上 ⇒ 该链路恒 2 张、阈值恒 2。
 * 2) 正面陪衬卡一律用**无中指令文本**的卡（`fire-3`：卡面只有底命令，底命令要 end 步骤才收集），
 *    否则陪衬卡的 `pushMiddle` 会抢先挂起。反面陪衬卡天然不触发。
 * 3) 候选被筛空时引擎按 fizzle 规则**不挂起请求**（`resolve.ts:241` 无合法目标 → 记日志、空答案续跑），
 *    所以"某卡不在候选"的负向腿**不能**用 `promptOf`（拿不到 prompt），要读候选为空 + 日志「无合法目标」。
 * 4) nova-3 的中指令是**偏转**、nova-4 是**翻转**：腿 1 的"应答后真的动了"必须按各自语义断言
 *    （nova-3 记 `line` 变了、朝向不变；nova-4 记 `faceUp` 翻正）。
 *
 * 新建本文件（而不是塞进 gen3-batch3-cards.test.ts）的理由：那条 431 行的文件按协议分组、
 * 正被其它任务读写；本文件是 nova-3/4 阈值候选的专项腿，独立成文件避免并发改动冲突。
 */

const SOURCES = [
  { defId: 'nova-3', verb: '偏转' },
  { defId: 'nova-4', verb: '翻转' },
] as const;

/** 局面：双方 3 条协议已定（己方 0/1/2 = fire/light/darkness）、进入回合阶段（同 gen3-batch3-cards.test.ts:14） */
function setup(): GameState {
  const s = createGame();
  for (const pid of [0, 1] as PlayerId[]) {
    s.players[pid].protocols = [
      { defId: 'fire', compiled: false },
      { defId: 'light', compiled: false },
      { defId: 'darkness', compiled: false },
    ];
  }
  s.phase = 'turn';
  return s;
}

function placeCard(s: GameState, defId: string, owner: PlayerId, line: Line, faceUp: boolean): Card {
  const c = makeCard(defId, owner, 'field', faceUp, line, s.players[owner].stacks[line].length);
  s.players[owner].stacks[line].push(c);
  return c;
}

function printedValue(defId: string): number {
  return getCardDef(defId).value;
}

/** 候选缩样（失败信息用：uid:defId:朝向:属主线），uid 集合是断言本体 */
function brief(cs: ChoiceCard[]): string {
  return (
    cs.map((c) => `${c.uid}:${c.defId}:${c.faceUp ? '正' : '反'}:P${c.owner + 1}线${(c.line ?? 0) + 1}`).join(', ') ||
    '(空)'
  );
}

/** 三条链路牌数（原始读数用；索引 = 链路号） */
function lens(s: GameState, owner: PlayerId): number[] {
  return s.players[owner].stacks.map((st) => st.length);
}

/** 被测源卡挂起的选择请求（按 sourceUid 对齐，不取栈顶） */
function promptOf(s: GameState, sourceUid: string) {
  const pe = s.pendingEffects.find((e) => e.sourceUid === sourceUid && e.prompt);
  expect(pe?.prompt, `未挂起来自源卡 ${sourceUid} 的选择请求（候选被筛空会 fizzle 不挂起）`).toBeTruthy();
  return pe!;
}

/** 被测源卡的候选集合。空候选有两种走法（都不是"效果被覆盖终止"，那种会留下"效果终止"日志）：
 *  ① 过滤后为空 → 生成器提前 `return`，不给请求、也不留 fizzle 日志；
 *  ② 过滤后非空但 `step` 挂起前被判定无合法目标 → `resolve.ts:241` fizzle（留"无合法目标"日志）。
 *  两者观测结果都是"没有候选"，本 helper 统一按空集返回，并钉住"不是被覆盖终止"。 */
function candidatesOf(s: GameState, sourceUid: string): { uids: string[]; briefText: string; fizzled: boolean } {
  const pe = s.pendingEffects.find((e) => e.sourceUid === sourceUid && e.prompt);
  if (!pe) {
    expect(s.log.some((l) => l.includes('效果终止')), '源卡被覆盖/翻面/移除而终止（局面搭错了）').toBe(false);
    const fizzled = s.log.some((l) => l.includes('无合法目标'));
    return { uids: [], briefText: fizzled ? '(空：fizzle 未挂起)' : '(空：过滤后为空，提前返回)', fizzled };
  }
  const cands = pe.prompt!.candidates;
  return { uids: cands.map((c) => c.uid), briefText: brief(cands), fizzled: false };
}

describe('nova-3 / nova-4 阈值候选（用户 2026-09-23 裁决）', () => {
  for (const src of SOURCES) {
    // 腿 1：反面朝上的**未被覆盖**顶卡可以进候选 —— nova-4 给"翻转"、nova-3 给"偏转"，两边都要真的落地
    it(`${src.defId}：反面顶卡可作候选，应答后真的被${src.verb}`, () => {
      const s = setup();
      placeCard(s, 'fire-1', 0, 1, false); // 源卡所在链路先垫 1 张反面
      const source = placeCard(s, src.defId, 0, 1, true); // 源卡压其上（未被覆盖）
      const faceDownTop = placeCard(s, 'nova-0', 0, 0, false); // 线 0 的**反面顶卡**（印刷值 0）
      const count = s.players[0].stacks[1].length;
      expect(count, `局面前提：源卡所在链路牌数（= 阈值）lens=${JSON.stringify(lens(s, 0))}`).toBe(2);
      expect(faceDownTop.faceUp, '局面前提：该线顶卡是反面').toBe(false);
      expect(printedValue(faceDownTop.defId), '局面前提：该反顶卡印刷值小于阈值').toBeLessThan(count);

      resolveMiddle(s, 0, source);
      const pe = promptOf(s, source.uid);
      expect(pe.sourceDefId).toBe(src.defId);
      const cands = pe.prompt!.candidates;
      const reading = `[原始读数 ${src.defId} 阈值=${count} lens=${JSON.stringify(lens(s, 0))} 候选=${brief(cands)}]`;
      expect(cands.map((c) => c.uid), reading).toContain(faceDownTop.uid);
      expect(cands.find((c) => c.uid === faceDownTop.uid)?.faceUp, `候选里该卡朝向应为反面 ${reading}`).toBe(false);

      const lineBefore = faceDownTop.line;
      if (src.defId === 'nova-4') {
        // 翻转：一次应答即落地
        answerEffect(s, pe.id, [faceDownTop.uid]);
        expect(faceDownTop.faceUp, `应答后该反顶卡未被翻正 ${reading}`).toBe(true);
      } else {
        // 偏转：先选卡、再选目标线
        answerEffect(s, pe.id, [faceDownTop.uid]);
        const lPe = promptOf(s, source.uid);
        expect(lPe.prompt!.kind).toBe('select-line');
        answerEffect(s, lPe.id, ['line:2']);
        expect(faceDownTop.line, `应答后该反顶卡未被偏转到线 2 ${reading}`).toBe(2);
        expect(faceDownTop.line, '局面前提：偏转确实换了链路').not.toBe(lineBefore);
        expect(faceDownTop.faceUp, '偏转不改变朝向（该卡仍反面）').toBe(false);
      }
    });

    // 腿 2：被覆盖的卡（正面/反面各一次）都不在候选（无 covered:true 时只列顶卡）
    it(`${src.defId}：被覆盖的卡不在候选（正面/反面各一次）`, () => {
      const s = setup();
      placeCard(s, 'fire-1', 0, 1, false); // 阈值 2
      const source = placeCard(s, src.defId, 0, 1, true);
      const buriedFaceUp = placeCard(s, 'nova-0', 0, 0, true); // 正面被覆盖（印刷值 0 < 2 ⇒ 未被盖就合格）
      const coverOwn = placeCard(s, 'fire-1', 0, 0, false); // 盖住它的**反面**顶卡（印刷值 1 < 2 ⇒ 本身合格）
      const buriedFaceDown = placeCard(s, 'nova-0', 1, 2, false); // 反面被覆盖（印刷值 0 < 2）
      const coverFoe = placeCard(s, 'fire-1', 1, 2, false); // 盖住它的**反面**顶卡（印刷值 1 < 2）
      const count = s.players[0].stacks[1].length;
      expect(count, `局面前提：源卡所在链路牌数（= 阈值）lens=${JSON.stringify(lens(s, 0))}`).toBe(2);
      expect([buriedFaceUp.faceUp, buriedFaceDown.faceUp], '局面前提：两张被覆盖卡的朝向').toEqual([true, false]);
      expect(s.players[0].stacks[0].indexOf(buriedFaceUp), '局面前提：正面卡确实被覆盖').toBe(0);
      expect(s.players[1].stacks[2].indexOf(buriedFaceDown), '局面前提：反面卡确实被覆盖').toBe(0);
      for (const c of [buriedFaceUp, buriedFaceDown, coverOwn, coverFoe]) {
        expect(printedValue(c.defId), '局面前提：这四张印刷值都小于阈值（否则阈值会把腿筛空）').toBeLessThan(count);
      }

      resolveMiddle(s, 0, source);
      const got = candidatesOf(s, source.uid);
      const reading = `[原始读数 ${src.defId} 阈值=${count} lens=${JSON.stringify(lens(s, 0))} 候选=${got.briefText}]`;
      expect(got.uids, `被覆盖的正面卡不应进候选 ${reading}`).not.toContain(buriedFaceUp.uid);
      expect(got.uids, `被覆盖的反面卡不应进候选 ${reading}`).not.toContain(buriedFaceDown.uid);
      // 两张覆盖它们的顶卡（未被覆盖、印刷值合格）才是本局面的真候选；上一版实现还会把两个被盖卡一并列出
      expect(got.uids, reading).toContain(coverOwn.uid);
      expect(got.uids, reading).toContain(coverFoe.uid);
      expect(got.uids.length, `${reading} 候选必须恰为两张顶卡（被覆盖的两张不在内）`).toBe(2);
    });

    // 腿 3：阈值条件仍生效 —— 印刷值 ≥ 该链路牌数的正面/反面顶卡不在候选，
    // 且局面上**同时**有合格的正面/反面顶卡 ⇒ 候选集合必须**恰好**是那两张
    // （不能用"候选数为 0"收口：那分不清"阈值把它们筛掉了"与"过滤后为空、生成器提前 return"）
    it(`${src.defId}：印刷值不小于阈值的正面/反面顶卡不在候选，合格的恰好是那两张`, () => {
      const s = setup();
      placeCard(s, 'fire-1', 0, 1, false); // 垫卡 ①（在源卡**下方**）
      const padLow = placeCard(s, 'fire-1', 0, 1, false); // 垫卡 ②（在源卡**下方**）
      const source = placeCard(s, src.defId, 0, 1, true); // 源卡最后放 ⇒ 该链路顶卡（未被覆盖）
      // 线 0：**合格**的反面 nova-0（0 < 3）当顶卡；它下面压一张**不合格**的正面 fire-3（3 ≥ 3，被覆盖）
      const faceUpTooBig = placeCard(s, 'fire-3', 0, 0, true); // 先放（被覆盖；卡面无中指令）
      const faceDownOk = placeCard(s, 'nova-0', 0, 0, false); // 后放 ⇒ 顶卡
      // 线 2：**合格**的正面 nova-0（0 < 3）当顶卡；它下面压一张**不合格**的反面 fire-3（3 ≥ 3，被覆盖）
      const faceDownTooBig = placeCard(s, 'fire-3', 1, 2, false); // 先放（被覆盖）
      const faceUpOk = placeCard(s, 'nova-0', 1, 2, true); // 后放 ⇒ 顶卡
      const count = s.players[0].stacks[1].length;
      expect(count, `局面前提：源卡所在链路牌数（= 阈值）lens=${JSON.stringify(lens(s, 0))}`).toBe(3);
      for (const c of [faceUpTooBig, faceDownTooBig]) {
        expect(printedValue(c.defId), '局面前提：两张不合格卡印刷值 ≥ 阈值').toBeGreaterThanOrEqual(count);
      }
      expect([faceUpTooBig.faceUp, faceDownTooBig.faceUp], '局面前提：两张不合格卡朝向').toEqual([true, false]);
      for (const c of [faceDownOk, faceUpOk]) {
        expect(printedValue(c.defId), '局面前提：两张合格卡印刷值 < 阈值').toBeLessThan(count);
      }
      expect([faceDownOk.faceUp, faceUpOk.faceUp], '局面前提：两张合格卡朝向').toEqual([false, true]);
      // 两张合格卡是各自链路的顶卡；两张不合格卡被压在下面（只有顶卡能进候选）
      const own0 = s.players[0].stacks[0];
      const foe2 = s.players[1].stacks[2];
      expect(own0[own0.length - 1].uid, '局面前提：线 0 顶卡是合格的反面卡').toBe(faceDownOk.uid);
      expect(own0.indexOf(faceUpTooBig), '局面前提：不合格正面卡被覆盖').toBeLessThan(own0.length - 1);
      expect(foe2[foe2.length - 1].uid, '局面前提：线 2 顶卡是合格的正面卡').toBe(faceUpOk.uid);
      expect(foe2.indexOf(faceDownTooBig), '局面前提：不合格反面卡被覆盖').toBeLessThan(foe2.length - 1);
      void padLow; // 只用于把该链路抬到 3 张（阈值 3），本身不参与断言

      resolveMiddle(s, 0, source);
      const got = candidatesOf(s, source.uid);
      const reading = `[原始读数 ${src.defId} 阈值=${count} lens=${JSON.stringify(lens(s, 0))} 候选=${got.briefText}]`;
      expect(got.uids, `印刷值不小于阈值的正面顶卡不应进候选 ${reading}`).not.toContain(faceUpTooBig.uid);
      expect(got.uids, `印刷值不小于阈值的反面顶卡不应进候选 ${reading}`).not.toContain(faceDownTooBig.uid);
      expect([...got.uids].sort(), `${reading} 候选必须恰好等于两张合格顶卡（阈值不合格的与被覆盖的都不在内）`).toEqual(
        [faceDownOk.uid, faceUpOk.uid].sort(),
      );
    });
  }
});

/**
 * 新星2 底 / 新星0 底 的候选范围（用户 2026-10-01 拍板 + 卡文）。
 *
 * 卡文（`E:\studyE\compile\正版compile\compile3文本.txt`，权威文本）：
 *  - 108 行 新星2：「…/当你重排协议后：你可以偏转1张反面朝下的牌。」——「1张反面朝下的牌」没有「你的」；
 *  - 106 行 新星0：「结束：在一张未被覆盖的新星牌下方，从你的牌库顶端反面打出一张牌。」——「未被覆盖的
 *    新星牌」没有「你的」（同句后半「**你的**牌库」有，用词刻意不同）。
 * 规则文本（`游戏规则说明书\规则文本.txt`）93 行：「除非文本特殊说明，效果可以选择场上任意一侧未被覆盖
 * 的卡牌作为目标。」⇒ 两张卡的候选都放开到**双方**。
 *
 * 这两条腿都是**正向**断言：改前 nova-2 底写死 `owner: ctx.player`、nova-0 底的 cond 只查 `card.owner`
 * 一侧，对手那一侧的卡既进不了候选、也过不了触发预检 —— 下面每条断言在改前都会失败。
 */

describe('nova-2 底（after-self-rearrange）：候选放开双方（2026-10-01 用户拍板 + 卡文 108 行）', () => {
  it('双方的反面顶卡都进候选、正面顶卡不进；选对手那张后按【它所在线】排除目标线，偏转不改归属/朝向', () => {
    const s = setup();
    const ownDown = placeCard(s, 'fire-1', 0, 0, false); // 己方线 0 反面顶卡（候选）
    placeCard(s, 'fire-3', 0, 1, true); // 己方线 1 正面顶卡（不进候选）
    const foeDown = placeCard(s, 'fire-1', 1, 1, false); // 对手线 1 反面顶卡（候选；改前选不到）
    placeCard(s, 'fire-3', 1, 2, true); // 对手线 2 正面顶卡（不进候选）
    const src = placeCard(s, 'nova-2', 0, 2, true); // 源卡：底命令，未覆盖顶卡

    fireReactive(s, 'after-self-rearrange', 0); // 「当你重排协议后」由 P1 引发
    runStack(s);
    const pe = promptOf(s, src.uid);
    expect(pe.prompt!.kind).toBe('select');
    expect(pe.prompt!.optional, '「你可以偏转」= 可选').toBe(true);
    const uids = pe.prompt!.candidates.map((c) => c.uid);
    const reading = `[原始读数 候选=${brief(pe.prompt!.candidates)}]`;
    expect(uids, `对手那一侧的反面顶卡现在也能选 ${reading}`).toContain(foeDown.uid);
    expect(uids, `己方那一侧的反面顶卡仍在候选 ${reading}`).toContain(ownDown.uid);
    expect([...uids].sort(), `${reading} 候选必须恰好是两张反面顶卡（正面顶卡被 !faceUp 过滤掉）`).toEqual(
      [ownDown.uid, foeDown.uid].sort(),
    );
    for (const c of pe.prompt!.candidates) expect(c.faceUp, `${reading} 候选里不该有正面卡`).toBe(false);

    answerEffect(s, pe.id, [foeDown.uid]); // 选对手那一张
    const lPe = promptOf(s, src.uid);
    expect(lPe.prompt!.kind).toBe('select-line');
    // 源卡在 P1 自己的线 2；被选卡在对手的线 1 ⇒ 「另一列」排除必须按【线 1】走（改前只在自己堆叠找、
    // 找不到就回退成源卡所在线 2，这里会错成 [0, 1]）
    expect(lPe.prompt!.lines, '目标线排除的是被选卡所在线 1（不是源卡所在线 2）').toEqual([0, 2]);
    answerEffect(s, lPe.id, ['line:0']);
    expect(s.players[1].stacks[0].map((c) => c.uid), '对手的反面卡偏转进对手线 0').toEqual([foeDown.uid]);
    expect(s.players[1].stacks[1], '原线 1 已空').toHaveLength(0);
    expect(foeDown.owner, '偏转不改归属').toBe(1);
    expect(foeDown.faceUp, '偏转不改朝向（仍反面）').toBe(false);
    expect(s.pendingEffects).toHaveLength(0);
  });
});

describe('nova-0 底（end）：候选放开双方（2026-10-01 用户拍板 + 卡文 106 行）', () => {
  it('只有对手那一侧有未覆盖正面新星牌时触发预检也成立、那张卡进候选，牌仍从【你的】牌库顶端出', () => {
    const s = setup();
    s.turnPlayer = 0;
    s.step = 'end';
    const src = placeCard(s, 'nova-0', 0, 0, true); // 底命令源卡（未覆盖顶卡）
    const foe = placeCard(s, 'nova-1', 1, 2, true); // 对手那一侧的未覆盖正面新星牌
    s.players[0].deck = [makeCard('fire-1', 0, 'deck', false)];

    const t = collectTriggers(s, 'end').find((x) => x.cardUid === src.uid);
    expect(
      t,
      '卡文没有「你的」⇒ 对手那一侧有新星牌也要弹按钮（改前 cond 只查 card.owner 一侧 → 这里收集不到）',
    ).toBeTruthy();
    resolveTrigger(s, t!);
    runStack(s);
    const pe = promptOf(s, src.uid);
    const cands = pe.prompt!.candidates;
    const uids = cands.map((c) => c.uid);
    const reading = `[原始读数 候选=${brief(cands)}]`;
    expect(uids, `对手那一侧的未覆盖正面新星牌在候选 ${reading}`).toContain(foe.uid);
    expect(uids, `源卡自己（nova-0 也是新星牌）在候选 ${reading}`).toContain(src.uid);
    expect(cands.find((c) => c.uid === foe.uid)?.owner, `${reading} 对手那张的 owner 应为 P2`).toBe(1);

    // 应答对手那一张：牌从【你的】牌库顶端出（「从你的牌库顶端」这句有「你的」，不跟着放开）
    answerEffect(s, pe.id, [foe.uid]);
    expect(s.players[0].deck, '牌库顶被消耗').toHaveLength(0);
    const played = ([0, 1, 2] as Line[])
      .flatMap((l) => s.players[0].stacks[l])
      .find((c) => c.uid !== src.uid);
    expect(played, '打出的那张落在打牌者自己场地侧（引擎 belowUid 只在自己堆叠找落点）').toBeTruthy();
    expect(played!.faceUp, '「反面打出」').toBe(false);
    expect(played!.owner, '牌库来源的卡归属不变').toBe(0);
    expect(s.players[1].stacks[2].map((c) => c.uid), '对手那张新星牌不受影响，仍在原处未被覆盖').toEqual([foe.uid]);
    expect(s.pendingEffects).toHaveLength(0);
  });
});
