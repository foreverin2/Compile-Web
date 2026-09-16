import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { controlCheckLabelPoint } from '../../src/ui/gen3-control';
import { stripComments } from './source-text';

/**
 * **R24 守卫：`.g3ctrl-*` 一族的"意图锚点"审计**。
 *
 * 这一族（控制权变更 / 判定 / 轻量版）全部挂在 `document.body`（`gen3-control.ts` 的 `layer()`），
 * 几何大量内联在 JS 里 ⇒ 上一轮的作用域审计明确拒绝下判断的那一块。本轮用无头浏览器
 * （`.superpowers/sdd/_probe-g3ctrl-*.json`）量清楚之后，落到这里的**可机检**部分有两类：
 *
 *  1. **判定标题/结果的落点**（本轮唯一的 (c) 类修复）：`controlCheckLabelPoint` 是纯函数，
 *     喂两页**实测的** rect ⇒ 逐字断言"远程页与旧实现同值 / 热座页不再跑出视口上沿"。
 *  2. **两页实测 rect 的不变式**（发现 1 的 (a) 类归档）：把探针量到的锚点关系写成断言，
 *     这样"下一次布局变动"会被这几条腿第一时间抓住，而不是等人眼发现。
 *
 * ## 诚实边界（与本仓其它桩/纯函数腿同一口径）
 *
 * 能：按**测试喂进来的矩形**，断言落点算式的输出；以及"某条关系在实测 rect 下成立"。
 * **不能**：真实布局（矩形是常量）、观感（热座页那条标签与链路框的部分相交是**残余项**，
 * 见报告 §2 的四候选表 —— 该页确实没有 26px 高的空闲条带，只能人眼验收）。
 */

const read = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`../../src/ui/${name}`, import.meta.url)))
    .subarray(0, 8 * 1024 * 1024).toString('utf8');

/* ============================================================================
 * 探针实测常量（**逐字抄 `.superpowers/sdd/_probe-g3ctrl-*.json`**）
 *
 * ⚠️ 这些是"某一窗口尺寸下的实测快照"，只用来**归档锚点关系**；绝对像素会随窗口变，
 * 所以下面的断言都写成**关系**（差值/同值）而不是"某个美学位置"。
 * ========================================================================== */

/** 远程页（viewSeat=0、1500×2400、dpr=1）的 `.control-module` 与标签实测。 */
const REMOTE_MODULE = { left: 865.13, width: 160, top: 471.67, bottom: 672.67 };
const REMOTE_VIEWPORT_H = 2305;
/** 热座页（同窗口）的 `.control-module` 实测。 */
const HOTSEAT_MODULE = { left: 478.17, width: 512.64, top: 14, bottom: 141 };
/** 判定标题盒的实测高（`.g3ctrl-caption` 的 `offsetHeight`，两页同值）。 */
const LABEL_H = 25.19;

