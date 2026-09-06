import type { EffectCtx, EffectStep, GameState, Line, StepResult } from '../../models/types';
import { registerCardEffects } from '../registry';
import { deckTopAvailable } from '../context';

/**
 * 3代 动量 momentum（关键词：编译/重排/抽牌/弃牌；座右铭：蓄势待发）。
 * 权威卡文：src/data/cards3.ts（compile3文本.txt）；裁决：docs/3代-批3-规格与裁决清单.md
 * （C1 任一玩家已编译；C4 重排事件=一切重排，引擎在 rearrange/reorder/控制组件重排路径统一
 *  fire after-self/any-rearrange；after-any-compile 引擎已接 compile-body）。
 */

/** 该线任一玩家协议已编译（C1） */
function lineHasCompiledProtocol(s: GameState, line: Line): boolean {
  return s.players[0].protocols[line].compiled || s.players[1].protocols[line].compiled;
}

/** momentum-0 中：在每条有已编译协议的链路中，从你的牌库顶端反面打出1张牌。
 *  源卡线排最后（反打会盖住自己 → 若先打自己线，sourceValid 中断后续线——同 overwhelm-1 处理）。 */
function* momentum0Middle(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const mine = ctx.card.line;
  const lines = ([0, 1, 2] as Line[])
    .filter((l) => lineHasCompiledProtocol(ctx.s, l))
    .sort((a, b) => (a === mine ? 1 : b === mine ? -1 : 0));
  for (const l of lines) {
    if (!deckTopAvailable(ctx.s, ctx.player)) continue;
    yield { op: 'playTopDeck', line: l, faceUp: false };
  }
}

/** momentum-1 顶（after-any-compile，top 命令被盖仍生效）：当任意玩家编译后：
 *  从你的牌库顶端反面打出1张牌到此链路（覆盖 momentum-1 自身无妨）。 */
function* momentum1AfterCompile(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const line = ctx.card.line;
  if (line === null || !deckTopAvailable(ctx.s, ctx.player)) return;
  yield { op: 'playTopDeck', line, faceUp: false };
}

/** momentum-1 底（after-any-rearrange，无 top 仅顶卡）：当任意玩家重排协议后：弃1张牌。抽1张牌。 */
function* momentum1AfterRearrange(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const hand = ctx.candidates({ zone: 'hand', owner: ctx.player });
  const dAns = yield { kind: 'select', title: 'momentum-1：任意玩家重排协议后——弃1张牌', min: 1, max: 1, optional: false, candidates: hand };
  if (dAns.selected.length > 0) yield { op: 'discard', uid: dAns.selected[0] };
  yield { op: 'draw', count: 1 };
}

/** momentum-3 中：抽2张牌。 */
function* momentum3Middle(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  yield { op: 'draw', count: 2 };
}

/** 自由重排协议 UI（chaos-1 同款：5 种非恒等排列布局选择） */
const PERMS = ['021', '102', '120', '201', '210'];

/** momentum-4 中：重排你的协议。（reorderProtocols；触发 after-self/any-rearrange 由引擎统一处理） */
function* momentum4Middle(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const aAns = yield {
    kind: 'select-action', title: 'momentum-4：重排你的协议（选择新布局）', min: 1, max: 1, optional: false, candidates: [],
    actions: PERMS.map((p) => `action:order:${p}`),
  };
  if (aAns.selected.length === 0) return;
  const order = aAns.selected[0].split(':')[2].split('').map(Number) as Line[];
  yield { op: 'reorderProtocols', order };
}

/** momentum-5 中：弃1张牌。 */
function* momentum5Middle(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const hand = ctx.candidates({ zone: 'hand', owner: ctx.player });
  const ans = yield { kind: 'select', title: 'momentum-5：弃1张牌', min: 1, max: 1, optional: false, candidates: hand };
  if (ans.selected.length > 0) yield { op: 'discard', uid: ans.selected[0] };
}

/** momentum-6 顶（after-any-compile，top 命令被盖仍生效）：当任意玩家编译后：删除此牌。 */
function* momentum6AfterCompile(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  yield { op: 'delete', uid: ctx.card.uid, allowCovered: true };
}

/** momentum-6 中：弃1张牌。 */
function* momentum6Middle(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const hand = ctx.candidates({ zone: 'hand', owner: ctx.player });
  const ans = yield { kind: 'select', title: 'momentum-6：弃1张牌', min: 1, max: 1, optional: false, candidates: hand };
  if (ans.selected.length > 0) yield { op: 'discard', uid: ans.selected[0] };
}

registerCardEffects('momentum-0', { middle: momentum0Middle });
registerCardEffects('momentum-1', {
  triggers: {
    'after-any-compile': { fn: momentum1AfterCompile, optional: false, top: true },
    'after-any-rearrange': { fn: momentum1AfterRearrange, optional: false },
  },
});
registerCardEffects('momentum-3', { middle: momentum3Middle });
registerCardEffects('momentum-4', { middle: momentum4Middle });
registerCardEffects('momentum-5', { middle: momentum5Middle });
registerCardEffects('momentum-6', {
  middle: momentum6Middle,
  triggers: { 'after-any-compile': { fn: momentum6AfterCompile, optional: false, top: true } },
});

