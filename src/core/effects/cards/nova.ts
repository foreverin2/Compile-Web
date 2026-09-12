import type { ChoiceCard, EffectCtx, EffectStep, GameState, Line, PlayerId, StepResult } from '../../models/types';
import { registerCardEffects } from '../registry';
import { deckTopAvailable } from '../context';
import { getCardDef } from '../../../data/demo';
import { setControl } from '../../rules/control';

/**
 * 3代 新星 nova（关键词：删除/重排/控制权/偏转/翻转；座右铭：璀璨爆发）。
 * 权威卡文：src/data/cards3.ts（compile3文本.txt）；裁决：docs/3代-批3-规格与裁决清单.md
 * （C2 删该线双方全部 faceUp；C3 控制权中立 fizzle；C4 重排事件；C5 else 必得控制权；
 *  汉化稿 520 行裁决：无论谁持控制权都只能交换 nova 玩家两个协议——控制权持有者选择 nova 方 2 位）。
 */

function opp(p: PlayerId): PlayerId {
  return p === 0 ? 1 : 0;
}

/** 该线双方链路全部 faceUp 卡（含被盖，B2/C2）快照候选 */
function faceUpInLine(s: GameState, line: Line, excludeUid?: string): ChoiceCard[] {
  const out: ChoiceCard[] = [];
  for (const owner of [0, 1] as PlayerId[]) {
    const stack = s.players[owner].stacks[line];
    for (let i = 0; i < stack.length; i++) {
      const c = stack[i];
      if (c.faceUp && c.uid !== excludeUid) {
        out.push({ uid: c.uid, defId: c.defId, faceUp: true, owner, zone: 'field' as const, line, pos: c.pos, label: String(getCardDef(c.defId).value) });
      }
    }
  }
  return out;
}

/** nova-0 顶（start，top 命令被盖仍生效）：开始：在1条你恰好有5张牌的链路中，删除所有正面朝上的牌。
 *  己方链路恰 5 张的线（多条选 1，无则 fizzle）→ 删除该线【双方】链路全部 faceUp（含被盖，C2）。
 *  快照中源卡自身排最后删除（删自己后 sourceValid 中断后续——同 overwhelm-1 处理）。 */
function* nova0Start(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const lines = ([0, 1, 2] as Line[]).filter((l) => s_len(ctx.s, ctx.player, l) === 5);
  if (lines.length === 0) return;
  let line = lines[0];
  if (lines.length > 1) {
    const lAns = yield {
      kind: 'select-line', title: 'nova-0（开始）：选择1条你恰好有5张牌的链路', min: 1, max: 1, optional: false,
      candidates: [], lines,
    };
    if (lAns.selected.length === 0) return;
    line = Number(lAns.selected[0].replace('line:', '')) as Line;
  }
  const targets = faceUpInLine(ctx.s, line).sort((a, b) => (a.uid === ctx.card.uid ? 1 : b.uid === ctx.card.uid ? -1 : 0));
  for (const t of targets) yield { op: 'delete', uid: t.uid, allowCovered: true };
}

function s_len(s: GameState, player: PlayerId, line: Line): number {
  return s.players[player].stacks[line].length;
}

/** nova-0 中：拥有控制权的玩家交换你的2张协议的位置。
 *  控制权中立（无人持有）→ fizzle（C3）；持有者（chooser）选 nova 拥有者 2 个协议位交换（C3/520 裁决）。 */
function* nova0Middle(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const holder: PlayerId | -1 = ctx.s.control;
  if (holder !== 0 && holder !== 1) return; // 中立 → fizzle
  const first = yield {
    kind: 'select-line', title: `nova-0：控制权持有者（P${holder + 1}）选择要交换的第1个协议位（新星方）`,
    min: 1, max: 1, optional: false, candidates: [], lines: [0, 1, 2], chooser: holder,
  };
  if (first.selected.length === 0) return;
  const a = Number(first.selected[0].replace('line:', '')) as Line;
  const second = yield {
    kind: 'select-line', title: 'nova-0：选择第2个协议位', min: 1, max: 1, optional: false, candidates: [],
    lines: ([0, 1, 2] as Line[]).filter((l) => l !== a), chooser: holder,
  };
  if (second.selected.length === 0) return;
  const b = Number(second.selected[0].replace('line:', '')) as Line;
  yield { op: 'rearrangeProtocols', a, b, player: ctx.player };
}

