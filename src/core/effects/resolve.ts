import type { Card, GameState, Line, Op, PendingEffect, PlayerId, StepResult } from '../models/types';
import { drawCards, discardFromHand } from '../engine/deck';
import { advanceStep } from '../engine/turn';
import { gameBus } from '../events/bus';
import { createCtx, emitCardEvent, findCard, isUncovered, nextEffectId } from './context';
import { collectTriggerFor, resolveTrigger } from './triggers';
import { EFFECTS } from './registry';
import './cards/fire';
import './cards/light';
import './cards/darkness';

function topEffect(s: GameState): PendingEffect | undefined {
  return s.pendingEffects[s.pendingEffects.length - 1];
}

/** 效果源卡是否仍有效：在场、正面、未被覆盖；否则剩余效果终止（系统效果无源卡，恒有效） */
function sourceValid(s: GameState, pe: PendingEffect): boolean {
  if (pe.system) return true;
  const card = findCard(s, pe.sourceUid);
  return card !== undefined && card.zone === 'field' && card.faceUp && isUncovered(s, card);
}

/** 打出/翻正/揭开触发中指令：入栈（LIFO 由 runStack 统一结算） */
export function pushMiddle(s: GameState, player: PlayerId, card: Card): void {
  const eff = EFFECTS[card.defId]?.middle;
  if (!eff) return;
  const ctx = createCtx(s, player, card);
  s.pendingEffects.push({
    id: nextEffectId(), player,
    gen: eff(ctx), sourceUid: card.uid, sourceDefId: card.defId,
    prompt: null, lastAnswer: null,
  });
}

export function resolveMiddle(s: GameState, player: PlayerId, card: Card): void {
  pushMiddle(s, player, card);
  runStack(s);
}

/** 应答挂起选择：校验后恢复生成器继续结算 */
export function answerEffect(s: GameState, promptId: string, selected: string[]): void {
  const pe = topEffect(s);
  if (!pe || pe.prompt === null) throw new Error(`no pending choice "${promptId}"`);
  if (pe.id !== promptId) throw new Error(`prompt id mismatch: ${promptId}`);
  const req = pe.prompt;
  if (!req.optional && selected.length < req.min) throw new Error(`requires at least ${req.min} selection(s)`);
  if (selected.length > req.max) throw new Error(`requires at most ${req.max} selection(s)`);
  // 重复选择拦截（沿用旧行为；select max≥2 时防 ['a','a']）
  if (new Set(selected).size !== selected.length) throw new Error(`duplicate selection: ${promptId}`);
  if (req.kind === 'select-line') {
    // 可选 select-line：空应答 = 跳过（如 darkness-1 的可选平移）；否则必须恰选 1 条合法线
    const ok =
      (req.optional && selected.length === 0) ||
      (selected.length === 1 && req.lines?.includes(Number(selected[0].replace('line:', '')) as Line));
    if (!ok) throw new Error('invalid line selection');
  } else if (req.kind === 'select-action') {
    // 逐项校验：每一项都必须属于 req.actions（max>1 时同样拦截非列表项）
    for (const act of selected) {
      if (!req.actions?.includes(act)) throw new Error('invalid action selection');
    }
  } else {
    for (const uid of selected) {
      if (!req.candidates.some((c) => c.uid === uid)) throw new Error(`invalid selection: ${uid}`);
    }
  }
  pe.prompt = null;
  pe.lastAnswer = { selected };
  runStack(s);
}

/** 效果栈主循环：结算栈顶；栈空时完成挂起的落地/偏转落地/步骤推进 */
export function runStack(s: GameState): void {
  for (;;) {
    while (s.pendingEffects.length > 0) {
      const pe = topEffect(s)!;
      if (!sourceValid(s, pe)) {
        s.pendingEffects.pop();
        s.log.push(`效果终止：${pe.sourceDefId} 被覆盖/翻面/移除`);
        continue;
      }
      const result: StepResult = pe.lastAnswer ?? {};
      const r = pe.gen.next(result);
      if (r.done) { s.pendingEffects.pop(); continue; }
      const step = r.value;
      if ('kind' in step) {
        // fizzle 规则：选择请求无合法目标时不挂起 —— 记录日志并以空答案恢复生成器，
        // 由生成器内守卫跳过该步骤（必选/可选一致；可选空目标本就会跳过）。
        // 按 kind 判定"无合法目标"：select 看候选卡，select-line 看可选线，select-action 看可执行操作。
        const noTargets =
          step.kind === 'select' ? step.candidates.length === 0
          : step.kind === 'select-line' ? (step.lines?.length ?? 0) === 0
          : (step.actions?.length ?? 0) === 0;
        if (noTargets) {
          s.log.push('无合法目标，该步骤跳过');
          pe.lastAnswer = { selected: [] };
          continue;
        }
        pe.prompt = step;
        pe.lastAnswer = null;
        return; // 挂起：等待玩家选择
      }
      executeOp(s, pe, step);
      // 落地/落牌前中断效果结算：由外层循环先完成落地（含"被盖住前"连锁）再恢复生成器，
      // 避免连续 shift/playTopDeck 覆盖单一 pendingShift/pendingPlay 槽位（浮空卡丢失）
      if (s.pendingShift.length > 0 || s.pendingPlay.length > 0) break;
    }
    if (s.pendingPlay.length > 0) { completePlay(s); continue; }
    if (s.pendingShift.length > 0) { completeShift(s); continue; }
    if (s.pendingStepAdvance) {
      s.pendingStepAdvance = false;
      advanceStep(s);
      continue;
    }
    return;
  }
}

