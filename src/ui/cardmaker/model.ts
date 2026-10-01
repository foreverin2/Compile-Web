/**
 * 牌组模型：补默认值（hydration）、老名字迁移、以及**排序**。
 *
 * 2026-10-01：移植自参考项目 COMPILER · Card Builder（作者 Albert Blanco，MIT 许可，
 * https://github.com/albrtbc/compiler）的 `src/model/bg.js` 与 `src/model/order.js`。
 *
 * 排序规则与原项目一致：**横版协议卡排在最前**（它整副牌只有一张），竖版数值卡按数值
 * 升序。原项目还有一个 `compareDeckEntries`（让"正在编辑、还没保存的新卡"钉在末尾，
 * 免得边打字边跳位）—— 本项目不做多卡牌组列表（单张编辑 + 一个卡清单），没有"新卡标记"
 * 这个概念，所以只移植 `compareCardStates` 这一条。
 */
import { PRESET_MIGRATION } from './config';
import {
  defaultCard,
  defaultCompileText,
  defaultDeck,
  defaultLogo,
  defaultTransform,
  type Bg,
  type CardKind,
  type CardState,
  type CompileText,
  type Deck,
  type DeckShared,
  type Logo,
} from './types';

/* ── 补默认值 ─────────────────────────────────────────────────────────── */

/** 老西班牙语预设名就地改成现在的英文名；改了返回 true */
export function migrateBg(bg: Bg | null | undefined): boolean {
  if (bg && bg.type === 'preset' && bg.name && PRESET_MIGRATION[bg.name]) {
    bg.name = PRESET_MIGRATION[bg.name];
    return true;
  }
  return false;
}

/**
 * 任意残缺的背景对象 → 完整可用的背景对象（含 transform 归一与老名字迁移）。
 *
 * 三个字段都**显式归一**（而不是靠 `Object.assign` 抄过来）：牌组 JSON 是用户能随手改的
 * 文本，`type` 写成 `"Preset"`、`name` 写成数字、`dataUrl` 写成对象时，渲染层会去请求
 * 一个不存在的 URL 或直接抛 —— 这里当场把它们降级成"没有背景"。
 */
export function hydrateBg(src: Partial<Bg> | null | undefined): Bg {
  const s = src || {};
  const type = s.type === 'preset' || s.type === 'custom' ? s.type : 'none';
  const bg: Bg = {
    type,
    name: typeof s.name === 'string' && s.name !== '' ? s.name : null,
    dataUrl: typeof s.dataUrl === 'string' && s.dataUrl !== '' ? s.dataUrl : null,
    transform: Object.assign(defaultTransform(), s.transform || {}),
  };
  // 类型说"用预设"却没给出名字（或说"用自定图"却没给图）⇒ 当作没有背景
  if (bg.type === 'preset' && bg.name === null) bg.type = 'none';
  if (bg.type === 'custom' && bg.dataUrl === null) bg.type = 'none';
  migrateBg(bg);
  return bg;
}

/** 任意残缺的 logo 对象 → 完整可用的 logo 对象 */
export function hydrateLogo(src: Partial<Logo> | null | undefined): Logo {
  return Object.assign(defaultLogo(), src || {});
}

/** 任意残缺的竖版卡文本 → 完整 */
export function hydrateCompileText(src: Partial<CompileText> | null | undefined): CompileText {
  return Object.assign(defaultCompileText(), src || {});
}

/**
 * 任意残缺的卡 → 完整（`kind` 只认这两个值，其它一律当竖版卡）。
 *
 * ★ 2026-10-01（用户要求"协议卡不该顺手带着竖版字段"）：**协议卡身上不保留竖版专属字段**
 * （`value` / `panelTop` / `panelMid` / `panelBot`）。协议卡的三张分区表
 * （`PROTOCOL_FRONT` / `PROTOCOL_BACK`）里没有数值位与三段面板，留着它们只会有两个坏处：
 *  1. 牌组 JSON 里每条协议卡都拖着一串永远不用的空字段（用户第 1 条点名的就是它）；
 *  2. 一旦值非空（老文件、手改的 JSON），渲染层虽然不画它，但它会**悄悄跟着导出/导入往返**，
 *     将来真要做"协议卡也带数值"时会分不清"用户填的"与"历史残留"。
 *
 * 清成空串（而不是删字段）是有意的：`CardState` 的形状在两种卡之间保持**同一份类型**
 * （渲染层与表单按 kind 分派，不做可选字段的窄化），省掉一圈 `?.` 与类型体操；
 * 导出时再由 `serialize.ts` 把它们**从 JSON 里剔除**（那才是"文件里干净"的落点）。
 */