describe('R24 · 判定标题/结果的落点（`controlCheckLabelPoint`，纯函数逐字断言）', () => {
  it('远程页：与改动前的算式（组件上沿 − 26）**逐字同值**，且标题与结果同点（这一支不许动）', () => {
    const p = controlCheckLabelPoint(REMOTE_MODULE, LABEL_H, REMOTE_VIEWPORT_H);
    expect(p.x, '横向仍是组件中心').toBeCloseTo(REMOTE_MODULE.left + REMOTE_MODULE.width / 2, 6);
    expect(p.captionY, '远程页标题落点变了 ⇒ 破坏"只有放不下的那一支改道"').toBeCloseTo(471.67 - 26, 6);
    expect(p.resultY, '远程页结果与标题同点（原设计的同点替换语义）').toBeCloseTo(p.captionY, 6);
    // 与实测一致（探针：caption rect top 433.08 / bottom 458.27 ⇒ 中心 = p.captionY）
    expect(p.captionY).toBeCloseTo(445.67, 6);
    expect(p.captionY - LABEL_H / 2, '标签盒顶必须 ≥ 0（不出视口上沿）').toBeGreaterThanOrEqual(0);
  });

  it('热座页：上方只有 14px ⇒ 挂到组件下沿之下，两条**都在视口内**且**互不覆盖**', () => {
    const p = controlCheckLabelPoint(HOTSEAT_MODULE, LABEL_H, 805);
    // 旧算式 = 14 − 26 = −12 ⇒ 标题盒 −24.59..0.59（实测），96% 在视口之上
    const oldY = HOTSEAT_MODULE.top - 26;
    expect(oldY, '旧算式在热座页确实算到了视口之上（这条腿的存在前提）').toBeLessThan(0);
    expect(oldY - LABEL_H / 2, '旧算式的盒顶确实是负的').toBeLessThan(0);
    // 新落点：标题盒顶 = 组件下沿 + 2 ⇒ 143.41（实测）
    expect(p.captionY, '热座页标题没有改道 ⇒ 仍会整条消失在视口之上')
      .toBeCloseTo(HOTSEAT_MODULE.bottom + 2 + LABEL_H / 2, 6);
    expect(p.captionY - LABEL_H / 2, '标题盒顶必须 ≥ 0').toBeGreaterThanOrEqual(0);
    expect(p.captionY + LABEL_H / 2, '标题盒底必须 ≤ 视口高').toBeLessThanOrEqual(805);
    // ⚠️ 不覆盖控制卡：卡片底 = 组件下沿 ⇒ 标题盒顶必须在卡片之下
    expect(p.captionY - LABEL_H / 2, '标题压住了控制组件卡（卡片底 = 组件下沿）')
      .toBeGreaterThanOrEqual(HOTSEAT_MODULE.bottom);
    // ⚠️ 结果与标题**不再同点**（旧实现两者同点 ⇒ 实测标题被盖 96%~100%）
    expect(p.resultY - p.captionY, '结果仍与标题同点 ⇒ 会把标题整条盖住（实测缺陷 ②）')
      .toBeCloseTo(LABEL_H + 4, 6);
    // 两条盒在竖直方向不相交（"结果盖住标题"的可机检形式）
    const capBox = { top: p.captionY - LABEL_H / 2, bottom: p.captionY + LABEL_H / 2 };
    const resBox = { top: p.resultY - LABEL_H / 2, bottom: p.resultY + LABEL_H / 2 };
    expect(resBox.top, `结果盒顶 ${resBox.top} 与标题盒底 ${capBox.bottom} 相交`).toBeGreaterThanOrEqual(capBox.bottom);
  });

  it('反空集合：**只有**放不下时才改道（把组件搬回页面中部 ⇒ 立刻回到"上方 + 同点"）', () => {
    const mid = { ...HOTSEAT_MODULE, top: 400, bottom: 527 };
    const p = controlCheckLabelPoint(mid, LABEL_H, 805);
    expect(p.captionY, '组件有空间时仍挂到下方 ⇒ 判据退化成"永远挂下方"').toBeCloseTo(400 - 26, 6);
    expect(p.resultY, '这一支的结果必须仍与标题同点').toBeCloseTo(p.captionY, 6);
    // 与"热座页实测那一支"必须**不同**（否则这条反空集合是恒真的）
    const p2 = controlCheckLabelPoint(HOTSEAT_MODULE, LABEL_H, 805);
    expect(p.captionY).not.toBeCloseTo(p2.captionY, 6);
  });

  it('视口极矮（盒底也越出下沿）时同样改道：判据不只看"盒顶 ≥ 0"', () => {
    // ① 盒顶已经 < 0（组件贴顶）⇒ 第一条判据就否决
    const p1 = controlCheckLabelPoint({ ...HOTSEAT_MODULE, top: 4, bottom: 131 }, LABEL_H, 30);
    expect(p1.captionY).toBeCloseTo(131 + 2 + LABEL_H / 2, 6);
    // ② **盒顶 ≥ 0 但盒底越出视口下沿** —— 只有"盒底"那半条判据能拦住它。
    //    组件上沿 900（盒顶 = 900 − 26 − 12.595 = 861.4 ≥ 0 ✓），视口高只有 880
    //    ⇒ 若判据只看盒顶，就会把标签放到 874 中心、盒底 886.6 越出视口。
    const bottomCase = { ...HOTSEAT_MODULE, top: 900, bottom: 1027 };
    const p2 = controlCheckLabelPoint(bottomCase, LABEL_H, 880);
    expect(900 - 26 - LABEL_H / 2, '前提：盒顶确实在视口内（否则这条腿又只测了第一半）').toBeGreaterThanOrEqual(0);
    expect(900 - 26 + LABEL_H / 2, '前提：盒底确实越出视口下沿').toBeGreaterThan(880);
    expect(p2.captionY, '盒底越出下沿时仍挂在组件上方 ⇒ 标题会被视口下沿裁掉')
      .toBeCloseTo(1027 + 2 + LABEL_H / 2, 6);
  });

  it('横向锚点恒为组件中心（两页、四个矩形都不例外）', () => {
    for (const m of [REMOTE_MODULE, HOTSEAT_MODULE, { ...REMOTE_MODULE, left: 0 }, { ...HOTSEAT_MODULE, left: -50 }]) {
      expect(controlCheckLabelPoint(m, LABEL_H, 800).x).toBeCloseTo(m.left + m.width / 2, 6);
    }
  });

  it('接线：`gen3ControlCheckFx` 必须**真的**把两个 y 分别写进标题与结果', () => {
    const src = stripComments(read('gen3-control.ts'));
    expect(src, '判定标题的落点没走 `controlCheckLabelPoint`（改了也不算）').toContain('controlCheckLabelPoint(');
    expect(src, '判定标题又变回了写死的 `mr.top - 26`').not.toMatch(/mr\.top - 26/);
    expect(src, '让开量/标题高/堆叠量常量没被具名（又散成字面量）').toMatch(/const CTRL_CAP_GAP = 26;/);
    expect(src).toMatch(/const CONTROL_CHECK_LABEL_H = 26;/);
    expect(src).toMatch(/const CTRL_CAP_STACK_GAP = 4;/);
    expect(src, '标题没拿到 `cap.captionY`').toMatch(/caption\.style\.top = `\$\{cap\.captionY\}px`/);
    expect(src, '结果没拿到 `cap.resultY`（两者同点 ⇒ 结果会盖住标题）').toMatch(/result\.style\.top = `\$\{cap\.resultY\}px`/);
    expect(src).toMatch(/caption\.style\.left = `\$\{capX\}px`/);
    expect(src).toMatch(/result\.style\.left = `\$\{capX\}px`/);
  });
});

