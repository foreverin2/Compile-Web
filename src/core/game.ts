import type { GameState, PlayerId, Line, EffectStep, StepResult } from './models/types';
import { advanceStep } from './engine/turn';
import { clearCache } from './engine/deck';
import { playCard, refreshHand, isPlayableFaceUp } from './actions/base';
import { executeCompile, getCompilableLines } from './rules/compile';
import { checkControl, resetControlIfHeld } from './rules/control';
import { collectTriggers, resolveTrigger } from './effects/triggers';
import { answerEffect, runStack } from './effects/resolve';
import { listCandidates, nextEffectId } from './effects/context';

export type ActionKind = 'play' | 'refresh' | 'compile' | 'advance' | 'effect-choice' | 'resolve-trigger' | 'clear-cache';

export interface PlayArgs {
  cardUid: string;
  faceUp: boolean;
  line: Line;
}

export interface LegalAction {
  kind: ActionKind;
  line?: Line;
  cardUid?: string;
  faceUp?: boolean;
  promptId?: string;
  choice?: string[];
}

export function getLegalActions(s: GameState, player: PlayerId): LegalAction[] {
  if (s.phase !== 'turn' || s.turnPlayer !== player || s.winner !== null) return [];
  // 效果结算挂起 / 落牌（浮空）中：无标准行动（选择经 UI 直接应答）
  if (s.pendingEffects.length > 0 || s.pendingPlay.length > 0 || s.pendingShift.length > 0) return [];
  const out: LegalAction[] = [];
  if (s.step === 'action') {
    for (const card of s.players[player].hand) {
      for (const line of [0, 1, 2] as Line[]) {
        if (isPlayableFaceUp(s, player, card.uid, line)) {
          out.push({ kind: 'play', cardUid: card.uid, faceUp: true, line });
        }
        out.push({ kind: 'play', cardUid: card.uid, faceUp: false, line });
      }
    }
    if (s.players[player].hand.length < 5) {
      out.push({ kind: 'refresh' });
    }
  } else if (s.step === 'check-compile') {
    for (const line of getCompilableLines(s, player)) {
      out.push({ kind: 'compile', line });
    }
  } else if (s.step === 'end' || s.step === 'start') {
    const kind: 'end' | 'start' = s.step;
    const triggers = collectTriggers(s, kind);
    for (const t of triggers) {
      out.push({ kind: 'resolve-trigger', cardUid: t.cardUid });
    }
    // 必选触发未清空时不允许跳过（advance）
    if (!triggers.some((t) => !t.optional)) {
      out.push({ kind: 'advance' });
    }
    return out; // end/start 的 advance 已处理，不走下方通用逻辑
  } else if (s.step === 'check-cache') {
    // 手牌超过 5 张：必须由玩家自选弃牌至 5 张（不提供 advance）
    if (s.players[player].hand.length > 5) {
      out.push({ kind: 'clear-cache' });
      return out;
    }
  }
  const mustRefresh = s.step === 'action' && s.players[player].hand.length === 0;
  if (
    !(s.step === 'check-compile' && getCompilableLines(s, player).length > 0) &&
    !mustRefresh
  ) {
    out.push({ kind: 'advance' });
  }
  return out;
}

