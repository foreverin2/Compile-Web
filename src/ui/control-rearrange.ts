import type { GameState, Line, PlayerId } from '../core/models/types';
import { protocolImgSrc } from '../data/demo';

/**
 * 控制组件重排模态（2026-09 基础规则补全 + 2026-09-13 用户清单 #10 扩展为三态）：
 *
 * **live**（默认，编译/补满手牌）：持有控制组件的玩家【可以】调整任意一名玩家的协议摆放顺序
 *   （规则文本「控制组件相关规则」/ FAQ 79/113-114）。每次交换通过 onSwap 回调提交引擎
 *   （executeAction 'rearrange-protocols'），棋盘由 main 重渲染并播放换位动画，随后
 *   refreshControlRearrangeModal 重建以显示最新顺序。
 *
 * **draft**（效果内重排，如动量4「重排你的协议」）：先在窗口里把布局摆好（多次点击交换，**不碰引擎**），
 *   点「完成重排」时由 onCommit(order) 一次性回填一条 `action:order:XYZ`。之所以不沿用 live 的
 *   "每次交换即提交"，是因为效果栈挂起期间 `rearrange-protocols` 会被引擎硬拒
 *   （game.ts：pendingEffects 非空 → resolve pending effect choices first），只能用 effect-choice 应答。
 *
 * 模态挂 body 级（fixed 遮罩），与放大遮罩/胜利遮罩同模式；重渲染棋盘不影响其存活。
 * `sessionKey` 提供幂等：draft 模式下每帧 render 都会 sync 调用，同键只刷新内容、不重置会话。
 */

