import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { hooksOfCategory } from '../../src/ui/fx-dom-contract';

/**
 * G2 Task 3 守卫：远程对战页渲染器 `src/ui/render-net.ts`（源码文本守卫，**无 jsdom**）。
 *
 * ⚠️ 这些断言的**固有限度**必须记住（计划附录 A.4-3 已披露，本项目历史上多次因此误判"已验收"）：
 *   - 它们只能证明「某个 token 出现在**非注释的源码文本**里」；
 *   - 证明不了运行时真的把属性写在节点上、值是否与状态一致、节点在 FX 读取那一刻是否存在；
 *   - 证明不了 DOM 的**真实顺序**（见第 6 条的代理断言）。
 * 19 条 A 类钩子的真实验证只能靠用户在 5173 上做 ≥20 个点名特效抽查（计划「用户验收」第 3 项）。
 */

const root = new URL('../../src/ui/', import.meta.url);
const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, root))).subarray(0, 8 * 1024 * 1024).toString('utf8');

/**
 * 与 `tests/ui/fx-dom-contract.test.ts` 同口径的「判别子串」推导（probe 优先，退回自动推导）。
 *
 * 这里**故意**照抄契约测试里 `rendererProvides` 的 token 规则，而不是手抄一份 A 类钩子清单：
 * 手抄清单会与契约数据漂移，而契约数据才是「谁必须满足本契约」的唯一出处。
 * 用 `hooksOfCategory('A')` 直接取清单，新增 A 类钩子时本守卫自动跟上。
 */
function tokensOf(hook: string, probe?: readonly string[]): string[] {
  if (probe) return [...probe];
  if (hook.startsWith('[')) return [/^\[([a-z-]+)/.exec(hook)?.[1] ?? hook];
  const head = hook.split('[')[0];
  const parts = head.split('.').filter(Boolean);
  if (head.startsWith('.')) return [parts[0] ?? hook];
  if (parts.length >= 2) return [parts[1]];
  return [parts[0] ?? hook];
}

/** `data-*` 的产出形式 `dataset.<camelCase>`（渲染器用 `node.dataset.x = …` **写**属性） */
function datasetFormOf(attrToken: string): string | null {
  const m = /^data-[a-z-]+$/.exec(attrToken);
  if (!m) return null;
  const camel = m[0].slice('data-'.length).replace(/-([a-z])/g, (_all, c: string) => c.toUpperCase());
  return `dataset.${camel}`;
}

/**
 * 去注释：本文件的两条"不得出现"断言必须看去注释后的源码。
 *
 * 起因与契约测试同源：`expect(src).not.toContain('renderBoard(')` 这类否定断言，若注释里
 * 恰好写着「本页不调用 renderBoard(」就会被**误判为违规**（假红）；而肯定断言又会被注释满足
 * （假绿）。这里用与 `fx-dom-contract.test.ts` 同一套字符扫描（不用正则：字符串里的 `//`
 * 会被误吃）。注释内容替换为等长空白，行号保持不变。
 *
 * 已知局限（照抄契约测试的披露，不在本轮修）：模板串 `${}` 插值里的注释不被删（假绿方向）、
 * 正则字面量里含未转义 `//` 会截断该行（假红方向）；本文件扫的两个源文件当前零命中。
 */
function stripComments(src: string): string {
  const out: string[] = new Array(src.length);
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (c === '/' && n === '/') {
      while (i < src.length && src[i] !== '\n') { out[i] = ' '; i += 1; }
      continue;
    }
    if (c === '/' && n === '*') {
      out[i] = '/'; out[i + 1] = '*'; i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) {
        out[i] = src[i] === '\n' ? '\n' : ' ';
        i += 1;
      }
      if (i < src.length) { out[i] = '*'; out[i + 1] = '/'; i += 2; }
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      const quote = c;
      out[i] = c; i += 1;
      while (i < src.length) {
        const ch = src[i];
        out[i] = ch;
        i += 1;
        if (ch === '\\') { if (i < src.length) { out[i] = src[i]; i += 1; } continue; }
        if (ch === quote) break;
      }
      continue;
    }
    out[i] = c; i += 1;
  }
  return out.join('');
}

/**
 * 源码与"去注释源码"都在**取用时**才读，且**不缓存**：文件缺失时给一条清楚的存在性断言失败，
 * 而不是模块作用域 ENOENT 让整个测试文件变成 `Tests no tests`。
 * （`tests/ui/fx-dom-contract.test.ts` 的 `rendererSources` 正是模块作用域读的 —— 所以
 * 「先建文件、再登记进 RENDERERS」是硬顺序约束，本文件刻意不重复那个坑。）
 */
const netSource = (): string => {
  try { return read('render-net.ts'); } catch { return ''; }
};
const netCode = (): string => stripComments(netSource());

