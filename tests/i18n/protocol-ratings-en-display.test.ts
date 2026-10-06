import { describe, it, expect, afterEach } from 'vitest';
import { setLang, DEFAULT_LANG } from '../../src/i18n';
import { PROTOCOL_RATINGS } from '../../src/data/protocolRatings';
import { PROTOCOL_RATINGS_EN, SCORE_KEYS_EN } from '../../src/i18n/protocol-ratings-en';
import { PROTOCOL_EN } from '../../src/i18n/protocol-en';
import { ratingList, ratingPosition, ratingReview, ratingScoreKey } from '../../src/ui/protocol-text';
import { buildProtocolRatingPanel, resetUiState } from '../../src/ui/render';
import { installStubDom, isClass, type StubNode } from '../ui/net-dom-stub';

/**
 * **2026-10-06：英文模式下"还剩中文"的最后一处 —— 草稿页 hover 的协议评分面板**
 *
 * 用户把要翻的字段清单发出去、外部翻回来的产物就是 `src/i18n/protocol-ratings-en.ts`
 * （45 套 × `position/review/pairs/styles` + 6 个维度名）。本文件钉四件事：
 *
 *  1. **数据完整性（生成式）**：键集恰好等于 `PROTOCOL_RATINGS` 的 defId 集（不多不少不重、
 *     顺序也一致）、每条字段非空、**一个汉字都没有**、`pairs`/`styles` 条数与中文源一致；
 *  2. **正文里的协议名用官方英文名**（`PROTOCOL_EN`）：45 条搭配每条以协议名开头，
 *     且正文里不出现中文协议名（含旧写法「僵化」「刚性」）；
 *  3. **判据（纯函数）**：中文模式逐字返回中文；英文模式换英文；缺条目 / 空串**回退中文**
 *     （宁可中文，不在屏上留空洞 —— 空串那一条用注入的假表真跑，见 `protocol-text.ts` 的 `table` 形参）；
 *  4. **真跑（面板）**：`buildProtocolRatingPanel('water')` 在 en 下整块文本零汉字、六个评分条是
 *     `Ease 8` 这样的英文键名，且 45 套逐套真跑都没汉字；中文模式下逐字仍是中文（没把它改坏）。
 *
 * ⚠️ 能力边界：桩 DOM 无 CSS/布局 ⇒ 证的是"产出的文本是什么"，不是观感。
 */

const CJK = /[\u3400-\u9fff]/;

const ratingOf = (defId: string): (typeof PROTOCOL_RATINGS)[number] => {
  const r = PROTOCOL_RATINGS.find((x) => x.defId === defId);
  if (r === undefined) throw new Error(`夹具前提：中文评分表里没有 ${defId}`);
  return r;
};

/** 连文本节点一起收（桩里 `document.createTextNode` 是 `{ text }`，不是 `StubNode`） */
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

const allStrings = (e: { position: string; review: string; pairs: readonly string[]; styles: readonly string[] }): string[] =>
  [e.position, e.review, ...e.pairs, ...e.styles];

afterEach(() => {
  // ⚠️ 不在这里调 `resetUiState()`：纯数据那两组没装桩 DOM ⇒ 放到"真跑"腿的 finally 里。
  setLang(DEFAULT_LANG);
});

