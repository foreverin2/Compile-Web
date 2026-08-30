import type { Card, CardDef, GameState } from '../core/models/types';
import { ALL_CARD_DEFS, ALL_PROTOCOLS } from '../data/cards';

/**
 * 隐藏开发者模式（测试辅助）：
 * - Ctrl+Shift+P 弹出密码框（并阻止浏览器打印对话框），密码 `上上下下左右左右BABA`
 *   正确后进入指令页；
 * - 指令页支持 `get 牌名` 把指定卡牌加入当前玩家（state.turnPlayer）手牌；
 * - 所有动作同时写入 console（被 diag 全量记录）与 state.log（游戏事件日志），
 *   两者都包含在 diag 导出中。
 *
 * 纯函数部分（resolveCardName / 查询表构建）无 DOM 访问，可在 vitest(node) 下导入；
 * 所有 DOM 操作都位于 initDevMode 内部闭包 / 其调用的函数中。
 */

export interface DevModeHost {
  getState: () => GameState;
  render: () => void;
}

/** 隐藏密码 */
const PASSWORD = '上上下下左右左右BABA';

/** 指令页提示行 */
const HINT = '指令：get 牌名 — 例如 get light-2 或 get 光2（加入当前玩家手牌）';

/** 卡牌实例 uid 计数器（dev- 前缀保证不与正式 uid 冲突） */
let uidCounter = 0;

/** 是否有开发者浮层打开（打开任一浮层时置 true，关闭时置 false） */
let overlayOpen = false;

/**
 * 归一化查询键：小写后移除所有非字母（ASCII）/非数字/非汉字字符。
 * 例：'light-2' → 'light2'；'LIGHT-2' → 'light2'；'光-2' → '光2'；' 光 2 ' → '光2'。
 */
function normalizeKey(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]/g, '');
}

/**
 * 卡牌名 → CardDef 查询表（模块加载时构建一次）：
 * - 每个 defId 的归一化键（如 'light2'）；
 * - 每个协议的「中文名 + 分值」键（如 '光2'，对应协议下分值 2 的牌）。
 * 两类键无交集（defId 全 ASCII，协议名全汉字），无歧义。
 */
const CARD_LOOKUP: ReadonlyMap<string, CardDef> = (() => {
  const map = new Map<string, CardDef>();
  for (const def of ALL_CARD_DEFS) {
    map.set(normalizeKey(def.defId), def);
  }
  for (const proto of ALL_PROTOCOLS) {
    for (const card of ALL_CARD_DEFS) {
      if (card.protocol === proto.defId) {
        map.set(normalizeKey(`${proto.name}${card.value}`), card);
      }
    }
  }
  return map;
})();

/**
 * 解析卡牌名（纯函数，无 DOM）：接受 `light-2` / `light2` / `光2` / `光-2` / `光 2`
 * 等形式（trim + 大小写不敏感），匹配 ALL_CARD_DEFS + ALL_PROTOCOLS；
 * 找不到返回 null。
 */
export function resolveCardName(name: string): CardDef | null {
  const key = normalizeKey(name.trim());
  if (key === '') return null;
  return CARD_LOOKUP.get(key) ?? null;
}

/** 日志：同时写入 console（diag 全量捕获）与 state.log（游戏事件日志，diag 导出含尾部） */
function log(host: DevModeHost, msg: string): void {
  const full = `[开发者模式] ${msg}`;
  console.log(full);
  host.getState().log.push(full);
}

/**
 * 执行一条指令。目前唯一支持：`get 牌名`（大小写不敏感），
 * 把解析出的牌加入当前玩家（state.turnPlayer）手牌并触发重渲染。
 * 未知指令 / 未找到卡牌：记录日志，不改变状态。
 */
function runCommand(host: DevModeHost, line: string): void {
  const trimmed = line.trim();
  if (trimmed === '') return;
  log(host, `收到指令: ${trimmed}`);
  const m = /^get\s+(.+)$/i.exec(trimmed);
  if (!m) {
    log(host, `未知指令: ${trimmed}`);
    return;
  }
  const name = m[1].trim();
  const def = resolveCardName(name);
  if (!def) {
    log(host, `未找到卡牌: ${name}`);
    return;
  }
  const state = host.getState();
  const player = state.turnPlayer;
  const card: Card = {
    uid: `dev-${uidCounter++}-${Date.now().toString(36)}`,
    defId: def.defId,
    owner: player,
    faceUp: true,
    zone: 'hand' as const,
    line: null,
    pos: null,
  };
  state.players[player].hand.push(card);
  log(host, `已添加 ${def.defId} 到 P${player + 1} 手牌`);
  host.render();
}

