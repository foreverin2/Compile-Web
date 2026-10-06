/**
 * ★ 2026-10-06（用户要求）：「想办法把战斗日志改为纯英文 + 带对应触发卡牌/协议的小图片」。
 *
 * ## 这一层做什么
 *
 * 引擎的 `state.log` 是**红线**（`src/core/**` 一个字都不能动：联机两端逐字一致、大量测试逐字
 * 钉着、`state` 进指纹）。所以这里做**显示层**翻译：英文模式下把每条日志按**形状表**换成英文，
 * 命中不了就原样返回（宁可留中文也不丢信息）；中文模式下**逐字返回原文**（构造性不可能回归）。
 * 这与 `src/i18n/engine-prompt.ts`（选择请求标题那一族）是**同一套做法**，只是对象换成日志。
 *
 * ## 形状表的来源
 *
 * 扫 `src/core/**` 里所有写日志的地方（`pushLog(...)`、`pushEffectLog` 的模板、
 * `describeOp()` 的 `return`），逐条抄成"正则 + 英文模板"。`tests/i18n/engine-log.test.ts`
 * 有一条**真跑覆盖腿**：自动对局若干手，把真的产出的每一条日志过一遍这层，
 * 英文里出现汉字就报红并点名那一行 —— 新加日志忘了登记会当场红。
 *
 * ## 名字怎么处理
 *
 * 日志里会出现**中文协议名**（`P1 选择 流水`、`P1 编译线 2（流水 10 vs 对手 3）`）与
 * 名字列表（`P1 选择：流水2、火焰3`）⇒ 这一层先把中文协议名逐个换成卡面上的英文名
 * （`PROTOCOL_EN`），再把 `、` 换成 `, `。卡牌 id（`fire-3`）本来就是英文，原样保留。
 */

import { PROTOCOL_EN } from './protocol-en';
// ⚠️ 这里 import **事实层**只为拿 45 套协议的中文名（把它换成英文名用）：`src/data/**` 只依赖
// `src/core/models/types`（类型），不 import 本层 ⇒ 不会成环，也不是"显示层改事实层"。
import { DEMO_PROTOCOLS } from '../data/demo';
import type { Lang } from './lang';

/** 一条形状：`re` 匹配**整行**，`en` 用它捕获的组拼英文 */
interface LogRule {
  readonly re: RegExp;
  readonly en: (m: RegExpMatchArray) => string;
}

const UP_DOWN = (zh: string): string => (zh === '正面' ? 'face up' : 'face down');
const side = (opp: string | undefined): string => (opp ? "the opponent's" : 'their own');

/**
 * 形状表（**顺序即匹配顺序**：更具体的写在前面；下面每条都能各自独立命中，顺序只影响
 * 理论上的重叠情形）。
 */
