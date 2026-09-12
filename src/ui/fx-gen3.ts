/**
 * 3 代（MN03 / AX03）卡牌效果「附加层」· 批次 B（弃牌 / 删除 / 翻转 / 偏转）。
 *
 * 与 1/2 代完全同一套做法（设计稿 §0.1、§4）：
 *  - **叠加不替换**：基础动画照常播（切割 / 碎裂 / 翻面 / 幽灵飞行），本模块只加协议专属层；
 *  - 弃牌/删除走既有「**前置段 → 延后基础动画**」模板（同 psychic/plague/death/hate 的时序），
 *    PRE 时长由本模块返回/内部调度，事件时先捕获 rect（重渲染后节点会失效）；
 *  - 翻转/偏转：附加层即时叠加 + 调用基础 playFlip/playShift（怠惰翻转按协议语法放慢）；
 *  - 多张同时触发（新星0 整线删除 / 愤怒2 整线翻转）用**位置排序 + 错开**做连锁编排。
 *
 * 只覆盖**点名的触发点**（范围红线，进度文件 §6.0）：其他 3 代卡牌只播基础动画。
 *  弃牌：贪婪 R1、怠惰 S3、愤怒 W2、支点 F1、动量 M1、新星 N2
 *  删除：暴食 G2、愤怒 W1、压制 O2、新星 N1
 *  翻转：傲慢 P2/P3/P4、怠惰 S2、愤怒 W3、伏击 A1、柔性 X1、嫉妒 E4 的翻转分支
 *  偏转：傲慢 P5、新星 N3、柔性 X2/X3
 *
 * 品质（设计稿 §8.1）：每层 ≥3 件（主体/衬光/粒子）、渐变+内阴影+高光、
 * 分阶段缓动与二次运动、三阶配色、起止衔接（0.2~0.4s 收束）、不遮卡文。
 */

import type { GameState } from '../core/models/types';

/** 事件载荷（= effects/index.ts 的 FxCardPayload + emitCardEvent 附带的 triggerUid） */
export interface Gen3CardPayload {
  uid: string;
  defId: string;
  faceUp: boolean;
  owner?: 0 | 1;
  line?: number | null;
  triggerProtocol?: string;
  triggerDefId?: string;
  /** 触发这次动作的源卡 uid（新星引力线/柔性2 亮卡等需要跨卡定位） */
  triggerUid?: string;
}

/** effects/index.ts 传入的宿主能力（避免本模块反向依赖其私有实现） */
export interface Gen3CardFxApi {
  el(tag: string, cls: string, text?: string): HTMLElement;
  buildFxCard(node: HTMLElement, payload: Gen3CardPayload, zIndex: number): HTMLElement | null;
  playCutAt(rect: DOMRect, cw: boolean, ccw: boolean, payload: Gen3CardPayload): void;
  playCut(node: HTMLElement, payload: Gen3CardPayload): void;
  playShatterAt(rect: DOMRect, cw: boolean, ccw: boolean, payload: Gen3CardPayload): void;
  playFlip(node: HTMLElement, payload: Gen3CardPayload, durationMs?: number): void;
  playShift(node: HTMLElement, payload: Gen3CardPayload): void;
  extraZ: number;
  rnd(a: number, b: number): number;
}

/** 3 代卡牌特效覆盖的协议（供守卫测试核对覆盖范围） */
export const GEN3_CARD_FX_COVER: Record<'discard' | 'delete' | 'flip' | 'shift', string[]> = {
  discard: ['greed', 'sloth', 'wrath', 'fulcrum', 'momentum', 'nova'],
  delete: ['gluttony', 'wrath', 'overwhelm', 'nova'],
  flip: ['pride', 'sloth', 'wrath', 'ambush', 'flexibility', 'envy'],
  shift: ['pride', 'nova', 'flexibility'],
};

/* ============================== 共享工具 ============================== */

function geom(node: HTMLElement): { rect: DOMRect; cw: boolean; ccw: boolean } | null {
  const rect = node.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return null;
  return { rect, cw: node.classList.contains('rot-cw'), ccw: node.classList.contains('rot-ccw') };
}

