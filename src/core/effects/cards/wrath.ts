import type { ChoiceCard, EffectCtx, EffectStep, GameState, Line, PlayerId, StepResult } from '../../models/types';
import { registerCardEffects } from '../registry';
import { deckTopAvailable } from '../context';
import { cardPointValue } from '../../state/create';
import { setControl } from '../../rules/control';

/**
 * 3代 愤怒 wrath（关键词：翻转/删除/控制权/抽牌；座右铭：睚眦必报）。
 * 权威卡文：src/data/cards3.ts（compile3文本.txt）；裁决：docs/3代-批2-规格与裁决清单.md
 * （B2 含被盖的「所有正面朝上的牌」；B3 失去控制权必做——持有必失、后句随失去执行、未持有整句 fizzle；
 *  B10 卡数并列拥有者选）。
 */

function opp(p: PlayerId): PlayerId {
  return p === 0 ? 1 : 0;
}

/** 该线（双方链路）全部卡的当前点数值列表 */
function linePoints(s: GameState, line: Line): number[] {
  const out: number[] = [];
  for (const owner of [0, 1] as PlayerId[]) {
    for (const c of s.players[owner].stacks[line]) out.push(cardPointValue(s, c));
  }
  return out;
}

/** wrath-0 顶（valueModifier line）：此链路中所有最高阈值的牌不计入玩家的总阈值。
 *  全链最大点数值 M：估值方（owner）链路中点数值 == M 的牌从该玩家 total 扣除（含被盖/反面；多张同 M 全扣）。 */
function wrath0Modifier(s: GameState, owner: PlayerId, line: Line, total: number): number {
  const pts = linePoints(s, line);
  if (pts.length === 0) return total;
  const max = Math.max(...pts);
  let deduct = 0;
  for (const c of s.players[owner].stacks[line]) {
    if (cardPointValue(s, c) === max) deduct += cardPointValue(s, c);
  }
  return total - deduct;
}

/** wrath-0 中：从你的牌库顶端反面打出1张牌到此链路。 */
function* wrath0Middle(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const line = ctx.card.line;
  if (line === null || !deckTopAvailable(ctx.s, ctx.player)) return;
  yield { op: 'playTopDeck', line, faceUp: false };
}

/** wrath-1 中：抽1张牌。 */
function* wrath1Middle(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  yield { op: 'draw', count: 1 };
}

/** wrath-1 底（end，无 top 仅顶卡）：结束：失去控制权。若你这么做，删除1张正面朝上的牌。
 *  无「可以」→ 持有必失；失去成功（原持有）才执行后句：强制删除 1 张 faceUp 未覆盖顶卡（任意方）。
 *  未持有 → 整句不执行（B3）。 */
function* wrath1End(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  if (ctx.s.control !== ctx.player) return; // 未持有 → 无可失去 → fizzle
  setControl(ctx.s, -1);
  const cand = ctx.candidates({ zone: 'field' }).filter((c) => c.faceUp);
  const ans = yield { kind: 'select', title: 'wrath-1（结束）：失去控制权——删除1张正面朝上的牌', min: 1, max: 1, optional: false, candidates: cand };
  if (ans.selected.length > 0) yield { op: 'delete', uid: ans.selected[0] };
}

/** 某线双方链路中所有 faceUp 卡（含被盖，B2）快照候选 */
function faceUpInLine(s: GameState, line: Line, excludeUid?: string): ChoiceCard[] {
  const out: ChoiceCard[] = [];
  for (const owner of [0, 1] as PlayerId[]) {
    const stack = s.players[owner].stacks[line];
    for (let i = 0; i < stack.length; i++) {
      const c = stack[i];
      if (c.faceUp && c.uid !== excludeUid) {
        out.push({ uid: c.uid, defId: c.defId, faceUp: true, owner, zone: 'field' as const, line, pos: c.pos, label: String(c.defId) });
      }
    }
  }
  return out;
}

/** 该线双方链路卡总数 */
function lineCardCount(s: GameState, line: Line): number {
  return s.players[0].stacks[line].length + s.players[1].stacks[line].length;
}

/** wrath-2 中：翻转牌最多的1条链路中所有正面朝上的牌。
 *  卡数（该线双方链路总数）最多；并列 → 拥有者选 1 条（B10）→ 该线全部 faceUp（含被盖，B2）快照逐张翻面。 */
function* wrath2Middle(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const topLines = ([0, 1, 2] as Line[]).filter((l) => lineCardCount(ctx.s, l) === Math.max(...([0, 1, 2] as Line[]).map((x) => lineCardCount(ctx.s, x))));
  const maxCount = lineCardCount(ctx.s, topLines[0]);
  if (maxCount === 0) return;
  let line: Line = topLines[0];
  if (topLines.length > 1) {
    const lAns = yield {
      kind: 'select-line', title: 'wrath-2：选择牌最多的1条链路', min: 1, max: 1, optional: false,
      candidates: [], lines: topLines,
    };
    if (lAns.selected.length === 0) return;
    line = Number(lAns.selected[0].replace('line:', '')) as Line;
  }
  const targets = faceUpInLine(ctx.s, line, ctx.card.uid); // 快照（含被盖）
  for (const t of targets) yield { op: 'flip', uid: t.uid, allowCovered: true };
}

/** wrath-3 中：翻转1张正面朝上的牌。（faceUp 未覆盖顶卡，强制；无目标 fizzle） */
function* wrath3Middle(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const cand = ctx.candidates({ zone: 'field' }).filter((c) => c.faceUp);
  const ans = yield { kind: 'select', title: 'wrath-3：翻转1张正面朝上的牌', min: 1, max: 1, optional: false, candidates: cand };
  if (ans.selected.length > 0) yield { op: 'flip', uid: ans.selected[0] };
}

/** wrath-4 中：失去控制权。若你这么做，对手弃2张牌。（B3：持有必失 → 失则对手弃 2 尽力而为） */
function* wrath4Middle(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  if (ctx.s.control !== ctx.player) return; // 未持有 → fizzle
  setControl(ctx.s, -1);
  const foe = opp(ctx.player);
  const hand = ctx.candidates({ zone: 'hand', owner: foe });
  if (hand.length === 0) return;
  const n = Math.min(2, hand.length);
  const ans = yield { kind: 'select', title: `wrath-4：失去控制权——对手弃${n}张牌`, min: n, max: n, optional: false, candidates: hand, chooser: foe };
  if (ans.selected.length > 0) yield { op: 'discardMany', uids: ans.selected };
}

/** wrath-5 中：弃1张牌。 */
function* wrath5Middle(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const hand = ctx.candidates({ zone: 'hand', owner: ctx.player });
  const ans = yield { kind: 'select', title: 'wrath-5：弃1张牌', min: 1, max: 1, optional: false, candidates: hand };
  if (ans.selected.length > 0) yield { op: 'discard', uid: ans.selected[0] };
}

registerCardEffects('wrath-0', {
  middle: wrath0Middle,
  valueModifier: { target: 'line', apply: wrath0Modifier },
});
registerCardEffects('wrath-1', {
  middle: wrath1Middle,
  triggers: { end: { fn: wrath1End, optional: false } },
});
registerCardEffects('wrath-2', { middle: wrath2Middle });
registerCardEffects('wrath-3', { middle: wrath3Middle });
registerCardEffects('wrath-4', { middle: wrath4Middle });
registerCardEffects('wrath-5', { middle: wrath5Middle });

