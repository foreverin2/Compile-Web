import type { GameState, Line, PlayerId } from '../models/types';
import { lineTopCommandActive } from '../state/create';
import { isUncovered, cardCommandDisabled } from '../effects/context';

function opp(player: PlayerId): PlayerId {
  return player === 0 ? 1 : 0;
}

/** 顶命令常驻（规则 90 行）：player 任一线链路有正面该卡即 true（被盖也生效——只查在场+正面，不看是否未覆盖；
 *  3代 inertia-0 区域禁顶 → 该卡顶命令失效不算，C7） */
export function playerHasTopCommand(s: GameState, player: PlayerId, defId: string): boolean {
  for (const line of [0, 1, 2] as Line[]) {
    if (s.players[player].stacks[line].some((c) => c.defId === defId && c.faceUp && !cardCommandDisabled(s, c, 'top'))) {
      return true;
    }
  }
  return false;
}

/** 底命令仅未覆盖生效（规则 79 行）：player 任一线链路【顶卡】正面该卡（isUncovered 判定顶卡；
 *  3代 inertia-1 区域禁底 → 该卡底命令失效不算，C7） */
export function playerHasActiveBottom(s: GameState, player: PlayerId, defId: string): boolean {
  for (const line of [0, 1, 2] as Line[]) {
    const stack = s.players[player].stacks[line];
    const top = stack[stack.length - 1];
    if (top && top.defId === defId && top.faceUp && isUncovered(s, top) && !cardCommandDisabled(s, top, 'bottom')) {
      return true;
    }
  }
  return false;
}

/** 对手该线链路有正面该卡（含被盖；区域禁顶感知） */
export function opponentLineHasTop(s: GameState, line: Line, player: PlayerId, defId: string): boolean {
  return s.players[opp(player)].stacks[line].some((c) => c.defId === defId && c.faceUp && !cardCommandDisabled(s, c, 'top'));
}

/** 对手该线链路【顶卡】正面该卡（区域禁底感知） */
export function opponentLineHasActiveBottom(s: GameState, line: Line, player: PlayerId, defId: string): boolean {
  const stack = s.players[opp(player)].stacks[line];
  const top = stack[stack.length - 1];
  return !!top && top.defId === defId && top.faceUp && isUncovered(s, top) && !cardCommandDisabled(s, top, 'bottom');
}

// —— 协议语义封装（defId 常量写在函数内，语义注释标明协议）——

/** spirit-1 顶「你可以在任意列打出牌」——拍板：全局 */
export function canPlayFaceUpAnywhere(s: GameState, player: PlayerId): boolean {
  return playerHasTopCommand(s, player, 'spirit-1');
}

/** psychic-1 顶「你的对手只能以反面打出牌」——拍板：全局（对手所有线只能反面打） */
export function opponentMustPlayFaceDown(s: GameState, player: PlayerId): boolean {
  return playerHasTopCommand(s, opp(player), 'psychic-1');
}

/** plague-0 底「对手无法在此列打出牌」（正反都禁，仅未覆盖时） */
export function lineBlocksOpponent(s: GameState, line: Line, player: PlayerId): boolean {
  return opponentLineHasActiveBottom(s, line, player, 'plague-0');
}

/** metal-2 顶「对手不能在此列以反面打出牌」 */
export function lineBlocksOpponentFaceDown(s: GameState, line: Line, player: PlayerId): boolean {
  return opponentLineHasTop(s, line, player, 'metal-2');
}

/** spirit-0 底「跳过检查缓存阶段」 */
export function shouldSkipCacheCheck(s: GameState, player: PlayerId): boolean {
  return playerHasActiveBottom(s, player, 'spirit-0');
}

/** apathy-2 顶「无效化此列所有牌的中部命令」——拍板：该线双方全部牌（含被盖） */
export function lineMiddleCommandsNullified(s: GameState, line: Line): boolean {
  return lineTopCommandActive(s, line, 'apathy-2');
}

/** 单卡自引用放行（2代 chaos-3/corruption-0 底「此牌可以无视协议限制打在任意链路中」）：
 *  该卡从手牌正面打出时豁免「协议匹配」限制（其余被动限制——psychic-1 禁正面/plague-0 禁线/
 *  metal-2 禁反面——照常生效，用户 2026-09-05 裁决 [Q15] 与批2 同款沿用） */
