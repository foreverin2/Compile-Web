/**
 * 新对局种子（G0）。平台层职责：core 必须保持纯确定性，只接受种子、不生产种子。
 * 这是全项目**唯一**允许的种子随机来源。
 *
 * G5 T11-A：本文件同时给出 `newRandomToken(bytes)` —— 联机大厅要的那条**真随机串**
 * （承诺流程的 salt / 面承诺的 nonce）。过去它们写的是 HEAD 上那三条模板串：
 * 房主那对 `` `seed-${opts.sessionId}` `` 与 `` `salt-${opts.sessionId}` ``、
 * 加入方 `` `nonce-${opts.sessionId}` ``（I-5：`sessionId` 明文写在邀请码里 ⇒ 加入方能提前算出种子）。
 * 全项目只有这里可以取熵，所以"要一条随机串"这件事也只有这一个口子。
 */
export function newRandomToken(bytes = 16): string {
  const c = globalThis.crypto;
  if (c && typeof c.getRandomValues === 'function') {
    const buf = new Uint8Array(bytes);
    c.getRandomValues(buf);
    let out = '';
    for (const b of buf) out += b.toString(16).padStart(2, '0');
    return out;
  }
  // 兜底：旧 Node 没有 globalThis.crypto
  let out = '';
  while (out.length < bytes * 2) out += Math.random().toString(36).slice(2);
  return out.slice(0, bytes * 2);
}

/**
 * 本局种子。导出名、缺省字节数（16）、返回形状（小写 hex）与"两次调用不同"的行为都不变，
 * `main.ts` 的两处调用点一个字符都不用动。
 *
 * ⚠️ 与搬迁前**唯一**的差别：没有 `globalThis.crypto` 时（老 Node）走的是同一条兜底
 * `Math.random` 分支，但拼串循环统一到 `newRandomToken` 上了 ⇒ 兜底串的**长度**由"两段
 * base36"变成"补齐到 bytes*2 个字符"。真浏览器与 Node 22 都走 `getRandomValues`，
 * 那一条兜底不在任何门禁路径上；这条差别如实记在这里，不在测试里假装它不存在。
 */
export function newMatchSeed(): string {
  return newRandomToken(16);
}
