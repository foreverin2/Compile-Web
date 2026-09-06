import type { GameState, PlayerId, Line, EffectStep, StepResult } from './models/types';
import { advanceStep } from './engine/turn';
import { clearCache } from './engine/deck';
import { playCard, refreshHand, isPlayableFaceUp } from './actions/base';
import { rearrangeProtocolSlots } from './actions/rearrange';
import { executeCompile, getCompilableLines } from './rules/compile';
import { checkControl, resetControlIfHeld } from './rules/control';
import {
  lineBlocksOpponent,
  lineBlocksOpponentFaceDown,
  opponentMustPlayFaceDown,
  shouldSkipCacheCheck,
  cardCanPlayToOpponentSide,
} from './rules/restrictions';
import { collectTriggers, fireReactive, resolveTrigger } from './effects/triggers';
import { answerEffect, runStack } from './effects/resolve';
import { listCandidates, nextEffectId, shouldBlockDraw } from './effects/context';
import { pushLog } from './log';

export type ActionKind = 'play' | 'refresh' | 'compile' | 'advance' | 'effect-choice' | 'resolve-trigger' | 'clear-cache' | 'rearrange-protocols';

export interface PlayArgs {
  cardUid: string;
  faceUp: boolean;
  line: Line;
  /** 打出目标玩家（修改提示词 15：corruption-0 可落【对方】链路 = 易主对方进对方场） */
  target?: PlayerId;
}

export interface LegalAction {
  kind: ActionKind;
  line?: Line;
  cardUid?: string;
  faceUp?: boolean;
  /** 打出目标玩家（缺省 = 行动玩家自己；corruption-0 可 target 对方，见 PlayArgs.target） */
  target?: PlayerId;
  promptId?: string;
  choice?: string[];
  /** 触发来源卡牌 defId（resolve-trigger 按钮文案带来源，修改提示词 28） */
  defId?: string;
}

