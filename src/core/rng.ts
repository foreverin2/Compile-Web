/**
 * 确定性随机源（G0；见 docs/2026-09-13-联机与多端-设计稿.md §2.3）。
 *
 * 两类派生，用途不同，不可混用：
 *  - 命名流派生 deriveInt(seed, label, bound)：与调用顺序无关。用于"必须先生成结果、
 *    再把它演算出来"的开局派生（掷硬币、随机池）—— 计算时机不会影响结果。
 *  - 顺序流派生 nextValue/nextInt/pickFrom/shuffleArr(r, ...)：原地推进 r.n。
 *
 * 值 = f(seed, key) 是纯函数，没有内部可变状态 → "中途存盘再恢复"天然安全
 * （只要 r.n 随状态一起序列化）。
 *
 * 铁律：本文件不得使用 Math.random / Date.now / crypto.* —— 否则整套确定性失效。
 * 平台层的种子来源见 src/ui/match-seed.ts。
 */

/** 随机源状态：必须进 GameState，因此进状态指纹 */
export interface RngState {
  seed: string;
  /** 已消耗次数 */
  n: number;
}

/** FNV-1a 32 位字符串哈希 */
export function hash32(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32：纯整数运算，跨 JS 引擎一致 */
function mulberry32(a: number): number {
  let t = (a + 0x6d2b79f5) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** 值 = f(seed, key)：同参恒同值，无内部状态 */
function streamValue(seed: string, key: string): number {
  return mulberry32(hash32(`${seed}|${key}`));
}

/** 命名流派生：与调用顺序无关 */
export function deriveInt(seed: string, label: string, bound: number): number {
  if (!Number.isFinite(bound) || bound <= 0) return 0;
  return Math.floor(streamValue(seed, `@${label}`) * bound);
}

/** 顺序流派生：推进 r.n，返回 [0,1) */
export function nextValue(r: RngState): number {
  const v = streamValue(r.seed, `#${r.n}`);
  r.n += 1;
  return v;
}

/** 顺序流派生：返回 [0, bound) */
export function nextInt(r: RngState, bound: number): number {
  if (!Number.isFinite(bound) || bound <= 0) return 0;
  return Math.floor(nextValue(r) * bound);
}

/** 从数组确定性取一个；空数组返回 undefined（不推进 n） */
export function pickFrom<T>(r: RngState, arr: readonly T[]): T | undefined {
  if (arr.length === 0) return undefined;
  return arr[nextInt(r, arr.length)];
}

/** 确定性洗牌：返回新数组，不修改入参 */
export function shuffleArr<T>(r: RngState, arr: readonly T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = nextInt(r, i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
