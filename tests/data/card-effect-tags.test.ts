import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * G5 T24 判据 1 / 2 / 8：**生成物与生成器的那条腿**。
 *
 * ## 它为什么必须是"逐字比"
 *
 * `src/data/cardEffectTags.ts` 是**自动生成**的（抬头第一行就写着"勿手改"）。任何"生成器改了、
 * 生成物没跟上"的漂移，如果只用"读出来能用"来判，会一直绿 —— 而它在真机上表现为
 * "标签与代码事实不一致"，是最难查的一类。⇒ 这条腿 `readFileSync === renderTagsModule(buildIndex())`。
 *
 * ## 为什么不用 `child_process` 跑 `--write-tags`
 *
 * 本机 `stdio:'pipe'` 会 EPERM（任务书 §2.3 明写）。而"跑一次工具再比文件"与"直接调那个纯函数"
 * 证的是同一件事 —— 而且后者证得**更强**：它连"文件是不是被别的手工编辑过"都能判，
 * 因为 `renderTagsModule` 的返回值只由 `buildIndex()` 的读数决定。
 *
 * ## 两处"本仓的写法"（不这么写 tsc 门会红，踩过）
 *
 *  1. **工具模块用动态 `import()` 的**非字面量**说明符载入**：`import … from '../../tools/card-effect-index.mjs'`
 *     会 `TS7016: implicitly has an 'any' type`（`.mjs` 没有声明文件），而本任务**不许**新增
 *     `tools/*.d.ts`（§0 的边界只放行 `tools/card-effect-index.mjs` 这一个文件）⇒ 换一条 TS
 *     不去"找声明"的路：说明符是运行期求值的 `TOOL_SPEC`，静态分析那一步不发起。
 *     ⚠️ 运行期行为与静态 import **一致**（同一个 ESM 模块命名空间、同一份 `buildIndex`）；
 *     转换只是把"运行期确实是这几个函数"写下来；
 *  2. 读文件用 `readFileSync(p).subarray(0, N).toString('utf8')`（**不给 `readFileSync` 传编码**）：
 *     本仓 tsconfig 的 `types` 只有 `vite/client`，`node:fs` 落到一个**极窄的类型桩**
 *     （`readFileSync(p)` 只声明了 `.subarray()` / `.toString()`）⇒ 传第二个参数会
 *     `TS2554: Expected 1 arguments, but got 2`。`tests/ui/net-body-layer-rules.test.ts:49` 就是
 *     这个写法（全仓几百个测试文件都这么读盘）。
 */
const TOOL_SPEC = ['..', '..', 'tools', 'card-effect-index.mjs'].join('/');
const tool = (await import(/* @vite-ignore */ TOOL_SPEC)) as unknown as Tool;
const { buildIndex, TAG_DEFS, tagsOfCard, renderTagsModule } = tool;

/** 工具模块的读取面（只写下本文件用到的四个出口） */
interface Tool {
  buildIndex(): Index;
  TAG_DEFS: ReadonlyArray<{ id: string; label: string; group: string }>;
  tagsOfCard(index: Index, defId: string): string[];
  renderTagsModule(index: Index): string;
}

/** 索引里本文件用到的那些字段（只写下读到的，不抄整份形状） */
interface IndexCard {
  id: string;
  protocol: string;
  value: number;
  directives: { top: boolean; middle: boolean; bottom: boolean };
  hooks: string[];
  triggers: ReadonlyArray<{ kind: string; top: boolean; cond: boolean }>;
  ops: string[];
  controlRefs: boolean;
  text: { top: string | null; middle: string | null; bottom: string | null } | null;
}
interface Index {
  cards: IndexCard[];
  passiveCards: string[];
  cardTexts: Record<string, { top: string | null; middle: string | null; bottom: string | null }>;
}

const TAGS_FILE = fileURLToPath(new URL('../../src/data/cardEffectTags.ts', import.meta.url));
const BASELINE = fileURLToPath(new URL('../../.superpowers/g5-T24/index-before.json', import.meta.url));

