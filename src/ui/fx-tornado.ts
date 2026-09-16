/**
 * 粒子龙卷风构建器（2026-09-03 用户重做：旧 4 层旋转椭圆带 + 中心气柱像「棍子 + 平面
 * 图形」；改为 粒子向中心旋转汇聚、向上涌动，模拟龙卷风漩涡）。
 *
 * 结构（每粒子 3 层 DOM，保证漏斗竖直居中——环形轨道圆心在各高度的中轴线上，而非绕
 * 容器中心偏心进动）：
 * - .fx-speed-tornado 容器：定位于卡中心（尺寸/呼吸见 styles.css）；
 * - 每个粒子 = .fx-tornado-orbit（absolute left:50% + 内联 top:y% → 轴心在该高度的
 *   竖直中轴线上；自身 CSS 动画绕轴自转 1.9s/圈，负 delay 错相 → 各环不同步的漩涡感）
 *   → .fx-tornado-arm（translateX(r) 定半径；r 按高度锥形：顶部=云帽半径最大、向下收窄
 *   成触地细尖）→ .fx-tornado-flow（光点，局部系「向轴(-in) + 母线向上(-up)」涌动 +
 *   明暗闪烁，负 delay 错相 → 整柱读作粒子流螺旋汇聚上升）。
 * 参数集中在本文件顶部常量，微调即可。
 */

/** 龙卷风视觉盒尺寸（px；styles.css .fx-speed-tornado 同步）
 *
 * ⚠️ **G2 修正 R15-A**：这两个数是**热座卡**（130 × 178.8）的 90.8% / 95.1% ——
 * 也就是说这个特效的尺寸本来就是**相对卡**定义的（118 / 130 = 0.908、
 * 170 / 178.8 = 0.951），不是一个独立的绝对尺寸。远程页的卡小到 100.572 × 137.601
 * （场上卡 100.572 × 140）⇒ 再用 118 × 170 就变成卡宽的 117% / 卡高的 121%
 * （**溢出卡外、压到相邻列**）。所以 `buildTornadoFx` 收一个 `scale`：
 * 按"真卡的 `--card-h` ÷ 热座卡的 175"整体缩放，盒尺寸 / SVG viewBox / 半径一起缩
 * ⇒ 与卡的**比例**在两种页面里一致。`scale = 1` 时逐字等于改动前（热座构造性不变）。 */
export const TORNADO_W = 118;
export const TORNADO_H = 170;

/** 热座场上卡的 `--card-h`（`styles.css:422`）—— `scale` 的基准分母。
 *  用**场上卡**而不是热座手牌卡的 178.8：本特效的两个消费点里，
 *  偏转场景落在**场上链路**（`playSpeedShiftExtra` 的终点 = `stackEndPos`），
 *  抽牌场景是"牌库 → 手牌"的**飞行物**（起点/终点都是一张**卡大小的东西**）。
 *  以场上卡的 175 为基准时，热座两个场景都是 `175/175 = 1` ⇒ 逐字不变；
 *  远程页两个场景都按 140/175 = 0.8 缩。 */
export const TORNADO_BASE_CARD_H = 175;

/** 粒子数：锥面包络采样密度（观感与性能平衡点） */
const TORNADO_PARTICLES = 30;

/** 粒子光点尺寸（直径 px 上下限，随机） */
const DOT_MIN = 3;
const DOT_MAX = 6;

/** 轨道自转周期（s，与 styles.css .fx-tornado-orbit 动画一致） */
const ORBIT_S = 1.9;

/** 弹簧线条数（环绕漏斗的螺旋细线，相位均布） */
const SPRING_LINES = 3;

/** 螺旋圈数（顶到底） */
const SPRING_TURNS = 4;

/** 生成一条弹簧线：递减振幅波形（= 锥形螺旋的 2D 正投影；振幅 r(y) 与粒子包络一致，
 *  顶部「划的圆」最大、向下逐圈收小 → 弹簧式线圈越往下越小；3 条相位 120° 均布像
 *  缠绕在漏斗上的弹簧。线身细 stroke，发光弱化（读作线条而非平面），静态跟随粒子
 *  容器整体缩放/平移；呼吸明暗由 CSS .fx-spring-line 提供（负 delay 错相）。 */
