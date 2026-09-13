import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * 批次 D 守卫（控制权族 C1~C6 + 常驻层 + 贪婪1 硬币堆，2026-09-13）。
 *
 * 这一批的关键风险不是"CSS 没定义"（已有守卫），而是：
 *  ① **引擎事件没接上或语义发错**（控制权三种时刻分不清 / 判定失败无事件 / 免疫无反馈）；
 *  ② **常驻层的生效条件与引擎判定不一致**（例：愤怒0 只划除估值方一侧、惰性1 未要求未覆盖顶卡）；
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
    // 免疫事件 → 刚性7 护壁闪亮
    expect(effectsTs).toContain("case 'card:immune'");
    expect(effectsTs).toContain('flashRigidity7Guard(');
  });

  it('常驻层的生效条件与引擎判定一致（关键语义）', () => {
    // 愤怒0：**双方都算**（该线每张点数值 == M 的卡都不计入其拥有者总阈值）
    const wrath = controlTs.slice(controlTs.indexOf('export function syncWrath0Cull'), controlTs.indexOf('export function syncSloth0Bonus'));
    expect(wrath, '愤怒0 划除必须遍历双方链路').toMatch(/for \(const pid of \[0, 1\] as const\)[\s\S]{0,160}cardPointValue\(s, c\) === m/);
    // 怠惰0：相邻上方那张是怠惰牌（= 引擎 coveredBySloth）
    expect(controlTs).toMatch(/startsWith\('sloth-'\)/);
    // 惰性1：必须是未覆盖顶卡（= 引擎 lineBottomCommandsDisabled）
    const inertia = controlTs.slice(controlTs.indexOf('export function syncInertiaNullify'), controlTs.indexOf('export function syncRigidity7Guard'));
    expect(inertia).toMatch(/inertia-1' && c\.faceUp && isUncovered\(s, c\)/);
    // 刚性7：正面 + 未被覆盖 + 底框可用（= 引擎 rigidity7Immune）
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
    // ① 愤怒0 中缝：只跨两条能量槽（旧版跨双方槽位并集 = 整行宽，像怪线），并挂"最高档剔除"文字标
    const wrath = controlTs.slice(controlTs.indexOf('export function syncWrath0Cull'), controlTs.indexOf('export function syncSloth0Bonus'));
    expect(wrath, '中缝未按能量槽定位').toMatch(/const b0 = batteryNode\(0, line\)/);
    expect(wrath, '中缝未按能量槽定位').toMatch(/const b1 = batteryNode\(1, line\)/);
    expect(wrath, '中缝缺少文字标').toContain("'g3sync-wrath0-chip'");
    expect(syncCss, 'CSS 缺少 .g3sync-wrath0-chip').toContain('.g3sync-wrath0-chip');
    // ② 刚性7 迷宫纹：必须是"卡外一圈边框"（border-image 重复渐变），不能再是铺满卡面的网格
    const mazeBlock = syncCss.slice(syncCss.indexOf('.g3sync-rig7-maze {'), syncCss.indexOf('@keyframes g3-rig7-maze'));
    expect(mazeBlock, '迷宫纹未改为卡外边框（border-image）').toContain('border-image: repeating-linear-gradient');
    expect(mazeBlock, '迷宫纹仍在铺满卡面（background 重复渐变）').not.toMatch(/background:\s*\n?\s*repeating-linear-gradient/);
  });

  it('C4 判定特效已改为"贴能量槽的短对比条 + 文字标签"（旧版横铺整条链路 = 用户看到的怪粗线）', () => {
    expect(controlTs, 'C4 仍在整条 stack-slot 上铺条').not.toMatch(/bar\.style\.width = `\$\{r\.width \+ 12\}px`/);
    expect(controlTs).toContain("el('div', 'g3ctrl-caption'");
    expect(controlTs).toContain('g3ctrl-result');
    expect(controlTs).toMatch(/anchor\.bottom \+ 5/);
    expect(controlTs).toMatch(/Math\.min\(150,/);
    expect(controlTs).toContain("el('i', 'g3ctrl-lead-ring')");
    expect(controlTs).toContain('.stack-slot[data-player="${player}"][data-line="${line}"]');
    expect(controlTs, 'batteryNode 仍在用不存在的 .line-row 回退').not.toContain('.line-row');
    // 新 C4 所需的类必须在 CSS 里（含 caption/result/cmp/num/lead-ring）
    for (const cls of ['g3ctrl-caption', 'g3ctrl-result', 'g3ctrl-cmp', 'g3ctrl-cmp-own', 'g3ctrl-cmp-opp', 'g3ctrl-cmp-scan', 'g3ctrl-cmp-num', 'g3ctrl-lead-ring']) {
      expect(syncCss, `CSS 缺少 .${cls}`).toContain(`.${cls}`);
    }
  });

  it('C1/C2 落点锚定轨道实测位置 + 仅色欲驱动时才牵链条（2026-09-13 用户清单 #1/#8）', () => {
    // #1：控制组件卡在 .control-track 上滑动 → 落点必须按轨道矩形算（不再用视口 22%/78% 猜）
    expect(controlTs, '缺少按 .control-track 实测位置计算落点').toContain("document.querySelector<HTMLElement>('.control-track')");
    expect(controlTs).toContain('controlTrackSideX(');
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
