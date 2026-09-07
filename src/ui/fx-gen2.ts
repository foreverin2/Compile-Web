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
  for (const el of document.querySelectorAll<HTMLElement>(
    '.fx-luck-spark, .fx-luck-msg, .fx-luck-mushroom, .fx-mirror-copy-ghost, ' +
      '.fx-mirror-copy-flash, .fx-peace-dove, .fx-peace-card, .fx-chaos-vortex-draw, ' +
      '.fx-chaos-vortex-discard, .fx-chaos-card'
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

/** 订阅 luck / mirror / peace / chaos 引擎事件 */
export function initGen2Fx(): () => void {
  return gameBus.subscribe((e: GameEvent) => {
    if (e.type === 'luck:roll') {
      onLuckRoll(e.payload as LuckPayload);
    } else if (e.type === 'card:copied') {
      onMirrorCopy(e.payload as { uid?: string; defId?: string; copiedToUid?: string });
    } else if (e.type === 'card:drawn') {
      // chaos-0 抽对方牌库卡/对方抽我牌库卡：来源牌库 = 抽牌者的对手
      const p = e.payload as { player?: PlayerId; fromOpponentDeck?: boolean; triggerProtocol?: string } | undefined;
      if (p && p.fromOpponentDeck === true && p.triggerProtocol === 'chaos' && (p.player === 0 || p.player === 1)) {
        playChaosVortexDraw((p.player === 0 ? 1 : 0) as PlayerId);
      }
    }
  });
}
