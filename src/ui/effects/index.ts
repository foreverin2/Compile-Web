import { gameBus, type GameEvent } from '../../core/events/bus';
import { mountShatter } from '../fx/delete-shatter';
import { mountCut } from '../fx/discard-cut';

const FX_REMOVE_MS = 1200;
const BASE_Z = 300; // 基础行为特效层
const EXTRA_Z = 301; // 协议专属额外特效层（叠加在基础特效之上）
const MOVE_MS = 450; // 平移类特效时长（偏转/打出/重排等）
const RETURN_MOVE_MS = 700; // 回手专属飞行时长（450 → 700ms：回手更从容、更刻意）
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

/* ===== Life 翻转专属特效：绿色藤蔓缠绕 + 绿光（life-1/life-2 及未来生命翻转） =====
 * 触发：card:flipped 且 payload.triggerProtocol === 'life'。翻面本身复用 playFlip
 * （非 life 翻转保持原样），本函数只在它周围叠加藤蔓特效：
 * ① 翻转前：12 根粗长绿色藤蔓沿卡框四边（每边 3 根）缓慢出现并缠绕上来——SVG S 曲线、
 *    从边缘向卡内生长（transform-origin 0 0 = 锚点），长度 85px（52 → 85：离卡牌中心
 *    更远、缠绕覆盖更广）+ 卡框绿光（呼吸发光）；
 * ② 展开动画 1.9s（0.9s + 1s）后（~1.65s）卡面开始翻转，藤蔓同时逐渐收缩退去；
 * ③ 卡框绿光持续 ~2 秒后淡出。
 * 全部 pointer-events:none、JS 定时清理（无泄漏）：12 根藤蔓统一挂在 .life-flip-fx
 * 容器（body 级 fixed、无 transform/z-index → 不改变子元素 fixed 视口坐标、不建
 * stacking context），收缩完成后整体移除；容器类也被 render.ts resetUiState 批量
 * 清扫（应用内重置路径兜底）。绿光单独挂 body（需持续 ~3.6 秒，长于藤蔓容器），
 * 自带移除定时器 + resetUiState 兜底。 */
const LIFE_AFTER_MS = 3600; // 翻转后卡框绿光持续时间（含拉长的展开/消退：翻转 ~1.65s + 持续 ~2s）
const LIFE_VINE_LEN = 85; // 藤蔓长度（52 → 85px：离卡牌中心更远、缠绕覆盖更广）
const LIFE_VINE_SHRINK_MS = 1650; // 展开延长 1 秒后翻转 / 开始收缩藤蔓的时机（650 → 1650ms）
const LIFE_VINE_SHRINK_DUR_MS = 1550; // 藤蔓消退动画时长（0.55s → 1.55s，消退 +1s）

/** 构建一根藤蔓：定位 div（旋转朝向卡内）+ SVG S 曲线（生长/收缩动画作用于其上） */
function buildLifeVine(rot: number): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'life-flip-vine';
  wrap.style.transform = `rotate(${rot}deg)`;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', '30');
  svg.setAttribute('height', String(LIFE_VINE_LEN));
  svg.setAttribute('viewBox', `0 0 30 ${LIFE_VINE_LEN}`);
  svg.setAttribute('class', 'life-flip-vine-curve');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', `M7,2 C16,${LIFE_VINE_LEN * 0.3} 24,${LIFE_VINE_LEN * 0.62} 12,${LIFE_VINE_LEN - 3}`);
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', '#3ddc84');
  path.setAttribute('stroke-width', '11'); // 3.2 → 11（调粗很多，约 3.4×）
  path.setAttribute('stroke-linecap', 'round');
  svg.appendChild(path);
  wrap.appendChild(svg);
  return wrap;
}

