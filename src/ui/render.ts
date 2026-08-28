import type { GameState, PlayerId, Line } from '../core/models/types';
import { getCardDef, getProtocolDef } from '../data/demo';
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

/** 卡牌正面的一个指令区：顶部=常驻，中部=即时（活跃区），底部=辅助 */
function renderZone(zone: 'top' | 'middle' | 'bottom', label: string, text: string): HTMLElement {
  const z = el('div', `card-zone card-zone-${zone}`);
  z.appendChild(el('span', 'zone-label', label));
  z.appendChild(el('div', 'zone-text', text));
  return z;
}

/**
 * 卡牌正面/背面：
 * - 正面：数值 + 协议 + 三指令区（常驻/即时/辅助），各带边框与标签
 * - 背面：官方 Cardback 图 + 印刷值 2 徽章（规则：背面牌值=2）
 */
function renderCardFace(card: { defId: string; faceUp: boolean }): HTMLElement {
  const def = getCardDef(card.defId);
  const box = el('div', 'card');
  box.dataset.defId = card.defId;
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
  const head = el('div', 'card-head');
  head.appendChild(el('div', 'card-value', String(def.value)));
  head.appendChild(el('div', 'card-protocol', getProtocolDef(def.protocol).name));
  box.appendChild(head);
  if (def.top) box.appendChild(renderZone('top', '常驻', def.top));
  if (def.middle) box.appendChild(renderZone('middle', '即时', def.middle));
  if (def.bottom) box.appendChild(renderZone('bottom', '辅助', def.bottom));
  return box;
}

/**
 * 被盖住的牌（堆叠中非顶层）：按规则仅显示数值 + 顶部（常驻）指令；
 * 中部（即时）与底部（辅助）指令被遮蔽失效，不显示。
 * 背面牌无指令，印刷值按规则为 2，标注"背面"。
 */
function renderCoveredCard(card: { defId: string; faceUp: boolean }): HTMLElement {
  const def = getCardDef(card.defId);
  const box = el('div', 'card covered');
  box.dataset.defId = card.defId;
  box.appendChild(el('div', 'card-value', String(card.faceUp ? def.value : 2)));
  if (card.faceUp && def.top) {
    box.appendChild(el('div', 'card-covered-text', def.top));
  } else if (!card.faceUp) {
    box.appendChild(el('div', 'card-covered-text', '背面'));
  }
  return box;
}

function renderProtocol(p: { defId: string; compiled: boolean }): HTMLElement {
  const def = getProtocolDef(p.defId);
  const box = el('div', 'protocol' + (p.compiled ? ' compiled' : ''));
  box.appendChild(el('div', 'protocol-name', p.compiled ? `${def.name} ✓` : def.name));
  box.appendChild(el('div', 'protocol-loading', p.compiled ? 'COMPILED' : def.loadingText));
  return box;
}

/**
 * 一条线的堆叠槽（横置条带）：stacks[line] 中 pos 0 为底层（最早打出、被盖得最狠），
 * 最后一个元素为顶层（未覆盖）。渲染时顶层卡牌完整显示（活跃），
 * 被盖住的牌以压缩条形式堆叠其下（仅数值+常驻指令，半透明、错位）。
 */
