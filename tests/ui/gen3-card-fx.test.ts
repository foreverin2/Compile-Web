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
    expect(GEN3_CARD_FX_COVER.flip.sort()).toEqual(['ambush', 'envy', 'flexibility', 'pride', 'sloth', 'wrath']);
    expect(GEN3_CARD_FX_COVER.shift.sort()).toEqual(['flexibility', 'nova', 'pride']);
    // 批次 C：抽牌 / 反面打出 / 编译后
    expect(GEN3_CARD_FX_COVER.draw.sort()).toEqual(['fulcrum', 'gluttony']);
    expect(GEN3_CARD_FX_COVER.facedown.sort()).toEqual(['gluttony', 'inertia', 'overwhelm', 'rigidity']);
    expect(GEN3_CARD_FX_COVER.compiled.sort()).toEqual(['greed', 'momentum']);
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
    expect(ts, '暴食粉碎吞噬未延后到 600ms').toMatch(/playShatterAt\(rect, cw, ccw, p\), 600\)/);
    expect(ts, '压制配重板未延后到 560ms').toMatch(/playShatterAt\(rect, cw, ccw, p\), 560\)/);
  });

  it('不使用 mask / @property（与既有特效骨架一致）', () => {
    const code = css.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(code.includes('mask:')).toBe(false);
    expect(code.includes('-webkit-mask')).toBe(false);
    expect(code.includes('@property')).toBe(false);
  });
});
