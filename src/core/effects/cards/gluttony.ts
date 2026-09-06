import type { EffectCtx, EffectStep, Line, PlayerId, StepResult } from '../../models/types';
import { registerCardEffects } from '../registry';
import { deckTopAvailable } from '../context';

/**
 * 3代 暴食 gluttony（关键词：清缓存/回手/抽牌/删除；座右铭：欲壑难填）。
 * 权威卡文：src/data/cards3.ts（compile3文本.txt）；裁决：docs/3代-批1-规格与裁决清单.md
 * （RQ2-A：暴食0 顶清缓存后由拥有者自选线从牌库顶反打；RQ7-A：回手任意场牌回其主；
 *  after-any-clear-cache 双向触发；清缓存 = check-cache 真弃牌动作，见 game.ts）。
 */

/** gluttony-0 顶（after-clear-cache，top 命令被盖仍生效）：当你清缓存后：从你的牌库顶端反面打出1张牌。
 *  无落点字样 → 拥有者自选任意线（裁决 RQ2-A）；牌库空 → fizzle（不洗牌 FAQ 142）。 */
function* gluttony0AfterClearCache(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  if (!deckTopAvailable(ctx.s, ctx.player)) return;
  const lAns = yield {
    kind: 'select-line', title: 'gluttony-0：清缓存后——选择牌库顶反打到的链路', min: 1, max: 1, optional: false, candidates: [], lines: [0, 1, 2],
  };
  if (lAns.selected.length === 0) return;
  const line = Number(lAns.selected[0].replace('line:', '')) as Line;
  yield { op: 'playTopDeck', line, faceUp: false };
}

/** gluttony-0 中：回手1张其他牌。抽1张牌。
 *  回手 = 任意场牌（自己或对手的未覆盖顶卡）回其 owner 手牌（裁决 RQ7-A；引擎 return 不变主）。
 *  两句独立：回手无目标 fizzle 后抽 1 照常。 */
function* gluttony0Middle(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const cand = ctx.candidates({ zone: 'field' }); // 源卡 gluttony-0 自动排除（结算中源卡过滤）→ 「其他牌」
  const rAns = yield { kind: 'select', title: 'gluttony-0：回手1张其他牌', min: 1, max: 1, optional: false, candidates: cand };
  if (rAns.selected.length > 0) yield { op: 'return', uid: rAns.selected[0] };
  yield { op: 'draw', count: 1 };
}

/** gluttony-1 中：抽2张牌。 */
function* gluttony1Middle(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  yield { op: 'draw', count: 2 };
}

/** gluttony-1 底（after-any-clear-cache，无 top 仅顶卡）：当任意玩家清缓存后：删除1张牌。
 *  （无「可以」→ 必须删 1；无目标 fizzle。任意玩家 = 双方任一方清缓存都触发，方向 both） */
function* gluttony1AfterAnyClearCache(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const cand = ctx.candidates({ zone: 'field' });
  const ans = yield { kind: 'select', title: 'gluttony-1：任意玩家清缓存后——删除1张牌', min: 1, max: 1, optional: false, candidates: cand };
  if (ans.selected.length > 0) yield { op: 'delete', uid: ans.selected[0] };
}

/** gluttony-2 中：抽取等同于你手牌数量的牌。 */
function* gluttony2Middle(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const n = ctx.s.players[ctx.player].hand.length;
  if (n > 0) yield { op: 'draw', count: n };
}

/** gluttony-3 顶（end，top 命令被盖仍生效）：结束：若此牌被1张正面朝上的牌覆盖，删除那张牌。 */
function* gluttony3End(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const line = ctx.card.line;
  if (line === null) return;
  const stack = ctx.s.players[ctx.player].stacks[line];
  const idx = stack.findIndex((c) => c.uid === ctx.card.uid);
  if (idx === -1) return;
  const cover = stack[idx + 1]; // 直接盖在 gluttony-3 上方的那张
  if (!cover || !cover.faceUp) return;
  yield { op: 'delete', uid: cover.uid, allowCovered: true };
}

/** gluttony-3 中：抽2张牌。 */
function* gluttony3Middle(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  yield { op: 'draw', count: 2 };
}

/** gluttony-4 底（after-refresh，无 top 仅顶卡）：当你刷新后：抽1张牌。 */
function* gluttony4AfterRefresh(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  yield { op: 'draw', count: 1 };
}

/** gluttony-5 中：弃1张牌。 */
function* gluttony5Middle(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const hand = ctx.candidates({ zone: 'hand', owner: ctx.player });
  const ans = yield { kind: 'select', title: 'gluttony-5：弃1张牌', min: 1, max: 1, optional: false, candidates: hand };
  if (ans.selected.length > 0) yield { op: 'discard', uid: ans.selected[0] };
}

registerCardEffects('gluttony-0', {
  middle: gluttony0Middle,
  triggers: { 'after-clear-cache': { fn: gluttony0AfterClearCache, optional: false, top: true } },
});
registerCardEffects('gluttony-1', {
  middle: gluttony1Middle,
  triggers: { 'after-any-clear-cache': { fn: gluttony1AfterAnyClearCache, optional: false } },
});
registerCardEffects('gluttony-2', { middle: gluttony2Middle });
registerCardEffects('gluttony-3', {
  middle: gluttony3Middle,
  triggers: {
    end: {
      fn: gluttony3End,
      optional: false,
      top: true,
      // 自动判定：自己该链路中此牌上方相邻卡为正面（可删对象）才触发——未覆盖/上方非正面 → 无动作
      cond: (s, card) => {
        if (card.line === null) return false;
        const stack = s.players[card.owner].stacks[card.line];
        const idx = stack.findIndex((c) => c.uid === card.uid);
        const cover = idx === -1 ? undefined : stack[idx + 1];
        return !!cover && cover.faceUp;
      },
    },
  },
});
registerCardEffects('gluttony-4', { triggers: { 'after-refresh': { fn: gluttony4AfterRefresh, optional: false } } });
registerCardEffects('gluttony-5', { middle: gluttony5Middle });
