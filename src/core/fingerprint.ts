/**
 * 状态指纹（G0；见 docs/2026-09-13-联机与多端-设计稿.md §2.6）。
 *
 * 用途：确定性测试台（D1~D4）比对、以及将来联机时的分歧检测。
 * 信任制下不需要密码学强度，只需要"能稳定地指出两个状态是否相同"。
 *
 * 已知盲点（2026-09-13 裁决：接受并写明）：`pendingEffects[].gen` 是活的 Generator
 * （types.ts:237，由 resolve.ts:223 的 pe.gen.next() 驱动），Object.keys(generator) 为 []
 * → 它在指纹里恒为 {}，**挂起效果的内部进度不进指纹**。缓解：效果每执行一步都会 pushLog，
 * 而 log 已纳入指纹，故进度差异绝大多数会被 log 捕获；整局层面的兜底由 D4 的两次独立重跑承担。
 *
 * 同理：**状态只有在「效果栈与落牌队列全空」时才是可序列化的** —— JSON.stringify 会把挂起的
 * generator 变成 {}，恢复后再 .next() 直接抛 TypeError。存档/重连按「种子 + 操作重放」实现，
 * 不依赖中途快照，故不受影响。
 */

import type { GameState } from './models/types';
import { hash32 } from './rng';

/** 稳定序列化：对象键排序、数组保序。用于指纹与联机校验。 */
export function stableStringify(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  const obj = v as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

/** FNV-1a 32 位拼两段做 64 位，降低碰撞概率 */
export function hash64(text: string): string {
  const a = hash32(text);
  const b = hash32(`${text}#${a}`);
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
}

/** 状态指纹。全部字段纳入（含 log / rng.n / nextUid）——它们都是确定性的。 */
export function stateFingerprint(s: GameState): string {
  return hash64(stableStringify(s));
}
