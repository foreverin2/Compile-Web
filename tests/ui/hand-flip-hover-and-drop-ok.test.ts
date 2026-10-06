import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createGame } from '../../src/core/state/create';
import { getLegalActions } from '../../src/core/game';
import type { GameState, PlayerId } from '../../src/core/models/types';
import { getHandSelection, renderBoard, resetUiState, setHandSelection } from '../../src/ui/render';
import { makeCard } from '../helpers';
import {
  classOf, descendants, installStubDom, isClass, makeStubEl, type StubNode,
} from './net-dom-stub';

/**
 * **2026-10-06 两条用户口径的守卫（热座棋盘，真跑渲染器）**
 *
 * | 口径 | 旧行为 | 新行为 |
 * |---|---|---|
 * | ①「翻面」按钮 | 只有**选中**那张手牌的上缘才浮出按钮 | action 步骤下**每一张自己的手牌**都带浮出组；未选中那些默认藏起来、`:hover` 才显形（选中那张常显 ⇒ 触屏点一下仍拿得到） |
 * | ② 腐化0 的落点高亮 | 选中腐化0 时只有**自己那 3 条**链路亮（`.stack-slot.self`），对方 3 条只有 `cursor: pointer` | 双方 **6 条**全亮（对方那 3 条补 `.drop-ok`） |
 *
 * ## 为什么这两组必须**真跑**（而不是源码腿）
 *
 * 两条口径的产物都是**DOM 上的类名**，而它们的判据又都依赖引擎真值
 * （①「轮到这一侧」、② `getLegalActions` 里 `target=对方` 的合法动作）。
 * 源码腿只能证明"某处写了这个词"，证明不了"选中腐化0 之后对方那 3 个槽真的亮了、
 * 而没选中时一个都没亮"。所以这里用 `./net-dom-stub` 的最小桩真跑 `renderBoard`。
 *
 * ⚠️ **诚实边界**：桩的 `addEventListener` 只有测试主动 `dispatchEvent` 时才有行为，
 * 且没有 CSS 引擎 ⇒ 这里能证的是"类名进没进真 DOM 树、跟着哪个状态变"，
 * **不能**证"鼠标移上去真的看得见"（那要浏览器；见交付说明里的真机未验项）。
 * 反空集合腿是必须的：只查"选中时有类"的话，把条件写成恒 `true` 也会绿。
 */

const REPO = fileURLToPath(new URL('../../', import.meta.url));
const read = (rel: string): string =>
  readFileSync(`${REPO}${rel}`).subarray(0, 4 * 1024 * 1024).toString('utf8');

/** 一份**真的能打出腐化0 到对方场**的局面（协议给全，避免协议不匹配干扰落点）。 */
function stateWithCorruption(me: PlayerId): { s: GameState; uid: string } {
  const s = createGame({ seed: 'hand-flip-drop-ok', draftStarter: 0, firstToPlay: me });
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
  s.players[me].hand = [card];
  return { s, uid: card.uid };
}

/** 回调全部是 noop：这两组只看 DOM 上的类名与选择态，不派发任何动作。 */
const NOOP_CB = {
  onAction: () => { /* noop */ },
  onRendered: () => { /* noop */ },
  rerender: () => { /* noop */ },
  onDraftPick: () => { /* noop */ },
  onDraftUnpick: () => { /* noop */ },
  onDraftBan: () => { /* noop */ },
  onWinReset: () => { /* noop */ },
} as never;

/** 真跑一帧热座棋盘。 */
function frame(s: GameState): StubNode {
  const root = makeStubEl('div');
  renderBoard(root as unknown as HTMLElement, s, NOOP_CB);
  return root;
}

/** 某一侧的 3 个链路槽（`.stack-slot[data-player=…]`），按线号排序。 */
function slotsOf(root: StubNode, player: PlayerId): StubNode[] {
  return classOf(root, 'stack-slot', (n) => n.dataset.player === String(player))
    .sort((a, b) => Number(a.dataset.line) - Number(b.dataset.line));
}

/** 某一侧的手牌容器（`.hand[data-player=…]`；与"轮到谁"无关 —— 那正是本文件要分开看的两件事）。 */
function handOf(root: StubNode, player: PlayerId): StubNode {
  const hs = classOf(root, 'hand', (n) => n.dataset.player === String(player));
  expect(hs.length, `找不到 P${player + 1} 的手牌容器（结构被改了？）`).toBe(1);
  return hs[0];
}

/** 把一棵桩节点当成可点的东西点一下。
 *  ⚠️ 桩的派发路径**不含派发节点自己**（只沿 `parentElement` 向上）⇒ 必须挂一个探针子节点、
 *  在**探针**上派发，监听器才收得到（`tests/tutorial/screen.test.ts` 的 `clickNode` 同款）。 */