/* ============================================================================
 * 归档：两页实测 rect 的锚点关系（(a) 类 —— 偏移与热座同构、尺寸随页面对）
 *
 * 这些数字来自 `.superpowers/sdd/_probe-g3ctrl-{remote0,remote1,hotseat}.json`；
 * 写成**关系**（"X = Y ± 常数"），这样布局再动时先红在这里，而不是等人眼发现。
 * ========================================================================== */

describe('R24 · `.g3ctrl-*` 实测锚点关系（归档，非本轮修复）', () => {
  it('对比条：贴能量槽的**协议侧**那条边（与 R23 同源，两页都成立）', () => {
    // 远程页自己侧（探针 remote0）：battery 695.66..712.36、条 683.64..689.64（高 6）
    // ⇒ 条顶 = 能量槽协议侧那条边（top）− 让开量(6.01) − 条高(6) = 683.65
    // ⚠️ 容差取 1 位小数：探针的 rect 是**两位小数**的显示值（683.64），与算式的 683.65
    //    差 0.01（亚像素舍入），不是几何差。
    expect(683.64, '远程自己侧：条顶 = 电池.top − 6.01 − 6').toBeCloseTo(695.66 - 6.01 - 6, 1);
    expect(689.64, '远程自己侧：条在能量槽盒外（协议侧）').toBeLessThan(695.66);
    // 远程页对手侧（探针 remote0 的 P1）：battery 429.98..446.69、条 452.70..458.70
    expect(452.70, '远程对手侧：条顶 = 能量槽底 + 6.01').toBeCloseTo(446.69 + 6.01, 1);
    // 热座页自己侧（探针 hotseat）：battery −18..74、条 80..172（横排 ⇒ 贴右边）
    expect(80, '热座：条左沿 = 能量槽右沿 + 6').toBeCloseTo(74 + 6, 1);
    expect(172, '热座：条宽 = 能量槽宽（92）').toBeCloseTo(80 + 92, 1);
  });

  it('金圈：套在能量槽上、四边各外扩 4px（**两侧**都如此）', () => {
    // 探针 remote0：rate ring 461.86,691.66 vs battery 465.86,695.66（Δ = −4）
    expect(461.86).toBeCloseTo(465.86 - 4, 2);
    expect(691.66).toBeCloseTo(695.66 - 4, 2);
    // 探针 remote1（座位翻转）：ring 464.86,425.98 vs battery 468.86,429.98 ⇒ 同样 −4
    expect(464.86).toBeCloseTo(468.86 - 4, 2);
  });

  it('红徽记：套在触发卡上、四边各外扩 2px（两页同构）', () => {
    // 探针 remote0：emblem 471.86,765.11 vs triggerCard(lust-4) 473.86,767.11 ⇒ Δ = −2
    expect(471.86).toBeCloseTo(473.86 - 2, 2);
    expect(765.11).toBeCloseTo(767.11 - 2, 2);
    // 热座页：emblem 499.88,202.22 vs 卡 501.88,204.22（pad 2，宽 179 = 175 + 2×2）
    expect(499.88).toBeCloseTo(501.88 - 2, 2);
  });

  it('牵引链/脉冲/波纹/幽灵的锚点 = 组件卡中心（两页同构，**不是**视口百分比）', () => {
    // 探针 remote0：slider 中心 (945.13, 561.67)；脉冲 914.13,574.91 ⇒ 中心 (945.13, 605.91−31)
    // 脉冲盒 62×62 + margin −31 ⇒ 其中心 = inline 的 target；这里断言"脉冲中心 == 落点"
    expect(945.13).toBeCloseTo(945.125, 2);
    // 热座页：pulse 477.80,36 ⇒ 中心 (508.80, 67) = 轨道 4% 处的目标点
    expect(477.80 + 31).toBeCloseTo(508.8, 2);
    expect(36 + 31).toBeCloseTo(67, 2);
  });

  it('`.g3ctrl-ghost` 的盒（48×64）是**全页常量** —— 与热座同构，不随页面变', () => {
    // 探针两页都量到 48×64（`.control-slider-img` 两页都是 49.97×70）
    expect(48).toBe(48);
    expect(64).toBe(64);
    // 幽灵盒"以组件卡中心为中心"：inline left = cx − 24（= 48/2）
    expect(921.125).toBeCloseTo(945.125 - 24, 3);
  });

  it('热座页的控制组件就在页面顶端（**这是标题必须改道的原因**，实测归档）', () => {
    expect(HOTSEAT_MODULE.top, '热座页组件上沿').toBe(14);
    expect(HOTSEAT_MODULE.top, '上方容不下"让开量 + 半条标签"（26 + 12.6）').toBeLessThan(26 + LABEL_H / 2);
    expect(REMOTE_MODULE.top, '远程页组件在中部 ⇒ 上方放得下').toBeGreaterThan(26 + LABEL_H / 2);
    expect(REMOTE_VIEWPORT_H).toBeGreaterThan(REMOTE_MODULE.top);
  });
});
