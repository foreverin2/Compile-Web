import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { stripComments, functionBody } from '../ui/source-text';
import {
  installStubDom,
  makeStubEl,
  descendants,
  classOf,
  isClass,
  type StubNode,
} from '../ui/net-dom-stub';
import {
  LANG_CHANGE_OK,
  applyWriteResult,
  langChangeThrew,
  settingsOverlayElement,
  type LangChangeOutcome,
} from '../../src/ui/home';
import {
  FX_SETTINGS,
  applyFxSettings,
  isFxSettingOn,
  isMetal6StrobeOn,
  resetFxSettingsForTest,
  setFxSetting,
} from '../../src/ui/fx-settings';
import { DEFAULT_LANG, EN, ZH, getLang, initI18n, saveFailedText, setLang, type Lang, type WriteFailure } from '../../src/i18n';
import {
  createLocalStore,
  readFxSettings,
  readLang,
  writeFxSettings,
  writeLang,
} from '../../src/app/local-store';
import { L1_SETTINGS, createMemoryStore } from '../../src/app/storage';

/**
 * ★ 2026-10-01（P0）：「设置小窗」是 i18n 的**第一个真实消费者** —— 这一组钉它的语言行为。
 *
 * 用户 2026-10-01 拍板"UI 全量双语"（方案 `docs/2026-10-01-新手引导与教学-方案.md` §6.5），
 * P0 只抽这一屏。这一组回答三个问题（都是"以后每一屏都要回答"的那三个）：
 *
 *  1. **中文与改动前逐字一致吗**：屏上画出来的每条文案必须**逐字等于** `zh.ts` 的值，
 *     而 `zh.ts` 的值又由 `tests/i18n/tables.test.ts` 与改动前的字面量对齐（两处独立）。
 *  2. **切了之后立即生效吗**：`setLang('en')` 之后**同一棵已经挂在屏上的树**必须当场变成英文
 *     （`applyLang()` 的就地改写），而不是等重开小窗。
 *  3. **有没有漏改写的地方**（最容易出的错是"半张屏"）：这一组**遍历整棵子树**收集文案，
 *     再与两张表**逐条**比对 —— 任何一处没跟着语言走的中文/英文都会在这里露出来。
 *
 * ## 不能证明什么（如实声明）
 *
 *  - 不能证明真实浏览器里的观感（层叠、焦点、Esc 那条要真 `document` 的 keydown 冒泡）；
 *  - 不能证明宿主（`src/main.ts`）真的落了盘 —— 那是 `applyLangChange` 的事，由下面第 4 组
 *    用**源码结构腿 + 真的 store 真跑一次**两头夹住（宿主那条链在 node 下没有 `#app`，
 *    不能整条真跑）。
 */

/* ───────────────────────────────── 夹具 ───────────────────────────────── */

const restores: Array<() => void> = [];

function mountStubDom(): void {
  restores.push(installStubDom());
}

afterEach(() => {
  while (restores.length > 0) restores.pop()?.();
  resetFxSettingsForTest();
  setLang(DEFAULT_LANG);
});

beforeEach(() => {
  setLang(DEFAULT_LANG);
  resetFxSettingsForTest();
});

/** 造一个挂在桩 `document.body` 上的小窗（桩的 `dispatchEvent` 只沿 `parentElement` 冒泡）。 */
function mount(over: {
  onClose?: () => void;
  lang?: Lang;
  onLangChange?: (l: Lang) => LangChangeOutcome;
  /** ★ 2026-10-01（B）：开关落盘的回话；缺省 = 成功 */
  onFxChange?: (id: string, on: boolean) => LangChangeOutcome;
  /** ★ 2026-10-06（用户要求）：「选牌即确定」的初值（缺省 = 关闭，与真默认值一致） */
  instantChoice?: boolean;
  /** ★ 2026-10-06（用户要求）：「选牌即确定」落盘的回话；缺省 = 成功 */
  onInstantChoiceChange?: (on: boolean) => LangChangeOutcome;
} = {}): {
  readonly overlay: StubNode;
  readonly calls: Array<{ lang: Lang } & LangChangeOutcome>;
  readonly fxCalls: Array<{ id: string; on: boolean } & LangChangeOutcome>;
  /** ★ 2026-10-06：小窗拨动「选牌即确定」时收到的那些调用 */
  readonly prefCalls: Array<{ on: boolean } & LangChangeOutcome>;
} {
  mountStubDom();
  const calls: Array<{ lang: Lang } & LangChangeOutcome> = [];
  const fxCalls: Array<{ id: string; on: boolean } & LangChangeOutcome> = [];
  const prefCalls: Array<{ on: boolean } & LangChangeOutcome> = [];
  const nav = {
    onClose: over.onClose ?? (() => { /* 本组不用它 */ }),
    lang: over.lang ?? getLang(),
    onLangChange: (l: Lang) => {
      const out = over.onLangChange === undefined ? LANG_CHANGE_OK : over.onLangChange(l);
      calls.push({ lang: l, ...out });
      return out;
    },
    onFxChange: (id: string, on: boolean) => {
      const out = over.onFxChange === undefined ? LANG_CHANGE_OK : over.onFxChange(id, on);
      fxCalls.push({ id, on, ...out });
      return out;
    },
    // ★ 2026-10-06（用户要求）：「选牌即确定」那一项（默认关闭；假宿主照 main.ts 的口径改内存态）
    instantChoice: over.instantChoice === true,
    onInstantChoiceChange: (on: boolean) => {
      const out = over.onInstantChoiceChange === undefined ? LANG_CHANGE_OK : over.onInstantChoiceChange(on);
      prefCalls.push({ on, ...out });
      return out;
    },
  };
  const overlay = settingsOverlayElement(nav) as unknown as StubNode;
  document.body.appendChild(overlay as unknown as Node);
  return { overlay, calls, fxCalls, prefCalls };
}

