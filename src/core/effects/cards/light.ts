import type { EffectCtx, EffectGen, EffectStep, Line, PlayerId, StepResult } from '../../models/types';
import { registerCardEffects } from '../registry';
import { findCard } from '../context';
import { cardPointValue } from '../../state/create';

function* light0(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const targets = ctx.candidates({ zone: 'field' });
  const ans = yield { kind: 'select', title: 'light-0：翻转1张牌', min: 1, max: 1, optional: false, candidates: targets };
  if (ans.selected.length === 0) return;
  yield { op: 'flip', uid: ans.selected[0] };
  // 抽牌数以翻转后的状态为准：翻完正面 → 抽牌面分值；翻完反面 → 抽反面分值
  // （默认 2；所在线有正面 darkness-2 顶命令时 = 4）
  const card = findCard(ctx.s, ans.selected[0]);
  if (card) yield { op: 'draw', count: cardPointValue(ctx.s, card) };
}

function* light1End(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  yield { op: 'draw', count: 1 };
}

function* light2(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  yield { op: 'draw', count: 2 };
  // 揭示 1 张反面牌（可选目标：场上任意反面卡——含被盖住的与对手的；fizzle 时无候选自动跳过）
  const facedown = [
    ...ctx.candidates({ zone: 'field' }),
    ...ctx.candidates({ zone: 'field', covered: true }),
  ].filter((c) => !c.faceUp);
  const r = yield { kind: 'select', title: 'light-2：揭示1张反面牌', min: 1, max: 1, optional: false, candidates: facedown };
  if (r.selected.length === 0) return;
  const revealed = facedown.find((c) => c.uid === r.selected[0]);
  yield { op: 'reveal', uid: r.selected[0] };
  // 翻/移/跳过的选择权属于打出光2的玩家（效果属主 ctx.player），而非被揭示卡的持有者——
  // 卡牌可能易主（易主规则），选择权不随卡牌归属转移
  const chooser: PlayerId = ctx.player;
  const act = yield { kind: 'select-action', title: 'light-2：你可以平移或翻转那张牌', min: 1, max: 1, optional: true, candidates: [], actions: ['action:flip', 'action:shift'], chooser };
  if (act.selected.length === 0) return;
  if (act.selected[0] === 'action:flip') yield { op: 'flip', uid: r.selected[0], allowCovered: true };
  // action:shift → 平移需选目标线（light-2 平移该牌到任意其他线；只排除被揭示卡当前线——
  // shift 仅禁止目标=被移卡原线（resolve 抛错）；光2 自己所在的行是合法目标，同暗1 修法）
  if (act.selected[0] === 'action:shift') {
    const line = yield { kind: 'select-line', title: 'light-2：平移目标线', min: 1, max: 1, optional: false, candidates: [], lines: [0, 1, 2].filter((l) => l !== revealed?.line) as Line[], chooser };
    if (line.selected.length > 0) {
      yield { op: 'shift', uid: r.selected[0], targetLine: Number(line.selected[0].replace('line:', '')) as Line, allowCovered: true };
    }
  }
}

function* light3(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const srcLine = ctx.card.line!;
  const line = yield { kind: 'select-line', title: 'light-3：平移目标线', min: 1, max: 1, optional: false, candidates: [], lines: [0, 1, 2].filter((l) => l !== srcLine) as Line[] };
  if (line.selected.length === 0) return;
  const target = Number(line.selected[0].replace('line:', '')) as Line;
  // 来源：效果玩家本线 与 对手同列线 双方的反面牌（含被覆盖的——live-stack 循环处理移除，逐张入 pendingShift 队列）
  const s = ctx.s;
  const opp = ctx.player === 0 ? 1 : 0;
  for (const owner of [ctx.player, opp] as PlayerId[]) {
    const stack = s.players[owner].stacks[srcLine];
    for (;;) {
      const idx = [...stack].reverse().findIndex((c) => !c.faceUp);
      if (idx === -1) break;
      const card = stack[stack.length - 1 - idx];
      yield { op: 'shift', uid: card.uid, targetLine: target, allowCovered: true };
    }
  }
}

function* light4(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const opp = ctx.s.players[ctx.player === 0 ? 1 : 0];
  for (const card of [...opp.hand]) yield { op: 'reveal', uid: card.uid };
}

function* light5(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const hand = ctx.candidates({ zone: 'hand', owner: ctx.player });
  const ans = yield { kind: 'select', title: 'light-5：弃1张牌', min: 1, max: 1, optional: false, candidates: hand };
  if (ans.selected.length === 0) return;
  yield { op: 'discard', uid: ans.selected[0] };
}

registerCardEffects('light-0', { middle: light0 });
registerCardEffects('light-1', { triggers: { end: { fn: light1End, optional: false } } });
registerCardEffects('light-2', { middle: light2 });
registerCardEffects('light-3', { middle: light3 });
registerCardEffects('light-4', { middle: light4 });
registerCardEffects('light-5', { middle: light5 });
