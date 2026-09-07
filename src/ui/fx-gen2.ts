/**
 * 2代 协议专属特效（fx-gen2 模块）：与 effects/index.ts（1代 + 基础行为 FX）分离，
 * 按协议文件逐个注册。所有层 body 级 fixed + pointer-events:none，JS 定时自清理；
 * 应用内重置时由 clearGen2Fx() 清扫（main.ts resetToMainInterface 调用）。
 *
 * 当前实现（按二代特效提示词.txt 顺序）：
 *  - luck（幸运）：宣告效果骰子 → 成功橙圆+烟花+666/888 / 失败红蘑菇云+囧
 *    （骰子起转由 render.ts 在宣告 prompt 渲染期调用 startLuckDiceFx；luck:roll 引擎事件
 *      判定成败，payload uid/defId/player/success）
 */

import { gameBus } from '../core/events/bus';
import type { GameEvent } from '../core/events/bus';
import { cardImgSrc } from '../data/demo';

type PlayerId = 0 | 1;

/** 卡面 URL（正面官方图；复制虚影恒显示被复制卡正面——公开信息） */
function cardFaceUrl(defId: string): string {
  const [proto, value] = defId.split('-');
  return cardImgSrc(proto, value);
}

/** 骰子层 z：卡面/选择条之上（瞬态宣告 FX），但低于放大遮罩（1000+） */
const GEN2_Z = 600;

/** 活跃的 luck 骰子层（key = 源卡 uid：startLuckDiceFx 创建、luck:roll 消费并自清理） */
const luckDiceLayers = new Map<string, HTMLElement>();

/** 事件 payload 里的 uid/defId/player/success（luck 引擎 emit，见 core/effects/cards/luck.ts） */
interface LuckPayload {
  uid: string;
  defId: string;
  player: PlayerId;
  success?: boolean;
}

/** 按 uid 定位源卡节点中心（节点可能已在重渲染后被替换——事件在行动结算中 emit，
 *  骰子层创建时 DOM 还是旧布局；roll 消费时同 uid 查表无需再定位） */
