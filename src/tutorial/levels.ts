/**
 * ★ 2026-10-02（P2 + 用户追加两课 + P5 + P6）：**教学模式的关卡数据**。
 *
 * 方案：`docs/2026-10-01-新手引导与教学-方案.md` §5.1（形态）、§5.2（关卡表）、§5.4
 * （★ P6 新增「教学设计硬要求」四件套）、§7.8（P2）、§7.9（追加两课 + 重新编号）、
 * §7.10（中部指令的两条露出途径的实测）、§7.11（P6：两课 + 四件套 + 逐关审计）。
 *
 * 用户 2026-10-01 拍板"先做 T0~T3，验收后再补"；2026-10-02 追加「查看卡牌详情」与
 * 「场上的反面牌能不能看」两课；同日晚些时候又追加「默认目标规则」与「打出 vs 露出」
 * 两课，并要求**每一关都按"实战例子 → 引导步骤 → 观察点 → 亲自动手"四件套来做**
 * （不许有只念文字的关卡）—— 四件套的字段就是下面这四个：
 * `scenario` / `guidedSteps` / `observe` / `interaction`。
 *
 * ## 这一层是什么 / 不是什么
 *
 * **是**：关卡数据的**唯一出处**（每关教什么、要玩家做什么、判定什么、走偏说什么）。
 * **不是**：不碰 DOM（屏在 `src/ui/tutorial-screen.ts`）、不碰存储（进度在 `progress.ts`）、
 * 不碰引擎（受控局面的布置在 `setup.ts`，判定在 `judge.ts`）。
 *
 * ## 文案为什么是**函数**而不是"键字符串"
 *
 * 第一版把文案写成 `titleKey: 'tutorial.T0.title'`，由屏去 `t(level.titleKey)` —— 那样
 * `t()` 的实参是**动态的**，会被 `tests/i18n/tables.test.ts` 的"不许有动态键"腿当场判红
 * （缺键扫描器看不见这类调用 ⇒ 等于漏翻的温床）。⇒ 改成**取值函数**：
 * `title: () => t('tutorial.T0.title')`，**每一个 `t()` 的实参都是字面量**。
 */
import { t } from '../i18n';
import type { TutLevelId, TutSpot, TutOp } from './types';

