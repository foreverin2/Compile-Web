/**
 * ★ 2026-10-02（P2/P5）：**关卡判定**（纯函数，零 DOM / 零存储 / 零引擎调用）。
 *
 * ## 三类判据
 *
 *  - **T0**：看"四个热点点过没有"（`spotsDone`）；
 *  - **界面观察类**（T1 卡牌详情 / T6 反面牌可视）：看 `ui`（屏在真 DOM 上观察到的事实）——
 *    这两关里引擎状态**一模一样**（玩家只是看了看卡），所以判据只能看"玩家打开了什么"；
 *  - **其余**（T2~T5、T7）：看**引擎状态**（方案 §5.2 那一列的字面要求："通过判据（状态断言）"）。
 *    T4 的"五个动作各做一次"不是记"玩家点了哪个按钮"，而是对**前后两份快照做差分**
 *    ——`observedOps()` 只认"状态真的变了什么"。
 *
 * ## 快照只取判定用得上的那几样
 *
 * `uid → { owner, faceUp, zone, line }` + 每个玩家的手牌/牌库/弃牌堆**张数**。
 * 刻意**不比分值、不比卡面文本**：判定只回答"这几个动作发生过没有"。
 */
import type { Card, GameState, PlayerId } from '../core/models/types';
import { findCard, isUncovered } from '../core/effects/context';
import { getLineValue } from '../core/state/create';
import type { TutLevelId, TutOp, TutSpot, TutUiSeen } from './types';
import { TUT_UI_NONE, triggersSeen } from './types';
import type { TutLevel } from './levels';

/** 一张卡在快照里的样子（只留判定要用的字段） */
export interface TutCardSnap {
  readonly owner: PlayerId;
  readonly faceUp: boolean;
  readonly zone: Card['zone'];
  readonly line: number | null;
}

/** 一份局面快照 */
export interface TutSnap {
  readonly cards: ReadonlyMap<string, TutCardSnap>;
  readonly handLen: readonly [number, number];
  readonly deckLen: readonly [number, number];
  readonly trashLen: readonly [number, number];
}

/** 取一份快照（只读，不改 state） */
export function snapshot(state: GameState): TutSnap {
  const cards = new Map<string, TutCardSnap>();
  const walk = (c: Card): void => {
    cards.set(c.uid, { owner: c.owner, faceUp: c.faceUp, zone: c.zone, line: c.line });
  };
  for (const p of state.players) {
    p.hand.forEach(walk);
    p.deck.forEach(walk);
    p.trash.forEach(walk);
    for (const stack of p.stacks) stack.forEach(walk);
  }
  const lens = (pick: (p: GameState['players'][0]) => readonly Card[]): [number, number] =>
    [pick(state.players[0]).length, pick(state.players[1]).length];
  return {
    cards,
    handLen: lens((p) => p.hand),
    deckLen: lens((p) => p.deck),
    trashLen: lens((p) => p.trash),
  };
}

/**
 * 前后两份快照之间**发生过哪些基础动作**（返回去重后的集合，顺序固定按 `TutOp` 的定义序）。
 *
 * 每一条的判据（都写成"只看状态"）：
 *  - **flip**：同一张卡 `faceUp` 变了（且仍在场）；
 *  - **shift**：同一张卡 `line` 变了（且仍在场、同一 owner）——"偏转"就是换线；
 *  - **discard**：任意一方的**弃牌堆**张数增加了；
 *  - **draw**：任意一方的**手牌**张数增加了（抽牌必然进手牌）；
 *  - **return**：同一张卡从 `field` 变成 `hand`（回手）。
 */
export function observedOps(before: TutSnap, after: TutSnap): readonly TutOp[] {
  const hit = new Set<TutOp>();
  for (const [uid, b] of before.cards) {
    const a = after.cards.get(uid);
    if (a === undefined) continue;
    if (b.zone === 'field' && a.zone === 'field') {
      if (b.faceUp !== a.faceUp) hit.add('flip');
      if (b.line !== a.line && b.owner === a.owner) hit.add('shift');
    }
    if (b.zone === 'field' && a.zone === 'hand') hit.add('return');
  }
  const grew = (b: readonly number[], a: readonly number[]): boolean => a.some((n, i) => n > (b[i] ?? 0));
  if (grew(before.trashLen, after.trashLen)) hit.add('discard');
  if (grew(before.handLen, after.handLen)) hit.add('draw');
  const order: readonly TutOp[] = ['flip', 'shift', 'draw', 'discard', 'return'];
  return order.filter((op) => hit.has(op));
}

