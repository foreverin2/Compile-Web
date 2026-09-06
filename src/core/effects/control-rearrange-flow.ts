import type { EffectStep, GameState, Line, PlayerId, StepResult } from '../models/types';
import { resetControlIfHeld } from '../rules/control';

/**
 * 控制组件重排流程（yield* 委托给效果生成器）：
 * 供【卡牌效果触发的刷新/编译】在正式执行本体前调用（主动 compile/refresh 动作的
 * 重排由 main.ts UI 模态处理；本流程服务效果栈内路径——love-2/spirit-0/assimilation-1
 * 效果刷新、war-1 强制对手刷新、unity-1 效果编译）。
 * 规则（规则文本「控制组件相关规则」/ FAQ 79/86/113-114）：执行编译或补满手牌时，
 * 执行者若持有控制组件 → 先归还中立，之后【可以】调整任意一名玩家的协议摆放顺序
 * （可多次交换，直到选择不重排）；即使不重排，组件也已归还。
 * - 未持有控制组件 → 直接返回（不归还也不弹选择）；
 * - chooser = 真正执行刷新/编译的玩家（love-2 等 = 效果属主；war-1 强制刷新 = 被刷新
 *   的对手）——选择权限与归还对象都对准执行者。
 */
export function* controlRearrangeFlow(
  s: GameState,
  chooser: PlayerId,
  verb: string,
): Generator<EffectStep, void, StepResult> {
  if (s.control !== chooser) return;
  resetControlIfHeld(s, chooser);
  const who = chooser === 0 ? 'P1' : 'P2';
  for (;;) {
    const menu = yield {
      kind: 'select-action',
      title: `${verb}：${who} 持有控制组件（已归还中立）——可重排一名玩家的协议`,
      min: 1,
      max: 1,
      optional: false,
      candidates: [],
      chooser,
      actions: ['action:不重排，继续', 'action:重排玩家1的协议', 'action:重排玩家2的协议'],
    };
    const sel = menu.selected[0];
    if (!sel || sel === 'action:不重排，继续') return;
    const side = (sel === 'action:重排玩家1的协议' ? 0 : 1) as PlayerId;
    const first = yield {
      kind: 'select-line',
      title: `${verb}：重排玩家${side + 1}的协议——选择要交换的第1个位置`,
      min: 1,
      max: 1,
      optional: false,
      candidates: [],
      lines: [0, 1, 2],
      chooser,
    };
    if (first.selected.length === 0) return; // fizzle 兜底
    const a = Number(first.selected[0].replace('line:', '')) as Line;
    const second = yield {
      kind: 'select-line',
      title: `${verb}：选择要交换的第2个位置`,
      min: 1,
      max: 1,
      optional: false,
      candidates: [],
      lines: ([0, 1, 2] as Line[]).filter((l) => l !== a),
      chooser,
    };
    if (second.selected.length === 0) return; // fizzle 兜底
    const b = Number(second.selected[0].replace('line:', '')) as Line;
    // 执行交换（executeOp rearrangeProtocols：log/状态/协议换位动画事件）——完成后回到
    // 菜单，玩家可继续重排（换侧或同侧再换）直到选择「不重排，继续」
    yield { op: 'rearrangeProtocols', a, b, player: side };
  }
}