/** 树里所有节点的文本（按 DOM 顺序），用于"整屏逐条比对" */
function textsOf(node: StubNode): string[] {
  return descendants(node).map((n) => n.text).filter((t) => t !== '');
}

/** 按 `data-role` 找唯一节点 */
function role(node: StubNode, r: string): StubNode {
  const hits = descendants(node).filter((n) => n.dataset.role === r);
  expect(hits.length, `树里应有唯一一个 [data-role=${r}]，实际 ${hits.length} 个`).toBe(1);
  return hits[0];
}

/** 语言按钮（按 `data-lang` 定位，不按文案 —— 文案是 `LANGS` 的，不跟着语言变） */
function langBtn(overlay: StubNode, id: Lang): StubNode {
  const hits = descendants(overlay).filter((n) => n.dataset.lang === id);
  expect(hits.length, `找不到语言按钮 ${id}`).toBe(1);
  return hits[0];
}

/**
 * 在某个节点上"真派发一次事件"。
 *
 * ⚠️ 桩的 `dispatchEvent` **不调用派发节点自己的监听器**（只沿 `parentElement` 向上冒泡）
 * ⇒ 临时挂一个空子节点，在**它**上面派发，让冒泡路径经过目标节点
 * （与 `tests/ui/local-data-screen.test.ts` 第 9 组的 `fireIn` 同源）。
 */
function fireIn(target: StubNode, type: string): void {
  const clicker = makeStubEl('span');
  target.appendChild(clicker);
  clicker.dispatchEvent({ type, target: clicker });
}

function clickIn(target: StubNode): void {
  fireIn(target, 'click');
}

/** 读 `aria-label`（桩上只在索引签名里 ⇒ 调用点显式收窄） */
function ariaLabel(dialog: StubNode): string | null {
  return (dialog.getAttribute as unknown as (n: string) => string | null)('aria-label');
}

/* ==================================================================== *
 * 1. 中文默认：屏上每一句都逐字等于 `zh.ts` 的值
 * ==================================================================== */

