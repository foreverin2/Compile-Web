import { ALL_PROTOCOLS, ALL_CARD_DEFS } from './cards';
import { ALL_PROTOCOLS_2, ALL_CARD_DEFS_2 } from './cards2';
import type { CardDef, ProtocolDef } from '../core/models/types';

/**
 * 演示草案池 = 1代 + 2代 全部 30 套协议（MN01×12 + AX01×3 + MN02×12 + AX02×3）。
 *
 * 2026-09-03 用户拍板：2代（MN02 英文版）「直接并入协议选择池」（30 套混选）。
 * 注意：2代 90 张卡的效果尚未实现（EFFECTS 未注册）——引擎对未注册卡牌安全空转
 * （resolve/triggers 均 `EFFECTS[defId]?.middle/triggers` 可选链），可正常打出/编译
 * （分值/编译按数据走），但该卡文本无实际效果；后续按协议分任务补齐效果。
 *
 * 卡面/协议图资源扩展名随世代：1代（MN01/AX01，官方 TTS PNG）→ .png；
 * 2代（MN02/AX02，英文版扫描）→ .jpg。UI 取图一律走 cardImgSrc/protocolImgSrc。
 */
export const DEMO_PROTOCOLS: ProtocolDef[] = [...ALL_PROTOCOLS, ...ALL_PROTOCOLS_2];
export const DEMO_CARD_DEFS: CardDef[] = [...ALL_CARD_DEFS, ...ALL_CARD_DEFS_2];

export { ALL_PROTOCOLS, ALL_CARD_DEFS, ALL_PROTOCOLS_2, ALL_CARD_DEFS_2 };

const cardIndex = new Map([...ALL_CARD_DEFS, ...ALL_CARD_DEFS_2].map((c) => [c.defId, c]));
const protocolIndex = new Map([...ALL_PROTOCOLS, ...ALL_PROTOCOLS_2].map((p) => [p.defId, p]));

export function getCardDef(defId: string): CardDef {
  const def = cardIndex.get(defId);
  if (!def) throw new Error(`unknown card def: ${defId}`);
  return def;
}

export function getProtocolDef(defId: string): ProtocolDef {
  const def = protocolIndex.get(defId);
  if (!def) throw new Error(`unknown protocol def: ${defId}`);
  return def;
}

/** 协议资源扩展名（世代规则）：MN01/AX01 → png；MN02/AX02 → jpg；未知 defId 兜底 png */
export function protocolImgExt(defId: string): 'png' | 'jpg' {
  const def = protocolIndex.get(defId);
  if (!def) return 'png';
  return def.set === 'MN02' || def.set === 'AX02' ? 'jpg' : 'png';
}

/** 指令卡正面图 src：/assets/protocols/<协议>/card-<分值>.<png|jpg> */
export function cardImgSrc(protocol: string, value: number | string): string {
  return `/assets/protocols/${protocol}/card-${value}.${protocolImgExt(protocol)}`;
}

/** 协议卡 src：/assets/protocols/<defId>/protocol-<loading|compiled>.<png|jpg> */
export function protocolImgSrc(defId: string, compiled: boolean): string {
  return `/assets/protocols/${defId}/protocol-${compiled ? 'compiled' : 'loading'}.${protocolImgExt(defId)}`;
}
