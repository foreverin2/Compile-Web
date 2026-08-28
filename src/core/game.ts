import type { GameState, PlayerId, Line } from './models/types';
import { advanceStep } from './engine/turn';
import { clearCache } from './engine/deck';
import { playCard, refreshHand } from './actions/base';
import { executeCompile, getCompilableLines } from './rules/compile';

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
        const def = getCardDefSafe(card.defId);
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
  // 无玩家输入的步骤（start/check-control/check-cache/end）或本步骤无事可做 → 允许推进
  out.push({ kind: 'advance' });
  return out;
}

function getCardDefSafe(defId: string): { protocol: string } {
  // 内联以避免循环依赖：仅取协议字段
  return { protocol: defId.split('-')[0] };
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
      refreshHand(s, player);
      advanceStep(s);
      break;
    }
    case 'compile': {
      if (!args) throw new Error('compile requires args.line');
      executeCompile(s, player, args.line);
      advanceStep(s); // compiledThisTurn=true → 跳过 action
      break;
    }
    case 'advance': {
      if (s.step === 'check-cache') {
        clearCache(s, player);
      }
      advanceStep(s);
      break;
    }
  }
}

export function getWinner(s: GameState): PlayerId | null {
  return s.winner;
}
