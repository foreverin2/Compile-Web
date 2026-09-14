import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { FX_DOM_CONTRACT, hooksOfCategory, type FxDomHook } from '../../src/ui/fx-dom-contract';

/**
 * G1 守卫：FX DOM 契约必须「出处真实 + 现热座渲染器确实提供 + 分类互斥」。
 * 无 jsdom（项目惯例）：这里全部是源码文本核对。
 */

const root = new URL('../../src/ui/', import.meta.url);
const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, root))).subarray(0, 8 * 1024 * 1024).toString('utf8');

/**
 * 去掉行注释（双斜杠起）与块注释（斜杠星号起），**引号与模板串里的内容一律保留**。
 *
 * 为什么不用正则：`'//'`、`"/*"`、模板串里的注释样式字符会被正则误吃，把真实代码当成注释删掉
 * （那会制造**假红**）；而在别处又会把注释留下（假绿）。
 *
 * 为什么必须去注释（这是本助手存在的全部理由）：
 *   - `effects/index.ts` 里 `rot-cw` **只出现在两行中文注释**（:115、:620）。只要把 `.rot-cw` 的
 *     `requiredBy` 加回 `['effects/index.ts']`，原来的 `src.includes(probe)` 会**全绿** —— 出处机检
 *     被注释骗过。评审已实测：注释在则 13/13 绿，只把那两行注释的 `（rot-cw/rot-ccw）` 改成
 *     `（横置）`（零代码改动）才立刻变红。
 *   - 同理 `render.ts:196` 的注释、`effects/index.ts:164` 的 `--fx-rot`/`cloneTransformOf` 注释
 *     （Minor-3）也都只能靠去注释才拦得住。
 *
 * 行号保持：注释内容替换为**等长空白**（注释起始的两个字符本身留在原位，只是不再是注释），
 * 于是 `split('\n').length` 与原文一致，报错里的行号可直接对照源码。
 */
function stripComments(src: string): string {
  const out: string[] = new Array(src.length);
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (c === '/' && n === '/') {                       // 行注释：替换到行尾（不含换行）
      while (i < src.length && src[i] !== '\n') { out[i] = ' '; i += 1; }
      continue;
    }
    if (c === '/' && n === '*') {                       // 块注释：替换到闭合处（含），保留换行
      out[i] = '/'; out[i + 1] = '*'; i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) {
        out[i] = src[i] === '\n' ? '\n' : ' ';
        i += 1;
      }
      if (i < src.length) { out[i] = '*'; out[i + 1] = '/'; i += 2; }
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {          // 字符串 / 模板串：整段原样保留
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

/** 结构钩子的提供方（当前唯一渲染器；G2 会新增远程页渲染器） */
const RENDERERS = ['render.ts'] as const;

// 显式 Map<string, string>：requiredBy 里的模块名是普通 string，需要能按名查回源码。
//
// G2 Task 2F：这里用 **去注释后** 的源码。原来的裸源码会被注释满足 —— `effects/index.ts` 里
// `rot-cw` 只在 :115/:620 两行中文注释里，于是「requiredBy 写 effects/index.ts」照样全绿。
// 去注释后，判据变成「这个模块的代码（非注释）真的出现该判别子串」。
const fxSources = new Map<string, string>(FX_MODULES.map((m): [string, string] => [m, stripComments(read(m))]));

/** 当前渲染器源码（去注释口径，理由见 stripComments 与下方两条渲染器断言） */
const rendererSources = new Map<string, string>(RENDERERS.map((r): [string, string] => [r, stripComments(read(r))]));

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

  it('每个渲染器文件都必须登记进 RENDERERS（否则守卫会静默只验旧渲染器）', () => {
    // RENDERERS 是**opt-in** 的：G2 新增远程页渲染器却忘了登记，下面所有断言都会继续只验
    // render.ts 然后报绿 —— 这比没有守卫更糟，因为它读起来像"已验收"。
    // 所以这里反向发现磁盘上的渲染器文件，漏登记即报红。
    const dir = fileURLToPath(new URL('../../src/ui/', import.meta.url));
    const found = readdirSync(dir).filter((f) => /^render.*\.ts$/.test(f));
    const missing = found.filter((f) => !(RENDERERS as readonly string[]).includes(f));
    expect(missing, `以下渲染器未登记进 RENDERERS：${missing.join(', ')}`).toEqual([]);
  });

  it('A 类钩子必须被当前渲染器提供（这是 G2 的验收基准）', () => {
    const missing: string[] = [];
    for (const r of RENDERERS) {
      const src = rendererSources.get(r) ?? stripComments(read(r));
      for (const h of hooksOfCategory('A')) {
        if (rendererProvides(src, h)) continue;
        const alts = datasetAlternativesOf(h);
        missing.push(`${r} 未提供 ${h.hook}（判别子串 ${rendererTokensOf(h).join(' + ')}`
          + `${alts.length === 0 ? '' : `，data-* 项也接受 ${alts.join(' / ')}`}）`);
      }
    }
    expect(missing, `以下 A 类钩子当前渲染器缺失：\n${missing.join('\n')}`).toEqual([]);
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
    const rendererSrc = RENDERERS.map((r) => read(r)).join('\n');
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

  it('对真实源码：effects/index.ts 的 rot-cw 仅来自注释，去注释后归零（I-1 的决定性证据）', () => {
    const raw = read('effects/index.ts');
    const stripped = stripComments(raw);
    // 原文件里 "rot-cw"（不带引号）确实存在 —— 评审实测只有 :115/:620 两行中文注释
    expect(raw, 'effects/index.ts 里本应有 rot-cw（注释）').toContain('rot-cw');
    expect(stripped, 'effects/index.ts 去注释后仍有 rot-cw 字样（出处数据其实不诚实？）').not.toContain('rot-cw');
    // 行号必须保持（否则去注释后的报错行号会误导人）
    expect(stripped.split('\n').length).toBe(raw.split('\n').length);
  });
});
