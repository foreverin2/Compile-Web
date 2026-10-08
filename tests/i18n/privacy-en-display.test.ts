import { describe, it, expect, afterEach } from 'vitest';
import { setLang, DEFAULT_LANG, getLang } from '../../src/i18n';
import { PRIVACY_COPY, PRIVACY_GROUPS, privacyLines, ONLINE_GATE_MARK } from '../../src/app/privacy';
import { PRIVACY_GATE_MARK_EN, PRIVACY_LINES_EN, localizedPrivacyLines } from '../../src/i18n/privacy-en';
import { renderLocalData } from '../../src/ui/local-data';
import { renderLocalConsent } from '../../src/ui/local-consent';
import { createMemoryStore } from '../../src/app/storage';
import { createLocalStore } from '../../src/app/local-store';
import { descendants, installStubDom, isClass, makeStubEl, queryAllIn, type StubNode } from '../ui/net-dom-stub';

/**
 * **2026-10-07（用户要求）：完整隐私说明的英文显示层**
 *
 * 用户口径（他选的选项原文）：「要，现在一并翻（我逐句 1:1 转写，不动中文那份）」。
 *
 * 中文唯一出处仍是 `src/app/privacy.ts`（`privacyLines()` 十三段 + `ONLINE_GATE_MARK`），
 * 那份被整句哈希与"不许在别处新写承诺"的腿钉着 ⇒ 本轮只加**显示层** `src/i18n/privacy-en.ts`：
 * 中文模式逐字仍是中文原句，英文模式换成英文那十三段。
 *
 * ## 本文件的腿
 *
 *  1. **逐位对应**：英文恰好十三段、顺序与 `privacyLines()` 一致；
 *  2. **门槛标注不许漏**：中文那 6 条带 `ONLINE_GATE_MARK`，英文这 6 条必须逐条带
 *     `PRIVACY_GATE_MARK_EN`（漏掉 = 在英文里声称了本阶段玩不到的能力）；
 *  3. **零汉字** + 每条非空；
 *  4. **判据**（`localizedPrivacyLines`）：中文模式逐字返回中文、英文模式换英文、
 *     条数对不上回退中文；
 *  5. **真跑**：「本地数据与隐私」屏 ③ 与旧授权弹窗的「隐私说明」展开处，在英文模式下零汉字、
 *     中文模式下逐字仍是 `privacyLines()`。
 *
 * ⚠️ 能力边界：桩 DOM 无 CSS ⇒ 证的是"屏上产出哪些字"，不是排版。
 */

const CJK = /[\u3400-\u9fff]/;

/**
 * 「本地数据与隐私」屏**第 ③ 段那十三行**。
 *
 * ⚠️ `.local-data-privacy-line` 这个类名在那一屏里**多行共用**（语言态 / 教学态 / 制作器 /
 * 档案与牌组那几行也是它）⇒ 直接按类名收会多出五行（第一版就是这么假红了一次）。
 * 只有 `[data-role="privacy"]` 那一行里的 `<p>` 才是隐私说明全文。
 */
const privacySectionLines = (root: StubNode): string[] => {
  const row = queryAllIn(root, '[data-role="privacy"]')[0];
  if (row === undefined) throw new Error('夹具失败：找不到 [data-role="privacy"] 那一行');
  return descendants(row).filter((n) => n.tag === 'p').map((n) => n.text);
};

afterEach(() => {
  setLang(DEFAULT_LANG);
});

describe('① 英文那一份：逐位对应、门槛标注不漏、零汉字', () => {
  it('恰好十三段，且与 `privacyLines()` 一一对位（分组条数也逐组相等）', () => {
    const zh = privacyLines();
    expect(zh.length, '夹具前提：中文隐私说明不是十三段').toBe(13);
    expect(PRIVACY_LINES_EN.length, '英文那一份的段数与中文对不上（少一条 = 少一条承诺）').toBe(zh.length);
    // 逐组对位：把英文按`PRIVACY_GROUPS`的条数切开，逐组条数必须相等
    let at = 0;
    for (const g of PRIVACY_GROUPS) {
      const n = PRIVACY_COPY[g].length;
      expect(PRIVACY_LINES_EN.slice(at, at + n).length, `分组 ${g} 的条数与中文对不上`).toBe(n);
      at += n;
    }
    expect(at, '分组条数之和与十三段对不上（数据漂了）').toBe(13);
  });

  it('门槛标注逐条对应：中文带 `ONLINE_GATE_MARK` 的那几条，英文必须带 `PRIVACY_GATE_MARK_EN`', () => {
    const zh = privacyLines();
    let gated = 0;
    for (const [i, line] of zh.entries()) {
      const zhGated = line.includes(ONLINE_GATE_MARK);
      const enGated = PRIVACY_LINES_EN[i].includes(PRIVACY_GATE_MARK_EN);
      expect(enGated, `第 ${i + 1} 段的中英门槛标注对不上（中文${zhGated ? '有' : '没有'}标注）`).toBe(zhGated);
      if (zhGated) gated += 1;
    }
    // 反向锚点：这条腿不是在空集合上跑（实测中文里恰好 5 条带门槛标注：
    // peerVisible 2 条 + signalAndRelay 3 条；offlineCacheNote 那两条**不带**）
    expect(gated, '中文里带门槛标注的条数变了（on-line 门槛那一族）').toBe(5);
  });

  it('每条非空、零汉字；门槛标注本身也是英文', () => {
    expect(CJK.test(PRIVACY_GATE_MARK_EN), '门槛标注里混了汉字').toBe(false);
    for (const [i, line] of PRIVACY_LINES_EN.entries()) {
      expect(line.trim().length, `第 ${i + 1} 段是空的`).toBeGreaterThan(0);
      expect(CJK.test(line), `第 ${i + 1} 段里有汉字：${line.slice(0, 40)}`).toBe(false);
    }
  });

  it('抽样语义锚点（逐组第一句说的是同一件事）', () => {
    expect(PRIVACY_LINES_EN[0]).toContain('no backend server');
    expect(PRIVACY_LINES_EN[2].toLowerCase()).toContain('allow');
    expect(PRIVACY_LINES_EN[6]).toContain('P2P');
    expect(PRIVACY_LINES_EN[8].toLowerCase()).toContain('pre-caches');
    expect(PRIVACY_LINES_EN[10].toLowerCase()).toContain('signaling');
    // 中文那一份没被碰过（哈希腿另钉；这里只做"它还是中文"的锚点）
    expect(CJK.test(privacyLines()[0]), '中文那一份被改成了英文').toBe(true);
  });
});

