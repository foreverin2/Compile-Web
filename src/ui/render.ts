import type { ChoiceRequest, GameState, PendingEffect, PlayerId, Line, ProtocolDef, Step } from '../core/models/types';
import { getLineValue, getCurrentDrafter, draftTurnRange, lineTopCommandActive } from '../core/state/create';
import { getLegalActions, type LegalAction } from '../core/game';
import {
  opponentMustPlayFaceDown,
  lineBlocksOpponent,
  lineBlocksOpponentFaceDown,
  lineMiddleCommandsNullified,
  shouldSkipCacheCheck,
  canPlayFaceUpAnywhere,
} from '../core/rules/restrictions';
import { DEMO_PROTOCOLS } from '../data/demo';
import { downloadLog } from './diag';

export interface UiCallbacks {
  onAction(a: LegalAction): void;
  onDraftPick(defId: string): void;
  /** 取消本回合的选择（把已选协议拖出选择框） */
  onDraftUnpick(defId: string): void;
  /** 每次渲染完成后回调（供 UI 层做自动推进等） */
  onRendered?(): void;
  /** 胜利结算遮罩「返回主界面」按钮：应用内重置回草案主界面（main.ts 实现） */
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
 * - 正面：官方卡面图 /assets/protocols/<协议>/card-<分值>.png
 * - 背面：官方 Cardback 图 + 印刷值 2 徽章（规则：背面牌值=2）
 */
function renderCardFace(card: { defId: string; faceUp: boolean; uid: string }): HTMLElement {
  const box = el('div', 'card');
  // 卡牌实例标识：选择模式 / 拖拽等按 uid 定位（对所有卡牌渲染路径统一写入）
  box.dataset.uid = card.uid;
  // 背面卡（对手手牌 / 场上的背面堆叠）不暴露身份：仅正面卡携带 data-def-id
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
  img.src = `/assets/protocols/${protocol}/card-${value}.png`;
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
    // 未编译：释放该 defId 的持久 FX（若有）
    const fx = compiledFx.get(p.defId);
    if (fx) {
      fx.remove();
      compiledFx.delete(p.defId);
    }
  }
  const img = document.createElement('img');
  // R1 协议卡朝向：P1（左）按原图方向展示；P2（右）旋转 180° 使双方协议相对放置。
  // PNG 资源为原方向（水/火/光/生 750×1050 竖版，暗/死 1050×750 横版），各按自然比例显示。
  img.className = 'protocol-img' + (player === 1 ? ' rot-180' : '');
  img.src = `/assets/protocols/${p.defId}/protocol-${p.compiled ? 'compiled' : 'loading'}.png`;
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
 * 线值能量条指示器（纯 CSS）：位于堆叠槽外侧端（远离协议一侧），垂直居中。
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
  return battery;
}

/**
 * 一条线的堆叠槽（横向条带）：stacks[line] 中 pos 0 为最早打出（贴协议一侧），
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
  const slot = el('div', `stack-slot p${player + 1}${interactable ? ' interactable self' : ''}`);
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
    // R2 场上卡牌旋转：仅场上堆叠（正反面一致）；手牌 / 草案不受影响
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
    // stopPropagation 阻断冒泡到槽自身的 click（槽空白处点击仍直接打牌，二者不重复触发）。
    bindClickOrDouble(
      node,
      () => { if (interactable) onPlay(line); },
      () => openZoom(card.defId, card.faceUp, false, false, !card.faceUp && card.owner === s.turnPlayer && !card.secret),
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
 *  堆叠槽边框持续浮现又消散的黑烟。12 个 .smoke-puff 沿边框锚点分布（CSS nth-child 定位），
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
 * player 只能反面打出）期间，被限制方 player 的三条链路堆叠上持续出现小型紫粉粒子
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
 * lineBlocksOpponent(s, line, player) 为真（该 player 的对手该线堆叠顶卡为未覆盖
 * 正面 plague-0 → player 此列禁打）期间，被限制方 player 的该线堆叠持续渐现渐消
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

/* ===== FX-5：常驻冷漠灰雾（apathy-0 顶命令 → 该线双方堆叠浓雾循环） =====
 * lineTopCommandActive(s, line, 'apathy-0') 为真（任一玩家该线堆叠有正面 apathy-0——
 * 顶命令被盖仍生效，口径同 darkness-2 黑烟）期间，该线【双方】堆叠槽持续渐现渐消灰色
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
 *   为真时，持卡方该线堆叠槽铺金属铁板 + 斜长方形光芒从左到右循环扫过。key = `${holder}-${line}`
 *   （双方可在同一线互为 metal-2 → 同线双板，按槽分键防撞，同 FX-3 瘟疫浓雾先例）。
 * - syncMetal6Mans（metal-6 手牌）：手牌含 metal-6 → 该卡牌面循环渐现 man.png（2s 周期），
 *   key = uid；卡离开手牌（弃/打/回）→ 移除层。 */