describe('① 英文评分表：45 套齐全、条数对齐、零汉字', () => {
  it('键集恰好等于 `PROTOCOL_RATINGS` 的 defId 集，且顺序一致', () => {
    const ours = PROTOCOL_RATINGS.map((r) => r.defId);
    const en = Object.keys(PROTOCOL_RATINGS_EN);
    expect(ours.length, '夹具前提：本仓评分表不是 45 套，先复核').toBe(45);
    expect(en, '英文评分表的 defId 与中文源对不上（缺的就是英文模式下会显示中文的那些）').toEqual(ours);
  });

  it('每条 position / review / pairs / styles 都非空、一个汉字都没有', () => {
    for (const [defId, e] of Object.entries(PROTOCOL_RATINGS_EN)) {
      for (const s of allStrings(e)) {
        expect(s.trim().length, `${defId} 有一条英文是空的`).toBeGreaterThan(0);
        expect(CJK.test(s), `${defId} 的英文串里有汉字：${s.slice(0, 60)}`).toBe(false);
      }
    }
  });

  it('pairs / styles 的条数与中文源一一对齐（翻译时少写一条就会在屏上缺一块）', () => {
    for (const r of PROTOCOL_RATINGS) {
      const e = PROTOCOL_RATINGS_EN[r.defId];
      expect(e, `${r.defId} 没有英文条目`).toBeDefined();
      expect(e.pairs.length, `${r.defId} 的推荐搭配条数变了`).toBe(r.pairs.length);
      expect(e.styles.length, `${r.defId} 的推荐流派条数变了`).toBe(r.styles.length);
    }
  });

  it('六个维度名齐全、零汉字（键名会直接画在评分条上）', () => {
    const zhKeys = Object.keys(PROTOCOL_RATINGS[0].scores);
    expect(zhKeys.length, '夹具前提：中文评分不是六维').toBe(6);
    expect(Object.keys(SCORE_KEYS_EN).sort()).toEqual([...zhKeys].sort());
    for (const [k, v] of Object.entries(SCORE_KEYS_EN)) {
      expect(v.trim().length, `维度 ${k} 的英文名是空的`).toBeGreaterThan(0);
      expect(CJK.test(v), `维度 ${k} 的英文名里有汉字：${v}`).toBe(false);
    }
    // 每一条评分的键集都得是这六个（防止中文源里混进第七个维度却没人翻）
    for (const r of PROTOCOL_RATINGS) {
      expect(Object.keys(r.scores).sort(), `${r.defId} 的维度键与其它套不一致`).toEqual([...zhKeys].sort());
    }
  });

  it('正文里的协议名用官方英文名：45 条搭配都以英文协议名开头，且不出现中文协议名', () => {
    const enNames = new Set(Object.values(PROTOCOL_EN).map((p) => p.name));
    const zhNames = [...new Set(PROTOCOL_RATINGS.map((r) => r.name)), '僵化', '刚性'];
    for (const [defId, e] of Object.entries(PROTOCOL_RATINGS_EN)) {
      for (const p of e.pairs) {
        const head = p.split(/[—:]/)[0].trim();
        expect(enNames.has(head), `${defId} 的搭配条目没有以官方英文协议名开头：${head}`).toBe(true);
      }
      for (const s of allStrings(e)) {
        for (const n of zhNames) {
          expect(s.includes(n), `${defId} 的英文正文里还留着中文协议名「${n}」`).toBe(false);
        }
      }
    }
  });
});

describe('② 判据：中文模式逐字中文、英文模式英文、缺条目 / 空串回退中文', () => {
  it('四个助手在两种语言下的取值（water）', () => {
    const r = ratingOf('water');
    setLang('zh');
    expect(ratingPosition('water', r.position)).toBe(r.position);
    expect(ratingReview('water', r.review)).toBe(r.review);
    expect(ratingList('water', r.pairs, 'pairs')).toEqual(r.pairs);
    expect(ratingList('water', r.styles, 'styles')).toEqual(r.styles);
    for (const k of Object.keys(r.scores)) expect(ratingScoreKey(k)).toBe(k);

    setLang('en');
    expect(ratingPosition('water', r.position)).toBe('All-rounder value engine / Return engine');
    expect(ratingReview('water', r.review)).toBe(PROTOCOL_RATINGS_EN.water.review);
    expect(ratingList('water', r.pairs, 'pairs')).toEqual(PROTOCOL_RATINGS_EN.water.pairs);
    expect(ratingList('water', r.styles, 'styles')).toEqual(PROTOCOL_RATINGS_EN.water.styles);
    expect(ratingScoreKey('上手')).toBe('Ease');
    expect(ratingScoreKey('稳定')).toBe('Stability');
  });

  it('缺 defId ⇒ 回退中文；表里那格是空串 ⇒ 也回退中文（注入假表真跑这条分支）', () => {
    const zhPairs = ['甲 —— 理由', '乙 —— 理由', '丙 —— 理由'];
    setLang('en');
    expect(ratingPosition('not-a-protocol', '假定位')).toBe('假定位');
    expect(ratingReview('not-a-protocol', '假点评')).toBe('假点评');
    expect(ratingList('not-a-protocol', zhPairs, 'pairs')).toEqual(zhPairs);
    expect(ratingScoreKey('第七维')).toBe('第七维');

    // 空串 / 空数组走的是另一条判断（`en.trim() !== ''`），必须真跑一次
    expect(ratingPosition('x', '中文定位', {})).toBe('中文定位');
    expect(ratingReview('x', '中文点评', {})).toBe('中文点评');
    expect(ratingList('x', zhPairs, 'pairs', {})).toEqual(zhPairs);
    expect(ratingScoreKey('上手', {}), '假空表没有回退中文').toBe('上手');
    const blank = { x: { position: '   ', review: '', pairs: [], styles: [] } };
    expect(ratingPosition('x', '中文定位', blank), '空串定位没有回退中文').toBe('中文定位');
    expect(ratingReview('x', '中文点评', blank), '空串点评没有回退中文').toBe('中文点评');
    expect(ratingList('x', zhPairs, 'pairs', blank), '空搭配表没有回退中文').toEqual(zhPairs);
    expect(ratingList('x', zhPairs, 'styles', blank), '空流派表没有回退中文').toEqual(zhPairs);

    // 回归：中文模式下即便传空串也逐字返回（不做任何"填空"）
    setLang('zh');
    expect(ratingPosition('water', '')).toBe('');
    expect(ratingList('water', [], 'pairs')).toEqual([]);
    expect(ratingScoreKey('上手', {})).toBe('上手');
  });
});

