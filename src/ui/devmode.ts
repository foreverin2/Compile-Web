import { pushLog } from '../core/log';
import type { Card, CardDef, GameState, Line, ProtocolDef } from '../core/models/types';
// 2026-09-06：3代（MN03）并入协议池后，开发者模式检索/加牌/编译预览覆盖三代全部
// 45 套协议与 270 张卡（DEMO = 1代 90 + 2代 90 + 3代 90）。别名保留函数体内的变量名。
import { DEMO_CARD_DEFS as ALL_CARD_DEFS, DEMO_PROTOCOLS as ALL_PROTOCOLS } from '../data/demo';
import { executeCompileUnchecked } from '../core/rules/compile';
import { resetControlIfHeld } from '../core/rules/control';
import { executeDevSkip } from '../core/game';
import { nextUid } from '../core/state/create';

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
  /**
   * **远程对战页的视角座位**（G2 修正 **R12-6**）：可选。
   * 用户第五次验收："还有预览工具条，我希望隐藏它，并将它的功能内化给开发者模式" ⇒
   * 工具条第 2 行的「视角切换」搬到这里（`视角` / `seat 1|2` 指令）。
   * 传了它才有这条指令（热座页 / 重放页 / 联机大厅不传 ⇒ 指令报"此页没有视角开关"）。
   *
   * ⚠️ 2026-10-01 之前这条指令的主要用处是那条**本地单视角预览**（一个屏幕上看远程页布局）；
   * 那个模式已按用户要求删除 ⇒ 现在它服务于**联机牌桌**（在哪一端都能切到对方视角看局面）。
   */
  netSeat?: { get(): 0 | 1; set(seat: 0 | 1): void };
  /**
   * **这一页是不是"真的在联机对局里"**（用户 2026-09-27 ⑧）。
   *
   * 传了它、且返回 `true` 时，**会改游戏状态的指令一律拒绝**（`get` / `clean` /
   * `Compile` / `/skip`）——开发者在某一端直接改 `state` 不经 `executeAction`，
   * 行动日志里没有这一步，另一端无从复现 ⇒ 两端的牌局当场分叉（用户原话：
   * "使用指令进行某一步操作后，会导致双方的游戏数据不同步"）。
   * 只读/视角类（`视角` / `seat`）不改状态、只影响本机视图 ⇒ 保持可用。
   *
   * 缺省（不传）= **不是联机对局**：热座页与重放页都要照常改状态做测试
   * （热座是一个人操作两边、重放是只读档案，都不会造成两端分歧）。
   * `src/main.ts` 传的是"已经进了联机牌桌"（`netGame !== null`），不是
   * `renderMode === 'net'` —— 后者对"本机是不是真的在联机里"这件事判别力不够
   * （2026-10-01 之前它还会把那条已删掉的本地预览路径算进去）。
   */
  isNetMatch?: () => boolean;
}

/** 隐藏密码（任一匹配即解锁；用户指定备选密码 ssxxzyzybaba） */
const PASSWORDS = new Set(['上上下下左右左右BABA', 'ssxxzyzybaba']);

/**
 * **开发者模式是否已解锁**（会话内）。G2 修正 **R12-6** 用它当"预览工具条"的开关：
 * 密码正确一次之后，远程页才会渲染那条工具条（含视角切换与运行时自查行），
 * 普通对局里页面上**没有**它。
 * ⚠️ 与 `overlayOpen` **不是一回事**：那个是"浮层此刻开着吗"，这里是"本会话解锁过吗"。
 */
export function isDevUnlocked(): boolean {
  return passwordUnlocked;
}

/**
 * 校验一个密码（**纯函数，无 DOM**）：命中即把会话内解锁标记置 true 并返回 `true`。
 *
 * 为什么把这一句从密码框里抽出来：密码框是 DOM 路径（`openPasswordPrompt`），
 * vitest(node) 下走不到，于是"`/skip` 解锁后才可用"这条判据在 node 层**没有腿**
 * （只能靠人眼看浏览器，等于没牙）。抽成纯函数后，node 判据可以自己解锁、自己验证。
 * 行为与抽出前逐字一致：`PASSWORDS` 命中才算，大小写敏感（与原来一样）。
 */
