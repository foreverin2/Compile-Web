export type PlayerId = 0 | 1;
export type Line = 0 | 1 | 2;
export type Zone = 'hand' | 'deck' | 'field' | 'trash' | 'float';
export type Step =
  | 'start'
  | 'check-control'
  | 'check-compile'
  | 'action'
  | 'check-cache'
  | 'end';
export type Phase = 'draft' | 'setup' | 'turn' | 'gameover';

/** 卡牌定义：静态数据（来自用户提供的卡牌文本，或占位演示数据） */
export interface CardDef {
  defId: string;
  protocol: string;
  value: number;
  top?: string;
  middle?: string;
  bottom?: string;
}

/** 协议定义：静态数据 */
export interface ProtocolDef {
  defId: string;
  name: string;
  /** 产品世代：1代=MN01（基础 12）/AX01（拓展 3）；2代=MN02（基础 12）/AX02（拓展 3） */
  set: 'MN01' | 'AX01' | 'MN02' | 'AX02';
  commands: string[];
  loadingText: string;
}

/** 卡牌实例：运行时状态 */
export interface Card {
  uid: string;
  defId: string;
  owner: PlayerId;
  faceUp: boolean;
  zone: Zone;
  line: Line | null;
  /** 在堆叠中的位置：0 = 最底层（贴协议），越大越靠上；null = 不在场上堆叠 */
  pos: number | null;
  /** 牌堆来源的反面打出卡 = 非公开信息，翻开前持有者不可窥视
   *  （playTopDeck 打出时置 true；翻面 op 翻正为正面时清 false；进入手牌即解禁——
   *  回手/抽入/夺取进手一律清 false，手牌 = 已知信息。手牌来源（playFromHand）不打此标记） */
  secret?: boolean;
}

/** 协议运行时状态 */
export interface ProtocolState {
  defId: string;
  compiled: boolean;
}

/** 玩家运行时状态 */
export interface PlayerState {
  hand: Card[];
  deck: Card[];
  trash: Card[];
  /** 长度固定 3，下标即线编号 */
  protocols: ProtocolState[];
  /** 每条线的堆叠，长度固定 3；stacks[line] 内 pos 0 为底层 */
  stacks: Card[][];
}

/** 触发种类：被盖住前 / 结束 / 开始 / XX后（连锁）
 *  - before-covered：被盖住前（顶卡检查，如 fire-0/life-3/hate-4/apathy-2 底、metal-6 顶）
 *  - before-flip：翻转前（flip op 前置检查，metal-6 顶）
 *  - before-compile：通过编译删除前（executeCompile 前置，speed-2 顶）
 *  - after-draw / after-discard / after-delete / after-clear-cache：即时连锁（fireReactive，
 *    spirit-3 / plague-1 / hate-3 / speed-1 顶；顶命令被覆盖仍生效）
 *  - 'after'：旧预留（未用，保留） */
export type TriggerKind =
  | 'before-covered'
  | 'end'
  | 'start'
  | 'after'
  | 'before-flip'
  | 'before-compile'
  | 'after-draw'
  | 'after-discard'
  | 'after-delete'
  | 'after-clear-cache';

/** 选择候选卡（供 UI 渲染） */
export interface ChoiceCard {
  uid: string;
  defId: string;
  faceUp: boolean;
  owner: PlayerId;
  zone: Zone;
  line: Line | null;
  pos: number | null;
  label: string;
}

/** 选择请求（生成器 yield 的值之一） */
export interface ChoiceRequest {
  kind: 'select' | 'select-line' | 'select-action';
  title: string;
  min: number;
  max: number;
  optional: boolean;
  candidates: ChoiceCard[];
  /** select-line：可选目标线（编码 'line:N'） */
  lines?: Line[];
  /** select-action：可执行操作（编码 'action:<name>'） */
  actions?: string[];
  /** 选择权归属者（缺省 = PendingEffect.player；"被作用卡持有者决定"用） */
  chooser?: PlayerId;
}

export interface ChoiceAnswer {
  selected: string[];
}

/** 揭示产生的幽灵牌：把被揭示卡的正面复制到 shownTo 玩家手牌区末尾，不参与任何事件。
 *  两个用例（turn-count 过期）：
 *  - Case A 把自己的卡/手牌揭示给对手看：shownTo = 对手；expiresAtTurn = 揭示时计数 + 2
 *    （撑过发起者本回合结束 + 对手整回合，对手回合结束转换时清除）。
 *  - Case B 把对手的卡/手牌揭示给自己看（如 light-4）：shownTo = 发起者；
 *    expiresAtTurn = 揭示时计数 + 3（撑过发起者本回合结束 + 对手整回合 + 发起者下回合，
 *    发起者【下】回合结束转换时清除——不是对手回合结束）。
 *  清除时机：turn.ts 在每次回合结束转换（end → start）时 turnCount +1，
 *  清除 expiresAtTurn <= 新计数的幽灵。 */