function playLifeFlip(node: HTMLElement, payload: FxCardPayload): void {
  const rect = node.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) {
    playFlip(node, payload); // rect 缺失 → 退回基础翻面
    return;
  }
  const L = rect.left;
  const T = rect.top;
  const W = rect.width;
  const H = rect.height;
  // 藤蔓锚点：每边 3 根（15%/50%/85% 处，共 12 根），transform-origin 0 0 = 锚点
  // （卡框边缘点），旋转使藤蔓垂入卡内：上边 0°（向下）、右边 90°（向左）、
  // 下边 180°（向上）、左边 −90°（向右）——局部 +y（藤蔓长度方向）经旋转映射为朝卡内的方向。
  // （rot 90：局部 (0,85) → 屏幕 (−85,0) = 锚点左侧 = 入卡；rot −90：→ (85,0) = 右侧 = 入卡）
  const anchors: { x: number; y: number; rot: number }[] = [
    { x: L + W * 0.15, y: T, rot: 0 },
    { x: L + W * 0.5, y: T, rot: 0 },
    { x: L + W * 0.85, y: T, rot: 0 },
    { x: L + W, y: T + H * 0.15, rot: 90 },
    { x: L + W, y: T + H * 0.5, rot: 90 },
    { x: L + W, y: T + H * 0.85, rot: 90 },
    { x: L + W * 0.15, y: T + H, rot: 180 },
    { x: L + W * 0.5, y: T + H, rot: 180 },
    { x: L + W * 0.85, y: T + H, rot: 180 },
    { x: L, y: T + H * 0.15, rot: -90 },
    { x: L, y: T + H * 0.5, rot: -90 },
    { x: L, y: T + H * 0.85, rot: -90 },
  ];
  // 藤蔓容器（body 级 fixed；无 transform/z-index → 子元素 fixed 坐标仍按视口、
  // 不建 stacking context；pointer-events:none 透传点击）。收缩完成后整体移除。
  const fxWrap = document.createElement('div');
  fxWrap.className = 'life-flip-fx';
  fxWrap.style.cssText = 'position:fixed;inset:0;pointer-events:none;';
  document.body.appendChild(fxWrap);
  for (let i = 0; i < anchors.length; i++) {
    const a = anchors[i];
    const vine = buildLifeVine(a.rot);
    vine.style.left = `${a.x}px`;
    vine.style.top = `${a.y}px`;
    vine.style.zIndex = String(EXTRA_Z);
    vine.style.animationDelay = `${i * 0.07}s`; // 逐根错开缓慢出现（缠绕感）
    fxWrap.appendChild(vine);
  }
  // 卡框绿光（呼吸发光 → 持续 ~2 秒 → 淡出；单独挂 body，长于藤蔓容器生命周期）
  const glow = document.createElement('div');
  glow.className = 'life-flip-glow';
  glow.style.left = `${L}px`;
  glow.style.top = `${T}px`;
  glow.style.width = `${W}px`;
  glow.style.height = `${H}px`;
  glow.style.zIndex = String(EXTRA_Z);
  document.body.appendChild(glow);
  // ② 展开动画延长 1 秒后：卡面开始翻转 + 藤蔓开始收缩退去（同一时刻触发）
  window.setTimeout(() => {
    for (const vine of fxWrap.querySelectorAll<HTMLElement>('.life-flip-vine')) {
      vine.classList.add('shrinking');
    }
  }, LIFE_VINE_SHRINK_MS);
  // 收缩（1.55s）完成后整体移除藤蔓容器（防 DOM 泄漏；重置路径由 resetUiState 兜底）
  window.setTimeout(() => fxWrap.remove(), LIFE_VINE_SHRINK_MS + LIFE_VINE_SHRINK_DUR_MS + 100);
  // ③ 卡框绿光持续（覆盖展开 + 翻转 + 消退全程）后淡出（CSS 动画自带尾部淡出，JS 只负责移除）
  window.setTimeout(() => glow.remove(), LIFE_AFTER_MS + 320);
  // 基础翻面照常（本函数只叠加藤蔓，不替换翻面）——但延迟到藤蔓充分展开之后
  // （展开动画 0.9s → 1.9s，翻面在 ~1.65s 才开始，"先展开、后翻转"）
  window.setTimeout(() => playFlip(node, payload), LIFE_VINE_SHRINK_MS);
}

/** 基础行为特效：回手——从场上丝滑平移到持有者手牌末尾（专属 RETURN_MOVE_MS，更从容） */
function playReturn(node: HTMLElement, payload: FxCardPayload): void {
  const rect = node.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0 || payload.owner === undefined) return;
  const clone = buildFxCard(node, payload, BASE_Z);
  if (!clone) return;
  const hand = document.querySelectorAll<HTMLElement>('.hand')[payload.owner];
  const target = handEndPos(hand, payload.owner);
  const dx = target.x - (rect.left + rect.width / 2);
  const dy = target.y - (rect.top + rect.height / 2);
  clone.style.transition = `transform ${RETURN_MOVE_MS}ms cubic-bezier(0.2, 0.7, 0.3, 1), opacity ${RETURN_MOVE_MS}ms ease`;
  requestAnimationFrame(() => {
    // 组合 --fx-rot：场上横置卡平移时保持 ±90° 朝向（translate 在最外层 → 屏幕系位移）
    clone.style.transform = `translate(${dx}px, ${dy}px) rotate(var(--fx-rot, 0deg)) scale(0.85)`;
    clone.style.opacity = '0.5';
  });
  window.setTimeout(() => clone.remove(), RETURN_MOVE_MS + 80);
}

