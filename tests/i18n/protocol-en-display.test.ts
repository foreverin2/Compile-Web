import { describe, it, expect, afterEach } from 'vitest';
import { setLang, DEFAULT_LANG, getLang } from '../../src/i18n';
import { PROTOCOL_EN } from '../../src/i18n/protocol-en';
import { EFFECT_TAG_EN, EFFECT_TAG_GROUP_EN } from '../../src/i18n/effect-tags-en';
import { protocolKeywords, protocolMotto, protocolName } from '../../src/ui/protocol-text';
import { effectTagGroupLabel, effectTagLabel } from '../../src/ui/library-labels';
import { CARD_EFFECT_TAGS } from '../../src/data/cardEffectTags';
import { DEMO_PROTOCOLS, getProtocolDef } from '../../src/data/demo';
import { openZoom, resetUiState } from '../../src/ui/render';
import { renderLibrary } from '../../src/ui/home';
import { descendants, installStubDom, isClass, makeStubEl, type StubNode } from '../ui/net-dom-stub';

/**
 * **2026-10-06 用户报的缺陷（英文模式下还剩中文）**
 *
 * 用户原话：「检查一下看看，目前游戏内的文本还有没有在英文模式下，不使用英文的文本，例如图中的
 * 那些使用了中文文本的地方：图1的图鉴系统，图二查看协议详情时右侧的文本信息，我猜测双人远程联机
 * 的卡牌或协议的详情展示框中也会显示中文的文本信息」+「我希望英文模式下，那些协议的座右铭会变成
 * 其卡牌上对应的座右铭内容」。
 *
 * ## 本文件钉什么
 *
 *  1. **数据完整性（生成式）**：英文协议表**恰好覆盖** `DEMO_PROTOCOLS` 的每一套（不写死清单），
 *     且每条 name/motto/keywords 都非空、**不含任何汉字**（"英文模式下还在显示中文"就是这条在守）；
 *  2. **判据（纯函数）**：三个助手在中文模式下逐字返回中文、英文模式下换成英文、
 *     英文表里没有的 defId **回退中文**（宁可中文，不留空洞）；
 *  3. **真跑（协议详情框）**：`openZoom('water', …)` 在 en 下产出的右侧文本栏是
 *     `Water` / `Wash away and renew` / `Return · Draw · Flip`（**没有汉字**）—— 就是用户截图 2 那一格；
 *  4. **真跑（图鉴）**：`renderLibrary` 在 en 下，效果标签与分组名一个汉字都没有
 *     （用户截图 1 右下角那一栏），且中文模式下**逐字仍是中文**（没把它改坏）。
 *
 * ⚠️ 能力边界：桩 DOM 无 CSS/布局 ⇒ 这里证的是"产出的文本是什么"，不是观感。
 */

const CJK = /[\u3400-\u9fff]/;

const textsOf = (node: StubNode): string[] => {
  const out: string[] = [];
  for (const n of descendants(node)) if (typeof n.text === 'string' && n.text !== '') out.push(n.text);
  return out;
};

/**
 * 连**文本节点**一起收（`document.createTextNode` 在桩里是 `{ text }`，**不是** `StubNode`）。
 *
 * ⚠️ 为什么不能用 `descendants()`：它按接口约定**跳过非元素节点**（`children` 只含元素的语义），
 * 于是 `motto.appendChild(document.createTextNode(...))` 那段文本收不到 —— 第一版腿就因此读到
 * "Motto:  | Keywords:  "（两个空串），却以为是产出为空。
 */
const rawTexts = (node: unknown): string[] => {
  const out: string[] = [];
  const walk = (n: { text?: unknown; children?: unknown[] } | null | undefined): void => {
    if (n === null || n === undefined) return;
    if (typeof n.text === 'string' && n.text !== '') out.push(n.text);
    for (const c of (n.children ?? []) as Array<{ text?: unknown; children?: unknown[] }>) walk(c);
  };
  walk(node as { text?: unknown; children?: unknown[] });
  return out;
};

afterEach(() => {
  // ⚠️ 这里**不能**调 `resetUiState()`：它要 `document`（纯数据那两组没有装桩 DOM）
  //    ⇒ 那一步放在每个"真跑"腿的 finally 里（在 `restore()` 之前）。
  setLang(DEFAULT_LANG);
});

