/**
 * ★ 2026-10-02（P5）：**引擎文案的显示层替换**（选择条标题那一族）。
 *
 * ## 为什么要有这一层（而不是直接改引擎）
 *
 * `src/core/effects/**` 里 `yield` 的选择请求带的 `prompt.title` 是**引擎文案**（例如
 * `life-1：翻转1张牌`）。它是**红线**：
 *
 *  1. 联机两端逐字一致（状态 / 指纹强依赖同一句话）；
 *  2. 大量测试逐字钉着这些句子；
 *  3. `docs/2026-10-01-i18n-尚未抽取的屏.md` 的 A2/G④ 把它登记成"有意保留"。
 *
 * ⇒ 引擎一个字都不动。英文模式下**在渲染时**把标题换成英文：命中模式表就输出英文，
 * **命中不了就原样返回引擎那句中文**（不丢功能、不白屏）。中文模式下**直接返回原文**
 * —— 中文渲染结果**构造上不可能**回归（这一条比任何逐字比对都强）。
 *
 * ## 为什么键按"语义"组织，而不是 `engine.prompt.<defId>.<kind>`
 *
 * 探路实测（`.superpowers/engine-prompt/extract.mjs`，2026-10-02）：`src/core/effects/**`
 * 里有 **304 个 prompt 站点、309 条去重标题**。`(defId, kind)` **不唯一** —— 同一张卡同一
 * `kind` 会有 2–3 条不同标题（`life-1` 两次 `select`：`翻转1张牌` / `再翻转1张牌`；`fire-1` /
 * `death-0` / `hate-1` / `flexibility-*` 同理），而且**没有任何运行期可算的结构签名**能把它们
 * 分开（那两条的 kind/min/max/optional/候选的 zone/owner/line/pos 逐个相同）。
 * ⇒ 唯一能判别的是"引擎原文本身"。于是这一层的口径是：
 *
 *  - **先用 `defId` 前缀**（`^[a-z]+-\d+` 加可选的 `（开始/结束/被盖住前/编译前/你抽牌后）`标记）；
 *  - 余项（**190 条去重余项 + 12 条无前缀整标题 = 204 条**）在模式表里匹配；
 *  - 命中后拼成 `life-5: discard 1 card`（前缀原样保留，与中文的 `life-5：弃1张牌` 同构）。
 *
 * ## 键与两张表的关系（为什么键是**字面量数组**）
 *
 * 键 `engine.prompt.pNNN` 逐个写在本文件的 `ENGINE_PROMPT_KEYS` 里（字面量），值住在
 * `zh.ts` / `en.ts`。这样 `tests/i18n/tables.test.ts` 的两条既有腿照旧管得住这一族：
 * "每个被调用的键都在两张表里" 与 "表里没有谁也读不到的死键"（键名以字面量出现在
 * `src/i18n/**` 的代码位里）；**不出现动态 `t(变量)`**（那条腿也是红的）。
 *
 * ## 三条不变量（`tests/i18n/engine-prompt-title.test.ts` 逐条钉住）
 *
 *  1. **覆盖**：`src/core/effects/cards/**` 里每一个 prompt 标题（含带运行期参数的那 10 条模式）
 *     都必须在模式表里命中；新出现 / 改了字面的标题 ⇒ 报红并点名文件:行。
 *  2. **英文侧零汉字**：命中之后拼出来的英文里**不许有汉字**（有腿）。万一运行期参数带了中文
 *     （例如将来 `chaos1Session` 多了一个中文标签），这里**退回引擎原文**而不是把半截中文端上去。
 *  3. **中文侧逐字不变**：`lang === 'zh'` 时返回值与入参**逐字节相同**。
 */
import { EN } from './en';
import { ZH } from './zh';
import type { Lang } from './lang';

/**
 * 模式表的键（**顺序即匹配顺序**；不过匹配是"先整串字面量精确命中，再按本数组顺序跑参数模式"
 * —— 顺序只影响"两条参数模式都能命中同一个标题"这种理论情形，实测 204 条里没有）。
 *
 * ⚠️ 这一段由 `.superpowers/engine-prompt/emit.mjs --write` 生成（值在 `zh.ts` / `en.ts`）；
 * 手改要同时改两张表，否则 `tests/i18n/engine-prompt-title.test.ts` 会报红。
 */