/* ===== Water 回手专属特效：蓝色水波环 + 光晕 + 游动轨迹环 + 水拖尾（water-3/water-4 及未来水回手） =====
 * 触发：card:returned 且 payload.triggerProtocol === 'water'。飞行本身复用 playReturn
 * （非水回手保持原样），本函数只在它周围叠加水特效：
 * ① 回手前：卡框周围一圈扩散的大号蓝色水波环 + 蓝色光晕 + 边框发光（body 级 fixed）；
 * ② 飞行中：路径 25%/50%/75% 处各出现一个小号扩散水环 + 一条随行水拖尾
 *    （.water-return-trail：从起点延伸到卡当前位置的渐变光带，尾端渐隐——鱼在水面游动的尾迹）；
 * ③ 回手后：落点（手牌末尾）卡框特效持续 3 秒后淡出。
 * 全部 pointer-events:none、JS 定时清理（无泄漏）。 */
const WATER_RING_MS = 1000; // 单个水环扩散时长（700 → 1000ms，随加长飞行成比例延长）
const WATER_AFTER_MS = 3000; // 回手后落点框特效持续时间（2s → 3s）
const TRAIL_Z = BASE_Z - 1; // 水拖尾：飞行卡克隆（BASE_Z）之下——鱼尾迹在卡后

/** body 级水波环：fixed 定位于 (x,y) 中心、尺寸 size 的圆环，扩散 + 淡出后自清理 */
function spawnWaterRing(x: number, y: number, size: number, cls: string): void {
  const ring = document.createElement('div');
  ring.className = cls;
  ring.style.left = `${x - size / 2}px`;
  ring.style.top = `${y - size / 2}px`;
  ring.style.width = `${size}px`;
  ring.style.height = `${size}px`;
  ring.style.zIndex = String(EXTRA_Z);
  document.body.appendChild(ring);
  window.setTimeout(() => ring.remove(), WATER_RING_MS + 120);
}

/** cubic-bezier(0.2, 0.7, 0.3, 1)（与回手飞行同缓动）数值求值：进度 p ∈ [0,1] → 缓动值。
 *  二分求 t 使 bezierX(t)=p，再代入 bezierY——拖尾头部与卡实时位置对齐。 */
function returnFlightEase(p: number): number {
  const x1 = 0.2, y1 = 0.7, x2 = 0.3, y2 = 1;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 12; i++) {
    const t = (lo + hi) / 2;
    const mt = 1 - t;
    const x = 3 * mt * mt * t * x1 + 3 * mt * t * t * x2 + t * t * t;
    if (x < p) lo = t;
    else hi = t;
  }
  const t = (lo + hi) / 2;
  const mt = 1 - t;
  return 3 * mt * mt * t * y1 + 3 * mt * t * t * y2 + t * t * t;
}

/** 水拖尾：飞行期间沿路径跟随卡的渐变光带（rAF 逐帧更新，随卡推进变长，头亮尾淡）。
 *  起点锚定路径起点（transform-origin left center），宽度 = 已行进距离；渐变右端（亮头）
 *  始终位于卡当前位置 → 读作卡身后拉出的鱼尾迹。飞行结束自清理。 */
function spawnWaterTrail(start: { x: number; y: number }, end: { x: number; y: number }, durMs: number): void {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const dist = Math.hypot(dx, dy);
  if (dist < 1) return;
  const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
  const trail = document.createElement('div');
  trail.className = 'water-return-trail';
  trail.style.left = `${start.x}px`;
  trail.style.top = `${start.y - 8}px`; // 高度 16px → 中心对准路径
  trail.style.transform = `rotate(${angle}deg)`;
  trail.style.zIndex = String(TRAIL_Z);
  document.body.appendChild(trail);
  const startAt = performance.now();
  const step = (now: number): void => {
    const p = Math.min(1, (now - startAt) / durMs);
    const e = returnFlightEase(p);
    trail.style.width = `${e * dist}px`;
    // 头亮尾淡：整体随飞行渐弱（起飞时迅速显现、落地前溶解）
    trail.style.opacity = String(Math.min(1, e * 8) * (0.9 - 0.55 * e));
    if (p < 1) requestAnimationFrame(step);
    else trail.remove();
  };
  requestAnimationFrame(step);
}