export interface RevealedGhost {
  id: string;
  defId: string;
  /** 显示在哪位玩家的手牌区末尾（Case A = 对手；Case B = 发起揭示的玩家） */
  shownTo: PlayerId;
  /** 过期阈值：turnCount 达到该值时在回合结束转换时被清除 */
  expiresAtTurn: number;
  /** light 协议触发的揭示（light-2/light-4，且效果卡协议随打出者结算——易主不影响）：
   *  落地幽灵渲染光之辉光（十字星 + 边框辉光），存在期间持续 */
  lightFx?: boolean;
  /** love 协议触发的揭示（love-4 揭示自己手牌 → Case A 幽灵给对方）：落地幽灵渲染
   *  粉红边框辉光 + 中间爱心跳动（render.ts 挂 .fx-love-ghost + .fx-love-heart），
   *  持续时间 = 幽灵存在期间（幽灵过期移除时特效随 DOM 消失） */
  fx?: 'love';
}

/** 效果操作（生成器 yield 的值之一；由运行器执行并触发连锁/语义事件）
 *  - draw.player 缺省 = 效果属主；fromOpponentDeck = 从 player 的对手牌库抽顶（洗对手弃牌堆）
 *  - playTopDeck.player 缺省 = 效果属主；belowUid = 落地时插入该卡下方（该卡保持未覆盖）
 *  - rearrangeProtocols.player 缺省 = 效果属主
 *  - give：持有者手牌中 uid 卡移交 to 玩家（owner 更新）
 *  - takeRandom：从 from 玩家手牌随机取 1 张给效果属主（owner 更新） */
export type Op =
  | { op: 'discard'; uid: string }
  | { op: 'discardMany'; uids: string[] }
  | { op: 'delete'; uid: string; allowCovered?: boolean }
  | { op: 'return'; uid: string; allowCovered?: boolean }
  | { op: 'flip'; uid: string; allowCovered?: boolean }
  | { op: 'draw'; count: number; player?: PlayerId; fromOpponentDeck?: boolean }
  | { op: 'shift'; uid: string; targetLine: Line; allowCovered?: boolean }
  | { op: 'playTopDeck'; line: Line; faceUp: boolean; player?: PlayerId; belowUid?: string }
  | { op: 'playFromHand'; uid: string; line: Line; faceUp: boolean }
  | { op: 'reveal'; uid: string }
  | { op: 'rearrangeProtocols'; a: Line; b: Line; player?: PlayerId }
  | { op: 'give'; uid: string; to: PlayerId }
  | { op: 'takeRandom'; from: PlayerId };

/** 效果步骤：选择请求 或 操作。既有 types.ts 已占用 Step（回合步骤），此处命名 EffectStep */
export type EffectStep = ChoiceRequest | Op;

/** 生成器 next() 的入参：选择答案 或 操作结果（操作无返回值） */
export type StepResult = ChoiceAnswer | Record<string, never>;

/** 效果栈元素：一个挂起的生成器 */
export interface PendingEffect {
  id: string;
  player: PlayerId;
  gen: Generator<EffectStep, void, StepResult>;
  sourceUid: string;
  sourceDefId: string;
  prompt: ChoiceRequest | null;
  lastAnswer: ChoiceAnswer | null;
  /** 系统效果（如清理缓存）：跳过 sourceValid 源卡有效性检查（无源卡） */
  system?: boolean;
  /** 顶命令触发的效果（fireReactive 推入的 after-*）：sourceValid 只查在场+正面，
   *  跳过未覆盖检查——顶命令被覆盖仍常驻生效（规则 90 行） */
  topCommand?: boolean;
}

/** 落地中的卡（浮空，等目标顶卡"被盖住前"结算后落地）；beforeCoveredDone = 目标顶卡"被盖住前"是否已结算（只结算一次）
 *  belowUid：playTopDeck 指定时插入该卡下方（该卡保持未被覆盖；卡已不在则回退落顶） */
export interface PendingLanding {
  card: Card;
  beforeCoveredDone: boolean;
  belowUid?: string;
}

