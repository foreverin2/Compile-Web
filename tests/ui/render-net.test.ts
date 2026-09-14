import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
// ⚠️ `lightningcss` 是 **vite 的传递依赖**（`node_modules/vite/package.json` 里声明），不在本仓
// `package.json` 的 devDependencies 里。**这是有意接受的**（G2 Task 3F2 · §4-2，复评实测确认）：
//   1. 缺失时失败是**响亮的** —— 静态 import 不存在的包 → `Failed Suites` / `Tests no tests` / exit 1，
//      不会被吞、不会静默跳过整条守卫；
//   2. 为什么**不**动 `package.json`：本仓禁止 `npm install`（零运行时依赖纪律），手写一条声明会让
//      `package-lock.json` 失同步（lockfile 里它挂在 vite 下面）；
//   3. 为什么**不**改成 `await import()` + try/catch：那会把"包没了"变成**静默跳过**（守卫读起来仍绿），
//      正是本项目反复出现的失效模式 —— 宁可响亮地红。
//   风险与对策：若 vite 将来弃用 lightningcss，本文件会立刻红（而不是静默失去 CSS 校验），
//   那时再决定"新增显式依赖"或"换一个等价解析器"。
import { transform } from 'lightningcss';
import { hooksOfCategory, RENDERERS } from '../../src/ui/fx-dom-contract';
import { NET_PAGE_HOOKS, verifyPageHooks } from '../../src/ui/render-net';
import { stripComments, stripArrayDecl } from './source-text';

/**
 * G2 Task 3/3F 守卫：远程对战页渲染器 `src/ui/render-net.ts`（源码文本守卫，**无 jsdom**）。
 *
 * ⚠️ 这些断言的**固有限度**必须记住（计划附录 A.4-3 已披露，本项目历史上多次因此误判"已验收"）：
 *   - 它们只能证明「某个 token 出现在**非注释的源码文本**里」；
 *   - 证明不了运行时真的把属性写在节点上、值是否与状态一致、节点在 FX 读取那一刻是否存在；
 *   - 证明不了 DOM 的**真实顺序**（见第 6 条的代理断言）与节点的**真实布局盒**。
 * 19 条 A 类钩子与两条运行时断言（`.hand` 顺序 / 对手卡 `.rot-180`）的真实验证靠
 * `opts.verifyHooks`（`verifyPageHooks`）与用户在 5173 上的 ≥20 个点名特效抽查。
 *
 * ## G2 Task 3F 对三条守卫可信度的修正（每条都在报告里有变异实测）
 * 1. **C-3 / I-3**：`NET_PAGE_HOOKS` 表里逐字写着 19 条 hook 字符串，而"本文件提供全部 A 类钩子"
 *    的判据是"本文件源码里出现 token" → **表满足了断言本身**（变异：删掉 `renderStackSlot(` /
 *    `renderProtocolCell(` 的真实挂载，契约 20 + 本文件 11 全绿）。现在 `netCode()` 一律
 *    **先 `stripArrayDecl` 剔除表体**，判据换成「助手调用链」（第 2 条）。表本身只剩"契约镜像"
 *    职责，并对它加了两条机检（第 2b 条）。
 * 2. **I-2 的镜像修正**在 `tests/ui/fx-orient.test.ts`（读去注释源码 + 180° 分支与类名配对）。
 * 3. **I-1 / C-4 / M-3** 各加了机检（第 15/16/17 条）。
 *
 * ## G2 Task 3F2 新增的三条（复评 F-1 / F-2）
 * - **第 1b 条**：`renderNetBoard` 必须**第一件事**清空 root（清空早于任何 `root.appendChild`，
 *   且不在条件/循环里）。原缺陷（`aba8944` 就有）：入口不清 root → 接线第一帧叠一份棋盘、
 *   每次 `rerender` 线性叠加（兄弟入口 `renderDraft`/`renderBoard`/`home.ts` 全都清）。
 * - **第 17 条**：`verifyPageHooks` 的**期望数量表**必须能从源码结构**推导出来**
 *   （`3 线 × 2 侧 = 6` 等），并钉住两侧 `renderSideRow` 的**真实挂载**。
 * - **第 18/19 条**：把合成 DOM 桩喂给 `verifyPageHooks()` **真跑一遍** —— 缺了对手侧的树必须报 ✗
 *   并说出 `数量 …，期望 …`。没有这两条，`expected` 表在无 jsdom 下只是一句声明。
 */

const root = new URL('../../src/ui/', import.meta.url);
const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, root))).subarray(0, 8 * 1024 * 1024).toString('utf8');

/**
 * 源码与"去注释、且**剔除 NET_PAGE_HOOKS 表体**"的源码都在**取用时**才读，且**不缓存**：
 * 文件缺失时给一条清楚的存在性断言失败，而不是模块作用域 ENOENT 让整个测试文件变成
 * `Tests no tests`。（`tests/ui/fx-dom-contract.test.ts` 的 `rendererSources` 正是模块作用域读的
 * —— 所以「先建文件、再登记进 RENDERERS」是硬顺序约束，本文件刻意不重复那个坑。）
 *
 * ⚠️ `stripComments` / `stripArrayDecl` 来自 `./source-text`（**两边共用同一实现**，
 * 不在这里复制 —— 拷贝一旦漂移，一边的断言就会因为"注释没被删"而假绿，见该文件头注）。
 */
const netSource = (): string => {
  try { return read('render-net.ts'); } catch { return ''; }
};
/** 判据面：去注释 + **剔除钩子数据表**（表不得充当任何"提供/产出"断言的证据） */
const netCode = (): string => stripArrayDecl(stripComments(netSource()), 'NET_PAGE_HOOKS');

/** 取 `from` 之后、`to` 之前的源码片段（本文件的函数都是顶层 `function` 声明，够用） */
function between(code: string, from: string, to: string): string {
  const i = code.indexOf(from);
  const j = code.indexOf(to);
  expect(i, `源码里找不到 ${from}（结构被改动？）`).toBeGreaterThanOrEqual(0);
  expect(j, `源码里找不到 ${to}（结构被改动？）`).toBeGreaterThan(i);
  return code.slice(i, j);
}

/** 去注释后的 CSS 规则（本文件没有嵌套规则/@media，`选择器 { 体 }` 的简版解析够用） */
function cssRules(css: string): Array<{ selector: string; body: string }> {
  const out: Array<{ selector: string; body: string }> = [];
  const src = stripComments(css);
  const re = /([^{}]+)\{([^{}]*)\}/g;
  for (let m = re.exec(src); m !== null; m = re.exec(src)) {
    out.push({ selector: m[1].trim(), body: m[2] });
  }
  return out;
}

/**
 * 把选择器交给 lightningcss 解析（仓库已装的真 CSS 解析器，vite 的依赖）。
 * 本仓没有 `@types/node`（禁止 npm install），所以不能用 `Buffer` —— lightningcss 的
 * `code` 类型就是 `Uint8Array`，用 `TextEncoder` 造一个即可。
 */