/** 操作执行（Task 4 加 flip、Task 5 加 delete/return、Task 6 加 shift） */
export function executeOp(s: GameState, pe: PendingEffect, op: Op): void {
  switch (op.op) {
    case 'discard': {
      const card = findCard(s, op.uid);
      if (!card || card.zone !== 'hand') throw new Error(`cannot discard ${op.uid}: not in hand`);
      discardFromHand(s, pe.player, op.uid);
      // triggerProtocol/triggerDefId：触发这张弃牌的卡（效果源），FX 层据此叠加协议专属额外特效
      emitCardEvent(s, 'card:discarded', card, {
        triggerDefId: pe.sourceDefId,
        triggerProtocol: pe.sourceDefId.split('-')[0],
      });
      break;
    }
    case 'draw': {
      drawCards(s, pe.player, op.count);
      gameBus.emit({ type: 'card:drawn', state: s, payload: { player: pe.player, count: op.count } });
      break;
    }
    case 'flip': {
      const card = findCard(s, op.uid);
      if (!card || card.zone !== 'field') throw new Error(`cannot flip ${op.uid}: not on field`);
      if (!op.allowCovered && !isUncovered(s, card)) throw new Error(`cannot flip ${op.uid}: covered card`);
      card.faceUp = !card.faceUp;
      emitCardEvent(s, 'card:flipped', card);
      if (card.faceUp) pushMiddle(s, card.owner, card); // 翻正 → 中指令连锁（LIFO）
      break;
    }
    case 'delete': {
      const card = findCard(s, op.uid);
      if (!card || card.zone !== 'field') throw new Error(`cannot delete ${op.uid}: not on field`);
      if (!op.allowCovered && !isUncovered(s, card)) throw new Error(`cannot delete ${op.uid}: covered card`);
      const owner = card.owner;
      const line = card.line!;
      const stack = s.players[owner].stacks[line];
      const idx = stack.findIndex((c) => c.uid === op.uid);
      if (idx === -1) throw new Error(`cannot delete ${op.uid}: not in stack`);
      const wasTop = idx === stack.length - 1;
      stack.splice(idx, 1); // 按目标卡移除（顶卡 splice 末位等价 pop；覆盖卡从堆叠中部移除）
      card.zone = 'trash';
      card.faceUp = true;
      card.line = null;
      card.pos = null;
      s.players[owner].trash.push(card);
      // triggerProtocol/triggerDefId：触发这张删去的卡（效果源），FX 层据此叠加协议专属额外特效
      emitCardEvent(s, 'card:deleted', card, {
        triggerDefId: pe.sourceDefId,
        triggerProtocol: pe.sourceDefId.split('-')[0],
      });
      if (wasTop) revealAfterRemoval(s, owner, line); // 仅当移除的是顶卡时新顶卡才被"揭开"
      break;
    }
    case 'return': {
      const card = findCard(s, op.uid);
      if (!card || card.zone !== 'field') throw new Error(`cannot return ${op.uid}: not on field`);
      if (!op.allowCovered && !isUncovered(s, card)) throw new Error(`cannot return ${op.uid}: covered card`);
      const owner = card.owner;
      const line = card.line!;
      const stack = s.players[owner].stacks[line];
      const idx = stack.findIndex((c) => c.uid === op.uid);
      if (idx === -1) throw new Error(`cannot return ${op.uid}: not in stack`);
      const wasTop = idx === stack.length - 1;
      stack.splice(idx, 1); // 按目标卡移除（顶卡 splice 末位等价 pop；覆盖卡从堆叠中部移除）
      card.zone = 'hand';
      card.line = null;
      card.pos = null;
      s.players[owner].hand.push(card);
      emitCardEvent(s, 'card:returned', card);
      if (wasTop) revealAfterRemoval(s, owner, line); // 仅当移除的是顶卡时新顶卡才被"揭开"
      break;
    }
    case 'shift': {
      const card = findCard(s, op.uid);
      if (!card || card.zone !== 'field') throw new Error(`cannot shift ${op.uid}: not on field`);
      if (!op.allowCovered && !isUncovered(s, card)) throw new Error(`cannot shift ${op.uid}: covered card`);
      if (op.targetLine === card.line) throw new Error('must shift to a different line');
      const owner = card.owner;
      const fromLine = card.line!;
      const stack = s.players[owner].stacks[fromLine];
      const idx = stack.findIndex((c) => c.uid === op.uid);
      if (idx === -1) throw new Error(`cannot shift ${op.uid}: not in stack`);
      const wasTop = idx === stack.length - 1;
      stack.splice(idx, 1); // 按目标卡移除（顶卡 splice 末位等价 pop；覆盖卡从堆叠中部移除）
      card.zone = 'float';
      card.line = op.targetLine; // 提交目标（落地前不可变卦）
      card.pos = null;
      s.pendingShift.push({ card, beforeCoveredDone: false });
      emitCardEvent(s, 'card:shifted', card, { fromLine });
      if (wasTop) revealAfterRemoval(s, owner, fromLine); // 仅当移除的是顶卡时新顶卡才被"揭开"
      break;
    }
    case 'playTopDeck': {
      const p = s.players[pe.player];
      const card = p.deck.pop();
      if (!card) throw new Error('deck is empty');
      card.zone = 'float';
      card.faceUp = op.faceUp;
      card.line = op.line;
      card.pos = null;
      s.pendingPlay.push({ card, beforeCoveredDone: false });
      emitCardEvent(s, 'card:deck-played', card, { line: op.line });
      break;
    }
    case 'playFromHand': {
      const card = findCard(s, op.uid);
      if (!card || card.zone !== 'hand') throw new Error(`cannot play ${op.uid}: not in hand`);
      const hand = s.players[card.owner].hand;
      const idx = hand.findIndex((c) => c.uid === op.uid);
      if (idx === -1) throw new Error(`cannot play ${op.uid}: not in hand`);
      hand.splice(idx, 1); // 从持有者手牌移除
      card.zone = 'float';
      card.faceUp = op.faceUp;
      card.line = op.line;
      card.pos = null;
      s.pendingPlay.push({ card, beforeCoveredDone: false });
      // playFromHand（手牌打出）与 playTopDeck（牌堆顶打出）区分事件：
      // FX 层据此从手牌卡 rect 起飞（而非牌库 rect）飞入目标线堆叠末尾
      emitCardEvent(s, 'card:hand-played', card, { line: op.line });
      break;
    }
    case 'reveal': {
      // 揭示：把卡牌正面复制为幽灵牌到效果属主（发起揭示的玩家）手牌区末尾（不改变原卡状态）
      const card = findCard(s, op.uid);
      if (!card) throw new Error(`cannot reveal ${op.uid}: not found`);
      const shownTo: PlayerId = pe.player;
      s.revealedGhosts.push({
        id: nextEffectId(),
        defId: card.defId,
        shownTo,
        expiresAfterTurn: shownTo,
      });
      emitCardEvent(s, 'card:revealed', card, { shownTo });
      break;
    }
  }
}