const metal0Glows = new Map<string, HTMLElement>();
const metalPlates = new Map<string, HTMLElement>();
const metal6Mans = new Map<string, HTMLElement>();

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

/** metal-0：该线双方堆叠有正面 metal-0（顶命令常驻，含被盖）→ 持卡方对手该线能量条金属光泽边框 */
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
 *  → 持卡方（player 的对手）该线堆叠槽铺金属铁板 + 斜光扫过（.fx-metal-plate/.fx-metal-sweep） */
export function syncMetalPlates(s: GameState): void {
  const activeKeys = new Set<string>();
  for (const line of [0, 1, 2] as Line[]) {
    for (const blocked of [0, 1] as PlayerId[]) {
      if (!lineBlocksOpponentFaceDown(s, line, blocked)) continue;
      const holder: PlayerId = blocked === 0 ? 1 : 0; // 持 metal-2 的一方（其堆叠被铺铁板）
      const key = `${holder}-${line}`;
      activeKeys.add(key);
      const slot = document.querySelector<HTMLElement>(
        `.stack-slot[data-player="${holder}"][data-line="${line}"]`
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

/* ===== FX-5：check-cache 锁链（spirit-0 跳过检查缓存，一次性步骤触发） =====
 * 触发：s.step === 'check-cache' 且 shouldSkipCacheCheck(s, player)（实际只有回合玩家
 * 会停在 check-cache——runAutoAdvance 在该玩家应跳过时自动 advance）→ 以该玩家手牌区
 * 边框为起点、朝手牌区中央延伸 20 条亮紫锁链（.fx-spirit-chains：body 级 fixed 层 +
 * SVG 20 条 <line>，虚线描边 = 锁链节纹理，整体紫辉）。
 * 实现要点（模块级 prevStep 跟踪步骤转换）：
 * - 步骤从非 check-cache → check-cache（且条件成立）→ 生成锁链层（一次性，不随重渲染重建）；
 * - 步骤离开 check-cache → 锁链层加 .fx-spirit-chains-out（1s 缩回消散：向中心微缩 + 淡出），
 *   1s 后移除（边框恢复为常驻光芒——spirit0Glows 若仍生效继续亮）；
 * - 生成（buildChainLayer）：上/下边各 10 条、起点/终点各在 10 个等分段内随机（起点集合与
 *   终点集合互不重叠——用户规格「起点与终点互不重叠」）+ 段内偏移保证基本倾斜；
 *   20 条链都穿越手牌区中央，线段交叉是几何必然，不禁止。 */
const CHAIN_COUNT = 20;
const CHAIN_RETRACT_MS = 1000; // 离开 check-cache 后锁链缩回消散时长
let prevStep: Step | null = null;
let chainLayer: HTMLElement | null = null;

/** 构建 20 条锁链层（SVG，viewBox = 手牌区 rect）。
 *  用户规格「锁链起点与终点互不重叠、基本倾斜」：
 *  - 上/下边各 10 条；起点边 10 个等分段、每段内随机取起点 → 起点集合互不重叠；
 *  - 终点在相对边对应段内随机 + 段内偏移保证 |Δx| ≥ 最小倾斜 → 终点集合互不重叠；
 *  - 20 条链都穿越手牌区中央，线段交叉是几何必然（视觉为散布锁链网），不禁止交叉。 */
function buildChainLayer(rect: DOMRect): HTMLElement {
  const layer = el('div', 'fx-spirit-chains');
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
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', x1.toFixed(1));
      line.setAttribute('y1', fromTop ? '3' : (H - 3).toFixed(1));
      line.setAttribute('x2', x2.toFixed(1));
      line.setAttribute('y2', fromTop ? (H - 3).toFixed(1) : '3');
      svg.appendChild(line);
    }
  }
  layer.appendChild(svg);
  return layer;
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
    const layer = buildChainLayer(rect);
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
}

/** 玩家信息条：标题（回合高亮）+ 牌库/弃牌堆/手牌计数（手牌本体在底部条带） */
function renderPlayerInfo(s: GameState, player: PlayerId, opts: { isSelf: boolean }): HTMLElement {
  const p = s.players[player];
  const active = player === s.turnPlayer;
  const info = el('div', `player-info p${player + 1}${active ? ' active' : ''}${opts.isSelf ? ' self' : ''}`);
  info.appendChild(el('div', 'area-title', `玩家 ${player + 1}${active ? '（回合中）' : ''}`));

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
  return deck;
}

/** 弃牌堆区（renderDeck 的镜像，ITEM 3）：层叠背面卡 + 中央计数，绝对定位堆叠于牌库
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
      // 对手手牌（背面朝下）：单击无操作、双击放大查看卡背（需求：任意卡均可双击放大）。
      bindClickOrDouble(
        node,
        () => {},
        () => openZoom(card.defId, false, false, false),
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
 * 控制权滑动指示条（R6，R7 行程加长）：双方三线总值对比决定控制卡在轨道上的位置——
 * P1 占优靠左、P2 占优靠右（clamp 1%..99% 使偏向更明显，轨道 overflow visible 保证不出轨），
 * 双方均为 0 时居中。控制卡归属（s.control）只影响高亮/灰化：中立灰化，持有方加光晕。
 * 由于渲染模型每次重建 DOM，直接设置 left 不会触发 transition；因此先写入上一帧
 * 位置、下一帧再写入目标位置，让 left 0.5s 过渡真正产生滑动动画。
 */
let controlSliderPos = 50;

function renderControlModule(s: GameState): HTMLElement {
  const total0 = getLineValue(s, 0, 0) + getLineValue(s, 0, 1) + getLineValue(s, 0, 2);
  const total1 = getLineValue(s, 1, 0) + getLineValue(s, 1, 1) + getLineValue(s, 1, 2);
  let target = 50;
  if (total0 + total1 > 0) {
    // raw 取 P2 占比：P1 占优 → total1≈0 → 靠左(5%)；P2 占优 → total1≈total → 靠右(95%)
    const raw = (total1 / (total0 + total1)) * 100;
    target = Math.min(99, Math.max(1, raw));
  }
  const neutral = s.control === -1;
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

/** 与引擎一致的 1-2-2-1 轮选归属（第 i 次选择轮到谁），镜像 core/state/create.ts 的 DRAFT_ORDER */
const DRAFT_PICK_OWNER: PlayerId[] = [0, 1, 1, 0, 0, 1];

/** 玩家已选协议（按选择顺序）：P1 取第 0/3/4 次、P2 取第 1/2/5 次（与引擎分派一致） */
function picksOf(s: GameState, player: PlayerId): ProtocolDef[] {
  return s.draftPicks.filter((_, i) => DRAFT_PICK_OWNER[i] === player);
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
  const turnStart = draftTurnRange(s.draftRound).start;
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
    img.src = `/assets/protocols/${pick.defId}/protocol-loading.png`;
    img.alt = pick.name;
    wrap.appendChild(img);
    card.appendChild(wrap);
    card.appendChild(el('div', 'draft-pick-name', pick.name));
    // 双击放大查看协议图（复用遮罩）
    card.addEventListener('dblclick', () => openZoom(pick.defId, true, true, false));
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

/** 中间协议池：全部 15 套协议，每行 4 个；悬停聚焦。
 *  选中方式：拖拽协议卡到【当前轮选者】的选择框松手（选中）；松手位置不在自己的
 *  选择框区域 → 丝滑平移回原卡位置。双击协议卡可放大查看协议图。已选协议变灰禁用。 */
function renderDraftPool(s: GameState, cb: UiCallbacks): HTMLElement {
  const pool = el('div', 'draft-pool');
  const picked = new Set(s.draftPicks.map((p) => p.defId));
  const drafter = getCurrentDrafter(s);
  for (const proto of DEMO_PROTOCOLS) {
    const isPicked = picked.has(proto.defId);
    const card = el('div', 'draft-card' + (isPicked ? ' picked' : ''));
    const wrap = el('div', 'draft-card-img-wrap');
    const img = document.createElement('img');
    img.className = 'draft-card-img';
    img.src = `/assets/protocols/${proto.defId}/protocol-loading.png`;
    img.alt = proto.name;
    wrap.appendChild(img);
    card.appendChild(wrap);
    card.appendChild(el('div', 'draft-card-name', proto.name));
    card.appendChild(el('div', 'draft-card-commands', proto.commands.join(' · ')));
    if (isPicked) {
      card.appendChild(el('span', 'draft-picked-badge', '已选'));
    } else {
      // 双击放大查看协议图（单击无动作）；拖拽选协议
      bindClickOrDouble(card, () => {}, () => openZoom(proto.defId, true, true, false), false);
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
        // 拖出选择框：动画回到协议池原位后取消选择
        const poolCards = document.querySelectorAll<HTMLElement>('.draft-pool .draft-card');
        const idx = DEMO_PROTOCOLS.findIndex((p) => p.defId === defId);
        const target = poolCards[idx];
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

export function renderDraft(root: HTMLElement, s: GameState, cb: UiCallbacks): void {
  root.textContent = '';
  const wrap = el('div', 'draft-screen');
  wrap.appendChild(el('h1', 'title', 'Compile 译世界 — 协议草案'));

  const header = el('div', 'draft-header');
  const drafter = getCurrentDrafter(s);
  header.appendChild(el('div', 'draft-hint', `轮到 玩家 ${drafter + 1} 选择协议`));
  // 轮次进度：第 X/6 次 + 1-2-2-1 步点追踪（当前步高亮、已过步打勾色）
  const progress = el('div', 'draft-progress');
  progress.appendChild(
    el('span', 'draft-progress-text', `第 ${Math.min(s.draftRound + 1, DRAFT_PICK_OWNER.length)} / ${DRAFT_PICK_OWNER.length} 次选择`)
  );
  const track = el('div', 'draft-step-track');
  for (let i = 0; i < DRAFT_PICK_OWNER.length; i++) {
    const state = i < s.draftRound ? ' done' : i === s.draftRound ? ' current' : '';
    track.appendChild(el('span', 'draft-step-dot' + state, String(DRAFT_PICK_OWNER[i] + 1)));
  }
  progress.appendChild(track);
  header.appendChild(progress);
  wrap.appendChild(header);

  const layout = el('div', 'draft-layout');
  layout.appendChild(renderPickColumn(s, 0, drafter, cb));
  layout.appendChild(renderDraftPool(s, cb));
  layout.appendChild(renderPickColumn(s, 1, drafter, cb));
  wrap.appendChild(layout);
  root.appendChild(wrap);
}

/** 打牌交互：选手牌 → 点（self 侧）堆叠槽；越步/协议不匹配等非法点击一律忽略 */
function playToLine(s: GameState, cb: UiCallbacks, line: Line): void {
  if (!selectedUid) return;
  const uid = selectedUid;
  const faceUp = selectedFaceUp;
  // 先复位选择，避免已打出的牌在重渲染中残留 selected 高亮
  selectedUid = null;
  selectedFaceUp = true;
  if (s.step !== 'action') return;
  const legal = getLegalActions(s, s.turnPlayer);
  const playable = legal.some(
    (a) => a.kind === 'play' && a.cardUid === uid && a.line === line && a.faceUp === faceUp
  );
  if (!playable) return;
  cb.onAction({ kind: 'play', cardUid: uid, faceUp, line });
}

/** 胜利遮罩是否已显示（防重复创建；返回主界面时由 resetUiState 复位） */
let winOverlayShown = false;

/** 胜利结算遮罩：玩家 N 获胜！+「返回主界面」按钮。body 级 fixed（z-index 10000 高于
 *  一切浮层：放大遮罩 1000 / 拖拽幽灵 9999 / 开发者浮层 9999），一次性创建、常驻直到
 *  用户确认（不自动消失、不随重渲染重建——胜利后本就不再有渲染）。点击按钮 → 移除
 *  遮罩 + cb.onWinReset（main.ts 应用内重置回草案主界面）。遮罩全屏拦截指针（modal），
 *  关闭后 diag 按钮等不受影响。 */
function showWinOverlay(winner: PlayerId, cb: UiCallbacks): void {
  if (winOverlayShown) return;
  winOverlayShown = true;
  const overlay = el('div', 'win-overlay');
  const panel = el('div', 'win-panel');
  panel.appendChild(el('div', 'win-title', `玩家 ${winner + 1} 获胜！`));
  panel.appendChild(el('div', 'win-sub', '本局结束'));
  const btn = el('button', 'btn win-confirm-btn', '返回主界面');
  btn.addEventListener('click', () => {
    overlay.remove();
    cb.onWinReset?.();
  });
  panel.appendChild(btn);
  overlay.appendChild(panel);
  document.body.appendChild(overlay);
}

export function renderBoard(root: HTMLElement, s: GameState, cb: UiCallbacks): void {
  root.textContent = '';
  compiledFxCells.length = 0; // 本帧持久 FX 收集器复位（renderProtocol 逐格登记）
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
  // 每条线是一个水平行：P1 堆叠槽 | P1 协议 | P2 协议 | P2 堆叠槽，
  // 协议对与其两个堆叠槽落在同一水平带内（平行对齐）。
  // 牌库/弃牌/手牌计数与手牌本体分别放在顶部条带与底部条带的左右两侧。
  const grid = el('div', 'board-grid');

  // 顶部条带：双方信息 + 中间控制组件（导出日志按钮在底部操作行）
  const strip = el('div', 'player-strip');
  strip.appendChild(renderPlayerInfo(s, 0, { isSelf: s.turnPlayer === 0 }));
  strip.appendChild(renderControlModule(s));
  strip.appendChild(renderPlayerInfo(s, 1, { isSelf: s.turnPlayer === 1 }));
  grid.appendChild(strip);

  // 三条线（每线一行，同行 4 格水平对齐）
  for (const line of [0, 1, 2] as Line[]) {
    const row = el('div', 'lane-row');
    // 线编号：select-line 选择模式据此高亮并即答 ['line:N']
    row.dataset.line = String(line);
    row.appendChild(
      renderStackSlot(s, 0, line, s.turnPlayer === 0 ? selectedUid : null, s.turnPlayer === 0 ? (l) => playToLine(s, cb, l) : () => {}, s.turnPlayer === 0)
    );
    row.appendChild(renderProtocolCell(s, 0, line));
    row.appendChild(renderProtocolCell(s, 1, line));
    row.appendChild(
      renderStackSlot(s, 1, line, s.turnPlayer === 1 ? selectedUid : null, s.turnPlayer === 1 ? (l) => playToLine(s, cb, l) : () => {}, s.turnPlayer === 1)
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
      : a.kind === 'resolve-trigger' ? `结算触发效果`
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
  const topEffect = s.pendingEffects[s.pendingEffects.length - 1];
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
      const bar = el('div', 'choice-bar');
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
      bar.appendChild(el('div', 'choice-title', `${(prompt.chooser ?? topEffect.player) === 0 ? 'P1' : 'P2'} 操作 — ${prompt.title}`));
      for (const act of prompt.actions ?? []) {
        const b = el('button', 'btn choice-action-btn', act.replace('action:', ''));
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
  for (const entry of s.log.slice(-12)) {
    log.appendChild(el('div', 'log-entry', entry));
  }
  wrap.appendChild(log);

  // 导出日志按钮：页面最底部（简要日志下方）
  const diagBtn = el('button', 'btn diag-btn', '导出日志');
  diagBtn.title = '导出诊断日志（错误 + 控制台记录 + 事件日志 + 状态快照）';
  diagBtn.addEventListener('click', () => downloadLog(s));
  wrap.appendChild(diagBtn);

  root.appendChild(wrap);
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
  // FX-5 常驻协议特效：apathy-0 冷漠灰雾（槽位已入 DOM）/ spirit-0 手牌区框光芒 /
  // spirit-1 手牌卡边框护角（手牌已入 DOM → 按 .hand[data-player] / 手牌卡 rect 重定位；
  // 条件消失后移除并注销）
  syncApathyMists(s);
  syncSpirit0Glows(s);
  syncSpirit1Cards(s);
  // FX-6 常驻金属特效：metal-0 对方能量槽金属边框（电池已入 DOM → 按 .battery-shell 矩形）/
  // metal-2 持卡方链路铁板+斜光（槽位已入 DOM）/ metal-6 手牌 man 渐现（手牌已入 DOM →
  // 按 .card[data-uid] 矩形；条件消失后移除并注销）
  syncMetal0Glows(s);
  syncMetalPlates(s);
  syncMetal6Mans(s);
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
  for (const fx of compiledFx.values()) fx.remove();
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
  // FX-5 常驻注册表：冷漠灰雾 / 灵魂-0 手牌区光芒 / 灵魂-1 手牌卡护角（移除层 + 清表）；
  // check-cache 锁链层（一次性，离开步骤时已置 null 交由定时器清理，此处兜底直清）+ prevStep 复位
  for (const layer of apathyMists.values()) layer.remove();
  apathyMists.clear();
  for (const glow of spirit0Glows.values()) glow.remove();
  spirit0Glows.clear();
  for (const layer of spirit1Cards.values()) layer.remove();
  spirit1Cards.clear();
  // FX-6 常驻注册表：金属0 能量槽边框 / 金属2 链路铁板 / 金属6 手牌 man（移除层 + 清表）
  for (const glow of metal0Glows.values()) glow.remove();
  metal0Glows.clear();
  for (const layer of metalPlates.values()) layer.remove();
  metalPlates.clear();
  for (const layer of metal6Mans.values()) layer.remove();
  metal6Mans.clear();
  if (chainLayer) {
    chainLayer.remove();
    chainLayer = null;
  }
  prevStep = null;
  controlSliderPos = 50;
  closeZoom();
  closeTrashViewer();
  winOverlayShown = false;
  // 飞行中的协议瞬时特效（life 藤蔓容器 / 绿光 / water 水环·光晕·落点框 / 翻面覆盖层）与
  // 抽牌/揭示幽灵：自身定时器会在数百毫秒内移除，但重置时立即清扫，避免残留进新局
  // （旧动画的 done() 完成回调由 main.ts resetEpoch 世代守卫放弃渲染）。
  for (const fx of document.querySelectorAll<HTMLElement>(
    '.life-flip-fx, .life-flip-glow, .water-return-ring, .water-return-glow, .water-return-settle, ' +
      '.water-return-trail, .flip-overlay-fx, .draw-ghost, .reveal-fly-ghost, ' +
      '.fx-gravity-deckglow, .fx-gravity-hole, .fx-gravity-beam, .fx-gravity-cardglow, .fx-speed-glow, ' +
      '.fx-psychic, .fx-plague, .fx-love-deckglow, .fx-love-fly, .fx-love-settle, .fx-love-heart, ' +
      '.fx-apathy, .fx-spirit-chains, .fx-metal-lineglow'
  )) {
    fx.remove();
  }
}

/** 选择确认条（select-line 用）：归属者标签 + 提示文案；线槽点击即答，无需确认钮 */
function choiceBar(pe: PendingEffect, prompt: ChoiceRequest, cb: UiCallbacks, hint: string): HTMLElement {
  const bar = el('div', 'choice-bar');
  bar.appendChild(el('div', 'choice-title', `${(prompt.chooser ?? pe.player) === 0 ? 'P1' : 'P2'} 操作 — ${prompt.title}`));
  bar.appendChild(el('div', 'choice-hint', hint));
  return bar;
}

/* ===== 卡牌放大查看遮罩（双击卡牌：手牌/场上/协议；滚轮缩放；Esc 或点击空白关闭） ===== */
interface ZoomState {
  overlay: HTMLElement;
  img: HTMLImageElement;
  scale: number;
  isProtocol: boolean;
  onKey: (e: KeyboardEvent) => void;
}
let zoomState: ZoomState | null = null;

/** 打开卡牌放大查看遮罩。defId: 卡牌定义 id；faceUp: 是否正面；isProtocol: 是否协议卡；
 *  compiled: 协议是否已编译；peek: 是否带「查看背面」切换按钮（ITEM 9：自己的反面场上卡
 *  背面起显，点击在 背面 ↔ 正面 之间切换显示）。
 *  FX-5 冷漠2：放大查看器【不受】场上 .apathy-filter 灰度滤镜影响——本函数按 defId 新建
 *  img（非克隆场上节点），滤镜类从不被继承（场上/弃牌堆查看的 dblclick 同样走 defId 新建）。 */
function openZoom(defId: string, faceUp: boolean, isProtocol: boolean, compiled: boolean, peek?: boolean): void {
  if (zoomState) closeZoom();
  const overlay = el('div', 'zoom-overlay');
  const img = document.createElement('img');
  img.className = 'zoom-img' + (isProtocol ? ' zoom-protocol' : '');
  if (isProtocol) {
    img.src = `/assets/protocols/${defId}/protocol-${compiled ? 'compiled' : 'loading'}.png`;
  } else if (faceUp) {
    const [proto, value] = splitDefId(defId);
    img.src = `/assets/protocols/${proto}/card-${value}.png`;
  } else {
    img.src = '/assets/Cardback.jpg';
  }
  img.alt = 'card zoom';
  if (peek) {
    // 图像上方挂「查看背面」切换按钮：点击在 背面 ↔ 正面 间切换 img.src（该牌背面的
    // 牌面图片 = 官方卡面图）。stage 竖排（按钮在图像上方）；stage pointer-events:none
    // 使图像四周空白点击穿透到遮罩（target=overlay → 关闭），按钮自身可点（ITEM 9）。
    const [proto, value] = splitDefId(defId);
    const faceSrc = `/assets/protocols/${proto}/card-${value}.png`;
    const backSrc = '/assets/Cardback.jpg';
    const stage = el('div', 'zoom-stage');
    const peekBtn = el('button', 'btn zoom-peek-btn', '查看背面');
    peekBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const showingFace = img.src.endsWith(faceSrc);
      img.src = showingFace ? backSrc : faceSrc;
      peekBtn.textContent = showingFace ? '查看背面' : '查看正面';
    });
    // 按钮先于图像 append：flex column 首子节点在上 → 「查看背面」按钮位于图像上方
    stage.appendChild(peekBtn);
    stage.appendChild(img);
    overlay.appendChild(stage);
  } else {
    overlay.appendChild(img);
  }
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
  zoomState = { overlay, img, scale, isProtocol, onKey };
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

/**
 * 单击/双击判别：300ms 窗口内两次点击视为双击（double），否则延迟执行单击（single）。
 * 单击延迟 320ms 严格大于双击窗口 300ms：窗口内的第二次点击必然先于延迟的单击触发
 * 并取消它，保证「双击永不触发单击」；窗口之外的点击各自成为独立的单击。
 */
function bindClickOrDouble(node: HTMLElement, single: () => void, double: () => void, stopPropagation: boolean): void {
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
    let legalLines = new Set<number>();
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
      // 合法落点：该卡以当前朝向（dragFaceUp）可打的所有线，engine getLegalActions 为准
      legalLines = new Set<number>();
      for (const a of getLegalActions(s, s.turnPlayer)) {
        if (a.kind === 'play' && a.cardUid === uid && a.line !== undefined && a.faceUp === dragFaceUp) {
          legalLines.add(a.line);
        }
      }
      // 高亮当前玩家槽位中属于合法线的槽
      for (const slot of document.querySelectorAll<HTMLElement>(`.stack-slot[data-player="${s.turnPlayer}"]`)) {
        if (legalLines.has(Number(slot.dataset.line))) slot.classList.add('drag-target');
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
      const slot = hit
        ? (hit as HTMLElement).closest<HTMLElement>(`.stack-slot[data-player="${s.turnPlayer}"]`)
        : null;
      const line = slot ? Number(slot.dataset.line) : -1;
      const legalDrop = slot !== null && s.step === 'action' && legalLines.has(line);
      cleanup(); // 先清理幽灵/高亮/监听，再派发（renderApp 会重建 DOM）
      if (legalDrop) {
        // 落点合法：把选中状态提交为被拖的卡（playToLine 校验并派发后复位）
        selectedUid = uid;
        selectedFaceUp = dragFaceUp;
        playToLine(s, cb, line as Line);
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
  cb.onRendered?.();
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      root.classList.remove('no-anim');
    });
  });
}
