/**
 * 3 代（MN03 / AX03）15 套协议「已编译」常驻特效（批次 A）。
 *
 * 与 1/2 代完全同一套骨架（设计稿 §3.1）：
 *  - 由 render.ts 的 buildCompiledFx 建持久层 → 挂 document.body，只重定位不重建 → 动画永不重启；
 *  - 层类 `compiled-fx compiled-fx-<defId>`（z=100）；本模块只往里塞子节点；
 *  - 每协议 = 四角护边 + **1 件主体结构（常驻 CSS 动画）** + **1 组周期爆发**（scheduleCompiledLoop，
 *    各协议各自 ≥10s + 抖动，见 render.ts COMPILED_MIN_GAP_MS）；
 *  - 全部纯 CSS 动画（关键帧在 styles.css「3代 已编译协议特效」段），JS 只搭结构 + 排爆发。
 *  - **刻意不用 mask / @property**（与既有骨架一致）：环绕/轨迹一律用 `offset-path`（inset/circle）
 *    与 `border-*`/`clip-path`/渐变/多层阴影实现，避免兼容性坑。
 *
 * 视觉语法（设计稿 §1.3，取自官方协议卡图意象）：
 *  嫉妒=玉青双涡旋+数据故障条+橙金锚点被吸入 ｜ 暴食=齿颚开合+碎屑内收 ｜ 贪婪=中心取物口+触手环抱攫取
 *  色欲=血红牵引链环卡+心形手爪徽标 ｜ 傲慢=金色光柱+几何塔+金冠落下 ｜ 怠惰=极慢涟漪+泥浆+余烬
 *  暴怒=猩红爆刺+青蓝残片+锯齿闪电 ｜ 伏击=冷蓝 9 宫格+阴影碎片+扫描线 ｜ 支点=杠杆+砝码+刻度环
 *  压制=4×4 阵列+桁架（周期整阵下压） ｜ 动量=弧轨+速度残影+蓄力环 ｜ 新星=旋转星芒+8 尖刺+碎块
 *  惰性=灰化+停转齿轮+尘埃 ｜ 僵化=荧光黄迷宫走线+四角锚钉+紫护壁 ｜ 灵活=紫罗兰飘带+层叠薄板
 *
 * 品质七要件（设计稿 §8.1）：多元素层次 / 渐变+内阴影+高光材质 / 分阶段缓动+二次运动 /
 * 三阶配色（主色·强调色·高光）/ 起止衔接（.in/.out 与 0.2~0.4s 收束）/ 与基础动画咬合（层随卡）/
 * 不遮卡文（元素贴边、居中件低透明度、爆发件集中在卡面中央但短暂）。
 */

/** render.ts 传入的宿主能力（保持本模块不反向依赖 render.ts 私有实现） */
export interface Gen3FxApi {
  el(tag: string, cls: string, text?: string): HTMLElement;
  layerGeom(layer: HTMLElement): { w: number; h: number; cx: number; cy: number; diag: number; min: number } | null;
  reflow(e: HTMLElement): void;
  corners(layer: HTMLElement, cls: string): void;
  scheduleLoop(layer: HTMLElement, defId: string, firstMs: number, burst: (done: () => void) => void): void;
  timer(defId: string, fn: () => void, ms: number): void;
  rnd(a: number, b: number): number;
}

/** 3 代 15 套协议（顺序 = 数据顺序，便于对照） */
export const GEN3_PROTOCOLS = [
  'envy', 'gluttony', 'greed', 'lust', 'pride', 'sloth', 'wrath', 'ambush',
  'fulcrum', 'overwhelm', 'momentum', 'nova', 'inertia', 'rigidity', 'flexibility',
] as const;

/** 3 代协议已编译总入口（render.ts appendNewCompiledFx 调用；非 3 代协议返回 false） */
export function appendGen3CompiledFx(layer: HTMLElement, defId: string, api: Gen3FxApi): boolean {
  switch (defId) {
    case 'envy': appendEnvy(layer, defId, api); return true;
    case 'gluttony': appendGluttony(layer, defId, api); return true;
    case 'greed': appendGreed(layer, defId, api); return true;
    case 'lust': appendLust(layer, defId, api); return true;
    case 'pride': appendPride(layer, defId, api); return true;
    case 'sloth': appendSloth(layer, defId, api); return true;
    case 'wrath': appendWrath(layer, defId, api); return true;
    case 'ambush': appendAmbush(layer, defId, api); return true;
    case 'fulcrum': appendFulcrum(layer, defId, api); return true;
    case 'overwhelm': appendOverwhelm(layer, defId, api); return true;
    case 'momentum': appendMomentum(layer, defId, api); return true;
    case 'nova': appendNova(layer, defId, api); return true;
    case 'inertia': appendInertia(layer, defId, api); return true;
    case 'rigidity': appendRigidity(layer, defId, api); return true;
    case 'flexibility': appendFlexibility(layer, defId, api); return true;
    default: return false;
  }
}

/* ============================ 共享小工具 ============================ */

/** 主体结构容器（占满层；CSS 里统一 position:absolute; inset:0; overflow:visible） */
function host(layer: HTMLElement, cls: string, api: Gen3FxApi): HTMLElement {
  const h = api.el('div', cls);
  layer.appendChild(h);
  return h;
}

