/**
 * ★ 2026-10-02（P2）：**教学进度的读写口**（教学层 → `LocalStore` 之间的那一层薄封装）。
 *
 * 为什么不直接让屏去调 `readTutorialProgress` / `writeTutorialProgress`：
 * 那两条是**纯层**的口（`src/app/local-store.ts`），只认 `string[]`；教学层认的是
 * `TutLevelId`。这一层做**类型收窄**（`string` → `TutLevelId`）与"下一关算哪一个"的规则，
 * 于是屏里不会散落 `as TutLevelId` 这种断言（本仓栽过"断言把错值放过去"的跟头）。
 *
 * ## 规则（唯一出处）
 *
 *  - **当前关** = 存储里的 `current`（合法就照用，非法由纯层回 `T0`）；
 *  - **过了一关** ⇒ 把它记进 `done`，并**把当前关推到下一关**（最后一关就停在最后一关）；
 *  - **"从头开始"** ⇒ `done` 清空、`current = 'T0'`（**不清别的设置**：昵称/语言/向导标记都不动）；
 *  - **清除本机数据** ⇒ 整个 `L1_SETTINGS` 被清掉 ⇒ 这里读回 `T0` + 空 `done`（方案 §6 要的正是这个）。
 *
 * ⚠️ 游客模式下这些写都只在内存（`LocalStore` 的口径）⇒ 刷新即丢，屏上不假装它持久。
 */
import {
  readTutorialProgress,
  writeTutorialProgress,
  type LocalStore,
} from '../app/local-store';
// `WriteResult` 的**家**是 `src/app/storage.ts`（`local-store.ts` 只是它的消费者）——
// 这里照它的出处 import，不从 `local-store` 转手（转手会多一条没必要的依赖边）。
import type { WriteResult } from '../app/storage';
import { TUT_LEVELS, levelIndex, levelAt } from './levels';
import type { TutLevelId } from './types';

/** 教学进度的**教学层**形状（关卡 id 已经收窄过） */
export interface TutProgressView {
  readonly done: readonly TutLevelId[];
  /** 下次进来从哪一关开始 */
  readonly current: TutLevelId;
  /** 全部关卡（当前 14 关）是不是都完成了 */
  readonly allDone: boolean;
}

/** 收窄：`string` → `TutLevelId`（不是合法 id 就返回 `null`，由调用方决定兜底） */
function asLevelId(v: string): TutLevelId | null {
  const hit = TUT_LEVELS.find((l) => l.id === v);
  return hit === undefined ? null : hit.id;
}

/** 读进度（读不出来 = 没玩过 ⇒ `T0` + 空 `done`） */
export function readProgress(store: LocalStore): TutProgressView {
  const raw = readTutorialProgress(store);
  const done = raw.done.map(asLevelId).filter((x): x is TutLevelId => x !== null);
  const current = asLevelId(raw.current) ?? 'T0';
  return { done, current, allDone: done.length === TUT_LEVELS.length };
}

/** 写进度（`done` 归一 + 当前关收窄都交给纯层那一条出口） */
export function writeProgress(
  store: LocalStore,
  progress: { readonly done: readonly TutLevelId[]; readonly current: TutLevelId },
): WriteResult {
  return writeTutorialProgress(store, { done: progress.done, current: progress.current });
}

/**
 * 过了一关：把它记进 `done`，并把当前关推到下一关。
 *
 * ⚠️ **最后一关过完停在最后一关**（`levelAt` 会钳住）⇒ 再进教学是"从 T3 重看"，
 * 而不是被钳到 `T0` 之外的地方。要重新从头玩有「从头开始」那一个按钮。
 */
export function advance(
  store: LocalStore,
  cleared: TutLevelId,
): { readonly done: readonly TutLevelId[]; readonly current: TutLevelId } {
  const now = readProgress(store);
  const done = now.done.includes(cleared) ? [...now.done] : [...now.done, cleared];
  const current = levelAt(levelIndex(cleared) + 1);
  return { done, current };
}

/** 「从头开始」：进度清空（**不动**昵称/语言/向导标记那些设置） */
export function restart(store: LocalStore): WriteResult {
  return writeProgress(store, { done: [], current: 'T0' });
}
