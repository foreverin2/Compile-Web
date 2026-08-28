import type { GameState, PlayerId, Line, ProtocolDef } from '../core/models/types';
import { getLineValue, getCurrentDrafter } from '../core/state/create';
import { getLegalActions, type LegalAction } from '../core/game';
import { DEMO_PROTOCOLS } from '../data/demo';
import { downloadLog } from './diag';

export interface UiCallbacks {
  onAction(a: LegalAction): void;
  onDraftPick(defId: string): void;
  /** 每次渲染完成后回调（供 UI 层做自动推进等） */
  onRendered?(): void;
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
  const img = document.createElement('img');
  // R1 协议卡朝向：P1（左）按原图方向展示；P2（右）旋转 180° 使双方协议相对放置。
  // PNG 资源为原方向（水/火/光/生 750×1050 竖版，暗/死 1050×750 横版），各按自然比例显示。
  img.className = 'protocol-img' + (player === 1 ? ' rot-180' : '');
  img.src = `/assets/protocols/${p.defId}/protocol-${p.compiled ? 'compiled' : 'loading'}.png`;
  img.alt = p.compiled ? 'compiled protocol' : 'protocol loading';
  box.appendChild(img);
  if (p.compiled) box.appendChild(el('span', 'protocol-check', '✓'));
  // 双击协议卡放大查看（协议无单击动作，直接 dblclick 即可；协议图横向展示）
  box.addEventListener('dblclick', () => openZoom(p.defId, true, true, p.compiled));
  return box;
}

/**
 * 线值电池指示器（纯 CSS，R8）：位于堆叠槽外侧端（远离协议一侧），垂直居中。
 * 10 格电量 = 该线点值（clamp 0..10）；外壳 4 态按点值：
 * ≤3 stable（方正平直，青色描边）/ 4-6 bulge（上下微微鼓出，橙黄微光）/
 * 7-9 full（明显鼓胀接近圆润，橙色强光 + 应力裂纹）/ ≥10 burst（爆裂：径向爆光 +
 * 裂纹 + 红橙脉冲；10 格仍全部点亮）。pointer-events:none —— 纯视觉，不拦截槽位
 * 打牌点击与卡牌交互。
 */
/**
 * 电池状态跟踪：记录每个 (player, line) 的上一次点数与形态，用于在点数变化时
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
  // DOM 顺序 = 视觉顺序（flex column 自上而下）：正极凸头在上、外壳（10 格竖排）居中、
  // 值标签在底部。格填充方向由 CSS .battery-cells 的 column-reverse 控制（从下到上增加）。
  battery.appendChild(el('div', 'battery-cap'));
  const shell = el('div', 'battery-shell');
  const cells = el('div', 'battery-cells');
  const filled = Math.min(points, 10);
  for (let i = 0; i < 10; i++) {
    cells.appendChild(el('span', 'battery-cell' + (i < filled ? ' filled' : '')));
  }
  shell.appendChild(cells);
  battery.appendChild(shell);
  battery.appendChild(el('span', 'battery-value', String(points)));
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
    if (selected === card.uid) node.classList.add('selected');
    // 单击=打牌（仅可交互时）、双击=放大查看（双方场上卡均为公开信息）。
    // 双击判别：单击延迟 320ms 严格大于 300ms 双击窗口，窗口内第二次点击先于延迟的
    // 单击触发并取消它，故双击永不误打牌；窗口之外的点击各自成为独立的单击。
    // stopPropagation 阻断冒泡到槽自身的 click（槽空白处点击仍直接打牌，二者不重复触发）。
    bindClickOrDouble(
      node,
      () => { if (interactable) onPlay(line); },
      () => openZoom(card.defId, card.faceUp, false, false),
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

/**
 * 手牌条：self（回合玩家）正面可点选，对手背面展示。
 * R6 扇形手牌：单行不换行（.hand 负 margin 重叠）；最多渲染 10 张，超出部分以
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
    /** 刷新手牌按钮：仅当刷新是合法动作（当前玩家 + action 步骤 + 手牌 < 5）时渲染，
     *  位于手牌挡板外侧（P1 在挡板左侧、P2 在挡板右侧），点击派发 refresh 动作 */
    onRefresh?: () => void;
    refreshEnabled?: boolean;
  }
): HTMLElement {
  const reversed = player === 1; // P2 右起、向左延伸；P1 左起、向右延伸（默认左对齐）
  const hand = el('div', 'hand' + (opts.isSelf ? ' self' : '') + (reversed ? ' reversed' : ''));
  const cards = s.players[player].hand;
  // 点 4：手牌从左到右按数值升序显示（P1/P2 一致）。
  // 数值取 defId 后缀（'fire-3' → 3）。排序仅影响显示顺序，引擎 hand 数组不变。
  // P1 渲染升序（index 0 最左=最小）；P2 为 row-reverse（index 0 在最右），
  // 故渲染降序使视觉上最左=最小、向右递增。
  const byValue = [...cards].sort(
    (a, b) => parseInt(splitDefId(a.defId)[1], 10) - parseInt(splitDefId(b.defId)[1], 10)
  );
  const shown = (reversed ? [...byValue].reverse() : byValue).slice(0, 10);
  const nodes: HTMLElement[] = [];
  for (const card of shown) {
    const i = nodes.length;
    const isSelected = opts.isSelf && opts.selected === card.uid;
    // 手牌显示：self 手牌默认正面；若该卡被选中且当前朝向为背面（selectedFaceUp=false），
    // 立即以背面预览显示（点击「翻面」时翻转手牌区外观）。
    const faceUp = opts.isSelf ? !(isSelected && !selectedFaceUp) : false;
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
  if (cards.length > 10) {
    hand.appendChild(el('div', 'hand-more-badge', `+${cards.length - 10}`));
  }
  // R8 手牌挡板：当前回合玩家可拉出/推回遮住自己的手牌。被盖住的卡不触发
  // hover-pop / 单击 / 拖拽（挡板 z-index 高于卡牌并拦截指针）。宽度按玩家持久化
  // 在 shieldWidth（模块态），重渲染后保留；仅 self（当前回合）手牌的挡板可拖，
  // 对手挡板锁定但状态保留。
  hand.appendChild(renderShield(s, player, opts.isSelf, hand));
  // 刷新手牌按钮：紧跟挡板之后渲染（相邻兄弟，CSS 用 .hand-shield.p1 + / .p2 + 定位），
  // 置于挡板外侧（P1 左 / P2 右）。紧凑半透明青色，与「翻面」按钮（.play-btn）同风格；
  // 仅在刷新是合法动作（refreshEnabled）时出现，点击派发 refresh。
  if (opts.refreshEnabled && opts.onRefresh) {
    const refreshBtn = el('button', 'shield-refresh-btn', '刷新手牌');
    refreshBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      opts.onRefresh!();
    });
    hand.appendChild(refreshBtn);
  }
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
    // 最大宽度 = 整个手牌区宽度（能覆盖全部手牌至协议中线）
    const maxW = Math.max(0, hand.clientWidth);
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
  cell.appendChild(renderProtocol(s.players[player].protocols[line], player));
  return cell;
}