export function tryUnlockDevMode(password: string): boolean {
  if (!PASSWORDS.has(password.trim())) return false;
  passwordUnlocked = true;
  return true;
}

/*
 * ⚠️ **2026-10-01（用户要求）：这里原先还有一个 `resetDevUnlock()`** —— 由宿主在整局复位
 * （`src/main.ts` 的 `resetToMainInterface()`）时把 `passwordUnlocked` 置回 `false`。
 * 它当时的**唯一**目的是收回模式选择页那张「单视角预览（仅开发）」卡的闸门
 * （`renderModeSelect(root, {…}, isDevUnlocked())`）：解锁一次之后那张卡会在"退出热座回到模式页"
 * 时又出现（用户 2026-10-01 报的回归）。
 *
 * 用户随后要求**把那个模式整个删掉** ⇒ `renderModeSelect` 不再有那个形参、那张卡也不存在了，
 * `resetDevUnlock()` 失去全部消费者（它的作用面是空的：`isDevUnlocked()` 现在只决定远程页
 * 工具条 / `verifyHooks` / devmode 指令，而这些正是用户要求**保留**的能力，不该随退出热座
 * 被收回）⇒ 函数与宿主那一句调用一起删除。
 *
 * 语义因此回到"解锁一次，活到整页刷新为止"（`localhost` / 私用设备的单会话语义），
 * 与 R12-6 引入它的那一刻一致。**没有被删掉的**：`Ctrl+Shift+P` 密码框、指令页、
 * `get` / `clean` / `Compile` / `/skip` / `视角` / `seat 1|2`、远程页 `verifyHooks` 工具条。
 * `overlayOpen`（浮层此刻开没开）从来没有受它管辖：那是"浮层自己的生命周期"。
 */

/** 指令页提示行 */
const HINT = '指令：get 牌名 / Compile 协议（输入即模糊预览，点列表行执行）· clean（清空当前玩家手牌）'
  + '· /skip（强制推进一格，就是以前那个"跳过"）· 视角 / seat 1|2（远程页切视角；不写数字 = 切换）'
  + '· 如 get light-2、Compile life（中文名 死/生/光 也可）';

/**
 * **联机对局里拒绝"会改状态"的开发者指令**时写在屏上的那句话
 * （用户 2026-09-27 ⑧：用了指令之后两端不同步）。
 */
export const NET_STATE_REFUSAL = '联机对局中不可用：这条指令会直接改本机牌局状态，'
  + '另一端复现不出来，用完两边就不同步了（要改状态请断开联机，在热座页里用）';

/**
 * 这条指令会不会**改游戏状态**（联机对局里一律拒绝）。
 *
 * 判的是**指令名**，不是"这次输入解析成功没有"：`get 不存在的牌` 不改状态，但它与
 * `get light-2` 是同一个入口，按名字拒更简单、也不会出现"拼错名字就绕过了闸门"。
 * `视角` / `seat` 只动 `host.netSeat`（本机视图座位），不进这个名单。
 */
function isStateChangingCommand(cmd: string): boolean {
  return /^clean$/i.test(cmd)
    || /^\/?skip$/i.test(cmd)
    || /^compile\s+.+$/i.test(cmd)
    || /^get\s+.+$/i.test(cmd);
}

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

/** 协议改名前的旧中文名（2026-09 修改提示词批：水→流水/火→火焰/光→明光/暗→黑暗/生→生命/
 *  死→死亡/灵魂→精神/念能→灵能/明晰→透彻/烟雾→迷雾/统一→联合）——devmode 输入兼容旧名。 */
const PROTOCOL_OLD_NAMES: ReadonlyMap<string, string> = new Map([
  ['water', '水'], ['fire', '火'], ['light', '光'], ['darkness', '暗'], ['life', '生'], ['death', '死'],
  ['spirit', '灵魂'], ['psychic', '念能'], ['clarity', '明晰'], ['smoke', '烟雾'], ['unity', '统一'],
]);