describe('② 判据 `localizedPrivacyLines`：中文逐字、英文换表、条数不符回退中文', () => {
  it('三种情形', () => {
    const zh = privacyLines();
    expect(localizedPrivacyLines(zh, 'zh'), '中文模式没逐字返回中文').toBe(zh);
    expect(localizedPrivacyLines(zh, 'en'), '英文模式没换成英文那一份').toBe(PRIVACY_LINES_EN);
    // 条数对不上（数据漂了）⇒ 回退中文，而不是少几条承诺
    expect(localizedPrivacyLines(zh.slice(0, 3), 'en'), '条数对不上时没有回退中文').toEqual(zh.slice(0, 3));
    expect(localizedPrivacyLines([], 'en'), '空输入没有回退').toEqual([]);
  });
});

describe('③ 真跑：英文模式下那两处显示的是英文', () => {
  it('「本地数据与隐私」屏第 ③ 段：en 零汉字；zh 逐字仍是 `privacyLines()`', () => {
    const restore = installStubDom();
    // 真 `createLocalStore`（`renderLocalData` 会读授权态等；memory KV 不是 store）
    const store = createLocalStore({ persistent: createMemoryStore() });
    store.grant();
    const nav = {
      store, onBack: () => { /* noop */ }, rerender: () => { /* noop */ },
      pickArchive: async () => ({ kind: 'cancelled' }),
      saveArchive: async () => ({ kind: 'cancelled' }),
      buildArchive: async () => ({ ok: false, reason: 'unsupported' }),
      readCardmaker: async () => ({ count: 0 }),
      clearCardmaker: async () => ({ ok: true, removed: false }),
    } as never;
    try {
      // en
      setLang('en');
      const rootEn = makeStubEl('div');
      renderLocalData(rootEn as unknown as HTMLElement, nav);
      // ⚠️ 类名多行共用 ⇒ 这里用 `privacySectionLines()` 限定在 [data-role="privacy"] 那一行里
      const linesEn = privacySectionLines(rootEn);
      expect(linesEn.length, '英文模式下隐私说明没产出十三段').toBe(13);
      const zhLeft = linesEn.filter((l) => CJK.test(l));
      expect(zhLeft, `英文模式下隐私说明还有中文：${zhLeft.slice(0, 2).join(' / ')}`).toEqual([]);
      expect(linesEn, '英文模式下不是显示层那一份').toEqual([...PRIVACY_LINES_EN]);

      // zh（同一条路，逐字对照）
      setLang('zh');
      const rootZh = makeStubEl('div');
      renderLocalData(rootZh as unknown as HTMLElement, nav);
      const linesZh = privacySectionLines(rootZh);
      expect(linesZh, '中文模式下隐私说明不是 `privacyLines()` 的原句').toEqual([...privacyLines()]);
    } finally { restore(); }
  });

  it('旧授权弹窗的「隐私说明」展开处：en 零汉字、zh 逐字中文', () => {
    const restore = installStubDom();
    try {
      for (const [lang, expectEn] of [['en', true], ['zh', false]] as const) {
        setLang(lang);
        const root = makeStubEl('div');
        renderLocalConsent(root as unknown as HTMLElement, {
          onGrant: () => { /* noop */ }, onDeny: () => { /* noop */ }, openPrivacy: () => { /* noop */ },
        } as never);
        // 点「隐私说明」展开（按钮里挂着监听；桩的 dispatchEvent 沿 parentElement 冒泡）
        const link = queryAllIn(root, '.consent-privacy')[0];
        expect(link, `找不到「隐私说明」按钮（${lang}）`).toBeDefined();
        const clicker = makeStubEl('span');
        link.appendChild(clicker);
        clicker.dispatchEvent({ type: 'click', target: clicker });
        const detail = queryAllIn(root, '.consent-privacy-full')[0];
        expect(detail, `展开容器不存在（${lang}）`).toBeDefined();
        const texts = descendants(detail as StubNode).map((n) => n.text).filter((t) => t !== '');
        expect(texts.length, `${lang} 下展开后没有十三段`).toBe(13);
        if (expectEn) {
          const zhLeft = texts.filter((t) => CJK.test(t));
          expect(zhLeft, `英文模式下展开处还有中文：${zhLeft.slice(0, 2).join(' / ')}`).toEqual([]);
          expect(texts, '英文模式下展开处不是显示层那一份').toEqual([...PRIVACY_LINES_EN]);
        } else {
          expect(texts, '中文模式下展开处不是 `privacyLines()` 的原句').toEqual([...privacyLines()]);
        }
      }
    } finally { restore(); }
  });

  it('两种语言都产出十三段（反向锚点：不是"没产出所以没汉字"）', () => {
    expect(PRIVACY_LINES_EN.length, '十三段这个夹具前提变了').toBe(13);
    expect(getLang(), 'afterEach 之前的语言态').toBe(DEFAULT_LANG);
  });
});
