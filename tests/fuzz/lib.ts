import type { ChoiceRequest, GameState, Line, PlayerId } from '../../src/core/models/types';
import { createGame, getDraftPool, performDraftPick, getLineValue } from '../../src/core/state/create';
import { getLegalActions, executeAction, type LegalAction } from '../../src/core/game';
import { answerEffect, runStack } from '../../src/core/effects/resolve';
import { ALL_PROTOCOLS_3 } from '../../src/data/cards3';

/**
 * 3代随机对局压力测试公共库（tests/fuzz/gen3-random-games.test.ts 与临时排错脚本共用）：
 * 可复现随机数 + 随机合法行动/随机应答 + 状态不变量检查 + 单局驱动。
 * 强制协议池 = 3代 15 套，因此 90 张 3代卡都有机会入场。
 */

/** 可复现随机数（mulberry32） */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 随机应答一个选择请求（严格遵守 prompt 的 kind/min/max/候选/可线/可动作约束） */
export function randomAnswer(prompt: ChoiceRequest, r: () => number): string[] {
  const pickN = <T>(arr: T[], min: number, max: number): T[] => {
    if (arr.length === 0) return [];
    if (prompt.optional && r() < 0.25) return []; // 可选：25% 概率跳过
    const lo = Math.min(min, arr.length);
    const hi = Math.min(max === Infinity ? arr.length : max, arr.length);
    if (hi <= 0) return [];
    const n = lo + Math.floor(r() * Math.max(1, hi - lo + 1));
    const pool = [...arr];
    const out: T[] = [];
    // 注意：抽取数量必须**先算定**（splice 会缩短 pool，若把 pool.length 写进循环条件会少抽一项）
    const take = Math.min(n, pool.length);
    for (let i = 0; i < take; i++) {
      out.push(pool.splice(Math.floor(r() * pool.length), 1)[0]);
    }
    return out;
  };
  if (prompt.kind === 'select-line') {
    return pickN(prompt.lines ?? [], prompt.optional ? 0 : prompt.min, 1).map((l) => `line:${l}`);
  }
  if (prompt.kind === 'select-action') return pickN(prompt.actions ?? [], prompt.optional ? 0 : prompt.min, prompt.max);
  return pickN(prompt.candidates.map((c) => c.uid), prompt.optional ? 0 : prompt.min, prompt.max);
}

/** 状态不变量：每张卡恰好存在于一个区域；链路 pos 连续；zone/line 与容器一致；线值有限 */
export function checkInvariants(s: GameState, ctx: string): void {
  const seen = new Map<string, string>();
  const add = (uid: string, where: string): void => {
    const prev = seen.get(uid);
    if (prev !== undefined) throw new Error(`卡 ${uid} 同时存在于 ${prev} 与 ${where}（${ctx}）`);
    seen.set(uid, where);
  };
  for (const [i, p] of s.players.entries()) {
    for (const c of p.hand) {
      if (c.zone !== 'hand') throw new Error(`P${i + 1} 手牌中 ${c.defId} zone=${c.zone}（${ctx}）`);
      add(c.uid, `P${i + 1}手牌`);
    }
    for (const c of p.deck) {
      if (c.zone !== 'deck') throw new Error(`P${i + 1} 牌库中 ${c.defId} zone=${c.zone}（${ctx}）`);
      add(c.uid, `P${i + 1}牌库`);
    }
    for (const c of p.trash) {
      if (c.zone !== 'trash') throw new Error(`P${i + 1} 弃牌堆中 ${c.defId} zone=${c.zone}（${ctx}）`);
      add(c.uid, `P${i + 1}弃牌堆`);
    }
    for (const line of [0, 1, 2] as Line[]) {
      const stack = p.stacks[line];
      stack.forEach((c, idx) => {
        if (c.zone !== 'field') throw new Error(`P${i + 1}线${line + 1} ${c.defId} zone=${c.zone}（${ctx}）`);
        if (c.line !== line) throw new Error(`P${i + 1}线${line + 1} ${c.defId} line=${c.line}（${ctx}）`);
        if (c.pos !== idx) throw new Error(`P${i + 1}线${line + 1} ${c.defId} pos=${c.pos}≠${idx}（${ctx}）`);
        add(c.uid, `P${i + 1}线${line + 1}`);
      });
    }
    if (p.protocols.length !== 3) throw new Error(`P${i + 1} 协议数=${p.protocols.length}（${ctx}）`);
  }
  for (const item of [...s.pendingPlay, ...s.pendingShift]) add(item.card.uid, '浮空队列');
  for (const pid of [0, 1] as PlayerId[]) {
    for (const line of [0, 1, 2] as Line[]) {
      const v = getLineValue(s, pid, line);
      if (!Number.isFinite(v)) throw new Error(`P${pid + 1}线${line + 1} 线值 NaN/Inf（${ctx}）`);
    }
  }
}

