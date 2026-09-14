import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { FX_DOM_CONTRACT, hooksOfCategory, RENDERERS, type FxDomHook } from '../../src/ui/fx-dom-contract';
import { stripComments, stripArrayDecl } from './source-text';

/**
 * G1 守卫：FX DOM 契约必须「出处真实 + 现热座渲染器确实提供 + 分类互斥」。
 * 无 jsdom（项目惯例）：这里全部是源码文本核对。
 */

const root = new URL('../../src/ui/', import.meta.url);
const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, root))).subarray(0, 8 * 1024 * 1024).toString('utf8');

/**
 * `stripComments`（去注释助手）**G2 Task 3F 起移到 `./source-text`**，由本文件、
 * `tests/ui/fx-orient.test.ts` 与 `tests/ui/render-net.test.ts` 共用**同一份实现**。
 *
 * 为什么必须共用：它是"去注释判据"的唯一实现。两份拷贝一旦漂移，其中一边会因为
 * "注释没被删掉"而**假绿** —— G2 Task 3 的 I-2 就是这个形态（`fx-orient.test.ts` 的产出方
 * 守卫读裸源码，被 `render.ts` 里一句新增的中文注释满足，实测反转缺省朝向 / 删掉 180° 分支
 * 后全套 945 项仍全绿）。它的单测留在本文件末尾（`G2 Task 2F · stripComments` 那一段），
 * 测的正是共用实现本身。
 */

/** FX 层模块（契约的消费方） */
const FX_MODULES = [
  'effects/index.ts',
  'fx-gen2.ts',
  'fx-gen3.ts',
  'fx-gen3-swap.ts',
  'gen3-control.ts',
  'compiled-gen3.ts',
  'gen3-util.ts',
  'fx-follow.ts',
  'fx/delete-shatter.ts',
  'fx/discard-cut.ts',
  'fx-tornado.ts',
  // G2 Task 2：朝向单一出处（.rot-cw/.rot-ccw 的 requiredBy 已改指它 —— 其余 FX 模块
  // 改经 orientOf() 间接消费，不再出现类名字面量）
  'fx-orient.ts',
] as const;

/** 结构钩子的提供方（渲染器注册表）—— G2 Task 2F2 起**唯一出处**是契约数据文件
 *  `src/ui/fx-dom-contract.ts` 导出的 `RENDERERS`（tests/ui/fx-orient.test.ts 也 import 同一份，
 *  用它判定「产出方」= 允许命名朝向类名的文件）。
 *  ⚠️ 不要再写 `(RENDERERS as readonly string[]).includes(f)` 这类断言：注册项现在是对象，
 *  那种写法**在运行期恒为 false**（假红），而且正是 `as` 让类型检查失效、把问题推到运行期。 */
const rendererFiles = new Set<string>(RENDERERS.map((r) => r.file));

// 显式 Map<string, string>：requiredBy 里的模块名是普通 string，需要能按名查回源码。
//
// G2 Task 2F：这里用 **去注释后** 的源码。原来的裸源码会被注释满足 —— `effects/index.ts` 里
// `rot-cw` 只在 :115/:620 两行中文注释里，于是「requiredBy 写 effects/index.ts」照样全绿。
// 去注释后，判据变成「这个模块的代码（非注释）真的出现该判别子串」。
const fxSources = new Map<string, string>(FX_MODULES.map((m): [string, string] => [m, stripComments(read(m))]));

/** 当前渲染器源码（去注释口径，理由见 source-text.ts 与下方两条渲染器断言）。key = 注册表里的 file */
const rendererSources = new Map<string, string>(RENDERERS.map((r): [string, string] => [r.file, stripComments(read(r.file))]));

/**
 * G2 Task 3F · C-3：**复用助手型渲染器**——"本文件提供 A 类钩子"的判据改成**调用链**。
 *
 * 背景（评审 Critical C-3，变异实测）：远程页 `render-net.ts` 刻意最大化复用 `render.ts` 的叶子
 * 助手，钩子的**产出表达式**都在 `render.ts` 里，本页只负责"把这些助手挂进渲染链路"。原实现为了
 * 让"本文件出现该 token"成立，在 `render-net.ts` 里放了一张逐字写着 A 类 hook 选择器的数据表
 * `NET_PAGE_HOOKS` —— 于是**表本身**满足了断言：把 `renderStackSlot(` / `renderProtocolCell(`
 * 的真实挂载删掉（页面上因此没有链路槽与协议格），契约测试 20 + render-net 守卫 11 **全绿（31/31）**。
 *
 * 修法：要求清单放在**这里**（与证据所在的 `render-net.ts` 分开，因此不可能自我满足），
 * 证据是"该文件（**剔除自己的数据表体后**）的代码里真的出现这些助手调用字面量"。
 * `renderStackSlot(` 这类带左括号的字面量只可能来自**调用点**（import 列表里没有括号），
 * 所以删掉真实挂载 → 立刻红。
 *
 * ⚠️ 已知边界（如实写明）：这一条证明的是"本页调用了产出这些钩子的助手"，
 * **不**逐条证明"钩子 X 由助手 Y 产出"（那是本文件的 `hook → call` 映射，属文档性声明）；
 * 钩子的**拼写**由 `render.ts` 自己那条注册项逐条守住（同一个 `rendererProvides` 循环）。
 */