/** 在环带路径（offset-path: inset）上均匀铺 n 个小件：等分负 delay → 沿环均布且各自相位错开 */
function orbitRing(parent: HTMLElement, cls: string, n: number, api: Gen3FxApi, cycleS: number): void {
  for (let i = 0; i < n; i++) {
    const node = api.el('i', cls);
    node.style.animationDelay = `${(-(cycleS / n) * i).toFixed(2)}s`;
    parent.appendChild(node);
  }
}

/** 在圆路径（offset-path: circle）上均匀铺 n 个线圈段：用于涡旋/转轮等"卡内环形"结构 */
function coilRing(parent: HTMLElement, cls: string, n: number, api: Gen3FxApi, cycleS: number): void {
  for (let i = 0; i < n; i++) {
    const node = api.el('i', cls);
    node.style.animationDelay = `${(-(cycleS / n) * i).toFixed(2)}s`;
    parent.appendChild(node);
  }
}

/** 撒 n 个同类小件（随机位置/尺寸/相位）；大小与位置用内联样式，动画在 CSS */
function scatter(
  parent: HTMLElement,
  cls: string,
  n: number,
  api: Gen3FxApi,
  place: (i: number) => { x: number; y: number },
  size: (i: number) => number,
): void {
  for (let i = 0; i < n; i++) {
    const p = place(i);
    const node = api.el('i', cls);
    node.style.left = `${p.x}%`;
    node.style.top = `${p.y}%`;
    const s = size(i);
    node.style.width = `${s}px`;
    node.style.height = `${s}px`;
    node.style.animationDelay = `${-api.rnd(0, 4).toFixed(2)}s`;
    parent.appendChild(node);
  }
}

/** 从卡面中心爆出一把粒子（内联 --dx/--dy 决定飞行向量；CSS keyframe 消费）。
 *  defId 参与 fxTimer 记账 → 协议取消编译时随 clearCompiledFxTimers 一起清理。 */
function burstParticles(
  h: HTMLElement, cls: string, n: number, api: Gen3FxApi, spread: number, lifeMs: number, defId: string,
): void {
  const wrap = api.el('div', `${cls}-wrap`);
  for (let i = 0; i < n; i++) {
    const p = api.el('i', cls);
    p.style.setProperty('--dx', `${api.rnd(-spread, spread).toFixed(1)}px`);
    p.style.setProperty('--dy', `${api.rnd(-spread, spread * 0.75).toFixed(1)}px`);
    p.style.animationDelay = `${(i * 0.02).toFixed(2)}s`;
    p.style.animationDuration = `${lifeMs}ms`;
    wrap.appendChild(p);
  }
  h.appendChild(wrap);
  api.timer(defId, () => wrap.remove(), lifeMs + 260);
}

/** 扩散冲击环（落点感）：append → reflow → .on */
function shockRing(h: HTMLElement, cls: string, api: Gen3FxApi): HTMLElement {
  const ring = api.el('div', cls);
  h.appendChild(ring);
  api.reflow(ring);
  ring.classList.add('on');
  return ring;
}

/* ============================ 1. 嫉妒 envy ============================ */
/** 玉青双涡旋（反向、不同半径/速度）+ 涡心 + 3 条数据故障横条；
 *  周期：橙金锚点从卡外飞入涡心被"夺走" → 涡心白闪 + 玉青粒子迸发。 */
function appendEnvy(layer: HTMLElement, defId: string, api: Gen3FxApi): void {
  api.corners(layer, 'compiled-envy-corner');
  const h = host(layer, 'gen3-envy-host', api);
  const buildSwirl = (which: 'a' | 'b'): HTMLElement => {
    const ring = api.el('div', `gen3-envy-swirl ${which}`);
    coilRing(ring, 'gen3-envy-coil', which === 'a' ? 12 : 8, api, which === 'a' ? 12 : 19);
    return ring;
  };
  h.appendChild(buildSwirl('a'));
  h.appendChild(buildSwirl('b'));
  h.appendChild(api.el('div', 'gen3-envy-core'));
  const glitch = api.el('div', 'gen3-envy-glitch');
  for (let i = 0; i < 3; i++) {
    const bar = api.el('i', 'gen3-envy-glitch-bar');
    bar.style.top = `${20 + i * 26 + api.rnd(-4, 4)}%`;
    bar.style.animationDelay = `${-api.rnd(0, 5).toFixed(2)}s`;
    glitch.appendChild(bar);
  }
  h.appendChild(glitch);

  const burst = (done: () => void): void => {
    if (!layer.isConnected) { done(); return; }
    const anchor = api.el('div', 'gen3-envy-anchor');
    anchor.style.left = '92%';
    anchor.style.top = '6%';
    h.appendChild(anchor);
    const core = h.querySelector<HTMLElement>('.gen3-envy-core');
    api.reflow(anchor);
    anchor.classList.add('suck'); // 飞入涡心 + 缩小旋转 + 被吸入淡出（CSS transition）
    api.timer(defId, () => {
      if (!layer.isConnected) { done(); return; }
      core?.classList.add('flash');
      burstParticles(h, 'gen3-envy-spark', 14, api, 30, 620, defId);
      api.timer(defId, () => {
        core?.classList.remove('flash');
        anchor.remove();
        h.querySelector('.gen3-envy-spark-wrap')?.remove();
        done();
      }, 680);
    }, 900);
  };
  api.scheduleLoop(layer, defId, api.rnd(3200, 6800), burst);
}

