import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { createGame } from '../../src/core/state/create';
import type { ChoiceCard, PlayerId } from '../../src/core/models/types';
import { createLocalStore, readInstantChoice, writeInstantChoice } from '../../src/app/local-store';
import { createMemoryStore, L1_SETTINGS, type KeyValueStore } from '../../src/app/storage';
import { getChoiceSelection, renderBoard, resetUiState } from '../../src/ui/render';
import { renderNetBoard } from '../../src/ui/render-net';
import { setFxViewSeat } from '../../src/ui/fx-seat';
import {
  INSTANT_CHOICE_DEFAULT, applyInstantChoice, instantChoiceApplies, isInstantChoiceOn,
  resetInstantChoiceForTest, setInstantChoice,
} from '../../src/ui/play-prefs';
import { descendants, installStubDom, isClass, makeStubEl, queryAllIn, type StubNode } from './net-dom-stub';
import { makeCard } from '../helpers';

/**
 * **2026-10-06 用户要求：设置里的「选牌即确定」（默认关闭）**
 *
 * 用户原话：「在设置中加上一个选择项，默认关闭，打开后，玩家在触发需要选择卡牌后按下确定键
 * 才能确定将效果作用于该卡时，其操作会变为无需按下确定键就能确定将效果作用于选择的卡牌，
 * 即点击即触发，但注意，这个设置只会影响到不可选择跳过或是其他效果的卡牌效果，那些具有
 * 可选的卡牌不受其影响」。
 *
 * 范围口径（用户当天当场裁决，二选一里选了保守的那条）：**只有"只选 1 张"的自动确定**，
 * 多选（弃2张/弃3张、"1 张或更多"）一律照旧按确定键。
 *
 * ## 本文件的三组
 *
 *  1. **纯判据**（`instantChoiceApplies`）：四条（开着 / 是选卡 / 没有跳过 / 只选 1 张）
 *     逐条翻一遍 —— 这是"哪些效果受影响"的**唯一出处**；
 *  2. **存储**（`readInstantChoice` / `writeInstantChoice`）：只认 `true`、与其它设置同住
 *     `compile-settings`（不新增存储键）；
 *  3. **真跑**（`renderBoard` / `renderNetBoard` + 桩 DOM）：开着时点候选卡**直接派发**
 *     `effect-choice`；关着时只是勾选、仍要按「确定」；而"能跳过"与"要选 2 张"的
 *     即使开着也**不许**自动派发。
 *
 * ⚠️ 桩没有 CSS/布局，所以这里证的是"点了之后派发了什么"，不是"观感"。
 */

type S = ReturnType<typeof createGame>;

const REPO_UID = 'pe-instant';

/** 一帧最简对局：草稿已过、轮到我、协议给全、双方各两张手牌。 */
function baseState(turnPlayer: PlayerId = 0): S {
  const s = createGame({ seed: 'instant-choice', draftStarter: 0, firstToPlay: turnPlayer });
  for (const p of [0, 1] as const) {
    s.players[p].protocols = [
      { defId: 'fire-0', compiled: false },
      { defId: 'ice-0', compiled: false },
      { defId: 'light-0', compiled: false },
    ] as never;
  }
  (s as { phase: string }).phase = 'turn';
  s.step = 'action';
  s.turnPlayer = turnPlayer;
  s.pendingEffects.length = 0;
  s.pendingPlay.length = 0;
  s.pendingShift.length = 0;
  s.winner = null;
  for (const p of [0, 1] as const) {
    s.players[p].hand.push(makeCard('speed-0', p, 'hand', true, null));
    s.players[p].hand.push(makeCard('water-4', p, 'hand', true, null));
  }
  return s;
}

/** 挂一条 `select` 效果（`gen` 空转 —— 本文件只看"点了之后派发了什么"）。 */
function withSelect(
  s: S, chooser: PlayerId, cards: ChoiceCard[],
  o: { optional?: boolean; min?: number; max?: number } = {},
): void {
  s.pendingEffects.push({
    id: REPO_UID,
    player: chooser,
    gen: (function* g(): Generator<never, void, never> { /* 不推演 */ })() as never,
    sourceUid: 'src-instant',
    sourceDefId: 'speed-5',
    prompt: {
      kind: 'select',
      title: 'speed-5：弃1张牌',
      min: o.min ?? 1,
      max: o.max ?? 1,
      optional: o.optional ?? false,
      candidates: cards,
    },
    lastAnswer: null,
  });
}