/** 建局：强制协议池 = 3代 15 套 → 随机草稿 → 随机先手 */
export function setupGen3Game(seed: number): GameState {
  const r = rng(seed);
  const s = createGame();
  s.draftPool = [...ALL_PROTOCOLS_3];
  let guard = 0;
  while (s.phase === 'draft' && guard++ < 100) {
    const avail = getDraftPool(s);
    if (avail.length === 0) break;
    performDraftPick(s, avail[Math.floor(r() * avail.length)].defId);
  }
  s.turnPlayer = r() < 0.5 ? 0 : 1;
  return s;
}

/** 单局驱动：随机合法行动 / 随机应答，直至分出胜负或步数上限。
 *  注意：引擎内部（洗牌/随机揭示等）也用 Math.random，因此单局开始前**同时替换 Math.random**
 *  为同种子的可复现流——否则同一 seed 每次跑出的对局不同，失败无法复现。
 *  stats（可选）：收集本局所有进过场的 card defId，用于覆盖率断言。 */
export interface GameStats {
  played: Set<string>;
}

export function playRandomGame(seed: number, maxSteps: number, stats?: GameStats): { steps: number; finished: boolean } {
  const origRandom = Math.random;
  Math.random = rng(seed);
  try {
    return playRandomGameInner(seed, maxSteps, stats);
  } finally {
    Math.random = origRandom;
  }
}

/** 覆盖统计：记录当前场上所有卡的 defId（进过场即算被本局覆盖） */
function collectField(s: GameState, stats?: GameStats): void {
  if (!stats) return;
  for (const p of s.players) for (const stack of p.stacks) for (const c of stack) stats.played.add(c.defId);
}

function playRandomGameInner(seed: number, maxSteps: number, stats?: GameStats): { steps: number; finished: boolean } {
  const r = rng(seed ^ 0x9e3779b9); // 选择流与引擎流分开（都已固定种子 → 整体可复现）
  const s = setupGen3Game(seed);
  let steps = 0;
  while (s.winner === null && s.phase === 'turn' && steps < maxSteps) {
    steps += 1;
    collectField(s, stats);
    const top = s.pendingEffects[s.pendingEffects.length - 1];
    if (top?.prompt) {
      const ans = randomAnswer(top.prompt, r);
      answerEffect(s, top.id, ans);
      runStack(s);
      checkInvariants(s, `seed=${seed} step=${steps} 应答后`);
      continue;
    }
    const legal: LegalAction[] = getLegalActions(s, s.turnPlayer);
    if (legal.length === 0) {
      throw new Error(`seed=${seed} step=${steps} 无合法行动且无挂起（step=${s.step}）`);
    }
    const action = legal[Math.floor(r() * legal.length)];
    if (action.kind === 'effect-choice') continue;
    if (action.kind === 'play') {
      executeAction(s, s.turnPlayer, 'play', {
        cardUid: action.cardUid!,
        faceUp: action.faceUp!,
        line: action.line!,
        target: action.target,
      });
    } else if (action.kind === 'compile') {
      executeAction(s, s.turnPlayer, 'compile', { line: action.line! });
    } else if (action.kind === 'resolve-trigger') {
      executeAction(s, s.turnPlayer, 'resolve-trigger', { cardUid: action.cardUid! });
    } else if (action.kind === 'rearrange-protocols') {
      continue; // getLegalActions 不产生（重排由 UI 模态直接提交）——防御性跳过
    } else {
      executeAction(s, s.turnPlayer, action.kind);
    }
    checkInvariants(s, `seed=${seed} step=${steps} 行动=${action.kind} 后`);
  }
  collectField(s, stats);
  return { steps, finished: s.winner !== null };
}