function buildSpringLine(phaseRad: number, scale: number): SVGSVGElement {
  const W = TORNADO_W * scale;
  const H = TORNADO_H * scale;
  const cx = W / 2;
  const rTop = W / 2 - 8; // 顶部（云帽）半径，与粒子 rMax 一致
  const steps = 64;
  const pts: string[] = [];
  for (let i = 0; i <= steps; i++) {
    const y01 = i / steps;
    const y = y01 * H;
    const r = rTop * (0.1 + 0.9 * Math.pow(1 - y01, 1.25)); // 向下递减的线圈半径
    const th = phaseRad + y01 * SPRING_TURNS * Math.PI * 2;
    pts.push(`${(cx + r * Math.cos(th)).toFixed(1)},${y.toFixed(1)}`);
  }
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'fx-spring-line');
  svg.setAttribute('width', String(W));
  svg.setAttribute('height', String(H));
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
  poly.setAttribute('points', pts.join(' '));
  svg.appendChild(poly);
  return svg;
}

/** 构造一个粒子龙卷风容器（含弹簧线条 + 全部粒子轨道），绝对定位于调用方坐标系中心。
 *
 * `scale`（G2 修正 R15-A）：整体缩放系数，缺省 `1` = **热座**（逐字等于改动前）。
 * 调用方按"真卡的 `--card-h` ÷ `TORNADO_BASE_CARD_H`"传（远程页 = 140 / 175 = 0.8）。
 * 缩的不只是盒尺寸：SVG 的 `viewBox` / `width` / `height`、云帽半径 `rMax` 一起缩 ⇒
 * 粒子包络与弹簧线**同比例**，不会出现"盒缩了而粒子还按 118 的半径铺"的错位。 */
export function buildTornadoFx(scale = 1): HTMLElement {
  const W = TORNADO_W * scale;
  const H = TORNADO_H * scale;
  const tornado = document.createElement('div');
  tornado.className = 'fx-speed-tornado';
  // G2 修正 R15-A：内联宽高**必须**写 —— `styles.css:3029-3030` 的 `.fx-speed-tornado`
  // 写死 `118px / 170px`（热座值），而本元素在**两个**消费点里都在 body 级浮层内
  // （不在 `.net-board` 里）⇒ styles-net.css 命不中它，只能内联覆盖。
  // `scale === 1` 时这两个内联值与 CSS 逐字相同 ⇒ 热座视觉零变化。
  tornado.style.width = `${W}px`;
  tornado.style.height = `${H}px`;
  // 弹簧线条先挂（粒子在上层）；3 条相位均布 + 负 delay 呼吸错相
  for (let i = 0; i < SPRING_LINES; i++) {
    const line = buildSpringLine((Math.PI * 2 * i) / SPRING_LINES, scale);
    line.style.animationDelay = `${-(i * 1.25).toFixed(2)}s`;
    tornado.appendChild(line);
  }
  const rMax = W / 2 - 8 * scale; // 顶部（云帽）最大半径（8px 的边距也跟着缩）
  for (let i = 0; i < TORNADO_PARTICLES; i++) {
    const y01 = Math.min(0.97, Math.max(0.03, (i + 0.5) / TORNADO_PARTICLES + (Math.random() - 0.5) * 0.02));
    // 倒锥漏斗母线：顶部 (y≈0) 半径 ≈ rMax，向下 (y→1) 收窄到 ≈0.14·rMax（触地细尖）
    const r = rMax * (0.14 + 0.86 * Math.pow(1 - y01, 1.25));
    const orbit = document.createElement('div');
    orbit.className = 'fx-tornado-orbit';
    orbit.style.top = `${(y01 * 100).toFixed(1)}%`;
    orbit.style.animationDelay = `${-(Math.random() * ORBIT_S).toFixed(2)}s`; // 各环相位错开
    const arm = document.createElement('div');
    arm.className = 'fx-tornado-arm';
    arm.style.transform = `translateX(${r.toFixed(1)}px)`;
    const flow = document.createElement('div');
    flow.className = 'fx-tornado-flow';
    // 局部系涌动位移：向轴（沿臂 -x）与母线向上（-y，随轨道旋转 → 螺旋涌动观感）
    flow.style.setProperty('--in', `${-(2 + Math.random() * 7).toFixed(1)}px`);
    flow.style.setProperty('--up', `${-(6 + Math.random() * 15).toFixed(1)}px`);
    // 光点尺寸随机 + 明暗相位/时长随机（负 delay 错相 → 任意时刻粒子明暗错落）
    const dot = DOT_MIN + Math.random() * (DOT_MAX - DOT_MIN);
    flow.style.width = `${dot.toFixed(1)}px`;
    flow.style.height = `${dot.toFixed(1)}px`;
    flow.style.marginLeft = `${(-dot / 2).toFixed(1)}px`;
    flow.style.marginTop = `${(-dot / 2).toFixed(1)}px`;
    flow.style.animationDuration = `${(1.6 + Math.random() * 1.4).toFixed(2)}s`;
    flow.style.animationDelay = `${-(Math.random() * 3).toFixed(2)}s`;
    arm.appendChild(flow);
    orbit.appendChild(arm);
    tornado.appendChild(orbit);
  }
  return tornado;
}