/** 密码输入框：全屏暗色遮罩 + 居中面板；点击遮罩 / Esc / 密码错误 → 立即关闭 */
function openPasswordPrompt(host: DevModeHost): void {
  log(host, '密码输入框已打开');
  overlayOpen = true;
  const backdrop = document.createElement('div');
  backdrop.className = 'dev-prompt';
  const panel = document.createElement('div');
  panel.className = 'dev-prompt-panel';
  const title = document.createElement('div');
  title.className = 'dev-prompt-title';
  title.textContent = '开发者模式';
  const input = document.createElement('input');
  input.className = 'dev-prompt-input';
  input.type = 'password';
  input.placeholder = '输入密码…';
  panel.appendChild(title);
  panel.appendChild(input);
  backdrop.appendChild(panel);
  document.body.appendChild(backdrop);
  input.focus();

  const close = (msg: string): void => {
    backdrop.remove();
    overlayOpen = false;
    log(host, msg);
  };

  // 仅点击遮罩（target === backdrop）关闭；面板内部点击不关闭
  backdrop.addEventListener('mousedown', (e) => {
    if (e.target === backdrop) close('密码输入框已关闭（点击空白）');
  });
  input.addEventListener('keydown', (e) => {
    if (e.isComposing) return; // IME 组合中的回车（确认候选）不算提交
    if (e.key === 'Escape') {
      close('密码输入框已关闭（Esc）');
      return;
    }
    if (e.key !== 'Enter') return;
    if (input.value.trim() === PASSWORD) {
      log(host, '密码正确，打开指令页');
      close('密码输入框已关闭（密码正确）');
      openCommandPage(host);
    } else {
      log(host, '密码错误');
      close('密码输入框已关闭（密码错误）');
    }
  });
}

/** 指令页：遮罩 + 居中面板（标题、提示、输入框、关闭按钮）；回车执行指令并保持打开 */
function openCommandPage(host: DevModeHost): void {
  log(host, '指令页已打开');
  overlayOpen = true;
  const backdrop = document.createElement('div');
  backdrop.className = 'dev-console';
  const panel = document.createElement('div');
  panel.className = 'dev-console-panel';
  const title = document.createElement('div');
  title.className = 'dev-console-title';
  title.textContent = '开发者指令';
  const hint = document.createElement('div');
  hint.className = 'dev-console-hint';
  hint.textContent = HINT;
  const input = document.createElement('input');
  input.className = 'dev-console-input';
  input.placeholder = 'get light-2';
  const closeBtn = document.createElement('button');
  closeBtn.className = 'btn dev-console-close';
  closeBtn.textContent = '关闭';
  panel.appendChild(title);
  panel.appendChild(hint);
  panel.appendChild(input);
  panel.appendChild(closeBtn);
  backdrop.appendChild(panel);
  document.body.appendChild(backdrop);
  input.focus();

  const close = (msg: string): void => {
    backdrop.remove();
    overlayOpen = false;
    log(host, msg);
  };

  backdrop.addEventListener('mousedown', (e) => {
    if (e.target === backdrop) close('指令页已关闭（点击空白）');
  });
  closeBtn.addEventListener('click', () => close('指令页已关闭（点击关闭按钮）'));
  input.addEventListener('keydown', (e) => {
    if (e.isComposing) return; // IME 组合中的回车（确认候选）不算提交
    if (e.key === 'Escape') {
      close('指令页已关闭（Esc）');
      return;
    }
    if (e.key !== 'Enter') return;
    runCommand(host, input.value);
    // 成功或失败都清空输入并保持指令页打开，便于连续批量 get
    input.value = '';
    input.focus();
  });
}

/**
 * 初始化开发者模式：注册全局 keydown（Ctrl+Shift+P → 阻止打印对话框 → 打开密码框）。
 * 已有开发者浮层打开时忽略快捷键。返回卸载函数。
 */
export function initDevMode(host: DevModeHost): () => void {
  const onKeyDown = (e: KeyboardEvent): void => {
    // e.code 与键盘布局无关（非 QWERTY 布局下 Ctrl+Shift+P 的 e.key 可能不同）
    if (e.ctrlKey && e.shiftKey && e.code === 'KeyP') {
      e.preventDefault(); // 阻止浏览器打印对话框
      if (overlayOpen) return;
      openPasswordPrompt(host);
    }
  };
  window.addEventListener('keydown', onKeyDown);
  return () => window.removeEventListener('keydown', onKeyDown);
}
