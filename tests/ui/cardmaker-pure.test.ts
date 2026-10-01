import { describe, it, expect } from 'vitest';
import {
  SCALE_MAX,
  SCALE_MIN,
  PRESETS,
  CARD_W,
  CARD_H,
  LAND_W,
  LAND_H,
  POKER_W,
  POKER_H,
  PROTOCOL_FRONT,
  PROTOCOL_BACK,
  ZONES,
  DECK_FORMAT,
  DECK_VERSION,
} from '../../src/ui/cardmaker/config';
import { bgBaseScale, clampScale, zoomAt } from '../../src/ui/cardmaker/geometry';
import { cutoutBackground } from '../../src/ui/cardmaker/images';
import { hashStr, mulberry32 } from '../../src/ui/cardmaker/rng';
import {
  hydrateBg,
  hydrateCard,
  hydrateDeck,
  hydrateLogo,
  migrateBg,
  compareCardStates,
  kindPriority,
  cardValueOf,
  sortCards,
  compileCards,
  protocolCards,
} from '../../src/ui/cardmaker/model';
import {
  defaultBg,
  defaultCard,
  defaultDeck,
  defaultLogo,
  defaultTransform,
  isLandscape,
} from '../../src/ui/cardmaker/types';
import { parseDeck, packDeck, safeFileName, stringifyDeck } from '../../src/ui/cardmaker/serialize';

/**
 * 制作器**纯模块**的用例（2026-10-01）。
 *
 * 移植自参考项目 COMPILER · Card Builder（作者 Albert Blanco，MIT 许可，
 * https://github.com/albrtbc/compiler）的 `test/geometry.test.js`、`test/bg.test.js`、
 * `test/order.test.js`、`test/rng.test.js`。
 *
 * **没移植**的四个它的测试文件及理由：
 *  - `test/base64.test.js` / `test/imageKey.test.js`：那两个模块服务"分享短链"
 *    （gzip + dpaste + 图片池），本项目不做分享短链，模块本身也没搬；
 *  - `test/glitch.test.js`：glitch 特效没搬；
 *  - `test/text.test.js`：它的断言面是 `parseRich` / `markersToHtml` / `pieceFont`，
 *    其中 `markersToHtml` 属于 contenteditable 那条路（本项目用 textarea 编辑，没搬）——
 *    剩下两条在 `cardmaker-text.test.ts` 里按同样的形状重写。
 */
