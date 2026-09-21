/**
 * 图鉴「按效果分类筛选」的**纯逻辑**（G5 T24；任务书 §3）。
 *
 * 这一层只做两件事，一件都不多做：
 *  1. 把生成物 `src/data/cardEffectTags.ts` 的标签目录**按界面分组**摊成 `LIB_TAG_GROUPS`
 *     （分组只影响渲染顺序，不参与判定）；
 *  2. 给一个纯函数 `filterLibrary(state)`：吃"这一刻的勾选状态 + 全部卡/协议"，吐"哪些卡、哪些协议可见"。
 *
 * ## 它为什么不碰 DOM
 *
 * `src/app/**` 是纯层（`tests/app-purity.test.ts` 的生成式守卫：`document` / `window` /
 * `localStorage` / `Math.random` / `Date.now` / `node:*` 一律零命中）。于是"哪张卡可见"这条口径
 * 能在 node 里被钉死，而界面那一层只剩"把读数画出来 + 把点击接上"。
 *
 * ## 判据（用户原话 → 这一层的算式）
 *
 *  - 卡牌"拥有或部分拥有目前所勾选的效果"⇒ 显示：一张卡可见 ⟺
 *    **它的世代在 `enabledSets` 里** 且 **它的标签 ∩ `checkedTags` 非空**；
 *  - "若玩家勾选的效果中没有一条是符合的，则不显示"⇒ `checkedTags` 为空集时**没有任何卡可见**
 *    （这条不是"由上面的交集自然推出"的巧合：空集与任何集合的交都是空，所以它是同一条式子的
 *    特例，但它是用户点名的那一条，测试里单独钉一份）；
 *  - "若某个协议，其所属的所有卡都被排除了，则默认连带着它的框组件都隐藏"⇒ 一个协议可见 ⟺
 *    它的世代在 `enabledSets` 里 且 **它至少有一张卡可见**；
 *  - "连同其所属的协议显示出来" ⇒ 协议这一层**不做二次挑选**：`visibleProtocols` 只决定那个协议的
 *    **框建不建**，框里画哪几张卡由 `visibleCards` 决定 —— 于是界面上看到的是"某个协议下有卡命中，
 *    这个协议的框和它命中的那几张卡一起出现"，而不是"一个协议只要有一张卡命中，整组卡就全画出来"
 *    （`src/ui/home.ts` 的 `renderLibrary` 里逐卡 `if (!r.visibleCards.has(c.defId)) continue;`，
 *    被排除的卡不建节点）。两个集合并列返回就是为这件事：框的粒度是协议，卡的粒度是卡。
 *
 * ## 标签从哪来（**不是**页面里按文本关键词现算）
 *
 * 标签是**构建期**由 `tools/card-effect-index.mjs --write-tags` 从**效果代码**（op / trigger /
 * chooser / 选择请求标题）算好写进 `src/data/cardEffectTags.ts` 的；本文件只读生成物。
 * 口径与已知偏差见 `docs/2026-09-21-卡牌效果分类与关键词.md`（第二版）§8 / §9。
 */
import { CARD_EFFECT_TAGS, CARD_EFFECT_TAGS_BY_CARD } from '../data/cardEffectTags';

/**
 * 一个世代里的协议（`set` 就是图鉴世代 chips 用的那六个代号：`MN01` / `AX01` / …）
 */
export interface LibProtocol {
  readonly defId: string;
  readonly set: string;
}

/** 一张卡（只需要这三样：算归属、算世代、给界面排序用） */
export interface LibCard {
  readonly defId: string;
  readonly protocol: string;
  readonly value: number;
}

/** 界面分组（顺序 = 生成物里 `CARD_EFFECT_TAGS` 的顺序 = 任务书 §1 表序） */
export interface LibTagGroup {
  readonly group: string;
  readonly tags: readonly { readonly id: string; readonly label: string; readonly group: string }[];
}

/**
 * `filterLibrary` 的输入读数。
 *
 * 每一项都是**值**（不持有界面对象），于是"用户点了一下"这件事在宿主那侧只表现为一个新的
 * `Set` —— 纯层不做任何记录，也不改调用方手里那个集合。
 */
