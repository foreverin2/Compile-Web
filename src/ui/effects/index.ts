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

// Death 删除附加特效（fx-death-*，card:deleted + triggerProtocol=death）时序常量：
// 前置段（镰刀渐现 → 划过）→ 延后基础破碎 → 收尾段（骷髅渐现 / 镰刀渐隐 → 骷髅 2s 后渐隐、
// 深紫边框光 2s 消失）。CSS 侧过渡时长与之一一对应（styles.css .fx-death-* 注释标注）。
const DEATH_SCYTHE_IN_MS = 300;    // 镰刀渐现（0 → 0.3s）
const DEATH_SCYTHE_SWEEP_MS = 500; // 镰刀划过（0.3 → 0.8s；划完即开播基础破碎）
const DEATH_PRE_MS = DEATH_SCYTHE_IN_MS + DEATH_SCYTHE_SWEEP_MS; // 800：前置段完成
const DEATH_SCYTHE_OUT_MS = 400;   // 镰刀渐隐（划过完成后）
const DEATH_SKULL_LINGER_MS = 2000; // 骷髅停留（渐现后 2s 再渐隐）
const DEATH_SKULL_FADE_MS = 400;   // 骷髅渐隐
const DEATH_GLOW_MS = 2000;        // 深紫边框光（与镰刀同起，2s 后消失）
const DEATH_TOTAL_MS = DEATH_PRE_MS + DEATH_SKULL_LINGER_MS + DEATH_SKULL_FADE_MS + 60; // ≈ 3.26s

// Hate 删除附加特效（fx-hate-*，card:deleted + triggerProtocol=hate）时序常量：
// 前置段（手指手掌渐现 → 5 指收缩抓住）→ 延后基础破碎 → 收尾段（手掌渐隐 / 血泊渐现 →
// 血泊 2s 后渐隐、血红边框光 2s 消失）。CSS 侧过渡时长与之一一对应。
const HATE_HAND_IN_MS = 500;  // 手指手掌渐现（0 → 0.5s）
const HATE_GRIP_MS = 1000;    // 5 指收缩抓住（0.5 → 1.5s；抓住即开播基础破碎）
const HATE_PRE_MS = HATE_HAND_IN_MS + HATE_GRIP_MS; // 1500：前置段完成
const HATE_HAND_OUT_MS = 450; // 手指手掌渐隐（抓住完成后）
const HATE_BLOOD_LINGER_MS = 2000; // 血泊停留（渐现后 2s 再渐隐）
const HATE_BLOOD_FADE_MS = 400;    // 血泊渐隐
const HATE_GLOW_MS = 2000;         // 血红边框光（与手指同起，2s 后消失）
const HATE_TOTAL_MS = HATE_PRE_MS + HATE_BLOOD_LINGER_MS + HATE_BLOOD_FADE_MS + 60; // ≈ 3.96s

// Gravity 位移附加特效（fx-gravity-*，card:deck-played 反面打出牌堆顶 / card:shifted +
// triggerProtocol=gravity）时序常量：
// 前置段（牌库区品红光 → 终点黑洞渐现 → 品红射线由黑洞射向起点 1.5s）→ 延后基础特效 →
// 收尾段（卡到终点后黑洞渐隐、卡边框品红光到终点后 1s 熄灭）。CSS 侧过渡时长与之一一对应
// （styles.css .fx-gravity-* 注释标注）。
const GRAVITY_HOLE_IN_MS = 300;          // 终点黑洞渐现（0 → 0.3s）
const GRAVITY_BEAM_MS = 1500;            // 品红射线（0.3 → 1.8s；由粗变细、过中间后由细变粗）
const GRAVITY_PRE_MS = GRAVITY_HOLE_IN_MS + GRAVITY_BEAM_MS; // 1800：前置段完成 → 基础特效
const GRAVITY_HOLE_OUT_MS = 400;         // 黑洞渐隐（卡到终点后）
const GRAVITY_CARDGLOW_LINGER_MS = 1000; // 卡边框品红光保持到终点后 1s
const GRAVITY_CARDGLOW_FADE_MS = 400;    // 卡边框品红光渐隐
// 品红卡框光 CSS 动画总时长（飞行 MOVE_MS + 停留 LINGER + 渐隐 FADE + 50 余量）：
// 新时序下浮层卡在事件时即创建、前置段（GRAVITY_PRE_MS）全程发光，故动画整体顺延——
// JS 以 --fx-gravity-glow-ms / --fx-gravity-glow-delay 内联注入（CSS animation 同款默认值兜底）。
const GRAVITY_GLOW_MS = MOVE_MS + GRAVITY_CARDGLOW_LINGER_MS + GRAVITY_CARDGLOW_FADE_MS + 50; // ≈ 1.9s
/** 终点黑洞直径（用户 #5b：72 → 120 放大；调整集中在此） */
const GRAVITY_HOLE_SIZE = 120;

// Speed 位移附加特效（fx-speed-*，card:shifted / card:drawn + triggerProtocol=speed）时序常量：
// 卡框灰白光 + 卡中心飓风渐现 → 整体沿起点→终点直线平移（1.5s）→ 到达后飓风渐隐、卡框恢复。
// CSS 侧过渡时长与之一一对应（styles.css .fx-speed-* 注释标注）。
const SPEED_TORNADO_IN_MS = 300;  // 飓风渐现（0 → 0.3s）
const SPEED_MOVE_MS = 1500;       // 飓风沿起点→终点直线平移
const SPEED_TORNADO_OUT_MS = 400; // 飓风渐隐 + 卡框灰白光恢复（渐隐）
/** 导出供 main.ts 抽牌时序用：speed 抽牌专属（飓风）完成总时长——基础抽牌动画顺延到此后才播 */
export const SPEED_TOTAL_MS = SPEED_TORNADO_IN_MS + SPEED_MOVE_MS + SPEED_TORNADO_OUT_MS + 60; // ≈ 2.26s

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
  /** 给牌/随机拿牌（card:given）的接收方（love-1 底/love-3；uid 对应卡此刻仍在给牌方手牌 DOM） */
  to?: PlayerId;
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
  return buildFxCardAt(rect, node.classList.contains('rot-cw'), node.classList.contains('rot-ccw'), payload, zIndex);
}

/**
 * buildFxCard 的 rect 版：由【已捕获的原卡 rect + 旋转标志】构建浮层卡。
 * 死亡/恨删除附加特效的延后基础破碎在事件后 0.8s/1.5s 触发——此刻原卡节点已被重渲染移除
 * （rect 归零），故在事件时捕获 rect、延后用本函数重建（视觉位置不变）。规则与 buildFxCard 相同。
 */