describe('几何（移植自 test/geometry.test.js）', () => {
  it('clampScale：假值回 1，其余夹到 [SCALE_MIN, SCALE_MAX]', () => {
    expect(clampScale(0)).toBe(1);
    expect(clampScale(undefined)).toBe(1);
    expect(clampScale(null)).toBe(1);
    expect(clampScale(0.01)).toBe(SCALE_MIN);
    expect(clampScale(9999)).toBe(SCALE_MAX);
    expect(clampScale(2)).toBe(2);
  });

  it('bgBaseScale：cover 语义（两个比值取大者）；两种卡上取到的不一定是同一个分支', () => {
    // 同尺寸 ⇒ 1
    expect(bgBaseScale({ width: CARD_W, height: CARD_H }, CARD_W, CARD_H)).toBe(1);
    // 2000×1000（2:1）进竖版卡 ⇒ 高度比 1.039 > 宽度比 0.372 ⇒ 高度分支
    expect(bgBaseScale({ width: 2000, height: 1000 }, CARD_W, CARD_H)).toBeCloseTo(CARD_H / 1000, 6);
    // 同一张图进横版卡 ⇒ 高度比 0.744 **仍**大于宽度比 0.5195 ⇒ 还是高度分支
    expect(bgBaseScale({ width: 2000, height: 1000 }, LAND_W, LAND_H)).toBeCloseTo(LAND_H / 1000, 6);
    // 一张 6000×500（12:1）：横版卡上宽度比 0.1732 < 高度比 1.488 ⇒ 高度分支
    expect(bgBaseScale({ width: 6000, height: 500 }, LAND_W, LAND_H)).toBeCloseTo(LAND_H / 500, 6);
    // 真正走到**宽度分支**需要"图片宽高比 > 卡片宽高比"：横版卡是 1039/744 ≈ 1.397。
    // 反过来，一张**竖图**（500×4000）进横版卡 ⇒ 宽度比 2.078 > 高度比 0.186 ⇒ 宽度分支。
    // 这条是"另一个分支真的会被取到"的证据（否则上面几条可能只是因为实现恒取高度比）。
    expect(bgBaseScale({ width: 500, height: 4000 }, LAND_W, LAND_H)).toBeCloseTo(LAND_W / 500, 6);
    // 同一张竖图进竖版卡 ⇒ 宽度比 1.488 > 高度比 0.2598 ⇒ 改走**宽度分支**
    expect(bgBaseScale({ width: 500, height: 4000 }, CARD_W, CARD_H)).toBeCloseTo(CARD_W / 500, 6);
    // 两条分支给出的值确实不同（否则"取了哪一支"这件事测不出来）
    expect(CARD_W / 500).toBeCloseTo(1.488, 3);
    expect(CARD_H / 4000).toBeCloseTo(0.2598, 3);
    expect(CARD_W / 500).toBeGreaterThan(CARD_H / 4000);
  });

  it('zoomAt：把光标下那一点钉住（缩放前后它对应的图上位置不变）', () => {
    // 基准 cover 倍数 = 1（图与盒子同尺寸 400×400 → 取 1）
    const img = { width: 400, height: 400 };
    const dw = 400;
    const dh = 400;
    const base = bgBaseScale(img, dw, dh);
    const t = { scale: 1, offsetX: 0, offsetY: 0 };
    const cx = 100;
    const cy = 120;
    // 缩放前：光标下的图上坐标
    const s0 = base * t.scale;
    const u = (cx - ((dw - img.width * s0) / 2 + t.offsetX)) / s0;
    const v = (cy - ((dh - img.height * s0) / 2 + t.offsetY)) / s0;

    const next = zoomAt(t, dw, dh, cx, cy, 2);
    expect(next.scale).toBe(2);
    // 缩放后：同一个 (u,v) 必须仍落在 (cx,cy)
    const s1 = base * next.scale;
    const x = (dw - img.width * s1) / 2 + next.offsetX + u * s1;
    const y = (dh - img.height * s1) / 2 + next.offsetY + v * s1;
    expect(x).toBeCloseTo(cx, 6);
    expect(y).toBeCloseTo(cy, 6);
    // 反向锚点：不平移的那一档**不**满足（否则上面的相等可能是恒真的）
    const noMove = { scale: 2, offsetX: 0, offsetY: 0 };
    const x2 = (dw - img.width * base * noMove.scale) / 2 + noMove.offsetX + u * base * noMove.scale;
    expect(x2).not.toBeCloseTo(cx, 3);
  });

  it('zoomAt：光标在正中时平移不动（对称性）', () => {
    const next = zoomAt({ scale: 1, offsetX: 0, offsetY: 0 }, 400, 400, 200, 200, 2);
    expect(next.offsetX).toBeCloseTo(0, 9);
    expect(next.offsetY).toBeCloseTo(0, 9);
  });

  it('zoomAt：已经到上下限时倍数被夹住、平移**不动**（否则画面会漂）', () => {
    const up = zoomAt({ scale: SCALE_MAX, offsetX: 7, offsetY: -3 }, 400, 400, 50, 60, 2);
    expect(up).toEqual({ scale: SCALE_MAX, offsetX: 7, offsetY: -3 });
    const down = zoomAt({ scale: SCALE_MIN, offsetX: 7, offsetY: -3 }, 400, 400, 50, 60, 0.5);
    expect(down).toEqual({ scale: SCALE_MIN, offsetX: 7, offsetY: -3 });
  });
});