function renderStackSlot(
  s: GameState,
  player: PlayerId,
  line: Line,
  selected: string | null,
  onPlay: (line: Line) => void,
  interactable: boolean
): HTMLElement {
  const slot = el('div', 'stack-slot' + (interactable ? ' interactable' : ''));
  slot.appendChild(el('div', 'slot-label', `线${line + 1}`));
  const cards = s.players[player].stacks[line];
  const pile = el('div', 'stack');
  // 视觉自上而下：顶层（未覆盖）在上，被盖住的牌在下；zIndex=pos 保证上层盖住下层
  for (let i = cards.length - 1; i >= 0; i--) {
    const card = cards[i];
    const isTop = i === cards.length - 1;
    const node = isTop ? renderCardFace(card) : renderCoveredCard(card);
    if (isTop) node.classList.add('top-card');
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

function renderPlayerColumn(
  s: GameState,
  player: PlayerId,
  opts: { isSelf: boolean; selected: string | null; onSelect: (uid: string) => void; onPlay: (line: Line) => void }
): HTMLElement {
  const p = s.players[player];
  const active = player === s.turnPlayer;
  const col = el('div', `player-col${active ? ' active' : ''}${opts.isSelf ? ' self' : ''}`);
  col.appendChild(el('div', 'area-title', `玩家 ${player + 1}${active ? '（回合中）' : ''}`));

  const meta = el('div', 'meta-row');
  meta.appendChild(el('span', 'deck-count', `牌库 ${p.deck.length}`));
  meta.appendChild(el('span', 'trash-count', `弃牌堆 ${p.trash.length}`));
  meta.appendChild(el('span', 'hand-count', `手牌 ${p.hand.length}`));
  col.appendChild(meta);

  for (const line of [0, 1, 2] as Line[]) {
    col.appendChild(
      renderStackSlot(s, player, line, opts.isSelf ? opts.selected : null, opts.isSelf ? opts.onPlay : () => {}, opts.isSelf)
    );
  }

  const hand = el('div', 'hand');
  for (const card of p.hand) {
    const node = renderCardFace({ defId: card.defId, faceUp: opts.isSelf });
    node.dataset.uid = card.uid;
    if (opts.isSelf && opts.selected === card.uid) node.classList.add('selected');
    if (opts.isSelf) {
      node.addEventListener('click', (e) => {
        e.stopPropagation();
        opts.onSelect(card.uid);
      });
    }
    hand.appendChild(node);
  }
  col.appendChild(hand);
  return col;
}

/** 中间公共分隔区：3 条线，每条线左右并排放置双方协议（共 6 格） */
function renderMidColumn(s: GameState): HTMLElement {
  const col = el('div', 'mid-col');
  col.appendChild(el('div', 'mid-title', '公共分隔区'));
  for (const line of [0, 1, 2] as Line[]) {
    const row = el('div', 'protocol-row');
    row.appendChild(renderProtocolCell(s, 0, line));
    row.appendChild(renderProtocolCell(s, 1, line));
    col.appendChild(row);
  }
  col.appendChild(
    el('div', 'step-indicator', `步骤: ${s.step} · 控制组件: ${s.control === -1 ? '中立' : `玩家 ${s.control + 1}`}`)
  );
  return col;
}

function renderProtocolCell(s: GameState, player: PlayerId, line: Line): HTMLElement {
  const cell = el('div', 'protocol-cell');
  cell.appendChild(el('div', 'protocol-owner', `玩家 ${player + 1}`));
  cell.appendChild(renderProtocol(s.players[player].protocols[line]));
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
  if (s.phase === 'turn' && s.step === 'start') {
    const handoff = el('div', 'handoff-banner', `▶ 请将设备交给 玩家 ${s.turnPlayer + 1}，然后点击「下一步」开始`);
    wrap.appendChild(handoff);
  }
  if (s.phase === 'gameover' && s.winner !== null) {
    wrap.appendChild(el('div', 'winner-banner', `玩家 ${s.winner + 1} 获胜！`));
  }

  // 固定布局：玩家 1 恒在左、玩家 2 恒在右（左右对称而非上下对称）；
  // 回合玩家（self）一侧可交互并高亮边框，另一侧手牌显示背面
  const grid = el('div', 'board-grid');
  grid.appendChild(
    renderPlayerColumn(s, 0, {
      isSelf: s.turnPlayer === 0,
      selected: s.turnPlayer === 0 ? selectedUid : null,
      onSelect: (uid) => {
        selectedUid = uid;
        renderApp(root, s, cb);
      },
      onPlay: (line) => playToLine(s, cb, line),
    })
  );
  grid.appendChild(renderMidColumn(s));
  grid.appendChild(
    renderPlayerColumn(s, 1, {
      isSelf: s.turnPlayer === 1,
      selected: s.turnPlayer === 1 ? selectedUid : null,
      onSelect: (uid) => {
        selectedUid = uid;
        renderApp(root, s, cb);
      },
      onPlay: (line) => playToLine(s, cb, line),
    })
  );
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
    if (selectedUid) {
      const upBtn = el('button', 'btn', '正面打入');
      upBtn.addEventListener('click', () => {
        selectedFaceUp = true;
        renderApp(root, s, cb);
      });
      const downBtn = el('button', 'btn', '背面打入');
      downBtn.addEventListener('click', () => {
        selectedFaceUp = false;
        renderApp(root, s, cb);
      });
      actionBar.appendChild(upBtn);
      actionBar.appendChild(downBtn);
      actionBar.appendChild(el('span', 'hint', `朝向: ${selectedFaceUp ? '正面' : '背面'} — 点击一条线放置`));
    } else {
      actionBar.appendChild(el('span', 'hint', '点击手牌选择卡牌'));
    }
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