/* ============================ 2. 暴食 gluttony ============================ */
/** 上/下两排暗金齿颚（缓慢开合）+ 8 粒上下起伏的碎屑；
 *  周期：齿颚猛然咬合（白齿痕闪）+ 碎屑被"吸"向中心收拢后复位。 */
function appendGluttony(layer: HTMLElement, defId: string, api: Gen3FxApi): void {
  api.corners(layer, 'compiled-gluttony-corner');
  const h = host(layer, 'gen3-glut-host', api);
  for (const [row, cls] of [['top', 'gen3-glut-jaw top'], ['bottom', 'gen3-glut-jaw bottom']] as const) {
    const jaw = api.el('div', cls);
    for (let i = 0; i < 5; i++) {
      const t = api.el('i', `gen3-glut-tooth ${row === 'top' ? 'down' : 'up'}`);
      t.style.left = `${6 + i * 18.5}%`;
      t.style.width = `${13 + ((i * 7) % 6)}%`;
      t.style.animationDelay = `${-api.rnd(0, 3).toFixed(2)}s`;
      jaw.appendChild(t);
    }
    h.appendChild(jaw);
  }
  const crumbs = api.el('div', 'gen3-glut-crumbs');
  scatter(crumbs, 'gen3-glut-crumb', 8, api,
    (i) => ({ x: 14 + ((i * 23) % 70), y: 32 + ((i * 31) % 46) }),
    (i) => 3 + (i % 3));
  h.appendChild(crumbs);

  const burst = (done: () => void): void => {
    if (!layer.isConnected) { done(); return; }
    h.classList.remove('bite');
    api.reflow(h);
    h.classList.add('bite');
    for (const c of Array.from(crumbs.querySelectorAll<HTMLElement>('.gen3-glut-crumb'))) c.classList.add('pull');
    api.timer(defId, () => {
      if (!layer.isConnected) { done(); return; }
      for (const c of Array.from(crumbs.querySelectorAll<HTMLElement>('.gen3-glut-crumb'))) c.classList.remove('pull');
      h.classList.remove('bite');
      done();
    }, 1150);
  };
  api.scheduleLoop(layer, defId, api.rnd(3600, 7200), burst);
}

/* ============================ 3. 贪婪 greed ============================ */
/**
 * 青玉底盘脉动 + **中心「取物口」+ 5 条青玉触手环抱中心**（吸盘沿线，错相蠕动）；
 *  周期：触手收拢攫取（.clench，中心暗口亮起）→ 攫取后猛张（.lash，品红环闪）
 *        + 9 枚品红碎粒 + **硬币自卡牌边框呈抛物线喷发**（4~9 枚）。
 *
 * 2026-09-13 用户反馈：「硬币堆看起来一点都不像硬币」→ 常驻主体由"品红硬币柱"改为
 * **环绕中心的触手**（贪婪的"攫取"语义；硬币只在周期爆发里作为"喷出的财货"出现，
 * 并补了币缘/币面细节，见 .gen3-greed-shower-coin）。
 */
function appendGreed(layer: HTMLElement, defId: string, api: Gen3FxApi): void {
  api.corners(layer, 'compiled-greed-corner');
  const h = host(layer, 'gen3-greed-host', api);
  h.appendChild(api.el('div', 'gen3-greed-base'));
  // 中心「取物口」：触手环抱的暗口 + 玉青外环 + 品红虚线内环（缓慢逆向转）
  const maw = api.el('div', 'gen3-greed-maw');
  maw.appendChild(api.el('i', 'gen3-greed-maw-core'));
  maw.appendChild(api.el('i', 'gen3-greed-maw-ring outer'));
  maw.appendChild(api.el('i', 'gen3-greed-maw-ring inner'));
  h.appendChild(maw);
  // 8 条触手：**四条边都有**（上下左右边中 + 四个角），根部贴卡边、尖端指向中心，各自错相蠕动；
  // 吸盘沿体侧排布（品红）。2026-09-13 用户反馈"只有一条边上有触手"→ 由 5 条（锚点全在下方）
  // 改为 8 条对称分布，每条自带 --ax/--ay（卡面坐标锚点）、--r（朝心朝向）、--h/--w（体长宽）。
  const arms = api.el('div', 'gen3-greed-arms');
  for (let i = 0; i < 8; i++) {
    const arm = api.el('div', `gen3-greed-tentacle t${i}`);
    arm.appendChild(api.el('i', 'gen3-greed-tentacle-body'));
    for (let k = 0; k < 3; k++) arm.appendChild(api.el('i', `gen3-greed-sucker s${k}`));
    arm.style.animationDelay = `${(-(i * 0.61)).toFixed(2)}s`;
    arms.appendChild(arm);
  }
  h.appendChild(arms);

  const burst = (done: () => void): void => {
    if (!layer.isConnected) { done(); return; }
    h.classList.remove('clench', 'lash');
    api.reflow(h);
    h.classList.add('clench');
    api.timer(defId, () => {
      if (!layer.isConnected) { done(); return; }
      h.classList.remove('clench');
      h.classList.add('lash');
      burstParticles(h, 'gen3-greed-bit', 9, api, 34, 700, defId);
      greedCoinShower(layer, h, api, defId);
      api.timer(defId, () => {
        if (!layer.isConnected) { done(); return; }
        h.classList.remove('lash');
        h.querySelector('.gen3-greed-bit-wrap')?.remove();
        done();
      }, 760);
    }, 900);
  };
  api.scheduleLoop(layer, defId, api.rnd(4200, 8400), burst);
}

