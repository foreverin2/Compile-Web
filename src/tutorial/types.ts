/**
 * ★ 2026-10-02（P2/P5）：教学模块的**类型**（叶子，零依赖）。
 *
 * 单独一个文件是为了让"关卡数据 / 受控局面 / 判定 / 进度 / 屏"五块共用同一套名词，
 * 而不互相 import（`types.ts` 不 import 任何东西 ⇒ 谁都能安全依赖它）。
 */
import type { Card } from '../core/models/types';

/**
 * 关卡 id。**顺序就是玩的顺序**（进度里的"当前关"按 `TUT_LEVELS` 的序号推）。
 *
 * ⚠️ 2026-10-02 用户追加两课后**重新编号**（新两课插进来，原来那几课被挤开）：
 *
 * | 现编号 | 教什么 | 原编号（方案 §5.2 的概念编号） |
 * |---|---|---|
 * | T0 | 界面扫盲 | T0 |
 * | T1 | **查看卡牌详情**（用户追加） | — |
 * | T2 | 打出第一张牌 | T1 |
 * | T3 | 正面还是反面 | T2 |
 * | T4 | 五个基础动作 | T3 |
 * | T5 | 覆盖与揭开 | T4 |
 * | T6 | **场上的反面牌能不能看**（用户追加） | — |
 * | T7 | 编译与阈值 | T5 |
 *
 * ⚠️ 编号变了 ⇒ **老进度里的 id 会指向另一课**（`done: ['T3']` 以前是"五动作"、现在是"朝向"）。
 * 这是 pre-release 的既定代价（清一次本机数据即恢复），已在方案 §7.9 登记。
 *
 * ⚠️★ 2026-10-02（P6，用户当天又追加两课）**再动一次编号**：新插进来的
 * 「默认目标规则」占 T7，原来的「编译与阈值」让位成 T8，最后新增「打出 vs 露出」= T9：
 *
 * | 现编号 | 教什么 | 上一轮的编号 |
 * |---|---|---|
 * | T0~T6 | 同上（未动） | T0~T6 |
 * | **T7** | **默认目标规则**（新增） | — |
 * | **T8** | 编译与阈值 | T7 |
 * | **T9** | **打出 vs 露出**（新增） | — |
 *
 * 同样：老进度里的 `T7` 以前是"编译与阈值"、现在是"默认目标规则"，清一次本机数据即恢复。
 * 登记在方案 §7.11。
 *
 * ⚠️★ 2026-10-02（P7）**补完最后四关**（用户口径见方案 §5.2 的表 + §7.13）：
 *
 * | 现编号 | 教什么 |
 * |---|---|
 * | T0~T9 | 未动 |
 * | **T10** | **控制权**（怎么拿到、拿到有什么用） |
 * | **T11** | **触发时机**（打出后 / 被盖住前 / 结束，三种各演示一次） |
 * | **T12** | **删除 / 免疫 / 加成** |
 * | **T13** | **迷你对局**（用三条线打一小局到终局） |
 *
 * 与 P5/P6 那两次不同：这次**只是往后追加**，老进度的 id 没有被重新指向（不用清本机数据）。
 *
 * ⚠️★ 2026-10-03（用户要求「再加上一关，用于先告诉玩家背景故事，然后再给玩家详细解释，
 * 这个游戏的胜利条件是什么，然后再是介绍界面」）**在最前面插一关** `S0`（序章：背景故事 +
 * 胜利条件），排在原来的 `T0`（界面扫盲）**前面**。
 *
 * | 现编号 | 教什么 |
 * |---|---|
 * | **S0** | **序章：背景故事 + 这一局怎么算赢**（新增，真引擎打赢一局） |
 * | T0~T13 | 原样（id 一个都没动） |
 *
 * 与 P5/P6 那两次"插入并重编号"不同：`T0`~`T13` 的 id **一律不动** ⇒ 已存进度里的
 * `current` / `done` 仍指向原来那几课，只是**没玩过的人从 S0 开始**（`levels.ts` 的
 * `TUT_LEVELS[0]`）。代价如实登记：老进度里若已经停在 `T0`，下次进教学仍停在 T0，
 * 不会补看序章（要看得点「从头开始」）。
 */
export type TutLevelId = 'S0' | 'T0' | 'T1' | 'T2' | 'T3' | 'T4' | 'T5' | 'T6' | 'T7' | 'T8' | 'T9' | 'T10' | 'T11' | 'T12' | 'T13';

