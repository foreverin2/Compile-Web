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
  /** 产品世代：1代=MN01（基础 12）/AX01（拓展 3）；2代=MN02（基础 12）/AX02（拓展 3）；3代=MN03（基础 12）/AX03（拓展 3） */
  set: 'MN01' | 'AX01' | 'MN02' | 'AX02' | 'MN03' | 'AX03';
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
  /** 在链路中的位置：0 = 最底层（贴协议），越大越靠上；null = 不在场上链路 */
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
  /** 每条线的链路，长度固定 3；stacks[line] 内 pos 0 为底层 */
  stacks: Card[][];
}

/** 触发种类：被盖住前 / 结束 / 开始 / XX后（连锁）
 *  - before-covered：被盖住前（顶卡检查，如 fire-0/life-3/hate-4/apathy-2 底、metal-6 顶）
 *  - before-flip：翻转前（flip op 前置检查，metal-6 顶）
 *  - before-compile：通过编译删除前（executeCompile 前置，speed-2 顶）
 *  - after-draw / after-discard / after-delete / after-clear-cache：即时连锁（fireReactive，
 *    spirit-3 / plague-1 / hate-3 / speed-1 顶；顶命令被覆盖仍生效）
 *  - after-opponent-draw / after-self-discard：2代 批1 底命令反应（mirror-4/war-0「当对手抽牌时」、
 *    peace-4「你弃牌时」，未注册 top → 仅未覆盖顶卡触发；fireReactive 专用，不走 collectTriggers）
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
  | 'after-clear-cache'
  | 'after-opponent-draw'
  | 'after-self-discard'
  // 2代 批2（2026-09-05）：刷新/编译后反应（after-refresh 自身侧 / after-opponent-refresh、after-compile
  //   对手侧，war-0/1/2）；after-play（ice-1 对手在本线打出）、after-return（corruption-1 对手卡被召回）
  //   为定向触发（resolve completePlay/return 直接查同线/对手侧顶卡），不走 fireReactive 全扫
  | 'after-refresh'
  | 'after-opponent-refresh'
  | 'after-compile'
  | 'after-play'
  | 'after-return'
  // 2代 批3（2026-09-05）：切洗牌库后反应（time-2 顶「当你切洗牌库时：抽1」，self 方向）
  | 'after-shuffle'
  // 3代（2026-09，方向见 triggers.ts FIRE_DIR）：after-opponent-gain-control（对手获得控制权后，
  //   色欲4 底/傲慢6 顶）/ after-self-compile（你编译后，傲慢0 顶）/ after-any-compile（任意玩家编译后，
  //   动量1/6 顶）/ after-any-clear-cache（任意玩家清缓存后，暴食1 底）/ after-own-delete（你删除牌后，
  //   贪婪0 底，执行者侧）/ after-self-rearrange（你重排协议后，新星2 底）/ after-any-rearrange（任意玩家
  //   重排协议后，动量1 底）/ after-action-face-down-play（你用行动反面打出后，刚性2 底）
  | 'after-opponent-gain-control'
  | 'after-self-compile'
  | 'after-any-compile'
  | 'after-any-clear-cache'
  | 'after-own-delete'
  | 'after-self-rearrange'
  | 'after-any-rearrange'
  | 'after-action-face-down-play';

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
  /** UI 提示（2026-09-13 用户清单 #10）：本选择请求应由**重排模态**承接（动量4「重排你的协议」）。
   *  值 = 可重排的玩家侧；UI 在读到时不再渲染 `action:order:*` 按钮，改为打开编译期同款重排窗口，
   *  完成后回填一条 `action:order:XYZ`（引擎行为不变）。缺省 = 普通选择请求。 */
  rearrangeSide?: PlayerId;
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
   *  粉红边框辉光 + 中间爱心跳动（render.ts 挂 .fx-love-ghost + .fx-love-heart）；
   *  clarity 协议触发的揭示（透彻1 中对手揭示手牌 → Case B 幽灵给自己）：30% 透明眼睛 +
   *  背后圣光（render.ts 挂 .fx-clarity-ghost；透彻特效，批2）。持续时间 = 幽灵存在期间 */
  fx?: 'love' | 'clarity';
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
  | { op: 'flip'; uid: string; allowCovered?: boolean; noMiddle?: boolean }
  | { op: 'draw'; count: number; player?: PlayerId; fromOpponentDeck?: boolean }
  | { op: 'shift'; uid: string; targetLine: Line; allowCovered?: boolean }
  | { op: 'playTopDeck'; line: Line; faceUp: boolean; player?: PlayerId; belowUid?: string }
  | { op: 'playFromHand'; uid: string; line: Line; faceUp: boolean; belowUid?: string }
  | { op: 'reveal'; uid: string }
  | { op: 'rearrangeProtocols'; a: Line; b: Line; player?: PlayerId }
  | { op: 'give'; uid: string; to: PlayerId }
  | { op: 'takeRandom'; from: PlayerId }
  // —— 2代 批1 新增（2026-09-05，见 docs/批1规格 §7）——
  /** 弃牌库顶 1 张（player 缺省=效果属主）：牌库空不洗弃牌堆（FAQ 107），进弃牌堆正面公开 */
  | { op: 'discardDeckTop'; player?: PlayerId }
  /** 同玩家两个链路整堆换线（mirror-2）：各堆内部顺序不变；不触发任何文本/连锁 */
  | { op: 'swapStacks'; a: Line; b: Line; player?: PlayerId }
  /** 复制中央效果（mirror-1）：执行 uid 卡 defId 注册的 middle EffectGen；ctx.card=被复制卡、
   *  效果 player/源有效性跟踪发起效果（pe.player/pe.sourceUid） */
  | { op: 'copyMiddle'; uid: string }
  /** 任意顺序重排协议（chaos-1）：order = 0..2 的排列（新布局）；终态≠初态由调用方保证，执行层兜底校验 */
  | { op: 'reorderProtocols'; order: Line[]; player?: PlayerId }
  /** 从牌库任意位抽 1 张入手（clarity-2/3 揭示选抽）：剩余保持顺序；player 缺省=效果属主 */
  | { op: 'drawFromDeck'; uid: string; player?: PlayerId }
  // —— 2代 批3 新增（2026-09-05，裁决 docs/批3裁决结果.md）——
  /** 从弃牌堆打出（time-0/3）：trash 任意位卡 → 落地流程（触发 before-covered/中指令同常规打出）；
   *  uid 须在效果属主 trash；faceUp 由效果指定（time-0 玩家自选朝向/time-3 反面） */
  | { op: 'playFromTrash'; uid: string; line: Line; faceUp: boolean }
  /** 跨方牌库顶转移（assimilation-2/6）：从 from 玩家牌库顶 pop → 卡 owner 变 toPlayer →
   *  反面（faceDown）→ 落 toPlayer 的 toLine 链路（走 pendingPlay 落地流程，覆盖/连锁同打出） */
  | { op: 'deckTopTransfer'; from: PlayerId; toPlayer: PlayerId; toLine: Line }
  /** 场卡取入己手（assimilation-0）：目标场卡（正面朝下，含被盖）移除 → owner 变效果属主 → 入手
   *  （faceUp 公开/secret 清）；被盖移除不影响其上层；faceDown 顶卡移除不触发揭示（新顶 faceDown） */
  | { op: 'takeFromField'; uid: string }
  // —— 3代 批2（2026-09，docs/3代-批2-规格与裁决清单.md E6）——
  /** 手牌 1 张放回牌库底端（sloth-2 底「将手牌中的1张牌放回牌库底端」）：从持卡者手牌移除 →
   *  己方牌库底部（deck[0]）插入；回牌库 → faceDown 秘密化（同 R11.4 回牌库翻转） */
  | { op: 'toDeckBottom'; uid: string }
  // —— 3代 批3（2026-09，docs/3代-批3-规格与裁决清单.md E7）——
  /** 弃置整个牌库（inertia-4「弃置你的牌库」）：整库一次性批量入弃牌堆（公开 faceUp），
   *  按单次弃牌动作触发一次弃牌连锁（FAQ 94 / C9） */
  | { op: 'discardWholeDeck'; player?: PlayerId };

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
 *  belowUid：playTopDeck/playFromHand 指定时插入该卡下方（该卡保持未被覆盖；卡已不在则回退落顶）
 *  fromAction：玩家【行动】打出（actions/base playCard）——rigidity-2 底「你用行动反面打出后」据此触发
 *  actor：行动打出者（playCard 记录原玩家；腐化0 落对方场易主后 card.owner ≠ 行动玩家，
 *  completePlay 的 after-play/rigidity-2 视角须用 actor 而非 owner 推导） */
