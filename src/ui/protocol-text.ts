/**
 * ★ 2026-10-06（用户要求）：**协议的显示文本按语言取**。
 *
 * 用户原话：「我希望英文模式下，那些协议的座右铭会变成其卡牌上对应的座右铭内容」
 * （前一句是「游戏内的文本还有没有在英文模式下不使用英文的文本」——图鉴、协议详情框、
 * 联机详情框那几处）。
 *
 * ## 为什么要有这个模块（而不是在每处写三元）
 *
 * 中文事实表在 `src/data/cards{,2,3}.ts`（`name` / `loadingText` / `commands`），英文显示串在
 * `src/i18n/protocol-en.ts`（`PROTOCOL_EN`，来源是正版英文协议表）。**取哪一份**这件事
 * 只在本文件判一次：屏上十几处（图鉴组头/展示框/卡面 alt、草稿池卡与 hover 框、协议放大框、
 * 远程页放大框）都调这里，谁都不许自己写 `getLang() === 'en' ? … : …`（那样一处分叉就会漂）。
 *
 * ## 契约
 *
 *  - **中文模式**：逐字返回传进来的中文值（与改动前**一个字都不差**）；
 *  - **英文模式**：有英文条目就返回英文，没有（或字段为空）就**回退中文**（宁可显示中文，
 *    也不显示空串 —— 缺一条数据不该在屏上留一个空洞）；
 *  - 三个助手都是**纯函数**（只读 `getLang()` + 常量表），可以在 node 下直接真跑。
 */

import { getLang } from '../i18n';
import { PROTOCOL_EN } from '../i18n/protocol-en';
import { PROTOCOL_RATINGS_EN, SCORE_KEYS_EN } from '../i18n/protocol-ratings-en';

/** 协议显示名：中文模式 = `proto.name`；英文模式 = 卡面上的英文名（Water / Rigid） */
export function protocolName(proto: { readonly defId: string; readonly name: string }): string {
  if (getLang() !== 'en') return proto.name;
  const en = PROTOCOL_EN[proto.defId]?.name;
  return en !== undefined && en !== '' ? en : proto.name;
}

/** 协议座右铭：中文模式 = `proto.loadingText`；英文模式 = 卡面顶部那句（Wash away and renew） */
export function protocolMotto(proto: { readonly defId: string; readonly loadingText: string }): string {
  if (getLang() !== 'en') return proto.loadingText;
  const en = PROTOCOL_EN[proto.defId]?.motto;
  return en !== undefined && en !== '' ? en : proto.loadingText;
}

/** 协议关键词行（`·` 连接）：中文模式 = `proto.commands`；英文模式 = 卡面底部那行（Return · Draw · Flip） */
export function protocolKeywords(proto: { readonly defId: string; readonly commands: readonly string[] }): string {
  if (getLang() === 'en') {
    const en = PROTOCOL_EN[proto.defId]?.keywords;
    if (en !== undefined && en.length > 0) return en.join(' · ');
  }
  return proto.commands.join(' · ');
}

/**
 * 评分面板的四段正文 + 六维键名（2026-10-06 补的最后一处英文缺口）。
 *
 * 中文事实表是自动生成的 `src/data/protocolRatings.ts`（`review` / `pairs` / `styles` / `position`
 * 都是整段中文），英文显示串在 `src/i18n/protocol-ratings-en.ts`（用户让外部翻的）。
 * 与上面三个助手同一套契约：**中文模式逐字返回中文**；英文模式有英文就用、没有就回退中文。
 *
 * `table` 只给测试用（同 `play-prefs.ts` 的 `instantChoiceApplies(prompt, on?)`）：
 * 表里没有"空值条目"可用，不回退那一条分支就只能靠注入一张假表来真跑。
 */
type RatingsTable = typeof PROTOCOL_RATINGS_EN;

export function ratingPosition(defId: string, zh: string, table: RatingsTable = PROTOCOL_RATINGS_EN): string {
  if (getLang() !== 'en') return zh;
  const en = table[defId]?.position;
  return en !== undefined && en.trim() !== '' ? en : zh;
}

export function ratingReview(defId: string, zh: string, table: RatingsTable = PROTOCOL_RATINGS_EN): string {
  if (getLang() !== 'en') return zh;
  const en = table[defId]?.review;
  return en !== undefined && en.trim() !== '' ? en : zh;
}

/** `which` 只区分推荐搭配与推荐流派两张表 */
export function ratingList(defId: string, zh: readonly string[], which: 'pairs' | 'styles', table: RatingsTable = PROTOCOL_RATINGS_EN): readonly string[] {
  if (getLang() !== 'en') return zh;
  const en = table[defId]?.[which];
  return en !== undefined && en.length > 0 ? en : zh;
}

/** 六维键名（上手/强度/…）会直接画在评分条上 ⇒ 英文模式换成 Ease/Strength/… */
export function ratingScoreKey(zhKey: string, table: Readonly<Record<string, string>> = SCORE_KEYS_EN): string {
  if (getLang() !== 'en') return zhKey;
  const en = table[zhKey];
  return en !== undefined && en.trim() !== '' ? en : zhKey;
}
