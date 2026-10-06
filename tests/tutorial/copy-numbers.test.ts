import { describe, it, expect } from 'vitest';
import { buildLevelState } from '../../src/tutorial/setup';
import { createLocalDriver } from '../../src/app/match-driver';
import { getLineValue } from '../../src/core/state/create';
import { getCardDef } from '../../src/data/demo';
import { ZH, EN } from '../../src/i18n';
import type { GameState } from '../../src/core/models/types';

/**
 * **教学文案里的"分值"必须是实测读数**（2026-10-06 用户裁决「改文案」）。
 *
 * ## 为什么要有这一组
 *
 * T3/T5 里原先各有一句**与引擎口径相反**的话：
 *  - `T3.teach.1`「反面打出：…点数不算」/ `T3.observe`「反面那张…一分不加」；
 *  - `T5.observe`「对手线 1 的总值少了原来那张牌的点数」。
 *
 * 引擎的真实口径写在 `create.ts:292` 的 `stackValue` 注释里：「面朝下卡值=2」（设计稿 §1：
 * 「反面朝下 … 印刷值固定 2」），而且它对该叠里**每一张**求和 —— 被盖住的牌照旧算分。
 * 也就是说 T3 那两手打完之后线值是 **3 分**，T5 打完前后对手线 1 都是 **2 分**。
 *
 * ## 这条腿的形态（真跑 + 读数对文）
 *
 * 用与屏上同一套 `LocalDriver` 真把牌打出去（`tests/tutorial/levels.test.ts` 的 `drive` 同款），
 * 读 `getLineValue`，然后**要求两张表里的句子与这几个读数一致**：
 *  - 正确的数字必须在（"2 分" / "3 分"）；
 *  - 旧那句错的**不许回来**（"点数不算" / "一分不加" / "少了" / "drops by"）。
 *
 * ⚠️ 这是"文案 ↔ 引擎"的绑定腿，不是观感腿：它证明的是"句子里的数字与引擎实测一致"，
 * 证明不了"玩家读起来顺不顺"。
 */

/** 一次"提交并回答"的驱动（与屏里 `cb.onAction` 同一套调用面） */
function drive(state: GameState, kind: string, args: Record<string, unknown>): boolean {
  const driver = createLocalDriver();
  return driver.submit(state, { player: state.turnPlayer, kind, args } as never).ok;
}