describe('设置小窗 · 默认中文（与改动前逐字一致）', () => {
  it('标题 / 关闭 / aria / 语言行 / 开关 / 底部提示：逐条等于 `zh` 表的值', () => {
    const { overlay } = mount();
    expect(textsOf(overlay)).toEqual(expect.arrayContaining([
      ZH['settings.title'],
      ZH['settings.close'],
      ZH['settings.lang'],
      ZH['settings.lang.hint'],
      ZH['settings.fx.metal6.label'],
      ZH['settings.hint'],
      // 没勾过的开关只显示说明原文（"当前："那句要等玩家真的勾一次 —— 见下面的用例）
      ZH['settings.fx.metal6.desc'],
    ]));
    expect(ariaLabel(descendants(overlay).find((n) => isClass(n, 'settings-panel')) as StubNode))
      .toBe(ZH['settings.aria']);
    // 反向：屏上一个 ⟪…⟫ 都不许有（那是缺键的形态）
    expect(textsOf(overlay).filter((t) => t.includes('⟪')), '屏上出现了缺键回退的 ⟪键名⟫').toEqual([]);
  });

  it('中文那一枚标成当前（`.on` + `aria-current`），英文那一枚没有', () => {
    const { overlay } = mount();
    const zh = langBtn(overlay, 'zh');
    const en = langBtn(overlay, 'en');
    expect(isClass(zh, 'on'), '中文按钮没标成当前').toBe(true);
    expect(isClass(en, 'on'), '英文按钮被标成了当前').toBe(false);
    expect((zh.getAttribute as unknown as (n: string) => string | null)('aria-current')).toBe('true');
    expect((en.getAttribute as unknown as (n: string) => string | null)('aria-current')).toBe(null);
  });

  it('两个选项的文案取 `LANGS`（`中文` / `English`），**不跟着当前语言变**', () => {
    // 理由（写在 `src/ui/home.ts` 的注释里）：选项名是给"看不懂当前语言的人"看的，
    // 切到英文之后中文选项若写成 "Chinese"，中文玩家就找不回来了。
    const { overlay } = mount();
    expect(langBtn(overlay, 'zh').text).toBe('中文');
    expect(langBtn(overlay, 'en').text).toBe('English');
    clickIn(langBtn(overlay, 'en'));
    expect(langBtn(overlay, 'zh').text, '切到英文之后中文选项的文案跟着变了').toBe('中文');
    expect(langBtn(overlay, 'en').text).toBe('English');
  });

  it('开关说明的就地改写形态与改动前一致：勾一次 ⇒ `原说明（当前：关闭）`', () => {
    // ★ 2026-10-01（B）：勾了之后**内存态由宿主改**（小窗只报事件 + 就地改说明），
    //   所以这里的假宿主照 `main.ts` 的同一口径做一次（`setFxSetting`），再用真读侧断言。
    const { overlay, fxCalls } = mount({
      onFxChange: (id, on) => { setFxSetting(id, on); return LANG_CHANGE_OK; },
    });
    const notes = classOf(overlay, 'settings-note');
    expect(notes.length, '开关说明应该只有一个（语言那一行用的是 `.settings-lang-hint`）').toBe(1);
    const note = notes[0];
    const box = classOf(overlay, 'mode-check')[0];
    (box as unknown as { checked: boolean }).checked = false;
    fireIn(box, 'change');
    expect(fxCalls, '勾一次要通知宿主一次（带 id 与新的值）').toEqual([{ id: 'metal6-strobe', on: false, ok: true }]);
    expect(isMetal6StrobeOn(), '宿主按同一口径改了内存态之后，读侧应当变了').toBe(false);
    expect(note.text).toBe(`${ZH['settings.fx.metal6.desc']}（当前：${ZH['settings.fx.off']}）`);
  });

  it('★ 2026-10-06（用户要求）：「选牌即确定」这一项 —— 默认关闭、有落点、拨动就通知宿主、说明就地改写', () => {
    // ① 默认关闭（`nav.instantChoice` 缺省 false）：复选框不勾，说明只有原文
    const { overlay, prefCalls } = mount();
    const box = classOf(overlay, 'mode-check', (n) => n.dataset.playPref === 'instant-choice')[0];
    expect(box, '设置里没有「选牌即确定」那一项（少了 data-play-pref）').toBeDefined();
    expect(box.tag, '它不是 <input>').toBe('input');
    expect((box as unknown as { checked: boolean }).checked, '默认不是关闭（用户明确要求默认关闭）').toBe(false);
    const note = classOf(overlay, 'settings-instant-note')[0];
    expect(note, '那一项没有说明行（用的是 `.settings-instant-note`，不许复用 `.settings-note`）').toBeDefined();
    expect(note.text, '没勾过就显示了"当前："那句').toBe(ZH['settings.instant.desc']);
    expect(textsOf(overlay), '屏上没画出这一项的标题').toContain(ZH['settings.instant.label']);

    // ② 拨动 ⇒ 通知宿主一次（带新值）+ 说明就地改写（不重画整屏）
    (box as unknown as { checked: boolean }).checked = true;
    fireIn(box, 'change');
    expect(prefCalls, '拨动没有通知宿主（那就白拨了）').toEqual([{ on: true, ok: true }]);
    expect(note.text, '说明没就地改成"当前：开启"')
      .toBe(`${ZH['settings.instant.desc']}（当前：${ZH['settings.fx.on']}）`);

    // ③ 落盘失败 ⇒ 同一个提示位如实说（复用特效开关那一套文案，不新造）
    const second = mount({ onInstantChoiceChange: () => ({ ok: false, reason: 'write-failed', detail: 'X' }) });
    const box2 = classOf(second.overlay, 'mode-check', (n) => n.dataset.playPref === 'instant-choice')[0];
    (box2 as unknown as { checked: boolean }).checked = true;
    fireIn(box2, 'change');
    expect(role(second.overlay, 'lang-status').text, '拨动落盘失败时没有任何提示').toContain('开关没能保存到本机');

    // ④ 初值由 `nav` 决定（开着的玩家再打开设置，看到的应当是勾上的）
    const on = mount({ instantChoice: true });
    const box3 = classOf(on.overlay, 'mode-check', (n) => n.dataset.playPref === 'instant-choice')[0];
    expect((box3 as unknown as { checked: boolean }).checked, 'nav 给了 true 却没勾上').toBe(true);
  });

  it('★ B：开关落盘失败 ⇒ 屏上如实说"本次会话生效、下次进入回旧状态"（按原因本地化）', () => {
    const { overlay, fxCalls } = mount({
      onFxChange: () => ({ ok: false, reason: 'write-failed', detail: 'QuotaExceededError: x' }),
    });
    const box = classOf(overlay, 'mode-check')[0];
    (box as unknown as { checked: boolean }).checked = false;
    fireIn(box, 'change');
    expect(fxCalls).toHaveLength(1);
    const status = role(overlay, 'lang-status').text;
    expect(status, '开关写盘失败时没有任何提示').toContain('开关没能保存到本机');
    // 界面是中文（本用例没切过语言）⇒ 技术细节那句也是中文那一版，系统消息原样带出
    expect(status, '没带出系统消息').toContain('技术细节：QuotaExceededError: x');
    // 反向：不许出现"语言"那一档的句子（两个句式不同，混用就是抄错了）
    expect(status, '开关失败却说了"语言没能保存到本机"').not.toContain('语言没能保存到本机');
  });
});

/* ==================================================================== *
 * 2. 切换：立即生效（同一棵已挂上去的树）+ 通知宿主
 * ==================================================================== */