export interface ControlRearrangeModalOptions {
  getState: () => GameState;
  /** 标题（如「P1 持有控制组件：编译线 2 前可重排一名玩家的协议」） */
  title: string;
  /** 底部主按钮文案（如「完成，编译线 2」/「完成重排」） */
  submitLabel: string;
  /** live：交换请求 → main 执行引擎 action 并重渲染棋盘（draft 模式不需要） */
  onSwap?: (target: PlayerId, a: Line, b: Line) => void;
  /** 完成：live 忽略参数；draft 收到最终布局 order（order[i] = 摆在第 i 位的**原协议下标**） */
  onCommit: (order: Line[]) => void;
  /** 幂等键：同键重复 open 只刷新内容，不重置会话状态（draft 每帧 sync 必须） */
  sessionKey?: string;
  /** 可操作的玩家侧（缺省 [0,1] = 编译期可重排任一方；效果内重排只给自己一侧） */
  sides?: PlayerId[];
  /** 'live'（每次交换即提交引擎）| 'draft'（本地摆好、完成时一次提交） */
  mode?: 'live' | 'draft';
  /** 仅 draft：完成按钮可用条件（缺省 = orderChanged，即必须真的换过顺序） */
  canCommit?: (order: Line[]) => boolean;
  /** 仅 draft：替换默认提示文案 */
  hint?: string;
  /**
   * 2026-09-22（T25）：draft 模式的「跳过」按钮文案。**与 `onSkip` 成对出现才渲染** ——
   * 只给可选（`prompt.optional`）的重排请求用（`nova-2`「你可以重排你的协议」那半步原先是
   * 5 个布局按钮 + 一个「跳过」，窗口化之后这个出口不能丢；`momentum-4` 是必选，不传）。
   */
  skipLabel?: string;
  /** 只给 `skipLabel` 一起用时有效：点「跳过」⇒ 关闭窗口并走这条回调（应答为空 `choice: []`） */
  onSkip?: () => void;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

/** draft 布局交换（纯函数，供单测）：交换第 a / b 位上摆的协议（order[i] = 原下标） */
export function swapOrder(order: Line[], a: Line, b: Line): Line[] {
  const next = order.slice();
  const t = next[a];
  next[a] = next[b];
  next[b] = t;
  return next;
}

/** draft 布局是否偏离初始（= 引擎要求的「重排必须改变顺序」，resolve.ts 会拒绝恒等排列） */
export function orderChanged(order: Line[]): boolean {
  return order.some((v, i) => v !== i);
}

/** order → 引擎选择编码 `action:order:XYZ`（与 resolve.ts reorderProtocols 的语义一致） */
export function orderToAction(order: Line[]): string {
  return `action:order:${order.join('')}`;
}

/**
 * ★ **G5 T23：这条"效果内重排"请求该不该在**本屏**开窗**（纯函数，腿在 node 里）。
 *
 * 联机下两端持有**同一份** `GameState` ⇒ `pendingEffects` 栈顶那条带 `rearrangeSide` 的请求
 * （`momentum-4`：`src/core/effects/cards/momentum.ts:58-64`；`nova-2`：T25 起同款）在**两屏**都读得到，
 * 而这个窗口是 **body 级遮罩**（`openControlRearrangeModal` 直接 append 到 `document.body`）——
 * 没有这道判据时，**对手那一屏**也会弹出"重排你的协议"窗口：他能拖着别人的协议摆，
 * 点「完成重排」再走 `main.ts` 的 `commitEffectRearrange` → `cb.onAction({kind:'effect-choice'})`
 * ⇒ **用自己这个座位**提交一条本该由操作方提交的应答（引擎会拒，但界面不该请我做这件事）。
 *
 * ## 判据只看"这一屏是不是操作方"，不看 `rearrangeSide`
 *
 * `sides: [side]` 那个字段说的是"**谁的协议**要被重排"，与"**谁来点**完成重排"不是同一个问题。
 * 今天 `momentum-4` 两者恰好同值（都 = `ctx.player`），把巧合写成规则的话，将来第一条
 * "你重排对手的协议"的效果会静默地把窗口开到对手屏上。
 *
 * ## 热座/单机为什么恒开
 *
 * 一屏两人（`net === false`）：两个座位都是本地的，窗口就该开在这一屏上。
 */
export function hostsEffectRearrange(o: { chooser: PlayerId; localSeat: PlayerId; net: boolean }): boolean {
  return !o.net || o.chooser === o.localSeat;
}

let overlay: HTMLElement | null = null;
let opts: ControlRearrangeModalOptions | null = null;
let activeSide: PlayerId | null = null;
let firstPick: Line | null = null;
/** 修改提示词 6：重排锁侧——完成第 1 次有效交换后，只能继续操作该玩家的协议（不可换侧） */
let lockedSide: PlayerId | null = null;
/** draft 模式布局：draftOrder[i] = 摆在第 i 位的**原协议下标**（初值 [0,1,2]） */
let draftOrder: Line[] = [0, 1, 2];

export function openControlRearrangeModal(o: ControlRearrangeModalOptions): void {
  // 幂等：draft 模式每帧都会 sync 调用 → 同键只刷新内容（保留玩家已摆好的布局与选中态）
  if (overlay && opts && o.sessionKey !== undefined && o.sessionKey === opts.sessionKey) {
    opts = o;
    renderModal();
    return;
  }
  closeControlRearrangeModal();
  opts = o;
  activeSide = null;
  firstPick = null;
  lockedSide = null;
  draftOrder = [0, 1, 2];
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
  lockedSide = null;
  draftOrder = [0, 1, 2];
}

export function isControlRearrangeOpen(): boolean {
  return overlay !== null;
}/** 一次交换已提交（main 已执行引擎动作并重渲染棋盘）→ 重建内容显示最新协议顺序 */
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
  const draft = o.mode === 'draft';
  const sides = o.sides ?? ([0, 1] as PlayerId[]);
  overlay.textContent = '';
  const panel = el('div', 'rearrange-panel');
  panel.appendChild(el('div', 'rearrange-title', o.title));
  panel.appendChild(
    el(
      'div',
      'rearrange-hint',
      draft
        ? (o.hint ?? '点击两张协议交换位置（可多次）；摆好后点「完成重排」一次性生效（未改动则按钮不可用）。')
        : lockedSide !== null
          ? `已锁定重排【玩家 ${lockedSide + 1}】的协议：先点一张、再点另一张即交换，可多次交换；另一名玩家的协议不再可操作。`
          : '点击要重排的玩家协议（先点一张、再点另一张即交换）；完成第 1 次交换后锁定该玩家，不可换侧。'
    )
  );