describe('确定性随机（移植自 test/rng.test.js；用途：同一份内容同一把卡 id）', () => {
  it('hashStr 确定、无符号 32 位、不同输入不同值', () => {
    expect(hashStr('glitch')).toBe(hashStr('glitch'));
    const h = hashStr('Water|protocol|Fire');
    expect(Number.isInteger(h)).toBe(true);
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThanOrEqual(0xffffffff);
    expect(hashStr('a')).not.toBe(hashStr('b'));
  });

  it('mulberry32 同种子同序列、值落在 [0,1)', () => {
    const a = mulberry32(123);
    const b = mulberry32(123);
    expect([a(), a(), a(), a()]).toEqual([b(), b(), b(), b()]);
    const r = mulberry32(hashStr('seed'));
    for (let i = 0; i < 300; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
    expect(mulberry32(1)()).not.toBe(mulberry32(2)());
  });
});

describe('模型工厂（移植自 test/bg.test.js 的 factories）', () => {
  it('每次给的都是**新对象**（不共享引用）', () => {
    expect(defaultTransform()).toEqual({ scale: 1, offsetX: 0, offsetY: 0 });
    expect(defaultBg()).toEqual({ type: 'none', name: null, dataUrl: null, transform: { scale: 1, offsetX: 0, offsetY: 0 } });
    expect(defaultLogo()).toEqual({ dataUrl: null, zoom: 1, offsetX: 0, offsetY: 0 });
    expect(defaultBg().transform).not.toBe(defaultBg().transform);
  });

  it('defaultDeck 的两种卡各自有一套背景/logo，且默认不共用引用', () => {
    const d = defaultDeck();
    expect(d.shared.perCardBg).toBe(false);
    expect(d.shared.compile.bg).not.toBe(d.shared.protocol.bg);
    expect(d.shared.compile.bg).toEqual(defaultBg());
    expect(d.cards).toEqual([]);
  });

  it('isLandscape：只有 protocol 是横版', () => {
    expect(isLandscape('protocol')).toBe(true);
    expect(isLandscape('compile')).toBe(false);
  });
});

describe('migrateBg / hydrate（移植自 test/bg.test.js）', () => {
  it('老西班牙语预设名就地改成英文名', () => {
    const bg = { type: 'preset' as const, name: 'Fuego', dataUrl: null, transform: defaultTransform() };
    expect(migrateBg(bg)).toBe(true);
    expect(bg.name).toBe('Fire');
    const same = { type: 'preset' as const, name: 'Fire', dataUrl: null, transform: defaultTransform() };
    expect(migrateBg(same)).toBe(false);
    expect(same.name).toBe('Fire');
    expect(migrateBg({ type: 'custom', name: 'Fuego' } as never)).toBe(false);
  });

  it('hydrateBg 填默认值、归一 transform、跑名字迁移', () => {
    expect(hydrateBg({ type: 'preset', name: 'Fire' })).toEqual({
      type: 'preset', name: 'Fire', dataUrl: null,
      transform: { scale: 1, offsetX: 0, offsetY: 0 },
    });
    const partial = hydrateBg({ type: 'preset', name: 'Agua', transform: { scale: 2 } as never });
    expect(partial.name).toBe('Water');
    expect(partial.transform).toEqual({ scale: 2, offsetX: 0, offsetY: 0 });
    expect(hydrateBg(null)).toEqual(defaultBg());
    expect(hydrateBg(undefined)).toEqual(defaultBg());
  });

  it('hydrateBg 把坏形状降级成"没有背景"（牌组 JSON 是用户能手改的文本）', () => {
    // 类型不认识
    expect(hydrateBg({ type: 'Preset' } as never).type).toBe('none');
    // 说"用预设"却没名字
    expect(hydrateBg({ type: 'preset' } as never).type).toBe('none');
    // 说"用自定图"却没图
    expect(hydrateBg({ type: 'custom' } as never).type).toBe('none');
    // name / dataUrl 是数字：一律当没有
    expect(hydrateBg({ type: 'preset', name: 42 } as never)).toEqual(defaultBg());
    expect(hydrateBg({ type: 'custom', dataUrl: { a: 1 } } as never)).toEqual(defaultBg());
    // 合法的一个：原样留下
    expect(hydrateBg({ type: 'custom', dataUrl: 'data:image/png;base64,AA' }).dataUrl).toBe('data:image/png;base64,AA');
  });

  it('hydrateLogo 填默认值', () => {
    expect(hydrateLogo({ zoom: 2 })).toEqual({ dataUrl: null, zoom: 2, offsetX: 0, offsetY: 0 });
    expect(hydrateLogo(null)).toEqual(defaultLogo());
  });

  it('hydrateCard 补全一张卡；kind 只认那两个值', () => {
    const c = hydrateCard({ title: 'X', kind: 'nonsense' as never }, 'fallback');
    expect(c.id).toBe('fallback');
    expect(c.kind).toBe('compile');
    expect(c.title).toBe('X');
    // ★ 2026-10-01：四段卡文本**默认全空**。参考项目那两个占位串（"LOADING..."/"COMPILED"）
    //   会在新建协议卡时印在卡面正中（用户实测报过），所以这里逐条钉住"默认是空的"。
    expect(c.compile.subtitle).toBe('');
    expect(c.compile.back).toBe('');
    expect(c.compile.top).toBe('');
    expect(c.compile.bottom).toBe('');
    expect(hydrateCard({ id: 'abc', kind: 'protocol' }, 'x').kind).toBe('protocol');
    expect(hydrateCard({ id: '' }, 'x').id).toBe('x');
  });

  it('hydrateDeck 给缺 id 的卡补一把稳定的 id，并保序', () => {
    const d = hydrateDeck({ title: 't', cards: [{ kind: 'protocol' }, { kind: 'compile', value: '3' }] as never });
    expect(d.title).toBe('t');
    expect(d.cards.map((c) => c.id)).toEqual(['card-1', 'card-2']);
    expect(d.cards.map((c) => c.kind)).toEqual(['protocol', 'compile']);
    // 非数组的 cards 一律当空（不是抛错）
    expect(hydrateDeck({ cards: 'nope' } as never).cards).toEqual([]);
  });
});

describe('牌组排序（移植自 test/order.test.js）', () => {
  const proto = { kind: 'protocol' as const, value: '' };
  const v = (n: number | string) => ({ kind: 'compile' as const, value: String(n) });

  it('kindPriority：横版协议卡最前', () => {
    expect(kindPriority(proto)).toBe(0);
    expect(kindPriority(v(3))).toBe(1);
  });

  it('compareCardStates：协议卡最前，然后数值升序；空/非数字当 0', () => {
    const sorted = [v(3), proto, v(1), v(2)].slice().sort(compareCardStates);
    expect(sorted.map((s) => (s.kind === 'protocol' ? 'P' : s.value))).toEqual(['P', '1', '2', '3']);
    const blank = [v(2), v('')].slice().sort(compareCardStates);
    expect(blank.map((s) => s.value)).toEqual(['', '2']);
    expect(cardValueOf({ value: 'abc' })).toBe(0);
    // 反向：数值确实参与排序（不是"永远返回 0"）
    expect(compareCardStates(v(1), v(2))).toBeLessThan(0);
  });

  it('sortCards 返回新数组（不改调用方那个）', () => {
    const list = [defaultCard('c', 'compile'), defaultCard('p', 'protocol')];
    list[0].value = '5';
    const out = sortCards(list);
    expect(out.map((c) => c.id)).toEqual(['p', 'c']);
    expect(list.map((c) => c.id), 'sortCards 就地改了原数组').toEqual(['c', 'p']);
  });

  it('compileCards / protocolCards 按 kind 分拣', () => {
    const d = defaultDeck();
    d.cards = [defaultCard('p', 'protocol'), defaultCard('c1', 'compile'), defaultCard('c2', 'compile')];
    expect(compileCards(d).map((c) => c.id)).toEqual(['c1', 'c2']);
    expect(protocolCards(d).map((c) => c.id)).toEqual(['p']);
  });
});

/* ==================================================================== *
 * 牌组 JSON 往返（本项目自定义格式；参考项目没有对应的测试文件）
 * ==================================================================== */

describe('牌组 JSON：导出 / 导入往返', () => {
  /** 一张内容可辨识的卡（每种文本都不一样，往返后逐字比对才有意义） */
  const richCard = () => {
    const c = defaultCard('c1', 'compile');
    c.title = 'N E O N';
    c.value = '7';
    c.panelTop = '**上**面板 __下划线__';
    c.panelMid = '中';
    c.panelBot = '下';
    c.compile = { top: 'TOP', subtitle: 'SUB', bottom: 'BOT', back: 'BACK' };
    return c;
  };

  /** 一份"两种图都有"的牌组：自定背景（base64）+ 预设背景 + logo */
  const fullDeck = () => {
    const d = defaultDeck();
    d.title = '测试牌组';
    d.shared.perCardBg = true;
    const custom = 'data:image/jpeg;base64,/9j/AAAABBBBCCCC';
    d.shared.compile = { bg: { type: 'custom', name: null, dataUrl: custom, transform: { scale: 2, offsetX: 10, offsetY: -20 } }, logo: { dataUrl: 'data:image/png;base64,LOGO', zoom: 1.5, offsetX: 3, offsetY: 4 } };
    d.shared.protocol = { bg: { type: 'preset', name: 'Fire', dataUrl: null, transform: { scale: 1, offsetX: 0, offsetY: 0 } }, logo: defaultLogo() };
    const c = richCard();
    // 同一张图再被这张卡自己引用一次：池化之后文件里只该出现一份
    c.bgOwn = { type: 'custom', name: null, dataUrl: custom, transform: { scale: 1, offsetX: 0, offsetY: 0 } };
    c.logoOwn = { dataUrl: 'data:image/png;base64,LOGO', zoom: 1, offsetX: 0, offsetY: 0 };
    const p = defaultCard('p1', 'protocol');
    p.title = 'PROTOCOL';
    d.cards = [c, p];
    return d;
  };

  it('往返之后**逐字相等**（build → stringify → parse 得到同一份牌组）', () => {
    const deck = fullDeck();
    const round = parseDeck(stringifyDeck(deck));
    expect(round.ok).toBe(true);
    if (!round.ok) return;
    expect(round.deck).toEqual(deck);
    // 反向锚点：把上游那个牌组改一个字段，往返结果就该不同（证明比较不是恒真）
    const other = fullDeck();
    other.cards[0].value = '8';
    const round2 = parseDeck(stringifyDeck(other));
    expect(round2.ok).toBe(true);
    if (!round2.ok) return;
    expect(round2.deck).not.toEqual(deck);
  });

  it('自定图以 base64 **内嵌**进 imgs 池；预设背景**只存名字**', () => {
    const payload = packDeck(fullDeck());
    const imgs = Object.values(payload.imgs);
    expect(imgs, '自定图没有被池化').toContain('data:image/jpeg;base64,/9j/AAAABBBBCCCC');
    expect(imgs, 'logo 没有被池化').toContain('data:image/png;base64,LOGO');
    // 同一张图被两处引用 ⇒ 池里只有一份（这正是"池化"要解决的问题）
    expect(imgs.filter((u) => u === 'data:image/jpeg;base64,/9j/AAAABBBBCCCC')).toHaveLength(1);
    // 预设背景：文件里是名字，不是图片
    const text = stringifyDeck(fullDeck());
    expect(text, '预设背景没按名字引用').toContain('"Fire"');
    expect(text, '预设背景被当成自定图内嵌了').not.toContain('card-backgrounds/Fire.jpg');
    // 池引用必须是 `img:` 前缀（读回时靠它认出"这是个池引用"）
    expect(text).toMatch(/"img:[a-z0-9]+_\d+"/);
  });

  it('导出是**确定的**：同一份牌组两次 stringify 逐字节相同', () => {
    const a = stringifyDeck(fullDeck());
    const b = stringifyDeck(fullDeck());
    expect(a).toBe(b);
    // 反向：改一个字必须变（否则上面的相等可能是"永远输出常量"）
    const other = fullDeck();
    other.title = '另一个名字';
    expect(stringifyDeck(other)).not.toBe(a);
  });

  it('往返**不改动**传进去的那份牌组（每一步都造新对象）', () => {
    const deck = fullDeck();
    const before = JSON.stringify(deck);
    stringifyDeck(deck);
    expect(JSON.stringify(deck), 'stringifyDeck 就地改了牌组').toBe(before);
    const packed = packDeck(deck);
    expect(packed.deck, 'packDeck 返回了同一个对象').not.toBe(deck);
    expect(JSON.stringify(deck)).toBe(before);
  });

  it('四类失败各自可辨识：不是 JSON / 不是本制作器的格式 / 版本不认识 / 形状坏了', () => {
    const notJson = parseDeck('{oops');
    expect(notJson.ok).toBe(false);
    if (!notJson.ok) expect(notJson.code).toBe('not-json');

    const notDeck = parseDeck(JSON.stringify([1, 2, 3]));
    expect(notDeck.ok).toBe(false);
    if (!notDeck.ok) expect(notDeck.code).toBe('not-a-deck');

    const otherFormat = parseDeck(JSON.stringify({ format: 'something-else', version: 1, deck: {} }));
    expect(otherFormat.ok).toBe(false);
    if (!otherFormat.ok) {
      expect(otherFormat.code).toBe('not-a-deck');
      expect(otherFormat.message, '失败信息里没写清期望的格式标记').toContain(DECK_FORMAT);
    }

    const badVersion = parseDeck(JSON.stringify({ format: DECK_FORMAT, version: 99, deck: {} }));
    expect(badVersion.ok).toBe(false);
    if (!badVersion.ok) {
      expect(badVersion.code).toBe('bad-version');
      expect(badVersion.message).toContain(String(DECK_VERSION));
    }

    const badShape = parseDeck(JSON.stringify({ format: DECK_FORMAT, version: DECK_VERSION }));
    expect(badShape.ok).toBe(false);
    if (!badShape.ok) expect(badShape.code).toBe('bad-shape');

    // 正向：最小合法文件能读回来（证明上面四条不是"全都失败"）
    const ok = parseDeck(JSON.stringify({ format: DECK_FORMAT, version: DECK_VERSION, deck: defaultDeck(), imgs: {} }));
    expect(ok.ok).toBe(true);
  });

  it('池引用丢了图片（用户手删了 imgs）⇒ 那张背景降级成"没有背景"，不崩', () => {
    const deck = defaultDeck();
    deck.shared.compile = {
      bg: { type: 'custom', name: null, dataUrl: 'data:image/png;base64,XX', transform: { scale: 1, offsetX: 0, offsetY: 0 } },
      logo: defaultLogo(),
    };
    const payload = packDeck(deck) as unknown as { imgs: Record<string, string> };
    payload.imgs = {}; // 模拟"用户手删了 imgs 那一节"
    const round = parseDeck(JSON.stringify(payload));
    expect(round.ok).toBe(true);
    if (!round.ok) return;
    expect(round.deck.shared.compile.bg.type).toBe('none');
    expect(round.deck.shared.compile.bg.dataUrl).toBeNull();
  });

  it('safeFileName：路径分隔符与保留字符被清掉、空标题回落、长度有上限', () => {
    expect(safeFileName('我的牌组')).toBe('我的牌组');
    expect(safeFileName('a/b\\c:d*e?f"g<h>i|j')).toBe('abcdefghij');
    expect(safeFileName('   ')).toBe('deck');
    expect(safeFileName('', 'card')).toBe('card');
    expect(safeFileName('x'.repeat(200)).length).toBe(60);
    // 控制字符也被清掉（它们会把某些文件系统搞坏）
    expect(safeFileName('a\u0000b\u001fc')).toBe('abc');
  });
});

describe('配置表的形状（防止把参考项目的几何改坏）', () => {
  it('两套设计空间的尺寸与打印尺寸', () => {
    expect([CARD_W, CARD_H]).toEqual([744, 1039]);
    expect([LAND_W, LAND_H]).toEqual([1039, 744]);
    expect([POKER_W, POKER_H]).toEqual([750, 1050]);
  });

  it('15 套预设，名字不重复', () => {
    expect(PRESETS.length).toBe(15);
    expect(new Set(PRESETS).size).toBe(15);
  });

  it('横版协议卡的 max 不小于 min；名字区比小字区大（排版层级看得见）', () => {
    for (const zone of [PROTOCOL_FRONT.topBar, PROTOCOL_FRONT.name, PROTOCOL_FRONT.subtitle, PROTOCOL_FRONT.bottomBar, PROTOCOL_BACK.name, PROTOCOL_BACK.backLine]) {
      expect(zone.max).toBeGreaterThanOrEqual(zone.min);
    }
    expect(PROTOCOL_FRONT.name.max).toBeGreaterThan(PROTOCOL_FRONT.topBar.max);
    // 竖版卡：数值字号是全场最大的（大号中心数字）
    expect(ZONES.value.max).toBeGreaterThan(ZONES.title.max);
  });

  it('两个六边形的朝向相反（竖版尖朝上下、横版尖朝左右）', () => {
    expect(ZONES.hex.pointy).toBe('v');
    expect(PROTOCOL_FRONT.hex.pointy).toBe('h');
    expect(PROTOCOL_BACK.hex.pointy).toBe('h');
  });
});

/* ==================================================================== *
 * ★ 2026-10-01（用户报缺陷）：logo 只留形状 —— 抠背景的纯函数
 *
 * 用户传了一张**不透明方形**的图当 logo，卡面变成"一片白色的小卡片"（因为 logo 会被整体
 * 染白）。原作者的答复（用户转述）：logo 只需保留形状、背景透明，因为应用会叠加一层白色。
 *
 * 这里喂**合成像素**（不需要 DOM、不需要真实图片解码）钉住抠图算法本身：
 *  - 不透明方图 + 中间一个深色方块 ⇒ 背景被抠成透明、形状**保住**；
 *  - 内部与背景同色的"洞"**不被**抠（这是漫水填充相对全局颜色替换的关键优势）；
 *  - 本来就带 alpha 的图**原样返回**（不做二次破坏）。
 * ==================================================================== */

/** 造一张 `w×h` 的 RGBA 像素：`fill` 铺底，`paint` 可再画形状 */
function makePixels(
  w: number, h: number,
  fill: [number, number, number, number],
  paint?: (x: number, y: number) => [number, number, number, number] | null,
): Uint8ClampedArray {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = (paint ? paint(x, y) : null) ?? fill;
      const i = (y * w + x) * 4;
      d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = c[3];
    }
  }
  return d;
}
/** 某点的 alpha */
const alphaAt = (d: Uint8ClampedArray, w: number, x: number, y: number): number => d[(y * w + x) * 4 + 3];

