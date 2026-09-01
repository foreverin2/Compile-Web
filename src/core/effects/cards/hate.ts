import type { Card, ChoiceCard, EffectCtx, EffectStep, GameState, Line, PlayerId, StepResult } from '../../models/types';
import { registerCardEffects } from '../registry';
import { getCardDef } from '../../../data/demo';
import { cardPointValue } from '../../state/create';

function toChoice(c: Card): ChoiceCard {
  return {
    uid: c.uid, defId: c.defId, faceUp: c.faceUp, owner: c.owner,
    zone: c.zone, line: c.line, pos: c.pos, label: String(getCardDef(c.defId).value),
  };
}

/** hate-0 中指令：删除1张牌。
 *  选 1 张场上未覆盖顶卡（双方，结算中源卡被候选排除——同 metal-0 口径）删除。空 → fizzle。 */
function* hate0(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const targets = ctx.candidates({ zone: 'field' });
  const ans = yield { kind: 'select', title: 'hate-0：删除1张牌', min: 1, max: 1, optional: false, candidates: targets };
  if (ans.selected.length === 0) return; // fizzle：无场上顶卡
  yield { op: 'delete', uid: ans.selected[0] };
}

/** hate-1 中指令：弃3张牌。删除1张牌。再删除1张牌。
 *  每句独立（FAQ 39）：弃 3 尽力而为（min=min(3, hand.length)，手牌空跳过——用户拍板）；
 *  两次删除各自重新列候选（上一步删后顶卡可能变化）。每步空 → 仅跳过该步。 */
function* hate1(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const hand = ctx.candidates({ zone: 'hand', owner: ctx.player });
  if (hand.length > 0) {
    const ans = yield { kind: 'select', title: 'hate-1：弃3张牌', min: Math.min(3, hand.length), max: 3, optional: false, candidates: hand };
    if (ans.selected.length > 0) yield { op: 'discardMany', uids: ans.selected };
  }
  const del1 = yield { kind: 'select', title: 'hate-1：删除1张牌', min: 1, max: 1, optional: false, candidates: ctx.candidates({ zone: 'field' }) };
  if (del1.selected.length > 0) yield { op: 'delete', uid: del1.selected[0] };
  const del2 = yield { kind: 'select', title: 'hate-1：再删除1张牌', min: 1, max: 1, optional: false, candidates: ctx.candidates({ zone: 'field' }) };
  if (del2.selected.length > 0) yield { op: 'delete', uid: del2.selected[0] };
}

/** 某玩家场上全部【正面】顶卡（含结算中源卡自己——hate-2 自己可能是分值最高者，FAQ 172 第一句可删自己） */
function topFaceUpCards(s: GameState, owner: PlayerId): Card[] {
  const out: Card[] = [];
  for (const line of [0, 1, 2] as Line[]) {
    const stack = s.players[owner].stacks[line];
    if (stack.length === 0) continue;
    const top = stack[stack.length - 1];
    if (top.faceUp) out.push(top);
  }
  return out;
}

/** 分值最高者集合（并列全列）：仅正面顶卡为候选（FAQ 169 更正「未翻面卡牌」——用户拍板按 FAQ 字面）；
 *  分值 = cardPointValue（正面顶卡 = 牌面值 getCardDef(defId).value，口径一致） */
function maxValueSet(s: GameState, owner: PlayerId): ChoiceCard[] {
  const cards = topFaceUpCards(s, owner);
  if (cards.length === 0) return [];
  let max = -Infinity;
  for (const c of cards) {
    const v = cardPointValue(s, c);
    if (v > max) max = v;
  }
  return cards.filter((c) => cardPointValue(s, c) === max).map(toChoice);
}

/** hate-2 中指令：删除你分值最高的牌。删除对手分值最高的牌。
 *  自己句候选 = 自己场上正面顶卡中分值最高者集合（含源卡自己）→ 玩家选 1 → delete；
 *  对手句同（对手候选，玩家选）。空候选 → 该句 fizzle 跳过（每句独立）。
 *  FAQ 172：第一句删到源卡自己时 sourceValid 自动终止整个效果 → 第二句不触发。 */
