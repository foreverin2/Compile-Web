import type { GameState, PlayerId, Line } from '../models/types';
import { getLineValue } from '../state/create';
import { executeCompileBody } from './compile-body';
import { resolveTrigger } from '../effects/triggers';
import { runStack } from '../effects/resolve';

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

/** 编译（无前置校验）：speed-2 顶命令「通过编译删除此牌前：平移此牌」先结算（该线双方正面
 *  speed-2 各自持有者选目标线平移，可挂起），全部完成后执行编译本体。
 *  供 executeCompile（先校验可编译条件）与开发者模式 Compile 指令（强制编译，无视
 *  线值是否 ≥10）共用——保证两条路径的底层状态变更/事件完全一致。 */
export function executeCompileUnchecked(s: GameState, player: PlayerId, line: Line): void {
  const opp: PlayerId = player === 0 ? 1 : 0;
  // 收集该线双方堆叠中正面 speed-2（顶命令，被覆盖仍生效；每张卡唯一 → 双方各至多一张）
  const speed2: { owner: PlayerId; cardUid: string }[] = [];
  for (const pid of [player, opp] as PlayerId[]) {
    for (const card of s.players[pid].stacks[line]) {
      if (card.defId === 'speed-2' && card.faceUp) speed2.push({ owner: pid, cardUid: card.uid });
    }
  }
  if (speed2.length > 0) {
    // 挂起编译：效果栈清空后由 runStack 消费 pendingCompile 执行编译本体（先于 pendingStepAdvance）
    s.pendingCompile = { player, line };
    for (const item of speed2) {
      // 持有者决定平移（规则 94「被作用卡持有者决定」）；resolveTrigger 设 player=card.owner
      resolveTrigger(s, { cardUid: item.cardUid, defId: 'speed-2', kind: 'before-compile', optional: false });
    }
    runStack(s); // 结算 speed-2 平移（可挂起选线 → 应答后继续 → 栈空消费 pendingCompile）
    return;
  }
  executeCompileBody(s, player, line);
}

/** 编译：同时删除该线双方全部卡牌（"all" 效果，不触发文本），翻协议或抽对手牌库顶 1 张 */
export function executeCompile(s: GameState, player: PlayerId, line: Line): void {
  if (!canCompileLine(s, player, line)) {
    throw new Error(`line ${line} does not meet compile requirements`);
  }
  executeCompileUnchecked(s, player, line);
}