function parseSelector(selector: string): void {
  transform({ filename: 'probe.css', code: new TextEncoder().encode(`${selector} { color: red }`), minify: false });
}

/**
 * 1. 本页的**容器节点**（信息条 / 带 / 行 / 手牌条）不得被任何 `transform`/`rotate` 作用 ——
 *    C-4 的原始形态是 `.net-lane-band .net-side-foe { transform: rotate(180deg) }`：
 *    它与卡自身的 `.rot-180` 叠加成 0°（对手的卡其实**正立**），并把整行**水平镜像**
 *    （"覆盖者在右"的屏幕假设被翻转 → 被覆盖卡可见区被压成 6px）。
 *    卡级 hover（`.stack .card:hover`）的 transform 是**允许**的：它的最后一个复合选择器是
 *    `.card`，不在容器名单里。
 */
const CONTAINER_LAST = [
  'net-board', 'net-grid', 'net-strip', 'net-strip-foe', 'net-lane-band', 'net-side',
  'net-side-self', 'net-side-foe', 'net-hands', 'net-hand-side', 'net-hand-side-self', 'net-hand-side-foe',
];
function rotatedContainers(css: string): string[] {
  return cssRules(css)
    .filter((r) => {
      const last = (r.selector.split(/\s+/).pop() ?? '').split(':')[0];
      const isContainer = CONTAINER_LAST.some((c) => new RegExp(`^\\.${c}(?:\\.|\\[|$)`).test(last));
      if (!isContainer) return false;
      return /rotate\(/.test(r.body) || /transform:\s*(?!none)/.test(r.body);
    })
    .map((r) => r.selector);
}

/** 2. 承载/就是两条 `.hand` 的节点不得用 `display:none`（隐藏节点 `getBoundingClientRect()` 全 0） */
function hiddenHandRules(css: string): string[] {
  return cssRules(css)
    .filter((r) => /(net-hands|net-hand-side|\.hand\b)/.test(r.selector) && /display:\s*none/.test(r.body))
    .map((r) => r.selector);
}

/**
 * 助手调用结果**确实流进 DOM**的文本形态：`appendChild(<call>` 或 `= <call>`（绑定后再挂载）。
 * 只查 `code.includes(call)` 会漏掉"调用还在、结果被丢掉"（`void renderStackSlot(…)`）——
 * 那正是评审 Critical C-3 的变异形态，页面同样没有链路槽。
 */
function mountedFormOf(call: string): RegExp {
  return new RegExp(`(?:appendChild\\(\\s*|=\\s*)${call.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
}

describe('G2 · 远程对战页渲染器（render-net.ts 源码守卫）', () => {
  it('1. 文件存在且导出 renderNetBoard / resetNetUiState', () => {
    const src = netSource();
    expect(src.length, 'src/ui/render-net.ts 不存在或为空（先建文件，再登记进 RENDERERS）').toBeGreaterThan(0);
    expect(stripComments(src)).toContain('export function renderNetBoard');
    expect(stripComments(src)).toContain('export function resetNetUiState');
  });

  /**
   * F-1（复评 Critical，`aba8944` 起的既有缺陷）：`renderNetBoard` 必须**自己清空 root**。
   *
   * 为什么：`renderApp` 的契约是"渲染器自己清空并重建 root 内容"，兄弟入口全都清
   * （`render.ts:4472` renderDraft / `:4637` renderBoard / `home.ts:65`），而 Task 4 计划的
   * 单行 `rerender()` dispatch **不做清理**。少了这一行 → 从热座/草稿切进远程预览时**叠一屏**，
   * 之后每次 `cb.rerender?.()` 再叠一份（线性增长），而 FX 全走 `querySelector`（取首个）
   * → 特效全部打在旧副本上。运行时断言 1 会把它报成"4 条 .hand"（用户可见），但那时页面已经叠坏。
   *
   * ⚠️ 判据不是"文件里有 `textContent = ''`"（那种写法会被**别的函数**或注释满足 ——
   * `renderPreviewToolbar` 的 `.net-verify-note` 写入就含 `textContent`）。这里做三件事：
   *   ① 定位到 `renderNetBoard` 的**函数体**；
   *   ② 断言它出现在**任何** `root.appendChild(` 之前（顺序）；
   *   ③ 断言清空语句之前的前缀里**没有** `if/for/while/switch`（不得被包进条件或循环，
   *      也不得藏在 `if (x) return;` 之后）。
   */
  it('1b. F-1：renderNetBoard 必须**第一件事**清空 root（早于任何 root.appendChild，且无条件）', () => {
    const code = netCode();
    const entryAt = code.indexOf('export function renderNetBoard');
    expect(entryAt, '找不到 export function renderNetBoard').toBeGreaterThanOrEqual(0);
    const entry = code.slice(entryAt);
    const bodyStart = entry.indexOf('{');
    expect(bodyStart, '找不到 renderNetBoard 的函数体起始 `{`').toBeGreaterThan(0);
    const body = entry.slice(bodyStart + 1);

    const iClear = body.indexOf("root.textContent = ''");
    const iAppend = body.indexOf('root.appendChild(');
    expect(iClear, 'renderNetBoard 里没有 `root.textContent = \'\'`（入口不清空 root → 每次渲染叠一份棋盘）')
      .toBeGreaterThanOrEqual(0);
    expect(iAppend, 'renderNetBoard 里找不到 root.appendChild(（结构被改？）').toBeGreaterThan(0);
    expect(iClear, 'F-1：清空 root 必须发生在**任何** root.appendChild 之前')
      .toBeLessThan(iAppend);
    // ③ 不得条件化 / 循环化 / 被 early-return 绕过
    const prefix = body.slice(0, iClear);
    expect(prefix, 'F-1：清空 root 不得被包进条件或循环（也不得排在 early return 之后）')
      .not.toMatch(/\b(if|for|while|switch)\s*\(/);
    // 与兄弟入口同形（这条把"这是全仓约定"写进守卫，防止有人"顺手"只在这里去掉）。
    // 判据写成两种等价清空形式都接受（`textContent = ''` / `replaceChildren()`）—— 不绑定写法。
    const renderSrc = stripComments(read('render.ts'));
    expect(renderSrc, 'render.ts 的 renderBoard/renderDraft 也不再清空 root（全仓约定被改？）')
      .toMatch(/root\.(?:textContent = ''|replaceChildren\()/);
  });

  /**
   * C-3 的核心修正：判据从「本文件出现钩子 token」换成「本文件的**真实代码里调用了产出这些钩子的
   * 共享助手**」。为什么这是唯一诚实的判据：
   *   - 钩子的产出表达式（`el('div', 'stack-slot p1')` / `dataset.player` …）都在 `render.ts` 里，
   *     本页的贡献是"把这些助手挂进渲染链路"；
   *   - 本页源码文本里出现的 hook 字符串（`NET_PAGE_HOOKS`）**不是产出**，它只是契约镜像，
   *     所以扫描前先整段剔除（否则断言自我满足 —— 变异：删掉真实挂载仍全绿）；
   *   - **拼写**由 `render.ts` 自己那条注册项负责（同一个契约守卫逐条查它），本页不重复管。
   */
  it('2. A 类钩子经**共享助手调用链**产出（表体剔除后逐条查真实调用 —— C-3）', () => {
    const code = netCode();
    const missing: string[] = [];
    const nonExempt = NET_PAGE_HOOKS.filter((h) => h.exempt === undefined);
    // 反空集合：表为空 / 全部豁免则下面恒真（读起来像"已验收"，其实什么都没查）
    expect(nonExempt.length, 'NET_PAGE_HOOKS 的非豁免项为 0（判据失效）').toBeGreaterThan(0);
    for (const h of nonExempt) {
      expect(h.call.length, `${h.hook} 的 call 为空（等于关闭这条断言）`).toBeGreaterThan(0);
      for (const c of h.call) {
        if (!code.includes(c)) missing.push(`${h.hook}：找不到助手调用 ${JSON.stringify(c)}（本页应把该助手挂进渲染链路）`);
        // ⚠️ 只查「调用字面量存在」是不够的：评审 Critical C-3 的变异形态恰恰是
        //    「调用还在、**结果被丢掉**」（`void renderStackSlot(…)`）—— 页面同样没有链路槽。
        //    所以再要求调用结果**被挂载或被绑定**（`appendChild(<call>` / `= <call>`），
        //    二者都是"这个节点/元素确实流进了 DOM"的必要条件。
        //    诚实边界：这仍是**文本代理**（`if (x) renderStackSlot(` 这种写法也会命中），
        //    真正的产出证据是 verifyHooks 的运行时自查与 5173 实机抽查。
        if (!mountedFormOf(c).test(code)) {
          missing.push(`${h.hook}：${JSON.stringify(c)} 的返回值既没被 appendChild 也没被绑定（结果被丢掉 = 节点没进 DOM）`);
        }
      }
    }
    expect(missing, `以下 A 类钩子的产出助手调用不在本文件（剔除表体后）的真实代码里：\n${missing.join('\n')}`).toEqual([]);

    // 契约基准面：这 11 条助手调用是本页"把钩子挂进链路"的全部入口（与 fx-dom-contract.test.ts
    // 的 ASSISTANT_CALLS 同口径）。少一条就说明某类节点整类不再产出。
    for (const c of [
      'renderStackSlot(', 'renderProtocolCell(', 'renderDeck(', 'renderTrash(',
      'renderHand(s, 0', 'renderHand(s, 1', 'renderControlModule(', 'renderPlayerInfo(',
      'renderRefreshButton(', 'choiceBar(', 'buildChoicePickOverlay(',
    ]) {
      expect(code, `本页缺少 A 类钩子的产出助手调用 ${c}`).toContain(c);
    }
  });

  it('2b. NET_PAGE_HOOKS 是契约 A 类清单的**逐字镜像**（防止表漂移 + 防 probeSelector/call 缺项）', () => {
    // 镜子必须逐字相等：否则表会变成"与契约各改各的散文"，而人读它时以为它代表契约。
    const aHooks = hooksOfCategory('A').map((h) => h.hook).slice().sort();
    const tableHooks = NET_PAGE_HOOKS.map((h) => h.hook).slice().sort();
    expect(tableHooks, 'NET_PAGE_HOOKS 与契约 A 类清单不一致（表已漂移）').toEqual(aHooks);
    expect(NET_PAGE_HOOKS.length, 'A 类钩子条数变了？请同步本守卫与报告').toBe(19);
    // 豁免项必须与 RENDERERS 里 render-net.ts 的 exempt 逐字一致（两处都是"有意不提供"的声明）
    const netRenderer = RENDERERS.find((r) => r.file === 'render-net.ts');
    expect(netRenderer, 'render-net.ts 未登记进 RENDERERS').toBeTruthy();
    expect(NET_PAGE_HOOKS.filter((h) => h.exempt !== undefined).map((h) => h.hook).sort())
      .toEqual([...(netRenderer?.exempt ?? [])].slice().sort());
    // 两条**运行时**断言要查的东西必须在表/代码里可读（它们的一部分就是"探测选择器"）
    expect(netCode(), '缺少对手卡 .rot-180 的运行时自检（C-4 之后对手卡的倒置只能靠它机检）')
      .toMatch(/\.card\.rot-180/);
  });

  it('3. 不产出热座专属的 ±90° 朝向类；对手 180° 必须是**传给共享助手的实参**（C-3 变异 A-2 的杀手）', () => {
    // 判据用**带引号的字面量**：注释里写 `.rot-cw`（不带引号）不算产出
    const code = netCode();
    expect(code).not.toMatch(/['"]rot-cw['"]/);
    expect(code).not.toMatch(/['"]rot-ccw['"]/);
    // ⚠️ 这里**不再**用 `expect(code).toContain('rot-180')` 当作"对手朝上"的证据：
    //    本页连引号类名字面量都不产出（映射集中在 render.ts 的分支链），那句断言只会被
    //    "别处的某个字符串"满足（G2 Task 3 里它由死代码 `orientClassOf` 满足 —— 评审 M-1）。
    //    真正承重的是**调用形态**：把 180 作为 orient 实参交给两个共享助手。
    //    ⚠️ 它真正生效还依赖 render.ts 的 180 分支仍在产出（`orient === 180 → 'rot-180'`）——
    //    那一条由 tests/ui/fx-orient.test.ts 第 3 条（去注释源码 + 条件与类名配对）守住。
    expect(code, '链路槽的对手朝向未按座位传 orient（硬约束 2 变成"完全不倒置"）')
      .toMatch(/orient:\s*isSelfSeat\s*\?\s*0\s*:\s*180/);
    expect(code, '协议格的对手朝向未按座位传 orient')
      .toMatch(/renderProtocolCell\(\s*s,\s*player,\s*line,\s*isSelfSeat\s*\?\s*0\s*:\s*180\s*\)/);
  });

  it('4. 不得用 s.turnPlayer 冒充"自己"；"自己"必须来自 viewSeat', () => {
    const code = netCode();
    expect(code, "远程页的\"自己\"必须来自 viewSeat，不能用 turnPlayer 当座位")
      .not.toContain('s.turnPlayer ===');
    expect(code).toContain('viewSeat');
  });

  /**
   * I-3 的修正：原来这条数的是**裸源码里 `'hand'` 带引号字面量的出现次数**，
   * 而它实际命中 3 条注释 + `data-net-hand-slots='hand'` 这个"为可机检而存在"的标记 ——
   * 对产出零判别力（删掉真正的产出路径它毫无反应）。现在钉**真实调用形态**：
   * `renderHand(s, 0 …)` / `renderHand(s, 1 …)` 各一次（本页只有两个手牌区），
   * 且 `data-hand-count` 的产出点必须在 `render.ts` 的 `handVisibility === 'count'` 分支里。
   * 那两个"为测试而写的"标记与注释已随本修正一并删除（N-2）。
   */
  it('5. 两条 .hand 产出路径（renderHand 恰好两次真实调用）+ data-hand-count 的真实产出形态', () => {
    const code = netCode();
    const calls = code.match(/renderHand\(/g) ?? [];
    expect(calls.length, `本页必须**恰好**调两次 renderHand（P0 一个、P1 一个），实际 ${calls.length} 次`)
      .toBe(2);
    expect(code, '找不到 renderHand(s, 0 … 的调用').toContain('renderHand(s, 0');
    expect(code, '找不到 renderHand(s, 1 … 的调用').toContain('renderHand(s, 1');
    // 生产代码里不得再有"只为满足子串断言而存在"的字符串（I-3 / N-2）
    expect(code, 'data-net-hand-slots 是为可机检而写的产物，必须删掉（它证明不了任何产出）')
      .not.toContain('netHandSlots');

    // 对手手牌张数写在**手牌节点本身**上（`renderHand` 的 count 分支 `setAttribute`），
    // 这条必须去**真正的产出方**（render.ts，不是本文件）钉**真实调用形态**，而不是裸子串：
    // 裸子串会被 `.hand-count-only` / 注释 / 别的 dataset 键满足 —— 属性名打错时照样全绿。
    const renderSrc = read('render.ts');
    expect(renderSrc, 'render.ts 未把 data-hand-count 真的写到手牌节点上（只含子串不算）')
      .toMatch(/setAttribute\(\s*'data-hand-count'/);
    const at = renderSrc.search(/setAttribute\(\s*'data-hand-count'/);
    const window = renderSrc.slice(Math.max(0, at - 1200), at);
    expect(window, 'data-hand-count 的产出点不在 .hand 的数量占位分支里（产出位置可疑）')
      .toMatch(/el\(\s*'div',\s*'hand'/);
    expect(window, 'data-hand-count 的产出点不在 handVisibility === \'count\' 分支里')
      .toMatch(/handVisibility === 'count'/);
  });

  it('6. DOM 顺序约束（P0 先建、P1 后建 + 同一父容器相邻挂载）—— 源码调用顺序的**代理**断言', () => {
    // ⚠️ 这条守卫证明的只是**源码里 renderHand 的调用顺序**，它是 DOM 顺序的**代理**：
    //    P0 的 .hand 先 build、P1 的后 build，且唯一的挂载点按同一顺序 append ⇒ 运行时
    //    querySelectorAll('.hand') 的 [0] 是 P0、[1] 是 P1。真正的运行时顺序只能靠实机验收
    //    （或 `opts.verifyHooks` 的运行时断言 1）—— 源码文本守卫无法证明 DOM 真的这样挂载。
    // 为什么必须恒定 [P0,P1]：FX 读手牌是**按下标**的（fx-gen2.ts:693/1316/1786、
    //    effects/index.ts:849/942/1541/1590/1650；:1703 一次取两手），而甲读法把「对手」放在
    //    上方带 —— viewSeat=0 时上带是 P1，若按视觉顺序自然挂载就得到 [P1,P0]，下标 0 会拿到
    //    **对手**的手牌，特效不报错、不跳过，而是把卡飞到对手手牌区（比 undefined 更难发现）。
    const code = netCode();
    const i0 = code.indexOf('renderHand(s, 0');
    const i1 = code.indexOf('renderHand(s, 1');
    expect(i0, '找不到 renderHand(s, 0 …) 的调用（顺序断言失去意义）').toBeGreaterThanOrEqual(0);
    expect(i1, '找不到 renderHand(s, 1 …) 的调用（顺序断言失去意义）').toBeGreaterThanOrEqual(0);
    expect(i0, 'P0 的手牌必须在 P1 之前建出（DOM 顺序恒定为绝对玩家顺序）').toBeLessThan(i1);
    // 光有"建的顺序"还不够：两条手牌必须挂进**同一个父容器**，且挂载本身也按同一顺序。
    expect(code, '找不到「同一父容器里先 append P0、再 append P1」的语句对（顺序保证的挂载点）')
      .toMatch(/appendChild\(buildP0Hand\([^)]*\)\);\s*hands\.appendChild\(buildP1Hand\([^)]*\)\);/);
    // 视觉归属必须是 CSS 的事：父容器带座位类，且样式表真的用 order 实现
    expect(code, '父容器未按座位加类（视觉归属应交给 CSS）').toContain('net-view-');
    const css = read('styles-net.css');
    expect(css, 'styles-net.css 未用 order 决定上下带归属').toMatch(/order\s*:/);
    // display:none 的检查**扩到所有承载/就是手牌的节点**（评审变异 D-1：只查 `.net-hands` 时
    // `.net-hand-side-foe { display:none }` 仍然全绿，而它正是"rect 全 0"的真实危险形态）。
    // 这里用"对合成 CSS 的阳性/阴性对照"证明仪器本身有判别力，再对真实样式表跑一遍。
    expect(hiddenHandRules('.net-hand-side-foe { display: none; }')).toEqual(['.net-hand-side-foe']);
    expect(hiddenHandRules('.net-hands .hand { display: none; }')).toEqual(['.net-hands .hand']);
    expect(hiddenHandRules('.net-hands { display: grid; }')).toEqual([]);
    expect(hiddenHandRules(css), '承载/就是两条 .hand 的节点不得用 display:none（隐藏节点 rect 全 0）')
      .toEqual([]);
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

  /**
   * I-4：`choicePromptId` 是 `render.ts` 里"选择模式"的**全局闸门**
   * （`:5583` 选择模式禁止拖拽打牌、`:1658` 手牌单击选中）。远程页曾经只写自己的
   * `netChoicePromptId`，从不写共享的那个 → 两处守卫**永不生效**；C-1 修好后候选手牌会拿到
   * `.choice-target`（指针事件恢复），于是 prompt 挂起时**仍可拖牌打出**。
   * 这里钉"每帧都正确设置/清除"的调用形态（含"没有 pending effect"的分支）。
   */
  it('9. 共享选择态：render.ts 导出三个口 + 远程页复用 playToLine + 正确写/清 choicePromptId', () => {
    const renderSrc = read('render.ts');
    expect(renderSrc).toContain('export function getHandSelection');
    expect(renderSrc).toContain('export function setHandSelection');
    expect(renderSrc).toContain('export function pruneSelection');
    const code = netCode();
    expect(code, '远程页未复用既有打牌路径 playToLine（自写一套会与合法性与复位语义发散）')
      .toContain('playToLine(');
    // ── I-4：promptId 的每条路径都要在**对应分支**里（"文件里某处出现过"不算 —— 那样
    //    把某一条分支改坏时，别的分支仍能让断言通过。变异实测：G-2 最初就是绿的。）──
    // ⚠️ 切片标记必须用**代码**（注释已被 stripComments 抹掉，用注释文本会 indexOf = -1）。
    const head = between(code, 'function renderChoiceUi', 'const who = prompt.chooser');
    // ①「没有 pending 选择」分支 → 必须清空 promptId + 已选（否则 render.ts 的两处守卫
    //    （`:5583` 禁止拖拽、`:1658` 手牌单击）会在 prompt 结束后**永久锁死**打牌）
    const noPrompt = between(head, 'if (!prompt || !top) {', 'if (netChoicePromptId !== top.id) {');
    expect(noPrompt, '无 pending 选择时未清空 promptId（render.ts 的选择模式守卫会永久锁住打牌）')
      .toMatch(/setChoiceSelection\(\s*\[\],\s*null\s*\)/);
    // ②「prompt 活动」分支 → 换 prompt 时重开选择并写下 promptId；未换时每帧重申
    const active = head.slice(head.indexOf('if (netChoicePromptId !== top.id) {'));
    expect(active, '换 prompt 时未把 promptId 写进共享选择态（render.ts 的选择模式守门将失效）')
      .toMatch(/setChoiceSelection\(\s*\[\],\s*top\.id\s*\)/);
    expect(active, 'prompt 存在时未每帧重申 promptId（选择模式守门必须在每一帧都成立）')
      .toMatch(/setChoiceSelection\(\s*getChoiceSelection\(\),\s*top\.id\s*\)/);
    // ③ 应答完成后的各条路径（跳过 / 确认 / 线槽点击 / 动作按钮）也必须清空
    //    计数含①：当前实现共 5 处；新增应答路径时应同步 +1（失败消息会说明）。
    expect((code.match(/setChoiceSelection\(\s*\[\],\s*null\s*\)/g) ?? []).length,
      '应答完成后清空选择态的调用点太少（跳过/确认/线槽/动作按钮每条路径都要清）')
      .toBeGreaterThanOrEqual(5);
  });

  it('10. 预览工具条是有条件的（真实联机不传 onPreviewChange → 完全不渲染）', () => {
    const code = netCode();
    expect(code).toContain('onPreviewChange');
    expect(code, '预览工具条未被 opts.onPreviewChange 守卫住（真实联机会多出一条工具条）')
      .toMatch(/if\s*\(\s*opts\.onPreviewChange\s*\)/);
    // 运行时自查结果必须显示在**工具条**上（不能只在 console）
    expect(code, '自查结果只写在控制台？真实用户看不到').toMatch(/\.net-verify-note/);
  });

  it('11. 不得调用 renderBoard / renderApp 本体（设计稿 §6.1：远程页必须另写；重渲染一律走 cb.rerender）', () => {
    const code = netCode();
    expect(code, '远程页调用了盘本体（§6.1 要求另写）').not.toMatch(/\brenderBoard\s*\(/);
    expect(code, '远程页调用了 renderApp（重渲染必须走 cb.rerender?.()）').not.toMatch(/\brenderApp\s*\(/);
  });

  /**
   * C-1：`renderChoiceUi` 必须在 `wrap.appendChild(grid)` **之后**调用。
   *
   * 它内部三处 `wrap.querySelectorAll(...)` 都只对"已挂在 wrap 下的节点"生效：
   *  - `select` 分支 → `.card[data-uid]`（场上卡 + 手牌卡都在 grid 里）
   *  - `select-line` 分支 → `.net-lane-band`（`data-line` 写在带节点上）
   * 曾经它在 grid 之前跑 → `select-line` 拿到 0 条带、没有可点目标，而 `choiceBar` 对
   * select-line **没有确认按钮** → 非 optional 的 select-line 永久无法应答（对局卡死）。
   *
   * ⚠️ 这是**源码顺序的代理**断言：它证明调用顺序对，证明不了运行时真的查到节点
   * （那要看 `verifyHooks` 的 A 类钩子自查 + 5173 实机）。但它对"把这一行搬回去"这个
   * 具体回归形态是有效的（变异实测红）。
   */
  it('12. C-1：renderChoiceUi 必须晚于 wrap.appendChild(grid)（select-line 才能拿到候选带）', () => {
    const code = netCode();
    const iGrid = code.indexOf('wrap.appendChild(grid)');
    const iChoice = code.indexOf('renderChoiceUi(wrap');
    expect(iGrid, '找不到 wrap.appendChild(grid)（grid 挂载点被改？）').toBeGreaterThanOrEqual(0);
    expect(iChoice, '找不到 renderChoiceUi(wrap, …) 的调用').toBeGreaterThanOrEqual(0);
    expect(iGrid, 'renderChoiceUi 跑在 grid 挂进 wrap 之前 → select-line 找不到任何 .net-lane-band（死锁）')
      .toBeLessThan(iChoice);
    // 它必须查 `wrap`（= grid 的祖先），不能改成查 grid 之外的东西
    expect(code).toMatch(/wrap\.querySelectorAll<HTMLElement>\('\.net-lane-band'\)/);
  });

  /**
   * C-2：`verifyPageHooks` 一执行就抛 `SyntaxError`（`scope.querySelector(h.hook)`，
   * 而 `.trash-pile.p1/.p2` 不是合法 CSS 选择器），没有 try/catch → 异常从 `renderNetBoard`
   * 逃逸到宿主。修法三层，这里逐层机检：
   *  1. **探测选择器与展示写法分离**（`probeSelector`），且每个都是**合法 CSS**（下一条用
   *     仓库已装的 lightningcss —— 真正的 CSS 解析器 —— 实测）；
   *  2. 逐条 `try/catch`，失败收集后一次性报告（不当场抛）；
   *  3. `renderNetBoard` 那道调用外面再包一层兜底 try/catch。
   */
  it('13. C-2：每个 probeSelector 都是合法 CSS（lightningcss 实测）+ 展示写法绝不当作选择器', () => {
    // 阳性对照：仪器（lightningcss）对评审实测的那条非法选择器必须报错 —— 证明它有牙齿
    expect(() => parseSelector('.trash-pile.p1/.p2')).toThrow();
    const bad: string[] = [];
    for (const h of NET_PAGE_HOOKS) {
      if (h.probeSelector === undefined) continue;
      try {
        parseSelector(h.probeSelector);
      } catch (err) {
        bad.push(`${h.hook} → ${JSON.stringify(h.probeSelector)}：${String(err)}`);
      }
      // 展示写法里可能有多段/复合写法（如 `.p1/.p2`），任何 `/` 都不该出现在选择器里
      expect(h.probeSelector, `${h.hook} 的 probeSelector 含 '/'（复合展示写法不能当选择器）`).not.toContain('/');
    }
    expect(bad, `以下 probeSelector 不是合法 CSS（querySelector 会抛 SyntaxError）：\n${bad.join('\n')}`).toEqual([]);
    // 反空集合 + 覆盖面：非豁免钩子**每条**都要有探测选择器（少一条 = 少查一条）
    const nonExempt = NET_PAGE_HOOKS.filter((h) => h.exempt === undefined);
    expect(nonExempt.filter((h) => h.probeSelector === undefined).map((h) => h.hook),
      '以下非豁免钩子缺少 probeSelector（运行时自查会漏掉它们）').toEqual([]);
    // 展示写法必须原样保留在 `hook` 里（它是契约镜像，不是选择器）
    expect(NET_PAGE_HOOKS.map((h) => h.hook)).toContain('.trash-pile.p1/.p2');
  });

  it('13b. C-2：verifyPageHooks 逐条 try/catch、绝不用展示写法查询、外层还有兜底', () => {
    const code = netCode();
    // 展示用 hook 字符串**绝不能**交给 querySelector（C-2 的根因）
    expect(code, '源码里出现了 querySelector(h.hook) —— 展示写法不是合法选择器（C-2 的根因）')
      .not.toContain('querySelector(h.hook)');
    const body = between(code, 'function verifyPageHooks', 'function renderPreviewToolbar');
    expect((body.match(/try\s*\{/g) ?? []).length,
      'verifyPageHooks 必须逐条 try/catch（将来写错选择器不得让整页崩）').toBeGreaterThanOrEqual(3);
    expect((body.match(/\}\s*catch\s*\(/g) ?? []).length,
      'catch 数必须与 try 数一致（漏一个就等于没有防御）').toBeGreaterThanOrEqual(3);
    // 非法/缺失选择器必须成为**具名失败**，而不是静默
    expect(body, '非法选择器没有变成一条具名失败').toContain('非法');
    // 两条特有运行时断言必须真的在里面（顺序 + 对手 180°）
    expect(body, '缺少"手牌 DOM 顺序 [P0,P1]"的运行时断言').toContain("dataset.player");
    expect(body, '缺少"对手侧场上卡各自带 .rot-180"的运行时断言').toContain('.net-side-foe .card.rot-180');
    expect(body, '缺少"对手侧协议图各自带 .rot-180"的运行时断言').toContain('.net-side-foe .protocol-img.rot-180');
    // 外层兜底：任何未预料的异常都不得从 renderNetBoard 逃逸（"诊断不得把渲染搞崩"）
    const entry = code.slice(code.indexOf('export function renderNetBoard'));
    expect(entry, '调用 verifyPageHooks 的地方没有兜底 try/catch').toMatch(/try\s*\{\s*note\s*=\s*verifyPageHooks\(/);
  });

  /**
   * I-1：对手的**牌库/弃牌堆只保留一份**（顶部信息条），对手那一行只有手牌 + 一行小标签。
   * 为什么是承重的：FX 取牌库/弃牌堆全走 `querySelector`（**取首个**，如
   * effects/index.ts:215/435/483/1138/1323/2249、fx-gen2.ts:568/665/1123/…），两份 A 类节点
   * 会让特效飞向用户**没在看**的那一份 —— 不报错、不跳过，纯静默错位。
   */
  it('14. I-1：renderDeck/renderTrash 各只有一处调用；两个玩家各覆盖一次（互补不重复）', () => {
    const code = netCode();
    expect((code.match(/renderDeck\(/g) ?? []).length,
      'renderDeck( 必须**恰好一处**调用（两份 .deck[data-player] 会让取首个的 FX 静默错位）').toBe(1);
    expect((code.match(/renderTrash\(/g) ?? []).length,
      'renderTrash( 必须**恰好一处**调用（同上）').toBe(1);
    // 两处调用点：顶部对手条用 foe，自己那一行用 player（= viewSeat）→ 玩家集合互补
    expect(code, '对手信息条未渲染对手的牌库/弃牌堆').toContain('renderPiles(s, foe)');
    expect(code, '自己那一行未渲染自己的牌库/弃牌堆').toContain('renderPiles(s, player)');
    expect((code.match(/renderPiles\(s, /g) ?? []).length,
      'renderPiles 的调用点应恰好两处（对手条 + 自己行）').toBe(2);
    // 对手那一行（decorateHand 的非自己分支）不得再渲染 piles：唯一一处 renderPiles 必须在
    // `if (o.isSelf) {` 之后（否则对手行里又出现第二份）
    const decorate = between(code, 'function decorateHand', 'function buildP0Hand');
    expect((decorate.match(/renderPiles\(/g) ?? []).length, 'decorateHand 里只应有一处 renderPiles').toBe(1);
    expect(decorate.indexOf('renderPiles('), 'renderPiles 未落在 `if (o.isSelf)` 分支内（对手行会多一份）')
      .toBeGreaterThan(decorate.indexOf('if (o.isSelf) {'));
    // `.net-hand-side-foe` 必须在样式表里有规则（评审 I-1：原实现里它零规则、两份都可见）
    expect(read('styles-net.css'), '.net-hand-side-foe 在 CSS 里零规则（I-1：重复渲染因此完全可见）')
      .toMatch(/\.net-hand-side-foe\s*\{/);
  });

  /**
   * C-4：对手那一行整块的 `rotate(180deg)` 与卡自身的 `.rot-180` 叠加成 0°（对手的卡其实正立），
   * 并把该行水平镜像（"覆盖者在右"的屏幕假设被翻转）。修法是**删掉那一行**，对手的倒置只由
   * `.rot-180` 各自承担。判据是"本页**容器节点**的规则里不得有 transform/rotate"。
   */
  it('15. C-4：容器规则不得带 transform/rotate（对手的倒置只能来自卡/协议自身的 .rot-180）', () => {
    // 阳性对照（评审实测的原始形态）必须被抓到
    expect(rotatedContainers('.net-lane-band .net-side-foe { transform: rotate(180deg); }'))
      .toEqual(['.net-lane-band .net-side-foe']);
    // 阴性对照：卡级 hover 的 transform 是**允许**的（最后一个复合选择器是 .card，不是容器）
    expect(rotatedContainers('.net-lane-band .stack .card.rot-180:hover { transform: translateY(-18px) rotate(180deg); }'))
      .toEqual([]);
    const css = read('styles-net.css');
    expect(css, '样式表里找不到 .net-side-foe（对手行的规则被删光了？）').toContain('.net-side-foe');
    expect(rotatedContainers(css), '以下容器规则带了 transform/rotate —— 会与卡自身的 .rot-180 叠加抵消'
      + '（对手的卡变回正立）并水平镜像该行：').toEqual([]);
    // 卡级 180° 的悬停必须**带着旋转**一起 transform，否则鼠标一碰卡的 180° 就被抹掉
    expect(css, '对手卡的 hover 必须保留 rotate(180deg)（否则 hover 会把倒置抹掉）')
      .toMatch(/\.card\.rot-180:hover\s*\{[^}]*rotate\(180deg\)/);
  });

  /**
   * M-3：热座 `renderBoard` 的两个几何型点名特效（透彻牌库眼睛 / 幸运宣告骰子）曾经在远程页
   * 完全缺失（三个 choice-* 分支是重写的）。它们都用**契约钩子**定位（`.deck[data-player]` /
   * 源卡 `[data-uid]`），远程页的节点都在，所以直接复用；但必须在 `root.appendChild(wrap)`
   * **之后**执行 —— 此前 `getBoundingClientRect()` 全 0，特效会静默不显示。
   */
  it('16. M-3：几何型 FX 走 deferredFx，且在 root.appendChild(wrap) 之后执行', () => {
    const code = netCode();
    expect(code, '未复用 startClarityDeckEye（透彻：从牌库中选择 的古埃及眼睛在远程页不播）')
      .toContain('startClarityDeckEye(');
    expect(code, '未复用 startLuckDiceFx（luck-0/3 宣告的骰子在远程页不播）').toContain('startLuckDiceFx(');
    expect(code).toMatch(/deferredFx\.push\(/);
    const entry = code.slice(code.indexOf('export function renderNetBoard'));
    const iMount = entry.indexOf('root.appendChild(wrap);');
    const iRun = entry.indexOf('for (const fn of deferredFx) fn();');
    expect(iMount, '找不到 root.appendChild(wrap)').toBeGreaterThanOrEqual(0);
    expect(iRun, '找不到 deferredFx 的执行点').toBeGreaterThanOrEqual(0);
    expect(iRun, '几何型 FX 在棋盘入 DOM 之前执行 → getBoundingClientRect() 全 0、特效静默不显示')
      .toBeGreaterThan(iMount);
    // 两个特效必须由**选择分支**触发（与热座同条件），而不是无条件播
    expect(code).toMatch(/prompt\.title\.startsWith\('透彻：从牌库中选择'\)/);
    expect(code).toMatch(/prompt\.title\.startsWith\('luck-0：宣告'\)/);
  });

  /**
   * F-2（复评 Important）：**计数盲区** —— 只查"存在"不查"个数"。
   *
   * 评审变异 R4：删掉 `band.appendChild(renderSideRow(s, foe, …))`（对手的 6 个 `.stack-slot`、
   * 6 个 `.protocol-cell`、6 个 `.battery` 全没）→ 契约 24 + 本文件 18 = **42/42 全绿**，
   * 而运行时自查也报 `自查 ✓`（自己侧每类仍各有一个）。
   *
   * 本条的职责：把 `verifyPageHooks` 的**期望数量表**从**源码结构推导出来**，而不是把数字再抄一遍。
   *   - 一帧 = `for (const line of [0, 1, 2])` 三条线 × `band.appendChild(renderSideRow(…))` 两侧；
   *   - 每侧的链路槽/协议格各 1 → `.stack-slot`/`.protocol-cell`/`.battery`/`.protocol`/
   *     `.protocol-holder`/`.protocol-img` = 3 × 2 = 6；
   *   - 牌库/弃牌堆来自 `renderPiles`（唯一调用点，两处挂载互补）→ 2；手牌来自 `renderHand(` → 2；
   *     控制轨来自 `renderControlModule(` → 1。
   * 这样"删掉一侧挂载"会同时打破 ①两个挂载字面量、②推导出的数量，而**数字本身也不可能被悄悄改小**
   * （表里少一个 `expected` 字段或改小数字都会在下面对比里报红）。
   */
  it('17. F-2：verifyPageHooks 的**期望数量表**必须与源码结构一致（无 jsdom 下的结构腿）', () => {
    const code = netCode();
    // ① 两侧 `renderSideRow` 的真实挂载（评审变异 R4 正是删掉了其中一条）
    expect(code, '对手侧的整行挂载不见了（对手 6 个 .stack-slot / 6 个 .protocol-cell 全没）')
      .toMatch(/band\.appendChild\(renderSideRow\(s,\s*foe,/);
    expect(code, '自己侧的整行挂载不见了').toMatch(/band\.appendChild\(renderSideRow\(s,\s*viewSeat,/);
    const sideMounts = (code.match(/band\.appendChild\(renderSideRow\(/g) ?? []).length;
    expect(sideMounts, 'renderSideRow 必须恰好挂载两次（对手 / 自己各一次）').toBe(2);
    // 三条线来自同一个循环（写死 `[0, 1, 2]`；改成别的长度必须同步改期望表）
    expect(code, '三条线必须由 `for (const line of [0, 1, 2] as Line[])` 产出').toMatch(/for \(const line of \[0, 1, 2\] as Line\[\]\)/);
    const LANES = 3;
    const perFrame = LANES * sideMounts;                       // 6
    const pilesCalls = (code.match(/renderPiles\(s, /g) ?? []).length;
    const handCalls = (code.match(/renderHand\(/g) ?? []).length;
    const controlCalls = (code.match(/renderControlModule\(/g) ?? []).length;
    expect(pilesCalls, 'renderPiles 的调用点应恰好两处（对手条 + 自己行）').toBe(2);
    expect(handCalls, 'renderHand 的调用点应恰好两处（P0 / P1）').toBe(2);
    expect(controlCalls, 'renderControlModule 的调用点应恰好一处').toBe(1);

    const expectOf = (hook: string): number | undefined => NET_PAGE_HOOKS.find((h) => h.hook === hook)?.expected;
    // ② 数量 = 结构推导值（不是抄一遍数字）
    for (const hook of [
      '.stack-slot[data-player][data-line]', '.protocol-cell[data-player][data-line]',
      '.protocol-img', '.protocol', '.protocol-holder', '.battery',
    ]) {
      expect(expectOf(hook), `${hook} 的 expected 必须等于 线数 × 侧数 = ${perFrame}`).toBe(perFrame);
    }
    for (const hook of ['.deck[data-player]', '.trash-pile[data-player]', '.trash-pile.p1/.p2']) {
      expect(expectOf(hook), `${hook} 的 expected 必须等于 renderPiles 的调用点数 = ${pilesCalls}`).toBe(pilesCalls);
    }
    for (const hook of ['.hand', '.hand[data-player]']) {
      expect(expectOf(hook), `${hook} 的 expected 必须等于 renderHand 的调用点数 = ${handCalls}`).toBe(handCalls);
    }
    for (const hook of ['.control-module', '.control-slider-img', '.control-track']) {
      expect(expectOf(hook), `${hook} 的 expected 必须等于 renderControlModule 的调用点数 = ${controlCalls}`).toBe(controlCalls);
    }
    // ③ 分类完备：每条非豁免钩子**要么**定数量、**要么**标状态相关（不许两头都不占）
    const classified = NET_PAGE_HOOKS.filter((h) => h.exempt === undefined);
    expect(classified.filter((h) => h.expected === undefined && h.stateDependent === undefined).map((h) => h.hook),
      '以下钩子既没定数量、也没标"状态相关"（自查会对它既不报错也不计数）').toEqual([]);
    // ④ 反之：状态相关钩子**不得**定数量（`.card`/`[data-uid]`/`img` 在空局面合法为 0，定了会稳定误报）
    expect(NET_PAGE_HOOKS.filter((h) => h.stateDependent !== undefined && h.expected !== undefined).map((h) => h.hook),
      '状态相关钩子被定了数量（空局面会稳定误报）').toEqual([]);
    // ⑤ 定数量的恰好是这 14 条（少一条或多一条都要在这里说清楚）
    expect(NET_PAGE_HOOKS.filter((h) => h.expected !== undefined).map((h) => h.hook).sort()).toEqual([
      '.battery', '.control-module', '.control-slider-img', '.control-track',
      '.deck[data-player]', '.hand', '.hand[data-player]',
      '.protocol', '.protocol-cell[data-player][data-line]', '.protocol-holder', '.protocol-img',
      '.stack-slot[data-player][data-line]', '.trash-pile.p1/.p2', '.trash-pile[data-player]',
    ].sort());
    // ⑥ `verifyPageHooks` 必须真的**用**这个字段（不是只声明）
    expect(code, 'verifyPageHooks 未使用 expected（计数判据被关掉）').toMatch(/const want = h\.expected;/);
    expect(code, 'verifyPageHooks 未把实际数量与期望数量对比').toMatch(/found !== want/);
    expect(code, 'verifyPageHooks 未把数量写进报告文本').toMatch(/数量 \$\{found\}，期望 \$\{want\}/);
  });

  /** 合成「一帧远程页」的选择器计数（`sides: 1` = 评审变异 R4：对手侧整行消失） */
  function syntheticPage(o: { sides?: number; foeInverted?: boolean } = {}): Record<string, number> {
    const sides = o.sides ?? 2;
    const perLine = 3 * sides;      // 每类"每线每侧各一个"
    const foeCards = sides === 2 ? 2 : 0;
    const foeProto = sides === 2 ? 3 : 0;
    const inv = o.foeInverted === false ? 0 : undefined;
    return {
      '.stack-slot[data-player][data-line]': perLine,
      '.protocol-cell[data-player][data-line]': perLine,
      '.protocol-img': perLine,
      '.protocol': perLine,
      '.protocol-holder': perLine,
      '.battery': perLine,
      '[data-uid]': 4,                                   // 状态相关：不计数
      '.trash-pile[data-player]': 2,
      '.trash-pile.p1, .trash-pile.p2': 2,
      '.deck[data-player]': 2,
      '.hand': 2,
      '.hand[data-player]': 2,
      '.card': 4,                                        // 状态相关：不计数
      img: 20,                                           // 状态相关：不计数
      '.control-module': 1,
      '.control-slider-img': 1,
      '.control-track': 1,
      '.net-side-foe .card': foeCards,
      '.net-side-foe .card.rot-180': inv ?? foeCards,
      '.net-side-foe .protocol-img': foeProto,
      '.net-side-foe .protocol-img.rot-180': inv ?? foeProto,
      '.net-side-self .card.rot-180, .net-side-self .card.rot-cw, .net-side-self .card.rot-ccw': 0,
    };
  }

  /**
   * 合成 DOM 桩：**只**实现 `verifyPageHooks` 用到的两个方法（无 jsdom）。
   *
   * ⚠️ 它证明的是「**计数逻辑本身有牙齿**」（缺了对手侧的合成树必须报 ✗ 并说出期望数量），
   * **不是**"真实 DOM 里有这些节点" —— 后者只能靠 `opts.verifyHooks` 在预览页真跑 +
   * 用户在 5173 上做点名特效抽查。它是"期望值表在无 jsdom 下也有牙齿"的第二条腿：
   * 第一条腿是第 17 条（数字从源码结构推导），这一条把 `verifyPageHooks` **真的执行一遍**。
   */
  function fakeScope(counts: Record<string, number>, handOrder: number[] = [0, 1]): HTMLElement {
    const listOf = (sel: string): Array<{ dataset: Record<string, string> }> => {
      const n = counts[sel] ?? 0;
      if (sel === '.hand') return handOrder.slice(0, n).map((p) => ({ dataset: { player: String(p) } }));
      return Array.from({ length: n }, () => ({ dataset: {} }));
    };
    return {
      querySelectorAll: (sel: string) => listOf(sel),
      querySelector: (sel: string) => listOf(sel)[0] ?? null,
    } as unknown as HTMLElement;
  }

  it('18. F-2：把合成 DOM 桩喂给 verifyPageHooks() 真跑 —— 正常 ✓ / 状态相关为空仍 ✓ / 非法选择器不抛', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    try {
      expect(verifyPageHooks(fakeScope(syntheticPage()))).toMatch(/^自查 ✓/);
      // 状态相关钩子为空（合法局面：手牌打空 + 场上空）→ 仍 ✓，只走 info 通道，不进失败计数
      const empty = syntheticPage();
      empty['.card'] = 0; empty['[data-uid]'] = 0; empty.img = 0;
      expect(verifyPageHooks(fakeScope(empty))).toMatch(/^自查 ✓/);
      expect(info, '状态相关钩子为空时应留下 info 记录（而不是静默）').toHaveBeenCalled();
      // C-2 回归：非法选择器（querySelectorAll 抛 SyntaxError）不得让函数抛异常，只报一条具名失败
      const boom = {
        querySelectorAll: () => { throw new SyntaxError("Unexpected token Delim('/')"); },
        querySelector: () => null,
      } as unknown as HTMLElement;
      let out = '';
      expect(() => { out = verifyPageHooks(boom); }, '非法选择器让 verifyPageHooks 抛异常（C-2 回归）').not.toThrow();
      expect(out).toContain('非法');
      expect(warn, '失败必须留下 console.warn 证据（不能只在返回值里）').toHaveBeenCalled();
    } finally {
      warn.mockRestore();
      info.mockRestore();
    }
  });

  it('19. F-2：缺对手侧整行 / 手牌顺序反了 / 对手卡没倒置 —— 运行时自查都必须报 ✗', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    try {
      // ① 评审变异 R4 的**运行时等价形态**：对手侧整行消失（每类只剩 3）
      const missingFoe = verifyPageHooks(fakeScope(syntheticPage({ sides: 1 })));
      expect(missingFoe, '缺了对手侧整行却报 ✓ —— 计数判据没生效（这就是 F-2）').toMatch(/^自查 ✗/);
      expect(missingFoe, '失败信息必须同时给出实际数量与期望数量').toContain('数量 3，期望 6');
      // ② `.hand` 顺序反了（[P1, P0]）→ 约束 7
      expect(verifyPageHooks(fakeScope(syntheticPage(), [1, 0])), '手牌顺序反了没报（FX 会飞错手牌区）')
        .toContain('约束 7');
      // ③ 对手卡没带 .rot-180 → 硬约束 2
      expect(verifyPageHooks(fakeScope(syntheticPage({ foeInverted: false }))), '对手卡没倒置没报')
        .toContain('硬约束 2');
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
      info.mockRestore();
    }
  });
});