const cardsOf = (s: S, owner: PlayerId): ChoiceCard[] =>
  s.players[owner].hand.map((c) => ({
    uid: c.uid, defId: c.defId, faceUp: true, owner, zone: 'hand' as const, line: null, pos: null, label: c.defId,
  }));

interface Rec { readonly actions: unknown[]; readonly cb: never }

function recordingCb(): Rec {
  const actions: unknown[] = [];
  const noop = (): void => { /* noop */ };
  const cb = {
    onAction: (a: unknown) => { actions.push(a); },
    onRendered: noop, rerender: noop, onDraftPick: noop, onDraftUnpick: noop, onDraftBan: noop, onWinReset: noop,
  } as never;
  return { actions, cb };
}

const cardNode = (root: StubNode, uid: string): StubNode | undefined =>
  descendants(root).find((n) => isClass(n, 'card') && n.dataset.uid === uid);

/** 在 node 上派发一个事件（桩的派发路径不含派发节点自己 ⇒ 挂探针子节点） */
function fire(node: StubNode, type: string): void {
  const probe = makeStubEl('span');
  node.appendChild(probe);
  probe.dispatchEvent({ type, target: probe });
}

beforeEach(() => {
  // ⚠️ 这里**不能**调 `resetUiState()`：它要 `document`（纯判据与存储那两组没有装桩 DOM）
  //    ⇒ 那一步放在每个"真跑"腿的 finally 里（在 `restore()` 之前）。
  resetInstantChoiceForTest();
});
afterEach(() => {
  resetInstantChoiceForTest();
  setFxViewSeat(null);
  vi.useRealTimers();
});

describe('① 纯判据 `instantChoiceApplies`：四条缺一不可', () => {
  it('四条判据逐条翻一遍（开着 / 是选卡 / 没有跳过 / 只选 1 张）', () => {
    const ok = { kind: 'select', max: 1, optional: false };
    expect(instantChoiceApplies(ok, true), '四条都满足却不生效').toBe(true);
    expect(instantChoiceApplies(ok, false), '设置关着也生效了').toBe(false);
    expect(instantChoiceApplies({ ...ok, optional: true }, true),
      '能跳过的效果（有「跳过」按钮）被自动确定了 —— 用户明确说这类不受影响').toBe(false);
    expect(instantChoiceApplies({ ...ok, max: 2 }, true),
      '要选 2 张的效果被自动确定了（用户裁决：多选保持原样）').toBe(false);
    expect(instantChoiceApplies({ ...ok, max: Number.POSITIVE_INFINITY }, true), '「1 张或更多」被自动确定了').toBe(false);
    expect(instantChoiceApplies({ kind: 'select-line', max: 1, optional: false }, true),
      'select-line（点线槽本来就即答）不该走这条判据').toBe(false);
    expect(instantChoiceApplies({ kind: 'select-action', max: 1, optional: false }, true),
      'select-action（点动作按钮本来就即答）不该走这条判据').toBe(false);
  });

  it('缺省读内存态；默认值 = **关闭**（用户明确要求）', () => {
    expect(INSTANT_CHOICE_DEFAULT, '默认值被改成了开启').toBe(false);
    expect(isInstantChoiceOn(), '启动（未读盘）时不是关闭').toBe(false);
    expect(instantChoiceApplies({ kind: 'select', max: 1, optional: false }),
      '默认关闭时缺省实参就生效了').toBe(false);
    setInstantChoice(true);
    expect(isInstantChoiceOn()).toBe(true);
    expect(instantChoiceApplies({ kind: 'select', max: 1, optional: false })).toBe(true);
    // 启动读回：只认 true，其它一律退默认（与 `readInstantChoice` 同一条口径）
    applyInstantChoice(undefined);
    expect(isInstantChoiceOn()).toBe(false);
    applyInstantChoice('true');
    expect(isInstantChoiceOn(), '字符串 "true" 也算开了（形状守卫漏了）').toBe(false);
    applyInstantChoice(1);
    expect(isInstantChoiceOn()).toBe(false);
    applyInstantChoice(true);
    expect(isInstantChoiceOn()).toBe(true);
  });
});

