import { pushLog } from '../log';
import type { GameState, Line, PlayerId } from '../models/types';
import { gameBus } from '../events/bus';
import { fireReactive } from '../effects/triggers';
import { shuffleTrashIntoDeck } from '../engine/deck';
import { stackValue } from '../state/create';
import { getProtocolDef } from '../../data/demo';
import { traceAt } from '../trace';

/** 编译本体（无前置校验）：同时删除该线双方全部卡牌（"all" 效果，不触发任何文本/连锁），
 *  翻协议或抽对手牌库顶 1 张，并完成胜利判定。
 *  从 executeCompileUnchecked 提取（原逻辑原样迁移），供：
 *  - executeCompile/executeCompileUnchecked（正常编译路径，无 speed-2 前置触发时直接调用）
 *  - resolve.ts runStack 消费 pendingCompile（speed-2「通过编译删除此牌前」触发完成后的编译执行）
 *  保证两条路径的底层状态变更/事件完全一致。
 *
 *  opts.force：跳过「重编译线值校验」（仅供开发者模式强制编译使用）。
 *  2026-09-12 用户规则确认：**重编译同样受编译条件约束**——对已编译线路再次编译时，
 *  仍须满足「本线 ≥10 点且高于对手」，否则本次不编译（日志说明原因）。 */
export function executeCompileBody(
  s: GameState,
  player: PlayerId,
  line: Line,
  opts?: { force?: boolean },
): void {
  const p = s.players[player];
  const oppId: PlayerId = player === 0 ? 1 : 0;
  const opp = s.players[oppId];
  const protocol = p.protocols[line];
  // 编译判定依据（用户 2026-09-12 反馈「12 vs 16 却编译了」）：规则书「若你在某条线路拥有
  // ≥10 的总数值，并且该线路你的数值高于对手」——在删卡前取双方线值，写进日志/事件/追踪，
  // 便于事后核对「谁编译、为什么够条件」，也让 UI 横幅能显示归属。
  const ownValue = stackValue(s, player, line);
  const oppValue = stackValue(s, oppId, line);
  const recompiled = protocol.compiled;
  let protoName = protocol.defId;
  try {
    protoName = getProtocolDef(protocol.defId).name;
  } catch {
    /* 未知 defId：退回 defId 文本 */
  }
  const meetsCondition = ownValue >= 10 && ownValue > oppValue;
  // 2026-09-12 用户规则：重编译同样需要「本线 ≥10 且高于对手」，否则不编译
  if (recompiled && !opts?.force && !meetsCondition) {
    pushLog(
      s,
      `P${player + 1} 重编译线 ${line + 1} 未满足编译条件（${protoName} ${ownValue} vs 对手 ${oppValue}）——本次不编译`,
    );
    traceAt(
      s,
      '规则',
      `重编译被拦下：P${player + 1} 线${line + 1}（${protoName}）${ownValue} vs 对手 ${oppValue}（需 ≥10 且 > 对手）`,
    );
    return;
  }
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
  pushLog(
    s,
    `P${player + 1} ${recompiled ? '重编译' : '编译'}线 ${line + 1}（${protoName} ${ownValue} vs 对手 ${oppValue}）`,
  );
  traceAt(
    s,
    '规则',
    `${recompiled ? '重编译' : '编译'}：P${player + 1} 线${line + 1}（${protoName} ${ownValue} vs 对手 ${oppValue}` +
      `${meetsCondition ? '，满足条件' : '，效果编译不校验线值'}）` +
      ` 删除双方 ${ownCards.length + oppCards.length} 张：己[${ownCards.map((c) => c.defId).join(' ')}]` +
      ` 敌[${oppCards.map((c) => c.defId).join(' ')}]`,
  );
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
      // 2026-09-12 追加：归属/依据（UI 编译横幅 + 事后核对）
      recompiled,
      ownValue,
      oppValue,
      protoName,
    },
  });
  if (recompiled) {
    // 重新编译：抽对手牌库顶 1 张，所有权变更（修改提示词 28/29：对手牌库为空 → 先将其弃牌堆
    // 洗入牌库再抽——与 drawCards 补牌规则一致）
    if (opp.deck.length === 0 && opp.trash.length > 0) shuffleTrashIntoDeck(s, oppId);
    const card = opp.deck.pop();
    if (card) {
      card.owner = player;
      card.zone = 'hand';
      // 手牌 = 已知信息：牌库顶 → 手牌 同样解禁 secret（与 drawCards/return 一致）
      card.secret = false;
      card.faceUp = true;
      p.hand.push(card);
      pushLog(s, `P${player + 1} 重编译夺取对手牌库顶1张`);
    }
  } else {
    protocol.compiled = true;
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