/** 待结算触发条目（getLegalActions 供 UI 出按钮） */
export interface TriggerEntry {
  cardUid: string;
  defId: string;
  kind: TriggerKind;
  optional: boolean;
  /** 顶命令触发（TriggerDef.top：被盖仍生效）——resolve-trigger 时传给 resolveTrigger 作 topCommand */
  top?: boolean;
}

/** 候选过滤：zone 'hand' 需 owner；'field' 列出双方所有堆叠顶卡（排除结算中源卡）；covered:true 时列出堆叠中被覆盖的卡（排除顶卡与结算中源卡） */
export interface CandidateFilter {
  zone: 'hand' | 'field';
  owner?: PlayerId;
  covered?: boolean;
}

/** 效果上下文：生成器通过 ctx.candidates() 获取候选，ctx 持有状态引用 */
export interface EffectCtx {
  s: GameState;
  player: PlayerId;
  card: Card;
  candidates(filter: CandidateFilter): ChoiceCard[];
}

export type EffectGen = (ctx: EffectCtx) => Generator<EffectStep, void, StepResult>;

export interface TriggerDef {
  fn: EffectGen;
  optional: boolean;
  /** 顶命令触发（top 文本，如 death-1 顶「开始：…」、life-0 顶「结束：…」）：被覆盖仍生效
   *  ——end/start 收集含被盖卡（规则 90 + FAQ 98/99），且触发效果 sourceValid 跳过未覆盖检查 */
  top?: boolean;
}

export interface CardEffects {
  middle?: EffectGen;
  triggers?: Partial<Record<TriggerKind, TriggerDef>>;
  /** 顶命令数值修正：stackValue 计算该线总值时应用
   *  （target: own-stack 作用于拥有者总值；opponent-line 作用于对手同线总值；
   *    line 作用于该线双方估值——线上任一玩家堆叠中的正面修正卡即生效，每估值用估值方堆叠只应用一次） */
  valueModifier?: {
    target: 'own-stack' | 'opponent-line' | 'line';
    apply(s: GameState, owner: PlayerId, line: Line, total: number): number;
  };
}

export interface GameState {
  phase: Phase;
  /** 草案轮次：0-5（1-2-2-1 共 6 次选择） */
  draftRound: number;
  /** 已选出的协议（按选择顺序） */
  draftPicks: ProtocolDef[];
  /** 掷硬币先手机制（2026-09-03）：首位选择协议的玩家座位（0=玩家一 / 1=玩家二）。
   *  草稿轮选顺序由 draftStarter 派生（1-2-2-1 模式相对先手方展开）。默认 0。 */
  draftStarter: PlayerId;
  /** 对局中先出牌的玩家座位。用户拍板（2026-09-03）：后选协议者先出牌 ——
   *  掷硬币流程下 = 1 - draftStarter；默认 0 保持旧行为（无硬币直接开局）。 */
  firstToPlay: PlayerId;
  turnPlayer: PlayerId;
  /** 回合计数：每次回合结束转换（end → start）单调 +1，揭示幽灵牌按此过期 */
  turnCount: number;
  step: Step;
  /** 本回合是否已编译（编译后跳过 action 步骤） */
  compiledThisTurn: boolean;
  players: [PlayerState, PlayerState];
  /** -1 = 控制组件中立位 */
  control: -1 | PlayerId;
  winner: PlayerId | null;
  log: string[];
  /** 效果栈：长度 0 = 无挂起；>0 时顶部为待应答选择 */
  pendingEffects: PendingEffect[];
  /** 打出中的卡队列（FIFO，等"被盖住前"结算后逐一落地）；空 = 无 */
  pendingPlay: PendingLanding[];
  /** 偏转中的卡队列（FIFO，等露出卡结算后逐一落地）；空 = 无 */
  pendingShift: PendingLanding[];
  /** 本 end/start 步骤已结算的触发卡 uid（避免重复结算） */
  resolvedTriggerUids: string[];
  /** 打出链式结算完毕后需要推进回合步骤（runStack 栈空时消费） */
  pendingStepAdvance: boolean;
  /** 揭示幽灵牌（显示在 shownTo 玩家手牌区末尾；expiresAtTurn 回合结束转换时清除） */
  revealedGhosts: RevealedGhost[];
  /** metal-1「对手下回合不能编译」：被禁编译的玩家；其回合结束转换（advanceStep end→start）时清除 */
  compileBlocked: PlayerId | null;
  /** speed-2「通过编译删除此牌前」触发挂起：效果栈清空后由 runStack 消费执行编译本体 */
  pendingCompile: { player: PlayerId; line: Line } | null;
}
