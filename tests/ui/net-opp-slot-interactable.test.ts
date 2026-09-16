import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createGame } from '../../src/core/state/create';
import { getLegalActions } from '../../src/core/game';
import type { Line, PlayerId } from '../../src/core/models/types';
import { renderNetBoard } from '../../src/ui/render-net';
import { getHandSelection, setHandSelection } from '../../src/ui/render';
import { setFxViewSeat } from '../../src/ui/fx-seat';
import { makeCard } from '../helpers';
import { descendants, drainRaf, installStubDom, isClass, makeStubEl, type StubNode } from './net-dom-stub';
import { functionBody, stripComments } from './source-text';

/**
 * **R15-2 守卫：远程页的「合法他侧落点」必须可交互（腐化0 打对方场）**
 *
 * ## 被守的缺陷
 *
 * `render-net.ts` 的 `renderSide` 曾用 `const canAct = isSelfSeat && myTurn;` 决定链路槽的
 * `interactable`。那条判据把**对手侧的槽**一律排除，于是腐化0（`core/game.ts:65-72` 产出的
 * `target: 对方` 合法 play）在远程页：
 *  1. **点击落点不可达** —— `renderStackSlot` 只在 `interactable` 时才挂 `click` / hover；
 *  2. **拖拽期不高亮** —— `render.ts` 的 `beginDrag` 给合法落点加的是 `.drag-target`，而
 *     把它画成落点框的规则要求**同时**带 `.interactable`（`styles.css` 的
 *     `.stack-slot.interactable.drag-target`）⇒ 玩家看不出能放哪。
 * 净效果：腐化0 只能"盲拖"到对手列，且没有任何视觉反馈。
 *
 * ## 这条守卫是什么腿
 *
 * **行为腿**：真跑 `renderNetBoard`（用 `./net-dom-stub` 的最小桩，无 jsdom），
 * 用一份**真** `GameState`（腐化0 在手、轮到我、`step === 'action'`）：
 *  - 选中腐化0 ⇒ 对手侧 3 个 `.stack-slot` 必须**逐个**带 `interactable`；
 *  - 未选中 / 选中一张**不能**打对方场的牌（fire-1）⇒ 对手侧 3 个槽**都不得**带。
 *
 * ⚠️ 第二条（反空集合）是必须的：只查"选中时有类"的话，把 `canAct` 改成恒 `true` 也会绿 ——
 * 而那正是 R14-2 修掉的旧缺陷（对手回合时对手槽可交互）。
 *
 * 能：`interactable` 类名是否进了真实 DOM 树、以及它是否**跟着"这个槽是不是合法落点"**变。
 * **不能**：真实的 hover / 拖拽高亮观感（那要浏览器；桩的 `addEventListener` 是 noop）。
 *
 * ## 为什么用 `getLegalActions` 当**前置条件**断言，而不是自造一份 action 表
 *
 * 这条守卫的整个价值在于"合法落点"这四个字。若只在测试里假声明一个 `target=对方` 的合法动作，
 * 守的就只是"这份假表能被渲染器读到"。所以夹具先断言引擎**真的**给出
 * `{ kind:'play', cardUid:腐化0, line, faceUp:true, target:对手 }`，再让渲染器真跑。
 */

const read = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`../../src/ui/${name}`, import.meta.url)))
    .subarray(0, 4 * 1024 * 1024).toString('utf8');

/** 夹具：一份**真的能打出腐化0 到对方场**的局面（协议给全，避免协议不匹配干扰）。 */
function stateWithCorruption(me: PlayerId): { s: ReturnType<typeof createGame>; uid: string } {
  const s = createGame({ seed: 'r15-opp-slot', draftStarter: 0, firstToPlay: me });
  for (const p of [0, 1] as const) {
    s.players[p].protocols = [
      { defId: 'fire-0', compiled: false },
      { defId: 'ice-0', compiled: false },
      { defId: 'light-0', compiled: false },
    ] as never;
  }
  (s as { phase: string }).phase = 'turn';
  s.step = 'action';
  s.turnPlayer = me;
  s.pendingEffects.length = 0;
  s.pendingPlay.length = 0;
  s.pendingShift.length = 0;
  s.winner = null;
  const card = makeCard('corruption-0', me, 'hand', true, null);
  s.players[me].hand.push(card);
  return { s, uid: card.uid };
}