const ASSISTANT_CALLS: ReadonlyMap<string, readonly string[]> = new Map([
  ['render-net.ts', [
    'renderStackSlot(', 'renderProtocolCell(', 'renderDeck(', 'renderTrash(',
    'renderHand(s, 0', 'renderHand(s, 1', 'renderControlModule(', 'renderPlayerInfo(',
    'renderRefreshButton(', 'choiceBar(', 'buildChoicePickOverlay(',
  ]],
]);

/**
 * 渲染器的"判据面"：去掉注释，并**剔除它自己的钩子数据表**（若有）。
 * 表里逐字写着 hook 选择器字符串，留着就等于让表给"本文件提供这些钩子"作证（C-3 的根因）。
 */
function judgeSourceOf(file: string): string {
  const raw = rendererSources.get(file) ?? stripComments(read(file));
  return stripArrayDecl(raw, 'NET_PAGE_HOOKS');
}


/**
 * 取钩子的「判别子串」。必须能唯一定位到这个钩子，否则守卫形同虚设：
 *  - `[attr]` / `[attr][attr2]` → 属性名（`data-player`）
 *  - `.cls` / `img.cls` → 类名（`.stack-slot` → `stack-slot`；`img.protocol-img` → `protocol-img`）
 *  - `.cls[attr]…` → **类名**（属性名在多处通用，用它证明不了出处 —— 这正是原实现被评审判为不成立的漏洞）
 *  - `.clsA.clsB`（类开头多段，如 `.trash-pile.p1/.p2`）→ **第一段**类名。旧规则机械取 `parts[1]`
 *    会得到 `p1/` / `p1` 这种**值形态的短串**：它同时命中 render.ts:1732 的 hand-shield 归属类构造
 *    （`'hand-shield' + (player === 1 ? ' p2' : ' p1')`）与 :4394 的 draft-preview 构造
 *    （`'draft-preview' + (player === 0 ? ' p1' : ' p2')`）—— 两处的 `p1` / `p2` 都是**拼接出来的
 *    后缀**，不是独立字面量，所以它证明不了「弃牌堆带了 pN」还是「别的节点带了 p1」，等于没有判别力。
 *    类开头的选择器里，第一段才是标识性的那个。
 *  - 纯标签名（`img`）→ 该标签名
 */
