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
import { DEMO_PROTOCOLS } from '../data/demo';
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
 * ★ 2026-10-03（**用户报的缺陷：教程里"只有一边的协议会亮已编译特效"**）：
 * **对手（座位 1）拿这三套协议** —— 从 `DEMO_PROTOCOLS` 里按常量顺序取**前三个不属于我方**的。
 *
 * ## 为什么必须与玩家不重名（这是本函数存在的唯一理由）
 *
 * `src/ui/render.ts:2384` 的已编译协议持久特效层注册表 `compiledFx` 是**以 defId 为键**的，
 * 它依赖一条前提，代码自己写在 `render.ts:170-171`：
 * 「每玩家 3 协议 defId 互不相同、双方亦不共享（草案池每 defId 只出现一次）→ 以 defId 为键安全」。
 *
 * 真对局里这条前提**成立**（`getDraftPool` 会把已被挑走的 defId 滤掉，`src/core` 里也没有任何
 * 地方改写 `protocols` 的 defId），而**教学这批局面是手摆的** —— 改之前 `controlledGame` 给双方
 * 摆的是**同一组**协议（用户看到的正是这个）。后果是同一个 defId 的两格共用一个层：
 *   · 一侧已编译、另一侧同名未编译时，未编译那支会把已建好的层 `remove()` 掉（谁后跑谁赢）；
 *   · 两侧都已编译时，层被摆到最后处理的那个 holder 上。
 * 两种都表现为"只有一边亮"。
 *
 * 用户 2026-10-03 的裁决：**不做"双方共用同一协议"的玩法**（这条永远不出现），所以正确的处置
 * 是让教学的局面也满足那条前提（不去动红线 `render.ts`）。改完之后 15 关双方的协议**两两不重名**，
 * 由 `tests/tutorial/levels.test.ts` 的一条腿钉住（重名 ⇒ 红）。
 *
 * ⚠️ 判据是"我方协议组里的三套" —— 只排除它们，不排除"我方线上摆着的卡"（卡与协议无关）。
 */
function opponentProtocols(mine: readonly string[]): [string, string, string] {
  const rest = DEMO_PROTOCOLS.map((p) => p.defId).filter((id) => !mine.includes(id));
  if (rest.length < 3) throw new Error('DEMO_PROTOCOLS 里凑不出三套与玩家不重名的协议');
  return [rest[0], rest[1], rest[2]];
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
  /**
   * 对手（座位 1）也要有协议：阈值/控制权两处要用它算，缺了渲染器会画出空线。
   * ★ 2026-10-03：**但与玩家不重名**（理由见 `opponentProtocols` 的说明）——
   * 改之前这里写的是 `protocols(...lineProtocols)`（双方同一组）。
   */
  s.players[1].protocols = protocols(...opponentProtocols(lineProtocols));
  return s;
}

/**
 * 每关的受控局面。
 *
 * 三条链路的协议固定为 `spirit` / `water` / `darkness`：T4 那五张真卡正好各回各家
 * （`spirit-*` → 线 0、`water-4` → 线 1、`darkness-4` → 线 2），玩家打出时不用猜线。
 */
