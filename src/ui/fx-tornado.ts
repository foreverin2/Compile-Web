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

/** 龙卷风视觉盒尺寸（px；styles.css .fx-speed-tornado 同步） */
export const TORNADO_W = 118;
export const TORNADO_H = 170;

/** 粒子数：锥面包络采样密度（观感与性能平衡点） */
const TORNADO_PARTICLES = 30;

/** 粒子光点尺寸（直径 px 上下限，随机） */
const DOT_MIN = 3;
const DOT_MAX = 6;

/** 轨道自转周期（s，与 styles.css .fx-tornado-orbit 动画一致） */
const ORBIT_S = 1.9;

/** 构造一个粒子龙卷风容器（含全部粒子轨道），绝对定位于调用方坐标系中心 */
export function buildTornadoFx(): HTMLElement {
  const tornado = document.createElement('div');
  tornado.className = 'fx-speed-tornado';
  const rMax = TORNADO_W / 2 - 8; // 顶部（云帽）最大半径
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