describe('① 英文协议表：45 套齐全、每条都是英文', () => {
  it('生成式：`PROTOCOL_EN` 的键集恰好等于 `DEMO_PROTOCOLS` 的 defId 集（不多、不少、不重）', () => {
    const ours = DEMO_PROTOCOLS.map((p) => p.defId).sort();
    const en = Object.keys(PROTOCOL_EN).sort();
    expect(ours.length, '夹具前提：本仓协议不是 45 套，先复核').toBe(45);
    expect(en, '英文协议表与本仓协议表对不上（缺的就是英文模式下会显示中文的那些）').toEqual(ours);
  });

  it('每一条的 name / motto / keywords 都非空，且**一个汉字都没有**', () => {
    for (const [defId, e] of Object.entries(PROTOCOL_EN)) {
      expect(e.name.trim().length, `${defId} 的英文名是空的`).toBeGreaterThan(0);
      expect(e.motto.trim().length, `${defId} 的英文座右铭是空的`).toBeGreaterThan(0);
      expect(e.keywords.length, `${defId} 的英文关键词是空的`).toBeGreaterThan(0);
      for (const s of [e.name, e.motto, ...e.keywords]) {
        expect(CJK.test(s), `${defId} 的英文串里有汉字：${s}`).toBe(false);
      }
    }
  });

  it('抽样核对（来源是正版英文协议表 protocols.json 的 top/bottom）', () => {
    expect(PROTOCOL_EN.water).toEqual({ name: 'Water', motto: 'Wash away and renew', keywords: ['Return', 'Draw', 'Flip'] });
    expect(PROTOCOL_EN.rigidity.name).toBe('Rigid');
    expect(PROTOCOL_EN.smoke.motto, '源数据里 Smoke 的座右铭前导空格没去掉').toBe('A blanket of obfuscation');
    expect(PROTOCOL_EN.inertia.name, 'Inert 的 defId 映射（inertia）不对').toBe('Inert');
    expect(PROTOCOL_EN.flexibility.name, 'Flexible 的 defId 映射（flexibility）不对').toBe('Flexible');
  });
});

describe('② 判据：中文模式逐字中文、英文模式英文、缺条目回退中文', () => {
  it('protocol-name / motto / keywords 三个助手', () => {
    const water = getProtocolDef('water');
    setLang('zh');
    expect(protocolName(water)).toBe(water.name);
    expect(protocolMotto(water)).toBe(water.loadingText);
    expect(protocolKeywords(water)).toBe(water.commands.join(' · '));
    setLang('en');
    expect(protocolName(water)).toBe('Water');
    expect(protocolMotto(water)).toBe('Wash away and renew');
    expect(protocolKeywords(water)).toBe('Return · Draw · Flip');
    // 英文表里没有的 defId ⇒ 回退中文（不留空洞）
    const fake = { defId: 'not-a-protocol', name: '假协议', loadingText: '假座右铭', commands: ['甲', '乙'] };
    expect(protocolName(fake)).toBe('假协议');
    expect(protocolMotto(fake)).toBe('假座右铭');
    expect(protocolKeywords(fake)).toBe('甲 · 乙');
  });

  it('效果标签 / 分组名两个助手（生成式覆盖 30 个标签与全部分组）', () => {
    setLang('zh');
    for (const tag of CARD_EFFECT_TAGS) {
      expect(effectTagLabel(tag), `中文模式下 ${tag.id} 的标签被改动了`).toBe(tag.label);
      expect(effectTagGroupLabel(tag.group), `中文模式下分组 ${tag.group} 被改动了`).toBe(tag.group);
    }
    setLang('en');
    const groups = [...new Set(CARD_EFFECT_TAGS.map((t) => t.group))];
    for (const tag of CARD_EFFECT_TAGS) {
      const en = effectTagLabel(tag);
      expect(en, `英文模式下 ${tag.id} 没有英文标签（还是中文：${tag.label}）`).not.toBe(tag.label);
      expect(CJK.test(en), `${tag.id} 的英文标签里有汉字`).toBe(false);
    }
    expect(Object.keys(EFFECT_TAG_EN).sort(), '英文标签表的键集与 30 个标签对不上')
      .toEqual(CARD_EFFECT_TAGS.map((t) => t.id).sort());
    expect(Object.keys(EFFECT_TAG_GROUP_EN).sort(), '分组表与事实层的分组名对不上').toEqual(groups.sort());
    for (const g of groups) {
      const en = effectTagGroupLabel(g);
      expect(CJK.test(en), `分组 ${g} 的英文名里有汉字`).toBe(false);
    }
  });
});