function cardCenterByUid(uid: string): { x: number; y: number } | null {
  const node = document.querySelector<HTMLElement>(`[data-uid="${uid}"]`);
  if (!node) return null;
  const r = node.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return null;
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

/** body 级瞬态层容器（居中锚点）：定位到 (x,y) 中心的 fixed 层，自清理回调可选 */
function spawnLayer(x: number, y: number, cls: string, w: number, h: number): HTMLElement {
  const layer = document.createElement('div');
  layer.className = cls;
  layer.style.cssText =
    `position:fixed;left:${(x - w / 2).toFixed(1)}px;top:${(y - h / 2).toFixed(1)}px;` +
    `width:${w}px;height:${h}px;z-index:${GEN2_Z};pointer-events:none;`;
  document.body.appendChild(layer);
  return layer;
}

/* ============================== luck 幸运：宣告骰子 ==============================
 * 时序（CSS 侧 .fx-luck-* 注释标注）：
 * ① startLuckDiceFx（render.ts 宣告 prompt 渲染期调用）：源卡中心出现骰子（橙色方块 +
 *    白点，3D 翻滚）+ 橙色半透明发光圆底；持续转动直到用户选择数字/协议；
 * ② roll(success)：骰子停止翻滚 → 收缩变成橙色实心圆（0.35s）→ 保持 1s → 原地消失，
 *    同时放出几朵小型橙红烟花（多组火星向外飞散渐隐）+ 爆出「666」或「888」橙色透明字样；
 * ③ roll(fail)：骰子停止 → 快速缩小消失 → 原地爆炸红色蘑菇云（柱 + 顶盖 blob 扩散）+
 *    爆出「囧」字样。
 * 层以源卡 uid 为键；roll 消费后整体自清理（reset 由 clearGen2Fx 兜底）。 */

/** 骰子尺寸 */
const DICE_W = 76;
const DICE_H = 76;
/** 底光直径 */
const GLOW_W = 150;
/** 成功：橙圆保持时长（提示词「1秒后在原地消失」） */
const SUCCESS_HOLD_MS = 1000;
/** 烟花粒子飞行时长（CSS transition 同步） */
const FW_FLY_MS = 900;
/** 结果字样停留时长 */
const MSG_HOLD_MS = 1600;

/** 创建骰子核心：橙方块 + 5 点（骰子 5 面观感，白点 box-shadow 阵列） */
function buildDiceCore(): HTMLElement {
  const core = document.createElement('div');
  core.className = 'fx-luck-dice-core';
  for (let i = 0; i < 5; i++) {
    const pip = document.createElement('i');
    pip.className = `fx-luck-pip p${i + 1}`;
    core.appendChild(pip);
  }
  return core;
}

/** 放烟花：中心 (cx,cy) 放出 count 组火星（每组小簇，随机方向/距离），全部渐隐自清理 */
function spawnFireworks(cx: number, cy: number, count = 6): void {
  for (let g = 0; g < count; g++) {
    // 每簇 8-12 颗火星，绕随机中心角展开
    const sparks = 8 + Math.floor(Math.random() * 5);
    const baseAng = Math.random() * Math.PI * 2;
    const centerDist = 26 + Math.random() * 34;
    const centerX = cx + Math.cos(baseAng) * centerDist;
    const centerY = cy + Math.sin(baseAng) * centerDist;
    for (let s = 0; s < sparks; s++) {
      const ang = (s / sparks) * Math.PI * 2 + (Math.random() - 0.5) * 0.5;
      const dist = 34 + Math.random() * 52;
      const size = 5 + Math.random() * 5;
      const p = document.createElement('i');
      p.className = 'fx-luck-spark';
      p.style.width = `${size.toFixed(1)}px`;
      p.style.height = `${size.toFixed(1)}px`;
      p.style.left = `${centerX.toFixed(1)}px`;
      p.style.top = `${centerY.toFixed(1)}px`;
      p.style.setProperty('--fx-dx', `${(Math.cos(ang) * dist).toFixed(1)}px`);
      p.style.setProperty('--fx-dy', `${(Math.sin(ang) * dist).toFixed(1)}px`);
      p.style.animationDelay = `${(Math.random() * 0.1).toFixed(2)}s`;
      document.body.appendChild(p);
      window.setTimeout(() => p.remove(), FW_FLY_MS + 160);
    }
  }
}

/** 爆大字样（成功 666/888 / 失败 囧）：从骰子中心炸出 → 停留 → 渐隐自清理 */
function spawnResultText(cx: number, cy: number, text: string, cls: string): void {
  const t = document.createElement('div');
  t.className = `fx-luck-msg ${cls}`;
  t.textContent = text;
  t.style.left = `${cx.toFixed(1)}px`;
  t.style.top = `${cy.toFixed(1)}px`;
  document.body.appendChild(t);
  window.setTimeout(() => t.classList.add('out'), MSG_HOLD_MS);
  window.setTimeout(() => t.remove(), MSG_HOLD_MS + 500);
}

/** 红色蘑菇云：柱 + 顶盖 blob（scale 爆炸扩散），自清理 */
function spawnMushroom(cx: number, cy: number): void {
  const m = document.createElement('div');
  m.className = 'fx-luck-mushroom';
  m.style.left = `${cx.toFixed(1)}px`;
  m.style.top = `${cy.toFixed(1)}px`;
  const stem = document.createElement('i');
  stem.className = 'fx-luck-mushroom-stem';
  const cap = document.createElement('i');
  cap.className = 'fx-luck-mushroom-cap';
  m.appendChild(stem);
  m.appendChild(cap);
  document.body.appendChild(m);
  // 爆炸后整体渐隐移除
  window.setTimeout(() => m.classList.add('out'), 750);
  window.setTimeout(() => m.remove(), 1350);
}

/** 骰子创建（幂等）：源卡中心出现骰子层（持续 3D 翻滚 + 橙光底）。由 render.ts 在宣告
 *  prompt（select-action 标题 luck-0/luck-3 宣告）渲染期调用——此时源卡已在场 DOM。
 *  重复调用（choice-bar 每帧重渲染）只重新定位不重建。 */
export function startLuckDiceFx(uid: string): void {
  if (!uid) return;
  const center = cardCenterByUid(uid);
  if (!center) return;
  const existing = luckDiceLayers.get(uid);
  if (existing) {
    // 已有层：重新定位（源卡位置可能随渲染变化，骰子应跟随）
    existing.style.left = `${(center.x - DICE_W / 2).toFixed(1)}px`;
    existing.style.top = `${(center.y - DICE_H / 2).toFixed(1)}px`;
    const glow = (existing as HTMLElement & { _glow?: HTMLElement })._glow;
    if (glow) {
      glow.style.left = `${(center.x - GLOW_W / 2).toFixed(1)}px`;
      glow.style.top = `${(center.y - GLOW_W / 2).toFixed(1)}px`;
    }
    return;
  }
  const layer = spawnLayer(center.x, center.y, 'fx-luck-dice', DICE_W, DICE_H);
  const glow = document.createElement('div');
  glow.className = 'fx-luck-dice-glow';
  glow.style.width = `${GLOW_W}px`;
  glow.style.height = `${GLOW_W}px`;
  glow.style.left = `${(center.x - GLOW_W / 2).toFixed(1)}px`;
  glow.style.top = `${(center.y - GLOW_W / 2).toFixed(1)}px`;
  glow.style.zIndex = String(GEN2_Z - 1);
  layer.appendChild(buildDiceCore());
  document.body.appendChild(glow);
  (layer as HTMLElement & { _glow?: HTMLElement })._glow = glow;
  luckDiceLayers.set(uid, layer);
  // 启动翻滚动画（CSS animation infinite，加类延迟一帧保证初始态已绘制）
  requestAnimationFrame(() => layer.classList.add('rolling'));
}

/** luck:roll → 停止并播放成败结果 */
function onLuckRoll(p: LuckPayload): void {
  const layer = p.uid ? luckDiceLayers.get(p.uid) : undefined;
  if (!layer) return; // 层不存在（如已被重置）→ 跳过
  const rect = layer.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const glow = (layer as HTMLElement & { _glow?: HTMLElement })._glow;
  if (p.success) {
    // 成功：停翻滚 → 收缩成橙色实心圆（保持 1s）→ 原地消失 → 烟花 + 666/888
    layer.classList.remove('rolling');
    layer.classList.add('success');
    window.setTimeout(() => {
      layer.classList.add('gone'); // 橙圆淡出
      if (glow) glow.classList.add('gone');
      spawnFireworks(cx, cy);
      spawnResultText(cx, cy, Math.random() < 0.5 ? '666' : '888', 'good');
    }, SUCCESS_HOLD_MS);
  } else {
    // 失败：停翻滚 → 快速缩小消失 → 红蘑菇云 + 囧
    layer.classList.remove('rolling');
    layer.classList.add('fail');
    window.setTimeout(() => {
      layer.classList.add('gone');
      if (glow) glow.classList.add('gone');
      spawnMushroom(cx, cy);
      spawnResultText(cx, cy, '囧', 'bad');
    }, 350);
  }
  window.setTimeout(() => {
    layer.remove();
    if (glow) glow.remove();
    luckDiceLayers.delete(p.uid);
  }, SUCCESS_HOLD_MS + FW_FLY_MS + MSG_HOLD_MS + 700);
}

/** 应用内重置清扫（main.ts resetToMainInterface 调用）：移除全部 fx-gen2 瞬态层 */
export function clearGen2Fx(): void {
  for (const layer of luckDiceLayers.values()) {
    const glow = (layer as HTMLElement & { _glow?: HTMLElement })._glow;
    if (glow) glow.remove();
    layer.remove();
  }
  luckDiceLayers.clear();
  for (const eye of clarityDeckEyes.values()) eye.remove();
  clarityDeckEyes.clear();
  for (const el of document.querySelectorAll<HTMLElement>(
    '.fx-luck-spark, .fx-luck-msg, .fx-luck-mushroom, .fx-mirror-copy-ghost, ' +
      '.fx-mirror-copy-flash, .fx-peace-dove, .fx-peace-card, .fx-chaos-vortex-draw, ' +
      '.fx-chaos-vortex-discard, .fx-chaos-card, .fx-clarity-eye, .fx-clarity-deck-eye, .fx-clarity-card-eye'
  )) {
    el.remove();
  }
}

/* ============================== mirror 明镜：复制虚影 ==============================
 * card:copied 事件（引擎 copyMiddle op 发出，payload uid=被复制卡、copiedToUid=复制者
 * 源卡 mirror-1）：被复制卡虚影（幽灵牌）从被复制卡位置缓缓浮现 → 飘向 mirror-1 位置 →
 * 与其融合后发出一道耀眼光芒并消失。事件在引擎 push 复制效果后同步 emit（DOM 未重渲染，
 * 两卡节点此刻都在场）→ rect 在事件时捕获；飞行全程 body 级浮层，重渲染不受影响。 */

const MIRROR_COPY_IN_MS = 380;   // 虚影浮现（从被复制卡位置渐显 + 微上浮）
const MIRROR_COPY_FLY_MS = 820;  // 飘向 mirror-1（缓动）
const MIRROR_COPY_FLASH_MS = 420; // 融合闪光（到达后白芒扩散渐隐）

/** 幽灵卡：卡面 = 被复制卡正面，fixed 定位于 rect，初始不可见（浮现用） */
function buildCopyGhost(defId: string, r: DOMRect): HTMLElement {
  const ghost = document.createElement('div');
  ghost.className = 'fx-mirror-copy-ghost';
  ghost.style.left = `${r.left}px`;
  ghost.style.top = `${r.top}px`;
  ghost.style.width = `${r.width}px`;
  ghost.style.height = `${r.height}px`;
  ghost.style.zIndex = String(GEN2_Z);
  const img = document.createElement('img');
  img.src = cardFaceUrl(defId);
  img.style.cssText =
    'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block;border-radius:6px;';
  ghost.appendChild(img);
  document.body.appendChild(ghost);
  return ghost;
}

/** 融合闪光：到达 mirror-1 位置后扩散一圈白光并渐隐 */
function spawnCopyFlash(x: number, y: number, w: number, h: number): void {
  const flash = document.createElement('div');
  flash.className = 'fx-mirror-copy-flash';
  flash.style.left = `${x - w / 2}px`;
  flash.style.top = `${y - h / 2}px`;
  flash.style.width = `${w}px`;
  flash.style.height = `${h}px`;
  flash.style.zIndex = String(GEN2_Z + 1);
  document.body.appendChild(flash);
  window.setTimeout(() => flash.remove(), MIRROR_COPY_FLASH_MS + 260);
}

/** card:copied → 虚影从被复制卡飞向 mirror-1（复制者源卡）融合闪光 */
function onMirrorCopy(p: { uid?: string; defId?: string; copiedToUid?: string }): void {
  if (!p.uid || !p.defId || !p.copiedToUid) return;
  const fromNode = document.querySelector<HTMLElement>(`[data-uid="${p.uid}"]`);
  const toNode = document.querySelector<HTMLElement>(`[data-uid="${p.copiedToUid}"]`);
  if (!fromNode || !toNode) return; // 节点缺失（理论不可达——两卡在场）→ 跳过
  const from = fromNode.getBoundingClientRect();
  const to = toNode.getBoundingClientRect();
  if (from.width === 0 || from.height === 0 || to.width === 0 || to.height === 0) return;
  const ghost = buildCopyGhost(p.defId, from);
  // ① 浮现：初始透明度 0、微下沉 → 渐显 + 上浮（同 buildFxCard 的 rect 居中旋转不适用——
  // 被复制卡若为场上横置卡，虚影按未旋转布局盒处理即可，卡面保持竖版读取更清晰）
  ghost.style.opacity = '0';
  ghost.style.transition = 'opacity 0.38s ease-out';
  requestAnimationFrame(() => {
    ghost.style.opacity = '0.9';
  });
  // ② 浮现完成 → 飘向 mirror-1 中心（translate 过渡；目标 = 源 rect 中心 → mirror-1 rect 中心）
  const gx = from.left + from.width / 2;
  const gy = from.top + from.height / 2;
  const tx = to.left + to.width / 2;
  const ty = to.top + to.height / 2;
  const dx = tx - gx;
  const dy = ty - gy;
  window.setTimeout(() => {
    ghost.style.transition = `transform ${MIRROR_COPY_FLY_MS}ms cubic-bezier(0.2, 0.7, 0.3, 1), opacity ${MIRROR_COPY_FLY_MS}ms ease`;
    ghost.style.transform = `translate(${dx}px, ${dy}px) scale(0.9)`;
    ghost.style.opacity = '0.95';
  }, MIRROR_COPY_IN_MS);
  // ③ 到达 → 融合闪光（白芒扩散）→ 虚影渐隐移除
  window.setTimeout(() => {
    spawnCopyFlash(tx, ty, Math.max(to.width, 120) * 1.7, Math.max(to.height, 120) * 1.7);
    ghost.style.transition = 'opacity 0.42s ease-in';
    ghost.style.opacity = '0';
  }, MIRROR_COPY_IN_MS + MIRROR_COPY_FLY_MS);
  window.setTimeout(() => ghost.remove(), MIRROR_COPY_IN_MS + MIRROR_COPY_FLY_MS + 520);
}

/* ============================== peace 和平：弃牌和平鸽 ==============================
 * 触发：card:discarded + triggerProtocol==='peace'（peace-1/3/5 弃牌；effects/index.ts
 * card:discarded 分支分流到本函数——【前置段 → 延后基础切割】，同 psychic/plague 模式）。
 * 时序（总 ≈ 2.7s）：① 一只挥翅和平鸽从卡框上方远处快速飞入，落在被弃卡框上方停片刻
 * （鸽子挥动翅膀——CSS 双翼上下扑扇动画持续）；② 鸽子俯身「抓住」被弃卡（克隆卡随鸽
 * 微降贴合），随后抓着卡快速飞向远方消失（上升 + 缩小 + 淡出）；③ 抓卡飞走后播放基础
 * 弃牌特效（playCutAt——事件时捕获 rect 重建浮层切割，原卡节点此刻已被重渲染移除）。
 * 层全部 body 级 fixed、JS 定时自清理（clearGen2Fx 兜底清扫 .fx-peace-*）。 */

const PEACE_DOVE_IN_MS = 520;    // 鸽子飞入落定
const PEACE_DOVE_HOLD_MS = 450;  // 落定停留（抓卡前）
const PEACE_GRAB_MS = 300;       // 俯身抓卡
const PEACE_DOVE_OUT_MS = 900;   // 抓卡飞远
/** 前置段完成（鸽子抓卡飞走）→ 基础切割延后时长（effects/index.ts 分流处按此调度 playCutAt） */
export const PEACE_PRE_MS = PEACE_DOVE_IN_MS + PEACE_DOVE_HOLD_MS + PEACE_GRAB_MS;

/** 构建一只和平鸽（纯 CSS 造型：白身 + 头喙 + 双翼扑扇），尺寸 ~64×48。
 *  导出供已编译层（render.ts appendPeaceCompiled 环绕鸽子）复用。 */
export function buildDove(): HTMLElement {
  const dove = document.createElement('div');
  dove.className = 'fx-peace-dove';
  const body = document.createElement('div');
  body.className = 'fx-peace-dove-body';
  const wingBack = document.createElement('i');
  wingBack.className = 'fx-peace-dove-wing back';
  const wingFront = document.createElement('i');
  wingFront.className = 'fx-peace-dove-wing front';
  const head = document.createElement('i');
  head.className = 'fx-peace-dove-head';
  const beak = document.createElement('i');
  beak.className = 'fx-peace-dove-beak';
  head.appendChild(beak);
  const tail = document.createElement('i');
  tail.className = 'fx-peace-dove-tail';
  body.appendChild(wingBack);
  body.appendChild(wingFront);
  body.appendChild(tail);
  dove.appendChild(body);
  dove.appendChild(head);
  return dove;
}

/** peace 弃牌前置鸽子动画（node = 被弃卡节点；事件时 rect 有效——重渲染前）。
 *  本函数只播鸽子 + 抓卡克隆层（前置段）；基础弃牌切割由 effects/index.ts 在
 *  PEACE_PRE_MS 延后调度（同 psychic/plague 模式）。 */
export function playPeaceDiscardExtra(
  node: HTMLElement,
  payload: { defId: string; faceUp: boolean },
): void {
  const rect = node.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return;
  const cx = rect.left + rect.width / 2;
  const topY = rect.top;
  // 鸽子层：初始在卡框上方远处（水平略偏，扑翅飞入）
  const dove = buildDove();
  dove.style.left = `${cx - 32}px`;
  dove.style.top = `${topY - 130}px`;
  dove.style.opacity = '0';
  dove.style.zIndex = String(GEN2_Z);
  document.body.appendChild(dove);
  // 被弃卡克隆（随鸽子被抓走）：初始同卡位，抓卡阶段随鸽微降贴合，随后同鸽飞远
  const clone = document.createElement('div');
  clone.className = 'fx-peace-card';
  clone.style.left = `${rect.left}px`;
  clone.style.top = `${rect.top}px`;
  clone.style.width = `${rect.width}px`;
  clone.style.height = `${rect.height}px`;
  clone.style.zIndex = String(GEN2_Z - 1);
  const img = document.createElement('img');
  img.src = cardFaceUrl(payload.defId);
  img.style.cssText =
    'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block;border-radius:6px;';
  clone.appendChild(img);
  document.body.appendChild(clone);
  // ① 鸽子飞入：淡入 + 落定在卡框上方（停片刻；CSS 双翼持续扑扇）
  requestAnimationFrame(() => {
    dove.style.transition = `opacity 0.18s ease-out, transform ${PEACE_DOVE_IN_MS}ms cubic-bezier(0.25, 0.8, 0.4, 1)`;
    dove.style.opacity = '1';
    dove.style.transform = 'translateY(76px)'; // 从上方 -130 → 卡框上方 -54
  });
  // ② 停留片刻后俯身抓卡（克隆随鸽下移贴合 + 鸽子略降）
  window.setTimeout(() => {
    dove.style.transition = `transform ${PEACE_GRAB_MS}ms ease-in`;
    dove.style.transform = 'translateY(88px) scale(0.96)';
    clone.style.transition = `transform ${PEACE_GRAB_MS}ms ease-in, opacity 0.2s ease`;
    // 克隆卡缩至鸽子身下（读作被鸽子抓住）：以卡中心为基准缩向鸽子位置
    const dy = (topY - 54 + 40) - (rect.top + rect.height / 2); // 鸽身中心约在卡框上方 54+40px
    clone.style.transform = `translateY(${dy.toFixed(1)}px) scale(0.32)`;
    clone.style.opacity = '0.92';
  }, PEACE_DOVE_IN_MS + PEACE_DOVE_HOLD_MS);
  // ③ 抓卡后快速飞远：鸽子带着克隆（同层上升 + 缩小 + 淡出），随后基础切割
  window.setTimeout(() => {
    dove.style.transition = `transform ${PEACE_DOVE_OUT_MS}ms cubic-bezier(0.5, 0.1, 0.7, 1), opacity ${PEACE_DOVE_OUT_MS}ms ease`;
    dove.style.transform = 'translate(-46px, -140px) scale(0.55)';
    dove.style.opacity = '0';
    clone.style.transition = `transform ${PEACE_DOVE_OUT_MS}ms cubic-bezier(0.5, 0.1, 0.7, 1), opacity ${PEACE_DOVE_OUT_MS}ms ease`;
    clone.style.transform = 'translate(-46px, -150px) scale(0.14)';
    clone.style.opacity = '0';
  }, PEACE_PRE_MS);
  // 前置段完成（鸽子已抓卡飞走）→ 基础弃牌切割由 effects/index.ts 延后调度（PEACE_PRE_MS）
  // 鸽子层自身清理：
  window.setTimeout(() => {
    dove.remove();
    clone.remove();
  }, PEACE_PRE_MS + PEACE_DOVE_OUT_MS + 120);
}

/* ============================== chaos 混乱：漩涡 FX ==============================
 * ① chaos-0 抽对方牌库卡/对方抽我牌库卡（card:drawn + fromOpponentDeck +
 *    triggerProtocol==='chaos'，chaos-0 底 start）：抽牌前来源牌库（被抽方）上浮现
 *    旋转紫蓝漩涡 → 从漩涡中心吐出一张牌落入对方/我方手牌（基础抽牌动画 draw-ghost
 *    由 main.ts 统一播放，起点=来源牌库侧——与漩涡同源同向，读作"漩涡吐牌"）→ 漩涡
 *    渐渐消失。本函数只播漩涡层（来源牌库 rect，~2.9s 自清理）。
 * ② chaos 弃牌（card:discarded + triggerProtocol==='chaos'，chaos-4 discardMany /
 *    chaos-5 discard）：弃牌前被弃卡中心渐现旋转紫蓝漩涡 → 卡被吸入漩涡中心消失 →
 *    基础弃牌特效延后（effects/index.ts 分流按 CHAOS_DISCARD_PRE_MS 调度 playCutAt）→
 *    漩涡渐渐消失。
 * 层 body 级 fixed、JS 定时自清理（clearGen2Fx 兜底清扫 .fx-chaos-*）。 */

const CHAOS_VORTEX_MS = 2900; // 抽牌漩涡总时长（浮现→旋转→渐隐）
/** chaos 弃牌前置段（漩涡吸入完成）→ 基础切割延后时长（effects/index.ts 分流处调度） */
export const CHAOS_DISCARD_PRE_MS = 1100;

/** 构建漩涡核心（多层蓝紫旋转扇片 + 中心黑洞） */
function buildVortex(): HTMLElement {
  const v = document.createElement('div');
  v.className = 'fx-chaos-vortex';
  for (let i = 1; i <= 3; i++) {
    const blade = document.createElement('i');
    blade.className = `fx-chaos-vortex-blade b${i}`;
    v.appendChild(blade);
  }
  const hole = document.createElement('i');
  hole.className = 'fx-chaos-vortex-hole';
  v.appendChild(hole);
  return v;
}

/** chaos-0 抽牌漩涡：来源牌库（被抽方 = 1-player）rect 中心浮现漩涡 */
export function playChaosVortexDraw(sourcePlayer: PlayerId): void {
  const deck = document.querySelector<HTMLElement>(`.deck[data-player="${sourcePlayer}"]`);
  if (!deck) return;
  const r = deck.getBoundingClientRect();
  if (r.width === 0) return;
  const size = Math.max(r.width, r.height) * 1.9;
  const layer = document.createElement('div');
  layer.className = 'fx-chaos-vortex-draw';
  layer.style.left = `${(r.left + r.width / 2 - size / 2).toFixed(1)}px`;
  layer.style.top = `${(r.top + r.height / 2 - size / 2).toFixed(1)}px`;
  layer.style.width = `${size.toFixed(1)}px`;
  layer.style.height = `${size.toFixed(1)}px`;
  layer.style.zIndex = String(GEN2_Z);
  const vortex = buildVortex();
  layer.appendChild(vortex);
  document.body.appendChild(layer);
  // 浮现（延迟 20ms 保证初始 opacity:0 已被绘制）
  window.setTimeout(() => layer.classList.add('in'), 20);
  // 渐隐自清理
  window.setTimeout(() => layer.classList.add('out'), CHAOS_VORTEX_MS - 500);
  window.setTimeout(() => layer.remove(), CHAOS_VORTEX_MS + 120);
}

/** chaos 弃牌漩涡吸入：被弃卡中心渐现小漩涡 → 卡缩小吸入 → 前置段完成（切割由 effects 延后） */
export function playChaosDiscardExtra(node: HTMLElement, payload: { defId: string; faceUp: boolean }): void {
  const rect = node.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return;
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  // 漩涡层：中心定位（初始 scale 0.2 渐现扩张）
  const size = Math.max(rect.width, rect.height) * 1.15;
  const layer = document.createElement('div');
  layer.className = 'fx-chaos-vortex-discard';
  layer.style.left = `${(cx - size / 2).toFixed(1)}px`;
  layer.style.top = `${(cy - size / 2).toFixed(1)}px`;
  layer.style.width = `${size.toFixed(1)}px`;
  layer.style.height = `${size.toFixed(1)}px`;
  layer.style.zIndex = String(GEN2_Z);
  const vortex = buildVortex();
  layer.appendChild(vortex);
  document.body.appendChild(layer);
  // 被弃卡克隆：同卡位，随吸入缩小旋转进漩涡中心
  const clone = document.createElement('div');
  clone.className = 'fx-chaos-card';
  clone.style.left = `${rect.left}px`;
  clone.style.top = `${rect.top}px`;
  clone.style.width = `${rect.width}px`;
  clone.style.height = `${rect.height}px`;
  clone.style.zIndex = String(GEN2_Z - 1);
  const img = document.createElement('img');
  img.src = cardFaceUrl(payload.defId);
  img.style.cssText =
    'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block;border-radius:6px;';
  clone.appendChild(img);
  document.body.appendChild(clone);
  // 漩涡渐现（0.35s）→ 卡被吸入（0.75s：缩向中心 + 旋转 + 淡出）
  window.setTimeout(() => layer.classList.add('in'), 20);
  window.setTimeout(() => {
    clone.style.transition = 'transform 0.75s cubic-bezier(0.6, 0.05, 0.9, 0.4), opacity 0.5s ease-in';
    clone.style.transform = 'translate(0px, 0px) scale(0.04) rotate(240deg)';
    clone.style.opacity = '0';
  }, 300);
  // 吸入完成 → 漩涡渐隐自清理
  window.setTimeout(() => layer.classList.add('out'), CHAOS_DISCARD_PRE_MS - 300);
  window.setTimeout(() => {
    layer.remove();
    clone.remove();
  }, CHAOS_DISCARD_PRE_MS + 900);
}

/* ============================== clarity 透彻：眼睛 FX ==============================
 * ① clarity-2/3 中（drawFromDeck 抽牌库值卡）：触发后所属玩家牌库上方浮现古埃及眼睛图案
 *   （render.ts select prompt 标题前缀「透彻：从牌库中选择」渲染期调用 startClarityDeckEye，
 *    幂等；眼睛持续到玩家选好被抽卡）→ drawFromDeck（card:drawn triggerProtocol=clarity）
 *    后等待 2s 眼睛消失（stopClarityDeckEye 延后调用）；
 * ② 被抽出的卡中间出现 39% 透明眼睛图案，持续 3s 后渐隐（手牌落点覆层——被抽卡重渲染前
 *    无 DOM 节点，以 handEndPos 落点框呈现眼睛，读作"抽出的卡带眼睛"）。
 * 眼睛造型 = CSS .fx-clarity-eye（见 styles.css；纯 CSS 眼形，body 级 fixed 定位）。 */

const CLARITY_EYE_AFTER_MS = 2000; // 抽卡完成后牌库眼睛再停留（「等待2秒再消失」）
const CLARITY_CARD_EYE_MS = 3000;  // 被抽卡 39% 眼睛持续时间
const CLARITY_EYE_W = 58;
const CLARITY_EYE_H = 30;

/** 活跃的牌库眼睛层（key = player：render 期创建、card:drawn clarity 后 2s 消费） */
const clarityDeckEyes = new Map<PlayerId, HTMLElement>();

/** 构建古埃及眼睛元素（CSS 造型；定位由调用方决定——作为 fixed 子层或容器内居中） */
function buildClarityEye(cls = 'fx-clarity-eye'): HTMLElement {
  const eye = document.createElement('div');
  eye.className = cls;
  const tail = document.createElement('span');
  eye.appendChild(tail);
  return eye;
}

/** 玩家牌库上方浮现眼睛（幂等：已存在只重定位；render.ts select prompt 渲染期调用） */
export function startClarityDeckEye(player: PlayerId): void {
  const deck = document.querySelector<HTMLElement>(`.deck[data-player="${player}"]`);
  if (!deck) return;
  const r = deck.getBoundingClientRect();
  if (r.width === 0) return;
  let eye = clarityDeckEyes.get(player);
  if (!eye) {
    eye = buildClarityEye();
    eye.classList.add('fx-clarity-deck-eye');
    eye.style.zIndex = String(GEN2_Z);
    document.body.appendChild(eye);
    clarityDeckEyes.set(player, eye);
  }
  // 眼睛浮于牌库区上方（轻微上飘呼吸；39%→透明——提示词「30%透明」级别）
  eye.style.left = `${(r.left + r.width / 2 - CLARITY_EYE_W / 2).toFixed(1)}px`;
  eye.style.top = `${(r.top - CLARITY_EYE_H - 6).toFixed(1)}px`;
}

/** 牌库眼睛消散（立即；抽卡完成后由订阅延后 2s 调用） */
function stopClarityDeckEye(player: PlayerId): void {
  const eye = clarityDeckEyes.get(player);
  if (!eye) return;
  clarityDeckEyes.delete(player);
  eye.classList.add('out');
  window.setTimeout(() => eye.remove(), 600);
}

/** 抽出的卡落点眼睛（手牌末尾新卡位置；39% 透明眼睛 3s 后渐隐） */
function spawnClarityCardEye(player: PlayerId): void {
  const hand = document.querySelectorAll<HTMLElement>('.hand')[player];
  if (!hand) return;
  const rect = hand.getBoundingClientRect();
  // 落点 = 手牌末尾（与 handEndPos 同款：取末卡外缘或空手牌起点）
  const cards = hand.querySelectorAll<HTMLElement>('.card:not(.reveal-ghost)');
  const last = cards[cards.length - 1];
  let x: number;
  const y = rect.top + rect.height / 2;
  if (last) {
    const lr = last.getBoundingClientRect();
    x = player === 0 ? lr.right + 37 : lr.left - 37;
  } else {
    x = player === 0 ? rect.left + 28 + 65 : rect.right - 28 - 65;
  }
  const eye = buildClarityEye();
  eye.classList.add('fx-clarity-card-eye');
  eye.style.left = `${(x - CLARITY_EYE_W / 2).toFixed(1)}px`;
  eye.style.top = `${(y - CLARITY_EYE_H / 2).toFixed(1)}px`;
  eye.style.zIndex = String(GEN2_Z);
  document.body.appendChild(eye);
  window.setTimeout(() => eye.classList.add('out'), CLARITY_CARD_EYE_MS);
  window.setTimeout(() => eye.remove(), CLARITY_CARD_EYE_MS + 600);
}

/** card:drawn + triggerProtocol=clarity（clarity-2/3 drawFromDeck 抽中卡）：牌库眼睛
 *  延后 2s 消失 + 落点眼睛 3s */
function onClarityDrawn(p: { owner?: PlayerId; uid?: string; triggerProtocol?: string }): void {
  if (p.triggerProtocol !== 'clarity' || p.owner === undefined) return;
  const player: PlayerId = p.owner;
  if (clarityDeckEyes.has(player)) {
    window.setTimeout(() => stopClarityDeckEye(player), CLARITY_EYE_AFTER_MS);
  }
  spawnClarityCardEye(player);
}

/* ============================== ice 寒冰：冰面偏转桥 + 雪花 ==============================
 * ① 偏转（ice-1/2/3 的 shift op，card:shifted + triggerProtocol=ice）：被偏转卡起点与
 *    终点间生成一道直连深蓝冰面（两条并排亮线 = 滑道），卡沿冰面滑行时带两道冰面拖尾
 *    （卡飞行由 effects 基础 playShift 照常——本函数只叠冰桥 + 拖尾观感 + 起点雪花）；
 * ② 寒冰1 底触发（ice-1 弃牌 discard，triggerProtocol=ice）：对方链路覆盖 30% 深蓝冰面
 *    偶尔雪花——简化：discard 时在【触发源 ice-1 所在线的对手链路】铺冰面层（3.5s 渐隐）
 *    ——定位：payload.triggerDefId=ice-1，需源卡 uid → 引擎 discard emit 未带 sourceUid，
 *    改由 discardMany/普通 discard 的 pe.sourceUid 补齐？——ice-1 弃牌由 ice1AfterPlay 触发
 *    （discard op 由 effect 属主执行）→ 以 payload.owner（被弃卡属主=打牌者）反查 ice-1 于其
 *    对手某线？不可靠——ice-1 在 ice-1 拥有者侧、打牌者是 ice-1 拥有者的对手。ice-1 线 =
 *    ice-1 拥有者的 ice-1 所在线。此处以 FX 层查场：找 faceUp 的 ice-1 卡，取其 line →
 *    对方（ice-1 owner 的对手 = 打牌者）该线链路 = 刚被打牌者的链路 → 铺冰。ice-1 场上有
 *    多张时取最近的（简化取第一张）。 */
const ICE_BRIDGE_IN_MS = 380;
const ICE_BRIDGE_OUT_MS = 500;
const ICE_BRIDGE_Z = 290; // 桥在飞行卡（BASE_Z 300）之下
const ICE_SNOW_MS = 2600;

/** 桥目标（同 effects stackEndPos 简化：目标槽末卡外缘 / 槽内首卡位） */
function iceStackEnd(owner: PlayerId, line: number): { x: number; y: number } | null {
  const slot = document.querySelector<HTMLElement>(`.stack-slot[data-player="${owner}"][data-line="${line}"]`);
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

/** 某点飘落的几片小雪花（纯 CSS 六角花），duration 后自清理 */
function spawnSnow(x: number, y: number, w: number, h: number, count = 6): void {
  for (let i = 0; i < count; i++) {
    const s = document.createElement('i');
    s.className = 'fx-ice-snow';
    s.style.left = `${(x + Math.random() * w).toFixed(1)}px`;
    s.style.top = `${(y + Math.random() * h).toFixed(1)}px`;
    s.style.animationDelay = `${(Math.random() * 0.8).toFixed(2)}s`;
    s.style.zIndex = String(GEN2_Z - 2);
    document.body.appendChild(s);
    window.setTimeout(() => s.remove(), ICE_SNOW_MS + 900);
  }
}

/** ice 偏转冰桥（card:shifted + triggerProtocol=ice）：起点→终点冰滑道 + 起点雪花。
 *  卡的基础飞行由 effects 照常 playShift（本函数只叠桥/拖尾/雪，不替换飞行）。 */
export function playIceShiftBridge(
  node: HTMLElement,
  payload: { uid?: string; owner?: PlayerId; line?: number | null; fromLine?: number },
): void {
  if (payload.owner === undefined || payload.line == null) return;
  const rect = node.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return;
  const start = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  const end = iceStackEnd(payload.owner, payload.line);
  if (!end) return;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const dist = Math.hypot(dx, dy);
  if (dist < 10) return;
  const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
  // 冰桥主体：深蓝半透明冰面（渐变 + 两道亮蓝滑轨线，底为桥色）
  const bridge = document.createElement('div');
  bridge.className = 'fx-ice-bridge';
  bridge.style.left = `${start.x}px`;
  bridge.style.top = `${start.y}px`;
  bridge.style.width = `${dist}px`;
  bridge.style.transform = `rotate(${angle}deg)`;
  bridge.style.zIndex = String(ICE_BRIDGE_Z);
  bridge.appendChild(Object.assign(document.createElement('i'), { className: 'fx-ice-bridge-line a' }));
  bridge.appendChild(Object.assign(document.createElement('i'), { className: 'fx-ice-bridge-line b' }));
  document.body.appendChild(bridge);
  // 起点/终点晶点标记
  const mk = (x: number, y: number): HTMLElement => {
    const m = document.createElement('i');
    m.className = 'fx-ice-bridge-end';
    m.style.left = `${x}px`;
    m.style.top = `${y}px`;
    m.style.zIndex = String(ICE_BRIDGE_Z + 1);
    return m;
  };
  const sMark = mk(start.x, start.y);
  const eMark = mk(end.x, end.y);
  document.body.appendChild(sMark);
  document.body.appendChild(eMark);
  // 起点冰晶雪花
  spawnSnow(start.x - 30, start.y - 40, 60, 60, 5);
  // 桥渐显 → 卡飞行由 effects 基础 playShift（MOVE_MS）→ 桥渐隐清理
  requestAnimationFrame(() => bridge.classList.add('in'));
  sMark.classList.add('in');
  eMark.classList.add('in');
  window.setTimeout(() => {
    bridge.classList.remove('in');
    bridge.classList.add('out');
    sMark.classList.add('out');
    eMark.classList.add('out');
    window.setTimeout(() => {
      bridge.remove();
      sMark.remove();
      eMark.remove();
    }, ICE_BRIDGE_OUT_MS + 60);
  }, 900 + ICE_BRIDGE_IN_MS); // 桥保持 ~0.9s（覆盖基础飞行 MOVE_MS 450ms）后渐隐
}

/* ============================== smoke 迷雾：灰雾出场 ==============================
 * 反面打出（smoke-0 牌库顶反打多线 / smoke-3 手牌反打，card:deck-played/hand-played +
 * triggerProtocol=smoke）：落点位置先被浓灰雾完全笼罩（渐现 0.45s）→ 反面打出的卡从灰雾
 * 中浮现（基础飞行照常，由 effects 播放）→ 雾散（卡到点后 ~0.55s 渐隐）→ 卡边框浓灰
 * 发光 2s（落点覆框渐现 2s 后消散）。层 body 级 fixed、JS 定时自清理。 */
const SMOKE_MIST_IN_MS = 450;    // 灰雾渐现
const SMOKE_MIST_HOLD_MS = 1100; // 保持（覆盖基础飞行 ~450ms 到达）
const SMOKE_MIST_OUT_MS = 600;   // 雾散
const SMOKE_GLOW_MS = 2000;      // 卡边框灰光持续

/** 目标槽 stackEnd（同 iceStackEnd：末卡外缘 / 空槽起点） */
function smokeStackEnd(owner: PlayerId, line: number): { x: number; y: number } | null {
  const slot = document.querySelector<HTMLElement>(`.stack-slot[data-player="${owner}"][data-line="${line}"]`);
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

/** smoke 反打灰雾出场（effects deck-played/hand-played 分流调用；基础飞行由 effects 照常） */
export function playSmokePlayFx(payload: { owner?: PlayerId; line?: number | null }): void {
  if (payload.owner === undefined || payload.line == null) return;
  const end = smokeStackEnd(payload.owner, payload.line);
  if (!end) return;
  const W = 150;
  const H = 200;
  // 灰雾层：笼罩落点区域（多团浓灰 blob 合成迷雾）
  const mist = document.createElement('div');
  mist.className = 'fx-smoke-mist';
  mist.style.left = `${(end.x - W / 2).toFixed(1)}px`;
  mist.style.top = `${(end.y - H / 2).toFixed(1)}px`;
  mist.style.width = `${W}px`;
  mist.style.height = `${H}px`;
  mist.style.zIndex = String(GEN2_Z);
  for (let i = 0; i < 5; i++) {
    const b = document.createElement('i');
    b.className = 'fx-smoke-mist-blob';
    mist.appendChild(b);
  }
  document.body.appendChild(mist);
  window.setTimeout(() => mist.classList.add('in'), 20);
  // 雾散 + 卡框灰光（落点覆框）
  window.setTimeout(() => {
    mist.classList.add('out');
    const glow = document.createElement('div');
    glow.className = 'fx-smoke-cardglow';
    glow.style.left = `${(end.x - 65).toFixed(1)}px`;
    glow.style.top = `${(end.y - 89.4).toFixed(1)}px`;
    glow.style.width = '130px';
    glow.style.height = '178.8px';
    glow.style.zIndex = String(GEN2_Z - 1);
    document.body.appendChild(glow);
    window.setTimeout(() => glow.classList.add('out'), SMOKE_GLOW_MS);
    window.setTimeout(() => glow.remove(), SMOKE_GLOW_MS + 500);
  }, SMOKE_MIST_HOLD_MS);
  window.setTimeout(() => mist.remove(), SMOKE_MIST_HOLD_MS + SMOKE_MIST_OUT_MS + 80);
}

/* ============================== fear 恐惧：橙红颤动偏转 ==============================
 * 偏转（fear-0/3 shift op，card:shifted + triggerProtocol=fear）：卡被橙红光芒完全覆盖 +
 * 边框橙光 → 向四周快速随机颤动 → 以「极慢 → 极快」速度移向目标线末尾 → 到点停止颤动
 * 恢复正常（边框橙光 2s 后消失）。本函数以浮层卡【替代】基础飞行（同 speed shift extra
 * 模式）：事件时捕获源 rect 立即建浮层卡（z=BASE 盖住真实卡）→ 颤动（CSS jitter）→
 * 起飞过渡（cubic-bezier 慢→快）→ 到点渐隐移除，露出真实卡（位置一致无缝）。
 * 层 body 级 fixed、JS 定时自清理（clearGen2Fx 兜底 .fx-fear-*）。 */
const FEAR_JITTER_MS = 550;   // 颤动时长（起飞前原地快速随机颤动）
const FEAR_GLOW_AFTER_MS = 2000; // 到达后边框橙光保持（提示词「2秒后消失」）

export function playFearShiftExtra(
  node: HTMLElement,
  payload: { uid?: string; owner?: PlayerId; line?: number | null },
): void {
  if (payload.owner === undefined || payload.line == null) return;
  const rect = node.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return;
  const slot = document.querySelector<HTMLElement>(`.stack-slot[data-player="${payload.owner}"][data-line="${payload.line}"]`);
  if (!slot) return;
  const slotRect = slot.getBoundingClientRect();
  const y = slotRect.top + slotRect.height / 2;
  const cards = slot.querySelectorAll<HTMLElement>('.card');
  const last = cards.length > 0 ? cards[cards.length - 1] : null;
  const end = last
    ? (() => {
        const r = last.getBoundingClientRect();
        return { x: payload.owner === 0 ? r.left - 65 : r.right + 65, y };
      })()
    : { x: payload.owner === 0 ? slotRect.right - 90 : slotRect.left + 90, y };
  // 浮层卡（橙红覆盖）
  const ghost = document.createElement('div');
  ghost.className = 'fx-fear-ghost';
  ghost.style.left = `${rect.left}px`;
  ghost.style.top = `${rect.top}px`;
  ghost.style.width = `${rect.width}px`;
  ghost.style.height = `${rect.height}px`;
  ghost.style.zIndex = String(GEN2_Z - 2);
  // 卡面（被偏转卡当前面）——payload 无 defId，从节点 img 克隆
  const srcImg = node.querySelector('img');
  if (srcImg && srcImg.src) {
    const img = document.createElement('img');
    img.src = srcImg.src;
    img.style.cssText =
      'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block;border-radius:6px;';
    ghost.appendChild(img);
  }
  // 橙红覆盖层（卡上方半透明橙红光）+ 颤动动画（CSS jitter keyframes）
  const cover = document.createElement('div');
  cover.className = 'fx-fear-cover';
  ghost.appendChild(cover);
  document.body.appendChild(ghost);
  // ① 颤动：原地快速随机颤动（CSS animation jitter，550ms）——极慢→极快由起飞过渡体现
  ghost.classList.add('jitter');
  const start = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  // ② 颤动结束后起飞：cubic-bezier(0.05, 0.1, 0.85, 1) ≈ 极慢起步 → 极快冲线
  window.setTimeout(() => {
    ghost.classList.remove('jitter');
    ghost.style.transition = `transform 900ms cubic-bezier(0.05, 0.12, 0.8, 1), opacity 0.3s ease`;
    ghost.style.transform = `translate(${dx}px, ${dy}px)`;
    // ③ 到点停止颤动恢复正常：ghost 渐隐（露出真实卡）；落点边框橙光保持 2s
    window.setTimeout(() => {
      ghost.style.opacity = '0';
      const glow = document.createElement('div');
      glow.className = 'fx-fear-landglow';
      glow.style.left = `${(end.x - rect.width / 2).toFixed(1)}px`;
      glow.style.top = `${(end.y - rect.height / 2).toFixed(1)}px`;
      glow.style.width = `${rect.width}px`;
      glow.style.height = `${rect.height}px`;
      glow.style.zIndex = String(GEN2_Z - 3);
      document.body.appendChild(glow);
      window.setTimeout(() => glow.classList.add('out'), FEAR_GLOW_AFTER_MS);
      window.setTimeout(() => glow.remove(), FEAR_GLOW_AFTER_MS + 500);
    }, 920);
    window.setTimeout(() => ghost.remove(), 1250);
  }, FEAR_JITTER_MS);
}

/* ============================== corruption 腐化：腐蚀液 / 毒雾 ==============================
 * 触发（triggerProtocol=corruption 的弃牌/删除/翻转）：
 * ① 弃牌：被弃卡从上到下渐渐覆盖墨绿腐蚀液膜（覆盖层自上而下滑入）→ 卡面浮现墨绿腐蚀
 *    斑纹并向四周蔓延 → 卡边缘碎裂化作绿色光点飘散 → 最后整卡腐蚀成绿色光尘消散（前置
 *    段完成后由 effects 延后基础切割）；本函数只播腐蚀浮层。
 * ② 翻转：翻转前卡面浮现墨绿腐蚀纹路 → 在墨绿毒雾笼罩下完成翻转（浮层毒雾盖卡→渐隐，
 *    翻面由 effects 基础 playFlip 照常）。
 * ③ 删除：墨绿腐蚀液自下而上完全覆盖（corruption-6 删除此牌）→ 碎裂成绿色光点消散
 *    （基础破碎由 effects 照常）。
 * 层 body 级 fixed、JS 定时自清理（clearGen2Fx 兜底 .fx-corrupt-*）。 */
const CORRUPT_COVER_MS = 900;   // 腐蚀液覆盖（自上而下 / 自下而上）
const CORRUPT_PARTICLE_MS = 1200; // 绿光点飘散时长
/** corruption 弃牌前置段（腐蚀液膜 + 斑纹 + 光尘）完成 → 基础切割延后时长（effects 分流处） */
export const CORRUPT_DISCARD_PRE_MS = CORRUPT_COVER_MS + 300 + 500;

/** 被弃卡克隆（腐蚀载体）：同卡位、body 级、带墨绿光晕 */
function buildCorruptCard(defId: string, rect: DOMRect): HTMLElement {
  const clone = document.createElement('div');
  clone.className = 'fx-corrupt-card';
  clone.style.left = `${rect.left}px`;
  clone.style.top = `${rect.top}px`;
  clone.style.width = `${rect.width}px`;
  clone.style.height = `${rect.height}px`;
  clone.style.zIndex = String(GEN2_Z - 1);
  const img = document.createElement('img');
  img.src = cardFaceUrl(defId);
  img.style.cssText =
    'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block;border-radius:6px;';
  clone.appendChild(img);
  document.body.appendChild(clone);
  return clone;
}

/** 墨绿腐蚀液膜层（挂在克隆上，clip 由 CSS 动画驱动） */
function attachCorrosionLiquid(clone: HTMLElement, fromTop: boolean): HTMLElement {
  const liq = document.createElement('div');
  liq.className = fromTop ? 'fx-corrupt-liquid top' : 'fx-corrupt-liquid bottom';
  clone.appendChild(liq);
  return liq;
}

/** 卡面碎裂绿光点（沿卡边缘/全卡随机小绿点向外飘散渐隐） */
function spawnCorruptSpecks(rect: DOMRect, count = 14): void {
  for (let i = 0; i < count; i++) {
    const s = document.createElement('i');
    s.className = 'fx-corrupt-speck';
    const x = rect.left + Math.random() * rect.width;
    const y = rect.top + Math.random() * rect.height;
    s.style.left = `${x.toFixed(1)}px`;
    s.style.top = `${y.toFixed(1)}px`;
    s.style.setProperty('--fx-cdx', `${(Math.random() * 90 - 45).toFixed(1)}px`);
    s.style.setProperty('--fx-cdy', `${(Math.random() * 90 - 20).toFixed(1)}px`);
    s.style.animationDelay = `${(Math.random() * 0.4).toFixed(2)}s`;
    s.style.zIndex = String(GEN2_Z);
    document.body.appendChild(s);
    window.setTimeout(() => s.remove(), CORRUPT_PARTICLE_MS + 500);
  }
}

/** corruption 弃牌腐蚀（effects card:discarded 分支延后基础切割前调用——前置腐蚀层） */
export function playCorruptionDiscardExtra(node: HTMLElement, payload: { defId: string }): void {
  const rect = node.getBoundingClientRect();
  if (rect.width === 0) return;
  const clone = buildCorruptCard(payload.defId, rect);
  // 自上而下滑入腐蚀液膜 → 浮现斑纹 + 绿光点 → 光尘消散
  const liq = attachCorrosionLiquid(clone, true);
  window.setTimeout(() => liq.classList.add('in'), 20);
  window.setTimeout(() => {
    clone.classList.add('speckling'); // 卡面碎裂淡出，露出下方基础切割
    spawnCorruptSpecks(rect);
  }, CORRUPT_COVER_MS + 300);
  window.setTimeout(() => {
    clone.remove();
  }, CORRUPT_COVER_MS + CORRUPT_PARTICLE_MS + 800);
}

/** corruption-6 删除腐蚀（自下而上覆盖 → 碎成绿光点；基础破碎由 effects 照常） */
export function playCorruptionDeleteExtra(node: HTMLElement, payload: { defId: string }): void {
  const rect = node.getBoundingClientRect();
  if (rect.width === 0) return;
  const clone = buildCorruptCard(payload.defId, rect);
  const liq = attachCorrosionLiquid(clone, false);
  window.setTimeout(() => liq.classList.add('in'), 20);
  window.setTimeout(() => {
    clone.classList.add('speckling');
    spawnCorruptSpecks(rect);
  }, CORRUPT_COVER_MS + 250);
  window.setTimeout(() => clone.remove(), CORRUPT_COVER_MS + CORRUPT_PARTICLE_MS + 600);
}

/** corruption 翻转毒雾（浮层盖卡渐隐；翻面由 effects 基础 playFlip 照常） */
export function playCorruptionFlipExtra(node: HTMLElement): void {
  const rect = node.getBoundingClientRect();
  if (rect.width === 0) return;
  const mist = document.createElement('div');
  mist.className = 'fx-corrupt-mist';
  mist.style.left = `${rect.left - 8}px`;
  mist.style.top = `${rect.top - 8}px`;
  mist.style.width = `${rect.width + 16}px`;
  mist.style.height = `${rect.height + 16}px`;
  mist.style.zIndex = String(GEN2_Z);
  for (let i = 0; i < 6; i++) mist.appendChild(document.createElement('i'));
  document.body.appendChild(mist);
  window.setTimeout(() => mist.classList.add('in'), 20);
  // 翻转覆盖层约 420ms 结束 → 毒雾渐隐
  window.setTimeout(() => mist.classList.add('out'), 700);
  window.setTimeout(() => mist.remove(), 1300);
}

/** corruption-1 中召回：被召回卡先被腐蚀成墨绿虚影，以虚影形态飞回持有者牌库并正面朝下落回。
 *  卡此刻已入手牌（return op）→ 原卡节点 rect 捕获后建虚影 → 飞向持有者牌库中心（deck rect）。 */
function onCorruptionReturned(p: { uid?: string; defId?: string; owner?: PlayerId }): void {
  if (!p.uid || !p.defId || p.owner === undefined) return;
  const node = document.querySelector<HTMLElement>(`[data-uid="${p.uid}"]`);
  const from = node ? node.getBoundingClientRect() : null;
  const deck = document.querySelector<HTMLElement>(`.deck[data-player="${p.owner}"]`);
  if (!from || !deck) return;
  const dr = deck.getBoundingClientRect();
  if (from.width === 0 || dr.width === 0) return;
  const ghost = buildCorruptCard(p.defId, from);
  ghost.classList.add('fx-corrupt-return-ghost');
  // 虚影出现（墨绿）+ 飞向牌库中心
  const cx = from.left + from.width / 2;
  const cy = from.top + from.height / 2;
  const tx = dr.left + dr.width / 2;
  const ty = dr.top + dr.height / 2;
  const dx = tx - cx;
  const dy = ty - cy;
  window.setTimeout(() => {
    ghost.style.transition = `transform 0.8s cubic-bezier(0.25, 0.7, 0.3, 1), opacity 0.7s ease`;
    ghost.style.transform = `translate(${dx}px, ${dy}px) scale(0.7)`;
    ghost.style.opacity = '0.6';
  }, 60);
  window.setTimeout(() => {
    ghost.style.transition = 'opacity 0.4s ease-in';
    ghost.style.opacity = '0';
  }, 620);
  window.setTimeout(() => ghost.remove(), 1100);
}

/** 订阅 luck / mirror / peace / chaos / clarity / corruption 引擎事件 */
export function initGen2Fx(): () => void {
  return gameBus.subscribe((e: GameEvent) => {
    if (e.type === 'luck:roll') {
      onLuckRoll(e.payload as LuckPayload);
    } else if (e.type === 'card:copied') {
      onMirrorCopy(e.payload as { uid?: string; defId?: string; copiedToUid?: string });
    } else if (e.type === 'card:returned') {
      // corruption-1 中召回对手卡（腐化效果召回）→ 墨绿虚影飞回持有者牌库
      const p = e.payload as { uid?: string; defId?: string; owner?: PlayerId; triggerProtocol?: string } | undefined;
      if (p && p.triggerProtocol === 'corruption' && p.uid && p.defId) {
        onCorruptionReturned(p);
      }
    } else if (e.type === 'card:drawn') {
      const p = e.payload as
        | { player?: PlayerId; count?: number; owner?: PlayerId; uid?: string; fromOpponentDeck?: boolean; triggerProtocol?: string }
        | undefined;
      // chaos-0 抽对方牌库卡/对方抽我牌库卡：来源牌库 = 抽牌者的对手
      if (p && p.fromOpponentDeck === true && p.triggerProtocol === 'chaos' && (p.player === 0 || p.player === 1)) {
        playChaosVortexDraw((p.player === 0 ? 1 : 0) as PlayerId);
      }
      // clarity-2/3 drawFromDeck（emitCardEvent 卡级载荷：owner = 抽牌者）
      if (p && p.triggerProtocol === 'clarity' && p.uid) {
        onClarityDrawn(p);
      }
    }
  });
}
