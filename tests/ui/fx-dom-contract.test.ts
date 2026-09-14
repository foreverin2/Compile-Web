import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { FX_DOM_CONTRACT, hooksOfCategory } from '../../src/ui/fx-dom-contract';

/**
 * G1 守卫：FX DOM 契约必须「出处真实 + 现热座渲染器确实提供 + 分类互斥」。
 * 无 jsdom（项目惯例）：这里全部是源码文本核对。
 */

const root = new URL('../../src/ui/', import.meta.url);
const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, root))).subarray(0, 8 * 1024 * 1024).toString('utf8');

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
] as const;

/** 结构钩子的提供方（当前唯一渲染器；G2 会新增远程页渲染器） */
const RENDERERS = ['render.ts'] as const;

// 显式 Map<string, string>：requiredBy 里的模块名是普通 string，需要能按名查回源码
const fxSources = new Map<string, string>(FX_MODULES.map((m): [string, string] => [m, read(m)]));

/**
 * 取钩子的「判别子串」。必须能唯一定位到这个钩子，否则守卫形同虚设：
 *  - `[attr]` / `[attr][attr2]` → 属性名（`data-player`）
 *  - `.cls` / `img.cls` → 标签名 + 类名里**最能定位**的部分，即类名
 *  - `.cls[attr]…` → **类名**（属性名在多处通用，用它证明不了出处 —— 这正是原实现被评审判为不成立的漏洞）
 *  - 纯标签名（`img`）→ 该标签名
 */
function probeOf(hook: string): string {
  if (hook.startsWith('[')) return /^\[([a-z-]+)/.exec(hook)?.[1] ?? hook;
  const head = hook.split('[')[0];          // 去掉属性选择器部分
  const parts = head.split('.').filter(Boolean);
  if (parts.length >= 2) return parts[1];    // img.protocol-img → protocol-img
  return parts[0] ?? hook;                   // .deck → deck；img → img
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

  it('A 类钩子必须被当前渲染器提供（这是 G2 的验收基准）', () => {
    const missing: string[] = [];
    for (const r of RENDERERS) {
      const src = read(r);
      for (const h of hooksOfCategory('A')) {
        const probe = probeOf(h.hook);
        if (!src.includes(probe)) missing.push(`${r} 未提供 ${h.hook}（判别子串 ${probe}）`);
      }
    }
    expect(missing, `以下 A 类钩子当前渲染器缺失：\n${missing.join('\n')}`).toEqual([]);
  });

  it('A/B/C 类 requiredBy 的每个模块都必须自己含该钩子的判别子串（出处可机检，不是只查名单）', () => {
    // 只断言「模块名 ∈ FX_MODULES」等于没查：随便填一个 FX 模块都能过。
    // 这里逐步收紧为「这个模块的源码里真的有这个钩子」，凭空发明 / 出处写错都会被抓到。
    const problems: string[] = [];
    for (const h of FX_DOM_CONTRACT) {
      if (h.category === 'D') continue; // D 类＝FX 零引用，requiredBy 必空（另有专门断言）
      const probe = probeOf(h.hook);
      for (const m of h.requiredBy) {
        const src = fxSources.get(m);
        if (src === undefined) { problems.push(`${h.hook}（${h.category} 类）：requiredBy 的 ${m} 不是 FX 模块`); continue; }
        if (!src.includes(probe)) {
          problems.push(`${h.hook}（${h.category} 类）：requiredBy 的 ${m} 里找不到判别子串 ${probe}`);
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
    const doc = readFileSync(
      fileURLToPath(new URL('../../docs/4代-FX DOM 契约.md', import.meta.url)),
    ).subarray(0, 4 * 1024 * 1024).toString('utf8');
    const missing = hooksOfCategory('A')
      .map((h) => h.hook)
      .filter((hook) => !doc.includes(hook));
    expect(missing, `文档未登记以下 A 类钩子：\n${missing.join('\n')}`).toEqual([]);
  });
});
