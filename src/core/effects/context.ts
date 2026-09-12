import type { Card, ChoiceCard, EffectCtx, GameState, Line, PlayerId, CandidateFilter } from '../models/types';
import { getCardDef } from '../../data/demo';
import { gameBus } from '../events/bus';

let effectIdCounter = 0;
export function nextEffectId(): string {
  effectIdCounter += 1;
  return `e${effectIdCounter}`;
}

/** 全状态查找卡牌（含浮空中的 pendingPlay/pendingShift 卡） */
export function findCard(s: GameState, uid: string): Card | undefined {
  for (const item of s.pendingPlay) if (item.card.uid === uid) return item.card;
  for (const item of s.pendingShift) if (item.card.uid === uid) return item.card;
  for (const p of s.players) {
    for (const zone of ['hand', 'deck', 'trash'] as const) {
      const c = p[zone].find((x) => x.uid === uid);
      if (c) return c;
    }
    for (const line of [0, 1, 2] as Line[]) {
      const c = p.stacks[line].find((x) => x.uid === uid);
      if (c) return c;
    }
  }
  return undefined;
}

/** 是否为其链路顶卡（未被覆盖；仅场上卡有意义） */
export function isUncovered(s: GameState, card: Card): boolean {
  if (card.zone !== 'field' || card.line === null) return false;
  const stack = s.players[card.owner].stacks[card.line];
  return stack[stack.length - 1]?.uid === card.uid;
}

/** 牌堆顶可打出性：牌库非空（playTopDeck 不洗弃牌堆——FAQ 142/166：从牌堆顶打出不强制洗牌，仅抽牌洗） */
export function deckTopAvailable(s: GameState, player: PlayerId): boolean {
  return s.players[player].deck.length > 0;
}

/** ice-6 顶「如果你有手牌，那么你不可以抽牌」（批2，裁决见 docs/批2裁决结果.md）：player 手牌 >0 且其
 *  场上任一线链路有正面 ice-6（顶命令被盖仍生效——查在场+正面）→ 禁一切抽牌路径（draw op/刷新/
 *  fromOpponentDeck/drawFromDeck；FAQ 冰6：刷新想抽必须能抽上牌，抽 0 无效）。手牌=0 不拦截。
 *  放本文件（而非 restrictions）避免 deck→restrictions→create→deck import 环。 */
export function shouldBlockDraw(s: GameState, player: PlayerId): boolean {
  if (s.players[player].hand.length === 0) return false;
  for (const line of [0, 1, 2] as Line[]) {
    for (const c of s.players[player].stacks[line]) {
      if (c.defId === 'ice-6' && c.faceUp && !cardCommandDisabled(s, c, 'top')) return true;
    }
  }
  return false;
}

function toChoiceCard(c: Card): ChoiceCard {
  const def = getCardDef(c.defId);
  return {
    uid: c.uid, defId: c.defId, faceUp: c.faceUp, owner: c.owner,
    zone: c.zone, line: c.line, pos: c.pos, label: String(def.value),
  };
}

/** 候选列表：手牌（指定 owner）或场上链路卡（默认双方各链路顶卡；covered:true 时列被覆盖的卡，均排除结算中源卡——幽灵状态防护） */
export function listCandidates(s: GameState, filter: CandidateFilter): ChoiceCard[] {
  const resolving = new Set(s.pendingEffects.map((pe) => pe.sourceUid));
  const out: ChoiceCard[] = [];
  if (filter.zone === 'hand') {
    const p = s.players[filter.owner!];
    for (const c of p.hand) out.push(toChoiceCard(c));
    return out;
  }
  for (const p of s.players) {
    if (filter.owner !== undefined && p !== s.players[filter.owner]) continue;
    for (const line of [0, 1, 2] as Line[]) {
      const stack = p.stacks[line];
      if (stack.length === 0) continue;
      if (filter.covered) {
        // covered: 列出该链路全部被覆盖的卡（排除顶卡——顶卡未被覆盖；排除结算中源卡）
        for (let i = 0; i < stack.length - 1; i++) {
          const c = stack[i];
          if (resolving.has(c.uid)) continue;
          out.push(toChoiceCard(c));
        }
      } else {
        const top = stack[stack.length - 1];
        if (resolving.has(top.uid)) continue;
        out.push(toChoiceCard(top));
      }
    }
  }
  return out;
}

export function createCtx(s: GameState, player: PlayerId, card: Card): EffectCtx {
  return { s, player, card, candidates: (filter) => listCandidates(s, filter) };
}

/** 发语义事件（特效层订阅；payload 含 protocol 供协议命名空间分发） */
export function emitCardEvent(
  s: GameState,
  type: string,
  card: Card,
  extra?: Record<string, unknown>,
): void {
  gameBus.emit({
    type,
    state: s,
    payload: {
      uid: card.uid, defId: card.defId, protocol: card.defId.split('-')[0],
      owner: card.owner, faceUp: card.faceUp, zone: card.zone,
      line: card.line, pos: card.pos, ...extra,
    },
  });
}

// —— 3代 区域禁用指令（inertia-0 顶禁顶 / inertia-1 底禁底；裁决 C7 全禁：触发/常驻/值修正）——
// 放本文件（context）避免 import 环：triggers/restrictions/create/resolve 均已直接或间接依赖 context。

/** 该线是否被 inertia-0 顶命令禁用顶指令：线上任一玩家链路有 faceUp inertia-0（顶命令被盖仍生效——faceUp 即可）。 */
export function lineTopCommandsDisabled(s: GameState, line: Line): boolean {
  return (
    s.players[0].stacks[line].some((c) => c.defId === 'inertia-0' && c.faceUp) ||
    s.players[1].stacks[line].some((c) => c.defId === 'inertia-0' && c.faceUp)
  );
}

/** 该线是否被 inertia-1 底命令禁用底指令：仅 inertia-1 顶卡（未覆盖 faceUp）时生效（底命令仅未覆盖）。 */
export function lineBottomCommandsDisabled(s: GameState, line: Line): boolean {
  for (const owner of [0, 1] as PlayerId[]) {
    const stack = s.players[owner].stacks[line];
    const top = stack[stack.length - 1];
    if (top && top.defId === 'inertia-1' && top.faceUp && isUncovered(s, top)) return true;
  }
  return false;
}

/** 单卡某框指令是否被区域禁用（顶框 = inertia-0 链；底框 = inertia-1 链）；禁用卡自身免疫。 */
export function cardCommandDisabled(s: GameState, card: Card, kind: 'top' | 'bottom'): boolean {
  if (card.zone !== 'field' || card.line === null) return false;
  if (kind === 'top') {
    if (card.defId === 'inertia-0') return false;
    return lineTopCommandsDisabled(s, card.line);
  }
  if (card.defId === 'inertia-1') return false;
  return lineBottomCommandsDisabled(s, card.line);
}

/** rigidity-7 底「此牌不能被翻转或偏转」：未被覆盖（faceUp 顶卡）且底命令未被区域禁用 → 免疫翻/移（C11）。 */
export function rigidity7Immune(s: GameState, card: Card): boolean {
  return card.defId === 'rigidity-7' && card.faceUp && isUncovered(s, card) && !cardCommandDisabled(s, card, 'bottom');
}

