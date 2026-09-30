/**
 * ★ 2026-09-30（用户要求）：**首页「设置」里的特效开关**。
 *
 * 现在只有一项：**金属6 的频闪特效**（手牌里那张 metal-6 牌面循环渐现 `man.png`）开关，
 * **默认开启**；关掉之后那个特效不再出现，且**不影响任何其它卡牌的特效**。
 *
 * 状态**只在内存**（用户口径是"默认开启"，刷新回默认即可；不往磁盘写东西）。
 * 消费点只有一处：`src/ui/render.ts` 的 `syncMetal6Mans()` —— 关掉时它把已挂的层清掉并直接返回。
 */
export interface FxSettingDef {
  readonly id: string;
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

/** 设置页要渲染的条目（顺序即屏上顺序） */
export const FX_SETTINGS: readonly FxSettingDef[] = [
  {
    id: 'metal6-strobe',
    label: '金属6 频闪特效',
    desc: '手牌里的金属6 牌面会循环渐现一张图。关掉之后不再显示，其它卡牌的特效不受影响。',
  },
];
