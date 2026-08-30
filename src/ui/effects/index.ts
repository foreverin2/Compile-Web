import { gameBus, type GameEvent } from '../../core/events/bus';
import { mountShatter } from '../fx/delete-shatter';
import { mountCut } from '../fx/discard-cut';

const FX_REMOVE_MS = 1200;
const BASE_Z = 300; // 基础行为特效层
const EXTRA_Z = 301; // 协议专属额外特效层（叠加在基础特效之上）
const MOVE_MS = 450; // 平移类特效时长（回手/偏转）
// Darkness 偏转烟桥（shift-bridge）节奏：桥渐显 → 卡飞过（MOVE_MS）→ 桥渐隐 → 清理
const BRIDGE_IN_MS = 350;
const BRIDGE_OUT_MS = 400;
const BRIDGE_Z = 290; // 烟桥层：飞行卡克隆（BASE_Z 300）之下、棋盘之上
const BRIDGE_END_Z = 291; // 端点标记：烟桥之上、飞行卡之下

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
 * 场上横置卡（rot-cw/rot-ccw）：克隆以【未旋转布局盒】尺寸（宽 = rect 高、高 = rect 宽）
 * 定位于 rect 中心后旋转 ±90°（transform-origin 中心）——视觉盒恰等于原卡 rect、
 * 卡面朝向与真实场上卡一致（getBoundingClientRect 返回的是旋转后的足迹盒；若直接按
 * rect 尺寸旋转会得到竖版视觉盒且中心偏移，方向对但占位错）。旋转以 --fx-rot 记录，
 * 平移类特效（回手/偏转/打出）组合 rotate(var(--fx-rot, 0deg)) 避免覆盖本旋转。
 * 手牌/牌库节点无 rot 类 → 保持原行为（不旋转）。尺寸 = 原卡 rect（视觉足迹）。
 */
function buildFxCard(node: HTMLElement, payload: FxCardPayload, zIndex: number): HTMLElement | null {
  const rect = node.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return null;
  const cw = node.classList.contains('rot-cw');
  const ccw = node.classList.contains('rot-ccw');
  const rotated = cw || ccw;
  const card = document.createElement('div');
  card.className = 'card';
  card.appendChild(buildFaceImg(cardFaceSrc(payload.defId, payload.faceUp)));
  card.style.position = 'fixed';
  card.style.margin = '0';
  card.style.padding = '0';
  card.style.border = 'none';
  card.style.background = 'transparent';
  card.style.pointerEvents = 'none';
  card.style.zIndex = String(zIndex);
  if (rotated) {
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    card.style.left = `${cx - rect.height / 2}px`;
    card.style.top = `${cy - rect.width / 2}px`;
    card.style.width = `${rect.height}px`;
    card.style.height = `${rect.width}px`;
    card.style.setProperty('--fx-rot', cw ? '90deg' : '-90deg');
    card.style.transform = 'rotate(var(--fx-rot, 0deg))';
  } else {
    card.style.left = `${rect.left}px`;
    card.style.top = `${rect.top}px`;
    card.style.width = `${rect.width}px`;
    card.style.height = `${rect.height}px`;
  }
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
  const cw = node.classList.contains('rot-cw');
  const ccw = node.classList.contains('rot-ccw');
  const horizontal = cw || ccw;
  const oldSrc = node.querySelector('img')?.src ?? cardFaceSrc(payload.defId, payload.faceUp);
  const newSrc = cardFaceSrc(payload.defId, payload.faceUp);
  const wrap = document.createElement('div');
  // 场上横置卡（rot-cw/rot-ccw）：与 buildFxCard 同一规则——wrap 以未旋转布局盒尺寸
  // （宽 = rect 高、高 = rect 宽）定位于 rect 中心后旋转 ±90°，翻面期间卡牌朝向与
  // 真实场上卡一致；已有的 rotateX/Y 面翻在 wrap 局部系内组合，最终仍保持场上朝向。
  if (horizontal) {
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    wrap.style.cssText =
      `position:fixed;left:${cx - rect.height / 2}px;top:${cy - rect.width / 2}px;` +
      `width:${rect.height}px;height:${rect.width}px;z-index:300;pointer-events:none;` +
      `perspective:600px;transform:rotate(${cw ? 90 : -90}deg);`;
  } else {
    wrap.style.cssText = `position:fixed;left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px;z-index:300;pointer-events:none;perspective:600px;`;
  }
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
    // 组合 --fx-rot：场上横置卡平移时保持 ±90° 朝向（translate 在最外层 → 屏幕系位移）
    clone.style.transform = `translate(${dx}px, ${dy}px) rotate(var(--fx-rot, 0deg)) scale(0.85)`;
    clone.style.opacity = '0.5';
  });
  window.setTimeout(() => clone.remove(), MOVE_MS + 80);
}

