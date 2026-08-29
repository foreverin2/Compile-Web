import { gameBus, type GameEvent } from '../../core/events/bus';
import { mountShatter } from '../fx/delete-shatter';
import { mountCut } from '../fx/discard-cut';

const FX_REMOVE_MS = 1200;
const BASE_Z = 300; // 基础行为特效层
const EXTRA_Z = 301; // 协议专属额外特效层（叠加在基础特效之上）
const MOVE_MS = 450; // 平移类特效时长（回手/偏转）

type PlayerId = 0 | 1;

/** 事件载荷里的卡牌面信息（emitCardEvent 已含 defId/faceUp/uid；owner/line 供回手/偏转定位） */
interface FxCardPayload {
  uid: string;
  defId: string;
  faceUp: boolean;
  owner?: PlayerId;
  line?: number | null;
  triggerProtocol?: string;
  triggerDefId?: string;
}

/** 卡面资源 URL（按 defId/faceUp；反面用官方卡背） */
function cardFaceSrc(defId: string, faceUp: boolean): string {
  if (!faceUp) return '/assets/Cardback.jpg';
  const [proto, value] = defId.split('-');
  return `/assets/protocols/${proto}/card-${value}.png`;
}

/** 填满容器的卡面图节点 */
function buildFaceImg(src: string): HTMLElement {
  const img = document.createElement('img');
  img.src = src;
  img.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block;';
  return img;
}

/**
 * 在 body 级构建特效浮层卡（固定定位到原卡位置，不随重渲染销毁）。
 * 卡面直接用【当前卡牌面】按 payload 的 defId/faceUp 构建（官方卡面图 / 卡背），
 * 不克隆原卡 DOM——避免原卡的旋转类、覆盖残留、悬停态等陈旧渲染混入特效；
 * 位置/尺寸取自原卡节点 rect（旋转卡的 rect 即其视觉足迹盒）。
 */
function buildFxCard(node: HTMLElement, payload: FxCardPayload, zIndex: number): HTMLElement | null {
  const rect = node.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return null;
  const card = document.createElement('div');
  card.className = 'card';
  card.appendChild(buildFaceImg(cardFaceSrc(payload.defId, payload.faceUp)));
  card.style.position = 'fixed';
  card.style.left = `${rect.left}px`;
  card.style.top = `${rect.top}px`;
  card.style.width = `${rect.width}px`;
  card.style.height = `${rect.height}px`;
  card.style.margin = '0';
  card.style.padding = '0';
  card.style.border = 'none';
  card.style.background = 'transparent';
  card.style.pointerEvents = 'none';
  card.style.zIndex = String(zIndex);
  document.body.appendChild(card);
  return card;
}

/** 目标手牌末尾位置（新卡落点；与抽牌幽灵同一套扇形步进算法） */
function handEndPos(hand: HTMLElement | undefined, owner: PlayerId): { x: number; y: number } {
  const rect = hand ? hand.getBoundingClientRect() : { top: 0, height: 0, left: 0, right: 0 };
  const y = rect.top + rect.height / 2;
  const cards = hand?.querySelectorAll<HTMLElement>('.card:not(.reveal-ghost)');
  const last = cards && cards.length > 0 ? cards[cards.length - 1] : null;
  if (last) {
    const r = last.getBoundingClientRect();
    return { x: owner === 0 ? r.right + 37 : r.left - 37, y };
  }
  return { x: owner === 0 ? rect.left + 28 + 65 : rect.right - 28 - 65, y };
}

/** 目标链路堆叠末尾位置（偏转落地；P1 向左生长 → 末卡左缘外侧，P2 反向） */
function stackEndPos(slot: HTMLElement | null, owner: PlayerId): { x: number; y: number } | null {
  if (!slot) return null;
  const slotRect = slot.getBoundingClientRect();
  const y = slotRect.top + slotRect.height / 2;
  const cards = slot.querySelectorAll<HTMLElement>('.card');
  const last = cards.length > 0 ? cards[cards.length - 1] : null;
  if (last) {
    const r = last.getBoundingClientRect();
    return { x: owner === 0 ? r.left - 65 : r.right + 65, y };
  }
  return { x: owner === 0 ? slotRect.right - 90 : slotRect.left + 90, y };
}

/** 牌库区位置：取该玩家 .deck[data-player="N"] 的 rect（供牌堆顶打出特效用——Task 4）；
 *  仅读取 DOM，牌库元素缺失时返回 null。 */
export function deckPos(player: PlayerId): DOMRect | null {
  const deck = document.querySelector<HTMLElement>(`.deck[data-player="${player}"]`);
  return deck ? deck.getBoundingClientRect() : null;
}