describe('★ 2026-10-01：logo 抠背景（cutoutBackground）', () => {
  it('不透明方图 + 中间深色方块 ⇒ 背景全透明、形状保住（用户报的那个 case）', () => {
    const W = 64, H = 64;
    // 白底（不透明）+ 中间 24×24 的深蓝方块
    const src = makePixels(W, H, [255, 255, 255, 255], (x, y) => (
      x >= 20 && x < 44 && y >= 20 && y < 44 ? [20, 30, 90, 255] : null
    ));
    const { data, removedRatio } = cutoutBackground(src, W, H, 42);

    // ① 四角与四边中点：背景被抠成**全透明**
    for (const [x, y] of [[0, 0], [W - 1, 0], [0, H - 1], [W - 1, H - 1], [32, 0], [0, 32]] as const) {
      expect(alphaAt(data, W, x, y), `(${x},${y}) 的背景没被抠掉`).toBe(0);
    }
    // ② 形状中心：**完全不透明**（形状保住了）
    expect(alphaAt(data, W, 32, 32), '形状中心被误抠了').toBe(255);
    // ③ 形状的四个角也在（边内 1px 处仍是不透明）
    for (const [x, y] of [[21, 21], [42, 21], [21, 42], [42, 42]] as const) {
      expect(alphaAt(data, W, x, y), `形状角 (${x},${y}) 被误抠了`).toBe(255);
    }
    // ④ **绝不是整块白**（这正是用户看到的现象）：透明像素要占大头、但又不能全透明
    expect(removedRatio, `被抠掉的比例=${removedRatio}`).toBeGreaterThan(0.6);
    expect(removedRatio, '整张图都被抠了（形状也没了）').toBeLessThan(0.95);
    // 反向锚点：被抠掉的面积 ≈ 背景面积（64²-24²=3520 / 4096 ≈ 0.859），不是"随便抠了一半"
    expect(removedRatio).toBeGreaterThan(0.8);
  });

  it('形状**内部**与背景同色的洞**不被**抠（漫水填充相对全局颜色替换的关键优势）', () => {
    const W = 48, H = 48;
    // 白底 + 深蓝方框（空心：内部又是白色 —— 与背景同色）
    const src = makePixels(W, H, [255, 255, 255, 255], (x, y) => {
      const outer = x >= 10 && x < 38 && y >= 10 && y < 38;
      const inner = x >= 18 && x < 30 && y >= 18 && y < 30;
      return outer && !inner ? [20, 30, 90, 255] : null;
    });
    const { data } = cutoutBackground(src, W, H, 42);
    expect(alphaAt(data, W, 0, 0), '外部背景没被抠').toBe(0);
    expect(alphaAt(data, W, 24, 12), '边框被误抠').toBe(255);
    // 内部那个"与背景同色的白色洞"**必须还在**（全局颜色替换会把它一起挖空）
    expect(alphaAt(data, W, 24, 24), '内部的白色洞被误抠（说明用的是全局颜色替换？）').toBe(255);
  });

  it('本来就带 alpha 的图**原样返回**（不二次破坏），removedRatio = 0', () => {
    const W = 32, H = 32;
    // 四角透明、中间不透明红色 —— 真·透明背景的 logo
    const src = makePixels(W, H, [0, 0, 0, 0], (x, y) => (
      x >= 8 && x < 24 && y >= 8 && y < 24 ? [200, 30, 30, 255] : null
    ));
    const before = Array.from(src);
    const { data, removedRatio } = cutoutBackground(src, W, H, 42);
    expect(removedRatio, '带 alpha 的图不该被改动').toBe(0);
    expect(Array.from(data), '带 alpha 的图被改了像素').toEqual(before);
  });

  it('四角不是全透明但形状贴边时不崩（退化路径有界）', () => {
    // 整张一个颜色（纯色块）：会被全部抠掉 ⇒ removedRatio 接近 1，但**不抛**
    const W = 16, H = 16;
    const src = makePixels(W, H, [255, 255, 255, 255]);
    const { removedRatio } = cutoutBackground(src, W, H, 42);
    expect(removedRatio).toBeGreaterThan(0.9);
    // 极小图（1×1 / 0 宽）走早退分支，不崩
    expect(cutoutBackground(new Uint8ClampedArray(4), 1, 1, 42).removedRatio).toBe(0);
    expect(cutoutBackground(new Uint8ClampedArray(0), 0, 0, 42).removedRatio).toBe(0);
  });
});