/** 协议色（与 styles-gen3-cards.css 的类一一对应；仅用于 body 级 SVG 连线/弧轨的描边） */
const PROTO_STROKE: Record<string, string> = {
  pride: '#d9a441', nova: '#ffb347', flexibility: '#a86fd0', greed: '#d94fd9', wrath: '#c0392b',
};

/** body 级满屏层（无 transform → 内部 fixed/absolute 视口坐标不被破坏） */
function bodyLayer(cls: string, z: number): HTMLElement {
  const layer = document.createElement('div');
  layer.className = cls;
  layer.style.cssText = `position:fixed;left:0;top:0;width:100vw;height:100vh;pointer-events:none;z-index:${z};`;
  document.body.appendChild(layer);
  return layer;
}

/**
 * 两点之间的弧轨（偏转用）：SVG 路径 + N 个沿路径飞行的光点（offset-path: path）。
 * 返回清理函数；调用方按 ms 自行移除。
 */
function arcTrack(
  from: DOMRect,
  to: DOMRect,
  cls: string,
  proto: string,
  dots: number,
  ms: number,
  z: number,
  ribbon: boolean,
  api: Gen3CardFxApi,
): () => void {
  const x1 = from.left + from.width / 2;
  const y1 = from.top + from.height / 2;
  const x2 = to.left + to.width / 2;
  const y2 = to.top + to.height / 2;
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.max(1, Math.hypot(dx, dy));
  const bow = Math.min(140, len * 0.26);
  // 垂直方向偏移控制点 → 弧线（不直的轨迹才有"轨道"感）
  const cx = mx - (dy / len) * bow;
  const cy = my + (dx / len) * bow;
  const d = `M ${x1.toFixed(1)} ${y1.toFixed(1)} Q ${cx.toFixed(1)} ${cy.toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)}`;
  const layer = bodyLayer(`g3-arc ${cls}`, z);
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'g3-arc-svg');
  svg.setAttribute('viewBox', `0 0 ${window.innerWidth} ${window.innerHeight}`);
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', d);
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', PROTO_STROKE[proto] ?? '#c07bff');
  path.setAttribute('stroke-width', '2');
  path.setAttribute('stroke-linecap', 'round');
  svg.appendChild(path);
  if (ribbon) {
    const wide = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    wide.setAttribute('d', d);
    wide.setAttribute('fill', 'none');
    wide.setAttribute('stroke', PROTO_STROKE[proto] ?? '#c07bff');
    wide.setAttribute('stroke-width', '11');
    wide.setAttribute('stroke-linecap', 'round');
    wide.setAttribute('class', 'g3-arc-ribbon');
    svg.appendChild(wide);
  }
  layer.appendChild(svg);
  for (let i = 0; i < dots; i++) {
    const dot = api.el('i', 'g3-arc-dot');
    dot.style.offsetPath = `path("${d}")`;
    dot.style.animationDuration = `${ms}ms`;
    dot.style.animationDelay = `${((i * ms) / (dots * 2.2)).toFixed(0)}ms`;
    layer.appendChild(dot);
  }
  const head = api.el('i', 'g3-arc-head');
  head.style.left = `${x2.toFixed(1)}px`;
  head.style.top = `${y2.toFixed(1)}px`;
  head.style.animationDelay = `${Math.max(0, ms - 180)}ms`;
  layer.appendChild(head);
  window.setTimeout(() => layer.remove(), ms + 420);
  return () => layer.remove();
}

/**
 * 多张同时触发的连锁编排：同一批（windowMs 内）的调用按 sortKey 排序后逐张错开 gapMs。
 * 用于新星0「整线删除」与愤怒2「整线翻转」——从中间向两侧连锁（位置依据为该卡到线中心的距离）。
 */
const batches = new Map<string, { items: { key: number; run: () => void }[]; timer: number }>();
function queueStaggered(
  key: string,
  sortKey: number,
  run: () => void,
  opts: { windowMs: number; gapMs: number; onAllDone?: (count: number) => void },
): void {
  let batch = batches.get(key);
  if (!batch) {
    batch = { items: [], timer: 0 };
    batches.set(key, batch);
    batch.timer = window.setTimeout(() => {
      const items = batch!.items.slice().sort((a, b) => a.key - b.key);
      batches.delete(key);
      items.forEach((it, i) => window.setTimeout(it.run, i * opts.gapMs));
      if (opts.onAllDone) window.setTimeout(() => opts.onAllDone!(items.length), Math.max(0, (items.length - 1) * opts.gapMs));
    }, opts.windowMs);
  }
  batch.items.push({ key: sortKey, run });
}

