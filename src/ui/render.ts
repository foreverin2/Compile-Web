import type { GameState, PlayerId, Line } from '../core/models/types';
import { getCardDef, getProtocolDef } from '../data/demo';
import { getLineValue, getDraftPool } from '../core/state/create';
import { getLegalActions, type LegalAction } from '../core/game';

export interface UiCallbacks {
  onAction(a: LegalAction): void;
  onDraftPick(defId: string): void;
}

function el(tag: string, cls: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

function renderCardFace(card: { defId: string; faceUp: boolean }): HTMLElement {
  const def = getCardDef(card.defId);
  const box = el('div', 'card');
  box.dataset.defId = card.defId;
  if (!card.faceUp) {
    box.appendChild(el('div', 'card-back', '?'));
    return box;
  }
  box.appendChild(el('div', 'card-value', String(def.value)));
  box.appendChild(el('div', 'card-protocol', def.protocol));
  if (def.top) box.appendChild(el('div', 'card-top', def.top));
  if (def.middle) box.appendChild(el('div', 'card-middle', def.middle));
  if (def.bottom) box.appendChild(el('div', 'card-bottom', def.bottom));
  return box;
}

function renderProtocol(p: { defId: string; compiled: boolean }): HTMLElement {
  const def = getProtocolDef(p.defId);
  const box = el('div', 'protocol' + (p.compiled ? ' compiled' : ''));
  box.appendChild(el('div', 'protocol-name', p.compiled ? `${def.name} ✓` : def.name));
  box.appendChild(el('div', 'protocol-loading', p.compiled ? 'COMPILED' : def.loadingText));
  return box;
}

function renderStackLine(s: GameState, player: PlayerId, line: Line, selected: string | null, onPlay: (line: Line) => void): HTMLElement {
  const zone = el('div', 'line-zone');
  zone.appendChild(renderProtocol(s.players[player].protocols[line]));
  const stack = el('div', 'stack');
  for (const card of s.players[player].stacks[line]) {
    const node = renderCardFace(card);
    node.dataset.uid = card.uid;
    if (selected === card.uid) node.classList.add('selected');
    stack.appendChild(node);
  }
  zone.appendChild(stack);
  zone.appendChild(el('div', 'line-value', `值 ${getLineValue(s, player, line)}`));
  zone.addEventListener('click', () => onPlay(line));
  return zone;
}

function renderPlayerArea(s: GameState, player: PlayerId, opts: { isSelf: boolean; selected: string | null; onSelect: (uid: string) => void; onPlay: (line: Line) => void }): HTMLElement {
  const p = s.players[player];
  const area = el('div', 'player-area' + (player === s.turnPlayer ? ' active' : ''));
  area.appendChild(el('div', 'area-title', `玩家 ${player + 1}${player === s.turnPlayer ? '（回合中）' : ''}`));

  const meta = el('div', 'meta-row');
  meta.appendChild(el('span', 'deck-count', `牌库 ${p.deck.length}`));
  meta.appendChild(el('span', 'trash-count', `弃牌堆 ${p.trash.length}`));
  meta.appendChild(el('span', 'hand-count', `手牌 ${p.hand.length}`));
  area.appendChild(meta);

  const lines = el('div', 'lines');
  for (const line of [0, 1, 2] as Line[]) {
    lines.appendChild(renderStackLine(s, player, line, opts.selected, opts.onPlay));
  }
  area.appendChild(lines);

  const hand = el('div', 'hand');
  for (const card of p.hand) {
    const node = renderCardFace({ defId: card.defId, faceUp: opts.isSelf });
    node.dataset.uid = card.uid;
    if (opts.selected === card.uid) node.classList.add('selected');
    node.addEventListener('click', (e) => {
      e.stopPropagation();
      opts.onSelect(card.uid);
    });
    hand.appendChild(node);
  }
  area.appendChild(hand);
  return area;
}

export function renderDraft(root: HTMLElement, s: GameState, cb: UiCallbacks): void {
  root.textContent = '';
  const wrap = el('div', 'draft-screen');
  wrap.appendChild(el('h1', 'title', 'Compile 译世界 — 协议草案'));
  wrap.appendChild(el('div', 'draft-hint', `轮到 玩家 ${s.turnPlayer + 1} 选择协议`));
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

export function renderBoard(root: HTMLElement, s: GameState, cb: UiCallbacks): void {
  root.textContent = '';
  const wrap = el('div', 'board');
  if (s.phase === 'turn' && s.step === 'start') {
    const handoff = el('div', 'handoff-banner', `▶ 请将设备交给 玩家 ${s.turnPlayer + 1}，然后点击「下一步」开始`);
    wrap.appendChild(handoff);
  }
  if (s.phase === 'gameover' && s.winner !== null) {
    wrap.appendChild(el('div', 'winner-banner', `玩家 ${s.winner + 1} 获胜！`));
  }

  const opp = renderPlayerArea(s, s.turnPlayer === 0 ? 1 : 0, { isSelf: false, selected: null, onSelect: () => {}, onPlay: () => {} });
  wrap.appendChild(opp);

  const midline = el('div', 'midline');
  midline.appendChild(el('div', 'step-indicator', `步骤: ${s.step} · 控制组件: ${s.control === -1 ? '中立' : `玩家 ${s.control + 1}`}`));
  wrap.appendChild(midline);

  const self = renderPlayerArea(s, s.turnPlayer, {
    isSelf: true,
    selected: selectedUid,
    onSelect: (uid) => { selectedUid = uid; renderApp(root, s, cb); },
    onPlay: (line) => {
      if (selectedUid) {
        cb.onAction({ kind: 'play', cardUid: selectedUid, faceUp: selectedFaceUp, line });
        selectedUid = null;
        selectedFaceUp = true;
      }
    },
  });
  wrap.appendChild(self);

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
      upBtn.addEventListener('click', () => { selectedFaceUp = true; renderApp(root, s, cb); });
      const downBtn = el('button', 'btn', '背面打入');
      downBtn.addEventListener('click', () => { selectedFaceUp = false; renderApp(root, s, cb); });
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
}
