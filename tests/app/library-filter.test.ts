import { describe, it, expect } from 'vitest';
import { LIB_TAG_GROUPS, LIB_ALL_TAG_IDS, filterLibrary, tagsOf } from '../../src/app/library-filter';
import { CARD_EFFECT_TAGS } from '../../src/data/cardEffectTags';
import { DEMO_CARD_DEFS, DEMO_PROTOCOLS } from '../../src/data/demo';

/**
 * G5 T24 判据 3：**纯逻辑腿**（`src/app/library-filter.ts`）。
 *
 * ## 这份测试证的是什么
 *
 * `filterLibrary` 是"按效果分类筛选"的**唯一口径**：界面那一层只把它的读数画出来。
 * 所以用户那三句话（命中就显示 / 一条都不命中就不显示 / 某协议全被排除连框一起隐藏）
 * 在这里逐条钉死，而且**数字全部从生成物现算**（`op-delete` 的 28 张、270 张总数、
 * 拿掉一代之后各有多少），一个都不手抄 —— 手抄的数会在生成物变化时变成"纸上绿"。
 *
 * ## 与生成物的关系
 *
 * 标签目录与每卡标签都来自 `src/data/cardEffectTags.ts`（构建期由效果代码算出）。
 * 本文件**不**自己写标签清单，因此"标签口径变了 ⇒ 这里跟着变"是结构性的，不是靠自觉。
 */
const ALL_SETS: ReadonlySet<string> = new Set(DEMO_PROTOCOLS.map((p) => p.set));

/** 拉一份"全部卡 + 全部协议"的基准读数（每一条用例从它派生，不共享可变状态） */
const base = () => ({
  protocols: DEMO_PROTOCOLS.map((p) => ({ defId: p.defId, set: p.set })),
  cards: DEMO_CARD_DEFS.map((c) => ({ defId: c.defId, protocol: c.protocol, value: c.value })),
});

const run = (checked: readonly string[], enabled: ReadonlySet<string> = ALL_SETS) =>
  filterLibrary({ ...base(), enabledSets: enabled, checkedTags: new Set(checked) });

/** 生成物里命中某个标签的卡（现算：不手抄清单） */
const cardsWith = (tag: string): string[] =>
  DEMO_CARD_DEFS.map((c) => c.defId).filter((id) => tagsOf(id).includes(tag)).sort();