/** 该卡所在链路中心的 x（用于"从中间向两侧"排序）；找不到线槽时退化用卡自身 x */
function lineCenterX(node: HTMLElement, p: Gen3CardPayload): number {
  const rect = node.getBoundingClientRect();
  if (p.owner === undefined || p.line == null) return rect.left + rect.width / 2;
  const slot = document.querySelector<HTMLElement>(`.stack-slot[data-player="${p.owner}"][data-line="${p.line}"]`);
  if (!slot) return rect.left + rect.width / 2;
  const sr = slot.getBoundingClientRect();
  return Math.abs(rect.left + rect.width / 2 - (sr.left + sr.width / 2));
}

/* ============================== 弃牌（A-DISCARD） ============================== */

/**
 * 3 代弃牌附加层。返回值 true = 已接管（内部按需延后基础切割）；false = 不属 3 代点名范围，
 * 交由 effects/index.ts 既有链继续处理（会正常播放基础切割）。
 * 时序常量与设计稿 §4 对齐：贪婪 420 / 怠惰 460 / 愤怒 380 / 支点 420 / 动量即时 / 新星即时。
 */
export function gen3DiscardFx(node: HTMLElement, p: Gen3CardPayload, api: Gen3CardFxApi): boolean {
  const g = geom(node);
  if (!g) return false;
  const protocol = p.triggerProtocol ?? '';
  if (!GEN3_CARD_FX_COVER.discard.includes(protocol)) return false; // 只接管点名协议，其余交回基础链
  const { rect, cw, ccw } = g;
  const clone = api.buildFxCard(node, p, api.extraZ);
  if (!clone) return false;
  const finish = (preMs: number, cls: string): boolean => {
    clone.classList.add(cls);
    window.setTimeout(() => api.playCutAt(rect, cw, ccw, p), preMs);
    window.setTimeout(() => clone.remove(), preMs + 420);
    return true;
  };

  switch (protocol) {
    // 贪婪 R1：5~7 枚品红-青玉硬币自卡面滚落 → 叠落 → 切割
    case 'greed': {
      for (let i = 0; i < 7; i++) {
        const coin = api.el('i', 'g3-coin');
        coin.style.left = `${18 + i * 9 + api.rnd(-3, 3)}%`;
        coin.style.top = `${42 + (i % 3) * 6}%`;
        coin.style.setProperty('--dx', `${api.rnd(-40, 40).toFixed(1)}px`);
        coin.style.setProperty('--rot', `${api.rnd(-260, 260).toFixed(0)}deg`);
        coin.style.animationDelay = `${(i * 26).toFixed(0)}ms`;
        coin.style.width = `${9 + (i % 3) * 3}px`;
        clone.appendChild(coin);
      }
      return finish(420, 'g3-greed-discard');
    }
    // 怠惰 S3：灰红泥浆下淌（慢 15~25%）→ 切割
    case 'sloth': {
      for (let i = 0; i < 4; i++) {
        const blob = api.el('i', 'g3-mud');
        blob.style.left = `${8 + i * 23 + api.rnd(-3, 3)}%`;
        blob.style.width = `${22 + (i % 3) * 9}%`;
        blob.style.animationDelay = `${(i * 90).toFixed(0)}ms`;
        clone.appendChild(blob);
      }
      clone.appendChild(api.el('i', 'g3-mud-veil'));
      return finish(460, 'g3-sloth-discard');
    }
    // 愤怒 W2：三道猩红爪痕 + 溅射点 → 切割
    case 'wrath': {
      for (let i = 0; i < 3; i++) {
        const claw = api.el('i', `g3-claw s${i}`);
        claw.style.animationDelay = `${(i * 45).toFixed(0)}ms`;
        clone.appendChild(claw);
      }
      for (let i = 0; i < 5; i++) {
        const sp = api.el('i', 'g3-blood-dot');
        sp.style.left = `${24 + api.rnd(-8, 46)}%`;
        sp.style.top = `${34 + api.rnd(-10, 34)}%`;
        sp.style.animationDelay = `${(60 + i * 22).toFixed(0)}ms`;
        clone.appendChild(sp);
      }
      return finish(380, 'g3-wrath-discard');
    }
    // 支点 F1：天平秤盘下沉 → 卡自秤盘滑落 → 切割（支点0 = 手牌恰好 0 张 → 先播一次空载上扬）
    case 'fulcrum': {
      const scale = api.el('div', 'g3-scale');
      scale.appendChild(api.el('i', 'g3-scale-beam'));
      scale.appendChild(api.el('i', 'g3-scale-pan l'));
      scale.appendChild(api.el('i', 'g3-scale-pan r'));
      scale.appendChild(api.el('i', 'g3-scale-pivot'));
      clone.appendChild(scale);
      if (p.triggerDefId === 'fulcrum-0') scale.classList.add('empty-lift');
      scale.classList.add('sink');
      return finish(420, 'g3-fulcrum-discard');
    }
    // 动量 M1：速度线 + 卡面拖影（即时切割）；重排后连锁（动量1）加加速环
    case 'momentum': {
      for (let i = 0; i < 3; i++) {
        const s = api.el('i', 'g3-speed-line');
        s.style.top = `${26 + i * 22}%`;
        s.style.animationDelay = `${(i * 40).toFixed(0)}ms`;
        clone.appendChild(s);
      }
      if (p.triggerDefId === 'momentum-1') clone.appendChild(api.el('i', 'g3-accel-ring'));
      clone.classList.add('g3-momentum-discard');
      api.playCut(node, p); // 基础切割即时并播
      window.setTimeout(() => clone.remove(), 460);
      return true;
    }
    // 新星 N2：从新星卡面伸出橙色引力线牵向被弃卡并拉出（即时切割）
    case 'nova': {
      const src = p.triggerUid ? document.querySelector<HTMLElement>(`[data-uid="${p.triggerUid}"]`) : null;
      if (src) {
        const sr = src.getBoundingClientRect();
        arcTrack(sr, rect, 'g3-nova-pull', 'nova', 2, 380, api.extraZ, false, api);
      }
      for (let i = 0; i < 3; i++) {
        const line = api.el('i', 'g3-pull-line');
        line.style.animationDelay = `${(i * 50).toFixed(0)}ms`;
        clone.appendChild(line);
      }
      clone.classList.add('g3-nova-discard');
      api.playCut(node, p);
      window.setTimeout(() => clone.remove(), 460);
      return true;
    }
    default:
      clone.remove();
      return false;
  }
}