/**
 * 玩家 0 **自己**场上的卡（只看自己的链路：对手那几张是背景）。
 *
 * ⚠️ 不看 `owner` 而看"在谁的 stacks 里"：卡被回手/移交之后 owner 会变，
 * 而"这条线上有几张牌"这件事问的是**阵地**，不是归属。
 */
function ownFieldOf(state: GameState, player: PlayerId = 0): Card[] {
  return state.players[player].stacks.flat();
}

/** 判定用的三路输入（缺省都是"什么都没发生"） */
export interface TutJudgeInput {
  readonly spotsDone?: readonly TutSpot[];
  readonly opsSeen?: readonly TutOp[];
  readonly ui?: TutUiSeen;
}

/**
 * ★ 2026-10-02（P6 任务 A.2）：**日志差分**的两条读数（T9「打出 vs 露出」的判据用它）。
 *
 * 为什么这里读日志而不是读状态：T9 教的是"中部指令**又被结算了一次**"，而"结算过"这件事
 * 在状态里只剩一个间接痕迹（牌打完之后的场面）。引擎把每一次中部指令入栈都记成了
 * `[中部] <defId>：原因：<翻正|被揭开|打出>`（`src/core/log.ts:23` 的 `pushEffectLog`，
 * 由 `resolve.ts:132` 一处统一发出）⇒ 那是这个问题**最近**的一份证据。
 *
 * 两条的出处（逐字比对，改一边就红，见 `tests/tutorial/levels.test.ts` 的 T9 组）：
 *  - `[中部] speed-0：原因：翻正` —— `resolve.ts:469` 的 `pushMiddle(…, '翻正')`
 *    （前置：`card.faceUp && isUncovered(s, card) && !op.noMiddle`）；
 *  - `[中部] speed-0：原因：被揭开` + `[揭示] speed-0 被揭开（其上卡被移除）`
 *    —— `resolve.ts:1104` 的 `pushMiddle(…, '被揭开')` 与 `:1103` 的 `pushLog`。
 *
 * ⚠️ 日志是**单调增长**的（关内不重置；`openLevel()` 重建 state 时才清空），所以这两个
 * 布尔只会"变真"，不会回退 —— 这正是判据要的语义（做过一次就算做过）。
 */
export function revealSeen(state: GameState): { readonly flipped: boolean; readonly revealed: boolean } {
  const text = state.log.join('\n');
  return {
    flipped: text.includes('[中部] speed-0：原因：翻正'),
    // 两条都要：`[揭示]` 那条证明"是新顶被揭开"，`[中部]` 那条才证明"中部指令真的又入栈了"
    revealed: text.includes('[揭示] speed-0 被揭开') && text.includes('[中部] speed-0：原因：被揭开'),
  };
}

/**
 * 本关"做完了没有"。
 *
 * 每一关的判据都有反向变异（`p2-mutate.mjs` / `p5-mutate.mjs` / `p6-mutate.mjs`）：
 * 改坏任意一条 ⇒ 对应腿红。
 */
