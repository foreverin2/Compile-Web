import type { EffectCtx, EffectStep, Line, PlayerId, StepResult } from '../../models/types';
import { registerCardEffects } from '../registry';
import { deckTopAvailable } from '../context';

/**
 * 3代 刚性 rigidity（关键词：翻转/反面打出/抽牌/不可移动；座右铭：坚不可摧）。
 * 权威卡文：src/data/cards3.ts（compile3文本.txt）；裁决：docs/3代-批3-规格与裁决清单.md
 * （C8 手牌逐链选卡；C10 刚性7 顶对手必选抽1或打出1；C11 刚性7 底不可翻移=仅 faceUp 顶卡免疫，
 *  引擎 executeOp flip/shift 守卫（rigidity7Immune），本文件不注册底）。
 */

function opp(p: PlayerId): PlayerId {
  return p === 0 ? 1 : 0;
}

/** rigidity-1 中：翻转对手1张正面朝上的牌（faceUp 未覆盖顶卡，强制）。 */
function* rigidity1Middle(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const cand = ctx.candidates({ zone: 'field', owner: opp(ctx.player) }).filter((c) => c.faceUp);
  const ans = yield { kind: 'select', title: 'rigidity-1：翻转对手1张正面朝上的牌', min: 1, max: 1, optional: false, candidates: cand };
  if (ans.selected.length > 0) yield { op: 'flip', uid: ans.selected[0] };
}

/** rigidity-1 底（end，无 top 仅顶卡）：结束：在每条对手有未被覆盖的反面朝上牌的其他链路中反面打出1张牌。
 *  遍历非本线：对手该线有未覆盖 faceDown 顶卡 → 自己从手牌反打 1 到己方该线链路（C8 逐链选卡）。 */
function* rigidity1End(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const mine = ctx.card.line;
  const foe = opp(ctx.player);
  const lines = ([0, 1, 2] as Line[]).filter((l) => {
    if (l === mine) return false;
    const foeStack = ctx.s.players[foe].stacks[l];
    const foeTop = foeStack[foeStack.length - 1];
    return !!foeTop && !foeTop.faceUp; // 对手该线未覆盖 faceDown 顶卡
  });
  for (const line of lines) {
    const hand = ctx.candidates({ zone: 'hand', owner: ctx.player });
    if (hand.length === 0) break;
    const ans = yield { kind: 'select', title: `rigidity-1（结束）：在链路 ${line + 1} 反面打出1张牌`, min: 1, max: 1, optional: false, candidates: hand };
    if (ans.selected.length === 0) break;
    yield { op: 'playFromHand', uid: ans.selected[0], line, faceUp: false };
  }
}

/** rigidity-2 底（after-action-face-down-play，无 top 仅顶卡）：在你用行动反面打出1张牌后：
 *  从你的牌库顶端反面打出1张牌到同一链路。（行动反打落点线由 completePlay 记录于
 *  s.pendingActionPlayLine；牌库顶反打盖其上） */
function* rigidity2AfterActionPlay(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const line = ctx.s.pendingActionPlayLine ?? ctx.card.line;
  ctx.s.pendingActionPlayLine = undefined; // 单实例读取后清除
  if (line === null || !deckTopAvailable(ctx.s, ctx.player)) return;
  yield { op: 'playTopDeck', line, faceUp: false };
}

/** rigidity-3 中：在此牌正下方反面打出1张牌。
 *  手牌选 1 张（C8）→ 反打垫到 rigidity-3 正下方（belowUid=自己，rigidity-3 保持未覆盖；E11）。 */
function* rigidity3Middle(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const hand = ctx.candidates({ zone: 'hand', owner: ctx.player });
  const ans = yield { kind: 'select', title: 'rigidity-3：在此牌正下方反面打出1张牌', min: 1, max: 1, optional: false, candidates: hand };
  if (ans.selected.length === 0) return;
  const line = ctx.card.line;
  if (line === null) return;
  yield { op: 'playFromHand', uid: ans.selected[0], line, faceUp: false, belowUid: ctx.card.uid };
}

/** rigidity-4 底（before-covered，仅顶卡）：当此牌将被1张反面朝下的牌覆盖时：先抽1张牌。
 *  覆盖者（浮空中）faceDown 才抽（faceUp 覆盖 → 不抽、覆盖照常）。
 *  2026-09-13（同类审计）：覆盖者也可能来自【偏转】（pendingShift，把一张反面牌偏转到本线）——
 *  旧版只查 pendingPlay → 偏转覆盖不触发（与 unity-0 底 2026-09-12 修的是同一个洞）。 */