/* ============================== 删除（A-DELETE） ============================== */

/** 3 代删除附加层（返回值语义同弃牌）。基础破碎即时或延后由各分支决定。 */
export function gen3DeleteFx(node: HTMLElement, p: Gen3CardPayload, api: Gen3CardFxApi): boolean {
  const g = geom(node);
  if (!g) return false;
  const protocol = p.triggerProtocol ?? '';
  if (!GEN3_CARD_FX_COVER.delete.includes(protocol)) return false;
  const { rect, cw, ccw } = g;
  const clone = api.buildFxCard(node, p, api.extraZ);
  if (!clone) return false;

  switch (protocol) {
    // 暴食 G2：三排锯齿两侧咬入 → 碎块向中心收拢 → 咬合闪光 →（延后）粉碎
    case 'gluttony': {
      for (const side of ['l', 'r'] as const) {
        const jaw = api.el('div', `g3-bite-jaw ${side}`);
        for (let i = 0; i < 3; i++) jaw.appendChild(api.el('i', `g3-bite-tooth t${i}`));
        clone.appendChild(jaw);
      }
      // 9 块碎片：向卡心收拢（px 偏移由事件时的 rect 算好，写入 --fx/--fy）
      for (let i = 0; i < 9; i++) {
        const lx = 16 + (i % 3) * 30;
        const ly = 20 + Math.floor(i / 3) * 26;
        const frag = api.el('i', 'g3-bite-frag');
        frag.style.left = `${lx}%`;
        frag.style.top = `${ly}%`;
        frag.style.setProperty('--fx', `${((50 - lx) / 100 * rect.width).toFixed(1)}px`);
        frag.style.setProperty('--fy', `${((50 - ly) / 100 * rect.height).toFixed(1)}px`);
        frag.style.animationDelay = `${200 + i * 12}ms`;
        clone.appendChild(frag);
      }
      clone.classList.add('g3-gluttony-delete');
      window.setTimeout(() => api.playShatterAt(rect, cw, ccw, p), 600);
      window.setTimeout(() => clone.remove(), 1000);
      return true;
    }
    // 愤怒 W1：猩红光点聚起 → 尖刺外爆 + 白闪 + 溅射（破碎即时并播）
    case 'wrath': {
      clone.appendChild(api.el('i', 'g3-wrath-core'));
      for (let i = 0; i < 7; i++) {
        const spike = api.el('i', 'g3-wrath-spike');
        // 角度用自定义属性传入（动画的 transform 会覆盖内联 transform，故不能用内联 rotate）
        spike.style.setProperty('--r', `${i * 51}deg`);
        spike.style.animationDelay = `${60 + i * 12}ms`;
        clone.appendChild(spike);
      }
      for (let i = 0; i < 7; i++) {
        const drop = api.el('i', 'g3-blood-drop');
        drop.style.setProperty('--dx', `${api.rnd(-46, 46).toFixed(1)}px`);
        drop.style.setProperty('--dy', `${api.rnd(-30, 44).toFixed(1)}px`);
        drop.style.animationDelay = `${120 + i * 18}ms`;
        clone.appendChild(drop);
      }
      clone.classList.add('g3-wrath-delete');
      api.playShatterAt(rect, cw, ccw, p);
      window.setTimeout(() => clone.remove(), 720);
      return true;
    }
    // 压制 O2：配重板压下 → 碎片被压平内塌 → 板抬起（延后破碎）
    case 'overwhelm': {
      const plate = api.el('div', 'g3-weight-plate');
      plate.appendChild(api.el('i', 'g3-weight-plate-ridge'));
      clone.appendChild(plate);
      for (let i = 0; i < 6; i++) {
        const frag = api.el('i', 'g3-press-frag');
        frag.style.left = `${18 + (i % 3) * 26}%`;
        frag.style.top = `${34 + Math.floor(i / 3) * 22}%`;
        frag.style.animationDelay = `${180 + i * 12}ms`;
        clone.appendChild(frag);
      }
      clone.classList.add('g3-overwhelm-delete');
      window.setTimeout(() => api.playShatterAt(rect, cw, ccw, p), 560);
      window.setTimeout(() => clone.remove(), 980);
      return true;
    }
    // 新星 N1：星芒尖刺爆开 + 白闪；新星0（整线删除）按位置从中间向两侧连锁 + 收尾临界环
    case 'nova': {
      const centerX = lineCenterX(node, p);
      queueStaggered(`gen3-nova-delete-${p.owner}-${p.line}`, centerX, () => {
        const g2 = geom(node);
        if (!g2) return;
        const c = api.buildFxCard(node, p, api.extraZ);
        if (!c) return;
        for (let i = 0; i < 4; i++) {
          const ray = api.el('i', 'g3-nova-burst-ray');
          ray.style.transform = `rotate(${i * 90 + 45}deg)`;
          c.appendChild(ray);
        }
        c.appendChild(api.el('i', 'g3-nova-burst-flash'));
        c.classList.add('g3-nova-delete');
        api.playShatterAt(g2.rect, g2.cw, g2.ccw, p);
        window.setTimeout(() => c.remove(), 560);
      }, {
        windowMs: 40, gapMs: 70,
        onAllDone: () => {
          if (p.triggerDefId !== 'nova-0') return;
          const slot = p.owner !== undefined && p.line != null
            ? document.querySelector<HTMLElement>(`.stack-slot[data-player="${p.owner}"][data-line="${p.line}"]`)
            : null;
          if (!slot) return;
          const sr = slot.getBoundingClientRect();
          const ring = api.el('i', 'g3-nova-crit-ring');
          ring.style.left = `${sr.left + sr.width / 2}px`;
          ring.style.top = `${sr.top + sr.height / 2}px`;
          document.body.appendChild(ring);
          window.setTimeout(() => ring.remove(), 900);
        },
      });
      clone.remove();
      return true;
    }
    default:
      clone.remove();
      return false;
  }
}