describe('设置小窗 · 切语言', () => {
  it('点 English ⇒ **同一棵树**当场变英文，且宿主收到一次 onLangChange(\'en\')', () => {
    const { overlay, calls } = mount();
    // 前置锚点：切换之前它确实是中文（否则下面那些"变了"可能是恒真）
    expect(role(overlay, 'lang-status').text).toBe('');
    clickIn(langBtn(overlay, 'en'));

    expect(getLang(), '内存态没切成 en').toBe('en');
    expect(calls, '宿主没收到 onLangChange（或收到多次）').toEqual([{ lang: 'en', ok: true }]);
    // 这一棵树**没有被重画**（本用例拿的还是同一个引用）⇒ 下面这些断言证明的是"就地改写"
    expect(textsOf(overlay)).toEqual(expect.arrayContaining([
      EN['settings.title'],
      EN['settings.close'],
      EN['settings.lang'],
      EN['settings.lang.hint'],
      EN['settings.fx.metal6.label'],
      EN['settings.hint'],
    ]));
    // 反向：中文那几句必须**从屏上消失**（"两种语言同时在屏上"是最常见的半张屏缺陷）
    for (const k of ['settings.title', 'settings.close', 'settings.lang.hint', 'settings.hint'] as const) {
      expect(textsOf(overlay), `切到英文后「${ZH[k]}」还留在屏上`).not.toContain(ZH[k]);
    }
    expect(ariaLabel(descendants(overlay).find((n) => isClass(n, 'settings-panel')) as StubNode))
      .toBe(EN['settings.aria']);
  });

  it('整屏**逐条**比对：切到 en 之后，屏上没有任何一条中文文案（也不许有 ⟪键名⟫）', () => {
    // 这条腿的判据面是"整棵子树"（不是逐个已知元素）⇒ 将来有人往小窗里加一条文案却忘了
    // 在 `applyLang()` 里改写它，这里当场红 —— 这是本文件最值钱的一条。
    const { overlay } = mount();
    clickIn(langBtn(overlay, 'en'));
    const shown = textsOf(overlay);
    const zhOnlyValues = new Set(
      Object.entries(ZH).filter(([k]) => EN[k] !== ZH[k]).map(([, v]) => v),
    );
    const leftovers = shown.filter((t) => zhOnlyValues.has(t));
    expect(leftovers, `切到英文之后屏上还留着中文文案：${leftovers.join(' / ')}`).toEqual([]);
    expect(shown.filter((t) => t.includes('⟪')), '屏上出现了缺键回退的 ⟪键名⟫').toEqual([]);
  });

  it('切回中文：再点一次中文 ⇒ 当场变回中文，宿主再收到一次', () => {
    const { overlay, calls } = mount();
    clickIn(langBtn(overlay, 'en'));
    clickIn(langBtn(overlay, 'zh'));
    expect(calls.map((c) => c.lang)).toEqual(['en', 'zh']);
    expect(getLang()).toBe('zh');
    expect(textsOf(overlay)).toContain(ZH['settings.title']);
    expect(textsOf(overlay), '切回中文后英文标题还在').not.toContain(EN['settings.title']);
  });

  it('点**当前语言**那一枚：什么都不做（不落盘、不通知宿主、屏不动）', () => {
    const { overlay, calls } = mount();
    const before = textsOf(overlay);
    clickIn(langBtn(overlay, 'zh'));
    expect(calls, '点当前语言也通知了宿主（会白写一次盘、白重画一次）').toEqual([]);
    expect(textsOf(overlay)).toEqual(before);
  });

  it('第一次切换之后，当前那一枚标记跟着走（`.on` / `aria-current`）', () => {
    const { overlay } = mount();
    clickIn(langBtn(overlay, 'en'));
    const read = (n: StubNode): string | null => (n.getAttribute as unknown as (x: string) => string | null)('aria-current');
    expect(isClass(langBtn(overlay, 'en'), 'on')).toBe(true);
    expect(isClass(langBtn(overlay, 'zh'), 'on')).toBe(false);
    expect(read(langBtn(overlay, 'en'))).toBe('true');
    expect(read(langBtn(overlay, 'zh')), '切走之后旧那一枚还留着 aria-current').toBe(null);
  });

  it('★ D3：写盘失败（后端拒绝）⇒ 屏上如实说"只本次会话生效 + 真因"，且**不改回**语言', () => {
    const REAL = 'QuotaExceededError: The quota has been exceeded.';
    const { overlay, calls } = mount({
      onLangChange: () => ({ ok: false, reason: 'write-failed', detail: REAL }),
    });
    clickIn(langBtn(overlay, 'en'));
    expect(calls).toEqual([{ lang: 'en', ok: false, reason: 'write-failed', detail: REAL }]);
    const status = role(overlay, 'lang-status');
    // ⚠️ 提示本身也走 `t()` ⇒ 切到 en 之后它是**英文**的（这正是"整屏双语"该有的样子；
    //    一条留在旧语言上的提示就是"半张屏"）。所以这里按 en 表的那句比对，不按中文。
    expect(status.text, '写盘失败时没有任何提示（玩家会以为切了没用）')
      .toContain('could not be saved on this device');
    expect(status.text, '没把真因写出来').toContain(REAL);
    expect(status.text, '没说清"本次会话仍然生效"').toContain('This session still uses it');
    // 反向锚点：**中文**那句不许同时留在屏上（线上验收 D3 的原始缺陷就是英文界面夹中文）
    expect(status.text, '英文界面下夹着中文兜底句（D3 的原缺陷）').not.toContain('本机存储拒绝写入');
    expect(status.text, '英文界面下整句夹了中文').not.toMatch(/[\u3400-\u9fff]/);
    // 语言**仍然是英文**（失败的含义是"下次启动回到旧语言"，不是"这次也别生效"）
    expect(getLang()).toBe('en');
    expect(textsOf(overlay)).toContain(EN['settings.title']);
  });

  it('★ D3：写盘失败（**值超上限**）⇒ 两个字节数都带出来，且**两种语言整句都不夹另一种语言**', () => {
    // 线上验收 D3 第二条：第一版把 `70021 字节 > 上限 65536 字节` 这种**中文诊断串**直接
    // 透到英文界面里 —— 看起来就是坏的。现在纯层只给两个数，句子由 i18n 层按语言拼。
    const out = (): LangChangeOutcome => ({ ok: false, reason: 'too-large', bytes: 70021, limit: 65536 });

    // 中文那一版（从英文切回中文 ⇒ 提示按中文给）
    const toZh = mount({ lang: 'en', onLangChange: out });
    clickIn(langBtn(toZh.overlay, 'zh'));
    const zhText = role(toZh.overlay, 'lang-status').text;
    expect(zhText, '中文提示不是本地化过的中文').toContain('语言没能保存到本机');
    expect(zhText, '中文提示没给出两个数').toContain('70,021 字节 > 上限 65,536 字节');
    expect(zhText, '中文提示里混进了英文句式').not.toContain('bytes > the');
    expect(zhText).not.toContain('could not be saved');

    // 英文那一版（从中文切到 en）
    const toEn = mount({ lang: 'zh', onLangChange: out });
    clickIn(langBtn(toEn.overlay, 'en'));
    const enText = role(toEn.overlay, 'lang-status').text;
    expect(enText, '英文提示不是英文').toContain('could not be saved on this device');
    expect(enText, '英文提示没给出两个数').toContain('70,021 bytes > the 65,536-byte limit');
    // ★ 收严后的验收口径：**整句零汉字**（不再是"只有我们写的那半句零汉字"）
    expect(enText, '英文界面整句里出现了汉字').not.toMatch(/[\u3400-\u9fff]/);
    expect(enText, '英文界面里出现了中文"字节/上限"').not.toContain('字节');
    // 反向锚点：两边各自是"另一种语言的那套"（证明上面那些不是恒真）
    expect(enText).not.toContain('语言没能保存到本机');
    expect(zhText).not.toContain('bytes');
  });

  it('★ D3：`saveFailedText` 是那份措辞的**唯一**出口（中英/系统消息三段真跑）', () => {
    // 直接对那个纯函数下判据（不经过 DOM）：它是"结构化原因 → 本地化文案"的唯一映射处。
    // ⚠️ 期望值写成**字面量**（不从表里取）：从表里取的话，"表里那句话被删/被改"这条腿照样绿。
    setLang('zh');
    expect(saveFailedText({ reason: 'too-large', bytes: 70023, limit: 65536 }))
      .toBe('语言没能保存到本机。本次会话仍然用这种语言，刷新后会回到上次保存的那种。 70,023 字节 > 上限 65,536 字节。');
    // 后端拒绝 + 系统消息：系统消息单独一段（它只可能是系统语言，这里限英文）
    expect(saveFailedText({ reason: 'write-failed', detail: 'QuotaExceededError: x' }))
      .toBe('语言没能保存到本机。本次会话仍然用这种语言，刷新后会回到上次保存的那种。 本机存储拒绝了写入（隐私模式或配额已满）。 技术细节：QuotaExceededError: x');
    // 没有系统消息时不写那一段（不留空括号）
    expect(saveFailedText({ reason: 'write-failed' }))
      .toBe('语言没能保存到本机。本次会话仍然用这种语言，刷新后会回到上次保存的那种。 本机存储拒绝了写入（隐私模式或配额已满）。');

    setLang('en');
    expect(saveFailedText({ reason: 'too-large', bytes: 70023, limit: 65536 }))
      .toBe('The language could not be saved on this device. This session still uses it; '
        + 'a reload goes back to the last saved one. 70,023 bytes > the 65,536-byte limit.');
    expect(saveFailedText({ reason: 'write-failed', detail: 'QuotaExceededError: x' }))
      .toBe('The language could not be saved on this device. This session still uses it; '
        + 'a reload goes back to the last saved one. local storage refused the write (private mode or quota). '
        + 'Technical detail: QuotaExceededError: x');
    expect(saveFailedText({ reason: 'threw', detail: 'TypeError: boom' }))
      .toContain('Technical detail: TypeError: boom');
    setLang(DEFAULT_LANG);
  });

  it('★ D3（反向验证）：把"结构化原因"退回"拼好的中文句子" ⇒ 英文那条腿必须红', () => {
    // 这一条不依赖产出代码的写法，而是把**退回旧口径之后的屏文**摆出来，证明上面那些断言
    // 抓的确实是"中文诊断串混进英文界面"这件事：同一个 too-large 失败，旧口径的屏文长这样 ——
    const legacy = 'The language could not be saved on this device. This session still uses it; '
      + 'a reload goes back to the last saved one. Technical detail: 70021 字节 > 上限 65536 字节';
    expect(legacy, '反向样本失效：它已经不夹汉字了，那这条反向验证证明不了什么')
      .toMatch(/[\u3400-\u9fff]/);
    expect(legacy, '反向样本失效：它没有走"技术细节"那段').toContain('Technical detail');
    // 现口径下屏上**不**允许出现这种串（下面两条就是上面那些腿用的判据）
    setLang('en');
    const now = saveFailedText({ reason: 'too-large', bytes: 70021, limit: 65536 });
    expect(now).not.toMatch(/[\u3400-\u9fff]/);
    expect(now).not.toBe(legacy);
    setLang(DEFAULT_LANG);
  });

  it('宿主抛错也兜住（不许把小窗炸掉）：同一个提示位，系统消息照原样带出', () => {
    // ⚠️ D3 第二条之后，`detail` 只可能是**系统语言**（异常消息）——
    // 本用例刻意用一个英文异常，好把"整句零汉字"这条口径也钉在这条腿上。
    const { overlay } = mount({ onLangChange: () => { throw new Error('TypeError: storage unavailable'); } });
    expect(() => clickIn(langBtn(overlay, 'en')), '宿主抛错把小窗打炸了').not.toThrow();
    const text = role(overlay, 'lang-status').text;
    expect(text, '宿主抛错时没有提示').toContain('could not be saved on this device');
    expect(text, '异常消息没被带出来').toContain('TypeError: storage unavailable');
    expect(text, '异常消息也没有被包一层中文').toContain('Technical detail');
    expect(text, '整句里出现了汉字（异常消息本身也不该是中文）').not.toMatch(/[\u3400-\u9fff]/);
    expect(getLang()).toBe('en');
  });

  it('切语言之后提示行是**新语言**的（提示本身也从表里取，不是写死的中文）', () => {
    // 失败提示只在真的写盘失败时出现 ⇒ 用一个"总是失败"的宿主把它捞出来看语言
    const fail = (): LangChangeOutcome => ({ ok: false, reason: 'write-failed' });
    const toEn = mount({ lang: 'zh', onLangChange: fail });
    clickIn(langBtn(toEn.overlay, 'en'));
    expect(role(toEn.overlay, 'lang-status').text, '失败提示没跟着语言走')
      .toContain('could not be saved on this device');
    expect(role(toEn.overlay, 'lang-status').text).not.toContain('没能保存到本机');
    // 反向：从英文切回中文 ⇒ 提示是中文那句（证明上面那条不是"恒英文"）
    const toZh = mount({ lang: 'en', onLangChange: fail });
    clickIn(langBtn(toZh.overlay, 'zh'));
    expect(role(toZh.overlay, 'lang-status').text).toContain('没能保存到本机');
  });

  it('成功切换时那个提示位是空的（不是"早就写好只是藏着"）', () => {
    const { overlay } = mount();
    expect(role(overlay, 'lang-status').text).toBe('');
    clickIn(langBtn(overlay, 'en'));
    expect(role(overlay, 'lang-status').text, '成功也写了提示').toBe('');
  });

  it('宿主给的 `nav.lang` 决定小窗开出来是哪一版（刷新之后"记住语言"的落点）', () => {
    // 模拟"上次存的是 en"：宿主把 nav.lang 给成 en，小窗一开出来就该是英文
    setLang('en');
    const { overlay } = mount({ lang: 'en' });
    expect(textsOf(overlay)).toContain(EN['settings.title']);
    expect(textsOf(overlay), '宿主给了 en，小窗还是画中文').not.toContain(ZH['settings.title']);
  });
});

