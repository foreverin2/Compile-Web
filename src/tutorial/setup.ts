/**
 * ★ 2026-10-02（P2）：**受控局面**的布置（每关一个）。
 *
 * ## 做法：`createGame()` 之后**直接改 state**（本仓测试里就是这么干的）
 *
 * `tests/actions/base.test.ts` / `tests/effects/flip.test.ts` 等一大批测试都是
 * `const s = createGame(); s.phase = 'turn'; …` 把局面摆成想要的样子 —— 本文件照这个做法，
 * **不碰 `core/**`**（一个字都不改）：引擎的 `GameState` 是普通对象，改它就是改局面。
 *
 * ## 为什么不做"合成教学卡"（这一条改过主意，理由记下来）
 *
 * 方案 §5.2 写的是"用**教学卡**各做一次"。我第一版打算给 T3 注册五个合成 defId
 * （`registerCardEffects('tutorial-flip', …)`），实测**行不通**，两个理由：
 *  1. `src/data/demo.ts` 的 `getCardDef()` 对未知 defId **当场抛**；牌面图走
 *     `splitDefId(card.defId)` → `/assets/protocols/<协议>/card-<值>.<png>` ⇒ 合成 defId
 *     没有美术资源，卡面是**裂图**（不崩，但玩家看到的是五个破图）；
 *  2. 想让它有图就得借真协议的 defId，而效果注册表**按 defId 全局唯一**
 *     （`EFFECTS[defId] = …`）⇒ 那会**覆盖真卡的效果**，等于改游戏数据。绝不可以。
 * ⇒ 改成：**用真卡**（`water-4` 回手 / `darkness-4` 偏转 / `spirit-1` 抽牌 / `spirit-2` 翻转 /
 *   `spirit-5` 弃牌）。它们的**中指令本来就是这五个基础动作**，卡面是真的、提示是真的、
 *   链路是真的 —— 比合成卡更接近"从零到能玩"。代价如实登记（方案 §7.8）：
 *   这些卡的选择浮层标题是引擎里的中文（`src/core/effects/**` 是红线），英文界面下那几句仍是中文。
 */
import { createGame } from '../core/state/create';
import type { Card, GameState, Line, PlayerId } from '../core/models/types';
import type { TutLevelId } from './types';

/** 造一张卡（与 `tests/helpers.ts` 的 `makeCard` 同形；本模块不 import 测试代码） */
function card(
  uid: string,
  defId: string,
  owner: PlayerId = 0,
  zone: Card['zone'] = 'hand',
  faceUp = true,
  line: Line | null = null,
  pos = 0,
): Card {
  return { uid, defId, owner, faceUp, zone, line, pos: zone === 'field' ? pos : null };
}

/** 三条链路各挂一个真协议（`defId` 必须是 `src/data/cards*.ts` 里有的，否则渲染会抛） */
function protocols(a: string, b: string, c: string): GameState['players'][0]['protocols'] {
  return [{ defId: a, compiled: false }, { defId: b, compiled: false }, { defId: c, compiled: false }];
}

/**
 * 把 `createGame()` 的草稿局**就地改成**一局"轮到玩家 0 行动"的受控局。
 *
 * 草稿期的一切（`draftPicks` / `draftRound` / `draftPool`）都清干净：教学**不玩草稿**
 * （方案 §5.1："跳过草稿"），留着它们只会让渲染器画出不该有的草稿态。
 */
function controlledGame(seed: string, lineProtocols: readonly [string, string, string]): GameState {
  const s = createGame({ seed, draftStarter: 0, firstToPlay: 0 });
  s.phase = 'turn';
  s.step = 'action';
  s.turnPlayer = 0;
  s.turnCount = 1;
  s.draftRound = 6;          // 草稿已打完（与 `createGame` 打完草稿后的取值一致）
  s.draftPicks = [];
  s.draftPool = [];
  s.compiledThisTurn = false;
  s.control = -1;
  s.winner = null;
  s.log = [];
  s.pendingEffects = [];
  s.pendingPlay = [];
  s.pendingShift = [];
  s.players[0].protocols = protocols(...lineProtocols);
  // 对手（座位 1）也要有协议：阈值/控制权两处要用它算，缺了渲染器会画出空线
  s.players[1].protocols = protocols(...lineProtocols);
  return s;
}