/** 幽灵卡平移落地：从初始 rect 丝滑平移到【调用方给定的】目标点（起飞时机与目标点均由调用方决定，
 *  避免起飞时重查 DOM——重渲染后目标堆叠已含落地卡，stackEndPos 会偏移） */
function flyCloneToStackEnd(clone: HTMLElement, rect: DOMRect, end: { x: number; y: number }): void {
  const dx = end.x - (rect.left + rect.width / 2);
  const dy = end.y - (rect.top + rect.height / 2);
  clone.style.transition = `transform ${MOVE_MS}ms cubic-bezier(0.2, 0.7, 0.3, 1), opacity ${MOVE_MS}ms ease`;
  requestAnimationFrame(() => {
    // 组合 --fx-rot：场上横置卡平移时保持 ±90° 朝向
    clone.style.transform = `translate(${dx}px, ${dy}px) rotate(var(--fx-rot, 0deg)) scale(0.92)`;
    clone.style.opacity = '0.6';
  });
  window.setTimeout(() => clone.remove(), MOVE_MS + 80);
}

/** 基础行为特效：偏转——从初始位置丝滑平移到目标链路堆叠末尾（同步调用：emit 时即计算目标点） */
function playShift(node: HTMLElement, payload: FxCardPayload): void {
  const rect = node.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0 || payload.owner === undefined || payload.line == null) return;
  const clone = buildFxCard(node, payload, BASE_Z);
  if (!clone) return;
  const slot = document.querySelector<HTMLElement>(`.stack-slot[data-player="${payload.owner}"][data-line="${payload.line}"]`);
  const end = stackEndPos(slot, payload.owner);
  if (!end) {
    window.setTimeout(() => clone.remove(), 50);
    return;
  }
  flyCloneToStackEnd(clone, rect, end);
}

/**
 * Darkness 偏转专属特效：烟桥路线（起点→终点）。
 * 粗黑烟桥 + 起/终点光点先渐显（~350ms），随后卡飞过（MOVE_MS），桥再渐隐（~400ms）后清理。
 * 关键点：
 * - 起点 rect 与终点 end 都在事件发出时（重渲染前）一次性计算，桥/终点标记/飞行共用同一个 end
 *   ——飞行恰好落在终点光点上（起飞时重查 DOM 会因目标堆叠已含落地卡而偏移 ~65px）；
 * - 飞行克隆也在事件发出时构建（避免延迟调用 playShift 读到已重建的节点 rect 归零），
 *   桥渐显期间克隆 opacity 0 不可见（源位置不出现"重复卡"），起飞时随飞行过渡淡入至 0.6；
 * - rect/目标缺失时退回普通 playShift（无桥）；克隆在 end 校验通过后才构建，无泄漏。
 */
