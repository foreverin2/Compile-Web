import { describe, it, expect, afterEach } from 'vitest';
import { installStubDom, makeStubEl, descendants, queryAllIn, type StubNode } from '../ui/net-dom-stub';
import { renderLocalData, type LocalDataNav } from '../../src/ui/local-data';
import { createLocalStore, readLang, writeLang, type LocalStore } from '../../src/app/local-store';
import { L1_SETTINGS, createMemoryStore, type KeyValueStore } from '../../src/app/storage';
import { CARD_DATA_HASH } from '../../src/app/card-data-hash';
import { MATCH_FILE_FORMAT, MATCH_FILE_VERSION, type MatchFile } from '../../src/app/match-file';
import type { FilePicker, FileSink } from '../../src/app/archive-fs';
import { DEFAULT_LANG, LANGS, setLang } from '../../src/i18n';
import { ZH, EN } from '../../src/i18n';

/**
 * ★ 2026-10-01（P0）：**新存储必须出现在「本地数据与隐私」屏**（可见 + 可清除）。
 *
 * 用户口径（方案 `docs/2026-10-01-新手引导与教学-方案.md` §6）：新加的存储每一项都要在那屏里
 * 看得见、清得掉，否则 `tests/ui/local-data-screen.test.ts` 与 `privacy-consumers.test.ts` 会挡。
 *
 * ## 核清结论（P0 只做"核清 + 补缺口"，不动既有判据）
 *
 * 语言的存储**不是一个新键** —— 它是既有 `L1_SETTINGS`（`compile-settings`）对象里的一个字段
 * `lang`（`src/app/local-store.ts` 的 `L1Settings`）。所以：
 *
 *  - **可清除**：`clearAllLocalData` 清的就是 `L1_SETTINGS` 整键 ⇒ **本来就覆盖**了语言。
 *    这一半**不需要改代码**；本文件用"真的清一次、读回 `undefined`、屏上当场变回默认"
 *    把它钉住（原来没有任何腿盯着这件事）。
 *  - **可见**：原来那屏上**没有**语言这一行 ⇒ 这一半是**缺的**，P0 补上
 *    （`renderLocalData` 里的 `[data-role=lang]` / `[data-role=lang-state]`）。
 *
 * ## 为什么不写进 `tests/ui/local-data-screen.test.ts`
 *
 * 那个文件的渲染夹具（`harness()`）没有导出；把它改成"可复用夹具"是一次**没有收益的重构**
 * （那个文件的头注写着它刻意各写一份局部助手，理由是"8 行重复优于跨任务耦合"）。
 * ⇒ 这里按同一套口径**自己搭最小夹具**，并通过 `renderLocalData` 这个**真出口**跑，
 * 一行被测逻辑都不复制。
 *
 * ## 能力边界（如实声明）
 *
 * 能：`readLang` → 屏上那一行、`clearAllLocalData` → 屏上那一行，两条链在真代码上真跑。
 * 不能：真实浏览器里的观感；也不能证明"屏上那一行与设置小窗里的语言永远是同一个值"
 * （那是同一个 `readLang` 的两个消费者，由 `tests/i18n/settings-overlay.test.ts` 与
 * `tests/i18n/tables.test.ts` 的存储组分别盯着）。
 */

const restores: Array<() => void> = [];

afterEach(() => {
  while (restores.length > 0) restores.pop()?.();
});

/* ───────────────────────────── 最小夹具 ───────────────────────────── */

const sampleFile = (): MatchFile => ({
  format: MATCH_FILE_FORMAT,
  version: MATCH_FILE_VERSION,
  cardDataHash: CARD_DATA_HASH,
  seed: 'abcdef0123456789',
  setup: {
    draftMode: 'normal',
    draftStarter: 0,
    firstToPlay: 1,
    draftPool: ['water'],
    draftPicks: ['water'],
    bannedProtocols: [],
  },
  players: [{ nick: '甲' }, { nick: '乙' }],
  actions: [{ seq: 0, player: 0, kind: 'advance', via: 'user' }],
  createdAt: '2026-10-01T00:00:00.000Z',
});

