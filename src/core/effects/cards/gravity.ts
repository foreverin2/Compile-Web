import type { EffectCtx, EffectStep, Line, PlayerId, StepResult } from '../../models/types';
import { registerCardEffects } from '../registry';
import { deckTopAvailable, findCard } from '../context';

/** gravity-0 中指令：此列每有2张牌，就在此牌下方以反面打出你牌堆顶的牌。
 *  统计口径 = 该线【双方链路合计】（含 gravity-0 自己；参考实现 playExecutor.ts:380-386 确认）；
 *  张数 n = Math.floor(总数 / 2)。循环 n 次：每次 deckTopAvailable（只查牌库，不洗弃牌堆——
 *  FAQ 142）守卫，牌库空 → 剩余 fizzle。每张 { playTopDeck, belowUid: 自己 }：插入自己下方、
 *  自己保持未覆盖；落地顺序 = 先弹出的牌在最底（与参考实现 splice 于源卡之下一致）。 */
function* gravity0(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const line = ctx.card.line!;
  const total = ctx.s.players[0].stacks[line].length + ctx.s.players[1].stacks[line].length;
  const n = Math.floor(total / 2);
  for (let i = 0; i < n; i++) {
    if (!deckTopAvailable(ctx.s, ctx.player)) break; // 牌库空 → 剩余 fizzle（不洗弃牌堆）
    yield { op: 'playTopDeck', line, faceUp: false, belowUid: ctx.card.uid };
  }
}

/** gravity-1 中指令：抽2张牌。把1张牌平移进或平移出此列。
 *  抽 2 → select 1 张场上未覆盖顶卡（双方）→ 若该卡不在此列：select-line 只能选此列（平移进）；
 *  若已在此列：select-line 排除此列（平移出）。选卡与 shift 间无其他 op，卡不会离场/被盖，
 *  shift 无需 allowCovered。无场上顶卡 → 选卡步 fizzle（抽牌仍结算）。 */
function* gravity1(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  yield { op: 'draw', count: 2 };
  const targets = ctx.candidates({ zone: 'field' });
  const ans = yield { kind: 'select', title: 'gravity-1：把1张牌平移进或平移出此列', min: 1, max: 1, optional: false, candidates: targets };
  if (ans.selected.length === 0) return; // fizzle：无场上顶卡
  const card = findCard(ctx.s, ans.selected[0]);
  if (!card || card.zone !== 'field' || card.line === null) return; // 防御：卡已离场
  const here = card.line === ctx.card.line;
  const line = yield {
    kind: 'select-line',
    title: here ? 'gravity-1：把该牌平移出此列' : 'gravity-1：把该牌平移进此列',
    min: 1, max: 1, optional: false, candidates: [],
    lines: here ? ([0, 1, 2] as Line[]).filter((l) => l !== ctx.card.line) : [ctx.card.line!],
  };
  if (line.selected.length === 0) return;
  yield { op: 'shift', uid: card.uid, targetLine: Number(line.selected[0].replace('line:', '')) as Line };
}

/** gravity-2 中指令：翻转1张牌。把那张牌平移进此列。
 *  select 1 张场上未覆盖顶卡 → flip（翻正可能触发其中指令连锁——如 life-0 打出垫牌盖住自己、
 *  death-2 选列删自己——连锁先整体结算完）→ findCard 守卫（卡可能已被连锁移除 → 跳过平移）→
 *  若卡不在此列：select-line 只能选此列 → shift 带 allowCovered（FAQ 137：被翻转的卡即使被覆盖
 *  也移动——"那张卡牌"规则优先）。已在此列 → 无平移。 */
function* gravity2(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const targets = ctx.candidates({ zone: 'field' });
  const ans = yield { kind: 'select', title: 'gravity-2：翻转1张牌', min: 1, max: 1, optional: false, candidates: targets };
  if (ans.selected.length === 0) return; // fizzle：无场上顶卡
  yield { op: 'flip', uid: ans.selected[0] };
  const card = findCard(ctx.s, ans.selected[0]);
  if (!card || card.zone !== 'field' || card.line === null) return; // 翻正连锁移除了该卡 → 跳过平移
  if (card.line === ctx.card.line) return; // 已在此列 → 无需平移
  const line = yield { kind: 'select-line', title: 'gravity-2：把该牌平移进此列', min: 1, max: 1, optional: false, candidates: [], lines: [ctx.card.line!] };
  if (line.selected.length === 0) return;
  yield { op: 'shift', uid: card.uid, targetLine: ctx.card.line!, allowCovered: true };
}

/** gravity-4 中指令：把1张反面牌平移进此列。
 *  select 场上未覆盖顶卡中 !faceUp 的 1 张（被盖卡不在候选）→ 若已在此列 → 无动作跳过（拍板）
 *  → 否则 shift 进此列（选卡时必为未覆盖顶卡 → 无需 allowCovered）。无反面顶卡 → fizzle。 */
function* gravity4(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const facedown = ctx.candidates({ zone: 'field' }).filter((c) => !c.faceUp);
  const ans = yield { kind: 'select', title: 'gravity-4：把1张反面牌平移进此列', min: 1, max: 1, optional: false, candidates: facedown };
  if (ans.selected.length === 0) return; // fizzle：无反面顶卡
  const card = findCard(ctx.s, ans.selected[0]);
  if (!card || card.zone !== 'field' || card.line === null) return; // 防御：卡已离场
  if (card.line === ctx.card.line) return; // 已在此列 → 无动作
  yield { op: 'shift', uid: card.uid, targetLine: ctx.card.line! };
}

/** gravity-5：弃1张牌 */
function* gravity5(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const hand = ctx.candidates({ zone: 'hand', owner: ctx.player });
  const ans = yield { kind: 'select', title: 'gravity-5：弃1张牌', min: 1, max: 1, optional: false, candidates: hand };
  if (ans.selected.length === 0) return; // fizzle：无牌可弃
  yield { op: 'discard', uid: ans.selected[0] };
}

/** gravity-6 中指令：对手在此列以反面打出其牌堆顶的牌。
 *  opp = 效果属主的对手。deckTopAvailable(s, opp) 守卫（只查对手牌库，不洗弃牌堆——FAQ 142）；
 *  对手牌库空 → fizzle。playTopDeck 带 player: opp → 从对手牌库弹出、落对手此列链路、反面 + secret。 */
function* gravity6(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const opp: PlayerId = ctx.player === 0 ? 1 : 0;
  if (!deckTopAvailable(ctx.s, opp)) return; // 对手牌库空 → fizzle（不洗弃牌堆）
  yield { op: 'playTopDeck', line: ctx.card.line!, faceUp: false, player: opp };
}

registerCardEffects('gravity-0', { middle: gravity0 });
registerCardEffects('gravity-1', { middle: gravity1 });
registerCardEffects('gravity-2', { middle: gravity2 });
registerCardEffects('gravity-4', { middle: gravity4 });
registerCardEffects('gravity-5', { middle: gravity5 });
registerCardEffects('gravity-6', { middle: gravity6 });

