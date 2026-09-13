import { describe, it, expect } from 'vitest';
import type { GameState, PlayerId } from '../../src/core/models/types';
import { stateFingerprint } from '../../src/core/fingerprint';
import {
  createGame,
  getDraftPool,
  performDraftPick,
  randomPoolFromSeed,
  DRAFT_BAN_TOTAL,
  DRAFT_PICK_COUNT,
} from '../../src/core/state/create';
import { deriveInt } from '../../src/core/rng';
import { ALL_PROTOCOLS_3 } from '../../src/data/cards3';
import { rng, setupGen3Game } from '../fuzz/lib';
import { applyStep, recordRandomSteps } from './lib';

/**
 * G0 收官的确定性覆盖（终结评审 I1 / I3）：**开局的三个种子派生输入**里，
 * 前两个（draftStarter、firstToPlay）与第三个（draftPool）此前都没有整局不变式覆盖 ——
 *
 * - D1~D4 全部经 `setupGen3Game`，而它把 `s.draftPool` 强制覆盖成 `ALL_PROTOCOLS_3`：
 *   随机池一旦对调用顺序/时机敏感，两端会造出不同的池、第一次 pick 就分叉，
 *   而四条不变式仍然全绿。→ D5 补上（本文件，**不走** setupGen3Game 的池覆盖）。
 * - D1~D3 用默认 `draftMode:'normal'` + `firstToPlay` 默认 0：ban 草稿的交错禁用
 *   （performDraftBan / draftNextAction）与"后选协议者先出牌"（firstToPlay = 1 - draftStarter）
 *   都不在台子上。→ D6 补上（走参数化后的 setupGen3Game）。
 *
 * 复用 `tests/determinism/lib.ts`（录制/回放）与 `tests/fuzz/lib.ts`（rng / 建局），不另起一套。
 */

/* ---------------- D5：随机协议池 ---------------- */

/** 随机池用例的种子（字符串形式，与 main.ts 传 newMatchSeed() 的用法一致） */
const POOL_SEED = 'pool-g0-final-1';
/** 草稿选择流种子（与引擎流分开） */
const POOL_PICK_SEED = 0x51ed2701;
const POOL_STEPS = 300;

/**
 * 建一局"随机池"开局：池由种子在**每次建局时**重新派生（不是把同一个数组对象传两次）——
 * 否则 randomPoolFromSeed 的调用顺序/时机敏感性不可观测，用例会空转。
 */
function buildRandomPoolGame(): GameState {
  const s = createGame({
    seed: POOL_SEED,
    draftStarter: 1,
    firstToPlay: 0,
    draftMode: 'normal',
    draftPool: randomPoolFromSeed(POOL_SEED, 12),
  });
  const r = rng(POOL_PICK_SEED);
  let guard = 0;
  while (s.phase === 'draft' && guard++ < 100) {
    const avail = getDraftPool(s);
    if (avail.length === 0) break;
    performDraftPick(s, avail[Math.floor(r() * avail.length)].defId);
  }
  return s;
}

/* ---------------- D6：ban 草稿 + 硬币→先手 ---------------- */

const BAN_SEED = 20260914;
/** draftStarter 由种子派生，与 `ui/home.ts` 的硬币同一条命名流（deriveInt(seed,'coin',2)）。
 *  **必须非零**：starter 恒为 0 时 `firstToPlay = 1 - draftStarter` 等于没被检验。 */
const BAN_STARTER = deriveInt(String(BAN_SEED), 'coin', 2) as PlayerId;
/** 用户拍板：后选协议者先出牌 */
const BAN_FIRST_TO_PLAY = (1 - BAN_STARTER) as PlayerId;
const BAN_STEPS = 200;

describe('开局输入确定性（G0 收官：随机池 / 禁用模式）', () => {
  it('D5 随机池开局：seed 派生的 draftPool 建局后同样可重放（同种子 → 同指纹）', () => {
    const s = buildRandomPoolGame();
    const steps = recordRandomSteps(s, rng(POOL_PICK_SEED ^ 0x5bf03635), POOL_STEPS);
    // 非空转守卫：本局走满上限（未提前分胜负），且真的走到过挂起效果应答
    // （否则 applyStep 的 answer 分支与 recordRandomSteps 的 prompt 分支都不可达）
    expect(steps.length).toBeGreaterThan(100);
    expect(steps.some((x) => x.t === 'answer')).toBe(true);
    const fp = stateFingerprint(s);

    const s2 = buildRandomPoolGame();
    for (const step of steps) applyStep(s2, step);
    // ← 核心断言（放在"路径证明"之前：若池派生变得对调用顺序敏感，先炸的必须是这一条）
    expect(stateFingerprint(s2)).toBe(fp);

    // 路径证明：真的走了随机池，且池就是种子派生结果、**不等于**固定池顺序 ——
    // 否则整条用例可能靠 setupGen3Game 式的池覆盖静默通过（D1~D4 的盲区正在这里）。
    const poolIds = s.draftPool.map((p) => p.defId);
    expect(poolIds).toHaveLength(12);
    expect(poolIds).toEqual(randomPoolFromSeed(POOL_SEED, 12).map((p) => p.defId));
    expect(poolIds).not.toEqual(ALL_PROTOCOLS_3.map((p) => p.defId).slice(0, 12));
  }, 300000);

  it('D6 禁用模式 + 硬币→先手耦合：ban 草稿（含交错禁用）建局后可重放', () => {
    // 换种子会让这条断言先失败，而不是让用例静默退化成 starter=0 的旧路径
    expect(BAN_STARTER).toBe(1);
    const opts = {
      draftMode: 'ban' as const,
      draftStarter: BAN_STARTER,
      firstToPlay: BAN_FIRST_TO_PLAY,
    };
    const s = setupGen3Game(BAN_SEED, opts);
    // 交错禁用真的走全了：6 pick + 6 ban，且被禁协议不会出现在已选列表里
    expect(s.draftStarter).toBe(BAN_STARTER); // draftStarter 没被忽略（否则整条用例退化成默认座位）
    expect(s.draftPicks).toHaveLength(DRAFT_PICK_COUNT);
    expect(s.bannedProtocols).toHaveLength(DRAFT_BAN_TOTAL);
    expect(s.draftPicks.some((p) => s.bannedProtocols.includes(p.defId))).toBe(false);
    // 硬币→先手耦合：后选协议者先出牌，且调用方给的 firstToPlay 没被随机先手覆盖
    expect(s.turnPlayer).toBe(BAN_FIRST_TO_PLAY);
    expect(s.turnPlayer).not.toBe(BAN_STARTER);

    const steps = recordRandomSteps(s, rng((BAN_SEED ^ 0x5bf03635) >>> 0), BAN_STEPS);
    expect(steps.length).toBeGreaterThan(50); // 非空转守卫（同上）
    expect(steps.some((x) => x.t === 'answer')).toBe(true);
    const fp = stateFingerprint(s);

    const s2 = setupGen3Game(BAN_SEED, opts);
    for (const step of steps) applyStep(s2, step);
    expect(stateFingerprint(s2)).toBe(fp);

    // 反向补一刀：上面的 starter=1 ⇒ firstToPlay=0，与默认值重合，单靠它区分不了
    // "引擎真的采纳了 firstToPlay"与"引擎恒为 0"。把对照翻过来（starter=0 ⇒ firstToPlay=1）。
    const swapped = setupGen3Game(BAN_SEED, { ...opts, draftStarter: 0, firstToPlay: 1 });
    expect(swapped.turnPlayer).toBe(1);
    expect(swapped.draftStarter).toBe(0);
  }, 300000);
});
