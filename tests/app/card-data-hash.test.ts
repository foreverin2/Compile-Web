/**
 * 卡牌数据指纹行为腿（G3 Task 2；见 docs/2026-09-16-G3-档案格式-实现计划.md §Task 2、
 * docs/2026-09-13-联机与多端-设计稿.md §3.4）。
 *
 * 覆盖五类判据：
 *  1. **稳定性**：同数据 / 键序不同 / 数组顺序不同 ⇒ 同一指纹；`commands` 次序语义相关 ⇒ 必须变。
 *  2. **敏感性**：改一字（效果文本、卡的身份牌名 `defId`）、改一数（点数）、增删一张 ⇒ 必须变。
 *  3. **覆盖面**：纳入 = 卡的 defId/protocol/value/top/middle/bottom + 协议的 defId/commands；
 *     排除 = 协议 name/loadingText/set、PROTOCOL_RATINGS、图片路径、任何未知附加字段。
 *     每一条"排除"都配一条**反向腿**（改动它 ⇒ 指纹**不变**），否则"未覆盖"会静默变成"以为覆盖了"。
 *  4. **跨平台**：只用码点序，禁用 localeCompare/Intl.Collator（黄金常量腿 + 源码腿各一条）。
 *  5. **纯函数**：不修改入参、不依赖模块状态、跨模块实例（`vi.resetModules`）一致。
 *
 * 数据一律**从 `src/data/*.ts` 直接 import**（构建期同一份真相），不自己读文件再解析。
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CARD_DATA_HASH, cardDataHashOf } from '../../src/app/card-data-hash';
import { ALL_CARD_DEFS, DEMO_CARD_DEFS, DEMO_PROTOCOLS } from '../../src/data/demo';
import { PROTOCOL_RATINGS } from '../../src/data/protocolRatings';
import { stripComments } from '../ui/source-text';
import type { CardDef, ProtocolDef } from '../../src/core/models/types';

/* ─────────────────────────── helpers ─────────────────────────── */

const cloneCard = (c: CardDef): CardDef => ({ ...c });
const cloneProtocol = (p: ProtocolDef): ProtocolDef => ({ ...p, commands: [...p.commands] });

/** 同一份数据、**键序打乱**后重建（模拟 JSON 往返 / 不同序列化器写出的键序差异） */
function reorderKeys<T extends object>(obj: T): T {
  const src = obj as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(src).reverse()) out[k] = src[k];
  return out as T;
}

/** 挂上未知附加字段（走 cast 是为了绕开对象字面量的 excess property check，而非放宽类型） */
function withExtra<T extends object>(obj: T, extra: Record<string, unknown>): T {
  return { ...obj, ...extra } as T;
}

/** 按 defId 替换其中一张卡（或用合成卡替换同一 defId） */
const replaceCard = (cards: readonly CardDef[], defId: string, next: CardDef): CardDef[] =>
  cards.map((c) => (c.defId === defId ? next : c));

const replaceProtocol = (protocols: readonly ProtocolDef[], defId: string, next: ProtocolDef): ProtocolDef[] =>
  protocols.map((p) => (p.defId === defId ? next : p));

/* ─────────────────────────── 1. 稳定性 ─────────────────────────── */

