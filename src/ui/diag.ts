import type { GameState } from '../core/models/types';
import { getLineValue } from '../core/state/create';
import { envInfo, formatTrace, stateDetail, traceEntries } from '../core/trace';

/**
 * 运行时诊断日志：全量记录 console 输出、捕获未捕获异常/未处理 Promise 拒绝，
 * 可导出「错误 + 控制台记录 + 游戏事件日志 + 状态快照」文本文件供开发者分析。
 * 纯函数部分（snapshotState / formatDiagnosticLog）可单测；浏览器 API 部分
 * （initDiag / downloadLog / 自动提示）在 main.ts 装配。
 */

export interface ConsoleEntry {
  time: string;
  level: 'log' | 'debug' | 'info' | 'warn' | 'error';
  text: string;
}

export interface ErrorEntry {
  time: string;
  type: 'error' | 'unhandledrejection';
  message: string;
  stack: string;
}

/** 控制台记录上限（"全量记录"；防失控会话撑爆内存） */
const MAX_CONSOLE = 10000;
const MAX_ERRORS = 50;

const consoleEntries: ConsoleEntry[] = [];
const errors: ErrorEntry[] = [];

let stateGetter: () => GameState = () => {
  throw new Error('diag state getter not set');
};
let promptEl: HTMLElement | null = null;

function now(): string {
  return new Date().toISOString();
}

function safeText(args: unknown[]): string {
  return args
    .map((a) => {
      if (typeof a === 'string') return a;
      if (a instanceof Error) return `${a.name}: ${a.message}${a.stack ? `\n${a.stack}` : ''}`;
      try {
        return JSON.stringify(a);
      } catch {
        return String(a);
      }
    })
    .join(' ');
}

function recordConsole(level: ConsoleEntry['level'], args: unknown[]): void {
  consoleEntries.push({ time: now(), level, text: safeText(args) });
  if (consoleEntries.length > MAX_CONSOLE) {
    consoleEntries.splice(0, consoleEntries.length - MAX_CONSOLE);
  }
}

function recordError(type: ErrorEntry['type'], message: string, stack: string): void {
  errors.push({ time: now(), type, message, stack });
  if (errors.length > MAX_ERRORS) errors.shift();
  showErrorPrompt();
}

/** 出错自动提示（body 级浮层，不受重渲染影响；重复出错时更新内容） */
function showErrorPrompt(): void {
  const last = errors[errors.length - 1];
  if (!last) return;
  if (!promptEl) {
    promptEl = document.createElement('div');
    promptEl.className = 'diag-prompt';
    document.body.appendChild(promptEl);
  }
  promptEl.textContent = '';
  const title = document.createElement('div');
  title.className = 'diag-prompt-title';
  title.textContent = '⚠ 发生运行时错误，是否导出诊断日志？';
  const msg = document.createElement('div');
  msg.className = 'diag-prompt-msg';
  msg.textContent = last.message;
  const bar = document.createElement('div');
  bar.className = 'diag-prompt-bar';
  const exportBtn = document.createElement('button');
  exportBtn.className = 'btn';
  exportBtn.textContent = '导出日志';
  exportBtn.addEventListener('click', () => {
    downloadLog();
    promptEl?.remove();
    promptEl = null;
  });
  const ignoreBtn = document.createElement('button');
  ignoreBtn.className = 'btn';
  ignoreBtn.textContent = '忽略';
  ignoreBtn.addEventListener('click', () => {
    promptEl?.remove();
    promptEl = null;
  });
  bar.appendChild(exportBtn);
  bar.appendChild(ignoreBtn);
  promptEl.appendChild(title);
  promptEl.appendChild(msg);
  promptEl.appendChild(bar);
}

