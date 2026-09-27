import type { Card, ChoiceRequest, GameState, Line, PlayerId, Step, Zone } from '../src/core/models/types';
import { createGame, getDraftPool, performDraftPick } from '../src/core/state/create';
import { answerEffect } from '../src/core/effects/resolve';
import { executeAction, executeDevSkip, MUST_ACT_BEFORE_ADVANCE } from '../src/core/game';

/** 循环应答所有挂起选择（含连锁新产生的），直到效果栈清空 */
export function resolveAllChoices(s: GameState, pick: (prompt: ChoiceRequest) => string[]): void {
  for (;;) {
    const top = s.pendingEffects[s.pendingEffects.length - 1];
    if (!top || !top.prompt) return;
    answerEffect(s, top.id, pick(top.prompt));
  }
}

/** 默认选择器：可选事件跳过；必选事件取前 max 个候选（fire-4 会全选，测试可接受）。
 *  kind 感知：select-line / select-action 的 candidates 为空 → 按线/操作编码自动应答（防 flaky）。 */
export function pickFirst(prompt: ChoiceRequest): string[] {
  if (prompt.optional) return [];
  if (prompt.kind === 'select-line') return [`line:${prompt.lines?.[0] ?? 0}`];
  if (prompt.kind === 'select-action') return [prompt.actions?.[0] ?? ''].filter(Boolean);
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

/** 草案：P1 第 1 选 darkness（P1 协议线 0 = darkness），其余自动选池中第一个非 darkness */
export function draftDarknessP1(): GameState {
  const s = createGame();
  performDraftPick(s, 'darkness');
  while (s.phase === 'draft') {
    const avail = getDraftPool(s);
    performDraftPick(s, (avail.find((p) => p.defId !== 'darkness') ?? avail[0]).defId);
  }
  return s;
}

/** 草案：P1 第 1 选 water（P1 协议线 0 = water），其余自动选池中第一个非 water */
export function draftWaterP1(): GameState {
  const s = createGame();
  performDraftPick(s, 'water');
  while (s.phase === 'draft') {
    const avail = getDraftPool(s);
    performDraftPick(s, (avail.find((p) => p.defId !== 'water') ?? avail[0]).defId);
  }
  return s;
}

/** 草案：P1 第 1 选 life（P1 协议线 0 = life），其余自动选池中第一个非 life */
export function draftLifeP1(): GameState {
  const s = createGame();
  performDraftPick(s, 'life');
  while (s.phase === 'draft') {
    const avail = getDraftPool(s);
    performDraftPick(s, (avail.find((p) => p.defId !== 'life') ?? avail[0]).defId);
  }
  return s;
}

/** 草案：P1 第 1 选 death（P1 协议线 0 = death），其余自动选池中第一个非 death */
export function draftDeathP1(): GameState {
  const s = createGame();
  performDraftPick(s, 'death');
  while (s.phase === 'draft') {
    const avail = getDraftPool(s);
    performDraftPick(s, (avail.find((p) => p.defId !== 'death') ?? avail[0]).defId);
  }
  return s;
}

/** 草案：P1 第 1 选 spirit（P1 协议线 0 = spirit），其余自动选池中第一个非 spirit */
export function draftSpiritP1(): GameState {
  const s = createGame();
  performDraftPick(s, 'spirit');
  while (s.phase === 'draft') {
    const avail = getDraftPool(s);
    performDraftPick(s, (avail.find((p) => p.defId !== 'spirit') ?? avail[0]).defId);
  }
  return s;
}

/** 草案：P1 第 1 选 gravity（P1 协议线 0 = gravity），其余自动选池中第一个非 gravity */
export function draftGravityP1(): GameState {
  const s = createGame();
  performDraftPick(s, 'gravity');
  while (s.phase === 'draft') {
    const avail = getDraftPool(s);
    performDraftPick(s, (avail.find((p) => p.defId !== 'gravity') ?? avail[0]).defId);
  }
  return s;
}

/** 草案：P1 第 1 选 psychic（P1 协议线 0 = psychic），其余自动选池中第一个非 psychic */
export function draftPsychicP1(): GameState {
  const s = createGame();
  performDraftPick(s, 'psychic');
  while (s.phase === 'draft') {
    const avail = getDraftPool(s);
    performDraftPick(s, (avail.find((p) => p.defId !== 'psychic') ?? avail[0]).defId);
  }
  return s;
}

/** 草案：P1 第 1 选 plague（P1 协议线 0 = plague），其余自动选池中第一个非 plague */
export function draftPlagueP1(): GameState {
  const s = createGame();
  performDraftPick(s, 'plague');
  while (s.phase === 'draft') {
    const avail = getDraftPool(s);
    performDraftPick(s, (avail.find((p) => p.defId !== 'plague') ?? avail[0]).defId);
  }
  return s;
}

/** 草案：P1 第 1 选 metal（P1 协议线 0 = metal），其余自动选池中第一个非 metal */
export function draftMetalP1(): GameState {
  const s = createGame();
  performDraftPick(s, 'metal');
  while (s.phase === 'draft') {
    const avail = getDraftPool(s);
    performDraftPick(s, (avail.find((p) => p.defId !== 'metal') ?? avail[0]).defId);
  }
  return s;
}

/** 草案：P1 第 1 选 speed（P1 协议线 0 = speed），其余自动选池中第一个非 speed */
export function draftSpeedP1(): GameState {
  const s = createGame();
  performDraftPick(s, 'speed');
  while (s.phase === 'draft') {
    const avail = getDraftPool(s);
    performDraftPick(s, (avail.find((p) => p.defId !== 'speed') ?? avail[0]).defId);
  }
  return s;
}

/** 草案：P1 第 1 选 love（P1 协议线 0 = love），其余自动选池中第一个非 love */
export function draftLoveP1(): GameState {
  const s = createGame();
  performDraftPick(s, 'love');
  while (s.phase === 'draft') {
    const avail = getDraftPool(s);
    performDraftPick(s, (avail.find((p) => p.defId !== 'love') ?? avail[0]).defId);
  }
  return s;
}

/** 草案：P1 第 1 选 hate（P1 协议线 0 = hate），其余自动选池中第一个非 hate */
export function draftHateP1(): GameState {
  const s = createGame();
  performDraftPick(s, 'hate');
  while (s.phase === 'draft') {
    const avail = getDraftPool(s);
    performDraftPick(s, (avail.find((p) => p.defId !== 'hate') ?? avail[0]).defId);
  }
  return s;
}

/** 草案：P1 第 1 选 apathy（P1 协议线 0 = apathy），其余自动选池中第一个非 apathy */
export function draftApathyP1(): GameState {
  const s = createGame();
  performDraftPick(s, 'apathy');
  while (s.phase === 'draft') {
    const avail = getDraftPool(s);
    performDraftPick(s, (avail.find((p) => p.defId !== 'apathy') ?? avail[0]).defId);
  }
  return s;
}

/** 推进到指定步骤（起始手牌下堆叠为空，不会触发强制编译）。
 *
 * ⚠️ 2026-09-27（G6 T45，用户 ⑥）起，**行动步只要能出牌或刷新就不许 `advance`**。
 * 本夹具的职责是"把状态摆到第 X 步"，而那几个要经过行动步的目标（`check-cache` / `end` /
 * `check-compile`）如果真去打一张牌或刷新，会把测试刚摆好的盘面改掉。⇒ 被这条**新**守卫
 * 拦下时改走那个**显式旁路** `executeDevSkip`（与开发者指令 `/skip` 同一个出口：必编译 /
 * 空手必刷新 / 超 5 必清 / 必选触发未结算四条老守卫一条不放松，照旧抛）。
 *
 * 只兜这一条守卫：别的错误（例：`mandatory trigger must be resolved`）**原样抛出去**，
 * 免得夹具把真错误一起吞掉。 */
export function advanceToStep(s: GameState, player: PlayerId, step: Step): void {
  while (s.phase === 'turn' && s.step !== step) {
    try {
      executeAction(s, player, 'advance');
    } catch (e) {
      if (!(e instanceof Error) || e.message !== MUST_ACT_BEFORE_ADVANCE) throw e;
      executeDevSkip(s, player);
    }
  }
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