function* hate2(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const opp: PlayerId = ctx.player === 0 ? 1 : 0;
  const ownMax = maxValueSet(ctx.s, ctx.player);
  if (ownMax.length > 0) {
    const ans1 = yield { kind: 'select', title: 'hate-2：删除你分值最高的牌', min: 1, max: 1, optional: false, candidates: ownMax };
    if (ans1.selected.length > 0) yield { op: 'delete', uid: ans1.selected[0] };
  }
  const oppMax = maxValueSet(ctx.s, opp);
  if (oppMax.length > 0) {
    const ans2 = yield { kind: 'select', title: 'hate-2：删除对手分值最高的牌', min: 1, max: 1, optional: false, candidates: oppMax };
    if (ans2.selected.length > 0) yield { op: 'delete', uid: ans2.selected[0] };
  }
}

/** hate-3 顶指令：你的牌被删除后：抽1张牌。
 *  after-delete 即时连锁（fireReactive 自动收集被删卡【持有者】场上全部正面注册卡 → 抽 1；
 *  top 标志：顶命令被盖仍生效——fireReactive 推入的效果恒带 topCommand）。
 *  编译删除走 compile-body 不经 delete op → 不触发（用户拍板「不含编译删除」）。 */
function* hate3AfterDelete(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  yield { op: 'draw', count: 1 };
}

/** hate-4 底指令：被盖住前：先删除此列分值最低的被盖住的牌。
 *  before-covered 触发（此时本卡必为顶卡；不注册 top 标志——before-covered 只查顶卡，无影响）。
 *  候选 = 自己该线堆叠中被盖的卡（pos < len-1，不含自己）中 cardPointValue 最低者集合；
 *  唯一 → 直接删；并列 → 玩家选 1 → {op:'delete', allowCovered}。无被盖卡 → fizzle。 */
function* hate4BeforeCovered(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const stack = ctx.s.players[ctx.card.owner].stacks[ctx.card.line!];
  const covered = stack.filter((c) => c.uid !== ctx.card.uid && c !== stack[stack.length - 1]);
  if (covered.length === 0) return; // fizzle：此列无被盖卡
  let min = Infinity;
  for (const c of covered) {
    const v = cardPointValue(ctx.s, c);
    if (v < min) min = v;
  }
  const minSet = covered.filter((c) => cardPointValue(ctx.s, c) === min);
  if (minSet.length === 1) {
    yield { op: 'delete', uid: minSet[0].uid, allowCovered: true };
    return;
  }
  const ans = yield {
    kind: 'select',
    title: 'hate-4（被盖住前）：删除此列分值最低的被盖住的牌',
    min: 1,
    max: 1,
    optional: false,
    candidates: minSet.map(toChoice),
  };
  if (ans.selected.length === 0) return; // 守卫空应答
  yield { op: 'delete', uid: ans.selected[0], allowCovered: true };
}

/** hate-5 中指令：弃1张牌 */
function* hate5(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const hand = ctx.candidates({ zone: 'hand', owner: ctx.player });
  const ans = yield { kind: 'select', title: 'hate-5：弃1张牌', min: 1, max: 1, optional: false, candidates: hand };
  if (ans.selected.length === 0) return; // fizzle：无牌可弃
  yield { op: 'discard', uid: ans.selected[0] };
}

registerCardEffects('hate-0', { middle: hate0 });
registerCardEffects('hate-1', { middle: hate1 });
registerCardEffects('hate-2', { middle: hate2 });
registerCardEffects('hate-3', {
  triggers: { 'after-delete': { fn: hate3AfterDelete, optional: false, top: true } }, // 顶命令：被盖仍生效
});
registerCardEffects('hate-4', {
  triggers: { 'before-covered': { fn: hate4BeforeCovered, optional: false } }, // 底命令：仅未覆盖顶卡触发
});
registerCardEffects('hate-5', { middle: hate5 });