describe('cardDataHash（§3.4）— 稳定性', () => {
  it('常量 == 现算值（防手改常量；常量来自模块顶层现算，不做缓存）', () => {
    expect(cardDataHashOf(DEMO_CARD_DEFS, DEMO_PROTOCOLS)).toBe(CARD_DATA_HASH);
  });

  it('同输入多次调用稳定（纯函数、无内部状态）', () => {
    expect(cardDataHashOf(DEMO_CARD_DEFS, DEMO_PROTOCOLS)).toBe(
      cardDataHashOf(DEMO_CARD_DEFS, DEMO_PROTOCOLS),
    );
  });

  it('形状：16 位小写十六进制（与 hash64 同规格）', () => {
    expect(CARD_DATA_HASH).toMatch(/^[0-9a-f]{16}$/);
  });

  it('键序无关：把对象属性顺序打乱后重建，指纹不变', () => {
    const cards = DEMO_CARD_DEFS.map((c) => reorderKeys(cloneCard(c)));
    const protocols = DEMO_PROTOCOLS.map((p) => reorderKeys(cloneProtocol(p)));
    // 非空腿：确实打乱了键序（否则这条腿可能因为"什么都没做"而假绿）
    expect(Object.keys(cards[0])).not.toEqual(Object.keys(DEMO_CARD_DEFS[0]));
    expect(Object.keys(protocols[0])).not.toEqual(Object.keys(DEMO_PROTOCOLS[0]));
    expect(cardDataHashOf(cards, protocols)).toBe(CARD_DATA_HASH);
  });

  it('数组顺序无关：逆序 / 旋转 / 三代交叉，指纹都不变（并池顺序不是语义）', () => {
    const rotated = [...DEMO_CARD_DEFS.slice(7), ...DEMO_CARD_DEFS.slice(0, 7)];
    // 交叉：偶数位在前、奇数位在后 —— 是**排列**（元素一个不多一个不少），不是子集
    const evens = DEMO_CARD_DEFS.filter((_, i) => i % 2 === 0);
    const odds = DEMO_CARD_DEFS.filter((_, i) => i % 2 === 1);
    const interleaved = [...evens, ...odds];
    expect(interleaved.length).toBe(DEMO_CARD_DEFS.length); // 非空腿：确认是排列
    expect(cardDataHashOf([...DEMO_CARD_DEFS].reverse(), [...DEMO_PROTOCOLS].reverse())).toBe(CARD_DATA_HASH);
    expect(cardDataHashOf(rotated, [...DEMO_PROTOCOLS].reverse())).toBe(CARD_DATA_HASH);
    expect(cardDataHashOf(interleaved, DEMO_PROTOCOLS)).toBe(CARD_DATA_HASH);
  });

  it('defId 重复（同 defId 不同内容）时也与输入顺序无关（整行做次级排序键）', () => {
    const dup: CardDef[] = [
      { defId: 'dup-0', protocol: 'dup', value: 1, middle: '甲' },
      { defId: 'dup-0', protocol: 'dup', value: 1, middle: '乙' },
    ];
    expect(cardDataHashOf([...dup].reverse(), [])).toBe(cardDataHashOf(dup, []));
    // 有齿：两份内容不同 ⇒ 不是"排序后只剩一行"的假象
    expect(cardDataHashOf(dup, [])).not.toBe(cardDataHashOf([dup[0]], []));
  });

  const commandsOrderable = (p: ProtocolDef): boolean =>
    p.commands.length >= 2 && p.commands.join('/') !== [...p.commands].reverse().join('/');

  it('协议 commands 的**顺序**语义相关：换序 ⇒ 指纹必须变（失败安全方向，见实现注释）', () => {
    const targets = DEMO_PROTOCOLS.filter(commandsOrderable);
    expect(targets.length).toBeGreaterThan(0); // 非空腿：不许因为"一条都没测"而假绿
    for (const p of targets) {
      const swapped = replaceProtocol(DEMO_PROTOCOLS, p.defId, { ...p, commands: [...p.commands].reverse() });
      expect(cardDataHashOf(DEMO_CARD_DEFS, swapped), `${p.defId} 的 commands 换序后指纹未变`).not.toBe(
        CARD_DATA_HASH,
      );
    }
  });

  it('纯函数：不修改入参（不排序调用方的数组、不改对象字段）', () => {
    const cards = DEMO_CARD_DEFS.map(cloneCard);
    const protocols = DEMO_PROTOCOLS.map(cloneProtocol);
    const cardsBefore = cards.map((c) => `${c.defId}|${c.value}|${c.middle ?? ''}`);
    const protosBefore = protocols.map((p) => p.commands.join('/'));
    cardDataHashOf(cards, protocols);
    expect(cards.map((c) => `${c.defId}|${c.value}|${c.middle ?? ''}`)).toEqual(cardsBefore);
    expect(protocols.map((p) => p.commands.join('/'))).toEqual(protosBefore);
    // 有齿：演示池的原始顺序**不是**码点序，所以"就地排序"会当场被上面两条逮住
    expect(cards.map((c) => c.defId)).not.toEqual([...cards.map((c) => c.defId)].sort());
  });

  it('跨模块实例一致（`vi.resetModules` 后重新求值仍是同一个常量）', async () => {
    vi.resetModules();
    const fresh = await import('../../src/app/card-data-hash');
    expect(fresh.CARD_DATA_HASH).toBe(CARD_DATA_HASH);
    vi.resetModules();
  });
});

/* ─────────────────────────── 2. 敏感性 ─────────────────────────── */

