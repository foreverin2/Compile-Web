import type { GameState, PlayerId, Line } from '../models/types';
import { getLineValue } from '../state/create';

export function canCompileLine(s: GameState, player: PlayerId, line: Line): boolean {
  const own = getLineValue(s, player, line);
  const opp = getLineValue(s, player === 0 ? 1 : 0, line);
  return own >= 10 && own > opp;
}

export function getCompilableLines(s: GameState, player: PlayerId): Line[] {
  const lines: Line[] = [];
  for (const line of [0, 1, 2] as Line[]) {
    if (canCompileLine(s, player, line)) lines.push(line);
  }
  return lines;
}

export function mustCompile(s: GameState, player: PlayerId): boolean {
  return getCompilableLines(s, player).length > 0;
}

/** 编译：同时删除该线双方全部卡牌（"all" 效果，不触发文本），翻协议或抽对手牌库顶 1 张 */
export function executeCompile(s: GameState, player: PlayerId, line: Line): void {
  if (!canCompileLine(s, player, line)) {
    throw new Error(`line ${line} does not meet compile requirements`);
  }
  const p = s.players[player];
  const opp = s.players[player === 0 ? 1 : 0];
  // 同时删除：双方该线堆叠全部入各自 trash
  const ownCards = p.stacks[line].splice(0);
  const oppCards = opp.stacks[line].splice(0);
  for (const card of [...ownCards, ...oppCards]) {
    card.zone = 'trash';
    card.line = null;
    card.pos = null;
    card.faceUp = true;
  }
  p.trash.push(...ownCards);
  opp.trash.push(...oppCards);
  s.log.push(`P${player + 1} compiles line ${line + 1}`);

  const protocol = p.protocols[line];
  if (protocol.compiled) {
    // 重新编译：抽对手牌库顶 1 张，所有权变更
    const card = opp.deck.pop();
    if (card) {
      card.owner = player;
      card.zone = 'hand';
      card.faceUp = true;
      p.hand.push(card);
      s.log.push(`P${player + 1} recompiles and steals a card`);
    }
  } else {
    protocol.compiled = true;
    s.log.push(`Protocol "${protocol.defId}" compiled`);
  }

  s.compiledThisTurn = true;

  // 胜利判定
  if (p.protocols.every((pr) => pr.compiled)) {
    s.winner = player;
    s.phase = 'gameover';
    s.log.push(`P${player + 1} wins!`);
  }
}