/** 一关的全部数据 */
export interface TutLevel {
  readonly id: TutLevelId;
  readonly title: () => string;
  readonly goal: () => string;
  readonly teach: readonly (() => string)[];
  /**
   * ★ 2026-10-02（P6，用户 2026-10-01 追加的硬要求）**实战例子**：
   * 一句话说清"这一关是在什么局面下教什么"，用**真卡真局面**（局面就是
   * `setup.ts` 里 `buildLevelState(id)` 摆出来的那一份，不是编的）。
   */
  readonly scenario: () => string;
  /** ★ P6 **引导步骤**：祈使句、按顺序点哪拖哪（至少一条） */
  readonly guidedSteps: readonly (() => string)[];
  /** ★ P6 **观察点**："你会看到……" —— 做完之后屏上/日志里会出现什么 */
  readonly observe: () => string;
  /**
   * ★ P6 **四件套的第 4 件：亲自动手**——本关的"真实操作"是哪一类。
   *
   * 为什么要显式声明（而不是让腿去猜）：T0/T1/T6 是"看卡 / 点热点"类关卡，
   * **没有引擎动作**（`allowKinds` 是空的），所以"至少一次真实操作"这条硬要求对它们
   * 只能按 **UI 交互**来表述；其余关卡按**引擎动作**。两条各自的成立条件写死在
   * `tests/tutorial/levels.test.ts` 的生成式腿里，**不许**放宽成恒真：
   *
   *  - `'engine'` ⇒ `allowKinds.length ≥ 1`（本关真的放行了引擎动作，玩家必须提交一次）
   *    **且** `ui?.detailsAtLeast === undefined`（判据不是纯 UI 读数）；
   *  - `'ui'` ⇒ `spots` 非空（T0：四个热点，判据读 `spotsDone`）
   *    **或** `ui?.detailsAtLeast ≥ 1`（T1/T6：详情遮罩真的打开过）；
   *    两类都是 **UI 状态差分**，不是"点了下一步就算过"。
   */
  readonly interaction: 'engine' | 'ui';
  /**
   * ★ 2026-10-02（P7）**本关要不要保留引擎自己的"步"**（缺省 false ⇒ 教学屏在每次动作之后
   * 把回合交还玩家 0 并回到行动步，那是 T4 那批"连着做几个动作"的关卡需要的沙盒规则）。
   *
   * 只有 **T10（控制权）** 需要它：控制权的判定发生在 **`check-control` 这一步**
   * （`src/core/game.ts:293` 的 `performAdvance`），而玩家必须**点一次「推进」**才会走到那一步
   * （`getLegalActions` 在 `step === 'check-control'` 时只出 `advance`）。
   * 教学屏原来那条"动作后强制回到 `action`"的规则会**把这一步跳过去** ⇒ 这一关就永远过不了。
   * ⇒ T10 开局就摆在 `check-control`，并声明 `keepStep: true`：那一次 `advance` 之后
   * `checkControl()` 真的跑（与真对局同一条代码路径），判据读 `s.control`。
   */
  readonly keepStep?: boolean;
  /**
   * ★ 2026-10-06（S0「序章」）**打完一张牌之后把引擎的步交回「检查编译」那一步**。
   *
   * 为什么需要它（**引擎的真实次序**，不是编的）：`STEP_ORDER`（`src/core/engine/turn.ts:4`）
   * 是 `start → check-control → check-compile → action → check-cache → end` —— 编译判定在
   * **自己回合的开头**，而"把一条链路打到 10 分"发生在 `action` 步（`play` 之后
   * `game.ts:162` 只推进到 `check-cache`）。所以真对局里"补上第 10 分"与"被要求编译"
   * **隔着一整轮**（要等对手打完自己回合、再回到你的 `check-compile`）。
   *
   * S0 要连着演示这两步（补分 ⇒ 必须编译 ⇒ 赢），⇒ 声明它：本关在一次成功的动作之后，
   * 若引擎停在 `check-cache`，屏把 `step` 摆回 `check-compile`（`tutorial-screen.ts` 的
   * `handBackTurn()`，与那条"动作后强制回到 `action`"的沙盒规则同一处）。
   *
   * ⚠️ 压缩的**只是时序**：编译仍然是引擎自己的 `executeCompile`（`check-compile` 那一步
   * 的合法动作），`compile is mandatory` 那条守卫、线值判定（`compile-body.ts:42`）与
   * 胜负判定（`:131`）一个字都没绕过。
   */
  readonly toCompileStepAfterPlay?: boolean;
  /** T0 专用：要点一遍的四个区域（链路 / 协议 / 阈值 / 控制权） */
  readonly spots?: readonly TutSpot[];
  /**
   * 引擎动作的白名单（`UiCallbacks.onAction` 的拦截面）。
   *
   * ⚠️ 这是"只放行"的落点：引擎（`core/**`）与渲染器（`render.ts`）都是红线、不许改，
   * 所以本屏**自己**持有 `cb`：不在白名单里的动作**不提交**、只给一句走偏提示
   * —— 见 `judge.ts` 的 `offTrackKeyFor`。代价写在方案 §7.8。
   */
  readonly allowKinds: readonly string[];
  /** T4 专用：要集齐的五个动作签名 */
  readonly ops?: readonly TutOp[];
  /**
   * ★ 2026-10-02：**界面观察类**关卡（T1 卡牌详情 / T6 反面牌可视）的判据声明。
   *
   * 写成数据（而不是屏里的 `if (id === 'T1')`）之后，测试可以生成式地断言
   * "声明与判据一致" —— 见 `tests/tutorial/levels.test.ts`。
   */
  readonly ui?: {
    /** 打开过几次卡牌详情算过 */
    readonly detailsAtLeast?: number;
    /** 需要见过"能看的反面牌"（详情里有「查看正面」按钮） */
    readonly needPeekAvailable?: boolean;
    /** 需要见过"不能看的反面牌"（详情里没有那个按钮） */
    readonly needPeekBlocked?: boolean;
  };
}

