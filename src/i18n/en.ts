/**
 * 英文文案表（★ 2026-10-01，P0：i18n 基建）。
 *
 * ## 口径
 *
 * 1. **键集与 `zh.ts` 完全一致**（`tests/i18n/tables.test.ts` 的表完整性腿逐键比对）：
 *    这里少一条、多一条、值写成空串都会报红。逐屏抽取（P3）时两张表**同时**加键。
 * 2. **写"说人话的英文"**，不写机翻腔：短句、动词开头、不用被动语态堆叠。
 * 3. **术语按用户 2026-10-01 拍板的对照表**（别自创）：
 *    协议 = Protocol、卡牌 = Card、链路/线 = Line、阈值 = Threshold、控制权 = Control、
 *    编译 = Compile、草稿 = Deck draft、热座 = Hotseat、联机 = Online match、
 *    牌库 = Deck、弃牌堆 = Discard、回手 = Return、偏转 = Shift、翻转 = Flip、
 *    覆盖 = Cover、数值 = Value。
 * 4. **卡牌文本不进这张表**（`src/data/cards*.ts` 的中文是数据，被 `texts:check` 与联机
 *    卡文哈希逐字钉住）；英文卡面走以后 P4 的显示层翻译表（按 `defId` 映射）。
 *
 * ## 现在这一屏的内容
 *
 * P0 只抽「设置小窗」这一屏作第一个真实消费者 —— 下面 `settings.*` 就是它的全部文案。
 * 其余屏的抽取排期与清单见 `docs/2026-10-01-i18n-尚未抽取的屏.md`。
 */

export const EN: Readonly<Record<string, string>> = {
  /* ── Settings dialog (the only screen extracted in P0) ── */
  'settings.title': 'Settings',
  'settings.close': 'Close',
  'settings.aria': 'Settings',
  // 与中文表同一口径：两个选项名（`中文` / `English`）来自 `src/i18n/lang.ts` 的 `LANGS`，
  // 不进文案表 —— 它们不该跟着当前语言变。
  'settings.lang': '语言 / Language',
  'settings.lang.hint': 'Your language choice is saved on this device and stays after a reload.',
  // Shown only when the browser storage refuses the write (private mode / quota).
  'settings.lang.save-failed':
    'The language could not be saved on this device. This session still uses it; '
    + 'a reload goes back to the last saved one.',
  'settings.lang.save-failed-detail':
    'The language could not be saved on this device ({detail}). This session still uses it; '
    + 'a reload goes back to the last saved one.',
  'settings.hint': 'Changes last for this session only; a reload turns the flash effect back on.',
  'settings.fx.on': 'on',
  'settings.fx.off': 'off',
  // 就地改写的形态：`{desc} (currently: {state})`
  'settings.fx.state': '{desc} (currently: {state})',
  'settings.fx.metal6.label': 'Metal 6 strobe effect',
  'settings.fx.metal6.desc':
    'The Metal 6 card in your hand fades a picture in on a loop. Turn this off to hide it; '
    + 'other cards keep their effects.',
};
