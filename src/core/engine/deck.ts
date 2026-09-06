import { pushLog } from '../log';
import type { Card, GameState, PlayerId } from '../models/types';
import { fireReactive } from '../effects/triggers';
import { shouldBlockDraw } from '../effects/context';
import { gameBus } from '../events/bus';

export function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** 从牌库顶抽 count 张；牌库不足则洗弃牌堆重组，再抽满。
 *  ice-6 顶（批2）在场且抽牌者手牌>0 → 禁止抽牌（FAQ 冰6：抽 0 无效；不抽不洗不触发连锁） */
export function drawCards(s: GameState, player: PlayerId, count: number): Card[] {
  if (shouldBlockDraw(s, player)) return [];
  const p = s.players[player];
  const drawn: Card[] = [];
  for (let i = 0; i < count; i++) {
    if (p.deck.length === 0) {
      if (p.trash.length === 0) break;
      p.deck = shuffle(p.trash);
      p.trash = [];
      // R11.4：弃牌堆 → 牌库 = 进入秘密信息区：弃牌堆的正面卡回牌库后必须翻回反面
      // （否则 cardPointValue 会误按牌面分值计；牌库卡一律视为反面 2）
      for (const c of p.deck) c.faceUp = false;
    }
    const card = p.deck.pop()!;
    card.zone = 'hand';
    // 手牌 = 已知信息：抽入即解禁——即使该卡带牌堆来源的 secret 标记（曾被弃牌堆洗回牌库），
    // 进入手牌后也可见正面（与 return op 回手即解禁一致）
    card.secret = false;
    card.line = null;
    card.pos = null;
    card.faceUp = true;
    drawn.push(card);
    p.hand.push(card);
  }
  // 抽牌完成 → 即时连锁：抽牌者场上注册了 after-draw 的正面卡触发（顶命令，被盖仍生效；
  // 覆盖所有抽牌路径：效果 draw op / refreshHand / 开局 setup / love 刷新等）
  // 真抽到牌才触发（牌库+弃牌堆双空抽 0 张不触发——「你抽牌后」语义）
  if (drawn.length > 0) {
    fireReactive(s, 'after-draw', player);
    // 2代 mirror-4/war-0 底「当对手抽牌时：…」：抽牌者【对手】侧注册的 after-opponent-draw 触发
    fireReactive(s, 'after-opponent-draw', player);
  }
  return drawn;
}

/** 洗牌库（明确洗牌事件点；clarity-2/3 切洗、clarity-4 洗入弃牌堆、批3 time 类共用）。
 *  牌库卡一律翻回反面（牌库=秘密信息区，cardPointValue 按反面 2 计）。secret 标记不动
 *  （与 drawCards 洗弃牌堆同惯例）。发 'deck:shuffled' 事件（FX/动画层可选订阅）。 */
export function shuffleDeck(s: GameState, player: PlayerId): void {
  const p = s.players[player];
  if (p.deck.length <= 1) {
    // 无/单张无需洗，但仍发事件便于 UI 一致呈现（长度 0 也发——time-0 从弃牌堆打出后洗空堆等场景）
    gameBus.emit({ type: 'deck:shuffled', state: s, payload: { player } });
  } else {
    p.deck = shuffle(p.deck);
    for (const c of p.deck) c.faceUp = false;
    gameBus.emit({ type: 'deck:shuffled', state: s, payload: { player } });
    pushLog(s, `P${player + 1} 切洗牌库`);
  }
  // 批3 time-2 顶「当你切洗牌库时：抽取1张牌」（self 方向，top:true 被盖仍触发）
  fireReactive(s, 'after-shuffle', player);
}

/** 弃牌堆洗入牌库（clarity-4「你可以将弃牌堆洗入牌库」）：trash 全部并入 deck 后切洗；
 *  弃牌堆空 → 无操作（调用方守卫可选语义）。洗入的卡翻回反面（牌库=秘密）。 */
export function shuffleTrashIntoDeck(s: GameState, player: PlayerId): void {
  const p = s.players[player];
  if (p.trash.length === 0) return;
  for (const c of p.trash) {
    c.zone = 'deck';
    c.line = null;
    c.pos = null;
    c.faceUp = false;
  }
  p.deck.push(...p.trash);
  p.trash = [];
  shuffleDeck(s, player);
  pushLog(s, `P${player + 1} 将弃牌堆洗入牌库`);
}

/** 手牌 → 弃牌堆（正面朝上） */
export function discardFromHand(s: GameState, player: PlayerId, cardUid: string): Card {
  const p = s.players[player];
  const idx = p.hand.findIndex((c) => c.uid === cardUid);
  if (idx === -1) throw new Error(`card ${cardUid} not in hand of player ${player}`);
  const [card] = p.hand.splice(idx, 1);
  card.zone = 'trash';
  card.faceUp = true;
  card.line = null;
  card.pos = null;
  p.trash.push(card);
  return card;
}

/** 清缓存：手牌 >5 时弃至 5 张（弃最后几张），返回被弃卡 */
export function clearCache(s: GameState, player: PlayerId): Card[] {
  const p = s.players[player];
  const excess = p.hand.length - 5;
  if (excess <= 0) return [];
  const discarded: Card[] = [];
  for (let i = 0; i < excess; i++) {
    const card = p.hand.pop()!;
    card.zone = 'trash';
    card.faceUp = true;
    card.line = null;
    card.pos = null;
    p.trash.push(card);
    discarded.push(card);
  }
  return discarded;
}

