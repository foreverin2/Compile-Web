import type { Card, CardDef, GameState, Line, ProtocolDef } from '../core/models/types';
// 2026-09-03：2代（MN02）并入协议池后，开发者模式检索/加牌/编译预览覆盖两代全部
// 30 套协议与 120 张卡（DEMO = 1代 + 2代）。别名保留函数体内的变量名。
import { DEMO_CARD_DEFS as ALL_CARD_DEFS, DEMO_PROTOCOLS as ALL_PROTOCOLS } from '../data/demo';
import { executeCompileUnchecked } from '../core/rules/compile';

/**
 * 隐藏开发者模式（测试辅助）：
 * - Ctrl+Shift+P 弹出密码框（并阻止浏览器打印对话框），密码 `上上下下左右左右BABA`
 *   正确后进入指令页；
 * - 指令页支持 `get 牌名` 把指定卡牌加入当前玩家（state.turnPlayer）手牌，
 *   输入时实时检索匹配卡牌列表，点击列表行等于执行 get；
 *  - `clean` 指令：直接清空当前玩家全部手牌到弃牌堆（不触发任何卡牌效果/事件，
 *   方便测试空手牌场景）；
 *  - `Compile 协议名` 指令：在当前玩家回合强制触发当前场上已存在的该协议的编译
 *   效果（无视线值是否 ≥10；未编译 → 翻协议 + 删双方该线全部卡牌，已编译 →
 *   重新编译抽对手牌库顶 1 张），调用引擎编译规则本体 executeCompileUnchecked，
 *   与正式编译同一状态变更/事件路径；
 * - 所有动作同时写入 console（被 diag 全量记录）与 state.log（游戏事件日志），
 *   两者都包含在 diag 导出中。
 *
 * 纯函数部分（resolveCardName / resolveProtocolName / searchCards / 查询表构建）
 * 无 DOM 访问，可在 vitest(node) 下导入；所有 DOM 操作都位于 initDevMode 内部
 * 闭包 / 其调用的函数中。
 */

export interface DevModeHost {
  getState: () => GameState;
  render: () => void;
}

/** 隐藏密码（任一匹配即解锁；用户指定备选密码 ssxxzyzybaba） */
const PASSWORDS = new Set(['上上下下左右左右BABA', 'ssxxzyzybaba']);

/** 指令页提示行 */
const HINT = '指令：get 牌名 / Compile 协议（输入即模糊预览，点列表行执行）· clean（清空当前玩家手牌）· 如 get light-2、Compile life（中文名 死/生/光 也可）';

/** 卡牌实例 uid 计数器（dev- 前缀保证不与正式 uid 冲突） */
let uidCounter = 0;

/** 是否有开发者浮层打开（打开任一浮层时置 true，关闭时置 false） */
let overlayOpen = false;

/** 会话内密码解锁标记（本局游戏内）：密码正确一次后，后续 Ctrl+Shift+P 直接进入指令页 */
let passwordUnlocked = false;

/**
 * 归一化查询键：小写后移除所有非字母（ASCII）/非数字/非汉字字符。
 * 例：'light-2' → 'light2'；'LIGHT-2' → 'light2'；'光-2' → '光2'；' 光 2 ' → '光2'。
 */
function normalizeKey(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]/g, '');
}

/** 单个检索 token 对一个归一化键的匹配得分：3=精确、2=前缀、1=子串、0=不匹配 */
function tokenMatchScore(token: string, key: string): number {
  if (key === token) return 3;
  if (key.startsWith(token)) return 2;
  return key.includes(token) ? 1 : 0;
}

/** 查询 → 归一化 token 列表：先按空白切分为多词，再逐词归一化（多词 AND 检索用） */
function tokenizeQuery(query: string): string[] {
  return query
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.replace(/[^a-z0-9\u4e00-\u9fff]/g, ''))
    .filter((t) => t !== '');
}

/** 协议 defId → 协议定义（模块加载时构建一次，供查询表与检索索引共用） */
const PROTOCOL_BY_ID: ReadonlyMap<string, ProtocolDef> = new Map(
  ALL_PROTOCOLS.map((proto) => [proto.defId, proto]),
);

/** 检索索引条目：一张牌的两类归一化键（defId / 协议中文名+分值） */
interface SearchEntry {
  def: CardDef;
  /** 归一化 defId，如 'light-2' → 'light2' */
  defKey: string;
  /** 归一化「协议中文名+分值」，如 light 的 2 分牌 → '光2' */
  cnKey: string;
}