function playWaterReturn(node: HTMLElement, payload: FxCardPayload): void {
  const rect = node.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0 || payload.owner === undefined) {
    playReturn(node, payload); // rect 缺失 → 退回基础回手（playReturn 内部自兜底）
    return;
  }
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const hand = document.querySelectorAll<HTMLElement>('.hand')[payload.owner];
  const target = handEndPos(hand, payload.owner);
  const dx = target.x - cx;
  const dy = target.y - cy;
  // ① 回手前：大号扩散水环（放大 1.67×）+ 蓝色光晕框（卡框周围，与飞行同时开始）
  spawnWaterRing(cx, cy, Math.max(rect.width, rect.height) * 4.0, 'water-return-ring big');
  const glow = document.createElement('div');
  glow.className = 'water-return-glow';
  glow.style.left = `${rect.left}px`;
  glow.style.top = `${rect.top}px`;
  glow.style.width = `${rect.width}px`;
  glow.style.height = `${rect.height}px`;
  glow.style.zIndex = String(EXTRA_Z);
  document.body.appendChild(glow);
  window.setTimeout(() => glow.remove(), WATER_RING_MS + 120);
  // ② 飞行中：路径 25%/50%/75% 处的小号轨迹环（与卡同步出现 → 鱼游轨迹）+ 水拖尾。
  // 飞行缓动 cubic-bezier(0.2,0.7,0.3,1) 是快启动——线性时间 25/50/75% 时卡已在
  // ~75/90/98% 处；用逆缓动解把「位置比例」映射回「时刻比例」（t≈0.128/0.282/0.488，
  // 即 B_y(t)=0.25/0.5/0.75），环才真正与卡经过同步。
  const WATER_TRAIL_FRACS = [0.25, 0.5, 0.75] as const; // 沿路径的位置比例
  const WATER_TRAIL_AT = [0.128, 0.282, 0.488] as const; // 逆缓动后的时刻比例（×RETURN_MOVE_MS）
  for (let i = 0; i < WATER_TRAIL_FRACS.length; i++) {
    const frac = WATER_TRAIL_FRACS[i];
    const at = WATER_TRAIL_AT[i];
    window.setTimeout(() => {
      spawnWaterRing(cx + dx * frac, cy + dy * frac, 48, 'water-return-ring trail');
    }, RETURN_MOVE_MS * at);
  }
  spawnWaterTrail({ x: cx, y: cy }, { x: target.x, y: target.y }, RETURN_MOVE_MS);
  // ③ 回手后（飞行落地）：落点框特效持续 3 秒后淡出（落点 = 手牌末尾新卡中心）
  window.setTimeout(() => {
    const settle = document.createElement('div');
    settle.className = 'water-return-settle';
    settle.style.left = `${target.x - 65}px`;
    settle.style.top = `${target.y - 89.4}px`;
    settle.style.width = '130px';
    settle.style.height = '178.8px';
    settle.style.zIndex = String(EXTRA_Z);
    document.body.appendChild(settle);
    window.setTimeout(() => settle.remove(), WATER_AFTER_MS + 300);
  }, RETURN_MOVE_MS);
  // 基础回手飞行照常（本函数只叠加水特效，不替换飞行）
  playReturn(node, payload);
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
 *  （复用 playShift 平移逻辑；牌堆顶无 DOM 卡，起点用牌库区 rect（deckPos），buildFxCard 的 node 用牌库区元素）
 *  可靠性（多线连打，life-0/water-1 及未来任何反面牌堆顶打出）：
 *  - 同批 card:deck-played 事件同步创建多个幽灵 → 按 90ms 错开起飞（多卡不在牌库位
 *    完全重叠互相遮挡，逐张可见、逐线飞入）；
 *  - 起飞前先写初始位并强制回流提交样式（void offsetHeight）——浏览器若延迟提交初始
 *    样式，transition 会直接跳到终点（飞行不可见）；回流保证 transition 必从牌库位动画；
 *  - 幽灵带 .deck-play-ghost（投影 + 青辉），小尺寸（92×132）卡背在暗背景上清晰可见。 */