/** 真跑一帧（与 `net-dock.test.ts` / `net-board-grid.test.ts` 同源的最小形态）。 */
function renderFrame(s: ReturnType<typeof createGame>, viewSeat: PlayerId): StubNode {
  const root = makeStubEl('div');
  const noop = (): void => { /* noop */ };
  renderNetBoard(root as unknown as HTMLElement, s, {
    onAction: noop, onRendered: noop, rerender: noop, onDraftPick: noop, onDraftUnpick: noop,
    onDraftBan: noop, onWinReset: noop,
  } as never, { viewSeat });
  return root;
}

/** 某一侧的 3 个链路槽（`.stack-slot[data-player=…]`），按线号排序。 */
function slotsOf(root: StubNode, player: PlayerId): StubNode[] {
  return descendants(root)
    .filter((n) => isClass(n, 'stack-slot') && n.dataset.player === String(player))
    .sort((a, b) => Number(a.dataset.line) - Number(b.dataset.line));
}

afterEach(() => {
  setHandSelection(null);
  setFxViewSeat(null);
});

describe('R15-2 · 远程页：合法他侧落点的可交互性（腐化0 打对方场）', () => {
  it('选中腐化0 ⇒ **对手侧** 3 个链路槽都带 `interactable`（且线号对得上）', async () => {
    const restore = installStubDom();
    try {
      for (const me of [0, 1] as const) {
        const { s, uid } = stateWithCorruption(me);
        const opp: PlayerId = me === 0 ? 1 : 0;
        // ── 前置条件：引擎**真的**给出"打对方场"的合法动作（三个线号各一条）──
        const legal = getLegalActions(s, me);
        const toOpp = legal.filter((a) => a.kind === 'play' && a.target === opp && a.faceUp === true);
        expect(toOpp.map((a) => a.line).sort(), `P${me + 1} 打腐化0 到对方场的合法线号（夹具前提）`)
          .toEqual([0, 1, 2]);
        expect(toOpp.every((a) => a.cardUid === uid)).toBe(true);

        setFxViewSeat(me);                        // ← 远程页（非 null）；渲染期由 renderNetBoard 设
        setHandSelection(uid, true);              // ← 选中这张牌（= 用户点了它）
        const root = renderFrame(s, me);
        await drainRaf();
        const oppSlots = slotsOf(root, opp);
        expect(oppSlots.length, `P${me + 1} 视角：对手侧（P${opp + 1}）的链路槽不是 3 个`).toBe(3);
        for (const slot of oppSlots) {
          expect(isClass(slot, 'interactable'),
            `选中腐化0 后，对手侧线 ${slot.dataset.line} 的槽没有 interactable —— `
            + '点击落点与拖拽高亮两条路径都不可达（用户报的"看不出能放哪"）').toBe(true);
        }
        // 自己侧不受影响（仍是 isSelfSeat && myTurn 那一支）
        for (const slot of slotsOf(root, me)) {
          expect(isClass(slot, 'interactable'), `自己侧线 ${slot.dataset.line} 的槽应当可交互`).toBe(true);
        }
      }
    } finally { restore(); }
  });

  it('反空集合：**未选中** / 选中**不能打对方场**的牌 ⇒ 对手侧 3 个槽都不得带 `interactable`', async () => {
    const restore = installStubDom();
    try {
      for (const me of [0, 1] as const) {
        const { s } = stateWithCorruption(me);
        const opp: PlayerId = me === 0 ? 1 : 0;
        setFxViewSeat(me);

        // ① 未选中任何手牌
        setHandSelection(null);
        const bare = slotsOf(renderFrame(s, me), opp);
        await drainRaf();
        expect(bare.length).toBe(3);
        for (const slot of bare) {
          expect(isClass(slot, 'interactable'), `未选中时对手侧线 ${slot.dataset.line} 不该可交互`).toBe(false);
        }

        // ② 选中一张**不能**打对方场的牌（fire-1）
        const plain = makeCard('fire-1', me, 'hand', true, null);
        s.players[me].hand.push(plain);
        expect(
          getLegalActions(s, me).some((a) => a.kind === 'play' && a.cardUid === plain.uid && a.target === opp),
          '夹具前提：fire-1 不该有 target=对方的合法动作（同一手里还有腐化0 —— 所以判据必须钉到 cardUid）',
        ).toBe(false);
        setHandSelection(plain.uid, true);
        const withPlain = slotsOf(renderFrame(s, me), opp);
        await drainRaf();
        expect(withPlain.length).toBe(3);
        for (const slot of withPlain) {
          expect(isClass(slot, 'interactable'),
            `选中 fire-1（不能打对方场）时对手侧线 ${slot.dataset.line} 不该可交互`).toBe(false);
        }

        // ③ 换成**手里只有一张不能打对方场的牌**的局面：对手侧同样一个槽都不得可交互
        //    （前两步还留着"手里有腐化0"这个混淆项，这一步把它去掉）
        const { s: s2, uid: uid2 } = stateWithCorruption(me);
        s2.players[me].hand = [makeCard('fire-1', me, 'hand', true, null)];
        expect(getLegalActions(s2, me).some((a) => a.kind === 'play' && a.target === opp),
          `夹具前提：P${me + 1} 手里只有 fire-1 时不该有 target=对方的合法动作`).toBe(false);
        setHandSelection(s2.players[me].hand[0].uid, true);
        expect(uid2, '夹具前提 2：腐化0 的 uid 与 fire-1 不同').not.toBe(s2.players[me].hand[0].uid);
        const plainOnly = slotsOf(renderFrame(s2, me), opp);
        await drainRaf();
        expect(plainOnly.length).toBe(3);
        for (const slot of plainOnly) {
          expect(isClass(slot, 'interactable'),
            `手里只有 fire-1 时对手侧线 ${slot.dataset.line} 不该可交互`).toBe(false);
        }
      }
    } finally { restore(); }
  });

  it('反空集合：**对手回合**时我这侧的槽仍不可交互（R14-2 的旧缺陷不得被本次修法放开）', async () => {
    const restore = installStubDom();
    try {
      for (const me of [0, 1] as const) {
        const { s, uid } = stateWithCorruption(me);
        s.turnPlayer = (me === 0 ? 1 : 0) as PlayerId;   // 回合给了对手
        setFxViewSeat(me);
        setHandSelection(uid, true);                     // 即便"选中"了牌（引擎不会给合法动作）
        expect(getLegalActions(s, s.turnPlayer).some((a) => a.kind === 'play'),
          '夹具前提：对手回合时他不能打出任何牌').toBe(false);
        const slots = slotsOf(renderFrame(s, me), me);
        await drainRaf();
        expect(slots.length).toBe(3);
        for (const slot of slots) {
          expect(isClass(slot, 'interactable'),
            `对手回合时我侧线 ${slot.dataset.line} 的槽不该可交互（R14-2）`).toBe(false);
        }
      }
    } finally { restore(); }
  });
});