describe('② 存储：与其它设置同住 `compile-settings`，只认 `true`', () => {
  it('写读往返 + 键没多（还是那三把键）', () => {
    const kv = createMemoryStore();
    const store = createLocalStore({ persistent: kv });
    store.grant();
    expect(readInstantChoice(store), '默认不是关闭').toBe(false);
    expect(writeInstantChoice(store, true).ok, '写盘失败').toBe(true);
    expect(readInstantChoice(store), '写进去又读不回来').toBe(true);
    expect(kv.keys().sort(), '新增了存储键（应当同住 compile-settings）')
      .toEqual([L1_SETTINGS, 'compile-consent'].sort());
    expect(JSON.parse(kv.get(L1_SETTINGS) as string).instantChoice).toBe(true);
    expect(writeInstantChoice(store, false).ok).toBe(true);
    expect(readInstantChoice(store)).toBe(false);
  });

  it('形状守卫：坏值（字符串/数字/对象/数组）一律当关闭，不抛', () => {
    const kv = createMemoryStore();
    const store = createLocalStore({ persistent: kv });
    store.grant();
    /**
     * ⚠️ 坏值必须写成"**合法设置对象里的坏字段**"（`{"instantChoice":"true"}` 这种）——
     * 直接写 `'"true"'` / `'1'` / `'[]'` 会被 `readSettings` 的**对象守卫**先拦掉
     * （非对象一律回 `{}`），于是那条腿根本没碰到本函数自己的字段守卫（变异实测：把读侧守卫
     * 放宽成"只要不是 false 就算开"，那种写法的腿仍然全绿 —— 假腿）。
     */
    for (const bad of ['"true"', '1', '{}', '[]', 'null']) {
      kv.set(L1_SETTINGS, JSON.stringify({ instantChoice: JSON.parse(bad) }));
      expect(readInstantChoice(store), `坏字段 ${bad} 被当成了开启`).toBe(false);
    }
    // 整个值是坏的（不是对象）⇒ 也当关闭
    for (const whole of ['null', '42', '"x"', '[]', 'not-json']) {
      kv.set(L1_SETTINGS, whole);
      expect(readInstantChoice(store), `整个设置写成 ${whole} 时没有退化成关闭`).toBe(false);
    }
    // 反向锚点：写进去的 `true` 必须读得回来（否则上面那些可能是"恒 false"）
    kv.set(L1_SETTINGS, JSON.stringify({ instantChoice: true }));
    expect(readInstantChoice(store), '写进去的 true 读不回来 ⇒ 上面那条判据恒真').toBe(true);
  });
});