describe('cardDataHash（§3.4）— 敏感性', () => {
  it('改一个数值（点数 value）⇒ 指纹必须变（全卡池，非抽样）', () => {
    for (const card of DEMO_CARD_DEFS) {
      const mutated = replaceCard(DEMO_CARD_DEFS, card.defId, { ...card, value: card.value + 1 });
      expect(cardDataHashOf(mutated, DEMO_PROTOCOLS), `${card.defId} 的 value 改动后指纹未变`).not.toBe(
        CARD_DATA_HASH,
      );
    }
  });

  it('改一个字（效果文本 top / middle / bottom）⇒ 指纹必须变（全卡池）', () => {
    const fields = ['top', 'middle', 'bottom'] as const;
    const touched: Record<string, number> = { top: 0, middle: 0, bottom: 0 };
    for (const card of DEMO_CARD_DEFS) {
      for (const f of fields) {
        const text = card[f];
        if (text === undefined) continue;
        touched[f] += 1;
        const mutated = replaceCard(DEMO_CARD_DEFS, card.defId, { ...card, [f]: `${text}改` });
        expect(cardDataHashOf(mutated, DEMO_PROTOCOLS), `${card.defId}.${f} 改一字后指纹未变`).not.toBe(
          CARD_DATA_HASH,
        );
      }
    }
    // 非空腿：三个效果文本字段都确实被改了至少一次（否则某字段整段没覆盖到）
    expect(touched.top).toBeGreaterThan(0);
    expect(touched.middle).toBeGreaterThan(0);
    expect(touched.bottom).toBeGreaterThan(0);
  });

  it('改卡的身份（defId，即"卡名"位）⇒ 指纹必须变（全卡池）', () => {
    for (const card of DEMO_CARD_DEFS) {
      const mutated = replaceCard(DEMO_CARD_DEFS, card.defId, { ...card, defId: `${card.defId}X` });
      expect(cardDataHashOf(mutated, DEMO_PROTOCOLS), `${card.defId} 改名后指纹未变`).not.toBe(CARD_DATA_HASH);
    }
  });

  it('改卡的归属协议（protocol）⇒ 指纹必须变（全卡池）', () => {
    for (const card of DEMO_CARD_DEFS) {
      const mutated = replaceCard(DEMO_CARD_DEFS, card.defId, { ...card, protocol: `${card.protocol}X` });
      expect(cardDataHashOf(mutated, DEMO_PROTOCOLS), `${card.defId} 换协议后指纹未变`).not.toBe(CARD_DATA_HASH);
    }
  });

  it('改一条协议指令（改一字 / 增一条 / 删一条）⇒ 指纹必须变（全协议）', () => {
    for (const p of DEMO_PROTOCOLS) {
      const edited = replaceProtocol(DEMO_PROTOCOLS, p.defId, {
        ...p,
        commands: [`${p.commands[0]}改`, ...p.commands.slice(1)],
      });
      expect(cardDataHashOf(DEMO_CARD_DEFS, edited), `${p.defId} 指令改一字后指纹未变`).not.toBe(CARD_DATA_HASH);

      const appended = replaceProtocol(DEMO_PROTOCOLS, p.defId, { ...p, commands: [...p.commands, '假指令'] });
      expect(cardDataHashOf(DEMO_CARD_DEFS, appended), `${p.defId} 增一条指令后指纹未变`).not.toBe(CARD_DATA_HASH);

      const dropped = replaceProtocol(DEMO_PROTOCOLS, p.defId, { ...p, commands: p.commands.slice(1) });
      expect(cardDataHashOf(DEMO_CARD_DEFS, dropped), `${p.defId} 删一条指令后指纹未变`).not.toBe(CARD_DATA_HASH);
    }
  });

  it('增删一张卡 ⇒ 指纹必须变（全卡池逐一删除 + 合成一张新卡）', () => {
    // 删：逐张删（生成式清单 —— 不是手写抽样，任何一张都必须让指纹变）
    for (const card of DEMO_CARD_DEFS) {
      const subset = DEMO_CARD_DEFS.filter((c) => c.defId !== card.defId);
      expect(cardDataHashOf(subset, DEMO_PROTOCOLS), `去掉 ${card.defId} 后指纹未变`).not.toBe(CARD_DATA_HASH);
    }
    // 增：合成一张此前不存在的卡
    const added: CardDef[] = [...DEMO_CARD_DEFS, { defId: 'zzz-0', protocol: 'zzz', value: 9, middle: '新卡' }];
    expect(cardDataHashOf(added, DEMO_PROTOCOLS)).not.toBe(CARD_DATA_HASH);
    // 增：与已有卡**完全重复**的一张（排序不去重 ⇒ 多出一行 ⇒ 指纹必须变；
    // 这条腿会在"将来有人改成 Set/Map 去重"时第一个红）
    const duplicated: CardDef[] = [...DEMO_CARD_DEFS, DEMO_CARD_DEFS[0]];
    expect(cardDataHashOf(duplicated, DEMO_PROTOCOLS)).not.toBe(CARD_DATA_HASH);
  });

  it('增删一条协议 ⇒ 指纹必须变（逐条删除，含"只指纹了部分协议"的形态）', () => {
    for (const p of DEMO_PROTOCOLS) {
      const subset = DEMO_PROTOCOLS.filter((x) => x.defId !== p.defId);
      expect(cardDataHashOf(DEMO_CARD_DEFS, subset), `去掉协议 ${p.defId} 后指纹未变`).not.toBe(CARD_DATA_HASH);
    }
  });

  it('覆盖全部三代卡牌（只指纹第一代 ⇒ 必须变）', () => {
    expect(ALL_CARD_DEFS.length).toBeLessThan(DEMO_CARD_DEFS.length); // 非空腿：一代确实只是子集
    expect(cardDataHashOf(ALL_CARD_DEFS, DEMO_PROTOCOLS)).not.toBe(CARD_DATA_HASH);
    // 每一代各剔掉一张，指纹都必须变（防止"只指纹了第一代"这类覆盖率缺口）
    const n = DEMO_CARD_DEFS.length / 3;
    expect(Number.isInteger(n)).toBe(true);
    for (let gen = 0; gen < 3; gen++) {
      const sample = DEMO_CARD_DEFS[gen * n];
      const subset = DEMO_CARD_DEFS.filter((c) => c.defId !== sample.defId);
      expect(cardDataHashOf(subset, DEMO_PROTOCOLS), `第 ${gen + 1} 代的 ${sample.defId} 未进指纹`).not.toBe(
        CARD_DATA_HASH,
      );
    }
  });
});