/** 本文件只测语言那一行 ⇒ 其余 nav 接缝给"什么都不做"的最小实现（并如实标注） */
function navFor(store: LocalStore): LocalDataNav {
  const pickFile: FilePicker = {
    open: async () => ({ ok: false, reason: 'cancelled', detail: '本文件不测档案' }),
  };
  const saveFile: FileSink = {
    save: async (o) => ({ ok: false, reason: 'cancelled', detail: `本文件不测导出（${o.suggestedName}）` }),
  };
  return {
    back: () => { /* 不测导航 */ },
    store,
    pickFile,
    saveFile,
    onImported: () => { /* 不测导入 */ },
    startReplay: () => { /* 不测重放 */ },
    buildArchive: () => ({ file: sampleFile() }),
    readCardmaker: async () => ({ count: 0 }),
    clearCardmaker: async () => ({ ok: true, removed: false }),
  };
}

interface Mounted {
  readonly root: StubNode;
  readonly store: LocalStore;
  readonly kv: KeyValueStore;
  /** 再画一帧（本屏是整屏屏：`renderLocalData` 第一句就清 root） */
  redraw(): void;
  count(role: string): number;
  text(role: string): string;
  click(role: string): void;
  statusCode(): string;
}

function mount(kv: KeyValueStore = createMemoryStore()): Mounted {
  restores.push(installStubDom());
  const store = createLocalStore({ persistent: kv });
  store.grant();
  const root = makeStubEl('div');
  const redraw = (): void => {
    renderLocalData(root as unknown as HTMLElement, navFor(store));
  };
  redraw();
  const byRole = (r: string): StubNode[] => queryAllIn(root, `[data-role="${r}"]`);
  return {
    root,
    store,
    kv,
    redraw,
    count: (r) => byRole(r).length,
    text: (r) => {
      const hits = byRole(r);
      expect(hits.length, `屏上应有唯一一个 [data-role=${r}]，实际 ${hits.length} 个`).toBe(1);
      return descendants(hits[0]).map((n) => n.text).join('');
    },
    click: (r) => {
      const hits = byRole(r);
      expect(hits.length, `屏上应有唯一一个 [data-role=${r}]，实际 ${hits.length} 个`).toBe(1);
      const btn = hits[0];
      // ⚠️ 桩的 `dispatchEvent` **不调用派发节点自己的监听器**（只沿 `parentElement` 向上冒泡）
      //    ⇒ 临时挂一个空子节点、在它上面派发，让冒泡路径经过目标按钮
      //    （与 `tests/ui/local-data-screen.test.ts` 的 `clickRole` 同源）。
      const clicker = makeStubEl('span');
      btn.appendChild(clicker);
      clicker.dispatchEvent({ type: 'click', target: clicker });
    },
    statusCode: () => byRole('status')[0].dataset.code,
  };
}

/* ==================================================================== *
 * 1. 可见
 * ==================================================================== */

