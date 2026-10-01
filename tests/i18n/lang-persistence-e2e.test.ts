import { describe, it, expect, afterEach } from 'vitest';
import { installStubDom, makeStubEl, descendants, queryAllIn, type StubNode } from '../ui/net-dom-stub';
import { openL1Store, type StorageLike } from '../../src/ui/local-store-browser';
import { createLocalStore, readLang, writeLang } from '../../src/app/local-store';
import { settingsOverlayElement } from '../../src/ui/home';
import { DEFAULT_LANG, getLang, initI18n, setLang, t } from '../../src/i18n';

/**
 * ★ 2026-10-01（P0）：**端到端**那条链 —— 把 P0 的四条产品承诺连起来真跑一遍。
 *
 * P0 的承诺是"能切语言；切了立即生效；关掉再打开、**刷新之后**语言保持；中文行为与今天逐字一致"。
 * 单独看，每一半都有自己的腿（`tables.test.ts` 管表与存储、`settings-overlay.test.ts` 管小窗），
 * 但**把整条链跑完**的腿只有这一条：
 *
 * ```
 * openL1Store(真 localStorage 假件) → createLocalStore → grant
 *   → initI18n(readLang(store)) → settingsOverlayElement(nav.lang = getLang())
 *   → 点 English → setLang + writeLang → 同一棵树当场变英文
 *   → 磁盘上真的有 {"lang":"en"} → 重新启动（新 store + 新小窗）⇒ 就是英文
 * ```
 *
 * ## 为什么用**假的 localStorage 假件**而不是真浏览器
 *
 * 本仓没有 jsdom（`vite.config.ts` 的 `environment: 'node'`），DOM 用 `tests/ui/net-dom-stub.ts`
 * 的手写桩。存储这一侧用 `openL1Store({ localStorage: () => … })` 这个**本来就有的注入缝**
 * （`src/ui/local-store-browser.ts` 的 `L1StoreEnv`）—— 于是这里跑的是 `openL1Store` 的**真实现**，
 * 不是替身。`localStorage` 假件只实现 `StorageLike` 声明的那几个成员，与
 * `tests/ui/local-store-browser.test.ts` 的假件同形（那一份没有导出，所以这里按同一口径再写一份）。
 *
 * ## 不能证明什么（如实声明）
 *
 *  - 不能证明真实浏览器里的观感（遮罩层叠、Esc 冒泡路径、焦点归还）—— 那是人眼验收那一格；
 *  - 不能证明宿主（`src/main.ts`）那两行与本文件里的照抄**逐字一致** —— 那一面由
 *    `tests/i18n/settings-overlay.test.ts` 第 4 组的**源码结构腿**盯着，
 *    本文件管的是"**那条链本身成立**"（手法与 `local-data-screen.test.ts` 的贯通腿同款）。
 */

const restores: Array<() => void> = [];

afterEach(() => {
  while (restores.length > 0) restores.pop()?.();
  setLang(DEFAULT_LANG);
});

/** `StorageLike` 的最小假件（与 `tests/ui/local-store-browser.test.ts` 的假件同形） */
interface FakeStorage extends StorageLike {
  snapshot(): Record<string, string>;
}

function fakeStorage(): FakeStorage {
  const m = new Map<string, string>();
  return {
    getItem: (k) => (m.has(k) ? (m.get(k) as string) : null),
    setItem: (k, v) => { m.set(k, v); },
    removeItem: (k) => { m.delete(k); },
    key: (i) => [...m.keys()][i] ?? null,
    get length() { return m.size; },
    snapshot: () => Object.fromEntries(m),
  };
}

/** 树里所有节点的文本（按 DOM 顺序） */
function textOf(n: StubNode): string {
  return descendants(n).map((x) => x.text).join('\n');
}

/** 在某个节点上真派发一次点击（桩的 `dispatchEvent` 不调用派发节点自己的监听器） */
function clickIn(target: StubNode): void {
  const clicker = makeStubEl('span');
  target.appendChild(clicker);
  clicker.dispatchEvent({ type: 'click', target: clicker });
}

/** 按 `data-lang` 找语言按钮 */


function langBtn(overlay: StubNode, id: string): StubNode {
  const hits = descendants(overlay).filter((n) => n.dataset.lang === id);
  expect(hits.length, `找不到语言按钮 ${id}`).toBe(1);
  return hits[0];
}

/**
 * 造一个"应用启动一帧"：真的 `openL1Store` + 真的 `createLocalStore` + 真的 `settingsOverlayElement`。
 *
 * `onLangChange` 按 `src/main.ts` 的 `applyLangChange` **同一口径**写（换内存态 + 落盘 +
 * 把**真因**放进 `detail` + 返回写盘结论）；这里**不**重画背景那一屏（node 下没有 `#app`
 * 与 `renderMode`），那一面由源码结构腿盯着。
 */
function boot(ls: FakeStorage): { readonly overlay: StubNode; readonly store: ReturnType<typeof createLocalStore> } {
  const store = createLocalStore({ persistent: openL1Store({ localStorage: () => ls }) });
  store.grant();
  initI18n(() => readLang(store));
  const overlay = settingsOverlayElement({
    onClose: () => { /* 本文件不测关闭 */ },
    lang: getLang(),
    onLangChange: (next) => langChangeFor(store)(next),
  }) as unknown as StubNode;
  return { overlay, store };
}

/**
 * `applyLangChange` 的**同口径**实现（本文件里唯一的写法，`boot()` 与游客模式那条腿共用）。
 *
 * ⚠️ `detail` 必须是**真因**（`String(e)`），不能写死一句话 —— 第一版写死了
 * `'本机存储拒绝写入'`，于是"小窗有没有把真因显示出来"这条判据在桩上恒真（假绿）。
 */
