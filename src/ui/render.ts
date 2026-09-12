import type { ChoiceCard, ChoiceRequest, GameState, PendingEffect, PlayerId, Line, ProtocolDef, Step } from '../core/models/types';
import { getLineValue, getCurrentDrafter, draftTurnRange, draftRoundOwner, DRAFT_PICK_COUNT, DRAFT_BAN_TOTAL, draftNextAction, getDraftPool, draftTurnPicksRemaining, draftBanBlockRemaining, lineTopCommandActive } from '../core/state/create';
import { getLegalActions, type LegalAction } from '../core/game';
import {
  opponentMustPlayFaceDown,
  lineBlocksOpponent,
  lineBlocksOpponentFaceDown,
  lineMiddleCommandsNullified,
  shouldSkipCacheCheck,
  canPlayFaceUpAnywhere,
} from '../core/rules/restrictions';
import { DEMO_PROTOCOLS, cardImgSrc, protocolImgSrc, cardTextParts, getCardDef, getProtocolDef } from '../data/demo';
import type { CardTextParts } from '../data/demo';
import { COMPILED_PROTOCOL_COLORS, protocolColorOf, hexToRgba } from './protocol-colors';
import { PROTOCOL_RATINGS } from '../data/protocolRatings';
import { actionCn } from '../core/log';
import { cardCommandDisabled } from '../core/effects/context';
import { downloadLog } from './diag';
import { buildTornadoFx } from './fx-tornado';
import { buildDove, buildLakeSword, spawnCourageSparks, startLuckDiceFx, startClarityDeckEye } from './fx-gen2';

export interface UiCallbacks {
  onAction(a: LegalAction): void;
  onDraftPick(defId: string): void;
  /** 禁用模式的禁用动作（草稿 ban 步骤点牌禁用） */
  onDraftBan(defId: string): void;
  /** 取消本回合的选择（把已选协议拖出选择框） */
  onDraftUnpick(defId: string): void;
  /** 每次渲染完成后回调（供 UI 层做自动推进等） */
  onRendered?(): void;
  /** 胜利结算遮罩「返回主界面」按钮：应用内重置回主页面（main.ts 实现） */
  onWinReset?(): void;
}