/** nova-0 底（end，无 top 仅顶卡）：结束：在1张未被覆盖的新星牌下方，从你的牌库顶端反面打出1张牌。
 *  选 1 张【自己场上】未被覆盖的 nova 卡（faceUp 顶卡，含自己；落点同侧不变主——从你牌库顶垫到
 *  自己 nova 卡正下方，belowUid，该 nova 保持未覆盖）。 */
function* nova0End(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  if (!deckTopAvailable(ctx.s, ctx.player)) return;
  const cand: ChoiceCard[] = [];
  for (const line of [0, 1, 2] as Line[]) {
    const stack = s_owner(ctx.s, ctx.player).stacks[line];
    const top = stack[stack.length - 1];
    if (top && top.defId.startsWith('nova-') && top.faceUp) {
      cand.push({ uid: top.uid, defId: top.defId, faceUp: true, owner: ctx.player, zone: 'field' as const, line, pos: top.pos, label: String(getCardDef(top.defId).value) });
    }
  }
  if (cand.length === 0) return;
  const ans = yield { kind: 'select', title: 'nova-0（结束）：选择1张未被覆盖的新星牌', min: 1, max: 1, optional: false, candidates: cand };
  if (ans.selected.length === 0) return;
  const picked = cand.find((c) => c.uid === ans.selected[0]);
  if (!picked || picked.line === null) return;
  // belowUid：牌库顶反打插到所选 nova 卡【正下方】（line = 该 nova 卡所在线——belowUid 落点解析按源卡所在链路）
  yield { op: 'playTopDeck', line: picked.line, faceUp: false, belowUid: picked.uid };
}

/** 直接取玩家对象（nova0End 用） */
function s_owner(s: GameState, owner: PlayerId) {
  return s.players[owner];
}

/** nova-1 中：对手弃等同于此链路中牌数量的牌（尽力而为）。 */
function* nova1Middle(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const line = ctx.card.line;
  if (line === null) return;
  const n = s_len(ctx.s, ctx.player, line);
  if (n === 0) return;
  const foe = opp(ctx.player);
  const hand = ctx.candidates({ zone: 'hand', owner: foe });
  if (hand.length === 0) return;
  const k = Math.min(n, hand.length);
  const ans = yield { kind: 'select', title: `nova-1：对手弃${k}张牌`, min: k, max: k, optional: false, candidates: hand, chooser: foe };
  if (ans.selected.length > 0) yield { op: 'discardMany', uids: ans.selected };
}

/** 相邻下方那张是否为 nova 卡（nova-2 条件） */
function belowIsNova(ctx: EffectCtx): boolean {
  const line = ctx.card.line;
  if (line === null) return false;
  const stack = ctx.s.players[ctx.player].stacks[line];
  const idx = stack.findIndex((c) => c.uid === ctx.card.uid);
  if (idx === -1 || idx === 0) return false;
  return stack[idx - 1].defId.startsWith('nova-');
}

const NOVA_PERMS = ['021', '102', '120', '201', '210'];

/** nova-2 中：若此牌覆盖着1张新星牌，你可以重排你的协议。否则，获得控制权。
 *  （C5：else 分支必得控制权；重排可选——select-action 布局） */
function* nova2Middle(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  if (belowIsNova(ctx)) {
    const aAns = yield {
      kind: 'select-action', title: 'nova-2：覆盖着新星牌——你可以重排你的协议', min: 1, max: 1, optional: true, candidates: [],
      actions: NOVA_PERMS.map((p) => `action:order:${p}`),
    };
    if (aAns.selected.length === 0) return; // 跳过（不重排）
    const order = aAns.selected[0].split(':')[2].split('').map(Number) as Line[];
    yield { op: 'reorderProtocols', order };
  } else {
    setControl(ctx.s, ctx.player); // 必得
  }
}