/** 与引擎一致的 1-2-2-1 轮选归属（第 i 次选择轮到谁），镜像 core/state/create.ts 的 DRAFT_ORDER */
const DRAFT_PICK_OWNER: PlayerId[] = [0, 1, 1, 0, 0, 1];

/** 玩家已选协议（按选择顺序）：P1 取第 0/3/4 次、P2 取第 1/2/5 次（与引擎分派一致） */
function picksOf(s: GameState, player: PlayerId): ProtocolDef[] {
  return s.draftPicks.filter((_, i) => DRAFT_PICK_OWNER[i] === player);
}

/** 一方的已选协议列：loading 面 PNG 按选择顺序竖排；空槽显示「尚未选择」占位 */
function renderPickColumn(s: GameState, player: PlayerId, drafter: PlayerId): HTMLElement {
  const col = el('div', `draft-picks p${player + 1}${drafter === player ? ' active' : ''}`);
  const title = el('div', 'draft-picks-title', `玩家 ${player + 1} 已选`);
  if (drafter === player) title.appendChild(el('span', 'draft-picks-turn', '● 轮选'));
  col.appendChild(title);
  const list = el('div', 'draft-picks-list');
  const picks = picksOf(s, player);
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
    list.appendChild(card);
  }
  col.appendChild(list);
  return col;
}

/** 中间协议池：全部 6 套演示协议，每行 4 个；悬停聚焦并浮现「选择」按钮；
 *  已选协议变灰禁用（不可悬停/不可点）；点击选择派发 onDraftPick（引擎校验当前轮选者） */
function renderDraftPool(s: GameState, cb: UiCallbacks): HTMLElement {
  const pool = el('div', 'draft-pool');
  const picked = new Set(s.draftPicks.map((p) => p.defId));
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
      const btn = el('button', 'btn draft-pick-btn', '选择');
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        cb.onDraftPick(proto.defId);
      });
      card.appendChild(btn);
    }
    pool.appendChild(card);
  }
  return pool;
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
  layout.appendChild(renderPickColumn(s, 0, drafter));
  layout.appendChild(renderDraftPool(s, cb));
  layout.appendChild(renderPickColumn(s, 1, drafter));
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