const RULES: readonly LogRule[] = [
  // ── 行动/落牌/阶段（actions/base.ts、resolve.ts、control.ts、game.ts、deck.ts）──
  {
    re: /^P(\d+) 打出 ([a-z][\w-]*-\d+)（(正面|反面)）到(对方)?线 (\d+)$/,
    en: (m) => `P${m[1]} plays ${m[2]} (${UP_DOWN(m[3])}) onto ${side(m[4])} line ${m[5]}`,
  },
  { re: /^P(\d+) 切洗牌库$/, en: (m) => `P${m[1]} shuffles the deck` },
  { re: /^P(\d+) 将弃牌堆洗入牌库$/, en: (m) => `P${m[1]} shuffles the trash into the deck` },
  { re: /^P(\d+) 补满手牌$/, en: (m) => `P${m[1]} refills hand` },
  {
    re: /^P(\d+) 清理缓存：弃 (\d+) 张牌至 5 张上限$/,
    en: (m) => `P${m[1]} clears cache: discards ${m[2]} card(s) down to the 5-card limit`,
  },
  {
    re: /^P(\d+) 控制阶段：(\d+) 条线总值高于对手 → 获得控制组件$/,
    en: (m) => `P${m[1]} control step: ${m[2]} line(s) beat the opponent → gains the control component`,
  },
  {
    re: /^P(\d+) 归还控制组件至中立（编译\/补满手牌）$/,
    en: (m) => `P${m[1]} returns the control component to neutral (compile / refill hand)`,
  },
  {
    re: /^P(\d+) (重)?编译线 (\d+)（(\S+) (\d+) vs 对手 (\d+)）(——本次不编译)?$/,
    en: (m) => `P${m[1]} ${m[2] ? 'recompiles' : 'compiles'} line ${m[3]} (${m[4]} ${m[5]} vs opponent ${m[6]})`
      + (m[7] ? ' — not compiled this time' : ''),
  },
  { re: /^P(\d+) 重编译夺取对手牌库顶1张$/, en: (m) => `P${m[1]} recompiles and takes the top card of the opponent's deck` },
  { re: /^P(\d+) 弃置整个牌库（(\d+) 张）$/, en: (m) => `P${m[1]} discards the whole deck (${m[2]} cards)` },
  { re: /^P(\d+)：牌库全部放入弃牌堆$/, en: (m) => `P${m[1]}: the whole deck goes to the trash` },
  { re: /^P(\d+)：多元协议翻转至已编译（diversity-0）$/, en: (m) => `P${m[1]}: the Diversity protocol flips to compiled (diversity-0)` },
  { re: /^P(\d+) 重排协议：交换位置 (\d+) 与 (\d+)$/, en: (m) => `P${m[1]} rearranges protocols: swaps positions ${m[2]} and ${m[3]}` },
  { re: /^P(\d+) 交换链路位置 (\d+) 与 (\d+)$/, en: (m) => `P${m[1]} swaps lane positions ${m[2]} and ${m[3]}` },
  { re: /^P(\d+) 重排协议 → (.+)$/, en: (m) => `P${m[1]} rearranges protocols → ${m[2]}` },
  { re: /^P(\d+) 禁用 (.+)$/, en: (m) => `P${m[1]} bans ${m[2]}` },
  { re: /^P(\d+) 取消选择 (.+)$/, en: (m) => `P${m[1]} unpicks ${m[2]}` },
  { re: /^P(\d+) 选择 (.+)$/, en: (m) => `P${m[1]} picks ${m[2]}` },
  { re: /^P(\d+) wins!$/, en: (m) => `P${m[1]} wins!` },
  { re: /^Setup complete\. Starting hand drawn \(5 each\)\.$/, en: () => 'Setup complete. Starting hand drawn (5 each).' },

  // ── 选择/守卫（resolve.ts）──
  { re: /^P(\d+) 选择：跳过$/, en: (m) => `P${m[1]} choice: skip` },
  { re: /^P(\d+) 选择：(.+)$/, en: (m) => `P${m[1]} choice: ${m[2]}` },
  { re: /^无合法目标，该步骤跳过$/, en: () => 'no legal target: step skipped' },
  { re: /^ice-6：禁止抽牌，跳过$/, en: () => 'ice-6: drawing blocked, skipping' },
  { re: /^([a-z][\w-]*-\d+) 不可被翻转，跳过$/, en: (m) => `${m[1]} cannot be flipped, skipping` },
  { re: /^([a-z][\w-]*-\d+) 不可被偏转，跳过$/, en: (m) => `${m[1]} cannot be shifted, skipping` },
  { re: /^效果终止：([a-z][\w-]*-\d+) 被覆盖\/翻面\/移除$/, en: (m) => `effect ends: ${m[1]} was covered / flipped / removed` },
  {
    re: /^\[被禁止\] ([a-z][\w-]*-\d+) 的中部指令无法结算（恐惧0 在场，对手回合内禁中央效果）$/,
    en: (m) => `[blocked] ${m[1]}'s middle command cannot resolve (Fear 0 is on the field: middle commands are off on the opponent's turn)`,
  },
  {
    re: /^\[被禁止\] ([a-z][\w-]*-\d+) 的中部指令无效（冷漠2 此列无效化中部命令）$/,
    en: (m) => `[blocked] ${m[1]}'s middle command is negated (Apathy 2 negates middle commands in this line)`,
  },
  {
    re: /^\[被禁止\] ([a-z][\w-]*-\d+) 的「(.+)」指令因区域禁用（惰性0 禁顶\/惰性1 禁底）未触发$/,
    en: (m) => `[blocked] ${m[1]}'s "${m[2]}" command did not trigger (zone disabled: Inertia 0 bans tops / Inertia 1 bans bottoms)`,
  },
  { re: /^复制中央效果：([a-z][\w-]*-\d+) 无中指令，无效果$/, en: (m) => `copy middle command: ${m[1]} has no middle command, no effect` },
  { re: /^从牌库抽取失败：(\S+) 已不在牌库，跳过$/, en: (m) => `draw from deck failed: ${m[1]} is no longer in the deck, skipping` },
  { re: /^从弃牌堆打出失败：(\S+) 已不在弃牌堆，跳过$/, en: (m) => `play from trash failed: ${m[1]} is no longer in the trash, skipping` },
  { re: /^\[揭示\] ([a-z][\w-]*-\d+) 被揭开（其上卡被移除）$/, en: (m) => `[reveal] ${m[1]} is revealed (the card above it was removed)` },

  // ── 效果帧标题（`pushEffectLog`：`[阶段] defId：detail`）──
  { re: /^\[([^\]]+)\] ([a-z][\w-]*-\d+)$/, en: (m) => `[${STAGE_EN[m[1]] ?? m[1]}] ${m[2]}` },
  { re: /^\[([^\]]+)\] ([a-z][\w-]*-\d+)：(.+)$/, en: (m) => `[${STAGE_EN[m[1]] ?? m[1]}] ${m[2]}: ${m[3]}` },

  // ── op 描述（describeOp：`弃置 fire-1` / `P1 抽 2 张牌` …）──
  { re: /^弃置 ([a-z][\w-]*-\d+)$/, en: (m) => `discards ${m[1]}` },
  { re: /^弃置 (\d+) 张牌$/, en: (m) => `discards ${m[1]} card(s)` },
  { re: /^删除 ([a-z][\w-]*-\d+)$/, en: (m) => `deletes ${m[1]}` },
  { re: /^回手 ([a-z][\w-]*-\d+)$/, en: (m) => `returns ${m[1]} to hand` },
  { re: /^翻转 ([a-z][\w-]*-\d+)$/, en: (m) => `flips ${m[1]}` },
  { re: /^偏转 ([a-z][\w-]*-\d+) → 线 (\d+)$/, en: (m) => `shifts ${m[1]} → line ${m[2]}` },
  { re: /^P(\d+) 抽 (\d+) 张牌$/, en: (m) => `P${m[1]} draws ${m[2]} card(s)` },
  { re: /^P(\d+) 抽 (\d+) 张牌（对手牌库顶）$/, en: (m) => `P${m[1]} draws ${m[2]} card(s) (from the opponent's deck)` },
  { re: /^从牌库顶打出（(正面|反面)）→ 线 (\d+)$/, en: (m) => `plays from the top of the deck (${UP_DOWN(m[1])}) → line ${m[2]}` },
  { re: /^打出 ([a-z][\w-]*-\d+)（(正面|反面)）→ 线 (\d+)$/, en: (m) => `plays ${m[1]} (${UP_DOWN(m[2])}) → line ${m[3]}` },
  { re: /^揭示 ([a-z][\w-]*-\d+)$/, en: (m) => `reveals ${m[1]}` },
  { re: /^将 ([a-z][\w-]*-\d+) 给予 P(\d+)$/, en: (m) => `${m[1]} is given to P${m[2]}` },
  { re: /^从 P(\d+) 随机取 1 张手牌$/, en: (m) => `takes 1 random hand card from P${m[1]}` },
  { re: /^弃置牌库顶 1 张$/, en: () => 'discards the top card of the deck' },
  { re: /^从牌库抽 ([a-z][\w-]*-\d+)$/, en: (m) => `draws ${m[1]} from the deck` },
  { re: /^从弃牌堆打出 ([a-z][\w-]*-\d+)（(正面|反面)）→ 线 (\d+)$/, en: (m) => `plays ${m[1]} from the trash (${UP_DOWN(m[2])}) → line ${m[3]}` },
  { re: /^将 P(\d+) 牌库顶牌反面打出到 P(\d+) 的线 (\d+)$/, en: (m) => `plays the top card of P${m[1]}'s deck face down onto line ${m[3]} of P${m[2]}` },
  { re: /^取走场上 ([a-z][\w-]*-\d+) 加入手牌$/, en: (m) => `takes ${m[1]} from the field into hand` },
];

