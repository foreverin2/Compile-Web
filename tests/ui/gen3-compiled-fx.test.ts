import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ALL_PROTOCOLS_3 } from '../../src/data/cards3';
import { GEN3_PROTOCOLS } from '../../src/ui/compiled-gen3';
import { COMPILED_PROTOCOL_COLORS } from '../../src/ui/protocol-colors';

/**
 * 3代（批次 A）已编译协议特效守卫（2026-09-13）。
 *
 * 该类 bug 的历史教训：**JS 建了元素但 CSS 没定义对应类**（或类名拼错）时，
 * tsc/vitest 全绿、页面却"什么都没有"——排查成本极高。本测试用文本扫描把这条链锁死：
 *   ① compiled-gen3.ts 里出现的每个 `gen3-*` 类，styles-gen3.css 必须有对应规则；
 *   ② 15 套协议必须有：主题色、已编译外框、呼吸环、四角护边配色；
 *   ③ 15 个宿主容器不得被压成 0 尺寸（沿用 fx-css-guards 的教训）；
 *   ④ 每套协议必须至少有一个周期爆发调度（scheduleLoop）——否则只有静态装饰。
 */

const root = new URL('../../src/ui/', import.meta.url);
// 读取方式与 fx-css-guards 一致（本仓库 tsconfig 只含 vite/client 类型 → Buffer 侧仅暴露 subarray/toString）
const css = readFileSync(fileURLToPath(new URL('styles-gen3.css', root))).subarray(0, 4 * 1024 * 1024).toString('utf8');
const ts = readFileSync(fileURLToPath(new URL('compiled-gen3.ts', root))).subarray(0, 4 * 1024 * 1024).toString('utf8');

/** compiled-gen3.ts 中用到的全部 `gen3-*` 类名（含模板拼接的动态部分） */
function usedGen3Classes(): Set<string> {
  const out = new Set<string>();
  for (const m of ts.matchAll(/['"`]([^'"`]*gen3-[a-z0-9-]+[^'"`]*)['"`]/g)) {
    for (const token of m[1].split(/\s+/)) {
      if (/^gen3-[a-z0-9-]+$/.test(token)) out.add(token);
    }
  }
  // 模板串里的动态类：`gen3-pride-tier t${i}`（前缀已覆盖）、`gen3-rig-anchor ${pos}`、
  // `gen3-lust-claw c${i}` —— 逐个补上四角/三爪/三级的具体类
  return out;
}

describe('3代 已编译协议特效守卫（批次 A）', () => {
  it('3代协议清单齐全（15 套，与 cards3 数据一致）', () => {
    expect([...GEN3_PROTOCOLS].sort()).toEqual(ALL_PROTOCOLS_3.map((p) => p.defId).sort());
    expect(GEN3_PROTOCOLS).toHaveLength(15);
  });

  it('15 套协议均有主题色（不再回退中性紫）', () => {
    for (const pid of GEN3_PROTOCOLS) {
      expect(COMPILED_PROTOCOL_COLORS[pid], `${pid} 缺少主题色`).toBeTruthy();
      expect(COMPILED_PROTOCOL_COLORS[pid]).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it('15 套协议均有：已编译外框 + 呼吸环 + 四角护边配色', () => {
    for (const pid of GEN3_PROTOCOLS) {
      expect(css, `${pid} 缺少 .protocol.compiled-fx-${pid} 外框规则`).toContain(`.protocol.compiled-fx-${pid}`);
      expect(css, `${pid} 缺少 .compiled-ring-${pid} 呼吸环规则`).toContain(`.compiled-ring-${pid}`);
      expect(css, `${pid} 缺少 .compiled-${pid}-corner 护边配色`).toContain(`.compiled-${pid}-corner`);
    }
  });

  it('compiled-gen3.ts 用到的每个 gen3-* 类都在 styles-gen3.css 有定义', () => {
    const missing: string[] = [];
    for (const cls of usedGen3Classes()) {
      // 规则可写成 .cls{...}（本文件统一风格；选择器带后缀时不额外判定）
      if (!new RegExp(`\\.${cls}(\\s*[,{:.]|\\s+[a-z])`).test(css)) missing.push(cls);
    }
    expect(missing, `以下类在 JS 中使用但 CSS 未定义（特效将不可见）：${missing.join(', ')}`).toEqual([]);
  });

  it('15 个宿主容器铺满卡面且不被压成 0 尺寸', () => {
    for (const pid of GEN3_PROTOCOLS) {
      const hostCls = `gen3-${pid === 'gluttony' ? 'glut' : pid === 'pride' ? 'pride' : pid === 'ambush' ? 'amb' : pid === 'fulcrum' ? 'ful' : pid === 'overwhelm' ? 'ovw' : pid === 'momentum' ? 'mom' : pid === 'inertia' ? 'ine' : pid === 'rigidity' ? 'rig' : pid === 'flexibility' ? 'flx' : pid}-host`;
      const hostRules = css.match(new RegExp(`\\.${hostCls}[^{]*\\{[^}]*\\}`, 'g')) ?? [];
      expect(hostRules.length, `${hostCls} 未定义`).toBeGreaterThan(0);
      const joined = hostRules.join('\n');
      expect(/position\s*:\s*absolute/.test(joined), `${hostCls} 未绝对定位`).toBe(true);
      expect(/inset\s*:\s*0/.test(joined), `${hostCls} 未铺满卡面（inset:0）`).toBe(true);
      expect(/(width|height)\s*:\s*0(px)?\s*[;}]/.test(joined), `${hostCls} 被压成 0 尺寸`).toBe(false);
    }
  });

  it('每套协议都有周期爆发（scheduleLoop），不是纯静态装饰', () => {
    const calls = ts.match(/api\.scheduleLoop\(layer, defId/g) ?? [];
    expect(calls.length, 'scheduleLoop 调用数应等于协议数（每协议一组周期爆发）').toBe(15);
  });

  it('不使用 mask / @property（与既有特效骨架一致，避免兼容性坑）', () => {
    const code = css.replace(/\/\*[\s\S]*?\*\//g, ''); // 去掉注释，只查真实声明
    expect(code.includes('mask:'), 'styles-gen3.css 出现 mask（既有骨架刻意不用）').toBe(false);
    expect(code.includes('-webkit-mask'), 'styles-gen3.css 出现 -webkit-mask').toBe(false);
    expect(code.includes('@property'), 'styles-gen3.css 出现 @property').toBe(false);
  });
});