/** T0 要点一遍的四个界面区域（链路 / 协议 / 阈值 / 控制权） */
export type TutSpot = 'link' | 'protocol' | 'threshold' | 'control';

/**
 * T4（五个基础动作）要集齐的五个动作的**状态签名**。
 *
 * ⚠️ 它们不是"玩家点了什么按钮"，而是"**状态真的变了什么**"——由 `judge.ts` 对前后两份
 * 快照做差分算出来。理由：引擎与渲染器都是红线（不许改），本屏只能从**状态**反推发生了什么；
 * 而"状态断言"也正是方案 §5.2 那一列的字面要求（"通过判据（状态断言）"）。
 */
export type TutOp = 'flip' | 'shift' | 'draw' | 'discard' | 'return';

/**
 * ★ 2026-10-02（P6，任务 A.1）：**一次选择请求的候选集合**（屏从引擎的 prompt 上读到的）。
 *
 * 为什么单开一条通道：「默认目标规则」那一课教的不是"状态变成了什么"，而是
 * **引擎把哪些牌列成了候选**——默认档只列双方场上未被覆盖的顶卡（`listCandidates`，
 * `src/core/effects/context.ts:64`），文本明写「被覆盖的牌」时才把被盖住的算进来。
 * 判据要能分辨这两档，只可能看 `ChoiceRequest.candidates`。
 *
 * ⚠️ 它**不是**屏在 DOM 上观察到的：候选来自引擎的 `PendingEffect.prompt`
 * （`src/core/models/types.ts` 的 `ChoiceRequest`）；屏把它读出来记一笔而已。
 * 严格说这是"引擎读数"，但因为**判据要的是候选集合本身**，没有第二条更权威的来源。
 */
export interface TutChoiceSeen {
  /** 这一次选择是谁弹的（效果源的 defId，例如 `spirit-2` / `corruption-3`） */
  readonly source: string;
  /** 候选的 uid 集合（就是 `ChoiceRequest.candidates` 里的那些 uid） */
  readonly uids: readonly string[];
}

/**
 * ★ 2026-10-02（用户追加两课）：**屏上观察到的**事实（详情放大视图那一路）。
 *
 * 为什么单开一条通道：T1（卡牌详情）与 T6（反面牌可视规则）教的是**界面行为**，
 * 不是引擎状态 —— 引擎里什么都没变（`state` 一模一样），所以判据必须看"玩家打开了什么"。
 * 这三项由屏在**真实 DOM 上**观察得到（放大遮罩 `.zoom-overlay` 与它里面的
 * `.zoom-peek-btn` 都是 `render.ts` 造的真元素），判据只读这三个计数/布尔。
 *
 * ★ 2026-10-02（P6）又加了两项（T7 的「默认目标规则」那一课要用，见 `TutChoiceSeen`）。
 * 后两项写成**可选**是为了不动既有测试里那些三字段字面量；判据那头一律
 * `?? TUT_UI_NONE` 兜底，不写就当"没发生"。
 */
export interface TutUiSeen {
  /** 打开过几次卡牌详情（`.zoom-overlay` 出现过几次） */
  readonly detailsOpened: number;
  /** 见过"**能看**的反面牌"：详情里有「查看正面」按钮（`.zoom-peek-btn`） */
  readonly peekAvailable: boolean;
  /** 见过"**不能看**的反面牌"：详情里**没有**那个按钮 */
  readonly peekBlocked: boolean;
  /**
   * ★ P6：点过一次「**不在候选里、被压暗**」的牌（`.card.choice-dim`）。
   *
   * 这是「默认目标规则」那一课的**走偏那一下**：玩家照着本能去点被盖住的牌 ⇒ 点不动 ⇒
   * 屏给一句提示（`tutorial.choice.blocked`）。红线上那层是 `render.ts` 给非候选卡加
   * `.choice-dim` 且**不绑任何点击**，所以这一下只有教学屏自己盯得住（body 级捕获监听）。
   */
  readonly blockedPickTried?: boolean;
  /** ★ P6：到目前为止见过的每次 `select` 请求的候选集合（按效果源归类，见 `TutChoiceSeen`） */
  readonly choices?: readonly TutChoiceSeen[];
}

/** 三样都还没发生（屏的初值，也是测试的常用初值） */
export const TUT_UI_NONE: TutUiSeen = { detailsOpened: 0, peekAvailable: false, peekBlocked: false };