/* ==================================================================== *
 * 3. 文案键与三处真相对齐（`FX_SETTINGS` 的文档字段 / 两张表 / 屏上）
 * ==================================================================== */

describe('文案键的唯一性：`FX_SETTINGS` 的文档字段 = 中文表的值 = 屏上的值', () => {
  it('特效那一项：`fx-settings.ts` 的两条中文 = `zh.ts` 的两条 = 屏上那两条', () => {
    // P0 把 `FX_SETTINGS` 的 label/desc 降级成**文档字段**（屏上取的是 `home.ts` 里那两个
    // `t('键')` 字面量）。降级之后最容易出的错是"三处各说各的"⇒ 这一条把它们钉在一起。
    const { overlay } = mount();
    const def = FX_SETTINGS[0];
    expect(def.label, 'FX_SETTINGS.label 与中文表不一致').toBe(ZH['settings.fx.metal6.label']);
    expect(def.desc, 'FX_SETTINGS.desc 与中文表不一致').toBe(ZH['settings.fx.metal6.desc']);
    expect(textsOf(overlay)).toContain(def.label);
    expect(textsOf(overlay)).toContain(def.desc);
  });

  it('`FX_SETTINGS` 每一条都必须在屏上有落点（`data-fx-setting`）—— 新增条目不会静默漏画', () => {
    const { overlay } = mount();
    /**
     * ⚠️ 2026-10-06：判据面从"全部 `.mode-check`"收成"带 `data-fx-setting` 的那些" ——
     * 设置小窗里现在还有**第二个**复选框（「选牌即确定」，`data-play-pref`），它不属于
     * `FX_SETTINGS`。不收窄就会把那个新开关也算进来（本腿第一次跑就是这么红的）。
     */
    const boxes = classOf(overlay, 'mode-check', (b) => b.dataset.fxSetting !== undefined);
    expect(boxes.map((b) => b.dataset.fxSetting)).toEqual(FX_SETTINGS.map((d) => d.id));
  });
});

