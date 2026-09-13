/**
 * 新对局种子（G0）。平台层职责：core 必须保持纯确定性，只接受种子、不生产种子。
 * 这是全项目**唯一**允许的种子随机来源。
 */
export function newMatchSeed(): string {
  const c = globalThis.crypto;
  if (c && typeof c.getRandomValues === 'function') {
    const bytes = new Uint8Array(16);
    c.getRandomValues(bytes);
    let out = '';
    for (const b of bytes) out += b.toString(16).padStart(2, '0');
    return out;
  }
  // 兜底：旧 Node 没有 globalThis.crypto
  return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}