/**
 * 十五关。**顺序就是玩的顺序**（进度里的"当前关"按这个数组的序号推）。
 *
 * ★ 2026-10-06（用户要求）：**最前面插一关 `S0`（序章）** —— 先讲背景故事、再讲清"这一局
 * 怎么算赢"，然后才进原来的 `T0`（界面扫盲）。`T0`~`T13` 的 id **一个都没动**
 * （已存进度仍指向原来那几课），只是没玩过的人从 `S0` 开始。
 *
 * ★ 2026-10-02（P6）**编号再动一次**：`T7` 从"编译与阈值"变成"默认目标规则"、
 * 编译挪到 `T8`、新增 `T9`「打出 vs 露出」。理由与老进度的代价写在方案 §7.11。
 * ★ 2026-10-02（P7）**追加最后四关** T10~T13（控制权 / 触发时机 / 删除·免疫·加成 / 迷你对局）——
 * 这一次只是往后加，老进度的 id 没有被重新指向（方案 §7.13）。
 */
export const TUT_LEVELS: readonly TutLevel[] = [
  {
    id: 'S0',
    /**
     * ★ 2026-10-06（用户原话）：「再加上一关，用于先告诉玩家背景故事，然后再给玩家详细解释，
     * 这个游戏的胜利条件是什么，然后再是介绍界面」。
     *
     * 文案**逐句取自**本仓在发的官方规则书页图（`public/assets/rules/pages/rule-mn01/`
     * 的 `page-01.jpg` THEME/SUMMARY 与 `page-02.jpg` Compile/Victory/Control），
     * 英文直接用官方原文；定稿与出处见 `.superpowers/2026-10-06-S0-序章/S0-copy.md`。
     *
     * 四件套：`scenario`（决胜那一步的棋盘）/ `guidedSteps`（选中那张 1 分牌 → 打进第 3 条链路）/
     * `observe`（链路到 10 ⇒ 协议翻面、清线 ⇒ 3 张全编译就是赢）。
     *
     * 判据（`judge.ts` 的 S0 分支）读的是**引擎自己的胜负结论** `s.winner === 0` ——
     * 这一关的过关形态就是"真打赢一局"，不是"点下一步"。
     */
    title: () => t('tutorial.S0.title'),
    goal: () => t('tutorial.S0.goal'),
    teach: [
      () => t('tutorial.S0.teach.0'),
      () => t('tutorial.S0.teach.1'),
      () => t('tutorial.S0.teach.2'),
    ],
    scenario: () => t('tutorial.S0.scenario'),
    guidedSteps: [
      () => t('tutorial.S0.steps.0'),
      () => t('tutorial.S0.steps.1'),
    ],
    observe: () => t('tutorial.S0.observe'),
    // 两个引擎动作，都是这一关真的需要的：打出那张补分的牌（play）⇒ 引擎要求编译（compile）
    allowKinds: ['play', 'compile'],
    // ★ 打完牌之后把步交回 check-compile（引擎的编译判定那一步）—— 理由见 TutLevel.toCompileStepAfterPlay
    toCompileStepAfterPlay: true,
    interaction: 'engine',
  },
  {
    id: 'T0',
    title: () => t('tutorial.T0.title'),
    goal: () => t('tutorial.T0.goal'),
    teach: [
      () => t('tutorial.T0.teach.0'),
      () => t('tutorial.T0.teach.1'),
      () => t('tutorial.T0.teach.2'),
      () => t('tutorial.T0.teach.3'),
    ],
    scenario: () => t('tutorial.T0.scenario'),
    guidedSteps: [
      () => t('tutorial.T0.steps.0'),
      () => t('tutorial.T0.steps.1'),
      () => t('tutorial.T0.steps.2'),
    ],
    observe: () => t('tutorial.T0.observe'),
    spots: ['link', 'protocol', 'threshold', 'control'],
    // T0 只认"点高亮区域"，一个引擎动作都不放行（这一关不看牌，只看界面）
    allowKinds: [],
    // 四件套第 4 件：这一关的真实操作是**点热点**（UI 交互），不是引擎动作
    interaction: 'ui',
  },
  {
    id: 'T1',
    // ★ 用户 2026-10-02 追加：教怎么打开一张卡的详情
    //   （本仓做法 = **双击卡牌放大查看**，见 render.ts:417/1979 调 openZoom）
    title: () => t('tutorial.T1.title'),
    goal: () => t('tutorial.T1.goal'),
    teach: [
      () => t('tutorial.T1.teach.0'),
      () => t('tutorial.T1.teach.1'),
      () => t('tutorial.T1.teach.2'),
    ],
    scenario: () => t('tutorial.T1.scenario'),
    guidedSteps: [
      () => t('tutorial.T1.steps.0'),
      () => t('tutorial.T1.steps.1'),
    ],
    observe: () => t('tutorial.T1.observe'),
    // 只看卡、不动牌：双击放大不走引擎 ⇒ 一个引擎动作都不放行
    allowKinds: [],
    ui: { detailsAtLeast: 1 },
    // 四件套第 4 件：真实操作 = 双击 **UI 状态差分**（详情遮罩真的打开了）
    interaction: 'ui',
  },
  {
    id: 'T2',
    title: () => t('tutorial.T2.title'),
    goal: () => t('tutorial.T2.goal'),
    teach: [
      () => t('tutorial.T2.teach.0'),
      () => t('tutorial.T2.teach.1'),
      () => t('tutorial.T2.teach.2'),
    ],
    scenario: () => t('tutorial.T2.scenario'),
    guidedSteps: [
      () => t('tutorial.T2.steps.0'),
      () => t('tutorial.T2.steps.1'),
    ],
    observe: () => t('tutorial.T2.observe'),
    allowKinds: ['play'],
    interaction: 'engine',
  },
  {
    id: 'T3',
    title: () => t('tutorial.T3.title'),
    goal: () => t('tutorial.T3.goal'),
    teach: [
      () => t('tutorial.T3.teach.0'),
      () => t('tutorial.T3.teach.1'),
      () => t('tutorial.T3.teach.2'),
    ],
    scenario: () => t('tutorial.T3.scenario'),
    guidedSteps: [
      () => t('tutorial.T3.steps.0'),
      () => t('tutorial.T3.steps.1'),
      () => t('tutorial.T3.steps.2'),
    ],
    observe: () => t('tutorial.T3.observe'),
    allowKinds: ['play'],
    interaction: 'engine',
  },
  {
    id: 'T4',
    title: () => t('tutorial.T4.title'),
    goal: () => t('tutorial.T4.goal'),
    teach: [
      () => t('tutorial.T4.teach.0'),
      () => t('tutorial.T4.teach.1'),
      () => t('tutorial.T4.teach.2'),
      () => t('tutorial.T4.teach.3'),
    ],
    scenario: () => t('tutorial.T4.scenario'),
    guidedSteps: [
      () => t('tutorial.T4.steps.0'),
      () => t('tutorial.T4.steps.1'),
      () => t('tutorial.T4.steps.2'),
      () => t('tutorial.T4.steps.3'),
    ],
    observe: () => t('tutorial.T4.observe'),
    allowKinds: ['play', 'effect-choice'],
    ops: ['flip', 'shift', 'draw', 'discard', 'return'],
    interaction: 'engine',
  },
  {
    id: 'T5',
    // 覆盖与揭开（方案 §5.2 的 T4）
    title: () => t('tutorial.T5.title'),
    goal: () => t('tutorial.T5.goal'),
    teach: [
      () => t('tutorial.T5.teach.0'),
      () => t('tutorial.T5.teach.1'),
      () => t('tutorial.T5.teach.2'),
    ],
    scenario: () => t('tutorial.T5.scenario'),
    guidedSteps: [
      () => t('tutorial.T5.steps.0'),
      () => t('tutorial.T5.steps.1'),
    ],
    observe: () => t('tutorial.T5.observe'),
    allowKinds: ['play'],
    interaction: 'engine',
  },
  {
    id: 'T6',
    // ★ 用户 2026-10-02 追加：场上的反面牌什么时候能看正面（由 T5 的"揭开"引出）
    title: () => t('tutorial.T6.title'),
    goal: () => t('tutorial.T6.goal'),
    teach: [
      () => t('tutorial.T6.teach.0'),
      () => t('tutorial.T6.teach.1'),
      () => t('tutorial.T6.teach.2'),
      () => t('tutorial.T6.teach.3'),
    ],
    scenario: () => t('tutorial.T6.scenario'),
    guidedSteps: [
      () => t('tutorial.T6.steps.0'),
      () => t('tutorial.T6.steps.1'),
    ],
    observe: () => t('tutorial.T6.observe'),
    // 本关也只看卡不动牌（两个对照全靠双击放大）
    allowKinds: [],
    ui: { detailsAtLeast: 2, needPeekAvailable: true, needPeekBlocked: true },
    // 四件套第 4 件：真实操作 = 双击两张反面牌做对照（**UI 状态差分**）
    interaction: 'ui',
  },
  {
    id: 'T7',
    // ★ 用户 2026-10-02 追加（任务 A.1）：默认目标规则
    //   用户原话：「一般情况下，若卡牌文本中没有特别说明是**所有卡牌**或是**被覆盖的卡牌**，
    //   则默认卡牌的效果对象只能是**双方场上未被覆盖的卡牌**」
    //   口径出处：`docs/2代效果开发手册.md` §3.2 + 2026-09-30 那次"候选口径统一"；
    //   实现的落点是 `listCandidates`（`src/core/effects/context.ts:64`）。
    title: () => t('tutorial.T7.title'),
    goal: () => t('tutorial.T7.goal'),
    teach: [
      () => t('tutorial.T7.teach.0'),
      () => t('tutorial.T7.teach.1'),
      () => t('tutorial.T7.teach.2'),
    ],
    scenario: () => t('tutorial.T7.scenario'),
    guidedSteps: [
      () => t('tutorial.T7.steps.0'),
      () => t('tutorial.T7.steps.1'),
      () => t('tutorial.T7.steps.2'),
      () => t('tutorial.T7.steps.3'),
      () => t('tutorial.T7.steps.4'),
    ],
    observe: () => t('tutorial.T7.observe'),
    allowKinds: ['play', 'effect-choice'],
    interaction: 'engine',
  },
  {
    id: 'T8',
    // 编译与阈值（方案 §5.2 的 T5；P5 时是 T7，P6 让位一格）
    title: () => t('tutorial.T8.title'),
    goal: () => t('tutorial.T8.goal'),
    teach: [
      () => t('tutorial.T8.teach.0'),
      () => t('tutorial.T8.teach.1'),
      () => t('tutorial.T8.teach.2'),
    ],
    scenario: () => t('tutorial.T8.scenario'),
    guidedSteps: [
      () => t('tutorial.T8.steps.0'),
      () => t('tutorial.T8.steps.1'),
    ],
    observe: () => t('tutorial.T8.observe'),
    allowKinds: ['compile'],
    interaction: 'engine',
  },
  {
    id: 'T9',
    // ★ 用户 2026-10-02 追加（任务 A.2）：打出 vs 露出
    //   用户原话：「卡牌的中部指令不仅能够通过从手牌中『打出』触发其效果，还能通过『露出』
    //   来触发……例如：可以通过**翻面一张反面卡牌**的方式来『露出』……也可以通过**偏转**将
    //   一张**已被覆盖**的卡牌变为**未被覆盖**……（这里通过**速度0**这张牌来演示）」
    //
    //   ⚠️ 两条路的**实测读数**（真引擎，P6）写在方案 §7.10：
    //    · 翻正露出：成立（`resolve.ts:469`，前置是**未被覆盖**；FAQ 127 被盖的翻正不连锁）；
    //    · 偏转**覆盖者**（它原来是该线顶卡）⇒ 新顶被揭开 ⇒ 成立（`resolve.ts:575` 的
    //      `revealAfterRemoval`）——这正是本关第 2 段演示的做法；
    //    · 偏转**被覆盖的那张本身**（`allowCovered`）⇒ **不成立**（`completeShift` 的落地重估
    //      只对 `diversity-0`/`unity-1` 开，`resolve.ts:1091`）。这条也如实写进 §7.10。
    title: () => t('tutorial.T9.title'),
    goal: () => t('tutorial.T9.goal'),
    teach: [
      () => t('tutorial.T9.teach.0'),
      () => t('tutorial.T9.teach.1'),
      () => t('tutorial.T9.teach.2'),
      () => t('tutorial.T9.teach.3'),
      () => t('tutorial.T9.teach.4'),
    ],
    scenario: () => t('tutorial.T9.scenario'),
    guidedSteps: [
      () => t('tutorial.T9.steps.0'),
      () => t('tutorial.T9.steps.1'),
      () => t('tutorial.T9.steps.2'),
      () => t('tutorial.T9.steps.3'),
      () => t('tutorial.T9.steps.4'),
      () => t('tutorial.T9.steps.5'),
    ],
    observe: () => t('tutorial.T9.observe'),
    allowKinds: ['play', 'effect-choice'],
    interaction: 'engine',
  },
  {
    id: 'T10',
    // ★ 2026-10-02（P7）：控制权 —— 怎么拿到、拿到有什么用
    //   实现口径（**文案必须按这个写**，见方案 §7.13）：`checkControl()`（`src/core/rules/control.ts:35-52`）
    //   只看**当前行动玩家自己**：他在**至少 2 条**线路上的总值高于对手 ⇒ 获得控制组件。
    //   ⚠️ 上一轮有人把"编译门槛"讲成"差 5"被自己的腿抓到；这里同理，文案写"两条线都高过对手"。
    title: () => t('tutorial.T10.title'),
    goal: () => t('tutorial.T10.goal'),
    teach: [
      () => t('tutorial.T10.teach.0'),
      () => t('tutorial.T10.teach.1'),
      () => t('tutorial.T10.teach.2'),
      () => t('tutorial.T10.teach.3'),
    ],
    scenario: () => t('tutorial.T10.scenario'),
    guidedSteps: [
      () => t('tutorial.T10.steps.0'),
      () => t('tutorial.T10.steps.1'),
      () => t('tutorial.T10.steps.2'),
    ],
    observe: () => t('tutorial.T10.observe'),
    // 本关唯一的动作就是"推进一格"（引擎在 check-control 这一步判定控制权）
    allowKinds: ['advance'],
    // ★ 这一关必须让引擎的"步"真的走一格（否则 check-control 被跳过去）—— 见 TutLevel.keepStep
    keepStep: true,
    interaction: 'engine',
  },
  {
    id: 'T11',
    // ★ 2026-10-02（P7）：触发时机 —— 打出后 / 被盖住前 / 结束，三种各用一张真卡演示一次
    title: () => t('tutorial.T11.title'),
    goal: () => t('tutorial.T11.goal'),
    teach: [
      () => t('tutorial.T11.teach.0'),
      () => t('tutorial.T11.teach.1'),
      () => t('tutorial.T11.teach.2'),
      () => t('tutorial.T11.teach.3'),
    ],
    scenario: () => t('tutorial.T11.scenario'),
    /**
     * ★ 2026-10-06：三步（原来四步）—— 旧 `steps.0`（"先把对手那张寒冰4 打到线 1"）在教学屏里
     * 做不到（那要求玩家去打**对手手牌**，见 `setup.ts` 的 T11 段），已按新的棋盘改成
     * "反面盖住自己线 2 的火焰0"这一步；同时删掉 `tutorial.T11.steps.3` 那条键
     * （步骤重编号，旧键在两张表里都已移除 —— 留着会变成"谁也读不到的死键"）。
     */
    guidedSteps: [
      () => t('tutorial.T11.steps.0'),
      () => t('tutorial.T11.steps.1'),
      () => t('tutorial.T11.steps.2'),
    ],
    observe: () => t('tutorial.T11.observe'),
    /**
     * play = 反面盖住火焰0（同一次出牌里「被盖住前」与「打出后」都响）；effect-choice = 冰1 让
     * 对手弃牌那次应答；advance = 把步推进到结束阶段；resolve-trigger = 结束阶段点「结算触发」。
     *
     * ★ 2026-10-06 补上 `advance`（用户当天报的缺陷）：这一关的判据要求日志里出现 `[结束]`，
     * 而"结束"只发生在 `end` 步 —— 不推进一步就到不了（旧白名单里没有它，玩家点了「下一步」
     * 只会被判成走偏）。
     */
    allowKinds: ['play', 'effect-choice', 'advance', 'resolve-trigger'],
    /**
     * ★ 2026-10-06：这一关的三种触发**跨引擎的三步**（action → check-cache → end）⇒ 与 T10 同款，
     * 声明 `keepStep` 让引擎自己的步真的走（否则教学屏那条"动作后交还 action 步"的沙盒规则
     * 会把 step 打回 action，玩家永远到不了结束阶段）。
     */
    keepStep: true,
    interaction: 'engine',
  },
  {
    id: 'T12',
    // ★ 2026-10-02（P7）：删除 / 免疫 / 加成
    title: () => t('tutorial.T12.title'),
    goal: () => t('tutorial.T12.goal'),
    teach: [
      () => t('tutorial.T12.teach.0'),
      () => t('tutorial.T12.teach.1'),
      () => t('tutorial.T12.teach.2'),
      () => t('tutorial.T12.teach.3'),
    ],
    scenario: () => t('tutorial.T12.scenario'),
    guidedSteps: [
      () => t('tutorial.T12.steps.0'),
      () => t('tutorial.T12.steps.1'),
      () => t('tutorial.T12.steps.2'),
      () => t('tutorial.T12.steps.3'),
    ],
    observe: () => t('tutorial.T12.observe'),
    allowKinds: ['play', 'effect-choice'],
    interaction: 'engine',
  },
  {
    id: 'T13',
    // ★ 2026-10-02（P7）：迷你对局 —— 用三条线打一小局到终局（`s.winner !== null`）
    title: () => t('tutorial.T13.title'),
    goal: () => t('tutorial.T13.goal'),
    teach: [
      () => t('tutorial.T13.teach.0'),
      () => t('tutorial.T13.teach.1'),
      () => t('tutorial.T13.teach.2'),
      () => t('tutorial.T13.teach.3'),
    ],
    scenario: () => t('tutorial.T13.scenario'),
    guidedSteps: [
      () => t('tutorial.T13.steps.0'),
      () => t('tutorial.T13.steps.1'),
      () => t('tutorial.T13.steps.2'),
    ],
    observe: () => t('tutorial.T13.observe'),
    allowKinds: ['compile'],
    interaction: 'engine',
  },
];

