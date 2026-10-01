/**
 * 牌组 JSON 的导入 / 导出（**本项目自定义的可移植格式**）。
 *
 * 2026-10-01：语义上对齐参考项目 COMPILER · Card Builder（作者 Albert Blanco，MIT 许可，
 * https://github.com/albrtbc/compiler）的 `exportDeckJson()` / `dehydrateToDict()` /
 * `rehydrateFromDict()`：**自定图内嵌成 base64（在文件里只存一份，多张卡共用时按池引用），
 * 预设背景按名字引用**（读回时去素材目录解析）。
 *
 * 与参考项目的两处**有意不同**：
 *  1. 格式自成一版（`format: "compile-cardmaker-deck"`），不做原项目的 version 3 兼容 ——
 *     本制作器是新建的页面，没有历史用户文件；
 *  2. 参考项目把 kind 在导出时"翻回旧格式"（`flipPayloadKinds`，一段历史包袱），
 *     这里直接写 `compile` / `protocol` 两个名字，**导出与内存同义**。
 *
 * 为什么图片要"池化"（`imgs` + `img:<key>` 引用）：一张图被正/背两面或"整副牌共用背景"
 * 引用多次时，逐份内嵌会把文件撑成 N 倍。池化之后同一份 base64 只出现一次。
 */
import { DECK_FORMAT, DECK_VERSION } from './config';
import { hydrateDeck } from './model';
import { hashStr } from './rng';
import type { Bg, CardState, Deck, DeckShared, Logo } from './types';

/** 兜底卡 id 用的短哈希（同一份内容 ⇒ 同一把 id，重复导入不会产生两套 id） */
function shortHash(s: string): string {
  return (hashStr(s) >>> 0).toString(36);
}

/** 图片池：`dataUrl → "img:<键>"` */
export type ImageDict = Record<string, string>;
/** 反向索引：`"img:<键>" → dataUrl` */
export type ImageIndex = Map<string, string>;

const IMG_REF = /^img:/;

/** 注册一份 data URL 到池里，返回它的引用键。同一份图重复注册得到同一个键。 */
function putImage(dict: ImageDict, dataUrl: string): string {
  const existing = Object.keys(dict).find((k) => dict[k] === dataUrl);
  if (existing) return existing;
  const key = `img:${shortHash(dataUrl)}_${dataUrl.length}`;
  // 理论上不同图可能撞键（哈希 + 长度），撞了就加后缀 —— 宁可键难看，不许两张图共用一份
  let unique = key;
  let n = 2;
  while (unique in dict && dict[unique] !== dataUrl) { unique = `${key}#${n}`; n += 1; }
  dict[unique] = dataUrl;
  return unique;
}

/** 背景：自定图换成池引用；预设保持名字 */
function packBg(bg: Bg, dict: ImageDict): Bg {
  if (bg.type !== 'custom' || !bg.dataUrl) return bg;
  return { ...bg, dataUrl: putImage(dict, bg.dataUrl) };
}

function unpackBg(bg: Bg, index: ImageIndex): Bg {
  if (bg.dataUrl && IMG_REF.test(bg.dataUrl)) {
    const real = index.get(bg.dataUrl) ?? null;
    return { ...bg, dataUrl: real, type: real ? bg.type : 'none' };
  }
  return bg;
}

function packLogo(logo: Logo, dict: ImageDict): Logo {
  if (!logo.dataUrl) return logo;
  return { ...logo, dataUrl: putImage(dict, logo.dataUrl) };
}

function unpackLogo(logo: Logo, index: ImageIndex): Logo {
  if (logo.dataUrl && IMG_REF.test(logo.dataUrl)) {
    return { ...logo, dataUrl: index.get(logo.dataUrl) ?? null };
  }
  return logo;
}

function packShared(shared: DeckShared, dict: ImageDict): DeckShared {
  return {
    perCardBg: shared.perCardBg,
    compile: { bg: packBg(shared.compile.bg, dict), logo: packLogo(shared.compile.logo, dict) },
    protocol: { bg: packBg(shared.protocol.bg, dict), logo: packLogo(shared.protocol.logo, dict) },
  };
}

function unpackShared(shared: DeckShared, index: ImageIndex): DeckShared {
  return {
    perCardBg: shared.perCardBg,
    compile: { bg: unpackBg(shared.compile.bg, index), logo: unpackLogo(shared.compile.logo, index) },
    protocol: { bg: unpackBg(shared.protocol.bg, index), logo: unpackLogo(shared.protocol.logo, index) },
  };
}