/** #4：硬币自边框抛物线喷发（起点贴四边 → 顶点 → 落点；--dx/--peak/--fall 由卡面尺寸算出） */
function greedCoinShower(layer: HTMLElement, h: HTMLElement, api: Gen3FxApi, defId: string): void {
  const g = api.layerGeom(layer);
  const w = g?.w ?? 120;
  const hh = g?.h ?? 170;
  const wrap = api.el('div', 'gen3-greed-shower-wrap');
  const n = 4 + Math.round(api.rnd(0, 5)); // 4~9 枚（"偶尔"多喷几枚）
  for (let i = 0; i < n; i++) {
    const coin = api.el('i', 'gen3-greed-shower-coin');
    const edge = Math.floor(api.rnd(0, 4)) % 4;
    const t = api.rnd(0.12, 0.88);
    if (edge === 0) { coin.style.left = `${(t * 100).toFixed(1)}%`; coin.style.top = '0%'; }
    else if (edge === 1) { coin.style.left = '100%'; coin.style.top = `${(t * 100).toFixed(1)}%`; }
    else if (edge === 2) { coin.style.left = `${(t * 100).toFixed(1)}%`; coin.style.top = '100%'; }
    else { coin.style.left = '0%'; coin.style.top = `${(t * 100).toFixed(1)}%`; }
    coin.style.setProperty('--dx', `${(api.rnd(-0.3, 0.3) * w).toFixed(1)}px`);
    coin.style.setProperty('--peak', `${(api.rnd(0.18, 0.44) * hh).toFixed(1)}px`);
    coin.style.setProperty('--fall', `${(api.rnd(0.34, 0.78) * hh).toFixed(1)}px`);
    coin.style.setProperty('--rot', `${api.rnd(-320, 320).toFixed(0)}deg`);
    coin.style.animationDelay = `${(i * 0.07).toFixed(2)}s`;
    wrap.appendChild(coin);
  }
  h.appendChild(wrap);
  api.timer(defId, () => wrap.remove(), 1600);
}

/* ============================ 4. 色欲 lust ============================ */
/**
 * 两条血红牵引链沿卡外环带环绕（3 节/条，缓慢收紧感）+ 心形手爪徽标脉动；
 *  周期：链条猛收（.tighten）+ 暗紫余温波纹。
 *
 * 用户清单 #7（2026-09-13）：**爱心太少**（旧版只有徽标里 1 颗）→ 徽标周围补 2 颗小爱心环绕，
 * 周期爆发时再喷 5 颗飞行爱心（上升 + 摇摆 + 渐隐）。
 */
function appendLust(layer: HTMLElement, defId: string, api: Gen3FxApi): void {
  api.corners(layer, 'compiled-lust-corner');
  const h = host(layer, 'gen3-lust-host', api);
  for (const which of ['a', 'b'] as const) {
    const chain = api.el('div', `gen3-lust-chain ${which}`);
    orbitRing(chain, 'gen3-lust-link', 3, api, which === 'a' ? 9 : 13);
    h.appendChild(chain);
  }
  const crest = api.el('div', 'gen3-lust-crest');
  crest.appendChild(api.el('i', 'gen3-lust-heart'));
  for (let i = 0; i < 3; i++) crest.appendChild(api.el('i', `gen3-lust-claw c${i}`));
  h.appendChild(crest);
  // #7：徽标两侧的小爱心（环绕漂浮，静止状态也能看出"色欲"）
  const swarm = api.el('div', 'gen3-lust-hearts');
  for (let i = 0; i < 4; i++) {
    const heart = api.el('i', `gen3-lust-heart-orb h${i}`);
    heart.style.animationDelay = `${(-i * 0.9).toFixed(2)}s`;
    swarm.appendChild(heart);
  }
  h.appendChild(swarm);

  const burst = (done: () => void): void => {
    if (!layer.isConnected) { done(); return; }
    h.classList.remove('tighten');
    api.reflow(h);
    h.classList.add('tighten');
    const wave = shockRing(h, 'gen3-lust-wave', api);
    // #7：喷出飞行爱心（--dx/--dy 决定外散方向，上升 → 摇摆 → 渐隐）
    const fly = api.el('div', 'gen3-lust-heartfly-wrap');
    for (let i = 0; i < 5; i++) {
      const f = api.el('i', 'gen3-lust-heartfly');
      f.style.left = `${(30 + i * 9).toFixed(0)}%`;
      f.style.top = `${(48 + (i % 2) * 8).toFixed(0)}%`;
      f.style.setProperty('--dx', `${api.rnd(-30, 30).toFixed(1)}px`);
      f.style.setProperty('--dy', `${api.rnd(-70, -34).toFixed(1)}px`);
      f.style.animationDelay = `${(i * 0.09).toFixed(2)}s`;
      fly.appendChild(f);
    }
    h.appendChild(fly);
    api.timer(defId, () => {
      wave.remove();
      fly.remove();
      h.classList.remove('tighten');
      done();
    }, 860);
  };
  api.scheduleLoop(layer, defId, api.rnd(3400, 7000), burst);
}

/* ============================ 5. 傲慢 pride ============================ */
/** 3 道金色上升光柱（扫光）+ 3 级几何塔（依次点亮）；
 *  周期：金冠自上方落下 → 冲击环 + 金色粒子 → 冠体收束消散。 */
