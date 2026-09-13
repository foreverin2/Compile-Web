import { describe, it, expect, vi } from 'vitest';
import type { GameState, Line, PlayerId } from '../../src/core/models/types';
import { stateFingerprint } from '../../src/core/fingerprint';
import { rng, setupGen3Game } from '../fuzz/lib';
import { applyStep, recordRandomSteps, type Step } from './lib';

const SEED = 20260913;
/**
 * ⚠️ 400 而非 80（Task 7 评审 Finding 1）：80 步录到的基准局
 * `{advance:68,play:10,compile:1,refresh:1,answer:0}`、effectIdsMinted=0、80 步全是安全点 ——
 * 于是 `applyStep` 的 answer 分支与 `recordRandomSteps` 的 prompt 分支都不可达，
 * D2 的安全点守卫永不触发，整个台子对"对局中的状态"没有观测力。
 */
const STEPS = 400;
/** 选择流种子：与引擎流分开（引擎流现由状态种子决定） */
const PICK_SEED = SEED ^ 0x5bf03635;

/**
 * 基准：录制步骤 + 基准指纹。
 *
 * ⚠️ `warmup` 不是可有可无的：本模块实例上的**第一条**局面是在所有模块级可变状态
 * 都还处于初值（通常为 0）时算出来的，而 D3 的"全新 import"实例同样从初值起步 ——
 * 两者天然相等，D3 就会对 `let uidCounter = 0` 这类模块级全局**空转**。
 * 先热身一局让全局累积起来，基准局面就落在"非初值"上，D3 才能真正比对出差异。
 */
function baseline(warmup = false): { steps: Step[]; fp: string } {
  if (warmup) setupGen3Game(SEED);
  const s = setupGen3Game(SEED);
  const steps = recordRandomSteps(s, rng(PICK_SEED), STEPS);
  return { steps, fp: stateFingerprint(s) };
}

/**
 * D3 专用：用**全新模块实例**的引擎函数施加步骤。
 * 不能复用 ./lib 的 applyStep —— 它绑定的是旧模块实例。
 * 这份与 applyStep 的重复是**刻意保留**的（人已批准）：抽到公共文件就会重新绑定旧实例，
 * D3 也就抓不到模块级全局状态了。
 */
function applyWith(
  mods: {
    game: typeof import('../../src/core/game');
    resolve: typeof import('../../src/core/effects/resolve');
  },
  s: GameState,
  step: Step,
): void {
  if (step.t === 'answer') {
    mods.resolve.answerEffect(s, step.id, step.choice);
    mods.resolve.runStack(s);
    return;
  }
  switch (step.kind) {
    case 'play': {
      const a = step.args as { cardUid: string; faceUp: boolean; line: Line; target?: PlayerId };
      mods.game.executeAction(s, step.player, 'play', a);
      break;
    }
    case 'compile':
      mods.game.executeAction(s, step.player, 'compile', step.args as { line: Line });
      break;
    case 'resolve-trigger':
      mods.game.executeAction(s, step.player, 'resolve-trigger', step.args as { cardUid: string });
      break;
    case 'effect-choice':
      mods.game.executeAction(s, step.player, 'effect-choice', step.args as { promptId: string; choice: string[] });
      break;
    case 'rearrange-protocols':
      throw new Error('unexpected rearrange-protocols step');
    default:
      mods.game.executeAction(s, step.player, step.kind);
      break;
  }
}

describe('确定性测试台 D1~D3（G0）', () => {
  it('基线可录制且步数 > 0', () => {
    const { steps, fp } = baseline();
    expect(steps.length).toBeGreaterThan(0);
    expect(fp).toMatch(/^[0-9a-f]{16}$/);
    // 基准必须真的走到"应答"分支：否则 applyStep 的 answer 分支 / recordRandomSteps 的 prompt
    // 分支不可达，D1~D3 全都只覆盖开局区（评审 Finding 1 的病根）。
    expect(steps.some((s) => s.t === 'answer')).toBe(true);
  });

  it('D1 重放一致：同种子 + 同步骤 → 同指纹', () => {
    const { steps, fp } = baseline();
    const s = setupGen3Game(SEED);
    for (const step of steps) applyStep(s, step);
    expect(stateFingerprint(s)).toBe(fp);
  });

  it('D2 存盘恢复一致：安全点 JSON 往返后指纹不变', () => {
    const { steps, fp } = baseline();
    let s = setupGen3Game(SEED);
    let roundTrips = 0;
    for (const step of steps) {
      applyStep(s, step);
      // ⚠️ 只能在**安全点**往返：pendingEffects[].gen 是活的 Generator（types.ts:237，
      // 由 resolve.ts:223 的 pe.gen.next() 驱动），JSON.stringify 会把它变成 {}，
      // 恢复后下一次 .next() 直接抛 TypeError。
      // 「效果栈空且无落牌队列」= 状态完全由数据构成 = 可序列化。
      if (s.pendingEffects.length === 0 && s.pendingPlay.length === 0 && s.pendingShift.length === 0) {
        s = JSON.parse(JSON.stringify(s)) as typeof s;
        roundTrips += 1;
      }
    }
    // 兜底：确保这条断言不是空转（若一次安全点都没有，测试本身失效）
    expect(roundTrips).toBeGreaterThan(0);
    // 反向守卫：安全点必须**少于**总步数，否则"只在安全点往返"这条规则从未被检验过
    // （80 步基准局里 80 步全是安全点 = 守卫形同虚设）。
    expect(roundTrips).toBeLessThan(steps.length);
    expect(stateFingerprint(s)).toBe(fp);
  });

  it('D3 跨模块实例一致：全新 import 跑同步骤 → 同指纹', async () => {
    // warmup：见 baseline() 注释 —— 不做热身，D3 对模块级全局不敏感（会空转通过）
    const { steps, fp } = baseline(true);

    vi.resetModules();
    const create = await import('../../src/core/state/create');
    const game = await import('../../src/core/game');
    const resolve = await import('../../src/core/effects/resolve');
    const fpMod = await import('../../src/core/fingerprint');
    const data3 = await import('../../src/data/cards3');

    // 用全新模块实例重建同一开局（复制 setupGen3Game 的流程，但只走新实例）
    const s = create.createGame({ seed: String(SEED) });
    s.draftPool = [...data3.ALL_PROTOCOLS_3];
    const draftR = rng(SEED);
    let guard = 0;
    while (s.phase === 'draft' && guard++ < 100) {
      const avail = create.getDraftPool(s);
      if (avail.length === 0) break;
      create.performDraftPick(s, avail[Math.floor(draftR() * avail.length)].defId);
    }
    s.turnPlayer = draftR() < 0.5 ? 0 : 1;

    for (const step of steps) applyWith({ game, resolve }, s, step);
    expect(fpMod.stateFingerprint(s)).toBe(fp);
  });
});