  const sidesBox = el('div', 'rearrange-sides');
  for (const pid of sides) {
    const isLocked = !draft && lockedSide !== null && lockedSide !== pid; // 修改提示词 6：锁侧后另一侧不可操作
    const side = el(
      'div',
      'rearrange-side' +
        (activeSide === pid ? ' active' : '') +
        (isLocked ? ' locked' : '') +
        (sides.length === 1 ? ' solo' : '')
    );
    side.dataset.side = String(pid);
    const who = pid === 0 ? '玩家 1' : '玩家 2';
    side.appendChild(el('div', 'rearrange-side-label', activeSide === pid ? `▼ ${who}` : who));
    const protos = el('div', 'rearrange-protos');
    for (const line of [0, 1, 2] as Line[]) {
      // draft：第 line 位上摆的是原下标 draftOrder[line] 的协议
      const src = draft ? draftOrder[line] : line;
      const pr = s.players[pid].protocols[src];
      const btn = el(
        'button',
        'rearrange-proto' +
          (activeSide === pid && firstPick === line ? ' picked' : '') +
          (isLocked ? ' locked' : '')
      );
      btn.type = 'button';
      btn.disabled = isLocked;
      const img = document.createElement('img');
      img.src = protocolImgSrc(pr.defId, pr.compiled);
      img.alt = pr.defId;
      btn.appendChild(img);
      btn.appendChild(el('span', 'proto-line-tag', `线 ${line + 1}`));
      if (pr.compiled) btn.appendChild(el('span', 'proto-compiled-tag', '已编译'));
      // draft：标出这张协议原本属于哪条线（换位后仍能对上号）
      if (draft && src !== line) btn.appendChild(el('span', 'proto-moved-tag', `原线 ${src + 1}`));
      btn.addEventListener('click', () => onProtoClick(pid, line));
      protos.appendChild(btn);
    }
    side.appendChild(protos);
    sidesBox.appendChild(side);
  }
  panel.appendChild(sidesBox);

  const actions = el('div', 'rearrange-actions');
  const done = el('button', 'btn rearrange-done', o.submitLabel);
  if (draft) {
    const can = (o.canCommit ?? orderChanged)(draftOrder.slice());
    (done as HTMLButtonElement).disabled = !can;
    if (!can) done.classList.add('disabled');
  }
  done.addEventListener('click', () => {
    if (draft && !((opts?.canCommit ?? orderChanged)(draftOrder.slice()))) return; // 未改动不可提交（引擎会拒绝恒等）
    o.onCommit(draftOrder.slice());
  });
  actions.appendChild(done);
  /**
   * 2026-09-22（T25）：**可选重排的出口**。`nova-2` 的重排是 `optional: true`（"你可以重排"），
   * 原按钮流里有一个「跳过」；改走窗口之后这个出口必须还在，否则可选的重排变成"必须摆一次"。
   * 只在 `mode: 'draft'` 且调用方**同时**给了 `skipLabel` + `onSkip` 时渲染 —— `momentum-4`
   * 是必选（`optional: false`），`main.ts` 不给这两个字段，所以那里不多出按钮。
   * 点击即 `onSkip()` 并关窗：与 `render.ts` 的 `.choice-skip` 同义（应答 `choice: []`）。
   */
  if (draft && o.skipLabel !== undefined && o.onSkip !== undefined) {
    const skip = el('button', 'btn rearrange-skip', o.skipLabel);
    skip.addEventListener('click', () => {
      const fn = opts?.onSkip;
      closeControlRearrangeModal();
      fn?.();
    });
    actions.appendChild(skip);
  }
  panel.appendChild(actions);

  overlay.appendChild(panel);
}

function onProtoClick(side: PlayerId, line: Line): void {
  if (!opts) return;
  // 修改提示词 6：锁侧后另一名玩家的协议不可再操作（点击忽略）；draft 模式不锁侧
  if (lockedSide !== null && lockedSide !== side) return;
  if (activeSide !== side) {
    // 换侧：激活新侧并选中该卡作为第一张（未锁定前允许选择操作哪名玩家）
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
  // 同侧第二张（不同卡）
  const a = firstPick;
  firstPick = null;
  if (opts.mode === 'draft') {
    // draft：只改本地布局（不碰引擎），完成时统一次提交
    draftOrder = swapOrder(draftOrder, a, line);
    renderModal();
    return;
  }
  lockedSide = side; // 修改提示词 6：完成第 1 次有效交换 → 锁定该玩家
  opts.onSwap?.(side, a, line);
}