/** 读一个文本文件（写法见文件头注 2） */
const readText = (p: string): string =>
  readFileSync(p).subarray(0, 8 * 1024 * 1024).toString('utf8');

const index: Index = buildIndex();

/** 卡面数据里的全部 defId（= 图鉴显示的 270 张） */
const DATA_IDS: string[] = Object.keys(index.cardTexts).sort();

describe('G5 T24 判据 1：生成物与生成器逐字一致', () => {
  it('src/data/cardEffectTags.ts === renderTagsModule(buildIndex())（逐字）', () => {
    const onDisk = readText(TAGS_FILE);
    expect(onDisk.length, '生成物读成空串（判据会在空串上恒真）').toBeGreaterThan(3000);
    expect(onDisk, '生成物与生成器漂移了：重跑 `node tools/card-effect-index.mjs --write-tags`').toBe(
      renderTagsModule(index),
    );
  });

  it('生成物没有手工编辑痕迹：抬头写着"自动生成"与生成命令', () => {
    const head = readText(TAGS_FILE).split('\n')[0];
    expect(head).toContain('自动生成：node tools/card-effect-index.mjs --write-tags');
    expect(head).toContain('勿手改');
  });

  it('两个新文件 CR=0（LF）', () => {
    for (const p of ['../../src/data/cardEffectTags.ts', '../../src/ui/styles-library-filter.css']) {
      const raw = readFileSync(fileURLToPath(new URL(p, import.meta.url))).subarray(0, 8 * 1024 * 1024) as unknown as Uint8Array;
      expect(raw.includes(0x0d), `${p} 里有 CR（本仓用 LF）`).toBe(false);
    }
  });

  it('无参数输出与升级前同源（把新增的 cardTexts 摘掉之后逐字相同）', () => {
    let baseline: string;
    try {
      baseline = readText(BASELINE);
    } catch {
      return; // 干净检出没有这份临时基线：跳过，不假装通过
    }
    const now = JSON.parse(JSON.stringify(index)) as Record<string, unknown>;
    delete now.cardTexts;
    expect(JSON.stringify(now, null, 2), '解析行为与升级前漂移了（cardTexts 之外还有别的差异）').toBe(
      baseline.replace(/\r\n/g, '\n').trimEnd(),
    );
  });
});