/** 状态快照：可读摘要（纯函数，可单测） */
export function snapshotState(s: GameState): string {
  const lines: string[] = [];
  lines.push(`phase=${s.phase} step=${s.step} turnPlayer=${s.turnPlayer} compiledThisTurn=${s.compiledThisTurn}`);
  lines.push(`control=${s.control} winner=${s.winner ?? 'none'} draftRound=${s.draftRound}`);
  const top = s.pendingEffects[s.pendingEffects.length - 1];
  lines.push(
    `挂起选择=${s.pendingEffects.length}${
      top?.prompt ? `（当前：${top.prompt.title}，候选 ${top.prompt.candidates.length} 张）` : ''
    }`,
  );
  lines.push(
    `落牌中=${s.pendingPlay.length > 0 ? s.pendingPlay[0].card.defId : '无'} 偏转中=${
      s.pendingShift.length > 0 ? s.pendingShift[0].card.defId : '无'
    } 待推进=${s.pendingStepAdvance}`,
  );
  for (const [i, p] of s.players.entries()) {
    const player = i as 0 | 1;
    lines.push(
      `P${player + 1}: 手牌=${p.hand.length} 牌库=${p.deck.length} 弃牌堆=${p.trash.length} 协议=[${p.protocols
        .map((pr) => `${pr.defId}${pr.compiled ? '✓' : ''}`)
        .join(',')}]`,
    );
    for (const line of [0, 1, 2] as const) {
      const stack = p.stacks[line];
      const topCard = stack[stack.length - 1];
      lines.push(
        `  P${player + 1} 线${line + 1}: ${stack.length} 张${
          topCard ? `，顶=${topCard.defId}(${topCard.faceUp ? '正' : '反'})` : ''
        }，总值=${getLineValue(s, player, line)}`,
      );
    }
  }
  return lines.join('\n');
}

/** 完整诊断日志文本（纯函数，可单测；consoleLog/errorLog 由模块缓冲传入）
 *  2026-09-12 用户需求「极大程度记录所有信息」——导出内容扩充为：
 *  环境信息 / 运行时错误 / 控制台全量 / 游戏日志树【全部条目】/ 全量追踪流水 / 详细状态快照
 *  （逐张卡牌的位置与朝向、效果栈全部帧、揭示幽灵、牌库揭示、草稿信息等）。 */
/** 3代特效层统计（批次 E 收尾）：按类别统计 body 级活动层 + 元素数。
 *  纯观测、不做限流（Q6：全部完整特效不降级）；用于性能问题定位（哪类层没被清理）。 */