describe('③ 真跑（热座）：点了就派发 —— 但只对"没有跳过 + 只选 1 张"的那些', () => {
  it('开着：点候选卡 ⇒ 直接派发 effect-choice（不用按「确定」）', () => {
    vi.useFakeTimers();
    const restore = installStubDom();
    try {
      setInstantChoice(true);
      const s = baseState(0);
      const cands = cardsOf(s, 0);
      withSelect(s, 0, cands);
      const { actions, cb } = recordingCb();
      const root = makeStubEl('div');
      renderBoard(root as unknown as HTMLElement, s, cb);

      const node = cardNode(root, cands[0].uid);
      expect(node, '夹具失败：候选卡没有渲染出来').toBeDefined();
      expect(isClass(node!, 'choice-target'), '夹具前提：这张卡应当是候选').toBe(true);

      fire(node!, 'click');
      vi.runOnlyPendingTimers(); // 单击延迟 320ms（与双击判别同一个窗口）
      expect(actions, '点了候选卡却没有派发 effect-choice').toHaveLength(1);
      expect(actions[0]).toEqual({ kind: 'effect-choice', promptId: REPO_UID, choice: [cands[0].uid] });
    } finally { resetUiState(); restore(); }
  });

  it('开着：候选**不在棋盘上**（弃牌堆/牌库那类）⇒ 点定向选牌浮层里的卡也直接派发', () => {
    vi.useFakeTimers();
    const restore = installStubDom();
    try {
      setInstantChoice(true);
      const s = baseState(0);
      // 候选 uid 在棋盘上不存在（弃牌堆里那张）⇒ 走 `.choice-pick-overlay` 那条路
      const off: ChoiceCard[] = [{
        uid: 'gone-1', defId: 'water-4', faceUp: true, owner: 0,
        zone: 'trash' as const, line: null, pos: null, label: 'gone',
      }];
      withSelect(s, 0, off);
      const { actions, cb } = recordingCb();
      const root = makeStubEl('div');
      renderBoard(root as unknown as HTMLElement, s, cb);

      const cell = queryAllIn(root, '.choice-pick-card')[0];
      expect(cell, '夹具失败：没出现定向选牌浮层（候选不在棋盘上时它才出现）').toBeDefined();
      fire(cell!, 'click');
      vi.runOnlyPendingTimers();
      expect(actions, '浮层里点了卡却没有派发 effect-choice').toHaveLength(1);
      expect(actions[0]).toEqual({ kind: 'effect-choice', promptId: REPO_UID, choice: ['gone-1'] });
    } finally { resetUiState(); restore(); }
  });

  it('关着（默认）：点候选卡只是勾选，仍要按「确定」才派发', () => {
    vi.useFakeTimers();
    const restore = installStubDom();
    try {
      expect(isInstantChoiceOn(), '夹具前提：默认关闭').toBe(false);
      const s = baseState(0);
      const cands = cardsOf(s, 0);
      withSelect(s, 0, cands);
      const { actions, cb } = recordingCb();
      const root = makeStubEl('div');
      renderBoard(root as unknown as HTMLElement, s, cb);

      fire(cardNode(root, cands[0].uid)!, 'click');
      vi.runOnlyPendingTimers();
      expect(actions, '关着的时候点一下就把效果确定了（设置没生效/越权）').toHaveLength(0);
      expect(getChoiceSelection(), '勾选没记上（关着时应当只是勾选）').toEqual([cands[0].uid]);

      // 既有那条路照旧：按「确定」才派发
      const confirm = queryAllIn(root, '.choice-confirm')[0];
      expect(confirm, '找不到「确定」按钮').toBeDefined();
      fire(confirm!, 'click');
      expect(actions, '按了「确定」也没派发（既有那条路被改坏了）').toHaveLength(1);
      expect(actions[0]).toEqual({ kind: 'effect-choice', promptId: REPO_UID, choice: [cands[0].uid] });
    } finally { resetUiState(); restore(); }
  });

  it('开着也**不许**自动确定的两类：能跳过的（optional）与要选 2 张的', () => {
    vi.useFakeTimers();
    const restore = installStubDom();
    try {
      setInstantChoice(true);
      // ① 能跳过（`optional: true`）：屏上会有「跳过」按钮 ⇒ 用户口径里"具有可选的"那一类
      {
        const s = baseState(0);
        const cands = cardsOf(s, 0);
        withSelect(s, 0, cands, { optional: true });
        const { actions, cb } = recordingCb();
        const root = makeStubEl('div');
        renderBoard(root as unknown as HTMLElement, s, cb);
        expect(queryAllIn(root, '.choice-skip').length, '夹具前提：能跳过的 prompt 应当有「跳过」按钮').toBe(1);
        fire(cardNode(root, cands[0].uid)!, 'click');
        vi.runOnlyPendingTimers();
        expect(actions, '能跳过的效果被自动确定了（用户明确说这类不受影响）').toHaveLength(0);
        expect(getChoiceSelection()).toEqual([cands[0].uid]);
      }
      // ② 要选 2 张（max: 2）：点第一张不能自动确定
      {
        resetUiState();
        const s = baseState(0);
        const cands = cardsOf(s, 0);
        withSelect(s, 0, cands, { min: 2, max: 2 });
        const { actions, cb } = recordingCb();
        const root = makeStubEl('div');
        renderBoard(root as unknown as HTMLElement, s, cb);
        fire(cardNode(root, cands[0].uid)!, 'click');
        vi.runOnlyPendingTimers();
        expect(actions, '要选 2 张的效果点第一张就确定了（用户裁决：多选保持原样）').toHaveLength(0);
        expect(getChoiceSelection()).toEqual([cands[0].uid]);
      }
    } finally { resetUiState(); restore(); }
  });
});

describe('③ 真跑（远程页）：同一条判据、同一个行为', () => {
  it('开着：操作方点候选卡 ⇒ 直接派发 effect-choice', () => {
    vi.useFakeTimers();
    const restore = installStubDom();
    try {
      setInstantChoice(true);
      setFxViewSeat(0);
      const s = baseState(0);
      const cands = cardsOf(s, 0);
      withSelect(s, 0, cands);
      const { actions, cb } = recordingCb();
      const root = makeStubEl('div');
      renderNetBoard(root as unknown as HTMLElement, s, cb, { viewSeat: 0 });

      const node = cardNode(root, cands[0].uid);
      expect(node, '夹具失败：远程页没有渲染出候选卡').toBeDefined();
      fire(node!, 'click');
      vi.runOnlyPendingTimers();
      expect(actions, '远程页点了候选卡没有派发（两个渲染器读的应当是同一个判据）').toHaveLength(1);
      expect(actions[0]).toEqual({ kind: 'effect-choice', promptId: REPO_UID, choice: [cands[0].uid] });
    } finally { resetUiState(); restore(); }
  });
});
