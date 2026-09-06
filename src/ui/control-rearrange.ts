import type { GameState, Line, PlayerId } from '../core/models/types';
import { protocolImgSrc } from '../data/demo';

/**
 * 控制组件重排模态（2026-09 基础规则补全）：
 * 编译/补满手牌前，持有控制组件的玩家【可以】调整任意一名玩家的协议摆放顺序
 * （规则文本「控制组件相关规则」/ FAQ 79/113-114）。归还中立由调用方（main.ts 打开
 * 模态时）先行执行；本模态只负责「选侧 → 两两交换（可多次）→ 完成继续」的交互，
 * 每次交换通过 onSwap 回调提交引擎（executeAction 'rearrange-protocols'），棋盘
 * 由 main 重渲染并播放协议换位基础动画（protocols:rearranged），本模态随后
 * refreshControlRearrangeModal 重建以显示最新顺序。
 * 模态挂 body 级（fixed 遮罩），与放大遮罩/胜利遮罩同模式；重渲染棋盘不影响其存活。
 */

export interface ControlRearrangeModalOptions {
  getState: () => GameState;
  /** 标题（如「P1 持有控制组件：编译线 2 前可重排一名玩家的协议」） */
  title: string;
  /** 底部主按钮文案（如「完成，编译线 2」/「完成，补满手牌」） */
  submitLabel: string;
  /** 交换请求 → main 执行引擎 action 并重渲染棋盘 */
  onSwap: (target: PlayerId, a: Line, b: Line) => void;
  /** 完成（跳过重排或已重排完）→ main 提交原 compile/refresh 动作 */
  onCommit: () => void;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

let overlay: HTMLElement | null = null;
let opts: ControlRearrangeModalOptions | null = null;
let activeSide: PlayerId | null = null;
let firstPick: Line | null = null;

export function openControlRearrangeModal(o: ControlRearrangeModalOptions): void {
  closeControlRearrangeModal();
  opts = o;
  activeSide = null;
  firstPick = null;
  overlay = el('div', 'rearrange-overlay');
  document.body.appendChild(overlay);
  renderModal();
}

export function closeControlRearrangeModal(): void {
  if (overlay) {
    overlay.remove();
    overlay = null;
  }
  opts = null;
  activeSide = null;
  firstPick = null;
}

export function isControlRearrangeOpen(): boolean {
  return overlay !== null;
}

/** 一次交换已提交（main 已执行引擎动作并重渲染棋盘）→ 重建内容显示最新协议顺序 */
export function refreshControlRearrangeModal(): void {
  if (!overlay || !opts) return;
  firstPick = null;
  renderModal();
}

function renderModal(): void {
  if (!overlay || !opts) return;
  const o = opts;
  const s = o.getState();
  // 防御：对局已结束/重置 → 模态自动关闭（devmode 强制编译致胜等旁路）
  if (s.phase !== 'turn' || s.winner !== null) {
    closeControlRearrangeModal();
    return;
  }
  overlay.textContent = '';
  const panel = el('div', 'rearrange-panel');
  panel.appendChild(el('div', 'rearrange-title', o.title));
  panel.appendChild(
    el(
      'div',
      'rearrange-hint',
      '点击要重排的玩家协议（先点一张、再点另一张即交换，可多次交换）；不想调整则直接点下方按钮继续。'
    )
  );

  const sides = el('div', 'rearrange-sides');
  for (const pid of [0, 1] as PlayerId[]) {
    const side = el('div', 'rearrange-side' + (activeSide === pid ? ' active' : ''));
    side.dataset.side = String(pid);
    const who = pid === 0 ? '玩家 1' : '玩家 2';
    side.appendChild(el('div', 'rearrange-side-label', activeSide === pid ? `▼ ${who}` : who));
    const protos = el('div', 'rearrange-protos');
    for (const line of [0, 1, 2] as Line[]) {
      const pr = s.players[pid].protocols[line];
      const btn = el('button', 'rearrange-proto' + (activeSide === pid && firstPick === line ? ' picked' : ''));
      btn.type = 'button';
      const img = document.createElement('img');
      img.src = protocolImgSrc(pr.defId, pr.compiled);
      img.alt = pr.defId;
      btn.appendChild(img);
      btn.appendChild(el('span', 'proto-line-tag', `线 ${line + 1}`));
      if (pr.compiled) btn.appendChild(el('span', 'proto-compiled-tag', '已编译'));
      btn.addEventListener('click', () => onProtoClick(pid, line));
      protos.appendChild(btn);
    }
    side.appendChild(protos);
    sides.appendChild(side);
  }
  panel.appendChild(sides);

  const actions = el('div', 'rearrange-actions');
  const done = el('button', 'btn rearrange-done', o.submitLabel);
  done.addEventListener('click', () => o.onCommit());
  actions.appendChild(done);
  panel.appendChild(actions);

  overlay.appendChild(panel);
}

function onProtoClick(side: PlayerId, line: Line): void {
  if (!opts) return;
  if (activeSide !== side) {
    // 换侧：激活新侧并选中该卡作为第一张
    activeSide = side;
    firstPick = line;
    renderModal();
    return;
  }
  if (firstPick === null || firstPick === line) {
    firstPick = firstPick === line ? null : line; // 同卡再点取消
    renderModal();
    return;
  }
  // 同侧第二张（不同卡）→ 提交交换
  const a = firstPick;
  firstPick = null;
  opts.onSwap(side, a, line);
}
