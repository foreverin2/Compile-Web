export type PlayerId = 0 | 1;
export type Line = 0 | 1 | 2;
export type Zone = 'hand' | 'deck' | 'field' | 'trash';
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
}