/**
 * 每关的受控局面。
 *
 * 三条链路的协议固定为 `spirit` / `water` / `darkness`：T3 那五张真卡正好各回各家
 * （`spirit-*` → 线 0、`water-4` → 线 1、`darkness-4` → 线 2），玩家打出时不用猜线。
 */
export function buildLevelState(id: TutLevelId): GameState {
  if (id === 'T0') {
    // T0 只看界面：给一个"有牌可看"的空场，手牌 1 张，免得玩家以为可以打
    const s = controlledGame('tutorial-T0', ['spirit', 'water', 'darkness']);
    s.players[0].hand = [card('t0h1', 'spirit-1')];
    s.players[0].deck = [];
    return s;
  }
  if (id === 'T1') {
    // T1 打第一张牌：手牌 2 张，其中 spirit-1（正面）与 water-1（正面）各能进一条线
    const s = controlledGame('tutorial-T1', ['spirit', 'water', 'darkness']);
    s.players[0].hand = [card('t1h1', 'spirit-1'), card('t1h2', 'water-1')];
    s.players[0].deck = [];
    return s;
  }
  if (id === 'T2') {
    // T2 正反面：手牌 2 张（`spirit-1` / `water-1`），玩家要一张正面、一张反面
    const s = controlledGame('tutorial-T2', ['spirit', 'water', 'darkness']);
    s.players[0].hand = [card('t2h1', 'spirit-1'), card('t2h2', 'water-1')];
    s.players[0].deck = [];
    return s;
  }
  /**
   * T3 五个基础动作。**局面的每一处都是为了让某个动作"够得着"**：
   *  - 抽牌：玩家 0 的牌库非空（`spirit-1` 中指令"抽2张牌"）；
   *  - 翻转：自己的场上有正面牌（`spirit-2` 中指令"你可以翻转1张牌"）；
   *  - 弃牌：手牌里除了那五张之外还有 1 张可弃的（`spirit-5` 中指令"弃1张牌"）；
   *  - 偏转：自己的场上有**反面**牌（`darkness-4` 中指令"偏转1张反面牌"）；
   *  - 回手：自己的场上有正面牌（`water-4` 中指令"回手1张你的牌"）。
   *
   * ⚠️ 场上的两张真卡是**为了当目标**，不是教学卡：`spirit-3`（3 分）与 `water-1`（1 分）。
   */
  const s = controlledGame('tutorial-T3', ['spirit', 'water', 'darkness']);
  s.players[0].hand = [
    card('t3h-flip', 'spirit-2', 0, 'hand', true),
    card('t3h-shift', 'darkness-4', 0, 'hand', true),
    card('t3h-draw', 'spirit-1', 0, 'hand', true),
    card('t3h-discard', 'spirit-5', 0, 'hand', true),
    card('t3h-return', 'water-4', 0, 'hand', true),
    card('t3h-fodder', 'spirit-0', 0, 'hand', true),
  ];
  // 牌库 3 张：抽牌那一步有牌可抽（`spirit-1` 抽 2 张）
  s.players[0].deck = [
    card('t3d1', 'spirit-3', 0, 'deck'),
    card('t3d2', 'water-2', 0, 'deck'),
    card('t3d3', 'darkness-2', 0, 'deck'),
  ];
  // 场上：线 0 一张**正面**（翻转与回手的目标），线 1 一张**反面**（偏转的目标）
  s.players[0].stacks[0] = [card('t3f-up', 'spirit-3', 0, 'field', true, 0, 0)];
  s.players[0].stacks[1] = [card('t3f-down', 'water-2', 0, 'field', false, 1, 0)];
  // 对手线 0 一张正面牌：让"阈值/控制权"两个读数有东西可显示
  s.players[1].stacks[0] = [card('t3o-up', 'spirit-2', 1, 'field', true, 0, 0)];
  return s;
}
