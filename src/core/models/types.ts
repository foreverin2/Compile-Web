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
  set: 'MN01' | 'AX01';
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

/** 触发种类：被盖住前 / 结束 / 开始 / XX后（连锁；试点未用 after，机制预留） */
export type TriggerKind = 'before-covered' | 'end' | 'start' | 'after';

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
  kind: 'select';
  title: string;
  min: number;
  max: number;
  optional: boolean;
  candidates: ChoiceCard[];
}

export interface ChoiceAnswer {
  selected: string[];
}

/** 效果操作（生成器 yield 的值之一；由运行器执行并触发连锁/语义事件） */
export type Op =
  | { op: 'discard'; uid: string }
  | { op: 'delete'; uid: string }
  | { op: 'return'; uid: string }
  | { op: 'flip'; uid: string }
  | { op: 'draw'; count: number }
  | { op: 'shift'; uid: string; targetLine: Line };

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
}

/** 待结算触发条目（getLegalActions 供 UI 出按钮） */
export interface TriggerEntry {
  cardUid: string;
  defId: string;
  kind: TriggerKind;
  optional: boolean;
}

/** 候选过滤：zone 'hand' 需 owner；'field' 列出双方所有堆叠顶卡（排除结算中源卡） */
export interface CandidateFilter {
  zone: 'hand' | 'field';
  owner?: PlayerId;
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
}

export interface CardEffects {
  middle?: EffectGen;
  triggers?: Partial<Record<TriggerKind, TriggerDef>>;
}

export interface GameState {
  phase: Phase;
  /** 草案轮次：0-5（1-2-2-1 共 6 次选择） */
  draftRound: number;
  /** 已选出的协议（按选择顺序） */
  draftPicks: ProtocolDef[];
  turnPlayer: PlayerId;
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
  /** 打出中的卡（浮空，等"被盖住前"结算后落地）；null = 无 */
  pendingPlay: Card | null;
  /** 偏转中的卡（浮空，等露出卡结算后落地）；null = 无 */
  pendingShift: Card | null;
  /** 本 end/start 步骤已结算的触发卡 uid（避免重复结算） */
  resolvedTriggerUids: string[];
  /** 打出链式结算完毕后需要推进回合步骤（runStack 栈空时消费） */
  pendingStepAdvance: boolean;
}