export function cardAllowsFaceUpAnyLine(defId: string): boolean {
  return defId === 'chaos-3' || defId === 'corruption-0';
}

/** 修改提示词 15：corruption-0 底「此牌可以打在任意一方的任意协议处」（腐化0 特有能力）：
 *  从手牌打出时可选择落在【对方】的链路（真落对方场 = 易主对方、进对方场地数据，
 *  用户 2026-09 拍板同批3 assimilation-2/6 deckTopTransfer 语义）；chaos-3 仍只能打自己场
 *  （其文本为「任意链路」非「任意一方」） */
export function cardCanPlayToOpponentSide(defId: string): boolean {
  return defId === 'corruption-0';
}

/** ice-6 顶「如果你有手牌，那么你不可以抽牌」：player 手牌 >0 且其场上任一线链路有正面 ice-6
 *  （顶命令，被盖仍生效——查在场+正面）→ 禁止一切抽牌路径（效果 draw/刷新/fromOpponentDeck/
 *  drawFromDeck；FAQ 冰6：刷新想抽必须能抽上牌，抽 0 无效）。手牌=0 时不拦截。 */
export function shouldBlockDraw(s: GameState, player: PlayerId): boolean {
  if (s.players[player].hand.length === 0) return false;
  return playerHasTopCommand(s, player, 'ice-6');
}

/** fear-0 顶「在你的回合内，对手无法触发中央效果」：player（要结算中指令的人）的对手场上有正面
 *  fear-0（顶命令被盖仍生效）且当前回合玩家 = 该对手（fear-0 拥有者的回合）→ 中指令不结算
 *  （含翻正/揭开连锁，裁决批2-Q5 A）。 */
export function opponentBlocksMiddleCommands(s: GameState, player: PlayerId): boolean {
  const foe = opp(player);
  if (s.turnPlayer !== foe) return false;
  return playerHasTopCommand(s, foe, 'fear-0');
}

/** unity-1 底「统一卡牌可以正面朝上打在此链路」（批3）：查双方所有线链路顶卡（未覆盖 faceUp）unity-1
 *  → 返回该线；unity 协议卡正面可落此线（无视协议匹配）。3代 inertia-1 禁底 → 底命令失效不算（C7）。 */
export function unity1UncoveredLine(s: GameState): Line | null {
  for (const owner of [0, 1] as PlayerId[]) {
    for (const line of [0, 1, 2] as Line[]) {
      const stack = s.players[owner].stacks[line];
      const top = stack[stack.length - 1];
      if (top && top.defId === 'unity-1' && top.faceUp && isUncovered(s, top) && !cardCommandDisabled(s, top, 'bottom')) {
        return line;
      }
    }
  }
  return null;
}

/** 3代 lust-0 底「若你拥有控制权，对手无法编译」：player 的对手侧任一【顶卡】（未覆盖 faceUp）
 *  lust-0 存在且该 lust-0 拥有者（对手）持有控制组件 → player 不可【行动】编译
 *  （只禁行动编译 check-compile；卡牌效果触发的编译——贪婪1/统一1 等走 executeCompileBody——
 *  照常执行，裁决 RQ4-A；底命令仅未覆盖生效；inertia-1 禁底 → 失效）。 */
export function opponentCompileBlockedByControl(s: GameState, player: PlayerId): boolean {
  const foe = opp(player);
  for (const line of [0, 1, 2] as Line[]) {
    const stack = s.players[foe].stacks[line];
    const top = stack[stack.length - 1];
    if (
      top && top.defId === 'lust-0' && top.faceUp && isUncovered(s, top) &&
      !cardCommandDisabled(s, top, 'bottom') && s.control === foe
    ) {
      return true;
    }
  }
  return false;
}

/** 3代 lust-2 底「你的牌可以无视协议限制打在此链路中」：player 自己侧 line 链路【顶卡】有
 *  faceUp lust-2（底命令仅未覆盖生效；inertia-1 禁底 → 失效）→ player 正面打出任意协议牌到此链路。 */
export function lineAllowsFaceUpIgnoringProtocol(s: GameState, line: Line, player: PlayerId): boolean {
  const stack = s.players[player].stacks[line];
  const top = stack[stack.length - 1];
  return !!top && top.defId === 'lust-2' && top.faceUp && isUncovered(s, top) && !cardCommandDisabled(s, top, 'bottom');
}