describe('教学文案里的分值 = 引擎实测（正面按印刷值、反面固定 2 分）', () => {
  it('T3：正面精神1 = 1 分，反面流水1 = 2 分 ⇒ 线值 3 分；文案写着这三个数', () => {
    const s = buildLevelState('T3');
    expect(getLineValue(s, 0, 0), '夹具前提：T3 开局线 1 是空的').toBe(0);

    // 第一步：正面打出精神1（只能进它自己协议那条线 = 线 0）
    expect(drive(s, 'play', { cardUid: 't3h1', faceUp: true, line: 0 }), '正面精神1 打不出去').toBe(true);
    const afterFaceUp = getLineValue(s, 0, 0);
    expect(afterFaceUp, '正面精神1（印刷值 1）的价值变了 —— 卡面/引擎改过就回来复核这两句文案')
      .toBe(1);

    // 第二步：反面打出流水1（反面不看协议，落同一条线）
    expect(drive(s, 'play', { cardUid: 't3h2', faceUp: false, line: 0 }), '反面流水1 打不出去').toBe(true);
    const afterFaceDown = getLineValue(s, 0, 0);
    expect(afterFaceDown - afterFaceUp,
      '反面卡这一手加的分不是 2（`create.ts` 的 stackValue：「面朝下卡值=2」）—— 文案里的数字要跟着改'
    ).toBe(2);
    expect(afterFaceDown, 'T3 收官线值不是 3 分').toBe(3);

    // 文案与读数一致（两句各钉一半：teach 讲规则、observe 讲这一关会发生什么）
    expect(ZH['tutorial.T3.teach.1'], 'T3 讲解没写"按 2 分算"').toContain('2 分');
    expect(ZH['tutorial.T3.teach.1'], 'T3 讲解还写着"点数不算"（与引擎相反）').not.toMatch(/点数不算/);
    for (const n of ['1 分', '2 分', '3 分']) {
      expect(ZH['tutorial.T3.observe'], `T3 的观察点里没有"${n}"（文案与实测读数脱钩了）`).toContain(n);
    }
    expect(ZH['tutorial.T3.observe'], 'T3 的观察点还写着"一分不加"（与引擎相反）').not.toMatch(/一分不加/);

    expect(EN['tutorial.T3.teach.1'], '英文 T3 讲解没写 2 points').toMatch(/2 points/);
    expect(EN['tutorial.T3.teach.1'], '英文 T3 讲解还写着 value does not count').not.toMatch(/does not count/i);
    for (const n of ['1 point', '2 points', '3 points']) {
      expect(EN['tutorial.T3.observe'], `英文 T3 的观察点里没有"${n}"`).toContain(n);
    }
    expect(EN['tutorial.T3.observe'], '英文 T3 的观察点还写着 adds nothing').not.toMatch(/adds nothing/i);
  });

  it('T5：被盖住的反面精神1 仍算 2 分、腐化0 算 0 分 ⇒ 盖上去前后对手线 1 都是 2 分；文案说"没变"', () => {
    const s = buildLevelState('T5');
    const before = getLineValue(s, 1, 0);
    expect(before, '夹具前提：对手线 1 那张反面精神1 值 2 分').toBe(2);
    expect(getCardDef('corruption-0').value, '腐化0 的印刷值不是 0（文案那句"还是 2 分"要跟着改）').toBe(0);

    expect(drive(s, 'play', { cardUid: 't5h1', faceUp: true, line: 0, target: 1 }),
      '腐化0 打不到对方线 1（`target` 那条路断了？）').toBe(true);
    const after = getLineValue(s, 1, 0);
    expect(after, '盖上去之后对手线 1 的总值变了 —— 文案里那句"没变"就不再成立').toBe(before);

    expect(ZH['tutorial.T5.observe'], 'T5 的观察点没写"没变"').toContain('没变');
    expect(ZH['tutorial.T5.observe'], 'T5 的观察点依旧写着"少了…点数"（与引擎相反）').not.toMatch(/少[了掉]/);
    expect(ZH['tutorial.T5.observe'], 'T5 的观察点没写被盖住的牌照旧算 2 分').toContain('2 分');
    // steps.1 是"过关条件那句话"，不许再说对手那张牌不再算分
    expect(ZH['tutorial.T5.steps.1'], 'T5 第二步还写着"不再算分"').not.toMatch(/不再算分/);
    // teach.1 讲的是"被覆盖"这件事本身：按引擎口径它影响的是"选不中"，不是命令失效
    expect(ZH['tutorial.T5.teach.1'], 'T5 讲解还写着被覆盖的牌"命令都不再生效"（引擎：正面被覆盖的牌顶命令仍生效）')
      .not.toMatch(/都不再生效/);
    expect(ZH['tutorial.T5.teach.1'], 'T5 讲解没有写"默认选不中"这条目标规则').toContain('选不中');

    expect(EN['tutorial.T5.observe'], '英文 T5 的观察点没写 does not change').toMatch(/does not change/i);
    expect(EN['tutorial.T5.observe'], '英文 T5 的观察点依旧写着 drops by').not.toMatch(/drops by/i);
    expect(EN['tutorial.T5.steps.1'], '英文 T5 第二步还写着 stops scoring').not.toMatch(/stops scoring/i);
    expect(EN['tutorial.T5.teach.1'], '英文 T5 讲解还写着 commands stop working')
      .not.toMatch(/commands stop working/i);
  });
});
