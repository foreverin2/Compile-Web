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
import { clipInsetRightPct } from './gen3-util';

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
  /** 用**事件时定格的 rect** 建浮层卡（DOM 节点可能已被重渲染替换 → 延迟播放必须用它） */
  buildFxCardAt(rect: DOMRect, cw: boolean, ccw: boolean, payload: Gen3CardPayload, zIndex: number): HTMLElement | null;
  playCutAt(rect: DOMRect, cw: boolean, ccw: boolean, payload: Gen3CardPayload): void;
  playCut(node: HTMLElement, payload: Gen3CardPayload): void;
  playShatterAt(rect: DOMRect, cw: boolean, ccw: boolean, payload: Gen3CardPayload): void;
  playFlip(node: HTMLElement, payload: Gen3CardPayload, durationMs?: number): void;
  playShift(node: HTMLElement, payload: Gen3CardPayload): void;
  playReturn(node: HTMLElement, payload: Gen3CardPayload): void;
  /** 用定格 rect 播翻面（node 已失效时用） */
  playFlipAt(rect: DOMRect, cw: boolean, ccw: boolean, payload: Gen3CardPayload, durationMs?: number): void;
  /** 牌库区矩心（牌堆顶打出/抽牌的起点参照，effects/index.ts 已导出同名函数） */
  deckPos(player: 0 | 1): DOMRect | null;
  /** 基础反面打出飞行（牌库顶 / 手牌）；durationMs 可放慢（3代 惰性=慢） */
  playDeckPlay(payload: Gen3CardPayload, durationMs?: number): void;
  playHandPlay(payload: Gen3CardPayload, durationMs?: number): void;
  extraZ: number;
  rnd(a: number, b: number): number;
}

/** 3 代卡牌特效覆盖的协议（供守卫测试核对覆盖范围） */
export const GEN3_CARD_FX_COVER: Record<'discard' | 'delete' | 'flip' | 'shift' | 'draw' | 'facedown' | 'compiled' | 'return', string[]> = {
  discard: ['greed', 'sloth', 'wrath', 'fulcrum', 'momentum', 'nova'],
  delete: ['gluttony', 'wrath', 'overwhelm', 'nova'],
  flip: ['pride', 'sloth', 'wrath', 'ambush', 'flexibility', 'envy', 'inertia'],
  shift: ['pride', 'nova', 'flexibility'],
  // —— 批次 C ——
  draw: ['gluttony', 'fulcrum'],
  facedown: ['gluttony', 'overwhelm', 'rigidity', 'inertia', 'envy'],
  return: ['greed'],
  compiled: ['greed', 'momentum'],
};

/** 3 代 15 套协议（仅用于文档/守卫对照；"空动作反馈"只做点名的三个协议 → `GEN3_SKIP_BESPOKE`） */
const GEN3_PROTOCOLS_FX = [
  'envy', 'gluttony', 'greed', 'lust', 'pride', 'sloth', 'wrath', 'ambush',
  'fulcrum', 'overwhelm', 'momentum', 'nova', 'inertia', 'rigidity', 'flexibility',
];

/** 可选触发/可选选择被跳过时**有专属空动作**的协议（设计稿 §7 Q5：贪婪爪空抓 / 傲慢指针变灰下坠 / 暴食空咬） */
export const GEN3_SKIP_BESPOKE = ['greed', 'pride', 'gluttony'];

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

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * 两点之间的弧轨（偏转用）：SVG 路径 + 沿路径飞行的运载件（offset-path: path）。
 *
 * 2026-09-13 差异化重做（用户清单 #3「傲慢金色缆线和嫉妒0 长一样」、#16「柔性/傲慢/嫉妒的偏转
 * 看起来都是同一条虚线」）：旧版所有弧轨共用 `.g3-arc path` 的 8/7 虚线 + 圆点，只有颜色不同，
 * 与嫉妒0 的「汲取丝」（橙金移动虚线 + 箭头，styles-gen3-sync.css）撞脸。现在每条轨道各有一套材质：
 *   傲慢 = **金缆**：外鞘(9px 半透明) + 亮金实心芯(2.4px) + 白芯(1px)，**不用虚线**；3 枚箭形滑块
 *          沿轨滑行（offset-rotate: auto 自动转向）；
 *   新星 = **星轨**：暗橙拖尾(11px 模糊) + 亮橙虚线芯(2.4px) + N 枚四角星；
 *   柔性 = **绶带**：两条正弦波动的宽柔光带(13px 模糊 / 3px 芯) + 落点缎带结（不是箭头）。
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
  const color = PROTO_STROKE[proto] ?? '#c07bff';
  const layer = bodyLayer(`g3-arc ${cls}`, z);
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'g3-arc-svg');
  svg.setAttribute('viewBox', `0 0 ${window.innerWidth} ${window.innerHeight}`);
  const addPath = (dAttr: string, width: number, extra: string): void => {
    const p = document.createElementNS(SVG_NS, 'path');
    p.setAttribute('d', dAttr);
    p.setAttribute('fill', 'none');
    p.setAttribute('stroke', color);
    p.setAttribute('stroke-width', String(width));
    p.setAttribute('stroke-linecap', 'round');
    if (extra) p.setAttribute('class', extra);
    svg.appendChild(p);
  };
  /** 沿二次贝塞尔做正弦横向偏移 → 飘带波形（两端收敛，否则会甩出卡外） */
  const wavy = (amp: number, waves: number): string => {
    const N = 22;
    const pts: string[] = [];
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const bx = (1 - t) * (1 - t) * x1 + 2 * (1 - t) * t * cx + t * t * x2;
      const by = (1 - t) * (1 - t) * y1 + 2 * (1 - t) * t * cy + t * t * y2;
      const txv = 2 * (1 - t) * (cx - x1) + 2 * t * (x2 - cx);
      const tyv = 2 * (1 - t) * (cy - y1) + 2 * t * (y2 - cy);
      const tl = Math.max(1e-3, Math.hypot(txv, tyv));
      const off = Math.sin(t * Math.PI * 2 * waves) * amp * Math.sin(Math.PI * t);
      pts.push(`${(bx + (-tyv / tl) * off).toFixed(1)} ${(by + (txv / tl) * off).toFixed(1)}`);
    }
    return `M ${pts[0]} L ${pts.slice(1).join(' L ')}`;
  };

  if (proto === 'flexibility') {
    addPath(wavy(6, 1.3), 13, 'g3-arc-silk-wide');
    addPath(wavy(6, 1.3), 3, 'g3-arc-silk-core');
  } else if (proto === 'nova') {
    addPath(d, 11, 'g3-arc-tail');
    addPath(d, 2.4, 'g3-arc-comet');
  } else {
    addPath(d, 9, 'g3-arc-cable-shell');
    addPath(d, 2.4, 'g3-arc-cable-core');
    addPath(d, 1, 'g3-arc-cable-spark');
  }
  layer.appendChild(svg);

  const rider = (cls2: string, i: number, total: number): HTMLElement => {
    const node = api.el('i', cls2);
    node.style.offsetPath = `path("${d}")`;
    node.style.offsetRotate = 'auto';
    node.style.animationDuration = `${ms}ms`;
    node.style.animationDelay = `${((i * ms) / (total * 1.6)).toFixed(0)}ms`;
    layer.appendChild(node);
    return node;
  };
  if (proto === 'pride') {
    for (let i = 0; i < 3; i++) rider('g3-arc-chevron', i, 3); // 箭形滑块（金缆在"送"东西）
  } else if (proto === 'flexibility') {
    for (let i = 0; i < Math.max(2, dots); i++) rider('g3-arc-bead', i, Math.max(2, dots));
  } else {
    for (let i = 0; i < Math.max(3, dots); i++) rider('g3-arc-star', i, Math.max(3, dots));
  }

  if (proto === 'flexibility') {
    // 落点缎带结（不用箭头，避免和嫉妒0 的箭头丝混淆）
    const knot = api.el('i', 'g3-arc-knot');
    knot.style.left = `${x2.toFixed(1)}px`;
    knot.style.top = `${y2.toFixed(1)}px`;
    layer.appendChild(knot);
  } else {
    const head = api.el('i', `g3-arc-head ${proto}`);
    head.style.left = `${x2.toFixed(1)}px`;
    head.style.top = `${y2.toFixed(1)}px`;
    head.style.animationDelay = `${Math.max(0, ms - 180)}ms`;
    layer.appendChild(head);
  }
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

