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
import type { GameState } from '../core/models/types';
import { cardImgSrc } from '../data/demo';
import { protocolColorOf, hexToRgba } from './protocol-colors';
import { registerFollow } from './fx-follow';

type PlayerId = 0 | 1;

/** 卡面 URL（正面官方图；复制虚影恒显示被复制卡正面——公开信息） */
function cardFaceUrl(defId: string): string {
  const [proto, value] = defId.split('-');
  return cardImgSrc(proto, value);
}

/** 元素工厂（本模块内部的轻量 helper） */
function mk(tag: string, cls: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
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

/** 放烟花（用户：加强——更多火星、更大、飞得更远更分散 + 起爆白橙闪光）：
 *  中心 (cx,cy) 放出 count 组火星，全部渐隐自清理 */
function spawnFireworks(cx: number, cy: number, count = 9): void {
  // 起爆闪光（白橙核心快速扩散渐隐）
  const flash = document.createElement('i');
  flash.className = 'fx-luck-flash';
  flash.style.left = `${cx.toFixed(1)}px`;
  flash.style.top = `${cy.toFixed(1)}px`;
  document.body.appendChild(flash);
  window.setTimeout(() => flash.remove(), 700);
  for (let g = 0; g < count; g++) {
    // 每簇 16-24 颗火星，绕随机中心角展开
    const sparks = 16 + Math.floor(Math.random() * 9);
    const baseAng = Math.random() * Math.PI * 2;
    const centerDist = 30 + Math.random() * 62;
    const centerX = cx + Math.cos(baseAng) * centerDist;
    const centerY = cy + Math.sin(baseAng) * centerDist;
    for (let s = 0; s < sparks; s++) {
      const ang = (s / sparks) * Math.PI * 2 + (Math.random() - 0.5) * 0.5;
      const dist = 64 + Math.random() * 104;
      const size = 7 + Math.random() * 7;
      const p = document.createElement('i');
      p.className = 'fx-luck-spark';
      p.style.width = `${size.toFixed(1)}px`;
      p.style.height = `${size.toFixed(1)}px`;
      p.style.left = `${centerX.toFixed(1)}px`;
      p.style.top = `${centerY.toFixed(1)}px`;
      p.style.setProperty('--fx-dx', `${(Math.cos(ang) * dist).toFixed(1)}px`);
      p.style.setProperty('--fx-dy', `${(Math.sin(ang) * dist).toFixed(1)}px`);
      p.style.animationDelay = `${(Math.random() * 0.12).toFixed(2)}s`;
      document.body.appendChild(p);
      window.setTimeout(() => p.remove(), FW_FLY_MS + 200);
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

/** 红色蘑菇云（用户：加强——更大柱/顶盖 + 爆闪 + 冲击波环），自清理 */
function spawnMushroom(cx: number, cy: number): void {
  const m = document.createElement('div');
  m.className = 'fx-luck-mushroom';
  m.style.left = `${cx.toFixed(1)}px`;
  m.style.top = `${cy.toFixed(1)}px`;
  const stem = document.createElement('i');
  stem.className = 'fx-luck-mushroom-stem';
  const cap = document.createElement('i');
  cap.className = 'fx-luck-mushroom-cap';
  const ring = document.createElement('i');
  ring.className = 'fx-luck-mushroom-ring';
  const blaze = document.createElement('i');
  blaze.className = 'fx-luck-mushroom-blaze';
  m.appendChild(ring);
  m.appendChild(stem);
  m.appendChild(cap);
  m.appendChild(blaze);
  document.body.appendChild(m);
  // 爆炸后整体渐隐移除
  window.setTimeout(() => m.classList.add('out'), 1100);
  window.setTimeout(() => m.remove(), 1800);
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
  // 全部 2代 瞬态 FX 层（批1-4；含 luck/mirror/peace/chaos/clarity/ice/smoke/fear/
  // corruption/war/courage/time/assimilation/unity/diversity 的 body 级浮层）——
  // 多数自带 setTimeout 自清理，但应用内重置（返回主界面）时立即清扫防残留。
  for (const el of document.querySelectorAll<HTMLElement>(
    '.fx-luck-spark, .fx-luck-msg, .fx-luck-flash, .fx-luck-mushroom, .fx-luck-dice, .fx-luck-dice-glow, ' +
      '.fx-mirror-copy-ghost, .fx-mirror-copy-flash, ' +
      '.fx-peace-dove, .fx-peace-card, .fx-peace-frame, .fx-peace-text, ' +
      '.fx-chaos-vortex-draw, .fx-chaos-vortex-discard, .fx-chaos-card, ' +
      '.fx-clarity-eye, .fx-clarity-deck-eye, .fx-clarity-card-eye, ' +
      '.fx-ice-bridge, .fx-ice-bridge-end, .fx-ice-snow, ' +
      '.fx-smoke-mist, .fx-smoke-cardglow, ' +
      '.fx-fear-ghost, .fx-fear-landglow, ' +
      '.fx-corrupt-card, .fx-corrupt-mist, .fx-corrupt-speck, .fx-corrupt-return-ghost, ' +
      '.fx-war-slash, .fx-war-spark, .fx-war-flipglow, .fx-war-flag, ' +
      '.fx-courage-sword, .fx-courage-inferno, .fx-courage-slash, .fx-courage-golddot, ' +
      '.fx-courage-halo, .fx-courage-ring, .fx-courage-cardglow, .fx-courage-spark, ' +
      '.fx-courage-sword-shadow, ' +
      '.fx-time-clock, .fx-time-trashglow, .fx-time-band, .fx-time-film, ' +
      '.fx-assim-ring, .fx-assim-speck, .fx-assim-ripple, .fx-assim-dot, .fx-assim-land, ' +
      '.fx-assim-gloss, .fx-assim-band, ' +
      '.fx-unity-link, .fx-unity-ring, .fx-unity-halo, .fx-unity-band, .fx-unity-pillar, ' +
      '.fx-unity-sash, .fx-unity-speck, ' +
      '.fx-diversity-ring, .fx-diversity-dust, .fx-diversity-orb, .fx-diversity-halo, ' +
      '.fx-diversity-rainbow-ring, .fx-div0-pillar, .fx-div0-beam, .fx-div0-burst, .fx-div0-mote'
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

/** 构建一只和平鸽（纯 CSS 造型：白身 + 颈 + 头眼喙 + 三羽扇尾 + 双翼扑扇）。
 *  2026-09-11 用户反馈「现在的看起来不像」→ 重做造型：拉长流线型身体、加颈/眼、
 *  尾部改三片羽扇、翅膀改带羽尖缺口的翼形。尺寸 ~72×54。
 *  导出供已编译层（render.ts appendPeaceCompiled 环绕鸽子）复用。 */
export function buildDove(): HTMLElement {
  const dove = document.createElement('div');
  dove.className = 'fx-peace-dove';
  // 扇尾：三片羽毛（错开角度）
  const tail = document.createElement('div');
  tail.className = 'fx-peace-dove-tail';
  for (let i = 0; i < 3; i++) {
    const f = document.createElement('i');
    f.className = 'fx-peace-dove-feather';
    tail.appendChild(f);
  }
  // 身体（两翼均以【身体】为坐标基准：后翼先入 DOM → 被身体/前翼压住）
  // 2026-09-12 修复：后翼此前是 dove 的子元素却按身体坐标写 CSS → 整只翅膀飘到身体外
  const body = document.createElement('div');
  body.className = 'fx-peace-dove-body';
  const wingBack = document.createElement('i');
  wingBack.className = 'fx-peace-dove-wing back';
  const neck = document.createElement('i');
  neck.className = 'fx-peace-dove-neck';
  const wingFront = document.createElement('i');
  wingFront.className = 'fx-peace-dove-wing front';
  body.appendChild(wingBack);
  body.appendChild(neck);
  body.appendChild(wingFront);
  // 头 + 眼 + 喙
  const head = document.createElement('div');
  head.className = 'fx-peace-dove-head';
  const eye = document.createElement('i');
  eye.className = 'fx-peace-dove-eye';
  const beak = document.createElement('i');
  beak.className = 'fx-peace-dove-beak';
  head.appendChild(eye);
  head.appendChild(beak);
  dove.appendChild(tail);
  dove.appendChild(body);
  dove.appendChild(head);
  return dove;
}

/** 弃牌落点「peace!」文字特效（用户：弃掉后在原位置弹出，持续 2 秒后消失） */
function spawnPeaceText(rect: DOMRect): void {
  const t = document.createElement('div');
  t.className = 'fx-peace-text';
  t.textContent = 'peace!';
  t.style.left = `${(rect.left + rect.width / 2).toFixed(1)}px`;
  t.style.top = `${(rect.top + rect.height / 2).toFixed(1)}px`;
  document.body.appendChild(t);
  window.setTimeout(() => t.classList.add('out'), 2000);
  window.setTimeout(() => t.remove(), 2600);
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
  // 用户 2026-09-11：额外特效触发期间，被弃卡边框 = 海蓝与金币色交替闪烁发光外框
  clone.appendChild(mk('i', 'fx-peace-frame'));
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
  // 用户 2026-09-11：弃掉后在被弃位置弹出「peace!」文字（基础切割播完即弹，持续 2s 渐隐）
  window.setTimeout(() => spawnPeaceText(rect), PEACE_PRE_MS + 320);
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

/** 阿基米德螺线路径（viewBox 0..100，中心 50,50）：turns 圈、最大半径 rMax。
 *  分段折线近似（每圈 60 段）——够平滑且无需外部资源。 */
function spiralPath(turns: number, rMax: number): string {
  const steps = Math.round(turns * 60);
  let d = '';
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const a = t * turns * Math.PI * 2;
    const r = rMax * t;
    d += `${i === 0 ? 'M' : 'L'}${(50 + Math.cos(a) * r).toFixed(2)} ${(50 + Math.sin(a) * r).toFixed(2)} `;
  }
  return d.trim();
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/** 构建漩涡核心（用户 2026-09-11：改为「类似大棒棒糖的旋风式图案」）：
 *  一条阿基米德螺线用「紫/蓝交替虚线」描边两遍（第二遍 dashoffset 错开半个周期）→
 *  糖果旋风条纹；叠加深紫底盘柔光 + 中心黑洞。旋转由 .fx-chaos-vortex 的 CSS 动画带动。 */
function buildVortex(): HTMLElement {
  const v = document.createElement('div');
  v.className = 'fx-chaos-vortex';
  const d = spiralPath(3.4, 47);
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'fx-chaos-swirl');
  svg.setAttribute('viewBox', '0 0 100 100');
  const band = (color: string, dashOffset: number): void => {
    const p = document.createElementNS(SVG_NS, 'path');
    p.setAttribute('d', d);
    p.setAttribute('fill', 'none');
    p.setAttribute('stroke', color);
    p.setAttribute('stroke-width', '13');
    p.setAttribute('stroke-dasharray', '15 15');
    p.setAttribute('stroke-dashoffset', String(dashOffset));
    svg.appendChild(p);
  };
  band('#8b5cff', 0);  // 紫色段
  band('#4abeff', 15); // 蓝色段（错开半周期 → 紫蓝交替）
  v.appendChild(svg);
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
  // 2026-09-13 用户裁决：3s 的落点眼超出"瞬态可不跟随"的窗口 → 注册跟随（滚动/缩放时重新锚到手牌末尾）
  const anchoredPlayer = player;
  registerFollow(eye, (el) => {
    const hand = document.querySelector<HTMLElement>(`.hand[data-player="${anchoredPlayer}"]`);
    if (!hand) return;
    const cards = hand.querySelectorAll<HTMLElement>('.card:not(.reveal-ghost)');
    const lastCard = cards[cards.length - 1];
    let nx: number;
    let ny: number;
    if (lastCard) {
      const lr = lastCard.getBoundingClientRect();
      nx = anchoredPlayer === 0 ? lr.right + 37 : lr.left - 37;
      ny = lr.top + lr.height / 2;
    } else {
      const hr = hand.getBoundingClientRect();
      nx = anchoredPlayer === 0 ? hr.left + 28 + 65 : hr.right - 28 - 65;
      ny = hr.top + hr.height / 2;
    }
    el.style.left = `${(nx - CLARITY_EYE_W / 2).toFixed(1)}px`;
    el.style.top = `${(ny - CLARITY_EYE_H / 2).toFixed(1)}px`;
  });
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
    // 2026-09-13 用户裁决：2s 的卡框灰光加跟随（落点由 owner/line 每帧重算，滚动时不再脱离卡面）
    const glowOwner = payload.owner!;
    const glowLine = payload.line!;
    registerFollow(glow, (el) => {
      const e = smokeStackEnd(glowOwner, glowLine);
      if (!e) return;
      el.style.left = `${(e.x - 65).toFixed(1)}px`;
      el.style.top = `${(e.y - 89.4).toFixed(1)}px`;
    });
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

/* ============================== war 战争：双剑 / 刀光 / 战旗 ==============================
 * ① 弃置（card:discarded triggerProtocol=war，战争弃牌效果 war-1/2/4/5）：被弃卡被一道
 *    赤红刀光斩中（斜向红刃划过 + 火花），卡被斩成两半化火星消散（前置段后 effects 延后
 *    基础切割——本函数只播刀光 + 火花层）。
 * ② 翻转（card:flipped triggerProtocol=war）：翻转前赤红铁灰光芒笼罩 + 铁器交击火花。
 * ③ 被动触发成功（胜利战旗）：war-0 删卡（card:deleted war）/war-1 弃后刷新（discardMany
 *    war）/war-2 对手弃手（discardMany war）/war-3 反打（deck-played war）→ 双剑迸发赤金
 *    光芒 + 残破赤红战旗虚影向两侧展开 2s 后消散。战旗挂在触发源卡位置（triggerDefId 卡）。
 * 层 body 级 fixed、JS 定时自清理（clearGen2Fx 兜底 .fx-war-*）。 */
const WAR_SLASH_MS = 420;   // 刀光斩过
const WAR_FLAG_MS = 2200;   // 战旗展开停留

/** war 弃牌刀光：斜向赤红刀刃扫过被弃卡 + 火花（卡被斩两半化火星） */
export function playWarDiscardExtra(node: HTMLElement): void {
  const rect = node.getBoundingClientRect();
  if (rect.width === 0) return;
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const slash = document.createElement('div');
  slash.className = 'fx-war-slash';
  slash.style.left = `${rect.left - 20}px`;
  slash.style.top = `${rect.top - 20}px`;
  slash.style.width = `${rect.width + 40}px`;
  slash.style.height = `${rect.height + 40}px`;
  slash.style.zIndex = String(GEN2_Z);
  document.body.appendChild(slash);
  // 火花（斩击处飞溅）
  for (let i = 0; i < 8; i++) {
    const s = document.createElement('i');
    s.className = 'fx-war-spark';
    const ang = Math.random() * Math.PI * 2;
    const dist = 20 + Math.random() * 46;
    s.style.left = `${(cx + Math.cos(ang) * 10).toFixed(1)}px`;
    s.style.top = `${(cy + Math.sin(ang) * 10).toFixed(1)}px`;
    s.style.setProperty('--fx-wdx', `${(Math.cos(ang) * dist).toFixed(1)}px`);
    s.style.setProperty('--fx-wdy', `${(Math.sin(ang) * dist).toFixed(1)}px`);
    s.style.zIndex = String(GEN2_Z);
    document.body.appendChild(s);
    window.setTimeout(() => s.remove(), 800);
  }
  window.setTimeout(() => slash.classList.add('in'), 20);
  window.setTimeout(() => slash.remove(), WAR_SLASH_MS + 200);
}

/** war 翻转（赤红铁灰光芒 + 火花；基础翻面照常） */
export function playWarFlipExtra(node: HTMLElement): void {
  const rect = node.getBoundingClientRect();
  if (rect.width === 0) return;
  const glow = document.createElement('div');
  glow.className = 'fx-war-flipglow';
  glow.style.left = `${rect.left - 8}px`;
  glow.style.top = `${rect.top - 8}px`;
  glow.style.width = `${rect.width + 16}px`;
  glow.style.height = `${rect.height + 16}px`;
  glow.style.zIndex = String(GEN2_Z - 1);
  // 火花
  for (let i = 0; i < 6; i++) {
    const s = document.createElement('i');
    s.className = 'fx-war-spark';
    s.style.left = `${(rect.left + Math.random() * rect.width).toFixed(1)}px`;
    s.style.top = `${(rect.top + Math.random() * rect.height).toFixed(1)}px`;
    s.style.setProperty('--fx-wdx', `${(Math.random() * 60 - 30).toFixed(1)}px`);
    s.style.setProperty('--fx-wdy', `${(Math.random() * 40 - 20).toFixed(1)}px`);
    s.style.zIndex = String(GEN2_Z);
    document.body.appendChild(s);
    window.setTimeout(() => s.remove(), 800);
  }
  document.body.appendChild(glow);
  window.setTimeout(() => glow.remove(), 900);
}

/** war 被动触发成功战旗（触发源卡位置：双剑迸发赤金光 + 残破赤红战旗展开 2s） */
export function playWarVictoryFlag(sourceUid?: string, at?: { x: number; y: number }): void {
  let x: number;
  let y: number;
  if (sourceUid) {
    const node = document.querySelector<HTMLElement>(`[data-uid="${sourceUid}"]`);
    const r = node ? node.getBoundingClientRect() : null;
    if (r && r.width > 0) {
      x = r.left + r.width / 2;
      y = r.top + r.height / 2;
    } else if (at) {
      x = at.x;
      y = at.y;
    } else return;
  } else if (at) {
    x = at.x;
    y = at.y;
  } else return;
  const flag = document.createElement('div');
  flag.className = 'fx-war-flag';
  flag.style.left = `${x}px`;
  flag.style.top = `${y - 40}px`;
  flag.style.zIndex = String(GEN2_Z);
  // 战旗（残破赤红）+ 赤金光柱
  const banner = document.createElement('i');
  banner.className = 'fx-war-flag-banner';
  const pole = document.createElement('i');
  pole.className = 'fx-war-flag-pole';
  const light = document.createElement('i');
  light.className = 'fx-war-flag-light';
  flag.appendChild(pole);
  flag.appendChild(banner);
  flag.appendChild(light);
  document.body.appendChild(flag);
  window.setTimeout(() => flag.classList.add('in'), 20);
  window.setTimeout(() => flag.classList.add('out'), WAR_FLAG_MS);
  window.setTimeout(() => flag.remove(), WAR_FLAG_MS + 600);
}

/* ============================== courage 勇气：湖中剑 / 金逆焰 ==============================
 * ① 抽牌（card:drawn triggerProtocol=courage，勇气0/2/3 中抽牌）：抽出的卡上方斜斜插下一道
 *    鎏金湖中剑（剑身缠金色流光 + 飘散金色光羽）→ 大剑化金色光点消散 → 卡框鎏金发光 2s。
 *    抽牌卡入手牌重渲染前无 DOM → 以手牌末尾落点为承载（同 love settle 观感）。
 * ② 弃牌（card:discarded courage）：被弃卡被金色逆焰点燃（向下逆风燃烧金火苗）燃烧消散。
 * ③ 删除（card:deleted courage，勇气1 中）：湖中剑金色剑影横挥而过 → 被删卡化金色光点。
 * ④ 偏转（card:shifted courage，勇气3 底）：卡先被金圣光笼罩 → 落点炸开金色火环。
 * 层 body 级 fixed、JS 定时自清理（clearGen2Fx 兜底 .fx-courage-*）。 */
const COURAGE_GLOW_MS = 2000; // 卡框鎏金发光持续

/** 湖中剑（纯 CSS：鎏金剑身 + 剑柄十字护手 + 光羽），斜插 45° */
/** 亚瑟王风格湖中剑（双手大剑，竖直、剑尖朝下）——用户 2026-09-11：「和根棍子一样，重新优化」
 *  → 由「8px 细条 + 小护手」改为分部件写实造型：
 *  剑身（上宽下尖，带中央血槽 + 亮边磨光）+ 剑格上肩（ricasso）+ 宽十字护手 + 缠绕握柄 +
 *  圆剑柄头。所有部件尺寸用 em，容器 font-size = size/12 → 整体等比缩放（含已编译层复用）。
 *  容器默认 fixed（卡牌触发 FX）；已编译层用 .compiled-courage-sword 覆盖为 absolute。 */
export function buildLakeSword(size = 96): HTMLElement {
  const wrap = mk('div', 'fx-courage-sword');
  wrap.style.width = `${size}px`;
  wrap.style.height = `${size}px`;
  wrap.style.fontSize = `${(size / 12).toFixed(2)}px`;
  const blade = mk('i', 'fx-courage-sword-blade');
  blade.appendChild(mk('i', 'fx-courage-sword-fuller'));
  const ricasso = mk('i', 'fx-courage-sword-ricasso');
  const guard = mk('i', 'fx-courage-sword-guard');
  guard.appendChild(mk('i', 'fx-courage-sword-guard-tip l'));
  guard.appendChild(mk('i', 'fx-courage-sword-guard-tip r'));
  const grip = mk('i', 'fx-courage-sword-grip');
  const pommel = mk('i', 'fx-courage-sword-pommel');
  wrap.appendChild(blade);
  wrap.appendChild(ricasso);
  wrap.appendChild(guard);
  wrap.appendChild(grip);
  wrap.appendChild(pommel);
  // 光羽（小金星点绕剑飘；2026-09-12 用户：粒子更多 → 6 → 14 片）
  for (let i = 0; i < 14; i++) wrap.appendChild(mk('i', 'fx-courage-feather'));
  return wrap;
}

/** 湖中剑落点金色粒子迸发（用户 2026-09-12：附加上更多粒子效果）：
 *  以 (x,y) 为中心向四周炸开 count 颗鎏金火星 */
export function spawnCourageSparks(x: number, y: number, count = 16): void {
  for (let i = 0; i < count; i++) {
    const ang = (i / count) * Math.PI * 2 + Math.random() * 0.4;
    const dist = 34 + Math.random() * 78;
    const s = mk('i', 'fx-courage-spark');
    s.style.left = `${(x - 4).toFixed(1)}px`;
    s.style.top = `${(y - 4).toFixed(1)}px`;
    s.style.setProperty('--csx', `${(Math.cos(ang) * dist).toFixed(1)}px`);
    s.style.setProperty('--csy', `${(Math.sin(ang) * dist - 18).toFixed(1)}px`);
    s.style.animationDelay = `${(Math.random() * 0.12).toFixed(2)}s`;
    document.body.appendChild(s);
    window.setTimeout(() => s.remove(), 1200);
  }
}

/** 落点框（手牌末尾 / 指定位置） */
function courageLandPos(player: PlayerId): { x: number; y: number } | null {
  const hand = document.querySelectorAll<HTMLElement>('.hand')[player];
  if (!hand) return null;
  const rect = hand.getBoundingClientRect();
  const y = rect.top + rect.height / 2;
  const cards = hand.querySelectorAll<HTMLElement>('.card:not(.reveal-ghost)');
  const last = cards[cards.length - 1];
  if (last) {
    const r = last.getBoundingClientRect();
    return { x: player === 0 ? r.right + 37 : r.left - 37, y };
  }
  return { x: player === 0 ? rect.left + 93 : rect.right - 93, y };
}

/** courage 抽牌：手牌落点湖中剑斜插 + 卡框鎏金 2s */
export function playCourageDrawExtra(player: PlayerId): void {
  const land = courageLandPos(player);
  if (!land) return;
  // 剑身底部（剑尖）= (0.2em + 7.6em) / 12em × size（见 styles.css .fx-courage-sword-blade 定尺）
  const size = 96;
  const tipOffset = size * (7.8 / 12);
  const sword = buildLakeSword(size);
  sword.classList.add('fx-courage-draw-sword');
  sword.style.left = `${(land.x - size / 2).toFixed(1)}px`;
  sword.style.top = `${(land.y + 12 - tipOffset).toFixed(1)}px`; // 剑尖插在落点下方 12px
  sword.style.transformOrigin = '50% 65%'; // 以剑尖为旋转支点
  sword.style.zIndex = String(GEN2_Z);
  document.body.appendChild(sword);
  window.setTimeout(() => sword.classList.add('in'), 30);
  // 剑落定瞬间：金色粒子迸发（用户 2026-09-12：更多粒子）
  window.setTimeout(() => spawnCourageSparks(land.x, land.y + 10), 430);
  // 剑化金点消散 → 卡框鎏金 2s
  window.setTimeout(() => sword.classList.add('gone'), 900);
  const glow = document.createElement('div');
  glow.className = 'fx-courage-cardglow';
  glow.style.left = `${(land.x - 65).toFixed(1)}px`;
  glow.style.top = `${(land.y - 89.4).toFixed(1)}px`;
  glow.style.width = '130px';
  glow.style.height = '178.8px';
  glow.style.zIndex = String(GEN2_Z - 1);
  document.body.appendChild(glow);
  window.setTimeout(() => glow.classList.add('on'), 950);
  window.setTimeout(() => glow.classList.add('out'), COURAGE_GLOW_MS + 950);
  window.setTimeout(() => {
    sword.remove();
    glow.remove();
  }, COURAGE_GLOW_MS + 1600);
}

/** courage 弃牌：金逆焰点燃（向下逆风燃烧的火苗盖卡），随后 effects 基础切割 */
export function playCourageDiscardExtra(node: HTMLElement): void {
  const rect = node.getBoundingClientRect();
  if (rect.width === 0) return;
  const fire = document.createElement('div');
  fire.className = 'fx-courage-inferno';
  fire.style.left = `${rect.left - 8}px`;
  fire.style.top = `${rect.top - 8}px`;
  fire.style.width = `${rect.width + 16}px`;
  fire.style.height = `${rect.height + 16}px`;
  fire.style.zIndex = String(GEN2_Z);
  document.body.appendChild(fire);
  window.setTimeout(() => fire.classList.add('in'), 20);
  window.setTimeout(() => fire.remove(), 1300);
}

/** courage 删除（勇气1 中）：湖中剑金影横挥 → 化金点（基础破碎照常，本函数叠加剑影） */
export function playCourageDeleteExtra(node: HTMLElement): void {
  const rect = node.getBoundingClientRect();
  if (rect.width === 0) return;
  const slash = document.createElement('div');
  slash.className = 'fx-courage-slash';
  slash.style.left = `${rect.left - 30}px`;
  slash.style.top = `${rect.top - 20}px`;
  slash.style.width = `${rect.width + 60}px`;
  slash.style.height = `${rect.height + 40}px`;
  slash.style.zIndex = String(GEN2_Z);
  const blade = document.createElement('i');
  blade.className = 'fx-courage-slash-blade';
  slash.appendChild(blade);
  document.body.appendChild(slash);
  // 金点爆散（卡化金色光点）
  for (let i = 0; i < 10; i++) {
    const p = document.createElement('i');
    p.className = 'fx-courage-golddot';
    p.style.left = `${(rect.left + Math.random() * rect.width).toFixed(1)}px`;
    p.style.top = `${(rect.top + Math.random() * rect.height).toFixed(1)}px`;
    p.style.setProperty('--fx-gdx', `${(Math.random() * 90 - 45).toFixed(1)}px`);
    p.style.setProperty('--fx-gdy', `${(Math.random() * 70 - 30).toFixed(1)}px`);
    p.style.zIndex = String(GEN2_Z);
    document.body.appendChild(p);
    window.setTimeout(() => p.remove(), 900);
  }
  window.setTimeout(() => slash.classList.add('in'), 20);
  window.setTimeout(() => slash.remove(), 700);
}

/** courage 偏转（勇气3 底）：起点金圣光 + 湖中剑虚影指向目标链路 + 落点金火环
 *  （提示词：卡牌先被一圈金色圣光笼罩，随后一道湖中剑的金色虚影浮现并指向目标链路，
 *   卡牌沿剑影所指方向偏转过去，落点炸开一圈金色火环。基础飞行由 effects 照常播放。） */
export function playCourageShiftExtra(node: HTMLElement, payload: { owner?: PlayerId; line?: number | null }): void {
  if (payload.owner === undefined || payload.line == null) return;
  const rect = node.getBoundingClientRect();
  if (rect.width === 0) return;
  // 落点（目标槽 stackEnd：末卡外缘 / 槽内首卡位）——剑影与火环共用
  const slot = document.querySelector<HTMLElement>(`.stack-slot[data-player="${payload.owner}"][data-line="${payload.line}"]`);
  const startX = rect.left + rect.width / 2;
  const startY = rect.top + rect.height / 2;
  let landX = startX;
  let landY = startY;
  if (slot) {
    const sr = slot.getBoundingClientRect();
    landY = sr.top + sr.height / 2;
    const cards = slot.querySelectorAll<HTMLElement>('.card');
    const last = cards.length > 0 ? cards[cards.length - 1] : null;
    landX = last
      ? (() => {
          const r = last.getBoundingClientRect();
          return payload.owner === 0 ? r.left - 65 : r.right + 65;
        })()
      : payload.owner === 0
        ? sr.right - 90
        : sr.left + 90;
  }
  // 起点金圣光
  const halo = document.createElement('div');
  halo.className = 'fx-courage-halo';
  halo.style.left = `${rect.left - 10}px`;
  halo.style.top = `${rect.top - 10}px`;
  halo.style.width = `${rect.width + 20}px`;
  halo.style.height = `${rect.height + 20}px`;
  halo.style.zIndex = String(GEN2_Z - 2);
  document.body.appendChild(halo);
  window.setTimeout(() => halo.classList.add('in'), 20);
  window.setTimeout(() => halo.remove(), 900);
  // 湖中剑金色虚影：剑尖锚在起点、剑身指向目标链路（用户 2026-09-11：此剑影此前缺失）
  const SHADOW_SIZE = 118;
  const shadow = buildLakeSword(SHADOW_SIZE);
  shadow.classList.add('fx-courage-sword-shadow');
  shadow.style.left = `${(startX - SHADOW_SIZE / 2).toFixed(1)}px`;
  shadow.style.top = `${(startY - SHADOW_SIZE * (7.8 / 12)).toFixed(1)}px`;
  shadow.style.transformOrigin = '50% 65%'; // 以剑尖为支点
  const ang = (Math.atan2(landY - startY, landX - startX) * 180) / Math.PI;
  shadow.style.transform = `rotate(${(ang - 90).toFixed(1)}deg)`; // 剑尖（默认朝下）转向目标
  shadow.style.zIndex = String(GEN2_Z);
  document.body.appendChild(shadow);
  window.setTimeout(() => shadow.classList.add('in'), 30);
  window.setTimeout(() => shadow.classList.add('out'), 620);
  window.setTimeout(() => shadow.remove(), 1100);
  // 落点金火环（基础飞行到达后炸开）
  window.setTimeout(() => {
    const ring = document.createElement('div');
    ring.className = 'fx-courage-ring';
    ring.style.left = `${landX - 40}px`;
    ring.style.top = `${landY - 40}px`;
    ring.style.zIndex = String(GEN2_Z - 1);
    document.body.appendChild(ring);
    window.setTimeout(() => ring.classList.add('in'), 20);
    window.setTimeout(() => ring.remove(), 900);
  }, 300);
}

/* ============================== time 时间：古铜时钟 / 光流 ==============================
 * ① 弃牌堆相关效果（time-0 从弃牌堆打出 / time-1 牌库入弃牌堆 / time-2 弃牌堆洗入 /
 *    time-3 揭示弃牌堆）→ 弃牌堆上方亮起古铜时钟虚影（时针分针不同速旋转 + 表盘古铜光）
 *    + 弃牌堆边框古铜发光 → 效果结束时钟缓缓消散。
 * ② time-1 光流（time:deck-to-trash）：牌库卡化作一道古铜时间流光汇入弃牌堆（光带）。
 * ③ time 弃牌（card:discarded protocol=time）：被弃卡被古铜时间光膜包裹（"时间冻结"感）
 *    缓慢飞入弃牌堆（effects 基础切割由 flyToTrash 替代？——time 弃牌走基础切割照常，
 *    本函数叠加光膜层）。
 * 层 body 级 fixed、JS 定时自清理（clearGen2Fx 兜底 .fx-time-*）。 */
const TIME_CLOCK_MS = 2400; // 时钟虚影停留
const TIME_TRASH_W = 120;
const TIME_TRASH_H = 150;

/** 该玩家弃牌堆区中心 */
function timeTrashCenter(player: PlayerId): { x: number; y: number } | null {
  const pile = document.querySelector<HTMLElement>(`.trash-pile[data-player="${player}"]`);
  if (!pile) return null;
  const r = pile.getBoundingClientRect();
  if (r.width === 0) return null;
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

/** 弃牌堆时钟虚影：古铜圆盘 + 时针 + 分针（不同速旋转） + 齿轮小齿环 */
function spawnTrashClock(player: PlayerId): void {
  const c = timeTrashCenter(player);
  if (!c) return;
  const clock = document.createElement('div');
  clock.className = 'fx-time-clock';
  clock.style.left = `${c.x - 46}px`;
  clock.style.top = `${c.y - 46 - 40}px`;
  clock.style.zIndex = String(GEN2_Z);
  const dial = document.createElement('i');
  dial.className = 'fx-time-clock-dial';
  const hour = document.createElement('i');
  hour.className = 'fx-time-clock-hand hour';
  const minute = document.createElement('i');
  minute.className = 'fx-time-clock-hand minute';
  dial.appendChild(hour);
  dial.appendChild(minute);
  clock.appendChild(dial);
  // 弃牌堆边框古铜光（覆盖弃牌堆区）
  const glow = document.createElement('div');
  glow.className = 'fx-time-trashglow';
  const pile = document.querySelector<HTMLElement>(`.trash-pile[data-player="${player}"]`);
  if (pile) {
    const r = pile.getBoundingClientRect();
    glow.style.left = `${r.left - 6}px`;
    glow.style.top = `${r.top - 6}px`;
    glow.style.width = `${r.width + 12}px`;
    glow.style.height = `${r.height + 12}px`;
  }
  glow.style.zIndex = String(GEN2_Z - 1);
  document.body.appendChild(clock);
  document.body.appendChild(glow);
  window.setTimeout(() => {
    clock.classList.add('in');
    glow.classList.add('in');
  }, 20);
  window.setTimeout(() => {
    clock.classList.add('out');
    glow.classList.add('out');
  }, TIME_CLOCK_MS);
  window.setTimeout(() => {
    clock.remove();
    glow.remove();
  }, TIME_CLOCK_MS + 700);
}

/** time-1 光流：弃牌堆上时钟 + 牌库 → 弃牌堆的古铜光带（time:deck-to-trash 事件） */
function onTimeDeckToTrash(p: { player?: PlayerId }): void {
  if (p.player === undefined) return;
  spawnTrashClock(p.player);
  // 光带：牌库 → 弃牌堆
  const deck = document.querySelector<HTMLElement>(`.deck[data-player="${p.player}"]`);
  const trash = document.querySelector<HTMLElement>(`.trash-pile[data-player="${p.player}"]`);
  if (!deck || !trash) return;
  const dr = deck.getBoundingClientRect();
  const tr = trash.getBoundingClientRect();
  if (dr.width === 0 || tr.width === 0) return;
  const sx = dr.left + dr.width / 2;
  const sy = dr.top + dr.height / 2;
  const tx = tr.left + tr.width / 2;
  const ty = tr.top + tr.height / 2;
  const dx = tx - sx;
  const dy = ty - sy;
  const dist = Math.hypot(dx, dy);
  if (dist < 10) return;
  const band = document.createElement('div');
  band.className = 'fx-time-band';
  band.style.left = `${sx}px`;
  band.style.top = `${sy}px`;
  band.style.width = `${dist}px`;
  band.style.transform = `rotate(${(Math.atan2(dy, dx) * 180) / Math.PI}deg)`;
  band.style.zIndex = String(GEN2_Z - 2);
  document.body.appendChild(band);
  window.setTimeout(() => band.classList.add('in'), 20);
  window.setTimeout(() => band.remove(), 1400);
}

/** time 弃牌古铜光膜（叠加；effects 基础切割照常） */
export function playTimeDiscardExtra(node: HTMLElement): void {
  const rect = node.getBoundingClientRect();
  if (rect.width === 0) return;
  const film = document.createElement('div');
  film.className = 'fx-time-film';
  film.style.left = `${rect.left - 6}px`;
  film.style.top = `${rect.top - 6}px`;
  film.style.width = `${rect.width + 12}px`;
  film.style.height = `${rect.height + 12}px`;
  film.style.zIndex = String(GEN2_Z);
  document.body.appendChild(film);
  window.setTimeout(() => film.classList.add('in'), 20);
  window.setTimeout(() => film.remove(), 1100);
}

/** time-2 顶沙漏：牌库上方浮现旋转古铜沙漏（沙粒向上倒流 → 旋转一圈后消失）。
 *  触发：card:drawn + triggerProtocol=time（time-2 顶「当你切洗牌库时：抽取1张牌」）。 */
export function playTimeHourglass(player: PlayerId): void {
  const deck = document.querySelector<HTMLElement>(`.deck[data-player="${player}"]`);
  if (!deck) return;
  const r = deck.getBoundingClientRect();
  if (r.width === 0) return;
  const cx = r.left + r.width / 2;
  const topY = r.top;
  const hg = document.createElement('div');
  hg.className = 'fx-time-hourglass';
  hg.style.left = `${cx - 30}px`;
  hg.style.top = `${topY - 84}px`;
  hg.style.zIndex = String(GEN2_Z);
  // 上下沙球 + 腰部（古铜）
  hg.appendChild(Object.assign(document.createElement('i'), { className: 'fx-time-hourglass-top' }));
  hg.appendChild(Object.assign(document.createElement('i'), { className: 'fx-time-hourglass-waist' }));
  hg.appendChild(Object.assign(document.createElement('i'), { className: 'fx-time-hourglass-bottom' }));
  // 沙粒（上球内金色小点向上飘 → 倒流感）
  for (let i = 0; i < 4; i++) {
    const g = document.createElement('i');
    g.className = 'fx-time-sand';
    g.style.animationDelay = `${(i * 0.3).toFixed(2)}s`;
    hg.appendChild(g);
  }
  document.body.appendChild(hg);
  window.setTimeout(() => hg.classList.add('in'), 20);
  // 旋转一圈后消失（提示词：沙漏旋转一圈后渐渐消失）
  window.setTimeout(() => hg.classList.add('out'), 2400);
  window.setTimeout(() => hg.remove(), 3000);
}

/* ============================== assimilation 同化：青碧涟漪 / 光环 ==============================
 * ① 弃牌（card:discarded triggerProtocol=assimilation 非 toTrashOf——同化5/1 中弃自己手牌）：
 *    被弃卡被一圈青碧光环套住 → 光环收缩后卡化青碧光点消散（前置；effects 延后基础切割）。
 * ② 牌库顶反打（deckTopTransfer 的 card:deck-played triggerProtocol=assimilation）：打出的
 *    卡从牌库顶带着一圈青碧涟漪浮现 → 缓缓落入堆叠并翻成反面（基础 deck-play 飞行照常，
 *    本函数在牌库区叠加青碧涟漪层）。
 * 层 body 级 fixed、JS 定时自清理（clearGen2Fx 兜底 .fx-assim-*）。 */
const ASSIM_DISCARD_PRE_MS_FX = 700; // 青碧环收缩时长（前置）
export const ASSIM_DISCARD_PRE_MS = ASSIM_DISCARD_PRE_MS_FX + 300;

/** 青碧光环（CSS 环收缩动画） */
function buildAssimRing(rect: DOMRect, color = 'rgba(80, 220, 190, 0.9)'): HTMLElement {
  const ring = document.createElement('div');
  ring.className = 'fx-assim-ring';
  ring.style.left = `${rect.left - 10}px`;
  ring.style.top = `${rect.top - 10}px`;
  ring.style.width = `${rect.width + 20}px`;
  ring.style.height = `${rect.height + 20}px`;
  ring.style.borderColor = color;
  ring.style.zIndex = String(GEN2_Z);
  document.body.appendChild(ring);
  window.setTimeout(() => ring.classList.add('in'), 20);
  return ring;
}

/** assimilation 弃牌青碧环（前置段；effects 延后基础切割） */
export function playAssimDiscardExtra(node: HTMLElement): void {
  const rect = node.getBoundingClientRect();
  if (rect.width === 0) return;
  const ring = buildAssimRing(rect);
  // 光环收缩后卡化青碧光点（小光点四散）
  window.setTimeout(() => {
    for (let i = 0; i < 8; i++) {
      const s = document.createElement('i');
      s.className = 'fx-assim-speck';
      s.style.left = `${(rect.left + Math.random() * rect.width).toFixed(1)}px`;
      s.style.top = `${(rect.top + Math.random() * rect.height).toFixed(1)}px`;
      s.style.setProperty('--fx-adx', `${(Math.random() * 70 - 35).toFixed(1)}px`);
      s.style.setProperty('--fx-ady', `${(Math.random() * 50 - 25).toFixed(1)}px`);
      s.style.zIndex = String(GEN2_Z);
      document.body.appendChild(s);
      window.setTimeout(() => s.remove(), 800);
    }
  }, 450);
  window.setTimeout(() => ring.remove(), ASSIM_DISCARD_PRE_MS + 400);
}

/** assimilation 牌库顶反打青碧涟漪（牌库区；基础 deck-play 照常） */
export function playAssimDeckRipple(player: PlayerId): void {
  const deck = document.querySelector<HTMLElement>(`.deck[data-player="${player}"]`);
  if (!deck) return;
  const r = deck.getBoundingClientRect();
  if (r.width === 0) return;
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  for (let i = 0; i < 2; i++) {
    const ripple = document.createElement('div');
    ripple.className = 'fx-assim-ripple';
    ripple.style.left = `${cx - 40}px`;
    ripple.style.top = `${cy - 40}px`;
    ripple.style.zIndex = String(GEN2_Z - 1);
    ripple.style.animationDelay = `${i * 0.25}s`;
    document.body.appendChild(ripple);
    window.setTimeout(() => ripple.remove(), 1200);
  }
}

/* ============================== unity 联合：亮蓝连携光带 ==============================
 * unity 卡效果触发时（其 op 事件 triggerProtocol=unity）：该卡与场上其它联合卡之间短暂
 * 连接亮蓝光带（表示联合关系）。源卡 = triggerUid；目标 = 场上其它 unity 卡（state 查询
 * defId 前缀 → DOM 定位 rect → 源卡向每张目标拉光带，0.7s 渐显消散）。
 * 层 body 级 fixed、JS 定时自清理（clearGen2Fx 兜底 .fx-unity-*）。 */
const UNITY_LINK_MS = 750;

/** 场上双方链路中某协议的卡 uid 列表 */
function fieldUidsOfProtocol(s: GameState, protocol: string): string[] {
  const out: string[] = [];
  for (const p of s.players) {
    for (const line of [0, 1, 2] as const) {
      for (const c of p.stacks[line]) {
        if (c.defId.startsWith(`${protocol}-`)) out.push(c.uid);
      }
    }
  }
  return out;
}

/** unity 连携光带：源卡向场上其它 unity 卡拉亮蓝光带 */
function playUnityLink(s: GameState, sourceUid: string): void {
  const src = document.querySelector<HTMLElement>(`[data-uid="${sourceUid}"]`);
  if (!src) return;
  const sr = src.getBoundingClientRect();
  if (sr.width === 0) return;
  const sx = sr.left + sr.width / 2;
  const sy = sr.top + sr.height / 2;
  const targets = fieldUidsOfProtocol(s, 'unity').filter((u) => u !== sourceUid);
  for (const uid of targets) {
    const node = document.querySelector<HTMLElement>(`[data-uid="${uid}"]`);
    if (!node) continue;
    const r = node.getBoundingClientRect();
    if (r.width === 0) continue;
    const tx = r.left + r.width / 2;
    const ty = r.top + r.height / 2;
    const dx = tx - sx;
    const dy = ty - sy;
    const dist = Math.hypot(dx, dy);
    if (dist < 10) continue;
    const link = document.createElement('div');
    link.className = 'fx-unity-link';
    link.style.left = `${sx}px`;
    link.style.top = `${sy}px`;
    link.style.width = `${dist}px`;
    link.style.transform = `rotate(${(Math.atan2(dy, dx) * 180) / Math.PI}deg)`;
    link.style.zIndex = String(GEN2_Z - 2);
    document.body.appendChild(link);
    window.setTimeout(() => link.classList.add('in'), 20);
    window.setTimeout(() => link.classList.add('out'), 500);
    window.setTimeout(() => link.remove(), UNITY_LINK_MS + 120);
  }
}

/* ============================== diversity 多元：彩色光环 / 光尘 ==============================
 * 弃牌（card:discarded triggerProtocol=diversity，多元5 弃牌）：被弃卡先被一圈彩色光环
 * 套住 → 化作彩色光尘消散（前置；effects 延后基础切割）。层 body 级 fixed、JS 自清理。 */
const DIVERSITY_DISCARD_PRE_MS_FX = 650;
export const DIVERSITY_DISCARD_PRE_MS = DIVERSITY_DISCARD_PRE_MS_FX + 300;

export function playDiversityDiscardExtra(node: HTMLElement): void {
  const rect = node.getBoundingClientRect();
  if (rect.width === 0) return;
  const ring = document.createElement('div');
  ring.className = 'fx-diversity-ring';
  ring.style.left = `${rect.left - 10}px`;
  ring.style.top = `${rect.top - 10}px`;
  ring.style.width = `${rect.width + 20}px`;
  ring.style.height = `${rect.height + 20}px`;
  ring.style.zIndex = String(GEN2_Z);
  document.body.appendChild(ring);
  window.setTimeout(() => ring.classList.add('in'), 20);
  // 彩光尘四散
  window.setTimeout(() => {
    const COLORS = ['#ff5a6e', '#ffd24d', '#4ee0c0', '#5aa0ff', '#c07bff'];
    for (let i = 0; i < 12; i++) {
      const s = document.createElement('i');
      s.className = 'fx-diversity-dust';
      s.style.left = `${(rect.left + Math.random() * rect.width).toFixed(1)}px`;
      s.style.top = `${(rect.top + Math.random() * rect.height).toFixed(1)}px`;
      s.style.background = COLORS[Math.floor(Math.random() * COLORS.length)];
      s.style.setProperty('--fx-dvx', `${(Math.random() * 80 - 40).toFixed(1)}px`);
      s.style.setProperty('--fx-dvy', `${(Math.random() * 60 - 30).toFixed(1)}px`);
      s.style.zIndex = String(GEN2_Z);
      document.body.appendChild(s);
      window.setTimeout(() => s.remove(), 900);
    }
  }, 420);
  window.setTimeout(() => ring.remove(), DIVERSITY_DISCARD_PRE_MS + 400);
}

/** 多元主题色常量（光球/光晕/彩虹环共用的 5 色） */
const DIVERSITY_COLORS = ['#ff5a6e', '#ffd24d', '#4ee0c0', '#5aa0ff', '#c07bff'];

/** 手牌落点坐标（第 indexFromEnd 张即将落入手牌的卡；与 effects/index handEndPos 同款算法） */
function handLandingPos(player: PlayerId, indexFromEnd: number): { x: number; y: number } | null {
  const hand = document.querySelectorAll<HTMLElement>('.hand')[player];
  if (!hand) return null;
  const rect = hand.getBoundingClientRect();
  if (rect.width === 0) return null;
  const y = rect.top + rect.height / 2;
  const cards = hand.querySelectorAll<HTMLElement>('.card:not(.reveal-ghost)');
  const last = cards.length > 0 ? cards[cards.length - 1] : null;
  const baseX = last
    ? (player === 0 ? last.getBoundingClientRect().right + 37 : last.getBoundingClientRect().left - 37)
    : (player === 0 ? rect.left + 128 : rect.right - 128);
  // P1 手牌向右排布、P2 向左（row-reverse）→ 后续卡沿排列方向递进 102px（hand 卡距）
  const step = player === 0 ? 102 : -102;
  return { x: baseX + step * indexFromEnd, y };
}

/** 彩光尘（多元通用）：在矩形内随机点炸开 count 颗彩色光点 */
function spawnDiversityDust(rect: DOMRect, count = 12): void {
  for (let i = 0; i < count; i++) {
    const s = mk('i', 'fx-diversity-dust');
    s.style.left = `${(rect.left + Math.random() * rect.width).toFixed(1)}px`;
    s.style.top = `${(rect.top + Math.random() * rect.height).toFixed(1)}px`;
    s.style.background = DIVERSITY_COLORS[Math.floor(Math.random() * DIVERSITY_COLORS.length)];
    s.style.setProperty('--fx-dvx', `${(Math.random() * 80 - 40).toFixed(1)}px`);
    s.style.setProperty('--fx-dvy', `${(Math.random() * 60 - 30).toFixed(1)}px`);
    s.style.zIndex = String(GEN2_Z);
    document.body.appendChild(s);
    window.setTimeout(() => s.remove(), 900);
  }
}

/** diversity-1 中「偏转1张牌」：被偏转卡化为一颗彩色光球滑向目标位置
 *  （光球垫在基础飞行卡之下 → 读作卡被光球包裹着滑过去；用户 2026-09-11：此特效此前缺失） */
export function playDiversityShiftExtra(payload: { uid?: string; owner?: PlayerId; line?: number | null }): void {
  if (!payload.uid || payload.owner === undefined || payload.line == null) return;
  const node = document.querySelector<HTMLElement>(`[data-uid="${payload.uid}"]`);
  if (!node) return;
  const rect = node.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return;
  const end = iceStackEnd(payload.owner, payload.line);
  if (!end) return;
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const size = Math.max(rect.width, rect.height) * 1.05;
  const orb = mk('div', 'fx-diversity-orb');
  orb.style.width = `${size.toFixed(1)}px`;
  orb.style.height = `${size.toFixed(1)}px`;
  orb.style.left = `${(cx - size / 2).toFixed(1)}px`;
  orb.style.top = `${(cy - size / 2).toFixed(1)}px`;
  orb.style.zIndex = String(GEN2_Z - 1); // 基础飞行卡（BASE_Z 300）之下
  document.body.appendChild(orb);
  spawnDiversityDust(rect, 10);
  // 与基础 MOVE_MS(450ms) 同步滑向目标
  window.setTimeout(() => {
    orb.style.transition = 'transform 450ms cubic-bezier(0.25, 0.8, 0.4, 1), opacity 480ms ease-out';
    orb.style.transform = `translate(${(end.x - cx).toFixed(1)}px, ${(end.y - cy).toFixed(1)}px) scale(0.78)`;
    orb.style.opacity = '0.9';
  }, 30);
  window.setTimeout(() => orb.classList.add('out'), 520);
  window.setTimeout(() => orb.remove(), 1100);
}

/** diversity-1「抽取与此链路中不同协议的卡牌数相同的卡牌」：每张被抽卡带一圈
 *  【该卡所属协议主题色】的光晕（用户 2026-09-11：此特效此前缺失） */
function onDiversityDrawn(p: { player?: PlayerId; count?: number }, s?: GameState): void {
  if (p.player === undefined || !s) return;
  const count = p.count ?? 1;
  const hand = s.players[p.player].hand;
  const drawn = hand.slice(-count);
  for (let k = 0; k < drawn.length; k++) {
    const color = protocolColorOf(drawn[k].defId);
    const pos = handLandingPos(p.player, k);
    if (!pos) continue;
    window.setTimeout(() => {
      const halo = mk('div', 'fx-diversity-halo');
      halo.style.setProperty('--dc', color);
      halo.style.setProperty('--dcg', hexToRgba(color, 0.8));
      halo.style.left = `${(pos.x - 65).toFixed(1)}px`;
      halo.style.top = `${(pos.y - 89.4).toFixed(1)}px`;
      halo.style.zIndex = String(GEN2_Z - 2);
      document.body.appendChild(halo);
      window.setTimeout(() => halo.classList.add('in'), 20);
      window.setTimeout(() => halo.classList.remove('in'), 620);
      window.setTimeout(() => halo.remove(), 1100);
    }, k * 120);
  }
}

/** diversity-4 中「翻转1张牌」：被选中的卡先被一圈七彩光环套住 → 光环缓缓收缩 → 翻转 → 消散
 *  （用户 2026-09-11：此特效此前缺失） */
export function playDiversityFlipExtra(payload: { uid?: string }): void {
  if (!payload.uid) return;
  const node = document.querySelector<HTMLElement>(`[data-uid="${payload.uid}"]`);
  if (!node) return;
  const rect = node.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return;
  const ring = mk('div', 'fx-diversity-rainbow-ring');
  ring.style.left = `${(rect.left - 14).toFixed(1)}px`;
  ring.style.top = `${(rect.top - 14).toFixed(1)}px`;
  ring.style.width = `${(rect.width + 28).toFixed(1)}px`;
  ring.style.height = `${(rect.height + 28).toFixed(1)}px`;
  ring.style.zIndex = String(GEN2_Z - 1);
  document.body.appendChild(ring);
  window.setTimeout(() => ring.classList.add('in'), 20);
  window.setTimeout(() => ring.classList.remove('in'), 640);
  window.setTimeout(() => ring.remove(), 1200);
}

/* ============================== assimilation 同化：卡牌触发特效（用户 2026-09-11 补做）
 * 提示词要求：
 *  - 同化0 中（对手正面朝下卡加入手牌）：选中卡先泛青碧涟漪 → 化为青碧光点弧线飞入手牌 →
 *    落入手牌闪过一圈青碧光（基础回手飞行由 effects/index 的 playReturn 照常播放）；
 *  - 同化1 中（弃1 + 刷新）：刷新时自己的协议短暂泛青碧光泽（弃牌光环已由 playAssimDiscardExtra 提供）；
 *  - 同化1 底 / 同化4 中（跨方牌库抽牌）：两副牌库之间浮现青碧光带，卡沿光带飞向对方手牌。
 * 事件：card:returned（takeFromField）/ card:drawn（fromOpponentDeck / triggerDefId=assimilation-1）。 */
const ASSIM_CYAN = '#2ec9a8';
const ASSIM_CYAN_SOFT = 'rgba(110, 235, 205, 0.85)';

/** 玩家牌库中心（青碧光带端点） */
function deckCenter(player: PlayerId): { x: number; y: number } | null {
  const deck = document.querySelector<HTMLElement>(`.deck[data-player="${player}"]`);
  if (!deck) return null;
  const r = deck.getBoundingClientRect();
  if (r.width === 0) return null;
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

/** 两点之间的一条光带（旋转矩形，cls 控制配色；color 可选 → 写 --bc 供 CSS 取色） */
function spawnBand(
  from: { x: number; y: number },
  to: { x: number; y: number },
  cls: string,
  holdMs = 900,
  color?: string,
): void {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dist = Math.hypot(dx, dy);
  if (dist < 10) return;
  const ang = (Math.atan2(dy, dx) * 180) / Math.PI;
  const band = mk('div', cls);
  band.style.left = `${from.x.toFixed(1)}px`;
  band.style.top = `${from.y.toFixed(1)}px`;
  band.style.width = `${dist.toFixed(1)}px`;
  band.style.transform = `rotate(${ang.toFixed(1)}deg)`;
  band.style.zIndex = String(GEN2_Z - 2);
  if (color) {
    band.style.setProperty('--bc', color);
    band.style.setProperty('--bcg', hexToRgba(color, 0.85));
  }
  document.body.appendChild(band);
  window.setTimeout(() => band.classList.add('in'), 20);
  window.setTimeout(() => band.classList.add('out'), holdMs);
  window.setTimeout(() => band.remove(), holdMs + 650);
}

/** 多元0 顶部持续效果达成（场上有 6 张不同协议卡 → 多元协议翻至已编译）：
 *  场上每种协议的卡各亮一道【本协议主题色】光柱，6 道光柱同时汇聚到多元0 卡上 →
 *  多元0 迸发一团彩色光芒（用户 2026-09-11 提示词；2026-09-12 补做 + 引擎事件接线）。
 *  state 由事件携带（结算瞬间的场上构成）。 */
export function playDiversityConvergence(sourceUid: string, s: GameState): void {
  const node = document.querySelector<HTMLElement>(`[data-uid="${sourceUid}"]`);
  const rect = node?.getBoundingClientRect();
  if (!rect || rect.width === 0) return;
  const target = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  // 场上一张「各协议代表卡」（去重协议，最多 6 张）
  const reps: { uid: string; color: string }[] = [];
  const seen = new Set<string>();
  for (const owner of [0, 1] as PlayerId[]) {
    for (const st of s.players[owner].stacks) {
      for (const c of st) {
        const proto = c.defId.split('-')[0];
        if (seen.has(proto) || reps.length >= 6) continue;
        seen.add(proto);
        reps.push({ uid: c.uid, color: protocolColorOf(c.defId) });
      }
    }
  }
  for (const rep of reps) {
    const n = document.querySelector<HTMLElement>(`[data-uid="${rep.uid}"]`);
    if (!n) continue;
    const r = n.getBoundingClientRect();
    if (r.width === 0) continue;
    const from = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    // ① 卡上亮起本协议色光柱（向上冲起）
    const pillar = mk('div', 'fx-div0-pillar');
    pillar.style.setProperty('--bc', rep.color);
    pillar.style.setProperty('--bcg', hexToRgba(rep.color, 0.85));
    pillar.style.left = `${(from.x - 13).toFixed(1)}px`;
    pillar.style.top = `${(from.y - 96).toFixed(1)}px`;
    pillar.style.zIndex = String(GEN2_Z - 3);
    document.body.appendChild(pillar);
    window.setTimeout(() => pillar.classList.add('in'), 30);
    window.setTimeout(() => pillar.classList.remove('in'), 900);
    window.setTimeout(() => pillar.remove(), 1400);
    // ② 光柱本体沿直线汇聚到多元0 卡
    spawnBand(from, target, 'fx-div0-beam', 950, rep.color);
  }
  // ③ 多元0 卡：彩光迸发 + 彩色光环
  window.setTimeout(() => {
    const burst = mk('div', 'fx-div0-burst');
    burst.style.left = `${rect.left.toFixed(1)}px`;
    burst.style.top = `${rect.top.toFixed(1)}px`;
    burst.style.width = `${rect.width.toFixed(1)}px`;
    burst.style.height = `${rect.height.toFixed(1)}px`;
    burst.style.zIndex = String(GEN2_Z);
    document.body.appendChild(burst);
    window.setTimeout(() => burst.classList.add('in'), 20);
    window.setTimeout(() => burst.remove(), 1200);
    for (let i = 0; i < 18; i++) {
      const s = mk('i', 'fx-div0-mote');
      s.style.left = `${(target.x - 5).toFixed(1)}px`;
      s.style.top = `${(target.y - 5).toFixed(1)}px`;
      s.style.background = DIVERSITY_COLORS[i % 5];
      const ang = (i / 18) * Math.PI * 2;
      const dist = 40 + Math.random() * 90;
      s.style.setProperty('--dx', `${(Math.cos(ang) * dist).toFixed(1)}px`);
      s.style.setProperty('--dy', `${(Math.sin(ang) * dist).toFixed(1)}px`);
      s.style.zIndex = String(GEN2_Z);
      document.body.appendChild(s);
      window.setTimeout(() => s.remove(), 1100);
    }
  }, 900);
}

/** 同化0：被取卡的青碧涟漪 + 化为光点沿弧线飞向 owner 手牌 + 落点青碧闪环 */
export function playAssimTakeExtra(payload: { uid?: string; owner?: PlayerId }): void {
  if (!payload.uid || payload.owner === undefined) return;
  const node = document.querySelector<HTMLElement>(`[data-uid="${payload.uid}"]`);
  if (!node) return;
  const rect = node.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return;
  // ① 起点青碧涟漪（三圈错相扩散）
  for (let i = 0; i < 3; i++) {
    window.setTimeout(() => spawnAssimRing(rect, ASSIM_CYAN_SOFT), i * 130);
  }
  const from = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  const to = handLandingPos(payload.owner!, 0);
  if (!to) return;
  // ② 青碧光点沿弧线飞入手牌（二次贝塞尔采样，8 段折线过渡）
  const dot = mk('i', 'fx-assim-dot');
  dot.style.left = `${(from.x - 9).toFixed(1)}px`;
  dot.style.top = `${(from.y - 9).toFixed(1)}px`;
  dot.style.zIndex = String(GEN2_Z);
  document.body.appendChild(dot);
  const midX = (from.x + to.x) / 2;
  const midY = Math.min(from.y, to.y) - 90; // 向上拱起 → 弧线
  const steps = 8;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const mt = 1 - t;
    const x = mt * mt * from.x + 2 * mt * t * midX + t * t * to.x;
    const y = mt * mt * from.y + 2 * mt * t * midY + t * t * to.y;
    window.setTimeout(() => {
      dot.style.transition = `transform 120ms linear, opacity 140ms ease-out`;
      dot.style.transform = `translate(${(x - from.x).toFixed(1)}px, ${(y - from.y).toFixed(1)}px) scale(${(1 - 0.4 * t).toFixed(2)})`;
      if (i === steps) dot.style.opacity = '0';
    }, 30 + i * 120);
  }
  window.setTimeout(() => dot.remove(), 1600);
  // ③ 落入手牌：闪过一圈青碧光
  window.setTimeout(() => {
    const flash = mk('div', 'fx-assim-land');
    flash.style.left = `${(to.x - 65).toFixed(1)}px`;
    flash.style.top = `${(to.y - 89.4).toFixed(1)}px`;
    flash.style.zIndex = String(GEN2_Z - 1);
    document.body.appendChild(flash);
    window.setTimeout(() => flash.classList.add('in'), 20);
    window.setTimeout(() => flash.remove(), 900);
  }, 30 + steps * 120 + 90);
}

/** 青碧涟漪环（同化通用；rect 处生成一圈扩散环） */
function spawnAssimRing(rect: DOMRect, color: string): void {
  const ring = mk('div', 'fx-assim-ring');
  ring.style.left = `${(rect.left - 10).toFixed(1)}px`;
  ring.style.top = `${(rect.top - 10).toFixed(1)}px`;
  ring.style.width = `${(rect.width + 20).toFixed(1)}px`;
  ring.style.height = `${(rect.height + 20).toFixed(1)}px`;
  ring.style.borderColor = color;
  ring.style.zIndex = String(GEN2_Z - 1);
  document.body.appendChild(ring);
  window.setTimeout(() => ring.classList.add('in'), 20);
  window.setTimeout(() => ring.remove(), 1000);
}

/** 同化1 中：刷新时自己的协议短暂泛起青碧色光泽 */
export function playAssimRefreshGloss(player: PlayerId): void {
  const boxes = document.querySelectorAll<HTMLElement>(
    `.protocol-cell[data-player="${player}"] .protocol-holder`
  );
  const nodes: HTMLElement[] = Array.from(boxes);
  for (const holder of nodes) {
    const r = holder.getBoundingClientRect();
    if (r.width === 0) continue;
    const gloss = mk('div', 'fx-assim-gloss');
    gloss.style.left = `${r.left - 4}px`;
    gloss.style.top = `${r.top - 4}px`;
    gloss.style.width = `${r.width + 8}px`;
    gloss.style.height = `${r.height + 8}px`;
    gloss.style.zIndex = String(GEN2_Z - 2);
    document.body.appendChild(gloss);
    window.setTimeout(() => gloss.classList.add('in'), 20);
    window.setTimeout(() => gloss.classList.remove('in'), 900);
    window.setTimeout(() => gloss.remove(), 1400);
  }
}

/** 同化1 底 / 同化4 中：跨方牌库抽牌 → 两副牌库之间浮现青碧光带，卡沿光带飞向对方手牌 */
export function playAssimExchangeBand(drawer: PlayerId): void {
  const source = deckCenter(drawer === 0 ? 1 : 0);
  const target = deckCenter(drawer);
  if (!source || !target) return;
  spawnBand(source, target, 'fx-assim-band', 900);
  // 光带上的青碧光点（沿带滑行）
  const dot = mk('i', 'fx-assim-dot');
  dot.style.left = `${(source.x - 9).toFixed(1)}px`;
  dot.style.top = `${(source.y - 9).toFixed(1)}px`;
  dot.style.zIndex = String(GEN2_Z - 1);
  document.body.appendChild(dot);
  window.setTimeout(() => {
    dot.style.transition = 'transform 420ms cubic-bezier(0.3, 0.7, 0.4, 1), opacity 300ms ease-out';
    dot.style.transform = `translate(${(target.x - source.x).toFixed(1)}px, ${(target.y - source.y).toFixed(1)}px) scale(0.6)`;
    dot.style.opacity = '0';
  }, 40);
  window.setTimeout(() => dot.remove(), 900);
}

/* ============================== unity 联合：卡牌触发特效（用户 2026-09-11 补做）
 * 提示词要求：
 *  - 联合卡触发效果时与场上其它联合卡连亮蓝光带（playUnityLink 已实现）；
 *  - 联合0 顶 / 联合3 中（翻转）：被选卡被一圈亮蓝（unity-0）/ 银白（unity-3）光环笼罩后翻转；
 *  - 联合0 顶 / 联合2 中 / 联合4 顶（抽牌）：每张抽出的卡带亮蓝光晕飞入手牌；
 *  - 联合1 中（编译 + 删卡）：场上联合卡齐亮 → 光柱汇聚协议中心 → 被删卡化银白光点被光柱吸收；
 *  - 联合弃置：被弃卡被亮蓝光带卷住 → 化银白光点消散。
 * 事件：card:flipped / card:drawn / line:compiled / card:discarded（triggerProtocol=unity）。 */
const UNITY_BLUE = '#3d8bff';
const UNITY_SILVER = '#e8ecf8';

/** 联合0/3：被选卡的光环（kind：blue=亮蓝 / silver=银白） */
export function playUnityRing(payload: { uid?: string; triggerDefId?: string }): void {
  if (!payload.uid) return;
  const node = document.querySelector<HTMLElement>(`[data-uid="${payload.uid}"]`);
  if (!node) return;
  const rect = node.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return;
  const silver = payload.triggerDefId === 'unity-3';
  const color = silver ? UNITY_SILVER : UNITY_BLUE;
  const ring = mk('div', 'fx-unity-ring');
  ring.style.setProperty('--uc', color);
  ring.style.setProperty('--ucg', hexToRgba(color, 0.85));
  ring.style.left = `${(rect.left - 10).toFixed(1)}px`;
  ring.style.top = `${(rect.top - 10).toFixed(1)}px`;
  ring.style.width = `${(rect.width + 20).toFixed(1)}px`;
  ring.style.height = `${(rect.height + 20).toFixed(1)}px`;
  ring.style.zIndex = String(GEN2_Z - 1);
  document.body.appendChild(ring);
  window.setTimeout(() => ring.classList.add('in'), 20);
  window.setTimeout(() => ring.classList.remove('in'), 560);
  window.setTimeout(() => ring.remove(), 1000);
}

/** 联合抽牌（unity-0 顶合一抽取 / unity-2 中 / unity-4 顶揭示抽全部）：每张抽出卡带亮蓝光晕 */
export function playUnityDrawHalos(p: { player?: PlayerId; count?: number; uid?: string }, s?: GameState): void {
  if (p.player === undefined || !s) return;
  const count = p.uid ? 1 : (p.count ?? 1);
  const hand = s.players[p.player].hand;
  const drawn = hand.slice(-count);
  // 联合4：牌库中的联合卡沿光带依次飞出 → 牌库→手牌方向的光带（一次性）
  const deck = deckCenter(p.player);
  const target = handLandingPos(p.player, 0);
  if (deck && target && count > 1) spawnBand(deck, target, 'fx-unity-band', 900);
  for (let k = 0; k < drawn.length; k++) {
    window.setTimeout(() => {
      const pos = handLandingPos(p.player!, k);
      if (!pos) return;
      const halo = mk('div', 'fx-unity-halo');
      halo.style.left = `${(pos.x - 65).toFixed(1)}px`;
      halo.style.top = `${(pos.y - 89.4).toFixed(1)}px`;
      halo.style.zIndex = String(GEN2_Z - 2);
      document.body.appendChild(halo);
      window.setTimeout(() => halo.classList.add('in'), 20);
      window.setTimeout(() => halo.classList.remove('in'), 620);
      window.setTimeout(() => halo.remove(), 1100);
    }, k * 110);
  }
}

/** 联合1 中：场上联合卡齐亮 → 光柱汇聚协议中心（编译）→ 被删卡化银白光点被光柱吸收 */
export function playUnityCompilePillar(player: PlayerId, line: number, unityUids: string[]): void {
  // 该玩家该线的协议格（.protocol-cell 带 data-player/data-line）
  const cell = document.querySelector<HTMLElement>(
    `.protocol-cell[data-player="${player}"][data-line="${line}"]`
  );
  // 2026-09-13（审计补漏）：**不要**回退到"文档里第一个 .protocol-holder"——那会把光柱锚到
  // 某个毫不相干的协议上（P1 线 0）；协议格取不到就整体不播。
  const targetBox = cell?.querySelector<HTMLElement>('.protocol-holder');
  if (!targetBox) return;
  const tr = targetBox.getBoundingClientRect();
  if (tr.width === 0) return;
  const target = { x: tr.left + tr.width / 2, y: tr.top + tr.height / 2 };
  // 场上联合卡 → 协议中心的光带（众星拱月）
  for (const uid of unityUids) {
    const node = document.querySelector<HTMLElement>(`[data-uid="${uid}"]`);
    if (!node) continue;
    const r = node.getBoundingClientRect();
    if (r.width === 0) continue;
    spawnBand({ x: r.left + r.width / 2, y: r.top + r.height / 2 }, target, 'fx-unity-band', 1000);
  }
  // 光柱（协议中心向上冲起的亮蓝柱）
  const pillar = mk('div', 'fx-unity-pillar');
  pillar.style.left = `${(target.x - 22).toFixed(1)}px`;
  pillar.style.top = `${(target.y - 150).toFixed(1)}px`;
  pillar.style.zIndex = String(GEN2_Z - 1);
  document.body.appendChild(pillar);
  window.setTimeout(() => pillar.classList.add('in'), 20);
  window.setTimeout(() => pillar.classList.remove('in'), 1100);
  window.setTimeout(() => pillar.remove(), 1700);
}

/** 联合弃置：被弃卡被亮蓝光带卷住 → 化银白光点消散（基础切割照常由 effects 播放） */
export function playUnityDiscardExtra(node: HTMLElement): void {
  const rect = node.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return;
  const band = mk('div', 'fx-unity-sash');
  band.style.left = `${(rect.left - 14).toFixed(1)}px`;
  band.style.top = `${(rect.top + rect.height / 2 - 9).toFixed(1)}px`;
  band.style.width = `${(rect.width + 28).toFixed(1)}px`;
  band.style.zIndex = String(GEN2_Z - 1);
  document.body.appendChild(band);
  window.setTimeout(() => band.classList.add('in'), 20);
  window.setTimeout(() => band.classList.remove('in'), 520);
  window.setTimeout(() => band.remove(), 900);
  // 银白光点
  for (let i = 0; i < 12; i++) {
    const s = mk('i', 'fx-unity-speck');
    s.style.left = `${(rect.left + Math.random() * rect.width).toFixed(1)}px`;
    s.style.top = `${(rect.top + Math.random() * rect.height).toFixed(1)}px`;
    s.style.setProperty('--ux', `${(Math.random() * 90 - 45).toFixed(1)}px`);
    s.style.setProperty('--uy', `${(Math.random() * 70 - 35).toFixed(1)}px`);
    s.style.zIndex = String(GEN2_Z);
    document.body.appendChild(s);
    window.setTimeout(() => s.remove(), 950);
  }
}

/** 订阅 luck / mirror / peace / chaos / clarity / corruption 引擎事件 */
export function initGen2Fx(): () => void {
  return gameBus.subscribe((e: GameEvent) => {
    // unity 连携：unity 效果触发（action 类事件 + protocol=unity）→ 源卡向场上其它联合卡连亮蓝光带
    if (
      (e.type === 'card:flipped' || e.type === 'card:shifted' || e.type === 'card:drawn' ||
        e.type === 'card:discarded' || e.type === 'card:deleted' || e.type === 'card:deck-played' ||
        e.type === 'card:hand-played' || e.type === 'card:returned' || e.type === 'card:given' || e.type === 'card:copied')
    ) {
      const u = e.payload as { triggerProtocol?: string; triggerUid?: string } | undefined;
      if (u && u.triggerProtocol === 'unity' && u.triggerUid) {
        playUnityLink(e.state, u.triggerUid);
      }
    }
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
      // 同化0 取场卡入己手：takeFromField op 发的是 card:given（不是 card:returned）
      // ——2026-09-12 修复「同化0 中部指令未触发特效」：在 card:given 分支补挂（下方）
    } else if (e.type === 'card:given') {
      // 同化0：被取卡青碧涟漪 → 化为青碧光点沿弧线飞入手牌 → 落手闪环
      // （基础回手飞行由 effects/index 的 card:given → playReturn 照常播放）
      const p = e.payload as { uid?: string; owner?: PlayerId; to?: PlayerId; triggerProtocol?: string } | undefined;
      if (p && p.triggerProtocol === 'assimilation' && p.uid) {
        playAssimTakeExtra({ uid: p.uid, owner: p.to ?? p.owner });
      }
    } else if (e.type === 'card:deck-played') {
      // time-0/3 从弃牌堆打出（playFromTrash）：弃牌堆上方古铜时钟亮起
      const p = e.payload as { triggerProtocol?: string; fromTrash?: boolean } | undefined;
      if (p && p.triggerProtocol === 'time' && p.fromTrash === true) {
        const owner = (e.payload as { owner?: PlayerId }).owner;
        if (owner !== undefined) spawnTrashClock(owner);
      }
      // war 被动触发成功（war-3 反打）：触发源卡位置胜利战旗
      const w = e.payload as { triggerProtocol?: string; triggerUid?: string } | undefined;
      if (w && w.triggerProtocol === 'war' && w.triggerUid) {
        playWarVictoryFlag(w.triggerUid);
      }
    } else if (e.type === 'time:deck-to-trash') {
      onTimeDeckToTrash(e.payload as { player?: PlayerId });
    } else if (e.type === 'card:deleted' || e.type === 'card:discarded') {
      // war 被动触发成功（war-0 删卡 / war-1 弃后刷新 / war-2 对手弃手）
      const p = e.payload as { triggerProtocol?: string; triggerUid?: string; uid?: string } | undefined;
      if (p && p.triggerProtocol === 'war' && p.triggerUid) {
        playWarVictoryFlag(p.triggerUid);
      }
      // 联合弃置：被弃卡被亮蓝光带卷住 → 化银白光点消散（用户 2026-09-11 补做；
      // 基础切割由 effects/index 照常播放）
      if (e.type === 'card:discarded' && p && p.triggerProtocol === 'unity' && p.uid) {
        const node = document.querySelector<HTMLElement>(`[data-uid="${p.uid}"]`);
        if (node) playUnityDiscardExtra(node);
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
      // courage 抽牌（勇气0/2/3 中抽牌）：抽出的卡落点湖中剑 + 卡框鎏金 2s
      if (p && p.triggerProtocol === 'courage' && (p.player === 0 || p.player === 1)) {
        playCourageDrawExtra(p.player);
      }
      // time-2 顶「当你切洗牌库时：抽取1张牌」→ 牌库上方旋转古铜沙漏（沙粒向上倒流）
      if (p && p.triggerProtocol === 'time' && (p.player === 0 || p.player === 1)) {
        playTimeHourglass(p.player);
      }
      // diversity-1 抽牌：每张被抽卡带一圈「该卡所属协议主题色」光晕（用户 2026-09-11 补做）
      if (p && p.triggerProtocol === 'diversity') {
        onDiversityDrawn(p, e.state);
      }
      // 同化1 中刷新 → 协议泛青碧光泽；同化1 底 / 同化4 跨方牌库抽牌 → 两库间青碧光带
      if (p && p.triggerProtocol === 'assimilation') {
        const a = p as { player?: PlayerId; triggerDefId?: string; fromOpponentDeck?: boolean };
        if (a.fromOpponentDeck === true && (a.player === 0 || a.player === 1)) {
          playAssimExchangeBand(a.player);
        }
        if (a.triggerDefId === 'assimilation-1' && a.player !== undefined) {
          playAssimRefreshGloss(a.player);
        }
      }
      // 联合抽牌（unity-0 顶 / unity-2 中 / unity-4 顶）：每张抽出卡带亮蓝光晕（+ 牌库光带）
      if (p && p.triggerProtocol === 'unity') {
        playUnityDrawHalos(p as { player?: PlayerId; count?: number; uid?: string }, e.state);
      }
    } else if (e.type === 'card:shifted') {
      // diversity-1 偏转：被偏转卡化为彩色光球滑向目标位置（用户 2026-09-11 补做）
      const p = e.payload as { triggerProtocol?: string; uid?: string; owner?: PlayerId; line?: number | null } | undefined;
      if (p && p.triggerProtocol === 'diversity') {
        playDiversityShiftExtra(p);
      }
      // 联合卡触发效果 → 与场上其它联合卡连亮蓝光带（playUnityLink 已在上面统一处理）
    } else if (e.type === 'card:flipped') {
      // diversity-4 翻转：七彩光环套住 → 收缩 → 翻转 → 消散（用户 2026-09-11 补做）
      const p = e.payload as { triggerProtocol?: string; uid?: string; triggerDefId?: string } | undefined;
      if (p && p.triggerProtocol === 'diversity') {
        playDiversityFlipExtra(p);
      }
      // 联合0 顶 / 联合3 中：被选卡被亮蓝（unity-0）/ 银白（unity-3）光环笼罩后翻转
      if (p && p.triggerProtocol === 'unity') {
        playUnityRing(p);
      }
    } else if (e.type === 'protocol:compiled-by-effect') {
      // 多元0：6 张不同协议卡的光柱汇聚到多元0 → 彩光迸发（引擎 diversity.ts emit）
      const p = e.payload as { player?: PlayerId; defId?: string; sourceUid?: string } | undefined;
      if (p && p.defId === 'diversity' && p.sourceUid) {
        playDiversityConvergence(p.sourceUid, e.state);
      }
    } else if (e.type === 'line:compiled') {
      // 联合1 中：场上联合卡齐亮 → 光柱汇聚协议中心 → 被删卡化银白光点被光柱吸收
      const p = e.payload as { player?: PlayerId; line?: number; protocolDefId?: string } | undefined;
      if (p && p.protocolDefId === 'unity' && p.player !== undefined && p.line !== undefined) {
        const uids: string[] = [];
        for (const owner of [0, 1] as PlayerId[]) {
          for (const st of e.state.players[owner].stacks) {
            for (const c of st) if (c.defId.startsWith('unity-')) uids.push(c.uid);
          }
        }
        playUnityCompilePillar(p.player, p.line, uids);
      }
    }
  });
}