/** 效果帧的 `[阶段]` 标签（`src/core/log.ts` 的 `stageLabel`）→ 英文 */
const STAGE_EN: Readonly<Record<string, string>> = {
  中部: 'middle',
  开始: 'start',
  结束: 'end',
  被盖前: 'before covered',
  翻面前: 'before flip',
  编译前: 'before compile',
  '连锁·抽牌后': 'after draw',
  '连锁·弃牌后': 'after discard',
  '连锁·删除后': 'after delete',
  '连锁·清缓存后': 'after clear cache',
  '连锁·对手抽牌后': 'after opponent draw',
  '连锁·自己弃牌后': 'after own discard',
  '连锁·刷新后': 'after refresh',
  '连锁·对手刷新后': 'after opponent refresh',
  '连锁·编译后': 'after compile',
  '连锁·你编译后': 'after your compile',
  '连锁·任意玩家编译后': 'after any compile',
  '连锁·切洗后': 'after shuffle',
  '连锁·出牌后': 'after play',
  '连锁·回手后': 'after return',
  '连锁·对手获得控制权后': 'after opponent gains control',
  '连锁·任意玩家清缓存后': 'after any clear cache',
  '连锁·你删除后': 'after your delete',
  '连锁·你重排协议后': 'after your rearrange',
  '连锁·任意玩家重排协议后': 'after any rearrange',
  '连锁·行动反面打出后': 'after action face-down play',
};

