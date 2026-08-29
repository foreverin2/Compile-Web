import type { Card, ChoiceRequest, GameState, Line, PlayerId, Step, Zone } from '../src/core/models/types';
import { createGame, getDraftPool, performDraftPick } from '../src/core/state/create';
import { answerEffect } from '../src/core/effects/resolve';
import { executeAction } from '../src/core/game';

/** 循环应答所有挂起选择（含连锁新产生的），直到效果栈清空 */
export function resolveAllChoices(s: GameState, pick: (prompt: ChoiceRequest) => string[]): void {
  for (;;) {
    const top = s.pendingEffects[s.pendingEffects.length - 1];
    if (!top || !top.prompt) return;
    answerEffect(s, top.id, pick(top.prompt));
  }
}

/** 默认选择器：可选事件跳过；必选事件取前 max 个候选（fire-4 会全选，测试可接受） */
export function pickFirst(prompt: ChoiceRequest): string[] {
  if (prompt.optional) return [];
  return prompt.candidates.slice(0, prompt.max).map((c) => c.uid);
}

/** 草案：P1 第 1 选 fire（P1 协议线 0 = fire），其余自动选池中第一个非 fire */
export function draftFireP1(): GameState {
  const s = createGame();
  performDraftPick(s, 'fire');
  while (s.phase === 'draft') {
    const avail = getDraftPool(s);
    performDraftPick(s, (avail.find((p) => p.defId !== 'fire') ?? avail[0]).defId);
  }
  return s;
}

/** 草案：P1 第 1 选 light（P1 协议线 0 = light），其余自动选池中第一个非 light */
export function draftLightP1(): GameState {
  const s = createGame();
  performDraftPick(s, 'light');
  while (s.phase === 'draft') {
    const avail = getDraftPool(s);
    performDraftPick(s, (avail.find((p) => p.defId !== 'light') ?? avail[0]).defId);
  }
  return s;
}

/** 推进到指定步骤（起始手牌下堆叠为空，不会触发强制编译） */
export function advanceToStep(s: GameState, player: PlayerId, step: Step): void {
  while (s.phase === 'turn' && s.step !== step) executeAction(s, player, 'advance');
}

let testUid = 0;
export function makeCard(
  defId: string,
  owner: PlayerId = 0,
  zone: Zone = 'field',
  faceUp = true,
  line: Line | null = null,
  pos = 0,
): Card {
  testUid += 1;
  return { uid: `tc${testUid}`, defId, owner, faceUp, zone, line, pos: zone === 'field' ? pos : null };
}
