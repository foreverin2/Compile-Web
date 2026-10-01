/**
 * 确定性 PRNG + 字符串哈希（纯函数）。
 *
 * 2026-10-01：移植自参考项目 COMPILER · Card Builder（作者 Albert Blanco，MIT 许可，
 * https://github.com/albrtbc/compiler）的 `src/core/rng.js`。
 *
 * 本项目**没有**移植那个"前脸 glitch（数据摩什）"效果，但这两个函数留下了一个正当用途：
 * 生成稳定的卡 id（同一份内容重复导入时得到同一个 id）。所以它不是死代码 ——
 * `newCardId()` 是它唯一的调用点。
 */

/** mulberry32：返回一个产出 [0,1) 浮点数的函数。同一个种子 ⇒ 同一个序列。 */
export function mulberry32(a: number): () => number {
  return function next(): number {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a 32 位哈希：字符串 → 无符号整数 */
export function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