describe('★ P0：语言在「本地数据与隐私」屏上**可见**', () => {
  it('屏上有一块语言，且读数取自 `readLang`（真写一次、重画一帧、真读一次）', () => {
    const m = mount();
    expect(m.count('lang'), '屏上没有语言这一块').toBe(1);
    expect(m.count('lang-state'), '屏上没有语言读数这一行').toBe(1);
    // 新访客没设过 ⇒ 默认语言（中文）
    expect(m.text('lang-state'), '没设过语言时没显示默认语言').toContain(LANGS[0].label);
    expect(m.text('lang-state'), '没设过语言时没显示"界面语言"这个标签').toContain('界面语言');

    // 写 en ⇒ 重画一帧 ⇒ 屏上必须跟着变（读数真的来自本机，不是写死的）
    writeLang(m.store, 'en');
    m.redraw();
    expect(m.text('lang-state'), '本机存的是 en，重画之后屏上还显示中文').toContain('English');
    expect(m.text('lang-state')).not.toContain(LANGS[0].label);
  });

  /* ── ★ 2026-10-01（P0 线上验收 D1）：**五种形态**逐条钉住 ────────────────────
   *
   * 缺陷：`isLang(raw) ? '' : tail` 在 `raw === undefined` 时也命中，而 `readLang()` 把
   * "键不存在"与"值是坏值"**都回成 `undefined`** ⇒ 全新访客与刚点完「清除本机数据」的人
   * 都看到「（本机存的不是一个有效值，按默认语言显示）」。
   *
   * 下面五条一一对应线上实测的那五种形态。**关键的两条**是"缺键"与"坏值"必须给出
   * **不同**的屏文 —— 只测其中一条的话，"两种形态折叠回一句"这种回归照样能过。
   */
  it('D1·形态①（**缺键**：全新访客 / 刚清除完 / 从没切过）⇒ 就一句「界面语言：中文」，**不许**有那句警告', () => {
    const m = mount(); // 全新：`compile-settings` 这个键根本不存在
    expect(m.kv.get(L1_SETTINGS), '前置：这条腿要的是"键不存在"').toBeNull();
    const text = m.text('lang-state');
    expect(text, '缺键时没显示语言').toContain(`界面语言：${LANGS[0].label}`);
    expect(text, '缺键时挂了"不是一个有效值"那句（这正是线上验收 D1 的缺陷）')
      .not.toContain('不是一个有效值');
    expect(text, '缺键时挂了"无效值"的散文（换个措辞也算同一个缺陷）').not.toContain('有效值');
  });

  it('D1·形态①b（**刚点完清除**）⇒ 与全新访客同一句话，不许有那句警告', () => {
    const m = mount();
    writeLang(m.store, 'en');
    m.redraw();
    expect(m.text('lang-state')).toContain('English');
    m.click('clear');
    m.click('clear-yes');
    const text = m.text('lang-state');
    expect(text, '清除之后没回到默认语言').toContain(`界面语言：${LANGS[0].label}`);
    expect(text, '清除之后挂了"不是一个有效值"那句（D1 的现场之一）').not.toContain('不是一个有效值');
  });

  it('D1·形态①c（键在、但**没有 `lang` 字段**：只存过昵称的 `{"nick":"甲"}`）⇒ 不许挂警告', () => {
    // ★ 用户 2026-10-01 的裁决：那种情况下本机**从来没有**存过语言，
    //   说"存的不是一个有效值"是不实陈述（与"缺键"是同一件事）。
    const kv = createMemoryStore();
    kv.set(L1_SETTINGS, JSON.stringify({ nick: '甲' }));
    const m = mount(kv);
    const text = m.text('lang-state');
    expect(text, '没显示默认语言').toContain(`界面语言：${LANGS[0].label}`);
    expect(text, '只存过昵称却被告知"不是一个有效值"（用户裁定：不许）').not.toContain('不是一个有效值');
    // 反向锚点：这份存储**确实**是"有设置、但没有语言"那一档（否则上面那条测的是缺键）
    expect(m.kv.get(L1_SETTINGS), '前置：这条腿要的是"键在"').not.toBeNull();
    expect(m.kv.get(L1_SETTINGS)).toContain('甲');
  });

  it('D1·形态②（`{"lang":"xx"}` 键在、值不是 zh/en）⇒ 默认语言 + **要**挂那句警告', () => {
    const kv = createMemoryStore();
    kv.set(L1_SETTINGS, JSON.stringify({ lang: 'xx' }));
    const m = mount(kv);
    const text = m.text('lang-state');
    expect(text, '坏值被静默显示成中文（玩家会以为自己的选择丢了）').toContain('不是一个有效值');
    expect(text).toContain(LANGS[0].label);
  });

  it('D1·形态③（坏 JSON）⇒ 默认语言 + **要**挂那句警告', () => {
    const kv = createMemoryStore();
    kv.set(L1_SETTINGS, '{oops');
    const m = mount(kv);
    const text = m.text('lang-state');
    // 坏 JSON 是一段**坏数据**（不是"没设置过"）⇒ 要挂那句
    expect(text, '坏 JSON 时没说"不是一个有效值"').toContain('不是一个有效值');
    expect(text).toContain(LANGS[0].label);
  });

  it('D1·非对象（`42` / 数组）⇒ 同"坏数据"一档，也要挂那句', () => {
    for (const raw of ['42', '"x"', '[1,2]']) {
      const kv = createMemoryStore();
      kv.set(L1_SETTINGS, raw);
      const m = mount(kv);
      expect(m.text('lang-state'), `${raw} 没按"坏数据"处理`).toContain('不是一个有效值');
    }
  });

  it('D1·形态④⑤（`{"lang":"zh"}` / `{"lang":"en"}`）⇒ 各自的标签，**都不许**有那句警告', () => {
    for (const [id, label] of [['zh', LANGS[0].label], ['en', LANGS[1].label]] as const) {
      const kv = createMemoryStore();
      kv.set(L1_SETTINGS, JSON.stringify({ lang: id }));
      const m = mount(kv);
      const text = m.text('lang-state');
      expect(text, `${id} 没显示成 ${label}`).toContain(label);
      expect(text, `${id} 时挂了"不是一个有效值"那句（有效值不该挂）`).not.toContain('不是一个有效值');
    }
  });

  it('D1·反向验证：**缺键 / 没设过语言 / 坏值** 三种屏文两两可分（折叠回两句就红）', () => {
    // 这一条是那一堆形态腿的灵魂：只测"缺键无警告"或只测"坏值有警告"时，
    // `isLang(raw) ? '' : tail` 那种写法**仍然可能两边都过**（它恰好对坏值是对的）。
    // ⇒ 把三种情形的屏文**并排**比一次，并钉住"干净那一句"只有一种写法。
    const absent = mount(); // 键不存在
    const kvUnset = createMemoryStore();
    kvUnset.set(L1_SETTINGS, JSON.stringify({ nick: '甲' }));
    const unset = mount(kvUnset); // 键在、没有 lang
    const kvBad = createMemoryStore();
    kvBad.set(L1_SETTINGS, JSON.stringify({ lang: 'xx' }));
    const bad = mount(kvBad); // 键在、值是坏值

    const clean = `界面语言：${LANGS[0].label}`;
    expect(absent.text('lang-state'), '缺键那句该是干净的一句').toBe(clean);
    expect(unset.text('lang-state'), '「没设过语言」该与缺键同一句').toBe(clean);
    expect(
      bad.text('lang-state'),
      '坏值与"没设过语言"给出了同一句话 ⇒ 判据分不出这两种情形',
    ).not.toBe(clean);
    expect(bad.text('lang-state')).toContain('不是一个有效值');
  });

  it('★ D4：语言这一行走 `t()`（切到英文时它跟着变，中英逐字）', () => {
    // 这一屏**没有做过 i18n**（只抽了设置小窗）—— 但语言这一行是**语言功能自己的读数**，
    // 必须双语。判据：切到 en 之后这一行是英文的那一句（逐字），且中文的那些字不许留着。
    const kv = createMemoryStore();
    const m = mount(kv);
    setLang('en');
    m.redraw();
    expect(m.text('lang-state'), '切到英文后语言那一行还是中文').toBe('Interface language: 中文');
    // 标签也在那一块里（`m.text('lang')` 会把标签与读数**拼起来**，这是本夹具的口径）
    expect(m.text('lang'), '语言那一行的标签没跟着语言走')
      .toBe('Interface languageInterface language: 中文');
    // 反向：中文那一版逐字
    setLang(DEFAULT_LANG);
    m.redraw();
    expect(m.text('lang-state')).toBe('界面语言：中文');
    expect(m.text('lang')).toBe('界面语言界面语言：中文');
  });

  it('★ D4：英文下**坏值**那句也是英文（不许英文界面夹中文）', () => {
    const kv = createMemoryStore();
    kv.set(L1_SETTINGS, JSON.stringify({ lang: 'xx' }));
    const m = mount(kv);
    setLang('en');
    m.redraw();
    const text = m.text('lang-state');
    expect(text).toBe('Interface language: 中文 (the value on this device is not valid, so the default is shown)');
    expect(text, '英文界面的语言那一行夹了中文散文').not.toMatch(/不是一个有效值/);
    setLang(DEFAULT_LANG);
  });

  it('语言与昵称**同住一个键**：屏上"本机已保存"那一行仍然只说昵称与卡组（语言自成一行）', () => {
    // 这一条挡的是"顺手把语言塞进 stored 那一行"的写法：那会让"本机已保存：昵称…卡组…"
    // 这句话里多出一个字段，而 `local-data-screen.test.ts` 有几条腿逐字读那一行。
    const m = mount();
    writeLang(m.store, 'en');
    m.redraw();
    expect(m.text('stored'), '语言被塞进了"本机已保存"那一行').not.toContain('English');
    expect(m.text('lang-state')).toContain('English');
  });

  it('本机存的是坏值时如实说"不是一个有效值"，并按默认语言显示（不假装）', () => {
    const kv = createMemoryStore();
    kv.set(L1_SETTINGS, JSON.stringify({ lang: 'xx' }));
    const m = mount(kv);
    expect(m.text('lang-state'), '坏值被静默显示成中文（玩家会以为自己的选择丢了）')
      .toContain('不是一个有效值');
    expect(m.text('lang-state')).toContain(LANGS[0].label);
  });

  it('读取抛错 ⇒ 如实显示失败原因（不静默、不崩）', () => {
    const base = createMemoryStore();
    const boom: KeyValueStore = {
      get: (k: string): string | null => {
        if (k === L1_SETTINGS) throw new Error('存储不可用（本机数据屏的语言行）');
        return base.get(k);
      },
      set: (k: string, v: string): void => { base.set(k, v); },
      remove: (k: string): void => { base.remove(k); },
      keys: (): string[] => base.keys(),
    };
    const m = mount(boom);
    expect(m.text('lang-state'), '读取抛错时没把真因写出来').toContain('存储不可用（本机数据屏的语言行）');
  });
});

