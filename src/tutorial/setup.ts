/**
 * ★ 2026-10-02（P2/P5）：**受控局面**的布置（每关一个）。
 *
 * ## 做法：`createGame()` 之后**直接改 state**（本仓测试里就是这么干的）
 *
 * `tests/actions/base.test.ts` / `tests/effects/flip.test.ts` 等一大批测试都是
 * `const s = createGame(); s.phase = 'turn'; …` 把局面摆成想要的样子 —— 本文件照这个做法，
 * **不碰 `core/**`**（一个字都不改）：引擎的 `GameState` 是普通对象，改它就是改局面。
 *
 * ## 为什么不做"合成教学卡"（改过主意，理由记下来）
 *
 * 方案 §5.2 写的是"用**教学卡**各做一次"。第一版打算给 T4 注册五个合成 defId，**实测行不通**：
 *  1. `src/data/demo.ts` 的 `getCardDef()` 对未知 defId **当场抛**；牌面图走
 *     `splitDefId(card.defId)` → `/assets/protocols/<协议>/card-<值>.<png>` ⇒ 合成 defId
 *     没有美术资源，卡面是**裂图**（不崩，但玩家看到的是破图）；
 *  2. 想让它有图就得借真协议的 defId，而效果注册表**按 defId 全局唯一**
 *     （`EFFECTS[defId] = …`）⇒ 那会**覆盖真卡的效果**，等于改游戏数据。绝不可以。
 * ⇒ 改成**用真卡**（`water-4` 回手 / `darkness-4` 偏转 / `spirit-1` 抽牌 / `spirit-2` 翻转 /
 *   `spirit-5` 弃牌）。它们的**中指令本来就是这五个基础动作**，卡面是真的、提示是真的、
 *   链路是真的 —— 比合成卡更接近"从零到能玩"。代价如实登记（方案 §7.8）。
 *
 * ## ★ 2026-10-02 追加两课需要的两样"特殊卡"
 *
 *  - **T1（卡牌详情）**：任一张真卡双击即可放大 ⇒ 局面只要"有牌可看"；
 *  - **T6（反面牌可视规则）**：要摆出**两个对照**，靠的是 `Card.secret`（`types.ts:48`）：
 *    · 能看 = 自己场上、反面、`secret !== true`（**从手牌打出的反面牌**就是这样，
 *      `resolve.ts` 只在"牌堆来源"的反面打出时置 `secret = true`）；
 *    · 不能看 = 自己场上、反面、`secret === true`（**模拟"被效果从牌库召唤到场上的反面牌"**：
 *      引擎里对应 `playTopDeck` / `deckTopTransfer` 那两条 op，它们置 `secret = true`）。
 *
 * ## ★ 2026-10-02（P6）再追加两课需要的局面
 *
 *  - **T7（默认目标规则）**：同一张目标牌要被**两档候选**分别看一眼 —— 默认档看它"不在候选里"、
 *    明写「被覆盖」的卡看它"在候选里"；
 *  - **T9（打出 vs 露出）**：两张速度0，一条路靠**翻正**、一条路靠**偏转走盖着它的那张**。
 *    这两关的局面各有几处不显然的取舍，逐条写在下面各自的注释里（哪一张为什么在对手那边、
 *    哪条线为什么挂什么协议）—— 那些都是"不这么摆就跑不通"的实测结论，不是随手放的。
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
  secret = false,
): Card {
  return {
    uid, defId, owner, faceUp, zone, line,
    pos: zone === 'field' ? pos : null,
    // 只给"非公开信息"那张卡打标记：别的卡留 `false`（与引擎"从手牌打出"的口径一致）
    ...(secret ? { secret: true } : {}),
  };
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
 * 三条链路的协议固定为 `spirit` / `water` / `darkness`：T4 那五张真卡正好各回各家
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
    // T1（卡牌详情）：手牌 2 张 + 自己场上 1 张正面卡 —— 双击哪一张都能放大
    const s = controlledGame('tutorial-T1', ['spirit', 'water', 'darkness']);
    s.players[0].hand = [card('t1h1', 'spirit-1'), card('t1h2', 'water-1')];
    s.players[0].deck = [];
    s.players[0].stacks[0] = [card('t1f1', 'spirit-3', 0, 'field', true, 0, 0)];
    return s;
  }
  if (id === 'T2') {
    // T2 打第一张牌：手牌 2 张，其中 spirit-1（正面）与 water-1（正面）各能进一条线
    const s = controlledGame('tutorial-T2', ['spirit', 'water', 'darkness']);
    s.players[0].hand = [card('t2h1', 'spirit-1'), card('t2h2', 'water-1')];
    s.players[0].deck = [];
    return s;
  }
  if (id === 'T3') {
    // T3 正反面：手牌 2 张（`spirit-1` / `water-1`），玩家要一张正面、一张反面
    const s = controlledGame('tutorial-T3', ['spirit', 'water', 'darkness']);
    s.players[0].hand = [card('t3h1', 'spirit-1'), card('t3h2', 'water-1')];
    s.players[0].deck = [];
    return s;
  }
  if (id === 'T4') {
    /**
     * T4 五个基础动作。**局面的每一处都是为了让某个动作"够得着"**：
     *  - 抽牌：玩家 0 的牌库非空（`spirit-1` 中指令"抽2张牌"）；
     *  - 翻转：自己的场上有正面牌（`spirit-2` 中指令"你可以翻转1张牌"）；
     *  - 弃牌：手牌里除了那五张之外还有 1 张可弃的（`spirit-5` 中指令"弃1张牌"）；
     *  - 偏转：自己的场上有**反面**牌（`darkness-4` 中指令"偏转1张反面牌"）；
     *  - 回手：自己的场上有正面牌（`water-4` 中指令"回手1张你的牌"）。
     *
     * ⚠️ 场上的两张真卡是**为了当目标**，不是教学卡：`spirit-3`（3 分）与 `water-2`（2 分）。
     */
    const s = controlledGame('tutorial-T4', ['spirit', 'water', 'darkness']);
    s.players[0].hand = [
      card('t4h-flip', 'spirit-2', 0, 'hand', true),
      card('t4h-shift', 'darkness-4', 0, 'hand', true),
      card('t4h-draw', 'spirit-1', 0, 'hand', true),
      card('t4h-discard', 'spirit-5', 0, 'hand', true),
      card('t4h-return', 'water-4', 0, 'hand', true),
      card('t4h-fodder', 'spirit-0', 0, 'hand', true),
    ];
    // 牌库 3 张：抽牌那一步有牌可抽（`spirit-1` 抽 2 张）
    s.players[0].deck = [
      card('t4d1', 'spirit-3', 0, 'deck'),
      card('t4d2', 'water-2', 0, 'deck'),
      card('t4d3', 'darkness-2', 0, 'deck'),
    ];
    // 场上：线 0 一张**正面**（翻转与回手的目标），线 1 一张**反面**（偏转的目标）
    s.players[0].stacks[0] = [card('t4f-up', 'spirit-3', 0, 'field', true, 0, 0)];
    s.players[0].stacks[1] = [card('t4f-down', 'water-2', 0, 'field', false, 1, 0)];
    // 对手线 0 一张正面牌：让"阈值/控制权"两个读数有东西可显示
    s.players[1].stacks[0] = [card('t4o-up', 'spirit-2', 1, 'field', true, 0, 0)];
    return s;
  }
  if (id === 'T5') {
    /**
     * T5 覆盖与揭开：对手线 0 上有一张**反面**牌，玩家手里有一张能进线 0 的正面牌。
     *
     * 覆盖 = 打出的牌叠到对手那张上面（它变成"被盖住"）。`isUncovered()`（`context.ts:31`）
     * 判"是不是堆顶且未覆盖"，判据用的就是它。
     */
    const s = controlledGame('tutorial-T5', ['spirit', 'water', 'darkness']);
    // ⚠️ 手里必须拿 `corruption-0`：只有它「可以打在任意一方的任意协议处」
    //    （`src/core/actions/base.ts:73` + `rules/restrictions.ts:88`）—— 别的牌打对方场会被引擎拒。
    s.players[0].hand = [card('t5h1', 'corruption-0', 0, 'hand', true)];
    s.players[0].deck = [];
    // 对手线 0：反面一张（`secret` 不打 —— 那是"从手牌打出"的口径）
    s.players[1].stacks[0] = [card('t5o1', 'spirit-1', 1, 'field', false, 0, 0)];
    return s;
  }
  if (id === 'T6') {
    /**
     * T6 反面牌可视规则：**两个对照就摆在自己场上的线 0 与线 1**。
     *
     *  - 线 0：`secret` **未置**（= 从手牌打出的反面牌 / 已公开过的）⇒ **能看正面**；
     *  - 线 1：`secret: true`（= 被效果从牌库召唤到场上的反面牌）⇒ **不能看正面**。
     *
     * 判据读的是"详情里有没有 `.zoom-peek-btn`"（`render.ts:418` 的 `peek` 实参决定），
     * 纯函数镜像见 `types.ts` 的 `canPeekFaceDown()`（有源码腿与 `render.ts` 逐字比对）。
     */
    const s = controlledGame('tutorial-T6', ['spirit', 'water', 'darkness']);
    s.players[0].hand = [];
    s.players[0].deck = [];
    // 能看：反面、非 secret（从手牌打出的反面牌就是这个形态）
    s.players[0].stacks[0] = [card('t6f-open', 'spirit-3', 0, 'field', false, 0, 0)];
    // 不能看：反面 + secret（牌库来源的反面打出 = 非公开信息）
    s.players[0].stacks[1] = [card('t6f-secret', 'water-2', 0, 'field', false, 1, 0, true)];
    return s;
  }
  if (id === 'T7') {
    /**
     * ★ 2026-10-02（P6 任务 A.1）T7「默认目标规则」：**两个对照必须是同一张目标牌**。
     *
     *  - 被盖住的目标：线 0（精神）上 `t7f-buried`（精神3，**正面**）被 `t7f-cover`（精神5）
     *    压在下面 ⇒ `isUncovered()` 为假；
     *  - 默认档的牌：`t7h-default` = `spirit-2`（中指令「你可以翻转1张牌」，
     *    文本**没有**任何"所有/被覆盖"的限定）⇒ `listCandidates` 走默认支：只列双方
     *    **未被覆盖的顶卡** ⇒ 被盖的那张**不在候选里**；
     *  - 明写覆盖的牌：`t7h-covered` = `corruption-3`（中指令「你可以翻转1张**被覆盖的**正面
     *    朝上的卡牌」）⇒ 候选走 `covered: true` 那一支（`context.ts:86`）⇒ 它在候选里。
     *
     * ⚠️ 线 1 挂的是**腐化**协议：`corruption-3` 正面只能打到自己协议那条线
     * （`isPlayableFaceUp`），所以要给它留一条腐化线，而不是把两条线都设成精神。
     * ⚠️ 对手线 0 上放一张 `water-2`：让默认档的候选集合**非空**（否则"候选里没有被盖的那张"
     * 会因为候选本身就是空的而变得没有说服力）。
     */
    const s = controlledGame('tutorial-T7', ['spirit', 'corruption', 'water']);
    s.players[0].hand = [card('t7h-default', 'spirit-2', 0, 'hand', true), card('t7h-covered', 'corruption-3', 0, 'hand', true)];
    s.players[0].deck = [];
    // 线 0：正面目标被正面牌压住（两个都正面 —— corruption-3 的候选正是"被覆盖的**正面**卡"）
    s.players[0].stacks[0] = [
      card('t7f-buried', 'spirit-3', 0, 'field', true, 0, 0),
      card('t7f-cover', 'spirit-5', 0, 'field', true, 0, 1),
    ];
    s.players[1].stacks[0] = [card('t7o1', 'water-2', 1, 'field', true, 0, 0)];
    return s;
  }
  if (id === 'T8') {
    /**
     * T8 编译与阈值：线 0 上我方 10 分、对手 0 分 ⇒ 这条线可以编译。
     *
     * ⚠️ 编译的真实门槛是「线值 ≥ 10 **且**高于对手」（`src/core/rules/compile.ts:16`），
     * 不是"差 5" —— 第一版摆 6 分，`getLegalActions` 里根本没有 compile，是测试腿抓出来的。
     * ⚠️ 编译只发生在「检查编译」这一步（`getLegalActions`：`step === 'action'` 只出 play/refresh，
     * `compile` 只在 `step === 'check-compile'` 产出）⇒ 这一关直接把局面摆到那一步，
     * 那也正是引擎里真正编译的时刻（不是绕过它）。
     */
    const s = controlledGame('tutorial-T8', ['spirit', 'water', 'darkness']);
    s.step = 'check-compile';
    s.players[0].hand = [];
    s.players[0].deck = [];
    // 线 0：我方 `spirit-5`(5) + `spirit-3`(3) + `spirit-2`(2) = **10 分**，对手 0 分
    s.players[0].stacks[0] = [
      card('t8f1', 'spirit-2', 0, 'field', true, 0, 0),
      card('t8f2', 'spirit-3', 0, 'field', true, 0, 1),
      card('t8f3', 'spirit-5', 0, 'field', true, 0, 2),
    ];
    return s;
  }
  /**
   * ★ 2026-10-02（P6 任务 A.2）T9「打出 vs 露出」：用**两张速度0**分别演示两条露出途径。
   *
   * 局面（协议：线 0 = 黑暗 / 线 1 = 流水 / 线 2 = 精神；两条工具都是**黑暗**牌 ⇒ 都打线 0）：
   *
   *  - **第二种（偏转覆盖者）**先摆好：我方线 1 上 `t9f-ours`（速度0，正面）是唯一的顶卡，
   *    玩家会把 `t9h-cover`（流水5）**反面**打到它上面 ⇒ 它变成"被覆盖"；
   *  - **第一种（翻正露出）**的目标在**对手**线 2：`t9f-opp`（速度0，反面）。
   *    为什么放对手那边：`darkness-1` 的中指令是「翻转1张**你对手的**牌」——它的候选集合
   *    只看对手的顶卡，而对手场上**只有这一张** ⇒ 候选唯一，玩家不会在候选里选错。
   *    （若把它放自己场上，任何"翻转1张牌 / 你的反面牌"的候选都会同时含线 1 那张速度0，
   *    一次误点就把这一关做死了 —— 这是本关局面唯一需要解释的地方。）
   *
   * 手牌四张，各有分工（顺序就是引导步骤的顺序）：
   *
   * | uid | 牌 | 中指令 | 作用 |
   * |---|---|---|---|
   * | `t9h-flip` | 黑暗1 | 翻转1张你对手的牌。你可以偏转那张牌。 | 第一种：把对手那张反面速度0 **翻正** |
   * | `t9h-cover` | 流水5 | 弃1张牌（**反面打出，不触发**） | 给线 1 那张速度0 盖一张牌 |
   * | `t9h-shift` | 黑暗4 | 偏转1张反面牌 | 第二种：把**盖着它的那张**偏转走（正是 `revealAfterRemoval` 那条路） |
   * | `t9h-pay` | 精神3 | 无中指令（只有顶命令，本关不会触发） | 给"被揭开"那次中部指令一张可打的牌 |
   *
   * 两个 `buildLevelState` 之外的前提，都在测试腿里正面钉住（`tests/tutorial/levels.test.ts` 的 T9 组）。
   */
  const s = controlledGame('tutorial-T9', ['darkness', 'water', 'spirit']);
  // 对手手牌留空：对手那张速度0 被翻正时，它的中部指令「打出1张牌」没有候选 ⇒ 空转
  // （日志里那句 `[中部] speed-0：原因：翻正` 照样会有 —— 判据读的就是它）
  s.players[1].hand = [];
  s.players[1].deck = [];
  s.players[1].stacks[2] = [card('t9f-opp', 'speed-0', 1, 'field', false, 2, 0)];
  // 我方线 1：唯一顶卡 = 那张要被盖住的速度0
  s.players[0].stacks[1] = [card('t9f-ours', 'speed-0', 0, 'field', true, 1, 0)];
  s.players[0].hand = [
    card('t9h-flip', 'darkness-1', 0, 'hand', true),
    card('t9h-cover', 'water-5', 0, 'hand', true),
    card('t9h-shift', 'darkness-4', 0, 'hand', true),
    card('t9h-pay', 'spirit-3', 0, 'hand', true),
  ];
  s.players[0].deck = [];
  return s;
}