export function getLegalActions(s: GameState, player: PlayerId): LegalAction[] {
  if (s.phase !== 'turn' || s.turnPlayer !== player || s.winner !== null) return [];
  // 效果结算挂起 / 落牌（浮空）中：无标准行动（选择经 UI 直接应答）
  if (s.pendingEffects.length > 0 || s.pendingPlay.length > 0 || s.pendingShift.length > 0) return [];
  const out: LegalAction[] = [];
  if (s.step === 'action') {
    // 被动限制（Task A2）：psychic-1 全局禁对手正面打；plague-0 此列完全禁打；metal-2 此列禁反面打
    const faceUpBanned = opponentMustPlayFaceDown(s, player);
    for (const card of s.players[player].hand) {
      for (const line of [0, 1, 2] as Line[]) {
        if (lineBlocksOpponent(s, line, player)) continue; // plague-0：此列完全禁打
        if (!faceUpBanned && isPlayableFaceUp(s, player, card.uid, line)) {
          out.push({ kind: 'play', cardUid: card.uid, faceUp: true, line });
        }
        if (!lineBlocksOpponentFaceDown(s, line, player)) {
          out.push({ kind: 'play', cardUid: card.uid, faceUp: false, line });
        }
        // 修改提示词 15：corruption-0 底「此牌可以打在任意一方的任意协议处」→ 落点可扩至
        // 对方任一链路（target=对方；正面：底放行任意协议匹配已由 isPlayableFaceUp 覆盖；
        // 反面：打对方场反面无意义——腐化0 以正面落对方场发挥干扰/翻转作用，只出正面）
        if (
          cardCanPlayToOpponentSide(card.defId) &&
          !faceUpBanned &&
          !lineBlocksOpponent(s, line, player)
        ) {
          const opp: PlayerId = player === 0 ? 1 : 0;
          out.push({ kind: 'play', cardUid: card.uid, faceUp: true, line, target: opp });
        }
      }
    }
    if (s.players[player].hand.length < 5 && !shouldBlockDraw(s, player)) {
      // ice-6 顶在场且手牌>0 → 不可刷新（FAQ 冰6：刷新想抽必须能抽上牌）
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
      out.push({ kind: 'resolve-trigger', cardUid: t.cardUid, defId: t.defId });
    }
    // 必选触发未清空时不允许跳过（advance）
    if (!triggers.some((t) => !t.optional)) {
      out.push({ kind: 'advance' });
    }
    return out; // end/start 的 advance 已处理，不走下方通用逻辑
  } else if (s.step === 'check-cache') {
    // 手牌超过 5 张：必须由玩家自选弃牌至 5 张（不提供 advance）；
    // spirit-0 底「跳过检查缓存阶段」→ 不强制清缓存
    if (s.players[player].hand.length > 5 && !shouldSkipCacheCheck(s, player)) {
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
export function executeAction(s: GameState, player: PlayerId, kind: 'rearrange-protocols', args: { target: PlayerId; a: Line; b: Line }): void;
export function executeAction(s: GameState, player: PlayerId, kind: ActionKind, args?: PlayArgs | { line: Line } | { promptId: string; choice: string[] } | { cardUid: string } | { target: PlayerId; a: Line; b: Line }): void {
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
      playCard(s, player, args.cardUid, args.faceUp, args.line, args.target);
      if (s.pendingEffects.length === 0 && s.pendingPlay.length === 0) {
        advanceStep(s);
      } else {
        s.pendingStepAdvance = true; // 链式结算完毕后由 runStack 推进
      }
      break;
    }
    case 'refresh': {
      resetControlIfHeld(s, player);
      // 日志树（2026-09）：玩家主动补满手牌动作（效果内刷新由卡效果帧自行记录）
      pushLog(s, `P${player + 1} 补满手牌`);
      refreshHand(s, player);
      // refreshHand 内 drawCards 可能触发 after-draw 即时连锁（spirit-3 等）→ 栈非空时
      // 先结算（可能挂起选择）再推进；与 play 分支同一模式
      if (s.pendingEffects.length > 0) { s.pendingStepAdvance = true; runStack(s); }
      else advanceStep(s);
      break;
    }
    case 'compile': {
      // 需收窄（'line' in args 排除 effect-choice / resolve-trigger 的 args 形状）
      if (!args || !('line' in args)) throw new Error('compile requires args.line');
      resetControlIfHeld(s, player);
      executeCompile(s, player, args.line); // 内部可能因 speed-2「编译前平移」触发挂起选线
      // 编译本体触发的即时连锁（war-2 after-compile / 3代 after-self-compile/after-any-compile 等）
      // 与 refresh/play 分支同款：栈非空时先 runStack 结算（可能挂起选择）再推进
      if (s.pendingEffects.length > 0) { s.pendingStepAdvance = true; runStack(s); }
      else advanceStep(s);
      break;
    }
    case 'rearrange-protocols': {
      // 控制组件重排（基础规则：编译/补满手牌前持有控制组件的玩家可调整任意一方的协议
      // 摆放顺序，可多次交换直到满意；UI 模态逐次提交本 action）。
      // 防御校验：编译/刷新确认期（check-compile 或 action 步骤、无挂起）由行动玩家执行。
      if (!args || !('target' in args) || !('a' in args) || !('b' in args)) {
        throw new Error('rearrange-protocols requires args.target/a/b');
      }
      if (s.step !== 'check-compile' && s.step !== 'action') {
        throw new Error('rearrange-protocols only usable before compile/refresh');
      }
      rearrangeProtocolSlots(s, args.target as PlayerId, args.a as Line, args.b as Line);
      // 3代「重排协议」事件（C4 控制组件重排也算）：行动玩家为发起者
      fireReactive(s, 'after-self-rearrange', player);
      fireReactive(s, 'after-any-rearrange', player);
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
      // 顶命令触发（top 标志：被盖的 death-1/life-0 等）→ topCommand 跳过 sourceValid 未覆盖检查
      resolveTrigger(s, t, { topCommand: t.top });
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
      if (s.step === 'check-cache' && s.players[player].hand.length > 5 && !shouldSkipCacheCheck(s, player)) {
        throw new Error('must clear cache first');
      }
      if (s.step === 'end' || s.step === 'start') {
        const k: 'end' | 'start' = s.step;
        if (collectTriggers(s, k).some((t) => !t.optional)) {
          throw new Error('mandatory trigger must be resolved');
        }
      }
      if (s.step === 'check-cache' && !shouldSkipCacheCheck(s, player)) {
        // 防御路径（正常手牌>5 走 clear-cache 自选弃牌，advance 被拦截）；真弃了牌才触发
        if (clearCache(s, player).length > 0) {
          fireReactive(s, 'after-clear-cache', player);
          fireReactive(s, 'after-any-clear-cache', player); // 3代 暴食1 底「任意玩家清缓存后」
        }
      }
      if (s.step === 'check-control') {
        checkControl(s);
        // 控制权易主（行动玩家获得）→ after-opponent-gain-control 即时连锁（3代 色欲4 底/傲慢6 顶）
        if (s.pendingEffects.length > 0) runStack(s);
      }
      advanceStep(s);
      break;
    }
  }
}

export function getWinner(s: GameState): PlayerId | null {
  return s.winner;
}

/** 系统效果生成器：清理缓存——玩家自选弃牌，直至手牌降到 5 张；弃完触发 after-clear-cache（speed-1）。
 *  用 discardMany 一次性弃完（FAQ 94：多张弃牌是单次动作，之后由弃牌触发的效果才生效一次） */
function* cacheClearGen(s: GameState, player: PlayerId): Generator<EffectStep, void, StepResult> {
  const excess = s.players[player].hand.length - 5;
  pushLog(s, `P${player + 1} 清理缓存：弃 ${excess} 张牌至 5 张上限`);
  const candidates = listCandidates(s, { zone: 'hand', owner: player });
  const ans = yield {
    kind: 'select',
    title: `清理缓存：弃 ${excess} 张牌（手牌超过 5 张上限）`,
    min: excess,
    max: excess,
    optional: false,
    candidates,
  };
  if (ans.selected.length > 0) {
    yield { op: 'discardMany', uids: ans.selected };
    // 即时连锁：真弃了牌才触发（speed-1 顶「清理缓存后：抽1张牌」；3代 暴食0 顶/暴食1 底同点）
    fireReactive(s, 'after-clear-cache', player);
    fireReactive(s, 'after-any-clear-cache', player);
  }
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