describe('③ 真跑：草稿页那份评分面板', () => {
  it('en：整块文本零汉字 + 六个评分条是英文键名；zh：逐字仍是中文', () => {
    const restore = installStubDom();
    try {
      setLang('en');
      const box = buildProtocolRatingPanel('water') as unknown as StubNode;
      expect(isClass(box, 'draft-preview-body'), '面板根节点的类名变了').toBe(true);
      const shown = rawTexts(box);
      const joined = shown.join(' | ');
      expect(joined, '英文模式下没出现英文定位').toContain('All-rounder value engine / Return engine');
      const zhLeft = shown.filter((s) => CJK.test(s));
      expect(zhLeft, `英文模式下评分面板还有中文：${zhLeft.slice(0, 4).join(' / ')}`).toEqual([]);
      const chips = shown.filter((s) => /^(Ease|Strength|Synergy|Design|Depth|Stability) \d/.test(s));
      expect(chips.length, `六个评分条没都换成英文键名：${shown.filter((s) => /\d$/.test(s)).join(', ')}`).toBe(6);
      // 四段正文都真的画上去了（不是"因为没产出所以没汉字"）
      const r = ratingOf('water');
      expect(joined).toContain(PROTOCOL_RATINGS_EN.water.review);
      for (const p of PROTOCOL_RATINGS_EN.water.pairs) expect(joined, `英文搭配没画上去：${p}`).toContain(p);
      for (const s of PROTOCOL_RATINGS_EN.water.styles) expect(joined, `英文流派没画上去：${s}`).toContain(s);
      expect(r.review.length, '夹具前提：中文点评不该是空的').toBeGreaterThan(0);

      // 中文模式对照（同一条路，中文原样）
      resetUiState();
      setLang('zh');
      const joinedZh = rawTexts(buildProtocolRatingPanel('water') as unknown as StubNode).join(' | ');
      expect(joinedZh).toContain(r.position);
      expect(joinedZh, '中文模式下定位变成了英文').not.toContain('All-rounder value engine');
      expect(joinedZh, '中文模式下维度名变成了英文').toContain('上手 8');
      for (const p of r.pairs) expect(joinedZh, `中文搭配没画上去：${p}`).toContain(p);
    } finally { resetUiState(); restore(); }
  });

  it('en：45 套逐套真跑，产出的文本里一个汉字都没有（生成式，不写死清单）', () => {
    const restore = installStubDom();
    try {
      setLang('en');
      const offenders: string[] = [];
      const thin: string[] = [];
      for (const r of PROTOCOL_RATINGS) {
        const box = buildProtocolRatingPanel(r.defId) as unknown as StubNode;
        const texts = rawTexts(box);
        const zhLeft = texts.filter((s) => CJK.test(s));
        if (zhLeft.length > 0) offenders.push(`${r.defId}: ${zhLeft[0].slice(0, 40)}`);
        // 反向覆盖：不许"产出为空"混过去（定位那格外面套了 `Role: {position}`，用 includes 认）
        const e = PROTOCOL_RATINGS_EN[r.defId];
        if (!texts.includes(e.review) || !texts.some((s) => s.includes(e.position))) thin.push(r.defId);
      }
      expect(offenders, `这些协议的评分面板在英文模式下还有中文：${offenders.slice(0, 5).join(' | ')}`).toEqual([]);
      expect(thin, `这些协议的面板没把英文正文画出来（可能是空产出）：${thin.slice(0, 5).join(', ')}`).toEqual([]);
    } finally { resetUiState(); restore(); }
  });
});