/* ─────────────────── 3. 覆盖面：每一条"不包含"的反向腿 ─────────────────── */

describe('cardDataHash（§3.4）— 不包含的字段（反向腿：改动它 ⇒ 指纹不变）', () => {
  it('不包含协议展示名 name、读条文案 loadingText（改了不该拒绝联机）', () => {
    const renamed = DEMO_PROTOCOLS.map((p) => ({ ...p, name: `${p.name}·改`, loadingText: `${p.loadingText}改` }));
    expect(renamed[0].name).not.toBe(DEMO_PROTOCOLS[0].name); // 非空腿
    expect(cardDataHashOf(DEMO_CARD_DEFS, renamed)).toBe(CARD_DATA_HASH);
  });

  it('不包含协议 set（世代/分组元数据：只影响取图后缀与图鉴分组，不影响规则）', () => {
    const reseated = DEMO_PROTOCOLS.map((p) => ({
      ...p,
      set: (p.set === 'AX03' ? 'MN01' : 'AX03') as ProtocolDef['set'],
    }));
    expect(reseated[0].set).not.toBe(DEMO_PROTOCOLS[0].set); // 非空腿
    expect(cardDataHashOf(DEMO_CARD_DEFS, reseated)).toBe(CARD_DATA_HASH);
  });

  it('不包含图片路径等未知附加字段（只读具名字段，不遍历键）', () => {
    const cards = DEMO_CARD_DEFS.map((c) => withExtra(c, { imgSrc: '/cards/zzz.png', imgPath: 'a/b/c.jpg' }));
    const protocols = DEMO_PROTOCOLS.map((p) => withExtra(p, { imgSrc: '/protocols/zzz.png', rating: 10 }));
    expect(Object.keys(cards[0])).not.toEqual(Object.keys(DEMO_CARD_DEFS[0])); // 非空腿：附加字段确实挂上去了
    expect(Object.keys(protocols[0])).not.toEqual(Object.keys(DEMO_PROTOCOLS[0]));
    expect(cardDataHashOf(cards, protocols)).toBe(CARD_DATA_HASH);
  });

  it('不包含 PROTOCOL_RATINGS（自动生成的展示数据）：改它指纹不变', () => {
    const base = cardDataHashOf(DEMO_CARD_DEFS, DEMO_PROTOCOLS);
    const first = PROTOCOL_RATINGS[0];
    const backup = { review: first.review, position: first.position, scores: JSON.stringify(first.scores) };
    try {
      // 直接改这份"自动生成"的展示数据，模拟 tools/parse-ratings.mjs 重新生成后内容变化
      first.review = `${first.review}（改）`;
      first.position = '（改）';
      first.scores = { ...first.scores, 上手: (first.scores['上手'] ?? 0) + 1 };
      expect(first.review).not.toBe(backup.review); // 非空腿：确实改了
      expect(cardDataHashOf(DEMO_CARD_DEFS, DEMO_PROTOCOLS)).toBe(base);
    } finally {
      first.review = backup.review;
      first.position = backup.position;
      first.scores = JSON.parse(backup.scores) as Record<string, number>;
    }
  });

  it('可选文本归一化：undefined 与空串等价（写法差异不该造成假不匹配）', () => {
    const omitted: CardDef[] = [{ defId: 'x-0', protocol: 'x', value: 1, top: '甲', middle: '乙' }];
    const undef: CardDef[] = [{ defId: 'x-0', protocol: 'x', value: 1, top: '甲', middle: '乙', bottom: undefined }];
    const empty: CardDef[] = [{ defId: 'x-0', protocol: 'x', value: 1, top: '甲', middle: '乙', bottom: '' }];
    expect(cardDataHashOf(undef, [])).toBe(cardDataHashOf(omitted, []));
    expect(cardDataHashOf(empty, [])).toBe(cardDataHashOf(omitted, []));
    // 有齿：真正有文本时必须区分（'' 与 '丙' 不是同一件事）
    const filled: CardDef[] = [{ defId: 'x-0', protocol: 'x', value: 1, top: '甲', middle: '乙', bottom: '丙' }];
    expect(cardDataHashOf(filled, [])).not.toBe(cardDataHashOf(omitted, []));
  });
});