/* ==================================================================== *
 * 4. 宿主接线（`src/main.ts`）：落盘 + 重画当前屏
 * ==================================================================== */

const MAIN_CODE = stripComments(
  readFileSync(fileURLToPath(new URL('../../src/main.ts', import.meta.url)))
    .subarray(0, 4 * 1024 * 1024).toString('utf8'),
);

describe('★ 宿主接线：切语言 ⇒ 落盘 + 重画当前屏（源码结构腿 + 真 store 腿）', () => {
  it('启动时读一次已存的语言（`initI18n` 的唯一调用点，且在画第一屏之前）', () => {
    const calls = [...MAIN_CODE.matchAll(/initI18n\(/g)].length;
    expect(calls, 'main.ts 里 `initI18n(` 的调用点数（定义不在这个文件里）').toBe(1);
    expect(MAIN_CODE, '启动时没有把已存的语言读进来').toMatch(/initI18n\(\(\)\s*=>\s*readLang\(localStore\)\)/);
    // 顺序：它必须在文件末尾那次 `showStartScreen();` **之前**（否则授权弹窗会以默认中文画出来）
    const initAt = MAIN_CODE.indexOf('initI18n(');
    const firstPaintAt = MAIN_CODE.lastIndexOf('\nshowStartScreen();');
    expect(initAt, '找不到 initI18n 的落点').toBeGreaterThan(0);
    expect(firstPaintAt, '找不到启动那一屏的落点').toBeGreaterThan(0);
    expect(initAt, 'initI18n 排在画第一屏之后（刷新会闪一下语言）').toBeLessThan(firstPaintAt);
  });

  it('`applyLangChange` 三件事都做：换内存态、走 `writeLang` 落盘、重画当前屏', () => {
    const body = functionBody(MAIN_CODE, 'applyLangChange');
    expect(body.length, 'functionBody 抽到空片段 ⇒ 本判据假绿').toBeGreaterThan(150);
    expect(body, '没有换内存态（不调 setLang）').toMatch(/setLang\s*\(/);
    expect(body, '没有落盘（不调 writeLang）').toMatch(/writeLang\s*\(\s*localStore/);
    // 重画：首页那一支必须显式再画一次首页（`rerender()` 没有首页分支），其余屏走 rerender
    expect(body, '没有重画当前屏').toMatch(/rerender\s*\(\s*\)/);
    expect(body, '首页那一支没有显式重画首页（首页不归 rerender 管）').toMatch(/isHomeScreenActive\s*\(\s*\)[\s\S]{0,80}?showHome\s*\(\s*\)/);
    // 反向：不许出现第二套写盘实现（语言的值与文案表都在 i18n 层）
    expect(body, 'applyLangChange 里出现了第二份存储实现').not.toMatch(/localStorage|indexedDB|writeJson/);
  });

  it('★ D3：`applyLangChange` 把**结构化原因**转交出去，自己不再写死兜底文案', () => {
    const body = functionBody(MAIN_CODE, 'applyLangChange');
    // 必须把 `writeLang` 的结论交给**那个共享映射处**，而不是自己折叠（D3 的原缺陷）
    expect(body, '没有把写盘结论交给共享映射处').toMatch(/applyWriteResult\s*\(\s*writeLang\s*\(/);
    // 反向：不许在这里自己判 ok / 自己拼 detail（那样"真因被丢"会再次无声发生）
    expect(body, 'applyLangChange 里又自己折叠了写盘结论').not.toMatch(/w\.ok|\.detail/);
    // 反向：不许出现任何**写死的**玩家可见中文兜底（D3 的原缺陷就在这里）
    expect(body, 'applyLangChange 里又出现了写死的中文兜底').not.toMatch(/[\u3400-\u9fff]/);
  });

  it('★ D3：`applyWriteResult` 的原样转交（**真跑**，这是 D3 唯一被变异验过的映射处）', () => {
    // 为什么这条腿必须存在（变异实测）：把原因/数值丢掉、或换成写死一句之后，
    // 整套测试**全绿** —— 因为那段逻辑原来内联在 `applyLangChange` 里，而 node 下跑不了它。
    // 抽成 `applyWriteResult` 之后这里可以直接喂真的 `WriteResult` 形状。
    expect(applyWriteResult({ ok: true }), '成功那一态被折叠了').toEqual(LANG_CHANGE_OK);
    expect(
      applyWriteResult({ ok: false, reason: 'too-large', bytes: 70023, limit: 65536 }),
      'too-large 的两个数被折叠/丢掉了（D3 第二条的根因）',
    ).toEqual({ ok: false, reason: 'too-large', bytes: 70023, limit: 65536 });
    expect(applyWriteResult({ ok: false, reason: 'write-failed', detail: 'QuotaExceededError: x' })).toEqual({
      ok: false, reason: 'write-failed', detail: 'QuotaExceededError: x',
    });
    // 宿主抛错那一档：走**唯一构造点** `langChangeThrew` ⇒ `threw` + 异常消息
    expect(langChangeThrew('TypeError: boom')).toEqual({
      ok: false, reason: 'threw', detail: 'TypeError: boom',
    });
    // 三态两两可分辨（否则"按原因给措辞"就无从谈起）
    const three = [
      applyWriteResult({ ok: true }),
      applyWriteResult({ ok: false, reason: 'too-large', bytes: 1, limit: 2 }),
      applyWriteResult({ ok: false, reason: 'write-failed', detail: 'd' }),
    ].map((r) => JSON.stringify(r));
    expect(new Set(three).size, '三种结论里有两种不可分辨').toBe(3);
  });

  it('★ D3：`WriteResult`（纯层）→ `WriteFailure`（i18n 层）的字段口径在**编译期**对齐', () => {
    // 这是"两侧字段不许漂移"的机器形态：`WriteResult` 的**失败分支**必须能赋给 `WriteFailure`
    // （成功分支没有 `reason`，本来就不该进 `saveFailedText`）。
    // ⚠️ 它**零运行时开销**（类型表达式），但改坏任何一侧的字段名/取值域 ⇒ `npx tsc --noEmit` 当场红。
    type StorageFailure = Extract<ReturnType<typeof writeLang>, { ok: false }>;
    const assign = (w: StorageFailure): WriteFailure => w;
    expect(typeof assign, '这条腿的载体是类型系统，运行时只要它存在').toBe('function');
  });

  it('★ D2：首页那一支重画**不会**重建背景（`showHome` 复用同一份 `.home-bg`）', () => {
    // 判据落在 home.ts 的复用实现上（行为腿在 `tests/ui/home-bg-reuse.test.ts`）：
    // 这里只钉"宿主那条路走的确实是那个安全的重画"。
    const home = stripComments(
      readFileSync(fileURLToPath(new URL('../../src/ui/home.ts', import.meta.url)))
        .subarray(0, 4 * 1024 * 1024).toString('utf8'),
    );
    expect(home, '`buildHomeBg` 没有复用已有背景的入口（D2 的原缺陷）').toContain('takeReusableBg');
    expect(home, 'renderHome 仍然无条件新建背景').not.toMatch(/const bg = buildHomeBg\(\);/);
    expect(home, 'renderHome 没有把 root 交给背景构造（复用判据要看父节点）').toMatch(/buildHomeBg\(root\)/);
  });

  it('设置入口把 `lang` / `onLangChange` / `onFxChange` 都交下去了', () => {
    const open = functionBody(MAIN_CODE, 'showHome');
    expect(open).toContain('settingsOverlayElement');
    expect(open, '没把当前语言交给小窗').toMatch(/lang:\s*getLang\s*\(\s*\)/);
    expect(open, '没接语言切换的落点').toMatch(/onLangChange/);
    // ★ B：开关的落盘接缝也要交下去（缺了它勾选就只在内存里）
    expect(open, '没接开关落盘的落点（B：设置里的选项也要持久化）').toMatch(/onFxChange/);
  });

  it('★ B：启动时读回特效开关（在画第一屏**之前**，且失败退化成默认值）', () => {
    // 与 `initI18n` 同一条纪律：**只读**、在启动块之前、读不出来就退化。
    expect(MAIN_CODE, '启动时没有读回特效开关').toMatch(/applyFxSettings\s*\(\s*readFxSettings\s*\(\s*localStore\s*\)\s*\)/);
    const readAt = MAIN_CODE.indexOf('applyFxSettings(readFxSettings(localStore))');
    const firstPaintAt = MAIN_CODE.lastIndexOf('\nshowStartScreen();');
    expect(readAt, '找不到读回特效开关的落点').toBeGreaterThan(0);
    expect(readAt, '读回特效开关排在画第一屏之后（牌桌会先按默认值挂上频闪层）').toBeLessThan(firstPaintAt);
    // 坏存储 / 读抛错时退回默认（catch 里那一次 `applyFxSettings(undefined)`）
    const body = functionBody(MAIN_CODE, 'applyFxChange');
    expect(body, 'applyFxChange 没接落盘').toMatch(/writeFxSettings\s*\(\s*localStore/);
    expect(body, 'applyFxChange 又自己拼了结论（应当走共享映射）').toMatch(/applyWriteResult\s*\(/);
  });

  it('★ B：真 store 真跑一次 —— 拨开关写的是 `L1_SETTINGS.fx`，读回之后内存态跟着变', () => {
    const kv = createMemoryStore();
    const store = createLocalStore({ persistent: kv });
    store.grant();
    expect(writeFxSettings(store, { 'metal6-strobe': false }).ok).toBe(true);
    expect(JSON.parse(kv.get(L1_SETTINGS) ?? 'null'), '落盘的不是 fx 字段').toEqual({ fx: { 'metal6-strobe': false } });
    applyFxSettings(readFxSettings(store));
    expect(isFxSettingOn('metal6-strobe'), '读回之后内存态没跟着变（"下次进入随时响应"这一半）').toBe(false);
    resetFxSettingsForTest();
  });

  it('真 store 真跑一次：`applyLangChange` 那条链写的确实是 `L1_SETTINGS` 里的 `lang`', () => {
    // 宿主那一半在 node 下没法整条真跑（它要 `#app` 与 `rerender()` 的整棵状态机），
    // 所以这里把**它做的那两件事**按同一口径复现一遍（写盘 + 读回），证明那个口径本身是通的。
    // ⚠️ 这条腿**不**证明 `main.ts` 里那两行逐字相同 —— 那一面由上面那条源码腿盯着。
    const kv = createMemoryStore();
    const store = createLocalStore({ persistent: kv });
    store.grant();
    setLang('en');
    expect(writeLang(store, getLang()).ok).toBe(true);
    expect(JSON.parse(kv.get(L1_SETTINGS) ?? 'null'), '落盘的不是 lang 字段').toEqual({ lang: 'en' });
    expect(initI18n(() => readLang(store))).toBe('en');
    setLang(DEFAULT_LANG);
  });
});