function appendPride(layer: HTMLElement, defId: string, api: Gen3FxApi): void {
  api.corners(layer, 'compiled-pride-corner');
  const h = host(layer, 'gen3-pride-host', api);
  const beams = api.el('div', 'gen3-pride-beams');
  for (let i = 0; i < 3; i++) {
    const beam = api.el('i', 'gen3-pride-pillar');
    beam.style.left = `${22 + i * 27}%`;
    beam.style.animationDelay = `${(-i * 0.9).toFixed(2)}s`;
    beams.appendChild(beam);
  }
  h.appendChild(beams);
  const tower = api.el('div', 'gen3-pride-tower');
  for (let i = 0; i < 3; i++) {
    const tier = api.el('i', `gen3-pride-tier t${i}`);
    tier.style.width = `${56 - i * 13}%`;
    tower.appendChild(tier);
  }
  h.appendChild(tower);

  const burst = (done: () => void): void => {
    if (!layer.isConnected) { done(); return; }
    const crown = api.el('div', 'gen3-pride-crown');
    for (let i = 0; i < 3; i++) crown.appendChild(api.el('i', 'gen3-pride-spike'));
    crown.appendChild(api.el('i', 'gen3-pride-band'));
    h.appendChild(crown);
    api.reflow(crown);
    crown.classList.add('in');
    api.timer(defId, () => {
      if (!layer.isConnected) { done(); return; }
      shockRing(h, 'gen3-pride-shock', api);
      burstParticles(h, 'gen3-pride-spark', 12, api, 26, 620, defId);
      crown.classList.add('out');
      api.timer(defId, () => {
        crown.remove();
        h.querySelector('.gen3-pride-shock')?.remove();
        h.querySelector('.gen3-pride-spark-wrap')?.remove();
        done();
      }, 840);
    }, 1500);
  };
  api.scheduleLoop(layer, defId, api.rnd(3800, 7600), burst);
}

/* ============================ 6. 怠惰 sloth ============================ */
/**
 * 4 圈极慢同心涟漪 + 底部灰红泥浆（起伏）+ 3 点余烬；
 *  周期：大涟漪（.surge）+ 泥浆整体上涌 + 余烬聚起再沉落 + 一圈沉浊冲击环。
 *
 * 用户清单 #6（2026-09-13）：**怠惰已编译特效太弱**（旧版 surge 只改了一个 CSS 类，肉眼几乎无变化）
 * → 补：4 圈涟漪（原 3）、爆发时 5 团上涌泥浆 + 6 点余烬 + 沉浊环 + 整卡暗化脉动。
 */
function appendSloth(layer: HTMLElement, defId: string, api: Gen3FxApi): void {
  api.corners(layer, 'compiled-sloth-corner');
  const h = host(layer, 'gen3-sloth-host', api);
  const ripples = api.el('div', 'gen3-sloth-ripples');
  for (let i = 0; i < 4; i++) {
    const r = api.el('i', 'gen3-sloth-ripple');
    r.style.animationDelay = `${(-i * 1.2).toFixed(2)}s`;
    ripples.appendChild(r);
  }
  h.appendChild(ripples);
  const sludge = api.el('div', 'gen3-sloth-sludge');
  for (let i = 0; i < 4; i++) {
    const b = api.el('i', 'gen3-sloth-blob');
    b.style.left = `${3 + i * 24 + api.rnd(-3, 3)}%`;
    b.style.width = `${26 + (i % 3) * 9}%`;
    b.style.animationDelay = `${-api.rnd(0, 3).toFixed(2)}s`;
    sludge.appendChild(b);
  }
  h.appendChild(sludge);
  const embers = api.el('div', 'gen3-sloth-embers');
  scatter(embers, 'gen3-sloth-ember', 3, api,
    (i) => ({ x: 20 + ((i * 27) % 58), y: 28 + ((i * 19) % 38) }),
    () => 4);
  h.appendChild(embers);

  const burst = (done: () => void): void => {
    if (!layer.isConnected) { done(); return; }
    h.classList.remove('surge');
    api.reflow(h);
    h.classList.add('surge');
    // #6：上涌泥浆团（自底部抬起 → 摊平回落）+ 沉浊扩散环
    const rise = api.el('div', 'gen3-sloth-surge-wrap');
    for (let i = 0; i < 5; i++) {
      const b = api.el('i', 'gen3-sloth-surge-blob');
      b.style.left = `${6 + i * 18 + api.rnd(-3, 3)}%`;
      b.style.width = `${20 + (i % 3) * 8}%`;
      b.style.animationDelay = `${(i * 0.11).toFixed(2)}s`;
      rise.appendChild(b);
    }
    for (let i = 0; i < 6; i++) {
      const e = api.el('i', 'gen3-sloth-surge-ember');
      e.style.left = `${14 + i * 12}%`;
      e.style.top = `${58 - (i % 3) * 9}%`;
      e.style.animationDelay = `${(0.1 + i * 0.06).toFixed(2)}s`;
      rise.appendChild(e);
    }
    h.appendChild(rise);
    shockRing(h, 'gen3-sloth-wave', api);
    api.timer(defId, () => {
      rise.remove();
      h.querySelector('.gen3-sloth-wave')?.remove();
      h.classList.remove('surge');
      done();
    }, 1600);
  };
  api.scheduleLoop(layer, defId, api.rnd(3600, 7200), burst);
}