/**
 * 中文协议名 → 卡面英文名（**45 套齐全**，由事实层的中文名与英文表拼出来）。
 * 长的排前面：`流水` 是 `流水4` 的前缀，先换长的才不会把 `流水4` 拆坏（实测中文名之间没有
 * 更长包含关系，但按长度排序更稳）。
 */
const NAME_PAIRS: readonly (readonly [string, string])[] = DEMO_PROTOCOLS
  .map((p) => [p.name, PROTOCOL_EN[p.defId]?.name] as const)
  .filter((pair): pair is readonly [string, string] => typeof pair[1] === 'string' && pair[1] !== '')
  .slice()
  .sort((a, b) => b[0].length - a[0].length);

/**
 * 把日志里的中文协议名换成卡面英文名，并把顿号换成逗号。
 *
 * ⚠️ 卡牌 id（`fire-3`）本来就是英文，原样保留；被换的只有**协议名**（`P1 选择 流水` →
 * `P1 picks Water`、`P1 编译线 2（流水 10 vs 对手 3）` → `… (Water 10 vs opponent 3)`）。
 */
function translateNames(s: string): string {
  let out = s;
  for (const [zh, en] of NAME_PAIRS) out = out.split(zh).join(en);
  return out.replace(/、/g, ', ');
}

/** 中文标点收尾（只在英文模式下做） */
function tidy(s: string): string {
  return s
    .replace(/，/g, ', ')
    .replace(/：/g, ': ')
    .replace(/（/g, ' (')
    .replace(/）/g, ')')
    .replace(/「/g, '"')
    .replace(/」/g, '"')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/ +([,.:])/g, '$1')
    .trimEnd();
}