function clickNode(node: StubNode): void {
  const probe = makeStubEl('span');
  node.appendChild(probe);
  probe.dispatchEvent({ type: 'click', target: probe });
}

afterEach(() => {
  setHandSelection(null, true);
});

describe('② 腐化0 拿在手里被选中 ⇒ **双方 6 条链路**都亮成落点', () => {
  it('选中腐化0 ⇒ 对方那 3 个槽带 `drop-ok`，自己那 3 个照旧 `.self`（且两边的线号都是 0/1/2）', () => {
    const restore = installStubDom();
    try {
      for (const me of [0, 1] as const) {
        const { s, uid } = stateWithCorruption(me);
        const opp: PlayerId = me === 0 ? 1 : 0;
        // ── 前置条件：引擎**真的**给出"打对方场"的合法动作（三个线号各一条）──
        const toOpp = getLegalActions(s, me)
          .filter((a) => a.kind === 'play' && a.target === opp && a.faceUp === true);
        expect(toOpp.map((a) => a.line).sort(), `P${me + 1} 打腐化0 到对方场的合法线号（夹具前提）`)
          .toEqual([0, 1, 2]);
        expect(toOpp.every((a) => a.cardUid === uid)).toBe(true);

        setHandSelection(uid, true);            // ← 用户"把腐化0 拿在手里"（点了它）
        const root = frame(s);

        const oppSlots = slotsOf(root, opp);
        expect(oppSlots.length, `P${me + 1} 视角：对手侧（P${opp + 1}）的链路槽不是 3 个`).toBe(3);
        for (const slot of oppSlots) {
          expect(isClass(slot, 'drop-ok'),
            `选中腐化0 后，对方侧线 ${slot.dataset.line} 的槽没有 \`drop-ok\` —— `
            + '玩家看不出"手里这张牌能打到对面"（用户报的"只有自己那 3 条亮"）').toBe(true);
        }
        // 自己那 3 条不受影响：仍是 `.self` 常驻强调，且**不**多一个 `drop-ok`
        const ownSlots = slotsOf(root, me);
        expect(ownSlots.length).toBe(3);
        for (const slot of ownSlots) {
          expect(isClass(slot, 'self'), `自己侧线 ${slot.dataset.line} 的槽丢了 \`.self\``).toBe(true);
          expect(isClass(slot, 'drop-ok'), `自己侧线 ${slot.dataset.line} 不该带 \`drop-ok\``).toBe(false);
        }
      }
    } finally { resetUiState(); restore(); }
  });

  it('反空集合：没选中 / 选中**不能打对方场**的牌 / 对手回合 ⇒ 一个 `drop-ok` 都没有', () => {
    const restore = installStubDom();
    try {
      for (const me of [0, 1] as const) {
        const opp: PlayerId = me === 0 ? 1 : 0;
        const dropOksOf = (root: StubNode): StubNode[] => classOf(root, 'drop-ok');

        // ① 什么都没选中
        {
          const { s } = stateWithCorruption(me);
          setHandSelection(null, true);
          const root = frame(s);
          expect(slotsOf(root, opp).length, '夹具前提：对方侧仍是 3 个槽').toBe(3);
          expect(dropOksOf(root).length, '没选中任何牌时不该有 `drop-ok`').toBe(0);
        }

        // ② 选中的是一张**不能**打对方场的牌（fire-1）
        {
          const { s } = stateWithCorruption(me);
          const plain = makeCard('fire-1', me, 'hand', true, null);
          s.players[me].hand = [plain];
          expect(getLegalActions(s, me).some((a) => a.kind === 'play' && a.target === opp),
            `夹具前提：P${me + 1} 手里只有 fire-1 时不该有 target=对方的合法动作`).toBe(false);
          setHandSelection(plain.uid, true);
          const root = frame(s);
          expect(slotsOf(root, opp).length).toBe(3);
          expect(dropOksOf(root).length, '选中不能打对方场的牌时不该有 `drop-ok`').toBe(0);
        }

        // ③ 对手回合：即便"选中"了腐化0（引擎不给任何合法动作）也一个都不亮
        {
          const { s, uid } = stateWithCorruption(me);
          s.turnPlayer = opp;
          expect(getLegalActions(s, s.turnPlayer).some((a) => a.kind === 'play'),
            '夹具前提：对手回合时他不能打出任何牌').toBe(false);
          setHandSelection(uid, true);
          const root = frame(s);
          expect(slotsOf(root, opp).length).toBe(3);
          expect(dropOksOf(root).length, '对手回合时不该有 `drop-ok`（R14-2 的旧缺陷不许被放开）').toBe(0);
        }
      }
    } finally { resetUiState(); restore(); }
  });
});