function playDarknessShiftBridge(node: HTMLElement, payload: FxCardPayload): void {
  const rect = node.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0 || payload.owner === undefined || payload.line == null) {
    playShift(node, payload); // rect 缺失 → 退回普通偏转（playShift 内部自兜底）
    return;
  }
  // 捕获局部变量：闭包（定时器）内不做属性收窄，避免 TS 丢失 owner/line 的窄化
  const owner: PlayerId = payload.owner;
  const line: number = payload.line;
  const slot = document.querySelector<HTMLElement>(`.stack-slot[data-player="${owner}"][data-line="${line}"]`);
  const end = stackEndPos(slot, owner);
  if (!end) {
    playShift(node, payload); // 目标缺失 → 退回普通偏转（克隆尚未构建，无泄漏）
    return;
  }
  const clone = buildFxCard(node, payload, BASE_Z);
  if (!clone) {
    playShift(node, payload);
    return;
  }
  // 桥渐显期间克隆不可见（避免源位置出现"重复卡"）；起飞时 flyCloneToStackEnd 的
  // opacity 过渡会把它从 0 淡入到 0.6（随飞行渐显）
  clone.style.opacity = '0';
  const start = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const dist = Math.hypot(dx, dy);
  const angle = (Math.atan2(dy, dx) * 180) / Math.PI;

  // 烟桥：fixed 定位于起点、按距离定宽、旋转到终点角度（transform-origin:left center 在 CSS）；
  // z-index 与过渡时长由 JS 常量驱动（BRIDGE_Z / BRIDGE_IN_MS / BRIDGE_OUT_MS，单一来源）
  const bridge = document.createElement('div');
  bridge.className = 'shift-bridge';
  bridge.style.left = `${start.x}px`;
  bridge.style.top = `${start.y}px`;
  bridge.style.width = `${dist}px`;
  bridge.style.transform = `rotate(${angle}deg)`;
  bridge.style.zIndex = String(BRIDGE_Z);
  bridge.style.setProperty('--bridge-in-ms', `${BRIDGE_IN_MS}ms`);
  bridge.style.setProperty('--bridge-out-ms', `${BRIDGE_OUT_MS}ms`);
  // 起/终点光点（标记起始与终点位置）
  const mkEnd = (x: number, y: number): HTMLElement => {
    const m = document.createElement('div');
    m.className = 'bridge-end';
    m.style.left = `${x}px`;
    m.style.top = `${y}px`;
    m.style.zIndex = String(BRIDGE_END_Z);
    m.style.setProperty('--bridge-in-ms', `${BRIDGE_IN_MS}ms`);
    m.style.setProperty('--bridge-out-ms', `${BRIDGE_OUT_MS}ms`);
    return m;
  };
  const startMarker = mkEnd(start.x, start.y);
  const endMarker = mkEnd(end.x, end.y);
  document.body.appendChild(bridge);
  document.body.appendChild(startMarker);
  document.body.appendChild(endMarker);

  const cleanup = (): void => {
    bridge.remove();
    startMarker.remove();
    endMarker.remove();
  };

  // ① 桥 + 端点渐显（CSS transition var(--bridge-in-ms) → opacity 0.85）
  requestAnimationFrame(() => {
    bridge.classList.add('shift-bridge-in');
    startMarker.classList.add('bridge-end-in');
    endMarker.classList.add('bridge-end-in');
  });
  // ② 桥显影完成后卡开始飞行——目标点复用 emit 时的 end，与桥/终点标记完全一致
  window.setTimeout(() => {
    flyCloneToStackEnd(clone, rect, end);
    // ③ 飞行结束后桥渐隐
    window.setTimeout(() => {
      bridge.classList.remove('shift-bridge-in');
      bridge.classList.add('shift-bridge-out');
      startMarker.classList.remove('bridge-end-in');
      startMarker.classList.add('bridge-end-out');
      endMarker.classList.remove('bridge-end-in');
      endMarker.classList.add('bridge-end-out');
      // ④ 渐隐完成后清理（无论中间发生什么，桥/端点必被移除）
      window.setTimeout(cleanup, BRIDGE_OUT_MS + 40);
    }, MOVE_MS);
  }, BRIDGE_IN_MS);
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
    // 组合 --fx-rot（牌库/手牌无 rot 类 → 恒 0deg，与旧行为一致）
    clone.style.transform = `translate(${dx}px, ${dy}px) rotate(var(--fx-rot, 0deg)) scale(0.92)`;
    clone.style.opacity = '0.6';
  });
  window.setTimeout(() => clone.remove(), MOVE_MS + 80);
}

/** 基础行为特效：手牌打出（playFromHand）——幽灵卡从手牌中该卡的 rect 丝滑飞入目标
 *  链路堆叠末尾（与 playDeckPlay 同平移逻辑，仅起点不同：手牌卡仍在 DOM 中，直接以其
 *  rect 为起点；faceUp 已按打出朝向（正/背）写入 payload，卡面随之正确）。 */
function playHandPlay(payload: FxCardPayload): void {
  if (payload.owner === undefined || payload.line === null) return;
  const cardNode = document.querySelector<HTMLElement>(`.hand .card[data-uid="${payload.uid}"]`);
  if (!cardNode) return;
  const from = cardNode.getBoundingClientRect();
  if (from.width === 0 || from.height === 0) return;
  const slot = document.querySelector<HTMLElement>(`.stack-slot[data-player="${payload.owner}"][data-line="${payload.line}"]`);
  const target = stackEndPos(slot, payload.owner);
  if (!target) return;
  const clone = buildFxCard(cardNode, payload, BASE_Z);
  if (!clone) return;
  const dx = target.x - (from.left + from.width / 2);
  const dy = target.y - (from.top + from.height / 2);
  clone.style.transition = `transform ${MOVE_MS}ms cubic-bezier(0.2, 0.7, 0.3, 1), opacity ${MOVE_MS}ms ease`;
  requestAnimationFrame(() => {
    // 组合 --fx-rot（牌库/手牌无 rot 类 → 恒 0deg，与旧行为一致）
    clone.style.transform = `translate(${dx}px, ${dy}px) rotate(var(--fx-rot, 0deg)) scale(0.92)`;
    clone.style.opacity = '0.6';
  });
  window.setTimeout(() => clone.remove(), MOVE_MS + 80);
}

