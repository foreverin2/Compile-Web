import type { GameState, Line, PlayerId } from '../models/types';
import { gameBus } from '../events/bus';

/** 编译本体（无前置校验）：同时删除该线双方全部卡牌（"all" 效果，不触发任何文本/连锁），
 *  翻协议或抽对手牌库顶 1 张，并完成胜利判定。
 *  从 executeCompileUnchecked 提取（原逻辑原样迁移），供：
 *  - executeCompile/executeCompileUnchecked（正常编译路径，无 speed-2 前置触发时直接调用）
 *  - resolve.ts runStack 消费 pendingCompile（speed-2「通过编译删除此牌前」触发完成后的编译执行）
 *  保证两条路径的底层状态变更/事件完全一致。 */
export function executeCompileBody(s: GameState, player: PlayerId, line: Line): void {
  const p = s.players[player];
  const opp = s.players[player === 0 ? 1 : 0];
  const protocol = p.protocols[line];
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
  // 语义事件（编译清牌 FX 用）：双方该线卡牌 uid（各按堆叠顶→底顺序）与协议 defId
  gameBus.emit({
    type: 'line:compiled',
    state: s,
    payload: {
      player,
      line,
      protocolDefId: protocol.defId,
      ownUids: [...ownCards].reverse().map((c) => c.uid),
      oppUids: [...oppCards].reverse().map((c) => c.uid),
    },
  });
  if (protocol.compiled) {
    // 重新编译：抽对手牌库顶 1 张，所有权变更
    const card = opp.deck.pop();
    if (card) {
      card.owner = player;
      card.zone = 'hand';
      // 手牌 = 已知信息：牌库顶 → 手牌 同样解禁 secret（与 drawCards/return 一致）
      card.secret = false;
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