export function isLevelComplete(level: TutLevel, state: GameState, input: TutJudgeInput = {}): boolean {
  const ui = input.ui ?? TUT_UI_NONE;
  if (level.id === 'T0') {
    const want = level.spots ?? [];
    const done = new Set(input.spotsDone ?? []);
    return want.length > 0 && want.every((s) => done.has(s));
  }
  if (level.id === 'T1') {
    // 卡牌详情：打开过至少 N 次放大视图（N 写在关卡数据里，判据与目标文案一起被看见）
    return ui.detailsOpened >= (level.ui?.detailsAtLeast ?? 1);
  }
  if (level.id === 'T2') {
    // 打出 1 张**正面**牌（只看张数会让"打了一张反的"也算过 —— 那是 T3 的内容）
    const field = ownFieldOf(state);
    return field.length === 1 && field[0].faceUp === true;
  }
  if (level.id === 'T3') {
    // 正面、反面各至少 1 张（方案 §5.2："两张 faceUp 分别 true/false"）
    const field = ownFieldOf(state);
    return field.some((c) => c.faceUp) && field.some((c) => !c.faceUp);
  }
  if (level.id === 'T4') {
    // 五个签名要**全部**出现（把方案那五条状态断言收成"五个动作都发生过"）
    const want = level.ops ?? [];
    const seen = new Set(input.opsSeen ?? []);
    return want.length > 0 && want.every((op) => seen.has(op));
  }
  if (level.id === 'T5') {
    /**
     * 覆盖与揭开：对手线 0 的顶卡**被我盖住了**。
     *
     * 判据用引擎自己的 `isUncovered()`（`src/core/effects/context.ts:31`）——
     * 不自己重算"谁在上面"（那种第二份真相一定会漂）。具体形态：
     * 对手那张卡现在**不是**堆顶/未覆盖，且那条线上出现了我的卡（盖上去的那张）。
     */
    const stack = state.players[1].stacks[0];
    const theirCardBuried = stack.some((c) => c.uid === 't5o1' && !isUncovered(state, c));
    // ⚠️ 两条走过的弯路（都留着，免得再走）：
    //  1. 不能拿"栈里有 `owner === 0` 的卡"判"是我盖的" —— `corruption-0` 落到对方场会**易主**
    //     （`base.ts:81` 的 `card.owner = dest`，那个 owner 已经不是 0 了）；
    //  2. 也不需要再加 `stack.length > 1`：`isUncovered(对手那张) === false` **本身**就说明
    //     它上面有牌（引擎口径，`context.ts:31`），加那一句是冗余子句 ——
    //     变异实测（`p5-mutate.mjs` 的 M4）把它删掉之后测试**仍然全绿**，所以它不提供保护，
    //     留着只会让人误以为多了一层校验。
    return theirCardBuried;
  }
  if (level.id === 'T6') {
    /**
     * 反面牌可视规则：**两个对照都要看过**。
     *
     *  - `peekAvailable`：看过一张"能看"的反面牌（详情里有「查看正面」按钮）；
     *  - `peekBlocked`：看过一张"不能看"的反面牌（详情里**没有**那个按钮）。
     *
     * ⚠️ 只要求"两个都见过"，不要求顺序 —— 顺序不是这条规则的一部分。
     */
    return ui.detailsOpened >= (level.ui?.detailsAtLeast ?? 2)
      && (level.ui?.needPeekAvailable !== true || ui.peekAvailable)
      && (level.ui?.needPeekBlocked !== true || ui.peekBlocked);
  }
  if (level.id === 'T7') {
    /**
     * ★ 2026-10-02（P6 任务 A.1）默认目标规则：**同一条规则的两个对照**都要做到。
     *
     * 判据用了四样东西（少一样都不算过）：
     *  1. `blockedPickTried` —— 玩家**真的点过**那张被压暗的牌（走偏的那一下，UI 真实交互）；
     *  2. 默认档（`spirit-2`：文本没有"所有/被覆盖"）那次选择的**候选集合里没有**被盖的那张；
     *  3. 明写覆盖档（`corruption-3`：「翻转1张**被覆盖的**正面朝上的卡牌」）候选集合**里有**它；
     *  4. **状态差分**：那张牌真的被翻成了反面（起始是正面 ⇒ `faceUp === false`）。
     *
     * ⚠️ 第 2、3 条读的是 `ChoiceRequest.candidates`（`listCandidates` 的产出，
     * `src/core/effects/context.ts:64/86`）—— 那是"默认只列未覆盖顶卡、写 covered 才含被盖卡"
     * 这条口径**唯一的机械形态**，不自己重算一遍（重算就是第二份真相）。
     */
    const buried = 't7f-buried';
    const choices = ui.choices ?? [];
    const def = choices.find((c) => c.source === 'spirit-2');
    const explicit = choices.find((c) => c.source === 'corruption-3');
    const defaultExcludes = def !== undefined && !def.uids.includes(buried);
    const explicitIncludes = explicit !== undefined && explicit.uids.includes(buried);
    const card = findCard(state, buried);
    const flipped = card !== undefined && card.zone === 'field' && card.faceUp === false;
    return ui.blockedPickTried === true && defaultExcludes && explicitIncludes && flipped;
  }
  if (level.id === 'T8') {
    // T8 编译与阈值：线 0 编译完成
    return state.players[0].protocols[0].compiled === true;
  }
  /**
   * ★ 2026-10-02（P6 任务 A.2）T9「打出 vs 露出」：两条露出途径**各做到一次**。
   *
   * 判据全是**日志差分 + 状态差分**（用户口径：例："牌库数变化 + 出现
   * `[中部] speed-0：原因：翻正/被揭开`"）：
   *  - 两条 `[中部] speed-0：原因：…` 各出现一次（`revealSeen()`，逐字出处写在它的注释里）；
   *  - 对手那张速度0 现在**正面**（翻正那一步的状态差分）；
   *  - 我方那张速度0 现在**未被覆盖**（`isUncovered`，引擎自己的判据）。
   */
  if (level.id === 'T9') {
    const seen = revealSeen(state);
    const ours = findCard(state, 't9f-ours');
    const opp = findCard(state, 't9f-opp');
    return seen.flipped
      && seen.revealed
      && opp !== undefined && opp.faceUp === true
      && ours !== undefined && ours.zone === 'field' && isUncovered(state, ours);
  }
  /**
   * ★ 2026-10-02（P7）T10「控制权」：玩家**真的把控制权拿到手**了。
   *
   * 判据是 `s.control === 0`（用户口径原话："按引导真的把控制权拿到手"）。
   * 控制权的判定发生在 `check-control`（`src/core/game.ts:293` 的 `performAdvance`），
   * 而 T10 的局面就摆在那一步：玩家点一次「推进」才会走到判定 ⇒ `control` 从 `-1` 变成 `0`。
   * 局面上开局 `control` 是 `-1`（`controlledGame` 置中立）⇒ **零操作不算过**。
   */
  if (level.id === 'T10') {
    return state.control === 0;
  }
  /**
   * ★ 2026-10-02（P7）T11「触发时机」：打出后 / 被盖住前 / 结束**三种各出现过一次**。
   *
   * 三路证据（**两条从日志、一条从状态** —— 为什么这么分，见下面那条 ⚠️）：
   *  - **被盖住前**、**结束**：日志里出现 `[被盖前]` / `[结束]` 这两条引擎自己写的阶段标题
   *    （`triggersSeen()`，逐字出处写在 `types.ts` 的 `TRIGGER_LABEL` 上）；
   *  - **打出后**：对手那张 `t11o2` 真的进了**对手的弃牌堆** —— 它是因为**我的**冰1 被触发
   *    才被弃的，这一关里没有第二个能把它推进弃牌堆的东西；
   *  - **再加一条状态断言**：`life-0` 那张牌现在**不在场上**（"结束"那一支真的把它移除了）。
   *
   * ⚠️★ **为什么"打出后"不能读日志**（本轮实测抓到，登记在方案 §7.13）：
   * `after-play` 是**定向触发**（`src/core/effects/resolve.ts:70-94` 的 `fireDirectedTop()`）——
   * 它只把效果入栈，**不调 `pushEffectLog`** ⇒ 日志里**根本没有** `[连锁·出牌后]` 这一行
   * （第一版判据就是去找这个不存在的字符串，被自己的腿当场判红）。同一个 `after-*` 家族里
   * `after-return` 也一样。要让它有日志得改 `src/core/**`（红线）⇒ 不改，改用状态证明。
   */
  if (level.id === 'T11') {
    const seen = triggersSeen(state.log);
    const life0 = findCard(state, 't11f-c');
    const life0Gone = life0 === undefined || life0.zone !== 'field';
    const afterPlayHit = state.players[1].trash.some((c) => c.uid === 't11o2');
    return afterPlayHit && seen['before-covered'] >= 1 && seen.end >= 1 && life0Gone;
  }
  /**
   * ★ 2026-10-02（P7）T12「删除 / 免疫 / 加成」：三样各一条**状态/数值断言**。
   *
   *  - **删除**：对手那张 `t12o1` 已经离开场上（进了对手的弃牌堆）——
   *    删除 op 把它推进 `trash`（不是回手、不是偏转），所以断言"它在 trash 里"比"它不在场上"
   *    更贴近"删除"这件事；
   *  - **加成**：线 2 的总值**真的变了**（0 → 1）。用真引擎算（`getLineValue`，
   *    它含 `valueModifier` 那一层）而不自己重算 `clarity-0` 的规则 —— 重算就是第二份真相；
   *    这里不比"等于几"，而是比"与开局不同"（加成的数值口径以后若变，这一课不用跟着改）；
   *  - **免疫**：那张**死板7**「此牌不能被翻转或偏转」仍然是**正面**，而且引擎日志里有
   *    那句 `rigidity-7 不可被翻转，跳过`（`resolve.ts:442`）。
   *    ⚠️ 两条缺一不可的实测依据：只读状态时"玩家压根没选它"也会成立；
   *    只读日志时"日志里出现过"不等价于"它真的还在场上"。
   */
  if (level.id === 'T12') {
    const deleted = state.players[1].trash.some((c) => c.uid === 't12o1');
    const buffed = getLineValue(state, 0, 1) !== 0;
    const imm = findCard(state, 't12f-rigid');
    const immune = imm !== undefined && imm.zone === 'field' && imm.faceUp === true
      && state.log.some((l) => l.includes('rigidity-7 不可被翻转，跳过'));
    return deleted && buffed && immune;
  }
  if (level.id === 'T13') {
    /**
     * ★ 2026-10-02（P7）T13「迷你对局」：**打到终局**（用户口径 / 方案 §5.2："`s.winner !== null`"）。
     *
     * ⚠️ 只读 `winner !== null` 就够，**不要**再自己数"编译了几条线"：胜负判定住在引擎里
     * （`compile-body.ts:131` 的 `p.protocols.every((pr) => pr.compiled)`），重数一遍就是
     * 第二份真相（而且"对手编译了几条"与胜负无关，数错就漂）。
     * 局面上开局 `winner === null`（`controlledGame` 置空）⇒ 零操作不算过。
     */
    return state.winner !== null;
  }
  // 穷尽性兜底：将来加了新关卡而这里漏了分支 ⇒ 它永远不过（比"静默恒真"安全）
  return false;
}