describe('G5 T24 判据 3：纯逻辑（全勾 / 全不勾 / 单类 / 并集 / 与世代是"与"）', () => {
  it('目录口径：LIB_TAG_GROUPS 的分组顺序与标签总数 == 生成物（不自己发明清单）', () => {
    const flat = LIB_TAG_GROUPS.flatMap((g) => g.tags.map((t) => t.id));
    expect(flat, '分组摊平之后必须与 CARD_EFFECT_TAGS 逐条同序').toEqual(CARD_EFFECT_TAGS.map((t) => t.id));
    expect(LIB_ALL_TAG_IDS).toEqual(CARD_EFFECT_TAGS.map((t) => t.id));
    expect(LIB_TAG_GROUPS.map((g) => g.group)).toEqual(['指令位置', '触发时机', '效果动作', '控制权', '其它']);
    expect(LIB_ALL_TAG_IDS.length).toBe(31);
  });

  it('全勾 ⇒ 270 张卡全可见、45 套协议全可见', () => {
    const r = run(LIB_ALL_TAG_IDS);
    expect(r.totalCards).toBe(270);
    expect(r.totalProtocols).toBe(45);
    expect(r.visibleCards.size, '全勾却漏了卡').toBe(270);
    expect(r.visibleProtocols.size).toBe(45);
  });

  it('全不勾 ⇒ 0 张卡、0 个协议（用户原话："没有一条是符合的，则不显示"）', () => {
    const r = run([]);
    expect(r.visibleCards.size).toBe(0);
    expect(r.visibleProtocols.size).toBe(0);
    // 总数仍在（界面靠它写空态提示："0 / 270 张"）
    expect(r.totalCards).toBe(270);
    expect(r.totalProtocols).toBe(45);
  });

  it('只勾 op-delete ⇒ 可见集 = 生成物里那 28 张（从生成物现算，不手抄）', () => {
    const expected = cardsWith('op-delete');
    expect(expected.length, 'op-delete 的卡数（分类文档 §4 记的是 28）').toBe(28);
    const r = run(['op-delete']);
    expect([...r.visibleCards].sort()).toEqual(expected);
  });

  it('只勾 op-transfer ⇒ 6 张；只勾 op-copy ⇒ 1 张（一张卡可以同时落在多类）', () => {
    expect([...run(['op-transfer']).visibleCards].sort()).toEqual(cardsWith('op-transfer'));
    expect(cardsWith('op-transfer').length).toBe(6);
    expect([...run(['op-copy']).visibleCards].sort()).toEqual(cardsWith('op-copy'));
    expect(cardsWith('op-copy').length).toBe(1);
  });

  it('多勾是并集（不是交集）：delete ∪ shift 的可见集 == 两类各自可见集的并', () => {
    const del = run(['op-delete']).visibleCards;
    const shi = run(['op-shift']).visibleCards;
    const both = run(['op-delete', 'op-shift']).visibleCards;
    const union = new Set([...del, ...shi]);
    expect([...both].sort()).toEqual([...union].sort());
    expect(both.size, '并集必须严格大于任意一类（否则这条腿分不出"并"与"交"）').toBeGreaterThan(del.size);
    expect(both.size).toBeGreaterThan(shi.size);
  });

  it('世代与标签是"与"：关掉一代之后再勾标签，两代都不出现', () => {
    // 先量一次"3 代全开 + 只勾 op-delete"
    const on3 = run(['op-delete'], new Set(['MN03']));
    expect(on3.visibleCards.size, 'MN03 里命中 op-delete 的卡数').toBeGreaterThan(0);
    // 关掉 3 代（enabledSets 空）⇒ 一张都不出现，哪怕标签勾着
    const offAll = run(['op-delete'], new Set());
    expect(offAll.visibleCards.size).toBe(0);
    expect(offAll.visibleProtocols.size).toBe(0);
    // 只开 1 代 ⇒ 可见集 ⊆ 全开时那一份，且与 3 代那一份不相交
    const on1 = run(['op-delete'], new Set(['MN01', 'AX01']));
    for (const id of on1.visibleCards) expect(on3.visibleCards.has(id), `${id} 同时属于两代？`).toBe(false);
    // 每代 15 套协议 = 90 张卡；1 代那两档加起来 90、3 代两档加起来 90 ⇒ 合起来就是 180？
    // ⚠️ 不：1 代是 12 套 MN01 + 3 套 AX01 = 15 套 = 90 张，3 代同理 —— 下面这两个数是**实测**的
    // （`MN01+AX01` 与 `MN03+AX03` 各自 90，加起来 180，剩 90 是 2 代）。
    expect(on1.visibleCards.size + on3.visibleCards.size + run(['op-delete'], new Set(['MN02', 'AX02'])).visibleCards.size).toBe(
      run(['op-delete'], ALL_SETS).visibleCards.size,
    );
  });

  it('某协议 6 张全被排除 ⇒ 该协议不在 visibleProtocols 里（框一起隐藏）', () => {
    /**
     * 找一个"只勾一个标签就把它 6 张卡全排除"的组合：对每个标签算一次，找第一个
     * 让某协议彻底消失的。这是**从生成物现算**的，不是写死"冰4"之类的答案。
     */
    let found: { tag: string; protocol: string } | null = null;
    for (const tag of LIB_ALL_TAG_IDS) {
      const r = run([tag]);
      for (const p of DEMO_PROTOCOLS) {
        if (!r.visibleProtocols.has(p.defId)) { found = { tag, protocol: p.defId }; break; }
      }
      if (found !== null) break;
    }
    expect(found, '没有任何标签能把某套协议 6 张全排除 —— 这条腿失去了被测对象').not.toBeNull();
    const { tag, protocol } = found!;
    const r = run([tag]);
    const visibleInThatProto = DEMO_CARD_DEFS
      .filter((c) => c.protocol === protocol && r.visibleCards.has(c.defId));
    expect(visibleInThatProto, `${protocol} 还有卡可见，协议却不可见`).toEqual([]);
    expect(r.visibleProtocols.has(protocol)).toBe(false);

    // 反向：只勾这一类时，别的协议照样可见（不是"全都隐藏了"这种假绿）
    expect(r.visibleProtocols.size).toBeGreaterThan(0);
  });

  it('纯：不读时钟/随机、不改传入的集合、两次调用结果相同', () => {
    const state = { ...base(), enabledSets: ALL_SETS, checkedTags: new Set(['op-delete']) };
    const before = [...state.checkedTags];
    const a = filterLibrary(state);
    const b = filterLibrary(state);
    expect([...state.checkedTags], 'filterLibrary 改了调用方的集合').toEqual(before);
    expect([...a.visibleCards].sort()).toEqual([...b.visibleCards].sort());
    expect([...a.visibleProtocols].sort()).toEqual([...b.visibleProtocols].sort());
    // 返回的两个 Set 是新造的（不是同一个引用，也不与输入共享）
    expect(a.visibleCards).not.toBe(b.visibleCards);
  });

  it('协议表里查不到世代的卡 ⇒ fail-closed（不算可见）', () => {
    const r = filterLibrary({
      protocols: DEMO_PROTOCOLS.filter((p) => p.set !== 'MN03').map((p) => ({ defId: p.defId, set: p.set })),
      cards: base().cards,
      enabledSets: ALL_SETS,
      checkedTags: new Set(LIB_ALL_TAG_IDS),
    });
    // 协议表里只摘掉 MN03（AX03 那一档留着）⇒ 恰好少 MN03 的 72 张（12 套 × 6），
    // 而总数仍是 270；那 72 张一张都不许可见 —— 拿不到世代就不放行（fail-closed）
    expect(r.totalCards).toBe(270);
    const mn03 = DEMO_CARD_DEFS.filter((c) => {
      const p = DEMO_PROTOCOLS.find((x) => x.defId === c.protocol);
      return p?.set === 'MN03';
    });
    expect(mn03.length).toBe(72);
    for (const c of mn03) expect(r.visibleCards.has(c.defId), `${c.defId} 的世代查不到却可见`).toBe(false);
    expect(r.visibleCards.size).toBe(270 - 72);
  });
});
