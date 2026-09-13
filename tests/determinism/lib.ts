import type { GameState, Line, PlayerId } from '../../src/core/models/types';
import { executeAction, getLegalActions, type LegalAction } from '../../src/core/game';
import { answerEffect, runStack } from '../../src/core/effects/resolve';
import { randomAnswer } from '../fuzz/lib';

/** 与引擎 ActionKind 同源，避免手写字面量漂移 */
type ActionKind = LegalAction['kind'];

/** 可重放的一步（G0 内部用；正式档案格式 MatchFile 见设计稿 §3，属于 G3） */
export type Step =
  | { t: 'action'; player: PlayerId; kind: ActionKind; args?: unknown }
  | { t: 'answer'; id: string; choice: string[] };

/**
 * 施加一步。
 * **必须按 kind 分支调用**：`executeAction` 是窄化重载（game.ts:115-121），
 * 传一个联合类型的 kind 无法通过重载解析。这里与 main.ts 的 `onAction` 分发同构。
 */
export function applyStep(s: GameState, step: Step): void {
  if (step.t === 'answer') {
    answerEffect(s, step.id, step.choice);
    runStack(s);
    return;
  }
  switch (step.kind) {
    case 'play': {
      const a = step.args as { cardUid: string; faceUp: boolean; line: Line; target?: PlayerId };
      executeAction(s, step.player, 'play', a);
      break;
    }
    case 'compile':
      executeAction(s, step.player, 'compile', step.args as { line: Line });
      break;
    case 'resolve-trigger':
      executeAction(s, step.player, 'resolve-trigger', step.args as { cardUid: string });
      break;
    case 'effect-choice':
      executeAction(s, step.player, 'effect-choice', step.args as { promptId: string; choice: string[] });
      break;
    case 'rearrange-protocols':
      // 本驱动不产生该步（由 UI 模态直接提交）——显式抛出，同时让 default 收窄为无参重载
      throw new Error('rearrange-protocols 由 UI 模态驱动，不经过本步骤驱动');
    default:
      // 此处 kind 已收窄为 refresh | advance | clear-cache（无参数重载）
      executeAction(s, step.player, step.kind);
      break;
  }
}

/** 用可复现选择流推进并记录步骤。
 *  与 tests/fuzz/lib.ts 的 playRandomGameInner 保持同一判断顺序。 */
export function recordRandomSteps(s: GameState, r: () => number, max: number): Step[] {
  const steps: Step[] = [];
  for (let i = 0; i < max; i++) {
    if (s.winner !== null || s.phase !== 'turn') break;
    const top = s.pendingEffects[s.pendingEffects.length - 1];
    if (top?.prompt) {
      const step: Step = { t: 'answer', id: top.id, choice: randomAnswer(top.prompt, r) };
      steps.push(step);
      applyStep(s, step);
      continue;
    }
    const legal: LegalAction[] = getLegalActions(s, s.turnPlayer);
    if (legal.length === 0) break;
    const action = legal[Math.floor(r() * legal.length)];
    // getLegalActions 不产生这两类（重排由 UI 模态直接提交）——防御性跳过
    if (action.kind === 'effect-choice' || action.kind === 'rearrange-protocols') continue;
    const player = s.turnPlayer;
    let step: Step;
    if (action.kind === 'play') {
      step = {
        t: 'action',
        player,
        kind: 'play',
        args: { cardUid: action.cardUid!, faceUp: action.faceUp!, line: action.line!, target: action.target },
      };
    } else if (action.kind === 'compile') {
      step = { t: 'action', player, kind: 'compile', args: { line: action.line! } };
    } else if (action.kind === 'resolve-trigger') {
      step = { t: 'action', player, kind: 'resolve-trigger', args: { cardUid: action.cardUid! } };
    } else {
      // 收窄为 refresh | advance | clear-cache
      step = { t: 'action', player, kind: action.kind };
    }
    steps.push(step);
    applyStep(s, step);
  }
  return steps;
}