/* ===== 揭示飞行（reveal fly）：幽灵卡从被揭示方手牌末尾依次飞入 shownTo 手牌末尾 =====
 * 主线程（main.ts）在行动结算后串行调用（每张 ~400ms，上一张落地即起飞下一张）：
 * - 起点 = 被揭示卡持有者（source）手牌末尾（handEndPos 同款扇形步进数学）；
 * - 终点 = shownTo 手牌末尾，逐张按 index 沿目标手牌生长方向 +102px 延伸
 *   （与重渲染后 .reveal-ghost 的扇形间距一致：卡宽 130 − 重叠 28）；
 * - 幽灵显示被揭示卡正面（130×178.8）；light 协议触发（triggerProtocol==='light'）时
 *   卡后带天使翅膀（.reveal-wings），飞行中扑扇，落地后渐隐；
 * - 落地后幽灵渐隐，由重渲染后的真实幽灵卡（renderHand .reveal-ghost）承接显示。 */
const REVEAL_FLY_MS = 400; // 单张飞行时长（下一张在此刻起飞）
const REVEAL_WING_FADE_MS = 400; // 翅膀落地渐隐
const REVEAL_LAND_FADE_MS = 220; // 幽灵落地渐隐
const REVEAL_W = 130;
const REVEAL_H = 178.8;
const REVEAL_SPACING = 102; // 与 .hand 负 margin 扇形步进一致（130 − 28）

export function playRevealFly(
  opts: { source: PlayerId; shownTo: PlayerId; defId: string; triggerProtocol: string; index?: number },
  done: () => void,
): void {
  const hands = document.querySelectorAll<HTMLElement>('.hand');
  const src = hands[opts.source];
  const dst = hands[opts.shownTo];
  if (!src || !dst) {
    done();
    return;
  }
  const from = handEndPos(src, opts.source); // 起点：被揭示方手牌末尾（都以手牌末尾为起点）
  const to = handEndPos(dst, opts.shownTo);
  const i = opts.index ?? 0;
  // 目标手牌生长方向：P1 向右、P2 向左（row-reverse），逐张延伸
  const endX = to.x + (opts.shownTo === 0 ? REVEAL_SPACING * i : -REVEAL_SPACING * i);
  const light = opts.triggerProtocol === 'light';
  const ghost = document.createElement('div');
  ghost.className = 'reveal-fly-ghost';
  ghost.style.left = `${from.x - REVEAL_W / 2}px`;
  ghost.style.top = `${from.y - REVEAL_H / 2}px`;
  // 翅膀在卡面之后（buildFaceImg 之后 append 会盖住翅膀 → 先加翅膀再加卡面）
  if (light) {
    ghost.appendChild(Object.assign(document.createElement('div'), { className: 'reveal-wings' }));
  }
  ghost.appendChild(buildFaceImg(cardFaceSrc(opts.defId, true)));
  document.body.appendChild(ghost);
  const dx = endX - from.x;
  const dy = to.y - from.y;
  // 起飞：淡入 + 飞向目标手牌末尾
  ghost.style.transition = `transform ${REVEAL_FLY_MS}ms cubic-bezier(0.2, 0.7, 0.3, 1), opacity 120ms ease`;
  requestAnimationFrame(() => {
    ghost.style.transform = `translate(${dx}px, ${dy}px)`;
    ghost.style.opacity = '0.95';
  });
  // 落地：翅膀渐隐 + 幽灵渐隐；done() 此刻触发（下一张立即起飞——"上一张落地即起飞下一张"）
  window.setTimeout(() => {
    if (light) {
      const wings = ghost.querySelector('.reveal-wings');
      if (wings) wings.classList.add('fade');
    }
    ghost.style.transition = `opacity ${REVEAL_LAND_FADE_MS}ms ease`;
    ghost.style.opacity = '0';
    window.setTimeout(() => ghost.remove(), Math.max(REVEAL_LAND_FADE_MS, REVEAL_WING_FADE_MS) + 40);
    done();
  }, REVEAL_FLY_MS);
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
        // darkness-0/1/4 的偏转（触发卡协议 darkness）：播烟桥路线（起点→终点）；
        // 其余偏转源（light-2/light-3 带 'light'、系统效果带 'system'）走普通幽灵飞行
        if (node) {
          if (payload.triggerProtocol === 'darkness') playDarknessShiftBridge(node, payload);
          else playShift(node, payload);
        }
        break;
      case 'card:deck-played':
        playDeckPlay(payload);
        break;
      case 'card:hand-played':
        // playFromHand：从手牌中该卡的 rect 起飞飞入目标线堆叠末尾（区别于牌堆顶打出）
        playHandPlay(payload);
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