/**
 * 两点之间的**直线连接件**（边到边，不穿卡）：用于「品红绳线」（贪婪2 回手）/「橙色引力光线」
 * （嫉妒3 反打）——与嫉妒0 常驻汲取丝同款几何（边缘→边缘），但材质/动效由类各自决定。
 */
function edgeLine(layer: HTMLElement, from: DOMRect, to: DOMRect, cls: string, delayMs = 0): void {
  const sx = from.left + from.width / 2;
  const sy = from.top + from.height / 2;
  const tx = to.left + to.width / 2;
  const ty = to.top + to.height / 2;
  const dx = tx - sx;
  const dy = ty - sy;
  const dist = Math.max(1, Math.hypot(dx, dy));
  const ux = dx / dist;
  const uy = dy / dist;
  const sInset = (Math.min(from.width, from.height) / 2) * 0.8;
  const tInset = (Math.min(to.width, to.height) / 2) * 0.8;
  const node = document.createElement('i');
  node.className = cls;
  node.style.left = `${(sx + ux * sInset).toFixed(1)}px`;
  node.style.top = `${(sy + uy * sInset).toFixed(1)}px`;
  node.style.width = `${Math.max(8, dist - sInset - tInset).toFixed(1)}px`;
  node.style.transform = `rotate(${Math.atan2(dy, dx)}rad)`;
  if (delayMs > 0) node.style.animationDelay = `${delayMs}ms`;
  layer.appendChild(node);
}

