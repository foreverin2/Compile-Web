/**
 * 协议已编译主题色表（UI 共用）：
 * - 已编译协议「多元 diversity」的 5 色交替取自场上其它已编译协议的边框色（render.ts
 *   syncDiversityColors）；
 * - 多项卡牌触发特效需要「该卡所属协议的主题色」（多元抽取光晕 / 多元3 链路微光等，
 *   fx-gen2.ts、render.ts 共用）。
 * 颜色与 styles.css 各协议 `.compiled-ring-<defId>` / `.compiled-<defId>-corner` 对齐。
 * 独立成模块避免 render.ts ↔ fx-gen2.ts 互相 import 形成环。
 */

export const COMPILED_PROTOCOL_COLORS: Record<string, string> = {
  // 1代 MN01/AX01
  fire: '#ff6a00', light: '#ffe066', darkness: '#45454f', life: '#3ddc84', water: '#4fb4ff',
  death: '#a142f0', spirit: '#9b5cff', gravity: '#e03ce6', psychic: '#a34fd6', plague: '#178a47',
  metal: '#b9bec9', speed: '#cdd2dd', love: '#ff5fa2', hate: '#c81f35', apathy: '#9b9ea9',
  // 2代 MN02/AX02（diversity 自身不算——取色时排除）
  luck: '#ff9a2e', mirror: '#e2e8f5', peace: '#37a6e0', chaos: '#7a4fe8', clarity: '#e58ac4',
  ice: '#3d9ad9', smoke: '#7a7a88', fear: '#ff6e1e', corruption: '#2f9e5a', war: '#e02222',
  courage: '#e8b13a', time: '#b07f3e', assimilation: '#2ec9a8', unity: '#3d8bff',
  diversity: '#c07bff',
};

/** 协议主题色（defId 形如 'diversity-3' / 'fire-0'；未知协议给中性紫） */
export function protocolColorOf(defIdOrProtocol: string): string {
  const proto = defIdOrProtocol.includes('-') ? defIdOrProtocol.split('-')[0] : defIdOrProtocol;
  return COMPILED_PROTOCOL_COLORS[proto] ?? '#c07bff';
}

/** hex（#rgb / #rrggbb）→ rgba(r, g, b, a) */
export function hexToRgba(hex: string, a: number): string {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}
