import type { GameState } from '../models/types';

export interface GameEvent {
  type: string;
  state: GameState;
  payload?: unknown;
}

export interface EventBus {
  subscribe(fn: (e: GameEvent) => void): () => void;
  emit(e: GameEvent): void;
}

export function createBus(): EventBus {
  const subs = new Set<(e: GameEvent) => void>();
  return {
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
    emit(e) {
      for (const fn of [...subs]) fn(e);
    },
  };
}

/** 全局游戏事件总线单例：引擎发语义事件（card:discarded 等），UI 特效层订阅 */
export const gameBus = createBus();