export const ENGINE_PROMPT_KEYS: readonly string[] = [
  /* ENGINE-PROMPT-KEYS-BEGIN */
  // 弃1张牌
  'engine.prompt.p001',
  // 你弃置1张牌
  'engine.prompt.p002',
  // 偏转到哪条链路
  'engine.prompt.p003',
  // 翻转1张牌
  'engine.prompt.p004',
  // 对手弃{n}张牌
  'engine.prompt.p005',
  // 对手弃1张牌
  'engine.prompt.p006',
  // 反面打出到任意线
  'engine.prompt.p007',
  // 偏转目标线
  'engine.prompt.p008',
  // 删除1张牌
  'engine.prompt.p009',
  // 对手弃置1张牌
  'engine.prompt.p010',
  // 翻转另1张牌
  'engine.prompt.p011',
  // 你可以弃1张牌
  'engine.prompt.p012',
  // 弃置1张牌
  'engine.prompt.p013',
  // 选择目标列
  'engine.prompt.p014',
  // 把该牌偏转进此列
  'engine.prompt.p015',
  // 此牌被覆盖，你可以偏转它
  'engine.prompt.p016',
  // 对手弃2张牌
  'engine.prompt.p017',
  // 对手在此链路反面打出1张牌
  'engine.prompt.p018',
  // 翻转1张你的反面朝下的牌
  'engine.prompt.p019',
  // 回手1张其他牌
  'engine.prompt.p020',
  // 你可以翻转此牌
  'engine.prompt.p021',
  // 你可以将弃牌堆洗入牌库
  'engine.prompt.p022',
  // 你可以偏转此牌
  'engine.prompt.p023',
  // 你可以弃置1张牌
  'engine.prompt.p024',
  // 弃1张或更多张牌
  'engine.prompt.p025',
  // 若你这么做，翻转1张牌
  'engine.prompt.p026',
  // 选择要交换的第2个位置
  'engine.prompt.p027',
  // 在链路 {n} 反面打出1张牌
  'engine.prompt.p028',
  // 正面打出（须匹配协议线）
  'engine.prompt.p029',
  // {verb}：{who} 持有控制组件（已归还中立）——可重排一名玩家的协议
  'engine.prompt.p030',
  // {verb}：选择要交换的第2个位置
  'engine.prompt.p031',
  // {verb}：重排玩家{who}的协议——选择要交换的第1个位置
  'engine.prompt.p032',
  // 把1张反面牌偏转进此列
  'engine.prompt.p033',
  // 把1张牌偏转进或偏转出此列
  'engine.prompt.p034',
  // 把覆盖者偏转到哪条链路
  'engine.prompt.p035',
  // 把该牌偏转出此列
  'engine.prompt.p036',
  // 此牌被反面牌覆盖——你可以偏转那张牌
  'engine.prompt.p037',
  // 此牌将被覆盖——先翻转1张正面朝上的牌
  'engine.prompt.p038',
  // 从弃牌堆打出1张牌
  'engine.prompt.p039',
  // 打出1张牌
  'engine.prompt.p040',
  // 打出朝向
  'engine.prompt.p041',
  // 第2个位置
  'engine.prompt.p042',
  // 对手抽牌，你可以删除1张卡牌
  'engine.prompt.p043',
  // 对手打出1张牌
  'engine.prompt.p044',
  // 对手弃牌，你可以反面打出1张卡牌
  'engine.prompt.p045',
  // 对手删除1张对手的反面牌
  'engine.prompt.p046',
  // 对手刷新——你弃置任意数目的卡牌
  'engine.prompt.p047',
  // 对手选择抽1张牌或打出1张牌
  'engine.prompt.p048',
  // 对手已编译的协议更多——翻转1张牌
  'engine.prompt.p049',
  // 对手拥有控制权——你可以翻转1张牌
  'engine.prompt.p050',
  // 对手在此链路出牌后，他要弃置1张牌
  'engine.prompt.p051',
  // 翻转1张被覆盖的卡牌
  'engine.prompt.p052',
  // 翻转1张此链路中正面朝上的卡牌
  'engine.prompt.p053',
  // 翻转1张对手的正面牌
  'engine.prompt.p054',
  // 翻转1张你被覆盖的牌
  'engine.prompt.p055',
  // 翻转1张你对手的牌
  'engine.prompt.p056',
  // 翻转1张阈值大于你手牌数({n})的卡牌
  'engine.prompt.p057',
  // 翻转1张阈值小于{n}的卡牌
  'engine.prompt.p058',
  // 翻转1张阈值小于此链路牌数的牌
  'engine.prompt.p059',
  // 翻转1张正面朝上的牌
  'engine.prompt.p060',
  // 翻转对手1张正面朝上的牌
  'engine.prompt.p061',
  // 翻转对手阈值最高的被覆盖的牌
  'engine.prompt.p062',
  // 翻转或偏转你的1张牌
  'engine.prompt.p063',
  // 翻转另1条链路中的牌——选择链路
  'engine.prompt.p064',
  // 翻转你的1张卡牌
  'engine.prompt.p065',
  // 翻转你的1张牌
  'engine.prompt.p066',
  // 翻转这张被覆盖的卡牌
  'engine.prompt.p067',
  // 翻转这张正面朝上的牌
  'engine.prompt.p068',
  // 反面打出1张卡牌
  'engine.prompt.p069',
  // 反面打出1张牌
  'engine.prompt.p070',
  // 反面打出到哪条链路
  'engine.prompt.p071',
  // 反面打出牌库顶到任意线
  'engine.prompt.p072',
  // 复制对手1张牌的中央效果
  'engine.prompt.p073',
  // 覆盖着新星牌——你可以重排你的协议
  'engine.prompt.p074',
  // 回手1张你的牌
  'engine.prompt.p075',
  // 回手1张牌
  'engine.prompt.p076',
  // 回手或偏转1张牌
  'engine.prompt.p077',
  // 回手这张牌
  'engine.prompt.p078',
  // 将对手的1张正面朝下的卡牌加入手牌
  'engine.prompt.p079',
  // 将牌库顶的牌反面打在对手的哪一侧
  'engine.prompt.p080',
  // 将其正面朝下打出到其它链路
  'engine.prompt.p081',
  // 将随机揭示的那张牌反面打出在对手的哪一侧
  'engine.prompt.p082',
  // 交换你的2个协议——第1个位置
  'engine.prompt.p083',
  // 交换协议位置——选择第1个位置
  'engine.prompt.p084',
  // 揭示1张反面牌
  'engine.prompt.p085',
  // 揭示1张你的手牌
  'engine.prompt.p086',
  // 揭示1张阈值={n}的牌
  'engine.prompt.p087',
  // 控制权持有者（P{n}）选择要交换的第1个协议位（新星方）
  'engine.prompt.p088',
  // 命中！删除1张牌
  'engine.prompt.p089',
  // 你把1张手牌给对手
  'engine.prompt.p090',
  // 你可以把1张手牌给对手
  'engine.prompt.p091',
  // 你可以抽1张牌
  'engine.prompt.p092',
  // 你可以抽2张牌（若这么做翻转此牌）
  'engine.prompt.p093',
  // 你可以打出这张牌
  'engine.prompt.p094',
  // 你可以打入1张非多元协议的卡牌到此链路
  'engine.prompt.p095',
  // 你可以翻转1张被覆盖的正面朝上的卡牌
  'engine.prompt.p096',
  // 你可以翻转1张此列的反面牌
  'engine.prompt.p097',
  // 你可以翻转1张反面牌
  'engine.prompt.p098',
  // 你可以翻转1张你的被盖住的正面牌
  'engine.prompt.p099',
  // 你可以翻转1张牌
  'engine.prompt.p100',
  // 你可以翻转1张正面朝上的卡牌
  'engine.prompt.p101',
  // 你可以回手1张对手的牌
  'engine.prompt.p102',
  // 你可以回手1张你的牌（含此牌自身）
  'engine.prompt.p103',
  // 你可以将对手1张被覆盖的牌偏转到此链路
  'engine.prompt.p104',
  // 你可以将手牌中的1张牌放回牌库底端
  'engine.prompt.p105',
  // 你可以偏转1张你的牌
  'engine.prompt.p106',
  // 你可以偏转此牌到另一列
  'engine.prompt.p107',
  // 你可以偏转此牌进入对手总阈值最大的链路
  'engine.prompt.p108',
  // 你可以偏转或翻转那张牌
  'engine.prompt.p109',
  // 你可以偏转那张牌
  'engine.prompt.p110',
  // 你可以偏转这张牌
  'engine.prompt.p111',
  // 你可以弃置你的手牌
  'engine.prompt.p112',
  // 你可以弃置牌库顶端的卡牌
  'engine.prompt.p113',
  // 你可以失去控制权
  'engine.prompt.p114',
  // 你弃置1张牌或删除此牌
  'engine.prompt.p115',
  // 你拥有控制权——你可以将对手1张牌偏转到此链路
  'engine.prompt.p116',
  // 你拥有控制权——偏转1张其他牌
  'engine.prompt.p117',
  // 你重排协议后——你可以偏转1张反面朝下的牌
  'engine.prompt.p118',
  // 偏转1张被覆盖的正面朝下的卡牌
  'engine.prompt.p119',
  // 偏转1张对手的反面牌
  'engine.prompt.p120',
  // 偏转1张对手的牌
  'engine.prompt.p121',
  // 偏转1张对手在此链路的卡牌
  'engine.prompt.p122',
  // 偏转1张反面牌
  'engine.prompt.p123',
  // 偏转1张你的被覆盖的卡牌
  'engine.prompt.p124',
  // 偏转1张你的牌（含此牌自身）
  'engine.prompt.p125',
  // 偏转1张你对手的被盖住的牌
  'engine.prompt.p126',
  // 偏转1张牌
  'engine.prompt.p127',
  // 偏转1张其它牌
  'engine.prompt.p128',
  // 偏转1张阈值小于此链路牌数的牌
  'engine.prompt.p129',
  // 偏转此牌到另一列
  'engine.prompt.p130',
  // 偏转对手的1张牌
  'engine.prompt.p131',
  // 偏转对手的1张牌，或交换你的2个协议
  'engine.prompt.p132',
  // 偏转或翻转1张卡牌
  'engine.prompt.p133',
  // 偏转另1张你的牌
  'engine.prompt.p134',
  // 偏转你阈值最低的被覆盖的牌
  'engine.prompt.p135',
  // 偏转你在此链路中1张被覆盖的牌
  'engine.prompt.p136',
  // 偏转这张牌
  'engine.prompt.p137',
  // 弃3张牌
  'engine.prompt.p138',
  // 弃置1张牌到对手的弃牌堆
  'engine.prompt.p139',
  // 弃置2张牌
  'engine.prompt.p140',
  // 清缓存后——选择牌库顶反打到的链路
  'engine.prompt.p141',
  // 任意玩家清缓存后——删除1张牌
  'engine.prompt.p142',
  // 任意玩家重排协议后——弃1张牌
  'engine.prompt.p143',
  // 删除1张0分或1分的牌
  'engine.prompt.p144',
  // 删除1张反面牌
  'engine.prompt.p145',
  // 删除1张阈值={n}的卡牌（可含被覆盖）
  'engine.prompt.p146',
  // 删除此列分值最低的被盖住的牌
  'engine.prompt.p147',
  // 删除对手的1张牌
  'engine.prompt.p148',
  // 删除对手分值最高的牌
  'engine.prompt.p149',
  // 删除对手阈值最低的被覆盖的牌
  'engine.prompt.p150',
  // 删除该列1张牌
  'engine.prompt.p151',
  // 删除另1张牌
  'engine.prompt.p152',
  // 删除你分值最高的牌
  'engine.prompt.p153',
  // 失去控制权——对手弃{n}张牌
  'engine.prompt.p154',
  // 失去控制权——删除1张正面朝上的牌
  'engine.prompt.p155',
  // 手牌恰好2张——删除对手1张牌
  'engine.prompt.p156',
  // 手牌为0——对手弃{n}张牌
  'engine.prompt.p157',
  // 手牌为0——对手弃1张牌
  'engine.prompt.p158',
  // 透彻：从牌库中选择1张阈值为{n}的卡牌抽取
  'engine.prompt.p159',
  // 宣告1个数字（0-6）
  'engine.prompt.p160',
  // 宣告1个协议
  'engine.prompt.p161',
  // 选1列删除其中所有1分和2分的牌
  'engine.prompt.p162',
  // 选择1条对手总阈值更大的链路
  'engine.prompt.p163',
  // 选择1条链路
  'engine.prompt.p164',
  // 选择1条你恰好有5张牌的链路
  'engine.prompt.p165',
  // 选择1条要翻开盖牌的链路
  'engine.prompt.p166',
  // 选择1条有正面朝下卡牌的链路
  'engine.prompt.p167',
  // 选择1张手牌反面打出
  'engine.prompt.p168',
  // 选择1张未被覆盖的新星牌
  'engine.prompt.p169',
  // 选择第1个要交换的链路
  'engine.prompt.p170',
  // 选择第2个协议位
  'engine.prompt.p171',
  // 选择第2个要交换的链路
  'engine.prompt.p172',
  // 选择目标卡牌
  'engine.prompt.p173',
  // 选择目标线路
  'engine.prompt.p174',
  // 选择你的1张牌（含此牌自身）
  'engine.prompt.p175',
  // 选择牌最多的1条链路
  'engine.prompt.p176',
  // 选择偏转目标线
  'engine.prompt.p177',
  // 选择要编译的链路
  'engine.prompt.p178',
  // 选择要打出的列
  'engine.prompt.p179',
  // 选择要删除1张牌的第二列
  'engine.prompt.p180',
  // 选择要删除1张牌的第一列
  'engine.prompt.p181',
  // 选择要删除所有牌的列（该列双方合计≥8张）
  'engine.prompt.p182',
  // 要么弃1张牌，要么翻转此牌
  'engine.prompt.p183',
  // 以正面还是反面打出
  'engine.prompt.p184',
  // 再翻转1张牌
  'engine.prompt.p185',
  // 再删除1张牌
  'engine.prompt.p186',
  // 在此牌正下方反面打出1张牌
  'engine.prompt.p187',
  // 在另一列反面打出牌堆顶
  'engine.prompt.p188',
  // 在同一链路翻转对手的1张牌
  'engine.prompt.p189',
  // 召回1张卡牌
  'engine.prompt.p190',
  // 召回对手的1张牌
  'engine.prompt.p191',
  // 重排对手协议——选择第1个位置
  'engine.prompt.p192',
  // 重排你的协议
  'engine.prompt.p193',
  // 重排协议：选择要交换的第1个位置
  'engine.prompt.p194',
  // 重排协议：选择要交换的第2个位置
  'engine.prompt.p195',
  // 重新排列{label}的协议——选择要交换的第1个位置
  'engine.prompt.p196',
  // 重新排列{label}的协议——选择要交换的第2个位置
  'engine.prompt.p197',
  // 重新排列{label}的协议（可多次交换，直到满意）
  'engine.prompt.p198',
  // clarity：打出这张牌（朝向）
  'engine.prompt.p199',
  // clarity：反面打出到任意线
  'engine.prompt.p200',
  // clarity：正面打出（须匹配协议线）
  'engine.prompt.p201',
  // unity：翻转1张牌
  'engine.prompt.p202',
  // unity：翻转1张牌或抽取1张牌
  'engine.prompt.p203',
/* ENGINE-PROMPT-KEYS-END */
];