function el(tag: string, cls: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** 卡牌 defId 形如 'fire-3'：协议段 + 分值段即官方图片资源路径的两段 */
function splitDefId(defId: string): [string, string] {
  const sep = defId.indexOf('-');
  return [defId.slice(0, sep), defId.slice(sep + 1)];
}

/**
 * 卡牌正面/背面：
 * - 正面：官方卡面图 /assets/protocols/<协议>/card-<分值>.<png|jpg>（扩展名随世代，见 data/demo）
 * - 背面：官方 Cardback 图 + 印刷值 2 徽章（规则：背面牌值=2）
 */
function renderCardFace(card: { defId: string; faceUp: boolean; uid: string }): HTMLElement {
  const box = el('div', 'card');
  // 卡牌实例标识：选择模式 / 拖拽等按 uid 定位（对所有卡牌渲染路径统一写入）
  box.dataset.uid = card.uid;
  // 背面卡（对手手牌 / 场上的背面链路）不暴露身份：仅正面卡携带 data-def-id
  if (card.faceUp) box.dataset.defId = card.defId;
  if (!card.faceUp) {
    const back = el('div', 'card-back');
    const img = document.createElement('img');
    img.src = '/assets/Cardback.jpg';
    img.alt = 'card back';
    img.className = 'cardback-img';
    back.appendChild(img);
    box.appendChild(back);
    return box;
  }
  const [protocol, value] = splitDefId(card.defId);
  const img = document.createElement('img');
  img.className = 'card-face-img';
  img.src = cardImgSrc(protocol, value);
  img.alt = `protocol ${protocol} card ${value}`;
  box.appendChild(img);
  return box;
}

function renderProtocol(p: { defId: string; compiled: boolean }, player: PlayerId): HTMLElement {
  const box = el('div', 'protocol' + (p.compiled ? ' compiled' : ''));
  // holder 包裹卡面图：持久 FX 层每帧渲染按 holder 矩形重定位（syncCompiledFxLayers），
  // 不受 .protocol 盒 flex:1 拉伸影响（横版协议/行高不一致时环仍紧贴卡面）
  const holder = el('div', 'protocol-holder');
  // 已编译协议专属特效类（类随 defId 挂载 → 协议换位/重排时特效跟随对应协议）
  if (p.compiled) {
    box.classList.add(`compiled-fx-${p.defId}`);
    // R12：已编译环特效持久层挂在 document.body（position:fixed），按 defId 注册——
    // 首次编译 get-or-create 构建一次并挂到 body，此后每次渲染只把层重定位到 holder
    // 矩形（syncCompiledFxLayers，DOM 挂载后测量），节点从不 detach/reattach → CSS
    // 动画永不重启。不再 appendChild 进 holder：旧树每次重建会随父 detach，把 fx
    // 重挂回去会重启动画（R11.3"移动既有节点不重启动画"对断连节点不成立 → 步骤切换
    // "一卡一卡"的根因）。每玩家 3 协议 defId 互不相同、双方亦不共享（草案池每 defId
    // 只出现一次）→ 以 defId 为键安全。
    let fx = compiledFx.get(p.defId);
    if (!fx) {
      fx = buildCompiledFx(p.defId);
      compiledFx.set(p.defId, fx);
    }
    compiledFxCells.push({ defId: p.defId, holder });
  } else {
    // 未编译：释放该 defId 的持久 FX（若有）——先停掉其 JS 周期调度（锁链/黑洞/爆发等），
    // 再移除层（CSS 无限动画随节点移除自然终止；挂起 timer 不清会悬挂到游戏结束）
    const fx = compiledFx.get(p.defId);
    if (fx) {
      clearCompiledFxTimers(p.defId);
      fx.remove();
      compiledFx.delete(p.defId);
    }
  }
  const img = document.createElement('img');
  // R1 协议卡朝向：P1（左）按原图方向展示；P2（右）旋转 180° 使双方协议相对放置。
  // 三代协议图同规格竖版存储（3代 源横向成品已转竖版入库，2026-09-06 v2）。
  img.className = 'protocol-img' + (player === 1 ? ' rot-180' : '');
  img.src = protocolImgSrc(p.defId, p.compiled);
  img.alt = p.compiled ? 'compiled protocol' : 'protocol loading';
  // R12：卡面图异步加载会改变 holder 矩形 —— 编译翻面瞬间 protocol-compiled.png 尚未
  // 加载，holder 高度为 0，若此后不再重渲染（如最后一次编译即 gameover）body 级层会
  // 永久塌陷成 0 高。图片加载完成时按当前 holder 矩形重定位一次对应层（幂等：rect
  // 未变时重写相同值无害；层节点仍不移动，只是坐标/尺寸更新，动画不受影响）。
  if (p.compiled) {
    img.addEventListener('load', () => positionCompiledFxLayer(p.defId, holder));
  }
  holder.appendChild(img);
  box.appendChild(holder);
  if (p.compiled) box.appendChild(el('span', 'protocol-check', '✓'));
  // 双击协议卡放大查看（协议无单击动作，直接 dblclick 即可；协议图横向展示）
  box.addEventListener('dblclick', () => openZoom(p.defId, true, true, p.compiled));
  return box;
}

/**
 * 线值能量条指示器（纯 CSS）：位于链路槽外侧端（远离协议一侧），垂直居中。
 * 10 格能量 = 该线点值（clamp 0..10）；外壳 4 态按点值：
 * ≤3 stable（方正平直，青色描边）/ 4-6 bulge（上下微微鼓出，橙黄微光）/
 * 7-9 full（明显鼓胀接近圆润，橙色强光 + 应力裂纹）/ ≥10 burst（爆裂：径向爆光 +
 * 裂纹 + 红橙脉冲；10 格仍全部点亮）。分段式能量格外观（暗槽 + 青色填充），
 * 非电池造型：无正极凸头/LED、无扫描流光。pointer-events:none —— 纯视觉，
 * 不拦截槽位打牌点击与卡牌交互。
 */
/**
 * 能量条状态跟踪：记录每个 (player, line) 的上一次点数与形态，用于在点数变化时
 * 触发格子的渐入动画与外壳形态切换动画。
 */
const batteryPrev = new Map<string, { points: number; state: string }>();

function batteryState(points: number): 'stable' | 'bulge' | 'full' | 'burst' {
  if (points >= 10) return 'burst';
  if (points >= 7) return 'full';
  if (points >= 4) return 'bulge';
  return 'stable';
}

function renderBattery(s: GameState, player: PlayerId, line: Line): HTMLElement {
  const points = getLineValue(s, player, line);
  const state = batteryState(points);
  const battery = el('div', `battery battery-${state}`);
  battery.dataset.points = String(points);
  // 点数/形态变化检测：变化时加 .points-changed 触发格渐入动画（点 4）
  const key = `${player}-${line}`;
  const prev = batteryPrev.get(key);
  if (prev && prev.points !== points) {
    battery.classList.add('points-changed');
  }
  batteryPrev.set(key, { points, state });
  // DOM 顺序 = 视觉顺序（flex column 自上而下）：仅外壳（10 格竖排）居中。
  // 格填充方向由 CSS .battery-cells 的 column-reverse 控制（从下到上增加）。
  const shell = el('div', 'battery-shell');
  const cells = el('div', 'battery-cells');
  const filled = Math.min(points, 10);
  for (let i = 0; i < 10; i++) {
    cells.appendChild(el('span', 'battery-cell' + (i < filled ? ' filled' : '')));
  }
  shell.appendChild(cells);
  battery.appendChild(shell);
  // 点数 > 10（能量槽 10 格无法显示）→ 在电池左/右侧用数字直接显示当前链路点数
  // （P1 槽靠左、P2 槽靠右——见 styles.css .battery-overflow 的 data-player 定位）
  if (points > 10) {
    const num = document.createElement('span');
    num.className = 'battery-overflow';
    num.textContent = String(points);
    battery.appendChild(num);
  }
  return battery;
}

/**
 * 一条线的链路槽（横向条带）：stacks[line] 中 pos 0 为最早打出（贴协议一侧），
 * 新牌沿该线从协议向外逐张铺开（横向重叠，见 styles.css .stack .card + .card）：
 * - P1（左侧，grow-left）：协议在右，pos 0 贴右端，越新的牌越靠左（向左生长）。
 * - P2（右侧，grow-right）：协议在左，pos 0 贴左端，越新的牌越靠右（向右生长）。
 * zIndex=pos 保证最新（pos 最大）盖住旧牌。所有卡牌均以完整卡面渲染，被盖住的牌
 * 露出靠协议一侧的 46.2% 宽条带（横向）。场上卡牌按归属旋转：P1（owner 0）顺时针
 * 90°（.rot-cw），P2（owner 1）逆时针 90°（.rot-ccw），正反面一致；手牌不旋转。
 */
function renderStackSlot(
  s: GameState,
  player: PlayerId,
  line: Line,
  selected: string | null,
  onPlay: (line: Line) => void,
  interactable: boolean
): HTMLElement {
  // self 高亮仅限自己侧槽；对方槽作为腐化0 落点（修改提示词 15）也可交互但不带 self 常驻高亮
  const isSelfSlot = player === s.turnPlayer;
  const slot = el('div', `stack-slot p${player + 1}${interactable ? ' interactable' : ''}${interactable && isSelfSlot ? ' self' : ''}`);
  // 拖拽打牌：data 属性供拖拽期按 (player, line) 查询/高亮/命中合法落点
  slot.dataset.line = String(line);
  slot.dataset.player = String(player);
  const cards = s.players[player].stacks[line];
  const pile = el('div', 'stack' + (player === 0 ? ' grow-left' : ' grow-right'));
  // 放置顺序：pos 0（最旧）贴协议一侧，越新的牌越靠外侧。
  // P1 渲染从最新到最旧（row + justify-content:flex-end → 整组右对齐，pos 0 贴右端协议）；
  // P2 渲染从最旧到最新（row + 默认左对齐 → pos 0 贴左端协议）。
  const order: number[] =
    player === 0 ? cards.map((_, i) => cards.length - 1 - i) : cards.map((_, i) => i);
  for (const i of order) {
    const card = cards[i];
    const isTop = i === cards.length - 1;
    // 完整卡面渲染（正面官方图 / 背面 Cardback），不再使用 mini 图 + 徽章
    const node = renderCardFace(card);
    if (!isTop) node.classList.add('covered');
    if (isTop) node.classList.add('top-card');
    // R2 场上卡牌旋转：仅场上链路（正反面一致）；手牌 / 草案不受影响
    node.classList.add(card.owner === 0 ? 'rot-cw' : 'rot-ccw');
    node.dataset.uid = card.uid;
    node.style.zIndex = String(i);
    // FX-5 冷漠2：apathy-2 顶「无效化此列所有牌的中部命令」→ 该列【双方】链路上所有场上卡
    // 灰色滤镜（.apathy-filter 静态 grayscale(1)，重渲染重挂类无动画重置；双击放大
    // openZoom 按 defId 新建 img、不克隆节点 → 查看器不受滤镜影响，见 openZoom 注释）
    if (lineMiddleCommandsNullified(s, line)) node.classList.add('apathy-filter');
    if (selected === card.uid) node.classList.add('selected');
    // 单击=打牌（仅可交互时）、双击=放大查看（双方场上卡均为公开信息）。
    // 双击判别：单击延迟 320ms 严格大于 300ms 双击窗口，窗口内第二次点击先于延迟的
    // 单击触发并取消它，故双击永不误打牌；窗口之外的点击各自成为独立的单击。
    // ITEM 9：自己的反面场上卡（owner === s.turnPlayer）双击放大时带 peek 切换按钮，
    // 背面起显、可切到正面查看（对手的反面卡不提供）。
    // ITEM 1(secret)：牌堆来源的反面打出卡 = 非公开信息——即使持有者（owner === turnPlayer）
    // 也不提供 peek（直到某效果翻正解禁 secret）。
    // 修改提示词 14：对局结束（gameover 复盘）→ 场上所有卡（含对手的）双击都可翻面查看正面
    // stopPropagation 阻断冒泡到槽自身的 click（槽空白处点击仍直接打牌，二者不重复触发）。
    bindClickOrDouble(
      node,
      () => { if (interactable) onPlay(line); },
      () => openZoom(card.defId, card.faceUp, false, false, !card.faceUp && (s.phase === 'gameover' || (card.owner === s.turnPlayer && !card.secret))),
      true
    );
    pile.appendChild(node);
  }
  slot.appendChild(pile);
  // 电池竖摆于放置区外部（贴尾部），实时显示数值；不再显示 线N/空/值N 文本
  slot.appendChild(renderBattery(s, player, line));
  if (interactable) {
    slot.addEventListener('click', () => onPlay(line));
  }
  return slot;
}

/** 常驻黑烟特效层（Part 2）：线上任一玩家有正面 darkness-2（顶命令常驻）时，双方该线
 *  链路槽边框持续浮现又消散的黑烟。12 个 .smoke-puff 沿边框锚点分布（CSS nth-child 定位），
 *  JS 只写 0.5s 步进的交错 animation-delay（0–5.5s，相对 4s keyframe 周期自动回绕，
 *  任意时刻都有多个 puff 处于飞行中）。
 *  overlay 本体由 syncSmokeOverlays 挂到 document.body 并跨重渲染复用（同一 DOM 节点），
 *  每帧渲染只重定位到槽位矩形 → 动画不随 DOM 重建重启（修复逐步骤卡顿/抽搐）。 */
const SMOKE_PUFFS = 12;
function renderSmokeOverlay(): HTMLElement {
  const overlay = el('div', 'smoke-overlay');
  for (let i = 0; i < SMOKE_PUFFS; i++) {
    const puff = el('div', 'smoke-puff');
    puff.style.animationDelay = `${i * 0.5}s`;
    overlay.appendChild(puff);
  }
  return overlay;
}

/** 常驻黑烟覆盖层注册表：key `${player}-${line}` → 已挂到 body 的 overlay（跨重渲染存活）。
 *  仅在 renderBoard 末尾调用：条件 active 时创建/复用 overlay 并重定位到当前槽位矩形，
 *  inactive 时移除并注销（条件消失后烟雾随之消失）。
 *  （导出供 main.ts 的 scroll/resize 监听复用——fixed 层只在渲染时定位，渲染之间的
 *  滚动/缩放会让它们停在陈旧视口坐标。） */
const smokeOverlays = new Map<string, HTMLElement>();
export function syncSmokeOverlays(s: GameState): void {
  const activeKeys = new Set<string>();
  for (const line of [0, 1, 2] as Line[]) {
    const active = lineTopCommandActive(s, line, 'darkness-2');
    if (!active) continue;
    for (const player of [0, 1] as PlayerId[]) {
      const key = `${player}-${line}`;
      activeKeys.add(key);
      const slot = document.querySelector<HTMLElement>(
        `.stack-slot[data-player="${player}"][data-line="${line}"]`
      );
      if (!slot) continue; // 槽位不在 DOM（不应发生）→ 交给下方清理分支移除旧 overlay
      let overlay = smokeOverlays.get(key);
      if (!overlay) {
        overlay = renderSmokeOverlay();
        overlay.dataset.smokeKey = key;
        smokeOverlays.set(key, overlay);
        document.body.appendChild(overlay);
      }
      const r = slot.getBoundingClientRect();
      overlay.style.left = `${r.left}px`;
      overlay.style.top = `${r.top}px`;
      overlay.style.width = `${r.width}px`;
      overlay.style.height = `${r.height}px`;
    }
  }
  for (const [key, overlay] of smokeOverlays) {
    if (!activeKeys.has(key)) {
      overlay.remove();
      smokeOverlays.delete(key);
    }
  }
}

/* ===== 常驻能量扫描线（R16）：修复扫描在步骤切换/效果结算时重启的卡顿 =====
 * 旧实现 .battery-shell::after 的 CSS 扫描动画随电池元素每次重渲染（renderApp 全量
 * 重建棋盘 DOM）而重启——与已编译环/黑烟同类的"一卡一卡"问题。
 * 采用与 syncSmokeOverlays 相同的注册表模式：body 级 fixed 扫描层（.scan-overlay 内
 * .scan-line）按 key `${player}-${line}` 创建一次、跨重渲染存活，每帧渲染只把层盒
 * 重定位到 .battery-shell 矩形（层节点从不 detach → CSS 动画不重启）。
 * full/burst 态沿旧行为关闭扫描（外壳应力裂纹高光接管），overlay 移除；电池元素
 * 缺失时同样移除并注销。 */
const scanOverlays = new Map<string, HTMLElement>();

function renderScanOverlay(): HTMLElement {
  const overlay = el('div', 'scan-overlay');
  overlay.appendChild(el('div', 'scan-line'));
  return overlay;
}

export function syncScanOverlays(s: GameState): void {
  const activeKeys = new Set<string>();
  for (const line of [0, 1, 2] as Line[]) {
    for (const player of [0, 1] as PlayerId[]) {
      const key = `${player}-${line}`;
      // 旧行为：扫描流光仅 stable/bulge 播放；full/burst 由外壳裂纹高光接管（animation:none）
      const state = batteryState(getLineValue(s, player, line));
      if (state === 'full' || state === 'burst') {
        const gone = scanOverlays.get(key);
        if (gone) {
          gone.remove();
          scanOverlays.delete(key);
        }
        continue;
      }
      const shell = document.querySelector<HTMLElement>(
        `.stack-slot[data-player="${player}"][data-line="${line}"] .battery-shell`
      );
      if (!shell) continue; // 电池不在 DOM（不应发生）→ 交给下方清理分支移除旧 overlay
      activeKeys.add(key);
      let overlay = scanOverlays.get(key);
      if (!overlay) {
        overlay = renderScanOverlay();
        overlay.dataset.scanKey = key;
        scanOverlays.set(key, overlay);
        document.body.appendChild(overlay);
      }
      const r = shell.getBoundingClientRect();
      overlay.style.left = `${r.left}px`;
      overlay.style.top = `${r.top}px`;
      overlay.style.width = `${r.width}px`;
      overlay.style.height = `${r.height}px`;
    }
  }
  for (const [key, overlay] of scanOverlays) {
    if (!activeKeys.has(key)) {
      overlay.remove();
      scanOverlays.delete(key);
    }
  }
}

/* ===== 常驻念能粒子（FX-3）：psychic-1 顶命令 → 被限制方三条链路粒子闪烁 =====
 * opponentMustPlayFaceDown(s, player) 为真（该 player 的对手场上有正面 psychic-1 →
 * player 只能反面打出）期间，被限制方 player 的三条链路链路上持续出现小型紫粉粒子
 * 微微闪烁后消失（循环）。与 syncSmokeOverlays 同模式：body 级 fixed 粒子层
 * （.fx-psychic-line 内 7 颗 .fx-psychic-line-particle）按 key `${player}-${line}`
 * 注册表 get-or-create、每帧渲染重定位到 .stack-slot 矩形；条件不满足移除并注销。
 * 层节点跨重渲染存活（从不 detach/reattach）→ CSS 动画不重启。 */
const psychicParticles = new Map<string, HTMLElement>();
const PSYCHIC_LINE_PARTICLE_COUNT = 7;

function renderPsychicParticlesLayer(): HTMLElement {
  const layer = el('div', 'fx-psychic-line');
  for (let i = 0; i < PSYCHIC_LINE_PARTICLE_COUNT; i++) {
    const p = el('i', 'fx-psychic-line-particle');
    p.style.animationDelay = `${-i * 0.22}s`; // 相位错开（负延迟 → 任意时刻多颗在闪）
    layer.appendChild(p);
  }
  return layer;
}

export function syncPsychicParticles(s: GameState): void {
  const activeKeys = new Set<string>();
  for (const player of [0, 1] as PlayerId[]) {
    if (!opponentMustPlayFaceDown(s, player)) continue; // 该玩家未被限制（其对手无 psychic-1）
    for (const line of [0, 1, 2] as Line[]) {
      const key = `${player}-${line}`;
      activeKeys.add(key);
      const slot = document.querySelector<HTMLElement>(
        `.stack-slot[data-player="${player}"][data-line="${line}"]`
      );
      if (!slot) continue; // 槽位不在 DOM（不应发生）→ 交给下方清理分支移除旧层
      let layer = psychicParticles.get(key);
      if (!layer) {
        layer = renderPsychicParticlesLayer();
        layer.dataset.psychicKey = key;
        psychicParticles.set(key, layer);
        document.body.appendChild(layer);
      }
      const r = slot.getBoundingClientRect();
      layer.style.left = `${r.left}px`;
      layer.style.top = `${r.top}px`;
      layer.style.width = `${r.width}px`;
      layer.style.height = `${r.height}px`;
    }
  }
  for (const [key, layer] of psychicParticles) {
    if (!activeKeys.has(key)) {
      layer.remove();
      psychicParticles.delete(key);
    }
  }
}

/* ===== 常驻瘟疫浓雾（FX-3）：plague-0 底命令 → 被限制方该线深绿浓雾循环 =====
 * lineBlocksOpponent(s, line, player) 为真（该 player 的对手该线链路顶卡为未覆盖
 * 正面 plague-0 → player 此列禁打）期间，被限制方 player 的该线链路持续渐现渐消
 * 深绿浓雾（循环）。key 用 `${player}-${line}`（双方可在同一线互为限制 → key=line
 * 会撞，见 FX-3 report）；其余与 syncPsychicParticles 同模式。 */
const plagueMists = new Map<string, HTMLElement>();
const PLAGUE_LINE_BLOB_COUNT = 6;

function renderPlagueMistLayer(): HTMLElement {
  const layer = el('div', 'fx-plague-line-mist');
  for (let i = 0; i < PLAGUE_LINE_BLOB_COUNT; i++) {
    const blob = el('i', 'fx-plague-line-blob');
    blob.style.animationDelay = `${-i * 0.5}s`; // 相位错开（负延迟）
    layer.appendChild(blob);
  }
  return layer;
}

export function syncPlagueMists(s: GameState): void {
  const activeKeys = new Set<string>();
  for (const line of [0, 1, 2] as Line[]) {
    for (const player of [0, 1] as PlayerId[]) {
      if (!lineBlocksOpponent(s, line, player)) continue; // 该玩家此线未被禁（对手该线无 plague-0）
      const key = `${player}-${line}`;
      activeKeys.add(key);
      const slot = document.querySelector<HTMLElement>(
        `.stack-slot[data-player="${player}"][data-line="${line}"]`
      );
      if (!slot) continue;
      let layer = plagueMists.get(key);
      if (!layer) {
        layer = renderPlagueMistLayer();
        layer.dataset.plagueKey = key;
        plagueMists.set(key, layer);
        document.body.appendChild(layer);
      }
      const r = slot.getBoundingClientRect();
      layer.style.left = `${r.left}px`;
      layer.style.top = `${r.top}px`;
      layer.style.width = `${r.width}px`;
      layer.style.height = `${r.height}px`;
    }
  }
  for (const [key, layer] of plagueMists) {
    if (!activeKeys.has(key)) {
      layer.remove();
      plagueMists.delete(key);
    }
  }
}

/* ===== FX-5：常驻冷漠灰雾（apathy-0 顶命令 → 该线双方链路浓雾循环） =====
 * lineTopCommandActive(s, line, 'apathy-0') 为真（任一玩家该线链路有正面 apathy-0——
 * 顶命令被盖仍生效，口径同 darkness-2 黑烟）期间，该线【双方】链路槽持续渐现渐消灰色
 * 浓雾（循环）。key 用 `${player}-${line}`（与 smokeOverlays/plagueMists 同构——apathy-0
 * 是线级判定、双侧同时生效，key=line 不够分槽；按槽位分键可复用同一 get-or-create/
 * 重定位/清理框架）。其余与 syncPlagueMists 同模式：body 级 fixed 层跨重渲染存活。 */
const apathyMists = new Map<string, HTMLElement>();
const APATHY_LINE_BLOB_COUNT = 6;

function renderApathyMistLayer(): HTMLElement {
  const layer = el('div', 'fx-apathy-line-mist');
  for (let i = 0; i < APATHY_LINE_BLOB_COUNT; i++) {
    const blob = el('i', 'fx-apathy-line-blob');
    blob.style.animationDelay = `${-i * 0.5}s`; // 相位错开（负延迟）
    layer.appendChild(blob);
  }
  return layer;
}

export function syncApathyMists(s: GameState): void {
  const activeKeys = new Set<string>();
  for (const line of [0, 1, 2] as Line[]) {
    if (!lineTopCommandActive(s, line, 'apathy-0')) continue;
    for (const player of [0, 1] as PlayerId[]) {
      const key = `${player}-${line}`;
      activeKeys.add(key);
      const slot = document.querySelector<HTMLElement>(
        `.stack-slot[data-player="${player}"][data-line="${line}"]`
      );
      if (!slot) continue;
      let layer = apathyMists.get(key);
      if (!layer) {
        layer = renderApathyMistLayer();
        layer.dataset.apathyKey = key;
        apathyMists.set(key, layer);
        document.body.appendChild(layer);
      }
      const r = slot.getBoundingClientRect();
      layer.style.left = `${r.left}px`;
      layer.style.top = `${r.top}px`;
      layer.style.width = `${r.width}px`;
      layer.style.height = `${r.height}px`;
    }
  }
  for (const [key, layer] of apathyMists) {
    if (!activeKeys.has(key)) {
      layer.remove();
      apathyMists.delete(key);
    }
  }
}

/* ===== FX-R3：常驻冷漠2 马赛克（apathy-2 顶「无效化此列所有牌的中部命令」→ 该线双方
 * 链路槽时不时冒出像素马赛克） =====
 * lineMiddleCommandsNullified(s, line) 为真（任一玩家该线链路顶卡为正面 apathy-2——顶命令
 * 被盖仍生效，口径同 restrictions 与场上卡 .apathy-filter 灰度滤镜）期间，该线【双方】
 * 链路槽铺 body 级马赛克层：多个小方格色块（.fx-apathy-mosaic-tile）随机出现/消失循环
 * （steps 阶跃闪烁 + JS 负延迟 stagger → 各格不同相位、随时都有几格亮起，读作"像素化
 * 干扰"）。key 用 `${player}-${line}`（与 apathyMists 同构——apathy-2 是线级判定、双侧
 * 同时生效，按槽分键可复用同一 get-or-create/重定位/清理框架）。其余与 syncApathyMists
 * 同模式：body 级 fixed 层跨重渲染存活、每帧渲染只重定位到槽位矩形。 */
const apathyMosaics = new Map<string, HTMLElement>();
const APATHY_MOSAIC_TILE_COUNT = 8; // 每槽马赛克小方格数
const APATHY_MOSAIC_CYCLE_MS = 3200; // 单格出现/消失循环周期（stagger 基准）

function renderApathyMosaicLayer(): HTMLElement {
  const layer = el('div', 'fx-apathy-mosaic');
  for (let i = 0; i < APATHY_MOSAIC_TILE_COUNT; i++) {
    const tile = el('i', 'fx-apathy-mosaic-tile');
    // 相位错开（负延迟）+ 周期轻微抖动：各格亮起时刻互不重叠 → 随时有几格在闪
    tile.style.animationDelay = `${-((i * 137) % 100) / 100 * (APATHY_MOSAIC_CYCLE_MS / 1000)}s`;
    tile.style.animationDuration = `${(APATHY_MOSAIC_CYCLE_MS / 1000 + ((i * 37) % 5) * 0.12).toFixed(2)}s`;
    layer.appendChild(tile);
  }
  return layer;
}

export function syncApathyMosaics(s: GameState): void {
  const activeKeys = new Set<string>();
  for (const line of [0, 1, 2] as Line[]) {
    if (!lineMiddleCommandsNullified(s, line)) continue;
    for (const player of [0, 1] as PlayerId[]) {
      const key = `${player}-${line}`;
      activeKeys.add(key);
      const slot = document.querySelector<HTMLElement>(
        `.stack-slot[data-player="${player}"][data-line="${line}"]`
      );
      if (!slot) continue;
      let layer = apathyMosaics.get(key);
      if (!layer) {
        layer = renderApathyMosaicLayer();
        layer.dataset.apathyMosaicKey = key;
        apathyMosaics.set(key, layer);
        document.body.appendChild(layer);
      }
      const r = slot.getBoundingClientRect();
      layer.style.left = `${r.left}px`;
      layer.style.top = `${r.top}px`;
      layer.style.width = `${r.width}px`;
      layer.style.height = `${r.height}px`;
    }
  }
  for (const [key, layer] of apathyMosaics) {
    if (!activeKeys.has(key)) {
      layer.remove();
      apathyMosaics.delete(key);
    }
  }
}

/* ===== FX-5：常驻灵魂-0 手牌区框光芒（spirit-0 底「跳过检查缓存」生效方） =====
 * shouldSkipCacheCheck(s, player) 为真（player 任一线【未覆盖】顶卡为正面 spirit-0——
 * 底命令仅未覆盖生效，口径同 restrictions）期间，该玩家手牌区（.hand[data-player]）
 * 外框持续亮紫/紫粉交替光芒（.fx-spirit-handglow，CSS 呼吸动画交替 紫 ↔ 紫粉；
 * renderHand 已写入 data-player 供本层定位）。key = player；与 syncSmokeOverlays 同模式：
 * body 级 fixed 层跨重渲染存活、每帧渲染只重定位到 .hand 矩形。 */
const spirit0Glows = new Map<PlayerId, HTMLElement>();

export function syncSpirit0Glows(s: GameState): void {
  const activePlayers = new Set<PlayerId>();
  for (const player of [0, 1] as PlayerId[]) {
    if (!shouldSkipCacheCheck(s, player)) continue;
    const hand = document.querySelector<HTMLElement>(`.hand[data-player="${player}"]`);
    if (!hand) continue;
    activePlayers.add(player);
    let glow = spirit0Glows.get(player);
    if (!glow) {
      glow = el('div', 'fx-spirit-handglow');
      glow.dataset.spirit0Key = String(player);
      spirit0Glows.set(player, glow);
      document.body.appendChild(glow);
    }
    const r = hand.getBoundingClientRect();
    glow.style.left = `${r.left}px`;
    glow.style.top = `${r.top}px`;
    glow.style.width = `${r.width}px`;
    glow.style.height = `${r.height}px`;
  }
  for (const [player, glow] of spirit0Glows) {
    if (!activePlayers.has(player)) {
      glow.remove();
      spirit0Glows.delete(player);
    }
  }
}

/* ===== FX-5：常驻灵魂-1 手牌卡边框护角（spirit-1 顶「你可以在任意列打出牌」生效方） =====
 * canPlayFaceUpAnywhere(s, player) 为真期间，该玩家【所有手牌】边框亮紫/紫粉交替光芒
 * + 四角加厚紫色护边（.fx-spirit-handcard 框光 + 4 个 .fx-spirit-corner tl/tr/bl/br）。
 * key = 手牌卡 uid；sync 时只保留当前手牌 uid 集合——手牌卡离开手牌区（弃/打/回）后
 * 该 uid 层移除；uid 仍活跃但节点不在 DOM（超过 15 张显示上限被隐藏）同样移除层。 */
const spirit1Cards = new Map<string, HTMLElement>();

function renderSpirit1CardLayer(): HTMLElement {
  const layer = el('div', 'fx-spirit-handcard');
  for (const pos of ['tl', 'tr', 'bl', 'br'] as const) {
    layer.appendChild(el('i', `fx-spirit-corner ${pos}`));
  }
  return layer;
}

export function syncSpirit1Cards(s: GameState): void {
  const activeUids = new Set<string>();
  for (const player of [0, 1] as PlayerId[]) {
    if (!canPlayFaceUpAnywhere(s, player)) continue;
    for (const card of s.players[player].hand) {
      activeUids.add(card.uid);
      const node = document.querySelector<HTMLElement>(
        `.hand[data-player="${player}"] .card[data-uid="${card.uid}"]`
      );
      if (!node) {
        const stale = spirit1Cards.get(card.uid);
        if (stale) {
          stale.remove();
          spirit1Cards.delete(card.uid);
        }
        continue;
      }
      let layer = spirit1Cards.get(card.uid);
      if (!layer) {
        layer = renderSpirit1CardLayer();
        layer.dataset.spirit1Key = card.uid;
        spirit1Cards.set(card.uid, layer);
        document.body.appendChild(layer);
      }
      const r = node.getBoundingClientRect();
      layer.style.left = `${r.left}px`;
      layer.style.top = `${r.top}px`;
      layer.style.width = `${r.width}px`;
      layer.style.height = `${r.height}px`;
    }
  }
  for (const [uid, layer] of spirit1Cards) {
    if (!activeUids.has(uid)) {
      layer.remove();
      spirit1Cards.delete(uid);
    }
  }
}

/* ===== FX-6：金属协议常驻特效（metal-0 能量槽金属边框 / metal-2 链路铁板+斜光 / metal-6 手牌 man 渐现） =====
 * 与 FX-3/FX-5 同注册表模式：body 级 fixed 层跨重渲染存活、每帧渲染只重定位到目标矩形
 * （节点从不 detach/reattach → CSS 动画不重启）；条件消失 → 移除并注销；resetUiState 清表。
 * - syncMetal0Glows（metal-0 顶命令「对手此列的总分减2」）：该线有正面 metal-0 时，持卡方
 *   对手的【能量槽】外圈金属光泽边框。本实现无玩家级 .energy 元素——能量槽即每线 .battery
 *   （线值能量条，见 renderBattery）→ 按 (target, line) 定位对方 .battery-shell；多条线各有
 *   一槽，天然去重（一条线只建一层）。
 * - syncMetalPlates（metal-2 顶「对手不能在此列以反面打出」）：lineBlocksOpponentFaceDown
 *   为真时，**被限制方**该线链路槽铺金属铁板 + 斜长方形光芒从左到右循环扫过（用户规格
 *   「金属2 持续对手链路铁板」中「对手」= 被限制方，与卡面文本同指）。key = `${blocked}-${line}`
 *   （双方可在同一线互为 metal-2 → 同线双板，按槽分键防撞，同 FX-3 瘟疫浓雾先例）。
 * - syncMetal6Mans（metal-6 手牌）：手牌含 metal-6 → 该卡牌面循环渐现 man.png（2s 周期），
 *   key = uid；卡离开手牌（弃/打/回）→ 移除层。
 * - syncMetal1LineGlows（FX-R3，metal-1 中指令「对手下回合不能编译」）：s.compileBlocked ===
 *   player（被禁方；metal-1 打出时引擎设置、被禁玩家回合结束 end→start 转换时清除，turn.ts）
 *   → 该玩家三条链路边框常驻金属光泽呼吸（.fx-metal-lineglow）。key = `${player}-${line}`；
 *   纯状态驱动（不再走 card:drawn 一次性触发——metal-3 抽牌同协议段误触发一并消除）。 */
const metal0Glows = new Map<string, HTMLElement>();
const metalPlates = new Map<string, HTMLElement>();
const metal6Mans = new Map<string, HTMLElement>();
const metal1LineGlows = new Map<string, HTMLElement>();

function renderMetalEnergyGlow(): HTMLElement {
  return el('div', 'fx-metal-energyglow');
}

function renderMetalPlateLayer(): HTMLElement {
  const layer = el('div', 'fx-metal-plate');
  layer.appendChild(el('i', 'fx-metal-sweep'));
  return layer;
}

function renderMetal6ManLayer(): HTMLElement {
  return el('div', 'fx-metal-man');
}

/** metal-0：该线双方链路有正面 metal-0（顶命令常驻，含被盖）→ 持卡方对手该线能量条金属光泽边框 */
export function syncMetal0Glows(s: GameState): void {
  const activeKeys = new Set<string>();
  for (const line of [0, 1, 2] as Line[]) {
    if (!lineTopCommandActive(s, line, 'metal-0')) continue;
    for (const holder of [0, 1] as PlayerId[]) {
      // 谁持有正面 metal-0 → 对方（holder 的对手）该线能量条受金属压制 → 金属光泽边框
      if (!s.players[holder].stacks[line].some((c) => c.defId === 'metal-0' && c.faceUp)) continue;
      const target: PlayerId = holder === 0 ? 1 : 0;
      const key = `${target}-${line}`;
      activeKeys.add(key);
      const shell = document.querySelector<HTMLElement>(
        `.stack-slot[data-player="${target}"][data-line="${line}"] .battery-shell`
      );
      if (!shell) continue; // 电池不在 DOM（不应发生）→ 交给下方清理分支移除旧层
      let glow = metal0Glows.get(key);
      if (!glow) {
        glow = renderMetalEnergyGlow();
        glow.dataset.metal0Key = key;
        metal0Glows.set(key, glow);
        document.body.appendChild(glow);
      }
      const r = shell.getBoundingClientRect();
      // 层盒外扩 4px：金属渐变环读作「框外层一圈」而非覆盖电池本身描边
      glow.style.left = `${r.left - 4}px`;
      glow.style.top = `${r.top - 4}px`;
      glow.style.width = `${r.width + 8}px`;
      glow.style.height = `${r.height + 8}px`;
    }
  }
  for (const [key, glow] of metal0Glows) {
    if (!activeKeys.has(key)) {
      glow.remove();
      metal0Glows.delete(key);
    }
  }
}

/** metal-2：lineBlocksOpponentFaceDown(s, line, player)（player 被对手 metal-2 禁此列反面打）
 *  → **被限制方（blocked）**该线链路槽铺金属铁板 + 斜光扫过（.fx-metal-plate/.fx-metal-sweep）
 *  ——用户规格「金属2 持续对手链路铁板」中「对手」= 被限制方（与卡面文本同指；与 metal-0
 *  播对方能量槽、FX-3 瘟疫雾铺被限制方一致） */
export function syncMetalPlates(s: GameState): void {
  const activeKeys = new Set<string>();
  for (const line of [0, 1, 2] as Line[]) {
    for (const blocked of [0, 1] as PlayerId[]) {
      if (!lineBlocksOpponentFaceDown(s, line, blocked)) continue;
      const key = `${blocked}-${line}`; // 铁板铺在被限制方槽位
      activeKeys.add(key);
      const slot = document.querySelector<HTMLElement>(
        `.stack-slot[data-player="${blocked}"][data-line="${line}"]`
      );
      if (!slot) continue; // 槽位不在 DOM（不应发生）→ 交给下方清理分支移除旧层
      let layer = metalPlates.get(key);
      if (!layer) {
        layer = renderMetalPlateLayer();
        layer.dataset.metalPlateKey = key;
        metalPlates.set(key, layer);
        document.body.appendChild(layer);
      }
      const r = slot.getBoundingClientRect();
      layer.style.left = `${r.left}px`;
      layer.style.top = `${r.top}px`;
      layer.style.width = `${r.width}px`;
      layer.style.height = `${r.height}px`;
    }
  }
  for (const [key, layer] of metalPlates) {
    if (!activeKeys.has(key)) {
      layer.remove();
      metalPlates.delete(key);
    }
  }
}

/** metal-6：手牌含 metal-6 → 该卡牌面循环渐现 man.png（key = uid，定位 .hand[data-player]
 *  内 .card[data-uid]；卡离开手牌 / 超 15 张隐藏无节点 → 移除层） */
export function syncMetal6Mans(s: GameState): void {
  const activeUids = new Set<string>();
  for (const player of [0, 1] as PlayerId[]) {
    for (const card of s.players[player].hand) {
      if (card.defId !== 'metal-6') continue;
      activeUids.add(card.uid);
      const node = document.querySelector<HTMLElement>(
        `.hand[data-player="${player}"] .card[data-uid="${card.uid}"]`
      );
      if (!node) {
        const stale = metal6Mans.get(card.uid);
        if (stale) {
          stale.remove();
          metal6Mans.delete(card.uid);
        }
        continue;
      }
      let layer = metal6Mans.get(card.uid);
      if (!layer) {
        layer = renderMetal6ManLayer();
        layer.dataset.metal6Key = card.uid;
        metal6Mans.set(card.uid, layer);
        document.body.appendChild(layer);
      }
      const r = node.getBoundingClientRect();
      layer.style.left = `${r.left}px`;
      layer.style.top = `${r.top}px`;
      layer.style.width = `${r.width}px`;
      layer.style.height = `${r.height}px`;
    }
  }
  for (const [uid, layer] of metal6Mans) {
    if (!activeUids.has(uid)) {
      layer.remove();
      metal6Mans.delete(uid);
    }
  }
}

/** FX-R3 metal-1 常驻：s.compileBlocked === player（被禁编译方）→ 该玩家三条链路边框
 *  金属光泽呼吸（.fx-metal-lineglow，常驻 sheen 循环，无一次性渐隐）。key = `${player}-${line}`
 *  （compileBlocked 同时只禁一方，但按槽分键与其余金属注册表同构、防未来扩展撞键）。
 *  纯状态驱动：compileBlocked 由引擎在 metal-1 打出时设置、被禁玩家回合结束 end→start
 *  转换时清除（turn.ts）→ 特效生命周期天然跟随「封锁编译」区间；不再依赖 card:drawn
 *  一次性触发（metal-3 抽牌同协议段误触发一并消除）。 */
export function syncMetal1LineGlows(s: GameState): void {
  const activeKeys = new Set<string>();
  if (s.compileBlocked !== null) {
    const player: PlayerId = s.compileBlocked;
    for (const line of [0, 1, 2] as Line[]) {
      const key = `${player}-${line}`;
      activeKeys.add(key);
      const slot = document.querySelector<HTMLElement>(
        `.stack-slot[data-player="${player}"][data-line="${line}"]`
      );
      if (!slot) continue; // 槽位不在 DOM（不应发生）→ 交给下方清理分支移除旧层
      let glow = metal1LineGlows.get(key);
      if (!glow) {
        glow = el('div', 'fx-metal-lineglow');
        glow.dataset.metal1Key = key;
        metal1LineGlows.set(key, glow);
        document.body.appendChild(glow);
      }
      const r = slot.getBoundingClientRect();
      // 层盒外扩 5px：金属渐变环读作「链路边框外层一圈」而非覆盖槽位本身
      glow.style.left = `${r.left - 5}px`;
      glow.style.top = `${r.top - 5}px`;
      glow.style.width = `${r.width + 10}px`;
      glow.style.height = `${r.height + 10}px`;
    }
  }
  for (const [key, glow] of metal1LineGlows) {
    if (!activeKeys.has(key)) {
      glow.remove();
      metal1LineGlows.delete(key);
    }
  }
}

/* ===== 2代 mirror-0 明镜常驻：链路能量槽银白镜框 + 30% 镜纹覆盖 =====
 * mirror-0 顶（valueModifier own-stack）：持续效果生效时为其所在链路（持卡方该线）的
 * 能量槽添加一圈银白边框（无金属光泽——柔和漫射光，不用高光扫掠）+ 30% 透明度镜子纹理
 * 覆盖（mirror-0 正面在场 faceUp 即生效，含被盖——与引擎 valueModifier gate 一致：
 * faceUp && 顶命令未被区域禁用）。key = `${player}-${line}`；同 FX-6 注册表模式：body 级
 * fixed 层跨重渲染存活，渲染时按 .battery-shell 矩形重定位；条件消失 → 移除并注销；
 * resetUiState 清表。 */
const mirror0BatteryGlows = new Map<string, HTMLElement>();

/** mirror-0 顶「此链路中，对手每有1张牌，你的总阈值就加1」生效方该线能量槽银白镜框。
 *  常驻（每帧渲染调用）：持卡方（mirror-0 faceUp 在场且顶命令未被禁）所在线电池 → 层。 */
export function syncMirror0BatteryGlows(s: GameState): void {
  const activeKeys = new Set<string>();
  for (const player of [0, 1] as PlayerId[]) {
    for (const line of [0, 1, 2] as Line[]) {
      // mirror-0 顶常驻生效判定（与引擎 stackValue gate 一致）：该线持卡方链路有 faceUp mirror-0
      const has = s.players[player].stacks[line].some(
        (c) => c.defId === 'mirror-0' && c.faceUp && !cardCommandDisabled(s, c, 'top'),
      );
      if (!has) continue;
      const key = `${player}-${line}`;
      activeKeys.add(key);
      const shell = document.querySelector<HTMLElement>(
        `.stack-slot[data-player="${player}"][data-line="${line}"] .battery-shell`
      );
      if (!shell) continue; // 电池不在 DOM（不应发生）→ 交给下方清理分支移除旧层
      let glow = mirror0BatteryGlows.get(key);
      if (!glow) {
        glow = el('div', 'fx-mirror0-batteryglow');
        glow.dataset.mirror0Key = key;
        mirror0BatteryGlows.set(key, glow);
        document.body.appendChild(glow);
      }
      const r = shell.getBoundingClientRect();
      // 层盒外扩 4px：银白边框读作「能量槽外圈」而非覆盖槽位本身
      glow.style.left = `${r.left - 4}px`;
      glow.style.top = `${r.top - 4}px`;
      glow.style.width = `${r.width + 8}px`;
      glow.style.height = `${r.height + 8}px`;
    }
  }
  for (const [key, glow] of mirror0BatteryGlows) {
    if (!activeKeys.has(key)) {
      glow.remove();
      mirror0BatteryGlows.delete(key);
    }
  }
}

/* ===== 2代 clarity-0 透彻常驻：链路能量槽淡粉/淡蓝边框 + 30% 眼睛图案 =====
 * clarity-0 顶（valueModifier own-stack「此链路中，你每有1张牌，总阈值就加1」）：
 * 与 mirror-0 同 gate（faceUp 在场即生效，含被盖）；生效时其所在线能量槽外圈淡粉/淡蓝
 * 相间边框 + 中间浮现 30% 透明古埃及眼睛图案。key = `${player}-${line}`；注册表模式同
 * mirror-0（body 级 fixed 层跨重渲染存活；条件消失移除；resetUiState 清表）。 */
const clarity0BatteryGlows = new Map<string, HTMLElement>();

export function syncClarity0BatteryGlows(s: GameState): void {
  const activeKeys = new Set<string>();
  for (const player of [0, 1] as PlayerId[]) {
    for (const line of [0, 1, 2] as Line[]) {
      const has = s.players[player].stacks[line].some(
        (c) => c.defId === 'clarity-0' && c.faceUp && !cardCommandDisabled(s, c, 'top'),
      );
      if (!has) continue;
      const key = `${player}-${line}`;
      activeKeys.add(key);
      const shell = document.querySelector<HTMLElement>(
        `.stack-slot[data-player="${player}"][data-line="${line}"] .battery-shell`
      );
      if (!shell) continue;
      let glow = clarity0BatteryGlows.get(key);
      if (!glow) {
        glow = el('div', 'fx-clarity0-batteryglow');
        glow.dataset.clarity0Key = key;
        clarity0BatteryGlows.set(key, glow);
        document.body.appendChild(glow);
      }
      const r = shell.getBoundingClientRect();
      glow.style.left = `${r.left - 4}px`;
      glow.style.top = `${r.top - 4}px`;
      glow.style.width = `${r.width + 8}px`;
      glow.style.height = `${r.height + 8}px`;
    }
  }
  for (const [key, glow] of clarity0BatteryGlows) {
    if (!activeKeys.has(key)) {
      glow.remove();
      clarity0BatteryGlows.delete(key);
    }
  }
}

/* ===== 2代 ice 寒冰常驻（批2）：ice-1 对方链路冰面 / ice-4 卡框冰辉 / ice-6 牌库封冰 =====
 * 注册表模式同 FX-6（body 级 fixed 层跨重渲染存活；条件消失移除；resetUiState 清表）。
 * - ice-1 底「对手在此链路出牌后：他要弃置1张牌」（bottom，仅未覆盖顶卡生效）→ 生效期间
 *   **对手同线链路**覆盖 30% 深蓝冰面 + 间歇雪花（威慑显示；key = `${owner}-${line}`）。
 * - ice-4 底「此牌不可被翻转」（引擎 flip 守卫：faceUp 即免疫，含被盖）→ 该卡边框深蓝呼吸
 *   发光 + 卡周雪花（key = uid）。
 * - ice-6 顶「如果你有手牌，那么你不可以抽牌」（engine shouldBlockDraw：faceUp 任意位置）
 *   → 己方牌库被厚深蓝冰块封住（几乎不透明）+ 牌库周雪花（key = player）。 */
const iceLineFreezes = new Map<string, HTMLElement>(); // `${owner}-${line}` 对方线冰层
const ice4CardGlows = new Map<string, HTMLElement>();  // ice-4 uid → 卡框辉层
const ice6DeckIces = new Map<string, HTMLElement>();   // player → 牌库封冰层

function renderIceLineFreeze(): HTMLElement {
  const layer = el('div', 'fx-ice-linefreeze');
  for (let i = 0; i < 5; i++) layer.appendChild(el('i', 'fx-ice-line-snow'));
  return layer;
}

function renderIce4CardGlow(): HTMLElement {
  const layer = el('div', 'fx-ice4-cardglow');
  // 用户 2026-09-11：「寒冰4 的边框以及粒子特效需要更加明显」→ 雪花 3 → 7 片
  for (let i = 0; i < 7; i++) layer.appendChild(el('i', 'fx-ice4-snow'));
  return layer;
}

function renderIce6DeckIce(): HTMLElement {
  const layer = el('div', 'fx-ice6-deckice');
  for (let i = 0; i < 4; i++) layer.appendChild(el('i', 'fx-ice6-snow'));
  return layer;
}

export function syncIceFx(s: GameState): void {
  const activeFreezes = new Set<string>();
  const activeIce4 = new Set<string>();
  const activeIce6 = new Set<PlayerId>();
  for (const owner of [0, 1] as PlayerId[]) {
    for (const line of [0, 1, 2] as Line[]) {
      const stack = s.players[owner].stacks[line];
      const top = stack[stack.length - 1];
      // ice-1 底（仅未覆盖顶卡生效）：owner 的 ice-1 顶卡 → 对手同线链路冰面
      if (top && top.defId === 'ice-1' && top.faceUp && !cardCommandDisabled(s, top, 'bottom')) {
        const foe: PlayerId = owner === 0 ? 1 : 0;
        const key = `${owner}-${line}`;
        activeFreezes.add(key);
        const slot = document.querySelector<HTMLElement>(
          `.stack-slot[data-player="${foe}"][data-line="${line}"]`
        );
        if (slot) {
          let layer = iceLineFreezes.get(key);
          if (!layer) {
            layer = renderIceLineFreeze();
            layer.dataset.iceLineKey = key;
            iceLineFreezes.set(key, layer);
            document.body.appendChild(layer);
          }
          const r = slot.getBoundingClientRect();
          layer.style.left = `${r.left}px`;
          layer.style.top = `${r.top}px`;
          layer.style.width = `${r.width}px`;
          layer.style.height = `${r.height}px`;
        }
      }
      // ice-4 底（faceUp 即免疫，含被盖）：卡框深蓝呼吸 + 雪花
      for (const card of stack) {
        if (card.defId !== 'ice-4' || !card.faceUp) continue;
        activeIce4.add(card.uid);
        const node = document.querySelector<HTMLElement>(`[data-uid="${card.uid}"]`);
        if (!node) continue;
        let layer = ice4CardGlows.get(card.uid);
        if (!layer) {
          layer = renderIce4CardGlow();
          layer.dataset.ice4Key = card.uid;
          ice4CardGlows.set(card.uid, layer);
          document.body.appendChild(layer);
        }
        const r = node.getBoundingClientRect();
        layer.style.left = `${r.left - 6}px`;
        layer.style.top = `${r.top - 6}px`;
        layer.style.width = `${r.width + 12}px`;
        layer.style.height = `${r.height + 12}px`;
      }
    }
    // ice-6 顶（faceUp 任意位置）→ 拥有者牌库封冰
    if (s.players[owner].stacks.some((st) => st.some((c) => c.defId === 'ice-6' && c.faceUp))) {
      activeIce6.add(owner);
      const deck = document.querySelector<HTMLElement>(`.deck[data-player="${owner}"]`);
      if (deck) {
        let layer = ice6DeckIces.get(String(owner));
        if (!layer) {
          layer = renderIce6DeckIce();
          layer.dataset.ice6Key = String(owner);
          ice6DeckIces.set(String(owner), layer);
          document.body.appendChild(layer);
        }
        const r = deck.getBoundingClientRect();
        layer.style.left = `${r.left - 8}px`;
        layer.style.top = `${r.top - 8}px`;
        layer.style.width = `${r.width + 16}px`;
        layer.style.height = `${r.height + 16}px`;
      }
    }
  }
  for (const [key, layer] of iceLineFreezes) {
    if (!activeFreezes.has(key)) { layer.remove(); iceLineFreezes.delete(key); }
  }
  for (const [uid, layer] of ice4CardGlows) {
    if (!activeIce4.has(uid)) { layer.remove(); ice4CardGlows.delete(uid); }
  }
  for (const [key, layer] of ice6DeckIces) {
    if (!activeIce6.has(Number(key) as PlayerId)) { layer.remove(); ice6DeckIces.delete(key); }
  }
}

/* ===== 2代 smoke-2 迷雾顶常驻：所属链路边框浓灰发光 + 克苏鲁触手雾 =====
 * smoke-2 顶（valueModifier own-stack「此链路中，每有1张正面朝下的卡牌，总阈值就加1」，
 * faceUp 在场即生效，含被盖——引擎 stackValue gate 一致）→ 该线【持卡方】链路边框常驻
 * 浓灰发光 + 边框周围偶现大团浓雾渗出灰色章鱼触手（克苏鲁——触手缓慢扭动，CSS 动画）。
 * key = `${owner}-${line}`；注册表模式同 FX-6。 */
const smoke2LineGlows = new Map<string, HTMLElement>();

export function syncSmoke2LineGlows(s: GameState): void {
  const activeKeys = new Set<string>();
  for (const owner of [0, 1] as PlayerId[]) {
    for (const line of [0, 1, 2] as Line[]) {
      const has = s.players[owner].stacks[line].some(
        (c) => c.defId === 'smoke-2' && c.faceUp && !cardCommandDisabled(s, c, 'top'),
      );
      if (!has) continue;
      const key = `${owner}-${line}`;
      activeKeys.add(key);
      const slot = document.querySelector<HTMLElement>(
        `.stack-slot[data-player="${owner}"][data-line="${line}"]`
      );
      if (!slot) continue;
      let glow = smoke2LineGlows.get(key);
      if (!glow) {
        glow = el('div', 'fx-smoke2-lineglow');
        glow.dataset.smoke2Key = key;
        // 触手团（克苏鲁）：3 组雾团 + 5 根触手分居四条边（缓慢扭动；用户 2026-09-11
        // 反馈「触手并没有在协议边框四周出现，而是一起出现在一个位置」→ 由 CSS 定位到四边）
        const fog = el('div', 'fx-smoke2-fog');
        for (let i = 0; i < 3; i++) fog.appendChild(el('i', 'fx-smoke2-fog-blob'));
        const tent = el('div', 'fx-smoke2-tentacles');
        for (let i = 0; i < 5; i++) tent.appendChild(el('i', `fx-smoke2-tentacle t${i + 1}`));
        glow.appendChild(fog);
        glow.appendChild(tent);
        smoke2LineGlows.set(key, glow);
        document.body.appendChild(glow);
      }
      const r = slot.getBoundingClientRect();
      glow.style.left = `${r.left - 6}px`;
      glow.style.top = `${r.top - 6}px`;
      glow.style.width = `${r.width + 12}px`;
      glow.style.height = `${r.height + 12}px`;
    }
  }
  for (const [key, glow] of smoke2LineGlows) {
    if (!activeKeys.has(key)) {
      glow.remove();
      smoke2LineGlows.delete(key);
    }
  }
}

/* ===== 2代 fear-0 恐惧顶常驻：其所属玩家回合内，对手三条链路橙红闪烁 + 30% 橙红覆盖 =====
 * fear-0 顶「在你的回合内，对手无法触发中央效果」（引擎 pushMiddle 守卫，restrictions 100 行）：
 * 对手场上有 faceUp fear-0 且当前回合玩家 = fear-0 拥有者 → 拥有者的【对手】三条链路同时
 * 持续闪烁橙红边框 + 链路区 30% 橙红覆盖。key = `${foe}-${line}`（3 线全亮）；同 FX-6 注册表。 */
const fear0TriGlows = new Map<string, HTMLElement>();

export function syncFear0TriGlows(s: GameState): void {
  const activeKeys = new Set<string>();
  const owner = s.turnPlayer;
  if (owner === 0 || owner === 1) {
    // fear-0 拥有者 = 回合玩家（「在你的回合内」）；其场上有 faceUp fear-0 → 对手被禁
    const hasFear0 = s.players[owner].stacks.some((st) =>
      st.some((c) => c.defId === 'fear-0' && c.faceUp && !cardCommandDisabled(s, c, 'top')),
    );
    if (hasFear0) {
      const foe: PlayerId = owner === 0 ? 1 : 0;
      for (const line of [0, 1, 2] as Line[]) {
        const key = `${foe}-${line}`;
        activeKeys.add(key);
        const slot = document.querySelector<HTMLElement>(
          `.stack-slot[data-player="${foe}"][data-line="${line}"]`
        );
        if (!slot) continue;
        let glow = fear0TriGlows.get(key);
        if (!glow) {
          glow = el('div', 'fx-fear0-triglow');
          glow.dataset.fear0Key = key;
          fear0TriGlows.set(key, glow);
          document.body.appendChild(glow);
        }
        const r = slot.getBoundingClientRect();
        glow.style.left = `${r.left - 6}px`;
        glow.style.top = `${r.top - 6}px`;
        glow.style.width = `${r.width + 12}px`;
        glow.style.height = `${r.height + 12}px`;
      }
    }
  }
  for (const [key, glow] of fear0TriGlows) {
    if (!activeKeys.has(key)) {
      glow.remove();
      fear0TriGlows.delete(key);
    }
  }
}

/* ===== 2代 war 战争常驻：war-0~3 被动在场双剑虚影 + 卡框赤红发光 =====
 * war-0/1/2/3 faceUp 未覆盖顶卡（被动效果生效前提——after-* 底指令仅顶卡触发；war-0 顶
 * after-refresh top:true 被盖仍触发——统一按 faceUp 未覆盖顶卡显示，被盖不亮简化）→
 * 卡上方浮现两把交叉暗红铁剑虚影持续碰撞摩擦（CSS 双剑碰撞）+ 碰撞处迸赤红火星 +
 * 卡框赤红呼吸发光。key = uid（卡离开/被盖移除）。同 FX-6 注册表模式。 */
const warBlades = new Map<string, HTMLElement>();

/** 战争铁剑（横向，剑尖朝右）——用户 2026-09-11：「铁剑的形状和颜色太丑了，整的跟个蜡烛一样」
 *  → 由单条矩形（::before/::after）改为分部件暗红铁剑：剑身（锥形剑尖 + 中央血槽 + 磨光边）
 *  + 十字护手 + 缠绕握柄 + 圆剑柄头。部件按 em 定尺，容器 font-size 决定整体大小
 *  （卡牌常驻 FX 与已编译层共用同一套部件）。 */
function buildWarSword(cls: string): HTMLElement {
  const sword = el('div', cls);
  const blade = el('i', 'war-sword-blade');
  blade.appendChild(el('i', 'war-sword-fuller'));
  sword.appendChild(el('i', 'war-sword-pommel'));
  sword.appendChild(el('i', 'war-sword-grip'));
  const guard = el('i', 'war-sword-guard');
  guard.appendChild(el('i', 'war-sword-guard-tip t'));
  guard.appendChild(el('i', 'war-sword-guard-tip b'));
  sword.appendChild(guard);
  sword.appendChild(blade);
  return sword;
}

function renderWarBladeLayer(): HTMLElement {
  const layer = el('div', 'fx-war-blade');
  const swordL = buildWarSword('fx-war-sword l');
  const swordR = buildWarSword('fx-war-sword r');
  layer.appendChild(swordL);
  layer.appendChild(swordR);
  // 碰撞火花（小橙红星点向四周径向飞溅，CSS 循环）
  const SPARKS: [number, number][] = [[14, -16], [-12, -14], [16, 12], [-15, 14]];
  for (let i = 0; i < SPARKS.length; i++) {
    const sp = el('i', 'fx-war-collide-spark');
    sp.style.setProperty('--fx-sp-dx', `${SPARKS[i][0]}px`);
    sp.style.setProperty('--fx-sp-dy', `${SPARKS[i][1]}px`);
    layer.appendChild(sp);
  }
  return layer;
}

export function syncWarBlades(s: GameState): void {
  const activeUids = new Set<string>();
  for (const owner of [0, 1] as PlayerId[]) {
    for (const line of [0, 1, 2] as Line[]) {
      const stack = s.players[owner].stacks[line];
      const top = stack[stack.length - 1];
      if (!top || !top.faceUp) continue;
      if (!['war-0', 'war-1', 'war-2', 'war-3'].includes(top.defId)) continue;
      activeUids.add(top.uid);
      const node = document.querySelector<HTMLElement>(`[data-uid="${top.uid}"]`);
      if (!node) continue;
      let layer = warBlades.get(top.uid);
      if (!layer) {
        layer = renderWarBladeLayer();
        layer.dataset.warBladeKey = top.uid;
        warBlades.set(top.uid, layer);
        document.body.appendChild(layer);
      }
      const r = node.getBoundingClientRect();
      layer.style.left = `${r.left - 6}px`;
      layer.style.top = `${r.top - 6}px`;
      layer.style.width = `${r.width + 12}px`;
      layer.style.height = `${r.height + 12}px`;
    }
  }
  for (const [uid, layer] of warBlades) {
    if (!activeUids.has(uid)) {
      layer.remove();
      warBlades.delete(uid);
    }
  }
}

/* ===== FX-5：check-cache 锁链（spirit-0 跳过检查缓存，一次性步骤触发） =====
 * 触发：s.step === 'check-cache' 且 shouldSkipCacheCheck(s, player)（实际只有回合玩家
 * 会停在 check-cache——runAutoAdvance 在该玩家应跳过时自动 advance）→ 以该玩家手牌区
 * 边框为起点、朝手牌区中央延伸 20 条亮紫锁链（.fx-spirit-chains：body 级 fixed 层 +
 * SVG 椭圆环链：每条链沿线段方向排布多个小椭圆环、相邻环垂直交错相扣 = ⛓️ 样式）。
 * 实现要点（模块级 prevStep 跟踪步骤转换）：
 * - 步骤从非 check-cache → check-cache（且条件成立）→ 生成锁链层（一次性，不随重渲染重建）；
 * - 步骤离开 check-cache → 锁链层加 .fx-spirit-chains-out（1s 缩回消散：向中心微缩 + 淡出），
 *   1s 后移除（边框恢复为常驻光芒——spirit0Glows 若仍生效继续亮）；
 * - 生成（buildChainLayer）：上/下边各 10 条、起点/终点各在 10 个等分段内随机（起点集合与
 *   终点集合互不重叠——用户规格「起点与终点互不重叠」）+ 段内偏移保证基本倾斜；
 *   20 条链都穿越手牌区中央，线段交叉是几何必然，不禁止；
 * - FX-R2 滚动跟随：生成时在层上记录 data-chain-player（手牌区选择器），
 *   syncChainLayerPosition 按它重新查询手牌区 rect 更新层盒（幂等，层不存在跳过）。 */
const CHAIN_COUNT = 20;
const CHAIN_LINK_W = 18;     // 椭圆环长轴（沿链方向），环环相扣参数集中在此微调
const CHAIN_LINK_H = 11;     // 椭圆环短轴（垂直方向）
const CHAIN_LINK_GAP = 9;    // 相邻环中心间距 ≈ 环长的一半 → 视觉相扣
const CHAIN_LINK_OFFSET = 4; // 相邻环垂直交错量（模拟「扣在一起」）
const CHAIN_RETRACT_MS = 1000; // 离开 check-cache 后锁链缩回消散时长
let prevStep: Step | null = null;
let chainLayer: HTMLElement | null = null;

/** 沿线段 (x1,y1)→(x2,y2) 排布环环相扣的小椭圆环（⛓️ 样式）：
 *  - 环心沿线等距均布（间距 CHAIN_LINK_GAP），每环旋转到线段角度；
 *  - 相邻环沿线段垂直方向交替错位 CHAIN_LINK_OFFSET → 读作「扣在一起」；
 *  - 环为细椭圆 stroke 描边（CSS .fx-spirit-chains-svg ellipse），紫调。 */
function appendChainLinks(
  svg: SVGSVGElement,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): void {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  if (len < 1) return;
  const ang = (Math.atan2(dy, dx) * 180) / Math.PI; // 线段角度（度）
  const nx = -dy / len; // 线段垂直单位向量（错位方向）
  const ny = dx / len;
  const rx = CHAIN_LINK_W / 2;
  const ry = CHAIN_LINK_H / 2;
  const count = Math.max(1, Math.floor(len / CHAIN_LINK_GAP));
  const tStep = len / count;
  for (let i = 0; i < count; i++) {
    const t = i * tStep + tStep / 2; // 环心沿线均布（首尾留半格）
    const cx = x1 + (dx / len) * t;
    const cy = y1 + (dy / len) * t;
    const off = (i % 2 === 0 ? 1 : -1) * CHAIN_LINK_OFFSET; // 相邻环上下交错
    const ox = (cx + nx * off).toFixed(1);
    const oy = (cy + ny * off).toFixed(1);
    const link = document.createElementNS('http://www.w3.org/2000/svg', 'ellipse');
    link.setAttribute('cx', ox);
    link.setAttribute('cy', oy);
    link.setAttribute('rx', rx.toFixed(1));
    link.setAttribute('ry', ry.toFixed(1));
    link.setAttribute('transform', `rotate(${ang.toFixed(1)} ${ox} ${oy})`);
    svg.appendChild(link);
  }
}

/** 构建 20 条锁链层（SVG，viewBox = 手牌区 rect；layer.dataset.chainPlayer 记录目标
 *  手牌区选择器供滚动/缩放重定位）。
 *  用户规格「锁链起点与终点互不重叠、基本倾斜」：
 *  - 上/下边各 10 条；起点边 10 个等分段、每段内随机取起点 → 起点集合互不重叠；
 *  - 终点在相对边对应段内随机 + 段内偏移保证 |Δx| ≥ 最小倾斜 → 终点集合互不重叠；
 *  - 20 条链都穿越手牌区中央，线段交叉是几何必然（视觉为散布锁链网），不禁止交叉。 */
function buildChainLayer(rect: DOMRect, player: PlayerId): HTMLElement {
  const layer = el('div', 'fx-spirit-chains');
  layer.dataset.chainPlayer = String(player); // 滚动/缩放跟随：按此重新查询手牌区 rect
  layer.style.left = `${rect.left}px`;
  layer.style.top = `${rect.top}px`;
  layer.style.width = `${rect.width}px`;
  layer.style.height = `${rect.height}px`;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'fx-spirit-chains-svg');
  svg.setAttribute('width', String(rect.width));
  svg.setAttribute('height', String(rect.height));
  svg.setAttribute('viewBox', `0 0 ${rect.width} ${rect.height}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  const W = rect.width;
  const H = rect.height;
  const pad = 10;
  const half = CHAIN_COUNT / 2; // 上/下边各 10 条
  const segW = Math.max(1, (W - pad * 2) / half);
  const minTilt = Math.min(12, segW * 0.3); // 基本倾斜（窄手牌区退化为段内最小偏移）
  for (let i = 0; i < half; i++) {
    for (const fromTop of [true, false]) {
      const segStart = pad + i * segW;
      // 段内取起点（留 15% 边距防贴段界重叠）
      const x1 = segStart + Math.random() * segW * 0.7;
      // 终点：相对边同段内随机，|Δx| ≥ minTilt（不足则段内重试）
      let x2 = 0;
      for (let t = 0; t < 6; t++) {
        x2 = segStart + Math.random() * segW * 0.7;
        if (Math.abs(x2 - x1) >= minTilt) break;
      }
      const y1 = fromTop ? 3 : H - 3;
      const y2 = fromTop ? H - 3 : 3;
      appendChainLinks(svg, x1, y1, x2, y2);
    }
  }
  layer.appendChild(svg);
  return layer;
}

/** FX-R2：锁链层滚动/缩放跟随。锁链是一次性层（check-cache 生成后不随重渲染重建），
 *  滚动/缩放会让它停在陈旧视口坐标；按生成时记录的 data-chain-player 重新查询
 *  `.hand[data-player]` 的 rect 更新层盒（left/top/width/height）。幂等且廉价：
 *  层不存在 / 未记录 player / 手牌区不在 DOM（如草案阶段）时直接跳过；SVG 拉伸由
 *  .fx-spirit-chains-svg width/height:100% + preserveAspectRatio=none 承接（viewBox
 *  仍是生成时的手牌区矩形，重定位后整层跟随新矩形）。 */
export function syncChainLayerPosition(): void {
  if (!chainLayer) return;
  const player = chainLayer.dataset.chainPlayer;
  if (player === undefined) return;
  const hand = document.querySelector<HTMLElement>(`.hand[data-player="${player}"]`);
  if (!hand) return;
  const rect = hand.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return;
  chainLayer.style.left = `${rect.left}px`;
  chainLayer.style.top = `${rect.top}px`;
  chainLayer.style.width = `${rect.width}px`;
  chainLayer.style.height = `${rect.height}px`;
}

/** check-cache 锁链步骤转换驱动：在 renderApp 每次渲染后调用（draft 阶段只记录不播）。
 *  模块级 prevStep 检测转换：进入 check-cache（且 spirit-0 生效）→ 生成锁链层；
 *  离开 check-cache → 锁链缩回消散 + 1s 后移除（无论条件此刻是否仍成立）。
 *  只作用于回合玩家：check-cache 步骤只检查回合玩家手牌（引擎 game.ts 口径），
 *  非回合玩家的 spirit-0 与此步骤无关（避免双侧同持 spirit-0 时重复/孤儿层）。 */
export function syncCheckCacheChains(s: GameState): void {
  if (s.step === prevStep) return;
  const entering = s.step === 'check-cache';
  const leaving = prevStep === 'check-cache' && s.step !== 'check-cache';
  prevStep = s.step;
  if (s.phase === 'draft') return; // 草案无手牌区 → 只记录转换不播锁链
  if (entering) {
    const player = s.turnPlayer;
    if (!shouldSkipCacheCheck(s, player)) return;
    const hand = document.querySelector<HTMLElement>(`.hand[data-player="${player}"]`);
    if (!hand) return;
    const rect = hand.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const layer = buildChainLayer(rect, player);
    chainLayer = layer;
    document.body.appendChild(layer);
    // 渐现（下一帧加类，保证初始 opacity:0 已被绘制）
    requestAnimationFrame(() => {
      if (chainLayer === layer) layer.classList.add('fx-spirit-chains-in');
    });
  } else if (leaving && chainLayer) {
    const layer = chainLayer;
    chainLayer = null;
    layer.classList.add('fx-spirit-chains-out');
    window.setTimeout(() => layer.remove(), CHAIN_RETRACT_MS + 120);
  }
}

/** R12：每帧渲染把 body 级持久 FX 层重定位到对应 holder 矩形（层节点从不移动，只改
 *  坐标 left/top/width/height）：
 *  - 层已由 buildCompiledFx 在创建时挂到 document.body（position:fixed）→ 始终
 *    connected，CSS 动画永不重启；重定位只改几何属性，不影响动画相位。
 *  - 与 round6 黑烟 overlay（syncSmokeOverlays）同模式：在 renderBoard 末尾、DOM 已
 *    挂载后测量 holder 矩形（树构建期节点 detached，getBoundingClientRect 会读 0×0）。
 *  - 协议换位/重排（移动行）时下一帧渲染把层重定位到新 holder 矩形 → 特效跟随（层
 *    不动、只是坐标变）。
 *  - 幂等且廉价（≤6 层 + 黑烟 overlay）：导出供 main.ts 的 scroll/resize 监听复用——
 *    渲染之间的滚动/缩放会让 fixed 层停在陈旧视口坐标（尤其一局胜利后不再重渲染），
 *    监听里按当前 holder 矩形重新对齐即可。 */
export function syncCompiledFxLayers(): void {
  for (const { defId, holder } of compiledFxCells) {
    positionCompiledFxLayer(defId, holder);
  }
}

/** 把 body 级持久 FX 层（compiledFx 注册表，key=defId）重定位到 holder 矩形。层节点
 *  从不移动，只覆写坐标/尺寸（fixed）→ CSS 动画不重启。0×0（图片未加载/节点 detached）
 *  时跳过：等下一帧渲染或 img load 回调再对齐。 */
function positionCompiledFxLayer(defId: string, holder: HTMLElement): void {
  const fx = compiledFx.get(defId);
  if (!fx || !holder.isConnected) return;
  const r = holder.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return;
  fx.style.left = `${r.left}px`;
  fx.style.top = `${r.top}px`;
  fx.style.width = `${r.width}px`;
  fx.style.height = `${r.height}px`;
  // 冷漠已编译卡面克隆（故障特效载体）与真实协议图同朝向：P2 侧协议图 rot-180，
  // 克隆图若不跟随会在故障滤镜下露出方向不一致的重影（幂等：每次重定位同步一次）
  const face = fx.querySelector<HTMLElement>('.compiled-apathy-face');
  if (face) {
    const holderImg = holder.querySelector('img.protocol-img');
    if (holderImg) face.classList.toggle('rot-180', holderImg.classList.contains('rot-180'));
  }
}

/** 玩家信息条：标题（回合高亮）+ 牌库/弃牌堆/手牌计数（手牌本体在底部条带） */
function renderPlayerInfo(s: GameState, player: PlayerId, opts: { isSelf: boolean; operator?: boolean }): HTMLElement {
  const p = s.players[player];
  const active = player === s.turnPlayer;
  // 修改提示词 17：效果挂起等待该玩家操作 → 额外 operator 高亮（醒目提示操作者）
  const info = el('div', `player-info p${player + 1}${active ? ' active' : ''}${opts.isSelf ? ' self' : ''}${opts.operator ? ' operator' : ''}`);
  info.appendChild(el('div', 'area-title', `玩家 ${player + 1}${opts.operator ? '（请操作！）' : active ? '（回合中）' : ''}`));

  const meta = el('div', 'meta-row');
  meta.appendChild(el('span', 'deck-count', `牌库 ${p.deck.length}`));
  meta.appendChild(el('span', 'trash-count', `弃牌堆 ${p.trash.length}`));
  meta.appendChild(el('span', 'hand-count', `手牌 ${p.hand.length}`));
  info.appendChild(meta);

  // 弃牌堆查看按钮：P1 贴信息条最右端；P2（内容右对齐）贴最左端（CSS align-self 覆写）。
  // 点击打开弃牌堆查看遮罩（公开信息：全部正面展示）。
  const trashBtn = el('button', 'btn trash-view-btn', '查看弃牌堆');
  trashBtn.addEventListener('click', () => openTrashViewer(s, player));
  info.appendChild(trashBtn);
  return info;
}

/** 牌库区：多张背面卡层叠（厚度随剩余数），顶层中央显示剩余张数 */
function renderDeck(s: GameState, player: PlayerId): HTMLElement {
  const count = s.players[player].deck.length;
  const layers = count === 0 ? 0 : Math.min(4, Math.ceil(count / 4));
  const deck = el('div', `deck deck-${count === 0 ? 'empty' : layers}`);
  deck.dataset.player = String(player);
  if (layers > 0) {
    const stack = el('div', 'deck-stack');
    for (let i = 0; i < layers; i++) stack.appendChild(el('div', 'deck-back'));
    deck.appendChild(stack);
    deck.appendChild(el('span', 'deck-count', String(count)));
  } else {
    deck.appendChild(el('span', 'deck-count empty', '0'));
  }
  // 修改提示词 14：对局结束（gameover 复盘）→ 点击牌库展开查看剩余牌及抽取顺序
  // （牌库顶 = 下一张要抽的；自上而下展示全部卡正面）
  if (s.phase === 'gameover') {
    deck.title = '对局结束：查看牌库剩余牌及抽取顺序';
    deck.addEventListener('click', () => openDeckOrderViewer(s, player));
  }
  return deck;
}

/** 弃牌堆区（renderDeck 的镜像，ITEM 3）：层叠背面卡 + 中央计数，绝对定位链路于牌库
 *  正下方（P1/P2 各自镜像），与牌库同列（−92px 外侧列）→ 移出流式布局，不挤占手牌/
 *  刷新按钮/挡板位置。data-player + 点击打开弃牌堆查看遮罩（公开信息）。 */
function renderTrash(s: GameState, player: PlayerId): HTMLElement {
  const count = s.players[player].trash.length;
  const layers = count === 0 ? 0 : Math.min(4, Math.ceil(count / 4));
  const trash = el('div', `trash-pile p${player + 1} trash-${count === 0 ? 'empty' : layers}`);
  trash.dataset.player = String(player);
  if (layers > 0) {
    const stack = el('div', 'deck-stack');
    for (let i = 0; i < layers; i++) stack.appendChild(el('div', 'deck-back'));
    trash.appendChild(stack);
    trash.appendChild(el('span', 'trash-pile-count', String(count)));
  } else {
    trash.appendChild(el('span', 'trash-pile-count empty', '0'));
  }
  // 顶部小标签区分「牌库 / 弃牌堆」；点击打开弃牌堆查看遮罩
  trash.appendChild(el('span', 'trash-label', '弃牌堆'));
  trash.title = '查看弃牌堆';
  trash.addEventListener('click', () => openTrashViewer(s, player));
  return trash;
}

/** 刷新手牌按钮：位于手牌扇形下方（.hand-refresh-wrap 内、居中于手牌之下），
 *  仅在刷新是合法动作（refreshAction 非空）时渲染，点击派发 refresh */
function renderRefreshButton(action: LegalAction, cb: UiCallbacks): HTMLElement {
  const btn = el('button', 'shield-refresh-btn', '刷新手牌');
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    cb.onAction(action);
  });
  return btn;
}

/**
 * 手牌条：self（回合玩家）正面可点选，对手背面展示。
 * R6 扇形手牌：单行不换行（.hand 负 margin 重叠）；最多渲染 15 张，超出部分以
 * 末尾 +N 徽标提示（隐藏的牌仍在状态中，随手牌减少自动露出）。
 * R7 P2 手牌从右往左排（.hand.reversed = flex-direction: row-reverse）：
 * index 0 在最右、后续卡向左延伸；P1 保持左起（默认左对齐）。悬停第 i 张卡时，
 * 其余卡向两侧推开 12px/张（P2 为 row-reverse，镜像方向），悬停卡上浮 translateY(-24px)
 * scale(1.15) 并置顶（z-index 50）；鼠标移出手牌区时全部复位。
 * R7 选中卡（action 可打步骤）在卡上缘上方浮动 正面打入/背面打入 按钮：按钮作为
 * 卡牌子节点，指针悬停按钮时仍在卡牌子树内，hover-pop 不消失；按钮绝对定位于
 * 卡上缘之上（top:-34px）不遮卡面。监听器在每次 renderApp 重建 DOM 后重新挂接。
 */
function renderHand(
  s: GameState,
  player: PlayerId,
  opts: {
    isSelf: boolean;
    selected: string | null;
    onSelect: (uid: string) => void;
    /** 选中卡上「翻面」按钮回调（切换 selectedFaceUp 正↔背 后重渲染，手牌区即时翻转） */
    onToggleFaceUp?: () => void;
    /** 拖拽打牌：命中合法落点时派发 onAction 的回调 */
    cb: UiCallbacks;
  }
): HTMLElement {
  const reversed = player === 1; // P2 右起、向左延伸；P1 左起、向右延伸（默认左对齐）
  const hand = el('div', 'hand' + (opts.isSelf ? ' self' : '') + (reversed ? ' reversed' : ''));
  // FX-5：手牌区定位标识（spirit-0 手牌区框光芒 / check-cache 锁链按 .hand[data-player]
  // 查询 rect——syncSpirit0Glows / syncCheckCacheChains 使用）
  hand.dataset.player = String(player);
  const cards = s.players[player].hand;
  // 点 4：手牌从左到右按数值升序显示（P1/P2 一致）。
  // 数值取 defId 后缀（'fire-3' → 3）。排序仅影响显示顺序，引擎 hand 数组不变。
  // P1 渲染升序（index 0 最左=最小）；P2 为 row-reverse（index 0 在最右），
  // 故渲染降序使视觉上最左=最小、向右递增。
  const byValue = [...cards].sort(
    (a, b) => parseInt(splitDefId(a.defId)[1], 10) - parseInt(splitDefId(b.defId)[1], 10)
  );
  const shown = (reversed ? [...byValue].reverse() : byValue).slice(0, 15);
  const nodes: HTMLElement[] = [];
  for (const card of shown) {
    const i = nodes.length;
    const isSelected = opts.isSelf && opts.selected === card.uid;
    // 手牌显示：self 手牌默认正面；若该卡被选中且当前朝向为背面（selectedFaceUp=false），
    // 立即以背面预览显示（点击「翻面」时翻转手牌区外观）。
    // secret 守卫 = 防御性安全网（控制器规则：手牌 = 已知信息，回手/抽入/夺取进手时引擎
    // 一律清 secret → 手牌卡实际恒为正面）；保留以防未来新增的手牌入口忘记解禁，杜绝
    // secret 卡在 self 手牌误渲染为背面的回归。
    const faceUp = opts.isSelf && !card.secret ? !(isSelected && !selectedFaceUp) : false;
    const node = renderCardFace({ defId: card.defId, faceUp, uid: card.uid });
    node.dataset.uid = card.uid;
    if (isSelected) node.classList.add('selected');
    // 2代 chaos-3 手牌特效：仅【正面显示】时边框紫蓝闪烁 + 偶发蓝紫雾气（背面显示不加——
    // 提示词「在手牌中以背面显示时，特效不显示」；self 手牌正面、对手手牌恒背面）
    if (card.defId === 'chaos-3' && faceUp) {
      node.classList.add('fx-chaos3-hand');
      const mist = el('div', 'fx-chaos3-mist');
      for (let i = 0; i < 3; i++) mist.appendChild(el('i', 'fx-chaos3-mist-blob'));
      node.appendChild(mist);
      // 用户 2026-09-11：手牌中的混乱3 除了边框发光，还要有四角护边（紫蓝交替闪烁）
      const corners = el('div', 'fx-chaos3-corners');
      for (const pos of ['tl', 'tr', 'bl', 'br'] as const) {
        corners.appendChild(el('i', `fx-chaos3-corner ${pos}`));
      }
      node.appendChild(corners);
    }
    if (opts.isSelf) {
      // 单击=选中、双击=放大查看（单击延迟 320ms 严格大于 300ms 双击窗口，窗口内
      // 第二次点击取消延迟的单击并打开遮罩）；faceUp 为当前显示朝向（选中且翻至背面
      // 时预览卡背，放大也显示卡背）。
      bindClickOrDouble(
        node,
        () => {
          // 选择模式下禁用手牌单击选中：候选卡点击由选择条（renderBoard）处理，
          // 普通手牌已被 CSS pointer-events:none 禁用
          if (choicePromptId !== null) return;
          opts.onSelect(card.uid);
        },
        () => openZoom(card.defId, faceUp, false, false),
        true
      );
      // 拖拽打牌：仅 self 手牌且 action 步骤绑定；未超阈值时完全交由单击/双击逻辑
      if (s.step === 'action') bindCardDrag(node, s, opts.cb, card.uid);
    } else {
      // 对手手牌（背面朝下）：单击无操作、双击放大查看卡背（需求：任意卡均可双击放大）；
      // 修改提示词 14：对局结束（gameover 复盘）→ 对手手牌双击也可翻面查看正面（peek）
      bindClickOrDouble(
        node,
        () => {},
        () => openZoom(card.defId, false, false, false, s.phase === 'gameover'),
        true
      );
    }
    // ITEM 1: 选中卡且处于 action 步骤 → 卡上缘上方浮动「翻面」按钮。
    // 按钮是卡牌子节点：悬停按钮时指针始终位于卡牌子树内，hover-pop 保持不消失
    // （复位只挂在手牌容器 mouseleave 上，穿过卡↔按钮间隙也不会触发复位）。
    // 按钮仅一个「翻面」：点击切换 selectedFaceUp（正面↔背面），不占用卡面宽度；
    // 始终居中于卡面顶部中央（.play-btns left:50% + translateX(-50%)）。
    if (isSelected && s.step === 'action' && opts.onToggleFaceUp) {
      const group = el('div', 'play-btns');
      const flip = el('button', 'btn play-btn', '翻面');
      flip.addEventListener('click', (e) => {
        e.stopPropagation();
        opts.onToggleFaceUp!();
      });
      group.appendChild(flip);
      node.appendChild(group);
    }
    hand.appendChild(node);
    nodes.push(node);
  }
  if (cards.length > 15) {
    hand.appendChild(el('div', 'hand-more-badge', `+${cards.length - 15}`));
  }
  // 揭示幽灵牌：把被揭示卡的正面复制到本玩家手牌区末尾（仅视觉提示，不参与任何
  // 手牌计数/选择/拖拽；对手回合结束后由引擎清除）。data-uid 用 ghost- 前缀避免冲突。
  // 入场动画已由主线程"揭示飞行"承接（逐张从被揭示方手牌末尾飞入），不再播 ghost-enter；
  // light 协议揭示（lightFx）的幽灵带光之辉光（.ghost-light：十字星 + 边框辉光）。
  // ITEM 8：幽灵加入扇形动态（push 进 nodes → 悬停展开/推开同样作用于幽灵），
  // 双击可放大查看被揭示卡的正面（仅查看，无单击选择/翻面/拖拽）。
  for (const ghost of s.revealedGhosts.filter((g) => g.shownTo === player)) {
    const gNode = renderCardFace({ defId: ghost.defId, faceUp: true, uid: `ghost-${ghost.id}` });
    gNode.classList.add('reveal-ghost');
    if (ghost.lightFx) gNode.classList.add('ghost-light');
    // FX-4：love 协议揭示（love-4 Case A）的幽灵 → 粉红边框辉光 + 中间爱心跳动
    // （.fx-love-ghost 边框光 + .fx-love-heart 子元素；幽灵存在期间持续，移除随 DOM 消失）
    if (ghost.fx === 'love') {
      gNode.classList.add('fx-love-ghost');
      gNode.appendChild(el('div', 'fx-love-heart'));
    }
    // 2代 透彻1 揭示幽灵（clarity fx，批2）：30% 透明古埃及眼睛 + 背后圣光
    // （.fx-clarity-ghost 圣光 + .fx-clarity-eye 眼睛图案——眼型 CSS 见 styles.css；
    //   幽灵存在期间持续，移除随 DOM 消失）
    if (ghost.fx === 'clarity') {
      gNode.classList.add('fx-clarity-ghost');
      gNode.appendChild(el('div', 'fx-clarity-eye'));
    }
    // 双击放大（直接 dblclick，不经过 bindClickOrDouble 的单击延迟——幽灵无单击动作）
    gNode.addEventListener('dblclick', () => openZoom(ghost.defId, true, false, false));
    hand.appendChild(gNode);
    nodes.push(gNode); // 加入扇形：悬停展开/复位同样作用于幽灵牌
  }
  // R8 手牌挡板：当前回合玩家可拉出/推回遮住自己的手牌。被盖住的卡不触发
  // hover-pop / 单击 / 拖拽（挡板 z-index 高于卡牌并拦截指针）。宽度按玩家持久化
  // 在 shieldWidth（模块态），重渲染后保留；仅 self（当前回合）手牌的挡板可拖，
  // 对手挡板锁定但状态保留。
  hand.appendChild(renderShield(s, player, opts.isSelf, hand));
  const total = nodes.length;
  for (let i = 0; i < total; i++) {
    const node = nodes[i];
    node.addEventListener('mouseenter', () => {
      for (let j = 0; j < total; j++) {
        const n = nodes[j];
        if (j === i) {
          // 悬停卡：仅加 .popped（CSS transform 上浮放大 + 置顶），并清掉残留的行内 transform
          n.classList.add('popped');
          n.style.transform = '';
        } else {
          n.classList.remove('popped');
          // P1 左起：j<i 在左推向左、j>i 在右推向右；P2 右起（row-reverse）镜像相反
          const dx = reversed ? (i - j) * 12 : (j - i) * 12;
          n.style.transform = `translateX(${dx}px)`;
        }
      }
    });
  }
  // 复位挂在整个手牌容器上：鼠标移出手牌区才全部复位。
  // 不能挂在单卡 mouseleave 上——卡片上浮后可能“滑出”鼠标下方触发抖动循环。
  hand.addEventListener('mouseleave', () => {
    for (const n of nodes) {
      n.classList.remove('popped');
      n.style.transform = '';
    }
  });
  // ITEM 6（fix: 翻面卡手——焦点态保持）：选中卡在渲染时就保持上浮/扇形推开。
  // 点击「翻面」后重渲染重建手牌，指针停在重建的「翻面」按钮上（无新 mouseenter），
  // 若不主动上浮会从 popped 掉回普通（每翻一次卡都"塌"一下、卡手感）。
  // 此处按选中卡索引应用与悬停完全相同的 popped + 扇形推开（.no-anim 抑制首帧过渡 →
  // 落地即保持上浮）；鼠标移出手牌区（mouseleave 全量复位）或改选其它卡（新选中卡接管）
  // 时自然复位，不会卡死在上浮态。
  const selectedIdx = nodes.findIndex((n) => n.classList.contains('selected'));
  if (selectedIdx >= 0) {
    const node = nodes[selectedIdx];
    node.classList.add('popped');
    node.style.transform = '';
    for (let j = 0; j < total; j++) {
      if (j === selectedIdx) continue;
      const n = nodes[j];
      n.classList.remove('popped');
      // 与 mouseenter 同款扇形推开：P1 左起 j<sel 推向左、j>sel 推向右；P2 镜像
      const dx = reversed ? (selectedIdx - j) * 12 : (j - selectedIdx) * 12;
      n.style.transform = `translateX(${dx}px)`;
    }
  }
  return hand;
}

/* ===== R8 手牌挡板（hand-cover shield） =====
 * 挡板从手牌外侧端拉出：P1 左缘固定、向右延伸至手牌区中线；P2 右缘固定、向左延伸至
 * 中线。宽度是 UI 模块态（shieldWidth[player]，默认 0=收起、手牌可见），重渲染后保留；
 * 拖拽手柄位于挡板内侧（移动端）边缘，拖动时直接改写行内 width 并临时关闭过渡
 * （避免拖动手感滞后），mouseup 后数值留在模块态。
 * 挡板 z-index 70 > 卡牌（pop 50）且与浮动按钮同层后置，pointer-events 默认 auto，
 * 天然拦截指针：被盖住的手牌卡不会触发 hover-pop / 单击 / 拖拽打牌。
 */
function renderShield(s: GameState, player: PlayerId, enabled: boolean, hand: HTMLElement): HTMLElement {
  const shield = el('div', 'hand-shield' + (player === 1 ? ' p2' : ' p1'));
  shield.dataset.player = String(player);
  const w = shieldWidth[player];
  shield.style.width = `${w}px`;
  if (w <= 0) shield.classList.add('retracted');
  shield.appendChild(el('div', 'shield-handle'));
  shield.appendChild(el('div', 'shield-count', `手牌 ${s.players[player].hand.length}`));
  if (enabled) {
    bindShieldDrag(shield, player, hand);
  } else {
    shield.classList.add('locked');
  }
  return shield;
}

function bindShieldDrag(shield: HTMLElement, player: PlayerId, hand: HTMLElement): void {
  // 触发范围：整个挡板可拖（含中间徽标——收起态徽标 pointer-events:none 由 CSS 处理）
  shield.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation(); // 不与卡牌单击/拖拽相互干扰
    const dir = player === 0 ? 1 : -1; // P1 向右拖加宽；P2 向左拖加宽
    // 最大宽度优先 = 挡板内缘拖到「双方协议之间的竖线」（板中心）：协议格 DOM 可得时
    // 按中心线距离计算（与手牌扇形宽度无关——小手牌也能拖满到板中心）；协议格缺失
    // （如协议界面）时回退到扇形手牌完整宽度（真实卡 + 揭示幽灵卡都参与扇形，见 ITEM 8）。
    // 两种情况都封顶 SHIELD_MAX_WIDTH（15 张扇形完整宽度 ≈1660px）：超出上限的溢出区无需遮住。
    const fanN = hand.querySelectorAll<HTMLElement>('.card').length;
    const fanW = fanN > 0 ? 130 + (fanN - 1) * 102 : 130;
    const fanMax = Math.min(Math.max(0, fanW), SHIELD_MAX_WIDTH);
    const p1Proto = document.querySelector<HTMLElement>('.lane-row [data-player="0"] .protocol');
    const p2Proto = document.querySelector<HTMLElement>('.lane-row [data-player="1"] .protocol');
    let centerX: number | null = null;
    if (p1Proto && p2Proto) {
      const r1 = p1Proto.getBoundingClientRect();
      const r2 = p2Proto.getBoundingClientRect();
      centerX = (r1.left + r2.right) / 2; // 双方协议之间的竖线
    }
    const sr = shield.getBoundingClientRect();
    const maxW =
      centerX !== null
        ? Math.min(Math.max(0, dir === 1 ? centerX - sr.left : sr.right - centerX), SHIELD_MAX_WIDTH)
        : fanMax;
    const startX = e.clientX;
    const startWidth = Math.min(Math.max(shieldWidth[player], 0), maxW);
    const apply = (w: number) => {
      shieldWidth[player] = w;
      shield.style.width = `${w}px`;
      shield.classList.toggle('retracted', w <= 0);
    };
    const onMove = (ev: MouseEvent) => {
      const delta = (ev.clientX - startX) * dir;
      apply(Math.min(maxW, Math.max(0, startWidth + delta)));
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      window.removeEventListener('blur', onUp);
      shield.classList.remove('dragging');
    };
    shield.classList.add('dragging');
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    window.addEventListener('blur', onUp);
  });
}

/**
 * 控制权滑动指示条（2026-09 规则化；R6 引入、R7 行程加长、R8 控制卡放大）：
 * 滑块位置只反映【控制组件归属】（s.control），三态离散大幅移动——
 *   中立 → 居中（50%）；玩家 1 持有 → 贴左端；玩家 2 持有 → 贴右端。
 * 归属不变时滑块【不随双方数值差距连续滑动】（旧实现按双方三线总值占比连续微调，
 * 造成"有点数差距控制权就在动"的误解——规则上控制权只在控制阶段判定/编译补满归还/
 * 卡牌效果时才易主，见 core/rules/control.ts）。
 * 归属易主经 left 0.5s 过渡大幅滑到对应端。控制条归属类（held-0/1/neutral）与位置
 * 天然一致：中立灰化居中，持有方高亮贴端。
 * 由于渲染模型每次重建 DOM，直接设置 left 不会触发 transition；因此先写入上一帧
 * 位置、下一帧再写入目标位置，让 left 0.5s 过渡真正产生滑动动画。
 */
const CONTROL_EDGE_PCT = 4; // 持有方贴端距离（左端 4% / 右端 96%，控制卡仍不出轨）
let controlSliderPos = 50;

function renderControlModule(s: GameState): HTMLElement {
  const neutral = s.control === -1;
  // 三态目标位置：中立居中；P1（左标签）贴左端；P2（右标签）贴右端
  let target = 50;
  if (s.control === 0) target = CONTROL_EDGE_PCT;
  else if (s.control === 1) target = 100 - CONTROL_EDGE_PCT;
  const ctrl = el('div', 'control-module' + (neutral ? ' neutral' : ` held-${s.control}`));
  const track = el('div', 'control-track');
  track.appendChild(el('span', 'control-track-label left', '玩家 1'));
  track.appendChild(el('span', 'control-track-label right', '玩家 2'));
  track.appendChild(el('span', 'control-center-tick'));
  const img = document.createElement('img');
  img.className = 'control-slider-img';
  img.src = '/assets/control-front.png';
  img.alt = 'control module';
  // 先落位到上一帧位置（无动画），再在下一帧过渡到目标位置
  img.style.left = `${controlSliderPos}%`;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      img.style.left = `${target}%`;
    });
  });
  controlSliderPos = target;
  track.appendChild(img);
  ctrl.appendChild(track);
  ctrl.appendChild(el('div', 'control-label', `控制权: ${neutral ? '中立' : `玩家 ${s.control + 1}`}`));
  return ctrl;
}

function renderProtocolCell(s: GameState, player: PlayerId, line: Line): HTMLElement {
  const cell = el('div', 'protocol-cell');
  // data 属性：供编译/翻面等特效按 (player, line) 定位协议元素（协议换位时随渲染重建定位）
  cell.dataset.player = String(player);
  cell.dataset.line = String(line);
  cell.appendChild(renderProtocol(s.players[player].protocols[line], player));
  return cell;
}

/**
 * R12：已编译环特效持久注册表。key = 协议 defId（每玩家 3 协议 defId 唯一；双方草案
 * 池亦不重复 —— 同一 defId 不会同时出现在两个协议格）。跨重渲染复用同一 DOM 节点：
 * 层自创建起挂在 document.body（position:fixed），每帧渲染仅按 holder 矩形重定位
 * （syncCompiledFxLayers），节点永不 detach/reattach → CSS 动画不重启（与 round6
 * 黑烟 overlay 同模式）。未编译时从本表移除（DOM 随之释放）。
 */
const compiledFx = new Map<string, HTMLElement>();

/** 本帧渲染中出现的已编译协议 (defId → holder) 对：renderProtocol 收集、renderBoard
 *  末尾（DOM 已挂载）由 syncCompiledFxLayers 统一重定位 body 级持久 FX 层。 */
const compiledFxCells: { defId: string; holder: HTMLElement }[] = [];

/** 已编译特效 JS 调度注册表（key=defId → 挂起 timer ids）：层被移除/重置（未编译分支、
 *  resetUiState）时统一清除，防止周期性序列（间隔 ≥10s 的大特效与偶发小特效）的
 *  setTimeout 在层释放后悬挂。CSS 无限动画随节点移除自然终止，无需登记。 */
const compiledFxTimers = new Map<string, Set<number>>();

/** 登记一个已编译特效 timer（触发时自删；层移除时由 clearCompiledFxTimers 统一清除） */
function fxTimer(defId: string, fn: () => void, ms: number): void {
  let set = compiledFxTimers.get(defId);
  if (!set) {
    set = new Set<number>();
    compiledFxTimers.set(defId, set);
  }
  const id = window.setTimeout(() => {
    set.delete(id);
    if (set.size === 0) compiledFxTimers.delete(defId);
    fn();
  }, ms);
  set.add(id);
}

/** 清除某 defId 的全部已编译特效挂起 timer（层移除/重置前调用） */
function clearCompiledFxTimers(defId: string): void {
  const set = compiledFxTimers.get(defId);
  if (!set) return;
  for (const id of set) window.clearTimeout(id);
  set.clear();
  compiledFxTimers.delete(defId);
}

/** 构建单个 defId 的持久 FX 层（首次编译时创建一次，此后只重定位不重建）：
 *  - fire：背光层 + 岩浆段/岩石（.compiled-fx 包裹，环与 holder 同盒）
 *  - light/darkness：各自环内层（呼吸边框/角光、雾、波浪光晕、圆烟）
 *  R12：层直接挂到 document.body（CSS position:fixed），创建后永不移动 —— 每帧渲染
 *  只由 syncCompiledFxLayers 覆写 left/top/width/height。层携带 compiled-fx-<defId>
 *  类，使 .compiled-fx-fire .lava-seg 等后代选择器继续命中（FX 不再位于 .protocol
 *  盒子树内，该类从 .protocol 上迁到层上）。
 *  背光由 `.protocol-holder::before` 伪元素改为真实元素 `.fire-backlight`（R11.3）：
 *  伪元素随 holder 每次重建会重启动画；真实元素随持久层存活 → 背光旋转也不重启。
 */
function buildCompiledFx(defId: string): HTMLElement {
  const layer = el('div', `compiled-fx compiled-fx-${defId}`);
  if (defId === 'fire') layer.appendChild(el('div', 'fire-backlight'));
  // life：深绿背光（真实元素随持久层存活，动画不重启；见 styles.css .compiled-fx-life .life-backlight）
  if (defId === 'life') layer.appendChild(el('div', 'life-backlight'));
  appendCompiledRing(layer, defId);
  // 2026-09-03：新 10 协议已编译专属特效（死/灵魂/重力/念能/瘟疫/金属/速度/爱/恨/冷漠）。
  // 全部作为持久层子节点（跨重渲染存活 → 动画不重置；层按 holder 重定位 → 跟随协议位置）。
  appendNewCompiledFx(layer, defId);
  document.body.appendChild(layer);
  return layer;
}

/** Life 已编译藤蔓（复用 Item 1 翻转藤蔓观感——粗 S 曲线、绿光描边；R15 起更短 ≤42px）：
 *  定位 div（transform-origin 0 0 = 卡框锚点，外层 transform 专用于朝向旋转，使藤蔓垂入
 *  协议卡内）+ 内层 .life-compiled-grow（一次性的缠绕生长 scaleY）+ svg .life-compiled-vine-curve
 *  （缓慢左右摇摆，负 delay 按 i 交错相位 → 各藤蔓不同时刻摇摆，不齐步）。
 *  三层结构避免 grow（scaleY）与 sway（rotate）两个 transform 动画互相覆盖。 */
function buildCompiledVine(rot: number, len: number, swayPhase: number): HTMLElement {
  const wrap = el('div', 'life-compiled-vine');
  wrap.style.transform = `rotate(${rot}deg)`;
  const grow = el('div', 'life-compiled-grow');
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', '30');
  svg.setAttribute('height', String(len));
  svg.setAttribute('viewBox', `0 0 30 ${len}`);
  svg.setAttribute('class', 'life-compiled-vine-curve');
  svg.style.animationDelay = `${-swayPhase}s`; // 单个负 delay 交错相位（svg 只有 sway 一个动画；双值列表多余值会被忽略）
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', `M7,2 C16,${len * 0.3} 24,${len * 0.62} 12,${len - 3}`);
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', '#3ddc84');
  path.setAttribute('stroke-width', '11');
  path.setAttribute('stroke-linecap', 'round');
  svg.appendChild(path);
  grow.appendChild(svg);
  wrap.appendChild(grow);
  return wrap;
}

/** Water 已编译海浪线：横向 SVG 正弦波（preserveAspectRatio none 拉伸铺满容器宽度）。
 *  流动（dashoffset）作用于 svg path，浮现/浮动作用于 .water-wave 容器。 */
function buildWaterWave(): HTMLElement {
  const wrap = el('div', 'water-wave');
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 220 24');
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('class', 'water-wave-curve');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', 'M0,12 Q13.75,0 27.5,12 T55,12 T82.5,12 T110,12 T137.5,12 T165,12 T192.5,12 T220,12');
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', 'rgba(64, 180, 255, 0.8)');
  path.setAttribute('stroke-width', '2.5');
  path.setAttribute('stroke-linecap', 'round');
  svg.appendChild(path);
  wrap.appendChild(svg);
  return wrap;
}

/**
 * 已编译协议环绕特效（基础特效骨架，JS 构建 + 纯 CSS 动画，零 mask/@property/z-index 依赖）：
 * - 岩浆段 .lava-seg（渐变小块）+ 岩石 .lava-rock（黑岩/红岩）沿边框路径（offset-path）
 *   旅行环绕——所有元素都落在卡面外侧的边框环带上，在卡面前方但不遮盖卡面。
 * 每协议配色由 .compiled-ring-<defId> 决定（fire = 岩浆黑岩/红岩）。
 */
function appendCompiledRing(box: HTMLElement, defId: string): void {
  const ring = el('div', `compiled-ring compiled-ring-${defId}`);
  // 每协议配色由 .compiled-ring-<defId> 决定（fire = 岩浆黑岩/红岩；life/water 各自专属
  // 变体在函数末尾追加——藤蔓缠绕 / 中心波纹 + 海浪线，见下方 defId === 'life'/'water' 块）。
  // 火焰（fire）专属参数：慢速岩浆流（56s/圈，CSS .compiled-fx-fire 覆写 animation-duration，
  // 速度再减半：28s → 56s）+ 岩石加密（90 岩 = 60 黑 + 30 红，2 黑 1 红交替）→ 环周被
  // 岩石基本填平（12px × 90 ≈ 1080px ≥ 环带周长 ≈1017px，轻微重叠）。红岩一半原色暗红
  // 一半亮红（rock-red ↔ rock-red-bright）、黑岩一半原色一半更深的近黑（rock-dark ↔
  // rock-dark-deep）交替挂类，边缘均匀混色。负 animation-delay 必须按实际 duration 换算
  // （-TRAVEL_S/count × i），否则元素会在环上挤成一团而非均匀分布。light/darkness 保持
  // 2.5s / 10 / 8 不变（其 .lava-seg/.lava-rock 已被 CSS 隐藏）。
  const isFire = defId === 'fire';
  const TRAVEL_S = isFire ? 56 : 2.5;
  const LAVA_COUNT = isFire ? 20 : 10;
  for (let i = 0; i < LAVA_COUNT; i++) {
    const seg = el('div', 'lava-seg');
    seg.style.animationDelay = `${(-TRAVEL_S / LAVA_COUNT) * i}s`;
    const s = 0.8 + ((i * 29) % 4) * 0.12;
    seg.style.transform = `scale(${s.toFixed(2)})`;
    ring.appendChild(seg);
  }
  const ROCK_COUNT = isFire ? 90 : 8;
  let redTurn = false; // 红岩变体交替（仅 fire）
  let darkTurn = false; // 黑岩变体交替（仅 fire）
  for (let i = 0; i < ROCK_COUNT; i++) {
    // fire：2 黑 1 红交替（i%3===0 → 红，其余黑 → 90 岩 = 60 黑 + 30 红）；
    // light/darkness：黑红交替（8 岩 = 4 黑 + 4 红）
    const isRed = isFire ? i % 3 === 0 : i % 2 !== 0;
    let cls = 'lava-rock';
    if (isRed) {
      cls += redTurn ? ' rock-red-bright' : ' rock-red';
      if (isFire) redTurn = !redTurn;
    } else {
      cls += darkTurn ? ' rock-dark-deep' : ' rock-dark';
      if (isFire) darkTurn = !darkTurn;
    }
    const rock = el('div', cls);
    rock.style.animationDelay = `${(-TRAVEL_S / ROCK_COUNT) * i - 0.15}s`;
    const s = 0.7 + ((i * 37) % 5) * 0.15;
    rock.style.transform = `scale(${s.toFixed(2)}) rotate(${i * 47}deg)`;
    // R11：fire 岩石略微上下浮动（.rock-bob 全盒占位）。wrapper 与环同盒
    // （position:absolute; inset:0）→ 岩石的 offset-path 包含块不变、旅行路径/布局不动；
    // 浮动动画只动 wrapper 的 translateY（交错负 delay），不触碰岩石自身的内联
    // transform（scale/rotate）与 ring-travel 偏移路径动画。light/darkness 岩保持直挂。
    if (isFire) {
      const bob = el('div', 'rock-bob');
      bob.style.animationDelay = `${-(i * 0.25)}s`;
      bob.appendChild(rock);
      ring.appendChild(bob);
    } else {
      ring.appendChild(rock);
    }
  }
  // light：呼吸黄/白边框 + 四角发光护边（.light-corner tl/tr/bl/br，L 形光支架，
  // 随 ring 挂 holder 四角，z 与环同层但只占角部；无旋转岩浆——.lava-seg/.lava-rock 已隐藏）
  if (defId === 'light') {
    for (const pos of ['tl', 'tr', 'bl', 'br'] as const) {
      ring.appendChild(el('div', `light-corner ${pos}`));
    }
    // 2026-09-03 用户选定 A+D+E：日芒射线环绕 + 边框内侧暖色流光带 + 偶发星芒闪耀
    // （全部为持久层内子节点 → 动画不随步骤切换重置、跟随协议位置）
    // A. 日芒：16 根金光细射线由卡中心向框外辐射（自中心起 width = 50% 层宽 + 外扩），
    //    整层缓慢旋转 + 随边框节奏柔和呼吸
    const rays = el('div', 'compiled-light-rays');
    const RAY_COUNT = 16;
    for (let i = 0; i < RAY_COUNT; i++) {
      const ray = el('div', 'compiled-light-ray');
      ray.style.transform = `rotate(${((360 / RAY_COUNT) * i).toFixed(1)}deg)`;
      rays.appendChild(ray);
    }
    box.appendChild(rays);
    // D. 边框内侧暖色流光带（金→橙→白，缓慢流动的细环，紧贴卡面内侧）
    box.appendChild(el('div', 'compiled-light-sheen'));
    // E. 偶发星芒：随机位置闪现一颗白色四芒星后消失
    const star = el('div', 'compiled-light-star');
    box.appendChild(star);
    const starHide = (): void => {
      if (!box.isConnected) return;
      star.classList.remove('in');
      star.classList.add('out');
      fxTimer(defId, starDone, 550);
    };
    const starDone = (): void => {
      if (!box.isConnected) return;
      star.classList.remove('out');
      fxTimer(defId, starShow, rnd(1600, 4200)); // 偶发：1.6-4.2s 一颗
    };
    const starShow = (): void => {
      if (!box.isConnected) return;
      const g = layerGeom(box);
      if (!g) { fxTimer(defId, starShow, 700); return; }
      const size = rnd(14, 30);
      star.style.width = `${size.toFixed(1)}px`;
      star.style.height = `${size.toFixed(1)}px`;
      star.style.marginLeft = `${(-size / 2).toFixed(1)}px`;
      star.style.marginTop = `${(-size / 2).toFixed(1)}px`;
      star.style.left = `${rnd(14, 86).toFixed(1)}%`;
      star.style.top = `${rnd(14, 84).toFixed(1)}%`;
      star.classList.add('in');
      fxTimer(defId, starHide, rnd(850, 1300));
    };
    fxTimer(defId, starShow, rnd(900, 2600));
  }
  box.appendChild(ring);
  // ITEM 4：darkness 已编译 → 环外常驻循环不规则黑雾层（渐现→渐散）。8 块非对称烟云
  // 沿卡面四周分布（CSS nth-child 锚点 + --wisp-a/--wisp-b 专属形变），JS 只写负
  // animation-delay 交错（-1.05s/块，跨整 8s 周期 → 各块不同相位、偶发涌现而非齐步）；
  // 与编译环同挂 holder，inset 外扩到环带外侧。absolute + pointer-events:none 不拦截交互。
  if (defId === 'darkness') {
    const mist = el('div', 'compiled-mist');
    const MIST_BLOBS = 8;
    for (let i = 0; i < MIST_BLOBS; i++) {
      const blob = el('div', 'mist-blob');
      blob.style.animationDelay = `${-(i * 1.05)}s`;
      mist.appendChild(blob);
    }
    box.appendChild(mist);
    // R10：波浪尺式半圆光晕（暗域专属，保留雾层不变）。卡面 200×280：上/下边各 13 个
    // 半圆（直径 16px，间距 200/13≈15.38px 轻微重叠铺满 200px），左/右边各 18 个
    // （间距 280/18≈15.56px 铺满 280px）。.dark-halo-scallop 默认顶拱（平边在下贴卡边、
    // 拱顶向外鼓 8px），.bottom/.left/.right 由 CSS rotate 转向。定位分工：JS 只写
    // 「沿边坐标」（横向行 left、竖向列 top），「贴边偏移」由 styles.css 各边变体提供
    // （.top top:-8 / .bottom bottom:-8 / .left left:-12 / .right right:-12）。
    // 左/右列旋转落点：16×8 顶拱元素绕中心 rotate ±90° 后，平边相对元素中心内移半宽
    // 4px——「平边内 4px/拱顶外 4px」仅对元素中心落在卡边上成立；left:-12/right:-12
    // 把元素中心推到卡边外 4px，故平边贴边、拱顶鼓 8px。top = i*SIDE_SP + 3.78 使整列
    // 平边覆盖 [−0.22, 280.22]，上下两端对称环绕（避免下角 ~7.5px 无凸起缺口）。
    const halo = el('div', 'dark-halo');
    const TOP_COUNT = 13; // ceil(200/16) = 13
    const SIDE_COUNT = 18; // ceil(280/16) = 18
    const TOP_SP = 200 / TOP_COUNT; // ≈15.38
    const SIDE_SP = 280 / SIDE_COUNT; // ≈15.56
    for (let i = 0; i < TOP_COUNT; i++) {
      const s = el('div', 'dark-halo-scallop top');
      s.style.left = `${(i * TOP_SP).toFixed(2)}px`;
      halo.appendChild(s);
    }
    for (let i = 0; i < TOP_COUNT; i++) {
      const s = el('div', 'dark-halo-scallop bottom');
      s.style.left = `${(i * TOP_SP).toFixed(2)}px`;
      halo.appendChild(s);
    }
    for (let i = 0; i < SIDE_COUNT; i++) {
      const s = el('div', 'dark-halo-scallop left');
      s.style.top = `${(i * SIDE_SP + 3.78).toFixed(2)}px`;
      halo.appendChild(s);
    }
    for (let i = 0; i < SIDE_COUNT; i++) {
      const s = el('div', 'dark-halo-scallop right');
      s.style.top = `${(i * SIDE_SP + 3.78).toFixed(2)}px`;
      halo.appendChild(s);
    }
    box.appendChild(halo);
    // R11：暗2式圆烟（少量）绕框。4 个 .dark-ring-puff 复用暗2卡牌黑烟 .smoke-puff 的
    // 视觉（黑核 + 灰蓝亮缘剪影、渐现→渐散），沿卡面四周少量锚点（两角 + 两缘中部）
    // 循环 渐现→渐散（smokePuff 关键帧，6s 周期，负 delay -1.5s/个 交错 → 各烟不同
    // 时刻飘进飘出）。与 .compiled-mist 同层（z 1）、pointer-events:none；不改动
    // .mist-blob 与暗2线烟 .smoke-puff/.smoke-line（暗2 线烟保持原样，此处仅复用其视觉）。
    const smoke = el('div', 'dark-ring-smoke');
    const SMOKE_COUNT = 4;
    for (let i = 0; i < SMOKE_COUNT; i++) {
      const puff = el('div', 'dark-ring-puff');
      puff.style.animationDelay = `${-(i * 1.5)}s`;
      smoke.appendChild(puff);
    }
    box.appendChild(smoke);
  }
  // ITEM 5（round15 重做，round16 加密锚点）：life 已编译 → 20+ 根粗绿藤蔓从卡框起
  // 缠绕协议卡（复用 Item 1 翻转藤蔓观感：粗 S 曲线 + 绿光描边）+ 缓慢左右摇摆。
  // 三处关键设计：
  //  1) 更短：长度 ≤42px（旧 85/90 → 至多一半），仍垂入卡内；
  //  2) 不规则：锚点沿边分数为手挑的非等分值（不再是 6 等分）；
  //  3) ≥14 个锚点（R16：17 个，上 4 / 右 4 / 下 4 / 左 5，均匀绕框）+ 共享锚点特性
  //     （同点最多 2 根、角度略异 → 簇生）：旧版 8 锚点各 1-3 根（3 根同点重叠成
  //     一团、锚点间大片空白 → 看起来稀疏）；本版锚点更多、每点更少 → 覆盖更均匀、
  //     重叠更少，仍共 21 根（≥20）。
  // 藤蔓为层内 z 2（环带之上、卡面之上）。绿色框光由 .compiled-ring-life 呼吸动画
  // 提供、深绿背光为 .life-backlight（buildCompiledFx 挂载）。定位用百分比 + margin
  // 居中（跟随层尺寸，图片未加载时也不飞离卡框）。
  if (defId === 'life') {
    const VINE_LEN_MAX = 42; // 旧 85/90 → 至多一半
    const VW = 30; // wrap 宽 = svg 宽（margin 居中基准）
    const SWAY_CYCLE_S = 4.5; // 摇摆周期（与 CSS .life-compiled-vine-curve 一致）
    // 锚点表：[边(0上/1右/2下/3左), 沿边分数, 藤蔓朝向角(deg，垂入卡内)]。
    // R16：17 个锚点（≥14）均匀绕框——上/右/下各 4 个、左 5 个，分数为手挑的不规则
    // 值（避开四角与 1/3 等分，边内分布更匀）；每点 1 根，仅 4 个锚点各带第 2 根
    // （角度略异 ±8~14° → 簇生，不齐整、不重叠成团）。共 21 根（≥20）。
    const ANCHORS: ReadonlyArray<readonly [number, number, number]> = [
      [0, 0.10, -8], [0, 0.10, 6], // 上 0.10：2 根（共享锚点）
      [0, 0.34, 0], // 上 0.34：1 根
      [0, 0.62, -6], // 上 0.62：1 根
      [0, 0.88, 4], // 上 0.88：1 根
      [1, 0.12, 96], // 右 0.12：1 根
      [1, 0.42, 84], [1, 0.42, 98], // 右 0.42：2 根（共享锚点）
      [1, 0.68, 90], // 右 0.68：1 根
      [1, 0.90, 80], // 右 0.90：1 根
      [2, 0.08, 186], // 下 0.08：1 根
      [2, 0.32, 172], // 下 0.32：1 根
      [2, 0.58, 180], [2, 0.58, 194], // 下 0.58：2 根（共享锚点）
      [2, 0.86, 174], // 下 0.86：1 根
      [3, 0.14, 266], // 左 0.14：1 根
      [3, 0.38, 270], // 左 0.38：1 根
      [3, 0.62, 258], // 左 0.62：1 根
      [3, 0.86, 274], [3, 0.86, 286], // 左 0.86：2 根（共享锚点）
      [3, 0.95, 264], // 左 0.95：1 根
    ];
    for (let i = 0; i < ANCHORS.length; i++) {
      const [side, pos, rot] = ANCHORS[i];
      // 长度 34/38/42 小幅差异（≤ VINE_LEN_MAX）→ 比齐长更自然
      const len = Math.min(VINE_LEN_MAX, 34 + ((i * 13) % 3) * 4);
      const vine = buildCompiledVine(rot, len, (i * 0.37) % SWAY_CYCLE_S);
      vine.style.height = `${len}px`;
      if (side === 0) {
        vine.style.left = `${pos * 100}%`;
        vine.style.marginLeft = `${-VW / 2}px`;
        vine.style.top = '0px';
      } else if (side === 1) {
        vine.style.left = '100%';
        vine.style.top = `${pos * 100}%`;
        vine.style.marginTop = `${-VW / 2}px`;
      } else if (side === 2) {
        vine.style.left = `${pos * 100}%`;
        vine.style.marginLeft = `${-VW / 2}px`;
        vine.style.top = '100%';
      } else {
        vine.style.left = '0px';
        vine.style.top = `${pos * 100}%`;
        vine.style.marginTop = `${-VW / 2}px`;
      }
      box.appendChild(vine);
    }
  }
  // ITEM 5（round15 增补）：water 已编译 → 卡中心背后持续扩散的蓝色波纹层（多个圆环交错
  // 相位 → 连续不断，接近卡框时渐渐消散）+ 时不时出现的海浪线（长周期浮现 + 交错相位 →
  // 偶发涌现）+ 框边时不时的小型水环（四角 + 上下缘中点，长周期渐现→渐散，见 CSS
  // .water-frame-ripples）。波纹/海浪峰值透明度 ~80%（CSS keyframes）。蓝色框光由
  // .compiled-ring-water 呼吸动画提供。波纹/海浪/框边小环为层内 z 1（环带之下）。
  if (defId === 'water') {
    const ripples = el('div', 'water-ripples');
    const RIPPLE_COUNT = 5;
    for (let i = 0; i < RIPPLE_COUNT; i++) {
      const r = el('div', 'water-ripple');
      r.style.animationDelay = `${-(i * 1.1)}s`; // 交错相位 → 波纹连续不断出现
      ripples.appendChild(r);
    }
    box.appendChild(ripples);
    const waves = el('div', 'water-waves');
    const WAVE_COUNT = 3;
    for (let i = 0; i < WAVE_COUNT; i++) {
      const w = buildWaterWave();
      w.style.animationDelay = `${-(i * 3.2)}s`; // 长周期交错 → "时不时"涌现
      w.style.top = `${24 + i * 22}%`;
      waves.appendChild(w);
    }
    box.appendChild(waves);
    // R15：时不时的小型框边水环——中心波纹同款环形（小型），挂在四角 + 上下缘中点
    // （卡框内/框边）。长周期 10s + 交错负 delay（2.3s/个）→ 各环不同时刻渐现→渐散，
    // 大部分时间不可见（偶发涌现，同 darkness 圆烟模式）。pointer-events:none（层本身）。
    const frameRipples = el('div', 'water-frame-ripples');
    const FRAME_RIPPLE_POS: ReadonlyArray<readonly [number, number]> = [
      [7, 7], [93, 7], [50, 4], [7, 93], [93, 93], [50, 96],
    ];
    for (let i = 0; i < FRAME_RIPPLE_POS.length; i++) {
      const [x, y] = FRAME_RIPPLE_POS[i];
      const r = el('div', 'water-frame-ripple');
      r.style.left = `${x}%`;
      r.style.top = `${y}%`;
      r.style.animationDelay = `${-(i * 2.3)}s`;
      frameRipples.appendChild(r);
    }
    box.appendChild(frameRipples);
  }
}

/* =====================================================================================
 * 2026-09-03：新 10 协议「已编译」常驻特效（死/灵魂/重力/念能/瘟疫/金属/速度/爱/恨/冷漠）
 * -------------------------------------------------------------------------------------
 * 用户规格要点（实现约束，勿改）：
 *  - 动画属持续性：全部挂在 body 级持久层（compiledFx）内——层跨重渲染从不 detach/重建，
 *    只被 syncCompiledFxLayers（渲染 + scroll/resize rAF）按 holder 矩形重定位 → 步骤
 *    切换不重置动画进度、特效跟随协议位置（绝不挂回每次重建的 .protocol DOM 树）；
 *  - 周期性大特效（灵魂锁链伸收 / 重力坍缩 / 念能爆发 / 恨意血涌 / 冷漠故障）触发时间
 *    随机，但「特效结束 → 下次开始」间隔 ≥ COMPILED_MIN_GAP_MS（10s，从结束起计时）；
 *  - 观感参数集中：颜色/过渡在 styles.css「新 10 协议已编译特效」区块，尺寸/时长常量在
 *    各 builder 顶部，便于 5173 微调。
 * ===================================================================================== */
const COMPILED_MIN_GAP_MS = 10_000;    // 周期大特效：结束 → 下次开始的最小间隔（用户 ≥10s）
const COMPILED_GAP_JITTER_MS = 16_000; // 随机上界（10s + 0..16s）

/** 层当前几何（px；w/h 由 syncCompiledFxLayers 每帧写入）；未挂载/0 尺寸返回 null */
function layerGeom(layer: HTMLElement): { w: number; h: number; cx: number; cy: number; diag: number; min: number } | null {
  if (!layer.isConnected) return null;
  const w = parseFloat(layer.style.width);
  const h = parseFloat(layer.style.height);
  if (!(w > 0) || !(h > 0)) return null;
  return { w, h, cx: w / 2, cy: h / 2, diag: Math.hypot(w, h), min: Math.min(w, h) };
}

function rnd(a: number, b: number): number { return a + Math.random() * (b - a); }
function pick<T>(arr: readonly T[]): T { return arr[Math.floor(Math.random() * arr.length)]; }

/** 强制回流：让刚写入的初始样式先被绘制，随后的 transition 才能从该状态开始 */
function reflowFx(elToReflow: HTMLElement): void { void elToReflow.offsetWidth; }

/** 四角加厚护边（L 形支架；几何走通用 .compiled-l-corner 骨架，观感颜色按协议 CSS 变量
 *  --cc/--ccg 区分：spirit 靛蓝 / plague 深绿 / metal 金属(独立) / speed 灰白 / love 粉红 /
 *  death 深紫 / gravity 品红紫 / psychic 亮紫 / hate 血红 / apathy 亮灰——§8 用户要求全部
 *  协议都有与边框发光色对应的护边）。持久节点 → 发光不随重渲染重置。 */
function appendCompiledCorners(layer: HTMLElement, cls: string): void {
  for (const pos of ['tl', 'tr', 'bl', 'br'] as const) {
    layer.appendChild(el('div', `compiled-l-corner ${cls} ${pos}`));
  }
}

/** 协议边框附近随机点（百分比；供骷髅/爱心/血渍等小元素贴边定位） */
function nearBorderPoint(): { x: number; y: number } {
  const edge = Math.floor(Math.random() * 4);
  const f = rnd(10, 90);
  const d = rnd(5, 18); // 距边距离（%）
  switch (edge) {
    case 0: return { x: f, y: d };
    case 1: return { x: 100 - d, y: f };
    case 2: return { x: f, y: 100 - d };
    default: return { x: d, y: f };
  }
}

/** 周期序列驱动器：burst(结束回调) 完成后按「minGap + 随机抖动」排下一次；首次延迟 firstMs。
 *  结束回调只调用一次（各 burst 用 finished 守卫）。默认 minGap=10s（全局硬约束）；
 *  灵魂协议按用户 2026-09-03 修改用 5s（可传参覆盖）。 */
function scheduleCompiledLoop(
  layer: HTMLElement,
  defId: string,
  firstMs: number,
  burst: (done: () => void) => void,
  minGapMs: number = COMPILED_MIN_GAP_MS,
  jitterMs: number = COMPILED_GAP_JITTER_MS,
): void {
  const next = (delayMs: number): void => {
    fxTimer(defId, () => {
      if (!layer.isConnected) return; // 层已释放（未编译/重置）→ 序列自然终止
      let finished = false;
      burst(() => {
        if (finished) return;
        finished = true;
        next(minGapMs + rnd(0, jitterMs));
      });
    }, delayMs);
  };
  next(firstMs);
}

/* ---------- 1. 死 death：深紫↔黑边框柔和交替；骷髅高频多只；偶尔死神镰刀；缕缕黑烟 ---------- */
function appendDeathCompiled(layer: HTMLElement, defId: string): void {
  // §8：四角深紫护边
  appendCompiledCorners(layer, 'compiled-death-corner');
  // 缕缕黑烟（持续交错循环）：4 缕沿下缘/下角冒出向上飘散渐隐（负 delay 错相）
  const smoke = el('div', 'compiled-death-smoke');
  for (let i = 0; i < 4; i++) {
    const w = el('div', 'compiled-death-wisp');
    w.style.animationDelay = `${-(i * 1.7).toFixed(2)}s`;
    smoke.appendChild(w);
  }
  layer.appendChild(smoke);
  // 骷髅池（2026-09-03：频率调高 + 可多只同屏）：3 个 💀 各自独立循环（💀 emoji，
  // 复用删除特效观感），初始相位交错 → 任意时刻 0-3 只不定
  const SKULL_COUNT = 3;
  for (let k = 0; k < SKULL_COUNT; k++) {
    const skull = el('div', 'compiled-death-skull');
    skull.textContent = '💀';
    layer.appendChild(skull);
    const hideDone = (): void => {
      if (!layer.isConnected) return;
      skull.classList.remove('out');
      fxTimer(defId, show, rnd(900, 2600)); // 频率调高（原 2.6-7s）
    };
    const hide = (): void => {
      if (!layer.isConnected) return;
      skull.classList.remove('in');
      skull.classList.add('out');
      fxTimer(defId, hideDone, 480);
    };
    const show = (): void => {
      if (!layer.isConnected) return;
      const g = layerGeom(layer);
      if (!g) { fxTimer(defId, show, 700); return; }
      const p = nearBorderPoint();
      skull.style.fontSize = `${rnd(20, 38).toFixed(1)}px`;
      skull.style.left = `${p.x.toFixed(1)}%`;
      skull.style.top = `${p.y.toFixed(1)}%`;
      skull.classList.add('in');
      fxTimer(defId, hide, rnd(1200, 2000));
    };
    fxTimer(defId, show, rnd(600, 1800) + k * 650);
  }
  // 死神镰刀（偶尔）：木柄 + 长条刀片（回旋镖观感），卡中央斜置，渐现→停留→渐隐
  const scytheWrap = el('div', 'compiled-death-scythe');
  const scytheArt = el('div', 'compiled-death-scythe-art');
  scytheArt.appendChild(el('div', 'compiled-death-scythe-blade'));
  scytheArt.appendChild(el('div', 'compiled-death-scythe-handle'));
  scytheWrap.appendChild(scytheArt);
  layer.appendChild(scytheWrap);
  const scytheOut = (): void => {
    if (!layer.isConnected) return;
    scytheWrap.classList.remove('in');
    scytheWrap.classList.add('out');
    fxTimer(defId, scytheReset, 620);
  };
  const scytheReset = (): void => {
    if (!layer.isConnected) return;
    scytheWrap.classList.remove('out');
    fxTimer(defId, scytheIn, rnd(6000, 12000)); // 偶尔：6-12s 一次
  };
  const scytheIn = (): void => {
    if (!layer.isConnected) return;
    scytheWrap.classList.add('in');
    fxTimer(defId, scytheOut, rnd(1500, 2200));
  };
  fxTimer(defId, scytheIn, rnd(3500, 7000));
}

/* ---------- 2. 灵魂 spirit：亮紫↔紫粉边框；四角紫护边；锁链周期伸向中心后缩回 ---------- */
function appendSpiritCompiled(layer: HTMLElement, defId: string): void {
  appendCompiledCorners(layer, 'compiled-spirit-corner');
  const host = el('div', 'compiled-spirit-chainhost');
  layer.appendChild(host);
  const burst = (done: () => void): void => {
    if (!layer.isConnected) { done(); return; }
    const g = layerGeom(layer);
    if (!g) { fxTimer(defId, () => burst(done), 700); return; }
    host.textContent = '';
    host.style.transition = 'none';
    host.style.opacity = '1';
    const n = 8 + Math.floor(Math.random() * 3); // 8-10 根锁链（2026-09-03：个数调高）
    const chains: HTMLElement[] = [];
    for (let i = 0; i < n; i++) {
      const edge = Math.floor(Math.random() * 4);
      const f = rnd(8, 92);
      let ax = 0;
      let ay = 0;
      if (edge === 0) ax = (f / 100) * g.w;
      else if (edge === 2) { ax = (f / 100) * g.w; ay = g.h; }
      else if (edge === 1) { ax = g.w; ay = (f / 100) * g.h; }
      else ay = (f / 100) * g.h;
      const dx = g.cx - ax;
      const dy = g.cy - ay;
      const dist = Math.hypot(dx, dy);
      if (dist < 14) continue;
      const len = dist * rnd(0.55, 0.8);
      const ang = (Math.atan2(dy, dx) * 180) / Math.PI;
      const wrap = el('div', 'compiled-spirit-chain');
      wrap.style.left = `${ax.toFixed(1)}px`;
      wrap.style.top = `${ay.toFixed(1)}px`;
      wrap.style.width = `${len.toFixed(1)}px`;
      wrap.style.transform = `rotate(${ang.toFixed(1)}deg) scaleX(0)`;
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', `0 0 ${Math.ceil(len)} 26`);
      svg.setAttribute('preserveAspectRatio', 'none');
      appendChainLinks(svg, 5, 13, Math.max(7, len - 5), 13);
      wrap.appendChild(svg);
      host.appendChild(wrap);
      chains.push(wrap);
    }
    if (chains.length === 0) { done(); return; }
    // 渐伸（0.6s，交错 80ms）→ 停留 → 快速缩回起点并消失
    requestAnimationFrame(() => {
      if (!layer.isConnected) return;
      reflowFx(host); // 先固化 scaleX(0) 初始态，避免同帧内样式合并跳过过渡（链直接弹出）
      for (let i = 0; i < chains.length; i++) {
        const c = chains[i];
        c.style.transition = 'transform 0.6s cubic-bezier(0.2, 0.6, 0.35, 1)';
        c.style.transitionDelay = `${(i * 80).toFixed(0)}ms`;
        c.style.transform = c.style.transform.replace('scaleX(0)', 'scaleX(1)');
      }
    });
    const last = chains.length - 1;
    fxTimer(defId, () => {
      if (!layer.isConnected) return;
      host.style.transition = 'opacity 0.35s ease-in';
      for (const c of chains) {
        c.style.transition = 'transform 0.4s cubic-bezier(0.75, 0, 0.9, 0.55)'; // 快速缩回
        c.style.transitionDelay = '0ms';
        c.style.transform = c.style.transform.replace('scaleX(1)', 'scaleX(0)');
      }
      fxTimer(defId, () => {
        if (host.isConnected) host.style.opacity = '0';
        done();
      }, 430);
    }, 1050 + last * 80);
  };
  // 灵魂锁链触发频率（2026-09-03 用户修改：≥5s 一次，覆盖全局 ≥10s；结束→下次 5s+0..5s）
  scheduleCompiledLoop(layer, defId, rnd(1800, 3800), burst, 5000, 5000);
}

/* ---------- 3. 重力 gravity：品红↔亮紫边框；黑洞由小到大→射线射出→回收→坍缩→紫尘 ---------- */
function appendGravityCompiled(layer: HTMLElement, defId: string): void {
  appendCompiledCorners(layer, 'compiled-gravity-corner'); // §8：四角品红紫护边
  const host = el('div', 'compiled-gravity-host');
  layer.appendChild(host);
  const burst = (done: () => void): void => {
    if (!layer.isConnected) { done(); return; }
    const g = layerGeom(layer);
    if (!g) { fxTimer(defId, () => burst(done), 700); return; }
    host.textContent = '';
    const dHole = Math.max(30, g.min * 0.4);   // 黑洞直径（由小到大 → 此基准）
    const dGrow = Math.max(44, g.min * 0.62);  // 射线回收期黑洞放大到
    const R = g.min * 0.8;                       // 射线终点圆半径（2026-09-03：加长扩散到协议框外 ≈1.74× 原 0.46）
    const hole = el('div', 'compiled-gravity-hole');
    hole.style.width = `${dHole.toFixed(1)}px`;
    hole.style.height = `${dHole.toFixed(1)}px`;
    hole.style.marginLeft = `${(-dHole / 2).toFixed(1)}px`;
    hole.style.marginTop = `${(-dHole / 2).toFixed(1)}px`;
    hole.style.transform = 'scale(0.15)';
    hole.style.opacity = '0';
    hole.style.transition = 'transform 0.55s ease-out, opacity 0.3s ease-out';
    const disc = el('div', 'compiled-gravity-disc');
    const slit = el('div', 'compiled-gravity-slit');
    hole.appendChild(disc);
    hole.appendChild(slit);
    host.appendChild(hole);
    const nb = 6 + Math.floor(Math.random() * 3); // 6-8 条方向各异
    const beams: HTMLElement[] = [];
    for (let i = 0; i < nb; i++) {
      const ang = (360 / nb) * i + rnd(-8, 8);
      const b = el('div', 'compiled-gravity-beam');
      b.style.width = `${R.toFixed(1)}px`;
      b.style.transform = `rotate(${ang.toFixed(1)}deg) scaleX(0)`;
      b.style.opacity = '0';
      b.style.transition = 'transform 0.9s cubic-bezier(0.55, 0, 0.85, 0.5), opacity 0.35s ease-out';
      b.style.transitionDelay = `${(0.58 + i * 0.05).toFixed(2)}s, 0.58s`;
      host.appendChild(b);
      beams.push(b);
    }
    reflowFx(hole);
    hole.style.transform = 'scale(1)';
    hole.style.opacity = '1';
    // 射线伸展（由慢到快；延迟内联在 transitionDelay —— 0.58s 起自黑洞射向范围圆边）
    requestAnimationFrame(() => {
      if (!layer.isConnected) return;
      for (const b of beams) {
        b.style.transform = b.style.transform.replace('scaleX(0)', 'scaleX(1)');
        b.style.opacity = '0.95';
      }
    });
    fxTimer(defId, () => {
      if (!layer.isConnected) return;
      // 回收：射线由快变慢缩回黑洞、黑洞随之放大
      for (const b of beams) {
        b.style.transition = 'transform 0.75s cubic-bezier(0.8, 0.05, 0.95, 0.3), opacity 0.3s ease-in';
        b.style.transitionDelay = '0s';
        b.style.transform = b.style.transform.replace('scaleX(1)', 'scaleX(0)');
        b.style.opacity = '0';
      }
      hole.style.transition = 'transform 0.8s ease-out';
      hole.style.transform = `scale(${(dGrow / dHole).toFixed(3)})`;
      fxTimer(defId, () => {
        if (!layer.isConnected) return;
        // 快速坍缩
        hole.style.transition = 'transform 0.38s cubic-bezier(0.7, 0, 0.9, 0.6), opacity 0.3s ease-in';
        hole.style.transform = 'scale(0.04)';
        hole.style.opacity = '0';
        fxTimer(defId, () => {
          if (!layer.isConnected) return;
          // 坍缩消失后原地留几缕随机紫色曲线（模拟灰尘）
          host.textContent = '';
          const dn = 4 + Math.floor(Math.random() * 2);
          for (let i = 0; i < dn; i++) {
            const d = el('div', 'compiled-gravity-dust');
            d.style.setProperty('--fx-dx', `${rnd(-30, 30).toFixed(1)}px`);
            d.style.setProperty('--fx-dy', `${rnd(-46, -14).toFixed(1)}px`);
            d.style.animationDuration = `${rnd(1.2, 1.7).toFixed(2)}s`;
            d.style.animationDelay = `${(i * 0.12).toFixed(2)}s`;
            // 一缕随机紫色曲线（模拟灰尘）
            const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            svg.setAttribute('viewBox', '0 0 48 30');
            const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            path.setAttribute(
              'd',
              `M2,26 C10,4 ${rnd(14, 22).toFixed(1)},28 ${rnd(26, 34).toFixed(1)},10 S ${rnd(38, 44).toFixed(1)},4 46,14`,
            );
            path.setAttribute('fill', 'none');
            path.setAttribute('stroke', pick(['#c27bff', '#b26bff', '#d69bff']));
            path.setAttribute('stroke-width', '2.2');
            path.setAttribute('stroke-linecap', 'round');
            svg.appendChild(path);
            d.appendChild(svg);
            host.appendChild(d);
          }
          fxTimer(defId, () => { host.textContent = ''; done(); }, 2400);
        }, 420);
      }, 820);
    }, 2050);
  };
  scheduleCompiledLoop(layer, defId, rnd(2500, 5500), burst);
}

/* ---------- 4. 念能 psychic：暗紫粉↔亮紫边框；边框周围持续微闪小粒子；周期爆发 ---------- */
function appendPsychicCompiled(layer: HTMLElement, defId: string): void {
  appendCompiledCorners(layer, 'compiled-psychic-corner'); // §8：四角亮紫护边
  // 边框周围持续微闪的紫粉小粒子（交错循环；爆发期间由 .compiled-psychic-bursting 暂停）
  const amb = el('div', 'compiled-psychic-ambient');
  for (let i = 0; i < 14; i++) {
    const p = el('div', 'compiled-psychic-amb-p');
    p.style.animationDelay = `${-(i * 0.19).toFixed(2)}s`;
    amb.appendChild(p);
  }
  layer.appendChild(amb);
  const host = el('div', 'compiled-psychic-burst');
  layer.appendChild(host);
  const burst = (done: () => void): void => {
    if (!layer.isConnected) { done(); return; }
    const g = layerGeom(layer);
    if (!g) { fxTimer(defId, () => burst(done), 700); return; }
    layer.classList.add('compiled-psychic-bursting'); // 规格：爆发期间小粒子特效不触发
    host.textContent = '';
    host.style.opacity = '1';
    const R0 = Math.max(26, g.min * 0.3); // 环绕半径
    const N = 16;
    const spin = el('div', 'compiled-psychic-spin');
    const parts: HTMLElement[] = [];
    for (let i = 0; i < N; i++) {
      const a = (Math.PI * 2 * i) / N + rnd(-0.06, 0.06);
      const orb = el('div', 'compiled-psychic-orb');
      orb.style.transform = `translate(${(Math.cos(a) * R0).toFixed(1)}px, ${(Math.sin(a) * R0).toFixed(1)}px)`;
      orb.style.opacity = '0';
      spin.appendChild(orb);
      parts.push(orb);
    }
    host.appendChild(spin);
    reflowFx(spin);
    for (const orb of parts) orb.style.opacity = '1';
    spin.classList.add('orbiting'); // 定住常亮后围绕中心旋转
    fxTimer(defId, () => {
      if (!layer.isConnected) return;
      spin.classList.remove('orbiting'); // 停转
      spin.style.transition = 'transform 0.3s ease-out';
      spin.style.transform = 'rotate(0deg)';
      for (const orb of parts) {
        orb.style.transition = 'transform 0.4s cubic-bezier(0.35, 0.4, 0.55, 1)';
        orb.style.transform = 'translate(0px, 0px)'; // 一起向中心收缩
      }
      fxTimer(defId, () => {
        if (!layer.isConnected) return;
        // 蓄力
        const charge = el('div', 'compiled-psychic-charge');
        const core = el('div', 'compiled-psychic-charge-core');
        charge.appendChild(core);
        host.appendChild(charge);
        reflowFx(core);
        core.classList.add('on');
        fxTimer(defId, () => {
          if (!layer.isConnected) return;
          // 爆发：烟花（粒子四散 + 闪光环 + 蓄力核膨胀消散）
          host.appendChild(el('div', 'compiled-psychic-flash'));
          charge.classList.add('go');
          for (const orb of parts) {
            const a = Math.random() * Math.PI * 2;
            const rr = R0 * rnd(0.9, 1.6);
            orb.style.transition = 'transform 0.85s cubic-bezier(0.12, 0.65, 0.4, 1), opacity 0.75s ease-in 0.05s';
            orb.style.transform = `translate(${(Math.cos(a) * rr).toFixed(1)}px, ${(Math.sin(a) * rr).toFixed(1)}px) scale(0.6)`;
            orb.style.opacity = '0';
          }
          fxTimer(defId, () => {
            if (!layer.isConnected) { done(); return; }
            host.style.opacity = '0';
            host.textContent = '';
            layer.classList.remove('compiled-psychic-bursting');
            done();
          }, 1000);
        }, 640);
      }, 420);
    }, 2100);
  };
  scheduleCompiledLoop(layer, defId, rnd(2600, 6000), burst);
}

/* ---------- 5. 瘟疫 plague：深绿↔亮绿灰边框；四角深绿护边；边框周围浓雾循环 ---------- */
function appendPlagueCompiled(layer: HTMLElement, defId: string): void {
  appendCompiledCorners(layer, 'compiled-plague-corner');
  // 深绿浓雾团（形状随机：CSS 各 blob 专属不规则 border-radius），渐现→渐散交错循环
  const mist = el('div', 'compiled-plague-mist');
  const BLOBS = 6;
  for (let i = 0; i < BLOBS; i++) {
    const b = el('div', 'compiled-plague-blob');
    b.style.animationDelay = `${-(i * 1.15).toFixed(2)}s`;
    mist.appendChild(b);
  }
  layer.appendChild(mist);
}

/* ---------- 6. 金属 metal：金属光泽边框环 + 四角金属护边 + 卡面 30% 铁板 + 斜光 + 刺 ---------- */
function appendMetalCompiled(layer: HTMLElement, defId: string): void {
  layer.appendChild(el('div', 'compiled-metal-ring'));
  // 四角金属护边（几何/观感与其它协议 L 形护边不同：金属渐变 clip-path，不走通用
  // .compiled-l-corner 骨架——故在此直接建节点，不带通用类）
  for (const pos of ['tl', 'tr', 'bl', 'br'] as const) {
    layer.appendChild(el('div', `compiled-metal-corner ${pos}`));
  }
  // 卡面铁板（30% 透明度）+ 偶发斜光扫过（CSS 长周期循环内自含扫过窗口）
  const plate = el('div', 'compiled-metal-plate');
  plate.appendChild(el('div', 'compiled-metal-sweep'));
  layer.appendChild(plate);
  // 金属刺：沿边框向外突然伸出后收缩（周期随机；SIDES = [位置边, 沿边分数, 方向类]）
  const spikes = el('div', 'compiled-metal-spikes');
  const SIDES: ReadonlyArray<readonly [string, string, string]> = [
    ['top', '18', 'top'], ['top', '50', 'top'], ['top', '82', 'top'],
    ['bottom', '18', 'bottom'], ['bottom', '50', 'bottom'], ['bottom', '82', 'bottom'],
    ['left', '28', 'left'], ['left', '72', 'left'],
    ['right', '28', 'right'], ['right', '72', 'right'],
  ];
  for (const [side, frac, dir] of SIDES) {
    const s = el('div', `compiled-metal-spike ${dir}`);
    if (side === 'top' || side === 'bottom') {
      s.style.left = `${frac}%`;
      s.style.marginLeft = '-8px';
    } else {
      s.style.top = `${frac}%`;
      s.style.marginTop = '-8px';
    }
    spikes.appendChild(s);
  }
  layer.appendChild(spikes);
  const spikeLoop = (): void => {
    if (!layer.isConnected) return;
    spikes.classList.remove('on');
    reflowFx(spikes);
    spikes.classList.add('on');
    fxTimer(defId, () => {
      if (spikes.isConnected) spikes.classList.remove('on');
      fxTimer(defId, spikeLoop, rnd(3600, 8000));
    }, 820);
  };
  fxTimer(defId, spikeLoop, rnd(2200, 5000));
}

/* ---------- 7. 速度 speed：灰白↔灰边框；四角灰白护边；龙卷风周期生成蛇形走位 ---------- */
function appendSpeedCompiled(layer: HTMLElement, defId: string): void {
  appendCompiledCorners(layer, 'compiled-speed-corner');
  const host = el('div', 'compiled-speed-host');
  layer.appendChild(host);
  const TW = 88; // 龙卷风基准盒（视觉由 .fx-speed-tornado 提供，grow 缩放）
  const TH = 132;
  /** 生成一个龙卷风：中心由小到大 → 随机方向蛇形走位（由慢到快）→ 渐隐；带风拖尾 */
  const runOne = (done: () => void): void => {
    if (!layer.isConnected) { done(); return; }
    const g = layerGeom(layer);
    if (!g) { done(); return; }
    const wrap = el('div', 'compiled-speed-tornado');
    const grow = el('div', 'compiled-speed-tornado-grow');
    grow.style.left = `${(-TW / 2).toFixed(0)}px`; // 居中锚定（与 CSS 兜底同步，防常量漂移）
    grow.style.top = `${(-TH / 2).toFixed(0)}px`;
    grow.style.width = `${TW}px`;
    grow.style.height = `${TH}px`;
    grow.style.transform = 'scale(0.12)';
    grow.style.transition = 'transform 0.55s cubic-bezier(0.2, 0.7, 0.3, 1)';
    // 粒子漩涡龙卷风本体（共享构建器 fx-tornado.ts：粒子向中心旋转汇聚、向上涌动）
    const vis = buildTornadoFx();
    grow.appendChild(vis);
    wrap.appendChild(grow);
    host.appendChild(wrap);
    reflowFx(grow);
    grow.style.transform = 'scale(1)';
    const theta = Math.random() * Math.PI * 2; // 随机移动方向
    const dist = g.min * rnd(0.85, 1.5);       // 移动总距离（2026-09-03：吹出协议外 ≈2×）
    const amp = g.min * rnd(0.08, 0.16);       // 蛇形振幅
    const k = pick([2, 3, 4]);                 // 蛇形波数
    const dur = rnd(1700, 2400);
    const easeIn = (t: number): number => t * t * t; // 由慢到快
    const t0 = performance.now();
    let trailAt = t0;
    const step = (now: number): void => {
      if (!layer.isConnected || !wrap.isConnected) { wrap.remove(); done(); return; }
      const t = (now - t0) / dur;
      if (t >= 1) { wrap.remove(); done(); return; }
      const p = easeIn(t);
      const along = dist * p;
      const perp = amp * Math.sin(p * Math.PI * k);
      const c = Math.cos(theta);
      const sn = Math.sin(theta);
      const x = c * along - sn * perp;
      const y = sn * along + c * perp;
      wrap.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
      if (p > 0.7) vis.style.opacity = String(Math.max(0, 1 - (p - 0.7) / 0.3)); // 渐隐
      if (now - trailAt > 110) { // 风的拖尾：每 ~110ms 在当前位置撒一缕渐隐尾迹
        trailAt = now;
        const tr = el('div', 'compiled-speed-trail');
        tr.style.left = `${(g.cx + x).toFixed(1)}px`;
        tr.style.top = `${(g.cy + y).toFixed(1)}px`;
        host.appendChild(tr);
        fxTimer(defId, () => { if (tr.isConnected) tr.remove(); }, 750);
      }
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };
  /** 一次风暴：2-3 个龙卷风依次生成 */
  const storm = (done: () => void): void => {
    let left = 2 + Math.floor(Math.random() * 2);
    const nextOne = (): void => {
      if (left <= 0 || !layer.isConnected) { done(); return; }
      left -= 1;
      runOne(() => fxTimer(defId, nextOne, rnd(380, 800)));
    };
    nextOne();
  };
  const loop = (): void => {
    if (!layer.isConnected) return;
    storm(() => fxTimer(defId, loop, rnd(5200, 11000)));
  };
  fxTimer(defId, loop, rnd(2600, 6000));
}

/* ---------- 8. 爱 love：粉↔粉红边框；四角粉红护边；爱心周期由小变大飘散 ---------- */
function appendLoveCompiled(layer: HTMLElement, defId: string): void {
  appendCompiledCorners(layer, 'compiled-love-corner');
  const host = el('div', 'compiled-love-host');
  layer.appendChild(host);
  // 爱心（2026-09-03：每次产生 2-3 颗，错开浮现）；由小变大 → 向四周飘去渐隐
  const spawnHeart = (): void => {
    if (!layer.isConnected) return;
    const g = layerGeom(layer);
    if (!g) { fxTimer(defId, spawnHeart, 800); return; }
    const count = 2 + Math.floor(Math.random() * 2); // 2-3 颗/批
    for (let i = 0; i < count; i++) {
      fxTimer(defId, () => {
        if (!layer.isConnected) return;
        const gg = layerGeom(layer);
        if (!gg) return;
        const p = nearBorderPoint();
        const wrap = el('div', 'compiled-love-heart-wrap');
        wrap.style.left = `${p.x.toFixed(1)}%`;
        wrap.style.top = `${p.y.toFixed(1)}%`;
        // 向四周飘去：沿「中心 → 锚点」外延方向飞出
        const px = (p.x / 100) * gg.w - gg.cx;
        const py = (p.y / 100) * gg.h - gg.cy;
        const pl = Math.hypot(px, py) || 1;
        const dist = gg.diag * rnd(0.28, 0.5);
        wrap.style.setProperty('--fx-ex', `${((px / pl) * dist).toFixed(1)}px`);
        wrap.style.setProperty('--fx-ey', `${((py / pl) * dist).toFixed(1)}px`);
        const heart = el('div', 'compiled-love-heart');
        heart.style.setProperty('--hs', `${rnd(20, 34).toFixed(1)}px`);
        wrap.appendChild(heart);
        wrap.style.animationDuration = `${rnd(2.2, 3.4).toFixed(2)}s`;
        wrap.style.animationDelay = `${rnd(0, 0.35).toFixed(2)}s`; // 批内错开
        host.appendChild(wrap);
        const aliveMs = parseFloat(wrap.style.animationDuration) * 1000 + 700;
        fxTimer(defId, () => { if (wrap.isConnected) wrap.remove(); }, aliveMs);
      }, i * rnd(160, 320));
    }
    fxTimer(defId, spawnHeart, rnd(2600, 5200));
  };
  fxTimer(defId, spawnHeart, rnd(1000, 2400));
}

/* ---------- 9. 恨 hate：血红↔深红边框；偶发渗血；10 指收缩 + 血涌覆盖 + 渐隐 ---------- */
function appendHateCompiled(layer: HTMLElement, defId: string): void {
  appendCompiledCorners(layer, 'compiled-hate-corner'); // §8：四角血红护边
  const host = el('div', 'compiled-hate-host');
  layer.appendChild(host);
  // 偶发渗血（边框附近渗出 → 渐隐）
  const seepLoop = (): void => {
    if (!layer.isConnected) return;
    const g = layerGeom(layer);
    if (!g) { fxTimer(defId, seepLoop, 700); return; }
    const p = nearBorderPoint();
    const seep = el('div', 'compiled-hate-seep');
    const s = rnd(22, 46);
    seep.style.width = `${s.toFixed(1)}px`;
    seep.style.height = `${(s * 0.92).toFixed(1)}px`;
    seep.style.left = `${p.x.toFixed(1)}%`;
    seep.style.top = `${p.y.toFixed(1)}%`;
    host.appendChild(seep);
    fxTimer(defId, () => { if (seep.isConnected) seep.remove(); }, 2500);
    fxTimer(defId, seepLoop, rnd(2800, 6200));
  };
  fxTimer(defId, seepLoop, rnd(1800, 4200));
  // 大特效：10 根血指同时生成 → 缓慢向中心收缩后突然停止 → 中心涌出大滩血覆盖 → 渐隐
  const burst = (done: () => void): void => {
    if (!layer.isConnected) { done(); return; }
    const g = layerGeom(layer);
    if (!g) { fxTimer(defId, () => burst(done), 700); return; }
    // 10 根手指：基底贴协议边框外沿（上下各 2、左右各 3，沿边 ±5% 抖动），指尖朝协议中心——
    // 全部锚在边框带内，无外飘（圆形环绕会超出窄卡左右缘）；Lf 按各指到中心距离等比。
    const ANCHOR_SIDES: ReadonlyArray<readonly ['top' | 'bottom' | 'left' | 'right', number]> = [
      ['top', 24], ['top', 76], ['bottom', 24], ['bottom', 76],
      ['left', 22], ['left', 50], ['left', 78],
      ['right', 22], ['right', 50], ['right', 78],
    ];
    const EDGE = 5; // 基底外贴边框距离（px）
    const fingers: HTMLElement[] = [];
    const fingerTargets: number[] = []; // 各指独立收缩目标（与 fingers 同序）
    for (const [side, frac] of ANCHOR_SIDES) {
      const jit = rnd(-5, 5); // 沿边抖动（%，防齐整）
      let bx = 0;
      let by = 0;
      if (side === 'top') { bx = ((frac + jit) / 100) * g.w; by = -EDGE; }
      else if (side === 'bottom') { bx = ((frac + jit) / 100) * g.w; by = g.h + EDGE; }
      else if (side === 'left') { bx = -EDGE; by = ((frac + jit) / 100) * g.h; }
      else { bx = g.w + EDGE; by = ((frac + jit) / 100) * g.h; }
      const dx = g.cx - bx;
      const dy = g.cy - by;
      const dist = Math.hypot(dx, dy);
      if (dist < 20) continue;
      const Lf = dist * 0.55;           // 手指长度（基 → 指尖，指尖初始伸入卡内 ~45%）
      const scaleTo = (dist - 10) / Lf; // 收缩到中心 ~10px 的目标伸长
      const deg = (Math.atan2(dy, dx) * 180) / Math.PI; // +x 由基底指向协议中心
      const f = el('div', 'compiled-hate-finger');
      f.style.width = `${Lf.toFixed(1)}px`;
      f.style.left = `${bx.toFixed(1)}px`;
      f.style.top = `${(by - 7.5).toFixed(1)}px`; // 7.5 = 半高：transform-origin 0 50% 对准基底环点
      f.style.transform = `rotate(${deg.toFixed(1)}deg) scaleX(0.001)`;
      f.style.opacity = '0';
      host.appendChild(f);
      fingers.push(f);
      fingerTargets.push(scaleTo);
    }
    reflowFx(host);
    for (const f of fingers) { // 同时渐渐生成
      f.style.transition = 'opacity 0.5s ease-out, transform 0.55s ease-out';
      f.style.opacity = '1';
      f.style.transform = f.style.transform.replace('scaleX(0.001)', 'scaleX(1)');
    }
    fxTimer(defId, () => {
      if (!layer.isConnected) return;
      for (let i = 0; i < fingers.length; i++) { // 缓慢向中心收缩（随后突停——transition 结束即静止）
        const f = fingers[i];
        f.style.transition = 'transform 1.25s cubic-bezier(0.45, 0.05, 0.6, 1)';
        f.style.transform = f.style.transform.replace('scaleX(1)', `scaleX(${fingerTargets[i].toFixed(2)})`);
      }
      fxTimer(defId, () => {
        if (!layer.isConnected) return;
        // 中心突然涌出一大滩血液，快速覆盖整个协议
        const pool = el('div', 'compiled-hate-pool');
        pool.appendChild(el('div', 'compiled-hate-splat'));
        host.appendChild(pool);
        reflowFx(pool);
        pool.classList.add('in');
        for (const f of fingers) {
          f.style.transition = 'opacity 0.4s ease-in, transform 0.4s ease-in';
          f.style.opacity = '0';
        }
        fxTimer(defId, () => {
          if (!layer.isConnected) { done(); return; }
          pool.classList.add('fade'); // 血迹渐渐消失
          fxTimer(defId, () => {
            if (host.isConnected) host.textContent = '';
            done();
          }, 750);
        }, 1500);
      }, 1400);
    }, 650);
  };
  scheduleCompiledLoop(layer, defId, rnd(3000, 6500), burst);
}

/* ---------- 10. 冷漠 apathy：亮灰↔暗灰边框；偶发马赛克团；周期整卡故障风暴 ---------- */
function appendApathyCompiled(layer: HTMLElement, defId: string): void {
  appendCompiledCorners(layer, 'compiled-apathy-corner'); // §8：四角亮灰护边
  // 卡面克隆（故障滤镜载体）：与真实协议图同像素覆盖；平时隐藏，故障风暴期间显现并滤波。
  // 朝向（P2 rot-180）由 positionCompiledFxLayer 每次重定位同步。
  const face = el('div', 'compiled-apathy-face');
  const img = document.createElement('img');
  img.src = protocolImgSrc('apathy', true);
  img.alt = '';
  face.appendChild(img);
  layer.appendChild(face);
  const tiles = el('div', 'compiled-apathy-tiles');
  layer.appendChild(tiles);
  // 偶发像素马赛克团（协议卡内随机位置，短促闪现）
  const tileLoop = (): void => {
    if (!layer.isConnected) return;
    const g = layerGeom(layer);
    if (!g) { fxTimer(defId, tileLoop, 700); return; }
    tiles.textContent = '';
    const n = 4 + Math.floor(Math.random() * 4);
    for (let i = 0; i < n; i++) {
      const t = el('div', 'compiled-apathy-tile');
      const s = rnd(8, 18);
      t.style.width = `${s.toFixed(1)}px`;
      t.style.height = `${s.toFixed(1)}px`;
      t.style.left = `${rnd(6, 90).toFixed(1)}%`;
      t.style.top = `${rnd(6, 86).toFixed(1)}%`;
      t.style.animationDelay = `${rnd(0, 0.25).toFixed(2)}s`;
      t.style.animationDuration = `${rnd(0.9, 1.5).toFixed(2)}s`;
      tiles.appendChild(t);
    }
    fxTimer(defId, () => { if (tiles.isConnected) tiles.textContent = ''; }, 1900);
    fxTimer(defId, tileLoop, rnd(1500, 3400));
  };
  fxTimer(defId, tileLoop, rnd(900, 2200));
  // 故障风暴：整卡突然高频交替 全黑/全白/黑白灰度（随机模板 + 随机时长 → 每次观感不同）
  const GLYPHS = ['a', 'b', 'c'] as const;
  const storm = (done: () => void): void => {
    if (!layer.isConnected) { done(); return; }
    const g = layerGeom(layer);
    if (!g) { fxTimer(defId, () => storm(done), 700); return; }
    const dur = rnd(1600, 2800);
    if (img) {
      img.style.animation = `apathy-glitch-${pick(GLYPHS)} ${dur.toFixed(0)}ms linear ${rnd(-0.8, 0).toFixed(2)}s both`;
    }
    layer.classList.add('compiled-apathy-storm');
    fxTimer(defId, () => {
      layer.classList.remove('compiled-apathy-storm');
      if (img) img.style.animation = 'none';
      done();
    }, dur + 300);
  };
  scheduleCompiledLoop(layer, defId, rnd(2600, 5600), storm);
}

/* ---------- 11. 幸运 luck（2代，fx-gen2 已编译）：橘色呼吸框 + 四角橘护边；中心偶发红黑转盘 ----------
 * 转盘大特效：红黑相间 8 格 conic 圆盘渐现 → 铁珠沿盘缘滚动 1s（ease-out 随机落角）→
 * 停格判定（0° 起红黑交替，每格 45°）→ 红格 = 几朵小型橙红烟花 / 黑格 = 红蘑菇云 →
 * 盘渐隐消散。间隔 ≥10s 随机（scheduleCompiledLoop）。CSS 见 styles.css .compiled-luck-*。 */
const LUCK_WHEEL_DEG = 22.5; // 每格角度 → 360/22.5 = 16 格（用户：16 区域红黑转盘）
const LUCK_WHEEL_SEGS = 16;  // 与 CSS repeating-conic-gradient 的 16 格一致
const LUCK_WHEEL_SPIN_MS = 1000; // 铁珠滚动时长

function appendLuckCompiled(layer: HTMLElement, defId: string): void {
  appendCompiledCorners(layer, 'compiled-luck-corner'); // §8：四角橘色护边
  const host = el('div', 'compiled-luck-host');
  layer.appendChild(host);
  const burst = (done: () => void): void => {
    if (!layer.isConnected) { done(); return; }
    const g = layerGeom(layer);
    if (!g) { fxTimer(defId, () => burst(done), 700); return; }
    host.textContent = '';
    // 转盘尺寸：直径取短边 ~72%（竖版协议卡 200×280 → 约 144px），中心居层
    const d = Math.max(64, g.min * 0.72);
    const r = d / 2;
    const wheel = el('div', 'compiled-luck-wheel');
    wheel.style.width = `${d.toFixed(1)}px`;
    wheel.style.height = `${d.toFixed(1)}px`;
    wheel.style.marginLeft = `${-d / 2}px`;
    wheel.style.marginTop = `${-d / 2}px`;
    wheel.style.opacity = '0';
    wheel.style.transform = 'scale(0.5)';
    wheel.style.transition = 'opacity 0.35s ease-out, transform 0.4s cubic-bezier(0.2, 0.8, 0.3, 1.2)';
    // 铁珠：中心定位 + transform rotate(θ) translateY(-r)（先 rotate 后 translate →
    // 平移方向随旋转角变化 → 铁珠绕盘心画弧滚动；transition 仅动 rotate 角度）
    const ballSize = Math.max(14, d * 0.13);
    const ball = el('div', 'compiled-luck-ball');
    ball.style.width = `${ballSize.toFixed(1)}px`;
    ball.style.height = `${ballSize.toFixed(1)}px`;
    ball.style.marginLeft = `${-ballSize / 2}px`;
    ball.style.marginTop = `${-ballSize / 2}px`;
    ball.style.transform = `rotate(0deg) translateY(${-r}px)`;
    ball.style.transition = `transform ${LUCK_WHEEL_SPIN_MS}ms cubic-bezier(0.3, 0.05, 0.7, 1)`;
    wheel.appendChild(ball);
    host.appendChild(wheel);
    reflowFx(wheel);
    wheel.style.opacity = '1';
    wheel.style.transform = 'scale(1)';
    // 铁珠滚动：随机总角（≥1 圈多 + 落格居中偏移）。rotate target（逆时针视觉：
    // CSS rotate 正角 = 顺时针；落角 = target % 360，红黑格判定随顺时针推进）
    const fullSpins = 1 + Math.floor(Math.random() * 3); // 1-3 整圈
    const seg = Math.floor(Math.random() * LUCK_WHEEL_SEGS); // 0-15 落格（16 格）
    const target = fullSpins * 360 + seg * LUCK_WHEEL_DEG + LUCK_WHEEL_DEG / 2;
    requestAnimationFrame(() => {
      if (!layer.isConnected) return;
      ball.style.transform = `rotate(${target.toFixed(1)}deg) translateY(${-r}px)`;
    });
    // 停格后播结果（铁珠顺时针转 target，落角 = target % 360）
    const isRed = seg % 2 === 0; // 0° 起红黑交替（conic from 0deg 红 0-22.5）
    fxTimer(defId, () => {
      if (!layer.isConnected) return;
      // 结果特效（用户：加强烟花/蘑菇云——数量、尺寸、扩散距离与闪光全部放大）
      if (isRed) {
        // 红格：橙红烟花（多层火星向四周炸开 + 中心白橙闪光）
        const flash = el('div', 'compiled-luck-flash');
        wheel.appendChild(flash);
        const n = 22 + Math.floor(Math.random() * 8);
        for (let i = 0; i < n; i++) {
          const s = el('div', 'compiled-luck-firework');
          const ang = (i / n) * Math.PI * 2 + rnd(-0.25, 0.25);
          const dist = d * rnd(0.34, 0.62);
          s.style.left = `${r + Math.cos(ang) * d * 0.06}px`;
          s.style.top = `${r + Math.sin(ang) * d * 0.06}px`;
          s.style.setProperty('--fx-dx', `${(Math.cos(ang) * dist).toFixed(1)}px`);
          s.style.setProperty('--fx-dy', `${(Math.sin(ang) * dist).toFixed(1)}px`);
          s.style.animationDelay = `${(i * 0.012).toFixed(3)}s`;
          wheel.appendChild(s);
        }
      } else {
        // 黑格：红蘑菇云（柱 + 顶盖 + 冲击波环）
        const cloud = el('div', 'compiled-luck-cloud');
        cloud.appendChild(el('i', 'compiled-luck-cloud-stem'));
        wheel.appendChild(cloud);
        wheel.appendChild(el('div', 'compiled-luck-shock'));
      }
      // 结果 ~1s 后盘整体消散
      fxTimer(defId, () => {
        if (!layer.isConnected) { done(); return; }
        host.style.transition = 'opacity 0.5s ease-in';
        host.style.opacity = '0';
        fxTimer(defId, () => {
          host.textContent = '';
          host.style.opacity = '1';
          done();
        }, 560);
      }, 1200);
    }, LUCK_WHEEL_SPIN_MS + 60);
  };
  scheduleCompiledLoop(layer, defId, rnd(3000, 6500), burst);
}

/* ---------- 12. 明镜 mirror（2代，fx-gen2 已编译）：银白呼吸框 + 四角银白护边 ----------
 * 周期镜面大特效：卡面渐被镜纹覆盖（透明度从 0 渐增至完全实化——repeating-linear-gradient
 * 镜面纹理层 opacity 0→1，约 1.8s）→ 100% 实化瞬间发出一道耀眼光芒（白芒扩散）→ 渐隐消失。
 * 间隔 ≥10s 随机（scheduleCompiledLoop）。CSS 见 styles.css .compiled-mirror-*。 */
const MIRROR_TEXTURE_IN_MS = 1800; // 镜纹覆盖渐实时长
const MIRROR_FLASH_MS = 500;       // 实化瞬间耀眼光芒
/** 用户 2026-09-11：明镜已编译特色效果间隔「随机但不小于 3 秒」（全局硬约束 10s → 本协议放宽） */
const MIRROR_MIN_GAP_MS = 3000;
const MIRROR_GAP_JITTER_MS = 9000;

function appendMirrorCompiled(layer: HTMLElement, defId: string): void {
  appendCompiledCorners(layer, 'compiled-mirror-corner'); // §8：四角银白护边
  // 镜面纹理覆盖层（常驻；burst 时透明度渐实）
  const tex = el('div', 'compiled-mirror-texture');
  layer.appendChild(tex);
  const flash = el('div', 'compiled-mirror-flash');
  layer.appendChild(flash);
  const burst = (done: () => void): void => {
    if (!layer.isConnected) { done(); return; }
    // 镜纹覆盖：0 → 100% 实化（透明度 transition；纹理 = 斜向细线镜面层）
    tex.style.transition = `opacity ${MIRROR_TEXTURE_IN_MS}ms ease-in`;
    tex.style.opacity = '1';
    // 实化瞬间：耀眼光芒扩散 → 随后镜纹渐隐
    fxTimer(defId, () => {
      if (!layer.isConnected) { done(); return; }
      flash.classList.add('on');
      tex.style.transition = 'opacity 0.9s ease-out';
      tex.style.opacity = '0';
      fxTimer(defId, () => {
        if (!layer.isConnected) { done(); return; }
        flash.classList.remove('on');
        done();
      }, MIRROR_FLASH_MS + 950);
    }, MIRROR_TEXTURE_IN_MS);
  };
  // 用户 2026-09-11 修改建议：本协议已编译特色效果连续触发间隔改为随机，但【不小于 3 秒】
  scheduleCompiledLoop(layer, defId, rnd(3000, 6500), burst, MIRROR_MIN_GAP_MS, MIRROR_GAP_JITTER_MS);
}

/* ---------- 13. 和平 peace（2代，fx-gen2 已编译）：海蓝↔金币交替呼吸框 + 四角护边 ----------
 * 环绕鸽子：2 只挥翅小鸽沿协议边框轨道环绕盘旋（CSS offset-path 椭圆轨道 + offset-rotate
 * 0deg 保持水平；负 delay 错相 → 永远有鸽子在飞）。偶发休息鸽（大特效 ≥10s）：一只鸽子
 * 从协议框边休息片刻后飞走。鸽子造型复用 fx-gen2 buildDove（CSS .fx-peace-dove）。 */
const PEACE_ORBIT_COUNT = 2;

function appendPeaceCompiled(layer: HTMLElement, defId: string): void {
  appendCompiledCorners(layer, 'compiled-peace-corner'); // §8：四角海蓝护边
  // 环绕轨道：2 只鸽子沿盒子椭圆路径缓速盘旋（各自负 delay 错相）
  const orbit = el('div', 'compiled-peace-orbit');
  for (let i = 0; i < PEACE_ORBIT_COUNT; i++) {
    const dove = buildDove();
    dove.classList.add('compiled-peace-orbit-dove');
    dove.style.animationDuration = `${20 + i * 4}s`; // 每只周期不同 → 非齐步
    dove.style.animationDelay = `${-i * 9}s`;
    orbit.appendChild(dove);
  }
  layer.appendChild(orbit);
  // 偶发休息鸽：从协议框边（上缘随机位）落定休息 → 飞走消散（≥10s 间隔）
  const rest = (done: () => void): void => {
    if (!layer.isConnected) { done(); return; }
    const g = layerGeom(layer);
    if (!g) { fxTimer(defId, () => rest(done), 700); return; }
    const dove = buildDove();
    dove.classList.add('compiled-peace-rest');
    const x = rnd(15, 85); // 框内水平位置（%）
    dove.style.left = `${x.toFixed(1)}%`;
    dove.style.top = '0px';
    dove.style.transform = 'translate(-50%, -70px) scale(0.7)';
    dove.style.opacity = '0';
    layer.appendChild(dove);
    reflowFx(dove);
    // 飞入落定框边休息
    dove.style.transition = 'transform 0.55s cubic-bezier(0.2, 0.8, 0.3, 1.1), opacity 0.25s ease-out';
    dove.style.transform = 'translate(-50%, -18px) scale(0.85)';
    dove.style.opacity = '1';
    // 停留休息片刻（翅膀持续扑扇）后飞走消散
    fxTimer(defId, () => {
      if (!layer.isConnected) { done(); return; }
      dove.style.transition = 'transform 0.7s cubic-bezier(0.5, 0.1, 0.8, 0.4), opacity 0.35s ease-in';
      dove.style.transform = 'translate(-50%, -110px) scale(0.6)';
      dove.style.opacity = '0';
      fxTimer(defId, () => {
        if (dove.isConnected) dove.remove();
        done();
      }, 760);
    }, 2600);
  };
  scheduleCompiledLoop(layer, defId, rnd(3200, 7000), rest);
}

/* ---------- 14. 混乱 chaos（2代，fx-gen2 已编译）：蓝紫相间呼吸框 + 四角蓝紫护边 ----------
 * 周期漩涡大特效：协议中心渐现一团旋转蓝紫漩涡（scale 0.2→1.35 快速扩散 + 旋转）→
 * 扩散至覆盖整张协议牌面后爆炸消散（亮闪 + 渐隐）。间隔 ≥10s 随机（scheduleCompiledLoop）。
 * CSS 见 styles.css .compiled-chaos-*。 */
const CHAOS_BURST_IN_MS = 800;   // 漩涡扩散时长
const CHAOS_BURST_FLASH_MS = 300; // 扩散到整面后爆炸闪

function appendChaosCompiled(layer: HTMLElement, defId: string): void {
  appendCompiledCorners(layer, 'compiled-chaos-corner'); // §8：四角蓝紫护边
  const host = el('div', 'compiled-chaos-host');
  layer.appendChild(host);
  const burst = (done: () => void): void => {
    if (!layer.isConnected) { done(); return; }
    const g = layerGeom(layer);
    if (!g) { fxTimer(defId, () => burst(done), 700); return; }
    host.textContent = '';
    // 漩涡：中心起 scale 0.2 → 1.35 扩散（覆盖协议面）+ 旋转
    const size = Math.max(g.w, g.h) * 1.5;
    const v = el('div', 'compiled-chaos-vortex');
    v.style.width = `${size.toFixed(1)}px`;
    v.style.height = `${size.toFixed(1)}px`;
    v.style.marginLeft = `${-size / 2}px`;
    v.style.marginTop = `${-size / 2}px`;
    v.style.opacity = '0';
    v.style.transform = 'scale(0.2) rotate(0deg)';
    v.style.transition = `opacity 0.25s ease-out, transform ${CHAOS_BURST_IN_MS}ms cubic-bezier(0.3, 0.9, 0.5, 1)`;
    host.appendChild(v);
    reflowFx(v);
    v.style.opacity = '1';
    v.style.transform = 'scale(1.35) rotate(320deg)';
    // 扩散完成 → 爆炸闪 + 渐隐消散
    fxTimer(defId, () => {
      if (!layer.isConnected) { done(); return; }
      const flash = el('div', 'compiled-chaos-flash');
      host.appendChild(flash);
      reflowFx(flash);
      flash.classList.add('on');
      host.style.transition = 'opacity 0.5s ease-in';
      host.style.opacity = '0';
      fxTimer(defId, () => {
        if (!layer.isConnected) { done(); return; }
        host.textContent = '';
        host.style.opacity = '1';
        done();
      }, 560);
    }, CHAOS_BURST_IN_MS + CHAOS_BURST_FLASH_MS);
  };
  scheduleCompiledLoop(layer, defId, rnd(3000, 6500), burst);
}

/* ---------- 15. 透彻 clarity（2代，fx-gen2 已编译）：淡粉/淡蓝呼吸框 + 四角护边 ----------
 * 周期眼睛圣光（偶尔）：边框四周渐现古埃及眼睛（CSS 造型，位置随机贴边）→ 圣光持续
 * → 2s 后眼睛与圣光渐渐消失；中心金字塔（偶尔）：金色四面体渐现 2s 后消散。间隔 ≥10s
 * （scheduleCompiledLoop 拆两个独立循环）。CSS 见 styles.css .compiled-clarity-*。 */
const CLARITY_EYE_SHOW_MS = 2200; // 眼睛 + 圣光持续（渐现→停留→渐隐）

function appendClarityCompiled(layer: HTMLElement, defId: string): void {
  appendCompiledCorners(layer, 'compiled-clarity-corner'); // §8：四角淡粉/淡蓝护边
  const host = el('div', 'compiled-clarity-host');
  layer.appendChild(host);
  // 眼睛圣光 burst：随机贴边位置生成眼睛 + 圣光，停留后消散
  const eyeBurst = (done: () => void): void => {
    if (!layer.isConnected) { done(); return; }
    const g = layerGeom(layer);
    if (!g) { fxTimer(defId, () => eyeBurst(done), 700); return; }
    const wrap = el('div', 'compiled-clarity-eye-wrap');
    const p = nearBorderPoint();
    wrap.style.left = `${p.x.toFixed(1)}%`;
    wrap.style.top = `${p.y.toFixed(1)}%`;
    const halo = el('div', 'compiled-clarity-eye-halo');
    const eye = el('div', 'fx-clarity-eye');
    wrap.appendChild(halo);
    wrap.appendChild(eye);
    host.appendChild(wrap);
    reflowFx(wrap);
    wrap.classList.add('in');
    fxTimer(defId, () => {
      if (!layer.isConnected) { done(); return; }
      wrap.classList.add('out');
      fxTimer(defId, () => {
        if (wrap.isConnected) wrap.remove();
        done();
      }, 700);
    }, CLARITY_EYE_SHOW_MS);
  };
  // 金色金字塔 burst（2026-09-12 重做）：3D 四面体 = 受光左面 + 背光右面 + 前棱高光 + 底影
  // + 上升金色粒子，2s 后消散（旧版两个同色三角看着像黄色三角形，用户反馈）
  const pyramidBurst = (done: () => void): void => {
    if (!layer.isConnected) { done(); return; }
    const g = layerGeom(layer);
    if (!g) { fxTimer(defId, () => pyramidBurst(done), 700); return; }
    const pyr = el('div', 'compiled-clarity-pyramid');
    pyr.appendChild(el('i', 'compiled-clarity-pyramid-base'));
    pyr.appendChild(el('i', 'compiled-clarity-pyramid-face l'));
    pyr.appendChild(el('i', 'compiled-clarity-pyramid-face r'));
    pyr.appendChild(el('i', 'compiled-clarity-pyramid-edge'));
    for (let i = 0; i < 8; i++) {
      const s = el('i', 'compiled-clarity-pyr-spark');
      s.style.left = `${rnd(-30, 30).toFixed(1)}px`;
      s.style.top = `${rnd(6, 26).toFixed(1)}px`;
      s.style.animationDelay = `${(i * 0.14).toFixed(2)}s`;
      pyr.appendChild(s);
    }
    host.appendChild(pyr);
    reflowFx(pyr);
    pyr.classList.add('in');
    fxTimer(defId, () => {
      if (!layer.isConnected) { done(); return; }
      pyr.classList.add('out');
      fxTimer(defId, () => {
        if (pyr.isConnected) pyr.remove();
        done();
      }, 700);
    }, 2200);
  };
  scheduleCompiledLoop(layer, defId, rnd(3000, 7000), eyeBurst);
  scheduleCompiledLoop(layer, defId, rnd(5000, 10000), pyramidBurst);
}

/* ---------- 16. 寒冰 ice（2代，fx-gen2 已编译）：深蓝呼吸框 + 四角护边 + 雪花常现 ----------
 * 周期冰面覆盖：协议表面偶尔渐现深蓝 30% 冰面（透明度渐增覆盖）→ 持续 2s → 渐消。
 * 间隔随机但不小于 4 秒（用户 2026-09-11；其它协议仍为 ≥10s）。CSS 见 styles.css .compiled-ice-*。 */
const ICE_COVER_MS = 2000; // 冰面覆盖持续（渐现后 2s 再渐隐）
const ICE_MIN_GAP_MS = 4000;   // 用户 2026-09-11：冰面覆盖特效间隔「随机但不小于 4 秒」
const ICE_GAP_JITTER_MS = 8000;

function appendIceCompiled(layer: HTMLElement, defId: string): void {
  appendCompiledCorners(layer, 'compiled-ice-corner'); // §8：四角深蓝护边
  // 常驻雪花（层内 3 片缓慢飘落循环）
  const snow = el('div', 'compiled-ice-snow');
  for (let i = 0; i < 3; i++) snow.appendChild(el('i', 'compiled-ice-snowflake'));
  layer.appendChild(snow);
  // 冰面覆盖层（burst 时透明度渐现）
  const cover = el('div', 'compiled-ice-cover');
  layer.appendChild(cover);
  const burst = (done: () => void): void => {
    if (!layer.isConnected) { done(); return; }
    cover.style.transition = 'opacity 0.8s ease-in';
    cover.style.opacity = '1';
    fxTimer(defId, () => {
      if (!layer.isConnected) { done(); return; }
      cover.style.transition = 'opacity 0.9s ease-out';
      cover.style.opacity = '0';
      fxTimer(defId, done, 950);
    }, ICE_COVER_MS);
  };
  scheduleCompiledLoop(layer, defId, rnd(3000, 6500), burst, ICE_MIN_GAP_MS, ICE_GAP_JITTER_MS);
}

/* ---------- 17. 迷雾 smoke（2代，fx-gen2 已编译）：浓灰呼吸框 + 四角护边 ----------
 * 周期触手雾（两式交替，用户 2026-09-11 要求触手必须【分布在协议边框四周】而不是挤在一处）：
 *  ① 边框式：四条边各一处浓雾团 + 各 2 根灰色章鱼触手（朝框内扭动）；
 *  ② 中心式：中心一大团浓雾 + 8 根触手向四周放射。
 * 两式均 2s 后缩回、雾渐消；间隔 ≥10s。CSS 见 styles.css .compiled-smoke-*。 */
const SMOKE_TENTACLE_MS = 2000; // 触手伸出停留
const SMOKE_BORDER_SPOTS: Array<{ cls: string; rot: number }> = [
  { cls: 'tl', rot: 135 },   // 左上角雾团 → 触手朝右下（框内）
  { cls: 'tr', rot: -135 },  // 右上角 → 左下
  { cls: 'bl', rot: 45 },    // 左下角 → 右上
  { cls: 'br', rot: -45 },   // 右下角 → 左上
];

function appendSmokeCompiled(layer: HTMLElement, defId: string): void {
  appendCompiledCorners(layer, 'compiled-smoke-corner'); // §8：四角浓灰护边
  const host = el('div', 'compiled-smoke-host');
  layer.appendChild(host);
  let borderMode = true; // 交替：边框四角雾团 ↔ 中心大雾
  const burst = (done: () => void): void => {
    if (!layer.isConnected) { done(); return; }
    host.textContent = '';
    if (borderMode) {
      // ① 边框式：四角雾团 + 各 2 根触手（方向朝框内）
      const ring = el('div', 'compiled-smoke-ring');
      for (const spot of SMOKE_BORDER_SPOTS) {
        const cell = el('div', `compiled-smoke-cell ${spot.cls}`);
        cell.appendChild(el('i', 'compiled-smoke-cell-fog'));
        for (let k = 0; k < 2; k++) {
          const t = el('div', 'compiled-smoke-tent');
          t.style.setProperty('--rot', `${spot.rot + (k === 0 ? -26 : 22)}deg`);
          t.style.animationDelay = `${(-k * 0.9).toFixed(2)}s`;
          cell.appendChild(t);
        }
        ring.appendChild(cell);
      }
      host.appendChild(ring);
    } else {
      // ② 中心式：中心大雾 + 8 根触手向四周放射
      host.appendChild(el('div', 'compiled-smoke-bigfog'));
      const tent = el('div', 'compiled-smoke-tents');
      for (let i = 0; i < 8; i++) {
        const t = el('div', 'compiled-smoke-tent');
        t.style.setProperty('--rot', `${i * 45}deg`);
        t.style.animationDelay = `${(-i * 0.28).toFixed(2)}s`;
        tent.appendChild(t);
      }
      host.appendChild(tent);
    }
    borderMode = !borderMode;
    reflowFx(host);
    host.classList.add('in');
    fxTimer(defId, () => {
      if (!layer.isConnected) { done(); return; }
      // 触手缩回 + 雾消散
      host.classList.add('out');
      fxTimer(defId, () => {
        host.classList.remove('in', 'out');
        host.textContent = '';
        done();
      }, 800);
    }, SMOKE_TENTACLE_MS);
  };
  scheduleCompiledLoop(layer, defId, rnd(3000, 6500), burst);
}

/* ---------- 18. 恐惧 fear（2代，fx-gen2 已编译）：橙红呼吸框 + 四角护边 ----------
 * 周期染色颤抖：协议中心向四周扩散橙红染色（scale 0.3→1.4）→ 扩散期间协议不断颤抖位移
 * （.compiled-fear-host 整体 jitter）→ 染色覆盖协议本身后停下 → 持续 2s → 染色渐渐消失并
 * 留下一圈橙红残影（阴影环）→ 残影 2s 消散。间隔 ≥10s（scheduleCompiledLoop）。CSS 见
 * styles.css .compiled-fear-*。 */
const FEAR_STAIN_IN_MS = 900;    // 染色扩散
const FEAR_STAIN_HOLD_MS = 2000; // 染色覆盖停留（提示词「持续2秒后消失」）
const FEAR_AFTERIMAGE_MS = 2000; // 残影停留（提示词「留下残影2秒」）

function appendFearCompiled(layer: HTMLElement, defId: string): void {
  appendCompiledCorners(layer, 'compiled-fear-corner'); // §8：四角橙红护边
  const host = el('div', 'compiled-fear-host');
  const stain = el('div', 'compiled-fear-stain');
  host.appendChild(stain);
  const after = el('div', 'compiled-fear-after');
  host.appendChild(after);
  layer.appendChild(host);
  const burst = (done: () => void): void => {
    if (!layer.isConnected) { done(); return; }
    // ① 染色扩散 + 协议颤抖（染色 scale 0.3→1.4，1s；颤抖 0.5s 高频 jitter 随后渐止）
    host.classList.add('shaking');
    stain.style.transition = 'transform 0.5s ease-out, opacity 0.2s ease-out';
    stain.style.transform = 'scale(0.3)';
    stain.style.opacity = '0';
    reflowFx(stain);
    requestAnimationFrame(() => {
      stain.style.transition = `transform ${FEAR_STAIN_IN_MS}ms cubic-bezier(0.3, 0.7, 0.5, 1), opacity 0.15s ease-out`;
      stain.style.transform = 'scale(1.5)';
      stain.style.opacity = '1';
    });
    // ② 染色覆盖协议后停下（颤抖结束）
    fxTimer(defId, () => {
      if (!layer.isConnected) return;
      host.classList.remove('shaking');
      // ③ 覆盖持续 2s → 染色消失 + 残影浮现
      fxTimer(defId, () => {
        if (!layer.isConnected) { done(); return; }
        stain.style.transition = 'opacity 0.7s ease-out';
        stain.style.opacity = '0';
        after.classList.add('in');
        // 残影 2s 后消散
        fxTimer(defId, () => {
          if (!layer.isConnected) { done(); return; }
          after.classList.remove('in');
          after.classList.add('out');
          fxTimer(defId, () => {
            after.classList.remove('out');
            stain.style.opacity = '0';
            done();
          }, 750);
        }, FEAR_AFTERIMAGE_MS);
      }, FEAR_STAIN_HOLD_MS);
    }, FEAR_STAIN_IN_MS + 200);
  };
  scheduleCompiledLoop(layer, defId, rnd(3000, 6500), burst);
}

/* ---------- 19. 腐化 corruption（2代，fx-gen2 已编译）：墨绿呼吸框 + 四角护边 ----------
 * 周期腐蚀：四角渗出墨绿腐蚀液滴（沿边框向下流淌）→ 表面渐渐浮现腐蚀斑纹从四角向中心
 * 蔓延 → 中心聚成一团墨绿毒雾（中浮暗紫骷髅虚影）→ 2s 后雾、骷髅与斑纹一起消散。
 * 间隔 ≥10s（scheduleCompiledLoop）。CSS 见 styles.css .compiled-corruption-*。 */
const CORRUPTION_BURST_MS = 2000; // 毒雾骷髅停留

function appendCorruptionCompiled(layer: HTMLElement, defId: string): void {
  appendCompiledCorners(layer, 'compiled-corruption-corner'); // §8：四角墨绿护边
  // 常驻液滴渗出（四角，慢循环）
  const drip = el('div', 'compiled-corruption-drip');
  for (const pos of ['tl', 'tr', 'bl', 'br'] as const) {
    const d = el('div', `compiled-corruption-drip-drop ${pos}`);
    drip.appendChild(d);
  }
  layer.appendChild(drip);
  const host = el('div', 'compiled-corruption-host');
  layer.appendChild(host);
  const burst = (done: () => void): void => {
    if (!layer.isConnected) { done(); return; }
    host.textContent = '';
    // 毒雾（中心）+ 暗紫骷髅虚影
    const fog = el('div', 'compiled-corruption-fog');
    host.appendChild(fog);
    const skull = el('div', 'compiled-corruption-skull', '☠');
    host.appendChild(skull);
    reflowFx(host);
    host.classList.add('in');
    fxTimer(defId, () => {
      if (!layer.isConnected) { done(); return; }
      host.classList.add('out');
      fxTimer(defId, () => {
        host.classList.remove('in', 'out');
        host.textContent = '';
        done();
      }, 800);
    }, CORRUPTION_BURST_MS);
  };
  scheduleCompiledLoop(layer, defId, rnd(3000, 6500), burst);
}

/* ---------- 20. 战争 war（2代，fx-gen2 已编译）：赤红呼吸框 + 四角护边 ----------
 * 周期战场特效：边框四周两把巨大暗红铁剑互相碰撞摩擦迸火星（2s 渐隐消散）→ 随后中心
 * 浮现残破赤红战旗（硝烟中缓缓飘动 2s 消散）。间隔 ≥10s（scheduleCompiledLoop 拆两循环）。
 * CSS 见 styles.css .compiled-war-*。 */
function appendWarCompiled(layer: HTMLElement, defId: string): void {
  appendCompiledCorners(layer, 'compiled-war-corner'); // §8：四角赤红护边
  const host = el('div', 'compiled-war-host');
  layer.appendChild(host);
  // 双剑互碰 burst：两把巨剑斜交碰撞火星 2s 消散
  const swordsBurst = (done: () => void): void => {
    if (!layer.isConnected) { done(); return; }
    const pair = el('div', 'compiled-war-swords');
    const s1 = buildWarSword('compiled-war-sword l');
    const s2 = buildWarSword('compiled-war-sword r');
    pair.appendChild(s1);
    pair.appendChild(s2);
    for (let i = 0; i < 6; i++) {
      const sp = el('i', 'compiled-war-swordspark');
      pair.appendChild(sp);
    }
    host.appendChild(pair);
    reflowFx(pair);
    pair.classList.add('in');
    fxTimer(defId, () => {
      if (!layer.isConnected) { done(); return; }
      pair.classList.add('out');
      fxTimer(defId, () => {
        if (pair.isConnected) pair.remove();
        done();
      }, 700);
    }, 2000);
  };
  // 战旗 burst：残破赤红战旗在硝烟中飘动
  const flagBurst = (done: () => void): void => {
    if (!layer.isConnected) { done(); return; }
    const flag = el('div', 'compiled-war-flag2');
    flag.appendChild(el('i', 'compiled-war-flag2-banner'));
    flag.appendChild(el('i', 'compiled-war-flag2-smoke'));
    host.appendChild(flag);
    reflowFx(flag);
    flag.classList.add('in');
    fxTimer(defId, () => {
      if (!layer.isConnected) { done(); return; }
      flag.classList.add('out');
      fxTimer(defId, () => {
        if (flag.isConnected) flag.remove();
        done();
      }, 800);
    }, 2000);
  };
  scheduleCompiledLoop(layer, defId, rnd(3000, 6500), swordsBurst);
  scheduleCompiledLoop(layer, defId, rnd(6000, 11000), flagBurst);
}

/* ---------- 21. 勇气 courage（2代，fx-gen2 已编译）：鎏金呼吸框 + 四角护边 ----------
 * 周期湖中剑：中心斜斜插下一道鎏金湖中剑（剑缠金色流光 + 光羽）→ 剑尖插入后扩散一圈
 * 金色波纹 → 2s 后大剑消散；边框四周偶尔燃起一圈金色逆焰（火苗向上逆风飘动 2s 熄灭）。
 * 间隔 ≥10s（scheduleCompiledLoop 拆两循环）。CSS 见 styles.css .compiled-courage-*。 */
function appendCourageCompiled(layer: HTMLElement, defId: string): void {
  appendCompiledCorners(layer, 'compiled-courage-corner'); // §8：四角鎏金护边
  const host = el('div', 'compiled-courage-host');
  layer.appendChild(host);
  // 湖中剑 burst
  const swordBurst = (done: () => void): void => {
    if (!layer.isConnected) { done(); return; }
    const g = layerGeom(layer);
    if (!g) { fxTimer(defId, () => swordBurst(done), 700); return; }
    // 湖中剑：复用 fx-gen2 buildLakeSword 分部件造型（用户 2026-09-11：旧版「和根棍子一样」）
    // size=130 → 部件按 em 缩放；剑尖落在协议中心（marginTop = 剑尖在容器内的偏移 65%），斜插 -14°
    const SWORD_SIZE = 130;
    const sword = buildLakeSword(SWORD_SIZE);
    sword.classList.add('compiled-courage-sword');
    sword.style.left = '50%';
    sword.style.top = '50%';
    sword.style.marginLeft = `${-SWORD_SIZE / 2}px`;
    sword.style.marginTop = `${(-SWORD_SIZE * (7.8 / 12)).toFixed(1)}px`;
    sword.style.transformOrigin = '50% 65%';
    const ripple = el('div', 'compiled-courage-ripple');
    host.appendChild(sword);
    host.appendChild(ripple);
    reflowFx(host);
    host.classList.add('in');
    fxTimer(defId, () => {
      if (!layer.isConnected) { done(); return; }
      ripple.classList.add('on');
      // 剑尖插入瞬间：金色粒子迸发（用户 2026-09-12：附加上更多粒子；落点 = 协议中心）
      const gr = layer.getBoundingClientRect();
      spawnCourageSparks(gr.left + gr.width / 2, gr.top + gr.height / 2, 20);
      // 大剑渐隐消散
      fxTimer(defId, () => {
        host.classList.add('out');
        fxTimer(defId, () => {
          host.classList.remove('in', 'out');
          host.textContent = '';
          done();
        }, 800);
      }, 1800);
    }, 300);
  };
  scheduleCompiledLoop(layer, defId, rnd(3000, 6500), swordBurst);
}

/* ---------- 22. 时间 time（2代，fx-gen2 已编译）：古铜呼吸框 + 斑驳锈质感 + 四角护边 ----------
 * 周期时钟：中心浮现古铜时钟（时针分针快速旋转后骤然静止）→ 时钟连同周围悬浮青铜齿轮
 * 碎片与金色沙粒渐渐消散 2s；边框四周偶尔时间倒流（周围光影倒放流动 2s）。
 * 间隔 ≥10s（scheduleCompiledLoop 拆两循环）。CSS 见 styles.css .compiled-time-*。 */
function appendTimeCompiled(layer: HTMLElement, defId: string): void {
  appendCompiledCorners(layer, 'compiled-time-corner'); // §8：四角古铜护边
  // 斑驳铜锈纹理层（常驻弱覆盖）
  const rust = el('div', 'compiled-time-rust');
  layer.appendChild(rust);
  const host = el('div', 'compiled-time-host');
  layer.appendChild(host);
  const clockBurst = (done: () => void): void => {
    if (!layer.isConnected) { done(); return; }
    host.textContent = '';
    const clock = el('div', 'compiled-time-clock');
    const hour = el('i', 'compiled-time-hand hour');
    const minute = el('i', 'compiled-time-hand minute');
    clock.appendChild(hour);
    clock.appendChild(minute);
    host.appendChild(clock);
    // 青铜齿轮碎片 + 金色沙粒
    for (let i = 0; i < 5; i++) host.appendChild(el('i', 'compiled-time-debris'));
    reflowFx(host);
    host.classList.add('in');
    // 时针分针快速旋转 1.2s 后骤然静止（animation 自然停）
    clock.classList.add('spin');
    fxTimer(defId, () => {
      if (!layer.isConnected) { done(); return; }
      host.classList.add('out');
      fxTimer(defId, () => {
        host.classList.remove('in', 'out');
        host.textContent = '';
        done();
      }, 800);
    }, 2400);
  };
  scheduleCompiledLoop(layer, defId, rnd(3000, 6500), clockBurst);
}

/* ---------- 23. 同化 assimilation（2代，fx-gen2 已编译）：青碧呼吸框 + 四角护边 ----------
 * 周期光带：边框四周两条青碧光带（首尾相衔游鱼般环绕协议交织盘旋 2s 渐散）；中心光珠
 * 涟漪（偶尔）：中心浮现青碧光珠向四周扩散涟漪 2s。间隔 ≥10s（scheduleCompiledLoop 拆两
 * 循环）。CSS 见 styles.css .compiled-assimilation-*。 */
function appendAssimilationCompiled(layer: HTMLElement, defId: string): void {
  appendCompiledCorners(layer, 'compiled-assimilation-corner'); // §8：四角青碧护边
  const host = el('div', 'compiled-assimilation-host');
  layer.appendChild(host);
  // 光带环绕 burst：两条弧形光带（圆环轨道错相旋转）
  const ribbonBurst = (done: () => void): void => {
    if (!layer.isConnected) { done(); return; }
    const orbit = el('div', 'compiled-assimilation-orbit');
    for (let i = 0; i < 2; i++) {
      const band = el('div', `compiled-assimilation-band b${i + 1}`);
      orbit.appendChild(band);
    }
    host.appendChild(orbit);
    reflowFx(host);
    host.classList.add('in');
    fxTimer(defId, () => {
      if (!layer.isConnected) { done(); return; }
      host.classList.add('out');
      fxTimer(defId, () => {
        host.classList.remove('in', 'out');
        host.textContent = '';
        done();
      }, 800);
    }, 2200);
  };
  // 光珠涟漪 burst
  const orbBurst = (done: () => void): void => {
    if (!layer.isConnected) { done(); return; }
    host.textContent = '';
    const orb = el('div', 'compiled-assimilation-orb');
    host.appendChild(orb);
    reflowFx(host);
    host.classList.add('in');
    fxTimer(defId, () => {
      if (!layer.isConnected) { done(); return; }
      host.classList.add('out');
      fxTimer(defId, () => {
        host.classList.remove('in', 'out');
        host.textContent = '';
        done();
      }, 800);
    }, 2200);
  };
  scheduleCompiledLoop(layer, defId, rnd(3000, 6500), ribbonBurst);
  scheduleCompiledLoop(layer, defId, rnd(6000, 11000), orbBurst);
}

/* ---------- 24. 联合 unity（2代，fx-gen2 已编译）：亮蓝/银白交替呼吸框 + 四角护边 ----------
 * 周期众星拱月：边框四周数道亮蓝光带从四面八方汇聚向协议中心（2s 渐散）；中心光核（偶尔）：
 * 中心浮现亮蓝光核 → 向四周扩散银白冲击波（2s 消散）。间隔 ≥10s（scheduleCompiledLoop 拆两
 * 循环）。CSS 见 styles.css .compiled-unity-*。 */
function appendUnityCompiled(layer: HTMLElement, defId: string): void {
  appendCompiledCorners(layer, 'compiled-unity-corner'); // §8：四角亮蓝护边
  const host = el('div', 'compiled-unity-host');
  layer.appendChild(host);
  // 众星拱月 burst：8 条光带自四边汇聚中心
  const convergeBurst = (done: () => void): void => {
    if (!layer.isConnected) { done(); return; }
    host.textContent = '';
    const g = layerGeom(layer);
    if (!g) { fxTimer(defId, () => convergeBurst(done), 700); return; }
    const cx = g.cx;
    const cy = g.cy;
    const N = 8;
    for (let i = 0; i < N; i++) {
      const ang = (i / N) * Math.PI * 2;
      // 起点在层外（沿方向距中心 diag/2 + 余量）
      const R = g.diag * 0.62;
      const sx = cx + Math.cos(ang) * R;
      const sy = cy + Math.sin(ang) * R;
      const band = el('div', 'compiled-unity-band');
      const dist = R;
      band.style.left = `${sx.toFixed(1)}px`;
      band.style.top = `${sy.toFixed(1)}px`;
      band.style.width = `${dist.toFixed(1)}px`;
      band.style.transform = `rotate(${(Math.atan2(cy - sy, cx - sx) * 180) / Math.PI}deg)`;
      band.style.animationDelay = `${(i * 0.04).toFixed(2)}s`;
      host.appendChild(band);
    }
    reflowFx(host);
    host.classList.add('in');
    fxTimer(defId, () => {
      if (!layer.isConnected) { done(); return; }
      host.classList.add('out');
      fxTimer(defId, () => {
        host.classList.remove('in', 'out');
        host.textContent = '';
        done();
      }, 800);
    }, 2200);
  };
  // 中心光核 + 银白冲击波
  const coreBurst = (done: () => void): void => {
    if (!layer.isConnected) { done(); return; }
    host.textContent = '';
    const core = el('div', 'compiled-unity-core');
    const wave = el('div', 'compiled-unity-wave');
    host.appendChild(core);
    host.appendChild(wave);
    reflowFx(host);
    host.classList.add('in');
    fxTimer(defId, () => {
      if (!layer.isConnected) { done(); return; }
      host.classList.add('out');
      fxTimer(defId, () => {
        host.classList.remove('in', 'out');
        host.textContent = '';
        done();
      }, 800);
    }, 2200);
  };
  scheduleCompiledLoop(layer, defId, rnd(3000, 6500), convergeBurst);
  scheduleCompiledLoop(layer, defId, rnd(6000, 11000), coreBurst);
}

/* ---------- 25. 多元 diversity（2代，fx-gen2 已编译）：彩色交替呼吸框 + 四角护边 ----------
 * 边框交替显示 5 色——颜色【取自场上其它已编译协议的边框色】（syncDiversityColors 每帧按
 * state 收集：双方 3 线 compiled 协议的 defId → 主题色表 → 写 CSS 变量 --dv1..5（border）
 * 与 --dvs1..5（shadow 串）到 body 级层；不足 5 种时在已有色间循环复用，仍 5 段交替）。
 * 周期中心棱镜：彩色光棱缓缓旋转并向四周折射彩色光斑 2s 后消散。间隔 ≥10s。
 * CSS 见 styles.css .compiled-diversity-*。 */

/** 协议已编译主色表（syncDiversityColors 取色用；已在 protocol-colors.ts 与 fx-gen2 共用） */

/** diversity 已编译 5 色取自【场上另外 5 个协议】的边框色（每帧渲染调用；变量写 body 级层）。
 *  2026-09-12 用户澄清：不看这些协议是否已编译——双方协议格共 6 个，去掉多元自身正好 5 个，
 *  直接按这 5 个协议的主题色轮换（旧实现只收已编译协议 → 前期常不足 5 色而重点取色）。 */
export function syncDiversityColors(s: GameState): void {
  const layer = compiledFx.get('diversity');
  if (!layer) return;
  const seen = new Set<string>();
  const colors: string[] = [];
  for (const p of s.players) {
    for (const proto of p.protocols) {
      const defId = proto.defId;
      if (defId === 'diversity' || seen.has(defId)) continue;
      const c = COMPILED_PROTOCOL_COLORS[defId];
      if (!c) continue;
      seen.add(defId);
      colors.push(c);
    }
  }
  if (colors.length === 0) return; // 无其它协议（理论不发生）→ 保留默认 5 色兜底
  // 不足 5 种：在已有色间循环复用（保持 5 段交替观感）
  const arr: string[] = [];
  for (let i = 0; i < 5; i++) arr.push(colors[i % colors.length]);
  setDiversityPalette(arr);
}

/** 多元 5 色调色板（syncDiversityColors 每帧刷新）+ 当前显示索引（appendDiversityCompiled 的
 *  JS 定时器轮换）。配色【不】走 CSS 关键帧引用 var()：Chromium 下关键帧内 var() 在变量被
 *  反复改写后会停止刷新（用户 2026-09-11 反馈「5 色切换隔一段时间之后会失效」），
 *  改为 JS 定时改写 --dvc/--dvs（当前色）→ 切换恒定有效，且每种色停留时间可控（≥1s）。 */
let diversityPalette: string[] = [];
let diversityIdx = 0;

/** 写出当前索引的颜色到已编译层 CSS 变量（--dvc 边框色 / --dvs 主辉光 / --dvs2 外辉光 / --dvs3 内辉光） */
function applyDiversityColor(): void {
  const layer = compiledFx.get('diversity');
  if (!layer || diversityPalette.length === 0) return;
  const c = diversityPalette[diversityIdx % diversityPalette.length];
  layer.style.setProperty('--dvc', c);
  layer.style.setProperty('--dvs', hexToRgba(c, 0.85));
  layer.style.setProperty('--dvs2', hexToRgba(c, 0.42));
  layer.style.setProperty('--dvs3', hexToRgba(c, 0.34));
}

/** 调色板更新入口：色板变化时立即刷新一次（保证列表与场上协议同步） */
function setDiversityPalette(arr: string[]): void {
  diversityPalette = arr;
  applyDiversityColor();
}

/* ===== 2代 diversity-3 多元顶常驻：该链路中每张不同协议的正面卡亮起「本协议主题色」微光 +
 *  该线能量槽泛起缓慢流动的彩色流光（用户 2026-09-11：多元3 卡牌特效此前缺失）
 *  生效口径与引擎 valueModifier 一致（create.ts stackValue）：链路中任一张 faceUp diversity-3
 *  且顶指令未被 inertia-0 禁用 → 该线生效；且链路中存在 faceUp 非多元卡（"任何非多元的正面
 *  朝上的卡牌"）。key：卡 uid（微光）/ `${owner}-${line}`（能量槽流光）。 ===== */
const div3CardGlows = new Map<string, HTMLElement>();
const div3LineFlows = new Map<string, HTMLElement>();

export function syncDiversity3Fx(s: GameState): void {
  const activeCards = new Set<string>();
  const activeLines = new Set<string>();
  for (const owner of [0, 1] as PlayerId[]) {
    for (const line of [0, 1, 2] as Line[]) {
      const stack = s.players[owner].stacks[line];
      const hasD3 = stack.some(
        (c) => c.defId === 'diversity-3' && c.faceUp && !cardCommandDisabled(s, c, 'top'),
      );
      if (!hasD3) continue;
      // 2026-09-12 用户反馈「多元3 的卡牌特效没有被触发」→ 放宽：
      // ① 只要该线有正面 diversity-3，能量槽彩色流光就常驻（原先要求链路里有非多元正面卡才铺，
      //    条件不满足时整条线一点特效都没有）；
      // ② 链路内「非多元正面卡」按各自协议色亮边框（卡文条件句的效果）。
      const others = stack.filter((c) => c.faceUp && c.defId.split('-')[0] !== 'diversity');
      // ① 每张非多元正面卡：边框亮起其所属协议主题色微光
      for (const card of others) {
        activeCards.add(card.uid);
        const node = document.querySelector<HTMLElement>(`[data-uid="${card.uid}"]`);
        if (!node) continue;
        let glow = div3CardGlows.get(card.uid);
        if (!glow) {
          glow = el('div', 'fx-div3-cardglow');
          glow.dataset.div3CardKey = card.uid;
          div3CardGlows.set(card.uid, glow);
          document.body.appendChild(glow);
        }
        const color = protocolColorOf(card.defId);
        glow.style.setProperty('--dc', color);
        glow.style.setProperty('--dcg', hexToRgba(color, 0.6));
        const r = node.getBoundingClientRect();
        glow.style.left = `${r.left - 5}px`;
        glow.style.top = `${r.top - 5}px`;
        glow.style.width = `${r.width + 10}px`;
        glow.style.height = `${r.height + 10}px`;
      }
      // ② 该线能量槽：缓慢流动的彩色流光
      const key = `${owner}-${line}`;
      activeLines.add(key);
      const shell = document.querySelector<HTMLElement>(
        `.stack-slot[data-player="${owner}"][data-line="${line}"] .battery-shell`
      );
      if (!shell) continue;
      let flow = div3LineFlows.get(key);
      if (!flow) {
        flow = el('div', 'fx-div3-lineflow');
        flow.dataset.div3LineKey = key;
        div3LineFlows.set(key, flow);
        document.body.appendChild(flow);
      }
      const sr = shell.getBoundingClientRect();
      flow.style.left = `${sr.left - 3}px`;
      flow.style.top = `${sr.top - 3}px`;
      flow.style.width = `${sr.width + 6}px`;
      flow.style.height = `${sr.height + 6}px`;
    }
  }
  for (const [uid, glow] of div3CardGlows) {
    if (!activeCards.has(uid)) { glow.remove(); div3CardGlows.delete(uid); }
  }
  for (const [key, flow] of div3LineFlows) {
    if (!activeLines.has(key)) { flow.remove(); div3LineFlows.delete(key); }
  }
}

function appendDiversityCompiled(layer: HTMLElement, defId: string): void {
  appendCompiledCorners(layer, 'compiled-diversity-corner'); // §8：四角多彩护边
  // 5 色轮换（用户 2026-09-11：要求切换持续有效、每种色停留 ≥1s、间隔随机）：
  // JS 自调度改写 --dvc/--dvs，不依赖关键帧内的 var()（后者会失效）
  const cycle = (): void => {
    if (!layer.isConnected) return;
    diversityIdx = (diversityIdx + 1) % 5;
    applyDiversityColor();
    fxTimer(defId, cycle, rnd(1300, 2800));
  };
  fxTimer(defId, cycle, rnd(1300, 2800));
  const host = el('div', 'compiled-diversity-host');
  layer.appendChild(host);
  const prismBurst = (done: () => void): void => {
    if (!layer.isConnected) { done(); return; }
    host.textContent = '';
    const prism = el('div', 'compiled-diversity-prism');
    // 5 面三角（五色棱镜）——颜色优先取场上其它已编译协议色（与边框 5 色一致）
    const COLORS = (diversityPalette.length === 5
      ? diversityPalette
      : ['#ff5a6e', '#ffd24d', '#4ee0c0', '#5aa0ff', '#c07bff']);
    for (let i = 0; i < 5; i++) {
      const f = el('i', 'compiled-diversity-prism-face');
      f.style.background = COLORS[i];
      f.style.transform = `rotate(${i * 72}deg)`;
      prism.appendChild(f);
    }
    host.appendChild(prism);
    // 折射光斑（数量与大小提升，配合加大后的棱镜）
    for (let i = 0; i < 10; i++) {
      const s = el('i', 'compiled-diversity-gleam');
      s.style.background = COLORS[i % 5];
      host.appendChild(s);
    }
    reflowFx(host);
    host.classList.add('in');
    fxTimer(defId, () => {
      if (!layer.isConnected) { done(); return; }
      host.classList.add('out');
      fxTimer(defId, () => {
        host.classList.remove('in', 'out');
        host.textContent = '';
        done();
      }, 800);
    }, 2400);
  };
  scheduleCompiledLoop(layer, defId, rnd(3000, 6500), prismBurst);
}

/** 新 10 协议已编译特效分发（buildCompiledFx 内调用；fire/light/darkness/water/life
 *  走既有分支，不在此列）。每个 builder 只建持久子结构 + 起调度，动画全部在层内。 */
function appendNewCompiledFx(layer: HTMLElement, defId: string): void {
  switch (defId) {
    case 'death': appendDeathCompiled(layer, defId); break;
    case 'spirit': appendSpiritCompiled(layer, defId); break;
    case 'gravity': appendGravityCompiled(layer, defId); break;
    case 'psychic': appendPsychicCompiled(layer, defId); break;
    case 'plague': appendPlagueCompiled(layer, defId); break;
    case 'metal': appendMetalCompiled(layer, defId); break;
    case 'speed': appendSpeedCompiled(layer, defId); break;
    case 'love': appendLoveCompiled(layer, defId); break;
    case 'hate': appendHateCompiled(layer, defId); break;
    case 'apathy': appendApathyCompiled(layer, defId); break;
    case 'luck': appendLuckCompiled(layer, defId); break;
    case 'mirror': appendMirrorCompiled(layer, defId); break;
    case 'peace': appendPeaceCompiled(layer, defId); break;
    case 'chaos': appendChaosCompiled(layer, defId); break;
    case 'clarity': appendClarityCompiled(layer, defId); break;
    case 'ice': appendIceCompiled(layer, defId); break;
    case 'smoke': appendSmokeCompiled(layer, defId); break;
    case 'fear': appendFearCompiled(layer, defId); break;
    case 'corruption': appendCorruptionCompiled(layer, defId); break;
    case 'war': appendWarCompiled(layer, defId); break;
    case 'courage': appendCourageCompiled(layer, defId); break;
    case 'time': appendTimeCompiled(layer, defId); break;
    case 'assimilation': appendAssimilationCompiled(layer, defId); break;
    case 'unity': appendUnityCompiled(layer, defId); break;
    case 'diversity': appendDiversityCompiled(layer, defId); break;
    default: break;
  }
}

/** 草稿轮选总次数（单源于引擎 create.DRAFT_PICK_COUNT；1-2-2-1 = 6 次）。
 *  轮选归属按 draftStarter 派生（draftRoundOwner）——掷硬币先手机制（2026-09-03）。 */

/** 玩家已选协议（按选择顺序）：归属 = 该轮 owner 座位（starter 派生） */
function picksOf(s: GameState, player: PlayerId): ProtocolDef[] {
  return s.draftPicks.filter((_, i) => draftRoundOwner(s.draftStarter, i) === player);
}

/** 一方的已选协议列：loading 面 PNG 按选择顺序竖排；空槽显示「尚未选择」占位。
 *  本回合选中的协议（尚未完成该回合）可【拖出选择框】取消选择（回到协议池原位） */
function renderPickColumn(s: GameState, player: PlayerId, drafter: PlayerId, cb: UiCallbacks): HTMLElement {
  const col = el('div', `draft-picks p${player + 1}${drafter === player ? ' active' : ''}`);
  const title = el('div', 'draft-picks-title', `玩家 ${player + 1} 已选`);
  if (drafter === player) title.appendChild(el('span', 'draft-picks-turn', '● 轮选'));
  col.appendChild(title);
  const list = el('div', 'draft-picks-list');
  const picks = picksOf(s, player);
  // 本回合（尚未结束）已选的 defId 集合：可拖出取消；前几个回合选的不行
  const turnStart = draftTurnRange(s.draftStarter, s.draftRound).start;
  const currentTurnPicks = new Set(s.draftPicks.slice(turnStart).map((p) => p.defId));
  // 本轮刚选中的协议（选择列表最后一项）加进场动画
  const newest = s.draftRound > 0 ? s.draftPicks[s.draftRound - 1] : null;
  for (let i = 0; i < 3; i++) {
    const pick = picks[i];
    if (!pick) {
      list.appendChild(el('div', 'draft-pick-empty', '尚未选择'));
      continue;
    }
    const card = el('div', 'draft-pick-card' + (newest && newest.defId === pick.defId ? ' new' : ''));
    const wrap = el('div', 'pick-img-wrap');
    const img = document.createElement('img');
    img.src = protocolImgSrc(pick.defId, false);
    img.alt = pick.name;
    wrap.appendChild(img);
    card.appendChild(wrap);
    card.appendChild(el('div', 'draft-pick-name', pick.name));
    // 已选协议卡也触发展示框：hover 即时预览 + 单击固定到【本玩家侧】展示框（规则同池卡：
    // 本侧未固定时 hover 生效；点击固定后 hover 不覆盖；再点同卡取消固定）；双击放大查看。
    card.addEventListener('mouseenter', () => hoverDraftPreview(player, pick.defId));
    bindClickOrDouble(
      card,
      () => pinDraftPreview(player, pick.defId),
      () => openZoom(pick.defId, true, true, false),
      false
    );
    if (drafter === player && currentTurnPicks.has(pick.defId)) {
      // 本回合已选、可取消：拖出选择框取消选择（卡上提示可拖出）
      card.classList.add('unpickable');
      card.title = '拖出选择框可取消本回合选择';
      bindDraftUnpick(card, cb, pick.defId, player);
    }
    list.appendChild(card);
  }
  col.appendChild(list);
  return col;
}

/** 中间协议池：全部 30 套协议（1代+2代并池，2026-09-03），每行 4 个；悬停聚焦。
 *  选中方式：拖拽协议卡到【当前轮选者】的选择框松手（选中）；松手位置不在自己的
 *  选择框区域 → 丝滑平移回原卡位置。双击协议卡可放大查看协议图。已选协议变灰禁用。 */
/** 中间协议池（引擎池 = 随机池/禁用后的剩余协议；世代筛选 chips 之上再过滤）：
 *  选择步骤 = 拖拽选中（常规）；禁用步骤（banStep）= 单击直接禁用 */
function renderDraftPool(s: GameState, cb: UiCallbacks, banStep: boolean, activePlayer: PlayerId): HTMLElement {
  const pool = el('div', 'draft-pool' + (banStep ? ' draft-pool-ban' : ''));
  const drafter = getCurrentDrafter(s);
  for (const proto of getDraftPool(s)) {
    // 世代筛选：被隐藏组的协议不进池（不渲染 = 不可选/不可禁/不可拖）
    if (!draftEnabledGroups.has(proto.set)) continue;
    const card = el('div', 'draft-card');
    const wrap = el('div', 'draft-card-img-wrap');
    const img = document.createElement('img');
    img.className = 'draft-card-img';
    img.src = protocolImgSrc(proto.defId, false);
    img.alt = proto.name;
    wrap.appendChild(img);
    card.appendChild(wrap);
    card.appendChild(el('div', 'draft-card-name', proto.name));
    card.appendChild(el('div', 'draft-card-commands', proto.commands.join(' · ')));
    // 悬浮即时预览：移入协议卡 → 操作者侧展示框显示该协议；移出整池恢复固定/提示。
    // 点击（单击）→ 固定显示到操作者侧（再点其它卡切换）；双击仍放大查看（不冲突）。
    card.addEventListener('mouseenter', () => hoverDraftPreview(activePlayer, proto.defId));
    const pinView = (): void => pinDraftPreview(activePlayer, proto.defId);
    if (banStep) {
      card.dataset.defId = proto.defId;
      card.title = `点击禁用「${proto.name}」（本局不可选；共需禁用 ${DRAFT_BAN_TOTAL} 个）`;
      card.appendChild(el('span', 'draft-ban-badge', '禁用'));
      // 禁用前先把协议固定显示到操作者侧（禁用后卡移出池，展示框仍保留详情供查看）
      bindClickOrDouble(
        card,
        () => {
          pinView();
          cb.onDraftBan(proto.defId);
        },
        () => openZoom(proto.defId, true, true, false),
        false
      );
    } else {
      card.dataset.defId = proto.defId;
      // 单击 = 固定展示（选择靠拖拽）；双击放大查看协议图
      bindClickOrDouble(card, pinView, () => openZoom(proto.defId, true, true, false), false);
      bindDraftDrag(card, s, cb, proto.defId, drafter);
    }
    pool.appendChild(card);
  }
  return pool;
}

/** 拖拽选协议（与卡牌拖拽同款：幽灵卡跟随光标、原卡变暗、无过渡延迟）：
 *  落入当前轮选者选择框 → 选中；否则丝滑平移回原卡位置 */
function bindDraftDrag(card: HTMLElement, s: GameState, cb: UiCallbacks, defId: string, drafter: PlayerId): void {
  card.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    const startX = e.clientX;
    const startY = e.clientY;
    let active = false;
    let ghost: HTMLElement | null = null;
    let gw = 0;
    let gh = 0;
    const targetSel = `.draft-picks.p${drafter + 1}`;
    const cleanup = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.classList.remove('dragging');
      card.classList.remove('dragging-src');
      document.querySelector(targetSel)?.classList.remove('drop-target');
    };
    const positionGhost = (ev: MouseEvent) => {
      if (!ghost) return;
      // 幽灵卡中心略偏上跟随光标（与拖拽打牌一致）
      ghost.style.transform = `translate(${ev.clientX - gw / 2}px, ${ev.clientY - gh / 2 + 40}px) scale(0.9)`;
    };
    const beginDrag = (ev: MouseEvent) => {
      active = true;
      document.body.classList.add('dragging');
      card.classList.add('dragging-src');
      const r = card.getBoundingClientRect();
      gw = r.width;
      gh = r.height;
      ghost = card.cloneNode(true) as HTMLElement;
      ghost.classList.add('draft-drag-ghost');
      ghost.style.width = `${gw}px`;
      ghost.style.height = `${gh}px`;
      document.body.appendChild(ghost);
      positionGhost(ev);
      document.querySelector(targetSel)?.classList.add('drop-target');
    };
    const animateBack = (g: HTMLElement, tx: number, ty: number) => {
      g.classList.add('returning');
      g.style.transform = `translate(${tx}px, ${ty}px) scale(1)`;
      g.style.opacity = '0';
      window.setTimeout(() => g.remove(), 320);
    };
    const onMove = (ev: MouseEvent) => {
      if (!active) {
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) > 6) beginDrag(ev);
        return;
      }
      ev.preventDefault();
      positionGhost(ev);
    };
    const onUp = (ev: MouseEvent) => {
      const hit = document.elementFromPoint(ev.clientX, ev.clientY);
      const inTarget = hit ? (hit as HTMLElement).closest(targetSel) !== null : false;
      const g = ghost;
      cleanup();
      if (inTarget && g) {
        // 落入自己的选择框：选中（renderApp 重建草案界面）
        g.remove();
        cb.onDraftPick(defId);
      } else if (g) {
        // 松手位置不是自己的选择框：丝滑平移回原卡位置
        const r = card.getBoundingClientRect();
        animateBack(g, r.left, r.top);
      }
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}

/** 拖出取消选协议：把【本回合】已选的选择框内协议拖出 → 动画回到协议池原位 → 取消选择 */
function bindDraftUnpick(node: HTMLElement, cb: UiCallbacks, defId: string, player: PlayerId): void {
  node.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    const startX = e.clientX;
    const startY = e.clientY;
    let active = false;
    let ghost: HTMLElement | null = null;
    let gw = 0;
    let gh = 0;
    const colSel = `.draft-picks.p${player + 1}`;
    const cleanup = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.classList.remove('dragging');
    };
    const positionGhost = (ev: MouseEvent) => {
      if (!ghost) return;
      ghost.style.transform = `translate(${ev.clientX - gw / 2}px, ${ev.clientY - gh / 2 + 40}px) scale(0.9)`;
    };
    const beginDrag = (ev: MouseEvent) => {
      active = true;
      document.body.classList.add('dragging');
      const r = node.getBoundingClientRect();
      gw = r.width;
      gh = r.height;
      ghost = node.cloneNode(true) as HTMLElement;
      ghost.classList.add('draft-drag-ghost');
      ghost.style.width = `${gw}px`;
      ghost.style.height = `${gh}px`;
      document.body.appendChild(ghost);
      positionGhost(ev);
    };
    const animateBack = (g: HTMLElement, tx: number, ty: number) => {
      g.classList.add('returning');
      g.style.transform = `translate(${tx}px, ${ty}px) scale(1)`;
      g.style.opacity = '0';
      window.setTimeout(() => g.remove(), 300);
    };
    const onMove = (ev: MouseEvent) => {
      if (!active) {
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) > 6) beginDrag(ev);
        return;
      }
      ev.preventDefault();
      positionGhost(ev);
    };
    const onUp = (ev: MouseEvent) => {
      const hit = document.elementFromPoint(ev.clientX, ev.clientY);
      const inColumn = hit ? (hit as HTMLElement).closest(colSel) !== null : false;
      const g = ghost;
      cleanup();
      if (!inColumn && g) {
        // 拖出选择框：动画回到协议池原位后取消选择（池为引擎池：随机池/禁用后剩
        // 余——按 data-def-id 定位，不再按全量池索引）
        const pool = document.querySelector('.draft-pool');
        const target = pool
          ? pool.querySelector<HTMLElement>(`.draft-card[data-def-id="${defId}"]`)
          : null;
        if (target) {
          const r = target.getBoundingClientRect();
          animateBack(g, r.left, r.top);
          window.setTimeout(() => cb.onDraftUnpick(defId), 300);
        } else {
          g.remove();
          cb.onDraftUnpick(defId);
        }
      } else if (g) {
        // 仍在选择框内：丝滑回原位
        const r = node.getBoundingClientRect();
        animateBack(g, r.left, r.top);
      }
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}

/**
 * 草稿页世代筛选（2026-09-03 用户需求）：按 set 组（1代/2代 × 基础/拓展）显隐协议池。
 * 默认全开（本局池 = 两代并池 30 套，或随机池 12 套）；chip 永不锁定（允许可用池 <6 套，
 * 仅给非阻塞提示）。新局由 resetUiState 复位为全开。
 */
const DRAFT_GROUP_LABELS: ReadonlyArray<readonly [string, string]> = [
  ['MN01', '1代 基础'],
  ['AX01', '1代 拓展'],
  ['MN02', '2代 基础'],
  ['AX02', '2代 拓展'],
  ['MN03', '3代 基础'],
  ['AX03', '3代 拓展'],
];
let draftEnabledGroups: Set<string> = new Set(DRAFT_GROUP_LABELS.map(([g]) => g));

/* ===== 草稿 hover 展示框（修改提示词 21）：鼠标悬停协议池卡 → 下方展示框放大协议图
 * + 名称/座右铭/关键词/定位/六维评分/点评/推荐搭配协议/推荐流派（数据：protocolRatings.ts）===== */
/** 双方玩家的展示框容器（renderDraft 每次重建并登记；玩家 N → [N]） */
const draftPreviewHosts: (HTMLElement | null)[] = [null, null];
/** 当前被点击固定的协议（点击池卡 → 显示到操作者侧展示框；重渲染后恢复显示） */
let draftPinned: { player: PlayerId; defId: string } | null = null;

/** 构建评分详情面板（buildCardTextEl 同款视觉；数据缺失的协议（无评分条目）降级显示基础信息）。
 *  导出供图鉴页复用（home.ts：协议封面 hover → 右侧展示框显示该协议详情）。 */
export function buildProtocolRatingPanel(defId: string): HTMLElement {
  const box = el('div', 'draft-preview-body');
  const proto = getProtocolDef(defId);
  const rating = PROTOCOL_RATINGS.find((r) => r.defId === defId);
  const titleRow = el('div', 'draft-preview-head');
  titleRow.appendChild(el('div', 'draft-preview-name', proto.name));
  titleRow.appendChild(el('div', 'draft-preview-motto', proto.loadingText));
  box.appendChild(titleRow);
  if (rating && rating.position) box.appendChild(el('div', 'draft-preview-position', `定位：${rating.position}`));
  box.appendChild(el('div', 'draft-preview-commands', `关键词：${proto.commands.join(' · ')}`));
  if (rating) {
    const scoreRow = el('div', 'draft-preview-scores');
    for (const [k, v] of Object.entries(rating.scores)) {
      scoreRow.appendChild(el('span', 'draft-score-chip', `${k} ${v}`));
    }
    box.appendChild(scoreRow);
    if (rating.review) box.appendChild(el('div', 'draft-preview-review', rating.review));
    if (rating.pairs.length > 0) {
      const seg = el('div', 'draft-preview-seg');
      seg.appendChild(el('div', 'draft-preview-seg-label', '推荐搭配协议'));
      for (const p of rating.pairs) seg.appendChild(el('div', 'draft-preview-item', p));
      box.appendChild(seg);
    }
    if (rating.styles.length > 0) {
      const seg = el('div', 'draft-preview-seg');
      seg.appendChild(el('div', 'draft-preview-seg-label', '推荐流派'));
      for (const st of rating.styles) seg.appendChild(el('div', 'draft-preview-item', st));
      box.appendChild(seg);
    }
  }
  return box;
}

/** 展示某协议到指定玩家侧展示框（图 + 详情）；host 缺失（非草稿页）时 no-op */
function renderToPreview(player: PlayerId, defId: string): void {
  const host = draftPreviewHosts[player];
  if (!host) return;
  host.textContent = '';
  host.dataset.empty = '0';
  const proto = getProtocolDef(defId);
  // 图容器（竖图逆时针旋转 90° 后横置展示——与选择框卡图同款比例法）
  const fig = el('div', 'draft-preview-fig');
  const img = document.createElement('img');
  img.className = 'draft-preview-img';
  img.src = protocolImgSrc(defId, false);
  img.alt = proto.name;
  fig.appendChild(img);
  host.appendChild(fig);
  host.appendChild(buildProtocolRatingPanel(defId));
}

/** 侧展示框回到空态提示 */
function resetPreviewToHint(player: PlayerId): void {
  const host = draftPreviewHosts[player];
  if (!host) return;
  host.textContent = '';
  host.dataset.empty = '1';
  host.appendChild(el('div', 'draft-preview-hint', '点击中间协议卡\n在此固定查看详情'));
}

/** 点击固定：当前操作者侧展示框显示该协议详情；再次点击【同一张】已固定的卡 → 取消固定
 *  （回到 hover 自由预览）；点击其它卡 → 切换固定目标。重渲染按 draftPinned 恢复。 */
function pinDraftPreview(player: PlayerId, defId: string): void {
  // 同卡再点 = 取消固定（hover 恢复可用）
  if (draftPinned && draftPinned.player === player && draftPinned.defId === defId) {
    draftPinned = null;
    resetPreviewToHint(player);
    return;
  }
  draftPinned = { player, defId };
  renderToPreview(player, defId);
  // 另一侧总是清回提示（防止换操作者后旧内容残留）
  const other: PlayerId = player === 0 ? 1 : 0;
  if (draftPreviewHosts[other]) resetPreviewToHint(other);
}

/** hover 即时预览：把协议显示到操作者侧展示框（与点击固定共用同一展示框）。
 *  规则：本侧【未固定】时 hover 自由预览；本侧【已固定】时 hover 不覆盖固定内容
 *  （固定 = 钉住，需点击其它卡或再点同卡取消后才回到 hover 预览）。 */
function hoverDraftPreview(player: PlayerId, defId: string): void {
  if (!draftPreviewHosts[player]) return;
  // 已固定（且固定属于本侧）→ hover 不打扰固定内容
  if (draftPinned && draftPinned.player === player) return;
  renderToPreview(player, defId);
}

/** 移除草稿展示框（body 级 fixed 大面板）并复位固定状态：进入游玩/重置/离开草稿页时调用 */
function removeDraftPreviews(): void {
  for (const host of draftPreviewHosts) {
    if (host && host.isConnected) host.remove();
  }
  draftPreviewHosts[0] = null;
  draftPreviewHosts[1] = null;
  draftPinned = null;
}

/** 构建单侧展示框容器（大面板，body 级 fixed：P1 屏幕左下 / P2 屏幕右下；空态提示；
 *  已固定协议在重渲染后恢复显示）。登记到 draftPreviewHosts。旧节点（上一帧）先移除。 */
function buildDraftPreviewBox(player: PlayerId, showPinned: { player: PlayerId; defId: string } | null): HTMLElement {
  const old = draftPreviewHosts[player];
  if (old && old.isConnected) old.remove();
  const box = el('div', 'draft-preview' + (player === 0 ? ' p1' : ' p2'));
  box.dataset.empty = '1';
  draftPreviewHosts[player] = box;
  if (showPinned && showPinned.player === player) {
    renderToPreview(player, showPinned.defId);
  } else {
    box.appendChild(
      el('div', 'draft-preview-hint', '点击中间协议卡\n在此固定查看详情')
    );
  }
  document.body.appendChild(box);
  return box;
}

export function renderDraft(root: HTMLElement, s: GameState, cb: UiCallbacks): void {
  root.textContent = '';
  const wrap = el('div', 'draft-screen');

  // 当前草稿动作：禁用模式在选/禁步骤间交替（normal 只有 pick）
  const action = draftNextAction(s);
  const banStep = action !== null && action.kind === 'ban';
  const activePlayer = banStep && action ? action.player : getCurrentDrafter(s);

  const header = el('div', 'draft-header');
  // 醒目「轮到谁」横幅：P1/P2 分色 + 呼吸辉光；禁用步骤额外标注进度
  const banner = el(
    'div',
    'draft-turn-banner' + (banStep ? ' ban' : '') + ` p${activePlayer + 1}`
  );
  const badge = el('span', 'turn-badge', `玩家 ${activePlayer + 1}`);
  const verb = el(
    'span',
    'turn-verb',
    banStep && action
      ? `禁用协议 · 本阶段还需禁用 ${draftBanBlockRemaining(s)} 个（共 ${DRAFT_BAN_TOTAL} 个）`
      : `选择协议 · 本轮还可选 ${draftTurnPicksRemaining(s)} 个`
  );
  banner.appendChild(badge);
  banner.appendChild(verb);
  header.appendChild(banner);
  // 轮次进度：第 X/6 次 + 1-2-2-1 步点追踪（当前步高亮、已过步打勾色）
  const progress = el('div', 'draft-progress');
  progress.appendChild(
    el(
      'span',
      'draft-progress-text',
      `第 ${Math.min(s.draftRound + 1, DRAFT_PICK_COUNT)} / ${DRAFT_PICK_COUNT} 次选择${banStep ? ' · 禁用阶段' : ''}`
    )
  );
  const track = el('div', 'draft-step-track');
  for (let i = 0; i < DRAFT_PICK_COUNT; i++) {
    const state = i < s.draftRound ? ' done' : i === s.draftRound ? ' current' : '';
    track.appendChild(el('span', 'draft-step-dot' + state, String(draftRoundOwner(s.draftStarter, i) + 1)));
  }
  progress.appendChild(track);
  header.appendChild(progress);
  wrap.appendChild(header);

  // 引擎池（随机池/禁用后剩余）供筛选计数与可用性判断
  const poolDefs = getDraftPool(s);

  // 世代筛选条：1代 基础/拓展、2代 基础/拓展 显隐。chip 永不锁定（2026-09-03 用户：
  // 允许可用池 <6 套）；若当前可用池不足以完成剩余选/禁动作，下方给一行非阻塞提示。
  const filter = el('div', 'draft-filter');
  const visiblePool = (): number => poolDefs.filter((p) => draftEnabledGroups.has(p.set)).length;
  for (const [group, label] of DRAFT_GROUP_LABELS) {
    const count = poolDefs.filter((p) => p.set === group).length;
    const on = draftEnabledGroups.has(group);
    const chip = el('button', 'draft-filter-chip' + (on ? ' on' : ''), label);
    chip.setAttribute('type', 'button');
    chip.title = `${label}（本局池内 ${count} 套）· ${on ? '点击隐藏' : '点击显示'}`;
    chip.addEventListener('click', () => {
      if (on) {
        draftEnabledGroups.delete(group);
      } else {
        draftEnabledGroups.add(group);
      }
      renderDraft(root, s, cb);
    });
    filter.appendChild(chip);
  }
  wrap.appendChild(filter);
  // 随机池提示（本局池小于全量时）
  if (s.draftPool.length !== DEMO_PROTOCOLS.length) {
    wrap.appendChild(
      el(
        'div',
        'draft-mode-note',
        `本局为随机池：从全部 ${DEMO_PROTOCOLS.length} 套协议中随机抽取 ${s.draftPool.length} 套可选（世代筛选仍可用）`
      )
    );
  }
  // 禁用模式的流程说明
  if (s.draftMode === 'ban') {
    wrap.appendChild(
      el(
        'div',
        'draft-mode-note',
        '禁用模式：后手先禁 2 → 先手选 1 禁 1 → 后手选 2 禁 1 → 先手选 2 禁 2 → 后手选 1'
      )
    );
  }
  // 非阻塞提示：剩余动作 > 可见池时提醒（可随时重新开启被隐藏组）
  const actionsLeft =
    DRAFT_PICK_COUNT - s.draftRound +
    (s.draftMode === 'ban' ? DRAFT_BAN_TOTAL - s.bannedProtocols.length : 0);
  const available = visiblePool();
  if (available < actionsLeft) {
    wrap.appendChild(
      el(
        'div',
        'draft-filter-hint',
        `当前可见协议 ${Math.max(available, 0)} 套，还需完成 ${actionsLeft} 次选/禁动作——请重新开启被隐藏的世代组。`
      )
    );
  }

  const layout = el('div', 'draft-layout');
  // 展示框为 body 级 fixed 大面板（P1 左下 / P2 右下，见 buildDraftPreviewBox）——
  // 固定屏幕、大字可读、不遮挡中间池；hover 即时预览 / 点击固定共用该面板。
  const side0 = el('div', 'draft-side p1');
  side0.appendChild(renderPickColumn(s, 0, activePlayer, cb));
  layout.appendChild(side0);
  layout.appendChild(renderDraftPool(s, cb, banStep, activePlayer));
  const side1 = el('div', 'draft-side p2');
  side1.appendChild(renderPickColumn(s, 1, activePlayer, cb));
  layout.appendChild(side1);
  wrap.appendChild(layout);
  buildDraftPreviewBox(0, draftPinned);
  buildDraftPreviewBox(1, draftPinned);
  root.appendChild(wrap);
}

/** 打牌交互：选手牌 → 点链路槽（打自己场；腐化0 也可点对方槽打对方场）；越步/协议不匹配等非法点击一律忽略 */
function playToLine(s: GameState, cb: UiCallbacks, line: Line, targetPlayer: PlayerId): void {
  if (!selectedUid) return;
  const uid = selectedUid;
  const faceUp = selectedFaceUp;
  // 先复位选择，避免已打出的牌在重渲染中残留 selected 高亮
  selectedUid = null;
  selectedFaceUp = true;
  if (s.step !== 'action') return;
  const legal = getLegalActions(s, s.turnPlayer);
  const playable = legal.some(
    (a) =>
      a.kind === 'play' && a.cardUid === uid && a.line === line && a.faceUp === faceUp &&
      (a.target ?? s.turnPlayer) === targetPlayer
  );
  if (!playable) return;
  cb.onAction({ kind: 'play', cardUid: uid, faceUp, line, target: targetPlayer === s.turnPlayer ? undefined : targetPlayer });
}

/** 胜利结算横幅是否已显示（防重复创建；返回主界面时由 resetUiState 复位） */
let winOverlayShown = false;

/** 胜利结算横幅（2026-09-03 用户反馈）：**不再全屏遮罩挡板**——对局画面保持可见供双方
 *  复盘；顶部紧凑横幅「玩家 N 获胜！+ 返回主界面」body 级 fixed（z-index 10000），
 *  常驻直到用户点「返回主界面」（移除横幅 + cb.onWinReset → main 回主页面）。
 *  横幅自身可点，其余区域不拦截（复盘时仍可放大查看卡牌等）。 */
function showWinOverlay(winner: PlayerId, cb: UiCallbacks): void {
  if (winOverlayShown) return;
  winOverlayShown = true;
  const banner = el('div', 'win-banner');
  const panel = el('div', 'win-panel');
  const title = el('div', 'win-title', `玩家 ${winner + 1} 获胜！`);
  const sub = el('div', 'win-sub', '本局结束 · 可继续查看场上布局复盘');
  const btn = el('button', 'btn win-confirm-btn', '返回主界面');
  btn.addEventListener('click', () => {
    banner.remove();
    cb.onWinReset?.();
  });
  panel.appendChild(title);
  panel.appendChild(sub);
  panel.appendChild(btn);
  banner.appendChild(panel);
  document.body.appendChild(banner);
}

export function renderBoard(root: HTMLElement, s: GameState, cb: UiCallbacks): void {
  root.textContent = '';
  compiledFxCells.length = 0; // 本帧持久 FX 收集器复位（renderProtocol 逐格登记）
  // 几何型 FX 延迟器：renderBoard 开头已清空 root，构建期棋盘节点尚未入 DOM，
  // 此时 getBoundingClientRect() 全 0 → 依赖矩形定位的特效会静默失败
  // （幸运宣告骰子 startLuckDiceFx / 透彻牌库眼睛 startClarityDeckEye 曾因此完全不显示）。
  // 收集后在 root.appendChild(wrap) 之后统一执行。
  const deferredFx: Array<() => void> = [];
  // 清除失效选择：所选卡不在当前回合玩家手牌中（已被打出/刷新生效/回合切换）时复位
  const sel = selectedUid;
  if (sel !== null && !s.players[s.turnPlayer].hand.some((c) => c.uid === sel)) {
    selectedUid = null;
    selectedFaceUp = true;
  }
  const wrap = el('div', 'board');
  if (s.phase === 'gameover' && s.winner !== null) {
    // 胜利结算 → 模态遮罩（body 级，一次性创建）：玩家 N 获胜！+「返回主界面」按钮
    showWinOverlay(s.winner, cb);
  }

  // 行式布局（点2 对齐修复）：不再用「三栏各堆三行」，改为逐线一行——
  // 每条线是一个水平行：P1 链路槽 | P1 协议 | P2 协议 | P2 链路槽，
  // 协议对与其两个链路槽落在同一水平带内（平行对齐）。
  // 牌库/弃牌/手牌计数与手牌本体分别放在顶部条带与底部条带的左右两侧。
  const grid = el('div', 'board-grid');

  // 顶部条带：双方信息 + 中间控制组件（导出日志按钮在底部操作行）
  const strip = el('div', 'player-strip');
  // 修改提示词 17：效果挂起等待操作时，操作者（chooser ?? 效果属主）的玩家栏高亮提示
  const topEffect = s.pendingEffects[s.pendingEffects.length - 1];
  const operator: PlayerId | null = topEffect?.prompt ? (topEffect.prompt.chooser ?? topEffect.player) : null;
  strip.appendChild(renderPlayerInfo(s, 0, { isSelf: s.turnPlayer === 0, operator: operator === 0 }));
  strip.appendChild(renderControlModule(s));
  strip.appendChild(renderPlayerInfo(s, 1, { isSelf: s.turnPlayer === 1, operator: operator === 1 }));
  grid.appendChild(strip);

  // 三条线（每线一行，同行 4 格水平对齐）
  // 打出交互（修改提示词 15）：自己的槽 = 打自己场；选中 corruption-0（可打对方场的卡）时
  // 对方槽也作为落点（target=对方，易主落对方场）。interactable 由「该槽当前是否可作为
  // 打出落点」决定：自己侧 action 步骤即可点（.self 常驻高亮保留）；对方侧仅在选中卡
  // 存在 target=对方的合法 play action 时可点。
  const legalActions = getLegalActions(s, s.turnPlayer);
  const oppSlot: PlayerId = s.turnPlayer === 0 ? 1 : 0;
  const selectedCanPlayToOpp =
    selectedUid !== null &&
    legalActions.some(
      (a) =>
        a.kind === 'play' && a.cardUid === selectedUid && a.faceUp === selectedFaceUp &&
        a.target === oppSlot
    );
  for (const line of [0, 1, 2] as Line[]) {
    const row = el('div', 'lane-row');
    // 线编号：select-line 选择模式据此高亮并即答 ['line:N']
    row.dataset.line = String(line);
    row.appendChild(
      renderStackSlot(
        s, 0, line,
        s.turnPlayer === 0 ? selectedUid : null,
        s.turnPlayer === 0 ? (l) => playToLine(s, cb, l, 0) : selectedCanPlayToOpp && oppSlot === 0 ? (l) => playToLine(s, cb, l, 0) : () => {},
        s.turnPlayer === 0 || (selectedCanPlayToOpp && oppSlot === 0)
      )
    );
    row.appendChild(renderProtocolCell(s, 0, line));
    row.appendChild(renderProtocolCell(s, 1, line));
    row.appendChild(
      renderStackSlot(
        s, 1, line,
        s.turnPlayer === 1 ? selectedUid : null,
        s.turnPlayer === 1 ? (l) => playToLine(s, cb, l, 1) : selectedCanPlayToOpp && oppSlot === 1 ? (l) => playToLine(s, cb, l, 1) : () => {},
        s.turnPlayer === 1 || (selectedCanPlayToOpp && oppSlot === 1)
      )
    );
    grid.appendChild(row);
  }

  // 底部条带：双方（牌库 + 手牌 + 刷新手牌） + 中间步骤指示。
  // 每侧一个 .hand-side flex 容器（column）：牌库/弃牌堆绝对定位在外侧（P1 左 / P2 右），
  // 流内仅一个 .hand-refresh-wrap（手牌在上、刷新手牌在其下方居中；刷新按钮仅当前
  // 玩家 action 步骤时出现）。
  const handStrip = el('div', 'hand-strip');
  const legal = getLegalActions(s, s.turnPlayer);
  const refreshAction = legal.find((a) => a.kind === 'refresh') ?? null;
  const p1Side = el('div', 'hand-side p1');
  p1Side.appendChild(renderDeck(s, 0));
  p1Side.appendChild(renderTrash(s, 0)); // 牌库内侧（更靠近手牌）
  const p1Wrap = el('div', 'hand-refresh-wrap');
  p1Wrap.appendChild(
    renderHand(s, 0, {
      isSelf: s.turnPlayer === 0,
      selected: s.turnPlayer === 0 ? selectedUid : null,
      onSelect: (uid) => {
        selectedUid = uid;
        selectedFaceUp = true; // 选择新卡时重置为正面（避免继承上一张的翻面状态）
        renderApp(root, s, cb);
      },
      onToggleFaceUp: () => {
        // 翻面动画：先切状态，在旧卡节点上播 3D 翻面（.hand-flipping），动画结束后
        // 再重渲染展示新朝向——替代旧的即时重渲染（卡牌瞬间"弹回"手牌）。
        // 选中态（selectedUid / selectedFaceUp 模块态）保持不变，翻面后仍保持选中。
        if (handFlipAnimBusy) return; // 动画进行中忽略重复点击
        if (selectedUid === null) {
          selectedFaceUp = !selectedFaceUp;
          renderApp(root, s, cb);
          return;
        }
        const node = document.querySelector<HTMLElement>(`.hand .card[data-uid="${selectedUid}"]`);
        selectedFaceUp = !selectedFaceUp;
        if (!node) {
          renderApp(root, s, cb);
          return;
        }
        handFlipAnimBusy = true;
        node.classList.add('hand-flipping');
        window.setTimeout(() => {
          handFlipAnimBusy = false;
          renderApp(root, s, cb);
        }, HAND_FLIP_MS);
      },
      cb,
    })
  );
  if (s.turnPlayer === 0 && refreshAction) p1Wrap.appendChild(renderRefreshButton(refreshAction, cb));
  p1Side.appendChild(p1Wrap);
  handStrip.appendChild(p1Side);
  handStrip.appendChild(el('div', 'step-indicator', `步骤: ${s.step}`));
  const p2Side = el('div', 'hand-side p2');
  const p2Wrap = el('div', 'hand-refresh-wrap');
  p2Wrap.appendChild(
    renderHand(s, 1, {
      isSelf: s.turnPlayer === 1,
      selected: s.turnPlayer === 1 ? selectedUid : null,
      onSelect: (uid) => {
        selectedUid = uid;
        selectedFaceUp = true; // 选择新卡时重置为正面（避免继承上一张的翻面状态）
        renderApp(root, s, cb);
      },
      onToggleFaceUp: () => {
        // 翻面动画：先切状态，在旧卡节点上播 3D 翻面（.hand-flipping），动画结束后
        // 再重渲染展示新朝向——替代旧的即时重渲染（卡牌瞬间"弹回"手牌）。
        // 选中态（selectedUid / selectedFaceUp 模块态）保持不变，翻面后仍保持选中。
        if (handFlipAnimBusy) return; // 动画进行中忽略重复点击
        if (selectedUid === null) {
          selectedFaceUp = !selectedFaceUp;
          renderApp(root, s, cb);
          return;
        }
        const node = document.querySelector<HTMLElement>(`.hand .card[data-uid="${selectedUid}"]`);
        selectedFaceUp = !selectedFaceUp;
        if (!node) {
          renderApp(root, s, cb);
          return;
        }
        handFlipAnimBusy = true;
        node.classList.add('hand-flipping');
        window.setTimeout(() => {
          handFlipAnimBusy = false;
          renderApp(root, s, cb);
        }, HAND_FLIP_MS);
      },
      cb,
    })
  );
  if (s.turnPlayer === 1 && refreshAction) p2Wrap.appendChild(renderRefreshButton(refreshAction, cb));
  p2Side.appendChild(p2Wrap);
  p2Side.appendChild(renderTrash(s, 1)); // 牌库内侧（更靠近手牌，镜像 P1）
  p2Side.appendChild(renderDeck(s, 1));
  handStrip.appendChild(p2Side);
  grid.appendChild(handStrip);
  wrap.appendChild(grid);

  // 操作行：编译线 N（check-compile 强制行动）保留在行内；「下一步」水平居中，
  // action 步骤的拖拽提示文本置于「下一步」上方（见 .next-block / .hint）。
  const actionBar = el('div', 'action-bar');
  const nextAction = legal.find((a) => a.kind === 'advance') ?? null;
  for (const a of legal) {
    // 打牌通过点击手牌+线完成；刷新手牌在挡板外侧；下一步单独居中渲染
    if (a.kind === 'play' || a.kind === 'refresh' || a.kind === 'advance') continue;
    const label =
      a.kind === 'compile' ? `编译线 ${(a.line ?? 0) + 1}`
      : a.kind === 'resolve-trigger' ? `结算触发：${a.defId ?? ''}` // 修改提示词 28：按钮带触发来源卡牌
      : a.kind === 'clear-cache' ? `清理缓存`
      : a.kind;
    const btn = el('button', 'btn', label);
    btn.addEventListener('click', () => cb.onAction(a));
    actionBar.appendChild(btn);
  }
  if (nextAction) {
    const nextBlock = el('div', 'next-block');
    if (s.step === 'action') {
      // 拖拽打牌（DnD）：拖拽手牌卡到高亮的线路直接打出；点击选择 + 翻面仍可用
      nextBlock.appendChild(
        el('span', 'hint', selectedUid ? '已选择卡牌 — 拖拽到高亮的线路打出（可先点「翻面」切换朝向）' : '拖拽手牌卡到高亮的线路打出（双击放大，点击选择）')
      );
    }
    const nextBtn = el('button', 'btn next-btn', '下一步');
    nextBtn.addEventListener('click', () => cb.onAction(nextAction));
    nextBlock.appendChild(nextBtn);
    actionBar.appendChild(nextBlock);
  }
  wrap.appendChild(actionBar);

  // 选择模式（效果结算挂起且顶部为选择请求时）：按 kind 分支渲染（候选卡高亮 / 线槽高亮 / 操作按钮）
  if (topEffect?.prompt) {
    const prompt = topEffect.prompt;
    // 同步本地选择状态（重渲染后保留）；prompt 变化时重置
    if (choicePromptId !== topEffect.id) {
      choicePromptId = topEffect.id;
      choiceSelected = [];
    }
    if (prompt.kind === 'select') {
      // —— 现有 select 逻辑（候选卡高亮 + 确认条）保持不变 ——
      const sel = new Set(choiceSelected);
      // 2代 clarity-2/3：从牌库选阈值卡 prompt → 效果属主牌库上方浮现古埃及眼睛
      // （startClarityDeckEye 幂等；抽取完成由 fx-gen2 在 card:drawn clarity 后 2s 消散）
      if (prompt.title.startsWith('透彻：从牌库中选择')) {
        const eyePlayer: PlayerId = (prompt.chooser ?? topEffect.player) as PlayerId;
        deferredFx.push(() => startClarityDeckEye(eyePlayer));
      }
      // 候选卡高亮（renderBoard 内所有 .card 已渲染，此时均在 wrap 内）
      for (const node of wrap.querySelectorAll<HTMLElement>('.card[data-uid]')) {
        const uid = node.dataset.uid!;
        const candidate = prompt.candidates.find((c) => c.uid === uid);
        if (candidate) {
          node.classList.add('choice-target');
          if (sel.has(uid)) node.classList.add('choice-selected');
          // 单击=切换选择，双击=放大查看候选卡；复用 bindClickOrDouble 的单击/双击判别
          // （单击延迟 320ms > 双击窗口 300ms）。双击窗口内的第二次点击先于延迟的单击触发
          // 并取消它 → 双击不会误切换选择，且打开遮罩前不会重渲染销毁节点。
          bindClickOrDouble(
            node,
            () => {
              if (sel.has(uid)) { sel.delete(uid); choiceSelected = choiceSelected.filter((x) => x !== uid); }
              else if (choiceSelected.length < prompt.max) { choiceSelected.push(uid); }
              renderApp(root, s, cb);
            },
            () => openZoom(candidate.defId, candidate.faceUp, false, false),
            true
          );
        } else {
          node.classList.add('choice-dim');
        }
      }
      // 定向选牌浮层：候选位于牌库/弃牌堆等「棋盘上没有单卡 DOM」的区域时（时间0 弃牌堆自选打出、
      // 透彻2/3 从牌库选阈值卡…），棋盘高亮循环找不到可点节点 → 确认按钮恒为禁用（已选 0 < 下限）
      // 导致对局卡死。此处按卡面弹出可点击候选面板（单击勾选 / 双击放大），确认与跳过仍用底部选择条。
      const onBoard = new Set<string>();
      for (const node of wrap.querySelectorAll<HTMLElement>('.card[data-uid]')) onBoard.add(node.dataset.uid!);
      const offBoard = prompt.candidates.filter((c) => !onBoard.has(c.uid));
      if (offBoard.length > 0) {
        wrap.appendChild(buildChoicePickOverlay(prompt, offBoard, sel, root, s, cb, topEffect));
      }
      const bar = el('div', 'choice-bar');
      // 修改提示词 17：操作者提示横幅（顶部玩家栏已高亮 operator，此处底部操作条再醒目提示）
      const opName = (prompt.chooser ?? topEffect.player) === 0 ? '玩家 1' : '玩家 2';
      bar.appendChild(el('div', 'operator-banner', `请 ${opName} 操作`));
      // 归属者标签：出选择请求的效果属主（PendingEffect.player，非 prompt 自身；chooser 覆盖）
      bar.appendChild(el('div', 'choice-title', `${(prompt.chooser ?? topEffect.player) === 0 ? 'P1' : 'P2'} 操作 — ${prompt.title}`));
      const count = el('span', 'choice-count', `已选 ${choiceSelected.length}/${prompt.max === Infinity ? prompt.candidates.length : prompt.max}`);
      bar.appendChild(count);
      const canConfirm = choiceSelected.length >= prompt.min && choiceSelected.length <= prompt.max;
      const confirmBtn = el('button', 'btn choice-confirm' + (canConfirm ? '' : ' disabled'), '确认');
      confirmBtn.addEventListener('click', () => {
        if (!canConfirm) return;
        choicePromptId = null;
        cb.onAction({ kind: 'effect-choice', promptId: topEffect.id, choice: choiceSelected });
      });
      bar.appendChild(confirmBtn);
      if (prompt.optional) {
        const skipBtn = el('button', 'btn choice-skip', '跳过');
        skipBtn.addEventListener('click', () => {
          choicePromptId = null;
          cb.onAction({ kind: 'effect-choice', promptId: topEffect.id, choice: [] });
        });
        bar.appendChild(skipBtn);
      }
      wrap.appendChild(bar);
    } else if (prompt.kind === 'select-line') {
      // 线槽高亮：点击 lane-row 即答 ['line:N']
      for (const row of wrap.querySelectorAll<HTMLElement>('.lane-row')) {
        const ln = Number(row.dataset.line);
        if (prompt.lines?.includes(ln as Line)) {
          row.classList.add('choice-target', 'choice-line');
          row.addEventListener('click', () => {
            choicePromptId = null;
            cb.onAction({ kind: 'effect-choice', promptId: topEffect.id, choice: [`line:${ln}`] });
          });
        }
      }
      const bar = choiceBar(topEffect, prompt, cb, '点击高亮的线路选择目标线');
      if (prompt.optional) {
        // 可选 select-line（如 darkness-1 的可选平移）：跳过 = 空应答
        const skipBtn = el('button', 'btn choice-skip', '跳过');
        skipBtn.addEventListener('click', () => {
          choicePromptId = null;
          cb.onAction({ kind: 'effect-choice', promptId: topEffect.id, choice: [] });
        });
        bar.appendChild(skipBtn);
      }
      wrap.appendChild(bar);
    } else if (prompt.kind === 'select-action') {
      const bar = el('div', 'choice-bar');
      const opName = (prompt.chooser ?? topEffect.player) === 0 ? '玩家 1' : '玩家 2'; // 修改提示词 17
      bar.appendChild(el('div', 'operator-banner', `请 ${opName} 操作`));
      bar.appendChild(el('div', 'choice-title', `${(prompt.chooser ?? topEffect.player) === 0 ? 'P1' : 'P2'} 操作 — ${prompt.title}`));
      // 2代 luck 宣告 prompt（luck-0 宣告数字 / luck-3 宣告协议）：宣告卡（效果源卡）中心
      // 出现骰子持续转动（startLuckDiceFx 幂等：choice-bar 每帧重渲染重复调用只重定位）；
      // 用户选择后 luck:roll 事件（fx-gen2 订阅）停骰并播成功/失败结果。
      if (
        (prompt.title.startsWith('luck-0：宣告') || prompt.title.startsWith('luck-3：宣告')) &&
        topEffect.sourceUid
      ) {
        const srcUid = topEffect.sourceUid;
        deferredFx.push(() => startLuckDiceFx(srcUid));
      }
      for (const act of prompt.actions ?? []) {
        const b = el('button', 'btn choice-action-btn', actionCn(act)); // 修改提示词 8：动作按钮中文（翻转/抽牌/正面打出…）
        b.addEventListener('click', () => { choicePromptId = null; cb.onAction({ kind: 'effect-choice', promptId: topEffect.id, choice: [act] }); });
        bar.appendChild(b);
      }
      if (prompt.optional) {
        const skip = el('button', 'btn choice-skip', '跳过');
        skip.addEventListener('click', () => { choicePromptId = null; cb.onAction({ kind: 'effect-choice', promptId: topEffect.id, choice: [] }); });
        bar.appendChild(skip);
      }
      wrap.appendChild(bar);
    }
    // 选择模式下隐藏手牌交互：给 hand-strip 加 .choice-mode（CSS 禁用非候选卡的 hover/单击/拖拽）
    grid.querySelector('.hand-strip')?.classList.add('choice-mode');
  } else {
    choicePromptId = null;
    choiceSelected = [];
  }

  const log = el('div', 'log');
  for (const entry of s.log.slice(-60)) {
    log.appendChild(el('div', 'log-entry', entry));
  }
  wrap.appendChild(log);

  // 导出日志按钮：页面最底部（简要日志下方）
  const diagBtn = el('button', 'btn diag-btn', '导出日志');
  diagBtn.title = '导出诊断日志（错误 + 控制台记录 + 事件日志 + 状态快照）';
  diagBtn.addEventListener('click', () => downloadLog(s));
  wrap.appendChild(diagBtn);

  root.appendChild(wrap);
  // 棋盘已入 DOM → 执行本帧收集的几何型 FX（矩形定位有效；幸运骰子/透彻牌库眼睛等）
  for (const fn of deferredFx) fn();
  // R12 已编译环持久 FX：协议格已入 DOM → 按 holder 矩形重定位 body 级层（层跨重渲染
  // 存活、从不移动 → 动画不重启；协议未编译时 renderProtocol 已移除并注销）
  syncCompiledFxLayers();
  // Part 2 常驻黑烟：槽位已入 DOM → 创建/复用 body 级 overlay 并重定位到槽位矩形
  // （overlay 跨重渲染存活，动画不重启；条件消失后 syncSmokeOverlays 移除并注销）
  syncSmokeOverlays(s);
  // R16 常驻能量扫描线：电池已入 DOM → 创建/复用 body 级扫描层并重定位到外壳矩形
  // （层跨重渲染存活，动画不重启；full/burst 或电池缺失时移除并注销）
  syncScanOverlays(s);
  // FX-3 常驻协议特效：psychic-1 念能粒子 / plague-0 瘟疫浓雾（暗2 黑烟同模式——
  // 槽位已入 DOM → 创建/复用 body 级层并重定位到槽位矩形；条件消失后移除并注销）
  syncPsychicParticles(s);
  syncPlagueMists(s);
  // FX-5 常驻协议特效：apathy-0 冷漠灰雾（槽位已入 DOM）/ apathy-2 冷漠马赛克（FX-R3）/
  // spirit-0 手牌区框光芒 / spirit-1 手牌卡边框护角（手牌已入 DOM → 按 .hand[data-player] /
  // 手牌卡 rect 重定位；条件消失后移除并注销）
  syncApathyMists(s);
  syncApathyMosaics(s);
  syncSpirit0Glows(s);
  syncSpirit1Cards(s);
  // FX-6 常驻金属特效：metal-0 对方能量槽金属边框（电池已入 DOM → 按 .battery-shell 矩形）/
  // metal-2 被限制方链路铁板+斜光（槽位已入 DOM）/ metal-6 手牌 man 渐现（手牌已入 DOM →
  // 按 .card[data-uid] 矩形；条件消失后移除并注销）/ metal-1 被禁编译方三链边框金属光泽
  // （FX-R3，纯状态驱动：s.compileBlocked 区间常驻，解除即移除）
  syncMetal0Glows(s);
  syncMetalPlates(s);
  syncMetal6Mans(s);
  syncMetal1LineGlows(s);
  // 2代 mirror-0 明镜常驻：链路能量槽银白镜框（电池已入 DOM → 按 .battery-shell 矩形）
  syncMirror0BatteryGlows(s);
  // 2代 clarity-0 透彻常驻：链路能量槽淡粉/淡蓝边框 + 眼睛图案
  syncClarity0BatteryGlows(s);
  // 2代 ice 寒冰常驻：ice-1 对方链路冰面 / ice-4 卡框冰辉 / ice-6 牌库封冰
  syncIceFx(s);
  // 2代 smoke-2 迷雾顶常驻：所属链路边框浓灰发光 + 触手雾
  syncSmoke2LineGlows(s);
  // 2代 fear-0 恐惧顶常驻：其回合内对手三条链路橙红闪烁 + 覆盖
  syncFear0TriGlows(s);
  // 2代 war 战争常驻：war-0~3 被动在场交叉双剑 + 卡框赤红发光
  syncWarBlades(s);
  // 2代 diversity 多元已编译：5 色取自场上其它已编译协议边框色（写 body 级层 CSS 变量）
  syncDiversityColors(s);
  // 2代 diversity-3 多元顶常驻：链路内非多元正面卡协议色微光 + 该线能量槽彩色流光
  syncDiversity3Fx(s);
}

let selectedUid: string | null = null;
let selectedFaceUp = true;
/** 手牌翻面动画进行中：防止动画期间重复点击/重渲染打断（HAND_FLIP_MS 后由定时器重渲染） */
let handFlipAnimBusy = false;
/** 手牌翻面动画时长（ms，与 styles.css .hand-flipping 的 transition 时长一致） */
const HAND_FLIP_MS = 380;
/** R8 手牌挡板宽度（px，模块态：重渲染后保留；0=收起、手牌可见） */
const shieldWidth: [number, number] = [0, 0];
/** 挡板最大宽度：15 张手牌扇形完整铺开（首卡 130px + 14 张 × 露出 102px）≈ 1660px */
const SHIELD_MAX_WIDTH = 15 * 102 + 130;

/** 选择模式状态：当前应答的 promptId 与已选 uid（重渲染保留，选择完成后清空） */
let choicePromptId: string | null = null;
let choiceSelected: string[] = [];

/** 应用内重置（胜利遮罩「返回主界面」→ main.ts 调用）：清空全部 UI 模块态并移除
 *  body 级常驻层/遮罩——否则旧局残留（编译环 / 暗2 黑烟 / 放大遮罩 / 弃牌堆查看器 /
 *  飞行中的协议瞬时特效）会在新局（createGame 重建状态）悬空。不触碰引擎（新局由
 *  main.ts 重新 createGame）。 */
export function resetUiState(): void {
  if (activeDragCancel) activeDragCancel();
  selectedUid = null;
  selectedFaceUp = true;
  handFlipAnimBusy = false;
  shieldWidth[0] = 0;
  shieldWidth[1] = 0;
  choicePromptId = null;
  choiceSelected = [];
  batteryPrev.clear();
  // 草稿页世代筛选复位为全开（1代+2代 30 套）
  draftEnabledGroups = new Set(DRAFT_GROUP_LABELS.map(([g]) => g));
  // 草稿展示框容器（body 级 fixed 大面板）随局移除 + 固定状态复位
  removeDraftPreviews();
  for (const [defId, fx] of compiledFx) {
    clearCompiledFxTimers(defId);
    fx.remove();
  }
  compiledFx.clear();
  compiledFxCells.length = 0;
  for (const overlay of smokeOverlays.values()) overlay.remove();
  smokeOverlays.clear();
  for (const overlay of scanOverlays.values()) overlay.remove();
  scanOverlays.clear();
  for (const layer of psychicParticles.values()) layer.remove();
  psychicParticles.clear();
  for (const layer of plagueMists.values()) layer.remove();
  plagueMists.clear();
  // FX-5 常驻注册表：冷漠灰雾 / 冷漠2 马赛克（FX-R3）/ 灵魂-0 手牌区光芒 / 灵魂-1 手牌卡护角
  // （移除层 + 清表）；check-cache 锁链层（一次性，离开步骤时已置 null 交由定时器清理，此处兜底直清）
  // + prevStep 复位
  for (const layer of apathyMists.values()) layer.remove();
  apathyMists.clear();
  for (const layer of apathyMosaics.values()) layer.remove();
  apathyMosaics.clear();
  for (const glow of spirit0Glows.values()) glow.remove();
  spirit0Glows.clear();
  for (const layer of spirit1Cards.values()) layer.remove();
  spirit1Cards.clear();
  // FX-6 常驻注册表：金属0 能量槽边框 / 金属2 链路铁板 / 金属6 手牌 man / metal-1 三链边框
  // 金属光泽（FX-R3；移除层 + 清表）
  for (const glow of metal0Glows.values()) glow.remove();
  metal0Glows.clear();
  for (const layer of metalPlates.values()) layer.remove();
  metalPlates.clear();
  for (const layer of metal6Mans.values()) layer.remove();
  metal6Mans.clear();
  for (const glow of metal1LineGlows.values()) glow.remove();
  metal1LineGlows.clear();
  for (const glow of mirror0BatteryGlows.values()) glow.remove();
  mirror0BatteryGlows.clear();
  for (const glow of clarity0BatteryGlows.values()) glow.remove();
  clarity0BatteryGlows.clear();
  for (const layer of iceLineFreezes.values()) layer.remove();
  iceLineFreezes.clear();
  for (const layer of ice4CardGlows.values()) layer.remove();
  ice4CardGlows.clear();
  for (const layer of ice6DeckIces.values()) layer.remove();
  ice6DeckIces.clear();
  for (const layer of smoke2LineGlows.values()) layer.remove();
  smoke2LineGlows.clear();
  for (const glow of fear0TriGlows.values()) glow.remove();
  fear0TriGlows.clear();
  for (const layer of warBlades.values()) layer.remove();
  warBlades.clear();
  // 2代 diversity-3 常驻：链路微光 + 能量槽流光
  for (const glow of div3CardGlows.values()) glow.remove();
  div3CardGlows.clear();
  for (const flow of div3LineFlows.values()) flow.remove();
  div3LineFlows.clear();
  if (chainLayer) {
    chainLayer.remove();
    chainLayer = null;
  }
  prevStep = null;
  controlSliderPos = 50;
  closeZoom();
  closeTrashViewer();
  closeDeckOrderViewer();
  winOverlayShown = false;
  // 飞行中的协议瞬时特效（life 藤蔓容器 / 绿光 / water 水环·光晕·落点框 / 翻面覆盖层）与
  // 抽牌/揭示幽灵：自身定时器会在数百毫秒内移除，但重置时立即清扫，避免残留进新局
  // （旧动画的 done() 完成回调由 main.ts resetEpoch 世代守卫放弃渲染）。
  for (const fx of document.querySelectorAll<HTMLElement>(
    '.life-flip-fx, .life-flip-glow, .water-return-ring, .water-return-glow, .water-return-settle, ' +
      '.water-return-trail, .flip-overlay-fx, .draw-ghost, .reveal-fly-ghost, ' +
      '.fx-gravity-deckglow, .fx-gravity-hole, .fx-gravity-beam, .fx-gravity-cardglow, .fx-gravity-end-shroud, .fx-speed-glow, ' +
      '.fx-speed-card, .fx-speed-card-glow, .fx-speed-end-shroud, ' +
      '.fx-psychic, .fx-plague, .fx-love-deckglow, .fx-love-fly, .fx-love-settle, .fx-love-heart, ' +
      '.fx-apathy, .fx-spirit-chains, .fx-metal-lineglow'
  )) {
    fx.remove();
  }
}

/** 选择确认条（select-line 用）：归属者标签 + 提示文案；线槽点击即答，无需确认钮 */
function choiceBar(pe: PendingEffect, prompt: ChoiceRequest, cb: UiCallbacks, hint: string): HTMLElement {
  const bar = el('div', 'choice-bar');
  // 修改提示词 17：操作者提示横幅
  const opName = (prompt.chooser ?? pe.player) === 0 ? '玩家 1' : '玩家 2';
  bar.appendChild(el('div', 'operator-banner', `请 ${opName} 操作`));
  bar.appendChild(el('div', 'choice-title', `${(prompt.chooser ?? pe.player) === 0 ? 'P1' : 'P2'} 操作 — ${prompt.title}`));
  bar.appendChild(el('div', 'choice-hint', hint));
  return bar;
}

/** 定向选牌浮层（时间0 从弃牌堆自选打出 / 透彻2、3 从牌库选阈值卡 等）：
 *  这类 select prompt 的候选卡位于牌库、弃牌堆等「棋盘上没有单卡 DOM」的区域，棋盘高亮循环
 *  找不到可点节点 → 玩家无法勾选、确认按钮恒为禁用 → 对局卡死在此处。
 *  本浮层把候选按卡面正面列出（单击勾选/取消，双击放大），确认与跳过沿用底部 .choice-bar。
 *  出层时机：已选状态变化后 renderApp 整帧重渲染，浮层随棋盘重建（无残留）。 */
function buildChoicePickOverlay(
  prompt: ChoiceRequest,
  cards: ChoiceCard[],
  sel: Set<string>,
  root: HTMLElement,
  s: GameState,
  cb: UiCallbacks,
  pe: PendingEffect,
): HTMLElement {
  const overlay = el('div', 'choice-pick-overlay');
  const panel = el('div', 'choice-pick-panel');
  const who = (prompt.chooser ?? pe.player) === 0 ? 'P1' : 'P2';
  panel.appendChild(el('div', 'choice-pick-title', `${who} 操作 — ${prompt.title}`));
  panel.appendChild(
    el('div', 'choice-pick-hint', '单击选择 / 再点取消，双击放大查看；选好后点底部「确认」'),
  );
  const grid = el('div', 'choice-pick-grid');
  for (const c of cards) {
    const cell = el('div', 'choice-pick-card' + (sel.has(c.uid) ? ' selected' : ''));
    const fig = el('div', 'choice-pick-fig');
    const img = document.createElement('img');
    if (c.faceUp) {
      const [protocol, value] = splitDefId(c.defId);
      img.src = cardImgSrc(protocol, value);
      img.alt = c.defId;
    } else {
      img.src = '/assets/Cardback.jpg';
      img.alt = 'card back';
    }
    fig.appendChild(img);
    cell.appendChild(fig);
    if (c.faceUp) cell.appendChild(el('span', 'choice-pick-label', c.defId));
    bindClickOrDouble(
      cell,
      () => {
        if (sel.has(c.uid)) {
          sel.delete(c.uid);
          choiceSelected = choiceSelected.filter((x) => x !== c.uid);
        } else if (choiceSelected.length < prompt.max) {
          choiceSelected.push(c.uid);
        }
        renderApp(root, s, cb);
      },
      () => openZoom(c.defId, c.faceUp, false, false),
      true,
    );
    grid.appendChild(cell);
  }
  panel.appendChild(grid);
  panel.appendChild(
    el('div', 'choice-pick-count', `已选 ${sel.size}/${prompt.max === Infinity ? cards.length : prompt.max}`),
  );
  overlay.appendChild(panel);
  return overlay;
}

/* ===== 卡牌放大查看遮罩（双击卡牌：手牌/场上/协议；滚轮缩放；Esc 或点击空白关闭） ===== */
interface ZoomState {
  overlay: HTMLElement;
  img: HTMLImageElement;
  scale: number;
  isProtocol: boolean;
  onKey: (e: KeyboardEvent) => void;
  /** 中文效果文本栏（仅卡牌正面时可见；协议卡为 null） */
  textEl: HTMLElement | null;
  /** 当前显示朝向（peek 翻面联动文本显隐；背面不显示中文防信息泄露） */
  showingFace: boolean;
}
let zoomState: ZoomState | null = null;

/** 卡牌中文效果面板构建（放大查看/图鉴展示共用）：rootCls 控制容器尺寸/底色（zoom-text 或
 *  library-preview-text），内部结构类固定 card-text-*。 */
export function buildCardTextEl(parts: CardTextParts, rootCls: string): HTMLElement {
  const box = el('div', rootCls);
  box.appendChild(el('div', 'card-text-title', parts.title));
  for (const seg of parts.segs) {
    const row = el('div', 'card-text-seg');
    row.appendChild(el('span', 'card-text-seg-label', `${seg.label}：`));
    row.appendChild(document.createTextNode(seg.text));
    box.appendChild(row);
  }
  return box;
}

/** 打开卡牌放大查看遮罩。defId: 卡牌定义 id；faceUp: 是否正面（背面显示时【不】显示中文文本——
 *  2026-09 用户需求：除非当前查看为正面否则不显示中文，防信息泄露）；isProtocol: 是否协议卡；
 *  compiled: 协议是否已编译；peek: 是否带「查看背面」切换按钮（ITEM 9：自己的反面场上卡
 *  背面起显，点击在 背面 ↔ 正面 之间切换显示；翻面联动中文文本显隐）。
 *  FX-5 冷漠2：放大查看器【不受】场上 .apathy-filter 灰度滤镜影响——本函数按 defId 新建
 *  img（非克隆场上节点），滤镜类从不被继承（场上/弃牌堆查看的 dblclick 同样走 defId 新建）。 */
export function openZoom(defId: string, faceUp: boolean, isProtocol: boolean, compiled: boolean, peek?: boolean): void {
  if (zoomState) closeZoom();
  const overlay = el('div', 'zoom-overlay');
  const body = el('div', 'zoom-body');
  const img = document.createElement('img');
  img.className = 'zoom-img' + (isProtocol ? ' zoom-protocol' : '');
  let showingFace = faceUp;
  if (isProtocol) {
    img.src = protocolImgSrc(defId, compiled);
  } else if (showingFace) {
    const [proto, value] = splitDefId(defId);
    img.src = cardImgSrc(proto, value);
  } else {
    img.src = '/assets/Cardback.jpg';
  }
  img.alt = 'card zoom';
  // 中文效果文本栏：仅卡牌（非协议）且正面显示时可见；peek 翻面联动显隐
  let textEl: HTMLElement | null = null;
  if (!isProtocol) {
    try {
      textEl = buildCardTextEl(cardTextParts(getCardDef(defId)), 'zoom-text');
      textEl.style.display = showingFace ? '' : 'none';
    } catch {
      textEl = null;
    }
  } else {
    // 修改提示词 22：协议双击放大查看 → 右侧显示中文（名称/座右铭/关键词/编译状态，
    // 无论是否已编译均可查看）
    try {
      const proto = getProtocolDef(defId);
      const box = el('div', 'zoom-text protocol-zoom-text');
      box.appendChild(el('div', 'card-text-title', proto.name));
      const setLabel =
        proto.set === 'MN01' || proto.set === 'AX01' ? '1代' :
        proto.set === 'MN02' || proto.set === 'AX02' ? '2代' : '3代';
      const meta = el('div', 'card-text-seg');
      meta.appendChild(el('span', 'card-text-seg-label', `${setLabel} · ${proto.defId}`));
      box.appendChild(meta);
      const motto = el('div', 'card-text-seg');
      motto.appendChild(el('span', 'card-text-seg-label', '座右铭：'));
      motto.appendChild(document.createTextNode(proto.loadingText));
      box.appendChild(motto);
      const kw = el('div', 'card-text-seg');
      kw.appendChild(el('span', 'card-text-seg-label', '关键词：'));
      kw.appendChild(document.createTextNode(proto.commands.join(' · ')));
      box.appendChild(kw);
      const state = el('div', 'card-text-seg');
      state.appendChild(el('span', 'card-text-seg-label', compiled ? '已编译' : '未编译'));
      box.appendChild(state);
      textEl = box;
    } catch {
      textEl = null;
    }
  }
  if (peek) {
    // 图像上方挂「查看背面」切换按钮：点击在 背面 ↔ 正面 间切换 img.src（该牌背面的
    // 牌面图片 = 官方卡面图）。stage 竖排（按钮在图像上方）；stage pointer-events:none
    // 使图像四周空白点击穿透到遮罩（target=overlay → 关闭），按钮自身可点（ITEM 9）。
    const [proto, value] = splitDefId(defId);
    const faceSrc = cardImgSrc(proto, value);
    const backSrc = '/assets/Cardback.jpg';
    const stage = el('div', 'zoom-stage');
    const peekBtn = el('button', 'btn zoom-peek-btn', showingFace ? '查看背面' : '查看正面');
    peekBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      showingFace = !showingFace;
      img.src = showingFace ? faceSrc : backSrc;
      peekBtn.textContent = showingFace ? '查看背面' : '查看正面';
      if (textEl) textEl.style.display = showingFace ? '' : 'none';
    });
    // 按钮先于图像 append：flex column 首子节点在上 → 「查看背面」按钮位于图像上方
    stage.appendChild(peekBtn);
    stage.appendChild(img);
    body.appendChild(stage);
  } else {
    body.appendChild(img);
  }
  if (textEl) body.appendChild(textEl);
  overlay.appendChild(body);
  // 滚轮缩放：协议卡横向（rotate(-90deg)）需与 scale 组合在 transform 里
  let scale = 1;
  const apply = () => {
    img.style.transform = isProtocol
      ? `rotate(-90deg) scale(${scale})`
      : `scale(${scale})`;
  };
  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    scale = Math.min(6, Math.max(1, scale + (e.deltaY < 0 ? 0.25 : -0.25)));
    apply();
  };
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeZoom(); };
  // 点击遮罩空白处（target 是 overlay 本身而非 img）退出
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeZoom(); });
  overlay.addEventListener('wheel', onWheel, { passive: false });
  document.addEventListener('keydown', onKey);
  document.body.appendChild(overlay);
  zoomState = { overlay, img, scale, isProtocol, onKey, textEl, showingFace };
  apply();
}

function closeZoom(): void {
  if (!zoomState) return;
  document.removeEventListener('keydown', zoomState.onKey);
  zoomState.overlay.remove();
  zoomState = null;
}

/* ===== 弃牌堆查看遮罩（顶部信息条「查看弃牌堆」按钮） =====
 * 复用 zoom-overlay 背景样式（点击空白 / Esc 关闭），面板内以网格展示该玩家弃牌堆的
 * 全部卡牌（弃牌堆为公开信息，全部正面展示）；双击卡牌可进一步放大查看。
 * 遮罩挂在 document.body 上，重渲染后依然存活（与 openZoom 相同）。
 */
let trashViewerOverlay: HTMLElement | null = null;
let trashViewerOnKey: ((e: KeyboardEvent) => void) | null = null;

function openTrashViewer(s: GameState, player: PlayerId): void {
  if (trashViewerOverlay) closeTrashViewer();
  const overlay = el('div', 'zoom-overlay');
  const panel = el('div', 'trash-viewer');
  panel.appendChild(el('div', 'trash-viewer-title', `玩家 ${player + 1} 的弃牌堆`));
  const grid = el('div', 'trash-viewer-grid');
  const trash = s.players[player].trash;
  if (trash.length === 0) {
    grid.appendChild(el('div', 'trash-viewer-empty', '弃牌堆为空'));
  } else {
    for (const card of trash) {
      const node = renderCardFace({ defId: card.defId, faceUp: true, uid: card.uid });
      node.addEventListener('dblclick', () => openZoom(card.defId, true, false, false));
      grid.appendChild(node);
    }
  }
  panel.appendChild(grid);
  overlay.appendChild(panel);
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeTrashViewer(); };
  // 点击遮罩空白处（target 是 overlay 本身而非面板）退出
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeTrashViewer(); });
  document.addEventListener('keydown', onKey);
  document.body.appendChild(overlay);
  trashViewerOverlay = overlay;
  trashViewerOnKey = onKey;
}

function closeTrashViewer(): void {
  if (!trashViewerOverlay) return;
  if (trashViewerOnKey) document.removeEventListener('keydown', trashViewerOnKey);
  trashViewerOverlay.remove();
  trashViewerOverlay = null;
  trashViewerOnKey = null;
}

/* ===== 牌库顺序查看（修改提示词 14）：对局结束后点击牌库 → 展示剩余牌及抽取顺序 ===== */
let deckOrderOverlay: HTMLElement | null = null;
let deckOrderOnKey: ((e: KeyboardEvent) => void) | null = null;

function openDeckOrderViewer(s: GameState, player: PlayerId): void {
  if (deckOrderOverlay) closeDeckOrderViewer();
  const overlay = el('div', 'zoom-overlay');
  const panel = el('div', 'deck-order-viewer');
  panel.appendChild(el('div', 'deck-order-title', `玩家 ${player + 1} 的牌库（对局结束 · 自上而下 = 抽取顺序）`));
  const grid = el('div', 'deck-order-grid');
  const deck = s.players[player].deck;
  if (deck.length === 0) {
    grid.appendChild(el('div', 'trash-viewer-empty', '牌库为空'));
  } else {
    // deck 数组约定：索引 0 = 牌库底，末位 = 牌库顶（下一张抽）→ 倒序展示「顶在前」
    for (let i = deck.length - 1; i >= 0; i--) {
      const card = deck[i];
      const cell = el('div', 'deck-order-cell');
      cell.appendChild(renderCardFace({ defId: card.defId, faceUp: true, uid: card.uid }));
      cell.appendChild(el('div', 'deck-order-tag', i === deck.length - 1 ? '下一张' : `${deck.length - i} 张后`));
      grid.appendChild(cell);
    }
  }
  panel.appendChild(grid);
  overlay.appendChild(panel);
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeDeckOrderViewer(); };
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeDeckOrderViewer(); });
  document.addEventListener('keydown', onKey);
  document.body.appendChild(overlay);
  deckOrderOverlay = overlay;
  deckOrderOnKey = onKey;
}

function closeDeckOrderViewer(): void {
  if (!deckOrderOverlay) return;
  if (deckOrderOnKey) document.removeEventListener('keydown', deckOrderOnKey);
  deckOrderOverlay.remove();
  deckOrderOverlay = null;
  deckOrderOnKey = null;
}

/**
 * 单击/双击判别：300ms 窗口内两次点击视为双击（double），否则延迟执行单击（single）。
 * 单击延迟 320ms 严格大于双击窗口 300ms：窗口内的第二次点击必然先于延迟的单击触发
 * 并取消它，保证「双击永不触发单击」；窗口之外的点击各自成为独立的单击。
 */
/** 单击/双击判别（320ms 窗口内第二次点击 = 双击）：单击 single、双击 double。
 *  导出供图鉴页复用（草稿/图鉴同款：单击固定展示、双击放大）。 */
export function bindClickOrDouble(node: HTMLElement, single: () => void, double: () => void, stopPropagation: boolean): void {
  let timer: number | undefined;
  let last = 0;
  node.addEventListener('click', (e) => {
    if (stopPropagation) e.stopPropagation();
    const now = Date.now();
    if (now - last < 300) {
      if (timer !== undefined) { clearTimeout(timer); timer = undefined; }
      last = 0;
      double();
    } else {
      last = now;
      if (timer !== undefined) clearTimeout(timer);
      timer = window.setTimeout(() => { timer = undefined; single(); }, 320);
    }
  });
}

/* ===== 拖拽打牌（Drag & Drop，手牌卡 → 线路槽） =====
 * 手动 mousemove/mouseup 追踪（非原生 DnD API，避免与单击/双击事件互相干扰）：
 * - mousedown 仅记录起点与卡 uid；移动超过 8px 阈值才进入拖拽模式（浮空幽灵卡跟随
 *   光标 + 当前玩家槽位中该卡可合法落点的线高亮 .drag-target）。
 * - 未超阈值的按下-释放不干预，单击选择 / 双击放大仍由 bindClickOrDouble 处理。
 * - 拖拽中 mouseup：elementFromPoint 向上找 .stack-slot[data-player=当前玩家]，命中
 *   合法线且 s.step==='action' → 复用 playToLine 校验并派发 onAction；否则取消。
 *   原卡从未离开手牌 DOM，取消即移除幽灵卡（"回到原位"自动成立）。
 * - Esc / 窗口失焦 / 渲染重建 → 清理幽灵卡、高亮与监听器。
 * - 翻面按钮（卡牌子节点）上的 mousedown 不启动拖拽。 */
let activeDragCancel: (() => void) | null = null;

function bindCardDrag(node: HTMLElement, s: GameState, cb: UiCallbacks, uid: string): void {
  node.addEventListener('mousedown', (e) => {
    if (choicePromptId !== null) return; // 选择模式下禁止拖拽打牌
    if (e.button !== 0) return;
    // 翻面按钮组是卡牌子节点：按钮/按钮组上按下不启动拖拽（点击仍正常触发翻面）
    const target = e.target as HTMLElement | null;
    if (target && (target.closest('button') || target.closest('.play-btns'))) return;
    const startX = e.clientX;
    const startY = e.clientY;
    let active = false;
    let ghost: HTMLElement | null = null;
    let legalLines = new Set<string>(); // `${player}:${line}` 合法落点（自己/对方槽，修改提示词 15）
    // 拖拽期间的朝向：被拖卡即已选中卡时沿用翻面状态，否则按正面（未选中卡无翻面操作）
    let dragFaceUp = true;

    const clearHighlights = () => {
      for (const slot of document.querySelectorAll<HTMLElement>('.stack-slot.drag-target')) {
        slot.classList.remove('drag-target');
      }
    };
    const cleanup = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('blur', onBlur);
      document.body.classList.remove('dragging');
      ghost?.remove();
      ghost = null;
      clearHighlights();
      activeDragCancel = null;
    };

    const positionGhost = (ev: MouseEvent) => {
      if (!ghost) return;
      // 光标大致位于幽灵卡中心：卡宽 130px 减半后略偏上，卡片不遮住光标
      ghost.style.transform = `translate(${ev.clientX - 65}px, ${ev.clientY - 50}px) scale(0.9)`;
    };

    const beginDrag = () => {
      active = true;
      dragFaceUp = selectedUid === uid ? selectedFaceUp : true;
      document.body.classList.add('dragging');
      // 合法落点：该卡以当前朝向（dragFaceUp）可打的所有 (player,line)——自己槽打自己场；
      // corruption-0（修改提示词 15）还可落对方槽（target=对方），engine getLegalActions 为准
      legalLines = new Set<string>();
      for (const a of getLegalActions(s, s.turnPlayer)) {
        if (a.kind === 'play' && a.cardUid === uid && a.line !== undefined && a.faceUp === dragFaceUp) {
          legalLines.add(`${a.target ?? s.turnPlayer}:${a.line}`);
        }
      }
      // 高亮属于合法 (player,line) 的槽
      for (const slot of document.querySelectorAll<HTMLElement>('.stack-slot')) {
        if (legalLines.has(`${slot.dataset.player}:${slot.dataset.line}`)) slot.classList.add('drag-target');
      }
      // 幽灵卡：克隆原卡（监听器不会被复制），去掉翻面按钮组与悬停残留样式
      ghost = node.cloneNode(true) as HTMLElement;
      ghost.classList.add('drag-ghost');
      ghost.classList.remove('popped');
      ghost.style.transform = '';
      ghost.querySelector('.play-btns')?.remove();
      document.body.appendChild(ghost);
      positionGhost(e);
    };

    const onMove = (ev: MouseEvent) => {
      if (!active) {
        // 超过阈值才进入拖拽；之前的移动不 preventDefault，保证单击/双击正常
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) > 8) beginDrag();
        return;
      }
      ev.preventDefault(); // 拖拽中阻止文本选择等默认行为
      positionGhost(ev);
    };

    const onUp = (ev: MouseEvent) => {
      if (!active) {
        cleanup();
        return;
      }
      const hit = document.elementFromPoint(ev.clientX, ev.clientY);
      const slot = hit ? (hit as HTMLElement).closest<HTMLElement>('.stack-slot') : null;
      const slotPlayer = slot ? Number(slot.dataset.player) as PlayerId : null;
      const line = slot ? Number(slot.dataset.line) : -1;
      const legalDrop =
        slot !== null && slotPlayer !== null && s.step === 'action' &&
        legalLines.has(`${slotPlayer}:${line}`);
      cleanup(); // 先清理幽灵/高亮/监听，再派发（renderApp 会重建 DOM）
      if (legalDrop && slotPlayer !== null) {
        // 落点合法：把选中状态提交为被拖的卡（playToLine 校验并派发后复位）
        selectedUid = uid;
        selectedFaceUp = dragFaceUp;
        playToLine(s, cb, line as Line, slotPlayer);
      }
    };

    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') cleanup();
    };
    const onBlur = () => cleanup();

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    document.addEventListener('keydown', onKey);
    window.addEventListener('blur', onBlur);
    activeDragCancel = cleanup;
  });
}

export function renderApp(root: HTMLElement, s: GameState, cb: UiCallbacks): void {
  // 拖拽安全网：若重渲染发生在拖拽中（正常流程不会），先清理幽灵卡与高亮
  if (activeDragCancel) activeDragCancel();
  // 草稿展示框仅在草稿页存在：进入游玩（或其它页面）时移除 body 级 fixed 面板
  // （草稿 → 游玩过渡不走 resetUiState——此前面板残留到游玩页，用户反馈）
  if (s.phase !== 'draft') removeDraftPreviews();
  // 重渲染动画抑制（fix: hover-pop 重放）：每次全量重渲染都会重建 DOM，若鼠标仍停留在
  // 原位置，新元素会重新触发 mouseenter → hover 过渡（上浮/推开）从初始态再播一遍，
  // 造成抽帧卡顿。重建期间给根容器加 .no-anim（CSS 对卡牌等元素 transition:none），
  // 双 rAF 后再移除：保证新元素的首帧绘制（含悬停态应用）发生在 no-anim 窗口内，
  // 之后的交互恢复正常过渡。仅抑制 transition、不动 animation，故 draft-pick-in /
  // battery-cell-in 等有意的进场动画不受影响。
  root.classList.add('no-anim');
  if (s.phase === 'draft') {
    renderDraft(root, s, cb);
  } else {
    renderBoard(root, s, cb);
  }
  // FX-5：check-cache 锁链（步骤转换驱动——进入 check-cache 且 spirit-0 生效时生成 20 条
  // 亮紫锁链，离开时缩回消散；draft 阶段只记录转换不播；须在 DOM 挂载后调用）
  syncCheckCacheChains(s);
  // FX-R2：渲染间手牌区布局变动（重排/换位等）→ 锁链层重定位跟随（幂等，层不存在跳过）
  syncChainLayerPosition();
  cb.onRendered?.();
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      root.classList.remove('no-anim');
    });
  });
}