/* ============================== 翻转（A-FLIP） ============================== */

/** 3 代翻转附加层（内部调用基础 playFlip；怠惰按协议语法放慢到 750ms）。 */
export function gen3FlipFx(node: HTMLElement, p: Gen3CardPayload, api: Gen3CardFxApi, state?: GameState): boolean {
  const g = geom(node);
  if (!g) return false;
  const protocol = p.triggerProtocol ?? '';
  const overlay = (cls: string): HTMLElement | null => {
    const c = api.buildFxCard(node, p, api.extraZ);
    if (c) c.classList.add(cls);
    return c;
  };

  switch (protocol) {
    // 傲慢 P4（棱镜掠过 + 光柱升起）/ P2·P3（金塔裂纹 + 崩塌碎块）
    case 'pride': {
      const cracking = p.triggerDefId === 'pride-6';
      const c = overlay(cracking ? 'g3-pride-crack' : 'g3-pride-prism');
      if (c) {
        // 光柱：与翻面同时起步、稍后升起（animation-delay 控制，避免二次建层）
        c.appendChild(api.el('i', 'g3-pride-beam'));
        if (cracking) {
          for (let i = 0; i < 5; i++) {
            const chunk = api.el('i', 'g3-gold-chunk');
            chunk.style.left = `${18 + i * 15}%`;
            chunk.style.setProperty('--dx', `${api.rnd(-26, 26).toFixed(1)}px`);
            chunk.style.animationDelay = `${140 + i * 40}ms`;
            c.appendChild(chunk);
          }
        }
      }
      api.playFlip(node, p);
      window.setTimeout(() => c?.remove(), 940);
      return true;
    }
    // 怠惰 S2：灰红渐层 + 慢翻（0.75s）+ 翻后余烬
    case 'sloth': {
      const c = overlay('g3-sloth-flip');
      for (let i = 0; i < 3; i++) {
        const ember = api.el('i', 'g3-sloth-flip-ember');
        ember.style.left = `${26 + i * 22}%`;
        ember.style.top = `${34 + (i % 2) * 24}%`;
        ember.style.animationDelay = `${420 + i * 140}ms`;
        c?.appendChild(ember);
      }
      api.playFlip(node, p, 750);
      window.setTimeout(() => c?.remove(), 1900);
      return true;
    }
    // 愤怒 W3：锯齿闪电劈中 + 白闪 + 焦痕（整线翻转时逐张连劈，错开 80ms）
    case 'wrath': {
      const centerX = lineCenterX(node, p);
      queueStaggered(`gen3-wrath-flip-${p.owner}-${p.line}`, centerX, () => {
        const g2 = geom(node);
        if (!g2) return;
        const c = api.buildFxCard(node, p, api.extraZ);
        if (!c) return;
        c.classList.add('g3-wrath-flip');
        c.appendChild(api.el('i', 'g3-wrath-bolt'));
        c.appendChild(api.el('i', 'g3-wrath-scorch'));
        api.playFlip(node, p);
        window.setTimeout(() => c.remove(), 900);
      }, { windowMs: 40, gapMs: 80 });
      return true;
    }
    // 伏击 A1：翻正 = 黑幕 + 自下而上扫描线 + 9 宫格亮 1 格；翻面 = 黑幕合拢 + 九格熄灭
    case 'ambush': {
      const revealing = p.faceUp; // 事件在翻转后发出：faceUp = 新状态
      const c = overlay(revealing ? 'g3-amb-reveal' : 'g3-amb-hide');
      if (c) {
        const grid = api.el('div', 'g3-amb-flip-grid');
        for (let i = 0; i < 9; i++) {
          const cell = api.el('i', 'g3-amb-flip-cell');
          cell.style.animationDelay = `${(revealing ? 60 + i * 30 : 120 + i * 28).toFixed(0)}ms`;
          if (revealing && i === 4) cell.classList.add('on');
          grid.appendChild(cell);
        }
        c.appendChild(grid);
        if (revealing) c.appendChild(api.el('i', 'g3-amb-flip-scan'));
      }
      api.playFlip(node, p);
      window.setTimeout(() => c?.remove(), 860);
      return true;
    }
    // 柔性 X1：飘带缠绕 → 翻面 → 缎带飞散
    case 'flexibility': {
      const c = overlay('g3-flx-flip');
      if (c) {
        c.appendChild(api.el('i', 'g3-flx-wrap-ribbon'));
        for (let i = 0; i < 6; i++) {
          const shard = api.el('i', 'g3-flx-flip-shard');
          shard.style.setProperty('--dx', `${api.rnd(-44, 44).toFixed(1)}px`);
          shard.style.setProperty('--dy', `${api.rnd(-40, 36).toFixed(1)}px`);
          shard.style.animationDelay = `${260 + i * 30}ms`;
          c.appendChild(shard);
        }
      }
      api.playFlip(node, p);
      window.setTimeout(() => c?.remove(), 940);
      return true;
    }
    // 嫉妒 E4 翻转分支：玉青卷边光 + 已编译数对比（己方 vs 对手）
    case 'envy': {
      const c = overlay('g3-envy-curl');
      if (c && state) {
        const mine = state.players[0].protocols.filter((x) => x.compiled).length;
        const foe = state.players[1].protocols.filter((x) => x.compiled).length;
        const box = api.el('div', 'g3-envy-count');
        box.appendChild(api.el('i', 'g3-envy-count-chip mine', String(mine)));
        box.appendChild(api.el('i', 'g3-envy-count-vs', 'vs'));
        box.appendChild(api.el('i', 'g3-envy-count-chip foe', String(foe)));
        c.appendChild(box);
      }
      api.playFlip(node, p);
      window.setTimeout(() => c?.remove(), 820);
      return true;
    }
    default:
      return false;
  }
}