/** 全部卡牌的检索索引（模块加载时构建一次） */
const SEARCH_INDEX: readonly SearchEntry[] = ALL_CARD_DEFS.map((def) => {
  const proto = PROTOCOL_BY_ID.get(def.protocol);
  return {
    def,
    defKey: normalizeKey(def.defId),
    cnKey: proto ? normalizeKey(`${proto.name}${def.value}`) : '',
  };
});

/**
 * 卡牌名 → CardDef 查询表（模块加载时构建一次）：
 * - 每个 defId 的归一化键（如 'light2'）；
 * - 每个协议的「中文名 + 分值」键（如 '光2'，对应协议下分值 2 的牌）。
 * 两类键无交集（defId 全 ASCII，协议名全汉字），无歧义。
 */
const CARD_LOOKUP: ReadonlyMap<string, CardDef> = (() => {
  const map = new Map<string, CardDef>();
  for (const entry of SEARCH_INDEX) {
    map.set(entry.defKey, entry.def);
  }
  for (const entry of SEARCH_INDEX) {
    if (entry.cnKey !== '') map.set(entry.cnKey, entry.def);
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

/** 协议 defId → 协议定义查询表（模块加载时构建一次）：键 = 归一化 defId（'life'）与
 *  归一化中文名（'生'），两类键无交集（defId 全 ASCII，协议名全汉字），无歧义。 */
const PROTOCOL_LOOKUP: ReadonlyMap<string, ProtocolDef> = (() => {
  const map = new Map<string, ProtocolDef>();
  for (const proto of ALL_PROTOCOLS) {
    map.set(normalizeKey(proto.defId), proto);
    map.set(normalizeKey(proto.name), proto);
  }
  return map;
})();

/**
 * 解析协议名（纯函数，无 DOM）：接受 `life` / `生` / `LIFE` / ` light-2 ` 等形式
 * （trim + 大小写不敏感）：
 * - 直接命中协议 defId 前缀（'life'/'darkness'…）或协议中文名（'生'/'水'/'暗'…）；
 * - 否则尝试把输入当卡牌名解析（resolveCardName，如 'light-2' → light），取其协议。
 * 找不到返回 null。
 */
export function resolveProtocolName(name: string): ProtocolDef | null {
  const key = normalizeKey(name.trim());
  if (key === '') return null;
  const direct = PROTOCOL_LOOKUP.get(key);
  if (direct) return direct;
  const card = resolveCardName(name);
  if (!card) return null;
  return PROTOCOL_BY_ID.get(card.protocol) ?? null;
}

/**
 * 自然顺序比较 defId：非数字段按字典序、数字段按数值比较
 * （'darkness-5' < 'fire-0' < 'light-0'；'gravity-6' > 'gravity-5'）。
 */
function compareDefIdNatural(a: string, b: string): number {
  const partsA = a.match(/\d+|\D+/g) ?? [];
  const partsB = b.match(/\d+|\D+/g) ?? [];
  const len = Math.max(partsA.length, partsB.length);
  for (let i = 0; i < len; i++) {
    const sa = partsA[i];
    const sb = partsB[i];
    if (sa === undefined) return -1;
    if (sb === undefined) return 1;
    if (sa === sb) continue;
    const numericA = /^\d+$/.test(sa);
    const numericB = /^\d+$/.test(sb);
    if (numericA && numericB) return parseInt(sa, 10) - parseInt(sb, 10);
    return sa < sb ? -1 : 1;
  }
  return 0;
}

/** 实时检索默认上限：指令页最多显示的行数 */
const SEARCH_DEFAULT_LIMIT = 8;

/** 检索命中：卡牌 + 相关性得分（各 token 得分之和） */
interface SearchHit {
  def: CardDef;
  score: number;
}

/**
 * 内部：查询 → 全部匹配卡牌（按 defId 去重 + 相关性排序）。
 * 匹配语义（百度式模糊）：
 * - 多 token AND：查询按空白切分为多个词，每个词都必须命中（defKey 或「协议中文名+分值」
 *   子串）——'light 2' 同时要求含 'light' 与 '2'；
 * - 相关性得分：每词 3=精确 / 2=前缀 / 1=子串，求和；按得分降序、同分按 defId 自然序。
 * 空查询 / 纯空白 → []。
 */
function collectSearchMatches(query: string): SearchHit[] {
  const tokens = tokenizeQuery(query);
  if (tokens.length === 0) return [];
  const found = new Map<string, SearchHit>();
  for (const entry of SEARCH_INDEX) {
    let score = 0;
    let matched = true;
    for (const token of tokens) {
      const best = Math.max(
        tokenMatchScore(token, entry.defKey),
        entry.cnKey !== '' ? tokenMatchScore(token, entry.cnKey) : 0
      );
      if (best === 0) {
        matched = false;
        break;
      }
      score += best;
    }
    if (matched) found.set(entry.def.defId, { def: entry.def, score });
  }
  return [...found.values()].sort(
    (a, b) => b.score - a.score || compareDefIdNatural(a.def.defId, b.def.defId)
  );
}

/**
 * 实时检索（纯函数，无 DOM）：返回匹配 query 的卡牌列表，最多 limit 张
 * （默认 8）。百度式模糊：多词 AND + 相关性排序（精确 > 前缀 > 子串，同分按
 * defId 自然序），再截取 limit。
 * - defId：如 'light' / 'light2' / 'ght2' / '2' 命中 light-2；
 * - 协议中文名 + 分值：如 '光' / '光2' 命中 light-2；'暗5' 命中 darkness-5；
 * - 多词：'light 2' / '光 2' 命中 light-2（每词都必须命中）。
 * query 为空 / 纯空白 → 返回 []。
 */
export function searchCards(query: string, limit: number = SEARCH_DEFAULT_LIMIT): CardDef[] {
  return collectSearchMatches(query)
    .slice(0, limit)
    .map((hit) => hit.def);
}

/** 协议检索命中：协议 + 相关性得分 */
interface ProtocolHit {
  proto: ProtocolDef;
  score: number;
}

/**
 * 查询 → 全部匹配协议（百度式模糊，纯函数，无 DOM）：token 同时匹配 defId 与协议
 * 中文名（'life'/'lif'/'死'/'死 ' 均命中），多词 AND + 精确>前缀>子串排序。
 * 空查询 → 返回全部协议（便于预览页直接点选）。
 */
function collectProtocolMatches(query: string): ProtocolHit[] {
  const tokens = tokenizeQuery(query);
  const hits: ProtocolHit[] = [];
  for (const proto of ALL_PROTOCOLS) {
    const defKey = normalizeKey(proto.defId);
    const cnKey = normalizeKey(proto.name);
    let score = 0;
    let matched = true;
    for (const token of tokens) {
      const best = Math.max(tokenMatchScore(token, defKey), tokenMatchScore(token, cnKey));
      if (best === 0) {
        matched = false;
        break;
      }
      score += best;
    }
    if (matched) hits.push({ proto, score });
  }
  hits.sort((a, b) => b.score - a.score || compareDefIdNatural(a.proto.defId, b.proto.defId));
  return hits;
}

/** 实时协议检索（供 Compile 指令预览，纯函数，无 DOM）：最多 limit 个 */
export function searchProtocols(query: string, limit: number = SEARCH_DEFAULT_LIMIT): ProtocolDef[] {
  return collectProtocolMatches(query)
    .slice(0, limit)
    .map((hit) => hit.proto);
}

/** 日志：同时写入 console（diag 全量捕获）与 state.log（游戏事件日志，diag 导出含尾部） */
function log(host: DevModeHost, msg: string): void {
  const full = `[开发者模式] ${msg}`;
  console.log(full);
  host.getState().log.push(full);
}

/**
 * 把指定 defId 的卡牌加入当前玩家（state.turnPlayer）手牌并触发重渲染。
 * get 指令与检索列表点击共用此加牌路径；suffix 追加到日志末尾（如检索来源）。
 * 找不到 defId 返回 false（不改变状态）。
 */
function addCardToCurrentPlayer(host: DevModeHost, defId: string, suffix = ''): boolean {
  const def = CARD_LOOKUP.get(normalizeKey(defId));
  if (!def) return false;
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
  log(host, `已添加 ${def.defId} 到 P${player + 1} 手牌${suffix}`);
  host.render();
  return true;
}

/**
 * Compile 指令（R16）：在当前玩家（state.turnPlayer）回合强制触发【当前场上已存在】
 * 的指定协议的编译效果——无视线值是否 ≥10/是否可编译。
 * - 解析协议名（resolveProtocolName：defId 前缀 / 中文名 / 卡牌名回退）；
 * - 在当前玩家 protocols 中按 defId 定位协议线（不在当前玩家场上 → 记日志并返回）；
 * - 调用引擎编译规则本体 executeCompileUnchecked（绕过 ≥10 前置校验，直接执行编译
 *   本体）：未编译 → 删双方该线全部卡牌 + 翻协议；已编译 → 重新编译（删牌 +
 *   抽对手牌库顶 1 张所有权变更）。与正式编译同一状态变更/事件路径（line:compiled
 *   事件照发 → 编译清牌 FX 正常播放），不破坏引擎行动流。
 */
function forceCompileProtocol(host: DevModeHost, name: string): void {
  const state = host.getState();
  const player = state.turnPlayer;
  const proto = resolveProtocolName(name);
  if (!proto) {
    log(host, `未找到协议: ${name}`);
    return;
  }
  const line = state.players[player].protocols.findIndex((p) => p.defId === proto.defId);
  if (line === -1) {
    log(host, `P${player + 1} 场上没有协议 ${proto.defId}（${proto.name}）`);
    return;
  }
  executeCompileUnchecked(state, player, line as Line);
  log(host, `已强制编译 P${player + 1} 的 ${proto.defId}（line ${line + 1}）`);
  host.render();
}

/**
 * 执行一条指令。支持：
 * - `get 牌名`（大小写不敏感）：把解析出的牌加入当前玩家（state.turnPlayer）手牌并触发重渲染；
 * - `clean`（大小写不敏感）：直接清空当前玩家全部手牌到弃牌堆并触发重渲染——
 *   纯状态操作，不经 executeAction / discard op，不触发任何引擎事件或卡牌效果。
 * - `Compile 协议名`（大小写不敏感）：在当前玩家回合强制触发当前场上已存在的该协议
 *   的编译效果（无视线值；未编译翻协议、已编译重新编译抽对手牌库顶 1 张），调用引擎
 *   编译规则本体 executeCompileUnchecked 并触发重渲染。
 * 未知指令 / 未找到卡牌：记录日志，不改变状态。
 */
export function runCommand(host: DevModeHost, line: string): void {
  const trimmed = line.trim();
  if (trimmed === '') return;
  log(host, `收到指令: ${trimmed}`);
  // clean：把当前玩家整手手牌直接 splice 进弃牌堆（zone/faceUp/line/pos 与 discard op
  // 的落牌一致；手牌 = 已知信息 → 一并清除 secret）。只改 state，不调用引擎。
  if (/^clean$/i.test(trimmed)) {
    const state = host.getState();
    const player = state.turnPlayer;
    const p = state.players[player];
    const hand = p.hand;
    const count = hand.length;
    for (const card of hand) {
      card.zone = 'trash';
      card.faceUp = true;
      card.line = null;
      card.pos = null;
      delete card.secret; // 弃牌堆 = 公开信息，清除牌堆来源的 secret 标记
    }
    p.trash.push(...hand);
    p.hand = [];
    log(host, `已清空 P${player + 1} 手牌（clean，${count} 张）`);
    host.render();
    return;
  }
  const cm = /^compile\s+(.+)$/i.exec(trimmed);
  if (cm) {
    forceCompileProtocol(host, cm[1].trim());
    return;
  }
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
  addCardToCurrentPlayer(host, def.defId);
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
    if (input.value.trim() === '') return;
    if (PASSWORDS.has(input.value.trim())) {
      passwordUnlocked = true; // 会话内解锁：本局游戏内后续免密进入
      log(host, '密码正确，打开指令页');
      close('密码输入框已关闭（密码正确）');
      openCommandPage(host);
    } else {
      log(host, '密码错误');
      close('密码输入框已关闭（密码错误）');
    }
  });
}

/** 指令页：遮罩 + 居中面板（标题、提示、输入框、实时检索列表、关闭按钮）；回车执行指令并保持打开 */
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
  input.placeholder = 'get light-2 / Compile life（输入即模糊预览）';
  const results = document.createElement('div');
  results.className = 'dev-results';
  results.hidden = true;
  const closeBtn = document.createElement('button');
  closeBtn.className = 'btn dev-console-close';
  closeBtn.textContent = '关闭';
  panel.appendChild(title);
  panel.appendChild(hint);
  panel.appendChild(input);
  panel.appendChild(results);
  panel.appendChild(closeBtn);
  backdrop.appendChild(panel);
  document.body.appendChild(backdrop);
  input.focus();

  /**
   * 渲染实时检索列表：输入框每键一次重绘。空查询 / 无匹配 → 隐藏；
   * 最多显示 SEARCH_DEFAULT_LIMIT 行，超出追加「…共 N 张」行（不可点击）。
   * 2026-09-03：按命令前缀分流——`compile` 前缀走【协议模糊预览】（defId/中文名，
   * 点击行 = 强制编译该协议，解决用户"不知道英文对不对"）；其余走卡牌 get 预览。
   */
  const renderResults = (): void => {
    const query = input.value;
    // `compile` / `Compile xxx`（含未加空格的中文名直接输入）都走协议预览
    const cm = /^compile(?:\s+(.*))?$/i.exec(query.trim());
    results.replaceChildren();
    if (cm) {
      // —— Compile 模式：协议模糊预览（空参数 → 列出全部协议供点选）——
      const all = collectProtocolMatches(cm[1] ?? '');
      if (all.length === 0) {
        results.hidden = true;
        return;
      }
      const state = host.getState();
      const fieldIds = new Set(state.players[state.turnPlayer].protocols.map((p) => p.defId));
      const shown = all.slice(0, SEARCH_DEFAULT_LIMIT);
      for (const hit of shown) {
        const proto = hit.proto;
        const row = document.createElement('div');
        row.className = 'dev-result';
        const label = document.createElement('span');
        label.className = 'dev-result-label';
        label.textContent = `compile ${proto.defId}（${proto.name}）`;
        row.appendChild(label);
        const hintSpan = document.createElement('span');
        hintSpan.className = 'dev-result-hint';
        hintSpan.textContent = fieldIds.has(proto.defId) ? '本局场上 · 点击强制编译' : '不在当前玩家场上';
        row.appendChild(hintSpan);
        row.addEventListener('click', () => {
          forceCompileProtocol(host, proto.defId); // 与 Compile 指令同一执行路径
          input.value = '';
          results.hidden = true;
          input.focus(); // 点击行后保持焦点，便于连续操作
        });
        results.appendChild(row);
      }
      if (all.length > SEARCH_DEFAULT_LIMIT) {
        const more = document.createElement('div');
        more.className = 'dev-result dev-result-more';
        more.textContent = `…共 ${all.length} 个协议`;
        results.appendChild(more);
      }
      results.hidden = false;
      return;
    }
    // —— get 模式：卡牌模糊预览 ——
    const all = collectSearchMatches(query);
    if (all.length === 0) {
      results.hidden = true;
      return;
    }
    const shown = all.slice(0, SEARCH_DEFAULT_LIMIT);
    for (const hit of shown) {
      const def = hit.def;
      const proto = PROTOCOL_BY_ID.get(def.protocol);
      const row = document.createElement('div');
      row.className = 'dev-result';
      const label = document.createElement('span');
      label.className = 'dev-result-label';
      label.textContent = `${def.defId}（${proto ? `${proto.name}${def.value}` : def.defId}）`;
      row.appendChild(label);
      const hintText = def.middle ?? def.top ?? def.bottom;
      if (hintText) {
        const hintSpan = document.createElement('span');
        hintSpan.className = 'dev-result-hint';
        hintSpan.textContent = hintText;
        hintSpan.title = hintText;
        row.appendChild(hintSpan);
      }
      row.addEventListener('click', () => {
        // 与 get 指令共用同一加牌路径（defId 必然有效，忽略返回值）
        addCardToCurrentPlayer(host, def.defId, '（检索）');
        input.value = '';
        results.hidden = true;
        input.focus(); // 点击行后保持焦点在输入框，便于连续检索
      });
      results.appendChild(row);
    }
    if (all.length > SEARCH_DEFAULT_LIMIT) {
      const more = document.createElement('div');
      more.className = 'dev-result dev-result-more';
      more.textContent = `…共 ${all.length} 张`;
      results.appendChild(more);
    }
    results.hidden = false;
  };

  input.addEventListener('input', renderResults);

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
    // 成功或失败都清空输入并隐藏检索列表，保持指令页打开，便于连续批量 get
    input.value = '';
    results.hidden = true;
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
      if (passwordUnlocked) {
        // 本局游戏内已解锁：跳过密码框，直接进入指令模式
        log(host, '已解锁，直接进入指令模式');
        openCommandPage(host);
        return;
      }
      openPasswordPrompt(host);
    }
  };
  window.addEventListener('keydown', onKeyDown);
  return () => window.removeEventListener('keydown', onKeyDown);
}