/* ============================ 7. 暴怒 wrath ============================ */
/**
 * 猩红爆刺（**四条边**都长，3 根/边 = 12 根，缓慢伸缩）+ 3 片青蓝冷残片（漂浮）；
 *  周期：3 道锯齿闪电自上而下错开劈下（3 帧闪）+ 猩红火星。
 *
 * 用户清单 #13（2026-09-13）：旧版只有下缘 5 根刺、闪电只有 1 道 → 现在四边各 3 根、闪电 3 道。
 */
function appendWrath(layer: HTMLElement, defId: string, api: Gen3FxApi): void {
  api.corners(layer, 'compiled-wrath-corner');
  const h = host(layer, 'gen3-wrath-host', api);
  const spikes = api.el('div', 'gen3-wrath-spikes');
  for (const edge of ['bottom', 'top', 'left', 'right'] as const) {
    for (let i = 0; i < 3; i++) {
      const s = api.el('i', `gen3-wrath-spike e-${edge}`);
      const f = 18 + i * 32; // 沿该边的位置（%）
      if (edge === 'bottom' || edge === 'top') s.style.left = `${f}%`;
      else s.style.top = `${f}%`;
      s.style.animationDelay = `${-api.rnd(0, 4).toFixed(2)}s`;
      spikes.appendChild(s);
    }
  }
  h.appendChild(spikes);
  const shards = api.el('div', 'gen3-wrath-shards');
  scatter(shards, 'gen3-wrath-shard', 3, api,
    (i) => ({ x: 18 + ((i * 33) % 62), y: 22 + ((i * 27) % 50) }),
    (i) => 6 + (i % 3) * 2);
  h.appendChild(shards);

  const burst = (done: () => void): void => {
    if (!layer.isConnected) { done(); return; }
    const bolts = api.el('div', 'gen3-wrath-bolts');
    for (let i = 0; i < 3; i++) {
      const bolt = api.el('div', 'gen3-wrath-bolt');
      bolt.style.left = `${api.rnd(24, 76).toFixed(0)}%`;
      bolt.style.animationDelay = `${(i * 70).toFixed(0)}ms`;
      bolts.appendChild(bolt);
      api.reflow(bolt);
      bolt.classList.add('on');
    }
    h.appendChild(bolts);
    burstParticles(h, 'gen3-wrath-spark', 16, api, 34, 560, defId);
    api.timer(defId, () => {
      bolts.remove();
      h.querySelector('.gen3-wrath-spark-wrap')?.remove();
      done();
    }, 560);
  };
  api.scheduleLoop(layer, defId, api.rnd(3000, 6400), burst);
}

/* ============================ 8. 伏击 ambush ============================ */
/** 冷蓝 9 宫格（1 格常亮，周期换格）+ 4 片阴影碎片；
 *  周期：扫描线自下而上扫过 + 换一个高亮格。 */
function appendAmbush(layer: HTMLElement, defId: string, api: Gen3FxApi): void {
  api.corners(layer, 'compiled-ambush-corner');
  const h = host(layer, 'gen3-amb-host', api);
  const grid = api.el('div', 'gen3-amb-grid');
  const cells: HTMLElement[] = [];
  for (let i = 0; i < 9; i++) {
    const c = api.el('i', 'gen3-amb-cell');
    cells.push(c);
    grid.appendChild(c);
  }
  h.appendChild(grid);
  const shards = api.el('div', 'gen3-amb-shards');
  scatter(shards, 'gen3-amb-shard', 4, api,
    (i) => ({ x: 16 + ((i * 29) % 66), y: 20 + ((i * 37) % 56) }),
    (i) => 5 + (i % 3) * 3);
  h.appendChild(shards);
  let lit = 4;
  cells[lit].classList.add('on');
  let step = 0;

  const burst = (done: () => void): void => {
    if (!layer.isConnected) { done(); return; }
    cells[lit]?.classList.remove('on');
    lit = (lit + 3 + (step % 5)) % 9;
    step += 1;
    cells[lit]?.classList.add('on');
    const scan = api.el('div', 'gen3-amb-scan');
    h.appendChild(scan);
    api.reflow(scan);
    scan.classList.add('on');
    api.timer(defId, () => {
      scan.remove();
      done();
    }, 780);
  };
  api.scheduleLoop(layer, defId, api.rnd(4000, 8200), burst);
}

/* ============================ 9. 支点 fulcrum ============================ */
/** 青蓝刻度环（缓慢旋转的虚线环）+ 杠杆（支点 + 两端砝码，±6° 摆动）；
 *  周期：杠杆大幅摆动一次（.swing）+ 刻度环亮一圈。 */
function appendFulcrum(layer: HTMLElement, defId: string, api: Gen3FxApi): void {
  api.corners(layer, 'compiled-fulcrum-corner');
  const h = host(layer, 'gen3-ful-host', api);
  h.appendChild(api.el('div', 'gen3-ful-dial'));
  const lever = api.el('div', 'gen3-ful-lever');
  lever.appendChild(api.el('i', 'gen3-ful-pivot'));
  lever.appendChild(api.el('i', 'gen3-ful-weight l'));
  lever.appendChild(api.el('i', 'gen3-ful-weight r'));
  h.appendChild(lever);

  const burst = (done: () => void): void => {
    if (!layer.isConnected) { done(); return; }
    h.classList.remove('swing');
    api.reflow(h);
    h.classList.add('swing');
    api.timer(defId, () => {
      h.classList.remove('swing');
      done();
    }, 1250);
  };
  api.scheduleLoop(layer, defId, api.rnd(3600, 7400), burst);
}