describe('G5 T24 判据 2：标签目录与覆盖率', () => {
  it('CARD_EFFECT_TAGS 的 id 唯一、顺序与 tools 的 TAG_DEFS 逐条一致', () => {
    const onDisk = readText(TAGS_FILE);
    const ids = [...onDisk.matchAll(/\{ id: '([a-z-]+)', label: '([^']*)', group: '([^']*)' \}/g)]
      .map((m) => ({ id: m[1], label: m[2], group: m[3] }));
    expect(ids.length, '生成物里 CARD_EFFECT_TAGS 的条数').toBe(TAG_DEFS.length);
    expect(ids.map((x) => x.id)).toEqual(TAG_DEFS.map((x) => x.id));
    expect(ids, '生成物的 id/label/group 与 TAG_DEFS 漂移了').toEqual(
      TAG_DEFS.map((x) => ({ id: x.id, label: x.label, group: x.group })),
    );
    expect(new Set(ids.map((x) => x.id)).size, 'id 有重复').toBe(ids.length);
  });

  it('CARD_EFFECT_TAGS_BY_CARD 的键 == 卡面数据的 270 个 defId（码点序）', () => {
    const onDisk = readText(TAGS_FILE);
    const keys = [...onDisk.matchAll(/^ {2}'([a-z]+-[0-9]+)': \[/gm)].map((m) => m[1]);
    expect(DATA_IDS.length, '卡面数据的 defId 数').toBe(270);
    expect(keys.length, '生成物里的键数').toBe(270);
    expect(keys, '键序不是码点序 / 键集与卡面数据不一致').toEqual(DATA_IDS);
  });

  it('270/270 张卡至少有一个标签（含 4 张只有文本、没有代码钩子的持续型）', () => {
    const noTag = DATA_IDS.filter((id) => tagsOfCard(index, id).length === 0);
    expect(noTag, `这些卡一个标签都没有：${noTag.join(', ')}`).toEqual([]);
    // 那 4 张持续型必须**在**这份键集里，且拿到文本口径的标签（不是空数组）
    for (const id of index.passiveCards) {
      expect(DATA_IDS, `${id} 不在 270 个键里`).toContain(id);
      expect(tagsOfCard(index, id), `${id}（持续型限制）没有任何标签`).not.toEqual([]);
      expect(tagsOfCard(index, id), `${id} 应有文本口径的限制 / 无效化标签`).toContain('misc-restrict');
    }
  });

  it('每个标签至少命中 1 张卡（没有空标签）', () => {
    const hits = new Map(TAG_DEFS.map((t) => [t.id, 0]));
    for (const id of DATA_IDS) {
      for (const tag of tagsOfCard(index, id)) hits.set(tag, (hits.get(tag) ?? 0) + 1);
    }
    const empty = [...hits].filter(([, n]) => n === 0).map(([id]) => id);
    expect(empty, `这些标签一张卡都没命中：${empty.join(', ')}`).toEqual([]);
    // 反空转：总数必须远大于标签数（否则上面的遍历是假的）
    expect([...hits.values()].reduce((a, b) => a + b, 0)).toBeGreaterThan(TAG_DEFS.length * 5);
  });

  it('口径抽查：标签数、四个"只有一张卡"的标签、以及几个与分类文档对得上的数', () => {
    // 任务书 §1 的表格是 31 行（表头那句"共 28 个"与表格自身矛盾，报告里如实记了这条）
    expect(TAG_DEFS.length).toBe(31);
    const count = (tag: string): number => DATA_IDS.filter((id) => tagsOfCard(index, id).includes(tag)).length;
    expect(count('misc-window'), 'rearrangeSide 只有 momentum-4').toBe(1);
    expect(count('op-copy'), 'copyMiddle 只有 mirror-1').toBe(1);
    expect(count('trig-before-flip'), 'before-flip 只有 metal-6').toBe(1);
    expect(count('misc-declare'), '宣告只有幸运那两张').toBe(2);
    // 与分类文档 §2 的口径对齐（把那 4 张持续型算进去的 270 张口径）
    expect(count('dir-top')).toBe(49);
    expect(count('dir-middle')).toBe(222);
    expect(count('dir-bottom')).toBe(66);
    expect(count('misc-restrict'), '限制 / 无效化那 7 张').toBe(7);
  });

  it('标签来自代码事实（正控 + 反控）：op 标签认 op、不认卡面文字里的同名字', () => {
    // 正控：op-delete 的 28 张与生成物里查得到
    expect(DATA_IDS.filter((id) => tagsOfCard(index, id).includes('op-delete')).length).toBe(28);
    // 反控：`water-5` 卡面写"弃1张牌"、代码里是 discard ⇒ 它**有** op-discard
    expect(tagsOfCard(index, 'water-5')).toContain('op-discard');
    // 反控：`darkness-2` 卡面没有一个"数值修正"的字，但代码里是 valueModifier ⇒ 它**有** op-value
    expect(tagsOfCard(index, 'darkness-2')).toContain('op-value');
    // 反控：`light-5` 卡面同样是"弃1张牌"，但它确实有 discard 的 op（与上一条同族的正控）
    expect(tagsOfCard(index, 'light-5')).toContain('op-discard');
    // 反控：没登记的 id 返回空数组（不是 undefined、也不是全标签）
    expect(tagsOfCard(index, 'no-such-card-9')).toEqual([]);
  });
});
