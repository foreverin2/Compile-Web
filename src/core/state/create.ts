import type { GameState, PlayerId, PlayerState, Line, ProtocolDef, Card } from '../models/types';
import { DEMO_PROTOCOLS, DEMO_CARD_DEFS, getCardDef } from '../../data/demo';
import { drawCards, shuffle } from '../engine/deck';
import { EFFECTS } from '../effects/registry';

let uidCounter = 0;
export function nextUid(): string {
  uidCounter += 1;
  return `c${uidCounter}`;
}

/** 1-2-2-1 轮选相对模式：0 = 先手方（draftStarter），1 = 另一方（座位由 draftStarter 派生） */
const DRAFT_PATTERN: PlayerId[] = [0, 1, 1, 0, 0, 1];
/** 草稿轮选总次数 */
export const DRAFT_PICK_COUNT = DRAFT_PATTERN.length;

/** 第 round 次选择轮到谁（座位）：模式 0 → draftStarter，模式 1 → 另一玩家。
 *  掷硬币流程（2026-09-03）把 draftStarter 设为硬币胜者；默认 0 时即旧固定顺序。 */
export function draftRoundOwner(draftStarter: PlayerId, round: number): PlayerId {
  const rel = DRAFT_PATTERN[round] ?? 1;
  return rel === 0 ? draftStarter : ((1 - draftStarter) as PlayerId);
}

export interface CreateGameOptions {
  /** 首位选择协议的玩家（掷硬币胜者）；默认 0 = 玩家一 */
  draftStarter?: PlayerId;
  /** 对局中先出牌的玩家；默认 0。用户拍板：硬币流程下后选者先出 → 由调用方传 1 - draftStarter */
  firstToPlay?: PlayerId;
}

function emptyPlayer(): PlayerState {
  return { hand: [], deck: [], trash: [], protocols: [], stacks: [[], [], []] };
}

export function createGame(opts: CreateGameOptions = {}): GameState {
  const draftStarter: PlayerId = opts.draftStarter ?? 0;
  return {
    phase: 'draft',
    draftRound: 0,
    draftPicks: [],
    draftStarter,
    firstToPlay: opts.firstToPlay ?? 0,
    turnPlayer: 0,
    turnCount: 0,
    step: 'start',
    compiledThisTurn: false,
    players: [emptyPlayer(), emptyPlayer()],
    control: -1,
    winner: null,
    log: [],
    pendingEffects: [],
    pendingPlay: [],
    pendingShift: [],
    resolvedTriggerUids: [],
    pendingStepAdvance: false,
    revealedGhosts: [],
    compileBlocked: null,
    pendingCompile: null,
  };
}

export function getDraftPool(s: GameState): ProtocolDef[] {
  const picked = new Set(s.draftPicks.map((p) => p.defId));
  return DEMO_PROTOCOLS.filter((p) => !picked.has(p.defId));
}

export function getCurrentDrafter(s: GameState): PlayerId {
  return draftRoundOwner(s.draftStarter, s.draftRound);
}

/** 当前回合（同一玩家的连续轮次）的选牌索引范围 [start, end) */
export function draftTurnRange(draftStarter: PlayerId, round: number): { start: number; end: number } {
  const player = draftRoundOwner(draftStarter, round);
  let start = round;
  while (start > 0 && draftRoundOwner(draftStarter, start - 1) === player) start--;
  let end = round + 1;
  while (end < DRAFT_PICK_COUNT && draftRoundOwner(draftStarter, end) === player) end++;
  return { start, end };
}

/** 该 defId 是否是【本回合尚未结束】时选中的协议（可取消拖出；前几个回合选的不行） */
export function canUnpick(s: GameState, defId: string): boolean {
  if (s.phase !== 'draft') return false;
  const { start } = draftTurnRange(s.draftStarter, s.draftRound);
  return s.draftPicks.slice(start).some((p) => p.defId === defId);
}