/* ==================================================================== *
 * 2. 可清除（核清：语言在 `L1_SETTINGS` 整键里 ⇒ 本来就覆盖）
 * ==================================================================== */

describe('★ P0：语言**可清除**（核清：它在既有 `L1_SETTINGS` 整键里）', () => {
  it('「清除本机数据」之后 `readLang` 回 `undefined`（不需要新的清除代码）', () => {
    const m = mount();
    writeLang(m.store, 'en');
    expect(readLang(m.store)).toBe('en');
    m.click('clear');
    m.click('clear-yes');
    expect(m.statusCode(), '清除根本没有成功').toBe('clear-ok');
    expect(readLang(m.store), '清除本机数据之后语言还在').toBe(undefined);
    expect(m.kv.get(L1_SETTINGS), '设置那个键没被清掉').toBeNull();
  });

  it('清除之后那一行**当场**显示回默认语言（不刷新就看得出来）', () => {
    const m = mount();
    writeLang(m.store, 'en');
    m.redraw();
    expect(m.text('lang-state')).toContain('English');

    m.click('clear');
    m.click('clear-yes');
    expect(m.text('lang-state'), '清除之后语言那一行还显示着 English').toContain(LANGS[0].label);
    expect(m.text('lang-state'), '清除之后还显示着 English').not.toContain('English');
  });

  it('没设过语言时清除也照常（`clear-failed` 之外没有别的结论）', () => {
    const m = mount();
    m.click('clear');
    m.click('clear-yes');
    // 设置键不存在 ⇒ 清掉的项数少，但结论仍然是"清完了"（不是失败）
    expect(m.statusCode()).toBe('clear-ok');
    expect(m.text('lang-state')).toContain(LANGS[0].label);
  });
});
