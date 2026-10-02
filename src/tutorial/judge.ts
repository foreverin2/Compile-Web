/**
 * ★ 2026-10-02（P2）：**关卡判定**（纯函数，零 DOM / 零存储 / 零引擎调用）。
 *
 * ## 判定分两类
 *
 *  - **T0**：不看引擎状态，看"四个热点点过没有"（`spotsDone`）；
 *  - **T1~T3**：看**引擎状态**（方案 §5.2 那一列的字面要求："通过判据（状态断言）"）。
 *    T3 的"五个动作各做一次"不是记"玩家点了哪个按钮"，而是对**前后两份快照做差分**
 *    ——`observedOps()` 只认"状态真的变了什么"。理由：引擎与渲染器都是红线（不许改），
 *    本屏拿不到"这一步执行了哪个 op"的内部事件，只能从状态反推。
 *
 * ## 快照只取判定用得上的那几样
 *
 * `uid → { owner, faceUp, zone, line }` + 每个玩家的手牌/牌库/弃牌堆**张数**。
 * 刻意**不比分值、不比卡面文本**：判定只回答"这五个动作发生过没有"，
 * 掺进别的量只会让判据更难解释（也就更难被反向验证）。
 */
import type { Card, GameState, PlayerId } from '../core/models/types';
import type { TutLevelId, TutOp, TutSpot } from './types';
import type { TutLevel } from './levels';

/** 一张卡在快照里的样子（只留判定要用的字段） */
export interface TutCardSnap {
  readonly owner: PlayerId;
  readonly faceUp: boolean;
  readonly zone: Card['zone'];
  readonly line: number | null;
}

/** 一份局面快照 */
export interface TutSnap {
  readonly cards: ReadonlyMap<string, TutCardSnap>;
  readonly handLen: readonly [number, number];
  readonly deckLen: readonly [number, number];
  readonly trashLen: readonly [number, number];
}

/** 取一份快照（只读，不改 state） */
export function snapshot(state: GameState): TutSnap {
  const cards = new Map<string, TutCardSnap>();
  const walk = (c: Card): void => {
    cards.set(c.uid, { owner: c.owner, faceUp: c.faceUp, zone: c.zone, line: c.line });
  };
  for (const p of state.players) {
    p.hand.forEach(walk);
    p.deck.forEach(walk);
    p.trash.forEach(walk);
    for (const stack of p.stacks) stack.forEach(walk);
  }
  const lens = (pick: (p: GameState['players'][0]) => readonly Card[]): [number, number] =>
    [pick(state.players[0]).length, pick(state.players[1]).length];
  return {
    cards,
    handLen: lens((p) => p.hand),
    deckLen: lens((p) => p.deck),
    trashLen: lens((p) => p.trash),
  };
}

/**
 * 前后两份快照之间**发生过哪些基础动作**（返回去重后的集合，顺序固定按 `TutOp` 的定义序）。
 *
 * 每一条的判据（都写成"只看状态"）：
 *  - **flip**：同一张卡 `faceUp` 变了（且仍在场）；
 *  - **shift**：同一张卡 `line` 变了（且仍在场、同一 owner）——"偏转"就是换线；
 *  - **discard**：任意一方的**弃牌堆**张数增加了；
 *  - **draw**：任意一方的**手牌**张数增加了（抽牌必然进手牌）；
 *  - **return**：同一张卡从 `field` 变成 `hand`（回手）。
 */