/** `life-3（被盖住前）：…` 这一层：`<defId>` + 可选标记 + 冒号（中英各一套冒号都认） */
const PREFIX_RE = /^([a-z]+-\d+)(（(开始|结束|被盖住前|编译前|你抽牌后)）)?[：:]/;

/** 标记 → 英文（中文模式下用不到这一张表：中文直接回原文） */
const MARKER_EN: Readonly<Record<string, string>> = {
  开始: 'start',
  结束: 'end',
  被盖住前: 'before being covered',
  编译前: 'before compiling',
  你抽牌后: 'after you draw',
};

/**
 * 运行期参数里**会出现的中文词** → 英文。
 *
 * 为什么需要它：探路实测有两族参数**本身是中文**——
 *  - `control-rearrange-flow.ts` 的 `${verb}`：调用方传的是 `'war-1 刷新'` / `'unity-1 编译'`；
 *  - `chaos.ts` 的 `${label}`：调用方传的是 `'你的'` / `'对手的'`（`chaos1Session` 的第三参）。
 * 逐词替换（按空白切词）→ `war-1 refresh` / `your` / `the opponent's`。
 * 词表之外的词原样留下，然后由下面那道"英文结果里有汉字 ⇒ 回引擎原文"的闸门兜住。
 */
const TOKEN_EN: Readonly<Record<string, string>> = {
  你的: 'your',
  对手的: "the opponent's",
  刷新: 'refresh',
  编译: 'compile',
};