describe('① 「翻面」按钮：鼠标移到手牌上就有（不再要求先选中）', () => {
  it('action 步骤下**每一张自己的手牌**都带浮出组；未选中那些挂 `play-btns-hover`，选中那张不挂', () => {
    const restore = installStubDom();
    try {
      for (const me of [0, 1] as const) {
        const { s } = stateWithCorruption(me);
        const a = makeCard('spirit-2', me, 'hand', true, null);
        const b = makeCard('spirit-5', me, 'hand', true, null);
        s.players[me].hand = [a, b];
        setHandSelection(null, true);
        const root = frame(s);

        const hand = handOf(root, me);
        const cards = classOf(hand, 'card');
        expect(cards.length, '夹具前提：自己手牌 2 张').toBe(2);
        const groups = classOf(hand, 'play-btns');
        expect(groups.length,
          '「翻面」浮出组的数量不等于手牌张数 —— 旧口径（只给选中那张）会让没选中的卡上什么都没有'
        ).toBe(cards.length);
        for (const g of groups) {
          expect(isClass(g, 'play-btns-hover'),
            '未选中那张的浮出组没有 `play-btns-hover` ⇒ 它会常显（用户要的是"移上去才显示"）').toBe(true);
        }
        // 每一组里恰好一个按钮（且是 i18n 的那句）
        for (const g of groups) expect(classOf(g, 'play-btn').length).toBe(1);

        // 选中第一张 ⇒ 它的组丢掉 `play-btns-hover`（常显），其余仍带
        setHandSelection(a.uid, true);
        const root2 = frame(s);
        const hand2 = handOf(root2, me);
        const selectedCards = classOf(hand2, 'card', (n) => isClass(n, 'selected'));
        expect(selectedCards.length, '选中之后带 `.selected` 的手牌不是 1 张').toBe(1);
        expect(selectedCards[0].dataset.uid).toBe(a.uid);
        const selGroup = classOf(selectedCards[0], 'play-btns')[0];
        expect(selGroup, '选中那张的子树里没有浮出组').toBeDefined();
        expect(isClass(selGroup, 'play-btns-hover'),
          '选中那张的浮出组仍带 `play-btns-hover` ⇒ 触屏（没有 hover）上这个按钮会看不见').toBe(false);
        const others = classOf(hand2, 'play-btns').filter((g) => g !== selGroup);
        expect(others.length, '手牌 2 张 ⇒ 另一张仍应有浮出组').toBe(1);
        expect(isClass(others[0], 'play-btns-hover'), '未选中那张的组丢了 `play-btns-hover`').toBe(true);
      }
    } finally { resetUiState(); restore(); }
  });

  it('★ 真跑：在**未选中**的卡上点「翻面」⇒ 先选中它、再翻到反面（不是"点了没反应"）', () => {
    const restore = installStubDom();
    try {
      for (const me of [0, 1] as const) {
        const { s } = stateWithCorruption(me);
        const a = makeCard('spirit-2', me, 'hand', true, null);
        const b = makeCard('spirit-5', me, 'hand', true, null);
        s.players[me].hand = [a, b];
        setHandSelection(null, true);
        const root = frame(s);
        expect(getHandSelection(), '夹具前提：开局没有选中任何牌').toEqual({ uid: null, faceUp: true });

        const hand = handOf(root, me);
        const cardA = classOf(hand, 'card').find((n) => n.dataset.uid === a.uid);
        expect(cardA, '找不到 spirit-2 那张手牌节点').toBeDefined();
        const btn = classOf(cardA!, 'play-btn')[0];
        expect(btn, '未选中的手牌上没有「翻面」按钮（用户要的就是"移上去就有"）').toBeDefined();

        clickNode(btn);
        expect(getHandSelection(),
          '在未选中的卡上点「翻面」之后，选择态不是"这一张 + 反面" ⇒ 那一下落在了别处（点了没反应）'
        ).toEqual({ uid: a.uid, faceUp: false });
        expect(s.players[me].hand.some((c) => c.uid === a.uid), '夹具前提：这一手并没被真的打出去').toBe(true);
      }
    } finally { resetUiState(); restore(); }
  });

  it('反空集合：**不是这一侧的回合** / **不是 action 步骤** ⇒ 一只按钮都不浮出', () => {
    const restore = installStubDom();
    try {
      for (const me of [0, 1] as const) {
        const opp: PlayerId = me === 0 ? 1 : 0;
        // ① 对手回合：我自己那手一只都不该有（对手那手可以有 —— 那是他那侧的按钮）
        {
          const { s } = stateWithCorruption(me);
          s.players[opp].hand = [makeCard('fire-1', opp, 'hand', true, null)];
          s.turnPlayer = opp;
          const root = frame(s);
          expect(classOf(handOf(root, me), 'play-btns').length,
            `P${opp + 1} 的回合里，P${me + 1} 自己的手牌上浮出了「翻面」按钮（点了没用）`).toBe(0);
          expect(classOf(handOf(root, opp), 'play-btns').length,
            '轮到的那一侧自己的手牌应当有按钮（这条不是"全都关掉"）').toBe(1);
        }
        // ② 轮到我、但不在 action 步骤（check-compile）：一个都不浮出
        {
          const { s } = stateWithCorruption(me);
          s.step = 'check-compile';
          const root = frame(s);
          expect(classOf(handOf(root, me), 'play-btns').length,
            '非 action 步骤下不该有「翻面」按钮（那时打不出牌）').toBe(0);
        }
      }
    } finally { resetUiState(); restore(); }
  });

  it('源码/样式腿：隐藏态必须真的**不可点**（`pointer-events: none`）+ `visibility: hidden`', () => {
    /**
     * 为什么这条也要钉：浮出组现在是**每张手牌都有**的常驻 DOM，
     * 默认态若只写 `opacity: 0`，那一块（卡上缘之外 34px 的区域）照旧吃点击 ——
     * 会挡住相邻元素/卡面的点击。这是"多出来的 DOM"必须付的代价，写在 `styles-local.css`。
     */
    const css = read('src/ui/styles-local.css');
    const at = css.indexOf('.hand .card > .play-btns.play-btns-hover {');
    expect(at, 'styles-local.css 里找不到隐藏态那条规则（`.play-btns-hover`）').toBeGreaterThan(0);
    const block = css.slice(at, css.indexOf('}', at));
    expect(block, '隐藏态没有 `opacity: 0`').toMatch(/opacity:\s*0/);
    expect(block, '隐藏态没有 `visibility: hidden`（键盘 tab 序 / 无障碍树仍会命中）')
      .toMatch(/visibility:\s*hidden/);
    expect(block, '隐藏态没有 `pointer-events: none` ⇒ 它会在卡上缘外侧吃点击').toMatch(/pointer-events:\s*none/);
    // 显形那一半也要在（否则这个按钮永远不会出现）
    expect(css, '`:hover` 显形那条规则不在').toMatch(/\.hand \.card:hover > \.play-btns\.play-btns-hover/);
    // 对方落点高亮的样式在
    expect(css, '`.stack-slot.drop-ok` 的样式不在（对方那 3 条亮不起来）').toContain('.stack-slot.drop-ok {');
  });

  it('源码腿：`renderStackSlot` 的 peek 判据不许被"点亮对方槽"这件事污染', () => {
    /**
     * 本条守的是一个**信息泄露**通道：`renderStackSlot` 的 `isSelfSlot` 除了画高亮，
     * 还兼任"本槽的反面牌允许查看正面"（`card.faceUp || … || (isSelfSlot && !card.secret)`）。
     * 所以对方槽的高亮**不能**靠把 `isSelfSlot` 传成 `true` 来实现 ——
     * 那样对手的未公开信息就变成可以翻开看的了。
     */
    const src = read('src/ui/render.ts');
    expect(src, '`renderStackSlot` 里的 peek 判据变了（先复核这条腿还有没有意义）')
      .toMatch(/card\.faceUp \|\| s\.phase === 'gameover' \|\| \(isSelfSlot && !card\.secret\)/);
    // 热座那两处调用点仍然**不带** opts（`isSelfSlot` 走缺省 = `player === s.turnPlayer`）
    const hotCalls = src.match(/renderStackSlot\(\s*s, [01], line,[\s\S]{0,400}?\n\s*\)/g) ?? [];
    expect(hotCalls.length, '找不到热座的两个 renderStackSlot 调用点').toBeGreaterThanOrEqual(2);
    for (const call of hotCalls) {
      expect(call, '热座调用点带了 `isSelfSlot` opts ⇒ 对方槽会变成"可查看反面牌"').not.toMatch(/isSelfSlot/);
    }
    // 高亮是**事后加类**这条路
    expect(src, '对方槽的高亮不是"事后加 `drop-ok`"这条路（判据面变了，先复核）')
      .toMatch(/classList\.add\('drop-ok'\)/);
  });
});

/** 反空锚点：确保 `descendants` 这条腿用的助手真的能走树（没有它上面的断言可能全是空集） */
describe('助手自检（反空锚点）', () => {
  it('`classOf` / `descendants` 在桩树上真的能命中后代', () => {
    const root = makeStubEl('div');
    const mid = makeStubEl('div');
    mid.classList.add('mid');
    const leaf = makeStubEl('span');
    leaf.classList.add('leaf');
    mid.appendChild(leaf);
    root.appendChild(mid);
    expect(classOf(root, 'leaf').length).toBe(1);
    expect(descendants(root).length).toBe(3);
  });
});
