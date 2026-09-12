import { pushLog } from '../log';
import type { GameState, PlayerId, Line } from '../models/types';
import { getLineValue } from '../state/create';
import { fireReactive } from '../effects/triggers';
import { gameBus } from '../events/bus';

/** 控制权统一变更点：s.control 的一切变化（控制阶段判定/卡牌效果获得-失去/归还中立）必须经此函数。
 *  某玩家（0/1）成为持有者 → 其【对手侧】注册 after-opponent-gain-control 的顶卡触发
 *  （3代 色欲4 底/傲慢6 顶「当对手获得控制权后」）；回中立（-1）不产生「获得」事件。
 *  事件只 push，由调用方 runStack（效果上下文在 runStack 循环内自然结算）。 */
export function setControl(s: GameState, holder: PlayerId | -1, reason = 'effect'): void {
  if (s.control === holder) return;
  const from = s.control;
  s.control = holder;
  // 3代 特效（批次 D）：控制权变更语义事件——UI 据此播"获得（牵引链拉来）/ 失去（链断）/ 归还中立"。
  // reason：'check'（控制阶段判定）/ 'compile'（编译归还）/ 'refresh'（补满手牌归还）/ 'effect'（卡牌效果）
  gameBus.emit({ type: 'control:changed', state: s, payload: { from, to: holder, reason } });
  if (holder === 0 || holder === 1) {
    fireReactive(s, 'after-opponent-gain-control', holder);
  }
}

/** 控制权判定：在 check-control 步骤（每回合行动玩家 start 后）调用。
 *  权威规则（游戏规则说明书「规则文本」控制权判定 / FAQ「控制组件」）：
 *  只检查【当前行动玩家】自己——他在至少 2 条线路上的总值高于对手 → 获得控制组件
 *  （从中立位置或从另一名玩家处夺取）；不满足 → 保持现状绝不动。
 *  控制权不会因持有者落后被"点差"自动夺走；失权只有三条路：
 *   ① 持有者自己编译/补满手牌（归还中立，见 resetControlIfHeld）；
 *   ② 对手在其【自己回合】的控制阶段满足条件时夺取；
 *   ③ 卡牌效果（3代 获得/失去控制权）。
 *  ——2026-09 规则化：旧实现双方对称 re-evaluate（谁 ≥2 线领先谁持），与规则不符。 */
export function checkControl(s: GameState): void {
  const p = s.turnPlayer; // 当前行动玩家
  const foe: PlayerId = p === 0 ? 1 : 0;
  let wins = 0;
  const leading: Line[] = [];
  for (const line of [0, 1, 2] as Line[]) {
    if (getLineValue(s, p, line) > getLineValue(s, foe, line)) {
      wins++;
      leading.push(line);
    }
  }
  // 3代 特效（批次 D）：判定阶段事件（无论是否获得都要发——Q5 要求"判定失败"也有可见反馈：
  // 三条线对比条扫描后若未满足，整体暗下 + 轻微抖动）
  gameBus.emit({ type: 'rule:control-check', state: s, payload: { player: p, wins, leading, gained: wins >= 2 && s.control !== p } });
  if (wins >= 2 && s.control !== p) {
    pushLog(s, `P${p + 1} 控制阶段：${wins} 条线总值高于对手 → 获得控制组件`);
    setControl(s, p, 'check'); // 统一变更点：触发 after-opponent-gain-control（3代）
  }
  // 不满足 → 保持现状（中立或当前持有者继续持有）
}

/** 控制组件归还中立：编译或补满手牌时，若【该玩家】持有控制组件 → 归还中立（规则文本
 *  「控制组件相关规则」/ FAQ 79/113-114：即使选择不重排协议，组件仍会归还）。
 *  返回是否真的归还了（供调用方判断是否需要给出重排机会）。 */
export function resetControlIfHeld(s: GameState, player: PlayerId): boolean {
  if (s.control === player) {
    setControl(s, -1, 'return');
    pushLog(s, `P${player + 1} 归还控制组件至中立（编译/补满手牌）`);
    return true;
  }
  return false;
}