// 重载：play 需要完整 args；compile 只需 line；refresh/advance 无 args；
// effect-choice 需要 promptId + choice；resolve-trigger 需要 cardUid
// （修正 brief 中 PlayArgs 全必填与测试 `compile, { line: 2 }` 的类型冲突）
export function executeAction(s: GameState, player: PlayerId, kind: 'play', args: PlayArgs): void;
export function executeAction(s: GameState, player: PlayerId, kind: 'compile', args: { line: Line }): void;
export function executeAction(s: GameState, player: PlayerId, kind: 'refresh' | 'advance' | 'clear-cache'): void;
export function executeAction(s: GameState, player: PlayerId, kind: 'effect-choice', args: { promptId: string; choice: string[] }): void;
export function executeAction(s: GameState, player: PlayerId, kind: 'resolve-trigger', args: { cardUid: string }): void;
export function executeAction(s: GameState, player: PlayerId, kind: ActionKind, args?: PlayArgs | { line: Line } | { promptId: string; choice: string[] } | { cardUid: string }): void {
  if (s.phase !== 'turn' || s.winner !== null) throw new Error('game not in turn phase');
  if (s.turnPlayer !== player && kind !== 'effect-choice') throw new Error('not your turn');
  // 效果结算挂起 / 落牌中：只允许应答选择
  if (kind !== 'effect-choice') {
    if (s.pendingEffects.length > 0) throw new Error('resolve pending effect choices first');
    if (s.pendingPlay.length > 0 || s.pendingShift.length > 0) throw new Error('pending play/shift in progress');
  }

  switch (kind) {
    case 'play': {
      // 需收窄到 PlayArgs（'cardUid' in args 不足以排除 resolve-trigger 的 { cardUid }）
      if (!args || !('cardUid' in args) || !('faceUp' in args)) throw new Error('play requires args');
      playCard(s, player, args.cardUid, args.faceUp, args.line);
      if (s.pendingEffects.length === 0 && s.pendingPlay.length === 0) {
        advanceStep(s);
      } else {
        s.pendingStepAdvance = true; // 链式结算完毕后由 runStack 推进
      }
      break;
    }
    case 'refresh': {
      resetControlIfHeld(s, player);
      refreshHand(s, player);
      advanceStep(s);
      break;
    }
    case 'compile': {
      // 需收窄（'line' in args 排除 effect-choice / resolve-trigger 的 args 形状）
      if (!args || !('line' in args)) throw new Error('compile requires args.line');
      resetControlIfHeld(s, player);
      executeCompile(s, player, args.line);
      advanceStep(s);
      break;
    }
    case 'effect-choice': {
      if (!args || !('promptId' in args)) throw new Error('effect-choice requires args');
      const top = s.pendingEffects[s.pendingEffects.length - 1];
      // 选择权归属者：prompt.chooser（"被作用卡持有者决定"）缺省 = 效果属主（PendingEffect.player）
      const chooser = top?.prompt?.chooser ?? top?.player;
      if (!top || chooser !== player) throw new Error('not your choice');
      answerEffect(s, args.promptId, args.choice);
      break;
    }
    case 'resolve-trigger': {
      if (!args || !('cardUid' in args)) throw new Error('resolve-trigger requires args');
      const kind: 'end' | 'start' | null = s.step === 'end' ? 'end' : s.step === 'start' ? 'start' : null;
      if (!kind) throw new Error('resolve-trigger only at end/start');
      const t = collectTriggers(s, kind).find((x) => x.cardUid === args.cardUid);
      if (!t) throw new Error(`no pending ${kind} trigger for ${args.cardUid}`);
      resolveTrigger(s, t);
      runStack(s);
      // 结算成功后才标记已结算：若解析抛错，触发不会被吞掉（必选触发仍阻止 advance）
      s.resolvedTriggerUids.push(args.cardUid);
      break;
    }
    case 'clear-cache': {
      if (s.step !== 'check-cache') throw new Error('clear-cache only at check-cache');
      beginCacheClear(s, player);
      // 玩家自选弃牌挂起；应答后效果栈排空，pendingStepAdvance 由 runStack 消费推进到 end
      s.pendingStepAdvance = true;
      break;
    }
    case 'advance': {
      if (s.step === 'check-compile' && getCompilableLines(s, player).length > 0) {
        throw new Error('compile is mandatory at check-compile');
      }
      if (s.step === 'action' && s.players[player].hand.length === 0) {
        throw new Error('must refresh with no cards in hand');
      }
      if (s.step === 'check-cache' && s.players[player].hand.length > 5) {
        throw new Error('must clear cache first');
      }
      if (s.step === 'end' || s.step === 'start') {
        const k: 'end' | 'start' = s.step;
        if (collectTriggers(s, k).some((t) => !t.optional)) {
          throw new Error('mandatory trigger must be resolved');
        }
      }
      if (s.step === 'check-cache') {
        clearCache(s, player);
      }
      if (s.step === 'check-control') {
        checkControl(s);
      }
      advanceStep(s);
      break;
    }
  }
}

export function getWinner(s: GameState): PlayerId | null {
  return s.winner;
}

/** 系统效果生成器：清理缓存——玩家自选弃牌，直至手牌降到 5 张 */
function* cacheClearGen(s: GameState, player: PlayerId): Generator<EffectStep, void, StepResult> {
  const excess = s.players[player].hand.length - 5;
  const candidates = listCandidates(s, { zone: 'hand', owner: player });
  const ans = yield {
    kind: 'select',
    title: `清理缓存：弃 ${excess} 张牌（手牌超过 5 张上限）`,
    min: excess,
    max: excess,
    optional: false,
    candidates,
  };
  for (const uid of ans.selected) yield { op: 'discard', uid };
}

/** 进入缓存清理：手牌 > 5 时推入系统效果（挂起选择，无源卡 → system 标志跳过 sourceValid） */
function beginCacheClear(s: GameState, player: PlayerId): void {
  const excess = s.players[player].hand.length - 5;
  if (excess <= 0) throw new Error('cache is within limit');
  s.pendingEffects.push({
    id: nextEffectId(),
    player,
    gen: cacheClearGen(s, player),
    sourceUid: 'system-cache',
    sourceDefId: 'system',
    system: true,
    prompt: null,
    lastAnswer: null,
  });
  runStack(s);
}