/** 正则元字符转义（模式表是**字面量**，不当正则解释） */
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

interface Rule {
  readonly key: string;
  /** 参数占位符名（按出现顺序） */
  readonly names: readonly string[];
  readonly re: RegExp;
}

/** 编译一组键（`zh` 值是模式串）：无参数的走 `Map` 精确命中，带参数的走正则（按键数组顺序） */
function compileRules(keys: readonly string[]): { readonly literal: ReadonlyMap<string, string>; readonly patterns: readonly Rule[] } {
  const literal = new Map<string, string>();
  const patterns: Rule[] = [];
  for (const key of keys) {
    const pattern = ZH[key];
    if (pattern === undefined || pattern === '') continue;
    if (!pattern.includes('{')) {
      literal.set(pattern, key);
      continue;
    }
    const names: string[] = [];
    let src = '^';
    let at = 0;
    for (const m of pattern.matchAll(/\{([A-Za-z0-9_]+)\}/g)) {
      const idx = m.index ?? 0;
      src += escapeRe(pattern.slice(at, idx)) + '(.+?)';
      names.push(m[1]);
      at = idx + m[0].length;
    }
    src += escapeRe(pattern.slice(at)) + '$';
    patterns.push({ key, names, re: new RegExp(src) });
  }
  return { literal, patterns };
}