export function buildLevelState(id: TutLevelId): GameState {
  // ★ P7 的后四关（T10~T13）单独一段：它们的局面各有"不这么摆跑不通"的取舍，
  //   注释与摆法都收在 `buildLevelStateP7` 里，免得把上面那十关读成一片。
  if (id === 'T10' || id === 'T11' || id === 'T12' || id === 'T13') {
    return buildLevelStateP7(id);
  }
  // ★ 2026-10-03（用户要求）：S0「序章」—— 先讲背景故事与胜利条件，再**亲手打赢一局**。
  //   注释与摆法收在这一段里（这一关的每一处都有理由，别把它读成随手摆的牌）。
  if (id === 'S0') {
    /**
     * S0 的棋盘 = **决胜那一步**：三条协议里前两条已经编译过，第三条只差 1 分。
     *
     * | 位置 | 摆什么 | 为什么 |
     * |---|---|---|
     * | 线 0 / 线 1 | 双方协议都标成 `compiled: true`（链路上不放牌） | 交代"已经编译了两条"，也是"对手也在打这一局"；胜负只看**我方**三条（`compile-body.ts:131`） |
     * | 线 2（明光） | 我方 `light-4` + `light-5` = **9 分**，对手 `light-2` = **2 分** | 手里那张 1 分牌打进来正好 **10 分 > 2 分** ⇒ 满足编译条件（`compile.ts:16` 的 `own >= 10 && own > opp`） |
     * | 手牌 | 只有 `light-1`（1 分） | 它**没有中指令**（只有底部「结束：抽1张牌。」，而这一关走不到结束阶段）⇒ 打出去不会弹任何选择，动作链是确定的 |
     *
     * 三条"不这么摆就跑不通"的取舍：
     *  1. **必须是 1 分的牌**：线值差 1 分才叫"决胜那一步"（`light-1` 是本仓 1 分牌里少数没有中指令的
     *     一张 —— 别的 1 分牌（`water-1`/`darkness-1`/`spirit-1`…）打出去都会挂起选择请求）；
     *  2. **协议必须挂成明光**：正面牌只能进自己协议那条线（`isPlayableFaceUp`），所以要给 `light-1`
     *     留一条明光线（T7 那一课同款理由）；
     *  3. **开局停在 `action` 步**：玩家先打出那张补分的牌（真实 `play`），
     *     之后由 `TutLevel.toCompileStepAfterPlay` 把步交回 `check-compile`，玩家再点「编译」
     *     （真实 `executeCompile`）⇒ 协议翻面 + `s.winner = 0` + `phase = 'gameover'`。
     *     引擎的真实次序是"编译判定在自己回合开头"，所以这两步在真对局里隔着一整轮 ——
     *     教学把时序压缩到同一关里，编译本身一个字都没绕过。
     */
    const s = controlledGame('tutorial-S0', ['spirit', 'water', 'light']);
    s.players[0].hand = [];
    s.players[0].deck = [];
    s.players[0].protocols[0] = { defId: 'spirit', compiled: true };
    s.players[0].protocols[1] = { defId: 'water', compiled: true };
    // 对手那两条也是"已编译的战果"——但用的是**他自己的**协议（双方协议不重名，见
    // `opponentProtocols` 的说明：重名会让已编译特效的 defId 键撞在一起，只有一边亮）
    s.players[1].protocols[0].compiled = true;
    s.players[1].protocols[1].compiled = true;
    s.players[0].stacks[2] = [
      card('s0f1', 'light-4', 0, 'field', true, 2, 0),
      card('s0f2', 'light-5', 0, 'field', true, 2, 1),
    ];
    s.players[1].stacks[2] = [card('s0o1', 'light-2', 1, 'field', true, 2, 0)];
    s.players[0].hand = [card('s0h1', 'light-1', 0, 'hand', true)];
    return s;
  }
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

/**
 * ★ 2026-10-02（P7）**后四关**的受控局面。
 *
 * 四关的摆法各有一处"不这么摆就跑不通"的取舍，逐条写在下面（都是本轮的实测结论，
 * 原始读数在方案 §7.13）：
 */
function buildLevelStateP7(id: 'T10' | 'T11' | 'T12' | 'T13'): GameState {
  if (id === 'T10') {
    /**
     * T10 控制权：**直接在 `check-control` 这一步开局**（`step: 'check-control'`）。
     *
     * 为什么不是 `action`：控制权只在**这一步**判定（`src/core/game.ts:293` 的
     * `performAdvance` → `checkControl()`），而这台引擎里"走一步"是玩家的一次真实动作
     * （`getLegalActions` 在 `check-control` 只出 `advance`）。所以这一关的"亲自动手"
     * 就是**点一次推进**，判据读 `s.control`。
     *
     * 局面按**实现口径**摆：`checkControl()`（`src/core/rules/control.ts:35-52`）只检查
     * **当前行动玩家自己**——他在**至少 2 条**线上的总值高于对手就拿到控制组件。
     * 这里线 1 = 3:1、线 2 = 3:0 ⇒ 正好两条（**不是**"差 5"，上一轮有人在编译那一课
     * 栽过同款跟头，见方案 §7.9）。
     * ⚠️ 线 2 对手是 0 分：`getLineValue` 对空栈给 0 ⇒ 3 > 0 成立。
     */
    const s = controlledGame('tutorial-T10', ['spirit', 'water', 'darkness']);
    s.step = 'check-control';
    s.players[0].hand = [];
    s.players[0].deck = [];
    s.players[0].stacks[0] = [card('t10f-a', 'spirit-3', 0, 'field', true, 0, 0)];
    s.players[0].stacks[1] = [card('t10f-b', 'water-3', 0, 'field', true, 1, 0)];
    // 对手只有线 1 有牌（1 分）⇒ 线 2 对手 0 分，线 3 双方 0:0（不算"高过"）
    s.players[1].stacks[0] = [card('t10o1', 'spirit-1', 1, 'field', true, 0, 0)];
    return s;
  }
  if (id === 'T11') {
    /**
     * T11 触发时机：**三种触发各摆一处**。
     *
     * ★ 2026-10-03（本轮实测抓到的缺陷，改法记在这里）：
     *
     * | 触发 | 卡 | 谁把它弄出来 | 实测证据 |
     * |---|---|---|---|
     * | 打出后 | `ice-1`（**对手侧**，线 2） | **我**在自己线 2 出牌（盖火焰0 的那一张） | P1 手里那张进了 P1 的弃牌堆 |
     * | 被盖住前 | `fire-0`（我方线 2） | **我自己**反面盖一张到它上面 | 日志 `[被盖前] fire-0` |
     * | 结束 | `life-0`（我方线 3，**已被盖住**） | 结束阶段点它的「结算触发」 | 日志 `[结束] life-0：由 P1 结算` |
     *
     * 三处各有一条"不这么摆不行"的理由：
     *  1. `ice-1` 的 `after-play` 是**定向触发**：它查的是**打出者的对手**那一侧的同线顶卡
     *     （`resolve.ts:1062` 的 `fireDirectedTop(…, actor === 0 ? 1 : 0, …)`）⇒ 冰1 必须摆在
     *     **对手**那条线上，触发它的是**我**的出牌。
     *     ⚠️ 旧摆法（冰1 在我方线 1、靠"对手出牌"触发）**在教学屏里做不到**：那要求玩家去
     *     打**对手手牌**，而教学屏只会在 `state.turnPlayer` 那一侧提交（render.ts 也只把手牌
     *     做成当前行动方的可拖拽物）⇒ 玩家永远走不出那一步（判据里的"打出后"永远不成立）。
     *     现在把冰1 放到对手线 2、和自己的火焰0 **同一条线**：**一次盖牌**同时打出
     *     「被盖住前」与「打出后」两处证据（方向没变，仍然是"对手在我的这条线上被出牌"）。
     *  2. `fire-0` 的 `before-covered` 只查**该线顶卡**（`resolve.ts:1041`）⇒ 它必须是那一条线上
     *     唯一/最上面那张，而玩家得**自己**去盖（引擎不拦"盖自己的牌"）；
     *  3. `life-0` 的「结束」是**顶命令**（`top: true`）且带 `cond: !isUncovered`（`life.ts:83`）
     *     ⇒ 它**只有被盖住**时才会在结束阶段被收集出来 ⇒ 局面里就要先盖好一张
     *     （`t11c-cover` = 生命5），玩家在结束阶段点一下「结算触发」。
     *
     * ⚠️ 手牌里那张 `water-0` 是"盖住 fire-0"用的：**反面打出不看协议**，所以随便哪张都行；
     * 特意挑一张 0 分且无文本的，免得它自己再触发别的效果把这一课搅浑。
     * ⚠️ 手牌里那张 `ice-5`（`t11h-fodder`）是留给"打出后"那一下弃的：`ice-1` 的
     * 「对手在此链路出牌后：**他要弃置1张牌**」罚的是**往那条线出牌的人**（`ice1AfterPlay`：
     * `foe = opp(ctx.player)`，候选就是出牌者自己的手牌）—— 冰1 在对手那边、出牌的是我，
     * 所以这一下**弃的是我手里的牌**，判据读的也是它进我的弃牌堆。只留这一张候选 ⇒ 玩家
     * 在候选里没有选错的空间。
     * ⚠️ 本关的三种触发**跨了引擎的三步**（action → check-cache → end）⇒ 声明 `keepStep: true`，
     * 让引擎自己的步真的走（否则教学屏那条沙盒规则会把 step 打回 action，玩家永远到不了结束阶段）。
     */
    const s = controlledGame('tutorial-T11', ['ice', 'fire', 'life']);
    s.players[0].hand = [];
    s.players[0].deck = [];
    // 打出后：**对手**线 2 摆冰1（顶卡、正面）—— 我在自己线 2 出牌时它的「打出后」响
    s.players[1].stacks[1] = [card('t11o-ice1', 'ice-1', 1, 'field', true, 1, 0)];
    // 被盖住前：自己线 2 摆火焰0，手里一张 water-0 用来反面盖它
    s.players[0].stacks[1] = [card('t11f-b', 'fire-0', 0, 'field', true, 1, 0)];
    // 结束：自己线 3 摆"被盖住的 life-0"
    s.players[0].stacks[2] = [
      card('t11f-c', 'life-0', 0, 'field', true, 2, 0),
      card('t11c-cover', 'life-5', 0, 'field', true, 2, 1),
    ];
    s.players[0].hand = [
      card('t11h-cover', 'water-0', 0, 'hand', true),
      card('t11h-fodder', 'ice-5', 0, 'hand', true),
    ];
    s.players[1].hand = [];
    s.players[1].deck = [];
    return s;
  }
  if (id === 'T12') {
    /**
     * T12 删除 / 免疫 / 加成：三条线 = **火焰 / 明晰 / 死板**，手牌三张正好各演示一样。
     *
     * | 演示 | 卡（真卡） | 文本 | 判据读什么 |
     * |---|---|---|---|
     * | 删除 | `fire-1` 打到线 1 | 中「弃1张牌。如果弃了，删除1张牌。」 | 对手那张 `t12o1` 进了**对手弃牌堆** |
     * | 加成 | `clarity-0` 打到线 2 | 顶「此链路中，你每有1张牌，总阈值就加1。」 | 线 2 的**总值**从 0 变成 1 |
     * | 免疫 | `rigidity-1` 打到线 3 | 中「翻转对手1张正面朝上的牌。」 | 对手那张 `t12f-rigid`（**死板7**）底「此牌不能被翻转或偏转。」 |
     *
     * ⚠️ **被保护的那张必须摆在对手那条线上**：`rigidity-1` 的候选只看**对手**的顶卡
     * （`rigidity.ts:18` 的 `owner: opp(ctx.player)`）⇒ 摆在自己场上时候选里根本没有它，
     * 「免疫」就演示不出来（第一版就是这么摆的，探针里候选只剩别的牌）。
     * ⚠️ 手牌里那张 `water-0` 只是"弃1张牌"那一步的弃料（0 分、无文本，弃了不心疼）。
     * ⚠️ 三条线各自挂的协议就是那三张牌的协议（正面牌只能进自己协议那条线）。
     */
    const s = controlledGame('tutorial-T12', ['fire', 'clarity', 'rigidity']);
    s.players[0].hand = [
      card('t12h-del', 'fire-1', 0, 'hand', true),
      card('t12h-buff', 'clarity-0', 0, 'hand', true),
      card('t12h-flip', 'rigidity-1', 0, 'hand', true),
      card('t12h-fodder', 'water-0', 0, 'hand', true),
    ];
    s.players[0].deck = [];
    // 线 1：对手一张正面牌（要被删除的那张）
    s.players[1].stacks[0] = [card('t12o1', 'life-2', 1, 'field', true, 0, 0)];
    // 线 3：对手一张**死板7**（它底「此牌不能被翻转或偏转」= 免疫；正因如此它才挡得住 rigidity-1）
    s.players[1].stacks[2] = [card('t12f-rigid', 'rigidity-7', 1, 'field', true, 2, 0)];
    return s;
  }
  /**
   * T13 迷你对局：**三条线里已经编译两条**，玩家把第三条编译掉 ⇒ 三条协议全已编译 ⇒ 终局。
   *
   * 引擎口径（`src/core/rules/compile-body.ts:131`）：`p.protocols.every((pr) => pr.compiled)`
   * ⇒ `s.winner = player`、`s.phase = 'gameover'`。所以"打到终局"这件事的判据就是
   * `s.winner !== null`（也正是用户口径与方案 §5.2 那一格的字面要求）。
   *
   * 摆法：
   *  - 线 1、线 2：我方协议**已编译**（线 1 上还留着对手一张反面牌 —— 让"编译过的线"看得见）；
   *  - 线 3：黑暗线上我方 10 分（黑1+黑4+黑5）、对手 2 分 ⇒ 满足「自己 ≥10 且高于对手」，
   *    编译按钮真的亮着（`getLegalActions` 会给出 `compile:2`）；
   *  - 对手的协议也标成已编译前两条：这是**对手的战果**，用来交代"他也在打这一局"
   *    （胜负只看**我方**三条协议是否全部编译，`compile-body.ts:131`）。
   */
  const s = controlledGame('tutorial-T13', ['spirit', 'water', 'darkness']);
  s.step = 'check-compile';
  s.players[0].hand = [];
  s.players[0].deck = [];
  s.players[0].protocols[0] = { defId: 'spirit', compiled: true };
  s.players[0].protocols[1] = { defId: 'water', compiled: true };
  // 对手那两条同样是"已编译的战果"，但用**他自己的**协议（不与我方重名 —— 见
  // `opponentProtocols`：重名会让已编译特效的 defId 键撞在一起，只有一边亮）
  s.players[1].protocols[0].compiled = true;
  s.players[1].protocols[1].compiled = true;
  // 线 3（黑暗）：我方 10 分（1 + 4 + 5），对手 2 分（反面牌不算分）
  s.players[0].stacks[2] = [
    card('t13b1', 'darkness-1', 0, 'field', true, 2, 0),
    card('t13b2', 'darkness-4', 0, 'field', true, 2, 1),
    card('t13b3', 'darkness-5', 0, 'field', true, 2, 2),
  ];
  s.players[1].stacks[0] = [card('t13o1', 'spirit-4', 1, 'field', false, 0, 0)];
  s.players[1].stacks[2] = [card('t13o2', 'darkness-4', 1, 'field', false, 2, 0)];
  return s;
}

