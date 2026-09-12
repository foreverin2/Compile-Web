import type { Card, GameState, Line, PlayerId } from './models/types';
import { getLineValue } from './state/create';
import { getProtocolDef } from '../data/demo';
import { gameBus } from './events/bus';

/**
 * 全量追踪缓冲区（2026-09-12 用户需求：日志要「极大程度记录所有信息」）。
 *
 * 与 `s.log`（游戏内日志树，面向玩家阅读、带缩进、UI 面板实时显示）分离：
 * 本模块记录**面向排错的全量流水**——每个玩家动作、每个效果操作（op）、每次选择应答、
 * 每条触发收集/结算、每次随机结果、每个语义事件、每个步骤/回合转换、以及状态摘要。
 * 内容不进 UI 面板（避免刷屏），由「导出日志」按钮写入诊断文件全文。
 *
 * 设计约束：
 * - 纯记录、无副作用：任何钩子出错都不得影响对局（写入用 try/catch 包住）；
 * - 有上限（MAX）防长局撑爆内存；超出丢最旧；
 * - 时间戳用相对本局会话启动的毫秒（便于看时序），并给出全局自增序号（便于引用某一步）。
 */

export interface TraceEntry {
  /** 相对会话开始的毫秒 */
  ms: number;
  /** 全局自增序号（1 起） */
  seq: number;
  /** 分类：动作/操作/选择/触发/事件/随机/步骤/状态/错误/系统 */
  kind: string;
  /** 效果栈深度（用于对齐连锁关系） */
  depth: number;
  msg: string;
}

const MAX_TRACE = 30000;
const entries: TraceEntry[] = [];
const t0 = Date.now();
let seq = 0;

/** 记一条追踪（kind 为中文分类；depth 缺省 0；任何异常都被吞掉，绝不影响对局） */
export function trace(kind: string, msg: string, depth = 0): void {
  try {
    seq += 1;
    entries.push({ ms: Date.now() - t0, seq, kind, depth, msg });
    if (entries.length > MAX_TRACE) entries.splice(0, entries.length - MAX_TRACE);
  } catch {
    /* 追踪失败不能影响对局 */
  }
}

/** 以当前效果栈深记录（效果帧内调用时用，便于看出连锁层级） */
export function traceAt(s: GameState, kind: string, msg: string): void {
  trace(kind, msg, s.pendingEffects.length);
}

export function traceEntries(): readonly TraceEntry[] {
  return entries;
}

export function traceReset(): void {
  entries.length = 0;
  seq = 0;
}

/** 追踪文本（导出用；按序号升序） */
export function formatTrace(list: readonly TraceEntry[] = entries): string[] {
  return list.map(
    (e) => `[+${String(e.ms).padStart(7, ' ')}ms #${String(e.seq).padStart(5, ' ')}${e.depth > 0 ? ` d${e.depth}` : ''}] ${e.kind} ${e.msg}`,
  );
}

/** 订阅全局事件总线：把**所有**语义事件（含 payload 与当时的步骤/回合）写入追踪。
 *  main.ts 启动时调用一次（幂等）；单测可显式调用以覆盖事件追踪。 */
let eventTracingOn = false;
export function initEventTracing(): void {
  if (eventTracingOn) return;
  eventTracingOn = true;
  try {
    gameBus.subscribe((e) => {
      try {
        const payload = e.payload === undefined ? '' : JSON.stringify(e.payload);
        trace(
          '事件',
          `${e.type}${payload ? ` ${payload}` : ''} 〔P${e.state.turnPlayer + 1}/${e.state.step}〕`,
          e.state.pendingEffects.length,
        );
      } catch (err) {
        trace('错误', `事件追踪失败 ${e.type}：${err instanceof Error ? err.message : String(err)}`);
      }
    });
  } catch (err) {
    trace('错误', `事件追踪订阅失败：${err instanceof Error ? err.message : String(err)}`);
  }
}

// ============================ 状态描述工具（引擎各处 + 导出共用） ============================

/** 单卡一行摘要：`lust-2[色欲](uid=c12,P1,场/线2/pos1,正)` */
export function cardBrief(card: Card): string {
  const zone =
    card.zone === 'field' ? `场/线${card.line === null ? '?' : card.line + 1}/pos${card.pos}` : card.zone;
  let proto = '';
  try {
    proto = `[${getProtocolDef(card.defId.split('-')[0]).name}]`;
  } catch {
    /* 未知协议：省略中文名 */
  }
  return `${card.defId}${proto}(uid=${card.uid},P${card.owner + 1},${zone},${card.faceUp ? '正' : '反'}${
    card.secret ? ',秘密' : ''
  })`;
}