/** nova-2 底（after-self-rearrange，无 top 仅顶卡）：当你重排协议后：你可以偏转1张反面朝下的牌。 */
function* nova2AfterSelfRearrange(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const cand = ctx.candidates({ zone: 'field', owner: ctx.player }).filter((c) => !c.faceUp);
  const tAns = yield { kind: 'select', title: 'nova-2：你重排协议后——你可以偏转1张反面朝下的牌', min: 1, max: 1, optional: true, candidates: cand };
  if (tAns.selected.length === 0) return;
  const card = ctx.s.players[ctx.player].stacks.flat().find((c) => c.uid === tAns.selected[0]);
  const srcLine = card?.line ?? ctx.card.line;
  if (srcLine === null) return;
  const lAns = yield {
    kind: 'select-line', title: 'nova-2：偏转到哪条链路', min: 1, max: 1, optional: false, candidates: [],
    lines: ([0, 1, 2] as Line[]).filter((l) => l !== srcLine),
  };
  if (lAns.selected.length === 0) return;
  yield { op: 'shift', uid: tAns.selected[0], targetLine: Number(lAns.selected[0].replace('line:', '')) as Line };
}

/** nova-3 中：偏转1张阈值小于此链路中牌数量的牌。 */
function* nova3Middle(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const line = ctx.card.line;
  if (line === null) return;
  const count = s_len(ctx.s, ctx.player, line);
  const cand = ctx.candidates({ zone: 'field' }).filter((c) => getCardDef(c.defId).value < count);
  if (cand.length === 0) return;
  const tAns = yield { kind: 'select', title: 'nova-3：偏转1张阈值小于此链路牌数的牌', min: 1, max: 1, optional: false, candidates: cand };
  if (tAns.selected.length === 0) return;
  const card = ctx.s.players.flatMap((p) => p.stacks).flat().find((c) => c.uid === tAns.selected[0]);
  const srcLine = card?.line ?? line;
  const lAns = yield {
    kind: 'select-line', title: 'nova-3：偏转到哪条链路', min: 1, max: 1, optional: false, candidates: [],
    lines: ([0, 1, 2] as Line[]).filter((l) => l !== srcLine),
  };
  if (lAns.selected.length === 0) return;
  yield { op: 'shift', uid: tAns.selected[0], targetLine: Number(lAns.selected[0].replace('line:', '')) as Line };
}

/** nova-4 中：翻转1张阈值小于此链路中牌数量的牌。 */
function* nova4Middle(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const line = ctx.card.line;
  if (line === null) return;
  const count = s_len(ctx.s, ctx.player, line);
  const cand = ctx.candidates({ zone: 'field' }).filter((c) => c.faceUp && getCardDef(c.defId).value < count);
  if (cand.length === 0) return;
  const ans = yield { kind: 'select', title: 'nova-4：翻转1张阈值小于此链路牌数的牌', min: 1, max: 1, optional: false, candidates: cand };
  if (ans.selected.length > 0) yield { op: 'flip', uid: ans.selected[0] };
}

/** nova-5 中：弃1张牌。 */
function* nova5Middle(ctx: EffectCtx): Generator<EffectStep, void, StepResult> {
  const hand = ctx.candidates({ zone: 'hand', owner: ctx.player });
  const ans = yield { kind: 'select', title: 'nova-5：弃1张牌', min: 1, max: 1, optional: false, candidates: hand };
  if (ans.selected.length > 0) yield { op: 'discard', uid: ans.selected[0] };
}

registerCardEffects('nova-0', {
  middle: nova0Middle,
  triggers: {
    start: {
      fn: nova0Start,
      optional: false,
      top: true,
      // 自动判定：己方无任一链路恰 5 张 → 无对象自动跳过不出按钮
      cond: (s, card) => {
        const stacks = s.players[card.owner].stacks;
        return ([0, 1, 2] as Line[]).some((l) => stacks[l].length === 5);
      },
    },
    end: {
      fn: nova0End,
      optional: false,
      // 自动判定：牌库不可抽或己方无未被覆盖的正面新星牌 → 无对象自动跳过
      cond: (s, card) => {
        const p = s.players[card.owner];
        if (p.deck.length === 0) return false;
        const stacks = p.stacks;
        return ([0, 1, 2] as Line[]).some((l) => {
          const st = stacks[l];
          const top = st[st.length - 1];
          return !!top && top.defId.startsWith('nova-') && top.faceUp;
        });
      },
    },
  },
});
registerCardEffects('nova-1', { middle: nova1Middle });
registerCardEffects('nova-2', {
  middle: nova2Middle,
  triggers: { 'after-self-rearrange': { fn: nova2AfterSelfRearrange, optional: false } },
});
registerCardEffects('nova-3', { middle: nova3Middle });
registerCardEffects('nova-4', { middle: nova4Middle });
registerCardEffects('nova-5', { middle: nova5Middle });