/* ============================== 偏转（A-SHIFT） ============================== */

/** 3 代偏转附加层（内部调用基础 playShift=幽灵飞行照常，附加弧轨/星轨/飘带）。 */
export function gen3ShiftFx(node: HTMLElement, p: Gen3CardPayload, api: Gen3CardFxApi): boolean {
  const g = geom(node);
  if (!g) return false;
  const protocol = p.triggerProtocol ?? '';
  if (!GEN3_CARD_FX_COVER.shift.includes(protocol)) return false;
  const to = p.owner !== undefined && p.line != null
    ? document.querySelector<HTMLElement>(`.stack-slot[data-player="${p.owner}"][data-line="${p.line}"]`)
    : null;
  const toRect = to ? to.getBoundingClientRect() : null;

  switch (protocol) {
    // 傲慢 P5：金色轨道弧（3 金点）+ 落点金环
    case 'pride':
      if (toRect) arcTrack(g.rect, toRect, 'g3-pride-arc', 'pride', 3, 520, api.extraZ, false, api);
      api.playShift(node, p);
      return true;
    // 新星 N3：橙色星轨（5 星点拖尾）；偏转反面卡时暗橙（不点亮卡面）
    case 'nova': {
      if (toRect) arcTrack(g.rect, toRect, `g3-nova-arc${p.faceUp ? '' : ' dim'}`, 'nova', 5, 560, api.extraZ, false, api);
      api.playShift(node, p);
      return true;
    }
    // 柔性 X2/X3：紫罗兰飘带（宽柔光 + 亮细线）+ 落点缎带小结；柔性2 特化=起点取覆盖者 + 下方柔2 亮一下
    case 'flexibility': {
      if (toRect) arcTrack(g.rect, toRect, 'g3-flx-arc', 'flexibility', 3, 540, api.extraZ, true, api);
      if (p.triggerDefId === 'flexibility-2' && p.triggerUid) {
        const below = document.querySelector<HTMLElement>(`[data-uid="${p.triggerUid}"]`);
        if (below) {
          const r = below.getBoundingClientRect();
          const glow = api.el('i', 'g3-flx-below-glow');
          glow.style.left = `${r.left}px`;
          glow.style.top = `${r.top}px`;
          glow.style.width = `${r.width}px`;
          glow.style.height = `${r.height}px`;
          document.body.appendChild(glow);
          window.setTimeout(() => glow.remove(), 420);
        }
      }
      api.playShift(node, p);
      return true;
    }
    default:
      return false;
  }
}
