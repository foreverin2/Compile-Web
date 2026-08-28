import { ALL_PROTOCOLS, ALL_CARD_DEFS } from './cards';
import type { CardDef, ProtocolDef } from '../core/models/types';

/** 演示草案池：前 6 套（水 火 光 暗 生 死） */
const DEMO_PROTOCOL_DEF_IDS = new Set(['water', 'fire', 'light', 'darkness', 'life', 'death']);

export const DEMO_PROTOCOLS: ProtocolDef[] = ALL_PROTOCOLS.filter((p) => DEMO_PROTOCOL_DEF_IDS.has(p.defId));
export const DEMO_CARD_DEFS: CardDef[] = ALL_CARD_DEFS.filter((c) => DEMO_PROTOCOL_DEF_IDS.has(c.protocol));

export { ALL_PROTOCOLS, ALL_CARD_DEFS };

const cardIndex = new Map(ALL_CARD_DEFS.map((c) => [c.defId, c]));
const protocolIndex = new Map(ALL_PROTOCOLS.map((p) => [p.defId, p]));

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
