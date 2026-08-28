import type { GameState, PlayerId, Line } from './models/types';
import { advanceStep } from './engine/turn';
import { clearCache } from './engine/deck';
import { playCard, refreshHand } from './actions/base';
import { executeCompile, getCompilableLines } from './rules/compile';
import { checkControl, resetControlIfHeld } from './rules/control';
import { getCardDef } from '../data/demo';

export type ActionKind = 'play' | 'refresh' | 'compile' | 'advance';

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
}

export function getLegalActions(s: GameState, player: PlayerId): LegalAction[] {
  if (s.phase !== 'turn' || s.turnPlayer !== player || s.winner !== null) return [];
  const out: LegalAction[] = [];
  if (s.step === 'action') {
    for (const card of s.players[player].hand) {
      // 正面：只能进匹配线；背面：任意线
      for (const line of [0, 1, 2] as Line[]) {
        const def = getCardDef(card.defId);
        if (def.protocol === s.players[player].protocols[line].defId) {
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
  }
  // 无玩家输入的步骤（start/check-control/check-cache/end）或本步骤无事可做 → 允许推进；
  // check-compile 存在可编译线时编译为强制且唯一的行动，不再提供 advance；
  // action 步骤且手牌为空时（无牌可打）必须刷新，同样不提供 advance（规则：无牌可打必须补满手牌）
  const mustRefresh = s.step === 'action' && s.players[player].hand.length === 0;
  if (
    !(s.step === 'check-compile' && getCompilableLines(s, player).length > 0) &&
    !mustRefresh
  ) {
    out.push({ kind: 'advance' });
  }
  return out;
}

// 重载：play 需要完整 args；compile 只需 line；refresh/advance 无 args
// （修正 brief 中 PlayArgs 全必填与测试 `compile, { line: 2 }` 的类型冲突）
export function executeAction(s: GameState, player: PlayerId, kind: 'play', args: PlayArgs): void;
export function executeAction(s: GameState, player: PlayerId, kind: 'compile', args: { line: Line }): void;
export function executeAction(s: GameState, player: PlayerId, kind: 'refresh' | 'advance'): void;
export function executeAction(s: GameState, player: PlayerId, kind: ActionKind, args?: PlayArgs | { line: Line }): void {
  if (s.phase !== 'turn' || s.winner !== null) throw new Error('game not in turn phase');
  if (s.turnPlayer !== player) throw new Error('not your turn');

  switch (kind) {
    case 'play': {
      if (!args || !('cardUid' in args)) throw new Error('play requires args');
      playCard(s, player, args.cardUid, args.faceUp, args.line);
      advanceStep(s);
      break;
    }
    case 'refresh': {
      resetControlIfHeld(s, player);
      refreshHand(s, player);
      advanceStep(s);
      break;
    }
    case 'compile': {
      if (!args) throw new Error('compile requires args.line');
      resetControlIfHeld(s, player);
      executeCompile(s, player, args.line);
      advanceStep(s); // compiledThisTurn=true → 跳过 action
      break;
    }
    case 'advance': {
      if (s.step === 'check-compile' && getCompilableLines(s, player).length > 0) {
        throw new Error('compile is mandatory at check-compile');
      }
      if (s.step === 'action' && s.players[player].hand.length === 0) {
        throw new Error('must refresh with no cards in hand');
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