const DECK_PLAY_STAGGER_MS = 90; // 同批多张牌堆顶打出的起飞错开间隔
let deckPlayBatchCount = 0; // 同一批（~100ms 窗口内）已创建的幽灵数
let deckPlayBatchStamp = 0;

/** 同一批 deck-play 事件内的序号：~100ms 窗口内连续创建视为同一批（逐张错开起飞），
 *  之后重置（新一批从头错开）。 */
function nextDeckPlayIndex(): number {
  const now = Date.now();
  if (now - deckPlayBatchStamp > 100) deckPlayBatchCount = 0;
  deckPlayBatchStamp = now;
  return deckPlayBatchCount++;
}

function playDeckPlay(payload: FxCardPayload): void {
  if (payload.owner === undefined || payload.line === null) return;
  const deck = document.querySelector<HTMLElement>(`.deck[data-player="${payload.owner}"]`);
  const from = deckPos(payload.owner);
  const slot = document.querySelector<HTMLElement>(`.stack-slot[data-player="${payload.owner}"][data-line="${payload.line}"]`);
  const target = stackEndPos(slot, payload.owner);
  if (!deck || !from || !target) return;
  const clone = buildFxCard(deck, payload, BASE_Z);
  if (!clone) return;
  clone.classList.add('deck-play-ghost');
  const dx = target.x - (from.left + from.width / 2);
  const dy = target.y - (from.top + from.height / 2);
  const delay = nextDeckPlayIndex() * DECK_PLAY_STAGGER_MS;
  window.setTimeout(() => {
    // 先写初始位（translate(0) + 原朝向/尺寸）并强制回流提交 → 起飞 transition 必动画
    clone.style.transition = `transform ${MOVE_MS}ms cubic-bezier(0.2, 0.7, 0.3, 1), opacity ${MOVE_MS}ms ease`;
    clone.style.transform = `translate(0, 0) rotate(var(--fx-rot, 0deg)) scale(0.92)`;
    void clone.offsetHeight; // 强制样式提交（reflow）
    requestAnimationFrame(() => {
      clone.style.transform = `translate(${dx}px, ${dy}px) rotate(var(--fx-rot, 0deg)) scale(0.92)`;
      clone.style.opacity = '0.6';
    });
  }, delay);
  window.setTimeout(() => clone.remove(), delay + MOVE_MS + 120);
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
        // life 协议触发的翻转（life-1/life-2 及未来生命翻转）：绿色藤蔓缠绕 + 绿光；
        // 其余翻转源（water-0 带 'water'、系统效果带 'system'）走基础翻面
        if (node) {
          if (payload.triggerProtocol === 'life') playLifeFlip(node, payload);
          else playFlip(node, payload);
        }
        break;
      case 'card:returned':
        // water 协议触发的回手（water-3/water-4 及未来水回手）：蓝色水波环 + 光晕 +
        // 游动轨迹环（叠加在基础回手飞行之上）；其余回手源走基础飞行
        if (node) {
          if (payload.triggerProtocol === 'water') playWaterReturn(node, payload);
          else playReturn(node, payload);
        }
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
    // 额外协议特效（触发卡协议驱动，叠加上层；仅弃牌/删去走此块）：
    // fire → 火焰焚烧；light → 白色柔光；darkness → 暗紫粒子。
    // water（回手水波环）/life（翻转藤蔓）在各自分支内叠加（card:returned /
    // card:flipped），不属于本块——其余协议触发时落到此处 = 无额外特效。
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

/* ===== 重排协议基础特效（protocols:rearranged 事件：water-2 的 rearrangeProtocols op） =====
 * 引擎在结算期间同步发出该事件（DOM 仍是交换前布局）→ 两张协议卡【同时】平移互换位置：
 * - 取该玩家 a/b 两个协议格的 .protocol-img（真实协议卡足迹 ~200×280；协议格含 data-player
 *   /data-line，见 render.ts renderProtocolCell）的 rect 与资源 src（protocol-loading/compiled.png）；
 * - 构建两张 body 级幽灵卡（position:fixed、pointer-events:none、BASE_Z 基础特效层），
 *   P2 的协议卡转 180°（.protocol-img.rot-180 同款朝向：P1 0° / P2 180°），尺寸 = 真实协议卡；
 * - 同时飞行（MOVE_MS，playShift 同款缓动）：A 从 a 中心 → b 中心、B 反向；
 * - 重渲染随后重建棋盘（协议已互换），幽灵卡落点 = 交换后协议卡的渲染位 → 无缝衔接。 */

/** protocols:rearranged 事件载荷（resolve.ts rearrangeProtocols op 发出） */
interface RearrangeProtocolsPayload {
  player: PlayerId;
  a: number;
  b: number;
}

/** body 级协议幽灵卡：fixed 定位于协议卡 rect，尺寸 = 真实协议卡（~200×280），卡面复用
 *  协议资源 src；P2 幽灵初始转 180°（与场上 .protocol-img.rot-180 朝向一致）。 */
function buildProtocolGhost(src: string, rect: DOMRect, rot180: boolean): HTMLElement {
  const ghost = document.createElement('div');
  ghost.style.cssText =
    `position:fixed;left:${rect.left}px;top:${rect.top}px;` +
    `width:${rect.width}px;height:${rect.height}px;` +
    `z-index:${BASE_Z};pointer-events:none;`;
  if (rot180) ghost.style.transform = 'rotate(180deg)'; // 初始朝向先落位（此后仅位移在动）
  const img = document.createElement('img');
  img.src = src;
  img.style.cssText =
    'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block;border-radius:4px;';
  ghost.appendChild(img);
  document.body.appendChild(ghost);
  return ghost;
}

/** 幽灵协议卡平移飞行：从自身 rect 中心平移到目标 rect 中心（MOVE_MS + 80 清理）。
 *  P2 幽灵初始已转 180°，终点 transform 组合 rotate(180deg) → 过渡期间旋转不变、只动位移。 */
function flyProtocolGhost(ghost: HTMLElement, from: DOMRect, to: DOMRect, rot180: boolean): void {
  const dx = to.left + to.width / 2 - (from.left + from.width / 2);
  const dy = to.top + to.height / 2 - (from.top + from.height / 2);
  ghost.style.transition = `transform ${MOVE_MS}ms cubic-bezier(0.2, 0.7, 0.3, 1)`;
  requestAnimationFrame(() => {
    ghost.style.transform = `translate(${dx}px, ${dy}px)${rot180 ? ' rotate(180deg)' : ''}`;
  });
  window.setTimeout(() => ghost.remove(), MOVE_MS + 80);
}

/** 重排协议：两张协议卡同时平移互换位置 */
function playRearrangeProtocolsFx(payload: RearrangeProtocolsPayload): void {
  if (payload.a === payload.b) return;
  const cellSel = (line: number): string =>
    `.protocol-cell[data-player="${payload.player}"][data-line="${line}"]`;
  const cellA = document.querySelector<HTMLElement>(cellSel(payload.a));
  const cellB = document.querySelector<HTMLElement>(cellSel(payload.b));
  if (!cellA || !cellB) return;
  const imgA = cellA.querySelector<HTMLImageElement>('.protocol-img');
  const imgB = cellB.querySelector<HTMLImageElement>('.protocol-img');
  if (!imgA || !imgB) return;
  const rectA = imgA.getBoundingClientRect();
  const rectB = imgB.getBoundingClientRect();
  if (rectA.width === 0 || rectA.height === 0 || rectB.width === 0 || rectB.height === 0) return;
  const rot180 = payload.player === 1; // P2 协议卡转 180°（与场上协议渲染一致）；P1 0°
  const ghostA = buildProtocolGhost(imgA.src, rectA, rot180);
  const ghostB = buildProtocolGhost(imgB.src, rectB, rot180);
  // 同时飞行：A 从 a 中心 → b 中心、B 反向（互换）
  flyProtocolGhost(ghostA, rectA, rectB, rot180);
  flyProtocolGhost(ghostB, rectB, rectA, rot180);
}

/** 重排协议基础特效订阅（protocols:rearranged 事件无 uid/defId，单独注册，同 initCompileFx） */
export function initRearrangeFx(): () => void {
  return gameBus.subscribe((e: GameEvent) => {
    if (e.type !== 'protocols:rearranged') return;
    playRearrangeProtocolsFx(e.payload as RearrangeProtocolsPayload);
  });
}
