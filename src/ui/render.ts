import type { GameState, PlayerId, Line } from '../core/models/types';
import { getLineValue, getDraftPool, getCurrentDrafter } from '../core/state/create';
import { getLegalActions, type LegalAction } from '../core/game';

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
function renderCardFace(card: { defId: string; faceUp: boolean }): HTMLElement {
  const box = el('div', 'card');
  // 背面卡（对手手牌 / 场上的背面堆叠）不暴露身份：仅正面卡携带 data-def-id
  if (card.faceUp) box.dataset.defId = card.defId;
  if (!card.faceUp) {
    const back = el('div', 'card-back');
    const img = document.createElement('img');
    img.src = '/assets/Cardback.jpg';
    img.alt = 'card back';
    img.className = 'cardback-img';
    back.appendChild(img);
    back.appendChild(el('span', 'card-back-value', '2'));
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
  return box;
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
  slot.appendChild(el('div', 'slot-label', `线${line + 1}`));
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
    pile.appendChild(node);
  }
  if (cards.length === 0) {
    pile.appendChild(el('div', 'stack-empty', '空'));
  }
  slot.appendChild(pile);
  slot.appendChild(el('div', 'line-value', `值 ${getLineValue(s, player, line)}`));
  if (interactable) {
    slot.addEventListener('click', () => onPlay(line));
  }
  return slot;
}