/** 落牌（目标顶卡"被盖住前"先结算一次，然后落地 + 中指令；队列 FIFO，每次处理队首） */
function completePlay(s: GameState): void {
  const ps = s.pendingPlay[0];
  if (!ps) return;
  const card = ps.card;
  const p = s.players[card.owner];
  const stack = p.stacks[card.line!];
  if (stack.length > 0 && !ps.beforeCoveredDone) {
    const top = stack[stack.length - 1];
    const t = top.faceUp ? collectTriggerFor(s, top, 'before-covered') : null;
    if (t) { ps.beforeCoveredDone = true; resolveTrigger(s, t); return; }
  }
  card.zone = 'field';
  card.pos = stack.length;
  stack.push(card);
  s.pendingPlay.shift();
  emitCardEvent(s, 'card:played', card);
  if (card.faceUp) pushMiddle(s, card.owner, card);
}

/** 偏转落地（目标顶卡"被盖住前"先结算一次，然后落地；队列 FIFO，每次处理队首） */
function completeShift(s: GameState): void {
  const ps = s.pendingShift[0];
  if (!ps) return;
  const card = ps.card;
  const p = s.players[card.owner];
  const stack = p.stacks[card.line!];
  if (stack.length > 0 && !ps.beforeCoveredDone) {
    const top = stack[stack.length - 1];
    const t = top.faceUp ? collectTriggerFor(s, top, 'before-covered') : null;
    if (t) { ps.beforeCoveredDone = true; resolveTrigger(s, t); return; }
  }
  card.zone = 'field';
  card.pos = stack.length;
  stack.push(card);
  s.pendingShift.shift();
  emitCardEvent(s, 'card:landed', card);
}

/** 顶卡移除后：新顶卡正面朝上则触发其中指令（被揭开连锁；编译不经过此函数，符合"编译不触发文本"） */
export function revealAfterRemoval(s: GameState, owner: PlayerId, line: Line): void {
  const stack = s.players[owner].stacks[line];
  const top = stack[stack.length - 1];
  if (top && top.faceUp) pushMiddle(s, owner, top);
}