/** Fire 协议专属额外特效：火焰焚烧（fire-burn.css 覆盖层结构见 public/assets/fire/README.md） */
function playFireBurnExtra(node: HTMLElement, payload: FxCardPayload): void {
  const clone = buildFxCard(node, payload, EXTRA_Z);
  if (!clone) return;
  clone.classList.add('card-burning');
  const overlay = document.createElement('div');
  overlay.className = 'fire-burn-overlay';
  const flame = document.createElement('div');
  flame.className = 'fire-burn-flame';
  const sparks = document.createElement('div');
  sparks.className = 'fire-burn-sparks';
  for (let i = 0; i < 5; i++) sparks.appendChild(Object.assign(document.createElement('div'), { className: 'fire-spark' }));
  overlay.appendChild(flame);
  overlay.appendChild(sparks);
  clone.appendChild(overlay);
  window.setTimeout(() => clone.remove(), FX_REMOVE_MS);
}

/** Light 协议专属额外特效（简易版）：白色柔光层（styles.css .extra-light 覆盖层动画） */
function playLightExtra(node: HTMLElement, payload: FxCardPayload): void {
  const clone = buildFxCard(node, payload, EXTRA_Z);
  if (!clone) return;
  clone.classList.add('extra-light');
  window.setTimeout(() => clone.remove(), FX_REMOVE_MS);
}

/** Darkness 协议专属额外特效（简易版）：暗紫粒子爆散（styles.css .extra-darkness + .darkness-particle） */
function playDarknessExtra(node: HTMLElement, payload: FxCardPayload): void {
  const clone = buildFxCard(node, payload, EXTRA_Z);
  if (!clone) return;
  clone.classList.add('extra-darkness');
  const particles = document.createElement('div');
  particles.className = 'darkness-particles';
  const PARTICLE_COUNT = 8;
  for (let i = 0; i < PARTICLE_COUNT; i++) {
    const p = Object.assign(document.createElement('div'), { className: 'darkness-particle' });
    // 8 方向爆散：每颗粒子沿 (cos/sin) 方向飞离，距离随序号递增
    const angle = (i / PARTICLE_COUNT) * Math.PI * 2;
    const dist = 55 + (i % 3) * 20;
    p.style.setProperty('--dx', `${Math.cos(angle) * dist}px`);
    p.style.setProperty('--dy', `${Math.sin(angle) * dist}px`);
    p.style.animationDelay = `${i * 0.04}s`;
    particles.appendChild(p);
  }
  clone.appendChild(particles);
  window.setTimeout(() => clone.remove(), FX_REMOVE_MS);
}

/** 基础行为特效：删去 → 破碎消散（src/ui/fx/delete-shatter.ts 的 mountShatter） */
function playShatter(node: HTMLElement, payload: FxCardPayload): void {
  const clone = buildFxCard(node, payload, BASE_Z);
  if (!clone) return;
  mountShatter(clone);
  window.setTimeout(() => clone.remove(), FX_REMOVE_MS);
}

/** 基础行为特效：弃牌 → 沿对角线切成两半（src/ui/fx/discard-cut.ts 的 mountCut） */
function playCut(node: HTMLElement, payload: FxCardPayload): void {
  const clone = buildFxCard(node, payload, BASE_Z);
  if (!clone) return;
  mountCut(clone);
  window.setTimeout(() => clone.remove(), FX_REMOVE_MS);
}

/** 基础行为特效：翻面——旧面翻转到新面（rotateY；场上横置卡用 rotateX 使翻面也横着） */
function playFlip(node: HTMLElement, payload: FxCardPayload): void {
  const rect = node.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return;
  const horizontal = node.classList.contains('rot-cw') || node.classList.contains('rot-ccw');
  const oldSrc = node.querySelector('img')?.src ?? cardFaceSrc(payload.defId, payload.faceUp);
  const newSrc = cardFaceSrc(payload.defId, payload.faceUp);
  const wrap = document.createElement('div');
  wrap.style.cssText = `position:fixed;left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px;z-index:300;pointer-events:none;perspective:600px;`;
  const inner = document.createElement('div');
  inner.style.cssText = 'position:relative;width:100%;height:100%;transform-style:preserve-3d;transition:transform 0.35s ease;';
  const front = document.createElement('div');
  front.style.cssText = 'position:absolute;inset:0;backface-visibility:hidden;border-radius:6px;overflow:hidden;';
  front.appendChild(buildFaceImg(oldSrc));
  const back = document.createElement('div');
  back.style.cssText = 'position:absolute;inset:0;backface-visibility:hidden;border-radius:6px;overflow:hidden;';
  back.style.transform = horizontal ? 'rotateX(180deg)' : 'rotateY(180deg)';
  back.appendChild(buildFaceImg(newSrc));
  inner.appendChild(front);
  inner.appendChild(back);
  wrap.appendChild(inner);
  document.body.appendChild(wrap);
  requestAnimationFrame(() => {
    inner.style.transform = horizontal ? 'rotateX(180deg)' : 'rotateY(180deg)';
  });
  window.setTimeout(() => wrap.remove(), 420);
}