export interface LibFilterState {
  readonly protocols: readonly LibProtocol[];
  readonly cards: readonly LibCard[];
  /** 这一刻**打开**的世代（图鉴上方那排 chips） */
  readonly enabledSets: ReadonlySet<string>;
  /** 这一刻**勾中**的效果标签 */
  readonly checkedTags: ReadonlySet<string>;
}

/** `filterLibrary` 的读数（`total*` 是"没筛之前有多少"，界面的空态提示要用） */
export interface LibFilterResult {
  readonly visibleCards: Set<string>;
  readonly visibleProtocols: Set<string>;
  readonly totalCards: number;
  readonly totalProtocols: number;
}

/**
 * 标签目录**按界面分组**摊开（顺序 = 生成物顺序，同一组内也保持生成物顺序）。
 *
 * 分组本身不参与筛选 —— 它只是"面板上每块标题写什么、标签怎么排"。
 */
const groupsOf = (): LibTagGroup[] => {
  const out: LibTagGroup[] = [];
  for (const tag of CARD_EFFECT_TAGS) {
    const last = out[out.length - 1];
    if (last === undefined || last.group !== tag.group) {
      out.push({ group: tag.group, tags: [tag] });
    } else {
      (last.tags as { id: string; label: string; group: string }[]).push(tag);
    }
  }
  return out;
};

/** 面板的界面分组（`[{ group: '指令位置', tags: [...] }, …]`，顺序 = 任务书 §1 表序） */
export const LIB_TAG_GROUPS: readonly LibTagGroup[] = groupsOf();

/** 全部标签 id（顺序 = 生成物顺序）—— "默认全勾"与"全选/全不选"都用它 */
export const LIB_ALL_TAG_IDS: readonly string[] = CARD_EFFECT_TAGS.map((t) => t.id);

/** 一张卡的标签（查不到就是空数组：新卡没进生成物时按"一条都不命中"处理，不静默全通过） */
export const tagsOf = (defId: string): readonly string[] => CARD_EFFECT_TAGS_BY_CARD[defId] ?? [];

/**
 * 按效果分类筛选图鉴（**纯函数**：不读文件、不看时钟、不碰 DOM、不改传入的集合）。
 *
 * 返回值里的两个 `Set` 是**新造的**（与 `state` 里的集合无引用关系）。
 */
export function filterLibrary(state: LibFilterState): LibFilterResult {
  const visibleCards = new Set<string>();
  const visibleProtocols = new Set<string>();
  /**
   * 世代只在协议上（`CardDef` 没有 `set`）⇒ 先把"协议 → 世代"摊成一张表，
   * 免得每张卡都去 `protocols.find()` 扫一遍（270 张 × 45 套在每次点击时都跑一次）。
   */
  const setOfProtocol = new Map<string, string>();
  for (const p of state.protocols) setOfProtocol.set(p.defId, p.set);

  // ① 卡：世代开着 且 标签与勾选集有交集（勾选集为空 ⇒ 交集恒空 ⇒ 一张都不显示）
  for (const card of state.cards) {
    const set = setOfProtocol.get(card.protocol);
    // 查不到世代（协议表里没有它）⇒ 按"世代没开"处理：拿不到世代就不该放行（fail-closed）
    if (set === undefined || !state.enabledSets.has(set)) continue;
    if (!tagsOf(card.defId).some((t) => state.checkedTags.has(t))) continue;
    visibleCards.add(card.defId);
  }

  // ② 协议：世代开着 且 至少有一张卡可见（一张都没有 ⇒ 连它的框一起不返回）
  for (const proto of state.protocols) {
    if (!state.enabledSets.has(proto.set)) continue;
    if (!state.cards.some((c) => c.protocol === proto.defId && visibleCards.has(c.defId))) continue;
    visibleProtocols.add(proto.defId);
  }

  return {
    visibleCards,
    visibleProtocols,
    totalCards: state.cards.length,
    totalProtocols: state.protocols.length,
  };
}