export function observedOps(before: TutSnap, after: TutSnap): readonly TutOp[] {
  const hit = new Set<TutOp>();
  for (const [uid, b] of before.cards) {
    const a = after.cards.get(uid);
    if (a === undefined) continue;
    if (b.zone === 'field' && a.zone === 'field') {
      if (b.faceUp !== a.faceUp) hit.add('flip');
      if (b.line !== a.line && b.owner === a.owner) hit.add('shift');
    }
    if (b.zone === 'field' && a.zone === 'hand') hit.add('return');
  }
  const grew = (b: readonly number[], a: readonly number[]): boolean => a.some((n, i) => n > (b[i] ?? 0));
  if (grew(before.trashLen, after.trashLen)) hit.add('discard');
  if (grew(before.handLen, after.handLen)) hit.add('draw');
  const order: readonly TutOp[] = ['flip', 'shift', 'draw', 'discard', 'return'];
  return order.filter((op) => hit.has(op));
}

/**
 * 玩家 0 **自己**场上的卡（T1/T2 的判据只看自己的链路：对手那几张是背景）。
 *
 * ⚠️ 不看 `owner` 而看"在谁的 stacks 里"：卡被回手/移交之后 owner 会变，
 * 而"这条线上有几张牌"这件事问的是**阵地**，不是归属。
 */
function ownFieldOf(state: GameState, player: PlayerId = 0): Card[] {
  return state.players[player].stacks.flat();
}

/**
 * 本关"做完了没有"。
 *
 * @param state 当前引擎状态
 * @param opts.spotsDone T0 点过哪几个热点（T1~T3 不用）
 * @param opts.opsSeen T3 到目前为止观测到的动作签名（由屏在每次动作后累积）
 */
export function isLevelComplete(
  level: TutLevel,
  state: GameState,
  opts: { readonly spotsDone?: readonly TutSpot[]; readonly opsSeen?: readonly TutOp[] } = {},
): boolean {
  if (level.id === 'T0') {
    const want = level.spots ?? [];
    const done = new Set(opts.spotsDone ?? []);
    return want.length > 0 && want.every((s) => done.has(s));
  }
  if (level.id === 'T1') {
    // 方案 §5.2：`stacks[线].length === 1`（打出了 1 张）。这里再加一条"那张是正面"——
    // 本关教的是"打出**正面**牌"，只看张数会让"打了一张反的"也算过（那是 T2 的内容）。
    const field = ownFieldOf(state);
    return field.length === 1 && field[0].faceUp === true;
  }
  if (level.id === 'T2') {
    // 正面、反面各至少 1 张（方案 §5.2："两张 faceUp 分别 true/false"）
    const field = ownFieldOf(state);
    return field.some((c) => c.faceUp) && field.some((c) => !c.faceUp);
  }
  // T3：五个签名要**全部**出现（把方案那五条状态断言收成"五个动作都发生过"）
  const want = level.ops ?? [];
  const seen = new Set(opts.opsSeen ?? []);
  return want.length > 0 && want.every((op) => seen.has(op));
}

/**
 * 走偏时给哪一句提示（键名**逐条字面量**写在这里 —— 缺键扫描腿要看得见）。
 *
 * 三类走偏，按"玩家实际做了什么"分：
 *  - **动作种类不在白名单里**（例如 T1 里去点编译）⇒ `tutorial.off.wrong-kind`；
 *  - **打了一张反面的牌**，而本关要的是正面（T1）⇒ `tutorial.off.face-down`；
 *  - 其余（引擎自己会拒的，例如正面牌打到不匹配的线）由引擎拒掉，屏上给
 *    `tutorial.off.rejected`（"这张牌不能放在这条线上"）。
 */
export function offTrackKeyFor(
  level: TutLevel,
  action: { readonly kind: string; readonly faceUp?: boolean },
): string {
  if (!level.allowKinds.includes(action.kind)) return 'tutorial.off.wrong-kind';
  if (level.id === 'T1' && action.kind === 'play' && action.faceUp === false) {
    return 'tutorial.off.face-down';
  }
  return 'tutorial.off.rejected';
}

/** 关卡序号 → 是否已经是最后一关（屏上据此把"下一关"换成"完成"） */
export function isLastLevel(id: TutLevelId, all: readonly { id: TutLevelId }[]): boolean {
  return all.length > 0 && all[all.length - 1].id === id;
}
