import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { GEN3_CARD_FX_COVER } from '../../src/ui/fx-gen3';

/**
 * 3代卡牌效果附加层守卫（批次 B，2026-09-13）。
 *
 * 同批次 A 的教训：JS 建了元素但 CSS 没定义 → 特效静默消失，tsc/vitest 都不报错。
 * 本文件锁四件事：
 *   ① 覆盖范围恰为"点名的触发点"（范围红线：不擅自扩到别的卡）；
 *   ② fx-gen3.ts 里每个 `g3-*` 类都在 styles-gen3-cards.css 有定义；
 *   ③ 四个事件分发点都真的接上了（否则模块写了也不会被调用）；
 *   ④ 基础动画未被替换（弃牌仍 playCutAt/playCut、删除仍 playShatterAt、翻转仍 playFlip、偏转仍 playShift）。
 */

const root = new URL('../../src/ui/', import.meta.url);
const css = readFileSync(fileURLToPath(new URL('styles-gen3-cards.css', root))).subarray(0, 4 * 1024 * 1024).toString('utf8');
const ts = readFileSync(fileURLToPath(new URL('fx-gen3.ts', root))).subarray(0, 4 * 1024 * 1024).toString('utf8');
const dispatcher = readFileSync(fileURLToPath(new URL('effects/index.ts', root))).subarray(0, 8 * 1024 * 1024).toString('utf8');

