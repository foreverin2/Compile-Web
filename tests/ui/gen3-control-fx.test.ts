import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Card, GameState, Line, PlayerId } from '../../src/core/models/types';
import { createGame } from '../../src/core/state/create';
import { clearGen3Persistent, syncWrath0Cull } from '../../src/ui/gen3-control';
import { setFxViewSeat } from '../../src/ui/fx-seat';
import { installStubDom, makeStubEl, type StubNode } from './net-dom-stub';
import { stripComments } from './source-text';

/**
 * 批次 D 守卫（控制权族 C1~C6 + 常驻层 + 贪婪1 硬币堆，2026-09-13）。
 *
 * 这一批的关键风险不是"CSS 没定义"（已有守卫），而是：
 *  ① **引擎事件没接上或语义发错**（控制权三种时刻分不清 / 判定失败无事件 / 免疫无反馈）；
 *  ② **常驻层的生效条件与引擎判定不一致**（例：暴怒0 只划除估值方一侧、惰性1 未要求未覆盖顶卡）；
 *  ③ 常驻 sync 未接进每帧管线（写了但不跑 = 永远看不到）。
 * 以下断言把这三类锁死。
 */

const root = new URL('../../src/', import.meta.url);
const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, root))).subarray(0, 4 * 1024 * 1024).toString('utf8');

const controlTs = read('ui/gen3-control.ts');
const syncCss = read('ui/styles-gen3-sync.css');
const controlCore = read('core/rules/control.ts');
const gameCore = read('core/game.ts');
const resolveCore = read('core/effects/resolve.ts');
const renderTs = read('ui/render.ts');
const mainTs = read('main.ts');
const effectsTs = read('ui/effects/index.ts');