export function renderBoard(root: HTMLElement, s: GameState, cb: UiCallbacks): void {
  root.textContent = '';
  // 清除失效选择：所选卡不在当前回合玩家手牌中（已被打出/刷新生效/回合切换）时复位
  const sel = selectedUid;
  if (sel !== null && !s.players[s.turnPlayer].hand.some((c) => c.uid === sel)) {
    selectedUid = null;
    selectedFaceUp = true;
  }
  const wrap = el('div', 'board');
  if (s.phase === 'gameover' && s.winner !== null) {
    wrap.appendChild(el('div', 'winner-banner', `玩家 ${s.winner + 1} 获胜！`));
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

  // 底部条带：双方手牌 + 中间步骤指示
  const handStrip = el('div', 'hand-strip');
  const legal = getLegalActions(s, s.turnPlayer);
  // 刷新手牌：移到当前玩家手牌挡板外侧渲染（renderHand），不再出现在操作行
  const refreshAction = legal.find((a) => a.kind === 'refresh') ?? null;
  handStrip.appendChild(
    renderHand(s, 0, {
      isSelf: s.turnPlayer === 0,
      selected: s.turnPlayer === 0 ? selectedUid : null,
      onSelect: (uid) => {
        selectedUid = uid;
        selectedFaceUp = true; // 选择新卡时重置为正面（避免继承上一张的翻面状态）
        renderApp(root, s, cb);
      },
      onToggleFaceUp: () => {
        selectedFaceUp = !selectedFaceUp;
        renderApp(root, s, cb);
      },
      cb,
      refreshEnabled: s.turnPlayer === 0 && refreshAction !== null,
      onRefresh: () => { if (refreshAction) cb.onAction(refreshAction); },
    })
  );
  handStrip.appendChild(el('div', 'step-indicator', `步骤: ${s.step}`));
  handStrip.appendChild(
    renderHand(s, 1, {
      isSelf: s.turnPlayer === 1,
      selected: s.turnPlayer === 1 ? selectedUid : null,
      onSelect: (uid) => {
        selectedUid = uid;
        selectedFaceUp = true; // 选择新卡时重置为正面（避免继承上一张的翻面状态）
        renderApp(root, s, cb);
      },
      onToggleFaceUp: () => {
        selectedFaceUp = !selectedFaceUp;
        renderApp(root, s, cb);
      },
      cb,
      refreshEnabled: s.turnPlayer === 1 && refreshAction !== null,
      onRefresh: () => { if (refreshAction) cb.onAction(refreshAction); },
    })
  );
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
  // 导出日志按钮：页面底部操作行（可随时导出诊断日志）
  const diagBtn = el('button', 'btn diag-btn', '导出日志');
  diagBtn.title = '导出诊断日志（错误 + 控制台记录 + 事件日志 + 状态快照）';
  diagBtn.addEventListener('click', () => downloadLog(s));
  actionBar.appendChild(diagBtn);
  wrap.appendChild(actionBar);

  // 选择模式（效果结算挂起且顶部为选择请求时）：候选卡高亮 + 底部确认条
  const topEffect = s.pendingEffects[s.pendingEffects.length - 1];
  if (topEffect?.prompt) {
    const prompt = topEffect.prompt;
    // 同步本地选择状态（重渲染后保留）；prompt 变化时重置
    if (choicePromptId !== topEffect.id) {
      choicePromptId = topEffect.id;
      choiceSelected = [];
    }
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
    // 归属者标签：出选择请求的效果属主（PendingEffect.player，非 prompt 自身）
    bar.appendChild(el('div', 'choice-title', `${topEffect.player === 0 ? 'P1' : 'P2'} 操作 — ${prompt.title}`));
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

  root.appendChild(wrap);
}

let selectedUid: string | null = null;
let selectedFaceUp = true;
/** R8 手牌挡板宽度（px，模块态：重渲染后保留；0=收起、手牌可见） */
const shieldWidth: [number, number] = [0, 0];

/** 选择模式状态：当前应答的 promptId 与已选 uid（重渲染保留，选择完成后清空） */
let choicePromptId: string | null = null;
let choiceSelected: string[] = [];

/* ===== 卡牌放大查看遮罩（双击卡牌：手牌/场上/协议；滚轮缩放；Esc 或点击空白关闭） ===== */
interface ZoomState {
  overlay: HTMLElement;
  img: HTMLImageElement;
  scale: number;
  isProtocol: boolean;
  onKey: (e: KeyboardEvent) => void;
}
let zoomState: ZoomState | null = null;

/** 打开卡牌放大查看遮罩。defId: 卡牌定义 id；faceUp: 是否正面；isProtocol: 是否协议卡；compiled: 协议是否已编译 */
function openZoom(defId: string, faceUp: boolean, isProtocol: boolean, compiled: boolean): void {
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
  overlay.appendChild(img);
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
  cb.onRendered?.();
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      root.classList.remove('no-anim');
    });
  });
}