describe('3代卡牌效果附加层守卫（批次 B）', () => {
  it('覆盖范围 = 点名的触发点（设计稿 §4 已经你确认；不得擅自扩范围）', () => {
    expect(GEN3_CARD_FX_COVER.discard.sort()).toEqual(['fulcrum', 'greed', 'momentum', 'nova', 'sloth', 'wrath']);
    expect(GEN3_CARD_FX_COVER.delete.sort()).toEqual(['gluttony', 'nova', 'overwhelm', 'wrath']);

    expect(GEN3_CARD_FX_COVER.shift.sort()).toEqual(['flexibility', 'nova', 'pride']);
    // 批次 C：抽牌 / 反面打出 / 编译后
    expect(GEN3_CARD_FX_COVER.draw.sort()).toEqual(['fulcrum', 'gluttony']);
    // 2026-09-13 补：嫉妒3 反打分支（用户清单 #2「嫉妒3 翻面/反打特效缺失」）→ facedown 增 envy
    expect(GEN3_CARD_FX_COVER.facedown.sort()).toEqual(['envy', 'gluttony', 'inertia', 'overwhelm', 'rigidity']);
    expect(GEN3_CARD_FX_COVER.compiled.sort()).toEqual(['greed', 'momentum']);
    // 批次 E 补齐：惰性翻转（用户清单"惰性触发翻转"= I1 的 inertia-0 中 / inertia-2 中，批次 B 遗漏）
    expect(GEN3_CARD_FX_COVER.flip.sort()).toEqual(['ambush', 'envy', 'flexibility', 'inertia', 'pride', 'sloth', 'wrath']);
  });

  it('批次 C 三个分发点已接入（抽牌 / 反面打出 / 编译后）', () => {
    expect(dispatcher).toContain('gen3DrawFx(');
    expect(dispatcher).toContain("gen3FaceDownFx('deck'");
    expect(dispatcher).toContain("gen3FaceDownFx('hand'");
    expect(dispatcher).toContain('gen3CompiledFx(');
    // 抽牌必须挂在 card:drawn 早分支（在 uid/defId 守卫之前，因为该事件无 uid）
    const drawIdx = dispatcher.indexOf("if (e.type === 'card:drawn')");
    const guardIdx = dispatcher.indexOf('if (!payload?.uid || !payload.defId) return;');
    expect(drawIdx, 'card:drawn 分支缺失').toBeGreaterThan(0);
    expect(drawIdx, '3代抽牌必须在 uid/defId 守卫之前处理').toBeLessThan(guardIdx);
  });

  it('批次 C：基础动画仍由既有函数播放（反打飞行 / 编译横幅），未被替换', () => {
    expect(ts).toContain('api.playDeckPlay(');
    expect(ts).toContain('api.playHandPlay(');
    // 惰性按协议语法放慢基础飞行（其它协议保持默认 MOVE_MS）
    expect(ts).toMatch(/api\.playDeckPlay\(p, proto === 'inertia' \? 700 : undefined\)/);
    expect(dispatcher, 'playDeckPlay 的默认时长被改动（会影响 1/2 代）').toMatch(/function playDeckPlay\(payload: FxCardPayload, durationMs = MOVE_MS\)/);
    expect(dispatcher, 'playHandPlay 的默认时长被改动').toMatch(/function playHandPlay\(payload: FxCardPayload, durationMs = MOVE_MS\)/);
    // 编译横幅照旧（批次 C 只是并列叠加）
    expect(dispatcher).toMatch(/playCompile\(p\);[\s\S]{0,200}gen3CompiledFx\(/);
  });

  it('引擎为"编译后"特效提供了来源卡（贪婪1 契约印需要）', () => {
    const compileBody = readFileSync(fileURLToPath(new URL('../../src/core/rules/compile-body.ts', import.meta.url))).subarray(0, 1024 * 1024).toString('utf8');
    expect(compileBody).toContain('sourceDefId');
    expect(compileBody).toMatch(/opts\?\.sourceDefId/);
    const greed = readFileSync(fileURLToPath(new URL('../../src/core/effects/cards/greed.ts', import.meta.url))).subarray(0, 1024 * 1024).toString('utf8');
    expect(greed, '贪婪1 底未标记来源').toContain("sourceDefId: 'greed-1'");
  });

  it('fx-gen3.ts 用到的每个 g3-* 类都在 styles-gen3-cards.css 有定义', () => {
    const used = new Set<string>();
    for (const m of ts.matchAll(/['"`]([^'"`]*g3-[a-z0-9-]+[^'"`]*)['"`]/g)) {
      for (const token of m[1].split(/\s+/)) if (/^g3-[a-z0-9-]+$/.test(token)) used.add(token);
    }
    const missing = [...used].filter((cls) => !new RegExp(`\\.${cls}(\\s*[,{:. ]|\\s+[a-z])`).test(css));
    expect(missing, `以下类在 JS 中使用但 CSS 未定义（特效将不可见）：${missing.join(', ')}`).toEqual([]);
    expect(used.size).toBeGreaterThan(30); // 防"类名收集正则失效"导致本测试形同虚设
  });

  it('四个事件分发点均已接入（模块写了没接 = 永不播放）', () => {
    for (const fn of ['gen3DiscardFx', 'gen3DeleteFx', 'gen3FlipFx', 'gen3ShiftFx']) {
      expect(dispatcher, `effects/index.ts 未调用 ${fn}`).toContain(`${fn}(node`);
    }
    expect(dispatcher).toContain("case 'card:discarded'");
    expect(dispatcher).toContain("case 'card:deleted'");
    expect(dispatcher).toContain("case 'card:flipped'");
    expect(dispatcher).toContain("case 'card:shifted'");
  });

  it('基础动画未被替换：弃牌仍切割、删除仍碎裂、翻转仍翻面、偏转仍飞行', () => {
    // 3代分支内部必须调用这些基础动画（弃牌/删除是 PRE 延后调用，翻转/偏转是即时并列）
    expect(ts).toContain('api.playCutAt(');
    expect(ts).toContain('api.playCut(');
    expect(ts).toContain('api.playShatterAt(');
    expect(ts).toContain('api.playFlip(');
    expect(ts).toContain('api.playShift(');
  });

  it('怠惰翻转放慢不改动 1/2 代观感（playFlip 默认 350ms 不变）', () => {
    expect(dispatcher, 'playFlip 默认时长被改动（会影响 1/2 代所有翻转）').toMatch(/function playFlip\(node: HTMLElement, payload: FxCardPayload, durationMs = 350\)/);
    expect(ts, '怠惰未按协议语法放慢翻面').toContain('api.playFlip(node, p, 750)');
  });

  it('PRE 时序与设计稿一致（贪婪 420 / 怠惰 460 / 愤怒 380；暴食 600 / 压制 560）', () => {
    expect(ts).toContain('finish(420,'); // 贪婪
    expect(ts).toContain('finish(460,'); // 怠惰
    expect(ts).toContain('finish(380,'); // 愤怒
    expect(ts, '暴食粉碎吞噬未延后到 600ms').toMatch(/playShatterAt\(rect, orient, p\), 600\)/);
    expect(ts, '压制配重板未延后到 560ms').toMatch(/playShatterAt\(rect, orient, p\), 560\)/);
  });

  it('不使用 mask / @property（与既有特效骨架一致）', () => {
    const code = css.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(code.includes('mask:')).toBe(false);
    expect(code.includes('-webkit-mask')).toBe(false);
    expect(code.includes('@property')).toBe(false);
  });

  // ——— 2026-09-13 新增（用户清单 #2 的根因就是"覆盖表有、实现/接线没有"）：把覆盖表与实现绑死 ———

  /** 取某个导出函数的源码段（到下一个 export function 为止） */
  function bodyOf(fn: string): string {
    const from = ts.indexOf(`export function ${fn}`);
    if (from === -1) return '';
    const to = ts.indexOf('export function ', from + 10);
    return ts.slice(from, to === -1 ? undefined : to);
  }

  it('覆盖表的每一项都在对应函数里真的有实现（防"空头覆盖表"）', () => {
    // 历史 bug：`return:['greed']`（贪婪2 回手）与 `facedown` 里的 envy（嫉妒3 反打）都只是表里有、
    // 实现里没有 case → 引擎事件照发、UI 静默什么都不播，测试却全绿。
    const impl: Record<string, (body: string, proto: string) => boolean> = {
      discard: (b, p) => b.includes(`case '${p}'`),
      delete: (b, p) => b.includes(`case '${p}'`),
      flip: (b, p) => b.includes(`case '${p}'`),
      shift: (b, p) => b.includes(`case '${p}'`),
      facedown: (b, p) => b.includes(`case '${p}'`),
      return: (b, p) => b.includes(`case '${p}'`),
      // 抽牌是 if 分支（暴食）与默认段（支点标尺）而非 case
      draw: (b, p) => (p === 'gluttony' ? b.includes("'gluttony'") : b.includes('g3-ruler')),
      // 编译后按来源卡 defId 判定，不按协议 case
      compiled: (b, p) => (p === 'greed' ? b.includes("'greed-1'") : b.includes("startsWith('momentum-')")),
    };
    const fns: [keyof typeof GEN3_CARD_FX_COVER, string][] = [
      ['discard', 'gen3DiscardFx'], ['delete', 'gen3DeleteFx'], ['flip', 'gen3FlipFx'], ['shift', 'gen3ShiftFx'],
      ['draw', 'gen3DrawFx'], ['facedown', 'gen3FaceDownFx'], ['compiled', 'gen3CompiledFx'], ['return', 'gen3ReturnFx'],
    ];
    for (const [key, fn] of fns) {
      const body = bodyOf(fn);
      expect(body, `fx-gen3.ts 缺少 ${fn}`).not.toBe('');
      for (const proto of GEN3_CARD_FX_COVER[key]) {
        expect(impl[key](body, proto), `${fn} 覆盖表列了 ${proto}，但函数内没有对应实现`).toBe(true);
      }
    }
  });

  it('每个导出的 gen3*Fx 都被 effects/index.ts 调用（防"写了没接线"）', () => {
    const exported = [...ts.matchAll(/export function (gen3\w+Fx)\(/g)].map((m) => m[1]);
    expect(exported.length, '导出的 gen3*Fx 数量异常').toBeGreaterThanOrEqual(9);
    for (const fn of exported) expect(dispatcher, `effects/index.ts 未调用 ${fn}`).toContain(`${fn}(`);
  });

  it('回手（贪婪2 底 R3）与打出瞬间（嫉妒4 E4）两个新分发点已接入', () => {
    // 回手：gen3ReturnFx 必须在water 分支**之前**（否则永远轮不到色欲之外的 3 代回手）
    const retIdx = dispatcher.indexOf("case 'card:returned'");
    expect(retIdx, "分发器缺少 case 'card:returned'").toBeGreaterThan(0);
    expect(dispatcher).toContain('gen3ReturnFx(');
    expect(dispatcher.indexOf('gen3ReturnFx(', retIdx)).toBeLessThan(dispatcher.indexOf("payload.triggerProtocol === 'water'", retIdx));
    // 打出瞬间：此前分发器完全没有 card:played 分支
    expect(dispatcher).toContain("case 'card:played'");
    expect(dispatcher).toContain('gen3PlayFx(');
    // 引擎侧修复：删除事件必须回填 line（新星0「整线删除」按线中心连锁 + 收尾临界环依赖它）
    const resolveSrc = readFileSync(fileURLToPath(new URL('../../src/core/effects/resolve.ts', import.meta.url))).subarray(0, 4 * 1024 * 1024).toString('utf8');
    expect(resolveSrc, 'card:deleted 未回填 line（新星0 整线删除排序/收尾环会失效）').toMatch(/emitCardEvent\(s, 'card:deleted', card, \{\s*line,/);
  });

  it('无 uid/defId 的事件必须在分发器守卫之前处理（1988 覆盖审计抓出的"整条特效静默不播"）', () => {
    // deck:discarded（惰性4 整摞沙化）没有 uid/defId —— 若排在 `if (!payload?.uid || !payload.defId) return;`
    // 之后，它的 case 永远不可达（本轮审计前就是这样，I2 后半 100% 不播）。
    const guardIdx = dispatcher.indexOf('if (!payload?.uid || !payload.defId) return;');
    const deckIdx = dispatcher.indexOf("if (e.type === 'deck:discarded')");
    expect(guardIdx, '分发器缺少 uid/defId 守卫').toBeGreaterThan(0);
    expect(deckIdx, 'deck:discarded 未在守卫之前提前处理（case 将不可达）').toBeGreaterThan(0);
    expect(deckIdx, 'deck:discarded 处理位置仍在 uid/defId 守卫之后').toBeLessThan(guardIdx);
    expect(dispatcher).toContain('gen3DeckDiscardFx(');
    // 同类：card:drawn 也在守卫之前（无 uid）——锁住这条约定
    expect(dispatcher.indexOf("if (e.type === 'card:drawn')")).toBeLessThan(guardIdx);
  });

  it('三个"整条点名特效静默不播"的载荷缺口已补（覆盖审计 2.1/2.2/2.3）', () => {
    const swap = readFileSync(fileURLToPath(new URL('../../src/ui/fx-gen3-swap.ts', import.meta.url))).subarray(0, 1024 * 1024).toString('utf8');
    const resolveSrc = readFileSync(fileURLToPath(new URL('../../src/core/effects/resolve.ts', import.meta.url))).subarray(0, 4 * 1024 * 1024).toString('utf8');
    const compileBody = readFileSync(fileURLToPath(new URL('../../src/core/rules/compile-body.ts', import.meta.url))).subarray(0, 1024 * 1024).toString('utf8');
    const greedSrc = readFileSync(fileURLToPath(new URL('../../src/core/effects/cards/greed.ts', import.meta.url))).subarray(0, 1024 * 1024).toString('utf8');
    // ① 支点3/柔性3：rearrangeProtocolSlots 必须能带 sourceDefId，且 resolve 的效果路径要传
    expect(swap).toContain("startsWith('fulcrum-')");
    const rearrange = readFileSync(fileURLToPath(new URL('../../src/core/actions/rearrange.ts', import.meta.url))).subarray(0, 1024 * 1024).toString('utf8');
    expect(rearrange, 'rearrangeProtocolSlots 未接收 sourceDefId 参数').toMatch(/rearrangeProtocolSlots\([\s\S]{0,160}sourceDefId\?: string/);
    expect(rearrange).toMatch(/payload: \{ player: target, a, b, sourceDefId \}/);
    expect(resolveSrc, '效果重排未把 sourceDefId 传下去').toMatch(/rearrangeProtocolSlots\(s, target, op\.a, op\.b, pe\.sourceDefId\)/);
    // ② 贪婪1：line:compiled 必须带 sourceUid（硬币堆 R2④ + 契约印起点）
    expect(compileBody, 'executeCompileBody opts 缺 sourceUid').toMatch(/sourceDefId\?: string; sourceUid\?: string/);
    expect(compileBody).toMatch(/sourceUid: opts\?\.sourceUid/);
    expect(greedSrc, '贪婪1 未把自身 uid 作为 sourceUid 传入').toMatch(/sourceDefId: 'greed-1', sourceUid: ctx\.card\.uid/);
    // ③ 两个"按 defId 判定"的 UI 分支现在能拿到 triggerDefId（支点4 at-four / 同化1 刷新光泽）
    expect(resolveSrc, 'draw op 的 card:drawn 未带 triggerDefId').toMatch(/count: op\.count, triggerProtocol: pe\.sourceDefId\.split\('-'\)\[0\], triggerDefId: pe\.sourceDefId/);
    // ④ gen3FlipFx 与其它 gen3*Fx 一样有覆盖门控（防"表里有、case 忘了写"）
    expect(ts).toMatch(/GEN3_CARD_FX_COVER\.flip\.includes\(protocol\)/);
  });

  it('触发被结算 / 偏转落地两个新分发点已接入（用户 2026-09-13 裁决）', () => {
    // E2① 嫉妒1 底「卡面玉青镜面斜掠」：引擎新增 card:trigger-resolved（结算前发、卡还在原位）
    expect(dispatcher).toContain("case 'card:trigger-resolved'");
    expect(dispatcher).toContain('gen3TriggerFx(');
    expect(ts, 'gen3TriggerFx 未做点名门控（应只做 envy-1）').toMatch(/export function gen3TriggerFx[\s\S]{0,400}p\.defId !== 'envy-1'/);
    const gameSrc = readFileSync(fileURLToPath(new URL('../../src/core/game.ts', import.meta.url))).subarray(0, 1024 * 1024).toString('utf8');
    const triggerIdx = gameSrc.indexOf('resolveTrigger(s, t, { topCommand: t.top });');
    const resolvedIdx = gameSrc.indexOf('emitTriggerResolved(s, t, kind);');
    expect(triggerIdx, 'engine 缺少 resolve-trigger 的 resolveTrigger 调用').toBeGreaterThan(0);
    expect(resolvedIdx, '引擎未在 resolve-trigger 里发 card:trigger-resolved').toBeGreaterThan(triggerIdx);
    // 通用落地反馈：card:landed 此前无人消费，现在必须先按 owner/line 定位槽（DOM 还在起点）
    expect(dispatcher).toContain("case 'card:landed'");
    expect(dispatcher).toContain('gen3LandFx(');
    expect(ts, 'gen3LandFx 未优先按目标槽定位').toMatch(/slotRectOf\(p\) \?\? \(node \? geom\(node\)/);
    for (const cls of ['g3-trigger-layer', 'g3-envy1-sheen', 'g3-envy1-rim', 'g3-envy1-chip', 'g3-land-layer', 'g3-land-ring', 'g3-land-dust', 'g3-land-flash']) {
      expect(new RegExp(`\\.${cls}(\\s*[,{:. ]|\\s+[a-z])`).test(css), `CSS 缺少 .${cls}`).toBe(true);
    }
  });
});
