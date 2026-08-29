import type { GameState, PlayerId, PlayerState, Line, ProtocolDef, Card } from '../models/types';
import { DEMO_PROTOCOLS, DEMO_CARD_DEFS, getCardDef } from '../../data/demo';
import { drawCards, shuffle } from '../engine/deck';

let uidCounter = 0;
export function nextUid(): string {
  uidCounter += 1;
  return `c${uidCounter}`;
}

/** 1-2-2-1 轮选顺序：第 i 次选择轮到谁 */
const DRAFT_ORDER: PlayerId[] = [0, 1, 1, 0, 0, 1];

function emptyPlayer(): PlayerState {
  return { hand: [], deck: [], trash: [], protocols: [], stacks: [[], [], []] };
}

export function createGame(): GameState {
  return {
    phase: 'draft',
    draftRound: 0,
    draftPicks: [],
    turnPlayer: 0,
    step: 'start',
    compiledThisTurn: false,
    players: [emptyPlayer(), emptyPlayer()],
    control: -1,
    winner: null,
    log: [],
    pendingEffects: [],
    pendingPlay: null,
    pendingShift: null,
    resolvedTriggerUids: [],
    pendingStepAdvance: false,
    revealedGhosts: [],
  };
}

export function getDraftPool(s: GameState): ProtocolDef[] {
  const picked = new Set(s.draftPicks.map((p) => p.defId));
  return DEMO_PROTOCOLS.filter((p) => !picked.has(p.defId));
}

export function getCurrentDrafter(s: GameState): PlayerId {
  return DRAFT_ORDER[s.draftRound] ?? 1;
}

/** 当前回合（同一玩家的连续轮次）的选牌索引范围 [start, end) */
export function draftTurnRange(round: number): { start: number; end: number } {
  const player = DRAFT_ORDER[round] ?? 1;
  let start = round;
  while (start > 0 && DRAFT_ORDER[start - 1] === player) start--;
  let end = round + 1;
  while (end < DRAFT_ORDER.length && DRAFT_ORDER[end] === player) end++;
  return { start, end };
}

/** 该 defId 是否是【本回合尚未结束】时选中的协议（可取消拖出；前几个回合选的不行） */
export function canUnpick(s: GameState, defId: string): boolean {
  if (s.phase !== 'draft') return false;
  const { start } = draftTurnRange(s.draftRound);
  return s.draftPicks.slice(start).some((p) => p.defId === defId);
}

/** 取消本回合的选择：从已选列表移除并回退轮次（该协议回到协议池，可重新选择） */
export function performDraftUnpick(s: GameState, defId: string): void {
  if (s.phase !== 'draft') throw new Error('not in draft phase');
  const { start } = draftTurnRange(s.draftRound);
  const idx = s.draftPicks.findIndex((p, i) => i >= start && p.defId === defId);
  if (idx === -1) throw new Error(`cannot unpick ${defId}: not picked this turn`);
  const [removed] = s.draftPicks.splice(idx, 1);
  s.draftRound -= 1;
  s.log.push(`P${getCurrentDrafter(s) + 1} 取消选择 ${removed.name}`);
}

/** 每人 3 协议按草案顺序排线：选中的协议按选择顺序依次放入 0/1/2 线 */
function assignProtocols(s: GameState, player: PlayerId, picks: ProtocolDef[]): void {
  const p = s.players[player];
  p.protocols = picks.map((def) => ({ defId: def.defId, compiled: false }));
  for (let line = 0; line < 3; line++) {
    const def = picks[line];
    if (!def) break;
    const cards = DEMO_CARD_DEFS.filter((c) => c.protocol === def.defId);
    for (const cardDef of cards) {
      const card: Card = {
        uid: nextUid(),
        defId: cardDef.defId,
        owner: player,
        faceUp: true,
        zone: 'deck',
        line: null,
        pos: null,
      };
      p.deck.push(card);
    }
  }
}

/** 草案选择：defId 必须是当前可选协议 */
export function performDraftPick(s: GameState, defId: string): void {
  if (s.phase !== 'draft') throw new Error('not in draft phase');
  const def = getDraftPool(s).find((p) => p.defId === defId);
  if (!def) throw new Error(`protocol ${defId} not available`);
  const drafter = getCurrentDrafter(s);
  s.draftPicks.push(def);
  s.log.push(`P${drafter + 1} 选择 ${def.name}`);
  s.draftRound += 1;
  if (s.draftRound >= DRAFT_ORDER.length) {
    // 分配：P1 的第 1、3、4 次选择；P2 的第 2、5、6 次选择
    const p1Picks = [s.draftPicks[0], s.draftPicks[3], s.draftPicks[4]].filter(Boolean);
    const p2Picks = [s.draftPicks[1], s.draftPicks[2], s.draftPicks[5]].filter(Boolean);
    assignProtocols(s, 0, p1Picks as ProtocolDef[]);
    assignProtocols(s, 1, p2Picks as ProtocolDef[]);
    s.phase = 'turn';
    s.step = 'start';
    // 开局前洗牌：起始手牌每局不同（“洗成牌库”）
    s.players[0].deck = shuffle(s.players[0].deck);
    s.players[1].deck = shuffle(s.players[1].deck);
    drawCards(s, 0, 5);
    drawCards(s, 1, 5);
    s.log.push('Setup complete. Starting hand drawn (5 each).');
  }
}

/** 线堆叠总值：本阶段所有卡面朝上，按印刷值求和；面朝下卡值=2（后续任务实现覆盖机制时保持此规则） */
export function stackValue(p: PlayerState, line: Line): number {
  let total = 0;
  for (const card of p.stacks[line]) {
    if (!card.faceUp) {
      total += 2;
    } else {
      const def = getCardDef(card.defId);
      total += def.value;
    }
  }
  return total;
}

export function getLineValue(s: GameState, player: PlayerId, line: Line): number {
  return stackValue(s.players[player], line);
}