/* ============================ 10. 压制 overwhelm ============================ */
/** 4×4 深青蓝阵列（错相明灭）+ 上/下桁架线；
 *  周期：整阵下压（.press，含挤压形变）+ 压痕环 + 冷白尘埃。 */
function appendOverwhelm(layer: HTMLElement, defId: string, api: Gen3FxApi): void {
  api.corners(layer, 'compiled-overwhelm-corner');
  const h = host(layer, 'gen3-ovw-host', api);
  const array = api.el('div', 'gen3-ovw-array');
  for (let i = 0; i < 16; i++) {
    const c = api.el('i', 'gen3-ovw-cell');
    c.style.animationDelay = `${(-((i % 4) + Math.floor(i / 4)) * 0.22).toFixed(2)}s`;
    array.appendChild(c);
  }
  h.appendChild(array);
  h.appendChild(api.el('div', 'gen3-ovw-truss top'));
  h.appendChild(api.el('div', 'gen3-ovw-truss bottom'));

  const burst = (done: () => void): void => {
    if (!layer.isConnected) { done(); return; }
    h.classList.remove('press');
    api.reflow(h);
    h.classList.add('press');
    shockRing(h, 'gen3-ovw-shock', api);
    burstParticles(h, 'gen3-ovw-dust', 8, api, 40, 640, defId);
    api.timer(defId, () => {
      h.classList.remove('press');
      h.querySelector('.gen3-ovw-shock')?.remove();
      h.querySelector('.gen3-ovw-dust-wrap')?.remove();
      done();
    }, 940);
  };
  api.scheduleLoop(layer, defId, api.rnd(3400, 7000), burst);
}

/* ============================ 11. 动量 momentum ============================ */
/** 2 条橙色弧轨（反向旋转）+ 3 道横向速度残影；
 *  周期：蓄力环 2 圈向内收束（.in→.out）+ 加速条纹 + 冲击环。 */
function appendMomentum(layer: HTMLElement, defId: string, api: Gen3FxApi): void {
  api.corners(layer, 'compiled-momentum-corner');
  const h = host(layer, 'gen3-mom-host', api);
  h.appendChild(api.el('div', 'gen3-mom-track a'));
  h.appendChild(api.el('div', 'gen3-mom-track b'));
  const streaks = api.el('div', 'gen3-mom-streaks');
  for (let i = 0; i < 3; i++) {
    const s = api.el('i', 'gen3-mom-streak');
    s.style.top = `${28 + i * 21}%`;
    s.style.animationDelay = `${(-i * 0.55).toFixed(2)}s`;
    streaks.appendChild(s);
  }
  h.appendChild(streaks);

  const burst = (done: () => void): void => {
    if (!layer.isConnected) { done(); return; }
    const charge = api.el('div', 'gen3-mom-charge');
    charge.appendChild(api.el('i', 'gen3-mom-charge-ring r1'));
    charge.appendChild(api.el('i', 'gen3-mom-charge-ring r2'));
    h.appendChild(charge);
    api.reflow(charge);
    charge.classList.add('in');
    api.timer(defId, () => {
      if (!layer.isConnected) { done(); return; }
      charge.classList.add('out');
      shockRing(h, 'gen3-mom-shock', api);
      api.timer(defId, () => {
        charge.remove();
        h.querySelector('.gen3-mom-shock')?.remove();
        done();
      }, 560);
    }, 640);
  };
  api.scheduleLoop(layer, defId, api.rnd(3200, 6800), burst);
}

/* ============================ 12. 新星 nova ============================ */
/** 旋转四角星芒 + 8 道橙金尖刺（径向）+ 3 块漂浮碎块；
 *  周期：全卡白闪（.flare）+ 尖刺外刺 + 星芒迸发粒子。 */
function appendNova(layer: HTMLElement, defId: string, api: Gen3FxApi): void {
  api.corners(layer, 'compiled-nova-corner');
  const h = host(layer, 'gen3-nova-host', api);
  h.appendChild(api.el('div', 'gen3-nova-star'));
  const rays = api.el('div', 'gen3-nova-rays');
  for (let i = 0; i < 8; i++) {
    const r = api.el('i', 'gen3-nova-ray');
    r.style.transform = `rotate(${i * 45}deg)`;
    r.style.animationDelay = `${(-i * 0.28).toFixed(2)}s`;
    rays.appendChild(r);
  }
  h.appendChild(rays);
  const chunks = api.el('div', 'gen3-nova-chunks');
  scatter(chunks, 'gen3-nova-chunk', 3, api,
    (i) => ({ x: 22 + ((i * 31) % 54), y: 26 + ((i * 21) % 46) }),
    (i) => 7 + (i % 3) * 3);
  h.appendChild(chunks);

  const burst = (done: () => void): void => {
    if (!layer.isConnected) { done(); return; }
    h.classList.remove('flare');
    api.reflow(h);
    h.classList.add('flare');
    burstParticles(h, 'gen3-nova-spark', 16, api, 40, 680, defId);
    api.timer(defId, () => {
      h.classList.remove('flare');
      h.querySelector('.gen3-nova-spark-wrap')?.remove();
      done();
    }, 940);
  };
  api.scheduleLoop(layer, defId, api.rnd(4000, 8000), burst);
}