/** 链路槽矩形（按 owner/line 定位；取不到返回 null） */
function slotRectOf(p: Gen3CardPayload): DOMRect | null {
  if (p.owner === undefined || p.line == null) return null;
  const slot = document.querySelector<HTMLElement>(`.stack-slot[data-player="${p.owner}"][data-line="${p.line}"]`);
  return slot ? slot.getBoundingClientRect() : null;
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
    // 支点 F1：天平细节加强（用户清单 #11「更细致、更可见」）：刻度量尺 + 砝码砸落左盘 +
    // 卡自倾覆的秤盘滑落 + 整卡青玉描边。支点0 = 手牌恰好 0 张 → 先播一次空载上扬。
    case 'fulcrum': {
      const scale = api.el('div', 'g3-scale');
      // 立柱 + 底座（让天平"站得住"，否则两条盘 + 一根梁看不出是天平）
      scale.appendChild(api.el('i', 'g3-scale-post'));
      scale.appendChild(api.el('i', 'g3-scale-base'));
      scale.appendChild(api.el('i', 'g3-scale-beam'));
      for (let i = 0; i < 7; i++) {
        const tick = api.el('i', 'g3-scale-tick');
        tick.style.left = `${8 + i * 14}%`;
        if (i === 3) tick.classList.add('mid');
        tick.style.animationDelay = `${(120 + i * 24).toFixed(0)}ms`;
        scale.appendChild(tick);
      }
      scale.appendChild(api.el('i', 'g3-scale-pan l'));
      scale.appendChild(api.el('i', 'g3-scale-pan r'));
      scale.appendChild(api.el('i', 'g3-scale-pivot'));
      const weight = api.el('i', 'g3-scale-weight');
      scale.appendChild(weight);
      clone.appendChild(scale);
      // 卡自秤盘滑落（斜向滑出卡面 → 切割）
      clone.appendChild(api.el('i', 'g3-scale-slip'));
      clone.appendChild(api.el('i', 'g3-scale-rim'));
      if (p.triggerDefId === 'fulcrum-0') scale.classList.add('empty-lift');
      scale.classList.add('sink');
      return finish(460, 'g3-fulcrum-discard');
    }
    // 动量 M1：速度线 + 卡面拖影（即时切割）；重排后连锁（动量1）加加速环
    case 'momentum': {
      // 2026-09-13 加强（用户实测"没看到特效"）：3→6 条速度线 + 贯穿全卡的橙色疾风条 + 拖影 + 加速带
      for (let i = 0; i < 6; i++) {
        const s = api.el('i', 'g3-speed-line');
        s.style.top = `${12 + i * 15}%`;
        s.style.animationDelay = `${(i * 26).toFixed(0)}ms`;
        clone.appendChild(s);
      }
      clone.appendChild(api.el('i', 'g3-speed-gust'));
      clone.appendChild(api.el('i', 'g3-speed-band'));
      if (p.triggerDefId === 'momentum-1') clone.appendChild(api.el('i', 'g3-accel-ring'));
      clone.classList.add('g3-momentum-discard');
      api.playCut(node, p); // 基础切割即时并播
      window.setTimeout(() => clone.remove(), 520);
      return true;
    }
    // 新星 N2：引力束先把卡"锁住"（自新星卡伸出的橙色引力线）→ **陨石**自右上斜砸到卡面 →
    // 撞击白闪 + 冲击环 + 灼痕 + 碎屑 → 基础切割在**撞击瞬间**才播（不再是"细虚线一闪"）。
    // 2026-09-13 用户清单 #17b：旧版只有 3 条 pull-line + 即时切割，观感廉价 → 改为陨石撞击式。
    case 'nova': {
      const src = p.triggerUid ? document.querySelector<HTMLElement>(`[data-uid="${p.triggerUid}"]`) : null;
      if (src) {
        const sr = src.getBoundingClientRect();
        arcTrack(sr, rect, 'g3-nova-pull', 'nova', 3, 420, api.extraZ, api);
      }
      for (let i = 0; i < 3; i++) {
        const line = api.el('i', 'g3-pull-line');
        line.style.animationDelay = `${(i * 50).toFixed(0)}ms`;
        clone.appendChild(line);
      }
      // 陨石（浮层卡之外，挂在 body 级：要从卡外斜飞进来）
      const layer = bodyLayer('g3-meteor-layer', api.extraZ);
      const meteor = api.el('div', 'g3-meteor');
      meteor.style.left = `${rect.left + rect.width / 2 + rect.width * 1.5}px`;
      meteor.style.top = `${rect.top - rect.height * 1.5}px`;
      meteor.appendChild(api.el('i', 'g3-meteor-tail'));
      meteor.appendChild(api.el('i', 'g3-meteor-core'));
      layer.appendChild(meteor);
      void meteor.offsetWidth;
      // 撞击点 = 卡面中心（CSS 动画把它从右上带到中心）
      meteor.style.setProperty('--mx', `${(-rect.width * 1.5).toFixed(1)}px`);
      meteor.style.setProperty('--my', `${(rect.height * 1.5).toFixed(1)}px`);
      meteor.classList.add('fly');
      const impact = api.el('div', 'g3-meteor-impact');
      impact.style.left = `${rect.left + rect.width / 2}px`;
      impact.style.top = `${rect.top + rect.height / 2}px`;
      impact.appendChild(api.el('i', 'g3-meteor-shock'));
      impact.appendChild(api.el('i', 'g3-meteor-flash'));
      impact.appendChild(api.el('i', 'g3-meteor-scorch'));
      for (let i = 0; i < 10; i++) {
        const d = api.el('i', 'g3-meteor-debris');
        d.style.setProperty('--dx', `${api.rnd(-64, 64).toFixed(1)}px`);
        d.style.setProperty('--dy', `${api.rnd(-58, 46).toFixed(1)}px`);
        d.style.animationDelay = `${(300 + i * 16).toFixed(0)}ms`;
        impact.appendChild(d);
      }
      layer.appendChild(impact);
      clone.classList.add('g3-nova-discard');
      // 基础切割延后到撞击瞬间（用事件时定格的 rect，避免重渲染后节点失效）
      window.setTimeout(() => api.playCutAt(rect, cw, ccw, p), 320);
      window.setTimeout(() => clone.remove(), 760);
      window.setTimeout(() => layer.remove(), 1200);
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
      // 2026-09-13 修复（用户实测"新星删除特效未触发"）：延迟播放时 DOM 可能已重渲染 → 原节点失效
      // → 必须在**事件时刻**定格 rect/cw/ccw，延迟回调里用 buildFxCardAt 建浮层。
      const shot = { rect, cw, ccw };
      queueStaggered(`gen3-nova-delete-${p.owner}-${p.line}`, centerX, () => {
        const c = api.buildFxCardAt(shot.rect, shot.cw, shot.ccw, p, api.extraZ);
        if (!c) return;
        for (let i = 0; i < 4; i++) {
          const ray = api.el('i', 'g3-nova-burst-ray');
          ray.style.transform = `rotate(${i * 90 + 45}deg)`;
          c.appendChild(ray);
        }
        c.appendChild(api.el('i', 'g3-nova-burst-flash'));
        c.classList.add('g3-nova-delete');
        api.playShatterAt(shot.rect, shot.cw, shot.ccw, p);
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
      // 同新星删除：延迟播放必须用事件时定格的 rect（DOM 可能已重渲染）
      const shot = { rect: g.rect, cw: g.cw, ccw: g.ccw };
      queueStaggered(`gen3-wrath-flip-${p.owner}-${p.line}`, centerX, () => {
        const c = api.buildFxCardAt(shot.rect, shot.cw, shot.ccw, p, api.extraZ);
        if (!c) return;
        c.classList.add('g3-wrath-flip');
        c.appendChild(api.el('i', 'g3-wrath-bolt'));
        c.appendChild(api.el('i', 'g3-wrath-scorch'));
        api.playFlipAt(shot.rect, shot.cw, shot.ccw, p);
        window.setTimeout(() => c.remove(), 900);
      }, { windowMs: 40, gapMs: 80 });
      return true;
    }
    // 伏击 A1：翻正 = 黑幕 + 自下而上扫描线 + 9 宫格亮 1 格；翻面 = 黑幕合拢 + 九格熄灭。
    // 2026-09-13 用户清单 #9（"翻面太快太淡"）：翻面时长 350 → 620/500ms、九宫格放大到 68%、
    // 加白闪横线与「伏击·现身 / 伏击·潜伏」字样标、4 片阴影碎片外飞；层存活 860 → 1180ms。
    case 'ambush': {
      const revealing = p.faceUp; // 事件在翻转后发出：faceUp = 新状态
      const c = overlay(revealing ? 'g3-amb-reveal' : 'g3-amb-hide');
      // 伏击3 的目标是【被覆盖】的正面卡 → 只在其露出可见区域内播放（批次 E 收尾）
      if (c && state) {
        const hidden = clipInsetRightPct(state, p.uid);
        if (hidden > 0) c.style.clipPath = `inset(0 ${(hidden * 100).toFixed(1)}% 0 0)`;
      }
      if (c) {
        const grid = api.el('div', 'g3-amb-flip-grid');
        for (let i = 0; i < 9; i++) {
          const cell = api.el('i', 'g3-amb-flip-cell');
          cell.style.animationDelay = `${(revealing ? 80 + i * 42 : 140 + i * 36).toFixed(0)}ms`;
          if (revealing && i === 4) cell.classList.add('on');
          if (!revealing && (i === 1 || i === 5 || i === 7)) cell.classList.add('on');
          grid.appendChild(cell);
        }
        c.appendChild(grid);
        if (revealing) {
          c.appendChild(api.el('i', 'g3-amb-flip-scan'));
          c.appendChild(api.el('i', 'g3-amb-flip-flash'));
        }
        c.appendChild(api.el('i', `g3-amb-flip-chip ${revealing ? 'reveal' : 'hide'}`, revealing ? '伏击·现身' : '伏击·潜伏'));
        for (let i = 0; i < 4; i++) {
          const shard = api.el('i', 'g3-amb-flip-shard');
          shard.style.setProperty('--dx', `${api.rnd(-52, 52).toFixed(1)}px`);
          shard.style.setProperty('--dy', `${api.rnd(-42, 42).toFixed(1)}px`);
          shard.style.animationDelay = `${(200 + i * 40).toFixed(0)}ms`;
          c.appendChild(shard);
        }
      }
      api.playFlip(node, p, revealing ? 620 : 500);
      window.setTimeout(() => c?.remove(), 1180);
      return true;
    }
    // 惰性0 中 / 惰性2 中（I1/I2 的翻转变体）：被盖正面牌也可被翻 → 只画露出可见区域。
    // 2026-09-13 用户清单 #18（"惰性翻面太淡"）：改用独立 `g3-ine-flip` 材质（灰砂覆层 + 停转齿轮 +
    // 5 粒砂尘 + 「惰性·停转」标）+ 慢翻 900ms，层存活 2100ms。
    case 'inertia': {
      const c = overlay('g3-ine-flip');
      if (c && state) {
        const hidden = clipInsetRightPct(state, p.uid);
        if (hidden > 0) c.style.clipPath = `inset(0 ${(hidden * 100).toFixed(1)}% 0 0)`;
      }
      if (c) {
        const gear = api.el('i', 'g3-ine-flip-gear');
        gear.appendChild(api.el('i', 'g3-ine-flip-gear-hub'));
        c.appendChild(gear);
        for (let i = 0; i < 5; i++) {
          const dust = api.el('i', 'g3-ine-flip-dust');
          dust.style.left = `${18 + i * 16}%`;
          dust.style.top = `${30 + (i % 3) * 18}%`;
          dust.style.animationDelay = `${(240 + i * 110).toFixed(0)}ms`;
          c.appendChild(dust);
        }
        c.appendChild(api.el('i', 'g3-ine-flip-chip', '惰性·停转'));
      }
      api.playFlip(node, p, 900);
      window.setTimeout(() => c?.remove(), 2100);
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
      if (toRect) arcTrack(g.rect, toRect, 'g3-pride-arc', 'pride', 3, 520, api.extraZ, api);
      api.playShift(node, p);
      return true;
    // 新星 N3：橙色星轨（5 星点拖尾）；偏转反面卡时暗橙（不点亮卡面）
    case 'nova': {
      if (toRect) arcTrack(g.rect, toRect, `g3-nova-arc${p.faceUp ? '' : ' dim'}`, 'nova', 5, 560, api.extraZ, api);
      api.playShift(node, p);
      return true;
    }
    // 柔性 X2/X3：紫罗兰飘带（宽柔光 + 亮细线）+ 落点缎带小结；柔性2 特化=起点取覆盖者 + 下方柔2 亮一下
    case 'flexibility': {
      if (toRect) arcTrack(g.rect, toRect, 'g3-flx-arc', 'flexibility', 3, 540, api.extraZ, api);
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

/* ====================== 回手（R3，第 18 项修复补做） ====================== */

/**
 * 3 代「回手」附加层（点名：贪婪2 底·回合开始可回手你1张牌 → op return）。
 *
 * 设计稿 §4.3 行 R3：①源卡卡面探出**青玉抓取爪**（3 指，伸出 0.25s）；②被选卡被**品红绳线**
 * 拉回手牌（0.5s，基础回手飞行照常，绳线拖尾）；③手牌末尾落点**青玉圆环**收束 0.3s。
 *
 * 背景（2026-09-13 用户清单 #2「贪婪2 回手特效从未触发」）：引擎一直有发 `card:returned`
 * （resolve.ts 的 return op，triggerProtocol='greed'），但 UI 分发只在 `card:returned` 里特判了
 * water，`GEN3_CARD_FX_COVER.return=['greed']` 是空头条目（无实现、无调用）→ 本次补齐。
 * 注意：回手时 `payload.line` 已被引擎清空（卡已离开链路），所以定位只能用 owner + triggerUid。
 */
export function gen3ReturnFx(node: HTMLElement, p: Gen3CardPayload, api: Gen3CardFxApi): boolean {
  const protocol = p.triggerProtocol ?? '';
  if (!GEN3_CARD_FX_COVER.return.includes(protocol)) return false;
  const g = geom(node);
  if (!g) return false;

  switch (protocol) {
    case 'greed': {
      const layer = bodyLayer('g3-return-greed', api.extraZ);
      const src = p.triggerUid ? document.querySelector<HTMLElement>(`[data-uid="${p.triggerUid}"]`) : null;
      const sr = src ? src.getBoundingClientRect() : null;
      // ① 青玉抓取爪（贴在贪婪2 卡面：3 指自卡面探出）
      if (sr && sr.width > 0) {
        const claw = api.el('div', 'g3-greed-claw');
        claw.style.left = `${sr.left + sr.width * 0.16}px`;
        claw.style.top = `${sr.top + sr.height * 0.22}px`;
        claw.style.width = `${sr.width * 0.68}px`;
        claw.style.height = `${sr.height * 0.56}px`;
        for (let i = 0; i < 3; i++) claw.appendChild(api.el('i', `g3-greed-claw-finger f${i}`));
        layer.appendChild(claw);
        // ② 品红绳线（源卡 → 被回手的卡；边到边，不穿卡文）
        edgeLine(layer, sr, g.rect, 'g3-greed-rope', 120);
      }
      // ③ 手牌末尾落点青玉圆环
      const end = p.owner !== undefined ? handEndPos(p.owner) : null;
      if (end) {
        const ring = api.el('i', 'g3-return-jade-ring');
        ring.style.left = `${end.x}px`;
        ring.style.top = `${end.y}px`;
        ring.style.animationDelay = '240ms';
        layer.appendChild(ring);
      }
      api.playReturn(node, p); // 基础回手飞行照常（叠加不替换）
      window.setTimeout(() => layer.remove(), 1100);
      return true;
    }
    default:
      return false;
  }
}

/* ====================== 抽牌（A-DRAW，批次 C） ====================== */

/** card:drawn 载荷（无 uid：main.ts 负责基础抽牌动画，这里只加牌库侧/落点附加层） */
export interface Gen3DrawPayload {
  player?: 0 | 1;
  count?: number;
  triggerProtocol?: string;
  triggerDefId?: string;
  fromOpponentDeck?: boolean;
}

/** 手牌区容器（落点"饱胀"回弹挂在该容器上） */
function handEl(player: 0 | 1): HTMLElement | null {
  return document.querySelector<HTMLElement>(`.hand[data-player="${player}"]`);
}

/** 手牌区末端落点（取不到卡节点就退化到手牌区右缘） */
function handEndPos(player: 0 | 1): { x: number; y: number } | null {
  const hand = handEl(player);
  if (!hand) return null;
  const cards = hand.querySelectorAll<HTMLElement>('.card');
  const last = cards[cards.length - 1];
  const r = (last ?? hand).getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return null;
  return { x: last ? r.right - r.width / 2 : r.right - 24, y: r.top + r.height / 2 };
}

/**
 * 3 代抽牌附加层（点名：暴食 G3 / 支点 F2）。基础抽牌动画由 main.ts 播放，本层只加：
 *  - 暴食：牌库上方暗金"食道涡口"（镂空环 + 内圈齿，缓转）→ 金色碎屑 → 手牌落点闪光 + 手牌饱胀回弹；
 *  - 支点：青蓝刻度标尺 + 沿刻度滑动的游标 → 落点小环（支点4 命中时游标停在"4"并闪一次）。
 */
export function gen3DrawFx(p: Gen3DrawPayload, api: Gen3CardFxApi): boolean {
  const proto = p.triggerProtocol ?? '';
  if (!GEN3_CARD_FX_COVER.draw.includes(proto) || p.player === undefined) return false;
  const deck = api.deckPos(p.player);
  if (!deck) return false;
  const layer = bodyLayer(`g3-draw-layer ${proto}`, api.extraZ);
  const dcx = deck.left + deck.width / 2;
  const dcy = deck.top + deck.height / 2;
  const end = handEndPos(p.player);

  if (proto === 'gluttony') {
    const side = Math.max(84, deck.width * 1.25);
    const throat = api.el('div', 'g3-throat');
    throat.style.left = `${dcx}px`;
    throat.style.top = `${dcy}px`;
    throat.style.width = `${side}px`;
    throat.style.height = `${side}px`;
    throat.appendChild(api.el('i', 'g3-throat-ring outer'));
    throat.appendChild(api.el('i', 'g3-throat-ring inner'));
    const teeth = api.el('div', 'g3-throat-teeth');
    for (let i = 0; i < 8; i++) {
      const t = api.el('i', 'g3-throat-tooth');
      t.style.transform = `rotate(${i * 45}deg)`;
      teeth.appendChild(t);
    }
    throat.appendChild(teeth);
    layer.appendChild(throat);
    // 金褐碎屑：自涡口向手牌方向飘落（二次运动：先快后缓）
    for (let i = 0; i < 10; i++) {
      const c = api.el('i', 'g3-throat-crumb');
      c.style.left = `${dcx + api.rnd(-deck.width * 0.5, deck.width * 0.5)}px`;
      c.style.top = `${dcy + api.rnd(-10, 22)}px`;
      c.style.setProperty('--dx', end ? `${((end.x - dcx) * api.rnd(0.35, 0.75)).toFixed(1)}px` : `${api.rnd(-30, 30).toFixed(1)}px`);
      c.style.setProperty('--dy', end ? `${((end.y - dcy) * api.rnd(0.3, 0.7)).toFixed(1)}px` : `${api.rnd(40, 90).toFixed(1)}px`);
      c.style.animationDelay = `${(i * 34).toFixed(0)}ms`;
      layer.appendChild(c);
    }
    if (end) {
      const flash = api.el('i', 'g3-draw-land');
      flash.style.left = `${end.x}px`;
      flash.style.top = `${end.y}px`;
      layer.appendChild(flash);
      const hand = handEl(p.player);
      if (hand) {
        hand.classList.remove('g3-hand-bulge');
        void hand.offsetWidth;
        hand.classList.add('g3-hand-bulge');
        window.setTimeout(() => hand.classList.remove('g3-hand-bulge'), 320);
      }
    }
    window.setTimeout(() => layer.remove(), 1100);
    return true;
  }

  // 支点 F2：青蓝标尺（铺在牌库与手牌之间）+ 游标滑块 + 落点环
  const to = end ?? { x: dcx + 160, y: dcy };
  const x1 = Math.min(dcx, to.x);
  const x2 = Math.max(dcx, to.x);
  const ruler = api.el('div', 'g3-ruler');
  ruler.style.left = `${x1 - 8}px`;
  ruler.style.top = `${(dcy + to.y) / 2 - 16}px`;
  ruler.style.width = `${Math.max(120, x2 - x1 + 16)}px`;
  for (let i = 0; i < 9; i++) {
    const tick = api.el('i', 'g3-ruler-tick');
    tick.style.left = `${(i / 8) * 100}%`;
    if (i % 4 === 0) tick.classList.add('major');
    ruler.appendChild(tick);
  }
  ruler.appendChild(api.el('i', 'g3-ruler-marker'));
  if (p.triggerDefId === 'fulcrum-4') ruler.classList.add('at-four');
  layer.appendChild(ruler);
  const land = api.el('i', 'g3-draw-land fulcrum');
  land.style.left = `${to.x}px`;
  land.style.top = `${to.y}px`;
  layer.appendChild(land);
  window.setTimeout(() => layer.remove(), 900);
  return true;
}

/* ====================== 反面打出（A-FACEDOWN，批次 C） ====================== */

/**
 * 3 代反面打出附加层（点名：暴食0 顶 G1 / 压制 O1 / 刚性 Y1 / 惰性 I2）。
 * kind：'deck' = 牌库顶反打（card:deck-played）、'hand' = 手牌反打（card:hand-played）。
 * 基础飞行照常调用（惰性按协议语法放慢到 700ms）。
 */
export function gen3FaceDownFx(kind: 'deck' | 'hand', p: Gen3CardPayload, api: Gen3CardFxApi): boolean {
  const proto = p.triggerProtocol ?? '';
  if (!GEN3_CARD_FX_COVER.facedown.includes(proto)) return false;
  const slot = p.owner !== undefined && p.line != null
    ? document.querySelector<HTMLElement>(`.stack-slot[data-player="${p.owner}"][data-line="${p.line}"]`)
    : null;
  const slotRect = slot ? slot.getBoundingClientRect() : null;
  const base = (): void => {
    if (kind === 'deck') api.playDeckPlay(p, proto === 'inertia' ? 700 : undefined);
    else api.playHandPlay(p, proto === 'inertia' ? 700 : undefined);
  };

  switch (proto) {
    // 暴食0 顶（清缓存后反打）：齿颚咬合 + 落点金褐碎屑
    case 'gluttony': {
      const src = p.triggerUid ? document.querySelector<HTMLElement>(`[data-uid="${p.triggerUid}"]`) : null;
      if (src) {
        const c = api.buildFxCard(src, p, api.extraZ);
        if (c) {
          c.classList.add('g3-glut-deckplay');
          for (const side of ['l', 'r'] as const) {
            const jaw = api.el('div', `g3-bite-jaw ${side}`);
            for (let i = 0; i < 3; i++) jaw.appendChild(api.el('i', `g3-bite-tooth t${i}`));
            c.appendChild(jaw);
          }
          window.setTimeout(() => c.remove(), 900);
        }
      }
      if (slotRect) {
        const layer = bodyLayer('g3-glut-crumbs-layer', api.extraZ);
        for (let i = 0; i < 8; i++) {
          const crumb = api.el('i', 'g3-glut-crumb-fly');
          crumb.style.left = `${slotRect.left + api.rnd(6, Math.max(10, slotRect.width - 6))}px`;
          crumb.style.top = `${slotRect.top + slotRect.height * 0.6}px`;
          crumb.style.setProperty('--dx', `${api.rnd(-26, 26).toFixed(1)}px`);
          crumb.style.setProperty('--dy', `${api.rnd(-16, 26).toFixed(1)}px`);
          crumb.style.animationDelay = `${(i * 30).toFixed(0)}ms`;
          layer.appendChild(crumb);
        }
        window.setTimeout(() => layer.remove(), 900);
      }
      base();
      return true;
    }
    // 压制 O1：落点上方 4×4 阵列下压 → 触地碎裂细边 + 压痕冲击环 + 冷白尘埃
    case 'overwhelm': {
      if (slotRect) {
        const layer = bodyLayer('g3-ovw-fall-layer', api.extraZ);
        const array = api.el('div', 'g3-ovw-drop-array');
        array.style.left = `${slotRect.left - 6}px`;
        array.style.top = `${slotRect.top - 40}px`;
        array.style.width = `${slotRect.width + 12}px`;
        array.style.height = `${Math.max(60, slotRect.height * 0.6)}px`;
        for (let i = 0; i < 16; i++) array.appendChild(api.el('i', 'g3-ovw-drop-cell'));
        layer.appendChild(array);
        const ring = api.el('i', 'g3-impact-ring');
        ring.style.left = `${slotRect.left + slotRect.width / 2}px`;
        ring.style.top = `${slotRect.top + slotRect.height}px`;
        ring.style.animationDelay = '220ms';
        layer.appendChild(ring);
        for (let i = 0; i < 6; i++) {
          const d = api.el('i', 'g3-ovw-dust-bit');
          d.style.left = `${slotRect.left + slotRect.width / 2 + api.rnd(-18, 18)}px`;
          d.style.top = `${slotRect.top + slotRect.height}px`;
          d.style.setProperty('--dx', `${api.rnd(-40, 40).toFixed(1)}px`);
          d.style.setProperty('--dy', `${api.rnd(-26, -6).toFixed(1)}px`);
          d.style.animationDelay = `${240 + i * 22}ms`;
          layer.appendChild(d);
        }
        window.setTimeout(() => layer.remove(), 900);
      }
      base();
      return true;
    }
    // 刚性 Y1：紫底荧光黄护板自目标线下方升起（板面迷宫走线）→ 落位后收边 + 荧光黄扫线
    case 'rigidity': {
      if (slotRect) {
        const layer = bodyLayer('g3-rig-plate-layer', api.extraZ);
        const plate = api.el('div', 'g3-rig-plate');
        plate.style.left = `${slotRect.left - 4}px`;
        plate.style.top = `${slotRect.top}px`;
        plate.style.width = `${slotRect.width + 8}px`;
        plate.style.height = `${slotRect.height}px`;
        for (let i = 0; i < 5; i++) {
          const line = api.el('i', 'g3-rig-plate-line');
          line.style.top = `${12 + i * 18}%`;
          line.style.animationDelay = `${(i * 90).toFixed(0)}ms`;
          plate.appendChild(line);
        }
        layer.appendChild(plate);
        const sweep = api.el('i', 'g3-rig-plate-sweep');
        sweep.style.left = `${slotRect.left - 4}px`;
        sweep.style.top = `${slotRect.top + slotRect.height * 0.62}px`;
        sweep.style.width = `${slotRect.width + 8}px`;
        layer.appendChild(sweep);
        window.setTimeout(() => layer.remove(), 900);
      }
      base();
      return true;
    }
    // 惰性 I2：慢落（基础飞行放慢到 700ms）+ 灰砂覆盖 + 落地 4 粒砂尘 + 一圈灰环快速即灭（无冲击）
    case 'inertia': {
      if (slotRect) {
        const layer = bodyLayer('g3-ine-sand-layer', api.extraZ);
        const veil = api.el('i', 'g3-ine-sand-veil');
        veil.style.left = `${slotRect.left - 6}px`;
        veil.style.top = `${slotRect.top - 30}px`;
        veil.style.width = `${slotRect.width + 12}px`;
        veil.style.height = `${slotRect.height + 40}px`;
        layer.appendChild(veil);
        const ring = api.el('i', 'g3-ine-tame-ring');
        ring.style.left = `${slotRect.left + slotRect.width / 2}px`;
        ring.style.top = `${slotRect.top + slotRect.height}px`;
        ring.style.animationDelay = '420ms';
        layer.appendChild(ring);
        for (let i = 0; i < 4; i++) {
          const d = api.el('i', 'g3-ine-sand-bit');
          d.style.left = `${slotRect.left + slotRect.width / 2 + api.rnd(-14, 14)}px`;
          d.style.top = `${slotRect.top + slotRect.height}px`;
          d.style.setProperty('--dx', `${api.rnd(-14, 14).toFixed(1)}px`);
          d.style.setProperty('--dy', `${api.rnd(6, 18).toFixed(1)}px`);
          d.style.animationDelay = `${430 + i * 30}ms`;
          layer.appendChild(d);
        }
        window.setTimeout(() => layer.remove(), 1200);
      }
      base();
      return true;
    }
    // 嫉妒 E3（嫉妒3 底「对手在此线打出后 → 己方牌库顶反面打出1张到此线」）：
    // ①该线玉青故障横条横扫一次 + 卡面上浮「夺取」小字样；②牌库顶被橙色光线拉出（拖尾）；③落点玉青涟漪。
    // 2026-09-13 用户清单 #2「嫉妒3 特效从未触发」：引擎一直发 card:deck-played（protocol='envy'），
    // 但本 switch 缺 envy 分支（覆盖表却已列 envy）→ 只播了基础飞行，本次补齐。
    case 'envy': {
      if (slotRect) {
        const layer = bodyLayer('g3-envy-fd-layer', api.extraZ);
        const bar = api.el('div', 'g3-envy-glitch-bar');
        bar.style.left = `${slotRect.left - 8}px`;
        bar.style.top = `${slotRect.top + slotRect.height * 0.44}px`;
        bar.style.width = `${slotRect.width + 16}px`;
        for (let i = 0; i < 5; i++) bar.appendChild(api.el('i', `g3-envy-glitch-line l${i}`));
        layer.appendChild(bar);
        const chip = api.el('i', 'g3-envy-seize-chip', '夺取');
        chip.style.left = `${slotRect.left + slotRect.width / 2}px`;
        chip.style.top = `${slotRect.top + slotRect.height * 0.26}px`;
        layer.appendChild(chip);
        const deck = p.owner !== undefined ? api.deckPos(p.owner) : null;
        if (deck) edgeLine(layer, deck, slotRect, 'g3-envy-pull-beam', 60);
        const ripple = api.el('i', 'g3-envy-land-ripple');
        ripple.style.left = `${slotRect.left + slotRect.width / 2}px`;
        ripple.style.top = `${slotRect.top + slotRect.height / 2}px`;
        ripple.style.animationDelay = '300ms';
        layer.appendChild(ripple);
        window.setTimeout(() => layer.remove(), 1400);
      }
      base();
      return true;
    }
    default:
      return false;
  }
}

/* ====================== 打出瞬间（E4：嫉妒4，第 18 项补做） ====================== */

/**
 * 3 代「打出瞬间」附加层（点名：嫉妒4 中·若对手已编译协议比你多 → 翻转1张）。
 * 设计稿 §4.1 行 E4：①打出瞬间卡面上方浮出**已编译数对比**（己方青 / 对手橙两个计数块，0.6s）；
 * ②对手多 → 计数条抖动 + 玉青故障闪 3 帧；③条件不成立 → 只播计数（灰、快速淡出）。
 *
 * 背景（2026-09-13 用户清单 #2「嫉妒4 额外特效从未触发」）：翻转分支（card:flipped → gen3FlipFx
 * case 'envy'）一直是通的，但**打出瞬间**的计数对比锚在 `card:played` 上，而分发器此前没有
 * `case 'card:played'`（直接落到 default return）→ 这半段从未播过。本次补上。
 * 定位优先用目标链路槽（打出瞬间卡节点可能还是手牌里的旧节点），退化用传入节点。
 */
export function gen3PlayFx(
  node: HTMLElement | null,
  p: Gen3CardPayload,
  state: GameState,
  api: Gen3CardFxApi,
): boolean {
  if (p.defId !== 'envy-4') return false;
  const anchor = slotRectOf(p) ?? (node ? geom(node)?.rect ?? null : null);
  if (!anchor) return false;
  const owner: 0 | 1 = p.owner ?? 0;
  const mine = state.players[owner].protocols.filter((x) => x.compiled).length;
  const foe = state.players[owner === 0 ? 1 : 0].protocols.filter((x) => x.compiled).length;
  const more = foe > mine;
  const layer = bodyLayer('g3-envy-play-layer', api.extraZ);
  const box = api.el('div', more ? 'g3-envy-play-count more' : 'g3-envy-play-count less');
  box.style.left = `${(anchor.left + anchor.width / 2).toFixed(1)}px`;
  box.style.top = `${(anchor.top - 28).toFixed(1)}px`;
  box.appendChild(api.el('i', 'g3-envy-play-chip mine', `己方 ${mine}`));
  box.appendChild(api.el('i', 'g3-envy-play-vs', 'vs'));
  box.appendChild(api.el('i', 'g3-envy-play-chip foe', `对手 ${foe}`));
  layer.appendChild(box);
  if (more) {
    // 条件成立：玉青故障闪 3 帧（叠在目标线槽上）
    for (let i = 0; i < 3; i++) {
      const glitch = api.el('i', 'g3-envy-play-glitch');
      glitch.style.left = `${anchor.left.toFixed(1)}px`;
      glitch.style.top = `${(anchor.top + anchor.height * 0.3).toFixed(1)}px`;
      glitch.style.width = `${anchor.width.toFixed(1)}px`;
      glitch.style.height = `${(anchor.height * 0.4).toFixed(1)}px`;
      glitch.style.animationDelay = `${(i * 90).toFixed(0)}ms`;
      layer.appendChild(glitch);
    }
  } else {
    box.appendChild(api.el('i', 'g3-envy-play-hint', '条件未满足'));
  }
  window.setTimeout(() => layer.remove(), more ? 1000 : 620);
  return true;
}

/* ====================== 空动作反馈（可选触发被跳过，Q5） ====================== */

/**
 * 3 代「空动作反馈」：玩家**跳过可选选择**时播放（引擎 `card:effect-skipped` / `card:trigger-skipped`）。
 *
 * 设计稿 §7 Q5 明确要求"空动作也要有反馈"（贪婪爪空抓 / 傲慢指针变灰下坠 / 暴食空咬 / 嫉妒计数失败变灰）。
 * 之前这条无法实现——引擎对"点了跳过"不发任何事件。批次 F 补上事件后，这里只给**点名的三个协议**
 * 做专属空动作（贪婪抓空 / 傲慢指针下坠 / 暴食空咬），其余协议**不加层**（避免每次跳过都蹦提示 = 噪音）。
 */
export function gen3SkipFx(node: HTMLElement, p: Gen3CardPayload, api: Gen3CardFxApi): boolean {
  const proto = (p.defId ?? '').split('-')[0];
  if (!GEN3_SKIP_BESPOKE.includes(proto)) return false;
  const g = geom(node);
  if (!g) return false;
  const { rect } = g;
  const layer = bodyLayer('g3-skip-layer', api.extraZ);
  // 通用衬底：卡面一圈灰脉冲 + 底部「未触发」小标（让"空动作"一眼可读）
  const pulse = api.el('i', 'g3-skip-pulse');
  pulse.style.left = `${rect.left}px`;
  pulse.style.top = `${rect.top}px`;
  pulse.style.width = `${rect.width}px`;
  pulse.style.height = `${rect.height}px`;
  layer.appendChild(pulse);
  const chip = api.el('i', 'g3-skip-chip', '未触发');
  chip.style.left = `${rect.left + rect.width / 2}px`;
  chip.style.top = `${rect.bottom + 4}px`;
  layer.appendChild(chip);

  if (proto === 'greed') {
    // 青玉抓取爪"空抓一下"：3 指自卡面探出 → 什么都没抓到 → 收回（指间落灰）
    const claw = api.el('div', 'g3-skip-claw');
    claw.style.left = `${rect.left + rect.width * 0.18}px`;
    claw.style.top = `${rect.top + rect.height * 0.26}px`;
    claw.style.width = `${rect.width * 0.64}px`;
    claw.style.height = `${rect.height * 0.5}px`;
    for (let i = 0; i < 3; i++) claw.appendChild(api.el('i', `g3-skip-finger f${i}`));
    layer.appendChild(claw);
    for (let i = 0; i < 4; i++) {
      const dust = api.el('i', 'g3-skip-dust');
      dust.style.left = `${rect.left + rect.width * (0.24 + i * 0.17)}px`;
      dust.style.top = `${rect.top + rect.height * 0.72}px`;
      dust.style.setProperty('--dx', `${api.rnd(-14, 14).toFixed(1)}px`);
      dust.style.animationDelay = `${(140 + i * 40).toFixed(0)}ms`;
      layer.appendChild(dust);
    }
  } else if (proto === 'pride') {
    // 金色指针：自卡面探出 → 指针变灰 → 下坠（"这次没升起来"）
    const pointer = api.el('div', 'g3-skip-pointer');
    pointer.style.left = `${rect.left + rect.width * 0.42}px`;
    pointer.style.top = `${rect.top + rect.height * 0.3}px`;
    pointer.style.width = `${rect.width * 0.16}px`;
    pointer.style.height = `${rect.height * 0.46}px`;
    pointer.appendChild(api.el('i', 'g3-skip-pointer-needle'));
    layer.appendChild(pointer);
  } else if (proto === 'gluttony') {
    // 齿颚空咬：上下颚合拢咬了个空 → 张开（无碎屑、无咬合闪光）
    for (const side of ['top', 'bottom'] as const) {
      const jaw = api.el('div', `g3-skip-jaw ${side}`);
      jaw.style.left = `${rect.left - 4}px`;
      jaw.style.top = `${rect.top}px`;
      jaw.style.width = `${rect.width + 8}px`;
      jaw.style.height = `${rect.height}px`;
      for (let i = 0; i < 5; i++) {
        const tooth = api.el('i', 'g3-skip-tooth');
        tooth.style.left = `${6 + i * 18.5}%`;
        jaw.appendChild(tooth);
      }
      layer.appendChild(jaw);
    }
  }
  window.setTimeout(() => layer.remove(), 950);
  return true;
}

/* ============ 整摞弃置牌库（inertia-4，批次 C） ============ */

/** deck:discarded 载荷（resolve.ts 在卡仍在牌库时发射，UI 据此取牌库区矩形） */
export interface Gen3DeckDiscardPayload {
  player: 0 | 1;
  count: number;
  sourceDefId?: string;
}

/**
 * 3 代「弃置整个牌库」附加层（点名卡：惰性4 中，双方各弃其牌库）。
 * 惰性语法 = 去饱和 + 沙化 + 无冲击：整摞卡背先变灰白（沙化覆层）→ 化作灰砂流飞向本家弃牌堆。
 */
export function gen3DeckDiscardFx(p: Gen3DeckDiscardPayload, api: Gen3CardFxApi): boolean {
  if (p.count <= 0) return false;
  const deck = api.deckPos(p.player);
  if (!deck) return false;
  const layer = bodyLayer('g3-ine-deck-layer', api.extraZ);
  // 沙化覆层：盖在牌库整摞上（略高于牌堆，含顶部错位感）
  const veil = api.el('div', 'g3-ine-deck-sand');
  veil.style.left = `${deck.left - 3}px`;
  veil.style.top = `${deck.top - 4}px`;
  veil.style.width = `${deck.width + 6}px`;
  veil.style.height = `${deck.height + 8}px`;
  layer.appendChild(veil);
  // 灰砂流：自牌库右缘流向本家弃牌堆（取 .trash-pile 矩形，取不到则向右下漂）
  const trash = document.querySelector<HTMLElement>(`.trash-pile.p${p.player + 1}`);
  const tr = trash ? trash.getBoundingClientRect() : null;
  const sx = deck.left + deck.width * 0.8;
  const sy = deck.top + deck.height * 0.2;
  const tx = tr ? tr.left + tr.width / 2 : deck.left + deck.width + 120;
  const ty = tr ? tr.top + tr.height / 2 : deck.top + deck.height + 40;
  for (let i = 0; i < 12; i++) {
    const bit = api.el('i', 'g3-ine-deck-bit');
    bit.style.left = `${sx + api.rnd(-6, 6)}px`;
    bit.style.top = `${sy + api.rnd(-4, deck.height * 0.8)}px`;
    bit.style.setProperty('--dx', `${((tx - sx) * api.rnd(0.75, 1.05) + api.rnd(-14, 14)).toFixed(1)}px`);
    bit.style.setProperty('--dy', `${((ty - sy) * api.rnd(0.75, 1.05) + api.rnd(-12, 12)).toFixed(1)}px`);
    bit.style.animationDelay = `${(i * 40).toFixed(0)}ms`;
    layer.appendChild(bit);
  }
  window.setTimeout(() => layer.remove(), 1500);
  return true;
}
/* ====================== 编译后（批次 C） ====================== */

/** line:compiled 载荷（compile-body.ts 发射；批次 C 新增 sourceDefId/sourceUid） */
export interface Gen3CompiledPayload {
  player: 0 | 1;
  line: number;
  protocolDefId: string;
  sourceDefId?: string;
  sourceUid?: string;
}

/**
 * 3 代"编译后"附加层（点名：贪婪1 底 R2 / 动量编译后 M2）。
 *  - 贪婪1（sourceDefId='greed-1'）：青玉契约印自贪婪1 卡面浮出 → 落到所选线的协议卡上（盖章 + 冲击环）；
 *  - 动量（场上双方任一未覆盖正面动量卡）：编译瞬间卡面橙色蓄力环向内收束 + 牌库区加速条纹 +
 *    编译线落点冲击环（动量6 的"删除此牌"由引擎照常走 card:deleted，本层不重复）。
 */
export function gen3CompiledFx(p: Gen3CompiledPayload, state: GameState, api: Gen3CardFxApi): boolean {
  let handled = false;
  const cell = document.querySelector<HTMLElement>(`.protocol-cell[data-player="${p.player}"][data-line="${p.line}"]`);
  const cellRect = cell ? cell.getBoundingClientRect() : null;

  // ① 贪婪1 底：契约印（自触发卡浮出 → 落到编译线协议卡上盖章）
  if (p.sourceDefId === 'greed-1') {
    handled = true;
    const layer = bodyLayer('g3-greed-seal-layer', api.extraZ);
    const src = p.sourceUid ? document.querySelector<HTMLElement>(`[data-uid="${p.sourceUid}"]`) : null;
    const from = src ? src.getBoundingClientRect() : null;
    const seal = api.el('div', 'g3-greed-seal');
    seal.style.left = `${from ? from.left + from.width / 2 : (cellRect?.left ?? window.innerWidth / 2)}px`;
    seal.style.top = `${from ? from.top + from.height / 2 : (cellRect?.top ?? window.innerHeight / 2)}px`;
    seal.appendChild(api.el('i', 'g3-greed-seal-hex'));
    seal.appendChild(api.el('i', 'g3-greed-seal-rune'));
    layer.appendChild(seal);
    void seal.offsetWidth; // 强制样式提交（起飞 transition 必动画）
    if (cellRect) {
      seal.style.left = `${cellRect.left + cellRect.width / 2}px`;
      seal.style.top = `${cellRect.top + cellRect.height / 2}px`;
      seal.classList.add('stamp');
      const ring = api.el('i', 'g3-impact-ring greed');
      ring.style.left = `${cellRect.left + cellRect.width / 2}px`;
      ring.style.top = `${cellRect.top + cellRect.height / 2}px`;
      ring.style.animationDelay = '620ms';
      layer.appendChild(ring);
    }
    window.setTimeout(() => layer.remove(), 1600);
  }

  // ② 动量：场上动量卡各自的蓄力环 + 编译线落点冲击环 + 牌库加速条纹
  const momentumUids: string[] = [];
  for (const pid of [0, 1] as const) {
    for (const stack of state.players[pid].stacks) {
      for (const card of stack) {
        if (card.faceUp && card.defId.startsWith('momentum-')) momentumUids.push(card.uid);
      }
    }
  }
  if (momentumUids.length > 0) {
    handled = true;
    const layer = bodyLayer('g3-mom-compile-layer', api.extraZ);
    for (const [i, uid] of momentumUids.entries()) {
      const node = document.querySelector<HTMLElement>(`[data-uid="${uid}"]`);
      if (!node) continue;
      const r = node.getBoundingClientRect();
      if (r.width === 0) continue;
      const wrap = api.el('div', 'g3-mom-compile-card');
      wrap.style.left = `${r.left}px`;
      wrap.style.top = `${r.top}px`;
      wrap.style.width = `${r.width}px`;
      wrap.style.height = `${r.height}px`;
      wrap.style.animationDelay = `${(i * 90).toFixed(0)}ms`;
      wrap.appendChild(api.el('i', 'g3-mom-compile-ring r1'));
      wrap.appendChild(api.el('i', 'g3-mom-compile-ring r2'));
      layer.appendChild(wrap);
    }
    const deck = api.deckPos(p.player);
    if (deck) {
      for (let i = 0; i < 3; i++) {
        const s = api.el('i', 'g3-mom-deck-streak');
        s.style.left = `${deck.left - 10}px`;
        s.style.top = `${deck.top + api.rnd(6, Math.max(10, deck.height - 6))}px`;
        s.style.animationDelay = `${(i * 60).toFixed(0)}ms`;
        layer.appendChild(s);
      }
    }
    if (cellRect) {
      const ring = api.el('i', 'g3-impact-ring');
      ring.style.left = `${cellRect.left + cellRect.width / 2}px`;
      ring.style.top = `${cellRect.top + cellRect.height}px`;
      ring.style.animationDelay = '160ms';
      layer.appendChild(ring);
    }
    window.setTimeout(() => layer.remove(), 1100);
  }
  return handled;
}