describe('批次 D 守卫：控制权族 + 常驻层', () => {
  it('引擎事件齐备且语义正确（控制权/判定/清缓存/免疫）', () => {
    // 控制权变更：唯一入口 setControl 发射，带 from/to/reason/sourceDefId；三种 reason 至少覆盖 check/return/effect
    // 2026-09-13（用户清单 #8）：新增 sourceDefId（效果源卡 defId）——UI 据此只让"色欲卡"造成的
    // 易主播牵引链，判定阶段/其他协议只播轻量提示。
    expect(controlCore).toContain("type: 'control:changed'");
    expect(controlCore).toMatch(/payload: \{ from, to: holder, reason, sourceDefId \}/);
    expect(controlCore).toContain("reason = 'effect'");
    expect(controlCore).toMatch(/sourceDefId\?: string/);
    expect(controlCore).toContain("setControl(s, p, 'check')");
    expect(controlCore).toContain("setControl(s, -1, 'return')");
    // 判定阶段：无论是否获得都要发（Q5 判定失败也要有反馈）
    expect(controlCore).toContain("type: 'rule:control-check'");
    expect(controlCore).toMatch(/gained: wins >= 2 && s\.control !== p/);
    // 清缓存时刻：两条路径（正常清缓存生成器 + 防御路径）都要发
    expect(gameCore.match(/type: 'rule:clear-cache'/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    // 免疫反馈：flip 与 shift 两个分支都要发
    expect(resolveCore.match(/type: 'card:immune'/g)?.length ?? 0).toBe(2);
  });

  it('常驻 sync 已接进每帧渲染管线 + 随滚动重定位 + 随局清理', () => {
    expect(renderTs, 'render.ts 未调用 syncGen3Persistent').toContain('syncGen3Persistent(s);');
    expect(renderTs, 'resetUiState 未清理 3代常驻层').toContain('clearGen3Persistent();');
    expect(mainTs, '滚动/缩放重定位未带 3代常驻层').toContain('syncGen3Persistent(state);');
    // 统一 prune：各 sync 返回自己的 active 键（否则会互相删层）
    expect(controlTs).toMatch(/syncEnvy0Absorb\(s\),\s*\.\.\.syncWrath0Cull\(s\)/);
    expect(controlTs).toContain('pruneAll(active)');
  });

  it('瞬态控制权特效的三个入口都订阅了', () => {
    expect(mainTs).toContain("e.type === 'control:changed'");
    expect(mainTs).toContain("e.type === 'rule:control-check'");
    expect(mainTs).toContain("e.type === 'rule:clear-cache'");
    expect(mainTs).toContain('gen3ControlChangedFx(');
    expect(mainTs).toContain('gen3ControlCheckFx(');
    expect(mainTs).toContain('gen3ClearCacheFx(');
    // 免疫事件 → 僵化7 护壁闪亮
    expect(effectsTs).toContain("case 'card:immune'");
    expect(effectsTs).toContain('flashRigidity7Guard(');
  });

  it('常驻层的生效条件与引擎判定一致（关键语义）', () => {
    // 暴怒0：**双方都算**（该线每张点数值 == M 的卡都不计入其拥有者总阈值）
    const wrath = controlTs.slice(controlTs.indexOf('export function syncWrath0Cull'), controlTs.indexOf('export function syncSloth0Bonus'));
    expect(wrath, '暴怒0 划除必须遍历双方链路').toMatch(/for \(const pid of \[0, 1\] as const\)[\s\S]{0,160}cardPointValue\(s, c\) === m/);
    // 怠惰0：相邻上方那张是怠惰牌（= 引擎 coveredBySloth）
    expect(controlTs).toMatch(/startsWith\('sloth-'\)/);
    // 惰性1：必须是未覆盖顶卡（= 引擎 lineBottomCommandsDisabled）
    const inertia = controlTs.slice(controlTs.indexOf('export function syncInertiaNullify'), controlTs.indexOf('export function syncRigidity7Guard'));
    expect(inertia).toMatch(/inertia-1' && c\.faceUp && isUncovered\(s, c\)/);
    // 僵化7：正面 + 未被覆盖 + 底框可用（= 引擎 rigidity7Immune）
    expect(controlTs).toMatch(/faceUp && isUncovered\(s, c\) && !cardCommandDisabled\(s, c, 'bottom'\)/);
    // 嫉妒0：对手该线全部卡（含被盖/反面）取最大
    expect(controlTs).toMatch(/for \(const c of foeCards\)/);
    // 色欲禁编译：持有者场上有未覆盖正面 lust-0
    expect(controlTs).toMatch(/lust-0' && c\.faceUp && isUncovered\(s, c\)/);
  });

  it('贪婪1 硬币堆等级：编译时 +1（≤3）且随卡离场清理', () => {
    expect(controlTs).toContain('noteGreed1Compile');
    expect(controlTs).toMatch(/Math\.min\(3, cur \+ 1\)/);
    expect(controlTs).toMatch(/if \(!onField\.has\(uid\)\) greed1Stack\.delete\(uid\)/);
    expect(effectsTs, 'line:compiled 未记录贪婪1 硬币堆').toContain("if (p.sourceDefId === 'greed-1') noteGreed1Compile(p.sourceUid);");
  });

  it('gen3-control.ts 用到的每个类都在 styles-gen3-sync.css 有定义', () => {
    const used = new Set<string>();
    for (const m of controlTs.matchAll(/['"`]([^'"`]*g3(?:sync|ctrl|clear)-[a-z0-9-]+[^'"`]*)['"`]/g)) {
      for (const token of m[1].split(/\s+/)) if (/^g3(?:sync|ctrl|clear)-[a-z0-9-]+$/.test(token)) used.add(token);
    }
    const missing = [...used].filter((cls) => !new RegExp(`\\.${cls}(\\s*[,{:. ]|\\s+[a-z])`).test(syncCss));
    expect(missing, `以下类在 JS 中使用但 CSS 未定义（特效将不可见）：${missing.join(', ')}`).toEqual([]);
    expect(used.size).toBeGreaterThan(30); // 防"类名收集正则失效"
  });

  it('常驻层只重建、但**位置每帧都重算**（禁止"签名相同就 continue"导致漏重定位）', () => {
    // 2026-09-13 用户实测 bug：旧版在 sig 相同时提前 continue，漏了 glow/mark/badge/seam/ripple 的重定位
    // → 滚动屏幕时这些会粘在原来的屏幕坐标不跟卡走。以下断言禁止该写法复活。
    expect(controlTs, '仍有同步器在"签名相同"分支里提前 continue（会漏重定位）').not.toContain('if (rec.sig === sig)');
    for (const fn of ['syncEnvy0Absorb', 'syncWrath0Cull', 'syncSloth0Bonus', 'syncInertiaNullify', 'syncRigidity7Guard', 'syncLustHold']) {
      const from = controlTs.indexOf(`export function ${fn}`);
      const body = controlTs.slice(from, controlTs.indexOf('export function', from + 10));
      expect(body, `${fn} 缺少每帧重定位（place/placeEnvy0）`).toMatch(/place(Envy0)?\(/);
    }
    const code = syncCss.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(code.includes('mask:')).toBe(false);
    expect(code.includes('@property')).toBe(false);
  });

  it('常驻视觉不再出现"跨链路长线/卡面网格"（2026-09-13 审计后的两条改进）', () => {
    // ① 暴怒0 中缝：只跨两条能量槽（旧版跨双方槽位并集 = 整行宽，像怪线），并挂"最高档剔除"文字标
    const wrath = controlTs.slice(controlTs.indexOf('export function syncWrath0Cull'), controlTs.indexOf('export function syncSloth0Bonus'));
    expect(wrath, '中缝未按能量槽定位').toMatch(/const b0 = batteryNode\(0, line\)/);
    expect(wrath, '中缝未按能量槽定位').toMatch(/const b1 = batteryNode\(1, line\)/);
    expect(wrath, '中缝缺少文字标').toContain("'g3sync-wrath0-chip'");
    expect(syncCss, 'CSS 缺少 .g3sync-wrath0-chip').toContain('.g3sync-wrath0-chip');
    // ② 僵化7 迷宫纹：必须是"卡外一圈边框"（border-image 重复渐变），不能再是铺满卡面的网格
    const mazeBlock = syncCss.slice(syncCss.indexOf('.g3sync-rig7-maze {'), syncCss.indexOf('@keyframes g3-rig7-maze'));
    expect(mazeBlock, '迷宫纹未改为卡外边框（border-image）').toContain('border-image: repeating-linear-gradient');
    expect(mazeBlock, '迷宫纹仍在铺满卡面（background 重复渐变）').not.toMatch(/background:\s*\n?\s*repeating-linear-gradient/);
  });

  it('C4 判定特效已改为"贴能量槽的短对比条 + 文字标签"（旧版横铺整条链路 = 用户看到的怪粗线）', () => {
    expect(controlTs, 'C4 仍在整条 stack-slot 上铺条').not.toMatch(/bar\.style\.width = `\$\{r\.width \+ 12\}px`/);
    expect(controlTs).toContain("el('div', 'g3ctrl-caption'");
    expect(controlTs).toContain('g3ctrl-result');
    // ⚠️ **R23 判据修正**：旧句钉的是 `anchor.bottom + 5`（= 贴能量槽的**链路侧**那条边）。
    //    那句在 R22 之后正是缺陷本身 —— 能量槽移到链路头部后，它的"下方"就是本侧链路槽
    //    （实测 1500×2400：条顶 717.36 落在 `.stack-slot` 顶边 718.36 之内 1px）。
    //    **新句多查了什么**：条的位置必须由 `checkBarProtocolEdge`（协议侧那条边）派生，
    //    且落点常量是具名的 `CTRL_CMP_OUTER_GAP`（不再是散落字面量 `+5`）。
    //    "旧句为什么必须改"与行为证据见 `tests/ui/net-check-anchor.test.ts`（真跑腿）。
    expect(controlTs, '对比条仍未走"协议侧那条边"的单一出处（R23）').toContain('checkBarProtocolEdge(');
    expect(controlTs, '对比条落点又变回散落字面量（应是具名常量）').toMatch(/CTRL_CMP_OUTER_GAP/);
    expect(controlTs, '对比条锚点又贴回了能量槽的链路侧（anchor.bottom + 5）').not.toMatch(/anchor\.bottom \+ 5/);
    expect(controlTs).toMatch(/Math\.min\(150,/);
    expect(controlTs).toContain("el('i', 'g3ctrl-lead-ring')");
    expect(controlTs).toContain('.stack-slot[data-player="${player}"][data-line="${line}"]');
    expect(controlTs, 'batteryNode 仍在用不存在的 .line-row 回退').not.toContain('.line-row');
    // 新 C4 所需的类必须在 CSS 里（含 caption/result/cmp/num/lead-ring）
    for (const cls of ['g3ctrl-caption', 'g3ctrl-result', 'g3ctrl-cmp', 'g3ctrl-cmp-own', 'g3ctrl-cmp-opp', 'g3ctrl-cmp-scan', 'g3ctrl-cmp-num', 'g3ctrl-lead-ring']) {
      expect(syncCss, `CSS 缺少 .${cls}`).toContain(`.${cls}`);
    }
    // 条高：**唯一出处是 JS 常量**（`CTRL_CMP_BAR_H`），由 `cmp.style.height` 内联写出 ——
    // ⚠️ 不能断言 CSS 里的 `height`：`styles-gen3-sync.css` 是红线文件（本轮不改），
    //    那里保留着旧的 9px，真实高度由内联值赢。所以判据钉"内联写出用的常量是 6"。
    expect(controlTs, 'JS 侧的条高常量不是 6（条会越出到协议卡面或能量槽上）').toMatch(/const CTRL_CMP_BAR_H = 6;/);
    expect(controlTs, '条高没有内联写出（会被样式表的旧值 9px 接管 ⇒ 压到卡上）')
      .toMatch(/cmp\.style\.height = `\$\{barH\}px`/);
  });

  it('C1/C2 落点锚定轨道实测位置 + 仅色欲驱动时才牵链条（2026-09-13 用户清单 #1/#8）', () => {
    // #1：控制组件卡在 .control-track 上滑动 → 落点必须按轨道矩形算（不再用视口 22%/78% 猜）
    expect(controlTs, '缺少按 .control-track 实测位置计算落点').toContain("document.querySelector<HTMLElement>('.control-track')");
    // G2 修正 R3（用户裁决"控制轨改成竖向，自己端在下、对手端在上"）：端归属与坐标换算搬到了
    // `fx-seat.ts` 的**纯函数** `fxTrackEndPos`（无 jsdom 可逐格断言，含"上下对调"的变异），
    // 本文件只负责"取轨道实测矩形"。旧判据 `controlTrackSideX(` 已随改名消失。
    expect(controlTs, '控制轨落点未走 fx-seat 的端归属纯函数').toContain('fxTrackEndPos(');
    expect(controlTs, '轨道端点必须按座位选轴（热座 x / 远程页 y）').toContain('controlTrackAxis(');
    const seatTs = read('ui/fx-seat.ts');
    expect(seatTs, 'fx-seat 缺控制轨端归属的判据').toContain('export function fxTrackEndFor');
    // ⚠️ **R-F（Minor M-4）的判据修正**：贴端距离改成了**单一出处常量** `FX_TRACK_EDGE_PCT`
    //    （`render.ts` 也从它取值），所以这里的逐字 `0.04` / `0.96` 判据会假红。
    //    改钉**语义**：热座支 → 自己（`fxIsSelfSide`）贴小端、对手贴大端；竖向支 → 自己贴大端、
    //    对手贴小端；两条都只经 `fxIsSelfSide`（唯一方向判据）。
    //    **原能抓什么**：热座支被删/被改成竖向取值（热座控制轨换端）。
    //    **现在还能抓什么**：同上 —— "自己/对手各贴哪一端"仍然是绝对断言（下面 fx-seat.test.ts
    //    另有逐字段的 `toEqual({pct: 0.04/0.96})` 单测兜底，数值本身没变）。
    expect(seatTs, '控制轨端归属缺"自己贴小端 4%、对手贴大端 96%"这一支')
      .toMatch(/seat === null[\s\S]{0,120}\{ pct: fxIsSelfSide\(seat, to\) \? FX_TRACK_EDGE : 1 - FX_TRACK_EDGE, axis: 'x' \}/);
    // ⚠️ **判据修正（R14-5）**：旧句钉的是竖向分支用 `FX_TRACK_EDGE`（4/96）—— 那正是被 R14-1
    //    打破的不变式（渲染侧内缩到 22/78、FX 侧留在 4/96 ⇒ 差 28.4px），所以旧句必须改。
    //    **新句多查了什么**：竖向必须改用**竖向自己的**单一出处 `FX_TRACK_EDGE_Y`（= 22/78），
    //    且那个常量在 fx-seat 里以 `FX_TRACK_EDGE_PCT_Y` 导出（render.ts 从它取值）。
    expect(seatTs, '控制轨端归属缺"自己在下（78%）、对手在上（22%）"的竖向支')
      .toMatch(/pct: fxIsSelfSide\(seat, to\) \? 1 - FX_TRACK_EDGE_Y : FX_TRACK_EDGE_Y, axis: 'y' \}/);
    // 贴端距离必须是**单一出处**的常量（Minor M-4）：render.ts 的滑块位置也从它取
    expect(seatTs, '贴端距离不是单一出处常量（Minor M-4）').toMatch(/export const FX_TRACK_EDGE_PCT = 4;/);
    expect(seatTs, '竖向贴端距离不是单一出处常量（R14-5：渲染侧与 FX 侧会再次错开）')
      .toMatch(/export const FX_TRACK_EDGE_PCT_Y = 22;/);
    // #8：牵引链只在"色欲卡效果"造成的易主时播；否则走轻量提示（不牵链条）
    expect(controlTs).toContain('lustDrivenControl(');
    expect(controlTs).toMatch(/p\.reason === 'effect' && \(p\.sourceDefId \?\? ''\)\.startsWith\('lust-'\)/);
    expect(controlTs).toContain('controlMiniFx(');
    expect(syncCss, 'CSS 缺少轻量版脉冲/文字标').toContain('.g3ctrl-mini-pulse');
    expect(syncCss).toContain('.g3ctrl-mini-chip');
    // 引擎侧：卡牌效果必须带上效果源 defId（否则 UI 无法判定"是不是色欲在控制控制权"）
    for (const f of ['core/effects/cards/lust.ts', 'core/effects/cards/envy.ts', 'core/effects/cards/nova.ts', 'core/effects/cards/wrath.ts']) {
      expect(read(f), `${f} 的 setControl 未带效果源 defId`).toMatch(/setControl\(ctx\.s,[^)]*ctx\.card\.defId\)/);
    }
  });

  it('全协议同类审计修正（2026-09-13）：常驻子件无条件创建 + 归属/滚动路径补漏', () => {
    // ① 常驻层"子件只在 rect 非空时创建"= 重建帧取不到 rect 就永远缺失（与"滚动后特效消失"同类）。
    //    三个 sync 的源卡/覆盖者相关子件必须无条件 append，位置交给每帧的 place*/守卫。
    expect(controlTs, 'envy0 的 thread/mark/borrow 仍按 rect 条件创建').not.toMatch(/if \(sr\) \{\s*rec\.node\.appendChild\(el\('div', 'g3sync-envy0-thread'\)\)/);
    expect(controlTs, 'sloth0 的覆盖者连线仍按 rect 条件创建').not.toMatch(/if \(cr\) rec\.node\.appendChild\(el\('i', 'g3sync-sloth0-link'\)\)/);
    expect(controlTs, 'inertia0 的栅格仍按 rect 条件创建').not.toMatch(/if \(!r\) continue;\s*const grid = el\('i', 'g3sync-inertia0-grid'\)/);
    // ② 多元3 常驻层（body 级 fixed）此前只在 renderApp 里同步 → 滚动/缩放时粘在旧坐标
    expect(mainTs, 'syncDiversity3Fx 未接进滚动/缩放重定位').toMatch(/syncWarBlades\(state\);[\s\S]{0,400}syncDiversity3Fx\(state\);/);
    // ③ 联合1 编译光柱不得回退到"文档里第一个 .protocol-holder"（会锚到不相干的协议）
    expect(read('ui/fx-gen2.ts'), 'fx-gen2 仍有 .protocol-holder 全局回退').not.toContain("?? document.querySelector<HTMLElement>('.protocol-holder')");
  });

  it('rigidity-4 的覆盖者既可能来自打出（pendingPlay）也可能来自偏转（pendingShift）', () => {
    expect(read('core/effects/cards/rigidity.ts')).toMatch(/pendingPlay\[0\]\?\.card \?\? ctx\.s\.pendingShift\[0\]\?\.card/);
    expect(read('core/effects/cards/unity.ts')).toMatch(/pendingPlay\[0\]\?\.card \?\? ctx\.s\.pendingShift\[0\]\?\.card/);
  });
});

/**
 * **R14-6 守卫（本轮新增 · 修复 2 的行为腿）**：暴怒0 的「最高档剔除」中缝必须按**页面轴向**画。
 *
 * 为什么必须是**行为**腿：中缝的几何（left / top / width↔height）是 `syncWrath0Cull` 里**内联**
 * 算出来写进 DOM 的，源码腿只能钉"有没有那个分支"，钉不住"算出来的数对不对"（R14-1 那种
 * "两处各算各的、没一条断言发现"的回归正是这样溜过去的）。这里用 `tests/ui/net-dom-stub`
 * 的桩 DOM **真跑** `syncWrath0Cull`，喂两根**测试给定矩形**的能量槽，把两个轴向的数值逐字钉住。
 *
 * 桩能证明 / 不能证明：能证明"按这两根槽的矩形，写进 DOM 的是这些数"与"两个轴向走的是不同分支"；
 * **不能**证明真实布局（矩形是测试喂的常量）、也不能证明"看起来对"（人眼项）。
 */
describe('R14-6 · 暴怒0 中缝按页面轴向画（热座横 / 远程竖）', () => {
  /** 一根能量槽桩：`.battery[data-player][data-line]` + 测试给定的矩形。 */
  function batteryStub(player: PlayerId, line: Line, r: { left: number; top: number; width: number; height: number }): StubNode {
    const n = makeStubEl('div');
    n.classList.add('battery');
    n.dataset.player = String(player);
    n.dataset.line = String(line);
    (n as unknown as { getBoundingClientRect: () => unknown }).getBoundingClientRect = () => ({
      left: r.left, top: r.top, width: r.width, height: r.height,
      right: r.left + r.width, bottom: r.top + r.height, x: r.left, y: r.top,
    });
    return n;
  }

  /** 场上卡桩（`cardPointValue` 只吃 `zone/faceUp/defId`；`isUncovered` 只吃 `owner/line/uid`）。 */
  function cardStub(uid: string, defId: string, owner: PlayerId, line: Line): Card {
    return { uid, defId, owner, line, faceUp: true, zone: 'field', pos: 0 } as unknown as Card;
  }

  /** 一条"暴怒0 生效 + 有一条最高档"的最小状态：line 0 上 P0 有正面 wrath-0（value 0）与 wrath-5（value 5）。 */
  function stateWithWrath0(): GameState {
    const s = createGame({ seed: 'r14-6', draftStarter: 0, firstToPlay: 0 });
    s.players[0].stacks[0] = [cardStub('r14-w0', 'wrath-0', 0, 0), cardStub('r14-w5', 'wrath-5', 0, 0)];
    return s;
  }

  it('热座（seat === null）：仍是**横**缝（left/top/width 与改动前逐字同值、无 vert 类）；远程页：竖缝', () => {
    const restore = installStubDom();
    try {
      // 两根槽的矩形（横竖都拉得开，两个轴向的公式因此给出**不同**的数，不会互相假绿）：
      // P0 槽中心 (120, 520)、P1 槽中心 (320, 920)
      const body = document.body as unknown as StubNode;
      body.appendChild(batteryStub(0, 0, { left: 100, top: 500, width: 40, height: 40 }));
      body.appendChild(batteryStub(1, 0, { left: 300, top: 900, width: 40, height: 40 }));
      const s = stateWithWrath0();
      const seamOf = (): StubNode => {
        const n = document.querySelector('.g3sync-wrath0-seam') as unknown as StubNode | null;
        expect(n, 'DOM 里没有 .g3sync-wrath0-seam（暴怒0 的层没建出来？）').toBeTruthy();
        return n!;
      };
      const chipOf = (): StubNode => {
        const n = document.querySelector('.g3sync-wrath0-chip') as unknown as StubNode | null;
        expect(n, 'DOM 里没有 .g3sync-wrath0-chip').toBeTruthy();
        return n!;
      };

      // ── ① 热座：横缝（**逐字等于改动前的三个算式**：只跨两条槽之间、两端各外伸 34px） ──
      setFxViewSeat(null);
      syncWrath0Cull(s);
      const seam = seamOf();
      expect(seam.classList.contains('vert'), '热座页的中缝被加上了竖版类（styles-net 的覆盖会命中它）')
        .toBe(false);
      expect(seam.style.left, '横缝左端 = min(两槽中心 x) − 34 = 120 − 34').toBe('86px');
      expect(seam.style.top, '横缝 y = 两槽中心 y 的均值 = (520 + 920) / 2').toBe('720px');
      expect(seam.style.width, '横缝宽 = 两槽中心距 + 68 = 200 + 68（不改动前的取值）').toBe('268px');
      expect(chipOf().style.left, 'chip 在横缝中点 x = 220').toBe('220px');
      expect(chipOf().style.top, 'chip 在横缝 y = 720').toBe('720px');

      // ── ② 远程页（同一个层节点）：竖缝 —— 跨在两槽的**上下两端**之间 ──
      setFxViewSeat(0);
      syncWrath0Cull(s);
      const seam2 = seamOf();
      expect(seam2.classList.contains('vert'), '远程页的中缝没有竖版类 ⇒ styles-net 的竖版覆盖不生效'
        + '（会画成一条压在协议/链路中部的横虚线 + 朝左右的箭头）').toBe(true);
      expect(seam2.style.left, '竖缝 x = 两槽中心 x 的均值 = (120 + 320) / 2').toBe('220px');
      expect(seam2.style.top, '竖缝上端 = min(两槽中心 y) − 34 = 520 − 34').toBe('486px');
      expect(seam2.style.height, '竖缝高 = |两槽中心 y 之差| + 68 = 400 + 68').toBe('468px');
      expect(seam2.style.width, '横版残留的内联 width 没清掉 ⇒ 竖版变体的 width:0 会被内联覆盖')
        .toBe('');
      // chip 仍挂在缝的**中点**（竖版下 x 换成缝的 x，y 仍是两槽中心 y 的均值）
      expect(chipOf().style.left, 'chip x = 竖缝 x = 220').toBe('220px');
      expect(chipOf().style.top, 'chip y = 720（不变）').toBe('720px');
    } finally {
      clearGen3Persistent();     // 层注册表是模块态：本用例建的层不留到别的用例
      setFxViewSeat(null);
      restore();
    }
  });

  it('竖版变体写在 styles-net.css，且作用域是 `body.net-page`（层挂在 body 上，`.net-board` 不是祖先）', () => {
    // 取一条规则体（**先去注释**再比对声明，免得"注释长短"变成断言的隐性依赖 —— 第一版就是
    // 那样写的：`[\s\S]{0,200}` 被两条说明性注释撑爆，规则本身没问题的假红）。
    const net = read('ui/styles-net.css');
    const bodyOf = (sel: string): string => {
      const i = net.indexOf(sel + ' {');
      expect(i, `styles-net.css 里找不到 ${sel}（改名/删掉了？）`).toBeGreaterThanOrEqual(0);
      const start = net.indexOf('{', i);
      return stripComments(net.slice(start + 1, net.indexOf('}', start)));
    };
    // 竖版必须真的把"画线的那条边"从 border-top 换成 border-left（否则竖缝画不出来）
    const seamRule = bodyOf('body.net-page .g3sync-wrath0-seam.vert');
    expect(seamRule, '竖版中缝没有撤掉横版的 border-top（一条横线会留在缝上）').toContain('border-top: 0');
    expect(seamRule, '竖版中缝没有改成 border-left 画线 ⇒ 缝还是横的').toContain('border-left: 2px dashed');
    expect(seamRule, '竖版中缝没有把宽度收成 0（内联 left/top/height 才是几何来源）').toContain('width: 0');
    // 两个箭头都要换向（上端朝上 / 下端朝下）：判据是"竖版规则里，那条**有颜色的**边换成了上下边"
    const beforeRule = bodyOf('body.net-page .g3sync-wrath0-seam.vert::before');
    expect(beforeRule, '上端箭头仍是基础规则的「朝左三角」（border-right 7px 实色）—— 箭头方向无意义')
      .not.toMatch(/border-right: 7px solid rgba/);
    expect(beforeRule, '上端箭头没有改成朝上（border-bottom 实色 7px）')
      .toContain('border-bottom: 7px solid');
    const afterRule = bodyOf('body.net-page .g3sync-wrath0-seam.vert::after');
    expect(afterRule, '下端箭头仍是基础规则的「朝右三角」')
      .not.toMatch(/border-left: 7px solid rgba/);
    expect(afterRule, '下端箭头没有改成朝下（border-top 实色 7px）')
      .toContain('border-top: 7px solid');
    // 反空集合：这份表里**不许**出现裸 `.g3sync-wrath0-seam` 主体规则（那会连热座页一起改）
    expect(net, 'styles-net.css 里出现了不带 .net-page 作用域的裸中缝规则'
      + '（它会命中热座页的 body 级浮层 ⇒ 破坏热座零变化）')
      .not.toMatch(/(^|[\n},])\s*\.g3sync-wrath0-seam\s*[,{]/);
    // 基础规则（hot 侧那份表）一个数都没动
    expect(syncCss, 'styles-gen3-sync.css 的横版中缝被改了（它是热座页的样式）')
      .toMatch(/\.g3sync-wrath0-seam \{[\s\S]{0,160}border-top: 2px dashed rgba\(192, 57, 43, 0\.85\)/);
  });
});