/** 检索索引条目：一张牌的两类归一化键（defId / 协议中文名+分值；旧名别名另存） */
interface SearchEntry {
  def: CardDef;
  /** 归一化 defId，如 'light-2' → 'light2' */
  defKey: string;
  /** 归一化「协议中文名+分值」，如 light 的 2 分牌 → '光2' */
  cnKey: string;
  /** 归一化「协议旧名+分值」（改名兼容，如 '明光2' 仍可输入 '光2'） */
  aliasKey: string;
}

/** 全部卡牌的检索索引（模块加载时构建一次） */
const SEARCH_INDEX: readonly SearchEntry[] = ALL_CARD_DEFS.map((def) => {
  const proto = PROTOCOL_BY_ID.get(def.protocol);
  const old = proto ? PROTOCOL_OLD_NAMES.get(proto.defId) : undefined;
  return {
    def,
    defKey: normalizeKey(def.defId),
    cnKey: proto ? normalizeKey(`${proto.name}${def.value}`) : '',
    aliasKey: proto && old ? normalizeKey(`${old}${def.value}`) : '',
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
    if (entry.aliasKey !== '') map.set(entry.aliasKey, entry.def); // 旧协议名 + 分值（改名兼容）
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
    const old = PROTOCOL_OLD_NAMES.get(proto.defId);
    if (old) map.set(normalizeKey(old), proto); // 旧名别名（改名兼容）
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
        entry.cnKey !== '' ? tokenMatchScore(token, entry.cnKey) : 0,
        entry.aliasKey !== '' ? tokenMatchScore(token, entry.aliasKey) : 0
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
    const old = PROTOCOL_OLD_NAMES.get(proto.defId);
    const aliasKey = old ? normalizeKey(old) : '';
    let score = 0;
    let matched = true;
    for (const token of tokens) {
      const best = Math.max(tokenMatchScore(token, defKey), tokenMatchScore(token, cnKey), aliasKey !== '' ? tokenMatchScore(token, aliasKey) : 0);
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

/**
 * 日志：写入 console（diag 全量捕获）与 state.log（游戏事件日志，屏上日志面板画的就是它）。
 *
 * ⚠️ **联机对局里只写 console，不进 `state.log`**（G6 T45）：`state.log` 是**跨端规范串**
 * 的一部分（`__g5Match.state()` = `stableStringify(state)`，含整局 log）——本机多写一行，
 * 两端规范串就不再逐字相等。⑧ 那条"用了指令之后两端不同步、拒绝之后两端指纹必须相等"的
 * 判据会被这一行**打假**（牌的盘面一模一样，却报"不同步"）。
 * 屏上那句说明改由**指令页自己那行状态区**承载（见 `openCommandPage` 的 `notice`），
 * 于是"屏上有人话"与"两端规范串逐字相等"两件事同时成立。
 */
function log(host: DevModeHost, msg: string): void {
  const full = `[开发者模式] ${msg}`;
  console.log(full);
  if (host.isNetMatch?.() === true) return; // 联机：一个字节都不进 state.log
  pushLog(host.getState(), full);
}

/**
 * 联机对局闸门（用户 2026-09-27 ⑧）——**唯一一处判断**，而且长在"改状态"那一层上。
 *
 * ## 为什么不能只长在 `runCommand` 里（2026-09-27 评审逮到的真洞）
 *
 * 指令页里除了回车，还有**两条检索行的点击**：协议行 → `forceCompileProtocol`、
 * 卡片行 → `addCardToCurrentPlayer`。这两条**不走 `runCommand`** ⇒ 闸门只挡得住回车那条路，
 * 鼠标一点照样把本机 `state` 改了（评审真机读数：手牌 5→6、规范串 9139→9232 字符、
 * 屏上还没有任何说明），两端当场分叉。
 *
 * 现在闸门长在**两个改状态函数的本体**上（`addCardToCurrentPlayer` / `forceCompileProtocol`
 * 是 devmode 里仅有的两处"把牌局改掉"的出口），谁调它们都拦得住；将来再加第三条入口，
 * 只要它改状态就必然经过这两个函数之一。
 * `runCommand` 里那一道**仍然留着**：它要能在**写任何日志之前**就把整条指令挡掉
 * （联机下一个字节都不许进 `state.log`，见 `log`）。
 */
function netGateBlocks(host: DevModeHost, cmd: string): boolean {
  return host.isNetMatch?.() === true && isStateChangingCommand(cmd);
}

/**
 * 把指定 defId 的卡牌加入当前玩家（state.turnPlayer）手牌并触发重渲染。
 * get 指令与检索列表点击共用此加牌路径；suffix 追加到日志末尾（如检索来源）。
 * 找不到 defId 返回 null（不改变状态）；**联机对局里被闸门挡下**，返回那句拒绝说明。
 *
 * ⚠️ uid 走引擎的 `nextUid(state)`（G0：uid 计数器已进状态）。此前这里是
 * `dev-` + 模块计数器 + 时钟时间戳拼出来的 uid —— 全项目唯一一个既绕过 `nextUid(s)`、
 * 又自带时钟熵的加牌路径（时间戳部分写法见本文件历史版本），任何其它客户端都无法派生出同一张卡。
 * 另注：**开发者模式注入绕过行动日志**（直接 push 进手牌，不经 executeAction），
 * 因此注入过的对局不可重放/不可联机校验 —— 这是调试工具，不是对局路径。
 */
function addCardToCurrentPlayer(host: DevModeHost, defId: string, suffix = ''): string | null {
  // 闸门必须在 `nextUid(state)` **之前**：那个调用本身就把 uid 计数器推了一格（也是改状态）
  if (netGateBlocks(host, `get ${defId}`)) {
    log(host, NET_STATE_REFUSAL);
    return NET_STATE_REFUSAL;
  }
  const def = CARD_LOOKUP.get(normalizeKey(defId));
  if (!def) return null;
  const state = host.getState();
  const player = state.turnPlayer;
  const card: Card = {
    uid: nextUid(state),
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
  return null;
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
 *
 * 返回值：正常情况下 `null`；**联机对局里被闸门挡下**时返回那句拒绝说明
 * （见 `netGateBlocks`——闸门长在这里而不是只长在 `runCommand`，见那边的注释）。
 */
function forceCompileProtocol(host: DevModeHost, name: string): string | null {
  if (netGateBlocks(host, `compile ${name}`)) {
    log(host, NET_STATE_REFUSAL);
    return NET_STATE_REFUSAL;
  }
  const state = host.getState();
  const player = state.turnPlayer;
  const proto = resolveProtocolName(name);
  if (!proto) {
    log(host, `未找到协议: ${name}`);
    return null;
  }
  const line = state.players[player].protocols.findIndex((p) => p.defId === proto.defId);
  if (line === -1) {
    log(host, `P${player + 1} 场上没有协议 ${proto.defId}（${proto.name}）`);
    return null;
  }
  // 与正式编译一致：编译玩家若持有控制组件先归还中立（规则文本「控制组件相关规则」；
  // devmode 旁路不弹重排模态——重排交互在正式 UI 流程 main.ts）
  resetControlIfHeld(state, player);
  executeCompileUnchecked(state, player, line as Line, { force: true });
  log(host, `已强制编译 P${player + 1} 的 ${proto.defId}（line ${line + 1}）`);
  host.render();
  return null;
}

/**
 * 执行一条指令。支持：
 * - `get 牌名`（大小写不敏感）：把解析出的牌加入当前玩家（state.turnPlayer）手牌并触发重渲染；
 * - `clean`（大小写不敏感）：直接清空当前玩家全部手牌到弃牌堆并触发重渲染——
 *   纯状态操作，不经 executeAction / discard op，不触发任何引擎事件或卡牌效果。
 * - `Compile 协议名`（大小写不敏感）：在当前玩家回合强制触发当前场上已存在的该协议
 *   的编译效果（无视线值；未编译翻协议、已编译重新编译抽对手牌库顶 1 张），调用引擎
 *   编译规则本体 executeCompileUnchecked 并触发重渲染。
 * - `/skip`（G6 T45，用户 2026-09-27 ⑥）：**显式旁路**，强制把当前玩家推进一步；
 *   只在开发者模式解锁后可用，四条老守卫（必编译 / 空手必刷新 / 超 5 必清 / 必选触发）
 *   照旧拦（见 `executeDevSkip`）。
 * - **联机对局里会改状态的指令一律拒绝**（G6 T45，用户 2026-09-27 ⑧）：见 `isStateChangingCommand`。
 * 未知指令 / 未找到卡牌：记录日志，不改变状态。
 *
 * 返回值 = **给屏上那行状态区的一句话**（联机拒绝原因 / `/skip` 回执），其它情况 `null`。
 * 它必须存在：联机下这些说明不能进 `state.log`（`state.log` 在跨端规范串里），
 * 屏上就只剩指令页这一行能说清"为什么没执行"。
 */
export function runCommand(host: DevModeHost, line: string): string | null {
  const trimmed = line.trim();
  if (trimmed === '') return null;
  /**
   * ── 联机对局闸门（用户 2026-09-27 ⑧）──
   * 会改状态的指令在**真的联机对局**里一律不执行，只留一句人话说明：这些指令直接改本机
   * `state`（不经 `executeAction`、不进行动日志），另一端没有这一步可复现 ⇒ 用完两端分叉。
   * 只读/视角类不走这里（`视角` / `seat` 只动本机视图座位）。
   *
   * ⚠️ 这道闸门必须**排在 `log(host, '收到指令: …')` 之前**：联机下 `log` 只写 console
   * （见 `log` 的注释），"收到指令"那一行也不许落进 `state.log`，否则两端规范串照样不等。
   */
  if (netGateBlocks(host, trimmed)) {
    console.log(`[开发者模式] 收到指令: ${trimmed}`);
    log(host, NET_STATE_REFUSAL);
    return NET_STATE_REFUSAL; // 屏上：指令页那行状态区
  }
  log(host, `收到指令: ${trimmed}`);
  // ── `/skip`：行动步那个"跳过"的显式旁路（用户 2026-09-27 ⑥）──
  // 行动步只要能出牌或能刷新，引擎与 UI 都不再给跳过；这个指令是**开发者专用**的显式出口，
  // 所以它额外要求"本会话已用密码解锁过"（`Ctrl+Shift+P` + 密码）——普通玩家敲不出来。
  if (/^\/?skip$/i.test(trimmed)) {
    if (!isDevUnlocked()) {
      const msg = '/skip 未执行：先按 Ctrl+Shift+P 输入开发者密码解锁（普通对局里没有跳过这个操作）';
      log(host, msg);
      return msg;
    }
    const state = host.getState();
    const before = `P${state.turnPlayer + 1} ${state.step}`;
    try {
      executeDevSkip(state, state.turnPlayer);
    } catch (e) {
      const msg = `/skip 没有推进（${before}）：${e instanceof Error ? e.message : String(e)}`;
      log(host, msg);
      return msg;
    }
    const msg = `/skip 已推进：${before} → P${state.turnPlayer + 1} ${state.step}`;
    log(host, msg);
    host.render();
    return msg;
  }
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
    return null;
  }
  const cm = /^compile\s+(.+)$/i.exec(trimmed);
  if (cm) {
    // 闸门在最上面已经判过（`compile x` 属于会改状态的指令）⇒ 这里回来的一定是 null
    return forceCompileProtocol(host, cm[1].trim());
  }
  // ── G2 修正 **R12-6**：`视角` / `seat 1|2` —— 远程页切视角（从预览工具条内化过来）──
  // 为什么搬进开发者模式：工具条常驻在棋盘右侧（用户要求隐藏它），而"切到对方视角把一局打完"
  // 是远程页**必须保留**的能力（对手手牌只显示数量那一档不可点，切过去才是"自己"）。
  // 2026-10-01：本地单视角预览那个模式已删 ⇒ 这条指令现在服务于联机牌桌。
  if (/^(?:视角|seat|viewseat)$/i.test(trimmed) || /^(?:视角|seat)\s+\d$/i.test(trimmed)) {
    const box = host.netSeat;
    if (!box) {
      log(host, '此页没有视角开关（`视角` 只在远程对战页可用）');
      return null;
    }
    const m2 = /(\d)\s*$/.exec(trimmed);
    const next = m2 ? (Number(m2[1]) === 2 ? 1 : 0) : (box.get() === 0 ? 1 : 0);
    box.set(next);
    log(host, `视角已切到 P${next + 1}（现在"自己"是 P${next + 1}）`);
    host.render();
    return null;
  }
  const m = /^get\s+(.+)$/i.exec(trimmed);
  if (!m) {
    log(host, `未知指令: ${trimmed}`);
    return null;
  }
  const name = m[1].trim();
  const def = resolveCardName(name);
  if (!def) {
    log(host, `未找到卡牌: ${name}`);
    return null;
  }
  // 闸门在 `addCardToCurrentPlayer` 本体上（see `netGateBlocks`）——那里才是改状态的那一行，
  // 于是"检索行点击"这条不走 runCommand 的路也拦得住
  return addCardToCurrentPlayer(host, def.defId);
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
    if (tryUnlockDevMode(input.value)) {
      log(host, '密码正确，打开指令页');
      close('密码输入框已关闭（密码正确）');
      // ── G2 修正 **R12-6**：解锁后**立刻重渲染**一次 ──
      //    远程页的工具条（含视角切换与运行时自查行）只在解锁后才渲染（见 `isDevUnlocked`
      //    与 `main.ts` 的 `verifyHooks`/`onPreviewChange` 闸门）—— 不重渲染的话，
      //    用户要等到下一次操作才看得见它（"我明明进了开发者模式，工具条却没出来"）。
      host.render();
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
  /**
   * **指令回执行**（G6 T45）：`runCommand` 的返回值画在这里。
   *
   * 为什么它在屏上是必须的：联机对局里"会改状态的指令被拒"那句说明**不能进 `state.log`**
   * （`state.log` 在跨端规范串里 —— 见 `log` 的注释），而 `state.log` 又是日志面板的数据源
   * ⇒ 联机下只剩这一行能把"为什么被拒"说给用户看。复用 `dev-console-hint` 这个既有类，
   * 不动 `styles.css`（红线）。
   */
  const notice = document.createElement('div');
  notice.className = 'dev-console-hint';
  const closeBtn = document.createElement('button');
  closeBtn.className = 'btn dev-console-close';
  closeBtn.textContent = '关闭';
  panel.appendChild(title);
  panel.appendChild(hint);
  panel.appendChild(input);
  panel.appendChild(notice);
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
          /**
           * ⚠️ 走 `runCommand`，**不许**直接调 `forceCompileProtocol`（2026-09-27 评审逮到的洞）：
           * 这两个函数之间差着"联机对局里会改状态的指令一律拒绝"那道闸门。点击行原来绕过它
           * ⇒ 联机里鼠标一点就把本机 `state` 改了（手牌/协议变了、引擎自己还 pushLog），
           * 而两端当场分叉。`forceCompileProtocol` 本体上另有第二道闸门兜底（见 `netGateBlocks`）。
           */
          notice.textContent = runCommand(host, `compile ${proto.defId}`) ?? '';
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
        // 同上：走 `runCommand`（同一个闸门），不许直接调 `addCardToCurrentPlayer`
        notice.textContent = runCommand(host, `get ${def.defId}`) ?? '';
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
    // 返回值 = 屏上那行说明（联机拒绝原因 / `/skip` 回执）；其它指令给 null（回执行清空）
    notice.textContent = runCommand(host, input.value) ?? '';
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

