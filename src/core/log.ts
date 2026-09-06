import type { GameState } from './models/types';

/**
 * 结构化事件日志（2026-09 日志树改造）：
 * 日志条目 = 缩进嵌套的事件树，像堆栈跟踪一样阅读连锁——
 * 缩进层级 = 当前效果栈深（s.pendingEffects.length）：玩家动作（打出/编译/刷新/控制判定…）在
 * 栈 0 = 顶层；每入栈一个效果（中段结算/回合阶段触发/连锁 after-*）帧 +1 层；效果帧内的执行明细
 * （op 描述、玩家选择、守卫跳过）与帧同层；帧内再触发的连锁效果 = 子层。
 * 所有引擎钩子与效果文案统一经 pushLog 输出（文案中文、自带 [阶段] 前缀），渲染时 white-space:
 * pre-wrap 保缩进。
 */

const INDENT = '  ';
const MAX_DEPTH = 30;

/** 记录一条日志：自动缩进（深度 = 当前效果栈深，防爆封顶）。 */
export function pushLog(s: GameState, msg: string): void {
  const depth = Math.min(s.pendingEffects.length, MAX_DEPTH);
  s.log.push(INDENT.repeat(depth) + msg);
}

/** 效果帧标题（入栈后记录：栈深已含本帧 → 与帧内明细同层）。stage 为 [中部]/[结束]/[连锁·抽牌后] 等。 */
export function pushEffectLog(s: GameState, defId: string, stage: string, detail = ''): void {
  pushLog(s, `[${stage}] ${defId}${detail ? `：${detail}` : ''}`);
}

/** 阶段/连锁 kind → 中文标签（标题 [xxx] 用） */
export function stageLabel(kind: string): string {
  switch (kind) {
    case 'middle':
      return '中部';
    case 'start':
      return '开始';
    case 'end':
      return '结束';
    case 'before-covered':
      return '被盖前';
    case 'before-flip':
      return '翻面前';
    case 'before-compile':
      return '编译前';
    case 'after-draw':
      return '连锁·抽牌后';
    case 'after-discard':
      return '连锁·弃牌后';
    case 'after-delete':
      return '连锁·删除后';
    case 'after-clear-cache':
      return '连锁·清缓存后';
    case 'after-opponent-draw':
      return '连锁·对手抽牌后';
    case 'after-self-discard':
      return '连锁·自己弃牌后';
    case 'after-refresh':
      return '连锁·刷新后';
    case 'after-opponent-refresh':
      return '连锁·对手刷新后';
    case 'after-compile':
      return '连锁·编译后';
    case 'after-self-compile':
      return '连锁·你编译后';
    case 'after-any-compile':
      return '连锁·任意玩家编译后';
    case 'after-shuffle':
      return '连锁·切洗后';
    case 'after-play':
      return '连锁·出牌后';
    case 'after-return':
      return '连锁·回手后';
    case 'after-opponent-gain-control':
      return '连锁·对手获得控制权后';
    case 'after-any-clear-cache':
      return '连锁·任意玩家清缓存后';
    case 'after-own-delete':
      return '连锁·你删除后';
    case 'after-self-rearrange':
      return '连锁·你重排协议后';
    case 'after-any-rearrange':
      return '连锁·任意玩家重排协议后';
    case 'after-action-face-down-play':
      return '连锁·行动反面打出后';
    default:
      return kind;
  }
}

/** select-action 动作值 → 中文按钮/日志文本（修改提示词 8：face-up/face-down/flip 等汉化） */
export function actionCn(act: string): string {
  const v = act.replace(/^action:/, '');
  switch (v) {
    case 'flip':
      return '翻转';
    case 'draw':
      return '抽牌';
    case 'discard':
      return '弃牌';
    case 'delete':
      return '删除';
    case 'shift':
      return '平移';
    case 'return':
      return '回手';
    case 'face-up':
      return '正面打出';
    case 'face-down':
      return '反面打出';
    case 'skip':
      return '跳过';
    default:
      if (v.startsWith('order:')) return `布局 ${v.slice(6)}`;
      return v;
  }
}
