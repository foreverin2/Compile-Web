import type { ChoiceCard, EffectCtx, EffectStep, GameState, Line, PlayerId, StepResult } from '../../models/types';
import { registerCardEffects } from '../registry';
import { getCardDef } from '../../../data/demo';

/**
 * 3代 惰性 inertia（关键词：翻转/弃牌/反面打出/禁用指令；座右铭：寂然不动）。
 * 权威卡文：src/data/cards3.ts（compile3文本.txt）；裁决：docs/3代-批3-规格与裁决清单.md
 * （C6 惰性2 按印刷值最高含被盖；C7 区域禁用全禁——inertia-0 顶禁顶 / inertia-1 底禁底为纯引擎守卫
 *  （context.lineTopCommandsDisabled / lineBottomCommandsDisabled + 各收集/结算/常驻查询接线），本文件
 *  无注册；C8 手牌逐链选卡；C9 弃牌库单次批量）。
 */

function opp(p: PlayerId): PlayerId {
  return p === 0 ? 1 : 0;
}

function pv(defId: string): number {
  return getCardDef(defId).value;
}

/** 某线双方堆叠全部 faceUp 卡（含被盖，B2）快照 */
function faceUpInLine(s: GameState, line: Line, excludeUid?: string): ChoiceCard[] {
  const out: ChoiceCard[] = [];
  for (const owner of [0, 1] as PlayerId[]) {
    const stack = s.players[owner].stacks[line];
    for (let i = 0; i < stack.length; i++) {
      const c = stack[i];
      if (c.faceUp && c.uid !== excludeUid) {
        out.push({ uid: c.uid, defId: c.defId, faceUp: true, owner, zone: 'field' as const, line, pos: c.pos, label: String(pv(c.defId)) });
      }
    }
  }
  return out;
}

/** inertia-0 中：翻转另1条链路中1张被覆盖或未被覆盖的正面朝上的牌。
 *  非本线选一条线（2 选 1）→ 该线任意 faceUp 卡（含被盖）选 1 → flip（被盖 allowCovered）。 */
function* inertia0Middle(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const mine = ctx.card.line;
  const otherLines = ([0, 1, 2] as Line[]).filter((l) => l !== mine);
  const lAns = yield {
    kind: 'select-line', title: 'inertia-0：翻转另1条链路中的牌——选择链路', min: 1, max: 1, optional: false,
    candidates: [], lines: otherLines,
  };
  if (lAns.selected.length === 0) return;
  const line = Number(lAns.selected[0].replace('line:', '')) as Line;
  const cand = faceUpInLine(ctx.s, line);
  if (cand.length === 0) return;
  const ans = yield { kind: 'select', title: 'inertia-0：翻转这张正面朝上的牌', min: 1, max: 1, optional: false, candidates: cand };
  if (ans.selected.length === 0) return;
  yield { op: 'flip', uid: ans.selected[0], allowCovered: true };
}

/** inertia-1 中：对手弃2张牌（尽力而为）。 */
function* inertia1Middle(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const foe = opp(ctx.player);
  const hand = ctx.candidates({ zone: 'hand', owner: foe });
  if (hand.length === 0) return;
  const n = Math.min(2, hand.length);
  const ans = yield { kind: 'select', title: `inertia-1：对手弃${n}张牌`, min: n, max: n, optional: false, candidates: hand, chooser: foe };
  if (ans.selected.length > 0) yield { op: 'discardMany', uids: ans.selected };
}

/** inertia-2 中：翻转1条链路中所有阈值最高的正面朝上的牌。
 *  目标线拥有者选 → 该线印刷值最高（并列全部）的 faceUp 卡（含被盖，C6）快照逐张翻面。 */
function* inertia2Middle(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const lAns = yield {
    kind: 'select-line', title: 'inertia-2：选择1条链路', min: 1, max: 1, optional: false, candidates: [], lines: [0, 1, 2],
  };
  if (lAns.selected.length === 0) return;
  const line = Number(lAns.selected[0].replace('line:', '')) as Line;
  const faceUp = faceUpInLine(ctx.s, line, ctx.card.uid);
  if (faceUp.length === 0) return;
  const maxV = Math.max(...faceUp.map((c) => pv(c.defId)));
  const targets = faceUp.filter((c) => pv(c.defId) === maxV);
  for (const t of targets) yield { op: 'flip', uid: t.uid, allowCovered: true };
}

/** inertia-3 中：在每条其他链路中反面打出1张牌。对手在此链路中反面打出1张牌。
 *  非本线两线：自己从手牌逐链选 1 张反面打出（落己方该线堆叠，C8）；然后对手在本线从手牌反打 1
 *  （强制，手牌空 fizzle）。 */
function* inertia3Middle(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const mine = ctx.card.line;
  const otherLines = ([0, 1, 2] as Line[]).filter((l) => l !== mine);
  for (const line of otherLines) {
    const hand = ctx.candidates({ zone: 'hand', owner: ctx.player });
    if (hand.length === 0) break; // 手牌空 → 后续线也打不了
    const ans = yield { kind: 'select', title: `inertia-3：在链路 ${line + 1} 反面打出1张牌`, min: 1, max: 1, optional: false, candidates: hand };
    if (ans.selected.length === 0) break;
    yield { op: 'playFromHand', uid: ans.selected[0], line, faceUp: false };
  }
  if (mine === null) return;
  const foe = opp(ctx.player);
  const foeHand = ctx.candidates({ zone: 'hand', owner: foe });
  if (foeHand.length === 0) return;
  const pAns = yield {
    kind: 'select', title: 'inertia-3：对手在此链路反面打出1张牌', min: 1, max: 1, optional: false, candidates: foeHand, chooser: foe,
  };
  if (pAns.selected.length > 0) yield { op: 'playFromHand', uid: pAns.selected[0], line: mine, faceUp: false };
}

/** inertia-4 中：弃置你的牌库。对手弃置其牌库。（C9 单次批量——discardWholeDeck op） */
function* inertia4Middle(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  yield { op: 'discardWholeDeck' };
  yield { op: 'discardWholeDeck', player: opp(ctx.player) };
}

/** inertia-5 中：弃1张牌。 */
function* inertia5Middle(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const hand = ctx.candidates({ zone: 'hand', owner: ctx.player });
  const ans = yield { kind: 'select', title: 'inertia-5：弃1张牌', min: 1, max: 1, optional: false, candidates: hand };
  if (ans.selected.length > 0) yield { op: 'discard', uid: ans.selected[0] };
}

registerCardEffects('inertia-0', { middle: inertia0Middle });
registerCardEffects('inertia-1', { middle: inertia1Middle });
registerCardEffects('inertia-2', { middle: inertia2Middle });
registerCardEffects('inertia-3', { middle: inertia3Middle });
registerCardEffects('inertia-4', { middle: inertia4Middle });
registerCardEffects('inertia-5', { middle: inertia5Middle });
