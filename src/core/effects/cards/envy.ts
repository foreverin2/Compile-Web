import type { EffectCtx, EffectStep, GameState, Line, PlayerId, StepResult } from '../../models/types';
import { registerCardEffects } from '../registry';
import { deckTopAvailable } from '../context';
import { cardPointValue } from '../../state/create';
import { setControl } from '../../rules/control';

/**
 * 3代 嫉妒 envy（关键词：对比总阈值/翻转/抽牌；座右铭：据为己有）。
 * 权威卡文：src/data/cards3.ts（compile3文本.txt）；裁决：docs/3代-批1-规格与裁决清单.md
 * （RQ1-8 全部按推荐：回手任意场牌回其主、控制权无「可以」=必做、after-opponent-gain-control 等）。
 */

function opp(p: PlayerId): PlayerId {
  return p === 0 ? 1 : 0;
}

/** envy-0 顶（valueModifier line）：此链路中，你的总阈值增加对手在此链路中最高阈值卡牌的阈值。
 *  对手该链链路全部卡（含被盖，faceUp/faceDown 均按当前点数值计）取最大者；无卡 → +0。 */
function envy0Modifier(s: GameState, owner: PlayerId, line: Line, total: number): number {
  const foe = opp(owner);
  let max = 0;
  for (const c of s.players[foe].stacks[line]) {
    const v = cardPointValue(s, c);
    if (v > max) max = v;
  }
  return total + max;
}

/** envy-1 中：若对手拥有控制权，你可以翻转1张牌。 */
function* envy1Middle(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  if (ctx.s.control !== opp(ctx.player)) return; // 条件不满足 → 整句无效果
  const targets = ctx.candidates({ zone: 'field' }); // 场上未覆盖顶卡（双方，源卡自动排除）
  const ans = yield { kind: 'select', title: 'envy-1：对手拥有控制权——你可以翻转1张牌', min: 1, max: 1, optional: true, candidates: targets };
  if (ans.selected.length > 0) yield { op: 'flip', uid: ans.selected[0] };
}

/** envy-1 底（start，无 top 仅顶卡）：开始：若对手拥有控制权，获得控制权。
 *  无「可以」→ 条件成立必须获得（从对手处夺取；setControl 统一变更点发 after-opponent-gain-control 事件）。 */
function* envy1Start(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  if (ctx.s.control === opp(ctx.player)) setControl(ctx.s, ctx.player);
}

/** envy-2 中：抽取等同于对手手牌数量的牌。 */
function* envy2Middle(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const n = ctx.s.players[opp(ctx.player)].hand.length;
  if (n > 0) yield { op: 'draw', count: n };
}

/** envy-3 底（after-play 定向，无 top 仅顶卡）：当对手在此链路打出1张牌后：
 *  从你的牌库顶端反面打出1张牌到此链路（同 ice-1 接线：对手在本线落地 → 本线己方链路顶卡触发）。
 *  落点 = envy-3 所在线（己方链路）；牌库顶反打不洗牌（FAQ 142），牌库空 → fizzle。 */
function* envy3AfterPlay(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const line = ctx.card.line;
  if (line === null || !deckTopAvailable(ctx.s, ctx.player)) return;
  yield { op: 'playTopDeck', line, faceUp: false };
}

/** envy-4 中：若对手已编译的协议比你多，翻转1张牌。（无「可以」→ 条件满足必须翻；无目标 fizzle） */
function* envy4Middle(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const meP = ctx.s.players[ctx.player].protocols;
  const foeP = ctx.s.players[opp(ctx.player)].protocols;
  const meC = meP.filter((p) => p.compiled).length;
  const foeC = foeP.filter((p) => p.compiled).length;
  if (foeC <= meC) return;
  const targets = ctx.candidates({ zone: 'field' });
  const ans = yield { kind: 'select', title: 'envy-4：对手已编译的协议更多——翻转1张牌', min: 1, max: 1, optional: false, candidates: targets };
  if (ans.selected.length > 0) yield { op: 'flip', uid: ans.selected[0] };
}

/** envy-5 中：弃1张牌。 */
function* envy5Middle(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const hand = ctx.candidates({ zone: 'hand', owner: ctx.player });
  const ans = yield { kind: 'select', title: 'envy-5：弃1张牌', min: 1, max: 1, optional: false, candidates: hand };
  if (ans.selected.length > 0) yield { op: 'discard', uid: ans.selected[0] };
}

registerCardEffects('envy-0', { valueModifier: { target: 'line', apply: envy0Modifier } });
registerCardEffects('envy-1', {
  middle: envy1Middle,
  triggers: { start: { fn: envy1Start, optional: false } }, // 底命令：仅未覆盖顶卡
});
registerCardEffects('envy-2', { middle: envy2Middle });
registerCardEffects('envy-3', { triggers: { 'after-play': { fn: envy3AfterPlay, optional: false } } });
registerCardEffects('envy-4', { middle: envy4Middle });
registerCardEffects('envy-5', { middle: envy5Middle });