/**
 * 「这张反面牌**能不能被看到正面**」—— **实现里那条规则**的纯函数镜像。
 *
 * 逐字对应 `src/ui/render.ts:417-418` 传给 `openZoom` 的第 5 个实参（`peek`）：
 * ```
 * card.faceUp || s.phase === 'gameover' || (isSelfSlot && !card.secret)
 * ```
 * 三个分支的含义（`render.ts:400-416` 的注释 + `resolve.ts` 里的 `secret` 写入点）：
 *  1. **正面朝上的卡**永远可看（已公开信息）；
 *  2. **对局结束（复盘）**时都可看；
 *  3. **这一槽是我自己的、且不是 `secret`** 时可看 —— 这一条正是用户那条口径。
 *
 * ⚠️ 它**不是第二份真相**：`tests/tutorial/levels.test.ts` 有一条**源码腿**把
 * `render.ts` 里那个表达式抽出来逐字比对（只改一边 ⇒ 当场红）。
 */
export function canPeekFaceDown(
  card: Pick<Card, 'faceUp' | 'secret'>,
  isSelfSlot: boolean,
  phase: string,
): boolean {
  return card.faceUp || phase === 'gameover' || (isSelfSlot && card.secret !== true);
}

/**
 * ★ 2026-10-02（P7）T11「触发时机」里**用日志观测**的两种触发（被盖住前 / 结束）。
 *
 * 为什么它们要从**引擎日志**里读：这两种触发的机械形态是"引擎在某个时点把一张卡的某一段
 * 文本入栈并结算"，而结算完之后**状态里只剩间接痕迹**（手牌多了、牌进了弃牌堆）。用户口径要的是
 * "三条触发真的各出现过一次"，最接近这件事的证据就是引擎自己那条 `[阶段] 卡：…` 日志
 * （`src/core/log.ts:23` 的 `pushEffectLog`，`stageLabel()` 给出中文阶段名）。
 *
 * ⚠️★ **第三种（`after-play`，打出后）不在这条通道里** —— 这是本轮实测抓到的一件事：
 * `after-play` 走的是**定向触发** `fireDirectedTop()`（`src/core/effects/resolve.ts:70-94`），
 * 它**只把效果入栈、不调 `pushEffectLog`** ⇒ 日志里**永远没有** `[连锁·出牌后]` 这一行
 * （`stageLabel('after-play')` 因此是一条**当前不可达**的标签）。所以 T11 的"打出后"那一路
 * 由**状态**证明：对手那张牌真的进了**对手的弃牌堆**（见 `judge.ts` 的 T11 分支）。
 * 这条如实登记在方案 §7.13，免得后来者又去日志里找一个不存在的字符串。
 *
 * ⚠️ 它们**不是第二份真相**：下面 `triggersSeen()` 逐字读的是 `stageLabel()` 的返回值，
 * `tests/tutorial/levels.test.ts` 有一条腿把两边钉在一起（只改一边就红）。
 */
export type TutTrigger = 'before-covered' | 'end';

/**
 * 两种触发各自的**日志标记**（与 `src/core/log.ts` 的 `stageLabel()` 逐字对应）：
 *
 * | kind | `stageLabel()` | 出处（实测，见方案 §7.13） |
 * |---|---|---|
 * | `before-covered` | `被盖前` | `fire-0` 底「被盖住前：先抽1张牌并翻转另1张牌」 |
 * | `end` | `结束` | `life-0` 顶「结束：若此卡被覆盖，则移除此卡」 |
 */
const TRIGGER_LABEL: Readonly<Record<TutTrigger, string>> = {
  'before-covered': '被盖前',
  'end': '结束',
};

/**
 * 从引擎日志里读"这两种触发各出现过没有（各出现过几次）"。
 *
 * 判据只关心"出现过"，所以返回值是每个 kind 的次数（`0` 就是没出现）。
 * ⚠️ 日志是**单调增长**的（教学里 `openLevel()` 重建 state 时才清空）⇒ 这个读数只会变大，
 * 正是判据要的语义（做过一次就算做过）——与 `judge.ts` 的 `revealSeen()` 同一口径。
 */
export function triggersSeen(log: readonly string[]): Readonly<Record<TutTrigger, number>> {
  const text = log.join('\n');
  const count = (kind: TutTrigger): number => text.split(`[${TRIGGER_LABEL[kind]}]`).length - 1;
  return {
    'before-covered': count('before-covered'),
    'end': count('end'),
  };
}

/** 进度（存 `L1_SETTINGS.tutorial`，零新增存储键） */
export interface TutProgress {
  /** 已完成关卡的 id（顺序 = 完成顺序，去重） */
  readonly done: readonly TutLevelId[];
  /** 当前关（下次从它继续） */
  readonly current: TutLevelId;
}
