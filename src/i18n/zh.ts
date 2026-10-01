/**
 * 中文文案表（★ 2026-10-01，P0：i18n 基建的第一步）。
 *
 * ## 这张表的硬口径（不是风格偏好，是门禁逼出来的）
 *
 * 1. **值与现状逐字一致**：`settings.*` 这几条就是 `src/ui/home.ts` 的
 *    `settingsOverlayElement()` 里那些中文字面量的原文，一个字都不许改。
 *    仓库里有几十条测试逐字钉住中文按钮/文案，P0 不许让它们变红
 *    （`tests/ui/local-data-screen.test.ts` 第 9 组就钉着 `关闭` 与 `改动只在本次会话有效…`）。
 *    `tests/i18n/tables.test.ts` 有一条腿把这件事做成机检：把 `zh` 表里这几条值直接塞进
 *    `t()`，与既有屏上出现的字面量逐字节比对。
 * 2. **只放 UI 文案，不放卡牌文本**：`src/data/cards*.ts` 的中文是**数据**，被
 *    `npm run texts:check` 与联机卡文哈希逐字钉住；英文卡面是以后 P4 的"显示层翻译表"
 *    （按 `defId` 映射、只在渲染时替换），**不进这张表**。
 * 3. **键集必须与 `en.ts` 完全一致**：`tests/i18n/tables.test.ts` 的"表完整性腿"逐键比对，
 *    多一条少一条都报红。逐屏抽取（P3）每抽一屏就往两张表里**同时**加键。
 *
 * ## 命名
 *
 * 键名 `屏.元素[.变体]`，全小写点分：`settings.title` / `settings.fx.metal6.desc`。
 * 同一个键在两张表里的位置必须对应 —— 表还是人读的，别为了"少写几行"把两张表的结构写歪。
 *
 * ## 为什么这里是"扁平 Record"而不是嵌套对象
 *
 * `t('settings.title')` 这种点分键在**缺键扫描腿**（扫 `src/**` 的 `t('…')` 调用）里是
 * 可以纯文本提取的：嵌套对象会逼那条腿长出"按点分路径走对象"的第二套实现，而两套实现
 * 一旦漂移，漏翻就重新变成静默的。代价是这里是一张平表，可接受。
 */

export const ZH: Readonly<Record<string, string>> = {
  /* ── 设置小窗（P0 唯一抽取的屏；值必须与改动前的字面量逐字一致） ── */
  'settings.title': '设置',
  'settings.close': '关闭',
  'settings.aria': '设置',
  // 「语言 / Language」：这一行**一个键**就够 —— 两个选项名（`中文` / `English`）来自
  // `src/i18n/lang.ts` 的 `LANGS`（语言清单的唯一出处），**刻意不进文案表**：
  // 选项名是给"看不懂当前语言的人"看的，它不该跟着当前语言变（切到英文后中文选项若写成
  // "Chinese"，中文玩家就找不回来了）。
  'settings.lang': '语言 / Language',
  'settings.lang.hint': '语言会保存到本机，刷新后仍然生效。',
  // 写盘失败时的两句（玩法不变：本次会话仍然生效，只是刷新会回到上次保存的那种）。
  // ⚠️ 这两句是**状态/错误报告**形态，不是对玩家的隐私承诺 —— 见
  // `tests/ui/privacy-consumers.test.ts` 的两层判据（它只对 import 了 `privacy.ts` 的
  // 消费方生效，而 `home.ts` 不是消费方；这里如实标注口径，免得以后有人误会）。
  'settings.lang.save-failed': '语言没能保存到本机。本次会话仍然用这种语言，刷新后会回到上次保存的那种。',
  'settings.lang.save-failed-detail': '语言没能保存到本机（{detail}）。本次会话仍然用这种语言，刷新后会回到上次保存的那种。',
  'settings.hint': '改动只在本次会话有效，刷新后回到默认开启。',
  'settings.fx.on': '开启',
  'settings.fx.off': '关闭',
  // 开关说明的就地改写形态：`{desc}（当前：{state}）`
  'settings.fx.state': '{desc}（当前：{state}）',
  'settings.fx.metal6.label': '金属6 频闪特效',
  'settings.fx.metal6.desc': '手牌里的金属6 牌面会循环渐现一张图。关掉之后不再显示，其它卡牌的特效不受影响。',
};
