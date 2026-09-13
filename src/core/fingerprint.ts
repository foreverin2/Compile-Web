/**
 * 状态指纹（G0；见 docs/2026-09-13-联机与多端-设计稿.md §2.6）。
 *
 * 用途：确定性测试台（D1~D4）比对、以及将来联机时的分歧检测。
 * 信任制下不需要密码学强度，只需要"能稳定地指出两个状态是否相同"。
 *
 * 已知盲点（2026-09-13 裁决：接受并写明）：`pendingEffects[].gen` 是活的 Generator
 * （types.ts:237，由 resolve.ts:223 的 pe.gen.next() 驱动），Object.keys(generator) 为 []
 * → 它在指纹里恒为 {}，**挂起效果的内部进度不进指纹**。真正的保障是效果每执行一步都会
 * pushLog 而 log 已进指纹（进度差异绝大多数会被 log 捕获）；D4（12 个种子各跑两遍 +
 * 60 个种子录制-重放）提供整局层面的证据 —— 但注意两次确定性重跑发现不了两次共有的盲点。
 *
 * 同理：**状态只有在「效果栈与落牌队列（pendingPlay / pendingShift）全空」时才是可序列化的**
 * —— JSON.stringify 会把挂起的 generator 变成 {}，恢复后再 .next() 直接抛 TypeError。
 * 存档/重连按「种子 + 操作重放」实现，不依赖中途快照，故不受影响。
 *
 * undefined 语义：值为 undefined 的键被省略，与 JSON.stringify 一致（见下面的 filter 注释）。
 * 这消除了「显式赋 undefined」与「JSON 往返后丢键」之间的指纹差异。
 * 已知限制：覆盖的是**对象自身可枚举键**；**数组元素为 undefined 的情形不在覆盖内**
 * —— `[undefined]` 与 `[null]` 经 stableStringify 后仍不可区分。当前 `src/core` 不可达
 * （Task 5 第三轮评审确认），故只记录、不加运行时防护。
 */

import type { GameState } from './models/types';
import { hash32 } from './rng';

/** 稳定序列化：对象键排序、数组保序。用于指纹与联机校验。 */
export function stableStringify(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  const obj = v as Record<string, unknown>;
  // 跳过值为 undefined 的键 —— 与 JSON.stringify 语义一致，且**必须**一致：
  // 引擎会把可选字段显式赋成 undefined（rigidity.ts 的 `s.pendingActionPlayLine = undefined`），
  // 若这里保留该键就会得到 `"k":null`，而 JSON 往返会把它丢掉 →
  // 同一语义状态往返前后指纹不同，直接打穿 D2 的不变式。
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

/** FNV-1a 32 位拼两段做 64 位，降低碰撞概率 */
export function hash64(text: string): string {
  const a = hash32(text);
  const b = hash32(`${text}#${a}`);
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
}

/** 状态指纹。全部字段纳入（含 log / rng.n / nextUid / nextEffectId）——它们都是确定性的。 */
export function stateFingerprint(s: GameState): string {
  return hash64(stableStringify(s));
}
