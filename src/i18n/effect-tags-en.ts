/**
 * ★ 2026-10-06（用户要求）：「英文模式下不该还显示中文文本」——**图鉴按效果分类筛选**那一栏的
 * 30 个标签 + 5 个分组名的英文。
 *
 * ## 为什么单独一份、而不是改生成物
 *
 * 中文标签来自**自动生成**的 `src/data/cardEffectTags.ts`（`node tools/card-effect-index.mjs
 * --write-tags` 的产物，文件头写着"勿手改"）：它是**事实层**（哪张卡命中哪个标签的口径），
 * 中文名是那份口径的一部分（`tests/data/card-effect-tags.test.ts` 与索引脚本都读它）。
 * ⇒ 英文**只做显示**：在这里按 `tag.id` / 分组名查表，中文模式一个字都不变
 * （取值判据只有 `src/ui/library-labels.ts` 一处）。
 *
 * ## 命名口径
 *
 * 尽量用**卡面上已有的英文词**（Flip / Shift / Delete / Return / Draw / Prevent / Rearrange…），
 * 与 `src/i18n/protocol-en.ts` 的关键词表同源；卡面上没有对应词的分组（触发时机 / 指令位置）
 * 按桌游玩家的通用说法写（On play / Start of turn / Top command…）。
 */

/** 标签 id → 英文名（30 条，与 `CARD_EFFECT_TAGS` 逐条对应） */
export const EFFECT_TAG_EN: Readonly<Record<string, string>> = {
  // 指令位置
  'dir-top': 'Top command',
  'dir-middle': 'Middle command',
  'dir-bottom': 'Bottom command',
  // 触发时机
  'trig-play': 'Resolves when played',
  'trig-start': 'Start of turn',
  'trig-end': 'End of turn',
  'trig-before-covered': 'Before covered',
  'trig-before-flip': 'Before flipped',
  'trig-before-compile': 'Before compile-delete',
  'trig-chain': 'Chain reaction',
  'trig-conditional': 'Conditional',
  'trig-hidden-top': 'Top command (works while covered)',
  'trig-control-gain': 'After opponent gains control',
  // 控制权
  'ctl-related': 'Control-related',
  // 其它
  'misc-opp-choice': 'Opponent chooses',
  'misc-restrict': 'Restrict / negate',
  'misc-declare': 'Declare (Luck)',
  // 效果动作
  'op-draw': 'Draw',
  'op-play': 'Play (deck top / hand / trash)',
  'op-flip': 'Flip',
  'op-copy': 'Copy middle command',
  'op-swap': 'Swap stacks',
  'op-return': 'Return to hand',
  'op-reveal': 'Reveal',
  'op-transfer': 'Card transfer (give / take / deck top / bottom)',
  'op-shift': 'Shift',
  'op-discard': 'Discard',
  'op-delete': 'Delete',
  'op-value': 'Value modifier',
  'op-rearrange': 'Rearrange protocols',
};

/** 分组名 → 英文（5 条） */
export const EFFECT_TAG_GROUP_EN: Readonly<Record<string, string>> = {
  指令位置: 'Command position',
  触发时机: 'Trigger timing',
  控制权: 'Control',
  其它: 'Other',
  效果动作: 'Effect actions',
};