describe('③ 真跑：协议详情框（用户截图 2 那一格）', () => {
  it('en：右侧文本栏是 Water / Wash away and renew / Return · Draw · Flip，一个汉字都没有', () => {
    const restore = installStubDom();
    try {
      setLang('en');
      openZoom('water', true, true, false);
      const box = descendants(document.body as unknown as StubNode).find((n) => isClass(n, 'protocol-zoom-text'));
      expect(box, '协议放大框右侧的文本栏没产出').toBeDefined();
      const shown = rawTexts(box).join(' | ');
      expect(shown).toContain('Water');
      expect(shown).toContain('Wash away and renew');
      expect(shown).toContain('Return · Draw · Flip');
      expect(CJK.test(shown), `英文模式下协议详情框里还有汉字：${shown}`).toBe(false);
      // 中文模式对照（同一条路，中文原样）
      resetUiState();
      setLang('zh');
      openZoom('water', true, true, false);
      const boxZh = descendants(document.body as unknown as StubNode).find((n) => isClass(n, 'protocol-zoom-text'));
      const shownZh = rawTexts(boxZh).join(' | ');
      expect(shownZh).toContain('流水');
      expect(shownZh).toContain('涤旧焕新');
    } finally { resetUiState(); restore(); }
  });
});

describe('④ 真跑：图鉴（用户截图 1 那一屏）', () => {
  it('en：效果标签栏与协议组头里没有汉字；zh：逐字仍是中文', () => {
    const restore = installStubDom();
    try {
      const root = makeStubEl('div');
      setLang('en');
      renderLibrary(root as unknown as HTMLElement, () => { /* noop */ });
      const labels = descendants(root).filter((n) => isClass(n, 'lib-effect-label')).map((n) => n.text);
      expect(labels.length, '夹具失败：图鉴里没有效果标签').toBeGreaterThan(20);
      const zhLeft = labels.filter((t) => CJK.test(t));
      expect(zhLeft, `英文模式下效果标签还是中文：${zhLeft.join(', ')}`).toEqual([]);
      const groups = descendants(root).filter((n) => isClass(n, 'lib-effect-group-name')).map((n) => n.text);
      expect(groups.length, '夹具失败：没有分组名').toBe(5);
      expect(groups.filter((t) => CJK.test(t)), '英文模式下分组名还是中文').toEqual([]);
      // 协议组头（名称 · 座右铭 + 关键词行）：也不许有汉字
      const protoHeaders = descendants(root).filter((n) => isClass(n, 'lib-proto-name') || isClass(n, 'lib-proto-commands'))
        .map((n) => n.text).filter((t) => t !== '');
      expect(protoHeaders.length, '夹具失败：没有协议组头').toBeGreaterThan(2);
      const zhHeaders = protoHeaders.filter((t) => CJK.test(t));
      expect(zhHeaders, `英文模式下协议组头还有中文：${zhHeaders.slice(0, 4).join(' / ')}`).toEqual([]);
      expect(protoHeaders.join(' | '), '英文协议名/座右铭没出现').toContain('Water · Wash away and renew');

      // 中文模式：同一批文本必须仍是中文（没把它改坏）
      resetUiState();
      const rootZh = makeStubEl('div');
      setLang('zh');
      renderLibrary(rootZh as unknown as HTMLElement, () => { /* noop */ });
      const labelsZh = descendants(rootZh).filter((n) => isClass(n, 'lib-effect-label')).map((n) => n.text);
      expect(labelsZh.filter((t) => CJK.test(t)).length, '中文模式下效果标签变成英文了').toBe(labelsZh.length);
      expect(descendants(rootZh).filter((n) => isClass(n, 'lib-proto-name')).map((n) => n.text).join(' | '))
        .toContain('流水 · 涤旧焕新');
    } finally { resetUiState(); restore(); }
  });
});
