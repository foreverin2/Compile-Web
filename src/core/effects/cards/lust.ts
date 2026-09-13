import type { EffectCtx, EffectStep, GameState, Line, PlayerId, StepResult } from '../../models/types';
import { registerCardEffects } from '../registry';
import { setControl } from '../../rules/control';
import { traceAt, cardBrief } from '../../trace';
import { findCard } from '../context';

/**
 * 3代 色欲 lust（关键词：控制权/揭示/偏转/反面打出；座右铭：惑乱人心）。
 * 权威卡文：src/data/cards3.ts（compile3文本.txt）；裁决：docs/3代-批1-规格与裁决清单.md
 * （RQ1-A 色欲3 随机揭示牌由拥有者选线反打 / RQ4-A 色欲0 底只禁行动编译（restrictions）/
 *  RQ6-A 色欲6 对手手牌自选反打落己侧 / RQ8 控制权统一 setControl + after-opponent-gain-control）。
 * 色欲0 底禁编译守卫与色欲2 底放行守卫在 rules/restrictions.ts + compile.ts canCompileLine +
 * actions/base isPlayableFaceUp（常驻无 gen）。控制权变更无「可以」= 必做（总则）。
 */

function opp(p: PlayerId): PlayerId {
  return p === 0 ? 1 : 0;
}

/** lust-0 顶（valueModifier line）：每位玩家在此链路的总阈值增加10。 */
function lust0Modifier(_s: GameState, _owner: PlayerId, _line: Line, total: number): number {
  return total + 10;
}

/** lust-0 中：获得控制权。（无「可以」→ 必得：中立→持有 / 对手持有→夺取 / 已持有→无变化） */
function* lust0Middle(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  setControl(ctx.s, ctx.player, 'effect', ctx.card.defId);
}

/** lust-2 中：你可以将对手1张被覆盖的牌偏转到此链路（选对手任一被盖卡 → shift 到 lust-2 所在线）。
 *  2026-09-13 修复（fuzz 发现「must shift to a different line」崩溃）：**排除已经在该线的对手被盖卡**
 *  ——把它"偏转到此链路"等于原地不动，引擎会因 targetLine === 原线而抛错。 */
function* lust2Middle(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const line = ctx.card.line;
  if (line === null) return;
  const covered = ctx
    .candidates({ zone: 'field', owner: opp(ctx.player), covered: true })
    .filter((c) => c.line !== line);
  if (covered.length === 0) return;
  const ans = yield { kind: 'select', title: 'lust-2：你可以将对手1张被覆盖的牌偏转到此链路', min: 1, max: 1, optional: true, candidates: covered };
  if (ans.selected.length > 0) yield { op: 'shift', uid: ans.selected[0], targetLine: line, allowCovered: true };
}

/** lust-3 中：对手随机揭示手牌中的1张牌。将那张牌反面打出在对手一侧。
 *  真随机（love-3/运气3 先例）取对手手牌 1 张 → reveal（幽灵给对方看）→ 拥有者选线（RQ1-A）
 *  → 该牌反面（faceDown）落【对手自己】的该线链路（playFromHand 不变主）。手牌空 → fizzle。 */
function* lust3Middle(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const foe = opp(ctx.player);
  const foeHand = ctx.candidates({ zone: 'hand', owner: foe });
  if (foeHand.length === 0) return;
  const pick = foeHand[Math.floor(Math.random() * foeHand.length)];
  const pickCard = findCard(ctx.s, pick.uid);
  traceAt(
    ctx.s,
    '随机',
    `lust-3 随机揭示对手手牌：${pickCard ? cardBrief(pickCard) : pick.uid}（对手手牌 ${foeHand.length} 张）`,
  );
  yield { op: 'reveal', uid: pick.uid };
  const lAns = yield {
    kind: 'select-line', title: 'lust-3：将随机揭示的那张牌反面打出在对手的哪一侧', min: 1, max: 1, optional: false,
    candidates: [], lines: [0, 1, 2],
  };
  if (lAns.selected.length === 0) return;
  const line = Number(lAns.selected[0].replace('line:', '')) as Line;
  yield { op: 'playFromHand', uid: pick.uid, line, faceUp: false };
}

