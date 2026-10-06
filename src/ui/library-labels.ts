/**
 * ★ 2026-10-06（用户要求）：图鉴「按效果分类筛选」那一栏的**标签/分组显示名按语言取**。
 *
 * 中文事实在 `src/data/cardEffectTags.ts`（自动生成，勿手改）；英文在
 * `src/i18n/effect-tags-en.ts`。**取哪一份只在这里判一次** —— 与
 * `src/ui/protocol-text.ts` 同一条纪律：屏上多一个地方自己写三元，就多一处会漂的分叉。
 *
 * 契约（与 `protocol-text.ts` 逐字同款）：
 *  - 中文模式：逐字返回传入的中文名（改动前一个字都不差）；
 *  - 英文模式：查得到就用英文，查不到**回退中文**（宁可显示中文，也不显示空串或 id）。
 */

import { getLang } from '../i18n';
import { EFFECT_TAG_EN, EFFECT_TAG_GROUP_EN } from '../i18n/effect-tags-en';

/** 一个效果标签的显示名（`tag.label` 是中文事实；英文按 `tag.id` 查表） */
export function effectTagLabel(tag: { readonly id: string; readonly label: string }): string {
  if (getLang() !== 'en') return tag.label;
  const en = EFFECT_TAG_EN[tag.id];
  return en !== undefined && en !== '' ? en : tag.label;
}

/** 一个分组（`触发时机` / `效果动作` …）的显示名 */
export function effectTagGroupLabel(group: string): string {
  if (getLang() !== 'en') return group;
  const en = EFFECT_TAG_GROUP_EN[group];
  return en !== undefined && en !== '' ? en : group;
}