/* ─────────────────────────── 4. 跨平台 ─────────────────────────── */

describe('cardDataHash（§3.4）— 跨平台（码点序，禁用本地化排序）', () => {
  /**
   * 黄金常量：把**合成输入**的指纹钉死。
   *
   * 合成输入里的 `'B-上'` / `'a-下'` 是**故意挑的**：码点序 `'B'(0x42) < 'a'(0x61)`，而
   * `localeCompare`（en/zh 的 ICU 排序，大小写不敏感层级）给的是 `'a' < 'B'` —— 两者顺序相反。
   * 于是"把 byCodePoint 换成 localeCompare"会算出另一个串 ⇒ 这条腿在**任何 locale** 下都红，
   * 这就是"换机器/换 locale 结果不变"的可执行证据。合成输入永不变动，所以黄金值不会假红；
   * 演示池不钉常量（改卡文是合法操作，钉了会假红 —— 见计划 Step 5）。
   */
  const CHARS: CardDef[] = [
    { defId: 'B-上', protocol: 'p', value: 1, top: '甲' },
    { defId: 'a-下', protocol: 'p', value: 2, middle: '乙' },
  ];
  const PROTOS: ProtocolDef[] = [
    { defId: 'Z', name: 'x', set: 'MN01', commands: ['一'], loadingText: '' },
    { defId: '中', name: 'y', set: 'MN02', commands: ['二', '三'], loadingText: '' },
  ];
  const GOLDEN = '9938ad20df515096';

  it('合成输入的指纹 == 冻结的黄金常量（含码点序 vs localeCompare 的判别对）', () => {
    expect(cardDataHashOf(CHARS, PROTOS)).toBe(GOLDEN);
    // 换序仍是同一常量（顺序无关 + 排序确实由码点序决定）
    expect(cardDataHashOf([...CHARS].reverse(), [...PROTOS].reverse())).toBe(GOLDEN);
    // 非空腿：这对 defId 的**码点序**确实是 'B-上' 在前（否则黄金常量的判别力是空的）。
    // 这里刻意**不**断言 localeCompare 的结果 —— 那条断言本身就会随运行 locale 变化，
    // 属于把"本地化排序"引进测试的同一类错误。"localeCompare 会让黄金常量变红"这件事
    // 由变异实测证明（见报告变异表 #5），不是在测试里靠 locale 现场比较。
    expect('B-上' < 'a-下').toBe(true);
    expect('a-下' < 'B-上').toBe(false);
  });

  it('实现源码不含 localeCompare / Intl.Collator，也不含浏览器 API 与随机源（文本腿，补充行为腿）', () => {
    const src = stripComments(
      readFileSync(fileURLToPath(new URL('../../src/app/card-data-hash.ts', import.meta.url)))
        .subarray(0, 1024 * 1024)
        .toString('utf8'),
    );
    expect(src).not.toMatch(/localeCompare|Intl\s*\.\s*Collator/);
    expect(src).not.toMatch(/toLocale(Lower|Upper)Case/);
    expect(src).not.toMatch(/\b(document|window|localStorage|sessionStorage|indexedDB|navigator|fetch)\b/);
    expect(src).not.toMatch(/Math\s*\.\s*random|Date\s*\.\s*now|crypto\s*\./);
    // 也确认它没偷偷把展示数据拉进指纹面
    expect(src).not.toMatch(/protocolRatings|PROTOCOL_RATINGS/);
  });
});