/* ============================ 13. 惰性 inertia ============================ */
/** 灰化覆盖 + 停转齿轮（缓转后骤停）+ 5 粒几乎不动的尘埃；
 *  周期：齿轮启动→骤停（.stall）+ 尘埃沉降 + 极弱灰环。 */
function appendInertia(layer: HTMLElement, defId: string, api: Gen3FxApi): void {
  api.corners(layer, 'compiled-inertia-corner');
  const h = host(layer, 'gen3-ine-host', api);
  h.appendChild(api.el('div', 'gen3-ine-dull'));
  const gear = api.el('div', 'gen3-ine-gear');
  gear.appendChild(api.el('i', 'gen3-ine-gear-hub'));
  h.appendChild(gear);
  const dust = api.el('div', 'gen3-ine-dust');
  scatter(dust, 'gen3-ine-speck', 5, api,
    (i) => ({ x: 16 + ((i * 26) % 66), y: 22 + ((i * 34) % 54) }),
    (i) => 2 + (i % 2));
  h.appendChild(dust);

  const burst = (done: () => void): void => {
    if (!layer.isConnected) { done(); return; }
    gear.classList.remove('stall');
    api.reflow(gear);
    gear.classList.add('stall');
    api.timer(defId, () => {
      gear.classList.remove('stall');
      done();
    }, 2700);
  };
  api.scheduleLoop(layer, defId, api.rnd(4600, 9200), burst);
}

/* ============================ 14. 僵化 rigidity ============================ */
/** 荧光黄迷宫走线（SVG 虚线沿径流动）+ 四角锚钉 + 紫护壁；
 *  周期：迷宫纹亮起（.lock）+ 荧光黄扫线自上而下 + 锚钉震动。 */
function appendRigidity(layer: HTMLElement, defId: string, api: Gen3FxApi): void {
  api.corners(layer, 'compiled-rigidity-corner');
  const h = host(layer, 'gen3-rig-host', api);
  h.appendChild(api.el('div', 'gen3-rig-wall'));
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 100 100');
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('class', 'gen3-rig-maze');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', 'M6,14 H36 V30 H18 V46 H44 V22 H62 V40 H48 V60 H72 V34 H88 M10,86 H30 V68 H52 V84 H74 V64 H92');
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', '#eaff3a');
  path.setAttribute('stroke-width', '1.1');
  path.setAttribute('stroke-linejoin', 'miter');
  path.setAttribute('vector-effect', 'non-scaling-stroke');
  svg.appendChild(path);
  h.appendChild(svg);
  for (const pos of ['tl', 'tr', 'bl', 'br'] as const) h.appendChild(api.el('i', `gen3-rig-anchor ${pos}`));

  const burst = (done: () => void): void => {
    if (!layer.isConnected) { done(); return; }
    h.classList.remove('lock');
    api.reflow(h);
    h.classList.add('lock');
    const sweep = api.el('div', 'gen3-rig-sweep');
    h.appendChild(sweep);
    api.reflow(sweep);
    sweep.classList.add('on');
    api.timer(defId, () => {
      sweep.remove();
      h.classList.remove('lock');
      done();
    }, 880);
  };
  api.scheduleLoop(layer, defId, api.rnd(3800, 7600), burst);
}

/* ============================ 15. 灵活 flexibility ============================ */
/** 2 条紫罗兰飘带（反向绕卡、带模糊柔化）+ 3 片深蓝层叠薄板（缓慢错位）；
 *  周期：飘带解开飞散（.loose）+ 6 片彩色薄片四散。 */
function appendFlexibility(layer: HTMLElement, defId: string, api: Gen3FxApi): void {
  api.corners(layer, 'compiled-flexibility-corner');
  const h = host(layer, 'gen3-flx-host', api);
  for (const which of ['a', 'b'] as const) {
    const ribbon = api.el('div', `gen3-flx-ribbon ${which}`);
    ribbon.style.animationDelay = `${which === 'a' ? 0 : -1.6}s`;
    h.appendChild(ribbon);
  }
  const plates = api.el('div', 'gen3-flx-plates');
  for (let i = 0; i < 3; i++) {
    const p = api.el('i', 'gen3-flx-plate');
    p.style.left = `${14 + i * 25}%`;
    p.style.animationDelay = `${(-i * 0.6).toFixed(2)}s`;
    plates.appendChild(p);
  }
  h.appendChild(plates);

  const burst = (done: () => void): void => {
    if (!layer.isConnected) { done(); return; }
    h.classList.remove('loose');
    api.reflow(h);
    h.classList.add('loose');
    const shards = api.el('div', 'gen3-flx-shards');
    for (let i = 0; i < 6; i++) {
      const s = api.el('i', 'gen3-flx-shard');
      s.style.setProperty('--dx', `${api.rnd(-46, 46).toFixed(1)}px`);
      s.style.setProperty('--dy', `${api.rnd(-54, 30).toFixed(1)}px`);
      s.style.animationDelay = `${(i * 0.05).toFixed(2)}s`;
      shards.appendChild(s);
    }
    h.appendChild(shards);
    api.timer(defId, () => {
      shards.remove();
      h.classList.remove('loose');
      done();
    }, 940);
  };
  api.scheduleLoop(layer, defId, api.rnd(4000, 8000), burst);
}