export function hydrateCard(src: Partial<CardState> | null | undefined, fallbackId: string): CardState {
  const base = defaultCard(fallbackId, 'compile');
  const st: CardState = Object.assign(base, src || {});
  st.id = typeof st.id === 'string' && st.id !== '' ? st.id : fallbackId;
  st.kind = st.kind === 'protocol' ? 'protocol' : 'compile';
  st.title = typeof st.title === 'string' ? st.title : '';
  const portraitOnly = st.kind === 'compile';
  st.value = portraitOnly && typeof st.value === 'string' ? st.value : '';
  st.panelTop = portraitOnly && typeof st.panelTop === 'string' ? st.panelTop : '';
  st.panelMid = portraitOnly && typeof st.panelMid === 'string' ? st.panelMid : '';
  st.panelBot = portraitOnly && typeof st.panelBot === 'string' ? st.panelBot : '';
  st.compile = hydrateCompileText(st.compile);
  st.bgOwn = hydrateBg(st.bgOwn);
  st.logoOwn = hydrateLogo(st.logoOwn);
  return st;
}

/** 任意残缺的共享块 → 完整 */
export function hydrateShared(src: Partial<DeckShared> | null | undefined): DeckShared {
  const s = src || {};
  return {
    perCardBg: s.perCardBg === true,
    compile: { bg: hydrateBg(s.compile?.bg), logo: hydrateLogo(s.compile?.logo) },
    protocol: { bg: hydrateBg(s.protocol?.bg), logo: hydrateLogo(s.protocol?.logo) },
  };
}

/** 任意残缺的牌组 → 完整（导入 / 从本机读回都走这一条） */
export function hydrateDeck(src: Partial<Deck> | null | undefined): Deck {
  const d = defaultDeck();
  const s = src || {};
  return {
    title: typeof s.title === 'string' ? s.title : '',
    shared: hydrateShared(s.shared),
    cards: Array.isArray(s.cards)
      ? s.cards.map((c, i) => hydrateCard(c, `card-${i + 1}`))
      : d.cards,
  };
}

/* ── 排序 ─────────────────────────────────────────────────────────────── */

/** 0 = 横版协议卡（排最前）· 1 = 竖版数值卡 */
export function kindPriority(state: { kind: CardKind }): number {
  return state.kind === 'protocol' ? 0 : 1;
}

/**
 * 数值卡的排序键。**空/非数字一律当 0**（原文 `parseFloat(x) || 0`）——
 * 于是一张还没填数值的卡排在最前，而不是排到最后（NaN 的默认比较行为）。
 */
export function cardValueOf(state: { value: string }): number {
  return parseFloat(state.value) || 0;
}

/** 卡状态比较器：协议卡最前，然后数值升序 */
export function compareCardStates(
  a: { kind: CardKind; value: string },
  b: { kind: CardKind; value: string },
): number {
  const pa = kindPriority(a);
  const pb = kindPriority(b);
  if (pa !== pb) return pa - pb;
  if (pa === 0) return 0; // 协议卡保持它们之间的原有顺序
  return cardValueOf(a) - cardValueOf(b);
}

/** 按 `compareCardStates` 排序并**返回新数组**（不改调用方那个） */
export function sortCards(cards: readonly CardState[]): CardState[] {
  return [...cards].sort(compareCardStates);
}

/** 竖版数值卡（导出「导出全部 PNG」时用） */
export function compileCards(deck: Deck): CardState[] {
  return deck.cards.filter((c) => c.kind === 'compile');
}

/** 横版协议卡（应当只有一张；这里仍然返回数组，容忍用户手改过的 JSON） */
export function protocolCards(deck: Deck): CardState[] {
  return deck.cards.filter((c) => c.kind === 'protocol');
}