function probeOf(hook: string): string {
  if (hook.startsWith('[')) return /^\[([a-z-]+)/.exec(hook)?.[1] ?? hook;
  const head = hook.split('[')[0];          // 去掉属性选择器部分
  const parts = head.split('.').filter(Boolean);
  if (head.startsWith('.')) return parts[0] ?? hook;  // .stack-slot → stack-slot；.trash-pile.p1 → trash-pile
  if (parts.length >= 2) return parts[1];             // img.protocol-img → protocol-img
  return parts[0] ?? hook;                            // img → img
}

/**
 * probe 里形如 `data-*` 的项，其**产出形式**是 `node.dataset.uid = …`（render.ts:60/228/1576）——
 * 源码里"写属性"与"查属性"长得不一样。以 `[data-uid]` 为例，render.ts 里 12 行字面量 `data-uid`
 * （:648/:792/:800/:1030/:1225/:1641/:3869/:4677/:4718/:4792/:4819/:4952）**全部是查询或注释**，
 * 一处产出点都没有。于是「只写属性、从不查询」的**正确**远程页渲染器会被误判成缺钩子。
 * 故 `data-*` 项额外接受 `dataset.<camelCase>` 这一产出形式。
 *
 * **按 token 精确映射**：`data-uid` → `dataset.uid`、`data-player` → `dataset.player`；
 * 不接受「任意 `dataset.*` 都算数」——`dataset.other` 不能满足 `data-uid`。
 */
function datasetFormOf(attrToken: string): string | null {
  const m = /^data-[a-z-]+$/.exec(attrToken);
  if (!m) return null;
  const camel = m[0].slice('data-'.length).replace(/-([a-z])/g, (_all, c: string) => c.toUpperCase());
  return `dataset.${camel}`;
}

/** 源码里出现了该 dataset 产出形式，且其后不是标识符字符（`dataset.uidCounter` 不算 `dataset.uid`） */
function hasDatasetForm(src: string, form: string): boolean {
  return new RegExp(`${form.replace(/\./g, '\\.')}(?![A-Za-z0-9_$])`).test(src);
}

/** 渲染器提供的判别子串：显式 probe 优先（**每一项都要出现**），否则退回自动推导 */
function rendererTokensOf(h: FxDomHook): string[] {
  return [...(h.probe ?? [probeOf(h.hook)])];
}

/** 报告用：这条钩子 probe 各项的 dataset 备选形式（无则空数组） */
function datasetAlternativesOf(h: FxDomHook): string[] {
  return rendererTokensOf(h).map((t) => datasetFormOf(t)).filter((x): x is string => x !== null);
}

/**
 * 渲染器是否提供了这条钩子：probe **每一项**都要在渲染器源码里找到，其中形如 `data-*` 的项
 * 额外接受 `dataset.<camelCase>` 产出形式（render.ts 用 `dataset.player` / `dataset.line` **写**
 * 属性，字面量 `data-player` / `data-line` 只出现在查询选择器里；旧实现把这条备选挂在
 * `kind === 'attr'` 上，于是复合钩子 `.stack-slot[data-player][data-line]` 只写 dataset 时被假红，
 * 而任何一处查询又能让「根本不写属性」的渲染器蒙混过关）。
 *
 * G2 Task 2F：入参应为 **stripComments 后**的源码。原先的裸源码会被注释满足 —— 例如 render.ts:196
 * 的中文注释里写着 `.rot-cw`，`:1438/:2927` 的注释里写着 `rot-180`，都在描述而非产出。
 *
 * 注意：它证明的仍只是"书写形式出现在（非注释的）源码文本里"，**不**证明属性真的写在节点上、
 * 值是否与状态一致、节点在特效读取那一刻是否存在。
 */
function rendererProvides(src: string, h: FxDomHook): boolean {
  return rendererTokensOf(h).every((t) => {
    if (src.includes(t)) return true;
    const alt = datasetFormOf(t);
    return alt !== null && hasDatasetForm(src, alt);
  });
}

describe('G1 · FX DOM 契约', () => {
  it('清单非空，且四类都出现过（防止只盘点了一类）', () => {
    expect(FX_DOM_CONTRACT.length).toBeGreaterThan(0);
    for (const c of ['A', 'B', 'C', 'D'] as const) expect(hooksOfCategory(c).length).toBeGreaterThan(0);
  });

  it('每条钩子都有 kind / category / requiredBy，且 requiredBy 指向真实存在的 FX 模块', () => {
    const names = new Set<string>(FX_MODULES);
    for (const h of FX_DOM_CONTRACT) {
      expect(h.hook.length, `空钩子：${JSON.stringify(h)}`).toBeGreaterThan(0);
      expect(['attr', 'class', 'element']).toContain(h.kind);
      expect(['A', 'B', 'C', 'D']).toContain(h.category);
      if (h.category === 'D') {
        // D 类＝渲染器产出但 FX 不读：没有 FX 消费方，requiredBy 必须是空数组。
        // （首轮为迁就两条互斥规则曾填 'effects/index.ts'，那是不实声明。）
        expect(h.requiredBy, `${h.hook} 是 D 类（FX 零引用），requiredBy 必须为空`).toEqual([]);
        continue;
      }
      expect(h.requiredBy.length, `${h.hook} 的 requiredBy 为空`).toBeGreaterThan(0);
      for (const m of h.requiredBy) expect(names.has(m), `${h.hook} 的出处 ${m} 不在 FX_MODULES 内`).toBe(true);
    }
    // 显式 probe 的每一项都必须是非空子串：`probe: ['']` 会让渲染器断言永远为真。
    for (const h of FX_DOM_CONTRACT) {
      for (const t of h.probe ?? []) {
        expect(t.length, `${h.hook} 的 probe 含空子串（等于没有机检力）`).toBeGreaterThan(1);
      }
    }
  });

  it('显式 probe 不得是空数组（`.every()` 对空数组恒真 —— 空 probe 等于静默关掉这条断言）', () => {
    // rendererTokensOf 里写的是 `h.probe ?? [probeOf(h.hook)]`：`probe: []` 是**存在**的显式 probe，
    // 于是不会退回自动推导；而 `.every()` 对空数组恒真 → rendererProvides 永远返回 true。
    // 上面那条「probe 每项非空」的循环遍历空数组一次都不进，因此抓不到这个**静默绿**路径 ——
    // 在一个专门用来消灭静默绿的守卫里，这是必须堵死的一条。
    for (const h of FX_DOM_CONTRACT) {
      if (h.probe) expect(h.probe.length, `${h.hook} 的 probe 为空数组（等于关闭这条断言）`).toBeGreaterThan(0);
    }
  });

  it('钩子字符串不重复（同名钩子不得出现在两个分类里）', () => {
    const seen = new Map<string, string>();
    for (const h of FX_DOM_CONTRACT) {
      const prev = seen.get(h.hook);
      expect(prev, `钩子 ${h.hook} 重复登记（${prev} 与 ${h.category}）`).toBeUndefined();
      seen.set(h.hook, h.category);
    }
  });

  it('A 类钩子必须真的被某个 FX 模块引用（防止凭空发明）', () => {
    const missing: string[] = [];
    for (const h of hooksOfCategory('A')) {
      const probe = probeOf(h.hook);
      const hit = [...fxSources.values()].some((src) => src.includes(probe));
      if (!hit) missing.push(`${h.hook}（判别子串 ${probe} 未在任何 FX 模块中出现）`);
    }
    expect(missing, `以下 A 类钩子找不到引用出处：\n${missing.join('\n')}`).toEqual([]);
  });

  it('每个渲染器文件都必须登记进 RENDERERS，且每个注册项都必须在磁盘上存在（双向，防静默只验旧渲染器）', () => {
    // RENDERERS 是**opt-in** 的：G2 新增远程页渲染器却忘了登记，下面所有断言都会继续只验
    // render.ts 然后报绿 —— 这比没有守卫更糟，因为它读起来像"已验收"。
    // 所以这里反向发现磁盘上的渲染器文件，漏登记即报红。
    const dir = fileURLToPath(new URL('../../src/ui/', import.meta.url));
    const found = readdirSync(dir).filter((f) => /^render.*\.ts$/.test(f));
    // G2 Task 2F2：按注册项的 `.file` 比较（不是 `as readonly string[]` —— 那在运行期恒 false）
    const missing = found.filter((f) => !rendererFiles.has(f));
    expect(missing, `以下渲染器未登记进 RENDERERS：${missing.join(', ')}`).toEqual([]);
    // 反向：注册项拼错文件名 → 它对应的源码断言会去读一个不存在的文件（渲染期抛），
    // 或者在别处被当作"已登记"而静默缩小检查面。显式断言存在性。
    const absent = [...rendererFiles].filter((f) => !found.includes(f));
    expect(absent, `RENDERERS 里登记了磁盘上不存在的渲染器（文件名拼错？）：${absent.join(', ')}`).toEqual([]);
  });

  it('A 类钩子必须被当前渲染器提供（复用助手型渲染器按**调用链**判定 —— G2 Task 3F · C-3）', () => {
    const problems: string[] = [];
    for (const r of RENDERERS) {
      // ⚠️ 判据面：去注释 + **剔除渲染器自己的钩子数据表**（表不得充当"提供"的证据）
      const src = judgeSourceOf(r.file);
      const calls = ASSISTANT_CALLS.get(r.file);
      if (calls) {
        // 复用助手型渲染器：钩子产出表达式在共享助手里，本页的贡献是"把助手挂进链路"。
        // 证据 = 这些**调用字面量**（含左括号，故 import 列表不会误满足）出现在真实代码里。
        if (calls.length === 0) problems.push(`${r.file} 的助手调用清单为空（等于关掉这条断言）`);
        for (const c of calls) {
          if (!src.includes(c)) {
            problems.push(`${r.file} 未调用产出 A 类钩子的共享助手 ${JSON.stringify(c)}（本页应把它挂进渲染链路）`);
          }
        }
        continue;
      }
      const exempt = new Set<string>(r.exempt ?? []);
      for (const h of hooksOfCategory('A')) {
        if (exempt.has(h.hook)) continue;   // 该渲染器有意不提供（exempt 必须在契约文档写明理由）
        if (rendererProvides(src, h)) continue;
        const alts = datasetAlternativesOf(h);
        problems.push(`${r.file} 未提供 ${h.hook}（判别子串 ${rendererTokensOf(h).join(' + ')}`
          + `${alts.length === 0 ? '' : `，data-* 项也接受 ${alts.join(' / ')}`}）`);
      }
    }
    expect(problems, `以下 A 类钩子当前渲染器缺失：\n${problems.join('\n')}`).toEqual([]);
  });

  it('助手调用清单的键必须都是已登记渲染器（拼错文件名不得让要求静默失效）', () => {
    const unknown = [...ASSISTANT_CALLS.keys()].filter((f) => !rendererFiles.has(f));
    expect(unknown, `ASSISTANT_CALLS 里登记了未注册的渲染器（要求被静默忽略）：${unknown.join(', ')}`).toEqual([]);
    expect(ASSISTANT_CALLS.size, 'ASSISTANT_CALLS 为空（复用助手型渲染器失去判据）').toBeGreaterThan(0);
  });

  /**
   * G2 Task 4（来自 Task 2 终审的延后清单 N-5）：`exempt` 的**每一项都必须是真实的 A 类钩子**。
   *
   * 为什么必须有这条：`exempt` 是「该渲染器**有意**不提供这条契约项」的声明，上面那条
   * 「A 类钩子必须被当前渲染器提供」正是靠 `exempt.has(h.hook)` 跳过它的。于是**拼错一个键**
   * （`.rot-cw` 写成 `.rot-cw ` / `.rotcw`）不会报任何红 —— 它只是在集合里多出一个**永不匹配**
   * 的字符串，而它本该豁免的那条钩子**照旧被正常验收**（这一半是安全的），真正危险的是反方向：
   * 有人为了让一条**真的缺失**的钩子变绿，往 `exempt` 里塞一个不存在的钩子名（或塞一个 B/C/D 类
   * 的钩子）—— 这条断言让「豁免面」只能由**真实的 A 类钩子**构成，豁免因此是**逐条可复核**的决定，
   * 而不是一个能兜住任意拼写的垃圾桶。
   *
   * 本任务是 `exempt` 的**首次真正使用**（Task 3 登记 `render-net.ts` 时加的），所以现在补。
   */
  it('RENDERERS 里 exempt 的每一项都必须是真的 A 类钩子（拼错键 = 静默扩大豁免面）', () => {
    const aHooks = new Set<string>(hooksOfCategory('A').map((h) => h.hook));
    const problems: string[] = [];
    // 反空集合：当前至少有一个渲染器带 exempt（否则这条断言变成空转）——
    // 失败信息说明「若非有意删除全部豁免，请同步本条与契约文档」
    expect(RENDERERS.filter((r) => (r.exempt ?? []).length > 0).length,
      'RENDERERS 里没有任何带 exempt 的渲染器（豁免断言空转；若有意删除请同步本条）').toBeGreaterThan(0);
    for (const r of RENDERERS) {
      for (const e of r.exempt ?? []) {
        if (!aHooks.has(e)) {
          problems.push(`${r.file} 的 exempt 项 ${JSON.stringify(e)} 不是 A 类钩子 —— `
            + '拼错键会静默扩大豁免面（豁免必须逐条对应一条真实契约项）');
        }
      }
      // 同一渲染器内不得重复豁免（重复说明有一条是抄错的）
      const dup = (r.exempt ?? []).filter((e, i) => (r.exempt ?? []).indexOf(e) !== i);
      if (dup.length > 0) problems.push(`${r.file} 的 exempt 有重复项：${dup.join(', ')}`);
    }
    expect(problems, `以下 exempt 登记不成立：\n${problems.join('\n')}`).toEqual([]);
    // 义务守恒：被豁免的钩子仍然必须**被别的渲染器提供**（exempt 只豁免这一个渲染器，
    // 不得让一条契约项在**全部**渲染器上都不验收 —— 那等于悄悄删掉一条契约）
    const missingEverywhere: string[] = [];
    for (const h of hooksOfCategory('A')) {
      const exemptedBy = RENDERERS.filter((r) => (r.exempt ?? []).includes(h.hook));
      if (exemptedBy.length === RENDERERS.length) missingEverywhere.push(h.hook);
    }
    expect(missingEverywhere, `以下 A 类钩子在**所有**渲染器上都被豁免（契约项被静默删除）：\n${missingEverywhere.join('\n')}`)
      .toEqual([]);
  });

  it('A/B/C 类 requiredBy 的每个模块都必须自己含该钩子的判别子串（出处可机检，不是只查名单）', () => {
    // 只断言「模块名 ∈ FX_MODULES」等于没查：随便填一个 FX 模块都能过。
    // 这里逐步收紧为「这个模块的**代码**里真的有这个钩子」，凭空发明 / 出处写错都会被抓到。
    // G2 Task 2F：判据走去注释后的源码（fxSources），否则中文注释里的同名子串就能满足它。
    const problems: string[] = [];
    for (const h of FX_DOM_CONTRACT) {
      if (h.category === 'D') continue; // D 类＝FX 零引用，requiredBy 必空（另有专门断言）
      const probe = probeOf(h.hook);
      for (const m of h.requiredBy) {
        const src = fxSources.get(m);
        if (src === undefined) { problems.push(`${h.hook}（${h.category} 类）：requiredBy 的 ${m} 不是 FX 模块`); continue; }
        if (!src.includes(probe)) {
          problems.push(`${h.hook}（${h.category} 类）：requiredBy 的 ${m} 里（去注释后）找不到判别子串 ${probe}`);
        }
      }
    }
    expect(problems, `以下 requiredBy 出处不成立（改模块名或改钩子写法）：\n${problems.join('\n')}`).toEqual([]);
  });

  it('B 类钩子必须由 requiredBy 的模块真的自建/取回（B 类的对称守卫，防止渲染器自有节点被误标为 B）', () => {
    // 原始事故形态：render.ts 产出、FX 零引用的 .hand-strip / .play-btns 被标成 B 却无人机检。
    // B 类＝特效自建，其存在性只能由「FX 模块里真的有这个类名」来证明；证明不了就必须重分类（多半是 D）。
    const problems: string[] = [];
    for (const h of hooksOfCategory('B')) {
      const probe = probeOf(h.hook);
      // 逐条 requiredBy 核对，报告时按「钩子」聚合一次（避免同一条钩子刷屏）。
      const unverified = h.requiredBy.filter((m) => !(fxSources.get(m) ?? '').includes(probe));
      if (h.requiredBy.length === 0 || unverified.length > 0) {
        problems.push(`${h.hook}：${unverified.length > 0 ? `requiredBy 的 ${unverified.join('、')}` : 'requiredBy'} `
          + `里找不到判别子串 ${probe} —— 「特效自建」出处不成立，应改 requiredBy，或重分类为 D`);
      }
    }
    expect(problems, `以下 B 类钩子的自建出处无法机检：\n${problems.join('\n')}`).toEqual([]);
  });

  it('kind 与钩子书写形式一致（class ⇔ 以 . 开头，attr ⇔ 以 [ 开头，element ⇔ 纯标签名）', () => {
    const bad: string[] = [];
    for (const h of FX_DOM_CONTRACT) {
      const lead = h.hook[0];
      const want = lead === '.' ? 'class' : lead === '[' ? 'attr' : 'element';
      if (h.kind !== want) bad.push(`${h.hook}: kind=${h.kind}，按书写形式应为 ${want}`);
    }
    expect(bad, `kind 与钩子形式不一致：\n${bad.join('\n')}`).toEqual([]);
  });

  it('六个已确认的 A 类核心钩子必须在清单里（防止盘点漏掉主干）', () => {
    const aHooks = hooksOfCategory('A').map((h) => h.hook).join('\n');
    // 判别串必须与 hook 的书写形式一致（机读清单里属性选择器**不带具体值**）。
    // 这六条都已 git grep 到 FX 模块确有引用；`.hand-strip`/`.play-btns`/`.lane-row` 因 FX 零引用归 D，不在此列。
    for (const core of [
      '.stack-slot[data-player]',
      '[data-uid]',
      '.deck[data-player]',
      'protocol-img',
      'control-track',
      'protocol-holder',
    ]) {
      expect(aHooks, `核心 A 类钩子 ${core} 未登记为 A`).toContain(core);
    }
  });

  it('D 类钩子必须由渲染器产出、且 FX 模块完全读不到（两个条件缺一不可，防止分类搞反）', () => {
    // G2 Task 2F：这里**故意**沿用裸源码（不去注释）—— 该断言要的正是「渲染器确实产出这些
    // 钩子」，而 D 类的三条判别子串在 render.ts 的注释里也出现（描述性提及）。去注释会让它
    // 更严，但那属于 Task 4 的契约结构改动范围，本任务只按简报修 I-1 指定的两处。
    const rendererSrc = RENDERERS.map((r) => read(r.file)).join('\n');
    const problems: string[] = [];
    for (const h of hooksOfCategory('D')) {
      const probe = probeOf(h.hook);
      if (!rendererSrc.includes(probe)) problems.push(`${h.hook} 未被当前渲染器产出（应归 B 特效自建）`);
      if ([...fxSources.values()].some((src) => src.includes(probe))) {
        problems.push(`${h.hook} 其实被 FX 模块读到（判别子串 ${probe}，应归 A 契约项）`);
      }
    }
    expect(problems, `以下 D 类钩子判定有误：\n${problems.join('\n')}`).toEqual([]);
  });

  it('契约文档必须逐一登记全部 A 类钩子（文档与代码不得漂移）', () => {
    // 路径基准是 tests/ui/：../../docs/ = 仓库根/docs/（与同目录既有测试的 '../../src/' 同惯例）
    // ⚠️ 这里**绝不能**去注释：文档本身就是散文，去掉注释会把正文吃掉、全部 A 类钩子被判缺失。
    const doc = readFileSync(
      fileURLToPath(new URL('../../docs/4代-FX DOM 契约.md', import.meta.url)),
    ).subarray(0, 4 * 1024 * 1024).toString('utf8');
    const missing = hooksOfCategory('A')
      .map((h) => h.hook)
      .filter((hook) => !doc.includes(hook));
    expect(missing, `文档未登记以下 A 类钩子：\n${missing.join('\n')}`).toEqual([]);
  });
});

/**
 * `stripComments` 自身的守卫。
 *
 * 没有这一条，这个助手就成了本文件里**新的**静默风险：它若把真实代码误删（假红）或漏删注释
 * （假绿），上面所有去注释后的断言都会跟着一起错，而且看起来完全正常。
 */
describe('G2 Task 2F · stripComments（去注释助手自身）', () => {
  it('行注释与块注释被移除', () => {
    expect(stripComments('const a = 1; // rot-cw')).not.toContain('rot-cw');
    expect(stripComments('const a = 1; /* rot-cw */ const b = 2;')).not.toContain('rot-cw');
    // 留白而非删除：代码本身必须原样保留
    expect(stripComments('const a = 1; // x')).toContain('const a = 1;');
  });

  it("字符串/模板串里的注释样式字符**保留**（正则做不到这一点）", () => {
    expect(stripComments("const a = 'http://x';")).toContain("'http://x'");
    expect(stripComments('const b = "/*not*/";')).toContain('"/*not*/"');
    expect(stripComments('const c = `a//b`;')).toContain('`a//b`');
  });

  it('多行块注释被移除且行号不变', () => {
    const src = ['const a = 1;', '/* line1', '   line2 */', 'const b = 2;'].join('\n');
    const out = stripComments(src);
    expect(out.split('\n').length).toBe(src.split('\n').length);
    expect(out).not.toContain('line1');
    expect(out).not.toContain('line2');
    expect(out.split('\n')[0]).toContain('const a = 1;');
    expect(out.split('\n')[3]).toContain('const b = 2;');
  });

  it('CRLF 行尾：行注释被移除、\\r 也变空白、后续代码保留、行数不变', () => {
    // 为什么必须有这条：本仓工作区的 src/ui/effects/index.ts 就是 CRLF（git ls-files --eol = i/lf w/crlf）。
    // 若有人把行注释循环里的 `src[i] !== '\n'` 改成 `\r` 感知逻辑，CRLF 文件会被**整文件吃掉**
    // （后面所有去注释断言全部假绿）。这条单测钉住这个行为。
    const src = 'const a = 1; // rot-cw\r\nconst b = 2;\r\nconst c = 3;';
    const out = stripComments(src);
    expect(out).not.toContain('rot-cw');
    expect(out.split('\n').length).toBe(src.split('\n').length);
    expect(out.split('\n')[1]).toContain('const b = 2;');
    expect(out.split('\n')[2]).toContain('const c = 3;');
  });

  it('正则字面量里的转义斜杠：该行不得被整行截断（不用正则去注释的理由）', () => {
    // `/ab\/\/cd/` 里的 `\/` 只是一个**转义斜杠**，字符序列是 `/ a b \ / \ / c d /`，
    // 并不含连续的 `//`；朴素地找 `//` 会把这一行从中间截断（把真实代码当注释删 = 假红）。
    const src = 'const re = /ab\\/\\/cd/; // rot-cw';
    const out = stripComments(src);
    // 正则字面量必须完好保留（转义斜杠仍在）
    expect(out).toContain('/ab\\/\\/cd/');
    // 行注释仍被移除
    expect(out).not.toContain('rot-cw');
  });

  it('块注释体内含未配对引号：注释被移除且其后代码完好保留', () => {
    // 这是该状态机最可能出错的输入：注释里的撇号不能让扫描器"进入字符串态"而吃掉后面的代码。
    // 评审对全部 22 个真实文件的块注释做过引号奇偶检查，0 处奇数 —— 这条既补单测，
    // 也留下「当前树为何安全」的证据。
    const out1 = stripComments("/* it's a note */ const a = 'x';");
    expect(out1).not.toContain("it's a note");
    expect(out1).toContain("const a = 'x';");
    const out2 = stripComments('/* don\'t */ const b = 1; // rot-cw');
    expect(out2).not.toContain('rot-cw');
    expect(out2).toContain('const b = 1;');
  });

  it('对真实源码：effects/index.ts 去注释后不含裸 rot-cw（出处判据不看注释）', () => {
    // ⚠️ 这里**故意不**断言「裸源码里一定有 rot-cw（注释）」。那会把「今天注释里恰好写着 rot-cw」
    // 这一**历史证据**固化成对**将来**的约束 —— Task 4 或任何一次注释整理都会让它无理由变红
    // （复评 Minor-4 实测）。「注释会被去掉」这条能力已由上面几组**合成输入**单测充分覆盖。
    // 这里只保留有价值的那一半：真实文件去注释后**不得**再有 rot-cw 字样（否则出处数据不诚实）。
    const raw = read('effects/index.ts');
    const stripped = stripComments(raw);
    expect(stripped, 'effects/index.ts 去注释后仍有 rot-cw 字样（出处数据其实不诚实？）').not.toContain('rot-cw');
    // 行号必须保持（否则去注释后的报错行号会误导人）
    expect(stripped.split('\n').length).toBe(raw.split('\n').length);
  });
});

/**
 * G2 Task 3F · C-3 的助手：`stripArrayDecl`（剔除 `render-net.ts` 的钩子数据表体）。
 *
 * 没有这一条，这个助手就成了新的静默风险：它若删除过多（把真实代码也剔掉 → 假红）或没剔到
 * （表留下 → 断言继续被表满足 → 假绿），上面"调用链判定"的断言会跟着一起错，而且看起来正常。
 */
describe('G2 Task 3F · stripArrayDecl（剔除数据表体的助手自身）', () => {
  const decl = [
    'const KEEP_A = 1;',
    'export const NET_PAGE_HOOKS: readonly X[] = [',
    "  { hook: '.a[b][c]', call: ['renderA('] },",
    "  { hook: '.d' },",
    '];',
    'const KEEP_B = 2;',
  ].join('\n');

  it('整段剔除数组字面量声明（类型标注里的 [] 不被当表体、字符串里的方括号不干扰配对）', () => {
    const out = stripArrayDecl(decl, 'NET_PAGE_HOOKS');
    expect(out, '表体没被剔干净（断言会继续被表满足）').not.toContain('.a[b][c]');
    expect(out).not.toContain('renderA(');
    // 声明前后的真实代码必须原样保留
    expect(out).toContain('const KEEP_A = 1;');
    expect(out).toContain('const KEEP_B = 2;');
    // 行号保持
    expect(out.split('\n').length).toBe(decl.split('\n').length);
  });

  it('找不到声明时**原样返回**（上层以"缺 token"报红，而不是在这里抛异常）', () => {
    expect(stripArrayDecl('const X = 1;', 'NET_PAGE_HOOKS')).toBe('const X = 1;');
  });

  it('对真实 render-net.ts：剔除后表里的 hook 字符串消失，但真实调用与注释都不受影响', () => {
    const code = stripArrayDecl(stripComments(read('render-net.ts')), 'NET_PAGE_HOOKS');
    expect(code, '表体没被剔除（hook 字符串仍在 → 契约断言继续被表满足）').not.toContain('.trash-pile.p1/.p2');
    expect(code).not.toContain('stack-slot[data-player]');
    // 真实调用必须留下（否则"调用链判定"会因剔多了而假红）
    expect(code).toContain('renderStackSlot(');
    expect(code).toContain('renderHand(s, 0');
  });

  /**
   * G2 Task 3F2 · F-4 / §4-1：**固化已知局限的当前行为**（不是"期望行为"）。
   *
   * 复评喂了 9 例刁钻输入，8 过 1 错；错的是"声明之前有代码位提前引用同名标识符"。本任务
   * **有意不重构**该助手（复评建议：定位钉声明头 + 把 `=` 的搜索限制在同一条语句内 —— 已写进
   * `tests/ui/source-text.ts` 的实现注释）。这条单测的作用是**把当前（不正确的）行为钉住**：
   * 将来若有人顺手改好了它，这里会红 —— 红的含义是"请同步更新注释里的已知局限与本节说明"，
   * 而不是"你改错了"。没有这条，这个缺口会随一次无声重构悄悄变样，谁也说不清现状。
   */
  it('已知局限（F-4，本轮不修）：声明前有代码位提前引用同名标识符时会剔错区间', () => {
    const src = [
      'function useHooks() { return NET_PAGE_HOOKS.length; }',
      'const OTHER = [1, 2];',
      'export const NET_PAGE_HOOKS: readonly X[] = [',
      "  { hook: '.a' },",
      '];',
    ].join('\n');
    const out = stripArrayDecl(src, 'NET_PAGE_HOOKS');
    // ① 假红方向：无关的 `const OTHER = [1, 2];` 被当成表体吃掉
    expect(out, 'F-4 的当前行为变了（无关声明不再被吃）→ 请同步 source-text.ts 的已知局限注释')
      .not.toContain('const OTHER = [1, 2];');
    // ② 假绿方向：真正的表体**留在结果里**
    expect(out, 'F-4 的当前行为变了（真表体被正确剔除）→ 请同步 source-text.ts 的已知局限注释')
      .toContain("hook: '.a'");
    // ③ 行号仍然保持（这条能力与缺口无关，必须一直成立）
    expect(out.split('\n').length).toBe(src.split('\n').length);
    // 今天真实树零命中：render-net.ts 里该名字的第一个代码位命中就是声明本身（由上面那条单测保证）
  });
});