/** 基础行为特效：回手——从场上丝滑平移到持有者手牌末尾 */
function playReturn(node: HTMLElement, payload: FxCardPayload): void {
  const rect = node.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0 || payload.owner === undefined) return;
  const clone = buildFxCard(node, payload, BASE_Z);
  if (!clone) return;
  const hand = document.querySelectorAll<HTMLElement>('.hand')[payload.owner];
  const target = handEndPos(hand, payload.owner);
  const dx = target.x - (rect.left + rect.width / 2);
  const dy = target.y - (rect.top + rect.height / 2);
  clone.style.transition = `transform ${MOVE_MS}ms cubic-bezier(0.2, 0.7, 0.3, 1), opacity ${MOVE_MS}ms ease`;
  requestAnimationFrame(() => {
    clone.style.transform = `translate(${dx}px, ${dy}px) scale(0.85)`;
    clone.style.opacity = '0.5';
  });
  window.setTimeout(() => clone.remove(), MOVE_MS + 80);
}

/** 基础行为特效：偏转——从初始位置丝滑平移到目标链路堆叠末尾 */
function playShift(node: HTMLElement, payload: FxCardPayload): void {
  const rect = node.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0 || payload.owner === undefined || payload.line === null) return;
  const clone = buildFxCard(node, payload, BASE_Z);
  if (!clone) return;
  const slot = document.querySelector<HTMLElement>(`.stack-slot[data-player="${payload.owner}"][data-line="${payload.line}"]`);
  const target = stackEndPos(slot, payload.owner);
  if (target) {
    const dx = target.x - (rect.left + rect.width / 2);
    const dy = target.y - (rect.top + rect.height / 2);
    clone.style.transition = `transform ${MOVE_MS}ms cubic-bezier(0.2, 0.7, 0.3, 1), opacity ${MOVE_MS}ms ease`;
    requestAnimationFrame(() => {
      clone.style.transform = `translate(${dx}px, ${dy}px) scale(0.92)`;
      clone.style.opacity = '0.6';
    });
    window.setTimeout(() => clone.remove(), MOVE_MS + 80);
  } else {
    window.setTimeout(() => clone.remove(), 50);
  }
}

/** 基础行为特效：牌堆顶打出——幽灵卡从牌库区丝滑飞入目标链路堆叠末尾
 *  （复用 playShift 平移逻辑；牌堆顶无 DOM 卡，起点用牌库区 rect（deckPos），buildFxCard 的 node 用牌库区元素） */
function playDeckPlay(payload: FxCardPayload): void {
  if (payload.owner === undefined || payload.line === null) return;
  const deck = document.querySelector<HTMLElement>(`.deck[data-player="${payload.owner}"]`);
  const from = deckPos(payload.owner);
  const slot = document.querySelector<HTMLElement>(`.stack-slot[data-player="${payload.owner}"][data-line="${payload.line}"]`);
  const target = stackEndPos(slot, payload.owner);
  if (!deck || !from || !target) return;
  const clone = buildFxCard(deck, payload, BASE_Z);
  if (!clone) return;
  const dx = target.x - (from.left + from.width / 2);
  const dy = target.y - (from.top + from.height / 2);
  clone.style.transition = `transform ${MOVE_MS}ms cubic-bezier(0.2, 0.7, 0.3, 1), opacity ${MOVE_MS}ms ease`;
  requestAnimationFrame(() => {
    clone.style.transform = `translate(${dx}px, ${dy}px) scale(0.92)`;
    clone.style.opacity = '0.6';
  });
  window.setTimeout(() => clone.remove(), MOVE_MS + 80);
}

/** 编译清牌：单张卡从原位置升起并渐隐 */
function playRiseFade(node: HTMLElement, delay: number): void {
  const rect = node.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return;
  const clone = node.cloneNode(true) as HTMLElement;
  clone.classList.remove('rot-cw', 'rot-ccw');
  clone.style.transform = 'none';
  clone.style.position = 'fixed';
  clone.style.left = `${rect.left}px`;
  clone.style.top = `${rect.top}px`;
  clone.style.width = `${rect.width}px`;
  clone.style.height = `${rect.height}px`;
  clone.style.margin = '0';
  clone.style.pointerEvents = 'none';
  clone.style.zIndex = '300';
  clone.style.transition = 'transform 0.35s ease, opacity 0.35s ease';
  clone.style.opacity = '1';
  document.body.appendChild(clone);
  window.setTimeout(() => {
    clone.style.transform = 'translateY(-64px) scale(1.05)';
    clone.style.opacity = '0';
  }, delay);
  window.setTimeout(() => clone.remove(), delay + 420);
}

