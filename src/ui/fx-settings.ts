/**
 * ★ 2026-09-30（用户要求）：**首页「设置」里的特效开关**。
 *
 * 现在只有一项：**金属6 的频闪特效**（手牌里那张 metal-6 牌面循环渐现 `man.png`）开关，
 * **默认开启**；关掉之后那个特效不再出现，且**不影响任何其它卡牌的特效**。
 *
 * 消费点只有一处：`src/ui/render.ts` 的 `syncMetal6Mans()` —— 关掉时它把已挂的层清掉并直接返回。
 *
 * ## ★ 2026-10-01（用户要求）：状态**落本机**（原来是"只在内存"）
 *
 * 用户原话：「我希望设置里的选项都能够保存为持久化的数据，就和玩家名一样存储至本地，
 * 下次进入时能够随时响应」。⇒ 照**语言那一套**做（`src/app/local-store.ts` 的
 * `readLang` / `writeLang`）：
 *
 *  - **存储位置**：同一个 `L1_SETTINGS`（`compile-settings`）对象里的字段 `fx`，**不新增键**
 *    （与 `nick` / `lang` 同住一份设置）；
 *  - **读侧守卫**：`readFxSettings`（`src/app/local-store.ts`）逐字段判形状，坏值一律退回默认；
 *  - **授权门控**：写走同一套 `writeSettings`（游客模式 ⇒ 内存 KV ⇒ 本次会话有效、刷新即丢、
 *    磁盘零写入），与昵称/语言是同一条路；
 *  - **写失败**：回**结构化** `WriteResult`，界面按原因给本地化文案（复用 `saveFailedText`）。
 *
 * ⚠️ 本文件仍然**不碰存储**（它只持有内存态）：读写在 `src/app/local-store.ts`，界面在
 * `src/ui/home.ts`，启动时读一次由 `src/main.ts` 接线 —— 与语言完全同构。
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

/** 每一项的**默认值**（"清除本机数据"/"读不出来"时回落到这里） */
export const FX_DEFAULTS: Readonly<Record<string, boolean>> = { 'metal6-strobe': true };

/** 所有特效开关的**内存态**（键 = `FxSettingDef.id`；缺项按默认值算） */
const state: Record<string, boolean> = { ...FX_DEFAULTS };

/** 某一项现在开着吗（未知 id ⇒ `false`，与"这项不存在"同义） */
export function isFxSettingOn(id: string): boolean {
  return state[id] ?? FX_DEFAULTS[id] ?? false;
}

/** 开/关某一项（**只改内存态**；落盘是宿主的事，见文件头注） */
export function setFxSetting(id: string, on: boolean): void {
  state[id] = on;
}

/** 金属6 的频闪特效现在还开着吗（`isFxSettingOn` 的具名包装，消费点只认它） */
export function isMetal6StrobeOn(): boolean {
  return isFxSettingOn('metal6-strobe');
}

/** 开/关金属6 的频闪特效（`setFxSetting` 的具名包装） */
export function setMetal6Strobe(on: boolean): void {
  setFxSetting('metal6-strobe', on);
}

/**
 * 启动时**从本机设置里读回**（由 `src/main.ts` 在 `initI18n` 旁边调一次）。
 *
 * 入参刻意收宽（`unknown`）：调用方塞进来的就是 `readFxSettings()` 的原样结果
 * （它自己已经做过形状守卫），这里再按**同一个默认表**兜一次 ——
 * 于是"存储坏掉/被外部手改"永远退化成默认值，而不是把特效弄成半个开半个关。
 */
export function applyFxSettings(stored: unknown): void {
  for (const def of FX_SETTINGS) {
    const v = (typeof stored === 'object' && stored !== null)
      ? (stored as Record<string, unknown>)[def.id]
      : undefined;
    state[def.id] = typeof v === 'boolean' ? v : (FX_DEFAULTS[def.id] ?? false);
  }
}

/** 测试用：复位成默认（生产路径不会用到） */
export function resetFxSettingsForTest(): void {
  applyFxSettings(undefined);
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