function* rigidity4BeforeCovered(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const incoming = ctx.s.pendingPlay[0]?.card ?? ctx.s.pendingShift[0]?.card;
  if (!incoming || incoming.faceUp) return; // 覆盖者非反面 → 不抽
  yield { op: 'draw', count: 1 };
}

/** rigidity-5 中：弃1张牌。 */
function* rigidity5Middle(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const hand = ctx.candidates({ zone: 'hand', owner: ctx.player });
  const ans = yield { kind: 'select', title: 'rigidity-5：弃1张牌', min: 1, max: 1, optional: false, candidates: hand };
  if (ans.selected.length > 0) yield { op: 'discard', uid: ans.selected[0] };
}

/** rigidity-7 顶（end，top 命令被盖仍生效）：结束：对手选择抽1张牌或打出1张牌。
 *  （C10：必选其一；手牌空则只提供抽——打不出；抽照常洗弃牌堆） */
function* rigidity7End(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const foe = opp(ctx.player);
  const foeHand = ctx.candidates({ zone: 'hand', owner: foe });
  const foeP = ctx.s.players[foe];
  const canDraw = foeP.deck.length + foeP.trash.length > 0; // 抽需要牌库（空则洗弃牌堆；两者皆空无法抽）
  const actions: string[] = [];
  if (canDraw) actions.push('action:draw');
  if (foeHand.length > 0) actions.push('action:play');
  if (actions.length === 0) return; // 无法抽也无法打 → fizzle
  const act = yield {
    kind: 'select-action', title: 'rigidity-7（结束）：对手选择抽1张牌或打出1张牌', min: 1, max: 1, optional: false,
    candidates: [], actions, chooser: foe,
  };
  if (act.selected.length === 0) return;
  if (act.selected[0] === 'action:play') {
    const pAns = yield { kind: 'select', title: 'rigidity-7：对手打出1张牌', min: 1, max: 1, optional: false, candidates: foeHand, chooser: foe };
    if (pAns.selected.length === 0) return;
    const lAns = yield {
      kind: 'select-line', title: 'rigidity-7：反面打出到哪条链路', min: 1, max: 1, optional: false, candidates: [],
      lines: [0, 1, 2], chooser: foe,
    };
    if (lAns.selected.length === 0) return;
    const line = Number(lAns.selected[0].replace('line:', '')) as Line;
    yield { op: 'playFromHand', uid: pAns.selected[0], line, faceUp: false };
    return;
  }
  // 抽 1（对手自己）
  yield { op: 'draw', count: 1, player: foe };
}

/** rigidity-7 中：弃1张牌。 */
function* rigidity7Middle(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const hand = ctx.candidates({ zone: 'hand', owner: ctx.player });
  const ans = yield { kind: 'select', title: 'rigidity-7：弃1张牌', min: 1, max: 1, optional: false, candidates: hand };
  if (ans.selected.length > 0) yield { op: 'discard', uid: ans.selected[0] };
}

registerCardEffects('rigidity-1', {
  middle: rigidity1Middle,
  triggers: {
    end: {
      fn: rigidity1End,
      optional: false,
      // 自动判定（与 gen 内同过滤的纯查询版）：无「对手有未覆盖反面顶卡」的其他链路
      // 或己方手牌空 → 逐链反打无从开始，效果整体无动作 → 收集前自动跳过不出按钮
      cond: (s, card) => {
        const foe = opp(card.owner);
        const mine = card.line;
        return (
          s.players[card.owner].hand.length > 0 &&
          ([0, 1, 2] as Line[]).some((l) => {
            if (l === mine) return false;
            const stack = s.players[foe].stacks[l];
            const top = stack[stack.length - 1];
            return !!top && !top.faceUp; // 对手该线未覆盖反面顶卡
          })
        );
      },
    },
  },
});
registerCardEffects('rigidity-2', { triggers: { 'after-action-face-down-play': { fn: rigidity2AfterActionPlay, optional: false } } });
registerCardEffects('rigidity-3', { middle: rigidity3Middle });
registerCardEffects('rigidity-4', { triggers: { 'before-covered': { fn: rigidity4BeforeCovered, optional: false } } });
registerCardEffects('rigidity-5', { middle: rigidity5Middle });
registerCardEffects('rigidity-7', {
  middle: rigidity7Middle,
  triggers: {
    end: {
      fn: rigidity7End,
      optional: false,
      top: true,
      // 自动判定（C10）：对手既不能抽（牌库+弃牌堆皆空）也无手牌可打出 → 必选其一无从谈起，
      // 效果整体无动作 → 收集前自动跳过不出按钮
      cond: (s, card) => {
        const p = s.players[opp(card.owner)];
        return p.deck.length + p.trash.length > 0 || p.hand.length > 0;
      },
    },
  },
});