/** 表在**模块顶层编译一次**（只读表、不调 `t()` —— 模块级 `t()` 会被 `module-scope-t` 那条腿报红） */
const RULES = compileRules(ENGINE_PROMPT_KEYS);

/**
 * 选择条**动作按钮**的键（顺序即匹配顺序）。
 *
 * ⚠️ 这一族的 `zh` 值是**引擎给的 action id**（`flip` / `order:{layout}` / `重排玩家{who}的协议`），
 * **不是**屏上那句中文 —— 屏上中文一律来自 `src/core/log.ts` 的 `actionCn()`（红线，一个字未改），
 * 本族只在**英文模式**下把 id 换成英文。键名按 id 语义组织（`engine.action.<id>`）。
 */
export const ENGINE_ACTION_KEYS: readonly string[] = [
  /* ENGINE-ACTION-KEYS-BEGIN */
  // flip
  'engine.action.flip',
  // draw
  'engine.action.draw',
  // discard
  'engine.action.discard',
  // delete
  'engine.action.delete',
  // shift
  'engine.action.shift',
  // return
  'engine.action.return',
  // face-up
  'engine.action.face_up',
  // face-down
  'engine.action.face_down',
  // skip
  'engine.action.skip',
  // shuffle
  'engine.action.shuffle',
  // swap
  'engine.action.swap',
  // play
  'engine.action.play',
  // rearrange-swap
  'engine.action.rearrange_swap',
  // rearrange-done
  'engine.action.rearrange_done',
  // 不重排，继续
  'engine.action.keep',
  // 失去控制权
  'engine.action.give_up_control',
  // 弃置手牌
  'engine.action.discard_hand',
  // order:{layout}
  'engine.action.order',
  // num:{n}
  'engine.action.num',
  // proto:{proto}
  'engine.action.proto',
  // 重排玩家{who}的协议
  'engine.action.rearrange_player',
  // 重排玩家{who}的协议（已锁定）
  'engine.action.rearrange_player_locked',
  /* ENGINE-ACTION-KEYS-END */
];