/**
 * **收尾词典**：形状表管"整行的骨架"，这里管"骨架里的零碎词"——效果帧的 `detail`
 * （`pushEffectLog` 的第三参）是各处效果代码**随手写**的（`由 P1 结算` / `原因：被揭开` /
 * `打出` …），逐个写形状规则既写不完也易漂。词典按**长度降序**替换，最后交给 `tidy`。
 *
 * ⚠️ 这一层是"能翻的翻、翻不动的留给覆盖腿报红"，不是逐句润色：真跑覆盖腿要求
 * **自动对局产出的每一条日志翻完零汉字**（做不到就红），所以词典必须跟着日志长。
 */
const PHRASES: readonly (readonly [string, string])[] = ([
  ['由 P', 'resolved by P'],
  ['原因：', 'reason: '],
  ['被揭开', 'was revealed'],
  ['翻正', 'flipped face up'],
  ['引发', 'triggered'],
  ['无法结算', 'cannot resolve'],
  ['禁止抽牌', 'drawing blocked'],
  ['不可被翻转', 'cannot be flipped'],
  ['不可被偏转', 'cannot be shifted'],
  ['该步骤跳过', 'step skipped'],
  ['获得控制组件', 'gains the control component'],
  ['归还控制组件', 'returns the control component'],
  ['控制组件', 'control component'],
  ['总值高于对手', 'beats the opponent'],
  ['条线', ' line(s)'],
  // ⚠️ 单用「结算」丢掉：'由 P1 结算' → 'resolved by P1'（前一条短语已给动词），留着 'resolves' 会拼成 'resolved by P1 resolves'。
  ['结算', ''],
  ['打出', 'play'],
  ['弃置', 'discard'],
  ['弃牌', 'discard'],
  ['抽牌', 'draw'],
  ['抽 ', 'draws '],
  ['翻转', 'flip'],
  ['偏转', 'shift'],
  ['删除', 'delete'],
  ['回手', 'return'],
  ['揭示', 'reveal'],
  ['牌库顶', 'deck top'],
  ['牌库', 'deck'],
  ['弃牌堆', 'trash'],
  ['手牌', 'hand'],
  ['场上', 'field'],
  ['链路', 'lane'],
  ['此列', 'this line'],
  ['这张牌', 'this card'],
  ['那张牌', 'that card'],
  ['对手', 'opponent'],
  ['双方', 'both sides'],
  ['自己', 'own'],
  ['全部', 'all'],
  ['所有', 'all'],
  ['布局', 'layout'],
  ['位置', 'position'],
  ['线 ', 'line '],
  ['与', 'and'],
  ['并', 'and'],
  ['到', 'to'],
  ['张牌', 'card(s)'],
  ['张', ''],
  ['的', ''],
  ['了', ''],
] as const).slice().sort((a, b) => b[0].length - a[0].length);

/** 名字 + 词典 + 标点，一遍过 */
function polish(s: string): string {
  let out = translateNames(s);
  for (const [zh, en] of PHRASES) out = out.split(zh).join(en);
  return tidy(out);
}

/**
 * 一条引擎日志的**显示文本**：中文模式逐字返回原文；英文模式走形状表，命中不了返回原文
 * （并把名字/标点/常见词顺手换掉，尽量少留中文）。
 */
export function engineLogText(raw: string, lang: Lang): string {
  if (lang !== 'en') return raw;
  // ⚠️ 行首缩进**必须原样带走**：`pushLog` 把"效果栈深度"写成行首空格，渲染层靠
  // `white-space: pre-wrap` 显示日志树 ⇒ 翻译不能把树拍平。
  const indent = /^ */.exec(raw)?.[0] ?? '';
  const body = raw.slice(indent.length);
  for (const rule of RULES) {
    const m = rule.re.exec(body);
    if (m !== null) return indent + polish(rule.en(m));
  }
  return indent + polish(body);
}

/** 形状表条数（测试用：反向覆盖腿要求"每条规则都被真跑日志命中过"） */
export const ENGINE_LOG_RULE_COUNT = RULES.length;