/**
 * 走偏时给哪一句提示（键名**逐条字面量**写在这里 —— 缺键扫描腿要看得见）。
 *
 * 三类走偏，按"玩家实际做了什么"分：
 *  - **动作种类不在白名单里**（例如 T2 里去点编译）⇒ `tutorial.off.wrong-kind`；
 *  - **打了一张反面的牌**，而本关要的是正面（T2）⇒ `tutorial.off.face-down`；
 *  - 其余（引擎自己会拒的，例如正面牌打到不匹配的线）由引擎拒掉/抛错，屏上给
 *    `tutorial.off.rejected`。
 */
export function offTrackKeyFor(
  level: TutLevel,
  action: { readonly kind: string; readonly faceUp?: boolean },
): string {
  if (!level.allowKinds.includes(action.kind)) return 'tutorial.off.wrong-kind';
  if (level.id === 'T2' && action.kind === 'play' && action.faceUp === false) {
    return 'tutorial.off.face-down';
  }
  return 'tutorial.off.rejected';
}

/** 关卡序号 → 是否已经是最后一关（屏上据此把"下一关"换成"完成"） */
export function isLastLevel(id: TutLevelId, all: readonly { id: TutLevelId }[]): boolean {
  return all.length > 0 && all[all.length - 1].id === id;
}