const ACTION_RULES = compileRules(ENGINE_ACTION_KEYS);

/** 运行期参数 → 英文（逐词替换；词表外的词原样留下，交给"零汉字"闸门判） */
function paramEn(value: string): string {
  return value.replace(/[^\s]+/g, (w) => TOKEN_EN[w] ?? w);
}

/** 把英文值里的 `{name}` 换成实参（照 `src/i18n/index.ts` 的 `fill()` 同款语义：缺的参数保留占位原文） */
function fillEn(key: string, values: Readonly<Record<string, string>>): string {
  const text = EN[key] ?? ZH[key] ?? '';
  return text.replace(/\{([A-Za-z0-9_]+)\}/g, (whole, name: string) => values[name] ?? whole);
}

/** 在一组已编译的规则上匹配 `body` */
function matchRules(
  rules: { readonly literal: ReadonlyMap<string, string>; readonly patterns: readonly Rule[] },
  body: string,
): { readonly key: string; readonly values: Readonly<Record<string, string>> } | null {
  const exact = rules.literal.get(body);
  if (exact !== undefined) return { key: exact, values: {} };
  for (const rule of rules.patterns) {
    const m = rule.re.exec(body);
    if (m === null) continue;
    const values: Record<string, string> = {};
    for (let i = 0; i < rule.names.length; i += 1) values[rule.names[i]] = paramEn(m[i + 1] ?? '');
    return { key: rule.key, values };
  }
  return null;
}