/**
 * 关卡总数（**唯一出处**：屏上的"第 N 关 / 共 N 关"与隐私屏的读数都取这里）。
 *
 * ⚠️ 2026-10-02 收口：以前屏上写 `TUT_LEVELS.length`、隐私屏也写 `TUT_LEVELS.length`，
 * 看着是一处；但"共 4 关"这类**数字**一旦被抄进文案表就会变成第二处真相 ⇒
 * 现在两处都 export 这个常量，文案里的 `{total}` 由调用方填。
 */
export const TUT_LEVEL_COUNT = TUT_LEVELS.length;

/** 全部关卡 id（**顺序**与 `TUT_LEVELS` 一致） */
export const TUT_LEVEL_IDS: readonly TutLevelId[] = TUT_LEVELS.map((l) => l.id);

/** 按 id 取关卡（找不到当场抛：调用方给的是 `TutLevelId`，找不到就是代码写错了） */
export function levelById(id: TutLevelId): TutLevel {
  const found = TUT_LEVELS.find((l) => l.id === id);
  if (found === undefined) throw new Error(`unknown tutorial level: ${id}`);
  return found;
}

/** 关卡序号（0 起）——进度里存的是它 */
export function levelIndex(id: TutLevelId): number {
  const i = TUT_LEVELS.findIndex((l) => l.id === id);
  if (i < 0) throw new Error(`unknown tutorial level: ${id}`);
  return i;
}

/** 序号 → 关卡 id（越界钳到两端：通关之后再进教学停在最后一关，而不是崩） */
export function levelAt(index: number): TutLevelId {
  const i = Math.max(0, Math.min(TUT_LEVELS.length - 1, Math.trunc(index)));
  return TUT_LEVELS[i].id;
}

/** 四个热点的稳定顺序（T0 的判据"四个都点过"按它算，免得受点击顺序影响） */
export const TUT_SPOTS: readonly TutSpot[] = ['link', 'protocol', 'threshold', 'control'];
