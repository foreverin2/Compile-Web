import type { CardEffects } from '../models/types';

/** 卡牌效果注册表：defId → 中指令/触发效果（Fire 效果在 cards/fire.ts 注册） */
export const EFFECTS: Record<string, CardEffects> = {};

export function registerCardEffects(defId: string, effects: CardEffects): void {
  EFFECTS[defId] = effects;
}