/** 取消本回合的选择：从已选列表移除并回退轮次（该协议回到协议池，可重新选择） */
export function performDraftUnpick(s: GameState, defId: string): void {
  if (s.phase !== 'draft') throw new Error('not in draft phase');
  const { start } = draftTurnRange(s.draftStarter, s.draftRound);
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
        faceUp: false, // 牌库 = 秘密信息（R11.4）：入牌库的卡一律反面，抽出时 drawCards 置正面
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
  if (s.draftRound >= DRAFT_PICK_COUNT) {
    // 分配：按 1-2-2-1 相对模式把 6 次选择归到两个座位（各 3 套，按选择顺序排线）
    const picksBySeat: [ProtocolDef[], ProtocolDef[]] = [[], []];
    s.draftPicks.forEach((pick, i) => {
      picksBySeat[draftRoundOwner(s.draftStarter, i)].push(pick);
    });
    assignProtocols(s, 0, picksBySeat[0]);
    assignProtocols(s, 1, picksBySeat[1]);
    s.phase = 'turn';
    s.step = 'start';
    // 用户拍板（2026-09-03）：后选协议者先出牌 → firstToPlay（默认 0 兼容旧流程）
    s.turnPlayer = s.firstToPlay;
    // 开局前洗牌：起始手牌每局不同（“洗成牌库”）
    s.players[0].deck = shuffle(s.players[0].deck);
    s.players[1].deck = shuffle(s.players[1].deck);
    drawCards(s, 0, 5);
    drawCards(s, 1, 5);
    s.log.push('Setup complete. Starting hand drawn (5 each).');
  }
}

/** 线堆叠总值：面朝上卡按印刷值求和；面朝下卡值=2。随后应用该线双方堆叠中注册了 valueModifier 的卡
 *  （own-stack 只作用于拥有者总值；opponent-line 只作用于对手同线总值；own 堆叠先、对手堆叠后） */
export function stackValue(s: GameState, player: PlayerId, line: Line): number {
  const p = s.players[player];
  let total = 0;
  for (const card of p.stacks[line]) {
    total += card.faceUp ? getCardDef(card.defId).value : 2;
  }
  const opp: PlayerId = player === 0 ? 1 : 0;
  // line 目标：线上任一玩家堆叠中的正面修正卡即对双方估值生效；每估值只用估值方堆叠应用一次（多张不叠加）
  let lineMod = false;
  for (const owner of [player, opp]) {
    for (const card of s.players[owner].stacks[line]) {
      const v = EFFECTS[card.defId]?.valueModifier;
      // 背面朝下的卡没有协议属性/指令效果 → 修正卡必须正面朝上才生效（被覆盖但正面朝上仍常驻生效）
      if (!v || !card.faceUp) continue;
      if (v.target === 'own-stack' && owner === player) total = v.apply(s, owner, line, total);
      if (v.target === 'opponent-line' && owner !== player) total = v.apply(s, owner, line, total);
      // line 目标：apply 的 owner 参数传估值方 player，使修正（如 darkness-2 数反面牌）按估值方堆叠计算
      if (v.target === 'line' && !lineMod) {
        lineMod = true;
        total = v.apply(s, player, line, total);
      }
    }
  }
  return total;
}

/** 线顶命令常驻生效判定：该线双方堆叠中是否存在正面朝上的 defId 卡。
 *  规则：背面卡无任何效果；正面顶命令被覆盖后仍常驻生效 → 只要有正面卡在线上即 active（被覆盖与否无关）。 */
export function lineTopCommandActive(s: GameState, line: Line, defId: string): boolean {
  return (
    s.players[0].stacks[line].some((c) => c.defId === defId && c.faceUp) ||
    s.players[1].stacks[line].some((c) => c.defId === defId && c.faceUp)
  );
}

export function getLineValue(s: GameState, player: PlayerId, line: Line): number {
  return stackValue(s, player, line);
}

/** 单卡当前分值：正面 = 牌面分值；反面 = 2，但所在线有正面 darkness-2 顶命令时 = 4。
 *  R11.4 例外（light-0 翻面后抽牌，卡可能已离场）：
 *  - 弃牌堆（公开、正面朝上）→ 牌面分值（delete 置 faceUp=true → 走 faceUp 分支）；
 *  - 牌库（秘密信息）→ 一律 2（zone 守卫：即使入牌库路径漏设 faceUp=false 也按反面计；
 *    darkness-2 只作用于场线，牌库卡 line=null 不受其修正）。 */
export function cardPointValue(s: GameState, card: Card): number {
  if (card.zone === 'deck') return 2; // 牌库 = 秘密：不随 faceUp 标志变化
  if (card.faceUp) return getCardDef(card.defId).value;
  const line = card.line;
  if (line !== null && lineTopCommandActive(s, line, 'darkness-2')) return 4;
  return 2;
}