describe('G2 · 远程对战页渲染器（render-net.ts 源码守卫）', () => {
  it('1. 文件存在且导出 renderNetBoard / resetNetUiState', () => {
    const src = netSource();
    expect(src.length, 'src/ui/render-net.ts 不存在或为空（先建文件，再登记进 RENDERERS）').toBeGreaterThan(0);
    expect(stripComments(src)).toContain('export function renderNetBoard');
    expect(stripComments(src)).toContain('export function resetNetUiState');
  });

  it('2. 产出全部 A 类钩子的判别 token（直接取契约清单，不手抄）', () => {
    const code = netCode();
    const missing: string[] = [];
    const aHooks = hooksOfCategory('A');
    // 反空集合：清单为空则下面恒真（读起来像"已验收"，其实什么都没查）
    expect(aHooks.length, 'A 类钩子清单为空（契约数据出问题？）').toBeGreaterThan(0);
    for (const h of aHooks) {
      for (const t of tokensOf(h.hook, h.probe)) {
        const alt = datasetFormOf(t);
        // 与契约守卫 rendererProvides 同规则：字面量命中，或命中 `dataset.<camel>`
        const hit = code.includes(t)
          || (alt !== null && new RegExp(`${alt.replace(/\./g, '\\.')}(?![A-Za-z0-9_$])`).test(code));
        if (!hit) missing.push(`${h.hook} 的 token ${t}（也可写 ${alt ?? '—'}）`);
      }
    }
    expect(missing, `远程页缺少以下 A 类 token（源码文本层面，运行时仍需实机抽查）：\n${missing.join('\n')}`).toEqual([]);
  });

  it('3. 不产出热座专属的 ±90° 朝向类，但产出 rot-180', () => {
    // 判据用**带引号的字面量**：注释里写 `.rot-cw`（不带引号）不算产出
    const code = netCode();
    expect(code).not.toMatch(/['"]rot-cw['"]/);
    expect(code).not.toMatch(/['"]rot-ccw['"]/);
    expect(code).toContain('rot-180');
  });

  it('4. 不得用 s.turnPlayer 冒充"自己"；"自己"必须来自 viewSeat', () => {
    const code = netCode();
    expect(code, "远程页的\"自己\"必须来自 viewSeat，不能用 turnPlayer 当座位")
      .not.toContain('s.turnPlayer ===');
    expect(code).toContain('viewSeat');
  });

  it('5. 两条 .hand 产出路径 + data-hand-count（对手手牌只显示数量时 FX 仍能按下标取到手牌区）', () => {
    const src = netSource();
    // 约束 5：对手手牌只渲染数量，但**必须仍产出** .hand[data-player] 占位节点 ——
    // 否则 effects/index.ts:849/942/1541/1590/1650 与 fx-gen2.ts:693/1316/1786 的
    // querySelectorAll('.hand')[player] 会取到 undefined（飞往错误坐标 / 静默跳过）。
    //
    // ⚠️ 判据的诚实边界：这里数的是**本文件**里 `'hand'` 这个带引号的类名字面量的出现次数。
    //    `renderHand` 是 import 进来的助手，它的 `el('div', 'hand' + …)` 在 render.ts 里，
    //    所以"N 次字面量"与"N 条 .hand 节点"之间只由"本文件调了几次 renderHand"联系着
    //    （下面 6. 用 `renderHand(s, 0 …` / `renderHand(s, 1 …` 两处字面量调用把它钉住）。
    //    真节点数只能靠运行时（verifyHooks 或 5173 实机抽查）。
    expect((src.match(/'hand'/g) ?? []).length, "必须有两处 'hand'：P0 与 P1 各一个手牌区")
      .toBeGreaterThanOrEqual(2);
    // 对手手牌张数写在**手牌节点本身**上（`renderHand` 的 count 分支 `setAttribute`），
    // 供 FX / 渲染器判断"这只是一个占位节点、里面没有 card"。
    // ⚠️ 这条必须去**真正的产出方**（render.ts，不是本文件）钉**真实调用形态**，而不是
    //    `expect(netCode()).toContain('data-hand-count')`：裸子串会被 `.hand-count-only` /
    //    注释 / 别的 dataset 键满足 —— 那种守卫在"属性名打错"时照样全绿
    //    （与 fx-orient.test.ts 第 3 条把裸子串换成产出表达式是同一类修正）。
    const renderSrc = read('render.ts');
    expect(renderSrc, 'render.ts 未把 data-hand-count 真的写到手牌节点上（只含子串不算）')
      .toMatch(/setAttribute\(\s*'data-hand-count'/);
    // 且这条产出**必须挂在 .hand 节点上**（不是随手写在一个不相干的元素上）：取 setAttribute
    // 之前的一段窗口，其中要能看见手牌节点的类名构造与该分支的判据。
    const at = renderSrc.search(/setAttribute\(\s*'data-hand-count'/);
    const window = renderSrc.slice(Math.max(0, at - 1200), at);
    expect(window, 'data-hand-count 的产出点不在 .hand 的数量占位分支里（产出位置可疑）')
      .toMatch(/el\(\s*'div',\s*'hand'/);
    expect(window, 'data-hand-count 的产出点不在 handVisibility === \'count\' 分支里')
      .toMatch(/handVisibility === 'count'/);
  });

  it('6. DOM 顺序约束（P0 手牌先建、P1 后建）—— 源码调用顺序的**代理**断言', () => {
    // ⚠️ 这条守卫证明的只是**源码里 renderHand 的调用顺序**，它是 DOM 顺序的**代理**：
    //    P0 的 .hand 先 build、P1 的后 build，且唯一的挂载点按同一顺序 append ⇒ 运行时
    //    querySelectorAll('.hand') 的 [0] 是 P0、[1] 是 P1。真正的运行时顺序只能靠实机验收
    //    （或 opts.verifyHooks 的 DOM 自查）—— 源码文本守卫无法证明 DOM 真的这样挂载。
    // 为什么必须恒定 [P0,P1]：FX 读手牌是**按下标**的（effects/index.ts:849/942/1541/1590/1650、
    //    :1703 一次取两手；fx-gen2.ts:693/1316/1786），而甲读法把「对手」放在上方带 ——
    //    viewSeat=0 时上带是 P1，若按视觉顺序自然挂载就得到 [P1,P0]，下标 0 会拿到**对手**的手牌，
    //    特效不报错、不跳过，而是把卡飞到对手手牌区（比 undefined 更难发现）。
    //    所以视觉归属由父容器上的座位类 .net-view-N 用 CSS order 决定，DOM 顺序恒定。
    const code = netCode();
    const i0 = code.indexOf('renderHand(s, 0');
    const i1 = code.indexOf('renderHand(s, 1');
    expect(i0, '找不到 renderHand(s, 0 …) 的调用（顺序断言失去意义）').toBeGreaterThanOrEqual(0);
    expect(i1, '找不到 renderHand(s, 1 …) 的调用（顺序断言失去意义）').toBeGreaterThanOrEqual(0);
    expect(i0, 'P0 的手牌必须在 P1 之前建出（DOM 顺序恒定为绝对玩家顺序）').toBeLessThan(i1);
    // 光有"建的顺序"还不够：两条手牌必须挂进**同一个父容器**，且挂载本身也按同一顺序。
    // 这条钉住 buildHands 里那两条相邻的 appendChild 语句（找不到它 = 挂载结构被改成了
    // 别处分散挂载，那时"先建 ⇒ 先出现"就不再成立，必须重新论证顺序）。
    expect(code, '找不到「同一父容器里先 append P0、再 append P1」的语句对（顺序保证的挂载点）')
      .toMatch(/appendChild\(buildP0Hand\([^)]*\)\);\s*hands\.appendChild\(buildP1Hand\([^)]*\)\);/);
    // 视觉归属必须是 CSS 的事：父容器带座位类，且样式表真的用 order 实现
    expect(code, '父容器未按座位加类（视觉归属应交给 CSS）').toContain('net-view-');
    const css = read('styles-net.css');
    expect(css, 'styles-net.css 未用 order 决定上下带归属').toMatch(/order\s*:/);
    expect(css, '上下带归属不得用 display:none —— 隐藏节点 getBoundingClientRect 全 0')
      .not.toMatch(/\.net-hands[^{]*\{[^}]*display:\s*none/);
  });

  it('7. 不得调用挡板（设计稿 §6.1 已删挡板）', () => {
    expect(netCode(), '远程页调用了 renderShield / bindShieldDrag（§6.1 已删挡板）')
      .not.toMatch(/\brenderShield\s*\(|\bbindShieldDrag\s*\(/);
  });

  it('8. 入口四件副作用齐全（与 renderApp 对齐，漏一个就会有时序 bug）', () => {
    const code = netCode();
    expect(code).toContain('no-anim');
    expect(code).toContain('syncCheckCacheChains(');
    expect(code).toContain('syncChainLayerPosition(');
    expect(code).toContain('onRendered?.()');
  });

  it('9. 共享选择态：render.ts 导出三个口，render-net.ts 复用 playToLine（不自己重写合法性/复位）', () => {
    const renderSrc = read('render.ts');
    expect(renderSrc).toContain('export function getHandSelection');
    expect(renderSrc).toContain('export function setHandSelection');
    expect(renderSrc).toContain('export function pruneSelection');
    expect(netCode(), '远程页未复用既有打牌路径 playToLine（自写一套会与合法性与复位语义发散）')
      .toContain('playToLine(');
  });

  it('10. 预览工具条是有条件的（真实联机不传 onPreviewChange → 完全不渲染）', () => {
    const code = netCode();
    expect(code).toContain('onPreviewChange');
    // 守卫形态：工具条渲染被 opts.onPreviewChange 的存在性判断包住
    expect(code, '预览工具条未被 opts.onPreviewChange 守卫住（真实联机会多出一条工具条）')
      .toMatch(/if\s*\(\s*opts\.onPreviewChange\s*\)/);
  });

  it('11. 不得调用 renderBoard / renderApp 本体（设计稿 §6.1：远程页必须另写；重渲染一律走 cb.rerender）', () => {
    const code = netCode();
    expect(code, '远程页调用了盘本体（§6.1 要求另写）').not.toMatch(/\brenderBoard\s*\(/);
    expect(code, '远程页调用了 renderApp（重渲染必须走 cb.rerender?.()）').not.toMatch(/\brenderApp\s*\(/);
  });
});