function langChangeFor(store: ReturnType<typeof createLocalStore>): (next: 'zh' | 'en') => { ok: boolean; detail?: string } {
  return (next) => {
    setLang(next);
    let ok = false;
    let detail: string | undefined;
    try {
      ok = writeLang(store, next);
    } catch (e) {
      detail = e instanceof Error ? e.message : String(e);
    }
    return ok ? { ok: true } : { ok: false, detail: detail ?? '本机存储拒绝写入（配额已满或隐私模式）' };
  };
}

describe('★ P0 端到端：切语言 → 落盘 → 刷新之后还在', () => {
  it('整条链跑一次：默认中文 → 点 English → 同一棵树变英文 → 盘上有 lang → 重启就是英文', () => {
    restores.push(installStubDom());
    const ls = fakeStorage();

    // ① 第一次启动：默认中文
    const first = boot(ls);
    expect(getLang(), '默认语言不是中文').toBe(DEFAULT_LANG);
    expect(textOf(first.overlay), '第一次启动的小窗不是中文').toContain('设置');
    expect(textOf(first.overlay), '语言那一行不在小窗里').toContain('语言 / Language');
    expect(queryAllIn(first.overlay, '.settings-lang-btn').length, '两个语言选项').toBe(2);

    // ② 点 English：同一棵树当场变英文
    clickIn(langBtn(first.overlay, 'en'));
    expect(getLang(), '点了 English 内存态没换').toBe('en');
    expect(textOf(first.overlay), '同一棵树没变成英文（"立即生效"这一半没做到）').toContain('Settings');
    expect(t('settings.close')).toBe('Close');

    // ③ 落盘：磁盘上真的有 lang（不是"只在内存里对"）
    expect(ls.snapshot()['compile-settings'], '语言没落到 compile-settings').toContain('"lang":"en"');
    expect(ls.snapshot()['compile-consent'], '授权标记也应在（grant 写的）').toBe('allowed');

    // ④ 重新启动（同一个 localStorage，全新 store + 全新小窗）⇒ 就是英文
    setLang(DEFAULT_LANG); // 模拟"整页重载之后模块内存态复位"
    const again = boot(ls);
    expect(again.store.consent(), '上一轮点过允许 ⇒ 启动时直接是 allowed').toBe('allowed');
    expect(getLang(), '刷新之后语言没读回来').toBe('en');
    expect(textOf(again.overlay), '刷新之后小窗不是英文').toContain('Settings');
    expect(textOf(again.overlay), '刷新之后还留着中文标题').not.toContain('\n设置\n');
  });

  it('中文那一版与"没有 i18n 之前"逐字一致（既有测试零改动的前提）', () => {
    restores.push(installStubDom());
    const { overlay } = boot(fakeStorage());
    // 这两句是既有测试逐字钉住的（`tests/ui/local-data-screen.test.ts` 第 9 组）
    expect(descendants(overlay).map((n) => n.text)).toContain('关闭');
    expect(textOf(overlay)).toContain('改动只在本次会话有效，刷新后回到默认开启。');
    expect(textOf(overlay)).toContain('金属6 频闪特效');
  });

  it('游客模式（deny）：切语言本次会话生效、磁盘上**一个字节都不写**（红线 3）', () => {
    restores.push(installStubDom());
    const ls = fakeStorage();
    const store = createLocalStore({ persistent: openL1Store({ localStorage: () => ls }) });
    store.deny();
    initI18n(() => readLang(store));
    const overlay = settingsOverlayElement({
      onClose: () => { /* 不测关闭 */ },
      lang: getLang(),
      onLangChange: (next) => langChangeFor(store)(next),
    }) as unknown as StubNode;

    clickIn(langBtn(overlay, 'en'));
    expect(getLang(), '游客模式下切语言不生效（"本次会话有效"这一半）').toBe('en');
    expect(ls.snapshot(), '游客模式下切语言碰了 localStorage（红线 3）').toEqual({});
    // 刷新 ⇒ 内存 KV 没了，语言回到默认（这正是"刷新即丢"）
    setLang(DEFAULT_LANG);
    const store2 = createLocalStore({ persistent: openL1Store({ localStorage: () => ls }) });
    expect(initI18n(() => readLang(store2)), '游客模式的语言竟然活过了刷新').toBe(DEFAULT_LANG);
  });

  it('写失败（存储只读）⇒ 本次会话仍然生效 + 小窗如实提示，盘上没写进去', () => {
    restores.push(installStubDom());
    const ls = fakeStorage();
    // 让 `setItem` 对设置那个键抛（模拟配额满 / Safari 隐私模式）
    const original = ls.setItem;
    ls.setItem = (k: string, v: string): void => {
      if (k === 'compile-settings') throw new Error('QuotaExceededError（配额已满）');
      original(k, v);
    };
    const { overlay } = boot(ls);
    clickIn(langBtn(overlay, 'en'));
    expect(getLang(), '写失败时本次会话应当仍然用新语言').toBe('en');
    const status = descendants(overlay).find((n) => n.dataset.role === 'lang-status');
    expect(status, '小窗里没有写盘失败的位置').toBeDefined();
    expect(status?.text, '写失败时没有提示').toContain('could not be saved');
    expect(status?.text, '没把真因写出来').toContain('配额已满');
    expect(ls.snapshot()['compile-settings'], '写失败却写进去了').toBeUndefined();
  });
});