function packCard(card: CardState, dict: ImageDict): CardState {
  return { ...card, bgOwn: packBg(card.bgOwn, dict), logoOwn: packLogo(card.logoOwn, dict) };
}

function unpackCard(card: CardState, index: ImageIndex): CardState {
  return { ...card, bgOwn: unpackBg(card.bgOwn, index), logoOwn: unpackLogo(card.logoOwn, index) };
}

/** 导出到磁盘的那个 JSON 的形状 */
export interface DeckPayload {
  format: typeof DECK_FORMAT;
  version: number;
  deck: Deck;
  imgs: ImageDict;
}

/**
 * 牌组 → 可写文件的对象。
 *
 * 纯函数（不碰 storage / DOM），所以"往返逐字节相同"这件事可以被单测直接钉住。
 * 传进来的牌组**不会被改动**（每一步都造新对象）。
 */
export function packDeck(deck: Deck): DeckPayload {
  const imgs: ImageDict = {};
  const packed: Deck = {
    title: deck.title,
    shared: packShared(deck.shared, imgs),
    cards: deck.cards.map((c) => packCard(c, imgs)),
  };
  return { format: DECK_FORMAT, version: DECK_VERSION, deck: packed, imgs };
}

/** 导出成文本（缩进 2 格：文件是给人看/手改的） */
export function stringifyDeck(deck: Deck): string {
  return JSON.stringify(packDeck(deck), null, 2);
}

/** 导入的结论：成功给牌组，失败给**一句人话**（码 + 说明） */
export type DeckParseResult =
  | { ok: true; deck: Deck }
  | { ok: false; code: 'not-json' | 'not-a-deck' | 'bad-version' | 'bad-shape'; message: string };

/**
 * 文本 → 牌组。
 *
 * **四类失败各自可辨识**（不是一律"导入失败"）：不是 JSON / 不是本制作器的格式 /
 * 版本不认识 / 形状坏了。它们对用户意味着不同的事（"你选错文件了" vs "文件坏了"）。
 */
export function parseDeck(text: string): DeckParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return { ok: false, code: 'not-json', message: `这不是一个 JSON 文件：${String(e)}` };
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, code: 'not-a-deck', message: '文件的顶层不是一个对象（不像是本制作器导出的牌组）' };
  }
  const obj = raw as Partial<DeckPayload>;
  if (obj.format !== DECK_FORMAT) {
    return {
      ok: false,
      code: 'not-a-deck',
      message: `文件里没有本制作器的格式标记（期望 format = ${DECK_FORMAT}，实际 ${JSON.stringify(obj.format)}）`,
    };
  }
  if (obj.version !== DECK_VERSION) {
    return {
      ok: false,
      code: 'bad-version',
      message: `牌组版本不认识（期望 ${DECK_VERSION}，实际 ${JSON.stringify(obj.version)}）`,
    };
  }
  if (typeof obj.deck !== 'object' || obj.deck === null) {
    return { ok: false, code: 'bad-shape', message: '文件里有格式标记，但没有牌组内容（deck 字段）' };
  }
  const imgs = obj.imgs;
  const index: ImageIndex = new Map();
  if (typeof imgs === 'object' && imgs !== null && !Array.isArray(imgs)) {
    for (const [k, v] of Object.entries(imgs as Record<string, unknown>)) {
      if (typeof v === 'string') index.set(k, v);
    }
  }
  // 先补默认值（`hydrateDeck`），再把池引用换成真正的图 —— 顺序不能反：
  // 池引用形如 `img:xxx`，`hydrateBg` 会把它当成"合法的自定图 dataUrl"而放行，
  // 正是这里要的（解析不出来时它会在下一句被降级成 none）。
  const hydrated = hydrateDeck(obj.deck);
  return {
    ok: true,
    deck: {
      title: hydrated.title,
      shared: unpackShared(hydrated.shared, index),
      cards: hydrated.cards.map((c) => unpackCard(c, index)),
    },
  };
}

/**
 * 牌组标题 → 安全的文件名（路径分隔符、控制字符、Windows 保留字符全部换掉）。
 * 空标题时回落到 `fallback`。
 */
export function safeFileName(title: string, fallback = 'deck'): string {
  const cleaned = title
    .replace(/[\\/:*?"<>|]/g, '')
    // eslint 风格上不需要，但控制字符会把某些文件系统搞坏
    .split('')
    .filter((ch) => ch.charCodeAt(0) >= 32)
    .join('')
    .trim();
  return cleaned === '' ? fallback : cleaned.slice(0, 60);
}