/** 玩家信息条：标题（回合高亮）+ 牌库/弃牌堆/手牌计数（手牌本体在底部条带） */
function renderPlayerInfo(s: GameState, player: PlayerId, opts: { isSelf: boolean }): HTMLElement {
  const p = s.players[player];
  const active = player === s.turnPlayer;
  const info = el('div', `player-info${active ? ' active' : ''}${opts.isSelf ? ' self' : ''}`);
  info.appendChild(el('div', 'area-title', `玩家 ${player + 1}${active ? '（回合中）' : ''}`));

  const meta = el('div', 'meta-row');
  meta.appendChild(el('span', 'deck-count', `牌库 ${p.deck.length}`));
  meta.appendChild(el('span', 'trash-count', `弃牌堆 ${p.trash.length}`));
  meta.appendChild(el('span', 'hand-count', `手牌 ${p.hand.length}`));
  info.appendChild(meta);
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
    /** 选中卡上 正面/背面 打入按钮回调（切换 selectedFaceUp 后重渲染） */
    onToggleFaceUp?: (faceUp: boolean) => void;
  }
): HTMLElement {
  const reversed = player === 1; // P2 右起、向左延伸；P1 左起、向右延伸（默认左对齐）
  const hand = el('div', 'hand' + (opts.isSelf ? ' self' : '') + (reversed ? ' reversed' : ''));
  const cards = s.players[player].hand;
  const shown = cards.slice(0, 10);
  const nodes: HTMLElement[] = [];
  for (const card of shown) {
    const node = renderCardFace({ defId: card.defId, faceUp: opts.isSelf });
    node.dataset.uid = card.uid;
    const i = nodes.length;
    const isSelected = opts.isSelf && opts.selected === card.uid;
    if (isSelected) node.classList.add('selected');
    if (opts.isSelf) {
      node.addEventListener('click', (e) => {
        e.stopPropagation();
        opts.onSelect(card.uid);
      });
    }
    // ITEM 1: 选中卡且处于 action 步骤 → 卡上缘上方浮动 正面打入/背面打入 按钮。
    // 按钮是卡牌子节点：悬停按钮时指针始终位于卡牌子树内，hover-pop 保持不消失
    // （复位只挂在手牌容器 mouseleave 上，穿过卡↔按钮间隙也不会触发复位）。
    if (isSelected && s.step === 'action' && opts.onToggleFaceUp) {
      const atLeft = reversed ? i === shown.length - 1 : i === 0;
      const atRight = reversed ? i === 0 : i === shown.length - 1;
      const group = el('div', 'play-btns' + (atLeft ? ' at-left' : atRight ? ' at-right' : ''));
      const up = el('button', 'btn play-btn', '正面打入');
      up.addEventListener('click', (e) => {
        e.stopPropagation();
        opts.onToggleFaceUp!(true);
      });
      const down = el('button', 'btn play-btn', '背面打入');
      down.addEventListener('click', (e) => {
        e.stopPropagation();
        opts.onToggleFaceUp!(false);
      });
      group.appendChild(up);
      group.appendChild(down);
      node.appendChild(group);
    }
    hand.appendChild(node);
    nodes.push(node);
  }
  if (cards.length > 10) {
    hand.appendChild(el('div', 'hand-more-badge', `+${cards.length - 10}`));
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

/**
 * 控制权滑动指示条（R6，R7 行程加长）：双方三线总值对比决定控制卡在轨道上的位置——
 * P1 占优靠左、P2 占优靠右（clamp 5%..95% 保证卡不滑出轨道），双方均为 0 时居中。
 * 控制卡归属（s.control）只影响高亮/灰化：中立灰化，持有方加光晕。
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
    target = Math.min(95, Math.max(5, raw));
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
  cell.appendChild(el('div', 'protocol-owner', `玩家 ${player + 1}`));
  cell.appendChild(renderProtocol(s.players[player].protocols[line], player));
  return cell;
}

export function renderDraft(root: HTMLElement, s: GameState, cb: UiCallbacks): void {
  root.textContent = '';
  const wrap = el('div', 'draft-screen');
  wrap.appendChild(el('h1', 'title', 'Compile 译世界 — 协议草案'));
  wrap.appendChild(el('div', 'draft-hint', `轮到 玩家 ${getCurrentDrafter(s) + 1} 选择协议`));
  const pool = el('div', 'draft-pool');
  for (const proto of getDraftPool(s)) {
    const card = el('div', 'protocol-card');
    card.appendChild(el('div', 'protocol-name', proto.name));
    card.appendChild(el('div', 'protocol-commands', proto.commands.join(' · ')));
    card.appendChild(el('div', 'protocol-loading', proto.loadingText));
    const btn = el('button', 'btn', '选择');
    btn.addEventListener('click', () => cb.onDraftPick(proto.defId));
    card.appendChild(btn);
    pool.appendChild(card);
  }
  wrap.appendChild(pool);
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

  // 顶部条带：双方信息 + 中间控制组件
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
  handStrip.appendChild(
    renderHand(s, 0, {
      isSelf: s.turnPlayer === 0,
      selected: s.turnPlayer === 0 ? selectedUid : null,
      onSelect: (uid) => {
        selectedUid = uid;
        renderApp(root, s, cb);
      },
      onToggleFaceUp: (faceUp) => {
        selectedFaceUp = faceUp;
        renderApp(root, s, cb);
      },
    })
  );
  handStrip.appendChild(el('div', 'step-indicator', `步骤: ${s.step}`));
  handStrip.appendChild(
    renderHand(s, 1, {
      isSelf: s.turnPlayer === 1,
      selected: s.turnPlayer === 1 ? selectedUid : null,
      onSelect: (uid) => {
        selectedUid = uid;
        renderApp(root, s, cb);
      },
      onToggleFaceUp: (faceUp) => {
        selectedFaceUp = faceUp;
        renderApp(root, s, cb);
      },
    })
  );
  grid.appendChild(handStrip);
  wrap.appendChild(grid);

  const actionBar = el('div', 'action-bar');
  const legal = getLegalActions(s, s.turnPlayer);
  for (const a of legal) {
    if (a.kind === 'play') continue; // 打牌通过点击手牌+线完成
    const label = a.kind === 'compile' ? `编译线 ${(a.line ?? 0) + 1}` : a.kind === 'refresh' ? '刷新手牌' : '下一步';
    const btn = el('button', 'btn', label);
    btn.addEventListener('click', () => cb.onAction(a));
    actionBar.appendChild(btn);
  }
  if (s.step === 'action') {
    // ITEM 1: 正面打入/背面打入 已移到选中卡上方的浮动按钮，底栏仅保留提示
    actionBar.appendChild(
      el('span', 'hint', selectedUid ? '已选择卡牌 — 在卡牌上方选择朝向，然后点击一条线放置' : '点击手牌选择卡牌')
    );
  }
  wrap.appendChild(actionBar);

  const log = el('div', 'log');
  for (const entry of s.log.slice(-12)) {
    log.appendChild(el('div', 'log-entry', entry));
  }
  wrap.appendChild(log);

  root.appendChild(wrap);
}

let selectedUid: string | null = null;
let selectedFaceUp = true;

export function renderApp(root: HTMLElement, s: GameState, cb: UiCallbacks): void {
  if (s.phase === 'draft') {
    renderDraft(root, s, cb);
  } else {
    renderBoard(root, s, cb);
  }
  cb.onRendered?.();
}