export function gen3LayerReport(): string[] {
  if (typeof document === 'undefined') return ['（非浏览器环境）'];
  // 2026-09-13 修正：旧版按前缀统计会把**子元素**也算成"层"（例如 .g3sync-envy0-thread 也以 g3sync- 开头），
  // 数字虚高、无法判断到底有没有残留层。现在只统计**层容器**（class 含 g3fx-layer），并逐个列出类名与子节点数，
  // 便于一眼看出"哪个层不该在"（排查用户反馈的"层粘在屏幕上/凭空出现"类问题）。
  const containers = [...document.querySelectorAll<HTMLElement>('.g3fx-layer')];
  const buckets = new Map<string, number>();
  for (const c of containers) {
    const cls = [...c.classList].find((x) => x !== 'g3fx-layer') ?? '(未命名层)';
    const family = cls.startsWith('g3sync-') ? '常驻 sync'
      : cls.startsWith('g3ctrl-') || cls.startsWith('g3clear-') ? '控制权/清缓存瞬态'
      : cls.startsWith('g3swap-') ? '交换瞬态'
      : cls.startsWith('g3-') ? '卡牌附加瞬态'
      : '其它';
    buckets.set(family, (buckets.get(family) ?? 0) + 1);
  }
  const out: string[] = [];
  out.push(`层容器总数: ${containers.length}（层级 class 含 g3fx-layer）`);
  for (const [k, v] of [...buckets.entries()].sort()) out.push(`  ${k}: ${v} 个`);
  out.push('逐个层（类名 / 子节点数 / 首个节点尺寸）:');
  for (const c of containers.slice(0, 40)) {
    const cls = [...c.classList].find((x) => x !== 'g3fx-layer') ?? '(未命名)';
    const r = c.getBoundingClientRect();
    out.push(`  ${cls}  子${c.querySelectorAll('*').length}  ${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)}`);
  }
  if (containers.length > 40) out.push(`  …（其余 ${containers.length - 40} 个略）`);
  const all = document.querySelectorAll<HTMLElement>('[class*="gen3-"], [class^="g3"]');
  out.push(`合计: ${all.length} 个 3代特效节点（含子元素）`);
  return out;
}
export function formatDiagnosticLog(s: GameState, consoleLog: ConsoleEntry[], errorLog: ErrorEntry[]): string {
  const out: string[] = [];
  out.push('===== Compile 诊断日志 =====');
  out.push(`时间: ${now()}`);
  out.push(`URL: ${typeof location !== 'undefined' ? location.href : 'n/a'}`);
  out.push('');
  out.push('---- 环境信息 ----');
  for (const line of envInfo()) out.push(line);
  out.push('');
  // 3代特效（批次 E 收尾）：活动特效层计数——用于"同屏特效过多导致卡顿"时的**数据化**排查
  // （Q6 要求不降级、不做限流，因此这里只观测不干预；层数异常时据此定位是哪一类特效没被清理）
  out.push('---- 3代特效层（活动） ----');
  for (const line of gen3LayerReport()) out.push(line);
  out.push('');
  out.push('---- 运行时错误 ----');
  if (errorLog.length === 0) out.push('（无）');
  for (const e of errorLog) {
    out.push(`[${e.type}] ${e.time} ${e.message}`);
    if (e.stack) out.push(e.stack);
  }
  out.push('');
  out.push('---- 控制台记录（全量） ----');
  if (consoleLog.length === 0) out.push('（无）');
  for (const c of consoleLog) out.push(`[${c.level}] ${c.time} ${c.text}`);
  out.push('');
  out.push(`---- 游戏日志树（全部 ${s.log.length} 条；缩进=效果栈深度） ----`);
  if (s.log.length === 0) out.push('（无）');
  for (const entry of s.log) out.push(entry);
  out.push('');
  const traceList = traceEntries();
  out.push(`---- 全量追踪流水（${traceList.length} 条；动作/操作/选择/触发/事件/随机/步骤/规则/错误） ----`);
  out.push('格式：[+相对ms #序号 d效果栈深] 分类 内容');
  if (traceList.length === 0) out.push('（无）');
  for (const line of formatTrace(traceList)) out.push(line);
  out.push('');
  out.push('---- 详细状态快照 ----');
  for (const line of stateDetail(s)) out.push(line);
  return out.join('\n');
}

/** 导出并下载诊断日志文件 */
export function downloadLog(s: GameState = stateGetter()): void {
  const text = formatDiagnosticLog(s, consoleEntries, errors);
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `compile-log-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * 初始化：全量钩住 console 五个级别 + 捕获未捕获异常/未处理 Promise 拒绝。
 * getState 供自动提示生成快照。返回卸载函数。
 */
export function initDiag(getState: () => GameState): () => void {
  stateGetter = getState;
  const orig = {
    log: console.log,
    debug: console.debug,
    info: console.info,
    warn: console.warn,
    error: console.error,
  };
  const levels: ConsoleEntry['level'][] = ['log', 'debug', 'info', 'warn', 'error'];
  for (const level of levels) {
    console[level] = (...args: unknown[]) => {
      recordConsole(level, args);
      orig[level](...args);
    };
  }
  const onError = (e: ErrorEvent) => {
    recordError('error', e.message, e.error instanceof Error ? e.error.stack ?? '' : `${e.filename}:${e.lineno}:${e.colno}`);
  };
  const onRejection = (e: PromiseRejectionEvent) => {
    recordError('unhandledrejection', String(e.reason), e.reason instanceof Error ? e.reason.stack ?? '' : '');
  };
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);
  return () => {
    for (const level of levels) console[level] = orig[level];
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onRejection);
  };
}