/** 编译：双方该线卡牌从顶到底依次升起消散（两侧并行），随后编译方协议翻面 */
function playCompile(payload: { player: PlayerId; line: number; protocolDefId: string; ownUids: string[]; oppUids: string[] }): void {
  const uidNode = (uid: string) => document.querySelector<HTMLElement>(`[data-uid="${uid}"]`);
  const step = 300;
  const n = Math.max(payload.ownUids.length, payload.oppUids.length);
  let delay = 0;
  for (let i = 0; i < n; i++) {
    const own = payload.ownUids[i] ? uidNode(payload.ownUids[i]) : null;
    const opp = payload.oppUids[i] ? uidNode(payload.oppUids[i]) : null;
    if (own) playRiseFade(own, delay);
    if (opp) playRiseFade(opp, delay);
    delay += step;
  }
  // 清牌完成后：编译方协议翻面（loading → compiled 翻转动画，随后自然显示已编译特效）
  const proto = document.querySelector<HTMLElement>(
    `.protocol-cell[data-player="${payload.player}"][data-line="${payload.line}"] .protocol`,
  );
  if (proto) {
    window.setTimeout(() => playProtocolFlip(proto, payload.protocolDefId), delay + 80);
  }
}

/** 协议翻面（loading → compiled）：3D 翻转覆盖在已重渲染的协议上 */
function playProtocolFlip(node: HTMLElement, defId: string): void {
  const rect = node.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return;
  const wrap = document.createElement('div');
  wrap.style.cssText = `position:fixed;left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px;z-index:300;pointer-events:none;perspective:700px;`;
  const inner = document.createElement('div');
  inner.style.cssText = 'position:relative;width:100%;height:100%;transform-style:preserve-3d;transition:transform 0.45s ease;';
  const front = document.createElement('div');
  front.style.cssText = 'position:absolute;inset:0;backface-visibility:hidden;border-radius:8px;overflow:hidden;';
  front.appendChild(buildFaceImg(`/assets/protocols/${defId}/protocol-loading.png`));
  const back = document.createElement('div');
  back.style.cssText = 'position:absolute;inset:0;backface-visibility:hidden;border-radius:8px;overflow:hidden;';
  back.style.transform = 'rotateY(180deg)';
  back.appendChild(buildFaceImg(`/assets/protocols/${defId}/protocol-compiled.png`));
  inner.appendChild(front);
  inner.appendChild(back);
  wrap.appendChild(inner);
  document.body.appendChild(wrap);
  requestAnimationFrame(() => {
    inner.style.transform = 'rotateY(180deg)';
  });
  window.setTimeout(() => wrap.remove(), 520);
}

/**
 * 特效注册表（分层模型）：
 * - 基础行为特效：弃牌=对切、删去=破碎、翻面、回手、偏转——总是播放
 * - 额外协议特效：由触发卡协议（triggerProtocol）决定是否叠加（fire → 火焰焚烧；light → 白色柔光；darkness → 暗紫粒子）
 * - 卡面用【当前卡牌面】构建，不克隆原卡 DOM
 */
export function initEffects(): () => void {
  return gameBus.subscribe((e: GameEvent) => {
    const payload = e.payload as FxCardPayload | undefined;
    if (!payload?.uid || !payload.defId) return;
    const node = document.querySelector<HTMLElement>(`[data-uid="${payload.uid}"]`);
    switch (e.type) {
      case 'card:discarded':
        if (node) playCut(node, payload);
        break;
      case 'card:deleted':
        if (node) playShatter(node, payload);
        break;
      case 'card:flipped':
        if (node) playFlip(node, payload);
        break;
      case 'card:returned':
        if (node) playReturn(node, payload);
        break;
      case 'card:shifted':
        if (node) playShift(node, payload);
        break;
      case 'card:deck-played':
        playDeckPlay(payload);
        break;
      default:
        return;
    }
    // 额外协议特效（触发卡协议驱动，叠加上层）
    if ((e.type === 'card:discarded' || e.type === 'card:deleted') && node) {
      if (payload.triggerProtocol === 'fire') {
        playFireBurnExtra(node, payload);
      } else if (payload.triggerProtocol === 'light') {
        playLightExtra(node, payload);
      } else if (payload.triggerProtocol === 'darkness') {
        playDarknessExtra(node, payload);
      }
    }
  });
}

/** 编译清牌特效订阅（line:compiled 事件无 uid，单独注册） */
export function initCompileFx(): () => void {
  return gameBus.subscribe((e: GameEvent) => {
    if (e.type !== 'line:compiled') return;
    const p = e.payload as { player: PlayerId; line: number; protocolDefId: string; ownUids: string[]; oppUids: string[] };
    playCompile(p);
  });
}
