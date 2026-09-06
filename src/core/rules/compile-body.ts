import { pushLog } from '../log';
import type { GameState, Line, PlayerId } from '../models/types';
import { gameBus } from '../events/bus';
import { fireReactive } from '../effects/triggers';
import { shuffleTrashIntoDeck } from '../engine/deck';

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
  // 同时删除：双方该线链路全部入各自 trash
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
  pushLog(s, `P${player + 1} compiles line ${line + 1}`);
  // 语义事件（编译清牌 FX 用）：双方该线卡牌 uid（各按链路顶→底顺序）与协议 defId
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
    // 重新编译：抽对手牌库顶 1 张，所有权变更（修改提示词 28/29：对手牌库为空 → 先将其弃牌堆
    // 洗入牌库再抽——与 drawCards 补牌规则一致）
    if (opp.deck.length === 0 && opp.trash.length > 0) shuffleTrashIntoDeck(s, player === 0 ? 1 : 0);
    const card = opp.deck.pop();
    if (card) {
      card.owner = player;
      card.zone = 'hand';
      // 手牌 = 已知信息：牌库顶 → 手牌 同样解禁 secret（与 drawCards/return 一致）
      card.secret = false;
      card.faceUp = true;
      p.hand.push(card);
      pushLog(s, `P${player + 1} recompiles and steals a card`);
    }
  } else {
    protocol.compiled = true;
    pushLog(s, `Protocol "${protocol.defId}" compiled`);
  }

  s.compiledThisTurn = true;

  // 批2 war-2 底「当对手编译后：对手弃置所有手牌」：编译者【对手】侧注册 after-compile 的顶卡触发
  fireReactive(s, 'after-compile', player);
  // 3代（2026-09）：傲慢0 顶「当你编译后：刷新」（编译者自己侧）；
  // 动量1/6 顶「当任意玩家编译后」（双方，批3 注册）
  fireReactive(s, 'after-self-compile', player);
  fireReactive(s, 'after-any-compile', player);

  // 胜利判定
  if (p.protocols.every((pr) => pr.compiled)) {
    s.winner = player;
    s.phase = 'gameover';
    pushLog(s, `P${player + 1} wins!`);
  }
}