/** lust-3 底（end，无 top 仅顶卡）：结束：你可以失去控制权。若你这么做，翻转1张牌。
 *  未持有控制权 → 无可失去 → 整句 fizzle；持有 → 可选失去（setControl 中立）→ 若失 → 翻 1。 */
function* lust3End(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  if (ctx.s.control !== ctx.player) return;
  const act = yield {
    kind: 'select-action', title: 'lust-3（结束）：你可以失去控制权', min: 1, max: 1, optional: true, candidates: [],
    actions: ['action:失去控制权'],
  };
  if (act.selected.length === 0) return; // 跳过
  setControl(ctx.s, -1, 'effect', ctx.card.defId);
  const cand = ctx.candidates({ zone: 'field' });
  const fAns = yield { kind: 'select', title: 'lust-3：若你这么做，翻转1张牌', min: 1, max: 1, optional: false, candidates: cand };
  if (fAns.selected.length > 0) yield { op: 'flip', uid: fAns.selected[0] };
}

/** lust-4 中：揭示你的手牌。对手失去控制权。
 *  逐张 reveal 自己全部手牌（Case A 幽灵给对方，clarity-1 同款）→ 对手持有则强制失去（回中立）。 */
function* lust4Middle(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const myHand = [...ctx.s.players[ctx.player].hand];
  for (const card of myHand) yield { op: 'reveal', uid: card.uid };
  const foe = opp(ctx.player);
  if (ctx.s.control === foe) setControl(ctx.s, -1, 'effect', ctx.card.defId);
}

/** lust-4 底（after-opponent-gain-control，无 top 仅顶卡）：当对手获得控制权后：抽1张牌。 */
function* lust4AfterOppGain(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  yield { op: 'draw', count: 1 };
}

/** lust-5 中：弃1张牌。 */
function* lust5Middle(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const hand = ctx.candidates({ zone: 'hand', owner: ctx.player });
  const ans = yield { kind: 'select', title: 'lust-5：弃1张牌', min: 1, max: 1, optional: false, candidates: hand };
  if (ans.selected.length > 0) yield { op: 'discard', uid: ans.selected[0] };
}

/** lust-6 中：弃1张牌。对手在此链路反面打出1张牌。
 *  第二句（裁决 RQ6-A）：对手从手牌自选 1 张反面打出到 lust-6 所在线（落对手自己链路）；
 *  无「可以」→ 强制（手牌空 fizzle）。选卡者 = 对手（chooser）。 */
function* lust6Middle(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const hand = ctx.candidates({ zone: 'hand', owner: ctx.player });
  const dAns = yield { kind: 'select', title: 'lust-6：弃1张牌', min: 1, max: 1, optional: false, candidates: hand };
  if (dAns.selected.length > 0) yield { op: 'discard', uid: dAns.selected[0] };
  const line = ctx.card.line;
  if (line === null) return;
  const foe = opp(ctx.player);
  const foeHand = ctx.candidates({ zone: 'hand', owner: foe });
  if (foeHand.length === 0) return;
  const pAns = yield {
    kind: 'select', title: 'lust-6：对手在此链路反面打出1张牌', min: 1, max: 1, optional: false, candidates: foeHand, chooser: foe,
  };
  if (pAns.selected.length > 0) yield { op: 'playFromHand', uid: pAns.selected[0], line, faceUp: false };
}

registerCardEffects('lust-0', {
  middle: lust0Middle,
  valueModifier: { target: 'line', apply: lust0Modifier },
  // lust-0 底「若你拥有控制权，对手无法编译」：常驻守卫见 restrictions.opponentCompileBlockedByControl
});
registerCardEffects('lust-2', { middle: lust2Middle });
registerCardEffects('lust-3', {
  middle: lust3Middle,
  triggers: {
    end: {
      fn: lust3End,
      optional: false, // 「可以失去」的跳过由效果内 select-action 表达；未持有控制权时整句 fizzle
      // 自动判定：未持有控制权 → 无可失去 → 收集前自动跳过不弹按钮（同 wrath-1 语义）
      cond: (s, card) => s.control === card.owner,
    },
  },
});
registerCardEffects('lust-4', {
  middle: lust4Middle,
  triggers: { 'after-opponent-gain-control': { fn: lust4AfterOppGain, optional: false } },
});
registerCardEffects('lust-5', { middle: lust5Middle });
registerCardEffects('lust-6', { middle: lust6Middle });