function buildFxCardAt(
  rect: DOMRect,
  cw: boolean,
  ccw: boolean,
  payload: FxCardPayload,
  zIndex: number,
): HTMLElement | null {
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

/**
 * Death 协议专属删除附加特效：死神镰刀划过 + 深紫边框光 + 骷髅收尾
 * （card:deleted + triggerProtocol=death；styles.css .fx-death-* 结构见类注释）。
 * 时序（总 ≈ 3.26s）：镰刀渐现(0~0.3s) → 镰刀划过(0.3~0.8s) → 基础破碎(0.8s 起，本函数延后调度)
 * → 收尾(0.8s 起：镰刀渐隐、原卡位渐现黑骷髅头) → 骷髅 2s 后渐隐、深紫边框光 2s 后消失。
 * 注意与 fire/light/darkness 不同：本特效【前置段先播、基础 playShatter 延后】，故分发处
 * 对 death/hate 跳过即时破碎，由本函数在 DEATH_PRE_MS 用事件时捕获的 rect 调度 playShatterAt。
 */
function playDeathDeleteExtra(node: HTMLElement, payload: FxCardPayload): void {
  const clone = buildFxCard(node, payload, EXTRA_Z);
  if (!clone) return;
  const rect = node.getBoundingClientRect();
  const cw = node.classList.contains('rot-cw');
  const ccw = node.classList.contains('rot-ccw');
  clone.classList.add('fx-death', 'fx-death-glow');
  // ① 镰刀：长柄 + 弯月刃，初始悬于卡上方（渐现），随后斜划过卡面
  const scythe = document.createElement('div');
  scythe.className = 'fx-death-scythe';
  const item = document.createElement('div');
  item.className = 'fx-death-scythe-item';
  item.appendChild(Object.assign(document.createElement('div'), { className: 'fx-death-scythe-handle' }));
  item.appendChild(Object.assign(document.createElement('div'), { className: 'fx-death-scythe-blade' }));
  scythe.appendChild(item);
  clone.appendChild(scythe);
  // ⑤ 骷髅：头骨 + 下排牙齿（交替 translateY 上下动），初始隐藏、破碎时渐现
  const skull = document.createElement('div');
  skull.className = 'fx-death-skull';
  const head = document.createElement('div');
  head.className = 'fx-death-skull-head';
  head.appendChild(Object.assign(document.createElement('div'), { className: 'fx-death-skull-eye left' }));
  head.appendChild(Object.assign(document.createElement('div'), { className: 'fx-death-skull-eye right' }));
  head.appendChild(Object.assign(document.createElement('div'), { className: 'fx-death-skull-nose' }));
  const jaw = document.createElement('div');
  jaw.className = 'fx-death-skull-jaw';
  const TOOTH_COUNT = 5;
  for (let i = 0; i < TOOTH_COUNT; i++) {
    jaw.appendChild(Object.assign(document.createElement('div'), { className: 'fx-death-tooth' }));
  }
  head.appendChild(jaw);
  skull.appendChild(head);
  clone.appendChild(skull);
  // 阶段调度（setTimeout 链，与 DEATH_* 常量对齐；所有浮层自清理）
  window.setTimeout(() => item.classList.add('fx-death-scythe-visible'), 20);
  window.setTimeout(() => item.classList.add('fx-death-scythe-sweep'), DEATH_SCYTHE_IN_MS);
  window.setTimeout(() => {
    playShatterAt(rect, cw, ccw, payload);   // ④ 基础破碎（延后）
    clone.classList.add('fx-death-shattered'); // 卡面淡出，露出破碎层
    item.classList.add('fx-death-scythe-out'); // 镰刀渐隐
    skull.classList.add('fx-death-skull-in');  // 骷髅渐现
  }, DEATH_PRE_MS);
  window.setTimeout(() => scythe.remove(), DEATH_PRE_MS + DEATH_SCYTHE_OUT_MS + 60);
  window.setTimeout(() => skull.classList.add('fx-death-skull-out'), DEATH_PRE_MS + DEATH_SKULL_LINGER_MS);
  window.setTimeout(() => clone.remove(), DEATH_TOTAL_MS);
}

/**
 * Hate 协议专属删除附加特效：血红五指抓握 + 血红边框光 + 血泊收尾
 * （card:deleted + triggerProtocol=hate；styles.css .fx-hate-* 结构见类注释）。
 * 时序（总 ≈ 3.96s）：手指手掌渐现(0~0.5s) → 5 指收缩抓住(0.5~1.5s) → 基础破碎(1.5s 起，
 * 本函数延后调度) → 收尾(1.5s 起：手掌渐隐、原卡位渐现一滩血) → 血泊 2s 后渐隐、血红边框光
 * 2s 后消失。5 指按环形分布、指尖朝向卡中心；收缩 translate 目标为卡中心（JS 按各指起点计算）。
 */
function playHateDeleteExtra(node: HTMLElement, payload: FxCardPayload): void {
  const clone = buildFxCard(node, payload, EXTRA_Z);
  if (!clone) return;
  const rect = node.getBoundingClientRect();
  const cw = node.classList.contains('rot-cw');
  const ccw = node.classList.contains('rot-ccw');
  clone.classList.add('fx-hate', 'fx-hate-glow');
  // ① 血红手掌 + 5 指（环形围卡，指尖朝向卡中心；CSS 血色渐变 + 圆角指节）
  const hand = document.createElement('div');
  hand.className = 'fx-hate-hand';
  hand.appendChild(Object.assign(document.createElement('div'), { className: 'fx-hate-palm' }));
  const w = clone.clientWidth;
  const h = clone.clientHeight;
  const cx = w / 2;
  const cy = h / 2;
  const HALF_DIAG = Math.hypot(w, h) / 2;
  const FINGER_R = HALF_DIAG + 52; // 指心起始半径（卡外）
  const FINGER_W = 15;
  const FINGER_H = 92;
  const GRIP_D = FINGER_R - 34;    // 收缩位移：指心抵达距卡中心 34px（指尖越过中心 → 抓住）
  const FINGER_COUNT = 5;
  const fingers: { el: HTMLElement; deg: number; gx: number; gy: number }[] = [];
  for (let i = 0; i < FINGER_COUNT; i++) {
    const angle = (i / FINGER_COUNT) * Math.PI * 2 - Math.PI / 2; // 从正上方起顺时针环形分布
    const deg = (angle * 180) / Math.PI - 90; // 旋转使指尖（本地 top）朝向卡中心
    const f = Object.assign(document.createElement('div'), { className: 'fx-hate-finger' });
    f.style.left = `${(cx + Math.cos(angle) * FINGER_R - FINGER_W / 2).toFixed(1)}px`;
    f.style.top = `${(cy + Math.sin(angle) * FINGER_R - FINGER_H / 2).toFixed(1)}px`;
    f.style.transform = `rotate(${deg.toFixed(1)}deg)`;
    hand.appendChild(f);
    fingers.push({ el: f, deg, gx: -Math.cos(angle) * GRIP_D, gy: -Math.sin(angle) * GRIP_D });
  }
  clone.appendChild(hand);
  // ⑤ 血泊：不规则血色斑块（多径向渐变 blob）+ 卫星血滴，初始隐藏、抓住时渐现
  const blood = document.createElement('div');
  blood.className = 'fx-hate-blood';
  const splat = document.createElement('div');
  splat.className = 'fx-hate-blood-splat';
  blood.appendChild(splat);
  const DROPS: [number, number, number][] = [[16, 78, 10], [86, 26, 8], [70, 90, 7], [8, 30, 6]];
  for (const [lx, ty, sz] of DROPS) {
    const drop = Object.assign(document.createElement('div'), { className: 'fx-hate-blood-drop' });
    drop.style.left = `${lx}%`;
    drop.style.top = `${ty}%`;
    drop.style.width = `${sz}px`;
    drop.style.height = `${sz}px`;
    splat.appendChild(drop);
  }
  clone.appendChild(blood);
  // 阶段调度（setTimeout 链，与 HATE_* 常量对齐；所有浮层自清理）
  window.setTimeout(() => hand.classList.add('fx-hate-hand-in'), 20);
  window.setTimeout(() => {
    hand.classList.add('fx-hate-grip');
    for (const f of fingers) {
      // ② 收缩抓住：各指沿自身方向平移至卡中心（父坐标系位移 + 微缩）
      f.el.style.transform = `translate(${f.gx.toFixed(1)}px, ${f.gy.toFixed(1)}px) scale(0.9) rotate(${f.deg.toFixed(1)}deg)`;
    }
  }, HATE_HAND_IN_MS);
  window.setTimeout(() => {
    playShatterAt(rect, cw, ccw, payload);    // ④ 基础破碎（延后）
    clone.classList.add('fx-hate-shattered'); // 卡面淡出，露出破碎层
    hand.classList.add('fx-hate-hand-out');   // 手掌渐隐
    blood.classList.add('fx-hate-blood-in');  // 血泊渐现
  }, HATE_PRE_MS);
  window.setTimeout(() => hand.remove(), HATE_PRE_MS + HATE_HAND_OUT_MS + 60);
  window.setTimeout(() => blood.classList.add('fx-hate-blood-out'), HATE_PRE_MS + HATE_BLOOD_LINGER_MS);
  window.setTimeout(() => clone.remove(), HATE_TOTAL_MS);
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

/* ===== Metal 金属附加特效（FX-6，用户 #6b）：metal-1 对手三条链路边框金属光泽 =====
 * 触发：card:drawn 且 triggerProtocol === 'metal'（metal-1 中指令「抽2张牌」——打出即抽2；
 * resolve.ts draw op 已带 pe.sourceDefId 协议段 → payload.triggerProtocol === 'metal'）。
 * 效果：对手（metal-1 打出方的对手）三条链路（.stack-slot[data-player=对手][data-line=N]）
 * 边框外层一圈金属光泽（.fx-metal-lineglow body 级 fixed 层，金属渐变描边 + 扫光），
 * 一次性：出现（0.3s 渐现）→ 保持 3 秒 → 渐隐（0.5s）→ 移除。全部浮层 pointer-events:none、
 * JS 定时自清理（重置路径由 resetUiState 按 .fx-metal-lineglow 类批量清扫兜底）。 */
const METAL_LINE_HOLD_MS = 3000; // 金属光泽保持（出现后 3s 开始渐隐）
const METAL_LINE_FADE_MS = 500;  // 渐隐时长

/** metal-1 一次性：对手三条链路边框金属光泽（出现 → 3s 渐隐）。player = metal-1 打出方
 *  （card:drawn payload.player = ctx.player = 效果源持有者）→ 对手 = player === 0 ? 1 : 0。 */
function playMetalLineGlow(player: PlayerId): void {
  const opp: PlayerId = player === 0 ? 1 : 0;
  for (const line of [0, 1, 2]) {
    const slot = document.querySelector<HTMLElement>(
      `.stack-slot[data-player="${opp}"][data-line="${line}"]`
    );
    if (!slot) continue;
    const r = slot.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const glow = document.createElement('div');
    glow.className = 'fx-metal-lineglow';
    // 层盒外扩 5px：金属渐变环读作「链路边框外层一圈」而非覆盖槽位本身
    glow.style.left = `${r.left - 5}px`;
    glow.style.top = `${r.top - 5}px`;
    glow.style.width = `${r.width + 10}px`;
    glow.style.height = `${r.height + 10}px`;
    glow.style.zIndex = String(EXTRA_Z);
    document.body.appendChild(glow);
    window.setTimeout(() => glow.classList.add('fx-metal-lineglow-in'), 20);
    window.setTimeout(() => glow.classList.add('fx-metal-lineglow-out'), METAL_LINE_HOLD_MS);
    window.setTimeout(() => glow.remove(), METAL_LINE_HOLD_MS + METAL_LINE_FADE_MS + 60);
  }
}

/** 基础行为特效：删去 → 破碎消散（src/ui/fx/delete-shatter.ts 的 mountShatter） */
function playShatter(node: HTMLElement, payload: FxCardPayload): void {
  const clone = buildFxCard(node, payload, BASE_Z);
  if (!clone) return;
  mountShatter(clone);
  window.setTimeout(() => clone.remove(), FX_REMOVE_MS);
}

/** 延后基础破碎：死亡/恨删除附加特效在前置段（镰刀/手指）播完后调用。
 *  原卡节点此刻已被重渲染移除 → 用事件时捕获的 rect 重建浮层（见 buildFxCardAt）。 */
function playShatterAt(rect: DOMRect, cw: boolean, ccw: boolean, payload: FxCardPayload): void {
  const clone = buildFxCardAt(rect, cw, ccw, payload, BASE_Z);
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

/** 延后基础弃牌切割：念能/瘟疫弃牌附加特效在前置段（粒子环绕 / 浓雾覆盖）播完后调用。
 *  原卡节点此刻已被重渲染移除（rect 归零）→ 用事件时捕获的 rect 重建浮层（见 buildFxCardAt）。 */
function playCutAt(rect: DOMRect, cw: boolean, ccw: boolean, payload: FxCardPayload): void {
  const clone = buildFxCardAt(rect, cw, ccw, payload, BASE_Z);
  if (!clone) return;
  mountCut(clone);
  window.setTimeout(() => clone.remove(), FX_REMOVE_MS);
}

/* ===== Psychic 弃牌附加特效（用户 #4a）：紫粉粒子环绕汇聚 =====
 * 触发：card:discarded 且 triggerProtocol === 'psychic'（psychic-0/2/3/5 弃牌）。
 * 时序（总 ≈ 2.66s）：① 卡周围 24 颗紫粉粒子环形散布、随机相位/大小，环绕并渐现
 * 1s（= PSYCHIC_ORBIT_MS）；② 1s 后全部粒子同时向卡中心平移汇聚（0.4s =
 * PSYCHIC_CONVERGE_MS）；③ 汇聚完成（1.4s = PSYCHIC_PRE_MS）起触发基础弃牌
 * （playCutAt，事件时捕获 rect 重建——重渲染后原卡节点 rect 归零）；④ 粒子随浮层
 * 淡出，基础切割在下方完整可见。CSS 侧时长与 PSYCHIC_* 常量一一对应
 * （styles.css .fx-psychic-* 注释标注）。 */
const PSYCHIC_ORBIT_MS = 1000;     // 粒子环绕渐现（0 → 1s）
const PSYCHIC_CONVERGE_MS = 400;   // 全部粒子汇聚到卡中心（1 → 1.4s）
const PSYCHIC_PRE_MS = PSYCHIC_ORBIT_MS + PSYCHIC_CONVERGE_MS; // 1400：前置段完成
const PSYCHIC_PARTICLE_COUNT = 24; // 粒子数（需求 ≥20）
const PSYCHIC_TOTAL_MS = PSYCHIC_PRE_MS + FX_REMOVE_MS + 60;   // ≈ 2.66s

/** 念能弃牌附加特效浮层：克隆卡（EXTRA_Z）+ 粒子环（.fx-psychic-ring 内 24 个
 *  .fx-psychic-orbit 轨道 span——锚定卡中心自转，内嵌 .fx-psychic-particle 由 JS 按
 *  角度/半径写入 --fx-x/--fx-y 像素偏移 → 环绕；汇聚时轨道停转、粒子过渡到中心）。 */
function playPsychicDiscardExtra(node: HTMLElement, payload: FxCardPayload): void {
  const clone = buildFxCard(node, payload, EXTRA_Z);
  if (!clone) return;
  const rect = node.getBoundingClientRect();
  const cw = node.classList.contains('rot-cw');
  const ccw = node.classList.contains('rot-ccw');
  clone.classList.add('fx-psychic', 'fx-psychic-glow');
  // ① 粒子环：24 颗环形散布（角度均匀 + 半径抖动 + 随机大小 6–14px），轨道 span 相位错开
  const ring = document.createElement('div');
  ring.className = 'fx-psychic-ring';
  const baseR = Math.max(clone.clientWidth, clone.clientHeight) * 0.75 + 10;
  for (let i = 0; i < PSYCHIC_PARTICLE_COUNT; i++) {
    const angle = (i / PSYCHIC_PARTICLE_COUNT) * Math.PI * 2;
    const radius = baseR + ((i * 37) % 26) - 13; // 半径抖动（±13px）
    const size = 6 + ((i * 13) % 9);             // 大小 6–14px
    const orbit = Object.assign(document.createElement('span'), { className: 'fx-psychic-orbit' });
    orbit.style.animationDelay = `${-((i * 137) % 100) / 100}s`; // 环绕相位错开
    const p = Object.assign(document.createElement('i'), { className: 'fx-psychic-particle' });
    p.style.width = `${size}px`;
    p.style.height = `${size}px`;
    p.style.setProperty('--fx-size', `${size}px`);
    p.style.setProperty('--fx-x', `${(Math.cos(angle) * radius).toFixed(1)}px`);
    p.style.setProperty('--fx-y', `${(Math.sin(angle) * radius).toFixed(1)}px`);
    p.style.animationDelay = `${((i % 8) * 0.06).toFixed(2)}s`; // 渐现错开
    orbit.appendChild(p);
    ring.appendChild(orbit);
  }
  clone.appendChild(ring);
  // ② 汇聚：1s 后全部粒子同时向卡中心平移（轨道停转 + 粒子 transform 过渡）
  window.setTimeout(() => ring.classList.add('fx-psychic-converge'), PSYCHIC_ORBIT_MS);
  // ③ 汇聚完成 → 延后基础弃牌 + ④ 整层（粒子+卡面）淡出露出切割
  window.setTimeout(() => {
    playCutAt(rect, cw, ccw, payload);
    clone.classList.add('fx-psychic-out');
  }, PSYCHIC_PRE_MS);
  window.setTimeout(() => clone.remove(), PSYCHIC_TOTAL_MS);
}

/* ===== Plague 弃牌附加特效（用户 #5a）：深绿光芒 + 深绿浓雾覆盖 =====
 * 触发：card:discarded 且 triggerProtocol === 'plague'（plague-0/1/2/5 弃牌）。
 * 时序（总 ≈ 2.76s）：① 卡框深绿光芒 + 7 团半透明深绿 blob 浓雾围绕卡渐现渐扩散、
 * 渐渐覆盖卡（1.5s = PLAGUE_MIST_IN_MS）；② 浓雾铺满（1.5s = PLAGUE_PRE_MS）起触发
 * 基础弃牌（playCutAt）；③ 整层（浓雾+卡面）0.5s 渐散，切割随雾退去完整可见。
 * CSS 侧时长与 PLAGUE_* 常量一一对应（styles.css .fx-plague-* 注释标注）。 */
const PLAGUE_MIST_IN_MS = 1500;  // 浓雾渐现渐扩散（0 → 1.5s）
const PLAGUE_MIST_FADE_MS = 500; // 切割开始时整层渐散（0.5s）
const PLAGUE_PRE_MS = PLAGUE_MIST_IN_MS; // 前置段完成 → 基础弃牌
const PLAGUE_BLOB_COUNT = 7;
const PLAGUE_TOTAL_MS = PLAGUE_PRE_MS + FX_REMOVE_MS + 60; // ≈ 2.76s

/** 瘟疫弃牌附加特效浮层：克隆卡（EXTRA_Z）+ 深绿光芒 + 7 团浓雾 blob（.fx-plague-blob
 *  沿卡四边/角 nth-child 锚点；opacity 走 transition（渐现 1.5s / 随层渐散），扩散
 *  transform 走 1.5s 动画——避免动画 fill-mode 覆盖消散过渡）。 */
function playPlagueDiscardExtra(node: HTMLElement, payload: FxCardPayload): void {
  const clone = buildFxCard(node, payload, EXTRA_Z);
  if (!clone) return;
  const rect = node.getBoundingClientRect();
  const cw = node.classList.contains('rot-cw');
  const ccw = node.classList.contains('rot-ccw');
  clone.classList.add('fx-plague', 'fx-plague-glow');
  // ① 浓雾覆盖层：7 团深绿 blob 围绕卡渐现渐扩散（各 blob 渐现延迟错开）
  const mist = document.createElement('div');
  mist.className = 'fx-plague-mist';
  for (let i = 0; i < PLAGUE_BLOB_COUNT; i++) {
    const blob = Object.assign(document.createElement('div'), { className: 'fx-plague-blob' });
    blob.style.animationDelay = `${((i % 4) * 0.18).toFixed(2)}s`;
    mist.appendChild(blob);
  }
  clone.appendChild(mist);
  // 浓雾渐现（0 → 1.5s；延迟 20ms 保证初始 opacity:0 已被绘制）
  window.setTimeout(() => mist.classList.add('fx-plague-mist-in'), 20);
  // ② 浓雾铺满 → 延后基础弃牌 + ③ 整层渐散露出切割
  window.setTimeout(() => {
    playCutAt(rect, cw, ccw, payload);
    clone.classList.add('fx-plague-out');
  }, PLAGUE_PRE_MS);
  window.setTimeout(() => clone.remove(), PLAGUE_TOTAL_MS);
}

/** 构建 3D 翻面覆盖层（旧面 front + 新面 back，透视内建）。调用方决定动画时机与清理：
 *  - playFlip：构建后立即 rAF 触发 rotate 过渡，420ms 后移除；
 *  - playLifeFlip：覆盖层在事件时同步构建（原卡 rect 此刻有效——重渲染会重建节点、
 *    rect 归零），展开动画期间保持旧面静止（与新状态卡同位同尺寸 → 视觉无缝），
 *    展开完成后（~1.65s）再触发翻转、+420ms 移除。返回 null 表示 rect 无效（调用方跳过）。 */
function buildFlipOverlay(
  rect: DOMRect,
  cw: boolean,
  ccw: boolean,
  oldSrc: string,
  newSrc: string,
): { wrap: HTMLElement; inner: HTMLElement } | null {
  if (rect.width === 0 || rect.height === 0) return null;
  const horizontal = cw || ccw;
  const wrap = document.createElement('div');
  wrap.className = 'flip-overlay-fx'; // resetUiState 清扫兜底（覆盖层最长 ~2.07s，重置时立即移除）
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
  return { wrap, inner };
}

/** 基础行为特效：翻面——旧面翻转到新面（rotateY；场上横置卡用 rotateX 使翻面也横着） */
function playFlip(node: HTMLElement, payload: FxCardPayload): void {
  const rect = node.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return;
  const cw = node.classList.contains('rot-cw');
  const ccw = node.classList.contains('rot-ccw');
  const oldSrc = node.querySelector('img')?.src ?? cardFaceSrc(payload.defId, payload.faceUp);
  const overlay = buildFlipOverlay(rect, cw, ccw, oldSrc, cardFaceSrc(payload.defId, payload.faceUp));
  if (!overlay) return;
  requestAnimationFrame(() => {
    overlay.inner.style.transform = cw || ccw ? 'rotateX(180deg)' : 'rotateY(180deg)';
  });
  window.setTimeout(() => overlay.wrap.remove(), 420);
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
 * 容器（body 级 fixed、无 transform → 不改变子元素 fixed 视口坐标；容器 z-index 301
 * 高于翻面覆盖层 300，藤蔓绘制在卡面之上；否则 fixed 自建 stacking context 会把
 * 整层垫到卡面之下——"翻转前看不到藤蔓"的根因），收缩完成后整体移除；容器类也被
 * render.ts resetUiState 批量清扫（应用内重置路径兜底）。绿光单独挂 body（需持续
 * ~3.6 秒，长于藤蔓容器），自带移除定时器 + resetUiState 兜底。 */
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
  // 藤蔓容器（body 级 fixed；无 transform → 子元素 fixed 坐标仍按视口）。
  // ⚠️ position:fixed 无论 z-index 是否 auto 都自成 stacking context——若容器不写
  // z-index（auto≈0），整层会垫在翻面覆盖层（buildFlipOverlay z-index:300）之下，
  // 藤蔓在翻转前被卡面完全遮住（只有 3D 翻转转开正面才露出来）。容器显式 z-index
  // 设为 EXTRA_Z（301）> 300，整层连同其内全部藤蔓都绘制在卡面之上、读作缠绕在
  // 卡牌上方。pointer-events:none 透传点击。收缩完成后整体移除。
  const fxWrap = document.createElement('div');
  fxWrap.className = 'life-flip-fx';
  fxWrap.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:301;';
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
  // （展开动画 0.9s → 1.9s，翻面在 ~1.65s 才开始，"先展开、后翻转"）。
  // 覆盖层必须此刻同步构建：重渲染随后会重建原卡节点（rect 归零），而展开期间
  // 覆盖层保持旧面静止（与新状态卡同位同尺寸 → 视觉无缝），~1.65s 后再播 3D 翻转。
  const cw = node.classList.contains('rot-cw');
  const ccw = node.classList.contains('rot-ccw');
  const oldSrc = node.querySelector('img')?.src ?? cardFaceSrc(payload.defId, payload.faceUp);
  const flipOverlay = buildFlipOverlay(rect, cw, ccw, oldSrc, cardFaceSrc(payload.defId, payload.faceUp));
  if (flipOverlay) {
    window.setTimeout(() => {
      flipOverlay.inner.style.transform = cw || ccw ? 'rotateX(180deg)' : 'rotateY(180deg)';
    }, LIFE_VINE_SHRINK_MS);
    window.setTimeout(() => flipOverlay.wrap.remove(), LIFE_VINE_SHRINK_MS + 420);
  }
}

/* ===== Apathy 翻转附加特效（FX-5，用户 #10a）：边框灰光 + 双边灰雾覆盖 =====
 * 触发：card:flipped 且 payload.triggerProtocol === 'apathy'（apathy-1/2/3/4 的翻转——
 * 引擎 flip op 按效果源协议写 triggerProtocol，resolve.ts 已接线）。
 * 翻面本身复用 playFlip 即时播放（【不延后】——与 life 不同，本函数只在其周围叠加）：
 * ① 卡边框亮灰光芒（.fx-apathy-glow 呼吸发光，随浮层存在）；
 * ② 左右双边浓重灰雾从卡两侧渐现并向卡中心覆盖（.fx-apathy-mist 内左/右两团
 *    .fx-apathy-mist-left/right：translateX 由卡外滑入中心 + opacity 渐现，0.55s）；
 * ③ 基础翻面 playFlip 即时播放（灰雾期间一直在——浮层 z EXTRA_Z 301 高于翻面覆盖层 300）；
 * ④ 翻后（APATHY_FLIP_MS = 420，与 playFlip 覆盖层移除同步）灰雾外扩消散（0.5s）；
 * ⑤ 边框灰光保持 1 秒（APATHY_GLOW_AFTER_MS）后淡出（0.4s），整层 ~2s 自清理。
 * 浮层无卡面图（真实卡/翻面覆盖层在下方，灰雾覆盖其上；边框光画在卡框四周）——
 * 不需要卡面克隆，避免 payload 已是翻后状态（buildFxCard 会直接显示新面）。 */
const APATHY_MIST_IN_MS = 550;     // 灰雾渐现 + 滑入覆盖（0 → 0.55s）
const APATHY_FLIP_MS = 420;        // 基础翻面覆盖层时长（与 playFlip 移除时机一致）
const APATHY_MIST_OUT_MS = 500;    // 灰雾外扩消散（翻后起，0.5s）
const APATHY_GLOW_AFTER_MS = 1000; // 边框灰光保持（翻后 1s）
const APATHY_GLOW_FADE_MS = 400;   // 边框灰光淡出（0.4s）
const APATHY_TOTAL_MS = APATHY_FLIP_MS + APATHY_GLOW_AFTER_MS + APATHY_GLOW_FADE_MS + 180; // ≈ 2s

function playApathyFlipExtra(node: HTMLElement, payload: FxCardPayload): void {
  const rect = node.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) {
    playFlip(node, payload); // rect 缺失 → 退回基础翻面
    return;
  }
  // 浮层：边框灰光 + 灰雾（body 级 fixed、无卡面——真实卡/翻面覆盖层在下方）
  const fx = document.createElement('div');
  fx.className = 'fx-apathy fx-apathy-glow';
  fx.style.cssText =
    `position:fixed;left:${rect.left}px;top:${rect.top}px;` +
    `width:${rect.width}px;height:${rect.height}px;z-index:${EXTRA_Z};pointer-events:none;`;
  const mist = document.createElement('div');
  mist.className = 'fx-apathy-mist';
  mist.appendChild(Object.assign(document.createElement('div'), { className: 'fx-apathy-mist-left' }));
  mist.appendChild(Object.assign(document.createElement('div'), { className: 'fx-apathy-mist-right' }));
  fx.appendChild(mist);
  document.body.appendChild(fx);
  // ② 灰雾渐现 + 向中心覆盖（20ms 延迟保证初始 opacity:0 已被绘制）
  window.setTimeout(() => mist.classList.add('fx-apathy-mist-in'), 20);
  // ③ 基础翻面：即时播放（本函数只叠加灰雾/灰光，不替换、不延后翻面）
  playFlip(node, payload);
  // ④ 翻后灰雾消散（与翻面覆盖层移除同步）
  window.setTimeout(() => mist.classList.add('fx-apathy-mist-out'), APATHY_FLIP_MS);
  // ⑤ 边框灰光保持 1s 后淡出 + 整层清理
  window.setTimeout(() => fx.classList.add('fx-apathy-glow-out'), APATHY_FLIP_MS + APATHY_GLOW_AFTER_MS);
  window.setTimeout(() => fx.remove(), APATHY_TOTAL_MS);
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

/* ===== Gravity 位移附加特效（用户 #3）：品红牌库框光 + 终点黑洞 + 品红射线 + 卡框品红光 =====
 * 触发：card:deck-played（反面打出牌堆顶，payload.owner = 牌库 owner）与 card:shifted 且
 * triggerProtocol === 'gravity'（gravity-1/2/4 的平移）。
 * 时序（总 ≈ 3.7s，FX-R1 时序重构）：① 牌库区边框品红光（仅打牌堆顶时）；② 【事件时立即
 * 创建浮层卡】（旧位置 rect，z=BASE_Z 盖住真实卡，带 .fx-gravity-cardglow 品红卡框光——重渲染
 * 后真实卡瞬移到终点，但浮层卡占据旧位置，用户只见"卡在原位被吸入"而非"先瞬移后特效"）；
 * ③ 终点黑洞渐现（0~0.3s）；④ 品红射线由黑洞射向起点（0.3~1.8s，由粗变细、过中间后由细变粗）；
 * ⑤ 前置段完成（1.8s）起浮层卡飞向终点（基础平移节奏，MOVE_MS + reflow 起飞）；⑥ 收尾（卡到
 * 终点后）：黑洞渐隐；卡边框品红光到终点后 1s 熄灭。全部浮层 pointer-events:none、
 * JS setTimeout 自清理。 */

/** 终点黑洞：深紫黑圆盘 + 中间一条横线（事件视界），整体 rotate 倾斜。渐现 0.3s
 * （GRAVITY_HOLE_IN_MS），卡到达后由调用方触发渐隐（.fx-gravity-hole-out）。 */
function spawnGravityHole(end: { x: number; y: number }): HTMLElement {
  const HOLE_SIZE = GRAVITY_HOLE_SIZE;
  const hole = document.createElement('div');
  hole.className = 'fx-gravity-hole';
  hole.style.left = `${end.x - HOLE_SIZE / 2}px`;
  hole.style.top = `${end.y - HOLE_SIZE / 2}px`;
  hole.style.width = `${HOLE_SIZE}px`;
  hole.style.height = `${HOLE_SIZE}px`;
  hole.style.zIndex = String(EXTRA_Z);
  hole.appendChild(Object.assign(document.createElement('div'), { className: 'fx-gravity-hole-disc' }));
  hole.appendChild(Object.assign(document.createElement('div'), { className: 'fx-gravity-hole-slit' }));
  document.body.appendChild(hole);
  window.setTimeout(() => hole.classList.add('fx-gravity-hole-in'), 20);
  return hole;
}

/** 品红射线：黑洞（end）向起点（start）射出的细长条（transform-origin left center 锚定黑洞、
 *  按起终距离定宽、rotate 到起点角度——角度经 --fx-beam-angle 写进动画关键帧，避免 CSS 动画
 *  覆盖内联 transform 丢掉旋转）。CSS animation delay 0.3s + fill-mode backwards →
 *  0.3s 起自黑洞向起点生长（scaleX 0→1），核心 .fx-gravity-beam-core 同步「由粗变细、过中间后
 *  由细变粗」（scaleY 1→0.18→1）——动画时长 1.5s = GRAVITY_BEAM_MS，1.8s 由调用方移除。 */
function spawnGravityBeam(start: { x: number; y: number }, end: { x: number; y: number }): HTMLElement | null {
  const dx = start.x - end.x;
  const dy = start.y - end.y;
  const dist = Math.hypot(dx, dy);
  if (dist < 10) return null;
  const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
  const beam = document.createElement('div');
  beam.className = 'fx-gravity-beam';
  beam.style.left = `${end.x}px`;
  beam.style.top = `${end.y}px`;
  beam.style.width = `${dist}px`;
  beam.style.setProperty('--fx-beam-angle', `${angle}deg`);
  beam.style.zIndex = String(EXTRA_Z);
  beam.appendChild(Object.assign(document.createElement('div'), { className: 'fx-gravity-beam-core' }));
  document.body.appendChild(beam);
  return beam;
}

/** gravity 浮层卡飞行（打牌堆顶 / 平移共用，FX-R1 时序重构）：浮层卡由调用方在【事件时】
 *  立即创建（旧位置 rect，z=BASE_Z 盖住真实卡——重渲染后真实卡瞬移到终点，但浮层卡始终
 *  占据旧位置，前置段黑洞/射线播完后才起飞，消除"先瞬移后特效"的观感），本函数只负责
 *  在 GRAVITY_PRE_MS + delayMs 起飞（playDeckPlay 同款 reflow 提交：先写 translate(0) 初始位
 *  并强制回流 → transition 必从起点动画）并调度自清理（品红光到终点后 1s 熄灭 → 移除，
 *  露出真实卡——位置一致无缝）。delayMs 用于同批多卡错开起飞（DECK_PLAY_STAGGER_MS 节奏）。 */
function flyGravityGhost(
  ghost: HTMLElement,
  rect: DOMRect,
  end: { x: number; y: number },
  delayMs: number,
): void {
  const dx = end.x - (rect.left + rect.width / 2);
  const dy = end.y - (rect.top + rect.height / 2);
  window.setTimeout(() => {
    // 先写初始位（translate(0) + 原朝向/尺寸）并强制回流提交 → 起飞 transition 必动画
    ghost.style.transition = `transform ${MOVE_MS}ms cubic-bezier(0.2, 0.7, 0.3, 1), opacity ${MOVE_MS}ms ease`;
    ghost.style.transform = `translate(0, 0) rotate(var(--fx-rot, 0deg)) scale(0.92)`;
    void ghost.offsetHeight; // 强制样式提交（reflow）
    requestAnimationFrame(() => {
      ghost.style.transform = `translate(${dx}px, ${dy}px) rotate(var(--fx-rot, 0deg)) scale(0.92)`;
      ghost.style.opacity = '0.6';
    });
  }, GRAVITY_PRE_MS + delayMs);
  window.setTimeout(
    () => ghost.remove(),
    GRAVITY_PRE_MS + delayMs + MOVE_MS + GRAVITY_CARDGLOW_LINGER_MS + GRAVITY_CARDGLOW_FADE_MS + 120,
  );
}

/** 事件时创建 gravity 浮层卡（旧位置 rect + 品红卡框光）——打牌堆顶 / 平移共用。
 *  卡框光动画（.fx-gravity-cardglow）以 --fx-gravity-glow-ms/--fx-gravity-glow-delay 内联
 *  注入：延迟 = GRAVITY_PRE_MS（前置段全程发光，backwards 填充保持 0% 帧），时长 =
 *  GRAVITY_GLOW_MS（飞行 + 到终点后 1s 熄灭）。返回浮层卡（调用方转交 flyGravityGhost）；
 *  构建失败（rect 归零等，实际不可达）返回 null。 */
function buildGravityGhost(rect: DOMRect, cw: boolean, ccw: boolean, payload: FxCardPayload): HTMLElement | null {
  const ghost = buildFxCardAt(rect, cw, ccw, payload, BASE_Z);
  if (!ghost) return null;
  ghost.classList.add('fx-gravity-cardglow');
  ghost.style.setProperty('--fx-gravity-glow-ms', `${GRAVITY_GLOW_MS}ms`);
  ghost.style.setProperty('--fx-gravity-glow-delay', `${GRAVITY_PRE_MS}ms`);
  return ghost;
}

/** gravity 牌堆顶打出附加特效（card:deck-played，反面打出牌堆顶——gravity-0/6、life-0/3、
 *  water-1；deck-played 事件不带 triggerProtocol，本分支即 gravity 特效）。
 *  FX-R1 时序重构：牌库区边框品红光 → 【事件时立即创建浮层卡】（旧位置 = 牌库区 rect，
 *  z=BASE_Z 盖住真实卡，带品红卡框光——不再等 1.8s 后才凭空出现）→ 终点黑洞 + 品红射线
 *  （前置 1.8s）→ 前置完成浮层卡飞向堆叠末尾（基础打出节奏）→ 收尾自清理。
 *  牌库/目标缺失 → 退回即时基础 playDeckPlay（无附加特效）。 */
function playGravityDeckPlayExtra(payload: FxCardPayload): void {
  if (payload.owner === undefined || payload.line == null) {
    playDeckPlay(payload);
    return;
  }
  // 捕获局部变量：闭包（定时器）内不做属性收窄，避免 TS 丢失 owner/line 的窄化
  const owner: PlayerId = payload.owner;
  const line: number = payload.line;
  const deck = document.querySelector<HTMLElement>(`.deck[data-player="${owner}"]`);
  const from = deckPos(owner);
  const slot = document.querySelector<HTMLElement>(`.stack-slot[data-player="${owner}"][data-line="${line}"]`);
  const end = stackEndPos(slot, owner);
  if (!deck || !from || !end) {
    playDeckPlay(payload); // 牌库/目标缺失 → 退回基础牌堆顶打出（无附加特效）
    return;
  }
  const start = { x: from.left + from.width / 2, y: from.top + from.height / 2 };
  // ② 立即创建浮层卡（旧位置 = 牌库区 rect）盖住真实卡 + 品红卡框光（前置段全程可见）
  const ghost = buildGravityGhost(from, false, false, payload);
  if (!ghost) {
    playDeckPlay(payload); // 浮层构建失败（实际不可达）→ 退回基础牌堆顶打出
    return;
  }
  // ① 牌库区边框品红光（body 级 fixed 层定位牌库 rect；随卡起飞渐隐）——ghost 成功后才建（防兜底泄漏）
  const deckGlow = document.createElement('div');
  deckGlow.className = 'fx-gravity-deckglow';
  deckGlow.style.left = `${from.left}px`;
  deckGlow.style.top = `${from.top}px`;
  deckGlow.style.width = `${from.width}px`;
  deckGlow.style.height = `${from.height}px`;
  deckGlow.style.zIndex = String(EXTRA_Z);
  document.body.appendChild(deckGlow);
  window.setTimeout(() => deckGlow.classList.add('fx-gravity-deckglow-in'), 20);
  ghost.classList.add('deck-play-ghost');
  // ③ 终点黑洞渐现（0~0.3s）；④ 品红射线（0.3~1.8s，黑洞 → 牌库区中心）
  const hole = spawnGravityHole(end);
  const beam = spawnGravityBeam(start, end);
  // ⑤ 前置段完成（1.8s）起：浮层卡飞向堆叠末尾（同批多卡按 90ms 错开起飞，同 playDeckPlay）
  const stagger = nextDeckPlayIndex() * DECK_PLAY_STAGGER_MS;
  flyGravityGhost(ghost, from, end, stagger);
  // ⑥ 收尾：牌库区光随卡起飞渐隐；卡到终点（PRE + MOVE_MS）后黑洞渐隐
  window.setTimeout(() => deckGlow.classList.add('fx-gravity-deckglow-out'), GRAVITY_PRE_MS);
  window.setTimeout(() => hole.classList.add('fx-gravity-hole-out'), GRAVITY_PRE_MS + MOVE_MS);
  window.setTimeout(() => deckGlow.remove(), GRAVITY_PRE_MS + GRAVITY_HOLE_OUT_MS + 60);
  window.setTimeout(() => hole.remove(), GRAVITY_PRE_MS + MOVE_MS + GRAVITY_HOLE_OUT_MS + 60);
  window.setTimeout(() => beam?.remove(), GRAVITY_PRE_MS + 80);
}

/** gravity 平移附加特效（card:shifted + triggerProtocol=gravity——gravity-1/2/4 的平移）。
 *  FX-R1 时序重构：【事件时立即创建浮层卡】（旧位置 rect，z=BASE_Z 盖住真实卡，带品红
 *  卡框光——重渲染后真实卡瞬移到终点，但浮层卡占据旧位置，用户只见"卡在原位被吸入"）→
 *  终点黑洞 + 品红射线（前置 1.8s）→ 前置完成浮层卡飞向目标堆叠末尾（基础平移节奏）→
 *  收尾自清理。rect/目标缺失 → 退回即时基础 playShift（无附加特效）。 */
function playGravityShiftExtra(node: HTMLElement, payload: FxCardPayload): void {
  const rect = node.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0 || payload.owner === undefined || payload.line == null) {
    playShift(node, payload);
    return;
  }
  const owner: PlayerId = payload.owner;
  const line: number = payload.line;
  const slot = document.querySelector<HTMLElement>(`.stack-slot[data-player="${owner}"][data-line="${line}"]`);
  const end = stackEndPos(slot, owner);
  if (!end) {
    playShift(node, payload);
    return;
  }
  const cw = node.classList.contains('rot-cw');
  const ccw = node.classList.contains('rot-ccw');
  const start = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  // ① 事件时立即创建浮层卡（旧位置 rect）盖住真实卡 + 品红卡框光（前置段全程可见）
  const ghost = buildGravityGhost(rect, cw, ccw, payload);
  if (!ghost) {
    playShift(node, payload); // 浮层构建失败（实际不可达）→ 退回基础平移
    return;
  }
  // ② 终点黑洞渐现（0~0.3s）；③ 品红射线（0.3~1.8s，黑洞 → 被移卡原 rect 中心）
  const hole = spawnGravityHole(end);
  const beam = spawnGravityBeam(start, end);
  // ④ 前置段完成（1.8s）起：浮层卡飞向目标堆叠末尾
  flyGravityGhost(ghost, rect, end, 0);
  // ⑤ 收尾：卡到终点（PRE + MOVE_MS）后黑洞渐隐
  window.setTimeout(() => hole.classList.add('fx-gravity-hole-out'), GRAVITY_PRE_MS + MOVE_MS);
  window.setTimeout(() => hole.remove(), GRAVITY_PRE_MS + MOVE_MS + GRAVITY_HOLE_OUT_MS + 60);
  window.setTimeout(() => beam?.remove(), GRAVITY_PRE_MS + 80);
}

/* ===== Speed 位移附加特效（用户 #7）：卡框灰白光 + 卡中心飓风 =====
 * 触发：card:shifted 与 card:drawn 且 triggerProtocol === 'speed'（speed-2/3/4 平移、speed-1 抽牌）。
 * 时序（总 ≈ 2.26s）：① 卡框灰白光 + 卡中心飓风渐现（0~0.3s）；② 整体沿起点→终点直线平移
 * （1.5s = SPEED_MOVE_MS，transition transform translate 路径、linear 匀速——平移终点=目标
 * 堆叠末尾，抽牌终点=该玩家手牌末尾 handEndPos）；④ 到达后飓风渐隐、卡框恢复（0.4s）。
 * FX-R1 时序重构（用户 #6b/#6a）：
 * - 平移（playSpeedShiftExtra）：事件时【立即创建浮层卡】（旧位置 rect，z=BASE_Z 盖住真实卡，
 *   卡面即时可见）+ 内嵌灰白光/飓风层（渐现 0.3s）→ 浮层卡随飓风整体平移（1.5s）→ 到达后
 *   渐隐 + 移除（露出真实卡，位置一致无缝）。【不再即时调用 playShift】——浮层卡代替基础飞行。
 * - 抽牌（playSpeedDrawExtra）：由 main.ts playDrawSequence 在基础抽牌动画【之前】调度
 *   （speed-1 顶「清理缓存后抽1张」），本函数只负责牌库区灰白光 + 飓风 → 手牌末尾。
 * 浮层 = body 级 fixed（抽牌场景 .fx-speed-glow 容器 / 平移场景浮层卡 + .fx-speed-card-glow
 * 覆盖层），内含 .fx-speed-tornado 螺旋锥形柱（4 层旋转椭圆带由宽到窄收成锥形 + 中心亮白
 * 气柱），整体 translate 平移，JS setTimeout 自清理。 */

/** 螺旋锥形柱飓风（4 层旋转椭圆带 + 中心亮白气柱），绝对定位于卡/容器中心 */
function buildSpeedTornado(): HTMLElement {
  const tornado = document.createElement('div');
  tornado.className = 'fx-speed-tornado';
  const BAND_COUNT = 4;
  for (let i = 0; i < BAND_COUNT; i++) {
    tornado.appendChild(Object.assign(document.createElement('div'), { className: 'fx-speed-band' }));
  }
  tornado.appendChild(Object.assign(document.createElement('div'), { className: 'fx-speed-core' }));
  return tornado;
}

/** speed 附加特效浮层主体（抽牌场景）：起点 rect（卡框光位置）与终点 end（位移终点）均由
 *  调用方在事件时捕获给定；容器整体沿起点→终点直线平移（translate 路径）。 */
function playSpeedExtra(
  rect: { left: number; top: number; width: number; height: number },
  start: { x: number; y: number },
  end: { x: number; y: number },
): void {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const fx = document.createElement('div');
  fx.className = 'fx-speed-glow';
  fx.style.left = `${rect.left}px`;
  fx.style.top = `${rect.top}px`;
  fx.style.width = `${rect.width}px`;
  fx.style.height = `${rect.height}px`;
  fx.style.zIndex = String(EXTRA_Z);
  fx.appendChild(buildSpeedTornado());
  document.body.appendChild(fx);
  // ① 卡框灰白光 + 飓风渐现（0.3s；延迟 20ms 保证初始 opacity:0 已被绘制）
  window.setTimeout(() => {
    fx.style.transition = 'opacity 0.3s ease-out';
    fx.style.opacity = '1';
  }, 20);
  // ② 整体沿起点→终点直线平移（1.5s，linear 匀速；保留 opacity 过渡使渐现完整结束）
  window.setTimeout(() => {
    fx.style.transition = 'opacity 0.3s ease-out, transform 1.5s linear';
    fx.style.transform = `translate(${dx}px, ${dy}px)`;
  }, SPEED_TORNADO_IN_MS);
  // ③ 收尾：到达后飓风渐隐、卡框恢复（0.4s 后自清理）
  window.setTimeout(() => {
    fx.style.transition = 'opacity 0.4s ease-in';
    fx.style.opacity = '0';
  }, SPEED_TORNADO_IN_MS + SPEED_MOVE_MS);
  window.setTimeout(() => fx.remove(), SPEED_TOTAL_MS);
}

/** speed 平移附加特效（card:shifted + triggerProtocol=speed，speed-2/3/4）——FX-R1 时序重构：
 *  事件时【立即创建浮层卡】（旧位置 rect，z=BASE_Z 盖住真实卡；重渲染后真实卡瞬移到终点，
 *  但浮层卡占据旧位置，用户只见卡在原位）→ 内嵌灰白光 + 飓风渐现（0.3s）→ 浮层卡随飓风
 *  沿起点→终点直线平移（1.5s）→ 到达后渐隐 + 移除（露出真实卡）。【不再调用基础 playShift】
 *  ——浮层卡代替基础飞行，消除"真实卡先瞬移、飓风后播"的时序错误。rect/目标缺失 → 无附加
 *  特效（引擎落地渲染，浮层无法替代时退化为直接显示）。 */
function playSpeedShiftExtra(node: HTMLElement, payload: FxCardPayload): void {
  const rect = node.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0 || payload.owner === undefined || payload.line == null) return;
  const owner: PlayerId = payload.owner;
  const line: number = payload.line;
  const slot = document.querySelector<HTMLElement>(`.stack-slot[data-player="${owner}"][data-line="${line}"]`);
  const end = stackEndPos(slot, owner);
  if (!end) return;
  const cw = node.classList.contains('rot-cw');
  const ccw = node.classList.contains('rot-ccw');
  // ① 事件时立即创建浮层卡（旧位置 rect，z=BASE_Z 盖住真实卡）：卡面即时可见，
  //    内嵌灰白光 + 飓风覆盖层（.fx-speed-card-glow，初始 opacity:0 → 0.3s 渐现）
  const ghost = buildFxCardAt(rect, cw, ccw, payload, BASE_Z);
  if (!ghost) return;
  ghost.classList.add('fx-speed-card'); // 重置清扫标记（render.ts resetUiState）
  ghost.style.willChange = 'transform, opacity';
  const glow = document.createElement('div');
  glow.className = 'fx-speed-card-glow';
  glow.appendChild(buildSpeedTornado());
  ghost.appendChild(glow);
  const start = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  // ①b 终点掩盖罩（与 gravity 黑洞对称——用户 #6b「到达前不露出真实卡」）：
  //    renderApp 后真实卡瞬移到终点，用灰白光罩盖住终点，浮层到达时渐隐露出真实卡
  const shroud = document.createElement('div');
  shroud.className = 'fx-speed-end-shroud';
  shroud.style.left = `${end.x - rect.width / 2}px`;
  shroud.style.top = `${end.y - rect.height / 2}px`;
  shroud.style.width = `${rect.width}px`;
  shroud.style.height = `${rect.height}px`;
  shroud.style.zIndex = String(EXTRA_Z);
  document.body.appendChild(shroud);
  // ② 灰白光 + 飓风渐现（0.3s；延迟 20ms 保证初始 opacity:0 已被绘制）
  window.setTimeout(() => {
    glow.style.transition = 'opacity 0.3s ease-out';
    glow.style.opacity = '1';
    shroud.style.transition = 'opacity 0.3s ease-out';
    shroud.style.opacity = '1';
  }, 20);
  // ③ 浮层卡随飓风沿起点→终点直线平移（1.5s，linear 匀速；组合 --fx-rot 保留横置卡朝向）
  window.setTimeout(() => {
    ghost.style.transition = 'transform 1.5s linear';
    ghost.style.transform = `translate(${dx}px, ${dy}px) rotate(var(--fx-rot, 0deg))`;
  }, SPEED_TORNADO_IN_MS);
  // ④ 到达后：飓风/终点罩渐隐 + 浮层卡整体渐隐（露出真实卡，位置一致无缝）→ 自清理
  window.setTimeout(() => {
    ghost.style.transition = 'opacity 0.4s ease-in';
    ghost.style.opacity = '0';
    shroud.style.transition = 'opacity 0.4s ease-in';
    shroud.style.opacity = '0';
  }, SPEED_TORNADO_IN_MS + SPEED_MOVE_MS);
  window.setTimeout(() => ghost.remove(), SPEED_TOTAL_MS);
  window.setTimeout(() => shroud.remove(), SPEED_TOTAL_MS);
}

/** card:drawn 载荷（无 uid/defId：抽牌无目标卡节点，特效按 player 定位手牌/牌库；speed/love 共用） */
interface DrawPayload {
  player: PlayerId;
  count: number;
  fromOpponentDeck?: boolean;
  triggerProtocol?: string;
}

/** speed 抽牌附加特效（card:drawn + triggerProtocol=speed，speed-1 顶「清理缓存后抽1张」）：
 *  牌库区灰白光（抽出的卡在牌堆顶）+ 飓风从牌库区中心 → 该玩家手牌末尾 handEndPos。
 *  FX-R1 时序重构：本函数由 main.ts playDrawSequence 在【基础抽牌动画之前】调度（speed 抽牌
 *  专属先播、draw-ghost 基础飞入顺延到 SPEED_TOTAL_MS 之后），故不再从 card:drawn 事件时
 *  即时播放（避免与 main.ts 调度双播/时序错位）。牌库/手牌缺失 → 跳过（基础抽牌照常）。 */
export function playSpeedDrawExtra(payload: DrawPayload): void {
  const deck = deckPos(payload.player);
  const hand = document.querySelectorAll<HTMLElement>('.hand')[payload.player];
  if (!deck || !hand) return; // 牌库/手牌缺失 → 跳过（基础抽牌仍由 main.ts 播放）
  playSpeedExtra(
    { left: deck.left, top: deck.top, width: deck.width, height: deck.height },
    { x: deck.left + deck.width / 2, y: deck.top + deck.height / 2 },
    handEndPos(hand, payload.player),
  );
}

/* ===== Love 爱附加特效（FX-4，用户 #8）：粉红爱心（抽牌/给牌/揭示） =====
 * 触发：card:drawn / card:given / card:revealed 且 triggerProtocol === 'love'
 * （love-1 中抽对手牌堆顶/底给牌后抽 2、love-2 对手抽+刷新、love-3 随机拿牌+给牌、
 *  love-4 揭示自己手牌、love-6 对手抽 2）。
 * 时序常量（CSS 侧 .fx-love-* 注释标注）：
 * - 抽牌（playLoveDrawExtra）：① 牌库区边框粉红光芒（LOVE_GLOW_MS = 2s 后渐隐消失）；
 *   ② 抽出的卡边框粉红光芒 + 卡背爱心跳动由 main.ts playDrawAnimation 的 love 分支挂在
 *   draw-ghost 上（飞行期间跳动，随幽灵清理）；③ 手牌末尾落点爱心在抽牌卡落地时刻出现
 *   （起飞错开 LOVE_STAGGER_MS + 飞行 LOVE_FLIGHT_MS，与 main.ts 同节奏），闪烁 2s 后消失。
 * - 给牌/收牌（playLoveGiveExtra）：① 所选手牌边框粉红光芒 + 卡面爱心（跳动，重渲染前
 *   可见）；② 交换基础特效（buildFxCard + translate 平移 MOVE_MS，同 playHandPlay）——卡
 *   带粉红光 + 爱心从源卡 rect 飞向接收方手牌末尾 handEndPos（对方给你时同款：payload.to
 *   决定方向）；③ 到达后落点边框 + 爱心持续 LOVE_AFTER_MS = 2s 后渐隐消失。
 * - 揭示（love-4 Case A 幽灵给对方）：落地幽灵 .fx-love-ghost 粉红边框辉光 + 中间爱心跳动，
 *   持续时间 = 幽灵存在期间（render.ts 渲染时读 RevealedGhost.fx 挂类，移除随 DOM 消失）。 */

const LOVE_GLOW_MS = 2000;      // 抽牌：牌库区粉红光芒 / 落点爱心持续时间（2s）
const LOVE_AFTER_MS = 2000;     // 给牌：到达后落点边框+爱心持续时间（2s）
const LOVE_CARD_W = 130;        // 落点盒尺寸（与手牌卡一致 130×178.8）
const LOVE_CARD_H = 178.8;
const LOVE_STAGGER_MS = 120;    // 与 main.ts draw-ghost 起飞错开间隔一致
const LOVE_FIRST_TAKEOFF_MS = 30; // 与 main.ts 首张起飞延迟一致
const LOVE_FLIGHT_MS = 250;     // 与 .draw-ghost transition 0.25s 飞行时长一致
const LOVE_FADE_MS = 400;       // 粉红光/落点爱心渐隐时长（CSS 过渡 0.4s）

/** 粉红爱心元素（.fx-love-heart：CSS 两圆+三角形状、快速跳动 pulse）——绝对定位居中于
 *  父容器（.card 相对定位 / body 级 fixed 容器自身定位）。导出供 main.ts 抽牌 love 分支
 *  给 draw-ghost 卡背挂爱心（类名单一来源）。 */
export function buildLoveHeart(): HTMLElement {
  const heart = document.createElement('div');
  heart.className = 'fx-love-heart';
  return heart;
}

/** love 抽牌附加特效（card:drawn + triggerProtocol=love——love-1/2/6 及 love 刷新，含对手抽）：
 *  牌库区边框粉红光芒（body 级 fixed 层定位牌库 rect，2s 后渐隐）+ 手牌末尾落点爱心（抽牌卡
 *  落地时刻出现，闪烁 2s 后消失）。抽出的卡背爱心/粉红边框由 main.ts 抽牌动画 love 分支挂
 *  在 draw-ghost 上（本附加层独立，不干预 pendingDraws 调度）。 */
function playLoveDrawExtra(payload: DrawPayload): void {
  const deck = deckPos(payload.player);
  const hand = document.querySelectorAll<HTMLElement>('.hand')[payload.player];
  if (!deck || !hand) return; // 牌库/手牌缺失 → 跳过（基础抽牌仍由 main.ts 播放）
  // ① 牌库区边框粉红光芒（随抽牌持续 2s 后渐隐消失）
  const glow = document.createElement('div');
  glow.className = 'fx-love-deckglow';
  glow.style.left = `${deck.left}px`;
  glow.style.top = `${deck.top}px`;
  glow.style.width = `${deck.width}px`;
  glow.style.height = `${deck.height}px`;
  glow.style.zIndex = String(EXTRA_Z);
  document.body.appendChild(glow);
  window.setTimeout(() => glow.classList.add('fx-love-deckglow-in'), 20);
  window.setTimeout(() => glow.classList.add('fx-love-deckglow-out'), LOVE_GLOW_MS);
  window.setTimeout(() => glow.remove(), LOVE_GLOW_MS + LOVE_FADE_MS + 60);
  // ③ 手牌末尾落点爱心：抽牌卡落地时刻（main.ts 首张 30ms 起飞 + 逐张 120ms 错开 + 250ms
  // 飞行）出现，闪烁 2s 后渐隐消失
  const target = handEndPos(hand, payload.player);
  window.setTimeout(() => {
    const settle = document.createElement('div');
    settle.className = 'fx-love-settle';
    settle.style.left = `${target.x - LOVE_CARD_W / 2}px`;
    settle.style.top = `${target.y - LOVE_CARD_H / 2}px`;
    settle.style.width = `${LOVE_CARD_W}px`;
    settle.style.height = `${LOVE_CARD_H}px`;
    settle.style.zIndex = String(EXTRA_Z);
    settle.appendChild(buildLoveHeart());
    document.body.appendChild(settle);
    window.setTimeout(() => settle.classList.add('fx-love-settle-out'), LOVE_GLOW_MS);
    window.setTimeout(() => settle.remove(), LOVE_GLOW_MS + LOVE_FADE_MS + 60);
  }, LOVE_FIRST_TAKEOFF_MS + Math.max(0, payload.count - 1) * LOVE_STAGGER_MS + LOVE_FLIGHT_MS);
}

/** love 给牌/收牌附加特效（card:given + triggerProtocol=love——love-1 底给牌、love-3 给牌与
 *  随机拿牌；payload.to = 接收方，uid 对应卡此刻仍在【给牌方】手牌 DOM 中——重渲染前）：
 *  ① 所选手牌边框粉红光芒 + 卡面爱心跳动（源卡节点）；
 *  ② 交换基础特效：buildFxCard 克隆卡带粉红光 + 爱心，从源卡 rect 平移（MOVE_MS，同
 *  playHandPlay）飞向接收方手牌末尾 handEndPos——对方给你时同款（payload.to 决定方向）；
 *  ③ 到达后落点边框 + 爱心持续 LOVE_AFTER_MS(2s) 后渐隐消失；源卡光芒/爱心随重渲染消失
 *  （未重建时 2s 后定时器兜底移除）。全部浮层 pointer-events:none、JS 定时自清理。 */
function playLoveGiveExtra(node: HTMLElement, payload: FxCardPayload): void {
  const rect = node.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0 || payload.to === undefined) return;
  // ① 所选手牌：边框粉红光芒 + 卡面爱心（跳动；重渲染会重建 DOM 移除，-cardglow 类不动 DOM 结构）
  node.classList.add('fx-love-cardglow');
  node.appendChild(buildLoveHeart());
  // ② 交换基础特效：克隆卡（EXTRA_Z）带粉红光 + 爱心飞向接收方手牌末尾
  const clone = buildFxCard(node, payload, EXTRA_Z);
  if (clone) {
    clone.classList.add('fx-love-fly');
    clone.appendChild(buildLoveHeart());
    const hand = document.querySelectorAll<HTMLElement>('.hand')[payload.to];
    const target = handEndPos(hand, payload.to);
    const dx = target.x - (rect.left + rect.width / 2);
    const dy = target.y - (rect.top + rect.height / 2);
    clone.style.transition = `transform ${MOVE_MS}ms cubic-bezier(0.2, 0.7, 0.3, 1), opacity ${MOVE_MS}ms ease`;
    requestAnimationFrame(() => {
      // 组合 --fx-rot（手牌无 rot 类 → 恒 0deg，与 playHandPlay 一致）
      clone.style.transform = `translate(${dx}px, ${dy}px) rotate(var(--fx-rot, 0deg)) scale(0.92)`;
      clone.style.opacity = '0.6';
    });
    // ③ 到达后：落点边框 + 爱心（2s 后渐隐消失）
    window.setTimeout(() => {
      const settle = document.createElement('div');
      settle.className = 'fx-love-settle';
      settle.style.left = `${target.x - LOVE_CARD_W / 2}px`;
      settle.style.top = `${target.y - LOVE_CARD_H / 2}px`;
      settle.style.width = `${LOVE_CARD_W}px`;
      settle.style.height = `${LOVE_CARD_H}px`;
      settle.style.zIndex = String(EXTRA_Z);
      settle.appendChild(buildLoveHeart());
      document.body.appendChild(settle);
      window.setTimeout(() => settle.classList.add('fx-love-settle-out'), LOVE_AFTER_MS);
      window.setTimeout(() => settle.remove(), LOVE_AFTER_MS + LOVE_FADE_MS + 60);
    }, MOVE_MS);
    window.setTimeout(() => clone.remove(), MOVE_MS + 80);
  }
  // 源卡光芒/爱心：重渲染会重建 DOM 移除源卡（光芒随之消失）；未重建时 2s 后兜底清理
  const cleanSource = (): void => {
    node.classList.remove('fx-love-cardglow');
    node.querySelector('.fx-love-heart')?.remove();
  };
  window.setTimeout(cleanSource, LOVE_AFTER_MS + LOVE_FADE_MS + 60);
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
 * - 额外协议特效：由触发卡协议（triggerProtocol）决定是否叠加（fire → 火焰焚烧；light → 白色柔光；
 *   darkness → 暗紫粒子；death → 镰刀+骷髅；hate → 五指抓握+血泊——后两者仅叠加在删去上，
 *   且【前置段先播、基础破碎延后】由附加函数内部调度）
 * - 卡面用【当前卡牌面】构建，不克隆原卡 DOM
 */
export function initEffects(): () => void {
  return gameBus.subscribe((e: GameEvent) => {
    // card:drawn 无 uid/defId（payload = { player, count, fromOpponentDeck?, triggerProtocol }），
    // 需在 uid/defId 守卫之前处理：speed 抽牌专属（牌库区灰白光 + 飓风 → 手牌末尾）由 main.ts
    // playDrawSequence 在基础抽牌动画【之前】统一调度（FX-R1 时序重构，见 playSpeedDrawExtra
    // 注释——避免事件时即时播放与 main.ts 调度双播/时序错位）；love 抽牌附加特效（牌库区粉红
    // 光芒 + 手牌末尾落点爱心；抽出的卡背爱心由 main.ts playDrawAnimation love 分支挂 draw-ghost）
    // 与 metal-1 链路边框光仍在事件时即时播放。
    if (e.type === 'card:drawn') {
      const p = e.payload as { player: PlayerId; count: number; triggerProtocol?: string } | undefined;
      if (p && p.triggerProtocol === 'love') playLoveDrawExtra(p);
      else if (p && p.triggerProtocol === 'metal') playMetalLineGlow(p.player);
      return;
    }
    const payload = e.payload as FxCardPayload | undefined;
    if (!payload?.uid || !payload.defId) return;
    const node = document.querySelector<HTMLElement>(`[data-uid="${payload.uid}"]`);
    switch (e.type) {
      case 'card:discarded':
        // psychic/plague 弃牌附加特效带【前置段 → 延后基础切割 → 收尾消散】时序：
        // 基础 playCut 由附加函数内部延后调度（playPsychicDiscardExtra/playPlagueDiscardExtra
        // 在 PSYCHIC_PRE_MS/PLAGUE_PRE_MS 调 playCutAt）；其余协议保持即时切割 + 附加叠加
        if (node) {
          if (payload.triggerProtocol === 'psychic') playPsychicDiscardExtra(node, payload);
          else if (payload.triggerProtocol === 'plague') playPlagueDiscardExtra(node, payload);
          else playCut(node, payload);
        }
        break;
      case 'card:deleted':
        // death/hate 的删除附加特效带【前置段 → 延后破碎 → 收尾段】时序：基础破碎由附加函数
        // 内部延后调度（playDeathDeleteExtra/playHateDeleteExtra 在 DEATH_PRE_MS/HATE_PRE_MS
        // 调 playShatterAt），此处跳过即时破碎；其余协议（fire/light/darkness/system）保持
        // 即时破碎 + 附加叠加
        if (node && payload.triggerProtocol !== 'death' && payload.triggerProtocol !== 'hate') {
          playShatter(node, payload);
        }
        break;
      case 'card:flipped':
        // life 协议触发的翻转（life-1/life-2 及未来生命翻转）：绿色藤蔓缠绕 + 绿光；
        // apathy 协议触发的翻转（apathy-1/2/3/4）：边框灰光 + 双边灰雾（基础翻面即时播放，
        // 灰雾期间一直在）；
        // 其余翻转源（water-0 带 'water'、系统效果带 'system'）走基础翻面
        if (node) {
          if (payload.triggerProtocol === 'life') playLifeFlip(node, payload);
          else if (payload.triggerProtocol === 'apathy') playApathyFlipExtra(node, payload);
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
        // 按触发卡协议分流：darkness（darkness-0/1/4）→ 烟桥路线；gravity（gravity-1/2/4）
        // → 品红黑洞+射线（延后基础平移）；speed（speed-2/3/4）→ 灰白卡框光+飓风；
        // 其余偏转源（light-2/light-3 带 'light'、系统效果带 'system'）走普通幽灵飞行
        if (node) {
          if (payload.triggerProtocol === 'darkness') playDarknessShiftBridge(node, payload);
          else if (payload.triggerProtocol === 'gravity') playGravityShiftExtra(node, payload);
          else if (payload.triggerProtocol === 'speed') playSpeedShiftExtra(node, payload);
          else playShift(node, payload);
        }
        break;
      case 'card:deck-played':
        // 反面打出牌堆顶：仅 gravity 触发源（gravity-0/6）播品红牌库框光 + 终点黑洞 + 品红射线
        // （前置段后延后基础打出）；life-0/3、water-1 的打牌堆顶走基础打出（不误播重力特效）
        if (payload.triggerProtocol === 'gravity') playGravityDeckPlayExtra(payload);
        else playDeckPlay(payload);
        break;
      case 'card:hand-played':
        // playFromHand：从手牌中该卡的 rect 起飞飞入目标线堆叠末尾（区别于牌堆顶打出）
        playHandPlay(payload);
        break;
      case 'card:given':
        // love 协议给牌/收牌（love-1 底给牌、love-3 给牌与随机拿牌——give/takeRandom op 均发
        // card:given）：所选手牌粉红边框光 + 卡面爱心 → 交换基础特效（克隆卡飞向对方手牌末尾）
        // → 落点爱心 2s。其余协议无给牌 → 落空无事
        if (node && payload.triggerProtocol === 'love') playLoveGiveExtra(node, payload);
        break;
      default:
        return;
    }
    // 额外协议特效（触发卡协议驱动，叠加上层；仅弃牌/删去走此块）：
    // fire → 火焰焚烧；light → 白色柔光；darkness → 暗紫粒子。
    // death/hate 仅叠加在删去上（card:deleted，前置段先播、破碎延后——见各自函数）。
    // psychic/plague 仅叠加在弃牌上（card:discarded，前置段先播、切割延后——已在
    // card:discarded 分支内分流，不落到本块）。water（回手水波环）/life（翻转藤蔓）在
    // 各自分支内叠加（card:returned / card:flipped），不属于本块——其余协议触发时
    // 落到此处 = 无额外特效。
    if ((e.type === 'card:discarded' || e.type === 'card:deleted') && node) {
      if (payload.triggerProtocol === 'fire') {
        playFireBurnExtra(node, payload);
      } else if (payload.triggerProtocol === 'light') {
        playLightExtra(node, payload);
      } else if (payload.triggerProtocol === 'darkness') {
        playDarknessExtra(node, payload);
      } else if (e.type === 'card:deleted' && payload.triggerProtocol === 'death') {
        playDeathDeleteExtra(node, payload);
      } else if (e.type === 'card:deleted' && payload.triggerProtocol === 'hate') {
        playHateDeleteExtra(node, payload);
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