export interface PendingLanding {
  card: Card;
  beforeCoveredDone: boolean;
  belowUid?: string;
  fromAction?: boolean;
  actor?: PlayerId;
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

/** 候选过滤：zone 'hand' 需 owner；'field' 列出双方所有链路顶卡（排除结算中源卡）；covered:true 时列出链路中被覆盖的卡（排除顶卡与结算中源卡） */
export interface CandidateFilter {
  zone: 'hand' | 'field';
  owner?: PlayerId;
  covered?: boolean;
  /** 允许把【结算中的源卡自己】列入候选（默认排除，防幽灵状态）。
   *  2026-09-13 用户实测新增：3代 flexibility-1「翻转或偏转**你的**1张牌」、inertia-2/wrath-2
   *  「…中**所有**正面朝上的牌」等文案含自身 → 这些卡需要 includeSelf:true。 */
  includeSelf?: boolean;
}

/** 牌库揭示状态（2代 clarity-1 top 揭示牌库顶 / clarity-2/3 揭示整副牌库；UI 依此弹展示浮层）。
 *  原卡保持秘密与位置（揭示后恢复原状，FAQ 96-97）；引擎不持久记录内容。
 *  过期清除：与 revealedGhosts 同点（turn.ts 回合结束转换，expiresAtTurn <= 新计数清除）。 */
export interface DeckReveal {
  id: string;
  /** 被揭示牌库的玩家 */
  player: PlayerId;
  /** true = 整副牌库展示（clarity-2/3）；false = 仅牌库顶 1 张（clarity-1 top） */
  whole: boolean;
  expiresAtTurn: number;
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
  /** 收集前条件预检（修改提示词 23/16/27：无对象触发自动跳过、不弹结算按钮）：
   *  end/start 收集时 cond(s, card) 为 false → 该触发不收集（玩家无需点按钮；
   *  效果 gen 内的条件判断保留作双保险）。 */
  cond?: (s: GameState, card: Card) => boolean;
}

export interface CardEffects {
  middle?: EffectGen;
  triggers?: Partial<Record<TriggerKind, TriggerDef>>;
  /** 顶命令数值修正：stackValue 计算该线总值时应用
   *  （target: own-stack 作用于拥有者总值；opponent-line 作用于对手同线总值；
   *    line 作用于该线双方估值——线上任一玩家链路中的正面修正卡即生效，每估值用估值方链路只应用一次） */
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
  /** 草稿模式（2026-09-03 模式选择页）：
   *  - normal：常规 1-2-2-1 选 6；
   *  - ban：开局禁用模式（仍先掷硬币定先手）——后手先禁 2 → 先手选 1 禁 1 →
   *    后手选 2 禁 1 → 先手选 2 禁 2 → 后手选 1（选 6 禁 6）。 */
  draftMode: 'normal' | 'ban';
  /** 本局可选协议池（随机池模式 = 开局随机抽取 12 套；默认两代全部 30 套）。
   *  世代筛选（草稿页 chips）与禁用动作都只在本池内生效。 */
  draftPool: ProtocolDef[];
  /** 已禁用的协议 defId（禁用模式，按禁用顺序） */
  bannedProtocols: string[];
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
  /** 牌库揭示标记（2代 clarity-1/2/3；UI 弹浮层展示牌库，回合转换过期清除） */
  deckReveals: DeckReveal[];
  /** 最近一次被召回的卡 uid（批2 corruption-1 底 after-return 触发效果读取用；return op 设置，单实例覆盖制） */
  pendingReturnUid?: string;
  /** 最近一次【行动】反面打出落地的线（3代 rigidity-2 底 after-action-face-down-play 触发效果读取用；
   *  completePlay 设置，触发 gen 读取后清除；单实例覆盖制） */
  pendingActionPlayLine?: Line;
  /** metal-1「对手下回合不能编译」：被禁编译的玩家；其回合结束转换（advanceStep end→start）时清除 */
  compileBlocked: PlayerId | null;
  /** speed-2「通过编译删除此牌前」触发挂起：效果栈清空后由 runStack 消费执行编译本体。
   *  force：开发者模式强制编译（跳过重编译线值校验）。 */
  pendingCompile: { player: PlayerId; line: Line; force?: boolean } | null;
}