/** 牌组/手牌/弃牌堆一行摘要（按顺序列出 defId，便于复现顺序相关行为） */
function zoneList(cards: Card[], withUid = false): string {
  if (cards.length === 0) return '空';
  return cards
    .map((c) => `${c.defId}${withUid ? `#${c.uid}` : ''}${c.faceUp ? '' : '(反)'}`)
    .join(' ');
}

/** 单行状态摘要（动作边界记录用）：
 *  `[状态] 回合=P1 step=action 已编译=否 控制=中立 | P1 线值 0/12/2 手4 库9 弃7 | P2 线值 0/16/2 手5 库4 弃11 | 挂起0` */
export function stateDigest(s: GameState): string {
  const side = (p: PlayerId): string => {
    const pl = s.players[p];
    const vals = ([0, 1, 2] as Line[]).map((l) => getLineValue(s, p, l)).join('/');
    return `P${p + 1} 线值 ${vals} 手${pl.hand.length} 库${pl.deck.length} 弃${pl.trash.length} 协议[${pl.protocols
      .map((pr) => `${pr.defId}${pr.compiled ? '✓' : ''}`)
      .join(',')}]`;
  };
  const pend = s.pendingEffects.length;
  const top = s.pendingEffects[pend - 1];
  return (
    `[状态] 回合=P${s.turnPlayer + 1} step=${s.step} 已编译本回合=${s.compiledThisTurn ? '是' : '否'} ` +
    `控制=${s.control === -1 ? '中立' : `P${s.control + 1}`} 禁编译=${s.compileBlocked === null ? '无' : `P${s.compileBlocked + 1}`} ` +
    `回合计数=${s.turnCount} | ${side(0)} | ${side(1)} | 挂起${pend}${
      top?.prompt ? `（${top.prompt.title}）` : ''
    } 落牌${s.pendingPlay.length} 偏转${s.pendingShift.length} 待推进=${s.pendingStepAdvance ? 1 : 0}`
  );
}

/** 详细状态快照（导出用；比 snapshotState 更全：全部卡牌逐张列出） */
export function stateDetail(s: GameState): string[] {
  const out: string[] = [];
  out.push(stateDigest(s));
  out.push(`phase=${s.phase} winner=${s.winner ?? 'none'} draftRound=${s.draftRound} draftMode=${s.draftMode}`);
  out.push(
    `草稿：起始玩家=P${s.draftStarter + 1} 先出牌=P${s.firstToPlay + 1} 已选协议=${s.draftPicks
      .map((p) => p.defId)
      .join(',') || '空'} 已禁用=${s.bannedProtocols.join(',') || '空'}`,
  );
  out.push(`已结算触发 uid=${s.resolvedTriggerUids.join(',') || '空'}`);
  out.push(
    `揭示幽灵=${s.revealedGhosts.length}${s.revealedGhosts
      .map((g) => ` [${g.defId}→P${g.shownTo + 1} 到期${g.expiresAtTurn}${g.lightFx ? ' 光' : ''}${g.fx ? ` fx=${g.fx}` : ''}]`)
      .join('')}`,
  );
  out.push(`牌库揭示=${s.deckReveals.map((d) => `P${d.player + 1}${d.whole ? '全库' : '库顶'}(到期${d.expiresAtTurn})`).join(',') || '空'}`);
  out.push(`最近召回 uid=${s.pendingReturnUid ?? '无'} 行动反打线=${s.pendingActionPlayLine ?? '无'} 待编译=${s.pendingCompile ? `P${s.pendingCompile.player + 1}线${s.pendingCompile.line + 1}` : '无'}`);
  if (s.pendingPlay.length > 0) out.push(`落牌队列：${s.pendingPlay.map((p) => cardBrief(p.card)).join(' → ')}`);
  if (s.pendingShift.length > 0) out.push(`偏转队列：${s.pendingShift.map((p) => cardBrief(p.card)).join(' → ')}`);
  for (const [i, p] of s.players.entries()) {
    const pid = i as PlayerId;
    out.push(`---- P${pid + 1} ----`);
    out.push(`协议：${p.protocols.map((pr, idx) => `线${idx + 1}=${pr.defId}${pr.compiled ? '(已编译)' : ''}`).join(' ')}`);
    for (const line of [0, 1, 2] as Line[]) {
      const stack = p.stacks[line];
      out.push(
        `线${line + 1}（总值 ${getLineValue(s, pid, line)}，${stack.length} 张，自底向上）：${
          stack.length === 0 ? '空' : stack.map((c) => `${cardBrief(c)}`).join(' → ')
        }`,
      );
    }
    out.push(`手牌（${p.hand.length}）：${zoneList(p.hand, true)}`);
    out.push(`牌库（${p.deck.length}，自底向上）：${zoneList(p.deck, true)}`);
    out.push(`弃牌堆（${p.trash.length}）：${zoneList(p.trash, true)}`);
  }
  if (s.pendingEffects.length > 0) {
    out.push('---- 效果栈（自底向上）----');
    for (const pe of s.pendingEffects) {
      out.push(
        `  #${pe.id} 源=${pe.sourceDefId}(uid=${pe.sourceUid}) 属主=P${pe.player + 1}` +
          `${pe.system ? ' 系统' : ''}${pe.topCommand ? ' 顶命令' : ''}` +
          `${pe.prompt ? ` 挂起=${pe.prompt.kind}:${pe.prompt.title}(候选${pe.prompt.candidates.length}, ${pe.prompt.min}~${pe.prompt.max}${pe.prompt.optional ? ',可选' : ''})` : ' 结算中'}` +
          `${pe.lastAnswer ? ` 上次应答=${JSON.stringify(pe.lastAnswer.selected)}` : ''}`,
      );
    }
  }
  out.push(`日志条目数=${s.log.length} 追踪条目数=${entries.length}`);
  return out;
}

/** 环境信息（导出用；浏览器相关字段容错） */
export function envInfo(): string[] {
  const out: string[] = [];
  try {
    out.push(`会话起始: ${new Date(t0).toISOString()}`);
    out.push(`当前时间: ${new Date().toISOString()}`);
    if (typeof navigator !== 'undefined') out.push(`UA: ${navigator.userAgent}`);
    if (typeof window !== 'undefined') {
      out.push(`视口: ${window.innerWidth}×${window.innerHeight} DPR=${window.devicePixelRatio}`);
    }
    if (typeof document !== 'undefined') out.push(`文档尺寸: ${document.documentElement.clientWidth}×${document.documentElement.clientHeight}`);
  } catch {
    /* 环境信息失败忽略 */
  }
  return out;
}