/** 命中模式表（`body` = 剥掉 `<defId>` 前缀之后的余项） */
function matchRule(body: string): { readonly key: string; readonly values: Readonly<Record<string, string>> } | null {
  return matchRules(RULES, body);
}

/**
 * 引擎标题 → 显示层文案。
 *
 * @param title 引擎给的 `prompt.title`（**原样传入**，本函数不改它、也不回写任何状态）
 * @param lang 当前语言（由 `src/i18n/index.ts` 的 `enginePromptTitle()` 注入，避免这一层反向依赖）
 * @returns 中文：`title` 逐字节原样；英文：命中模式表则英文，否则**回退 `title`**
 */
export function enginePromptText(title: string, lang: Lang): string {
  if (lang === 'zh') return title; // 中文侧：不做任何拼接（构造上不可能回归）
  const m = PREFIX_RE.exec(title);
  const body = m === null ? title : title.slice(m[0].length);
  const prefix = m === null ? '' : `${m[1]}${m[2] === undefined ? '' : ` (${MARKER_EN[m[3]] ?? m[3]})`}: `;
  const hit = matchRule(body);
  if (hit === null) return title;
  const out = prefix + fillEn(hit.key, hit.values);
  // 闸门：英文结果里还有汉字（运行期参数带中文、或表被改坏）⇒ 宁可显示引擎原文，也不端半截中文
  return /[\u3400-\u9fff]/.test(out) ? title : out;
}

/**
 * 选择条**动作按钮**的文字（`act` = 引擎给的 `action:<id>` 应答值）。
 *
 *  - 中文：返回 `''`（**空的**，表示"别换，用引擎原文"）—— 调用方据此回退 `actionCn()`
 *    ⇒ 中文屏上那半个字都没变；
 *  - 英文：命中 `engine.action.*` 则英文；命中不了返回 `''`（同样回退 `actionCn()`）。
 *
 * 为什么返回 `''` 而不是"回退值"：这一层不认识 `actionCn()`（它是 `src/core/log.ts` 的红线，
 * 让 i18n 依赖 core 会把纯层弄脏）。回退由调用点做，方向是"永远拿得到引擎原文"。
 */
export function engineActionText(act: string, lang: Lang): string {
  if (lang === 'zh') return '';
  const id = act.startsWith('action:') ? act.slice('action:'.length) : act;
  const hit = matchRules(ACTION_RULES, id);
  if (hit === null) return '';
  const out = fillEn(hit.key, hit.values);
  return /[\u3400-\u9fff]/.test(out) ? '' : out;
}