describe('R15-2 · 源码腿（判据与 playToLine 同构、且不做别的）', () => {
  const netSrc = (): string => stripComments(read('render-net.ts'));

  it('`renderSide` 的 `canAct` 仍以「我这一侧 + 轮到我」为**必要**条件，并额外放行合法落点', () => {
    const body = functionBody(netSrc(), 'renderSide');
    expect(body, 'renderSide 里 `canAct` 的"自己侧 + 轮到我"那一半被删了（对手回合会变成可交互）')
      .toMatch(/const canAct = \(isSelfSeat && myTurn\) \|\| selectedCanPlayHere;/);
    // 合法落点判据必须与 `playToLine` 同构：kind / cardUid / line / faceUp / (target ?? turnPlayer)
    expect(body, '合法落点判据缺 `a.line === line`（会把别的线的落点也算成可交互）')
      .toMatch(/a\.line === line/);
    expect(body, '合法落点判据缺 `a.faceUp === faceUp`（会与 playToLine 的校验脱钩）')
      .toMatch(/a\.faceUp === faceUp/);
    expect(body, '合法落点判据缺 `(a.target ?? s.turnPlayer) === player`（对手槽会永远放不出来/永远放出来）')
      .toMatch(/\(a\.target \?\? s\.turnPlayer\) === player/);
    // 反空集合：不许退化成"轮到我 ⇒ 全可交互"（那是把 R14-2 反着修回去）
    expect(body, 'canAct 退化成只看回合了（对手侧的槽会无条件可交互 = R14-2 的旧缺陷）')
      .not.toMatch(/const canAct = myTurn;/);
    expect(body, 'canAct 里出现了"恒 true"的形态').not.toMatch(/const canAct = true;/);
  });

  it('点击落点的回调仍是 `playToLine(s, cb, l, player)`（本次修法不许改它）', () => {
    const body = functionBody(netSrc(), 'renderSide');
    expect(body, 'renderSide 的落点回调被改写了（playToLine 的 target 参数必须仍是 player）')
      .toMatch(/\(l\) => playToLine\(s, cb, l, player\)/);
    expect(body, 'renderSide 里出现了第二个 playToLine 调用点（两套派发会漂移）')
      .not.toMatch(/playToLine\(s, cb, l, 1 - player\)/);
  });
});
