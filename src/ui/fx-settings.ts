/**
 * ★ 2026-09-30（用户要求）：**首页「设置」里的特效开关**。
 *
 * 现在只有一项：**金属6 的频闪特效**（手牌里那张 metal-6 牌面循环渐现 `man.png`）开关，
 * **默认开启**；关掉之后那个特效不再出现，且**不影响任何其它卡牌的特效**。
 *
 * 状态**只在内存**（用户口径是"默认开启"，刷新回默认即可；不往磁盘写东西）。
 * 消费点只有一处：`src/ui/render.ts` 的 `syncMetal6Mans()` —— 关掉时它把已挂的层清掉并直接返回。
 *
 * ★ 2026-10-01（P0，i18n）：这一项的两条文案搬进了 `src/i18n/` 的两张表（键名见下面
 * `FX_SETTINGS` 的注释）；**状态机与消费点一个字都没动**（`fx-settings.ts` 不是红线文件，
 * 但也没必要动它那三个函数）。
 */
export interface FxSettingDef {
  readonly id: string;
  /**
   * ★ 2026-10-01（P0，i18n）：这两个字段现在**只是文档**（这个条目叫什么、讲什么），屏上的
   * 文案**不从这里取**。
   *
   * ⚠️ **真正的文案键写在 `src/ui/home.ts` 的 `fxDescText()` / `fxLabelText()` 里**
   * （两个 `t('…')` 字面量）。为什么把键挪到调用点、而不是留在这里由 `t(def.desc)` 取：
   * i18n 的缺键扫描腿（`tests/i18n/tables.test.ts`）按**静态第一实参**提取键 ——
   * `t(def.desc)` 传的是变量，那个键就从判据面里消失，"漏翻"会重新变成静默的。
   * 那条腿是 P3 逐屏抽取期间唯一的机械保障，所以这里为它让一步。
   *
   * 下面的值与 `src/i18n/zh.ts` 里那两条**逐字相同**（`tests/i18n/settings-overlay.test.ts`
   * 有一条腿把这三处钉在一起：这里的值 = 中文表的值 = 屏上画出来的值）。
   */
  readonly label: string;
  readonly desc: string;
}

let metal6Strobe = true; // ★ 默认开启

/** 金属6 的频闪特效现在还开着吗 */
export function isMetal6StrobeOn(): boolean {
  return metal6Strobe;
}

/** 开/关金属6 的频闪特效 */
export function setMetal6Strobe(on: boolean): void {
  metal6Strobe = on;
}

/** 测试用：复位成默认（生产路径不会用到） */
export function resetFxSettingsForTest(): void {
  metal6Strobe = true;
}

/**
 * 设置里要渲染的条目（顺序即屏上顺序）。
 *
 * ★ 2026-10-01（P0，i18n）：`label` / `desc` 是**文档性的中文原文**（屏上取的是
 * `src/i18n/` 的两张表，键写在 `src/ui/home.ts` 的 `fxLabelText()` / `fxDescText()` 里）。
 * 这两个值与 `src/i18n/zh.ts` 的那两条逐字相同 —— 由 `tests/i18n/settings-overlay.test.ts`
 * 的一条腿钉住（三处：这里、中文表、屏上画出来的）。
 */
export const FX_SETTINGS: readonly FxSettingDef[] = [
  {
    id: 'metal6-strobe',
    label: '金属6 频闪特效',
    desc: '手牌里的金属6 牌面会循环渐现一张图。关掉之后不再显示，其它卡牌的特效不受影响。',
  },
];
